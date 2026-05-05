/**
 * Message guards — predicates for filtering chat[] entries that other
 * extensions push into SillyTavern's chat array but DES should not
 * treat as real user/assistant turns.
 *
 * Currently scoped to GuidedGenerations (GG) which inserts synthetic
 * tracker / situational / stat messages and re-emits MESSAGE_SENT and
 * USER_MESSAGE_RENDERED for them — which would otherwise have DES try
 * to parse JSON out of GG's <details> HTML, classify expressions on
 * non-real text, write tracker swipe data to a non-real message, and
 * apply chat-bubble styling to GG's tracker UI.
 *
 * Each predicate accepts the message object directly (chat[i]) and
 * returns true if DES should treat the entry as opaque and skip its
 * normal handling.
 */

/**
 * GG's `extra.type` values for synthetic messages it inserts via
 * trackerLogic.js / runGuide.js. Source:
 * https://github.com/Samueras/GuidedGenerations-Extension
 */
const GG_SYNTHETIC_TYPES = new Set([
    'situationaltracker',
    'stattracker',
    'trackernote',
]);

/**
 * Returns true if the message looks like a synthetic tracker/note
 * inserted by GuidedGenerations (or any extension that mimics its
 * extra.api='manual' + extra.model='tracker system' convention).
 *
 * @param {object|null|undefined} message - chat[i] entry or null
 * @returns {boolean}
 */
export function isSyntheticTrackerMessage(message) {
    if (!message || typeof message !== 'object') return false;
    const extra = message.extra;
    if (!extra || typeof extra !== 'object') return false;
    if (typeof extra.type === 'string' && GG_SYNTHETIC_TYPES.has(extra.type)) return true;
    if (extra.api === 'manual' && extra.model === 'tracker system') return true;
    return false;
}
