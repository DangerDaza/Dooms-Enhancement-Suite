/**
 * World gen (docs/long-shot-plan.md D182–D186, D192): a whole world made
 * from a seed, before anything is placed on it.
 *
 *   generateWorld(spec)        the geography: land and sea in one of four
 *                              shapes, mountain ranges, lakes, rivers,
 *                              forests, and the ground of three climates
 *                              (desert, snow, marsh).
 *                              The same seed and choices give the same
 *                              world every time, so only those are kept in
 *                              the map's book, never the shapes.
 *   suggestSites(world, n)     where n regions would stand, spread evenly
 *                              over the land.
 *   divideWorld(world, sites)  the land divided between the regions that
 *                              stand on it: each spreads from its own spot,
 *                              slower over the mountains and across a river,
 *                              so borders tend to run along the ranges and
 *                              the rivers. Move a region, add
 *                              one or take one away and the borders follow;
 *                              the geography never changes.
 *   travelField / roadCost     how long the way is over that ground:
 *                              slower through forest, desert, snow and
 *                              marsh, much slower over mountains; a river
 *                              is waded; water is crossed by boat, which
 *                              costs a wait before it saves any time.
 *
 * Made on a grid of half-unit squares, then traced into outlines along
 * the grid's own corners; the corners are eased once for everything that
 * passes through them, so two regions that share a border share its very
 * points and the lands tile the land exactly. Pure, no SillyTavern, no
 * AI: tools/world-gen-test.mjs imports this directly.
 */

export const WORLD_SHAPES = Object.freeze([
    { id: 'pangea', label: 'Pangea', hint: 'One great landmass with the sea all round it.' },
    { id: 'earth', label: 'Like our world', hint: 'Several continents, large and small, with oceans between them.' },
    { id: 'islands', label: 'Islands', hint: 'An archipelago: many islands and no mainland.' },
    { id: 'divide', label: 'Divide', hint: 'Two continents facing each other across a sea.' },
]);
export const WORLD_SIZES = Object.freeze({
    small: { label: 'Small', w: 48, h: 32 },
    medium: { label: 'Medium', w: 64, h: 44 },
    large: { label: 'Large', w: 88, h: 60 },
});
export const WORLD_LIMITS = Object.freeze({ minW: 24, minH: 16, maxW: 160, maxH: 110 });
export const WORLD_REGIONS = Object.freeze({ min: 0, max: 24, default: 9 });
export const WORLD_CELL = 0.5;        // a grid square's side, in layout units
export const WORLD_KINDS = Object.freeze({ sea: 0, plain: 1, forest: 2, mountain: 3, lake: 4, desert: 5, snow: 6, swamp: 7 });
const KIND_NAMES = ['sea', 'plain', 'forest', 'mountain', 'lake', 'desert', 'snow', 'swamp'];
const { sea: SEA, plain: PLAIN, forest: FOREST, mountain: MOUNTAIN, lake: LAKE, desert: DESERT, snow: SNOW, swamp: SWAMP } = WORLD_KINDS;
/** How many times as long a stretch takes as the same stretch over open ground. Water is crossed by boat. */
export const TERRAIN_PACE = Object.freeze({ plain: 1, forest: 1.25, mountain: 2.5, desert: 1.3, snow: 1.6, swamp: 1.8, water: 0.5 });
export const ROAD_PACE = Object.freeze({ plain: 1, forest: 1, mountain: 1.5, desert: 1, snow: 1.25, swamp: 1.25, water: 0.5 });    // a road through a wood is a road; over the mountains it is a pass; snow and marsh slow even a road
export const FORD = 0.12;    // wading a river where no road bridges it, as a part of the wait to take ship
const ADRIFT = 12;    // land no region can walk to goes with a region this near across the water, else it is nobody's

const round4 = (n) => Math.round(n * 10000) / 10000;
const finite = (n) => typeof n === 'number' && Number.isFinite(n);
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const cleanSeed = (v) => String(v ?? '').normalize('NFC').replace(/\s+/g, ' ').trim().slice(0, 40);
const STEPS4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const STEPS8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

// ─── Chance, the same every time ────────────────────────────────────────────

/** A string to a whole number (FNV-1a). */
function hashInt(text) {
    let h = 0x811c9dc5;
    const s = String(text);
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return h >>> 0;
}

/** A run of numbers from 0 to 1, the same run for the same start (mulberry32). */
function rngOf(seed) {
    let a = hashInt(seed) || 1;
    return () => {
        a |= 0; a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** A number from 0 to 1 for a point of a lattice. */
function lattice(ix, iy, salt) {
    let h = Math.imul(ix | 0, 374761393) ^ Math.imul(iy | 0, 668265263) ^ Math.imul(salt | 0, 974711);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Smooth noise from 0 to 1 over the plane. */
function noise(x, y, salt) {
    const ix = Math.floor(x), iy = Math.floor(y);
    const fx = x - ix, fy = y - iy;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const a = lattice(ix, iy, salt), b = lattice(ix + 1, iy, salt), c = lattice(ix, iy + 1, salt), d = lattice(ix + 1, iy + 1, salt);
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

/** Four layers of it, the finer the fainter: from 0 to 1. */
function fbm(x, y, salt) {
    return (noise(x, y, salt) + 0.5 * noise(x * 2, y * 2, salt + 17) + 0.25 * noise(x * 4, y * 4, salt + 31) + 0.125 * noise(x * 8, y * 8, salt + 43)) / 1.875;
}

/** A small heap of [cost, ...] rows, the cheapest first. */
function heapOf() {
    const h = [];
    return {
        get size() { return h.length; },
        push(row) { h.push(row); let n = h.length - 1; while (n > 0) { const p = (n - 1) >> 1; if (h[p][0] <= h[n][0]) break; [h[p], h[n]] = [h[n], h[p]]; n = p; } },
        pop() {
            const top = h[0], last = h.pop();
            if (h.length) { h[0] = last; let n = 0; for (;;) { const a = 2 * n + 1, b = a + 1; let m = n; if (a < h.length && h[a][0] < h[m][0]) m = a; if (b < h.length && h[b][0] < h[m][0]) m = b; if (m === n) break; [h[m], h[n]] = [h[n], h[m]]; n = m; } }
            return top;
        },
    };
}

// ─── What is asked for ──────────────────────────────────────────────────────

/**
 * What a world is made from, made safe: the seed, the shape, how wide
 * and tall it is, where its middle is on the map, and the points that
 * must be land (what stood on the map when the world was made around
 * it). Null when there is no seed: no world.
 */
export function normalizeWorldSpec(raw) {
    const r = raw && typeof raw === 'object' ? raw : null;
    const seed = r ? cleanSeed(r.seed) : '';
    if (!seed) return null;
    const size = WORLD_SIZES[r.size] || null;
    const even = (n) => Math.round(n / 2) * 2;
    const w = even(clamp(finite(r.w) ? r.w : (size || WORLD_SIZES.medium).w, WORLD_LIMITS.minW, WORLD_LIMITS.maxW));
    const h = even(clamp(finite(r.h) ? r.h : (size || WORLD_SIZES.medium).h, WORLD_LIMITS.minH, WORLD_LIMITS.maxH));
    const anchors = (Array.isArray(r.anchors) ? r.anchors : []).filter(p => p && finite(p.x) && finite(p.y)).slice(0, 200).map(p => ({ x: round4(p.x), y: round4(p.y) }));
    return {
        v: 1, seed,
        shape: WORLD_SHAPES.some(s => s.id === r.shape) ? r.shape : 'pangea',
        w, h,
        cx: finite(r.cx) && Math.abs(r.cx) <= 1e5 ? round4(r.cx) : 0,
        cy: finite(r.cy) && Math.abs(r.cy) <= 1e5 ? round4(r.cy) : 0,
        anchors,
    };
}

/** The name of the size a world is ('small', 'medium', 'large'), or 'custom' when it was widened to hold what was placed. */
export function sizeOfWorld(spec) {
    for (const [id, s] of Object.entries(WORLD_SIZES)) if (spec && spec.w === s.w && spec.h === s.h) return id;
    return 'custom';
}

/** A seed nobody typed: a short word of letters and digits. */
export function randomSeed(chance = Math.random) {
    const a = 'abcdefghjkmnpqrstuvwxyz23456789';
    let s = '';
    for (let i = 0; i < 6; i++) s += a[Math.floor(chance() * a.length) % a.length];
    return s;
}

/**
 * What to ask for, for a world made around what stands on a map: its
 * middle on theirs, wide and tall enough to hold them with room to
 * spare, and land under every one of them. With nothing placed: the size
 * asked for, about the map's middle.
 */
export function worldSpecFor({ seed = '', shape = 'pangea', size = 'medium', spots = [] } = {}) {
    const base = WORLD_SIZES[size] || WORLD_SIZES.medium;
    const pts = (Array.isArray(spots) ? spots : []).filter(p => p && finite(p.x) && finite(p.y));
    if (!pts.length) return normalizeWorldSpec({ seed, shape, w: base.w, h: base.h, cx: 0, cy: 0, anchors: [] });
    const minX = Math.min(...pts.map(p => p.x)), maxX = Math.max(...pts.map(p => p.x)), minY = Math.min(...pts.map(p => p.y)), maxY = Math.max(...pts.map(p => p.y));
    // What is placed keeps to the middle two thirds of the world, so there is land around it and sea beyond that.
    return normalizeWorldSpec({
        seed, shape,
        w: Math.max(base.w, (maxX - minX) * 1.5 + 14), h: Math.max(base.h, (maxY - minY) * 1.5 + 12),
        cx: Math.round((minX + maxX) / 2), cy: Math.round((minY + maxY) / 2),
        anchors: pts,
    });
}

// ─── The land and the sea ───────────────────────────────────────────────────

/** The landmasses a shape is built from: rounds in a square from -1 to 1 each way, { x, y, rx, ry }. */
function blobsOf(shape, rng) {
    const j = (v, by) => v + (rng() * 2 - 1) * by;
    if (shape === 'earth') {
        const flip = rng() < 0.5 ? -1 : 1;
        const base = [
            [-0.6, -0.36, 0.25, 0.36], [-0.5, 0.4, 0.16, 0.38],                  // two that hang one under the other
            [0.0, -0.44, 0.2, 0.24], [0.4, -0.4, 0.42, 0.3],                     // a wide one across the top
            [0.06, 0.26, 0.2, 0.4], [0.68, 0.5, 0.19, 0.17],                     // one below it, and a far one alone
        ];
        return base.map(([x, y, rx, ry]) => ({ x: flip * j(x, 0.06), y: j(y, 0.06), rx: rx * j(1, 0.15), ry: ry * j(1, 0.15) }));
    }
    if (shape === 'islands') {
        const out = [];
        const n = 11 + Math.floor(rng() * 5);
        for (let guard = 0; out.length < n && guard < 500; guard++) {
            const big = out.length < 3;
            const b = { x: (rng() * 2 - 1) * 0.78, y: (rng() * 2 - 1) * 0.72, rx: (big ? 0.15 : 0.07) + rng() * 0.09, ry: (big ? 0.15 : 0.07) + rng() * 0.09 };
            if (out.every(o => Math.hypot((o.x - b.x) / (o.rx + b.rx), (o.y - b.y) / (o.ry + b.ry)) > 1.12)) out.push(b);    // sea between every two
        }
        return out;
    }
    if (shape === 'divide') {
        const out = [];
        for (const side of [-1, 1]) {
            const lean = (rng() * 2 - 1) * 0.07;
            out.push({ x: side * j(0.56, 0.04), y: j(-0.48, 0.05) + lean, rx: j(0.27, 0.04), ry: j(0.36, 0.04) });
            out.push({ x: side * j(0.5, 0.05), y: j(0.02, 0.06), rx: j(0.3, 0.04), ry: j(0.36, 0.04) });
            out.push({ x: side * j(0.58, 0.05), y: j(0.5, 0.05) - lean, rx: j(0.25, 0.04), ry: j(0.34, 0.04) });
        }
        if (rng() < 0.7) out.push({ x: j(0, 0.03), y: j(0, 0.45), rx: 0.075, ry: 0.085, isle: true });    // an isle in the sea between them
        return out;
    }
    // Pangea: one great round, with lobes on its rim.
    const out = [{ x: j(0, 0.04), y: j(0, 0.04), rx: 0.68, ry: 0.66 }];
    const lobes = 3 + Math.floor(rng() * 3);
    for (let i = 0; i < lobes; i++) { const t = rng() * Math.PI * 2; out.push({ x: Math.cos(t) * 0.52, y: Math.sin(t) * 0.5, rx: 0.2 + rng() * 0.2, ry: 0.2 + rng() * 0.2 }); }
    return out;
}

// ─── Outlines from the grid ─────────────────────────────────────────────────

/** The rings that bound the squares where `inside` holds: each a list of corner ids, the squares on the right as it is walked. */
function traceRings(cols, rows, inside) {
    const V = (i, j) => j * (cols + 1) + i;
    const from = new Map();
    const add = (a, b, dir) => { let l = from.get(a); if (!l) { l = []; from.set(a, l); } l.push({ end: b, dir, used: false }); };
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
        if (!inside(i, j)) continue;
        if (!inside(i, j - 1)) add(V(i, j), V(i + 1, j), 0);
        if (!inside(i + 1, j)) add(V(i + 1, j), V(i + 1, j + 1), 1);
        if (!inside(i, j + 1)) add(V(i + 1, j + 1), V(i, j + 1), 2);
        if (!inside(i - 1, j)) add(V(i, j + 1), V(i, j), 3);
    }
    const rings = [];
    for (const [start, list] of from) for (const first of list) {
        if (first.used) continue;
        const ring = [start];
        let e = first;
        e.used = true;
        for (let guard = 0; e.end !== start && guard < 4000000; guard++) {
            ring.push(e.end);
            const next = (from.get(e.end) || []).filter(x => !x.used);
            if (!next.length) break;
            // Where two squares meet only at a corner, keep round the same square: the turn to the right first.
            let pick = null;
            for (const d of [(e.dir + 1) % 4, e.dir, (e.dir + 3) % 4]) { pick = next.find(x => x.dir === d); if (pick) break; }
            e = pick || next[0];
            e.used = true;
        }
        if (ring.length >= 4) rings.push(ring);
    }
    return rings;
}

/** A ring's area with its sign: above nothing for a ring round its squares, below for a ring round a hole in them. */
const ringArea = (pts) => { let a = 0; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1]; return a / 2; };

function pointInRing(poly, x, y) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const [xi, yi] = poly[i], [xj, yj] = poly[j];
        if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
}

/** Rings as shapes: every ring round its squares with the holes that lie in it, the largest shape first. Each shape is [outer, ...holes]. */
function partsOf(rings) {
    const outers = [], holes = [];
    for (const r of rings) { const a = ringArea(r); if (a > 0) outers.push({ ring: r, area: a, holes: [] }); else if (a < 0) holes.push(r); }
    outers.sort((a, b) => b.area - a.area);
    for (const h of holes) {
        // A hole lies in the smallest ring that holds it.
        let home = null;
        const mid = h[Math.floor(h.length / 2)];
        for (const o of outers) if (pointInRing(o.ring, h[0][0], h[0][1]) || pointInRing(o.ring, mid[0], mid[1])) home = o;
        if (home) home.holes.push(h);
    }
    return outers.map(o => [o.ring, ...o.holes]);
}

/**
 * Where the corners of a set of rings stand once eased: each starts at
 * its place on the grid, nudged a little by the world's own chance, and
 * is drawn toward the two corners beside it; a corner where more than
 * two lines meet, or one held from outside (`fixed`), stays put.
 * @returns {Map<number, number[]>} corner id -> [x, y] in grid squares
 */
function easeCorners(rings, cols, salt, { fixed = null, passes = 3, nudge = 0.5 } = {}) {
    const adj = new Map();
    const link = (a, b) => { let s = adj.get(a); if (!s) { s = new Set(); adj.set(a, s); } s.add(b); };
    for (const r of rings) for (let i = 0; i < r.length; i++) { const a = r[i], b = r[(i + 1) % r.length]; link(a, b); link(b, a); }
    let pos = new Map();
    for (const v of adj.keys()) {
        if (fixed && fixed.has(v)) { pos.set(v, fixed.get(v)); continue; }
        const i = v % (cols + 1), j = (v - i) / (cols + 1);
        pos.set(v, [i + (lattice(i, j, salt + 7) - 0.5) * nudge, j + (lattice(i, j, salt + 9) - 0.5) * nudge]);
    }
    for (let pass = 0; pass < passes; pass++) {
        const next = new Map();
        for (const [v, p] of pos) {
            const ns = adj.get(v);
            if (ns.size !== 2 || (fixed && fixed.has(v))) { next.set(v, p); continue; }
            let sx = p[0], sy = p[1];
            for (const n of ns) { const q = pos.get(n); sx += q[0]; sy += q[1]; }
            next.set(v, [sx / 3, sy / 3]);
        }
        pos = next;
    }
    return pos;
}

/** A peak's lines about the middle of its foot: its shape (open at the foot), the ridge down its face, its shaded side. */
function peakLines(key, x, y, s) {
    const w = s * 0.62, h = s * 1.05;
    const lean = ((hashInt(`${key}/a`) % 100) / 100 - 0.5) * 0.3 * w;
    const j1 = ((hashInt(`${key}/b`) % 100) / 100 - 0.5) * 0.14 * h, j2 = ((hashInt(`${key}/c`) % 100) / 100 - 0.5) * 0.14 * h;
    const at = (ox, oy) => [round4(x + ox), round4(y + oy)];
    return [
        [at(-w, 0), at(-0.45 * w, -0.56 * h + j1), at(lean, -h), at(0.48 * w, -0.5 * h + j2), at(w, 0)],
        [at(lean, -h), at(lean * 0.4 + 0.14 * w, -0.56 * h), at(-0.06 * w, -0.16 * h)],
        [at(0.36 * w, -0.4 * h), at(0.24 * w, -0.1 * h)], [at(0.62 * w, -0.26 * h), at(0.54 * w, -0.05 * h)],
    ];
}

/** A tree's two lines: a crown and a trunk. */
function treeLines(x, y, sz) {
    const pt = (ox, oy) => [round4(x + ox * sz), round4(y + oy * sz)];
    return [[pt(0, -1), pt(0.5, -0.55), pt(0.55, -0.05), pt(0, 0.2), pt(-0.55, -0.05), pt(-0.5, -0.55), pt(0, -1)], [pt(0, 0.2), pt(0, 0.7)]];
}

// ─── The geography ──────────────────────────────────────────────────────────

const made = new Map();    // what was asked for (as text) -> the world made of it: the last few are kept

/**
 * The world made from what is asked for (normalizeWorldSpec): its land
 * and sea, mountains, lakes and forests. No regions: those are whoever
 * stands on it (divideWorld). The same asking gives the same world; the
 * last few made are kept, so drawing one again costs nothing.
 * @returns {null | {
 *   spec: object, key: string, cell: number, bounds: { minX: number, minY: number, maxX: number, maxY: number },
 *   coasts: number[][][][], masses: Array<{ id: number, area: number }>, landArea: number,
 *   peaks: Array<{ x: number, y: number, s: number, snowy: boolean, lines: number[][][] }>, ranges: number[][][],
 *   lakes: number[][][][], forests: number[][][][], trees: Array<{ x: number, y: number, lines: number[][][] }>,
 *   deserts: number[][][][], snows: number[][][][], swamps: number[][][][],
 *   dunes: Array<{ x: number, y: number, lines: number[][][] }>, reeds: Array<{ x: number, y: number, lines: number[][][] }>,
 *   rivers: Array<{ id: number, big: boolean, points: number[][] }>,
 *   kindAt: (x: number, y: number) => string, isLand: (x: number, y: number) => boolean,
 *   grid: object }}
 *   `coasts`, `lakes` and `forests` are shapes: each [outer, ...holes], rings of [x, y].
 */
export function generateWorld(rawSpec) {
    const spec = normalizeWorldSpec(rawSpec);
    if (!spec) return null;
    const key = JSON.stringify(spec);
    if (made.has(key)) { const hit = made.get(key); made.delete(key); made.set(key, hit); return hit; }
    const world = build(spec, key);
    made.set(key, world);
    while (made.size > 6) made.delete(made.keys().next().value);
    return world;
}

function build(spec, key) {
    const rng = rngOf(`${spec.seed}/${spec.shape}`);
    const salt = hashInt(`${spec.seed}/noise`) % 100000;
    const c = WORLD_CELL;
    const cols = Math.round(spec.w / c), rows = Math.round(spec.h / c);
    const ox = spec.cx - spec.w / 2, oy = spec.cy - spec.h / 2;
    const N = cols * rows;
    const idx = (i, j) => j * cols + i;
    const inGrid = (i, j) => i >= 0 && j >= 0 && i < cols && j < rows;
    const wx = (i) => ox + (i + 0.5) * c, wy = (j) => oy + (j + 0.5) * c;    // a square's middle on the map
    const xOf = (k) => wx(k % cols), yOf = (k) => wy((k - k % cols) / cols);
    const cellOf = (x, y) => { const i = Math.floor((x - ox) / c), j = Math.floor((y - oy) / c); return inGrid(i, j) ? idx(i, j) : -1; };

    // 1. Land or sea: the shape's rounds, pulled about and roughened, falling away to sea at the map's edge; land under every anchor.
    const blobs = blobsOf(spec.shape, rng);
    const rough = spec.shape === 'islands' ? 0.5 : 0.62;
    const land = new Uint8Array(N);
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
        const u = ((i + 0.5) / cols) * 2 - 1, v = ((j + 0.5) / rows) * 2 - 1;
        const nx = (i * c) / 15, ny = (j * c) / 15;    // the roughness is as wide one way as the other, whatever the map's shape
        const pu = u + (fbm(nx * 0.8 + 11, ny * 0.8 + 5, salt + 3) - 0.5) * 0.3, pv = v + (fbm(nx * 0.8 + 31, ny * 0.8 + 47, salt + 4) - 0.5) * 0.3;
        let f = -Infinity;
        for (const b of blobs) { const dx = (pu - b.x) / b.rx, dy = (pv - b.y) / b.ry; f = Math.max(f, 1 - (dx * dx + dy * dy)); }
        f = Math.min(f, 0.9) + (fbm(nx * 1.6 + 40, ny * 1.6 + 40, salt) - 0.5) * 2 * rough
            + (noise(nx * 5.5 + 9, ny * 5.5 + 2, salt + 61) - 0.5) * 0.42 + (noise(nx * 11 + 4, ny * 11 + 8, salt + 62) - 0.5) * 0.22;    // bays and headlands, then coves
        if (spec.shape === 'divide' && !blobs.some(b => b.isle && Math.hypot((u - b.x) / b.rx, (v - b.y) / b.ry) < 1.3)) f -= 1.6 * Math.exp(-Math.pow(u / 0.16, 2));
        const edge = Math.max(Math.abs(u), Math.abs(v));
        if (edge > 0.86) f -= ((edge - 0.86) / 0.14) * 2.5;
        const x = wx(i), y = wy(j);
        for (const a of spec.anchors) { const d = Math.hypot(a.x - x, a.y - y); if (d < 2.8) f = Math.max(f, 0.7 * (1 - Math.pow(d / 2.8, 2))); }
        land[idx(i, j)] = f > 0 && i > 0 && j > 0 && i < cols - 1 && j < rows - 1 ? 1 : 0;
    }
    // Specks of land and pinholes of sea are smoothed away: a square goes with most of the eight about it.
    for (let pass = 0; pass < 2; pass++) {
        const next = new Uint8Array(land);
        for (let j = 1; j < rows - 1; j++) for (let i = 1; i < cols - 1; i++) {
            let n = 0;
            for (const [di, dj] of STEPS8) n += land[idx(i + di, j + dj)];
            if (land[idx(i, j)] && n <= 2) next[idx(i, j)] = 0;
            else if (!land[idx(i, j)] && n >= 6) next[idx(i, j)] = 1;
        }
        land.set(next);
    }
    // A scrap of land too small to stand on goes back to the sea, unless something was placed on it.
    {
        const seen = new Uint8Array(N);
        const held = new Set(spec.anchors.map(a => cellOf(a.x, a.y)));
        for (let s = 0; s < N; s++) {
            if (!land[s] || seen[s]) continue;
            const scrap = [s];
            seen[s] = 1;
            for (let n = 0; n < scrap.length; n++) {
                const k = scrap[n];
                const i = k % cols, j = (k - i) / cols;
                for (const [di, dj] of STEPS4) { const a = i + di, b = j + dj; if (inGrid(a, b) && land[idx(a, b)] && !seen[idx(a, b)]) { seen[idx(a, b)] = 1; scrap.push(idx(a, b)); } }
            }
            if (scrap.length < 8 && !scrap.some(k => held.has(k))) for (const k of scrap) land[k] = 0;
        }
    }
    const kind = new Uint8Array(N);
    for (let s = 0; s < N; s++) kind[s] = land[s] ? PLAIN : SEA;
    // Water the open sea does not reach is a lake of the land around it.
    {
        const open = new Uint8Array(N);
        const q = [];
        for (let i = 0; i < cols; i++) { q.push(idx(i, 0), idx(i, rows - 1)); }
        for (let j = 0; j < rows; j++) { q.push(idx(0, j), idx(cols - 1, j)); }
        for (const k of q) open[k] = 1;
        while (q.length) {
            const k = q.pop();
            const i = k % cols, j = (k - i) / cols;
            for (const [di, dj] of STEPS4) { const a = i + di, b = j + dj; if (inGrid(a, b) && !land[idx(a, b)] && !open[idx(a, b)]) { open[idx(a, b)] = 1; q.push(idx(a, b)); } }
        }
        for (let s = 0; s < N; s++) if (!land[s] && !open[s]) { land[s] = 1; kind[s] = LAKE; }
    }

    // 2. The landmasses, and how far each square of land is from the sea.
    const mass = new Int16Array(N).fill(-1);
    const massCells = [];
    for (let s = 0; s < N; s++) {
        if (!land[s] || mass[s] >= 0) continue;
        const id = massCells.length;
        const q = [s];
        mass[s] = id;
        let n = 0;
        while (q.length) {
            const k = q.pop();
            n++;
            const i = k % cols, j = (k - i) / cols;
            for (const [di, dj] of STEPS4) { const a = i + di, b = j + dj; if (inGrid(a, b) && land[idx(a, b)] && mass[idx(a, b)] < 0) { mass[idx(a, b)] = id; q.push(idx(a, b)); } }
        }
        massCells.push(n);
    }
    const shore = new Int16Array(N).fill(-1);    // squares from the sea, by steps of one square
    {
        let q = [];
        for (let s = 0; s < N; s++) if (!land[s]) { shore[s] = 0; q.push(s); }
        for (let d = 1; q.length; d++) {
            const nq = [];
            for (const k of q) {
                const i = k % cols, j = (k - i) / cols;
                for (const [di, dj] of STEPS4) { const a = i + di, b = j + dj; if (inGrid(a, b) && shore[idx(a, b)] < 0) { shore[idx(a, b)] = d; nq.push(idx(a, b)); } }
            }
            q = nq;
        }
    }
    const landCells = [];
    for (let s = 0; s < N; s++) if (land[s]) landCells.push(s);
    const nearAnchor = (x, y, r) => spec.anchors.some(a => Math.hypot(a.x - x, a.y - y) < r);

    // 3. Mountain ranges: lines that wander across the land, well inside the shore.
    const ranges = [];
    const peakSpots = [];
    for (let m = 0; m < massCells.length; m++) {
        const area = massCells[m] * c * c;
        const n = area < 40 ? 0 : clamp(Math.round(area / 210), 1, 9);
        const inland = landCells.filter(s => mass[s] === m && shore[s] >= 4 && kind[s] === PLAIN);
        for (let r = 0; r < n && inland.length; r++) {
            let start = inland[Math.floor(rng() * inland.length)];
            for (let t = 0; t < 6; t++) { const o = inland[Math.floor(rng() * inland.length)]; if (shore[o] > shore[start]) start = o; }
            const x = xOf(start), y = yOf(start);
            if (ranges.some(line => line.some(([px, py]) => Math.hypot(px - x, py - y) < 4.5))) continue;
            const way = rng() * Math.PI * 2;
            const long = 7 + rng() * 12;
            const grow = (dir) => {
                let px = x, py = y, w = way + (dir < 0 ? Math.PI : 0);
                const got = [];
                for (let d = 0; d < long / 2; d += 0.6) {
                    w += (rng() - 0.5) * 0.5;
                    px += Math.cos(w) * 0.6; py += Math.sin(w) * 0.6;
                    const k = cellOf(px, py);
                    if (k < 0 || !land[k] || kind[k] === LAKE || shore[k] < 3) break;
                    got.push([px, py]);
                }
                return got;
            };
            const ahead = grow(1), behind = grow(-1);
            const whole = [...behind.reverse(), [x, y], ...ahead];
            if (whole.length < 6) continue;
            ranges.push(whole.map(([px, py]) => [round4(px), round4(py)]));
        }
    }
    for (let r = 0; r < ranges.length; r++) {
        const line = ranges[r];
        for (let p = 0; p < line.length; p++) {
            const [x, y] = line[p];
            // The ground for a unit about the line is mountain.
            for (let dj = -3; dj <= 3; dj++) for (let di = -3; di <= 3; di++) {
                const k = cellOf(x + di * c, y + dj * c);
                if (k >= 0 && land[k] && kind[k] !== LAKE && Math.hypot(di * c, dj * c) <= 1.15) kind[k] = MOUNTAIN;
            }
            const mid = 1 - Math.pow((2 * p) / (line.length - 1) - 1, 2);
            if (p % 2 === 0) peakSpots.push({ key: `${spec.seed}/r${r}/p${p}`, x, y: y + 0.3, s: 0.75 + 0.5 * mid + 0.2 * rng() });
            if (p % 3 === 1 && mid > 0.3) { const side = rng() < 0.5 ? -1 : 1; peakSpots.push({ key: `${spec.seed}/r${r}/f${p}`, x: x + side * (0.7 + rng() * 0.3), y: y + 0.3 + (rng() - 0.5) * 0.5, s: 0.55 + 0.2 * rng() }); }
        }
    }

    // 4. Lakes: well inside the land, off the mountains, apart from one another and from every anchor.
    const lakeSpots = [];
    for (let m = 0; m < massCells.length; m++) {
        const area = massCells[m] * c * c;
        const n = area < 90 ? 0 : clamp(Math.round(area / 300), 0, 7);
        const basin = landCells.filter(s => mass[s] === m && shore[s] >= 5 && kind[s] === PLAIN);
        for (let l = 0, guard = 0; l < n && basin.length && guard < 80; guard++) {
            const s = basin[Math.floor(rng() * basin.length)];
            const x = xOf(s), y = yOf(s);
            const r = 0.8 + rng() * 1.2, long = r * (1.1 + rng() * 0.8), turn = rng() * Math.PI;
            if (lakeSpots.some(o => Math.hypot(o.x - x, o.y - y) < o.reach + long + 3)) continue;
            const ct = Math.cos(turn), st = Math.sin(turn);
            const cells = [];
            let clear = true;
            const reach = Math.ceil((long * 1.3) / c);
            for (let dj = -reach; dj <= reach && clear; dj++) for (let di = -reach; di <= reach; di++) {
                const dx = di * c, dy = dj * c;
                const lx = (dx * ct + dy * st) / long, ly = (-dx * st + dy * ct) / r;
                const d = lx * lx + ly * ly + (noise((x + dx) * 0.9, (y + dy) * 0.9, salt + 71) - 0.5) * 0.7;
                if (d > 1.25) continue;
                const k = cellOf(x + dx, y + dy);
                if (k < 0 || !land[k] || kind[k] !== PLAIN || shore[k] < 2 || nearAnchor(x + dx, y + dy, 1.3)) { clear = false; break; }
                if (d <= 1) cells.push(k);
            }
            if (!clear || cells.length < 4) continue;
            for (const k of cells) kind[k] = LAKE;
            lakeSpots.push({ x, y, reach: long });
            l++;
        }
    }

    // 5. Rivers (D192): from the foot of the ranges and the high ground down to a lake or the sea. Every square of land
    //    knows the next square on its way down to water (found from the water outward, the low ground cheapest, so a
    //    river keeps to the valleys and round the ranges); a river follows that way from its source and stops where it
    //    meets another, which is the greater for it. `river` is the squares a river lies on, with the square at each
    //    corner it cuts, so nothing gets from one bank to the other without stepping on it.
    const river = new Uint8Array(N);
    const course = new Uint8Array(N);    // the squares a river's own line runs through, by which river
    const rivers = [];
    {
        const height = new Float32Array(N);
        for (const s of landCells) { const i = s % cols, j = (s - i) / cols; height[s] = Math.min(shore[s], 16) * 0.35 + (kind[s] === MOUNTAIN ? 7 : 0) + fbm(i / 8 + 3, j / 8 + 9, salt + 150) * 4 + fbm(i / 2.6 + 11, j / 2.6 + 5, salt + 151) * 6; }    // the fine grain is what makes a river wind
        const down = new Int32Array(N).fill(-1);
        const far = new Float64Array(N).fill(Infinity);
        const heap = heapOf();
        for (let s = 0; s < N; s++) if (!land[s] || kind[s] === LAKE) { far[s] = 0; heap.push([0, s]); }
        const settled = new Uint8Array(N);
        while (heap.size) {
            const [d, k] = heap.pop();
            if (settled[k] || d > far[k]) continue;
            settled[k] = 1;
            const i = k % cols, j = (k - i) / cols;
            for (const [di, dj] of STEPS8) {
                const a = i + di, b = j + dj;
                if (!inGrid(a, b)) continue;
                const t = idx(a, b);
                if (settled[t] || !land[t] || kind[t] === LAKE) continue;
                const step = (di && dj ? 1.414 : 1) * (1 + height[t]);
                if (d + step < far[t]) { far[t] = d + step; down[t] = k; heap.push([d + step, t]); }
            }
        }
        for (let m = 0; m < massCells.length; m++) {
            const area = massCells[m] * c * c;
            const want = area < 60 ? 0 : clamp(Math.round(area / 110), 1, 12);
            // Sources: high ground far from any water, the farthest first, well apart from one another.
            const springs = landCells.filter(s => mass[s] === m && kind[s] !== LAKE && shore[s] >= 4 && far[s] !== Infinity).sort((p, q) => far[q] - far[p]);
            const taken = [];
            for (const s of springs) {
                if (taken.length >= want) break;
                const x = xOf(s), y = yOf(s);
                if (taken.some(t => Math.hypot(t.x - x, t.y - y) < 6)) continue;
                taken.push({ s, x, y });
            }
            for (const t of taken) {
                const path = [t.s];
                let joined = -1;
                for (let k = down[t.s], guard = 0; k >= 0 && guard < N; k = down[k], guard++) {
                    path.push(k);
                    if (!land[k] || kind[k] === LAKE) break;                     // the water
                    if (course[k]) { joined = course[k] - 1; break; }            // another river: this one is its tributary
                }
                if (path.length < 9) continue;                                   // too short to be a river
                const id = rivers.length;
                const dry = (k) => land[k] && kind[k] !== LAKE;
                path.forEach((k, n) => {
                    if (!dry(k)) return;
                    if (!course[k]) course[k] = id + 1;
                    river[k] = 1;
                    const next = path[n + 1];
                    if (next === undefined) return;
                    const i = k % cols, j = (k - i) / cols, a = next % cols, b = (next - a) / cols;
                    if (i !== a && j !== b) { const p = idx(a, j), q = idx(i, b); const corner = dry(p) && (!dry(q) || height[p] <= height[q]) ? p : dry(q) ? q : -1; if (corner >= 0) river[corner] = 1; }
                });
                if (joined >= 0 && rivers[joined]) rivers[joined].big = true;
                rivers.push({ cells: path, big: false });
            }
        }
    }
    const beside = (s, test, reach = 1) => { const i = s % cols, j = (s - i) / cols; for (let dj = -reach; dj <= reach; dj++) for (let di = -reach; di <= reach; di++) { const a = i + di, b = j + dj; if (inGrid(a, b) && test(idx(a, b))) return true; } return false; };

    // 6. Climates (D192): how warm the ground is by how far north it lies (in a world like ours, by how far from the
    //    middle), and how damp. Snow where it is cold; desert where it is hot and dry, away from the rivers; marsh where
    //    it is wet beside still or slow water; forest where it is damp. A patch too small to be told is let go.
    const earthLike = spec.shape === 'earth';
    const warmth = new Float32Array(N);
    for (const s of landCells) {
        const i = s % cols, j = (s - i) / cols;
        const v = ((j + 0.5) / rows) * 2 - 1;
        const base = earthLike ? 1 - Math.pow(Math.abs(v), 1.15) : (v + 1) / 2;
        warmth[s] = base + (fbm(i / 16 + 21, j / 16 + 4, salt + 160) - 0.5) * 0.24;
        if (kind[s] !== PLAIN) continue;
        const wet = fbm(i / 13 + 7, j / 13 + 3, salt + 101);
        const cold = earthLike ? 0.3 : 0.2, hot = earthLike ? 0.78 : 0.72;
        if (warmth[s] < cold) kind[s] = SNOW;
        else if (wet > 0.6 && warmth[s] > cold + 0.12 && (shore[s] <= 2 || beside(s, k => kind[k] === LAKE, 2) || beside(s, k => river[k] > 0, 1)) && fbm(i / 6 + 40, j / 6 + 2, salt + 170) > 0.5) kind[s] = SWAMP;
        else if (wet > 0.55) kind[s] = FOREST;
        else if (warmth[s] > hot && wet < 0.47 && shore[s] >= 2 && !beside(s, k => river[k] > 0, 1)) kind[s] = DESERT;
    }
    for (const [k0, least] of [[FOREST, 10], [DESERT, 12], [SNOW, 8], [SWAMP, 6]]) {
        const seen = new Uint8Array(N);
        for (const s of landCells) {
            if (kind[s] !== k0 || seen[s]) continue;
            const patch = [s];
            seen[s] = 1;
            for (let n = 0; n < patch.length; n++) {
                const k = patch[n];
                const i = k % cols, j = (k - i) / cols;
                for (const [di, dj] of STEPS4) { const a = i + di, b = j + dj; if (inGrid(a, b) && kind[idx(a, b)] === k0 && !seen[idx(a, b)]) { seen[idx(a, b)] = 1; patch.push(idx(a, b)); } }
            }
            if (patch.length < least) for (const k of patch) kind[k] = PLAIN;
        }
    }

    // 7. The outlines: the coast, the lakes' shores, the edges of the forests and of each climate's ground; the rivers'
    //    lines; then the trees, the dunes, the reeds and the peaks that stand on them.
    const kindIs = (k) => (i, j) => inGrid(i, j) && kind[idx(i, j)] === k;
    const shapes = (rings, pos) => partsOf(rings.map(r => r.map(v => { const p = pos.get(v); return [round4(ox + p[0] * c), round4(oy + p[1] * c)]; })));
    const coastRings = traceRings(cols, rows, (i, j) => inGrid(i, j) && land[idx(i, j)] === 1);
    const coastPos = easeCorners(coastRings, cols, salt, { nudge: 0.7 });
    const coasts = shapes(coastRings, coastPos);
    const lakeRings = traceRings(cols, rows, kindIs(LAKE));
    const lakes = shapes(lakeRings, easeCorners(lakeRings, cols, salt + 200, { nudge: 0.4 }));
    const forestRings = traceRings(cols, rows, kindIs(FOREST));
    const forests = shapes(forestRings, easeCorners(forestRings, cols, salt + 300, { nudge: 0.5, passes: 4 }));
    const ground = (k, n) => { const rings = traceRings(cols, rows, kindIs(k)); return shapes(rings, easeCorners(rings, cols, salt + n, { nudge: 0.5, passes: 4 })); };
    const deserts = ground(DESERT, 310), snows = ground(SNOW, 320), swamps = ground(SWAMP, 330);
    // A river's line: through the middles of its squares, each nudged a little, the corners cut so it winds.
    const riverLines = rivers.map((r, n) => {
        let pts = r.cells.map((k, at) => { const i = k % cols, j = (k - i) / cols; const still = at === r.cells.length - 1; return [wx(i) + (still ? 0 : (lattice(i, j, salt + 350) - 0.5) * c * 0.7), wy(j) + (still ? 0 : (lattice(i, j, salt + 351) - 0.5) * c * 0.7)]; });
        for (let pass = 0; pass < 2; pass++) {
            const next = [pts[0]];
            for (let i = 0; i < pts.length - 1; i++) { const [ax, ay] = pts[i], [bx, by] = pts[i + 1]; next.push([ax * 0.75 + bx * 0.25, ay * 0.75 + by * 0.25], [ax * 0.25 + bx * 0.75, ay * 0.25 + by * 0.75]); }
            next.push(pts[pts.length - 1]);
            pts = next;
        }
        return { id: n, big: r.big, points: pts.map(([x, y]) => [round4(x), round4(y)]) };
    });
    // The marks a climate's ground is told by: a dune to each stretch of desert, reeds to each stretch of marsh.
    const marksOn = (k, step, n, draw) => {
        const out = [];
        for (let my = oy + step / 2; my < oy + spec.h; my += step) for (let mx = ox + step / 2; mx < ox + spec.w; mx += step) {
            const a = Math.round(mx * 5), b = Math.round(my * 5);
            if (lattice(a, b, salt + n) < 0.3) continue;
            const x = mx + (lattice(a, b, salt + n + 1) - 0.5) * step * 0.6, y = my + (lattice(a, b, salt + n + 2) - 0.5) * step * 0.6;
            const at = cellOf(x, y);
            if (at < 0 || kind[at] !== k || river[at]) continue;
            out.push({ x: round4(x), y: round4(y), lines: draw(x, y, 0.26 + lattice(a, b, salt + n + 3) * 0.1) });
        }
        return out;
    };
    const mark = (x, y, sz) => (dx, dy) => [round4(x + dx * sz), round4(y + dy * sz)];
    const dunes = marksOn(DESERT, 1.5, 360, (x, y, sz) => { const p = mark(x, y, sz); return [[p(-1.2, 0.25), p(-0.6, -0.3), p(0, -0.42), p(0.6, -0.3), p(1.2, 0.25)]]; });
    const reeds = marksOn(SWAMP, 1.1, 370, (x, y, sz) => { const p = mark(x, y, sz); return [[p(-0.9, 0.35), p(0.9, 0.35)], [p(-0.45, 0.35), p(-0.55, -0.55)], [p(0, 0.35), p(0, -0.8)], [p(0.45, 0.35), p(0.55, -0.55)]]; });
    const trees = [];
    {
        const step = 1.15;
        for (let ty = oy + step / 2; ty < oy + spec.h; ty += step) for (let tx = ox + step / 2; tx < ox + spec.w; tx += step) {
            const a = Math.round(tx * 7), b = Math.round(ty * 7);
            if (lattice(a, b, salt + 400) < 0.25) continue;
            const x = tx + (lattice(a, b, salt + 401) - 0.5) * step * 0.7, y = ty + (lattice(a, b, salt + 402) - 0.5) * step * 0.7;
            const k = cellOf(x, y), up = cellOf(x, y - 0.35), down = cellOf(x, y + 0.25);
            if (k < 0 || kind[k] !== FOREST || up < 0 || kind[up] !== FOREST || down < 0 || kind[down] !== FOREST) continue;
            trees.push({ x: round4(x), y: round4(y), lines: treeLines(x, y, 0.3 + lattice(a, b, salt + 403) * 0.14) });
        }
    }
    const peaks = peakSpots
        .filter(p => { const k = cellOf(p.x, p.y - p.s * 0.4); return k >= 0 && land[k] && kind[k] !== LAKE && shore[k] >= 2; })
        .sort((a, b) => a.y - b.y)    // the farthest first, so a nearer one is drawn in front of it
        .map(p => { const k = cellOf(p.x, p.y - p.s * 0.4); return { x: round4(p.x), y: round4(p.y - p.s * 0.4), s: round4(p.s), snowy: warmth[k] < (earthLike ? 0.4 : 0.32), lines: peakLines(p.key, round4(p.x), round4(p.y), p.s) }; });    // a peak in the cold is capped with snow

    const masses = massCells.map((n, id) => ({ id, area: round4(n * c * c) })).sort((a, b) => b.area - a.area);
    return {
        spec, key, cell: c,
        bounds: { minX: round4(ox), minY: round4(oy), maxX: round4(ox + spec.w), maxY: round4(oy + spec.h) },
        coasts, masses, landArea: round4(landCells.length * c * c),
        peaks, ranges, lakes, forests, trees,
        deserts, snows, swamps, dunes, reeds, rivers: riverLines,
        kindAt: (x, y) => { const k = cellOf(x, y); return KIND_NAMES[k >= 0 ? kind[k] : SEA]; },
        isLand: (x, y) => { const k = cellOf(x, y); return k >= 0 && land[k] === 1 && kind[k] !== LAKE; },
        grid: { cols, rows, cell: c, ox, oy, N, salt, land, kind, mass, shore, river, landCells, coastPos, cellOf, xOf, yOf, idx, inGrid },
        cache: { divisions: new Map(), fields: new Map() },
        toJSON: () => ({ world: key }),    // a world written out is what it is made from, never its squares
    };
}

// ─── Who holds what ─────────────────────────────────────────────────────────

/** The square a spot stands for: its own when that is land, else the nearest square of land within a short reach; -1 when it is out at sea. */
function landCellNear(world, x, y) {
    const g = world.grid;
    const k = g.cellOf(x, y);
    if (k >= 0 && g.land[k]) return k;
    const i0 = Math.floor((x - g.ox) / g.cell), j0 = Math.floor((y - g.oy) / g.cell);
    let best = -1, bd = 1.2;
    for (let dj = -3; dj <= 3; dj++) for (let di = -3; di <= 3; di++) {
        const a = i0 + di, b = j0 + dj;
        if (!g.inGrid(a, b) || !g.land[g.idx(a, b)]) continue;
        const d = Math.hypot(g.xOf(g.idx(a, b)) - x, g.yOf(g.idx(a, b)) - y);
        if (d < bd) { bd = d; best = g.idx(a, b); }
    }
    return best;
}

/**
 * Whose land every square is: each region spreads from its square over
 * the land it can walk to, slower across the mountains and the lakes.
 * Land none can walk to goes with a region near enough across the water.
 * @param {number[]} starts  each region's square, or -1 for a region with none
 * @returns {Int16Array} the region's place in `starts` for every square, -1 for the sea and for nobody's land
 */
function spread(world, starts) {
    const g = world.grid;
    const { cols, N, land, kind, idx, inGrid } = g;
    const label = new Int16Array(N).fill(-1);
    const cost = new Float64Array(N).fill(Infinity);    // whole doubles: a rounded cost would read as stale against the very entry that set it
    const heap = heapOf();
    starts.forEach((k, l) => { if (k >= 0 && cost[k] !== 0) { cost[k] = 0; heap.push([0, k, l]); } });
    while (heap.size) {
        const [d, k, l] = heap.pop();
        if (label[k] >= 0 || d > cost[k]) continue;
        label[k] = l;
        const i = k % cols, j = (k - i) / cols;
        for (const [di, dj] of STEPS8) {
            const a = i + di, b = j + dj;
            if (!inGrid(a, b)) continue;
            const t = idx(a, b);
            if (!land[t] || label[t] >= 0) continue;
            if (di && dj && (!land[idx(a, j)] || !land[idx(i, b)])) continue;    // not through a gap between two corners of sea
            const step = (di && dj ? 1.414 : 1) * (kind[t] === MOUNTAIN ? 3.6 : kind[t] === LAKE ? 1.8 : g.river[t] ? 5 : 1) * (0.5 + fbm(a / 7, b / 7, g.salt + 55));    // the ground is not even: borders wander, and tend along the ranges and the rivers
            if (d + step < cost[t]) { cost[t] = d + step; heap.push([d + step, t, l]); }
        }
    }
    // A landmass no region stands on goes whole to the region nearest it across the water, when one is near enough.
    const live = starts.map((k, l) => (k >= 0 ? { l, x: g.xOf(k), y: g.yOf(k) } : null)).filter(Boolean);
    if (live.length) {
        const adrift = new Map();    // a landmass -> its squares nobody reached
        for (const s of g.landCells) { if (label[s] >= 0) continue; const m = g.mass[s]; if (!adrift.has(m)) adrift.set(m, []); adrift.get(m).push(s); }
        for (const cells of adrift.values()) {
            let best = -1, bd = ADRIFT;
            for (const p of live) for (let n = 0; n < cells.length; n += 3) { const d = Math.hypot(p.x - g.xOf(cells[n]), p.y - g.yOf(cells[n])); if (d < bd) { bd = d; best = p.l; } }
            if (best >= 0) for (const k of cells) label[k] = best;
        }
    }
    // A square joined to its own land only by a corner goes with the land around it.
    const own = new Set(starts);
    for (let pass = 0; pass < 2; pass++) for (const s of g.landCells) {
        if (label[s] < 0 || own.has(s)) continue;
        const i = s % cols, j = (s - i) / cols;
        const count = new Map();
        let same = 0, around = 0;
        for (const [di, dj] of STEPS4) {
            const a = i + di, b = j + dj;
            if (!inGrid(a, b) || !land[idx(a, b)]) continue;
            around++;
            const o = label[idx(a, b)];
            if (o === label[s]) same++; else if (o >= 0) count.set(o, (count.get(o) || 0) + 1);
        }
        if (same || !around || !count.size) continue;
        label[s] = [...count].sort((p, q) => q[1] - p[1] || p[0] - q[0])[0][0];
    }
    return label;
}

/**
 * Where `n` more regions would stand (D183): shared between the
 * landmasses by how large each is, as far from one another and from the
 * regions already there as the land allows, then each drawn to the middle
 * of the land it would hold. The same world and the same regions give the
 * same spots.
 * @param {Array<{ x: number, y: number }>} taken  regions already on the map
 * @returns {Array<{ x: number, y: number }>}
 */
export function suggestSites(world, n, taken = []) {
    if (!world || !(n > 0)) return [];
    const g = world.grid;
    const { cols, mass, shore, kind, landCells } = g;
    const c = g.cell;
    const fixed = (Array.isArray(taken) ? taken : []).filter(p => p && finite(p.x) && finite(p.y)).map(p => landCellNear(world, p.x, p.y)).filter(k => k >= 0);
    // How many each landmass gets: one at a time, to the landmass with the most land for the regions it has so far
    // (counted so that an island gets its first region before a continent gets its third).
    const have = new Map();
    for (const k of fixed) have.set(mass[k], (have.get(mass[k]) || 0) + 1);
    const want = new Map();
    const big = world.masses.filter(m => m.area >= 9);
    for (let i = 0; i < Math.min(n, WORLD_REGIONS.max); i++) {
        let best = null, bv = 0;
        for (const m of big) { const got = (have.get(m.id) || 0) + (want.get(m.id) || 0); const v = m.area / (2 * got + 1); if (v > bv && m.area / (got + 1) >= 9) { bv = v; best = m; } }
        if (!best) break;    // no landmass has room for another
        want.set(best.id, (want.get(best.id) || 0) + 1);
    }
    const sites = fixed.map(k => ({ k, fixed: true }));
    for (const m of big) {
        const count = want.get(m.id) || 0;
        if (!count) continue;
        const pool = landCells.filter(s => mass[s] === m.id && kind[s] !== LAKE && (shore[s] >= 2 || m.area < 40) && ((s % cols) + (s - s % cols) / cols) % 2 === 0);
        if (!pool.length) continue;
        const far = new Float64Array(pool.length).fill(Infinity);
        const settle = (k) => { const sx = g.xOf(k), sy = g.yOf(k); for (let p = 0; p < pool.length; p++) { const d = Math.hypot(g.xOf(pool[p]) - sx, g.yOf(pool[p]) - sy); if (d < far[p]) far[p] = d; } };
        for (const s of sites) if (mass[s.k] === m.id) settle(s.k);
        for (let i = 0; i < count; i++) {
            let best = -1, bv = -1;
            for (let p = 0; p < pool.length; p++) {
                // The first on a landmass is the square deepest inside it; after that, the one farthest from every region so far.
                const v = far[p] === Infinity ? shore[pool[p]] : far[p] + Math.min(shore[pool[p]], 6) * 0.2;
                if (v > bv) { bv = v; best = p; }
            }
            if (best < 0 || (far[best] !== Infinity && far[best] < 2.5)) break;
            sites.push({ k: pool[best], fixed: false });
            settle(pool[best]);
        }
    }
    // Each new region is drawn to the middle of the land it would hold, three times over: the lands come out more even.
    for (let pass = 0; pass < 3; pass++) {
        const label = spread(world, sites.map(s => s.k));
        const sum = sites.map(() => ({ x: 0, y: 0, n: 0 }));
        for (const s of landCells) { const l = label[s]; if (l < 0 || mass[s] !== mass[sites[l].k]) continue; sum[l].x += g.xOf(s); sum[l].y += g.yOf(s); sum[l].n++; }
        sites.forEach((s, l) => {
            if (s.fixed || !sum[l].n) return;
            const mx = sum[l].x / sum[l].n, my = sum[l].y / sum[l].n;
            let best = s.k, bd = Infinity;
            const reach = Math.ceil(3 / c);
            const i0 = Math.floor((mx - g.ox) / c), j0 = Math.floor((my - g.oy) / c);
            for (let dj = -reach; dj <= reach; dj++) for (let di = -reach; di <= reach; di++) {
                if (!g.inGrid(i0 + di, j0 + dj)) continue;
                const k = g.idx(i0 + di, j0 + dj);
                if (label[k] !== l || kind[k] === LAKE || kind[k] === MOUNTAIN) continue;
                const d = Math.hypot(g.xOf(k) - mx, g.yOf(k) - my) - Math.min(shore[k], 4) * 0.15;
                if (d < bd) { bd = d; best = k; }
            }
            s.k = best;
        });
    }
    return sites.filter(s => !s.fixed).map(s => ({ x: round4(g.xOf(s.k)), y: round4(g.yOf(s.k)) }));
}

/**
 * The spot of dry land nearest a point that keeps `gap` clear of every
 * spot in `taken` (D183): where something laid out without regard to the
 * world comes to stand on it. Null when the world has no such land.
 * @param {{ x: number, y: number }} at
 * @param {Array<{ x: number, y: number }>} taken
 */
export function landSpotNear(world, at, { taken = [], gap = 0 } = {}) {
    if (!world || !at || !finite(at.x) || !finite(at.y)) return null;
    const g = world.grid;
    const here = g.cellOf(at.x, at.y);
    const free = (x, y) => taken.every(t => Math.hypot(t.x - x, t.y - y) >= gap);
    if (here >= 0 && g.land[here] && g.kind[here] !== LAKE && free(at.x, at.y)) return { x: round4(at.x), y: round4(at.y) };
    let best = null, bd = Infinity;
    for (const k of g.landCells) {
        if (g.kind[k] === LAKE) continue;
        const x = g.xOf(k), y = g.yOf(k);
        const d = Math.hypot(x - at.x, y - at.y) - Math.min(g.shore[k], 2) * 0.2;    // a step in from the very shore, when it costs little
        if (d < bd && free(x, y)) { bd = d; best = { x: round4(x), y: round4(y) }; }
    }
    return best;
}

const WHERE_WORDS = { north: 'Northern', south: 'Southern', east: 'Eastern', west: 'Western', northeast: 'Northeastern', northwest: 'Northwestern', southeast: 'Southeastern', southwest: 'Southwestern', middle: 'Central' };
const LAND_WORDS = { mountains: ['Highlands', 'Peaks', 'Heights'], forest: ['Woods', 'Wilds', 'Weald'], coast: ['Coast', 'Shore', 'Strand'], plains: ['Plains', 'Reach', 'March', 'Vale'], desert: ['Sands', 'Waste', 'Dunes'], snow: ['Snows', 'Frostlands', 'Tundra'], swamp: ['Fens', 'Marshes', 'Mire'] };

const STAND_IN_RE = new RegExp(`^(?:The Heartland|(?:${Object.values(WHERE_WORDS).join('|')}) (?:${[...new Set(Object.values(LAND_WORDS).flat())].join('|')})(?: \\d+)?)$`);
/** Whether a name is one of the plain names a land is given to stand in until it has its own ("Northern Highlands", "The Heartland"). */
export const isStandInName = (label) => STAND_IN_RE.test(String(label || '').trim());

/**
 * The land divided between the regions that stand on it (D183).
 * @param {Array<{ id: string, x: number, y: number }>} sites  the regions, in the order they were made
 * @returns {{ lands: Map<string, {
 *     id: string, x: number, y: number, outline: number[][], parts: number[][][][], area: number,
 *     neighbours: string[], borders: Array<{ id: string, points: number[][] }>,
 *     coastal: boolean, terrain: string, where: string, summary: string, name: string }>,
 *   at: (x: number, y: number) => string }}
 *   `parts` are the land's shapes, the largest first, each [outer, ...holes]; `outline` is the largest's outer ring;
 *   `name` is a plain name to stand in until the land is given its own; `at` tells whose land a point is on ('' for the sea and for nobody's).
 */
export function divideWorld(world, sites) {
    const empty = { lands: new Map(), at: () => '' };
    if (!world) return empty;
    const list = (Array.isArray(sites) ? sites : []).filter(s => s && typeof s.id === 'string' && s.id && finite(s.x) && finite(s.y)).map(s => ({ id: s.id, x: round4(s.x), y: round4(s.y) }));
    const key = JSON.stringify(list);
    const kept = world.cache.divisions;
    if (kept.has(key)) { const hit = kept.get(key); kept.delete(key); kept.set(key, hit); return hit; }

    const g = world.grid;
    const { cols, rows, kind, shore, landCells, idx, inGrid } = g;
    const c = g.cell;
    const seen = new Set();
    const starts = list.map(s => { const k = landCellNear(world, s.x, s.y); if (k < 0 || seen.has(k)) return -1; seen.add(k); return k; });
    const label = spread(world, starts);
    const labelAt = (i, j) => (inGrid(i, j) ? label[idx(i, j)] : -1);

    // The borders: every side between two regions' squares. Their corners are eased together; a corner on the coast stays where the coast has it.
    const V = (i, j) => j * (cols + 1) + i;
    const pairs = new Map();    // "a|b" (a < b) -> the sides between the two, as corner pairs
    const borderRings = [];     // each side as a two-corner line, for the easing
    const side = (p, q, a, b) => {
        if (a === b || a < 0 || b < 0) return;
        const k = a < b ? `${a}|${b}` : `${b}|${a}`;
        if (!pairs.has(k)) pairs.set(k, []);
        pairs.get(k).push([p, q]);
        borderRings.push([p, q]);
    };
    for (let j = 0; j <= rows; j++) for (let i = 0; i <= cols; i++) {
        if (i < cols) side(V(i, j), V(i + 1, j), labelAt(i, j - 1), labelAt(i, j));
        if (j < rows) side(V(i, j), V(i, j + 1), labelAt(i - 1, j), labelAt(i, j));
    }
    // (easeCorners links a ring's last corner to its first: for a two-corner line that is the same link again.)
    const pos = easeCorners(borderRings, cols, g.salt + 500, { fixed: g.coastPos, nudge: 0.5 });
    const at = (v) => { const p = g.coastPos.get(v) || pos.get(v) || [v % (cols + 1), (v - v % (cols + 1)) / (cols + 1)]; return [round4(g.ox + p[0] * c), round4(g.oy + p[1] * c)]; };

    const midX = g.ox + cols * c / 2, midY = g.oy + rows * c / 2;
    const lands = new Map();
    const byLabel = [];
    const taken = new Set();
    list.forEach((s, l) => {
        if (starts[l] < 0) return;
        const parts = partsOf(traceRings(cols, rows, (i, j) => labelAt(i, j) === l).map(r => r.map(at)));
        if (!parts.length) return;
        let cells = 0, coastal = false, sumX = 0, sumY = 0;
        const count = [0, 0, 0, 0, 0, 0, 0, 0];
        let watered = 0;
        for (const k of landCells) {
            if (label[k] !== l) continue;
            cells++;
            count[kind[k]]++;
            if (g.river[k]) watered++;
            sumX += g.xOf(k); sumY += g.yOf(k);
            if (shore[k] === 1) coastal = true;
        }
        const share = (k) => (cells ? count[k] / cells : 0);
        // What the land mostly is: its ranges first, then the climate or the forest that covers the most of it.
        const cover = [[SNOW, 'snow', 0.35], [DESERT, 'desert', 0.35], [SWAMP, 'swamp', 0.25], [FOREST, 'forest', 0.4]].filter(([k, , least]) => share(k) > least).sort((p, q) => share(q[0]) - share(p[0]));
        const terrain = share(MOUNTAIN) > 0.2 ? 'mountains' : cover.length ? cover[0][1] : coastal && cells * c * c < 60 ? 'coast' : 'plains';
        const words = [];
        if (share(MOUNTAIN) > 0.2) words.push('mountainous'); else if (share(MOUNTAIN) > 0.06) words.push('a mountain range');
        if (share(SNOW) > 0.35) words.push('under snow'); else if (share(SNOW) > 0.12) words.push('snow in the north of it');
        if (share(DESERT) > 0.35) words.push('desert'); else if (share(DESERT) > 0.12) words.push('a stretch of desert');
        if (share(SWAMP) > 0.25) words.push('marshland'); else if (share(SWAMP) > 0.06) words.push('a marsh');
        if (share(FOREST) > 0.4) words.push('heavily wooded'); else if (share(FOREST) > 0.15) words.push('woods');
        if (count[LAKE]) words.push(count[LAKE] * c * c > 12 ? 'a great lake' : 'a lake');
        if (watered >= 8) words.push('a river');
        if (!words.length) words.push('open country');
        const u = cells ? (sumX / cells - midX) / (cols * c / 2) : 0, v = cells ? (sumY / cells - midY) / (rows * c / 2) : 0;
        const where = `${v < -0.3 ? 'north' : v > 0.3 ? 'south' : ''}${u < -0.3 ? 'west' : u > 0.3 ? 'east' : ''}` || 'middle';
        // A plain name to stand in: where it lies and what it is, and no two lands the same.
        const nouns = LAND_WORDS[terrain] || LAND_WORDS.plains;
        let name = '';
        for (const noun of nouns) { const tryName = where === 'middle' && terrain === 'plains' && noun === 'Plains' ? 'The Heartland' : `${WHERE_WORDS[where]} ${noun}`; if (!taken.has(tryName)) { name = tryName; break; } }
        for (let nth = 2; !name; nth++) { const tryName = `${WHERE_WORDS[where]} ${nouns[0]} ${nth}`; if (!taken.has(tryName)) name = tryName; }
        taken.add(name);
        const land = {
            id: s.id, x: s.x, y: s.y, outline: parts[0][0], parts, area: round4(cells * c * c), neighbours: [], borders: [],
            coastal, terrain, where, summary: `${coastal ? 'on the coast' : 'landlocked'}, in the ${where} of the world: ${words.join(', ')}`, name,
        };
        lands.set(s.id, land);
        byLabel[l] = land;
    });
    // Who borders whom, and the line they share: the longest unbroken run of the sides between them.
    for (const [k, sides] of pairs) {
        const [a, b] = k.split('|').map(Number);
        if (!byLabel[a] || !byLabel[b]) continue;
        const next = new Map();
        for (const [p, q] of sides) { if (!next.has(p)) next.set(p, []); if (!next.has(q)) next.set(q, []); next.get(p).push(q); next.get(q).push(p); }
        const done = new Set();
        let best = [];
        const ends = [...next.keys()].filter(v => next.get(v).length === 1);
        for (const start of [...ends, ...next.keys()]) {
            if (done.has(start)) continue;
            const run = [start];
            done.add(start);
            for (let cur = start; ;) { const nx = next.get(cur).find(v => !done.has(v)); if (nx === undefined) break; done.add(nx); run.push(nx); cur = nx; }
            if (run.length > best.length) best = run;
        }
        if (best.length < 2) continue;
        const points = best.map(at);
        byLabel[a].neighbours.push(byLabel[b].id); byLabel[b].neighbours.push(byLabel[a].id);
        byLabel[a].borders.push({ id: byLabel[b].id, points });
        byLabel[b].borders.push({ id: byLabel[a].id, points: points.slice().reverse() });
    }
    const out = { lands, at: (x, y) => { const k = g.cellOf(x, y); const l = k >= 0 ? label[k] : -1; return l >= 0 && byLabel[l] ? byLabel[l].id : ''; } };
    kept.set(key, out);
    while (kept.size > 4) kept.delete(kept.keys().next().value);
    return out;
}

// ─── How long the way is ────────────────────────────────────────────────────

const paceOf = (k, table) => (k === SEA || k === LAKE ? table.water : k === MOUNTAIN ? table.mountain : k === FOREST ? table.forest : k === DESERT ? table.desert : k === SNOW ? table.snow : k === SWAMP ? table.swamp : table.plain);
const ROUGH = Object.freeze({ [MOUNTAIN]: 'mountain', [FOREST]: 'forest', [DESERT]: 'desert', [SNOW]: 'snow', [SWAMP]: 'swamp' });    // the grounds a way is told by
const isWater = (k) => k === SEA || k === LAKE;

/**
 * The quickest ways from one point of a world to everywhere else on it
 * (D185), over the ground as it is: forest slower, mountains much
 * slower, water crossed by boat (quicker under way, but taking ship
 * costs `embark`, half of it on leaving the land and half on reaching it,
 * so a boat is worth it for a long crossing and never for a pond). Desert,
 * snow and marsh are slower each in its measure, and a river in the way
 * is waded (D192): a small part of the wait for a boat, once for each
 * river crossed. All in layout units of open ground: a `cost` of 10 is as
 * long as ten units walked across a plain.
 * @returns {{ to: (x: number, y: number) => ({ cost: number, afloat: number, length: number, water: number, mountain: number, forest: number, desert: number, snow: number, swamp: number, fords: number }|null) }}
 *   `length` the way's own length; `water`, `mountain`, `forest`, `desert`, `snow`, `swamp` how much of it is over each; `afloat` the part of the cost spent by boat, the wait for it counted; `fords` the rivers waded
 */
export function travelField(world, from, { embark = 0 } = {}) {
    const none = { to: () => null };
    if (!world || !from || !finite(from.x) || !finite(from.y)) return none;
    const g = world.grid;
    const { cols, N, kind, river, idx, inGrid } = g;
    const c = g.cell;
    const start = g.cellOf(from.x, from.y);
    if (start < 0) return none;
    const half = Math.max(0, embark) / 2;
    const ford = Math.max(0, embark) * FORD;
    const key = `${start}|${round4(half)}`;
    const kept = world.cache.fields;
    let field = kept.get(key);
    if (field) { kept.delete(key); kept.set(key, field); }
    else {
        const cost = new Float64Array(N).fill(Infinity);
        const prev = new Int32Array(N).fill(-1);
        const done = new Uint8Array(N);
        const heap = heapOf();
        cost[start] = 0;
        heap.push([0, start]);
        while (heap.size) {
            const [d, k] = heap.pop();
            if (done[k] || d > cost[k]) continue;
            done[k] = 1;
            const i = k % cols, j = (k - i) / cols;
            const pk = paceOf(kind[k], TERRAIN_PACE), wk = isWater(kind[k]);
            for (const [di, dj] of STEPS8) {
                const a = i + di, b = j + dj;
                if (!inGrid(a, b)) continue;
                const t = idx(a, b);
                if (done[t]) continue;
                const step = (di && dj ? 1.41421356 : 1) * c * (pk + paceOf(kind[t], TERRAIN_PACE)) / 2 + (wk !== isWater(kind[t]) ? half : 0) + (river[t] && !river[k] && !wk ? ford : 0);
                if (d + step < cost[t]) { cost[t] = d + step; prev[t] = k; heap.push([d + step, t]); }
            }
        }
        field = { cost, prev };
        kept.set(key, field);
        while (kept.size > 8) kept.delete(kept.keys().next().value);
    }
    const sx = from.x, sy = from.y;
    return {
        to(x, y) {
            if (!finite(x) || !finite(y)) return null;
            const end = g.cellOf(x, y);
            if (end < 0 || field.cost[end] === Infinity) return null;
            const straight = Math.hypot(x - sx, y - sy);
            const di = Math.abs((end % cols) - (start % cols)), dj = Math.abs(Math.floor(end / cols) - Math.floor(start / cols));
            if (di <= 1 && dj <= 1) {
                // The same square or the next: the straight line, over the slower of the two grounds; a boat only where one of them is water.
                const ks = kind[start], ke = kind[end];
                const wet = isWater(ks) !== isWater(ke);
                const both = isWater(ks) && isWater(ke);
                const p = both ? TERRAIN_PACE.water : wet ? 1 : Math.max(paceOf(ks, TERRAIN_PACE), paceOf(ke, TERRAIN_PACE));
                const cost = straight * p + (wet ? half : 0);
                const same = (kd) => (ks === kd && ke === kd ? straight : 0);
                return { cost, afloat: both ? cost : wet ? half : 0, length: straight, water: both ? straight : 0, mountain: !both && !wet && (ks === MOUNTAIN || ke === MOUNTAIN) ? straight : 0, forest: same(FOREST), desert: same(DESERT), snow: same(SNOW), swamp: same(SWAMP), fords: 0 };
            }
            // Walk the way back: its length and what it crosses.
            let length = 0, water = 0, boats = 0, fords = 0;
            const over = { mountain: 0, forest: 0, desert: 0, snow: 0, swamp: 0 };
            for (let k = end, guard = 0; field.prev[k] >= 0 && guard < N; guard++) {
                const p = field.prev[k];
                const diag = (k % cols) !== (p % cols) && Math.floor(k / cols) !== Math.floor(p / cols);
                const step = (diag ? 1.41421356 : 1) * c;
                length += step;
                for (const q of [k, p]) { const kq = kind[q]; if (isWater(kq)) water += step / 2; else if (ROUGH[kq]) over[ROUGH[kq]] += step / 2; }
                if (isWater(kind[k]) !== isWater(kind[p])) boats++;
                else if (river[k] && !river[p] && !isWater(kind[p])) fords++;
                k = p;
            }
            // A way along the grid's squares is longer than the same way as the crow flies: by what the grid adds to a straight line between the two.
            const octile = (Math.max(di, dj) + 0.41421356 * Math.min(di, dj)) * c;
            const r = clamp(straight / octile, 0.5, 1.15);
            const fees = boats * half + fords * ford;
            const cost = (field.cost[end] - fees) * r + fees;
            return { cost, afloat: Math.min(cost, water * r * TERRAIN_PACE.water + boats * half), length: length * r, water: water * r, mountain: over.mountain * r, forest: over.forest * r, desert: over.desert * r, snow: over.snow * r, swamp: over.swamp * r, fords };
        },
    };
}

/**
 * How long a road between two points of a world is (D185), in the same
 * units as travelField: the straight line it is drawn as, over the
 * ground under it. A road through a forest or a desert is a road; over
 * the mountains it is a pass; snow and marsh slow it a little; over water
 * it is a crossing by boat; a river it bridges, for nothing.
 * @returns {{ cost: number, afloat: number, length: number, water: number, mountain: number, forest: number, desert: number, snow: number, swamp: number, fords: number }}
 */
export function roadCost(world, a, b, { embark = 0 } = {}) {
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    const flat = { cost: length, afloat: 0, length, water: 0, mountain: 0, forest: 0, desert: 0, snow: 0, swamp: 0, fords: 0 };
    if (!world || !(length > 0)) return flat;
    const g = world.grid;
    const n = Math.max(1, Math.ceil(length / (g.cell / 2)));
    const step = length / n;
    const half = Math.max(0, embark) / 2;
    let cost = 0, water = 0, was = null, fees = 0;
    const over = { mountain: 0, forest: 0, desert: 0, snow: 0, swamp: 0 };
    for (let i = 0; i < n; i++) {
        const t = (i + 0.5) / n;
        const k = g.cellOf(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
        const kd = k >= 0 ? g.kind[k] : SEA;
        const wet = isWater(kd);
        cost += step * paceOf(kd, ROAD_PACE);
        if (wet) water += step; else if (ROUGH[kd]) over[ROUGH[kd]] += step;
        if (was !== null && was !== wet) { cost += half; fees += half; }
        was = wet;
    }
    return { cost, afloat: water * ROAD_PACE.water + fees, length, water, ...over, fords: 0 };
}
