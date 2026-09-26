/*
 * Doom's Enhancement Suite for SillyTavern — Voices: connection profile
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
 * Which Google key voices use (Settings → Voices → Connection).
 *
 * The user can point voices at one of their SillyTavern connection
 * profiles WITHOUT switching their chat connection. A Google AI Studio
 * profile carries at most two things that matter here:
 *
 * - a proxy preset: sent with each voice request (reverse_proxy +
 *   proxy_password), exactly as SillyTavern's own Google TTS provider does,
 *   so nothing global changes;
 * - a saved-key id ("secret-id"): SillyTavern's Google TTS route always uses
 *   the ACTIVE saved key, so DES makes the profile's key active for the one
 *   request and switches back straight after — the same rotation
 *   SillyTavern performs when a profile is applied. While a key is swapped:
 *     · requests are serialised (one at a time);
 *     · no swap starts while SillyTavern or DES is generating, and a
 *       generation that starts during a swap waits for the swap-back
 *       before it is sent (voiceBoot's GENERATION_STARTED listener awaits
 *       holdForGeneration) — so a chat request never goes out on the
 *       voice profile's key;
 *     · a marker in localStorage lets the next page load swap back if the
 *       browser closed mid-request.
 *   Nothing is swapped when the profile's key is already the active one.
 */
import { getRequestHeaders } from '../../../../../../../script.js';
import { getContext } from '../../../../../../extensions.js';
import { proxies } from '../../../../../../openai.js';
import { isGenerating as isDesGenerating } from '../../core/state.js';

// SECRET_KEYS.MAKERSUITE in SillyTavern's secrets.js.
const SECRET_KEY = 'api_key_makersuite';
export const ROTATION_MARKER = 'dooms_voices_key_swap';
/** Connection-profile "api" values that mean Google AI Studio. */
const GOOGLE_APIS = new Set(['google', 'makersuite']);

/**
 * All SillyTavern connection profiles, with whether each can drive voices.
 * @returns {{name: string, usable: boolean, why: string}[]}
 */
export function listProfiles() {
    let profiles = [];
    try {
        const ctx = getContext();
        const ext = ctx.extension_settings || ctx.extensionSettings;
        profiles = Array.isArray(ext?.connectionManager?.profiles) ? ext.connectionManager.profiles : [];
    } catch (e) { /* connection manager disabled */ }
    return profiles
        .filter(p => p && typeof p.name === 'string')
        .map(p => {
            const usable = p.mode === 'cc' && GOOGLE_APIS.has(String(p.api || '').toLowerCase());
            return { name: p.name, usable, why: usable ? '' : 'not a Google AI Studio profile' };
        })
        .sort((a, b) => a.name.localeCompare(b.name));
}

function findProfile(name) {
    try {
        const ctx = getContext();
        const ext = ctx.extension_settings || ctx.extensionSettings;
        const list = ext?.connectionManager?.profiles;
        return Array.isArray(list) ? list.find(p => p && p.name === name) || null : null;
    } catch (e) {
        return null;
    }
}

/**
 * What a voice request should use for the chosen profile.
 * @param {string} profileName - '' = SillyTavern's current Google key
 * @returns {{ok: true, label: string, proxy: {url: string, password: string}|null, secretId: string|null}
 *          | {ok: false, error: string}}
 */
export function resolveConnection(profileName) {
    if (!profileName) return { ok: true, label: 'your active SillyTavern Google key', proxy: null, secretId: null };
    const profile = findProfile(profileName);
    if (!profile) return { ok: false, error: `The connection profile "${profileName}" no longer exists. Pick another in Settings → Voices.` };
    if (profile.mode !== 'cc' || !GOOGLE_APIS.has(String(profile.api || '').toLowerCase())) {
        return { ok: false, error: `The connection profile "${profileName}" isn't a Google AI Studio profile.` };
    }
    let proxy = null;
    if (profile.proxy) {
        const preset = Array.isArray(proxies) ? proxies.find(p => p && p.name === profile.proxy) : null;
        if (preset && /^https?:\/\//i.test(preset.url || '')) proxy = { url: preset.url, password: preset.password || '' };
    }
    const secretId = typeof profile['secret-id'] === 'string' && profile['secret-id'] ? profile['secret-id'] : null;
    return { ok: true, label: `the "${profileName}" connection profile`, proxy, secretId };
}

// ─── Temporary key swap ─────────────────────────────────────────────────────

let swapChain = Promise.resolve();
let swapping = null; // Promise while a swapped request is in flight

// ── Generation hold ──
let genHeld = false;
let heldAt = 0;
const GENERATION_IDLE_MS = 2000;
const GENERATION_MAX_WAIT_MS = 10 * 60 * 1000;
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/** SillyTavern sets body[data-generating] for every real (non-dry-run) generation, quiet ones included. */
function generationBusy() {
    try {
        if (document.body?.dataset?.generating === 'true') return true;
    } catch (e) {}
    return !!isDesGenerating;
}

/**
 * GENERATION_STARTED: blocks new key swaps until the generation is over,
 * and resolves once any swap in flight has been switched back.
 */
export async function holdForGeneration() {
    genHeld = true;
    heldAt = Date.now();
    await waitForKeyRestore();
}

/** GENERATION_ENDED / GENERATION_STOPPED */
export function endGenerationHold() {
    genHeld = false;
}

/** Resolves when nothing is generating (or a generation that never really started has gone quiet). */
async function waitForGenerationIdle() {
    const started = Date.now();
    let sawBusy = false;
    let idleSince = null;
    while (Date.now() - started < GENERATION_MAX_WAIT_MS) {
        if (generationBusy()) {
            sawBusy = true;
            idleSince = null;
        } else {
            if (!genHeld) return;
            // Held but idle: the generation finished without an end event,
            // or exited before sending anything.
            if (sawBusy && Date.now() - heldAt > 250) { genHeld = false; return; }
            idleSince = idleSince ?? Date.now();
            if (Date.now() - idleSince > GENERATION_IDLE_MS) { genHeld = false; return; }
        }
        await sleep(250);
    }
    genHeld = false;
}

async function readGoogleSecrets() {
    const response = await fetch('/api/secrets/read', {
        method: 'POST',
        headers: getRequestHeaders({ omitContentType: true }),
    });
    if (!response.ok) throw new Error(`Couldn't read SillyTavern's saved keys (HTTP ${response.status})`);
    const state = await response.json();
    return Array.isArray(state?.[SECRET_KEY]) ? state[SECRET_KEY] : [];
}

async function rotateTo(id) {
    const response = await fetch('/api/secrets/rotate', {
        method: 'POST',
        headers: getRequestHeaders(),
        body: JSON.stringify({ key: SECRET_KEY, id }),
    });
    if (!response.ok) throw new Error(`Couldn't switch SillyTavern's Google key (HTTP ${response.status})`);
}

function writeMarker(originalId) {
    try { localStorage.setItem(ROTATION_MARKER, JSON.stringify({ key: SECRET_KEY, originalId, at: Date.now() })); } catch (e) {}
}

function clearMarker() {
    try { localStorage.removeItem(ROTATION_MARKER); } catch (e) {}
}

/**
 * Runs `fn` with the given saved Google key active, then restores the key
 * that was active before. Serialised: one swapped request at a time.
 * @template T
 * @param {string|null} secretId
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 */
export function withGoogleKey(secretId, fn) {
    if (!secretId) return fn();
    const run = async () => {
        const secrets = await readGoogleSecrets();
        if (!secrets.some(s => s.id === secretId)) {
            const err = new Error('The Google key saved in that connection profile no longer exists in SillyTavern.');
            err.kind = 'no-key';
            throw err;
        }
        let active = secrets.find(s => s.active);
        if (active && active.id === secretId) return fn();
        if (genHeld || generationBusy()) {
            await waitForGenerationIdle();
            // The active key may have changed while we waited (a profile switch).
            active = (await readGoogleSecrets()).find(s => s.active);
            if (active && active.id === secretId) return fn();
        }
        let release;
        swapping = new Promise(resolve => { release = resolve; });
        writeMarker(active ? active.id : null);
        try {
            await rotateTo(secretId);
            return await fn();
        } finally {
            try {
                if (active) await rotateTo(active.id);
                clearMarker();
            } catch (e) {
                console.error('[DES Voices] could not switch SillyTavern’s Google key back; it will be retried on the next load', e);
            }
            swapping = null;
            release();
        }
    };
    const result = swapChain.then(run, run);
    swapChain = result.catch(() => {});
    return result;
}

/** Resolves once no swapped request is in flight (chat generations wait on this). */
export function waitForKeyRestore() {
    return swapping || Promise.resolve();
}

/** After a crash mid-swap: put SillyTavern's previously active key back. */
export async function recoverKeySwap() {
    let marker = null;
    try { marker = JSON.parse(localStorage.getItem(ROTATION_MARKER) || 'null'); } catch (e) {}
    if (!marker) return;
    try {
        if (marker.originalId) {
            const secrets = await readGoogleSecrets();
            if (secrets.some(s => s.id === marker.originalId)) await rotateTo(marker.originalId);
        }
        clearMarker();
        console.log('[DES Voices] restored SillyTavern’s active Google key after an interrupted voice request');
    } catch (e) {
        console.warn('[DES Voices] could not restore SillyTavern’s Google key', e);
    }
}
