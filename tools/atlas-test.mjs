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
    ATLAS_KINDS, ELSEWHERE_ID, normalizeAtlas, atlasToRaw, guessKind, guessTerrain, cleanKind, hash01, scaleOf, measureOf,
    layoutAtlas, regionOutline, atlasModel, partyKey, distanceBetween, travelHours, describeLength, describeTime, describeDistance,
    filterMarkers, kindCounts, withSpot, withSettledSpots,
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

console.log('\n§4 the layout');
{
    const p = realm();
    const a = layoutAtlas(p);
    const b = layoutAtlas(realm());
    check('every place has a spot', p.places.every(x => a.has(x.id)) && a.size === p.places.length);
    check('the same world, the same map', same([...a], [...b]));
    const more = realm([{ id: 'new-ford', label: 'New Ford', parent: 'northmarch' }, { id: 'far-isle', label: 'Far Isle' }, { id: 'cellar', label: 'The Cellar', parent: 'iron-inn' }]);
    const c = layoutAtlas(more);
    check('a place added later moves nothing (D140)', p.places.every(x => same(a.get(x.id), c.get(x.id))), JSON.stringify(p.places.filter(x => !same(a.get(x.id), c.get(x.id))).map(x => x.id)));
    check('the new places have spots of their own', c.has('new-ford') && c.has('far-isle') && c.has('cellar') && c.get('cellar').depth === 2 && c.get('far-isle').depth === 0);
    const all = [...c.values()];
    const apart = all.every((s, i) => all.every((t, j) => i >= j || Math.hypot(s.x - t.x, s.y - t.y) > 0.005));
    check('no two places share a spot', apart);
    check('a child stands near its parent, a region far from another', Math.hypot(a.get('frosthold').x - a.get('northmarch').x, a.get('frosthold').y - a.get('northmarch').y) < 3 && Math.hypot(a.get('northmarch').x - a.get('greywood').x, a.get('northmarch').y - a.get('greywood').y) > 6);
    check('a place inside a place stands closer still', Math.hypot(a.get('fish-market').x - a.get('saltport').x, a.get('fish-market').y - a.get('saltport').y) < 0.3);
    const pinned = normalizePack(withSpot(worldToRaw(p), 'saltport', { x: 40, y: 40 })).pack;
    const d = layoutAtlas(pinned);
    check('a stored spot is kept, and marked as the user\'s', d.get('saltport').x === 40 && d.get('saltport').y === 40 && d.get('saltport').by === 'user');
    check('a place inside a moved place follows it', Math.hypot(d.get('fish-market').x - 40, d.get('fish-market').y - 40) < 0.3);
    check('the others stay', ['northmarch', 'greywood', 'frosthold', 'iron-inn', 'old-shrine'].every(id => same({ x: a.get(id).x, y: a.get(id).y }, { x: d.get(id).x, y: d.get(id).y })));
    const settled = withSettledSpots(worldToRaw(p), p);
    check('settling writes every spot down once', settled.added === p.places.length && Object.keys(settled.raw.atlas.spots).length === p.places.length && withSettledSpots(settled.raw, normalizePack(settled.raw).pack).added === 0);
    check('a settled world draws the same map', same([...layoutAtlas(normalizePack(settled.raw).pack)].map(([id, s]) => [id, s.x, s.y]), [...a].map(([id, s]) => [id, s.x, s.y])));
    const outline = regionOutline('greywood', { x: 0, y: 0 }, 2);
    check('a region\'s outline: 40 points near its radius, the same every time', outline.length === 40 && outline.every(([x, y]) => Math.hypot(x, y) > 1.5 && Math.hypot(x, y) < 2.5) && same(outline, regionOutline('greywood', { x: 0, y: 0 }, 2)));
}

console.log('\n§5 the model');
{
    const p = realm();
    const state = seedWorldState(p, { name: '' });
    state.visited = [{ id: 'iron-inn', label: 'The Iron Inn', packId: 'iron-inn', path: 'northmarch/iron-inn', visits: [4] }, { id: 'loc:the-burnt-mill', label: 'The Burnt Mill', packId: '', path: '', visits: [2] }];
    state.where = { ...state.where, Kessa: 'loc:the-burnt-mill', Hero: 'greywood/old-shrine' };
    const m = atlasModel({ pack: p, state, player: 'Hero' });
    const by = (id) => m.markers.find(x => x.id === id);
    check('a marker for every place, and the story\'s own under Elsewhere', p.places.every(x => by(x.id)) && by('loc:the-burnt-mill') && by(ELSEWHERE_ID) && by('loc:the-burnt-mill').region === ELSEWHERE_ID && by(ELSEWHERE_ID).label === 'Elsewhere');
    check('a root with places inside is a region; the rest take their kind or a guess', by('northmarch').kind === 'region' && by('old-shrine').kind === 'ruin' && by('iron-inn').kind === 'tavern' && by('saltport').kind === 'settlement' && by('loc:the-burnt-mill').kind === 'other');
    check('the people stand where they were last seen, the player apart', same(by('iron-inn').people, ['Mara']) && same(by('fish-market').people, ['Odo']) && same(by('loc:the-burnt-mill').people, ['Kessa']) && by('old-shrine').people.length === 0);
    check('the party is where the player is', m.party === 'old-shrine' && by('old-shrine').player === true && by('iron-inn').player === false);
    check('without the player in the world, the party is at the newest visit', partyKey(p, state, '') === 'iron-inn' && atlasModel({ pack: p, state }).party === 'iron-inn');
    check('visited places are marked', by('iron-inn').visited && by('loc:the-burnt-mill').visited && !by('saltport').visited);
    check('a marker knows its region, its parent and its note', by('fish-market').regionLabel === 'The Salt Coast' && by('fish-market').parentLabel === 'Saltport' && by('fish-market').depth === 2 && by('iron-inn').note.startsWith('Warm') && by('northmarch').regionLabel === '');
    check('a region for every root, each around its places', m.regions.length === 4 && m.regions.every(r => r.outline.length === 40 && r.radius > 0) && m.regions.find(r => r.id === 'greywood').terrain === 'forest');
    const inside = (r, mk) => Math.hypot(mk.x - r.x, mk.y - r.y) < r.radius * 0.95;
    check('a region holds its own places', m.markers.filter(x => x.depth === 1).every(x => inside(m.regions.find(r => r.id === x.region), x)));
    check('routes: a tree in each region and one over the regions', m.routes.filter(r => r.kind === 'highway').length === 3 && m.routes.filter(r => r.kind === 'road').length === 6 && m.routes.every(r => r.points.length === 2));
    check('the bounds hold everything', m.markers.every(x => x.x > m.bounds.minX && x.x < m.bounds.maxX && x.y > m.bounds.minY && x.y < m.bounds.maxY) && m.regions.every(r => r.outline.every(([x, y]) => x > m.bounds.minX && x < m.bounds.maxX && y > m.bounds.minY && y < m.bounds.maxY)));
    const w = atlasModel({ pack: p, state, weather: { greywood: { emoji: '🌧️', text: 'Steady rain' }, 'iron-inn': { emoji: '❄️', text: 'Snow' } } });
    check('the weather: a place\'s own, else its region\'s', w.markers.find(x => x.id === 'old-shrine').weather.text === 'Steady rain' && w.markers.find(x => x.id === 'iron-inn').weather.text === 'Snow' && w.markers.find(x => x.id === 'saltport').weather === null);
    const blank = blankPack('Ashfall');
    const bs = seedWorldState(blank, { name: 'Ashfall' });
    bs.visited = [{ id: 'loc:the-quay', label: 'The Quay', packId: '', path: '', visits: [1] }];
    const bm = atlasModel({ pack: blank, state: bs, worldName: 'Ashfall' });
    check('the blank world: the story\'s places under the world\'s own name', bm.markers.length === 2 && bm.markers.find(x => x.id === ELSEWHERE_ID).label === 'Ashfall' && bm.party === 'loc:the-quay' && bm.regions.length === 1);
    const none = atlasModel({ pack: blankPack('Nothing'), state: null });
    check('nothing to draw is said, with bounds still', none.empty === true && none.markers.length === 0 && none.bounds.maxX > none.bounds.minX);
    const hm = atlasModel({ pack: harbour, state: seedWorldState(harbour, { name: '' }) });
    check('the example world draws', hm.markers.length === harbour.places.length && hm.regions.length >= 1 && !hm.empty);
}

console.log('\n§6 distance');
{
    const p = realm();
    const m = atlasModel({ pack: p });
    const d1 = distanceBetween(m, 'frosthold', 'iron-inn');
    const d2 = distanceBetween(m, 'frosthold', 'saltport');
    check('the straight line times the scale', d1 > 0 && near(d1, Math.hypot(m.markers.find(x => x.id === 'frosthold').x - m.markers.find(x => x.id === 'iron-inn').x, m.markers.find(x => x.id === 'frosthold').y - m.markers.find(x => x.id === 'iron-inn').y) * 15));
    check('the same both ways, nothing to itself, null off the map', near(distanceBetween(m, 'iron-inn', 'frosthold'), d1) && distanceBetween(m, 'frosthold', 'frosthold') === 0 && distanceBetween(m, 'frosthold', 'nowhere') === null);
    const more = atlasModel({ pack: realm([{ id: 'new-ford', label: 'New Ford', parent: 'northmarch' }, { id: 'far-isle', label: 'Far Isle' }]) });
    check('a place added later changes no distance (D141)', near(distanceBetween(more, 'frosthold', 'iron-inn'), d1, 1e-9) && near(distanceBetween(more, 'frosthold', 'saltport'), d2, 1e-9));
    check('the scale: one place with places inside is a town, several roots a region; the atlas\'s own wins', scaleOf(harbour) === 'town' && scaleOf(p) === 'region' && scaleOf(normalizePack({ ...worldToRaw(p), atlas: { scale: 'world' } }).pack) === 'world');
    const km = measureOf(normalizePack({ ...worldToRaw(p), atlas: { unit: 'km' } }).pack);
    check('the measure: the unit, a layout unit in it, the pace', same(measureOf(p), { unit: 'mi', per: 15, pace: 24, scale: 'region' }) && km.unit === 'km' && near(km.per, 24.1402) && near(km.pace, 38.6243));
    check('hours at the pace: a day is eight hours of the road', near(travelHours(24, measureOf(p)), 8) && near(travelHours(3, measureOf(p)), 1));
    check('a length in words', describeLength(3.24) === '3.2 miles' && describeLength(1) === '1 mile' && describeLength(12.3) === '12.5 miles' && describeLength(240.4) === '240 miles' && describeLength(5, 'km') === '5 km' && describeLength(2, 'league') === '2 leagues');
    check('a time in words', describeTime(0) === 'no time at all' && describeTime(0.05) === 'a few minutes' && describeTime(0.33) === 'about 20 minutes' && describeTime(1) === 'about an hour' && describeTime(3.2) === 'about 3 hours' && describeTime(8) === 'about a day' && describeTime(20) === 'about 2.5 days');
    const line = describeDistance(m, 'frosthold', 'saltport');
    check('the card\'s line', /^\d+(\.\d)? miles, about .+ on foot$/.test(line) && describeDistance(m, 'frosthold', 'frosthold') === '' && describeDistance(m, '', 'frosthold') === '' && describeDistance(m, 'frosthold', 'nowhere') === '', line);
    const town = atlasModel({ pack: harbour });
    const ids = town.markers.filter(x => x.depth === 1).map(x => x.id);
    check('a town\'s places are minutes apart', ids.length >= 2 && /minutes|steps/.test(describeDistance(town, ids[0], ids[1])), describeDistance(town, ids[0], ids[1]));
}

console.log('\n§7 the search and the switches');
{
    const m = atlasModel({ pack: realm(), state: seedWorldState(realm(), { name: '' }) });
    const ids = (list) => list.map(x => x.id).sort();
    check('no search, nothing off: every marker', filterMarkers(m.markers).length === m.markers.length);
    check('a search over names', same(ids(filterMarkers(m.markers, { query: 'salt' })), ['fish-market', 'saltcoast', 'saltport']));
    check('a search over notes and people', same(ids(filterMarkers(m.markers, { query: 'soldiers' })), ['iron-inn']) && same(ids(filterMarkers(m.markers, { query: 'odo' })), ['fish-market']));
    check('a kind switched off hides its markers', filterMarkers(m.markers, { hidden: ['region'] }).every(x => x.kind !== 'region') && filterMarkers(m.markers, { hidden: ['region'] }).length === m.markers.length - 3);
    check('both at once', same(ids(filterMarkers(m.markers, { query: 'salt', hidden: ['region', 'shop'] })), ['saltport']));
    const counts = kindCounts(m.markers);
    check('the counts: the kinds on the map, in the list\'s order, none empty', counts[0].id === 'region' && counts[0].count === 3 && counts.every(k => k.count > 0) && counts.reduce((n, k) => n + k.count, 0) === m.markers.length && same(counts.map(k => k.id), ATLAS_KINDS.map(k => k.id).filter(id => counts.some(k => k.id === id))));
    const seen = atlasModel({ pack: realm(), state: { ...seedWorldState(realm(), { name: '' }), visited: [{ id: 'iron-inn', label: 'The Iron Inn', packId: 'iron-inn', path: 'northmarch/iron-inn', visits: [1] }] } });
    check('the counts know what was visited', kindCounts(seen.markers).find(k => k.id === 'tavern').visited === 1 && kindCounts(seen.markers).find(k => k.id === 'region').visited === 0);
}

console.log(failures ? `\n${failures} failure(s)` : '\nall pass');
process.exit(failures ? 1 : 0);
