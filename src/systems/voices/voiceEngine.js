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
import { styleForSegment, baseStyle, anchorForVoice, styleWithAnchor } from './delivery.js';
import { steadinessTemperature } from './voiceSettings.js';
import { providerForRef, isProviderConnected, anyProviderConnected } from './providers.js';
import { PROVIDER_LABELS } from './connections.js';
import { getOpenRouterState } from './openrouter.js';


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
        if (error?.provider === 'openrouter') {
            const orMessages = {
                'no-key': error?.message || 'Paste your OpenRouter key in Settings \u2192 Voices.',
                'bad-key': 'OpenRouter rejected the key in Settings \u2192 Voices.',
                quota: 'Your OpenRouter credits have run out. Add credits at openrouter.ai, then try again.',
                rate: 'OpenRouter is rate-limiting voice requests, so a line was skipped.',
                network: 'Couldn’t reach OpenRouter, even after a retry, so a line was skipped.',
                'openrouter-blocked': 'Your browser couldn’t reach OpenRouter directly. In Settings \u2192 Voices \u2192 OpenRouter, press \u201cSave key to SillyTavern\u201d so DES can go through SillyTavern’s server.',
                timeout: `${error?.message || 'OpenRouter took too long to answer'}, so a line was skipped.`,
                content: 'OpenRouter returned no audio for a line, so it was skipped.',
                'model-unavailable': 'OpenRouter doesn’t offer the chosen voice model right now. Pick the other model in Settings \u2192 Voices.',
                playback: `${error?.message || 'Your browser couldn\u2019t play the audio'}. OpenRouter answered, but the browser refused the sound it sent back; check the browser console for details.`,
                argument: `OpenRouter refused the request. ${error?.message || ''}`,
            };
            toast(['rate', 'network', 'timeout', 'content'].includes(kind) ? 'info' : 'warning',
                orMessages[kind] || `Couldn’t read that line. ${error?.message || kind}`, kind === 'openrouter-blocked' ? 12000 : 6000);
            console.warn('[DES Voices] OpenRouter', kind, error?.message || error);
            if (job?.auto && ['no-key', 'bad-key', 'quota', 'autoplay', 'openrouter-blocked'].includes(kind)) pauseAutoRead(kind);
            return;
        }
        const messages = {
            'no-key': 'No Google key found. Paste one in Settings \u2192 Voices, or add a Google AI Studio key in SillyTavern (API Connections \u2192 Google AI Studio).',
            'bad-key': getDesKey()
                ? 'Google rejected the key in Settings \u2192 Voices.'
                : 'Google rejected the Google AI Studio key saved in SillyTavern.',
            quota: 'Your Google quota for voices is used up.',
            rate: 'Google is rate-limiting voice requests, so a line was skipped.',
            autoplay: 'Your browser blocked audio. Tap any bullhorn once to allow auto-read on this device.',
            playback: `${error?.message || 'Your browser couldn’t play the audio'}. The voice service answered, but the browser refused the sound it sent back; check the browser console for details.`,
            network: 'Couldn’t reach Google, even after a retry, so a line was skipped. Check your connection, or whether something is blocking googleapis.com.',
            timeout: `${error?.message || 'Google took too long to answer'}, so a line was skipped. Long lines take the longest.`,
            content: 'Google returned no audio for a line, so it was skipped.',
            'model-unavailable': 'SillyTavern couldn’t use the chosen Gemini voice model.',
            argument: `Google refused the request: ${error?.message || ''}`,
            'needs-key': 'Designed voices need your Google AI Studio key in Settings \u2192 Voices.',
            'voice-gone': 'That designed voice no longer exists on Google.',
        };
        toast(kind === 'rate' || kind === 'network' || kind === 'timeout' || kind === 'content' ? 'info' : 'warning',
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
        return { voiceId: ref.id, voiceSource: ref.source || 'stock', provider: routeFor(ref) };
    },
});

/** "No voice service connected" is said once per session. */
let toldNotConnected = false;

/** False (and says why, once) when no voice service is set up. */
function ensureConnected() {
    if (anyProviderConnected()) return true;
    if (!toldNotConnected) {
        toldNotConnected = true;
        toast('info', 'No voice service is connected yet. Settings \u2192 Voices explains the options (OpenRouter, Google and more).', 9000);
    }
    return false;
}

/**
 * The service that plays this ref. If that service isn't set up here but
 * the other one is, standard Gemini voices use the other one — both carry
 * the same 30 voices.
 */
function routeFor(ref) {
    const provider = providerForRef(ref);
    if (isProviderConnected(provider)) return provider;
    if ((ref?.source || 'stock') === 'stock') {
        const other = provider === 'google' ? 'openrouter' : 'google';
        if (isProviderConnected(other)) return other;
    }
    return provider;
}

/** Can this service carry the delivery note? (Google: only with the key in DES.) */
function styleCapable(provider) {
    return provider === 'openrouter' ? true : !!getDesKey();
}

/**
 * The Steadiness temperature for a line on this service, or null: only
 * Google's direct route (the key in DES) has a field for it.
 */
function temperatureFor(provider) {
    return provider === 'google' && getDesKey() ? steadinessTemperature(voices()) : null;
}

/**
 * The anchor for a designed voice's line (Settings → Voices → Anchor
 * designed voices to their description), or '' for stock and cloned
 * voices, the switch off, or a route with no style field. Designed voices
 * only play on Google's direct route, so the style always has somewhere to go.
 */
function anchorFor(ref, provider) {
    if (!ref || (ref.source || 'stock') === 'stock' || voices().anchorDesignedVoices === false) return '';
    if (!styleCapable(provider)) return '';
    return anchorForVoice(voices().customVoices?.[ref.id]);
}

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
    const note = voices().deliveryNote;
    if (!ensureConnected()) return player.newJob({ messageId, source, auto, highlightMessage, segments: [] });
    for (let i = 0; i < segments.length; i++) {
        const seg = segments[i];
        const speaker = seg.speaker ? canonicalName(seg.speaker) : null;
        const present = speaker ? isPresentOnPanel(speaker, presence) : false;
        const { ref, reason } = resolveVoice({ seg: { ...seg, speaker }, present, ref: voiceFor(speaker), narrator, caps: deviceCaps });
        const provider = routeFor(ref);
        // Only some routes can carry a delivery note; elsewhere it would
        // only split requests for nothing.
        const anchor = anchorFor(ref, provider);
        // The anchor lives inside the style, so the cache key and the merge
        // below see it like any other style difference.
        const style = styleWithAnchor(styleCapable(provider) ? styleForSegment(segments, i, note, { neverWhisper: !!voices().neverWhisper }) : '', anchor);
        const prev = jobSegments[jobSegments.length - 1];
        // Neighbouring lines that land on the same voice (narration, then an
        // unvoiced character, then narration) are one Google request —
        // unless one of them is whispered and the other isn't.
        if (prev && prev.voiceId === ref.id && prev.provider === provider && prev.style === style && prev.text.length + seg.text.length < 2500) {
            prev.text = `${prev.text} ${seg.text}`;
            prev.idxs.push(...(seg.idxs || []));
            continue;
        }
        jobSegments.push({ text: seg.text, voiceId: ref.id, voiceSource: ref.source || 'stock', provider, style, anchored: !!anchor, temperature: temperatureFor(provider), reason, speaker, idxs: [...(seg.idxs || [])] });
    }
    if (jobSegments.length) {
        console.debug('[DES Voices] job', source, messageId,
            jobSegments.map(s => `${PROVIDER_LABELS[s.provider] || s.provider}/${s.voiceId} — ${describeReason(s.reason, s.speaker)}: ${s.text.slice(0, 40)}`));
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
export function audition(ref, text, { provider: forced = null } = {}) {
    if (!ref || !ref.id) return;
    const cur = player.getCurrentJob();
    if (cur && cur.source === 'audition' && cur.key === ref.id) { player.stop(); return; }
    if (!forced && !ensureConnected()) return;
    // A designed voice previews in its own voice when the Google key is
    // here; otherwise the same stand-in chat would use.
    const { ref: playable } = resolveVoice({ seg: { kind: 'dialogue', speaker: 'x' }, present: true, ref, narrator: voices().narratorVoice, caps: caps() });
    const provider = forced || routeFor(playable);
    const anchor = anchorFor(playable, provider);
    const style = styleWithAnchor(styleCapable(provider) ? baseStyle(voices().deliveryNote, { neverWhisper: !!voices().neverWhisper }) : '', anchor);
    const segments = normalizeSegments([{ speaker: null, kind: 'narration', text: text || `Hello, I'm ${ref.id}.` }]);
    const job = player.newJob({
        source: 'audition',
        key: ref.id,
        // Previews use the delivery note too, so they sound like chat will.
        segments: segments.map(s => ({ text: s.text, voiceId: playable.id, voiceSource: playable.source || 'stock', provider, style, anchored: !!anchor, temperature: temperatureFor(provider), reason: 'audition', speaker: null, idxs: [] })),
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
        openrouter: getOpenRouterState(),
        connected: { google: isProviderConnected('google'), openrouter: isProviderConnected('openrouter') },
        geminiVia: routeFor({ source: 'stock', id: 'Kore' }),
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
