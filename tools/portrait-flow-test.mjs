#!/usr/bin/env node
/**
 * Portraits through the image service under the one rule (docs/image-gen-plan.md
 * D75–D77, D80): Off draws nothing, a recovery never draws, Only missing /
 * State changed / Every reply do what they say, the user's own portrait is
 * never replaced, a card face needs none, a pre-3.2 record is adopted
 * without a redraw, the first run says so once, a source that cannot draw
 * warns once, ComfyUI direct lands on disk, and the Workshop's and the card
 * menu's Regenerate draw whatever the mode says.
 *
 * Usage:  node tools/portrait-flow-test.mjs     (from the repo root)
 * Exit:   0 = pass, 1 = failure
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { buildSandbox } from './sandbox.mjs';

const { SANDBOX, DES } = buildSandbox();
if (!existsSync(`${DES}/src/systems/features/avatarGenerator.js`)) {
    console.error('FAIL: sandbox missing after load-check — cannot run.');
    process.exit(1);
}

globalThis.__DES_CHARACTERS__ = [];
const scriptStub = `${SANDBOX}/script.js`;
writeFileSync(scriptStub, readFileSync(scriptStub, 'utf8')
    .replace('export const characters = anything;', 'export const characters = globalThis.__DES_CHARACTERS__;')
    .replace('export const this_chid = anything;', 'export const this_chid = undefined;')
    .replace('export const getRequestHeaders = anything;', 'export const getRequestHeaders = () => ({});'));
const groupStub = `${SANDBOX}/scripts/group-chats.js`;
writeFileSync(groupStub, readFileSync(groupStub, 'utf8')
    .replace('export const selected_group = anything;', 'export const selected_group = null;'));
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
    { chat: [], chat_metadata: {}, name1: 'Jordan', name2: 'Mara Vane', chatId: 'test-chat', extension_settings: {}, extensionSettings: { sd: { source: 'comfy' } }, saveSettingsDebounced: () => {} },
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
const uploads = [];
globalThis.fetch = async (url, init) => {
    if (String(url).includes('/api/images/upload')) { uploads.push(JSON.parse(init.body)); return { ok: true, json: async () => ({}), text: async () => '' }; }
    return { ok: true, json: async () => ({}), text: async () => '' };
};
globalThis.CustomEvent = class { constructor(type) { this.type = type; } };
globalThis.dispatchEvent = () => true;

const state = await import(`${DES}/src/core/state.js`);
const { extensionSettings } = state;
const gen = await import(`${DES}/src/systems/features/avatarGenerator.js`);
const svc = await import(`${DES}/src/systems/features/imageGen.js`);

let failures = 0;
const check = (label, cond, extra = '') => {
    if (cond) { console.log(`pass  ${label}`); }
    else { console.error(`FAIL  ${label}${extra ? '\n      ' + extra : ''}`); failures++; }
};

extensionSettings.enabled = true;
extensionSettings.generationMode = 'together';
extensionSettings.npcAvatars = {};
extensionSettings.npcAvatarsFullRes = {};
extensionSettings.generatedPortraits = {};
extensionSettings.npcAvatarHistory = {};
extensionSettings.characterAppearance = { 'Mara Vane': 'silver fox ears, long white hair', 'Tam': 'a wiry boy with a lantern', 'Orrin': 'a grey-bearded harbourmaster' };
extensionSettings.imageGen = { v: 1, source: 'sillytavern', comfy: { workflow: '' }, portraits: { mode: 'off', size: 'square', preamble: 'Painted portrait, ', negative: 'blurry', notify: true } };
const portraits = () => extensionSettings.imageGen.portraits;

const drawn = [];
let urlCount = 0;
let comfyMode = 'ok';
svc.__setImageTransport({
    sd: async (prompt, negative) => { drawn.push({ prompt, negative }); return `/user/images/sd/p${++urlCount}.png`; },
    comfy: async (kind, body) => {
        if (kind === 'workflow') return '{"1":{"class_type":"UNETLoader","inputs":{"unet_name":"m.safetensors"}},"6":{"class_type":"CLIPTextEncode","inputs":{"text":"%prompt%"}},"7":{"class_type":"CLIPTextEncode","inputs":{"text":"%negative_prompt%"}},"8":{"class_type":"EmptyLatentImage","inputs":{"width":"%width%","height":"%height%"}},"3":{"class_type":"KSampler","inputs":{"model":["1",0],"seed":"%seed%","steps":"%steps%","cfg":"%scale%","sampler_name":"%sampler%","scheduler":"%scheduler%"}}}';
        if (kind === 'generate') { const g = JSON.parse(body.prompt).prompt; const loras = Object.values(g).filter(n => n.class_type === 'LoraLoaderModelOnly').map(n => `${n.inputs.lora_name}@${n.inputs.strength_model}`); drawn.push({ prompt: g['6'].inputs.text, negative: g['7'].inputs.text, loras, samplerModel: g['3'].inputs.model, comfy: true }); return comfyMode === 'fail' ? (() => { throw new Error('generate: boom'); })() : { format: 'png', data: 'AAAA' }; }
        return {};
    },
});
const entry = (name, appearance, extra = {}) => ({ name, relationship: 'ally', details: { appearance }, ...extra });
const run = (entries, when) => gen.generateAutoPortraitsForCharacters(entries, 'The quay at dusk.', null, when);
const since = () => { const n = drawn.length; return () => drawn.slice(n); };

console.log('\n§1 the gate');
let fresh = since();
await run([entry('Tam', 'lantern')], { fresh: true });
check('Off: nothing is drawn', fresh().length === 0 && toasts.length === 0);
portraits().mode = 'only_missing';
await run([entry('Tam', 'lantern')], { fresh: true, recovery: true });
check('a recovery never draws (D76)', fresh().length === 0);
await run([entry('Tam', 'lantern')], { fresh: false });
check('a chat load (not fresh) never draws', fresh().length === 0);
check('the plan says why', gen.planAutoPortraits([entry('Tam', 'lantern')], { recovery: true }).reason === 'recovery' && gen.planAutoPortraits([entry('Tam', 'lantern')]).names.join() === 'Tam');

console.log('\n§2 Only missing');
extensionSettings.npcAvatars['Mara Vane'] = '/user/images/mara-own.png';     // the user's own: no record behind it
fresh = since();
await run([entry('Mara Vane', 'fox ears'), entry('Tam', 'lantern'), entry('Tam', 'lantern'), entry('unavailable', '')], { fresh: true });
let d = fresh();
check('the missing one is drawn once; the held one and the duplicate are not', d.length === 1 && extensionSettings.npcAvatars['Tam'] === '/user/images/sd/p1.png' && extensionSettings.npcAvatars['Mara Vane'] === '/user/images/mara-own.png', JSON.stringify(d));
check('the page shapes the prompt: preamble + the Portrait prompt line, the negative', d[0] && d[0].prompt === 'Painted portrait, a wiry boy with a lantern' && d[0].negative === 'blurry', JSON.stringify(d[0]));
const meta = extensionSettings.generatedPortraits['Tam'];
check('a DES-made record behind it, with the rule\'s hash', meta && meta.source === 'des.autoPortrait' && /^v1:/.test(meta.stateHash) && meta.url === '/user/images/sd/p1.png');
check('D77: the first run says so, once, naming the character, the source and the switch', toasts.length === 1 && toasts[0][0] === 'info' && /Tam/.test(toasts[0][1]) && /SillyTavern's Image Generation/.test(toasts[0][1]) && /Settings → Image Generation/.test(toasts[0][1]), JSON.stringify(toasts));
fresh = since();
await run([entry('Tam', 'lantern, now soaked')], { fresh: true });
check('Only missing: a changed state does not redraw', fresh().length === 0 && toasts.length === 1);

console.log('\n§3 State changed');
portraits().mode = 'state_changed';
fresh = since();
await run([entry('Tam', 'lantern')], { fresh: true });
check('the same state: no redraw', fresh().length === 0);
await run([entry('Tam', 'lantern, now soaked')], { fresh: true });
d = fresh();
check('a new state: redrawn, the record moves on', d.length === 1 && extensionSettings.npcAvatars['Tam'] === '/user/images/sd/p2.png' && extensionSettings.generatedPortraits['Tam'].url === '/user/images/sd/p2.png');
await run([entry('Mara Vane', 'fox ears, hood up')], { fresh: true });
check('D80: the user\'s own portrait is never replaced', fresh().length === 1 && extensionSettings.npcAvatars['Mara Vane'] === '/user/images/mara-own.png');
// a pre-3.2 record: the whole-entry hash
extensionSettings.npcAvatars['Orrin'] = '/user/images/des-portraits/orrin-old.png';
extensionSettings.generatedPortraits['Orrin'] = { source: 'des.autoPortrait', prompt: 'x', stateHash: 'a1b2c3', url: '/user/images/des-portraits/orrin-old.png', createdAt: 1 };
fresh = since();
await run([entry('Orrin', 'grey beard')], { fresh: true });
check('a pre-3.2 record is adopted, not redrawn', fresh().length === 0 && /^v1:/.test(extensionSettings.generatedPortraits['Orrin'].stateHash));
await run([entry('Orrin', 'grey beard, bleeding')], { fresh: true });
check('…and the next change redraws it', fresh().length === 1 && extensionSettings.npcAvatars['Orrin'] === '/user/images/sd/p3.png');

console.log('\n§4 Every reply');
portraits().mode = 'every_reply';
globalThis.__DES_CHARACTERS__.push({ name: 'Ysolde', avatar: 'ysolde.png' });
extensionSettings.characterAppearance['Ysolde'] = 'a card character';
fresh = since();
await run([entry('Tam', 'lantern'), entry('Orrin', 'grey beard'), entry('Mara Vane', 'fox ears'), entry('Ysolde', 'card')], { fresh: true });
d = fresh();
check('every DES-made portrait is redrawn; the user\'s and the card\'s are not', d.length === 2 && d.every(x => /lantern|harbourmaster/.test(x.prompt)) && extensionSettings.npcAvatars['Mara Vane'] === '/user/images/mara-own.png' && !extensionSettings.npcAvatars['Ysolde'], JSON.stringify(d));
check('nothing is left pending', gen.getPendingGenerations().length === 0);

console.log('\n§5 a source that cannot draw');
extensionSettings.imageGen.source = 'comfy';
extensionSettings.imageGen.comfy.workflow = '';
const before = toasts.length;
fresh = since();
await run([entry('Tam', 'lantern')], { fresh: true });
await run([entry('Tam', 'lantern')], { fresh: true });
check('no workflow: nothing drawn, one warning naming the page, nothing pending', fresh().length === 0 && toasts.length === before + 1 && toasts[before][0] === 'warning' && /Image Generation/.test(toasts[before][1]) && gen.getPendingGenerations().length === 0, JSON.stringify(toasts.slice(before)));
check('isSdAvailable / imageSourceProblem answer for the chosen source', gen.isSdAvailable() === false && /workflow/.test(gen.imageSourceProblem()));

console.log('\n§6 ComfyUI direct');
extensionSettings.imageGen.comfy = { url: 'http://127.0.0.1:8189', workflow: 'Portrait.json', steps: 20, cfg: 2, sampler: 'euler', scheduler: 'simple', model: '', clip: '', vae: '', timeoutSec: 20 };
portraits().negative = '';    // the default: no negative prompt, which must not count as a missing placeholder
portraits().loras = [{ name: 'PortraitStyle', strength: 0.6 }];
extensionSettings.characterLoras = { 'tam': 'TamFace:0.8\nPortraitStyle:0.9' };    // the character's own, case-blind; a name in both counts once, the character's strength winning
check('…and now it can', gen.isSdAvailable() === true && gen.imageSourceProblem() === '');
fresh = since();
await run([entry('Tam', 'lantern, moonlit')], { fresh: true });
d = fresh();
check('the picture comes back as bytes and lands under des-portraits', d.length === 1 && d[0].comfy && uploads.length === 1 && /^tam-[0-9a-f]{8}\.png$/i.test(uploads[0].filename) && /des-portraits/.test(extensionSettings.npcAvatars['Tam']), JSON.stringify({ d, uploads, url: extensionSettings.npcAvatars['Tam'] }));
check('the preamble reaches the workflow\'s prompt; the empty negative fills its placeholder with nothing', d[0] && d[0].prompt === 'Painted portrait, a wiry boy with a lantern' && d[0].negative === '', JSON.stringify(d[0]));
check('the character\'s LoRAs are spliced first, the page\'s after, a shared name once; the sampler reads the last', d[0] && d[0].loras.join('|') === 'TamFace.safetensors@0.8|PortraitStyle.safetensors@0.9' && Array.isArray(d[0].samplerModel) && d[0].samplerModel[0] !== '1', JSON.stringify(d[0]));
comfyMode = 'fail';
const tamBefore = extensionSettings.npcAvatars['Tam'];
await run([entry('Tam', 'lantern, stormy')], { fresh: true });
check('a failed render keeps the portrait it had and leaves nothing pending', extensionSettings.npcAvatars['Tam'] === tamBefore && gen.getPendingGenerations().length === 0);
comfyMode = 'ok';

console.log('\n§7 on request: the Workshop and the card menu');
portraits().mode = 'off';
extensionSettings.imageGen.source = 'sillytavern';
fresh = since();
const url = await gen.regenerateAvatar('Mara Vane');
d = fresh();
check('Regenerate draws with the mode Off (it was asked), through the service, and banks the old portrait', d.length === 1 && url === extensionSettings.npcAvatars['Mara Vane'] && url !== '/user/images/mara-own.png' && (extensionSettings.npcAvatarHistory['Mara Vane'] || []).length >= 1, JSON.stringify({ d, url, history: extensionSettings.npcAvatarHistory['Mara Vane'] }));
check('…with the page\'s preamble around the Portrait prompt line', d[0] && d[0].prompt === 'Painted portrait, silver fox ears, long white hair');
fresh = since();
await gen.generateAvatarWithPrompt('Tam', 'a boy, hand-written prompt');
check('Render portrait with a typed prompt uses that prompt', fresh().length === 1 && fresh()[0].prompt === 'Painted portrait, a boy, hand-written prompt');
check('a portrait made on request carries no automatic record (the user\'s now, D80)', !extensionSettings.generatedPortraits['Mara Vane'] || extensionSettings.generatedPortraits['Mara Vane'].url !== extensionSettings.npcAvatars['Mara Vane']);

console.log('\n§8 the player\'s card (D91): its own entry, never the NPC stores');
extensionSettings.imageGen.source = 'sillytavern';
const avatars = await import(`${DES}/src/utils/avatars.js`);
const npcMara = extensionSettings.npcAvatars['Mara Vane'];
const npcMaraBanked = avatars.getPortraitHistoryCount('Mara Vane');
extensionSettings.userCharacters = { 'Mara Vane': { avatar: '/user/images/mara-user.png', avatarFullRes: '/user/images/mara-user-full.png', appearance: 'red braid, freckles, travelling cloak', loras: 'MaraFace:0.7', injection: { description: 'A wiry courier.' } } };
extensionSettings.activeUserCharacter = 'Mara Vane';
const u = () => extensionSettings.userCharacters['Mara Vane'];
check('nothing banked for the player yet, while the NPC of the same name has their own count', avatars.getPortraitHistoryCount('Mara Vane', { isUser: true }) === 0 && npcMaraBanked === 1);
fresh = since();
const playerUrl = await gen.regenerateAvatar('Mara Vane', { isUser: true });
d = fresh();
check('Regenerate on the player\'s card draws from the user card\'s Portrait prompt', d.length === 1 && d[0].prompt === 'Painted portrait, red braid, freckles, travelling cloak');
check('…and the picture lands on the user card, both sizes', !!playerUrl && u().avatar === playerUrl && u().avatarFullRes === playerUrl);
check('the old pair is banked on the card itself', Array.isArray(u().portraitHistory) && u().portraitHistory.length === 1 && u().portraitHistory[0].avatar === '/user/images/mara-user.png' && u().portraitHistory[0].avatarFullRes === '/user/images/mara-user-full.png' && avatars.getPortraitHistoryCount('Mara Vane', { isUser: true }) === 1);
check('the NPC of the same name keeps their portrait and their history', extensionSettings.npcAvatars['Mara Vane'] === npcMara && avatars.getPortraitHistoryCount('Mara Vane') === npcMaraBanked);
extensionSettings.imageGen.source = 'comfy';
fresh = since();
const playerComfy = await gen.generateAvatarWithPrompt('Mara Vane', 'courier in a cloak', { isUser: true });
d = fresh();
check('through ComfyUI the user card\'s LoRA rides the player\'s portrait, the page\'s after it', d.length === 1 && d[0].comfy && d[0].loras.join('|') === 'MaraFace.safetensors@0.7|PortraitStyle.safetensors@0.6', d[0] && d[0].loras.join('|'));
check('…the bytes land under des-portraits on the card, the first picture banked behind them', /^\/user\/images\/des-portraits\/mara-vane-[0-9a-f]{8}\.png(\?t=\d+)?$/i.test(playerComfy || '') && u().avatar === playerComfy && u().avatarFullRes === playerComfy && u().portraitHistory.length === 2 && u().portraitHistory[1].avatar === playerUrl, playerComfy);
check('Restore swaps the first picture back and banks the newest', avatars.restorePreviousPortrait('Mara Vane', { isUser: true }) && u().avatar === playerUrl && u().avatarFullRes === playerUrl && u().portraitHistory.length === 2 && u().portraitHistory[1].avatar === playerComfy);
check('the NPC stores never moved', extensionSettings.npcAvatars['Mara Vane'] === npcMara && avatars.getPortraitHistoryCount('Mara Vane') === npcMaraBanked);
const taken = avatars.takePortraitHistoryValues('Mara Vane', { isUser: true });
check('deleting the card hands its banked files over and drops the list', taken.length === 4 && taken.includes('/user/images/mara-user-full.png') && taken.includes(playerComfy) && !('portraitHistory' in u()));
check('a player with no portrait yet: nothing to bank, nothing created', !avatars.stashCurrentPortraitToHistory('Nobody', { isUser: true }) && !extensionSettings.userCharacters['Nobody'] && avatars.getPortraitHistoryCount('Nobody', { isUser: true }) === 0 && !avatars.restorePreviousPortrait('Nobody', { isUser: true }));

console.log(failures ? `\n${failures} FAILURE(S)` : '\nAll portrait flow checks pass');
process.exit(failures ? 1 : 0);
