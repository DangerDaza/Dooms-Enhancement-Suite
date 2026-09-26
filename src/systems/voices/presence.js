/*
 * Doom's Enhancement Suite for SillyTavern — Voices: scene presence
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
 * "Is this character on the Present Characters panel for this message?"
 * (docs/google-tts-voices-plan.md §7.3). A character's voice is only used
 * while the answer is yes; otherwise the Narrator reads their lines.
 *
 * Pure and READ-ONLY: everything it needs is injected, and nothing here may
 * write settings. (portraitBar.getCharacterList mirrors these rules but also
 * records newly seen characters and saves, which a re-read of an old message
 * must never do.)
 */
import { isOffScene } from '../../utils/offScene.js';

function swipeData(message) {
    if (!message || message.is_user || message.is_system) return null;
    const swipeId = message.swipe_id || 0;
    let data = message.extra?.dooms_tracker_swipes?.[swipeId];
    if (!data && message.swipe_info?.[swipeId]?.extra?.dooms_tracker_swipes) {
        data = message.swipe_info[swipeId].extra.dooms_tracker_swipes[swipeId];
    }
    return data || null;
}

function isAiMessage(message) {
    return !!message && !message.is_user && !message.is_system;
}

/**
 * The raw characterThoughts tracker value that describes the scene for a
 * message: its own stored tracker; for the newest AI message, the live
 * tracker (it may not be stored on the message yet); otherwise the nearest
 * earlier AI message that has one (together mode stores null when a reply
 * came without a tracker).
 *
 * @param {Array<object>} chatArr
 * @param {number} messageId
 * @param {*} liveTracker - lastGeneratedData/committedTrackerData.characterThoughts
 * @returns {*} raw tracker value or null
 */
export function trackerRawForMessage(chatArr, messageId, liveTracker = null) {
    if (!Array.isArray(chatArr) || !Number.isInteger(messageId)) return liveTracker || null;
    const own = swipeData(chatArr[messageId]);
    if (own && own.characterThoughts) return own.characterThoughts;
    let isLatestAi = true;
    for (let i = messageId + 1; i < chatArr.length; i++) {
        if (isAiMessage(chatArr[i])) { isLatestAi = false; break; }
    }
    if (isLatestAi && liveTracker) return liveTracker;
    for (let i = messageId - 1; i >= 0; i--) {
        const data = swipeData(chatArr[i]);
        if (data && data.characterThoughts) return data.characterThoughts;
    }
    return null;
}

/**
 * Tracker entries as [{name, thoughts}], accepting the JSON shapes and the
 * legacy "- Name" text format.
 * @param {*} raw
 * @param {(raw: *) => *} parse - parseTrackerJson
 */
export function trackerEntries(raw, parse) {
    if (!raw) return [];
    try {
        const parsed = parse(raw);
        const list = Array.isArray(parsed) ? parsed : (parsed.characters || []);
        return list
            .filter(c => c && c.name && String(c.name).toLowerCase() !== 'unavailable')
            .map(c => ({ name: String(c.name), thoughts: c.thoughts }));
    } catch {
        if (typeof raw !== 'string') return [];
        const out = [];
        for (const line of raw.split('\n')) {
            const m = line.trim().match(/^-\s+(.+)$/);
            if (m && !m[1].includes(':') && !m[1].includes('---')) out.push({ name: m[1].trim(), thoughts: '' });
        }
        return out;
    }
}

/**
 * Lowercase canonical names the tracker lists as in the scene.
 * @param {*} raw
 * @param {{parse: Function, resolveName: (n: string) => string, pendingAlias?: (n: string) => boolean}} readers
 * @returns {Set<string>}
 */
export function presentNames(raw, readers) {
    const out = new Set();
    for (const entry of trackerEntries(raw, readers.parse)) {
        if (isOffScene(entry.thoughts)) continue;
        if (readers.pendingAlias && readers.pendingAlias(entry.name)) continue;
        const canonical = readers.resolveName(entry.name) || entry.name;
        out.add(String(canonical).toLowerCase());
    }
    return out;
}

/**
 * @typedef {object} PresenceContext
 * @property {Set<string>} presentLower - from presentNames()
 * @property {Set<string>} hiddenLower - removed (and banned) names, as they are NOW
 * @property {Set<string>} personaLower - every DES user-character name
 * @property {string|null} activePersonaLower - the active persona, if any
 * @property {boolean} showUserInPCP - is the active persona shown on the panel
 * @property {(n: string) => string} resolveName - alias → canonical
 */

/**
 * @param {string} name
 * @param {PresenceContext} ctx
 * @returns {boolean}
 */
export function isPresentOnPanel(name, ctx) {
    if (!name) return false;
    const n = String(ctx.resolveName(name) || name).toLowerCase();
    if (ctx.hiddenLower.has(n)) return false;
    if (ctx.activePersonaLower && n === ctx.activePersonaLower) return !!ctx.showUserInPCP;
    // A persona name never shows as an NPC tile on the panel.
    if (ctx.personaLower.has(n)) return false;
    return ctx.presentLower.has(n);
}
