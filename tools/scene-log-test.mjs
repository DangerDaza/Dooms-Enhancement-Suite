#!/usr/bin/env node
/**
 * The log of what a scene's End changed in its world (docs/long-shot-plan.md
 * D206), and a scene's changes taken back as far as they still stand.
 *
 * Usage:  node tools/scene-log-test.mjs     (from the repo root)
 * Exit:   0 = pass, 1 = failure
 */
import { stable, markOf, diffEntry, undoChanges, areaOf, areasInWords } from '../src/utils/sceneLog.js';

let failures = 0;
const check = (label, cond, extra = '') => {
    if (cond) console.log(`pass  ${label}`);
    else { console.error(`FAIL  ${label}${extra ? '\n      ' + extra : ''}`); failures++; }
};
const same = (a, b) => stable(a) === stable(b);
const clone = (v) => JSON.parse(JSON.stringify(v));

/** A world's entry as an End finds it. */
const world = () => ({
    card: 'Narrator.png', seq: 2,
    scenes: [{ id: 's0', status: 'ended' }, { id: 's1', status: 'ended' }, { id: 's2', status: 'open' }],
    memory: {
        scene: 's1', takenAt: 100, facts: { date: 'Day 4', time: 'dusk', location: 'Hask', weather: 'fog' },
        stores: {
            dooms_tracker: { infoBox: '{"date":"Day 4"}', quests: { main: 'Find the ring', optional: ['Pay Bram'] } },
            dooms_canon: { entries: [{ id: 'c1', kind: 'person', name: 'Old Marit', text: 'Keeps the Anchor.' }, { id: 'c2', kind: 'thing', name: 'The ring', text: 'Lost.' }], sinceLast: 3 },
            dooms_world: { where: { Kiyoha: 'hask', Lysandra: 'walk' }, clocks: { thaw: 2 }, visited: [{ id: 'hask', label: 'Hask', visits: [1] }] },
            dooms_inventory: { items: [{ id: 'i1', name: 'Bronze key', qty: 1 }] },
            dooms_atlas: { spots: { 'pin:hask': { x: 1, y: 1 } }, made: [{ id: 'pin:hask', label: 'Hask' }] },
        },
    },
    continuity: {
        people: [{ name: 'Kiyoha', now: 'In Hask, tired.', scene: 's1' }, { name: 'Lysandra', now: 'At the Walk.', scene: 's0' }],
        threads: [{ id: 't1', text: 'The inkstone is not assayed.', open: true }],
        book: { name: 'World - Continuity', people: { kiyoha: { uid: 3, hash: 'a' } }, threads: { uid: 9, hash: 't' } },
    },
});
/** What scene 2's End does to it. */
const endOf2 = (e) => {
    const n = clone(e);
    n.scenes[2].status = 'ended';
    n.memory.scene = 's2'; n.memory.takenAt = 200;
    n.memory.facts = { date: 'Day 5', time: 'morning', location: 'The kitchen', weather: 'fog' };
    n.memory.stores.dooms_tracker.infoBox = '{"date":"Day 5"}';
    n.memory.stores.dooms_tracker.quests.optional.push('Mend the spindle');
    n.memory.stores.dooms_canon.entries[1].text = 'Found in the well.';
    n.memory.stores.dooms_canon.entries.push({ id: 'c3', kind: 'person', name: 'Solveig', text: 'A joiner; mends the bed spindle.' });
    n.memory.stores.dooms_canon.sinceLast = 0;
    n.memory.stores.dooms_world.where.Kiyoha = 'kitchen';
    n.memory.stores.dooms_world.where.Solveig = 'kitchen';
    n.memory.stores.dooms_world.clocks.thaw = 3;
    n.memory.stores.dooms_inventory.items[0].qty = 2;
    n.memory.stores.dooms_inventory.items.push({ id: 'i2', name: "Fenn's lamp", qty: 1 });
    n.continuity.people[0] = { name: 'Kiyoha', now: 'In the kitchen, rested.', scene: 's2' };
    n.continuity.people.push({ name: 'Solveig', now: 'Joined the company.', scene: 's2' });
    n.continuity.threads[0].open = false;
    n.continuity.threads.push({ id: 't2', text: 'Solveig promised to mend the bed spindle.', open: true });
    n.continuity.book.people.solveig = { uid: 12, hash: 's' };
    n.continuity.book.people.kiyoha = { uid: 3, hash: 'a2' };
    n.style = { bans: [{ phrase: 'slight knowing smile' }] };
    return n;
};

console.log('\n§1 marks');
check('two equal values have one mark whatever the order of their keys; a different value another', markOf({ a: 1, b: [1, 2] }) === markOf({ b: [1, 2], a: 1 }) && markOf({ a: 1 }) !== markOf({ a: 2 }) && markOf('x') !== markOf(['x']));
check('nothing there, and a key with no value, read as nothing', markOf(undefined) === '0:' + (0x811c9dc5 >>> 0).toString(36) && stable({ a: undefined, b: 1 }) === stable({ b: 1 }) && markOf(null) !== markOf(undefined));

console.log('\n§2 what an End changed');
const before = world();
const after = endOf2(before);
const log = diffEntry(before, after);
const at = (pred) => log.filter(pred);
check('the scenes\' own records and their count are not in it', !log.some(c => c.p[0] === 'scenes' || c.p[0] === 'seq'));
check('a value replaced is "this was X", with a mark of what the scene put', (() => { const c = at(c => stable(c.p) === stable(['memory', 'facts', 'date']))[0]; return c && c.op === 'set' && c.b === 'Day 4' && c.h === markOf('Day 5') && !('a' in c); })(), JSON.stringify(at(c => c.p[1] === 'facts')));
check('what did not change is not in it', !log.some(c => stable(c.p) === stable(['memory', 'facts', 'weather'])) && !log.some(c => c.p.includes('dooms_atlas')) && !log.some(c => stable(c.p) === stable(['card'])));
check('an item added to a list is known by its name, not its place', (() => { const c = at(c => c.op === 'add' && c.key === 'c3')[0]; return c && stable(c.p) === stable(['memory', 'stores', 'dooms_canon', 'entries']) && c.f === 'id' && c.h === markOf(after.memory.stores.dooms_canon.entries[2]); })());
check('a change inside an item is that field of that item', (() => { const c = at(c => c.op === 'set' && c.b === 'Lost.')[0]; return c && stable(c.p) === stable(['memory', 'stores', 'dooms_canon', 'entries', { f: 'id', key: 'c2' }, 'text']); })());
check('people are told apart by their names', at(c => c.op === 'add' && c.f === 'name' && c.key === 'Solveig').length === 1 && at(c => c.op === 'set' && c.b === 'In Hask, tired.').length === 1);
check('a key put where there was none says so', (() => { const c = at(c => stable(c.p) === stable(['memory', 'stores', 'dooms_world', 'where', 'Solveig']))[0]; return c && c.n === 1 && !('b' in c); })());
check('a list of plain values is one value', (() => { const c = at(c => stable(c.p) === stable(['memory', 'stores', 'dooms_tracker', 'quests', 'optional']))[0]; return c && c.op === 'set' && same(c.b, ['Pay Bram']); })());
check('an object made where there was none is marked as made', at(c => c.op === 'make' && stable(c.p) === stable(['style'])).length === 1);
{
    // A world with a big map the scene never touched: the log is no bigger for it.
    const big = world();
    for (let i = 0; i < 400; i++) { big.memory.stores.dooms_atlas.spots[`pin:${i}`] = { x: i, y: i * 2 }; big.memory.stores.dooms_atlas.made.push({ id: `pin:${i}`, label: `Place number ${i} of the generated world` }); }
    const bigLog = diffEntry(big, endOf2(big));
    check('the log is as big as what changed, not as big as the world', JSON.stringify(bigLog).length === JSON.stringify(log).length && JSON.stringify(bigLog).length * 5 < JSON.stringify(big).length, JSON.stringify([JSON.stringify(bigLog).length, JSON.stringify(big).length]));
}
check('it goes through JSON and back unchanged in what it does', same(undoChanges(after, [JSON.parse(JSON.stringify(log))]).entry, undoChanges(after, [log]).entry));

console.log('\n§3 taken back from the end of the story');
{
    const r = undoChanges(after, [log]);
    const want = clone(before); want.scenes = after.scenes; want.seq = after.seq;
    check('the newest scene taken back: the world is as it was before its End, in everything but the list of scenes', same(r.entry, want), JSON.stringify(diffEntry(want, r.entry, { skip: [] })).slice(0, 400));
    check('everything it changed is counted as taken back, nothing kept', r.kept === 0 && r.undone === log.filter(c => c.op !== 'make').length && r.undone > 10);
    check('the entry handed in is not touched', same(after, endOf2(world())));
    check('an object the scene made goes again once it is empty', !('style' in r.entry));
    check('it says where the changes were, in words', same(areasInWords(r.areas), ['the date and the place', 'the tracker', 'where people stand', 'the open threads', 'the ledger', 'the inventory', 'the world\'s clocks and who is where', 'the phrases held back']), JSON.stringify(areasInWords(r.areas)));
}

console.log('\n§4 taken back from the middle: what a later scene changed again stays');
{
    // Scene 3 ends after scene 2: the date moves on, Kiyoha moves again, the ring's line is rewritten, the lamp is used up, the thaw ticks.
    const later = clone(after);
    later.memory.scene = 's3'; later.memory.takenAt = 300;
    later.memory.facts.date = 'Day 9';
    later.memory.stores.dooms_world.where.Kiyoha = 'walk';
    later.memory.stores.dooms_world.clocks.thaw = 4;
    later.memory.stores.dooms_canon.entries[1].text = 'Given to Bram.';
    later.memory.stores.dooms_inventory.items = later.memory.stores.dooms_inventory.items.filter(x => x.id !== 'i2');
    later.continuity.people[0] = { name: 'Kiyoha', now: 'At the Walk again.', scene: 's3' };
    later.continuity.threads.push({ id: 't3', text: 'Bram wants the ring valued.', open: true });
    const r = undoChanges(later, [log]);
    const e = r.entry;
    check('what a later scene set again is left as that scene left it: the date, where Kiyoha is, the thaw, the ring\'s line, Kiyoha\'s standing', e.memory.facts.date === 'Day 9' && e.memory.scene === 's3' && e.memory.stores.dooms_world.where.Kiyoha === 'walk' && e.memory.stores.dooms_world.clocks.thaw === 4 && e.memory.stores.dooms_canon.entries.find(x => x.id === 'c2').text === 'Given to Bram.' && e.continuity.people.find(p => p.name === 'Kiyoha').now === 'At the Walk again.');
    check('what still stands as the deleted scene left it is taken back: Solveig\'s line, where she is, her standing, the thread she opened, the key\'s count, the time of day, the thread it settled', !e.memory.stores.dooms_canon.entries.some(x => x.id === 'c3') && !('Solveig' in e.memory.stores.dooms_world.where) && !e.continuity.people.some(p => p.name === 'Solveig') && !e.continuity.threads.some(t => t.id === 't2') && e.memory.stores.dooms_inventory.items.find(x => x.id === 'i1').qty === 1 && e.memory.facts.time === 'dusk' && e.continuity.threads.find(t => t.id === 't1').open === true);
    check('what the later scene added is untouched', e.continuity.threads.some(t => t.id === 't3'));
    check('an item the scene added that is gone already is not counted as taken back; the answer says how much stays', r.kept >= 6 && r.undone >= 8 && r.areas.ledger.kept === 1 && r.areas.ledger.undone >= 1 && r.areas.inventory.kept === 1, JSON.stringify(r.areas));
}

console.log('\n§5 the player\'s own hand since');
{
    const edited = clone(after);
    edited.continuity.people.find(p => p.name === 'Solveig').now = 'Joined the company; owes Morzan a spindle.';    // corrected in the book
    edited.memory.stores.dooms_atlas.spots['pin:well'] = { x: 3, y: 2 };    // the map edited between scenes
    const r = undoChanges(edited, [log]);
    check('a person the player has since corrected is theirs: she stays as they wrote her', r.entry.continuity.people.find(p => p.name === 'Solveig').now.endsWith('owes Morzan a spindle.'));
    check('what was changed since in something the scene never touched is kept', !!r.entry.memory.stores.dooms_atlas.spots['pin:well']);
}

console.log('\n§6 lists, and a scene ended twice');
{
    const b = { memory: { stores: { dooms_hooks: { proposed: [{ id: 'h1', text: 'A' }, { id: 'h2', text: 'B' }, { id: 'h3', text: 'C' }] } } } };
    const a = clone(b);
    a.memory.stores.dooms_hooks.proposed.splice(1, 1);    // the hook the scene was started from is taken
    const l = diffEntry(b, a);
    check('an item taken out of a list is kept whole, with its place', l.length === 1 && l[0].op === 'del' && l[0].key === 'h2' && l[0].i === 1 && same(l[0].b, { id: 'h2', text: 'B' }));
    check('taken back, it is in its place again', same(undoChanges(a, [l]).entry, b));
    const again = clone(a); again.memory.stores.dooms_hooks.proposed.push({ id: 'h2', text: 'B, offered again' });
    check('where something of that name is there again, it is left alone', undoChanges(again, [l]).entry.memory.stores.dooms_hooks.proposed.length === 3 && undoChanges(again, [l]).kept === 1);
    // Ended, reopened, ended again: two lists, taken back newest first.
    const s1 = { memory: { facts: { date: 'Day 1' }, stores: {} } };
    const s2 = { memory: { facts: { date: 'Day 2' }, stores: {} } };
    const s3 = { memory: { facts: { date: 'Day 3' }, stores: {} } };
    const twice = undoChanges(s3, [diffEntry(s1, s2), diffEntry(s2, s3)]);
    check('a scene ended twice is taken back to before its first End', twice.entry.memory.facts.date === 'Day 1' && twice.undone === 2);
    check('lists whose items have no name of their own are one value', (() => { const l2 = diffEntry({ x: { log: [{ t: 1 }, { t: 2 }] } }, { x: { log: [{ t: 1 }, { t: 2 }, { t: 3 }] } }); return l2.length === 1 && l2[0].op === 'set' && l2[0].b.length === 2; })());
    check('a world with no memory before its first End: the memory is taken away again when nothing else has touched it', (() => { const none = { memory: null, continuity: { people: [], threads: [] } }; const first = { memory: { scene: 's1', facts: { date: 'Day 1' }, stores: { dooms_world: { clocks: { thaw: 1 } } } }, continuity: { people: [], threads: [] } }; return same(undoChanges(first, [diffEntry(none, first)]).entry, none); })());
    {
        // The first End of a world: its lists did not exist. A later scene adds to one; the first scene's own item still goes by itself.
        const none = { memory: null, continuity: { people: [], threads: [] } };
        const first = { memory: { scene: 's1', stores: { dooms_canon: { entries: [{ id: 'c1', name: 'The mill', text: 'x' }] } } }, continuity: { people: [], threads: [] } };
        const firstLog = diffEntry(none, first);
        const later = JSON.parse(JSON.stringify(first));
        later.memory.scene = 's2';
        later.memory.stores.dooms_canon.entries.push({ id: 'c2', name: 'The inn', text: 'y' });
        const r = undoChanges(later, [firstLog]);
        check('a list made by a world\'s first End is taken back item by item: its own line goes, a later scene\'s stays', firstLog.some(c => c.op === 'add' && c.key === 'c1') && same(r.entry.memory.stores.dooms_canon.entries.map(x => x.id), ['c2']) && r.entry.memory.scene === 's2');
        check('and with nothing added since, the list and all that held it go again', same(undoChanges(first, [firstLog]).entry, none));
    }
    check('a broken or empty log changes nothing', same(undoChanges(a, null).entry, a) && same(undoChanges(a, [[{ op: 'set' }, null, { p: [] }]]).entry, a) && undoChanges(a, [[{ p: ['nowhere', 'deep', 'x'], op: 'set', h: markOf(1), b: 0 }]]).kept === 1);
}

console.log('\n§7 where a change is, in words');
check('each path is named for what the player knows it as', areaOf(['memory', 'stores', 'dooms_canon', 'entries']) === 'ledger' && areaOf(['continuity', 'people', { f: 'name', key: 'X' }, 'now']) === 'people' && areaOf(['continuity', 'threads']) === 'threads' && areaOf(['continuity', 'book', 'people', 'x']) === 'book' && areaOf(['memory', 'facts', 'date']) === 'when' && areaOf(['memory', 'takenAt']) === 'when' && areaOf(['memory', 'stores', 'dooms_atlas', 'spots']) === 'map' && areaOf(['style', 'bans']) === 'style' && areaOf(['card']) === 'other');
check('the bookkeeping is not said to the player', same(areasInWords({ book: { undone: 3, kept: 0 }, other: { undone: 1, kept: 0 }, ledger: { undone: 0, kept: 2 } }), ['the ledger']) && same(areasInWords({}), []) && same(areasInWords(null), []));

console.log(failures === 0 ? '\nAll scene log checks pass' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
