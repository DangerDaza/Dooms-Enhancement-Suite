/**
 * World gen on the Atlas (docs/long-shot-plan.md D182, D183, D186), the
 * pure parts: what the panel offers for a map, the world a set of choices
 * would make (for the panel's picture), the book with that world put
 * under the map, and the request that names the lands the world gen
 * added. The generator itself is worldGen.js; the model reads the book's
 * world in atlas.js. The request is asked in
 * src/systems/features/atlasBook.js; the panel is in
 * src/systems/ui/atlasViews.js. tools/atlas-world-test.mjs.
 */
import { normalizeBook, addPin, removeMarker, unplace, withWorld, editMarker, ATLAS_SCALES } from './atlas.js';
import { WORLD_SHAPES, WORLD_SIZES, WORLD_REGIONS, worldSpecFor, sizeOfWorld, generateWorld, suggestSites, divideWorld, isStandInName } from './worldGen.js';

const clean = (v, max = 200) => String(v ?? '').normalize('NFC').replace(/\s+/g, ' ').trim().slice(0, max);
const norm = (t) => clean(t, 120).toLowerCase().replace(/^the\s+/, '').replace(/[’]/g, "'");

export const WORLD_MODES = Object.freeze(['keep', 'clean']);    // around what is placed, or everything back to the list

/**
 * The regions the world gen added that nobody has taken up (D183): not
 * canon, nothing inside them, still under the plain name they were given.
 * A world made again replaces them; a region that was named, filled or
 * made canon is the player's and stays.
 * @param {object} model  the top map's model
 */
export function standIns(model) {
    const all = model ? [...(model.markers || []), ...(model.tray || []).filter(t => t.here !== false)] : [];
    return all.filter(m => m.kind === 'region' && m.loose === true && !m.holds && isStandInName(m.label));
}

/** What stands on the top map now, as the panel tells it: the regions and the places with a spot, and the regions that wait in the list. */
export function worldGenState(book, model) {
    const b = normalizeBook(book);
    const gone = new Set(standIns(model).map(m => m.id));
    const placed = (model && model.markers ? model.markers : []).filter(m => !gone.has(m.id));
    const waiting = (model && model.tray ? model.tray : []).filter(t => t.here !== false && !gone.has(t.id));
    return {
        had: !!b.world,
        regions: placed.filter(m => m.kind === 'region').length,
        places: placed.filter(m => m.kind !== 'region').length,
        waitingRegions: waiting.filter(t => t.kind === 'region').length,
        standIns: gone.size,
    };
}

/**
 * What the panel opens on: the world the map has, or, for a map with
 * none, one great landmass of the middle size. A map that has regions of
 * its own is offered no new ones; an empty one is offered a handful; a
 * map whose last world gen left regions nobody took up is offered as
 * many again in their place.
 */
export function worldGenDefaults(book, model) {
    const b = normalizeBook(book);
    const st = worldGenState(book, model);
    const has = st.regions + st.waitingRegions > 0;
    return {
        shape: b.world ? b.world.shape : 'pangea',
        size: b.world && WORLD_SIZES[sizeOfWorld(b.world)] ? sizeOfWorld(b.world) : 'medium',
        seed: b.world ? b.world.seed : '',
        regions: st.standIns ? st.standIns : has ? 0 : WORLD_REGIONS.default,    // the regions a world made again replaces are offered again, one for one
        mode: st.regions + st.places > 0 ? 'keep' : 'clean',
    };
}

const pickShape = (v) => (WORLD_SHAPES.some(s => s.id === v) ? v : 'pangea');
const pickSize = (v) => (WORLD_SIZES[v] ? v : 'medium');
const pickCount = (v) => Math.min(WORLD_REGIONS.max, Math.max(WORLD_REGIONS.min, Math.round(Number(v)) || 0));

/**
 * The world a set of choices would make for a map (D182): nothing is
 * changed. With `mode` 'keep' it is made around what stands on the map
 * (land under each place, each region keeps its spot and holds the land
 * about it); with 'clean' it is made for itself and everything on the
 * map goes back to the list. `regions` more are added where the world
 * would have them, each under a plain name of its own.
 * @param {object} model  the top map's model
 * @returns {{ spec: object, world: object, mode: string, kept: Array<{ id: string, label: string, x: number, y: number, region: boolean }>,
 *   added: Array<{ key: string, name: string, x: number, y: number }>, lands: Array<{ id: string, label: string, parts: number[][][][], x: number, y: number, added: boolean }>,
 *   unplaced: number, replaced: string[] }|null}  null without a seed
 */
export function planWorldGen(book, model, { seed = '', shape = 'pangea', size = 'medium', regions = 0, mode = 'keep' } = {}) {
    if (!clean(seed, 40)) return null;
    const keep = mode !== 'clean';
    const gone = standIns(model);
    const goneIds = new Set(gone.map(m => m.id));
    const placed = (model && model.markers ? model.markers : []).filter(m => !goneIds.has(m.id));
    const kept = keep ? placed.map(m => ({ id: m.id, label: m.label, x: m.x, y: m.y, region: m.kind === 'region' })) : [];
    const spec = worldSpecFor({ seed, shape: pickShape(shape), size: pickSize(size), spots: kept });
    const world = generateWorld(spec);
    if (!world) return null;
    const held = kept.filter(k => k.region);
    const spots = suggestSites(world, pickCount(regions), held);
    const sites = [...held.map(k => ({ id: k.id, x: k.x, y: k.y })), ...spots.map((s, i) => ({ id: `new:${i}`, x: s.x, y: s.y }))];
    const division = divideWorld(world, sites);
    // A plain name for each new land, clear of every name the map already has.
    const taken = new Set((model && model.all ? model.all : []).filter(m => !goneIds.has(m.id)).map(m => norm(m.label)));
    const added = spots.map((s, i) => {
        const land = division.lands.get(`new:${i}`);
        let name = land ? land.name : `New land ${i + 1}`;
        for (let n = 2; taken.has(norm(name)); n++) name = `${land ? land.name : 'New land'} ${n}`;
        taken.add(norm(name));
        return { key: `new:${i}`, name, x: s.x, y: s.y };
    });
    const lands = sites.map(s => {
        const land = division.lands.get(s.id);
        if (!land) return null;
        const own = kept.find(k => k.id === s.id);
        return { id: s.id, label: own ? own.label : (added.find(a => a.key === s.id) || { name: '' }).name, parts: land.parts, x: s.x, y: s.y, added: !own };
    }).filter(Boolean);
    return { spec, world, mode: keep ? 'keep' : 'clean', kept, added, lands, unplaced: keep ? 0 : placed.length, replaced: gone.map(m => m.id) };
}

/**
 * The book with the world put under its top map (D182), as planned: the
 * regions nobody took up are forgotten, the new ones stand where the
 * world would have them (not canon, to be named), and with 'clean'
 * everything else on the map waits in the list to be put down again.
 * Nothing inside any region is touched.
 * @returns {{ book: object, added: string[], unplaced: number, replaced: number }|null}
 */
export function applyWorldGen(book, model, choices) {
    const plan = planWorldGen(book, model, choices);
    if (!plan) return null;
    let b = normalizeBook(book);
    for (const id of plan.replaced) b = removeMarker(b, id);
    if (plan.mode === 'clean') for (const m of (model && model.markers ? model.markers : [])) if (!plan.replaced.includes(m.id)) b = unplace(b, m.id);
    b = withWorld(b, plan.spec);
    const added = [];
    for (const a of plan.added) { const made = addPin(b, { label: a.name, kind: 'region', x: a.x, y: a.y, layer: '', loose: true }); b = made.book; added.push(made.id); }
    return { book: b, added, unplaced: plan.unplaced, replaced: plan.replaced.length };
}

/** A world's size in words, at a scale: "about 960 by 660 miles". */
export function worldReach(spec, measure) {
    const per = measure && measure.per > 0 ? measure.per : ATLAS_SCALES.region.per;
    const unit = measure && measure.unit === 'km' ? 'km' : measure && measure.unit === 'league' ? 'leagues' : 'miles';
    const tidy = (n) => (n >= 1000 ? Math.round(n / 50) * 50 : Math.round(n / 10) * 10);
    return spec ? `about ${tidy(spec.w * per)} by ${tidy(spec.h * per)} ${unit}` : '';
}

// ─── Naming the lands (D186) ────────────────────────────────────────────────

export const NAMES_MAX = 24;

/** The lands to be named: the regions on the top map that are not canon and still carry a plain stand-in name. */
export function landsToName(model) {
    return (model && model.territories ? model.territories : []).filter(t => t.loose === true && isStandInName(t.label)).slice(0, NAMES_MAX);
}

/**
 * The request that names the lands a world gen added (D186): each told
 * by where it lies, what its ground is and what it borders; the lands
 * already named are given so the new names fit beside them. The AI never
 * writes a coordinate and never renames a land that has its name.
 * @returns {{ system: string, user: string, count: number, lands: Array<{ n: number, id: string, label: string }> }}
 */
export function buildNamesPrompt({ model = null, world = '', lore = '', card = {}, wish = '' } = {}) {
    const lands = landsToName(model).map((t, i) => ({ n: i + 1, id: t.id, label: t.label }));
    const numbered = new Map(lands.map(l => [l.id, l.n]));
    const all = model && model.territories ? model.territories : [];
    const said = (id) => { const t = all.find(x => x.id === id); return !t ? '' : numbered.has(id) ? `land ${numbered.get(id)}` : t.label; };
    const system = [
        'You name the lands of a role-play story\'s world. A map of the world was just drawn: its coasts, mountains, forests and lakes. Some of its lands have no name yet. You give each a proper name and one sentence on what kind of land it is.',
        'Reply with one JSON object and nothing else:',
        '{"lands":[{"n":<the land\'s number>,"name":"<proper name>","note":"<one sentence: what kind of land it is, and a reason someone might go there>"}]}',
        'Rules:',
        `- One entry for every numbered land, ${lands.length} in all. Use each number once.`,
        '- A name fits the land: what its ground is, where it lies, what it borders. A mountainous land is not named for its meadows.',
        '- Fit the world: its tone, its names, its level of magic and technology. Use names in the style of the names already there. Where the lore names a land that is not on the map yet and one of the numbered lands fits it, use the lore\'s name.',
        '- Do not reuse or rename any name already on the map.',
        '- You never write coordinates.',
    ].join('\n');
    const parts = [];
    if (clean(wish, 4)) parts.push(`WHAT THE PLAYER ASKED FOR (this outranks the rest):\n${String(wish).trim().slice(0, 600)}`);
    parts.push(`The world: ${clean(world, 120) || 'unnamed'}.${model && model.world ? ` Its map: ${(WORLD_SHAPES.find(s => s.id === model.world.shape) || { hint: '' }).hint}` : ''}`);
    const cardText = [card.description, card.scenario].filter(Boolean).join('\n').trim().slice(0, 1500);
    if (cardText) parts.push(`The character card:\n${cardText}`);
    if (lore) parts.push(`The lore:\n${String(lore).slice(0, 3000)}`);
    const tell = (id) => { const t = all.find(x => x.id === id); return t && t.summary ? t.summary : ''; };
    const borders = (id) => { const t = all.find(x => x.id === id); const names = t ? t.neighbours.map(said).filter(Boolean) : []; return names.length ? `; borders ${names.join(', ')}` : '; borders no other land'; };
    const named = all.filter(t => !numbered.has(t.id));
    if (named.length) parts.push(`The lands that have their names (do not rename them):\n${named.map(t => `- ${t.label}: ${tell(t.id) || 'a land of the world'}${borders(t.id)}`).join('\n')}`);
    parts.push(`The lands to name:\n${lands.map(l => `${l.n}. ${tell(l.id) || 'a land of the world'}${borders(l.id)}`).join('\n')}`);
    const other = model && Array.isArray(model.all) ? model.all.filter(x => x.kind !== 'region').map(x => x.label) : [];
    if (other.length) parts.push(`Places of the world (a land is not named after one of them): ${other.slice(0, 80).join('; ')}`);
    return { system, user: parts.join('\n\n'), count: lands.length, lands };
}

function jsonIn(text) {
    const raw = String(text ?? '');
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start < 0 || end <= start) return null;
    try { const v = JSON.parse(raw.slice(start, end + 1)); return v && typeof v === 'object' ? v : null; } catch (e) { return null; }
}

/**
 * The names read from the reply: for each numbered land a name nothing
 * else in the world carries (one that is taken, empty or given twice is
 * passed over: that land keeps its stand-in) and a note.
 * @param {Array<{ n: number, id: string, label: string }>} lands  buildNamesPrompt().lands
 * @returns {{ ok: boolean, names: Array<{ id: string, was: string, name: string, note: string }>, error: string }}
 */
export function parseNames(text, model, lands) {
    const v = jsonIn(text);
    const list = v && Array.isArray(v.lands) ? v.lands : (v && Array.isArray(v.regions) ? v.regions : null);
    if (!list) return { ok: false, names: [], error: 'The reply had no names in it.' };
    const taken = new Set((model && model.all ? model.all : []).map(m => norm(m.label)));
    const done = new Set();
    const names = [];
    for (const row of list) {
        if (!row || typeof row !== 'object') continue;
        const land = (Array.isArray(lands) ? lands : []).find(l => l.n === Number(row.n));
        const name = clean(row.name, 80);
        if (!land || done.has(land.id) || name.length < 2 || taken.has(norm(name)) || isStandInName(name)) continue;
        done.add(land.id);
        taken.add(norm(name));
        names.push({ id: land.id, was: land.label, name, note: clean(row.note, 300) });
    }
    return names.length ? { ok: true, names, error: '' } : { ok: false, names: [], error: 'The reply gave no name that could be used.' };
}

/** The book with the lands named: each takes its name and its note, and stays not canon until the player says so. */
export function applyNames(book, names) {
    let b = normalizeBook(book);
    for (const n of Array.isArray(names) ? names : []) if (n && clean(n.name, 80)) b = editMarker(b, n.id, { label: n.name, ...(n.note ? { note: n.note } : {}) });
    return b;
}
