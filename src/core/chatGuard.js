/**
 * The chat the extension's per-chat data was loaded for
 * (docs/long-shot-plan.md D215).
 *
 * Everything the extension keeps a chat at a time (the tracker, the
 * world, the ledger, the inventory, the scene in front) is loaded by its
 * chat-change handlers, which SillyTavern calls one after another when it
 * announces a chat. SillyTavern waits for each listener before it calls
 * the next, the extension's among every other extension's: one that does
 * not finish, anywhere before them, and they are never called. The data
 * then stays the last chat's, and the windows that read it (the Atlas,
 * the World Builder) show the last chat as the one in front, with nothing
 * to say so.
 *
 * So the extension notes which chat its handlers last ran to the end
 * for, and where that matters (a window opened on the chat, a message
 * sent, a reply asked for) it checks that this is still the chat in
 * front. When it is not, the handlers are run then.
 */
import { getContext } from '../../../../../extensions.js';
import { addDebugLog } from './state.js';

let loaders = [];     // the chat-change handlers, in the order they are registered
let loaded = null;    // the chat they last ran to the end for: { who, id }; null before any
let running = null;

/** The chat in front: whose it is (the card, or the group; '' for the moment SillyTavern is reading its cards again) and its file. Null when no chat is open. */
function chatNow() {
    try {
        const c = getContext();
        if (!c || !c.chatId) return null;
        const who = c.groupId ? `group:${c.groupId}` : (c.characterId !== undefined && c.characterId !== null && c.characters && c.characters[c.characterId] ? String(c.characters[c.characterId].avatar || '') : '');
        return { who, id: String(c.chatId) };
    } catch (e) {
        return null;
    }
}

const nameOf = (c) => (c ? `${c.who ? `${c.who}/` : ''}${c.id}` : 'no chat');
/** The same chat: the same file, under the same card where both are known (two cards can each have a chat of one name). */
const sameChat = (a, b) => !!a && !!b && a.id === b.id && (!a.who || !b.who || a.who === b.who);

/** The chat-change handlers, as they are registered with SillyTavern: what is run again when the data is another chat's. */
export function setChatLoaders(list) {
    loaders = (Array.isArray(list) ? list : []).filter(fn => typeof fn === 'function' && fn !== chatLoaded);
}

/** The last of the chat-change handlers: the others have run for the chat in front. */
export function chatLoaded() {
    loaded = chatNow();
}

/** Whether the data is another chat's: a chat is in front, and the handlers did not last run to the end for it. */
export function chatStateIsStale() {
    const now = chatNow();
    return !!now && loaders.length > 0 && !sameChat(loaded, now);
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/**
 * The data made the chat in front's, where it is not. SillyTavern may be
 * about to announce the chat itself (it swaps the chat in a moment before
 * it says so): `wait` is how long that is given first. Asked again while
 * it runs, the same run answers.
 * @returns {Promise<{ reloaded: boolean, was?: string, now?: string }>}
 */
export function ensureChatState({ wait = 1500 } = {}) {
    if (!chatStateIsStale()) return Promise.resolve({ reloaded: false });
    if (running) return running;
    running = (async () => {
        const until = Date.now() + Math.max(0, wait);
        while (chatStateIsStale() && Date.now() < until) await sleep(100);
        if (!chatStateIsStale()) return { reloaded: false };
        const was = nameOf(loaded);
        const now = chatNow();
        if (!now) return { reloaded: false };
        for (const fn of loaders) {
            try { await fn(now.id); } catch (e) { console.warn('[Dooms Tracker] A chat-change handler failed while the chat\'s data was loaded again:', e); }
        }
        // Only when the chat in front is still the one the handlers ran for: another opened meanwhile is its own run.
        if (sameChat(chatNow(), now)) loaded = now;
        try { addDebugLog(`[Chat] the extension's data was for "${was}" and the chat in front is "${nameOf(now)}": loaded again for it`); } catch (e) { /* no log */ }
        console.warn(`[Dooms Tracker] The extension's per-chat data was for "${was}", not the chat in front ("${nameOf(now)}"). SillyTavern did not reach the extension's chat-change handlers (a listener before them did not finish); they were run now.`);
        return { reloaded: true, was, now: nameOf(now) };
    })().finally(() => { running = null; });
    return running;
}

/** For a list of event handlers: the data is the chat in front's before the rest run. No wait: a message is not sent, nor a reply asked for, while a chat is still being opened. */
export function guardChatState() {
    return chatStateIsStale() ? ensureChatState({ wait: 0 }) : undefined;
}
