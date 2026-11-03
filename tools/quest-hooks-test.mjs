#!/usr/bin/env node
/**
 * Quest hooks, the pure parts (docs/hooks-canon-plan.md D100–D104): the
 * request grounded in the public world, the reply read and checked, a
 * round offered, a hook taken or set aside, the quest it becomes.
 *
 * Usage:  node tools/quest-hooks-test.mjs   (from the repo root)
 * Exit:   0 = all pass, 1 = a failure
 */
import { readFileSync } from 'node:fs';
import { normalizePack, seedWorldState, applyAdvance } from '../src/utils/liveWorld.js';
import { visitPlace } from '../src/utils/worldMap.js';
import {
    HOOKS_PER_ROUND, MAX_SET_ASIDE, emptyHooks, normalizeHooks, buildHooksPrompt, parseHooksReply, validateHooks,
    proposeRound, failRound, takeHook, setAside, questFromHook, describeHooksResult, hookKey,
} from '../src/utils/questHooks.js';

let failures = 0;
const check = (label, cond, extra = '') => {
    if (cond) console.log(`pass  ${label}`);
    else { console.error(`FAIL  ${label}${extra ? '\n      ' + extra : ''}`); failures++; }
};
const pack = normalizePack({ ...JSON.parse(readFileSync(new URL('../worldpacks/example.json', import.meta.url), 'utf8')), id: 'harbourside' }).pack;
let st = seedWorldState(pack);
st = visitPlace(st, pack, { location: 'The Anchor, the old town', msgId: 'm1', gameDate: 'Monday' }).state;
st = visitPlace(st, pack, { location: 'the quay', msgId: 'm2', gameDate: 'Tuesday' }).state;
st = applyAdvance(st, { clocks: { blockade: 3 }, moved: [{ who: 'Old Marit', to: 'governors-house', reason: 'summoned' }], blurb: 'The governor has sent for the old woman.', heard: ['Maeve'] }, pack, { msgId: 'm2', gameDate: 'Tuesday' });
const quests = { main: 'Find out who sank the Kestrel', optional: ['Pay the harbourmaster', 'None'] };
const done = [{ text: 'Feed the cat of the Anchor', at: 1, gameDate: 'Day 7' }];

console.log('\n§1 the request (D101)');
{
    const p = buildHooksPrompt({ pack, state: st, quests, done, taken: [], aside: ['Smuggle salt past the cutter'], recent: 'Jordan: I wave.\nNarrator: The quay is quiet.', now: { date: 'Tuesday', time: 'dusk', location: 'the quay' }, player: ['Jordan'] });
    check('the exact JSON asked for, three hooks, offered not commanded, the player never cast', p.system.includes('{"hooks":[{"title"') && p.system.includes('3 hooks') && p.system.includes('offer, never command') && p.system.includes('(Jordan) is never cast'));
    check('the street: the clock\'s public effect at its value now, the blurb', p.user.includes('No ship leaves without a stamped paper from the customs house.') && p.user.includes('Word on the street: The governor has sent for the old woman.') && !p.user.includes('now 3 of 6'));
    check('people where last seen, the heard-of apart; the places visited, latest first', p.user.includes("- Old Marit: The governor's house, The hill") && p.user.includes('Heard of, not met: The governor, Maeve') && p.user.indexOf('- the quay') < p.user.indexOf('- The Anchor, a tavern'));    // a pack place is listed by the pack's label
    check('the quests open (None left out) and what is not to be offered again', p.user.includes('- Find out who sank the Kestrel (the main quest)') && p.user.includes('- Pay the harbourmaster') && !p.user.includes('- None') && p.user.includes('- Feed the cat of the Anchor') && p.user.includes('- Smuggle salt past the cutter'));
    check('now and the recent scenes', p.user.includes('Now: Tuesday, dusk, at the quay.') && p.user.includes('Narrator: The quay is quiet.'));
    const bare = buildHooksPrompt({});
    check('no world at all still asks sensibly', bare.user.includes('- nothing in particular') && bare.user.includes('- no one placed yet') && bare.user.includes('Quests open:\n- none'));
}

console.log('\n§2 the reply read and checked');
{
    const reply = 'Here you go:\n```json\n{"hooks":[{"title":"Carry a paper to the quay","text":"Captain Reyes needs a stamped paper carried to the quay before the next tide; the customs house is the place to ask.","grounds":"the blockade","kind":"clock"},{"title":"Pay the harbourmaster","text":"Settle the debt at the docks.","kind":"quest"},{"title":"Call on Old Marit","text":"Old Marit was summoned to the governor\'s house; someone should learn why.","grounds":"Old Marit, last seen at the governor\'s house","kind":"Person"},{"title":"Call on Old Marit","text":"The same again.","kind":"person"},{"title":"Feed the cat of the Anchor","text":"The cat again.","kind":"place"},{"title":"A fourth","text":"Too many.","kind":"other"}]}\n```';
    const list = parseHooksReply(reply);
    const v = validateHooks(list, { quests, done, taken: [], aside: [] });
    check('a fenced reply is read; a quest already open, a repeat and a quest done are dropped, three stand, the kind lower-cased', list.length === 6 && v.ok && v.hooks.length === 3 && v.hooks.map(h => h.title).join('|') === 'Carry a paper to the quay|Call on Old Marit|A fourth' && v.hooks[1].kind === 'person' && v.errors.length === 3, JSON.stringify(v));
    check('a bare list, a single hook, and prose with nothing', Array.isArray(parseHooksReply('[{"title":"One","text":"Do a thing."}]')) && parseHooksReply('{"title":"One","text":"Do a thing."}').length === 1 && parseHooksReply('I would rather not.') === null);
    const none = validateHooks(parseHooksReply('I would rather not.'), {});
    check('nothing parses: not ok, said plainly', !none.ok && none.errors[0].includes('no hooks'));
    const allRepeats = validateHooks([{ title: 'Pay the harbourmaster', text: 'x' }], { quests });
    check('a round of nothing but repeats fails with the reason', !allRepeats.ok && allRepeats.errors[0].includes('already open'));
    check('set-aside titles are matched case and punctuation apart', !validateHooks([{ title: 'smuggle SALT past the cutter!', text: 'y' }], { aside: ['Smuggle salt past the cutter'] }).ok && hookKey('  The, Quay! ') === 'the quay');
}

console.log('\n§3 a round, a hook taken, one set aside');
{
    const found = validateHooks(parseHooksReply('{"hooks":[{"title":"Carry a paper","text":"Carry a stamped paper to the quay before the tide.","grounds":"the blockade","kind":"clock"},{"title":"Call on Old Marit","text":"Learn why the governor sent for her.","kind":"person"}]}'), {}).hooks;
    let hooks = proposeRound(emptyHooks(), found, { msgId: 'm2', gameDate: 'Tuesday', ranAt: 100 });
    check('the round carries ids, the reply\'s stamp and the date; the last run is good', hooks.proposed.length === 2 && hooks.proposed[0].id === 'h1' && hooks.proposed[1].id === 'h2' && hooks.proposed[0].msgId === 'm2' && hooks.proposed[0].gameDate === 'Tuesday' && hooks.last.ok && hooks.seq === 2);
    const t = takeHook(hooks, 'h1', { takenAt: 200 });
    check('taken: off the round, on the taken list, the quest text is the hook\'s text', t.hook && t.hook.title === 'Carry a paper' && t.hooks.proposed.length === 1 && t.hooks.taken.length === 1 && t.hooks.taken[0].at === 200 && questFromHook(t.hook) === 'Carry a stamped paper to the quay before the tide.');
    check('the input was not changed', hooks.proposed.length === 2);
    const a = setAside(t.hooks, 'h2');
    check('set aside: off the round, the title remembered', a.hook && a.hooks.proposed.length === 0 && a.hooks.aside.join() === 'Call on Old Marit');
    check('an id not on offer', takeHook(a.hooks, 'h9').hook === null && setAside(a.hooks, 'h9').hook === null);
    const next = proposeRound(a.hooks, found, { msgId: 'm3', ranAt: 300 });
    check('the next round continues the ids and replaces the offer', next.proposed.map(h => h.id).join() === 'h3,h4' && next.taken.length === 1 && next.aside.length === 1);
    const v = validateHooks(found, { taken: next.taken, aside: next.aside });
    check('what was taken or set aside is not offered again', !v.ok && v.errors.length === 2);
    const f = failRound(next, { error: 'network down', ranAt: 400 });
    check('a failed round keeps the offer and notes the failure', f.proposed.length === 2 && !f.last.ok && f.last.error === 'network down');
}

console.log('\n§4 the store made safe');
{
    const big = { proposed: Array.from({ length: 6 }, (_, i) => ({ id: `h${i}`, title: `T${i}`, text: `x${i}`, kind: 'moon' })), taken: Array.from({ length: 40 }, (_, i) => ({ title: `k${i}`, text: `y${i}` })), aside: Array.from({ length: 70 }, (_, i) => `a${i}`), last: { ranAt: 'x', ok: 1 }, seq: 9 };
    const n = normalizeHooks(big);
    check(`a round of ${HOOKS_PER_ROUND}, thirty taken, ${MAX_SET_ASIDE} set aside, an unknown kind is other, the last run made safe`, n.proposed.length === HOOKS_PER_ROUND && n.proposed[0].kind === 'other' && n.taken.length === 30 && n.taken[0].title === 'k10' && n.aside.length === MAX_SET_ASIDE && n.aside[0] === 'a10' && n.last.ranAt === 0 && n.last.ok === false && n.seq >= 9 && new Set(n.taken.map(t => t.id)).size === 30);    // taken hooks with no id take fresh ones, so the counter moves on
    check('nothing in, an empty record', normalizeHooks(null).proposed.length === 0 && normalizeHooks(null).last === null);
    check('the foot\'s lines', describeHooksResult({ ok: true, hooks: [1, 2] }) === '2 hooks on offer.' && describeHooksResult({ ok: false, reason: 'invalid', errors: ['x'] }).includes('No usable hook') && describeHooksResult({ ok: false, reason: 'busy' }).includes('try again'));
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nAll quest hooks checks pass');
process.exit(failures ? 1 : 0);
