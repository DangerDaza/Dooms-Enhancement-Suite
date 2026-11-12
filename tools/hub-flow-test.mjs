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
    + '\nexport let is_send_press = false;\nexport const __setSendPress = (v) => { is_send_press = v; };\n'
    // SillyTavern's own record of the card in front (what a reload comes back to), told by name (D202).
    + 'export const setActiveCharacter = (a) => { (globalThis.__DES_ACTIVE__ = globalThis.__DES_ACTIVE__ || []).push(a); };\n';
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
    if (url === '/api/chats/delete') {
        // SillyTavern's own route: the file named with its extension, under the card's avatar; 400 when it is not there.
        const name = String(body.chatfile || '').replace(/\.jsonl$/i, '');
        const f = files.get(name);
        if (globalThis.__DES_DELETE_FAILS__ || !f || f.avatar !== body.avatar_url) return { ok: false, status: 400, json: async () => ({}), text: async () => '' };
        files.delete(name);
        opens.push(`delete:${name}`);
        return { ok: true, status: 200, json: async () => ({ ok: true }), text: async () => '' };
    }
    if (url === '/api/characters/merge-attributes') {
        const card = ctxTarget.characters.find(c => c.avatar === body.avatar);
        if (!card) return { ok: false, status: 400, json: async () => ({}), text: async () => '' };
        opens.push(`point:${body.avatar}:${body.chat}`);
        return { ok: true, status: 200, json: async () => ({}), text: async () => '' };
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
const hubUtils = await import(`${DES}/src/utils/hub.js`);

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
hub.__setHubTiming({ idleStepMs: 5, idleMaxMs: 200, retryMs: 10, rateMs: 120 });
// The lorebooks, as SillyTavern keeps them (D189): a shelf of books by name, the ones switched on, and what was filed where.
// A book filed with a campaign is switched on only while `campaignOn` says the campaign is (it is off until §17).
const shelf = new Map();
const booksOn = new Set();
const filed = [];
let campaignOn = false;
hub.__setBookApi({
    names: async () => [...shelf.keys()],
    load: async (name) => shelf.get(name) || null,
    save: async (name, data) => { shelf.set(name, data); },
    create: async (name) => { shelf.set(name, { entries: {} }); },
    entry: async (name, data) => { const ids = Object.keys(data.entries).map(Number); const uid = ids.length ? Math.max(...ids) + 1 : 0; data.entries[uid] = { uid, key: [], keysecondary: [], comment: '', content: '', constant: false, disable: false, order: 100, position: 0 }; return data.entries[uid]; },
    active: async (name) => booksOn.has(name),
    file: async (campaignId, name) => { filed.push([campaignId || '', name]); if (campaignId && extensionSettings.lorebook && extensionSettings.lorebook.campaigns[campaignId]) extensionSettings.lorebook.campaigns[campaignId].books.push(name); if (!campaignId || campaignOn) booksOn.add(name); },
});
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
    {
        const m = hub.sceneMenu();
        check('the scene in front for the Doom button\'s menu (D200): its number, where it is, how long it has run, Continue fresh and End scene', !!m && m.label === 'Scene 1' && m.line.startsWith('Scene 1') && m.where === 'The Anchor, a tavern · Day 1 · 3 messages' && same(m.items.map(x => x.id), ['continue', 'end']) && m.busy === false && m.long === false && typeof hub.continueFresh === 'function', JSON.stringify(m));
    }
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
    check('ended, the menu offers Continue fresh and Reopen in End\'s place', hub.sceneMenu().ended === true && same(hub.sceneMenu().items.map(x => x.id), ['continue', 'reopen']) && /\(ended\)$/.test(hub.sceneMenu().line));
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
    hub.__setRecapTransport(async (p) => { asked = p; return '{"recap":"The company came up from the Fourth Landing with the inkstone; Kiyoha walked out on her own feet.","people":[{"name":"Kiyoha","now":"In Hask, on her own feet again; owes Jordan for the carry out."},{"name":"Jordan","now":"never told of"}],"threads":{"closed":[],"opened":["The inkstone has not been assayed yet."]}}'; });
    const prep = await hub.prepareAdopt();
    check('the same request says where the chat\'s people stand and what it has left open (D188), for the panel to show', prep.ok && /"people": \[\{"name"/.test(asked.system) && same(prep.continuity.people.map(x => x.name), ['Kiyoha']) && same(prep.continuity.opened.map(x => x.text), ['The inkstone has not been assayed yet.']) && prep.continuity.closed.length === 0, JSON.stringify(prep.continuity));
    check('the record of the chat so far is written from its last messages, by one request, and nothing is changed yet', prep.ok && prep.recap.startsWith('The company came up') && prep.error === '' && prep.messages === 9 && asked && asked.user.includes('landing 4') && lw.getWorldState().pack === 'blank' && !('first-descent' in extensionSettings.liveWorld.customPacks) && hub.worldEntry('first-descent') === null, JSON.stringify([prep.ok, prep.error, prep.messages]));
    const done = await hub.commitAdopt({ recap: prep.recap, continuity: { people: prep.continuity.people.map(x => ({ name: x.name, now: x.now })), opened: prep.continuity.opened.map(x => x.text), closed: [] } });
    check('taken with them, they are the world\'s first continuity, from scene 0', done.ok && same(done.continuity, { people: 1, opened: 1, closed: 0 }) && hub.worldEntry('first-descent').continuity.people[0].name === 'Kiyoha' && hub.worldEntry('first-descent').continuity.people[0].scene === 's0' && hub.worldEntry('first-descent').continuity.threads[0].text === 'The inkstone has not been assayed yet.', JSON.stringify(hub.worldEntry('first-descent') && hub.worldEntry('first-descent').continuity));
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
    check('SillyTavern is told the scene\'s card is the one in front, so a reload comes back to the scene (D202)', (globalThis.__DES_ACTIVE__ || []).includes('The Redward.png'), JSON.stringify(globalThis.__DES_ACTIVE__));
    check('a first scene starts from it: scene 1 on the narrator\'s card, told what happened last time', p.ok && r.ok && r.scene.id === 's1' && saved.avatar === 'The Redward.png' && openers.user.includes('Last scene: The company came up from the Fourth Landing') && saved.header.chat_metadata.dooms_hub.brief.includes('Last time: The company came up'), JSON.stringify([p.ok, p.reason, r.ok, r.reason]));
    check('the scene opens on the player\'s map: the book rides the scene\'s header', !!saved && same(saved.header.chat_metadata.dooms_atlas.spots, { 'pin:hask': { x: 1, y: 1 } }) && saved.header.chat_metadata.dooms_atlas.made[0].label === 'Hask' && saved.header.chat_metadata.dooms_world.pack === 'first-descent');
    check('a scene chat cannot itself be taken', hub.isScene() && hub.scenesPlan().reason === 'scene' && (await hub.commitAdopt({ recap: 'x' })).reason === 'scene');
    // A marker placed during the scene is the world's once the scene ends.
    meta.dooms_atlas = { ...meta.dooms_atlas, spots: { ...meta.dooms_atlas.spots, 'pin:redfall-castle': { x: 4, y: 2 } }, made: [...meta.dooms_atlas.made, { id: 'pin:redfall-castle', label: 'Redfall Castle', kind: 'stronghold' }] };
    chat.push(user('We walk to the gate.'));
    chat.push(ai('Kiyoha laughs and shoulders the axe.'));
    hub.__setRecapTransport(async () => '{"recap":"They met at the gate in the fog."}');
    const endSteps = [];
    const pe = await hub.prepareEnd({ onStep: (g) => endSteps.push(g) });
    check('End says which request its record is on, for the sheet\'s bar (D198)', endSteps.length === 1 && endSteps[0].page === 1 && endSteps[0].pages === 1 && same(endSteps[0].states, ['run']), JSON.stringify(endSteps));
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
    check('a chat that is no scene has no entry in the Doom button\'s menu', hub.currentScene() === null && hub.sceneMenu() === null);
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

console.log('\n§14 the style law: what the narrator leaned on is held against the next scenes (D179)');
{
    const W = 'first-descent';
    hub.__setOpenersTransport(async (p) => { openersAsked = p; return '{"when":{"date":"Day 62","time":"morning"},"openers":[{"title":"a","text":"The lane, again.","who":[]},{"title":"b","text":"Second.","who":[]},{"title":"c","text":"Third.","who":[]}]}'; });
    let openersAsked = null;
    hub.__setRecapTransport(async () => '{"recap":"A scene of habits."}');
    const start = async () => { const p = await hub.prepareScene({ worldId: W, place: { label: 'Hask' }, cast: ['Kiyoha', 'Lysandra'], gap: { id: 'now' } }); return p.ok ? hub.commitScene(p.token, { choice: 0 }) : p; };
    // Off, as it is until switched on (D180): nothing is counted, nothing is held, the narrator is told nothing.
    check('the count of repeated phrases is off until it is switched on', hub.isStyleLawOn() === false);
    const s0 = await start();
    for (let i = 0; i < 4; i++) { chat.push(user(`Well, ${i}?`)); chat.push(ai(`"Step ${['up', 'down', 'back', 'in'][i]}, sweetheart," she says, with a slight knowing smile.`)); }
    const pe0 = await hub.prepareEnd();
    const ce0 = await hub.commitEnd({ recap: pe0.recap, skipCanon: true, skipWorld: true, bans: [{ phrase: 'sweetheart', kind: 'address', count: 4 }] });
    check('off: End counts nothing and shows no list, and holds nothing against the next scene even when handed phrases', s0.ok && pe0.ok && pe0.style === null && ce0.ok && ce0.style === undefined && hub.worldEntry(W).style.bans.length === 0, JSON.stringify([pe0.style, ce0.style, hub.worldEntry(W).style]));
    extensionSettings.hub.styleLaw = true;
    check('switched on in the settings, it is on', hub.isStyleLawOn() === true);
    const s1 = await start();
    check('a world with no law yet starts a scene with none in its brief or its openings', s1.ok && !meta.dooms_hub.brief.includes('Style law') && !/Style law/.test(openersAsked.system), JSON.stringify([s1.ok, s1.reason]));
    const who = ['Kiyoha', 'Lysandra'];
    const stock = ['turns with a slight knowing smile', 'answers with a slight knowing smile', 'hides a slight knowing smile', 'wears a slight knowing smile'];
    for (let i = 0; i < 8; i++) { chat.push(user(`Go on, ${i}.`)); chat.push(ai(`${who[i % 2]} ${stock[i % 4]}. "Step ${['up', 'down', 'back', 'in', 'out', 'over', 'aside', 'through'][i]}, sweetheart," she says.`)); }
    const pe = await hub.prepareEnd();
    const counted = Object.fromEntries(pe.style.phrases.map(p => [p.phrase, p]));
    check('End counts what the narrator leaned on in the scene, in code: the pet name everyone uses and the stock gesture, both chosen by themselves', pe.ok && pe.style.messages === 9 && counted.sweetheart && counted.sweetheart.kind === 'address' && counted.sweetheart.count === 8 && counted.sweetheart.ticked && counted['slight knowing smile'] && counted['slight knowing smile'].count === 8 && counted['slight knowing smile'].ticked && !pe.style.phrases.some(p => /kiyoha|lysandra/.test(p.phrase)), JSON.stringify(pe.style));
    const ce = await hub.commitEnd({ recap: pe.recap, skipCanon: true, skipWorld: true, bans: [{ phrase: 'sweetheart', kind: 'address', count: 8 }] });
    const law = hub.worldEntry(W).style;
    check('the phrases ticked on the sheet are the world\'s law; one left unticked is not', ce.ok && ce.style === 1 && same(law.bans.map(b => [b.phrase, b.kind, b.count, b.idle]), [['sweetheart', 'address', 8, 0]]), JSON.stringify(law));
    const s2 = await start();
    check('the next scene is told: its brief carries the law, and so does the request for its openings', s2.ok && meta.dooms_hub.brief.includes('Style law: the narration leaned on these and does not use them again: "sweetheart" as a way of addressing anyone.') && openersAsked.system.includes('"sweetheart" as a way of addressing anyone') && /no pet name or gesture is shared between them/.test(openersAsked.system), meta.dooms_hub && meta.dooms_hub.brief.slice(-260));
    for (let i = 0; i < 4; i++) { chat.push(user(`And ${i}?`)); chat.push(ai(`${who[i % 2]} ${stock[i % 4]} and says nothing.`)); }
    const pe2 = await hub.prepareEnd();
    const ce2 = await hub.commitEnd({ recap: pe2.recap, skipCanon: true, skipWorld: true });    // no sheet: End chooses by itself
    const law2 = hub.worldEntry(W).style;
    check('ended with no sheet, End chooses by itself: the stock gesture joins the law, whole and once; the pet name, not used this scene, has been idle one', ce2.ok && law2.bans.length === 2 && /slight knowing smile/.test(law2.bans[0].phrase) && law2.bans[0].idle === 0 && same([law2.bans[1].phrase, law2.bans[1].idle], ['sweetheart', 1]), JSON.stringify(law2));
    check('the law is the narrator\'s habit, not the world\'s memory: it is kept on the world\'s entry and no chat carries it', !('style' in hub.worldEntry(W).memory.stores) && !meta.dooms_style);
    // Switched off again: the list it made is kept where it is, and no scene is told of it.
    extensionSettings.hub.styleLaw = false;
    const s3 = await start();
    check('switched off again: the next scene is told nothing of the list, in its brief or its openings; the list itself is left as it was', s3.ok && !meta.dooms_hub.brief.includes('Style law') && !/Style law/.test(openersAsked.system) && same(hub.worldEntry(W).style, law2), JSON.stringify([s3.ok, s3.reason]));
    const pe3 = await hub.prepareEnd();
    await hub.commitEnd({ recap: pe3.recap, skipCanon: true, skipWorld: true });
    check('and ending a scene while it is off neither counts nor ages the list', pe3.style === null && same(hub.worldEntry(W).style, law2));
    hub.__setRecapTransport(null);
    hub.__setOpenersTransport(null);
}

console.log('\n§15 going straight on in a fresh chat (D181)');
{
    const W = 'first-descent';
    let openersAsked = null;
    let openerReply = '{"when":{"date":"Day 62","time":"dusk"},"openers":[{"title":"On the stair","text":"Kiyoha is still laughing when the lamp gutters.","who":["Kiyoha"]},{"title":"b","text":"Second.","who":[]},{"title":"c","text":"Third.","who":[]}]}';
    hub.__setOpenersTransport(async (p) => { openersAsked = p; return openerReply; });
    let recapReply = '{"recap":"They went down to the third landing; Kiyoha took the front."}';
    hub.__setRecapTransport(async () => recapReply);
    let gapRuns = 0;
    hub.__setGapTransport(async () => { gapRuns++; return '{"elapsed":"a day","now":{"date":"Day 63","time":"dawn"},"clocks":{},"moved":[],"blurb":"x","heard":[]}'; });
    // §14 left an ended scene in front: going on from it starts the next and ends nothing.
    const before = hub.worldEntry(W).scenes.length;
    const steps0 = [];
    const c0 = await hub.continueScene({ onStep: (w) => steps0.push(w) });
    check('from a scene that has ended already, the next is opened straight on and nothing is ended again', c0.ok && c0.stage === 'start' && hub.worldEntry(W).scenes.length === before + 1 && same(steps0, ['Writing how the next scene opens…', 'Opening the next scene…']) && hub.isScene() && !hub.currentScene().ended, JSON.stringify([c0, steps0]));
    // Played on: the tracker says where the story is and who is there now.
    const box = JSON.stringify({ date: { value: 'Day 62' }, time: { start: 'dusk', end: 'night' }, location: { value: 'The Black Stair, third landing' }, weather: { emoji: '🕯', forecast: 'still air' } });
    const thoughts = JSON.stringify({ characters: [{ name: 'Kiyoha', emoji: '🪓', thoughts: { content: 'x' } }, { name: 'Lysandra', emoji: '🦊', thoughts: { content: 'y' } }, { name: 'Jordan', emoji: '🙂', thoughts: { content: 'z' } }] });
    for (let i = 0; i < 3; i++) { chat.push(user(`Down, ${i}.`)); chat.push(ai(`Landing ${i + 1}. Kiyoha takes the front.${i === 2 ? ' "Well? Are you coming, healer?"' : ''}`)); }
    state.setLastGeneratedData({ ...state.lastGeneratedData, infoBox: box, characterThoughts: thoughts });
    state.setCommittedTrackerData({ ...state.committedTrackerData, infoBox: box, characterThoughts: thoughts });
    const len = hub.sceneLengthNow();
    check('the scene in front knows how long it has run and whether that is long enough for a fresh chat', len.count === 7 && len.nudgeAt === 60 && len.long === false && len.ended === false, JSON.stringify(len));
    extensionSettings.hub.nudgeAt = 5;
    check('past the length the player set, it is', hub.sceneLengthNow().long === true);
    extensionSettings.hub.nudgeAt = 60;
    const playedFile = ctxTarget.chatId;
    const playedId = hub.currentScene().mark.scene;
    const steps = [];
    gapRuns = 0;
    const c = await hub.continueScene({ onStep: (w) => steps.push(w) });
    const entry = hub.worldEntry(W);
    const prev = entry.scenes.find(x => x.id === playedId);
    const nextScene = entry.scenes[entry.scenes.length - 1];
    check('one go: the scene is ended with its record and the next is opened, each step said', c.ok && same(steps, ['Writing the record of the scene…', 'Remembering the scene…', 'Writing how the next scene opens…', 'Opening the next scene…']) && prev.status === 'ended' && prev.recap.startsWith('They went down to the third landing') && nextScene.status === 'open' && nextScene.id !== playedId && ctxTarget.chatId === c.file && ctxTarget.chatId !== playedFile, JSON.stringify([c, steps]));
    check('no time passes, so the world is not moved', gapRuns === 0);
    check('the next scene is where the story stood and with who was there, not where the last one began', meta.dooms_hub.place.label === 'The Black Stair, third landing' && same(meta.dooms_hub.cast, ['Kiyoha', 'Lysandra']) && meta.dooms_hub.gap.id === 'now', JSON.stringify([meta.dooms_hub.place, meta.dooms_hub.cast]));
    check('its opening is asked for as going straight on, with the words the last scene stopped on and the record of it', openersAsked.user.includes('What brought us here: The story goes straight on from the moment the last scene stopped') && openersAsked.user.includes('"Well? Are you coming, healer?"') && openersAsked.user.includes('this scene opens right after') && openersAsked.user.includes('Last scene: They went down to the third landing'), openersAsked.user.slice(0, 900));
    check('the first opening is the first message and the other two are its swipes', chat.length === 1 && chat[0].mes.startsWith('Kiyoha is still laughing') && chat[0].swipes.length === 3);
    // The record cannot be written: nothing is ended, and the End sheet is the way.
    chat.push(user('On.'));
    chat.push(ai('On, then.'));
    recapReply = '';
    const stuck = await hub.continueScene({});
    check('when the record cannot be written nothing is ended and nothing is started', stuck.ok === false && stuck.stage === 'end' && stuck.reason === 'no-recap' && hub.currentScene().ended === false && hub.worldEntry(W).scenes.length === entry.scenes.length);
    // No opening comes back: the scene is ended, the next is not started.
    recapReply = '{"recap":"On they went."}';
    openerReply = 'I would rather not.';
    const half = await hub.continueScene({});
    check('when no opening comes back the scene is ended and remembered, and the next is left to be started from the map', half.ok === false && half.stage === 'start' && half.reason === 'openers' && hub.currentScene().ended === true && hub.pendingStart() === null && hub.sceneStartPlan().ok === true, JSON.stringify(half));
    ctxTarget.characterId = 0;
    ctxTarget.name2 = 'Mara Vane';
    await openPlain('Mara Vane - plain four');
    check('a chat that is no scene has nothing to go on from, and no length', (await hub.continueScene({})).reason === 'not-scene' && hub.sceneLengthNow() === null);
    hub.__setRecapTransport(null);
    hub.__setOpenersTransport(null);
    hub.__setGapTransport(null);
}

console.log('\n§16 where the people stand and the open threads: written with the record, kept, told to the next scene (D188)');
{
    const W = 'first-descent';
    extensionSettings.hub.styleLaw = false;
    const utils = await import(`${DES}/src/utils/hub.js`);
    let openersAsked = null;
    hub.__setOpenersTransport(async (p) => { openersAsked = p; return '{"when":{"date":"Day 63","time":"morning"},"openers":[{"title":"a","text":"The lane, again.","who":[]},{"title":"b","text":"Second.","who":[]},{"title":"c","text":"Third.","who":[]}]}'; });
    const recapsAsked = [];
    let recapReply = () => '{"recap":"x"}';
    hub.__setRecapTransport(async (p) => { recapsAsked.push(p); return recapReply(p, recapsAsked.length); });
    hub.__setGapTransport(async () => '{"elapsed":"a day","now":{"date":"Day 64","time":"dawn"},"clocks":{},"moved":[],"blurb":"x","heard":[]}');
    const start = async (cast = ['Kiyoha', 'Lysandra']) => { const p = await hub.prepareScene({ worldId: W, place: { label: 'Hask' }, cast, gap: { id: 'now' } }); return p.ok ? { ...(await hub.commitScene(p.token, { choice: 0 })), prep: p } : p; };
    const cont = () => hub.worldEntry(W).continuity;
    extensionSettings.hub.worlds[W].continuity = { people: [], threads: [], seq: 0 };    // what §9 took with the chat is set aside: this section starts from none
    check('a world whose scenes have said nothing of it has no continuity', cont().people.length === 0 && cont().threads.length === 0);

    // A scene: the record's request is asked for the people and the threads too, and its reply is checked.
    const s1 = await start();
    check('with nothing to tell, a scene\'s openings and brief say nothing of it', s1.ok && s1.prep.continuity.stand.length === 0 && s1.prep.continuity.threads === 0 && !openersAsked.user.includes('Where they stand now') && !meta.dooms_hub.brief.includes('Where they stand now') && !meta.dooms_hub.brief.includes('Still open'));
    chat.push(user('We go down.'));
    chat.push(ai('Kiyoha takes the front. On the Third Landing a stranger, Dagger, is waiting with the Factor\'s key. Lysandra says nothing.'));
    recapsAsked.length = 0;
    recapReply = () => JSON.stringify({
        recap: 'The company went down to the Third Landing and met Dagger, who holds the Factor\'s key.',
        people: [{ name: 'kiyoha', now: 'On the Third Landing, at the front; trusts Jordan with her back.' }, { name: 'Dagger', now: 'On the Third Landing with the Factor\'s key; has not said whose side he is on.' }, { name: 'Jordan', now: 'never told of' }, { name: 'Ghost', now: 'nobody the scene names' }],
        threads: { closed: [], opened: ['The Factor will want his key back.', 'Dagger has not said why he came.'] },
    });
    const pe = await hub.prepareEnd();
    check('the record\'s own request asks for them: one request, no other', recapsAsked.length === 1 && /"people": \[\{"name"/.test(recapsAsked[0].system) && /"threads": \{"closed"/.test(recapsAsked[0].system) && /never Jordan/.test(recapsAsked[0].system) && !recapsAsked[0].user.includes('Where they stood before') && !recapsAsked[0].user.includes('Open threads'));
    check('what it said comes back for the sheet: the people (in the world\'s spelling, the player and a stranger to the scene left out), the threads opened', pe.ok && same(pe.continuity.people.map(p => [p.name, p.was]), [['Kiyoha', ''], ['Dagger', '']]) && same(pe.continuity.opened.map(t => t.text), ['The Factor will want his key back.', 'Dagger has not said why he came.']) && pe.continuity.closed.length === 0 && pe.continuity.open === 0, JSON.stringify(pe.continuity));
    // The sheet's corrections are what is kept: Kiyoha reworded, Dagger crossed off, one thread reworded.
    const ce = await hub.commitEnd({ recap: pe.recap, skipCanon: true, skipWorld: true, continuity: { people: [{ name: 'Kiyoha', now: 'On the Third Landing, at the front; trusts Jordan with her back and has said so.' }], opened: ['The Factor will want his key back, and soon.', 'Dagger has not said why he came.'], closed: [] } });
    check('End keeps what the sheet handed it, and says so', ce.ok && same(ce.continuity, { people: 1, opened: 2, closed: 0 }) && cont().people.length === 1 && cont().people[0].now.endsWith('has said so.') && cont().people[0].scene === hub.currentScene().mark.scene && same(cont().threads.map(t => t.text), ['The Factor will want his key back, and soon.', 'Dagger has not said why he came.']) && /1 person's standing kept, 2 threads opened/.test(utils.describeEndResult(ce)), utils.describeEndResult(ce));
    check('it is kept with the world in the settings', extensionSettings.hub.worlds[W].continuity.threads.length === 2);

    // The next scene is told: its openings and its brief.
    const s2 = await start(['Kiyoha', 'Lysandra']);
    check('the next scene\'s openings are told where its people stand and what is open', s2.ok && openersAsked.user.includes('Where they stand now:\n- Kiyoha: On the Third Landing, at the front; trusts Jordan with her back and has said so\n') && openersAsked.user.includes('Left open by the story so far') && openersAsked.user.includes('- Dagger has not said why he came') && /that is how the story left them/.test(openersAsked.system) && same(s2.prep.continuity, { stand: ['Kiyoha'], threads: 2 }), openersAsked.user.slice(0, 1200));
    check('and so is its brief, which the narrator has every reply', meta.dooms_hub.brief.includes('Where they stand now: Kiyoha: On the Third Landing, at the front; trusts Jordan with her back and has said so.') && meta.dooms_hub.brief.includes('Still open: Dagger has not said why he came; The Factor will want his key back, and soon.'), meta.dooms_hub.brief);

    // Its record is told where they stood and what was open; with no sheet (the command), what the record said is kept.
    chat.push(user('We give the key back.'));
    chat.push(ai('The Factor takes his key without a word. Lysandra laughs for the first time in days. Kiyoha sleeps.'));
    recapsAsked.length = 0;
    recapReply = () => JSON.stringify({ recap: 'The key went back to the Factor.', people: [{ name: 'Kiyoha', now: 'Asleep at the stair foot; the debt of the key is off her mind.' }, { name: 'Lysandra', now: 'In Hask, laughing again; her ink is still gone.' }], threads: { closed: [1], opened: ['Lysandra still has no ink.'] } });
    const ended = await hub.endScene({ skipCanon: true, skipWorld: true });
    check('a record is told where the scene\'s people stood before it and the threads open before it, numbered', recapsAsked.length === 1 && recapsAsked[0].user.includes('Where they stood before this scene:\n- Kiyoha: On the Third Landing') && recapsAsked[0].user.includes('Open threads:\n1. The Factor will want his key back, and soon.\n2. Dagger has not said why he came.'), recapsAsked[0].user.slice(0, 700));
    check('with no sheet, what the record said is kept: the people stand anew, the settled thread is gone, the new one is open', ended.ok && same(ended.continuity, { people: 2, opened: 1, closed: 1 }) && cont().people.find(p => p.name === 'Kiyoha').now.startsWith('Asleep at the stair foot') && cont().people.find(p => p.name === 'Lysandra').now.startsWith('In Hask, laughing') && same(cont().threads.map(t => t.text), ['Dagger has not said why he came.', 'Lysandra still has no ink.']), JSON.stringify(cont()));

    // What a prepared End said is this chat's, for this last reply: a reply later, it is not kept unseen.
    const s3 = await start(['Kiyoha']);
    chat.push(user('On.'));
    chat.push(ai('Kiyoha wakes.'));
    recapReply = () => JSON.stringify({ recap: 'Kiyoha woke.', people: [{ name: 'Kiyoha', now: 'Awake and hungry.' }], threads: { opened: ['Breakfast is owed.'] } });
    const pe3 = await hub.prepareEnd();
    chat.push(user('And then?'));
    chat.push(ai('Nothing yet.'));
    const ce3 = await hub.commitEnd({ recap: pe3.recap, skipCanon: true, skipWorld: true });
    check('a record written before the scene went on is not kept unseen once the scene has gone on', s3.ok && pe3.ok && ce3.ok && ce3.continuity === undefined && cont().people.find(p => p.name === 'Kiyoha').now.startsWith('Asleep') && cont().threads.length === 2);

    // A long scene, read in two passes: the second is told how things stand so far, and its numbers are of that list.
    const s4 = await start(['Kiyoha']);
    for (let i = 0; i < 26; i++) { chat.push(user(`Step ${i}. ${'We go on down the stair. '.repeat(20)}`)); chat.push(ai(`Kiyoha goes first, step ${i}. ${'The stair goes on down. '.repeat(40)}`)); }
    recapsAsked.length = 0;
    recapReply = (p, n) => (n === 1
        ? JSON.stringify({ recap: 'They went down.', people: [{ name: 'Kiyoha', now: 'Halfway down, tired.' }], threads: { closed: [], opened: ['The lamp oil is running low.'] } })
        : JSON.stringify({ recap: 'They went down and found oil.', people: [{ name: 'Kiyoha', now: 'At the stair foot, rested.' }], threads: { closed: [3], opened: [] } }));
    const pe4 = await hub.prepareEnd();
    check('a long scene is read in passes; the later pass is told how things stand so far, the thread the scene opened numbered with the rest', pe4.ok && pe4.pages >= 2 && recapsAsked.length === pe4.pages && recapsAsked[1].user.includes('Where they stand as of the record so far:\n- Kiyoha: Halfway down, tired.') && recapsAsked[1].user.includes('3. The lamp oil is running low.'), `${pe4.pages} pages; ${recapsAsked.length} asked`);
    {
        const u1 = String(recapsAsked[1].user);
        const lead = u1.includes('The lines just before this part') ? u1.slice(u1.indexOf('The lines just before this part'), u1.indexOf('The scene, continued:\n')) : '';
        const lastOfFirst = String(recapsAsked[0].user).split('The scene:\n').pop().split('\n').filter(x => x.trim() && !/^Answer with/.test(x)).pop();
        check('End\'s later pass is handed the last lines of the page before it too, to read across the cut (D199); the first pass has none', !String(recapsAsked[0].user).includes('The lines just before this part') && !!lead && !!lastOfFirst && lead.includes(lastOfFirst), JSON.stringify([lead.length, String(lastOfFirst).slice(0, 60)]));
    }
    check('what stands at the end is the last pass\'s word; a thread the scene opened and settled leaves no trace', same(pe4.continuity.people.map(p => p.now), ['At the stair foot, rested.']) && pe4.continuity.people[0].was.startsWith('Asleep') && pe4.continuity.opened.length === (pe4.pages > 2 ? pe4.continuity.opened.length : 0) && pe4.continuity.closed.length === 0 && pe4.continuity.open === 2, JSON.stringify(pe4.continuity));
    const ce4 = await hub.commitEnd({ recap: pe4.recap, skipCanon: true, skipWorld: true });
    check('ended, the world has it', ce4.ok && cont().people.find(p => p.name === 'Kiyoha').now === 'At the stair foot, rested.' && cont().threads.length === 2);

    // A scene the world has moved past does not overwrite what a later scene left.
    const old = await start(['Kiyoha']);
    const oldId = hub.currentScene().mark.scene;
    chat.push(user('Wait here.'));
    chat.push(ai('Kiyoha waits.'));
    await wait(5);
    check('a scene set aside', hub.setSceneAside(W, oldId) === true || hub.worldEntry(W).scenes.find(x => x.id === oldId).status === 'aside');
    await wait(5);
    const later = await start(['Kiyoha']);
    chat.push(user('Later.'));
    chat.push(ai('Kiyoha has moved on to the gate.'));
    recapReply = () => JSON.stringify({ recap: 'Later, at the gate.', people: [{ name: 'Kiyoha', now: 'At the gate, a day on.' }], threads: { opened: [] } });
    const laterEnd = await hub.endScene({ skipCanon: true, skipWorld: true });
    const back = await hub.openSceneChat(W, oldId);
    recapReply = () => JSON.stringify({ recap: 'She waited.', people: [{ name: 'Kiyoha', now: 'Waiting on the stair, a day before.' }], threads: { opened: ['An older thread.'] } });
    const stalePrep = await hub.prepareEnd();
    const staleEnd = await hub.commitEnd({ recap: stalePrep.recap, skipCanon: true, skipWorld: true });
    check('a scene that began before a later one ended keeps the world\'s continuity as the later one left it', old.ok && later.ok && laterEnd.ok && back.ok && stalePrep.ok && stalePrep.stale === true && staleEnd.ok && staleEnd.continuity === undefined && cont().people.find(p => p.name === 'Kiyoha').now === 'At the gate, a day on.' && !cont().threads.some(t => t.text === 'An older thread.'), JSON.stringify([stalePrep.stale, staleEnd.continuity, cont().people]));

    // Going straight on carries it too.
    const s5 = await start(['Kiyoha']);
    chat.push(user('On we go.'));
    chat.push(ai('Kiyoha shoulders her axe.'));
    recapReply = () => JSON.stringify({ recap: 'On they went.', people: [{ name: 'Kiyoha', now: 'On the road, axe shouldered.' }], threads: { opened: ['The road is watched.'] } });
    const on = await hub.continueScene({});
    check('going straight on keeps what the record said, and the scene it opens is told it', s5.ok && on.ok && cont().people.find(p => p.name === 'Kiyoha').now === 'On the road, axe shouldered.' && cont().threads.some(t => t.text === 'The road is watched.') && meta.dooms_hub.brief.includes('Where they stand now: Kiyoha: On the road, axe shouldered') && meta.dooms_hub.brief.includes('The road is watched'), meta.dooms_hub.brief);
    await hub.endScene({ skipCanon: true, skipWorld: true });

    hub.__setRecapTransport(null);
    hub.__setOpenersTransport(null);
    hub.__setGapTransport(null);
    ctxTarget.characterId = 0;
    ctxTarget.name2 = 'Mara Vane';
    await openPlain('Mara Vane - plain five');
}

console.log('\n§17 the continuity book: the world\'s own lorebook, written at End, the player\'s to edit (D189)');
{
    const W = 'first-descent';
    const utils = await import(`${DES}/src/utils/hub.js`);
    let openersAsked = null;
    hub.__setOpenersTransport(async (p) => { openersAsked = p; return '{"when":{"date":"Day 70","time":"morning"},"openers":[{"title":"a","text":"The lane, again.","who":[]},{"title":"b","text":"Second.","who":[]},{"title":"c","text":"Third.","who":[]}]}'; });
    const recapsAsked = [];
    let recapReply = () => '{"recap":"x"}';
    hub.__setRecapTransport(async (p) => { recapsAsked.push(p); return recapReply(p); });
    const start = async (cast = ['Kiyoha', 'Lysandra']) => { const p = await hub.prepareScene({ worldId: W, place: { label: 'Hask' }, cast, gap: { id: 'now' } }); return p.ok ? { ...(await hub.commitScene(p.token, { choice: 0 })), prep: p } : p; };
    const play = () => { chat.push(user('On.')); chat.push(ai('Kiyoha and Lysandra go on. Dagger follows.')); };
    const cont = () => hub.worldEntry(W).continuity;
    const entryOf = (title) => Object.values(shelf.get(hub.continuityBookOf(W)).entries).find(e => e.comment === title);

    // The book was made by the first End that had anything to keep (§9's, when the chat was taken), and filed with the campaign.
    check('the first continuity made the book: named after the campaign, filed with it', filed.length >= 1 && filed[0][0] === 'camp1' && filed[0][1] === 'First Descent - Scenes Continuity' && shelf.has('First Descent - Scenes Continuity') && extensionSettings.lorebook.campaigns.camp1.books.includes('First Descent - Scenes Continuity'), JSON.stringify(filed));
    const name = hub.continuityBookOf(W);
    check('the world knows its book, and the book holds an entry a person and one for the threads', !!name && shelf.has(name) && !!entryOf('Kiyoha: as things stand now') && entryOf('Kiyoha: as things stand now').content === 'Kiyoha, as the story stands now: On the road, axe shouldered.' && same(entryOf('Kiyoha: as things stand now').key, ['Kiyoha']) && entryOf('Kiyoha: as things stand now').constant === false && entryOf('Open threads').constant === true && entryOf('Open threads').content.includes('- The road is watched.'), JSON.stringify(shelf.get(name)));
    check('a name another book has is left to that book: this world\'s was given the next free one', name === 'First Descent - Scenes Continuity 2' && filed.some(f => f[1] === name));

    // Switched off (the campaign is not on): the brief carries where people stand. Switched on: the book does, and the brief leaves it out.
    const off = await start();
    check('with the book switched off a scene\'s brief says where its people stand and what is open', off.ok && meta.dooms_hub.brief.includes('Where they stand now: Kiyoha: On the road, axe shouldered') && meta.dooms_hub.brief.includes('Still open:'));
    check('the openings are not given the continuity book as a person\'s own notes: it is given by itself', openersAsked.user.includes('Where they stand now:\n- Kiyoha: On the road, axe shouldered') && !openersAsked.user.includes('as the story stands now'));
    play();
    recapReply = () => JSON.stringify({ recap: 'On they went.', people: [{ name: 'Kiyoha', now: 'At the gate of Hask, tired.' }], threads: { opened: [] } });
    const e1 = await hub.endScene({ skipCanon: true, skipWorld: true });
    check('End writes the book: the person\'s entry says how they stand now, and End says the book was written', e1.ok && e1.book === 'ok' && e1.bookResult.made === false && e1.bookResult.written === 1 && entryOf('Kiyoha: as things stand now').content === 'Kiyoha, as the story stands now: At the gate of Hask, tired.' && /the continuity book written/.test(utils.describeEndResult(e1)), JSON.stringify(e1.bookResult));
    booksOn.add(name);
    const on = await start();
    check('with the book switched on, SillyTavern carries it: the brief leaves both out, the openings are still told', on.ok && !meta.dooms_hub.brief.includes('Where they stand now') && !meta.dooms_hub.brief.includes('Still open') && openersAsked.user.includes('Where they stand now:\n- Kiyoha: At the gate of Hask, tired'), meta.dooms_hub.brief);

    // The player rewrites an entry in the book: it is how things stand.
    entryOf('Kiyoha: as things stand now').content = 'RUN 4: Kiyoha is Jordan\'s lover and says so in front of the company. She will not go down the stair without him.';
    entryOf('Kiyoha: as things stand now').key.push('oni');
    play();
    recapsAsked.length = 0;
    recapReply = () => JSON.stringify({ recap: 'A quiet day.', people: [{ name: 'Kiyoha', now: 'In Hask, rested.' }], threads: { opened: [] } });
    const pe = await hub.prepareEnd();
    check('a text the player wrote in the book is how things stood: the record is told it, and the sheet shows it', pe.ok && recapsAsked[0].user.includes('- Kiyoha: RUN 4: Kiyoha is Jordan\'s lover') && pe.continuity.people[0].was.startsWith('RUN 4: Kiyoha is Jordan\'s lover') && cont().people.find(p => p.name === 'Kiyoha').by === 'you' && pe.book === name);
    // Going straight on has no sheet: what the player wrote is not replaced unseen.
    const unseen = await hub.commitEnd({ recap: pe.recap, skipCanon: true, skipWorld: true });
    check('an End nobody was shown leaves what the player wrote as they wrote it, and says so', unseen.ok && same(unseen.continuityKept, ['Kiyoha']) && unseen.continuity.people === 0 && entryOf('Kiyoha: as things stand now').content.startsWith('RUN 4: Kiyoha is Jordan\'s lover') && cont().people.find(p => p.name === 'Kiyoha').now.startsWith('RUN 4') && /Kiyoha left as you wrote it in the book/.test(utils.describeEndResult(unseen)), utils.describeEndResult(unseen));
    // With the sheet, the player sees the new line and keeps it: the entry is written, its keys left as they made them.
    const s3 = await start();
    check('the next scene is told what the player wrote', s3.ok && openersAsked.user.includes('- Kiyoha: RUN 4: Kiyoha is Jordan\'s lover'));
    play();
    const pe3 = await hub.prepareEnd();
    const seen = await hub.commitEnd({ recap: pe3.recap, skipCanon: true, skipWorld: true, continuity: { people: [{ name: 'Kiyoha', now: 'In Hask, rested; still Jordan\'s lover.' }], opened: [], closed: [] } });
    check('an End the player saw takes its place: the entry\'s text is written, the keys they added left alone', seen.ok && seen.continuityKept === undefined && entryOf('Kiyoha: as things stand now').content === 'Kiyoha, as the story stands now: In Hask, rested; still Jordan\'s lover.' && same(entryOf('Kiyoha: as things stand now').key, ['Kiyoha', 'oni']) && !cont().people.find(p => p.name === 'Kiyoha').by);

    // The threads' entry edited: a line deleted settles the thread, a line added opens one.
    const th = entryOf('Open threads');
    const before = cont().threads.map(t => t.text);
    th.content = `Still open in the story:\n- ${before[0]}\n- Solveig's stair rule has not been tested.`;
    const s4 = await start();
    check('a thread added by hand in the book is told to the next scene; one deleted there is settled', s4.ok && same(cont().threads.map(t => t.text), [before[0], 'Solveig\'s stair rule has not been tested.']) && openersAsked.user.includes('- Solveig\'s stair rule has not been tested'), JSON.stringify(cont().threads));
    // An entry deleted in the book: the person's standing is let go.
    const lys = entryOf('Lysandra: as things stand now');
    check('Lysandra has an entry of her own', !!lys);
    delete shelf.get(name).entries[lys.uid];
    play();
    recapReply = () => JSON.stringify({ recap: 'Nothing much.', people: [], threads: { opened: [] } });
    const e4 = await hub.endScene({ skipCanon: true, skipWorld: true });
    check('an entry the player deleted is not made again: that person\'s standing is let go', e4.ok && !cont().people.some(p => p.name === 'Lysandra') && !entryOf('Lysandra: as things stand now') && e4.book === 'ok');
    // An entry of the player's own, added to DES's book, is never touched.
    shelf.get(name).entries[900] = { uid: 900, comment: 'The stair rule', key: ['stair'], content: 'Nobody goes down alone.', constant: true };
    const s5 = await start(['Kiyoha']);
    play();
    recapReply = () => JSON.stringify({ recap: 'Down a step.', people: [{ name: 'Kiyoha', now: 'On the first step.' }], threads: { opened: ['The first step is loose.'] } });
    const e5 = await hub.endScene({ skipCanon: true, skipWorld: true });
    check('an entry the player added to the book is left exactly as it is while the others are written', s5.ok && e5.ok && same(shelf.get(name).entries[900], { uid: 900, comment: 'The stair rule', key: ['stair'], content: 'Nobody goes down alone.', constant: true }) && entryOf('Kiyoha: as things stand now').content.endsWith('On the first step.') && entryOf('Open threads').content.includes('- The first step is loose.') && entryOf('Open threads').content.includes('- Solveig\'s stair rule has not been tested.'));

    // Renamed in the Lore Library: the world follows. Deleted: forgotten, and the next End writes a new book whole.
    shelf.set('FD - Where things stand', shelf.get(name));
    shelf.delete(name);
    hub.onHubBookRenamed(name, 'FD - Where things stand');
    check('the book renamed in the Lore Library: the world follows the name', hub.continuityBookOf(W) === 'FD - Where things stand' && !!entryOf('Kiyoha: as things stand now'));
    shelf.delete('FD - Where things stand');
    hub.onHubBookDeleted('FD - Where things stand');
    check('the book deleted in the Lore Library: the world forgets it and keeps its continuity', hub.continuityBookOf(W) === '' && cont().people.some(p => p.name === 'Kiyoha') && cont().threads.length >= 2);
    const s6 = await start(['Kiyoha']);
    play();
    recapReply = () => JSON.stringify({ recap: 'Another step.', people: [{ name: 'Kiyoha', now: 'On the second step.' }], threads: { opened: [] } });
    const e6 = await hub.endScene({ skipCanon: true, skipWorld: true });
    check('the next End makes a new book and writes it whole', s6.ok && e6.ok && e6.book === 'ok' && e6.bookResult.made === true && !!hub.continuityBookOf(W) && shelf.has(hub.continuityBookOf(W)) && entryOf('Kiyoha: as things stand now').content.endsWith('On the second step.') && !!entryOf('Open threads') && /the continuity book "[^"]+" made/.test(utils.describeEndResult(e6)), JSON.stringify(e6.bookResult));
    // A book that vanished without a word (the file deleted outside DES) is noticed the same way.
    shelf.delete(hub.continuityBookOf(W));
    const s7 = await start(['Kiyoha']);
    check('a book that is simply gone is noticed at the next Start: forgotten, the continuity kept and told', s7.ok && hub.continuityBookOf(W) === '' && openersAsked.user.includes('- Kiyoha: On the second step'));
    play();
    // A lorebook that fails does not stop End.
    hub.__setBookApi({ names: async () => { throw new Error('the lorebooks are away'); } });
    const e7 = await hub.endScene({ skipCanon: true, skipWorld: true });
    check('a lorebook that cannot be reached does not stop End: the scene is ended, the continuity kept, the book said to be unwritten', e7.ok && e7.book === 'failed' && cont().people.find(p => p.name === 'Kiyoha').now === 'On the second step.' && /the continuity book not written/.test(utils.describeEndResult(e7)));
    hub.__setBookApi(null);
    hub.__setRecapTransport(null);
    hub.__setOpenersTransport(null);
    ctxTarget.characterId = 0;
    ctxTarget.name2 = 'Mara Vane';
    await openPlain('Mara Vane - plain six');
}

console.log('\n§18 what a scene contradicts, and one Undo of End (D190)');
{
    const W = 'first-descent';
    const utils = await import(`${DES}/src/utils/hub.js`);
    // A shelf again, and the campaign's books as the player has them: who people are, and the hand-made Continuity.
    hub.__setBookApi({
        names: async () => [...shelf.keys()], load: async (name) => shelf.get(name) || null, save: async (name, data) => { shelf.set(name, data); }, create: async (name) => { shelf.set(name, { entries: {} }); },
        entry: async (name, data) => { const ids = Object.keys(data.entries).map(Number); const uid = ids.length ? Math.max(...ids) + 1 : 0; data.entries[uid] = { uid, key: [], comment: '', content: '', constant: false, disable: false }; return data.entries[uid]; },
        active: async (name) => booksOn.has(name), remove: async (name, data, uid) => { delete data.entries[uid]; },
        file: async (campaignId, name) => { filed.push([campaignId || '', name]); if (campaignId) extensionSettings.lorebook.campaigns[campaignId].books.push(name); },
    });
    const lore = {
        'FD - Campaign Complete': { entries: { 11: { uid: 11, key: ['Kiyoha', 'oni'], comment: 'Kiyoha — who she is', content: 'KIYOHA — the company\'s front line. She and Solveig came up the stair together and she trusts her with the rope.', order: 90 } } },
        'FD - Continuity': { entries: { 0: { uid: 0, key: [], comment: 'STORY CANON', content: 'RULING: the tests are over. LOOT LAW: the Factor\'s key was returned in run 2.', constant: true, order: 100 } } },
    };
    extensionSettings.lorebook.campaigns.camp1.books = ['FD - Campaign Complete', 'FD - Continuity', ...extensionSettings.lorebook.campaigns.camp1.books.filter(b => b.includes('Scenes Continuity'))];
    hub.__setLoreReader(async (book) => lore[book] || null);
    let openersAsked = null;
    hub.__setOpenersTransport(async (p) => { openersAsked = p; return '{"when":{"date":"Day 80","time":"morning"},"openers":[{"title":"a","text":"The lane, again.","who":[]},{"title":"b","text":"Second.","who":[]},{"title":"c","text":"Third.","who":[]}]}'; });
    const recapsAsked = [];
    let recapReply = () => '{"recap":"x"}';
    hub.__setRecapTransport(async (p) => { recapsAsked.push(p); return recapReply(p); });
    let gapRuns = 0;
    hub.__setGapTransport(async () => { gapRuns++; return '{"elapsed":"a day","now":{"date":"Day 81","time":"dawn"},"clocks":{},"moved":[],"blurb":"A day went by.","heard":[]}'; });
    const start = async (cast = ['Kiyoha']) => { const p = await hub.prepareScene({ worldId: W, place: { label: 'Hask' }, cast, gap: { id: 'now' } }); return p.ok ? { ...(await hub.commitScene(p.token, { choice: 0 })), prep: p } : p; };
    const entry = () => hub.worldEntry(W);
    const bookEntry = (title) => { const b = shelf.get(hub.continuityBookOf(W)); return b ? Object.values(b.entries).find(e => e.comment === title) : undefined; };
    const clash = { scene: 'Dagger still holds the Factor\'s key.', established: 'The Factor\'s key was returned in run 2.', source: 'the standing notes' };

    // A scene first, so the world has its continuity book with an entry for Kiyoha and one for the threads.
    const s0 = await start();
    chat.push(user('A day in Hask.'));
    chat.push(ai('Kiyoha rests.'));
    recapReply = () => JSON.stringify({ recap: 'A day in Hask.', people: [{ name: 'Kiyoha', now: 'In Hask, rested.' }], threads: { opened: ['The stair is still unmapped.'] }, conflicts: [] });
    const e0 = await hub.endScene({ skipCanon: true, skipWorld: true });
    check('a scene that contradicts nothing ends as before, and the world has its book', s0.ok && e0.ok && e0.conflicts === undefined && e0.book === 'ok' && !!bookEntry('Kiyoha: as things stand now') && !!bookEntry('Open threads'), JSON.stringify(e0.bookResult));

    // A scene whose record finds a contradiction.
    const s1 = await start();
    chat.push(user('Where is the key?'));
    chat.push(ai('Dagger turns the Factor\'s key over in his fingers. Kiyoha says she has never met Solveig.'));
    cn.onCanonChatChanged();
    const line = cn.addCanonLine({ kind: 'thing', name: 'The Factor\'s key', text: 'Returned to the Factor at the Counting Room.' });
    await persistence.saveChatData({ immediate: true });
    recapsAsked.length = 0;
    recapReply = () => JSON.stringify({ recap: 'Dagger showed the key.', people: [{ name: 'Kiyoha', now: 'In Hask, puzzled by Dagger.' }], threads: { opened: ['Why does Dagger have the key?'] }, conflicts: [clash, { scene: 'Kiyoha says she has never met Solveig.', established: 'She and Solveig came up the stair together.', source: 'Kiyoha\'s notes' }, { scene: 'half' }] });
    const before = JSON.parse(JSON.stringify(entry()));
    const ledgerBefore = JSON.stringify(meta.dooms_canon);
    const pe = await hub.prepareEnd();
    check('the record\'s one request is given what was established: the chat\'s ledger, the people\'s own lorebook entries and the standing notes, and is asked what the scene contradicts', s1.ok && pe.ok && !!line && recapsAsked.length === 1 && recapsAsked[0].user.includes('What the story has established (the ledger):') && recapsAsked[0].user.includes('Returned to the Factor at the Counting Room.') && pe.checked.ledger === true && recapsAsked[0].user.includes('The people\'s own notes:\n[Kiyoha] KIYOHA — the company\'s front line.') && recapsAsked[0].user.includes('The story\'s standing notes:') && recapsAsked[0].user.includes('LOOT LAW: the Factor\'s key was returned in run 2.') && /"conflicts": \[\{"scene"/.test(recapsAsked[0].system), recapsAsked[0].user.slice(0, 900));
    check('the continuity book is not given as a person\'s own notes: where they stood is told by itself', !recapsAsked[0].user.includes('as the story stands now'));
    check('what it found comes back for the sheet, with what it was checked against', pe.conflicts.length === 2 && same(pe.conflicts[0], clash) && pe.conflicts[1].source === 'Kiyoha\'s notes' && same(pe.checked.notes, ['Kiyoha']) && pe.checked.standing === true, JSON.stringify([pe.conflicts, pe.checked]));

    // Going straight on stops: the contradictions are the player's to see first. The sheet then shows that same record.
    const held = await hub.continueScene({});
    check('going straight on stops when the record found a contradiction: nothing is ended, and it says why', held.ok === false && held.reason === 'conflicts' && held.conflicts === 2 && held.stage === 'end' && hub.currentScene().ended === false && entry().scenes.find(x => x.id === hub.currentScene().mark.scene).status === 'open');
    const asked = recapsAsked.length;
    const again = await hub.prepareEnd();
    check('the End sheet then shows the record that was written: nothing is asked again', again.ok && again.conflicts.length === 2 && again.recap === 'Dagger showed the key.' && recapsAsked.length === asked);

    // Ended from the sheet: the list is kept with the scene, the world moves, the book is written.
    gapRuns = 0;
    const sceneId = hub.currentScene().mark.scene;
    const ce = await hub.commitEnd({ recap: again.recap, skipCanon: true, continuity: { people: [{ name: 'Kiyoha', now: 'In Hask, puzzled by Dagger.' }], opened: ['Why does Dagger have the key?'], closed: [] }, conflicts: again.conflicts });
    const record = () => entry().scenes.find(x => x.id === sceneId);
    check('ended, the scene keeps what it contradicted, and End says so', ce.ok && ce.conflicts === 2 && record().status === 'ended' && record().conflicts.length === 2 && /2 things in it contradict what was established/.test(utils.describeEndResult(ce)) && ce.undo === true, utils.describeEndResult(ce));
    check('that End moved the world, changed where Kiyoha stands, opened a thread and wrote the book', gapRuns === 1 && entry().memory.facts.date === 'Day 81' && entry().continuity.people.find(p => p.name === 'Kiyoha').now === 'In Hask, puzzled by Dagger.' && entry().continuity.threads.some(t => t.text === 'Why does Dagger have the key?') && bookEntry('Kiyoha: as things stand now').content.endsWith('puzzled by Dagger.') && bookEntry('Open threads').content.includes('- Why does Dagger have the key?') && meta.dooms_hub.endedAt > 0);

    // One Undo puts it all back.
    const can = hub.canUndoEnd();
    check('the End can be put back while its scene\'s chat is in front and no scene has started since', can.ok && can.scene === sceneId);
    const kiyohaBefore = before.continuity.people.find(p => p.name === 'Kiyoha').now;
    const un = await hub.undoEnd();
    check('undone: the scene is open again, its record as it was, the chat\'s mark not ended', un.ok && un.scene === sceneId && record().status === 'open' && record().recap === '' && !record().conflicts && meta.dooms_hub.endedAt === 0 && hub.currentScene().ended === false && hub.isScene());
    check('the world is as it was before the End: its memory, its date, where people stand, the threads', same(entry().memory, before.memory) && entry().continuity.people.find(p => p.name === 'Kiyoha').now === kiyohaBefore && same(entry().continuity.threads, before.continuity.threads) && same(entry().scenes, before.scenes) && same(entry().style, before.style), JSON.stringify([entry().memory.facts, entry().continuity.people]));
    check('the continuity book is as it was: the text End replaced is back, and it is still the world\'s book', bookEntry('Kiyoha: as things stand now').content === `Kiyoha, as the story stands now: ${kiyohaBefore}` && !bookEntry('Open threads').content.includes('Why does Dagger have the key?') && hub.continuityBookOf(W) === before.continuity.book.name && same(entry().continuity.book, before.continuity.book), JSON.stringify(shelf.get(hub.continuityBookOf(W))));
    check('the chat\'s ledger is as it was', JSON.stringify(meta.dooms_canon) === ledgerBefore);
    check('there is one Undo: it is not offered twice', hub.canUndoEnd().ok === false && (await hub.undoEnd()).ok === false);
    check('the chat\'s messages were never touched', chat.length === 3 && chat[2].mes.includes('never met Solveig'));

    // Put right and ended again: Canon reads the scene this time, and the Undo puts the ledger back too.
    chat[2].mes = 'Dagger turns a brass token over in his fingers. Kiyoha nods to Solveig.';
    chat[2].swipes = [chat[2].mes];
    recapReply = () => JSON.stringify({ recap: 'Dagger showed a token.', people: [{ name: 'Kiyoha', now: 'In Hask, at ease.' }], threads: { opened: [] }, conflicts: [] });
    cn.__setCanonTransport(async () => '{"add":[{"kind":"fact","name":"Dagger","text":"Dagger carries a brass token."}],"drop":[]}');
    const pe2 = await hub.prepareEnd();
    const ce2 = await hub.commitEnd({ recap: pe2.recap, skipWorld: true, continuity: { people: [{ name: 'Kiyoha', now: 'In Hask, at ease.' }], opened: [], closed: [] }, conflicts: pe2.conflicts });
    check('put right and ended again: no contradiction is found or kept, and the ledger has read the scene', pe2.ok && pe2.conflicts.length === 0 && ce2.ok && ce2.conflicts === undefined && !record().conflicts && ce2.canon === 'ok' && JSON.stringify(meta.dooms_canon).includes('brass token') && !/contradict/.test(utils.describeEndResult(ce2)), JSON.stringify([ce2.canon, pe2.conflicts]));
    const un2 = await hub.undoEnd();
    check('that End undone: the ledger is as it was before Canon read the scene, so ending again reads it afresh', un2.ok && JSON.stringify(meta.dooms_canon) === ledgerBefore && !meta.dooms_hub.end && cn.getCanon().entries.length === 1 && cn.getCanon().entries[0].name === 'The Factor\'s key', JSON.stringify(meta.dooms_canon));
    cn.__setCanonTransport(null);
    const ce3 = await hub.commitEnd({ recap: pe2.recap, skipCanon: true, skipWorld: true, continuity: { people: [], opened: [], closed: [] }, conflicts: [] });
    check('ended once more', ce3.ok && hub.canUndoEnd().ok === true);

    // The Undo is this scene's chat's, and goes when the world goes on.
    ctxTarget.characterId = 0;
    await openPlain('Mara Vane - plain seven');
    check('from another chat there is nothing to undo', hub.canUndoEnd().ok === false);
    const s2 = await start();
    play2();
    function play2() { chat.push(user('On.')); chat.push(ai('Kiyoha goes on.')); }
    recapReply = () => JSON.stringify({ recap: 'On.', people: [], threads: { opened: [] }, conflicts: [] });
    const e2 = await hub.endScene({ skipCanon: true, skipWorld: true });
    check('a scene ended by the command can be put back the same way', s2.ok && e2.ok && e2.undo === true && hub.canUndoEnd().ok === true);
    const s3 = await start();
    check('once the next scene starts the last End is not put back', s3.ok && hub.canUndoEnd().ok === false && (await hub.undoEnd()).reason === 'none');
    play2();
    // The command has no sheet: what the record found is kept with the scene and said in its answer.
    recapReply = () => JSON.stringify({ recap: 'On again.', people: [], threads: { opened: [] }, conflicts: [clash] });
    const e3 = await hub.endScene({ skipCanon: true, skipWorld: true });
    const last = entry().scenes[entry().scenes.length - 1];
    check('the command ends the scene and keeps what its record found, saying so with the way back', e3.ok && e3.conflicts === 1 && last.conflicts.length === 1 && /One thing in it contradicts what was established: the Atlas lists it, and one Undo puts the End back\./.test(utils.describeEndResult(e3)));
    await hub.undoEnd();
    // An End that made the book: undone, the book stays (empty of what End wrote) and is still the world's own.
    shelf.delete(hub.continuityBookOf(W));
    hub.onHubBookDeleted(hub.continuityBookOf(W));
    recapReply = () => JSON.stringify({ recap: 'On again.', people: [{ name: 'Kiyoha', now: 'On the road.' }], threads: { opened: [] }, conflicts: [] });
    const e4 = await hub.endScene({ skipCanon: true, skipWorld: true });
    const made = hub.continuityBookOf(W);
    const un4 = await hub.undoEnd();
    check('an End that made the book, undone: the entries it wrote are taken out, the book stays the world\'s, and the next End writes into it', e4.ok && e4.bookResult.made === true && un4.ok && un4.book === 'ok' && hub.continuityBookOf(W) === made && shelf.has(made) && Object.keys(shelf.get(made).entries).length === 0 && (await hub.endScene({ skipCanon: true, skipWorld: true })).bookResult.made === false && Object.keys(shelf.get(made).entries).length >= 1, JSON.stringify([e4.bookResult, un4, shelf.get(made)]));
    hub.__setBookApi(null);
    hub.__setLoreReader(null);
    hub.__setRecapTransport(null);
    hub.__setOpenersTransport(null);
    hub.__setGapTransport(null);
    ctxTarget.characterId = 0;
    ctxTarget.name2 = 'Mara Vane';
    await openPlain('Mara Vane - plain eight');
}

console.log('\n§19 a world picked in the Atlas: shown and started whatever chat is in front (D194)');
{
    const A = await import(`${DES}/src/utils/atlas.js`);
    const W = 'first-descent';
    // §18 left a plain chat of another card in front, and no scene of the world open.
    const wpack = (await lw.loadPack(W)).pack;
    const free = hub.startPlanFor(W);
    check('from a chat that is no scene of it, a scene of the world can be started: numbered next, on the world\'s narrator card', hub.currentScene() === null && free.ok && free.worldId === W && free.number === hub.worldEntry(W).seq + 1 && free.card === 'The Redward', JSON.stringify(free));
    const src = hub.worldSource(W, wpack);
    check('the world is shown from its memory, as between scenes', !!src && src.kind === 'world' && src.picked === true && src.worldId === W && src.open === null && src.memory.takenAt > 0 && src.memory.stores.dooms_world.pack === W);
    check('a world the scenes do not know, or one whose pack is not loaded, is not shown', hub.worldSource('nowhere', wpack) === null && hub.worldSource(W, null) === null && hub.worldSource('', wpack) === null);
    check('what is shown is a copy: changing it changes nothing kept', (() => { src.memory.facts.date = 'never'; return hub.worldEntry(W).memory.facts.date !== 'never'; })());
    check('its map can be changed from here', hub.setWorldBook(W, hub.worldEntry(W).memory.stores.dooms_atlas || null, { pack: wpack }).ok === true);
    // A scene of it started from here, then another chat in front: the world has a scene open, named, and its map is that scene's.
    hub.__setOpenersTransport(async () => '{"when":{"date":"Day 9","time":"noon"},"openers":[{"title":"On","text":"The road again.","who":[]},{"title":"Two","text":"Two.","who":[]},{"title":"Three","text":"Three.","who":[]}]}');
    hub.__setGapTransport(async () => '{}');
    const p0 = await hub.prepareScene({ worldId: W, seed: { kind: 'news', text: 'The bridge is out.' }, place: null, cast: [], gap: { id: 'now' } });
    const c0 = p0.ok ? await hub.commitScene(p0.token, { choice: 0 }) : p0;
    ctxTarget.characterId = 0;
    ctxTarget.name2 = 'Mara Vane';
    await openPlain('Mara Vane - plain picked');
    const held = hub.startPlanFor(W);
    check('a world with a scene open starts no other, whatever chat is in front; the plan names the scene', c0.ok && hub.currentScene() === null && held.ok === false && held.reason === 'scene-open' && !!held.scene && held.scene.id === c0.scene.id, JSON.stringify(held));
    check('it is shown with the open scene named, and its map is that scene\'s to change', hub.worldSource(W, wpack).open.id === c0.scene.id && hub.setWorldBook(W, A.placeAt(null, 'pin:x', { x: 1, y: 1 }), { pack: wpack }).reason === 'scene-open');
    hub.setSceneAside(W, c0.scene.id);
    check('set aside, the world is free again', hub.startPlanFor(W).ok && hub.worldSource(W, wpack).open === null);
    check('no world, or one with no narrator card, starts none', hub.startPlanFor('').reason === 'no-world' && hub.startPlanFor('nowhere').reason === 'no-card');

    // A world no scene has been played in: shown from its pack's own beginning; its map begins its memory, and the first scene carries it.
    extensionSettings.liveWorld.customPacks.newland = JSON.stringify({ ...example, id: 'newland', name: 'Newland' });
    const made = await hub.makeNarratorCard('newland');
    const npack = (await lw.loadPack('newland')).pack;
    const fresh = hub.worldSource('newland', npack);
    check('a world no scene was played in is shown from its pack\'s beginning, and nothing is written by the look', made.ok && !!fresh && fresh.memory.takenAt === 0 && fresh.open === null && fresh.memory.stores.dooms_world.pack === 'newland' && Object.keys(fresh.memory.stores.dooms_world.known || {}).length > 0 && hub.worldEntry('newland').memory === null, JSON.stringify([made.ok, fresh && fresh.memory.takenAt, hub.worldEntry('newland').memory]));
    check('with no pack given, a world with no memory has no map to change', hub.setWorldBook('newland', {}).reason === 'no-memory');
    const drawn = A.withWorld(A.placeAt(A.addPin(null, { label: 'Landfall', kind: 'settlement', x: 2, y: 3 }).book, 'pin:landfall', { x: 2, y: 3 }), { seed: 'newland', shape: 'islands', size: 'small' });
    const put = hub.setWorldBook('newland', drawn, { pack: npack });
    const nmem = hub.worldEntry('newland').memory;
    check('its map changed from the Atlas begins its memory: the map kept, the world as the pack begins it, and not a memory an End wrote', put.ok && !!nmem && nmem.takenAt === 0 && same(nmem.stores.dooms_atlas.world.seed, 'newland') && same(nmem.stores.dooms_atlas.spots['pin:landfall'], { x: 2, y: 3 }) && nmem.stores.dooms_world.pack === 'newland', JSON.stringify(put));
    check('the world is then shown with that map', same(hub.worldSource('newland', npack).memory.stores.dooms_atlas.spots['pin:landfall'], { x: 2, y: 3 }));
    let gaps = 0;
    hub.__setGapTransport(async () => { gaps++; return '{}'; });
    hub.__setOpenersTransport(async () => '{"when":{"date":"Day 1","time":"dawn"},"openers":[{"title":"Landfall","text":"The boat grounds on shingle.","who":[]},{"title":"Fog","text":"Fog on the water.","who":[]},{"title":"Gulls","text":"Gulls wheel.","who":[]}]}');
    const plan = hub.startPlanFor('newland');
    const p = await hub.prepareScene({ worldId: 'newland', seed: { kind: 'anywhere', text: 'A first landing.' }, place: { label: 'Landfall' }, cast: [], gap: { id: 'later', words: 'three days later' } });
    const c = p.ok ? await hub.commitScene(p.token, { choice: 0 }) : p;
    const file = c.ok ? files.get(c.file) : null;
    check('its first scene is started from there: scene 1 on its card, at a place named in the sheet, the world not moved before it', plan.ok && plan.number === 1 && p.ok && c.ok && c.scene.id === 's1' && c.scene.place.label === 'Landfall' && gaps === 0, JSON.stringify([plan, p.ok, c.ok, gaps]));
    check('and the scene\'s chat carries the map that was made', !!file && same(file.header.chat_metadata.dooms_atlas.spots['pin:landfall'], { x: 2, y: 3 }) && file.header.chat_metadata.dooms_atlas.world.seed === 'newland');
    check('the scene in front is then the world\'s own: nothing else is started for it', hub.currentScene() && hub.currentScene().worldId === 'newland' && hub.startPlanFor('newland').reason === 'scene-open');
    hub.__setGapTransport(null);
    hub.__setOpenersTransport(null);
    ctxTarget.characterId = 0;
    ctxTarget.name2 = 'Mara Vane';
    await openPlain('Mara Vane - plain nine');
}

console.log('\n§20 a scene deleted: its record and its chat, for one that never ended (D197)');
{
    const W = 'first-descent';
    const cardIndex = (avatar) => ctxTarget.characters.findIndex(c => c.avatar === avatar);
    const newlandCard = hub.cardOf('newland');
    const scenesOf = (w) => hub.worldEntry(w).scenes;
    // SillyTavern as it opens a chat that is not there: it makes one, with the card's greeting.
    const openWas = ctxTarget.openCharacterChat;
    ctxTarget.openCharacterChat = async (file) => {
        if (!files.has(file)) { const c = ctxTarget.characters[ctxTarget.characterId]; files.set(file, { header: { chat_metadata: {} }, messages: [ai('Hello, traveller.')], avatar: c.avatar, chName: c.name }); }
        return openWas(file);
    };
    const emitted = [];
    ctxTarget.eventTypes = { CHAT_DELETED: 'chat_deleted' };
    ctxTarget.eventSource = { emit: async (type, name) => { emitted.push([type, name]); if (type === 'chat_deleted') hub.onHubChatDeleted(name); } };    // DES's own listener, as index.js wires it
    hub.__setOpenersTransport(async () => '{"when":{"date":"Day 1","time":"dawn"},"openers":[{"title":"Landfall","text":"The boat grounds on shingle.","who":[]},{"title":"Fog","text":"Fog on the water.","who":[]},{"title":"Gulls","text":"Gulls wheel.","who":[]}]}');
    hub.__setGapTransport(async () => '{}');

    // §19 left Newland's first scene open, its chat not in front, and the card pointing at it.
    const s1 = scenesOf('newland')[0];
    const mapBefore = JSON.stringify(hub.worldEntry('newland').memory.stores.dooms_atlas);
    check('the fixture: scene 1 of a world is open, another card\'s chat is in front, and the world\'s card points at the scene\'s chat', s1.status === 'open' && files.has(s1.chat) && hub.currentScene() === null && ctxTarget.characters[newlandCard.index].chat === s1.chat);
    opens.length = 0;
    const calledBefore = calls.length;
    const d1 = await hub.deleteScene('newland', 's1');
    const sent = calls.slice(calledBefore).filter(c => c.url === '/api/chats/delete');
    check('deleted: the chat file through SillyTavern\'s own route, by its name and the card\'s avatar', d1.ok && d1.chat === 'deleted' && d1.opened === null && sent.length === 1 && same(sent[0].body, { chatfile: `${s1.chat}.jsonl`, avatar_url: newlandCard.avatar }) && !files.has(s1.chat), JSON.stringify([d1, sent]));
    check('its record is gone, the number is free again, and a scene can be started', scenesOf('newland').length === 0 && hub.worldEntry('newland').seq === 0 && hub.startPlanFor('newland').ok && hub.startPlanFor('newland').number === 1);
    check('the world itself is as it was: the map made before the scene is still its map', JSON.stringify(hub.worldEntry('newland').memory.stores.dooms_atlas) === mapBefore);
    const pointedAt = ctxTarget.characters[newlandCard.index].chat;
    check('the card no longer points at the deleted chat: at a new one, told to SillyTavern, so no empty chat of the old name is made', pointedAt !== s1.chat && pointedAt.startsWith(`${newlandCard.name} - `) && opens.includes(`point:${newlandCard.avatar}:${pointedAt}`) && opens.indexOf(`delete:${s1.chat}`) < opens.indexOf(`point:${newlandCard.avatar}:${pointedAt}`), JSON.stringify(opens));
    check('SillyTavern is told the chat is gone, after the record has gone', same(emitted, [['chat_deleted', s1.chat]]) && scenesOf('newland').length === 0, JSON.stringify(emitted));
    check('the chat in front was not touched', ctxTarget.chatId === 'Mara Vane - plain nine' && !opens.some(o => o.startsWith('open:')));

    // The scene in front, on a card with no other chat: a new chat is opened first, then the file goes.
    const p2 = await hub.prepareScene({ worldId: 'newland', seed: { kind: 'anywhere', text: 'Again.' }, place: { label: 'Landfall' }, cast: [], gap: { id: 'now' } });
    const c2 = await hub.commitScene(p2.token, { choice: 0 });
    check('started again: scene 1 once more, and in front', c2.ok && c2.scene.id === 's1' && hub.currentScene() && hub.currentScene().worldId === 'newland' && ctxTarget.chatId === c2.file);
    files.delete(pointedAt);    // the new chat the card was pointed at was never opened, so SillyTavern never made it
    opens.length = 0;
    emitted.length = 0;
    const d2 = await hub.deleteScene('newland', 's1');
    const opened2 = opens.find(o => o.startsWith('open:'));
    check('deleted while in front: another chat is opened before the file is deleted, so nothing is left saving into it', d2.ok && d2.chat === 'deleted' && !!opened2 && opens.indexOf(opened2) < opens.indexOf(`delete:${c2.file}`) && !files.has(c2.file), JSON.stringify(opens));
    check('with no other chat on the card it is a new one, and the result says so', d2.opened && d2.opened.fresh === true && d2.opened.name.startsWith(`${newlandCard.name} - `) && ctxTarget.chatId === d2.opened.name && files.has(d2.opened.name) && new RegExp(`A new chat is open on ${newlandCard.name}\\.`).test((await import(`${DES}/src/utils/hub.js`)).describeDeleteResult(d2)), JSON.stringify(d2.opened));
    check('the chat in front is no scene any more, and the world has none', hub.currentScene() === null && scenesOf('newland').length === 0 && same(emitted, [['chat_deleted', c2.file]]));

    // The scene in front, in a world with other scenes: the world's latest other scene's chat is opened in its place.
    const before = scenesOf(W);
    const aside = before.filter(x => x.status === 'aside' && !x.gone).pop();
    const ended = before.filter(x => x.status === 'ended' && !x.gone && x.chat && files.has(x.chat)).pop();
    const p3 = await hub.prepareScene({ worldId: W, seed: { kind: 'anywhere', text: 'On.' }, place: null, cast: [], gap: { id: 'now' } });
    const c3 = await hub.commitScene(p3.token, { choice: 0 });
    const seqWith = hub.worldEntry(W).seq;
    opens.length = 0;
    const d3 = await hub.deleteScene(W, c3.scene.id);
    const latestOther = scenesOf(W).slice().reverse().find(x => !x.gone && x.chat && files.has(x.chat));
    check('deleted while in front in a world with other scenes: the latest other scene\'s chat is open in its place', c3.ok && d3.ok && d3.opened && d3.opened.fresh === false && d3.opened.name === latestOther.chat && ctxTarget.chatId === latestOther.chat && !files.has(c3.file), JSON.stringify([d3.opened, latestOther && latestOther.chat]));
    check('the others are as they were, and the number it had is free', same(scenesOf(W).map(x => [x.id, x.status]), before.map(x => [x.id, x.status])) && hub.worldEntry(W).seq === seqWith - 1 && hub.startPlanFor(W).number === seqWith);
    const refreshed = await hub.refreshScenes(W);
    check('reading the card\'s chats again does not bring it back', refreshed.ok && !scenesOf(W).some(x => x.chat === c3.file));

    // What is not deleted.
    const callsBefore = calls.length;
    const no1 = await hub.deleteScene(W, ended.id);
    check('an ended scene is not deleted: the world remembers it; nothing is sent and its chat stays', no1.ok === false && no1.reason === 'ended' && files.has(ended.chat) && scenesOf(W).some(x => x.id === ended.id) && calls.length === callsBefore);
    check('no such scene, no such world: nothing happens', (await hub.deleteScene(W, 's999')).reason === 'no-scene' && (await hub.deleteScene('nowhere', 's1')).reason === 'no-world' && (await hub.deleteScene('', 's1')).reason === 'no-world');

    // SillyTavern refuses the delete: the scene stays, and says so.
    await openPlain('Mara Vane - plain ten');
    ctxTarget.characterId = 0;
    globalThis.__DES_DELETE_FAILS__ = true;
    const no2 = await hub.deleteScene(W, aside.id);
    globalThis.__DES_DELETE_FAILS__ = false;
    check('when SillyTavern does not delete the chat the scene stays in the list', no2.ok === false && no2.reason === 'file' && /400/.test(no2.error) && files.has(aside.chat) && scenesOf(W).some(x => x.id === aside.id && x.status === 'aside'), JSON.stringify(no2));
    // A set-aside scene, not in front and not what the card points at: the file and the record, nothing else.
    opens.length = 0;
    const pointedBefore = ctxTarget.characters[cardIndex('The Redward.png')] ? ctxTarget.characters[cardIndex('The Redward.png')].chat : '';
    const d4 = await hub.deleteScene(W, aside.id);
    check('a set-aside scene deleted from another chat: its file and its record go, nothing is opened', d4.ok && d4.chat === 'deleted' && d4.opened === null && !files.has(aside.chat) && !scenesOf(W).some(x => x.id === aside.id) && !opens.some(o => o.startsWith('open:')) && ctxTarget.chatId === 'Mara Vane - plain ten', JSON.stringify([d4, opens, pointedBefore]));
    // A scene whose chat is gone already loses its record alone.
    const p5 = await hub.prepareScene({ worldId: W, seed: { kind: 'anywhere', text: 'Once more.' }, place: null, cast: [], gap: { id: 'now' } });
    const c5 = await hub.commitScene(p5.token, { choice: 0 });
    ctxTarget.characterId = 0;
    ctxTarget.name2 = 'Mara Vane';
    await openPlain('Mara Vane - plain eleven');
    files.delete(c5.file);
    hub.onHubChatDeleted(c5.file);
    const sentBefore = calls.filter(c => c.url === '/api/chats/delete').length;
    const d5 = await hub.deleteScene(W, c5.scene.id);
    check('a scene whose chat is gone already: its record goes and nothing is asked of SillyTavern', c5.ok && d5.ok && d5.chat === 'gone' && !scenesOf(W).some(x => x.id === c5.scene.id) && calls.filter(c => c.url === '/api/chats/delete').length === sentBefore);
    ctxTarget.openCharacterChat = openWas;
    delete ctxTarget.eventSource;
    delete ctxTarget.eventTypes;
    hub.__setOpenersTransport(null);
    hub.__setGapTransport(null);
}

console.log('\n§21 a long chat read whole: a request a page, stopped, failed, taken up again (D198)');
{
    ctxTarget.characters.push({ name: 'Saga', avatar: 'Saga.png', chat: 'Saga - long' });
    ctxTarget.characterId = ctxTarget.characters.findIndex(c => c.avatar === 'Saga.png');
    ctxTarget.name2 = 'Saga';
    extensionSettings.lorebook = { enabled: false, campaigns: {}, campaignOrder: [], activeCampaignId: '' };
    const saga = 'Saga - long';
    files.set(saga, { header: { chat_metadata: {} }, messages: [], avatar: 'Saga.png', chName: 'Saga' });
    resetMeta();
    chat.length = 0;
    chat.push(ai('The road begins at the mill.'));
    ctxTarget.chatId = saga;
    await loaders();
    const leg = (i) => `leg-${String(i).padStart(3, '0')}`;
    const filler = ' The cart rolls on under a grey sky and Brannoch counts the milestones aloud while the mule complains.'.repeat(9);
    const LEGS = 90;
    for (let i = 1; i <= LEGS; i++) { chat.push(user(`We take ${leg(i)}.`)); chat.push({ is_user: false, name: 'Saga', mes: `On ${leg(i)} Brannoch finds the way.${filler}`, swipe_id: 0, swipes: [], extra: {} }); }
    const box = JSON.stringify({ date: { value: 'Day 90' }, time: { start: 'noon', end: 'dusk' }, location: { value: 'The mill road' }, weather: { emoji: '☁', forecast: 'grey' } });
    state.setLastGeneratedData({ ...state.lastGeneratedData, infoBox: box });
    state.setCommittedTrackerData({ ...state.committedTrackerData, infoBox: box });
    lw.recordCurrentScene();
    await persistence.saveChatData({ immediate: true });

    const plan = hub.scenesPlan();
    const reach = hub.adoptReach();
    const P = reach.pages;
    check('how much there is to read is known before anything is asked: every message, the requests the whole takes, about how many tokens it is', plan.ok && reach.messages === 1 + LEGS * 2 && P >= 4 && P <= 8 && reach.capped === false && reach.recent === 40 && reach.tokens >= 20000 && reach.tokens <= 30000 && reach.tokens % 1000 === 0, JSON.stringify([plan.ok, plan.reason, reach]));

    // What a request is told: the legs on its page, and the record so far.
    // A request's own part of the chat, apart from the lines that lead into it (D199).
    const own = (prompt) => { const u = String((prompt && prompt.user) || ''); const k = u.lastIndexOf('(This part)\n'); if (k >= 0) return u.slice(k + 12); const m = u.split(/The scene(?:, continued)?:\n/); return m[m.length - 1]; };
    const leadOf = (prompt) => { const u = String((prompt && prompt.user) || ''); const a = u.indexOf('The lines just before this part'); if (a < 0) return ''; const b = u.indexOf('(This part)\n', a); const c = u.search(/The scene, continued:\n/); return u.slice(a, b >= 0 ? b : c >= 0 ? c : u.length); };
    const legsIn = (prompt) => (own(prompt).match(/On leg-\d{3}/g) || []).map(x => x.slice(3));
    const reply = (prompt) => { const l = legsIn(prompt); return `{"recap":"The road ran as far as ${l[l.length - 1]}.","people":[{"name":"Brannoch","now":"On the mill road at ${l[l.length - 1]}."}],"threads":{"closed":[],"opened":[]}}`; };
    let asked = [];
    let fail = () => false;
    hub.__setRecapTransport(async (prompt) => { asked.push(prompt); if (fail(prompt, asked.length)) throw new Error('503 from the provider'); return reply(prompt); });

    // The last stretch only: one request, as before.
    const recent = await hub.prepareAdopt();
    check('asked for its last stretch only, one request reads the last forty messages and no further back', recent.ok && recent.whole === false && asked.length === 1 && legsIn(asked[0]).length === 20 && legsIn(asked[0])[0] === leg(LEGS - 19) && recent.recap === `The road ran as far as ${leg(LEGS)}.`, JSON.stringify([recent.ok, asked.length, legsIn(asked[0] || {}).length]));

    // The whole chat: a request a page, oldest first, each told the record so far.
    asked = [];
    const steps = [];
    const whole = await hub.prepareAdopt({ whole: true, onStep: (g) => steps.push(g) });
    const firsts = asked.map(a => legsIn(a)[0]);
    const lasts = asked.map(a => { const l = legsIn(a); return l[l.length - 1]; });
    check('read whole, the chat takes a request a page, from its first message to its last, none read twice', whole.ok && whole.whole === true && whole.pages === P && asked.length === P && firsts[0] === leg(1) && lasts[P - 1] === leg(LEGS) && asked.reduce((n, a) => n + legsIn(a).length, 0) === LEGS && asked.every((a, i) => i === 0 || Number(firsts[i].slice(4)) === Number(lasts[i - 1].slice(4)) + 1), JSON.stringify([whole.ok, whole.reason, asked.length, firsts, lasts]));
    check('each request is told the record as the ones before it left it, and the last one knows it is the last', asked.every((a, i) => i === 0 || JSON.stringify(a).includes(`The road ran as far as ${lasts[i - 1]}.`)) && !JSON.stringify(asked[0]).includes('The road ran as far as') && whole.recap === `The road ran as far as ${leg(LEGS)}.`, whole.recap);
    check('a request after the first is handed the last lines of the part before it, marked as recorded already, so it reads across the cut (D199); the first has none', leadOf(asked[0]) === '' && asked.slice(1).every((a, i) => { const l = leadOf(a); return /already in the record so far \(to read on from, not to record again\)/.test(l) && l.includes(`On ${lasts[i]} Brannoch finds the way.`) && l.includes(`We take ${lasts[i]}.`) && !own(a).includes(`On ${lasts[i]} `); }), JSON.stringify(asked.map(a => leadOf(a).length)));
    check('a cut never parts the player\'s message from the reply to it: every part after the first opens on the player\'s line', asked.slice(1).every(a => own(a).startsWith('Jordan: We take leg-')) && asked.every(a => /Saga: On leg-\d{3} Brannoch finds the way\./.test(own(a).split('\n').filter(x => x.trim() && !/^Answer with/.test(x)).pop())), JSON.stringify(asked.map(a => own(a).slice(0, 30))));
    check('where the people stand is carried from request to request: the last word on each is the one kept', whole.continuity.people.length === 1 && whole.continuity.people[0].name === 'Brannoch' && whole.continuity.people[0].now === `On the mill road at ${leg(LEGS)}.`, JSON.stringify(whole.continuity));
    check('the panel is told how every request stands as each is asked for: one running, the ones before it done', steps.length === P + 1 && steps.slice(0, P).every((g, i) => g.part === 'record' && g.page === i + 1 && g.pages === P && same(g.states, Array.from({ length: P }, (x, k) => (k < i ? 'done' : k === i ? 'run' : 'wait')))) && steps[P].states.every(x => x === 'done'), JSON.stringify(steps.map(g => g.states.join(','))));
    check('nothing is changed by the read, and nothing of it is left waiting', hub.worldEntry(plan.world.id) === null && hub.adoptPaused() === null && whole.skipped === 0 && whole.capped === false);

    // A request that fails once is asked for again by itself.
    asked = [];
    fail = (prompt, n) => n === 2;
    const flaky = await hub.prepareAdopt({ whole: true });
    check('a request that fails is asked for a second time before it counts: the read goes on', flaky.ok && asked.length === P + 1 && legsIn(asked[1])[0] === legsIn(asked[2])[0] && flaky.recap === `The road ran as far as ${leg(LEGS)}.`, JSON.stringify([flaky.ok, flaky.reason, asked.length]));

    // The requests go one at a time: none is sent before the one before it has come back.
    asked = [];
    fail = () => false;
    let out = 0;
    let most = 0;
    hub.__setRecapTransport(async (prompt) => { out++; most = Math.max(most, out); asked.push(prompt); await wait(8); out--; return reply(prompt); });
    const inTurn = await hub.prepareAdopt({ whole: true });
    check('the requests are sent one after another, never two at once', inTurn.ok && asked.length === P && most === 1);
    const pair = await Promise.all([hub.prepareAdopt({ whole: true }), hub.prepareAdopt({ whole: true })]);
    check('a second read asked for while one runs is refused, not run beside it', pair.filter(x => x.ok).length === 1 && pair.filter(x => !x.ok && x.reason === 'busy').length === 1 && most === 1, JSON.stringify(pair.map(x => [x.ok, x.reason])));
    hub.__setRecapTransport(async (prompt) => { asked.push(prompt); const why = fail(prompt, asked.length); if (why) throw new Error(why === true ? '503 from the provider' : why); return reply(prompt); });

    // The second try waits: a few moments, longer when the failure says the connection is held back.
    asked = [];
    fail = (prompt, n) => n === 2;
    let t0 = Date.now();
    const waitSteps = [];
    await hub.prepareAdopt({ whole: true, onStep: (g) => waitSteps.push(g.states.join(',')) });
    const plainWait = Date.now() - t0;
    asked = [];
    fail = (prompt, n) => (n === 2 ? '429 Too Many Requests' : false);
    t0 = Date.now();
    const limited = await hub.prepareAdopt({ whole: true });
    const limitedWait = Date.now() - t0;
    check('told "too many requests", the read waits longer before its second try, and goes on', limited.ok && asked.length === P + 1 && limitedWait >= 120 && limitedWait > plainWait + 60, JSON.stringify([limited.ok, plainWait, limitedWait]));
    check('while it waits the bar of that request says it is being tried again', waitSteps.some(x => x.split(',')[1] === 'retry') && waitSteps[waitSteps.length - 1].split(',').every(x => x === 'done'), JSON.stringify(waitSteps));
    asked = [];
    fail = (prompt, n) => { if (n === 2) { setTimeout(() => hub.stopAdopt(), 20); return '429 Too Many Requests'; } return false; };
    t0 = Date.now();
    const cut = await hub.prepareAdopt({ whole: true });
    check('Stop pressed during that wait ends it at once: the read stops at that request, to be carried on', cut.ok === false && cut.reason === 'stopped' && cut.page === 2 && cut.states[1] === 'wait' && asked.length === 2 && Date.now() - t0 < 110, JSON.stringify([cut.reason, cut.page, Date.now() - t0]));
    hub.dropAdoptRead();

    // The whole chat in one request, for a model that reads that much at once.
    asked = [];
    fail = () => false;
    const onceSteps = [];
    const once = await hub.prepareAdopt({ whole: true, once: true, onStep: (g) => onceSteps.push(g) });
    check('read in one request, the whole chat is handed over at once, first message to last', once.ok && once.whole === true && once.once === true && once.pages === 1 && asked.length === 1 && legsIn(asked[0]).length === LEGS && legsIn(asked[0])[0] === leg(1) && once.recap === `The road ran as far as ${leg(LEGS)}.` && onceSteps[0].pages === 1 && same(onceSteps[0].states, ['run']), JSON.stringify([once.ok, once.reason, asked.length, legsIn(asked[0] || {}).length]));
    asked = [];
    fail = () => 'context length exceeded';
    const tooBig = await hub.prepareAdopt({ whole: true, once: true });
    check('a model that cannot read that much fails the one request, and it says why: nothing is lost, and the chat can be read a part at a time instead', tooBig.ok === false && tooBig.reason === 'pass' && tooBig.pages === 1 && /context length exceeded/.test(tooBig.error) && hub.worldEntry(plan.world.id) === null);
    hub.dropAdoptRead();

    // One that fails twice stops the read there, with what was read kept.
    asked = [];
    const third = firsts[2];
    fail = (prompt) => legsIn(prompt)[0] === third;
    const stuck = await hub.prepareAdopt({ whole: true });
    const paused = hub.adoptPaused();
    check('a request that fails twice stops the read at it: the ones before are done, the ones after wait, and the failure is said', stuck.ok === false && stuck.reason === 'pass' && stuck.page === 3 && stuck.pages === P && same(stuck.states, Array.from({ length: P }, (x, k) => (k < 2 ? 'done' : k === 2 ? 'failed' : 'wait'))) && /503 from the provider/.test(stuck.error) && asked.length === 4, JSON.stringify(stuck));
    check('the read waits where it stopped', !!paused && paused.part === 'record' && paused.page === 3 && paused.states[2] === 'failed');
    asked = [];
    fail = () => false;
    const resumed = await hub.prepareAdopt({ whole: true, resume: true });
    check('tried again, only that request and the ones after it are asked for, told the record the second one left', resumed.ok && asked.length === P - 2 && legsIn(asked[0])[0] === third && JSON.stringify(asked[0]).includes(`The road ran as far as ${lasts[1]}.`) && resumed.recap === `The road ran as far as ${leg(LEGS)}.` && resumed.skipped === 0 && hub.adoptPaused() === null, JSON.stringify([resumed.ok, resumed.reason, asked.length]));

    // Skipped: the read goes on without that page.
    asked = [];
    const second = firsts[1];
    fail = (prompt) => legsIn(prompt)[0] === second;
    const stuck2 = await hub.prepareAdopt({ whole: true });
    asked = [];
    const skipped = await hub.prepareAdopt({ whole: true, resume: true, skip: true });
    check('skipped, the read goes on without that part: it is not asked for again, the next is told the record the first left and none of the skipped part\'s lines, and the answer says one was skipped', stuck2.reason === 'pass' && stuck2.page === 2 && skipped.ok && skipped.skipped === 1 && skipped.states[1] === 'skipped' && asked.length === P - 2 && legsIn(asked[0])[0] === third && JSON.stringify(asked[0]).includes(`The road ran as far as ${lasts[0]}.`) && !asked.some(a => legsIn(a)[0] === second) && leadOf(asked[0]) === '' && leadOf(asked[1]) !== '', JSON.stringify([stuck2.reason, skipped.ok, skipped.skipped, asked.length]));

    // Stop: the request in hand finishes, no more are asked for, and the read can be carried on.
    asked = [];
    fail = (prompt, n) => { if (n === 2) hub.stopAdopt(); return false; };
    const stopped = await hub.prepareAdopt({ whole: true });
    check('stopped, the request in hand finishes and no more are asked for', stopped.ok === false && stopped.reason === 'stopped' && asked.length === 2 && stopped.page === 3 && same(stopped.states.slice(0, 3), ['done', 'done', 'wait']) && hub.adoptPaused().page === 3, JSON.stringify(stopped));
    asked = [];
    fail = () => false;
    const carried = await hub.prepareAdopt({ whole: true, resume: true });
    check('carried on, it takes up at the next request', carried.ok && asked.length === P - 2 && legsIn(asked[0])[0] === third && carried.recap === `The road ran as far as ${leg(LEGS)}.`);
    // Started over: a read let go begins at the first page again.
    fail = (prompt) => legsIn(prompt)[0] === second;
    await hub.prepareAdopt({ whole: true });
    hub.dropAdoptRead();
    asked = [];
    fail = () => false;
    const afresh = await hub.prepareAdopt({ whole: true, resume: true });
    check('a read let go is not taken up: the next one starts at the chat\'s first page', hub.adoptPaused() === null && afresh.ok && asked.length === P && legsIn(asked[0])[0] === leg(1));

    // The ledger: Canon's own run, handed each page in turn.
    let canonAsked = [];
    let canonFail = () => false;
    cn.__setCanonTransport(async (prompt) => { canonAsked.push(prompt); const l = legsIn(prompt); if (canonFail(prompt, canonAsked.length)) return 'no ledger here'; return `{"add":[{"kind":"fact","name":"Road ${l[0]}","text":"Brannoch passed ${l[0]} and reached ${l[l.length - 1]}."}],"drop":[]}`; });
    const ledgerBefore = (meta.dooms_canon && meta.dooms_canon.entries ? meta.dooms_canon.entries.length : 0);
    const lsteps = [];
    const ledger = await hub.readAdoptLedger({ onStep: (g) => lsteps.push(g) });
    const entries = meta.dooms_canon.entries;
    check('the ledger reads the whole chat too: a request a page, each handed its own page, oldest first', ledger.ok && ledger.pages === P && ledger.added === P && ledger.skipped === 0 && canonAsked.length === P && same(canonAsked.map(a => legsIn(a)[0]), firsts) && legsIn(canonAsked[P - 1]).pop() === leg(LEGS), JSON.stringify([ledger, canonAsked.length]));
    check('the ledger\'s requests read across the cuts too: each after the first is handed the last lines of the part before, marked as read already', !String(canonAsked[0].user).includes('(This part)') && canonAsked.slice(1).every((a, i) => /They have been read already and are here to read on from/.test(leadOf(a)) && leadOf(a).includes(`On ${lasts[i]} Brannoch finds the way.`)), JSON.stringify(canonAsked.map(a => leadOf(a).length)));
    check('the ledger grows from page to page: a request is shown what the pages before it established', entries.length === ledgerBefore + P && firsts.every(f => entries.some(x => x.name === `Road ${f}`)) && JSON.stringify(canonAsked[1]).includes(`Road ${firsts[0]}`) && !JSON.stringify(canonAsked[0]).includes(`Road ${firsts[0]}`), JSON.stringify(entries.map(x => x.name)));
    check('its bars are told the same way', lsteps.length === P + 1 && lsteps[0].part === 'ledger' && same(lsteps[1].states.slice(0, 2), ['done', 'run']) && lsteps[P].states.every(x => x === 'done'));
    canonAsked = [];
    canonFail = (prompt) => legsIn(prompt)[0] === second;
    const lstuck = await hub.readAdoptLedger();
    check('a page the ledger cannot read twice running stops its read there, the ledger as far as it got', lstuck.ok === false && lstuck.reason === 'pass' && lstuck.page === 2 && lstuck.states[0] === 'done' && lstuck.states[1] === 'failed' && canonAsked.length === 3 && hub.adoptPaused().part === 'ledger', JSON.stringify(lstuck));
    canonAsked = [];
    const lskip = await hub.readAdoptLedger({ resume: true, skip: true });
    check('skipped or tried again as the record\'s read is: it goes on from there', lskip.ok && lskip.skipped === 1 && canonAsked.length === P - 2 && legsIn(canonAsked[0])[0] === third && hub.adoptPaused() === null, JSON.stringify([lskip, canonAsked.length]));
    extensionSettings.canon.enabled = false;
    check('with Canon off there is no ledger to read into', (await hub.readAdoptLedger()).reason === 'canon-off');
    extensionSettings.canon.enabled = true;
    // In one request: the whole chat handed to Canon at once, which may add more than a page's worth.
    canonAsked = [];
    canonFail = () => false;
    cn.__setCanonTransport(async (prompt) => { canonAsked.push(prompt); return JSON.stringify({ add: Array.from({ length: 40 }, (x, k) => ({ kind: 'thing', name: `Milestone ${k + 1}`, text: `Brannoch counted milestone ${k + 1} aloud.` })), drop: [] }); });
    const lonce = await hub.readAdoptLedger({ once: true });
    check('the ledger in one request: handed the whole chat at once, it may add more than a page does', lonce.ok && lonce.once === true && lonce.pages === 1 && canonAsked.length === 1 && legsIn(canonAsked[0]).length === LEGS && lonce.added > 16 && lonce.added <= 48, JSON.stringify([lonce.ok, lonce.reason, lonce.added, canonAsked.length]));

    // Taken: the memory holds what the ledger read.
    const done = await hub.commitAdopt({ recap: whole.recap, continuity: { people: whole.continuity.people.map(x => ({ name: x.name, now: x.now })), opened: [], closed: [] } });
    const entry = done.ok ? hub.worldEntry(done.worldId) : null;
    const kept = entry && entry.memory.stores.dooms_canon ? entry.memory.stores.dooms_canon.entries : [];
    check('taken after it, the world\'s memory holds the whole chat\'s ledger and its record', done.ok && entry.scenes[0].recap === `The road ran as far as ${leg(LEGS)}.` && firsts.filter(f => f !== second).every(f => kept.some(x => x.name === `Road ${f}`)) && entry.continuity.people[0].now === `On the mill road at ${leg(LEGS)}.`, JSON.stringify([done.ok, done.reason, kept.length]));

    // A chat longer than is read: the newest pages are the ones read, and it says so.
    await openPlain('Saga - endless');
    const big = 'x'.repeat(2500);
    for (let i = 0; i < 700; i++) chat.push({ is_user: false, name: 'Saga', mes: `${i} ${big}`, extra: {} });
    const far = hub.adoptReach();
    check('a chat longer than sixty requests read is read from sixty pages back, and says so', far.pages === 60 && far.capped === true && far.messages === 701, JSON.stringify(far));
    chat.length = 1;
    hub.__setRecapTransport(null);
    cn.__setCanonTransport(null);
}

console.log('\n§22 a scene opened from the list: its file looked for first, its card recorded as the one in front (D202)');
{
    const W = 'first-descent';
    ctxTarget.characterId = ctxTarget.characters.findIndex(c => c.avatar === 'Saga.png');
    ctxTarget.name2 = 'Saga';
    await openPlain('Saga - elsewhere');
    const sc = hub.worldEntry(W).scenes.find(x => x.id === 's1');
    const kept = files.get(sc.chat);
    globalThis.__DES_ACTIVE__ = [];
    opens.length = 0;
    const ok = await hub.openSceneChat(W, 's1');
    check('a scene whose chat is there is opened from another card\'s chat, and the answer says how many messages came up', ok.ok && ok.empty === false && ok.messages >= 1 && ctxTarget.chatId === sc.chat && ctxTarget.characters[ctxTarget.characterId].avatar === 'The Redward.png', JSON.stringify([ok, ctxTarget.chatId]));
    check('SillyTavern is told the scene\'s card is the one in front: a reload comes back to it, not to the card last clicked', same(globalThis.__DES_ACTIVE__, ['The Redward.png']), JSON.stringify(globalThis.__DES_ACTIVE__));
    // The file gone: SillyTavern asked for it would make an empty chat of that name and show it.
    ctxTarget.characterId = ctxTarget.characters.findIndex(c => c.avatar === 'Saga.png');
    ctxTarget.name2 = 'Saga';
    await openPlain('Saga - elsewhere');
    files.delete(sc.chat);
    globalThis.__DES_ACTIVE__ = [];
    opens.length = 0;
    const gone = await hub.openSceneChat(W, 's1');
    check('a scene whose chat file is not there is not opened: nothing is asked of SillyTavern, the chat in front stays, and the answer names the file', gone.ok === false && gone.reason === 'chat-gone' && gone.missing === sc.chat && !opens.some(o => o.startsWith('open:')) && ctxTarget.chatId === 'Saga - elsewhere' && globalThis.__DES_ACTIVE__.length === 0, JSON.stringify([gone, opens]));
    check('its record is marked gone and kept, and the words say what happened', hub.worldEntry(W).scenes.find(x => x.id === 's1').gone === true && /chat file is not there any more/.test(hubUtils.describeStartResult(gone)), hubUtils.describeStartResult(gone));
    files.set(sc.chat, kept);
    await hub.refreshScenes(W);
    check('the file back, the record is a scene again', hub.worldEntry(W).scenes.find(x => x.id === 's1').gone === false);
    // A chat that is there with nothing in it: opened, and said.
    // No scene in front, one being played elsewhere (D203): the Doom button's entry is the way back to it.
    {
        ctxTarget.characterId = ctxTarget.characters.findIndex(c => c.avatar === 'Saga.png');
        ctxTarget.name2 = 'Saga';
        await openPlain('Saga - elsewhere');
        check('with nothing being played anywhere there is no such entry', hub.sceneAway() === null && hub.sceneMenu() === null);
        // A scene started in the world and left: another chat opened over it.
        hub.__setOpenersTransport(async () => '{"when":{"date":"Day 50","time":"dawn"},"openers":[{"title":"The road","text":"The road is empty.","who":[]},{"title":"B","text":"Two.","who":[]},{"title":"C","text":"Three.","who":[]}]}');
        const pn = await hub.prepareScene({ worldId: W, seed: { kind: 'anywhere', text: 'On.' }, place: null, cast: [], gap: { id: 'now' } });
        const cn2 = pn.ok ? await hub.commitScene(pn.token, { choice: 0 }) : pn;
        hub.__setOpenersTransport(null);
        check('(a scene is started and left for another chat)', cn2.ok && hub.currentScene() !== null, JSON.stringify([pn.ok, pn.reason, cn2.ok, cn2.reason]));
        ctxTarget.characterId = ctxTarget.characters.findIndex(c => c.avatar === 'Saga.png');
        ctxTarget.name2 = 'Saga';
        await openPlain('Saga - elsewhere');
        const openOnes = Object.keys(extensionSettings.hub.worlds).flatMap(id => (hub.worldEntry(id).scenes || []).filter(x => x.status === 'open' && !x.gone).map(x => ({ id, x })));
        const latest = openOnes.slice().sort((a, b2) => (b2.x.startedAt || 0) - (a.x.startedAt || 0))[0];
        const away = hub.sceneAway();
        const m = hub.sceneMenu();

        check('from a chat that is no scene, the scene being played is found: of several worlds, the one started last', !!latest && !!away && away.worldId === latest.id && away.scene.id === latest.x.id, JSON.stringify([latest && [latest.id, latest.x.id], away && [away.worldId, away.scene.id]]));
        check('the Doom button\'s entry is then the way to it: its number, that it is not in front, Go to scene N', !!m && m.away === true && m.worldId === away.worldId && m.sceneId === away.scene.id && same(m.items.map(x => x.id), ['goto']) && m.items[0].label === `Go to scene ${away.scene.id.replace(/^s/, '')}`, JSON.stringify(m));
        const went = await hub.openSceneChat(m.worldId, m.sceneId);
        check('pressed, its chat is in front, and the entry is the scene\'s own again', went.ok && hub.currentScene() && hub.currentScene().scene.id === away.scene.id && hub.sceneAway() === null && hub.sceneMenu().away === false, JSON.stringify(went));
        extensionSettings.liveWorld.enabled = false;
        await openPlain('Saga - elsewhere');
        check('with Live World off there is no such entry', hub.sceneAway() === null && hub.sceneMenu() === null);
        extensionSettings.liveWorld.enabled = true;
        await openPlain('Saga - elsewhere');
    }
    files.set(sc.chat, { ...kept, messages: [] });
    const empty = await hub.openSceneChat(W, 's1');
    check('a chat that comes up with nothing in it is opened and the answer says so, for the player to be told', empty.ok && empty.empty === true && empty.messages === 0, JSON.stringify(empty));
    files.set(sc.chat, kept);
}

console.log('\n§23 a world with a narrator of its own, a long chat on another card taken as its scene 0 (D204: the owner\'s report)');
{
    // Harbourside has had its narrator, Mara Vane, since §1. A long chat on another card, on that world, is played as scenes.
    const W = 'harbourside';
    const third = ctxTarget.characters.findIndex(c => c.avatar === 'Third.png');
    ctxTarget.characterId = third;
    ctxTarget.name2 = 'Third';
    const was = extensionSettings.liveWorld.pack;
    extensionSettings.liveWorld.pack = W;
    const long = 'Third - the long chat';
    files.set(long, { header: { chat_metadata: {} }, messages: [], avatar: 'Third.png', chName: 'Third' });
    resetMeta();
    chat.length = 0;
    chat.push(ai('The harbour is quiet.'));
    for (let i = 1; i <= 3; i++) { chat.push(user(`Day ${i}.`)); chat.push({ is_user: false, name: 'Third', mes: `The tide turns on day ${i}.`, extra: {} }); }
    ctxTarget.chatId = long;
    ctxTarget.characters[third].chat = long;
    await loaders();
    lw.recordCurrentScene();
    await persistence.saveChatData({ immediate: true });
    extensionSettings.liveWorld.pack = was;
    const plan = hub.scenesPlan();
    check('the world keeps the narrator it has: the chat\'s own card is not made its narrator', plan.ok && plan.world.id === W && plan.card.avatar === 'Mara Vane.png' && hub.cardOf(W).avatar === 'Mara Vane.png', JSON.stringify([plan.ok, plan.reason, plan.card, plan.world]));
    const done = await hub.commitAdopt({ recap: 'Three days in the harbour.', replace: true });
    const s0 = done.ok ? hub.worldEntry(W).scenes.find(x => x.id === 's0') : null;
    check('taken, scene 0 is the long chat and its record names the card the chat is on, not the narrator', done.ok && !!s0 && s0.chat === long && s0.card === 'Third.png' && hub.worldEntry(W).card === 'Mara Vane.png', JSON.stringify([done.ok, done.reason, s0 && [s0.chat, s0.card]]));
    check('the card of a scene is its own where it has one, the world\'s narrator where it has none', hub.cardOfScene(W, s0).avatar === 'Third.png' && hub.cardOfScene(W, { id: 'sx', chat: 'x' }).avatar === 'Mara Vane.png' && hub.cardOfScene(W, { id: 'sx', chat: 'x', card: 'Nobody.png' }) === null);
    // From the narrator's card (a scene of the world, or any chat of it), scene 0 is opened.
    const mara = ctxTarget.characters.findIndex(c => c.avatar === 'Mara Vane.png');
    ctxTarget.characterId = mara;
    ctxTarget.name2 = 'Mara Vane';
    await openPlain('Mara Vane - between');
    globalThis.__DES_ACTIVE__ = [];
    opens.length = 0;
    const r0 = await hub.openSceneChat(W, 's0');
    check('opened from the narrator\'s card, scene 0 comes up on the card its chat is on, with its messages: its file is not looked for under the narrator', r0.ok && r0.empty === false && r0.messages === 7 && ctxTarget.characters[ctxTarget.characterId].avatar === 'Third.png' && ctxTarget.chatId === long && same(globalThis.__DES_ACTIVE__, ['Third.png']) && !files.has('Mara Vane - the long chat'), JSON.stringify([r0, ctxTarget.characters[ctxTarget.characterId].avatar, ctxTarget.chatId, opens]));
    check('nothing was made under the narrator\'s card in its name, and scene 0 is not marked gone', ![...files.entries()].some(([n, f]) => n === long && f.avatar === 'Mara Vane.png') && hub.worldEntry(W).scenes.find(x => x.id === 's0').gone !== true);
    // And a scene on the narrator's card is opened there, from the long chat.
    const onNarrator = hub.worldEntry(W).scenes.find(x => x.id !== 's0' && !x.gone && x.chat && x.card === 'Mara Vane.png' && files.has(x.chat));
    const r1 = onNarrator ? await hub.openSceneChat(W, onNarrator.id) : { ok: false, reason: 'none' };
    check('a scene on the narrator\'s card is opened on the narrator\'s card, from the long chat', r1.ok && ctxTarget.characters[ctxTarget.characterId].avatar === 'Mara Vane.png' && ctxTarget.chatId === onNarrator.chat, JSON.stringify([r1, onNarrator && onNarrator.id]));
    // The card of scene 0 gone: said, not opened on another.
    const keptCard = ctxTarget.characters[third];
    ctxTarget.characters[third] = { name: 'Gone', avatar: 'Gone.png', chat: '' };
    const noCard = await hub.openSceneChat(W, 's0');
    ctxTarget.characters[third] = keptCard;
    check('with the card of its chat gone, a scene is not opened on another card', noCard.ok === false && noCard.reason === 'card-gone');
}

console.log(failures ? `\n${failures} FAILED` : '\nall pass');
process.exit(failures ? 1 : 0);
