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
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const SANDBOX = '/tmp/des-load-check';
const DES = `${SANDBOX}/scripts/extensions/third-party/DES`;

execFileSync(process.execPath, ['tools/load-check.mjs'], { stdio: 'pipe' });
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
    + '\nexport let is_send_press = false;\nexport const __setSendPress = (v) => { is_send_press = v; };\n');
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

console.log('\n§3 counting');
chat.push(user('I run for the Anchor.'));
chat.push(ai('The cutter fires a warning shot.'));
lw.onWorldMessageReceived();
s = lw.getWorldState();
check('a fresh reply counts once and gets a stable id', s.sinceLast === 1 && typeof chat[1].dooms_world_id === 'string' && s.counted.includes(chat[1].dooms_world_id));
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
check('the advancer ran through the wrapper and wrote the validated reply', !!lastPrompt && s.clocks.blockade === 2 && s.where['Old Marit'] === 'harbourside/old-town/the-anchor/back-room' && s.known['Maeve'] === 'heard' && s.blurb === 'The quay is quiet.' && s.sinceLast === 0 && s.last && s.last.ok && s.last.gameDate === 'Tuesday' && s.last.msgId === chat[5].dooms_world_id, JSON.stringify(s.last));
check('the prompt carried the recent scenes, the clocks, the tree and now', lastPrompt.user.includes('Narrator: Night falls over Harbourside.') && lastPrompt.user.includes('- blockade ("The blockade"): now 1 of 6') && lastPrompt.user.includes('back-room (The Anchor\'s back room)') && lastPrompt.user.includes('Now: Tuesday, dusk, at the quay.'), lastPrompt.user);
check('the lines now carry the move', lw.buildWorldLinesNow().includes("Old Marit: The Anchor's back room, The Anchor, a tavern (Tuesday)"));
check('the state is saved on the chat, the clock change and the move logged', meta.dooms_world.clocks.blockade === 2 && meta.dooms_world.log.length === 2 && meta.dooms_world.log[0].kind === 'clock');
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
check('a re-seed with a pack that cannot load keeps the world and says why', reseeded === false && lw.getWorldState().clocks.blockade === 4 && lw.getPackError().includes('No pack named "skyreach"'));
extensionSettings.liveWorld.pack = 'harbourside';
await lw.reseedWorld();
check('...here the pasted one, since the built-in cannot be fetched in the sandbox', lw.getActivePack().id === 'harbourside' && lw.getWorldState().clocks.blockade === 1 && lw.getWorldState().log.length === 0);
extensionSettings.liveWorld.enabled = false;
await lw.onWorldChatChanged();
check('off: no state, no lines, no advance', lw.getWorldState() === null && (lw.onWorldGenerationStarted(undefined, {}, false), slots['dooms-world-state'].value === '') && (await lw.advanceNow()).reason === 'off');
extensionSettings.liveWorld.enabled = true;
await lw.onWorldChatChanged();

console.log('\n§6 the dashboard\'s reading');
{
    const M = await import(`${DES}/src/utils/liveWorld.js`);
    const dash = await import(`${DES}/src/systems/ui/worldDashboard.js`);
    const pack = lw.getActivePack();
    const cfg = M.liveWorldConfig(extensionSettings);
    let st = lw.getWorldState();
    const v = M.validateAdvance({ elapsed: 'a day', clocks: { blockade: 2 }, moved: [{ who: 'Old Marit', to: 'back-room', reason: 'hiding' }], blurb: 'The quay is quiet.', heard: ['Maeve'] }, pack, st);
    st = M.applyAdvance(st, v.clean, pack, { msgId: 'm1', gameDate: 'Thursday', gameTime: 'dawn', ranAt: 1 });
    const html = dash.renderWorldDashboardHtml({ state: st, pack, cfg, facts: { date: 'Thursday', time: 'dawn', location: 'the quay' }, portraits: () => '' });
    check('the head: the pack, the date from the tracker, the blurb, when it advanced and when it runs next', html.includes('<h4>Harbourside</h4>') && html.includes('Thursday, dawn · at the quay') && html.includes('The quay is quiet.') && html.includes('Last advanced on Thursday (a day passed)') && html.includes('next run in 3 replies'), html);
    check('what people say: the effect text with the clock\'s name, never the number', html.includes('<b>The blockade:</b> Cargo is searched on the quay') && !html.includes('2/6'));
    check('known characters with where they were last seen and before', html.includes('Old Marit') && html.includes("Last seen: The Anchor&#39;s back room, The Anchor, a tavern") && html.includes('Before that: The Anchor, a tavern, The old town') && html.includes('Seen Thursday, dawn') && html.includes('Captain Reyes'));
    check('heard-of names as dimmed chips, not cards', html.includes('rpg-world-chip" title="Heard of, not met">Maeve') && !html.includes('Last seen: nowhere yet</div></div></div><div class="rpg-world-card">' + 'Maeve'));
    check('recent changes with the date', html.includes("Old Marit: The Anchor, a tavern, The old town → The Anchor&#39;s back room, The Anchor, a tavern (hiding)<time>Thursday</time>"));
    check('a portrait when the store has one, an emoji otherwise', dash.renderWorldDashboardHtml({ state: st, pack, cfg, portraits: (n) => n === 'Old Marit' ? 'data:image/png;base64,x' : '' }).includes('<img class="rpg-world-portrait" src="data:image/png;base64,x"') && html.includes('>👤</div>'));
    const spoilerFree = dash.renderWorldDashboardHtml({ state: st, pack, cfg: { ...cfg, spoilerFree: true } });
    check('spoiler-free: effects without the clock names, and said so', !spoilerFree.includes('<b>The blockade:</b>') && spoilerFree.includes('Cargo is searched') && spoilerFree.includes('Spoiler-free: common knowledge only.'));
    check('off, a pack problem, no world: each says so', dash.renderWorldDashboardHtml({ cfg: { ...cfg, enabled: false } }).includes('Live World is off') && dash.renderWorldDashboardHtml({ cfg, packError: 'No pack named "x".' }).includes('This chat has no world: No pack named') && dash.renderWorldDashboardHtml({ cfg, state: null, pack: null }).includes('no world yet'));
    const failed = M.failAdvance(st, { error: 'The clock "blockade" moved by 3, more than 1.' });
    check('a discarded attempt and the retry are shown', dash.renderWorldDashboardHtml({ state: failed, pack, cfg }).includes('Last attempt discarded: The clock') && dash.renderWorldDashboardHtml({ state: failed, pack, cfg }).includes('runs again on the next reply'));
    check('model-written text is escaped', dash.renderWorldDashboardHtml({ state: { ...st, blurb: '<img src=x onerror=alert(1)>' }, pack, cfg }).includes('&lt;img src=x onerror=alert(1)&gt;'));
    check("the master switch off says so, not 're-seed'", dash.renderWorldDashboardHtml({ state: st, pack, cfg, masterOn: false }).includes("Enhancement Suite is off") && !dash.renderWorldDashboardHtml({ state: st, pack, cfg, masterOn: false }).includes('re-seed'));
    check('a clock change sits in recent changes as its public face', html.includes('The blockade: Cargo is searched on the quay') && dash.renderWorldDashboardHtml({ state: st, pack, cfg: { ...cfg, spoilerFree: true } }).includes('<li>Cargo is searched on the quay'));
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
    chat.pop();
    lw.onWorldMessageDeleted();
    s = lw.getWorldState();
    check('deleting that reply undoes its advance: clock and place back, no last run, the count resumed, saved', s.clocks.blockade === 1 && s.where['Old Marit'].endsWith('the-anchor') && s.last === null && s.sinceLast === 2 && s.log.length === 0 && meta.dooms_world.clocks.blockade === 1, JSON.stringify(s));
    chat.push(ai('Night.')); lw.onWorldMessageReceived(6); await wait(600);
    const full = JSON.parse(JSON.stringify(meta.dooms_world));
    check('a new reply in its place advances again', full.clocks.blockade === 2 && lw.getWorldState().last.msgId === chat[6].dooms_world_id);
    const branch = chat.slice(0, 5).map(m => JSON.parse(JSON.stringify(m)));
    resetMeta(); meta.dooms_world = full; chat.length = 0; chat.push(...branch); globalThis.__DES_CTX__.chatId = 'chat-e-branch';
    await lw.onWorldChatChanged();
    s = lw.getWorldState();
    check('a branch cut before the advance loads wound back to its own messages', s.clocks.blockade === 1 && s.where['Old Marit'].endsWith('the-anchor') && s.last === null && s.sinceLast === 2 && s.pack === 'harbourside' && meta.dooms_world.clocks.blockade === 1, JSON.stringify(s));
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
    for (let i = 0; i < 3; i++) { chat.push(user('…')); chat.push(ai(`Scene ${i}.`)); lw.onWorldMessageReceived(); }
    await wait(600);
    check("separate mode: the advance waits for the tracker's own request", calls === 0 && lw.getWorldState().sinceLast === 3);
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
    let resolveReply = null;
    lw.__setWorldTransport(() => new Promise(res => { resolveReply = res; }));
    const first = lw.advanceNow({ reason: 'manual' });
    await wait(20);
    r = await lw.advanceNow({ reason: 'manual' });
    check('a second advance while one runs says so and queues nothing', r.reason === 'running' && lw.describeAdvanceResult(r) === 'An advance is already running.');
    resolveReply('{"clocks":{}}');
    await first;
    check('the first finished on its own', !lw.isAdvancing());
}

console.log(`\n${failures === 0 ? 'All Live World flow checks pass' : `${failures} FAILURE(S)`}`);
process.exit(failures === 0 ? 0 : 1);
