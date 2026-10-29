/**
 * The World Builder's pure parts (docs/world-builder-plan.md): a world
 * written from a chat's own play (D96), the draft the LLM is asked for and
 * how its reply is read (D95), the warnings a world gets beside the pack's
 * own errors, and the file a world is exported as. No SillyTavern, no DOM:
 * tools/world-builder-test.mjs imports this directly.
 */
import { normalizePack, placeChain, isLocId, locLabel, jsonObjectsIn, MAX_NAME, MAX_BLURB } from './liveWorld.js';

const clean = (v, max = 200) => String(v ?? '').normalize('NFC').replace(/\s+/g, ' ').trim().slice(0, max);
const cut = (v, max) => String(v ?? '').normalize('NFC').trim().slice(0, max);    // lines kept: lore and scenes read better unfolded
const slug = (v) => clean(v, 60).toLowerCase().replace(/[^\p{L}\p{M}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '');
const isInt = (n) => Number.isInteger(n);

export const WORLD_LIMITS = Object.freeze({ places: 200, clocks: 24, cast: 120, clockMax: 24 });
export const DRAFT_LIMITS = Object.freeze({ card: 4000, lore: 6000, recent: 4000, names: 40 });

/** A world with nothing in it yet, in the pack file's shape (what the builder edits). */
export function emptyWorld({ id = '', name = '' } = {}) {
    const n = clean(name, 80);
    return { id: slug(id || n), name: n, version: 1, description: '', places: [], clocks: [], cast: [], blurb: '' };
}

/** The pack file's shape from a normalised pack: what the builder edits and what Export writes. */
export function worldToRaw(pack) {
    const p = pack && typeof pack === 'object' ? pack : {};
    const raw = {
        id: clean(p.id, 60),
        name: clean(p.name, 80),
        version: isInt(p.version) ? p.version : 1,
        description: clean(p.description, 400),
        places: (Array.isArray(p.places) ? p.places : []).map(x => ({ id: x.id, label: x.label, parent: x.parent || null, ...(x.image ? { image: x.image } : {}) })),
        clocks: (Array.isArray(p.clocks) ? p.clocks : []).map(c => ({
            id: c.id, label: c.label, ...(c.place ? { place: c.place } : {}),
            start: isInt(c.start) ? c.start : 0, max: isInt(c.max) ? c.max : 6,
            ...(c.step ? { step: c.step } : {}), ...(c.hidden ? { hidden: true } : {}),
            effects: { ...(c.effects || {}) },
        })),
        cast: (Array.isArray(p.cast) ? p.cast : []).map(m => ({ name: m.name, ...(m.place ? { place: m.place } : {}), tier: m.tier === 'known' ? 'known' : 'heard', ...(m.portrait ? { portrait: m.portrait } : {}) })),
        blurb: clean(p.blurb, MAX_BLURB),
    };
    if (p.template) raw.template = String(p.template);
    return raw;
}

/** "8 places · 2 clocks · 3 people" */
export function worldSummary(pack) {
    const n = (k) => (pack && Array.isArray(pack[k]) ? pack[k].length : 0);
    const word = (c, one, many) => `${c} ${c === 1 ? one : many}`;
    return `${word(n('places'), 'place', 'places')} · ${word(n('clocks'), 'clock', 'clocks')} · ${word(n('cast'), 'person', 'people')}`;
}

/** What a sound world still lacks: notes, not errors; the engine plays a world with any of them. */
export function packWarnings(pack) {
    const w = [];
    if (!pack || typeof pack !== 'object') return w;
    const places = Array.isArray(pack.places) ? pack.places : [];
    const clocks = Array.isArray(pack.clocks) ? pack.clocks : [];
    const cast = Array.isArray(pack.cast) ? pack.cast : [];
    if (!places.length) w.push('No places yet: the Map takes them from the story as it names them.');
    if (!clocks.length) w.push('No clocks: nothing moves between scenes until one is added.');
    for (const c of clocks) {
        const steps = Object.keys(c.effects || {}).length;
        if (!steps) w.push(`The clock "${c.label}" has no step texts: the narrator is not told what each step means.`);
        else if (steps < c.max + 1) w.push(`The clock "${c.label}" names ${steps} of its ${c.max + 1} steps.`);
    }
    if (cast.length && !cast.some(m => m.place)) w.push('Nobody in the cast has a starting place.');
    if (!clean(pack.blurb)) w.push('No blurb: Rumours start empty until the first advance.');
    return w;
}

/**
 * A world written from a chat's own play (D96, "Make this a world"): the
 * places the story visited (a pack place with its ancestors and nesting; a
 * place the pack did not name as a place of its own, its drawn picture
 * kept), then the pack's other places; the clocks at their values now; the
 * known people where they were last seen; the blurb. The pack file's shape.
 */
export function worldFromState(state, pack, { name = '', id = '' } = {}) {
    const s = state && typeof state === 'object' ? state : {};
    const p = pack && typeof pack === 'object' ? pack : {};
    const packPlaces = Array.isArray(p.places) ? p.places : [];
    const worldName = clean(name || s.name || p.name, 80) || 'The world';
    const raw = emptyWorld({ id: id || worldName, name: worldName });
    raw.description = clean(p.description, 400);
    const have = new Set();
    const addPlace = (place) => { if (place.id && !have.has(place.id)) { have.add(place.id); raw.places.push(place); } };
    const fromPack = (pp, image = '') => ({ id: pp.id, label: pp.label, parent: pp.parent || null, ...((image || pp.image) ? { image: image || pp.image } : {}) });
    for (const e of Array.isArray(s.visited) ? s.visited : []) {
        if (!e || typeof e.id !== 'string') continue;
        if (e.packId) {
            for (const pp of placeChain({ places: packPlaces }, e.packId)) addPlace(fromPack(pp, pp.id === e.packId ? (e.image || '') : ''));
        } else if (isLocId(e.id)) {
            addPlace({ id: e.id.slice(4), label: clean(e.label, 80) || locLabel(e.id), parent: null, ...(e.image ? { image: e.image } : {}) });
        }
    }
    for (const pp of packPlaces) addPlace(fromPack(pp));    // a world is not smaller for being unexplored
    const values = s.clocks && typeof s.clocks === 'object' ? s.clocks : {};
    for (const c of Array.isArray(p.clocks) ? p.clocks : []) {
        const now = isInt(values[c.id]) ? Math.min(c.max, Math.max(0, values[c.id])) : c.start;
        raw.clocks.push({ id: c.id, label: c.label, ...(c.place ? { place: c.place } : {}), start: now, max: c.max, ...(c.step ? { step: c.step } : {}), ...(c.hidden ? { hidden: true } : {}), effects: { ...(c.effects || {}) } });
    }
    const placeOfPath = (path) => {
        const last = String(path || '').split('/').filter(Boolean).pop() || '';
        const id = isLocId(last) ? last.slice(4) : last;
        return id && have.has(id) ? id : '';
    };
    const known = s.known && typeof s.known === 'object' ? s.known : {};
    const where = s.where && typeof s.where === 'object' ? s.where : {};
    for (const n of new Set([...Object.keys(known), ...Object.keys(where)])) {
        const nm = clean(n, MAX_NAME);
        if (!nm) continue;
        const place = placeOfPath(where[n]);
        raw.cast.push({ name: nm, ...(place ? { place } : {}), tier: known[n] === 'known' ? 'known' : 'heard' });
    }
    raw.blurb = clean(s.blurb, MAX_BLURB);
    return raw;
}

/**
 * The request that drafts a world from a chat (D95): the card, the lore
 * the chat carries, the names DES knows, the recent scenes; the exact
 * JSON asked for, the pack file's shape. The player is never cast.
 * @returns {{ system: string, user: string }}
 */
export function buildWorldDraftPrompt({ name = '', card = {}, lore = '', characters = [], recent = '', player = '' } = {}) {
    const worldName = clean(name, 80);
    const players = (Array.isArray(player) ? player : [player]).map(x => clean(x, MAX_NAME)).filter(Boolean);
    const c = card && typeof card === 'object' ? card : {};
    const cardText = [
        c.name ? `Name: ${clean(c.name, MAX_NAME)}` : '',
        c.description ? `Description: ${cut(c.description, DRAFT_LIMITS.card)}` : '',
        c.personality ? `Personality: ${cut(c.personality, 1000)}` : '',
        c.scenario ? `Scenario: ${cut(c.scenario, 1500)}` : '',
    ].filter(Boolean).join('\n');
    const names = (Array.isArray(characters) ? characters : [])
        .map(n => clean(n, MAX_NAME))
        .filter(n => n && !players.some(pl => pl.toLowerCase() === n.toLowerCase()))
        .slice(0, DRAFT_LIMITS.names);
    const system = `You design the world behind a roleplay for a clockwork that runs between scenes: the places the story moves through, the plot clocks that tick while the player is elsewhere, and the people who live there. You never write story. You answer with ONE JSON object and nothing else, in exactly this shape:
{"id": "<a short slug>", "name": "<the world's name>", "description": "<one or two sentences>", "places": [{"id": "<slug>", "label": "<the place as the story names it>", "parent": "<the id of the place it is inside, or null>"}], "clocks": [{"id": "<slug>", "label": "<what is building>", "place": "<a place id, or omit>", "start": <integer>, "max": <integer from 4 to 8>, "effects": {"0": "<what the street sees at step 0>", "1": "<at step 1>"}}], "cast": [{"name": "<a person>", "place": "<a place id>", "tier": "known" or "heard"}], "blurb": "<one sentence: what the world talks about now>"}
Rules: 6 to 16 places nested two or three deep (a region, its districts, the rooms the story uses), ids lowercase slugs, every parent an id in the list; 2 to 4 clocks, each a pressure that grows or eases on its own, with a short public effect for EVERY step from 0 to max, written as what anyone in the world could see or hear, no secrets; the cast are the people of the world the story has shown or implied, 3 to 10, each at a place id, "known" when the player has met them and "heard" when only spoken of; ${players.length ? `never cast the player (${players.join(' / ')}); ` : ''}use the lore's own names and places first and invent only what fills the gaps; no commentary, no code fences.`;
    const user = `${worldName ? `World: ${worldName}\n\n` : ''}The character card:
${cardText || '(none)'}

The lore the chat carries:
${cut(lore, DRAFT_LIMITS.lore) || '(none)'}

People the story knows: ${names.join(', ') || '(none yet)'}

Recent scenes:
${cut(recent, DRAFT_LIMITS.recent) || '(none)'}

Answer with the JSON object only.`;
    return { system, user };
}

/** The slips weak models make, forgiven before the pack is checked: parents "null", numbers as strings, effects as a list, tiers in any case. */
function looseWorld(found) {
    const raw = { ...found };
    const num = (v) => (typeof v === 'string' && /^-?\d+$/.test(v.trim()) ? Number(v) : v);
    const noParent = (v) => v === null || v === undefined || (typeof v === 'string' && ['', 'null', 'none', 'root', '-'].includes(v.trim().toLowerCase()));
    if (Array.isArray(raw.places)) raw.places = raw.places.map(x => (x && typeof x === 'object' ? { ...x, parent: noParent(x.parent) ? null : x.parent } : x));
    if (Array.isArray(raw.clocks)) {
        raw.clocks = raw.clocks.map(c => {
            if (!c || typeof c !== 'object') return c;
            const out = { ...c, start: num(c.start), max: num(c.max), step: num(c.step) };
            if (Array.isArray(c.effects)) out.effects = Object.fromEntries(c.effects.map((t, i) => [String(i), t]));
            else if (c.effects && typeof c.effects === 'object') out.effects = Object.fromEntries(Object.entries(c.effects).map(([k, t]) => [String(k).trim(), t]));
            if (out.step === undefined || out.step === null) delete out.step;
            return out;
        });
    }
    if (Array.isArray(raw.cast)) raw.cast = raw.cast.map(m => (m && typeof m === 'object' ? { ...m, tier: typeof m.tier === 'string' ? m.tier.trim().toLowerCase() : m.tier } : m));
    return raw;
}

/**
 * The draft read back: the first JSON object with places, clocks or cast,
 * made loose, then safe by normalizePack. The file-shaped world comes back
 * even when the pack has errors, so the builder can show what to fix.
 * @returns {{ ok: boolean, raw: object|null, pack: object|null, errors: string[] }}
 */
export function parseWorldDraft(text, { id = '', name = '' } = {}) {
    const found = jsonObjectsIn(text).find(v => ['places', 'clocks', 'cast'].some(k => k in v)) || null;
    if (!found) return { ok: false, raw: null, pack: null, errors: ['The reply holds no world (no places, clocks or cast).'] };
    const loose = looseWorld(found);
    if (name && !clean(loose.name, 80)) loose.name = clean(name, 80);
    if (id) loose.id = id;
    else if (!slug(loose.id || loose.name)) loose.id = slug(name) || 'world';
    const n = normalizePack(loose);
    return { ok: n.ok, raw: worldToRaw(n.pack), pack: n.ok ? n.pack : null, errors: n.errors };
}

/** The file a world is exported as. */
export function worldFileName(pack) {
    return `${slug(pack?.id || pack?.name) || 'world'}.json`;
}

/** The file's text: the world made safe, in the file's shape, indented. */
export function worldToJson(raw) {
    return JSON.stringify(worldToRaw(normalizePack(raw).pack), null, 2);
}
