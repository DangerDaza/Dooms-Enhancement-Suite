/**
 * The Hub (docs/hub-plan.md D113–D133): a world played as many small
 * chats. The store under extensionSettings.hub (a narrator card, a sealed
 * snapshot and the scene records per world), the chat bridge (every
 * SillyTavern call behind one object, read from the context at call time
 * so an older build fails softly and the sandbox stubs one object), the
 * requests (the gap run, the openers, the recap), Start (the file written
 * whole, then opened), End (the recap, Canon over the scene, the advancer,
 * the snapshot), the scene records' moves, /hub and /endscene. The pure
 * parts are src/utils/hub.js; the window is the Atlas (src/systems/ui/atlas.js).
 */
import { getContext } from '../../../../../../extensions.js';
import { chat, chat_metadata, getRequestHeaders, saveChatConditional, setExtensionPrompt, extension_prompt_types, extension_prompt_roles, user_avatar } from '../../../../../../../script.js';
import * as ST from '../../../../../../../script.js';    // is_send_press read by name: a build without it reads undefined, not a link error
import { getMessageTimeStamp } from '../../../../../../RossAscends-mods.js';
import { SlashCommandParser } from '../../../../../../../scripts/slash-commands/SlashCommandParser.js';
import { SlashCommand } from '../../../../../../../scripts/slash-commands/SlashCommand.js';
import { extensionSettings, lastGeneratedData, committedTrackerData, addDebugLog, setLastGeneratedData, setCommittedTrackerData } from '../../core/state.js';
import { generateTrackerExample } from '../generation/promptBuilder.js';
import { renderInfoBox } from '../rendering/infoBox.js';
import { renderThoughts } from '../rendering/thoughts.js';
import { renderQuests } from '../rendering/quests.js';
import { saveSettings, saveChatData } from '../../core/persistence.js';
import { withBackgroundProfile, BACKGROUND_BUSY, generateWithExternalAPI, waitForBackground, backgroundHolder } from '../generation/apiClient.js';
import { safeGenerateRaw } from '../../utils/responseExtractor.js';
import { sceneFactsFrom } from '../../utils/questCut.js';
import {
    BLANK_PACK_ID, seedWorldState, normalizeWorldState, buildGapPrompt, validateGap, applyGap, parseAdvanceReply, recentChanges,
    placeLabel, placeChain, resolvePlace, liveWorldConfig, sameName, normalizePack,
} from '../../utils/liveWorld.js';
import { buildCanonBlock, normalizeCanon } from '../../utils/canon.js';
import { buildHooksPrompt, parseHooksReply, validateHooks, proposeRound, failRound, setAside as setAsidePureHook, normalizeHooks, emptyHooks, takeHook as takeHookPure, recordTaken } from '../../utils/questHooks.js';
import {
    HUB_META_KEY, hubConfig, normalizeHub, normalizeWorldEntry, gapOf, gapMoves, takeSnapshot, seedStores, personLine, buildBrief,
    buildOpenersPrompt, parseOpenersReply, validateOpeners, openerMessage, sceneTitle, hubMark, readMark, markEnded, sceneHeader,
    sceneFileName, sceneTranscript, buildRecapPrompt, parseRecapReply, openSceneOf, openScene, setSceneAside as setAsidePure,
    resumeScene as resumePure, endSceneRecord, reopenScene as reopenPure, sceneByChat, markChatGone, reconcileScenesWithChats,
    lastRecaps, hubStatusLine, describeEndResult, RECAP_BUDGET, removeGoneScene as removeGonePure, isStaleScene, markIsOfFile, sceneTranscriptPages, renameSceneChat,
    adoptScene, ADOPTED_ID, backupFileName, loreEntries, castLore, standingLore, LORE_BOOKS, sceneLength, sceneIsLong, continuationSeed,
    readConflicts, mergeConflicts, normalizeConflicts,
} from '../../utils/hub.js';
import { normalizeBook } from '../../utils/atlas.js';
import { narratorTexts, countStyle, applyStyle } from '../../utils/styleLaw.js';
import { continuityDraft, readContinuity, stepDraft, draftChanges, applyContinuity, changeCounts, standingLines, threadLines, hasContinuity } from '../../utils/continuity.js';
import { continuityBookName, readBook, planBook, trackWritten, forgetBook, renameBook } from '../../utils/continuityBook.js';

export const BRIEF_SLOT = 'dooms-scene-brief';
import { ensureCss } from '../../core/cssLoader.js';
import { isLiveWorldOn, loadPack, getWorldState, getActivePack, saveWorld, adoptWorld, presentNamesFromTracker } from './liveWorld.js';
import { isCanonOn, updateCanon, onCanonChatChanged } from './canon.js';
import { resolvePersonaName } from './diceRolls.js';

export const HUB_CHANGED_EVENT = 'dooms:hub-changed';

let current = null;        // { worldId, mark } for the chat in front when it is a scene, else null
let pending = null;        // a Start prepared and not yet committed
let pendingToken = 0;
let ending = false;
let bridgeOverride = null;
let openersTransport = null;
let recapTransport = null;
let gapTransport = null;
let hooksTransport = null;
let hooksBusyWorld = '';     // the world a hooks request runs for, '' when none
let timing = { idleStepMs: 250, idleMaxMs: 120000 };

// ─── Helpers ────────────────────────────────────────────────────────────

function log(message, data = null) {
    try { addDebugLog(`[Hub] ${message}`, data); } catch (e) { /* no log */ }
}

function notify(detail = {}) {
    try { window.dispatchEvent(new CustomEvent(HUB_CHANGED_EVENT, { detail })); } catch (e) { /* no window (tests) */ }
}

function cfg() {
    return hubConfig(extensionSettings);
}

export function isHubOn() {
    return !!extensionSettings.enabled && isLiveWorldOn();
}

function chatArray() {
    if (Array.isArray(chat)) return chat;
    try { const c = getContext().chat; return Array.isArray(c) ? c : null; } catch (e) { return null; }
}

function meta() {
    if (chat_metadata && typeof chat_metadata === 'object') return chat_metadata;
    try { const m = getContext().chatMetadata; return m && typeof m === 'object' ? m : null; } catch (e) { return null; }
}

function chatId() {
    try { return getContext().chatId; } catch (e) { return undefined; }
}

/** The player under every name the chat may carry (Live World's rule). */
function playerNames() {
    const names = [];
    const add = (v) => { const t = String(v || '').trim(); if (t && !names.some(n => n.toLowerCase() === t.toLowerCase())) names.push(t); };
    try { add(resolvePersonaName()); } catch (e) { /* none */ }
    try { add(getContext().name1); } catch (e) { /* none */ }
    const list = chatArray();
    if (list) for (let i = list.length - 1; i >= 0; i--) { const m = list[i]; if (m && m.is_user) { add(m.name); break; } }
    return names;
}

function factsNow() {
    const f = sceneFactsFrom(lastGeneratedData.infoBox || committedTrackerData.infoBox);
    return { date: f.date || '', time: f.time || '', location: f.location || '' };
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/** Waits for the main generation and the background request to finish, up to the timing's limit. */
async function whenIdle(maxMs = timing.idleMaxMs) {
    const started = Date.now();
    for (;;) {
        if (ST.is_send_press !== true && !backgroundHolder()) return true;
        if (Date.now() - started >= maxMs) return false;
        await sleep(timing.idleStepMs);
    }
}

async function request(prompt, { transport, label }) {
    const external = extensionSettings.generationMode === 'external';
    const messages = [{ role: 'system', content: prompt.system }, { role: 'user', content: prompt.user }];
    const run = async () => {
        if (transport) return transport(prompt);
        if (external) return generateWithExternalAPI(messages);
        return safeGenerateRaw({ prompt: messages, quietToLoud: false });
    };
    await waitForBackground();
    const result = await withBackgroundProfile(run, { external, label });
    if (result === BACKGROUND_BUSY) return { busy: true, text: '' };
    const text = typeof result === 'string' ? result : (result && typeof result === 'object' && typeof result.text === 'string' ? result.text : String(result ?? ''));
    return { busy: false, text };
}

// ─── The store ──────────────────────────────────────────────────────────

let normalised = false;
function store() {
    if (!normalised || !extensionSettings.hub || typeof extensionSettings.hub !== 'object') {
        extensionSettings.hub = normalizeHub(extensionSettings.hub);
        normalised = true;
    }
    return extensionSettings.hub;
}

function saveStore(detail) {
    try { saveSettings(); } catch (e) { log('settings save failed', String(e && e.message || e)); }
    notify(detail);
}

/** A copy of the store. */
export function getHubStore() {
    return JSON.parse(JSON.stringify(store()));
}

/** A world's entry, made when missing (never saved by itself). */
function entryOf(worldId) {
    const s = store();
    const id = String(worldId || '').trim();
    if (!id) return null;
    if (!s.worlds[id]) s.worlds[id] = normalizeWorldEntry(null);
    return s.worlds[id];
}

function putEntry(worldId, entry, detail) {
    store().worlds[worldId] = entry;
    saveStore(detail);
}

/** A copy of a world's entry, or null when the world has none. */
export function worldEntry(worldId) {
    const e = store().worlds[String(worldId || '').trim()];
    return e ? JSON.parse(JSON.stringify(e)) : null;
}

/** The worlds the hub can play: the user's own (the blank world and the template are not bound). */
export function hubWorldIds() {
    const packs = liveWorldConfig(extensionSettings).customPacks || {};
    return Object.keys(packs).filter(id => id && id !== BLANK_PACK_ID);
}

// ─── The chat bridge ────────────────────────────────────────────────────

function defaultBridge() {
    const ctx = () => getContext();
    const call = (name, ...args) => { const c = ctx(); if (typeof c[name] !== 'function') throw new Error(`too-old:${name}`); return c[name](...args); };
    const post = async (url, body) => {
        const res = await fetch(url, { method: 'POST', headers: getRequestHeaders(), body: JSON.stringify(body) });
        if (!res || !res.ok) throw new Error(`${url} answered ${res ? res.status : 'nothing'}`);
        return res;
    };
    return {
        has: (name) => { try { return typeof ctx()[name] === 'function'; } catch (e) { return false; } },
        characters: () => { try { const c = ctx().characters; return Array.isArray(c) ? c : []; } catch (e) { return []; } },
        characterId: () => { try { return ctx().characterId; } catch (e) { return undefined; } },
        groupId: () => { try { return ctx().groupId; } catch (e) { return undefined; } },
        chatId: () => chatId(),
        name2: () => { try { return String(ctx().name2 || ''); } catch (e) { return ''; } },
        selectCharacterById: (i) => call('selectCharacterById', i),
        openCharacterChat: (file) => call('openCharacterChat', file),
        unshallowCharacter: async (i) => { try { if (typeof ctx().unshallowCharacter === 'function') await ctx().unshallowCharacter(i); } catch (e) { /* an older build */ } },
        getCharacters: async () => { try { if (typeof ctx().getCharacters === 'function') await ctx().getCharacters(); } catch (e) { /* an older build */ } },
        saveChat: async () => { try { if (typeof ctx().saveChat === 'function') return await ctx().saveChat(); } catch (e) { /* fall through */ } return saveChatConditional(); },
        listChats: async (avatar, { metadata = false } = {}) => {
            const res = await post('/api/characters/chats', { avatar_url: avatar, metadata, simple: !metadata });
            const data = await res.json();
            if (!data || typeof data !== 'object' || data.error) return [];    // a card never opened has no chats folder: SillyTavern answers { error: true }
            return (Array.isArray(data) ? data : Object.values(data)).filter(c => c && typeof c === 'object');
        },
        saveChatFile: async ({ chName, avatar, fileName, header, messages }) => {
            await post('/api/chats/save', { ch_name: chName, file_name: fileName, chat: [header, ...messages], avatar_url: avatar, force: true });
            return true;
        },
        createCharacter: async (fields) => {
            const res = await post('/api/characters/create', fields);
            return String(await res.text()).trim();
        },
        timestamp: () => { try { return getMessageTimeStamp(); } catch (e) { return new Date().toISOString(); } },
        userAvatar: () => { try { return typeof user_avatar === 'string' ? user_avatar : ''; } catch (e) { return ''; } },
        uuid: () => { try { return crypto.randomUUID(); } catch (e) { return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`; } },
    };
}

function bridge() {
    return bridgeOverride || defaultBridge();
}

/** Test hook: the SillyTavern calls behind one object (any member left out falls back to the default's). */
export function __setChatBridge(b) {
    bridgeOverride = b && typeof b === 'object' ? { ...defaultBridge(), ...b } : null;
}

export function __setOpenersTransport(fn) { openersTransport = typeof fn === 'function' ? fn : null; }
export function __setRecapTransport(fn) { recapTransport = typeof fn === 'function' ? fn : null; }
export function __setGapTransport(fn) { gapTransport = typeof fn === 'function' ? fn : null; }
export function __setHooksTransport(fn) { hooksTransport = typeof fn === 'function' ? fn : null; }
export function __setHubTiming(t) { timing = { ...timing, ...(t || {}) }; }

/** The card bound to a world: its index, avatar and name; null when none or gone. */
export function cardOf(worldId) {
    const e = store().worlds[String(worldId || '').trim()];
    if (!e || !e.card) return null;
    const list = bridge().characters();
    const index = list.findIndex(c => c && c.avatar === e.card);
    if (index < 0) return null;
    return { index, avatar: e.card, name: String(list[index].name || ''), chat: String(list[index].chat || '') };
}

/** The world a card narrates, or ''. */
export function worldOfCard(avatar) {
    for (const [id, e] of Object.entries(store().worlds)) if (e.card && e.card === avatar) return id;
    return '';
}

/** Binds a card to a world (D114): one card, one world. */
export function bindCard(worldId, avatar) {
    const id = String(worldId || '').trim();
    const key = String(avatar || '').trim();
    if (!id) return { ok: false, reason: 'no-world' };
    if (!key) return { ok: false, reason: 'no-card' };
    const other = worldOfCard(key);
    if (other && other !== id) return { ok: false, reason: 'bound-elsewhere', world: other };
    const e = entryOf(id);
    if (e.card === key) return { ok: true, changed: false };
    putEntry(id, { ...e, card: key }, { source: 'bind', world: id });
    log(`${id} is narrated by ${key}`);
    return { ok: true, changed: true };
}

export function unbindCard(worldId) {
    const id = String(worldId || '').trim();
    const e = store().worlds[id];
    if (!e || !e.card) return false;
    putEntry(id, { ...e, card: '' }, { source: 'unbind', world: id });
    return true;
}

/**
 * Make a narrator card (D114): a card named after the world, its
 * description the world's and the narrator's template, no greeting, the
 * default avatar; made through SillyTavern's create endpoint with the body
 * its own /char-create sends; then bound.
 */
export async function makeNarratorCard(worldId) {
    const id = String(worldId || '').trim();
    const res = await loadPack(id);
    if (!res.ok) return { ok: false, reason: 'no-world', errors: res.errors };
    const pack = res.pack;
    const name = `Narrator of ${pack.name}`.slice(0, 80);
    const description = [pack.description ? pack.description : `The narrator of ${pack.name}.`, pack.template ? `\n\n${pack.template}` : '', `\n\nYou narrate the world of ${pack.name}. The player's character is {{user}}. Each chat is one scene; the scene's brief says where it opens, who is there and what came before.`].join('');
    const fields = {
        ch_name: name, description, first_mes: '', personality: '', scenario: '', mes_example: '', creator_notes: `Made by Doom's Enhancement Suite for the world "${pack.name}" (the Hub).`,
        system_prompt: '', post_history_instructions: '', creator: '', character_version: '', tags: [], talkativeness: '0.5', world: '', depth_prompt_prompt: '', depth_prompt_depth: '4', depth_prompt_role: 'system', fav: 'false', alternate_greetings: [], extensions: '{}',
    };
    try {
        const b = bridge();
        const avatarKey = await b.createCharacter(fields);
        if (!avatarKey) return { ok: false, reason: 'create', error: 'SillyTavern returned no card.' };
        const avatar = /\.png$/i.test(avatarKey) ? avatarKey : `${avatarKey}.png`;
        await b.getCharacters();
        const bound = bindCard(id, avatar);
        log(`made the narrator card "${name}" (${avatar})`);
        return { ok: bound.ok, reason: bound.ok ? undefined : bound.reason, avatar, name };
    } catch (e) {
        const error = String(e && e.message || e);
        log('the narrator card could not be made', error);
        return { ok: false, reason: 'create', error };
    }
}

// ─── The chat in front ──────────────────────────────────────────────────

/** Whether the chat in front is a scene (D113: the mark decides, nothing else). */
export function isScene() {
    return !!currentScene();
}

/** The chat in front as a scene: its world, its mark and its record; null when it is not one. */
export function currentScene() {
    const mark = readMark(meta());
    if (!mark) return null;
    if (!markIsOfFile(mark, chatId())) return null;    // a branch or a checkpoint of a scene carries its mark under another name (D113)
    const entry = store().worlds[mark.world] || null;
    const file = chatId();
    const record = entry ? (sceneByChat(entry, file) || entry.scenes.find(s => s.id === mark.scene) || null) : null;
    return { worldId: mark.world, mark, scene: record ? JSON.parse(JSON.stringify(record)) : null, ended: !!mark.endedAt };
}

/** CHAT_CHANGED: the chat in front, a scene or not. */
export function onHubChatChanged() {
    pending = null;
    stripNote = '';
    if (lastEnd && chatId() !== lastEnd.chat) lastEnd = null;    // the last End is put back from its own scene's chat only (D190)
    const mark = extensionSettings.enabled ? readMark(meta()) : null;
    current = mark ? { worldId: mark.world, mark } : null;
    if (!current) setBriefSlot('');
    mountStrip();
    notify({ source: 'chat' });
}

/**
 * CHAT_RENAMED (SillyTavern's own event: the card's avatar, the old and the
 * new file names with their extension): a scene's record follows its
 * file, and the chat in front, reloaded under the new name with the old
 * name in its mark, has its mark rewritten so it is still the scene.
 */
export async function onHubChatRenamed(ev) {
    const e = ev && typeof ev === 'object' ? ev : {};
    const strip = (v) => String(v || '').replace(/\.jsonl$/i, '');
    const oldName = strip(e.oldFileName);
    const newName = strip(e.newFileName);
    if (!oldName || !newName) return;
    const s = store();
    let changed = false;
    for (const [id, entry] of Object.entries(s.worlds)) {
        if (e.avatarId && entry.card && entry.card !== e.avatarId) continue;
        if (!sceneByChat(entry, oldName)) continue;
        s.worlds[id] = renameSceneChat(entry, oldName, newName).entry;
        changed = true;
    }
    if (changed) saveStore({ source: 'rename' });
    const m = meta();
    const mark = readMark(m);
    if (mark && mark.file && strip(mark.file).toLowerCase() === oldName.toLowerCase() && strip(chatId()).toLowerCase() === newName.toLowerCase()) {
        m[HUB_META_KEY] = { ...m[HUB_META_KEY], file: newName };
        try { await bridge().saveChat(); } catch (err) { log('the renamed mark could not be saved', String(err && err.message || err)); }
        onHubChatChanged();
    }
}

/** CHAT_DELETED (SillyTavern's own event, the chat's name): a scene's chat gone marks its record. */
export function onHubChatDeleted(name) {
    const file = typeof name === 'string' ? name : (name && typeof name === 'object' ? String(name.name || name.file || '') : '');
    if (!file) return;
    const s = store();
    let changed = false;
    for (const [id, e] of Object.entries(s.worlds)) {
        if (!sceneByChat(e, file)) continue;
        s.worlds[id] = markChatGone(e, file).entry;
        changed = true;
    }
    if (changed) saveStore({ source: 'chat-gone' });
}

/**
 * The chat in front flushed before a switch away from it: the tracker's
 * stores rebuilt and written through the conditional save, and any
 * background request landed. Debounced saves are lost on a chat switch.
 */
async function flushChat() {
    if (chatId() === undefined) return true;
    try { await saveChatData({ immediate: true }); } catch (e) { log('the flush failed', String(e && e.message || e)); return false; }
    try { await waitForBackground(); } catch (e) { /* no holder */ }
    return true;
}

/** The last reply's id (Live World's stamp, else Canon's), for the mark's record of what End ran. */
function lastReplyId() {
    const list = chatArray() || [];
    for (let i = list.length - 1; i >= 0; i--) {
        const m = list[i];
        if (!m || m.is_user || m.is_system) continue;
        return String(m.dooms_world_id || m.dooms_canon_id || `${i}:${String(m.mes || '').length}`);
    }
    return '';
}

// ─── The people's own notes, from the lorebooks (D177) ──────────────────

let loreReader = null;    // test hook: (book) => Promise<the book's data, or null>

/** Test hook: how a lorebook is read, or null for SillyTavern's. With a reader set, a world with no campaign reads no books. */
export function __setLoreReader(fn) {
    loreReader = typeof fn === 'function' ? fn : null;
}

/** The lorebooks a world's scenes take their people from: its campaign's (the Lore Library's), else the books switched on. */
async function booksOf(worldId) {
    const e = store().worlds[String(worldId || '')];
    const lb = extensionSettings.lorebook;
    const c = e && e.campaign && lb && lb.campaigns && typeof lb.campaigns === 'object' ? lb.campaigns[e.campaign] : null;
    // The world's own continuity book (D189) is not read here: what it holds is given to a scene by itself, as how things stand now.
    const own = e && e.continuity && e.continuity.book ? e.continuity.book.name : '';
    const notOwn = (list) => list.map(String).filter(b => b && b !== own).slice(0, LORE_BOOKS);
    if (c && Array.isArray(c.books) && c.books.length) return notOwn(c.books);
    if (loreReader) return [];
    try { const api = await import('../lorebook/lorebookAPI.js'); return notOwn(api.getActiveWorldNames() || []); } catch (e2) { return []; }
}

/**
 * What the lorebooks hold for a scene (D177): each person's own entry and
 * the entries that are always on. A background request sees no lorebook,
 * so the openings are given these; a book that cannot be read is passed
 * over, and with none read the openings are written as before.
 * @returns {Promise<{ lore: Array<{ name: string, text: string }>, standing: string, found: string[], missing: string[], books: string[] }>}
 */
async function sceneLore(worldId, names, players = []) {
    const out = { lore: [], standing: '', found: [], missing: [], books: [] };
    try {
        const books = await booksOf(worldId);
        const entries = [];
        for (const book of books) {
            try {
                const data = loreReader ? await loreReader(book) : await (await import('../lorebook/lorebookAPI.js')).loadWorldData(book, true);
                if (data) { entries.push(...loreEntries(book, data)); out.books.push(book); }
            } catch (e) { log(`the lorebook "${book}" could not be read`, String(e && e.message || e)); }
        }
        if (!entries.length) return out;
        const cast = castLore(entries, names);
        // The player's own entry, when there is room for it: who they are matters to how a scene opens on them.
        const left = Math.max(0, 10000 - cast.found.reduce((n, f) => n + f.text.length, 0));
        const mine = players.length && left >= 400 ? castLore(entries.filter(x => !cast.found.some(f => f.title === x.title && f.book === x.book)), players.slice(0, 1), { total: Math.min(left, 2000), perPerson: 2000 }) : { found: [] };
        out.lore = [...cast.found, ...mine.found].map(f => ({ name: f.name, text: f.text }));
        out.found = cast.found.map(f => f.name);
        out.missing = cast.missing;
        out.standing = standingLore(entries);
    } catch (e) { log('the lorebooks could not be read for the scene', String(e && e.message || e)); }
    return out;
}

// ─── The continuity book (D170, D189) ───────────────────────────────────

let bookApi = null;    // test hook: how a lorebook is listed, read, made, written and filed

/** Test hook: the lorebook's own doings ({ names, load, save, create, entry, active, file }), or null for SillyTavern's. */
export function __setBookApi(api) {
    bookApi = api && typeof api === 'object' ? api : null;
}

function defaultBookApi() {
    const lib = () => import('../lorebook/lorebookAPI.js');
    return {
        names: async () => { const list = (await lib()).getAllWorldNames(); return Array.isArray(list) ? list.filter(n => typeof n === 'string') : []; },
        load: async (name) => (await lib()).loadWorldData(name, true),
        save: async (name, data) => (await lib()).saveWorldData(name, data),
        create: async (name) => (await lib()).createNewWorld(name),
        entry: async (name, data) => (await lib()).createEntry(name, data),
        active: async (name) => (await lib()).isWorldActive(name),
        remove: async (name, data, uid) => { await (await lib()).deleteEntry(data, uid); if (data && data.entries) delete data.entries[uid]; },
        // Filed with the world's campaign, so it is switched on with the campaign's other books; a world with no campaign has it switched on by itself.
        file: async (campaignId, name) => {
            const lb = extensionSettings.lorebook;
            if (campaignId && lb && lb.campaigns && lb.campaigns[campaignId]) {
                const cm = await import('../lorebook/campaignManager.js');
                cm.addBookToCampaign(campaignId, name);
                await cm.queueReconcile();
            } else await (await lib()).activateWorld(name);
        },
    };
}
const books = () => bookApi || defaultBookApi();
const BOOK_WAIT_MS = 20000;    // a lorebook that does not answer does not hold up an End
/** A step of the book's, given up on when it takes too long: what it was doing is left to finish or not by itself. */
const bookStep = (work) => Promise.race([work, new Promise((_, no) => setTimeout(() => no(new Error('the lorebook did not answer in time')), BOOK_WAIT_MS))]);

/**
 * What the world's continuity book says that its continuity does not
 * (D189), taken in: an entry the player changed by hand is how things
 * stand, an entry they deleted is let go. Run before the continuity is
 * read (an End, a Start). A book that is gone is forgotten (a new one is
 * written at the next End); one that cannot be read changes nothing.
 */
async function syncFromBook(worldId) {
    const entry = store().worlds[String(worldId || '')];
    const track = entry && entry.continuity ? entry.continuity.book : null;
    if (!track) return null;
    try {
        const api = books();
        const names = await bookStep(api.names());
        if (!Array.isArray(names)) return null;
        if (!names.includes(track.name)) {
            putEntry(worldId, { ...entryOf(worldId), continuity: forgetBook(entry.continuity) }, { source: 'book', world: worldId });
            log(`the continuity book "${track.name}" is gone; a new one is written at the next End`);
            return null;
        }
        const data = await bookStep(api.load(track.name));
        if (!data) return null;
        const r = readBook(entry.continuity, data);
        if (r.changed) {
            putEntry(worldId, { ...entryOf(worldId), continuity: r.cont }, { source: 'book', world: worldId });
            log('the continuity book was changed by hand; what it says is taken', r.adopted);
        }
        return r.adopted;
    } catch (e) {
        log('the continuity book could not be read', String(e && e.message || e));
        return null;
    }
}

/**
 * The world's continuity written to its book (D189): the book made when
 * the world has none (named after its campaign and filed with it, so it
 * is on when the campaign is), an entry made for each person who has
 * none, the text changed where a standing has moved on, the threads'
 * entry kept up. Only texts DES wrote are written; `syncFromBook` runs
 * first, so nothing the player changed is written over unseen.
 * @returns {Promise<{ state: 'off'|'ok'|'failed', name?: string, made?: boolean, written?: number, error?: string }>}
 */
async function mirrorBook(worldId) {
    const first = entryOf(worldId);
    if (!hasContinuity(first.continuity) && !first.continuity.book) return { state: 'off' };
    try {
        return await bookStep(writeBook(worldId));
    } catch (e) {
        const error = String(e && e.message || e);
        log('the continuity book could not be written', error);
        return { state: 'failed', error };
    }
}

async function writeBook(worldId) {
    {
        await syncFromBook(worldId);
        const entry = entryOf(worldId);
        let cont = entry.continuity;
        const api = books();
        const names = await api.names();
        if (!Array.isArray(names)) throw new Error('the lorebooks could not be listed');
        let name = cont.book ? cont.book.name : '';
        let made = false;
        if (!name || !names.includes(name)) {
            if (!name) {
                const lb = extensionSettings.lorebook;
                const camp = entry.campaign && lb && lb.campaigns ? lb.campaigns[entry.campaign] : null;
                const res = camp ? null : await loadPack(worldId);
                const wanted = continuityBookName(camp ? camp.name : (res && res.ok ? res.pack.name : worldId));
                name = wanted;
                for (let n = 2; n < 100 && names.includes(name); n++) name = `${wanted} ${n}`;    // a book of that name that is not this world's is left alone
                if (names.includes(name)) throw new Error(`no free name for the book ("${wanted}")`);
            }
            await api.create(name);
            await api.file(entry.campaign, name);
            cont = forgetBook(cont);
            made = true;
        }
        const data = await api.load(name);
        if (!data) throw new Error(`the lorebook "${name}" could not be read`);
        if (!data.entries || typeof data.entries !== 'object') data.entries = {};
        const plan = planBook(cont, data);
        const written = [];
        const undo = { name, made, created: [], texts: [] };    // what this writing changed in the book: the entries it made, and the texts it replaced
        for (const op of plan.ops) {
            if (op.op === 'create') {
                const made1 = await api.entry(name, data);
                if (!made1 || !Number.isInteger(made1.uid)) continue;
                Object.assign(made1, { ...op.fields, key: op.fields.key.slice(), addMemo: true });
                written.push({ who: op.who, uid: made1.uid, content: op.fields.content });
                undo.created.push(made1.uid);
            } else if (data.entries[op.uid]) {
                undo.texts.push({ uid: op.uid, content: String(data.entries[op.uid].content ?? '') });
                data.entries[op.uid].content = op.content;
                written.push({ who: op.who, uid: op.uid, content: op.content });
            }
        }
        if (written.length) await api.save(name, data);
        putEntry(worldId, { ...entryOf(worldId), continuity: trackWritten(cont, name, written) }, { source: 'book', world: worldId });
        log(`the continuity book "${name}" ${made ? 'made and ' : ''}written`, { entries: written.length });
        return { state: 'ok', name, made, written: written.length, undo };
    }
}

/** Whether the world's continuity book is there and switched on: then SillyTavern's own World Info carries it into every reply, and a scene's brief need not. */
async function bookIsLive(worldId) {
    const entry = store().worlds[String(worldId || '')];
    const track = entry && entry.continuity ? entry.continuity.book : null;
    if (!track) return false;
    try { const api = books(); const names = await bookStep(api.names()); return Array.isArray(names) && names.includes(track.name) && (await bookStep(api.active(track.name))) === true; } catch (e) { return false; }
}

/** The name of a world's continuity book, '' when it has none yet. */
export function continuityBookOf(worldId) {
    const entry = store().worlds[String(worldId || '')];
    return entry && entry.continuity && entry.continuity.book ? entry.continuity.book.name : '';
}

/** A lorebook renamed in the Lore Library: a world whose continuity book it is follows the name. */
export function onHubBookRenamed(oldName, newName) {
    for (const [id, e] of Object.entries(store().worlds)) {
        if (e && e.continuity && e.continuity.book && e.continuity.book.name === oldName) putEntry(id, { ...entryOf(id), continuity: renameBook(e.continuity, newName) }, { source: 'book', world: id });
    }
}

/** A lorebook deleted in the Lore Library: a world whose continuity book it was forgets it (its continuity stays; the next End writes a new book). */
export function onHubBookDeleted(name) {
    for (const [id, e] of Object.entries(store().worlds)) {
        if (e && e.continuity && e.continuity.book && e.continuity.book.name === name) putEntry(id, { ...entryOf(id), continuity: forgetBook(e.continuity) }, { source: 'book', world: id });
    }
}

// ─── Start (D117, D118, D119) ───────────────────────────────────────────

function guardStart(worldId) {
    if (!isHubOn()) return { ok: false, reason: 'off' };
    if (ST.is_send_press === true) return { ok: false, reason: 'busy' };
    const id = String(worldId || '').trim();
    if (!id) return { ok: false, reason: 'no-world' };
    const b = bridge();
    for (const name of ['selectCharacterById', 'openCharacterChat']) if (!b.has(name)) return { ok: false, reason: 'too-old', missing: name };
    const e = store().worlds[id];
    if (!e || !e.card) return { ok: false, reason: 'no-card' };
    const card = cardOf(id);
    if (!card) return { ok: false, reason: 'card-gone' };
    const open = openSceneOf(e);
    if (open && !open.gone) return { ok: false, reason: 'scene-open', scene: JSON.parse(JSON.stringify(open)) };
    return { ok: true, id, entry: e, card };
}

/** A place's own label (not the path the Map window prints). */
function labelOf(pack, placeId) {
    const id = resolvePlace(pack, placeId);
    const p = id ? pack.places.find(x => x.id === id) : null;
    return p ? p.label : placeLabel(pack, placeId);
}

/** The region (the top-level place) of a place of the pack; '' for a place the pack does not name. */
function regionOf(pack, placeId) {
    const id = resolvePlace(pack, placeId);
    const chain = placeChain(pack, id);    // root first
    if (!chain.length) return '';
    const top = chain[0];
    return top && top.id !== id ? top.label : '';
}

/** The people's lines for the brief and the openers: the Workshop's description, else the tier the world knows them by. */
function castLines(names, worldState) {
    const inj = extensionSettings.characterInjection && typeof extensionSettings.characterInjection === 'object' ? extensionSettings.characterInjection : {};
    return names.map(name => {
        const key = Object.keys(inj).find(k => sameName(k, name));
        const description = key && inj[key] && typeof inj[key].description === 'string' ? inj[key].description : '';
        const tier = worldState && worldState.known ? (worldState.known[name] || Object.entries(worldState.known).find(([k]) => sameName(k, name))?.[1] || '') : '';
        return { name, line: personLine(name, { description, tier }) };
    });
}

/** The world's memory for a Start: the snapshot, or a first seed from the pack. */
function memoryFor(entry, pack, worldId) {
    if (entry.memory && entry.memory.stores && entry.memory.stores.dooms_world) return entry.memory;
    const state = seedWorldState(pack, { name: '' });
    state.pack = worldId;
    return { v: 1, takenAt: 0, scene: '', stores: { ...(entry.memory && entry.memory.stores ? entry.memory.stores : {}), dooms_world: state }, facts: entry.memory && entry.memory.facts ? entry.memory.facts : { date: '', time: '', location: '', weather: '' } };
}

/**
 * The world moves by the gap (§5.3): one run over the snapshot's world
 * state with no chat behind it; the snapshot takes the result. Nothing is
 * written when the reply breaks a rule, the request fails or the line is
 * busy; Start goes on either way.
 */
async function moveWorldByGap(worldId, pack, memory, gap, recaps, { mode = 'between', from = '', to = '' } = {}) {
    const state = normalizeWorldState(memory.stores.dooms_world);
    const lw = liveWorldConfig(extensionSettings);
    const players = playerNames();
    const prompt = buildGapPrompt({ pack, state, facts: memory.facts, gap: gap.words, recaps, maxStep: lw.maxStep, spoilerFree: lw.spoilerFree, player: players, mode, from, to });
    log(mode === 'after' ? 'the world moves for the scene just ended' : `the world moves by "${gap.words}" before the scene`, { world: worldId });
    try {
        const r = await request(prompt, { transport: gapTransport, label: 'gap' });
        if (r.busy) return { ok: false, reason: 'busy' };
        const v = validateGap(parseAdvanceReply(r.text), pack, state, { maxStep: lw.maxStep, player: players });
        if (!v.ok) { log('the gap run was discarded', v.errors); return { ok: false, reason: 'invalid', errors: v.errors }; }
        const next = applyGap(state, v.clean, pack, { facts: memory.facts, ranAt: Date.now() });
        const facts = { ...memory.facts, ...(v.clean.now ? { date: v.clean.now.date, time: v.clean.now.time } : {}) };
        return { ok: true, memory: { ...memory, stores: { ...memory.stores, dooms_world: next }, facts }, clean: v.clean };
    } catch (e) {
        const error = String(e && e.message || e);
        log('the gap run failed', error);
        return { ok: false, reason: 'error', error };
    }
}

/**
 * A Start prepared (D117): the guards, the world moved by the gap, the
 * openers asked. Returns what the picker shows; commitScene writes the
 * file and opens it. One pending Start at a time.
 * @param {{ worldId: string, seed?: object, place?: { id?: string, label?: string }, cast?: string[], gap?: { id: string, words?: string }, note?: string, hookId?: string }} args
 */
export async function prepareScene({ worldId, seed = null, place = null, cast = [], gap = null, note = '', hookId = '' } = {}) {
    const g = guardStart(worldId);
    if (!g.ok) return g;
    const res = await loadPack(g.id);
    if (!res.ok) return { ok: false, reason: 'no-world', errors: res.errors };
    const pack = res.pack;
    const token = ++pendingToken;
    pending = null;
    const theGap = gapOf(gap && gap.id, gap && gap.words);
    let memory = memoryFor(g.entry, pack, g.id);
    const recaps = lastRecaps(g.entry, 2);
    const notes = [];
    let movedMemory = null;    // the gap run's result is held with the Start and written with the record (a Start backed out of moves nothing)
    // A world no scene has ended in is not moved before its first: a memory a hooks round made (takenAt 0) is not one an End wrote.
    if (gapMoves(theGap) && g.entry.memory && g.entry.memory.takenAt > 0) {
        const moved = await moveWorldByGap(g.id, pack, memory, theGap, recaps);
        if (token !== pendingToken) return { ok: false, reason: 'cancelled' };
        if (moved.ok) { memory = moved.memory; movedMemory = moved.memory; }
        else notes.push(`The world did not move for the gap (${moved.reason}${moved.errors ? `: ${moved.errors.join(' ')}` : moved.error ? `: ${moved.error}` : ''}).`);
    }
    const worldState = normalizeWorldState(memory.stores.dooms_world);
    const placeId = place && place.id ? resolvePlace(pack, place.id) || String(place.id) : '';
    const label = (place && place.label) || (placeId ? labelOf(pack, placeId) : '') || memory.facts.location || '';
    const region = placeId ? regionOf(pack, placeId) : '';
    const players = playerNames();
    const names = [];
    for (const n of Array.isArray(cast) ? cast : []) { const c = String(n || '').trim(); if (c && !players.some(p => sameName(p, c)) && !names.some(x => sameName(x, c))) names.push(c); }
    const lines = castLines(names, worldState);
    const seedText = seed && typeof seed === 'object' ? String(seed.text || seed.label || '') : String(seed || '');
    const weather = label && memory.facts.location && sameName(label, memory.facts.location) ? memory.facts.weather : '';
    const canonBlock = memory.stores.dooms_canon ? buildCanonBlock(normalizeCanon(memory.stores.dooms_canon), { maxChars: 1200 }) : '';
    const quests = memory.stores.dooms_tracker && memory.stores.dooms_tracker.quests ? memory.stores.dooms_tracker.quests : { main: 'None', optional: [] };
    // The people's own entries and the campaign's standing notes, read from its lorebooks (D177): the request sees no lorebook otherwise.
    const notesOf = await sceneLore(g.id, names, players);
    if (token !== pendingToken) return { ok: false, reason: 'cancelled' };
    // Where the people of the scene stand now and what the story has left open (D188), as the scenes before left them
    // and as the player has since corrected them in the continuity book (D189).
    await syncFromBook(g.id);
    if (token !== pendingToken) return { ok: false, reason: 'cancelled' };
    const contNow = entryOf(g.id).continuity;
    const stand = standingLines(contNow, names);
    const threads = threadLines(contNow);
    const prompt = buildOpenersPrompt({ world: pack, place: label, region, weather, date: memory.facts.date, time: memory.facts.time, gapWords: theGap.words, cast: lines.map(l => l.line), seed: seedText, canonBlock, recaps, quests, player: players[0] || '', note, lore: notesOf.lore, standing: notesOf.standing, style: isStyleLawOn() ? g.entry.style : null, stand, threads });
    let openers = [];
    let when = null;
    let errors = [];
    try {
        const r = await request(prompt, { transport: openersTransport, label: 'openers' });
        if (token !== pendingToken) return { ok: false, reason: 'cancelled' };
        if (r.busy) errors = ['Another request holds the line.'];
        else {
            const v = validateOpeners(parseOpenersReply(r.text), { cast: names, known: Object.keys(worldState.known || {}) });
            if (v.ok) { openers = v.clean.openers; when = v.clean.when; } else errors = v.errors;
            if (!v.ok) log('the openers were discarded', { errors: v.errors, reply: r.text.slice(0, 300) });
        }
    } catch (e) {
        errors = [String(e && e.message || e)];
        log('the openers request failed', errors[0]);
    }
    const since = recentChanges(worldState, pack, { limit: 8, spoilerFree: liveWorldConfig(extensionSettings).spoilerFree }).map(c => `${c.gameDate ? `${c.gameDate}: ` : ''}${c.text}`);
    pending = {
        token, worldId: g.id, pack, card: g.card, memory, seed: seed && typeof seed === 'object' ? seed : { kind: 'anywhere', text: seedText }, place: { id: placeId, label, region }, cast: names, lines, gap: theGap, note: String(note || ''),
        weather, since, recaps, player: players, openers, when, errors, notes, prompt, movedMemory,
        lore: { found: notesOf.found, missing: notesOf.missing, standing: !!notesOf.standing, books: notesOf.books },
        stand, threads, continuity: { stand: stand.map(x => x.name), threads: threads.length },
    };
    return { ok: true, token, world: { id: g.id, name: pack.name }, place: pending.place, cast: names, gap: theGap, openers, when, errors, notes, lore: pending.lore, continuity: pending.continuity };
}

// ─── Hooks over the memory (§4.4) ────────────────────────────────────────

/** The round on offer in a world's memory (empty until one is asked for). */
export function hubHooks(worldId) {
    const entry = worldEntry(worldId);
    const raw = entry && entry.memory && entry.memory.stores ? entry.memory.stores.dooms_hooks : null;
    return raw ? normalizeHooks(raw) : emptyHooks();
}

export function isHooksBusy(worldId) {
    return !!hooksBusyWorld && hooksBusyWorld === String(worldId || '').trim();
}

/**
 * Asks for a round of hooks over the world's memory: Hooks' own prompt and
 * checks over the snapshot's world state and quests, the last recaps in
 * place of recent scenes; the round is written sealed into the memory (a
 * world with no memory yet gets one from the pack's seed) and a scene
 * started from a hook takes it as its quest (seedStores). Nothing is
 * written when the reply holds no usable hook; the round on offer stays
 * and the failure is noted.
 * @returns {Promise<{ ok: boolean, reason?: string, hooks?: object[], errors?: string[], error?: string }>}
 */
export async function proposeHubHooks(worldId) {
    if (!isLiveWorldOn()) return { ok: false, reason: 'off' };
    const id = String(worldId || '').trim();
    const entry = worldEntry(id);
    if (!id || !entry) return { ok: false, reason: 'no-world' };
    // While a scene is open its chat holds the live round and End writes the chat's stores over the memory (D122): a round
    // asked here would be lost at End, and a hook set aside offered again. The Map window serves the open scene's hooks.
    const open = openSceneOf(entry);
    if (open && !open.gone) return { ok: false, reason: 'scene-open', scene: JSON.parse(JSON.stringify(open)) };
    const res = await loadPack(id);
    if (!res.ok) return { ok: false, reason: 'no-world', errors: res.errors };
    if (hooksBusyWorld) return { ok: false, reason: 'running' };
    const pack = res.pack;
    hooksBusyWorld = id;
    notify({ source: 'hooks-start', world: id });
    try {
        const memory = memoryFor(entry, pack, id);
        const state = normalizeWorldState(memory.stores.dooms_world);
        const current = memory.stores.dooms_hooks ? normalizeHooks(memory.stores.dooms_hooks) : emptyHooks();
        const quests = memory.stores.dooms_tracker && memory.stores.dooms_tracker.quests ? memory.stores.dooms_tracker.quests : { main: 'None', optional: [] };
        const done = Array.isArray(memory.stores.dooms_quests_done) ? memory.stores.dooms_quests_done : [];
        const recent = lastRecaps(entry, 3).map((r, i) => `${i + 1}. ${r}`).join('\n');
        const now = { date: memory.facts.date, time: memory.facts.time, location: memory.facts.location };
        const prompt = buildHooksPrompt({ pack, state, quests, done, taken: current.taken, aside: current.aside, recent, now, player: memory.player || playerNames() });
        log('hooks requested over the memory', { world: id });
        const r = await request(prompt, { transport: hooksTransport, label: 'hooks' });
        if (r.busy) return { ok: false, reason: 'busy' };
        const ranAt = Date.now();
        const latest = worldEntry(id);
        if (!latest) return { ok: false, reason: 'no-world' };
        const mem = latest.memory && latest.memory.stores && latest.memory.stores.dooms_world ? latest.memory : memoryFor(latest, pack, id);
        const held = mem.stores.dooms_hooks ? normalizeHooks(mem.stores.dooms_hooks) : current;
        // Checked against the round as it stands now: a hook set aside while the request ran is not offered back by it.
        const v = validateHooks(parseHooksReply(r.text), { quests, done, taken: held.taken, aside: held.aside });
        if (!v.ok) {
            putEntry(id, normalizeWorldEntry({ ...latest, memory: { ...mem, stores: { ...mem.stores, dooms_hooks: failRound(held, { error: v.errors.join(' '), ranAt }) } } }), { source: 'hooks-failed', world: id });
            log('hooks discarded', { errors: v.errors, reply: r.text.slice(0, 400) });
            return { ok: false, reason: 'invalid', errors: v.errors };
        }
        putEntry(id, normalizeWorldEntry({ ...latest, memory: { ...mem, stores: { ...mem.stores, dooms_hooks: proposeRound(held, v.hooks, { msgId: null, gameDate: now.date || '', ranAt }) } } }), { source: 'hooks', world: id });
        log('hooks offered', v.hooks.map(h => h.title));
        return { ok: true, hooks: v.hooks, errors: v.errors };
    } catch (e) {
        const error = String(e && e.message || e);
        log('the hooks request failed', error);
        return { ok: false, reason: 'error', error };
    } finally {
        hooksBusyWorld = '';
        notify({ source: 'hooks-end', world: id });
    }
}

/** A hook set aside in the memory's round (D103): not offered again. */
export function setHubHookAside(worldId, hookId) {
    const id = String(worldId || '').trim();
    const entry = worldEntry(id);
    if (!entry || !entry.memory || !entry.memory.stores || !entry.memory.stores.dooms_hooks) return false;
    const open = openSceneOf(entry);
    if (open && !open.gone) return false;    // the scene's End would write the chat's round over it (proposeHubHooks)
    const r = setAsidePureHook(normalizeHooks(entry.memory.stores.dooms_hooks), hookId);
    if (!r.hook) return false;
    putEntry(id, normalizeWorldEntry({ ...entry, memory: { ...entry.memory, stores: { ...entry.memory.stores, dooms_hooks: r.hooks } } }), { source: 'hook-aside', world: id });
    return true;
}

/** The pending Start, for the picker. */
export function pendingStart() {
    return pending ? { token: pending.token, world: { id: pending.worldId, name: pending.pack.name }, place: pending.place, cast: pending.cast, gap: pending.gap, openers: pending.openers, when: pending.when, errors: pending.errors, notes: pending.notes, lore: pending.lore || null } : null;
}

/** Ask again (D119): three more; the old ones stay until the new land. */
export async function askOpenersAgain(token) {
    if (!pending || pending.token !== token) return { ok: false, reason: 'cancelled' };
    const p = pending;
    try {
        const r = await request(p.prompt, { transport: openersTransport, label: 'openers' });
        if (!pending || pending.token !== token) return { ok: false, reason: 'cancelled' };
        if (r.busy) return { ok: false, reason: 'busy', openers: p.openers };
        const v = validateOpeners(parseOpenersReply(r.text), { cast: p.cast, known: Object.keys(normalizeWorldState(p.memory.stores.dooms_world).known || {}) });
        if (!v.ok) return { ok: false, reason: 'openers', errors: v.errors, openers: p.openers };
        p.openers = v.clean.openers;
        p.when = v.clean.when || p.when;
        p.errors = [];
        return { ok: true, openers: p.openers, when: p.when };
    } catch (e) {
        return { ok: false, reason: 'error', error: String(e && e.message || e), openers: p.openers };
    }
}

export function cancelStart() {
    pending = null;
    pendingToken++;
}

/**
 * The file written and opened (D118): the chosen opener in front with the
 * others as swipes (or the player's own, or none), the stores seeded, the
 * brief as the scenario, the mark; saved under the card, the record made,
 * the card selected and the chat opened by name.
 * @param {number} token - the pending Start's
 * @param {{ choice?: number|'own'|'none', ownText?: string }} pick
 */
export async function commitScene(token, { choice = 0, ownText = '' } = {}) {
    if (!pending || pending.token !== token) return { ok: false, reason: 'cancelled' };
    const p = pending;
    const g = guardStart(p.worldId);
    if (!g.ok) return g;
    let list = [];
    if (choice === 'own') { const text = String(ownText || '').trim(); if (text) list = [{ title: sceneTitle({ seed: p.seed, place: p.place.label }), text, who: p.cast.slice() }]; }
    else if (choice !== 'none' && p.openers.length) { const i = Math.min(p.openers.length - 1, Math.max(0, Number(choice) || 0)); list = [p.openers[i], ...p.openers.filter((_, k) => k !== i)]; }
    const b = bridge();
    if (ST.is_send_press === true) return { ok: false, reason: 'busy' };
    const entry = entryOf(p.worldId);
    const n = entry.seq + 1;
    const title = sceneTitle({ opener: list[0] || null, seed: p.seed, place: p.place.label });
    let existing = [];
    try { existing = (await b.listChats(p.card.avatar)).map(c => String(c.file_name || c.file_id || '')); } catch (e) { log('the card\'s chats could not be listed; the name is trusted', String(e && e.message || e)); }
    const fileName = sceneFileName(n, title, existing);
    const now = Date.now();
    // The memory as it stands now, not as the Start read it: a hooks round that landed while the openers waited on the line
    // is in it. The gap run's world and facts go over it when it is the memory the run moved (the same takenAt); a memory
    // an End replaced meanwhile keeps its own world, and the run's is let go.
    const live = entry.memory && entry.memory.stores && entry.memory.stores.dooms_world ? entry.memory : null;
    const moved = p.movedMemory && (!live || live.takenAt === p.movedMemory.takenAt) ? p.movedMemory : null;
    let memoryNow = live || p.memory;
    if (moved) memoryNow = { ...memoryNow, stores: { ...memoryNow.stores, dooms_world: moved.stores.dooms_world }, facts: moved.facts };
    const hooked = p.seed && p.seed.kind === 'hook' && p.seed.id ? { id: p.seed.id, title: p.seed.label || '', text: p.seed.text || '' } : null;
    const seeded = seedStores(memoryNow, { chatId: fileName, place: p.place.label, cast: p.cast, player: p.player, weather: p.weather, when: p.when, hookId: hooked ? hooked.id : '', hook: hooked, now });
    // With the continuity book switched on, SillyTavern's own World Info carries where people stand and the open threads
    // into every reply (D189); the brief says them only when the book is not there to.
    const bookOn = await bookIsLive(p.worldId);
    const brief = buildBrief({ world: p.pack.name, sceneNo: n, place: p.place.label, region: p.place.region, date: seeded.facts.date, time: seeded.facts.time, weather: seeded.facts.weather, gapWords: p.gap.words, cast: p.lines.map(l => l.line), seed: p.seed.text || p.seed.label || '', since: p.since, lastRecap: p.recaps[0] || '', beforeRecap: p.recaps[1] || '', player: p.player[0] || '', note: p.note, style: isStyleLawOn() ? g.entry.style : null, stand: bookOn ? [] : (p.stand || []), threads: bookOn ? [] : (p.threads || []) });
    const mark = hubMark({ world: p.worldId, scene: `s${n}`, title, seed: p.seed, place: p.place, cast: p.cast, gap: p.gap, startedAt: now, startDate: seeded.facts.date, file: fileName, brief });
    // The brief rides DES's own slot every generation (D120): a chat-completion preset may not send the scenario at all.
    const header = sceneHeader({ stores: seeded.stores, mark, scenario: '', worldInfo: '', integrity: b.uuid(), persona: b.userAvatar() });
    const message = list.length ? openerMessage({ name: p.card.name, openers: list, chosen: 0, sendDate: b.timestamp(), tracker: seeded.tracker, title }) : null;
    try {
        await b.saveChatFile({ chName: p.card.name, avatar: p.card.avatar, fileName, header, messages: message ? [message] : [] });
    } catch (e) {
        const error = String(e && e.message || e);
        log('the scene file could not be written', error);
        return { ok: false, reason: 'file', error };
    }
    const opened = openScene(entry, { title, seed: p.seed, place: p.place, cast: p.cast, gap: p.gap, chat: fileName, card: p.card.avatar, startedAt: now, startDate: seeded.facts.date });
    // The record and the world moved by the gap are written together, once the file exists (D117, §2.2); a hook played
    // leaves the memory's round, the way it left the chat's copy (§4.4), and one the round no longer holds (another
    // round landed while the Start waited) is recorded as played from the seed. A world with no memory gets none here.
    let memoryOut = live || moved ? memoryNow : null;
    if (memoryOut && hooked && memoryOut.stores) {
        const taken = takeHookPure(memoryOut.stores.dooms_hooks || null, hooked.id, { takenAt: now });
        const hooks = taken.hook ? taken.hooks : recordTaken(taken.hooks, hooked, { takenAt: now }).hooks;
        memoryOut = { ...memoryOut, stores: { ...memoryOut.stores, dooms_hooks: hooks } };
    }
    putEntry(p.worldId, memoryOut ? { ...opened.entry, memory: memoryOut } : opened.entry, { source: 'start', world: p.worldId });
    pending = null;
    lastEnd = null;    // the world has gone on: the last End is not put back from here (D190)
    log(`scene ${n} written: "${fileName}"`);
    if (!(await flushChat())) log('the chat in front could not be flushed before the switch; its last edits may be lost');
    try {
        await b.unshallowCharacter(p.card.index);
        // The card's remembered chat is the scene first, so a select loads the scene and never a stray chat.
        const cards = b.characters();
        if (cards[p.card.index]) cards[p.card.index].chat = fileName;
        if (String(b.characterId()) !== String(p.card.index) || b.groupId()) {
            await b.selectCharacterById(p.card.index);
            if (String(b.characterId()) !== String(p.card.index) || b.groupId()) throw new Error('the narrator card could not be selected (a generation running?)');
        }
        await b.openCharacterChat(fileName);
    } catch (e) {
        const error = String(e && e.message || e);
        log('the scene chat could not be opened', error);
        return { ok: false, reason: 'open', error, scene: opened.scene, file: fileName };
    }
    return { ok: true, scene: opened.scene, file: fileName, title };
}

/** Prepare and commit in one go with the first opener (the command path and the tests). */
export async function startScene(args, pick = { choice: 0 }) {
    const p = await prepareScene(args);
    if (!p.ok) return p;
    if (!p.openers.length && pick.choice !== 'own' && pick.choice !== 'none') pick = { choice: 'none' };
    return commitScene(p.token, pick);
}

// ─── End (D122) ─────────────────────────────────────────────────────────

function guardEnd() {
    const cur = currentScene();
    if (!cur) return { ok: false, reason: 'not-scene' };
    if (!extensionSettings.enabled) return { ok: false, reason: 'off' };
    const entry = store().worlds[cur.worldId];
    if (!entry) return { ok: false, reason: 'not-scene' };
    const record = cur.scene || null;
    if (record && record.status === 'ended' && cur.ended) return { ok: false, reason: 'not-open' };
    return { ok: true, cur, entry, record };
}

/** The style law is switched on (D180): off, nothing is counted, nothing is held against a scene and the narrator is told nothing of it. */
export function isStyleLawOn() {
    return cfg().styleLaw === true;
}

/** The names no phrase of a scene is made of: its people's, the player's, and everyone the world knows. */
function sceneNames() {
    const names = [...playerNames()];
    const cur = currentScene();
    if (cur && cur.mark && Array.isArray(cur.mark.cast)) names.push(...cur.mark.cast);
    const st = getWorldState();
    if (st && st.known && typeof st.known === 'object') names.push(...Object.keys(st.known));
    return names;
}

/** What the narrator leaned on in the scene in front (D179): counted over its own messages, in code. */
function sceneStyle() {
    try { return countStyle(narratorTexts(chatArray() || []), { names: sceneNames() }); } catch (e) { log('the style count failed', String(e && e.message || e)); return { messages: 0, phrases: [] }; }
}

let prepared = null;    // what the last prepared End's record said of the continuity: { id (the chat), reply (its last reply), change }

/** The people a scene's record may speak of: the ones it began with and the ones the tracker has there now (the player aside); and every name the world knows, for the spelling. */
function scenePeople(cur, players) {
    const cast = [];
    const add = (n) => { const c = String(n || '').trim(); if (c && !players.some(p => sameName(p, c)) && !cast.some(x => sameName(x, c))) cast.push(c); };
    for (const n of cur && cur.mark && Array.isArray(cur.mark.cast) ? cur.mark.cast : []) add(n);
    try { for (const n of presentNamesFromTracker()) add(n); } catch (e) { /* no tracker */ }
    const st = getWorldState();
    return { cast, known: [...cast, ...(st && st.known && typeof st.known === 'object' ? Object.keys(st.known) : [])] };
}

/**
 * The End sheet's first step (D122): the recap written for the user to
 * read and edit, and with it where the scene's people stand now and the
 * threads it settled and opened (D188). Waits for the main generation and
 * the background line.
 */
export async function prepareEnd() {
    const g = guardEnd();
    if (!g.ok) return g;
    const idle = await whenIdle();
    if (!idle) return { ok: false, reason: 'busy' };
    // A record the handover wrote and held back for its contradictions (D190) is the one the sheet shows: nothing is asked again.
    if (prepared && prepared.held && prepared.id === chatId() && prepared.reply === lastReplyId() && prepared.result) { prepared.held = false; return prepared.result; }
    const token = { meta: meta(), id: chatId() };
    const players = playerNames();
    // The scene's brief is kept on the mark (D120: it rides the brief slot, the chat has no scenario of its own).
    const brief = g.cur.mark && typeof g.cur.mark.brief === 'string' ? g.cur.mark.brief : '';
    // A scene longer than one page is read in passes, oldest first, each pass carrying the record so far (§5.2).
    const pages = sceneTranscriptPages(chatArray() || [], { budget: RECAP_BUDGET, persona: players[0] || 'Player' });
    // The same request says where the scene's people stand when it ends and which threads it settled and opened (D188):
    // it is told where they stood before and what was open, and a record written in passes carries both from pass to pass.
    const people = scenePeople(g.cur, players);
    await syncFromBook(g.cur.worldId);    // what the player changed in the continuity book is how things stood (D189)
    if (meta() !== token.meta || (chatId() !== undefined && chatId() !== token.id)) return { ok: false, reason: 'changed' };
    let draft = continuityDraft(entryOf(g.cur.worldId).continuity, people.cast);
    // What was established before the scene, for the record to check the scene against (D190): the chat's ledger, the
    // scene's people's own lorebook entries and the campaign's standing notes (the continuity book aside: that is the draft).
    const check = await establishedFor(g.cur.worldId, people.cast, players);
    if (meta() !== token.meta || (chatId() !== undefined && chatId() !== token.id)) return { ok: false, reason: 'changed' };
    let conflicts = [];
    let recap = '';
    let error = '';
    try {
        for (let i = 0; i < Math.max(1, pages.length); i++) {
            const prompt = buildRecapPrompt({ transcript: pages[i] || '', brief, player: players[0] || '', maxChars: cfg().recapChars, soFar: recap, last: i === pages.length - 1, continuity: draft, check });
            const r = await request(prompt, { transport: recapTransport, label: 'recap' });
            if (r.busy) { error = 'Another request holds the line.'; break; }
            const p = parseRecapReply(r.text, { maxChars: cfg().recapChars });
            if (!p.ok) { error = p.errors.join(' '); break; }
            recap = p.recap;
            error = '';
            draft = stepDraft(draft, readContinuity(p.reply, draft, { players, known: people.known, text: pages.slice(0, i + 1).join('\n') }));
            conflicts = mergeConflicts(conflicts, readConflicts(p.reply));
        }
    } catch (e) { error = String(e && e.message || e); }
    if (meta() !== token.meta || (chatId() !== undefined && chatId() !== token.id)) return { ok: false, reason: 'changed' };
    const facts = factsNow();
    const stale = isStaleScene(g.cur.scene, g.entry.memory);
    const canonDone = !!(g.cur.mark.end && g.cur.mark.end.canonAt && g.cur.mark.end.canonAt === lastReplyId());
    const continuity = draftChanges(draft);
    // Kept for an End that has no sheet to hand it back (the command, the handover): this chat's, for this last reply.
    const result = { ok: true, recap, error, scene: g.cur.scene, mark: g.cur.mark, from: g.cur.mark.startDate, to: facts.date, stale, canonDone, steps: { canon: isCanonOn() && !canonDone, world: isLiveWorldOn() && !!getWorldState() }, pages: pages.length, style: isStyleLawOn() ? sceneStyle() : null, continuity, book: continuityBookOf(g.cur.worldId), conflicts, checked: { ledger: !!check.canon, notes: check.lore.map(l => l.name), standing: !!check.standing } };
    prepared = { id: token.id, reply: lastReplyId(), change: { people: continuity.people.map(x => ({ name: x.name, now: x.now })), opened: continuity.opened.map(t => t.text), closed: continuity.closed.map(t => t.id) }, conflicts, result, held: false };
    return result;
}

/**
 * What was established before a scene, for its record to check the scene
 * against (D190): the chat's own ledger as Canon's block, the scene's
 * people's own lorebook entries and the campaign's standing notes (read
 * as a scene's openings read them, D177). Whatever cannot be read is
 * left out; with nothing at all the record is still asked whether the
 * scene contradicts where its people stood.
 */
async function establishedFor(worldId, cast, players) {
    const out = { canon: '', lore: [], standing: '' };
    try { const m = meta(); if (isCanonOn() && m && m.dooms_canon) out.canon = buildCanonBlock(normalizeCanon(m.dooms_canon), { maxChars: 2400 }) || ''; } catch (e) { log('the ledger could not be read for the record', String(e && e.message || e)); }
    try { const notes = await sceneLore(worldId, cast, players); out.lore = notes.lore; out.standing = notes.standing; } catch (e) { log('the lorebooks could not be read for the record', String(e && e.message || e)); }
    return out;
}

/**
 * End (D122): Canon over the scene, the advancer after the scene, the chat
 * flushed, the snapshot taken and sealed, the record and the mark ended,
 * and where the scene's people stand and the threads kept (D188).
 * Each step says how it went; a chat that changes under End stops it
 * before anything of the world is touched.
 */
export async function commitEnd({ recap = '', skipRecap = false, skipCanon = false, skipWorld = false, replaceMemory = false, onStep = null, bans = null, continuity = undefined, conflicts = undefined } = {}) {
    const step = (name, state) => { if (typeof onStep === 'function') { try { onStep(name, state); } catch (e) { /* the sheet's own */ } } };
    if (ending) return { ok: false, reason: 'running' };
    const g = guardEnd();
    if (!g.ok) return g;
    ending = true;
    notify({ source: 'end-start' });
    const token = { meta: meta(), id: chatId() };
    const changed = () => meta() !== token.meta || (chatId() !== undefined && chatId() !== token.id);
    const out = { ok: false, recap: skipRecap || !String(recap || '').trim() ? 'skipped' : 'kept', canon: 'off', world: 'off', snapshot: 'waiting', book: 'off' };
    try {
        const idle = await whenIdle();
        if (!idle) return { ...out, reason: 'busy' };
        const m = token.meta;
        const replyId = lastReplyId();
        // What this End is about to change, for one Undo (D190): the chat's mark and its ledger as they are now; the
        // world's entry and the book follow below, each just before it is written.
        const undo = { worldId: g.cur.worldId, chat: token.id, scene: g.cur.scene ? g.cur.scene.id : g.cur.mark.scene, mark: JSON.parse(JSON.stringify(m[HUB_META_KEY] || g.cur.mark)), hadCanon: 'dooms_canon' in m, canon: m.dooms_canon === undefined ? null : JSON.parse(JSON.stringify(m.dooms_canon)), entry: null, book: null, endedAt: 0 };
        lastEnd = null;
        // Canon over the whole scene, into the chat: the scene's own knowledge, read once per last reply (End again skips a step already run).
        const canonDone = !!(g.cur.mark.end && g.cur.mark.end.canonAt && g.cur.mark.end.canonAt === replyId);
        if (isCanonOn() && !skipCanon && !canonDone) {
            step('canon', 'running');
            let r = await updateCanon({ reason: 'scene-end', scope: 'scene' });
            if (!r.ok && (r.reason === 'busy' || r.reason === 'running')) { await waitForBackground(); await sleep(timing.idleStepMs); r = await updateCanon({ reason: 'scene-end', scope: 'scene' }); }
            out.canon = r.ok ? 'ok' : 'failed';
            out.canonResult = r;
            step('canon', out.canon);
            if (changed()) return { ...out, reason: 'changed' };
            if (r.ok && m && m[HUB_META_KEY]) m[HUB_META_KEY] = { ...m[HUB_META_KEY], end: { canonAt: replyId } };
        } else if (isCanonOn()) out.canon = canonDone ? 'ok' : 'skipped';
        // The flush: the tracker's stores rebuilt from memory and the chat written through the conditional save; then the snapshot, sealed.
        step('snapshot', 'running');
        try { await saveChatData({ immediate: true }); } catch (e) { log('the flush failed', String(e && e.message || e)); return { ...out, reason: 'flush', error: String(e && e.message || e) }; }
        if (changed()) return { ...out, reason: 'changed' };
        const facts = factsNow();
        const now = Date.now();
        const sceneId = g.cur.scene ? g.cur.scene.id : g.cur.mark.scene;
        const players = playerNames();
        let memory = takeSnapshot(m, { scene: sceneId, takenAt: now, player: players[0] || '' });
        await syncFromBook(g.cur.worldId);    // what the player changed in the continuity book since is taken in before anything is written (D189)
        let entry = entryOf(g.cur.worldId);
        undo.entry = JSON.parse(JSON.stringify(entry));
        if (!g.cur.scene) entry = reconcileScenesWithChats(entry, [{ file: token.id || '', meta: m }], g.cur.worldId).entry;    // a record the settings lost: remade from the mark
        const record = entry.scenes.find(x => x.id === sceneId) || null;
        // A stale scene (begun before the memory was last written) keeps the world's memory unless told to replace it (D123).
        const stale = isStaleScene(record, entry.memory);
        const keep = stale && !replaceMemory;
        // The world moves for the scene just ended: over the snapshot's own world state, into the memory, never into the chat (§5.3).
        if (!keep && isLiveWorldOn() && !skipWorld && memory.stores.dooms_world) {
            step('world', 'running');
            const res = await loadPack(g.cur.worldId);
            if (res.ok) {
                const recapText = skipRecap ? '' : String(recap || '').trim();
                const moved = await moveWorldByGap(g.cur.worldId, res.pack, memory, { id: 'scene', words: 'the scene just played' }, [recapText, ...lastRecaps(entry, 1)].filter(Boolean), { mode: 'after', from: g.cur.mark.startDate, to: facts.date });
                if (moved.ok) memory = moved.memory;
                out.world = moved.ok ? 'ok' : 'failed';
                out.worldResult = moved;
            } else out.world = 'failed';
            step('world', out.world);
            if (changed()) return { ...out, reason: 'changed' };
        } else if (isLiveWorldOn() && memory.stores.dooms_world) out.world = keep ? 'kept' : 'skipped';
        const recapText = skipRecap ? '' : String(recap || '').trim();
        // What the record found the scene to contradict (D190) is kept with the scene: as the sheet had it, else as the record said.
        const found = normalizeConflicts(conflicts !== undefined ? conflicts : (prepared && prepared.id === token.id && prepared.reply === replyId ? prepared.conflicts : []));
        const ended = endSceneRecord(entry, sceneId, { endedAt: now, endDate: facts.date, recap: recapText, noRecap: !recapText, conflicts: found });
        if (found.length) out.conflicts = found.length;
        // The style law (D179): the phrases the narrator leaned on in this scene are held against the next ones. The ones
        // chosen on the End sheet; with no sheet (/endscene), the ones the count chose by itself. It is the narrator's
        // habit, not the world's memory, so it is kept whatever becomes of the memory.
        let style = entry.style;
        if (isStyleLawOn()) try {
            const texts = narratorTexts(chatArray() || []);
            const chosen = Array.isArray(bans) ? bans : countStyle(texts, { names: sceneNames() }).phrases.filter(x => x.ticked);
            style = applyStyle(entry.style, { texts, chosen, scene: sceneId });
            out.style = style.bans.length;
        } catch (e) { log('the style law was not updated', String(e && e.message || e)); }
        // Where the scene's people stand now and the threads it settled and opened (D188): as the End sheet has them, else
        // as the record said when it was written for this chat and this last reply. Like the memory, a scene the world
        // has moved past does not overwrite what a later scene left (unless the memory is replaced with it).
        let cont = entry.continuity;
        const change = continuity !== undefined ? continuity : (prepared && prepared.id === token.id && prepared.reply === replyId ? prepared.change : null);
        if (change && !keep) try {
            // A standing the player wrote in the continuity book is not replaced by an End nobody was shown (D189).
            cont = applyContinuity(entry.continuity, change, { scene: sceneId, at: now, keepEdited: continuity === undefined });
            out.continuity = changeCounts(change);
            if (cont.kept && cont.kept.length) { out.continuity.people -= cont.kept.length; out.continuityKept = cont.kept.slice(); }
        } catch (e) { log('the continuity was not updated', String(e && e.message || e)); }
        prepared = null;
        putEntry(g.cur.worldId, { ...ended.entry, memory: keep ? entry.memory : memory, style, continuity: cont }, { source: 'end', world: g.cur.worldId });
        out.snapshot = keep ? 'kept' : 'ok';
        m[HUB_META_KEY] = markEnded(m[HUB_META_KEY] || g.cur.mark, { endedAt: now, endDate: facts.date });
        try { await bridge().saveChat(); } catch (e) { log('the mark could not be saved', String(e && e.message || e)); }
        current = { worldId: g.cur.worldId, mark: m[HUB_META_KEY] };
        step('snapshot', out.snapshot);
        // The continuity book (D189): the world's own lorebook, brought up to what the continuity now says.
        step('book', 'running');
        const mirrored = await mirrorBook(g.cur.worldId);
        out.book = mirrored.state;
        out.bookResult = mirrored;
        step('book', out.book);
        undo.book = mirrored.undo || null;
        undo.endedAt = now;
        lastEnd = undo;
        out.undo = true;
        mountStrip();
        log(`scene ${sceneId} ended and remembered`, { canon: out.canon, world: out.world, snapshot: out.snapshot, stale });
        return { ...out, ok: true, stale, scene: ended.scene, memory: { takenAt: memory.takenAt, facts: memory.facts } };
    } catch (e) {
        const error = String(e && e.message || e);
        log('End failed', error);
        return { ...out, reason: 'error', error };
    } finally {
        ending = false;
        notify({ source: 'end' });
    }
}

/** Prepare and commit in one go (the command path and the tests). */
export async function endScene(opts = {}) {
    const p = await prepareEnd();
    if (!p.ok) return p;
    return commitEnd({ recap: p.recap, ...opts });
}

export function isEnding() {
    return ending;
}

// ─── One Undo of the last End (D190) ────────────────────────────────────

let lastEnd = null;    // what the last End changed, kept until another scene starts, another End runs or the chat changes; never stored

/**
 * Whether the last End can still be put back: its scene's chat is in
 * front, the scene is ended as that End left it, and the world has not
 * gone on to another scene since.
 * @returns {{ ok: boolean, scene?: string, reason?: string }}
 */
export function canUndoEnd() {
    if (!lastEnd || !lastEnd.entry) return { ok: false, reason: 'none' };
    if (ending || continuing) return { ok: false, reason: 'running' };
    if (chatId() !== lastEnd.chat) return { ok: false, reason: 'wrong-chat' };
    const entry = store().worlds[lastEnd.worldId];
    const record = entry ? entry.scenes.find(x => x.id === lastEnd.scene) : null;
    if (!record || record.status !== 'ended' || record.endedAt !== lastEnd.endedAt) return { ok: false, reason: 'moved-on' };
    if (entry.seq !== lastEnd.entry.seq || openSceneOf(entry)) return { ok: false, reason: 'moved-on' };
    return { ok: true, scene: lastEnd.scene };
}

/**
 * The last End put back, all of it (D190): the scene is open again with
 * its mark as it was; the world's entry is as it was before the End (the
 * record, the memory with the world as it stood, where people stand, the
 * threads, the style law); the chat's ledger is as it was before Canon
 * read the scene; and in the continuity book the entries that End made
 * are taken out and the texts it replaced are put back. The chat's
 * messages were never touched by End and are not touched here.
 * @returns {Promise<{ ok: boolean, reason?: string, scene?: string, book?: string, error?: string }>}
 */
export async function undoEnd() {
    const can = canUndoEnd();
    if (!can.ok) return can;
    if (ST.is_send_press === true) return { ok: false, reason: 'busy' };
    const u = lastEnd;
    const m = meta();
    if (!m) return { ok: false, reason: 'wrong-chat' };
    ending = true;
    try {
        // The book first: it is the one thing outside DES's own stores, and the least sure to answer.
        let book = 'off';
        if (u.book && u.book.name) {
            try {
                await bookStep((async () => {
                    const api = books();
                    const data = await api.load(u.book.name);
                    if (!data || !data.entries) throw new Error('the book could not be read');
                    for (const t of u.book.texts) if (data.entries[t.uid]) data.entries[t.uid].content = t.content;
                    for (const uid of u.book.created) { if (typeof api.remove === 'function') await api.remove(u.book.name, data, uid); else delete data.entries[uid]; }
                    await api.save(u.book.name, data);
                })());
                book = 'ok';
            } catch (e) { book = 'failed'; log('the continuity book could not be put back', String(e && e.message || e)); }
        }
        // The world's entry as it was. A book this End made stays (emptied of what End wrote): the world goes on knowing it is its own.
        const before = normalizeWorldEntry(u.entry);
        if (u.book && u.book.made && book === 'ok') before.continuity = trackWritten(before.continuity, u.book.name, []);
        putEntry(u.worldId, before, { source: 'undo-end', world: u.worldId });
        // The chat: the scene's mark and the ledger as they were before End.
        m[HUB_META_KEY] = u.mark;
        if (u.hadCanon) m.dooms_canon = u.canon; else delete m.dooms_canon;
        try { onCanonChatChanged(); } catch (e) { log('the ledger could not be read again', String(e && e.message || e)); }
        try { await bridge().saveChat(); } catch (e) { log('the chat could not be saved after the Undo', String(e && e.message || e)); }
        current = { worldId: u.worldId, mark: m[HUB_META_KEY] };
        lastEnd = null;
        prepared = null;
        mountStrip();
        log(`the End of scene ${u.scene} is undone`, { book });
        return { ok: true, scene: u.scene, book };
    } catch (e) {
        return { ok: false, reason: 'error', error: String(e && e.message || e) };
    } finally {
        ending = false;
        notify({ source: 'undo-end' });
    }
}

// ─── Starting from the Atlas (D174) ─────────────────────────────────────

/**
 * Whether a scene can be started from the chat in front, and in which
 * world (D174): between scenes, in the world of the ended scene in
 * front; in a chat that was taken as a world's beginning, in that world.
 * A scene being played or set aside must be ended first; a chat whose
 * world is not played as scenes has Play as scenes instead.
 * @returns {{ ok: boolean, reason: string, worldId?: string, number?: number, card?: string, scene?: object }}
 */
export function sceneStartPlan() {
    if (!isHubOn()) return { ok: false, reason: 'off' };
    const cur = currentScene();
    let worldId = '';
    if (cur) {
        if (!cur.ended) return { ok: false, reason: 'scene-open', scene: cur.scene };
        worldId = cur.worldId;
    } else {
        const st = getWorldState();
        worldId = st && st.pack ? String(st.pack) : '';
        const e = worldId ? store().worlds[worldId] : null;
        if (!e || !e.memory) return { ok: false, reason: 'not-scenes' };
    }
    const g = guardStart(worldId);
    if (!g.ok) return { ok: false, reason: g.reason, scene: g.scene };
    return { ok: true, reason: '', worldId, number: g.entry.seq + 1, card: g.card.name };
}

/**
 * Whether a scene of a world can be started whatever chat is in front
 * (D194): the Atlas showing a world that was picked, not the chat's.
 * @returns {{ ok: boolean, reason: string, worldId?: string, number?: number, card?: string, scene?: object }}
 */
export function startPlanFor(worldId) {
    const g = guardStart(worldId);
    if (!g.ok) return { ok: false, reason: g.reason, scene: g.scene };
    return { ok: true, reason: '', worldId: g.id, number: g.entry.seq + 1, card: g.card.name };
}

// ─── The world's map (D172, D173) ───────────────────────────────────────

/**
 * What the Atlas should show for the chat in front (D173). A scene that
 * has ended is a chat the world has moved on from: End moves the world in
 * the memory, and later scenes change it further, so the Atlas reads the
 * world's memory there, not the chat. Any other chat (a long chat, a
 * scene still being played, one set aside) is read as it is.
 * @returns {{ kind: 'chat' } | { kind: 'world', worldId: string, scene: string, open: object|null, memory: object }}
 *   `open` is the world's open scene's record when there is one (its chat holds the live map), else null
 */
export function atlasSource() {
    const cur = currentScene();
    if (!cur || !cur.ended) return { kind: 'chat' };
    const entry = store().worlds[cur.worldId];
    if (!entry || !entry.memory) return { kind: 'chat' };
    const open = openSceneOf(entry);
    return { kind: 'world', worldId: cur.worldId, scene: cur.mark.scene, open: open && !open.gone ? JSON.parse(JSON.stringify(open)) : null, memory: JSON.parse(JSON.stringify(entry.memory)) };
}

/**
 * A world as the Atlas shows it when it is picked there (D194), whatever
 * chat is in front: its memory, as between scenes; before its first scene
 * has ended, the pack's own beginning (nothing is written by the look).
 * @returns {null | { kind: 'world', worldId: string, scene: string, picked: true, open: object|null, memory: object }}  null when the hub has no such world
 */
export function worldSource(worldId, pack) {
    const id = String(worldId || '').trim();
    const entry = id ? store().worlds[id] : null;
    if (!entry || !pack) return null;
    const open = openSceneOf(entry);
    return { kind: 'world', worldId: id, scene: '', picked: true, open: open && !open.gone ? JSON.parse(JSON.stringify(open)) : null, memory: JSON.parse(JSON.stringify(memoryFor(entry, pack, id))) };
}

/**
 * The world's own copy of the map replaced (D173): the Atlas edited
 * between scenes. Refused while a scene is open: that scene's chat holds
 * the live map and its End would write over this one. The memory's date
 * is not moved, so no scene becomes stale by it. A world no scene has
 * ended in has no memory yet: given its `pack`, one is begun from the
 * pack's seed to hold the map (D194), as a round of hooks begins one; it
 * is not one an End wrote (takenAt 0), so the first scene starts as ever.
 */
export function setWorldBook(worldId, book, { pack = null } = {}) {
    const id = String(worldId || '').trim();
    const entry = id ? store().worlds[id] : null;
    if (!entry) return { ok: false, reason: 'no-memory' };
    const has = !!(entry.memory && entry.memory.stores && entry.memory.stores.dooms_world);
    if (!has && !pack) return { ok: false, reason: 'no-memory' };
    const open = openSceneOf(entry);
    if (open && !open.gone) return { ok: false, reason: 'scene-open', scene: JSON.parse(JSON.stringify(open)) };
    const memory = has ? entry.memory : memoryFor(entry, pack, id);
    putEntry(id, normalizeWorldEntry({ ...entry, memory: { ...memory, stores: { ...memory.stores, dooms_atlas: normalizeBook(book) } } }), { source: 'map', world: id });
    return { ok: true, reason: '' };
}

/**
 * A map edit made in the scene being played is the world's at once
 * (D173): the chat's book is copied into the world's memory, so a scene
 * left without an End loses no map work. Only for the world's open scene,
 * and not for one the memory has already moved past (its End keeps the
 * newer memory, D123). False when nothing was carried.
 */
export function carrySceneBook(book) {
    const cur = currentScene();
    if (!cur || cur.ended || !cur.scene || cur.scene.status !== 'open') return false;
    const entry = store().worlds[cur.worldId];
    if (!entry || !entry.memory || isStaleScene(cur.scene, entry.memory)) return false;
    putEntry(cur.worldId, { ...entry, memory: { ...entry.memory, stores: { ...entry.memory.stores, dooms_atlas: normalizeBook(book) } } }, { source: 'map', world: cur.worldId });
    return true;
}

// ─── A chat taken as where a world's scenes begin (D131, D172) ──────────

const ADOPT_MESSAGES = 40;    // how far back the record of the chat so far reads
let adopting = false;

export function isAdopting() {
    return adopting;
}

/** The Lore Library campaign that is switched on, or null (plain data: the lorebook cluster is not loaded for it). */
function activeCampaign() {
    const lb = extensionSettings.lorebook;
    const id = lb && typeof lb.activeCampaignId === 'string' ? lb.activeCampaignId : '';
    const c = id && lb.campaigns && typeof lb.campaigns === 'object' ? lb.campaigns[id] : null;
    return c && typeof c === 'object' ? { id, name: String(c.name || '').trim() } : null;
}

/** The character the chat in front is with: its index, avatar and name; null in a group or with none. */
function chatCard() {
    const b = bridge();
    if (b.groupId()) return null;
    const i = b.characterId();
    const list = b.characters();
    const c = i !== undefined && i !== null && list[Number(i)] ? list[Number(i)] : null;
    return c && c.avatar ? { index: Number(i), avatar: String(c.avatar), name: String(c.name || '') } : null;
}

/**
 * What playing the chat in front as scenes would do (D172), nothing
 * changed: the world it would be (the chat's own when it has one of the
 * player's; else the one the active campaign already has; else a new one
 * named after the campaign, or after the chat's world when no campaign is
 * on), the card that narrates it, and whether a memory would be replaced.
 * @returns {{ ok: boolean, reason: string, world?: { id: string, name: string, made: boolean }, campaign?: { id: string, name: string }|null, card?: { avatar: string, name: string }, replaces?: boolean, scenes?: number, boundTo?: string }}
 */
export function scenesPlan() {
    if (!isHubOn()) return { ok: false, reason: 'off' };
    if (chatId() === undefined || !meta()) return { ok: false, reason: 'no-chat' };
    if (bridge().groupId()) return { ok: false, reason: 'group' };
    if (currentScene()) return { ok: false, reason: 'scene' };
    const state = getWorldState();
    if (!state) return { ok: false, reason: 'no-world' };
    const card = chatCard();
    if (!card) return { ok: false, reason: 'no-card' };
    const campaign = activeCampaign();
    const packs = liveWorldConfig(extensionSettings).customPacks || {};
    const mine = (id) => !!id && id !== BLANK_PACK_ID && Object.prototype.hasOwnProperty.call(packs, id);
    const worlds = store().worlds;
    const pack = getActivePack();
    let world;
    if (mine(state.pack)) world = { id: state.pack, name: (pack && pack.name) || state.pack, made: false };
    else {
        const had = campaign ? Object.keys(worlds).find(id => worlds[id].campaign === campaign.id && mine(id)) : '';
        if (had) {
            let name = had;
            try { const raw = typeof packs[had] === 'string' ? JSON.parse(packs[had]) : packs[had]; if (raw && raw.name) name = String(raw.name); } catch (e) { /* its id stands */ }
            world = { id: had, name, made: false };
        } else {
            const name = (campaign && campaign.name) || state.name || (pack && pack.name) || 'The world';
            const base = normalizePack({ id: name, name }).pack.id || 'world';
            const taken = (id) => id === BLANK_PACK_ID || Object.prototype.hasOwnProperty.call(packs, id) || Object.prototype.hasOwnProperty.call(worlds, id);
            let id = base;
            for (let n = 2; taken(id) && n < 500; n++) id = `${base}-${n}`;
            world = { id, name, made: true };
        }
    }
    const entry = worlds[world.id] || null;
    // One card, one world (D114): a world that has its narrator keeps it; else the chat's card is the narrator, unless it narrates another world.
    const bound = entry && entry.card ? cardOf(world.id) : null;
    const other = bound ? '' : worldOfCard(card.avatar);
    if (other && other !== world.id) return { ok: false, reason: 'bound-elsewhere', boundTo: other, world, campaign, card: { avatar: card.avatar, name: card.name } };
    const narrator = bound ? { avatar: bound.avatar, name: bound.name } : { avatar: card.avatar, name: card.name };
    return { ok: true, reason: '', world, campaign, card: narrator, replaces: !!(entry && entry.memory && entry.memory.takenAt), scenes: entry ? entry.scenes.filter(x => x.id !== ADOPTED_ID).length : 0 };
}

/**
 * The first half of playing a chat as scenes: the record of the chat so
 * far, written by one background request over its last messages (as many
 * of the last forty as one page holds), for the player to read and edit.
 * Nothing is changed. Waits for the main generation and the background line.
 */
export async function prepareAdopt() {
    const plan = scenesPlan();
    if (!plan.ok) return plan;
    const idle = await whenIdle();
    if (!idle) return { ok: false, reason: 'busy' };
    const token = { meta: meta(), id: chatId() };
    const players = playerNames();
    const pages = sceneTranscriptPages((chatArray() || []).slice(-ADOPT_MESSAGES), { budget: RECAP_BUDGET, persona: players[0] || 'Player' });
    let recap = '';
    let error = '';
    // The same request says where the people of the chat stand now and what it has left open (D188): the world's first continuity.
    const people = scenePeople(null, players);
    const before = plan.world && !plan.world.made ? entryOf(plan.world.id).continuity : null;    // taken again: what the scenes since have said stands until this says otherwise
    let draft = continuityDraft(before, people.cast);
    if (pages.length) {
        try {
            const prompt = buildRecapPrompt({ transcript: pages[pages.length - 1], brief: '', player: players[0] || '', maxChars: cfg().recapChars, soFar: '', last: true, continuity: draft });
            const r = await request(prompt, { transport: recapTransport, label: 'recap' });
            if (r.busy) error = 'Another request holds the line.';
            else {
                const p = parseRecapReply(r.text, { maxChars: cfg().recapChars });
                if (p.ok) { recap = p.recap; draft = stepDraft(draft, readContinuity(p.reply, draft, { players, known: people.known, text: pages[pages.length - 1] })); } else error = p.errors.join(' ');
            }
        } catch (e) { error = String(e && e.message || e); }
    }
    if (meta() !== token.meta || (chatId() !== undefined && chatId() !== token.id)) return { ok: false, reason: 'changed' };
    return { ok: true, reason: '', plan: scenesPlan(), recap, error, messages: (chatArray() || []).length, continuity: draftChanges(draft) };
}

/**
 * A copy of the chat in front, written beside it under its card before
 * anything is changed (D175): its metadata and every message as they
 * stand, under the chat's own name with "before scenes" after it. An
 * ordinary chat, to open if the scenes are not wanted after all.
 * @returns {Promise<{ ok: boolean, file: string, error: string }>}
 */
async function backupChat(card) {
    try {
        const list = chatArray();
        const m = meta();
        const id = chatId();
        if (!card || !card.avatar || !list || !m || id === undefined) return { ok: false, file: '', error: 'There is no chat to copy.' };
        const b = bridge();
        const existing = (await b.listChats(card.avatar)).map(c => String(c.file_name || c.file_id || ''));
        const file = backupFileName(id, existing);
        const header = { chat_metadata: JSON.parse(JSON.stringify(m)), user_name: 'unused', character_name: 'unused' };
        await b.saveChatFile({ chName: card.name, avatar: card.avatar, fileName: file, header, messages: JSON.parse(JSON.stringify(list)) });
        return { ok: true, file, error: '' };
    } catch (e) {
        return { ok: false, file: '', error: String(e && e.message || e) };
    }
}

/**
 * The chat in front becomes where a world's scenes begin (D131, D172).
 * The world is made when the chat has none of the player's (an empty one
 * under the campaign's name: the places the story named stay the story's,
 * so the map made of them stands), the chat is carried over to it, the
 * chat's card narrates it, the chat's stores as they stand are the world's
 * memory, sealed, and the chat is kept as scene 0 with its record. The
 * chat itself stays an ordinary chat and can go on being played; taken
 * again, the memory is replaced (`replace` says the player knows). Before
 * any of it a copy of the chat is written beside it (D175); when the copy
 * cannot be written, nothing is changed.
 * @returns {Promise<{ ok: boolean, reason: string, worldId?: string, worldName?: string, made?: boolean, card?: string, replaced?: boolean, recap?: string, backup?: string }>}
 */
export async function commitAdopt({ recap = '', replace = false, continuity = null } = {}) {
    if (adopting) return { ok: false, reason: 'running' };
    const plan = scenesPlan();
    if (!plan.ok) return plan;
    if (plan.replaces && !replace) return { ok: false, reason: 'has-memory', world: plan.world, scenes: plan.scenes };
    if (ST.is_send_press === true) return { ok: false, reason: 'busy' };
    adopting = true;
    try {
        const token = { meta: meta(), id: chatId() };
        const worldId = plan.world.id;
        // The copy first: the chat as it stands before its world is changed under it.
        await flushChat();
        const kept = await backupChat(chatCard());
        if (!kept.ok) return { ok: false, reason: 'backup', errors: [kept.error] };
        if (meta() !== token.meta || (chatId() !== undefined && chatId() !== token.id)) return { ok: false, reason: 'changed' };
        if (plan.world.made) {
            const saved = await saveWorld({ id: worldId, name: plan.world.name, version: 1, description: '', places: [], clocks: [], cast: [], blurb: '' });
            if (!saved.ok) return { ok: false, reason: 'world', errors: saved.errors };
        }
        const state = getWorldState();
        if (!state) return { ok: false, reason: 'no-world' };
        if (state.pack !== worldId) {
            const moved = await adoptWorld(worldId, { ownName: true });
            if (!moved.ok) return { ok: false, reason: 'world', errors: [moved.error || 'The chat could not be carried over to the world.'] };
        }
        if (meta() !== token.meta || (chatId() !== undefined && chatId() !== token.id)) return { ok: false, reason: 'changed' };
        await flushChat();
        const m = meta();
        if (!m || m !== token.meta) return { ok: false, reason: 'changed' };
        const now = Date.now();
        const players = playerNames();
        const memory = takeSnapshot(m, { scene: ADOPTED_ID, takenAt: now, player: players[0] || '' });
        const facts = factsNow();
        const card = chatCard();
        const base = { ...entryOf(worldId) };
        if (!base.card || !cardOf(worldId)) base.card = plan.card.avatar;    // none yet, or the one it had is gone
        if (plan.campaign) base.campaign = plan.campaign.id;
        const r = adoptScene({ ...base, memory }, { chat: String(chatId() || ''), card: card ? card.avatar : '', recap, place: { label: facts.location || '' }, endDate: facts.date || '', endedAt: now });
        // Where the chat's people stand now and what it has left open (D188), as the panel has them.
        const cont = continuity ? applyContinuity(r.entry.continuity, continuity, { scene: ADOPTED_ID, at: now }) : r.entry.continuity;
        putEntry(worldId, { ...r.entry, continuity: cont }, { source: 'adopt', world: worldId });
        const mirrored = await mirrorBook(worldId);    // the world's continuity book, made with its first continuity (D189)
        log(`${worldId} is played as scenes from "${chatId()}"`, { made: plan.world.made, replaced: plan.replaces, campaign: plan.campaign ? plan.campaign.id : '', backup: kept.file });
        return { ok: true, reason: '', worldId, worldName: plan.world.name, made: plan.world.made, card: plan.card.name, replaced: plan.replaces, recap: r.scene.recap, backup: kept.file, continuity: continuity ? changeCounts(continuity) : null, book: mirrored.state === 'ok' ? mirrored.name : '' };
    } catch (e) {
        return { ok: false, reason: 'error', errors: [String(e && e.message || e)] };
    } finally {
        adopting = false;
    }
}

// ─── Going straight on in a fresh chat (D181) ───────────────────────────

let continuing = false;

export function isContinuing() {
    return continuing;
}

/** How long the scene in front has run and whether it is long enough to go on in a fresh chat; null when the chat is no scene. */
export function sceneLengthNow() {
    const cur = currentScene();
    if (!cur) return null;
    const count = sceneLength(chatArray() || []);
    return { count, nudgeAt: cfg().nudgeAt, long: !cur.ended && sceneIsLong(count, cfg().nudgeAt), ended: cur.ended };
}

/** Where the scene in front stands now, for the one that goes straight on from it: its world, the place the story is at, who is there, and the words it stopped on. */
function continuationOf(cur) {
    const players = playerNames();
    const at = factsNow().location || (cur.mark.place && cur.mark.place.label) || '';
    const began = cur.mark.place || {};
    const place = began.label && sameName(at, began.label) ? { id: began.id || '', label: began.label } : { label: at };
    let cast = [];
    try { cast = presentNamesFromTracker(); } catch (e) { cast = []; }
    if (!cast.length) cast = Array.isArray(cur.mark.cast) ? cur.mark.cast : [];
    cast = cast.filter(n => n && !players.some(p => sameName(p, n)));
    return { worldId: cur.worldId, sceneId: cur.mark.scene, title: cur.mark.title || '', place, cast, seedText: continuationSeed(chatArray() || []) };
}

/**
 * The scene in front ended and the next one opened straight on from it,
 * in one go (D181): the same place, the same people, no time passed. The
 * point of it is a fresh chat without a break in the story: the record
 * is written, the scene remembered (the ledger read, the world not moved:
 * no time passes), and the next scene's first opening is taken as it
 * comes; the other two are its swipes. A scene that has ended already is
 * only gone on from. It stops, with nothing more changed, when the record
 * cannot be written (the End sheet is the way then), when the world has
 * moved past the scene, or when no opening comes back (the scene is
 * ended; the next is started from the map).
 * @param {object} o
 * @param {Function} o.onStep   told what is being done, in words
 * @returns {Promise<{ ok: boolean, reason: string, stage: 'end'|'start', scene?: object, file?: string, error?: string }>}
 */
export async function continueScene({ onStep = null } = {}) {
    const say = (word) => { if (typeof onStep === 'function') { try { onStep(word); } catch (e) { /* the caller's own */ } } };
    if (continuing) return { ok: false, reason: 'running', stage: 'end' };
    const cur = currentScene();
    if (!cur) return { ok: false, reason: 'not-scene', stage: 'end' };
    continuing = true;
    try {
        const next = continuationOf(cur);    // read while the scene's chat is in front and its tracker is the live one
        if (!cur.ended) {
            say('Writing the record of the scene…');
            const p = await prepareEnd();
            if (!p.ok) return { ok: false, reason: p.reason, stage: 'end' };
            if (p.stale) return { ok: false, reason: 'stale', stage: 'end' };
            if (p.error || !p.recap) return { ok: false, reason: 'no-recap', stage: 'end', error: p.error || '' };
            // What the scene contradicts is the player's to see before it is kept (D190): the handover stops, and the End
            // sheet shows the record it wrote (the same one: nothing is asked again).
            if (p.conflicts && p.conflicts.length) { if (prepared) prepared.held = true; return { ok: false, reason: 'conflicts', stage: 'end', conflicts: p.conflicts.length }; }
            say('Remembering the scene…');
            const e = await commitEnd({ recap: p.recap, skipWorld: true });
            if (!e.ok) return { ok: false, reason: e.reason, stage: 'end' };
        }
        say('Writing how the next scene opens…');
        const p2 = await prepareScene({ worldId: next.worldId, seed: { kind: 'scene', id: next.sceneId, label: next.title, text: next.seedText }, place: next.place, cast: next.cast, gap: { id: 'now' } });
        if (!p2.ok) return { ok: false, reason: p2.reason, stage: 'start' };
        if (!p2.openers.length) { cancelStart(); return { ok: false, reason: 'openers', stage: 'start', error: (p2.errors || []).join(' ') }; }
        say('Opening the next scene…');
        const r = await commitScene(p2.token, { choice: 0 });
        if (!r.ok) return { ok: false, reason: r.reason, stage: 'start' };
        return { ok: true, reason: '', stage: 'start', scene: r.scene, file: r.file };
    } catch (e) {
        return { ok: false, reason: 'error', stage: 'end', error: String(e && e.message || e) };
    } finally {
        continuing = false;
    }
}

/** Why a handover stopped, in words for the strip. */
function continueRefusal(r) {
    if (r.stage === 'start') return r.reason === 'openers' ? 'The scene is ended, but no opening came back for the next. Open the Atlas and start it from the map.' : `The scene is ended, but the next could not be opened (${describeStartWord(r)}). Open the Atlas and start it from the map.`;
    if (r.reason === 'no-recap') return 'The record of the scene could not be written. Use End scene to write it yourself.';
    if (r.reason === 'conflicts') return `The record found ${r.conflicts === 1 ? 'one thing' : `${r.conflicts} things`} in this scene that ${r.conflicts === 1 ? 'contradicts' : 'contradict'} what was established. End scene shows ${r.conflicts === 1 ? 'it' : 'them'}, with the record already written.`;
    if (r.reason === 'stale') return 'A later scene has ended since this one began. Use End scene to choose what is kept.';
    if (r.reason === 'busy') return 'A reply is still being written. Try again when it is done.';
    if (r.reason === 'running') return 'This is already being done.';
    return `The scene could not be ended (${r.reason || 'unknown'}). Use End scene.`;
}
const describeStartWord = (r) => (r.reason === 'scene-open' ? 'another scene is open' : r.reason === 'busy' ? 'another request is running' : r.reason === 'card-gone' ? 'the narrator card is gone' : r.reason || 'unknown');

/** The strip's own way of going on (D181): the handover run with its steps shown on the strip; when it stops, the strip says why. */
async function continueFromStrip() {
    if (continuing) return;
    stripNote = '';
    stripBusy = 'Going on in a fresh chat…';
    mountStrip();
    const r = await continueScene({ onStep: (word) => { stripBusy = word; mountStrip(); } });
    stripBusy = '';
    stripNote = r.ok ? '' : continueRefusal(r);
    mountStrip();
    // The record could not be written, or the world has moved past the scene: the End sheet is where that is settled.
    if (!r.ok && r.stage === 'end' && (r.reason === 'no-recap' || r.reason === 'stale')) {
        try { const m = await import('../ui/atlas.js'); await m.openAtlasEnd(); } catch (e) { log('the End sheet could not be opened', String(e && e.message || e)); }
    }
}

// ─── The scene chat's own events ────────────────────────────────────────

const OPENER = (m) => !!(m && !m.is_user && m.extra && m.extra[HUB_META_KEY] && m.extra[HUB_META_KEY].opener);

/** The header's seeded tracker data, the four fields. */
function seededTracker() {
    const m = meta();
    const t = m && m.dooms_tracker;
    const d = t && (t.lastGeneratedData || t.committedTrackerData);
    if (!d || typeof d !== 'object') return null;
    return { quests: d.quests || null, infoBox: d.infoBox || null, characterThoughts: d.characterThoughts || null, player: d.player || null };
}

/**
 * MESSAGE_RECEIVED, after the tracker's own handler: the first-message
 * event runs the tracker's parse over the opener (no block, all four
 * fields null) and overwrites its swipe entry; the seed is put back on
 * every swipe, and the singletons hold it.
 */
export function onHubMessageReceived(messageId, type) {
    if (!extensionSettings.enabled) return;
    try { mountStrip(); } catch (e) { /* no DOM */ }    // the scene is a reply longer: its count, and the nudge when it is due (D181)
    const list = chatArray();
    const m = list && list.length ? list[list.length - 1] : null;
    if (!OPENER(m) || (type !== 'first_message' && list.length > 1)) return;
    if (!currentScene()) return;
    const seed = seededTracker();
    if (!seed) return;
    const n = Array.isArray(m.swipes) && m.swipes.length ? m.swipes.length : 1;
    if (!m.extra) m.extra = {};
    m.extra.dooms_tracker_swipes = {};
    for (let k = 0; k < n; k++) m.extra.dooms_tracker_swipes[k] = JSON.parse(JSON.stringify(seed));
    if (Array.isArray(m.swipe_info)) m.swipe_info.forEach((si, k) => { if (si && typeof si === 'object') { si.extra = si.extra && typeof si.extra === 'object' ? si.extra : {}; si.extra.dooms_tracker_swipes = { [k]: JSON.parse(JSON.stringify(seed)) }; } });
    setLastGeneratedData({ ...lastGeneratedData, ...seed });
    setCommittedTrackerData({ ...committedTrackerData, ...seed });
    try { saveChatData({ immediate: true }); } catch (e) { /* saved later */ }
}

/**
 * MESSAGE_DELETED, after the tracker's own handler: a scene whose opener
 * is deleted has no reply left, and the tracker nulled both stores; the
 * header's seed comes back, so the first reply still knows the scene.
 */
export function onHubMessageDeleted() {
    if (!extensionSettings.enabled || !currentScene()) return;
    try { mountStrip(); } catch (e) { /* no DOM */ }
    const list = chatArray() || [];
    if (list.some(x => x && !x.is_user && !x.is_system)) return;
    const seed = seededTracker();
    if (!seed) return;
    setLastGeneratedData({ ...lastGeneratedData, ...seed });
    setCommittedTrackerData({ ...committedTrackerData, ...seed });
    try { renderInfoBox(); } catch (e) { /* no DOM */ }
    try { renderThoughts(); } catch (e) { /* no DOM */ }
    try { renderQuests(); } catch (e) { /* no DOM */ }
    try { saveChatData({ immediate: true }); } catch (e) { /* saved later */ }
}

/**
 * GENERATION_STARTED, after the tracker's injector: at a scene's first
 * send the chat holds the opener alone and the injector finds no reply at
 * depth one or more, so the committed block (the seeded cast, place, date,
 * vitals) would not be shown; the hub sets the example slot itself.
 */
function setBriefSlot(text) {
    try { setExtensionPrompt(BRIEF_SLOT, text ? `\n${text}\n` : '', extension_prompt_types.IN_CHAT, 2, false, extension_prompt_roles.SYSTEM); } catch (e) { /* no ST */ }
}

export function onHubGenerationStarted(type, data, dryRun) {
    if (dryRun) return;
    const quiet = type === 'quiet' || type === 'impersonate' || !!(data && (data.quiet_prompt || data.quietImage || data.quiet_image));
    const cur = extensionSettings.enabled ? currentScene() : null;
    // The brief (D120): the mark's, while the chat is a scene and the generation is a real one.
    setBriefSlot(cur && !quiet && cur.mark.brief ? cur.mark.brief : '');
    if (!cur || quiet || extensionSettings.generationMode !== 'together') return;
    const list = chatArray();
    if (!list || list.length !== 1 || !OPENER(list[0])) return;
    let raw = '';
    try { raw = generateTrackerExample(); } catch (e) { raw = ''; }
    if (!raw) return;
    try { setExtensionPrompt('dooms-tracker-example', `\`\`\`json\n${raw}\n\`\`\`\n`, extension_prompt_types.IN_CHAT, 1, false, extension_prompt_roles.ASSISTANT); } catch (e) { log('the first reply\'s example could not be set', String(e && e.message || e)); }
}

// ─── The records' moves (D123) ──────────────────────────────────────────

export function setSceneAside(worldId, id) {
    const e = store().worlds[String(worldId || '')];
    if (!e) return false;
    const r = setAsidePure(e, id);
    if (!r.scene) return false;
    putEntry(String(worldId), r.entry, { source: 'aside', world: String(worldId) });
    return true;
}

/** Opens a scene's chat on its card (Resume, Open the chat). */
export async function openSceneChat(worldId, id) {
    const e = store().worlds[String(worldId || '')];
    const s = e ? e.scenes.find(x => x.id === id) : null;
    if (!s || !s.chat || s.gone) return { ok: false, reason: 'chat-gone' };
    const card = cardOf(worldId);
    if (!card) return { ok: false, reason: 'card-gone' };
    const b = bridge();
    if (ST.is_send_press === true) return { ok: false, reason: 'busy' };
    if (!(await flushChat())) log('the chat in front could not be flushed before the switch; its last edits may be lost');
    try {
        await b.unshallowCharacter(card.index);
        const cards = b.characters();
        if (cards[card.index]) cards[card.index].chat = s.chat;
        if (String(b.characterId()) !== String(card.index) || b.groupId()) {
            await b.selectCharacterById(card.index);
            if (String(b.characterId()) !== String(card.index) || b.groupId()) throw new Error('the narrator card could not be selected (a generation running?)');
        }
        await b.openCharacterChat(s.chat);
        return { ok: true };
    } catch (e) {
        return { ok: false, reason: 'open', error: String(e && e.message || e) };
    }
}

/** Resume (D123): the scene open again (any other open one aside) and its chat in front. */
export async function resumeScene(worldId, id) {
    const e = store().worlds[String(worldId || '')];
    if (!e) return { ok: false, reason: 'no-world' };
    const r = resumePure(e, id);
    if (!r.scene || r.scene.status !== 'open') return { ok: false, reason: 'chat-gone' };
    putEntry(String(worldId), r.entry, { source: 'resume', world: String(worldId) });
    return openSceneChat(worldId, id);
}

/** Reopen (D122): the ended scene in front is open again; its mark follows. */
export async function reopenCurrentScene() {
    const cur = currentScene();
    if (!cur || !cur.scene) return { ok: false, reason: 'not-scene' };
    const e = store().worlds[cur.worldId];
    const r = reopenPure(e, cur.scene.id);
    if (!r.scene || r.scene.status !== 'open') return { ok: false, reason: 'not-open' };
    putEntry(cur.worldId, r.entry, { source: 'reopen', world: cur.worldId });
    const m = meta();
    if (m) { m[HUB_META_KEY] = markEnded(cur.mark, { endedAt: 0, endDate: '' }); try { await bridge().saveChat(); } catch (err) { /* saved later */ } }
    current = { worldId: cur.worldId, mark: m ? m[HUB_META_KEY] : cur.mark };
    mountStrip();
    notify({ source: 'reopen' });
    return { ok: true, scene: r.scene };
}

/** A record whose chat is gone, removed (nothing else leaves the list). */
export function removeGoneScene(worldId, id) {
    const e = store().worlds[String(worldId || '')];
    if (!e) return false;
    const r = removeGonePure(e, id);
    if (!r.removed) return false;
    putEntry(String(worldId), r.entry, { source: 'remove', world: String(worldId) });
    return true;
}

// ─── The strip (D121) ───────────────────────────────────────────────────

/**
 * The strip across the top of the chat column while the chat in front is
 * a scene: mounted before #chat, its view loaded with the window's views
 * on first need (the plain chat pays nothing). Nothing is mounted where
 * there is no chat column.
 */
function mountStrip() {
    let chatEl = null;
    try { chatEl = typeof document !== 'undefined' && document && typeof document.getElementById === 'function' ? document.getElementById('chat') : null; } catch (e) { chatEl = null; }
    if (!chatEl || typeof chatEl.insertAdjacentHTML !== 'function') return;
    const cur = extensionSettings.enabled ? currentScene() : null;
    const existing = document.getElementById(STRIP_DOM_ID);
    if (!cur) { if (existing && typeof existing.remove === 'function') existing.remove(); return; }
    const token = ++stripToken;
    Promise.all([ensureCss('modals').catch(() => {}), import('../ui/atlasViews.js')]).then(([, v]) => {
        if (token !== stripToken) return;
        const again = currentScene();
        if (!again) return;
        const count = sceneLength(chatArray() || []);
        const long = !again.ended && sceneIsLong(count, cfg().nudgeAt);    // the scene has run long enough that a fresh chat is worth it (D181)
        const html = v.atlasStripHtml({ mark: again.mark, scene: again.scene, ended: again.ended, count, long, busy: stripBusy, note: stripNote });    // the Atlas is the scenes' window (D176)
        let el = document.getElementById(STRIP_DOM_ID);
        if (!el) {
            chatEl.insertAdjacentHTML('beforebegin', `<div id="${STRIP_DOM_ID}" class="dooms-scene-strip" role="region" aria-label="This scene"></div>`);
            el = document.getElementById(STRIP_DOM_ID);
        }
        if (el) { el.innerHTML = html; if (el.classList && typeof el.classList.toggle === 'function') { el.classList.toggle('is-long', long); el.classList.toggle('is-busy', !!stripBusy); } }
    }).catch(e => log('the strip could not be shown', String(e && e.message || e)));
}

const STRIP_DOM_ID = 'dooms-scene-strip';
let stripBusy = '';    // what a handover is doing, shown on the strip in place of its text
let stripNote = '';    // why the last handover stopped, shown on the strip until the chat changes or another is tried
let stripToken = 0;

/** The records against the card's chats (D128): gone files marked, marked chats the list lost brought back. */
export async function refreshScenes(worldId) {
    const id = String(worldId || '');
    const e = store().worlds[id];
    const card = cardOf(id);
    if (!e || !card) return { ok: false, reason: card ? 'no-world' : 'card-gone' };
    try {
        const chats = await bridge().listChats(card.avatar, { metadata: true });
        const r = reconcileScenesWithChats(e, chats.map(c => ({ file: c.file_name || c.file_id || '', meta: c.chat_metadata || null })), id, { card: card.avatar });
        if (r.changed) putEntry(id, r.entry, { source: 'refresh', world: id });
        return { ok: true, changed: r.changed, scenes: JSON.parse(JSON.stringify(r.entry.scenes)) };
    } catch (err) {
        return { ok: false, reason: 'error', error: String(err && err.message || err) };
    }
}

/** One line per world for Settings and /hub. */
export async function hubStatusLines() {
    const out = [];
    for (const id of hubWorldIds()) {
        const res = await loadPack(id);
        const card = cardOf(id);
        out.push({ id, name: res.ok ? res.pack.name : id, card: card ? card.avatar : '', cardName: card ? card.name : '', line: hubStatusLine({ worldName: res.ok ? res.pack.name : id, entry: store().worlds[id] || null, cardName: card ? card.name : '' }) });
    }
    return out;
}

// ─── Init ───────────────────────────────────────────────────────────────

/** Registers /hub and /endscene. The events are wired by index.js. */
export function initHub() {
    try {
        SlashCommandParser.addCommandObject(SlashCommand.fromProps({
            name: 'hub',
            callback: async () => {
                try { const m = await import('../ui/atlas.js'); await m.openAtlas({ tab: 'scenes' }); return ''; } catch (e) { log('the Atlas failed to load', String(e && e.message || e)); }
                const lines = await hubStatusLines();
                return lines.length ? lines.map(l => l.line).join('\n') : 'No world of your own yet: build one in the World Builder, then pick its narrator card in Settings → Live World → The Hub.';
            },
            helpString: 'Scenes: opens the Atlas on the world\'s scenes (Settings → Live World → The Hub).',
        }));
        SlashCommandParser.addCommandObject(SlashCommand.fromProps({
            name: 'endscene',
            callback: async () => describeEndResult(await endScene()),
            helpString: 'The Hub: ends this scene and remembers it (the recap, the ledger, the world, the snapshot).',
        }));
    } catch (e) {
        log('the hub commands could not be registered', String(e && e.message || e));
    }
    // The strip's buttons: the window, the End sheet, Reopen (the window's module loads on first use).
    try {
        $(document).on('click', `#${STRIP_DOM_ID} [data-act]`, async function (ev) {
            const act = this.getAttribute('data-act');
            ev.preventDefault();
            if (act === 'reopen') { const r = await reopenCurrentScene(); if (!r.ok) log('reopen refused', r.reason); return; }
            if (act === 'continue') { await continueFromStrip(); return; }
            const m = await import('../ui/atlas.js');
            if (act === 'end') await m.openAtlasEnd();
            else await m.openAtlas();
        });
    } catch (e) { /* no jQuery (tests) */ }
}
