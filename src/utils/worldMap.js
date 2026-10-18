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
 * when there is one) and each root's districts on an arc outside it.
 * Zoomed into a place, that place sits at the centre with its children
 * around it (the province shows a city with a count; zooming shows its
 * districts, then a building, then a room), and a breadcrumb leads back.
 *
 * No SillyTavern imports: tools/world-map-test.mjs imports this directly.
 * The view is src/systems/ui/worldMap.js, drawn inside the dashboard.
 */
import { placeChain, resolvePlace } from './liveWorld.js';

const RING_ROOTS = 24;         // several roots: their ring around the centre
const RING_CHILDREN_ONE = 30;  // one root: its districts' ring
const RING_CHILDREN_MANY = 21; // several roots: each root's arc of districts
const EDGE = 9;                // nothing closer to an edge than this

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

/**
 * The nodes drawn, each with its spot. For the province: the places at
 * `depth` or above (0: the roots only; 1: the roots and their districts);
 * roots are the drawn places with no drawn parent. Zoomed into `root`:
 * that place and its children, the place at the centre. Each node says
 * whether it has children of its own to zoom into.
 */
export function layoutProvince(pack, { depth = 1, root = '' } = {}) {
    const places = (pack && pack.places) || [];
    const depths = placeDepths(pack);
    const rootId = resolveRoot(pack, root);
    const drawn = rootId
        ? places.filter(p => p.id === rootId || p.parent === rootId)
        : places.filter(p => depths[p.id] <= depth);
    const ids = new Set(drawn.map(p => p.id));
    const nodes = drawn.map(p => ({
        id: p.id,
        label: p.label || p.id,
        depth: rootId ? (p.id === rootId ? 0 : 1) : depths[p.id],
        parent: p.parent && ids.has(p.parent) ? p.parent : null,
        image: typeof p.image === 'string' ? p.image : '',
        children: places.filter(q => q.parent === p.id).length,
        fixed: !rootId && Number.isFinite(p.x) && Number.isFinite(p.y),
        x: !rootId && Number.isFinite(p.x) ? clampPct(p.x) : null,
        y: !rootId && Number.isFinite(p.y) ? clampPct(p.y) : null,
    }));
    const roots = nodes.filter(n => !n.parent);
    const childrenOf = (id) => nodes.filter(n => n.parent === id);
    const place = (n, x, y) => { if (!n.fixed) { n.x = clampPct(x); n.y = clampPct(y); } };
    if (roots.length === 1) {
        const root = roots[0];
        place(root, 50, 46);
        const kids = childrenOf(root.id);
        kids.forEach((k, i) => {
            const a = -90 + (360 * i) / kids.length;
            place(k, root.x + RING_CHILDREN_ONE * 1.25 * Math.cos(rad(a)), root.y + RING_CHILDREN_ONE * Math.sin(rad(a)));
        });
    } else if (roots.length > 1) {
        roots.forEach((root, i) => {
            const a = -90 + (360 * i) / roots.length;
            place(root, 50 + RING_ROOTS * 1.25 * Math.cos(rad(a)), 50 + RING_ROOTS * Math.sin(rad(a)));
            const kids = childrenOf(root.id);
            const spread = Math.min(55, 150 / Math.max(1, kids.length));
            kids.forEach((k, j) => {
                const b = a + spread * (j - (kids.length - 1) / 2);
                place(k, root.x + RING_CHILDREN_MANY * 1.25 * Math.cos(rad(b)), root.y + RING_CHILDREN_MANY * Math.sin(rad(b)));
            });
        });
    }
    // Anything deeper than a root's child that is still drawn (a pack's zoom says so) falls near its parent.
    for (const n of nodes) {
        if (n.x === null || n.y === null) {
            const p = nodes.find(m => m.id === n.parent);
            const siblings = p ? childrenOf(p.id) : [];
            const i = Math.max(0, siblings.indexOf(n));
            const a = -90 + (360 * i) / Math.max(1, siblings.length);
            place(n, (p ? p.x : 50) + 14 * Math.cos(rad(a)), (p ? p.y : 50) + 12 * Math.sin(rad(a)));
        }
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
        // a control point a little off the straight line, to the same side each time
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
 * down to the place zoomed into, and the names that stand nowhere drawn.
 */
export function buildProvinceView(pack, state, { depth = 1, root = '' } = {}) {
    if (!pack || !state) return { nodes: [], lines: [], crumbs: [], root: '', unplaced: [], offMap: [], elsewhere: [] };
    const rootId = resolveRoot(pack, root);
    const nodes = layoutProvince(pack, { depth, root: rootId });
    const { tokens, unplaced, offMap, elsewhere } = placeTokens(nodes, pack, state);
    for (const n of nodes) {
        n.tokens = tokens[n.id];
        n.count = n.tokens.length;
    }
    return { nodes, lines: provinceLines(nodes), crumbs: provinceCrumbs(pack, rootId), root: rootId, unplaced, offMap, elsewhere };
}

/** An image reference a pack may give a place, or '' when it is not a plain http(s), data-image or relative URL. */
export function safeImageUrl(url) {
    const s = String(url || '').trim();
    if (!s || /[\s"'<>]/.test(s)) return '';
    if (/^(https?:\/\/|data:image\/[a-z+.-]+;base64,|\/|\.\/|[a-z0-9_-]+\/)/i.test(s)) return s;
    return '';
}
