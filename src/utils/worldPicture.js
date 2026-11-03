/**
 * The world's picture and its nodes (docs/hub-plan.md D124, D135, D136),
 * pure; the Map window's own pure model is worldMap.js, this is the
 * hub's board. A place's node is a fraction of the picture from its top-left
 * (`x`, `y` in 0..1 on the place); the board projects it to Leaflet's
 * units from the picture's own size, where latitude grows upward, and
 * back on a drag. `boardModel` is what the board draws: the placed places
 * with the people last seen at them, the player's place, the visited
 * ones, the region's weather; and what is not on the map yet.
 * tools/hub-board-test.mjs.
 */
import { placeChain, placePath, fraction, normalizeMap } from './liveWorld.js';

export { fraction, normalizeMap };

export const MAX_ZOOM_IN = 4;    // the board zooms in to four times the picture's own size (D124)

const clamp01 = (n) => Math.min(1, Math.max(0, n));

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

/** The node on a place, or null: both fractions within 0..1. */
export function nodeOf(place) {
    const x = fraction(place && place.x);
    const y = fraction(place && place.y);
    return x === null || y === null ? null : { x, y };
}

/** The places on the map, in the pack's order. */
export function placedPlaces(pack) {
    return (pack && Array.isArray(pack.places) ? pack.places : []).filter(p => nodeOf(p) !== null);
}

/** The places not on the map yet. */
export function unplacedPlaces(pack) {
    return (pack && Array.isArray(pack.places) ? pack.places : []).filter(p => nodeOf(p) === null);
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

/** The deepest placed place a path (a place path or a loc id) falls in, or ''. */
function placedAt(pack, path, placedIds) {
    if (!path || typeof path !== 'string') return '';
    const parts = path.split('/');
    for (let i = parts.length - 1; i >= 0; i--) if (placedIds.has(parts[i])) return parts[i];
    return '';
}

/**
 * What the board draws.
 * @param {object} o
 * @param {object} o.pack            the world
 * @param {object|null} o.state      the world state the board shows (the snapshot's, or the chat's)
 * @param {string} o.player          the player's name (shown as "you")
 * @param {Object<string,{emoji?:string,text?:string}>} o.weather  by region id (phase 3; empty today)
 * @returns {{ nodes: Array, unplaced: Array<{id:string,label:string}>, elsewhere: Array<{name:string,at:string}>, playerAt: string }}
 */
export function boardModel({ pack, state = null, player = '', weather = {} } = {}) {
    const places = placedPlaces(pack);
    const placedIds = new Set(places.map(p => p.id));
    const visited = new Set(state && Array.isArray(state.visited) ? state.visited.map(v => v && v.id).filter(Boolean) : []);
    const where = state && state.where && typeof state.where === 'object' ? state.where : {};
    const people = new Map(places.map(p => [p.id, []]));
    const elsewhere = [];
    let playerAt = '';
    for (const [name, at] of Object.entries(where)) {
        const id = placedAt(pack, at, placedIds);
        if (player && name === player) { playerAt = id; continue; }
        if (id) people.get(id).push(name);
        else elsewhere.push({ name, at: String(at || '') });
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
            image: p.image || '',
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
