/**
 * Live World (docs/live-world-spec.md): the pure parts.
 *
 * A world pack describes a world: its place tree, its plot clocks, its
 * cast and how the narrator is told about it. A chat keeps its own world
 * state: the clocks' values, where each character was last seen, who the
 * player knows of, a movement log, and what the last advance did. The
 * advancer (a background request every N messages) answers with strict
 * JSON that is validated here before anything is written; a reply that
 * fails any rule is discarded whole.
 *
 * No SillyTavern imports: tools/live-world-test.mjs imports this directly.
 * The store, the request, the injection and the slash command live in
 * src/systems/features/liveWorld.js; the dashboard in
 * src/systems/ui/worldDashboard.js.
 */

export const WORLD_SLOT = 'dooms-world-state';
export const LOG_PER_CHARACTER = 20;
export const LOG_TOTAL = 300;
export const COUNTED_KEEP = 400;
export const RUNS_KEEP = 50;        // the run records kept: what a rewind falls back to when the newest run's reply is gone
export const MAX_BLURB = 600;
export const MAX_REASON = 160;
export const MAX_NAME = 60;
export const MAX_PLACE = 80;        // a visited place's label (docs/map-window-plan.md D82)
export const MAX_VISITED = 60;      // places the row keeps, newest first
export const VISITS_KEEP = 30;      // reply ids kept per place, for the rewind
export const TIERS = Object.freeze(['heard', 'known']);
export const BLANK_PACK_ID = 'blank';    // the world that grows from play (docs/world-builder-plan.md D93)

const clean = (v, max = 200) => String(v ?? '').normalize('NFC').replace(/\s+/g, ' ').trim().slice(0, max);
const slug = (v) => clean(v, 60).toLowerCase().replace(/[^\p{L}\p{M}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '');
const isInt = (n) => Number.isInteger(n);
export const sameName = (a, b) => clean(a, MAX_NAME).toLowerCase() === clean(b, MAX_NAME).toLowerCase();

/** The id of a place the story names that no pack place matches (D93): "loc:" and a slug of the text, the key the Map window's row uses (D82); '' for nothing. */
export function locPlaceId(text) {
    const id = clean(text, MAX_PLACE).toLowerCase().replace(/[^\p{L}\p{M}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '');
    return id ? `loc:${id}` : '';
}
export const isLocId = (id) => typeof id === 'string' && id.startsWith('loc:');
/** A loc: id read back as words: "loc:the-quay" → "the quay". */
export function locLabel(id) {
    return isLocId(id) ? clean(id.slice(4).replace(/-+/g, ' '), MAX_PLACE) : '';
}

/** The spelling the state already uses for a name (case apart), else the name cleaned: one character, one key. */
export function canonicalName(state, raw) {
    const n = clean(raw, MAX_NAME);
    if (!n || !state) return n;
    for (const k of Object.keys(state.known || {})) if (sameName(k, n)) return k;
    for (const k of Object.keys(state.where || {})) if (sameName(k, n)) return k;
    return n;
}

/** A clock's value as the pack allows it: a stored value outside the range (the pack's max shrank) is clamped. */
function clockValue(state, c) {
    const v = isInt(state.clocks[c.id]) ? state.clocks[c.id] : c.start;
    return Math.min(c.max, Math.max(0, v));
}

/** The end of the JSON object or array that opens at `start`, strings respected; -1 when it never closes. */
function balancedEnd(text, start) {
    let depth = 0;
    let inString = false;
    for (let i = start; i < text.length; i++) {
        const ch = text[i];
        if (inString) {
            if (ch === '\\') i++;
            else if (ch === '"') inString = false;
            continue;
        }
        if (ch === '"') inString = true;
        else if (ch === '{' || ch === '[') depth++;
        else if (ch === '}' || ch === ']') {
            depth--;
            if (depth === 0) return i;
        }
    }
    return -1;
}

const THINK_RE = /<(think|thinking|reasoning|reflection)>[\s\S]*?<\/\1>/gi;
const THINK_OPEN_RE = /<(?:think|thinking|reasoning|reflection)>[\s\S]*$/i;
const TRACKERS_RE = /<trackers>[\s\S]*?<\/trackers>/gi;

/**
 * A message's prose without what the model wrote for machines: reasoning
 * blocks, the tracker's <trackers> block, code fences, bare JSON objects
 * (the tracker block of together mode) and DES's own tags.
 */
export function stripSceneNoise(text) {
    let t = String(text || '').replace(THINK_RE, '').replace(THINK_OPEN_RE, '').replace(TRACKERS_RE, '').replace(/```[\s\S]*?```/g, '').replace(/```[\s\S]*$/g, '');
    let from = 0;
    let guard = 0;
    while (guard++ < 400) {
        const i = t.indexOf('{', from);
        if (i < 0) break;
        const end = balancedEnd(t, i);
        if (end < 0) { from = i + 1; continue; }    // a brace in prose that never closes: try the next one
        const slice = t.slice(i, end + 1);
        let isJson = false;
        try { const v = JSON.parse(slice); isJson = !!v && typeof v === 'object'; } catch (e) { isJson = false; }
        if (isJson) t = t.slice(0, i) + t.slice(end + 1);
        else from = i + 1;
    }
    return t.replace(/\[\s*(?:ITEMS?|CHECK|SAVE)\s*:[^\]]*\]/gi, '').replace(/\s+/g, ' ').trim();
}

// ─── The rules ──────────────────────────────────────────────────────────────

const CONFIG_DEFAULTS = Object.freeze({
    enabled: false,
    pack: 'blank',             // the world a new chat is seeded with: the blank one grows from play (D93)
    every: 6,                  // the advancer runs every N new replies
    maxStep: 1,                // a clock moves by at most this per run (a clock's own step wins)
    spoilerFree: false,        // the blurb is street-level common knowledge only
    inject: true,              // the world lines ride every generation
    depth: 2,                  // where they ride
    role: 'system',
    recentMessages: 12,        // the chat window the advancer reads
    debug: false,              // console lines as well as the System Log
});

/** A fresh copy of the defaults, for settings files. */
export function defaultLiveWorldConfig() {
    return { ...CONFIG_DEFAULTS, customPacks: {} };
}

/** The rules block as every reader should see it: settings.liveWorld with defaults filled in. */
export function liveWorldConfig(settings) {
    const c = settings && settings.liveWorld && typeof settings.liveWorld === 'object' ? settings.liveWorld : {};
    const int = (v, lo, hi, d) => {
        const n = Math.round(Number(v));
        return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
    };
    return {
        enabled: c.enabled === true,
        pack: typeof c.pack === 'string' && c.pack.trim() ? c.pack.trim() : CONFIG_DEFAULTS.pack,
        every: int(c.every, 1, 50, CONFIG_DEFAULTS.every),
        maxStep: int(c.maxStep, 1, 6, CONFIG_DEFAULTS.maxStep),
        spoilerFree: c.spoilerFree === true,
        inject: c.inject !== false,
        depth: int(c.depth, 0, 20, CONFIG_DEFAULTS.depth),
        role: c.role === 'user' || c.role === 'assistant' ? c.role : 'system',
        recentMessages: int(c.recentMessages, 2, 40, CONFIG_DEFAULTS.recentMessages),
        debug: c.debug === true,
        customPacks: c.customPacks && typeof c.customPacks === 'object' && !Array.isArray(c.customPacks) ? c.customPacks : {},
    };
}

/**
 * The recent scenes as the advancer reads them: the last N messages that
 * are not system notes, "Name: text", each cut to length, tracker blocks
 * and code fences left out.
 */
export function buildRecentText(chat, { count = 12, truncation = 700, persona = 'Player' } = {}) {
    const list = Array.isArray(chat) ? chat : [];
    const out = [];
    for (let i = list.length - 1; i >= 0 && out.length < count; i--) {
        const m = list[i];
        if (!m || typeof m !== 'object' || m.is_system || Array.isArray(m.extra && m.extra.tool_invocations)) continue;
        if (typeof m.mes !== 'string') continue;
        let text = stripSceneNoise(m.mes);
        if (!text) continue;
        if (text.length > truncation) text = `${text.slice(0, truncation - 1).trimEnd()}…`;
        const who = m.is_user ? (m.name || persona) : (m.name || 'Narrator');
        out.unshift(`${who}: ${text}`);
    }
    return out.join('\n');
}

// ─── The pack ───────────────────────────────────────────────────────────────

/**
 * A pack made safe, with what is wrong about it listed. A pack with errors
 * is still returned (the dashboard can show what to fix) but must not be
 * played: check `ok`.
 * @returns {{ ok: boolean, pack: object, errors: string[] }}
 */
export function normalizePack(raw) {
    const errors = [];
    const r = raw && typeof raw === 'object' ? raw : {};
    const id = slug(r.id || r.name);
    if (!id) errors.push('The pack needs an id or a name.');
    const name = clean(r.name || r.id, 80) || 'World';
    const places = [];
    const seen = new Set();
    for (const p of Array.isArray(r.places) ? r.places : []) {
        if (!p || typeof p !== 'object') continue;
        const pid = slug(p.id || p.label);
        if (!pid) { errors.push('A place has no id.'); continue; }
        if (seen.has(pid)) { errors.push(`The place id "${pid}" is used twice.`); continue; }
        seen.add(pid);
        places.push({
            id: pid,
            label: clean(p.label || p.id, 80),
            parent: p.parent ? slug(p.parent) : null,
            image: typeof p.image === 'string' ? p.image.trim() : '',
            zoom: isInt(p.zoom) ? p.zoom : null,
            x: Number.isFinite(p.x) ? p.x : null,
            y: Number.isFinite(p.y) ? p.y : null,
        });
    }
    for (const p of places) {
        if (p.parent && !seen.has(p.parent)) { errors.push(`The place "${p.id}" names a parent "${p.parent}" that does not exist.`); p.parent = null; }
    }
    // Cycles: walk up from each place; a path longer than the tree is a loop.
    const byId = new Map(places.map(p => [p.id, p]));
    for (const p of places) {
        let cur = p; let guard = 0;
        while (cur && cur.parent && guard++ <= places.length) cur = byId.get(cur.parent);
        if (guard > places.length) { errors.push(`The place "${p.id}" sits in a loop of parents.`); p.parent = null; }
    }
    const clocks = [];
    const clockIds = new Set();
    for (const c of Array.isArray(r.clocks) ? r.clocks : []) {
        if (!c || typeof c !== 'object') continue;
        const cid = clean(c.id || c.label, 60).toLowerCase().replace(/[^\p{L}\p{M}\p{N}]+/gu, '_').replace(/^_+|_+$/g, '');
        if (!cid) { errors.push('A clock has no id.'); continue; }
        if (clockIds.has(cid)) { errors.push(`The clock id "${cid}" is used twice.`); continue; }
        clockIds.add(cid);
        let max = 6;
        if (c.max === undefined) { /* the default */ }
        else if (isInt(c.max) && c.max > 0) max = c.max;
        else errors.push(`The clock "${cid}" has a max of ${JSON.stringify(c.max)}; it needs a whole number above 0.`);
        let start = isInt(c.start) ? c.start : 0;
        if (start < 0 || start > max) { errors.push(`The clock "${cid}" starts at ${start}, outside 0..${max}.`); start = Math.min(max, Math.max(0, start)); }
        const effects = {};
        if (c.effects && typeof c.effects === 'object') {
            for (const [k, v] of Object.entries(c.effects)) {
                if (!/^\d+$/.test(String(k).trim())) continue;
                const n = Number(k);
                if (!(isInt(n) && n >= 0 && n <= max && typeof v === 'string' && v.trim())) continue;
                if (n in effects) { errors.push(`The clock "${cid}" gives step ${n} twice.`); continue; }
                effects[n] = clean(v, 240);
            }
        }
        // The place the clock concerns (optional): the board shows its public effect on that place's tile.
        const cplace = c.place ? resolvePlaceIn(places, c.place) : '';
        if (c.place && !cplace) errors.push(`The clock "${cid}" names a place "${c.place}" that does not exist.`);
        clocks.push({ id: cid, label: clean(c.label || c.id, 80), start, max, step: isInt(c.step) && c.step > 0 ? c.step : null, effects, hidden: c.hidden === true, place: cplace });
    }
    const cast = [];
    const castNames = new Set();
    for (const m of Array.isArray(r.cast) ? r.cast : []) {
        if (!m || typeof m !== 'object') continue;
        const mname = clean(m.name, MAX_NAME);
        if (!mname) continue;
        if (castNames.has(mname.toLowerCase())) { errors.push(`The cast names "${mname}" twice.`); continue; }
        castNames.add(mname.toLowerCase());
        const place = m.place ? resolvePlaceIn(places, m.place) : '';
        if (m.place && !place) errors.push(`The cast member "${mname}" starts at "${m.place}", which is not a place.`);
        cast.push({ name: mname, place, tier: m.tier === 'known' ? 'known' : (m.tier === 'heard' ? 'heard' : (place ? 'known' : 'heard')), portrait: typeof m.portrait === 'string' ? m.portrait.trim() : '' });
    }
    const pack = {
        id, name, version: isInt(r.version) ? r.version : 1,
        description: clean(r.description, 400),
        places, clocks, cast,
        template: typeof r.template === 'string' && r.template.trim() ? r.template.trim() : '',
        blurb: clean(r.blurb, MAX_BLURB),
    };
    return { ok: errors.length === 0, pack, errors };
}

/** The blank world (D93): no places, clocks or cast; the story fills it. The name is the chat's. */
export function blankPack(name = 'The world') {
    return normalizePack({ id: BLANK_PACK_ID, name: clean(name, 80) || 'The world', version: 1 }).pack;
}

function resolvePlaceIn(places, ref) {
    const s = String(ref ?? '').trim();
    if (!s) return '';
    const last = s.includes('/') ? s.split('/').filter(Boolean).pop() : s;
    const id = slug(last);
    if (places.some(p => p.id === id)) return id;
    const byLabel = places.find(p => p.label.toLowerCase() === s.toLowerCase() || p.label.toLowerCase() === String(last).toLowerCase());
    return byLabel ? byLabel.id : '';
}

/** A place id from an id, a path ("a/b/c") or a label; '' when none matches. */
export function resolvePlace(pack, ref) {
    return resolvePlaceIn(pack?.places || [], ref);
}

/** The place and its ancestors, root first. */
export function placeChain(pack, id) {
    const byId = new Map((pack?.places || []).map(p => [p.id, p]));
    const chain = [];
    let cur = byId.get(id);
    let guard = 0;
    while (cur && guard++ < 64) { chain.unshift(cur); cur = cur.parent ? byId.get(cur.parent) : null; }
    return chain;
}

/** "gilead/low-market/gilded-hand/high-table" for a place id; '' when unknown. */
export function placePath(pack, id) {
    return placeChain(pack, id).map(p => p.id).join('/');
}

/** The deepest two labels, "the high table, the Gilded Hand"; the full chain when `full`. */
export function placeLabel(pack, idOrPath, { full = false } = {}) {
    const id = resolvePlace(pack, idOrPath);
    const chain = placeChain(pack, id);
    if (!chain.length) return isLocId(idOrPath) ? locLabel(idOrPath) : clean(idOrPath, 80);
    const labels = chain.map(p => p.label).reverse();
    return (full ? labels : labels.slice(0, 2)).join(', ');
}

/** The tree as indented lines, for the advancer: ids with labels. */
export function placeTreeText(pack) {
    const places = pack?.places || [];
    const children = (pid) => places.filter(p => (p.parent || null) === pid);
    const lines = [];
    const walk = (pid, depth) => {
        for (const p of children(pid)) {
            lines.push(`${'  '.repeat(depth)}${p.id} (${p.label})`);
            if (depth < 12) walk(p.id, depth + 1);
        }
    };
    walk(null, 0);
    return lines.join('\n');
}

// ─── The state ──────────────────────────────────────────────────────────────

/** Empty state for a pack id. */
export function emptyWorldState(packId = '') {
    return { v: 1, pack: packId, name: '', packVersion: 0, clocks: {}, where: {}, known: {}, log: [], runs: [], trimmed: false, last: null, lastError: null, blurb: '', counted: [], sinceLast: 0, retryNext: false, seeded: false, visited: [] };
}

/**
 * The places the story has visited, newest first (docs/map-window-plan.md
 * D82), made safe: one entry per id, the labels and dates trimmed, the
 * reply ids of the last visits kept for the rewind, the drawn picture's
 * URL and the description it was drawn from.
 */
export function normalizeVisited(raw) {
    const out = [];
    const seen = new Set();
    for (const e of Array.isArray(raw) ? raw : []) {
        if (!e || typeof e !== 'object') continue;
        const id = clean(e.id, 120);
        if (!id || seen.has(id)) continue;
        seen.add(id);
        out.push({
            id,
            label: clean(e.label, MAX_PLACE) || id,
            packId: clean(e.packId, 60),
            path: clean(e.path, 400),
            visits: (Array.isArray(e.visits) ? e.visits : []).filter(x => (typeof x === 'string' && x) || isInt(x)).slice(-VISITS_KEEP),
            firstDate: clean(e.firstDate, 80),
            lastDate: clean(e.lastDate, 80),
            lastTime: clean(e.lastTime, 80),
            image: typeof e.image === 'string' ? e.image.trim().slice(0, 2000) : '',
            prompt: clean(e.prompt, 2000),
            drawnAt: isInt(e.drawnAt) ? e.drawnAt : 0,
        });
        if (out.length >= MAX_VISITED) break;
    }
    return out;
}

/** A new chat's state from the pack: starting clocks, starting places, the cast's tiers. */
export function seedWorldState(pack, { name = '' } = {}) {
    const s = emptyWorldState(pack.id);
    s.packVersion = pack.version || 1;
    s.name = clean(name, 80);    // the blank world's own name (D93); '' for a world named by its pack
    for (const c of pack.clocks) s.clocks[c.id] = c.start;
    for (const m of pack.cast) {
        s.known[m.name] = m.tier;
        if (m.place) s.where[m.name] = placePath(pack, m.place);
    }
    s.blurb = pack.blurb || '';
    s.seeded = true;
    return s;
}

/** A stored state made safe. */
export function normalizeWorldState(raw) {
    const r = raw && typeof raw === 'object' ? raw : {};
    const s = emptyWorldState(clean(r.pack, 60));
    s.packVersion = isInt(r.packVersion) ? r.packVersion : 0;
    s.name = clean(r.name, 80);
    if (r.clocks && typeof r.clocks === 'object') for (const [k, v] of Object.entries(r.clocks)) if (isInt(v)) s.clocks[k] = v;
    // One spelling per name (NFC, case apart): a state saved before the fold may hold twins; 'known' beats 'heard', and the log follows the surviving spelling.
    const spelling = {};
    const fold = (raw) => { const n = clean(raw, MAX_NAME); if (!n) return ''; const key = n.toLowerCase(); if (!spelling[key]) spelling[key] = n; return spelling[key]; };
    if (r.known && typeof r.known === 'object') for (const [k, v] of Object.entries(r.known)) { if (!TIERS.includes(v)) continue; const n = fold(k); if (n && s.known[n] !== 'known') s.known[n] = v; }
    if (r.where && typeof r.where === 'object') for (const [k, v] of Object.entries(r.where)) { if (typeof v !== 'string' || !v) continue; const n = fold(k); if (n) s.where[n] = v; }
    s.log = (Array.isArray(r.log) ? r.log : []).filter(e => e && typeof e === 'object' && (e.who || (e.kind === 'clock' && e.clock))).slice(-LOG_TOTAL).map(e => (typeof e.who === 'string' ? { ...e, who: fold(e.who) || e.who } : e));
    s.runs = (Array.isArray(r.runs) ? r.runs : []).filter(x => x && typeof x === 'object').slice(-RUNS_KEEP).map(x => ({ msgId: typeof x.msgId === 'string' ? x.msgId : null, gameDate: clean(x.gameDate, 80), gameTime: clean(x.gameTime, 80), ranAt: isInt(x.ranAt) ? x.ranAt : 0, elapsed: clean(x.elapsed, 120), blurb: clean(x.blurb, MAX_BLURB) }));
    // Whether the ring has dropped entries (a rewind that empties the log then cannot vouch for the values before it); a state saved before the flag counts a full ring as trimmed.
    const perWho = {};
    let fullest = 0;
    for (const e of s.log) if (e.who) { perWho[e.who] = (perWho[e.who] || 0) + 1; if (perWho[e.who] > fullest) fullest = perWho[e.who]; }
    s.trimmed = r.trimmed === true || (r.trimmed === undefined && (s.log.length >= LOG_TOTAL || fullest >= LOG_PER_CHARACTER));
    s.last = r.last && typeof r.last === 'object' ? { ...r.last } : null;
    s.lastError = r.lastError && typeof r.lastError === 'object' ? { ...r.lastError } : null;
    s.blurb = clean(r.blurb, MAX_BLURB);
    s.counted = (Array.isArray(r.counted) ? r.counted : []).filter(x => typeof x === 'string' || isInt(x)).slice(-COUNTED_KEEP);
    s.sinceLast = isInt(r.sinceLast) && r.sinceLast >= 0 ? r.sinceLast : 0;
    s.retryNext = r.retryNext === true;
    s.seeded = r.seeded === true;
    s.visited = normalizeVisited(r.visited);
    return s;
}

function cloneState(s) {
    return JSON.parse(JSON.stringify(s));
}

/**
 * Counts a message once (G3). A swipe or a regenerate reuses the message's
 * id and is not counted again.
 * @returns {{ state: object, counted: boolean }}
 */
export function countMessage(state, id) {
    if (id === undefined || id === null || id === '') return { state, counted: false };
    if (state.counted.includes(id)) return { state, counted: false };
    const next = cloneState(state);
    next.counted.push(id);
    if (next.counted.length > COUNTED_KEEP) next.counted.splice(0, next.counted.length - COUNTED_KEEP);
    next.sinceLast += 1;
    return { state: next, counted: true };
}

/** Whether an advance is due: every N counted messages, or at once after a failed run. */
export function advanceDue(state, every) {
    const n = isInt(every) && every > 0 ? every : 6;
    return state.retryNext || state.sinceLast >= n;
}

/** Names from the chat the player now knows of; a known name never drops back. */
export function markHeard(state, names) {
    const next = cloneState(state);
    for (const raw of names || []) {
        const n = canonicalName(next, raw);
        if (n && !next.known[n]) next.known[n] = 'heard';
    }
    return next;
}

/**
 * The pack place a scene's location text names, or '' (D70). The tracker
 * writes the place as prose ("The Gilded Hand's archive, Gilead"); the
 * deepest place whose label, or its label without a leading "the", stands
 * in the text as whole words wins, so "the Gilded Hand, Gilead" is the
 * Gilded Hand and not the city. Labels under three letters never match.
 */
export function placeFromText(pack, text) {
    const t = ` ${String(text || '').normalize('NFC').toLowerCase().replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ')} `;
    if (t.trim().length < 3) return '';
    let best = null;
    let bestDepth = -1;
    let bestLen = 0;
    for (const p of (pack && pack.places) || []) {
        const labels = [p.label || '', p.id.replace(/-/g, ' ')].map(l => l.normalize('NFC').toLowerCase().replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ').trim()).filter(Boolean);
        for (const l of labels.slice()) if (/^the /.test(l) && l.length > 7) labels.push(l.slice(4));
        for (const l of labels) {
            if (l.length < 3 || !t.includes(` ${l} `)) continue;
            const depth = placeChain(pack, p.id).length;
            if (depth > bestDepth || (depth === bestDepth && l.length > bestLen)) { best = p.id; bestDepth = depth; bestLen = l.length; }
        }
    }
    return best || '';
}

/**
 * What the scene itself shows (D70): the characters in it are known, and
 * when the scene's location names a pack place they are there, logged as
 * a move "in the scene" when the place changed. Never mutates the input;
 * hands the same state back when nothing changed.
 * @returns {{ state: object, placed: number, named: number }}
 */
export function seenInScene(state, pack, { names = [], place = '', msgId = null, gameDate = '', gameTime = '' } = {}) {
    const next = cloneState(state);
    let changed = false;
    let placed = 0;
    let named = 0;
    // A world with places of its own places people at those; elsewhere they are "in the scene" (D70). The blank
    // world, with no places of its own, places them at the story's place under the row's key (D93).
    const to = place ? (placePath(pack, resolvePlace(pack, place)) || (!(pack && Array.isArray(pack.places) && pack.places.length) ? locPlaceId(place) : '')) : '';
    for (const raw of names || []) {
        const who = canonicalName(next, raw);
        if (!who) continue;
        if (next.known[who] !== 'known') { next.known[who] = 'known'; named++; changed = true; }
        if (!to) continue;
        const from = next.where[who] || '';
        if (from === to) continue;
        next.where[who] = to;
        next.log.push({ kind: 'move', who, from, to, msgId, gameDate, gameTime, reason: 'in the scene' });
        const mine = next.log.filter(e => e.who === who);
        if (mine.length > LOG_PER_CHARACTER) {
            const oldest = mine[0];
            next.log.splice(next.log.indexOf(oldest), 1);
            next.trimmed = true;
        }
        placed++;
        changed = true;
    }
    if (next.log.length > LOG_TOTAL) { next.log.splice(0, next.log.length - LOG_TOTAL); next.trimmed = true; }
    return { state: changed ? next : state, placed, named };
}

/** Names actually present or speaking: known. */
export function markKnown(state, names) {
    const next = cloneState(state);
    for (const raw of names || []) {
        const n = canonicalName(next, raw);
        if (n) next.known[n] = 'known';
    }
    return next;
}

/** Stored clocks brought into the pack's range (a pack whose max shrank, a clock the pack added). */
export function clampClocksToPack(state, pack) {
    let next = state;
    let changed = false;
    for (const c of (pack && pack.clocks) || []) {
        const v = clockValue(state, c);
        if (state.clocks[c.id] === v) continue;
        if (!changed) { next = cloneState(state); changed = true; }
        next.clocks[c.id] = v;
    }
    return { state: next, changed };
}

/** A counted reply that turned out not to exist (a regenerate that never produced one): its count withdrawn. */
export function uncountMessage(state, id) {
    if (!id || !state.counted.includes(id)) return { state, uncounted: false };
    const next = cloneState(state);
    const pos = next.counted.indexOf(id);
    // `counted` is appended in chat order and a run resets the count, so the last `sinceLast` ids are the ones since the run.
    const boundary = Math.max(0, next.counted.length - next.sinceLast);
    next.counted.splice(pos, 1);
    if (pos >= boundary && next.sinceLast > 0) next.sinceLast -= 1;
    return { state: next, uncounted: true };
}

// ─── The lines the narrator reads ───────────────────────────────────────────

function clockLine(pack, state, c) {
    const v = clockValue(state, c);
    const effect = c.effects[v] ? `: ${c.effects[v]}` : '';
    return `${c.label} ${v}/${c.max}${effect}`;
}

/**
 * The fixed-size injection (G4): one short line per clock, one per known
 * character; overwritten every turn, never appended. Heard-of names, the
 * log and the blurb never ride.
 */
export function buildWorldLines(state, pack, { maxChars = 1200 } = {}) {
    if (!pack || !state) return '';
    const clocks = pack.clocks.filter(c => !c.hidden).map(c => clockLine(pack, state, c));
    const where = Object.entries(state.where)
        .filter(([name]) => state.known[name] === 'known')
        .map(([name, path]) => `${name}: ${placeLabel(pack, path)}${lastSeenDate(state, name)}`);
    const clocksText = clocks.join('; ');
    const whereText = where.join('; ');
    let text;
    if (pack.template && (pack.template.includes('{clocks}') || pack.template.includes('{where}'))) {
        const fill = { name: pack.name, clocks: clocksText || 'none', where: whereText || 'no one placed yet' };
        text = pack.template.replace(/\{(name|clocks|where)\}/g, (_, k) => fill[k]);
    } else {
        text = `[WORLD OF ${pack.name.toUpperCase()}: clocks: ${clocksText || 'none'}. Last seen: ${whereText || 'no one placed yet'}. The world moves between scenes; these are its facts as they stand, not instructions to the scene.]`;
    }
    if (text.length > maxChars) text = `${text.slice(0, maxChars - 2).trimEnd()}…]`;
    return text;
}

function lastSeenDate(state, name) {
    for (let i = state.log.length - 1; i >= 0; i--) {
        const e = state.log[i];
        if (e.who === name && e.gameDate) return ` (${e.gameDate})`;
    }
    return '';
}

// ─── The advancer ───────────────────────────────────────────────────────────

/**
 * The advancer's prompt: the clocks and what each step means, the place
 * tree, who is where, the time that passed since the last run, the recent
 * chat, and the exact JSON asked for. Spoiler-free clamps the blurb to
 * street-level common knowledge.
 * @returns {{ system: string, user: string }}
 */
export function buildAdvancePrompt({ pack, state, recent = '', now = {}, maxStep = 1, spoilerFree = false, player = '' } = {}) {
    const players = playerList(player);
    const clocks = pack.clocks.map(c => {
        const v = clockValue(state, c);
        const steps = Object.entries(c.effects).map(([k, t]) => `${k}: ${t}`).join(' | ');
        return `- ${c.id} ("${c.label}"): now ${v} of ${c.max}, may move by at most ${c.step || maxStep} this run${steps ? `. Steps: ${steps}` : ''}`;
    }).join('\n');
    const where = Object.entries(state.where).map(([n, p]) => `- ${n} (${state.known[n] || 'heard'}): ${p}`).join('\n') || '- no one placed yet';
    const last = state.last ? `${state.last.gameDate || 'unknown date'}${state.last.gameTime ? `, ${state.last.gameTime}` : ''}` : 'the story\'s start';
    const nowText = `${now.date || 'unknown date'}${now.time ? `, ${now.time}` : ''}${now.location ? `, at ${now.location}` : ''}`;
    const system = `You are the clockwork of the world of ${pack.name}, running between scenes. You never write story. You read the recent scenes and the time that passed, and you answer with one JSON object and nothing else, in exactly this shape:
{"elapsed": "<how much story time passed since the last run, in words>", "clocks": {"<clock id>": <new integer value>}, "moved": [{"who": "<character name>", "to": "<place id from the places list>", "reason": "<a few words>"}], "blurb": "<two or three sentences of what people in the streets would say is going on>", "heard": ["<names of people mentioned for the first time>"]}
Rules: clocks move with story time, not with how many messages were exchanged; a clock may move by at most the step given, up or down, and stays within its range; include a clock only when it moves; "to" must be a place id from the tree, the deepest that fits; move a character only when the scenes showed or plainly implied it; "moved" may be empty; names are strings exactly as the story spells them; no prose outside the JSON.${players.length ? ` The player is ${players[0]}${players.length > 1 ? ` (also written ${players.slice(1).join(', ')})` : ''}: never move them and never list them as heard of; the places are for everyone else.` : ''}${spoilerFree ? ' The blurb is common knowledge only: rumours, prices, news, weather; never a clock\'s value, name or mechanism, and nothing the player has not had a chance to learn.' : ''}`;
    const user = `World: ${pack.name}${pack.description ? ` — ${pack.description}` : ''}

Clocks:
${clocks || '- none'}

Places (id (label), nested; then the places the story itself has named):
${advancerPlaces(pack, state)}

Last seen:
${where}

Last run: ${last}. Now: ${nowText}.${players.length ? `\nThe player: ${players.join(' / ')} (not part of the cast).` : ''}

Recent scenes:
${recent || '(none)'}

Answer with the JSON object only.`;
    return { system, user };
}

/** The places the advancer may move people to: the pack's tree, then the places the story named that the pack does not (the row's loc: ids, D93). */
function advancerPlaces(pack, state) {
    const lines = [placeTreeText(pack)];
    for (const e of (state && Array.isArray(state.visited) ? state.visited : []).slice(0, 40)) {
        if (!e || !isLocId(e.id)) continue;
        lines.push(`${e.id} (${e.label || locLabel(e.id)})`);
    }
    return lines.filter(Boolean).join('\n') || '- none yet: move no one until the story names a place';
}

/** A visited place (the row, D82) by its loc: id, its label or the text that would key it; '' when none. */
export function resolveVisited(state, ref) {
    const s = clean(ref, MAX_PLACE);
    if (!s) return '';
    const lower = s.toLowerCase();
    const key = locPlaceId(s);
    for (const e of (state && Array.isArray(state.visited) ? state.visited : [])) {
        if (!e || !isLocId(e.id)) continue;
        if (e.id === s || e.id === key || String(e.label || '').toLowerCase() === lower || locLabel(e.id) === lower) return e.id;
    }
    return '';
}

/** The player's names as given: one string or a list, cleaned, empty entries dropped. */
function playerList(player) {
    return (Array.isArray(player) ? player : [player]).map(p => clean(p, MAX_NAME)).filter(Boolean);
}

/** The first JSON object in a reply, fences and prose around it ignored; null when none parses. */
export function parseAdvanceReply(text) {
    // Only an object shaped like an advance counts: a reply cut off mid-object must not pass as its inner clocks map.
    return jsonObjectsIn(text).find(v => ADVANCE_KEYS.some(k => k in v)) || null;
}

/** Every JSON object a reply holds (fenced, bare, or the whole text), reasoning stripped, outer objects before inner; [] when none parses. */
export function jsonObjectsIn(text) {
    const s = String(text || '').replace(THINK_RE, '').replace(THINK_OPEN_RE, '').trim();
    if (!s) return [];
    const candidates = [];
    for (const m of s.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)) candidates.push(m[1]);
    let from = 0;
    let guard = 0;
    while (guard++ < 400) {
        const i = s.indexOf('{', from);
        if (i < 0) break;
        const end = balancedEnd(s, i);
        if (end >= 0) candidates.push(s.slice(i, end + 1));
        from = i + 1;
    }
    candidates.push(s);
    const parsed = [];
    for (const c of candidates) {
        try {
            const v = JSON.parse(c);
            if (v && typeof v === 'object' && !Array.isArray(v)) parsed.push(v);
        } catch (e) { /* next */ }
    }
    return parsed;
}

const ADVANCE_KEYS = ['elapsed', 'clocks', 'moved', 'blurb', 'heard'];

/**
 * The advancer's reply checked against the pack and the state. Every rule
 * must hold or the reply is discarded whole (the caller sets retryNext).
 * @returns {{ ok: boolean, errors: string[], clean: object|null }}
 */
export function validateAdvance(reply, pack, state, { maxStep = 1, player = '' } = {}) {
    const errors = [];
    const players = playerList(player);
    const isPlayer = (n) => players.some(p => sameName(p, n));
    if (!reply || typeof reply !== 'object' || Array.isArray(reply)) return { ok: false, errors: ['The reply is not a JSON object.'], clean: null };
    if (!ADVANCE_KEYS.some(k => k in reply)) return { ok: false, errors: ['The reply carries none of the fields asked for (elapsed, clocks, moved, blurb, heard).'], clean: null };
    const clocks = {};
    if (reply.clocks !== undefined) {
        if (!reply.clocks || typeof reply.clocks !== 'object' || Array.isArray(reply.clocks)) errors.push('"clocks" is not an object.');
        else {
            for (const [id, v] of Object.entries(reply.clocks)) {
                const def = pack.clocks.find(c => c.id === id);
                if (!def) { errors.push(`"${id}" is not a clock of this pack.`); continue; }
                const n = typeof v === 'string' && /^-?\d+$/.test(v.trim()) ? Number(v) : v;
                if (!isInt(n)) { errors.push(`The clock "${id}" is not an integer.`); continue; }
                if (n < 0 || n > def.max) { errors.push(`The clock "${id}" is ${n}, outside 0..${def.max}.`); continue; }
                const cur = clockValue(state, def);
                const step = def.step || maxStep;
                if (Math.abs(n - cur) > step) { errors.push(`The clock "${id}" moved by ${Math.abs(n - cur)}, more than ${step}.`); continue; }
                if (n !== cur) clocks[id] = n;
            }
        }
    }
    const moved = [];
    if (reply.moved !== undefined) {
        if (!Array.isArray(reply.moved)) errors.push('"moved" is not a list.');
        else {
            for (const m of reply.moved) {
                if (!m || typeof m !== 'object') { errors.push('A move is not an object.'); continue; }
                if (typeof m.who !== 'string') { errors.push("A move's who is not a string."); continue; }
                const who = canonicalName(state, m.who);
                if (!who) { errors.push('A move names nobody.'); continue; }
                if (isPlayer(who)) continue;    // the player is not placed by the world
                if (typeof m.to !== 'string') { errors.push(`A move's place is not a string (for ${who}).`); continue; }
                const to = resolvePlace(pack, m.to) || resolveVisited(state, m.to);    // the pack's places, then the story's own (D93)
                if (!to) { errors.push(`"${clean(m.to, 60)}" is not a place of this pack (for ${who}).`); continue; }
                moved.push({ who, to, reason: typeof m.reason === 'string' ? clean(m.reason, MAX_REASON) : '' });
            }
        }
    }
    const heard = [];
    if (reply.heard !== undefined) {
        if (!Array.isArray(reply.heard)) errors.push('"heard" is not a list.');
        else for (const h of reply.heard) { if (typeof h !== 'string') { errors.push('A heard-of name is not a string.'); continue; } const n = canonicalName(state, h); if (n && !isPlayer(n)) heard.push(n); }
    }
    if (reply.blurb !== undefined && typeof reply.blurb !== 'string') errors.push('"blurb" is not a string.');
    if (reply.elapsed !== undefined && typeof reply.elapsed !== 'string') errors.push('"elapsed" is not a string.');
    if (errors.length) return { ok: false, errors, clean: null };
    return { ok: true, errors, clean: { clocks, moved, heard, blurb: clean(reply.blurb, MAX_BLURB), elapsed: clean(reply.elapsed, 120) } };
}

/**
 * Writes a validated advance: clocks overwritten, moves logged (a ring of
 * about 20 per character and 300 in all), heard-of names added, the blurb
 * replaced, the run stamped. Never mutates the input.
 */
export function applyAdvance(state, clean, pack, { msgId = null, gameDate = '', gameTime = '', ranAt = 0 } = {}) {
    const next = cloneState(state);
    for (const [id, v] of Object.entries(clean.clocks || {})) {
        const def = pack.clocks.find(c => c.id === id);
        const from = def ? clockValue(next, def) : (isInt(next.clocks[id]) ? next.clocks[id] : null);
        next.clocks[id] = v;
        if (from !== v) next.log.push({ kind: 'clock', clock: id, from, to: v, msgId, gameDate, gameTime });
    }
    for (const m of clean.moved || []) {
        const who = canonicalName(next, m.who);
        const to = placePath(pack, m.to) || m.to;    // a story-named place is its own id
        const from = next.where[who] || '';
        if (from === to) continue;
        next.where[who] = to;
        if (!next.known[who]) next.known[who] = 'heard';
        next.log.push({ kind: 'move', who, from, to, msgId, gameDate, gameTime, reason: m.reason || '' });
        const mine = next.log.filter(e => e.who === who);
        if (mine.length > LOG_PER_CHARACTER) {
            const oldest = mine[0];
            next.log.splice(next.log.indexOf(oldest), 1);
            next.trimmed = true;
        }
    }
    if (next.log.length > LOG_TOTAL) { next.log.splice(0, next.log.length - LOG_TOTAL); next.trimmed = true; }
    for (const h of clean.heard || []) { const n = canonicalName(next, h); if (n && !next.known[n]) next.known[n] = 'heard'; }
    if (clean.blurb) next.blurb = clean.blurb;
    next.last = { msgId, gameDate, gameTime, ranAt, ok: true, elapsed: clean.elapsed || '' };
    if (!Array.isArray(next.runs)) next.runs = [];
    next.runs.push({ msgId, gameDate, gameTime, ranAt, elapsed: clean.elapsed || '', blurb: next.blurb });    // the blurb in force after the run
    if (next.runs.length > RUNS_KEEP) next.runs.splice(0, next.runs.length - RUNS_KEEP);
    next.lastError = null;
    next.sinceLast = 0;
    next.retryNext = false;
    return next;
}

/** A failed run: nothing written, the next new message runs it again. */
export function failAdvance(state, { msgId = null, ranAt = 0, error = '', kind = 'invalid' } = {}) {
    const next = cloneState(state);
    next.retryNext = true;
    next.lastError = { msgId, ranAt, error: clean(error, 300), kind: kind === 'error' ? 'error' : 'invalid' };    // 'invalid': the reply broke a rule; 'error': the request failed
    return next;
}

/** The dashboard's recent changes: moves and clock effects as public text, newest first. */
export function recentChanges(state, pack, { limit = 12, spoilerFree = false } = {}) {
    const out = [];
    for (let i = state.log.length - 1; i >= 0 && out.length < limit; i--) {
        const e = state.log[i];
        if (e.kind === 'clock') {
            const def = pack.clocks.find(c => c.id === e.clock);
            if (!def || def.hidden) continue;
            const effect = def.effects[e.to] || '';
            if (!effect) continue;    // a step with no public face stays out, whatever the mode
            out.push({ kind: 'clock', clock: e.clock, text: spoilerFree ? effect : `${def.label}: ${effect}`, gameDate: e.gameDate || '', msgId: e.msgId ?? null });
            continue;
        }
        out.push({ kind: 'move', who: e.who, text: `${e.who}: ${e.from ? `${placeLabel(pack, e.from)} → ` : ''}${placeLabel(pack, e.to)}${e.reason ? ` (${e.reason})` : ''}`, gameDate: e.gameDate || '', msgId: e.msgId ?? null });
    }
    return out;
}

/**
 * The state brought back to the chat it sits in. A branch, a checkpoint or
 * the deletion of the last replies leaves a state ahead of its chat.
 *
 * The rule: a run, or a logged change, is undone only when the message it
 * is stamped on is gone AND no reply newer than it still stands (counted
 * order; a reply the ring no longer lists counts as older than everything
 * standing). So the tail is undone down to the newest reply still
 * standing, while a reply deleted from the middle keeps the runs after it
 * and loses only its count. `presentIds` is the chat's stamped reply ids
 * in order; an entry with no message id (a manual run before any reply)
 * is never undone.
 *
 * What an undo restores: a clock to its old value (within the pack's
 * range), a character to where they came from, or to the cast's starting
 * place when the ring has dropped their older moves (the honest answer
 * once the branch point is gone); the newest run still standing, from the
 * run records, with the blurb in force after it; the pack's starting
 * values when the log ran out. The count restarts from the standing run.
 * @returns {{ state: object, undone: number, pruned: number }}
 */
export function reconcileWithChat(state, presentIds, { pack = null } = {}) {
    const ids = Array.isArray(presentIds) ? [...new Set(presentIds)] : [];
    const present = new Set(ids);
    const gone = (id) => id !== null && id !== undefined && id !== '' && !present.has(id);
    const lastId = state.last ? state.last.msgId : null;
    const lastStands = !!state.last && !gone(lastId);
    const newestStandingPos = state.counted.reduce((m, id, i) => (present.has(id) ? i : m), -1);
    const newerCountedStands = (id) => newestStandingPos > state.counted.indexOf(id);    // -1 for an id the ring lost: older than all
    const newerStands = (id) => (lastStands && id !== lastId) || newerCountedStands(id);
    const tail = state.log.length ? state.log[state.log.length - 1] : null;
    const tailGone = !!(tail && gone(tail.msgId) && !newerStands(tail.msgId));
    const lastGone = !!(state.last && gone(lastId) && !newerStands(lastId));
    const errorGone = !!(state.lastError && gone(state.lastError.msgId) && !newerCountedStands(state.lastError.msgId));
    const goneCounted = state.counted.filter(id => gone(id));
    if (!tailGone && !lastGone && !errorGone && !goneCounted.length) return { state, undone: 0, pruned: 0 };
    const next = cloneState(state);
    if (!Array.isArray(next.runs)) next.runs = [];
    let undone = 0;
    while (next.log.length) {
        const e = next.log[next.log.length - 1];
        if (!gone(e.msgId) || newerStands(e.msgId)) break;
        next.log.pop();
        undone++;
        if (e.kind === 'clock') {
            if (isInt(e.from)) {
                const def = pack ? pack.clocks.find(c => c.id === e.clock) : null;
                next.clocks[e.clock] = def ? Math.min(def.max, Math.max(0, e.from)) : e.from;
            }
        } else if (e.who) {
            const older = next.log.some(x => x.who === e.who);
            if (!older && pack) {
                // No older move left for them: the ring may have dropped the branch point; the cast's starting place is the honest answer.
                const member = pack.cast.find(m => sameName(m.name, e.who));
                if (member && member.place) next.where[e.who] = placePath(pack, member.place);
                else delete next.where[e.who];
            } else if (e.from) next.where[e.who] = e.from;
            else delete next.where[e.who];
        }
    }
    const standingRun = next.runs.slice().reverse().find(r => r.msgId === null || r.msgId === undefined || present.has(r.msgId)) || null;
    if (lastGone) {
        if (standingRun) {
            next.last = { msgId: standingRun.msgId ?? null, gameDate: standingRun.gameDate || '', gameTime: standingRun.gameTime || '', ranAt: standingRun.ranAt || 0, ok: true, elapsed: standingRun.elapsed || '' };
            next.blurb = standingRun.blurb || '';
        } else {
            const stand = next.log.length ? next.log[next.log.length - 1] : null;
            next.last = stand ? { msgId: stand.msgId ?? null, gameDate: stand.gameDate || '', gameTime: stand.gameTime || '', ranAt: 0, ok: true, elapsed: '' } : null;
            next.blurb = next.last ? '' : ((pack && pack.blurb) || '');
        }
    }
    if (errorGone) {
        next.lastError = null;
        next.retryNext = false;
    }
    if (undone && !next.log.length && pack && next.trimmed) {
        // The ring had dropped entries, so the emptied log ran out before the branch point and the values it left are
        // a wrong middle: back to the pack's starting values (the names stay known). An untrimmed log undone whole
        // is exact and keeps what it restored.
        for (const c of pack.clocks) next.clocks[c.id] = c.start;
        for (const name of Object.keys(next.where)) delete next.where[name];
        for (const m of pack.cast) if (m.place) next.where[m.name] = placePath(pack, m.place);
        if (!standingRun) { next.blurb = pack.blurb || ''; next.last = null; }
        next.trimmed = false;
    }
    // The run records of undone runs go; a run kept through a middle deletion stays listed (its reply is gone, newer ones stand).
    next.runs = next.runs.filter(r => !(gone(r.msgId) && !newerStands(r.msgId)));
    let pruned = 0;
    for (const id of goneCounted) {
        const pos = next.counted.indexOf(id);
        if (pos < 0) continue;
        const boundary = Math.max(0, next.counted.length - next.sinceLast);    // the last `sinceLast` ids are the ones since the run
        next.counted.splice(pos, 1);
        if (pos >= boundary && next.sinceLast > 0) next.sinceLast -= 1;
        pruned++;
    }
    if (undone || lastGone) {
        const lp = next.last && next.last.msgId ? ids.indexOf(next.last.msgId) : -1;
        next.sinceLast = ids.slice(lp + 1).filter(id => next.counted.includes(id)).length;
    }
    return { state: next, undone, pruned };
}

/** The feed's entries gathered under their game date, in the order given (newest first from recentChanges); entries with no date under ''. */
export function groupChangesByDate(changes) {
    const groups = [];
    for (const c of changes || []) {
        const date = c.gameDate || '';
        const last = groups[groups.length - 1];
        if (last && last.date === date) last.items.push(c);
        else groups.push({ date, items: [c] });
    }
    return groups;
}

/**
 * One character's moves, oldest first, with labelled places: where they
 * started (the first entry's `from`, when the log holds it), each move
 * with its date and reason, and where they stand now.
 * @returns {{ name: string, now: string, steps: Array<{ from: string, to: string, gameDate: string, gameTime: string, reason: string, msgId: * }> }}
 */
export function characterTimeline(state, pack, name) {
    const mine = (state.log || []).filter(e => e.who === name);
    const steps = mine.map(e => ({
        from: e.from ? placeLabel(pack, e.from) : '',
        to: placeLabel(pack, e.to),
        gameDate: e.gameDate || '',
        gameTime: e.gameTime || '',
        reason: e.reason || '',
        msgId: e.msgId ?? null,
    }));
    const now = state.where && state.where[name] ? placeLabel(pack, state.where[name]) : '';
    const member = ((pack && pack.cast) || []).find(m => sameName(m.name, name));
    const firstFrom = mine.length ? (mine[0].from || '') : '';
    // "Started at" only when the log still reaches the cast's starting place (by place, not by label: two places may share
    // their labels); a ring that dropped older moves cannot vouch for it
    return { name, now, steps, start: steps.length ? steps[0].from : '', startIsSeed: !!firstFrom && !!(member && member.place) && resolvePlace(pack, firstFrom) === member.place };
}

/** What people would say about each clock now: the effect text of its value, never the number. */
export function publicEffects(state, pack) {
    return pack.clocks.filter(c => !c.hidden).map(c => {
        const v = clockValue(state, c);
        return { id: c.id, label: c.label, text: c.effects[v] || '' };
    }).filter(e => e.text);
}
