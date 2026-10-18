#!/usr/bin/env node
/**
 * The Live World map's pure part: which places are drawn, where, the
 * lines, and which known characters stand where.
 *
 * Usage:  node tools/world-map-test.mjs     (from the repo root)
 * Exit:   0 = pass, 1 = failure
 */
import { readFileSync } from 'node:fs';
import { normalizePack, seedWorldState, markKnown } from '../src/utils/liveWorld.js';
import { placeDepths, layoutProvince, provinceLines, placeTokens, buildProvinceView, safeImageUrl } from '../src/utils/worldMap.js';

let failures = 0;
const check = (label, cond, extra = '') => {
    if (cond) console.log(`pass  ${label}`);
    else { console.error(`FAIL  ${label}${extra ? '\n      ' + extra : ''}`); failures++; }
};
const inside = (n) => n.x >= 0 && n.x <= 100 && n.y >= 0 && n.y <= 100;
const apart = (a, b) => Math.hypot(a.x - b.x, a.y - b.y) > 8;

const harbour = normalizePack(JSON.parse(readFileSync(new URL('../worldpacks/example.json', import.meta.url), 'utf8'))).pack;
const sky = normalizePack(JSON.parse(readFileSync(new URL('../worldpacks/skyreach.json', import.meta.url), 'utf8'))).pack;

console.log('\n§1 depths and the drawn set');
{
    const d = placeDepths(harbour);
    check('a pack\'s zoom gives the depth', d.harbourside === 0 && d['the-docks'] === 1 && d['customs-house'] === 2 && d['back-room'] === 3);
    const noZoom = normalizePack({ id: 'z', places: [{ id: 'a' }, { id: 'b', parent: 'a' }, { id: 'c', parent: 'b' }] }).pack;
    check('without zoom, the distance from the root', JSON.stringify(placeDepths(noZoom)) === '{"a":0,"b":1,"c":2}');
    const nodes = layoutProvince(harbour, { depth: 1 });
    check('the province: the root and its districts, nothing deeper', nodes.map(n => n.id).sort().join(',') === 'harbourside,old-town,the-docks,the-hill');
    check('depth 0: the roots only', layoutProvince(harbour, { depth: 0 }).map(n => n.id).join() === 'harbourside');
}

console.log('\n§2 the layout');
{
    const nodes = layoutProvince(harbour);
    const root = nodes.find(n => n.id === 'harbourside');
    const kids = nodes.filter(n => n.parent === 'harbourside');
    check('one root sits near the centre, its districts around it, all on the canvas', Math.abs(root.x - 50) < 1 && kids.length === 3 && nodes.every(inside) && kids.every(k => Math.hypot(k.x - root.x, k.y - root.y) > 20), JSON.stringify(nodes.map(n => [n.id, n.x, n.y])));
    check('no two nodes share a spot', nodes.every((a, i) => nodes.every((b, j) => i === j || apart(a, b))));
    const lines = provinceLines(nodes);
    check('a line from the root to each district, curved', lines.length === 3 && lines.every(l => l.from === 'harbourside' && l.x1 === root.x && Number.isFinite(l.cx) && Number.isFinite(l.cy)));
    const skyNodes = layoutProvince(sky);
    const roots = skyNodes.filter(n => !n.parent);
    const market = skyNodes.find(n => n.id === 'low-market');
    const gilead = skyNodes.find(n => n.id === 'gilead');
    check('several roots share a ring, each district near its own root', roots.length === 3 && skyNodes.every(inside) && Math.hypot(market.x - gilead.x, market.y - gilead.y) < Math.hypot(market.x - roots[1].x, market.y - roots[1].y) && skyNodes.every((a, i) => skyNodes.every((b, j) => i === j || apart(a, b))), JSON.stringify(skyNodes.map(n => [n.id, Math.round(n.x), Math.round(n.y)])));
    const fixed = normalizePack({ id: 'f', places: [{ id: 'a', x: 10, y: 95 }, { id: 'b', parent: 'a', x: 200, y: -4 }, { id: 'c', parent: 'a' }] }).pack;
    const fn = layoutProvince(fixed);
    check('a pack\'s own x/y is kept, clamped away from the edge; the rest laid out', fn.find(n => n.id === 'a').x === 10 && fn.find(n => n.id === 'a').y === 91 && fn.find(n => n.id === 'b').x === 91 && fn.find(n => n.id === 'b').y === 9 && inside(fn.find(n => n.id === 'c')));
    const deep = normalizePack({ id: 'd', places: [{ id: 'a' }, { id: 'b', parent: 'a' }, { id: 'c', parent: 'b', zoom: 1 }] }).pack;
    check('a deeper place a pack\'s zoom pulls into the province still gets a spot', layoutProvince(deep).every(n => inside(n)));
    const empty = layoutProvince({ places: [] });
    check('no places: nothing', empty.length === 0 && provinceLines(empty).length === 0);
}

console.log('\n§3 who stands where');
{
    let s = seedWorldState(harbour);
    s = markKnown(s, ['Wanderer', 'Ghost']);
    s.where['Ghost'] = 'nowhere/at-all';
    const view = buildProvinceView(harbour, s);
    const by = Object.fromEntries(view.nodes.map(n => [n.id, n]));
    check('a known character in a deeper place stands on the drawn ancestor, marked as within', by['the-docks'].tokens.length === 1 && by['the-docks'].tokens[0].name === 'Captain Reyes' && by['the-docks'].tokens[0].exact === false && by['the-docks'].tokens[0].place === 'customs-house' && by['the-docks'].count === 1);
    check('a known character in a district stands on it', by['old-town'].tokens[0].name === 'Old Marit' && by['old-town'].tokens[0].exact === false);
    check('heard-of names stay off the map', !view.nodes.some(n => n.tokens.some(t => t.name === 'The governor')) && !view.unplaced.includes('The governor'));
    check('a known name with no place is listed as unplaced; a place the pack lost as off the map', view.unplaced.join() === 'Wanderer' && view.offMap.join() === 'Ghost');
    const roots = buildProvinceView(harbour, s, { depth: 0 });
    check('at depth 0 everyone rolls up to the root', roots.nodes[0].count === 2 && roots.nodes[0].tokens.map(t => t.name).join() === 'Captain Reyes,Old Marit');
    const exact = markKnown(seedWorldState(harbour), []);
    exact.where['Old Marit'] = 'harbourside/old-town';
    check('a character at the drawn place itself is exact', placeTokens(layoutProvince(harbour), harbour, exact).tokens['old-town'][0].exact === true);
    check('no state, no pack: nothing to draw', buildProvinceView(null, s).nodes.length === 0 && buildProvinceView(harbour, null).nodes.length === 0);
    const skyView = buildProvinceView(sky, seedWorldState(sky));
    check('Skyreach: One Feather at the high table stands on the Low Market; Maeve, heard of, does not appear', skyView.nodes.find(n => n.id === 'low-market').tokens[0].name === 'One Feather' && !JSON.stringify(skyView).includes('Maeve'));
}

console.log('\n§4 place images');
check('plain URLs pass, scripts and odd characters do not', safeImageUrl('https://x/y.png') === 'https://x/y.png' && safeImageUrl('/user/images/a.png') === '/user/images/a.png' && safeImageUrl('data:image/png;base64,AAA=') === 'data:image/png;base64,AAA=' && safeImageUrl('worldpacks/art/gilead.jpg') === 'worldpacks/art/gilead.jpg' && safeImageUrl('javascript:alert(1)') === '' && safeImageUrl('https://x/a b.png') === '' && safeImageUrl('x") url(javascript:1') === '' && safeImageUrl('') === '');

console.log(`\n${failures === 0 ? 'All world map checks pass' : `${failures} FAILURE(S)`}`);
process.exit(failures === 0 ? 0 : 1);
