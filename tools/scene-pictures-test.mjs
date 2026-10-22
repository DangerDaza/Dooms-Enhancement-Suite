/**
 * Scene pictures model tests (src/utils/scenePictures.js). Run: node tools/scene-pictures-test.mjs
 */
import * as S from '../src/utils/scenePictures.js';

let failures = 0;
function check(name, ok) { console.log(`${ok ? 'pass' : 'FAIL'}  ${name}`); if (!ok) failures++; }

// ── 1. Config ──
{
    const d = S.scenePicturesConfig({});
    check('defaults: off, ComfyUI on 8189, no workflow, every 5, 12 messages, portrait', !d.enabled && d.comfyUrl === 'http://127.0.0.1:8189' && d.workflow === '' && d.every === 5 && d.window === 12 && d.size === 'portrait' && !d.toAI && d.narrator === 'Narrator');
    const c = S.scenePicturesConfig({ scenePictures: { enabled: true, comfyUrl: ' http://localhost:9000/// ', workflow: ' Moss.json ', every: '0', window: 99, size: 'tall', steps: 8, cfg: '1', narrator: '  ', timeoutSec: 5, model: ' kromoss ' } });
    check('normalised: url trimmed of slashes, workflow trimmed, every clamps to 1, window to 40, a bad size falls back, narrator back to default, timeout to 20, model trimmed', c.enabled && c.comfyUrl === 'http://localhost:9000' && c.workflow === 'Moss.json' && c.every === 1 && c.window === 40 && c.size === 'portrait' && c.steps === 8 && c.cfg === 1 && c.narrator === 'Narrator' && c.timeoutSec === 20 && c.model === 'kromoss');
    check('sizeOf', S.sizeOf({ size: 'landscape' }).width === 1536 && S.sizeOf({ size: 'nope' }).id === 'portrait');
}

// ── 2. State and cadence ──
{
    const s0 = S.freshSceneState();
    check('fresh state', s0.sinceLast === 0 && !s0.retryNext && s0.loras.length === 0 && s0.last === null);
    let r = S.countTurn(s0, 'm1');
    check('a turn counts once', r.counted && r.state.sinceLast === 1 && !S.countTurn(r.state, 'm1').counted);
    let s = r.state;
    for (const k of ['m2', 'm3', 'm4']) s = S.countTurn(s, k).state;
    check('due at every', !S.pictureDue(s, 5) && S.pictureDue(S.countTurn(s, 'm5').state, 5) && S.pictureDue({ ...s, retryNext: true }, 5));
    const done = S.afterPicture(S.countTurn(s, 'm5').state, { at: 10, caption: 'c', file: 'f.png', url: '/user/images/x.png' });
    check('after a picture: count reset, last kept', done.sinceLast === 0 && !done.retryNext && done.last.ok && done.last.file === 'f.png' && done.lastKey === 'm5');
    const failed = S.afterFailure(done, { at: 11, error: 'timeout' });
    check('after a failure: retry armed, the last picture kept beside the error', failed.retryNext && !failed.last.ok && failed.last.error === 'timeout' && failed.last.file === 'f.png');
    const read = S.sceneStateOf({ sinceLast: '3', retryNext: 'yes', loras: ['A', { name: 'B', strength: 9 }, { name: 'a' }, ''], identity: 7, last: { at: '5', ok: true, caption: 'x' } });
    check('sceneStateOf normalises', read.sinceLast === 3 && read.retryNext === false && read.loras.length === 2 && read.loras[1].strength === 3 && read.identity === '' && read.last.at === 5 && read.last.ok && read.last.file === '');
    check('sceneStateOf from nothing', S.sceneStateOf(undefined).sinceLast === 0 && S.sceneStateOf(null).last === null);
}

// ── 3. LoRAs ──
{
    const l = S.parseLoraList('BunnySlop_MOSS:0.8\nFlat_Anime_Moss-Image-, moss_image_color_depth_control @ -1.5\n bunnyslop_moss : 2');
    check('parseLoraList: strength after : or @, bare at 1, duplicates (case aside) dropped', l.length === 3 && l[0].name === 'BunnySlop_MOSS' && l[0].strength === 0.8 && l[1].strength === 1 && l[2].strength === -1.5);
    check('formatLoraList round-trips', S.formatLoraList(l) === 'BunnySlop_MOSS:0.8\nFlat_Anime_Moss-Image-:1\nmoss_image_color_depth_control:-1.5' && S.parseLoraList(S.formatLoraList(l)).length === 3);
    check('normalizeLoras clamps and rounds', S.normalizeLoras([{ name: 'x', strength: 0.123456 }, { name: 'y', strength: -7 }])[0].strength === 0.12 && S.normalizeLoras([{ name: 'y', strength: -7 }])[0].strength === -3);
}

// ── 4. The caption ──
{
    const p = S.buildCaptionPrompt({ recent: 'Jordan: I step in.\nMara: She looks up.', present: ['Mara Vane'], identity: 'Mara: red hair in a braid, grey coat', guide: 'Never show weapons.', size: 'landscape' });
    check('the caption prompt: rules, frame, identity notes, the extra rule, the scene, who is present', p.system.includes('150 to 300 words') && p.system.includes('a wide landscape frame') && p.system.includes('Identity notes') && p.system.includes('red hair in a braid') && p.system.includes('Never show weapons.') && p.system.includes('never write a character\'s name') && p.user.includes('Jordan: I step in.') && p.user.includes('Characters present: Mara Vane.') && p.user.endsWith('Write the caption.'));
    check('mergeIdentityNotes: the chat\'s notes first, a line per card not already named, empty looks skipped, long ones cut', (() => {
        const m = S.mergeIdentityNotes('Mara: as I wrote her', [{ name: 'Mara', look: 'red hair' }, { name: 'Tomas', look: '  tall,   bearded ' }, { name: 'Nobody', look: '' }, { name: 'Long', look: 'x'.repeat(600) }], { max: 100 });
        const lines = m.split('\n');
        return lines[0] === 'Mara: as I wrote her' && lines[1] === 'Tomas: tall, bearded' && lines[2].startsWith('Long: xxx') && lines[2].length === 106 && lines.length === 3 && S.mergeIdentityNotes('', []) === '' && S.mergeIdentityNotes('', [{ name: 'A', look: 'b' }]) === 'A: b' && S.mergeIdentityNotes('Mara: red hair', [{ name: 'Mara Vane', look: 'fox ears' }]) === 'Mara: red hair' && S.mergeIdentityNotes('Maria: x', [{ name: 'Mara Vane', look: 'fox ears' }]).includes('Mara Vane: fox ears');
    })());
    check('no notes, no present: the lines are left out', !S.buildCaptionPrompt({ recent: 'x' }).system.includes('Identity notes') && !S.buildCaptionPrompt({ recent: 'x' }).user.includes('present'));
    check('parseCaptionReply: fences, label and quotes off, one line', S.parseCaptionReply('```\nCaption: "Anime-style digital illustration of a woman\nin a grey coat, standing in a market at dusk, looking up."\n```') === 'Anime-style digital illustration of a woman in a grey coat, standing in a market at dusk, looking up.');
    check('parseCaptionReply: angle brackets go, too short is nothing', !S.parseCaptionReply('<lora:x> hi').includes('<') && S.parseCaptionReply('short') === '' && S.parseCaptionReply('x'.repeat(2500)).length === 2000);
    check('captionLine: the first sentence, cut when long', S.captionLine('A tall frame. More words after.') === 'A tall frame.' && S.captionLine('w'.repeat(200)).length === 160);
}

// ── 5. ComfyUI through SillyTavern ──
{
    const WF = `{
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
    check('workflowPlaceholders: each once, lower-cased', S.workflowPlaceholders(WF).join() === 'model,vae,prompt,negative_prompt,width,height,seed,steps,scale,sampler,scheduler' && S.workflowPlaceholders('"%Prompt%" "%prompt%"').join() === 'prompt');
    const cfg = S.scenePicturesConfig({ scenePictures: { preamble: 'Anime-style digital illustration. ', size: 'landscape', model: 'moss_image_sft_int8_convrot.safetensors', vae: 'flux2-vae_small.safetensors' } });
    const values = S.workflowValues(cfg, { caption: 'a woman on a quay', seed: 7 });
    check('workflowValues: the extension\'s names, the preamble in the prompt, the size, the models when set, avatars as the pixel', values.prompt === 'Anime-style digital illustration. a woman on a quay' && values.negative_prompt.startsWith('nsfw') && values.seed === 7 && values.steps === 25 && values.scale === 2.5 && values.sampler === 'er_sde' && values.width === 1536 && values.height === 864 && values.model === 'moss_image_sft_int8_convrot.safetensors' && values.user_avatar === S.PNG_PIXEL && !('clip' in values));
    check('a random seed when none is given', (() => { const a = S.workflowValues(cfg, {}).seed; return Number.isInteger(a) && a >= 0; })());
    const filled = S.fillWorkflow(WF, values);
    const graph = JSON.parse(filled.text);
    check('fillWorkflow: numbers stay numbers, strings are quoted, nothing is missing', filled.missing.length === 0 && graph['3'].inputs.steps === 25 && graph['3'].inputs.cfg === 2.5 && graph['3'].inputs.seed === 7 && graph['6'].inputs.text === 'Anime-style digital illustration. a woman on a quay' && graph['8'].inputs.width === 1536 && graph['1'].inputs.unet_name === 'moss_image_sft_int8_convrot.safetensors');
    const bare = S.fillWorkflow(WF, S.workflowValues(S.scenePicturesConfig({}), { caption: 'x', seed: 1 }));
    check('placeholders with no value are left and named', bare.missing.join() === 'model,vae' && bare.text.includes('"%model%"'));
    check('a quote inside the caption survives as JSON', JSON.parse(S.fillWorkflow('{"a": {"inputs": {"text": "%prompt%"}}}', { prompt: 'she said "go"' }).text).a.inputs.text === 'she said "go"');
    const embedded = S.fillWorkflow('{"6": {"inputs": {"text": "Anime-style digital illustration, 1girl, %prompt%"}}, "7": {"inputs": {"text": "nsfw, %negative_prompt%"}}, "3": {"inputs": {"steps": "%steps%"}}}', { prompt: 'a woman who said "go"', negative_prompt: 'blurry', steps: 8 });
    const eg = JSON.parse(embedded.text);
    check('a placeholder inside a longer string is filled as an escaped fragment; a whole-value one stays typed', embedded.missing.length === 0 && eg['6'].inputs.text === 'Anime-style digital illustration, 1girl, a woman who said "go"' && eg['7'].inputs.text === 'nsfw, blurry' && eg['3'].inputs.steps === 8);
    check('workflowPlaceholders sees embedded tokens too', S.workflowPlaceholders('{"t": "prefix, %prompt%", "n": "%Negative_Prompt%"}').join() === 'prompt,negative_prompt');
    check('isEditorWorkflow: nodes and links is the editor\'s format, an API graph is not', S.isEditorWorkflow('{"nodes": [], "links": [], "version": 0.4}') && !S.isEditorWorkflow(WF) && !S.isEditorWorkflow('nope'));
    check('ensureLoraFile', S.ensureLoraFile('BunnySlop_MOSS') === 'BunnySlop_MOSS.safetensors' && S.ensureLoraFile('x/y.safetensors') === 'x/y.safetensors' && S.ensureLoraFile(' a.pt ') === 'a.pt' && S.ensureLoraFile('') === '');
    check('findModelLoader walks back from the sampler', S.findModelLoader(graph) === '1' && S.findModelLoader({ a: { class_type: 'KSampler', inputs: {} }, b: { class_type: 'CheckpointLoaderSimple', inputs: {} } }) === 'b' && S.findModelLoader({}) === null);
    const spliced = S.injectLoras(graph, [{ name: 'BunnySlop_MOSS', strength: 0.8 }, { name: 'Flat_Anime_Moss-Image-', strength: 1 }]);
    const g = spliced.graph;
    check('injectLoras: two LoRAs after the loader, the guidance node now fed by the last, the original untouched', spliced.inserted === 2 && spliced.loader === '1' && g.des_lora_1.class_type === 'LoraLoaderModelOnly' && g.des_lora_1.inputs.lora_name === 'BunnySlop_MOSS.safetensors' && g.des_lora_1.inputs.strength_model === 0.8 && g.des_lora_1.inputs.model.join() === '1,0' && g.des_lora_2.inputs.model.join() === 'des_lora_1,0' && g['9'].inputs.model.join() === 'des_lora_2,0' && graph['9'].inputs.model.join() === '1,0' && g['3'].inputs.model.join() === '9,0');
    const baked = { '1': { class_type: 'UNETLoader', inputs: { unet_name: 'm' } }, '5': { class_type: 'LoraLoaderModelOnly', inputs: { lora_name: 'house.safetensors', strength_model: 1, model: ['1', 0] } }, '3': { class_type: 'KSampler', inputs: { model: ['5', 0] } } };
    const b = S.injectLoras(baked, ['extra']).graph;
    check('a LoRA baked into the workflow stays, downstream of the chat\'s', b.des_lora_1.inputs.model.join() === '1,0' && b['5'].inputs.model.join() === 'des_lora_1,0' && b['3'].inputs.model.join() === '5,0' && b.des_lora_1.inputs.lora_name === 'extra.safetensors');
    check('no LoRAs or no loader: the copy unchanged', S.injectLoras(graph, []).inserted === 0 && JSON.stringify(S.injectLoras(graph, []).graph) === JSON.stringify(graph) && S.injectLoras({ a: { class_type: 'KSampler', inputs: {} } }, ['x']).loader === null);
    const body = S.comfyGenerateBody('http://127.0.0.1:8189/', g);
    check('comfyGenerateBody: the address and {"prompt": graph} as text', body.url === 'http://127.0.0.1:8189' && JSON.parse(body.prompt).prompt.des_lora_1.inputs.lora_name === 'BunnySlop_MOSS.safetensors');
    check('readComfyResult', S.readComfyResult({ format: 'png', data: 'AAAA' }) === 'data:image/png;base64,AAAA' && S.readComfyResult({ format: 'JPG', data: 'B' }) === 'data:image/jpeg;base64,B' && S.readComfyResult({}) === '' && S.readComfyResult(null) === '');
    check('a client id rides in the body; the ws address follows the http one', JSON.parse(S.comfyGenerateBody('http://127.0.0.1:8189', g, 'abc').prompt).client_id === 'abc' && !('client_id' in JSON.parse(S.comfyGenerateBody('http://x', g).prompt)) && S.comfyWsUrl('http://127.0.0.1:8189/', 'a b') === 'ws://127.0.0.1:8189/ws?clientId=a%20b' && S.comfyWsUrl('https://host:1/', 'x') === 'wss://host:1/ws?clientId=x' && S.comfyWsUrl('nope', 'x') === '');
    check('newClientId: 32 letters and digits, different each time', /^[a-z0-9]{32}$/.test(S.newClientId()) && S.newClientId() !== S.newClientId());
    check('nodeKinds + nodeStageWord', S.nodeKinds(graph)['3'] === 'KSampler' && S.nodeStageWord('KSampler') === 'rendering' && S.nodeStageWord('UNETLoader') === 'loading the model' && S.nodeStageWord('VAEDecode') === 'decoding' && S.nodeStageWord('SaveImage') === 'saving' && S.nodeStageWord('') === '');
    check('progressLabel: steps as a percent, stages as words with the seconds, idle as nothing', (() => {
        const r = S.progressLabel({ stage: 'rendering', value: 12, max: 25, node: 'KSampler', startedAt: 1000, now: 31000 });
        const q = S.progressLabel({ stage: 'queued', queue: 2, startedAt: 1000, now: 3000 });
        const c = S.progressLabel({ stage: 'caption', startedAt: 1000, now: 1000 });
        return r.text === 'Scene picture: rendering 12/25 · 30s' && r.percent === 48 && q.text === 'Scene picture: waiting in ComfyUI\'s queue (2 ahead) · 2s' && q.percent === null && c.text === 'Scene picture: writing the caption · 0s' && S.progressLabel({ stage: 'idle' }).text === '' && S.progressLabel({ stage: 'done' }).percent === 100 && S.progressLabel({ stage: 'failed', error: 'x' }).text === 'Scene picture: failed — x' && S.progressLabel({ stage: 'rendering', node: 'VAEDecode' }).text === 'Scene picture: decoding';
    })());
}

console.log(failures === 0 ? '\nAll scene pictures checks pass' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
