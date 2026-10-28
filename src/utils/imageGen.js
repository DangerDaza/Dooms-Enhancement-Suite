/**
 * Image Generation (docs/image-gen-plan.md): one source for every picture
 * DES makes, chosen on Settings → Image Generation, and the rules that
 * decide when a portrait is made. Pure: no SillyTavern, no DOM.
 *
 *   - IMAGE_SOURCES: SillyTavern's own Image Generation extension (its /sd
 *     command, whatever that is set to) or ComfyUI reached directly through
 *     SillyTavern's ComfyUI endpoints with a workflow from its store.
 *   - imageGenConfig(settings): settings.imageGen with defaults filled in.
 *   - migrateImageGenSettings(settings): fills settings.imageGen once from
 *     the keys it replaces (Auto Avatars, Portrait Source + Auto Portrait
 *     Mode, the scene pictures' ComfyUI connection). Additive: the old keys
 *     stay until nothing reads them.
 *   - portraitPlan(cfg, entries, facts, when): which present characters get
 *     a portrait now, by the portrait mode. Never during a recovery.
 *   - renderValues(req): what fills a ComfyUI workflow's placeholders for
 *     one picture, whatever its purpose.
 */

export const IMAGE_SOURCES = Object.freeze([
    { id: 'sillytavern', label: "SillyTavern's Image Generation", hint: 'The /sd command: whatever Extensions → Image Generation is set to. Size and sampler follow its settings.' },
    { id: 'comfy', label: 'ComfyUI (direct)', hint: "A ComfyUI card reached through SillyTavern's server, with a workflow from SillyTavern's store: DES fills its placeholders and splices this chat's LoRAs." },
]);

export const SIZE_PRESETS = Object.freeze([
    { id: 'portrait', label: 'Portrait 864 × 1536', width: 864, height: 1536, frame: 'a tall portrait frame' },
    { id: 'square', label: 'Square 1024 × 1024', width: 1024, height: 1024, frame: 'a square frame' },
    { id: 'landscape', label: 'Landscape 1536 × 864', width: 1536, height: 864, frame: 'a wide landscape frame' },
]);

export const PORTRAIT_MODES = Object.freeze([
    { id: 'off', label: 'Off' },
    { id: 'only_missing', label: 'Only missing' },
    { id: 'state_changed', label: 'State changed' },
    { id: 'every_reply', label: 'Every reply' },
]);

export const COMFY_DEFAULTS = Object.freeze({
    url: 'http://127.0.0.1:8189',
    workflow: '',
    steps: 25,
    cfg: 2.5,
    sampler: 'er_sde',
    scheduler: 'simple',
    model: '',
    clip: '',
    vae: '',
    timeoutSec: 180,
});

export const PORTRAIT_DEFAULTS = Object.freeze({
    mode: 'off',
    size: 'square',
    preamble: '',
    negative: '',
    notify: true,
});

export const PLACE_DEFAULTS = Object.freeze({
    size: 'square',
    preamble: '',
    negative: '',
    auto: false,        // draw a place the first time the story reaches it (docs/map-window-plan.md D83)
});

export const CONFIG_VERSION = 1;

/** A fresh copy of the defaults, for settings files. */
export function defaultImageGenConfig() {
    return { v: CONFIG_VERSION, source: 'sillytavern', comfy: { ...COMFY_DEFAULTS }, portraits: { ...PORTRAIT_DEFAULTS }, places: { ...PLACE_DEFAULTS } };
}

const int = (v, lo, hi, d) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
const num = (v, lo, hi, d) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
const str = (v, d) => (typeof v === 'string' ? v : d);

/** The size preset by id, the first when the id is unknown. */
export function sizeById(id) {
    return SIZE_PRESETS.find(p => p.id === id) || SIZE_PRESETS[0];
}

/** settings.imageGen as every reader should see it: defaults filled in, values clamped. */
export function imageGenConfig(settings) {
    const g = settings && settings.imageGen && typeof settings.imageGen === 'object' ? settings.imageGen : {};
    const c = g.comfy && typeof g.comfy === 'object' ? g.comfy : {};
    const p = g.portraits && typeof g.portraits === 'object' ? g.portraits : {};
    const l = g.places && typeof g.places === 'object' ? g.places : {};
    const url = str(c.url, '').trim().replace(/\/+$/, '');
    return {
        v: int(g.v, 0, 99, 0),
        source: IMAGE_SOURCES.some(s => s.id === g.source) ? g.source : 'sillytavern',
        comfy: {
            url: url || COMFY_DEFAULTS.url,
            workflow: str(c.workflow, '').trim(),
            steps: int(c.steps, 1, 100, COMFY_DEFAULTS.steps),
            cfg: num(c.cfg, 0, 20, COMFY_DEFAULTS.cfg),
            sampler: str(c.sampler, '').trim() || COMFY_DEFAULTS.sampler,
            scheduler: str(c.scheduler, '').trim() || COMFY_DEFAULTS.scheduler,
            model: str(c.model, '').trim(),
            clip: str(c.clip, '').trim(),
            vae: str(c.vae, '').trim(),
            timeoutSec: int(c.timeoutSec, 20, 900, COMFY_DEFAULTS.timeoutSec),
        },
        portraits: {
            mode: PORTRAIT_MODES.some(m => m.id === p.mode) ? p.mode : PORTRAIT_DEFAULTS.mode,
            size: SIZE_PRESETS.some(s => s.id === p.size) ? p.size : PORTRAIT_DEFAULTS.size,
            preamble: str(p.preamble, PORTRAIT_DEFAULTS.preamble),
            negative: str(p.negative, PORTRAIT_DEFAULTS.negative),
            notify: p.notify !== false,
        },
        places: {
            size: SIZE_PRESETS.some(s => s.id === l.size) ? l.size : PLACE_DEFAULTS.size,
            preamble: str(l.preamble, PLACE_DEFAULTS.preamble),
            negative: str(l.negative, PLACE_DEFAULTS.negative),
            auto: l.auto === true,
        },
    };
}

/**
 * Fills settings.imageGen once from the keys it replaces, and says what it
 * read. Runs when imageGen is missing or has no version. The keys it reads
 * stay where they are: their readers go one by one, then the keys.
 *   - the ComfyUI connection from settings.scenePictures (the scene
 *     pictures were the one feature with a connection of its own);
 *   - the source: ComfyUI when scene pictures were on with a workflow,
 *     SillyTavern's otherwise (the only route portraits ever had);
 *   - the portrait mode: Auto Portrait Mode when Per-Character Expressions
 *     ran with Portrait Source "Auto-generated portraits"; else Only
 *     missing when Auto Avatars was on; else Off.
 * @returns {{ changed: boolean, notes: string[] }}
 */
export function migrateImageGenSettings(settings) {
    const notes = [];
    if (!settings || typeof settings !== 'object') return { changed: false, notes };
    // Per-Character Expressions with Portrait Source "Auto-generated
    // portraits" ran the old per-reply generator and no sprite classifier.
    // The source entry is gone: that switch is about sprites alone now, so it
    // goes off for such a setup (the portrait mode is carried below), and the
    // key is rewritten so this runs once. Independent of the block below.
    const wasAutoPortraits = settings.syncExpressionsToPresentCharacters === true && settings.portraitEnhancementMode === 'autoPortraits';
    let flipped = false;
    if (settings.portraitEnhancementMode === 'autoPortraits') {
        if (settings.syncExpressionsToPresentCharacters === true) {
            settings.syncExpressionsToPresentCharacters = false;
            notes.push('Per-Character Expressions switched off: it was set to auto-generated portraits, which the Image Generation page runs now; no sprite classifier was in use');
        }
        settings.portraitEnhancementMode = 'expressions';
        flipped = true;
    }
    const have = settings.imageGen && typeof settings.imageGen === 'object' ? settings.imageGen : null;
    if (have && Number.isFinite(Number(have.v)) && Number(have.v) >= 1) return { changed: flipped, notes };
    const next = defaultImageGenConfig();
    const sp = settings.scenePictures && typeof settings.scenePictures === 'object' ? settings.scenePictures : null;
    if (sp) {
        for (const [from, to] of [['comfyUrl', 'url'], ['workflow', 'workflow'], ['steps', 'steps'], ['cfg', 'cfg'], ['sampler', 'sampler'], ['scheduler', 'scheduler'], ['model', 'model'], ['clip', 'clip'], ['vae', 'vae'], ['timeoutSec', 'timeoutSec']]) {
            if (sp[from] !== undefined && sp[from] !== null && sp[from] !== '') next.comfy[to] = sp[from];
        }
        if (sp.enabled === true && typeof sp.workflow === 'string' && sp.workflow.trim()) {
            next.source = 'comfy';
            notes.push(`source: ComfyUI (direct), from the scene pictures' connection (${next.comfy.url}, "${sp.workflow.trim()}")`);
        }
    }
    if (next.source === 'sillytavern') notes.push("source: SillyTavern's Image Generation");
    const autoMode = settings.autoPortraitMode;
    if (wasAutoPortraits && PORTRAIT_MODES.some(m => m.id === autoMode) && autoMode !== 'off') {
        next.portraits.mode = autoMode;
        notes.push(`portraits: ${autoMode}, from Per-Character Expressions with Auto-generated portraits`);
    } else if (settings.autoGenerateAvatars === true) {
        next.portraits.mode = 'only_missing';
        notes.push('portraits: only missing, from Auto Avatars');
    } else {
        notes.push('portraits: off');
    }
    settings.imageGen = next;
    return { changed: true, notes };
}

/** A stable hash of what a portrait would show, so "State changed" can tell a new look from the same one. */
export function portraitStateHash(entry) {
    const e = entry && typeof entry === 'object' ? entry : { name: String(entry || '') };
    const d = e.details && typeof e.details === 'object' ? e.details : {};
    const parts = [e.name, e.relationship || e.role, d.appearance || e.appearance, d.demeanor || e.demeanor, d.equipment || d.equipement || e.equipment || e.equipement, d.effects || e.effects || e.status, e.emotion || e.mood]
        .map(v => (v === undefined || v === null ? '' : String(v).trim().toLowerCase()));
    const s = parts.join('|');
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return `v1:${h.toString(16)}`;
}

/**
 * Which of the present characters get a portrait now.
 * @param {object} cfg - imageGenConfig(settings)
 * @param {Array<string|{name:string}>} entries - the tracker's present characters
 * @param {object} facts - what is known: existing(name) → url or '', generatedHash(name) → the hash a DES-made portrait was made from or null (a portrait with no hash is the user's: protected), pending(name) → true while one is being made, cardAvatar(name) → true when a SillyTavern card already gives a face
 * @param {{ fresh?: boolean, recovery?: boolean }} when - fresh: a reply just arrived (not a chat load); recovery: the separate request that fetches a skipped block (never a reason to draw)
 * @returns {{ names: string[], hashes: Object<string,string>, reason: string }}
 */
export function portraitPlan(cfg, entries, facts = {}, { fresh = true, recovery = false } = {}) {
    const mode = cfg && cfg.portraits ? cfg.portraits.mode : 'off';
    const none = (reason) => ({ names: [], hashes: {}, reason });
    if (mode === 'off') return none('off');
    if (recovery) return none('recovery');
    if (!fresh) return none('not fresh');
    const existing = typeof facts.existing === 'function' ? facts.existing : () => '';
    const generatedHash = typeof facts.generatedHash === 'function' ? facts.generatedHash : () => null;
    const pending = typeof facts.pending === 'function' ? facts.pending : () => false;
    const cardAvatar = typeof facts.cardAvatar === 'function' ? facts.cardAvatar : () => false;
    const names = [];
    const hashes = {};
    const seen = new Set();
    for (const raw of Array.isArray(entries) ? entries : []) {
        const e = typeof raw === 'string' ? { name: raw } : raw;
        const name = e && e.name ? String(e.name).trim() : '';
        if (!name || name.toLowerCase() === 'unavailable' || seen.has(name)) continue;
        seen.add(name);
        if (pending(name)) continue;
        const url = existing(name) || '';
        const hash = portraitStateHash(e);
        const madeFrom = url ? generatedHash(name) : null;
        if (url && !madeFrom) continue;                 // the user's own portrait: never replaced
        if (!url && cardAvatar(name)) continue;         // a SillyTavern card gives the face
        let eligible = false;
        if (mode === 'only_missing') eligible = !url;
        else if (mode === 'state_changed') eligible = !url || madeFrom !== hash;
        else if (mode === 'every_reply') eligible = true;
        if (!eligible) continue;
        names.push(name);
        hashes[name] = hash;
    }
    return { names, hashes, reason: names.length ? 'due' : 'nothing due' };
}

const PNG_PIXEL = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

/**
 * What fills a ComfyUI workflow's placeholders for one picture, the way
 * SillyTavern's own image extension fills them (%prompt%, %negative_prompt%,
 * %width%, %height%, %steps%, %scale%, %sampler%, %scheduler%, %seed%, and
 * %model% / %clip% / %vae% when the connection names them).
 * @param {{ prompt: string, negative?: string, size?: string, comfy: object, seed?: number }} req
 */
export function renderValues({ prompt = '', negative = '', size = 'square', comfy = COMFY_DEFAULTS, seed = -1 } = {}) {
    const s = sizeById(size);
    const v = {
        prompt: String(prompt || '').trim(),
        negative_prompt: String(negative || ''),
        seed: Number.isInteger(seed) && seed >= 0 ? seed : Math.floor(Math.random() * 2147483647),
        steps: comfy.steps,
        scale: comfy.cfg,
        sampler: comfy.sampler,
        scheduler: comfy.scheduler,
        width: s.width,
        height: s.height,
        denoise: 1,
        clip_skip: 1,
        user_avatar: PNG_PIXEL,
        char_avatar: PNG_PIXEL,
    };
    if (comfy.model) v.model = comfy.model;
    if (comfy.clip) v.clip = comfy.clip;
    if (comfy.vae) v.vae = comfy.vae;
    return v;
}

/** The status line for Settings → Image Generation. */
export function describeSource(cfg, { stAvailable = false, stSourceName = '' } = {}) {
    if (!cfg) return '';
    if (cfg.source === 'comfy') {
        return cfg.comfy.workflow ? `ComfyUI at ${cfg.comfy.url}, workflow "${cfg.comfy.workflow}".` : `ComfyUI at ${cfg.comfy.url}; no workflow chosen yet.`;
    }
    if (!stAvailable) return "SillyTavern's Image Generation is not enabled: Extensions → Image Generation, switch it on and pick a source there.";
    return `SillyTavern's Image Generation${stSourceName ? ` (${stSourceName})` : ''}: its size and sampler settings apply.`;
}

/**
 * A prompt as one line a slash command can carry (the portrait generator's
 * long-standing rule): newlines and pipes become separators (a pipe would
 * end the command), macro braces are defused, quotes become apostrophes,
 * comma runs and spaces collapse.
 */
export function slashSafe(text) {
    return String(text || '')
        .replace(/\s*[\r\n]+\s*/g, ', ')
        .replace(/\|/g, ', ')
        .replace(/\{\{|\}\}/g, ' ')
        .replace(/["“”]/g, '\'')
        .replace(/(?:\s*,\s*)+/g, ', ')
        .replace(/\s+/g, ' ')
        .replace(/^[,\s]+|[,\s]+$/g, '');
}
