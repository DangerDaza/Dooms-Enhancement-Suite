/**
 * Quest hooks (docs/hooks-canon-plan.md D100–D104): the Map window's Hooks
 * panel. One background request (the tracker's profile) offers up to three
 * things the player could do next, grounded in what the world shows (the
 * clocks' public effects, the rumours, who was last seen where, the places
 * visited) and in what the quests hold; a hook taken becomes a quest on
 * the shelf's Quests page, with Cut to it on request; a hook set aside is
 * not offered again. Kept per chat in chat_metadata.dooms_hooks. The pure
 * parts are src/utils/questHooks.js. Loaded with the Map window.
 */
import { getContext } from '../../../../../../extensions.js';
import { chat, chat_metadata, saveChatDebounced, saveChatConditional } from '../../../../../../../script.js';
import { extensionSettings, lastGeneratedData, committedTrackerData, addDebugLog } from '../../core/state.js';
import { withBackgroundProfile, BACKGROUND_BUSY, generateWithExternalAPI } from '../generation/apiClient.js';
import { safeGenerateRaw } from '../../utils/responseExtractor.js';
import { sceneFactsFrom, normalizeQuests } from '../../utils/questCut.js';
import { buildRecentText } from '../../utils/liveWorld.js';
import {
    normalizeHooks, buildHooksPrompt, parseHooksReply, validateHooks, proposeRound, failRound,
    takeHook as takeHookPure, setAside as setAsidePure, questFromHook,
} from '../../utils/questHooks.js';
import { getWorldState, getActivePack, isLiveWorldOn } from './liveWorld.js';
import { getCompletedQuests, startQuestCut } from './questCut.js';
import { resolvePersonaName } from './diceRolls.js';

export const HOOKS_CHANGED_EVENT = 'dooms:hooks-changed';
const META_KEY = 'dooms_hooks';

let proposing = false;
let transport = null;    // test hook: ({ system, user }) => Promise<string>

function log(message, data = null) {
    try { addDebugLog(`[Hooks] ${message}`, data); } catch (e) { /* no log */ }
}

function notify(detail = {}) {
    try { window.dispatchEvent(new CustomEvent(HOOKS_CHANGED_EVENT, { detail })); } catch (e) { /* no window (tests) */ }
}

function chatArray() {
    if (Array.isArray(chat)) return chat;
    try { const c = getContext().chat; return Array.isArray(c) ? c : []; } catch (e) { return []; }
}

function chatId() {
    try { return getContext().chatId; } catch (e) { return undefined; }
}

function read() {
    const meta = chat_metadata;
    return normalizeHooks(meta && typeof meta === 'object' ? meta[META_KEY] : null);
}

function write(next, { immediate = false, source = 'hooks' } = {}) {
    if (chat_metadata && typeof chat_metadata === 'object') chat_metadata[META_KEY] = next;
    try {
        if (immediate) Promise.resolve(saveChatConditional()).catch(e => log('chat save failed', String(e && e.message || e)));
        else saveChatDebounced();
    } catch (e) { /* no chat open */ }
    notify({ source });
}

/** The newest reply's stamp (Live World's), for a round to be tied to; null when the reply has none. */
function lastReplyKey() {
    const list = chatArray();
    for (let i = list.length - 1; i >= 0; i--) {
        const m = list[i];
        if (!m || m.is_user || (m.extra && Array.isArray(m.extra.tool_invocations))) continue;
        return typeof m.dooms_world_id === 'string' && m.dooms_world_id ? m.dooms_world_id : null;
    }
    return null;
}

function playerNames() {
    const names = [];
    const add = (v) => { const t = String(v || '').trim(); if (t && !names.some(n => n.toLowerCase() === t.toLowerCase())) names.push(t); };
    try { add(resolvePersonaName()); } catch (e) { /* none */ }
    try { add(getContext().name1); } catch (e) { /* none */ }
    return names;
}

/** This chat's hooks: the round on offer, the taken, the set aside, the last run. A copy. */
export function getHooks() {
    return read();
}

export function isProposing() {
    return proposing;
}

export function __setHooksTransport(fn) {
    transport = typeof fn === 'function' ? fn : null;
}

/**
 * Asks the world for a round of hooks (D100: on request, never on a
 * cadence). Nothing is written when the reply holds no usable hook; the
 * round on offer stays and the failure is noted.
 * @returns {Promise<{ ok: boolean, reason?: string, hooks?: object[], errors?: string[], error?: string }>}
 */
export async function proposeHooks({ reason = 'manual' } = {}) {
    if (!isLiveWorldOn()) return { ok: false, reason: 'off' };
    const state = getWorldState();
    const pack = getActivePack();
    if (!state || !pack) return { ok: false, reason: 'off' };
    if (proposing) return { ok: false, reason: 'running' };
    proposing = true;
    notify({ source: 'hooks-start' });
    const startedChat = chatId();
    const startedMeta = chat_metadata;
    const stale = () => chat_metadata !== startedMeta || (chatId() !== undefined && chatId() !== startedChat);
    try {
        const current = read();
        const quests = normalizeQuests(extensionSettings.quests);
        const done = getCompletedQuests();
        const players = playerNames();
        const now = sceneFactsFrom(lastGeneratedData.infoBox || committedTrackerData.infoBox);
        const recent = buildRecentText(chatArray(), { count: 12, persona: players[0] || 'Player' });
        const prompt = buildHooksPrompt({ pack, state, quests, done, taken: current.taken, aside: current.aside, recent, now, player: players });
        const external = extensionSettings.generationMode === 'external';
        const messages = [{ role: 'system', content: prompt.system }, { role: 'user', content: prompt.user }];
        const run = async () => {
            if (transport) return transport(prompt);
            if (external) return generateWithExternalAPI(messages);
            return safeGenerateRaw({ prompt: messages, quietToLoud: false });
        };
        log(`hooks (${reason}) requested`, { world: pack.id });
        const result = await withBackgroundProfile(run, { external, label: 'hooks' });
        if (stale()) return { ok: false, reason: 'stale' };
        if (result === BACKGROUND_BUSY) return { ok: false, reason: 'busy' };
        const text = typeof result === 'string' ? result : (result && typeof result === 'object' && typeof result.text === 'string' ? result.text : String(result ?? ''));
        const v = validateHooks(parseHooksReply(text), { quests, done, taken: current.taken, aside: current.aside });
        const ranAt = Date.now();
        const msgId = lastReplyKey();
        if (!v.ok) {
            write(failRound(current, { error: v.errors.join(' '), ranAt, msgId }), { immediate: true, source: 'failed' });
            log('hooks discarded', { errors: v.errors, reply: text.slice(0, 400) });
            return { ok: false, reason: 'invalid', errors: v.errors };
        }
        write(proposeRound(current, v.hooks, { msgId, gameDate: now.date || '', ranAt }), { immediate: true, source: 'offered' });
        log('hooks offered', v.hooks.map(h => h.title));
        return { ok: true, hooks: v.hooks, errors: v.errors };
    } catch (e) {
        const error = String(e && e.message || e);
        if (!stale()) write(failRound(read(), { error, ranAt: Date.now(), msgId: lastReplyKey() }), { immediate: true, source: 'failed' });
        log('hooks failed', error);
        return { ok: false, reason: 'error', error };
    } finally {
        proposing = false;
        notify({ source: 'hooks-end' });
    }
}

/**
 * A hook taken (D102): a quest on the shelf's Quests page, once; with
 * `cut`, Cut to it as well (the next reply montages the way to it).
 * @returns {Promise<{ ok: boolean, reason?: string, quest?: string, cut?: boolean, error?: string }>}
 */
export async function takeHook(id, { cut = false, when = '' } = {}) {
    const r = takeHookPure(read(), id, { takenAt: Date.now() });
    if (!r.hook) return { ok: false, reason: 'no-hook' };
    const quest = questFromHook(r.hook);
    try {
        const shelf = await import('../ui/shelfPages.js');
        shelf.addOptionalQuest(quest);
    } catch (e) {
        const error = String(e && e.message || e);
        log('the quest could not be written to the shelf', error);
        return { ok: false, reason: 'error', error };
    }
    write(r.hooks, { immediate: true, source: 'taken' });
    log(`hook taken: ${r.hook.title}`);
    if (cut) {
        const started = await startQuestCut({ quest, when });
        return { ok: true, quest, cut: !!started };
    }
    return { ok: true, quest, cut: false };
}

/** A hook set aside (D103): off the round, and not offered again. */
export function setHookAside(id) {
    const r = setAsidePure(read(), id);
    if (!r.hook) return false;
    write(r.hooks, { source: 'aside' });
    log(`hook set aside: ${r.hook.title}`);
    return true;
}
