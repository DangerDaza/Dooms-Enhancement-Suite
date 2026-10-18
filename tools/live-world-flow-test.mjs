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
    check('changes under their date', html.includes('<div class="rpg-world-feed-date">Thursday</div><ul class="rpg-world-changes"><li class="is-move">Old Marit: The Anchor, a tavern, The old town → The Anchor&#39;s back room, The Anchor, a tavern (hiding)</li>'), html);
    check('a portrait when the store has one, an emoji otherwise', dash.renderWorldDashboardHtml({ state: st, pack, cfg, portraits: (n) => n === 'Old Marit' ? 'data:image/png;base64,x' : '' }).includes('<img class="rpg-world-portrait" src="data:image/png;base64,x"') && html.includes('>👤</div>'));
    const spoilerFree = dash.renderWorldDashboardHtml({ state: st, pack, cfg: { ...cfg, spoilerFree: true } });
    check('spoiler-free: effects without the clock names, and said so', !spoilerFree.includes('<b>The blockade:</b>') && spoilerFree.includes('Cargo is searched') && spoilerFree.includes('Spoiler-free: common knowledge only.'));
    check('off, a pack problem, no world: each says so', dash.renderWorldDashboardHtml({ cfg: { ...cfg, enabled: false } }).includes('Live World is off') && dash.renderWorldDashboardHtml({ cfg, packError: 'No pack named "x".' }).includes('This chat has no world: No pack named') && dash.renderWorldDashboardHtml({ cfg, state: null, pack: null }).includes('no world yet'));
    const failed = M.failAdvance(st, { error: 'The clock "blockade" moved by 3, more than 1.' });
    check('a discarded attempt and the retry are shown', dash.renderWorldDashboardHtml({ state: failed, pack, cfg }).includes('Last attempt discarded: The clock') && dash.renderWorldDashboardHtml({ state: failed, pack, cfg }).includes('runs again on the next reply'));
    check('model-written text is escaped', dash.renderWorldDashboardHtml({ state: { ...st, blurb: '<img src=x onerror=alert(1)>' }, pack, cfg }).includes('&lt;img src=x onerror=alert(1)&gt;'));
    check("the master switch off says so, not 're-seed'", dash.renderWorldDashboardHtml({ state: st, pack, cfg, masterOn: false }).includes("Enhancement Suite is off") && !dash.renderWorldDashboardHtml({ state: st, pack, cfg, masterOn: false }).includes('re-seed'));
    check('a clock change sits in recent changes as its public face', html.includes('The blockade: Cargo is searched on the quay') && dash.renderWorldDashboardHtml({ state: st, pack, cfg: { ...cfg, spoilerFree: true } }).includes('<li>Cargo is searched on the quay'));
    // the map view (C1)
    const wm = await import(`${DES}/src/systems/ui/worldMap.js`);
    const map = wm.renderWorldMapHtml({ state: st, pack, cfg, portraits: (n) => n === 'Old Marit' ? 'data:image/png;base64,x' : '' });
    check('the map: the root and its districts as cards, a line to each district', map.includes('class="rpg-wmap-node is-root has-children"') && (map.match(/class="rpg-wmap-node/g) || []).length === 4 && (map.match(/<path /g) || []).length === 3 && map.includes('data-zoom="harbourside" title="Harbourside · 3 within, open to look inside">Harbourside <span class="rpg-wmap-more" aria-hidden="true">›</span></button>') && map.includes('>The old town <span class="rpg-wmap-more"') && map.includes('role="group" aria-label="Harbourside: the province"') && !map.includes('role="img"') && map.includes('left:clamp(var(--wmap-hx),'), map);
    check('known characters as tokens on the deepest drawn place: a portrait when there is one, initials otherwise, heard-of names absent', map.includes('<img class="rpg-wmap-token" src="data:image/png;base64,x" alt="Old Marit" title="Old Marit · The Anchor&#39;s back room, The Anchor, a tavern"') && map.includes('aria-label="Captain Reyes" data-name="Captain Reyes" role="button" tabindex="0">CR</span>') && !map.includes('Maeve') && !map.includes('The governor'));
    check('a count on each card that holds someone, none on an empty one', map.includes('<span class="rpg-wmap-count" title="1 known character here, 1 somewhere within">1</span>') && (map.match(/rpg-wmap-count/g) || []).length === 2);
    const hostilePack = M.normalizePack({ ...JSON.parse(packJson), places: [{ id: 'h', label: '<b>Hall</b> & "co"', image: 'javascript:alert(1)' }, { id: 'ok', parent: 'h', image: 'https://x/y.png' }] }).pack;
    const hostile = wm.renderWorldMapHtml({ state: M.seedWorldState(hostilePack), pack: hostilePack, cfg });
    check('labels are escaped, a scripted image is dropped and a plain one wears the card', hostile.includes('&lt;b&gt;Hall&lt;/b&gt; &amp; &quot;co&quot;') && !hostile.includes('javascript:') && hostile.includes('url(&quot;https://x/y.png&quot;)') && hostile.includes('has-image'), hostile);
    check('the map says the same as the overview when there is nothing to draw', wm.renderWorldMapHtml({ cfg: { ...cfg, enabled: false } }).includes('Live World is off') && wm.renderWorldMapHtml({ state: st, pack, cfg, masterOn: false }).includes('Enhancement Suite is off') && wm.renderWorldMapHtml({ cfg, packError: 'x' }).includes('no world: x'));
    const loner = M.markKnown(M.seedWorldState(pack), ['Wanderer']);
    check('a known name with no place is listed under the map', wm.renderWorldMapHtml({ state: loner, pack, cfg }).includes('Somewhere, not yet placed: Wanderer.'));
    // D2, D3: the feed, the timelines, the links between the views
    check('the feed sits under its dates with a filter that remembers its choice', html.includes('<div class="rpg-world-feed-date">Thursday</div>') && html.includes('<option value="12" selected>Latest 12</option>') && html.includes('<option value="0">Everything</option>') && dash.renderWorldDashboardHtml({ state: st, pack, cfg, feed: 0 }).includes('<option value="0" selected>Everything</option>') && dash.renderWorldDashboardHtml({ state: st, pack, cfg, feed: 7 }).includes('<option value="12" selected>'));
    let busy = st;
    for (let i = 0; i < 25; i++) busy = M.applyAdvance(busy, { clocks: {}, moved: [{ who: 'Old Marit', to: i % 2 ? 'the-hill' : 'back-room' }, { who: 'Captain Reyes', to: i % 2 ? 'the-docks' : 'the-hill' }, { who: 'The governor', to: i % 2 ? 'old-town' : 'the-docks' }], heard: [], blurb: '' }, pack, { msgId: `m${i}`, gameDate: `Day ${i}` });
    check('the filter bounds the feed: twelve, fifty, everything', busy.log.length > 50 && (dash.renderWorldDashboardHtml({ state: busy, pack, cfg }).match(/<li class="is-/g) || []).length === 12 && (dash.renderWorldDashboardHtml({ state: busy, pack, cfg, feed: 50 }).match(/<li class="is-/g) || []).length === 50 && (dash.renderWorldDashboardHtml({ state: busy, pack, cfg, feed: 0 }).match(/<li class="is-/g) || []).length === busy.log.length, String(busy.log.length));
    const undated = M.applyAdvance(st, { clocks: {}, moved: [{ who: 'Captain Reyes', to: 'the-hill' }], heard: [], blurb: '' }, pack, { msgId: 'u' });
    check('entries with no date get their own heading when dated ones exist', dash.renderWorldDashboardHtml({ state: undated, pack, cfg }).includes('<div class="rpg-world-feed-date">No date</div><ul class="rpg-world-changes"><li class="is-move">Captain Reyes:') && !dash.renderWorldDashboardHtml({ state: M.applyAdvance(M.seedWorldState(pack), { clocks: {}, moved: [{ who: 'Captain Reyes', to: 'the-hill' }], heard: [], blurb: '' }, pack, { msgId: 'u' }), pack, cfg }).includes('rpg-world-feed-date">No date</div>'));
    check('spoiler-free keeps the rule a reply broke out of the dashboard', !dash.renderWorldDashboardHtml({ state: failed, pack, cfg: { ...cfg, spoilerFree: true } }).includes('blockade') && dash.renderWorldDashboardHtml({ state: failed, pack, cfg: { ...cfg, spoilerFree: true } }).includes('Last attempt discarded: the reply broke a rule') && lw.describeAdvanceResult({ ok: false, reason: 'invalid', errors: ['The clock "blockade" moved by 3, more than 1.'] }, { spoilerFree: true }) === 'The advance was discarded: the reply broke a rule (the System Log has the detail).' && lw.describeAdvanceResult({ ok: false, reason: 'invalid', errors: ['x'] }).includes('x'));
    let ring = st;
    for (let i = 0; i < 25; i++) ring = M.applyAdvance(ring, { clocks: {}, moved: [{ who: 'Old Marit', to: i % 2 ? 'the-hill' : 'back-room' }], heard: [], blurb: '' }, pack, { msgId: `t${i}`, gameDate: `Day ${i}` });
    check('a timeline the ring has trimmed says "Earlier at", not "Started at"', dash.renderWorldDashboardHtml({ state: ring, pack, cfg, timeline: 'Old Marit' }).includes('<li class="is-start">Earlier at ') && dash.renderWorldDashboardHtml({ state: ring, pack, cfg, timeline: 'Old Marit' }).includes('older moves are no longer in the log') && dash.renderWorldDashboardHtml({ state: st, pack, cfg, timeline: 'Old Marit' }).includes('<li class="is-start">Started at The Anchor, a tavern, The old town</li>'));
    const open = dash.renderWorldDashboardHtml({ state: st, pack, cfg, timeline: 'Old Marit' });
    check("a card opens the character's timeline: started where, each move with its date, the link to the map", open.includes('class="rpg-world-card is-open" data-name="Old Marit"') && open.includes('aria-expanded="true"') && open.includes('<li class="is-start">Started at The Anchor, a tavern, The old town</li>') && open.includes('<time>Thursday, dawn</time>The Anchor&#39;s back room, The Anchor, a tavern <span class="is-muted">(hiding)</span>') && open.includes('class="rpg-world-card-map" data-place="back-room"') && !html.includes('rpg-world-timeline'));
    check('a token on the map carries the name and the map picks a place out when asked', map.includes('data-name="Old Marit" role="button"') && wm.renderWorldMapHtml({ state: st, pack, cfg, focus: 'back-room' }).includes('class="rpg-wmap-node is-focus has-children" style') && !wm.renderWorldMapHtml({ state: st, pack, cfg }).includes('is-focus'));
    const zoomed = wm.renderWorldMapHtml({ state: st, pack, cfg, root: 'old-town' });
    check('zoomed in: the trail, the place at the centre with what is inside, the rest elsewhere', zoomed.includes('<nav class="rpg-wmap-crumbs"') && zoomed.includes('class="rpg-wmap-crumb is-here" data-root="old-town">The old town</button>') && zoomed.includes('data-root="">Harbourside</button>') && (zoomed.match(/class="rpg-wmap-node/g) || []).length === 2 && zoomed.includes('Elsewhere in Harbourside: Captain Reyes.') && zoomed.includes('aria-label="Harbourside: The old town"'));
    check('a card\'s label is the button that opens it, tokens stay its siblings, the place looked into has none', map.includes('<button type="button" class="rpg-wmap-label rpg-wmap-zoom" data-zoom="old-town"') && !zoomed.includes('data-zoom="old-town"') && zoomed.includes('data-zoom="the-anchor"') && !/<button[^>]*>(?:(?!<\/button>)[\s\S])*<(?:img|span) class="rpg-wmap-token"/.test(map) && !map.includes('rpg-wmap-node is-root has-children" style="left:clamp(var(--wmap-hx),50.00%') === false);
    check('a backdrop image is dimmed under the label and the text stays light; a name opening with an emoji keeps it whole', hostile.includes('background-image:linear-gradient(rgba(0,0,0,0.35),rgba(0,0,0,0.6)),url(&quot;https://x/y.png&quot;)') && wm.renderWorldMapHtml({ state: (() => { const st2 = M.markKnown(M.seedWorldState(pack), ['🦊 Fox']); st2.where['🦊 Fox'] = 'harbourside/the-hill'; return st2; })(), pack, cfg }).includes('>🦊F</span>') && wm.renderWorldMapHtml({ state: M.markKnown(M.seedWorldState(pack), ['🦊 Fox']), pack, cfg }).isWellFormed());
    check('a crowded pack gets the dense canvas and a taller one', wm.renderWorldMapHtml({ state: M.seedWorldState(M.normalizePack({ id: 'c', places: [{ id: 'r' }, ...Array.from({ length: 12 }, (_, i) => ({ id: `k${i}`, parent: 'r' }))] }).pack), pack: M.normalizePack({ id: 'c', places: [{ id: 'r' }, ...Array.from({ length: 12 }, (_, i) => ({ id: `k${i}`, parent: 'r' }))] }).pack, cfg }).includes('class="rpg-wmap is-dense" role="group"') && map.includes('style="min-height:280px"'));
    check("a timeline's text is escaped", dash.renderWorldDashboardHtml({ state: { ...st, log: [...st.log, { kind: 'move', who: 'Old Marit', from: '', to: 'the-hill', reason: '<script>x</script>', gameDate: 'Fri' }] }, pack, cfg, timeline: 'Old Marit' }).includes('(&lt;script&gt;x&lt;/script&gt;)'));
    // the third pass: a failed request told apart from a broken rule; initials by grapheme; the canvas's own measure
    const broken = M.failAdvance(st, { error: 'network down', kind: 'error' });
    check('a request that failed says so, spoiler-free or not, and that it runs again; a run not due says so', dash.renderWorldDashboardHtml({ state: broken, pack, cfg: { ...cfg, spoilerFree: true } }).includes('The last advance failed: network down; it runs again on the next reply.') && dash.renderWorldDashboardHtml({ state: failed, pack, cfg: { ...cfg, spoilerFree: true } }).includes('the reply broke a rule') && lw.describeAdvanceResult({ ok: false, reason: 'error', error: 'network down' }, { spoilerFree: true }) === 'The advance failed: network down; it runs again on the next reply.' && lw.describeAdvanceResult({ ok: false, reason: 'not-due' }) === 'Nothing to do: the world is not due an advance.');
    const flags = (() => { const s2 = M.markKnown(M.seedWorldState(pack), ['🇬🇧 Bill', '👨‍👩‍👧 Fam', 'ßen Low']); s2.where['🇬🇧 Bill'] = 'harbourside/the-hill'; s2.where['👨‍👩‍👧 Fam'] = 'harbourside/old-town'; s2.where['ßen Low'] = 'harbourside/the-docks'; return s2; })();
    const flagMap = wm.renderWorldMapHtml({ state: flags, pack, cfg });
    check('a flag, a joined emoji or a letter with no single upper case opens a name as one initial', flagMap.includes('>🇬🇧B</span>') && flagMap.includes('>👨‍👩‍👧F</span>') && flagMap.includes('>ßL</span>'), (flagMap.match(/is-initials[^>]*>[^<]*</g) || []).join(' '));
    const big = M.normalizePack({ id: 'big', places: [{ id: 'r' }, ...Array.from({ length: 30 }, (_, i) => ({ id: `k${i}`, parent: 'r' }))] }).pack;
    check('a canvas too small for its places says so under the map; Harbourside on a phone does not', wm.renderWorldMapHtml({ state: M.seedWorldState(big), pack: big, cfg, canvasWidth: 360, narrow: true }).includes('More places here than the canvas can keep apart') && !wm.renderWorldMapHtml({ state: st, pack, cfg, canvasWidth: 360, narrow: true }).includes('More places here'));
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

console.log('\n§10 the shelf\'s Map page (D56)');
{
    const pages = await import(`${DES}/src/systems/ui/shelfPages.js`);
    const pb = await import(`${DES}/src/systems/ui/portraitBar.js`);
    lw.__setWorldTransport(async () => '{"clocks":{}}');
    resetMeta(); chat.length = 0; globalThis.__DES_CTX__.chatId = 'chat-shelf';
    extensionSettings.liveWorld.enabled = true;
    extensionSettings.liveWorld.pack = 'harbourside';
    await lw.onWorldChatChanged();
    const page = pages.mapPageHtml();
    check("the page is the dashboard's map with a button to the dashboard", page.includes('class="dooms-map-page"') && page.includes('class="dooms-map-dashboard"') && page.includes('class="rpg-wmap"') && page.includes('data-root="">Harbourside</button>') && (page.match(/class="rpg-wmap-node/g) || []).length === 4, page.slice(0, 400));
    check('known characters stand on it as tokens, heard-of names do not', page.includes('data-name="Captain Reyes"') && page.includes('data-name="Old Marit"') && !page.includes('The governor'));
    const zoomed = pages.mapPageHtml({ root: 'old-town' });
    check('zoomed into a place: the trail above, what is inside drawn', zoomed.includes('class="rpg-wmap-crumb is-here" data-root="old-town">The old town</button>') && zoomed.includes('data-zoom="the-anchor"') && (zoomed.match(/class="rpg-wmap-node/g) || []).length === 2);
    pb.setShelfPage('map');
    check('the shelf offers Map while Live World is on', pb.getShelfPage() === 'map');
    extensionSettings.liveWorld.enabled = false;
    await lw.onWorldChatChanged();
    check('off: the shelf falls back to Characters and the page says so', pb.getShelfPage() === 'characters' && pages.mapPageHtml().includes('Live World is off'));
    extensionSettings.liveWorld.enabled = true;
    await lw.onWorldChatChanged();
    check('on again: Map is back, the choice remembered', pb.getShelfPage() === 'map' && pages.mapPageHtml().includes('class="rpg-wmap"'));
    pb.setShelfPage('characters');
}

console.log(`\n${failures === 0 ? 'All Live World flow checks pass' : `${failures} FAILURE(S)`}`);
process.exit(failures === 0 ? 0 : 1);
