#!/usr/bin/env node
/**
 * World gen (docs/long-shot-plan.md D182–D185), pure: a world made from
 * a seed (land and sea in four shapes, mountains, lakes, forests), where
 * regions would stand on it, the land divided between the regions that
 * do, and how long the way is over its ground.
 *
 * Usage:  node tools/world-gen-test.mjs     (from the repo root)
 * Exit:   0 = pass, 1 = failure
 */
import {
    WORLD_SHAPES, WORLD_SIZES, WORLD_LIMITS, WORLD_KINDS, TERRAIN_PACE,
    normalizeWorldSpec, sizeOfWorld, randomSeed, worldSpecFor, generateWorld, suggestSites, divideWorld, travelField, roadCost,
} from '../src/utils/worldGen.js';

let failures = 0;
function check(name, cond, detail = '') {
    if (cond) console.log(`pass  ${name}`);
    else { failures++; console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ''}`); }
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const areaOf = (ring) => { let a = 0; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1]; return a / 2; };
const shapeArea = (parts) => parts.reduce((n, p) => n + p.reduce((m, ring) => m + areaOf(ring), 0), 0);    // holes count against (their area is below nothing)
const kindCells = (w, k) => { let n = 0; for (const c of w.grid.landCells) if (w.grid.kind[c] === k) n++; return n; };

console.log('\n§1 what is asked for');
{
    check('no seed, no world', normalizeWorldSpec(null) === null && normalizeWorldSpec({}) === null && normalizeWorldSpec({ seed: '   ' }) === null && generateWorld({ shape: 'pangea' }) === null);
    const s = normalizeWorldSpec({ seed: '  my   world ', shape: 'nonsense', size: 'large', cx: 'x', anchors: [{ x: 1, y: 2 }, null, { x: 'a', y: 1 }, { x: 3.123456, y: -4 }] });
    check('made safe: the seed tidied, an unknown shape is Pangea, the size by its name, junk anchors dropped', s.seed === 'my world' && s.shape === 'pangea' && s.w === WORLD_SIZES.large.w && s.h === WORLD_SIZES.large.h && s.cx === 0 && same(s.anchors, [{ x: 1, y: 2 }, { x: 3.1235, y: -4 }]), JSON.stringify(s));
    const wide = normalizeWorldSpec({ seed: 'a', w: 9999, h: 3 });
    check('a world is no wider or narrower than the limits, and a whole number of squares', wide.w === WORLD_LIMITS.maxW && wide.h === WORLD_LIMITS.minH && normalizeWorldSpec({ seed: 'a', w: 51.3, h: 33 }).w % 2 === 0);
    check('normalizing twice changes nothing', same(normalizeWorldSpec(s), s));
    check('the size is told by its name, or as custom', sizeOfWorld(normalizeWorldSpec({ seed: 'a', size: 'small' })) === 'small' && sizeOfWorld(s) === 'large' && sizeOfWorld(normalizeWorldSpec({ seed: 'a', w: 100, h: 70 })) === 'custom');
    let n = 0;
    const seed = randomSeed(() => ((n++ * 7) % 31) / 31);
    check('a seed nobody typed is six letters and digits', /^[a-z0-9]{6}$/.test(seed) && /^[a-z0-9]{6}$/.test(randomSeed()));
    const around = worldSpecFor({ seed: 'a', shape: 'divide', size: 'small', spots: [{ x: 100, y: 40 }, { x: 180, y: 60 }, { x: 130, y: 90 }] });
    check('a world made around what is placed: its middle on theirs, wide enough to hold them, land asked for under each', around.cx === 140 && around.cy === 65 && around.w >= 80 * 1.5 && around.h >= 50 * 1.5 && around.anchors.length === 3 && around.shape === 'divide', JSON.stringify(around));
    const bare = worldSpecFor({ seed: 'a', size: 'small' });
    check('with nothing placed: the size asked for, about the middle of the map', bare.w === WORLD_SIZES.small.w && bare.h === WORLD_SIZES.small.h && bare.cx === 0 && bare.cy === 0 && !bare.anchors.length);
}

console.log('\n§2 the geography');
const worlds = {};
for (const shape of WORLD_SHAPES) worlds[shape.id] = generateWorld({ seed: 'alpha', shape: shape.id, size: 'medium' });
{
    const w = worlds.pangea;
    check('the same asking gives the same world (and the one already made)', generateWorld({ seed: 'alpha', shape: 'pangea', size: 'medium' }) === w && same(generateWorld({ seed: 'alpha', shape: 'pangea', w: 64, h: 44, anchors: [] }).coasts, w.coasts));
    check('another seed gives another world', !same(generateWorld({ seed: 'beta', shape: 'pangea', size: 'medium' }).coasts, w.coasts));
    check('a world keeps to its bounds, about its middle', same(w.bounds, { minX: -32, minY: -22, maxX: 32, maxY: 22 }) && w.coasts.every(p => p[0].every(([x, y]) => x > -32 && x < 32 && y > -22 && y < 22)));
    for (const [id, world] of Object.entries(worlds)) {
        const share = world.landArea / (world.spec.w * world.spec.h);
        check(`${id}: there is land and there is sea (${Math.round(share * 100)}% land)`, share > 0.12 && share < 0.6);
        check(`${id}: the sea is all round it`, [[-31.9, -21.9], [31.9, 21.9], [0, -21.9], [-31.9, 0]].every(([x, y]) => world.kindAt(x, y) === 'sea') && world.kindAt(999, 999) === 'sea');
        check(`${id}: the coast is drawn round the land, to the grid's own count`, Math.abs(shapeArea(world.coasts) - world.landArea) < world.landArea * 0.04, `${shapeArea(world.coasts)} vs ${world.landArea}`);
        check(`${id}: no ring of the coast, a lake or a forest is a sliver or runs the wrong way`, [world.coasts, world.lakes, world.forests].every(list => list.every(p => p[0].length >= 4 && areaOf(p[0]) > 0 && p.slice(1).every(h => areaOf(h) < 0))));
    }
    check('Pangea is one great landmass (islets aside)', worlds.pangea.masses[0].area > worlds.pangea.landArea * 0.9);
    check('Like our world has several continents', worlds.earth.masses.filter(m => m.area > 60).length >= 3, JSON.stringify(worlds.earth.masses));
    check('Islands has many islands and no mainland', worlds.islands.masses.length >= 8 && worlds.islands.masses[0].area < worlds.islands.landArea * 0.45, JSON.stringify(worlds.islands.masses.map(m => m.area)));
    {
        const d = worlds.divide;
        const big = d.masses.filter(m => m.area > 150);
        let mid = 0;
        for (let y = -20; y <= 20; y += 0.5) if (d.kindAt(0, y) !== 'sea') mid++;
        check('Divide has two continents with a sea between them', big.length === 2 && Math.min(big[0].area, big[1].area) > Math.max(big[0].area, big[1].area) * 0.5 && mid <= 12 && d.kindAt(-16, 0) !== 'sea' && d.kindAt(16, 0) !== 'sea', `${JSON.stringify(big)} mid ${mid}`);
    }
    check('there are mountains, lakes and forests, each with ground of its own', w.ranges.length >= 2 && w.peaks.length >= 10 && w.lakes.length >= 1 && w.forests.length >= 1 && w.trees.length >= 20 && kindCells(w, WORLD_KINDS.mountain) > 40 && kindCells(w, WORLD_KINDS.lake) > 8 && kindCells(w, WORLD_KINDS.forest) > 100);
    check('a peak stands on land, the farthest drawn first', w.peaks.every(p => w.kindAt(p.x, p.y) !== 'sea' && w.kindAt(p.x, p.y) !== 'lake') && w.peaks.every((p, i) => i === 0 || p.y + p.s * 0.4 >= w.peaks[i - 1].y + w.peaks[i - 1].s * 0.4 - 1e-6));
    check('a tree stands in a forest', w.trees.every(t => w.kindAt(t.x, t.y) === 'forest'));
    check('a lake is water that is not the sea, inside the land', w.lakes.every(p => { const r = p[0]; const cx = r.reduce((n, q) => n + q[0], 0) / r.length, cy = r.reduce((n, q) => n + q[1], 0) / r.length; return w.kindAt(cx, cy) !== 'sea'; }) && Math.abs(shapeArea(w.lakes) - kindCells(w, WORLD_KINDS.lake) * 0.25) < kindCells(w, WORLD_KINDS.lake) * 0.25 * 0.35 + 1);
    check('isLand tells the ground a place can stand on: not the sea, not a lake', (() => { const g = w.grid; const lake = g.landCells.find(c => g.kind[c] === WORLD_KINDS.lake); const plain = g.landCells.find(c => g.kind[c] === WORLD_KINDS.plain); return !w.isLand(g.xOf(lake), g.yOf(lake)) && w.isLand(g.xOf(plain), g.yOf(plain)) && !w.isLand(-31.9, -21.9); })());
    const anchored = generateWorld({ seed: 'alpha', shape: 'divide', size: 'medium', anchors: [{ x: 0, y: 0 }, { x: 0.5, y: 14 }] });
    check('there is land under everything the world was made around, and no lake', worlds.divide.kindAt(0, 0) === 'sea' && anchored.isLand(0, 0) && anchored.isLand(0.5, 14));
    const far = generateWorld({ seed: 'alpha', shape: 'pangea', w: 64, h: 44, cx: 200, cy: -90 });
    check('a world about another middle is the same world, moved', far.bounds.minX === 168 && far.bounds.minY === -112 && far.landArea === w.landArea && far.kindAt(200, -90) === w.kindAt(0, 0));
    const t = Date.now();
    const big = generateWorld({ seed: 'timing', shape: 'earth', size: 'large' });
    check(`a large world is made in well under a second (${Date.now() - t} ms)`, big && Date.now() - t < 1500);
}

console.log('\n§3 where regions would stand');
{
    const w = worlds.pangea;
    const sites = suggestSites(w, 9);
    check('as many as asked for, each on land a place can stand on', sites.length === 9 && sites.every(s => w.isLand(s.x, s.y)), JSON.stringify(sites));
    check('the same world gives the same spots', same(suggestSites(w, 9), sites));
    const gaps = sites.map((s, i) => Math.min(...sites.filter((_, j) => j !== i).map(o => Math.hypot(o.x - s.x, o.y - s.y))));
    check(`they are spread out: none within ${Math.round(Math.min(...gaps))} units of another`, Math.min(...gaps) >= 5, JSON.stringify(gaps.map(Math.round)));
    check('none asked for, none given; and no more than the land has room for', suggestSites(w, 0).length === 0 && suggestSites(null, 5).length === 0 && suggestSites(generateWorld({ seed: 'alpha', shape: 'islands', size: 'small' }), 24).length <= 24);
    const taken = [{ x: sites[0].x, y: sites[0].y }, { x: sites[1].x, y: sites[1].y }];
    const more = suggestSites(w, 4, taken);
    check('with regions already there, the new ones keep clear of them', more.length === 4 && more.every(s => taken.every(t => Math.hypot(t.x - s.x, t.y - s.y) >= 5)), JSON.stringify(more));
    const isl = worlds.islands;
    const spots = suggestSites(isl, 9);
    const masses = new Set(spots.map(s => isl.grid.mass[isl.grid.cellOf(s.x, s.y)]));
    check('on islands the regions are shared out: most stand on an island of their own', masses.size >= 6, `${masses.size} islands for ${spots.length} regions`);
}

console.log('\n§4 the land divided');
{
    const w = worlds.pangea;
    const sites = suggestSites(w, 9).map((s, i) => ({ id: `r${i}`, ...s }));
    const div = divideWorld(w, sites);
    const lands = [...div.lands.values()];
    check('every region holds a land', lands.length === 9 && lands.every(l => l.outline.length >= 8 && l.parts[0][0] === l.outline && l.area > 20));
    check('the lands tile the land with nothing left over', Math.abs(lands.reduce((n, l) => n + l.area, 0) - w.landArea) < 1e-6 && Math.abs(lands.reduce((n, l) => n + shapeArea(l.parts), 0) - shapeArea(w.coasts)) < 0.5, `${lands.reduce((n, l) => n + shapeArea(l.parts), 0)} vs ${shapeArea(w.coasts)}`);
    check('a region\'s spot is on its own land', sites.every(s => div.at(s.x, s.y) === s.id));
    check('the sea is nobody\'s', div.at(-31, -21) === '' && div.at(999, 0) === '');
    check('who borders whom is told both ways, with the line they share', lands.every(l => l.neighbours.length >= 1 && l.neighbours.every(id => div.lands.get(id).neighbours.includes(l.id)) && l.borders.length === l.neighbours.length && l.borders.every(b => b.points.length >= 2)));
    {
        const a = lands[0], b = div.lands.get(a.neighbours[0]);
        const ab = a.borders.find(x => x.id === b.id).points, ba = b.borders.find(x => x.id === a.id).points;
        const key = (p) => p.join(',');
        const onA = new Set(a.parts.flat(2).map(key)), onB = new Set(b.parts.flat(2).map(key));
        check('two lands that share a border share its very points', same(ab, ba.slice().reverse()) && ab.every(p => onA.has(key(p)) && onB.has(key(p))));
    }
    check('the same regions give the same lands (and the division already made)', divideWorld(w, sites) === div && same([...divideWorld(w, sites.map(s => ({ ...s }))).lands.values()].map(l => l.outline), lands.map(l => l.outline)));
    check('each land is told in words, and has a plain name of its own to stand in', lands.every(l => /^(on the coast|landlocked), in the \w+ of the world: /.test(l.summary) && l.name.length > 3) && new Set(lands.map(l => l.name)).size === lands.length, JSON.stringify(lands.map(l => `${l.name} | ${l.summary}`)));
    check('a land\'s terrain is one the map knows', lands.every(l => ['plains', 'forest', 'mountains', 'coast'].includes(l.terrain)));

    // The geography stays; the borders follow the regions.
    const fewer = divideWorld(w, sites.slice(0, 8));
    check('a region taken away: its neighbours take its land, and the land is still all held', fewer.lands.size === 8 && Math.abs([...fewer.lands.values()].reduce((n, l) => n + l.area, 0) - w.landArea) < 1e-6);
    const moved = sites.map((s, i) => (i === 0 ? { ...s, x: s.x + 1.5 } : s));
    const after = divideWorld(w, moved);
    check('a region moved: its land moves with it, a land far from it stays as it was', !same(after.lands.get('r0').outline, div.lands.get('r0').outline) && lands.some(l => l.id !== 'r0' && !div.lands.get('r0').neighbours.includes(l.id) && same(after.lands.get(l.id).outline, l.outline)));
    const one = divideWorld(w, [sites[0]]);
    check('one region alone holds the whole landmass it stands on', one.lands.size === 1 && one.lands.get('r0').area >= w.masses[0].area - 1e-6);
    check('no regions, no lands; a region out at sea holds nothing; two on one spot, the first holds it', divideWorld(w, []).lands.size === 0 && divideWorld(w, [{ id: 'sea', x: -31, y: -21 }]).lands.size === 0 && (() => { const d = divideWorld(w, [{ id: 'a', x: sites[0].x, y: sites[0].y }, { id: 'b', x: sites[0].x, y: sites[0].y }]); return d.lands.size === 1 && d.lands.has('a'); })());
    {
        const g = w.grid;
        // A region dropped just off the shore still takes the land beside it.
        let shoreSea = null;
        for (let k = 0; k < g.N && !shoreSea; k++) { if (g.land[k]) continue; const i = k % g.cols, j = (k - i) / g.cols; if (g.inGrid(i + 1, j) && g.land[g.idx(i + 1, j)]) shoreSea = { x: g.xOf(k), y: g.yOf(k) }; }
        check('a region put down a step off the shore takes the land beside it', divideWorld(w, [{ id: 'near', ...shoreSea }]).lands.size === 1);
    }
    // Borders tend to run along the ranges: of the squares beside a border, more are mountain than of the land as a whole.
    {
        const g = w.grid;
        let edge = 0, edgeM = 0;
        for (const c of g.landCells) {
            const i = c % g.cols, j = (c - i) / g.cols;
            const me = div.at(g.xOf(c), g.yOf(c));
            if (![[1, 0], [0, 1], [-1, 0], [0, -1]].some(([di, dj]) => { const o = g.inGrid(i + di, j + dj) ? div.at(g.xOf(g.idx(i + di, j + dj)), g.yOf(g.idx(i + di, j + dj))) : ''; return o && o !== me; })) continue;
            edge++;
            if (g.kind[c] === WORLD_KINDS.mountain) edgeM++;
        }
        const all = kindCells(w, WORLD_KINDS.mountain) / g.landCells.length;
        check(`borders tend to run along the mountains (${Math.round(edgeM / edge * 100)}% of the ground beside a border is mountain, ${Math.round(all * 100)}% of all the land)`, edgeM / edge > all * 1.5);
    }
    // Islands: a landmass no region stands on goes whole to one region, or is nobody's.
    {
        const isl = worlds.islands;
        const few = suggestSites(isl, 3).map((s, i) => ({ id: `i${i}`, ...s }));
        const d = divideWorld(isl, few);
        const g = isl.grid;
        const owners = new Map();
        for (const c of g.landCells) { const m = g.mass[c]; if (!owners.has(m)) owners.set(m, new Set()); owners.get(m).add(d.at(g.xOf(c), g.yOf(c))); }
        const homes = new Set(few.map(s => g.mass[g.cellOf(s.x, s.y)]));
        check('an island no region stands on is never cut up between regions', [...owners].every(([m, set]) => homes.has(m) || set.size === 1), JSON.stringify([...owners].map(([m, set]) => [m, [...set]])));
        check('a region holds the islands near it as parts of its land', [...d.lands.values()].some(l => l.parts.length > 1));
    }
}

console.log('\n§5 how long the way is');
{
    const w = worlds.divide;
    const g = w.grid;
    const pick = (test) => { const c = g.landCells.find(test); return { x: g.xOf(c), y: g.yOf(c) }; };
    const kindOf = (c) => g.kind[c];
    // Two points on open ground on the west continent, a few units apart with nothing but plain between them.
    let a = null, b = null;
    for (const c of g.landCells) {
        if (a) break;
        const i = c % g.cols, j = (c - i) / g.cols;
        let clear = true;
        for (let d = 0; d <= 12 && clear; d++) if (!g.inGrid(i + d, j) || kindOf(g.idx(i + d, j)) !== WORLD_KINDS.plain) clear = false;
        if (clear) { a = { x: g.xOf(c), y: g.yOf(c) }; b = { x: g.xOf(c) + 6, y: g.yOf(c) }; }
    }
    const f = travelField(w, a);
    const flat = f.to(b.x, b.y);
    check('over open ground the way is the straight line, at its own length', a && Math.abs(flat.length - 6) < 0.01 && Math.abs(flat.cost - 6) < 0.01 && flat.water === 0 && flat.mountain === 0, JSON.stringify(flat));
    check('the way there is as long as the way back', Math.abs(travelField(w, b).to(a.x, a.y).cost - flat.cost) < 1e-6);
    check('to where one stands is no way at all', f.to(a.x, a.y).cost === 0 && f.to(a.x, a.y).length === 0);
    const slant = f.to(a.x + 3, a.y + 0.5);
    check('a slanting way is not made longer by the grid\'s squares', Math.abs(slant.cost - Math.hypot(3, 0.5)) < 0.25, JSON.stringify(slant));

    // Across the sea between the continents.
    const west = pick(c => g.xOf(c) < -8 && g.shore[c] >= 4 && kindOf(c) === WORLD_KINDS.plain);
    const east = pick(c => g.xOf(c) > 8 && g.shore[c] >= 4 && kindOf(c) === WORLD_KINDS.plain);
    const free = travelField(w, west).to(east.x, east.y);
    const dear = travelField(w, west, { embark: 6 }).to(east.x, east.y);
    check('between the continents the way is by sea', free.water > 3 && free.water < free.length);
    check('a boat is quicker under way than walking', free.cost < free.length);
    check('taking ship costs its wait, once for the whole crossing', Math.abs(dear.cost - free.cost - 6) < 0.5, `${dear.cost} vs ${free.cost}`);

    // Round a lake rather than over it, when the wait for a boat is long.
    const p = worlds.pangea, pg = p.grid;
    let lakeRow = null;
    for (const c of pg.landCells) {
        if (lakeRow) break;
        if (pg.kind[c] !== WORLD_KINDS.lake) continue;
        const i = c % pg.cols, j = (c - i) / pg.cols;
        let l = i, r = i;
        while (pg.kind[pg.idx(l - 1, j)] === WORLD_KINDS.lake) l--;
        while (pg.kind[pg.idx(r + 1, j)] === WORLD_KINDS.lake) r++;
        if (r - l >= 3 && pg.kind[pg.idx(l - 2, j)] !== WORLD_KINDS.lake && pg.land[pg.idx(l - 2, j)] && pg.land[pg.idx(r + 2, j)] && pg.kind[pg.idx(r + 2, j)] !== WORLD_KINDS.lake) lakeRow = { from: { x: pg.xOf(pg.idx(l - 2, j)), y: pg.yOf(c) }, to: { x: pg.xOf(pg.idx(r + 2, j)), y: pg.yOf(c) } };
    }
    const round = travelField(p, lakeRow.from, { embark: 20 }).to(lakeRow.to.x, lakeRow.to.y);
    const over = travelField(p, lakeRow.from, { embark: 0 }).to(lakeRow.to.x, lakeRow.to.y);
    check('a lake is gone round when a boat is a long wait, and crossed when it is none', lakeRow && round.water === 0 && round.length > Math.hypot(lakeRow.to.x - lakeRow.from.x, lakeRow.to.y - lakeRow.from.y) && over.water > 0, `${JSON.stringify(round)} ${JSON.stringify(over)}`);

    // Mountains.
    const range = p.ranges[0];
    const m0 = { x: range[Math.floor(range.length / 2)][0], y: range[Math.floor(range.length / 2)][1] };
    let across = null;
    for (const [dx, dy] of [[1, 0], [0, 1], [0.7, 0.7], [0.7, -0.7]]) {
        const s = { x: m0.x - dx * 3, y: m0.y - dy * 3 }, e = { x: m0.x + dx * 3, y: m0.y + dy * 3 };
        if (p.isLand(s.x, s.y) && p.isLand(e.x, e.y) && p.kindAt(s.x, s.y) !== 'mountain' && p.kindAt(e.x, e.y) !== 'mountain') { across = { s, e }; break; }
    }
    const hard = across ? travelField(p, across.s).to(across.e.x, across.e.y) : null;
    check('over or round a range takes longer than the same way over open ground', across && hard.cost > 6 * 1.15, JSON.stringify(hard));
    check(`mountains are ${TERRAIN_PACE.mountain} times as slow, forest ${TERRAIN_PACE.forest}, a boat ${TERRAIN_PACE.water}`, TERRAIN_PACE.mountain > TERRAIN_PACE.forest && TERRAIN_PACE.forest > 1 && TERRAIN_PACE.water < 1);
    check('off the world there is no way', travelField(p, { x: 999, y: 0 }).to(0, 0) === null && travelField(p, a).to(999, 0) === null && travelField(null, a).to(0, 0) === null);

    // Roads.
    const road = roadCost(w, a, b);
    check('a road over open ground is its own length', Math.abs(road.cost - 6) < 1e-6 && road.length === 6 && road.water === 0);
    const lane = roadCost(w, west, east, { embark: 6 });
    check('a road over the sea is a crossing: quicker under way, with the wait to take ship', lane.water > 3 && Math.abs(lane.cost - (lane.length - lane.water) - lane.water * 0.5 - 6) < 1.6, JSON.stringify(lane));
    check('a road over the mountains is a pass: slower than a road, quicker than no road', across && (() => { const r = roadCost(p, across.s, across.e); return r.mountain > 0 && r.cost > r.length && r.cost < r.length - r.mountain + r.mountain * TERRAIN_PACE.mountain; })());
    check('with no world a road is its drawn length', roadCost(null, { x: 0, y: 0 }, { x: 3, y: 4 }).cost === 5);
}

console.log(failures ? `\n${failures} failure(s)` : '\nall pass');
process.exit(failures ? 1 : 0);
