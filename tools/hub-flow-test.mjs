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
    .replace('export const user_avatar = anything;', "export const user_avatar = 'jordan.png';")
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
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
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

const example = { ...JSON.parse(readFileSync(new URL('../worldpacks/example.json', import.meta.url), 'utf8')), id: 'harbourside' };
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
    check('the header: a world state seeded from the pack and marked seeded; the mark with its file and the brief; tainted; the persona locked; no scenario override; an integrity id; the two unused names', h.dooms_world && h.dooms_world.pack === 'harbourside' && h.dooms_world.seeded === true && h.dooms_hub.scene === 's1' && h.dooms_hub.world === 'harbourside' && h.dooms_hub.file === firstFile && h.tainted === true && h.persona === 'jordan.png' && !('scenario' in h) && h.dooms_hub.brief.startsWith('[SCENE BRIEF: Harbourside, scene 1.') && h.dooms_hub.brief.includes('Where: The Anchor, a tavern (') && h.dooms_hub.brief.includes('When: Day 1, dusk.') && h.dooms_hub.brief.includes('Who is here: Old Marit: Keeps the Anchor; a net-mender with debts.') && h.dooms_hub.brief.includes('Jordan wants: find the ring') && typeof h.integrity === 'string' && saved.header.user_name === 'unused', h.dooms_hub.brief);
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
    const briefSlot = globalThis.__DES_SLOTS__['dooms-scene-brief'];
    check('the brief rides the hub\'s own slot at depth 2 as system, raw', !!briefSlot && briefSlot.value.includes('[SCENE BRIEF: Harbourside, scene 1.') && briefSlot.depth === 2 && briefSlot.role === 0 && briefSlot.position === 1, JSON.stringify(briefSlot).slice(0, 160));
    delete globalThis.__DES_SLOTS__['dooms-tracker-example'];
    hub.onHubGenerationStarted('quiet', {}, false);
    check('a quiet generation gets none, and no brief', !globalThis.__DES_SLOTS__['dooms-tracker-example'] && globalThis.__DES_SLOTS__['dooms-scene-brief'].value === '');
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
    let recapAsked = null;
    hub.__setRecapTransport(async (p) => { recapAsked = p; return '{"recap":"Jordan asked Old Marit about the ring; she said it sank with the Kestrel."}'; });
    const pe = await hub.prepareEnd();
    check('End prepared: the recap written, the scene named, the steps on', pe.ok && pe.recap === 'Jordan asked Old Marit about the ring; she said it sank with the Kestrel.' && pe.scene.id === 's1' && pe.steps.canon && pe.steps.world && pe.from === 'Day 1', JSON.stringify(pe));
    check('the recap is asked for with the scene\'s brief (kept on the mark, not in a scenario the chat does not have)', !!recapAsked && /The scene's brief:\n\[SCENE BRIEF/.test(recapAsked.user), recapAsked ? recapAsked.user.slice(0, 160) : 'not asked');
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
    check('the second file: the ledger\'s lines, the quests, the done list, the inventory bound to the new chat, the hook store; the brief carries since last time and last time', r.ok && r.file === 'Scene 2 - The customs house' && h.dooms_canon.entries.length === 2 && h.dooms_tracker.quests.main === 'Find the governor\'s ring' && (!h.dooms_inventory || h.dooms_inventory.chat === 'Scene 2 - The customs house') && h.dooms_hub.brief.includes('Since last time:') && h.dooms_hub.brief.includes('Old Marit:') && h.dooms_hub.brief.includes('Last time: Jordan asked Old Marit about the ring') && h.dooms_hub.brief.includes('some days later since the last scene') && h.dooms_hub.brief.includes('When: Day 4, morning'), h.dooms_hub.brief);
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
    // A rename in SillyTavern: the file renamed, the chat in front reloaded under the new name (its mark still naming the old), the event after.
    await hub.openSceneChat('harbourside', 's2');
    files.set('Scene 2 - Renamed', files.get(secondFile)); files.delete(secondFile);
    ctxTarget.chatId = 'Scene 2 - Renamed'; ctxTarget.characters[0].chat = 'Scene 2 - Renamed';
    hub.onHubChatChanged();
    check('reloaded under the new name before the event: the old mark makes it look like a branch', !hub.isScene());
    await hub.onHubChatRenamed({ avatarId: 'Mara Vane.png', groupId: null, oldFileName: `${secondFile}.jsonl`, newFileName: 'Scene 2 - Renamed.jsonl' });
    check('the rename event: the record follows the file, the mark names the new file, the chat is the scene again', hub.worldEntry('harbourside').scenes[1].chat === 'Scene 2 - Renamed' && meta.dooms_hub.file === 'Scene 2 - Renamed' && hub.isScene() && hub.currentScene().scene.id === 's2', JSON.stringify(hub.worldEntry('harbourside').scenes[1].chat));
    secondFile = 'Scene 2 - Renamed';
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

console.log('\n§7 hooks over the memory (§4.4)');
{
    extensionSettings.liveWorld.enabled = true;
    resetMeta(); chat.length = 0; globalThis.__DES_CTX__.chatId = 'chat-h7';
    hub.onHubChatChanged();
    for (const s of hub.worldEntry('harbourside').scenes) if (s.status === 'open') hub.setSceneAside('harbourside', s.id);
    let hooksPrompt = null;
    hub.__setHooksTransport(async (prompt) => { hooksPrompt = prompt; return '{"hooks":[{"title":"The cutter\'s papers","text":"Get a look at the cutter\'s manifest at the customs house before Reyes files it.","grounds":"the blockade","kind":"clock"},{"title":"Marit\'s errand","text":"Carry Old Marit\'s message to the governor\'s house by dusk.","grounds":"Old Marit","kind":"person"}]}'; });
    const r = await hub.proposeHubHooks('harbourside');
    const round = hub.hubHooks('harbourside');
    check('a round asked over the memory: the prompt reads the snapshot and the recaps stand in for recent scenes; two hooks written into the memory, sealed (no reply id)', r.ok && r.hooks.length === 2 && !!hooksPrompt && hooksPrompt.user.includes('Recent scenes') && hooksPrompt.user.includes('World: Harbourside') && round.proposed.length === 2 && round.proposed[0].msgId === null, JSON.stringify(r));
    const ids = round.proposed.map(h => h.id);
    check('a hook set aside leaves the round and is remembered; an unknown id changes nothing', hub.setHubHookAside('harbourside', ids[1]) === true && hub.hubHooks('harbourside').proposed.length === 1 && hub.hubHooks('harbourside').aside.length === 1 && hub.setHubHookAside('harbourside', 'nope') === false);
    hub.__setHooksTransport(async () => 'nothing of the kind');
    const bad = await hub.proposeHubHooks('harbourside');
    check('a reply with no hooks: the round stays, the failure noted', !bad.ok && bad.reason === 'invalid' && hub.hubHooks('harbourside').proposed.length === 1 && hub.hubHooks('harbourside').last.ok === false, JSON.stringify(bad));
    hub.__setOpenersTransport(async () => '{"when":{"date":"Day 5","time":"noon"},"openers":[{"title":"The manifest","text":"The customs house hums with the morning\'s business.","who":["Captain Reyes"]}]}');
    const hook = hub.hubHooks('harbourside').proposed[0];
    const p = await hub.prepareScene({ worldId: 'harbourside', place: { id: 'customs-house' }, cast: ['Captain Reyes'], gap: { id: 'now' }, seed: { kind: 'hook', id: hook.id, label: hook.title, text: hook.text } });
    const c = p.ok ? await hub.commitScene(p.token, { choice: 0 }) : p;
    const saved = c.ok ? files.get(c.file) : null;
    check('played: the hook is the scene\'s quest in the file and leaves the memory\'s round for its taken list', c.ok && !!saved && JSON.stringify(saved.header.chat_metadata.dooms_tracker).includes('manifest') && hub.hubHooks('harbourside').proposed.length === 0 && hub.hubHooks('harbourside').taken.length === 1 && hub.hubHooks('harbourside').taken[0].title === "The cutter's papers", JSON.stringify(c));
}

console.log('\n§8 hooks and Start, the review\'s cases');
{
    // §7 left a scene open. A round is asked with it set aside, then a scene opened over it: hooks over the memory are refused while a scene is open
    // (End writes the chat's stores over the memory, D122), Not this one with them; the Map window serves the open scene's own hooks.
    for (const s of hub.worldEntry('harbourside').scenes) if (s.status === 'open') hub.setSceneAside('harbourside', s.id);
    hub.__setHooksTransport(async () => '{"hooks":[{"title":"The night watch","text":"Find out why the watch doubled on the hill road.","grounds":"the hill","kind":"place"},{"title":"The ledger","text":"Read the customs ledger before it is copied.","grounds":"the blockade","kind":"clock"}]}');
    const asked = await hub.proposeHubHooks('harbourside');
    hub.__setOpenersTransport(async () => '{"when":{"date":"Day 6","time":"dawn"},"openers":[{"title":"The gate","text":"The hill road is quiet at dawn.","who":[]}]}');
    const p0 = await hub.prepareScene({ worldId: 'harbourside', place: { id: 'the-hill' }, cast: [], gap: { id: 'now' } });
    const c0 = p0.ok ? await hub.commitScene(p0.token, { choice: 0 }) : p0;
    const before = JSON.stringify(hub.hubHooks('harbourside'));
    const firstId = hub.hubHooks('harbourside').proposed[0].id;
    hub.__setHooksTransport(async () => '{"hooks":[{"title":"Never offered","text":"This round must not be written.","grounds":"x","kind":"other"}]}');
    const refused = await hub.proposeHubHooks('harbourside');
    check('a scene open: Offer hooks is refused with the scene named, Not this one does nothing, the memory\'s round stands', asked.ok && c0.ok && !refused.ok && refused.reason === 'scene-open' && refused.scene.id === c0.scene.id && hub.setHubHookAside('harbourside', firstId) === false && JSON.stringify(hub.hubHooks('harbourside')) === before, JSON.stringify({ asked, c0, refused }));
    hub.setSceneAside('harbourside', c0.scene.id);
    // A round that lands between a Start's prepare and its commit is in the memory the scene is seeded from and in the memory written back.
    const p1 = await hub.prepareScene({ worldId: 'harbourside', place: { id: 'the-hill' }, cast: [], gap: { id: 'now' } });
    hub.__setHooksTransport(async () => '{"hooks":[{"title":"The cellar door","text":"See what the Anchor keeps behind its cellar door.","grounds":"Old Marit","kind":"person"}]}');
    const landed = await hub.proposeHubHooks('harbourside');
    const c1 = p1.ok ? await hub.commitScene(p1.token, { choice: 0 }) : p1;
    const saved1 = c1.ok ? files.get(c1.file) : null;
    check('a round landing while a Start waits: the scene is seeded with it and the memory keeps it', landed.ok && c1.ok && !!saved1 && saved1.header.chat_metadata.dooms_hooks.proposed.some(h => h.title === 'The cellar door') && hub.hubHooks('harbourside').proposed.some(h => h.title === 'The cellar door'), JSON.stringify({ landed, c1, round: hub.hubHooks('harbourside') }));
    hub.setSceneAside('harbourside', c1.scene.id);
    // Play this on a hook of a round that another round replaced before the commit: recorded as played from the seed, the quest still the scene's.
    const hook = hub.hubHooks('harbourside').proposed.find(h => h.title === 'The cellar door');
    const p2 = await hub.prepareScene({ worldId: 'harbourside', place: { id: 'the-anchor' }, cast: ['Old Marit'], gap: { id: 'now' }, seed: { kind: 'hook', id: hook.id, label: hook.title, text: hook.text } });
    hub.__setHooksTransport(async () => '{"hooks":[{"title":"Another round","text":"Something else entirely.","grounds":"x","kind":"other"}]}');
    const replaced = await hub.proposeHubHooks('harbourside');
    const c2 = p2.ok ? await hub.commitScene(p2.token, { choice: 0 }) : p2;
    const saved2 = c2.ok ? files.get(c2.file) : null;
    const round = hub.hubHooks('harbourside');
    check('a hook the round no longer holds is the scene\'s quest still and under Played in the memory; the new round stays on offer', replaced.ok && c2.ok && !!saved2 && JSON.stringify(saved2.header.chat_metadata.dooms_tracker).includes('cellar door') && round.taken.some(h => h.id === hook.id && h.title === 'The cellar door') && round.proposed.some(h => h.title === 'Another round'), JSON.stringify({ c2, round }));
    hub.setSceneAside('harbourside', c2.scene.id);
    // A world no scene has ended in: a hooks round gives it a memory (the seed with the round), and the next Start's gap does not move it.
    const fresh = hub.worldEntry('elsewhere');
    const noMemory = !!fresh && !fresh.memory;
    hub.__setHooksTransport(async () => '{"hooks":[{"title":"A first errand","text":"Walk the second world\'s one road.","grounds":"the road","kind":"place"}]}');
    const first = await hub.proposeHubHooks('elsewhere');
    let gapCalls = 0;
    hub.__setGapTransport(async () => { gapCalls++; return '{"now":{"date":"Day 9","time":"noon"},"clocks":[],"moved":[]}'; });
    const p3 = await hub.prepareScene({ worldId: 'elsewhere', place: { id: 'the-anchor' }, cast: [], gap: { id: 'later' } });
    const mem = hub.worldEntry('elsewhere').memory;
    check('a world with no memory yet: the hooks round makes one from the seed (takenAt 0) and a Start "later" does not move it before its first scene', noMemory && first.ok && !!mem && mem.takenAt === 0 && hub.hubHooks('elsewhere').proposed.length === 1 && p3.ok && gapCalls === 0, JSON.stringify({ noMemory, first, takenAt: mem && mem.takenAt, p3, gapCalls }));
    hub.cancelStart();
}

console.log('\n§9 a chat already played, taken as where a campaign\'s scenes begin (D131, D172)');
{
    // A long chat on the blank world, with a card of its own, a map the player made, and a Lore Library campaign switched on.
    ctxTarget.characters.push({ name: 'The Redward', avatar: 'The Redward.png', chat: 'The Redward - long' }, { name: 'Third', avatar: 'Third.png', chat: 'Third - plain' });
    const redward = ctxTarget.characters.findIndex(c => c.avatar === 'The Redward.png');
    ctxTarget.characterId = redward;
    ctxTarget.name2 = 'The Redward';
    extensionSettings.lorebook = { enabled: true, campaigns: { camp1: { name: 'First Descent', books: ['FD - Campaign Complete', 'FD - Continuity'] } }, campaignOrder: ['camp1'], activeCampaignId: 'camp1' };
    const long = 'The Redward - long';
    files.set(long, { header: { chat_metadata: {} }, messages: [], avatar: 'The Redward.png', chName: 'The Redward' });
    resetMeta();
    chat.length = 0;
    chat.push(ai('The stair goes down.'));
    ctxTarget.chatId = long;
    await loaders();
    for (let i = 0; i < 4; i++) { chat.push(user(`We go on, landing ${i + 1}.`)); chat.push(ai(`Kiyoha takes the front on landing ${i + 1}. Lysandra reads what is left on her skin.`)); }
    const box = JSON.stringify({ date: { value: 'Day 41' }, time: { start: 'dusk', end: 'night' }, location: { value: 'Hask, the house on the lane' }, weather: { emoji: '🌫', forecast: 'fog off the fells' } });
    state.setLastGeneratedData({ ...state.lastGeneratedData, infoBox: box });
    state.setCommittedTrackerData({ ...state.committedTrackerData, infoBox: box });
    lw.recordCurrentScene();
    meta.dooms_atlas = { scale: 'region', spots: { 'pin:hask': { x: 1, y: 1 } }, made: [{ id: 'pin:hask', label: 'Hask', kind: 'settlement' }] };
    await persistence.saveChatData({ immediate: true });
    const before = lw.getWorldState();
    const storyPlaces = before.visited.map(v => v.id);
    check('the chat as it is: on the blank world named after its card, its places the story\'s own', before.pack === 'blank' && before.name === 'The Redward' && storyPlaces.length >= 1 && storyPlaces.every(id => id.startsWith('loc:')) && !hub.isScene(), JSON.stringify([before.pack, before.name, storyPlaces]));

    const plan = hub.scenesPlan();
    check('what playing it as scenes would do: a new world under the campaign\'s name, the chat\'s card its narrator, nothing replaced', plan.ok && plan.world.made === true && plan.world.id === 'first-descent' && plan.world.name === 'First Descent' && plan.campaign.id === 'camp1' && plan.card.avatar === 'The Redward.png' && plan.replaces === false && plan.scenes === 0, JSON.stringify(plan));
    let asked = null;
    hub.__setRecapTransport(async (p) => { asked = p; return '{"recap":"The company came up from the Fourth Landing with the inkstone; Kiyoha walked out on her own feet."}'; });
    const prep = await hub.prepareAdopt();
    check('the record of the chat so far is written from its last messages, by one request, and nothing is changed yet', prep.ok && prep.recap.startsWith('The company came up') && prep.error === '' && prep.messages === 9 && asked && asked.user.includes('landing 4') && lw.getWorldState().pack === 'blank' && !('first-descent' in extensionSettings.liveWorld.customPacks) && hub.worldEntry('first-descent') === null, JSON.stringify([prep.ok, prep.error, prep.messages]));
    const done = await hub.commitAdopt({ recap: prep.recap });
    const now = lw.getWorldState();
    const pack = lw.getActivePack();
    const entry = hub.worldEntry('first-descent');
    check('taken: the world made under the campaign\'s name with no places of its own, and the chat carried over to it under that name', done.ok && done.made === true && done.worldId === 'first-descent' && done.card === 'The Redward' && done.replaced === false && now.pack === 'first-descent' && now.name === '' && pack.name === 'First Descent' && pack.places.length === 0 && JSON.parse(extensionSettings.liveWorld.customPacks['first-descent']).name === 'First Descent', JSON.stringify(done));
    check('the places the story named stay the story\'s, so the map made of them stands', same(now.visited.map(v => v.id), storyPlaces));
    check('the world\'s entry: narrated by the chat\'s card, the campaign it is the scenes of, the hub can play it', entry.card === 'The Redward.png' && entry.campaign === 'camp1' && hub.hubWorldIds().includes('first-descent') && hub.cardOf('first-descent').name === 'The Redward');
    check('the chat\'s stores as they stand are the world\'s memory, sealed: the world, the map, where the story stopped', entry.memory.scene === 's0' && entry.memory.takenAt > 0 && entry.memory.stores.dooms_world.pack === 'first-descent' && same(entry.memory.stores.dooms_atlas.spots, { 'pin:hask': { x: 1, y: 1 } }) && entry.memory.stores.dooms_atlas.made[0].label === 'Hask' && entry.memory.facts.location === 'Hask, the house on the lane' && entry.memory.facts.date === 'Day 41' && entry.memory.stores.dooms_world.visited.every(v => v.visits.length === 0));
    const copy = files.get(done.backup);
    check('a copy of the chat as it was is saved beside it first: under its card, every message, its world still the blank one, the map in it, no scene\'s mark (D175)', done.backup === 'The Redward - long - before scenes' && !!copy && copy.avatar === 'The Redward.png' && copy.chName === 'The Redward' && copy.messages.length === 9 && copy.messages[8].mes.includes('landing 4') && copy.header.chat_metadata.dooms_world.pack === 'blank' && copy.header.chat_metadata.dooms_world.name === 'The Redward' && same(copy.header.chat_metadata.dooms_atlas.spots, { 'pin:hask': { x: 1, y: 1 } }) && !copy.header.chat_metadata.dooms_hub, JSON.stringify([done.backup, !!copy]));
    check('the chat is kept as scene 0, ended, with its record; it stays an ordinary chat', entry.scenes.length === 1 && entry.scenes[0].id === 's0' && entry.scenes[0].status === 'ended' && entry.scenes[0].chat === long && entry.scenes[0].card === 'The Redward.png' && entry.scenes[0].recap.startsWith('The company came up') && entry.scenes[0].endDate === 'Day 41' && !hub.isScene() && !meta.dooms_hub && hub.currentScene() === null);

    await hub.refreshScenes('first-descent');
    check('the hub\'s look over the chats finds scene 0\'s chat where it is', hub.worldEntry('first-descent').scenes[0].gone === false);
    // The first scene started from it: told what happened, and opening on the player's map.
    let openers = null;
    hub.__setOpenersTransport(async (prompt) => { openers = prompt; return '{"when":{"date":"Day 42","time":"morning"},"openers":[{"title":"The gate","text":"Fog lies on the lane. Kiyoha is already at the gate.","who":["Kiyoha"]},{"title":"The walk","text":"Scrivener\'s Walk is quiet.","who":[]},{"title":"The court","text":"The assay court has sent word.","who":[]}]}'; });
    const p = await hub.prepareScene({ worldId: 'first-descent', place: { id: storyPlaces[0], label: 'Hask' }, cast: ['Kiyoha'], gap: { id: 'now' } });
    const r = p.ok ? await hub.commitScene(p.token, { choice: 0 }) : p;
    const saved = r.ok ? files.get(r.file) : null;
    check('a first scene starts from it: scene 1 on the narrator\'s card, told what happened last time', p.ok && r.ok && r.scene.id === 's1' && saved.avatar === 'The Redward.png' && openers.user.includes('Last scene: The company came up from the Fourth Landing') && saved.header.chat_metadata.dooms_hub.brief.includes('Last time: The company came up'), JSON.stringify([p.ok, p.reason, r.ok, r.reason]));
    check('the scene opens on the player\'s map: the book rides the scene\'s header', !!saved && same(saved.header.chat_metadata.dooms_atlas.spots, { 'pin:hask': { x: 1, y: 1 } }) && saved.header.chat_metadata.dooms_atlas.made[0].label === 'Hask' && saved.header.chat_metadata.dooms_world.pack === 'first-descent');
    check('a scene chat cannot itself be taken', hub.isScene() && hub.scenesPlan().reason === 'scene' && (await hub.commitAdopt({ recap: 'x' })).reason === 'scene');
    // A marker placed during the scene is the world's once the scene ends.
    meta.dooms_atlas = { ...meta.dooms_atlas, spots: { ...meta.dooms_atlas.spots, 'pin:redfall-castle': { x: 4, y: 2 } }, made: [...meta.dooms_atlas.made, { id: 'pin:redfall-castle', label: 'Redfall Castle', kind: 'stronghold' }] };
    chat.push(user('We walk to the gate.'));
    chat.push(ai('Kiyoha laughs and shoulders the axe.'));
    hub.__setRecapTransport(async () => '{"recap":"They met at the gate in the fog."}');
    const pe = await hub.prepareEnd();
    const ce = await hub.commitEnd({ recap: pe.recap, skipCanon: true, skipWorld: true });
    check('what a scene adds to the map is kept when it ends', pe.ok && ce.ok && Object.keys(hub.worldEntry('first-descent').memory.stores.dooms_atlas.spots).length === 2 && hub.worldEntry('first-descent').memory.stores.dooms_atlas.made.some(x => x.label === 'Redfall Castle'), JSON.stringify([pe.ok, pe.reason, ce.ok, ce.reason]));

    // The long chat played on and taken again: the memory is replaced, and only with the player's word.
    await openFile(long);
    const again = hub.scenesPlan();
    check('the long chat is on the campaign\'s world now; taking it again would replace what the scenes remember, and says so', again.ok && again.world.id === 'first-descent' && again.world.made === false && again.replaces === true && again.scenes === 1, JSON.stringify(again));
    const refused = await hub.commitAdopt({ recap: 'The long chat went on.' });
    const mid = hub.worldEntry('first-descent');
    check('without the player\'s word nothing is replaced', refused.ok === false && refused.reason === 'has-memory' && refused.scenes === 1 && mid.memory.scene === 's1' && mid.scenes[0].recap.startsWith('The company came up'));
    const replaced = await hub.commitAdopt({ recap: 'The long chat went on.', replace: true });
    const after = hub.worldEntry('first-descent');
    check('taken again, another copy is saved under a name of its own; the first is left as it was', replaced.backup === 'The Redward - long - before scenes (2)' && files.has(replaced.backup) && files.get('The Redward - long - before scenes').header.chat_metadata.dooms_world.pack === 'blank' && files.get(replaced.backup).header.chat_metadata.dooms_world.pack === 'first-descent');
    check('with it: the memory is the long chat\'s again, scene 0 is rewritten, the scene played since stays in the list', replaced.ok && replaced.replaced === true && replaced.made === false && after.memory.scene === 's0' && Object.keys(after.memory.stores.dooms_atlas.spots).length === 1 && same(after.scenes.map(x => x.id), ['s0', 's1']) && after.scenes[0].recap === 'The long chat went on.' && after.scenes[1].recap === 'They met at the gate in the fog.' && after.card === 'The Redward.png' && after.campaign === 'camp1');

    // The refusals.
    ctxTarget.groupId = 'g1';
    check('a group chat cannot be played as scenes', hub.scenesPlan().reason === 'group');
    ctxTarget.groupId = null;
    extensionSettings.lorebook.activeCampaignId = null;
    ctxTarget.characterId = 0;
    ctxTarget.name2 = 'Mara Vane';
    await openPlain('Mara Vane - another');
    const elsewhereBound = hub.scenesPlan();
    check('a card that narrates another world is not taken for a second one, and the world it narrates is named', elsewhereBound.ok === false && elsewhereBound.reason === 'bound-elsewhere' && elsewhereBound.boundTo === 'harbourside' && elsewhereBound.world.made === true, JSON.stringify(elsewhereBound));
    ctxTarget.characterId = ctxTarget.characters.findIndex(c => c.avatar === 'Third.png');
    ctxTarget.name2 = 'Third';
    await openPlain('Third - plain');
    const own = hub.scenesPlan();
    check('with no campaign switched on, the world is named after the chat\'s own', own.ok && own.campaign === null && own.world.made === true && own.world.name === 'Third' && own.world.id === 'third' && own.card.avatar === 'Third.png', JSON.stringify(own));
    // The copy cannot be saved: nothing is changed.
    hub.__setChatBridge({ saveChatFile: async () => { throw new Error('the disk is full'); } });
    const packsBefore = Object.keys(extensionSettings.liveWorld.customPacks).join();
    const unsaved = await hub.commitAdopt({ recap: 'x' });
    check('when the copy cannot be saved nothing is changed, and it says why', unsaved.ok === false && unsaved.reason === 'backup' && /disk is full/.test(unsaved.errors.join(' ')) && Object.keys(extensionSettings.liveWorld.customPacks).join() === packsBefore && lw.getWorldState().pack === 'blank' && hub.worldEntry('third') === null, JSON.stringify(unsaved));
    hub.__setChatBridge(null);
    extensionSettings.lorebook.activeCampaignId = 'camp1';
    const joins = hub.scenesPlan();
    check('with the campaign on, another chat of it is taken into the campaign\'s world, which keeps its narrator', joins.ok && joins.world.id === 'first-descent' && joins.world.made === false && joins.card.avatar === 'The Redward.png' && joins.replaces === true, JSON.stringify(joins));
    extensionSettings.liveWorld.enabled = false;
    check('with Live World off there is nothing to play as scenes', hub.scenesPlan().reason === 'off' && (await hub.prepareAdopt()).reason === 'off');
    extensionSettings.liveWorld.enabled = true;
    hub.__setRecapTransport(null);
    hub.__setOpenersTransport(null);
}

console.log('\n§10 the world\'s map: carried as it is edited, and edited between scenes (D173)');
{
    const atlasBook = await import(`${DES}/src/systems/features/atlasBook.js`);
    const A = await import(`${DES}/src/utils/atlas.js`);
    const W = 'first-descent';
    const mem = () => hub.worldEntry(W).memory;
    check('an ordinary chat is read as it is', hub.atlasSource().kind === 'chat');
    hub.__setOpenersTransport(async () => '{"when":{"date":"Day 45","time":"morning"},"openers":[{"title":"The lane","text":"The lane is quiet.","who":[]},{"title":"b","text":"Second.","who":[]},{"title":"c","text":"Third.","who":[]}]}');
    hub.__setRecapTransport(async () => '{"recap":"A quiet scene on the lane."}');
    const start = async () => { const p = await hub.prepareScene({ worldId: W, place: { label: 'Hask' }, cast: [], gap: { id: 'now' } }); return p.ok ? hub.commitScene(p.token, { choice: 0 }) : p; };
    const s2 = await start();
    const taken = mem().takenAt;
    check('a scene being played is read as it is, too', s2.ok && s2.scene.id === 's2' && hub.atlasSource().kind === 'chat' && same(atlasBook.getBook().spots, mem().stores.dooms_atlas.spots), JSON.stringify([s2.ok, s2.reason]));
    atlasBook.setBook(A.placeAt(atlasBook.getBook(), 'pin:hask', { x: 5, y: 5 }));
    check('a marker moved in the scene being played is the world\'s at once; the memory\'s date does not move, so no scene goes stale by it', same(mem().stores.dooms_atlas.spots['pin:hask'], { x: 5, y: 5 }) && same(meta.dooms_atlas.spots['pin:hask'], { x: 5, y: 5 }) && mem().takenAt === taken && mem().scene === 's0');
    const held = hub.setWorldBook(W, A.placeAt(null, 'pin:hask', { x: 9, y: 9 }));
    check('while a scene is open the world\'s own copy is not edited from outside it: the scene\'s chat holds the live map', held.ok === false && held.reason === 'scene-open' && held.scene.id === 's2' && same(mem().stores.dooms_atlas.spots['pin:hask'], { x: 5, y: 5 }));
    hub.setSceneAside(W, 's2');
    atlasBook.setBook(A.placeAt(atlasBook.getBook(), 'pin:hask', { x: 6, y: 6 }));
    check('a scene set aside keeps its edits to itself', same(mem().stores.dooms_atlas.spots['pin:hask'], { x: 5, y: 5 }) && same(meta.dooms_atlas.spots['pin:hask'], { x: 6, y: 6 }));
    await hub.resumeScene(W, 's2');
    atlasBook.setBook(A.placeAt(atlasBook.getBook(), 'pin:hask', { x: 7, y: 7 }));
    check('resumed, they are the world\'s again', same(mem().stores.dooms_atlas.spots['pin:hask'], { x: 7, y: 7 }));

    chat.push(user('We wait on the lane.'));
    chat.push(ai('Nothing stirs.'));
    const pe = await hub.prepareEnd();
    const ce = await hub.commitEnd({ recap: pe.recap, skipCanon: true, skipWorld: true });
    const src = hub.atlasSource();
    check('ended: the chat in front is one the world has moved on from, and the Atlas is to read the world\'s memory', pe.ok && ce.ok && src.kind === 'world' && src.worldId === W && src.scene === 's2' && src.open === null && src.memory.scene === 's2' && same(src.memory.stores.dooms_atlas.spots['pin:hask'], { x: 7, y: 7 }), JSON.stringify([pe.ok, ce.ok, src.kind]));
    const between = A.placeAt(mem().stores.dooms_atlas, 'pin:redfall-castle', { x: -4, y: 3 });
    const before = mem().takenAt;
    const put = hub.setWorldBook(W, { ...between, junk: 1 });
    check('between scenes the world\'s own map is edited: made safe, the memory\'s date unmoved, the ended chat\'s copy left as it was', put.ok && same(mem().stores.dooms_atlas.spots['pin:redfall-castle'], { x: -4, y: 3 }) && !('junk' in mem().stores.dooms_atlas) && mem().takenAt === before && !meta.dooms_atlas.spots['pin:redfall-castle']);
    check('a world with no memory has no map of its own to edit', hub.setWorldBook('harbourside-x', {}).reason === 'no-memory' && hub.setWorldBook('', {}).reason === 'no-memory');
    const ended2 = ctxTarget.chatId;
    const s3 = await start();
    check('the next scene opens on the map as it was left between scenes', s3.ok && s3.scene.id === 's3' && same(files.get(s3.file).header.chat_metadata.dooms_atlas.spots['pin:redfall-castle'], { x: -4, y: 3 }) && same(atlasBook.getBook().spots['pin:hask'], { x: 7, y: 7 }));
    await openFile(ended2);
    const behind = hub.atlasSource();
    check('an ended scene\'s chat, with a later scene open: the memory is shown and the open scene named, and the map is that scene\'s to edit', behind.kind === 'world' && behind.open && behind.open.id === 's3' && hub.setWorldBook(W, {}).reason === 'scene-open');
    // A scene the memory has moved past keeps its edits to itself (its End would keep the newer memory, D123).
    await openFile(s3.file);
    chat.push(user('On.'));
    chat.push(ai('On.'));
    const pe3 = await hub.prepareEnd();
    await hub.commitEnd({ recap: pe3.recap, skipCanon: true, skipWorld: true });
    await openFile(ended2);
    await hub.reopenCurrentScene();
    const spot = mem().stores.dooms_atlas.spots['pin:hask'];
    atlasBook.setBook(A.placeAt(atlasBook.getBook(), 'pin:hask', { x: -9, y: -9 }));
    check('a scene reopened after the world moved past it does not write its map over the world\'s', hub.currentScene().scene.status === 'open' && hub.atlasSource().kind === 'chat' && same(mem().stores.dooms_atlas.spots['pin:hask'], spot) && same(meta.dooms_atlas.spots['pin:hask'], { x: -9, y: -9 }));
    hub.__setRecapTransport(null);
    hub.__setOpenersTransport(null);
}

console.log('\n§11 where a scene can be started from (D174)');
{
    const W = 'first-descent';
    // §10 left scene 2 reopened and in front, scene 3 ended after it.
    const playing = hub.sceneStartPlan();
    check('in a scene being played no other is started: it is ended first, and the plan names it', playing.ok === false && playing.reason === 'scene-open' && playing.scene.id === 's2', JSON.stringify(playing));
    hub.__setRecapTransport(async () => '{"recap":"Back on the lane."}');
    const pe = await hub.prepareEnd();
    await hub.commitEnd({ recap: pe.recap, skipCanon: true, skipWorld: true, replaceMemory: false });
    const after = hub.sceneStartPlan();
    check('between scenes one can be: in the world of the ended scene in front, numbered next, on the narrator\'s card', after.ok && after.worldId === W && after.number === 4 && after.card === 'The Redward', JSON.stringify(after));
    await openFile('The Redward - long');
    const fromLong = hub.sceneStartPlan();
    check('from the chat the scenes began from, too', fromLong.ok && fromLong.worldId === W && fromLong.number === 4, JSON.stringify(fromLong));
    ctxTarget.characterId = 0;
    ctxTarget.name2 = 'Mara Vane';
    await openPlain('Mara Vane - plain two');
    const plain = hub.sceneStartPlan();
    check('a chat whose world is not played as scenes has none to start (it has Play as scenes)', plain.ok === false && plain.reason === 'not-scenes', JSON.stringify(plain));
    extensionSettings.liveWorld.enabled = false;
    check('nor with Live World off', hub.sceneStartPlan().reason === 'off');
    extensionSettings.liveWorld.enabled = true;
    hub.__setRecapTransport(null);
}

console.log('\n§12 the openings are written with the people\'s lorebook entries (D177)');
{
    const W = 'first-descent';
    const books = {
        'FD - Campaign Complete': { entries: {
            11: { uid: 11, key: ['Kiyoha', 'oni'], comment: 'Kiyoha — who she is', content: 'KIYOHA — the company\'s front line. Big, loud, quick to laugh and quicker to temper; sings badly on the stair.', order: 90 },
            12: { uid: 12, key: ['Lysandra'], comment: 'Lysandra — who she is', content: 'LYSANDRA — the company\'s mage. Cool, composed; asks questions like an examiner.', order: 90 },
            16: { uid: 16, key: ['Jordan'], comment: 'FD: JORDAN — the healer', content: 'Jordan is the company\'s new healer, and nobody wanted him.', order: 100 },
        } },
        'FD - Continuity': { entries: { 0: { uid: 0, key: [], comment: 'STORY CANON', content: 'STYLE LAW: "sweetheart" is banned. RULING: the tests are over.', constant: true, order: 100 } } },
    };
    const read = [];
    hub.__setLoreReader(async (book) => { read.push(book); if (book === 'FD - Continuity' && read.filter(b => b === book).length === 2) throw new Error('the file is locked'); return books[book] || null; });
    let asked = null;
    hub.__setOpenersTransport(async (prompt) => { asked = prompt; return '{"when":{"date":"Day 46","time":"dawn"},"openers":[{"title":"a","text":"Kiyoha is singing, badly, at the gate.","who":["Kiyoha"]},{"title":"b","text":"Second.","who":[]},{"title":"c","text":"Third.","who":[]}]}'; });
    const p = await hub.prepareScene({ worldId: W, place: { label: 'Hask' }, cast: ['Kiyoha', 'Dagger'], gap: { id: 'now' } });
    check('the world\'s campaign\'s books are read, and each person\'s own entry goes to the request under their name, with the player\'s own and the standing notes', p.ok && same(read, ['FD - Campaign Complete', 'FD - Continuity']) && asked.user.includes('[Kiyoha] KIYOHA — the company\'s front line') && asked.user.includes('sings badly on the stair') && asked.user.includes('[Jordan] Jordan is the company\'s new healer') && asked.user.includes('The story\'s standing notes:\nSTORY CANON: STYLE LAW: "sweetheart" is banned') && !asked.user.includes('LYSANDRA') && /no two of them sound alike/.test(asked.system), JSON.stringify([p.ok, p.reason, read]));
    check('the Start knows whose entries were found and who had none', same(p.lore.found, ['Kiyoha']) && same(p.lore.missing, ['Dagger']) && p.lore.standing === true && same(p.lore.books, ['FD - Campaign Complete', 'FD - Continuity']) && same(hub.pendingStart().lore, p.lore));
    hub.cancelStart();
    const p2 = await hub.prepareScene({ worldId: W, place: { label: 'Hask' }, cast: ['Lysandra'], gap: { id: 'now' } });
    check('a book that cannot be read is passed over: the scene still starts, with what the others hold', p2.ok && asked.user.includes('[Lysandra] LYSANDRA') && !asked.user.includes('standing notes') && same(p2.lore.books, ['FD - Campaign Complete']) && p2.lore.standing === false);
    hub.cancelStart();
    const p3 = await hub.prepareScene({ worldId: 'harbourside', place: { id: 'the-anchor' }, cast: ['Old Marit'], gap: { id: 'now' } });
    check('a world that is no campaign\'s reads none here, and its openings are asked for as before', (p3.ok || p3.reason === 'scene-open') && (!p3.ok || (!asked.user.includes('Their own notes') && same(p3.lore.books, []))), JSON.stringify([p3.ok, p3.reason]));
    hub.cancelStart();
    hub.__setLoreReader(null);
    hub.__setOpenersTransport(null);
}

console.log('\n§13 a scene holds the world still: it moves when the scene ends (D178)');
{
    const W = 'first-descent';
    const every = extensionSettings.liveWorld.every;
    extensionSettings.liveWorld.every = 2;
    let runs = 0;
    lw.__setWorldTransport(async () => { runs++; return '{"now":{"date":"Day 60","time":"noon"},"clocks":[],"moved":[],"news":[]}'; });
    const reply = async (text) => { chat.push(user('And then?')); chat.push(ai(text)); lw.onWorldMessageReceived(chat.length - 1); };
    // A long chat: the world moves every few replies, as it always has.
    ctxTarget.characterId = 0;
    ctxTarget.name2 = 'Mara Vane';
    await openPlain('Mara Vane - long three');
    await reply('One.');
    await reply('Two.');
    await wait(700);
    check('in a long chat the world still moves by the count of replies', lw.inScene() === false && runs === 1, `runs ${runs}`);
    // A scene: the same count is reached and nothing moves.
    hub.__setOpenersTransport(async () => '{"when":{"date":"Day 61","time":"morning"},"openers":[{"title":"a","text":"First.","who":[]},{"title":"b","text":"Second.","who":[]},{"title":"c","text":"Third.","who":[]}]}');
    const p = await hub.prepareScene({ worldId: W, place: { label: 'Hask' }, cast: [], gap: { id: 'now' } });
    const r = p.ok ? await hub.commitScene(p.token, { choice: 0 }) : p;
    runs = 0;
    await reply('One.');
    await reply('Two.');
    await reply('Three.');
    await wait(700);
    check('in a scene the replies are counted and the world is held: the party is in the scene, and nothing of what moves elsewhere reaches it', r.ok && lw.inScene() === true && runs === 0 && lw.getWorldState().sinceLast >= 2, JSON.stringify([r.ok, r.reason, runs, lw.getWorldState() && lw.getWorldState().sinceLast]));
    check('an advance armed by the count is refused in a scene; one asked for by hand still runs', (await lw.advanceNow({ reason: 'count' })).reason === 'scene' && (await lw.advanceNow({ reason: 'manual' })).ok !== undefined && runs === 1, `runs ${runs}`);
    // End: this is when the world moves.
    let gapRuns = 0;
    hub.__setGapTransport(async () => { gapRuns++; return '{"elapsed":"a day","now":{"date":"Day 61","time":"dusk"},"clocks":{},"moved":[],"blurb":"Word of the assay court reaches the lane.","heard":[]}'; });
    hub.__setRecapTransport(async () => '{"recap":"A day in Hask."}');
    const pe = await hub.prepareEnd();
    const ce = await hub.commitEnd({ recap: pe.recap, skipCanon: true });
    check('the world moves when the scene ends: one run, over the world\'s memory, and what moved is there to be read between scenes', pe.ok && ce.ok && ce.world === 'ok' && gapRuns === 1 && hub.atlasSource().kind === 'world' && hub.atlasSource().memory.stores.dooms_world.blurb === 'Word of the assay court reaches the lane.', JSON.stringify([pe.ok, ce.ok, ce.world, gapRuns]));
    check('an ended scene\'s chat is still a scene\'s: nothing moves by the count there either', lw.inScene() === true);
    extensionSettings.liveWorld.every = every;
    lw.__setWorldTransport(null);
    hub.__setGapTransport(null);
    hub.__setRecapTransport(null);
    hub.__setOpenersTransport(null);
}

console.log(failures ? `\n${failures} FAILED` : '\nall pass');
process.exit(failures ? 1 : 0);
