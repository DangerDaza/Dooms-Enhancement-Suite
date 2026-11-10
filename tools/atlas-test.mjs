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
import { buildTravelInstruction } from '../src/utils/worldMap.js';
import {
    ATLAS_KINDS, CANVAS, LAND_RADIUS, normalizeAtlas, atlasToRaw, guessKind, guessTerrain, cleanKind, hash01, scaleOf, measureOf,
    atlasModel, distanceBetween, travelHours, describeLength, describeTime, describeDistance,
    filterMarkers, kindCounts, withSpot, labelSegments, roomKey, foldPlaces,
    normalizeBook, placeAt, unplace, addPin, removeMarker, restoreMarker, mergeInto, mergeTarget, unmerge, editMarker, withScale, withDrawn, moveInto, withGround, groundOf, groundDecor, ATLAS_GROUNDS, territoryOutlines, territoryCells, territoryShades, landmassOutline, territoryAt, pointInPolygon, wrapInRegion, TERRITORY_RADIUS, toggleRoad, setRoadTime, routeBetween, describeJourney, CROSS_COUNTRY, suggestSpots, placeAll, tidyList, buildTidyPrompt, parseTidy, applyTidyItem, landFrame, landTerrain, edgeDistance, spotOnLand,
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
    check('nothing: an empty book', same(normalizeBook(null), { scale: '', ground: '', drawn: false, spots: {}, inside: {}, scales: {}, grounds: {}, roads: [], cut: [], roadHours: {}, gone: [], merged: {}, made: [], edits: {} }));
    const dirty = normalizeBook({ scale: 'galaxy', spots: { a: { x: 1.23456, y: 2 }, b: { x: 'no', y: 1 } }, gone: ['x', 'x', 7], merged: { a: 'a', b: 'c' }, made: [{ id: 'pin:a', label: ' The Well ', kind: 'WATER' }, { id: 'nope', label: 'x' }, { id: 'pin:a', label: 'twice' }], edits: { q: { label: ' New ', kind: 'spaceship', note: 'n' }, z: {} } });
    check('a book made safe', same(dirty, { scale: '', ground: '', drawn: false, spots: { a: { x: 1.2346, y: 2 } }, inside: {}, scales: {}, grounds: {}, roads: [], cut: [], roadHours: {}, gone: ['x'], merged: { b: 'c' }, made: [{ id: 'pin:a', label: 'The Well', kind: 'water', note: '' }], edits: { q: { label: 'New', note: 'n' } } }));
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

console.log('\n§6b the grounds (D158)');
{
    check('the ground by the map\'s scale: open country, streets, and for a site the underground when its name tells of one', groundOf(null, '', { scale: 'region' }) === 'country' && groundOf(null, '', { scale: 'world' }) === 'country' && groundOf(null, 'x', { scale: 'town' }) === 'city' && groundOf(null, 'x', { scale: 'site', label: 'the black stair' }) === 'underground' && groundOf(null, 'x', { scale: 'site', label: 'The Old Crypt' }) === 'underground' && groundOf(null, 'x', { scale: 'site', kind: 'ruin', label: 'Greyhall' }) === 'underground' && groundOf(null, 'x', { scale: 'site', label: "Mara's House" }) === 'indoors');
    check('the ground chosen by hand wins, for the top map and for a place\'s own; an unknown one is the default again', groundOf(withGround(null, 'island'), '', { scale: 'region' }) === 'island' && groundOf(withGround(null, 'coast-s', 'hask'), 'hask', { scale: 'town' }) === 'coast-s' && groundOf(withGround(null, 'coast-s', 'hask'), '', { scale: 'region' }) === 'country' && withGround(withGround(null, 'island'), 'lava').ground === '' && same(withGround(withGround(null, 'city', 'x'), '', 'x').grounds, {}));
    check('the grounds have a label each, ids apart', ATLAS_GROUNDS.every(g => g.id && g.label) && new Set(ATLAS_GROUNDS.map(g => g.id)).size === ATLAS_GROUNDS.length);
    const bounds = { minX: -9, minY: -9, maxX: 9, maxY: 9 };
    const marks = [{ x: 0, y: 0 }, { x: 4, y: 6 }];
    const country = groundDecor('country', 'top', bounds, marks);
    const far = (pts, r) => pts.every(([x, y]) => marks.every(m => Math.hypot(m.x - x, m.y - y) > r));
    check('open country: woods with their trees, ponds, and open plain between; none on a place; no sea', country.woods.length > 8 && country.trees.length > country.woods.length * 8 && country.ponds.length > 1 && country.woods.length + country.ponds.length < 180 && country.trees.length < 2400 && country.sea === null && country.lines.length === 0 && country.woods.every(w => far(w, 0.9)) && country.ponds.every(w => far(w, 1)) && country.trees.every(t => far(t, 0.9)), `${country.woods.length} woods, ${country.trees.length} tree lines, ${country.ponds.length} ponds`);
    check('the same map draws the same country; another map, another', same(country, groundDecor('country', 'top', bounds, marks)) && !same(country.woods, groundDecor('country', 'hask', bounds, marks).woods));
    check('a place put down later clears the wood it lands in and moves no other', (() => { const w = country.woods[0]; const at = { x: w[0][0], y: w[0][1] }; const next = groundDecor('country', 'top', bounds, [...marks, at]); return next.woods.length === country.woods.length - 1 || next.woods.length < country.woods.length && next.woods.every(x => country.woods.some(y => same(x, y))); })());
    const city = groundDecor('city', 'hask', bounds, marks);
    check('a city: streets both ways, each a line across the map', city.lines.length > 40 && city.lines.every(l => l.length === 2) && city.sea === null);
    const floor = groundDecor('indoors', 'house', bounds, marks);
    check('indoors: a floor\'s squares, closer than streets and square', floor.lines.length > 40 && floor.lines.filter(l => l[0][0] === l[1][0] || l[0][1] === l[1][1]).length === floor.lines.length);
    const south = groundDecor('coast-s', 'top', bounds, marks);
    const shoreYs = south.lines[0].map(p => p[1]);
    check('a coast to the south: the sea past a waved shore, south of every marker, with two ripples', !!south.sea && south.lines.length === 1 && south.ripples.length === 2 && Math.min(...shoreYs) > 6 && south.sea.some(p => p[1] > 15) && Math.min(...south.ripples[1].map(p => p[1])) > Math.min(...shoreYs));
    const west = groundDecor('coast-w', 'top', bounds, marks);
    check('a coast to the west: the shore west of every marker', Math.max(...west.lines[0].map(p => p[0])) < 0 && west.sea.some(p => p[0] < -15));
    check('the islands and the underground draw nothing here: their land is the markers\' own', same(groundDecor('island', 'top', bounds, marks), { lines: [], sea: null, ripples: [], woods: [], trees: [], ponds: [] }) && same(groundDecor('underground', 'x', bounds, marks), { lines: [], sea: null, ripples: [], woods: [], trees: [], ponds: [] }));
    const p = realm([{ id: 'stair', label: 'The Black Stair', parent: 'frosthold' }, { id: 'level-1', label: 'First Landing', parent: 'stair' }]);
    const st = seedWorldState(p, { name: '' });
    check('the model carries each map\'s ground: country on top, streets in a town, the underground in the stair', atlasModel({ pack: p, state: st }).ground === 'country' && atlasModel({ pack: p, state: st, layer: 'northmarch' }).ground === 'city' && atlasModel({ pack: p, state: st, layer: 'stair' }).ground === 'underground' && atlasModel({ pack: p, state: st, layer: 'stair' }).measure.scale === 'site' && atlasModel({ pack: p, state: st, book: withGround(null, 'island') }).ground === 'island' && atlasModel({ pack: p, state: st, layer: 'northmarch' }).decor.lines.length > 0);
}

console.log('\n§6c territories (D163)');
{
    const sites = [{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 6, y: 0 }, { id: 'c', x: 3, y: 5 }, { id: 'far', x: 40, y: 40 }];
    const cells = territoryOutlines(sites);
    const inside = (poly, [x, y]) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, yi] = poly[i], [xj, yj] = poly[j]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c; } return c; };
    check('every region has a land around its own spot', sites.every(s => cells.get(s.id).length >= 3 && inside(cells.get(s.id), [s.x, s.y])));
    const full = territoryCells(sites);
    const shared = (a, b) => full.get(a).outline.filter(p => full.get(b).outline.some(q => Math.abs(p[0] - q[0]) < 1e-3 && Math.abs(p[1] - q[1]) < 1e-3)).length;
    check('neighbours meet at one border: neither holds the other\'s spot, and the border\'s points are both lands\' own', !inside(cells.get('a'), [6, 0]) && !inside(cells.get('b'), [0, 0]) && shared('a', 'b') >= 5 && shared('a', 'c') >= 5 && shared('b', 'c') >= 5 && full.get('a').neighbours.includes('b') && full.get('b').neighbours.includes('a') && same(full.get('a').neighbours.slice().sort(), ['b', 'c']));
    check('a point near the border is in one land or the other, not both and not neither', [[2.4, 0.5], [3.6, 0.5], [2.9, 1.8], [1.5, 2.2]].every(pt => ['a', 'b', 'c'].filter(k => inside(cells.get(k), pt)).length === 1));
    const area = (p) => Math.abs(p.reduce((n, [x, y], k) => { const [x2, y2] = p[(k + 1) % p.length]; return n + x * y2 - x2 * y; }, 0)) / 2;
    const land = landmassOutline(sites);
    check('the regions share one landmass: every spot is on it, with room around', sites.every(st => pointInPolygon(land, st.x, st.y) && pointInPolygon(land, st.x + 2, st.y) && pointInPolygon(land, st.x, st.y - 2)) && !pointInPolygon(land, -9, 0) && !pointInPolygon(land, 49, 40));
    check('the lands tile the landmass with nothing left over and nothing twice', near(['a', 'b', 'c', 'far'].reduce((n, k) => n + area(cells.get(k)), 0), area(land), 0.05), `${['a', 'b', 'c', 'far'].reduce((n, k) => n + area(cells.get(k)), 0)} vs ${area(land)}`);
    check('a region far from the others still borders them (D166)', full.get('far').neighbours.length >= 1 && full.get('far').neighbours.every(k => full.get(k).neighbours.includes('far') && shared('far', k) >= 5));
    check('a border is not a ruled line: it wanders off the straight way between its ends (D167)', (() => { const pts = full.get('a').outline.filter(p => full.get('b').outline.some(q => Math.abs(p[0] - q[0]) < 1e-3 && Math.abs(p[1] - q[1]) < 1e-3)); const [p0, p1] = [pts[0], pts[pts.length - 1]]; const len = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) || 1; const off = pts.map(p => Math.abs((p1[0] - p0[0]) * (p0[1] - p[1]) - (p0[0] - p[0]) * (p1[1] - p0[1])) / len); return pts.length >= 8 && Math.max(...off) > 0.12; })());
    check('the lands are uneven, as real ones are: neighbours of like standing do not hold like ground', (() => { const even = territoryCells([{ id: 'n', x: 0, y: -6 }, { id: 'e', x: 6, y: 0 }, { id: 's', x: 0, y: 6 }, { id: 'w', x: -6, y: 0 }]); const areas = ['n', 'e', 's', 'w'].map(k => area(even.get(k).outline)); return Math.max(...areas) / Math.min(...areas) > 1.12; })());
    check('a region\'s spot is on its own land however close its neighbours are put', (() => { const tight = [{ id: 'p', x: 0, y: 0 }, { id: 'q', x: 0.6, y: 0.2 }, { id: 'r', x: -0.3, y: 0.7 }, { id: 't', x: 9, y: 9 }]; const c = territoryCells(tight); return tight.every(st => c.get(st.id).outline.length >= 3 && pointInPolygon(c.get(st.id).outline, st.x, st.y)); })());
    check('one region alone is a lumpy round land about its spot', (() => { const one = territoryOutlines([{ id: 'a', x: 2, y: 2 }]).get('a'); const r = one.map(([x, y]) => Math.hypot(x - 2, y - 2)); return pointInPolygon(one, 2, 2) && Math.min(...r) > TERRITORY_RADIUS * 0.45 && Math.max(...r) < TERRITORY_RADIUS * 1.7 && Math.max(...r) - Math.min(...r) > 0.5; })());
    check('the same spots give the same lands; a border is waved, not ruled', same([...cells], [...territoryOutlines(sites)]) && cells.get('a').filter(([x]) => x > 2.6).some(([x]) => Math.abs(x - 3) > 0.03) && cells.get('a').length > 48);
    const moved = territoryOutlines([{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 6, y: 0 }, { id: 'c', x: 3, y: 5 }, { id: 'far', x: 41, y: 40 }]);
    check('a region added at one end leaves the far shore as it was', (() => { const before = landmassOutline(sites.slice(0, 3)); const after = landmassOutline([...sites.slice(0, 3), { id: 'east', x: 14, y: 0 }]); const west = (pts) => pts.filter(([x, y]) => x < -2 && Math.abs(y) < 2).map(([x, y]) => [Math.round(x * 5), Math.round(y * 5)]); return west(before).length > 3 && west(before).every(pt => west(after).some(q => Math.abs(q[0] - pt[0]) <= 2 && Math.abs(q[1] - pt[1]) <= 2)); })());
    check('the same spots, the same landmass; a spot that is not a number is left out', same(land, landmassOutline(sites)) && landmassOutline([{ id: 'x', x: NaN, y: 0 }]).length === 0 && moved.get('far').length >= 3);
    // A colour of its own for every land (D167).
    const ring = Array.from({ length: 9 }, (_, i) => ({ id: `r${i}`, terrain: 'plains', neighbours: [`r${(i + 8) % 9}`, `r${(i + 1) % 9}`] }));
    const sh = territoryShades(ring);
    const gap = (a, b) => Math.min(Math.abs(a.h - b.h), 360 - Math.abs(a.h - b.h));
    check('nine lands: nine different colours, each a different hue, from right round the wheel', sh.size === 9 && new Set([...sh.values()].map(v => v.h)).size === 9 && [...sh.values()].every(v => /^hsl\(\d+ \d+% \d+%\)$/.test(v.css)) && Math.max(...[...sh.values()].map(v => v.h)) - Math.min(...[...sh.values()].map(v => v.h)) > 150, JSON.stringify([...sh.values()].map(v => v.h)));
    check('a land is well apart on the wheel from the lands it borders', ring.every(r => r.neighbours.every(n => gap(sh.get(r.id), sh.get(n)) >= 55)), JSON.stringify(ring.map(r => Math.min(...r.neighbours.map(n => gap(sh.get(r.id), sh.get(n)))))));
    check('a land added later changes no colour already there; the same lands, the same colours', (() => { const more = territoryShades([...ring, { id: 'new', terrain: 'plains', neighbours: ['r0', 'r1'] }]); return ring.every(r => more.get(r.id).css === sh.get(r.id).css) && !ring.some(r => more.get('new').css === sh.get(r.id).css) && same([...sh], [...territoryShades(ring)]); })());
    check('a land whose name tells a terrain takes the colour nearest it when it can: a forest green, a desert sand, a coast sea-green', (() => { const t = territoryShades([{ id: 'f', terrain: 'forest', neighbours: [] }, { id: 'd', terrain: 'desert', neighbours: [] }, { id: 'c', terrain: 'coast', neighbours: [] }]); return gap(t.get('f'), { h: 105 }) <= 15 && gap(t.get('d'), { h: 45 }) <= 15 && gap(t.get('c'), { h: 170 }) <= 15; })());
    check('two forests side by side are still two colours apart', (() => { const t = territoryShades([{ id: 'f1', terrain: 'forest', neighbours: ['f2'] }, { id: 'f2', terrain: 'forest', neighbours: ['f1'] }]); return t.get('f1').css !== t.get('f2').css && gap(t.get('f1'), t.get('f2')) + Math.abs(t.get('f1').l - t.get('f2').l) * 0.6 >= 28; })());
    check('a long chain of lands: every land has a colour, no colour comes twice while there are colours left, and no land is the colour of the one before', (() => { const many = Array.from({ length: 40 }, (_, i) => ({ id: `m${i}`, terrain: 'plains', neighbours: i ? [`m${i - 1}`] : [] })); const t = territoryShades(many); return t.size === 40 && new Set(many.slice(0, 36).map(m => t.get(m.id).css)).size === 36 && new Set(many.slice(0, 12).map(m => t.get(m.id).h)).size >= 9 && many.slice(1).every((m, i) => t.get(m.id).css !== t.get(many[i].id).css); })());
    check('no regions, no lands', territoryOutlines([]).size === 0 && territoryOutlines(null).size === 0);

    // The owner's world: a city and a castle on the top map, grouped into the region they lie in.
    const pack = blankPack('The Eld');
    const st = seedWorldState(pack, { name: 'The Eld' });
    let book = addPin(null, { label: 'Hask', kind: 'settlement', x: 0, y: 0 }).book;
    book = addPin(book, { label: 'Redfall Castle', kind: 'stronghold', x: 2, y: 2 }).book;
    book = addPin(book, { label: 'The Black Stair', kind: 'ruin', x: 0, y: 0, layer: 'pin:hask' }).book;
    const before = atlasModel({ pack, state: st, book });
    check('before: two pins on the top map, no lands, a region\'s scale', before.markers.length === 2 && before.territories.length === 0 && before.measure.scale === 'region');
    const g = wrapInRegion(book, before, { label: 'The Haskmarch' });
    const top = atlasModel({ pack, state: st, book: g.book });
    check('grouped: one region on the top map where they stood, drawn as a land, at the scale its places were on', g.moved === 2 && top.markers.length === 1 && top.markers[0].kind === 'region' && top.markers[0].territory === true && top.markers[0].x === 1 && top.markers[0].y === 1 && top.territories.length === 1 && top.territories[0].outline.length >= 40 && top.measure.scale === 'region' && top.markers[0].holds === 2 && top.routes.length === 0);
    const region = atlasModel({ pack, state: st, book: g.book, layer: g.id });
    check('grouping changes no distance between the places: the region\'s own map keeps the scale they were on', near(distanceBetween(region, 'pin:hask', 'pin:redfall-castle'), distanceBetween(before, 'pin:hask', 'pin:redfall-castle')) && g.book.scales[g.id] === 'region' && (() => { const town = wrapInRegion(withScale(book, 'town'), atlasModel({ pack, state: st, book: withScale(book, 'town') })); return atlasModel({ pack, state: st, book: town.book, layer: town.id }).measure.scale === 'town'; })());
    check('inside the region: the city and the castle where they were, at a region\'s scale on open country', same(region.markers.map(m => [m.label, m.x, m.y]), [['Hask', 0, 0], ['Redfall Castle', 2, 2]]) && region.measure.scale === 'region' && region.ground === 'country' && region.territories.length === 0);
    const hask = atlasModel({ pack, state: st, book: g.book, layer: 'pin:hask' });
    check('the city inside the region is still a town, and the stair inside it a site', hask.measure.scale === 'town' && hask.depth === 2 && atlasModel({ pack, state: st, book: g.book, layer: 'pin:the-black-stair' }).measure.scale === 'site');
    const two = atlasModel({ pack, state: st, book: addPin(g.book, { label: 'The Grey Forest', kind: 'region', x: 7, y: 1, loose: true }).book });
    check('a second region beside it: two lands that border each other, the new one marked not canon, each its own shade', two.territories.length === 2 && two.territories.find(t => t.label === 'The Grey Forest').loose === true && two.territories.find(t => t.label === 'The Grey Forest').terrain === 'forest' && two.territories.every(t => /^hsl\(\d+ \d+% \d+%\)$/.test(t.fill)) && two.territories[0].fill !== two.territories[1].fill && same(two.territories[0].neighbours, [two.territories[1].id]));
    check('the region a spot of the map stands on, or none off the lands', territoryAt(two, 1, 1) === g.id && territoryAt(two, 7, 1) === two.territories.find(t => t.label === 'The Grey Forest').id && territoryAt(two, 60, 60) === '' && territoryAt(top, 1.5, 1.5) === g.id && territoryAt(before, 0, 0) === '' && territoryAt(null, 0, 0) === '');
    check('the two lands meet: a spot halfway between them is on one or the other', (() => { const mx = (two.territories[0].x + two.territories[1].x) / 2, my = (two.territories[0].y + two.territories[1].y) / 2; return [[mx - 0.5, my], [mx + 0.5, my], [mx, my + 1], [mx, my - 1]].every(([x, y]) => territoryAt(two, x, y) !== ''); })());
    check('the bounds hold the lands', two.territories.every(t => t.outline.every(([x, y]) => x > two.bounds.minX && x < two.bounds.maxX && y > two.bounds.minY && y < two.bounds.maxY)));
    check('open country keeps its woods and ponds off the lands', (() => { const d = two.decor; const off = (pts) => pts.every(([x, y]) => territoryAt(two, x, y) === ''); return d.woods.length > 0 && d.woods.every(off) && d.ponds.every(off) && d.trees.every(off); })());
    check('Place all gives regions room for their lands', (() => { const m = atlasModel({ pack, state: st, book: { ...normalizeBook(null), made: [{ id: 'pin:a', label: 'A', kind: 'region' }, { id: 'pin:b', label: 'B', kind: 'region' }, { id: 'pin:c', label: 'C', kind: 'region' }] } }); const sp = [...suggestSpots(m).values()]; return sp.length === 3 && sp.every((a, i) => sp.every((b, j) => i >= j || Math.hypot(a.x - b.x, a.y - b.y) >= TERRITORY_RADIUS * 1.29)); })());
}

console.log('\n§6c2 inside a region: its land, its neighbours, its terrain (D168)');
{
    const all = (lines) => lines.flat();
    const within = (poly, pts, by = 0) => pts.every(([x, y]) => pointInPolygon(poly, x, y) || edgeDistance(poly, x, y) <= by);
    const square = [[0, 0], [10, 0], [10, 10], [0, 10]];
    check('how far a point is from a land\'s edge', near(edgeDistance(square, 5, 5), 5) && near(edgeDistance(square, 1, 6), 1) && near(edgeDistance(square, 12, 5), 2) && edgeDistance([], 1, 1) === Infinity);

    // The borders a land shares: one run of points for every neighbour, the same run from both sides.
    const sites = [{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 9, y: 0 }, { id: 'c', x: 4, y: 8 }, { id: 'd', x: -7, y: 6 }];
    const cells = territoryCells(sites);
    check('a land comes with the border it shares with each neighbour', [...cells].every(([, c]) => same(c.borders.map(b => b.id), c.neighbours) && c.borders.every(b => b.points.length >= 2 && b.points.every(([x, y]) => edgeDistance(c.outline, x, y) < 1e-6))));
    check('a border is the same line from both sides', [...cells].every(([id, c]) => c.borders.every(b => { const back = cells.get(b.id).borders.find(o => o.id === id); return !!back && back.points.length === b.points.length && b.points.every(([x, y], i) => { const q = back.points[back.points.length - 1 - i]; return near(x, q[0]) && near(y, q[1]); }); })));

    // How a land lies on its own map.
    const landA = cells.get('a').outline;
    const still = { k: 1, dx: 0, dy: 0 };
    check('a land with nothing on it, or with its places on it, lies as it does on the map above', same(landFrame(landA, []), still) && same(landFrame(landA, [{ x: 0, y: 0 }, { x: 1.5, y: -1 }, { x: -1, y: 1.2 }]), still) && same(landFrame([], [{ x: 3, y: 3 }]), still) && same(landFrame(null, null), still));
    const away = [{ x: 40, y: 40 }, { x: 42, y: 41 }, { x: 39.4, y: 42 }];
    const fa = landFrame(landA, away);
    const onLand = (f, pts, by = 0.4) => pts.every(p => pointInPolygon(landA, (p.x - f.dx) / f.k, (p.y - f.dy) / f.k) && edgeDistance(landA, (p.x - f.dx) / f.k, (p.y - f.dy) / f.k) >= by);
    check('places laid out away from the land: the land is laid under them, no wider than it was', fa.k === 1 && (fa.dx !== 0 || fa.dy !== 0) && onLand(fa, away), JSON.stringify(fa));
    const wide = [{ x: -14, y: -9 }, { x: 15, y: 8 }, { x: 0, y: 0 }, { x: 6, y: -11 }];
    const fw = landFrame(landA, wide);
    check('places spread wider than the land: the land is drawn wider, a step at a time, until it holds them all', fw.k > 1 && [1.25, 1.6, 2, 2.5, 3.2, 4, 5, 6.4, 8].includes(fw.k) && onLand(fw, wide) && !onLand({ ...fw, k: fw.k / 1.25 }, wide, 0.45), JSON.stringify(fw));
    check('a place moved a little inside the others leaves the land where it was; the same places, the same land', same(landFrame(landA, [...wide.slice(0, 2), { x: 0.4, y: 0.3 }, wide[3]]), fw) && same(landFrame(landA, wide), fw));
    check('one place put a little past the border of a land that held the rest: the land grows where it lies, about its own middle', (() => { const edge = landA.reduce((m, p) => (p[0] > m[0] ? p : m), landA[0]); const pts = [{ x: 0, y: 0 }, { x: 1.5, y: -1 }, { x: edge[0] + 0.5, y: edge[1] }]; const f = landFrame(landA, pts); return f.k > 1 && f.k <= 1.6 && onLand(f, pts) && pointInPolygon(landA, f.dx / (1 - f.k), f.dy / (1 - f.k)) && edgeDistance(landA, f.dx / (1 - f.k), f.dy / (1 - f.k)) > 1.5; })());
    check('one place put far off: the land is laid under its places instead of growing to reach them', (() => { const pts = [{ x: 0, y: 0 }, { x: 1.5, y: -1 }, { x: 30, y: 0 }]; const f = landFrame(landA, pts); return !same(f, still) && onLand(f, pts) && f.k < 8; })());
    check('a spot of the map above, where it is on the region\'s own map', same(spotOnLand(null, { x: 2, y: 3 }), { x: 2, y: 3 }) && same(spotOnLand({ k: 2, dx: 10, dy: -4 }, { x: 2, y: 3 }), { x: 14, y: 2 }) && same(spotOnLand({ k: 1, dx: 0, dy: 0 }, { x: 2, y: 3 }), { x: 2, y: 3 }));

    // The terrain drawn across a land.
    const lone = territoryCells([{ id: 'r', x: 3, y: -2 }]).get('r').outline;
    const draw = (terrain, extra = {}) => landTerrain({ id: `land-${terrain}`, site: { x: 3, y: -2 }, outline: lone, terrain, ...extra });
    const kinds = ['plains', 'forest', 'mountains', 'snow', 'desert', 'swamp'].map(t => [t, draw(t)]);
    const t = Object.fromEntries(kinds);
    check('the same land has the same terrain every time', kinds.every(([name, d]) => same(d, draw(name))));
    check('everything drawn is on the land: the woods, the lakes, the peaks, the trees, the dunes and the reeds', kinds.every(([, d]) => d.woods.every(w => within(lone, w)) && d.lakes.every(w => within(lone, w)) && within(lone, all(d.trees), 0.01) && within(lone, d.peaks.flat(2), 0.01) && within(lone, all(d.marks), 0.01)));
    check('a land of mountains has ranges of peaks, more than open country; a forest is wooded all over; a swamp is full of meres', t.mountains.peaks.length >= 12 && t.mountains.peaks.length > t.plains.peaks.length && t.forest.trees.length > t.plains.trees.length * 1.8 && t.forest.woods.length >= 5 && t.swamp.lakes.length >= 3 && t.swamp.lakes.length > t.plains.lakes.length, JSON.stringify(kinds.map(([n, d]) => [n, d.peaks.length, d.trees.length / 2, d.woods.length, d.lakes.length, d.marks.length])));
    check('open country has woods and water; a desert has dunes and no woods, a swamp reeds; nothing else is marked with either', t.plains.woods.length >= 3 && t.plains.lakes.length >= 1 && t.desert.woods.length === 0 && t.desert.trees.length === 0 && t.desert.marks.length >= 10 && t.swamp.marks.length >= 10 && t.plains.marks.length === 0 && t.forest.marks.length === 0 && t.mountains.marks.length === 0);
    check('a range is drawn from the far side to the near: a peak is its shape first, then its ridge and its shaded side', t.mountains.peaks.every(p => p.length === 4 && p[0].length === 5) && t.mountains.peaks.every((p, i, list) => i === 0 || p[0][0][1] >= list[i - 1][0][0][1]));
    check('a land of another terrain is drawn as open country; no land, no terrain', draw('coast').woods.length >= 3 && draw('town').marks.length === 0 && same(landTerrain({ id: 'x', outline: [] }), { unit: 1, woods: [], trees: [], lakes: [], peaks: [], marks: [] }) && landTerrain().woods.length === 0);
    // A place and a road: the terrain makes way, and nothing else of it moves.
    const lake = t.plains.lakes[0];
    const lakeMid = { x: lake.reduce((n, p) => n + p[0], 0) / lake.length, y: lake.reduce((n, p) => n + p[1], 0) / lake.length };
    const wood = t.forest.woods[0];
    const woodMid = { x: wood.reduce((n, p) => n + p[0], 0) / wood.length, y: wood.reduce((n, p) => n + p[1], 0) / wood.length };
    const drowned = draw('plains', { spots: [lakeMid] });
    check('a place put where a lake was: the lake is gone, the other lakes and the woods are where they were', drowned.lakes.length === t.plains.lakes.length - 1 && drowned.lakes.every(l => t.plains.lakes.some(o => same(o, l))) && same(drowned.woods, t.plains.woods));
    const cleared = draw('forest', { spots: [woodMid] });
    const treeAt = (tr) => tr[0][3];    // where a tree's crown meets its trunk
    const crowns = (d) => d.trees.filter((_, i) => i % 2 === 0);
    check('a place put in a wood: a clearing around it, the rest of the forest as it was', crowns(cleared).every(tr => Math.hypot(tr[3][0] - woodMid.x, tr[3][1] - woodMid.y) >= 0.55) && crowns(cleared).length < crowns(t.forest).length && crowns(cleared).every(tr => crowns(t.forest).some(o => same(o, tr))) && same(cleared.woods, t.forest.woods) && crowns(t.forest).filter(tr => Math.hypot(tr[3][0] - woodMid.x, tr[3][1] - woodMid.y) > 1.6).every(tr => crowns(cleared).some(o => same(o, tr))), String(treeAt));
    const peak = t.mountains.peaks[Math.floor(t.mountains.peaks.length / 2)][0];
    const road = [[peak[0][0] - 6, peak[0][1] - 0.3], [peak[4][0] + 6, peak[0][1] - 0.3]];
    const pass = draw('mountains', { roads: [road] });
    const footOf = (p) => [(p[0][0][0] + p[0][4][0]) / 2, p[0][0][1]];
    check('a road through the mountains: no peak stands on it, the peaks away from it stand where they stood', pass.peaks.length < t.mountains.peaks.length && pass.peaks.every(p => t.mountains.peaks.some(o => same(o, p))) && pass.peaks.every(p => { const [x, y] = footOf(p); return !(x > road[0][0] && x < road[1][0] && y - 0.15 > road[0][1] && y - 0.75 < road[0][1] && Math.abs(y - 0.4 - road[0][1]) < 0.12); }));
    const roadW = [[woodMid.x - 5, woodMid.y], [woodMid.x + 5, woodMid.y]];
    check('a road through a wood: a way cut through the trees', crowns(draw('forest', { roads: [roadW] })).every(tr => !(tr[3][0] > roadW[0][0] && tr[3][0] < roadW[1][0] && Math.abs(tr[3][1] - woodMid.y) < 0.2)) && crowns(draw('forest', { roads: [roadW] })).length < crowns(t.forest).length);
    // A land moved takes its terrain with it.
    const shifted = landTerrain({ id: 'land-plains', site: { x: 3 + 20, y: -2 - 7 }, outline: lone.map(([x, y]) => [x + 20, y - 7]), terrain: 'plains' });
    check('a land moved takes its terrain with it', shifted.woods.length === t.plains.woods.length && shifted.woods.every((w, i) => w.every(([x, y], j) => near(x - 20, t.plains.woods[i][j][0], 2e-3) && near(y + 7, t.plains.woods[i][j][1], 2e-3))) && shifted.lakes.length === t.plains.lakes.length && shifted.trees.length === t.plains.trees.length);
    check('a larger land has larger terrain, not more of it', (() => { const big = landTerrain({ id: 'land-plains', site: { x: 6, y: -4 }, outline: lone.map(([x, y]) => [x * 2, y * 2]), terrain: 'plains' }); return big.unit > t.plains.unit && big.unit <= 1.5 && big.woods.length <= t.plains.woods.length + 4; })());

    // The model: a region entered.
    const pack = blankPack('The Eld');
    const st = seedWorldState(pack, { name: 'The Eld' });
    let book = withScale(null, 'region');
    for (const [label, kind, x, y] of [['Hask', 'settlement', 0, 0], ['Redfall Castle', 'stronghold', 3.2, 1.2], ['Mirefen Ferry', 'water', -2.4, -1.6]]) book = addPin(book, { label, kind, x, y }).book;
    const g = wrapInRegion(book, atlasModel({ pack, state: st, book }), { label: 'The Haskmarch' });
    book = g.book;
    const ids = {};
    for (const [label, x, y] of [['The Amber Waste', 10, -5], ['The Salt Fens', -3, 10], ['Iron Peaks', -11, -3]]) { const r = addPin(book, { label, kind: 'region', x, y, loose: true }); book = r.book; ids[label] = r.id; }
    const top = atlasModel({ pack, state: st, book });
    const inside = atlasModel({ pack, state: st, book, layer: g.id });
    const land = top.territories.find(x => x.id === g.id);
    check('the top map has no land of its own: it is the map of the lands', top.realm === null && top.territories.length === 4);
    check('inside a region: the land it has on the map above, in the same shape, at the same spots, in the same colour', !!inside.realm && inside.realm.k === 1 && same(inside.realm.outline, land.outline) && inside.realm.fill === land.fill && inside.realm.label === 'The Haskmarch' && inside.realm.x === land.x && inside.realm.y === land.y && inside.ground === 'country');
    check('its places stand on it where they were put', inside.markers.length === 3 && inside.markers.every(m => pointInPolygon(inside.realm.outline, m.x, m.y)) && same(inside.markers.map(m => [m.label, m.x, m.y]), [['Hask', 0, 0], ['Redfall Castle', 3.2, 1.2], ['Mirefen Ferry', -2.4, -1.6]]));
    check('the lands it borders lie around it as on the map above, each in its own colour', same(inside.realm.neighbours.map(n => n.id).sort(), [...land.neighbours].sort()) && inside.realm.neighbours.length === 3 && inside.realm.neighbours.every(n => { const o = top.territories.find(x => x.id === n.id); return same(n.outline, o.outline) && n.fill === o.fill && n.label === o.label && n.loose === true; }));
    check('a neighbour is named at the middle of the border shared with it, the name turned the way the border runs and set on the neighbour\'s side', inside.realm.neighbours.every(n => { const rad = n.angle * Math.PI / 180; const nx = -Math.sin(rad) * n.side, ny = Math.cos(rad) * n.side; return edgeDistance(inside.realm.outline, n.at[0], n.at[1]) < 1e-3 && n.angle > -90 && n.angle <= 90 && (n.side === 1 || n.side === -1) && pointInPolygon(n.outline, n.at[0] + nx * 0.5, n.at[1] + ny * 0.5) && !pointInPolygon(inside.realm.outline, n.at[0] + nx * 0.5, n.at[1] + ny * 0.5) && n.border.length >= 2; }));
    check('its terrain is drawn across it and clear of its places and its roads', inside.decor.woods.length >= 2 && inside.decor.look === 'plains' && Array.isArray(inside.decor.peaks) && within(inside.realm.outline, all(inside.decor.trees), 0.01) && inside.decor.trees.filter((_, i) => i % 2 === 0).every(tr => inside.markers.every(m => Math.hypot(tr[3][0] - m.x, tr[3][1] - m.y) >= 0.5)) && inside.decor.sea === null && inside.decor.lines.length === 0);
    check('the canvas is the land and a margin, not the empty map\'s', inside.realm.outline.every(([x, y]) => x > inside.bounds.minX + 2 && x < inside.bounds.maxX - 2 && y > inside.bounds.minY + 2 && y < inside.bounds.maxY - 2) && inside.bounds.maxX - inside.bounds.minX < 2 * CANVAS + 6);
    const fens = atlasModel({ pack, state: st, book, layer: ids['The Salt Fens'] });
    check('a region with nothing in it yet is its land all the same, with its own terrain: a fen has meres and reeds, mountains peaks', !!fens.realm && fens.markers.length === 0 && fens.realm.loose === true && fens.decor.look === 'swamp' && fens.decor.ponds.length >= 3 && fens.decor.marks.length > 0 && atlasModel({ pack, state: st, book, layer: ids['Iron Peaks'] }).decor.peaks.length >= 8);
    check('Place all puts what waits for a region on its land', (() => { let b = book; for (const label of ['Reed Hall', 'The Sluice', 'Eelmarket', 'Drowned Chapel']) { const r = addPin(b, { label, layer: ids['The Salt Fens'] }); b = unplace(r.book, r.id); b = moveInto(b, r.id, ids['The Salt Fens']); } const m = atlasModel({ pack, state: st, book: b, layer: ids['The Salt Fens'] }); const sp = [...suggestSpots(m).values()]; const placed = atlasModel({ pack, state: st, book: placeAll(b, m), layer: ids['The Salt Fens'] }); return m.tray.filter(x => x.here).length === 4 && sp.length === 4 && sp.every(p => pointInPolygon(m.realm.outline, p.x, p.y)) && placed.markers.length === 4 && placed.realm.k === 1 && same(placed.realm.outline, m.realm.outline); })());
    // Places that were laid out before the land was there: the land is laid under them.
    const far = atlasModel({ pack, state: st, book: placeAt(placeAt(book, 'pin:hask', { x: 60, y: 60 }, g.id), 'pin:redfall-castle', { x: 75, y: 52 }, g.id), layer: g.id });
    check('places that do not stand on the land as it is above: the land is laid under them and drawn as wide as they need, the neighbours and the terrain with it', !!far.realm && far.realm.k > 1 && far.markers.every(m => pointInPolygon(far.realm.outline, m.x, m.y)) && far.realm.neighbours.length === 3 && far.realm.neighbours.every(n => edgeDistance(far.realm.outline, n.at[0], n.at[1]) < 1e-2) && within(far.realm.outline, all(far.decor.trees), 0.05) && far.decor.unit > inside.decor.unit && far.bounds.maxX > 75);
    // What is no land of the map above is drawn as it was.
    const haskIn = atlasModel({ pack, state: st, book: addPin(book, { label: 'The Temple', kind: 'sacred', x: 0, y: 0, layer: 'pin:hask' }).book, layer: 'pin:hask' });
    check('a city has no land on the map above: its map is its own streets', haskIn.realm === null && haskIn.ground === 'city' && haskIn.decor.lines.length > 0 && !('peaks' in haskIn.decor));
    const streets = atlasModel({ pack, state: st, book: withGround(book, 'island', g.id), layer: g.id });
    check('a region the player gave a shore of its own is drawn as they said', streets.realm === null && streets.ground === 'island');
    const nested = (() => { let b = book; b = addPin(b, { label: 'The North Riding', kind: 'region', x: 0, y: -3, layer: g.id }).book; b = addPin(b, { label: 'The South Riding', kind: 'region', x: 0, y: 4, layer: g.id }).book; return atlasModel({ pack, state: st, book: b, layer: g.id }); })();
    check('a region that holds regions of its own shows their lands, not its own', nested.realm === null && nested.territories.length === 2);
    const alone = atlasModel({ pack, state: st, book: g.book, layer: g.id });
    check('a region alone on the map above has its land and no neighbours', !!alone.realm && alone.realm.neighbours.length === 0 && same(alone.realm.outline, atlasModel({ pack, state: st, book: g.book }).territories[0].outline));
}

console.log('\n§6d roads the player draws (D164)');
{
    const pack = blankPack('The Eld');
    let book = null;
    for (const [label, x, y] of [['Hask', 0, 0], ['Redfall Castle', 3, 0], ['The Ford', 0, 3], ['Old Mill', 6, 0]]) book = addPin(book, { label, x, y }).book;
    const id = (l) => `pin:${l.toLowerCase().replace(/[^a-z]+/g, '-')}`;
    const m0 = atlasModel({ pack, book });
    const has = (m, a, b) => m.routes.some(r => (r.a === id(a) && r.b === id(b)) || (r.a === id(b) && r.b === id(a)));
    check('by itself the map joins each place to its nearest: three roads for four places, each marked as the map\'s own', m0.routes.length === 3 && m0.routes.every(r => r.auto === true) && has(m0, 'Hask', 'Redfall Castle') && has(m0, 'Hask', 'The Ford') && has(m0, 'Redfall Castle', 'Old Mill') && !has(m0, 'The Ford', 'Old Mill'));
    const b1 = toggleRoad(book, id('The Ford'), id('Old Mill'), m0);
    const m1 = atlasModel({ pack, book: b1 });
    check('a road drawn between two places that had none: it is there, the player\'s own, the others untouched', same(b1.roads, [[id('Old Mill'), id('The Ford')]]) && m1.routes.length === 4 && has(m1, 'The Ford', 'Old Mill') && m1.routes.find(r => r.a === id('The Ford') || r.b === id('The Ford') && !r.auto).auto !== undefined && m1.routes.filter(r => !r.auto).length === 1);
    const b2 = toggleRoad(b1, id('Old Mill'), id('The Ford'), m1);
    check('toggled again, the player\'s road is forgotten, whichever end is named first', same(b2.roads, []) && atlasModel({ pack, book: b2 }).routes.length === 3);
    const b3 = toggleRoad(book, id('Hask'), id('Redfall Castle'), m0);
    const m3 = atlasModel({ pack, book: b3 });
    check('a road the map drew taken away: it is cut and stays cut', same(b3.cut, [[id('Hask'), id('Redfall Castle')]]) && !has(m3, 'Hask', 'Redfall Castle') && m3.routes.length === 2);
    const b4 = toggleRoad(b3, id('Hask'), id('Redfall Castle'), m3);
    check('and drawn back: the cut is undone and the road is there again', same(b4.cut, []) && has(atlasModel({ pack, book: b4 }), 'Hask', 'Redfall Castle'));
    const far = atlasModel({ pack, book: placeAt(b1, id('Old Mill'), { x: 9, y: 9 }) });
    check('a road follows its places when one is moved', has(far, 'The Ford', 'Old Mill') && same(far.routes.find(r => !r.auto).points.find(p => p[0] === 9), [9, 9]));
    check('a road to itself, or to nothing, is refused; a road is kept once however it is written', same(toggleRoad(book, id('Hask'), id('Hask'), m0), normalizeBook(book)) && normalizeBook({ roads: [['b', 'a'], ['a', 'b'], { a: 'a', b: 'b' }, ['a', 'a'], ['a']] }).roads.length === 1);
    const gone = atlasModel({ pack, book: removeMarker(b1, id('Old Mill')) });
    check('a road to a place that is deleted is not drawn', !gone.routes.some(r => r.a === id('Old Mill') || r.b === id('Old Mill')));
    const inner = atlasModel({ pack, book: moveInto(b1, id('Old Mill'), id('Hask')) });
    check('a road between places on different maps is not drawn', !inner.routes.some(r => !r.auto));
}

console.log('\n§6e the time is the roads\' (D165)');
{
    // A region's map: one layout unit is 15 miles, a day on foot is 24.
    const pack = blankPack('W');
    let book = withScale(null, 'region');
    for (const [label, x, y] of [['Hask', 0, 0], ['The Ford', 4, 0], ['Redfall Castle', 4, 3], ['Lone Tower', -6, 0]]) book = addPin(book, { label, x, y }).book;
    const id = (l) => `pin:${l.toLowerCase().replace(/[^a-z]+/g, '-')}`;
    const m0 = atlasModel({ pack, book });
    check('the fixture: a region\'s scale, and the map\'s own roads Hask–Ford, Ford–Redfall, Hask–Tower', m0.measure.scale === 'region' && m0.measure.per === 15 && m0.routes.length === 3 && m0.routes.every(r => r.auto && r.hours === 0 && r.units > 0));
    const r1 = routeBetween(m0, id('Hask'), id('Redfall Castle'));
    check('by road: the way along the roads, through the place between, at the map\'s pace', r1.mode === 'road' && near(r1.length, (4 + 3) * 15) && near(r1.hours, 105 / 3) && same(r1.via, [id('The Ford')]) && r1.set === false);
    check('the card says so, and what is told to the story', describeDistance(m0, id('Hask'), id('Redfall Castle')) === '105 miles by road, about 4.5 days on foot' && describeJourney(m0, id('Hask'), id('Redfall Castle')) === 'about 4.5 days on foot by road (105 miles)');
    check('the straight line is still the straight line (D141 keeps it for what it is)', near(distanceBetween(m0, id('Hask'), id('Redfall Castle')), 75));
    // No road: cross-country.
    const cut = toggleRoad(toggleRoad(book, id('Hask'), id('The Ford'), m0), id('The Ford'), id('Redfall Castle'), m0);
    const m1 = atlasModel({ pack, book: cut });
    const r2 = routeBetween(m1, id('Hask'), id('Redfall Castle'));
    check('with no road between them: across country, the straight line, half as long again', r2.mode === 'cross' && near(r2.length, 75) && near(r2.hours, 75 / 3 * CROSS_COUNTRY) && r2.via.length === 0 && CROSS_COUNTRY === 1.5);
    check('and the card says cross-country', describeDistance(m1, id('Hask'), id('Redfall Castle')) === '75 miles cross-country, about 4.5 days on foot' && describeJourney(m1, id('Hask'), id('Redfall Castle')) === 'about 4.5 days on foot across country (75 miles)');
    // A road drawn straight there is quicker than the way round.
    const direct = atlasModel({ pack, book: toggleRoad(book, id('Hask'), id('Redfall Castle'), m0) });
    const r3 = routeBetween(direct, id('Hask'), id('Redfall Castle'));
    check('a road drawn straight there is the way taken: quicker than the way round', r3.mode === 'road' && near(r3.length, 75) && r3.via.length === 0 && describeDistance(direct, id('Hask'), id('Redfall Castle')) === '75 miles by road, about 3 days on foot');
    // The owner's case: the story says two days.
    const setBook = setRoadTime(toggleRoad(book, id('Hask'), id('Redfall Castle'), m0), id('Redfall Castle'), id('Hask'), 16);
    const m2 = atlasModel({ pack, book: setBook });
    const road = m2.routes.find(r => (r.a === id('Hask') && r.b === id('Redfall Castle')) || (r.b === id('Hask') && r.a === id('Redfall Castle')));
    check('a road given a time of its own carries it, whichever end is named first', !!road && road.hours === 16 && road.auto === false && same(setBook.roadHours, { [`${id('Hask')}|${id('Redfall Castle')}`]: 16 }));
    check('the card and the story go by the set time, and the miles drawn are left out', describeDistance(m2, id('Hask'), id('Redfall Castle')) === 'about 2 days by road' && describeJourney(m2, id('Hask'), id('Redfall Castle')) === 'about 2 days by road' && routeBetween(m2, id('Hask'), id('Redfall Castle')).set === true);
    const dragged = atlasModel({ pack, book: placeAt(setBook, id('Redfall Castle'), { x: 30, y: 30 }) });
    check('the pin dragged far away, the set time stands', describeDistance(dragged, id('Hask'), id('Redfall Castle')) === 'about 2 days by road');
    const slow = atlasModel({ pack, book: setRoadTime(toggleRoad(book, id('Hask'), id('Redfall Castle'), m0), id('Hask'), id('Redfall Castle'), 80) });
    check('a set time is the story\'s word for that journey: it stands even where a way round by other roads would be quicker', routeBetween(slow, id('Hask'), id('Redfall Castle')).mode === 'road' && near(routeBetween(slow, id('Hask'), id('Redfall Castle')).hours, 80) && same(routeBetween(slow, id('Hask'), id('Redfall Castle')).via, []) && near(routeBetween(slow, id('Hask'), id('The Ford')).hours, 20));
    const onlySlow = atlasModel({ pack, book: setRoadTime(cut, id('Hask'), id('Redfall Castle'), 80) });
    check('nor is a slow set road undercut across country', near(routeBetween(onlySlow, id('Hask'), id('Redfall Castle')).hours, 80) && describeDistance(onlySlow, id('Hask'), id('Redfall Castle')) === 'about 10 days by road');
    // A time set on a road the map drew makes it the player's: it stays when the map would redraw its roads.
    const kept = setRoadTime(book, id('Hask'), id('The Ford'), 4);
    const mk = atlasModel({ pack, book: addPin(kept, { label: 'Halfway House', x: 2, y: 0 }).book });
    check('a time set on a road the map drew keeps that road when a new place would have rerouted it', mk.routes.some(r => !r.auto && r.hours === 4 && ((r.a === id('Hask') && r.b === id('The Ford')) || (r.b === id('Hask') && r.a === id('The Ford')))));
    check('cleared, the road goes by its length again and stays the player\'s', same(setRoadTime(kept, id('The Ford'), id('Hask'), 0).roadHours, {}) && setRoadTime(kept, id('Hask'), id('The Ford'), 0).roads.length === 1 && same(setRoadTime(kept, id('Hask'), id('Hask'), 5), normalizeBook(kept)));
    const removed = toggleRoad(setBook, id('Hask'), id('Redfall Castle'), m2);
    check('a road taken away takes its set time with it, and the map does not draw one there by itself', same(removed.roadHours, {}) && removed.roads.length === 0 && removed.cut.length === 1 && !atlasModel({ pack, book: removed }).routes.some(r => (r.a === id('Hask') && r.b === id('Redfall Castle')) || (r.b === id('Hask') && r.a === id('Redfall Castle'))));
    // Partly by road.
    const mixedBook = toggleRoad(book, id('The Ford'), id('Redfall Castle'), m0);
    const mm = atlasModel({ pack, book: mixedBook });
    const r4 = routeBetween(mm, id('Lone Tower'), id('Redfall Castle'));
    check('partly by road: along the roads as far as they go, then across country, when that is quicker than straight across', r4.mode === 'mixed' && same(r4.via, [id('Hask')]) && near(r4.hours, 30 + 37.5) && r4.hours < distanceBetween(mm, id('Lone Tower'), id('Redfall Castle')) / 3 * CROSS_COUNTRY && /partly by road/.test(describeDistance(mm, id('Lone Tower'), id('Redfall Castle'))) && /partly by road/.test(describeJourney(mm, id('Lone Tower'), id('Redfall Castle'))));
    check('nothing to say for the same place, a place off this map, or no model', routeBetween(m0, id('Hask'), id('Hask')).mode === 'here' && describeDistance(m0, id('Hask'), id('Hask')) === '' && describeJourney(m0, id('Hask'), id('Hask')) === '' && routeBetween(m0, id('Hask'), 'nowhere') === null && describeJourney(m0, '', id('Hask')) === '' && routeBetween(null, 'a', 'b') === null);
    check('a damaged set time is dropped; a good one is kept by its pair', same(normalizeBook({ roadHours: { 'a|b': 4.00049, 'b|a': 2, 'a|a': 1, 'a': 3, 'c|d': -1, 'e|f': 'x' } }).roadHours, { 'a|b': 4 }));
    // Between lands there are no roads to miss.
    let lands = addPin(null, { label: 'North', kind: 'region', x: 0, y: 0 }).book;
    lands = addPin(lands, { label: 'South', kind: 'region', x: 0, y: 8 }).book;
    const lm = atlasModel({ pack: blankPack('x'), book: lands });
    check('between two regions: the straight line at the pace, with no cross-country penalty', routeBetween(lm, 'pin:north', 'pin:south').mode === 'open' && near(routeBetween(lm, 'pin:north', 'pin:south').hours, 8 * 15 / 3) && describeDistance(lm, 'pin:north', 'pin:south') === '120 miles, about 5 days on foot');
    // What the story is told.
    const told = buildTravelInstruction({ place: 'Redfall Castle', userName: 'Jordan', journey: describeJourney(m2, id('Hask'), id('Redfall Castle')) });
    check('Travel here tells the story how long the map says it takes', told.includes('The map puts the journey at about 2 days by road: it takes that long, no less and no more, and the date and time move on by it.') && !/yours to judge/.test(told));
    const both = buildTravelInstruction({ place: 'Redfall Castle', userName: 'Jordan', when: 'by nightfall.', journey: 'about 2 days by road' });
    check('an arrival the player named stands, with the map\'s word beside it; with no journey the judgement is the story\'s as before', / Jordan arrives by nightfall\. The map puts the journey at about 2 days by road\./.test(both) && /yours to judge/.test(buildTravelInstruction({ place: 'Redfall Castle', userName: 'Jordan' })) && !buildTravelInstruction({ place: 'X', journey: 'about [2] days' }).includes('[2]'));
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
    check('the card\'s line', describeDistance(m, 'northmarch', 'greywood') === '75 miles by road, about 3 days on foot' && describeDistance(m, 'northmarch', 'northmarch') === '' && describeDistance(m, '', 'northmarch') === '' && describeDistance(m, 'northmarch', 'nowhere') === '', describeDistance(m, 'northmarch', 'greywood'));
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
