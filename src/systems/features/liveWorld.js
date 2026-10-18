/**
 * Live World (docs/live-world-spec.md): the part that touches the chat.
 *
 *   - the per-chat state under its own key, chat_metadata.dooms_world (G2),
 *     loaded on CHAT_CHANGED and seeded from the pack for a new chat;
 *   - each fresh reply counted once by an id stamped on the message (G3),
 *     the tracker's present characters marked known;
 *   - the advancer: every N counted replies, after a failed run, from
 *     /advance or the dashboard; never while DES or the tracker request is
 *     generating (withBackgroundProfile holds the flag and the tracker's
 *     connection profile); its reply validated whole or discarded;
 *   - blind injection (G4): the world lines through SillyTavern's own
 *     setExtensionPrompt, at a configurable depth and role, never through
 *     the Context Inspector's recorder; no toasts, the System Log only;
 *   - the /advance and /liveworld slash commands (G5).
 *
 * The pure parts are src/utils/liveWorld.js; the dashboard is
 * src/systems/ui/worldDashboard.js (lazy).
 */
import { getContext } from '../../../../../../extensions.js';
import { chat, chat_metadata, saveChatDebounced, saveChatConditional, setExtensionPrompt, extension_prompt_types, extension_prompt_roles, eventSource } from '../../../../../../../script.js';
import * as ST from '../../../../../../../script.js';    // is_send_press read by name: a build without it reads undefined, not a link error
import { SlashCommandParser } from '../../../../../../../scripts/slash-commands/SlashCommandParser.js';
import { SlashCommand } from '../../../../../../../scripts/slash-commands/SlashCommand.js';
import { extensionFolderPath } from '../../core/config.js';
import { extensionSettings, lastGeneratedData, committedTrackerData, addDebugLog, setMainGenerationStartedAt } from '../../core/state.js';
import { withBackgroundProfile, BACKGROUND_BUSY, generateWithExternalAPI, DOOMS_TRACKER_UPDATE_COMPLETE, parseCharacterEntriesFromThoughts } from '../generation/apiClient.js';
import { safeGenerateRaw } from '../../utils/responseExtractor.js';
import { sceneFactsFrom } from '../../utils/questCut.js';
import { resolvePersonaName } from './diceRolls.js';
import {
    WORLD_SLOT,
    liveWorldConfig,
    normalizePack,
    seedWorldState,
    normalizeWorldState,
    countMessage,
    advanceDue,
    markKnown,
    reconcileWithChat,
    clampClocksToPack,
    buildWorldLines,
    buildAdvancePrompt,
    buildRecentText,
    parseAdvanceReply,
    validateAdvance,
    applyAdvance,
    failAdvance,
    sameName,
} from '../../utils/liveWorld.js';

export const WORLD_CHANGED_EVENT = 'dooms:world-changed';
export const BUILTIN_PACKS = Object.freeze(['skyreach', 'example']);
const META_KEY = 'dooms_world';

let state = null;            // this chat's world state, or null while off or unseeded
let activePack = null;       // the pack the state belongs to
let packError = '';          // why the pack could not be used, for the dashboard
let loadToken = 0;           // bumped by every chat load; an advance that outlives its chat is discarded
let loadedMeta = null;       // the chat_metadata object the state was loaded from: SillyTavern swaps it before CHAT_CHANGED reaches this module
let loadedChat = undefined;  // and the chat id at that load
let trackerToken = 0;        // the load whose reply asked for the tracker's request; a completion from another chat is not this chat's
let advancing = false;
let pendingReason = '';      // an advance that waits: on the tracker request, another background request or the main generation
let pendingOn = '';          // what it waits for: 'tracker', 'background' or 'generation'
let pendingTimer = null;     // the fallback for a wait that nothing ends (the tracker skipped its request)
let generationStartedAt = 0; // SillyTavern's GENERATION_STARTED without its end yet; automatic advances wait for it
let inherit = null;          // a regenerate: { id, index } the reply replacing the deleted one takes over its id
let transport = null;        // test hook: ({ system, user }) => Promise<string>
const packCache = new Map();
const PENDING_FALLBACK_MS = 20000;
const GENERATION_START_STALE_MS = 15000;    // a start with no end (a slash command typed as a message) is forgotten after this

// ─── Helpers ────────────────────────────────────────────────────────────────

function cfg() {
    return liveWorldConfig(extensionSettings);
}

/** The master switch and DES's own. */
export function isLiveWorldOn() {
    return !!extensionSettings.enabled && cfg().enabled;
}

/** The state is usable only for the chat it was loaded from. */
function ready() {
    if (!isLiveWorldOn() || !state || !activePack) return false;
    if (chat_metadata !== loadedMeta) return false;    // the chat was swapped under the state and its CHAT_CHANGED is still to come
    const id = chatId();
    return id === undefined || id === loadedChat;      // undefined for a moment while SillyTavern reloads its character list: not another chat
}

const isToolRecord = (m) => !!(m && m.extra && Array.isArray(m.extra.tool_invocations));

function chatArray() {
    if (Array.isArray(chat)) return chat;
    try { const c = getContext().chat; return Array.isArray(c) ? c : null; } catch (e) { return null; }
}

function chatId() {
    try { return getContext().chatId; } catch (e) { return undefined; }
}

function log(message, data = null) {
    try { addDebugLog(`[Live World] ${message}`, data); } catch (e) { /* no log */ }
    if (cfg().debug) {
        try { console.debug(`[Live World] ${message}`, data ?? ''); } catch (e) { /* no console */ }
    }
}

function notify(detail = {}) {
    try {
        window.dispatchEvent(new CustomEvent(WORLD_CHANGED_EVENT, { detail }));
    } catch (e) { /* no window (tests) */ }
}

function clone(v) {
    return JSON.parse(JSON.stringify(v));
}

// ─── Packs ──────────────────────────────────────────────────────────────────

/**
 * A pack by id: a custom pack pasted into Settings first, then a built-in
 * one from the extension's worldpacks folder. Cached for the session;
 * `fresh` reloads.
 * @returns {Promise<{ ok: boolean, pack: object|null, errors: string[] }>}
 */
export async function loadPack(id, { fresh = false } = {}) {
    const key = String(id || '').trim();
    if (!key) return { ok: false, pack: null, errors: ['No pack chosen.'] };
    if (!fresh && packCache.has(key)) return packCache.get(key);
    let raw = null;
    const custom = cfg().customPacks[key];
    if (custom !== undefined) {
        try { raw = typeof custom === 'string' ? JSON.parse(custom) : custom; } catch (e) { return { ok: false, pack: null, errors: [`The pasted pack "${key}" is not valid JSON: ${e.message}`] }; }
    } else {
        try {
            const res = await fetch(`/${extensionFolderPath}/worldpacks/${encodeURIComponent(key)}.json`, { cache: 'no-cache' });
            if (!res.ok) return { ok: false, pack: null, errors: [`No pack named "${key}" (${res.status}).`] };
            raw = await res.json();
        } catch (e) {
            return { ok: false, pack: null, errors: [`The pack "${key}" could not be read: ${e.message}`] };
        }
    }
    const out = normalizePack(raw);
    const result = { ok: out.ok, pack: out.ok ? out.pack : null, errors: out.errors };
    packCache.set(key, result);
    return result;
}

/** Forgets a cached pack (after a paste or an edit). */
export function forgetPack(id) {
    packCache.delete(String(id || '').trim());
}

/** The packs on offer: the built-in ones and the pasted ones. */
export function listPackIds() {
    return [...new Set([...BUILTIN_PACKS, ...Object.keys(cfg().customPacks)])];
}

/**
 * Stores a pasted pack under its own id (Settings). Returns the normalised
 * pack or the errors; nothing is stored when it is unusable.
 */
export function addCustomPack(json) {
    let raw;
    try { raw = typeof json === 'string' ? JSON.parse(json) : json; } catch (e) { return { ok: false, errors: [`Not valid JSON: ${e.message}`], pack: null }; }
    const out = normalizePack(raw);
    if (!out.ok) return { ok: false, errors: out.errors, pack: out.pack };
    if (!extensionSettings.liveWorld || typeof extensionSettings.liveWorld !== 'object') extensionSettings.liveWorld = {};
    if (!extensionSettings.liveWorld.customPacks || typeof extensionSettings.liveWorld.customPacks !== 'object') extensionSettings.liveWorld.customPacks = {};
    extensionSettings.liveWorld.customPacks[out.pack.id] = JSON.stringify(raw);
    forgetPack(out.pack.id);
    return { ok: true, errors: [], pack: out.pack };
}

/** Removes a pasted pack. */
export function removeCustomPack(id) {
    const packs = extensionSettings.liveWorld && extensionSettings.liveWorld.customPacks;
    if (packs && typeof packs === 'object' && id in packs) { delete packs[id]; forgetPack(id); return true; }
    return false;
}

export function getActivePack() {
    return activePack;
}

export function getPackError() {
    return packError;
}

// ─── The state ──────────────────────────────────────────────────────────────

/** A copy of this chat's world state, or null. */
export function getWorldState() {
    return state ? clone(state) : null;
}

/**
 * Writes the state to the chat. Commit points (a seed, an advance, a
 * failed advance, a rewind) save at once: a debounced write is lost when
 * the user switches chats before it fires. A count saves debounced.
 */
function commit(next, detail, { immediate = false } = {}) {
    state = next;
    if (chat_metadata && typeof chat_metadata === 'object') chat_metadata[META_KEY] = clone(state);
    try {
        if (immediate) Promise.resolve(saveChatConditional()).catch(e => log('chat save failed', String(e && e.message || e)));
        else saveChatDebounced();
    } catch (e) { /* no chat open */ }
    notify(detail);
}

function clearWorldSlot() {
    try { setExtensionPrompt(WORLD_SLOT, '', extension_prompt_types.IN_CHAT, cfg().depth, false, extension_prompt_roles.SYSTEM); } catch (e) { /* no ST */ }
}

/** The chat's stamped ids, in order, once each: a hidden reply (/hide) still stands; a tool record and a user message never carry one. */
function presentReplyIds() {
    const list = chatArray();
    if (!list) return [];
    const ids = [];
    const seen = new Set();
    for (const m of list) {
        const id = m && typeof m.dooms_world_id === 'string' ? m.dooms_world_id : '';
        if (id && !seen.has(id)) { seen.add(id); ids.push(id); }
    }
    return ids;
}

/** A state ahead of its chat (a branch, a checkpoint, deleted replies) is wound back to it. */
function reconcile(detail) {
    if (!ready()) return false;
    const r = reconcileWithChat(state, presentReplyIds(), { pack: activePack });
    if (r.state === state) return false;
    log(`the chat no longer holds ${r.undone} change(s) and ${r.pruned} counted repl${r.pruned === 1 ? 'y' : 'ies'}; the state follows it`);
    commit(r.state, { source: 'rewind', ...detail }, { immediate: true });
    return true;
}

/**
 * CHAT_CHANGED: this chat's world. A chat keeps the pack it was seeded
 * with; a new chat is seeded with the pack chosen in Settings. A pack that
 * cannot be used leaves the chat without a world (the dashboard says why)
 * and the advancer never runs on empty state.
 */
export async function onWorldChatChanged() {
    const token = ++loadToken;
    state = null;
    activePack = null;
    packError = '';
    pendingReason = '';
    pendingOn = '';
    inherit = null;
    trackerToken = 0;
    loadedMeta = null;
    loadedChat = undefined;
    if (pendingTimer) { clearTimeout(pendingTimer); pendingTimer = null; }
    if (!isLiveWorldOn()) { clearWorldSlot(); notify({ source: 'chat' }); return; }
    const id = chatId();
    if (!id) { clearWorldSlot(); notify({ source: 'chat' }); return; }    // no chat open: nothing to seed or keep
    const meta = chat_metadata;
    const raw = meta && typeof meta === 'object' ? meta[META_KEY] : null;
    const stored = raw && typeof raw === 'object' && raw.seeded === true ? normalizeWorldState(raw) : null;
    const packId = stored && stored.pack ? stored.pack : cfg().pack;
    const res = await loadPack(packId);
    if (token !== loadToken || chat_metadata !== meta) return;    // another chat opened meanwhile (or was swapped in, its CHAT_CHANGED to come)
    loadedMeta = meta;
    loadedChat = id;
    if (!res.ok) {
        packError = res.errors.join(' ');
        log(`the pack "${packId}" cannot be used`, res.errors);
        notify({ source: 'chat' });
        return;
    }
    activePack = res.pack;
    if (stored) {
        const clamped = clampClocksToPack(stored, activePack);
        state = clamped.state;
        if (clamped.changed) commit(state, { source: 'clamp' }, { immediate: true });
        reconcile({ at: 'load' });
    } else {
        state = seedWorldState(activePack);
        commit(state, { source: 'seed' }, { immediate: true });
        log(`seeded from "${activePack.name}"`);
    }
    notify({ source: 'chat' });
}

/**
 * Throws the chat's world away and seeds it again from the chosen pack
 * (Settings). The pack is loaded first: when it cannot be used the old
 * world stays and `getPackError()` says why.
 */
export async function reseedWorld() {
    if (!isLiveWorldOn()) return { ok: false, error: 'Live World is off.' };
    if (!chatId()) return { ok: false, error: 'No chat is open.' };
    const res = await loadPack(cfg().pack, { fresh: true });
    if (!res.ok) {
        log(`re-seed refused: the pack "${cfg().pack}" cannot be used`, res.errors);
        return { ok: false, error: res.errors.join(' ') };    // the world stands; this chat's own packError is not touched
    }
    if (chat_metadata && typeof chat_metadata === 'object') delete chat_metadata[META_KEY];
    await onWorldChatChanged();
    return { ok: !!state, error: state ? '' : (packError || 'The world could not be seeded.') };
}

/** A stable id for a message, stamped on it the first time (a swipe keeps it). */
function messageKey(m) {
    if (!m || typeof m !== 'object') return '';
    if (typeof m.dooms_world_id === 'string' && m.dooms_world_id) return m.dooms_world_id;
    m.dooms_world_id = `w${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    return m.dooms_world_id;
}

/** The id of the newest reply, hidden or not, for a run to be stamped on; null when it has none. A tool record and a user message are skipped. */
function lastReplyKey() {
    const list = chatArray();
    if (!list) return null;
    for (let i = list.length - 1; i >= 0; i--) {
        const m = list[i];
        if (!m || m.is_user || isToolRecord(m)) continue;
        if (typeof m.dooms_world_id === 'string' && m.dooms_world_id) return m.dooms_world_id;
        if (!m.is_system) return null;    // a reply from before the world was on: the run is stamped on nothing, so it is never undone
    }
    return null;
}

/**
 * The id of the reply before the tool records that end just above `index`,
 * or '' when no tool record lies between: a reply that continues a tool call
 * is the same turn as the reply that made the call, one id and one count (D44).
 */
function turnIdBefore(list, index) {
    let i = index - 1;
    let records = 0;
    while (i >= 0 && isToolRecord(list[i])) { i--; records++; }
    if (!records || i < 0) return '';
    const prev = list[i];
    return prev && !prev.is_user && typeof prev.dooms_world_id === 'string' ? prev.dooms_world_id : '';
}

/** The player under every name the chat may carry: DES's persona name, SillyTavern's, and the name on their last message. */
function playerNames() {
    const names = [];
    const add = (v) => { const t = String(v || '').trim(); if (t && !names.some(n => n.toLowerCase() === t.toLowerCase())) names.push(t); };
    try { add(resolvePersonaName()); } catch (e) { /* none */ }
    try { add(getContext().name1); } catch (e) { /* none */ }
    const list = chatArray();
    if (list) for (let i = list.length - 1; i >= 0; i--) { const m = list[i]; if (m && m.is_user) { add(m.name); break; } }
    return names;
}

function knownNamesFromTracker() {
    try {
        const entries = parseCharacterEntriesFromThoughts(lastGeneratedData.characterThoughts || committedTrackerData.characterThoughts);
        const players = playerNames();
        return (entries || []).map(c => c && c.name).filter(n => n && !players.some(p => sameName(p, n)));
    } catch (e) {
        return [];
    }
}

/**
 * MESSAGE_RECEIVED: a fresh reply counts once; the tracker's present
 * characters become known; every N, the advancer runs. A reply that
 * continues a tool call shares the turn's id; a regenerate's reply takes
 * the deleted reply's; a reply hidden later (/hide) keeps standing.
 */
export function onWorldMessageReceived(messageId, type) {
    const list = chatArray();
    const m = list && list.length ? list[list.length - 1] : null;
    const reply = !!(m && !m.is_user && !m.is_system && !isToolRecord(m));
    if (reply && !(typeof m.dooms_world_id === 'string' && m.dooms_world_id)) {
        const shared = turnIdBefore(list, list.length - 1);    // the continuation of a tool call: the turn's own id
        if (shared) m.dooms_world_id = shared;
    }
    if (inherit && reply) {
        // A regenerate deleted the reply this one replaces: same slot, same id, counted once.
        const stamped = typeof m.dooms_world_id === 'string' && m.dooms_world_id;
        if (!stamped && !list.some(x => x && x.dooms_world_id === inherit.id)) { m.dooms_world_id = inherit.id; inherit = null; }
        else abandonInherit();    // a reply with its own id, or the slot's id standing elsewhere: the deleted one is not coming back
    }
    if (!ready()) return;
    if (type === 'first_message' || !list || list.length <= 1) return;    // a chat's first message is the greeting or an opener, not a reply
    if (!reply) return;
    if (trackerRequestExpected()) trackerToken = loadToken;    // the tracker's request for this reply is this chat's
    const r = countMessage(state, messageKey(m));
    let next = r.state;
    const names = knownNamesFromTracker();
    if (names.length) next = markKnown(next, names);
    if (!r.counted && next === state) return;
    commit(next, { source: 'count', counted: r.counted });
    if (r.counted && advanceDue(next, cfg().every)) {
        if (trackerRequestExpected()) waitFor('count', 'tracker');    // the tracker's own request first (D46), the advance after it
        else scheduleAdvance('count');
    }
}

/** MESSAGE_SENT: a new message from the player ends any regenerate that never produced its reply. */
export function onWorldMessageSent() {
    abandonInherit();
}

/**
 * A regenerate whose reply never came: the slot is void, and the state
 * follows the chat as after any deletion (the deleted reply's count goes;
 * a run stamped on it goes too when nothing newer stands).
 */
function abandonInherit() {
    if (!inherit) return;
    inherit = null;
    if (state) reconcile({ at: 'void' });
}

/** Whether DES will run its separate tracker request for the reply that just landed. */
function trackerRequestExpected() {
    if (!extensionSettings.enabled || !extensionSettings.autoUpdate) return false;
    if (extensionSettings.generationMode !== 'separate' && extensionSettings.generationMode !== 'external') return false;
    return !!(extensionSettings.showInfoBox || extensionSettings.showCharacterThoughts || extensionSettings.showQuests);
}

/**
 * Parks an advance until what it waits for ends: the tracker's request
 * ('tracker'), another background request ('background') or SillyTavern's
 * own generation ('generation'). A fallback runs it when nothing does.
 */
function waitFor(reason, on) {
    pendingReason = reason;
    pendingOn = on;
    const token = loadToken;
    if (pendingTimer) clearTimeout(pendingTimer);
    pendingTimer = setTimeout(() => {
        pendingTimer = null;
        if (token !== loadToken || !pendingReason) return;
        log('the wait ended by the fallback');
        flushPending('fallback');
    }, PENDING_FALLBACK_MS);
}

/** Runs the advance that waited, when the thing it waited for is what ended. */
function flushPending(ended) {
    if (!pendingReason) return;
    if (ended === 'generation' && pendingOn === 'tracker') return;    // the generation ended first; the tracker's request is still to come
    const reason = pendingReason;
    pendingReason = '';
    pendingOn = '';
    if (pendingTimer) { clearTimeout(pendingTimer); pendingTimer = null; }
    scheduleAdvance(reason);
}

/**
 * MESSAGE_DELETED: the state follows the chat. A regenerate's own deletion
 * is left alone (its reply is about to land in the slot); a deletion that
 * takes the slot itself ends the regenerate; the last replies gone wind
 * the world back, a reply gone from the middle only drops its count.
 */
export function onWorldMessageDeleted() {
    if (!ready()) return;
    const list = chatArray();
    if (inherit) {
        if (list && list.length === inherit.index) return;        // the regenerate's own deletion
        if (list && list.length < inherit.index) abandonInherit(); // the slot itself is gone
        else return;                                                // a deletion elsewhere while a regenerate runs
    }
    reconcile({ at: 'delete' });
}

/** After the tracker request (separate mode): names it brought become known, and an advance that waited runs. */
export function onWorldTrackerUpdateComplete() {
    if (!ready()) return;
    if (trackerToken !== loadToken) return;    // a request this chat's replies did not ask for (another chat's, in flight across the switch): not its names, not its wait
    trackerToken = 0;
    const names = knownNamesFromTracker();
    if (names.length) {
        const next = markKnown(state, names);
        if (JSON.stringify(next.known) !== JSON.stringify(state.known)) commit(next, { source: 'known' });
    }
    flushPending('tracker');
}

/** GENERATION_ENDED and GENERATION_STOPPED: the main generation is over; an advance that waited on it runs now. */
export function onWorldGenerationEnded() {
    generationStartedAt = 0;
    setMainGenerationStartedAt(0);
    if (!ready()) return;
    flushPending('generation');
}

/**
 * SillyTavern's own generation is running. Its send flag is the sure sign
 * (every path out of Generate clears it), but a plain send raises it only
 * after the slash commands and a server ping, so an automatic advance
 * also waits from GENERATION_STARTED until the end (a start with no end,
 * a slash command typed as a message, is forgotten after fifteen seconds).
 * A manual advance (/advance, the buttons) trusts the flag alone, so a
 * typed /advance runs at once. The advancer never starts under a
 * generation: the tracker's connection profile would catch the user's
 * request.
 */
function mainGenerationBusy({ manual = false } = {}) {
    if (ST.is_send_press === true) return true;
    if (manual || !generationStartedAt) return false;
    if (Date.now() - generationStartedAt > GENERATION_START_STALE_MS) { generationStartedAt = 0; setMainGenerationStartedAt(0); return false; }
    return true;
}

function scheduleAdvance(reason) {
    const token = loadToken;
    setTimeout(() => {
        if (token !== loadToken) return;    // the chat changed while the timer ran
        advanceNow({ reason }).catch(err => log('advance threw', String(err && err.message || err)));
    }, 400);
}

// ─── The advancer ───────────────────────────────────────────────────────────

/** Test hook: replaces the request with ({ system, user }) => Promise<string>. */
export function __setWorldTransport(fn) {
    transport = typeof fn === 'function' ? fn : null;
}

/**
 * Runs the advancer now. Returns what happened; nothing is written when the
 * reply fails validation (the next new reply runs it again) or when another
 * background request holds the flag (it runs when that one finishes).
 * @returns {Promise<{ ok: boolean, reason?: string, errors?: string[], clean?: object }>}
 */
export async function advanceNow({ reason = 'manual' } = {}) {
    if (!ready()) return { ok: false, reason: 'off' };
    if (advancing) return { ok: false, reason: 'running' };
    if (reason === 'count' && !advanceDue(state, cfg().every)) return { ok: false, reason: 'not-due' };    // the count that armed it was withdrawn, or a manual run went first
    const manual = reason !== 'count';
    if (mainGenerationBusy({ manual })) {
        waitFor(reason, 'generation');
        log('advance waits on the main generation');
        return { ok: false, reason: 'busy' };
    }
    advancing = true;
    // The chat this run belongs to: the load token, the metadata object and the chat id the state was loaded
    // with. SillyTavern swaps the chat and its metadata before CHAT_CHANGED reaches this module, so the token
    // alone would miss a reply that lands during the load; a run whose chat is gone by the time its reply arrives
    // is discarded whole. A chat id that is undefined for a moment (the character list reloading) is not a switch.
    const token = loadToken;
    const stale = () => token !== loadToken || chat_metadata !== loadedMeta || (chatId() !== undefined && chatId() !== loadedChat);
    try {
        const c = cfg();
        const pack = activePack;
        const players = playerNames();
        const now = sceneFactsFrom(lastGeneratedData.infoBox || committedTrackerData.infoBox);
        const recent = buildRecentText(chatArray(), { count: c.recentMessages, persona: players[0] || 'Player' });
        const prompt = buildAdvancePrompt({ pack, state, recent, now, maxStep: c.maxStep, spoilerFree: c.spoilerFree, player: players });
        const external = extensionSettings.generationMode === 'external';
        const messages = [{ role: 'system', content: prompt.system }, { role: 'user', content: prompt.user }];
        const run = async () => {
            if (transport) return transport(prompt);
            if (external) return generateWithExternalAPI(messages);
            return safeGenerateRaw({ prompt: messages, quietToLoud: false });
        };
        log(`advance (${reason}) requested`, { pack: pack.id, sinceLast: state.sinceLast });
        const result = await withBackgroundProfile(run, { external, label: 'world' });
        if (stale()) {
            log('advance discarded: the chat changed while it ran');
            return { ok: false, reason: 'stale' };
        }
        if (result === BACKGROUND_BUSY) {
            waitFor(reason, 'background');
            log('advance waits on another background request');
            return { ok: false, reason: 'busy' };
        }
        const text = typeof result === 'string' ? result : (result && typeof result === 'object' && typeof result.text === 'string' ? result.text : String(result ?? ''));
        const parsed = parseAdvanceReply(text);
        const v = validateAdvance(parsed, pack, state, { maxStep: c.maxStep, player: players });
        const msgId = lastReplyKey();
        if (!v.ok) {
            commit(failAdvance(state, { msgId, ranAt: Date.now(), error: v.errors.join(' '), kind: 'invalid' }), { source: 'advance-failed' }, { immediate: true });
            log('advance discarded', { errors: v.errors, reply: text.slice(0, 400) });
            return { ok: false, reason: 'invalid', errors: v.errors };
        }
        const next = applyAdvance(state, v.clean, pack, { msgId, gameDate: now.date, gameTime: now.time, ranAt: Date.now() });
        commit(next, { source: 'advance' }, { immediate: true });
        log('advanced', v.clean);
        return { ok: true, clean: v.clean };
    } catch (e) {
        const error = String(e && e.message || e);
        if (stale()) {
            log('advance failed after the chat changed; nothing written', error);
            return { ok: false, reason: 'stale', error };
        }
        if (state) commit(failAdvance(state, { msgId: lastReplyKey(), ranAt: Date.now(), error, kind: 'error' }), { source: 'advance-failed' }, { immediate: true });
        log('advance failed', error);
        return { ok: false, reason: 'error', error };
    } finally {
        advancing = false;
        notify({ source: 'advance-end' });    // the dashboard's button follows the flag, whichever way the run ended
    }
}

/** One line for a result of advanceNow, for /advance, Settings and the dashboard; spoiler-free keeps the rule a reply broke to the System Log (a failed request is no spoiler). */
export function describeAdvanceResult(r, { spoilerFree = false } = {}) {
    if (!r) return 'Nothing happened.';
    if (r.ok) return 'The world moved.';
    if (r.reason === 'off') return 'Live World is off, or this chat has no world.';
    if (r.reason === 'running') return 'An advance is already running.';
    if (r.reason === 'busy') return 'Another request is running; the advance follows it.';
    if (r.reason === 'stale') return 'The chat changed, or the world was reloaded, while the advance ran; nothing was written.';
    if (r.reason === 'not-due') return 'Nothing to do: the world is not due an advance.';
    if (r.reason === 'error') return `The advance failed: ${r.error || 'the request did not complete'}; it runs again on the next reply.`;
    if (spoilerFree) return 'The advance was discarded: the reply broke a rule (the System Log has the detail).';
    return `The advance was discarded: ${(r.errors || [r.error || r.reason]).join(' ')}`;
}

export function isAdvancing() {
    return advancing;
}

// ─── Injection (G4) ─────────────────────────────────────────────────────────

/**
 * GENERATION_STARTED: the world lines ride every generation while the
 * world is on and set to inject, through SillyTavern's own
 * setExtensionPrompt so the Context Inspector does not record them.
 */
export function onWorldGenerationStarted(type, data, dryRun) {
    if (dryRun) return;
    generationStartedAt = Date.now();
    setMainGenerationStartedAt(generationStartedAt);
    if (type === 'regenerate') {
        // The last reply is about to be deleted and replaced: the new one is the same slot, a hidden reply
        // included. With no reply to replace (an earlier regenerate never produced one), that earlier slot is void.
        const list = chatArray();
        const m = list && list.length ? list[list.length - 1] : null;
        if (m && !m.is_user && typeof m.dooms_world_id === 'string' && m.dooms_world_id) inherit = { id: m.dooms_world_id, index: list.length - 1 };
        else abandonInherit();
    }
    const c = cfg();
    const quiet = type === 'quiet' || type === 'impersonate' || !!(data && (data.quiet_prompt || data.quietImage || data.quiet_image));
    const text = ready() && c.inject && !quiet ? buildWorldLines(state, activePack) : '';
    const role = c.role === 'user' ? extension_prompt_roles.USER : c.role === 'assistant' ? extension_prompt_roles.ASSISTANT : extension_prompt_roles.SYSTEM;
    try {
        setExtensionPrompt(WORLD_SLOT, text ? `\n${text}\n` : '', extension_prompt_types.IN_CHAT, c.depth, false, role);
    } catch (e) {
        log('injection failed', String(e && e.message || e));
    }
}

/** The lines as they would ride now, for the dashboard and tests. */
export function buildWorldLinesNow() {
    return ready() ? buildWorldLines(state, activePack) : '';
}

// ─── Commands and start ─────────────────────────────────────────────────────

function registerWorldCommands() {
    try {
        SlashCommandParser.addCommandObject(SlashCommand.fromProps({
            name: 'advance',
            callback: async () => describeAdvanceResult(await advanceNow({ reason: 'command' }), { spoilerFree: cfg().spoilerFree }),
            helpString: 'Live World: runs the plot advancer now, moving the clocks and the last-seen places from the recent scenes.',
            returns: 'one line saying what happened',
        }));
    } catch (e) {
        console.warn('[Live World] /advance could not be registered', e);
    }
    try {
        // Not /world: that is SillyTavern's own World Info command.
        SlashCommandParser.addCommandObject(SlashCommand.fromProps({
            name: 'liveworld',
            callback: async () => {
                try {
                    const m = await import('../ui/worldDashboard.js');
                    m.openWorldDashboard();
                    return '';
                } catch (e) {
                    return `The dashboard could not open: ${e && e.message ? e.message : e}`;
                }
            },
            helpString: 'Live World: opens the dashboard (clocks as what people say, who was last seen where, recent changes).',
            returns: 'nothing',
        }));
    } catch (e) {
        console.warn('[Live World] /liveworld could not be registered', e);
    }
}

/** Registers the command and listens for the tracker request's end. */
export function initLiveWorld() {
    registerWorldCommands();
    try { eventSource.on(DOOMS_TRACKER_UPDATE_COMPLETE, onWorldTrackerUpdateComplete); } catch (e) { /* no event source */ }
}
