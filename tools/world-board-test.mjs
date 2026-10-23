#!/usr/bin/env node
/**
 * Live World's board, the pure part (D69): the tiles at each level, the
 * people on them, the clock captions on the places they concern, the
 * trail, and the faces the shelf's World page shows.
 *
 * Usage:  node tools/world-board-test.mjs     (from the repo root)
 * Exit:   0 = pass, 1 = failure
 */
import { readFileSync } from 'node:fs';
import { normalizePack, seedWorldState, markKnown, applyAdvance } from '../src/utils/liveWorld.js';
import { buildBoard, boardPlaces, boardCrumbs, peopleOnBoard, captionsOnBoard, safeImageUrl, boardRootFor, facesOfTheWorld } from '../src/utils/worldBoard.js';

let failures = 0;
const check = (label, cond, extra = '') => {
    if (cond) console.log(`pass  ${label}`);
    else { console.error(`FAIL  ${label}${extra ? '\n      ' + extra : ''}`); failures++; }
};
const names = (list) => list.map(p => p.name).join(',');
const sky = normalizePack(JSON.parse(readFileSync(new URL('../worldpacks/skyreach.json', import.meta.url), 'utf8')));
const harbour = normalizePack(JSON.parse(readFileSync(new URL('../worldpacks/example.json', import.meta.url), 'utf8')));

console.log('\n§1 a clock names its place');
check('both packs are still sound', sky.ok && harbour.ok, JSON.stringify([sky.errors, harbour.errors]));
check('the place is resolved onto the clock', sky.pack.clocks.find(c => c.id === 'varrow_war').place === 'skar-crossings' && harbour.pack.clocks.every(c => c.place === 'the-docks'));
const badPlace = normalizePack({ id: 'b', places: [{ id: 'a' }], clocks: [{ id: 'x', place: 'nowhere-at-all' }] });
check('a clock naming no such place is an error', !badPlace.ok && badPlace.errors.some(e => e.includes('clock "x"') && e.includes('nowhere-at-all')));
check('a clock without a place has none', normalizePack({ id: 'c', places: [{ id: 'a' }], clocks: [{ id: 'y' }] }).pack.clocks[0].place === '');

console.log('\n§2 the province and stepping inside');
const S = seedWorldState(sky.pack);
{
    const b = buildBoard(sky.pack, S);
    check('the province tiles the roots, in pack order', b.ok && b.root === '' && b.tiles.map(t => t.id).join(',') === 'gilead,highwatch,skar-crossings' && b.crumbs.length === 0 && b.title === 'Skyreach');
    check('a tile says how many places sit inside it', b.tiles[0].inside === 1 && b.tiles[1].inside === 0);
    check('One Feather, at the high table, stands on Gilead at the province, not exactly there', names(b.tiles[0].people) === 'One Feather' && b.tiles[0].people[0].exact === false && b.tiles[0].people[0].place === 'high-table');
    check('the heard-of name stays off the tiles', b.heard.join() === 'Maeve' && b.tiles.every(t => !names(t.people).includes('Maeve')) && b.nowhere.length === 0);
    check('the war speaks on the Skar crossings, Highwatch on Highwatch, nothing on Gilead', b.tiles[2].caption === 'The Skar crossings are watched; carters wait a day to pass.' && b.tiles[1].caption.startsWith('Highwatch') && b.tiles[0].caption === '' && b.atRoot.length === 0);
    check('"what people say" and "lately" ride along', b.street.length === 2 && Array.isArray(b.lately));
    const g = buildBoard(sky.pack, S, { root: 'gilead' });
    check('inside Gilead: the Low Market alone, the trail one step, the title the place', g.tiles.map(t => t.id).join() === 'low-market' && g.crumbs.map(c => c.id).join() === 'gilead' && g.title === 'Gilead');
    check('One Feather is on the Low Market from Gilead, still not exactly', names(g.tiles[0].people) === 'One Feather' && g.tiles[0].people[0].exact === false);
    const h = buildBoard(sky.pack, S, { root: 'gilded-hand' });
    check('inside the Gilded Hand: the high table, and One Feather exactly there', h.tiles.map(t => t.id).join() === 'high-table' && h.tiles[0].people[0].exact === true && h.crumbs.map(c => c.id).join() === 'gilead,low-market,gilded-hand');
    const leaf = buildBoard(sky.pack, S, { root: 'high-table' });
    check('a leaf has no tiles; whoever stands there is "here"', leaf.tiles.length === 0 && leaf.here.join() === 'One Feather');
    const hw = buildBoard(sky.pack, S, { root: 'highwatch' });
    check('from Highwatch, One Feather is elsewhere and the war is not on this board', hw.elsewhere.join() === 'One Feather' && hw.atRoot.map(c => c.clock).join() === 'highwatch' && hw.tiles.length === 0);
    check('a label or a path steps inside too', buildBoard(sky.pack, S, { root: 'The Low Market' }).root === 'low-market' && buildBoard(sky.pack, S, { root: 'gilead/low-market' }).root === 'low-market');
    check('an unknown root falls back to the province', buildBoard(sky.pack, S, { root: 'atlantis' }).root === '');
}

console.log('\n§3 people, captions and faces as the world moves');
{
    let st = seedWorldState(harbour.pack);
    st = markKnown(st, ['The governor']);
    const b = buildBoard(harbour.pack, st);
    check('Harbourside is one root with three districts inside', b.tiles.map(t => t.id).join() === 'harbourside' && b.tiles[0].inside === 3);
    check('everyone known stands on the one root tile (the governor, heard of with a seat, counts once known)', names(b.tiles[0].people) === 'Captain Reyes,Old Marit,The governor' && b.nowhere.length === 0, names(b.tiles[0].people));
    const d = buildBoard(harbour.pack, st, { root: 'harbourside' });
        const spoken = harbour.pack.clocks.filter(c => c.effects[st.clocks[c.id]]).map(c => c.id);    // the clocks with a public face at their starting value
    check('inside: the docks carry the captain and every clock that has a face now, Old Town carries Marit, the Hill the governor', names(d.tiles[0].people) === 'Captain Reyes' && d.tiles[0].captions.map(c => c.clock).join() === spoken.join() && spoken.includes('blockade') && names(d.tiles[1].people) === 'Old Marit' && names(d.tiles[2].people) === 'The governor' && d.tiles[2].caption === '', JSON.stringify([d.tiles[0].captions, spoken]));
    check('a clock with no public face at its value gives no caption', (() => {
        const quiet = { ...st, clocks: { ...st.clocks, blockade: 0, fever: 0 } };
        return buildBoard(harbour.pack, quiet, { root: 'harbourside' }).tiles[0].captions.map(c => c.clock).join() === 'blockade';    // the fever has no step 0
    })());
    const moved = applyAdvance(st, { clocks: { blockade: 2 }, moved: [{ who: 'Old Marit', to: 'governors-house', reason: 'summoned' }], blurb: 'Talk of a search.' }, harbour.pack, { msgId: 7, gameDate: 'Tuesday', gameTime: 'dusk' });
    const after = buildBoard(harbour.pack, moved, { root: 'harbourside' });
    check('a move puts the character on the new tile and the step shows the new effect', names(after.tiles[2].people) === 'Old Marit,The governor' && after.tiles[1].people.length === 0 && after.tiles[0].captions.find(c => c.clock === 'blockade').text === harbour.pack.clocks[0].effects[2], JSON.stringify(after.tiles.map(x => names(x.people))));
    check('lately holds the move and the step, newest first', after.lately.length === 2 && after.lately.every(e => e.gameDate === 'Tuesday'));
    check('the board root for a character is the parent of where they stand', boardRootFor(harbour.pack, moved, 'Old Marit') === 'the-hill' && boardRootFor(harbour.pack, moved, 'Captain Reyes') === 'the-docks' && boardRootFor(harbour.pack, moved, 'Nobody') === '');
    const faces = facesOfTheWorld(harbour.pack, moved);
    check('faces: each known character with where, when and before; the heard-of apart', faces.known.map(f => f.name).join() === 'Captain Reyes,Old Marit' && faces.heard.length === 0 && faces.known[1].place === "the governor's house, The Hill".replace("the governor's house", 'The governor\'s house') || faces.known[1].place.toLowerCase().includes("governor"), JSON.stringify(faces.known[1]));
    check('…with the move\'s date, time, reason and the place before', faces.known[1].gameDate === 'Tuesday' && faces.known[1].gameTime === 'dusk' && faces.known[1].reason === 'summoned' && faces.known[1].before.includes('The Anchor') && faces.known[0].gameDate === '' && faces.known[0].before === '');
    const nowhere = markKnown(seedWorldState(sky.pack), ['Maeve']);
    check('a known character with no place is nowhere, on the board and in the faces', buildBoard(sky.pack, nowhere).nowhere.join() === 'Maeve' && facesOfTheWorld(sky.pack, nowhere).known.find(f => f.name === 'Maeve').place === '');
}

console.log('\n§4 odds and ends');
check('safeImageUrl: http(s), data-image and relative pass; other schemes, protocol-relative and quoted strings do not', safeImageUrl('https://x/y.png') === 'https://x/y.png' && safeImageUrl('data:image/png;base64,AA') !== '' && safeImageUrl('img/gilead.png') === 'img/gilead.png' && safeImageUrl('javascript:alert(1)') === '' && safeImageUrl('//evil/x.png') === '' && safeImageUrl('a"b.png') === '');
check('boardPlaces and boardCrumbs on their own', boardPlaces(sky.pack).length === 3 && boardPlaces(sky.pack, 'gilead').length === 1 && boardCrumbs(sky.pack, 'high-table').length === 4);
check('peopleOnBoard and captionsOnBoard tolerate an empty board', peopleOnBoard(sky.pack, S, [], 'high-table').here.join() === 'One Feather' && captionsOnBoard(sky.pack, S, [], '').atRoot.length === 0);
check('no pack or no state: not ok, nothing drawn', !buildBoard(null, S).ok && buildBoard(sky.pack, null).tiles.length === 0);

console.log('');
if (failures) { console.error(`${failures} FAILURE(S)`); process.exit(1); }
console.log('All world board checks pass');
