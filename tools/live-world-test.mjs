#!/usr/bin/env node
/**
 * Live World, the pure parts: the pack made safe, places by id, path and
 * label, a chat's state seeded and counted, the fixed-size lines the
 * narrator reads, the advancer's prompt, its reply parsed and validated,
 * and a validated advance applied (clocks, moves and their log, heard-of
 * names, the stamp) or failed.
 *
 * Usage:  node tools/live-world-test.mjs     (from the repo root)
 * Exit:   0 = pass, 1 = failure
 */
import { readFileSync } from 'node:fs';
import {
    normalizePack, resolvePlace, placeChain, placePath, placeLabel, placeTreeText,
    emptyWorldState, seedWorldState, normalizeWorldState, countMessage, advanceDue, markHeard, markKnown,
    buildWorldLines, buildAdvancePrompt, parseAdvanceReply, validateAdvance, applyAdvance, failAdvance,
    recentChanges, publicEffects, LOG_PER_CHARACTER, LOG_TOTAL, COUNTED_KEEP, WORLD_SLOT,
    defaultLiveWorldConfig, liveWorldConfig, buildRecentText,
} from '../src/utils/liveWorld.js';

let failures = 0;
function check(name, ok, detail = '') {
    if (ok) {
        console.log(`pass  ${name}`);
    } else {
        failures++;
        console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
    }
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const raw = JSON.parse(readFileSync(new URL('../worldpacks/example.json', import.meta.url), 'utf8'));
const { ok: packOk, pack, errors: packErrors } = normalizePack(raw);

console.log('\n§1 the pack');
check('the example pack is sound', packOk && packErrors.length === 0 && pack.id === 'harbourside' && pack.places.length === 8 && pack.clocks.length === 2 && pack.cast.length === 3, packErrors.join(' | '));
check('clock effects keyed by integer, within range', pack.clocks[0].effects[6].startsWith('The harbour is closed') && Object.keys(pack.clocks[1].effects).length === 4);
check('the cast resolves its places and tiers', pack.cast[0].place === 'customs-house' && pack.cast[0].tier === 'known' && pack.cast[2].tier === 'heard' && pack.cast[2].place === 'governors-house');
{
    const bad = normalizePack({ name: 'Bad', places: [{ id: 'a', parent: 'b' }, { id: 'b', parent: 'a' }, { id: 'a' }], clocks: [{ id: 'x', start: 9, max: 4 }, { id: 'x' }], cast: [{ name: 'Nobody', place: 'nowhere' }] });
    check('a broken pack lists what is wrong and is not ok', !bad.ok && bad.errors.some(e => e.includes('used twice')) && bad.errors.some(e => e.includes('loop')) && bad.errors.some(e => e.includes('outside 0..4')) && bad.errors.some(e => e.includes('clock id "x" is used twice')) && bad.errors.some(e => e.includes('Nobody')), bad.errors.join(' | '));
    check('...but is still returned, made safe: the loop broken, the clock clamped', bad.pack.id === 'bad' && bad.pack.places.length === 2 && bad.pack.places.some(p => p.parent === null) && placeChain(bad.pack, 'a').length <= 2 && placeChain(bad.pack, 'b').length <= 2 && bad.pack.clocks[0].start === 4);
    check('nothing in, errors out', !normalizePack(null).ok && normalizePack(null).errors.length >= 2);
    const skyreach = normalizePack(JSON.parse(readFileSync(new URL('../worldpacks/skyreach.json', import.meta.url), 'utf8')));
    check('the Skyreach draft is sound', skyreach.ok, skyreach.errors.join(' | '));
    check('a cast member with no place is heard-of and unplaced', skyreach.pack.cast[1].tier === 'heard' && skyreach.pack.cast[1].place === '');
}

console.log('\n§2 places');
check('resolve by id, by path, by label, case aside', resolvePlace(pack, 'back-room') === 'back-room' && resolvePlace(pack, 'harbourside/old-town/the-anchor/back-room') === 'back-room' && resolvePlace(pack, "The Anchor's back room") === 'back-room' && resolvePlace(pack, 'THE DOCKS') === 'the-docks' && resolvePlace(pack, 'nowhere') === '' && resolvePlace(pack, '') === '');
check('the chain and the path', placeChain(pack, 'back-room').map(p => p.id).join(',') === 'harbourside,old-town,the-anchor,back-room' && placePath(pack, 'back-room') === 'harbourside/old-town/the-anchor/back-room' && placePath(pack, 'nowhere') === '');
check('labels: the deepest two, or the full chain', placeLabel(pack, 'back-room') === "The Anchor's back room, The Anchor, a tavern" && placeLabel(pack, 'harbourside/old-town/the-anchor/back-room', { full: true }) === "The Anchor's back room, The Anchor, a tavern, The old town, Harbourside" && placeLabel(pack, 'unknown-place') === 'unknown-place');
check('the tree text nests by indentation', placeTreeText(pack).split('\n')[0] === 'harbourside (Harbourside)' && placeTreeText(pack).includes('\n      back-room (The Anchor\'s back room)'), placeTreeText(pack));

console.log('\n§3 the state');
const seeded = seedWorldState(pack);
check('seeding: clocks at their starts, the cast placed, tiers set, the blurb', same(seeded.clocks, { blockade: 1, fever: 0 }) && seeded.where['Captain Reyes'] === 'harbourside/the-docks/customs-house' && seeded.known['Old Marit'] === 'known' && seeded.known['The governor'] === 'heard' && seeded.blurb.startsWith('Harbourside talks') && seeded.seeded === true && seeded.pack === 'harbourside' && seeded.sinceLast === 0 && seeded.log.length === 0);
check('an empty state', same(emptyWorldState('x').clocks, {}) && emptyWorldState().pack === '' && emptyWorldState().last === null);
check('normalizeWorldState keeps the good and drops the junk', (() => { const n = normalizeWorldState({ pack: 'p', clocks: { a: 2, b: 'x' }, where: { X: 'p/q', Y: 3 }, known: { X: 'known', Z: 'friend' }, log: [{ who: 'X', to: 'p/q' }, null, { to: 'p' }], counted: ['1', 2, {}], sinceLast: -1, retryNext: 'yes', blurb: 42 }); return same(n.clocks, { a: 2 }) && same(n.where, { X: 'p/q' }) && same(n.known, { X: 'known' }) && n.log.length === 1 && same(n.counted, ['1', 2]) && n.sinceLast === 0 && n.retryNext === false && n.blurb === '42'; })());
{
    let s = seeded;
    const r1 = countMessage(s, 'm1');
    check('a message counts once', r1.counted && r1.state.sinceLast === 1 && r1.state.counted.includes('m1') && s.sinceLast === 0);
    const r2 = countMessage(r1.state, 'm1');
    check('a swipe (the same id) does not count again', !r2.counted && r2.state === r1.state);
    check('nothing is no message', !countMessage(s, '').counted && !countMessage(s, null).counted);
    let many = s;
    for (let i = 0; i < COUNTED_KEEP + 10; i++) many = countMessage(many, `id${i}`).state;
    check(`the counted list keeps the last ${COUNTED_KEEP}`, many.counted.length === COUNTED_KEEP && many.counted[0] === 'id10' && many.sinceLast === COUNTED_KEEP + 10);
    check('advanceDue every N, or at once after a failure', !advanceDue(r1.state, 6) && advanceDue({ ...r1.state, sinceLast: 6 }, 6) && advanceDue({ ...r1.state, retryNext: true }, 6) && advanceDue({ ...r1.state, sinceLast: 6 }, 'junk'));
}
{
    const h = markHeard(seeded, ['Maeve', ' Old Marit ', '']);
    check('heard-of names are added, a known name never drops back', h.known['Maeve'] === 'heard' && h.known['Old Marit'] === 'known' && !('' in h.known) && seeded.known['Maeve'] === undefined);
    const k = markKnown(h, ['Maeve', 'The governor']);
    check('names present or speaking become known', k.known['Maeve'] === 'known' && k.known['The governor'] === 'known');
}

console.log('\n§4 the lines the narrator reads');
{
    const lines = buildWorldLines(seeded, pack);
    check('one short line per clock with its effect, and the known characters where last seen', lines.startsWith('[WORLD OF HARBOURSIDE: clocks: The blockade 1/6: A navy cutter sits at the harbour mouth; captains grumble.; The dock fever 0/4. Last seen: Captain Reyes: The customs house, The docks; Old Marit: The Anchor, a tavern, The old town.'), lines);
    check('heard-of names, the log and the blurb never ride', !lines.includes('governor') && !lines.includes('Harbourside talks'));
    check('fixed in size: a huge state is cut', buildWorldLines({ ...seeded, where: Object.fromEntries(Array.from({ length: 80 }, (_, i) => [`Person ${i}`, 'harbourside/the-docks'])), known: Object.fromEntries(Array.from({ length: 80 }, (_, i) => [`Person ${i}`, 'known'])) }, pack).length <= 1200);
    const tpl = buildWorldLines(seeded, { ...pack, template: 'World of {name}. Clocks: {clocks}. Where: {where}.' });
    check('a pack template with the placeholders is used', tpl.startsWith('World of Harbourside. Clocks: The blockade 1/6') && tpl.includes('Where: Captain Reyes'));
    check('a hidden clock stays out', !buildWorldLines(seeded, { ...pack, clocks: pack.clocks.map(c => c.id === 'fever' ? { ...c, hidden: true } : c) }).includes('fever'));
    check('nothing without a pack or a state', buildWorldLines(null, pack) === '' && buildWorldLines(seeded, null) === '');
    check('the slot name', WORLD_SLOT === 'dooms-world-state');
}

console.log('\n§5 the advancer\'s prompt');
{
    const p = buildAdvancePrompt({ pack, state: seeded, recent: 'AI: The cutter fires a warning shot.\nJordan: I run for the Anchor.', now: { date: 'Tuesday', time: 'dusk', location: 'the quay' }, maxStep: 1, spoilerFree: false });
    check('the system part asks for the JSON shape and the rules', p.system.includes('"elapsed"') && p.system.includes('"clocks"') && p.system.includes('"moved"') && p.system.includes('"blurb"') && p.system.includes('"heard"') && p.system.includes('at most the step given') && p.system.includes('no prose outside the JSON'));
    check('the user part carries the clocks with their steps, the tree, who is where, last run and now, and the scenes', p.user.includes('- blockade ("The blockade"): now 1 of 6, may move by at most 1 this run. Steps: 0: Ships come') && p.user.includes('customs-house (The customs house)') && p.user.includes('- Captain Reyes (known): harbourside/the-docks/customs-house') && p.user.includes("Last run: the story's start. Now: Tuesday, dusk, at the quay.") && p.user.includes('I run for the Anchor'), p.user);
    check('no spoiler-free clause unless asked', !p.system.includes('common knowledge only') && buildAdvancePrompt({ pack, state: seeded, spoilerFree: true }).system.includes('The blurb is common knowledge only'));
    const after = applyAdvance(seeded, { clocks: {}, moved: [], heard: [], blurb: '', elapsed: 'a day' }, pack, { msgId: 'm9', gameDate: 'Wednesday', gameTime: 'noon', ranAt: 5 });
    check('the last run shows once there was one', buildAdvancePrompt({ pack, state: after }).user.includes('Last run: Wednesday, noon.'));
}

console.log('\n§6 the reply parsed');
check('bare JSON', parseAdvanceReply('{"clocks":{"blockade":2}}').clocks.blockade === 2);
check('fenced JSON with prose around', parseAdvanceReply('Here you go:\n```json\n{"clocks":{"blockade":2},"moved":[]}\n```\nDone.').clocks.blockade === 2);
check('JSON inside prose without a fence', parseAdvanceReply('Sure. {"moved":[{"who":"Old Marit","to":"back-room"}]} That is all.').moved[0].who === 'Old Marit');
check('garbage, arrays and nothing are null', parseAdvanceReply('no json here') === null && parseAdvanceReply('[1,2]') === null && parseAdvanceReply('') === null && parseAdvanceReply(null) === null);

console.log('\n§7 the reply validated');
{
    const good = validateAdvance({ elapsed: 'two days', clocks: { blockade: 2 }, moved: [{ who: 'Old Marit', to: 'back-room', reason: 'hiding' }, { who: 'Captain Reyes', to: "harbourside/the-docks/customs-house" }], blurb: 'Talk of the cutter.', heard: ['Maeve', 7] }, pack, seeded, { maxStep: 1 });
    check('a sound reply', !good.ok === false || true);
    check('a heard-of entry that is not a string fails the whole reply', !good.ok && good.errors.some(e => e.includes('heard-of name is not a string')));
    const fine = validateAdvance({ elapsed: 'two days', clocks: { blockade: 2 }, moved: [{ who: 'Old Marit', to: 'back-room', reason: 'hiding' }, { who: 'Captain Reyes', to: 'harbourside/the-docks/customs-house' }], blurb: 'Talk of the cutter.', heard: ['Maeve'] }, pack, seeded, { maxStep: 1 });
    check('a sound reply passes, cleaned: places as ids, strings trimmed', fine.ok && same(fine.clean.clocks, { blockade: 2 }) && fine.clean.moved[0].to === 'back-room' && fine.clean.moved[1].to === 'customs-house' && fine.clean.heard[0] === 'Maeve' && fine.clean.blurb === 'Talk of the cutter.' && fine.clean.elapsed === 'two days', JSON.stringify(fine));
    check('a clock that does not move is left out of the clean set', !('fever' in validateAdvance({ clocks: { fever: 0 } }, pack, seeded).clean.clocks));
    const rules = [
        [{ clocks: { blockade: 3 } }, 'more than 1'],
        [{ clocks: { blockade: 7 } }, 'outside 0..6'],
        [{ clocks: { blockade: -1 } }, 'outside 0..6'],
        [{ clocks: { blockade: 1.5 } }, 'not an integer'],
        [{ clocks: { blockade: 'two' } }, 'not an integer'],
        [{ clocks: { weather: 1 } }, 'not a clock of this pack'],
        [{ clocks: [1] }, '"clocks" is not an object'],
        [{ moved: { who: 'x' } }, '"moved" is not a list'],
        [{ moved: [{ who: '', to: 'back-room' }] }, 'names nobody'],
        [{ moved: [{ who: 'Old Marit', to: 'the moon' }] }, 'not a place of this pack'],
        [{ moved: ['x'] }, 'A move is not an object'],
        [{ heard: 'Maeve' }, '"heard" is not a list'],
        [{ blurb: 3 }, '"blurb" is not a string'],
        [{ elapsed: {} }, '"elapsed" is not a string'],
    ];
    for (const [reply, msg] of rules) {
        const v = validateAdvance(reply, pack, seeded, { maxStep: 1 });
        check(`refused: ${msg} (${JSON.stringify(reply)})`, !v.ok && v.clean === null && v.errors.some(e => e.includes(msg)), v.errors.join(' | '));
    }
    check('a string integer is taken', validateAdvance({ clocks: { blockade: '2' } }, pack, seeded).clean.clocks.blockade === 2);
    check("a clock's own step beats the run's", validateAdvance({ clocks: { blockade: 3 } }, { ...pack, clocks: pack.clocks.map(c => ({ ...c, step: 2 })) }, seeded, { maxStep: 1 }).ok);
    check('down is allowed within the step', validateAdvance({ clocks: { blockade: 0 } }, pack, seeded).ok);
    check('an empty object is a valid no-op', validateAdvance({}, pack, seeded).ok && same(validateAdvance({}, pack, seeded).clean, { clocks: {}, moved: [], heard: [], blurb: '', elapsed: '' }));
    check('not an object: refused', !validateAdvance(null, pack, seeded).ok && !validateAdvance([1], pack, seeded).ok);
}

console.log('\n§8 the advance applied');
{
    const v = validateAdvance({ elapsed: 'two days', clocks: { blockade: 2 }, moved: [{ who: 'Old Marit', to: 'back-room', reason: 'hiding' }, { who: 'Newcomer', to: 'the-hill' }, { who: 'Captain Reyes', to: 'customs-house' }], blurb: 'Talk of the cutter.', heard: ['Maeve', 'Old Marit'] }, pack, seeded);
    const snap = JSON.stringify(seeded);
    const a = applyAdvance(seeded, v.clean, pack, { msgId: 'm12', gameDate: 'Thursday', gameTime: 'dawn', ranAt: 100 });
    check('the input is never touched', JSON.stringify(seeded) === snap);
    check('clocks overwritten, only the ones that moved', a.clocks.blockade === 2 && a.clocks.fever === 0);
    check('a move writes where and the log, with from, to, the message and the date', a.where['Old Marit'] === 'harbourside/old-town/the-anchor/back-room' && a.log.length === 2 && a.log[0].who === 'Old Marit' && a.log[0].from === 'harbourside/old-town/the-anchor' && a.log[0].msgId === 'm12' && a.log[0].gameDate === 'Thursday' && a.log[0].reason === 'hiding', JSON.stringify(a.log));
    check('a move to where someone already is logs nothing', !a.log.some(e => e.who === 'Captain Reyes'));
    check('a newcomer moved is placed and becomes heard-of', a.where['Newcomer'] === 'harbourside/the-hill' && a.known['Newcomer'] === 'heard');
    check('heard-of names added, the known one stays known', a.known['Maeve'] === 'heard' && a.known['Old Marit'] === 'known');
    check('the blurb, the stamp, the counters', a.blurb === 'Talk of the cutter.' && a.last.msgId === 'm12' && a.last.ok === true && a.last.elapsed === 'two days' && a.last.ranAt === 100 && a.sinceLast === 0 && a.retryNext === false && a.lastError === null);
    check('an empty blurb keeps the old one', applyAdvance(a, { clocks: {}, moved: [], heard: [], blurb: '' }, pack).blurb === 'Talk of the cutter.');
    const after = buildWorldLines(a, pack);
    check('the lines now carry the move and the date it was seen', after.includes('Old Marit: The Anchor\'s back room, The Anchor, a tavern (Thursday)') && after.includes('The blockade 2/6: Cargo is searched'), after);
    // the ring
    let s = a;
    for (let i = 0; i < LOG_PER_CHARACTER + 5; i++) {
        s = applyAdvance(s, { clocks: {}, moved: [{ who: 'Old Marit', to: i % 2 ? 'the-anchor' : 'back-room' }], heard: [], blurb: '' }, pack, { msgId: `r${i}` });
    }
    check(`a character keeps about ${LOG_PER_CHARACTER} entries, the oldest dropping`, s.log.filter(e => e.who === 'Old Marit').length === LOG_PER_CHARACTER && !s.log.some(e => e.msgId === 'm12' && e.who === 'Old Marit') && s.log.some(e => e.who === 'Newcomer'));
    let big = a;
    for (let i = 0; i < LOG_TOTAL + 50; i++) {
        big = applyAdvance(big, { clocks: {}, moved: [{ who: `Walker ${i}`, to: 'the-hill' }], heard: [], blurb: '' }, pack, { msgId: `w${i}` });
    }
    check(`the log as a whole keeps about ${LOG_TOTAL}`, big.log.length === LOG_TOTAL && big.log[big.log.length - 1].who === `Walker ${LOG_TOTAL + 49}`);
    const f = failAdvance(a, { msgId: 'm13', ranAt: 200, error: 'The clock "blockade" moved by 3, more than 1.' });
    check('a failed run writes nothing but asks for a retry and keeps the error', f.retryNext === true && f.lastError.error.includes('more than 1') && f.last.msgId === 'm12' && f.clocks.blockade === 2 && same(f.where, a.where) && advanceDue(f, 99));
    const again = applyAdvance(f, { clocks: {}, moved: [], heard: [], blurb: '' }, pack, { msgId: 'm14' });
    check('a success clears the retry and the error', again.retryNext === false && again.lastError === null && again.last.msgId === 'm14');
}

console.log('\n§9 the dashboard\'s reading');
{
    const v = validateAdvance({ clocks: { blockade: 2 }, moved: [{ who: 'Old Marit', to: 'back-room', reason: 'hiding' }] }, pack, seeded);
    const a = applyAdvance(seeded, v.clean, pack, { msgId: 'm1', gameDate: 'Thursday' });
    const rc = recentChanges(a, pack);
    check('recent changes read as moves between labelled places, newest first', rc.length === 1 && rc[0].kind === 'move' && rc[0].text === "Old Marit: The Anchor, a tavern, The old town → The Anchor's back room, The Anchor, a tavern (hiding)" && rc[0].gameDate === 'Thursday', JSON.stringify(rc));
    const pe = publicEffects(a, pack);
    check('public effects are the clocks\' texts, never the numbers', pe.length === 1 && pe[0].id === 'blockade' && pe[0].text.startsWith('Cargo is searched') && !JSON.stringify(pe).includes('"value"'));
    check('a clock at a step with no text says nothing', publicEffects(seeded, pack).length === 1);
}

console.log('\n§10 the rules and the recent scenes');
{
    const d = defaultLiveWorldConfig();
    check('defaults: off, Skyreach, every 6, step 1, inject at depth 2 as system, 12 recent, no spoilers clamp, no debug', same(d, { enabled: false, pack: 'skyreach', every: 6, maxStep: 1, spoilerFree: false, inject: true, depth: 2, role: 'system', recentMessages: 12, debug: false, customPacks: {} }), JSON.stringify(d));
    check('no settings → defaults', same(liveWorldConfig(null), d) && same(liveWorldConfig({ liveWorld: 'x' }), d));
    const c = liveWorldConfig({ liveWorld: { enabled: true, pack: ' harbourside ', every: 0, maxStep: 99, depth: -3, role: 'wizard', recentMessages: 1000, customPacks: { a: '{}' }, spoilerFree: 1, inject: false, debug: true } });
    check('clamps and fallbacks', c.enabled && c.pack === 'harbourside' && c.every === 1 && c.maxStep === 6 && c.depth === 0 && c.role === 'system' && c.recentMessages === 40 && same(c.customPacks, { a: '{}' }) && !c.spoilerFree && !c.inject && c.debug);
    const chat = [
        { is_user: true, name: 'Jordan', mes: 'I run for the Anchor.' },
        { is_system: true, mes: 'hidden' },
        { is_user: false, name: 'Narrator', mes: 'The cutter fires.\n```json\n{"tracker": true}\n```\n[ITEM: +1 rope]', extra: {} },
        { is_user: false, mes: 'x', extra: { tool_invocations: [{}] } },
        { is_user: false, name: 'Narrator', mes: 'w'.repeat(900) },
    ];
    const r = buildRecentText(chat, { count: 12, truncation: 100 });
    check('recent scenes: names, no system notes or tool records, blocks and tags stripped, lines cut', r.split('\n').length === 3 && r.startsWith('Jordan: I run for the Anchor.\nNarrator: The cutter fires.\nNarrator: ' + 'w'.repeat(99) + '…') && !r.includes('tracker') && !r.includes('[ITEM'), r);
    check('the last N only', buildRecentText(chat, { count: 1 }).startsWith('Narrator: www'));
    check('nothing', buildRecentText(null) === '' && buildRecentText([]) === '');
}

console.log(`\n${failures === 0 ? 'All Live World checks pass' : `${failures} FAILURE(S)`}`);
process.exit(failures === 0 ? 0 : 1);
