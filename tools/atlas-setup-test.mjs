#!/usr/bin/env node
/**
 * Setting up a world's map, the pure parts (docs/long-shot-plan.md D143,
 * D144, D159; src/utils/atlasSetup.js): the chat as lines and in parts,
 * a scan's reply, the scans joined, the draft's request (the notes first,
 * the known places numbered), the draft read and made safe, the player's
 * corrections, the spots solved from what is near what, the draft made
 * the chat's book, and the map that book draws: every place on its own
 * map, the old places merged in, the story's later wordings of a place
 * going to it.
 *
 * Usage:  node tools/atlas-setup-test.mjs     (from the repo root)
 * Exit:   0 = pass, 1 = failure
 */
import { blankPack, seedWorldState, locPlaceId } from '../src/utils/liveWorld.js';
import { atlasModel, placeAt, addPin, tidyList } from '../src/utils/atlas.js';
import {
    SETUP_LIMITS, chatLines, chunkLines, recentLines, jsonIn, buildScanPrompt, parseScan, mergeScans, buildSetupPrompt, parseSetup,
    editDraftPlace, setDraftInside, removeDraftPlace, draftRows, draftChain, layoutDraft, applySetup,
} from '../src/utils/atlasSetup.js';

let failures = 0;
function check(name, cond, detail = '') {
    if (cond) console.log(`pass  ${name}`);
    else { failures++; console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ''}`); }
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// A long campaign grown from play: the tracker's wordings of where the scene is.
const WORDINGS = ['Hask, the house on the lane above the temple, the bedroom wall by the shutter', 'Hask', 'Hask, the house on the lane above the temple', "Lysandra's narrow bed under the shutter", 'the black stair', 'the black stair, second landing', 'the counting room', 'somewhere dark'];
const pack = blankPack('The Eld');
const state = seedWorldState(pack, { name: 'The Eld' });
state.visited = WORDINGS.map((label, i) => ({ id: locPlaceId(label), label, packId: '', path: '', visits: [i + 1] }));
state.where = { Lysandra: locPlaceId(WORDINGS[0]), Brother: locPlaceId('the black stair, second landing') };
const model = atlasModel({ pack, state, player: 'Jordan' });
const n = (label) => (tidyList(model).find(x => x.label === label) || { n: 0 }).n;

console.log('\n§1 the chat as lines and in parts');
{
    const chat = [{ is_user: true, name: 'Jordan', mes: 'I go to   the temple.' }, { name: 'Narrator', mes: '<x>The temple is cold.' }, { is_system: true, mes: 'hidden' }, { name: 'Narrator', mes: '   ' }, { mes: 'No name.' }];
    const lines = chatLines(chat, { strip: (t) => t.replace('<x>', '') });
    check('each message a line with who said it, cleaned; system and empty ones left out', same(lines, ['Jordan: I go to the temple.', 'Narrator: The temple is cold.', 'Narrator: No name.']));
    const many = Array.from({ length: 50 }, (_, i) => `Narrator: ${'word '.repeat(60)}${i}`);
    const cut = chunkLines(many, { size: 3000, max: 60 });
    check('parts of about the size asked, in order, every line in one of them', cut.chunks.length > 4 && cut.chunks.every(c => c.length <= 3400) && cut.skipped === 0 && cut.chunks.join('\n').split('\n').length === 50 && cut.chunks[0].endsWith('0') === false && cut.chunks[0].includes('word 0'));
    const capped = chunkLines(many, { size: 3000, max: 2 });
    check('a chat longer than can be read: the newest parts are kept and the lines left out are counted', capped.chunks.length === 2 && capped.skipped > 0 && capped.chunks[1].includes('word 49') && capped.skipped + capped.chunks.join('\n').split('\n').length === 50);
    check('the recent scenes: the last lines that fit, in order', recentLines(many, 1000).split('\n').length === 3 && recentLines(many, 1000).endsWith('49') && recentLines([], 100) === '');
    check('nothing in, nothing out', same(chunkLines([]), { chunks: [], skipped: 0 }) && same(chatLines(null), []));
}

console.log('\n§2 a scan');
{
    const p = buildScanPrompt('Jordan: I go to the temple.', { part: 2, parts: 5 });
    check('the request says what a place is, the part it is, and asks for JSON', /Part 2 of 5/.test(p.user) && p.user.includes('I go to the temple') && /"places"/.test(p.system) && /Not a room/.test(p.system));
    check('a reply read: fenced or bare, the named ones kept', same(parseScan('```json\n{"places":[{"name":" The Temple ","inside":"Hask","note":"cold"},{"name":""},{"inside":"x"}]}\n```'), [{ name: 'The Temple', inside: 'Hask', note: 'cold' }]) && same(parseScan('no json here'), []) && same(parseScan('{"places":"none"}'), []));
    const joined = mergeScans([[{ name: 'The Temple', inside: '', note: '' }, { name: 'Hask', inside: '', note: 'a city' }], [{ name: 'temple', inside: 'Hask', note: 'cold stone' }, { name: 'The Black Stair', inside: 'the temple', note: '' }]]);
    check('the scans joined: one entry per name, the article and the case apart, what was missing filled in', joined.length === 3 && same(joined[0], { name: 'The Temple', inside: 'Hask', note: 'cold stone' }) && joined[2].name === 'The Black Stair');
    check('the first JSON object in a reply, or nothing', same(jsonIn('Sure! {"a":1} done'), { a: 1 }) && jsonIn('none') === null && jsonIn('{broken') === null && jsonIn('[1,2]') === null);
}

console.log('\n§3 the draft\'s request');
{
    const p = buildSetupPrompt({ notes: 'Hask is a landlocked city. The black stair is a dungeon under the temple.', world: 'The Eld', card: { description: 'A grim land.' }, lore: 'Hask: a walled city.', recent: 'Narrator: The stair goes down.', found: [{ name: 'The Temple', inside: 'Hask', note: 'cold' }], model, players: ['Jordan'] });
    check('the notes come first and are said to outrank the rest', p.user.indexOf("THE PLAYER'S NOTES") === 0 && p.user.indexOf('landlocked') < p.user.indexOf('The lore:') && /NOTES OUTRANK EVERYTHING/.test(p.system));
    check('the card, the lore, what the scans found and the recent scenes follow', p.user.includes('A grim land.') && p.user.includes('Hask: a walled city.') && p.user.includes('- The Temple (in Hask): cold') && p.user.includes('The stair goes down.'));
    check('the known places are numbered as the clean-up numbers them', p.known === tidyList(model).length && p.user.includes(`${n('the black stair')}. the black stair`) && p.user.includes(`${n('Hask')}. Hask`));
    check('the rules: layers by "inside", no coordinates, every number used once, the player is no place', /"inside" builds layers/.test(p.system) && /never write coordinates/.test(p.system) && /Use each number once/.test(p.system) && /Jordan is the player/.test(p.system) && /"guess"/.test(p.system));
    const bare = buildSetupPrompt({});
    check('with nothing to go on the request still stands', bare.user === 'There are no known places yet.' && bare.known === 0);
}

const REPLY = JSON.stringify({
    scale: 'region',
    places: [
        { name: 'Hask', kind: 'settlement', note: 'A landlocked walled city.', inside: '', was: [n('Hask')], guess: false, near: [{ to: 'The Old Road', dir: 's', far: 'near' }] },
        { name: 'The Old Road', kind: 'wild', note: 'The way south.', inside: '', was: [], guess: true, near: [] },
        { name: 'The House on the Lane', kind: 'home', note: "Lysandra's house, above the temple.", inside: 'Hask', was: [n('Bedroom') || 0, n("Lysandra's narrow bed under the shutter")].filter(Boolean), guess: false, near: [{ to: 'The Temple', dir: 'n', far: 'close' }] },
        { name: 'The Temple', kind: 'sacred', note: 'Cold stone.', inside: 'hask', was: [], guess: false, near: [] },
        { name: 'The Counting Room', kind: 'shop', note: '', inside: 'Hask', was: [n('the counting room')], guess: false, near: [{ to: 'The Temple', dir: 'e', far: 'far' }, { to: 'The Old Road', dir: 'n', far: 'near' }, { to: 'Nowhere', dir: 'n', far: 'near' }, { to: 'The Temple', dir: 'w', far: 'near' }] },
        { name: 'The Black Stair', kind: 'ruin', note: 'A dungeon under the temple.', inside: 'The Temple', was: [n('the black stair')], guess: false, near: [] },
        { name: 'Second Landing', kind: 'ruin', note: '', inside: 'the black stair', was: [n('Hask')], guess: false, near: [] },
        { name: 'the temple', kind: 'sacred', inside: '' },
        { name: 'Loop A', inside: 'Loop B' }, { name: 'Loop B', inside: 'Loop A' }, { name: 'Self', inside: 'Self', kind: 'spaceship' },
        { name: '' },
    ],
    drop: [n('somewhere dark'), n('Hask'), 999],
});

console.log('\n§4 the draft read');
{
    check('the model folded the wordings before the draft saw them', tidyList(model).some(x => x.label === 'Hask') && !tidyList(model).some(x => /bedroom wall/.test(x.label)), JSON.stringify(tidyList(model).map(x => x.label)));
    const r = parseSetup('Here you go:\n```json\n' + REPLY + '\n```', model);
    const by = (key) => r.draft.places.find(p => p.key === key);
    check('the places with a name, one per name', r.ok && r.draft.places.length === 10 && !!by('hask') && r.draft.places.filter(p => p.key === 'temple').length === 1);
    check('"inside" names another place of the list, whatever its case and article; else the top map', by('house on the lane').inside === 'hask' && by('temple').inside === 'hask' && by('black stair').inside === 'temple' && by('second landing').inside === 'black stair' && by('self').inside === '');
    check('a loop of "inside" is broken, so neither place is lost', (by('loop a').inside === '') !== (by('loop b').inside === '') || (by('loop a').inside === '' && by('loop b').inside === ''));
    check('a known place\'s number is used once: the first place to name it has it', same(by('hask').was.map(k => k.label), ['Hask']) && by('second landing').was.length === 0 && same(by('black stair').was.map(k => k.label), ['the black stair']));
    check('"near": a direction, another place on the same map, each once', same(by('counting room').near, [{ to: 'temple', dir: 'e', far: 'far' }]) && same(by('hask').near, [{ to: 'old road', dir: 's', far: 'near' }]));
    check('a kind that is not one is guessed from the name; the guesses are marked', by('self').kind === 'other' && by('temple').kind === 'sacred' && by('old road').guess === true && by('hask').guess === false);
    check('what is not a place is dropped, unless a place took it', same(r.draft.drop.map(k => k.label), ['somewhere dark']) && r.draft.scale === 'region');
    check('a reply that is no list is said', parseSetup('I cannot do that.', model).ok === false && parseSetup('{"places":[]}', model).ok === false && parseSetup('{"places":[{"name":"A"}],"scale":"site"}', null).draft.scale === '');
}

console.log('\n§5 the player\'s corrections');
{
    const d0 = parseSetup(REPLY, model).draft;
    const d = removeDraftPlace(removeDraftPlace(removeDraftPlace(d0, 'loop a'), 'loop b'), 'self');
    check('a place left out; the draft it came from is not changed', d.places.length === 7 && d0.places.length === 10);
    const rows = draftRows(d);
    check('the rows read as a tree: a place, then what is inside it, each with its depth', same(rows.map(r => `${r.depth}:${r.key}`), ['0:hask', '1:house on the lane', '1:temple', '2:black stair', '3:second landing', '1:counting room', '0:old road']) && rows[0].holds === 3 && rows[2].holds === 1);
    check('the chain a place is inside of, nearest first', same(draftChain(d, 'second landing'), ['black stair', 'temple', 'hask']) && same(draftChain(d, 'hask'), []));
    const renamed = editDraftPlace(d, 'old road', { name: 'The King\'s Road', kind: 'landmark' });
    check('a name and a kind changed: the place is the player\'s now, and what points at it still does', renamed.places.find(p => p.key === 'old road').name === "The King's Road" && renamed.places.find(p => p.key === 'old road').kind === 'landmark' && renamed.places.find(p => p.key === 'old road').guess === false && renamed.places.find(p => p.key === 'hask').near[0].to === 'old road');
    const moved = setDraftInside(d, 'black stair', 'hask');
    check('a place put inside another: its places come with it', moved.places.find(p => p.key === 'black stair').inside === 'hask' && same(draftChain(moved, 'second landing'), ['black stair', 'hask']));
    check('inside itself, or inside what is inside it, is refused', same(setDraftInside(d, 'hask', 'hask'), d) && same(setDraftInside(d, 'hask', 'second landing'), d) && same(setDraftInside(d, 'hask', 'nowhere'), d));
    const out = setDraftInside(d, 'house on the lane', '');
    check('moved to another map, what it was near is let go', out.places.find(p => p.key === 'house on the lane').near.length === 0 && out.places.find(p => p.key === 'house on the lane').inside === '');
    const gone = removeDraftPlace(d, 'temple');
    check('a place left out: what was inside it moves up to where it stood, and nothing points at it', gone.places.find(p => p.key === 'black stair').inside === 'hask' && !gone.places.some(p => p.near.some(r => r.to === 'temple')) && gone.places.length === 6);
}

console.log('\n§6 the spots, and the draft made the map');
{
    const d0 = parseSetup(REPLY, model).draft;
    const d = removeDraftPlace(removeDraftPlace(removeDraftPlace(d0, 'loop a'), 'loop b'), 'self');
    const spots = layoutDraft(d);
    const at = (k) => spots.get(k);
    check('a spot for every place; the same draft, the same spots', spots.size === d.places.length && same([...spots], [...layoutDraft(d)]));
    check('what is near what is kept: the road south of Hask, the temple north of the house and close, east of the counting room and far', at('old road').y > at('hask').y + 2 && Math.abs(at('old road').x - at('hask').x) < 0.5 && at('temple').y < at('house on the lane').y - 1 && at('temple').x > at('counting room').x + 3 && (at('temple').x - at('counting room').x) > (at('house on the lane').y - at('temple').y));
    const sameLayer = (a, b) => d.places.find(p => p.key === a).inside === d.places.find(p => p.key === b).inside;
    const keys = d.places.map(p => p.key);
    check('no two places of one map stand on each other', keys.every((a, i) => keys.every((b, j) => i >= j || !sameLayer(a, b) || Math.hypot(at(a).x - at(b).x, at(a).y - at(b).y) >= 1.3)));
    check('each map is laid out on its own: its first place in the middle', same(at('hask'), { x: 0, y: 0 }) && same(at('black stair'), { x: 0, y: 0 }) && same(at('second landing'), { x: 0, y: 0 }));
    const crowd = { scale: '', drop: [], places: Array.from({ length: 12 }, (_, i) => ({ key: `p${i}`, name: `P${i}`, kind: 'other', note: '', inside: '', was: [], guess: false, near: [] })) };
    const cs = [...layoutDraft(crowd).values()];
    check('places with nothing said about them are spread out, none on another', cs.every((a, i) => cs.every((b, j) => i >= j || Math.hypot(a.x - b.x, a.y - b.y) >= 1.3)));

    const old = placeAt(addPin(null, { label: 'An old pin', x: 5, y: 5 }).book, locPlaceId('Hask'), { x: 1, y: 1 });
    const r = applySetup(d, { ...old, drawn: true, ground: 'coast-s' });
    check('the map is replaced: the old markers and spots are gone, the picture switch and the top ground kept', r.placed === 7 && r.book.made.length === 7 && !r.book.made.some(m => m.label === 'An old pin') && !r.book.spots[locPlaceId('Hask')] && r.book.drawn === true && r.book.ground === 'coast-s' && r.book.scale === 'region');
    const id = (k) => r.ids.get(k);
    check('every place is a marker of its own, on the map of the place it is inside, at its spot', same(r.book.spots[id('hask')], { x: 0, y: 0 }) && r.book.inside[id('temple')] === id('hask') && r.book.inside[id('black stair')] === id('temple') && r.book.inside[id('second landing')] === id('black stair') && r.book.inside[id('hask')] === '' && Object.keys(r.book.spots).length === 7);
    check('the known places it was are merged into it; what is not a place is deleted', r.book.merged[locPlaceId('Hask')] === id('hask') && r.book.merged[locPlaceId('the black stair')] === id('black stair') && r.merged >= 3 && same(r.book.gone, [locPlaceId('somewhere dark')]) && r.dropped === 1);

    const top = atlasModel({ pack, state, player: 'Jordan', book: r.book });
    check('the top map: Hask and the road, a region\'s open country, nothing left in the tray', same(top.markers.map(m => m.label).sort(), ['Hask', 'The Old Road']) && top.tray.length === 0 && top.measure.scale === 'region' && top.ground === 'coast-s' && top.deleted.length === 1);
    const hask = top.markers.find(m => m.label === 'Hask');
    check('Hask holds its three places; the party and the people are inside it', hask.holds === 3 && hask.player && hask.partyInside && same(hask.people.sort(), ['Brother', 'Lysandra']));
    const inHask = atlasModel({ pack, state, player: 'Jordan', book: r.book, layer: id('hask') });
    check('inside Hask: the house, the temple, the counting room, at a town\'s scale on streets', same(inHask.markers.map(m => m.label).sort(), ['The Counting Room', 'The House on the Lane', 'The Temple']) && inHask.measure.scale === 'town' && inHask.ground === 'city');
    const house = inHask.markers.find(m => m.label === 'The House on the Lane');
    check('the story\'s wordings of the house go to the house: the bedroom wall by the shutter is in it, and so is Lysandra', same(house.people, ['Lysandra']) && house.visited && !top.all.some(x => /bedroom wall|narrow bed/.test(x.label)), JSON.stringify(top.all.map(x => x.label)));
    const stair = atlasModel({ pack, state, player: 'Jordan', book: r.book, layer: id('black stair') });
    check('the stair is three maps down, underground, with its landing and the brother on it', stair.depth === 3 && stair.ground === 'underground' && stair.measure.scale === 'site' && same(stair.markers.map(m => m.label), ['Second Landing']) && same(stair.markers[0].people, ['Brother']) && same(stair.trail.map(t => t.label), ['Hask', 'The Temple', 'The Black Stair']));
    const later = { ...state, visited: [{ id: locPlaceId('Hask, the temple, the nave at dusk'), label: 'Hask, the temple, the nave at dusk', packId: '', path: '', visits: [99] }, ...state.visited] };
    const after = atlasModel({ pack, state: later, player: 'Jordan', book: r.book, layer: id('hask') });
    check('a wording the story uses later goes to its place too: no new entry, the party at the temple', after.all.length === top.all.length && after.tray.length === 0 && after.markers.find(m => m.label === 'The Temple').player && after.partyId === id('temple'));
    check('a draft with nothing in it makes an empty map', applySetup({ scale: '', places: [], drop: [] }, old).book.made.length === 0);
    check('the limits are what the request and the reading are held to', SETUP_LIMITS.places === 80 && SETUP_LIMITS.chunks === 60);
}

console.log(failures ? `\n${failures} failure(s)` : '\nall pass');
process.exit(failures ? 1 : 0);
