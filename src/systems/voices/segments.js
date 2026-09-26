/*
 * Doom's Enhancement Suite for SillyTavern — Voices: segment normalization
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
 * Pure half of the TTS segmenter (docs/google-tts-voices-plan.md §7.1).
 * segmenter.js reads the DOM and hands raw segments here; everything that
 * decides what gets sent to Google as one request lives in this file so it
 * can be tested in plain Node.
 *
 * @typedef {'narration'|'dialogue'|'thought'} SegmentKind
 * @typedef {{speaker: string|null, kind: SegmentKind, text: string, idx?: number}} RawSegment
 * @typedef {{speaker: string|null, kind: SegmentKind, text: string, idxs: number[]}} Segment
 *   idxs: DOM bubble indexes this segment covers (for highlighting); may be empty.
 */

/** Google's input limit is 8,192 tokens; 2,500 characters stays far below it. */
export const MAX_SEGMENT_CHARS = 2500;

export function cleanText(text) {
    return String(text ?? '')
        .replace(/ /g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Splits text longer than maxChars at sentence ends (falling back to word
 * boundaries, then a hard cut) so no single request is oversized.
 */
export function splitLongText(text, maxChars = MAX_SEGMENT_CHARS) {
    if (text.length <= maxChars) return [text];
    const out = [];
    let rest = text;
    while (rest.length > maxChars) {
        const window = rest.slice(0, maxChars + 1);
        let cut = -1;
        const sentenceEnd = /[.!?…]["'”’)\]]*\s/g;
        let m;
        while ((m = sentenceEnd.exec(window)) !== null) cut = m.index + m[0].length;
        if (cut <= 0) cut = window.lastIndexOf(' ');
        if (cut <= 0) cut = maxChars;
        out.push(rest.slice(0, cut).trim());
        rest = rest.slice(cut).trim();
    }
    if (rest) out.push(rest);
    return out.filter(Boolean);
}

/**
 * Cleans, attributes, merges and caps raw segments.
 * @param {RawSegment[]} raw
 * @param {{maxChars?: number, maxSegments?: number, resolveSpeaker?: (name: string) => string|null}} [opts]
 * @returns {Segment[]}
 */
export function normalizeSegments(raw, opts = {}) {
    const maxChars = opts.maxChars || MAX_SEGMENT_CHARS;
    const maxSegments = Math.max(1, opts.maxSegments || 24);
    const resolveSpeaker = typeof opts.resolveSpeaker === 'function' ? opts.resolveSpeaker : (n) => n;

    /** @type {Segment[]} */
    const merged = [];
    for (const seg of Array.isArray(raw) ? raw : []) {
        if (!seg) continue;
        const text = cleanText(seg.text);
        if (!text || !/[\p{L}\p{N}]/u.test(text)) continue;
        const kind = seg.kind === 'dialogue' || seg.kind === 'thought' ? seg.kind : 'narration';
        let speaker = null;
        if (kind !== 'narration' && seg.speaker) {
            const resolved = resolveSpeaker(String(seg.speaker).trim());
            speaker = resolved ? String(resolved) : null;
        }
        const idxs = Number.isInteger(seg.idx) ? [seg.idx] : [];
        const prev = merged[merged.length - 1];
        const sameVoice = prev && prev.kind === kind &&
            String(prev.speaker || '').toLowerCase() === String(speaker || '').toLowerCase();
        if (sameVoice) {
            prev.text = `${prev.text} ${text}`;
            prev.idxs.push(...idxs);
        } else {
            merged.push({ speaker, kind, text, idxs });
        }
    }

    // Cap: past the limit, everything left becomes one narration segment
    // (read by the Narrator) instead of a request per line.
    let capped = merged;
    if (merged.length > maxSegments) {
        const head = merged.slice(0, maxSegments - 1);
        const tail = merged.slice(maxSegments - 1);
        head.push({
            speaker: null,
            kind: 'narration',
            text: tail.map(s => s.text).join(' '),
            idxs: tail.flatMap(s => s.idxs),
        });
        capped = head;
    }

    const out = [];
    for (const seg of capped) {
        const parts = splitLongText(seg.text, maxChars);
        parts.forEach((text, i) => out.push({ ...seg, text, idxs: i === 0 ? seg.idxs : [] }));
    }
    return out;
}

/**
 * For "continue": drops the part of a message that was already read, so
 * only the new text is spoken.
 * @param {Segment[]} segments - the whole message, freshly segmented
 * @param {string} previouslyRead - the joined text read last time
 * @returns {Segment[]}
 */
export function dropAlreadyRead(segments, previouslyRead) {
    let remaining = cleanText(previouslyRead);
    const out = [];
    for (const seg of segments) {
        if (!remaining) { out.push(seg); continue; }
        if (remaining.startsWith(seg.text)) {
            remaining = remaining.slice(seg.text.length).trimStart();
            continue;
        }
        if (seg.text.startsWith(remaining)) {
            const rest = seg.text.slice(remaining.length).trim();
            remaining = '';
            if (rest && /[\p{L}\p{N}]/u.test(rest)) out.push({ ...seg, text: rest, idxs: [] });
            continue;
        }
        // The message changed under us — read everything from here.
        remaining = '';
        out.push(seg);
    }
    return out;
}

/** The text of a segment list as one string (what dropAlreadyRead compares against). */
export function joinSegmentText(segments) {
    return segments.map(s => s.text).join(' ');
}

/** Small stable string hash for de-duplicating auto-reads. */
export function hashText(text) {
    let h = 5381;
    const s = String(text ?? '');
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
}
