/**
 * Scene pictures — the model (Project Short Fuse, Phase 7; docs/scene-pictures-plan.md).
 *
 * Every N of the player's turns a background request turns the recent
 * messages into one caption for MOSS-Image, Moss Studio (the owner's local
 * pipeline in front of ComfyUI) renders it with this chat's LoRAs, and the
 * picture lands in the chat as a message from the narrator.
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
    studioUrl: 'http://127.0.0.1:8791',   // Moss Studio
    card: 'card2',                        // the ComfyUI the studio renders on
    every: 5,                             // a picture every N of the player's turns
    window: 12,                           // the messages the caption is written from
    size: 'portrait',
    steps: 25,
    cfg: 2.5,
    sampler: 'er_sde',
    scheduler: 'simple',
    slg: true,                            // SkipLayerGuidance, the studio's default
    enhancer: false,                      // the studio's prompt enhancer
    unet: '',                             // empty: the studio's defaults
    clip: '',
    vae: '',
    narrator: 'Narrator',                 // the name on the message
    toAI: false,                          // the message stays a system message: the AI never sees the caption
    preamble: 'Anime-style digital illustration. ',
    negative: 'nsfw, worst quality, bad anatomy, watermark, jpeg artifact',
    guide: '',                            // extra caption rules, the owner's
    timeoutSec: 180,                      // the studio gets this long per picture
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
    const url = str(c.studioUrl, '').trim().replace(/\/+$/, '');
    return {
        enabled: c.enabled === true,
        studioUrl: url || CONFIG_DEFAULTS.studioUrl,
        card: c.card === 'card1' ? 'card1' : 'card2',
        every: int(c.every, 1, 50, CONFIG_DEFAULTS.every),
        window: int(c.window, 2, 40, CONFIG_DEFAULTS.window),
        size: SIZE_PRESETS.some(p => p.id === c.size) ? c.size : CONFIG_DEFAULTS.size,
        steps: int(c.steps, 1, 100, CONFIG_DEFAULTS.steps),
        cfg: num(c.cfg, 0, 20, CONFIG_DEFAULTS.cfg),
        sampler: str(c.sampler, '').trim() || CONFIG_DEFAULTS.sampler,
        scheduler: str(c.scheduler, '').trim() || CONFIG_DEFAULTS.scheduler,
        slg: c.slg !== false,
        enhancer: c.enhancer === true,
        unet: str(c.unet, '').trim(),
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

// ─── The studio ─────────────────────────────────────────────────────────────

export function studioEndpoints(cfg) {
    const base = (cfg && cfg.studioUrl ? cfg.studioUrl : CONFIG_DEFAULTS.studioUrl).replace(/\/+$/, '');
    const card = encodeURIComponent(cfg && cfg.card ? cfg.card : 'card2');
    return {
        base,
        config: `${base}/api/config`,
        preflight: `${base}/api/preflight?card=${card}`,
        loras: `${base}/api/loras?card=${card}`,
        generate: `${base}/api/generate`,
        jobs: `${base}/api/jobs`,
        image: (file) => `${base}/api/image?f=${encodeURIComponent(String(file || ''))}`,
    };
}

/** The body of POST /api/generate for one picture of this chat. */
export function buildGenerateBody(cfg, state, caption, { seed = -1, title = '', character = '' } = {}) {
    const size = sizeOf(cfg);
    const body = {
        card: cfg.card,
        positive: `${cfg.preamble || ''}${caption}`.trim(),
        negative: cfg.negative || '',
        width: size.width,
        height: size.height,
        steps: cfg.steps,
        cfg: cfg.cfg,
        sampler: cfg.sampler,
        scheduler: cfg.scheduler,
        seed: Number.isInteger(seed) ? seed : -1,
        count: 1,
        slg: cfg.slg,
        loras: normalizeLoras(state && state.loras),
        enhancer: cfg.enhancer,
        title: title || 'DES scene',
    };
    if (character) body.character = character;
    for (const k of ['unet', 'clip', 'vae']) if (cfg[k]) body[k] = cfg[k];
    return body;
}

/** The job id out of the generate answer, '' when none can be read. */
export function readJobId(json) {
    const j = json && typeof json === 'object' ? json : {};
    const job = j.job && typeof j.job === 'object' ? j.job : j;
    const id = job.id ?? job.job_id ?? job.prompt_id ?? j.id ?? j.job_id ?? j.prompt_id;
    return id === undefined || id === null ? '' : String(id);
}

const DONE_WORDS = new Set(['done', 'finished', 'complete', 'completed', 'success', 'succeeded', 'ok']);
const FAILED_WORDS = new Set(['error', 'failed', 'failure', 'cancelled', 'canceled', 'interrupted']);

/**
 * The state of one job in the /api/jobs answer, read tolerantly: the job by
 * id (as `id`, `job_id` or `prompt_id`, in a list, under `jobs`, or as a
 * key), done when its status says so or images exist and nothing says it is
 * still running, failed when its status says so; the images as paths.
 */
export function readJobs(json, id) {
    const want = String(id || '');
    const out = { found: false, done: false, failed: false, status: '', images: [], error: '' };
    if (!want) return out;
    const root = json && typeof json === 'object' ? json : {};
    let list = Array.isArray(root) ? root : Array.isArray(root.jobs) ? root.jobs : null;
    let job = null;
    if (list) {
        job = list.find(j => j && typeof j === 'object' && [j.id, j.job_id, j.prompt_id].some(v => v !== undefined && String(v) === want)) || null;
    } else {
        const store = root.jobs && typeof root.jobs === 'object' ? root.jobs : root;
        if (store[want] && typeof store[want] === 'object') job = store[want];
        else job = Object.values(store).find(j => j && typeof j === 'object' && [j.id, j.job_id, j.prompt_id].some(v => v !== undefined && String(v) === want)) || null;
    }
    if (!job) return out;
    out.found = true;
    const statusRaw = job.status ?? job.state ?? (job.prompt && typeof job.prompt === 'object' ? job.prompt.status : job.prompt);
    const status = typeof statusRaw === 'string' ? statusRaw.toLowerCase() : '';
    out.status = status;
    const images = Array.isArray(job.images) ? job.images : Array.isArray(job.outputs) ? job.outputs : [];
    out.images = images.map(i => typeof i === 'string' ? i : (i && typeof i === 'object' ? (i.file || i.path || i.f || i.filename || '') : '')).filter(Boolean);
    if (typeof job.error === 'string' && job.error) out.error = job.error;
    if (FAILED_WORDS.has(status) || (out.error && !DONE_WORDS.has(status))) { out.failed = true; return out; }
    if (DONE_WORDS.has(status) || job.done === true) { out.done = true; return out; }
    if (out.images.length && !/running|queued|pending|rendering|waiting/.test(status)) out.done = true;
    return out;
}

/** The LoRA names out of /api/loras, whatever shape the list takes. */
export function readLoraNames(json) {
    const root = json && typeof json === 'object' ? json : {};
    const list = Array.isArray(root) ? root : Array.isArray(root.loras) ? root.loras : Array.isArray(root.files) ? root.files : [];
    return list.map(i => typeof i === 'string' ? i : (i && typeof i === 'object' ? (i.name || i.file || i.filename || '') : '')).map(s => String(s).trim()).filter(Boolean);
}

/** What the preflight says, in a line. */
export function preflightLine(json) {
    const j = json && typeof json === 'object' ? json : {};
    const ok = j.reachable !== false && j.ok !== false;
    const bits = [];
    if (j.version) bits.push(`ComfyUI ${j.version}`);
    if (j.moss_supported === false) bits.push('MOSS not supported on this ComfyUI');
    if (j.busy) bits.push('busy rendering');
    return `${ok ? 'Moss Studio answers' : 'Moss Studio does not answer'}${bits.length ? ` (${bits.join(', ')})` : ''}.`;
}
