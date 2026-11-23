#!/usr/bin/env node
/**
 * A world's news between its stories (src/utils/worldNews.js, D235):
 * what a scene sends out, the dates read for their order, what another
 * story's scene takes in, the clocks caught up and the ledger written.
 *
 * Usage:  node tools/world-news-test.mjs     (from the repo root)
 * Exit:   0 = pass, 1 = failure
 */
import { strict as assert } from 'node:assert';
import {
    NEWS, emptyNews, normalizeNews, newsShared, setNewsShare, cleanEvents, readWorldEvents, mergeEvents, worldAsk, clockChanges, postNews, withdrawNews, removeNewsItem,
    storyDay, dayMinutes, compareWhen, newsDue, stillDue, markTaken, newsLine, newsBriefLine, applyNewsClocks, newsToCanon, takeNews, newsList, restoreNews, clockNewsLines,
} from '../src/utils/worldNews.js';
import { normalizePack, seedWorldState, recentChanges } from '../src/utils/liveWorld.js';
import { emptyCanon, addCanonEntry, buildCanonBlock } from '../src/utils/canon.js';

let failures = 0;
let passes = 0;
function test(name, fn) {
    try { fn(); passes++; } catch (e) { failures++; console.error(`FAIL: ${name}\n  ${e?.message || e}`); }
}

const W = 'night-city';
const W2 = 'night-city~2';
const pack = normalizePack({
    id: W, name: 'Night City',
    places: [{ id: 'red-lantern', label: 'The Red Lantern' }],
    clocks: [
        { id: 'gang_war', label: 'The gang war', start: 1, max: 6, effects: { 2: 'Shots are heard at night.', 3: 'The streets empty after dark.', 4: 'Checkpoints go up.' } },
        { id: 'heat', label: 'Heat', start: 3, max: 5, effects: { 1: 'The badges have lost interest.', 2: 'Patrols thin out.' } },
        { id: 'the_plot', label: 'The plot', start: 0, max: 4, hidden: true, effects: { 2: 'Someone is watching.' } },
    ],
    cast: [],
}).pack;

// ─── The store and the switch ───────────────────────────────────────────

test('a world with one story shares nothing; with two it shares unless switched off', () => {
    assert.equal(newsShared(emptyNews(), 1), false);
    assert.equal(newsShared(emptyNews(), 2), NEWS.onByDefault);
    assert.equal(newsShared(setNewsShare(null, false), 3), false);
    assert.equal(newsShared(setNewsShare(null, true), 2), true);
    assert.equal(newsShared(setNewsShare(null, true), 1), false);
    assert.equal(newsShared(undefined, 2), NEWS.onByDefault);
});

test('a stored news is made safe: bad items go, each id once, the switch kept', () => {
    const n = normalizeNews({ share: 'off', seq: 1, items: [
        { id: 'n1', kind: 'event', text: 'The Red Lantern burned.', story: W, scene: 's2', at: 5, date: 'Day 3', taken: { [W2]: 's1', '': 'x' } },
        { id: 'n1', kind: 'event', text: 'A twin.', story: W },
        { id: 'n7', kind: 'clock', clock: 'gang_war', from: 1, to: 2, story: W, scene: 's2' },
        { id: 'n8', kind: 'clock', clock: 'gang_war', from: 2, to: 2, story: W },
        { id: 'n9', kind: 'event', text: '', story: W },
        { id: '', kind: 'event', text: 'No id.', story: W },
        { id: 'n10', kind: 'event', text: 'No story.' },
        'nonsense',
    ] });
    assert.equal(n.share, 'off');
    assert.deepEqual(n.items.map(i => i.id), ['n1', 'n7']);
    assert.deepEqual(n.items[0].taken, { [W2]: 's1' });
    assert.equal(n.seq, 7, 'the count goes on from the highest id kept');
    assert.deepEqual(normalizeNews(n), n, 'made safe twice is the same');
    assert.deepEqual(normalizeNews('x'), emptyNews());
});

test('a world keeps so many items, the oldest going first', () => {
    let n = emptyNews();
    for (let i = 0; i < NEWS.keep + 30; i++) n = postNews(n, { story: W, scene: `s${i}`, at: i, events: [`Event number ${i} happened.`] }).news;
    assert.equal(n.items.length, NEWS.keep);
    assert.equal(n.items[0].text, 'Event number 30 happened.');
});

// ─── What a scene sends out ─────────────────────────────────────────────

test('events are read from the shapes a model answers in, each once, cut at a word', () => {
    const long = `${'The warehouse on Pier Nine burned to the waterline while half the district watched from the quay and nobody lifted a hand to help '.repeat(2)}at all.`;
    const ev = cleanEvents([
        'Mara Quill was shot outside the Red Lantern.',
        { about: 'The Red Lantern', what: 'The Red Lantern was closed by the badges.' },
        { who: ['Mara Quill', 'Pike'], text: 'mara quill was shot outside the red lantern.' },
        { name: 'Pier Nine', event: long },
        { about: 'nothing' }, 12, null, '',
    ]);
    assert.equal(ev.length, 3);
    assert.deepEqual(ev[0], { about: '', text: 'Mara Quill was shot outside the Red Lantern.' });
    assert.deepEqual(ev[1], { about: 'The Red Lantern', text: 'The Red Lantern was closed by the badges.' });
    assert.equal(ev[2].about, 'Pier Nine');
    assert.ok(ev[2].text.length <= NEWS.textChars && ev[2].text.endsWith('…') && !/\s…$/.test(ev[2].text), ev[2].text);
});

test('a record\'s reply gives its world events; prose and a reply without them give none', () => {
    assert.deepEqual(readWorldEvents({ recap: 'x', world: [{ about: 'Pike', what: 'Pike was found dead.' }] }), [{ about: 'Pike', text: 'Pike was found dead.' }]);
    assert.deepEqual(readWorldEvents({ recap: 'x' }), []);
    assert.deepEqual(readWorldEvents(null), []);
    assert.equal(readWorldEvents({ world: ['a.', 'b.', 'c.', 'd.', 'e.', 'f.'] }).length, NEWS.perAsk, 'one request lists so many');
});

test('a record written in passes gathers them, the later ones kept where there are too many', () => {
    const a = ['One.', 'Two.', 'Three.', 'Four.'];
    const b = ['two.', 'Five.', 'Six.', 'Seven.'];
    const m = mergeEvents(a, b);
    assert.equal(m.length, NEWS.perEnd);
    assert.deepEqual(m.map(x => x.text), ['Two.', 'Three.', 'Four.', 'Five.', 'Six.', 'Seven.']);
    assert.deepEqual(mergeEvents(null, undefined), []);
});

test('what the record\'s request is told: the shape, the rules with the player\'s name, what was listed before', () => {
    const ask = worldAsk({ player: 'Jack' });
    assert.ok(ask.shape.startsWith('"world": ['));
    assert.ok(ask.rules.includes('Jack is named in it only where people would know it was them'));
    assert.ok(ask.rules.includes('how anyone stands with Jack'));
    assert.ok(ask.rules.includes(`At most ${NEWS.perAsk};`));
    assert.equal(ask.listed, '');
    const later = worldAsk({ player: 'Jack', soFar: [{ about: 'Pike', text: 'Pike was found dead.' }] });
    assert.ok(later.rules.includes('none that is listed already'));
    assert.equal(later.listed, 'Already listed for the world from the earlier part of the scene (not to be listed again):\n- Pike was found dead.');
});

test('a scene\'s clock moves are the difference between the world before its End and after', () => {
    const before = seedWorldState(pack);
    const after = { ...seedWorldState(pack), clocks: { gang_war: 3, heat: 2, the_plot: 0 } };
    assert.deepEqual(clockChanges(before, after, pack), [{ clock: 'gang_war', from: 1, to: 3 }, { clock: 'heat', from: 3, to: 2 }]);
    assert.deepEqual(clockChanges(null, after, pack), [{ clock: 'gang_war', from: 1, to: 3 }, { clock: 'heat', from: 3, to: 2 }], 'no memory before: the pack\'s own start');
    assert.deepEqual(clockChanges(before, before, pack), []);
    assert.deepEqual(clockChanges(before, { clocks: { gang_war: 99 } }, pack), [{ clock: 'gang_war', from: 1, to: 6 }], 'a value outside the pack is read within it');
});

test('an End posts its events and clock moves, stamped with the story, the scene and the date', () => {
    const r = postNews(null, { story: W, scene: 's2', at: 100, date: 'Day 3', time: 'night', events: [{ about: 'Pike', text: 'Pike was found dead.' }, 'The Red Lantern burned.'], clocks: [{ clock: 'gang_war', from: 1, to: 2 }, { clock: 'bad' }, { clock: 'heat', from: 2, to: 2 }] });
    assert.equal(r.posted, 3);
    assert.deepEqual(r.news.items.map(i => [i.id, i.kind, i.story, i.scene, i.date, i.time, i.at]), [['n1', 'event', W, 's2', 'Day 3', 'night', 100], ['n2', 'event', W, 's2', 'Day 3', 'night', 100], ['n3', 'clock', W, 's2', 'Day 3', 'night', 100]]);
    assert.deepEqual(r.news.items[2], { id: 'n3', story: W, scene: 's2', at: 100, date: 'Day 3', time: 'night', taken: {}, kind: 'clock', clock: 'gang_war', from: 1, to: 2 });
    assert.equal(postNews(null, { story: '', events: ['x.'] }).posted, 0);
});

test('a scene ended again replaces what nobody took in, and keeps what a story has', () => {
    let n = postNews(null, { story: W, scene: 's2', at: 1, date: 'Day 3', events: ['Pike was found dead.', 'The Red Lantern burned.'], clocks: [{ clock: 'gang_war', from: 1, to: 2 }] }).news;
    n = markTaken(n, W2, ['n1'], 's4');
    const again = postNews(n, { story: W, scene: 's2', at: 2, date: 'Day 4', events: ['pike was found dead.', 'The Red Lantern was saved.'], clocks: [] });
    assert.deepEqual(again.news.items.map(i => [i.id, i.kind === 'event' ? i.text : i.clock]), [['n1', 'Pike was found dead.'], ['n4', 'The Red Lantern was saved.']]);
    assert.equal(again.posted, 1, 'what a story has taken is not sent a second time');
    assert.deepEqual(again.replaced.map(i => i.id), ['n2', 'n3'], 'what went is handed back, for an Undo');
    // That End undone: what it sent goes, what it replaced is back where it was.
    const undone = restoreNews(withdrawNews(again.news, { story: W, scene: 's2', at: 2 }).news, again.replaced);
    assert.deepEqual(undone.items, n.items);
    assert.deepEqual(restoreNews(undone, again.replaced).items, n.items, 'put back twice is put back once');
    // another scene's and another story's are not touched
    const other = postNews(again.news, { story: W2, scene: 's2', at: 3, events: ['Eli won the pit fight.'] });
    assert.equal(other.news.items.length, 3);
});

test('an End undone or a scene deleted takes back all it sent; one item can be taken out by hand', () => {
    let n = postNews(null, { story: W, scene: 's2', events: ['A.', 'B.'], clocks: [{ clock: 'heat', from: 3, to: 2 }] }).news;
    n = postNews(n, { story: W, scene: 's3', events: ['C.'] }).news;
    n = markTaken(n, W2, ['n1'], 's1');
    const w = withdrawNews(n, { story: W, scene: 's2' });
    assert.equal(w.removed, 3);
    assert.deepEqual(w.news.items.map(i => i.text), ['C.']);
    assert.equal(withdrawNews(n, { story: W2, scene: 's2' }).removed, 0);
    const r = removeNewsItem(n, 'n2');
    assert.equal(r.removed, 1);
    assert.deepEqual(r.news.items.map(i => i.id), ['n1', 'n3', 'n4']);
    assert.equal(removeNewsItem(n, 'n99').removed, 0);
});

// ─── Dates ──────────────────────────────────────────────────────────────

test('dates are read for their order: counts, figures, named months', () => {
    const v = (d) => storyDay(d);
    assert.deepEqual(v('Day 12'), { kind: 'count:', value: 12 });
    assert.equal(v('Morning of day 4').value, 4);
    assert.ok(v('Week 2, Day 3').value > v('Week 1, Day 6').value && v('Week 2, Day 3').kind === 'count:w');
    assert.ok(v('Year 2, Month 1, Day 1').value > v('Year 1, Month 12, Day 30').value);
    const d = v('2077-03-14');
    for (const same of ['Friday, March 14, 2077', '14th of March 2077', 'Tuesday 14 March 2077', '14/03/2077', '3/14/2077', 'Mar 14, 2077', '2077/3/14']) assert.deepEqual(v(same), d, same);
    assert.ok(v('Sept. 9, 2077').value > d.value && v('1 January 2078').value > v('31 December 2077').value);
    assert.equal(v('March 3').kind, 'md');
    for (const none of ['', '2077', 'The 17th of Last Seed, 4E 201', 'Sometime later', 'Marching 4', null, undefined]) assert.equal(v(none), null, String(none));
    const two = v('03/04/2077');
    assert.ok(two && two.alt !== undefined && two.alt !== two.value, 'figures that could be read two ways carry both readings');
});

test('times of day are read from a clock or a word, a span at its end', () => {
    assert.equal(dayMinutes('21:40'), 21 * 60 + 40);
    assert.equal(dayMinutes('20:00 → 21:40'), 21 * 60 + 40);
    assert.equal(dayMinutes('9 PM'), 21 * 60);
    assert.equal(dayMinutes('9:15 am'), 9 * 60 + 15);
    assert.equal(dayMinutes('12 am'), 0);
    assert.ok(dayMinutes('dawn') < dayMinutes('morning') && dayMinutes('morning') < dayMinutes('noon') && dayMinutes('noon') < dayMinutes('afternoon') && dayMinutes('afternoon') < dayMinutes('dusk') && dayMinutes('dusk') < dayMinutes('evening') && dayMinutes('evening') < dayMinutes('night') && dayMinutes('night') < dayMinutes('late night'));
    assert.ok(dayMinutes('early morning') < dayMinutes('morning') && dayMinutes('late evening') > dayMinutes('evening'));
    for (const none of ['', 'whenever', '25:00', null]) assert.equal(dayMinutes(none), null, String(none));
});

test('two moments in order: by the date, then by the time of day; unknown where the dates are not of a kind', () => {
    assert.equal(compareWhen({ date: 'Day 3' }, { date: 'Day 12' }), -1);
    assert.equal(compareWhen({ date: 'Day 12' }, { date: 'Day 3' }), 1);
    assert.equal(compareWhen({ date: 'Day 3', time: 'night' }, { date: 'Day 3', time: 'morning' }), 1);
    assert.equal(compareWhen({ date: 'Day 3', time: 'morning' }, { date: 'Day 3', time: '21:00' }), -1);
    assert.equal(compareWhen({ date: 'Day 3', time: 'morning' }, { date: 'Day 3' }), 0);
    assert.equal(compareWhen({ date: 'Day 3', time: 'night' }, { date: 'Day 4', time: 'dawn' }), -1);
    assert.equal(compareWhen({ date: 'Day 3' }, { date: 'March 3, 2077' }), null);
    assert.equal(compareWhen({ date: 'Day 3' }, { date: 'Week 1, Day 3' }), null);
    assert.equal(compareWhen({ date: '' }, { date: 'Day 3' }), null);
    assert.equal(compareWhen({ date: 'March 3' }, { date: 'March 9' }), -1);
    assert.equal(compareWhen({ date: 'March 3' }, { date: 'March 9, 2077' }), null);
    // Figures that could be read two ways: in order only where both readings agree.
    assert.equal(compareWhen({ date: '03/04/2077' }, { date: '03/09/2077' }), -1);
    assert.equal(compareWhen({ date: '03/04/2077' }, { date: '04/03/2077' }), null);
    assert.equal(compareWhen({ date: '03/04/2077' }, { date: '2078-01-01' }), -1);
    assert.equal(compareWhen({ date: '03/04/2077' }, { date: 'March 20, 2077' }), null, 'March 4 or April 3: one is before the 20th of March, the other after');
});

// ─── What a scene takes in ──────────────────────────────────────────────

const posted = () => {
    let n = postNews(null, { story: W, scene: 's2', at: 1, date: 'Day 3', time: 'night', events: [{ about: 'Pike', text: 'Pike was found dead.' }], clocks: [{ clock: 'gang_war', from: 1, to: 2 }] }).news;
    n = postNews(n, { story: W, scene: 's3', at: 2, date: 'Day 9', time: 'noon', events: ['The Red Lantern burned.'], clocks: [{ clock: 'gang_war', from: 2, to: 3 }] }).news;
    n = postNews(n, { story: W2, scene: 's1', at: 3, date: 'Day 5', time: 'dusk', events: ['Eli Vega won the pit fight at the Anchor.'] }).news;
    return n;
};

test('a story is due what the others sent, up to the date its scene opens at', () => {
    const n = posted();
    const eli = newsDue(n, { story: W2, date: 'Day 6', time: 'morning' });
    assert.deepEqual(eli.events.map(i => i.id), ['n1']);
    assert.deepEqual(eli.clocks.map(i => i.id), ['n2']);
    assert.equal(eli.later, 2, 'Day 9 is in its future');
    const later = newsDue(n, { story: W2, date: 'Day 9', time: 'evening' });
    assert.deepEqual([...later.events, ...later.clocks].map(i => i.id).sort(), ['n1', 'n2', 'n3', 'n4']);
    assert.equal(newsDue(n, { story: W2, date: 'Day 9', time: 'morning' }).later, 2, 'the same day, earlier in it');
    assert.equal(newsDue(n, { story: W2, date: 'Day 9' }).later, 0, 'the same day with no time said is not later');
    const jack = newsDue(n, { story: W, date: 'Day 9', time: 'noon' });
    assert.deepEqual(jack.events.map(i => i.text), ['Eli Vega won the pit fight at the Anchor.'], 'a story is never told its own');
    assert.deepEqual(newsDue(n, { story: '', date: 'Day 9' }).events, []);
});

test('what cannot be placed in time arrives, except in a story that has no date at all yet', () => {
    const n = posted();
    const odd = newsDue(n, { story: W2, date: 'The 17th of Last Seed' });
    assert.equal(odd.events.length, 2);
    assert.equal(odd.later, 0);
    const begun = newsDue(n, { story: W2, date: '', fresh: true });
    assert.equal(begun.events.length + begun.clocks.length, 0);
    assert.equal(begun.later, 4);
    assert.equal(newsDue(n, { story: W2, date: '', fresh: false }).events.length, 2, 'a story that has ended a scene and still tells no date is not kept waiting for ever');
    assert.equal(newsDue(n, { story: W2, date: 'Day 1', fresh: true }).later, 4, 'a story with a date is placed by it');
});

test('one Start takes so many events, the oldest first; taken, they are not due again', () => {
    let n = emptyNews();
    for (let i = 1; i <= NEWS.perStart + 3; i++) n = postNews(n, { story: W, scene: `s${i}`, at: i, date: `Day ${i}`, events: [`Event ${i}.`] }).news;
    const due = newsDue(n, { story: W2, date: 'Day 99' });
    assert.equal(due.events.length, NEWS.perStart);
    assert.equal(due.waiting, 3);
    assert.equal(due.events[0].text, 'Event 1.');
    n = markTaken(n, W2, due.events.map(i => i.id), 's7');
    const next = newsDue(n, { story: W2, date: 'Day 99' });
    assert.deepEqual(next.events.map(i => i.text), ['Event 9.', 'Event 10.', 'Event 11.']);
    assert.equal(next.waiting, 0);
    assert.equal(n.items[0].taken[W2], 's7');
    assert.deepEqual(markTaken(n, '', ['n1'], 's1'), n);
});

test('a Start that waited takes only what is still there', () => {
    let n = posted();
    const due = newsDue(n, { story: W2, date: 'Day 9', time: 'night' });
    n = withdrawNews(n, { story: W, scene: 's3' }).news;
    const still = stillDue(n, due, W2);
    assert.deepEqual(still.events.map(i => i.id), ['n1']);
    assert.deepEqual(still.clocks.map(i => i.id), ['n2']);
    n = markTaken(n, W2, ['n1', 'n2'], 's4');
    assert.deepEqual(stillDue(n, due, W2), { events: [], clocks: [] });
});

test('an event as a line: for a request, and for a scene\'s brief', () => {
    assert.equal(newsLine({ text: 'Pike was found dead.', date: 'Day 3' }), 'Pike was found dead. (Day 3)');
    assert.equal(newsLine({ text: 'Pike was found dead.', date: '' }), 'Pike was found dead.');
    assert.equal(newsBriefLine({ text: 'Pike was found dead.', date: 'Day 3' }), 'Elsewhere, Day 3: Pike was found dead.');
    assert.equal(newsBriefLine({ text: 'Pike was found dead.' }), 'Elsewhere: Pike was found dead.');
});

test('clocks catch up: a rise raises to at least, a fall lowers to at most, twice told changes nothing', () => {
    const start = seedWorldState(pack);    // gang_war 1, heat 3, the_plot 0
    const up = applyNewsClocks(start, [{ clock: 'gang_war', from: 1, to: 2, date: 'Day 3', time: 'night', story: W }, { clock: 'gang_war', from: 2, to: 3, date: 'Day 9', story: W }], pack);
    assert.equal(up.state.clocks.gang_war, 3);
    assert.equal(up.moved, 2);
    assert.equal(start.clocks.gang_war, 1, 'the state handed in is not changed');
    assert.deepEqual(up.state.log.map(e => [e.kind, e.clock, e.from, e.to, e.gameDate, e.news, e.msgId]), [['clock', 'gang_war', 1, 2, 'Day 3', W, null], ['clock', 'gang_war', 2, 3, 'Day 9', W, null]]);
    const again = applyNewsClocks(up.state, [{ clock: 'gang_war', from: 1, to: 2, story: W }, { clock: 'gang_war', from: 2, to: 3, story: W }], pack);
    assert.equal(again.moved, 0);
    assert.equal(again.state.clocks.gang_war, 3);
    // This story already counted those days itself: nothing is counted double.
    const ahead = applyNewsClocks({ ...start, clocks: { ...start.clocks, gang_war: 4 } }, [{ clock: 'gang_war', from: 2, to: 3, story: W }], pack);
    assert.equal(ahead.moved, 0);
    assert.equal(ahead.state.clocks.gang_war, 4);
    const down = applyNewsClocks(start, [{ clock: 'heat', from: 3, to: 1, story: W }], pack);
    assert.equal(down.state.clocks.heat, 1);
    assert.equal(applyNewsClocks({ ...start, clocks: { ...start.clocks, heat: 0 } }, [{ clock: 'heat', from: 3, to: 1, story: W }], pack).moved, 0, 'already lower');
    assert.equal(applyNewsClocks(start, [{ clock: 'gang_war', from: 5, to: 99, story: W }], pack).state.clocks.gang_war, 6, 'never past the pack\'s own range');
    assert.equal(applyNewsClocks(start, [{ clock: 'no_such', from: 0, to: 2 }, { clock: 'heat', from: 2, to: 2 }, null], pack).moved, 0);
});

test('a clock caught up shows its public face in the story\'s news; a hidden clock moves and says nothing', () => {
    const r = applyNewsClocks(seedWorldState(pack), [{ clock: 'gang_war', from: 1, to: 3, date: 'Day 9', story: W }, { clock: 'the_plot', from: 0, to: 2, date: 'Day 9', story: W }], pack);
    assert.equal(r.state.clocks.the_plot, 2);
    const changes = recentChanges(r.state, pack, { limit: 8 });
    assert.deepEqual(changes.map(c => [c.text, c.gameDate]), [['The gang war: The streets empty after dark.', 'Day 9']]);
});

test('what the clocks that caught up now show, as lines for a request', () => {
    const before = seedWorldState(pack);
    const after = applyNewsClocks(before, [{ clock: 'gang_war', from: 1, to: 3, story: W }, { clock: 'the_plot', from: 0, to: 2, story: W }, { clock: 'heat', from: 3, to: 2, story: W }], pack).state;
    assert.deepEqual(clockNewsLines(before, after, pack), ['The gang war: The streets empty after dark.', 'Heat: Patrols thin out.']);
    assert.deepEqual(clockNewsLines(before, after, pack, { spoilerFree: true }), ['The streets empty after dark.', 'Patrols thin out.']);
    assert.deepEqual(clockNewsLines(before, before, pack), []);
    assert.deepEqual(clockNewsLines(before, { ...before, clocks: { ...before.clocks, gang_war: 5 } }, pack), [], 'a step with no public face says nothing');
});

test('events go into the ledger as facts marked as news; a pinned line of the player\'s stands', () => {
    const r = newsToCanon(null, [{ about: 'Pike', text: 'Pike was found dead.', date: 'Day 3' }, { about: '', text: 'The Red Lantern burned to the ground overnight.', date: '' }], { at: 50 });
    assert.equal(r.added, 2);
    assert.deepEqual(r.canon.entries.map(e => [e.kind, e.name, e.text, e.gameDate, e.at, e.pinned, e.msgId]), [
        ['fact', 'Pike', 'Pike was found dead. (news from elsewhere, Day 3)', 'Day 3', 50, false, null],
        ['fact', 'The Red Lantern burned to the ground…', 'The Red Lantern burned to the ground overnight. (news from elsewhere)', '', 50, false, null],
    ]);
    assert.ok(buildCanonBlock(r.canon).includes('Pike: Pike was found dead. (news from elsewhere, Day 3)'));
    // told again: nothing added; newer news of the same subject replaces the line
    assert.equal(newsToCanon(r.canon, [{ about: 'Pike', text: 'Pike was found dead.', date: 'Day 3' }], { at: 60 }).added, 0);
    const newer = newsToCanon(r.canon, [{ about: 'pike', text: 'Pike was buried at sea.', date: 'Day 5' }], { at: 70 });
    assert.equal(newer.canon.entries.length, 2);
    assert.equal(newer.canon.entries.find(e => e.name === 'Pike').text, 'Pike was buried at sea. (news from elsewhere, Day 5)');
    // the player's own pinned line under that name is not replaced
    const mine = addCanonEntry(emptyCanon(), { kind: 'fact', name: 'Pike', text: 'Pike is alive; the body was a double.' }, { at: 1 }).state;
    const kept = newsToCanon(mine, [{ about: 'Pike', text: 'Pike was found dead.', date: 'Day 3' }], { at: 2 });
    assert.equal(kept.added, 0);
    assert.equal(kept.canon.entries[0].text, 'Pike is alive; the body was a double.');
    // a long event keeps its mark
    const long = newsToCanon(null, [{ about: 'Pier Nine', text: `${'word '.repeat(29)}end.`, date: 'Friday, March 14, 2077' }]);
    assert.ok(long.canon.entries[0].text.length <= 200 && long.canon.entries[0].text.endsWith(' (news from elsewhere, Friday, March 14, 2077)'), long.canon.entries[0].text);
});

test('a memory takes the news in: clocks caught up, facts written where the ledger is kept, the memory handed in unchanged', () => {
    const memory = { v: 1, takenAt: 10, scene: 's1', stores: { dooms_world: seedWorldState(pack) }, facts: { date: 'Day 9', time: 'night', location: '', weather: '' } };
    const due = newsDue(posted(), { story: W2, date: 'Day 9', time: 'night' });
    const r = takeNews(memory, due, pack, { at: 99, canon: true });
    assert.equal(r.clocks, 2);
    assert.equal(r.facts, 2);
    assert.equal(r.memory.stores.dooms_world.clocks.gang_war, 3);
    assert.deepEqual(r.memory.stores.dooms_canon.entries.map(e => e.name), ['Pike', 'The Red Lantern burned']);
    assert.equal(memory.stores.dooms_world.clocks.gang_war, 1);
    assert.equal(memory.stores.dooms_canon, undefined);
    const off = takeNews(memory, due, pack, { at: 99, canon: false });
    assert.equal(off.facts, 0);
    assert.equal(off.memory.stores.dooms_canon, undefined, 'with the ledger off none is made');
    assert.equal(takeNews(memory, { events: [], clocks: [] }, pack).memory, memory, 'nothing due: the same memory back');
    assert.equal(takeNews(null, due, pack).memory, null);
});

test('a world\'s news for a list: newest first, where each came from and whom it has reached', () => {
    const n = markTaken(posted(), W2, ['n1'], 's2');
    const l = newsList(n, [{ id: W, name: 'Jack' }, { id: W2, name: 'Eli Vega' }]);
    assert.equal(l.clocks, 2);
    assert.deepEqual(l.events.map(x => [x.id, x.from, x.date, x.reached, x.waiting]), [
        ['n5', 'Eli Vega', 'Day 5', [], ['Jack']],
        ['n3', 'Jack', 'Day 9', [], ['Eli Vega']],
        ['n1', 'Jack', 'Day 3', ['Eli Vega'], []],
    ]);
    assert.equal(newsList(n, []).events[0].from, 'another story');
});

console.log(`world-news-test: ${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
