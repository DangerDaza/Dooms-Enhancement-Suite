#!/usr/bin/env node
/**
 * The continuity a world's scenes carry (docs/long-shot-plan.md D188),
 * pure: where each person stands and the open threads made safe; what a
 * scene's record is told of them and what its reply changes (checked,
 * and carried from pass to pass); the change kept; what the next scene
 * is told.
 *
 * Usage:  node tools/continuity-test.mjs     (from the repo root)
 * Exit:   0 = pass, 1 = failure
 */
import { CONT, emptyContinuity, normalizeContinuity, hasContinuity, continuityDraft, draftBlocks, readContinuity, stepDraft, draftChanges, applyContinuity, changeCounts, standingLines, threadLines } from '../src/utils/continuity.js';

let failures = 0;
function check(name, cond, detail = '') {
    if (cond) console.log(`pass  ${name}`);
    else { failures++; console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ''}`); }
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

console.log('\n§1 the continuity made safe');
{
    check('nothing: no people, no threads', same(normalizeContinuity(null), { people: [], threads: [], seq: 0 }) && same(emptyContinuity(), normalizeContinuity('x')) && !hasContinuity(null) && !hasContinuity(emptyContinuity()));
    const c = normalizeContinuity({
        people: [{ name: ' Kiyoha ', now: 'On the Fourth Landing,   wounded.', scene: 's2', at: 5 }, { name: 'kiyoha', now: 'Healed.', scene: 's3', at: 9 }, { name: '', now: 'x' }, { name: 'Nobody' }, null, { name: 'Lysandra', now: 'y'.repeat(900) }],
        threads: [{ id: 't1', text: 'The debt to the Counting Room.' }, { id: 't1', text: 'Who cut the rope?' }, { text: 'the debt to the counting room' }, { text: '' }, 'junk', { id: 'nonsense', text: 'Solveig\'s stair rule.' }],
        seq: 1,
    });
    check('a person once, the later telling winning; an empty name or standing dropped; a standing cut to its length', c.people.length === 2 && c.people[0].name === 'Kiyoha' && c.people[0].now === 'Healed.' && c.people[0].scene === 's3' && c.people[1].now.length === CONT.personChars);
    check('a thread once (the same words twice are one), each with an id of its own', c.threads.length === 3 && same(c.threads.map(t => t.id), ['t1', 't2', 't3']) && c.seq === 3 && c.threads[1].text === 'Who cut the rope?');
    check('made safe twice changes nothing', same(normalizeContinuity(c), c) && hasContinuity(c));
    const many = normalizeContinuity({ people: Array.from({ length: 80 }, (_, i) => ({ name: `P${i}`, now: 'here', at: i })), threads: Array.from({ length: 70 }, (_, i) => ({ text: `thread number ${i}`, at: i })) });
    check(`within the caps: the ${CONT.people} people told last and the ${CONT.threads} newest threads are kept`, many.people.length === CONT.people && many.people.some(p => p.name === 'P79') && !many.people.some(p => p.name === 'P0') && many.threads.length === CONT.threads && many.threads[many.threads.length - 1].text === 'thread number 69' && !many.threads.some(t => t.text === 'thread number 0'));
}

const world = normalizeContinuity({
    people: [{ name: 'Kiyoha', now: 'At the Fourth Landing, shoulder cut; sworn to see Jordan down the stair.', scene: 's1', at: 1 }, { name: 'Lysandra', now: 'In Hask, out of ink; testing Jordan no longer.', scene: 's1', at: 1 }, { name: 'Solveig', now: 'Holding the rope at the stair head.', scene: 's1', at: 1 }],
    threads: [{ id: 't1', text: 'The debt to the Counting Room, due at the new moon.' }, { id: 't2', text: 'Who cut the rope on the Third Landing?' }, { id: 't3', text: 'Lysandra\'s back is still unwritten.' }],
    seq: 3,
});

console.log('\n§2 what a scene\'s record is told');
{
    const d = continuityDraft(world, ['kiyoha', 'Lysandra', 'Dagger', 'Kiyoha']);
    check('the draft: where the scene\'s people stood before it (those the world has a standing of, each once), and every open thread', same(d.people.map(p => [p.name, p.told, p.was === p.now]), [['Kiyoha', false, true], ['Lysandra', false, true]]) && d.threads.length === 3 && d.threads.every(t => !t.fresh) && d.closed.length === 0 && d.hidden === 0);
    const b = draftBlocks(d);
    check('told as two blocks: the people by name, the threads numbered', b.people.startsWith('Where they stood before this scene:\n- Kiyoha: At the Fourth Landing') && b.people.includes('\n- Lysandra: In Hask') && !b.people.includes('Solveig') && b.threads === 'Open threads:\n1. The debt to the Counting Room, due at the new moon.\n2. Who cut the rope on the Third Landing?\n3. Lysandra\'s back is still unwritten.');
    check('a world with nothing to tell tells nothing', same(draftBlocks(continuityDraft(null, ['Kiyoha'])), { people: '', threads: '' }) && same(draftBlocks(null), { people: '', threads: '' }));
    const big = normalizeContinuity({ threads: Array.from({ length: 30 }, (_, i) => ({ text: `an open thread ${i}` })) });
    const bd = continuityDraft(big, []);
    check(`a request is given the ${CONT.promptThreads} newest threads; the older stay open, unseen`, bd.threads.length === CONT.promptThreads && bd.hidden === 6 && bd.threads[0].text === 'an open thread 6');
}

console.log('\n§3 what its reply changes');
{
    const d = continuityDraft(world, ['Kiyoha', 'Lysandra']);
    const text = 'Narrator: Kiyoha laughed. Dagger came down the stair with the Factor behind him. Jordan paid the Counting Room in full.';
    const reply = {
        recap: 'x',
        people: [
            { name: 'kiyoha', now: 'At the Fifth Landing, shoulder bound; owes Jordan her life and says so.' }, { name: 'Jordan', now: 'the player is never told of' }, { name: 'Dagger', now: 'Joined the company on the stair; wants the Factor\'s key.' },
            { name: 'Ghost', now: 'nobody the scene names' }, { name: 'Kiyoha', now: 'twice' }, { name: 'Lysandra' }, null, { name: 'Solveig', now: 'Still at the stair head, rope in hand.' },
        ],
        threads: { closed: [1, 1, 9, 'x', 0], opened: ['The Factor wants his key back.', 'Who cut the rope on the Third Landing?', '', 'short', { thread: 'Dagger has not said why he came.' }] },
    };
    const r = readContinuity(reply, d, { players: ['Jordan'], known: ['Kiyoha', 'Lysandra', 'Solveig'], text });
    check('the people it speaks of: in the world\'s own spelling, each once, never the player, nobody the scene does not name', same(r.people.map(p => p.name), ['Kiyoha', 'Dagger', 'Solveig']) && r.people[0].now.startsWith('At the Fifth Landing'));
    check('the threads it settles: numbers of the list it was given, each once', same(r.closed, [1]));
    check('the threads it opens: none that is listed already, none too short to be one', same(r.opened, ['The Factor wants his key back.', 'Dagger has not said why he came.']));
    check('a reply that says nothing of either changes nothing; neither does prose', same(readContinuity({ recap: 'x' }, d), { people: [], closed: [], opened: [] }) && same(readContinuity(null, d), { people: [], closed: [], opened: [] }) && same(readContinuity({ people: 'no', threads: 'no' }, d), { people: [], closed: [], opened: [] }));
    check('threads given as a bare list are taken as opened', same(readContinuity({ threads: ['The bridge is still down.'] }, d).opened, ['The bridge is still down.']));
    check(`no more than ${CONT.scenePeople} people and ${CONT.sceneOpened} new threads a scene`, readContinuity({ people: Array.from({ length: 30 }, (_, i) => ({ name: `Kiyoha${i}`, now: 'x' })), threads: { opened: Array.from({ length: 30 }, (_, i) => `a new open thread ${i}`) } }, d, { text: Array.from({ length: 30 }, (_, i) => `kiyoha${i}`).join(' ') }).people.length === CONT.scenePeople && readContinuity({ threads: { opened: Array.from({ length: 30 }, (_, i) => `a new open thread ${i}`) } }, d).opened.length === CONT.sceneOpened);

    const next = stepDraft(d, r);
    check('the draft after it: the people stand as it said, the settled thread is off the list, the new ones are on it', next.people.find(p => p.name === 'Kiyoha').told && next.people.find(p => p.name === 'Kiyoha').was.startsWith('At the Fourth Landing') && !next.people.find(p => p.name === 'Lysandra').told && next.people.find(p => p.name === 'Dagger').was === '' && same(next.threads.map(t => [t.fresh, t.text.slice(0, 12)]), [[false, 'Who cut the '], [false, 'Lysandra\'s b'], [true, 'The Factor w'], [true, 'Dagger has n']]) && same(next.closed, [{ id: 't1', text: 'The debt to the Counting Room, due at the new moon.' }]));
    const ch = draftChanges(next);
    check('what the sheet shows: the people told of with where they stood, the new threads, the settled one, how many stay open', same(ch.people.map(p => [p.name, !!p.was]), [['Kiyoha', true], ['Dagger', false], ['Solveig', false]]) && ch.opened.length === 2 && ch.opened[0].key.startsWith('new:') && same(ch.closed.map(t => t.id), ['t1']) && ch.open === 2);
    check('nothing said: nothing to show', same(draftChanges(d), { people: [], opened: [], closed: [], open: 3 }) && same(draftChanges(null), { people: [], opened: [], closed: [], open: 0 }));

    // A record written in passes: the second pass is told the first's word and its numbers are of the list as it then stands.
    const b2 = draftBlocks(next, { soFar: true });
    check('a second pass is told how things stand so far, the new threads numbered with the rest', b2.people.startsWith('Where they stand as of the record so far:\n- Kiyoha: At the Fifth Landing') && b2.threads.includes('3. The Factor wants his key back.') && b2.threads.includes('4. Dagger has not said why he came.') && !b2.threads.includes('Counting Room'));
    const r2 = readContinuity({ people: [{ name: 'Kiyoha', now: 'At the stair foot, asleep on her axe.' }], threads: { closed: [3, 1], opened: ['The stair foot door is barred from the far side.'] } }, next, { players: ['Jordan'], known: ['Kiyoha'], text });
    const last = stepDraft(next, r2);
    const ch2 = draftChanges(last);
    check('settling a thread the scene itself opened leaves no trace; settling an older one is kept as settled', same(ch2.opened.map(t => t.text), ['Dagger has not said why he came.', 'The stair foot door is barred from the far side.']) && same(ch2.closed.map(t => t.id), ['t1', 't2']) && ch2.open === 1);
    check('a later pass\'s word on a person is the one that stands; where they stood before the scene is still told', ch2.people.find(p => p.name === 'Kiyoha').now === 'At the stair foot, asleep on her axe.' && ch2.people.find(p => p.name === 'Kiyoha').was.startsWith('At the Fourth Landing'));
    check('a new thread keeps a key of its own through the passes', new Set(ch2.opened.map(t => t.key)).size === 2 && ch2.opened[0].key === ch.opened[1].key);
}

console.log('\n§4 the change kept');
{
    const change = { people: [{ name: 'kiyoha', now: 'At the stair foot, asleep on her axe.' }, { name: 'Dagger', now: 'Joined the company; wants the Factor\'s key.' }, { name: 'Empty', now: '' }], opened: ['Dagger has not said why he came.', { text: 'Who cut the rope on the Third Landing?' }, ''], closed: ['t1', 'nope'] };
    const after = applyContinuity(world, change, { scene: 's4', at: 40 });
    check('each person told of stands as the record said, with the scene that said it; the others as they were', after.people.find(p => p.name === 'Kiyoha').now.startsWith('At the stair foot') && after.people.find(p => p.name === 'Kiyoha').scene === 's4' && after.people.find(p => p.name === 'Kiyoha').at === 40 && after.people.find(p => p.name === 'Lysandra').scene === 's1' && after.people.find(p => p.name === 'Dagger').scene === 's4' && after.people.length === 4);
    check('the settled thread is gone, the new one added with an id of its own, one that is open already not added twice', same(after.threads.map(t => t.id), ['t2', 't3', 't4']) && after.threads[2].text === 'Dagger has not said why he came.' && after.threads[2].scene === 's4' && after.seq === 4);
    check('how much a change holds, for the word that says what End kept', same(changeCounts(change), { people: 3, opened: 3, closed: 2 }) && same(changeCounts(null), { people: 0, opened: 0, closed: 0 }));
    check('no change, nothing changed; the world it was is not touched', same(applyContinuity(world, null), world) && same(applyContinuity(world, {}), world) && world.threads.length === 3 && world.people.find(p => p.name === 'Kiyoha').scene === 's1');
    check('a world with no continuity yet takes its first', (() => { const first = applyContinuity(null, { people: [{ name: 'Kiyoha', now: 'Here.' }], opened: ['A thread left open.'] }, { scene: 's0', at: 1 }); return first.people.length === 1 && first.threads[0].id === 't1' && first.seq === 1; })());
}

console.log('\n§5 what the next scene is told');
{
    const lines = standingLines(world, ['lysandra', 'Dagger', 'Kiyoha', 'Kiyoha']);
    check('where its people stand: one line each for those the world has a standing of, in the scene\'s order', same(lines, [{ name: 'Lysandra', now: 'In Hask, out of ink; testing Jordan no longer' }, { name: 'Kiyoha', now: 'At the Fourth Landing, shoulder cut; sworn to see Jordan down the stair' }]));
    check('the open threads, the newest first, as many as asked for', same(threadLines(world, { count: 2 }), ['Lysandra\'s back is still unwritten', 'Who cut the rope on the Third Landing?']) && threadLines(world).length === 3 && same(threadLines(null), []) && same(standingLines(null, ['Kiyoha']), []));
}

console.log(failures ? `\n${failures} failure(s)` : '\nall pass');
process.exit(failures ? 1 : 0);
