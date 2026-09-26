/*
 * Doom's Enhancement Suite for SillyTavern — Voices: boot shim
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
 * The only eager part of DES voices (docs/google-tts-voices-plan.md §3.3).
 * Every listener returns on its first line while voices are off, and the
 * engine (segmenter, player, Google transport) is a dynamic import that only
 * loads on the first read.
 */
import { extensionSettings } from '../../core/state.js';
import { extension_settings as st_extension_settings } from '../../../../../../extensions.js';

let enginePromise = null;
let engine = null;
let guardModule = null;

/**
 * Auto-read is armed once per real generation (GENERATION_STARTED) and the
 * arm is bound to a message id when that generation's reply arrives
 * (MESSAGE_RECEIVED). Only those ids are read, once decorated — so chat
 * loads, greetings, edits and re-renders never auto-read. A counter, not a
 * flag: in a group chat the next member's generation can start before the
 * previous reply has been decorated.
 */
let armed = 0;
let armedAt = 0;
const ARM_TTL_MS = 10 * 60 * 1000;
/** Message ids produced by an armed generation, waiting for decoration. */
const pendingReads = new Set();

export function isVoicesEnabled() {
    return extensionSettings.enabled !== false && !!extensionSettings.voices?.enabled;
}

function isAutoReadOn() {
    return isVoicesEnabled() && !!extensionSettings.voices?.autoRead;
}

/** Loads the voice engine (memoised). */
export function getEngine() {
    if (!enginePromise) {
        enginePromise = import('./voiceEngine.js').then((mod) => {
            engine = mod;
            return mod;
        }).catch((e) => {
            enginePromise = null;
            throw e;
        });
    }
    return enginePromise;
}

/** The engine if it has already loaded, else null (never triggers a load). */
export function getEngineIfLoaded() {
    return engine;
}

/**
 * Installs or removes the guard that pauses SillyTavern's own auto-read
 * while DES voices are on (plan §9.7 / decision D2). Also tidies the
 * per-message buttons. Call at startup and whenever the master toggle flips.
 */
export async function syncVoicesState() {
    try {
        if (isVoicesEnabled()) {
            guardModule = guardModule || await import('./stAutoReadGuard.js');
            guardModule.installStAutoReadGuard(st_extension_settings?.tts, isVoicesEnabled);
        } else if (guardModule) {
            guardModule.uninstallStAutoReadGuard();
        }
    } catch (e) {
        console.warn('[DES Voices] could not pause SillyTavern auto-read', e);
    }
    if (!isVoicesEnabled()) {
        armed = 0;
        pendingReads.clear();
        engine?.stop('disabled');
    }
    try {
        const { injectMessageTtsButtons } = await import('../rendering/chatBubbles.js');
        injectMessageTtsButtons(document);
    } catch (e) { /* chat not ready yet */ }
}

// 10 ms of silence (WAV). Played from inside a click so the browser lets
// DES's audio element play later without a tap (iOS Safari in particular).
const SILENCE = 'data:audio/wav;base64,UklGRsQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YaAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
let audioUnlocked = false;

/** The single DES audio element (#dooms-tts-audio), created on first use. */
export function getVoicesAudioElement() {
    let el = document.getElementById('dooms-tts-audio');
    if (!el) {
        el = document.createElement('audio');
        el.id = 'dooms-tts-audio';
        el.preload = 'auto';
        el.hidden = true;
        document.body.appendChild(el);
    }
    return el;
}

/**
 * Call synchronously from a click handler, before any await. Once the
 * element has played inside a user gesture, auto-read can play on it later.
 */
export function unlockVoicesAudio() {
    if (audioUnlocked) return;
    try {
        const el = getVoicesAudioElement();
        if (!el.paused) { audioUnlocked = true; return; }
        el.src = SILENCE;
        const p = el.play();
        if (p && typeof p.then === 'function') p.then(() => { audioUnlocked = true; }).catch(() => {});
        else audioUnlocked = true;
    } catch (e) { /* retried on the next click */ }
}

// ─── Event shims (registered by index.js) ───────────────────────────────────

/** GENERATION_STARTED(type, params, dryRun) */
export function onGenerationStartedVoices(type, _params, dryRun) {
    if (!isAutoReadOn()) return;
    if (dryRun || type === 'quiet' || type === 'impersonate') return;
    armed = Math.min(armed + 1, 8);
    armedAt = Date.now();
}

/** MESSAGE_RECEIVED(messageId, type) — bind an arm to the reply it produced. */
export function onMessageReceivedVoices(messageId, type) {
    if (!isAutoReadOn() || type === 'first_message') return;
    if (armed <= 0) return;
    if (Date.now() - armedAt > ARM_TTL_MS) { armed = 0; return; }
    armed--;
    const id = Number(messageId);
    if (Number.isInteger(id)) pendingReads.add(id);
}

/** GENERATION_STOPPED — the user pressed Stop; don't read the partial reply. */
export function onGenerationStoppedVoices() {
    if (!isVoicesEnabled()) return;
    // Stop fires before SillyTavern saves the partial reply, so clearing the
    // arms here means a stopped reply is never auto-read.
    armed = 0;
    pendingReads.clear();
    engine?.onGenerationStopped();
}

/**
 * Called by index.js once a rendered AI message has been decorated
 * (colours applied, bubbles built) — ~800 ms after render, after any open
 * duplicate-character question is answered. Firing earlier would read
 * every line in the Narrator's voice for users whose colours come from the
 * colored-dialogues extension.
 */
export async function onMessageDecorated(messageId, type) {
    if (!isVoicesEnabled()) return;
    try {
        const { injectMessageTtsButtons } = await import('../rendering/chatBubbles.js');
        const mes = document.querySelector(`#chat .mes[mesid="${messageId}"]`);
        if (mes) injectMessageTtsButtons(mes);
    } catch (e) { /* cosmetic */ }
    const id = Number(messageId);
    if (!pendingReads.has(id)) return;
    pendingReads.delete(id);
    if (!isAutoReadOn()) return;
    try {
        const mod = await getEngine();
        mod.autoReadMessage(id, type);
    } catch (e) {
        console.warn('[DES Voices] auto-read failed', e);
    }
}

/** USER_MESSAGE_RENDERED — optionally read the user's own message. */
export async function onUserMessageRenderedVoices(messageId) {
    if (!isVoicesEnabled()) return;
    try {
        const { injectMessageTtsButtons } = await import('../rendering/chatBubbles.js');
        const mes = document.querySelector(`#chat .mes[mesid="${messageId}"]`);
        if (mes) injectMessageTtsButtons(mes);
    } catch (e) { /* cosmetic */ }
    if (!isAutoReadOn() || !extensionSettings.voices?.readUserMessages) return;
    try {
        const mod = await getEngine();
        mod.autoReadMessage(Number(messageId), 'user');
    } catch (e) {
        console.warn('[DES Voices] auto-read failed', e);
    }
}

/** MESSAGE_SENT — the user moved on; stop reading the old reply. */
export function onMessageSentVoices() {
    if (!isVoicesEnabled()) return;
    engine?.stop('sent');
}

/** MESSAGE_SWIPED / MESSAGE_DELETED */
export function onMessageChangedVoices() {
    if (!isVoicesEnabled()) return;
    engine?.stop('changed');
}

/** CHAT_CHANGED */
export function onChatChangedVoices() {
    armed = 0;
    pendingReads.clear();
    if (isVoicesEnabled()) {
        // The new chat's messages render after CHAT_CHANGED.
        setTimeout(() => {
            import('../rendering/chatBubbles.js')
                .then(m => m.injectMessageTtsButtons(document))
                .catch(() => {});
        }, 600);
    }
    if (!engine) return;
    engine.stop('chat');
    engine.onChatChanged();
}

/** Called from campaign switches and Workshop saves: voices may have changed. */
export function invalidateVoices() {
    engine?.invalidate();
}
