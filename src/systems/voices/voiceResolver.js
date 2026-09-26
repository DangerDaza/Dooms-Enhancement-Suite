/*
 * Doom's Enhancement Suite for SillyTavern — Voices: voice resolution
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
 * Which voice reads a segment, and why (docs/google-tts-voices-plan.md §7.2).
 * Pure. The `reason` is shown in tooltips and the debug log so every choice
 * is explainable ("Narrator: Tom is not in the scene").
 *
 * Stock voices play on either route. A designed voice needs the Google key
 * in DES (caps.direct) and must still exist on Google (registry status
 * isn't 'gone'); otherwise it falls back to its fallbackStock (a standard
 * voice of the same gender, chosen when it was designed) or the Narrator.
 */
import { isStockVoice, canonicalStockId } from './voiceCatalog.js';
import { NARRATOR_FALLBACK_VOICE } from './voiceSettings.js';

/**
 * @typedef {{source?: string, id: string, fallbackStock?: string}} VoiceRef
 * @typedef {'narration'|'unattributed'|'not-in-scene'|'no-voice'|'needs-key'|'voice-gone'|'character'} VoiceReason
 * @typedef {{direct?: boolean, registry?: Record<string, {status?: string}>}} Caps
 */

function isGone(ref, caps) {
    return !!ref && (ref.source || 'stock') !== 'stock' && caps.registry?.[ref.id]?.status === 'gone';
}

/** Can this device play the ref right now? */
export function isPlayable(ref, caps = {}) {
    if (!ref || typeof ref.id !== 'string' || !ref.id) return false;
    const source = ref.source || 'stock';
    if (source === 'stock') return isStockVoice(ref.id);
    return !!caps.direct && !isGone(ref, caps);
}

function stock(id) {
    return { source: 'stock', id: canonicalStockId(id) || id };
}

/** The Narrator voice, or the built-in fallback when it can't be played. */
export function playableNarrator(narrator, caps = {}) {
    if (isPlayable(narrator, caps)) return narrator.source === 'stock' || !narrator.source ? stock(narrator.id) : narrator;
    if (narrator && narrator.fallbackStock && isStockVoice(narrator.fallbackStock)) return stock(narrator.fallbackStock);
    return stock(NARRATOR_FALLBACK_VOICE);
}

/**
 * @param {object} args
 * @param {{speaker: string|null, kind: string}} args.seg
 * @param {boolean} args.present - is seg.speaker on the Present Characters panel for this message
 * @param {VoiceRef|null|undefined} args.ref - the speaker's own voice (active version)
 * @param {VoiceRef|null|undefined} args.narrator - voices.narratorVoice
 * @param {object} [args.caps]
 * @returns {{ref: VoiceRef, reason: VoiceReason}}
 */
export function resolveVoice({ seg, present, ref, narrator, caps = {} }) {
    const narr = playableNarrator(narrator, caps);
    if (!seg || seg.kind === 'narration') return { ref: narr, reason: 'narration' };
    if (!seg.speaker) return { ref: narr, reason: 'unattributed' };
    if (!present) return { ref: narr, reason: 'not-in-scene' };
    if (!ref || !ref.id) return { ref: narr, reason: 'no-voice' };
    if (!isPlayable(ref, caps)) {
        const reason = isGone(ref, caps) ? 'voice-gone' : 'needs-key';
        if (ref.fallbackStock && isStockVoice(ref.fallbackStock)) return { ref: stock(ref.fallbackStock), reason };
        return { ref: narr, reason };
    }
    const source = ref.source || 'stock';
    return { ref: source === 'stock' ? stock(ref.id) : ref, reason: 'character' };
}

/** Plain-language explanation for a resolution, for tooltips and the log. */
export function describeReason(reason, speaker) {
    const who = speaker || 'This line';
    switch (reason) {
        case 'narration': return 'Narration';
        case 'unattributed': return 'Narrator: DES couldn’t tell who said this';
        case 'not-in-scene': return `Narrator: ${who} is not on the Present Characters panel`;
        case 'no-voice': return `Narrator: ${who} has no voice set`;
        case 'needs-key': return `${who}’s designed voice needs the Google key in Settings → Voices`;
        case 'voice-gone': return `${who}’s designed voice no longer exists on Google`;
        case 'character': return `${who}’s voice`;
        default: return '';
    }
}

/** Case-insensitive lookup in a name-keyed store. */
export function lookupByName(store, name) {
    if (!store || typeof store !== 'object' || !name) return undefined;
    if (Object.prototype.hasOwnProperty.call(store, name)) return store[name];
    const lower = String(name).toLowerCase();
    for (const key of Object.keys(store)) {
        if (key.toLowerCase() === lower) return store[key];
    }
    return undefined;
}
