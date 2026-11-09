/**
 * The Atlas's pure model (docs/long-shot-plan.md D139–D153): the world as
 * a flat vector map. Nothing stands on the map by itself: a place is a
 * marker once the player gives it a spot (layout units, y down), kept in
 * the chat's book, and waits in the tray until then. Rooms fold into
 * their building; a marker can be made by hand, renamed, merged into
 * another, taken off or deleted. The land is drawn around the markers; a
 * region of the world is a named blob around its placed places; paths
 * are drawn and never measured; the distance between two places is the
 * straight line between their spots times the map's scale. No imports:
 * liveWorld.js reads `normalizeAtlas` for the pack. tools/atlas-test.mjs.
 */

const clean = (v, max = 200) => String(v ?? '').normalize('NFC').replace(/\s+/g, ' ').trim().slice(0, max);
const round4 = (n) => Math.round(n * 10000) / 10000;
const finite = (n) => typeof n === 'number' && Number.isFinite(n);

/** The kinds a place can be (D146), in the sidebar's order: the categories. */
export const ATLAS_KINDS = Object.freeze([
    { id: 'settlement', label: 'Settlements', icon: 'fa-city' },
    { id: 'stronghold', label: 'Strongholds', icon: 'fa-chess-rook' },
    { id: 'tavern', label: 'Taverns & inns', icon: 'fa-beer-mug-empty' },
    { id: 'shop', label: 'Shops & trade', icon: 'fa-store' },
    { id: 'sacred', label: 'Sacred places', icon: 'fa-place-of-worship' },
    { id: 'ruin', label: 'Ruins & dungeons', icon: 'fa-dungeon' },
    { id: 'wild', label: 'Wilds', icon: 'fa-tree' },
    { id: 'water', label: 'Water & ports', icon: 'fa-anchor' },
    { id: 'home', label: 'Homes', icon: 'fa-house' },
    { id: 'landmark', label: 'Landmarks', icon: 'fa-monument' },
    { id: 'other', label: 'Other places', icon: 'fa-location-dot' },
]);
const KIND_IDS = new Set(ATLAS_KINDS.map(k => k.id));
export const kindOf = (id) => ATLAS_KINDS.find(k => k.id === id) || ATLAS_KINDS[ATLAS_KINDS.length - 1];

export const ATLAS_TERRAINS = Object.freeze(['plains', 'forest', 'mountains', 'desert', 'snow', 'swamp', 'coast', 'town']);

/** What one layout unit is, in miles, and what the scale is called. */
export const ATLAS_SCALES = Object.freeze({
    town: { per: 0.1, label: 'A town' },
    region: { per: 15, label: 'A region' },
    world: { per: 60, label: 'A world' },
});
export const ATLAS_UNITS = Object.freeze({ mi: 1, km: 1.609344, league: 1 / 3 });    // one mile in each unit
export const DEFAULT_PACE_MILES = 24;     // a day on foot
export const TRAVEL_HOURS_A_DAY = 8;
export const STEPS = Object.freeze([7, 1, 0.09, 0.012]);    // the step between siblings at each depth, in layout units
const GOLDEN = Math.PI * (3 - Math.sqrt(5));
const DIRS = new Set(['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw']);

// Word lists a kind or a terrain is guessed from (the first that matches wins).
const KIND_WORDS = [
    ['tavern', /\b(tavern|inn|pub|bar|alehouse|taproom|saloon|cantina|caf[eé]|diner|restaurant|club|lounge)\b/i],
    ['shop', /\b(shop|store|market|bazaar|forge|smithy|smith|apothecary|emporium|stall|bank|guild|exchange|mall|warehouse|boutique|bakery|armou?ry)\b/i],
    ['sacred', /\b(temple|shrine|church|chapel|cathedral|abbey|monastery|sanctum|sanctuary|altar|grove|mosque|convent)\b/i],
    ['ruin', /\b(ruins?|dungeon|crypt|tomb|catacombs?|cave|cavern|mine|lair|vault|barrow|sewers?|pit|labyrinth|den)\b/i],
    ['stronghold', /\b(castle|keep|fort|fortress|citadel|palace|tower|garrison|barracks|stronghold|bastion|hold|prison|jail|watch|customs|headquarters|hq|station|precinct|court)\b/i],
    ['water', /\b(port|harbou?r|docks?|quay|pier|wharf|lake|river|sea|bay|coast|beach|shore|falls|spring|well|marina|canal|ferry|lighthouse|island|isle)\b/i],
    ['wild', /\b(forest|woods?|wilds?|jungle|swamp|marsh|moor|plains?|fields?|meadow|desert|dunes?|mountains?|peaks?|hills?|valley|canyon|pass|road|trail|glade|park|garden|farm|ranch|camp)\b/i],
    ['home', /\b(house|home|cottage|manor|estate|villa|apartment|flat|hut|cabin|lodge|residence|mansion|quarters|dorm|bedroom|room)\b/i],
    ['settlement', /\b(city|town|village|hamlet|capital|district|quarter|ward|borough|outpost|settlement|colony|square|plaza|street|avenue|row|lane)\b/i],
    ['landmark', /\b(statue|monument|bridge|gate|arch|fountain|obelisk|stone|pillar|library|academy|school|university|arena|theat(?:re|er)|museum|hall|hospital|clinic|lab|laboratory|office)\b/i],
];
const TERRAIN_WORDS = [
    ['snow', /\b(snow|ice|frost|frozen|glacier|tundra|north|winter)/i],
    ['desert', /\b(desert|dunes?|sands?|waste|wastes|badlands|barrens)/i],
    ['swamp', /\b(swamp|marsh|bog|fen|mire|bayou)/i],
    ['mountains', /\b(mountains?|peaks?|highlands?|crags?|ridge|cliffs?|reach|spire)/i],
    ['forest', /\b(forest|woods?|jungle|grove|wild|weald|thicket)/i],
    ['coast', /\b(coast|shore|bay|harbou?r|port|isle|island|sea|side|haven|cove|quay)/i],
    ['town', /\b(city|town|village|district|quarter|ward|capital|borough|station|academy|campus)/i],
];

/** A place's kind from its name (D146): the first list that matches, else `other`. */
export function guessKind(label) {
    const text = String(label || '');
    for (const [kind, re] of KIND_WORDS) if (re.test(text)) return kind;
    return 'other';
}

/** A region's terrain from its name; plains when nothing says. */
export function guessTerrain(label) {
    const text = String(label || '');
    for (const [terrain, re] of TERRAIN_WORDS) if (re.test(text)) return terrain;
    return 'plains';
}

/** A kind made safe: one of the list, else ''. */
export const cleanKind = (v) => (typeof v === 'string' && KIND_IDS.has(v.trim().toLowerCase()) ? v.trim().toLowerCase() : '');

/** A string to a number in 0..1, the same for the same string everywhere (FNV-1a). */
export function hash01(text) {
    let h = 0x811c9dc5;
    const s = String(text || '');
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return ((h >>> 0) % 100000) / 100000;
}

/**
 * The atlas record made safe (docs/long-shot-plan.md §2). `placeIds` are
 * the pack's place ids: a spot or a link that names another is dropped.
 */
export function normalizeAtlas(raw, placeIds = null) {
    const r = raw && typeof raw === 'object' ? raw : {};
    const known = placeIds ? new Set(placeIds) : null;
    const has = (id) => typeof id === 'string' && id && (!known || known.has(id));
    const spots = {};
    if (r.spots && typeof r.spots === 'object') {
        for (const [id, s] of Object.entries(r.spots)) {
            if (!has(id) || !s || typeof s !== 'object' || !finite(s.x) || !finite(s.y)) continue;
            if (Math.abs(s.x) > 1e6 || Math.abs(s.y) > 1e6) continue;
            spots[id] = { x: round4(s.x), y: round4(s.y), by: s.by === 'user' ? 'user' : 'layout' };
        }
    }
    const links = [];
    for (const l of Array.isArray(r.links) ? r.links : []) {
        if (!l || typeof l !== 'object' || !has(l.a) || !has(l.b) || l.a === l.b) continue;
        const days = finite(l.days) && l.days > 0 && l.days <= 365 ? round4(l.days) : 0;
        const dir = typeof l.dir === 'string' && DIRS.has(l.dir.trim().toLowerCase()) ? l.dir.trim().toLowerCase() : '';
        if (!days && !dir) continue;
        links.push({ a: l.a, b: l.b, days, dir });
        if (links.length >= 400) break;
    }
    return {
        scale: typeof r.scale === 'string' && ATLAS_SCALES[r.scale] ? r.scale : '',
        unit: typeof r.unit === 'string' && ATLAS_UNITS[r.unit] ? r.unit : 'mi',
        pace: finite(r.pace) && r.pace > 0 && r.pace <= 10000 ? round4(r.pace) : 0,
        spots,
        links,
        notes: typeof r.notes === 'string' ? r.notes.replace(/\r\n?/g, '\n').trim().slice(0, 4000) : '',
        locked: r.locked === true,
    };
}

/** The atlas as the pack file carries it: nothing for an atlas that says nothing. */
export function atlasToRaw(atlas) {
    const a = normalizeAtlas(atlas);
    const out = {};
    if (a.scale) out.scale = a.scale;
    if (a.unit !== 'mi') out.unit = a.unit;
    if (a.pace) out.pace = a.pace;
    if (Object.keys(a.spots).length) out.spots = a.spots;
    if (a.links.length) out.links = a.links;
    if (a.notes) out.notes = a.notes;
    if (a.locked) out.locked = true;
    return Object.keys(out).length ? out : null;
}

const placesOf = (pack) => (pack && Array.isArray(pack.places) ? pack.places : []);

function spiral(center, index, step, turn) {
    const r = step * Math.sqrt(index + 0.5);
    const t = index * GOLDEN + turn * Math.PI * 2;
    return { x: round4(center.x + r * Math.cos(t)), y: round4(center.y + r * Math.sin(t)) };
}

/**
 * A spot the layout would give every place of the pack: what Place all
 * proposes (D145). A root is the n-th point of the world's spiral, a child
 * the n-th point of its parent's; n is the place's index among its
 * siblings in the pack's order, so a place appended later moves nothing.
 * A spot the world carries of its own (`atlas.spots`) is kept.
 * @returns {Map<string, { x: number, y: number, by: 'layout'|'user', depth: number, parent: string, root: string }>}
 */
export function layoutAtlas(pack) {
    const places = placesOf(pack);
    const atlas = pack && pack.atlas ? pack.atlas : null;
    const stored = atlas && atlas.spots && typeof atlas.spots === 'object' ? atlas.spots : {};
    const byId = new Map(places.map(p => [p.id, p]));
    const kids = new Map();
    for (const p of places) {
        const key = p.parent && byId.has(p.parent) ? p.parent : '';
        if (!kids.has(key)) kids.set(key, []);
        kids.get(key).push(p);
    }
    const out = new Map();
    const lay = (p, index, center, depth, root) => {
        const s = stored[p.id];
        const step = STEPS[Math.min(depth, STEPS.length - 1)];
        const at = s && finite(s.x) && finite(s.y) ? { x: s.x, y: s.y } : spiral(center, index, step, hash01(depth ? p.parent : 'world'));
        out.set(p.id, { x: at.x, y: at.y, by: s && s.by === 'user' ? 'user' : 'layout', depth, parent: depth ? p.parent : '', root: root || p.id });
        (kids.get(p.id) || []).forEach((c, i) => lay(c, i, at, depth + 1, root || p.id));
    };
    (kids.get('') || []).forEach((p, i) => lay(p, i + 1, { x: 0, y: 0 }, 0, ''));
    return out;
}

/** A blob's outline: `points` points around its centre, waved by three sines hashed from its id. */
export function regionOutline(id, center, radius, points = 40) {
    const p1 = hash01(`${id}/1`) * Math.PI * 2;
    const p2 = hash01(`${id}/2`) * Math.PI * 2;
    const p3 = hash01(`${id}/3`) * Math.PI * 2;
    const pts = [];
    for (let i = 0; i < points; i++) {
        const t = (i / points) * Math.PI * 2;
        const r = radius * (1 + 0.11 * Math.sin(3 * t + p1) + 0.07 * Math.sin(5 * t + p2) + 0.04 * Math.sin(9 * t + p3));
        pts.push([round4(center.x + r * Math.cos(t)), round4(center.y + r * Math.sin(t))]);
    }
    return pts;
}

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/** A minimum spanning tree over points (Prim): pairs of indexes. */
function spanningTree(points) {
    const n = points.length;
    if (n < 2) return [];
    const inTree = new Array(n).fill(false);
    const best = new Array(n).fill(Infinity);
    const from = new Array(n).fill(-1);
    const edges = [];
    best[0] = 0;
    for (let k = 0; k < n; k++) {
        let u = -1;
        for (let i = 0; i < n; i++) if (!inTree[i] && (u < 0 || best[i] < best[u])) u = i;
        inTree[u] = true;
        if (from[u] >= 0) edges.push([from[u], u]);
        for (let v = 0; v < n; v++) {
            if (inTree[v]) continue;
            const d = dist(points[u], points[v]);
            if (d < best[v]) { best[v] = d; from[v] = u; }
        }
    }
    return edges;
}

// ─── Rooms fold into their building (D152) ──────────────────────────────────

const ROOM_RE = /^(?:the\s+)?((?:(?:master|guest|spare|main|back|front|upstairs|downstairs|my|her|his|their|our|your|[\p{L}'’]+['’]s)\s+)*(?:bed\s?room|bath\s?room|kitchen|living\s?room|dining\s?room|hallway|hall|corridor|closet|attic|basement|cellar|porch|balcony|garage|study|pantry|laundry|staircase|stairs|stairwell|foyer|entrance|entryway|doorway|door|window|wall|corner|floor|ceiling|roof|bed|couch|sofa|table|desk|counter|shower|tub|lobby|backyard|yard|patio|deck|loft|nursery|lounge|toilet|restroom|washroom|upstairs|downstairs|room))(?![\p{L}])/iu;
const PREP_RE = /^(?:on|by|near|at|in|inside|outside|behind|under|beside|against|next to|in front of|across from|above|below)\s/i;
const norm = (t) => clean(t, 120).toLowerCase().replace(/^the\s+/, '').replace(/[’]/g, "'");
const locSlug = (t) => clean(t, 80).toLowerCase().replace(/[^\p{L}\p{M}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '');
const capital = (t) => (t ? t[0].toUpperCase() + t.slice(1) : t);

/** A location's parts: "Mara's House - Bedroom (by the window)" → ["Mara's House", "Bedroom", "by the window"]. A hyphen splits only between spaces. */
export function labelSegments(label) {
    return clean(label, 160).split(/\s+[-–—]\s+|\s*[|>/:,;()[\]]+\s*/).map(s => s.trim()).filter(Boolean);
}

/** The room a part names, as a key ("the master bed room" → "master bedroom"); '' when it names no room. */
export function roomKey(segment) {
    const m = ROOM_RE.exec(clean(segment, 120));
    return m ? m[1].toLowerCase().replace(/[’]/g, "'").replace(/\b(bed|bath|living|dining)\s(room)\b/g, '$1$2').replace(/\s+/g, ' ') : '';
}

const roomish = (segment) => !!roomKey(segment) || PREP_RE.test(segment);

/**
 * The story's places folded (D152): a room, a wall, a corner of a place
 * does not stand as a place of its own. A location with a room in it
 * ("Mara's House, Bedroom") folds into the part that is not a room; a
 * part two locations share ("Saltport, the Quay", "Saltport, the Market")
 * is their place; a location that is only a room ("Bedroom", "bedroom on
 * the wall") folds with the others of that room. Anything else stands as
 * it is. One entry per place: its id (`loc:` and the place's name), its
 * label, the locations folded into it, the rooms named.
 * @param {Array<{ id: string, label: string }>} list
 */
export function foldPlaces(list) {
    const rows = (Array.isArray(list) ? list : []).filter(p => p && p.id).map(p => {
        const segs = labelSegments(p.label || '');
        return { id: p.id, label: clean(p.label, 80) || p.id, segs, plain: segs.filter(s => !roomish(s)) };
    });
    const freq = new Map();
    for (const r of rows) for (const k of new Set(r.plain.map(norm))) freq.set(k, (freq.get(k) || 0) + 1);
    const folded = rows.map(r => {
        let key = '';
        let label = '';
        let room = '';
        if (r.plain.length && r.segs.length > 1) {
            const top = [...r.plain].sort((a, b) => (freq.get(norm(b)) || 0) - (freq.get(norm(a)) || 0))[0];
            if (r.plain.length < r.segs.length || (freq.get(norm(top)) || 0) >= 2) { key = norm(top); label = top; room = r.segs.filter(s => s !== top).join(', '); }
        } else if (!r.plain.length && r.segs.length) {
            const k = roomKey(r.segs[0]);
            if (k) { key = k; label = capital(k); room = norm(r.label) === k ? '' : r.label; }
        }
        if (!key) { key = norm(r.label); label = r.label; }
        return { r, key, label, room };
    });
    // A place's id: the id of the location that names it plainly when there is one (the spot put under it stays its own), else `loc:` and its name.
    const plainId = new Map();
    for (const f of folded) if (norm(f.r.label) === f.key && !plainId.has(f.key)) plainId.set(f.key, f.r.id);
    const groups = new Map();
    for (const { r, key, label, room } of folded) {
        const id = plainId.get(key) || (locSlug(key) ? `loc:${locSlug(key)}` : r.id);
        if (!groups.has(id)) groups.set(id, { id, label, members: [], rooms: [] });
        const g = groups.get(id);
        if (norm(r.label) === key) g.label = r.label;    // the place named plainly gives the name
        g.members.push({ id: r.id, label: r.label });
        if (room && !g.rooms.some(x => norm(x) === norm(room))) g.rooms.push(room);
    }
    return [...groups.values()];
}

// ─── The book: what the player did to the map, per chat (D151) ──────────────

const MAX_MADE = 200;
const idOk = (id) => typeof id === 'string' && id.length > 0 && id.length <= 160;

/** The chat's book made safe: where things were put, what was deleted, what was merged into what, the markers made by hand, the names, kinds and notes changed. */
export function normalizeBook(raw) {
    const r = raw && typeof raw === 'object' ? raw : {};
    const spots = {};
    if (r.spots && typeof r.spots === 'object') for (const [id, s] of Object.entries(r.spots)) { if (idOk(id) && s && finite(s.x) && finite(s.y) && Math.abs(s.x) <= 1e5 && Math.abs(s.y) <= 1e5) spots[id] = { x: round4(s.x), y: round4(s.y) }; }
    const gone = [...new Set((Array.isArray(r.gone) ? r.gone : []).filter(idOk))].slice(0, 600);
    const merged = {};
    if (r.merged && typeof r.merged === 'object') for (const [a, b] of Object.entries(r.merged)) { if (idOk(a) && idOk(b) && a !== b) merged[a] = b; }
    const made = [];
    const seen = new Set();
    for (const m of Array.isArray(r.made) ? r.made : []) {
        if (!m || typeof m !== 'object' || !idOk(m.id) || !m.id.startsWith('pin:') || seen.has(m.id)) continue;
        seen.add(m.id);
        made.push({ id: m.id, label: clean(m.label, 80) || 'New place', kind: cleanKind(m.kind), note: clean(m.note, 300) });
        if (made.length >= MAX_MADE) break;
    }
    const edits = {};
    if (r.edits && typeof r.edits === 'object') for (const [id, e] of Object.entries(r.edits)) {
        if (!idOk(id) || !e || typeof e !== 'object') continue;
        const one = {};
        if (clean(e.label, 80)) one.label = clean(e.label, 80);
        if (cleanKind(e.kind)) one.kind = cleanKind(e.kind);
        if (typeof e.note === 'string') one.note = clean(e.note, 300);
        if (Object.keys(one).length) edits[id] = one;
    }
    return { scale: typeof r.scale === 'string' && ATLAS_SCALES[r.scale] ? r.scale : '', spots, gone, merged, made, edits };
}

/** A marker put at a spot (or moved there). */
export function placeAt(book, id, spot) {
    const b = normalizeBook(book);
    if (!idOk(id) || !spot || !finite(spot.x) || !finite(spot.y)) return b;
    return { ...b, spots: { ...b.spots, [id]: { x: round4(spot.x), y: round4(spot.y) } } };
}

/** A marker taken off the map: back to the tray. */
export function unplace(book, id) {
    const b = normalizeBook(book);
    const { [id]: _gone, ...spots } = b.spots;
    return { ...b, spots };
}

/** A marker made by hand at a spot: the book and the new marker's id. */
export function addPin(book, { label = 'New place', kind = '', note = '', x = 0, y = 0 } = {}) {
    const b = normalizeBook(book);
    const base = `pin:${locSlug(label) || 'place'}`;
    let id = base;
    for (let n = 2; b.made.some(m => m.id === id) || b.gone.includes(id); n++) id = `${base}-${n}`;
    const next = { ...b, made: [...b.made, { id, label: clean(label, 80) || 'New place', kind: cleanKind(kind), note: clean(note, 300) }] };
    return { book: finite(x) && finite(y) ? placeAt(next, id, { x, y }) : next, id };
}

/** A marker deleted for good: one made by hand is forgotten; any other is kept in `gone`, so the story naming it again does not bring it back. What was merged into it is let go. */
export function removeMarker(book, id) {
    const b = normalizeBook(book);
    const { [id]: _s, ...spots } = b.spots;
    const { [id]: _e, ...edits } = b.edits;
    const merged = Object.fromEntries(Object.entries(b.merged).filter(([a, to]) => a !== id && to !== id));
    if (id.startsWith('pin:')) return { ...b, spots, edits, merged, made: b.made.filter(m => m.id !== id) };
    return { ...b, spots, edits, merged, gone: b.gone.includes(id) ? b.gone : [...b.gone, id] };
}

/** A deleted marker brought back (to the tray). */
export function restoreMarker(book, id) {
    const b = normalizeBook(book);
    return { ...b, gone: b.gone.filter(x => x !== id) };
}

/** Where a merge ends: the last marker in the chain from `id` (itself when it is merged into nothing). */
export function mergeTarget(book, id) {
    const merged = book && book.merged ? book.merged : {};
    let cur = id;
    for (let i = 0; i < 12 && merged[cur]; i++) cur = merged[cur];
    return cur;
}

/** One marker merged into another: the first leaves the map and its names, people and visits count at the second. A merge that would loop is refused (the book comes back as it was). */
export function mergeInto(book, from, to) {
    const b = normalizeBook(book);
    if (!idOk(from) || !idOk(to) || from === to || mergeTarget(b, to) === from) return b;
    const { [from]: _s, ...spots } = b.spots;
    return { ...b, spots, merged: { ...b.merged, [from]: to } };
}

/** A merge undone: the marker stands for itself again (in the tray). */
export function unmerge(book, from) {
    const b = normalizeBook(book);
    const { [from]: _m, ...merged } = b.merged;
    return { ...b, merged };
}

/** A marker's name, kind or note changed. */
export function editMarker(book, id, { label, kind, note } = {}) {
    const b = normalizeBook(book);
    if (!idOk(id)) return b;
    if (id.startsWith('pin:')) return { ...b, made: b.made.map(m => (m.id === id ? { ...m, ...(clean(label, 80) ? { label: clean(label, 80) } : {}), ...(kind !== undefined ? { kind: cleanKind(kind) } : {}), ...(note !== undefined ? { note: clean(note, 300) } : {}) } : m)) };
    const one = { ...(b.edits[id] || {}) };
    if (clean(label, 80)) one.label = clean(label, 80);
    if (kind !== undefined) { if (cleanKind(kind)) one.kind = cleanKind(kind); else delete one.kind; }
    if (note !== undefined) one.note = clean(note, 300);
    return { ...b, edits: { ...b.edits, [id]: one } };
}

/** The map's scale chosen by hand ('' = the world's own, or a guess). */
export function withScale(book, scale) {
    const b = normalizeBook(book);
    return { ...b, scale: ATLAS_SCALES[scale] ? scale : '' };
}

// ─── The model ──────────────────────────────────────────────────────────────

export const LAND_RADIUS = 1.5;     // the land a lone marker stands on, in layout units
export const CANVAS = 9;            // the empty map reaches this far from its middle, so there is room to place things

/** The story's own places (D93): the visited rows the pack does not name and the places people were last seen at, with a `loc:` id. */
function storyPlaces(pack, state) {
    const ids = new Set(placesOf(pack).map(p => p.id));
    const out = [];
    const seen = new Set();
    const add = (id, label, image) => { if (typeof id === 'string' && id.startsWith('loc:') && !ids.has(id) && !seen.has(id)) { seen.add(id); out.push({ id, label: clean(label, 80) || capital(clean(id.slice(4).replace(/-+/g, ' '), 80)), image: image || '' }); } };
    for (const v of (state && Array.isArray(state.visited) ? state.visited : [])) if (v && !v.packId) add(v.id, v.label, v.image);
    const where = state && state.where && typeof state.where === 'object' ? state.where : {};
    for (const at of Object.values(where)) add(String(at || ''), '', '');
    return out;
}

/** The place a path (a place path "a/b/c", an id, a loc id) stands at: the deepest pack place in it, else the loc id itself. */
function keyOf(ids, path) {
    const text = String(path || '');
    if (!text) return '';
    if (text.startsWith('loc:')) return text;
    const parts = text.split('/');
    for (let i = parts.length - 1; i >= 0; i--) if (ids.has(parts[i])) return parts[i];
    return '';
}

/** Where the party is, as a place's own id (before folding and merging): the player's entry in `where` when there is one, else the newest visited place. */
export function partyKey(pack, state, player = '') {
    const ids = new Set(placesOf(pack).map(p => p.id));
    const where = state && state.where && typeof state.where === 'object' ? state.where : {};
    if (player && where[player]) { const k = keyOf(ids, where[player]); if (k) return k; }
    const list = state && Array.isArray(state.visited) ? state.visited : [];
    const here = list.find(e => e && Array.isArray(e.visits) && e.visits.length) || list[0] || null;
    if (!here) return '';
    if (here.packId) return keyOf(ids, here.path || here.packId) || (ids.has(here.packId) ? here.packId : '');
    return String(here.id || '');
}

/** The scale in force: the book's, else the world's own, else a guess (a town for a world with one region or none, else a region). */
export function scaleOf(pack, book = null) {
    if (book && ATLAS_SCALES[book.scale]) return book.scale;
    const a = pack && pack.atlas;
    if (a && ATLAS_SCALES[a.scale]) return a.scale;
    return placesOf(pack).filter(p => !p.parent).length > 1 ? 'region' : 'town';
}

/** The world's measure: the unit, what a layout unit is in it, and the pace (units a day). */
export function measureOf(pack, book = null) {
    const a = pack && pack.atlas ? pack.atlas : null;
    const unit = a && ATLAS_UNITS[a.unit] ? a.unit : 'mi';
    const scale = scaleOf(pack, book);
    const per = round4(ATLAS_SCALES[scale].per * ATLAS_UNITS[unit]);
    const pace = a && finite(a.pace) && a.pace > 0 ? a.pace : round4(DEFAULT_PACE_MILES * ATLAS_UNITS[unit]);
    return { unit, per, pace, scale };
}

/** The little drawings a terrain is told by, as lines in layout units around a point (D153): a peak, a tree, a dune, reeds, a tuft. */
function glyphAt(terrain, x, y, s) {
    const p = (dx, dy) => [round4(x + dx * s), round4(y + dy * s)];
    if (terrain === 'mountains' || terrain === 'snow') return [[p(-1, 0.6), p(0, -0.8), p(1, 0.6)], [p(0, -0.8), p(0.3, 0.1), p(0.1, 0.6)]];
    if (terrain === 'forest') return [[p(0, -0.9), p(0.45, -0.5), p(0.5, 0), p(0, 0.2), p(-0.5, 0), p(-0.45, -0.5), p(0, -0.9)], [p(0, 0.2), p(0, 0.7)]];
    if (terrain === 'desert') return [[p(-1, 0.2), p(-0.5, -0.25), p(0, -0.35), p(0.5, -0.25), p(1, 0.2)]];
    if (terrain === 'swamp') return [[p(-0.8, 0.3), p(0.8, 0.3)], [p(-0.4, 0.3), p(-0.5, -0.5)], [p(0, 0.3), p(0, -0.7)], [p(0.4, 0.3), p(0.5, -0.5)]];
    return [[p(-0.35, -0.4), p(0, 0.3), p(0.35, -0.4)]];
}

/**
 * What the Atlas draws (D151–D153). Nothing stands on the map by itself:
 * a place is a marker once it has a spot (the book's, or the world's own),
 * and waits in the tray until then. Rooms fold into their building,
 * merged markers into their target, deleted ones are left out. The land
 * is drawn around the markers; a region of the world is a named blob
 * around its placed places.
 * @param {object} o
 * @param {object} o.pack            the world (normalised)
 * @param {object|null} o.state      the world state: who is where, what was visited
 * @param {string} o.player          the player's name
 * @param {object|null} o.book       the chat's book (normalizeBook)
 * @param {Object<string,{emoji?:string,text?:string}>} o.weather  by region id or marker id
 * @returns {{ markers: Array, tray: Array, deleted: Array, regions: Array, land: Array, routes: Array, party: string, partyInTray: string, bounds: object, measure: object, empty: boolean }}
 */
export function atlasModel({ pack, state = null, player = '', weather = {}, book = null } = {}) {
    const bk = normalizeBook(book);
    const places = placesOf(pack);
    const byId = new Map(places.map(p => [p.id, p]));
    const ids = new Set(byId.keys());
    const world = pack && pack.atlas && pack.atlas.spots ? pack.atlas.spots : {};
    const hasKids = new Set(places.filter(p => p.parent && ids.has(p.parent)).map(p => p.parent));

    // The candidates: the world's places (the rooms of a place folded into it), the story's own (folded), the ones made by hand.
    const cands = new Map();
    const alias = new Map();    // a folded place's id -> the marker that holds it
    const regionsOf = new Map();    // a root with places inside: a region, not a marker
    const make = (id, o) => { cands.set(id, { id, label: id, kind: '', note: '', image: '', source: 'story', region: '', regionLabel: '', rooms: [], names: [], ids: [id], ...o }); return cands.get(id); };
    for (const p of places) {
        if (!p.parent || !ids.has(p.parent)) {
            if (hasKids.has(p.id)) regionsOf.set(p.id, { id: p.id, label: p.label || p.id });
            else make(p.id, { label: p.label || p.id, kind: cleanKind(p.kind), note: p.note || '', image: p.image || '', source: 'world' });
            continue;
        }
        let top = p;
        let root = byId.get(p.parent);
        for (let guard = 0; root && root.parent && ids.has(root.parent) && guard < places.length; guard++) { top = root; root = byId.get(root.parent); }
        if (top === p) make(p.id, { label: p.label || p.id, kind: cleanKind(p.kind), note: p.note || '', image: p.image || '', source: 'world', region: root ? root.id : '', regionLabel: root ? root.label || root.id : '' });
        else alias.set(p.id, top.id);
    }
    for (const p of places) {
        const to = alias.get(p.id);
        const c = to ? cands.get(to) : null;
        if (c) { c.rooms.push(p.label || p.id); c.ids.push(p.id); }
    }
    const story = storyPlaces(pack, state);
    for (const g of foldPlaces(story)) {
        const c = make(g.id, { label: g.label, rooms: [...g.rooms], image: (story.find(s => g.members.some(m => m.id === s.id) && s.image) || {}).image || '' });
        c.ids = [...new Set([g.id, ...g.members.map(m => m.id)])];
        for (const m of g.members) if (m.id !== g.id) alias.set(m.id, g.id);
    }
    for (const m of bk.made) make(m.id, { label: m.label, kind: m.kind, note: m.note, source: 'pin' });

    // Deleted, merged, renamed.
    const gone = new Set(bk.gone);
    const hold = (id) => alias.get(id) || id;
    const resolve = (id) => {
        let cur = hold(id);
        for (let i = 0; i < 12 && bk.merged[cur]; i++) cur = hold(bk.merged[cur]);
        return cands.has(cur) && !gone.has(cur) ? cur : '';
    };
    const deleted = [];
    const live = new Map();
    for (const c of cands.values()) {
        const e = bk.edits[c.id];
        if (e) { if (e.label) c.label = e.label; if (e.kind) c.kind = e.kind; if (e.note !== undefined) c.note = e.note; }
        if (gone.has(c.id)) { deleted.push({ id: c.id, label: c.label }); continue; }
        live.set(c.id, c);
    }
    for (const c of [...live.values()]) {
        if (!bk.merged[c.id]) continue;
        const to = resolve(c.id);
        live.delete(c.id);
        if (!to || to === c.id || !live.has(to)) continue;
        const t = live.get(to);
        t.names.push({ id: c.id, label: c.label });
        for (const r of c.rooms) if (!t.rooms.includes(r)) t.rooms.push(r);
        for (const i of c.ids) if (!t.ids.includes(i)) t.ids.push(i);
        if (!t.image && c.image) t.image = c.image;
    }

    // Who is where, what was visited, where the party is.
    const visitedIds = new Set();
    for (const v of (state && Array.isArray(state.visited) ? state.visited : [])) { if (!v) continue; if (v.id) visitedIds.add(v.id); if (v.packId) visitedIds.add(v.packId); }
    const where = state && state.where && typeof state.where === 'object' ? state.where : {};
    const people = new Map();
    for (const [name, at] of Object.entries(where)) {
        if (player && name === player) continue;
        const key = resolve(keyOf(ids, at));
        if (!key) continue;
        if (!people.has(key)) people.set(key, []);
        people.get(key).push(name);
    }
    const partyAt = resolve(partyKey(pack, state, player));

    const spotOf = (c) => { for (const id of c.ids) { if (bk.spots[id]) return { ...bk.spots[id], by: 'user' }; } for (const id of c.ids) { const s = world[id]; if (s && finite(s.x) && finite(s.y)) return { x: s.x, y: s.y, by: 'world' }; } return null; };
    const markers = [];
    const tray = [];
    for (const c of live.values()) {
        const s = spotOf(c);
        const w = weather && (weather[c.id] || weather[c.region]) ? (weather[c.id] || weather[c.region]) : null;
        const one = {
            id: c.id, label: c.label, kind: c.kind || guessKind(c.label), note: c.note, image: c.image, source: c.source,
            region: c.region, regionLabel: c.regionLabel, rooms: c.rooms, names: c.names,
            visited: c.ids.some(i => visitedIds.has(i)), player: partyAt === c.id, people: people.get(c.id) || [],
            weather: w ? { emoji: clean(w.emoji, 8), text: clean(w.text, 120) } : null,
        };
        if (s) markers.push({ ...one, x: s.x, y: s.y, by: s.by });
        else tray.push(one);
    }
    tray.sort((a, b) => Number(b.player) - Number(a.player) || Number(b.visited) - Number(a.visited) || a.label.localeCompare(b.label));

    // A region of the world: a named blob around its placed places, with its terrain's drawings.
    const regions = [];
    for (const r of regionsOf.values()) {
        const own = markers.filter(m => m.region === r.id);
        if (!own.length) continue;
        const cx = round4(own.reduce((n, m) => n + m.x, 0) / own.length);
        const cy = round4(own.reduce((n, m) => n + m.y, 0) / own.length);
        const center = { x: cx, y: cy };
        const radius = round4(Math.max(...own.map(m => dist(m, center))) + LAND_RADIUS * 1.15);
        const terrain = guessTerrain(r.label);
        const glyphs = [];
        const count = Math.min(46, Math.round(radius * radius * 1.6));
        for (let i = 0; i < count; i++) {
            const t = hash01(`${r.id}/g${i}/a`) * Math.PI * 2;
            const rr = radius * 0.86 * Math.sqrt(hash01(`${r.id}/g${i}/r`));
            const at = { x: cx + rr * Math.cos(t), y: cy + rr * Math.sin(t) };
            if (own.some(m => dist(m, at) < 0.62) || Math.hypot(at.x - cx, at.y - cy) < 0.5) continue;
            glyphs.push(...glyphAt(terrain, at.x, at.y, 0.2));
        }
        regions.push({ id: r.id, label: r.label, terrain, x: cx, y: cy, radius, outline: regionOutline(r.id, center, radius), glyphs });
    }

    // The land: a blob under every marker and every region; drawn as one shore (atlasMap.js).
    const land = [
        ...regions.map(r => ({ id: r.id, x: r.x, y: r.y, radius: round4(r.radius * 1.18 + 0.4) })),
        ...markers.filter(m => !regions.some(r => r.id === m.region)).map(m => ({ id: m.id, x: m.x, y: m.y, radius: LAND_RADIUS })),
    ].map(b => ({ ...b, outline: regionOutline(`${b.id}/land`, b, b.radius, 28), ripple1: regionOutline(`${b.id}/land`, b, b.radius + 0.22, 28), ripple2: regionOutline(`${b.id}/land`, b, b.radius + 0.5, 28) }));

    // Paths (drawn, never measured: D141): a tree over the markers.
    const routes = spanningTree(markers).map(([a, b]) => ({ a: markers[a].id, b: markers[b].id, kind: 'road', points: [[markers[a].x, markers[a].y], [markers[b].x, markers[b].y]] }));

    let minX = -CANVAS, minY = -CANVAS, maxX = CANVAS, maxY = CANVAS;
    for (const b of land) { minX = Math.min(minX, b.x - b.radius - 3); minY = Math.min(minY, b.y - b.radius - 3); maxX = Math.max(maxX, b.x + b.radius + 3); maxY = Math.max(maxY, b.y + b.radius + 3); }
    return {
        markers, tray, deleted, regions, land, routes,
        party: partyAt && markers.some(m => m.id === partyAt) ? partyAt : '',
        partyInTray: partyAt && tray.some(m => m.id === partyAt) ? partyAt : '',
        bounds: { minX: round4(minX), minY: round4(minY), maxX: round4(maxX), maxY: round4(maxY) },
        measure: measureOf(pack, bk),
        empty: markers.length === 0 && tray.length === 0,
    };
}

/**
 * Where Place all would put what is in the tray (D145): a world's place
 * at the layout's spot when that is free, anything else on a spiral from
 * the middle, each at the first point far enough from everything
 * already there. The same tray gives the same spots.
 * @returns {Map<string, { x: number, y: number }>}
 */
export function suggestSpots(model, pack) {
    const laid = layoutAtlas(pack);
    const taken = (model && model.markers ? model.markers : []).map(m => ({ x: m.x, y: m.y }));
    const free = (at) => taken.every(t => dist(t, at) >= 1.3);
    const out = new Map();
    let n = 0;
    for (const t of (model && model.tray ? model.tray : [])) {
        let at = laid.has(t.id) && free(laid.get(t.id)) ? { x: laid.get(t.id).x, y: laid.get(t.id).y } : null;
        for (let guard = 0; !at && guard < 4000; guard++) { const s = spiral({ x: 0, y: 0 }, n++, 1.7, 0.1); if (free(s)) at = s; }
        if (!at) continue;
        taken.push(at);
        out.set(t.id, at);
    }
    return out;
}

/** The book with everything in the tray placed where `suggestSpots` says. */
export function placeAll(book, model, pack) {
    let b = normalizeBook(book);
    for (const [id, at] of suggestSpots(model, pack)) b = placeAt(b, id, at);
    return b;
}

/** The distance between two markers in the world's unit (D141): the straight line; null when either is not on the map. */
export function distanceBetween(model, aId, bId) {
    if (!model || !Array.isArray(model.markers)) return null;
    const a = model.markers.find(m => m.id === aId);
    const b = model.markers.find(m => m.id === bId);
    if (!a || !b) return null;
    return dist(a, b) * model.measure.per;
}

/** The hours a distance takes on foot at the world's pace. */
export function travelHours(distance, measure) {
    const pace = measure && measure.pace > 0 ? measure.pace : DEFAULT_PACE_MILES;
    return distance / (pace / TRAVEL_HOURS_A_DAY);
}

const UNIT_WORDS = { mi: ['mile', 'miles'], km: ['km', 'km'], league: ['league', 'leagues'] };

/** "3.2 miles" */
export function describeLength(distance, unit = 'mi') {
    const [one, many] = UNIT_WORDS[unit] || UNIT_WORDS.mi;
    const n = distance >= 100 ? Math.round(distance) : distance >= 10 ? Math.round(distance * 2) / 2 : Math.round(distance * 10) / 10;
    return `${n} ${n === 1 ? one : many}`;
}

/** "a few minutes", "about 20 minutes", "about 3 hours", "about 2 days" */
export function describeTime(hours) {
    if (!(hours > 0)) return 'no time at all';
    const minutes = hours * 60;
    if (minutes < 5) return 'a few minutes';
    if (minutes < 55) return `about ${Math.round(minutes / 5) * 5} minutes`;
    if (hours < TRAVEL_HOURS_A_DAY) { const h = Math.max(1, Math.round(hours)); return `about ${h === 1 ? 'an hour' : `${h} hours`}`; }
    const days = Math.round((hours / TRAVEL_HOURS_A_DAY) * 2) / 2;
    return `about ${days === 1 ? 'a day' : `${days} days`}`;
}

/** The line a card shows and the travel cut is told: "3.2 miles, about an hour on foot"; '' when the place is the party's or is off the map. */
export function describeDistance(model, fromId, toId) {
    if (!fromId || !toId || fromId === toId) return '';
    const d = distanceBetween(model, fromId, toId);
    if (d === null) return '';
    if (d < 0.05) return 'a few steps away';
    return `${describeLength(d, model.measure.unit)}, ${describeTime(travelHours(d, model.measure))} on foot`;
}

/** The markers a search and the switched-off kinds leave: the name, the note, the region, the rooms, the other names and the people are searched. */
export function filterMarkers(markers, { query = '', hidden = [] } = {}) {
    const off = new Set(hidden);
    const q = clean(query, 80).toLowerCase();
    return (Array.isArray(markers) ? markers : []).filter(m => {
        if (off.has(m.kind)) return false;
        if (!q) return true;
        return [m.label, m.note, m.regionLabel, ...(m.rooms || []), ...(m.names || []).map(n => n.label), ...(m.people || [])].some(t => String(t || '').toLowerCase().includes(q));
    });
}

/** The kinds on the map with their counts, in the list's order: { id, label, icon, count, visited }. */
export function kindCounts(markers) {
    const list = Array.isArray(markers) ? markers : [];
    return ATLAS_KINDS.map(k => {
        const of = list.filter(m => m.kind === k.id);
        return { ...k, count: of.length, visited: of.filter(m => m.visited).length };
    }).filter(k => k.count > 0);
}

/**
 * A raw world (the file's shape) with a place's spot set by hand
 * (`spot` = { x, y }, pinned: D145) or cleared (null: the layout's
 * again). A new object; a place id that is not there leaves it as it is.
 */
export function withSpot(raw, placeId, spot) {
    const r = raw && typeof raw === 'object' ? raw : {};
    if (!(Array.isArray(r.places) ? r.places : []).some(p => p && p.id === placeId)) return r;
    const atlas = r.atlas && typeof r.atlas === 'object' ? r.atlas : {};
    const spots = { ...(atlas.spots && typeof atlas.spots === 'object' ? atlas.spots : {}) };
    if (spot && finite(spot.x) && finite(spot.y)) spots[placeId] = { x: round4(spot.x), y: round4(spot.y), by: 'user' };
    else delete spots[placeId];
    return { ...r, atlas: { ...atlas, spots } };
}

// ─── The clean-up pass (D155): the AI proposes, the player approves ─────────

export const TIDY_MAX = 120;    // places sent in one pass

/** The places a pass looks over: the markers and the tray, numbered from 1 (the reply names them by number). */
export function tidyList(model) {
    const all = [...(model && model.markers ? model.markers : []), ...(model && model.tray ? model.tray : [])];
    return all.slice(0, TIDY_MAX).map((m, i) => ({ n: i + 1, id: m.id, label: m.label, rooms: m.rooms || [], people: m.people || [], placed: Number.isFinite(m.x) }));
}

/** The request: the numbered places, and what to send back. */
export function buildTidyPrompt({ model, world = '' } = {}) {
    const list = tidyList(model);
    const lines = list.map(p => `${p.n}. ${p.label}${p.rooms.length ? ` (inside it: ${p.rooms.slice(0, 8).join('; ')})` : ''}`).join('\n');
    const system = [
        'You tidy the list of places on a story\'s map. The list was gathered automatically from the story, so it holds duplicates: the same place under two wordings, a room or a corner listed apart from its building, a passing description that is not a place at all.',
        'Reply with one JSON object and nothing else: {"merge":[{"from":<number>,"into":<number>,"why":"<a few words>"}],"delete":[{"id":<number>,"why":"<a few words>"}]}',
        'Rules: "merge" when two entries are the same place, or one is a part of the other (a room, a doorway, a piece of furniture): "from" is the entry that goes, "into" the one that stays (keep the building, the fuller or more proper name). "delete" only what is not a place (a vague description, a moment, "nowhere", "unknown"). Leave everything else alone: two different places stay two places even when their names are alike. Use only the numbers given. An entry appears at most once as "from" or "id". If nothing needs tidying, reply {"merge":[],"delete":[]}.',
    ].join('\n');
    const user = `${world ? `The story's world: ${clean(world, 120)}\n\n` : ''}The places:\n${lines || '(none)'}`;
    return { system, user, count: list.length };
}

/**
 * The reply read: the first JSON object in it (fenced or bare), its
 * merges and deletions kept when they name places of the list, each
 * place used once. Each proposal carries the ids and the names it is
 * about, for the player to read.
 * @returns {{ ok: boolean, items: Array<{ kind: 'merge'|'delete', id: string, label: string, to?: string, toLabel?: string, why: string }>, error: string }}
 */
export function parseTidy(text, model) {
    const list = tidyList(model);
    const byN = new Map(list.map(p => [p.n, p]));
    const raw = String(text ?? '');
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    let obj = null;
    if (start >= 0 && end > start) { try { obj = JSON.parse(raw.slice(start, end + 1)); } catch (e) { obj = null; } }
    if (!obj || typeof obj !== 'object') return { ok: false, items: [], error: 'The reply was not the JSON asked for.' };
    const num = (v) => { const n = typeof v === 'string' && /^\d+$/.test(v.trim()) ? Number(v) : v; return Number.isInteger(n) ? n : 0; };
    const used = new Set();
    const items = [];
    for (const m of Array.isArray(obj.merge) ? obj.merge : []) {
        const from = byN.get(num(m && m.from));
        const into = byN.get(num(m && m.into));
        if (!from || !into || from.id === into.id || used.has(from.id)) continue;
        used.add(from.id);
        items.push({ kind: 'merge', id: from.id, label: from.label, to: into.id, toLabel: into.label, why: clean(m.why, 120) });
    }
    for (const d of Array.isArray(obj.delete) ? obj.delete : []) {
        const p = byN.get(num(d && d.id));
        if (!p || used.has(p.id)) continue;
        used.add(p.id);
        items.push({ kind: 'delete', id: p.id, label: p.label, why: clean(d.why, 120) });
    }
    // A merge into something this pass also removes would lose both: such a merge is dropped.
    const going = new Set(items.map(i => i.id));
    return { ok: true, items: items.filter(i => i.kind !== 'merge' || !going.has(i.to)), error: '' };
}

/** One approved proposal done to the book. */
export function applyTidyItem(book, item) {
    if (!item) return normalizeBook(book);
    return item.kind === 'merge' ? mergeInto(book, item.id, item.to) : removeMarker(book, item.id);
}
