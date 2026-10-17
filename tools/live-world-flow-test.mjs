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
    .replace('export const extension_prompt_types = anything;', 'export const extension_prompt_types = { IN_PROMPT: 0, IN_CHAT: 1 };'));
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
check('the state is saved on the chat', meta.dooms_world.clocks.blockade === 2 && meta.dooms_world.log.length === 1);
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
state.setIsGenerating(true);
r = await lw.advanceNow({ reason: 'manual' });
check('while another background request holds the flag the advance waits', !r.ok && r.reason === 'busy');
state.setIsGenerating(false);
lw.onWorldGenerationEnded();
await wait(600);
check('...and runs when the generation ends', lw.getWorldState().clocks.blockade === 3 && lw.getWorldState().last.ranAt > 0);

console.log('\n§5 the chat switch and the re-seed');
const saved = JSON.parse(JSON.stringify(meta.dooms_world));
resetMeta();
chat.length = 0;
globalThis.__DES_CTX__.chatId = 'other-chat';
await lw.onWorldChatChanged();
check('another chat starts from the pack again', lw.getWorldState().clocks.blockade === 1 && lw.getWorldState().log.length === 0);
resetMeta();
meta.dooms_world = saved;
globalThis.__DES_CTX__.chatId = 'test-chat';
await lw.onWorldChatChanged();
check('coming back loads the stored state, not a fresh seed', lw.getWorldState().clocks.blockade === 3 && lw.getWorldState().where['Old Marit'].endsWith('back-room'));
extensionSettings.liveWorld.pack = 'skyreach';
await lw.onWorldChatChanged();
check('a chat keeps the pack it was seeded with', lw.getActivePack().id === 'harbourside');
const reseeded = await lw.reseedWorld();
check('a re-seed throws the state away and seeds from the chosen pack', reseeded === false || reseeded === true);
extensionSettings.liveWorld.pack = 'harbourside';
await lw.reseedWorld();
check('...here the pasted one, since the built-in cannot be fetched in the sandbox', lw.getActivePack().id === 'harbourside' && lw.getWorldState().clocks.blockade === 1 && lw.getWorldState().log.length === 0);
extensionSettings.liveWorld.enabled = false;
await lw.onWorldChatChanged();
check('off: no state, no lines, no advance', lw.getWorldState() === null && (lw.onWorldGenerationStarted(undefined, {}, false), slots['dooms-world-state'].value === '') && (await lw.advanceNow()).reason === 'off');
extensionSettings.liveWorld.enabled = true;

console.log(`\n${failures === 0 ? 'All Live World flow checks pass' : `${failures} FAILURE(S)`}`);
process.exit(failures === 0 ? 0 : 1);
