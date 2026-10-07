/*
 * Doom's Enhancement Suite for SillyTavern — Voices: OpenRouter
 * Copyright (C) 2026 Jordan (DangerDaza)
 *
 * This file is part of Doom's Enhancement Suite and is licensed under the
 * GNU Affero General Public License v3.0 or later. If you redistribute this
 * file or a modified version of it, you must keep this notice intact, state
 * your changes, and release your version under the same license.
 *
 * See the LICENSE file in the project root for the full terms and for
 * additional copyright notices.
 *
 * https://github.com/DangerDaza/Dooms-Enhancement-Suite
 */

/**
 * Standard Gemini voices through OpenRouter's speech API
 * (docs/tts-connections-plan.md §6.1). Pay-as-you-go, no Google tiers.
 *
 * Two routes, because we don't know that every OpenRouter/browser
 * combination allows a direct call (CORS):
 * - browser: the key in DES, straight to OpenRouter. Carries the delivery note.
 * - server: SillyTavern's OpenAI Compatible route, with the key saved in
 *   SillyTavern's "Custom OpenAI TTS" slot. No delivery note (that route
 *   only forwards the standard fields).
 * 'auto' tries the browser first and, if the request never got an answer,
 * uses the server route for the rest of the session when it's set up.
 */
import { getRequestHeaders } from '../../../../../../../script.js';
import { secret_state, writeSecret } from '../../../../../../secrets.js';
import { extensionSettings } from '../../core/state.js';
import { TtsError, fetchWithTimeout, timeoutFor } from './transport.js';
import {
    OPENROUTER_SPEECH_URL,
    ST_SECRET,
    openRouterBody,
    openRouterModel,
    classifyOpenRouterError,
    isStyleComplaint,
    stHasSecret,
} from './connections.js';

/** The browser route failed without an answer this session (likely CORS). */
let browserBlocked = false;
/** OpenRouter refused the delivery note this session. */
let styleRejected = false;
/** Last route used, for the status line: 'browser' | 'server' | null. */
let lastRoute = null;

function v() {
    return extensionSettings.voices || {};
}

function desKey() {
    return String(v().openrouterKey || '').trim();
}

export function hasServerKey() {
    return stHasSecret(secret_state, ST_SECRET.customTts);
}

/** For the status line. */
export function getOpenRouterState() {
    return { lastRoute, browserBlocked, styleRejected, serverReady: hasServerKey() };
}

/** Forget this session's guesses (after the key or route setting changes). */
export function resetOpenRouterState() {
    browserBlocked = false;
    styleRejected = false;
    lastRoute = null;
}

/**
 * Saves the OpenRouter key in SillyTavern's "Custom OpenAI TTS" slot so the
 * server route can use it. SillyTavern keeps older keys in that slot; the
 * new one becomes the active one.
 * @returns {Promise<boolean>}
 */
export async function saveKeyToSillyTavern(key) {
    const value = String(key || '').trim();
    if (!value) return false;
    const id = await writeSecret(ST_SECRET.customTts, value, 'OpenRouter (DES voices)');
    return !!id;
}

async function errorFrom(response) {
    let message = `HTTP ${response.status}`;
    try {
        const body = await response.text();
        try {
            const json = JSON.parse(body);
            message = json?.error?.message || json?.message || json?.error || body || message;
        } catch { message = body || message; }
    } catch (e) { /* keep the status */ }
    const err = new TtsError(classifyOpenRouterError(response.status, message), `OpenRouter: ${message}`, response.status);
    err.provider = 'openrouter';
    return err;
}

async function audioFrom(response) {
    const blob = await response.blob();
    if (!blob || blob.size === 0) {
        const err = new TtsError('content', 'OpenRouter returned no audio', response.status);
        err.provider = 'openrouter';
        throw err;
    }
    // OpenRouter answers mp3 bytes; some proxies drop the type.
    return blob.type && blob.type.startsWith('audio/') ? blob : new Blob([blob], { type: 'audio/mpeg' });
}

async function viaBrowser({ text, voiceId, model, style, signal, key }) {
    const send = async (withStyle) => {
        const response = await fetchWithTimeout(OPENROUTER_SPEECH_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
            body: JSON.stringify(openRouterBody({ text, voiceId, model, style: withStyle ? style : '' })),
        }, signal, 'Couldn’t reach OpenRouter from the browser', timeoutFor(text));
        if (!response.ok) throw await errorFrom(response);
        return audioFrom(response);
    };
    const withStyle = !!style && !styleRejected;
    try {
        return await send(withStyle);
    } catch (e) {
        if (withStyle && e instanceof TtsError && e.kind === 'argument' && isStyleComplaint(e.message)) {
            styleRejected = true;
            console.warn(`[DES Voices] OpenRouter refused the delivery note (${e.message}); sending lines without it this session.`);
            return send(false);
        }
        throw e;
    }
}

async function viaServer({ text, voiceId, model, signal }) {
    const response = await fetchWithTimeout('/api/openai/custom/generate-voice', {
        method: 'POST',
        headers: getRequestHeaders(),
        body: JSON.stringify({
            input: text,
            provider_endpoint: OPENROUTER_SPEECH_URL,
            response_format: 'mp3',
            voice: voiceId,
            speed: 1,
            model: openRouterModel(model),
        }),
    }, signal, 'Couldn’t reach SillyTavern', timeoutFor(text));
    // SillyTavern relays OpenRouter's error text with a 500.
    if (!response.ok) throw await errorFrom(response);
    return audioFrom(response);
}

/**
 * One line through OpenRouter.
 * @param {{text: string, voiceId: string, model: string, style?: string, signal?: AbortSignal}} req
 * @returns {Promise<{blob: Blob, model: string}>}
 */
export async function synthesizeOpenRouter({ text, voiceId, model, style = '', signal }) {
    const route = v().openrouterRoute === 'server' ? 'server' : v().openrouterRoute === 'browser' ? 'browser' : 'auto';
    const key = desKey();
    const tag = (e) => {
        if (e instanceof TtsError && !e.provider) e.provider = 'openrouter';
        return e;
    };
    const useServer = route === 'server' || (route === 'auto' && (browserBlocked || !key) && hasServerKey());
    try {
        if (useServer) {
            if (!hasServerKey()) {
                throw new TtsError('no-key', 'Save your OpenRouter key in SillyTavern first (Settings → Voices → OpenRouter → Save key to SillyTavern).');
            }
            const blob = await viaServer({ text, voiceId, model, signal });
            lastRoute = 'server';
            return { blob, model: openRouterModel(model) };
        }
        if (!key) throw new TtsError('no-key', 'Paste your OpenRouter key in Settings → Voices.');
        try {
            const blob = await viaBrowser({ text, voiceId, model, style, signal, key });
            lastRoute = 'browser';
            return { blob, model: openRouterModel(model) };
        } catch (e) {
            // No answer at all from OpenRouter: assume the browser call is
            // blocked (CORS) rather than OpenRouter being down.
            if (route === 'auto' && e instanceof TtsError && e.kind === 'network') {
                browserBlocked = true;
                if (hasServerKey()) {
                    console.warn('[DES Voices] OpenRouter couldn’t be reached from the browser; using SillyTavern’s server route this session.');
                    const blob = await viaServer({ text, voiceId, model, signal });
                    lastRoute = 'server';
                    return { blob, model: openRouterModel(model) };
                }
                throw new TtsError('openrouter-blocked', 'Your browser couldn’t reach OpenRouter directly.', 0);
            }
            throw e;
        }
    } catch (e) {
        throw tag(e instanceof TtsError ? e : new TtsError('unknown', e?.message || String(e)));
    }
}
