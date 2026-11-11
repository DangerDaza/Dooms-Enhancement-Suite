#!/usr/bin/env node
/**
 * World gen on the Atlas (docs/long-shot-plan.md D182, D183, D186), pure:
 * what the panel offers for a map, the world a set of choices would make,
 * the book with that world put under the map (around what is placed, or
 * clean), a world made again, the request that names the lands and its
 * reply; and a set-up and a fill keeping to a generated world's land.
 *
 * Usage:  node tools/atlas-world-test.mjs     (from the repo root)
 * Exit:   0 = pass, 1 = failure
 */
import { blankPack } from '../src/utils/liveWorld.js';
import { atlasModel, addPin, unplace, normalizeBook, withScale, setCanon, editMarker, placeAll, territoryAt } from '../src/utils/atlas.js';
import { generateWorld, WORLD_SIZES, WORLD_REGIONS, isStandInName } from '../src/utils/worldGen.js';
import { standIns, worldGenState, worldGenDefaults, planWorldGen, applyWorldGen, worldReach, landsToName, buildNamesPrompt, parseNames, applyNames, NAMES_MAX } from '../src/utils/atlasWorld.js';
import { parseSetup, applySetup, parseFill, applyFill } from '../src/utils/atlasSetup.js';

let failures = 0;
function check(name, cond, detail = '') {
    if (cond) console.log(`pass  ${name}`);
    else { failures++; console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ''}`); }
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const pack = blankPack('x');
const top = (book) => atlasModel({ pack, book });

console.log('\n§1 an empty map');
{
    const m = top(null);
    const d = worldGenDefaults(null, m);
    check('the panel opens on one great landmass of the middle size, a handful of regions, nothing to keep', same(d, { shape: 'pangea', size: 'medium', seed: '', regions: WORLD_REGIONS.default, mode: 'clean' }));
    check('nothing stands on it', same(worldGenState(null, m), { had: false, regions: 0, places: 0, waitingRegions: 0, standIns: 0 }));
    check('without a seed there is nothing to make', planWorldGen(null, m, { ...d }) === null && applyWorldGen(null, m, { ...d }) === null);
    const plan = planWorldGen(null, m, { ...d, seed: 'alpha' });
    check('a plan changes nothing and tells the world, the regions it adds and their lands', plan.world === generateWorld({ seed: 'alpha', shape: 'pangea', size: 'medium' }) && plan.added.length === 9 && plan.lands.length === 9 && plan.lands.every(l => l.added && l.parts.length >= 1 && l.label) && plan.unplaced === 0 && plan.replaced.length === 0 && plan.kept.length === 0);
    check('each new region has a plain name of its own', new Set(plan.added.map(a => a.name)).size === 9 && plan.added.every(a => isStandInName(a.name)), JSON.stringify(plan.added.map(a => a.name)));
    const r = applyWorldGen(null, m, { ...d, seed: 'alpha' });
    const after = top(r.book);
    check('applied: the world is under the map and the regions stand on it, each holding a land, none canon', r.added.length === 9 && r.unplaced === 0 && r.replaced === 0 && after.world.seed === 'alpha' && after.territories.length === 9 && after.territories.every(t => t.loose === true) && after.world.unclaimed < 0.01);
    check('the same choices give the same book', same(applyWorldGen(null, m, { ...d, seed: 'alpha' }).book, r.book));
    check('no regions asked for: the world alone', (() => { const x = applyWorldGen(null, m, { ...d, seed: 'alpha', regions: 0 }); return x.added.length === 0 && top(x.book).territories.length === 0 && top(x.book).world.shape === 'pangea'; })());
    check('a strange shape, size or count falls back', (() => { const x = planWorldGen(null, m, { seed: 'a', shape: 'ring', size: 'vast', regions: 999, mode: 'what' }); return x.spec.shape === 'pangea' && x.spec.w === WORLD_SIZES.medium.w && x.added.length <= WORLD_REGIONS.max && x.mode === 'keep'; })());
    check('a world\'s size in words, at the map\'s scale', worldReach(plan.spec, after.measure) === 'about 960 by 660 miles' && worldReach(plan.spec, { per: 60, unit: 'km' }) === 'about 3850 by 2650 km' && worldReach(null, after.measure) === '');
}

console.log('\n§2 a map that has places: around them, or clean');
let made = {};
let b = withScale(null, 'region');
for (const [label, kind, x, y] of [['The Redward', 'region', 0, 0], ['Kessel Vale', 'region', 14, -3], ['The Salt Fens', 'region', -9, 11], ['Hask', 'settlement', 30, 12]]) { const r = addPin(b, { label, kind, x, y }); b = r.book; made[label] = r.id; }
for (const [label, kind, x, y] of [['Redfall Castle', 'stronghold', 1, 1], ['Mirefen Ferry', 'water', -2, 0.5]]) b = addPin(b, { label, kind, x, y, layer: made['The Redward'] }).book;
{ const r = addPin(b, { label: 'Greywood', kind: 'region' }); b = unplace(r.book, r.id); made.Greywood = r.id; }
{
    const m = top(b);
    const d = worldGenDefaults(b, m);
    check('a map with regions of its own is offered no new ones, and to keep what is placed', d.regions === 0 && d.mode === 'keep' && same(worldGenState(b, m), { had: false, regions: 3, places: 1, waitingRegions: 1, standIns: 0 }));
    const keep = applyWorldGen(b, m, { ...d, seed: 'alpha', shape: 'divide' });
    const km = top(keep.book);
    const spot = (book, id) => normalizeBook(book).spots[id];
    check('around what is placed: nothing moves', keep.unplaced === 0 && Object.values(made).every(id => same(spot(keep.book, id), spot(b, id))));
    check('there is land under every place, and every region holds the land about it', km.markers.every(x => km.geo.world.isLand(x.x, x.y)) && km.territories.length === 3 && km.territories.every(t => territoryAt(km, t.x, t.y) === t.id) && km.land.length === 0);
    check('the world is wide enough to hold them, its middle on theirs', km.world.size === 'custom' && km.world.w > WORLD_SIZES.medium.w && km.bounds.minX < -9 - 3 && km.bounds.maxX > 30 + 3 && same(normalizeBook(keep.book).world.anchors.length, 4));
    check('what is inside a region is not touched', same(top(keep.book).all.filter(x => x.layer === made['The Redward']).map(x => x.label).sort(), ['Mirefen Ferry', 'Redfall Castle']) && same(spot(keep.book, top(keep.book).all.find(x => x.label === 'Redfall Castle').id), { x: 1, y: 1 }));
    const more = applyWorldGen(b, m, { ...d, seed: 'alpha', shape: 'pangea', regions: 5 });
    const mm = top(more.book);
    check('regions added beside the ones there: clear of them, each on its own land', more.added.length === 5 && mm.territories.length === 8 && more.added.every(id => { const t = mm.territories.find(x => x.id === id); return t && t.loose && [0, 14, -9].every((x, i) => Math.hypot(t.x - x, t.y - [0, -3, 11][i]) > 4); }));

    const clean = applyWorldGen(b, m, { ...d, seed: 'alpha', shape: 'divide', mode: 'clean', regions: 0 });
    const cm = top(clean.book);
    check('clean: everything on the map goes back to the list, to be put down again', clean.unplaced === 4 && cm.markers.length === 0 && cm.tray.filter(t => t.here !== false).length === 5 && cm.territories.length === 0 && normalizeBook(clean.book).world.anchors.length === 0 && normalizeBook(clean.book).world.cx === 0);
    check('what is inside a region still is', same(top(clean.book).all.filter(x => x.layer === made['The Redward']).length, 2));
    const placed = top(placeAll(clean.book, cm));
    check('Place all then puts the regions on the new world\'s land, each with a land', placed.territories.length === 4 && placed.markers.every(x => placed.geo.world.isLand(x.x, x.y)));
}

console.log('\n§3 a world made again');
{
    const first = applyWorldGen(null, top(null), { seed: 'alpha', shape: 'pangea', size: 'medium', regions: 6, mode: 'clean' });
    let book = first.book;
    // One land is named by the player, one is made canon as it is, one has a place put inside it; three are left as they came.
    book = editMarker(book, first.added[0], { label: 'The Redward' });
    book = setCanon(book, first.added[1], true);
    book = addPin(book, { label: 'Hask', kind: 'settlement', x: 0, y: 0, layer: first.added[2] }).book;
    const m = top(book);
    check('the regions nobody took up are known: not canon, empty, still under their plain name', standIns(m).length === 3 && standIns(m).every(x => first.added.slice(3).includes(x.id)));
    const d = worldGenDefaults(book, m);
    check('the panel opens on the world the map has, and offers as many regions again as it would replace', d.shape === 'pangea' && d.size === 'medium' && d.seed === 'alpha' && d.mode === 'keep' && d.regions === 3 && worldGenState(book, m).had === true && worldGenState(book, m).standIns === 3 && worldGenState(book, m).regions === 3);
    const again = applyWorldGen(book, m, { ...d, seed: 'beta', regions: 4 });
    const am = top(again.book);
    check('made again: the three that were taken up stay where they are, the rest are replaced', again.replaced === 3 && again.added.length === 4 && am.territories.length === 7 && first.added.slice(0, 3).every(id => am.territories.some(t => t.id === id)) && first.added.slice(3).every(id => !am.all.some(x => x.id === id)) && am.world.seed === 'beta');
    check('the replaced regions are forgotten, not kept as deleted', am.deleted.length === 0);
    check('a new land\'s plain name is clear of the names already there', new Set(am.territories.map(t => t.label)).size === 7);
}

console.log('\n§4 naming the lands (D186)');
{
    const r = applyWorldGen(null, top(null), { seed: 'alpha', shape: 'pangea', size: 'medium', regions: 6, mode: 'clean' });
    let book = editMarker(r.book, r.added[0], { label: 'The Redward', note: 'Red clay hills.' });
    book = addPin(book, { label: 'Hask', kind: 'settlement', x: 0, y: 0, layer: r.added[0] }).book;
    const m = top(book);
    const lands = landsToName(m);
    check('the lands to name: the regions still under a plain name', lands.length === 5 && lands.every(t => t.id !== r.added[0]));
    const p = buildNamesPrompt({ model: m, world: 'Vael', lore: 'The Ashen Coast lies in the far north.', card: { description: 'A grim world.' }, wish: 'Old Norse sounding names.' });
    check('the request numbers each land and tells it by where it lies, its ground and what it borders', p.count === 5 && p.lands.length === 5 && /The lands to name:\n1\. (on the coast|landlocked), in the \w+ of the world: [^\n]+; borders [^\n]+\n2\. /.test(p.user), p.user.slice(-900));
    check('the lands already named are given, not to be renamed; a numbered neighbour is told by its number', /The lands that have their names \(do not rename them\):\n- The Redward: /.test(p.user) && /borders [^\n]*land \d/.test(p.user) && !/Northern|Southern|Eastern|Western|Central|Heartland/.test(p.user.split('The lands to name:')[1].replace(/in the \w+ of the world/g, '')));
    check('the player\'s wish leads; the world, the card, the lore and the places follow', p.user.startsWith('WHAT THE PLAYER ASKED FOR') && /The world: Vael\. Its map: One great landmass/.test(p.user) && /A grim world\./.test(p.user) && /Ashen Coast/.test(p.user) && /Places of the world[^\n]*Hask/.test(p.user));
    check('the AI is told to send one JSON object, one entry a land, and never a coordinate', /one JSON object/.test(p.system) && /"lands":\[\{"n"/.test(p.system) && /5 in all/.test(p.system) && /never write coordinates/.test(p.system));

    const reply = 'Here you go:\n```json\n' + JSON.stringify({ lands: [
        { n: 1, name: 'The Ashen Coast', note: 'Grey cliffs and wrecker villages.' }, { n: 2, name: 'the redward', note: 'taken' }, { n: 3, name: 'Northern Plains', note: 'a stand-in' },
        { n: 4, name: '  Skaldmark ', note: 'x'.repeat(500) }, { n: 4, name: 'Twice', note: '' }, { n: 5, name: 'Hask' }, { n: 9, name: 'Nowhere' }, null, { n: 1, name: 'Again' },
    ] }) + '\n```';
    const parsed = parseNames(reply, m, p.lands);
    check('the reply read: a name for a numbered land; one that is taken, a stand-in, given twice or for no land is passed over', parsed.ok && same(parsed.names.map(n => [p.lands.find(l => l.id === n.id).n, n.name]), [[1, 'The Ashen Coast'], [4, 'Skaldmark']]) && parsed.names[1].note.length === 300 && parsed.names[0].was === p.lands[0].label, JSON.stringify(parsed.names.map(n => n.name)));
    check('a reply with no names, or none that can be used, says so', !parseNames('I cannot.', m, p.lands).ok && !parseNames('{"lands":[{"n":2,"name":"The Redward"}]}', m, p.lands).ok && /no name/.test(parseNames('{"lands":[]}', m, p.lands).error));
    const named = top(applyNames(book, parsed.names));
    check('applied: the lands carry their names and notes, and are still not canon', named.territories.some(t => t.label === 'The Ashen Coast' && t.loose) && named.markers.find(x => x.label === 'Skaldmark').note.length === 300 && landsToName(named).length === 3 && standIns(named).length === 3);
    check(`no more than ${NAMES_MAX} lands are named in one request`, NAMES_MAX === 24 && landsToName(null).length === 0 && buildNamesPrompt({ model: top(null) }).count === 0);
}

console.log('\n§5 a set-up and a fill keep to the world\'s land');
{
    const base = applyWorldGen(null, top(null), { seed: 'alpha', shape: 'divide', size: 'medium', regions: 0, mode: 'clean' }).book;
    const m = top(base);
    const reply = JSON.stringify({ scale: 'region', places: [
        { name: 'The Redward', kind: 'region', inside: '' }, { name: 'Kessel Vale', kind: 'region', inside: '', near: [{ to: 'The Redward', dir: 'e', far: 'far' }] }, { name: 'The Salt Fens', kind: 'region', inside: '' },
        { name: 'Hask', kind: 'settlement', inside: 'The Redward' }, { name: 'The Black Stair', kind: 'ruin', inside: 'Hask' }, { name: 'The Old Road', kind: 'wild', inside: '' },
    ] });
    const draft = parseSetup(reply, m).draft;
    const r = applySetup(draft, base);
    const sm = top(r.book);
    check('a set-up keeps the world under the map', sm.world && sm.world.seed === 'alpha' && sm.world.shape === 'divide');
    check('its regions stand on the world\'s land, spread over it, each holding a land', sm.territories.length === 3 && sm.territories.every(t => sm.geo.world.isLand(t.x, t.y)) && sm.territories.every((t, i) => sm.territories.every((o, j) => i === j || Math.hypot(t.x - o.x, t.y - o.y) > 5)));
    check('what else it put on the top map stands on dry land', sm.markers.filter(x => x.kind !== 'region').length === 1 && sm.markers.filter(x => x.kind !== 'region').every(x => sm.geo.world.isLand(x.x, x.y)));
    check('a set-up on a map with no world is as it ever was', !('world' in applySetup(draft, null).book));

    const fill = parseFill(JSON.stringify({ places: [
        { name: 'The Wyrmreach', note: 'Dragon country.', near: [{ to: 'The Redward', dir: 'w', far: 'far' }] }, { name: 'Ostmark', note: 'The eastern march.', near: [{ to: 'The Redward', dir: 'e', far: 'far' }] },
        { name: 'The Drowned Shire', note: 'Fens.', near: [{ to: 'Ostmark', dir: 'n', far: 'far' }] }, { name: 'Farthest Thule', note: 'Ice.', near: [{ to: 'Kessel Vale', dir: 's', far: 'far' }] },
    ] }), sm, { what: 'regions' });
    const f = applyFill(r.book, sm, fill.places);
    const fm = top(f.book);
    check('a fill\'s regions come to stand on dry land, clear of one another, each with a land', f.ids.length === 4 && fm.territories.length === 7 && f.ids.every(id => { const t = fm.territories.find(x => x.id === id); return t && fm.geo.world.isLand(t.x, t.y) && fm.territories.every(o => o.id === id || Math.hypot(o.x - t.x, o.y - t.y) >= 3.9); }));
}

console.log(failures ? `\n${failures} failure(s)` : '\nall pass');
process.exit(failures ? 1 : 0);
