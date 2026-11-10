#!/usr/bin/env node
/**
 * The Atlas's pure model (docs/long-shot-plan.md D139–D146): the record
 * made safe, the kinds and terrains guessed from a name, the layout (the
 * same every time, a place added later moves nothing, a stored spot is
 * kept), the model (regions, routes, markers, the people, the party), the
 * distance (the straight line, the same whatever else is on the map),
 * the words for a distance, the search and the switches, the pack's
 * round trip.
 *
 * Usage:  node tools/atlas-test.mjs     (from the repo root)
 * Exit:   0 = pass, 1 = failure
 */
import { readFileSync } from 'node:fs';
import { normalizePack, seedWorldState, blankPack } from '../src/utils/liveWorld.js';
import { worldToRaw } from '../src/utils/worldBuilder.js';
import {
    ATLAS_KINDS, CANVAS, LAND_RADIUS, normalizeAtlas, atlasToRaw, guessKind, guessTerrain, cleanKind, hash01, scaleOf, measureOf,
    atlasModel, distanceBetween, travelHours, describeLength, describeTime, describeDistance,
    filterMarkers, kindCounts, withSpot, labelSegments, roomKey, foldPlaces,
    normalizeBook, placeAt, unplace, addPin, removeMarker, restoreMarker, mergeInto, mergeTarget, unmerge, editMarker, withScale, withDrawn, moveInto, suggestSpots, placeAll, tidyList, buildTidyPrompt, parseTidy, applyTidyItem,
} from '../src/utils/atlas.js';

let failures = 0;
function check(name, cond, detail = '') {
    if (cond) console.log(`pass  ${name}`);
    else { failures++; console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ''}`); }
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const near = (a, b, eps = 1e-3) => Math.abs(a - b) <= eps;

const file = JSON.parse(readFileSync(new URL('../worldpacks/example.json', import.meta.url), 'utf8'));
const harbour = normalizePack(file).pack;
const realm = (extra = []) => normalizePack({
    id: 'realm', name: 'The Realm',
    places: [
        { id: 'northmarch', label: 'The Northmarch' },
        { id: 'greywood', label: 'Greywood Forest' },
        { id: 'saltcoast', label: 'The Salt Coast' },
        { id: 'frosthold', label: 'Frosthold Keep', parent: 'northmarch' },
        { id: 'iron-inn', label: 'The Iron Inn', parent: 'northmarch', note: 'Warm, loud, and full of soldiers.' },
        { id: 'old-shrine', label: 'The Old Shrine', parent: 'greywood', kind: 'ruin' },
        { id: 'hunters-camp', label: "Hunters' Camp", parent: 'greywood' },
        { id: 'saltport', label: 'Saltport', parent: 'saltcoast', kind: 'settlement' },
        { id: 'fish-market', label: 'Fish Market', parent: 'saltport' },
        ...extra,
    ],
    cast: [{ name: 'Mara', place: 'iron-inn' }, { name: 'Odo', place: 'fish-market' }],
}).pack;

console.log('\n§1 the record');
{
    const empty = normalizeAtlas(null);
    check('nothing: the defaults', same(empty, { scale: '', unit: 'mi', pace: 0, spots: {}, links: [], notes: '', locked: false }));
    const a = normalizeAtlas({ scale: 'world', unit: 'km', pace: 30, spots: { a: { x: 1.23456, y: -2, by: 'user' }, b: { x: 'no', y: 1 }, gone: { x: 0, y: 0 }, c: { x: 1, y: 2 } }, links: [{ a: 'a', b: 'c', days: 2, dir: 'N' }, { a: 'a', b: 'a', days: 1 }, { a: 'a', b: 'gone', days: 1 }, { a: 'a', b: 'c' }], notes: ' the sea matters \r\n most ', locked: true }, ['a', 'b', 'c']);
    check('a spot: four decimals, who set it; a broken one and an unknown place dropped', same(a.spots, { a: { x: 1.2346, y: -2, by: 'user' }, c: { x: 1, y: 2, by: 'layout' } }));
    check('a link: both ends known and apart, days or a direction', same(a.links, [{ a: 'a', b: 'c', days: 2, dir: 'n' }]));
    check('the scale, the unit, the pace, the notes, the lock', a.scale === 'world' && a.unit === 'km' && a.pace === 30 && a.notes === 'the sea matters \n most' && a.locked === true);
    check('a strange scale or unit falls back', normalizeAtlas({ scale: 'galaxy', unit: 'parsec', pace: -4 }).scale === '' && normalizeAtlas({ unit: 'parsec' }).unit === 'mi' && normalizeAtlas({ pace: -4 }).pace === 0);
    check('the file carries nothing for an atlas that says nothing', atlasToRaw(empty) === null && same(atlasToRaw({ scale: 'town' }), { scale: 'town' }));
}

console.log('\n§2 kinds and terrains');
{
    check('a kind from a name', guessKind('The Iron Inn') === 'tavern' && guessKind('Fish Market') === 'shop' && guessKind('Frosthold Keep') === 'stronghold' && guessKind('The Old Shrine') === 'sacred' && guessKind('Sunken Crypt') === 'ruin' && guessKind('Greywood Forest') === 'wild' && guessKind('Saltport') === 'other' && guessKind('The Quay') === 'water' && guessKind("Mara's House") === 'home');
    check('a terrain from a name', guessTerrain('Greywood Forest') === 'forest' && guessTerrain('The Salt Coast') === 'coast' && guessTerrain('The Northmarch') === 'snow' && guessTerrain('Elsewhere') === 'plains' && guessTerrain('The Dune Sea') === 'desert');
    check('a kind made safe', cleanKind(' Ruin ') === 'ruin' && cleanKind('spaceship') === '' && cleanKind(null) === '');
    check('the kinds have a label and an icon each, ids apart', ATLAS_KINDS.every(k => k.id && k.label && /^fa-/.test(k.icon)) && new Set(ATLAS_KINDS.map(k => k.id)).size === ATLAS_KINDS.length);
    check('the hash is the same for the same text and within 0..1', hash01('greywood') === hash01('greywood') && hash01('greywood') !== hash01('saltcoast') && hash01('x') >= 0 && hash01('x') < 1 && hash01('') >= 0);
}

console.log('\n§3 the pack carries it');
{
    const p = realm();
    check('a place keeps its kind and its note', p.places.find(x => x.id === 'old-shrine').kind === 'ruin' && p.places.find(x => x.id === 'iron-inn').note === 'Warm, loud, and full of soldiers.' && p.places.find(x => x.id === 'frosthold').kind === '');
    check('a pack without an atlas has the defaults', same(p.atlas, normalizeAtlas(null)));
    const raw = withSpot(worldToRaw(p), 'saltport', { x: 3.5, y: -1.25 });
    const back = normalizePack(raw).pack;
    check('a spot set by hand survives the file and back', same(back.atlas.spots, { saltport: { x: 3.5, y: -1.25, by: 'user' } }) && same(worldToRaw(back).atlas, { spots: { saltport: { x: 3.5, y: -1.25, by: 'user' } } }));
    check('the kind and the note survive the file and back', worldToRaw(back).places.find(x => x.id === 'old-shrine').kind === 'ruin' && worldToRaw(back).places.find(x => x.id === 'iron-inn').note.startsWith('Warm'));
    check('a spot for a place that is not there leaves the world as it is', withSpot(worldToRaw(p), 'nowhere', { x: 1, y: 1 }).atlas === undefined);
    check('a spot cleared goes back to the layout', same(withSpot(raw, 'saltport', null).atlas.spots, {}));
    check('the example world still reads', harbour.places.length > 0 && same(harbour.atlas, normalizeAtlas(null)));
}

console.log('\n§4 rooms fold into their building (D152)');
{
    check('a location\'s parts', same(labelSegments("Mara's House - Bedroom (by the window)"), ["Mara's House", 'Bedroom', 'by the window']) && same(labelSegments('Well-lit Hall'), ['Well-lit Hall']) && same(labelSegments('Saltport, the Quay'), ['Saltport', 'the Quay']));
    check('a room\'s key', roomKey('the master bed room') === 'master bedroom' && roomKey('Bedroom on the wall') === 'bedroom' && roomKey("Mara's bedroom") === "mara's bedroom" && roomKey('Roomy Tavern') === '' && roomKey('The Hallway') === 'hallway' && roomKey('Saltport') === '');
    const fold = (labels) => foldPlaces(labels.map(l => ({ id: `loc:${l.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`, label: l })));
    const a = fold(['Bedroom', 'bedroom on the wall', 'Bedroom (by the window)', 'Bedroom - bed', 'Kitchen']);
    check('the same room under five wordings is one place', a.length === 2 && a[0].id === 'loc:bedroom' && a[0].label === 'Bedroom' && a[0].members.length === 4 && a[1].id === 'loc:kitchen', JSON.stringify(a.map(g => [g.id, g.members.length])));
    const b = fold(["Mara's House, Bedroom", "Mara's House - Kitchen", "Hallway, Mara's House", "Mara's House"]);
    check('rooms fold into the house, whichever side it is named on', b.length === 1 && b[0].id === 'loc:mara-s-house' && b[0].members.some(m => m.id === 'loc:mara-s-house') && b[0].label === "Mara's House" && b[0].members.length === 4 && same(b[0].rooms, ['Bedroom', 'Kitchen', 'Hallway']), JSON.stringify(b));
    const c = fold(['Saltport, the Quay', 'Saltport, the Market', 'Greywood']);
    check('a part two locations share is their place', c.length === 2 && c[0].id === 'loc:saltport' && same(c[0].rooms, ['the Quay', 'the Market']) && c[1].id === 'loc:greywood');
    const d = fold(['Saltport, the Quay', 'The Iron Inn', 'Old Road to Saltport']);
    check('a location that shares nothing and names no room stands as it is', d.length === 3 && d[0].id === 'loc:saltport-the-quay' && d[0].label === 'Saltport, the Quay' && d[0].rooms.length === 0);
    check('two people\'s bedrooms stay apart', fold(["Mara's bedroom", "Odo's bedroom"]).length === 2);
    check('nothing folds to nothing', same(foldPlaces([]), []) && same(foldPlaces(null), []));
}

console.log('\n§5 the book (D151)');
{
    check('nothing: an empty book', same(normalizeBook(null), { scale: '', drawn: false, spots: {}, inside: {}, scales: {}, gone: [], merged: {}, made: [], edits: {} }));
    const dirty = normalizeBook({ scale: 'galaxy', spots: { a: { x: 1.23456, y: 2 }, b: { x: 'no', y: 1 } }, gone: ['x', 'x', 7], merged: { a: 'a', b: 'c' }, made: [{ id: 'pin:a', label: ' The Well ', kind: 'WATER' }, { id: 'nope', label: 'x' }, { id: 'pin:a', label: 'twice' }], edits: { q: { label: ' New ', kind: 'spaceship', note: 'n' }, z: {} } });
    check('a book made safe', same(dirty, { scale: '', drawn: false, spots: { a: { x: 1.2346, y: 2 } }, inside: {}, scales: {}, gone: ['x'], merged: { b: 'c' }, made: [{ id: 'pin:a', label: 'The Well', kind: 'water', note: '' }], edits: { q: { label: 'New', note: 'n' } } }));
    let b = placeAt(null, 'loc:the-quay', { x: 2, y: -3 });
    check('a marker placed, moved, taken off', same(b.spots, { 'loc:the-quay': { x: 2, y: -3 } }) && same(placeAt(b, 'loc:the-quay', { x: 5, y: 5 }).spots['loc:the-quay'], { x: 5, y: 5 }) && same(unplace(b, 'loc:the-quay').spots, {}) && same(placeAt(b, 'x', { x: NaN, y: 1 }), b));
    const p1 = addPin(b, { label: 'The Old Well', kind: 'water', note: 'Dry.', x: 1, y: 1 });
    const p2 = addPin(p1.book, { label: 'The Old Well', x: 2, y: 2 });
    check('a marker made by hand: an id of its own, a spot, a second of the same name apart', p1.id === 'pin:the-old-well' && p2.id === 'pin:the-old-well-2' && same(p1.book.made, [{ id: 'pin:the-old-well', label: 'The Old Well', kind: 'water', note: 'Dry.' }]) && same(p2.book.spots['pin:the-old-well-2'], { x: 2, y: 2 }));
    const del = removeMarker(p2.book, 'pin:the-old-well');
    check('a hand-made marker deleted is forgotten', del.made.length === 1 && !del.spots['pin:the-old-well'] && del.gone.length === 0);
    const del2 = removeMarker(b, 'loc:the-quay');
    check('a place deleted is kept in `gone`, off the map; restored, it is back', same(del2.gone, ['loc:the-quay']) && same(del2.spots, {}) && same(removeMarker(del2, 'loc:the-quay').gone, ['loc:the-quay']) && same(restoreMarker(del2, 'loc:the-quay').gone, []));
    const m = mergeInto(placeAt(b, 'loc:b', { x: 1, y: 1 }), 'loc:b', 'loc:the-quay');
    check('a merge: the first leaves the map and points at the second', same(m.merged, { 'loc:b': 'loc:the-quay' }) && !m.spots['loc:b'] && mergeTarget(m, 'loc:b') === 'loc:the-quay' && mergeTarget(m, 'loc:the-quay') === 'loc:the-quay');
    check('a merge that would loop, or into itself, is refused', same(mergeInto(m, 'loc:the-quay', 'loc:b'), m) && same(mergeInto(m, 'loc:b', 'loc:b'), m));
    check('a chain of merges ends at the last', mergeTarget(mergeInto(m, 'loc:the-quay', 'loc:c'), 'loc:b') === 'loc:c');
    check('a merge undone; deleting the target lets go of what was merged in', same(unmerge(m, 'loc:b').merged, {}) && same(removeMarker(m, 'loc:the-quay').merged, {}));
    const e = editMarker(b, 'loc:the-quay', { label: 'The Long Quay', kind: 'water', note: 'Tarred planks.' });
    check('a name, a kind and a note changed', same(e.edits['loc:the-quay'], { label: 'The Long Quay', kind: 'water', note: 'Tarred planks.' }) && !editMarker(e, 'loc:the-quay', { kind: '' }).edits['loc:the-quay'].kind && editMarker(p1.book, p1.id, { label: 'The Dry Well' }).made[0].label === 'The Dry Well');
    check('the drawn map chosen over the picture, and back', withDrawn(b, true).drawn === true && withDrawn(withDrawn(b, true), false).drawn === false && normalizeBook({ drawn: 'yes' }).drawn === false);
    check('the scale chosen by hand, for the top map and for a place\'s own', withScale(b, 'world').scale === 'world' && withScale(b, 'galaxy').scale === '' && same(withScale(b, 'site', 'loc:the-stair').scales, { 'loc:the-stair': 'site' }) && same(withScale(withScale(b, 'site', 'loc:the-stair'), '', 'loc:the-stair').scales, {}) && withScale(b, 'site', 'loc:the-stair').scale === '');
    check('a marker placed on a place\'s map belongs to it; on the top map, said outright', same(placeAt(b, 'loc:house', { x: 1, y: 1 }, 'loc:hask').inside, { 'loc:house': 'loc:hask' }) && same(placeAt(b, 'loc:house', { x: 1, y: 1 }, '').inside, { 'loc:house': '' }) && same(placeAt(b, 'loc:house', { x: 1, y: 1 }).inside, {}) && same(placeAt(b, 'loc:house', { x: 1, y: 1 }, 'loc:house').inside, {}));
    check('a marker moved into a place leaves its map and waits in the other\'s; into itself is refused', same(moveInto(b, 'loc:the-quay', 'loc:hask').inside, { 'loc:the-quay': 'loc:hask' }) && same(moveInto(b, 'loc:the-quay', 'loc:hask').spots, {}) && same(moveInto(b, 'loc:the-quay', 'loc:the-quay'), b) && same(moveInto(moveInto(b, 'loc:the-quay', 'loc:hask'), 'loc:the-quay', '').inside, { 'loc:the-quay': '' }));
    check('a marker made by hand on a place\'s map belongs to it', addPin(b, { label: 'Level Two', x: 0, y: 0, layer: 'loc:the-stair' }).book.inside['pin:level-two'] === 'loc:the-stair');
    check('the book is never changed in place', same(b.spots, { 'loc:the-quay': { x: 2, y: -3 } }) && b.made.length === 0);
}

console.log('\n§6 the model: nothing lands by itself (D151), and the maps are layered (D156)');
{
    const p = realm([{ id: 'hask-town', label: 'The Northmarch', parent: 'northmarch' }, { id: 'inn-cellar', label: 'Cellar', parent: 'iron-inn' }, { id: 'stair', label: 'The Stair', parent: 'frosthold' }, { id: 'stair-2', label: 'Second Landing', parent: 'stair' }]);
    const state = seedWorldState(p, { name: '' });
    state.visited = [
        { id: 'iron-inn', label: 'The Iron Inn', packId: 'iron-inn', path: 'northmarch/iron-inn', visits: [4] },
        { id: 'loc:the-burnt-mill', label: 'The Burnt Mill', packId: '', path: '', visits: [2] },
        { id: 'loc:bedroom', label: 'Bedroom', packId: '', path: '', visits: [] },
        { id: 'loc:bedroom-on-the-wall', label: 'bedroom on the wall', packId: '', path: '', visits: [] },
    ];
    state.where = { ...state.where, Kessa: 'loc:bedroom-on-the-wall', Hero: 'northmarch/frosthold/stair/stair-2', Odo: 'saltcoast/saltport/fish-market' };
    const ids = (list) => list.map(x => x.id).sort();
    const top = atlasModel({ pack: p, state, player: 'Hero' });
    check('with an empty book the top map is empty: no marker, no land, no path', top.markers.length === 0 && top.land.length === 0 && top.routes.length === 0 && !top.empty && top.layer === '' && top.trail.length === 0);
    check('the top map\'s tray: the places that are inside nothing, the story\'s own folded', same(ids(top.tray), ['greywood', 'loc:bedroom', 'loc:the-burnt-mill', 'northmarch', 'saltcoast']), JSON.stringify(ids(top.tray)));
    const t = (m, id) => m.tray.find(x => x.id === id) || m.markers.find(x => x.id === id);
    check('a place holds what is inside it: its count, the people, the party', t(top, 'northmarch').holds === 2 && same(t(top, 'northmarch').people.sort(), ['Mara']) && t(top, 'northmarch').player && t(top, 'northmarch').partyInside && top.partyInTray === 'northmarch' && top.partyId === 'stair-2' && top.partyLayer === 'stair');
    check('the party\'s place is first in the tray', top.tray[0].id === 'northmarch');
    check('the two bedrooms are one place, and Kessa stands in it', !!t(top, 'loc:bedroom') && !t(top, 'loc:bedroom-on-the-wall') && same(t(top, 'loc:bedroom').people, ['Kessa']) && same(t(top, 'loc:bedroom').rooms, ['bedroom on the wall']));
    check('an empty map still has room to place things', top.bounds.minX <= -CANVAS && top.bounds.maxX >= CANVAS);

    const north = atlasModel({ pack: p, state, player: 'Hero', layer: 'northmarch' });
    check('inside a place: its own places, and the trail back out', north.layer === 'northmarch' && north.layerLabel === 'The Northmarch' && north.depth === 1 && same(north.trail, [{ id: 'northmarch', label: 'The Northmarch' }]) && same(ids(north.tray.filter(x => x.here)), ['frosthold', 'iron-inn']));
    check('a child that carries its parent\'s name folds into it (the city inside the city)', !north.tray.some(x => x.id === 'hask-town') && t(top, 'northmarch').rooms.length === 0);
    check('a child that is a room folds into its place; a child that is a place has a map to stand on', same(t(north, 'iron-inn').rooms, ['Cellar']) && t(north, 'iron-inn').holds === 0 && t(north, 'frosthold').holds === 1);
    check('what is on no map yet can be put on this one', same(ids(north.tray.filter(x => x.here === false)), ['loc:bedroom', 'loc:the-burnt-mill']) && !north.tray.some(x => x.id === 'greywood'));
    const stair = atlasModel({ pack: p, state, player: 'Hero', layer: 'stair' });
    check('a dungeon three maps down: its trail, its level, the party on it', stair.depth === 3 && same(stair.trail.map(x => x.id), ['northmarch', 'frosthold', 'stair']) && same(ids(stair.tray.filter(x => x.here)), ['stair-2']) && t(stair, 'stair-2').player && !t(stair, 'stair-2').partyInside);
    check('a layer that is not there falls back to the top map', atlasModel({ pack: p, state, layer: 'nowhere' }).layer === '' && atlasModel({ pack: p, state, layer: 'hask-town' }).layer === '');
    check('the scales by depth: a region on top when places hold maps, a town one in, a site below; each map\'s own wins', top.measure.scale === 'region' && north.measure.scale === 'town' && stair.measure.scale === 'site' && atlasModel({ pack: p, state, layer: 'stair', book: withScale(null, 'town', 'stair') }).measure.scale === 'town' && atlasModel({ pack: p, state, book: withScale(null, 'world') }).measure.scale === 'world');
    check('every place on every map is listed with its map, for the search, Merge, Move and the clean-up', top.all.length === 13 && top.all.find(x => x.id === 'stair-2').layerLabel === 'The Stair' && same(top.all.find(x => x.id === 'stair-2').inside, ['northmarch', 'frosthold', 'stair']) && top.all.find(x => x.id === 'northmarch').layer === '' && same(top.all.find(x => x.id === 'fish-market').people, ['Odo']) && top.all.find(x => x.id === 'fish-market').layerLabel === 'Saltport', String(top.all.length));

    // Placing.
    let book = placeAt(null, 'northmarch', { x: 0, y: 0 }, '');
    book = placeAt(book, 'greywood', { x: 4, y: 0 }, '');
    book = placeAt(book, 'iron-inn', { x: 1, y: 1 }, 'northmarch');
    book = placeAt(book, 'frosthold', { x: 3, y: 0 }, 'northmarch');
    const m1 = atlasModel({ pack: p, state, player: 'Hero', book });
    const mk = (m, id) => m.markers.find(x => x.id === id);
    check('placed on the top map: markers where they were put, off the tray, the land and a path under them', m1.markers.length === 2 && mk(m1, 'northmarch').x === 0 && mk(m1, 'northmarch').by === 'user' && m1.tray.length === 3 && m1.land.length === 2 && m1.land.every(l => l.outline.length === 28 && l.ripple1.length === 28 && l.radius === LAND_RADIUS) && m1.routes.length === 1);
    check('the party inside a marker marks it; the marker is where distances are measured from', m1.party === 'northmarch' && mk(m1, 'northmarch').player && mk(m1, 'northmarch').partyInside);
    check('a marker whose name tells a terrain stands on tinted ground with its drawings', m1.regions.length === 2 && m1.regions.find(r => r.id === 'greywood').terrain === 'forest' && m1.regions.find(r => r.id === 'greywood').glyphs.length > 0 && m1.regions.every(r => r.label === ''));
    const n1 = atlasModel({ pack: p, state, player: 'Hero', book, layer: 'northmarch' });
    check('each map has its own markers: the places put inside are not on the top map', n1.markers.length === 2 && ids(n1.markers).join() === 'frosthold,iron-inn' && !m1.markers.some(x => x.id === 'iron-inn') && n1.party === 'frosthold');
    check('the bounds hold the land', m1.land.every(l => l.ripple2.every(([x, y]) => x > m1.bounds.minX && x < m1.bounds.maxX && y > m1.bounds.minY && y < m1.bounds.maxY)));
    const moved = atlasModel({ pack: p, state, book: placeAt(book, 'saltcoast', { x: 9, y: 9 }, '') });
    check('placing another moves nothing already there (D140)', ['northmarch', 'greywood'].every(id => same([mk(m1, id).x, mk(m1, id).y], [mk(moved, id).x, mk(moved, id).y])));

    // A story place put inside a place, and moved back out.
    const inMill = atlasModel({ pack: p, state, book: placeAt(book, 'loc:the-burnt-mill', { x: -2, y: 2 }, 'northmarch'), layer: 'northmarch' });
    check('a place on no map dropped on a place\'s map is inside it from then on', !!mk(inMill, 'loc:the-burnt-mill') && atlasModel({ pack: p, state, book: placeAt(book, 'loc:the-burnt-mill', { x: -2, y: 2 }, 'northmarch') }).tray.every(x => x.id !== 'loc:the-burnt-mill') && inMill.all.find(x => x.id === 'loc:the-burnt-mill').layer === 'northmarch');
    const out = atlasModel({ pack: p, state, book: moveInto(book, 'iron-inn', '') });
    check('a place moved out to the top map waits in its tray', out.tray.some(x => x.id === 'iron-inn' && x.here) && atlasModel({ pack: p, state, book: moveInto(book, 'iron-inn', ''), layer: 'northmarch' }).markers.length === 1);
    const loop = atlasModel({ pack: p, state, book: moveInto(moveInto(null, 'northmarch', 'frosthold'), 'frosthold', 'northmarch') });
    check('two places put inside each other: neither is lost', loop.all.some(x => x.id === 'northmarch') && loop.all.some(x => x.id === 'frosthold') && (loop.tray.some(x => x.id === 'northmarch') || loop.tray.some(x => x.id === 'frosthold')));

    // Deleted, merged, made, renamed.
    const gone = atlasModel({ pack: p, state, player: 'Hero', book: removeMarker(book, 'loc:bedroom') });
    check('a deleted place is off every map and tray, its people with it, and listed for a restore', !gone.all.some(x => x.id === 'loc:bedroom') && same(gone.deleted, [{ id: 'loc:bedroom', label: 'Bedroom' }]) && !gone.all.some(x => x.people.includes('Kessa')));
    const state2 = { ...state, visited: [...state.visited, { id: 'loc:bedroom-floor', label: 'Bedroom floor', packId: '', path: '', visits: [9] }] };
    check('the story naming it again does not bring it back', !atlasModel({ pack: p, state: state2, book: removeMarker(book, 'loc:bedroom') }).all.some(x => /bedroom/i.test(x.label)));
    const holder = atlasModel({ pack: p, state, book: removeMarker(book, 'northmarch') });
    check('a deleted place\'s own places fall to the top map rather than vanish', ['frosthold', 'iron-inn'].every(id => holder.all.find(x => x.id === id).layer === '' && holder.markers.some(x => x.id === id)));
    const merged = atlasModel({ pack: p, state, player: 'Hero', book: mergeInto(book, 'loc:bedroom', 'iron-inn'), layer: 'northmarch' });
    check('a merged place leaves; the target is also called it and holds its rooms and people', !merged.all.some(x => x.id === 'loc:bedroom') && same(mk(merged, 'iron-inn').names, [{ id: 'loc:bedroom', label: 'Bedroom' }]) && same(mk(merged, 'iron-inn').people.sort(), ['Kessa', 'Mara']) && mk(merged, 'iron-inn').rooms.includes('bedroom on the wall'));
    const mergedHolder = atlasModel({ pack: p, state, book: mergeInto(book, 'northmarch', 'greywood'), layer: 'greywood' });
    check('a place merged into another takes what was inside it along', mergedHolder.markers.some(x => x.id === 'iron-inn') && mergedHolder.markers.some(x => x.id === 'frosthold'));
    const pin = addPin(book, { label: 'The Old Well', kind: 'water', x: -2, y: -2, layer: 'northmarch' });
    check('a marker made by hand is on the map it was made on, with its kind', mk(atlasModel({ pack: p, state, book: pin.book, layer: 'northmarch' }), pin.id).kind === 'water' && !atlasModel({ pack: p, state, book: pin.book }).markers.some(x => x.id === pin.id));
    const renamed = mk(atlasModel({ pack: p, state, book: editMarker(book, 'greywood', { label: 'The Greywood', kind: 'wild', note: 'Old trees.' }) }), 'greywood');
    check('a renamed marker shows its new name, kind and note', same([renamed.label, renamed.kind, renamed.note], ['The Greywood', 'wild', 'Old trees.']));
    check('the weather on a marker', mk(atlasModel({ pack: p, state, book, weather: { greywood: { emoji: '🌧️', text: 'Rain' } } }), 'greywood').weather.text === 'Rain' && mk(m1, 'greywood').weather === null);

    // Place all.
    const sug = suggestSpots(m1);
    const allSpots = [...sug.values(), ...m1.markers];
    check('Place all proposes a spot for everything that waits for this map, none on another', sug.size === 3 && allSpots.every((a, i) => allSpots.every((b, j) => i >= j || Math.hypot(a.x - b.x, a.y - b.y) >= 1.29)) && same([...sug], [...suggestSpots(m1)]));
    const full = atlasModel({ pack: p, state, player: 'Hero', book: placeAll(book, m1) });
    check('Place all empties the tray and keeps what was placed where it was', full.tray.length === 0 && full.markers.length === 5 && mk(full, 'northmarch').x === 0);
    const nFull = placeAll(book, atlasModel({ pack: p, state, book: moveInto(book, 'frosthold', 'northmarch'), layer: 'northmarch' }));
    check('inside a place, Place all places its own and leaves what is on no map', !nFull.spots['loc:bedroom'] && !nFull.spots['loc:the-burnt-mill']);
    const world = normalizePack(withSpot(worldToRaw(p), 'saltcoast', { x: 6, y: 6 })).pack;
    check('a spot the world carries of its own counts as placed; the book\'s wins over it', atlasModel({ pack: world, state }).markers[0].by === 'world' && atlasModel({ pack: world, state, book: placeAt(null, 'saltcoast', { x: 0, y: 0 }) }).markers[0].x === 0);
    const blank = blankPack('Ashfall');
    const bs = seedWorldState(blank, { name: 'Ashfall' });
    bs.visited = [{ id: 'loc:the-quay', label: 'The Quay', packId: '', path: '', visits: [1] }];
    const bm = atlasModel({ pack: blank, state: bs });
    check('the blank world: the story\'s place in the tray, the party with it, a town\'s scale', bm.tray.length === 1 && bm.partyInTray === 'loc:the-quay' && bm.measure.scale === 'town');
    check('nothing at all is said', atlasModel({ pack: blankPack('Nothing'), state: null }).empty === true);
    check('the example world reads', atlasModel({ pack: harbour, state: seedWorldState(harbour, { name: '' }) }).tray.length > 0);
}

console.log('\n§7 distance');
{
    const p = realm();
    const book = placeAt(placeAt(placeAt(null, 'northmarch', { x: 0, y: 0 }), 'greywood', { x: 3, y: 4 }), 'saltcoast', { x: -6, y: 8 });
    const m = atlasModel({ pack: p, book });
    check('the straight line times the map\'s scale', near(distanceBetween(m, 'northmarch', 'greywood'), 5 * 15) && near(distanceBetween(m, 'northmarch', 'saltcoast'), 10 * 15));
    check('the same both ways, nothing to itself, null off this map', near(distanceBetween(m, 'greywood', 'northmarch'), 75) && distanceBetween(m, 'northmarch', 'northmarch') === 0 && distanceBetween(m, 'northmarch', 'frosthold') === null);
    const more = atlasModel({ pack: realm([{ id: 'far-isle', label: 'Far Isle' }]), book: placeAt(book, 'far-isle', { x: 1, y: 1 }) });
    check('a place added later changes no distance (D141)', near(distanceBetween(more, 'northmarch', 'greywood'), 75, 1e-9));
    const inner = atlasModel({ pack: p, book: placeAt(placeAt(book, 'frosthold', { x: 0, y: 0 }, 'northmarch'), 'iron-inn', { x: 3, y: 4 }, 'northmarch'), layer: 'northmarch' });
    check('the same steps inside a place are a town\'s: half a mile, minutes on foot', near(distanceBetween(inner, 'frosthold', 'iron-inn'), 0.5) && /minutes/.test(describeDistance(inner, 'frosthold', 'iron-inn')), describeDistance(inner, 'frosthold', 'iron-inn'));
    check('the scale: the world\'s own wins over the guess, the book\'s over that', scaleOf(p) === 'region' && scaleOf(blankPack('x')) === 'town' && scaleOf(normalizePack({ ...worldToRaw(p), atlas: { scale: 'world' } }).pack) === 'world' && scaleOf(normalizePack({ ...worldToRaw(p), atlas: { scale: 'world' } }).pack, withScale(null, 'town')) === 'town' && scaleOf(p, null, 'x', { depth: 1 }) === 'town' && scaleOf(p, null, 'x', { depth: 2 }) === 'site');
    const km = measureOf(normalizePack({ ...worldToRaw(p), atlas: { unit: 'km' } }).pack);
    check('the measure: the unit, a layout unit in it, the pace', same(measureOf(p), { unit: 'mi', per: 15, pace: 24, scale: 'region' }) && km.unit === 'km' && near(km.per, 24.1402) && near(km.pace, 38.6243) && measureOf(p, null, 'x', { depth: 2 }).per === 0.012);
    check('hours at the pace: a day is eight hours of the road', near(travelHours(24, measureOf(p)), 8) && near(travelHours(3, measureOf(p)), 1));
    check('a length in words', describeLength(3.24) === '3.2 miles' && describeLength(1) === '1 mile' && describeLength(12.3) === '12.5 miles' && describeLength(240.4) === '240 miles' && describeLength(5, 'km') === '5 km' && describeLength(2, 'league') === '2 leagues');
    check('a time in words', describeTime(0) === 'no time at all' && describeTime(0.05) === 'a few minutes' && describeTime(0.33) === 'about 20 minutes' && describeTime(1) === 'about an hour' && describeTime(3.2) === 'about 3 hours' && describeTime(8) === 'about a day' && describeTime(20) === 'about 2.5 days');
    check('the card\'s line', describeDistance(m, 'northmarch', 'greywood') === '75 miles, about 3 days on foot' && describeDistance(m, 'northmarch', 'northmarch') === '' && describeDistance(m, '', 'northmarch') === '' && describeDistance(m, 'northmarch', 'nowhere') === '', describeDistance(m, 'northmarch', 'greywood'));
}

console.log('\n§8 the search and the switches');
{
    const p = realm();
    const state = seedWorldState(p, { name: '' });
    let book = placeAll(null, atlasModel({ pack: p, state }));
    book = placeAll(book, atlasModel({ pack: p, state, book, layer: 'northmarch' }));
    const m = atlasModel({ pack: p, state, book, layer: 'northmarch' });
    const ids = (list) => list.map(x => x.id).sort();
    check('no search, nothing off: every marker of this map', filterMarkers(m.markers).length === 2);
    check('a search over names, rooms, notes and people', same(ids(filterMarkers(m.markers, { query: 'iron' })), ['iron-inn']) && same(ids(filterMarkers(m.markers, { query: 'soldiers' })), ['iron-inn']) && same(ids(filterMarkers(m.markers, { query: 'mara' })), ['iron-inn']));
    check('the list of every place is searched the same way, whatever map it is on', same(ids(filterMarkers(m.all, { query: 'fish market' })), ['fish-market']) && same(ids(filterMarkers(m.all, { query: 'odo' })), ['fish-market']) && same(ids(filterMarkers(m.all, { query: 'salt coast' })), ['saltcoast', 'saltport']));
    check('a kind switched off hides its markers', filterMarkers(m.markers, { hidden: ['tavern'] }).length === 1);
    const counts = kindCounts(m.markers);
    check('the counts: the kinds on the map, in the list\'s order, none empty', counts.every(k => k.count > 0) && counts.reduce((n, k) => n + k.count, 0) === 2 && same(counts.map(k => k.id), ATLAS_KINDS.map(k => k.id).filter(id => counts.some(k => k.id === id))));
}

console.log('\n§9 the clean-up pass (D155)');
{
    const p = realm();
    const state = seedWorldState(p, { name: '' });
    state.visited = [{ id: 'loc:the-burnt-mill', label: 'The Burnt Mill', packId: '', path: '', visits: [2] }, { id: 'loc:burned-mill-ruins', label: 'Burned mill ruins', packId: '', path: '', visits: [3] }, { id: 'loc:somewhere-dark', label: 'Somewhere dark', packId: '', path: '', visits: [4] }];
    const m = atlasModel({ pack: p, state, book: placeAt(null, 'northmarch', { x: 0, y: 0 }) });
    const list = tidyList(m);
    const n = (id) => list.find(x => x.id === id).n;
    check('every place on every map is numbered from 1', list[0].n === 1 && list.length === m.all.length && list.find(x => x.id === 'northmarch').placed && !list.find(x => x.id === 'iron-inn').placed && list.find(x => x.id === 'iron-inn').layerLabel === 'The Northmarch');
    const prompt = buildTidyPrompt({ model: m, world: 'The Realm' });
    check('the request lists every place by number with its map and its rooms, and asks for JSON', prompt.count === list.length && prompt.user.includes(`${n('saltport')}. Saltport [in The Salt Coast]`) && prompt.user.includes(`${n('northmarch')}. The Northmarch\n`) && prompt.user.includes('The Realm') && /"merge"/.test(prompt.system) && /"delete"/.test(prompt.system), prompt.user);
    const reply = '```json\n' + JSON.stringify({ merge: [{ from: n('loc:burned-mill-ruins'), into: n('loc:the-burnt-mill'), why: 'same mill' }, { from: 999, into: 1 }, { from: n('frosthold'), into: n('frosthold') }, { from: String(n('loc:burned-mill-ruins')), into: 1 }], delete: [{ id: n('loc:somewhere-dark'), why: 'not a place' }, { id: n('loc:burned-mill-ruins') }, { id: 0 }] }) + '\n```\nDone!';
    const r = parseTidy(reply, m);
    check('the reply read: the merges and deletions that name places of the list, each place once', r.ok && same(r.items, [{ kind: 'merge', id: 'loc:burned-mill-ruins', label: 'Burned mill ruins', to: 'loc:the-burnt-mill', toLabel: 'The Burnt Mill', why: 'same mill' }, { kind: 'delete', id: 'loc:somewhere-dark', label: 'Somewhere dark', why: 'not a place' }]), JSON.stringify(r.items));
    check('a merge into something the pass also removes is dropped', parseTidy(JSON.stringify({ merge: [{ from: 2, into: 3 }], delete: [{ id: 3 }] }), m).items.length === 1 && parseTidy(JSON.stringify({ merge: [{ from: 2, into: 3 }], delete: [{ id: 3 }] }), m).items[0].kind === 'delete');
    check('nothing to tidy, and a reply that is no JSON', same(parseTidy('{"merge":[],"delete":[]}', m), { ok: true, items: [], error: '' }) && parseTidy('I could not find any.', m).ok === false && parseTidy('', m).ok === false);
    let book = placeAt(null, 'northmarch', { x: 0, y: 0 });
    for (const item of r.items) book = applyTidyItem(book, item);
    const after = atlasModel({ pack: p, state, book });
    check('approved: the duplicate is merged, the non-place deleted, the rest untouched', same(book.merged, { 'loc:burned-mill-ruins': 'loc:the-burnt-mill' }) && same(book.gone, ['loc:somewhere-dark']) && after.all.length === m.all.length - 2 && same(after.tray.find(x => x.id === 'loc:the-burnt-mill').names, [{ id: 'loc:burned-mill-ruins', label: 'Burned mill ruins' }]) && same(after.deleted, [{ id: 'loc:somewhere-dark', label: 'Somewhere dark' }]));
}

console.log(failures ? `\n${failures} failure(s)` : '\nall pass');
process.exit(failures ? 1 : 0);
