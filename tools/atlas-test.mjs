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
    layoutAtlas, atlasModel, distanceBetween, travelHours, describeLength, describeTime, describeDistance,
    filterMarkers, kindCounts, withSpot, labelSegments, roomKey, foldPlaces,
    normalizeBook, placeAt, unplace, addPin, removeMarker, restoreMarker, mergeInto, mergeTarget, unmerge, editMarker, withScale, suggestSpots, placeAll, tidyList, buildTidyPrompt, parseTidy, applyTidyItem,
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
    check('nothing: an empty book', same(normalizeBook(null), { scale: '', spots: {}, gone: [], merged: {}, made: [], edits: {} }));
    const dirty = normalizeBook({ scale: 'galaxy', spots: { a: { x: 1.23456, y: 2 }, b: { x: 'no', y: 1 } }, gone: ['x', 'x', 7], merged: { a: 'a', b: 'c' }, made: [{ id: 'pin:a', label: ' The Well ', kind: 'WATER' }, { id: 'nope', label: 'x' }, { id: 'pin:a', label: 'twice' }], edits: { q: { label: ' New ', kind: 'spaceship', note: 'n' }, z: {} } });
    check('a book made safe', same(dirty, { scale: '', spots: { a: { x: 1.2346, y: 2 } }, gone: ['x'], merged: { b: 'c' }, made: [{ id: 'pin:a', label: 'The Well', kind: 'water', note: '' }], edits: { q: { label: 'New', note: 'n' } } }));
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
    check('the scale chosen by hand', withScale(b, 'world').scale === 'world' && withScale(b, 'galaxy').scale === '');
    check('the book is never changed in place', same(b.spots, { 'loc:the-quay': { x: 2, y: -3 } }) && b.made.length === 0);
}

console.log('\n§6 the model: nothing lands by itself (D145)');
{
    const p = realm();
    const state = seedWorldState(p, { name: '' });
    state.visited = [
        { id: 'iron-inn', label: 'The Iron Inn', packId: 'iron-inn', path: 'northmarch/iron-inn', visits: [4] },
        { id: 'loc:the-burnt-mill', label: 'The Burnt Mill', packId: '', path: '', visits: [2] },
        { id: 'loc:bedroom', label: 'Bedroom', packId: '', path: '', visits: [] },
        { id: 'loc:bedroom-on-the-wall', label: 'bedroom on the wall', packId: '', path: '', visits: [] },
    ];
    state.where = { ...state.where, Kessa: 'loc:bedroom-on-the-wall', Hero: 'greywood/old-shrine' };
    const m0 = atlasModel({ pack: p, state, player: 'Hero' });
    const ids = (list) => list.map(x => x.id).sort();
    check('with an empty book the map is empty and everything waits in the tray', m0.markers.length === 0 && m0.land.length === 0 && m0.routes.length === 0 && m0.regions.length === 0 && !m0.empty);
    check('the tray: the world\'s places, the story\'s own folded, no regions', same(ids(m0.tray), ['frosthold', 'hunters-camp', 'iron-inn', 'loc:bedroom', 'loc:the-burnt-mill', 'old-shrine', 'saltport']), JSON.stringify(ids(m0.tray)));
}
{
    const p = realm();
    const state = seedWorldState(p, { name: '' });
    state.visited = [
        { id: 'iron-inn', label: 'The Iron Inn', packId: 'iron-inn', path: 'northmarch/iron-inn', visits: [4] },
        { id: 'loc:the-burnt-mill', label: 'The Burnt Mill', packId: '', path: '', visits: [2] },
        { id: 'loc:bedroom', label: 'Bedroom', packId: '', path: '', visits: [] },
        { id: 'loc:bedroom-on-the-wall', label: 'bedroom on the wall', packId: '', path: '', visits: [] },
    ];
    state.where = { ...state.where, Kessa: 'loc:bedroom-on-the-wall', Hero: 'greywood/old-shrine' };
    const m0 = atlasModel({ pack: p, state, player: 'Hero' });
    const tray = (id) => m0.tray.find(x => x.id === id);
    check('a place inside a place is a room of it, not a marker', !tray('fish-market') && same(tray('saltport').rooms, ['Fish Market']));
    check('the two bedrooms are one place, and Kessa stands in it', !!tray('loc:bedroom') && !tray('loc:bedroom-on-the-wall') && same(tray('loc:bedroom').people, ['Kessa']) && same(tray('loc:bedroom').rooms, ['bedroom on the wall']));
    check('the people of a folded room stand at its place', same(tray('saltport').people, ['Odo']) && same(tray('iron-inn').people, ['Mara']));
    check('the party waits in the tray with its place, first', m0.party === '' && m0.partyInTray === 'old-shrine' && m0.tray[0].id === 'old-shrine' && tray('old-shrine').player);
    check('kinds: the world\'s own, else a guess; the regions of the world are named on the tray\'s places', tray('old-shrine').kind === 'ruin' && tray('iron-inn').kind === 'tavern' && tray('frosthold').regionLabel === 'The Northmarch' && tray('loc:the-burnt-mill').regionLabel === '');
    check('an empty map still has room to place things', m0.bounds.minX <= -CANVAS && m0.bounds.maxX >= CANVAS && m0.bounds.minY <= -CANVAS && m0.bounds.maxY >= CANVAS);

    let book = placeAt(null, 'iron-inn', { x: 1, y: 1 });
    book = placeAt(book, 'frosthold', { x: 3, y: 0 });
    book = placeAt(book, 'loc:bedroom', { x: -4, y: 2 });
    const m1 = atlasModel({ pack: p, state, player: 'Hero', book });
    const mk = (id) => m1.markers.find(x => x.id === id);
    check('a placed place is a marker where it was put, and leaves the tray', m1.markers.length === 3 && mk('iron-inn').x === 1 && mk('iron-inn').y === 1 && mk('iron-inn').by === 'user' && m1.tray.length === 4 && !m1.tray.some(x => x.id === 'iron-inn'));
    check('a region of the world is named around its placed places', m1.regions.length === 1 && m1.regions[0].id === 'northmarch' && m1.regions[0].terrain === 'snow' && Math.abs(m1.regions[0].x - 2) < 1e-6 && m1.regions[0].outline.length === 40 && m1.regions[0].glyphs.length > 0);
    check('the land is drawn around the markers: a region\'s, and a lone marker\'s own', m1.land.length === 2 && m1.land.every(l => l.outline.length === 28 && l.ripple1.length === 28 && l.ripple2.length === 28) && m1.land.some(l => l.id === 'loc:bedroom' && l.radius === LAND_RADIUS));
    check('paths: a tree over the markers', m1.routes.length === 2 && m1.routes.every(r => r.points.length === 2));
    check('the bounds hold the land', m1.land.every(l => l.ripple2.every(([x, y]) => x > m1.bounds.minX && x < m1.bounds.maxX && y > m1.bounds.minY && y < m1.bounds.maxY)));
    check('visited places are marked', mk('iron-inn').visited && !mk('frosthold').visited);

    const moved = atlasModel({ pack: p, state, book: placeAt(book, 'saltport', { x: 9, y: 9 }) });
    check('placing another moves nothing already there (D140)', ['iron-inn', 'frosthold', 'loc:bedroom'].every(id => same([mk(id).x, mk(id).y], [moved.markers.find(x => x.id === id).x, moved.markers.find(x => x.id === id).y])));

    const gone = atlasModel({ pack: p, state, player: 'Hero', book: removeMarker(book, 'loc:bedroom') });
    check('a deleted marker is off the map and the tray, its people with it, and listed for a restore', !gone.markers.some(x => x.id === 'loc:bedroom') && !gone.tray.some(x => x.id === 'loc:bedroom') && same(gone.deleted, [{ id: 'loc:bedroom', label: 'Bedroom' }]) && !gone.markers.some(x => x.people.includes('Kessa')));
    const state2 = { ...state, visited: [...state.visited, { id: 'loc:bedroom-floor', label: 'Bedroom floor', packId: '', path: '', visits: [9] }] };
    const again = atlasModel({ pack: p, state: state2, book: removeMarker(book, 'loc:bedroom') });
    check('the story naming it again does not bring it back', !again.markers.some(x => x.id === 'loc:bedroom') && !again.tray.some(x => x.id === 'loc:bedroom') && !again.tray.some(x => /bedroom/i.test(x.label)));

    const merged = atlasModel({ pack: p, state, player: 'Hero', book: mergeInto(book, 'loc:the-burnt-mill', 'iron-inn') });
    const inn = merged.markers.find(x => x.id === 'iron-inn');
    check('a merged marker leaves the tray; its name is the target\'s other name', !merged.tray.some(x => x.id === 'loc:the-burnt-mill') && same(inn.names, [{ id: 'loc:the-burnt-mill', label: 'The Burnt Mill' }]));
    const merged2 = atlasModel({ pack: p, state, player: 'Hero', book: mergeInto(book, 'loc:bedroom', 'iron-inn') });
    check('the people and the rooms of a merged marker count at the target', same(merged2.markers.find(x => x.id === 'iron-inn').people.sort(), ['Kessa', 'Mara']) && merged2.markers.find(x => x.id === 'iron-inn').rooms.includes('bedroom on the wall') && merged2.markers.length === 2);
    const partyMerged = atlasModel({ pack: p, state, player: 'Hero', book: mergeInto(book, 'old-shrine', 'frosthold') });
    check('the party at a merged place stands at the target', partyMerged.party === 'frosthold' && partyMerged.markers.find(x => x.id === 'frosthold').player);

    const pin = addPin(book, { label: 'The Old Well', kind: 'water', x: -2, y: -2 });
    const withPin = atlasModel({ pack: p, state, book: pin.book });
    check('a marker made by hand is on the map with its kind', withPin.markers.find(x => x.id === pin.id).kind === 'water' && withPin.markers.find(x => x.id === pin.id).source === 'pin');
    const renamed = atlasModel({ pack: p, state, book: editMarker(book, 'loc:bedroom', { label: "Hero's Room", kind: 'home', note: 'Small.' }) });
    check('a renamed marker shows its new name, kind and note', same([renamed.markers.find(x => x.id === 'loc:bedroom').label, renamed.markers.find(x => x.id === 'loc:bedroom').kind, renamed.markers.find(x => x.id === 'loc:bedroom').note], ["Hero's Room", 'home', 'Small.']));

    const w = atlasModel({ pack: p, state, book, weather: { northmarch: { emoji: '❄️', text: 'Snow' } } });
    check('the weather: a region\'s on its places', w.markers.find(x => x.id === 'frosthold').weather.text === 'Snow' && w.markers.find(x => x.id === 'loc:bedroom').weather === null);

    const sug = suggestSpots(m1, p);
    const all = [...sug.values(), ...m1.markers];
    check('Place all proposes a spot for everything in the tray, none on another', sug.size === m1.tray.length && all.every((a, i) => all.every((b, j) => i >= j || Math.hypot(a.x - b.x, a.y - b.y) >= 1.29)));
    check('the same tray, the same proposals', same([...sug], [...suggestSpots(m1, p)]));
    const full = atlasModel({ pack: p, state, player: 'Hero', book: placeAll(book, m1, p) });
    check('Place all empties the tray and keeps what was placed where it was', full.tray.length === 0 && full.markers.length === 7 && full.markers.find(x => x.id === 'iron-inn').x === 1 && full.party === 'old-shrine' && full.regions.length === 3);

    const world = normalizePack(withSpot(worldToRaw(p), 'saltport', { x: 6, y: 6 })).pack;
    const own = atlasModel({ pack: world, state });
    check('a spot the world carries of its own counts as placed; the book\'s wins over it', own.markers.length === 1 && own.markers[0].by === 'world' && atlasModel({ pack: world, state, book: placeAt(null, 'saltport', { x: 0, y: 0 }) }).markers[0].x === 0);

    const blank = blankPack('Ashfall');
    const bs = seedWorldState(blank, { name: 'Ashfall' });
    bs.visited = [{ id: 'loc:the-quay', label: 'The Quay', packId: '', path: '', visits: [1] }];
    const bm = atlasModel({ pack: blank, state: bs });
    check('the blank world: the story\'s place in the tray, the party with it', bm.tray.length === 1 && bm.tray[0].id === 'loc:the-quay' && bm.partyInTray === 'loc:the-quay' && bm.measure.scale === 'town');
    check('nothing at all is said', atlasModel({ pack: blankPack('Nothing'), state: null }).empty === true);
    check('the example world reads', atlasModel({ pack: harbour, state: seedWorldState(harbour, { name: '' }) }).tray.length > 0);
    check('the layout proposes the same spots every time, and a place added later moves none', same([...layoutAtlas(p)], [...layoutAtlas(realm())]) && p.places.every(x => same(layoutAtlas(p).get(x.id), layoutAtlas(realm([{ id: 'new-ford', label: 'New Ford', parent: 'northmarch' }, { id: 'far-isle', label: 'Far Isle' }])).get(x.id))));
}

console.log('\n§7 distance');
{
    const p = realm();
    const book = placeAt(placeAt(placeAt(null, 'frosthold', { x: 0, y: 0 }), 'iron-inn', { x: 3, y: 4 }), 'saltport', { x: -6, y: 8 });
    const m = atlasModel({ pack: p, book });
    check('the straight line times the scale', near(distanceBetween(m, 'frosthold', 'iron-inn'), 5 * 15) && near(distanceBetween(m, 'frosthold', 'saltport'), 10 * 15));
    check('the same both ways, nothing to itself, null off the map', near(distanceBetween(m, 'iron-inn', 'frosthold'), 75) && distanceBetween(m, 'frosthold', 'frosthold') === 0 && distanceBetween(m, 'frosthold', 'old-shrine') === null);
    const more = atlasModel({ pack: realm([{ id: 'new-ford', label: 'New Ford', parent: 'northmarch' }]), book: placeAt(book, 'new-ford', { x: 1, y: 1 }) });
    check('a place added later changes no distance (D141)', near(distanceBetween(more, 'frosthold', 'iron-inn'), 75, 1e-9));
    check('the scale: several regions a region, one or none a town; the world\'s own wins; the book\'s wins over that', scaleOf(p) === 'region' && scaleOf(harbour) === 'town' && scaleOf(blankPack('x')) === 'town' && scaleOf(normalizePack({ ...worldToRaw(p), atlas: { scale: 'world' } }).pack) === 'world' && scaleOf(normalizePack({ ...worldToRaw(p), atlas: { scale: 'world' } }).pack, withScale(null, 'town')) === 'town');
    const km = measureOf(normalizePack({ ...worldToRaw(p), atlas: { unit: 'km' } }).pack);
    check('the measure: the unit, a layout unit in it, the pace', same(measureOf(p), { unit: 'mi', per: 15, pace: 24, scale: 'region' }) && km.unit === 'km' && near(km.per, 24.1402) && near(km.pace, 38.6243));
    check('hours at the pace: a day is eight hours of the road', near(travelHours(24, measureOf(p)), 8) && near(travelHours(3, measureOf(p)), 1));
    check('a length in words', describeLength(3.24) === '3.2 miles' && describeLength(1) === '1 mile' && describeLength(12.3) === '12.5 miles' && describeLength(240.4) === '240 miles' && describeLength(5, 'km') === '5 km' && describeLength(2, 'league') === '2 leagues');
    check('a time in words', describeTime(0) === 'no time at all' && describeTime(0.05) === 'a few minutes' && describeTime(0.33) === 'about 20 minutes' && describeTime(1) === 'about an hour' && describeTime(3.2) === 'about 3 hours' && describeTime(8) === 'about a day' && describeTime(20) === 'about 2.5 days');
    check('the card\'s line', describeDistance(m, 'frosthold', 'iron-inn') === '75 miles, about 3 days on foot' && describeDistance(m, 'frosthold', 'frosthold') === '' && describeDistance(m, '', 'frosthold') === '' && describeDistance(m, 'frosthold', 'nowhere') === '', describeDistance(m, 'frosthold', 'iron-inn'));
    const town = atlasModel({ pack: p, book: withScale(book, 'town') });
    check('at a town\'s scale the same places are minutes apart', /minutes/.test(describeDistance(town, 'frosthold', 'iron-inn')), describeDistance(town, 'frosthold', 'iron-inn'));
}

console.log('\n§8 the search and the switches');
{
    const p = realm();
    const m = atlasModel({ pack: p, state: seedWorldState(p, { name: '' }), book: placeAll(null, atlasModel({ pack: p }), p) });
    const ids = (list) => list.map(x => x.id).sort();
    check('no search, nothing off: every marker', filterMarkers(m.markers).length === m.markers.length && m.markers.length === 5);
    check('a search over names, rooms, notes and people', same(ids(filterMarkers(m.markers, { query: 'salt' })), ['saltport']) && same(ids(filterMarkers(m.markers, { query: 'fish market' })), ['saltport']) && same(ids(filterMarkers(m.markers, { query: 'soldiers' })), ['iron-inn']) && same(ids(filterMarkers(m.markers, { query: 'odo' })), ['saltport']) && same(ids(filterMarkers(m.markers, { query: 'northmarch' })), ['frosthold', 'iron-inn']));
    check('a kind switched off hides its markers', filterMarkers(m.markers, { hidden: ['tavern'] }).every(x => x.kind !== 'tavern') && filterMarkers(m.markers, { hidden: ['tavern'] }).length === 4);
    const counts = kindCounts(m.markers);
    check('the counts: the kinds on the map, in the list\'s order, none empty', counts.every(k => k.count > 0) && counts.reduce((n, k) => n + k.count, 0) === m.markers.length && same(counts.map(k => k.id), ATLAS_KINDS.map(k => k.id).filter(id => counts.some(k => k.id === id))));
}

console.log('\n§9 the clean-up pass (D155)');
{
    const p = realm();
    const state = seedWorldState(p, { name: '' });
    state.visited = [{ id: 'loc:the-burnt-mill', label: 'The Burnt Mill', packId: '', path: '', visits: [2] }, { id: 'loc:burned-mill-ruins', label: 'Burned mill ruins', packId: '', path: '', visits: [3] }, { id: 'loc:somewhere-dark', label: 'Somewhere dark', packId: '', path: '', visits: [4] }];
    const m = atlasModel({ pack: p, state, book: placeAt(null, 'iron-inn', { x: 0, y: 0 }) });
    const list = tidyList(m);
    const n = (id) => list.find(x => x.id === id).n;
    check('the places are numbered from 1, the markers first', list[0].n === 1 && list[0].id === 'iron-inn' && list[0].placed && list.length === m.markers.length + m.tray.length && !list[1].placed);
    const prompt = buildTidyPrompt({ model: m, world: 'The Realm' });
    check('the request lists every place by number with its rooms, and asks for JSON', prompt.count === list.length && prompt.user.includes(`${n('saltport')}. Saltport (inside it: Fish Market)`) && prompt.user.includes('The Realm') && /"merge"/.test(prompt.system) && /"delete"/.test(prompt.system));
    const reply = '```json\n' + JSON.stringify({ merge: [{ from: n('loc:burned-mill-ruins'), into: n('loc:the-burnt-mill'), why: 'same mill' }, { from: 999, into: 1 }, { from: n('frosthold'), into: n('frosthold') }, { from: String(n('loc:burned-mill-ruins')), into: 1 }], delete: [{ id: n('loc:somewhere-dark'), why: 'not a place' }, { id: n('loc:burned-mill-ruins') }, { id: 0 }] }) + '\n```\nDone!';
    const r = parseTidy(reply, m);
    check('the reply read: the merges and deletions that name places of the list, each place once', r.ok && same(r.items, [{ kind: 'merge', id: 'loc:burned-mill-ruins', label: 'Burned mill ruins', to: 'loc:the-burnt-mill', toLabel: 'The Burnt Mill', why: 'same mill' }, { kind: 'delete', id: 'loc:somewhere-dark', label: 'Somewhere dark', why: 'not a place' }]), JSON.stringify(r.items));
    check('a merge into something the pass also removes is dropped', parseTidy(JSON.stringify({ merge: [{ from: 2, into: 3 }], delete: [{ id: 3 }] }), m).items.length === 1 && parseTidy(JSON.stringify({ merge: [{ from: 2, into: 3 }], delete: [{ id: 3 }] }), m).items[0].kind === 'delete');
    check('nothing to tidy, and a reply that is no JSON', same(parseTidy('{"merge":[],"delete":[]}', m), { ok: true, items: [], error: '' }) && parseTidy('I could not find any.', m).ok === false && parseTidy('', m).ok === false);
    let book = placeAt(null, 'iron-inn', { x: 0, y: 0 });
    for (const item of r.items) book = applyTidyItem(book, item);
    const after = atlasModel({ pack: p, state, book });
    check('approved: the duplicate is merged, the non-place deleted, the rest untouched', same(book.merged, { 'loc:burned-mill-ruins': 'loc:the-burnt-mill' }) && same(book.gone, ['loc:somewhere-dark']) && after.tray.length === m.tray.length - 2 && same(after.tray.find(x => x.id === 'loc:the-burnt-mill').names, [{ id: 'loc:burned-mill-ruins', label: 'Burned mill ruins' }]) && same(after.deleted, [{ id: 'loc:somewhere-dark', label: 'Somewhere dark' }]));
}

console.log(failures ? `\n${failures} failure(s)` : '\nall pass');
process.exit(failures ? 1 : 0);
