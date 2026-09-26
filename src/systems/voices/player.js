/*
 * Doom's Enhancement Suite for SillyTavern — Voices: playback queue
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
 * Plays DES voice jobs (docs/google-tts-voices-plan.md §9).
 *
 * - One DES <audio> element (#dooms-tts-audio); SillyTavern's #tts_audio is
 *   never touched.
 * - One Google request in flight: line k+1 is fetched while line k plays.
 * - A bullhorn click replaces whatever is playing; auto-read jobs queue up
 *   first-in first-out, so a group chat's replies are read in order.
 * - The line being read is highlighted and the highlight is always removed
 *   when it ends, stops or fails.
 * - Audio is cached in memory, so re-reading a line costs nothing.
 *
 * @typedef {{text: string, voiceId: string, reason: string, speaker: string|null, idxs: number[]}} JobSegment
 * @typedef {{id: number, messageId: number|null, source: string, auto: boolean, segments: JobSegment[],
 *            highlightMessage?: boolean, controller?: AbortController}} Job
 */
import { extensionSettings } from '../../core/state.js';
import { synthesize, TtsError } from './transport.js';
import { getVoicesAudioElement } from './voiceBoot.js';

const CACHE_MAX_ENTRIES = 150;
const RATE_BACKOFF_MS = [2000, 4000, 8000];

/** @type {Job[]} */
let queue = [];
/** @type {Job|null} */
let current = null;
let running = false;
let nextJobId = 1;
let audioEl = null;
let sessionRequests = 0;
let budgetStart = 0; // the auto-read budget counts from here (reset on resume)
let consecutiveRateGiveUps = 0;
const cache = new Map(); // key -> {url, audition}
const hooks = { onFatal: null, onBudget: null, onStateChange: null };

export function configurePlayer(options) {
    Object.assign(hooks, options || {});
}

export function getSessionRequestCount() {
    return sessionRequests;
}

/** Starts a fresh auto-read budget window (after the user resumes auto-read). */
export function resetBudgetWindow() {
    budgetStart = sessionRequests;
}

export function isPlaying() {
    return running && !!current;
}

/** The job being played, if any. */
export function getCurrentJob() {
    return current;
}

export function newJob(fields) {
    return { id: nextJobId++, messageId: null, source: 'manual', auto: false, segments: [], ...fields };
}

function voices() {
    return extensionSettings.voices || {};
}

function ensureAudio() {
    audioEl = getVoicesAudioElement();
    return audioEl;
}

// ─── Highlighting ───────────────────────────────────────────────────────────

let highlighted = [];

function clearHighlight() {
    for (const el of highlighted) {
        el.classList.remove('dooms-tts-speaking', 'dooms-tts-loading', 'tts-speaking', 'dooms-bubble-tts-speaking');
    }
    highlighted = [];
}

/** Resolved at play time: bubbles are rebuilt ~800 ms after render, so stored elements go stale. */
function highlightTargets(job, seg) {
    if (job.messageId === null || job.messageId === undefined) return [];
    const mes = document.querySelector(`#chat .mes[mesid="${job.messageId}"]`);
    if (!mes) return [];
    const targets = [];
    if (seg.idxs && seg.idxs.length) {
        const bubbles = mes.querySelectorAll('.dooms-bubbles .dooms-bubble:not(.dooms-bubble-user), .dooms-bubbles .dooms-card:not(.dooms-card-user)');
        for (const idx of seg.idxs) if (bubbles[idx]) targets.push(bubbles[idx]);
    }
    if (!targets.length && job.highlightMessage !== false) targets.push(mes);
    return targets;
}

function setHighlight(job, seg, cls) {
    clearHighlight();
    const targets = highlightTargets(job, seg);
    for (const el of targets) el.classList.add(cls);
    // Legacy class on the message, for anything that looked for SillyTavern's.
    if (cls === 'dooms-tts-speaking' && job.messageId !== null && job.messageId !== undefined) {
        const mes = document.querySelector(`#chat .mes[mesid="${job.messageId}"]`);
        if (mes) { mes.classList.add('tts-speaking'); targets.push(mes); }
    }
    highlighted = targets;
}

// ─── Cache ──────────────────────────────────────────────────────────────────

function cacheKey(model, voiceId, text) {
    return `${model}\u0001${voiceId}\u0001${text}`;
}

function cacheGet(key) {
    const hit = cache.get(key);
    if (!hit) return null;
    cache.delete(key);
    cache.set(key, hit); // LRU: most recent last
    return hit.url;
}

function cachePut(key, blob, audition) {
    const url = URL.createObjectURL(blob);
    cache.set(key, { url, audition: !!audition });
    while (cache.size > CACHE_MAX_ENTRIES) {
        const [oldKey, oldVal] = cache.entries().next().value;
        cache.delete(oldKey);
        const inUse = audioEl && audioEl.src === oldVal.url;
        if (!inUse) URL.revokeObjectURL(oldVal.url);
    }
    return url;
}

/** Drops chat lines from the cache (on chat change); auditions stay. */
export function clearChatCache() {
    for (const [key, val] of [...cache.entries()]) {
        if (val.audition) continue;
        cache.delete(key);
        if (!(audioEl && audioEl.src === val.url)) URL.revokeObjectURL(val.url);
    }
}

// ─── Fetching ───────────────────────────────────────────────────────────────

const sleep = (ms, signal) => new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener?.('abort', () => { clearTimeout(t); reject(new TtsError('aborted', 'Stopped')); }, { once: true });
});

async function fetchSegment(job, seg, signal) {
    const model = voices().model;
    const key = cacheKey(model, seg.voiceId, seg.text);
    const hit = cacheGet(key);
    if (hit) return hit;
    if (job.auto) {
        const budget = Number(voices().sessionRequestBudget) || 0;
        if (budget > 0 && sessionRequests - budgetStart >= budget) {
            throw new TtsError('budget', 'Session request budget reached');
        }
    }
    for (let attempt = 0; ; attempt++) {
        if (signal.aborted) throw new TtsError('aborted', 'Stopped');
        sessionRequests++;
        hooks.onStateChange?.();
        try {
            const { blob } = await synthesize({ text: seg.text, voiceId: seg.voiceId, model, signal, connection: job.connection });
            consecutiveRateGiveUps = 0;
            return cachePut(key, blob, job.source === 'audition');
        } catch (e) {
            if (e instanceof TtsError && e.kind === 'rate' && attempt < RATE_BACKOFF_MS.length) {
                await sleep(RATE_BACKOFF_MS[attempt], signal);
                continue;
            }
            if (e instanceof TtsError && e.kind === 'rate') consecutiveRateGiveUps++;
            throw e;
        }
    }
}

// ─── Playing ────────────────────────────────────────────────────────────────

function playUrl(url, signal) {
    const el = ensureAudio();
    return new Promise((resolve) => {
        const done = (result) => {
            el.removeEventListener('ended', onEnded);
            el.removeEventListener('error', onError);
            signal.removeEventListener('abort', onAbort);
            resolve(result);
        };
        const onEnded = () => done('ended');
        const onError = () => done('error');
        const onAbort = () => { try { el.pause(); } catch (e) {} done('aborted'); };
        el.addEventListener('ended', onEnded);
        el.addEventListener('error', onError);
        signal.addEventListener('abort', onAbort, { once: true });
        el.src = url;
        el.playbackRate = Math.min(2, Math.max(0.5, Number(voices().playbackRate) || 1));
        const p = el.play();
        if (p && typeof p.catch === 'function') {
            p.catch((err) => {
                done(err && err.name === 'NotAllowedError' ? 'blocked' : 'error');
            });
        }
    });
}

async function playJob(job) {
    const controller = new AbortController();
    job.controller = controller;
    const { signal } = controller;
    let reported = false;
    const report = (e) => {
        if (reported || !e || e.kind === 'aborted') return;
        reported = true;
        hooks.onFatal?.(e, job);
    };
    const fetchAt = (i) => {
        const seg = job.segments[i];
        const p = fetchSegment(job, seg, signal);
        p.catch(() => {}); // handled when awaited
        return p;
    };
    let pending = job.segments.length ? fetchAt(0) : null;
    for (let i = 0; i < job.segments.length; i++) {
        const seg = job.segments[i];
        setHighlight(job, seg, 'dooms-tts-loading');
        let url = null;
        try {
            url = await pending;
        } catch (e) {
            if (signal.aborted || e?.kind === 'aborted') break;
            if (e?.kind === 'budget') { hooks.onBudget?.(); break; }
            report(e);
            // A bad or missing key fails every line the same way; stop now.
            if (e?.kind === 'no-key' || e?.kind === 'bad-key' || e?.kind === 'quota') break;
            if (e?.kind === 'rate' && consecutiveRateGiveUps >= 2) break;
        }
        if (signal.aborted) break;
        pending = i + 1 < job.segments.length ? fetchAt(i + 1) : null;
        if (!url) continue;
        setHighlight(job, seg, 'dooms-tts-speaking');
        const result = await playUrl(url, signal);
        if (result === 'aborted') break;
        if (result === 'blocked') {
            report(new TtsError('autoplay', 'The browser blocked audio playback'));
            break;
        }
    }
    clearHighlight();
}

async function runQueue() {
    if (running) return;
    running = true;
    hooks.onStateChange?.();
    try {
        while (queue.length) {
            current = queue[0];
            await playJob(current);
            if (queue[0] === current) queue.shift();
        }
    } finally {
        current = null;
        running = false;
        clearHighlight();
        hooks.onStateChange?.();
    }
}

/** Stops everything and plays this job now (bullhorn clicks, auditions). */
export function replaceWith(job) {
    stop();
    queue = [job];
    runQueue();
}

/** Adds an auto-read job; a newer job for the same message replaces the older one. */
export function enqueue(job) {
    if (job.messageId !== null && job.messageId !== undefined) dropMessage(job.messageId);
    queue.push(job);
    runQueue();
}

/** Removes queued (and stops playing) jobs for one message. */
export function dropMessage(messageId) {
    if (current && current.messageId === messageId) current.controller?.abort();
    queue = queue.filter(j => j === current || j.messageId !== messageId);
}

/** Stops playback and clears the queue. */
export function stop() {
    const playing = current;
    queue = [];
    if (playing) playing.controller?.abort();
    try { if (audioEl) audioEl.pause(); } catch (e) {}
    clearHighlight();
}

/** Stops only auditions (closing the Workshop). */
export function stopAuditions() {
    if (current && current.source === 'audition') stop();
}
