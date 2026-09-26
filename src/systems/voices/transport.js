/*
 * Doom's Enhancement Suite for SillyTavern — Voices: Google TTS transport
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
 * Sends one line of text to Google and returns playable audio
 * (docs/google-tts-voices-plan.md §5). Two routes:
 *
 * - DIRECT — a Google AI Studio key pasted into Settings → Voices. The
 *   browser calls Google's generateContent endpoint itself, so the model
 *   and request shape don't depend on what SillyTavern supports.
 * - SILLYTAVERN — no key in DES: POST /api/google/generate-native-tts, which
 *   uses the Google AI Studio key saved in SillyTavern (it never reaches the
 *   browser). That route sends stock voice names only.
 *
 * Unverified (plan §15): whether 3.8 accepts SillyTavern's request shape,
 * and which voice field 3.8 wants on generateContent (docs show
 * speechConfig.voiceConfig.voice; older models use prebuiltVoiceConfig).
 * So the first request is the probe: on a model/argument error DES tries
 * the other voice field (direct route), then the model SillyTavern's own
 * provider uses (3.1 preview), remembers what worked for this browser
 * session, and says so in the status line. Rate limits, network errors and
 * bad keys never trigger a downgrade.
 */
import { getRequestHeaders } from '../../../../../../../script.js';
import { oai_settings } from '../../../../../../openai.js';
import { extensionSettings } from '../../core/state.js';
import { ST_FALLBACK_MODEL } from './voiceSettings.js';
import { pcm16ToWav, base64ToBytes, isRawPcm, sampleRateFromMime } from './wav.js';

const PROBE_KEY = 'dooms_voices_probe';
const PROBE_TTL_MS = 6 * 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 20000;
const GOOGLE_API = 'https://generativelanguage.googleapis.com/v1beta';

/** Last known state of the route in use, for the status line. */
const routeState = {
    /** 'direct' | 'st' | null */
    route: null,
    /** 'unknown' | 'ok' | 'no-key' | 'bad-key' | 'error' */
    status: 'unknown',
    /** the model actually used, once known */
    effectiveModel: null,
    lastError: '',
};

export function getRouteState() {
    return { ...routeState };
}

/** The key pasted into Settings → Voices, or '' to use SillyTavern's. */
export function getDesKey() {
    const key = extensionSettings.voices?.googleApiKey;
    return typeof key === 'string' ? key.trim() : '';
}

// ─── Per-session probe memory ───────────────────────────────────────────────

function probeSlot(route, requested) {
    return `${route}|${requested}`;
}

function readProbe(route, requested) {
    try {
        const all = JSON.parse(sessionStorage.getItem(PROBE_KEY) || '{}');
        const probe = all[probeSlot(route, requested)];
        if (!probe || Date.now() - probe.at > PROBE_TTL_MS) return null;
        return probe;
    } catch (e) {
        return null;
    }
}

function writeProbe(route, requested, model, shape) {
    try {
        const all = JSON.parse(sessionStorage.getItem(PROBE_KEY) || '{}');
        all[probeSlot(route, requested)] = { model, shape, at: Date.now() };
        sessionStorage.setItem(PROBE_KEY, JSON.stringify(all));
    } catch (e) { /* private mode — probe again next time */ }
}

export function clearRouteProbe() {
    try { sessionStorage.removeItem(PROBE_KEY); } catch (e) {}
    routeState.route = null;
    routeState.status = 'unknown';
    routeState.effectiveModel = null;
    routeState.lastError = '';
}

// ─── Errors ─────────────────────────────────────────────────────────────────

export class TtsError extends Error {
    /**
     * @param {string} kind - see classifyError
     * @param {string} message
     * @param {number} [status]
     */
    constructor(kind, message, status) {
        super(message);
        this.name = 'TtsError';
        this.kind = kind;
        this.status = status;
    }
}

/**
 * Buckets an HTTP status + Google's error text into something DES can act on.
 * @returns {'no-key'|'bad-key'|'quota'|'rate'|'model-unavailable'|'argument'|'content'|'network'|'aborted'|'unknown'}
 */
export function classifyError(status, message = '') {
    const text = String(message || '').toLowerCase();
    if (status === 0) return 'network';
    // An empty key reaches Google as "unregistered callers"; check it first.
    if (/unregistered callers|missing.*key|no key|key.*(missing|required)/.test(text)) return 'no-key';
    if (/api key not valid|api_key_invalid|invalid api key|permission_denied|unauthenticated|api key expired/.test(text)) return 'bad-key';
    if (status === 429 || /resource_exhausted|rate limit|too many requests/.test(text)) {
        return /quota|billing|exceeded your current quota/.test(text) ? 'quota' : 'rate';
    }
    if (status === 404 || /not found|is not supported|unsupported model|model .* (does not exist|not available)|not_found/.test(text)) {
        return 'model-unavailable';
    }
    if (status === 400 || /invalid_argument|invalid argument|unknown name|invalid value/.test(text)) return 'argument';
    if (/no audio data|safety|blocked|prohibited/.test(text)) return 'content';
    if (status === 401 || status === 403) return 'bad-key';
    return 'unknown';
}

/** fetch with the caller's abort signal plus a timeout. */
async function fetchWithTimeout(url, init, signal, unreachable) {
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), REQUEST_TIMEOUT_MS);
    const onAbort = () => timeout.abort();
    signal?.addEventListener?.('abort', onAbort, { once: true });
    try {
        return await fetch(url, { ...init, signal: timeout.signal });
    } catch (e) {
        if (signal?.aborted) throw new TtsError('aborted', 'Stopped');
        throw new TtsError('network', timeout.signal.aborted ? 'Google took too long to answer' : unreachable, 0);
    } finally {
        clearTimeout(timer);
        signal?.removeEventListener?.('abort', onAbort);
    }
}

async function errorFrom(response) {
    let message = `HTTP ${response.status}`;
    try {
        const body = await response.text();
        try {
            const json = JSON.parse(body);
            message = json?.error?.message || json?.error || body || message;
        } catch { message = body || message; }
    } catch (e) { /* keep status text */ }
    return new TtsError(classifyError(response.status, message), String(message), response.status);
}

// ─── Direct route (key in DES) ──────────────────────────────────────────────

/** Which voice field to try first: 3.8 documents voiceConfig.voice; older models use prebuiltVoiceConfig. */
function shapesFor(model) {
    return /gemini-3\.8/i.test(model) ? ['voice', 'prebuilt'] : ['prebuilt', 'voice'];
}

function directBody(text, voiceId, shape) {
    const voiceConfig = shape === 'voice' ? { voice: voiceId } : { prebuiltVoiceConfig: { voiceName: voiceId } };
    return {
        contents: [{ role: 'user', parts: [{ text }] }],
        generationConfig: {
            responseModalities: ['AUDIO'],
            speechConfig: { voiceConfig },
        },
    };
}

async function postDirect({ text, voiceId, model, shape, key, signal }) {
    const response = await fetchWithTimeout(
        `${GOOGLE_API}/models/${encodeURIComponent(model)}:generateContent`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
            body: JSON.stringify(directBody(text, voiceId, shape)),
        },
        signal,
        'Couldn’t reach Google (check your connection, or whether something is blocking requests to googleapis.com)',
    );
    if (!response.ok) throw await errorFrom(response);
    const json = await response.json();
    const parts = json?.candidates?.[0]?.content?.parts || [];
    const audio = parts.find(p => p?.inlineData?.data)?.inlineData;
    if (!audio) {
        const why = json?.promptFeedback?.blockReason || json?.candidates?.[0]?.finishReason || 'no audio data';
        throw new TtsError('content', `Google returned no audio (${why})`, response.status);
    }
    const bytes = base64ToBytes(audio.data);
    if (isRawPcm(audio.mimeType) || !audio.mimeType) {
        return new Blob([pcm16ToWav(bytes, sampleRateFromMime(audio.mimeType))], { type: 'audio/wav' });
    }
    return new Blob([bytes], { type: audio.mimeType });
}

async function synthesizeDirect({ text, voiceId, model, signal, key }) {
    const remembered = readProbe('direct', model);
    const attempts = [];
    if (remembered) {
        attempts.push({ model: remembered.model, shape: remembered.shape });
    } else {
        for (const shape of shapesFor(model)) attempts.push({ model, shape });
        if (model !== ST_FALLBACK_MODEL) attempts.push({ model: ST_FALLBACK_MODEL, shape: 'prebuilt' });
    }
    let lastError = null;
    for (const attempt of attempts) {
        try {
            const blob = await postDirect({ text, voiceId, model: attempt.model, shape: attempt.shape, key, signal });
            if (!remembered) writeProbe('direct', model, attempt.model, attempt.shape);
            if (attempt.model !== model) {
                console.warn(`[DES Voices] Google rejected ${model} (${lastError?.message}); using ${attempt.model} this session.`);
            }
            return { blob, model: attempt.model };
        } catch (e) {
            if (!(e instanceof TtsError)) throw e;
            lastError = e;
            // Only a model/argument error means "try another shape or model".
            if (remembered || (e.kind !== 'model-unavailable' && e.kind !== 'argument')) throw e;
        }
    }
    throw lastError;
}

// ─── SillyTavern route (key saved in SillyTavern) ───────────────────────────

/** The request body SillyTavern's own Google provider sends (google-native.js), minus text/voice/model. */
function stRouteExtras() {
    const s = oai_settings || {};
    const proxy = typeof s.reverse_proxy === 'string' && /^https?:\/\//i.test(s.reverse_proxy) ? s.reverse_proxy : '';
    return {
        // SillyTavern's own Google TTS provider always sends AI Studio;
        // its Vertex option is disabled.
        api: 'makersuite',
        reverse_proxy: proxy,
        proxy_password: proxy ? (s.proxy_password || '') : '',
        vertexai_auth_mode: s.vertexai_auth_mode,
        vertexai_region: s.vertexai_region,
        vertexai_express_project_id: s.vertexai_express_project_id,
    };
}

async function postStRoute({ text, voiceId, model, signal }) {
    const response = await fetchWithTimeout('/api/google/generate-native-tts', {
        method: 'POST',
        headers: getRequestHeaders(),
        body: JSON.stringify({ text, voice: voiceId, model, ...stRouteExtras() }),
    }, signal, 'Couldn’t reach SillyTavern');
    if (!response.ok) throw await errorFrom(response);
    const blob = await response.blob();
    if (!blob || blob.size === 0) throw new TtsError('content', 'Google returned no audio', response.status);
    return blob;
}

async function synthesizeSt({ text, voiceId, model, signal }) {
    const remembered = readProbe('st', model);
    const first = remembered?.model || model;
    try {
        const blob = await postStRoute({ text, voiceId, model: first, signal });
        if (!remembered) writeProbe('st', model, first, 'prebuilt');
        return { blob, model: first };
    } catch (e) {
        if (!(e instanceof TtsError)) throw e;
        const canDowngrade = !remembered && first !== ST_FALLBACK_MODEL &&
            (e.kind === 'model-unavailable' || e.kind === 'argument');
        if (!canDowngrade) throw e;
        const blob = await postStRoute({ text, voiceId, model: ST_FALLBACK_MODEL, signal });
        console.warn(`[DES Voices] SillyTavern's Google route rejected ${first} (${e.message}); using ${ST_FALLBACK_MODEL} this session.`);
        writeProbe('st', model, ST_FALLBACK_MODEL, 'prebuilt');
        return { blob, model: ST_FALLBACK_MODEL };
    }
}

// ─── Entry point ────────────────────────────────────────────────────────────

/**
 * Synthesises one line with a stock voice.
 * @param {{text: string, voiceId: string, model: string, signal?: AbortSignal}} req
 * @returns {Promise<{blob: Blob, model: string}>}
 */
export async function synthesize({ text, voiceId, model, signal }) {
    const key = getDesKey();
    const route = key ? 'direct' : 'st';
    if (routeState.route !== route) {
        routeState.route = route;
        routeState.status = 'unknown';
        routeState.effectiveModel = null;
        routeState.lastError = '';
    }
    try {
        const result = key
            ? await synthesizeDirect({ text, voiceId, model, signal, key })
            : await synthesizeSt({ text, voiceId, model, signal });
        routeState.status = 'ok';
        routeState.effectiveModel = result.model;
        routeState.lastError = '';
        return result;
    } catch (e) {
        const err = e instanceof TtsError ? e : new TtsError('unknown', e?.message || String(e));
        if (err.kind !== 'aborted') {
            routeState.status = err.kind === 'bad-key' || err.kind === 'no-key' ? err.kind : 'error';
            routeState.lastError = err.message;
        }
        throw err;
    }
}
