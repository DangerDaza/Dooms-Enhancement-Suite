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
 *   - the /advance and /liveworld slash commands (G5);
 *   - the places the story visits (docs/map-window-plan.md D82, D83): each
 *     fresh reply's tracker location recorded on the state, a deleted reply
 *     taking its visit back, a place's picture drawn through the image
 *     service on request (drawPlace) or, with the switch on, the first time
 *     the story reaches it.
 *
 * The pure parts are src/utils/liveWorld.js and src/utils/worldMap.js; the
 * window is src/systems/ui/worldDashboard.js (lazy).
 */
import { getContext } from '../../../../../../extensions.js';
import { saveBase64AsFile } from '../../../../../../utils.js';
import { chat, chat_metadata, saveChatDebounced, saveChatConditional, setExtensionPrompt, extension_prompt_types, extension_prompt_roles, eventSource } from '../../../../../../../script.js';
import * as ST from '../../../../../../../script.js';    // is_send_press read by name: a build without it reads undefined, not a link error
import { SlashCommandParser } from '../../../../../../../scripts/slash-commands/SlashCommandParser.js';
import { SlashCommand } from '../../../../../../../scripts/slash-commands/SlashCommand.js';
import { extensionFolderPath } from '../../core/config.js';
import { extensionSettings, lastGeneratedData, committedTrackerData, addDebugLog, setMainGenerationStartedAt } from '../../core/state.js';
import { saveSettings } from '../../core/persistence.js';
import { withBackgroundProfile, BACKGROUND_BUSY, generateWithExternalAPI, DOOMS_TRACKER_UPDATE_COMPLETE, parseCharacterEntriesFromThoughts } from '../generation/apiClient.js';
import { safeGenerateRaw } from '../../utils/responseExtractor.js';
import { sceneFactsFrom } from '../../utils/questCut.js';
import { resolvePersonaName } from './diceRolls.js';
import { renderImage, sourceProblem } from './imageGen.js';
import { imageGenConfig } from '../../utils/imageGen.js';
import { parseCaptionReply } from '../../utils/scenePictures.js';
import { visitPlace, reconcileVisited, placesRow, buildPlacePrompt } from '../../utils/worldMap.js';
import { worldToRaw, worldSummary, worldFromState, buildWorldDraftPrompt, parseWorldDraft, rebindStateToPack, DRAFT_LIMITS } from '../../utils/worldBuilder.js';
import {
    WORLD_SLOT,
    BLANK_PACK_ID,
    blankPack,
    liveWorldConfig,
    normalizePack,
    seedWorldState,
    normalizeWorldState,
    countMessage,
    advanceDue,
    placeFromText,
    seenInScene,
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
export const BUILTIN_PACKS = Object.freeze(['example']);    // Harbourside, the one template (docs/world-builder-plan.md D92); the blank world needs no file (D93)
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
let placeTransport = null;   // test hook: { describe({ system, user }) => Promise<string> }
let drawing = '';            // the place being drawn, '' when none
let newPlace = '';           // a place the latest scene reached for the first time (for the automatic draw)
let missingWorld = '';       // the id of a world this chat was seeded with that cannot be loaded (docs/world-builder-plan.md D97); '' when its world is here
let drafting = false;        // a world being drafted from the chat (D95)
let draftTransport = null;   // test hook: ({ system, user }) => Promise<string>
const DRAW_RETRY_MS = 3000;
const DRAW_RETRIES = 5;
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

/** The chat's character, the blank world's name (D93). */
function characterName() {
    try { const n = String(getContext().name2 || '').trim(); return n || 'The world'; } catch (e) { return 'The world'; }
}

function persist() {
    try { saveSettings(); } catch (e) { log('settings save failed', String(e && e.message || e)); }
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
    if (key === BLANK_PACK_ID && custom === undefined) {
        raw = blankPack();    // D93: no file; the chat's own name goes on it when the state loads
    } else if (custom !== undefined) {
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

/** The id of the world this chat was seeded with when it cannot be loaded (D97); '' when the chat's world is here. */
export function getMissingWorld() {
    return missingWorld;
}

// ─── Worlds (docs/world-builder-plan.md) ──────────────────────────────────

/**
 * The worlds on offer, your own first (D92): each with its name, its
 * summary and, when it cannot be read, what is wrong with it.
 * @returns {Promise<Array<{ id: string, name: string, custom: boolean, template: boolean, ok: boolean, errors: string[], summary: string, pack: object|null }>>}
 */
export async function listWorlds() {
    const out = [];
    const custom = cfg().customPacks;
    const row = async (id, isCustom) => {
        const r = await loadPack(id);
        out.push({ id, name: r.ok ? r.pack.name : id, custom: isCustom, template: !isCustom, ok: r.ok, errors: r.errors, summary: r.ok ? worldSummary(r.pack) : '', pack: r.pack });
    };
    for (const id of Object.keys(custom)) await row(id, true);
    for (const id of BUILTIN_PACKS) if (custom[id] === undefined) await row(id, false);
    return out;
}

/**
 * A world in the file's shape, for the builder: one of yours (made safe,
 * its errors listed), the blank world as this chat names it, or the
 * template.
 * @returns {Promise<{ ok: boolean, raw: object|null, errors: string[], custom: boolean }>}
 */
export async function getWorldRaw(id) {
    const key = String(id || '').trim();
    const custom = cfg().customPacks[key];
    if (key === BLANK_PACK_ID && custom === undefined) {
        const base = activePack && activePack.id === BLANK_PACK_ID ? activePack : blankPack(characterName());
        return { ok: true, raw: worldToRaw(base), errors: [], custom: false };
    }
    if (custom !== undefined) {
        let parsed;
        try { parsed = typeof custom === 'string' ? JSON.parse(custom) : custom; } catch (e) { return { ok: false, raw: null, errors: [`The world "${key}" is not valid JSON: ${e.message}`], custom: true }; }
        const n = normalizePack(parsed);
        return { ok: n.ok, raw: worldToRaw(n.pack), errors: n.errors, custom: true };
    }
    const r = await loadPack(key);
    return { ok: r.ok, raw: r.ok ? worldToRaw(r.pack) : null, errors: r.errors, custom: false };
}

/**
 * Stores a world under its id (D94): the file's shape, made safe. A world
 * with errors is not stored. With `previousId` the world moves from its
 * old id (a rename): the setting and the open chat follow. A chat using
 * the world reloads it, so an edit reaches it at once (D97).
 * @returns {Promise<{ ok: boolean, errors: string[], pack: object|null }>}
 */
export async function saveWorld(raw, { previousId = '' } = {}) {
    const n = normalizePack(raw);
    if (!n.ok) return { ok: false, errors: n.errors, pack: n.pack };
    const id = n.pack.id;
    if (id === BLANK_PACK_ID) return { ok: false, errors: ['"blank" is the blank world\'s own id; give this world another name.'], pack: n.pack };
    if (!extensionSettings.liveWorld || typeof extensionSettings.liveWorld !== 'object') extensionSettings.liveWorld = {};
    if (!extensionSettings.liveWorld.customPacks || typeof extensionSettings.liveWorld.customPacks !== 'object') extensionSettings.liveWorld.customPacks = {};
    const packs = extensionSettings.liveWorld.customPacks;
    packs[id] = JSON.stringify(worldToRaw(n.pack));
    forgetPack(id);
    const old = String(previousId || '').trim();
    const renamed = old && old !== id && old in packs;
    if (renamed) {
        delete packs[old];
        forgetPack(old);
        if (cfg().pack === old) extensionSettings.liveWorld.pack = id;
    }
    persist();
    const mine = !!state && (state.pack === id || (renamed && state.pack === old));
    if (mine) {
        if (state.pack !== id) { state.pack = id; commit(state, { source: 'world' }, { immediate: true }); }
        await onWorldChatChanged();    // the edit reaches this chat now: clocks clamped, a new clock at its start
    } else notify({ source: 'world' });
    log(`world "${id}" saved${renamed ? ` (was "${old}")` : ''}`);
    return { ok: true, errors: [], pack: n.pack };
}

/** Removes one of your worlds. The setting falls back to the blank world; a chat using it goes on in the blank world (D97). */
export async function deleteWorld(id) {
    const key = String(id || '').trim();
    if (!removeCustomPack(key)) return false;
    if (cfg().pack === key) extensionSettings.liveWorld.pack = BLANK_PACK_ID;
    persist();
    if (state && state.pack === key) await onWorldChatChanged();
    else notify({ source: 'world' });
    log(`world "${key}" removed`);
    return true;
}

/** A copy of a world (yours or the template) under a new name, stored (D92: "Start from Harbourside"). */
export async function copyWorld(fromId, { id = '', name = '' } = {}) {
    const r = await loadPack(fromId);
    if (!r.ok) return { ok: false, errors: r.errors, pack: null };
    const raw = worldToRaw(r.pack);
    raw.name = String(name || '').trim() || `${raw.name} (copy)`;
    raw.id = String(id || '').trim() || raw.name;
    return saveWorld(raw);
}

/** A world's JSON (a file, or pasted) stored as one of yours (Import). */
export async function importWorldJson(text) {
    let raw;
    try { raw = typeof text === 'string' ? JSON.parse(text) : text; } catch (e) { return { ok: false, errors: [`Not valid JSON: ${e.message}`], pack: null }; }
    return saveWorld(raw);
}

/** This chat's world as it stands, in the file's shape (D96, "Make this a world"); null without a chat. */
export function worldFromThisChat({ name = '' } = {}) {
    if (!state || !activePack) return null;
    return worldFromState(state, activePack, { name: name || state.name || activePack.name });
}

/**
 * The open chat carries over to a world (D96): its pack id, the row's
 * story-named places re-keyed to the world's, everyone at such a place
 * standing at the world's place, the clocks clamped. Nothing re-seeded.
 * @returns {Promise<{ ok: boolean, error?: string, rebound?: number }>}
 */
export async function adoptWorld(id) {
    if (!ready()) return { ok: false, error: 'This chat has no world to carry over.' };
    const r = await loadPack(id, { fresh: true });
    if (!r.ok) return { ok: false, error: r.errors.join(' ') };
    const bound = rebindStateToPack(state, r.pack);
    const next = clampClocksToPack({ ...bound.state, pack: r.pack.id, packVersion: r.pack.version || 1 }, r.pack).state;
    activePack = r.pack;
    missingWorld = '';
    commit(next, { source: 'world' }, { immediate: true });
    log(`the chat carried over to the world "${r.pack.name}"`, { rebound: bound.rebound });
    return { ok: true, rebound: bound.rebound };
}

export function __setDraftTransport(fn) {
    draftTransport = typeof fn === 'function' ? fn : null;
}

export function isDrafting() {
    return drafting;
}

/** The chat's character card(s): the one character, or every member of the group, each field under the member's name. */
function cardOfTheChat() {
    try {
        const ctx = getContext();
        const list = Array.isArray(ctx.characters) ? ctx.characters : [];
        let cards = [];
        let group = null;
        if (typeof ctx.groupId === 'string' && ctx.groupId && Array.isArray(ctx.groups)) {
            group = ctx.groups.find(g => g && g.id === ctx.groupId) || null;
            const members = group && Array.isArray(group.members) ? group.members : [];
            cards = members.map(av => list.find(c => c && c.avatar === av)).filter(Boolean);
        } else if (Number.isInteger(Number(ctx.characterId)) && list[Number(ctx.characterId)]) cards = [list[Number(ctx.characterId)]];
        const name = cards.length > 1 ? String((group && group.name) || ctx.name2 || '') : String((cards[0] && cards[0].name) || ctx.name2 || '');
        if (!cards.length) return { name };
        const join = (k) => cards.map(c => (typeof c[k] === 'string' && c[k].trim() ? (cards.length > 1 ? `${c.name}: ${c[k]}` : c[k]) : '')).filter(Boolean).join('\n');
        return { name, description: join('description'), personality: join('personality'), scenario: join('scenario') };
    } catch (e) { return {}; }
}

/** The lore the chat carries: the entries of the lorebooks active for it (the global ones, the character's own, the chat's), cut to length. '' when none can be read. */
async function loreOfTheChat() {
    let api = null;
    try { api = await import('../lorebook/lorebookAPI.js'); } catch (e) { return ''; }
    const names = new Set();
    try { for (const n of api.getActiveWorldNames() || []) if (typeof n === 'string' && n) names.add(n); } catch (e) { /* none */ }
    try {
        const ctx = getContext();
        const list = Array.isArray(ctx.characters) ? ctx.characters : [];
        const c = Number.isInteger(Number(ctx.characterId)) ? list[Number(ctx.characterId)] : null;
        const own = c && c.data && c.data.extensions ? c.data.extensions.world : '';
        if (typeof own === 'string' && own) names.add(own);
    } catch (e) { /* none */ }
    try {
        const chatBook = chat_metadata && typeof chat_metadata === 'object' ? chat_metadata.world_info : '';
        if (typeof chatBook === 'string' && chatBook) names.add(chatBook);
    } catch (e) { /* none */ }
    const lines = [];
    let total = 0;
    for (const name of names) {
        let entries = [];
        try { entries = api.getEntriesSorted(await api.loadWorldData(name)); } catch (e) { entries = []; }
        for (const { entry } of entries) {
            if (!entry || entry.disable) continue;
            const content = String(entry.content || '').trim();
            if (!content) continue;
            const title = String(entry.comment || (Array.isArray(entry.key) ? entry.key.join(', ') : '') || '').trim();
            const line = `${title ? `${title}: ` : ''}${content}`;
            if (total + line.length > DRAFT_LIMITS.lore) { lines.push(line.slice(0, Math.max(0, DRAFT_LIMITS.lore - total))); total = DRAFT_LIMITS.lore; break; }
            lines.push(line);
            total += line.length + 1;
        }
        if (total >= DRAFT_LIMITS.lore) break;
    }
    return lines.join('\n');
}

/**
 * Drafts a world from the chat (D95): one background request (the
 * tracker's profile) with the card, the lore, the names and the recent
 * scenes; the reply read like the advancer's. Nothing is stored: the
 * draft goes to the builder for the user to read first.
 * @returns {Promise<{ ok: boolean, reason: string, errors: string[], raw: object|null, pack: object|null }>}
 */
export async function draftWorldFromChat({ name = '' } = {}) {
    if (drafting) return { ok: false, reason: 'running', errors: ['A world is already being drafted.'], raw: null, pack: null };
    if (mainGenerationBusy({ manual: true })) return { ok: false, reason: 'busy', errors: ['The chat is generating; try again when it is done.'], raw: null, pack: null };
    drafting = true;
    notify({ source: 'draft-start' });
    try {
        const players = playerNames();
        const card = cardOfTheChat();
        const lore = await loreOfTheChat();
        const names = [...new Set([...knownNamesFromTracker(), ...Object.keys(state && state.known ? state.known : {})])];
        const recent = buildRecentText(chatArray(), { count: 24, persona: players[0] || 'Player' });
        const worldName = String(name || '').trim() || (state && state.name) || card.name || '';
        const prompt = buildWorldDraftPrompt({ name: worldName, card, lore, characters: names, recent, player: players });
        const external = extensionSettings.generationMode === 'external';
        const messages = [{ role: 'system', content: prompt.system }, { role: 'user', content: prompt.user }];
        const run = async () => {
            if (draftTransport) return draftTransport(prompt);
            if (external) return generateWithExternalAPI(messages);
            return safeGenerateRaw({ prompt: messages, quietToLoud: false });
        };
        log('a world draft requested', { name: worldName, lore: lore.length, names: names.length });
        const result = await withBackgroundProfile(run, { external, label: 'world-draft' });
        if (result === BACKGROUND_BUSY) return { ok: false, reason: 'busy', errors: ['Another background request is running; try again in a moment.'], raw: null, pack: null };
        const text = typeof result === 'string' ? result : (result && typeof result === 'object' && typeof result.text === 'string' ? result.text : String(result ?? ''));
        const d = parseWorldDraft(text, { name: worldName });
        log(d.ok ? 'a world drafted' : 'the draft could not be used', d.ok ? worldSummary(d.pack) : { errors: d.errors, reply: text.slice(0, 400) });
        return { ok: d.ok, reason: d.ok ? '' : 'invalid', errors: d.errors, raw: d.raw, pack: d.pack };
    } catch (e) {
        const error = String(e && e.message || e);
        log('the draft failed', error);
        return { ok: false, reason: 'error', errors: [error], raw: null, pack: null };
    } finally {
        drafting = false;
        notify({ source: 'draft-end' });
    }
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
    const ids = presentReplyIds();
    const r = reconcileWithChat(state, ids, { pack: activePack });
    const v = reconcileVisited(r.state, ids);
    if (v.state === state) return false;
    if (r.state !== state) log(`the chat no longer holds ${r.undone} change(s) and ${r.pruned} counted repl${r.pruned === 1 ? 'y' : 'ies'}; the state follows it`);
    if (v.pruned || v.dropped) log(`${v.pruned} visit(s) taken back; ${v.dropped} place(s) left the row`);
    commit(v.state, { source: 'rewind', ...detail }, { immediate: true });
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
    newPlace = '';
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
    missingWorld = '';
    let pack = res.ok ? res.pack : null;
    if (!pack) {
        // D97: the world is gone (removed, or Skyreach after D92). The chat goes on in the blank world with its
        // state untouched, and the status line names the world that is missing.
        missingWorld = packId;
        log(`the world "${packId}" cannot be used; this chat goes on in the blank world`, res.errors);
        pack = blankPack();
    }
    if (pack.id === BLANK_PACK_ID) pack = { ...pack, name: (stored && stored.name) || characterName() };    // D93: named after the chat's character
    activePack = pack;
    if (stored) {
        if (missingWorld) {
            state = stored;    // no clamp: the clocks and the places wait for their world to come back
        } else {
            const clamped = clampClocksToPack(stored, activePack);
            state = clamped.state;
            if (clamped.changed) commit(state, { source: 'clamp' }, { immediate: true });
        }
        reconcile({ at: 'load' });
    } else {
        state = seedWorldState(activePack, { name: activePack.id === BLANK_PACK_ID ? activePack.name : '' });
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

/** The names the tracker lists for the scene (the player apart): who is present now. */
export function presentNamesFromTracker() {
    return knownNamesFromTracker();
}

/**
 * The scene places people (D70): whoever the tracker lists is known, and
 * when the tracker's location names a pack place they stand there, logged
 * as a move "in the scene" on the reply's id (so a deleted reply takes it
 * back). The advancer still moves people between scenes; this is what the
 * scene itself shows.
 */
function placeFromScene(from, m) {
    const facts = sceneFactsFrom(lastGeneratedData.infoBox || committedTrackerData.infoBox);
    const msgId = m ? messageKey(m) : null;
    let next = from;
    const names = knownNamesFromTracker();
    if (names.length) {
        const place = placeFromText(activePack, facts.location) || facts.location;    // a place the pack does not name is the row's own (D93)
        const r = seenInScene(next, activePack, { names, place, msgId, gameDate: facts.date || '', gameTime: facts.time || '' });
        if (r.placed) log(`the scene placed ${r.placed} at ${place}`);
        next = r.state;
    }
    // The party's own place (docs/map-window-plan.md D82): the tracker's location, a pack place or one of its own, newest first.
    const v = visitPlace(next, activePack, { location: facts.location, msgId, gameDate: facts.date || '', gameTime: facts.time || '' });
    if (v.changed) {
        next = v.state;
        if (v.added) { newPlace = v.id; log(`a new place: ${v.id}`); }
    }
    return next;
}

/** After a fresh reply recorded a place for the first time: the automatic draw, when the switch is on (D83). Never after a recovery. */
function drawNewPlaceIfAsked({ recovery = false } = {}) {
    const id = newPlace;
    newPlace = '';
    if (!id || recovery || !ready()) return;
    if (!imageGenConfig(extensionSettings).places.auto) return;
    scheduleDraw(id, 'auto', DRAW_RETRIES);
}

function scheduleDraw(id, reason, retries) {
    const token = loadToken;
    setTimeout(async () => {
        if (token !== loadToken) return;    // the chat changed while the timer ran
        const r = await drawPlace(id, { reason }).catch(err => ({ ok: false, reason: 'error', error: String(err && err.message || err) }));
        if (!r.ok && (r.reason === 'busy' || r.reason === 'running') && retries > 0) scheduleDraw(id, reason, retries - 1);    // another request holds the flag: a little later
    }, reason === 'auto' ? 400 : 0);
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
    let next = placeFromScene(r.state, m);
    if (!r.counted && next === state) return;
    commit(next, { source: 'count', counted: r.counted });
    drawNewPlaceIfAsked();
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

/** After the tracker request (separate mode): the scene it brought places people (D70), and an advance that waited runs. */
export function onWorldTrackerUpdateComplete(detail) {
    if (!ready()) return;
    if (trackerToken !== loadToken) return;    // a request this chat's replies did not ask for (another chat's, in flight across the switch): not its names, not its wait
    trackerToken = 0;
    const list = chatArray();
    const m = list && list.length ? list[list.length - 1] : null;
    const next = placeFromScene(state, m && !m.is_user && !m.is_system && !isToolRecord(m) ? m : null);
    if (next !== state) commit(next, { source: 'scene' });
    drawNewPlaceIfAsked({ recovery: !!(detail && detail.recovery) });    // the repair request records the place but never draws (D83)
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

// ─── Places and their pictures (docs/map-window-plan.md D82, D83) ───────────

/** Test hook: the description request behind { describe({ system, user }) → Promise<string> }. */
export function __setPlaceTransport(t) {
    placeTransport = t && typeof t.describe === 'function' ? t : null;
}

/** The row of places for the window, newest first ([] while the world is off). */
export function getPlacesRow() {
    return ready() ? placesRow(state, activePack) : [];
}

/** The id of the place being drawn now, '' when none. */
export function isDrawingPlace() {
    return drawing;
}

/** The scenes at or near a place's last visit: the ten messages up to and just after it (the latest ten when the visit's reply is gone). */
function recentTextNear(entry) {
    const list = chatArray() || [];
    const ids = new Set(Array.isArray(entry.visits) ? entry.visits : []);
    let at = -1;
    for (let i = list.length - 1; i >= 0; i--) if (list[i] && ids.has(list[i].dooms_world_id)) { at = i; break; }
    const end = at >= 0 ? Math.min(list.length, at + 3) : list.length;
    return buildRecentText(list.slice(Math.max(0, end - 10), end), { count: 10, truncation: 500, persona: playerNames()[0] || 'Player' });
}

/** A place's picture, as bytes from the source, saved into the character's folder like a scene picture. */
async function savePlaceFile(dataUrl, id) {
    const comma = dataUrl.indexOf(',');
    const base64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
    const format = /^data:image\/(\w+)/.exec(dataUrl)?.[1] || 'png';
    let folder = 'places';
    try { folder = getContext().name2 || folder; } catch (e) { /* no context, the default folder */ }
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const name = String(id).replace(/^loc:/, '').replace(/[^\w-]+/g, '-').slice(0, 40) || 'place';
    return saveBase64AsFile(base64, folder, `des-place-${name}-${stamp}`, format);
}

/**
 * Draws a place's picture: the AI describes the place from the scenes at
 * or near its last visit (a background request on the tracker's profile),
 * the image service renders it with the page's Places group, the file is
 * saved and its URL kept on the visit. One at a time; nothing is written
 * when the chat changes meanwhile.
 * @returns {Promise<{ ok: boolean, reason?: string, error?: string, url?: string }>}
 */
export async function drawPlace(id, { reason = 'manual' } = {}) {
    if (!ready()) return { ok: false, reason: 'off' };
    if (drawing) return { ok: false, reason: 'running' };
    const entry = (state.visited || []).find(e => e.id === id);
    if (!entry) return { ok: false, reason: 'no-place' };
    const problem = sourceProblem();
    if (problem) return { ok: false, reason: 'source', error: problem };
    drawing = id;
    notify({ source: 'draw-start', id });
    const token = loadToken;
    const stale = () => token !== loadToken || chat_metadata !== loadedMeta || (chatId() !== undefined && chatId() !== loadedChat);
    try {
        const g = imageGenConfig(extensionSettings).places;
        const row = placesRow(state, activePack).find(x => x.id === id) || { label: entry.label, parent: '' };
        const prompt = buildPlacePrompt({ place: { label: row.label, parent: row.parent }, recent: recentTextNear(entry), world: activePack.name, size: g.size });
        const external = extensionSettings.generationMode === 'external';
        const messages = [{ role: 'system', content: prompt.system }, { role: 'user', content: prompt.user }];
        const run = async () => {
            if (placeTransport) return placeTransport.describe(prompt);
            if (external) return generateWithExternalAPI(messages);
            return safeGenerateRaw({ prompt: messages, quietToLoud: false });
        };
        if (reason === 'auto') {
            try { if (typeof toastr !== 'undefined') toastr.info(`Drawing a picture of ${row.label} (Settings → Image Generation → Places to switch this off).`, 'Map', { timeOut: 6000 }); } catch (e) { /* no toastr */ }
        }
        log(`draw (${reason}) requested`, { place: id });
        const result = await withBackgroundProfile(run, { external, label: 'place' });
        if (stale()) return { ok: false, reason: 'stale' };
        if (result === BACKGROUND_BUSY) return { ok: false, reason: 'busy' };
        const text = typeof result === 'string' ? result : (result && typeof result === 'object' && typeof result.text === 'string' ? result.text : String(result ?? ''));
        const description = parseCaptionReply(text) || `A wide establishing view of ${row.label}${row.parent ? `, ${row.parent}` : ''}, in ${activePack.name}.`;
        const picture = await renderImage({ purpose: 'place', prompt: `${g.preamble || ''}${description}`.trim(), negative: g.negative || '', size: g.size });
        if (stale()) return { ok: false, reason: 'stale' };
        let url = picture.url || '';
        if (!url && picture.dataUrl) url = await savePlaceFile(picture.dataUrl, id);
        if (!url) throw new Error('the image source returned no picture');
        if (stale()) return { ok: false, reason: 'stale' };
        const next = clone(state);
        const e = (next.visited || []).find(x => x.id === id);
        if (!e) return { ok: false, reason: 'no-place' };    // the place left the row while the picture was made
        e.image = url;
        e.prompt = description;
        e.drawnAt = Date.now();
        commit(next, { source: 'draw', id }, { immediate: true });
        log(`drew ${id}`, { url });
        return { ok: true, url };
    } catch (e) {
        const error = String(e && e.message || e);
        log('draw failed', { place: id, error });
        return { ok: false, reason: 'error', error };
    } finally {
        drawing = '';
        notify({ source: 'draw-end', id });
    }
}

/** One line for a result of drawPlace, for the window. */
export function describeDrawResult(r, label = 'the place') {
    if (!r) return 'Nothing happened.';
    if (r.ok) return `A picture of ${label} is ready.`;
    if (r.reason === 'off') return 'Live World is off, or this chat has no world.';
    if (r.reason === 'running') return 'A picture is already being made.';
    if (r.reason === 'no-place') return 'That place is no longer in the row.';
    if (r.reason === 'source') return `Cannot draw: ${r.error}.`;
    if (r.reason === 'busy') return 'Another request is running; try again in a moment.';
    if (r.reason === 'stale') return 'The chat changed while the picture was made; nothing was kept.';
    return `The picture failed: ${r.error || 'the request did not complete'}.`;
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
                    return `The window could not open: ${e && e.message ? e.message : e}`;
                }
            },
            helpString: 'Live World: opens the Map window (the places the story has been to as pictures, Travel here, the news, rumours, people and completed quests).',
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
