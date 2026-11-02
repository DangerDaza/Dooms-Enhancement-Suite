#!/usr/bin/env node
/**
 * Canon, the pure parts (docs/hooks-canon-plan.md D105–D112): the rules,
 * the ledger made safe, a reply counted, the request, the reply read and
 * checked, a run applied, your own lines, the rewind, the block, the
 * exports.
 *
 * Usage:  node tools/canon-test.mjs   (from the repo root)
 * Exit:   0 = all pass, 1 = a failure
 */
import {
    CANON_KINDS, PER_KIND, TOTAL, defaultCanonConfig, canonConfig, emptyCanon, normalizeCanon, countCanonReply, canonDue,
    buildCanonPrompt, parseCanonReply, validateCanon, applyCanon, failCanon, addCanonEntry, editCanonEntry, pinCanonEntry,
    removeCanonEntry, reconcileCanon, buildCanonBlock, canonToMarkdown, canonToLorebookEntries, describeCanonResult, canonKey,
} from '../src/utils/canon.js';

let failures = 0;
const check = (label, cond, extra = '') => {
    if (cond) console.log(`pass  ${label}`);
    else { console.error(`FAIL  ${label}${extra ? '\n      ' + extra : ''}`); failures++; }
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

console.log('\n§1 the rules');
{
    const d = defaultCanonConfig();
    check('defaults: off, every 8, 16 recent, inject at depth 3 as system, 1500 characters', same(d, { enabled: false, every: 8, recentMessages: 16, inject: true, depth: 3, role: 'system', maxChars: 1500, debug: false }));
    check('no settings: the defaults', same(canonConfig(null), d) && same(canonConfig({ canon: 'x' }), d));
    const c = canonConfig({ canon: { enabled: true, every: 0, recentMessages: 999, depth: -2, role: 'wizard', maxChars: 10, inject: false, debug: 1 } });
    check('clamps and fallbacks', c.enabled && c.every === 1 && c.recentMessages === 60 && c.depth === 0 && c.role === 'system' && c.maxChars === 300 && !c.inject && !c.debug);
}

console.log('\n§2 the ledger and the count');
let st = emptyCanon();
{
    const n = normalizeCanon({ entries: [{ kind: 'person', name: 'Old Marit', text: 'Keeps the Anchor.' }, { kind: 'Person', name: 'old marit', text: 'Keeps the Anchor and owes the governor.' }, { kind: 'moon', name: 'X', text: 'y' }, { name: 'no text' }], counted: ['a', 1, ''], sinceLast: -1, last: { ok: true, added: 2 }, retryNext: 'yes' });
    check('one line per kind and name (the later wins), an unknown kind is a fact, a line with no text goes, the counts and runs made safe', n.entries.length === 2 && n.entries[0].text === 'Keeps the Anchor and owes the governor.' && n.entries[1].kind === 'fact' && n.entries[0].id === 'c1' && same(n.counted, ['a']) && n.sinceLast === 0 && n.last.ok && n.last.added === 2 && n.retryNext === false, JSON.stringify(n.entries));
    const many = normalizeCanon({ entries: Array.from({ length: 50 }, (_, i) => ({ kind: 'fact', name: `f${i}`, text: 'x', at: i, pinned: i === 0 })) });
    check(`the caps: ${PER_KIND} of a kind, the oldest unpinned going first, a pinned line kept`, many.entries.length === PER_KIND && many.entries.some(e => e.name === 'f0') && !many.entries.some(e => e.name === 'f1'));
    const r1 = countCanonReply(st, 'm1');
    const r2 = countCanonReply(r1.state, 'm1');
    check('a reply counts once', r1.counted && r1.state.sinceLast === 1 && !r2.counted && r2.state === r1.state && st.sinceLast === 0);
    st = countCanonReply(r1.state, 'm2').state;
    check('due at N, or on a retry', !canonDue(st, 3) && canonDue(st, 2) && canonDue({ ...st, retryNext: true }, 50));
}

console.log('\n§3 the request');
{
    const entries = [{ id: 'c1', kind: 'person', name: 'Old Marit', text: 'Keeps the Anchor.', pinned: true, at: 1 }, { id: 'c2', kind: 'promise', name: 'The harbourmaster\'s fee', text: 'Jordan owes the harbourmaster two silver by Friday.', at: 2 }];
    const p = buildCanonPrompt({ entries, recent: 'Jordan: I pay.\nNarrator: He takes the coin.', now: { date: 'Friday', location: 'the docks' }, player: 'Jordan', names: ['Old Marit', 'Captain Reyes'] });
    check('the exact JSON asked for, the rules, the player never an entry', p.system.includes('{"add":[{"kind":"person|place|thing|fact|promise|secret"') && p.system.includes('at most 8 adds and 4 drops') && p.system.includes('(Jordan) is never an entry'));
    check('the ledger so far by kind, the names, now, the scenes', p.user.includes('People:\n- Old Marit: Keeps the Anchor.') && p.user.includes("Promises:\n- The harbourmaster's fee:") && p.user.includes('Names the story knows: Old Marit, Captain Reyes') && p.user.includes('Now: Friday, at the docks.') && p.user.includes('Narrator: He takes the coin.'));
    check('an empty ledger says so', buildCanonPrompt({}).user.includes('The ledger so far:\n(empty)'));
}

console.log('\n§4 the reply read, checked and applied');
{
    const reply = parseCanonReply('<think>x</think>Noted.\n```json\n{"add":[{"kind":"PERSON","name":"Captain Reyes","text":"Runs the customs house and sells stamped papers on the side."},{"kind":"debt","name":"The salt","text":"Three sacks of salt sit in the Anchor\'s back room."},{"kind":"person","name":"Jordan","text":"the player"},{"kind":"person","name":"Captain Reyes","text":"a repeat"},{"name":"","text":"no name"}],"drop":["The harbourmaster\'s fee", {"name":"Nobody"}]}\n```');
    st = addCanonEntry(st, { kind: 'promise', name: 'The harbourmaster\'s fee', text: 'Owed by Friday.' }, { at: 1 }).state;
    st = applyCanon(st, { add: [{ kind: 'person', name: 'Old Marit', text: 'Keeps the Anchor.' }], drop: [] }, { msgId: 'm1', gameDate: 'Thursday', ranAt: 10 });
    const v = validateCanon(reply, st);
    check('read through reasoning and prose; the kind lower-cased, an unknown kind a fact, a repeat and a nameless add dropped, drops by name', v.ok && v.clean.add.length === 3 && v.clean.add[0].kind === 'person' && v.clean.add[1].kind === 'fact' && v.clean.add[2].name === 'Jordan' && same(v.clean.drop, ["The harbourmaster's fee", 'Nobody']) && v.errors.length === 1, JSON.stringify(v));
    const next = applyCanon(st, v.clean, { msgId: 'm2', gameDate: 'Friday', ranAt: 20 });
    check('applied: new lines stamped on the reply, the pinned promise not dropped, the run noted, the count restarted', next.entries.length === 5 && next.entries.find(e => e.name === 'Captain Reyes').msgId === 'm2' && next.entries.find(e => e.name === "The harbourmaster's fee").pinned && next.last.added === 3 && next.last.dropped === 0 && next.sinceLast === 0 && !next.retryNext, JSON.stringify(next.entries.map(e => e.name)));
    const changed = applyCanon(next, { add: [{ kind: 'person', name: 'old marit', text: 'Keeps the Anchor; owes the governor.' }], drop: ['Captain Reyes'] }, { msgId: 'm3', ranAt: 30 });
    check('a changed line replaces under the same kind and name; an unpinned line is dropped by name', changed.entries.find(e => e.name === 'Old Marit').text === 'Keeps the Anchor; owes the governor.' && changed.entries.find(e => e.name === 'Old Marit').msgId === 'm3' && !changed.entries.some(e => e.name === 'Captain Reyes') && changed.last.added === 1 && changed.last.dropped === 1);
    const pinnedMarit = pinCanonEntry(changed, changed.entries.find(e => e.name === 'Old Marit').id, true);
    const vp = validateCanon({ add: [{ kind: 'person', name: 'Old Marit', text: 'Something else.' }] }, pinnedMarit);
    check('an add over a pinned line is refused at the check, said plainly, the rest standing', vp.ok && vp.clean.add.length === 0 && vp.errors[0].includes('pinned'));
    check('nothing new is a sound answer; neither add nor drop is not; a list that is not a list is not', validateCanon({ add: [] }, st).ok && !validateCanon({ x: 1 }, st).ok && !validateCanon({ add: 'no' }, st).ok && !validateCanon(null, st).ok);
    const failed = failCanon(changed, { error: 'network down', kind: 'error', ranAt: 40 });
    check('a failed run: retry on the next reply, the error kept, nothing else touched', failed.retryNext && failed.lastError.error === 'network down' && failed.lastError.kind === 'error' && failed.entries.length === changed.entries.length);
    st = changed;
}

console.log('\n§5 your own lines, the rewind');
{
    const a = addCanonEntry(st, { kind: 'secret', name: 'The governor\'s ring', text: 'Hidden in the chandlery; only Jordan knows.' }, { at: 50 });
    check('a line of your own: pinned, by you, a new id', a.entry && a.entry.pinned && a.entry.by === 'you' && a.state.entries.length === st.entries.length + 1);
    const e = editCanonEntry(a.state, a.entry.id, { text: 'Hidden in the chandlery.' });
    check('edited: the new text, still pinned, by you', e.entry && e.entry.text === 'Hidden in the chandlery.' && e.entry.pinned && e.state.entries.find(x => x.id === a.entry.id).text === 'Hidden in the chandlery.');
    check('a nameless add, an edit of nothing', addCanonEntry(st, { name: '', text: 'x' }).entry === null && editCanonEntry(st, 'nope', { text: 'x' }).entry === null);
    const removed = removeCanonEntry(e.state, a.entry.id);
    check('removed', removed.entries.length === e.state.entries.length - 1 && removeCanonEntry(removed, 'nope') === removed);
    const un = pinCanonEntry(e.state, a.entry.id, false);
    check('unpinned', !un.entries.find(x => x.id === a.entry.id).pinned && pinCanonEntry(un, 'nope') === un);
    // the rewind: lines on m3 go, the pinned promise stays, the count for m2 goes
    const r = reconcileCanon({ ...e.state, counted: ['m1', 'm2', 'm3'], sinceLast: 3, last: { msgId: 'm3', ok: true } }, ['m1']);
    check('replies gone take their lines (the three on m2 and m3) and their counts, not the pinned lines; the run on m3 is no longer the last', r.dropped === 3 && !r.state.entries.some(x => x.name === 'Old Marit') && r.state.entries.every(x => x.pinned) && r.state.entries.some(x => x.name === "The harbourmaster's fee") && r.pruned === 2 && r.state.sinceLast === 1 && r.state.last === null, JSON.stringify(r.state.entries.map(x => x.name)));
    check('nothing to wind back: the same state', reconcileCanon(e.state, ['m1', 'm2', 'm3']).state === e.state);
}

console.log('\n§6 the block and the exports');
{
    const s = normalizeCanon({ entries: [
        { kind: 'person', name: 'Old Marit', text: 'Keeps the Anchor.', at: 1 },
        { kind: 'person', name: 'Captain Reyes', text: 'Runs the customs house.', at: 2, pinned: true },
        { kind: 'place', name: 'The Anchor', text: 'A tavern in the old town.', at: 3 },
        { kind: 'promise', name: 'The fee', text: 'Jordan owes two silver.', at: 4 },
    ] });
    const block = buildCanonBlock(s, { maxChars: 1500 });
    check('the block: by kind, pinned first then newest, one sentence per kind', block.startsWith('[CANON — what the story has established. People: Captain Reyes: Runs the customs house.; Old Marit: Keeps the Anchor.. Places: The Anchor: A tavern in the old town.. Promises: The fee: Jordan owes two silver..]'), block);
    check('cut to size, closed', buildCanonBlock(s, { maxChars: 60 }).length <= 60 && buildCanonBlock(s, { maxChars: 60 }).endsWith('…]') && buildCanonBlock(emptyCanon()) === '');
    const md = canonToMarkdown(s, { title: 'Canon of Harbourside' });
    check('markdown by kind', md.startsWith('# Canon of Harbourside\n\n## People\n\n- **Captain Reyes**: Runs the customs house.') && md.includes('## Promises'));
    const lb = canonToLorebookEntries(s);
    check('lorebook entries: one per line, keyed by the name (a promise by its words too), titled so a later export finds them', lb.length === 4 && lb[0].comment === 'Canon · person: Old Marit' && same(lb[0].key, ['Old Marit']) && lb[3].key.includes('The fee') && lb[0].content === 'Old Marit: Keeps the Anchor.');
    check('the result lines', describeCanonResult({ ok: true, added: 2, dropped: 1 }).includes('2 lines added') && describeCanonResult({ ok: true, added: 0, dropped: 0 }) === 'Nothing new to record.' && describeCanonResult({ ok: false, reason: 'invalid', errors: ['x'] }).includes('discarded'));
    check('keys', canonKey('person', '  Old, Marit! ') === 'person|old marit' && CANON_KINDS.length === 6 && TOTAL === 160);
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nAll canon checks pass');
process.exit(failures ? 1 : 0);
