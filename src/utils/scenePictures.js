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

import { renderValues, SIZE_PRESETS as IMAGE_SIZES, COMFY_DEFAULTS } from './imageGen.js';
import { normalizeLoras } from './comfy.js';
export {
    PNG_PIXEL, workflowPlaceholders, isEditorWorkflow, fillWorkflow, ensureLoraFile, findModelLoader, injectLoras,
    comfyGenerateBody, comfyWsUrl, newClientId, nodeKinds, nodeStageWord, progressLabel, readComfyResult, normalizeLoras,
} from './comfy.js';
export { COMFY_DEFAULTS } from './imageGen.js';

export const SCENE_META_KEY = 'dooms_scene';
export const SCENE_STATE_VERSION = 1;

/** The size presets, the image service's (one list for every purpose). */
export const SIZE_PRESETS = IMAGE_SIZES;

export const CONFIG_DEFAULTS = Object.freeze({
    enabled: false,
    every: 5,                             // a picture every N of the player's turns
    window: 12,                           // the messages the caption is written from
    size: 'portrait',
    narrator: 'Narrator',                 // the name on the message
    preamble: 'Anime-style digital illustration. ',
    negative: 'nsfw, worst quality, bad anatomy, watermark, jpeg artifact',
    guide: '',                            // extra caption rules, the owner's
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
    const str = (v, d) => (typeof v === 'string' ? v : d);
    return {
        enabled: c.enabled === true,
        every: int(c.every, 1, 50, CONFIG_DEFAULTS.every),
        window: int(c.window, 2, 40, CONFIG_DEFAULTS.window),
        size: SIZE_PRESETS.some(p => p.id === c.size) ? c.size : CONFIG_DEFAULTS.size,
        narrator: str(c.narrator, '').trim() || CONFIG_DEFAULTS.narrator,
        preamble: str(c.preamble, CONFIG_DEFAULTS.preamble),
        negative: str(c.negative, CONFIG_DEFAULTS.negative),
        guide: str(c.guide, ''),
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

/**
 * The identity notes the caption writer gets: the chat's own notes first,
 * then one "Name: look" line per character the notes do not already name,
 * by the full name or by a first name of three letters or more as a whole
 * word (the typed notes win over the cards). `looks` is [{ name, look }];
 * empty looks are skipped; each look is cut to `max`.
 */
export function mergeIdentityNotes(chatNotes, looks, { max = 500 } = {}) {
    const notes = String(chatNotes || '').trim();
    const lowerNotes = notes.toLowerCase();
    const named = (name) => {
        const full = name.toLowerCase();
        if (lowerNotes.includes(full)) return true;
        const first = full.split(/\s+/)[0];
        if (first.length < 3) return false;
        return new RegExp(`(^|[^a-z0-9])${first.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`).test(lowerNotes);
    };
    const lines = [];
    const seen = new Set();
    for (const item of Array.isArray(looks) ? looks : []) {
        const name = item && typeof item.name === 'string' ? item.name.trim() : '';
        let look = item && typeof item.look === 'string' ? item.look.replace(/\s+/g, ' ').trim() : '';
        if (!name || !look) continue;
        const key = name.toLowerCase();
        if (seen.has(key) || named(name)) continue;
        seen.add(key);
        if (look.length > max) look = `${look.slice(0, max - 1).trimEnd()}…`;
        lines.push(`${name}: ${look}`);
    }
    return [notes, ...lines].filter(Boolean).join('\n');
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




/**
 * The values for a workflow's placeholders for a scene picture: the
 * preamble and the caption, the scene's negative and size, the connection's
 * sampling and models (`comfy`: settings.imageGen.comfy; the config itself
 * when it still carries them). Keys are the image extension's names.
 */
export function workflowValues(cfg, { caption = '', seed = -1, comfy = null } = {}) {
    const conn = comfy || cfg || {};
    return renderValues({ prompt: `${(cfg && cfg.preamble) || ''}${caption}`, negative: (cfg && cfg.negative) || '', size: cfg && cfg.size, comfy: { ...COMFY_DEFAULTS, ...conn }, seed });
}














