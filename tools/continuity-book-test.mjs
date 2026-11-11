#!/usr/bin/env node
/**
 * The continuity book (docs/long-shot-plan.md D189), pure: the book's
 * name, an entry's text, what must be written for the book to say what
 * the continuity says, what was written remembered, and what the book
 * says that the continuity does not (a text changed by hand taken as how
 * things stand, an entry deleted let go), with a text the player wrote
 * never written over until the story has moved that person on.
 *
 * Usage:  node tools/continuity-book-test.mjs     (from the repo root)
 * Exit:   0 = pass, 1 = failure
 */
import { applyContinuity, normalizeContinuity, standingLines, threadLines } from '../src/utils/continuity.js';
import { BOOK_SUFFIX, BOOK_ORDER, THREADS_TITLE, continuityBookName, hashText, personTitle, personContent, threadsContent, standingFrom, threadsFrom, readBook, planBook, trackWritten, forgetBook, renameBook } from '../src/utils/continuityBook.js';

let failures = 0;
function check(name, cond, detail = '') {
    if (cond) console.log(`pass  ${name}`);
    else { failures++; console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ''}`); }
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** A lorebook as SillyTavern keeps it, with the writing of a plan done to it as the feature does. */
function makeBook() {
    const data = { entries: {} };
    let next = 0;
    return {
        data,
        write(cont, name = 'FD - Scenes Continuity') {
            const plan = planBook(cont, data);
            const written = [];
            for (const op of plan.ops) {
                if (op.op === 'create') { const uid = next++; data.entries[uid] = { uid, disable: false, selective: false, ...JSON.parse(JSON.stringify(op.fields)) }; written.push({ who: op.who, uid, content: op.fields.content }); }
                else { data.entries[op.uid].content = op.content; written.push({ who: op.who, uid: op.uid, content: op.content }); }
            }
            return { plan, cont: trackWritten(cont, name, written) };
        },
        find: (title) => Object.values(data.entries).find(e => e.comment === title),
    };
}

console.log('\n§1 the book\'s name and an entry\'s text');
{
    check('named after the campaign, safe as a file\'s name', continuityBookName('FD') === `FD${BOOK_SUFFIX}` && continuityBookName('First Descent') === 'First Descent - Scenes Continuity' && continuityBookName('A/B: "C"?') === 'A B C - Scenes Continuity' && continuityBookName('') === 'World - Scenes Continuity');
    check('a text\'s mark: the same for the same text, another for another', hashText('abc') === hashText('abc') && hashText('abc') !== hashText('abd') && /^[0-9a-f]{8}$/.test(hashText('')));
    check('a person\'s entry: titled by their name, its text opening on their name', personTitle('Kiyoha') === 'Kiyoha: as things stand now' && personContent({ name: 'Kiyoha', now: 'At the stair foot, asleep on her axe.' }) === 'Kiyoha, as the story stands now: At the stair foot, asleep on her axe.');
    check('where a person stands, read back from their entry: DES\'s own opening words aside; a text rewritten whole is taken whole', standingFrom('Kiyoha, as the story stands now: At the stair foot.', 'Kiyoha') === 'At the stair foot.' && standingFrom('KIYOHA, AS THE STORY STANDS NOW:   on the road ', 'Kiyoha') === 'on the road' && standingFrom('RUN 4: she is on the road with Jordan.', 'Kiyoha') === 'RUN 4: she is on the road with Jordan.' && standingFrom('', 'Kiyoha') === '');
    check('the threads\' entry: a heading and a line a thread; with none, it says so', threadsContent([{ text: 'Who cut the rope?' }, 'The debt is due.']) === 'Still open in the story:\n- Who cut the rope?\n- The debt is due.' && /Nothing is left open/.test(threadsContent([])));
    check('the threads read back from it: a line a thread, the heading and the bullets aside, none twice', same(threadsFrom('Still open in the story:\n- Who cut the rope?\n* The debt is due.\n\n3. The key\n- who cut the rope\nx'), ['Who cut the rope?', 'The debt is due.', 'The key']) && same(threadsFrom(threadsContent([])), []) && same(threadsFrom(''), []));
}

const base = applyContinuity(null, { people: [{ name: 'Kiyoha', now: 'At the Fourth Landing, shoulder cut.' }, { name: 'Lysandra', now: 'In Hask, out of ink.' }], opened: ['The debt to the Counting Room.', 'Who cut the rope?'] }, { scene: 's1', at: 1 });

console.log('\n§2 the book written from the continuity');
{
    const book = makeBook();
    const plan = planBook(base, null);
    check('a book not made yet: an entry for each person and one for the threads', plan.ops.length === 3 && plan.ops.every(o => o.op === 'create') && plan.people === 2 && plan.threads === true);
    const kiyoha = plan.ops.find(o => o.who === 'Kiyoha').fields;
    check('a person\'s entry is keyed by their name and comes up when the name does: not always on, read after who they are', same(kiyoha.key, ['Kiyoha']) && kiyoha.constant === false && kiyoha.order === BOOK_ORDER.person && kiyoha.position === 0 && kiyoha.comment === 'Kiyoha: as things stand now' && kiyoha.content === 'Kiyoha, as the story stands now: At the Fourth Landing, shoulder cut.');
    const th = plan.ops.find(o => o.who === '#threads').fields;
    check('the threads\' entry is always on, with no keys', th.constant === true && same(th.key, []) && th.comment === THREADS_TITLE && th.order === BOOK_ORDER.threads && th.content.startsWith('Still open in the story:\n- The debt to the Counting Room.'));
    const w = book.write(base);
    check('what was written is remembered: the book\'s name, each entry\'s id and the mark of its text', w.cont.book.name === 'FD - Scenes Continuity' && w.cont.book.people.kiyoha.uid === 0 && w.cont.book.people.kiyoha.hash === hashText(book.data.entries[0].content) && w.cont.book.threads.uid === 2 && same(normalizeContinuity(JSON.parse(JSON.stringify(w.cont))), w.cont));
    check('written once, there is nothing more to write', planBook(w.cont, book.data).ops.length === 0);
    check('the continuity itself is as it was', same(w.cont.people, base.people) && same(w.cont.threads, base.threads));
    // The story moves on: one person, one thread.
    const moved = applyContinuity(w.cont, { people: [{ name: 'Kiyoha', now: 'At the stair foot, asleep on her axe.' }, { name: 'Dagger', now: 'Joined the company.' }], opened: ['Dagger has not said why he came.'], closed: ['t1'] }, { scene: 's2', at: 2 });
    const p2 = planBook(moved, book.data);
    check('the story moved on: only what changed is written (her text, a new entry for the newcomer, the threads); who did not change is not touched', same(p2.ops.map(o => `${o.op}:${o.who}`), ['update:Kiyoha', 'create:Dagger', 'update:#threads']) && p2.ops[0].uid === 0);
    const w2 = book.write(moved);
    check('an update changes the entry\'s text and nothing else of it', book.data.entries[0].content === 'Kiyoha, as the story stands now: At the stair foot, asleep on her axe.' && same(book.data.entries[0].key, ['Kiyoha']) && book.data.entries[2].content === 'Still open in the story:\n- Who cut the rope?\n- Dagger has not said why he came.' && planBook(w2.cont, book.data).ops.length === 0);
    check('a world with no continuity writes no book', planBook(null, null).ops.length === 0);
    check('with no thread open the entry says so rather than going; none is made for a world that never had one', (() => { const none = applyContinuity(w2.cont, { closed: ['t2', 't3'] }); const p = planBook(none, book.data); return p.ops.length === 1 && /Nothing is left open/.test(p.ops[0].content) && planBook(applyContinuity(null, { people: [{ name: 'A', now: 'x' }] }), null).ops.length === 1; })());
}

console.log('\n§3 the book changed by hand');
{
    const book = makeBook();
    let cont = book.write(base).cont;
    check('a book nobody touched changes nothing', readBook(cont, book.data).changed === false && same(readBook(cont, book.data).cont, cont));
    check('with no book, or one that cannot be read, nothing is changed', readBook(base, book.data).changed === false && readBook(cont, null).changed === false && readBook(cont, { nonsense: true }).changed === false);
    // The player rewords Kiyoha's entry, keeping DES's opening words; and rewrites Lysandra's whole.
    book.find('Kiyoha: as things stand now').content = 'Kiyoha, as the story stands now: At the Fourth Landing, shoulder cut. She is Jordan\'s lover now and says so in front of the company.';
    book.find('Lysandra: as things stand now').content = 'RUN 3: the tests are over. Her own back is still the one place unwritten.';
    const r = readBook(cont, book.data);
    check('a text changed by hand is taken as how things stand, marked as the player\'s', r.changed && same(r.adopted.people, ['Kiyoha', 'Lysandra']) && r.cont.people[0].now.endsWith('says so in front of the company.') && r.cont.people[0].by === 'you' && r.cont.people[1].now === 'RUN 3: the tests are over. Her own back is still the one place unwritten.' && r.cont.people[1].by === 'you');
    check('and that is what a scene is then told', standingLines(r.cont, ['Lysandra'])[0].now.startsWith('RUN 3: the tests are over'));
    check('DES does not write over it: nothing to write, though its own wording of the entry would differ', planBook(r.cont, book.data).ops.length === 0);
    check('seen once, it is not taken again', readBook(r.cont, book.data).changed === false);
    cont = r.cont;
    // A long hand-written standing is kept whole.
    book.find('Kiyoha: as things stand now').content = `Kiyoha, as the story stands now: ${'She has much to say. '.repeat(30)}`;
    const long = readBook(cont, book.data);
    check('a long text of the player\'s is kept, not cut to a record\'s length', long.cont.people[0].now.length > 500);
    cont = long.cont;
    // An End nobody was shown leaves it; an End that was seen replaces it.
    const change = { people: [{ name: 'Kiyoha', now: 'On the road, axe shouldered.' }, { name: 'Lysandra', now: 'In Hask with new ink.' }] };
    const unseen = applyContinuity(cont, change, { scene: 's5', at: 5, keepEdited: true });
    check('an End nobody was shown leaves a standing the player wrote as they wrote it, and says who', unseen.people.every(p => p.by === 'you') && same(unseen.kept, ['Kiyoha', 'Lysandra']) && planBook(unseen, book.data).ops.length === 0);
    const seen = applyContinuity(cont, change, { scene: 's5', at: 5 });
    check('an End the player saw takes its place, and the entry is DES\'s to write again', seen.people[0].now === 'On the road, axe shouldered.' && !seen.people[0].by && seen.kept === undefined && same(planBook(seen, book.data).ops.map(o => `${o.op}:${o.who}`), ['update:Kiyoha', 'update:Lysandra']));
    const after = book.write(seen);
    check('written, the entries say how things stand now', book.find('Kiyoha: as things stand now').content === 'Kiyoha, as the story stands now: On the road, axe shouldered.' && readBook(after.cont, book.data).changed === false);
    cont = after.cont;
    // Other fields are the player's: keys added, the entry switched off.
    book.find('Kiyoha: as things stand now').key.push('oni', 'the axe');
    book.find('Kiyoha: as things stand now').disable = true;
    const moved = applyContinuity(cont, { people: [{ name: 'Kiyoha', now: 'At the gate.' }] }, { scene: 's6', at: 6 });
    book.write(moved);
    check('keys the player added and an entry they switched off stay as they left them when its text is written', same(book.find('Kiyoha: as things stand now').key, ['Kiyoha', 'oni', 'the axe']) && book.find('Kiyoha: as things stand now').disable === true && book.find('Kiyoha: as things stand now').content.endsWith('At the gate.') && readBook(cont, book.data).changed === true);
}

console.log('\n§4 an entry deleted, emptied, or added by hand');
{
    const book = makeBook();
    let cont = book.write(base).cont;
    const lys = book.find('Lysandra: as things stand now').uid;
    delete book.data.entries[lys];
    const r = readBook(cont, book.data);
    check('a person\'s entry deleted in the book: their standing is let go, and no entry is made for them again', r.changed && same(r.adopted.removed, ['Lysandra']) && !r.cont.people.some(p => p.name === 'Lysandra') && !('lysandra' in r.cont.book.people) && planBook(r.cont, book.data).ops.length === 0);
    cont = r.cont;
    book.find('Kiyoha: as things stand now').content = '   ';
    const emptied = readBook(cont, book.data);
    check('an entry emptied is the same: let go, the entry left as it is', same(emptied.adopted.removed, ['Kiyoha']) && emptied.cont.people.length === 0 && planBook(emptied.cont, book.data).ops.length === 0 && book.find('Kiyoha: as things stand now').content === '   ');
    // The story speaks of her again: a new entry is made (the old one is the player's now).
    const again = applyContinuity(emptied.cont, { people: [{ name: 'Kiyoha', now: 'Back at the gate.' }] }, { scene: 's3', at: 3 });
    check('when the story speaks of them again an entry is made for them', same(planBook(again, book.data).ops.map(o => `${o.op}:${o.who}`), ['create:Kiyoha']));
    // An entry of the player's own in the book is never touched.
    book.data.entries[77] = { uid: 77, comment: 'Solveig\'s stair rule', key: ['stair'], content: 'Nobody goes down alone.', constant: true };
    const mine = book.write(again);
    check('an entry the player added to the book is not DES\'s: never read as a standing, never written', same(book.data.entries[77], { uid: 77, comment: 'Solveig\'s stair rule', key: ['stair'], content: 'Nobody goes down alone.', constant: true }) && readBook(mine.cont, book.data).changed === false);
}

console.log('\n§5 the threads\' entry changed by hand');
{
    const book = makeBook();
    let cont = book.write(base).cont;
    const e = book.find(THREADS_TITLE);
    e.content = 'Still open in the story:\n- Who cut the rope?\n- Solveig\'s stair rule has not been tested.\n(the debt was paid in run 2)';
    const r = readBook(cont, book.data);
    check('a line deleted settles that thread, a line added opens one, a line kept is the same thread', r.changed && r.adopted.threads && same(r.cont.threads.map(t => [t.id, t.text]), [['t2', 'Who cut the rope?'], ['t3', 'Solveig\'s stair rule has not been tested.'], ['t4', '(the debt was paid in run 2)']]) && same(threadLines(r.cont, { count: 1 }), ['(the debt was paid in run 2)']));
    check('the entry is left as the player wrote it', planBook(r.cont, book.data).ops.length === 0 && r.cont.book.threads.by === 'you');
    // The story then opens a thread: the list changed, so the entry is written again, in DES's own form.
    const moved = applyContinuity(r.cont, { opened: ['The road is watched.'] }, { scene: 's2', at: 2 });
    const p = planBook(moved, book.data);
    check('once the story opens or settles a thread the entry is DES\'s to write again, every thread of the player\'s kept in it', p.ops.length === 1 && p.ops[0].op === 'update' && p.ops[0].content.includes('- Solveig\'s stair rule has not been tested.') && p.ops[0].content.endsWith('- The road is watched.') && !moved.book.threads.by);
    cont = book.write(moved).cont;
    delete book.data.entries[e.uid];
    const gone = readBook(cont, book.data);
    check('the threads\' entry deleted: the threads stay, and the entry is made again when they are next written', gone.changed && gone.cont.threads.length === 4 && gone.cont.book.threads === null && same(planBook(gone.cont, book.data).ops.map(o => `${o.op}:${o.who}`), ['create:#threads']));
}

console.log('\n§6 the book renamed or gone');
{
    const book = makeBook();
    const cont = book.write(base).cont;
    check('renamed in the Lore Library, DES follows the name', renameBook(cont, 'FD - Where things stand').book.name === 'FD - Where things stand' && renameBook(base, 'x').book === null && renameBook(cont, '').book.name === 'FD - Scenes Continuity');
    const forgot = forgetBook(cont);
    check('the book deleted: the standings and the threads stay, and a new book is written whole', forgot.book === null && same(forgot.people, cont.people) && planBook(forgot, null).ops.length === 3);
}

console.log(failures ? `\n${failures} failure(s)` : '\nall pass');
process.exit(failures ? 1 : 0);
