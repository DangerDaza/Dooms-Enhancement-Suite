#!/usr/bin/env node
/**
 * The World Builder's pure parts (docs/world-builder-plan.md D92–D97): the
 * blank world and how it grows from play, a world written from a chat as
 * it stands, the draft the LLM is asked for and how its reply is read, and
 * the exported file. No sandbox: the pure modules are imported directly.
 *
 * Usage:  node tools/world-builder-test.mjs   (from the repo root)
 * Exit:   0 = all pass, 1 = a failure
 */
import { readFileSync } from 'node:fs';
import {
    BLANK_PACK_ID, blankPack, normalizePack, normalizeWorldState, seedWorldState, seenInScene, placeLabel,
    buildAdvancePrompt, validateAdvance, applyAdvance, buildWorldLines, resolveVisited, locPlaceId, locLabel,
    jsonObjectsIn, defaultLiveWorldConfig,
} from '../src/utils/liveWorld.js';
import { visitPlace, rowIdForCharacter, placeKeyFor, placesRow } from '../src/utils/worldMap.js';
import {
    emptyWorld, worldToRaw, worldSummary, packWarnings, worldFromState, buildWorldDraftPrompt, parseWorldDraft,
    worldFileName, worldToJson, rebindStateToPack,
} from '../src/utils/worldBuilder.js';

let failures = 0;
const check = (label, cond, extra = '') => {
    if (cond) console.log(`pass  ${label}`);
    else { console.error(`FAIL  ${label}${extra ? '\n      ' + extra : ''}`); failures++; }
};
const harbour = normalizePack(JSON.parse(readFileSync(new URL('../worldpacks/example.json', import.meta.url), 'utf8'))).pack;
const ids = (s) => s.visited.map(e => e.id).join(',');

console.log('\n§1 the blank world (D93)');
const blank = blankPack('Mara Vane');
check('a blank world: its id, the chat\'s name, nothing in it', blank.id === BLANK_PACK_ID && blank.name === 'Mara Vane' && blank.places.length === 0 && blank.clocks.length === 0 && blank.cast.length === 0);
check('a pack may have no places; nothing at all still fails on its id', normalizePack({ name: 'Nowhere' }).ok && !normalizePack(null).ok);
check('the builder warns about what is missing instead', packWarnings(blank).some(w => w.startsWith('No places yet')) && packWarnings(blank).some(w => w.startsWith('No clocks')) && packWarnings(harbour).length === 1 && packWarnings(harbour)[0].includes('"The dock fever" names 4 of its 5'));
check('a new chat seeds the blank world by default', defaultLiveWorldConfig().pack === 'blank');
check('the summary line', worldSummary(blank) === '0 places · 0 clocks · 0 people' && worldSummary(harbour) === '8 places · 2 clocks · 3 people');

console.log('\n§2 a world that grows from play');
let st = seedWorldState(blank, { name: 'Mara Vane' });
check('the state carries the name, and keeps it through normalisation', st.name === 'Mara Vane' && normalizeWorldState(JSON.parse(JSON.stringify(st))).name === 'Mara Vane' && seedWorldState(harbour).name === '');
st = visitPlace(st, blank, { location: 'The quay', msgId: 'm1', gameDate: 'Monday' }).state;
st = visitPlace(st, blank, { location: 'The Anchor, back room', msgId: 'm2', gameDate: 'Tuesday' }).state;
check('the story\'s places are the row, keyed the same way the state keys them', ids(st) === 'loc:the-anchor-back-room,loc:the-quay' && placeKeyFor(null, 'The quay').id === locPlaceId('The quay') && locLabel('loc:the-anchor-back-room') === 'the anchor back room');
const seen = seenInScene(st, blank, { names: ['Old Marit'], place: 'The Anchor, back room', msgId: 'm2', gameDate: 'Tuesday' });
check('someone in a scene at a story-named place is placed there, under the row\'s key', seen.placed === 1 && seen.state.where['Old Marit'] === 'loc:the-anchor-back-room' && seen.state.log.at(-1).reason === 'in the scene');
st = seen.state;
check('the place reads back as words, and the face finds its row entry', placeLabel(blank, 'loc:the-anchor-back-room') === 'the anchor back room' && rowIdForCharacter(st, blank, 'Old Marit') === 'loc:the-anchor-back-room' && placesRow(st, blank)[0].label === 'The Anchor, back room');
const prompt = buildAdvancePrompt({ pack: blank, state: st, recent: 'x' });
check('the advancer is told the story\'s own places', prompt.user.includes('loc:the-quay (The quay)') && prompt.user.includes('loc:the-anchor-back-room (The Anchor, back room)') && prompt.system.includes('<place id from the places list>'));
const v1 = validateAdvance({ moved: [{ who: 'Old Marit', to: 'loc:the-quay' }] }, blank, st);
const v2 = validateAdvance({ moved: [{ who: 'Old Marit', to: 'The quay' }] }, blank, st);
const v3 = validateAdvance({ moved: [{ who: 'Old Marit', to: 'the moon' }] }, blank, st);
check('a move to a visited place passes by id or by label; the moon does not', v1.ok && v1.clean.moved[0].to === 'loc:the-quay' && v2.ok && v2.clean.moved[0].to === 'loc:the-quay' && !v3.ok && v3.errors[0].includes('not a place'));
check('resolveVisited: id, label, the text that keys it; nothing else', resolveVisited(st, 'the quay') === 'loc:the-quay' && resolveVisited(st, 'The Quay!') === 'loc:the-quay' && resolveVisited(st, 'loc:the-quay') === 'loc:the-quay' && resolveVisited(st, 'nowhere') === '' && resolveVisited(null, 'x') === '');
const after = applyAdvance(st, v1.clean, blank, { msgId: 'm3', gameDate: 'Wednesday' });
check('the move is written under the row\'s key and the narrator reads it as words', after.where['Old Marit'] === 'loc:the-quay' && after.log.at(-1).to === 'loc:the-quay' && buildWorldLines(after, blank).includes('Old Marit: the quay'));
check('the narrator\'s line names the blank world by the chat\'s name', buildWorldLines(after, blank).startsWith('[WORLD OF MARA VANE:'));
{
    const seeded = seedWorldState(harbour);
    const a = seenInScene(seeded, harbour, { names: ['Wanderer'], place: 'The Anchor', msgId: 'h1' });
    const b = seenInScene(seeded, harbour, { names: ['Wanderer'], place: 'a nameless road', msgId: 'h2' });
    check('a world with places of its own keeps the old rule: at its places, else in the scene and unplaced (D70)', a.state.where.Wanderer === 'harbourside/old-town/the-anchor' && b.state.where.Wanderer === undefined && b.state.known.Wanderer === 'known' && placeLabel(harbour, 'loc:a-nameless-road') === 'a nameless road');
}

console.log('\n§3 a world from the chat as it stands (D96)');
{
    const raw = worldFromState(after, blank);
    check('named after the chat, the id from the name', raw.name === 'Mara Vane' && raw.id === 'mara-vane');
    check('the visited places become places of their own, newest first, with their labels', raw.places.map(p => `${p.id}:${p.label}:${p.parent}`).join('|') === 'the-anchor-back-room:The Anchor, back room:null|the-quay:The quay:null');
    check('the known people stand where they were last seen', raw.cast.length === 1 && raw.cast[0].name === 'Old Marit' && raw.cast[0].place === 'the-quay' && raw.cast[0].tier === 'known');
    check('…and the result is a sound pack', normalizePack(raw).ok && normalizePack(raw).pack.cast[0].place === 'the-quay');
    let hs = seedWorldState(harbour);
    hs = visitPlace(hs, harbour, { location: 'The Anchor, the old town', msgId: 'a1' }).state;
    hs = visitPlace(hs, harbour, { location: 'a nameless road', msgId: 'a2' }).state;
    hs.visited[0].image = '/user/images/x/road.png';
    hs = seenInScene(hs, harbour, { names: ['Wanderer'], place: 'a nameless road', msgId: 'a2' }).state;
    hs.clocks.blockade = 3;
    const raw2 = worldFromState(hs, harbour, { name: 'Harbourside, played' });
    const byId = Object.fromEntries(raw2.places.map(p => [p.id, p]));
    check('a pack world: the visited places first with their ancestors and nesting, a story-named place with its picture, then the rest of the pack', raw2.places.slice(0, 4).map(p => p.id).join() === 'a-nameless-road,harbourside,old-town,the-anchor' && byId['the-anchor'].parent === 'old-town' && byId['a-nameless-road'].image === '/user/images/x/road.png' && raw2.places.length === 9);
    check('the clocks at their values now, the cast where they are, the pack\'s own cast kept', raw2.clocks[0].start === 3 && raw2.clocks[0].effects[6].startsWith('The harbour is closed') && raw2.cast.find(m => m.name === 'Wanderer') && !raw2.cast.find(m => m.name === 'Wanderer').place && raw2.cast.find(m => m.name === 'Captain Reyes').place === 'customs-house' && raw2.cast.find(m => m.name === 'The governor').tier === 'heard');
    check('…sound, and the id from the name given', normalizePack(raw2).ok && raw2.id === 'harbourside-played' && raw2.name === 'Harbourside, played');
    check('an empty world', normalizePack(emptyWorld({ name: 'New world' })).ok && emptyWorld({ name: 'New world' }).id === 'new-world');
}
{
    const made = normalizePack(worldFromState(after, blank)).pack;
    const rb = rebindStateToPack(after, made);
    check('the chat carried over to the world made from it: the row re-keyed with its visits, the people and the log at the world\'s places', rb.rebound === 3 && rb.state.visited.map(e => `${e.id}/${e.packId}/${e.path}`).join() === 'the-anchor-back-room/the-anchor-back-room/the-anchor-back-room,the-quay/the-quay/the-quay' && rb.state.visited[1].visits.join() === 'm1' && rb.state.where['Old Marit'] === 'the-quay' && rb.state.log.at(-1).to === 'the-quay' && rb.state.log.at(-1).from === 'the-anchor-back-room', JSON.stringify(rb.state.visited));
    check('nothing to re-key: the same state back', rebindStateToPack(after, blank).state === after && rebindStateToPack(null, made).state === null);
    const twice = { ...after, visited: [{ id: 'the-quay', label: 'The quay', packId: 'the-quay', path: 'the-quay', parent: '', visits: ['m7'], lastDate: 'Friday' }, ...after.visited] };
    const rb2 = rebindStateToPack(twice, made);
    check('a row entry the world already has takes the visits of the story-named one', rb2.state.visited.length === 2 && rb2.state.visited[0].id === 'the-quay' && rb2.state.visited[0].visits.join() === 'm7,m1' && rb2.state.visited[1].id === 'the-anchor-back-room');
}

console.log('\n§4 the draft (D95)');
{
    const pr = buildWorldDraftPrompt({ name: 'Harbourside', card: { name: 'Mara Vane', description: 'A smuggler who\nkeeps her word.', scenario: 'The port under blockade.' }, lore: 'The docks: searched daily.\nThe governor: unseen for a month.', characters: ['Old Marit', 'Jordan', 'Captain Reyes'], recent: 'Jordan: I wave.\nMara Vane: She waves back.', player: 'Jordan' });
    check('the request asks for one JSON object in the file\'s shape and never casts the player', pr.system.includes('ONE JSON object') && pr.system.includes('"effects": {"0":') && pr.system.includes('never cast the player (Jordan)'));
    check('…and carries the card with its lines, the lore, the names (the player left out) and the scenes', pr.user.includes('World: Harbourside') && pr.user.includes('Description: A smuggler who\nkeeps her word.') && pr.user.includes('Scenario: The port under blockade.') && pr.user.includes('The docks: searched daily.\nThe governor') && pr.user.includes('People the story knows: Old Marit, Captain Reyes') && pr.user.includes('Mara Vane: She waves back.'));
    const reply = '<think>places first</think>Here is the world:\n```json\n' + JSON.stringify({
        name: 'Harbourside',
        places: [{ id: 'town', label: 'The town', parent: 'null' }, { id: 'docks', label: 'The docks', parent: 'town' }],
        clocks: [{ id: 'blockade', label: 'The blockade', place: 'docks', start: '1', max: '4', effects: ['calm', 'a cutter', 'searches', 'papers', 'closed'] }],
        cast: [{ name: 'Old Marit', place: 'docks', tier: 'Known' }],
        blurb: 'Talk of the cutter.',
    }) + '\n```\nEnjoy.';
    const d = parseWorldDraft(reply, { name: 'Harbourside' });
    check('a fenced reply with prose and reasoning around it is read; the slips forgiven (a "null" parent, numbers as strings, effects as a list, a tier in capitals)', d.ok && d.pack.id === 'harbourside' && d.pack.places.length === 2 && d.pack.places[0].parent === null && d.pack.places[1].parent === 'town' && d.pack.clocks[0].start === 1 && d.pack.clocks[0].max === 4 && d.pack.clocks[0].effects[4] === 'closed' && d.pack.cast[0].tier === 'known' && d.pack.blurb === 'Talk of the cutter.', d.errors.join(' | '));
    check('the file-shaped world comes with it', d.raw.places[1].parent === 'town' && d.raw.clocks[0].effects['2'] === 'searches' && !('template' in d.raw));
    check('no world in the reply', !parseWorldDraft('I cannot do that.').ok && parseWorldDraft('').errors[0].includes('no world'));
    const bad = parseWorldDraft('{"places":[{"id":"a","parent":"zzz"}],"clocks":[{"id":"c","max":0}]}', { name: 'X' });
    check('a draft with errors is not ok but comes back made safe, named, for the builder to show', !bad.ok && bad.errors.length >= 2 && bad.raw && bad.raw.name === 'X' && bad.raw.id === 'x' && bad.raw.places[0].parent === null);
    check('the reply reader is shared with the advancer', jsonObjectsIn('x {"a":1} y').length === 1 && jsonObjectsIn('').length === 0);
}

console.log('\n§5 export');
{
    const raw = worldToRaw(harbour);
    const back = normalizePack(JSON.parse(worldToJson(raw)));
    check('a world round-trips through its file', back.ok && back.pack.places.map(p => p.id).join() === harbour.places.map(p => p.id).join() && JSON.stringify(back.pack.clocks) === JSON.stringify(harbour.clocks) && JSON.stringify(back.pack.cast) === JSON.stringify(harbour.cast));
    check('the file\'s name and shape', worldFileName(harbour) === 'harbourside.json' && worldFileName({}) === 'world.json' && raw.places[0].parent === null && !('image' in raw.places[0]) && raw.clocks[0].place === 'the-docks');
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nAll World Builder checks pass');
process.exit(failures ? 1 : 0);
