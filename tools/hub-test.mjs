#!/usr/bin/env node
/**
 * The Hub, the pure parts (docs/hub-plan.md D113–D133): the rules, the
 * snapshot taken and sealed (and proved against the stores' own rewinds),
 * the stores seeded for a scene, the brief and its cuts, the openers'
 * request and reading, the first message with its swipes, the header and
 * the file name, the recap, the scene records.
 *
 * Usage:  node tools/hub-test.mjs   (from the repo root)
 * Exit:   0 = all pass, 1 = a failure
 */
import { readFileSync } from 'node:fs';
import {
    HUB_KEYS, HUB_META_KEY, GAPS, OPENERS, MAX_BRIEF, MAX_OPENER_TEXT, MAX_SCENES, RECENT_RECAPS, OLD_RECAP_CHARS,
    defaultHubConfig, hubConfig, gapOf, gapMoves, normalizeHub, normalizeWorldEntry, normalizeScene, normalizeMemory, capScenes, cutText,
    sealStores, takeSnapshot, sealSnapshot, factsFrom, weatherText, seedStores,
    personLine, buildBrief, buildOpenersPrompt, parseOpenersReply, validateOpeners, openerMessage, sceneTitle,
    hubMark, readMark, markEnded, sceneHeader, sceneFileName,
    sceneTranscript, sceneTranscriptPages, buildRecapPrompt, parseRecapReply, isStaleScene, markIsOfFile,
    openSceneOf, asideScenes, openScene, setSceneAside, resumeScene, endSceneRecord, reopenScene, sceneByChat, markChatGone, renameSceneChat, removeGoneScene, reconcileScenesWithChats, lastRecaps,
    hubStatusLine, describeStartResult, describeEndResult, adoptScene, ADOPTED_ID, ADOPTED_TITLE, backupFileName,
    loreEntries, castLore, standingLore, LORE_PER_PERSON, LORE_STANDING,
} from '../src/utils/hub.js';
import { normalizePack, seedWorldState, countMessage, applyAdvance, reconcileWithChat, seenInScene } from '../src/utils/liveWorld.js';
import { visitPlace, reconcileVisited } from '../src/utils/worldMap.js';
import { emptyCanon, applyCanon, countCanonReply, reconcileCanon, buildCanonBlock } from '../src/utils/canon.js';
import { emptyHooks, proposeRound } from '../src/utils/questHooks.js';

let failures = 0;
const check = (label, cond, extra = '') => {
    if (cond) console.log(`pass  ${label}`);
    else { console.error(`FAIL  ${label}${extra ? '\n      ' + extra : ''}`); failures++; }
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const raw = { ...JSON.parse(readFileSync(new URL('../worldpacks/example.json', import.meta.url), 'utf8')), id: 'harbourside' };
const { pack } = normalizePack(raw);
const clock = pack.clocks[0];

console.log('\n§1 the rules');
{
    check('defaults: later that day, 600 characters, the hub closes on Start, the count of repeated phrases off', same(defaultHubConfig(), { gap: 'later', recapChars: 600, closeOnStart: true, styleLaw: false }));
    check('the count of repeated phrases is on only when switched on, by exactly that', hubConfig({}).styleLaw === false && hubConfig({ hub: { styleLaw: true } }).styleLaw === true && hubConfig({ hub: { styleLaw: 'yes' } }).styleLaw === false && hubConfig({ hub: { styleLaw: 1 } }).styleLaw === false);
    check('no settings: the defaults', same(hubConfig(null), defaultHubConfig()) && same(hubConfig({ hub: 'x' }), defaultHubConfig()));
    const c = hubConfig({ hub: { gap: 'when', recapChars: 9999, closeOnStart: false } });
    check('clamps: when is not a default gap, the recap within range, the switch read', c.gap === 'later' && c.recapChars === 1500 && c.closeOnStart === false);
    check('six gaps, Right after first, When… last', GAPS.length === 6 && GAPS[0].id === 'now' && GAPS[5].id === 'when');
    check('a gap by id carries its words; When… takes the player\'s; empty When… is Right after', gapOf('days').words === 'some days later' && gapOf('when', '  three  winters later. ').words === 'three winters later' && gapOf('when', '').id === 'now' && gapOf('nonsense').id === 'now');
    check('the world moves for anything but Right after', !gapMoves(gapOf('now')) && gapMoves(gapOf('later')) && gapMoves(gapOf('when', 'a year on')));
    const h = normalizeHub({ gap: 'weeks', worlds: { harbourside: { card: 'Mara.png', seq: 2, scenes: [{ id: 's1', title: 'A', status: 'ended', recap: 'r' }, { id: 's1', title: 'dup' }, { status: 'open', title: 'B' }] }, '': {} } });
    check('the store made safe: the rules, a world entry with its card, one scene per id, the sequence past the highest id', h.v === 1 && h.gap === 'weeks' && Object.keys(h.worlds).length === 1 && h.worlds.harbourside.card === 'Mara.png' && h.worlds.harbourside.scenes.length === 2 && h.worlds.harbourside.scenes[1].id === 's3' && h.worlds.harbourside.seq === 3, JSON.stringify(h.worlds.harbourside.scenes.map(s => s.id)));
    const many = { card: 'x', memory: null, seq: 0, scenes: Array.from({ length: MAX_SCENES + 5 }, (_, i) => normalizeScene({ id: `s${i + 1}`, status: 'ended', recap: 'y'.repeat(500) }, i + 1)) };
    const capped = capScenes(many);
    check(`the caps: ${MAX_SCENES} scenes, the recaps of all but the last ${RECENT_RECAPS} cut to ${OLD_RECAP_CHARS}`, capped.scenes.length === MAX_SCENES && capped.scenes[0].id === 's6' && capped.scenes[0].recap.length <= OLD_RECAP_CHARS && capped.scenes[capped.scenes.length - 1].recap.length === 500);
    check('cutText ends at a sentence when one is near, else at a word with an ellipsis', cutText('One. Two three four. Five six.', 20) === 'One. Two three four.' && cutText('Onewordthatisverylongindeed and more', 14).endsWith('…') && cutText('short', 20) === 'short');
}

// ─── A chat as End finds it: stores tied to replies ─────────────────────
let world = seedWorldState(pack, { name: '' });
world = countMessage(world, 'm1').state;
world = countMessage(world, 'm2').state;
world = applyAdvance(world, { clocks: { [clock.id]: clock.start + 1 }, moved: [{ who: 'Old Marit', to: 'back-room' }], heard: ['The governor'], blurb: 'Talk of the cutter.', elapsed: 'a day' }, pack, { msgId: 'm2', gameDate: 'Day 12', gameTime: 'evening', ranAt: 5 });
world = visitPlace(world, pack, { location: 'The Anchor', msgId: 'm3', gameDate: 'Day 12', gameTime: 'evening' }).state;
world = seenInScene(world, pack, { names: ['Captain Reyes'], place: 'the-anchor', msgId: 'm3', gameDate: 'Day 12' }).state;
world.visited[0].image = '/user/images/anchor.png';
let canon = emptyCanon();
canon = countCanonReply(canon, 'm2').state;
canon = applyCanon(canon, { add: [{ kind: 'person', name: 'Old Marit', text: 'Keeps the Anchor.' }, { kind: 'place', name: 'The Anchor', text: 'A tavern in the old town.' }], drop: [] }, { msgId: 'm2', gameDate: 'Day 12', ranAt: 5 });
let hooks = proposeRound(emptyHooks(), [{ title: 'Ask Marit', text: 'Ask Marit about the governor.', grounds: 'a rumour', kind: 'person' }], { msgId: 'm3', gameDate: 'Day 12', ranAt: 6 });
const infoBox = JSON.stringify({ date: { value: 'Day 12' }, time: { start: 'dusk', end: 'evening' }, location: { value: 'The Anchor' }, weather: { emoji: '🌧', forecast: 'rain over the harbour' } });
const thoughts = JSON.stringify({ characters: [{ name: 'Old Marit', emoji: '🍺', relationship: { status: 'wary' }, stats: [{ name: 'Health', value: 80 }], thoughts: { content: 'She wonders.' } }, { name: 'Jordan', emoji: '🙂', thoughts: { content: 'the player' } }] });
const meta = {
    dooms_tracker: {
        quests: { main: 'Find the ring', optional: ['Pay the harbourmaster'] },
        lastGeneratedData: { quests: '{"main":"Find the ring","optional":["Pay the harbourmaster"]}', infoBox, characterThoughts: thoughts, player: '{"stats":[{"name":"Health","value":64}]}' },
        committedTrackerData: { quests: '{"main":"Find the ring","optional":["Pay the harbourmaster"]}', infoBox, characterThoughts: thoughts, player: '{"stats":[{"name":"Health","value":64}]}' },
        syncedExpressionPortraits: { 'Old Marit': '/x.png' }, syncedExpressionLabels: { 'old marit': 'joy' },
        doomCounterState: { totalTwistsTriggered: 2, pendingTwist: 'a knife', pendingTwistIsKnife: true, pendingKnifeCharacter: 'Reyes', triggered: true, countdownActive: true, countdownCount: 1, lowStreakCount: 3 },
        knivesEnabled: true, characterSheets: { 'npc:Old Marit': { scores: { str: 10 } } }, knownCharacters: { 'Old Marit': { emoji: '🍺' } }, removedCharacters: [], characterColors: { 'Old Marit': '#ffcc00' }, bubbleFills: {}, bannedCharacters: [], timestamp: 1,
    },
    dooms_inventory: { v: 2, pack: [{ name: 'rope', count: 1 }], pouch: [], stored: {}, chat: 'Mara - old chat' },
    dooms_quests_done: [{ text: 'Reach the Anchor', at: 1, gameDate: 'Day 11' }],
    dooms_world: world,
    dooms_canon: canon,
    dooms_hooks: hooks,
    dooms_atlas: { scale: 'region', spots: { 'pin:hask': { x: 1, y: 2 }, 'loc:the-anchor': { x: -3, y: 0.5 } }, made: [{ id: 'pin:hask', label: 'Hask', kind: 'settlement' }], gone: ['loc:bedroom'], roads: [['pin:hask', 'loc:the-anchor']], junk: { not: 'kept' } },
    dooms_quest_cut: { quest: 'x' },
    dooms_scene: { count: 3 },
    world_info: 'Something else',
};

console.log('\n§2 the snapshot taken and sealed');
let memory;
{
    memory = takeSnapshot(meta, { scene: 's4', takenAt: 99 });
    check('the snapshot carries the chat\'s stores (the map among them) and nothing else', same(Object.keys(memory.stores).sort(), [...HUB_KEYS].sort()) && HUB_KEYS.includes('dooms_atlas') && memory.scene === 's4' && memory.takenAt === 99, Object.keys(memory.stores).join(','));
    check('the map is carried as the player made it, made safe: the spots, the markers made by hand, what was deleted, the roads; what is no part of a book left out (D172)', same(memory.stores.dooms_atlas.spots, { 'pin:hask': { x: 1, y: 2 }, 'loc:the-anchor': { x: -3, y: 0.5 } }) && memory.stores.dooms_atlas.made.length === 1 && memory.stores.dooms_atlas.made[0].label === 'Hask' && same(memory.stores.dooms_atlas.gone, ['loc:bedroom']) && memory.stores.dooms_atlas.roads.length === 1 && memory.stores.dooms_atlas.scale === 'region' && !('junk' in memory.stores.dooms_atlas) && same(sealStores(memory.stores).dooms_atlas, memory.stores.dooms_atlas) && !('dooms_atlas' in takeSnapshot({ dooms_tracker: {} }, {}).stores));
    check('the facts come from the committed tracker data', same(memory.facts, { date: 'Day 12', time: 'dusk → evening', location: 'The Anchor', weather: '🌧 rain over the harbour' }), JSON.stringify(memory.facts));
    const w = memory.stores.dooms_world;
    check('Live World sealed: no reply id on the log, the runs, the last run; the count empty; the visits empty; the picture kept; seeded and the clocks and places as they were', w.log.every(e => e.msgId === null) && w.runs.every(r => r.msgId === null) && w.last && w.last.msgId === null && w.counted.length === 0 && w.sinceLast === 0 && w.visited.every(v => v.visits.length === 0) && w.visited[0].image === '/user/images/anchor.png' && w.seeded === true && w.clocks[clock.id] === clock.start + 1 && w.where['Old Marit'].endsWith('back-room') && w.known['The governor'] === 'heard', JSON.stringify({ log: w.log, visited: w.visited.map(v => [v.id, v.visits]) }));
    const r = reconcileWithChat(w, [], { pack });
    check('a fresh chat\'s rewind (no replies at all) undoes nothing of a sealed world', r.undone === 0 && r.pruned === 0 && r.state.clocks[clock.id] === clock.start + 1 && r.state.where['Old Marit'].endsWith('back-room') && r.state.blurb === 'Talk of the cutter.');
    const rv = reconcileVisited(w, []);
    check('the row keeps every sealed place where it is', rv.pruned === 0 && rv.dropped === 0 && rv.state.visited.length === w.visited.length);
    const unsealed = reconcileWithChat(world, [], { pack });
    check('(and the unsealed state would have been wound back: the proof the seal is needed)', unsealed.undone > 0 && unsealed.state.clocks[clock.id] === clock.start);
    const c = memory.stores.dooms_canon;
    const rc = reconcileCanon(c, []);
    check('Canon sealed: both lines kept by a fresh chat\'s reconcile; the count empty', c.entries.length === 2 && rc.dropped === 0 && rc.state.entries.length === 2 && c.counted.length === 0 && c.last.msgId === null && reconcileCanon(canon, []).dropped === 2);
    check('the inventory loses its chat binding; the hooks keep their round; the done quests ride along', memory.stores.dooms_inventory.chat === undefined && memory.stores.dooms_inventory.pack[0].name === 'rope' && memory.stores.dooms_hooks.proposed.length === 1 && memory.stores.dooms_hooks.proposed[0].msgId === null && memory.stores.dooms_quests_done.length === 1);
    const t = memory.stores.dooms_tracker;
    check('the tracker: the expression portraits left out, the counter\'s total kept and its pending reset, knives, sheets, the roster and the colours kept', same(t.syncedExpressionPortraits, {}) && t.doomCounterState.totalTwistsTriggered === 2 && t.doomCounterState.pendingTwist === null && t.doomCounterState.triggered === false && t.doomCounterState.countdownActive === false && t.knivesEnabled === true && t.characterSheets['npc:Old Marit'].scores.str === 10 && t.knownCharacters['Old Marit'].emoji === '🍺' && t.characterColors['Old Marit'] === '#ffcc00');
    check('the cut, the pictures\' count and the chat\'s own lorebook are not taken', !('dooms_quest_cut' in memory.stores) && !('dooms_scene' in memory.stores) && !('world_info' in memory.stores));
    check('sealing again changes nothing', same(sealSnapshot(memory), memory));
    check('a snapshot with no stores is nothing; a bare object is not a memory', normalizeMemory({}) === null && normalizeMemory(null) === null && normalizeMemory({ stores: {} }) !== null);
    check('weather text in every shape', weatherText({ weather: 'fog' }) === 'fog' && weatherText({ weather: { emoji: '☀️', forecast: 'clear' } }) === '☀️ clear' && weatherText({}) === '' && factsFrom({ infoBox: 'Date: Day 3\nTime: noon\nLocation: The quay' }).location === 'The quay');
}

console.log('\n§3 the stores seeded for a scene');
{
    const s = seedStores(memory, { chatId: 'Mara - Scene 5', place: 'Customs house', cast: ['Captain Reyes', 'Old Marit', 'Jordan'], player: ['Jordan'], weather: '☀️ clear', when: { date: 'Day 13', time: 'morning' }, hookId: 'h1', now: 500 });
    check('the cast without the player; the facts as given', same(s.cast, ['Captain Reyes', 'Old Marit']) && same(s.facts, { date: 'Day 13', time: 'morning', location: 'Customs house', weather: '☀️ clear' }));
    const t = s.stores.dooms_tracker;
    const box = JSON.parse(t.lastGeneratedData.infoBox);
    check('the info box in its own shape: the place, the date, the time, the weather replaced', box.location.value === 'Customs house' && box.date.value === 'Day 13' && box.time.start === 'morning' && box.time.end === 'morning' && box.weather.emoji === '☀️' && box.weather.forecast === 'clear', t.lastGeneratedData.infoBox);
    const chars = JSON.parse(t.committedTrackerData.characterThoughts).characters;
    check('the present characters are the cast: a known one keeps her emoji, her status and her vitals, a new one gets the plain card; the player is not among them; the thoughts are blank', chars.length === 2 && chars[0].name === 'Captain Reyes' && chars[0].emoji === '🙂' && chars[1].name === 'Old Marit' && chars[1].emoji === '🍺' && chars[1].relationship.status === 'wary' && chars[1].stats[0].value === 80 && chars.every(c => c.thoughts.content === '') && !chars.some(c => c.name === 'Jordan'), t.committedTrackerData.characterThoughts);
    check('both the last generated and the committed data are seeded alike; the player\'s vitals and the quests kept; the timestamp set', t.lastGeneratedData.characterThoughts === t.committedTrackerData.characterThoughts && t.committedTrackerData.player.includes('64') && t.quests.main === 'Find the ring' && t.timestamp === 500);
    check('the inventory bound to the new chat; the seeding hook moved to taken', s.stores.dooms_inventory.chat === 'Mara - Scene 5' && s.stores.dooms_hooks.proposed.length === 0 && s.stores.dooms_hooks.taken.length === 1 && s.stores.dooms_hooks.taken[0].title === 'Ask Marit');
    check('the swipe entry for the opener carries the four fields; the committed copy is the generated one', s.tracker.infoBox === t.lastGeneratedData.infoBox && s.tracker.characterThoughts === t.lastGeneratedData.characterThoughts && s.tracker.player && s.tracker.quests.includes('Find the ring') && t.committedTrackerData.infoBox === t.lastGeneratedData.infoBox);
    check('a hook played from the hub is a quest too: in the quests, in both JSON copies and on the opener\'s swipe entry', s.hookQuest === 'Ask Marit about the governor.' && t.quests.optional.includes('Ask Marit about the governor.') && JSON.parse(t.lastGeneratedData.quests).optional.includes('Ask Marit about the governor.') && JSON.parse(t.committedTrackerData.quests).optional.includes('Ask Marit about the governor.') && s.tracker.quests.includes('Ask Marit about the governor.'), JSON.stringify(t.quests));
    const replaced = { ...memory, stores: { ...memory.stores, dooms_hooks: { ...memory.stores.dooms_hooks, proposed: [] } } };    // another round landed while the Start waited: h1 is no longer on offer
    const gone = seedStores(replaced, { chatId: 'Mara - Scene 6', place: 'The quay', cast: [], player: ['Jordan'], hookId: 'h1', hook: { title: 'Ask Marit', text: 'Ask Marit about the governor.' }, now: 600 });
    check('a hook the round no longer holds is recorded as played from what the seed kept of it, and is the quest still', gone.hookQuest === 'Ask Marit about the governor.' && gone.stores.dooms_hooks.taken.some(h => h.id === 'h1' && h.title === 'Ask Marit' && h.at === 600) && gone.stores.dooms_tracker.quests.optional.includes('Ask Marit about the governor.'), JSON.stringify(gone.stores.dooms_hooks));
    const none = seedStores(replaced, { chatId: 'Mara - Scene 6', place: 'The quay', cast: [], player: ['Jordan'], hookId: 'h1', now: 600 });
    check('with nothing kept of it, nothing is recorded', none.hookQuest === '' && !none.stores.dooms_hooks.taken.some(h => h.id === 'h1'));
    const other = seedStores({ ...memory, player: 'Jordan' }, { place: 'The quay', cast: ['Old Marit'], player: ['Someone Else'] });
    const sameOne = seedStores({ ...memory, player: 'Jordan' }, { place: 'The quay', cast: ['Old Marit'], player: ['jordan'] });
    check('the persona\'s vitals are the persona\'s: another persona starts fresh, the same one (case apart) keeps them', other.stores.dooms_tracker.lastGeneratedData.player === null && other.stores.dooms_tracker.committedTrackerData.player === null && sameOne.stores.dooms_tracker.lastGeneratedData.player.includes('64'));
    const bare = seedStores(null, { chatId: 'c', place: 'The quay', cast: ['Someone'], player: 'Jordan' });
    const bareBox = JSON.parse(bare.stores.dooms_tracker.lastGeneratedData.infoBox);
    check('no snapshot (the first scene): a tracker seeded from nothing with the place and the cast', bareBox.location.value === 'The quay' && JSON.parse(bare.stores.dooms_tracker.committedTrackerData.characterThoughts).characters[0].name === 'Someone' && bare.stores.dooms_tracker.quests.main === 'None' && !('dooms_world' in bare.stores));
    const plain = seedStores({ stores: { dooms_tracker: { lastGeneratedData: { infoBox: JSON.stringify({ date: 'Day 1', time: 'dawn', location: 'Home' }), characterThoughts: '[{"name":"A","thoughts":"x"}]' } } }, facts: {} }, { place: 'Away', cast: ['A', 'B'], when: { date: 'Day 2', time: 'noon' } });
    const plainBox = JSON.parse(plain.stores.dooms_tracker.lastGeneratedData.infoBox);
    check('a string-shaped info box stays strings; a bare list of characters stays a list', plainBox.location === 'Away' && plainBox.date === 'Day 2' && plainBox.time === 'noon' && Array.isArray(JSON.parse(plain.stores.dooms_tracker.lastGeneratedData.characterThoughts)));
}

console.log('\n§4 the brief');
{
    check('a person\'s line: the description cut short, else the pack\'s line, else the tier', personLine('Old Marit', { description: 'Keeps the Anchor. '.repeat(30) }).length <= 60 + 2 + 200 && personLine('X', { line: 'the harbourmaster' }) === 'X: the harbourmaster' && personLine('Y', { tier: 'heard' }).includes('heard of') && personLine('Z') === 'Z');
    const brief = buildBrief({ world: 'Harbourside', sceneNo: 5, place: 'Customs house', region: 'The Harbour', date: 'Day 13', time: 'morning', weather: '☀️ clear', gapWords: 'the next day', cast: [{ name: 'Captain Reyes', description: 'Runs the customs house.' }, 'Old Marit: keeps the Anchor'], seed: 'A rumour: the cutter will search every hold tonight.', since: ['Day 13 · The cutter moved to the harbour mouth'], lastRecap: 'Jordan met Marit and learned of the ring.', beforeRecap: 'Jordan arrived.', player: 'Jordan', note: 'find the ring' });
    check('the brief in order: head, where and when, who, the seed, since, last time, before that, the wish; closed', brief.startsWith('[SCENE BRIEF: Harbourside, scene 5.') && brief.includes('Where: Customs house (The Harbour).') && brief.includes('When: Day 13, morning; the next day since the last scene.') && brief.includes('Weather: ☀️ clear.') && brief.includes('Who is here: Captain Reyes: Runs the customs house; Old Marit: keeps the Anchor.') && brief.includes('What brought us here: A rumour') && brief.includes('Since last time: Day 13') && brief.includes('Last time: Jordan met Marit') && brief.includes('Before that: Jordan arrived.') && brief.includes('Jordan wants: find the ring') && brief.endsWith(']'), brief);
    const long = buildBrief({ world: 'W', place: 'P', cast: [{ name: 'A', description: 'a'.repeat(200) }], seed: 's'.repeat(400), since: Array.from({ length: 12 }, (_, i) => `line ${i} `.repeat(10)), lastRecap: 'l'.repeat(1500), beforeRecap: 'b'.repeat(1500), note: 'n'.repeat(300) });
    check(`the brief never passes ${MAX_BRIEF} characters, the older parts cut first (before that goes before last time does)`, long.length <= MAX_BRIEF && !long.includes('Before that') && long.includes('Last time') && long.includes('Who is here') && long.endsWith(']'), String(long.length));
    check('an empty brief is still a brief', buildBrief({}) === '[SCENE BRIEF: the world.]');
}

console.log('\n§5 the openers');
{
    const p = buildOpenersPrompt({ world: { name: 'Harbourside', blurb: 'A port under a blockade.', template: 'Second person, present tense.' }, place: 'Customs house', region: 'The Harbour', weather: '☀️ clear', date: 'Day 12', time: 'evening', gapWords: 'the next day', cast: [{ name: 'Captain Reyes', tier: 'known' }], seed: 'The cutter will search every hold.', canonBlock: buildCanonBlock(memory.stores.dooms_canon), recaps: ['Jordan met Marit.', 'Jordan arrived.'], quests: { main: 'Find the ring', optional: ['Pay'] }, player: 'Jordan', note: 'find the ring' });
    check('the request names the world, the spot, the gap, the people, the seed, the ledger, last time, the quests, the wish, the rules and the JSON shape', p.system.includes('narrator of Harbourside') && p.system.includes('"openers"') && p.system.includes('Second person, present tense.') && p.system.includes('Never speak or act for Jordan') && p.user.includes('Customs house (The Harbour)') && p.user.includes('this scene opens the next day') && p.user.includes('Captain Reyes: someone the player knows') && p.user.includes('The cutter will search') && p.user.includes('[CANON') && p.user.includes('Last scene: Jordan met Marit.') && p.user.includes('Before that: Jordan arrived.') && p.user.includes('Main: Find the ring; Pay') && p.user.includes('Jordan wants from this scene: find the ring'), p.user);
    const reply = '```json\n{"when":{"date":"Day 13","time":"morning"},"openers":[{"title":"The queue","text":"The customs house is busy. Reyes looks up. What do you do?","who":["Captain Reyes","Nobody"]},{"title":"","text":"Rain stopped overnight. Marit waits by the door.","who":["old marit"]},{"text":"The customs house is busy. Reyes looks up. What do you do?"},{"title":"Four","text":"A fourth one."}]}\n```';
    const parsed = parseOpenersReply(reply);
    const v = validateOpeners(parsed, { cast: ['Captain Reyes'], known: ['Old Marit'] });
    check('read and checked: three at most, a repeat dropped, a title made from the first sentence, who cut to the known, when taken whole', v.ok && v.clean.openers.length === 3 && v.clean.openers[0].who.length === 1 && v.clean.openers[0].who[0] === 'Captain Reyes' && v.clean.openers[1].title === 'Rain stopped overnight' && v.clean.openers[1].who[0] === 'Old Marit' && v.clean.openers[2].title === 'Four' && v.errors.length === 1 && same(v.clean.when, { date: 'Day 13', time: 'morning' }), JSON.stringify(v));
    const bad = validateOpeners(parseOpenersReply('{"openers":[{"title":"x","text":""},{"text":"<details>hidden</details>"}]}'));
    check('nothing usable fails with its reasons; no object fails', !bad.ok && bad.errors.length === 2 && !validateOpeners(parseOpenersReply('no json here')).ok);
    const lone = validateOpeners(parseOpenersReply('{"title":"One","text":"A single opener as a bare object."}'));
    check('a single opener as a bare object is read; when missing is null', lone.ok && lone.clean.openers.length === 1 && lone.clean.when === null);
    const longText = validateOpeners({ openers: [{ title: 't', text: 'A sentence. '.repeat(300) }] });
    check(`a text over ${MAX_OPENER_TEXT} is cut at a sentence`, longText.ok && longText.clean.openers[0].text.length <= MAX_OPENER_TEXT && longText.clean.openers[0].text.endsWith('.'));
    const tracker = { quests: '{"main":"Find the ring","optional":[]}', infoBox: '{"date":"Day 13"}', characterThoughts: '{"characters":[]}', player: null };
    const msg = openerMessage({ name: 'Mara', openers: v.clean.openers, chosen: 1, sendDate: 'now', tracker, title: 'Rain stopped' });
    check('the first message: the chosen in front, the others as swipes, the tracker data on every swipe, the mark on it', msg.name === 'Mara' && msg.is_user === false && msg.is_system === false && msg.mes.startsWith('Rain stopped') && msg.swipe_id === 0 && msg.swipes.length === 3 && msg.swipes[1].startsWith('The customs house') && msg.swipe_info.length === 3 && same(msg.extra.dooms_tracker_swipes[2], tracker) && same(msg.swipe_info[1].extra.dooms_tracker_swipes[1], tracker) && msg.extra[HUB_META_KEY].opener === true && msg.extra[HUB_META_KEY].title === 'Rain stopped', JSON.stringify(msg).slice(0, 300));
    check('no openers, no message; no tracker, no swipe data', openerMessage({ openers: [] }) === null && !('dooms_tracker_swipes' in openerMessage({ openers: [{ title: 'a', text: 'b' }] }).extra));
    check('a scene\'s title: the opener\'s, else the seed\'s, else the place\'s', sceneTitle({ opener: { title: 'The queue' }, seed: { label: 'x' } }) === 'The queue' && sceneTitle({ seed: { kind: 'rumour', text: 'The cutter will search every hold tonight, they say.' } }).length <= 60 && sceneTitle({ place: 'The quay' }) === 'The quay' && sceneTitle({}) === 'A scene');
    check(`at most ${OPENERS} openers asked for`, buildOpenersPrompt({ count: 9 }).system.includes('Write 3 openers') && buildOpenersPrompt({ count: 1 }).system.includes('Write 1 opener that'));
}

console.log('\n§6 the file');
{
    const mark = hubMark({ world: 'harbourside', scene: 's5', title: 'The queue', seed: { kind: 'rumour', text: 'The cutter…' }, place: { id: 'customs-house', label: 'Customs house', region: 'The Harbour' }, cast: ['Captain Reyes'], gap: { id: 'tomorrow' }, startedAt: 7, startDate: 'Day 13' });
    check('the mark: the world, the scene, the title, the seed, the place, the cast, the gap, the start; not ended', mark.world === 'harbourside' && mark.scene === 's5' && mark.seed.kind === 'rumour' && mark.place.label === 'Customs house' && mark.gap.words === 'the next day' && mark.startDate === 'Day 13' && mark.endedAt === 0);
    const ended = markEnded(mark, { endedAt: 9, endDate: 'Day 13, noon' });
    check('the mark ended, and read back from a chat\'s metadata; a chat without one is not a scene', ended.endedAt === 9 && readMark({ [HUB_META_KEY]: ended }).endDate === 'Day 13, noon' && readMark({ [HUB_META_KEY]: { world: 'w' } }) === null && readMark({}) === null);
    const header = sceneHeader({ stores: seedStores(memory, { chatId: 'Mara - Scene 5', place: 'Customs house', cast: ['Captain Reyes'] }).stores, mark, scenario: '[SCENE BRIEF…]', worldInfo: 'Canon of Harbourside', integrity: 'abc-123', persona: 'jordan.png' });
    check('the header: SillyTavern\'s two unused names, the stores (the map with them), the mark, the brief as the scenario, the world\'s book, the integrity id, tainted', header.user_name === 'unused' && header.character_name === 'unused' && HUB_KEYS.every(k => k in header.chat_metadata) && header.chat_metadata[HUB_META_KEY].scene === 's5' && header.chat_metadata.scenario === '[SCENE BRIEF…]' && header.chat_metadata.world_info === 'Canon of Harbourside' && header.chat_metadata.integrity === 'abc-123' && header.chat_metadata.tainted === true && header.chat_metadata.persona === 'jordan.png', Object.keys(header.chat_metadata).join(','));
    check('no persona, no lock; the mark keeps the brief', !('persona' in sceneHeader({ stores: {}, mark }).chat_metadata) && hubMark({ world: 'w', scene: 's1', brief: '[SCENE BRIEF: W.]' }).brief === '[SCENE BRIEF: W.]' && readMark({ [HUB_META_KEY]: hubMark({ world: 'w', scene: 's1', brief: 'b' }) }).brief === 'b');
    const marked = hubMark({ world: 'harbourside', scene: 's5', file: 'Scene 5 - The queue' });
    check('the mark names its file; a mark under another file is a branch, not the scene; a mark from before the file was recorded is trusted', marked.file === 'Scene 5 - The queue' && markIsOfFile(marked, 'Scene 5 - The queue.jsonl') && !markIsOfFile(marked, 'Scene 5 - The queue (branch)') && markIsOfFile(hubMark({ world: 'w', scene: 's1' }), 'anything'));
    const endedMark = markEnded(marked, { endedAt: 5, endDate: 'Day 6', end: { canonAt: 'r9' } });
    check('the mark remembers the ledger\'s read; a reopen keeps it until the next End', readMark({ [HUB_META_KEY]: endedMark }).end.canonAt === 'r9' && markEnded(endedMark, { endedAt: 0, endDate: '' }).end.canonAt === 'r9' && markEnded(endedMark, { end: null }).end === null);
    check('no book, no key; the stores are copies', !('world_info' in sceneHeader({ stores: {}, mark }).chat_metadata) && header.chat_metadata.dooms_world !== memory.stores.dooms_world);
    check('the file name: safe, numbered, free among the card\'s chats', sceneFileName(5, 'The queue: "a" <test>/?') === 'Scene 5 - The queue a test' && sceneFileName(1, 'A', ['scene 1 - a.jsonl']) === 'Scene 1 - A (2)' && sceneFileName(1, 'A', ['Scene 1 - A', 'Scene 1 - A (2)']) === 'Scene 1 - A (3)' && sceneFileName(0, '') === 'Scene 1 - A scene');
}

console.log('\n§7 the recap');
{
    const chat = [
        { name: 'Mara', is_user: false, mes: 'The customs house is busy. <think>hidden</think>' },
        { name: 'Jordan', is_user: true, mes: 'I ask Reyes about the ring. [CHECK: Persuasion]' },
        { name: 'Mara', is_user: false, is_system: true, mes: 'a picture' },
        { name: 'Mara', is_user: false, mes: 'Reyes denies everything.\n```json\n{"tracker":1}\n```' },
    ];
    const t = sceneTranscript(chat, { persona: 'Jordan' });
    check('the transcript: the system message and the noise out, the speakers named, the order kept', t === 'Mara: The customs house is busy.\nJordan: I ask Reyes about the ring.\nMara: Reyes denies everything.', t);
    const small = sceneTranscript(Array.from({ length: 50 }, (_, i) => ({ name: 'N', is_user: false, mes: `line ${i} ` + 'x'.repeat(1000) })), { budget: 3000 });
    check('the budget keeps the newest', small.split('\n').length <= 3 && small.includes('line 49'));
    const pages = sceneTranscriptPages(Array.from({ length: 50 }, (_, i) => ({ name: 'N', is_user: false, mes: `line ${i} ` + 'x'.repeat(1000) })), { budget: 6000 });
    check('a long scene in pages, oldest first, the oldest beyond four passes not read', pages.length === 4 && pages[0].includes('line 30 ') && !pages[0].includes('line 29 ') && pages[3].includes('line 49 ') && pages.every(p => p.length <= 6000), String(pages.length));
    check('a short scene is one page', sceneTranscriptPages(chat, { persona: 'Jordan' }).length === 1 && sceneTranscriptPages(chat, { persona: 'Jordan' })[0] === t);
    const pass = buildRecapPrompt({ transcript: 'later', brief: '', player: 'Jordan', maxChars: 600, soFar: 'Jordan arrived.', last: false });
    check('a pass carries the record so far and says the scene continues', pass.system.includes('record so far') && pass.system.includes('not the end of the scene') && pass.user.includes('The record so far:\nJordan arrived.'));
    const p = buildRecapPrompt({ transcript: t, brief: '[SCENE BRIEF: W.]', player: 'Jordan', maxChars: 600 });
    check('the request: the JSON asked for, the length, the player by name, the brief and the scene', p.system.includes('{"recap"') && p.system.includes('600 characters') && p.system.includes('Jordan by name') && p.user.includes('[SCENE BRIEF: W.]') && p.user.includes('Reyes denies everything.'));
    check('the reply read: the JSON\'s recap, or prose, cut to the length; nothing is a failure', parseRecapReply('```json\n{"recap":"Jordan asked Reyes about the ring; he denied it."}\n```').recap === 'Jordan asked Reyes about the ring; he denied it.' && parseRecapReply('Jordan asked. Reyes denied.').recap === 'Jordan asked. Reyes denied.' && parseRecapReply('{"recap":"' + 'A sentence. '.repeat(100) + '"}', { maxChars: 100 }).recap.length <= 100 && !parseRecapReply('').ok && !parseRecapReply('{"other":1}').ok);
}

console.log('\n§8 the scene records');
{
    let entry = normalizeWorldEntry({ card: 'Mara.png' });
    let r = openScene(entry, { title: 'The queue', seed: { kind: 'place', id: 'customs-house', label: 'Customs house' }, place: { id: 'customs-house', label: 'Customs house', region: 'The Harbour' }, cast: ['Captain Reyes'], gap: { id: 'tomorrow' }, chat: 'Scene 1 - The queue', card: 'Mara.png', startedAt: 1, startDate: 'Day 13' });
    entry = r.entry;
    check('a scene opened: s1, open, its record whole', r.scene.id === 's1' && r.scene.status === 'open' && openSceneOf(entry).id === 's1' && r.scene.place.region === 'The Harbour' && r.scene.gap.words === 'the next day' && entry.seq === 1);
    r = openScene(entry, { title: 'Second', chat: 'Scene 2 - Second' });
    entry = r.entry;
    check('a second opened sets the first aside: one open scene at a time', openSceneOf(entry).id === 's2' && asideScenes(entry).length === 1 && asideScenes(entry)[0].id === 's1');
    entry = resumeScene(entry, 's1').entry;
    check('resume the first: open again, the second aside', openSceneOf(entry).id === 's1' && entry.scenes.find(s => s.id === 's2').status === 'aside');
    entry = setSceneAside(entry, 's1').entry;
    check('set aside by hand: nothing open', openSceneOf(entry) === null && asideScenes(entry).length === 2);
    entry = resumeScene(entry, 's2').entry;
    entry = endSceneRecord(entry, 's2', { endedAt: 5, endDate: 'Day 14', recap: 'Jordan paid the harbourmaster.' }).entry;
    check('ended: the status, the dates, the recap; the last recaps newest first', entry.scenes.find(s => s.id === 's2').status === 'ended' && entry.scenes.find(s => s.id === 's2').endDate === 'Day 14' && same(lastRecaps(entry), ['Jordan paid the harbourmaster.']) && openSceneOf(entry) === null);
    const noRecap = endSceneRecord(entry, 's1', { endedAt: 6, recap: '' }).entry.scenes.find(s => s.id === 's1');
    check('ended without a recap says so', noRecap.status === 'ended' && noRecap.noRecap === true);
    entry = reopenScene(entry, 's2').entry;
    check('reopen: open again and marked reopened; a scene not ended is not reopened', openSceneOf(entry).id === 's2' && entry.scenes.find(s => s.id === 's2').reopened === true && entry.scenes.find(s => s.id === 's2').endedAt === 0 && reopenScene(entry, 's1').entry.scenes.find(s => s.id === 's1').status === 'aside');
    check('a scene by its chat file, with or without the extension', sceneByChat(entry, 'Scene 2 - Second.jsonl').id === 's2' && sceneByChat(entry, 'scene 1 - the queue').id === 's1' && sceneByChat(entry, 'nothing') === null);
    entry = markChatGone(entry, 'Scene 2 - Second').entry;
    check('a chat gone: the record stays, marked, no longer open; it cannot be resumed or reopened', entry.scenes.find(s => s.id === 's2').gone === true && entry.scenes.find(s => s.id === 's2').status === 'aside' && resumeScene(entry, 's2').entry.scenes.find(s => s.id === 's2').status === 'aside');
    entry = renameSceneChat(entry, 'Scene 1 - The queue', 'Scene 1 - Renamed.jsonl').entry;
    check('a chat renamed: the record follows', sceneByChat(entry, 'Scene 1 - Renamed').id === 's1');
    const removed = removeGoneScene(entry, 's2');
    check('a gone record can be removed; a standing one cannot', removed.removed && removed.entry.scenes.length === 1 && removeGoneScene(entry, 's1').removed === false);
    const mark = hubMark({ world: 'harbourside', scene: 's9', title: 'Found', place: { label: 'The quay' }, startedAt: 3, startDate: 'Day 15' });
    const rec = reconcileScenesWithChats(removed.entry, [{ file: 'Scene 1 - Renamed.jsonl', meta: { [HUB_META_KEY]: readMark({ [HUB_META_KEY]: hubMark({ world: 'harbourside', scene: 's1' }) }) } }, { file: 'Scene 9 - Found', meta: { [HUB_META_KEY]: markEnded(mark, { endedAt: 4, endDate: 'Day 15' }) } }, { file: 'Mara - 2026-11-02@21h00m00s000ms', meta: { other: 1 } }, { file: 'Scene 3 - Other world', meta: { [HUB_META_KEY]: hubMark({ world: 'elsewhere', scene: 's3' }) } }], 'harbourside');
    check('against the card\'s chats: a marked chat no record names comes back (ended when the mark says so); a plain chat and another world\'s chat do not', rec.changed === 1 && rec.entry.scenes.length === 2 && rec.entry.scenes[1].id === 's9' && rec.entry.scenes[1].status === 'ended' && rec.entry.scenes[1].title === 'Found' && rec.entry.scenes[1].chat === 'Scene 9 - Found' && rec.entry.seq === 9, JSON.stringify(rec.entry.scenes.map(s => [s.id, s.status, s.chat])));
    const gone = reconcileScenesWithChats(rec.entry, [{ file: 'Scene 9 - Found' }], 'harbourside');
    check('a record whose file is missing is marked gone; a file back again clears it', gone.entry.scenes.find(s => s.id === 's1').gone === true && reconcileScenesWithChats(gone.entry, [{ file: 'Scene 1 - Renamed' }, { file: 'Scene 9 - Found' }], 'harbourside').entry.scenes.find(s => s.id === 's1').gone === false);
    const branch = reconcileScenesWithChats(rec.entry, [{ file: 'Scene 1 - Renamed' }, { file: 'Scene 9 - Found' }, { file: 'Scene 9 - Found (branch)', meta: { [HUB_META_KEY]: { ...markEnded(mark, { endedAt: 4 }), file: 'Scene 9 - Found' } } }], 'harbourside');
    check('a branch of a scene (its mark naming another file that is still there) is not brought back as a scene', branch.changed === 0 && branch.entry.scenes.length === 2);
    const renamed = reconcileScenesWithChats(rec.entry, [{ file: 'Scene 1 - Renamed' }, { file: 'Scene 9 - Found again', meta: { [HUB_META_KEY]: { ...markEnded(mark, { endedAt: 4 }), file: 'Scene 9 - Found' } } }], 'harbourside');
    check('a renamed scene (its mark naming a file that is gone) is the scene under its new name: the record follows, nothing doubled', renamed.changed >= 1 && renamed.entry.scenes.length === 2 && renamed.entry.scenes[1].chat === 'Scene 9 - Found again' && renamed.entry.scenes[1].gone === false && renamed.entry.scenes[1].status === 'ended', JSON.stringify(renamed.entry.scenes.map(s => [s.id, s.chat, s.gone])));
    const mem = { takenAt: 100 };
    check('a scene is stale when the memory was written after it began', isStaleScene({ startedAt: 50 }, mem) && !isStaleScene({ startedAt: 150 }, mem) && !isStaleScene({ startedAt: 50 }, null) && !isStaleScene({ startedAt: 0 }, mem));
}

console.log('\n§8b a chat taken as where the scenes of a world begin (D131, D172)');
{
    let entry = normalizeWorldEntry({ card: 'Narrator.png', campaign: 'camp_first-descent' });
    check('a world\'s entry keeps the campaign it is the scenes of; a world of its own has none', entry.campaign === 'camp_first-descent' && normalizeWorldEntry({}).campaign === '' && normalizeHub({ worlds: { w: { campaign: 'c1' } } }).worlds.w.campaign === 'c1');
    let r = adoptScene(entry, { chat: 'First Descent - 2026-10-01', card: 'Narrator.png', recap: 'The company went down to the Fourth Landing and came back with the inkstone.', place: { label: 'Hask' }, endDate: 'Day 41', endedAt: 500 });
    entry = r.entry;
    check('the chat is scene 0: ended, named, with its record, its chat and where it stopped; no scene is counted for it', r.scene.id === ADOPTED_ID && r.scene.id === 's0' && r.scene.status === 'ended' && r.scene.title === ADOPTED_TITLE && r.scene.chat === 'First Descent - 2026-10-01' && r.scene.place.label === 'Hask' && r.scene.endDate === 'Day 41' && r.scene.noRecap === false && entry.scenes.length === 1 && entry.seq === 0 && openSceneOf(entry) === null);
    check('its record is what the first scene is told happened last time', same(lastRecaps(entry), ['The company went down to the Fourth Landing and came back with the inkstone.']));
    r = openScene(entry, { title: 'The gate at dusk', chat: 'Scene 1 - The gate at dusk' });
    entry = endSceneRecord(r.entry, 's1', { endedAt: 900, endDate: 'Day 42', recap: 'They argued at the gate.' }).entry;
    check('the first scene after it is scene 1', r.scene.id === 's1' && entry.seq === 1 && same(entry.scenes.map(x => x.id), ['s0', 's1']));
    r = adoptScene(entry, { chat: 'First Descent - 2026-10-01', card: 'Narrator.png', recap: 'Longer now: the company also met the assay court.', endDate: 'Day 44', endedAt: 1200 });
    check('taken again, scene 0 is replaced where it stood and the scenes played since stay', same(r.entry.scenes.map(x => x.id), ['s0', 's1']) && r.entry.scenes[0].recap.startsWith('Longer now') && r.entry.scenes[0].endDate === 'Day 44' && r.entry.scenes[1].recap === 'They argued at the gate.' && r.entry.seq === 1 && r.entry.campaign === 'camp_first-descent' && r.entry.card === 'Narrator.png');
    check('a chat taken with no record written says so and gives the next scene nothing to be told', (() => { const e = adoptScene(normalizeWorldEntry({}), { chat: 'x' }).entry; return e.scenes[0].noRecap === true && lastRecaps(e).length === 0; })());
    check('the entry survives being stored and read back', same(normalizeWorldEntry(JSON.parse(JSON.stringify(r.entry))), r.entry));
    check('the copy saved before a chat is taken is named after the chat, says what it is, and never takes a name in use (D175)', backupFileName('First Descent - 2026-10-01@20h00m') === 'First Descent - 2026-10-01@20h00m - before scenes' && backupFileName('First Descent.jsonl', ['First Descent - before scenes.jsonl']) === 'First Descent - before scenes (2)' && backupFileName('First Descent', ['first descent - BEFORE scenes', 'First Descent - before scenes (2)']) === 'First Descent - before scenes (3)' && backupFileName('a/b:c?', []) === 'a b c - before scenes' && backupFileName('', []) === 'Chat - before scenes');
    const other = adoptScene(normalizeWorldEntry({ card: 'Narrator.png' }), { chat: 'A side chat', card: 'Someone Else.png', recap: 'x' }).entry;
    check('a chat taken from a card that is not the narrator\'s is not called gone when the narrator\'s chats are looked over; under the narrator\'s own card it is', reconcileScenesWithChats(other, [{ file: 'Scene 1 - x' }], 'w', { card: 'Narrator.png' }).entry.scenes[0].gone === false && reconcileScenesWithChats(r.entry, [{ file: 'Scene 1 - The gate at dusk' }], 'w', { card: 'Narrator.png' }).entry.scenes[0].gone === true && reconcileScenesWithChats(r.entry, [{ file: 'First Descent - 2026-10-01.jsonl' }, { file: 'Scene 1 - The gate at dusk' }], 'w', { card: 'Narrator.png' }).changed === 0);
}

console.log('\n§8c the people\'s own notes, from the lorebooks (D177)');
{
    const kiyoha = 'KIYOHA — the company\'s front line, a barbarian of the Redward. An ONI: deep crimson skin, two short polished black horns. Big, loud, quick to laugh and quicker to temper. Blunt, never cruel.';
    const book = { entries: {
        0: { uid: 0, key: ['Hask', 'the city'], comment: 'FD: HASK — the city', content: 'Hask is a landlocked walled city.', order: 100 },
        11: { uid: 11, key: ['Kiyoha', 'oni', 'the axe', 'barbarian'], comment: 'Kiyoha — who she is', content: kiyoha, order: 90 },
        12: { uid: 12, key: ['Lysandra', 'kitsune', 'ink mage'], comment: 'Lysandra — who she is', content: 'LYSANDRA — the company\'s mage, an INK MAGE. Cool, composed, a slight knowing smile; asks questions like an examiner.', order: 90 },
        13: { uid: 13, key: ['Nikko', 'Yukine'], comment: 'Nikko & Yukine — the twins', content: 'The twins finish each other\'s sentences.', order: 80 },
        14: { uid: 14, key: ['the axe'], comment: 'The great axe', content: 'Kiyoha\'s axe has a name she will not say.', order: 70 },
        15: { uid: 15, key: ['Dagger'], comment: 'Dagger — who she is', content: 'Switched off.', disable: true },
        16: { uid: 16, key: ['Morzan', 'the healer'], comment: 'FD: MORZAN REDFALL', content: 'Morzan is the company\'s new healer.', order: 100 },
        17: { uid: 17, key: [], comment: 'Empty', content: '   ' },
    } };
    const continuity = { entries: {
        0: { uid: 0, key: [], comment: 'STORY CANON', content: 'TAILS RULING: she has three. STYLE LAW: "sweetheart" is banned.', constant: true, order: 100 },
        1: { uid: 1, key: [], comment: 'STORY LEDGER', content: 'Settled: the inkstone is Lysandra\'s. Open: the assay court\'s summons.', constant: true, order: 90 },
        2: { uid: 2, key: ['Solveig'], comment: 'Solveig — who she is', content: 'Solveig keeps the stair rule.', constant: true, order: 50 },
    } };
    const entries = [...loreEntries('FD - Campaign Complete', book), ...loreEntries('FD - Continuity', continuity)];
    check('a lorebook read as a plain list: the switched-off and the empty left out, each with its book, title, keys, text, whether it is always on, and its order', entries.length === 9 && !entries.some(x => x.title === 'Dagger — who she is' || x.title === 'Empty') && entries[1].book === 'FD - Campaign Complete' && same(entries[1].keys, ['Kiyoha', 'oni', 'the axe', 'barbarian']) && entries[1].constant === false && entries[6].constant === true && entries[6].order === 100 && loreEntries('x', null).length === 0 && loreEntries('x', [{ comment: 'a', content: 'b' }]).length === 1);
    const cast = castLore(entries, ['Kiyoha', 'Lysandra Vale', 'Dagger', 'Yukine', 'Nikko', 'Solveig', 'A Stranger']);
    check('each person\'s own entry is the one whose title begins with their name, not one that only mentions them', cast.found[0].name === 'Kiyoha' && cast.found[0].title === 'Kiyoha — who she is' && cast.found[0].text.startsWith('KIYOHA') && cast.found[0].book === 'FD - Campaign Complete');
    check('a longer name finds the entry by its first word; an entry found by its keys alone is taken; two people who share one get it once', cast.found[1].name === 'Lysandra Vale' && cast.found[1].title === 'Lysandra — who she is' && cast.found[2].name === 'Yukine' && cast.found[2].title === 'Nikko & Yukine — the twins' && cast.found.length === 3);
    check('who has no entry is said; an entry that is switched off is not theirs; one that is always on counts as found and is left to the standing notes', same(cast.missing, ['Dagger', 'A Stranger']) && !cast.found.some(f => f.name === 'Solveig'));
    check('an entry is cut to a length, and the people\'s together to a total', (() => { const long = [{ book: 'b', title: 'Ann — who she is', keys: ['Ann'], content: 'x'.repeat(9000), constant: false, order: 1 }, { book: 'b', title: 'Bea — who she is', keys: ['Bea'], content: 'y'.repeat(9000), constant: false, order: 1 }]; const c = castLore(long, ['Ann', 'Bea'], { perPerson: 1000, total: 1500 }); return c.found.length === 2 && c.found[0].text.length <= 1000 && c.found[1].text.length <= 500 && castLore(long, ['Ann']).found[0].text.length <= LORE_PER_PERSON; })());
    const standing = standingLore(entries);
    check('the standing notes: the entries that are always on, the weightiest first, within a length', standing.startsWith('STORY CANON: TAILS RULING') && standing.indexOf('STORY LEDGER') > standing.indexOf('STORY CANON') && standing.indexOf('Solveig keeps the stair rule') > standing.indexOf('STORY LEDGER') && !standing.includes('KIYOHA') && standingLore(entries, { max: 260 }).length <= 260 && standingLore([]) === '' && standing.length <= LORE_STANDING);
    const base = { world: { name: 'First Descent' }, place: 'Hask', cast: ['Kiyoha: the front line', 'Dagger'], player: 'Morzan' };
    const plain = buildOpenersPrompt(base);
    const rich = buildOpenersPrompt({ ...base, lore: cast.found.slice(0, 2).map(f => ({ name: f.name, text: f.text })), standing });
    check('the openings\' request carries each person\'s notes under their name and the standing notes, and is told to write each person as their notes say, no two alike', rich.user.includes('Their own notes:\n[Kiyoha] KIYOHA — the company\'s front line') && rich.user.includes('[Lysandra Vale] LYSANDRA') && rich.user.includes('The story\'s standing notes:\nSTORY CANON: TAILS RULING') && rich.user.indexOf('Their own notes:') > rich.user.indexOf('People here:') && rich.user.indexOf('What brought us here:') > rich.user.indexOf('The story\'s standing notes:') && /their own manner and their own way of speaking, so that no two of them sound alike/.test(rich.system) && /standing notes hold over anything else/.test(rich.system));
    check('with no lorebook read the request is exactly as it was', !plain.user.includes('Their own notes') && !plain.user.includes('standing notes') && !/own notes/.test(plain.system) && same(buildOpenersPrompt({ ...base, lore: [], standing: '' }), plain));
}

console.log('\n§9 the lines');
{
    const entry = normalizeWorldEntry({ card: 'Mara.png', memory: { stores: { dooms_world: {} }, facts: { date: 'Day 14', time: 'noon' } }, scenes: [{ id: 's1', status: 'ended', recap: 'r' }, { id: 's2', status: 'aside' }, { id: 's3', status: 'open', place: { label: 'The quay' }, startDate: 'Day 14' }] });
    check('the status line: narrated, counted, the open scene', hubStatusLine({ worldName: 'Harbourside', entry, cardName: 'Mara' }) === 'Harbourside: narrated by Mara; 1 scene played, 1 set aside; scene 3 open at The quay since Day 14.', hubStatusLine({ worldName: 'Harbourside', entry, cardName: 'Mara' }));
    check('no card: says so; no open scene: the world\'s date', hubStatusLine({ worldName: 'W', entry: null }).includes('no narrator card') && hubStatusLine({ worldName: 'W', entry: setSceneAside(entry, 's3').entry }).endsWith("the world's date is Day 14, noon."));
    check('start and end described', describeStartResult({ ok: true, scene: { id: 's3', place: { label: 'The quay' } } }) === 'Scene 3 is open at The quay.' && describeStartResult({ ok: false, reason: 'scene-open' }).includes('still open') && describeStartResult({ ok: false, reason: 'weird', error: 'boom' }).includes('boom') && describeEndResult({ ok: true, recap: 'kept', canon: 'ok', world: 'skipped', book: 'ok' }) === 'The scene is ended and remembered (the recap kept, the ledger read, the world not moved, the book mirrored).' && describeEndResult({ ok: false, reason: 'changed' }).includes('end it again'));
}

console.log(failures ? `\n${failures} FAILED` : '\nall pass');
process.exit(failures ? 1 : 0);
