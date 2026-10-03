/*
 * Doom's Enhancement Suite for SillyTavern — Voices: AI-drafted descriptions
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
 * Pure helpers for the voice descriptions the chat AI drafts ("Draft from
 * card", "I'm thinking of…"). No imports, so the Node tests can run them.
 */

/** Longest description DES sends to Google's voice design. */
export const MAX_DESIGN_DESCRIPTION = 1000;

/**
 * Strips reasoning blocks, wrapping quotes and extra whitespace from an AI
 * reply, and caps its length.
 * @param {string} response
 * @param {number} [max]
 */
export function cleanDraft(response, max = MAX_DESIGN_DESCRIPTION) {
    return String(response || '')
        .replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, '')
        .replace(/<think(?:ing)?>[\s\S]*$/gi, '')
        .replace(/^["'\u201c\u201d\s]+|["'\u201c\u201d\s]+$/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, max);
}

/**
 * Reads the AI's answer to the "I'm thinking of…" prompt.
 * @param {string} response
 * @returns {{status: 'ok', text: string} | {status: 'real-person'|'unknown'|'empty'}}
 */
export function interpretReferenceDraft(response) {
    const text = cleanDraft(response);
    if (!text) return { status: 'empty' };
    // A marker is a short reply; it may come with a full stop or a word of
    // preamble ("Answer: UNKNOWN"). A real description is never that short.
    if (text.length < 80) {
        if (/\bREAL[_ ]PERSON\b/i.test(text)) return { status: 'real-person' };
        if (/\bUNKNOWN\b/.test(text) || /^unknown\W*$/i.test(text)) return { status: 'unknown' };
    }
    return { status: 'ok', text };
}

/** What to tell the user when "I'm thinking of…" didn't produce a description. */
export function referenceProblem(status, reference) {
    if (status === 'real-person') return 'DES only describes the voices of fictional characters. Describe the sound you want in your own words instead.';
    if (status === 'unknown') return `Your chat AI doesn’t know “${reference}”. Add where they’re from (for example “Withers from Baldur’s Gate 3”), or describe the voice yourself.`;
    if (status === 'empty') return 'Your chat AI returned nothing. Try again, or write the description yourself.';
    return '';
}
