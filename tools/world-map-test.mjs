#!/usr/bin/env node
/**
 * The Map window's pure model (docs/map-window-plan.md): where a location
 * line points, the visits newest first, the rewind, the row with its
 * pictures, a character's place in the row, the description request, the
 * travel instruction, the completed quests.
 *
 * Usage:  node tools/world-map-test.mjs     (from the repo root)
 * Exit:   0 = pass, 1 = failure
 */
import { readFileSync } from 'node:fs';
import { normalizePack, seedWorldState, normalizeWorldState, applyAdvance, MAX_VISITED, VISITS_KEEP } from '../src/utils/liveWorld.js';
import { placeKeyFor, visitPlace, reconcileVisited, currentPlace, placesRow, rowIdForCharacter, buildPlacePrompt, buildTravelInstruction, normalizeDone, addDone, MAX_DONE } from '../src/utils/worldMap.js';

let failures = 0;
const check = (label, cond, extra = '') => {
    if (cond) console.log(`pass  ${label}`);
    else { console.error(`FAIL  ${label}${extra ? '\n      ' + extra : ''}`); failures++; }
};
const sky = normalizePack(JSON.parse(readFileSync(new URL('../worldpacks/skyreach.json', import.meta.url), 'utf8'))).pack;
const harbour = normalizePack(JSON.parse(readFileSync(new URL('../worldpacks/example.json', import.meta.url), 'utf8'))).pack;
const ids = (s) => s.visited.map(e => e.id).join(',');

console.log('\n§1 where a location line points');
const k1 = placeKeyFor(sky, 'A stall in the Low Market, Gilead');
check('a pack place, the deepest named, with its label, path and parent line', k1 && k1.id === 'low-market' && k1.packId === 'low-market' && k1.path === 'gilead/low-market' && k1.parent === 'Gilead' && /low market/i.test(k1.label), JSON.stringify(k1));
const k2 = placeKeyFor(sky, 'The Rusty Anchor, back room');
check('a place the pack does not name is its own, keyed by a slug under loc:', k2 && k2.id === 'loc:the-rusty-anchor-back-room' && k2.label === 'The Rusty Anchor, back room' && k2.packId === '' && k2.parent === '');
check('nothing, and no pack', placeKeyFor(sky, '   ') === null && placeKeyFor(null, 'Somewhere').id === 'loc:somewhere');

console.log('\n§2 visits, newest first');
let S = seedWorldState(sky);
check('a seeded state has visited nothing', Array.isArray(S.visited) && S.visited.length === 0);
let r = visitPlace(S, sky, { location: 'Gilead', msgId: 'm1', gameDate: 'Monday', gameTime: 'dawn' });
check('the first visit adds the place in front, with the reply and the date', r.changed && r.added && r.id === 'gilead' && ids(r.state) === 'gilead' && r.state.visited[0].visits.join() === 'm1' && r.state.visited[0].firstDate === 'Monday' && r.state.visited[0].lastTime === 'dawn');
S = r.state;
r = visitPlace(S, sky, { location: 'Gilead', msgId: 'm1', gameDate: 'Monday', gameTime: 'dawn' });
check('the same reply again changes nothing (the same state back)', !r.changed && r.state === S);
r = visitPlace(S, sky, { location: 'The Low Market', msgId: 'm2', gameDate: 'Monday', gameTime: 'noon' });
S = r.state;
r = visitPlace(S, sky, { location: 'The Rusty Anchor', msgId: 'm3', gameDate: 'Tuesday' });
S = r.state;
check('newest first: the Anchor, the Low Market, Gilead', ids(S) === 'loc:the-rusty-anchor,low-market,gilead' && currentPlace(S).id === 'loc:the-rusty-anchor');
r = visitPlace(S, sky, { location: 'Back to Gilead', msgId: 'm4', gameDate: 'Wednesday' });
S = r.state;
check('a place seen before moves to the front with the new reply and date, counted once', r.changed && !r.added && ids(S) === 'gilead,loc:the-rusty-anchor,low-market' && S.visited[0].visits.join() === 'm1,m4' && S.visited[0].lastDate === 'Wednesday' && S.visited[0].firstDate === 'Monday');
{
    let many = seedWorldState(sky);
    for (let i = 0; i < MAX_VISITED + 5; i++) many = visitPlace(many, sky, { location: `Place number ${i}`, msgId: `p${i}` }).state;
    check(`the row keeps ${MAX_VISITED} places, the newest`, many.visited.length === MAX_VISITED && many.visited[0].id === `loc:place-number-${MAX_VISITED + 4}`);
    let busy = seedWorldState(sky);
    for (let i = 0; i < VISITS_KEEP + 3; i++) busy = visitPlace(busy, sky, { location: 'Gilead', msgId: `g${i}` }).state;
    check(`a place keeps its last ${VISITS_KEEP} replies`, busy.visited[0].visits.length === VISITS_KEEP && busy.visited[0].visits[0] === 'g3');
}
check('a stored state is normalised: bad entries out, one per id, the fields trimmed', (() => {
    const n = normalizeWorldState({ seeded: true, visited: [{ id: 'a', label: '  A  place ', visits: ['x', 7, null, ''], image: ' u.png ' }, { id: 'a' }, null, { label: 'no id' }] });
    return n.visited.length === 1 && n.visited[0].label === 'A place' && n.visited[0].visits.join() === 'x,7' && n.visited[0].image === 'u.png' && n.visited[0].prompt === '';
})());

console.log('\n§3 the rewind');
{
    const gone = reconcileVisited(S, ['m1', 'm2']);    // m3 (the Anchor) and m4 (Gilead again) are gone
    check('visits whose replies are gone leave; a place with none left and no picture leaves the row', gone.pruned === 2 && gone.dropped === 1 && ids(gone.state) === 'gilead,low-market' && gone.state.visited[0].visits.join() === 'm1');
    const withArt = { ...S, visited: S.visited.map(e => e.id === 'loc:the-rusty-anchor' ? { ...e, image: '/user/images/x/anchor.png' } : e) };
    const kept = reconcileVisited(withArt, ['m1', 'm2']);
    check('a place with a picture sinks to the end instead, and is not where the party is', kept.dropped === 0 && ids(kept.state) === 'gilead,low-market,loc:the-rusty-anchor' && kept.state.visited[2].visits.length === 0 && currentPlace(kept.state).id === 'gilead');
    check('nothing gone: the same state back', reconcileVisited(S, ['m1', 'm2', 'm3', 'm4']).state === S);
}

console.log('\n§4 the row');
{
    const art = { ...sky, places: sky.places.map(p => p.id === 'gilead' ? { ...p, image: 'img/gilead.png' } : p) };
    let st = visitPlace(seedWorldState(art), art, { location: 'the Gilded Hand', msgId: 'a1', gameDate: 'Monday' }).state;
    st = visitPlace(st, art, { location: 'Gilead', msgId: 'a2', gameDate: 'Tuesday', gameTime: 'dusk' }).state;
    st = visitPlace(st, art, { location: 'A nameless road', msgId: 'a3' }).state;
    st.visited[2].image = 'data:image/png;base64,AA';
    const row = placesRow(st, art);
    check('newest first; the party is at the first', row.map(x => x.id).join() === 'loc:a-nameless-road,gilead,gilded-hand' && row[0].here && !row[1].here);
    check('the pack\'s art fills a place that has it; a drawn picture is marked drawn; the rest have none', row[1].image === 'img/gilead.png' && !row[1].drawn && row[2].image.startsWith('data:image/') && row[2].drawn && row[0].image === '');
    check('the parent line for a nested pack place, the dates of the last visit', row[2].parent === 'the Low Market, Gilead'.replace('the Low Market', sky.places.find(p => p.id === 'low-market').label) && row[1].lastDate === 'Tuesday' && row[1].lastTime === 'dusk' && row[0].visits === 1, JSON.stringify(row[2]));
    const unsafe = { ...st, visited: st.visited.map(e => ({ ...e, image: 'javascript:alert(1)' })) };
    check('an unsafe picture URL is dropped', placesRow(unsafe, art).every(x => x.image === '' || x.image === 'img/gilead.png'));
    check('no state, no row', placesRow(null, art).length === 0);
}

console.log('\n§5 a character\'s place in the row');
{
    let st = seedWorldState(sky);    // One Feather stands at the high table
    check('not in the row yet', rowIdForCharacter(st, sky, 'One Feather') === '');
    st = visitPlace(st, sky, { location: 'the Gilded Hand', msgId: 'b1' }).state;
    check('the nearest visited place above them', rowIdForCharacter(st, sky, 'One Feather') === 'gilded-hand');
    st = visitPlace(st, sky, { location: 'the high table', msgId: 'b2' }).state;
    check('their own place once it is in the row; nobody is nowhere', rowIdForCharacter(st, sky, 'One Feather') === 'high-table' && rowIdForCharacter(st, sky, 'Nobody') === '');
}

console.log('\n§6 the description request and the travel instruction');
{
    const p = buildPlacePrompt({ place: { label: 'The Rusty Anchor', parent: 'the docks, Harbourside' }, recent: 'Jordan: We push into the Anchor.\nMara: The place smells of tar.', world: 'Harbourside', size: 'landscape' });
    check('the system names the place and the world, asks for 2 to 4 sentences in a wide frame, no names, no story', /The Rusty Anchor, in Harbourside/.test(p.system) && /2 to 4 sentences/.test(p.system) && /a wide frame/.test(p.system) && /Never a character's name/.test(p.system));
    check('the user carries the place, its parent and the scenes', /The place: The Rusty Anchor, part of the docks, Harbourside\./.test(p.user) && /Scenes at or near it:\nJordan: We push/.test(p.user));
    check('no scenes: say so', /No scene text is at hand/.test(buildPlacePrompt({ place: { label: 'X' } }).user));
    const t = buildTravelInstruction({ place: { label: 'Highwatch' }, userName: 'Jordan', facts: { date: 'Monday', time: 'dusk', location: 'Gilead' } });
    check('the travel instruction: the road from now, the arrival, the first move the player\'s, the tracker moved', t.startsWith('[TRAVEL: Jordan has chosen to travel to Highwatch.') && /the road from now \(Monday, dusk, at Gilead\) to Highwatch/.test(t) && /open on the arrival: Highwatch as Jordan finds it/.test(t) && /first move still Jordan's/.test(t) && /location moved to the arrival at Highwatch/.test(t) && /hours or days, whatever it plausibly takes/.test(t));
    const w = buildTravelInstruction({ place: 'Highwatch', when: 'by nightfall.', userName: 'Jordan' });
    check('an arrival time replaces the judgement; a bare name works; brackets and quotes are tamed', / Jordan arrives by nightfall\./.test(w) && !/plausibly/.test(w) && buildTravelInstruction({ place: 'The ["Anchor"]' }).includes('The “Anchor”') && buildTravelInstruction({ place: '' }) === '');
}

console.log('\n§7 the completed quests');
{
    const a = addDone([], 'Find the warden', { at: 5, gameDate: 'Monday' });
    const b = addDone(a.list, 'Feed the cat', { at: 6 });
    check('newest first with the date', a.added && b.list.map(x => x.text).join('|') === 'Feed the cat|Find the warden' && b.list[1].gameDate === 'Monday' && b.list[1].at === 5);
    const c = addDone(b.list, 'find the WARDEN', { at: 9, gameDate: 'Tuesday' });
    check('the same quest again moves to the front with the new date', c.list.length === 2 && c.list[0].text === 'find the WARDEN' && c.list[0].gameDate === 'Tuesday');
    check('None and nothing are not quests', !addDone(c.list, 'None').added && !addDone(c.list, '  ').added);
    check('a stored list is normalised and capped', normalizeDone([{ text: ' a ' }, 'b', { text: 'A' }, null, { text: '' }]).map(x => x.text).join() === 'a,b' && normalizeDone(Array.from({ length: MAX_DONE + 10 }, (_, i) => ({ text: `q${i}` }))).length === MAX_DONE);
}

console.log('\n§8 the world moves on without touching the row');
{
    let st = visitPlace(seedWorldState(harbour), harbour, { location: 'The docks', msgId: 'h1' }).state;
    const moved = applyAdvance(st, { clocks: { blockade: 2 }, moved: [{ who: 'Old Marit', to: 'governors-house', reason: 'summoned' }], blurb: 'Talk of a search.' }, harbour, { msgId: 'h2', gameDate: 'Tuesday' });
    check('an advance keeps the visits as they were', ids(moved) === 'the-docks' && moved.visited[0].visits.join() === 'h1');
}

console.log('');
if (failures) { console.error(`${failures} FAILURE(S)`); process.exit(1); }
console.log('All world map checks pass');
