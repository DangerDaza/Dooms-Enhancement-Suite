#!/usr/bin/env node
/**
 * The Hub in the chat (docs/hub-plan.md D113–D133): a card bound to a
 * world, a scene's file written whole and opened (the loaders finding every
 * store in its header), two replies played, End (the recap, Canon over the
 * scene, the advancer, the sealed snapshot), a second scene after a gap
 * (the world moved first; the brief carrying last time; the ledger and the
 * quests kept), set aside, resume, reopen, a chat gone, the records
 * refreshed from the card's chats, a plain chat untouched, the chat
 * changing under End, Live World off.
 *
 * Usage:  node tools/hub-flow-test.mjs     (from the repo root)
 * Exit:   0 = pass, 1 = failure
 *
 * Same sandbox as tools/canon-flow-test.mjs. SillyTavern's chat calls are
 * reached through the context, so the test puts real functions on it: the
 * save endpoint records the files, "open" swaps the chat and its metadata
 * for the file's and runs DES's own loaders, as a chat change would.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { buildSandbox } from './sandbox.mjs';

const { SANDBOX, DES } = buildSandbox();
if (!existsSync(`${DES}/src/systems/features/hub.js`)) {
    console.error('FAIL: sandbox missing after load-check — cannot run.');
    process.exit(1);
}

globalThis.__DES_CHAT__ = [];
globalThis.__DES_CHAT_METADATA__ = {};
globalThis.__DES_SLOTS__ = {};
globalThis.__DES_SAVES__ = { debounced: 0, immediate: 0 };
const scriptStub = `${SANDBOX}/script.js`;
const before = readFileSync(scriptStub, 'utf8');
const patched = before
    .replace('export const chat_metadata = anything;', 'export const chat_metadata = globalThis.__DES_CHAT_METADATA__;')
    .replace('export const chat = anything;', 'export const chat = globalThis.__DES_CHAT__;')
    .replace('export const setExtensionPrompt = anything;', 'export const setExtensionPrompt = (key, value, position, depth, scan, role) => { globalThis.__DES_SLOTS__[key] = { value, position, depth, role }; };')
    .replace('export const extension_prompt_roles = anything;', 'export const extension_prompt_roles = { SYSTEM: 0, USER: 1, ASSISTANT: 2 };')
    .replace('export const extension_prompt_types = anything;', 'export const extension_prompt_types = { IN_PROMPT: 0, IN_CHAT: 1 };')
    .replace('export const saveChatDebounced = anything;', 'export const saveChatDebounced = () => { globalThis.__DES_SAVES__.debounced++; };')
    .replace('export const saveChatConditional = anything;', 'export const saveChatConditional = async () => { globalThis.__DES_SAVES__.immediate++; if (globalThis.__DES_PERSIST__) globalThis.__DES_PERSIST__(); };')
    .replace('export const getRequestHeaders = anything;', 'export const getRequestHeaders = () => ({});')
    + '\nexport let is_send_press = false;\nexport const __setSendPress = (v) => { is_send_press = v; };\n';
if (patched === before || !patched.includes('getRequestHeaders = () => ({})')) { console.error('FAIL: the script stub was not patched (an import changed name?)'); process.exit(1); }
writeFileSync(scriptStub, patched);
const extStub = `${SANDBOX}/scripts/extensions.js`;
writeFileSync(extStub, readFileSync(extStub, 'utf8').replace('export const getContext = anything;', 'export const getContext = () => globalThis.__DES_CTX__;'));

const anything = new Proxy(function () {}, {
    get(t, p) {
        if (p === Symbol.toPrimitive) return () => 'stub';
        if (p === 'then') return undefined;
        if (p === Symbol.iterator) return function* () {};
        return anything;
    },
    apply() { return anything; },
    construct() { return {}; },
});
globalThis.__DES_ANYTHING__ = anything;
const chat = globalThis.__DES_CHAT__;
const meta = globalThis.__DES_CHAT_METADATA__;
const saves = globalThis.__DES_SAVES__;

// ── SillyTavern as the test plays it: cards, chat files, the open ──────
const files = new Map();      // file name -> { header, messages, avatar }
const calls = [];             // every fetch
const ctxTarget = {
    chat, chat_metadata: meta, name1: 'Jordan', name2: 'Mara Vane', chatId: 'Mara Vane - 2026-11-02@20h00m00s000ms', user_avatar: '',
    characters: [{ name: 'Mara Vane', avatar: 'Mara Vane.png', chat: 'Mara Vane - 2026-11-02@20h00m00s000ms' }, { name: 'Someone Else', avatar: 'Someone Else.png', chat: 'x' }],
    characterId: 0, groupId: null,
    selectCharacterById: async (i) => { ctxTarget.characterId = i; ctxTarget.name2 = ctxTarget.characters[i].name; ctxTarget.chatId = ctxTarget.characters[i].chat; opens.push(`select:${i}`); },
    openCharacterChat: async (file) => { opens.push(`open:${file}`); await openFile(file); },
    getCurrentChatId: () => ctxTarget.chatId,
    reloadCurrentChat: async () => {},
    renameChat: async () => {},
    saveChat: async () => { saves.immediate++; persist(); },
    getCharacters: async () => {},
    unshallowCharacter: async () => {},
};
const opens = [];
/** SillyTavern's save: the chat in front written to its file, metadata and messages. */
function persist() {
    const f = files.get(ctxTarget.chatId);
    if (!f) return;
    f.header = { ...f.header, chat_metadata: JSON.parse(JSON.stringify(meta)) };
    f.messages = JSON.parse(JSON.stringify(chat));
}
globalThis.__DES_PERSIST__ = persist;
globalThis.__DES_CTX__ = new Proxy(ctxTarget, { get: (t, p) => (p in t ? t[p] : anything) });
globalThis.window = globalThis;
globalThis.self = globalThis;
globalThis.document = anything;
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
Object.defineProperty(globalThis, 'navigator', { value: { hardwareConcurrency: 8, maxTouchPoints: 0 }, configurable: true });
globalThis.jQuery = anything;
globalThis.$ = anything;
globalThis.toastr = anything;
globalThis.requestAnimationFrame = () => 0;
globalThis.cancelAnimationFrame = () => {};
globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
globalThis.CustomEvent = class { constructor(type, init) { this.type = type; this.detail = init && init.detail; } };
globalThis.dispatchEvent = () => true;
globalThis.fetch = async (url, init) => {
    const body = init && init.body ? JSON.parse(init.body) : {};
    calls.push({ url, body });
    if (url === '/api/chats/save') {
        files.set(body.file_name, { header: body.chat[0], messages: body.chat.slice(1), avatar: body.avatar_url, chName: body.ch_name });
        return { ok: true, status: 200, json: async () => ({}), text: async () => '' };
    }
    if (url === '/api/characters/chats') {
        const list = {};
        for (const [name, f] of files) if (f.avatar === body.avatar_url) list[name] = { file_name: `${name}.jsonl`, file_id: name, ...(body.metadata ? { chat_metadata: f.header.chat_metadata } : {}) };
        if (!Object.keys(list).length) return { ok: true, status: 200, json: async () => ({ error: true }) };    // a card never opened: no chats folder
        return { ok: true, status: 200, json: async () => list };
    }
    if (url === '/api/characters/create') {
        ctxTarget.characters.push({ name: body.ch_name, avatar: `${body.ch_name}.png`, chat: `${body.ch_name} - new` });
        return { ok: true, status: 200, text: async () => body.ch_name, json: async () => ({}) };
    }
    return { ok: false, status: 404, json: async () => ({}), text: async () => '' };
};

const state = await import(`${DES}/src/core/state.js`);
const { extensionSettings } = state;    // the tracker singletons are read through `state`: a chat load reassigns them
const persistence = await import(`${DES}/src/core/persistence.js`);
const lwUtils = await import(`${DES}/src/utils/liveWorld.js`);
const lw = await import(`${DES}/src/systems/features/liveWorld.js`);
const cn = await import(`${DES}/src/systems/features/canon.js`);
const inv = await import(`${DES}/src/systems/features/inventory.js`);
const hub = await import(`${DES}/src/systems/features/hub.js`);

let failures = 0;
const check = (label, cond, extra = '') => {
    if (cond) { console.log(`pass  ${label}`); }
    else { console.error(`FAIL  ${label}${extra ? '\n      ' + extra : ''}`); failures++; }
};
const user = (mes) => ({ is_user: true, name: 'Jordan', mes, extra: {} });
const ai = (mes) => ({ is_user: false, name: 'Mara Vane', mes, swipe_id: 0, swipes: [mes], extra: {} });
const wait = (ms) => new Promise(r => setTimeout(r, ms));
const resetMeta = () => { for (const k of Object.keys(meta)) delete meta[k]; };

/** The loaders a chat change runs, in index.js's order. */
async function loaders() {
    persistence.loadChatData();
    inv.onInventoryChatChanged();
    await lw.onWorldChatChanged();
    cn.onCanonChatChanged();
    hub.onHubChatChanged();
}
/** SillyTavern opening a chat file: its header is the metadata, its messages the chat. */
async function openFile(file) {
    const f = files.get(file);
    if (!f) throw new Error(`no such chat: ${file}`);
    resetMeta();
    Object.assign(meta, JSON.parse(JSON.stringify(f.header.chat_metadata)));
    chat.length = 0;
    chat.push(...JSON.parse(JSON.stringify(f.messages)));
    ctxTarget.chatId = file;
    ctxTarget.characters[ctxTarget.characterId].chat = file;
    await loaders();
}
/** A chat that is not a scene: a plain greeting on the card. */
async function openPlain(name = 'Mara Vane - plain') {
    resetMeta();
    chat.length = 0;
    chat.push(ai('Hello, traveller.'));
    ctxTarget.chatId = name;
    await loaders();
}

const example = JSON.parse(readFileSync(new URL('../worldpacks/example.json', import.meta.url), 'utf8'));
const elsewhere = { ...example, id: 'elsewhere', name: 'Elsewhere', description: 'A second world.' };
extensionSettings.enabled = true;
extensionSettings.generationMode = 'together';
extensionSettings.connectionProfile = '';
extensionSettings.userCharacters = {};
extensionSettings.perChatCharacterTracking = true;
extensionSettings.characterInjection = { 'Old Marit': { description: 'Keeps the Anchor; a net-mender with debts.', lorebook: '' } };
extensionSettings.liveWorld = { ...lwUtils.defaultLiveWorldConfig(), enabled: true, pack: 'blank', every: 50, customPacks: { harbourside: JSON.stringify(example), elsewhere: JSON.stringify(elsewhere) } };
extensionSettings.canon = { enabled: true, every: 50, recentMessages: 6, inject: true, depth: 3, role: 'system', maxChars: 1500 };
extensionSettings.quests = { main: 'None', optional: [] };
hub.__setHubTiming({ idleStepMs: 5, idleMaxMs: 200 });
await openPlain();

console.log('\n§1 the store and the card');
{
    check('the worlds the hub can play: the user\'s own', JSON.stringify(hub.hubWorldIds()) === '["harbourside","elsewhere"]');
    check('no card yet: not a scene, no status', !hub.isScene() && hub.worldEntry('harbourside') === null);
    const b = hub.bindCard('harbourside', 'Mara Vane.png');
    check('a card bound to a world; the same again changes nothing', b.ok && b.changed && hub.bindCard('harbourside', 'Mara Vane.png').changed === false && hub.cardOf('harbourside').index === 0 && hub.cardOf('harbourside').name === 'Mara Vane');
    const other = hub.bindCard('elsewhere', 'Mara Vane.png');
    check('one card narrates one world: a card bound elsewhere is refused', !other.ok && other.reason === 'bound-elsewhere' && other.world === 'harbourside');
    const made = await hub.makeNarratorCard('elsewhere');
    const create = calls.find(c => c.url === '/api/characters/create');
    check('Make a narrator card: the create call with the world\'s name and no greeting, then bound', made.ok && made.avatar === 'Narrator of Elsewhere.png' && create && create.body.ch_name === 'Narrator of Elsewhere' && create.body.first_mes === '' && create.body.description.includes('A second world.') && hub.cardOf('elsewhere').name === 'Narrator of Elsewhere', JSON.stringify(made));
    const lines = await hub.hubStatusLines();
    check('a status line per world', lines.length === 2 && lines[0].line.startsWith('Harbourside: narrated by Mara Vane; 0 scenes played; no scene ended yet.'), JSON.stringify(lines));
    check('a plain chat on the bound card is not a scene; End is refused', !hub.isScene() && (await hub.prepareEnd()).reason === 'not-scene' && (await hub.commitEnd({})).reason === 'not-scene');
}

console.log('\n§2 the first scene');
let firstFile = '';
{
    let openersPrompt = null;
    hub.__setOpenersTransport(async (prompt) => { openersPrompt = prompt; return '```json\n{"when":{"date":"Day 1","time":"dusk"},"openers":[{"title":"The queue","text":"The Anchor is loud tonight. Old Marit looks up from her net. What do you do?","who":["Old Marit"]},{"title":"A quiet corner","text":"Rain drums the shutters. Marit waves you to the back room.","who":["Old Marit"]},{"title":"The stranger","text":"A stranger blocks the door. Marit shakes her head at you.","who":["Old Marit"]}]}\n```'; });
    const p = await hub.prepareScene({ worldId: 'harbourside', seed: { kind: 'place', id: 'the-anchor', label: 'The Anchor' }, place: { id: 'the-anchor' }, cast: ['Old Marit', 'Jordan'], gap: { id: 'now' }, note: 'find the ring' });
    check('prepared: three openers, when, the place and its region, the cast without the player', p.ok && p.openers.length === 3 && p.when.date === 'Day 1' && p.place.label === 'The Anchor, a tavern' && p.place.region && p.cast.length === 1 && p.cast[0] === 'Old Marit' && p.errors.length === 0, JSON.stringify(p));
    check('the request: the world, the spot, the person\'s Workshop line, the seed, the wish; no ledger and no last time yet', openersPrompt && openersPrompt.user.includes('World: Harbourside') && openersPrompt.user.includes('Where the scene opens: The Anchor, a tavern (') && openersPrompt.user.includes('Old Marit: Keeps the Anchor; a net-mender with debts.') && openersPrompt.user.includes('Jordan wants from this scene: find the ring') && !openersPrompt.user.includes('[CANON') && !openersPrompt.user.includes('Last time'), openersPrompt && openersPrompt.user);
    check('a second Start while one is pending replaces it; the first token is cancelled', (await hub.commitScene(p.token - 1, {})).reason === 'cancelled' && hub.pendingStart().token === p.token);
    const r = await hub.commitScene(p.token, { choice: 1 });
    firstFile = r.file;
    const saved = files.get(firstFile);
    check('committed: the file written under the card as "Scene 1 - A quiet corner", the record open, the chat opened', r.ok && r.file === 'Scene 1 - A quiet corner' && saved && saved.avatar === 'Mara Vane.png' && saved.chName === 'Mara Vane' && r.scene.id === 's1' && opens.includes('open:Scene 1 - A quiet corner') && !opens.some(o => o.startsWith('select')), JSON.stringify({ r, opens }));
    const h = saved.header.chat_metadata;
    check('the header: a world state seeded from the pack and marked seeded; the mark with its file; tainted; the brief as the scenario; an integrity id; the two unused names', h.dooms_world && h.dooms_world.pack === 'harbourside' && h.dooms_world.seeded === true && h.dooms_hub.scene === 's1' && h.dooms_hub.world === 'harbourside' && h.dooms_hub.file === firstFile && h.tainted === true && h.scenario.startsWith('[SCENE BRIEF: Harbourside, scene 1.') && h.scenario.includes('Where: The Anchor, a tavern (') && h.scenario.includes('When: Day 1, dusk.') && h.scenario.includes('Who is here: Old Marit: Keeps the Anchor; a net-mender with debts.') && h.scenario.includes('Jordan wants: find the ring') && typeof h.integrity === 'string' && saved.header.user_name === 'unused', h.scenario);
    const t = h.dooms_tracker;
    const chars = JSON.parse(t.committedTrackerData.characterThoughts).characters;
    const box = JSON.parse(t.lastGeneratedData.infoBox);
    check('the tracker seeded: the cast present, the place and the date in the info box, the quests empty', chars.length === 1 && chars[0].name === 'Old Marit' && box.location.value === 'The Anchor, a tavern' && box.date.value === 'Day 1' && box.time.start === 'dusk' && t.quests.main === 'None', t.lastGeneratedData.infoBox);
    const m = saved.messages[0];
    check('the first message: the chosen opener in front, the other two as swipes, the tracker data on each, the mark on it', saved.messages.length === 1 && m.name === 'Mara Vane' && m.mes.startsWith('Rain drums') && m.swipes.length === 3 && m.swipes[1].startsWith('The Anchor is loud') && m.extra.dooms_tracker_swipes[2].infoBox === t.lastGeneratedData.infoBox && m.extra.dooms_hub.opener === true, JSON.stringify(m).slice(0, 200));
    check('the chat in front is the scene: the mark read, the record found, the loaders found their stores (the world from the header, the ledger empty)', hub.isScene() && hub.currentScene().scene.status === 'open' && hub.currentScene().worldId === 'harbourside' && lw.getWorldState() && lw.getWorldState().pack === 'harbourside' && lw.getActivePack().name === 'Harbourside' && cn.getCanon() && cn.getCanon().entries.length === 0 && meta.dooms_hub.scene === 's1');
    check('the info box in memory is the seeded one', JSON.parse(state.lastGeneratedData.infoBox).location.value === 'The Anchor, a tavern' && JSON.parse(state.committedTrackerData.characterThoughts).characters[0].name === 'Old Marit');
    // The tracker's own handler runs on the first-message event and overwrites the opener's swipe entry with nulls; the hub puts the seed back.
    chat[0].extra.dooms_tracker_swipes = { 0: { quests: null, infoBox: null, characterThoughts: null, player: null } };
    hub.onHubMessageReceived(0, 'first_message');
    check('the first-message event: the seed is back on every swipe of the opener and in the singletons, saved at once', chat[0].extra.dooms_tracker_swipes[0].infoBox === t.lastGeneratedData.infoBox && chat[0].extra.dooms_tracker_swipes[2].characterThoughts === t.lastGeneratedData.characterThoughts && chat[0].swipe_info[1].extra.dooms_tracker_swipes[1].infoBox === t.lastGeneratedData.infoBox && state.lastGeneratedData.infoBox === t.lastGeneratedData.infoBox, JSON.stringify(chat[0].extra.dooms_tracker_swipes[0]).slice(0, 200));
    delete globalThis.__DES_SLOTS__['dooms-tracker-example'];
    hub.onHubGenerationStarted(undefined, {}, false);
    const ex = globalThis.__DES_SLOTS__['dooms-tracker-example'];
    check('the first send: the tracker\'s example block set by the hub at depth 1 as the assistant (the chat holds the opener alone)', !!ex && ex.value.includes('```json') && ex.value.includes('Old Marit') && ex.depth === 1 && ex.role === 2, JSON.stringify(ex).slice(0, 200));
    delete globalThis.__DES_SLOTS__['dooms-tracker-example'];
    hub.onHubGenerationStarted('quiet', {}, false);
    check('a quiet generation gets none', !globalThis.__DES_SLOTS__['dooms-tracker-example']);
    const again = await hub.prepareScene({ worldId: 'harbourside', place: { id: 'the-quay' } });
    check('another Start while a scene is open is refused with the scene', !again.ok && again.reason === 'scene-open' && again.scene.id === 's1');
    check('the status line says so', (await hub.hubStatusLines())[0].line.includes('scene 1 open at The Anchor, a tavern since Day 1'));
}

console.log('\n§3 played, then ended');
{
    chat.push(user('I ask Marit about the ring.'));
    chat.push(ai('"The governor\'s ring?" She lowers her voice. "Sunk with the Kestrel, they say."'));
    state.lastGeneratedData.infoBox = JSON.stringify({ date: { value: 'Day 1' }, time: { start: 'night', end: 'night' }, location: { value: 'The Anchor, a tavern' }, weather: { emoji: '🌧', forecast: 'rain' } });
    state.lastGeneratedData.quests = JSON.stringify({ main: 'Find the governor\'s ring', optional: [] });
    extensionSettings.quests = { main: 'Find the governor\'s ring', optional: [] };
    lw.onWorldMessageReceived(chat.length - 1);
    cn.onCanonMessageReceived(chat.length - 1);
    check('a reply counted by Live World and Canon as in any chat', lw.getWorldState().sinceLast === 1 && cn.getCanon().sinceLast === 1);
    hub.__setRecapTransport(async () => '{"recap":"Jordan asked Old Marit about the ring; she said it sank with the Kestrel."}');
    const pe = await hub.prepareEnd();
    check('End prepared: the recap written, the scene named, the steps on', pe.ok && pe.recap === 'Jordan asked Old Marit about the ring; she said it sank with the Kestrel.' && pe.scene.id === 's1' && pe.steps.canon && pe.steps.world && pe.from === 'Day 1', JSON.stringify(pe));
    let canonPrompt = null;
    cn.__setCanonTransport(async (prompt) => { canonPrompt = prompt; return '{"add":[{"kind":"person","name":"Old Marit","text":"Keeps the Anchor; says the ring sank with the Kestrel."},{"kind":"thing","name":"The governor\'s ring","text":"Said to have sunk with the Kestrel."}],"drop":[]}'; });
    let afterPrompt = null;
    lw.__setWorldTransport(async () => { throw new Error('the chat\'s own advancer must not run at End'); });
    hub.__setGapTransport(async (prompt) => { afterPrompt = prompt; return '{"elapsed":"an evening","now":{"date":"Day 2","time":"morning"},"clocks":{},"moved":[],"blurb":"Talk of the ring in every tavern.","heard":[]}'; });
    const before = saves.immediate;
    const chatBlurb = meta.dooms_world.blurb;
    const ce = await hub.commitEnd({ recap: pe.recap });
    check('End: the ledger read over the whole scene (both messages, the caps doubled), the world moved for the scene over the snapshot (the chat\'s own world untouched), the chat flushed, remembered', ce.ok && ce.canon === 'ok' && ce.world === 'ok' && ce.snapshot === 'ok' && ce.recap === 'kept' && canonPrompt && canonPrompt.user.includes('I ask Marit about the ring.') && canonPrompt.user.includes('Sunk with the Kestrel') && canonPrompt.system.includes('at most 16 adds and 8 drops') && afterPrompt && afterPrompt.system.includes('after a scene has ended') && afterPrompt.user.includes('Jordan asked Old Marit about the ring') && afterPrompt.user.includes('Day 1 to Day 1') && saves.immediate > before && meta.dooms_world.blurb === chatBlurb, JSON.stringify(ce));
    const e = hub.worldEntry('harbourside');
    check('the snapshot: the six stores sealed (no reply id on the ledger\'s lines nor the world\'s runs), the facts from the newest tracker data and the after-scene run\'s date, the quests, the ledger, the persona', e.memory && e.memory.stores.dooms_canon.entries.length === 2 && e.memory.stores.dooms_canon.entries.every(x => x.msgId === null) && e.memory.stores.dooms_world.runs.every(x => x.msgId === null) && e.memory.stores.dooms_world.blurb === 'Talk of the ring in every tavern.' && e.memory.facts.date === 'Day 2' && e.memory.facts.time === 'morning' && e.memory.facts.weather === '🌧 rain' && e.memory.facts.location === 'The Anchor, a tavern' && e.memory.stores.dooms_tracker.quests.main === 'Find the governor\'s ring' && e.memory.scene === 's1' && e.memory.player === 'Jordan', JSON.stringify(e.memory.facts));
    check('the mark records the ledger\'s read, so End again does not read it twice for the same reply', meta.dooms_hub.end && meta.dooms_hub.end.canonAt === chat[2].dooms_world_id);
    check('the record ended with its recap and dates; the mark ended in the chat; the chat in front reads as ended', e.scenes[0].status === 'ended' && e.scenes[0].recap === pe.recap && e.scenes[0].endDate === 'Day 1' && meta.dooms_hub.endedAt > 0 && hub.currentScene().ended === true);
    check('End again is refused: not open', (await hub.prepareEnd()).reason === 'not-open');
    check('the status line: one scene played, the world\'s date', (await hub.hubStatusLines())[0].line === 'Harbourside: narrated by Mara Vane; 1 scene played; the world\'s date is Day 2, morning.', (await hub.hubStatusLines())[0].line);
}

console.log('\n§4 the second scene, days later');
let secondFile = '';
{
    const clock = lw.getActivePack().clocks[0];
    let gapPrompt = null;
    hub.__setGapTransport(async (prompt) => { gapPrompt = prompt; return `{"elapsed":"three days","now":{"date":"Day 4","time":"morning"},"clocks":{"${clock.id}":${clock.start + 1}},"moved":[{"who":"Old Marit","to":"back-room"}],"blurb":"The cutter is searching holds.","heard":["The governor"]}`; });
    let openersPrompt = null;
    hub.__setOpenersTransport(async (prompt) => { openersPrompt = prompt; return '{"when":{"date":"Day 4","time":"morning"},"openers":[{"title":"The customs house","text":"Reyes stamps a paper without looking up. The queue shuffles. What do you do?","who":["Captain Reyes"]},{"title":"The quay","text":"Gulls over the quay.","who":[]}]}'; });
    const p = await hub.prepareScene({ worldId: 'harbourside', seed: { kind: 'rumour', text: 'The cutter is searching every hold.' }, place: { id: 'customs-house' }, cast: ['Captain Reyes'], gap: { id: 'days' } });
    check('the world moved first, in the Start\'s hand: the gap run told the time passing and the last scene; the world\'s memory is not written until the file is', p.ok && gapPrompt && gapPrompt.user.includes('Time passing now: some days later.') && gapPrompt.user.includes('Last: Jordan asked Old Marit about the ring') && gapPrompt.system.includes('some days later pass') && hub.worldEntry('harbourside').memory.facts.date === 'Day 2', JSON.stringify({ p, facts: hub.worldEntry('harbourside').memory.facts }));
    check('the openers asked with the ledger, last time, the open quest and the gap', openersPrompt.user.includes('[CANON') && openersPrompt.user.includes('Last scene: Jordan asked Old Marit') && openersPrompt.user.includes('Main: Find the governor\'s ring') && openersPrompt.user.includes('this scene opens some days later') && p.openers.length === 2, openersPrompt.user);
    const r = await hub.commitScene(p.token, { choice: 0 });
    secondFile = r.file;
    const saved = files.get(secondFile);
    const h = saved.header.chat_metadata;
    check('committed: the world moved by the gap is written with the record: the clock and the place moved, the date from "now"', r.ok && hub.worldEntry('harbourside').memory.facts.date === 'Day 4' && hub.worldEntry('harbourside').memory.stores.dooms_world.clocks[clock.id] === clock.start + 1 && hub.worldEntry('harbourside').memory.stores.dooms_world.where['Old Marit'].endsWith('back-room'), JSON.stringify(hub.worldEntry('harbourside').memory.facts));
    check('the second file: the ledger\'s lines, the quests, the done list, the inventory bound to the new chat, the hook store; the brief carries since last time and last time', r.ok && r.file === 'Scene 2 - The customs house' && h.dooms_canon.entries.length === 2 && h.dooms_tracker.quests.main === 'Find the governor\'s ring' && (!h.dooms_inventory || h.dooms_inventory.chat === 'Scene 2 - The customs house') && h.scenario.includes('Since last time:') && h.scenario.includes('Old Marit:') && h.scenario.includes('Last time: Jordan asked Old Marit about the ring') && h.scenario.includes('some days later since the last scene') && h.scenario.includes('When: Day 4, morning'), h.scenario);
    check('opened: the loaders keep every line (the seal holds), the world\'s clocks as moved, the scene open', hub.currentScene().scene.id === 's2' && cn.getCanon().entries.length === 2 && cn.getCanon().entries[0].name === 'Old Marit' && lw.getWorldState().clocks[clock.id] === clock.start + 1 && lw.getWorldState().known['The governor'] === 'heard' && JSON.parse(state.committedTrackerData.characterThoughts).characters[0].name === 'Captain Reyes' && JSON.parse(state.lastGeneratedData.infoBox).location.value === 'The customs house');
    check('the block rides a generation in the scene chat from the first turn', (cn.onCanonGenerationStarted(undefined, {}, false), globalThis.__DES_SLOTS__['dooms-canon'].value.includes('Old Marit: Keeps the Anchor; says the ring sank')));
    check('the first scene is still ended, not aside', hub.worldEntry('harbourside').scenes[0].status === 'ended');
}

console.log('\n§5 aside, resume, reopen, gone, refreshed');
{
    check('set aside: nothing open', hub.setSceneAside('harbourside', 's2') && hub.worldEntry('harbourside').scenes[1].status === 'aside');
    await openPlain();
    const res = await hub.resumeScene('harbourside', 's2');
    check('resume opens the scene\'s chat on its card and sets it open', res.ok && opens[opens.length - 1] === `open:${secondFile}` && hub.currentScene().scene.status === 'open' && hub.isScene());
    const open1 = await hub.openSceneChat('harbourside', 's1');
    check('open the first (ended) scene\'s chat: the record stays ended; the chat in front reads ended', open1.ok && hub.currentScene().ended === true && hub.currentScene().scene.status === 'ended');
    const re = await hub.reopenCurrentScene();
    check('reopen: open again and marked reopened, the mark\'s end cleared, the other open scene set aside', re.ok && hub.currentScene().scene.status === 'open' && hub.currentScene().scene.reopened === true && meta.dooms_hub.endedAt === 0 && hub.worldEntry('harbourside').scenes[1].status === 'aside');
    hub.onHubChatDeleted(secondFile);
    check('a scene\'s chat deleted in SillyTavern: the record marked gone', hub.worldEntry('harbourside').scenes[1].gone === true && (await hub.resumeScene('harbourside', 's2')).reason === 'chat-gone');
    const rf = await hub.refreshScenes('harbourside');
    check('refreshed against the card\'s chats: the file is still there, so the record is back', rf.ok && rf.changed === 1 && hub.worldEntry('harbourside').scenes[1].gone === false, JSON.stringify(rf));
    files.delete(secondFile);
    const rf2 = await hub.refreshScenes('harbourside');
    check('the file really gone: marked again', rf2.changed === 1 && hub.worldEntry('harbourside').scenes[1].gone === true);
    // The settings lost: the records come back from the marks the chats carry.
    extensionSettings.hub.worlds.harbourside.scenes = [];
    extensionSettings.hub.worlds.harbourside.seq = 0;
    const rb = await hub.refreshScenes('harbourside');
    check('rebuilt from the card\'s chats: scene 1 is back from its mark', rb.ok && rb.scenes.length === 1 && rb.scenes[0].id === 's1' && rb.scenes[0].chat === firstFile && rb.scenes[0].title === 'A quiet corner', JSON.stringify(rb.scenes));
}

console.log('\n§6 the chat changing under End; Live World off');
{
    await hub.openSceneChat('harbourside', 's1');
    hub.__setRecapTransport(async () => 'Jordan asked about the ring.');
    const pe = await hub.prepareEnd();
    check('a reopened scene can be ended again; a prose recap is read; it is stale (scene 2 ended after it began) and the ledger was already read for its last reply', pe.ok && pe.recap === 'Jordan asked about the ring.' && pe.stale === true && pe.canonDone === true && pe.steps.canon === false, JSON.stringify({ stale: pe.stale, canonDone: pe.canonDone, steps: pe.steps }));
    const memBefore = JSON.stringify(hub.worldEntry('harbourside').memory);
    const ce = await hub.commitEnd({ recap: pe.recap });
    check('a stale scene ended keeps the world\'s memory: the record ended with its recap, the snapshot and the world kept as they were', ce.ok && ce.stale === true && ce.snapshot === 'kept' && ce.world === 'kept' && JSON.stringify(hub.worldEntry('harbourside').memory) === memBefore && hub.worldEntry('harbourside').scenes[0].status === 'ended' && hub.worldEntry('harbourside').scenes[0].recap === 'Jordan asked about the ring.', JSON.stringify(ce));
    await hub.reopenCurrentScene();
    chat.push(user('One more thing.'));
    chat.push(ai('Marit shrugs.'));
    lw.onWorldMessageReceived(chat.length - 1);
    cn.onCanonMessageReceived(chat.length - 1);
    const pe2 = await hub.prepareEnd();
    check('a new reply in the reopened scene: the ledger is to be read again', pe2.ok && pe2.canonDone === false && pe2.steps.canon === true);
    const ce2 = await hub.commitEnd({ recap: pe2.recap, replaceMemory: true });
    check('ended with "replace the world\'s memory": the snapshot is this scene\'s', ce2.ok && ce2.snapshot === 'ok' && hub.worldEntry('harbourside').memory.scene === 's1', JSON.stringify(ce2));
    await hub.reopenCurrentScene();
    chat.push(user('And another.'));
    chat.push(ai('Marit nods.'));
    cn.onCanonMessageReceived(chat.length - 1);
    const pe3 = await hub.prepareEnd();
    cn.__setCanonTransport(async () => { await openPlain('Mara Vane - elsewhere'); return '{"add":[]}'; });
    const ce3 = await hub.commitEnd({ recap: pe3.recap, replaceMemory: true });
    check('the chat changed while Canon ran: End stops before the snapshot', !ce3.ok && ce3.reason === 'changed' && hub.worldEntry('harbourside').memory.scene === 's1', JSON.stringify(ce3));
    cn.__setCanonTransport(async () => '{"add":[]}');
    // The opener deleted: the tracker nulls both stores; the hub puts the header's seed back.
    await hub.openSceneChat('harbourside', 's1');
    chat.length = 0;
    state.setLastGeneratedData({ quests: null, infoBox: null, characterThoughts: null, player: null, html: null });
    state.setCommittedTrackerData({ quests: null, infoBox: null, characterThoughts: null, player: null });
    hub.onHubMessageDeleted();
    check('the opener deleted: the seeded cast and place are back in both stores', !!state.lastGeneratedData.characterThoughts && JSON.parse(state.lastGeneratedData.characterThoughts).characters[0].name === 'Old Marit' && JSON.parse(state.committedTrackerData.infoBox).location.value === 'The Anchor, a tavern', String(state.lastGeneratedData.characterThoughts).slice(0, 120));
    // A branch of a scene: the same mark under another file is not the scene.
    const branchMeta = JSON.parse(JSON.stringify(meta));
    resetMeta(); Object.assign(meta, branchMeta); ctxTarget.chatId = 'Scene 1 - A quiet corner (branch)';
    hub.onHubChatChanged();
    check('a branch of a scene (its mark under another file) is not a scene: no End, no strip', !hub.isScene() && hub.currentScene() === null && (await hub.prepareEnd()).reason === 'not-scene');
    extensionSettings.liveWorld.enabled = false;
    const off = await hub.prepareScene({ worldId: 'harbourside', place: { id: 'the-quay' } });
    check('Live World off: the hub is off', !off.ok && off.reason === 'off' && !hub.isHubOn());
    extensionSettings.liveWorld.enabled = true;
    hub.__setChatBridge({ has: () => false });
    const old = await hub.prepareScene({ worldId: 'harbourside', place: { id: 'the-quay' } });
    check('a SillyTavern without the chat calls: too old, nothing done', !old.ok && old.reason === 'too-old');
    hub.__setChatBridge(null);
}

console.log(failures ? `\n${failures} FAILED` : '\nall pass');
process.exit(failures ? 1 : 0);
