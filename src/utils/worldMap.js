/**
 * Live World map (docs/live-world-spec.md, Part C; C1 the province node
 * view, C2 nesting and zoom): the pure part.
 *
 * Which places are drawn at a zoom, where each sits on the canvas (in
 * percent, so the view scales), the soft lines along the place tree, and
 * which known characters stand on which node: a character's single
 * `where` path resolves to the deepest place drawn. Heard-of names stay
 * off the map. A pack may fix a place's spot with `x` and `y` (0..100);
 * the rest are laid out radially, the roots on an inner ring (or centred
 * when there is one) and each root's districts on an arc outside it, a
 * second ring when a place has many; the whole is then scaled to fit the
 * canvas and nudged apart until no two cards sit closer than a card.
 * Zoomed into a place, that place sits at the centre with its children
 * around it (the province shows a city with a count; zooming shows its
 * districts, then a building, then a room), and a breadcrumb leads back.
 *
 * No SillyTavern imports: tools/world-map-test.mjs imports this directly.
 * The view is src/systems/ui/worldMap.js, drawn inside the dashboard.
 */
import { placeChain, resolvePlace } from './liveWorld.js';

export const EDGE = 9;          // nothing's centre closer to an edge than this (the view keeps the card itself inside)
export const GAP_X = 14;        // two cards may not be closer than this in x unless they are apart in y, in percent
export const GAP_Y = 12;
const STRETCH = 1.25;           // the canvas is wider than tall
const RING_ONE = 30;            // one root: its districts' ring (y radius; x is stretched)
const RING_ONE_INNER = 19;      // the second ring when a place has more than eight children
const RING_ROOTS = 18;          // several roots: their ring
const RING_MANY = 16;           // each root's districts' arc
const RING_MANY_INNER = 10;
const RING_DEEP = 15;           // a place a pack's zoom pulls in below a district: beside its parent
const MANY = 8;                 // more children than this go on two rings
const RELAX_ROUNDS = 40;

const clampPct = (n) => Math.min(100 - EDGE, Math.max(EDGE, n));
const rad = (deg) => (deg * Math.PI) / 180;

/** Each place's depth in the tree: the pack's own integer `zoom` when given, else its distance from a root. */
export function placeDepths(pack) {
    const places = (pack && pack.places) || [];
    const out = {};
    for (const p of places) {
        if (Number.isInteger(p.zoom) && p.zoom >= 0) { out[p.id] = p.zoom; continue; }
        out[p.id] = Math.max(0, placeChain(pack, p.id).length - 1);
    }
    return out;
}

/** The place zoomed into, or '' for the province: an id, path or label the pack knows. */
export function resolveRoot(pack, root) {
    return root ? resolvePlace(pack, root) : '';
}

/** The trail from the province down to `root`: [{ id, label }], empty for the province itself. */
export function provinceCrumbs(pack, root) {
    const id = resolveRoot(pack, root);
    return id ? placeChain(pack, id).map(p => ({ id: p.id, label: p.label || p.id })) : [];
}

/** Spots around a centre: one ring, or two (the odd ones on the inner) when there are many. */
function ringSpots(cx, cy, count, outer, inner, { start = -90, span = 360, full = true } = {}) {
    const spots = [];
    const two = count > MANY && inner > 0;
    const step = full ? span / Math.max(1, count) : (count > 1 ? span / (count - 1) : 0);
    for (let i = 0; i < count; i++) {
        const a = full ? start + step * i : start - span / 2 + step * i;
        const r = two && i % 2 ? inner : outer;
        spots.push({ x: cx + r * STRETCH * Math.cos(rad(a)), y: cy + r * Math.sin(rad(a)), angle: a });
    }
    return spots;
}

/**
 * The nodes drawn, each with its spot. For the province: the places at
 * `depth` or above (0: the roots only; 1: the roots and their districts),
 * each hanging off its nearest drawn ancestor; roots are the drawn places
 * with none. Zoomed into `root`: that place and its children, the place
 * at the centre. Each node says how many children it has to zoom into.
 */
export function layoutProvince(pack, { depth = 1, root = '' } = {}) {
    const places = (pack && pack.places) || [];
    const depths = placeDepths(pack);
    const rootId = resolveRoot(pack, root);
    const drawn = rootId
        ? places.filter(p => p.id === rootId || p.parent === rootId)
        : places.filter(p => depths[p.id] <= depth);
    const ids = new Set(drawn.map(p => p.id));
    const nearestDrawn = (p) => {
        const chain = placeChain(pack, p.id);
        for (let i = chain.length - 2; i >= 0; i--) if (ids.has(chain[i].id)) return chain[i].id;
        return null;
    };
    const nodes = drawn.map(p => ({
        id: p.id,
        label: p.label || p.id,
        depth: rootId ? (p.id === rootId ? 0 : 1) : depths[p.id],
        parent: rootId ? (p.id === rootId ? null : rootId) : nearestDrawn(p),
        image: typeof p.image === 'string' ? p.image : '',
        children: places.filter(q => q.parent === p.id).length,
        fixed: !rootId && Number.isFinite(p.x) && Number.isFinite(p.y),
        x: !rootId && Number.isFinite(p.x) ? clampPct(p.x) : null,
        y: !rootId && Number.isFinite(p.y) ? clampPct(p.y) : null,
    }));
    const byId = new Map(nodes.map(n => [n.id, n]));
    const roots = nodes.filter(n => !n.parent);
    const childrenOf = (id) => nodes.filter(n => n.parent === id);
    const set = (n, x, y) => { if (!n.fixed) { n.x = x; n.y = y; } };
    const placedRing = new Set();    // nodes the rings placed: the deeper pass hangs the rest off them

    if (roots.length === 1) {
        const r = roots[0];
        set(r, 50, 46);
        placedRing.add(r.id);
        const kids = childrenOf(r.id);
        ringSpots(r.x, r.y, kids.length, RING_ONE, RING_ONE_INNER).forEach((s, i) => { set(kids[i], s.x, s.y); placedRing.add(kids[i].id); });
    } else if (roots.length > 1) {
        ringSpots(50, 50, roots.length, RING_ROOTS, 0).forEach((s, i) => {
            const r = roots[i];
            set(r, s.x, s.y);
            placedRing.add(r.id);
            const kids = childrenOf(r.id);
            const span = Math.min(55, 180 / Math.max(1, kids.length)) * Math.max(0, kids.length - 1);
            ringSpots(r.x, r.y, kids.length, RING_MANY, RING_MANY_INNER, { start: s.angle, span, full: false }).forEach((k, j) => { set(kids[j], k.x, k.y); placedRing.add(kids[j].id); });
        });
    }

    // Deeper places a pack's zoom pulls in: beside their parent, parents first, aimed away from the grandparent
    // (or outward from the centre), the spot farthest from everything placed so far among a few turns.
    const queue = [...roots];
    while (queue.length) {
        const p = queue.shift();
        const kids = childrenOf(p.id).filter(k => !placedRing.has(k.id));
        const gp = p.parent ? byId.get(p.parent) : null;
        const away = gp ? Math.atan2(p.y - gp.y, (p.x - gp.x) / STRETCH) * 180 / Math.PI : Math.atan2(p.y - 50, (p.x - 50) / STRETCH) * 180 / Math.PI;
        kids.forEach((k, i) => {
            if (k.fixed) return;
            const base = away + (i - (kids.length - 1) / 2) * Math.min(60, 180 / Math.max(1, kids.length));
            let best = null;
            for (const turn of [0, 90, -90, 45, -45, 135, -135, 180]) {
                const a = base + turn;
                const x = clampPct(p.x + RING_DEEP * STRETCH * Math.cos(rad(a)));
                const y = clampPct(p.y + RING_DEEP * Math.sin(rad(a)));
                let nearest = Infinity;
                for (const o of nodes) if (o !== k && o.x !== null && o.y !== null) nearest = Math.min(nearest, Math.hypot((o.x - x) / GAP_X, (o.y - y) / GAP_Y));
                if (!best || nearest > best.nearest) best = { x, y, nearest };
            }
            set(k, best.x, best.y);
        });
        for (const k of childrenOf(p.id)) queue.push(k);
    }
    for (const n of nodes) if (n.x === null || n.y === null) set(n, 50, 50);

    // Scale the laid-out spots to fit the canvas (a pack's own x/y stay where they are), then clamp.
    const free = nodes.filter(n => !n.fixed);
    let reach = 1;
    for (const n of free) reach = Math.max(reach, Math.abs(n.x - 50) / (50 - EDGE), Math.abs(n.y - 50) / (50 - EDGE));
    for (const n of free) { n.x = clampPct(50 + (n.x - 50) / reach); n.y = clampPct(50 + (n.y - 50) / reach); }

    // Nudge apart: no two cards closer than a card in both axes; a fixed card stays, the other moves.
    for (let round = 0; round < RELAX_ROUNDS; round++) {
        let moved = false;
        for (let i = 0; i < nodes.length; i++) {
            for (let j = i + 1; j < nodes.length; j++) {
                const a = nodes[i];
                const b = nodes[j];
                if (a.fixed && b.fixed) continue;
                const dx = b.x - a.x;
                const dy = b.y - a.y;
                if (Math.abs(dx) >= GAP_X || Math.abs(dy) >= GAP_Y) continue;
                const sx = GAP_X - Math.abs(dx);
                const sy = GAP_Y - Math.abs(dy);
                const alongX = sx / GAP_X <= sy / GAP_Y;
                const sign = alongX ? (dx >= 0 ? 1 : -1) : (dy >= 0 ? 1 : -1);
                const shift = (alongX ? sx : sy) + 0.01;
                const shareA = a.fixed ? 0 : (b.fixed ? 1 : 0.5);
                const shareB = b.fixed ? 0 : (a.fixed ? 1 : 0.5);
                if (alongX) { a.x = clampPct(a.x - sign * shift * shareA); b.x = clampPct(b.x + sign * shift * shareB); }
                else { a.y = clampPct(a.y - sign * shift * shareA); b.y = clampPct(b.y + sign * shift * shareB); }
                moved = true;
            }
        }
        if (!moved) break;
    }
    return nodes;
}

/** The lines along the tree between drawn nodes: parent to child, with a point for a soft curve. */
export function provinceLines(nodes) {
    const byId = new Map(nodes.map(n => [n.id, n]));
    const lines = [];
    for (const n of nodes) {
        const p = n.parent ? byId.get(n.parent) : null;
        if (!p) continue;
        const mx = (p.x + n.x) / 2;
        const my = (p.y + n.y) / 2;
        const dx = n.x - p.x;
        const dy = n.y - p.y;
        const len = Math.hypot(dx, dy) || 1;
        const cx = mx - (dy / len) * Math.min(6, len * 0.12);
        const cy = my + (dx / len) * Math.min(6, len * 0.12);
        lines.push({ from: n.parent, to: n.id, x1: p.x, y1: p.y, cx, cy, x2: n.x, y2: n.y });
    }
    return lines;
}

/**
 * The known characters on the drawn nodes. A character stands on the
 * deepest drawn place of its `where` path; `exact` says whether that is
 * the place itself or an ancestor of a deeper one. Known characters with
 * no place are `unplaced`; a place the pack no longer has is `offMap`;
 * zoomed in, those standing outside the drawn branch are `elsewhere`.
 */
export function placeTokens(nodes, pack, state) {
    const ids = new Set(nodes.map(n => n.id));
    const tokens = Object.fromEntries(nodes.map(n => [n.id, []]));
    const unplaced = [];
    const offMap = [];
    const elsewhere = [];
    const known = Object.entries((state && state.known) || {}).filter(([, t]) => t === 'known').map(([n]) => n).sort((a, b) => a.localeCompare(b));
    for (const name of known) {
        const path = state.where && state.where[name];
        if (!path) { unplaced.push(name); continue; }
        const last = String(path).split('/').filter(Boolean).pop();
        const chain = placeChain(pack, last);
        if (!chain.length) { offMap.push(name); continue; }
        let node = null;
        for (const p of chain) if (ids.has(p.id)) node = p.id;
        if (!node) { elsewhere.push(name); continue; }
        tokens[node].push({ name, place: chain[chain.length - 1].id, exact: node === chain[chain.length - 1].id });
    }
    return { tokens, unplaced, offMap, elsewhere };
}

/**
 * Everything the view draws: nodes with their tokens, the lines, the trail
 * down to the place zoomed into, whether the canvas is crowded, and the
 * names that stand nowhere drawn.
 */
export function buildProvinceView(pack, state, { depth = 1, root = '' } = {}) {
    if (!pack || !state) return { nodes: [], lines: [], crumbs: [], root: '', dense: false, unplaced: [], offMap: [], elsewhere: [] };
    const rootId = resolveRoot(pack, root);
    const nodes = layoutProvince(pack, { depth, root: rootId });
    const { tokens, unplaced, offMap, elsewhere } = placeTokens(nodes, pack, state);
    for (const n of nodes) {
        n.tokens = tokens[n.id];
        n.count = n.tokens.length;
    }
    return { nodes, lines: provinceLines(nodes), crumbs: provinceCrumbs(pack, rootId), root: rootId, dense: nodes.length > 10, unplaced, offMap, elsewhere };
}

/** An image reference a pack may give a place, or '' when it is not a plain http(s), data-image or relative URL. */
export function safeImageUrl(url) {
    const s = String(url || '').trim();
    if (!s || /[\s"'<>\\]/.test(s)) return '';
    if (/^(https?:\/\/|data:image\/[a-z+.-]+;base64,|\/|\.\/|[a-z0-9_-]+\/)/i.test(s)) return s;
    return '';
}
