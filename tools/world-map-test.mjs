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
import { placeDepths, layoutProvince, provinceLines, placeTokens, buildProvinceView, safeImageUrl, provinceCrumbs, resolveRoot } from '../src/utils/worldMap.js';

let failures = 0;
const check = (label, cond, extra = '') => {
    if (cond) console.log(`pass  ${label}`);
    else { console.error(`FAIL  ${label}${extra ? '\n      ' + extra : ''}`); failures++; }
};
const inside = (n) => n.x >= 0 && n.x <= 100 && n.y >= 0 && n.y <= 100;
// Two cards are clear of each other when they are a card's width apart in x or a card's height apart in y (the layout's own gaps).
const apart = (a, b) => Math.abs(a.x - b.x) >= 14 || Math.abs(a.y - b.y) >= 12;
const allApart = (nodes) => nodes.every((a, i) => nodes.every((b, j) => i === j || apart(a, b)));
const grid = (roots, kids, extra = []) => normalizePack({ id: 'g', places: [].concat(...Array.from({ length: roots }, (_, r) => [{ id: `r${r}` }, ...Array.from({ length: kids }, (_, k) => ({ id: `r${r}k${k}`, parent: `r${r}` }))]), extra) }).pack;

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
    check('no two cards overlap', allApart(nodes));
    const lines = provinceLines(nodes);
    check('a line from the root to each district, curved', lines.length === 3 && lines.every(l => l.from === 'harbourside' && l.x1 === root.x && Number.isFinite(l.cx) && Number.isFinite(l.cy)));
    const skyNodes = layoutProvince(sky);
    const roots = skyNodes.filter(n => !n.parent);
    const market = skyNodes.find(n => n.id === 'low-market');
    const gilead = skyNodes.find(n => n.id === 'gilead');
    check('several roots share a ring, each district near its own root', roots.length === 3 && skyNodes.every(inside) && Math.hypot(market.x - gilead.x, market.y - gilead.y) < Math.hypot(market.x - roots[1].x, market.y - roots[1].y) && allApart(skyNodes), JSON.stringify(skyNodes.map(n => [n.id, Math.round(n.x), Math.round(n.y)])));
    // the crowded packs the review built: every card clear of every other, every card on the canvas
    for (const [r, k] of [[1, 12], [1, 20], [4, 1], [4, 2], [3, 4], [2, 5], [12, 0]]) {
        const n = layoutProvince(grid(r, k));
        check(`${r} root${r === 1 ? '' : 's'} with ${k} district${k === 1 ? '' : 's'} each: ${n.length} cards, none overlapping, all inside`, n.length === r * (k + 1) && allApart(n) && n.every(inside) && n.every(q => q.x >= 9 && q.x <= 91 && q.y >= 9 && q.y <= 91), JSON.stringify(n.map(q => [q.id, Math.round(q.x), Math.round(q.y)])));
    }
    const side = layoutProvince(grid(4, 1));
    const r1 = side.find(n => n.id === 'r1');
    const r1k = side.find(n => n.id === 'r1k0');
    check('a side root\'s district is not clamped onto its root', apart(r1, r1k) && Math.abs(r1k.x - r1.x) + Math.abs(r1k.y - r1.y) > 10);
    const fixed = normalizePack({ id: 'f', places: [{ id: 'a', x: 10, y: 95 }, { id: 'b', parent: 'a', x: 200, y: -4 }, { id: 'c', parent: 'a' }] }).pack;
    const fn = layoutProvince(fixed);
    check('a pack\'s own x/y is kept, clamped away from the edge; the rest laid out clear of them', fn.find(n => n.id === 'a').x === 10 && fn.find(n => n.id === 'a').y === 91 && fn.find(n => n.id === 'b').x === 91 && fn.find(n => n.id === 'b').y === 9 && inside(fn.find(n => n.id === 'c')) && allApart(fn));
    const deep = normalizePack({ id: 'd', places: [{ id: 'a' }, { id: 'b', parent: 'a' }, { id: 'c', parent: 'b', zoom: 1 }] }).pack;
    const deepNodes = layoutProvince(deep);
    check('a deeper place a pack\'s zoom pulls into the province sits beside its parent, clear of it', deepNodes.every(inside) && allApart(deepNodes) && deepNodes.find(n => n.id === 'c').parent === 'b' && Math.hypot(deepNodes.find(n => n.id === 'c').x - deepNodes.find(n => n.id === 'b').x, deepNodes.find(n => n.id === 'c').y - deepNodes.find(n => n.id === 'b').y) < 40);
    const misordered = normalizePack({ id: 'o', places: [{ id: 'a' }, { id: 'd', parent: 'c', zoom: 1 }, { id: 'c', parent: 'b', zoom: 1 }, { id: 'b', parent: 'a' }] }).pack;
    const mo = layoutProvince(misordered);
    check('a deeper place listed before its own parent still lands beside it, not in the corner', allApart(mo) && Math.hypot(mo.find(n => n.id === 'd').x - mo.find(n => n.id === 'c').x, mo.find(n => n.id === 'd').y - mo.find(n => n.id === 'c').y) < 40 && !(mo.find(n => n.id === 'd').x === 9 && mo.find(n => n.id === 'd').y === 9));
    const skipped = normalizePack({ id: 's', places: [{ id: 'prov', zoom: 0 }, { id: 'city', parent: 'prov', zoom: 1 }, { id: 'district', parent: 'city', zoom: 2 }, { id: 'tavern', parent: 'district', zoom: 1 }] }).pack;
    const sk = layoutProvince(skipped);
    check('a drawn place whose parent is not drawn hangs off its nearest drawn ancestor, with a line, not as a second root', sk.filter(n => !n.parent).length === 1 && sk.find(n => n.id === 'tavern').parent === 'city' && provinceLines(sk).some(l => l.from === 'city' && l.to === 'tavern') && Math.abs(sk.find(n => n.id === 'prov').x - 50) < 1);
    const top = normalizePack({ id: 't', places: [{ id: 'h' }, { id: 'docks', parent: 'h' }, { id: 'old', parent: 'h' }, { id: 'hill', parent: 'h' }, { id: 'customs', parent: 'docks', zoom: 1 }] }).pack;
    const tp = layoutProvince(top);
    check('a pulled-in child of the top district is not clamped back onto it', allApart(tp) && apart(tp.find(n => n.id === 'customs'), tp.find(n => n.id === 'docks')));
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

console.log('\n§4 zooming in (C2)');
{
    const s = seedWorldState(harbour);
    const town = buildProvinceView(harbour, s, { root: 'old-town' });
    check('zoomed into a district: it sits at the centre with its children around it, nothing else drawn', town.root === 'old-town' && town.nodes.map(n => n.id).sort().join() === 'old-town,the-anchor' && Math.abs(town.nodes.find(n => n.id === 'old-town').x - 50) < 1 && town.nodes.every(inside) && town.lines.length === 1);
    check('the trail leads from the province down to it', town.crumbs.map(c => c.label).join(' › ') === 'Harbourside › The old town' && provinceCrumbs(harbour, 'back-room').map(c => c.id).join('/') === 'harbourside/old-town/the-anchor/back-room' && provinceCrumbs(harbour, '').length === 0);
    check('a character deeper down stands on the child drawn; one outside the branch is elsewhere', town.nodes.find(n => n.id === 'the-anchor').tokens[0].name === 'Old Marit' && town.nodes.find(n => n.id === 'the-anchor').tokens[0].exact === true && town.elsewhere.join() === 'Captain Reyes' && town.unplaced.length === 0);
    check('each node says whether there is more inside', town.nodes.find(n => n.id === 'the-anchor').children === 1 && town.nodes.find(n => n.id === 'old-town').children === 1 && buildProvinceView(harbour, s).nodes.find(n => n.id === 'the-hill').children === 1);
    const room = buildProvinceView(harbour, s, { root: 'back-room' });
    check('the deepest place: itself alone, nobody elsewhere lost', room.nodes.length === 1 && room.nodes[0].children === 0 && room.elsewhere.join() === 'Captain Reyes,Old Marit' && room.lines.length === 0);
    check('a root the pack does not know falls back to the province; a label or a path works too', buildProvinceView(harbour, s, { root: 'atlantis' }).nodes.length === 4 && resolveRoot(harbour, 'The old town') === 'old-town' && resolveRoot(harbour, 'harbourside/old-town/the-anchor') === 'the-anchor' && resolveRoot(harbour, '') === '');
    const fixedPack = normalizePack({ id: 'f', places: [{ id: 'a' }, { id: 'b', parent: 'a', x: 5, y: 5 }, { id: 'c', parent: 'b' }] }).pack;
    check("a pack's x/y holds in the province but not when zoomed (the centre is the place looked into)", layoutProvince(fixedPack).find(n => n.id === 'b').x === 9 && Math.abs(layoutProvince(fixedPack, { root: 'b' }).find(n => n.id === 'b').x - 50) < 1);
}

console.log('\n§5 place images');
check('plain URLs pass, scripts and odd characters do not', safeImageUrl('https://x/y.png') === 'https://x/y.png' && safeImageUrl('/user/images/a.png') === '/user/images/a.png' && safeImageUrl('data:image/png;base64,AAA=') === 'data:image/png;base64,AAA=' && safeImageUrl('worldpacks/art/gilead.jpg') === 'worldpacks/art/gilead.jpg' && safeImageUrl('javascript:alert(1)') === '' && safeImageUrl('https://x/a b.png') === '' && safeImageUrl('x") url(javascript:1') === '' && safeImageUrl('') === '' && safeImageUrl('worldpacks/art\\gilead.jpg') === '' && safeImageUrl('worldpacks/art\\') === '');
check('a crowded province is marked dense', buildProvinceView(grid(1, 12), seedWorldState(grid(1, 12))).dense === true && buildProvinceView(harbour, seedWorldState(harbour)).dense === false);

console.log(`\n${failures === 0 ? 'All world map checks pass' : `${failures} FAILURE(S)`}`);
process.exit(failures === 0 ? 0 : 1);
