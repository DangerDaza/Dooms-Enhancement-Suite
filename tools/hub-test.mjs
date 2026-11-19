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
    sceneTranscript, sceneTranscriptPages, sceneTranscriptParts, sceneMenuModel, sceneTail, TAIL, buildOpenersPrompt as openersPromptOf, buildRecapPrompt, parseRecapReply, ledgerOfReply, LEDGER_ADDS, LEDGER_DROPS, sceneCardFields, sceneCardTag, markCardsGone, SCENE_NARRATOR_NAME, lastTrackerFacts, timeReached, presentFromTracker, PRESENT_LINE, isStaleScene, markIsOfFile,
    openSceneOf, asideScenes, openScene, setSceneAside, resumeScene, endSceneRecord, reopenScene, sceneByChat, markChatGone, renameSceneChat, removeGoneScene, reconcileScenesWithChats, lastRecaps,
    canDeleteScene, deleteKind, deleteSceneRecord, describeDeleteResult,
    hubStatusLine, describeStartResult, describeEndResult, adoptScene, ADOPTED_ID, ADOPTED_TITLE, backupFileName,
    loreEntries, castLore, standingLore, LORE_PER_PERSON, LORE_STANDING, sceneLength, sceneIsLong, continuationSeed,
    ownWorlds, campaignWorldId, campaignsOf, activeCampaignOf, activeCampaignWorldId, worldsByCampaign, loreLibraryOn,
    STORY_SEP, packOf, entryUntouched, storyIdsOf, nextStoryId, storyOfChat, storyPlayedAt, lastStoryOf, storiesOf,
    MAX_NOTE, BRIEF_NOTE, MAX_WRAP, readDirection, describeDirection,
    MAX_OPENERS, openersCount, countWord, startStepWords, elapsedWords, asksForLore, loreEntryName, untouchedLore, loreSample, freshCount, LORE_FRESH_EACH, OPENER_LENGTHS, openerLength,
} from '../src/utils/hub.js';
import { normalizePack, seedWorldState, countMessage, applyAdvance, reconcileWithChat, seenInScene } from '../src/utils/liveWorld.js';
import { visitPlace, reconcileVisited } from '../src/utils/worldMap.js';
import { emptyCanon, applyCanon, countCanonReply, reconcileCanon, buildCanonBlock, buildCanonPrompt, canonAsk } from '../src/utils/canon.js';
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
    check('defaults: later that day, 600 characters, the count of repeated phrases off, no bar above a scene\'s chat, a narrator card for every scene', same(defaultHubConfig(), { gap: 'later', recapChars: 600, styleLaw: false, nudgeAt: 60, strip: false, sceneCards: true, openers: 3, openerLength: 'narrator' }));
    check('a card for every scene is on unless switched off, by exactly that; the setting is kept with the hub\'s', hubConfig({}).sceneCards === true && hubConfig({ hub: { sceneCards: false } }).sceneCards === false && hubConfig({ hub: { sceneCards: 'no' } }).sceneCards === true && normalizeHub({ sceneCards: false }).sceneCards === false);
    check('a fresh chat is suggested after sixty messages unless the player says otherwise: any number from 0 (never) to 500', hubConfig({}).nudgeAt === 60 && hubConfig({ hub: { nudgeAt: 0 } }).nudgeAt === 0 && hubConfig({ hub: { nudgeAt: '80' } }).nudgeAt === 80 && hubConfig({ hub: { nudgeAt: 9999 } }).nudgeAt === 500 && hubConfig({ hub: { nudgeAt: -5 } }).nudgeAt === 0 && hubConfig({ hub: { nudgeAt: 'soon' } }).nudgeAt === 60 && hubConfig({ hub: { nudgeAt: '' } }).nudgeAt === 60);
    check('the count of repeated phrases is on only when switched on, by exactly that', hubConfig({}).styleLaw === false && hubConfig({ hub: { styleLaw: true } }).styleLaw === true && hubConfig({ hub: { styleLaw: 'yes' } }).styleLaw === false && hubConfig({ hub: { styleLaw: 1 } }).styleLaw === false);
    check('no settings: the defaults', same(hubConfig(null), defaultHubConfig()) && same(hubConfig({ hub: 'x' }), defaultHubConfig()));
    // The strip above a scene's chat (D200): off unless asked for, or unless the Doom button's menu cannot be reached.
    check('nothing is put above a scene\'s chat unless the player asks for the bar', hubConfig({}).strip === false && hubConfig({ hub: { strip: true } }).strip === true && hubConfig({ hub: { strip: 'yes' } }).strip === false && hubConfig({ fab: { hidden: false, bypassFlyout: false } }).strip === false);
    check('never asked, the bar shows where the Doom button\'s menu cannot be reached (the button hidden, or set to open Settings); the player\'s word stands over that', hubConfig({ fab: { hidden: true } }).strip === true && hubConfig({ fab: { bypassFlyout: true } }).strip === true && hubConfig({ hub: { strip: false }, fab: { hidden: true } }).strip === false);
    check('where three taps on the screen open the menu it is reached with no button at all, so the bar stays off (D201)', hubConfig({ fab: { hidden: true, knock: 'menu' } }).strip === false && hubConfig({ fab: { bypassFlyout: true, knock: 'menu' } }).strip === false && hubConfig({ fab: { hidden: true, knock: 'button' } }).strip === true);
    {
        const mark = { scene: 's3', title: 'The gate at dusk', place: { label: 'Hask, the gate' }, startDate: 'Day 42', endDate: 'Day 42, night' };
        const open = sceneMenuModel({ mark, ended: false, count: 12 });
        check('the scene in front for the Doom button\'s menu: one entry named for it, which scene it is, where and when and how long, and Continue fresh and End scene', open.label === 'Scene 3' && open.line === 'Scene 3: The gate at dusk' && open.where === 'Hask, the gate · Day 42 · 12 messages' && same(open.items.map(x => [x.id, x.label, x.off, x.lit]), [['continue', 'Continue fresh', false, false], ['end', 'End scene 3', false, false]]) && open.nudge === '' && open.long === false && open.busy === false, JSON.stringify(open));
        const long = sceneMenuModel({ mark, ended: false, count: 80, long: true });
        check('a scene that has run long says a fresh chat is due and lights Continue fresh', long.long === true && long.nudge === 'A good place to go on in a fresh chat.' && long.items[0].lit === true && long.items[1].lit === false && long.where.endsWith('80 messages'));
        const busy = sceneMenuModel({ mark, ended: false, count: 80, long: true, busy: 'Writing the record…' });
        check('while a handover runs the menu says what is being done and nothing can be pressed', busy.line === 'Writing the record…' && busy.where === '' && busy.busy === true && busy.long === false && busy.nudge === '' && busy.items.every(x => x.off === true));
        const ended = sceneMenuModel({ mark, ended: true, count: 80, long: true, note: 'The record of the scene could not be written. Use End scene to write it yourself.' });
        check('an ended scene: said so, with its end date, Continue fresh and Reopen, no nudge; why the last handover stopped is kept to show', ended.line === 'Scene 3: The gate at dusk (ended)' && ended.where === 'Day 42, night' && same(ended.items.map(x => x.id), ['continue', 'reopen']) && ended.items[1].label === 'Reopen scene 3' && ended.long === false && ended.note.startsWith('The record of the scene could not'));
        const away = sceneMenuModel({ scene: { id: 's3', title: 'The gate at dusk' }, away: true });
        check('a scene being played whose chat is not in front (D203): the entry names it, says so, and offers the way to it and nothing else', away.label === 'Scene 3' && away.line === 'Scene 3: The gate at dusk' && /not the one in front/.test(away.where) && away.away === true && same(away.items.map(x => [x.id, x.label, x.off]), [['goto', 'Go to scene 3', false]]) && open.away === false);
        check('a scene with no title or place yet still has its entry', sceneMenuModel({ mark: { scene: 's1' }, ended: false, count: 1 }).line === 'Scene 1' && sceneMenuModel({ mark: { scene: 's1' }, ended: false, count: 1 }).where === '1 message');
    }
    const c = hubConfig({ hub: { gap: 'when', recapChars: 9999, closeOnStart: false } });
    check('clamps: when is not a default gap, the recap within range; a rule of the old window\'s (closing on Start) is not kept', c.gap === 'later' && c.recapChars === 1500 && !('closeOnStart' in c));
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
    check(`the brief never passes ${MAX_BRIEF} characters, the older parts cut first (before that goes before last time does)`, long.length <= MAX_BRIEF && !long.includes('b'.repeat(1500)) && long.includes('l'.repeat(1500)) && long.includes('Who is here') && long.endsWith(']') && (() => { const longer = buildBrief({ world: 'W', place: 'P', cast: [{ name: 'A', description: 'a'.repeat(200) }], seed: 's'.repeat(400), since: Array.from({ length: 12 }, (_, i) => `line ${i} `.repeat(20)), lastRecap: 'l'.repeat(1500), beforeRecap: 'b'.repeat(1500), note: 'n'.repeat(300) }); return longer.length <= MAX_BRIEF && !longer.includes('Before that') && longer.includes('Last time'); })(), String(long.length));
    check('an empty brief is still a brief', buildBrief({}) === '[SCENE BRIEF: the world.]');
}

console.log('\n§5 the openers');
{
    const p = buildOpenersPrompt({ world: { name: 'Harbourside', blurb: 'A port under a blockade.', template: 'Second person, present tense.' }, place: 'Customs house', region: 'The Harbour', weather: '☀️ clear', date: 'Day 12', time: 'evening', gapWords: 'the next day', cast: [{ name: 'Captain Reyes', tier: 'known' }], seed: 'The cutter will search every hold.', canonBlock: buildCanonBlock(memory.stores.dooms_canon), recaps: ['Jordan met Marit.', 'Jordan arrived.'], quests: { main: 'Find the ring', optional: ['Pay'] }, player: 'Jordan', note: 'find the ring' });
    check('the request names the world, the spot, the gap, the people, the seed, the ledger, last time, the quests, the wish, the rules and the JSON shape', p.system.includes('narrator of Harbourside') && p.system.includes('"openers"') && p.system.includes('Second person, present tense.') && p.system.includes('Never speak or act for Jordan') && p.user.includes('Customs house (The Harbour)') && p.user.includes('this scene opens the next day') && p.user.includes('Captain Reyes: someone the player knows') && p.user.includes('The cutter will search') && p.user.includes('[CANON') && p.user.includes('Last scene: Jordan met Marit.') && p.user.includes('Before that: Jordan arrived.') && p.user.includes('Main: Find the ring; Pay') && p.user.includes('What Jordan says happens next (their own words; they come first):\nfind the ring\n'), p.user);
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
    check(`${OPENERS} openers asked for unless another number is chosen, ${MAX_OPENERS} at the most`, buildOpenersPrompt({}).system.includes('Write 3 openers') && buildOpenersPrompt({ count: 9 }).system.includes('Write 6 openers') && buildOpenersPrompt({ count: 5 }).system.includes('Write 5 openers') && buildOpenersPrompt({ count: 1 }).system.includes('Write 1 opener that'));
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
    // Parts (D199): the same pages, each with the lines that lead into it, and never cut between the player's message and its reply.
    const talk = [];
    for (let i = 1; i <= 12; i++) { talk.push({ name: 'Jordan', is_user: true, mes: `ask ${i} ` + 'q'.repeat(150) }); talk.push({ name: 'Mara', is_user: false, mes: `answer ${i} ` + 'a'.repeat(700) }); }
    const parts = sceneTranscriptParts(talk, { budget: 2000, maxPages: 99 });
    const plainPages = sceneTranscriptPages(talk, { budget: 2000, maxPages: 99 });
    check('a long scene in parts: every line once, in order, none lost at a cut', parts.length >= 5 && parts.map(x => x.text).join('\n') === plainPages.join('\n'));
    check('a cut never falls between the player\'s message and the reply to it: every part opens on the player\'s line, none ends on one', parts.every(x => x.text.startsWith('Jordan: ask ')) && parts.every(x => x.text.split('\n').pop().startsWith('Mara: answer ')) && plainPages.some(x => x.split('\n').pop().startsWith('Jordan: ')), JSON.stringify(parts.map(x => x.text.split('\n').map(l => l.slice(0, 14)))));
    check('each part after the first carries the last lines of the one before it, to read on from; the first has none', parts[0].lead === '' && parts.slice(1).every((x, i) => x.lead && parts[i].text.endsWith(x.lead) && x.lead.split('\n').length <= 6 && x.lead.length <= 2400), JSON.stringify(parts.map(x => x.lead.length)));
    check('the lead is at least one line however long that line is, and no more than fits', sceneTranscriptParts(talk, { budget: 2000, maxPages: 99, leadChars: 10 }).slice(1).every(x => x.lead.split('\n').length === 1) && sceneTranscriptParts(talk, { budget: 2000, maxPages: 99, leadLines: 2 }).slice(1).every(x => x.lead.split('\n').length === 2));
    const lastTwo = sceneTranscriptParts(talk, { budget: 2000, maxPages: 2 });
    check('with the oldest parts not read, the first one read still has what led into it', lastTwo.length === 2 && lastTwo[0].lead === parts[parts.length - 2].lead && lastTwo[1].text === parts[parts.length - 1].text);
    // The last lines of a scene, for the openings of the next (D205).
    {
        const long = [];
        for (let i = 1; i <= 20; i++) { long.push({ name: 'Jordan', is_user: true, mes: `ask ${i}` }); long.push({ name: 'Mara', is_user: false, mes: `answer ${i}` }); }
        const t15 = sceneTail(long);
        check('the last fifteen messages of a scene, a line each, the newest last', t15.messages === TAIL.now && t15.text.split('\n').length === 15 && t15.text.endsWith('Mara: answer 20') && t15.text.startsWith('Mara: answer 13') && !t15.text.includes('ask 13'), t15.text.split('\n')[0]);
        check('eight when asked for eight; all of a short scene', sceneTail(long, { count: TAIL.later }).messages === 8 && sceneTail(long.slice(0, 3)).messages === 3 && sceneTail([]).messages === 0 && sceneTail(null).text === '');
        const messy = [{ name: 'Mara', is_user: false, mes: 'Seen. <think>hidden</think> ```json\n{"a":1}\n``` <trackers>x</trackers> [ITEM: key] The door.' }, { name: 'Sys', is_system: true, is_user: false, mes: 'A hidden line.' }, { name: 'Jordan', is_user: true, mes: '   ' }];
        check('the model\'s thinking, tracker blocks, code and dice marks are left out, as are hidden and empty messages', sceneTail(messy).text === 'Mara: Seen. The door.');
        const big = [{ name: 'Mara', is_user: false, mes: `EARLY-START ${'e'.repeat(3000)} EARLY-END` }, { name: 'Jordan', is_user: true, mes: 'I wait.' }, { name: 'Mara', is_user: false, mes: `LAST-START ${'x'.repeat(5000)} and she turns to you, the key in her hand.` }];
        const tb = sceneTail(big).text.split('\n');
        check('a long earlier message is cut from its end; the last ones keep their end, where the scene stopped', tb[0].startsWith('Mara: EARLY-START') && !tb[0].includes('EARLY-END') && tb[0].length <= TAIL.each + 10 && tb[2].endsWith('the key in her hand.') && !tb[2].includes('LAST-START') && tb[2].startsWith('Mara: …') && tb[2].length <= TAIL.last + 10, JSON.stringify(tb.map(x => x.length)));
        const many = Array.from({ length: 15 }, (_, i) => ({ name: 'Mara', is_user: false, mes: `line ${i} ${'y'.repeat(2500)} end ${i}.` }));
        const tm = sceneTail(many, { budget: 6000 });
        check('over the whole budget the oldest lines go first, and the last two always stay', tm.text.length <= 6000 + 100 && tm.messages >= 2 && tm.messages < 15 && tm.text.endsWith('end 14.') && tm.text.includes('end 13.') && !tm.text.includes('line 0 '), JSON.stringify([tm.messages, tm.text.length]));
        const base = { world: { name: 'The Eld' }, place: 'The kitchen', date: 'Day 3', time: 'morning', cast: [], recaps: ['They ate.'], player: 'Morzan' };
        const plain = openersPromptOf(base);
        const right = openersPromptOf({ ...base, tail: 'Solveig: "Chew it."\nMorzan: I chew.' });
        const days = openersPromptOf({ ...base, gapWords: 'some days later', tail: 'Solveig: "Chew it."' });
        check('with no lines to show, the openings are asked for as before', /a paragraph or two, plain prose, no markup/.test(plain.system) && !plain.user.includes('The last lines of the scene before'));
        check('right after: the lines are given last, and the openings carry straight on from them in the narrator\'s own voice', right.user.includes('The last lines of the scene before, as they were played (this scene carries straight on from the last of them):\nSolveig: "Chew it."\nMorzan: I chew.\nThe player: Morzan') && /it carries straight on from that very moment\. No time is skipped/.test(right.system) && /stops with the next move still Morzan's/.test(right.system) && /speech set out the same way \(its marks and any colour tags\)/.test(right.system) && !/plain prose, no markup/.test(right.system));
        check('time passed: the lines say how things were left, and the openings are a new moment', days.user.includes('(this scene opens some days later after them):') && /This scene opens some days later after them: do not carry that conversation on/.test(days.system) && /a new moment that follows from how things were left/.test(days.system) && !/carries straight on from that very moment/.test(days.system));
    }
    check('a short scene is one part with nothing before it', same(sceneTranscriptParts(chat, { persona: 'Jordan' }), [{ text: t, lead: '' }]));
    const led = buildRecapPrompt({ transcript: parts[1].text, soFar: 'They talked at the gate.', lead: parts[1].lead, last: false });
    check('a pass that continues is told those lines apart from its own part, as already recorded', led.user.includes(`The lines just before this part, already in the record so far (to read on from, not to record again):\n${parts[1].lead}\n\nThe scene, continued:\n${parts[1].text}`) && !buildRecapPrompt({ transcript: parts[0].text, lead: 'x' }).user.includes('The lines just before'));
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

console.log('\n§8a a scene deleted: only one that never ended (D197)');
{
    // Five scenes: two ended, one ended and reopened (open again), one set aside, one open.
    let e = normalizeWorldEntry({ card: 'Mara Vane.png' });
    e = openScene(e, { title: 'One', chat: 'Scene 1 - One', startedAt: 1 }).entry;
    e = endSceneRecord(e, 's1', { endedAt: 2, recap: 'One happened.' }).entry;
    e = openScene(e, { title: 'Two', chat: 'Scene 2 - Two', startedAt: 3 }).entry;
    e = endSceneRecord(e, 's2', { endedAt: 4, recap: 'Two happened.' }).entry;
    e = openScene(e, { title: 'Three', chat: 'Scene 3 - Three', startedAt: 5 }).entry;
    e = endSceneRecord(e, 's3', { endedAt: 6, recap: 'Three happened.' }).entry;
    e = reopenScene(e, 's3').entry;
    e = openScene(e, { title: 'Four', chat: 'Scene 4 - Four', startedAt: 7 }).entry;    // s3 goes aside, reopened
    e = openScene(e, { title: 'Five', chat: 'Scene 5 - Five', startedAt: 8 }).entry;    // s4 goes aside
    const of = (id) => e.scenes.find(x => x.id === id);
    check('the fixture: two ended, one reopened and aside, one aside, one open', of('s1').status === 'ended' && of('s3').status === 'aside' && of('s3').reopened === true && of('s4').status === 'aside' && !of('s4').reopened && of('s5').status === 'open' && e.seq === 5);
    check('a scene that is open or set aside and never ended can be deleted', canDeleteScene(of('s5')).ok && canDeleteScene(of('s4')).ok);
    check('an ended scene can be deleted too, and one that was ended and then reopened (D206: what it changed is taken back from its log)', canDeleteScene(of('s1')).ok && canDeleteScene(of('s3')).ok);
    check('which kind of delete it is: one that never ended, one the world remembers; none for scene 0 or a scene whose chat is gone', deleteKind(of('s5')) === 'unended' && deleteKind(of('s4')) === 'unended' && deleteKind(of('s1')) === 'ended' && deleteKind(of('s3')) === 'ended' && deleteKind({ id: ADOPTED_ID, status: 'ended', chat: 'x' }) === '' && deleteKind({ ...of('s1'), gone: true }) === '' && deleteKind(null) === '');
    check('scene 0 is not deleted: it is the chat the scenes began from', same(canDeleteScene({ id: ADOPTED_ID, status: 'ended' }), { ok: false, reason: 'first' }));
    check('nor a scene that is not there', same(canDeleteScene(null), { ok: false, reason: 'no-scene' }) && deleteSceneRecord(e, 's9').removed === false && deleteSceneRecord(e, 's9').reason === 'no-scene');
    const gone1 = deleteSceneRecord(e, 's1');
    check('an ended scene\'s record goes like any other, the numbering as it was', gone1.removed && same(gone1.entry.scenes.map(x => x.id), ['s2', 's3', 's4', 's5']) && gone1.entry.seq === 5);
    const zero = deleteSceneRecord({ ...e, scenes: [{ id: ADOPTED_ID, status: 'ended', chat: 'Long' }, ...e.scenes] }, ADOPTED_ID);
    check('a refused delete changes nothing and says why', zero.removed === false && zero.reason === 'first' && zero.entry.scenes.length === 6);
    const mid = deleteSceneRecord(e, 's4');
    check('a set-aside scene deleted: its record goes, the others and the numbering stay', mid.removed && mid.scene.id === 's4' && same(mid.entry.scenes.map(x => x.id), ['s1', 's2', 's3', 's5']) && mid.entry.seq === 5 && same(mid.entry.memory, e.memory) && same(mid.entry.continuity, e.continuity));
    const last = deleteSceneRecord(e, 's5');
    check('the last scene started deleted: its number is free for the next', last.removed && same(last.entry.scenes.map(x => x.id), ['s1', 's2', 's3', 's4']) && last.entry.seq === 4 && openScene(last.entry, { title: 'Again', chat: 'Scene 5 - Again' }).scene.id === 's5');
    const both = deleteSceneRecord(deleteSceneRecord(e, 's5').entry, 's4');
    check('and the one before it after that: the number falls to the last scene left', both.removed && both.entry.seq === 3);
    const only = deleteSceneRecord(openScene(normalizeWorldEntry({ card: 'x.png' }), { title: 'First', chat: 'Scene 1 - First' }).entry, 's1');
    check('a world\'s only scene deleted: no scenes, and the next is scene 1 again', only.removed && only.entry.scenes.length === 0 && only.entry.seq === 0);
    check('the entry given is not changed', e.scenes.length === 5 && e.seq === 5);
    // What the Atlas says.
    check('deleted: says the chat went too', describeDeleteResult({ ok: true, scene: { id: 's5' }, chat: 'deleted', opened: null }) === 'Scene 5 is deleted, and its chat is deleted.');
    check('deleted while in front: says which chat is open in its place, or that a new one is', describeDeleteResult({ ok: true, scene: { id: 's5' }, chat: 'deleted', opened: { name: 'Scene 2 - Two', fresh: false, card: 'Mara Vane' } }) === 'Scene 5 is deleted, and its chat is deleted. "Scene 2 - Two" is open in its place.' && describeDeleteResult({ ok: true, scene: { id: 's1' }, chat: 'deleted', opened: { name: 'Mara Vane - x', fresh: true, card: 'Mara Vane' } }) === 'Scene 1 is deleted, and its chat is deleted. A new chat is open on Mara Vane.');
    check('an ended scene deleted: says how much of what it changed was taken back and how much stays', describeDeleteResult({ ok: true, scene: { id: 's3' }, chat: 'deleted', taken: { log: true, undone: 14, kept: 3 } }) === 'Scene 3 is deleted, and its chat is deleted. 14 things it changed in the world are taken back; 3 stay as they are, changed again since.' && describeDeleteResult({ ok: true, scene: { id: 's3' }, chat: 'deleted', taken: { log: true, undone: 1, kept: 0 } }) === 'Scene 3 is deleted, and its chat is deleted. 1 thing it changed in the world is taken back.' && describeDeleteResult({ ok: true, scene: { id: 's3' }, chat: 'deleted', taken: { log: true, undone: 2, kept: 1 } }).endsWith('2 things it changed in the world are taken back; 1 stays as it is, changed again since.'));
    check('nothing to take back, or nothing that could be: each said as it is', describeDeleteResult({ ok: true, scene: { id: 's3' }, chat: 'deleted', taken: { log: true, undone: 0, kept: 0 } }) === 'Scene 3 is deleted, and its chat is deleted. Its End had changed nothing in the world, so there was nothing to take back.' && describeDeleteResult({ ok: true, scene: { id: 's3' }, chat: 'deleted', taken: { log: true, undone: 0, kept: 4 } }) === 'Scene 3 is deleted, and its chat is deleted. Nothing it changed in the world could be taken back: 4 things stay as they are, changed again since.');
    check('one that ended before a log was kept: says the world keeps what happened in it', describeDeleteResult({ ok: true, scene: { id: 's1' }, chat: 'deleted', taken: { log: false, undone: 0, kept: 0 } }) === 'Scene 1 is deleted, and its chat is deleted. The world keeps what happened in it: it ended before a log of what it changed was kept.');
    check('a scene whose chat was gone already: says so', describeDeleteResult({ ok: true, scene: { id: 's4' }, chat: 'gone' }) === 'Scene 4 is deleted, and its chat was gone already.');
    check('refused or failed: each says why, and what was kept', /Scene 0 is the chat the scenes began from: it is not deleted/.test(describeDeleteResult({ ok: false, reason: 'first' })) && /SillyTavern did not delete the chat \(400\)\. The scene is still in the list\./.test(describeDeleteResult({ ok: false, reason: 'file', error: '400' })) && /Nothing was deleted\.$/.test(describeDeleteResult({ ok: false, reason: 'switch', error: 'x' })) && /try again/.test(describeDeleteResult({ ok: false, reason: 'busy' })) && describeDeleteResult(null) === '');
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

console.log('\n§8d a scene\'s length, and going straight on (D181)');
{
    const chat = [
        { is_user: false, mes: 'The opener.' }, { is_user: true, mes: 'I go down.' }, { is_user: false, is_system: true, mes: 'A picture.' },
        { is_user: false, mes: `Kiyoha laughs. ${'She shoulders the axe and looks back down the stair. '.repeat(9)}<think>where next</think> "Well? Are you coming, healer?"` },
        null, { is_user: true },
    ];
    check('a scene is as long as its messages, the player\'s and the narrator\'s; a system message is none', sceneLength(chat) === 3 && sceneLength([]) === 0 && sceneLength(null) === 0);
    check('long enough for a fresh chat: at the mark or past it; never with the mark at 0', sceneIsLong(60, 60) && sceneIsLong(75, 60) && !sceneIsLong(59, 60) && !sceneIsLong(500, 0) && !sceneIsLong(NaN, 60));
    const seed = continuationSeed(chat);
    check('the next scene is told it goes straight on: no time passed, nobody moved, open on that moment', seed.startsWith('The story goes straight on from the moment the last scene stopped: no time has passed and nobody has moved. Open on that moment; do not repeat it and do not skip ahead.'));
    check('and the words the last scene stopped on: the end of the narrator\'s last message, from the start of a sentence, thinking left out, within what a seed may hold', seed.endsWith('"Well? Are you coming, healer?"') && seed.includes('It stopped on: She shoulders the axe') && !seed.includes('where next') && seed.length <= 400, seed.slice(-220));
    check('a short last message is given whole; a chat with no narrator\'s message gives the instruction alone', continuationSeed([{ is_user: false, mes: 'The door opens.' }]).endsWith('It stopped on: The door opens.') && !continuationSeed([{ is_user: true, mes: 'I wait.' }]).includes('It stopped on') && !continuationSeed(null).includes('It stopped on'));
}

console.log('\n§8e where the people stand and the open threads (D188): the record\'s request, the brief, the openings');
{
    const { continuityDraft, applyContinuity } = await import('../src/utils/continuity.js');
    const cont = applyContinuity(null, { people: [{ name: 'Kiyoha', now: 'At the Fourth Landing, shoulder cut; sworn to see Jordan down the stair.' }, { name: 'Lysandra', now: 'In Hask, out of ink.' }], opened: ['The debt to the Counting Room, due at the new moon.', 'Who cut the rope on the Third Landing?'] }, { scene: 's1', at: 1 });
    // The entry.
    const entry = normalizeWorldEntry({ card: 'N.png', continuity: { people: [{ name: 'Kiyoha', now: 'x' }, { name: 'kiyoha', now: 'y' }, { nonsense: true }], threads: [{ text: 'a thread that is open' }, 'junk'], seq: 'x' } });
    check('a world\'s entry keeps its continuity, made safe; a world with none has an empty one', same(entry.continuity.people.map(p => [p.name, p.now]), [['Kiyoha', 'y']]) && entry.continuity.threads[0].id === 't1' && same(normalizeWorldEntry({}).continuity, { people: [], threads: [], seq: 0, book: null }) && same(normalizeWorldEntry(JSON.parse(JSON.stringify(entry))), entry) && same(normalizeHub({ worlds: { w: { continuity: cont } } }).worlds.w.continuity, cont));
    // The record's request.
    const plain = buildRecapPrompt({ transcript: 't', player: 'Jordan' });
    check('asked without it, the record alone is asked for, as before', plain.system.includes('{"recap": "<what happened in this scene>"}.') && !plain.system.includes('"people"'));
    const p = buildRecapPrompt({ transcript: 'the scene', brief: '[SCENE BRIEF: W.]', player: 'Jordan', maxChars: 600, continuity: continuityDraft(cont, ['Kiyoha']) });
    check('asked with it, the same request says where each person stands and which threads were settled and opened', p.system.includes('"people": [{"name": "<someone in the scene>", "now": "<where they stand as the scene ends>"}]') && p.system.includes('"threads": {"closed": [<numbers of the open threads this scene settled>], "opened": ["<a thread this scene leaves open>"]}') && /never Jordan/.test(p.system) && /at most 280 characters/.test(p.system) && /carry forward what still holds/.test(p.system) && /Rules for "recap": at most 600 characters/.test(p.system));
    check('it is told where the scene\'s people stood and the open threads, numbered, before the scene\'s text', p.user.indexOf('Where they stood before this scene:\n- Kiyoha: At the Fourth Landing') > p.user.indexOf('[SCENE BRIEF') && p.user.includes('Open threads:\n1. The debt to the Counting Room, due at the new moon.\n2. Who cut the rope on the Third Landing?') && p.user.indexOf('Open threads') < p.user.indexOf('The scene:') && !p.user.includes('Lysandra'));
    const later = buildRecapPrompt({ transcript: 'more', player: 'Jordan', soFar: 'They went down.', last: false, continuity: continuityDraft(cont, ['Kiyoha']) });
    check('a later pass is told it as it stands so far', later.user.includes('Where they stand as of the record so far:') && later.user.indexOf('The record so far:') > later.user.indexOf('Open threads'));
    const read = parseRecapReply('```json\n{"recap":"They went down.","people":[{"name":"Kiyoha","now":"x"}],"threads":{"closed":[1],"opened":[]}}\n```');
    check('the reply read gives the record and the JSON itself, for what else it says; prose gives none', read.ok && read.recap === 'They went down.' && read.reply.people[0].name === 'Kiyoha' && same(read.reply.threads.closed, [1]) && parseRecapReply('They went down.').reply === null && parseRecapReply('').reply === null);
    // The brief.
    const brief = buildBrief({ world: 'First Descent', sceneNo: 4, place: 'Hask', cast: ['Kiyoha: an oni of the Redward', 'Lysandra: an ink mage'], seed: 'The key.', lastRecap: 'They came up.', stand: [{ name: 'Kiyoha', now: 'At the Fourth Landing, shoulder cut.' }, { name: 'Lysandra', now: 'In Hask, out of ink' }], threads: ['Who cut the rope on the Third Landing?', 'The debt to the Counting Room.'], player: 'Jordan', note: 'slow' });
    check('the brief says where the people here stand, after who they are, and what is still open, after the record', brief.includes('Where they stand now: Kiyoha: At the Fourth Landing, shoulder cut; Lysandra: In Hask, out of ink.') && brief.indexOf('Where they stand now') > brief.indexOf('Who is here') && brief.indexOf('Where they stand now') < brief.indexOf('What brought us here') && brief.includes('Still open: Who cut the rope on the Third Landing?; The debt to the Counting Room.') && brief.indexOf('Still open') > brief.indexOf('Last time') && brief.indexOf('Still open') < brief.indexOf('Jordan wants'), brief);
    check('with nothing to say of either, the brief says nothing of them', !buildBrief({ world: 'W', cast: ['A'] }).includes('stand') && !buildBrief({ world: 'W' }).includes('Still open'));
    const tight = buildBrief({ world: 'W', place: 'P', cast: [{ name: 'A', description: 'a'.repeat(200) }], seed: 's'.repeat(400), since: Array.from({ length: 12 }, (_, i) => `line ${i} `.repeat(20)), lastRecap: 'l'.repeat(1500), beforeRecap: 'b'.repeat(1500), note: 'n'.repeat(300), stand: [{ name: 'A', now: 'x'.repeat(300) }], threads: Array.from({ length: 6 }, (_, i) => `open thread ${i} `.repeat(8)) });
    check(`a brief too long keeps where the people stand before the older records and the threads (never past ${MAX_BRIEF})`, tight.length <= MAX_BRIEF && tight.includes('Where they stand now: A: ' + 'x'.repeat(300)) && !tight.includes('Before that') && tight.endsWith(']'), String(tight.length));
    // The openings.
    const o = buildOpenersPrompt({ world: { name: 'First Descent' }, place: 'Hask', cast: ['Kiyoha: an oni'], player: 'Jordan', stand: [{ name: 'Kiyoha', now: 'At the Fourth Landing, shoulder cut' }], threads: ['Who cut the rope on the Third Landing?'] });
    check('the openings are told where the people stand, as how the story left them, and what is open, as theirs to pick up or not', o.user.includes('Where they stand now:\n- Kiyoha: At the Fourth Landing, shoulder cut\n') && o.user.includes('Left open by the story so far (a scene may pick one up; none has to be):\n- Who cut the rope on the Third Landing?') && /that is how the story left them: they pick up from there/.test(o.system) && o.user.indexOf('Where they stand now') > o.user.indexOf('People here'));
    check('with nothing to say, the openings are asked as before', (() => { const none = buildOpenersPrompt({ world: { name: 'W' }, cast: ['A'] }); return !none.user.includes('Where they stand now') && !none.user.includes('Left open') && !/how the story left them/.test(none.system); })());
    // The word that says what End kept.
    check('End says what it kept of them, when it kept any', /1 person's standing kept, 2 threads opened, 1 settled/.test(describeEndResult({ ok: true, recap: 'kept', continuity: { people: 1, opened: 2, closed: 1 } })) && /3 people's standing kept/.test(describeEndResult({ ok: true, recap: 'kept', continuity: { people: 3, opened: 0, closed: 0 } })) && !/standing/.test(describeEndResult({ ok: true, recap: 'kept', continuity: { people: 0, opened: 0, closed: 0 } })) && !/standing/.test(describeEndResult({ ok: true, recap: 'kept' })));
}

console.log('\n§8f what a scene contradicts (D190): the record\'s request, the scene\'s record');
{
    const H = await import('../src/utils/hub.js');
    const { normalizeConflicts, readConflicts, mergeConflicts, MAX_CONFLICTS } = H;
    const raw = [{ scene: ' Dagger still holds the key. ', established: 'The key was returned to the Factor.', source: 'the ledger' }, { says: 'Kiyoha has never met Solveig.', against: 'Kiyoha and Solveig came up the stair together.', where: 'Kiyoha\'s notes' }, { scene: 'dagger still holds the key.', established: 'the key was returned to the factor.' }, { scene: 'only half' }, null, 'junk'];
    const list = normalizeConflicts(raw);
    check('made safe: what the scene says, what was established, where; each once; one with half of it missing dropped', list.length === 2 && same(list[0], { scene: 'Dagger still holds the key.', established: 'The key was returned to the Factor.', source: 'the ledger' }) && list[1].source === 'Kiyoha\'s notes' && same(normalizeConflicts(null), []) && same(normalizeConflicts(list), list));
    check(`no more than ${MAX_CONFLICTS} are kept`, normalizeConflicts(Array.from({ length: 20 }, (_, i) => ({ scene: `s${i}`, established: `e${i}` }))).length === MAX_CONFLICTS);
    check('read from a record\'s reply; none from prose or from a reply that says nothing of them', readConflicts({ recap: 'x', conflicts: raw }).length === 2 && same(readConflicts(null), []) && same(readConflicts({ recap: 'x' }), []) && same(readConflicts({ conflicts: 'none' }), []));
    check('two passes\' findings are one list, none twice', mergeConflicts(list, [list[1], { scene: 'New.', established: 'Old.' }]).length === 3 && same(mergeConflicts(null, null), []));
    // The request.
    const plain = buildRecapPrompt({ transcript: 't', player: 'Jordan' });
    check('asked without anything to check against, the record says nothing of contradictions', !plain.system.includes('conflicts') && !plain.user.includes('established'));
    const p = buildRecapPrompt({ transcript: 'the scene', brief: '[SCENE BRIEF: W.]', player: 'Jordan', check: { canon: 'The key was returned to the Factor.', lore: [{ name: 'Kiyoha', text: 'KIYOHA: an oni of the Redward. She and Solveig came up the stair together.' }], standing: 'RULING: the tests are over.' } });
    check('asked with what was established, the same request says what the scene contradicts', p.system.includes('"conflicts": [{"scene": "<what the scene says or shows>", "established": "<what was established that it contradicts>", "source": "<where that was established>"}]') && /two things that cannot both be true/.test(p.system) && /A change the scene itself brings about is not a contradiction/.test(p.system) && /an empty list when there are none, which is the usual case/.test(p.system) && /in what the story has established, in a person's own notes, in the story's standing notes/.test(p.system));
    check('it is given the ledger, the people\'s own notes and the standing notes, before the scene\'s text', p.user.includes('What the story has established (the ledger):\nThe key was returned to the Factor.') && p.user.includes('The people\'s own notes:\n[Kiyoha] KIYOHA: an oni of the Redward.') && p.user.includes('The story\'s standing notes:\nRULING: the tests are over.') && p.user.indexOf('standing notes') < p.user.indexOf('The scene:') && p.user.indexOf('the ledger') > p.user.indexOf('[SCENE BRIEF'));
    const some = buildRecapPrompt({ transcript: 't', player: 'Jordan', check: { canon: '', lore: [], standing: '' } });
    check('with nothing established it still asks, against nothing in particular, and gives no empty headings', some.system.includes('"conflicts"') && !some.user.includes('the ledger') && !some.user.includes('own notes') && !/in what the story has established/.test(some.system));
    // The scene's record.
    let entry = normalizeWorldEntry({ card: 'N.png' });
    entry = openScene(entry, { title: 'The stair', chat: 'c1', card: 'N.png', startedAt: 5 }).entry;
    const ended = endSceneRecord(entry, 's1', { endedAt: 9, endDate: 'Day 2', recap: 'They went down.', conflicts: raw });
    check('ended with them, the scene\'s record keeps them', ended.scene.conflicts.length === 2 && ended.scene.conflicts[0].source === 'the ledger' && same(normalizeWorldEntry(JSON.parse(JSON.stringify(ended.entry))), ended.entry));
    check('a scene that contradicted nothing says nothing of it', !('conflicts' in endSceneRecord(entry, 's1', { endedAt: 9, recap: 'x' }).scene) && !('conflicts' in normalizeScene({ id: 's1' })));
    check('ended again (reopened, put right), the list is the new End\'s', !('conflicts' in endSceneRecord(ended.entry, 's1', { endedAt: 12, recap: 'x', conflicts: [] }).scene));
    {
        let many = normalizeWorldEntry({});
        for (let i = 0; i < RECENT_RECAPS + 3; i++) { many = openScene(many, { title: `t${i}`, chat: `c${i}`, startedAt: i + 1 }).entry; many = endSceneRecord(many, `s${i + 1}`, { endedAt: i + 2, recap: 'short', conflicts: [{ scene: 'a', established: 'b' }] }).entry; }
        check('only the last scenes keep theirs: an old scene\'s list goes when its record is cut short', !('conflicts' in many.scenes[0]) && many.scenes[many.scenes.length - 1].conflicts.length === 1);
    }
    check('End says how many it found, and that one Undo puts it back', /Two things|2 things in it contradict what was established: the Atlas lists them, and one Undo puts the End back\./.test(describeEndResult({ ok: true, recap: 'kept', conflicts: 2 })) && /One thing in it contradicts what was established: the Atlas lists it/.test(describeEndResult({ ok: true, recap: 'kept', conflicts: 1 })) && !/contradict/.test(describeEndResult({ ok: true, recap: 'kept' })));
}

console.log('\n§9 the lines');
{
    const entry = normalizeWorldEntry({ card: 'Mara.png', memory: { stores: { dooms_world: {} }, facts: { date: 'Day 14', time: 'noon' } }, scenes: [{ id: 's1', status: 'ended', recap: 'r' }, { id: 's2', status: 'aside' }, { id: 's3', status: 'open', place: { label: 'The quay' }, startDate: 'Day 14' }] });
    check('the status line: narrated, counted, the open scene', hubStatusLine({ worldName: 'Harbourside', entry, cardName: 'Mara' }) === 'Harbourside: narrated by Mara; 1 scene played, 1 set aside; scene 3 open at The quay since Day 14.', hubStatusLine({ worldName: 'Harbourside', entry, cardName: 'Mara' }));
    check('no card: says so; no open scene: the world\'s date', hubStatusLine({ worldName: 'W', entry: null }).includes('no narrator card') && hubStatusLine({ worldName: 'W', entry: setSceneAside(entry, 's3').entry }).endsWith("the world's date is Day 14, noon."));
    check('start and end described', describeStartResult({ ok: true, scene: { id: 's3', place: { label: 'The quay' } } }) === 'Scene 3 is open at The quay.' && describeStartResult({ ok: false, reason: 'scene-open' }).includes('still open') && describeStartResult({ ok: false, reason: 'weird', error: 'boom' }).includes('boom') && describeEndResult({ ok: true, recap: 'kept', canon: 'ok', world: 'skipped', book: 'ok' }) === 'The scene is ended and remembered (the recap kept, the ledger read, the world not moved, the continuity book written).' && /the continuity book "FD - Scenes Continuity" made/.test(describeEndResult({ ok: true, recap: 'kept', book: 'ok', bookResult: { made: true, name: 'FD - Scenes Continuity' } })) && /the continuity book not written/.test(describeEndResult({ ok: true, recap: 'kept', book: 'failed' })) && /Kiyoha left as you wrote it in the book/.test(describeEndResult({ ok: true, recap: 'kept', continuityKept: ['Kiyoha'] })) && describeEndResult({ ok: false, reason: 'changed' }).includes('end it again'));
}

console.log('\nthe ledger asked for with the record (D208)');
{
    const entries = [{ id: 'c1', kind: 'person', name: 'Old Marit', text: 'Keeps the ferry and owes Jordan a crossing.', pinned: false, at: 1 }];
    const base = { transcript: 'Jordan: I pay.\nNarrator: Marit takes the coin.', player: 'Jordan', maxChars: 1200, soFar: 'Jordan came to the ferry.', last: false, continuity: { people: [], threads: [] } };
    const plain = buildRecapPrompt(base);
    const both = buildRecapPrompt({ ...base, ledger: { entries, names: ['Old Marit', 'Captain Rey'], players: ['Jordan', 'Jo'] } });
    const ask = canonAsk({ entries, player: ['Jordan', 'Jo'], names: ['Old Marit', 'Captain Rey'], adds: LEDGER_ADDS, drops: LEDGER_DROPS });
    check('without the ledger the request is what it was: no word of it', !/ledger/i.test(plain.system) && !plain.user.includes('The ledger so far'));
    check('with it, the answer\'s shape carries the ledger last, after the record, the people and the threads', both.system.includes(`, "ledger": ${ask.shape}}`) && both.system.indexOf('"recap"') < both.system.indexOf('"people"') && both.system.indexOf('"threads"') < both.system.indexOf('"ledger"'));
    check('the rules are Canon\'s own, word for word, with a scene\'s caps and the player kept out', both.system.includes(ask.rules) && /at most 16 adds and 8 drops/.test(both.system) && /the player \(Jordan \/ Jo\) is never an entry/.test(both.system) && buildCanonPrompt({ entries, player: ['Jordan', 'Jo'], names: [], adds: LEDGER_ADDS, drops: LEDGER_DROPS }).system.includes(ask.rules));
    check('it is told to read this part alone for the ledger, that nothing new is a sound answer, and to write the record first', /this part of the scene alone \(not the record so far, whose facts are in the ledger already\)/.test(both.system) && /An empty "add" where this part established nothing new\./.test(both.system) && /The record comes first: write "recap", "people" and "threads" in full before "ledger"\./.test(both.system));
    check('the request shows the ledger so far and the names the story knows, before the record so far and the part', both.user.includes('The ledger so far:\nPeople:\n- Old Marit: Keeps the ferry and owes Jordan a crossing.\nNames the story knows: Old Marit, Captain Rey\n') && both.user.indexOf('The ledger so far:') < both.user.indexOf('The record so far:') && both.user.indexOf('The record so far:') < both.user.indexOf('The scene, continued:'));
    check('an empty ledger says so; more adds can be asked for (the whole chat in one request)', buildRecapPrompt({ ...base, ledger: { entries: [] } }).user.includes('The ledger so far:\n(empty)\n') && /at most 48 adds/.test(buildRecapPrompt({ ...base, ledger: { entries: [], adds: 48 } }).system));
    check('with no continuity asked for, the record is the recap alone and the ledger still follows it', /The record comes first: write "recap" in full before "ledger"\./.test(buildRecapPrompt({ transcript: 't', player: 'Jordan', ledger: { entries: [] } }).system));
    // The answer's ledger.
    const reply = (text) => parseRecapReply(text, { maxChars: 1200 });
    const under = reply('{"recap":"They crossed.","people":[],"threads":{"closed":[],"opened":[]},"ledger":{"add":[{"kind":"fact","name":"The crossing","text":"Jordan crossed at dusk."}],"drop":["Old debt"]}}');
    check('the ledger under its own key is read with the record', under.ok && under.recap === 'They crossed.' && JSON.stringify(ledgerOfReply(under.reply)) === '{"add":[{"kind":"fact","name":"The crossing","text":"Jordan crossed at dusk."}],"drop":["Old debt"]}');
    check('adds written beside the record, or the ledger as a bare list of adds, are taken too', JSON.stringify(ledgerOfReply(reply('{"recap":"r","add":[{"kind":"fact","name":"n","text":"t"}],"drop":[]}').reply)) === '{"add":[{"kind":"fact","name":"n","text":"t"}],"drop":[]}' && JSON.stringify(ledgerOfReply(reply('{"recap":"r","ledger":[{"kind":"fact","name":"n","text":"t"}]}').reply)) === '{"add":[{"kind":"fact","name":"n","text":"t"}]}');
    check('an answer with the record and no ledger, a ledger that is no object, or prose, has none', ledgerOfReply(reply('{"recap":"r","people":[]}').reply) === null && ledgerOfReply(reply('{"recap":"r","ledger":"none"}').reply) === null && ledgerOfReply(reply('They crossed at dusk.').reply) === null && ledgerOfReply(null) === null && ledgerOfReply(reply('{"recap":"r","ledger":{}}').reply) === null);
    check('an answer cut off inside its ledger holds no record that can be read: it is asked for again', reply('{"recap":"They crossed.","people":[],"ledger":{"add":[{"kind":"fact","name":"The cro').ok === false);
}

console.log('\na scene\'s own narrator card (D209)');
{
    const openers = [{ title: 'The lane', text: 'The lane is empty.' }, { title: 'The weir', text: ' The weir is loud. ' }, { title: 'The court', text: 'Word has come.' }];
    const f = sceneCardFields({ world: 'The Eld', sceneNo: 4, title: 'The lane', place: 'Redfall Castle', date: 'Day 44', openers });
    check('the card is called Narrator, whatever the world and the scene', f.name === 'Narrator' && SCENE_NARRATOR_NAME === 'Narrator');
    check('it is blank but for one line that says what it is: the world, the player, that the chat is one scene', f.description === 'You are the narrator of The Eld. The player\'s character is {{user}}. This chat is one scene of the story: the scene\'s brief says where it opens, who is there and what came before.');
    check('the openings are its greetings in the order given: the first its first message, the rest its alternates, trimmed', f.first_mes === 'The lane is empty.' && same(f.alternate_greetings, ['The weir is loud.', 'Word has come.']));
    check('the note says which scene of which world, where and when, and that the card goes with the scene', f.creator_notes === 'The Eld · Scene 4: The lane · Redfall Castle · Day 44. Made for this scene by Doom\'s Enhancement Suite; deleting the scene deletes this card.');
    const bare = sceneCardFields({ world: 'The Eld', sceneNo: 5, openers: [] });
    check('with no opening the card has no greeting, and a note with what is known', bare.first_mes === '' && same(bare.alternate_greetings, []) && bare.creator_notes.startsWith('The Eld · Scene 5. Made for this scene'));
    check('openings given as plain text are taken too; empty ones are passed over', same(sceneCardFields({ openers: ['One.', '', { text: 'Two.' }] }).alternate_greetings, ['Two.']) && sceneCardFields({ openers: ['One.'] }).first_mes === 'One.');
    check('a world\'s scene cards share one tag, named after the world', sceneCardTag('The Eld') === 'The Eld: scenes' && sceneCardTag('') === 'World: scenes');
    // The record.
    let e = openScene(normalizeWorldEntry(null), { title: 'a', chat: 'Scene 1 - a', card: 'Narrator.png', ownCard: true }).entry;
    e = openScene(e, { title: 'b', chat: 'Scene 2 - b', card: 'Teller.png' }).entry;
    check('a scene\'s record says when its card is its own, and keeps saying it; one on the world\'s card says nothing', e.scenes[0].ownCard === true && normalizeWorldEntry(JSON.parse(JSON.stringify(e))).scenes[0].ownCard === true && !('ownCard' in e.scenes[1]));
    const gone = markCardsGone(e, ['Teller.png', 'Someone.png']);
    check('a scene whose own card is no longer among SillyTavern\'s is marked as gone, and set aside if it was open', gone.changed === 1 && gone.entry.scenes[0].gone === true && gone.entry.scenes[0].status === 'aside' && gone.entry.scenes[1].gone === false);
    check('one on the world\'s card is not judged by this, nor one whose card is there', markCardsGone(e, ['Narrator.png']).changed === 0 && markCardsGone(e, ['Narrator.png']).entry === e);
    // The words.
    const sc = { id: 's4' };
    check('deleted with its card', describeDeleteResult({ ok: true, scene: sc, chat: 'deleted', card: 'deleted', opened: null }) === 'Scene 4 is deleted, and its narrator card and its chat are deleted.');
    check('its chat gone already', describeDeleteResult({ ok: true, scene: sc, chat: 'gone', card: 'deleted', opened: null }) === 'Scene 4 is deleted, and its narrator card is deleted (its chat was gone already).');
    check('a card that could not be deleted is said, with where it still is', describeDeleteResult({ ok: true, scene: sc, chat: 'deleted', card: 'kept', opened: null }) === 'Scene 4 is deleted, and its chat is deleted; its narrator card could not be deleted and is still in SillyTavern\'s list.');
    check('the chat closed for want of another', describeDeleteResult({ ok: true, scene: sc, chat: 'deleted', card: 'deleted', opened: { name: '', fresh: false, card: '', closed: true } }).endsWith('are deleted. No chat is open now.'));
    check('a scene on the world\'s card is said as before', describeDeleteResult({ ok: true, scene: sc, chat: 'deleted', opened: null }) === 'Scene 4 is deleted, and its chat is deleted.');
    check('a card that would not go while the scene was in front', /did not delete the scene's narrator card \(no\)\. The scene is still in the list\./.test(describeDeleteResult({ ok: false, reason: 'card', error: 'no', scene: sc })));
    check('a card that could not be made', describeStartResult({ ok: false, reason: 'card', error: 'x' }) === 'SillyTavern could not make the scene\'s narrator card, so nothing was started.');
    check('the status line: with a card for every scene a world needs no narrator to be played', hubStatusLine({ worldName: 'The Eld', entry: null, sceneCards: true }) === 'The Eld: every scene gets a narrator card of its own; no scene played yet.' && /^The Eld: every scene gets a narrator card of its own; /.test(hubStatusLine({ worldName: 'The Eld', entry: e, sceneCards: true })) && hubStatusLine({ worldName: 'The Eld', entry: null }) === 'The Eld: no narrator card yet; pick one to play it from the hub.');
}

console.log('\nthe tracker of the last message, for the openings (D210)');
{
    check('the moment a time had reached is the end of a span, in either form; a single time is itself', timeReached('14:10 → 14:45') === '14:45' && timeReached('20:00 -> 21:40') === '21:40' && timeReached({ start: 'noon', end: 'dusk' }) === 'dusk' && timeReached({ start: 'noon' }) === 'noon' && timeReached({ start: { value: '20:00' }, end: { value: '21:40' } }) === '21:40' && timeReached('Dusk') === 'Dusk' && timeReached({ value: 'Dusk' }) === 'Dusk' && timeReached('') === '' && timeReached(null) === '');
    const box = (o) => JSON.stringify({ date: { value: 'Day 5' }, time: { start: '20:00', end: '21:40' }, location: { value: 'Saltport, the quay' }, weather: { emoji: '🌫', forecast: 'sea fog' }, temperature: { value: 4, unit: '°C' }, ...o });
    const you = (mes) => ({ is_user: true, name: 'Jordan', mes });
    const it = (mes, tracker, extra = {}) => ({ is_user: false, name: 'Narrator', mes, swipe_id: 0, ...(tracker ? { extra: { dooms_tracker_swipes: { 0: { infoBox: tracker } } } } : { extra: {} }), ...extra });
    const f = lastTrackerFacts([it('One.', box({ time: { start: '08:00', end: '09:00' } })), you('Go.'), it('Two.', box({}))]);
    check('the last reply\'s own tracker is read: its date, the time it had reached, the place, the weather and the temperature', same(f, { date: 'Day 5', time: '21:40', location: 'Saltport, the quay', weather: '🌫 sea fog', temperature: '4°C', back: 0 }), JSON.stringify(f));
    check('it is the swipe in front that counts, not the first', lastTrackerFacts([{ is_user: false, mes: 'x', swipe_id: 1, extra: { dooms_tracker_swipes: { 0: { infoBox: box({ time: 'dawn' }) }, 1: { infoBox: box({ time: 'midnight' }) } } } }]).time === 'midnight');
    check('a chat read from its file has the tracker under the swipe\'s own record: read from there', lastTrackerFacts([{ is_user: false, mes: 'x', swipe_id: 0, extra: {}, swipe_info: [{ extra: { dooms_tracker_swipes: { 0: { infoBox: box({ time: 'noon' }) } } } }] }]).time === 'noon');
    check('an info box kept as an object, weather as plain text, a temperature as plain text', same(lastTrackerFacts([{ is_user: false, mes: 'x', extra: { dooms_tracker_swipes: { 0: { infoBox: { date: 'Day 2', time: 'Dusk', location: 'The mill', weather: 'clear', temperature: '12C' } } } } }]), { date: 'Day 2', time: 'Dusk', location: 'The mill', weather: 'clear', temperature: '12C', back: 0 }));
    const behind = lastTrackerFacts([it('One.', box({})), you('Go.'), it('Two.', null), you('And?')]);
    check('where the last reply has none, the one before it is read, and it says how many messages lie after it', !!behind && behind.time === '21:40' && behind.back === 3, JSON.stringify(behind));
    check('the player\'s messages and system messages are not looked in; a chat with no tracker anywhere has none', lastTrackerFacts([you('x'), { is_system: true, mes: 'y', extra: { dooms_tracker_swipes: { 0: { infoBox: box({}) } } } }]) === null && lastTrackerFacts([it('a', null), it('b', null)]) === null && lastTrackerFacts([]) === null && lastTrackerFacts(null) === null);
    check('only the last few replies are looked through: one further back than that is too old to speak for the end', lastTrackerFacts([it('old', box({})), ...Array.from({ length: 6 }, (x, k) => it(`r${k}`, null))]) === null && lastTrackerFacts([it('old', box({})), ...Array.from({ length: 5 }, (x, k) => it(`r${k}`, null))]).back === 5);
    check('a tracker with nothing in it is passed over for the one before', lastTrackerFacts([it('One.', box({})), it('Two.', '{}')]).back === 1);

    // The request.
    const base = { world: { name: 'The Eld' }, place: 'The Rusty Anchor', cast: [], seed: 'On.', player: 'Jordan', tail: 'Narrator: The lamps gutter.' };
    const then = { date: '14th of Frostfall', time: '21:40', location: 'Saltport, the quay', weather: '🌫 sea fog', temperature: '4°C', back: 0 };
    const now = buildOpenersPrompt({ ...base, gapWords: '', then, weather: 'ignored', date: 'old', time: 'old' });
    check('right after: the request is told when the scene before stopped by its tracker, with the place and the weather, and that this scene opens at the same date, time of day and weather', now.user.includes('When the scene before stopped, by its tracker at its last message: 14th of Frostfall, 21:40, at Saltport, the quay. Weather then: 🌫 sea fog, 4°C.\nThis scene opens right after: the same date, the same time of day and the same weather.'), now.user.split('\n').slice(1, 4).join(' | '));
    check('the old line and the weather beside the place are not there as well: one word on it, not two', !now.user.includes('The story\'s date at the last scene') && !now.user.includes('Weather: ignored') && now.user.includes('Where the scene opens: The Rusty Anchor\n'));
    check('it is told that "when" is that date and time of day, and that no opener opens at another hour or under another sky', /This scene opens at that same moment: "when" is that date and that time of day, and every opener is written for that time of day and that weather/.test(now.system) && /none of them opens at another hour or under another sky/.test(now.system));
    const later = buildOpenersPrompt({ ...base, gapWords: 'the next day', then, now: { date: '15th of Frostfall', time: 'morning' } });
    check('time has passed and the world was moved by it: the request is told what it stopped at and what it is now', later.user.includes('This scene opens the next day after that: it is now 15th of Frostfall, morning.') && /"when" is the date and time given for this scene/.test(later.system) && /the weather follows from what it was, changed only as that much time would change it/.test(later.system));
    const count = buildOpenersPrompt({ ...base, gapWords: 'later that day', then });
    check('time has passed and nothing says what it came to: "when" is counted on from where it stopped', count.user.includes('This scene opens later that day after that.') && !count.user.includes('it is now') && /"when" is counted on from that by later that day/.test(count.system));
    const stale = buildOpenersPrompt({ ...base, gapWords: '', then: { ...then, back: 3 } });
    check('a tracker some messages behind the end is told as that, and the lines are what the time of day and the weather are taken from first', stale.user.includes('by its tracker (3 messages before its last, the latest it has): 14th of Frostfall, 21:40') && stale.user.includes('This scene opens right after the last lines: the time of day and the weather are as those lines leave them, and as the tracker had them where the lines do not say.') && /as the tracker of the scene before last had them, a few messages before it stopped/.test(stale.system) && !/none of them opens at another hour/.test(stale.system));
    const none = buildOpenersPrompt({ ...base, gapWords: '', weather: 'rain', date: 'Day 1', time: 'noon' });
    check('with no tracker to go by the request is as it was: the date at the last scene, the weather beside the place', none.user.includes('Where the scene opens: The Rusty Anchor. Weather: rain\nThe story\'s date at the last scene: Day 1, noon; this scene opens right after.') && !/by its tracker/.test(none.system) && same(buildOpenersPrompt({ ...base, gapWords: '', weather: 'rain', date: 'Day 1', time: 'noon', then: { date: '', time: '', weather: '' } }), none));
    check('no weather known: it is not promised', buildOpenersPrompt({ ...base, gapWords: '', then: { date: 'Day 1', time: 'noon' } }).user.includes('This scene opens right after: the same date, the same time of day.'));
}

console.log('\nwho the tracker had present, and how (D211)');
{
    const chars = [
        { name: 'Kiyoha', emoji: '⚔', details: { appearance: { value: 'Mail under a wet cloak' }, currentMood: 'Short-tempered' }, relationship: { status: 'Ally' }, thoughts: { content: 'He is late again.' } },
        { name: 'Dagger', details: { appearance: 'Asleep' }, thoughts: { content: 'Off-scene: asleep upstairs' } },
        { name: 'Lysandra', details: {}, thoughts: '' },
        { name: 'Unavailable' },
        { name: 'kiyoha', details: { appearance: 'twice' } },
    ];
    const got = presentFromTracker(JSON.stringify({ characters: chars }));
    check('the tracker\'s present characters are read by name, once each, in its order: one it marks off the scene is not present, nor its "unavailable"', same(got.map(x => x.name), ['Kiyoha', 'Lysandra']), JSON.stringify(got.map(x => x.name)));
    check('how it had each is its own fields under their own names, how they stand with the player, and what was on their mind', got[0].line === 'appearance: Mail under a wet cloak; current mood: Short-tempered; to the player: Ally; thinking: He is late again.' && got[1].line === '', JSON.stringify(got));
    check('the list as a bare array, and the older text form, are read too', same(presentFromTracker(chars.slice(0, 1)).map(x => x.name), ['Kiyoha']) && same(presentFromTracker('- Kiyoha\n- Lysandra\n---\nWeather: fog').map(x => x.name), ['Kiyoha', 'Lysandra']));
    check('nothing to read is no one', same(presentFromTracker(null), []) && same(presentFromTracker(''), []) && same(presentFromTracker('{"characters":[]}'), []) && same(presentFromTracker('{bad'), []));
    check('a long entry is cut to what an opening is told of one person', presentFromTracker([{ name: 'Wordy', details: { appearance: 'x'.repeat(900) } }])[0].line.length <= PRESENT_LINE);
    // With the last reply's tracker.
    const box = JSON.stringify({ date: { value: 'Day 5' }, time: { start: '20:00', end: '21:40' }, location: { value: 'The quay' }, weather: 'fog' });
    const f = lastTrackerFacts([{ is_user: false, mes: 'x', swipe_id: 0, extra: { dooms_tracker_swipes: { 0: { infoBox: box, characterThoughts: JSON.stringify({ characters: chars }) } } } }]);
    check('the last reply\'s tracker says who was there as well as when: from the same copy', !!f && f.time === '21:40' && same(f.present.map(x => x.name), ['Kiyoha', 'Lysandra']));
    check('a tracker with no one in it has no word on who was there', !('present' in lastTrackerFacts([{ is_user: false, mes: 'x', extra: { dooms_tracker_swipes: { 0: { infoBox: box } } } }])));
    // The request.
    const base = { world: { name: 'The Eld' }, place: 'The quay', cast: ['Kiyoha: someone the player knows'], seed: 'On.', player: 'Jordan', tail: 'Narrator: The lamps gutter.', then: { date: 'Day 5', time: '21:40', weather: 'fog', back: 0 } };
    const told = buildOpenersPrompt({ ...base, gapWords: '', thenPeople: [got[0], got[1], { name: '', line: 'x' }] });
    check('the request is told how the tracker had the people of the scene when the scene before stopped: those it has a word on', told.user.includes('How the tracker had them when the scene before stopped:\n- Kiyoha: appearance: Mail under a wet cloak; current mood: Short-tempered; to the player: Ally; thinking: He is late again.\n') && !told.user.includes('- Lysandra:') && told.user.indexOf('People here:') < told.user.indexOf('How the tracker had them'));
    check('and that they are still so as the scene opens, and that what was on a person\'s mind is not said aloud', /they are still so as this scene opens: dressed as they were, in the state they were in\. What was on a person's mind is theirs: it shapes what they do and is not said aloud\./.test(told.system));
    check('the same day later: still so unless the time would have changed it', /in the state they were in, unless the time that has passed would have changed it\./.test(buildOpenersPrompt({ ...base, gapWords: 'later that day', thenPeople: [got[0]] }).system));
    const none = buildOpenersPrompt({ ...base, gapWords: '' });
    check('with no one to tell of, the request has no word of it', !none.user.includes('How the tracker had them') && !/how the tracker had a person/.test(none.system) && same(buildOpenersPrompt({ ...base, gapWords: '', thenPeople: [got[1]] }), none));
}

console.log('\na campaign\'s world (D213)');
{
    const pack = (name) => JSON.stringify({ id: name.toLowerCase().replace(/\s+/g, '-'), name, version: 1, places: [], clocks: [], cast: [] });
    const scene = (id) => ({ id, status: 'ended', chat: `${id}.jsonl`, place: { label: '' } });
    const settings = {
        liveWorld: { enabled: true, customPacks: { 'the-eld': pack('The Eld'), redward: pack('Redward'), nightcity: { id: 'nightcity', name: 'Night City' }, spare: 'not json', blank: pack('Blank') } },
        lorebook: { activeCampaignId: 'c_eld', campaigns: { c_eld: { name: 'Eld', books: [] }, c_nc: { name: 'Nightcity', books: [] }, c_new: { name: '  A   new  one ', books: [] }, broken: 'x' }, campaignOrder: ['c_nc', 'c_eld', 'gone'] },
        hub: { worlds: {
            'the-eld': { campaign: 'c_eld', scenes: [scene('s0'), scene('s1'), scene('s2')], memory: { takenAt: 50 } },
            redward: { campaign: '', scenes: [scene('s0'), scene('s1')], memory: { takenAt: 20 } },
            nightcity: { campaign: 'c_nc', scenes: [], memory: null },
            ghost: { campaign: 'c_new', scenes: [scene('s1')], memory: { takenAt: 99 } },
        } },
    };
    check('the player\'s own worlds by name; one that cannot be read stands under its id; the blank world is no one\'s', same(ownWorlds(settings), { 'the-eld': 'The Eld', redward: 'Redward', nightcity: 'Night City', spare: 'spare' }) && same(ownWorlds({}), {}) && same(ownWorlds(null), {}));
    check('the campaigns in the Lore Library\'s order, then any it does not list; a broken one is not one', same(campaignsOf(settings), [{ id: 'c_nc', name: 'Nightcity' }, { id: 'c_eld', name: 'Eld' }, { id: 'c_new', name: 'A new one' }]) && same(campaignsOf({}), []) && same(campaignsOf(null), []));
    check('the campaign that is on; none when the id names no campaign', same(activeCampaignOf(settings), { id: 'c_eld', name: 'Eld' }) && activeCampaignOf({ ...settings, lorebook: { ...settings.lorebook, activeCampaignId: 'gone' } }) === null && activeCampaignOf({ ...settings, lorebook: { ...settings.lorebook, activeCampaignId: null } }) === null && activeCampaignOf({}) === null);
    check('the Lore Library is on unless it is switched off; switched off, no campaign is on and none decides a world', loreLibraryOn(settings) && loreLibraryOn({}) && loreLibraryOn(null) && loreLibraryOn({ lorebook: { enabled: true } }) && !loreLibraryOn({ lorebook: { enabled: false } }) && activeCampaignOf({ ...settings, lorebook: { ...settings.lorebook, enabled: false } }) === null && activeCampaignWorldId({ ...settings, lorebook: { ...settings.lorebook, enabled: false } }) === '');
    check('a campaign\'s world is the world whose entry names it', campaignWorldId(settings, 'c_eld') === 'the-eld' && campaignWorldId(settings, 'c_nc') === 'nightcity');
    check('a campaign with none has none; a world that is no longer the player\'s is no campaign\'s world', campaignWorldId(settings, 'c_new') === '' && campaignWorldId(settings, '') === '' && campaignWorldId(settings, 'nobody') === '' && campaignWorldId({}, 'c_eld') === '');
    check('the world of the campaign that is on', activeCampaignWorldId(settings) === 'the-eld' && activeCampaignWorldId({ ...settings, lorebook: { ...settings.lorebook, activeCampaignId: 'c_new' } }) === '' && activeCampaignWorldId({ ...settings, lorebook: { ...settings.lorebook, activeCampaignId: null } }) === '' && activeCampaignWorldId({}) === '');
    // From before one campaign had one world: two worlds naming the same campaign.
    const two = { ...settings, hub: { worlds: { ...settings.hub.worlds, redward: { ...settings.hub.worlds.redward, campaign: 'c_eld' } } } };
    check('two worlds that name one campaign: the one most played is its world', campaignWorldId(two, 'c_eld') === 'the-eld');
    const tie = { ...two, hub: { worlds: { ...two.hub.worlds, redward: { ...two.hub.worlds.redward, scenes: [scene('s0'), scene('s1'), scene('s2')], memory: { takenAt: 80 } } } } };
    check('played as much: the one remembered last', campaignWorldId(tie, 'c_eld') === 'redward');
    const list = worldsByCampaign(settings);
    check('every world of the player\'s with its campaign, by name; the chat it began from is no scene of it', same(list, [
        { id: 'nightcity', name: 'Night City', campaign: 'c_nc', campaignName: 'Nightcity', scenes: 0, stories: 0 },
        { id: 'redward', name: 'Redward', campaign: '', campaignName: '', scenes: 1, stories: 1 },
        { id: 'spare', name: 'spare', campaign: '', campaignName: '', scenes: 0, stories: 0 },
        { id: 'the-eld', name: 'The Eld', campaign: 'c_eld', campaignName: 'Eld', scenes: 2, stories: 1 },
    ]), JSON.stringify(list));
    check('of two worlds that name one campaign only the one it uses is said to be its world', same(worldsByCampaign(two).filter(w => w.campaign === 'c_eld').map(w => w.id), ['the-eld']));
    check('a world whose campaign is gone is in no campaign', worldsByCampaign({ ...settings, lorebook: { ...settings.lorebook, campaigns: { c_eld: settings.lorebook.campaigns.c_eld } } }).find(w => w.id === 'nightcity').campaign === '');
    check('the status line says whose world it is where it is told; untold, the line is as it was', hubStatusLine({ worldName: 'The Eld', entry: null, sceneCards: true, campaign: 'Eld' }).startsWith('The Eld (Eld\'s world): ') && hubStatusLine({ worldName: 'Redward', entry: null, sceneCards: true, campaign: '' }).startsWith('Redward (in no campaign): ') && hubStatusLine({ worldName: 'The Eld', entry: null, sceneCards: true }).startsWith('The Eld: '));
}

console.log('\na world\'s stories (D216)');
{
    const sc = (id, extra = {}) => normalizeScene({ id, title: id, status: 'ended', chat: `${id}.jsonl`, place: { label: '' }, ...extra });
    const story = (o) => normalizeWorldEntry(o);
    const worlds = {
        'night-city': story({ campaign: 'c1', memory: { v: 1, takenAt: 100, scene: 's1', stores: {}, facts: {} }, scenes: [sc('s0', { chat: 'Jack - 2026-11-15', card: 'Narrator.png' }), sc('s1', { startedAt: 90, endedAt: 100 })] }),
        'night-city~2': story({ name: 'The Arasaka job', memory: { v: 1, takenAt: 300, scene: 's0', stores: {}, facts: {} }, scenes: [sc('s0', { chat: 'V - 2026-11-16', card: 'Narrator.png' })] }),
        'night-city~3': story({ scenes: [sc('s1', { status: 'open', startedAt: 250, endedAt: 0 })] }),
        'night-city~4': story({ card: 'x.png' }),
        'the-eld': story({ scenes: [sc('s0', { chat: 'Jack - 2026-11-15', card: 'Eld.png' })], memory: { v: 1, takenAt: 50, scene: 's0', stores: {}, facts: {} } }),
        empty: story({ campaign: 'c9' }),
    };
    check('a story\'s world is its id up to its number; a world\'s own id is its first story\'s', packOf('night-city~2') === 'night-city' && packOf('night-city') === 'night-city' && packOf('') === '' && STORY_SEP === '~');
    check('a story with no scene and no memory stands untouched, whatever else is kept under its id', entryUntouched(worlds.empty) && entryUntouched(worlds['night-city~4']) && entryUntouched(null) && !entryUntouched(worlds['night-city']) && !entryUntouched(worlds['night-city~3']));
    check('a world\'s stories in the order they were begun; one that stands untouched is not one', same(storyIdsOf(worlds, 'night-city'), ['night-city', 'night-city~2', 'night-city~3']) && same(storyIdsOf(worlds, 'the-eld'), ['the-eld']) && same(storyIdsOf(worlds, 'empty'), []) && same(storyIdsOf(worlds, 'nowhere'), []) && same(storyIdsOf(null, 'x'), []));
    check('a new story takes the world\'s own id while nothing is kept under it, else the next number free', nextStoryId(worlds, 'empty') === 'empty' && nextStoryId(worlds, 'brand-new') === 'brand-new' && nextStoryId(worlds, 'night-city') === 'night-city~4' && nextStoryId(worlds, 'the-eld') === 'the-eld~2');
    check('the story a chat began is the one whose scene 0 is that chat, under that card', storyOfChat(worlds, 'night-city', 'Jack - 2026-11-15', 'Narrator.png') === 'night-city' && storyOfChat(worlds, 'night-city', 'v - 2026-11-16.jsonl') === 'night-city~2' && storyOfChat(worlds, 'the-eld', 'Jack - 2026-11-15', 'Eld.png') === 'the-eld');
    check('a chat of the same name on another card, a chat that began none, a scene\'s own chat: none', storyOfChat(worlds, 'night-city', 'Jack - 2026-11-15', 'Other.png') === '' && storyOfChat(worlds, 'night-city', 'Somebody else') === '' && storyOfChat(worlds, 'night-city', 's1') === '' && storyOfChat(worlds, 'night-city', '') === '');
    check('when a story was last played: its last End or Start', storyPlayedAt(worlds['night-city']) === 100 && storyPlayedAt(worlds['night-city~2']) === 300 && storyPlayedAt(worlds['night-city~3']) === 250 && storyPlayedAt(null) === 0);
    check('the story of a world played last', lastStoryOf(worlds, 'night-city') === 'night-city~2' && lastStoryOf(worlds, 'the-eld') === 'the-eld' && lastStoryOf(worlds, 'empty') === '');
    const list = storiesOf(worlds, 'night-city', (avatar) => (avatar === 'Narrator.png' ? 'Nightcity - Narrator' : ''));
    check('a world\'s stories for a list: named by their own name, else the card they began on, else their number; their scenes, whether one is being played', same(list.map(x => [x.id, x.name, x.scenes, x.open]), [['night-city', 'Nightcity - Narrator', 1, false], ['night-city~2', 'The Arasaka job', 0, false], ['night-city~3', 'Story 3', 1, true]]), JSON.stringify(list));
    const twin = storiesOf({ a: worlds['night-city'], 'a~2': story({ scenes: [sc('s0', { chat: 'Another', card: 'Narrator.png' })], memory: { v: 1, takenAt: 5, scene: 's0', stores: {}, facts: {} } }) }, 'a', () => 'Nightcity - Narrator');
    check('two stories begun on one card are told apart', same(twin.map(x => x.name), ['Nightcity - Narrator', 'Nightcity - Narrator (2)']));
    check('a story\'s own name is kept with it', normalizeWorldEntry({ name: '  The   Arasaka job ' }).name === 'The Arasaka job' && normalizeWorldEntry({}).name === '');
    const hub = normalizeHub({ worlds: { [`${'w'.repeat(60)}~12`]: {} } });
    check('a story of a world with the longest id there can be is kept under its own id, and a scene\'s mark names it whole', Object.keys(hub.worlds)[0] === `${'w'.repeat(60)}~12` && readMark({ [HUB_META_KEY]: hubMark({ world: `${'w'.repeat(60)}~12`, scene: 's1' }) }).world === `${'w'.repeat(60)}~12`);
    const settings = { liveWorld: { customPacks: { 'night-city': '{"name":"Night City"}' } }, lorebook: { campaigns: { c1: { name: 'Nightcity' } }, campaignOrder: ['c1'] }, hub: { worlds } };
    check('a world is listed with the scenes of all its stories and how many stories it has; its campaign is the one kept under its own id', same(worldsByCampaign(settings), [{ id: 'night-city', name: 'Night City', campaign: 'c1', campaignName: 'Nightcity', scenes: 2, stories: 3 }]) && campaignWorldId(settings, 'c1') === 'night-city', JSON.stringify(worldsByCampaign(settings)));
}

console.log('\nwhat the player says happens next: the main word on a scene (D218)');
{
    const places = [{ id: 'pin:afterlife', label: 'The Afterlife' }, { id: 'kabuki', label: 'Kabuki' }, { id: 'market', label: 'Kabuki market' }];
    const people = ['Isabella', 'Cassie (Katherine Hightower)', 'Rogue Amendiares', 'Doc Imura, the back-alley ripperdoc', 'Jackie Welles', 'Jackie Chan'];
    const read = (t) => readDirection(t, { places, people });
    check('it takes two thousand characters; six hundred of them ride the scene\'s brief', MAX_NOTE === 2000 && BRIEF_NOTE === 600 && MAX_WRAP === 2000);
    const full = read('Three days later, Jack and Isabella go to the Afterlife to meet Rogue about the job.');
    check('a place of the map, the people the story knows and the time that has passed are read out of the words', same(full, { place: { id: 'pin:afterlife', label: 'The Afterlife' }, people: ['Isabella', 'Rogue Amendiares'], gap: { id: 'when', words: 'three days later' }, lore: false }), JSON.stringify(full));
    check('in a line for the sheet', describeDirection(full) === 'at The Afterlife · with Isabella, Rogue Amendiares · three days later' && describeDirection(read('A quiet talk.')) === '' && describeDirection(null) === '');
    check('of two places named, the longer name is the place', read('They meet at the Kabuki market.').place.id === 'market' && read('Back in Kabuki.').place.id === 'kabuki');
    check('a name is a word of its own: part of another word is not it', read('The Kabukicho district').place === null && read('Isabellas everywhere').people.length === 0);
    check('a person is known by their whole name, by the name before what is said of them, or by a first name that is no one else\'s', same(read('Doc Imura calls. Cassie is late. Rogue laughs.').people, ['Cassie (Katherine Hightower)', 'Rogue Amendiares', 'Doc Imura, the back-alley ripperdoc']) && same(read('Jackie walks in.').people, []) && same(read('Jackie Welles walks in.').people, ['Jackie Welles']), JSON.stringify(read('Doc Imura calls. Cassie is late. Rogue laughs.').people));
    check('how much time has passed, in the words\' own words', read('The next morning they wake.').gap.words === 'the next morning' && read('After two weeks of lying low').gap.words === 'after two weeks' && read('later that night').gap.words === 'later that night' && read('A few hours pass before the call.').gap.words === 'a few hours pass' && read('It is tomorrow night').gap.words === 'tomorrow night');
    check('no time at all where they say so; nothing where they do not say', same(read('Right after, they keep talking.').gap, { id: 'now', words: '' }) && same(read('picking up where we left off').gap, { id: 'now', words: '' }) && read('A fight in the alley.').gap === null && same(read(''), { place: null, people: [], gap: null, lore: false }));
    const base = { world: { name: 'Night City' }, place: 'Jack\'s safe house', cast: ['Isabella'], player: 'Jack', gapWords: '' };
    const plain = buildOpenersPrompt(base);
    const asked = buildOpenersPrompt({ ...base, note: 'Three days later Jack and Isabella meet Rogue at the Afterlife.\n\nShe has a job: a data shard lifted from Arasaka.' });
    check('with nothing said, the request is as it was: no place asked back, no word of the player\'s', !plain.system.includes('"where"') && !plain.user.includes('says happens next') && !/comes first/.test(plain.system));
    check('with it, the request is given the words whole and told they come first: over the place, the people and the time given', asked.user.includes('What Jack says happens next (their own words; they come first):\nThree days later Jack and Isabella meet Rogue at the Afterlife. She has a job: a data shard lifted from Arasaka.\n') && /What Jack says happens next is given in their own words, and it comes first: open the scene the way it asks\. Where it names the place, says who is there, or says how much time has passed, follow it over the place, the people and the time given elsewhere here; what it leaves unsaid is as given\./.test(asked.system), asked.system.slice(-900));
    check('and is asked where the scene opens by them', asked.system.includes('"where": "<the place the scene opens in, a few words>"') && /"where" is the place the scene opens in by that\./.test(asked.system));
    check('two thousand characters of it are sent, not three hundred', buildOpenersPrompt({ ...base, note: 'x'.repeat(2500) }).user.includes('x'.repeat(2000)) && !buildOpenersPrompt({ ...base, note: 'x'.repeat(2500) }).user.includes('x'.repeat(2001)));
    const ok = validateOpeners({ when: { date: 'Day 4', time: 'night' }, where: '  The Afterlife,  the back booth ', openers: [{ title: 'The booth', text: 'Rogue does not look up.', who: ['Isabella'] }] }, { cast: ['Isabella'] });
    check('the place the answer gives is kept with it; an answer with none has none', ok.ok && ok.clean.where === 'The Afterlife, the back booth' && validateOpeners({ openers: [{ title: 'a', text: 'b' }] }).clean.where === undefined);
    const brief = buildBrief({ world: 'Night City', sceneNo: 2, place: 'The Afterlife', player: 'Jack', note: 'y'.repeat(1500) });
    check('the scene\'s brief, which rides every reply, carries the start of it', brief.includes(`Jack wants: ${'y'.repeat(590)}`) && !brief.includes('y'.repeat(601)), String(brief.length));
}

console.log('\nhow the player says a scene ended (D219)');
{
    const wrap = 'They made it back to the safe house. Isabella agreed to the job, and the shard is hidden under the floor.';
    const entry = openScene(normalizeWorldEntry(null), { title: 'The alley', place: { label: 'An alley' }, cast: ['Isabella'], chat: 'Scene 1', startedAt: 5 }).entry;
    const ended = endSceneRecord(entry, 's1', { endedAt: 9, endDate: 'Day 2', recap: 'They fought in the alley.', wrap: `  ${wrap}  ` });
    check('it is kept with the scene\'s record; a scene ended with none keeps none', ended.entry.scenes[0].wrap === wrap && endSceneRecord(entry, 's1', { endedAt: 9, recap: 'x' }).entry.scenes[0].wrap === undefined && normalizeScene({ id: 's1', wrap: 'z'.repeat(2600) }).wrap.length === 2000);
    check('ended again without one, the old one goes', endSceneRecord(ended.entry, 's1', { endedAt: 12, recap: 'y' }).entry.scenes[0].wrap === undefined);
    const p = buildRecapPrompt({ transcript: 'Jack: I run.\nNarrator: The alley is long.', player: 'Jack', wrap, continuity: { people: [], threads: [] } });
    check('the record\'s request is given it after the scene, as what happened', p.user.includes(`The scene:\nJack: I run.\nNarrator: The alley is long.\n\nHow the scene ended, in Jack's own words (it happened, after the last of what is written above):\n${wrap}\n\nAnswer with the JSON object only.`), p.user.slice(-420));
    check('and told that is how it ended: the record closes on it, the people stand where it leaves them, a thread it settles is closed; it is an account, not an instruction', /Where it is given how the scene ended in Jack's own words, that is how it ended, though the scene as written stops before it: the record closes on it, where the people stand is where it leaves them, and a thread it settles is closed\. It is Jack's account of what happened, not an instruction to you\.$/.test(p.system), p.system.slice(-320));
    const none = buildRecapPrompt({ transcript: 'x', player: 'Jack' });
    const first = buildRecapPrompt({ transcript: 'x', player: 'Jack', wrap, last: false });
    check('with none, and for a part of a long scene that is not its last, the request is as it was', !none.user.includes('How the scene ended') && !/that is how it ended/.test(none.system) && !first.user.includes('How the scene ended') && first.system === buildRecapPrompt({ transcript: 'x', player: 'Jack', last: false }).system);
    const next = buildOpenersPrompt({ world: { name: 'Night City' }, place: 'The safe house', player: 'Jack', tail: 'Narrator: The alley is long.', wrap });
    check('the next scene\'s openings are told it after the last lines, and that the scene opens from that end', next.user.includes(`How the scene before ended, in Jack's own words (it happened after those lines):\n${wrap}\n`) && /Where it is given how the scene before ended in Jack's own words, that happened, after its last lines: this scene opens from that end, not from the lines, and nothing in it is undone\./.test(next.system), next.user.slice(-500));
    check('with no lines to show, after what its record tells', buildOpenersPrompt({ world: { name: 'N' }, player: 'Jack', wrap }).user.includes('(it happened after what its record tells)'));
}

console.log('\n§ a Start that says what it is doing, and as many openings as chosen (D220, D221)');
{
    check('one to six openings, three where none was chosen', MAX_OPENERS === 6 && openersCount(undefined) === 3 && openersCount(0) === 3 && openersCount('x') === 3 && openersCount(1) === 1 && openersCount('5') === 5 && openersCount(6) === 6 && openersCount(40) === 6 && openersCount(2.4) === 2);
    check('the number chosen is kept with the hub\'s settings, within its range', hubConfig({ hub: { openers: 5 } }).openers === 5 && hubConfig({ hub: { openers: 99 } }).openers === 6 && hubConfig({ hub: {} }).openers === 3 && normalizeHub({ openers: 2 }).openers === 2);
    check('a number in words for the sheet', countWord(1) === 'one' && countWord(3) === 'three' && countWord(6) === 'six' && countWord(14) === '14');
    const six = { when: { date: 'D', time: 'T' }, openers: Array.from({ length: 8 }, (_, i) => ({ title: `T${i}`, text: `Text ${i}.`, who: [] })) };
    check('as many are kept as were asked for: three unless told, six at the most', validateOpeners(six).clean.openers.length === 3 && validateOpeners(six, { max: 5 }).clean.openers.length === 5 && validateOpeners(six, { max: 9 }).clean.openers.length === 6 && validateOpeners(six, { max: 1 }).clean.openers.length === 1);
    const whole = JSON.stringify({ when: { date: 'Day 2', time: 'dusk' }, where: 'The old mill', openers: [{ title: 'A', text: 'First one.', who: ['Mira'] }, { title: 'B', text: 'Second one.', who: [] }, { title: 'C', text: 'Third one, which is long.', who: [] }] });
    const cut = whole.slice(0, whole.indexOf('Third one') + 9);
    const got = parseOpenersReply(cut);
    const v = validateOpeners(got, { known: ['Mira'], max: 3 });
    check('an answer that ran out before its end: the openers that came whole are kept, with the date and the place written before the cut', !!got && got.partial === true && v.ok && v.clean.partial === true && v.clean.openers.length === 2 && same(v.clean.openers[0].who, ['Mira']) && same(v.clean.when, { date: 'Day 2', time: 'dusk' }) && v.clean.where === 'The old mill', JSON.stringify(got));
    check('a whole answer is not said to be cut, nor one opener answered bare', validateOpeners(parseOpenersReply(whole)).clean.partial === undefined && validateOpeners(parseOpenersReply('{"title":"A","text":"Only one."}')).clean.partial === undefined && validateOpeners(parseOpenersReply('{"title":"A","text":"Only one."}')).clean.openers.length === 1);
    check('an answer cut before any opener came whole holds nothing', parseOpenersReply('{"when":{"date":"D","time":"T"},"openers":[{"title":"A","text":"It beg') === null);
    check('each step in words', startStepWords({ step: 'world' }) === 'Reading the world…' && startStepWords({ step: 'gap', words: 'the next week' }) === 'Moving the world on (the next week)…' && startStepWords({ step: 'lore' }) === 'Reading the lorebooks…' && startStepWords({ step: 'book' }) === 'Reading where the people stand…' && startStepWords({ step: 'lines' }) === 'Reading the last lines of the scene before…' && startStepWords({ step: 'line' }) === 'Waiting for another request to finish…');
    check('the openings by their number', startStepWords({ step: 'openers' }) === 'Writing three ways it could open…' && startStepWords({ step: 'openers', count: 1 }) === 'Writing how it could open…' && startStepWords({ step: 'openers', count: 5 }) === 'Writing five ways it could open…' && startStepWords({}) === 'Writing three ways it could open…');
    check('the time waited', elapsedWords(0) === '0:00' && elapsedWords(7400) === '0:07' && elapsedWords(161000) === '2:41' && elapsedWords(-5) === '0:00' && elapsedWords('x') === '0:00');
    check('a Start that did not come back, in words: what was typed is kept', /^The world did not answer in 20 seconds\. Nothing was started, and your words are kept: try again\.$/.test(describeStartResult({ ok: false, reason: 'timeout', error: 'The world did not answer in 20 seconds' })) && describeStartResult({ ok: false, reason: 'stopped' }) === 'Stopped. Nothing was started, and your words are kept.' && /went wrong while the scene was prepared \(x is not a function\)/.test(describeStartResult({ ok: false, reason: 'error', error: 'x is not a function' })));
}

console.log('\n§ what happened in between is kept with the scene it opens (D222)');
{
    const note = 'Isabella and Jack spend the next week together. Jack meets her mother. The story starts on their first day back.';
    const opened = openScene(normalizeWorldEntry(null), { title: 'Back to work', chat: 'Scene 1', note });
    check('a scene keeps what the player said happens next when they started it', opened.scene.note === note && normalizeScene({ id: 's1', note: 'x'.repeat(5000) }).note.length === MAX_NOTE);
    check('one started with nothing said keeps none', openScene(normalizeWorldEntry(null), { title: 'x', chat: 'c' }).scene.note === undefined && !('note' in normalizeScene({ id: 's1' })));
    const ended = endSceneRecord(opened.entry, 's1', { endedAt: 5, recap: 'They went back.' });
    check('ending it keeps them', ended.scene.note === note);
    const p = buildRecapPrompt({ transcript: 'Narrator: The office.', player: 'Jack', before: note });
    check('the record is told them before the scene, as the player\'s own words', p.user.includes(`Before this scene opened, Jack said this of what had happened since the scene before and of how this one should open (their own words):\n${note}\n\nThe scene:\nNarrator: The office.`));
    check('…and that what had happened by then did happen, and what is only asked for did not', /what it says had already happened by then \(time that passed, what was done in it, who was met\) did happen, off the page, and the record tells it in a sentence or two before what the scene shows/.test(p.system) && /What it only asks for, plans or expects is not part of the story unless the scene shows it\.$/.test(p.system));
    const both = buildRecapPrompt({ transcript: 'x', player: 'Jack', before: note, wrap: 'They left.' });
    check('with how the scene ended too, both are told', both.user.includes('Before this scene opened') && both.user.includes('How the scene ended') && /did happen, off the page/.test(both.system) && /that is how it ended/.test(both.system));
    check('a later part of a long scene is not told them again', !buildRecapPrompt({ transcript: 'x', player: 'Jack', before: note, soFar: 'So far.' }).user.includes('Before this scene opened') && !/off the page/.test(buildRecapPrompt({ transcript: 'x', player: 'Jack', before: note, soFar: 'So far.' }).system));
    check('with nothing said, the request is as it was', !buildRecapPrompt({ transcript: 'x', player: 'Jack' }).user.includes('Before this scene opened') && !/off the page/.test(buildRecapPrompt({ transcript: 'x', player: 'Jack' }).system));
}

console.log('\n§ new faces from the lorebooks (D223)');
{
    check('the words name the lorebooks, however they are spelt', asksForLore('one of the unexplored girls in the lore books') && asksForLore('someone from the Lorebook') && asksForLore('a face out of the lore-books') && !asksForLore('the lore of the place') && !asksForLore('books on a shelf') && !asksForLore(''));
    const read = readDirection('Each of the openings should lead to one of the unexplored girls in the lore books.', { places: [], people: [] });
    check('read out of the words with the rest, and said on the sheet', read.lore === true && describeDirection(read) === 'new faces from the lorebooks' && describeDirection(readDirection('Three days later, someone new from the lorebooks.', {})) === 'three days later · new faces from the lorebooks');
    check('the name an entry goes by', loreEntryName({ title: 'Kiyoha — who she is', keys: [] }) === 'Kiyoha' && loreEntryName({ title: 'Rogue (fixer)', keys: [] }) === 'Rogue' && loreEntryName({ title: 'Character: Mira Okonkwo', keys: [] }) === 'Mira Okonkwo' && loreEntryName({ title: 'The Afterlife: a bar', keys: [] }) === 'The Afterlife' && loreEntryName({ title: '', keys: ['Sable', 'forger'] }) === 'Sable' && loreEntryName({ title: 'Jean-Luc', keys: [] }) === 'Jean-Luc' && loreEntryName({}) === '');
    const book = loreEntries('Faces', { entries: {
        1: { key: ['Isabella'], comment: 'Isabella — who she is', content: 'Isabella is a singer with dark hair. She laughs easily.' },
        2: { key: ['Mira'], comment: 'Mira Okonkwo', content: 'Mira is a courier, twenty-six years old. She talks fast and she never sits still.' },
        3: { key: ['Afterlife'], comment: 'The Afterlife', content: 'A bar in an old morgue.' },
        4: { key: ['Sable'], comment: 'Sable (the forger)', content: 'Sable forges papers. She has grey eyes and her voice is soft.' },
        5: { key: ['canal'], comment: 'The Canals', content: 'Black water between the towers.' },
        6: { key: [], comment: 'STORY CANON', content: 'Always on.', constant: true },
        7: { key: ['Tom'], comment: 'Old Tom', content: 'Tom keeps the ferry. He is sixty years old and his beard is white.' },
        8: { key: ['Rogue'], comment: 'Rogue', content: 'Rogue runs the Afterlife. She is feared.' },
        9: { key: ['Vex'], comment: 'Vex', content: 'A name on a wall.' },
        10: { key: ['off'], comment: 'Switched off', content: 'Not read.', disable: true },
    } });
    const order = () => 0.5;
    const pick = (o) => untouchedLore(book, { rand: order, ...o }).map(x => x.name);
    const all = pick({});
    check('with nothing known, every entry but the ones that are always on or switched off', same([...all].sort(), ['Isabella', 'Mira Okonkwo', 'Old Tom', 'Rogue', 'Sable', 'The Afterlife', 'The Canals', 'Vex']), JSON.stringify(all));
    check('the story\'s people are in it already: by their whole name, by the name before what is said of them, by a first name', !pick({ people: ['Isabella'] }).includes('Isabella') && !pick({ people: ['Rogue Amendiares'] }).includes('Rogue') && !pick({ people: ['Mira, the courier'] }).includes('Mira Okonkwo') && !pick({ people: ['Sable (the forger)'] }).includes('Sable'));
    check('a word names begin with is not the name: Old Marit is not Old Tom, The Baron is not The Canals', pick({ people: ['Old Marit', 'The Baron'] }).includes('Old Tom') && pick({ people: ['Old Marit', 'The Baron'] }).includes('The Canals') && pick({ people: ['Old Marit', 'The Baron'] }).includes('The Afterlife'));
    check('what the story\'s own text names is in it already: by the entry\'s name or one of its keys, as a word of its own', !pick({ text: 'They met at the Afterlife.' }).includes('The Afterlife') && !pick({ text: 'Along the canal at night.' }).includes('The Canals') && pick({ text: 'A sablefish supper.' }).includes('Sable') && !pick({ text: 'Rogue was not there.' }).includes('Rogue'));
    const ranked = untouchedLore(book, { rand: order });
    check('people first: an entry that reads as a person comes before one that does not', ranked.findIndex(x => x.name === 'The Canals') > ranked.findIndex(x => x.name === 'Old Tom') && ranked.findIndex(x => x.name === 'Vex') > ranked.findIndex(x => x.name === 'Mira Okonkwo') && ranked.find(x => x.name === 'Mira Okonkwo').person === true && ranked.find(x => x.name === 'The Canals').person === false);
    const girls = untouchedLore(book, { rand: order, words: 'one of the unexplored girls in the lore books' }).map(x => x.name);
    check('the kind the words ask for comes before the other', girls.indexOf('Old Tom') > Math.max(girls.indexOf('Mira Okonkwo'), girls.indexOf('Sable'), girls.indexOf('Isabella')), JSON.stringify(girls));
    const carded = untouchedLore(book, { rand: order, workshop: ['Vex'] }).map(x => x.name);
    check('one with a card in the Workshop is a person, whatever its entry reads like', carded[0] === 'Vex');
    let k = 0;
    const turn = () => [0.9, 0.1, 0.5, 0.3, 0.7, 0.2, 0.8, 0.4][k++ % 8];
    const a = untouchedLore(book, { rand: turn }).map(x => x.name).join();
    k = 3;
    const b = untouchedLore(book, { rand: turn }).map(x => x.name).join();
    check('among equals the order is drawn afresh each time', a !== b);
    check('each is cut to a length, and no more are kept than the pool holds', untouchedLore([{ book: 'B', title: 'Long One', keys: [], content: 'She is tall. '.repeat(400), constant: false }], {})[0].text.length <= LORE_FRESH_EACH && untouchedLore(book, { rand: order, pool: 3 }).length === 3);
    check('about twice as many are given as openings are asked for, six at the least', freshCount(1) === 6 && freshCount(3) === 8 && freshCount(6) === 14 && freshCount(undefined) === 8);
    const pool = untouchedLore(book, { rand: order });
    const s1 = loreSample(pool, { from: 0, count: 3 }).map(x => x.name);
    const s2 = loreSample(pool, { from: 3, count: 3 }).map(x => x.name);
    const s3 = loreSample(pool, { from: 6, count: 3 }).map(x => x.name);
    check('the ones given are taken in turn, round again past the last', s1.length === 3 && s2.length === 3 && !s1.some(n => s2.includes(n)) && s3.length === 3 && s3[2] === s1[0], JSON.stringify([s1, s2, s3]));
    check('never more than there are, and within a total length', loreSample(pool, { from: 0, count: 50 }).length === pool.length && loreSample(pool, { from: 0, count: 8, total: 250 }).length <= 2 && same(loreSample([], {}), []));
    const p = buildOpenersPrompt({ world: { name: 'Night City' }, player: 'Jack', note: 'Lead to one of the unexplored girls in the lore books.', count: 3, fresh: loreSample(pool, { from: 0, count: 2 }) });
    check('the request is given them under their names, after the player\'s words', p.user.includes(`From the lorebooks, not in the story yet (Jack has not met them):\n[${pool[0].name}] ${pool[0].text}\n[${pool[1].name}] ${pool[1].text}\n`) && p.user.indexOf('says happens next') < p.user.indexOf('From the lorebooks'));
    check('…and told to bring them in as the words ask, a different one in each opener, met for the first time, and named in "who"', /because Jack's words ask for someone or something out of them: bring them in as those words ask, a different one in each opener, each written as their entry says and met here for the first time \(Jack does not know them\)\. Whoever of them is in an opener is named in its "who", by the name in brackets\./.test(p.system));
    check('for one opener there is no "different one in each"', !/a different one in each opener/.test(buildOpenersPrompt({ player: 'Jack', note: 'x', count: 1, fresh: loreSample(pool, { count: 2 }) }).system));
    check('with none given the request is as it was', !buildOpenersPrompt({ player: 'Jack', note: 'x' }).user.includes('From the lorebooks') && !/out of them/.test(buildOpenersPrompt({ player: 'Jack', note: 'x' }).system));
}

console.log('\n§ how long an opening is (D224)');
{
    check('four lengths: as the narrator writes, which is how it was, and three sizes', same(OPENER_LENGTHS.map(x => x.id), ['narrator', 'short', 'medium', 'long']) && same(OPENER_LENGTHS.map(x => x.label), ['As the narrator writes', 'Short', 'Medium', 'Long']) && OPENER_LENGTHS[0].words === '' && OPENER_LENGTHS.slice(1).every(x => /paragraph/.test(x.words) && /words/.test(x.words)));
    check('the length chosen is kept with the hub\'s settings; anything else is as the narrator writes', openerLength('long') === 'long' && openerLength('huge') === 'narrator' && openerLength(undefined) === 'narrator' && hubConfig({ hub: { openerLength: 'short' } }).openerLength === 'short' && hubConfig({ hub: { openerLength: 7 } }).openerLength === 'narrator' && normalizeHub({ openerLength: 'medium' }).openerLength === 'medium');
    check('the longest size stays within what one opening may hold', /650 words/.test(OPENER_LENGTHS[3].words) && 650 * 6 <= MAX_OPENER_TEXT);
    const lines = 'Narrator: The rain had not stopped.';
    const asIs = buildOpenersPrompt({ player: 'Jack', tail: lines });
    check('as the narrator writes, after a scene: about as long as the narrator\'s own messages there, as before', /about as long as one of the narrator's own messages there; no headings/.test(asIs.system) && asIs.system === buildOpenersPrompt({ player: 'Jack', tail: lines, length: 'narrator' }).system && asIs.system === buildOpenersPrompt({ player: 'Jack', tail: lines, length: 'nonsense' }).system);
    check('…and with no scene before: a paragraph or two, as before', /it stops with the first move still Jack's; a paragraph or two, plain prose/.test(buildOpenersPrompt({ player: 'Jack' }).system));
    const long = buildOpenersPrompt({ player: 'Jack', tail: lines, length: 'long' }).system;
    check('a size chosen, after a scene: said outright, whatever the length of the narrator\'s messages; the rest of how the narrator wrote still holds', /the same person and tense, speech set out the same way \(its marks and any colour tags\), and each opener four to six paragraphs, about 450 to 650 words long, whatever the length of the narrator's messages there; no headings/.test(long) && !/about as long as one of the narrator's own messages/.test(long));
    check('a size chosen, with no scene before: in place of a paragraph or two', /still Jack's; one paragraph, about 60 to 120 words, plain prose/.test(buildOpenersPrompt({ player: 'Jack', length: 'short' }).system) && /still Jack's; two or three paragraphs, about 180 to 320 words, plain prose/.test(buildOpenersPrompt({ player: 'Jack', length: 'medium' }).system) && !/a paragraph or two/.test(buildOpenersPrompt({ player: 'Jack', length: 'medium' }).system));
    check('the length changes nothing else of the request', buildOpenersPrompt({ player: 'Jack', tail: lines, length: 'long' }).user === asIs.user);
}

console.log(failures ? `\n${failures} FAILED` : '\nall pass');
process.exit(failures ? 1 : 0);
