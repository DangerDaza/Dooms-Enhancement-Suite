/*
 * Doom's Enhancement Suite for SillyTavern — Voices: connections
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
 * Which voice service plays a line, and whether any is connected
 * (docs/tts-connections-plan.md §4). Pure: callers pass the voices settings
 * and SillyTavern's secret state, so the Node tests can run this.
 *
 * Services today:
 * - 'google': Google AI Studio, with the key in DES (browser → Google) or the
 *   key saved in SillyTavern (through SillyTavern's server).
 * - 'openrouter': OpenRouter's speech API, with the key in DES (browser →
 *   OpenRouter) or saved in SillyTavern's "Custom OpenAI TTS" slot (through
 *   SillyTavern's OpenAI Compatible route).
 */
import { pcm16ToWav, sampleRateFromMime } from './wav.js';

export const OPENROUTER_SPEECH_URL = 'https://openrouter.ai/api/v1/audio/speech';

/**
 * The audio format DES asks OpenRouter for. Gemini TTS answers raw PCM and
 * nothing else: asked for mp3, OpenRouter refuses the request with a 400
 * ('Gemini TTS only supports response_format="pcm"'). The answer is 16-bit
 * little-endian mono, which openRouterAudio wraps as a WAV file to play.
 */
export const OPENROUTER_FORMAT = 'pcm';

/** SillyTavern secret slots DES looks at. */
export const ST_SECRET = Object.freeze({
    google: 'api_key_makersuite',
    customTts: 'api_key_custom_openai_tts',
});

export const PROVIDER_LABELS = Object.freeze({
    google: 'Google',
    openrouter: 'OpenRouter',
});

/** A secret slot in SillyTavern's state has at least one saved key. */
export function stHasSecret(secretState, key) {
    const entry = secretState ? secretState[key] : null;
    if (Array.isArray(entry)) return entry.length > 0;
    return !!entry;
}

export function isGoogleConnected(v, secretState) {
    return !!String(v?.googleApiKey || '').trim() || stHasSecret(secretState, ST_SECRET.google);
}

export function isOpenRouterConnected(v, secretState) {
    if (String(v?.openrouterKey || '').trim()) return true;
    // Server route only, with the key saved in SillyTavern.
    return v?.openrouterRoute === 'server' && stHasSecret(secretState, ST_SECRET.customTts);
}

export function isConnected(provider, v, secretState) {
    if (provider === 'google') return isGoogleConnected(v, secretState);
    if (provider === 'openrouter') return isOpenRouterConnected(v, secretState);
    return false;
}

export function anyConnected(v, secretState) {
    return isGoogleConnected(v, secretState) || isOpenRouterConnected(v, secretState);
}

/** The service standard Gemini voices go through ('google' | 'openrouter'). */
export function geminiVia(v) {
    return v?.geminiVia === 'openrouter' ? 'openrouter' : 'google';
}

/**
 * The service that plays this voice. A ref may name its provider; without
 * one, designed and cloned voices are Google's (they live in a Google
 * project and only work with a Google key), and standard Gemini voices go
 * through whichever service "Gemini voices via" picks.
 * @param {{provider?: string, source?: string}} ref
 */
export function providerFor(ref, v) {
    if (ref?.provider === 'google' || ref?.provider === 'openrouter') return ref.provider;
    const source = ref?.source || 'stock';
    if (source !== 'stock') return 'google';
    return geminiVia(v);
}

/** OpenRouter's id for a Gemini TTS model ('gemini-3.8-flash-lite-tts' → 'google/…'). */
export function openRouterModel(model) {
    const m = String(model || 'gemini-3.8-flash-lite-tts');
    return m.includes('/') ? m : `google/${m}`;
}

/**
 * The JSON body for OpenRouter's /audio/speech. The delivery note rides in
 * Google's provider options (OpenRouter TTS guide).
 */
export function openRouterBody({ text, voiceId, model, style }) {
    const body = {
        model: openRouterModel(model),
        input: String(text || ''),
        voice: voiceId,
        response_format: OPENROUTER_FORMAT,
    };
    if (style) {
        body.provider = { options: { 'google-ai-studio': { speech_metadata: { style } } } };
    }
    return body;
}

/** A file's own type, read from its first bytes; '' for bytes that carry no header, which is what raw PCM is. */
export function audioSignature(bytes) {
    const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(0);
    const at = (offset, word) => b.length >= offset + word.length && [...word].every((ch, i) => b[offset + i] === ch.charCodeAt(0));
    if (at(0, 'RIFF') && at(8, 'WAVE')) return 'audio/wav';
    if (at(0, 'ID3')) return 'audio/mpeg';
    if (at(0, 'OggS')) return 'audio/ogg';
    if (at(0, 'fLaC')) return 'audio/flac';
    return '';
}

/**
 * OpenRouter's answer as audio a browser can play. DES asks for raw PCM
 * (OPENROUTER_FORMAT), so bytes with no header of their own are 16-bit
 * little-endian mono samples and are wrapped as a WAV file: at the rate
 * the Content-Type names when it names one, else Gemini's 24 kHz. A file
 * that names itself (a WAV, an MP3 with its tag, Ogg, FLAC) is played as
 * what it is.
 *
 * The Content-Type counts only when the answer came straight from
 * OpenRouter (`direct`): SillyTavern's server route marks everything it
 * relays "audio/mpeg" whatever it is, so there the bytes alone decide.
 * @param {Uint8Array} bytes
 * @param {string} contentType  the response's Content-Type
 * @param {{ direct?: boolean }} [o]
 * @returns {{ bytes: Uint8Array, type: string }}
 */
export function openRouterAudio(bytes, contentType = '', { direct = false } = {}) {
    const own = audioSignature(bytes);
    if (own) return { bytes, type: own };
    const named = String(contentType || '').split(';')[0].trim().toLowerCase();
    // A compressed type OpenRouter itself names (a model that answers mp3 whatever is asked): played as it says.
    if (direct && /^audio\/(mpeg|mp3|mp4|aac|ogg|opus|webm|flac|wav|wave|x-wav)$/.test(named)) return { bytes, type: named };
    return { bytes: pcm16ToWav(bytes, sampleRateFromMime(contentType)), type: 'audio/wav' };
}

/**
 * Buckets an OpenRouter error into DES's error kinds (see transport.js
 * classifyError): 401/403 → bad-key, 402 → quota (out of credits),
 * 429 → rate, 404 → model-unavailable, 400 → argument.
 */
export function classifyOpenRouterError(status, message = '') {
    const text = String(message || '').toLowerCase();
    if (status === 0) return 'network';
    if (status === 401 || status === 403 || /invalid api key|no auth|user not found|unauthori[sz]ed/.test(text)) return 'bad-key';
    if (status === 402 || /insufficient credits|more credits|payment required/.test(text)) return 'quota';
    if (status === 429 || /rate limit|too many requests/.test(text)) return 'rate';
    if (status === 404 || /no endpoints found|model .*not found|not a valid model/.test(text)) return 'model-unavailable';
    if (status === 400 || /invalid|unknown|unsupported/.test(text)) return 'argument';
    return 'unknown';
}

/** Google's complaint is about the style note (so retry without it). */
export function isStyleComplaint(message) {
    return /speech_metadata|provider\.options|options|style/i.test(String(message || ''));
}
