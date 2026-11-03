#!/usr/bin/env node
/**
 * The world's picture and its nodes (docs/hub-plan.md D124, D135, D136):
 * the picture record made safe, a node as a fraction of the picture, the
 * projection to Leaflet's units and back, the builder's edits on the raw
 * world, the board's model (the people at the placed places, the player,
 * the visited ones, the weather by region, what is not on the map).
 *
 * Usage:  node tools/hub-board-test.mjs     (from the repo root)
 * Exit:   0 = pass, 1 = failure
 */
import { readFileSync } from 'node:fs';
import { normalizePack } from '../src/utils/liveWorld.js';
import { worldToRaw } from '../src/utils/worldBuilder.js';
import {
    normalizeMap, fraction, hasMap, mapSize, nodeOf, placedPlaces, unplacedPlaces, boardBounds, nodeLatLng, latLngToNode,
    withNode, withMap, boardModel, treeModel, MAX_ZOOM_IN,
    pictureKey, placeOfPath, keyOfPath, partyAt, playerPlace, peopleAt, labelOfKey, placeImage,
} from '../src/utils/worldPicture.js';

let failures = 0;
function check(name, cond, detail = '') {
    if (cond) console.log(`pass  ${name}`);
    else { failures++; console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ''}`); }
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const file = JSON.parse(readFileSync(new URL('../worldpacks/example.json', import.meta.url), 'utf8'));
const withNodes = (raw) => ({
    ...raw,
    map: { image: '/user/images/des-worlds/harbourside-map.png', width: 1000, height: 500, source: 'upload' },
    places: raw.places.map(p => (p.id === 'the-anchor' ? { ...p, x: 0.2, y: 0.7 } : p.id === 'customs-house' ? { ...p, x: 0.6, y: 0.3 } : p.id === 'harbourside' ? { ...p, x: 0.5, y: 0.5 } : p)),
});

console.log('\n§1 the picture record and a node');
{
    check('no picture: empty strings and zeros', same(normalizeMap(null), { image: '', width: 0, height: 0, source: '' }) && same(normalizeMap({ width: 100, height: 100, source: 'upload' }), { image: '', width: 0, height: 0, source: '' }));
    check('a picture: the path trimmed, whole sizes kept, a strange source dropped', same(normalizeMap({ image: ' /user/images/des-worlds/h.png ', width: 1200, height: 800.5, source: 'upload' }), { image: '/user/images/des-worlds/h.png', width: 1200, height: 0, source: 'upload' }) && normalizeMap({ image: 'a.png', source: 'weird' }).source === '');
    check('a fraction: within 0..1, four decimals; anything else null', fraction(0.5) === 0.5 && fraction(0.123456) === 0.1235 && fraction(1) === 1 && fraction(0) === 0 && fraction(1.00004) === null && fraction(-0.1) === null && fraction('0.5') === null && fraction(NaN) === null && fraction(undefined) === null);
    check('the node on a place: both fractions, else none', same(nodeOf({ x: 0.2, y: 0.7 }), { x: 0.2, y: 0.7 }) && nodeOf({ x: 0.2 }) === null && nodeOf({ x: 2, y: 0.5 }) === null && nodeOf(null) === null);
}

console.log('\n§2 the pack reads the nodes and the picture; the file\'s shape carries them');
{
    const raw = withNodes(file);
    raw.places = raw.places.map(p => (p.id === 'back-room' ? { ...p, x: 0.4 } : p.id === 'the-hill' ? { ...p, x: 1.5, y: 0.5 } : p));
    const n = normalizePack(raw);
    const at = (id) => n.pack.places.find(p => p.id === id);
    check('the pack is sound with nodes on it', n.ok && n.errors.length === 0, n.errors.join(' | '));
    check('a place with both fractions keeps its node; half a node, or one out of range, is no node', same(nodeOf(at('the-anchor')), { x: 0.2, y: 0.7 }) && nodeOf(at('back-room')) === null && at('back-room').x === null && nodeOf(at('the-hill')) === null && at('the-hill').y === null);
    check('the picture record rides the pack', same(n.pack.map, { image: '/user/images/des-worlds/harbourside-map.png', width: 1000, height: 500, source: 'upload' }) && hasMap(n.pack) && same(mapSize(n.pack), { width: 1000, height: 500 }));
    check('three on the map, five not', placedPlaces(n.pack).map(p => p.id).join(',') === 'harbourside,customs-house,the-anchor' && unplacedPlaces(n.pack).length === 5);
    const back = worldToRaw(n.pack);
    check('the file\'s shape carries the nodes and the picture, and nothing for a place without a node', same(back.places.find(p => p.id === 'the-anchor').x, 0.2) && !('x' in back.places.find(p => p.id === 'back-room')) && same(back.map, n.pack.map));
    const again = normalizePack(back);
    check('the round trip holds', again.ok && same(worldToRaw(again.pack), back));
    const plain = normalizePack(file);
    check('a world without a picture: no map in its file, no size, nothing placed', !hasMap(plain.pack) && mapSize(plain.pack) === null && !('map' in worldToRaw(plain.pack)) && placedPlaces(plain.pack).length === 0 && unplacedPlaces(plain.pack).length === 8);
}

console.log('\n§3 the projection to Leaflet and back');
{
    const size = { width: 1000, height: 500 };
    check('the bounds: [[0, 0], [height, width]]', same(boardBounds(size), [[0, 0], [500, 1000]]));
    check('a node to [lat, lng]: latitude from the bottom, longitude from the left', same(nodeLatLng({ x: 0.2, y: 0.7 }, size), [150, 200]) && same(nodeLatLng({ x: 0, y: 0 }, size), [500, 0]) && same(nodeLatLng({ x: 1, y: 1 }, size), [0, 1000]));
    check('and back, four decimals', same(latLngToNode([150, 200], size), { x: 0.2, y: 0.7 }) && same(latLngToNode([499.99, 0.01], size), { x: 0, y: 0 }));
    check('a point off the picture is clamped to its edge', same(latLngToNode([-10, 1200], size), { x: 1, y: 1 }) && same(latLngToNode([600, -5], size), { x: 0, y: 0 }));
    check('no size, no point: null', latLngToNode([1, 1], { width: 0, height: 0 }) === null && latLngToNode(null, size) === null && latLngToNode(['a', 1], size) === null);
    check('the board zooms in to four times the picture', MAX_ZOOM_IN === 4);
}

console.log('\n§4 the builder\'s edits on the raw world');
{
    const raw = { id: 'w', name: 'W', places: [{ id: 'a', label: 'A', parent: null }, { id: 'b', label: 'B', parent: 'a', x: 0.1, y: 0.1 }] };
    const before = JSON.stringify(raw);
    const set = withNode(raw, 'a', { x: 1.2, y: -0.3 });
    check('a node set is clamped and kept; the input untouched', same(set.places[0], { id: 'a', label: 'A', parent: null, x: 1, y: 0 }) && JSON.stringify(raw) === before);
    const cleared = withNode(raw, 'b', null);
    check('a node cleared leaves no fractions behind', same(cleared.places[1], { id: 'b', label: 'B', parent: 'a' }));
    check('an unknown place changes nothing', same(withNode(raw, 'zz', { x: 0.5, y: 0.5 }), raw));
    const pic = withMap(raw, { image: 'x.png', width: 10, height: 20, source: 'drawn' });
    check('the picture set, normalised; cleared, gone', same(pic.map, { image: 'x.png', width: 10, height: 20, source: 'drawn' }) && !('map' in withMap(pic, null)) && !('map' in withMap(pic, { image: '' })));
}

console.log('\n§5 what the board draws');
{
    const pack = normalizePack(withNodes(file)).pack;
    const state = {
        where: { 'Old Marit': 'harbourside/old-town/the-anchor/back-room', 'Captain Reyes': 'harbourside/the-docks/customs-house', 'Jordan': 'harbourside/old-town/the-anchor', 'Wanderer': 'loc:the-mill', 'The governor': 'harbourside/the-hill/governors-house' },
        visited: [{ id: 'the-anchor' }, { id: 'loc:the-mill' }],
    };
    const m = boardModel({ pack, state, player: 'Jordan', weather: { harbourside: { emoji: '🌧', text: 'rain' } } });
    const node = (id) => m.nodes.find(n => n.id === id);
    check('three nodes, in the pack\'s order, with their fractions and paths', m.nodes.map(n => n.id).join(',') === 'harbourside,customs-house,the-anchor' && node('the-anchor').x === 0.2 && node('the-anchor').path === 'harbourside/old-town/the-anchor');
    check('a person is at the deepest placed place their place falls in', same(node('the-anchor').people, ['Old Marit']) && same(node('customs-house').people, ['Captain Reyes']) && same(node('harbourside').people, ['The governor']));
    check('the player is marked, not listed', m.playerAt === 'the-anchor' && node('the-anchor').player === true && !node('the-anchor').people.includes('Jordan') && node('customs-house').player === false);
    check('a person whose place has no node is elsewhere, with the place\'s name', same(m.elsewhere, [{ name: 'Wanderer', at: 'loc:the-mill', label: 'the mill' }]));
    check('visited is read from the state', node('the-anchor').visited === true && node('customs-house').visited === false);
    check('the region: the root of the chain; the root is a region itself', node('the-anchor').region === 'Harbourside' && node('the-anchor').regionId === 'harbourside' && node('harbourside').isRegion === true && node('harbourside').region === '');
    check('weather by region reaches every node under it, and the region\'s own', node('the-anchor').weather.emoji === '🌧' && node('harbourside').weather.text === 'rain');
    check('what is not on the map yet, by label', m.unplaced.length === 5 && m.unplaced.some(p => p.id === 'old-town' && p.label));
    const bare = boardModel({ pack: normalizePack(file).pack });
    check('no picture, no state: nothing placed, nobody anywhere', bare.nodes.length === 0 && bare.unplaced.length === 8 && bare.elsewhere.length === 0 && bare.playerAt === '');
    // Live World never writes the player into `where`: the party's place is the visited row's newest (the Map window's rule), on the board by the placed rule.
    const party = boardModel({ pack, state: { where: { 'Old Marit': 'harbourside/old-town/the-anchor' }, visited: [{ id: 'back-room', packId: 'back-room', path: 'harbourside/old-town/the-anchor/back-room', visits: ['m9'] }, { id: 'customs-house', packId: 'customs-house', path: 'harbourside/the-docks/customs-house', visits: [] }] }, player: 'Jordan' });
    check('the party\'s marker from the visited row: the newest place with a standing visit, on its nearest placed ancestor', party.playerAt === 'the-anchor' && party.nodes.find(n => n.id === 'the-anchor').player === true && party.nodes.find(n => n.id === 'customs-house').player === false);
    const sealed = boardModel({ pack, state: { where: {}, visited: [{ id: 'customs-house', packId: 'customs-house', path: 'harbourside/the-docks/customs-house', visits: [] }, { id: 'the-anchor', packId: 'the-anchor', path: 'harbourside/old-town/the-anchor', visits: [] }] }, player: 'Jordan' });
    check('a sealed snapshot (no visits kept): the first row is the party\'s place', sealed.playerAt === 'customs-house');
    const drawn = boardModel({ pack, state: { where: {}, visited: [{ id: 'the-anchor', packId: 'the-anchor', path: 'harbourside/old-town/the-anchor', visits: [], image: '/user/images/anchor-drawn.png' }] } });
    check('a node shows the picture a scene drew for its place, else the pack\'s art', drawn.nodes.find(n => n.id === 'the-anchor').image === '/user/images/anchor-drawn.png' && drawn.nodes.find(n => n.id === 'customs-house').image === (pack.places.find(p => p.id === 'customs-house').image || ''));
    const noRoot = boardModel({ pack: normalizePack(withNode(withNodes(file), 'harbourside', null)).pack, state: { where: { 'The governor': 'harbourside/the-hill/governors-house' }, visited: [] } });
    check('a person at a pack place with no placed ancestor is elsewhere, named by that place', same(noRoot.elsewhere, [{ name: 'The governor', at: 'harbourside/the-hill/governors-house', label: pack.places.find(p => p.id === 'governors-house').label }]));
}

console.log('\n§6 what the tree board draws (a world without a picture)');
{
    const pack = normalizePack(file).pack;
    const state = {
        where: { 'Old Marit': 'harbourside/old-town/the-anchor/back-room', 'Captain Reyes': 'harbourside/the-docks/customs-house', 'Jordan': 'loc:the-mill', 'Wanderer': 'loc:the-mill', 'The governor': 'harbourside' },
        visited: [{ id: 'back-room' }, { id: 'loc:the-mill', label: 'The old mill' }, { id: 'loc:a-road' }],
    };
    const t = treeModel({ pack, state, player: 'Jordan' });
    const g = t.groups[0];
    const at = (id) => g.places.find(p => p.id === id);
    check('one region, the root, with every place of the pack under it, the region first and marked', t.groups.length === 1 && g.id === 'harbourside' && g.places.length === 8 && g.places[0].id === 'harbourside' && g.places[0].isRegion === true && at('back-room') && at('back-room').isRegion === false);
    check('people at their own place, the region\'s own people on the region', same(at('back-room').people, ['Old Marit']) && same(at('customs-house').people, ['Captain Reyes']) && same(at('harbourside').people, ['The governor']) && at('the-anchor').people.length === 0);
    check('visited is read from the state', at('back-room').visited === true && at('the-anchor').visited === false);
    check('the story\'s own places under Elsewhere, named by their visit, with their people; the player there is marked', t.elsewhere.length === 2 && t.elsewhere[0].id === 'loc:the-mill' && t.elsewhere[0].label === 'The old mill' && same(t.elsewhere[0].people, ['Wanderer']) && t.elsewhere[0].player === true && t.playerAt === 'loc:the-mill' && t.elsewhere[1].id === 'loc:a-road' && t.elsewhere[1].people.length === 0);
    const bare = treeModel({ pack });
    check('no state: the places alone, nobody anywhere', bare.groups[0].places.every(p => p.people.length === 0 && !p.visited && !p.player) && bare.elsewhere.length === 0 && bare.playerAt === '');
}

console.log('\n§7 one rule for where a person stands: the board\'s, the tree\'s, the sheets\'');
{
    const pack = normalizePack(withNodes(file)).pack;    // the-anchor, customs-house and harbourside placed; back-room under the-anchor is not
    const back = 'harbourside/old-town/the-anchor/back-room';
    check('a path on the picture resolves to its deepest placed place; on the tree to its deepest place', placeOfPath(pack, back, { placed: true }) === 'the-anchor' && placeOfPath(pack, back, { placed: false }) === 'back-room' && placeOfPath(pack, 'harbourside/the-hill', { placed: true }) === 'harbourside' && placeOfPath(pack, 'loc:the-mill', { placed: true }) === '' && placeOfPath(pack, '', { placed: false }) === '');
    check('a story place keys itself on the tree and nowhere on the picture', keyOfPath(pack, 'loc:the-mill', { placed: false }) === 'loc:the-mill' && keyOfPath(pack, 'loc:the-mill', { placed: true }) === '' && keyOfPath(pack, back, { placed: true }) === 'the-anchor');
    const state = { where: { 'Old Marit': back, 'Captain Reyes': 'harbourside/the-docks/customs-house', 'Wanderer': 'loc:the-mill' }, visited: [{ id: 'back-room', packId: 'back-room', path: back, visits: ['m1'], image: '/user/images/back-room.png' }, { id: 'loc:the-mill', label: 'The old mill', visits: [], image: '' }] };
    const onNode = peopleAt(pack, state, 'the-anchor', { placed: true, player: 'Jordan' });
    const onChip = peopleAt(pack, state, 'the-anchor', { placed: false, player: 'Jordan' });
    const inBack = peopleAt(pack, state, 'back-room', { placed: false, player: 'Jordan' });
    check('the face on the node is the face on its sheet: a person at an unplaced sub-place is at the node on the picture, at the sub-place on the tree', same(onNode.people, ['Old Marit']) && onNode.player === true && same(onChip.people, []) && onChip.player === false && same(inBack.people, ['Old Marit']) && inBack.player === true);
    check('the story\'s own place on the tree has its people', same(peopleAt(pack, state, 'loc:the-mill', { placed: false }).people, ['Wanderer']) && peopleAt(pack, state, 'loc:the-mill', { placed: true }).people.length === 0 && peopleAt(pack, state, '', { placed: false }).people.length === 0);
    check('the party\'s place: the visited row\'s, by the board\'s rule; a `where` entry under the player\'s name wins when a state has one', partyAt(pack, state, { placed: true }) === 'the-anchor' && partyAt(pack, state, { placed: false }) === 'back-room' && playerPlace(pack, state, 'Jordan', { placed: false }) === 'back-room' && playerPlace(pack, { ...state, where: { ...state.where, Jordan: 'harbourside/the-docks/customs-house' } }, 'Jordan', { placed: true }) === 'customs-house' && partyAt(pack, { visited: [{ id: 'loc:the-mill', visits: [] }] }, { placed: false }) === 'loc:the-mill' && partyAt(pack, { visited: [] }) === '');
    check('a story place\'s name: the row\'s label, else the id read as words', labelOfKey(state, 'loc:the-mill') === 'The old mill' && labelOfKey({ visited: [] }, 'loc:the-mill') === 'the mill' && labelOfKey(null, 'x') === 'x');
    check('a place\'s picture: the one a scene drew, else the pack\'s art, else none', placeImage(pack, state, 'back-room') === '/user/images/back-room.png' && placeImage(pack, state, 'the-anchor') === (pack.places.find(p => p.id === 'the-anchor').image || '') && placeImage(pack, state, 'loc:the-mill') === '' && placeImage(pack, null, 'nowhere') === '');
    check('a kept view belongs to a picture: its path and size', pictureKey({ image: 'a.png', width: 10, height: 20 }) === 'a.png|10x20' && pictureKey({ image: 'a.png', width: 10, height: 21 }) !== pictureKey({ image: 'a.png', width: 10, height: 20 }) && pictureKey({ image: '' }) === '' && pictureKey(null) === '');
}

console.log(`\n${failures === 0 ? 'All hub board checks pass' : `${failures} FAILURE(S)`}`);
process.exit(failures === 0 ? 0 : 1);
