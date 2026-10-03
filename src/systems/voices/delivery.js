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

/** Narration or dialogue that says this line is meant to be quiet. */
const WHISPER_CUE = /\b(?:whisper(?:s|ed|ing)?|murmur(?:s|ed|ing)?|hiss(?:es|ed)? softly|breath(?:es|ed)? (?:the words|out)|under (?:his|her|their|my|your|its) breath|sotto voce|barely audible|in a hushed (?:voice|tone)|hushed)\b/i;

/** True when the text says someone is whispering. */
export function hasWhisperCue(text) {
    return WHISPER_CUE.test(String(text || ''));
}

/**
 * The style note for segment i: the whisper note for a spoken line when the
 * narration right next to it says it's whispered, otherwise the delivery note.
 * '' when the delivery note is empty (let Gemini decide, as before).
 * @param {{text: string, kind?: string}[]} segments - in reading order
 * @param {number} i
 * @param {string} note - voices.deliveryNote
 */
export function styleForSegment(segments, i, note) {
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
