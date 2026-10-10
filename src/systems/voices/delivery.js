/*
 * Doom's Enhancement Suite for SillyTavern — Voices: delivery notes
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
 * The style note sent with each line (Gemini 3.8 `speech_metadata.style`,
 * direct route only). Without one, Gemini guesses the delivery from the
 * line alone and short or quiet-sounding lines can come out whispered. The
 * default asks for a normal speaking voice; lines the story itself marks as
 * whispered get a whisper note instead. Pure: no imports, Node-testable.
 */

/** Settings → Voices → Delivery note, as shipped. */
export const DEFAULT_DELIVERY_NOTE = 'clear, natural speaking voice at a normal, steady volume';

/** Sent instead of the delivery note when the story says the line is whispered. */
export const WHISPER_NOTE = 'hushed, quiet whisper';

/** Rides with the note on every line when Settings → Voices → Never whisper is on; sent alone when the note is empty. */
export const NEVER_WHISPER_NOTE = 'never whisper; a line the story marks as whispered is spoken quietly in tone but at full, clear volume';

/** Longest anchor appended to a style note (the first clause or two of a design, not the whole thing). */
export const ANCHOR_MAX_CHARS = 120;

/**
 * A short reminder of who is speaking, built from a designed voice's
 * registry entry: gender, language and the opening clause or two of its
 * design prompt, capped at ANCHOR_MAX_CHARS. Appended to every line's style
 * note so each render starts from the same description, which steadies a
 * voice Google would otherwise re-imagine per request. '' when the entry
 * has no description to anchor to (a cloned voice, or a stock one).
 * @param {{gender?: string, languageCode?: string, designPrompt?: string}|null|undefined} entry
 */
export function anchorForVoice(entry) {
    if (!entry || typeof entry !== 'object') return '';
    const prompt = String(entry.designPrompt || '').replace(/\s+/g, ' ').trim();
    if (!prompt) return '';
    const head = [];
    if (entry.gender === 'female' || entry.gender === 'male') head.push(entry.gender);
    if (typeof entry.languageCode === 'string' && /^[a-z]{2}-[A-Z]{2}$/.test(entry.languageCode)) head.push(entry.languageCode);
    const prefix = head.length ? `${head.join(', ')} voice: ` : 'voice: ';
    const room = ANCHOR_MAX_CHARS - prefix.length;
    return prefix + firstClauses(prompt, room);
}

/**
 * The opening of a description, cut at a clause boundary (sentence end,
 * semicolon or comma) so it still reads as a phrase, then at a word, and
 * never longer than `max`.
 */
function firstClauses(text, max) {
    if (text.length <= max) return text.replace(/[.;,\s]+$/, '');
    const window = text.slice(0, max + 1);
    let cut = -1;
    for (const re of [/[.!?;](?=\s)/g, /,(?=\s)/g]) {
        for (const m of window.matchAll(re)) if (m.index > max / 3) cut = Math.max(cut, m.index);
        if (cut > 0) break;
    }
    if (cut <= 0) {
        const space = window.lastIndexOf(' ');
        cut = space > max / 3 ? space : max;
    }
    return text.slice(0, cut).replace(/[.;,\s]+$/, '');
}

/**
 * The style note with the anchor on the end: "note; anchor", the anchor
 * alone when the note is empty, the note alone when there is no anchor.
 */
export function styleWithAnchor(style, anchor) {
    const base = String(style || '').trim();
    const tail = String(anchor || '').trim();
    if (!tail) return base;
    if (!base) return tail;
    return `${base}; ${tail}`;
}

/** Narration or dialogue that says this line is meant to be quiet. */
const WHISPER_CUE = /\b(?:whisper(?:s|ed|ing)?|murmur(?:s|ed|ing)?|hiss(?:es|ed)? softly|breath(?:es|ed)? (?:the words|out)|under (?:his|her|their|my|your|its) breath|sotto voce|barely audible|in a hushed (?:voice|tone)|hushed)\b/i;

/** True when the text says someone is whispering. */
export function hasWhisperCue(text) {
    return WHISPER_CUE.test(String(text || ''));
}

/**
 * The style for a line on its own (auditions, previews): the delivery note,
 * with the whisper ban added when it is on. '' when there is nothing to say.
 * @param {string} note - voices.deliveryNote
 * @param {{ neverWhisper?: boolean }} [opts]
 */
export function baseStyle(note, { neverWhisper = false } = {}) {
    const base = String(note || '').trim();
    if (neverWhisper) return base ? `${base}; ${NEVER_WHISPER_NOTE}` : NEVER_WHISPER_NOTE;
    return base;
}

/**
 * The style note for segment i: the whisper note for a spoken line when the
 * narration right next to it says it's whispered, otherwise the delivery note.
 * With neverWhisper on, every line gets the note plus the ban and no line is
 * ever whispered. '' when the delivery note is empty and the ban is off (let
 * Gemini decide, as before).
 * @param {{text: string, kind?: string}[]} segments - in reading order
 * @param {number} i
 * @param {string} note - voices.deliveryNote
 * @param {{ neverWhisper?: boolean }} [opts] - voices.neverWhisper
 */
export function styleForSegment(segments, i, note, { neverWhisper = false } = {}) {
    if (neverWhisper) return baseStyle(note, { neverWhisper: true });
    const base = String(note || '').trim();
    if (!base) return '';
    const seg = segments[i];
    // Narration is never whispered: "she whispered" is said at full voice.
    if (!seg || seg.kind === 'narration') return base;
    // A spoken line takes its cue from the narration right around it
    // ("…," she whispered. / He leaned in and murmured: "…").
    const prev = segments[i - 1];
    const next = segments[i + 1];
    if (prev && prev.kind === 'narration' && hasWhisperCue(prev.text)) return WHISPER_NOTE;
    if (next && next.kind === 'narration' && hasWhisperCue(next.text)) return WHISPER_NOTE;
    return base;
}
