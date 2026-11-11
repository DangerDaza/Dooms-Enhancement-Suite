#!/usr/bin/env node
/**
 * The Map window's feature layer in the chat (docs/map-window-plan.md):
 * each fresh reply's place recorded on the world state newest first, a
 * deleted reply taking its visit back, Draw through the image service (the
 * description request behind the module's hook, the picture behind the
 * service's), a drawn place kept through the rewind, the automatic draw,
 * Travel here as a cut, the completed quests.
 *
 * Usage:  node tools/map-flow-test.mjs     (from the repo root)
 * Exit:   0 = pass, 1 = failure
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
globalThis.__DES_SAVES__ = { debounced: 0, immediate: 0 };
globalThis.__DES_SAVED_FILES__ = [];
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
const extStub = `${SANDBOX}/scripts/extensions.js`;
writeFileSync(extStub, readFileSync(extStub, 'utf8')
    .replace('export const getContext = anything;', 'export const getContext = () => globalThis.__DES_CTX__;'));
const utilsStub = `${SANDBOX}/scripts/utils.js`;
writeFileSync(utilsStub, readFileSync(utilsStub, 'utf8')
    .replace('export const saveBase64AsFile = anything;', 'export const saveBase64AsFile = async (b64, folder, name, format) => { globalThis.__DES_SAVED_FILES__.push({ b64, folder, name, format }); return `/user/images/${folder}/${name}.${format}`; };'));
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
    { chat: globalThis.__DES_CHAT__, chat_metadata: globalThis.__DES_CHAT_METADATA__, name1: 'Jordan', name2: 'Narrator', chatId: 'test-chat', user_avatar: '', extension_settings: {}, saveSettingsDebounced: () => {} },
    { get: (t, p) => (p in t ? t[p] : anything) },
);
globalThis.window = globalThis;
globalThis.self = globalThis;
globalThis.document = anything;
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
Object.defineProperty(globalThis, 'navigator', { value: { hardwareConcurrency: 8, maxTouchPoints: 0 }, configurable: true });
globalThis.jQuery = anything;
globalThis.$ = anything;
const toasts = [];
globalThis.toastr = { info: (m, t) => toasts.push(['info', m, t]), warning: (m, t) => toasts.push(['warning', m, t]), success: (m, t) => toasts.push(['success', m, t]), error: (m, t) => toasts.push(['error', m, t]) };
globalThis.requestAnimationFrame = () => 0;
globalThis.cancelAnimationFrame = () => {};
globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
globalThis.fetch = async () => ({ ok: false, status: 404, json: async () => ({}), text: async () => '' });
globalThis.CustomEvent = class { constructor(type, init) { this.type = type; this.detail = init && init.detail; } };
globalThis.dispatchEvent = () => true;
const chat = globalThis.__DES_CHAT__;
const meta = globalThis.__DES_CHAT_METADATA__;
const savedFiles = globalThis.__DES_SAVED_FILES__;
const state = await import(`${DES}/src/core/state.js`);
const { extensionSettings, lastGeneratedData, committedTrackerData } = state;
const lw = await import(`${DES}/src/systems/features/liveWorld.js`);
const qc = await import(`${DES}/src/systems/features/questCut.js`);
const svc = await import(`${DES}/src/systems/features/imageGen.js`);
const packJson = JSON.stringify({ ...JSON.parse(readFileSync(new URL('../worldpacks/example.json', import.meta.url), 'utf8')), id: 'harbourside' });    // a copy of the template, as Start from Harbourside saves it

let failures = 0;
const check = (label, cond, extra = '') => {
    if (cond) { console.log(`pass  ${label}`); }
    else { console.error(`FAIL  ${label}${extra ? '\n      ' + extra : ''}`); failures++; }
};
const user = (mes) => ({ is_user: true, name: 'Jordan', mes, extra: {} });
const ai = (mes) => ({ is_user: false, name: 'Narrator', mes, swipe_id: 0, swipes: [mes], extra: {} });
const wait = (ms) => new Promise(r => setTimeout(r, ms));
const at = (location, date = 'Tuesday', time = 'dusk') => { lastGeneratedData.infoBox = JSON.stringify({ date, time, location }); };
const ids = () => lw.getWorldState().visited.map(e => e.id).join(',');

extensionSettings.enabled = true;
extensionSettings.generationMode = 'together';
extensionSettings.connectionProfile = '';
extensionSettings.userCharacters = {};
extensionSettings.npcAvatars = {};
extensionSettings.liveWorld = { enabled: true, pack: 'harbourside', every: 50, maxStep: 1, inject: false, depth: 2, role: 'system', recentMessages: 6, customPacks: {} };
extensionSettings.imageGen = { v: 1, source: 'sillytavern', comfy: { url: 'http://127.0.0.1:8189', workflow: '', timeoutSec: 20 }, portraits: { mode: 'off' }, places: { size: 'square', preamble: 'Matte painting, ', negative: 'blurry', auto: false } };
lastGeneratedData.characterThoughts = null;
committedTrackerData.characterThoughts = null;
lw.addCustomPack(packJson);

console.log('\n§1 the places the story visits');
for (const k of Object.keys(meta)) delete meta[k];
chat.length = 0;
chat.push(user('We walk down to the water.'));
chat.push(ai('The quay is slick with rain; lamps gutter along the warehouses.'));
at('the quay');
await lw.onWorldChatChanged();
lw.onWorldMessageReceived();
let s = lw.getWorldState();
check('a reply at a place the pack does not name records it as its own, tied to the reply', ids() === 'loc:the-quay' && s.visited[0].label === 'the quay' && s.visited[0].packId === '' && s.visited[0].visits.join() === chat[1].dooms_world_id && s.visited[0].lastDate === 'Tuesday');
chat.push(user('On to the docks.'));
chat.push(ai('The docks: cranes, crates, a cutter at anchor.'));
at('The docks', 'Wednesday', 'noon');
lw.onWorldMessageReceived();
check('a pack place is recognised and goes in front; the row says where the party is', ids() === 'the-docks,loc:the-quay' && lw.getWorldState().visited[0].packId === 'the-docks' && lw.getPlacesRow()[0].here && lw.getPlacesRow()[0].label.toLowerCase().includes('dock') && !lw.getPlacesRow()[1].here, JSON.stringify(lw.getPlacesRow()));
lw.onWorldMessageReceived();
check('the same reply again changes nothing', ids() === 'the-docks,loc:the-quay' && lw.getWorldState().visited[0].visits.length === 1);

console.log('\n§2 the rewind');
chat.pop();
lw.onWorldMessageDeleted();
check('the deleted reply takes its visit back; a place with none left leaves the row', ids() === 'loc:the-quay' && lw.getPlacesRow()[0].here);
chat.push(ai('The docks again, by another road.'));
lw.onWorldMessageReceived();
check('the regenerated reply records the place again', ids() === 'the-docks,loc:the-quay');

console.log('\n§3 Draw');
const seen = {};
lw.__setPlaceTransport({ describe: async (p) => { seen.prompt = p; return 'Oil on canvas, a wide view of the stone quay at dusk, lamps lit along the warehouses, rain on the cobbles, a cutter beyond.'; } });
svc.__setImageTransport({ sd: async (prompt, negative) => { seen.sd = { prompt, negative }; return '/user/images/sd/quay.png'; } });
let r = await lw.drawPlace('loc:the-quay');
s = lw.getWorldState();
check('the picture is made from the AI\'s description and kept on the place', r.ok && r.url === '/user/images/sd/quay.png' && s.visited[1].image === '/user/images/sd/quay.png' && s.visited[1].prompt.startsWith('Oil on canvas') && s.visited[1].drawnAt > 0, JSON.stringify(r));
check('the description request names the place and the world and carries the scenes there', seen.prompt && /the quay, in Harbourside/.test(seen.prompt.system) && /Scenes at or near it:/.test(seen.prompt.user) && /slick with rain/.test(seen.prompt.user), seen.prompt && seen.prompt.user);
check('the page\'s preamble and negative shape the render', seen.sd && seen.sd.prompt === 'Matte painting, Oil on canvas, a wide view of the stone quay at dusk, lamps lit along the warehouses, rain on the cobbles, a cutter beyond.' && seen.sd.negative === 'blurry', JSON.stringify(seen.sd));
check('the row shows it drawn', lw.getPlacesRow()[1].drawn && lw.getPlacesRow()[1].image === '/user/images/sd/quay.png');
check('a place not in the row', (await lw.drawPlace('loc:nowhere')).reason === 'no-place');
extensionSettings.imageGen.source = 'comfy';
r = await lw.drawPlace('the-docks');
check('a source that cannot draw says why', !r.ok && r.reason === 'source' && /workflow/.test(r.error) && /Cannot draw/.test(lw.describeDrawResult(r)));
extensionSettings.imageGen.comfy.workflow = 'Place.json';
svc.__setImageTransport({ comfy: async (kind, body) => {
    if (kind === 'workflow') return '{"6":{"class_type":"CLIPTextEncode","inputs":{"text":"%prompt%"}},"7":{"class_type":"CLIPTextEncode","inputs":{"text":"%negative_prompt%"}},"8":{"class_type":"EmptyLatentImage","inputs":{"width":"%width%","height":"%height%"}},"3":{"class_type":"KSampler","inputs":{"seed":"%seed%","steps":"%steps%","cfg":"%scale%","sampler_name":"%sampler%","scheduler":"%scheduler%"}}}';
    if (kind === 'generate') return { format: 'png', data: 'AAAA' };
    return {};
} });
r = await lw.drawPlace('the-docks');
check('ComfyUI direct: the bytes are saved into the character\'s folder as a place file', r.ok && savedFiles.length === 1 && savedFiles[0].folder === 'Narrator' && /^des-place-the-docks-/.test(savedFiles[0].name) && lw.getWorldState().visited[0].image === r.url, JSON.stringify({ r, savedFiles }));
extensionSettings.imageGen.source = 'sillytavern';
svc.__setImageTransport({ sd: async () => '/user/images/sd/again.png' });
// the rewind keeps a drawn place, at the end of the row
chat.pop();
lw.onWorldMessageDeleted();
s = lw.getWorldState();
check('a drawn place whose reply is gone stays, sunk to the end, and is not where the party is', ids() === 'loc:the-quay,the-docks' && s.visited[1].visits.length === 0 && s.visited[1].image === r.url && lw.getPlacesRow()[0].here && !lw.getPlacesRow()[1].here);

console.log('\n§4 the automatic draw');
extensionSettings.imageGen.places.auto = true;
const drawn = [];
svc.__setImageTransport({ sd: async (prompt) => { drawn.push(prompt); return `/user/images/sd/auto${drawn.length}.png`; } });
chat.push(user('Up into the old town.'));
chat.push(ai('Old Town: narrow stairs, washing lines, a shrine.'));
at('Old Town', 'Thursday', 'dawn');
lw.onWorldMessageReceived();
check('nothing is drawn before the timer', drawn.length === 0 && ids() === 'old-town,loc:the-quay,the-docks');
await wait(700);
check('a place reached for the first time is drawn, with a toast that names the page', drawn.length === 1 && lw.getWorldState().visited[0].image === '/user/images/sd/auto1.png' && toasts.some(t => t[0] === 'info' && /Drawing a picture of/.test(t[1]) && /Settings → Image Generation/.test(t[1])), JSON.stringify({ drawn, toasts }));
chat.push(user('Back down to the quay.'));
chat.push(ai('The quay again.'));
at('the quay', 'Thursday', 'noon');
lw.onWorldMessageReceived();
await wait(700);
check('a place seen before is not drawn again by the switch', drawn.length === 1 && ids() === 'loc:the-quay,old-town,the-docks');
extensionSettings.imageGen.places.auto = false;
chat.push(user('To the hill.'));
chat.push(ai('The Hill: the governor\'s house above the roofs.'));
at('The Hill', 'Thursday', 'dusk');
lw.onWorldMessageReceived();
await wait(700);
check('switch off: a new place is recorded and not drawn', drawn.length === 1 && ids().startsWith('the-hill,') && lw.getWorldState().visited[0].image === '');

console.log('\n§5 Travel here');
const started = await qc.startTravelCut({ place: 'The docks', placeId: 'the-docks', when: 'by dawn.' });
const pending = qc.getPendingQuestCut();
check('the cut is armed as a travel, with the place and the arrival, and a reply asked for', started && pending && pending.kind === 'travel' && pending.place === 'The docks' && pending.placeId === 'the-docks' && pending.when === 'by dawn' && pending.facts && pending.facts.location === 'The Hill', JSON.stringify(pending));
const instr = qc.buildQuestCutForGeneration();
check('the instruction that rides the generation is the travel\'s', /^\[TRAVEL: .+ has chosen to travel to The docks\./.test(instr) && / arrives by dawn\./.test(instr) && /from now \(Thursday, dusk, at The Hill\)/.test(instr), instr.slice(0, 200));
qc.onQuestCutMessageSent();
check('the player\'s next message ends it', qc.getPendingQuestCut() === null && qc.buildQuestCutForGeneration() === '');
check('no place: nothing armed', (await qc.startTravelCut({ place: '  ' })) === false && qc.getPendingQuestCut() === null);
// The Atlas's Travel here (docs/long-shot-plan.md D165): how long the map says the journey takes rides the cut to the story.
await qc.startTravelCut({ place: 'Redfall Castle', placeId: 'pin:redfall-castle', journey: '  about 2 days   by road ' });
check('the journey the map tells is kept on the cut, cleaned', qc.getPendingQuestCut().journey === 'about 2 days by road');
check('and the instruction tells the story how long it takes', qc.buildQuestCutForGeneration().includes('The map puts the journey at about 2 days by road: it takes that long, no less and no more, and the date and time move on by it.') && !/yours to judge/.test(qc.buildQuestCutForGeneration()));
qc.onQuestCutMessageSent();
await qc.startTravelCut({ place: 'Redfall Castle' });
check('with no journey told, how long it takes is the story\'s to judge, as before', /yours to judge/.test(qc.buildQuestCutForGeneration()) && qc.getPendingQuestCut().journey === '');
qc.onQuestCutMessageSent();

console.log('\n§6 the completed quests');
check('nothing yet', qc.getCompletedQuests().length === 0);
check('a quest completed is recorded with the tracker\'s date, newest first', qc.recordCompletedQuest('Find the warden') && qc.recordCompletedQuest('Feed the cat') && qc.getCompletedQuests().map(x => x.text).join('|') === 'Feed the cat|Find the warden' && qc.getCompletedQuests()[1].gameDate === 'Thursday' && Array.isArray(meta.dooms_quests_done));
check('None and nothing are not quests', !qc.recordCompletedQuest('None') && !qc.recordCompletedQuest('') && qc.getCompletedQuests().length === 2);

console.log('\n§7 Hooks (docs/hooks-canon-plan.md D100–D104)');
{
    const hk = await import(`${DES}/src/systems/features/questHooks.js`);
    extensionSettings.quests = { main: 'Find out who sank the Kestrel', optional: ['Pay the harbourmaster'] };
    let seenPrompt = null;
    hk.__setHooksTransport(async (prompt) => { seenPrompt = prompt; return '```json\n{"hooks":[{"title":"Carry a paper to the quay","text":"Carry a stamped paper to the quay before the tide; the customs house is the place to ask.","grounds":"the blockade","kind":"clock"},{"title":"Pay the harbourmaster","text":"Settle up at the docks.","kind":"quest"},{"title":"Call on Old Marit","text":"Learn why the governor sent for her.","grounds":"Old Marit","kind":"person"}]}\n```'; });
    const r = await hk.proposeHooks({ reason: 'test' });
    let h = hk.getHooks();
    check('a round asked for: the request carried the quests and the world; two hooks stand (the open quest dropped) and are written to the chat', r.ok && r.hooks.length === 2 && seenPrompt && seenPrompt.user.includes('- Find out who sank the Kestrel (the main quest)') && seenPrompt.user.includes('What the street sees now') && h.proposed.length === 2 && h.proposed[0].id === 'h1' && meta.dooms_hooks && meta.dooms_hooks.proposed.length === 2, JSON.stringify(r));
    const t = await hk.takeHook('h1');
    h = hk.getHooks();
    check('Take: the hook is a quest on the shelf, once, and off the round', t.ok && t.quest === 'Carry a stamped paper to the quay before the tide; the customs house is the place to ask.' && extensionSettings.quests.optional.includes(t.quest) && h.proposed.length === 1 && h.taken.length === 1 && h.taken[0].title === 'Carry a paper to the quay');
    const again = await hk.takeHook('h1');
    check('a hook no longer on offer', !again.ok && again.reason === 'no-hook');
    const c = await hk.takeHook('h2', { cut: true, when: 'by dusk' });
    const pending = qc.getPendingQuestCut();
    check('Take and cut to it: the quest on the shelf and the cut armed with it', c.ok && c.cut === true && extensionSettings.quests.optional.includes(c.quest) && pending && pending.kind !== 'travel' && pending.quest === c.quest && pending.when === 'by dusk', JSON.stringify(pending));
    qc.cancelQuestCut();
    hk.__setHooksTransport(async () => '{"hooks":[{"title":"Ask after the fever","text":"The infirmary is full.","kind":"place"},{"title":"Call on Old Marit","text":"Again.","kind":"person"}]}');
    const r2 = await hk.proposeHooks();
    h = hk.getHooks();
    check('another round: a hook already taken is not offered again; the round is replaced, the ids go on', r2.ok && r2.hooks.length === 1 && h.proposed.length === 1 && h.proposed[0].title === 'Ask after the fever' && h.proposed[0].id === 'h3' && h.taken.length === 2, JSON.stringify(h.proposed));
    const id2 = h.proposed[0] && h.proposed[0].id;
    check('Not this one: off the round, remembered', hk.setHookAside(id2) && hk.getHooks().proposed.length === 0 && hk.getHooks().aside.join() === 'Ask after the fever' && hk.setHookAside(id2) === false);
    hk.__setHooksTransport(async () => '{"hooks":[{"title":"Ask after the fever","text":"The infirmary is full.","kind":"place"}]}');
    const r3 = await hk.proposeHooks();
    check('a round of nothing new fails and says so; nothing on offer, the failure noted', !r3.ok && r3.reason === 'invalid' && hk.getHooks().proposed.length === 0 && hk.getHooks().last && !hk.getHooks().last.ok && hk.getHooks().last.error.includes('set aside'));
    hk.__setHooksTransport(async () => { throw new Error('network down'); });
    const r4 = await hk.proposeHooks();
    check('a request that fails: the error kept, nothing thrown', !r4.ok && r4.reason === 'error' && r4.error === 'network down' && hk.getHooks().last.error === 'network down');
    extensionSettings.liveWorld.enabled = false;
    check('Live World off: no hooks', (await hk.proposeHooks()).reason === 'off');
    extensionSettings.liveWorld.enabled = true;
}

console.log('\n§8 a request asked for by a button waits for the player\'s own message (long-shot-plan D191)');
{
    const hk = await import(`${DES}/src/systems/features/questHooks.js`);
    const api = await import(`${DES}/src/systems/generation/apiClient.js`);
    const hooksUtil = await import(`${DES}/src/utils/questHooks.js`);
    const stScript = await import(`${SANDBOX}/script.js`);
    api.__setIdleLineTiming({ stepMs: 5, maxMs: 60 });
    check('with nothing being written the line is free at once', (await api.waitForIdleLine()) === true);
    // Hooks.
    let asked = 0;
    hk.__setHooksTransport(async () => { asked++; return '{"hooks":[{"title":"Watch the tide tables","text":"Find who changed the tide tables at the customs house.","grounds":"the customs house","kind":"place"}]}'; });
    stScript.__setSendPress(true);
    const held = await hk.proposeHooks();
    check('hooks asked for while a reply is being written: nothing is sent, and it says to try again when the reply is done', !held.ok && held.reason === 'waiting' && asked === 0 && /reply is still being written/.test(hooksUtil.describeHooksResult(held)), JSON.stringify(held));
    setTimeout(() => stScript.__setSendPress(false), 20);
    const went = await hk.proposeHooks();
    check('asked while a reply is being written that then ends: the request goes once the reply is done', went.ok && asked === 1, JSON.stringify(went));
    // The place's picture.
    let described = 0;
    lw.__setPlaceTransport({ describe: async () => { described++; return 'A wide view of the quay.'; } });
    svc.__setImageTransport({ sd: async () => '/user/images/sd/quay-again.png' });
    extensionSettings.imageGen.source = 'sillytavern';
    const place = lw.getWorldState().visited[0].id;
    stScript.__setSendPress(true);
    const stuck = await lw.drawPlace(place);
    check('a place\'s picture asked for while a reply is being written: nothing is sent, and it says why', !stuck.ok && stuck.reason === 'busy' && described === 0 && /reply is still being written/.test(stuck.error), JSON.stringify(stuck));
    setTimeout(() => stScript.__setSendPress(false), 20);
    const drawn = await lw.drawPlace(place);
    check('and it is drawn once the reply is done', drawn.ok && described === 1, JSON.stringify(drawn));
    stScript.__setSendPress(false);
    hk.__setHooksTransport(null);
    api.__setIdleLineTiming({ stepMs: 250, maxMs: 120000 });
}

console.log('');
if (failures) { console.error(`${failures} FAILURE(S)`); process.exit(1); }
console.log('All map flow checks pass');
