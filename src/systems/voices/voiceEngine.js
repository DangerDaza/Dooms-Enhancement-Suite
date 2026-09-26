/*
 * Doom's Enhancement Suite for SillyTavern — Voices: engine
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
 * Front door for DES voices (docs/google-tts-voices-plan.md §3.1).
 * Loaded on the first read; connects segmenter → presence → resolver →
 * player. Every public function here is safe to call repeatedly.
 */
import { chat, eventSource } from '../../../../../../../script.js';
import {
    extensionSettings,
    lastGeneratedData,
    committedTrackerData,
    isGenerating,
} from '../../core/state.js';
import { getActiveRemovedCharacters, getActiveBannedCharacters } from '../../core/persistence.js';
import { parseTrackerJson } from '../../utils/trackerParse.js';
import { hasPendingAliasDecision, structuralCanonical } from '../features/characterAliases.js';
import { resolveActiveUserName } from '../ui/portraitBar.js';
import { DOOMS_TRACKER_UPDATE_COMPLETE } from '../generation/apiClient.js';
import { segmentMessageForTts, bubbleIndex } from './segmenter.js';
import { normalizeSegments, dropAlreadyRead, joinSegmentText, hashText } from './segments.js';
import { trackerRawForMessage, presentNames, isPresentOnPanel } from './presence.js';
import { resolveVoice, describeReason, lookupByName } from './voiceResolver.js';
import * as player from './player.js';
import { getRouteState, getDesKey } from './transport.js';
import { stopStPlayback } from './stAutoReadGuard.js';
import { saveSettings } from '../../core/persistence.js';
import { base64ToBytes } from './wav.js';


const TOAST_TITLE = 'DES Voices';
const TRACKER_WAIT_MS = 8000;

/** Auto-read paused for this browser session (budget, bad key, blocked audio…). */
let autoReadPaused = false;
let autoReadPausedReason = '';
/** messageId → {swipeId, text}: what auto-read last read, for "continue". */
const lastRead = new Map();
/** De-duplicates auto-reads of the same text. */
const readKeys = new Set();

function voices() {
    return extensionSettings.voices || {};
}

function toast(kind, message, timeOut = 6000) {
    try { window.toastr?.[kind]?.(message, TOAST_TITLE, { timeOut }); } catch (e) { /* toast is best-effort */ }
}

function pauseAutoRead(reason) {
    if (autoReadPaused) return;
    autoReadPaused = true;
    autoReadPausedReason = reason;
    player.stop();
}

player.configurePlayer({
    onFatal(error, job) {
        const kind = error?.kind || 'unknown';
        const messages = {
            'no-key': 'No Google key found. Paste one in Settings \u2192 Voices, or add a Google AI Studio key in SillyTavern (API Connections \u2192 Google AI Studio).',
            'bad-key': getDesKey()
                ? 'Google rejected the key in Settings \u2192 Voices.'
                : 'Google rejected the Google AI Studio key saved in SillyTavern.',
            quota: 'Your Google quota for voices is used up.',
            rate: 'Google is rate-limiting voice requests, so a line was skipped.',
            autoplay: 'Your browser blocked audio. Tap any bullhorn once to allow auto-read on this device.',
            network: 'Couldn’t reach Google, so a line was skipped.',
            content: 'Google returned no audio for a line, so it was skipped.',
            'model-unavailable': 'SillyTavern couldn’t use the chosen Gemini voice model.',
            argument: `Google refused the request: ${error?.message || ''}`,
            'needs-key': 'Designed voices need your Google AI Studio key in Settings \u2192 Voices.',
            'voice-gone': 'That designed voice no longer exists on Google.',
        };
        toast(kind === 'rate' || kind === 'network' || kind === 'content' ? 'info' : 'warning',
            messages[kind] || `Couldn’t read that line: ${error?.message || kind}`);
        console.warn('[DES Voices]', kind, error?.message || error);
        if (job?.auto && ['no-key', 'bad-key', 'quota', 'autoplay'].includes(kind)) {
            pauseAutoRead(kind);
        }
    },
    onBudget() {
        pauseAutoRead('budget');
        toast('info', `Auto-read paused after ${voices().sessionRequestBudget} Google requests this session. Bullhorns still work; resume it from Settings \u2192 Voices.`, 9000);
    },
    onStateChange() {
        try { document.dispatchEvent(new CustomEvent('dooms:voices-state')); } catch (e) {}
    },
    /**
     * Google no longer has a designed voice (expired or deleted elsewhere):
     * mark it gone so every later line resolves to its fallback, tell the
     * user once, and hand the player the fallback for this line.
     */
    onVoiceGone(voiceId, seg) {
        const entry = voices().customVoices?.[voiceId];
        if (entry && entry.status !== 'gone') {
            entry.status = 'gone';
            try { saveSettings(); } catch (e) {}
            try { document.dispatchEvent(new CustomEvent('dooms:voices-registry')); } catch (e) {}
        }
        if (!goneToasts.has(voiceId)) {
            goneToasts.add(voiceId);
            const label = entry?.label ? `"${entry.label}"` : 'A designed voice';
            toast('warning', `${label} no longer exists on Google, so a standard voice is reading those lines. Recreate or re-record it from Settings \u2192 Voices \u2192 My custom voices.`, 9000);
        }
        const { ref } = resolveVoice({
            seg: { kind: 'dialogue', speaker: seg?.speaker || 'x' },
            present: true,
            ref: findRefFor(voiceId),
            narrator: voices().narratorVoice,
            caps: caps(),
        });
        return { voiceId: ref.id, voiceSource: ref.source || 'stock' };
    },
});

/** Designed voices already reported gone this session. */
const goneToasts = new Set();

/** What this device can play: the DES key, and which designed voices still exist. */
function caps() {
    return { direct: !!getDesKey(), registry: voices().customVoices || {} };
}

/** A stored ref using this voice id (for its fallbackStock), or a bare one. */
function findRefFor(voiceId) {
    const pools = [extensionSettings.characterVoices, ...Object.values(extensionSettings.userCharacters || {}).map(u => ({ v: u?.voice }))];
    for (const pool of pools) {
        for (const ref of Object.values(pool || {})) if (ref && ref.id === voiceId) return ref;
    }
    const narrator = voices().narratorVoice;
    if (narrator && narrator.id === voiceId) return narrator;
    const gender = voices().customVoices?.[voiceId]?.gender;
    return { source: 'designed', id: voiceId, fallbackStock: gender === 'female' ? 'Kore' : 'Charon' };
}

// ─── Names, presence and voices ─────────────────────────────────────────────

let canonicalMemo = new Map();

/** Alias + structural fold, read-only, memoised until invalidate(). */
function canonicalName(name) {
    if (!name) return name;
    const key = String(name);
    if (!canonicalMemo.has(key)) {
        let out = key;
        try { out = structuralCanonical(key) || key; } catch (e) { /* keep raw */ }
        canonicalMemo.set(key, out);
    }
    return canonicalMemo.get(key);
}

function lowerSet(list) {
    return new Set((Array.isArray(list) ? list : []).filter(n => typeof n === 'string').map(n => n.toLowerCase()));
}

/** Everything isPresentOnPanel needs for one message, read from DES state. */
function presenceFor(messageId) {
    const live = lastGeneratedData?.characterThoughts || committedTrackerData?.characterThoughts || null;
    const raw = Number.isInteger(messageId) ? trackerRawForMessage(chat, messageId, live) : live;
    let present = new Set();
    try {
        present = presentNames(raw, { parse: parseTrackerJson, resolveName: canonicalName, pendingAlias: hasPendingAliasDecision });
    } catch (e) {
        console.warn('[DES Voices] could not read the tracker for presence', e);
    }
    const hidden = lowerSet(getActiveRemovedCharacters());
    for (const name of lowerSet(getActiveBannedCharacters())) hidden.add(name);
    const personas = extensionSettings.userCharacters && typeof extensionSettings.userCharacters === 'object'
        ? Object.keys(extensionSettings.userCharacters) : [];
    const active = resolveActiveUserName();
    return {
        presentLower: present,
        hiddenLower: hidden,
        personaLower: lowerSet(personas),
        activePersonaLower: active ? active.toLowerCase() : null,
        showUserInPCP: !!extensionSettings.showUserInPCP,
        resolveName: canonicalName,
    };
}

/** The speaker's own voice (active campaign version for NPCs; persona voice for personas). */
function voiceFor(speaker) {
    if (!speaker) return null;
    const persona = lookupByName(extensionSettings.userCharacters, speaker);
    if (persona) return persona.voice || null;
    return lookupByName(extensionSettings.characterVoices, speaker) || null;
}

/**
 * Turns segments into a playable job: one voice per segment, by the scene rule.
 * @param {import('./segments.js').Segment[]} segments
 */
function buildJob(segments, { messageId = null, source, auto = false, highlightMessage = true }) {
    const presence = presenceFor(messageId);
    const narrator = voices().narratorVoice;
    const deviceCaps = caps();
    const jobSegments = [];
    for (const seg of segments) {
        const speaker = seg.speaker ? canonicalName(seg.speaker) : null;
        const present = speaker ? isPresentOnPanel(speaker, presence) : false;
        const { ref, reason } = resolveVoice({ seg: { ...seg, speaker }, present, ref: voiceFor(speaker), narrator, caps: deviceCaps });
        const prev = jobSegments[jobSegments.length - 1];
        // Neighbouring lines that land on the same voice (narration, then an
        // unvoiced character, then narration) are one Google request.
        if (prev && prev.voiceId === ref.id && prev.text.length + seg.text.length < 2500) {
            prev.text = `${prev.text} ${seg.text}`;
            prev.idxs.push(...(seg.idxs || []));
            continue;
        }
        jobSegments.push({ text: seg.text, voiceId: ref.id, voiceSource: ref.source || 'stock', reason, speaker, idxs: [...(seg.idxs || [])] });
    }
    if (jobSegments.length) {
        console.debug('[DES Voices] job', source, messageId,
            jobSegments.map(s => `${s.voiceId} — ${describeReason(s.reason, s.speaker)}: ${s.text.slice(0, 40)}`));
    }
    return player.newJob({ messageId, source, auto, highlightMessage, segments: jobSegments });
}

function play(job) {
    if (!job.segments.length) return;
    stopStPlayback();
    if (job.auto) player.enqueue(job);
    else player.replaceWith(job);
}

/** A bullhorn clicked while its own job is playing acts as Stop. */
function toggleIfSame(source, messageId, key = null) {
    const cur = player.getCurrentJob();
    if (cur && !cur.auto && cur.source === source && cur.messageId === messageId && (cur.key ?? null) === key) {
        player.stop();
        return true;
    }
    return false;
}

// ─── Entry points ───────────────────────────────────────────────────────────

/** The whole message (DES message bullhorn). Works with bubbles on or off. */
export function speakMessage(messageId) {
    if (toggleIfSame('message', messageId)) return;
    const segments = segmentMessageForTts(messageId, { includeUser: true, resolveSpeaker: canonicalName });
    if (!segments.length) { toast('info', 'Nothing to read in that message.', 3000); return; }
    play(buildJob(segments, { messageId, source: 'message' }));
}

/** Bubble "read from here". */
export function speakFromBubble(bubbleEl) {
    const mes = bubbleEl?.closest('.mes');
    const messageId = mes ? parseInt(mes.getAttribute('mesid'), 10) : NaN;
    if (!Number.isFinite(messageId)) return;
    const fromIdx = Math.max(0, bubbleIndex(bubbleEl));
    if (toggleIfSame('bubble', messageId, fromIdx)) return;
    const segments = segmentMessageForTts(messageId, { fromIdx, resolveSpeaker: canonicalName });
    const job = buildJob(segments, { messageId, source: 'bubble' });
    job.key = fromIdx;
    play(job);
}

/** Inline thought bullhorn: the thinking character's voice if they're present, else the Narrator. */
export function speakThought(thoughtEl) {
    const mes = thoughtEl?.closest('.mes');
    const messageId = mes ? parseInt(mes.getAttribute('mesid'), 10) : null;
    const who = thoughtEl?.getAttribute('data-character') || '';
    const text = thoughtEl?.querySelector('.dooms-inline-thought-content')?.textContent || '';
    const id = Number.isFinite(messageId) ? messageId : null;
    if (toggleIfSame('thought', id, who)) return;
    const segments = normalizeSegments([{ speaker: who || null, kind: 'thought', text }], { resolveSpeaker: canonicalName });
    const job = buildJob(segments, { messageId: id, source: 'thought', highlightMessage: false });
    job.key = who;
    play(job);
}

/** Reasoning / thinking panel: always the Narrator. */
export function speakReasoning(messageId, text) {
    if (toggleIfSame('reasoning', messageId)) return;
    const segments = normalizeSegments([{ speaker: null, kind: 'narration', text }]);
    play(buildJob(segments, { messageId, source: 'reasoning', highlightMessage: false }));
}

/**
 * Plays a sample in a given voice (Workshop and settings previews). Works
 * whether or not DES voices are switched on.
 * @param {{id: string, source?: string}} ref
 * @param {string} text
 */
export function audition(ref, text) {
    if (!ref || !ref.id) return;
    const cur = player.getCurrentJob();
    if (cur && cur.source === 'audition' && cur.key === ref.id) { player.stop(); return; }
    const segments = normalizeSegments([{ speaker: null, kind: 'narration', text: text || `Hello, I'm ${ref.id}.` }]);
    const job = player.newJob({
        source: 'audition',
        key: ref.id,
        segments: segments.map(s => ({ text: s.text, voiceId: ref.id, voiceSource: ref.source || 'stock', reason: 'audition', speaker: null, idxs: [] })),
    });
    stopStPlayback();
    player.replaceWith(job);
}

/**
 * Plays audio Google already returned (a designed voice's sample) — no
 * request. Toggles off when the same sample is playing.
 * @param {string} key - usually the voice id
 * @param {{mimeType: string, data: string}} sample - base64 audio
 */
export function playSample(key, sample) {
    if (!sample || !sample.data) return;
    const cur = player.getCurrentJob();
    if (cur && cur.source === 'audition' && cur.key === key) { player.stop(); return; }
    const blob = new Blob([base64ToBytes(sample.data)], { type: sample.mimeType || 'audio/wav' });
    const url = player.urlForBlob(blob, `sample:${key}`);
    const job = player.newJob({
        source: 'audition',
        key,
        segments: [{ text: '', voiceId: key, voiceSource: 'designed', reason: 'audition', speaker: null, idxs: [], url }],
    });
    stopStPlayback();
    player.replaceWith(job);
}

/** Stops a preview if one is playing (closing the Workshop). */
export function stopAudition() {
    player.stopAuditions();
}

/** Is an audition of this voice playing? (for ▶/■ toggles) */
export function isAuditioning(voiceId) {
    const cur = player.getCurrentJob();
    return !!cur && cur.source === 'audition' && cur.key === voiceId;
}

function waitForTrackerUpdate() {
    return new Promise((resolve) => {
        let done = false;
        const finish = () => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            try { eventSource.removeListener(DOOMS_TRACKER_UPDATE_COMPLETE, finish); } catch (e) {}
            resolve();
        };
        const timer = setTimeout(finish, TRACKER_WAIT_MS);
        eventSource.on(DOOMS_TRACKER_UPDATE_COMPLETE, finish);
    });
}

/**
 * Auto-read one freshly generated (or user-sent) message. Called from
 * voiceBoot once the message has been decorated.
 * @param {number} messageId
 * @param {string} type - SillyTavern generation type ('normal', 'swipe', 'continue', …) or 'user'
 */
export async function autoReadMessage(messageId, type) {
    if (autoReadPaused || !voices().enabled || !voices().autoRead) return;
    const msg = Array.isArray(chat) ? chat[messageId] : null;
    if (!msg || msg.is_system) return;
    if (msg.is_user && type !== 'user') return;

    // Separate/external tracker mode: the scene data lands after the message.
    // Wait for it (up to 8 s) so presence reflects this reply.
    const mode = extensionSettings.generationMode;
    if (!msg.is_user && (mode === 'separate' || mode === 'external') && extensionSettings.autoUpdate && isGenerating) {
        await waitForTrackerUpdate();
        if (!voices().enabled || !voices().autoRead) return;
    }

    let segments = segmentMessageForTts(messageId, { includeUser: type === 'user', resolveSpeaker: canonicalName });
    const swipeId = msg.swipe_id || 0;
    const fullText = joinSegmentText(segments);
    const readKey = `${messageId}:${swipeId}:${hashText(fullText)}`;
    if (readKeys.has(readKey)) return;
    readKeys.add(readKey);
    if (type === 'continue') {
        const prev = lastRead.get(messageId);
        if (prev && prev.swipeId === swipeId) segments = dropAlreadyRead(segments, prev.text);
    }
    lastRead.set(messageId, { swipeId, text: fullText });
    if (!segments.length) return;
    play(buildJob(segments, { messageId, source: 'auto', auto: true }));
}

// ─── Lifecycle ──────────────────────────────────────────────────────────────

export function stop(_reason) {
    player.stop();
}

/** The user pressed Stop mid-generation: drop any queued auto-read of the last message. */
export function onGenerationStopped() {
    const lastId = Array.isArray(chat) ? chat.length - 1 : -1;
    if (lastId >= 0) player.dropMessage(lastId);
}

export function onChatChanged() {
    lastRead.clear();
    readKeys.clear();
    player.clearChatCache();
    invalidate();
}

/** Voices or aliases may have changed (Workshop save, campaign switch). */
export function invalidate() {
    canonicalMemo = new Map();
}

/** For the settings status line. */
export function getStatus() {
    return {
        route: getRouteState(),
        requests: player.getSessionRequestCount(),
        playing: player.isPlaying(),
        autoReadPaused,
        autoReadPausedReason,
    };
}

/** Lets the user resume auto-read after it paused itself (settings button). */
export function resumeAutoRead() {
    autoReadPaused = false;
    autoReadPausedReason = '';
    player.resetBudgetWindow();
}
