/**
 * Live World, the board (docs/stats-plan.md D69): the pure part.
 *
 * The map is a board of tiles, one per place at the level being looked
 * at: the province shows the root places, stepping inside a place shows
 * the places within it, and a trail leads back out. Each tile carries
 * the known characters whose last-seen place lies on or under it, how
 * many places it holds inside, and the public effect of a clock the pack
 * ties to it (a clock's `place`), so a rumour sits on the place it is
 * about. Heard-of names stay off the board. The shelf's World page reads
 * the same state as faces: who was last seen where, and what people say.
 *
 * No SillyTavern imports: tools/world-board-test.mjs imports this directly.
 */
import { placeChain, resolvePlace, placeLabel, publicEffects, recentChanges, sameName } from './liveWorld.js';

/** The place stepped into, or '' for the province: an id, path or label the pack knows. */
export function resolveRoot(pack, root) {
    return root ? resolvePlace(pack, root) : '';
}

/** The trail from the province down to `root`: [{ id, label }], empty for the province itself. */
export function boardCrumbs(pack, root) {
    const id = resolveRoot(pack, root);
    return id ? placeChain(pack, id).map(p => ({ id: p.id, label: p.label || p.id })) : [];
}

/** The places tiled: the roots for the province, a place's children when stepped into it. Pack order. */
export function boardPlaces(pack, root = '') {
    const places = (pack && pack.places) || [];
    const rootId = resolveRoot(pack, root);
    return places.filter(p => (p.parent || null) === (rootId || null));
}

/** How many places sit inside one. */
export function childCount(pack, id) {
    return ((pack && pack.places) || []).filter(p => p.parent === id).length;
}

/** An image reference a pack may give a place, or '' when it is not a plain http(s), data-image or relative URL. */
export function safeImageUrl(url) {
    const s = String(url || '').trim();
    if (!s || /[\s"'<>]/.test(s)) return '';
    if (/^https?:\/\//i.test(s) || /^data:image\//i.test(s)) return s;
    if (/^[a-z][a-z0-9+.-]*:/i.test(s)) return '';    // any other scheme
    return s.startsWith('//') ? '' : s;
}

/**
 * Where the known characters stand, against the tiles shown. A character's
 * path resolves to the tile on or under which it lies; one whose place is
 * the root itself is "here"; one placed off this board is "elsewhere";
 * one with no place yet is "nowhere". Names sorted.
 * @returns {{ onTiles: Object<string, Array<{name: string, place: string, exact: boolean}>>, here: string[], elsewhere: string[], nowhere: string[] }}
 */
export function peopleOnBoard(pack, state, tiles, rootId = '') {
    const onTiles = Object.fromEntries(tiles.map(t => [t.id, []]));
    const here = [];
    const elsewhere = [];
    const nowhere = [];
    const known = Object.entries((state && state.known) || {}).filter(([, t]) => t === 'known').map(([n]) => n).sort((a, b) => a.localeCompare(b));
    for (const name of known) {
        const path = state.where && state.where[name];
        if (!path) { nowhere.push(name); continue; }
        const last = String(path).split('/').filter(Boolean).pop();
        const chain = placeChain(pack, last);
        if (!chain.length) { elsewhere.push(name); continue; }
        const deepest = chain[chain.length - 1].id;
        if (rootId && deepest === rootId) { here.push(name); continue; }
        let tile = '';
        for (const p of chain) if (onTiles[p.id]) tile = p.id;
        if (!tile) { elsewhere.push(name); continue; }
        onTiles[tile].push({ name, place: deepest, exact: tile === deepest });
    }
    return { onTiles, here, elsewhere, nowhere };
}

/**
 * The public effect of each placed clock, on the tile its place lies on
 * or under; a clock placed at the root itself (or above it) speaks for
 * the whole board. A clock without a place, or placed off this board,
 * stays in "Word on the street" only. Never a number.
 * @returns {{ onTiles: Object<string, Array<{clock: string, label: string, text: string}>>, atRoot: Array<{clock: string, label: string, text: string}> }}
 */
export function captionsOnBoard(pack, state, tiles, rootId = '') {
    const onTiles = Object.fromEntries(tiles.map(t => [t.id, []]));
    const atRoot = [];
    const effects = publicEffects(state, pack);
    const rootChain = rootId ? placeChain(pack, rootId).map(p => p.id) : [];
    for (const e of effects) {
        const def = pack.clocks.find(c => c.id === e.id);
        const place = def && def.place ? def.place : '';
        if (!place) continue;
        const chain = placeChain(pack, place).map(p => p.id);
        let tile = '';
        for (const id of chain) if (onTiles[id]) tile = id;
        if (tile) { onTiles[tile].push({ clock: e.id, label: e.label, text: e.text }); continue; }
        if (rootId && rootChain.includes(place)) atRoot.push({ clock: e.id, label: e.label, text: e.text });
    }
    return { onTiles, atRoot };
}

/**
 * Everything the board draws at one level.
 * @returns {{ ok: boolean, root: string, title: string, crumbs: Array, tiles: Array, here: string[], elsewhere: string[], nowhere: string[], heard: string[], atRoot: Array, street: Array, lately: Array }}
 */
export function buildBoard(pack, state, { root = '', spoilerFree = false, lately = 6 } = {}) {
    if (!pack || !state) return { ok: false, root: '', title: '', crumbs: [], tiles: [], here: [], elsewhere: [], nowhere: [], heard: [], atRoot: [], street: [], lately: [] };
    const rootId = resolveRoot(pack, root);
    const places = boardPlaces(pack, rootId);
    const shells = places.map(p => ({ id: p.id, label: p.label || p.id, image: safeImageUrl(p.image), inside: childCount(pack, p.id) }));
    const people = peopleOnBoard(pack, state, shells, rootId);
    const captions = captionsOnBoard(pack, state, shells, rootId);
    const tiles = shells.map(t => ({
        ...t,
        people: people.onTiles[t.id],
        captions: captions.onTiles[t.id],
        caption: captions.onTiles[t.id].length ? captions.onTiles[t.id][0].text : '',
    }));
    const heard = Object.entries(state.known || {}).filter(([, t]) => t === 'heard').map(([n]) => n).sort((a, b) => a.localeCompare(b));
    const rootPlace = rootId ? placeChain(pack, rootId).pop() : null;
    return {
        ok: true,
        root: rootId,
        title: rootPlace ? (rootPlace.label || rootPlace.id) : (pack.name || 'The world'),
        crumbs: boardCrumbs(pack, rootId),
        tiles,
        here: people.here,
        elsewhere: people.elsewhere,
        nowhere: people.nowhere,
        heard,
        atRoot: captions.atRoot,
        street: publicEffects(state, pack),
        lately: recentChanges(state, pack, { limit: lately, spoilerFree }),
    };
}

/** The place a character stands in, as a path's deepest id, or '' . */
export function placeOf(state, name) {
    const path = state && state.where ? state.where[name] : '';
    return path ? String(path).split('/').filter(Boolean).pop() : '';
}

/** The place to open the board at to see a character: the parent of their deepest place (the tile sits among its siblings), or the province. */
export function boardRootFor(pack, state, name) {
    const id = placeOf(state, name);
    const chain = placeChain(pack, id);
    if (!chain.length) return '';
    return chain.length > 1 ? chain[chain.length - 2].id : '';
}

/**
 * The faces the shelf's World page shows: each known character with where
 * they were last seen, when, and where before that; the heard-of names.
 * @returns {{ known: Array<{name: string, place: string, path: string, gameDate: string, gameTime: string, before: string, reason: string}>, heard: string[] }}
 */
export function facesOfTheWorld(pack, state) {
    const log = (state && state.log) || [];
    const known = Object.entries((state && state.known) || {}).filter(([, t]) => t === 'known').map(([n]) => n).sort((a, b) => a.localeCompare(b));
    const faces = known.map(name => {
        let last = null;
        for (let i = log.length - 1; i >= 0; i--) if (log[i].kind === 'move' && sameName(log[i].who, name)) { last = log[i]; break; }
        const path = state.where && state.where[name] ? state.where[name] : '';
        return {
            name,
            place: path ? placeLabel(pack, path) : '',
            path,
            gameDate: last && last.gameDate ? last.gameDate : '',
            gameTime: last && last.gameTime ? last.gameTime : '',
            before: last && last.from ? placeLabel(pack, last.from) : '',
            reason: last && last.reason ? last.reason : '',
        };
    });
    const heard = Object.entries((state && state.known) || {}).filter(([, t]) => t === 'heard').map(([n]) => n).sort((a, b) => a.localeCompare(b));
    return { known: faces, heard };
}
