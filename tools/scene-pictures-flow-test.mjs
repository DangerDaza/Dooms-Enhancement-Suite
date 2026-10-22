#!/usr/bin/env node
/**
 * Scene pictures in the chat: this chat's state kept in its metadata, the
 * player's turns counted once, the run armed every N and started when the
 * generation ends, the caption and the studio behind the module's test
 * hook, the picture saved and posted as the narrator's message, a failed
 * run retried on the next turn, a busy chat, a chat switch mid-run, the
 * feature off.
 *
 * Usage:  node tools/scene-pictures-flow-test.mjs     (from the repo root)
 * Exit:   0 = pass, 1 = failure
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { buildSandbox } from './sandbox.mjs';

const { SANDBOX, DES } = buildSandbox();
if (!existsSync(`${DES}/src/systems/features/scenePictures.js`)) {
    console.error('FAIL: sandbox missing after load-check — cannot run.');
    process.exit(1);
}

globalThis.__DES_CHAT__ = [];
globalThis.__DES_CHAT_METADATA__ = {};
globalThis.__DES_SAVES__ = { debounced: 0, immediate: 0 };
globalThis.__DES_EVENTS__ = [];
globalThis.__DES_RENDERED__ = [];
globalThis.__DES_SAVED_FILES__ = [];
const scriptStub = `${SANDBOX}/script.js`;
writeFileSync(scriptStub, readFileSync(scriptStub, 'utf8')
    .replace('export const chat_metadata = anything;', 'export const chat_metadata = globalThis.__DES_CHAT_METADATA__;')
    .replace('export const chat = anything;', 'export const chat = globalThis.__DES_CHAT__;')
    .replace('export const saveChatDebounced = anything;', 'export const saveChatDebounced = () => { globalThis.__DES_SAVES__.debounced++; };')
    .replace('export const saveChatConditional = anything;', 'export const saveChatConditional = async () => { globalThis.__DES_SAVES__.immediate++; };')
    .replace('export const eventSource = anything;', 'export const eventSource = { emit: async (name, ...args) => { globalThis.__DES_EVENTS__.push([name, ...args]); }, on: () => {}, off: () => {} };')
    .replace('export const event_types = anything;', 'export const event_types = { MESSAGE_RECEIVED: "message_received", CHARACTER_MESSAGE_RENDERED: "character_message_rendered" };')
    .replace('export const addOneMessage = anything;', 'export const addOneMessage = (m) => { globalThis.__DES_RENDERED__.push(m); };')
    .replace('export const default_avatar = anything;', 'export const default_avatar = "img/ai4.png";')
    + '\nexport let is_send_press = false;\nexport const __setSendPress = (v) => { is_send_press = v; };\n');
const extStub = `${SANDBOX}/scripts/extensions.js`;
writeFileSync(extStub, readFileSync(extStub, 'utf8')
    .replace('export const getContext = anything;', 'export const getContext = () => globalThis.__DES_CTX__;'));
const utilsStub = `${SANDBOX}/scripts/utils.js`;
writeFileSync(utilsStub, readFileSync(utilsStub, 'utf8')
    .replace('export const saveBase64AsFile = anything;', 'export const saveBase64AsFile = async (b64, folder, name, format) => { globalThis.__DES_SAVED_FILES__.push({ b64, folder, name, format }); return `/user/images/${folder}/${name}.${format}`; };'));
const rossStub = `${SANDBOX}/scripts/RossAscends-mods.js`;
if (existsSync(rossStub)) writeFileSync(rossStub, readFileSync(rossStub, 'utf8').replace('export const getMessageTimeStamp = anything;', 'export const getMessageTimeStamp = () => "October 22, 2026 9:00am";'));

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
    { chat: globalThis.__DES_CHAT__, chat_metadata: globalThis.__DES_CHAT_METADATA__, name1: 'Jordan', name2: 'Mara Vane', chatId: 'test-chat', user_avatar: '' },
    { get: (t, p) => (p in t ? t[p] : anything) },
);
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
globalThis.fetch = async () => { throw new Error('no network in the test'); };
globalThis.CustomEvent = class { constructor(type) { this.type = type; } };
globalThis.dispatchEvent = () => true;

const chat = globalThis.__DES_CHAT__;
const meta = globalThis.__DES_CHAT_METADATA__;
const saves = globalThis.__DES_SAVES__;
const events = globalThis.__DES_EVENTS__;
const rendered = globalThis.__DES_RENDERED__;
const savedFiles = globalThis.__DES_SAVED_FILES__;
const state = await import(`${DES}/src/core/state.js`);
const { extensionSettings, lastGeneratedData, committedTrackerData } = state;
const sp = await import(`${DES}/src/systems/features/scenePictures.js`);
const STUB = await import(`${SANDBOX}/script.js`);

let failures = 0;
const check = (label, cond, extra = '') => {
    if (cond) { console.log(`pass  ${label}`); }
    else { console.error(`FAIL  ${label}${extra ? '\n      ' + extra : ''}`); failures++; }
};
const user = (mes) => ({ is_user: true, name: 'Jordan', mes, send_date: `t${chat.length}`, extra: {} });
const ai = (mes) => ({ is_user: false, name: 'Mara Vane', mes, send_date: `t${chat.length}`, swipe_id: 0, swipes: [mes], extra: {} });
const resetMeta = () => { for (const k of Object.keys(meta)) delete meta[k]; };
const wait = (ms) => new Promise(r => setTimeout(r, ms));

extensionSettings.enabled = true;
extensionSettings.generationMode = 'together';
extensionSettings.connectionProfile = '';
extensionSettings.userCharacters = {};
extensionSettings.scenePictures = { enabled: true, every: 2, window: 6, size: 'landscape', notify: false, preamble: 'Anime-style digital illustration. ', timeoutSec: 20, workflow: 'DES Scene Moss.json', model: 'moss_image_sft_int8_convrot.safetensors', vae: 'flux2-vae_small.safetensors' };
lastGeneratedData.characterThoughts = JSON.stringify([{ name: 'Mara Vane', thoughts: 'x' }]);
committedTrackerData.characterThoughts = null;
sp.__setSceneTiming({ idleMaxMs: 60, idleStepMs: 10 });

// The caption and SillyTavern's ComfyUI endpoints behind the hook: what each was given is recorded.
const WORKFLOW = `{
  "1": { "class_type": "UNETLoader", "inputs": { "unet_name": "%model%", "weight_dtype": "default" } },
  "2": { "class_type": "CLIPLoader", "inputs": { "clip_name": "qwen.safetensors", "type": "moss_image" } },
  "4": { "class_type": "VAELoader", "inputs": { "vae_name": "%vae%" } },
  "6": { "class_type": "CLIPTextEncode", "inputs": { "text": "%prompt%", "clip": ["2", 0] } },
  "7": { "class_type": "CLIPTextEncode", "inputs": { "text": "%negative_prompt%", "clip": ["2", 0] } },
  "8": { "class_type": "EmptyFlux2LatentImage", "inputs": { "width": "%width%", "height": "%height%", "batch_size": 1 } },
  "9": { "class_type": "SkipLayerGuidanceDiTSimple", "inputs": { "model": ["1", 0], "double_layers": "22", "single_layers": "22", "start_percent": 0.01, "end_percent": 0.8 } },
  "3": { "class_type": "KSampler", "inputs": { "seed": "%seed%", "steps": "%steps%", "cfg": "%scale%", "sampler_name": "%sampler%", "scheduler": "%scheduler%", "denoise": 1, "model": ["9", 0], "positive": ["6", 0], "negative": ["7", 0], "latent_image": ["8", 0] } },
  "10": { "class_type": "VAEDecode", "inputs": { "samples": ["3", 0], "vae": ["4", 0] } },
  "11": { "class_type": "SaveImage", "inputs": { "images": ["10", 0], "filename_prefix": "ST_moss/scene" } }
}`;
const seen = { prompts: [], comfy: [] };
let comfyMode = 'ok';
const CAPTION = 'Anime-style digital illustration of a red-haired woman in a grey coat on a rain-dark quay at dusk, looking up from a crate of lamps, warm light on her face, the harbour behind her.';
sp.__setSceneTransport({
    caption: async (prompt) => { seen.prompts.push(prompt); return `"${CAPTION}"`; },
    comfy: async (kind, body) => {
        seen.comfy.push({ kind, body });
        if (kind === 'ping') return {};
        if (kind === 'workflows') return ['DES Scene Moss.json', 'Default_Comfy_Workflow.json'];
        if (kind === 'workflow') return comfyMode === 'noworkflow' ? '' : WORKFLOW;
        if (kind === 'generate') {
            if (comfyMode === 'fail') throw new Error('generate: ComfyUI generation did not succeed.\n\nValue not in list: lora_name');
            if (comfyMode === 'slow') { await wait(60); return { format: 'png', data: 'AAAA' }; }
            return { format: 'png', data: 'AAAA' };
        }
        return {};
    },
});

console.log('\n§1 this chat\'s state');
resetMeta();
chat.length = 0;
sp.onSceneChatChanged();
check('a chat with no state starts fresh', sp.getSceneState().sinceLast === 0 && sp.getSceneState().loras.length === 0 && sp.getSceneStatus().chatBound);
sp.setSceneLoras([{ name: 'BunnySlop_MOSS', strength: 0.8 }]);
sp.setSceneIdentity('Mara: red hair in a long braid, grey wool coat');
check('the LoRAs and the notes are written into the chat\'s metadata', meta.dooms_scene && meta.dooms_scene.loras[0].name === 'BunnySlop_MOSS' && meta.dooms_scene.identity.startsWith('Mara:'));
sp.onSceneChatChanged();
check('…and come back on reload', sp.getSceneState().loras[0].strength === 0.8 && sp.getSceneState().identity.includes('braid'));

console.log('\n§2 counting and the picture');
chat.push(ai('The quay at dusk.'));
chat.push(user('I step off the boat.'));
sp.onSceneMessageSent();
sp.onSceneMessageSent();
check('a turn counts once', sp.getSceneState().sinceLast === 1 && !sp.getSceneStatus().armed);
chat.push(ai('Mara looks up from a crate of lamps.'));
chat.push(user('I wave.'));
sp.onSceneMessageSent();
check('the second turn arms the run', sp.getSceneState().sinceLast === 2 && sp.getSceneStatus().armed);
chat.push(ai('She waves back.'));
const before = chat.length;
sp.onSceneGenerationEnded();
await wait(150);
const posted = chat[chat.length - 1];
check('the run posted the narrator\'s message with the picture', chat.length === before + 1 && posted.name === 'Narrator' && posted.is_system === true && posted.is_user === false && posted.extra.image === '/user/images/Mara Vane/' + savedFiles[0].name + '.png' && posted.extra.title === CAPTION && posted.extra.inline_image === false && posted.force_avatar === 'img/ai4.png');
check('the message text is the caption\'s first line, in italics', posted.mes.startsWith('*Anime-style digital illustration of a red-haired woman') && posted.mes.endsWith('*'));
check('the picture was saved under the character\'s folder as a png', savedFiles.length === 1 && savedFiles[0].folder === 'Mara Vane' && savedFiles[0].format === 'png' && savedFiles[0].b64 === 'AAAA');
check('the events and the render SillyTavern expects, then the chat saved', events.some(e => e[0] === 'message_received') && events.some(e => e[0] === 'character_message_rendered') && rendered.length === 1 && saves.immediate === 1);
const gen = seen.comfy.find(s => s.kind === 'generate');
const graph = gen ? JSON.parse(gen.body.prompt).prompt : null;
check('ComfyUI got the workflow filled: the preamble and the caption, the size, the models, the sampling', gen && gen.body.url === 'http://127.0.0.1:8189' && graph['6'].inputs.text === `Anime-style digital illustration. ${CAPTION}` && graph['8'].inputs.width === 1536 && graph['8'].inputs.height === 864 && graph['1'].inputs.unet_name === 'moss_image_sft_int8_convrot.safetensors' && graph['4'].inputs.vae_name === 'flux2-vae_small.safetensors' && graph['3'].inputs.steps === 25 && graph['3'].inputs.cfg === 2.5 && Number.isInteger(graph['3'].inputs.seed));
check('…with this chat\'s LoRA spliced after the loader, feeding the guidance node', graph.des_lora_1 && graph.des_lora_1.inputs.lora_name === 'BunnySlop_MOSS.safetensors' && graph.des_lora_1.inputs.strength_model === 0.8 && graph.des_lora_1.inputs.model.join() === '1,0' && graph['9'].inputs.model.join() === 'des_lora_1,0');
check('the caption request saw the recent scene, who is present and the identity notes', seen.prompts.length === 1 && seen.prompts[0].user.includes('Jordan: I wave.') && seen.prompts[0].user.includes('Characters present: Mara Vane.') && seen.prompts[0].system.includes('red hair in a long braid') && seen.prompts[0].system.includes('a wide landscape frame'));
check('the count is back to zero and the last picture is kept', sp.getSceneState().sinceLast === 0 && sp.getSceneState().last.ok && sp.getSceneState().last.file === 'DES Scene Moss.json' && meta.dooms_scene.last.ok);
check('the same reply end does not run twice', (sp.onSceneGenerationEnded(), chat.length === before + 1));

console.log('\n§3 a failed run, then the retry');
comfyMode = 'fail';
chat.push(user('I follow her.'));
sp.onSceneMessageSent();
chat.push(user('I follow her further.'));
sp.onSceneMessageSent();
chat.push(ai('She leads.'));
const before3 = chat.length;
sp.onSceneGenerationEnded();
await wait(150);
check('a failed render posts nothing, keeps ComfyUI\'s reason and arms a retry', chat.length === before3 && sp.getSceneState().retryNext && !sp.getSceneState().last.ok && sp.getSceneState().last.error.includes('Value not in list: lora_name') && sp.getSceneState().last.file === 'DES Scene Moss.json');
comfyMode = 'ok';
chat.push(user('I keep up.'));
sp.onSceneMessageSent();
check('the next turn is due at once', sp.getSceneStatus().armed);
chat.push(ai('Up the hill.'));
sp.onSceneGenerationEnded();
await wait(150);
check('…and the retry posts the picture', chat.length === before3 + 3 && chat[chat.length - 1].name === 'Narrator' && !sp.getSceneState().retryNext);

console.log('\n§4 a busy chat, no job id, the feature off');
STUB.__setSendPress(true);
let r = await sp.illustrateNow({ reason: 'command' });
STUB.__setSendPress(false);
check('a chat that stays busy gives up and arms a retry', !r.ok && r.reason === 'busy' && sp.getSceneState().retryNext);
comfyMode = 'noworkflow';
r = await sp.illustrateNow({ reason: 'command' });
comfyMode = 'ok';
check('a workflow missing from the store is a failure named', !r.ok && r.reason === 'error' && r.error.includes('empty or missing'));
extensionSettings.scenePictures.model = '';
r = await sp.illustrateNow({ reason: 'command' });
extensionSettings.scenePictures.model = 'moss_image_sft_int8_convrot.safetensors';
check('a placeholder nothing fills is a failure named', !r.ok && r.error.includes('%model%'));
const test = await sp.testComfy();
check('Test connection: ComfyUI answers, the store listed, the workflow ready', test.ok && test.line.includes('ComfyUI answers at http://127.0.0.1:8189') && test.line.includes('is ready') && test.workflows.length === 2);
extensionSettings.scenePictures.enabled = false;
r = await sp.illustrateNow({ reason: 'command' });
check('/scene with the feature off says so', !r.ok && r.reason === 'disabled');
extensionSettings.scenePictures.enabled = true;

console.log('\n§5 captions reach the AI, and a chat switch mid-run');
extensionSettings.scenePictures.toAI = true;
r = await sp.illustrateNow({ reason: 'manual' });
check('with captions reaching the AI the message is a narrator message, not a system one', r.ok && chat[chat.length - 1].is_system === false && chat[chat.length - 1].name === 'Narrator');
extensionSettings.scenePictures.toAI = false;
comfyMode = 'slow';
const lenBefore = chat.length;
const running = sp.illustrateNow({ reason: 'manual' });
await wait(20);
// A chat switch: SillyTavern loads the other chat (a new id) and CHAT_CHANGED reaches the module.
globalThis.__DES_CTX__.chatId = 'other-chat';
sp.onSceneChatChanged();
r = await running;
comfyMode = 'ok';
check('a run whose chat changed is discarded whole', !r.ok && r.reason === 'stale' && chat.length === lenBefore);
globalThis.__DES_CTX__.chatId = 'test-chat';
sp.onSceneChatChanged();
check('the state after the switch is the other chat\'s, fresh', sp.getSceneState().sinceLast === 0 && !sp.getSceneState().retryNext);

console.log(failures === 0 ? '\nAll scene pictures flow checks pass' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
