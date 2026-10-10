/**
 * Tracker recovery (together mode).
 *
 * In together mode the tracker data block rides inside the reply. A model
 * that has just been handed a dice verdict, or that is resuming after a
 * tool call, sometimes writes the story and skips the block. Nothing then
 * updates: thoughts freeze, the scene tracker goes stale, the Tracker Data
 * dropdown has nothing to show, and the next reply tends to copy the last
 * one and skip it too.
 *
 * These helpers decide, from the chat alone, whether a reply carried the
 * block. They have no SillyTavern imports so they can be tested directly.
 * The call that fetches a missing block is the separate-mode tracker
 * request (apiClient.updateRPGData, forced); the trigger lives in
 * sillytavern.onMessageReceived.
 */

/** The keys a swipe's tracker entry may carry. */
const DATA_KEYS = ['quests', 'infoBox', 'characterThoughts', 'player'];

/**
 * Whether a swipe entry actually holds tracker data. Together mode stores an
 * entry for every reply, parsed or not, so a failed parse leaves an entry
 * whose every value is undefined: present, but empty.
 * @param {any} entry
 * @returns {boolean}
 */
export function hasTrackerData(entry) {
    if (!entry || typeof entry !== 'object') return false;
    return DATA_KEYS.some(key => {
        const v = entry[key];
        if (typeof v === 'string') return v.trim() !== '';
        if (v && typeof v === 'object') return Object.keys(v).length > 0;
        return false;
    });
}

/**
 * The tracker entry stored for a message's current swipe, from either place
 * SillyTavern keeps it (extra while live, swipe_info once loaded from file).
 * @param {any} message
 * @returns {any}
 */
export function swipeEntryOf(message) {
    if (!message || typeof message !== 'object') return undefined;
    const swipeId = message.swipe_id || 0;
    let store = message.extra?.dooms_tracker_swipes;
    if (!store && Array.isArray(message.swipe_info) && message.swipe_info[swipeId]) {
        store = message.swipe_info[swipeId].extra?.dooms_tracker_swipes;
    }
    if (!store || typeof store !== 'object') return undefined;
    return store[swipeId];
}

/**
 * Whether this swipe's data came from a recovery request rather than from the
 * reply itself. The reply text still lacks the block in that case, which is
 * what the next generation's reminder is about.
 * @param {any} message
 * @returns {boolean}
 */
export function wasRecovered(message) {
    if (!message || typeof message !== 'object') return false;
    const swipeId = message.swipe_id || 0;
    const marks = message.extra?.dooms_tracker_recovered;
    return !!(marks && typeof marks === 'object' && marks[swipeId]);
}

/**
 * Record that this swipe's data was fetched separately.
 * @param {any} message
 */
export function markRecovered(message) {
    if (!message || typeof message !== 'object') return;
    if (!message.extra) message.extra = {};
    if (!message.extra.dooms_tracker_recovered || typeof message.extra.dooms_tracker_recovered !== 'object') {
        message.extra.dooms_tracker_recovered = {};
    }
    message.extra.dooms_tracker_recovered[message.swipe_id || 0] = true;
}

/**
 * Whether a message is the game master's reply (not the user's, not a
 * system note, not a tool-call record).
 * @param {any} message
 * @returns {boolean}
 */
export function isReplyMessage(message) {
    if (!message || typeof message !== 'object') return false;
    if (message.is_user || message.is_system) return false;
    if (Array.isArray(message.extra?.tool_invocations)) return false;
    return true;
}

/**
 * Whether the reply's own text lacked the block: no data stored for its
 * swipe, or data that a recovery request fetched afterwards.
 * @param {any} message
 * @returns {boolean}
 */
export function replyLacksTracker(message) {
    if (!isReplyMessage(message)) return false;
    if (wasRecovered(message)) return true;
    return !hasTrackerData(swipeEntryOf(message));
}

/**
 * The last finished reply in the chat, skipping tool-call records, the
 * user's own messages and system notes. A reply that a tool record directly
 * follows is the first half of a turn still in progress (the model called a
 * tool mid-reply and the continuation is being generated): it has had no
 * MESSAGE_RECEIVED, so it is skipped too. Null when there is none.
 * @param {any[]} chat
 * @returns {any|null}
 */
export function lastReply(chat) {
    if (!Array.isArray(chat)) return null;
    for (let i = chat.length - 1; i >= 0; i--) {
        const m = chat[i];
        if (!m || typeof m !== 'object') continue;
        if (m.is_user || m.is_system) continue;
        if (Array.isArray(m.extra?.tool_invocations)) continue;
        const next = chat[i + 1];
        if (next && Array.isArray(next.extra?.tool_invocations)) continue;
        return m;
    }
    return null;
}

/**
 * The earlier parts of the same turn, nearest first. When the model calls a
 * tool mid-reply, SillyTavern keeps whatever it had streamed so far as its
 * own message, records the call, and the continuation becomes a new message.
 * Only the continuation gets a MESSAGE_RECEIVED, so a block written in the
 * first part would otherwise go unread. The walk stops at the user's message
 * that started the turn, or at any other system note.
 * @param {any[]} chat
 * @param {number} index - index of the continuation
 * @returns {any[]}
 */
export function earlierPartsOfTurn(chat, index) {
    const parts = [];
    if (!Array.isArray(chat)) return parts;
    for (let i = index - 1; i >= 0; i--) {
        const m = chat[i];
        if (!m || typeof m !== 'object') break;
        if (Array.isArray(m.extra?.tool_invocations)) continue;
        if (m.is_user || m.is_system) break;
        parts.push(m);
    }
    return parts;
}

/**
 * Parsed tracker data from an earlier part of the same turn, or null.
 * @param {any[]} chat
 * @param {number} index - index of the continuation
 * @param {(text: string) => any} parse - parseResponse
 * @returns {any|null}
 */
export function adoptBlockFromTurn(chat, index, parse) {
    for (const part of earlierPartsOfTurn(chat, index)) {
        if (typeof part.mes !== 'string' || !part.mes) continue;
        let parsed = null;
        try { parsed = parse(part.mes); } catch (e) { parsed = null; }
        if (parsed && !parsed.parsingFailed) return parsed;
    }
    return null;
}

/**
 * Whether a recovery request should follow a fresh reply that failed to
 * parse. Together mode only, behind its switch, and only while at least one
 * tracker section is on (the request would otherwise ask for nothing).
 * @param {object} settings - extensionSettings
 * @param {{ fresh: boolean, parsingFailed: boolean, message: any }} reply
 * @returns {boolean}
 */
export function shouldRecoverTracker(settings, { fresh, parsingFailed, message }) {
    if (!settings || !settings.enabled) return false;
    if (settings.generationMode !== 'together') return false;
    if (settings.recoverMissingTracker === false) return false;
    if (!fresh || !parsingFailed) return false;
    if (!isReplyMessage(message)) return false;
    if (!settings.showInfoBox && !settings.showCharacterThoughts && !settings.showQuests) return false;
    return true;
}
