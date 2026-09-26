/*
 * Doom's Enhancement Suite for SillyTavern — Voices: SillyTavern auto-read guard
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
 * Pauses SillyTavern's own TTS auto-read while DES voices are on, WITHOUT
 * changing the user's SillyTavern setting (docs/google-tts-voices-plan.md §9.7).
 *
 * SillyTavern reads extension_settings.tts.auto_generation at the moment a
 * message arrives (tts/index.js onMessageEvent, and onGenerationStarted for
 * streaming). A getter answers `false` while DES voices are active and the
 * real value otherwise; the setter keeps recording what the user ticks in
 * SillyTavern's own checkbox. A non-enumerable toJSON writes the REAL value
 * when SillyTavern saves its settings with JSON.stringify, so the choice on
 * disk never changes. Writing the setting instead (save/restore) would
 * persist the forced value if the browser closed mid-session.
 *
 * Takes the tts settings object as an argument so it can be tested in Node.
 */

let guarded = null;      // the tts settings object we patched
let realAutoGen;         // the user's real SillyTavern choice

/**
 * @param {object} tts - SillyTavern's extension_settings.tts
 * @param {() => boolean} isActive
 * @returns {boolean} true when the guard is (now) installed
 */
export function installStAutoReadGuard(tts, isActive) {
    if (!tts || typeof tts !== 'object') return false;
    if (guarded === tts) return true;
    if (guarded) uninstallStAutoReadGuard();
    realAutoGen = tts.auto_generation;
    Object.defineProperty(tts, 'auto_generation', {
        configurable: true,
        enumerable: true,
        get: () => (isActive() ? false : realAutoGen),
        set: (value) => { realAutoGen = value; },
    });
    Object.defineProperty(tts, 'toJSON', {
        configurable: true,
        enumerable: false,
        value() {
            const out = {};
            for (const key of Object.keys(this)) out[key] = this[key];
            out.auto_generation = realAutoGen;
            return out;
        },
    });
    guarded = tts;
    return true;
}

/** Puts the plain property back with the user's real value. */
export function uninstallStAutoReadGuard() {
    const tts = guarded;
    if (!tts) return;
    guarded = null;
    delete tts.toJSON;
    delete tts.auto_generation;
    if (realAutoGen !== undefined) tts.auto_generation = realAutoGen;
}

export function isStAutoReadGuarded() {
    return guarded !== null;
}

/**
 * Stops SillyTavern's TTS if it is currently playing. SillyTavern exposes no
 * stop function; clicking its own wand-menu item runs resetTtsPlayback, but
 * the same click STARTS playback when idle, so only click while its audio
 * element is actually playing. (A job still being synthesised can't be
 * stopped this way.)
 * @param {Document} [doc]
 */
export function stopStPlayback(doc = globalThis.document) {
    try {
        const audio = doc?.getElementById?.('tts_audio');
        if (!audio || audio.paused) return;
        doc.getElementById('ttsExtensionMenuItem')?.click();
    } catch (e) { /* best-effort */ }
}
