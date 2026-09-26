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
 * (docs/google-tts-voices-plan.md §5).
 *
 * This release has one route: SillyTavern's own Google TTS endpoint,
 * POST /api/google/generate-native-tts, which uses the Google AI Studio key
 * already saved in SillyTavern — the key never reaches the browser. That
 * route sends stock voice names only.
 *
 * Whether that route can drive Gemini 3.8 is unverified (plan §15 #1). So
 * the first request is the probe: if Google rejects the 3.8 model id, DES
 * retries with the model SillyTavern's own provider uses (3.1 preview),
 * remembers that for this browser session, and says so in the status line.
 * Rate limits, network errors and bad keys never trigger the downgrade.
 */
import { getRequestHeaders } from '../../../../../../../script.js';
import { oai_settings } from '../../../../../../openai.js';
import { ST_FALLBACK_MODEL } from './voiceSettings.js';

const PROBE_KEY = 'dooms_voices_st_model';
const PROBE_TTL_MS = 6 * 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 20000;

/** Last known state of the SillyTavern route, for the status line. */
const routeState = {
    /** 'unknown' | 'ok' | 'no-key' | 'bad-key' | 'error' */
    status: 'unknown',
    /** the model actually used on the ST route, once known */
    effectiveModel: null,
    lastError: '',
};

export function getRouteState() {
    return { ...routeState };
}

function readProbe(requested) {
    try {
        const raw = sessionStorage.getItem(PROBE_KEY);
        if (!raw) return null;
        const probe = JSON.parse(raw);
        if (!probe || probe.requested !== requested || Date.now() - probe.at > PROBE_TTL_MS) return null;
        return probe.model;
    } catch (e) {
        return null;
    }
}

function writeProbe(requested, model) {
    try {
        sessionStorage.setItem(PROBE_KEY, JSON.stringify({ requested, model, at: Date.now() }));
    } catch (e) { /* private mode — probe again next time */ }
}

export function clearRouteProbe() {
    try { sessionStorage.removeItem(PROBE_KEY); } catch (e) {}
    routeState.status = 'unknown';
    routeState.effectiveModel = null;
    routeState.lastError = '';
}

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
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), REQUEST_TIMEOUT_MS);
    const onAbort = () => timeout.abort();
    signal?.addEventListener?.('abort', onAbort, { once: true });
    let response;
    try {
        response = await fetch('/api/google/generate-native-tts', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({ text, voice: voiceId, model, ...stRouteExtras() }),
            signal: timeout.signal,
        });
    } catch (e) {
        if (signal?.aborted) throw new TtsError('aborted', 'Stopped');
        throw new TtsError('network', timeout.signal.aborted ? 'Google took too long to answer' : 'Could not reach SillyTavern', 0);
    } finally {
        clearTimeout(timer);
        signal?.removeEventListener?.('abort', onAbort);
    }
    if (!response.ok) {
        let message = `HTTP ${response.status}`;
        try {
            const body = await response.text();
            try { message = JSON.parse(body).error || body || message; } catch { message = body || message; }
        } catch (e) { /* keep status text */ }
        throw new TtsError(classifyError(response.status, message), String(message), response.status);
    }
    const blob = await response.blob();
    if (!blob || blob.size === 0) throw new TtsError('content', 'Google returned no audio', response.status);
    return blob;
}

/**
 * Synthesises one line with a stock voice through SillyTavern's route.
 * @param {{text: string, voiceId: string, model: string, signal?: AbortSignal}} req
 * @returns {Promise<{blob: Blob, model: string}>}
 */
export async function synthesize({ text, voiceId, model, signal }) {
    const remembered = readProbe(model);
    const first = remembered || model;
    try {
        const blob = await postStRoute({ text, voiceId, model: first, signal });
        routeState.status = 'ok';
        routeState.effectiveModel = first;
        routeState.lastError = '';
        if (!remembered) writeProbe(model, first);
        return { blob, model: first };
    } catch (e) {
        if (!(e instanceof TtsError)) throw e;
        const canDowngrade = !remembered && first !== ST_FALLBACK_MODEL &&
            (e.kind === 'model-unavailable' || e.kind === 'argument');
        if (canDowngrade) {
            const blob = await postStRoute({ text, voiceId, model: ST_FALLBACK_MODEL, signal });
            console.warn(`[DES Voices] SillyTavern's Google route rejected ${first} (${e.message}); using ${ST_FALLBACK_MODEL} this session.`);
            writeProbe(model, ST_FALLBACK_MODEL);
            routeState.status = 'ok';
            routeState.effectiveModel = ST_FALLBACK_MODEL;
            routeState.lastError = '';
            return { blob, model: ST_FALLBACK_MODEL };
        }
        if (e.kind !== 'aborted') {
            routeState.status = e.kind === 'bad-key' || e.kind === 'no-key' ? e.kind : 'error';
            routeState.lastError = e.message;
        }
        throw e;
    }
}
