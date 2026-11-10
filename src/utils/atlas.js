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
    { id: 'region', label: 'Regions', icon: 'fa-map' },
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
        made.push({ id: m.id, label: clean(m.label, 80) || 'New place', kind: cleanKind(m.kind), note: clean(m.note, 300), ...(m.loose === true ? { loose: true } : {}) });    // loose: not canon yet (D160)
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
    const pairs = (list) => { const out = []; const seen = new Set(); for (const r of Array.isArray(list) ? list : []) { const x = Array.isArray(r) ? r : [r && r.a, r && r.b]; if (!idOk(x[0]) || !idOk(x[1]) || x[0] === x[1]) continue; const pr = x[0] < x[1] ? [x[0], x[1]] : [x[1], x[0]]; const k = pr.join('|'); if (seen.has(k)) continue; seen.add(k); out.push(pr); if (out.length >= 600) break; } return out; };
    const roads = pairs(r.roads);    // roads the player drew (D164), each a pair of markers
    const cut = pairs(r.cut);        // roads the map drew by itself that the player took away
    const roadHours = {};    // a road's set travel time in hours (D165), by its pair "a|b"; it outranks the road's drawn length
    if (r.roadHours && typeof r.roadHours === 'object') for (const [key, h] of Object.entries(r.roadHours)) {
        const ends = String(key).split('|');
        if (ends.length !== 2 || !idOk(ends[0]) || !idOk(ends[1]) || ends[0] >= ends[1] || !finite(h) || h <= 0 || h > 100000) continue;
        roadHours[key] = Math.round(h * 1000) / 1000;
    }
    const grounds = {};   // a layer's own ground
    if (r.grounds && typeof r.grounds === 'object') for (const [id, g] of Object.entries(r.grounds)) { if (idOk(id) && GROUND_IDS.has(g)) grounds[id] = g; }
    const scales = {};    // a layer's own scale
    if (r.scales && typeof r.scales === 'object') for (const [id, sc] of Object.entries(r.scales)) { if (idOk(id) && ATLAS_SCALES[sc]) scales[id] = sc; }
    return { scale: typeof r.scale === 'string' && ATLAS_SCALES[r.scale] ? r.scale : '', ground: GROUND_IDS.has(r.ground) ? r.ground : '', drawn: r.drawn === true, spots, inside, scales, grounds, roads, cut, roadHours, gone, merged, made, edits };
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
export function addPin(book, { label = 'New place', kind = '', note = '', x = 0, y = 0, layer = '', loose = false } = {}) {
    const b = normalizeBook(book);
    const base = `pin:${locSlug(label) || 'place'}`;
    let id = base;
    for (let n = 2; b.made.some(m => m.id === id) || b.gone.includes(id); n++) id = `${base}-${n}`;
    const next = { ...b, made: [...b.made, { id, label: clean(label, 80) || 'New place', kind: cleanKind(kind), note: clean(note, 300), ...(loose ? { loose: true } : {}) }] };
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

/**
 * A road between two markers drawn or taken away (D164). Where the model
 * shows a road between them it goes, whoever drew it: the player's is
 * forgotten with its set time, and the pair is cut so the map does not
 * draw one there by itself. Where it shows none, one is drawn and the cut
 * undone.
 */
export function toggleRoad(book, a, b, model = null) {
    const bk = normalizeBook(book);
    if (!idOk(a) || !idOk(b) || a === b) return bk;
    const pr = a < b ? [a, b] : [b, a];
    const is = (x) => x[0] === pr[0] && x[1] === pr[1];
    const shown = model && Array.isArray(model.routes) ? model.routes.some(r => (r.a === a && r.b === b) || (r.a === b && r.b === a)) : false;
    if (shown) {
        const { [pr.join('|')]: _h, ...roadHours } = bk.roadHours;
        return { ...bk, roads: bk.roads.filter(x => !is(x)), cut: bk.cut.some(is) ? bk.cut : [...bk.cut, pr], roadHours };
    }
    return { ...bk, cut: bk.cut.filter(x => !is(x)), roads: bk.roads.some(is) ? bk.roads : [...bk.roads, pr] };
}

/**
 * A road given a travel time of its own (D165), in hours of travel: what
 * the card and Travel here go by, however far apart its two places are
 * drawn. The road is the player's from then on (a road the map drew is
 * kept when the map would redraw its roads). No hours, or none above
 * nothing, and the road goes by its length again.
 */
export function setRoadTime(book, a, b, hours) {
    const bk = normalizeBook(book);
    if (!idOk(a) || !idOk(b) || a === b) return bk;
    const pr = a < b ? [a, b] : [b, a];
    const is = (x) => x[0] === pr[0] && x[1] === pr[1];
    const key = pr.join('|');
    const { [key]: _old, ...rest } = bk.roadHours;
    const set = finite(hours) && hours > 0 && hours <= 100000;
    return { ...bk, cut: bk.cut.filter(x => !is(x)), roads: bk.roads.some(is) ? bk.roads : [...bk.roads, pr], roadHours: set ? { ...rest, [key]: Math.round(hours * 1000) / 1000 } : rest };
}

/** A place the AI added to fill out a map made canon (D160): it is the story's now, like any other. Or put back as not canon. */
export function setCanon(book, id, canon = true) {
    const b = normalizeBook(book);
    return { ...b, made: b.made.map(m => { if (m.id !== id) return m; const { loose: _l, ...rest } = m; return canon ? rest : { ...rest, loose: true }; }) };
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
 * The scale in force on a layer (D156, D163): the one the player chose for
 * it; else for the top map the world's own, or a guess (a region when it
 * holds regions or places that hold maps of their own, else a town); a region's own map is a region; a place's map is a town when it
 * stands on the top map or in a region, and a site below that.
 * `below` counts the places from the nearest region above down to the
 * layer (the layer itself is 1).
 */
export function scaleOf(pack, book = null, layer = '', { depth = 0, below = 0, layered = false, regions = false, kind = '' } = {}) {
    const b = book && typeof book === 'object' ? book : null;
    if (!layer) {
        if (b && ATLAS_SCALES[b.scale]) return b.scale;
        const a = pack && pack.atlas;
        if (a && ATLAS_SCALES[a.scale]) return a.scale;
        if (regions) return 'region';    // a map of regions reads at the scale a region's own map does, so a land is as wide on it as it is inside (D166)
        return layered || placesOf(pack).some(p => p.parent) ? 'region' : 'town';
    }
    if (b && b.scales && ATLAS_SCALES[b.scales[layer]]) return b.scales[layer];
    if (kind === 'region') return 'region';
    return (below || depth) >= 2 ? 'site' : 'town';
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
 *   country      woods (a patch of trees), ponds and open plain, at random, away from the places
 *   city         blocks: streets a unit apart, a little askew
 *   indoors      a floor's squares, half a unit apart
 *   coast-n/e/s/w  the sea past a waved shore on that side, with two ripples off it
 *   underground, island  nothing here: the chambers and the shores are the land's own blobs
 * `lands` are the outlines of the regions' lands on the map: nothing of the open country is drawn on them.
 * @returns {{ lines: number[][][], sea: number[][]|null, ripples: number[][][], woods: number[][][], trees: number[][][], ponds: number[][][] }}
 */
export function groundDecor(ground, seed, bounds, markers = [], lands = []) {
    const out = { lines: [], sea: null, ripples: [], woods: [], trees: [], ponds: [] };
    const padX = (bounds.maxX - bounds.minX) * 2;    // the map can be panned well past its bounds (atlasMap.js)
    const padY = (bounds.maxY - bounds.minY) * 2;
    const x0 = bounds.minX - padX, x1 = bounds.maxX + padX, y0 = bounds.minY - padY, y1 = bounds.maxY + padY;
    // Clear of every place by `r`, and off the regions' lands altogether (its middle and six points around it).
    const offLands = (x, y, r) => !lands.length || [[0, 0], [1, 0], [0.5, 0.87], [-0.5, 0.87], [-1, 0], [-0.5, -0.87], [0.5, -0.87]].every(([dx, dy]) => !lands.some(l => pointInPolygon(l, x + dx * r, y + dy * r)));
    const clear = (x, y, r) => markers.every(m => Math.hypot(m.x - x, m.y - y) >= r) && offLands(x, y, Math.max(0.6, r - 0.6));
    if (ground === 'country') {
        // Woods, ponds and open plain, at random over the land away from the places (D162). The land is cut into
        // squares; each is a wood (a patch of trees), a pond, or left open, by a hash of the map's id and the square's place.
        const cell = 5;
        // Over what the map can be panned across and no further (atlasMap.js: the canvas and half again on every side).
        const w = bounds.maxX - bounds.minX, h = bounds.maxY - bounds.minY;
        const c0 = Math.floor((bounds.minX - w * 1.5) / cell), c1 = Math.ceil((bounds.maxX + w * 1.5) / cell), r0 = Math.floor((bounds.minY - h * 1.5) / cell), r1 = Math.ceil((bounds.maxY + h * 1.5) / cell);
        for (let cx = c0; cx < c1; cx++) for (let cy = r0; cy < r1; cy++) {
            const id = `${seed}/q${cx},${cy}`;
            const pick = hash01(`${id}/k`);
            if (pick >= 0.56) continue;    // open plain
            const x = round4((cx + 0.25 + 0.5 * hash01(`${id}/x`)) * cell);
            const y = round4((cy + 0.25 + 0.5 * hash01(`${id}/y`)) * cell);
            if (pick < 0.11) {
                const r = 0.5 + 0.5 * hash01(`${id}/r`);
                if (clear(x, y, r + 1.5)) out.ponds.push(regionOutline(`${id}/pond`, { x, y }, r, 18));
                continue;
            }
            const r = 1 + 1.1 * hash01(`${id}/r`);
            if (!clear(x, y, r + 1.3)) continue;
            out.woods.push(regionOutline(`${id}/wood`, { x, y }, r, 22));
            const count = Math.round(3 + r * r * 1.8);
            for (let i = 0; i < count; i++) {
                const t = hash01(`${id}/t${i}/a`) * Math.PI * 2;
                const d = r * 0.86 * Math.sqrt(hash01(`${id}/t${i}/d`));
                const tx = x + d * Math.cos(t), ty = y + d * Math.sin(t);
                const sz = 0.2 + 0.1 * hash01(`${id}/t${i}/s`);
                const pt = (dx, dy) => [round4(tx + dx * sz), round4(ty + dy * sz)];
                out.trees.push([pt(0, -1), pt(0.5, -0.55), pt(0.55, -0.05), pt(0, 0.2), pt(-0.55, -0.05), pt(-0.5, -0.55), pt(0, -1)], [pt(0, 0.2), pt(0, 0.7)]);    // a crown and a trunk
            }
        }
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

// ─── Territories (D163): regions drawn as lands that share borders ─────────

export const TERRITORY_RADIUS = 4.2;    // how far a region's land reaches from its spot when no neighbour is nearer

/** A polygon cut by a half-plane: the part where a*x + b*y <= c (Sutherland–Hodgman). */
function clipHalf(poly, a, b, c) {
    const out = [];
    for (let i = 0; i < poly.length; i++) {
        const p = poly[i], q = poly[(i + 1) % poly.length];
        const dp = a * p[0] + b * p[1] - c, dq = a * q[0] + b * q[1] - c;
        if (dp <= 0) out.push(p);
        if ((dp < 0 && dq > 0) || (dp > 0 && dq < 0)) { const t = dp / (dp - dq); out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]); }
    }
    return out;
}

/** Whether a point is inside a polygon (even-odd). */
export function pointInPolygon(poly, x, y) {
    let c = false;
    for (let i = 0, j = (poly ? poly.length : 0) - 1; i < (poly ? poly.length : 0); j = i++) {
        const [xi, yi] = poly[i], [xj, yj] = poly[j];
        if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c;
    }
    return c;
}

/**
 * The bend a map's lands are drawn through (D167): a smooth push of every
 * point of the map, a little this way and that, read from the map's own
 * id. Straight borders come out curved and a round shore comes out
 * lumpy, the way lands lie along rivers and ridges rather than along
 * rulers; and since every outline is pushed by the same bend, borders
 * that were shared stay shared. The push never folds the map over itself
 * (its slope stays under 1), so no two points land on one.
 */
function bendOf(seed) {
    const terms = [[18, 1.1], [8, 0.28]].map(([wave, amp], i) => {
        const t1 = hash01(`${seed}/bend${i}/t1`) * Math.PI * 2, t2 = hash01(`${seed}/bend${i}/t2`) * Math.PI * 2;
        return { k: Math.PI * 2 / wave, amp, c1: Math.cos(t1), s1: Math.sin(t1), c2: Math.cos(t2), s2: Math.sin(t2), p1: hash01(`${seed}/bend${i}/p1`) * Math.PI * 2, p2: hash01(`${seed}/bend${i}/p2`) * Math.PI * 2 };
    });
    const push = (x, y) => {
        let dx = 0, dy = 0;
        for (const t of terms) { dx += t.amp * Math.sin((x * t.c1 + y * t.s1) * t.k + t.p1); dy += t.amp * Math.sin((x * t.c2 + y * t.s2) * t.k + t.p2); }
        return [dx, dy];
    };
    return {
        /** A point of the unbent map, where the bend puts it. */
        to: (x, y) => { const [dx, dy] = push(x, y); return [x + dx, y + dy]; },
        /** The point of the unbent map that the bend puts at (x, y). */
        from: (x, y) => { let ux = x, uy = y; for (let i = 0; i < 40; i++) { const [dx, dy] = push(ux, uy); const nx = x - dx, ny = y - dy; if (Math.abs(nx - ux) + Math.abs(ny - uy) < 1e-7) { ux = nx; uy = ny; break; } ux = nx; uy = ny; } return [ux, uy]; },
    };
}

/** The landmass before the bend: the ground around the (unbent) spots and `margin` further, its shore waved. */
function landmassRaw(list, margin, seed) {
    const reach = margin * 3;
    const minX = Math.min(...list.map(s => s.x)) - reach, maxX = Math.max(...list.map(s => s.x)) + reach;
    const minY = Math.min(...list.map(s => s.y)) - reach, maxY = Math.max(...list.map(s => s.y)) + reach;
    let poly = [[minX, minY], [maxX, minY], [maxX, maxY], [minX, maxY]];
    const K = 72;
    for (let k = 0; k < K; k++) {    // the hull of the spots, pushed out by the margin: cut from every side
        const t = (k / K) * Math.PI * 2;
        const dx = Math.cos(t), dy = Math.sin(t);
        poly = clipHalf(poly, dx, dy, Math.max(...list.map(s => s.x * dx + s.y * dy)) + margin);
    }
    const cx = list.reduce((n, s) => n + s.x, 0) / list.length, cy = list.reduce((n, s) => n + s.y, 0) / list.length;
    const ph = [1, 2, 3, 4].map(i => hash01(`${seed}/shore${i}`) * Math.PI * 2);
    const out = [];
    for (let i = 0; i < poly.length; i++) {
        const p = poly[i], q = poly[(i + 1) % poly.length];
        const steps = Math.max(1, Math.ceil(Math.hypot(q[0] - p[0], q[1] - p[1]) / 0.5));
        for (let k = 0; k < steps; k++) {
            const x = p[0] + (q[0] - p[0]) * k / steps, y = p[1] + (q[1] - p[1]) * k / steps;
            const d = Math.hypot(x - cx, y - cy) || 1;
            const f = 0.4 * Math.sin(x * 0.83 + ph[0]) * Math.cos(y * 0.71 + ph[1]) + 0.2 * Math.sin((x + y) * 1.9 + ph[2]) + 0.1 * Math.sin((x - y) * 3.7 + ph[3]);
            out.push([x + (x - cx) / d * f, y + (y - cy) / d * f]);
        }
    }
    return out;
}

/**
 * The landmass the regions of one map share (D166, D167): the ground
 * around all their spots and `margin` further, its shore waved, drawn
 * through the map's bend. One region gives a lumpy round land; more give
 * the land that holds them all, so regions far apart are still one
 * country. The shore is read from where each point of it is, not from
 * which regions there are, so a region added at one end leaves the far
 * shore as it was.
 */
export function landmassOutline(sites, margin = TERRITORY_RADIUS, seed = 'land') {
    const list = (Array.isArray(sites) ? sites : []).filter(s => s && finite(s.x) && finite(s.y));
    if (!list.length) return [];
    const bend = bendOf(seed);
    const raw = landmassRaw(list.map(s => { const [x, y] = bend.from(s.x, s.y); return { x, y }; }), margin, seed);
    return raw.map(([x, y]) => bend.to(x, y).map(round4));
}

/**
 * The lands of the regions on one map, each with the regions it borders
 * (D163, D166, D167). The landmass they share is cut between every two
 * regions along a line across the way from one to the other: not always
 * halfway, since a region holds a little more or less ground than its
 * neighbour (by its id), so the lands come out uneven as real ones are.
 * A border is waved along its length, the same from both sides. Then
 * everything is drawn through the map's bend. The lands tile the
 * landmass with nothing left over; every region borders its neighbours
 * however far apart their spots are; a region's spot is always on its
 * own land. The same spots give the same lands. With each land come the
 * borders it shares, one run of points for every neighbour, as they lie
 * along its outline (D168).
 * @param {Array<{ id: string, x: number, y: number }>} sites
 * @returns {Map<string, { outline: number[][], neighbours: string[], borders: Array<{ id: string, points: number[][] }> }>}
 */
export function territoryCells(sites, radius = TERRITORY_RADIUS, seed = 'land') {
    const out = new Map();
    const given = (Array.isArray(sites) ? sites : []).filter(s => s && finite(s.x) && finite(s.y));
    if (!given.length) return out;
    const bend = bendOf(seed);
    const list = given.map(s => { const [x, y] = bend.from(s.x, s.y); return { id: s.id, x, y, w: 0 }; });    // the spots as they are before the bend
    // How much ground a region holds beyond the line halfway: by its id, and never so much that a neighbour's spot
    // (or its own) would fall on the wrong side: within a part of the way to the nearest region.
    for (const s of list) {
        let near = Infinity;
        for (const o of list) if (o !== s) near = Math.min(near, Math.hypot(o.x - s.x, o.y - s.y));
        s.w = near === Infinity ? 0 : (hash01(`${s.id}/ground`) * 2 - 1) * 0.18 * near * near;
    }
    const pd = (pt, s) => (pt[0] - s.x) * (pt[0] - s.x) + (pt[1] - s.y) * (pt[1] - s.y) - s.w;    // how far a point is from a region, its ground counted
    const land = landmassRaw(list, radius, seed);
    for (const s of list) {
        let poly = land;
        for (const o of list) {
            if (o === s) continue;
            const a = o.x - s.x, b = o.y - s.y;
            if (Math.hypot(a, b) < 1e-6) continue;
            poly = clipHalf(poly, a, b, (o.x * o.x + o.y * o.y - s.x * s.x - s.y * s.y + s.w - o.w) / 2);    // the side of the line that is s's
            if (poly.length < 3) break;
        }
        if (poly.length < 3) { out.set(s.id, { outline: [], neighbours: [], borders: [] }); continue; }
        // A border shared with a neighbour is waved along its own line, the wave read from the pair (not from who asks),
        // so both lands draw the same border; the wave dies away toward the border's ends, where three lands meet.
        const waved = [];
        const shared = new Map();    // a neighbour -> the border shared with it, as it runs along this land's outline
        for (let i = 0; i < poly.length; i++) {
            const p = poly[i], q = poly[(i + 1) % poly.length];
            waved.push(p);
            const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
            const on = (pt, o) => Math.abs(pd(pt, s) - pd(pt, o)) < 1e-6;
            const o = list.find(x => x !== s && on(p, x) && on(q, x));
            if (!o) continue;
            if (!shared.has(o.id)) shared.set(o.id, []);
            const run = shared.get(o.id);
            run.push(p);
            if (len < 0.8) { run.push(q); continue; }
            const [lo, hi] = s.id < o.id ? [s, o] : [o, s];
            const nd = Math.hypot(hi.x - lo.x, hi.y - lo.y);
            const nx = (hi.x - lo.x) / nd, ny = (hi.y - lo.y) / nd;       // across the border, the same for both lands
            const mx = (lo.x + hi.x) / 2, my = (lo.y + hi.y) / 2;
            const ph = [1, 2, 3].map(n => hash01(`${lo.id}|${hi.id}/${n}`) * Math.PI * 2);
            const amp = 0.42 * Math.min(1, len / 5);                      // a short border has little room to wander
            const steps = Math.ceil(len / 0.3);
            for (let k = 1; k < steps; k++) {
                const t = k / steps;
                const x = p[0] + (q[0] - p[0]) * t, y = p[1] + (q[1] - p[1]) * t;
                const u = (x - mx) * -ny + (y - my) * nx;                     // along the border, from the pair's midpoint
                const taper = Math.min(1, Math.min(t, 1 - t) * len / 0.9);
                const f = amp * taper * (Math.sin(u * 0.9 + ph[0]) + 0.55 * Math.sin(u * 2.3 + ph[1]) + 0.3 * Math.sin(u * 4.9 + ph[2])) / 1.85;
                const pt = [x + nx * f, y + ny * f];
                waved.push(pt);
                run.push(pt);
            }
            run.push(q);
        }
        const bent = (pts) => pts.map(([x, y]) => bend.to(x, y).map(round4));
        out.set(s.id, { outline: bent(waved), neighbours: [...shared.keys()], borders: [...shared].map(([id, pts]) => ({ id, points: bent(pts) })) });
    }
    return out;
}

/** The lands' outlines alone: a region's id -> its outline (territoryCells). */
export function territoryOutlines(sites, radius = TERRITORY_RADIUS, seed = 'land') {
    return new Map([...territoryCells(sites, radius, seed)].map(([id, c]) => [id, c.outline]));
}

// The colours a land can be (D167): twelve hues right round the wheel, thirty degrees apart, in three strengths. The
// first strength is used up before the second, so the first twelve lands of a map are twelve different colours; they
// are muted, to sit on the paper. A land whose name tells a terrain likes the hue nearest that terrain best.
const LAND_HUES = 12;
const LAND_TIERS = Object.freeze([{ s: 46, l: 67 }, { s: 40, l: 55 }, { s: 52, l: 78 }]);
const TERRAIN_HUE = Object.freeze({ forest: 105, mountains: 25, desert: 45, snow: 200, swamp: 80, coast: 170, town: 10 });
const hueGap = (a, b) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));

/**
 * A colour of its own for every land of a map (D167): no two lands the
 * same, and a land well apart on the wheel from the lands it borders. A
 * land has colours it likes best (by its id; by its terrain when its name
 * tells one) and takes the first of them that no land made before it has
 * and that is not too like a neighbour's: so a land added later changes
 * no colour already there.
 * @param {Array<{ id: string, terrain: string, neighbours: string[] }>} lands  in the order they were made
 * @returns {Map<string, { h: number, s: number, l: number, css: string }>}
 */
export function territoryShades(lands) {
    const out = new Map();
    const used = new Set();
    for (const land of Array.isArray(lands) ? lands : []) {
        const likes = TERRAIN_HUE[land.terrain];
        const cands = [];
        LAND_TIERS.forEach((tier, ti) => {
            for (let hi = 0; hi < LAND_HUES; hi++) {
                const h = (10 + hi * 360 / LAND_HUES) % 360;
                const chance = hash01(`${land.id}/colour/${ti}/${hi}`);
                cands.push({ h, s: tier.s, l: tier.l, css: `hsl(${h} ${tier.s}% ${tier.l}%)`, liking: ti + (likes === undefined ? chance * 0.9 : hueGap(h, likes) / 180 * 0.85 + chance * 0.04) });
            }
        });
        cands.sort((a, b) => a.liking - b.liking);
        const beside = (land.neighbours || []).map(id => out.get(id)).filter(Boolean);
        // How far a colour is from the nearest neighbour's: by hue, and a little by how light it is (the same hue lighter is no different colour).
        const room = (c) => (beside.length ? Math.min(...beside.map(b => hueGap(c.h, b.h) + Math.abs(c.l - b.l) * 0.6)) : Infinity);
        const free = cands.filter(c => !used.has(c.css));
        const pool = free.length ? free : cands;    // more lands than colours: one is used again, as far from the neighbours as can be
        const pick = pool.find(c => room(c) >= 55) || pool.find(c => room(c) >= 28) || [...pool].sort((a, b) => room(b) - room(a))[0];
        used.add(pick.css);
        out.set(land.id, { h: pick.h, s: pick.s, l: pick.l, css: pick.css });
    }
    return out;
}

/** The region whose land a point of the map stands on, or '' (D166): what is put down on a land goes inside that region. */
export function territoryAt(model, x, y) {
    for (const t of (model && Array.isArray(model.territories) ? model.territories : [])) if (pointInPolygon(t.outline, x, y)) return t.id;
    return '';
}

/** A raw-less grouping (D163): everything on the model's map put inside a new region that stands where they stood; each keeps its spot, now on the region's own map. The book and the region's id. */
export function wrapInRegion(book, model, { label = 'New region', loose = false } = {}) {
    const here = [...(model && model.markers ? model.markers : []), ...(model && model.tray ? model.tray.filter(t => t.here !== false) : [])].filter(m => m.kind !== 'region');
    const placed = here.filter(m => finite(m.x) && finite(m.y));
    const cx = placed.length ? placed.reduce((n, m) => n + m.x, 0) / placed.length : 0;
    const cy = placed.length ? placed.reduce((n, m) => n + m.y, 0) / placed.length : 0;
    const made = addPin(book, { label, kind: 'region', x: cx, y: cy, layer: model ? model.layer : '', loose });
    let b = made.book;
    for (const m of here) b = { ...b, inside: { ...b.inside, [m.id]: made.id } };
    // The region's own map keeps the scale the places were on: grouping changes no distance between them.
    if (model && model.measure && ATLAS_SCALES[model.measure.scale]) b = { ...b, scales: { ...b.scales, [made.id]: model.measure.scale } };
    return { book: b, id: made.id, moved: here.length };
}

// ─── Inside a region (D168): its land as on the map above, its neighbours, its terrain ───

const boxOf = (pts) => { let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity; for (const [x, y] of pts) { if (x < minX) minX = x; if (y < minY) minY = y; if (x > maxX) maxX = x; if (y > maxY) maxY = y; } return { minX, minY, maxX, maxY }; };
const areaOf = (poly) => { let a = 0; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) a += poly[j][0] * poly[i][1] - poly[i][0] * poly[j][1]; return Math.abs(a) / 2; };
function segDist(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay;
    const l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0;
    return Math.hypot(px - ax - dx * t, py - ay - dy * t);
}

/** How far a point is from the edge of a polygon (from its nearest side). */
export function edgeDistance(poly, x, y) {
    let d = Infinity;
    for (let i = 0, j = (poly ? poly.length : 0) - 1; i < (poly ? poly.length : 0); j = i++) d = Math.min(d, segDist(x, y, poly[j][0], poly[j][1], poly[i][0], poly[i][1]));
    return d;
}
const insideBy = (poly, x, y, margin) => pointInPolygon(poly, x, y) && (!(margin > 0) || edgeDistance(poly, x, y) >= margin);
const lineDist = (line, x, y) => { let d = Infinity; for (let i = 1; i < line.length; i++) d = Math.min(d, segDist(x, y, line[i - 1][0], line[i - 1][1], line[i][0], line[i][1])); return d; };

/** The middle of a land: the point of it farthest from its edge, looked for on a grid over it. */
function landMiddle(outline) {
    const b = boxOf(outline);
    const N = 14;
    let best = null;
    for (let i = 0; i <= N; i++) for (let j = 0; j <= N; j++) {
        const x = b.minX + (b.maxX - b.minX) * i / N, y = b.minY + (b.maxY - b.minY) * j / N;
        if (!pointInPolygon(outline, x, y)) continue;
        const d = edgeDistance(outline, x, y);
        if (!best || d > best.d) best = { x, y, d };
    }
    return best || { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2, d: 0 };
}

// How much wider a land is drawn on its own map than on the map above, when its places need the room: in steps, so
// a place moved a little leaves the land as it was.
const FRAME_STEPS = Object.freeze([1, 1.25, 1.6, 2, 2.5, 3.2, 4, 5, 6.4, 8, 10, 12.5, 16, 20, 25, 32, 40, 50, 64]);
const FRAME_MARGIN = 0.45;    // how far inside the border a place stands at the least, once the land is fitted to its places

/**
 * How a region's land lies on the region's own map (D168): a point of
 * the map above at (x, y) is at (x * k + dx, y * k + dy) on it. While
 * every place of the region stands on the land as it is on the map
 * above, nothing is moved (k 1, dx 0, dy 0): a place is at the same spot
 * of the land on both maps. When one does not, the land is drawn wider,
 * a step at a time, until it holds them all: a land always holds its
 * places. It grows where it lies, about its own middle (a place put a
 * little past the border widens the land and moves nothing else far);
 * unless laying it under its places, its middle on theirs, takes much
 * less widening (the places were laid out before the land was there).
 * @param {number[][]} outline  the land on the map above
 * @param {Array<{ x: number, y: number }>} spots  the region's places, on the region's own map
 * @returns {{ k: number, dx: number, dy: number }}
 */
export function landFrame(outline, spots) {
    const same = { k: 1, dx: 0, dy: 0 };
    const pts = (Array.isArray(spots) ? spots : []).filter(p => p && finite(p.x) && finite(p.y));
    if (!Array.isArray(outline) || outline.length < 3 || !pts.length) return same;
    const holds = (f, margin) => pts.every(p => insideBy(outline, (p.x - f.dx) / f.k, (p.y - f.dy) / f.k, margin));
    if (holds(same, 0)) return same;
    const mid = landMiddle(outline);
    const b = boxOf(pts.map(p => [p.x, p.y]));
    const px = Math.round(b.minX + b.maxX) / 2, py = Math.round(b.minY + b.maxY) / 2;    // the places' middle, to the half unit
    const first = (make) => { for (const k of FRAME_STEPS) { const f = make(k); if (holds(f, FRAME_MARGIN)) return f; } return null; };
    const grown = first((k) => ({ k, dx: round4(mid.x * (1 - k)), dy: round4(mid.y * (1 - k)) }));    // wider where it lies
    const laid = first((k) => ({ k, dx: round4(px - mid.x * k), dy: round4(py - mid.y * k) }));       // under its places
    if (grown && (!laid || grown.k <= laid.k * 1.6)) return grown;
    const most = FRAME_STEPS[FRAME_STEPS.length - 1];
    return laid || { k: most, dx: round4(px - mid.x * most), dy: round4(py - mid.y * most) };
}

/** A spot of the map above, where it is on a region's own map (D168): `realm` is that map's model's (atlasModel().realm); with none, the same spot. */
export function spotOnLand(realm, at) {
    if (!realm || !finite(realm.k) || !finite(realm.dx) || !finite(realm.dy)) return { x: at.x, y: at.y };
    return { x: round4(at.x * realm.k + realm.dx), y: round4(at.y * realm.k + realm.dy) };
}

// What a land has on it, by its terrain (D168): how many mountain ranges, woods and lakes, from the fewest to the
// most; how large its woods and lakes are; and fields of a terrain's own marks (dunes, reeds).
const TERRAIN_PLANS = Object.freeze({
    plains: { ranges: [0, 1], woods: [3, 4], lakes: [1, 2] },
    forest: { ranges: [0, 1], woods: [6, 8], lakes: [1, 1], wood: 1.2, cover: 0.7 },
    mountains: { ranges: [3, 4], woods: [2, 3], lakes: [0, 1], wood: 0.85 },
    snow: { ranges: [2, 3], woods: [1, 2], lakes: [1, 1], wood: 0.85 },
    desert: { ranges: [1, 1], woods: [0, 0], lakes: [0, 1], lake: 0.6, fields: [5, 6] },
    swamp: { ranges: [0, 0], woods: [2, 3], lakes: [4, 5], lake: 0.6, fields: [4, 5], cover: 0.12 },
});
const LAND_AREA = 55;     // the area of a land that stands alone: what the terrain's sizes are told for
const HOME_GRID = 1.3;    // the squares a land's terrain is looked for on
const TREE_GRID = 0.85;   // the squares a forest's own trees stand on, one to a square

/**
 * The terrain drawn across a region's land (D168): mountain ranges,
 * woods and lakes (and dunes on a desert, reeds on a swamp), as many and
 * as large as the land's terrain has. Everything is read from the
 * region's id and from where on the land it is, counted from the
 * region's own spot: the same land has the same terrain every time, a
 * land moved takes its terrain with it, and a border that moves changes
 * only what stood by it. Nothing is moved to make room for a place or a
 * road: a peak or a tree that would stand on one is left out (a pass, a
 * clearing), and so is a lake.
 * @param {object} o
 * @param {string} o.id               the region
 * @param {{ x: number, y: number }} o.site  its spot
 * @param {number[][]} o.outline      its land
 * @param {string} o.terrain          guessTerrain's word for it
 * @param {Array<{ x: number, y: number }>} o.spots  the places on the land
 * @param {number[][][]} o.roads      the roads between them
 * @returns {{ unit: number, woods: number[][][], trees: number[][][], lakes: number[][][], peaks: number[][][][], marks: number[][][] }}
 *   `peaks` is one list of lines for every peak, the farthest (most northern) first; the first line of a peak is its shape
 */
export function landTerrain({ id = '', site = { x: 0, y: 0 }, outline = [], terrain = 'plains', spots = [], roads = [] } = {}) {
    const out = { unit: 1, woods: [], trees: [], lakes: [], peaks: [], marks: [] };
    if (!Array.isArray(outline) || outline.length < 3) return out;
    const plan = TERRAIN_PLANS[terrain] || TERRAIN_PLANS.plains;
    const u = Math.min(1.5, Math.max(0.7, Math.sqrt(areaOf(outline) / LAND_AREA)));    // a larger land has larger terrain, not more of it
    out.unit = round4(u);
    const count = (kind) => { const [lo, hi] = plan[kind] || [0, 0]; return Math.min(hi, lo + Math.floor(hash01(`${id}/n/${kind}`) * (hi - lo + 1))); };
    const clearOf = (x, y, ofSpots, ofRoads) => spots.every(p => Math.hypot(p.x - x, p.y - y) >= ofSpots) && roads.every(line => lineDist(line, x, y) >= ofRoads);
    const box = boxOf(outline);
    // Where a kind of terrain may stand: one point in every square of a grid laid from the region's spot, the squares
    // taken in an order of their own; the first `n` that are far enough inside the land and from one another.
    const homes = (kind, n, { size = () => 0, apart = 0, bar = () => false } = {}) => {
        if (n <= 0) return [];
        const cands = [];
        for (let ix = Math.floor((box.minX - site.x) / HOME_GRID); ix <= Math.ceil((box.maxX - site.x) / HOME_GRID); ix++) {
            for (let iy = Math.floor((box.minY - site.y) / HOME_GRID); iy <= Math.ceil((box.maxY - site.y) / HOME_GRID); iy++) {
                const key = `${id}/${kind}/${ix},${iy}`;
                cands.push({ key, p: hash01(`${key}/p`), x: site.x + (ix + 0.15 + 0.7 * hash01(`${key}/x`)) * HOME_GRID, y: site.y + (iy + 0.15 + 0.7 * hash01(`${key}/y`)) * HOME_GRID });
            }
        }
        cands.sort((a, b) => a.p - b.p);
        const got = [];
        for (const c of cands) {
            if (got.length >= n) break;
            c.r = size(c);
            if (!insideBy(outline, c.x, c.y, c.r) || got.some(o => Math.hypot(o.x - c.x, o.y - c.y) < apart) || bar(c)) continue;
            got.push(c);
        }
        return got;
    };

    // Lakes: a lumpy round of water, longer one way than the other. Where a lake lies is the land's own; a place or
    // a road on it only leaves it undrawn, and the ranges and the woods still stand off where it would be, so what a
    // place changes is what is next to it and nothing further off.
    const beds = [];
    for (const c of homes('lake', count('lakes'), { size: (c) => (0.55 + 0.6 * hash01(`${c.key}/r`)) * (plan.lake || 1) * u * (1 + 0.5 * hash01(`${c.key}/st`)) * 1.22 + 0.3 * u, apart: 2.6 * u })) {
        const r = (0.55 + 0.6 * hash01(`${c.key}/r`)) * (plan.lake || 1) * u;
        const long = r * (1 + 0.5 * hash01(`${c.key}/st`));
        const reach = long * 1.22;    // its waved shore reaches this far at the most
        const turn = hash01(`${c.key}/turn`) * Math.PI;
        const ct = Math.cos(turn), st = Math.sin(turn);
        const shore = regionOutline(`${c.key}/lake`, { x: 0, y: 0 }, 1, 26).map(([x, y]) => [round4(c.x + x * long * ct - y * r * st), round4(c.y + x * long * st + y * r * ct)]);
        beds.push({ x: c.x, y: c.y, reach, shore, dry: !clearOf(c.x, c.y, reach + 0.75 * u, reach + 0.3 * u) });
    }
    const lakes = beds.filter(l => !l.dry);
    const wet = (list) => (x, y, by) => list.some(l => Math.hypot(l.x - x, l.y - y) < l.reach + by && (pointInPolygon(l.shore, x, y) || edgeDistance(l.shore, x, y) < by));
    const inLake = wet(lakes);    // in the water that is drawn
    const inBed = wet(beds);      // where a lake lies, drawn or not

    // Mountain ranges: a line of peaks that wanders across the land, the tallest in its middle, a foothill beside
    // every other one.
    const peaks = [];
    for (const c of homes('range', count('ranges'), { size: () => 0.9 * u, apart: 2.8 * u, bar: (c) => inBed(c.x, c.y, 0.9 * u) })) {
        const way = hash01(`${c.key}/way`) * Math.PI;
        const dx = Math.cos(way), dy = Math.sin(way);
        const long = (3.2 + 2.6 * hash01(`${c.key}/long`)) * u;
        const ph = hash01(`${c.key}/ph`) * Math.PI * 2;
        const step = 0.46 * u;
        const mine = [];
        for (let i = 0; i * step <= long; i++) {
            const t = -long / 2 + i * step;
            const mid = 1 - Math.pow(2 * t / long, 2);
            const off = 0.5 * u * Math.sin(t * 0.85 / u + ph) + (hash01(`${c.key}/p${i}/j`) - 0.5) * 0.24 * u;
            const main = { key: `${c.key}/p${i}`, x: c.x + dx * t - dy * off, y: c.y + dy * t + dx * off, s: (0.5 + 0.34 * mid + 0.14 * hash01(`${c.key}/p${i}/s`)) * u };
            mine.push(main);
            if (i % 2 === 1 && mid > 0.25) {
                const d = (hash01(`${c.key}/p${i}/side`) < 0.5 ? -1 : 1) * (0.5 + 0.2 * hash01(`${c.key}/p${i}/d`)) * u;
                mine.push({ key: `${c.key}/f${i}`, x: main.x - dy * d + dx * 0.2 * u, y: main.y + dx * d + dy * 0.2 * u, s: main.s * 0.62 });
            }
        }
        // A peak stands at the middle of its foot; what must be clear is the peak itself, which rises above it.
        const ok = mine.filter(p => insideBy(outline, p.x, p.y - p.s * 0.45, 0.3 * u + p.s * 0.55) && !inLake(p.x, p.y - p.s * 0.3, 0.3 * u + p.s * 0.4) && clearOf(p.x, p.y - p.s * 0.45, 0.6 * u + p.s * 0.5, 0.2 * u + p.s * 0.45));
        if (ok.length >= 4) peaks.push(...ok);    // two or three peaks alone are no range
    }
    peaks.sort((a, b) => a.y - b.y);
    for (const p of peaks) {
        const w = p.s * 0.62, h = p.s * 1.05;
        const lean = (hash01(`${p.key}/a`) - 0.5) * 0.3 * w;
        const j1 = (hash01(`${p.key}/b`) - 0.5) * 0.14 * h, j2 = (hash01(`${p.key}/c`) - 0.5) * 0.14 * h;
        const at = (ox, oy) => [round4(p.x + ox), round4(p.y + oy)];
        out.peaks.push([
            [at(-w, 0), at(-0.45 * w, -0.56 * h + j1), at(lean, -h), at(0.48 * w, -0.5 * h + j2), at(w, 0)],    // the peak, open at its foot
            [at(lean, -h), at(lean * 0.4 + 0.14 * w, -0.56 * h), at(-0.06 * w, -0.16 * h)],                     // the ridge down its face
            [at(0.36 * w, -0.4 * h), at(0.24 * w, -0.1 * h)], [at(0.62 * w, -0.26 * h), at(0.54 * w, -0.05 * h)],    // its shaded side
        ]);
    }
    const onPeak = (x, y, by) => peaks.some(p => Math.abs(p.x - x) < p.s * 0.62 + by && y > p.y - p.s * 1.05 - by && y < p.y + by);

    // Woods: a patch of green with its trees; a tree that would stand on a place, a road, a lake or a peak is left out.
    const tree = (key, x, y) => {
        const sz = (0.2 + 0.1 * hash01(`${key}/s`)) * u;
        const pt = (ox, oy) => [round4(x + ox * sz), round4(y + oy * sz)];
        out.trees.push([pt(0, -1), pt(0.5, -0.55), pt(0.55, -0.05), pt(0, 0.2), pt(-0.55, -0.05), pt(-0.5, -0.55), pt(0, -1)], [pt(0, 0.2), pt(0, 0.7)]);    // a crown and a trunk
    };
    // A wood by the border is as large as the land has room for there.
    for (const c of homes('wood', count('woods'), { size: () => 0.75 * u, apart: 1.5 * u, bar: (c) => inBed(c.x, c.y, 0.4 * u) })) {
        const r = Math.min((0.9 + 0.8 * hash01(`${c.key}/r`)) * (plan.wood || 1) * u, (edgeDistance(outline, c.x, c.y) - 0.1 * u) / 1.2);
        out.woods.push(regionOutline(`${c.key}/wood`, c, r, 22));
        const n = Math.round(6 + (r / u) * (r / u) * 6);
        for (let i = 0; i < n; i++) {
            const t = hash01(`${c.key}/t${i}/a`) * Math.PI * 2;
            const d = r * 0.86 * Math.sqrt(hash01(`${c.key}/t${i}/d`));
            const x = c.x + d * Math.cos(t), y = c.y + d * Math.sin(t);
            if (inLake(x, y, 0.22 * u) || onPeak(x, y, 0.18 * u) || !clearOf(x, y, 0.8 * u, 0.36 * u)) continue;
            tree(`${c.key}/t${i}`, x, y);
        }
    }

    // A forest is wooded all over, and a swamp has trees here and there: one tree to a square of the land, in as many
    // of the squares as the terrain is wooded.
    if (plan.cover > 0) {
        for (let ix = Math.floor((box.minX - site.x) / TREE_GRID); ix <= Math.ceil((box.maxX - site.x) / TREE_GRID); ix++) {
            for (let iy = Math.floor((box.minY - site.y) / TREE_GRID); iy <= Math.ceil((box.maxY - site.y) / TREE_GRID); iy++) {
                const key = `${id}/tree/${ix},${iy}`;
                if (hash01(`${key}/p`) >= plan.cover) continue;
                const x = site.x + (ix + 0.1 + 0.8 * hash01(`${key}/x`)) * TREE_GRID, y = site.y + (iy + 0.1 + 0.8 * hash01(`${key}/y`)) * TREE_GRID;
                if (!insideBy(outline, x, y, 0.4 * u) || inLake(x, y, 0.22 * u) || onPeak(x, y, 0.18 * u) || !clearOf(x, y, 0.8 * u, 0.36 * u)) continue;
                tree(key, x, y);
            }
        }
    }

    // A desert's dunes and a swamp's reeds, in fields.
    for (const c of homes('field', count('fields'), { size: () => 0.9 * u, apart: 2 * u, bar: (c) => inBed(c.x, c.y, 0.3 * u) })) {
        const n = 6 + Math.floor(hash01(`${c.key}/n`) * 3);
        for (let i = 0; i < n; i++) {
            const t = hash01(`${c.key}/m${i}/a`) * Math.PI * 2;
            const d = 1.15 * u * Math.sqrt(hash01(`${c.key}/m${i}/d`));
            const x = c.x + d * Math.cos(t), y = c.y + d * Math.sin(t);
            if (!insideBy(outline, x, y, 0.35 * u) || inLake(x, y, 0.3 * u) || onPeak(x, y, 0.2 * u) || !clearOf(x, y, 0.8 * u, 0.36 * u)) continue;
            out.marks.push(...glyphAt(terrain, x, y, 0.2 * u));
        }
    }
    out.lakes = lakes.map(l => l.shore);
    return out;
}

/** Where a neighbour's name stands on a shared border (D168): the border's middle, the way the border runs there (in degrees, as the screen turns: x right, y down; between -90 and 90). */
function borderMark(points) {
    const lens = [0];
    for (let i = 1; i < points.length; i++) lens.push(lens[i - 1] + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]));
    const total = lens[lens.length - 1];
    const at = (f) => {
        const want = total * f;
        let i = 1;
        while (i < lens.length - 1 && lens[i] < want) i++;
        const t = lens[i] > lens[i - 1] ? (want - lens[i - 1]) / (lens[i] - lens[i - 1]) : 0;
        return [points[i - 1][0] + (points[i][0] - points[i - 1][0]) * t, points[i - 1][1] + (points[i][1] - points[i - 1][1]) * t];
    };
    const a = at(0.3), b = at(0.7);
    let angle = Math.atan2(b[1] - a[1], b[0] - a[0]) * 180 / Math.PI;
    if (angle > 90) angle -= 180;
    if (angle <= -90) angle += 180;
    return { at: at(0.5), angle, length: total };
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
    // A location the story names that carries the name of a marker made by hand (the set-up's places, D159) is that
    // marker: "Hask, the house on the lane, the bedroom wall" is the house. The deepest marker named wins.
    const pinDepth = (id) => { let d = 0; let cur = bk.inside[id]; for (let i = 0; cur && i < 20; i++) { d++; cur = bk.inside[cur]; } return d; };
    const pins = bk.made.map(m => ({ id: m.id, key: norm(m.label), depth: pinDepth(m.id) })).filter(x => x.key.length >= 3);
    const pinFor = (label) => {
        const segs = labelSegments(label).map(sg => ` ${norm(sg)} `);
        let best = null;
        for (const pk of pins) {
            if (!segs.some(sg => sg.includes(` ${pk.key} `))) continue;
            if (!best || pk.depth > best.depth || (pk.depth === best.depth && pk.key.length > best.key.length)) best = pk;
        }
        return best ? best.id : '';
    };
    const named = new Map();    // a marker made by hand -> the story's locations that are it
    const story = [];
    for (const sp of storyPlaces(pack, state)) {
        const pin = bk.merged[sp.id] ? '' : pinFor(sp.label);    // what the player (or the set-up) merged by hand stands as merged
        if (!pin) { story.push(sp); continue; }
        alias.set(sp.id, pin);
        if (!named.has(pin)) named.set(pin, []);
        named.get(pin).push(sp);
    }
    for (const g of foldPlaces(story)) {
        const c = make(g.id, { label: g.label, rooms: [...g.rooms], image: (story.find(s => g.members.some(m => m.id === s.id) && s.image) || {}).image || '' });
        c.ids = [...new Set([g.id, ...g.members.map(m => m.id)])];
        for (const m of g.members) if (m.id !== g.id) alias.set(m.id, g.id);
    }
    for (const m of bk.made) {
        const c = make(m.id, { label: m.label, kind: m.kind, note: m.note, source: 'pin', loose: m.loose === true });
        for (const sp of named.get(m.id) || []) { c.ids.push(sp.id); if (!c.image && sp.image) c.image = sp.image; }
    }

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
            rooms: c.rooms, names: c.names, holds: holds.get(c.id) || 0, loose: c.loose === true,
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
    const all = [...live.values()].map(c => ({ id: c.id, label: c.label, kind: c.kind || guessKind(c.label), rooms: c.rooms, names: c.names, loose: c.loose === true, people: own.get(c.id) || [], layer: par.get(c.id) || '', layerLabel: labelOfLayer(par.get(c.id) || ''), placed: !!spotOf(c), inside: chain(c.id).slice(0, -1) }));

    // A marker whose name tells a terrain stands on tinted ground with that terrain's drawings (D154).
    const regions = [];
    for (const m of markers) {
        const terrain = guessTerrain(m.label);
        if (terrain === 'plains' || m.kind === 'region') continue;    // a region's land is its territory, drawn further down
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
    // The regions on this map are lands that share borders (D163); what a land shows of itself comes with it.
    const sites = markers.filter(m => m.kind === 'region');
    const cells = territoryCells(sites, TERRITORY_RADIUS, cur || 'top');
    const shades = territoryShades(sites.map(m => ({ id: m.id, terrain: guessTerrain(m.label), neighbours: (cells.get(m.id) || { neighbours: [] }).neighbours })));
    const territories = sites.map(m => { const c = cells.get(m.id) || { outline: [], neighbours: [] }; return { id: m.id, label: m.label, terrain: guessTerrain(m.label), fill: (shades.get(m.id) || { css: '' }).css, x: m.x, y: m.y, outline: c.outline, neighbours: c.neighbours, loose: m.loose, player: m.player, visited: m.visited, holds: m.holds }; }).filter(t => t.outline.length >= 3);
    for (const m of markers) m.territory = territories.some(t => t.id === m.id);

    const land = markers.map(m => ({ id: m.id, x: m.x, y: m.y, radius: m.territory ? TERRITORY_RADIUS : LAND_RADIUS }))
        .map(b => ({ ...b, outline: regionOutline(`${b.id}/land`, b, b.radius, 28), ripple1: regionOutline(`${b.id}/land`, b, b.radius + 0.22, 28), ripple2: regionOutline(`${b.id}/land`, b, b.radius + 0.5, 28) }));

    // Paths (drawn, never measured: D141): a tree over the markers.
    const joined = markers.filter(m => m.kind !== 'region');    // lands are joined by their borders, not by a path
    // The map joins each place to its nearest by itself; the player's own roads are added and the ones they cut left out
    // (D164). A road knows its drawn length and, when the player set one, its own travel time (D165).
    const pairKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
    const cutKeys = new Set(bk.cut.map(([a, b]) => pairKey(a, b)));
    const byMarker = new Map(markers.map(m => [m.id, m]));
    const roadOf = (ma, mb, auto, hours) => ({ a: ma.id, b: mb.id, kind: 'road', auto, hours: hours > 0 ? hours : 0, units: round4(dist(ma, mb)), points: [[ma.x, ma.y], [mb.x, mb.y]] });
    const routes = spanningTree(joined).map(([a, b]) => roadOf(joined[a], joined[b], true, 0)).filter(r => !cutKeys.has(pairKey(r.a, r.b)));
    for (const [a, b] of bk.roads) {
        const ma = byMarker.get(resolve(a)), mb = byMarker.get(resolve(b));
        if (!ma || !mb || ma === mb || cutKeys.has(pairKey(ma.id, mb.id))) continue;
        const hours = bk.roadHours[pairKey(a, b)] || 0;
        const have = routes.find(r => pairKey(r.a, r.b) === pairKey(ma.id, mb.id));
        if (have) { have.auto = false; if (hours) have.hours = hours; continue; }    // the map drew it too: it is the player's now
        routes.push(roadOf(ma, mb, false, hours));
    }

    const kindOfId = (id) => (live.get(id).kind || guessKind(live.get(id).label));
    const up = chain(cur);
    const lastRegion = up.map(kindOfId).lastIndexOf('region');
    const measure = measureOf(pack, bk, cur, { depth, below: up.length - 1 - lastRegion, layered: holds.size > 0, regions: sites.length > 0, kind: cur ? kindOfId(cur) : '' });
    const ground = groundOf(bk, cur, { scale: measure.scale, label: labelOfLayer(cur), kind: cur ? (live.get(cur).kind || guessKind(live.get(cur).label)) : '' });

    // Inside a region (D168): the land it has on the map above is the land of its own map, the lands it borders
    // lie around it, and its terrain is drawn across it. Only on open country (a region the player gave streets or a
    // shore is drawn as they said), and not when it holds regions of its own: their lands are its map.
    let realm = null;
    let terrain = null;
    if (cur && kindOfId(cur) === 'region' && ground === 'country' && !territories.length) {
        const above = par.get(cur) || '';
        const spots = [];    // the regions on the map above, in the order that map draws them
        for (const c of live.values()) {
            if ((par.get(c.id) || '') !== above || kindOfId(c.id) !== 'region') continue;
            const sp = spotOf(c);
            if (sp) spots.push({ id: c.id, label: c.label, loose: c.loose === true, x: sp.x, y: sp.y });
        }
        const upCells = territoryCells(spots, TERRITORY_RADIUS, above || 'top');
        const cell = upCells.get(cur);
        const site = spots.find(sp => sp.id === cur);
        if (site && cell && cell.outline.length >= 3) {
            const upShades = territoryShades(spots.map(sp => ({ id: sp.id, terrain: guessTerrain(sp.label), neighbours: (upCells.get(sp.id) || { neighbours: [] }).neighbours })));
            const f = landFrame(cell.outline, markers);
            const to = ([x, y]) => [round4(x * f.k + f.dx), round4(y * f.k + f.dy)];           // from the map above to this one
            const back = (x, y) => [(x - f.dx) / f.k, (y - f.dy) / f.k];                       // and from this one to the map above
            const fillOf = (id) => (upShades.get(id) || { css: '' }).css;
            const here = to([site.x, site.y]);
            const neighbours = [];
            for (const b of cell.borders) {
                const o = spots.find(sp => sp.id === b.id);
                const oc = upCells.get(b.id);
                if (!o || !oc || oc.outline.length < 3 || b.points.length < 2) continue;
                const mark = borderMark(b.points.map(to));
                // The name stands on the neighbour's side of the border: the side its spot is on.
                const t = mark.angle * Math.PI / 180;
                const away = (o.x - site.x) * -Math.sin(t) + (o.y - site.y) * Math.cos(t);
                neighbours.push({ id: o.id, label: o.label, terrain: guessTerrain(o.label), fill: fillOf(o.id), loose: o.loose, outline: oc.outline.map(to), border: b.points.map(to), at: mark.at.map(round4), angle: round4(mark.angle), side: away < 0 ? -1 : 1 });
            }
            const kindOfLand = guessTerrain(site.label);
            realm = { id: cur, label: site.label, terrain: kindOfLand, fill: fillOf(cur), loose: site.loose, x: here[0], y: here[1], k: f.k, dx: f.dx, dy: f.dy, outline: cell.outline.map(to), neighbours };
            const drawn = landTerrain({ id: cur, site, outline: cell.outline, terrain: kindOfLand, spots: markers.map(m => { const [x, y] = back(m.x, m.y); return { x, y }; }), roads: routes.map(r => r.points.map(([x, y]) => back(x, y))) });
            const lines = (list) => list.map(line => line.map(to));
            terrain = { lines: [], sea: null, ripples: [], woods: lines(drawn.woods), trees: lines(drawn.trees), ponds: lines(drawn.lakes), peaks: drawn.peaks.map(lines), marks: lines(drawn.marks), look: kindOfLand, unit: round4(drawn.unit * f.k) };
        }
    }

    // The canvas: the empty map's own reach, or a region's land; and room around everything that stands on it.
    let minX = -CANVAS, minY = -CANVAS, maxX = CANVAS, maxY = CANVAS;
    if (realm) { minX = Infinity; minY = Infinity; maxX = -Infinity; maxY = -Infinity; for (const [x, y] of realm.outline) { minX = Math.min(minX, x - 2.5); minY = Math.min(minY, y - 2.5); maxX = Math.max(maxX, x + 2.5); maxY = Math.max(maxY, y + 2.5); } }
    for (const b of land) { minX = Math.min(minX, b.x - b.radius - 3); minY = Math.min(minY, b.y - b.radius - 3); maxX = Math.max(maxX, b.x + b.radius + 3); maxY = Math.max(maxY, b.y + b.radius + 3); }
    for (const t of territories) for (const [x, y] of t.outline) { minX = Math.min(minX, x - 3); minY = Math.min(minY, y - 3); maxX = Math.max(maxX, x + 3); maxY = Math.max(maxY, y + 3); }    // the lands reach past their spots
    const bounds = { minX: round4(minX), minY: round4(minY), maxX: round4(maxX), maxY: round4(maxY) };
    return {
        layer: cur, layerLabel: labelOfLayer(cur), depth,
        trail: chain(cur).map(id => ({ id, label: labelOfLayer(id) })),
        markers, tray, deleted, regions, land, routes, all,
        party: partyOn && markers.some(m => m.id === partyOn) ? partyOn : '',
        partyInTray: partyOn && tray.some(m => m.id === partyOn) ? partyOn : '',
        partyId, partyLayer: partyId ? (par.get(partyId) || '') : '',
        bounds, measure, ground, territories, realm,
        decor: terrain || groundDecor(ground, cur || 'top', bounds, markers, territories.map(t => t.outline)),
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
    const taken = (model && model.markers ? model.markers : []).map(m => ({ x: m.x, y: m.y, wide: m.kind === 'region' }));
    const free = (at, wide) => taken.every(t => dist(t, at) >= (wide || t.wide ? TERRITORY_RADIUS * 1.3 : 1.3));    // a region needs room for its land
    const out = new Map();
    // On a region's own map (D168) the spiral starts from the region's spot and keeps to its land, while there is room on it.
    const realm = model && model.realm ? model.realm : null;
    const mid = realm ? { x: realm.x, y: realm.y } : { x: 0, y: 0 };
    let n = 0, wide = 0;
    for (const t of (model && model.tray ? model.tray : [])) {
        if (t.here === false) continue;
        let at = null;
        if (realm) for (let guard = 0; !at && guard < 600; guard++) { const s = spiral(mid, n++, 1.7, 0.1); if (free(s, t.kind === 'region') && insideBy(realm.outline, s.x, s.y, 0.6)) at = s; }
        for (let guard = 0; !at && guard < 4000; guard++) { const s = spiral(mid, realm ? wide++ : n++, 1.7, 0.1); if (free(s, t.kind === 'region')) at = s; }
        if (!at) continue;
        taken.push({ ...at, wide: t.kind === 'region' });
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

export const CROSS_COUNTRY = 1.5;    // off the roads a journey takes half as long again (D165)

/**
 * The way from one marker to another on a map, and how long it takes
 * (D165): the quickest of every way there is, by road where roads join
 * the places and across country where none does. A road takes the time
 * the player set for it, else its drawn length at the map's pace; a
 * stretch across country takes its straight line at the pace, half as
 * long again. Two places joined by a road with a set time take that
 * time, whatever other way there might be: the set time is the story's
 * word for that journey. Between lands (regions) there are no roads to
 * miss: the straight line at the pace.
 * @returns {{ hours: number, length: number, mode: 'here'|'road'|'cross'|'mixed'|'open', via: string[], set: boolean }|null}
 *   `length` in the map's unit along the way taken; `via` the ids of the places passed through; `set` when a road with a set time is on the way; null when either is not on this map
 */
export function routeBetween(model, fromId, toId) {
    const ms = model && Array.isArray(model.markers) ? model.markers : [];
    const from = ms.findIndex(m => m.id === fromId);
    const to = ms.findIndex(m => m.id === toId);
    if (from < 0 || to < 0) return null;
    if (from === to) return { hours: 0, length: 0, mode: 'here', via: [], set: false };
    const per = model.measure.per;
    const n = ms.length;
    const road = new Map();
    for (const r of Array.isArray(model.routes) ? model.routes : []) {
        const i = ms.findIndex(m => m.id === r.a), j = ms.findIndex(m => m.id === r.b);
        if (i < 0 || j < 0) continue;
        const length = dist(ms[i], ms[j]) * per;
        const e = { hours: r.hours > 0 ? r.hours : travelHours(length, model.measure), length, set: r.hours > 0, kind: 'road' };
        road.set(i * n + j, e);
        road.set(j * n + i, e);
    }
    // A road with a set time straight between the two is the story's word for that journey: nothing is searched for.
    const direct = road.get(from * n + to);
    if (direct && direct.set) return { hours: direct.hours, length: direct.length, mode: 'road', via: [], set: true };
    const hop = (i, j) => {
        const e = road.get(i * n + j);
        if (e) return e;
        const length = dist(ms[i], ms[j]) * per;
        const open = ms[i].territory || ms[j].territory;
        return { hours: travelHours(length, model.measure) * (open ? 1 : CROSS_COUNTRY), length, set: false, kind: open ? 'open' : 'cross' };
    };
    const best = new Array(n).fill(Infinity);
    const prev = new Array(n).fill(-1);
    const done = new Array(n).fill(false);
    best[from] = 0;
    for (let k = 0; k < n; k++) {
        let u = -1;
        for (let i = 0; i < n; i++) if (!done[i] && (u < 0 || best[i] < best[u])) u = i;
        if (u < 0 || best[u] === Infinity || u === to) break;
        done[u] = true;
        for (let v = 0; v < n; v++) {
            if (done[v]) continue;
            const c = best[u] + hop(u, v).hours;
            if (c < best[v] - 1e-9) { best[v] = c; prev[v] = u; }
        }
    }
    const path = [to];
    for (let cur = to; prev[cur] >= 0; cur = prev[cur]) path.unshift(prev[cur]);
    const hops = path.slice(1).map((v, i) => hop(path[i], v));
    const kinds = new Set(hops.map(h => h.kind));
    const mode = kinds.size === 1 ? [...kinds][0] : (kinds.has('road') ? 'mixed' : 'open');
    return { hours: best[to], length: hops.reduce((sum, h) => sum + h.length, 0), mode, via: path.slice(1, -1).map(i => ms[i].id), set: hops.some(h => h.set) };
}

/**
 * The line a card shows: "96 miles by road, about 4 days on foot", "about
 * 2 days by road" (a set time is on the way: the miles drawn are not the
 * story's), "83 miles cross-country, about 5 days on foot", "40 miles,
 * partly by road, about 2 days on foot"; '' when the place is the party's
 * or is off this map.
 */
export function describeDistance(model, fromId, toId) {
    if (!fromId || !toId || fromId === toId) return '';
    const r = routeBetween(model, fromId, toId);
    if (!r) return '';
    const straight = distanceBetween(model, fromId, toId);
    if (!r.set && straight !== null && straight < 0.05) return 'a few steps away';
    const time = describeTime(r.hours);
    const way = r.mode === 'road' ? ' by road' : r.mode === 'cross' ? ' cross-country' : '';
    if (r.set) return `${time}${r.mode === 'mixed' ? ', partly by road' : way}`;
    return `${describeLength(r.length, model.measure.unit)}${r.mode === 'mixed' ? ', partly by road' : way}, ${time} on foot`;
}

/** The same told to the story (Travel here): "about 2 days by road", "about 4 days on foot by road (96 miles)", "about 5 days on foot across country (83 miles)"; '' when there is nothing to tell. */
export function describeJourney(model, fromId, toId) {
    if (!fromId || !toId || fromId === toId) return '';
    const r = routeBetween(model, fromId, toId);
    if (!r || !(r.hours > 0)) return '';
    const time = describeTime(r.hours);
    const way = r.mode === 'road' ? ' by road' : r.mode === 'cross' ? ' across country' : r.mode === 'mixed' ? ', partly by road' : '';
    return r.set ? `${time}${way}` : `${time} on foot${way} (${describeLength(r.length, model.measure.unit)})`;
}

/**
 * How long after the last scene a scene at a place opens, by the journey
 * there (D174): the scene engine's gap, { id, words }. Right after when
 * the party is there already or the map cannot tell; later that day for a
 * journey within a day's travel; else the journey's own time in words
 * ("about 2 days later").
 */
export function journeyGap(model, fromId, toId) {
    const now = { id: 'now', words: '' };
    if (!fromId || !toId || fromId === toId) return now;
    const r = routeBetween(model, fromId, toId);
    if (!r || !(r.hours >= 1)) return now;    // under an hour's walk is no time to speak of
    if (r.hours < TRAVEL_HOURS_A_DAY) return { id: 'later', words: '' };
    return { id: 'when', words: `${describeTime(r.hours)} later` };
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
