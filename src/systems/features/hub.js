/**
 * The Hub (docs/hub-plan.md D113–D133): a world played as many small
 * chats. The store under extensionSettings.hub (a narrator card, a sealed
 * snapshot and the scene records per world), the chat bridge (every
 * SillyTavern call behind one object, read from the context at call time
 * so an older build fails softly and the sandbox stubs one object), the
 * requests (the gap run, the openers, the recap), Start (the file written
 * whole, then opened), End (the recap, Canon over the scene, the advancer,
 * the snapshot), the scene records' moves, /hub and /endscene. The pure
 * parts are src/utils/hub.js; the window is src/systems/ui/hub.js.
 */
import { getContext } from '../../../../../../extensions.js';
import { chat, chat_metadata, getRequestHeaders, saveChatConditional } from '../../../../../../../script.js';
import * as ST from '../../../../../../../script.js';    // is_send_press read by name: a build without it reads undefined, not a link error
import { getMessageTimeStamp } from '../../../../../../RossAscends-mods.js';
import { SlashCommandParser } from '../../../../../../../scripts/slash-commands/SlashCommandParser.js';
import { SlashCommand } from '../../../../../../../scripts/slash-commands/SlashCommand.js';
import { extensionSettings, lastGeneratedData, committedTrackerData, addDebugLog } from '../../core/state.js';
import { saveSettings, saveChatData } from '../../core/persistence.js';
import { withBackgroundProfile, BACKGROUND_BUSY, generateWithExternalAPI, waitForBackground, backgroundHolder } from '../generation/apiClient.js';
import { safeGenerateRaw } from '../../utils/responseExtractor.js';
import { sceneFactsFrom } from '../../utils/questCut.js';
import {
    BLANK_PACK_ID, seedWorldState, normalizeWorldState, buildGapPrompt, validateGap, applyGap, parseAdvanceReply, recentChanges,
    placeLabel, placeChain, resolvePlace, liveWorldConfig, sameName,
} from '../../utils/liveWorld.js';
import { buildCanonBlock, normalizeCanon } from '../../utils/canon.js';
import {
    HUB_META_KEY, hubConfig, normalizeHub, normalizeWorldEntry, gapOf, gapMoves, takeSnapshot, seedStores, personLine, buildBrief,
    buildOpenersPrompt, parseOpenersReply, validateOpeners, openerMessage, sceneTitle, hubMark, readMark, markEnded, sceneHeader,
    sceneFileName, sceneTranscript, buildRecapPrompt, parseRecapReply, openSceneOf, openScene, setSceneAside as setAsidePure,
    resumeScene as resumePure, endSceneRecord, reopenScene as reopenPure, sceneByChat, markChatGone, reconcileScenesWithChats,
    lastRecaps, hubStatusLine, describeEndResult, RECAP_BUDGET, removeGoneScene as removeGonePure,
} from '../../utils/hub.js';
import { ensureCss } from '../../core/cssLoader.js';
import { isLiveWorldOn, loadPack, getWorldState, advanceNow } from './liveWorld.js';
import { isCanonOn, updateCanon } from './canon.js';
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
            return (Array.isArray(data) ? data : Object.values(data || {})).filter(c => c && typeof c === 'object');
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
    return !!readMark(meta());
}

/** The chat in front as a scene: its world, its mark and its record; null when it is not one. */
export function currentScene() {
    const mark = readMark(meta());
    if (!mark) return null;
    const entry = store().worlds[mark.world] || null;
    const file = chatId();
    const record = entry ? (sceneByChat(entry, file) || entry.scenes.find(s => s.id === mark.scene) || null) : null;
    return { worldId: mark.world, mark, scene: record ? JSON.parse(JSON.stringify(record)) : null, ended: !!mark.endedAt };
}

/** CHAT_CHANGED: the chat in front, a scene or not. */
export function onHubChatChanged() {
    pending = null;
    const mark = extensionSettings.enabled ? readMark(meta()) : null;
    current = mark ? { worldId: mark.world, mark } : null;
    mountStrip();
    notify({ source: 'chat' });
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

// ─── Start (D117, D118, D119) ───────────────────────────────────────────

function guardStart(worldId) {
    if (!isHubOn()) return { ok: false, reason: 'off' };
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
async function moveWorldByGap(worldId, pack, memory, gap, recaps) {
    const state = normalizeWorldState(memory.stores.dooms_world);
    const lw = liveWorldConfig(extensionSettings);
    const players = playerNames();
    const prompt = buildGapPrompt({ pack, state, facts: memory.facts, gap: gap.words, recaps, maxStep: lw.maxStep, spoilerFree: lw.spoilerFree, player: players });
    log(`the world moves by "${gap.words}" before the scene`, { world: worldId });
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
    if (gapMoves(theGap) && g.entry.memory) {
        const moved = await moveWorldByGap(g.id, pack, memory, theGap, recaps);
        if (token !== pendingToken) return { ok: false, reason: 'cancelled' };
        if (moved.ok) {
            memory = moved.memory;
            putEntry(g.id, { ...entryOf(g.id), memory }, { source: 'gap', world: g.id });
        } else notes.push(`The world did not move for the gap (${moved.reason}${moved.errors ? `: ${moved.errors.join(' ')}` : moved.error ? `: ${moved.error}` : ''}).`);
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
    const prompt = buildOpenersPrompt({ world: pack, place: label, region, weather, date: memory.facts.date, time: memory.facts.time, gapWords: theGap.words, cast: lines.map(l => l.line), seed: seedText, canonBlock, recaps, quests, player: players[0] || '', note });
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
        weather, since, recaps, player: players, openers, when, errors, notes, prompt,
    };
    return { ok: true, token, world: { id: g.id, name: pack.name }, place: pending.place, cast: names, gap: theGap, openers, when, errors, notes };
}

/** The pending Start, for the picker. */
export function pendingStart() {
    return pending ? { token: pending.token, world: { id: pending.worldId, name: pending.pack.name }, place: pending.place, cast: pending.cast, gap: pending.gap, openers: pending.openers, when: pending.when, errors: pending.errors, notes: pending.notes } : null;
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
    const entry = entryOf(p.worldId);
    const n = entry.seq + 1;
    const title = sceneTitle({ opener: list[0] || null, seed: p.seed, place: p.place.label });
    let existing = [];
    try { existing = (await b.listChats(p.card.avatar)).map(c => String(c.file_name || c.file_id || '')); } catch (e) { log('the card\'s chats could not be listed; the name is trusted', String(e && e.message || e)); }
    const fileName = sceneFileName(n, title, existing);
    const now = Date.now();
    const seeded = seedStores(p.memory, { chatId: fileName, place: p.place.label, cast: p.cast, player: p.player, weather: p.weather, when: p.when, hookId: p.seed && p.seed.kind === 'hook' ? p.seed.id : '', now });
    const brief = buildBrief({ world: p.pack.name, sceneNo: n, place: p.place.label, region: p.place.region, date: seeded.facts.date, time: seeded.facts.time, weather: seeded.facts.weather, gapWords: p.gap.words, cast: p.lines.map(l => l.line), seed: p.seed.text || p.seed.label || '', since: p.since, lastRecap: p.recaps[0] || '', beforeRecap: p.recaps[1] || '', player: p.player[0] || '', note: p.note });
    const mark = hubMark({ world: p.worldId, scene: `s${n}`, title, seed: p.seed, place: p.place, cast: p.cast, gap: p.gap, startedAt: now, startDate: seeded.facts.date });
    const header = sceneHeader({ stores: seeded.stores, mark, scenario: brief, worldInfo: '', integrity: b.uuid() });
    const message = list.length ? openerMessage({ name: p.card.name, openers: list, chosen: 0, sendDate: b.timestamp(), tracker: seeded.tracker, title }) : null;
    try {
        await b.saveChatFile({ chName: p.card.name, avatar: p.card.avatar, fileName, header, messages: message ? [message] : [] });
    } catch (e) {
        const error = String(e && e.message || e);
        log('the scene file could not be written', error);
        return { ok: false, reason: 'file', error };
    }
    const opened = openScene(entry, { title, seed: p.seed, place: p.place, cast: p.cast, gap: p.gap, chat: fileName, card: p.card.avatar, startedAt: now, startDate: seeded.facts.date });
    putEntry(p.worldId, opened.entry, { source: 'start', world: p.worldId });
    pending = null;
    log(`scene ${n} written: "${fileName}"`);
    try {
        await b.unshallowCharacter(p.card.index);
        if (String(b.characterId()) !== String(p.card.index) || b.groupId()) await b.selectCharacterById(p.card.index);
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

/**
 * The End sheet's first step (D122): the recap written for the user to
 * read and edit. Waits for the main generation and the background line.
 */
export async function prepareEnd() {
    const g = guardEnd();
    if (!g.ok) return g;
    const idle = await whenIdle();
    if (!idle) return { ok: false, reason: 'busy' };
    const token = { meta: meta(), id: chatId() };
    const players = playerNames();
    const transcript = sceneTranscript(chatArray() || [], { budget: RECAP_BUDGET, persona: players[0] || 'Player' });
    const brief = token.meta && typeof token.meta.scenario === 'string' ? token.meta.scenario : '';
    const prompt = buildRecapPrompt({ transcript, brief, player: players[0] || '', maxChars: cfg().recapChars });
    let recap = '';
    let error = '';
    try {
        const r = await request(prompt, { transport: recapTransport, label: 'recap' });
        if (r.busy) error = 'Another request holds the line.';
        else { const p = parseRecapReply(r.text, { maxChars: cfg().recapChars }); if (p.ok) recap = p.recap; else error = p.errors.join(' '); }
    } catch (e) { error = String(e && e.message || e); }
    if (meta() !== token.meta || (chatId() !== undefined && chatId() !== token.id)) return { ok: false, reason: 'changed' };
    const facts = factsNow();
    return { ok: true, recap, error, scene: g.cur.scene, mark: g.cur.mark, from: g.cur.mark.startDate, to: facts.date, steps: { canon: isCanonOn(), world: isLiveWorldOn() && !!getWorldState() } };
}

/**
 * End (D122): Canon over the scene, the advancer after the scene, the chat
 * flushed, the snapshot taken and sealed, the record and the mark ended.
 * Each step says how it went; a chat that changes under End stops it
 * before anything of the world is touched.
 */
export async function commitEnd({ recap = '', skipRecap = false, skipCanon = false, skipWorld = false, onStep = null } = {}) {
    const step = (name, state) => { if (typeof onStep === 'function') { try { onStep(name, state); } catch (e) { /* the sheet's own */ } } };
    if (ending) return { ok: false, reason: 'running' };
    const g = guardEnd();
    if (!g.ok) return g;
    ending = true;
    notify({ source: 'end-start' });
    const token = { meta: meta(), id: chatId() };
    const changed = () => meta() !== token.meta || (chatId() !== undefined && chatId() !== token.id);
    const out = { ok: false, recap: skipRecap || !String(recap || '').trim() ? 'skipped' : 'kept', canon: 'off', world: 'off', book: 'off' };
    try {
        const idle = await whenIdle();
        if (!idle) return { ...out, reason: 'busy' };
        if (isCanonOn() && !skipCanon) {
            step('canon', 'running');
            let r = await updateCanon({ reason: 'scene-end', scope: 'scene' });
            if (!r.ok && (r.reason === 'busy' || r.reason === 'running')) { await waitForBackground(); await sleep(timing.idleStepMs); r = await updateCanon({ reason: 'scene-end', scope: 'scene' }); }
            out.canon = r.ok ? 'ok' : 'failed';
            out.canonResult = r;
            step('canon', out.canon);
            if (changed()) return { ...out, reason: 'changed' };
        } else if (isCanonOn()) out.canon = 'skipped';
        if (isLiveWorldOn() && getWorldState() && !skipWorld) {
            step('world', 'running');
            await waitForBackground();
            let r = await advanceNow({ reason: 'scene-end' });
            if (!r.ok && (r.reason === 'busy' || r.reason === 'running')) { await waitForBackground(); await sleep(timing.idleStepMs); r = await advanceNow({ reason: 'scene-end' }); }
            out.world = r.ok ? 'ok' : 'failed';
            out.worldResult = r;
            step('world', out.world);
            if (changed()) return { ...out, reason: 'changed' };
        } else if (isLiveWorldOn() && getWorldState()) out.world = 'skipped';
        // The flush: the tracker's stores rebuilt from memory and the chat written through the conditional save.
        step('snapshot', 'running');
        try { await saveChatData({ immediate: true }); } catch (e) { log('the flush failed', String(e && e.message || e)); return { ...out, reason: 'flush', error: String(e && e.message || e) }; }
        if (changed()) return { ...out, reason: 'changed' };
        const m = meta();
        const facts = factsNow();
        const now = Date.now();
        const sceneId = g.cur.scene ? g.cur.scene.id : g.cur.mark.scene;
        const memory = takeSnapshot(m, { scene: sceneId, takenAt: now });
        const recapText = skipRecap ? '' : String(recap || '').trim();
        let entry = entryOf(g.cur.worldId);
        if (!g.cur.scene) {
            // A record the settings lost: remade from the mark before it is ended.
            entry = reconcileScenesWithChats(entry, [{ file: token.id || '', meta: m }], g.cur.worldId).entry;
        }
        const ended = endSceneRecord(entry, sceneId, { endedAt: now, endDate: facts.date, recap: recapText, noRecap: !recapText });
        putEntry(g.cur.worldId, { ...ended.entry, memory }, { source: 'end', world: g.cur.worldId });
        m[HUB_META_KEY] = markEnded(g.cur.mark, { endedAt: now, endDate: facts.date });
        try { await bridge().saveChat(); } catch (e) { log('the mark could not be saved', String(e && e.message || e)); }
        current = { worldId: g.cur.worldId, mark: m[HUB_META_KEY] };
        step('snapshot', 'ok');
        mountStrip();
        log(`scene ${sceneId} ended and remembered`, { canon: out.canon, world: out.world });
        return { ...out, ok: true, scene: ended.scene, memory: { takenAt: memory.takenAt, facts: memory.facts } };
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
    try {
        await b.unshallowCharacter(card.index);
        if (String(b.characterId()) !== String(card.index) || b.groupId()) await b.selectCharacterById(card.index);
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
    Promise.all([ensureCss('modals').catch(() => {}), import('../ui/hubViews.js')]).then(([, v]) => {
        if (token !== stripToken) return;
        const again = currentScene();
        if (!again) return;
        const html = v.stripHtml({ mark: again.mark, scene: again.scene, ended: again.ended });
        let el = document.getElementById(STRIP_DOM_ID);
        if (!el) {
            chatEl.insertAdjacentHTML('beforebegin', `<div id="${STRIP_DOM_ID}" class="dooms-scene-strip" role="region" aria-label="This scene"></div>`);
            el = document.getElementById(STRIP_DOM_ID);
        }
        if (el) el.innerHTML = html;
    }).catch(e => log('the strip could not be shown', String(e && e.message || e)));
}

const STRIP_DOM_ID = 'dooms-scene-strip';
let stripToken = 0;

/** The records against the card's chats (D128): gone files marked, marked chats the list lost brought back. */
export async function refreshScenes(worldId) {
    const id = String(worldId || '');
    const e = store().worlds[id];
    const card = cardOf(id);
    if (!e || !card) return { ok: false, reason: card ? 'no-world' : 'card-gone' };
    try {
        const chats = await bridge().listChats(card.avatar, { metadata: true });
        const r = reconcileScenesWithChats(e, chats.map(c => ({ file: c.file_name || c.file_id || '', meta: c.chat_metadata || null })), id);
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
                if (!isHubOn()) return 'The hub needs Live World on (Settings → Live World).';
                const cur = currentScene();
                const lines = await hubStatusLines();
                const mine = cur ? lines.find(l => l.id === cur.worldId) : null;
                if (mine) return mine.line;
                return lines.length ? lines.map(l => l.line).join('\n') : 'No world of your own yet: build one in the World Builder, then pick its narrator card in Settings → Live World → Hub.';
            },
            helpString: 'The Hub: the state of this chat\'s world, or of every world with a narrator card.',
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
            const m = await import('../ui/hub.js');
            if (act === 'end') await m.openEndSheet();
            else await m.openHub();
        });
    } catch (e) { /* no jQuery (tests) */ }
}
