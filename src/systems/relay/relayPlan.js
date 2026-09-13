/**
 * Generation Relay — pure decision helpers (no SillyTavern imports).
 *
 * Everything here is plain data in / plain data out so it can be unit-tested
 * in Node (tools/relay-plan-test.mjs). relayRecovery.js turns the plans into
 * chat edits; relayClient.js uses the SSE helpers to read stored streams.
 */

/** Generation kinds the recovery can put straight into the chat. */
export const CHAT_KINDS = new Set(['normal', 'regenerate', 'swipe']);

/** Kinds DES itself tagged: applied silently (tracker) or dropped (internal). */
export const DES_TRACKER_KIND = 'des-tracker';
export const DES_INTERNAL_KIND = 'des-internal';

const PLACEHOLDERS = new Set(['', '...']);

/**
 * Splits raw SSE text into the `data:` payload strings, one per event, in
 * order. Comment lines (`: ping`) and other fields are ignored, exactly like
 * SillyTavern's EventSourceStream.
 * @param {string} text
 * @returns {string[]}
 */
export function parseSseData(text) {
    const out = [];
    if (typeof text !== 'string' || !text) return out;
    for (const chunk of text.split(/\r\n\r\n|\r\r|\n\n/)) {
        let data = '';
        for (const line of chunk.split(/\r\n|\r|\n/)) {
            const m = /^([^:]+)(?:: ?(.*))?$/.exec(line);
            if (!m) continue;
            if (m[1] === 'data') data += (m[2] || '') + '\n';
        }
        if (data === '') continue;
        out.push(data.endsWith('\n') ? data.slice(0, -1) : data);
    }
    return out;
}

/**
 * Folds stored SSE events into the reply text using SillyTavern's own
 * per-provider delta reader (passed in so this module stays import-free).
 * Stops at `[DONE]`. Returns the accumulated text/reasoning and any in-band
 * error event the relay injected.
 * @param {string} sseText raw body as stored by the relay
 * @param {(parsed: object, state: object) => string} readDelta ST's getStreamingReply bound to the source
 * @returns {{ text: string, reasoning: string, error: string|null, events: number }}
 */
export function foldStream(sseText, readDelta) {
    const state = { reasoning: '', images: [], signature: '', toolSignatures: {} };
    let text = '';
    let error = null;
    let events = 0;
    for (const data of parseSseData(sseText)) {
        if (data === '[DONE]') break;
        let parsed;
        try {
            parsed = JSON.parse(data);
        } catch {
            continue;
        }
        events++;
        if (parsed && parsed.error && !parsed.choices && !parsed.delta && !parsed.candidates) {
            error = String(parsed.error.message || parsed.error);
            continue;
        }
        try {
            text += readDelta(parsed, state) || '';
        } catch (e) {
            // one malformed event must not lose the rest of the reply
            console.debug('[DES Relay] delta read failed', e);
        }
    }
    return { text, reasoning: state.reasoning || '', error, events };
}

/**
 * True when what the chat currently holds is nothing, a placeholder, or an
 * unfinished prefix of the full reply — i.e. safe to overwrite.
 */
export function isPrefixOrEmpty(existing, full) {
    if (typeof existing !== 'string') return false;
    if (PLACEHOLDERS.has(existing.trim())) return true;
    const e = existing.trimEnd();
    return e.length < full.length && full.startsWith(e);
}

/**
 * Decides how a finished chat-kind generation lands in the chat that is open
 * now. Never destructive: an existing message that is not a prefix of the
 * recovered text is kept and the reply becomes a new swipe or goes to the
 * tray.
 *
 * @param {{kind: string, messageIndex?: number, swipeId?: number}} meta
 * @param {Array<{is_user?: boolean, mes?: string, swipes?: string[], swipe_id?: number}>} chat
 * @param {string} text the full recovered reply (already trimmed of nothing)
 * @returns {{action: 'noop'|'replace'|'append'|'swipe-replace'|'swipe-add'|'tray', index?: number, swipeId?: number, reason?: string}}
 */
export function planReplyApply(meta, chat, text) {
    const kind = meta?.kind;
    if (!CHAT_KINDS.has(kind)) return { action: 'tray', reason: 'kind' };
    if (typeof text !== 'string' || !text.trim()) return { action: 'noop', reason: 'empty' };
    if (!Array.isArray(chat)) return { action: 'tray', reason: 'no-chat' };
    const index = Number.isInteger(meta.messageIndex) ? meta.messageIndex : -1;
    const last = chat.length - 1;

    if (kind === 'swipe') {
        const m = chat[index];
        if (!m || m.is_user || index !== last) return { action: 'tray', reason: 'target' };
        const swipes = Array.isArray(m.swipes) ? m.swipes : [m.mes ?? ''];
        if (swipes.some(s => s === text)) return { action: 'noop', reason: 'present' };
        const sid = Number.isInteger(meta.swipeId) ? meta.swipeId : -1;
        if (sid >= 0 && sid < swipes.length && isPrefixOrEmpty(swipes[sid], text)) {
            return { action: 'swipe-replace', index, swipeId: sid };
        }
        return { action: 'swipe-add', index };
    }

    // normal / regenerate
    const existing = chat[index];
    if (existing && !existing.is_user) {
        if (existing.mes === text) return { action: 'noop', reason: 'present' };
        if (Array.isArray(existing.swipes) && existing.swipes.includes(text)) return { action: 'noop', reason: 'present' };
        if (isPrefixOrEmpty(existing.mes, text)) return { action: 'replace', index };
        if (kind === 'regenerate' && index === last) return { action: 'swipe-add', index };
        return { action: 'tray', reason: 'conflict' };
    }
    if (!existing && index === chat.length && chat.length > 0 && chat[last].is_user) {
        return { action: 'append', index };
    }
    return { action: 'tray', reason: 'target' };
}

/**
 * Builds the stable identity of the open chat used to file relay jobs.
 * Group chats are not supported in v1 (one job per member) → null.
 */
export function chatKeyOf({ groupId, characterAvatar, chatId }) {
    if (groupId) return null;
    if (!characterAvatar || !chatId) return null;
    return `c:${characterAvatar}:${chatId}`;
}

/**
 * Picks the generation kind for a request about to be sent. `started` is the
 * GENERATION_STARTED type seen since the last request (with its timestamp),
 * `tagged` is DES's own marker (des-tracker / des-internal) — the newer wins.
 */
export function resolveKind(args) {
    return resolveMarker(args).kind;
}

/**
 * Like resolveKind, but also says which marker won so the caller can clear
 * only that one: a DES helper request that fires between a user's
 * GENERATION_STARTED and its fetch must not eat the user's marker.
 * @returns {{kind: string, from: 'started'|'tagged'|null}}
 */
export function resolveMarker({ started, tagged, now = Date.now(), maxAgeMs = 120000 }) {
    const fresh = (x) => x && typeof x.at === 'number' && now - x.at <= maxAgeMs;
    const s = fresh(started) ? started : null;
    const t = fresh(tagged) ? tagged : null;
    if (s && t) return s.at >= t.at ? { kind: normalizeType(s.type), from: 'started' } : { kind: t.kind, from: 'tagged' };
    if (t) return { kind: t.kind, from: 'tagged' };
    if (s) return { kind: normalizeType(s.type), from: 'started' };
    return { kind: 'raw', from: null };
}

export function normalizeType(type) {
    if (!type || type === 'normal') return 'normal';
    if (['regenerate', 'swipe', 'continue', 'impersonate', 'quiet'].includes(type)) return type;
    return String(type);
}
