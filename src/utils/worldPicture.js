/**
 * The world's picture and its nodes (docs/hub-plan.md D124, D135, D136),
 * pure; the Map window's own pure model is worldMap.js, this is the
 * hub's board. A place's node is a fraction of the picture from its top-left
 * (`x`, `y` in 0..1 on the place); the board projects it to Leaflet's
 * units from the picture's own size, where latitude grows upward, and
 * back on a drag. `boardModel` is what the board draws: the placed places
 * with the people last seen at them, the party's place, the visited
 * ones, the region's weather; and what is not on the map yet. One rule
 * says where a person stands, for the board, the tree, the place sheet
 * and the Start sheet alike (`keyOfPath`, `peopleAt`, `playerPlace`).
 * tools/hub-board-test.mjs.
 */
import { placeChain, placePath, fraction, normalizeMap, locLabel, isLocId } from './liveWorld.js';
import { currentPlace } from './worldMap.js';

export { fraction, normalizeMap };

export const MAX_ZOOM_IN = 4;    // the board zooms in to four times the picture's own size (D124)

const clamp01 = (n) => Math.min(1, Math.max(0, n));
const placesOf = (pack) => (pack && Array.isArray(pack.places) ? pack.places : []);

/** The world has a picture. */
export function hasMap(pack) {
    return !!(pack && pack.map && typeof pack.map.image === 'string' && pack.map.image);
}

/** The picture's size, or null while it is not known (the board waits for the image). */
export function mapSize(pack) {
    const m = pack && pack.map;
    const w = m && Number.isInteger(m.width) && m.width > 0 ? m.width : 0;
    const h = m && Number.isInteger(m.height) && m.height > 0 ? m.height : 0;
    return w && h ? { width: w, height: h } : null;
}

/** What a kept view belongs to: the picture's path and size. A view is restored on that picture alone, never on another world's. */
export function pictureKey(map) {
    if (!map || typeof map.image !== 'string' || !map.image) return '';
    return `${map.image}|${Number(map.width) || 0}x${Number(map.height) || 0}`;
}

/** The node on a place, or null: both fractions within 0..1. */
export function nodeOf(place) {
    const x = fraction(place && place.x);
    const y = fraction(place && place.y);
    return x === null || y === null ? null : { x, y };
}

/** The places on the map, in the pack's order. */
export function placedPlaces(pack) {
    return placesOf(pack).filter(p => nodeOf(p) !== null);
}

/** The places not on the map yet. */
export function unplacedPlaces(pack) {
    return placesOf(pack).filter(p => nodeOf(p) === null);
}

/** Leaflet's bounds for the picture under CRS.Simple: [[south, west], [north, east]] = [[0, 0], [height, width]]. */
export function boardBounds({ width, height }) {
    return [[0, 0], [height, width]];
}

/** A node as Leaflet's [lat, lng] over the picture: latitude grows upward, so the top of the picture is `height`. */
export function nodeLatLng(node, { width, height }) {
    const px = (v) => Math.round(v * 10000) / 10000;    // Leaflet takes any number; a round figure keeps the maths readable
    return [px(height * (1 - node.y)), px(width * node.x)];
}

/** Leaflet's [lat, lng] (a drop, a drag's end) back to a node, clamped to the picture. */
export function latLngToNode(latLng, { width, height }) {
    if (!(width > 0 && height > 0) || !Array.isArray(latLng)) return null;
    const lat = Number(latLng[0]);
    const lng = Number(latLng[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { x: fraction(clamp01(lng / width)), y: fraction(clamp01(1 - lat / height)) };
}

/**
 * A raw world (the file's shape, what the builder edits) with a place's
 * node set (`node` = { x, y }, clamped) or cleared (`node` = null). A new
 * object; the input is not touched. A place id that is not there leaves
 * the world as it is.
 */
export function withNode(raw, placeId, node) {
    const r = raw && typeof raw === 'object' ? raw : {};
    const places = (Array.isArray(r.places) ? r.places : []).map(p => {
        if (!p || typeof p !== 'object' || p.id !== placeId) return p;
        const { x, y, ...rest } = p;
        if (!node || !Number.isFinite(node.x) || !Number.isFinite(node.y)) return rest;
        return { ...rest, x: fraction(clamp01(node.x)), y: fraction(clamp01(node.y)) };
    });
    return { ...r, places };
}

/** A raw world with its picture set (`map` = { image, width, height, source }) or cleared (null). */
export function withMap(raw, map) {
    const r = raw && typeof raw === 'object' ? raw : {};
    const { map: _old, ...rest } = r;
    const m = normalizeMap(map);
    return m.image ? { ...rest, map: m } : rest;
}

/** The root of a place's chain, when the place sits under one: { id, label } or null. */
function regionOf(pack, placeId) {
    const chain = placeChain(pack, placeId);
    const root = chain.length > 1 ? chain[0] : null;
    return root ? { id: root.id, label: root.label } : null;
}

// ─── Where a person stands (one rule for the board, the tree and the sheets) ───

/**
 * The deepest place of the pack a path (a place path or a loc id) falls
 * in, or ''. On the picture (`placed`) only the placed places count: a
 * person at an unplaced sub-place stands on its nearest placed ancestor,
 * the node that shows them. On the tree every place of the pack counts.
 */
export function placeOfPath(pack, path, { placed = false } = {}) {
    if (!path || typeof path !== 'string') return '';
    const ids = new Set((placed ? placedPlaces(pack) : placesOf(pack)).map(p => p.id));
    const parts = path.split('/');
    for (let i = parts.length - 1; i >= 0; i--) if (ids.has(parts[i])) return parts[i];
    return '';
}

/**
 * The key a path stands under on a board: the pack place (`placeOfPath`),
 * else on the tree the path itself (the story's own place, a loc id, has
 * a chip of its own under Elsewhere), else '' (nowhere on the picture).
 */
export function keyOfPath(pack, path, { placed = false } = {}) {
    const id = placeOfPath(pack, path, { placed });
    if (id) return id;
    return placed ? '' : String(path || '');
}

/**
 * Where the party is, as a board key: the Map window's rule (the newest
 * visited place, `currentPlace`) read through `keyOfPath`. Live World
 * never places the player in `where` (the world does not move the
 * player), so the party's place is the visited row's.
 */
export function partyAt(pack, state, { placed = false } = {}) {
    const here = currentPlace(state);
    if (!here) return '';
    if (here.packId) return keyOfPath(pack, here.path || placePath(pack, here.packId) || here.packId, { placed });
    return keyOfPath(pack, String(here.id || ''), { placed });
}

/** The player's place as a board key: an entry of `where` under their name when one exists (a test state), else the party's. */
export function playerPlace(pack, state, player = '', { placed = false } = {}) {
    const where = state && state.where && typeof state.where === 'object' ? state.where : {};
    const at = player && where[player] ? keyOfPath(pack, String(where[player]), { placed }) : '';
    return at || partyAt(pack, state, { placed });
}

/**
 * Who is at a place (a pack place or a story place's key), by the board's
 * rule or the tree's: the people last seen there, the player apart, and
 * whether the party is there. The place sheet and the Start sheet read
 * this, so a face on a node is a face on its sheet.
 */
export function peopleAt(pack, state, placeId, { placed = false, player = '' } = {}) {
    const where = state && state.where && typeof state.where === 'object' ? state.where : {};
    const people = [];
    if (placeId) for (const [name, at] of Object.entries(where)) if (!(player && name === player) && keyOfPath(pack, at, { placed }) === placeId) people.push(name);
    return { people, player: !!placeId && playerPlace(pack, state, player, { placed }) === placeId };
}

/** The name of a board key that is no pack place: the visited row's label when the story named it, else the loc id read as words. */
export function labelOfKey(state, key) {
    const list = state && Array.isArray(state.visited) ? state.visited : [];
    const v = list.find(e => e && e.id === key && e.label);
    if (v) return v.label;
    return isLocId(key) ? locLabel(key) : String(key || '');
}

/** The picture a place shows: the one a scene drew for it (the state's visited row, which the snapshot keeps), else the pack's art. */
export function placeImage(pack, state, placeId) {
    const list = state && Array.isArray(state.visited) ? state.visited : [];
    const drawn = list.find(e => e && typeof e.image === 'string' && e.image && (e.packId === placeId || e.id === placeId));
    if (drawn) return drawn.image;
    const p = placesOf(pack).find(x => x.id === placeId);
    return p && p.image ? p.image : '';
}

// ─── What the boards draw ───────────────────────────────────────────────

/**
 * What the board draws.
 * @param {object} o
 * @param {object} o.pack            the world
 * @param {object|null} o.state      the world state the board shows (the snapshot's, or the chat's)
 * @param {string} o.player          the player's name (shown as "you")
 * @param {Object<string,{emoji?:string,text?:string}>} o.weather  by region id (phase 3; empty today)
 * @returns {{ nodes: Array, unplaced: Array<{id:string,label:string}>, elsewhere: Array<{name:string,at:string,label:string}>, playerAt: string }}
 */
export function boardModel({ pack, state = null, player = '', weather = {} } = {}) {
    const places = placedPlaces(pack);
    const visited = new Set(state && Array.isArray(state.visited) ? state.visited.map(v => v && v.id).filter(Boolean) : []);
    const where = state && state.where && typeof state.where === 'object' ? state.where : {};
    const people = new Map(places.map(p => [p.id, []]));
    const elsewhere = [];
    const playerAt = playerPlace(pack, state, player, { placed: true });
    for (const [name, at] of Object.entries(where)) {
        if (player && name === player) continue;
        const id = keyOfPath(pack, at, { placed: true });
        if (id) { people.get(id).push(name); continue; }
        // Nowhere on the picture: at a pack place with no placed ancestor (named by that place), or at the story's own place.
        const deep = placeOfPath(pack, at, { placed: false });
        const label = deep ? (placesOf(pack).find(p => p.id === deep) || {}).label || deep : labelOfKey(state, String(at || ''));
        elsewhere.push({ name, at: String(at || ''), label });
    }
    const nodes = places.map(p => {
        const node = nodeOf(p);
        const region = regionOf(pack, p.id);
        const w = region && weather && weather[region.id] ? weather[region.id] : (weather && weather[p.id] ? weather[p.id] : null);
        return {
            id: p.id,
            label: p.label,
            x: node.x,
            y: node.y,
            image: placeImage(pack, state, p.id),
            region: region ? region.label : '',
            regionId: region ? region.id : '',
            isRegion: !region,
            path: placePath(pack, p.id),
            visited: visited.has(p.id) || visited.has(placePath(pack, p.id)),
            people: people.get(p.id),
            player: playerAt === p.id,
            weather: w ? { emoji: w.emoji || '', text: w.text || '' } : null,
        };
    });
    return { nodes, unplaced: unplacedPlaces(pack).map(p => ({ id: p.id, label: p.label })), elsewhere, playerAt };
}
