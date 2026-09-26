/*
 * Doom's Enhancement Suite for SillyTavern — Voices: preparing recordings
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
 * Turns a recording or an uploaded file into what Google's voice cloning
 * recommends: 24 kHz mono 16-bit WAV (docs/google-tts-voices-plan.md §8.4).
 * Browser-only (Web Audio). Nothing here is ever stored.
 */
import { floatToPcm16, pcm16ToWav, bytesToBase64 } from './wav.js';

export const TARGET_RATE = 24000;

/**
 * @param {Blob} blob - any audio the browser can decode (WAV, MP3, the recorder's WebM/Ogg…)
 * @returns {Promise<{duration: number, peak: number, wav: Uint8Array, base64: string}>}
 */
export async function prepareClip(blob) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx || !window.OfflineAudioContext) throw new Error('This browser can’t process audio.');
    const bytes = await blob.arrayBuffer();
    const ctx = new Ctx();
    let decoded;
    try {
        decoded = await ctx.decodeAudioData(bytes.slice(0));
    } catch (e) {
        throw new Error('That file isn’t audio this browser can read. Try a WAV or MP3.');
    } finally {
        try { ctx.close(); } catch (e) {}
    }
    const frames = Math.max(1, Math.ceil(decoded.duration * TARGET_RATE));
    // Rendering a mono context from a multi-channel buffer mixes it down.
    const offline = new OfflineAudioContext(1, frames, TARGET_RATE);
    const src = offline.createBufferSource();
    src.buffer = decoded;
    src.connect(offline.destination);
    src.start();
    const rendered = await offline.startRendering();
    const samples = rendered.getChannelData(0);
    let peak = 0;
    for (let i = 0; i < samples.length; i++) {
        const a = Math.abs(samples[i]);
        if (a > peak) peak = a;
    }
    const wav = pcm16ToWav(floatToPcm16(samples), TARGET_RATE);
    return { duration: decoded.duration, peak, wav, base64: bytesToBase64(wav) };
}

/** Can this page record from the microphone? (needs HTTPS or localhost) */
export function canRecord() {
    return !!(window.isSecureContext && navigator.mediaDevices?.getUserMedia && window.MediaRecorder);
}

/**
 * Starts recording from the microphone.
 * @param {{maxSeconds?: number, onTick?: (seconds: number) => void, onStop?: (blob: Blob) => void}} opts
 * @returns {Promise<{stop: () => void}>}
 */
export async function startRecording({ maxSeconds = 30, onTick, onStop } = {}) {
    const stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: true },
    });
    const recorder = new MediaRecorder(stream);
    const chunks = [];
    const started = Date.now();
    let timer = null;
    let stopped = false;
    const stop = () => {
        if (stopped) return;
        stopped = true;
        clearInterval(timer);
        try { if (recorder.state !== 'inactive') recorder.stop(); } catch (e) {}
    };
    recorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    recorder.onstop = () => {
        stream.getTracks().forEach(t => t.stop());
        onStop?.(new Blob(chunks, { type: recorder.mimeType || 'audio/webm' }));
    };
    recorder.start(250);
    timer = setInterval(() => {
        const s = (Date.now() - started) / 1000;
        onTick?.(s);
        if (s >= maxSeconds) stop();
    }, 200);
    return { stop };
}
