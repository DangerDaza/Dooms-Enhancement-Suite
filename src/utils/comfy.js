/**
 * ComfyUI, pure: the workflow text from SillyTavern's store with its
 * placeholders filled the way the image extension fills them, this chat's
 * LoRAs spliced after the model loader, the body SillyTavern's
 * /api/sd/comfy/generate takes, the WebSocket address for a render's
 * progress, the words the progress bar shows, and the picture out of the
 * server's answer. Used by the image service (src/systems/features/
 * imageGen.js) for every purpose; src/utils/scenePictures.js re-exports
 * these for its own readers. No SillyTavern, no DOM.
 */

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

/**
 * The body SillyTavern's /api/sd/comfy/generate takes: the ComfyUI address
 * and the graph as the text it posts to /prompt. With a client id, ComfyUI
 * sends that client the render's progress over its WebSocket.
 */
export function comfyGenerateBody(comfyUrl, graph, clientId = '') {
    const body = { prompt: graph };
    if (clientId) body.client_id = String(clientId);
    return { url: String(comfyUrl || '').replace(/\/+$/, ''), prompt: JSON.stringify(body) };
}

/** ComfyUI's WebSocket for a client: ws(s)://host/ws?clientId=…, from its http(s) address. */
export function comfyWsUrl(comfyUrl, clientId) {
    const base = String(comfyUrl || '').trim().replace(/\/+$/, '');
    const m = base.match(/^(https?):\/\/(.+)$/i);
    if (!m) return '';
    return `${m[1].toLowerCase() === 'https' ? 'wss' : 'ws'}://${m[2]}/ws?clientId=${encodeURIComponent(String(clientId || ''))}`;
}

/** A client id for one render: letters and digits, 32 long. */
export function newClientId(rng = Math.random) {
    let s = '';
    while (s.length < 32) s += Math.floor(rng() * 36).toString(36);
    return s.slice(0, 32);
}

/** Each node's class type by id, for naming the stage a render is in. */
export function nodeKinds(graph) {
    const out = {};
    for (const [id, node] of Object.entries(graph && typeof graph === 'object' ? graph : {})) {
        if (node && typeof node === 'object' && typeof node.class_type === 'string') out[id] = node.class_type;
    }
    return out;
}

const STAGE_WORDS = Object.freeze({
    idle: '', waiting: 'waiting for the chat to be free', caption: 'writing the caption', queued: 'waiting in ComfyUI\'s queue',
    rendering: 'rendering', saving: 'saving the picture', done: 'done', failed: 'failed',
});

/** What a node's class type means to a reader of the bar. */
export function nodeStageWord(classType) {
    const t = String(classType || '');
    if (/Loader/.test(t)) return 'loading the model';
    if (/CLIPTextEncode|TextEncode/.test(t)) return 'reading the caption';
    if (/TextGenerate/.test(t)) return 'the enhancer is writing';
    if (/Sampler/.test(t)) return 'rendering';
    if (/VAEDecode/.test(t)) return 'decoding';
    if (/SaveImage|PreviewImage/.test(t)) return 'saving';
    if (/Guidance/.test(t)) return 'preparing guidance';
    return t ? 'working' : '';
}

/**
 * The bar's text and fill for a progress state { stage, value, max, node
 * (class type), queue, startedAt, now }: a percent while ComfyUI counts
 * steps, else the stage with the seconds elapsed, no fill (the bar shows
 * it as indeterminate).
 */
export function progressLabel(p, label = 'Scene picture') {
    const s = p && typeof p === 'object' ? p : {};
    const stage = STAGE_WORDS[s.stage] !== undefined ? s.stage : 'idle';
    if (stage === 'idle') return { text: '', percent: null };
    const elapsed = Number.isFinite(s.startedAt) && Number.isFinite(s.now) && s.now >= s.startedAt ? Math.round((s.now - s.startedAt) / 1000) : null;
    const secs = elapsed !== null ? ` · ${elapsed}s` : '';
    if (stage === 'rendering') {
        const word = nodeStageWord(s.node) || 'rendering';
        const max = Number(s.max);
        const value = Number(s.value);
        if (Number.isFinite(max) && max > 0 && Number.isFinite(value) && value >= 0) {
            const percent = Math.max(0, Math.min(100, Math.round((value / max) * 100)));
            return { text: `${label}: ${word} ${Math.min(value, max)}/${max}${secs}`, percent };
        }
        return { text: `${label}: ${word}${secs}`, percent: null };
    }
    if (stage === 'queued') {
        const q = Number(s.queue);
        return { text: `${label}: ${STAGE_WORDS.queued}${Number.isFinite(q) && q > 0 ? ` (${q} ahead)` : ''}${secs}`, percent: null };
    }
    if (stage === 'done') return { text: `${label}: done`, percent: 100 };
    if (stage === 'failed') return { text: `${label}: failed${s.error ? ` — ${s.error}` : ''}`, percent: null };
    return { text: `${label}: ${STAGE_WORDS[stage]}${secs}`, percent: null };
}

/** The data URL out of the server's answer ({ format, data } in base64), '' when there is none. */
export function readComfyResult(json) {
    const j = json && typeof json === 'object' ? json : {};
    if (typeof j.data !== 'string' || !j.data) return '';
    const format = typeof j.format === 'string' && j.format ? j.format.toLowerCase() : 'png';
    const mime = format === 'jpg' ? 'jpeg' : format;
    return `data:image/${mime};base64,${j.data}`;
}

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
