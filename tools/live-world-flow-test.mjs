#!/usr/bin/env node
/**
 * Live World in the chat: the state seeded from a pasted pack, kept per
 * chat, a reply counted once, the advancer run through the background
 * wrapper with its reply validated or discarded, the lines that ride a
 * generation, the chat switch and the re-seed.
 *
 * Usage:  node tools/live-world-flow-test.mjs     (from the repo root)
 * Exit:   0 = pass, 1 = failure
 *
 * Same sandbox as tools/dice-test.mjs; the request is replaced through the
 * module's test hook, so no profile switch and no network.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { buildSandbox } from './sandbox.mjs';

const { SANDBOX, DES } = buildSandbox();
if (!existsSync(`${DES}/src/systems/features/liveWorld.js`)) {
    console.error('FAIL: sandbox missing after load-check — cannot run.');
    process.exit(1);
}

globalThis.__DES_CHAT__ = [];
globalThis.__DES_CHAT_METADATA__ = {};
globalThis.__DES_SLOTS__ = {};
const scriptStub = `${SANDBOX}/script.js`;
writeFileSync(scriptStub, readFileSync(scriptStub, 'utf8')
    .replace('export const chat_metadata = anything;', 'export const chat_metadata = globalThis.__DES_CHAT_METADATA__;')
    .replace('export const chat = anything;', 'export const chat = globalThis.__DES_CHAT__;')
    .replace('export const setExtensionPrompt = anything;', 'export const setExtensionPrompt = (key, value, position, depth, scan, role) => { globalThis.__DES_SLOTS__[key] = { value, position, depth, role }; };')
    .replace('export const extension_prompt_roles = anything;', 'export const extension_prompt_roles = { SYSTEM: 0, USER: 1, ASSISTANT: 2 };')
    .replace('export const extension_prompt_types = anything;', 'export const extension_prompt_types = { IN_PROMPT: 0, IN_CHAT: 1 };')
    .replace('export const saveChatDebounced = anything;', 'export const saveChatDebounced = () => { globalThis.__DES_SAVES__.debounced++; };')
    .replace('export const saveChatConditional = anything;', 'export const saveChatConditional = async () => { globalThis.__DES_SAVES__.immediate++; };')
    + '\nexport let is_send_press = false;\nexport const __setSendPress = (v) => { is_send_press = v; };\n');
globalThis.__DES_SAVES__ = { debounced: 0, immediate: 0 };
const extStub = `${SANDBOX}/scripts/extensions.js`;
writeFileSync(extStub, readFileSync(extStub, 'utf8')
    .replace('export const getContext = anything;', 'export const getContext = () => globalThis.__DES_CTX__;'));

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
globalThis.__DES_CTX__ = new Proxy(
    { chat: globalThis.__DES_CHAT__, chat_metadata: globalThis.__DES_CHAT_METADATA__, name1: 'Jordan', chatId: 'test-chat', user_avatar: '' },
    { get: (t, p) => (p in t ? t[p] : anything) },
);
globalThis.window = globalThis;
globalThis.self = globalThis;
globalThis.document = anything;
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
Object.defineProperty(globalThis, 'navigator', {
    value: { hardwareConcurrency: 8, maxTouchPoints: 0 }, configurable: true,
});
globalThis.jQuery = anything;
globalThis.$ = anything;
globalThis.toastr = anything;
globalThis.requestAnimationFrame = () => 0;
globalThis.cancelAnimationFrame = () => {};
globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
globalThis.fetch = async () => ({ ok: false, status: 404, json: async () => ({}) });

const chat = globalThis.__DES_CHAT__;
const meta = globalThis.__DES_CHAT_METADATA__;
const slots = globalThis.__DES_SLOTS__;
const saves = globalThis.__DES_SAVES__;
const state = await import(`${DES}/src/core/state.js`);
const { extensionSettings, lastGeneratedData, committedTrackerData } = state;
const lw = await import(`${DES}/src/systems/features/liveWorld.js`);
const STUB = await import(`${SANDBOX}/script.js`);
const packJson = readFileSync(new URL('../worldpacks/example.json', import.meta.url), 'utf8');

let failures = 0;
const check = (label, cond, extra = '') => {
    if (cond) { console.log(`pass  ${label}`); }
    else { console.error(`FAIL  ${label}${extra ? '\n      ' + extra : ''}`); failures++; }
};
const user = (mes) => ({ is_user: true, name: 'Jordan', mes, extra: {} });
const ai = (mes) => ({ is_user: false, name: 'Narrator', mes, swipe_id: 0, swipes: [mes], extra: {} });
const resetMeta = () => { for (const k of Object.keys(meta)) delete meta[k]; };
const wait = (ms) => new Promise(r => setTimeout(r, ms));

extensionSettings.enabled = true;
extensionSettings.generationMode = 'together';
extensionSettings.connectionProfile = '';
extensionSettings.userCharacters = {};
extensionSettings.liveWorld = { enabled: true, pack: 'harbourside', every: 3, maxStep: 1, inject: true, depth: 2, role: 'system', recentMessages: 6, customPacks: {} };
lastGeneratedData.infoBox = '{"date":"Tuesday","time":"dusk","location":"the quay"}';
lastGeneratedData.characterThoughts = null;
committedTrackerData.characterThoughts = null;

console.log('\n§1 packs');
{
    const added = lw.addCustomPack(packJson);
    check('a pasted pack is stored under its id', added.ok && added.pack.id === 'harbourside' && typeof extensionSettings.liveWorld.customPacks.harbourside === 'string');
    const bad = lw.addCustomPack('{"name":"Nope"}');
    check('a pack with no places is refused and not stored', !bad.ok && bad.errors.some(e => e.includes('no places')) && !('nope' in extensionSettings.liveWorld.customPacks));
    check('not JSON is refused', !lw.addCustomPack('{nope').ok);
    check('the list offers the built-ins and the pasted ones', lw.listPackIds().includes('skyreach') && lw.listPackIds().includes('example') && lw.listPackIds().includes('harbourside'));
    const missing = await lw.loadPack('no-such-pack');
    check('a pack that is nowhere says so', !missing.ok && missing.errors[0].includes('No pack named'));
    const loaded = await lw.loadPack('harbourside');
    check('the pasted pack loads, normalised', loaded.ok && loaded.pack.places.length === 8);
}

console.log('\n§2 seeding and the chat');
resetMeta();
chat.length = 0;
await lw.onWorldChatChanged();
let s = lw.getWorldState();
check('a new chat is seeded from the chosen pack and written to the chat', !!s && s.seeded && s.pack === 'harbourside' && s.clocks.blockade === 1 && meta.dooms_world && meta.dooms_world.seeded === true && lw.getActivePack().name === 'Harbourside');
check('the lines ride a generation at the configured depth and role, raw', (lw.onWorldGenerationStarted(undefined, {}, false), slots['dooms-world-state'] && slots['dooms-world-state'].value.includes('[WORLD OF HARBOURSIDE: clocks: The blockade 1/6') && slots['dooms-world-state'].depth === 2 && slots['dooms-world-state'].role === 0), JSON.stringify(slots['dooms-world-state']));
check('a quiet prompt or an impersonation gets nothing', (lw.onWorldGenerationStarted('impersonate', {}, false), slots['dooms-world-state'].value === '') && (lw.onWorldGenerationStarted(undefined, { quiet_prompt: 'x' }, false), slots['dooms-world-state'].value === ''));
check('a dry run touches nothing', (slots['dooms-world-state'].value = 'keep', lw.onWorldGenerationStarted(undefined, {}, true), slots['dooms-world-state'].value === 'keep'));
extensionSettings.liveWorld.inject = false;
check('inject off: the slot is emptied', (lw.onWorldGenerationStarted(undefined, {}, false), slots['dooms-world-state'].value === ''));
extensionSettings.liveWorld.inject = true;
extensionSettings.liveWorld.role = 'user';
extensionSettings.liveWorld.depth = 4;
check('role and depth follow the settings', (lw.onWorldGenerationStarted(undefined, {}, false), slots['dooms-world-state'].depth === 4 && slots['dooms-world-state'].role === 1));
extensionSettings.liveWorld.role = 'system';
extensionSettings.liveWorld.depth = 2;
lw.onWorldGenerationEnded();
check('a seed is saved at once, a count debounced', saves.immediate >= 1 && saves.debounced === 0);

console.log('\n§3 counting');
chat.push(user('I run for the Anchor.'));
chat.push(ai('The cutter fires a warning shot.'));
lw.onWorldMessageReceived();
s = lw.getWorldState();
check('a fresh reply counts once and gets a stable id', s.sinceLast === 1 && typeof chat[1].dooms_world_id === 'string' && s.counted.includes(chat[1].dooms_world_id) && saves.debounced === 1);
lw.onWorldMessageReceived();
check('the same reply again (a swipe, a re-render) does not count', lw.getWorldState().sinceLast === 1);
chat.push(user('I duck inside.'));
lw.onWorldMessageReceived();
check("the player's message is not a reply", lw.getWorldState().sinceLast === 1);
lastGeneratedData.characterThoughts = JSON.stringify({ characters: [{ name: 'Old Marit', thoughts: 'x' }, { name: 'The governor' }] });
chat.push(ai('Old Marit looks up.'));
lw.onWorldMessageReceived();
s = lw.getWorldState();
check("the tracker's present characters become known", s.sinceLast === 2 && s.known['Old Marit'] === 'known' && s.known['The governor'] === 'known');

console.log('\n§4 the advancer');
let lastPrompt = null;
lw.__setWorldTransport(async (prompt) => { lastPrompt = prompt; return '```json\n{"elapsed":"a day","clocks":{"blockade":2},"moved":[{"who":"Old Marit","to":"back-room","reason":"hiding"}],"blurb":"The quay is quiet.","heard":["Maeve"]}\n```'; });
chat.push(user('I wait.'));
chat.push(ai('Night falls over Harbourside.'));
lw.onWorldMessageReceived();
check('the third counted reply makes the advance due', lw.getWorldState().sinceLast === 3);
await wait(600);
s = lw.getWorldState();
const immediateBefore = saves.immediate;
check('the advancer ran through the wrapper and wrote the validated reply', !!lastPrompt && s.clocks.blockade === 2 && s.where['Old Marit'] === 'harbourside/old-town/the-anchor/back-room' && s.known['Maeve'] === 'heard' && s.blurb === 'The quay is quiet.' && s.sinceLast === 0 && s.last && s.last.ok && s.last.gameDate === 'Tuesday' && s.last.msgId === chat[5].dooms_world_id, JSON.stringify(s.last));
check('the prompt carried the recent scenes, the clocks, the tree and now', lastPrompt.user.includes('Narrator: Night falls over Harbourside.') && lastPrompt.user.includes('- blockade ("The blockade"): now 1 of 6') && lastPrompt.user.includes('back-room (The Anchor\'s back room)') && lastPrompt.user.includes('Now: Tuesday, dusk, at the quay.'), lastPrompt.user);
check('the lines now carry the move', lw.buildWorldLinesNow().includes("Old Marit: The Anchor's back room, The Anchor, a tavern (Tuesday)"));
check('the state is saved on the chat at once, the clock change and the move logged', meta.dooms_world.clocks.blockade === 2 && meta.dooms_world.log.length === 2 && meta.dooms_world.log[0].kind === 'clock' && saves.immediate === immediateBefore);
lw.__setWorldTransport(async () => '{"clocks":{"blockade":5}}');
let r = await lw.advanceNow({ reason: 'manual' });
s = lw.getWorldState();
check('a reply that breaks a rule is discarded whole and asks for a retry', !r.ok && r.reason === 'invalid' && r.errors[0].includes('more than 1') && s.clocks.blockade === 2 && s.retryNext === true && s.lastError.error.includes('more than 1'));
lw.__setWorldTransport(async () => 'I cannot do that.');
r = await lw.advanceNow({ reason: 'manual' });
check('prose instead of JSON is discarded too', !r.ok && r.reason === 'invalid' && lw.getWorldState().clocks.blockade === 2);
lw.__setWorldTransport(async () => { throw new Error('network down'); });
r = await lw.advanceNow({ reason: 'manual' });
check('a thrown request is a failed run, nothing written', !r.ok && r.reason === 'error' && r.error === 'network down' && lw.getWorldState().clocks.blockade === 2 && lw.getWorldState().retryNext === true);
lw.__setWorldTransport(async () => '{"clocks":{"blockade":3},"moved":[],"heard":[],"blurb":""}');
chat.push(user('And then?'));
chat.push(ai('Morning.'));
lw.onWorldMessageReceived();
await wait(600);
s = lw.getWorldState();
check('after a failure the very next reply runs it again', s.clocks.blockade === 3 && s.retryNext === false && s.lastError === null && s.sinceLast === 0);
lw.__setWorldTransport(async () => '{"clocks":{"blockade":4}}');
state.setIsGenerating(true);
r = await lw.advanceNow({ reason: 'manual' });
check('while another background request holds the flag the advance waits', !r.ok && r.reason === 'busy' && lw.getWorldState().clocks.blockade === 3);
state.setIsGenerating(false);
lw.onWorldGenerationEnded();
await wait(600);
check('...and runs when the generation ends', lw.getWorldState().clocks.blockade === 4);

console.log('\n§5 the chat switch and the re-seed');
const saved = JSON.parse(JSON.stringify(meta.dooms_world));
const savedChat = JSON.parse(JSON.stringify(chat));
resetMeta();
chat.length = 0;
globalThis.__DES_CTX__.chatId = 'other-chat';
await lw.onWorldChatChanged();
check('another chat starts from the pack again', lw.getWorldState().clocks.blockade === 1 && lw.getWorldState().log.length === 0);
resetMeta();
meta.dooms_world = saved;
chat.length = 0;
chat.push(...savedChat);
globalThis.__DES_CTX__.chatId = 'test-chat';
await lw.onWorldChatChanged();
check('coming back loads the stored state, not a fresh seed, nothing wound back', lw.getWorldState().clocks.blockade === 4 && lw.getWorldState().where['Old Marit'].endsWith('back-room') && lw.getWorldState().log.length === saved.log.length);
extensionSettings.liveWorld.pack = 'skyreach';
await lw.onWorldChatChanged();
check('a chat keeps the pack it was seeded with', lw.getActivePack().id === 'harbourside');
const reseeded = await lw.reseedWorld();
check('a re-seed with a pack that cannot load keeps the world and says why, without calling the kept world missing', !reseeded.ok && reseeded.error.includes('No pack named "skyreach"') && lw.getWorldState().clocks.blockade === 4 && lw.getPackError() === '');
extensionSettings.liveWorld.pack = 'harbourside';
await lw.reseedWorld();
check('...here the pasted one, since the built-in cannot be fetched in the sandbox', lw.getActivePack().id === 'harbourside' && lw.getWorldState().clocks.blockade === 1 && lw.getWorldState().log.length === 0);
extensionSettings.liveWorld.enabled = false;
await lw.onWorldChatChanged();
check('off: no state, no lines, no advance', lw.getWorldState() === null && (lw.onWorldGenerationStarted(undefined, {}, false), slots['dooms-world-state'].value === '') && (await lw.advanceNow()).reason === 'off');
lw.onWorldGenerationEnded();
extensionSettings.liveWorld.enabled = true;
await lw.onWorldChatChanged();
check('the master switch off drops the world and clears the line without a generation; on brings it back', (slots['dooms-world-state'].value = 'stale', extensionSettings.enabled = false, await lw.onWorldChatChanged(), lw.getWorldState() === null && slots['dooms-world-state'].value === '') && (extensionSettings.enabled = true, await lw.onWorldChatChanged(), lw.getWorldState() !== null && lw.getWorldState().clocks.blockade === 1));

console.log('\n§6 the views\' reading (D69: the window\'s glance, a face, the board)');
{
    const M = await import(`${DES}/src/utils/liveWorld.js`);
    const V = await import(`${DES}/src/systems/ui/worldViews.js`);
    const pack = lw.getActivePack();
    const cfg = M.liveWorldConfig(extensionSettings);
    let st = lw.getWorldState();
    const v = M.validateAdvance({ elapsed: 'a day', clocks: { blockade: 2 }, moved: [{ who: 'Old Marit', to: 'back-room', reason: 'hiding' }], blurb: 'The quay is quiet.', heard: ['Maeve'] }, pack, st);
    st = M.applyAdvance(st, v.clean, pack, { msgId: 'm1', gameDate: 'Thursday', gameTime: 'dawn', ranAt: 1 });
    const tileOf = (html, id) => { const i = html.indexOf(`data-place="${id}"`); if (i < 0) return ''; const rest = html.slice(i + 1); const j = rest.indexOf('class="dooms-board-tile'); return j < 0 ? rest : rest.slice(0, j); };
    // the window: its first line, the glance, then the board below
    const page = V.worldWindowHtml({ state: st, pack, cfg, facts: { date: 'Thursday', time: 'dawn', location: 'the quay' }, portraits: () => '' });
    check('the window: the pack, the tracker\'s date, the blurb, when it moved and when it runs next, the glance above the board', page.includes('class="dooms-world-window"') && page.includes('Harbourside') && page.includes('Thursday, dawn · at the quay') && page.includes('The quay is quiet.') && page.includes('Last advanced on Thursday') && page.includes('next run in') && page.indexOf('dooms-world-glance') < page.indexOf('dooms-board-trail'), page.slice(0, 400));
    check('word on the street: the effect text, never the number, the clock\'s name only as a title', page.includes('Cargo is searched on the quay') && !page.includes('2/6') && page.includes('title="The blockade"'));
    check('faces: a card per known character with the place under the name and the date of the last move', page.includes('class="dooms-portrait-card dooms-world-card" data-name="Old Marit"') && page.includes("The Anchor&#39;s back room, The Anchor, a tavern") && page.includes('class="dooms-world-when" title="Last moved Thursday, dawn">Thursday'), page);
    check('heard-of names in the dashed box, not as cards', page.includes('dooms-world-heard') && page.includes('Maeve') && !page.includes('data-name="Maeve"'));
    check('a portrait when the store has one, initials otherwise', V.worldWindowHtml({ state: st, pack, cfg, portraits: (n) => n === 'Old Marit' ? 'data:image/png;base64,x' : '' }).includes('<img src="data:image/png;base64,x" alt="" />') && page.includes('>OM</div>'));
    check('spoiler-free: the clock names go and the head says so', (() => { const sf = V.worldWindowHtml({ state: st, pack, cfg: { ...cfg, spoilerFree: true } }); return !sf.includes('title="The blockade"') && sf.includes('Spoiler-free.'); })());
    check('off, a pack problem, no world, the master switch: each says so', V.worldWindowHtml({ cfg: { ...cfg, enabled: false } }).includes('Live World is off') && V.worldWindowHtml({ cfg, packError: 'No pack named "x".' }).includes('No pack named') && V.worldWindowHtml({ cfg }).includes('no world yet') && V.worldWindowHtml({ state: st, pack, cfg, masterOn: false }).includes('Enhancement Suite is off'));
    const failed = M.failAdvance(st, { error: 'The clock "blockade" moved by 3, more than 1.' });
    check('a discarded attempt is said, the rule kept out when spoiler-free', V.worldWindowHtml({ state: failed, pack, cfg }).includes('Last attempt discarded: The clock') && !V.worldWindowHtml({ state: failed, pack, cfg: { ...cfg, spoilerFree: true } }).includes('blockade'));
    const broken = M.failAdvance(st, { error: 'network down', kind: 'error' });
    check('a request that failed says so, spoiler-free or not, and that it runs again', V.worldWindowHtml({ state: broken, pack, cfg: { ...cfg, spoilerFree: true } }).includes('The last advance failed: network down') && V.worldWindowHtml({ state: broken, pack, cfg }).includes('runs again on the next reply'));
    check('model-written text is escaped in the window', V.worldWindowHtml({ state: { ...st, blurb: '<img src=x onerror=alert(1)>' }, pack, cfg }).includes('&lt;img src=x onerror=alert(1)&gt;'));
    // a face
    const face = V.faceTrailHtml({ state: st, pack, name: 'Old Marit', portraits: () => '' });
    check('the face: the name, where now, the move with its date and reason, where the story found them', face.includes('class="dooms-face-name">Old Marit<') && face.includes("Now at The Anchor&#39;s back room") && face.includes('Thursday, dawn · hiding') && face.includes('Where the story found them') && face.includes('1 move on record'), face);
    let ring = st;
    for (let i = 0; i < 25; i++) ring = M.applyAdvance(ring, { clocks: {}, moved: [{ who: 'Old Marit', to: i % 2 ? 'the-hill' : 'back-room' }], heard: [], blurb: '' }, pack, { msgId: `t${i}`, gameDate: `Day ${i}` });
    check('a trail the ring has trimmed says "Earlier at", newest first', (() => { const h = V.faceTrailHtml({ state: ring, pack, name: 'Old Marit' }); return h.includes('Earlier at') && !h.includes('Where the story found them') && h.indexOf('Day 24') < h.indexOf('Day 23'); })());
    check('a face with no moves says where they stand, or nowhere', V.faceTrailHtml({ state: M.seedWorldState(pack), pack, name: 'Captain Reyes' }).includes('From the start, or before the log') && V.faceTrailHtml({ state: M.markKnown(M.seedWorldState(pack), ['Wanderer']), pack, name: 'Wanderer' }).includes('Nowhere yet'));
    check("a face's text is escaped", V.faceTrailHtml({ state: { ...st, log: [...st.log, { kind: 'move', who: 'Old Marit', from: '', to: 'the-hill', reason: '<script>x</script>', gameDate: '' }] }, pack, name: 'Old Marit' }).includes('&lt;script&gt;'));
    // the board
    const board = V.boardHtml({ state: st, pack, cfg, portraits: (n) => n === 'Old Marit' ? 'data:image/png;base64,x' : '' });
    check('the province: the trail starts at the pack, one tile for Harbourside with three places inside, a city glyph', board.includes('class="dooms-board-trail"') && board.includes('class="dooms-board-crumb is-here" data-root=""') && board.includes('class="dooms-board-step" data-root="harbourside"') && board.includes('3 inside') && board.includes('fa-city'), board.slice(0, 500));
    check('tokens on the tile: a portrait when there is one, initials otherwise, heard-of names absent', board.includes('<img class="dooms-world-token" src="data:image/png;base64,x" alt="Old Marit"') && board.includes('>CR</span>') && !board.includes('Maeve'));
    const inside = V.boardHtml({ state: st, pack, cfg, root: 'harbourside' });
    check('inside Harbourside: the three districts, the clock on the docks, Marit on Old Town, no one on the Hill', inside.includes('data-root="the-docks"') && inside.includes('data-root="old-town"') && tileOf(inside, 'the-docks').includes('Cargo is searched on the quay') && tileOf(inside, 'old-town').includes('Old Marit') && !tileOf(inside, 'the-hill').includes('dooms-board-people'), inside);
    check('the trail says where you are and leads back out; the glyph deepens', inside.includes('class="dooms-board-crumb is-here" data-root="harbourside" aria-current="location"') && inside.includes('class="dooms-board-crumb" data-root=""') && inside.includes('fa-landmark'));
    const leaf = V.boardHtml({ state: st, pack, cfg, root: 'back-room' });
    check('a leaf: nothing inside, whoever stands there is here', leaf.includes('Nothing lies inside') && leaf.includes('Here:') && leaf.includes('Old Marit'), leaf);
    const hostilePack = M.normalizePack({ ...JSON.parse(packJson), places: [{ id: 'h', label: '<b>Hall</b> & "co"', image: 'javascript:alert(1)' }, { id: 'ok', parent: 'h', image: 'https://x/y.png' }] }).pack;
    const hostile = V.boardHtml({ state: M.seedWorldState(hostilePack), pack: hostilePack, cfg }) + V.boardHtml({ state: M.seedWorldState(hostilePack), pack: hostilePack, cfg, root: 'h' });
    check('labels are escaped, a scripted image is dropped and a plain one wears the tile', hostile.includes('&lt;b&gt;Hall&lt;/b&gt; &amp; &quot;co&quot;') && !hostile.includes('javascript:') && hostile.includes('url(&quot;https://x/y.png&quot;)') && hostile.includes('dooms-board-tile has-image'));
    check('the board says the same as the window when there is nothing to draw', V.boardHtml({ cfg: { ...cfg, enabled: false } }).includes('Live World is off') && V.boardHtml({ state: st, pack, cfg, masterOn: false }).includes('Enhancement Suite is off'));
    const loner = M.markKnown(M.seedWorldState(pack), ['Wanderer']);
    check('a known name with no place is listed under the tiles; the names off this board as elsewhere', V.boardHtml({ state: loner, pack, cfg }).includes('Not yet placed: Wanderer') && V.boardHtml({ state: st, pack, cfg, root: 'the-hill' }).includes('Elsewhere: Captain Reyes, Old Marit'));
    check('lately: the move and the step under their date, the filter remembering its choice', board.includes('class="dooms-board-feed-date">Thursday') && board.includes('<option value="12" selected>Latest 12</option>') && board.includes('<li class="is-clock">The blockade: Cargo is searched on the quay') && board.includes('<li class="is-move">Old Marit:'));
    let busy = st;
    // three movers: the log keeps twenty moves per character, so two could never pass fifty
    for (let i = 0; i < 25; i++) busy = M.applyAdvance(busy, { clocks: {}, moved: [{ who: 'Old Marit', to: i % 2 ? 'the-hill' : 'back-room' }, { who: 'Captain Reyes', to: i % 2 ? 'the-docks' : 'the-hill' }, { who: 'The governor', to: i % 2 ? 'old-town' : 'the-docks' }], heard: [], blurb: '' }, pack, { msgId: `b${i}` });
    check('the filter bounds lately: twelve, fifty, everything', busy.log.length > 50 && (V.boardHtml({ state: busy, pack, cfg }).match(/<li class="is-/g) || []).length === 12 && (V.boardHtml({ state: busy, pack, cfg, feed: 50 }).match(/<li class="is-/g) || []).length === 50 && (V.boardHtml({ state: busy, pack, cfg, feed: 0 }).match(/<li class="is-/g) || []).length === busy.log.length);
    check('entries with no date get their own heading when dated ones exist', V.boardHtml({ state: M.applyAdvance(st, { clocks: {}, moved: [{ who: 'Captain Reyes', to: 'the-hill' }], heard: [], blurb: '' }, pack, { msgId: 'u' }), pack, cfg }).includes('class="dooms-board-feed-date">No date'));
    const flags = (() => { const s2 = M.markKnown(M.seedWorldState(pack), ['🇬🇧 Bill', 'ßen Low']); s2.where['🇬🇧 Bill'] = 'harbourside/the-hill'; s2.where['ßen Low'] = 'harbourside'; return s2; })();
    const flagBoard = V.boardHtml({ state: flags, pack, cfg, root: 'harbourside' });
    check('a flag or a letter with no single upper case opens a name as one initial; whoever stands at the place itself is here', flagBoard.includes('>🇬🇧B</span>') && flagBoard.includes('Here:') && flagBoard.includes('>ßL</span>'), flagBoard);
}

console.log('\n§7 an advance that outlives its chat');
{
    let calls = 0;
    lw.__setWorldTransport(async () => { calls++; return '{"clocks":{"blockade":2}}'; });
    resetMeta(); chat.length = 0; globalThis.__DES_CTX__.chatId = 'chat-a';
    await lw.onWorldChatChanged();
    for (let i = 0; i < 3; i++) { chat.push(user('…')); chat.push(ai(`Scene ${i}.`)); lw.onWorldMessageReceived(); }
    check('three replies make chat A due', lw.getWorldState().sinceLast === 3);
    resetMeta(); chat.length = 0; globalThis.__DES_CTX__.chatId = 'chat-b';
    await lw.onWorldChatChanged();
    await wait(600);
    check('the advance armed in A never runs in B', calls === 0 && lw.getWorldState().sinceLast === 0 && lw.getWorldState().clocks.blockade === 1);
    let resolveReply = null;
    lw.__setWorldTransport(() => new Promise(res => { resolveReply = res; }));
    const inFlight = lw.advanceNow({ reason: 'manual' });
    await wait(20);
    check('an advance in flight holds the running flag', lw.isAdvancing() && typeof resolveReply === 'function');
    resetMeta(); chat.length = 0; globalThis.__DES_CTX__.chatId = 'chat-c';
    await lw.onWorldChatChanged();
    const before = JSON.stringify(lw.getWorldState());
    resolveReply('{"clocks":{"blockade":2},"moved":[{"who":"Old Marit","to":"back-room"}],"blurb":"From A."}');
    const r = await inFlight;
    check('its reply is discarded: C untouched, nothing written, the result says so', r.reason === 'stale' && JSON.stringify(lw.getWorldState()) === before && meta.dooms_world.clocks.blockade === 1 && meta.dooms_world.log.length === 0 && !lw.isAdvancing() && lw.describeAdvanceResult(r).includes('chat changed'));
    let rejectReply = null;
    lw.__setWorldTransport(() => new Promise((_, rej) => { rejectReply = rej; }));
    const failing = lw.advanceNow({ reason: 'manual' });
    await wait(20);
    resetMeta(); chat.length = 0; globalThis.__DES_CTX__.chatId = 'chat-d';
    await lw.onWorldChatChanged();
    rejectReply(new Error('network down'));
    const rf = await failing;
    check('a request that fails after the switch writes no failure into the new chat', rf.reason === 'stale' && lw.getWorldState().retryNext === false && lw.getWorldState().lastError === null);
    // SillyTavern swaps the chat and its metadata before CHAT_CHANGED reaches the module: a reply in that window is stale too
    lw.__setWorldTransport(() => new Promise(res => { resolveReply = res; }));
    const during = lw.advanceNow({ reason: 'manual' });
    await wait(20);
    globalThis.__DES_CTX__.chatId = 'chat-e-early';
    resolveReply('{"clocks":{"blockade":2}}');
    const rd = await during;
    check('a reply that lands after the chat id changed but before the load is discarded', rd.reason === 'stale' && meta.dooms_world.clocks.blockade === 1);
    await lw.onWorldChatChanged();
}

console.log('\n§8 a greeting, a regenerate, a deleted reply, a branch');
{
    lw.__setWorldTransport(async () => '{"clocks":{"blockade":2},"moved":[{"who":"Old Marit","to":"back-room"}]}');
    resetMeta(); chat.length = 0; globalThis.__DES_CTX__.chatId = 'chat-e';
    await lw.onWorldChatChanged();
    chat.push(ai('Welcome to Harbourside.'));
    lw.onWorldMessageReceived(0, 'first_message');
    check('the greeting of a new chat is not counted', lw.getWorldState().sinceLast === 0 && chat[0].dooms_world_id === undefined);
    chat.push(user('I look around.')); chat.push(ai('The quay.')); lw.onWorldMessageReceived(2);
    const firstId = chat[2].dooms_world_id;
    check('a reply counts', lw.getWorldState().sinceLast === 1 && typeof firstId === 'string');
    lw.onWorldGenerationStarted('regenerate', {}, false);
    chat.pop();
    lw.onWorldMessageDeleted();
    check('the deletion a regenerate makes does not wind the world back', lw.getWorldState().sinceLast === 1);
    chat.push(ai('The quay, again.'));
    lw.onWorldMessageReceived(2);
    lw.onWorldGenerationEnded();
    check("the regenerated reply takes the deleted one's id and is not counted again", chat[2].dooms_world_id === firstId && lw.getWorldState().sinceLast === 1);
    chat.push(user('Then?'));
    lw.onWorldGenerationStarted('regenerate', {}, false);
    chat.push(ai('Then rain.'));
    lw.onWorldMessageReceived(4);
    lw.onWorldGenerationEnded();
    check('a regenerate with no reply to replace counts the new reply', lw.getWorldState().sinceLast === 2 && chat[4].dooms_world_id !== firstId);
    chat.push(user('And?')); chat.push(ai('Night.')); lw.onWorldMessageReceived(6);
    await wait(600);
    let s = lw.getWorldState();
    check('the third reply advanced, stamped on it', s.clocks.blockade === 2 && s.last.msgId === chat[6].dooms_world_id && s.where['Old Marit'].endsWith('back-room') && s.sinceLast === 0 && s.log.length === 2);
    // regenerating the reply that carried the advance keeps the advance: same slot
    const advancedId = chat[6].dooms_world_id;
    lw.onWorldGenerationStarted('regenerate', {}, false);
    chat.pop();
    lw.onWorldMessageDeleted();
    check('the regenerate\'s own deletion leaves the advance standing', lw.getWorldState().clocks.blockade === 2 && lw.getWorldState().last.msgId === advancedId);
    chat.push(ai('Night, again.'));
    lw.onWorldMessageReceived(6);
    lw.onWorldGenerationEnded();
    check('the regenerated reply takes the advanced reply\'s id; nothing counted or undone', chat[6].dooms_world_id === advancedId && lw.getWorldState().clocks.blockade === 2 && lw.getWorldState().sinceLast === 0);
    // a regenerate that never produces its reply: the slot is void, its count withdrawn when the player moves on
    lw.onWorldGenerationStarted('regenerate', {}, false);
    chat.pop();
    lw.onWorldMessageDeleted();
    lw.onWorldGenerationEnded();    // the request failed or was stopped: no reply
    check('after a failed regenerate the state still waits for the slot', lw.getWorldState().counted.includes(advancedId) && lw.getWorldState().clocks.blockade === 2);
    chat.push(user('Never mind.'));
    lw.onWorldMessageSent();
    s = lw.getWorldState();
    check('a new message from the player voids the slot: its count withdrawn and, nothing newer standing, its run undone', !s.counted.includes(advancedId) && s.sinceLast === 2 && s.clocks.blockade === 1 && s.last === null && s.where['Old Marit'].endsWith('the-anchor'), JSON.stringify(s));
    chat.push(ai('Rain.'));
    lw.onWorldMessageReceived(7);
    s = lw.getWorldState();
    check('the next reply is counted fresh and, the third since the last standing run, is due', s.sinceLast === 3 && chat[7].dooms_world_id !== advancedId);
    await wait(600);
    s = lw.getWorldState();
    check('it advanced again, stamped on the new reply', s.clocks.blockade === 2 && s.last.msgId === chat[7].dooms_world_id);
    chat.pop(); chat.pop();
    lw.onWorldMessageDeleted();
    s = lw.getWorldState();
    check('deleting back past that slot undoes its advance: clock and place back, no last run, the count resumed, saved', s.clocks.blockade === 1 && s.where['Old Marit'].endsWith('the-anchor') && s.last === null && s.sinceLast === 2 && s.log.length === 0 && meta.dooms_world.clocks.blockade === 1, JSON.stringify(s));
    chat.push(ai('Night.')); lw.onWorldMessageReceived(6); await wait(600);
    const full = JSON.parse(JSON.stringify(meta.dooms_world));
    check('a new reply in its place advances again', full.clocks.blockade === 2 && lw.getWorldState().last.msgId === chat[6].dooms_world_id);
    const branch = chat.slice(0, 5).map(m => JSON.parse(JSON.stringify(m)));
    resetMeta(); meta.dooms_world = full; chat.length = 0; chat.push(...branch); globalThis.__DES_CTX__.chatId = 'chat-e-branch';
    await lw.onWorldChatChanged();
    s = lw.getWorldState();
    check('a branch cut before the advance loads wound back to its own messages', s.clocks.blockade === 1 && s.where['Old Marit'].endsWith('the-anchor') && s.last === null && s.sinceLast === 2 && s.pack === 'harbourside' && meta.dooms_world.clocks.blockade === 1, JSON.stringify(s));
    // the third pass: a hidden reply still stands (D44), a manual run lands on it, a regenerate of it inherits
    chat[4].is_system = true;    // /hide: the reply leaves the prompt, not the chat
    await lw.onWorldChatChanged();
    s = lw.getWorldState();
    check('a reply hidden with /hide keeps its count across a reload: hidden is not gone', s.sinceLast === 2 && s.counted.includes(chat[4].dooms_world_id), JSON.stringify(s.counted));
    const onHidden = await lw.advanceNow({ reason: 'manual' });
    s = lw.getWorldState();
    check('a manual advance is stamped on the newest reply even when that reply is hidden', onHidden.ok && s.last.msgId === chat[4].dooms_world_id && s.clocks.blockade === 2 && s.sinceLast === 0, JSON.stringify([onHidden, s.last]));
    const hiddenId = chat[4].dooms_world_id;
    lw.onWorldGenerationStarted('regenerate', {}, false);
    chat.pop(); lw.onWorldMessageDeleted();
    chat.push(ai('Then rain, again.')); lw.onWorldMessageReceived(4); lw.onWorldGenerationEnded();
    check('regenerating a hidden reply hands its id to the new one; the run on it stands', chat[4].dooms_world_id === hiddenId && lw.getWorldState().last.msgId === hiddenId && lw.getWorldState().clocks.blockade === 2 && !chat[4].is_system);
    // a tool call: the prose part, the record SillyTavern saves with no event, the continuation: one turn, one id, one count (D44)
    extensionSettings.liveWorld.every = 50;    // no automatic run under this block
    const sinceBefore = lw.getWorldState().sinceLast;
    chat.push(user('Search the room.')); chat.push(ai('Let me look.')); lw.onWorldMessageReceived(chat.length - 1);
    const turnId = chat[chat.length - 1].dooms_world_id;
    chat.push({ is_user: false, is_system: true, name: 'Narrator', mes: '', extra: { tool_invocations: [{ name: 'search', result: 'a key' }] } });
    chat.push(ai('A key, under the mat.')); lw.onWorldMessageReceived(chat.length - 1);
    s = lw.getWorldState();
    check("a tool call's continuation shares the turn's id and is not counted again", typeof turnId === 'string' && chat[chat.length - 1].dooms_world_id === turnId && s.sinceLast === sinceBefore + 1 && s.counted.filter(id => id === turnId).length === 1, JSON.stringify([turnId, s.counted]));
    lw.onWorldGenerationStarted('regenerate', {}, false);
    chat.pop(); lw.onWorldMessageDeleted();
    chat.push(ai('A key, under the rug.')); lw.onWorldMessageReceived(chat.length - 1); lw.onWorldGenerationEnded();
    s = lw.getWorldState();
    check('regenerating the continuation keeps the one id and the one count', chat[chat.length - 1].dooms_world_id === turnId && s.sinceLast === sinceBefore + 1, JSON.stringify(s.counted));
    const onTurn = await lw.advanceNow({ reason: 'manual' });
    chat.pop(); lw.onWorldMessageDeleted();
    s = lw.getWorldState();
    check("a run on a tool turn survives the continuation's deletion while the turn's first part stands", onTurn.ok && s.last.msgId === turnId && s.sinceLast === 0, JSON.stringify([onTurn, s.last]));
    chat.pop(); chat.pop(); lw.onWorldMessageDeleted();    // the tool record and the prose part: the turn is gone
    s = lw.getWorldState();
    check('the whole turn gone undoes its run and its count; the run before it is the last again', s.last.msgId === hiddenId && !s.counted.includes(turnId) && s.sinceLast === 0, JSON.stringify([s.last, s.counted, s.sinceLast]));
    extensionSettings.liveWorld.every = 3;
}

console.log('\n§9 the tracker first, the main generation, a second advance');
{
    let calls = 0;
    lw.__setWorldTransport(async () => { calls++; return '{"clocks":{"blockade":2}}'; });
    resetMeta(); chat.length = 0; globalThis.__DES_CTX__.chatId = 'chat-f';
    await lw.onWorldChatChanged();
    extensionSettings.generationMode = 'separate';
    extensionSettings.autoUpdate = true;
    extensionSettings.showInfoBox = true;
    for (let i = 0; i < 3; i++) { lw.onWorldGenerationStarted(undefined, {}, false); chat.push(user('…')); chat.push(ai(`Scene ${i}.`)); lw.onWorldMessageReceived(); lw.onWorldGenerationEnded(); }
    await wait(600);
    check("separate mode: the advance waits for the tracker's own request, and the generation's end does not release it", calls === 0 && lw.getWorldState().sinceLast === 3);
    lw.onWorldTrackerUpdateComplete();
    await wait(600);
    check('...and runs when it ends', calls === 1 && lw.getWorldState().clocks.blockade === 2 && lw.getWorldState().sinceLast === 0);
    extensionSettings.generationMode = 'together';
    extensionSettings.autoUpdate = false;
    STUB.__setSendPress(true);
    let r = await lw.advanceNow({ reason: 'manual' });
    check('while SillyTavern itself is generating the advance waits', !r.ok && r.reason === 'busy' && calls === 1);
    STUB.__setSendPress(false);
    lw.onWorldGenerationEnded();
    await wait(600);
    check('...and runs when that generation ends', calls === 2);
    // a generation that has started but not yet raised the send flag holds an automatic advance, not a manual one
    lw.onWorldGenerationStarted(undefined, {}, false);
    for (let i = 0; i < 3; i++) { chat.push(user('…')); chat.push(ai(`Later ${i}.`)); lw.onWorldMessageReceived(); }
    await wait(600);
    check('an automatic advance waits from GENERATION_STARTED even before the send flag', calls === 2 && lw.getWorldState().sinceLast === 3);
    r = await lw.advanceNow({ reason: 'command' });
    check('a typed /advance in that window runs at once', calls === 3 && r.ok);
    lw.onWorldGenerationEnded();
    await wait(600);
    check('the parked automatic advance wakes when the generation ends and, the typed one having run, finds nothing due: no request', calls === 3 && lw.getWorldState().sinceLast === 0);
    let resolveReply = null;
    lw.__setWorldTransport(() => new Promise(res => { resolveReply = res; }));
    const first = lw.advanceNow({ reason: 'manual' });
    await wait(20);
    r = await lw.advanceNow({ reason: 'manual' });
    check('a second advance while one runs says so and queues nothing', r.reason === 'running' && lw.describeAdvanceResult(r) === 'An advance is already running.');
    resolveReply('{"clocks":{}}');
    await first;
    check('the first finished on its own', !lw.isAdvancing());
    // the third pass: a tracker request that completes after a chat switch is another chat's
    extensionSettings.generationMode = 'separate'; extensionSettings.autoUpdate = true; extensionSettings.showInfoBox = true;
    lw.__setWorldTransport(async () => '{"clocks":{}}');
    resetMeta(); chat.length = 0; globalThis.__DES_CTX__.chatId = 'chat-h';
    await lw.onWorldChatChanged();
    lastGeneratedData.characterThoughts = JSON.stringify({ characters: [{ name: 'Maeve', thoughts: 'x' }] });
    lw.onWorldTrackerUpdateComplete();
    check("a tracker completion no reply of this chat asked for marks nothing known (another chat's request, in flight across the switch)", lw.getWorldState().known['Maeve'] !== 'known');
    lastGeneratedData.characterThoughts = null;
    chat.push(user('…')); chat.push(ai('Someone waves.')); lw.onWorldMessageReceived();
    lastGeneratedData.characterThoughts = JSON.stringify({ characters: [{ name: 'Maeve', thoughts: 'x' }] });
    lw.onWorldTrackerUpdateComplete();
    check("after a reply of this chat asked for the tracker's request, the completion's names become known", lw.getWorldState().known['Maeve'] === 'known');
    lastGeneratedData.characterThoughts = null;
    extensionSettings.generationMode = 'together'; extensionSettings.autoUpdate = false;
    check('re-seeding with no chat open is refused with a reason', (globalThis.__DES_CTX__.chatId = undefined, true) && (await lw.reseedWorld()).error === 'No chat is open.' && (globalThis.__DES_CTX__.chatId = 'chat-h', true));
}

console.log('\n§10 the window and the shelf (D69)');
{
    const V = await import(`${DES}/src/systems/ui/worldViews.js`);
    const pb = await import(`${DES}/src/systems/ui/portraitBar.js`);
    const M = await import(`${DES}/src/utils/liveWorld.js`);
    lw.__setWorldTransport(async () => '{"clocks":{}}');
    resetMeta(); chat.length = 0; globalThis.__DES_CTX__.chatId = 'chat-shelf';
    extensionSettings.liveWorld.enabled = true;
    extensionSettings.liveWorld.pack = 'harbourside';
    await lw.onWorldChatChanged();
    const win = V.worldWindowHtml({ state: lw.getWorldState(), pack: lw.getActivePack(), cfg: M.liveWorldConfig(extensionSettings) });
    check('the window renders the live chat\'s world: the glance with the faces, then the board', win.includes('Word on the street') && win.includes('data-name="Captain Reyes"') && win.includes('data-name="Old Marit"') && !win.includes('data-name="The governor"') && win.includes('The governor') && win.includes('class="dooms-board-trail"'), win.slice(0, 300));
    pb.setShelfPage('world');
    check('the shelf no longer offers World (nor Map): it stays on Characters', pb.getShelfPage() === 'characters');
    extensionSettings.liveWorld.enabled = false;
    await lw.onWorldChatChanged();
    check('off: the window says so', V.worldWindowHtml({ state: lw.getWorldState(), pack: lw.getActivePack(), cfg: M.liveWorldConfig(extensionSettings) }).includes('Live World is off'));
    extensionSettings.liveWorld.enabled = true;
    await lw.onWorldChatChanged();
    pb.setShelfPage('characters');
}

console.log(`\n${failures === 0 ? 'All Live World flow checks pass' : `${failures} FAILURE(S)`}`);
process.exit(failures === 0 ? 0 : 1);
