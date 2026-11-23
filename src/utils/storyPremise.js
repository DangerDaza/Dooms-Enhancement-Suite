/**
 * What a story is about (docs/long-shot-plan.md D228): its narrator card's
 * description. A world shared by several stories (D216) is described once
 * for all of them, neutral; who the player is in this story, and what it
 * is about, is the story's card's. The requests that see no card (the
 * openings, the hooks, the world's moves between replies and between
 * scenes) are told it, and so is a scene's brief when the scene runs on a
 * card of its own (D209) that does not carry it.
 *
 * Pure, no SillyTavern: the card is handed in. The premise of the story
 * in front is set by the Hub when the chat in front changes
 * (src/systems/features/hub.js), for the requests made in a chat.
 * tools/hub-test.mjs (D228).
 */

export const PREMISE_CHARS = 1200;    // in a request
export const BRIEF_PREMISE = 600;     // in a scene's brief, which rides every reply

const clean = (v, max) => String(v ?? '').normalize('NFC').replace(/\r\n?/g, '\n').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, max);

/**
 * A card's description as a story's premise: SillyTavern's own macros for
 * the player and the card read as names, cut at a sentence's end where one
 * is near.
 * @param {{ name?: string, description?: string, data?: { description?: string } }|null} card
 * @param {{ player?: string, max?: number }} opts
 */
export function premiseOf(card, { player = '', max = PREMISE_CHARS } = {}) {
    if (!card || typeof card !== 'object') return '';
    const raw = String(card.description || (card.data && card.data.description) || '');
    const who = String(player || '').trim() || 'the player';
    const name = String(card.name || '').trim() || 'the narrator';
    const text = clean(raw.replace(/\{\{user\}\}|<user>/gi, who).replace(/\{\{char\}\}|<bot>/gi, name), 20000);
    if (text.length <= max) return text;
    const cut = text.slice(0, max);
    const stop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('.\n'), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
    return (stop > max * 0.6 ? cut.slice(0, stop + 1) : `${cut.slice(0, max - 1).trimEnd()}…`).trim();
}

let premise = '';

/** The premise of the story the chat in front belongs to ('' when it is part of none, or its card says nothing). */
export function setStoryPremise(text) {
    premise = typeof text === 'string' ? clean(text, PREMISE_CHARS) : '';
}

export function getStoryPremise() {
    return premise;
}

/** The line a request is told it on, after the world's own line: '' when there is none. */
export function premiseLine(text) {
    const t = clean(text, PREMISE_CHARS);
    return t ? `\nThis story (what it is about and who the player is in it, from its narrator card): ${t}` : '';
}
