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
 *   - the /advance slash command (G5).
 *
 * The pure parts are src/utils/liveWorld.js; the dashboard is
 * src/systems/ui/worldDashboard.js (lazy).
 */
import { getContext } from '../../../../../../extensions.js';
import { chat, chat_metadata, saveChatDebounced, setExtensionPrompt, extension_prompt_types, extension_prompt_roles, eventSource } from '../../../../../../../script.js';
import { SlashCommandParser } from '../../../../../../../scripts/slash-commands/SlashCommandParser.js';
import { SlashCommand } from '../../../../../../../scripts/slash-commands/SlashCommand.js';
import { extensionFolderPath } from '../../core/config.js';
import { extensionSettings, lastGeneratedData, committedTrackerData, addDebugLog } from '../../core/state.js';
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
    buildWorldLines,
    buildAdvancePrompt,
    buildRecentText,
    parseAdvanceReply,
    validateAdvance,
    applyAdvance,
    failAdvance,
} from '../../utils/liveWorld.js';

export const WORLD_CHANGED_EVENT = 'dooms:world-changed';
export const BUILTIN_PACKS = Object.freeze(['skyreach', 'example']);
const META_KEY = 'dooms_world';
const NOT_LOADED = Symbol('not loaded');

let state = null;            // this chat's world state, or null while off or unseeded
let activePack = null;       // the pack the state belongs to
let packError = '';          // why the pack could not be used, for the dashboard
let loadedFor = NOT_LOADED;
let loadToken = 0;
let advancing = false;
let pendingReason = '';      // an advance that waited on another background request
let transport = null;        // test hook: ({ system, user }) => Promise<string>
const packCache = new Map();

// ─── Helpers ────────────────────────────────────────────────────────────────

function cfg() {
    return liveWorldConfig(extensionSettings);
}

/** The master switch and DES's own. */
export function isLiveWorldOn() {
    return !!extensionSettings.enabled && cfg().enabled;
}

function ready() {
    return isLiveWorldOn() && !!state && !!activePack;
}

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

function commit(next, detail) {
    state = next;
    if (chat_metadata && typeof chat_metadata === 'object') chat_metadata[META_KEY] = clone(state);
    try { saveChatDebounced(); } catch (e) { /* no chat open */ }
    notify(detail);
}

/**
 * CHAT_CHANGED: this chat's world. A chat keeps the pack it was seeded
 * with; a new chat is seeded with the pack chosen in Settings. A pack that
 * cannot be used leaves the chat without a world (the dashboard says why)
 * and the advancer never runs on empty state.
 */
export async function onWorldChatChanged() {
    const token = ++loadToken;
    loadedFor = chatId();
    state = null;
    activePack = null;
    packError = '';
    pendingReason = '';
    if (!isLiveWorldOn()) { notify({ source: 'chat' }); return; }
    const raw = chat_metadata && typeof chat_metadata === 'object' ? chat_metadata[META_KEY] : null;
    const stored = raw && typeof raw === 'object' && raw.seeded === true ? normalizeWorldState(raw) : null;
    const packId = stored && stored.pack ? stored.pack : cfg().pack;
    const res = await loadPack(packId);
    if (token !== loadToken) return;    // another chat opened meanwhile
    if (!res.ok) {
        packError = res.errors.join(' ');
        log(`the pack "${packId}" cannot be used`, res.errors);
        notify({ source: 'chat' });
        return;
    }
    activePack = res.pack;
    if (stored) {
        state = stored;
    } else {
        state = seedWorldState(activePack);
        commit(state, { source: 'seed' });
        log(`seeded from "${activePack.name}"`);
    }
    notify({ source: 'chat' });
}

/** Throws the chat's world away and seeds it again from the chosen pack (Settings). */
export async function reseedWorld() {
    if (chat_metadata && typeof chat_metadata === 'object') delete chat_metadata[META_KEY];
    await onWorldChatChanged();
    return !!state;
}

/** A stable id for a message, stamped on it the first time (a swipe keeps it). */
function messageKey(m) {
    if (!m || typeof m !== 'object') return '';
    if (typeof m.dooms_world_id === 'string' && m.dooms_world_id) return m.dooms_world_id;
    m.dooms_world_id = `w${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    return m.dooms_world_id;
}

function lastReplyKey() {
    const list = chatArray();
    if (!list) return null;
    for (let i = list.length - 1; i >= 0; i--) {
        const m = list[i];
        if (m && !m.is_user && !m.is_system) return typeof m.dooms_world_id === 'string' ? m.dooms_world_id : null;
    }
    return null;
}

function knownNamesFromTracker() {
    try {
        const entries = parseCharacterEntriesFromThoughts(lastGeneratedData.characterThoughts || committedTrackerData.characterThoughts);
        return (entries || []).map(c => c && c.name).filter(Boolean);
    } catch (e) {
        return [];
    }
}

/**
 * MESSAGE_RECEIVED: a fresh reply counts once; the tracker's present
 * characters become known; every N, the advancer runs.
 */
export function onWorldMessageReceived() {
    if (!ready()) return;
    const list = chatArray();
    const m = list && list.length ? list[list.length - 1] : null;
    if (!m || m.is_user || m.is_system || Array.isArray(m.extra && m.extra.tool_invocations)) return;
    const r = countMessage(state, messageKey(m));
    let next = r.state;
    const names = knownNamesFromTracker();
    if (names.length) next = markKnown(next, names);
    if (!r.counted && next === state) return;
    commit(next, { source: 'count', counted: r.counted });
    if (r.counted && advanceDue(next, cfg().every)) scheduleAdvance('count');
}

/** After the tracker request (separate mode): names it brought become known, and an advance that waited runs. */
function onTrackerUpdateComplete() {
    if (!ready()) return;
    const names = knownNamesFromTracker();
    if (names.length) {
        const next = markKnown(state, names);
        if (JSON.stringify(next.known) !== JSON.stringify(state.known)) commit(next, { source: 'known' });
    }
    if (pendingReason) {
        const reason = pendingReason;
        pendingReason = '';
        scheduleAdvance(reason);
    }
}

/** GENERATION_ENDED: an advance that waited on the main generation runs now. */
export function onWorldGenerationEnded() {
    if (!ready() || !pendingReason) return;
    const reason = pendingReason;
    pendingReason = '';
    scheduleAdvance(reason);
}

function scheduleAdvance(reason) {
    setTimeout(() => {
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
    if (advancing) return { ok: false, reason: 'busy' };
    advancing = true;
    try {
        const c = cfg();
        const pack = activePack;
        const now = sceneFactsFrom(lastGeneratedData.infoBox || committedTrackerData.infoBox);
        const recent = buildRecentText(chatArray(), { count: c.recentMessages, persona: resolvePersonaName() || 'Player' });
        const prompt = buildAdvancePrompt({ pack, state, recent, now, maxStep: c.maxStep, spoilerFree: c.spoilerFree });
        const external = extensionSettings.generationMode === 'external';
        const run = async () => {
            if (transport) return transport(prompt);
            if (external) return generateWithExternalAPI([{ role: 'system', content: prompt.system }, { role: 'user', content: prompt.user }]);
            return safeGenerateRaw({ prompt: `${prompt.system}\n\n${prompt.user}`, quietToLoud: false });
        };
        log(`advance (${reason}) requested`, { pack: pack.id, sinceLast: state.sinceLast });
        const result = await withBackgroundProfile(run, { external });
        if (result === BACKGROUND_BUSY) {
            pendingReason = reason;
            log('advance waits on another background request');
            return { ok: false, reason: 'busy' };
        }
        const text = typeof result === 'string' ? result : (result && typeof result === 'object' && typeof result.text === 'string' ? result.text : String(result ?? ''));
        const parsed = parseAdvanceReply(text);
        const v = validateAdvance(parsed, pack, state, { maxStep: c.maxStep });
        const msgId = lastReplyKey();
        if (!v.ok) {
            commit(failAdvance(state, { msgId, ranAt: Date.now(), error: v.errors.join(' ') }), { source: 'advance-failed' });
            log('advance discarded', { errors: v.errors, reply: text.slice(0, 400) });
            return { ok: false, reason: 'invalid', errors: v.errors };
        }
        const next = applyAdvance(state, v.clean, pack, { msgId, gameDate: now.date, gameTime: now.time, ranAt: Date.now() });
        commit(next, { source: 'advance' });
        log('advanced', v.clean);
        return { ok: true, clean: v.clean };
    } catch (e) {
        const error = String(e && e.message || e);
        if (state) commit(failAdvance(state, { ranAt: Date.now(), error }), { source: 'advance-failed' });
        log('advance failed', error);
        return { ok: false, reason: 'error', error };
    } finally {
        advancing = false;
    }
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
            callback: async () => {
                const r = await advanceNow({ reason: 'command' });
                if (r.ok) return 'The world moved.';
                if (r.reason === 'off') return 'Live World is off, or this chat has no world.';
                if (r.reason === 'busy') return 'Another request is running; the advance follows it.';
                return `The advance was discarded: ${(r.errors || [r.error || r.reason]).join(' ')}`;
            },
            helpString: 'Live World: runs the plot advancer now, moving the clocks and the last-seen places from the recent scenes.',
            returns: 'one line saying what happened',
        }));
    } catch (e) {
        console.warn('[Live World] /advance could not be registered', e);
    }
    try {
        SlashCommandParser.addCommandObject(SlashCommand.fromProps({
            name: 'world',
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
        console.warn('[Live World] /world could not be registered', e);
    }
}

/** Registers the command and listens for the tracker request's end. */
export function initLiveWorld() {
    registerWorldCommands();
    try { eventSource.on(DOOMS_TRACKER_UPDATE_COMPLETE, onTrackerUpdateComplete); } catch (e) { /* no event source */ }
}
