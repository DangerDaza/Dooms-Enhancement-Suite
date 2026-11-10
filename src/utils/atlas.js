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
    site: { per: 0.012, label: 'A building or dungeon' },
    town: { per: 0.1, label: 'A town or city' },
    region: { per: 15, label: 'A region' },
    world: { per: 60, label: 'A world' },
});
/** What the empty space of a map is (D158), in the select's order. */
export const ATLAS_GROUNDS = Object.freeze([
    { id: 'country', label: 'Open country' },
    { id: 'city', label: 'City streets' },
    { id: 'underground', label: 'Underground' },
    { id: 'indoors', label: 'Indoors' },
    { id: 'coast-n', label: 'Coast, sea to the north' },
    { id: 'coast-e', label: 'Coast, sea to the east' },
    { id: 'coast-s', label: 'Coast, sea to the south' },
    { id: 'coast-w', label: 'Coast, sea to the west' },
    { id: 'island', label: 'Islands' },
]);
const GROUND_IDS = new Set(ATLAS_GROUNDS.map(g => g.id));
const UNDER_RE = /\b(stairs?|cave|cavern|crypt|tomb|catacombs?|mine|dungeon|cellar|tunnels?|sewers?|under\w*|depths?|deep|pit|vault|warren|barrow|below|descent|level|landing)\b/i;
export const ATLAS_UNITS = Object.freeze({ mi: 1, km: 1.609344, league: 1 / 3 });    // one mile in each unit
export const DEFAULT_PACE_MILES = 24;     // a day on foot
export const TRAVEL_HOURS_A_DAY = 8;
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
    const inside = {};    // a place -> the place whose map it is on ('' = the top map, said outright)
    if (r.inside && typeof r.inside === 'object') for (const [id, to] of Object.entries(r.inside)) { if (idOk(id) && typeof to === 'string' && to.length <= 160 && to !== id) inside[id] = to; }
    const grounds = {};   // a layer's own ground
    if (r.grounds && typeof r.grounds === 'object') for (const [id, g] of Object.entries(r.grounds)) { if (idOk(id) && GROUND_IDS.has(g)) grounds[id] = g; }
    const scales = {};    // a layer's own scale
    if (r.scales && typeof r.scales === 'object') for (const [id, sc] of Object.entries(r.scales)) { if (idOk(id) && ATLAS_SCALES[sc]) scales[id] = sc; }
    return { scale: typeof r.scale === 'string' && ATLAS_SCALES[r.scale] ? r.scale : '', ground: GROUND_IDS.has(r.ground) ? r.ground : '', drawn: r.drawn === true, spots, inside, scales, grounds, gone, merged, made, edits };
}

/** A marker put at a spot (or moved there). With `layer` given, on that place's map ('' = the top map): what is dropped on a map belongs to it (D156). */
export function placeAt(book, id, spot, layer) {
    const b = normalizeBook(book);
    if (!idOk(id) || !spot || !finite(spot.x) || !finite(spot.y)) return b;
    const next = { ...b, spots: { ...b.spots, [id]: { x: round4(spot.x), y: round4(spot.y) } } };
    return typeof layer === 'string' && layer !== id ? { ...next, inside: { ...next.inside, [id]: layer } } : next;
}

/** A place moved onto another place's map ('' = the top map): it leaves the map it was on and waits in the new one's tray. Onto itself is refused. */
export function moveInto(book, id, layer) {
    const b = normalizeBook(book);
    if (!idOk(id) || typeof layer !== 'string' || layer === id) return b;
    const { [id]: _s, ...spots } = b.spots;
    return { ...b, spots, inside: { ...b.inside, [id]: layer } };
}

/** A marker taken off the map: back to the tray. */
export function unplace(book, id) {
    const b = normalizeBook(book);
    const { [id]: _gone, ...spots } = b.spots;
    return { ...b, spots };
}

/** A marker made by hand at a spot: the book and the new marker's id. */
export function addPin(book, { label = 'New place', kind = '', note = '', x = 0, y = 0, layer = '' } = {}) {
    const b = normalizeBook(book);
    const base = `pin:${locSlug(label) || 'place'}`;
    let id = base;
    for (let n = 2; b.made.some(m => m.id === id) || b.gone.includes(id); n++) id = `${base}-${n}`;
    const next = { ...b, made: [...b.made, { id, label: clean(label, 80) || 'New place', kind: cleanKind(kind), note: clean(note, 300) }] };
    return { book: finite(x) && finite(y) ? placeAt(next, id, { x, y }, typeof layer === 'string' ? layer : '') : next, id };
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

/** The drawn map chosen over the world's own picture (D154), or the picture again. */
export function withDrawn(book, drawn) {
    const b = normalizeBook(book);
    return { ...b, drawn: drawn === true };
}

/** A layer's scale chosen by hand ('' for the scale = the default again; `layer` '' = the top map). */
export function withScale(book, scale, layer = '') {
    const b = normalizeBook(book);
    if (!layer) return { ...b, scale: ATLAS_SCALES[scale] ? scale : '' };
    const { [layer]: _old, ...rest } = b.scales;
    return { ...b, scales: ATLAS_SCALES[scale] ? { ...rest, [layer]: scale } : rest };
}

/** A layer's ground chosen by hand ('' for the ground = the default again; `layer` '' = the top map). */
export function withGround(book, ground, layer = '') {
    const b = normalizeBook(book);
    if (!layer) return { ...b, ground: GROUND_IDS.has(ground) ? ground : '' };
    const { [layer]: _old, ...rest } = b.grounds;
    return { ...b, grounds: GROUND_IDS.has(ground) ? { ...rest, [layer]: ground } : rest };
}

/**
 * The ground in force on a layer (D158): the one the player chose for it,
 * else by the map's scale: open country for a world or a region, streets
 * for a town, and for a site the underground when the place is a ruin or
 * its name tells of one (a stair, a cave, a crypt), else indoors.
 */
export function groundOf(book, layer = '', { scale = 'town', label = '', kind = '' } = {}) {
    const b = book && typeof book === 'object' ? book : null;
    if (!layer && b && GROUND_IDS.has(b.ground)) return b.ground;
    if (layer && b && b.grounds && GROUND_IDS.has(b.grounds[layer])) return b.grounds[layer];
    if (scale === 'world' || scale === 'region') return 'country';
    if (scale === 'town') return 'city';
    return kind === 'ruin' || UNDER_RE.test(String(label || '')) ? 'underground' : 'indoors';
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

/**
 * The scale in force on a layer (D156): the one the player chose for it,
 * else for the top map the world's own or a guess (a region when places
 * hold maps of their own, else a town), a town one layer in, a site below
 * that.
 */
export function scaleOf(pack, book = null, layer = '', { depth = 0, layered = false } = {}) {
    const b = book && typeof book === 'object' ? book : null;
    if (!layer) {
        if (b && ATLAS_SCALES[b.scale]) return b.scale;
        const a = pack && pack.atlas;
        if (a && ATLAS_SCALES[a.scale]) return a.scale;
        return layered || placesOf(pack).some(p => p.parent) ? 'region' : 'town';
    }
    if (b && b.scales && ATLAS_SCALES[b.scales[layer]]) return b.scales[layer];
    return depth >= 2 ? 'site' : 'town';
}

/** A layer's measure: the unit, what a layout unit is in it, and the pace (units a day). */
export function measureOf(pack, book = null, layer = '', opts = {}) {
    const a = pack && pack.atlas ? pack.atlas : null;
    const unit = a && ATLAS_UNITS[a.unit] ? a.unit : 'mi';
    const scale = scaleOf(pack, book, layer, opts);
    const per = round4(ATLAS_SCALES[scale].per * ATLAS_UNITS[unit]);
    const pace = a && finite(a.pace) && a.pace > 0 ? a.pace : round4(DEFAULT_PACE_MILES * ATLAS_UNITS[unit]);
    return { unit, per, pace, scale };
}

/** The little drawings a terrain is told by, as lines in layout units around a point (D154): a peak, a tree, a dune, reeds, a tuft. */
function glyphAt(terrain, x, y, s) {
    const p = (dx, dy) => [round4(x + dx * s), round4(y + dy * s)];
    if (terrain === 'mountains' || terrain === 'snow') return [[p(-1, 0.6), p(0, -0.8), p(1, 0.6)], [p(0, -0.8), p(0.3, 0.1), p(0.1, 0.6)]];
    if (terrain === 'forest') return [[p(0, -0.9), p(0.45, -0.5), p(0.5, 0), p(0, 0.2), p(-0.5, 0), p(-0.45, -0.5), p(0, -0.9)], [p(0, 0.2), p(0, 0.7)]];
    if (terrain === 'desert') return [[p(-1, 0.2), p(-0.5, -0.25), p(0, -0.35), p(0.5, -0.25), p(1, 0.2)]];
    if (terrain === 'swamp') return [[p(-0.8, 0.3), p(0.8, 0.3)], [p(-0.4, 0.3), p(-0.5, -0.5)], [p(0, 0.3), p(0, -0.7)], [p(0.4, 0.3), p(0.5, -0.5)]];
    return [[p(-0.35, -0.4), p(0, 0.3), p(0.35, -0.4)]];
}

/**
 * What a ground draws in the empty space of a map (D158), as lines and
 * shapes in layout units over the bounds and a margin past them (the map
 * can be panned a little past its bounds). The same map draws the same
 * ground every time: everything is hashed from the layer's id.
 *   country      nothing: the land is the paper itself
 *   city         blocks: streets a unit apart, a little askew
 *   indoors      a floor's squares, half a unit apart
 *   coast-n/e/s/w  the sea past a waved shore on that side, with two ripples off it
 *   underground, island  nothing here: the chambers and the shores are the land's own blobs
 * @returns {{ lines: number[][][], sea: number[][]|null, ripples: number[][][] }}
 */
export function groundDecor(ground, seed, bounds, markers = []) {
    const out = { lines: [], sea: null, ripples: [] };
    const padX = (bounds.maxX - bounds.minX) * 2;    // the map can be panned well past its bounds (atlasMap.js)
    const padY = (bounds.maxY - bounds.minY) * 2;
    const x0 = bounds.minX - padX, x1 = bounds.maxX + padX, y0 = bounds.minY - padY, y1 = bounds.maxY + padY;
    const clear = (x, y, r) => markers.every(m => Math.hypot(m.x - x, m.y - y) >= r);
    if (ground === 'country') {
        // Plain land: the paper is the ground. (Tufts and hills were scattered here once; they read as stray marks.)
    } else if (ground === 'city' || ground === 'indoors') {
        const step = ground === 'city' ? 1 : 0.5;
        const tilt = ground === 'city' ? (hash01(`${seed}/tilt`) - 0.5) * 0.5 : 0;    // a city's blocks sit a little askew; a floor's squares are square
        const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
        const half = Math.max(x1 - x0, y1 - y0) * 0.6;
        const turn = ([x, y]) => [round4(cx + x * Math.cos(tilt) - y * Math.sin(tilt)), round4(cy + x * Math.sin(tilt) + y * Math.cos(tilt))];
        const n = Math.min(ground === 'city' ? 70 : 120, Math.ceil(half / step));
        for (let i = -n; i <= n; i++) {
            const off = i * step + (ground === 'city' ? (hash01(`${seed}/s${i}`) - 0.5) * 0.3 : 0);
            out.lines.push([turn([off, -half]), turn([off, half])]);
            const off2 = i * step + (ground === 'city' ? (hash01(`${seed}/t${i}`) - 0.5) * 0.3 : 0);
            out.lines.push([turn([-half, off2]), turn([half, off2])]);
        }
    } else if (ground.startsWith('coast-')) {
        const side = ground.slice(6);
        const along = side === 'n' || side === 's';
        // The shore stands past the farthest marker on that side, and no nearer the middle than a third of the canvas.
        const far = markers.length ? (side === 'n' ? Math.min(...markers.map(m => m.y)) : side === 's' ? Math.max(...markers.map(m => m.y)) : side === 'w' ? Math.min(...markers.map(m => m.x)) : Math.max(...markers.map(m => m.x))) : 0;
        const sign = side === 'n' || side === 'w' ? -1 : 1;
        const base = sign * Math.max(CANVAS * 0.35, sign * far + 2.6);
        const a0 = along ? x0 : y0, a1 = along ? x1 : y1;
        const edge = along ? (sign < 0 ? y0 : y1) : (sign < 0 ? x0 : x1);
        const p1 = hash01(`${seed}/sea1`) * Math.PI * 2, p2 = hash01(`${seed}/sea2`) * Math.PI * 2;
        const wave = (t, d) => base + sign * d + 0.55 * Math.sin(t * 0.55 + p1) + 0.28 * Math.sin(t * 1.3 + p2);
        const line = (d) => { const pts = []; for (let i = 0; i <= 80; i++) { const t = a0 + (a1 - a0) * i / 80; const v = round4(wave(t, d)); pts.push(along ? [round4(t), v] : [v, round4(t)]); } return pts; };
        const shore = line(0);
        out.sea = [...shore, along ? [round4(a1), round4(edge)] : [round4(edge), round4(a1)], along ? [round4(a0), round4(edge)] : [round4(edge), round4(a0)]];
        out.lines.push(shore);
        out.ripples = [line(0.25), line(0.55)];
    }
    return out;
}

/**
 * What the Atlas draws (D151–D156). The map is layered: every place
 * stands on one layer, the top map or the map inside another place
 * (a city's, a dungeon's), and `layer` says which one is drawn. Nothing
 * stands on a map by itself: a place is a marker once it has a spot, and
 * waits in the tray until then. Rooms fold into their building, merged
 * markers into their target, deleted ones are left out. A marker carries
 * what is inside it: how many places, the people, the party. The land is
 * drawn around the markers.
 * @param {object} o
 * @param {object} o.pack            the world (normalised)
 * @param {object|null} o.state      the world state: who is where, what was visited
 * @param {string} o.player          the player's name
 * @param {object|null} o.book       the chat's book (normalizeBook)
 * @param {string} o.layer           the place whose map is drawn; '' for the top map
 * @param {Object<string,{emoji?:string,text?:string}>} o.weather  by marker id
 */
export function atlasModel({ pack, state = null, player = '', weather = {}, book = null, layer = '' } = {}) {
    const bk = normalizeBook(book);
    const places = placesOf(pack);
    const byId = new Map(places.map(p => [p.id, p]));
    const ids = new Set(byId.keys());
    const world = pack && pack.atlas && pack.atlas.spots ? pack.atlas.spots : {};

    // The candidates: the world's places, the story's own (folded), the ones made by hand. Of the world's, a place
    // inside another is on that place's own map, unless it is a room of it or carries its name: then it folds into it.
    const cands = new Map();
    const alias = new Map();        // a folded place's id -> the place it folds into
    const packParent = new Map();   // a world's place -> the place whose map it is on
    const make = (id, o) => { cands.set(id, { id, label: id, kind: '', note: '', image: '', source: 'story', rooms: [], names: [], ids: [id], ...o }); return cands.get(id); };
    for (const p of places) {
        const up = p.parent && ids.has(p.parent) ? byId.get(p.parent) : null;
        if (up && (roomKey(p.label) || norm(p.label) === norm(up.label))) { alias.set(p.id, up.id); continue; }
        make(p.id, { label: p.label || p.id, kind: cleanKind(p.kind), note: p.note || '', image: p.image || '', source: 'world' });
        if (up) packParent.set(p.id, up.id);
    }
    const hold = (id) => { let cur = id; for (let i = 0; i < 12 && alias.has(cur); i++) cur = alias.get(cur); return cur; };
    for (const p of places) {
        if (!alias.has(p.id)) continue;
        const c = cands.get(hold(p.id));
        if (!c) continue;
        if (norm(p.label) !== norm(c.label) && !c.rooms.includes(p.label)) c.rooms.push(p.label || p.id);
        c.ids.push(p.id);
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

    // The layers (D156): whose map each place is on. The book's word, else the world's own nesting; a place whose
    // holder is gone, or that would hold itself, stands on the top map.
    const par = new Map();
    for (const c of live.values()) {
        const want = Object.prototype.hasOwnProperty.call(bk.inside, c.id) ? bk.inside[c.id] : (packParent.get(c.id) || '');
        const to = want ? resolve(want) : '';
        par.set(c.id, to && to !== c.id && live.has(to) ? to : '');
    }
    for (const id of par.keys()) {
        let cur = par.get(id);
        for (let i = 0; cur && i < 40; i++) { if (cur === id) { par.set(id, ''); break; } cur = par.get(cur) || ''; }
    }
    const chain = (id) => { const out = []; let cur = id; for (let i = 0; cur && i < 40; i++) { out.unshift(cur); cur = par.get(cur) || ''; } return out; };    // from the top map down to the place
    const cur = layer && live.has(layer) ? layer : '';
    const depth = cur ? chain(cur).length : 0;
    /** The place on the drawn layer that a place is, or is inside of; '' when it is on another branch. */
    const onLayer = (id) => { let c = id; for (let i = 0; c && i < 40; i++) { if ((par.get(c) || '') === cur) return c; c = par.get(c) || ''; } return ''; };
    const holds = new Map();
    for (const p of par.values()) if (p) holds.set(p, (holds.get(p) || 0) + 1);

    // Who is where, what was visited, where the party is.
    const visitedIds = new Set();
    for (const v of (state && Array.isArray(state.visited) ? state.visited : [])) { if (!v) continue; if (v.id) visitedIds.add(v.id); if (v.packId) visitedIds.add(v.packId); }
    const where = state && state.where && typeof state.where === 'object' ? state.where : {};
    const own = new Map();       // a place -> the people last seen at it
    for (const [name, at] of Object.entries(where)) {
        if (player && name === player) continue;
        const key = resolve(keyOf(ids, at));
        if (!key || !live.has(key)) continue;
        if (!own.has(key)) own.set(key, []);
        own.get(key).push(name);
    }
    const within = new Map();    // a place on the drawn layer -> the people at it or anywhere inside it
    for (const [key, list] of own) { const m = onLayer(key); if (!m) continue; if (!within.has(m)) within.set(m, []); within.get(m).push(...list); }
    const partyId = (() => { const k = resolve(partyKey(pack, state, player)); return k && live.has(k) ? k : ''; })();
    const partyOn = partyId ? onLayer(partyId) : '';
    const visitedWithin = new Set();
    for (const c of live.values()) if (c.ids.some(i => visitedIds.has(i))) { const m = onLayer(c.id); if (m) visitedWithin.add(m); }

    const spotOf = (c) => { for (const id of c.ids) { if (bk.spots[id]) return { ...bk.spots[id], by: 'user' }; } for (const id of c.ids) { const s = world[id]; if (s && finite(s.x) && finite(s.y)) return { x: s.x, y: s.y, by: 'world' }; } return null; };
    const describe = (c) => {
        const w = weather && weather[c.id] ? weather[c.id] : null;
        return {
            id: c.id, label: c.label, kind: c.kind || guessKind(c.label), note: c.note, image: c.image, source: c.source,
            rooms: c.rooms, names: c.names, holds: holds.get(c.id) || 0,
            visited: visitedWithin.has(c.id) || c.ids.some(i => visitedIds.has(i)),
            player: partyOn === c.id, partyInside: partyOn === c.id && partyId !== c.id,
            people: within.get(c.id) || own.get(c.id) || [],
            weather: w ? { emoji: clean(w.emoji, 8), text: clean(w.text, 120) } : null,
        };
    };
    const markers = [];
    const tray = [];
    for (const c of live.values()) {
        const at = par.get(c.id) || '';
        const s = spotOf(c);
        if (at === cur) { if (s) markers.push({ ...describe(c), x: s.x, y: s.y, by: s.by }); else tray.push({ ...describe(c), here: true }); }
        else if (cur && !at && !s && c.source !== 'world' && !chain(cur).includes(c.id)) tray.push({ ...describe(c), here: false });    // the story's own, on no map yet: it can be put on this one
    }
    tray.sort((a, b) => Number(b.here) - Number(a.here) || Number(b.player) - Number(a.player) || Number(b.visited) - Number(a.visited) || a.label.localeCompare(b.label));

    // Every live place, whatever map it is on: for the search, Merge, Move and the clean-up pass.
    const labelOfLayer = (id) => (id && live.has(id) ? live.get(id).label : '');
    const all = [...live.values()].map(c => ({ id: c.id, label: c.label, kind: c.kind || guessKind(c.label), rooms: c.rooms, names: c.names, people: own.get(c.id) || [], layer: par.get(c.id) || '', layerLabel: labelOfLayer(par.get(c.id) || ''), placed: !!spotOf(c), inside: chain(c.id).slice(0, -1) }));

    // A marker whose name tells a terrain stands on tinted ground with that terrain's drawings (D154).
    const regions = [];
    for (const m of markers) {
        const terrain = guessTerrain(m.label);
        if (terrain === 'plains') continue;
        const radius = round4(LAND_RADIUS * 0.84);
        const glyphs = [];
        for (let i = 0; i < 9; i++) {
            const t = hash01(`${m.id}/g${i}/a`) * Math.PI * 2;
            const rr = radius * (0.5 + 0.42 * hash01(`${m.id}/g${i}/r`));
            glyphs.push(...glyphAt(terrain, m.x + rr * Math.cos(t), m.y + rr * Math.sin(t), 0.17));
        }
        regions.push({ id: m.id, label: '', terrain, x: m.x, y: m.y, radius, outline: regionOutline(m.id, m, radius), glyphs });
    }

    // The land: a blob under every marker; drawn as one shore (atlasMap.js).
    const land = markers.map(m => ({ id: m.id, x: m.x, y: m.y, radius: LAND_RADIUS }))
        .map(b => ({ ...b, outline: regionOutline(`${b.id}/land`, b, b.radius, 28), ripple1: regionOutline(`${b.id}/land`, b, b.radius + 0.22, 28), ripple2: regionOutline(`${b.id}/land`, b, b.radius + 0.5, 28) }));

    // Paths (drawn, never measured: D141): a tree over the markers.
    const routes = spanningTree(markers).map(([a, b]) => ({ a: markers[a].id, b: markers[b].id, kind: 'road', points: [[markers[a].x, markers[a].y], [markers[b].x, markers[b].y]] }));

    let minX = -CANVAS, minY = -CANVAS, maxX = CANVAS, maxY = CANVAS;
    for (const b of land) { minX = Math.min(minX, b.x - b.radius - 3); minY = Math.min(minY, b.y - b.radius - 3); maxX = Math.max(maxX, b.x + b.radius + 3); maxY = Math.max(maxY, b.y + b.radius + 3); }
    const bounds = { minX: round4(minX), minY: round4(minY), maxX: round4(maxX), maxY: round4(maxY) };
    const measure = measureOf(pack, bk, cur, { depth, layered: holds.size > 0 });
    const ground = groundOf(bk, cur, { scale: measure.scale, label: labelOfLayer(cur), kind: cur ? (live.get(cur).kind || guessKind(live.get(cur).label)) : '' });
    return {
        layer: cur, layerLabel: labelOfLayer(cur), depth,
        trail: chain(cur).map(id => ({ id, label: labelOfLayer(id) })),
        markers, tray, deleted, regions, land, routes, all,
        party: partyOn && markers.some(m => m.id === partyOn) ? partyOn : '',
        partyInTray: partyOn && tray.some(m => m.id === partyOn) ? partyOn : '',
        partyId, partyLayer: partyId ? (par.get(partyId) || '') : '',
        bounds, measure, ground, decor: groundDecor(ground, cur || 'top', bounds, markers),
        empty: live.size === 0,
    };
}

/**
 * Where Place all would put what waits for this layer (D145): on a spiral
 * from the middle, each at the first point far enough from everything
 * already there. The same tray gives the same spots. What is on no map
 * yet (`here` false) is left where it is: Place all fills a map with its
 * own places.
 * @returns {Map<string, { x: number, y: number }>}
 */
export function suggestSpots(model) {
    const taken = (model && model.markers ? model.markers : []).map(m => ({ x: m.x, y: m.y }));
    const free = (at) => taken.every(t => dist(t, at) >= 1.3);
    const out = new Map();
    let n = 0;
    for (const t of (model && model.tray ? model.tray : [])) {
        if (t.here === false) continue;
        let at = null;
        for (let guard = 0; !at && guard < 4000; guard++) { const s = spiral({ x: 0, y: 0 }, n++, 1.7, 0.1); if (free(s)) at = s; }
        if (!at) continue;
        taken.push(at);
        out.set(t.id, at);
    }
    return out;
}

/** The book with everything that waits for this layer placed where `suggestSpots` says. */
export function placeAll(book, model) {
    let b = normalizeBook(book);
    for (const [id, at] of suggestSpots(model)) b = placeAt(b, id, at, model.layer);
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
        return [m.label, m.note, m.layerLabel, ...(m.rooms || []), ...(m.names || []).map(n => n.label), ...(m.people || [])].some(t => String(t || '').toLowerCase().includes(q));
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

/** The places a pass looks over: every place on every map, numbered from 1 (the reply names them by number). */
export function tidyList(model) {
    const all = model && Array.isArray(model.all) ? model.all : [];
    return all.slice(0, TIDY_MAX).map((m, i) => ({ n: i + 1, id: m.id, label: m.label, rooms: m.rooms || [], people: m.people || [], placed: !!m.placed, layerLabel: m.layerLabel || '' }));
}

/** The request: the numbered places, and what to send back. */
export function buildTidyPrompt({ model, world = '' } = {}) {
    const list = tidyList(model);
    const lines = list.map(p => `${p.n}. ${p.label}${p.layerLabel ? ` [in ${p.layerLabel}]` : ''}${p.rooms.length ? ` (inside it: ${p.rooms.slice(0, 8).join('; ')})` : ''}`).join('\n');
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
