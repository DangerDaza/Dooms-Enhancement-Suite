/**
 * The Atlas's pure model (docs/long-shot-plan.md D139–D146): the world as
 * a flat vector map. A place has a spot (layout units, y down) that is
 * written once and never recomputed; the layout that proposes spots is
 * deterministic and index-stable, so a place added later moves nothing;
 * a root place is a region drawn as a blob; routes are drawn and never
 * measured; the distance between two places is the straight line between
 * their spots times the world's scale. No imports: liveWorld.js reads
 * `normalizeAtlas` for the pack. tools/atlas-test.mjs.
 */

const clean = (v, max = 200) => String(v ?? '').normalize('NFC').replace(/\s+/g, ' ').trim().slice(0, max);
const round4 = (n) => Math.round(n * 10000) / 10000;
const finite = (n) => typeof n === 'number' && Number.isFinite(n);

/** The kinds a place can be (D146), in the sidebar's order: the categories. */
export const ATLAS_KINDS = Object.freeze([
    { id: 'region', label: 'Regions', icon: 'fa-mountain-sun' },
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
const STORY_SLOTS = 14;                   // the points of the Elsewhere spiral a story place can land on
const GOLDEN = Math.PI * (3 - Math.sqrt(5));
const DIRS = new Set(['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw']);
export const ELSEWHERE_ID = 'atlas:elsewhere';    // the region the story's own places stand in

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

/** The scale in force: the atlas's, else a town for one place with places inside it, else a region. */
export function scaleOf(pack) {
    const a = pack && pack.atlas;
    if (a && ATLAS_SCALES[a.scale]) return a.scale;
    const places = placesOf(pack);
    const roots = places.filter(p => !p.parent);
    return roots.length === 1 && places.length > 1 ? 'town' : 'region';
}

/** The world's measure: the unit, what a layout unit is in it, and the pace (units a day). */
export function measureOf(pack) {
    const a = pack && pack.atlas ? pack.atlas : null;
    const unit = a && ATLAS_UNITS[a.unit] ? a.unit : 'mi';
    const per = ATLAS_SCALES[scaleOf(pack)].per * ATLAS_UNITS[unit];
    const pace = a && finite(a.pace) && a.pace > 0 ? a.pace : round4(DEFAULT_PACE_MILES * ATLAS_UNITS[unit]);
    return { unit, per, pace, scale: scaleOf(pack) };
}

function spiral(center, index, step, turn) {
    const r = step * Math.sqrt(index + 0.5);
    const t = index * GOLDEN + turn * Math.PI * 2;
    return { x: round4(center.x + r * Math.cos(t)), y: round4(center.y + r * Math.sin(t)) };
}

/** The story's own places (D93): the visited rows the pack does not name, with a `loc:` id. */
function storyPlaces(pack, state) {
    const ids = new Set(placesOf(pack).map(p => p.id));
    const out = [];
    const seen = new Set();
    const add = (id, label) => { if (typeof id === 'string' && id.startsWith('loc:') && !ids.has(id) && !seen.has(id)) { seen.add(id); out.push({ id, label: clean(label, 80) || clean(id.slice(4).replace(/-+/g, ' '), 80) }); } };
    for (const v of (state && Array.isArray(state.visited) ? state.visited : [])) if (v && !v.packId) add(v.id, v.label);
    const where = state && state.where && typeof state.where === 'object' ? state.where : {};
    for (const at of Object.values(where)) add(String(at || ''), '');
    return out;
}

/**
 * Every place's spot (D140): the atlas's own where it has one, else the
 * layout's. A root is the n-th point of the world's spiral (the first
 * point is kept for the story's own places), a child the n-th point of
 * its parent's; n is the place's index among its siblings in the pack's
 * order, so a place appended later moves nothing. A story place stands
 * on the Elsewhere spiral at a point hashed from its id, since the
 * visited row's order changes with every visit.
 * @returns {Map<string, { x: number, y: number, by: 'layout'|'user', depth: number, parent: string, root: string }>}
 */
export function layoutAtlas(pack, state = null) {
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
    const story = storyPlaces(pack, state);
    if (story.length) {
        const center = spiral({ x: 0, y: 0 }, 0, STEPS[0], hash01('world'));
        out.set(ELSEWHERE_ID, { x: center.x, y: center.y, by: 'layout', depth: 0, parent: '', root: ELSEWHERE_ID });
        for (const s of story) {
            const h = hash01(s.id);
            const at = spiral(center, Math.floor(h * STORY_SLOTS), STEPS[1], hash01(`${s.id}/turn`));
            out.set(s.id, { x: at.x, y: at.y, by: 'layout', depth: 1, parent: ELSEWHERE_ID, root: ELSEWHERE_ID });
        }
    }
    return out;
}

/** A region's outline: 40 points around its centre, waved by three sines hashed from its id. */
export function regionOutline(id, center, radius) {
    const p1 = hash01(`${id}/1`) * Math.PI * 2;
    const p2 = hash01(`${id}/2`) * Math.PI * 2;
    const p3 = hash01(`${id}/3`) * Math.PI * 2;
    const pts = [];
    for (let i = 0; i < 40; i++) {
        const t = (i / 40) * Math.PI * 2;
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

/** The pack place a path (a place path "a/b/c", an id, a loc id) stands at: the deepest pack place in it, else the path itself. */
function keyOf(ids, path) {
    const text = String(path || '');
    if (!text) return '';
    if (text.startsWith('loc:')) return text;
    const parts = text.split('/');
    for (let i = parts.length - 1; i >= 0; i--) if (ids.has(parts[i])) return parts[i];
    return '';
}

/** Where the party is, as a marker id: the player's entry in `where` when there is one, else the newest visited place. */
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
 * What the Atlas draws.
 * @param {object} o
 * @param {object} o.pack            the world (normalised)
 * @param {object|null} o.state      the world state: who is where, what was visited
 * @param {string} o.player          the player's name
 * @param {Object<string,{emoji?:string,text?:string}>} o.weather  by region id or place id
 * @returns {{ regions: Array, routes: Array, markers: Array, party: string, bounds: {minX:number,minY:number,maxX:number,maxY:number}, measure: object, empty: boolean }}
 */
export function atlasModel({ pack, state = null, player = '', weather = {}, worldName = '' } = {}) {
    const places = placesOf(pack);
    const byId = new Map(places.map(p => [p.id, p]));
    const ids = new Set(byId.keys());
    const spots = layoutAtlas(pack, state);
    const story = storyPlaces(pack, state);
    const visitedRows = state && Array.isArray(state.visited) ? state.visited : [];
    const visited = new Set();
    for (const v of visitedRows) { if (!v) continue; if (v.id) visited.add(v.id); if (v.packId) visited.add(v.packId); }
    const where = state && state.where && typeof state.where === 'object' ? state.where : {};
    const people = new Map();
    for (const [name, at] of Object.entries(where)) {
        if (player && name === player) continue;
        const key = keyOf(ids, at);
        if (!key || !spots.has(key)) continue;
        if (!people.has(key)) people.set(key, []);
        people.get(key).push(name);
    }
    const party = partyKey(pack, state, player);
    const hasKids = new Set(places.filter(p => p.parent && ids.has(p.parent)).map(p => p.parent));
    const labelOf = (id) => (id === ELSEWHERE_ID ? (worldName || (pack && places.length ? 'Elsewhere' : (pack && pack.name) || 'The world')) : (byId.get(id) || {}).label || id);

    const markers = [];
    const push = (id, label, kind, note, image) => {
        const s = spots.get(id);
        if (!s) return;
        const w = weather && (weather[id] || weather[s.root]) ? (weather[id] || weather[s.root]) : null;
        markers.push({
            id, label, kind, note: note || '', image: image || '',
            x: s.x, y: s.y, depth: s.depth, by: s.by,
            parent: s.parent, parentLabel: s.parent ? labelOf(s.parent) : '',
            region: s.root, regionLabel: s.depth ? labelOf(s.root) : '',
            isRegion: s.depth === 0,
            visited: visited.has(id),
            player: party === id,
            people: people.get(id) || [],
            weather: w ? { emoji: clean(w.emoji, 8), text: clean(w.text, 120) } : null,
        });
    };
    for (const p of places) {
        const s = spots.get(p.id);
        const region = s && s.depth === 0 && hasKids.has(p.id);
        push(p.id, p.label || p.id, region ? 'region' : (cleanKind(p.kind) && p.kind !== 'region' ? p.kind : guessKind(p.label)), p.note, p.image);
    }
    if (story.length) {
        push(ELSEWHERE_ID, labelOf(ELSEWHERE_ID), 'region', '', '');
        for (const s of story) {
            const row = visitedRows.find(v => v && v.id === s.id);
            push(s.id, s.label, guessKind(s.label), '', row && row.image ? row.image : '');
        }
    }

    // Regions: every root, as a blob around its places.
    const regions = [];
    for (const m of markers) {
        if (m.depth !== 0) continue;
        let far = 0;
        for (const o of markers) if (o.region === m.id && o.depth === 1) far = Math.max(far, dist(o, m));
        const radius = round4(Math.max(STEPS[1] * 1.6, far + STEPS[1] * 1.25));
        // The coast: a wider outline around the same centre; the coasts of neighbours overlap into one landmass.
        regions.push({ id: m.id, label: m.label, terrain: guessTerrain(m.label), x: m.x, y: m.y, radius, outline: regionOutline(m.id, m, radius), coast: regionOutline(`${m.id}/coast`, m, round4(radius * 1.45 + STEPS[1])) });
    }

    // Routes (drawn, never measured: D141): a tree inside each region, a tree over the regions.
    const routes = [];
    for (const r of regions) {
        const nodes = [markers.find(m => m.id === r.id), ...markers.filter(m => m.region === r.id && m.depth === 1)];
        for (const [a, b] of spanningTree(nodes)) routes.push({ a: nodes[a].id, b: nodes[b].id, kind: 'road', points: [[nodes[a].x, nodes[a].y], [nodes[b].x, nodes[b].y]] });
    }
    for (const [a, b] of spanningTree(regions)) routes.push({ a: regions[a].id, b: regions[b].id, kind: 'highway', points: [[regions[a].x, regions[a].y], [regions[b].x, regions[b].y]] });

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const r of regions) for (const [x, y] of r.coast) { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); }
    if (!regions.length) { minX = -1; minY = -1; maxX = 1; maxY = 1; }
    const pad = Math.max(maxX - minX, maxY - minY) * 0.08 + 0.5;
    return {
        regions, routes, markers, party: party && spots.has(party) ? party : '',
        bounds: { minX: round4(minX - pad), minY: round4(minY - pad), maxX: round4(maxX + pad), maxY: round4(maxY + pad) },
        measure: measureOf(pack),
        empty: markers.length === 0,
    };
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

/** The markers a search and the switched-off kinds leave: the name, the note, the region and the people are searched. */
export function filterMarkers(markers, { query = '', hidden = [] } = {}) {
    const off = new Set(hidden);
    const q = clean(query, 80).toLowerCase();
    return (Array.isArray(markers) ? markers : []).filter(m => {
        if (off.has(m.kind)) return false;
        if (!q) return true;
        return [m.label, m.note, m.regionLabel, m.parentLabel, ...(m.people || [])].some(t => String(t || '').toLowerCase().includes(q));
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

/**
 * A raw world with every place's spot written down (D140): the ones it
 * has are kept as they are, the rest take the layout's. `added` counts
 * the new ones; with none the input is returned.
 */
export function withSettledSpots(raw, pack) {
    const r = raw && typeof raw === 'object' ? raw : {};
    const laid = layoutAtlas(pack, null);
    const atlas = r.atlas && typeof r.atlas === 'object' ? r.atlas : {};
    const spots = { ...(atlas.spots && typeof atlas.spots === 'object' ? atlas.spots : {}) };
    let added = 0;
    for (const p of placesOf(pack)) {
        if (spots[p.id] || !laid.has(p.id)) continue;
        const s = laid.get(p.id);
        spots[p.id] = { x: s.x, y: s.y, by: 'layout' };
        added++;
    }
    return added ? { raw: { ...r, atlas: { ...atlas, spots } }, added } : { raw: r, added: 0 };
}
