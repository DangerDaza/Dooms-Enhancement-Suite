/**
 * Scene pictures — the model (Project Short Fuse, Phase 7; docs/scene-pictures-plan.md).
 *
 * Every N of the player's turns a background request turns the recent
 * messages into one caption for MOSS-Image, the owner's Moss workflow renders
 * it on ComfyUI with this chat's LoRAs spliced in (through SillyTavern's own
 * ComfyUI endpoints, so nothing but ComfyUI has to run), and the picture lands
 * in the chat as a message from the narrator.
 *
 * Pure: no SillyTavern or DES state imports. The feature module
 * (src/systems/features/scenePictures.js) does the fetching and the chat;
 * tools/scene-pictures-test.mjs runs this in Node.
 *
 * What lives where:
 *   extensionSettings.scenePictures   the rules (CONFIG_DEFAULTS below)
 *   chat_metadata.dooms_scene         this chat's count, LoRAs, identity
 *                                     notes and the last picture
 */

export const SCENE_META_KEY = 'dooms_scene';
export const SCENE_STATE_VERSION = 1;

export const SIZE_PRESETS = Object.freeze([
    { id: 'portrait', label: 'Portrait 864 × 1536', width: 864, height: 1536, frame: 'a tall portrait frame' },
    { id: 'square', label: 'Square 1024 × 1024', width: 1024, height: 1024, frame: 'a square frame' },
    { id: 'landscape', label: 'Landscape 1536 × 864', width: 1536, height: 864, frame: 'a wide landscape frame' },
]);

export const CONFIG_DEFAULTS = Object.freeze({
    enabled: false,
    comfyUrl: 'http://127.0.0.1:8189',    // the ComfyUI the Moss workflow runs on (card 2 in the owner's setup)
    workflow: '',                         // a workflow in SillyTavern's own store (Image Generation → ComfyUI), with %prompt% and friends
    every: 5,                             // a picture every N of the player's turns
    window: 12,                           // the messages the caption is written from
    size: 'portrait',
    steps: 25,
    cfg: 2.5,
    sampler: 'er_sde',
    scheduler: 'simple',
    model: '',                            // what fills %model%, %clip% and %vae% when the workflow has them; empty leaves them to the workflow
    clip: '',
    vae: '',
    narrator: 'Narrator',                 // the name on the message
    toAI: false,                          // the message stays a system message: the AI never sees the caption
    preamble: 'Anime-style digital illustration. ',
    negative: 'nsfw, worst quality, bad anatomy, watermark, jpeg artifact',
    guide: '',                            // extra caption rules, the owner's
    timeoutSec: 180,                      // ComfyUI gets this long per picture
    notify: true,                         // a toast when a picture lands or fails
    debug: false,
});

/** A fresh copy of the defaults, for settings files. */
export function defaultScenePicturesConfig() {
    return { ...CONFIG_DEFAULTS };
}

/** The rules block as every reader should see it: settings.scenePictures with defaults filled in. */
export function scenePicturesConfig(settings) {
    const c = settings && settings.scenePictures && typeof settings.scenePictures === 'object' ? settings.scenePictures : {};
    const int = (v, lo, hi, d) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
    const num = (v, lo, hi, d) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
    const str = (v, d) => (typeof v === 'string' ? v : d);
    const url = str(c.comfyUrl, '').trim().replace(/\/+$/, '');
    return {
        enabled: c.enabled === true,
        comfyUrl: url || CONFIG_DEFAULTS.comfyUrl,
        workflow: str(c.workflow, '').trim(),
        every: int(c.every, 1, 50, CONFIG_DEFAULTS.every),
        window: int(c.window, 2, 40, CONFIG_DEFAULTS.window),
        size: SIZE_PRESETS.some(p => p.id === c.size) ? c.size : CONFIG_DEFAULTS.size,
        steps: int(c.steps, 1, 100, CONFIG_DEFAULTS.steps),
        cfg: num(c.cfg, 0, 20, CONFIG_DEFAULTS.cfg),
        sampler: str(c.sampler, '').trim() || CONFIG_DEFAULTS.sampler,
        scheduler: str(c.scheduler, '').trim() || CONFIG_DEFAULTS.scheduler,
        model: str(c.model, '').trim(),
        clip: str(c.clip, '').trim(),
        vae: str(c.vae, '').trim(),
        narrator: str(c.narrator, '').trim() || CONFIG_DEFAULTS.narrator,
        toAI: c.toAI === true,
        preamble: str(c.preamble, CONFIG_DEFAULTS.preamble),
        negative: str(c.negative, CONFIG_DEFAULTS.negative),
        guide: str(c.guide, ''),
        timeoutSec: int(c.timeoutSec, 20, 900, CONFIG_DEFAULTS.timeoutSec),
        notify: c.notify !== false,
        debug: c.debug === true,
    };
}

export function sizeOf(cfg) {
    return SIZE_PRESETS.find(p => p.id === (cfg && cfg.size)) || SIZE_PRESETS[0];
}

// ─── This chat's state ──────────────────────────────────────────────────────

export function freshSceneState() {
    return { v: SCENE_STATE_VERSION, sinceLast: 0, retryNext: false, lastKey: '', loras: [], identity: '', last: null };
}

/** The chat's state as every reader should see it, a copy, defaults filled in; a fresh one from nothing. */
export function sceneStateOf(raw) {
    const s = raw && typeof raw === 'object' ? raw : {};
    const n = Math.round(Number(s.sinceLast));
    const last = s.last && typeof s.last === 'object' ? {
        at: Number.isFinite(Number(s.last.at)) ? Number(s.last.at) : 0,
        ok: s.last.ok === true,
        caption: typeof s.last.caption === 'string' ? s.last.caption : '',
        file: typeof s.last.file === 'string' ? s.last.file : '',
        url: typeof s.last.url === 'string' ? s.last.url : '',
        error: typeof s.last.error === 'string' ? s.last.error : '',
    } : null;
    return {
        v: SCENE_STATE_VERSION,
        sinceLast: Number.isFinite(n) && n >= 0 ? n : 0,
        retryNext: s.retryNext === true,
        lastKey: typeof s.lastKey === 'string' ? s.lastKey : '',
        loras: normalizeLoras(s.loras),
        identity: typeof s.identity === 'string' ? s.identity : '',
        last,
    };
}

/** A player's turn counted once: the same key (a message's id or timestamp) never counts twice. */
export function countTurn(state, key) {
    const k = String(key || '');
    if (!k || k === state.lastKey) return { state, counted: false };
    return { state: { ...state, sinceLast: state.sinceLast + 1, lastKey: k }, counted: true };
}

export function pictureDue(state, every) {
    const n = Number.isInteger(every) && every > 0 ? every : CONFIG_DEFAULTS.every;
    return state.retryNext || state.sinceLast >= n;
}

/** The state after a picture landed. */
export function afterPicture(state, { at, caption = '', file = '', url = '' } = {}) {
    return { ...state, sinceLast: 0, retryNext: false, last: { at: at || 0, ok: true, caption, file, url, error: '' } };
}

/** The state after a run failed: the next turn tries again. */
export function afterFailure(state, { at, error = '' } = {}) {
    const prev = state.last || { caption: '', file: '', url: '' };
    return { ...state, retryNext: true, last: { at: at || 0, ok: false, caption: prev.caption, file: prev.file, url: prev.url, error: String(error || 'failed') } };
}

// ─── LoRAs ──────────────────────────────────────────────────────────────────

/** [{ name, strength }]: names trimmed and unique (case aside), strengths −3…3, 1 when missing. */
export function normalizeLoras(list) {
    const out = [];
    const seen = new Set();
    for (const item of Array.isArray(list) ? list : []) {
        const name = typeof item === 'string' ? item.trim() : (item && typeof item.name === 'string' ? item.name.trim() : '');
        if (!name) continue;
        const key = name.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        const raw = typeof item === 'object' && item ? Number(item.strength) : NaN;
        const strength = Number.isFinite(raw) ? Math.min(3, Math.max(-3, Math.round(raw * 100) / 100)) : 1;
        out.push({ name, strength });
    }
    return out;
}

/** "name:0.8" per line or comma, a bare name at strength 1. */
export function parseLoraList(text) {
    const parts = String(text || '').split(/[\n,]+/).map(s => s.trim()).filter(Boolean);
    return normalizeLoras(parts.map(p => {
        const m = p.match(/^(.*?)\s*[:@]\s*(-?\d+(?:\.\d+)?)\s*$/);
        return m ? { name: m[1].trim(), strength: Number(m[2]) } : { name: p, strength: 1 };
    }));
}

export function formatLoraList(list) {
    return normalizeLoras(list).map(l => `${l.name}:${l.strength}`).join('\n');
}

// ─── The caption ────────────────────────────────────────────────────────────

/**
 * The background request that writes the caption: what the model is told
 * and what it is shown. `recent` is the chat window as text ("Name: …"
 * lines), `present` the names on the shelf, `identity` the chat's notes on
 * how its characters look.
 */
export function buildCaptionPrompt({ recent = '', present = [], identity = '', guide = '', size = 'portrait' } = {}) {
    const frame = (SIZE_PRESETS.find(p => p.id === size) || SIZE_PRESETS[0]).frame;
    const rules = [
        'You write the caption for one picture of the scene below, for an image model.',
        `Natural language, 150 to 300 words, one paragraph: begin with the medium and the framing (how close, what fills ${frame}), then the finished picture as a viewer sees it: who is where, poses, expressions, clothing, light, setting, mood.`,
        'Describe what is seen, never the story. The image model knows no names: never write a character\'s name; describe their look instead, from the identity notes when there are any, copied closely.',
        'Nothing but the caption: no title, no quotes, no list, no notes.',
    ];
    const extra = String(guide || '').trim();
    if (extra) rules.push(extra);
    const notes = String(identity || '').trim();
    const system = `${rules.join(' ')}${notes ? `\n\nIdentity notes (how the characters look):\n${notes}` : ''}`;
    const names = (Array.isArray(present) ? present : []).map(n => String(n || '').trim()).filter(Boolean);
    const user = `Recent scene:\n${String(recent || '').trim() || '(nothing yet)'}${names.length ? `\n\nCharacters present: ${names.join(', ')}.` : ''}\n\nWrite the caption.`;
    return { system, user };
}

/** The caption out of the model's answer: fences, labels and quotes off, one paragraph, '' when nothing usable. */
export function parseCaptionReply(text) {
    let s = String(text || '').trim();
    s = s.replace(/^```[a-z]*\s*/i, '').replace(/\s*```$/, '').trim();
    s = s.replace(/^(?:caption|prompt)\s*:\s*/i, '').trim();
    if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith('“') && s.endsWith('”'))) s = s.slice(1, -1).trim();
    s = s.replace(/[<>]/g, ' ').replace(/\s*[\r\n]+\s*/g, ' ').replace(/\s{2,}/g, ' ').trim();
    if (s.length > 2000) s = `${s.slice(0, 1999).trimEnd()}…`;
    return s.length >= 20 ? s : '';
}

/** The first sentence or so of the caption, for the message's own line. */
export function captionLine(caption, max = 160) {
    const s = String(caption || '').trim();
    if (!s) return '';
    const m = s.match(/^(.+?[.!?])(\s|$)/);
    const line = m ? m[1] : s;
    return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
}

// ─── ComfyUI, through SillyTavern (D62) ─────────────────────────────────────
//
// SillyTavern's own image extension drives a ComfyUI from its server: a
// workflow from the user's store with "%placeholder%" values filled in,
// posted as {"prompt": graph}; the server queues it, waits on the history
// and hands the first image back as base64. DES does the same with the
// owner's Moss workflow and this chat's LoRA chain spliced in, so no header,
// no second server and nothing but ComfyUI has to be running.

/** A 1×1 transparent PNG, what the image extension puts in %user_avatar% and %char_avatar% when there is none. */
export const PNG_PIXEL = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

/**
 * The placeholders a workflow text carries, lower-cased, each once: a whole
 * quoted value ("%prompt%") or a token inside a longer string ("Anime
 * illustration, %prompt%"), both as the owner's workflows write them.
 */
export function workflowPlaceholders(text) {
    const out = [];
    const seen = new Set();
    for (const m of String(text || '').matchAll(/%([A-Za-z_][A-Za-z0-9_]*)%/g)) {
        const k = m[1].toLowerCase();
        if (!seen.has(k)) { seen.add(k); out.push(k); }
    }
    return out;
}

/** True when the text is the ComfyUI editor's save format (nodes and links), not the API graph DES can fill. */
export function isEditorWorkflow(text) {
    try {
        const j = JSON.parse(String(text || ''));
        return !!(j && typeof j === 'object' && Array.isArray(j.nodes) && Array.isArray(j.links));
    } catch (e) { return false; }
}

/**
 * The values for a workflow's placeholders: the caption and the negative,
 * the sampling, the size, and the models when set. Keys are the image
 * extension's names, so a workflow made for it works here unchanged.
 */
export function workflowValues(cfg, { caption = '', seed = -1 } = {}) {
    const size = sizeOf(cfg);
    const v = {
        prompt: `${cfg.preamble || ''}${caption}`.trim(),
        negative_prompt: cfg.negative || '',
        seed: Number.isInteger(seed) && seed >= 0 ? seed : Math.floor(Math.random() * 2147483647),
        steps: cfg.steps,
        scale: cfg.cfg,
        sampler: cfg.sampler,
        scheduler: cfg.scheduler,
        width: size.width,
        height: size.height,
        denoise: 1,
        clip_skip: 1,
        user_avatar: PNG_PIXEL,
        char_avatar: PNG_PIXEL,
    };
    if (cfg.model) v.model = cfg.model;
    if (cfg.clip) v.clip = cfg.clip;
    if (cfg.vae) v.vae = cfg.vae;
    return v;
}

/**
 * The workflow text with its placeholders filled the way the image extension
 * fills them: a whole quoted token "%name%" becomes the JSON of the value, so
 * a number stays a number; a token inside a longer string becomes the value
 * escaped for that string. Placeholders with no value are left and listed.
 */
export function fillWorkflow(text, values) {
    let out = String(text || '');
    const given = values && typeof values === 'object' ? values : {};
    const lower = {};
    for (const [k, v] of Object.entries(given)) lower[k.toLowerCase()] = v;
    const missing = [];
    for (const name of workflowPlaceholders(out)) {
        const v = lower[name];
        if (v === undefined || v === null || v === '') { missing.push(name); continue; }
        out = out.replace(new RegExp(`"%${name}%"`, 'gi'), () => JSON.stringify(v));
        out = out.replace(new RegExp(`%${name}%`, 'gi'), () => JSON.stringify(String(v)).slice(1, -1));
    }
    return { text: out, missing };
}

/** A LoRA's file name as ComfyUI lists it: ".safetensors" added when the name has no extension. */
export function ensureLoraFile(name) {
    const n = String(name || '').trim();
    if (!n) return '';
    const last = n.split(/[\\/]/).pop();
    return /\.[A-Za-z0-9]{2,12}$/.test(last) ? n : `${n}.safetensors`;
}

const LOADER_TYPES = new Set(['UNETLoader', 'CheckpointLoaderSimple', 'UnetLoaderGGUF', 'ImageOnlyCheckpointLoader', 'CheckpointLoader']);
const SAMPLER_TYPES = new Set(['KSampler', 'KSamplerAdvanced', 'SamplerCustom', 'SamplerCustomAdvanced']);

function isRef(v, id) { return Array.isArray(v) && v.length === 2 && String(v[0]) === String(id) && Number(v[1]) === 0; }

/** The node id of the model loader a sampler's model input leads back to, or the first loader in the graph, or null. */
export function findModelLoader(graph) {
    const g = graph && typeof graph === 'object' ? graph : {};
    const sampler = Object.keys(g).find(id => g[id] && SAMPLER_TYPES.has(g[id].class_type));
    let id = sampler || null;
    const seen = new Set();
    while (id && g[id] && !seen.has(id)) {
        seen.add(id);
        const node = g[id];
        if (LOADER_TYPES.has(node.class_type)) return id;
        const ref = node.inputs && Array.isArray(node.inputs.model) ? node.inputs.model : null;
        id = ref ? String(ref[0]) : null;
    }
    const any = Object.keys(g).find(k => g[k] && LOADER_TYPES.has(g[k].class_type));
    return any || null;
}

/**
 * The graph with this chat's LoRA chain spliced in right after the model
 * loader (the studio's own order: loader → LoRAs → guidance → sampler):
 * every input that took the loader's model now takes the last LoRA's, each
 * LoRA a LoraLoaderModelOnly on the one before. A copy; the graph given is
 * untouched. No loader, or no LoRAs: the copy unchanged.
 */
export function injectLoras(graph, loras) {
    const copy = JSON.parse(JSON.stringify(graph && typeof graph === 'object' ? graph : {}));
    const list = normalizeLoras(loras);
    const loader = findModelLoader(copy);
    if (!loader || !list.length) return { graph: copy, inserted: 0, loader };
    const consumers = [];
    for (const [id, node] of Object.entries(copy)) {
        if (!node || typeof node !== 'object' || !node.inputs || typeof node.inputs !== 'object') continue;
        for (const [input, value] of Object.entries(node.inputs)) if (isRef(value, loader)) consumers.push([id, input]);
    }
    let prev = loader;
    list.forEach((l, i) => {
        const id = `des_lora_${i + 1}`;
        copy[id] = { class_type: 'LoraLoaderModelOnly', inputs: { lora_name: ensureLoraFile(l.name), strength_model: l.strength, model: [prev, 0] }, _meta: { title: `DES LoRA: ${l.name}` } };
        prev = id;
    });
    for (const [id, input] of consumers) copy[id].inputs[input] = [prev, 0];
    return { graph: copy, inserted: list.length, loader };
}

/** The body SillyTavern's /api/sd/comfy/generate takes: the ComfyUI address and the graph as the text it posts to /prompt. */
export function comfyGenerateBody(comfyUrl, graph) {
    return { url: String(comfyUrl || '').replace(/\/+$/, ''), prompt: JSON.stringify({ prompt: graph }) };
}

/** The data URL out of the server's answer ({ format, data } in base64), '' when there is none. */
export function readComfyResult(json) {
    const j = json && typeof json === 'object' ? json : {};
    if (typeof j.data !== 'string' || !j.data) return '';
    const format = typeof j.format === 'string' && j.format ? j.format.toLowerCase() : 'png';
    const mime = format === 'jpg' ? 'jpeg' : format;
    return `data:image/${mime};base64,${j.data}`;
}
