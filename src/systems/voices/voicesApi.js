/*
 * Doom's Enhancement Suite for SillyTavern — Voices: Google Voices API
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
 * Creates, lists and deletes custom voices in the user's Google project
 * (docs/google-tts-voices-plan.md §8.3, §8.6), with the key pasted into
 * Settings → Voices. SillyTavern has no route for this, so without that key
 * voice design isn't available.
 *
 * Request shapes follow https://ai.google.dev/gemini-api/docs/voice-design
 * (fetched 2026-09-26): POST /v1beta/voices {store, voice:{model, type:
 * 'prompted', display_name, gender?, language_code?, prompted:{input}}}.
 * The docs show snake_case responses; REST APIs often answer camelCase, so
 * every read accepts both.
 */
import { extensionSettings } from '../../core/state.js';
import { getDesKey, classifyError, TtsError } from './transport.js';

const GOOGLE_API = 'https://generativelanguage.googleapis.com/v1beta';
const REQUEST_TIMEOUT_MS = 60000; // designing a voice can take a while
/** Model used to create voices when the chosen one is refused. */
const DESIGN_FALLBACK_MODEL = 'gemini-3.8-flash-tts';

const pick = (obj, ...keys) => {
    for (const k of keys) if (obj && obj[k] !== undefined && obj[k] !== null) return obj[k];
    return undefined;
};

/** "voices/voice_abc" or "voice_abc" → "voice_abc". */
export function bareVoiceId(idOrName) {
    return String(idOrName || '').replace(/^voices\//, '');
}

function requireKey() {
    const key = getDesKey();
    if (!key) throw new TtsError('no-key', 'Designing voices needs your Google AI Studio key in Settings → Voices.');
    return key;
}

async function call(method, path, body) {
    const key = requireKey();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let response;
    try {
        response = await fetch(`${GOOGLE_API}${path}`, {
            method,
            headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
            body: body ? JSON.stringify(body) : undefined,
            signal: controller.signal,
        });
    } catch (e) {
        throw new TtsError('network', controller.signal.aborted ? 'Google took too long to answer' : 'Couldn’t reach Google', 0);
    } finally {
        clearTimeout(timer);
    }
    const text = await response.text().catch(() => '');
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = null; }
    if (!response.ok) {
        const message = json?.error?.message || text || `HTTP ${response.status}`;
        const kind = response.status === 404 ? 'voice-gone' : classifyError(response.status, message);
        throw new TtsError(kind, String(message), response.status);
    }
    return json || {};
}

/**
 * Normalises a voice resource from Google into DES's shape.
 * @returns {{id: string, label: string, type: string, gender: string, languageCode: string, expireTime: string|null,
 *            sample: {mimeType: string, data: string}|null}}
 */
export function normalizeVoice(v) {
    const sample = pick(v, 'sample_audio', 'sampleAudio');
    return {
        id: bareVoiceId(pick(v, 'id', 'name')),
        label: pick(v, 'display_name', 'displayName') || '',
        type: String(pick(v, 'type') || '').toLowerCase(),
        gender: String(pick(v, 'gender') || '').toLowerCase(),
        languageCode: pick(v, 'language_code', 'languageCode') || '',
        expireTime: pick(v, 'expire_time', 'expireTime') || null,
        sample: sample && pick(sample, 'data')
            ? { mimeType: pick(sample, 'mime_type', 'mimeType') || 'audio/wav', data: pick(sample, 'data') }
            : null,
    };
}

/**
 * Designs a voice from a description. The voice is saved in the user's
 * Google project straight away (it uses one of the 200 slots until deleted).
 * @param {{description: string, displayName: string, gender?: string, languageCode?: string}} spec
 */
export async function createDesignedVoice({ description, displayName, gender, languageCode }) {
    const chosen = extensionSettings.voices?.model || DESIGN_FALLBACK_MODEL;
    const voiceBody = (model) => {
        const voice = {
            model,
            type: 'prompted',
            display_name: String(displayName || 'DES voice').slice(0, 60),
            prompted: { input: String(description || '').trim() },
        };
        if (gender === 'female' || gender === 'male') voice.gender = gender;
        if (languageCode) voice.language_code = languageCode;
        return { store: true, voice };
    };
    try {
        return normalizeVoice(await call('POST', '/voices', voiceBody(chosen)));
    } catch (e) {
        // Flash-Lite may not design voices; Flash is the documented example.
        if (chosen !== DESIGN_FALLBACK_MODEL && (e.kind === 'argument' || e.kind === 'model-unavailable')) {
            return normalizeVoice(await call('POST', '/voices', voiceBody(DESIGN_FALLBACK_MODEL)));
        }
        throw e;
    }
}

/**
 * Clones a voice from two recordings of the same adult speaker: a 10–30 s
 * sample and the consent statement (voice-replication docs, fetched
 * 2026-09-26). Both are 24 kHz mono 16-bit WAV, base64. Google checks that
 * the consent recording says the statement and matches the sample.
 * @param {{displayName: string, sourceBase64: string, consentBase64: string}} spec
 */
export async function createClonedVoice({ displayName, sourceBase64, consentBase64 }) {
    const chosen = extensionSettings.voices?.model || DESIGN_FALLBACK_MODEL;
    const body = (model) => ({
        store: true,
        voice: {
            model,
            type: 'replicated',
            display_name: String(displayName || 'DES voice').slice(0, 60),
            replicated: {
                source_audio: { mime_type: 'audio/wav', data: sourceBase64 },
                consent_audio: { mime_type: 'audio/wav', data: consentBase64 },
            },
        },
    });
    try {
        return normalizeVoice(await call('POST', '/voices', body(chosen)));
    } catch (e) {
        if (chosen !== DESIGN_FALLBACK_MODEL && e.kind === 'model-unavailable') {
            return normalizeVoice(await call('POST', '/voices', body(DESIGN_FALLBACK_MODEL)));
        }
        throw e;
    }
}

/** Deletes a voice from the user's Google project. A voice that's already gone counts as deleted. */
export async function deleteVoice(id) {
    try {
        await call('DELETE', `/voices/${encodeURIComponent(bareVoiceId(id))}`);
    } catch (e) {
        if (e.kind !== 'voice-gone') throw e;
    }
}

/** One voice, or null when Google no longer has it. */
export async function getVoice(id) {
    try {
        return normalizeVoice(await call('GET', `/voices/${encodeURIComponent(bareVoiceId(id))}`));
    } catch (e) {
        if (e.kind === 'voice-gone') return null;
        throw e;
    }
}

/**
 * Every custom voice in the project (designed + cloned, including ones made
 * outside DES), for the "N of 200" counter and the manager.
 * @returns {Promise<ReturnType<typeof normalizeVoice>[]>}
 */
export async function listCustomVoices() {
    const out = [];
    let pageToken = '';
    for (let page = 0; page < 10; page++) {
        const params = new URLSearchParams();
        params.append('type', 'prompted');
        params.append('type', 'replicated');
        params.set('page_size', '100');
        if (pageToken) params.set('page_token', pageToken);
        const json = await call('GET', `/voices?${params.toString()}`);
        for (const v of pick(json, 'voices') || []) out.push(normalizeVoice(v));
        pageToken = pick(json, 'next_page_token', 'nextPageToken') || '';
        if (!pageToken) break;
    }
    return out.filter(v => v.id && (v.type === '' || v.type === 'prompted' || v.type === 'replicated'));
}

/** Google's per-project limit on stored custom voices. */
export const CUSTOM_VOICE_LIMIT = 200;
