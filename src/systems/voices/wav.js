/*
 * Doom's Enhancement Suite for SillyTavern — Voices: WAV wrapping
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
 * Gemini TTS returns raw 16-bit mono PCM ("audio/L16;codec=pcm;rate=24000"),
 * which browsers can't play as-is. SillyTavern wraps it in a WAV header on
 * its server; when DES calls Google directly it does the same here.
 * Pure — no browser APIs — so it's unit-tested in Node.
 */

/** Sample rate from a mimeType like "audio/L16;codec=pcm;rate=24000". */
export function sampleRateFromMime(mimeType, fallback = 24000) {
    const m = /rate=(\d+)/i.exec(String(mimeType || ''));
    const rate = m ? parseInt(m[1], 10) : NaN;
    return Number.isFinite(rate) && rate > 0 ? rate : fallback;
}

/** True when the mimeType is headerless PCM that needs wrapping. */
export function isRawPcm(mimeType) {
    return /audio\/l16|codec=pcm/i.test(String(mimeType || ''));
}

/**
 * @param {Uint8Array} pcm - 16-bit little-endian mono samples (as Gemini and SillyTavern treat them)
 * @param {number} sampleRate
 * @returns {Uint8Array} a complete WAV file
 */
export function pcm16ToWav(pcm, sampleRate = 24000) {
    const dataLength = pcm.length - (pcm.length % 2);
    const out = new Uint8Array(44 + dataLength);
    const view = new DataView(out.buffer);
    const writeStr = (offset, str) => { for (let i = 0; i < str.length; i++) out[offset + i] = str.charCodeAt(i); };
    writeStr(0, 'RIFF');
    view.setUint32(4, 36 + dataLength, true);
    writeStr(8, 'WAVE');
    writeStr(12, 'fmt ');
    view.setUint32(16, 16, true);          // fmt chunk size
    view.setUint16(20, 1, true);           // PCM
    view.setUint16(22, 1, true);           // mono
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true); // byte rate
    view.setUint16(32, 2, true);           // block align
    view.setUint16(34, 16, true);          // bits per sample
    writeStr(36, 'data');
    view.setUint32(40, dataLength, true);
    out.set(pcm.subarray(0, dataLength), 44);
    return out;
}

/** base64 → bytes (atob exists in browsers and Node ≥16). */
export function base64ToBytes(b64) {
    const bin = atob(String(b64 || ''));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
}

/**
 * Float samples (-1…1) → 16-bit little-endian PCM bytes, clipped.
 * @param {Float32Array} samples
 * @returns {Uint8Array}
 */
export function floatToPcm16(samples) {
    const out = new Uint8Array(samples.length * 2);
    const view = new DataView(out.buffer);
    for (let i = 0; i < samples.length; i++) {
        const s = Math.max(-1, Math.min(1, samples[i]));
        view.setInt16(i * 2, s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff), true);
    }
    return out;
}

/** Bytes → base64 in chunks (String.fromCharCode on a whole clip overflows the stack). */
export function bytesToBase64(bytes) {
    let binary = '';
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
    }
    return btoa(binary);
}
