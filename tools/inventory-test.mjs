#!/usr/bin/env node
/**
 * Inventory model test: the rules block, items and their icons, the two
 * containers, changes and their exact revert, hand edits, the end-of-reply
 * tag, the function tool, and the lines the game master reads.
 *
 * Usage:  node tools/inventory-test.mjs     (from the repo root)
 * Exit:   0 = pass, 1 = failure
 *
 * The module under test has no SillyTavern imports, so no sandbox is needed.
 */
import {
    MAX_SLOTS, MAX_COUNT, MAX_NAME, MAX_NOTE, MAX_CHANGES, DEFAULT_ICON, INVENTORY_TOOL_NAME,
    defaultInventoryConfig, inventoryConfig, inventoryOn, slotsFor,
    itemKey, iconFor, normalizeItem,
    emptyState, normalizeState, findStack, slotsUsed, isFull,
    normalizeChange, applyChanges, revertApplied, setStack, moveStack,
    parseItemTags, stripItemTags,
    changesFromToolArgs, buildInventoryToolDefinition,
    buildInventoryLine, buildItemTagInstruction, buildItemToolInstruction, describeApplied,
} from '../src/utils/inventory.js';

let failures = 0;
function check(name, ok, detail = '') {
    if (ok) {
        console.log(`pass  ${name}`);
    } else {
        failures++;
        console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
    }
}
const canon = (v) => JSON.stringify(v, (k, val) => (val && typeof val === 'object' && !Array.isArray(val)) ? Object.fromEntries(Object.keys(val).sort().map(key => [key, val[key]])) : val);
const same = (a, b) => canon(a) === canon(b);
const names = (state, container) => (state[container] || []).map(i => `${i.name}:${i.count}`).join(',');

const settingsOn = (extra = {}) => ({ inventory: { enabled: true, ...extra } });
const cfg = inventoryConfig(settingsOn());
const stack = (name, count = 1, note = '') => normalizeItem({ name, count, note });
/** A pack of three kinds and a pouch of one. */
const S = () => ({ v: 1, pack: [stack('torch', 2), stack('rope', 1, 'fifty feet'), stack('iron key', 1, 'opens the cell')], pouch: [stack('silver coins', 3)] });

console.log('\n§1 config');
{
    const d = defaultInventoryConfig();
    check('defaults: off, 16 pack slots, 8 pouch slots, the AI may change it both ways', same(d, { enabled: false, packSlots: 16, pouchSlots: 8, tellTheAI: true, notify: true, aiChanges: { enabled: true, endOfReply: true, tool: true } }), canon(d));
    check('a fresh copy each time', defaultInventoryConfig().aiChanges !== d.aiChanges);
    check('no settings → defaults', same(inventoryConfig(undefined), d) && same(inventoryConfig({}), d) && same(inventoryConfig({ inventory: 'junk' }), d));
    const c = inventoryConfig({ inventory: { enabled: true, packSlots: 999, pouchSlots: 0, aiChanges: { tool: false } } });
    check('slots clamp to 1..64', c.packSlots === MAX_SLOTS && c.pouchSlots === 1);
    check('aiChanges partial: tool off, the rest on', c.aiChanges.enabled && c.aiChanges.endOfReply && !c.aiChanges.tool);
    check('slots from a string, a fraction, junk', inventoryConfig({ inventory: { packSlots: '12' } }).packSlots === 12 && inventoryConfig({ inventory: { packSlots: 7.6 } }).packSlots === 8 && inventoryConfig({ inventory: { packSlots: 'x' } }).packSlots === 16);
    check('enabled only when true', !inventoryConfig({ inventory: { enabled: 'yes' } }).enabled && !inventoryConfig({ inventory: { enabled: 1 } }).enabled && inventoryOn(settingsOn()) && !inventoryOn({}));
    check('tellTheAI and notify only off when false', !inventoryConfig({ inventory: { tellTheAI: false, notify: false } }).tellTheAI && !inventoryConfig({ inventory: { notify: false } }).notify && inventoryConfig({ inventory: { tellTheAI: 0 } }).tellTheAI);
    check('slotsFor', slotsFor('pack', c) === MAX_SLOTS && slotsFor('pouch', c) === 1 && slotsFor('elsewhere', c) === MAX_SLOTS);
    inventoryConfig(Object.freeze({ inventory: Object.freeze({ enabled: true }) }));
    check('settings are never written', true);
}

console.log('\n§2 items and icons');
check('itemKey folds case and spaces', itemKey('  Iron   Key ') === 'iron key' && itemKey(null) === '' && itemKey('Torch') === itemKey('torch'));
const icons = [['silver coins', '🪙'], ['iron key', '🗝️'], ['torch', '🔦'], ['hempen rope', '🪢'], ['healing potion', '🧪'], ['rusty dagger', '🔪'], ['Glock 19 pistol', '🔫'], ['burner phone', '📱'], ['first aid kit', '🩹'], ['TORCH', '🔦'], ['coin purse', '🪙'], ['deck of cards', '🃏']];
for (const [name, icon] of icons) check(`icon for "${name}" is ${icon}`, iconFor(name) === icon, iconFor(name));
check('no rule → the box', iconFor('something odd') === DEFAULT_ICON && iconFor('') === DEFAULT_ICON && iconFor(null) === DEFAULT_ICON);
check('word boundaries: a keystone is not a key', iconFor('keystone') === DEFAULT_ICON, iconFor('keystone'));
{
    const t = normalizeItem('torch');
    check('a bare name becomes a stack of one with its icon', same(t, { name: 'torch', count: 1, note: '', icon: '🔦' }), canon(t));
    const k = normalizeItem({ name: '  Iron  Key. ', count: '3', note: '  opens the  cell ', icon: ' 🔑 ' });
    check('fields cleaned: name, count from a string, note, own icon kept', same(k, { name: 'Iron Key', count: 3, note: 'opens the cell', icon: '🔑' }), canon(k));
    check('count clamps: 0 → 1, 99999 → max, junk → 1, 2.5 → 3', normalizeItem({ name: 'a', count: 0 }).count === 1 && normalizeItem({ name: 'a', count: 99999 }).count === MAX_COUNT && normalizeItem({ name: 'a', count: 'lots' }).count === 1 && normalizeItem({ name: 'a', count: 2.5 }).count === 3);
    check('name and note are cut to length', normalizeItem({ name: 'x'.repeat(100) }).name.length === MAX_NAME && normalizeItem({ name: 'a', note: 'y'.repeat(200) }).note.length === MAX_NOTE);
    check('a long icon string is cut', normalizeItem({ name: 'a', icon: 'abcdefghijkl' }).icon === 'abcdefgh');
    check('an empty icon falls back to the table', normalizeItem({ name: 'torch', icon: '  ' }).icon === '🔦');
    check('nameless → null', normalizeItem({}) === null && normalizeItem('') === null && normalizeItem(null) === null && normalizeItem({ name: '   ' }) === null);
}

console.log('\n§3 state');
check('emptyState', same(emptyState(), { v: 1, pack: [], pouch: [] }));
check('normalizeState of nothing', same(normalizeState(null), emptyState()) && same(normalizeState({ pack: 'junk', pouch: [null, 3, {}] }), emptyState()));
{
    const n = normalizeState({ pack: [{ name: 'Torch', count: 2 }, { name: 'rope', note: '' }, { name: 'torch', count: 3, note: 'pitch' }, { name: 'Rope', count: 1, note: 'frayed' }] }, cfg);
    check('duplicates merge by key: first name kept, counts added, first non-empty note kept', names(n, 'pack') === 'Torch:5,rope:2' && n.pack[0].note === 'pitch' && n.pack[1].note === 'frayed', names(n, 'pack'));
    const many = normalizeState({ pack: Array.from({ length: 20 }, (_, i) => ({ name: `thing ${i}` })) });
    check('past the slot count the latest stacks drop', many.pack.length === 16 && many.pack[15].name === 'thing 15');
    const two = normalizeState({ pouch: Array.from({ length: 5 }, (_, i) => ({ name: `coin ${i}` })) }, inventoryConfig(settingsOn({ pouchSlots: 2 })));
    check('…under the configured slots', two.pouch.length === 2);
    const spent = normalizeState({ pack: [{ name: 'torch', count: 0 }, { name: 'rope', count: -2 }, { name: 'key' }, 'lamp'] });
    check('a spent stack (count 0 or less) is dropped; a bare name is one', names(spent, 'pack') === 'key:1,lamp:1', names(spent, 'pack'));
    check('merged counts stop at the maximum', normalizeState({ pack: [{ name: 'a', count: 9000 }, { name: 'a', count: 9000 }] }).pack[0].count === MAX_COUNT);
}
{
    const s = S();
    check('findStack ignores case and spacing', findStack(s, 'pack', 'IRON  KEY').note === 'opens the cell' && findStack(s, 'pouch', 'torch') === null && findStack(null, 'pack', 'torch') === null);
    check('slotsUsed counts kinds, not pieces', slotsUsed(s, 'pack') === 3 && slotsUsed(s, 'pouch') === 1 && slotsUsed({}, 'pack') === 0);
    check('isFull against the config', !isFull(s, 'pack', cfg) && isFull(s, 'pack', inventoryConfig(settingsOn({ packSlots: 3 }))) && isFull(s, 'pouch', inventoryConfig(settingsOn({ pouchSlots: 1 }))));
}

console.log('\n§4 normalizeChange');
check('nameless → null', normalizeChange(null) === null && normalizeChange({}) === null && normalizeChange({ action: 'add' }) === null);
{
    const c = normalizeChange({ item: ' Torch ' });
    check('defaults: pack, add, one, no note, no icon', same(c, { container: 'pack', action: 'add', name: 'Torch', count: 1, note: '', icon: '' }), canon(c));
    check('"item" and "name" both name it', normalizeChange({ name: 'rope' }).name === 'rope');
    check('container: only pouch is pouch', normalizeChange({ item: 'a', container: 'POUCH' }).container === 'pouch' && normalizeChange({ item: 'a', container: 'bag' }).container === 'pack' && normalizeChange({ item: 'a', container: 7 }).container === 'pack');
    for (const v of ['remove', 'REMOVE', 'drop', 'use', 'lose', 'sell', 'give', 'spend', 'discard']) check(`"${v}" removes`, normalizeChange({ item: 'a', action: v }).action === 'remove');
    for (const v of ['add', 'take', 'gain', 'pickup', '', undefined, 3]) check(`"${v}" adds`, normalizeChange({ item: 'a', action: v }).action === 'add');
    check('count clamps', normalizeChange({ item: 'a', count: 0 }).count === 1 && normalizeChange({ item: 'a', count: '4' }).count === 4 && normalizeChange({ item: 'a', count: 1e9 }).count === MAX_COUNT);
    check('note cleaned, icon kept when given', normalizeChange({ item: 'a', note: ' from  the desk ', icon: ' 🔑 ' }).note === 'from the desk' && normalizeChange({ item: 'a', icon: ' 🔑 ' }).icon === '🔑');
}

console.log('\n§5 applyChanges');
{
    const s0 = emptyState();
    const snap = canon(s0);
    const r = applyChanges(s0, [{ item: 'torch', count: 2 }], cfg);
    check('a new stack enters with its icon', names(r.state, 'pack') === 'torch:2' && r.state.pack[0].icon === '🔦', names(r.state, 'pack'));
    check('…recorded with before null, after the stack, delta +2, its slot', r.applied.length === 1 && r.applied[0].before === null && r.applied[0].after.count === 2 && r.applied[0].delta === 2 && r.applied[0].index === 0 && r.rejected.length === 0);
    check('the input state is untouched', canon(s0) === snap);
    const r2 = applyChanges(r.state, [{ item: 'Torch', count: 1, note: 'pitch' }], cfg);
    check('the same name merges, case aside; the note is taken', names(r2.state, 'pack') === 'torch:3' && r2.state.pack[0].note === 'pitch' && r2.applied[0].before.count === 2 && r2.applied[0].delta === 1);
    const r3 = applyChanges(r2.state, [{ item: 'torch', count: 1 }], cfg);
    check('a merge without a note keeps the old note', r3.state.pack[0].note === 'pitch' && r3.state.pack[0].count === 4);
    const r4 = applyChanges(r3.state, [{ item: 'torch', action: 'remove', count: 1 }], cfg);
    check('removing one leaves three', names(r4.state, 'pack') === 'torch:3' && r4.applied[0].delta === -1 && r4.applied[0].after.count === 3 && r4.applied[0].before.count === 4);
    const r5 = applyChanges(r4.state, [{ item: 'torch', action: 'remove', count: 10 }], cfg);
    check('removing more than there is takes what there is and frees the slot', names(r5.state, 'pack') === '' && r5.applied[0].count === 3 && r5.applied[0].delta === -3 && r5.applied[0].after === null && r5.applied[0].before.count === 3);
    const r6 = applyChanges(r5.state, [{ item: 'torch', action: 'remove' }], cfg);
    check('removing what is not there is rejected as missing', r6.applied.length === 0 && r6.rejected.length === 1 && r6.rejected[0].reason === 'missing' && r6.rejected[0].change.name === 'torch');
}
{
    const tiny = inventoryConfig(settingsOn({ packSlots: 1, pouchSlots: 1 }));
    const r = applyChanges(emptyState(), [{ item: 'torch' }, { item: 'rope' }, { item: 'torch', count: 2 }, { item: 'coins', container: 'pouch' }], tiny);
    check('a full container turns a new kind away but takes more of a kind it holds', names(r.state, 'pack') === 'torch:3' && r.rejected.length === 1 && r.rejected[0].reason === 'full' && r.rejected[0].change.name === 'rope', names(r.state, 'pack'));
    check('the pouch is its own container', names(r.state, 'pouch') === 'coins:1');
}
{
    const r = applyChanges(S(), [{ item: 'rope', action: 'remove' }, { item: 'rope', count: 2, note: 'new coil' }], cfg);
    check('changes apply in order: a removal, then a fresh add of the same name at the end', names(r.state, 'pack') === 'torch:2,iron key:1,rope:2' && r.state.pack[2].note === 'new coil', names(r.state, 'pack'));
    const capped = applyChanges(emptyState(), Array.from({ length: MAX_CHANGES + 4 }, (_, i) => ({ item: `thing ${i}` })), cfg);
    check(`no more than ${MAX_CHANGES} changes per batch`, capped.applied.length === MAX_CHANGES && capped.state.pack.length === MAX_CHANGES);
    const junk = applyChanges(S(), 'nope', cfg);
    check('junk changes do nothing', same(junk.state, S()) && junk.applied.length === 0 && junk.rejected.length === 0);
    const nameless = applyChanges(S(), [{ count: 3 }, null, { item: '' }], cfg);
    check('nameless entries are skipped, not rejected', nameless.applied.length === 0 && nameless.rejected.length === 0);
    const pouch = applyChanges(S(), [{ container: 'pouch', item: 'silver coins', action: 'remove', count: 2 }], cfg);
    check('a pouch removal leaves the pack alone', names(pouch.state, 'pouch') === 'silver coins:1' && names(pouch.state, 'pack') === names(S(), 'pack'));
}

console.log('\n§6 revertApplied');
{
    const s = S();
    const r = applyChanges(s, [
        { item: 'map', note: 'of the sewers' },
        { item: 'torch', count: 1 },
        { item: 'rope', action: 'remove' },
        { container: 'pouch', item: 'silver coins', action: 'remove', count: 2 },
    ], cfg);
    check('the batch changed things', names(r.state, 'pack') === 'torch:3,iron key:1,map:1' && names(r.state, 'pouch') === 'silver coins:1', `${names(r.state, 'pack')} / ${names(r.state, 'pouch')}`);
    const back = revertApplied(r.state, r.applied);
    check('reverting the batch restores the state exactly, slot order included', same(back, s), `${names(back, 'pack')} / ${names(back, 'pouch')}`);
    // A revert is not idempotent: a second pass sees the restored stacks as touched by later changes and takes the share again. Callers revert a batch once (the lifecycle clears its live mark).
    check('a second revert of the same batch takes the share again, by design', findStack(revertApplied(back, r.applied), 'pack', 'torch').count === 1);
    const later = applyChanges(r.state, [{ item: 'lantern' }], cfg).state;
    const partial = revertApplied(later, r.applied);
    check('an unrelated later add survives a revert of the earlier batch', names(partial, 'pack') === 'torch:2,rope:1,iron key:1,lantern:1' && partial.pack[1].note === 'fifty feet', names(partial, 'pack'));
    check('reverting nothing copies the state', same(revertApplied(s, []), s) && same(revertApplied(s, undefined), s) && revertApplied(s, []) !== s);
    check('the input state is untouched', same(s, S()) && same(r.state, applyChanges(s, [{ item: 'map', note: 'of the sewers' }, { item: 'torch' }, { item: 'rope', action: 'remove' }, { container: 'pouch', item: 'silver coins', action: 'remove', count: 2 }], cfg).state));
}
{
    // An older change under newer ones gives up only its own share.
    const s = S();
    const a = applyChanges(s, [{ item: 'torch', count: 1 }, { item: 'map' }], cfg);           // torch 3, map 1
    const b = applyChanges(a.state, [{ item: 'torch', count: 2 }, { item: 'map' }], cfg);     // torch 5, map 2
    const older = revertApplied(b.state, a.applied);
    check('undoing the older reply subtracts its share, the newer one stands', names(older, 'pack') === 'torch:4,rope:1,iron key:1,map:1', names(older, 'pack'));
    const gone = applyChanges(a.state, [{ item: 'map', action: 'remove' }], cfg);             // map removed by a later reply
    check('undoing an add of a stack a later reply removed changes nothing', same(revertApplied(gone.state, a.applied).pack.filter(i => i.name === 'map'), []) && findStack(revertApplied(gone.state, a.applied), 'pack', 'torch').count === 2);
    const taken = applyChanges(s, [{ item: 'rope', action: 'remove' }], cfg);                 // rope gone
    const refilled = applyChanges(taken.state, [{ item: 'rope', count: 3 }], cfg);            // a later reply brings three
    check('undoing a removal under a later add gives the share back', names(refilled.state, 'pack') === 'torch:2,iron key:1,rope:3' && names(revertApplied(refilled.state, taken.applied), 'pack') === 'torch:2,iron key:1,rope:4', names(revertApplied(refilled.state, taken.applied), 'pack'));
    const spent = applyChanges(s, [{ item: 'torch', action: 'remove', count: 2 }], cfg);     // torch gone
    const partly = applyChanges(spent.state, [{ item: 'torch', count: 1 }], cfg);             // later: one torch back
    check('undoing a removal when a later add partly refilled it adds the share', findStack(revertApplied(partly.state, spent.applied), 'pack', 'torch').count === 3);
}

console.log('\n§7 setStack (hand edits)');
{
    const s = S();
    const snap = canon(s);
    const a = setStack(s, 'pack', 'lantern', { count: 2 }, cfg);
    check('a new stack by hand, icon from the table', a.ok && names(a.state, 'pack') === 'torch:2,rope:1,iron key:1,lantern:2' && a.state.pack[3].icon === '🏮');
    check('the input state is untouched', canon(s) === snap);
    const z = setStack(s, 'pack', 'rope', { count: 0 }, cfg);
    check('count 0 removes', z.ok && names(z.state, 'pack') === 'torch:2,iron key:1');
    const zz = setStack(s, 'pack', 'nothing here', { count: 0 }, cfg);
    check('count 0 on nothing is fine', zz.ok && same(zz.state, s));
    const rn = setStack(s, 'pack', 'torch', { name: 'Oil torch' }, cfg);
    check('a rename keeps count and slot', rn.ok && names(rn.state, 'pack') === 'Oil torch:2,rope:1,iron key:1');
    const fold = setStack(s, 'pack', 'rope', { name: 'Torch' }, cfg);
    check('renaming onto another stack folds into it', fold.ok && names(fold.state, 'pack') === 'torch:3,iron key:1', names(fold.state, 'pack'));
    const ed = setStack(s, 'pack', 'iron key', { note: 'the cell, and the warden\'s desk', icon: '🔑', count: '2' }, cfg);
    check('note, icon and count edits', ed.ok && ed.state.pack[2].note.startsWith('the cell') && ed.state.pack[2].icon === '🔑' && ed.state.pack[2].count === 2);
    const keep = setStack(s, 'pack', 'iron key', { icon: '' }, cfg);
    check('a blank icon keeps the old one', keep.ok && keep.state.pack[2].icon === '🗝️');
    const blank = setStack(s, 'pack', 'torch', { name: '   ' }, cfg);
    check('a blank name is refused and the state returned as is', !blank.ok && blank.reason === 'name' && blank.state === s);
    const full = setStack(s, 'pack', 'lantern', {}, inventoryConfig(settingsOn({ packSlots: 3 })));
    check('a full container refuses a new kind', !full.ok && full.reason === 'full' && full.state === s);
    const where = setStack(s, 'bag', 'lantern', {}, cfg);
    check('an unknown container means the pack', where.ok && names(where.state, 'pack').endsWith('lantern:1'));
    const up = setStack(s, 'pouch', 'silver coins', { count: 10 }, cfg);
    check('pouch edits', up.ok && names(up.state, 'pouch') === 'silver coins:10');
}

console.log('\n§8 moveStack');
{
    const s = S();
    const all = moveStack(s, 'torch', 'pack', 'pouch', undefined, cfg);
    check('moving a whole stack', all.ok && names(all.state, 'pack') === 'rope:1,iron key:1' && names(all.state, 'pouch') === 'silver coins:3,torch:2' && all.state.pouch[1].icon === '🔦', `${names(all.state, 'pack')} / ${names(all.state, 'pouch')}`);
    const part = moveStack(s, 'torch', 'pack', 'pouch', 1, cfg);
    check('moving part of a stack', part.ok && names(part.state, 'pack') === 'torch:1,rope:1,iron key:1' && names(part.state, 'pouch') === 'silver coins:3,torch:1');
    const over = moveStack(s, 'torch', 'pack', 'pouch', 99, cfg);
    check('asking for more than the stack moves the stack', over.ok && names(over.state, 'pouch') === 'silver coins:3,torch:2');
    const note = moveStack(s, 'rope', 'pack', 'pouch', 1, cfg);
    check('the note travels', note.ok && note.state.pouch[1].note === 'fifty feet');
    const back = moveStack(part.state, 'torch', 'pouch', 'pack', 1, cfg);
    check('moving onto an existing stack merges', back.ok && names(back.state, 'pack') === 'torch:2,rope:1,iron key:1' && names(back.state, 'pouch') === 'silver coins:3');
    check('a missing stack', !moveStack(s, 'lantern', 'pack', 'pouch', 1, cfg).ok && moveStack(s, 'lantern', 'pack', 'pouch', 1, cfg).reason === 'missing');
    check('same or unknown containers', moveStack(s, 'torch', 'pack', 'pack', 1, cfg).reason === 'containers' && moveStack(s, 'torch', 'pack', 'bag', 1, cfg).reason === 'containers');
    const full = moveStack(s, 'torch', 'pack', 'pouch', 1, inventoryConfig(settingsOn({ pouchSlots: 1 })));
    check('a full target refuses, state returned as is', !full.ok && full.reason === 'full' && full.state === s);
    check('the input state is untouched', same(s, S()));
}

console.log('\n§9 the end-of-reply tag');
const one = (text) => { const r = parseItemTags(text); return r.length === 1 ? r[0] : null; };
const is = (ch, container, action, name, count, note = '') => !!ch && ch.container === container && ch.action === action && ch.name === name && ch.count === count && ch.note === note;
{
    const r = parseItemTags('The warden slumps.\n\n[ITEM: +1 iron key (from the warden\'s desk) | -1 torch | pouch +3 silver coins]');
    check('the example from the instruction parses to three changes', r.length === 3, JSON.stringify(r));
    check('  +1 iron key (note)', is(r[0], 'pack', 'add', 'iron key', 1, 'from the warden\'s desk'), JSON.stringify(r[0]));
    check('  -1 torch', is(r[1], 'pack', 'remove', 'torch', 1), JSON.stringify(r[1]));
    check('  pouch +3 silver coins', is(r[2], 'pouch', 'add', 'silver coins', 3), JSON.stringify(r[2]));
}
const grammar = [
    ['[ITEM: rope]', 'pack', 'add', 'rope', 1],
    ['[ITEM: +2 torches]', 'pack', 'add', 'torches', 2],
    ['[ITEM: + 2 torches]', 'pack', 'add', 'torches', 2],
    ['[ITEM: torch ×2]', 'pack', 'add', 'torch', 2],
    ['[ITEM: torch x2]', 'pack', 'add', 'torch', 2],
    ['[ITEM: torch×2]', 'pack', 'add', 'torch', 2],
    ['[ITEM: 2 torches]', 'pack', 'add', 'torches', 2],
    ['[ITEM: - 1 torch]', 'pack', 'remove', 'torch', 1],
    ['[ITEM: −1 torch]', 'pack', 'remove', 'torch', 1],
    ['[ITEM: –1 torch]', 'pack', 'remove', 'torch', 1],
    ['[ITEM: -torch]', 'pack', 'remove', 'torch', 1],
    ['[ITEM: gains 2 arrows]', 'pack', 'add', 'arrows', 2],
    ['[ITEM: uses 1 bandage]', 'pack', 'remove', 'bandage', 1],
    ['[ITEM: drops the torch]', 'pack', 'remove', 'torch', 1],
    ['[ITEM: takes the key]', 'pack', 'add', 'key', 1],
    ['[ITEM: found a map]', 'pack', 'add', 'map', 1],
    ['[ITEM: picks up 3 arrows]', 'pack', 'add', 'arrows', 3],
    ['[ITEM: sold 3 pelts]', 'pack', 'remove', 'pelts', 3],
    ['[ITEM: spent 5 coins]', 'pack', 'remove', 'coins', 5],
    ['[ITEM: hands over the letter]', 'pack', 'remove', 'letter', 1],
    ['[ITEM: +1 a torch]', 'pack', 'add', 'torch', 1],
    ['[ITEM: + the iron key]', 'pack', 'add', 'iron key', 1],
    ['[ITEM: some rope]', 'pack', 'add', 'rope', 1],
    ['[ITEM: pouch: 3 coins]', 'pouch', 'add', 'coins', 3],
    ['[ITEM: party pouch +3 coins]', 'pouch', 'add', 'coins', 3],
    ['[ITEM: the pouch -1 coin]', 'pouch', 'remove', 'coin', 1],
    ['[ITEM: Pouch -1 torch]', 'pouch', 'remove', 'torch', 1],
    ['[ITEM: pouch torch]', 'pouch', 'add', 'torch', 1],
    ['[ITEM: pack +1 torch]', 'pack', 'add', 'torch', 1],
    ['[ITEM: pack of cards]', 'pack', 'add', 'pack of cards', 1],
    ['[ITEM: +1 pouch of herbs]', 'pack', 'add', 'pouch of herbs', 1],
    ['[ITEM: pouch]', 'pack', 'add', 'pouch', 1],
    ['[ITEM: matchbox x2]', 'pack', 'add', 'matchbox', 2],
    ['[ITEM: box 3]', 'pack', 'add', 'box 3', 1],
    ['[ITEM: xbox 2]', 'pack', 'add', 'xbox 2', 1],
    ['[ITEM: keepsake]', 'pack', 'add', 'keepsake', 1],
    ['[ITEM: +1 key (brass)]', 'pack', 'add', 'key', 1, 'brass'],
    ['[ITEM: -1 torch.]', 'pack', 'remove', 'torch', 1],
    ['[ITEMS: +1 torch]', 'pack', 'add', 'torch', 1],
    ['[item: +1 torch]', 'pack', 'add', 'torch', 1],
    ['[ Item : +1 torch ]', 'pack', 'add', 'torch', 1],
];
for (const [text, container, action, name, count, note] of grammar) {
    const ch = one(text);
    check(`${text} → ${container} ${action} ${count} ${name}${note ? ` (${note})` : ''}`, is(ch, container, action, name, count, note), JSON.stringify(parseItemTags(text)));
}
{
    const r = parseItemTags('a [ITEM: +1 torch] b [ITEM: -1 rope | pouch +2 coins] c');
    check('every tag in the text, in order', r.length === 3 && r[0].name === 'torch' && r[1].name === 'rope' && r[2].container === 'pouch');
    check('empty entries are skipped', parseItemTags('[ITEM: | | torch | ]').length === 1 && parseItemTags('[ITEM: ]').length === 0 && parseItemTags('[ITEM: +1]').length === 0 && parseItemTags('[ITEM: +1 ()]').length === 0);
    check('no tag → nothing', parseItemTags('Just a story.').length === 0 && parseItemTags('').length === 0 && parseItemTags(null).length === 0);
    const capped = parseItemTags(`[ITEM: ${Array.from({ length: 12 }, (_, i) => `+1 thing ${i}`).join(' | ')}]`);
    check(`capped at ${MAX_CHANGES}`, capped.length === MAX_CHANGES);
    check('names are cut to length', parseItemTags(`[ITEM: +1 ${'x'.repeat(100)}]`)[0].name.length === MAX_NAME);
    check('a tag entry carries no icon of its own', parseItemTags('[ITEM: +1 torch]')[0].icon === '');
    check('other brackets are not tags', parseItemTags('[Scene: night] [ITEMIZED: no] [ITEM] ITEM: +1 torch').length === 0);
}

console.log('\n§10 stripItemTags');
check('the tag goes, the story stays', stripItemTags('The warden slumps.\n\n[ITEM: +1 iron key]') === 'The warden slumps.');
check('text after the tag is kept', stripItemTags('Story.\n[ITEM: +1 key]\n<tracker>data</tracker>') === 'Story.\n\n<tracker>data</tracker>', JSON.stringify(stripItemTags('Story.\n[ITEM: +1 key]\n<tracker>data</tracker>')));
check('an inline tag takes the space before it', stripItemTags('He hands it over. [ITEM: +1 key] She nods.') === 'He hands it over. She nods.', JSON.stringify(stripItemTags('He hands it over. [ITEM: +1 key] She nods.')));
check('two tags', stripItemTags('[ITEM: +1 a]\nx\n[ITEM: +1 b]') === 'x');
check('a run of blank lines collapses to one', stripItemTags('a\n\n\n\n[ITEM: +1 x]\n\n\nb') === 'a\n\nb');
check('no tag → the trimmed text', stripItemTags('  plain  ') === 'plain' && stripItemTags(null) === '');

console.log('\n§11 the tool\'s arguments');
{
    const r = changesFromToolArgs({ changes: [{ action: 'add', item: 'torch', count: 2 }, { action: 'remove', item: 'rope', container: 'pouch' }], reason: 'the cellar' });
    check('an object with changes', r.length === 2 && is(r[0], 'pack', 'add', 'torch', 2) && is(r[1], 'pouch', 'remove', 'rope', 1));
    check('a JSON string', changesFromToolArgs('{"changes":[{"action":"add","item":"torch"}]}').length === 1);
    check('"items" and a bare array are accepted', changesFromToolArgs({ items: [{ item: 'torch' }] }).length === 1 && changesFromToolArgs([{ item: 'torch' }]).length === 1);
    check('bad JSON, no list, an empty list, nameless entries → null', changesFromToolArgs('{nope') === null && changesFromToolArgs({ reason: 'x' }) === null && changesFromToolArgs({ changes: [] }) === null && changesFromToolArgs({ changes: [{ count: 2 }] }) === null && changesFromToolArgs(null) === null);
    check(`capped at ${MAX_CHANGES}`, changesFromToolArgs({ changes: Array.from({ length: 12 }, (_, i) => ({ item: `t${i}` })) }).length === MAX_CHANGES);
}

console.log('\n§12 the tool definition');
{
    const t = buildInventoryToolDefinition({ settings: settingsOn(), userName: 'Jordan' });
    check('name and display name', t.name === INVENTORY_TOOL_NAME && t.displayName === 'Inventory change');
    check('the description names the player and the slot counts', t.description.includes('Jordan') && t.description.includes('16 slots') && t.description.includes('pouch 8'), t.description);
    const p = t.parameters;
    check('changes required; each needs action and item', p.required.includes('changes') && same(p.properties.changes.items.required, ['action', 'item']));
    check('container and action enums', same(p.properties.changes.items.properties.container.enum, ['pack', 'pouch']) && same(p.properties.changes.items.properties.action.enum, ['add', 'remove']));
    check(`at most ${MAX_CHANGES} per call`, p.properties.changes.maxItems === MAX_CHANGES && p.properties.changes.minItems === 1);
    const small = buildInventoryToolDefinition({ settings: settingsOn({ packSlots: 10, pouchSlots: 4 }) });
    check('custom slots reach the description; the default player name', small.description.includes('10 slots') && small.description.includes('pouch 4') && small.description.includes('the player'));
    check('serialisable', JSON.parse(JSON.stringify(t)).name === INVENTORY_TOOL_NAME);
}

console.log('\n§13 what the game master reads');
{
    const empty = buildInventoryLine(emptyState(), settingsOn(), { userName: 'Jordan' });
    check('an empty inventory', empty === '[INVENTORY: Jordan\'s pack 0/16: empty; party pouch 0/8: empty. Read-only here: say what changes, never rewrite the list.]', empty);
    const line = buildInventoryLine(S(), settingsOn(), { userName: 'Jordan' });
    check('stacks, counts and notes', line.includes('Jordan\'s pack 3/16: torch ×2, rope (fifty feet), iron key (opens the cell); party pouch 1/8: silver coins ×3.'), line);
    const long = buildInventoryLine({ v: 1, pack: [stack('scroll', 1, 'a'.repeat(80))], pouch: [] }, settingsOn());
    check('a long note is cut to forty characters in the line', long.includes(`(${'a'.repeat(39)}…)`) && !long.includes('a'.repeat(41)), long);
    const heavy = { v: 1, pack: Array.from({ length: 16 }, (_, i) => stack(`thing number ${i}`, 1, 'w'.repeat(80))), pouch: [] };
    const trimmed = buildInventoryLine(heavy, settingsOn());
    check('when the line runs past 700 characters the notes go', !trimmed.includes('(') && trimmed.includes('thing number 15') && trimmed.length <= 700, String(trimmed.length));
    check('the default player name', buildInventoryLine(emptyState(), settingsOn()).startsWith('[INVENTORY: the player\'s pack'));
    check('the configured slots show', buildInventoryLine(emptyState(), settingsOn({ packSlots: 10, pouchSlots: 4 })).includes('pack 0/10') && buildInventoryLine(emptyState(), settingsOn({ packSlots: 10, pouchSlots: 4 })).includes('pouch 0/4'));
}
{
    const s = S();
    const tag = buildItemTagInstruction({ settings: settingsOn(), userName: 'Jordan', state: s });
    check('the tag instruction shows the form and names the player', tag.startsWith('[ITEMS: ') && tag.includes('[ITEM: +1 iron key (from the warden\'s desk) | -1 torch | pouch +3 silver coins]') && tag.includes('Jordan picks up') && tag.includes('most replies have no line at all') && tag.endsWith(']'));
    check('…and says the tracker block still follows', tag.includes('The line replaces nothing'));
    check('no fullness clause while there is room', !tag.includes('is full'));
    const fullPack = buildItemTagInstruction({ settings: settingsOn({ packSlots: 3 }), userName: 'Jordan', state: s });
    check('a full pack is said', fullPack.includes('Jordan\'s pack is full') && !fullPack.includes('pouch is full'));
    const fullBoth = buildItemTagInstruction({ settings: settingsOn({ packSlots: 3, pouchSlots: 1 }), userName: 'Jordan', state: s });
    check('both full', fullBoth.includes('Jordan\'s pack is full; the party pouch is full'));
    const tool = buildItemToolInstruction({ settings: settingsOn(), userName: 'Jordan', state: s });
    check('the tool instruction names the tool and says most replies need no call', tool.includes(`call the ${INVENTORY_TOOL_NAME} tool once`) && tool.includes('most replies need no call') && tool.includes('tracker data block'));
    check('the tool instruction carries fullness too', buildItemToolInstruction({ settings: settingsOn({ pouchSlots: 1 }), state: s }).includes('the party pouch is full'));
    check('the instruction\'s example parses under the grammar', parseItemTags('[ITEM: +1 iron key (from the warden\'s desk) | -1 torch | pouch +3 silver coins]').length === 3);
}
{
    const r = applyChanges(S(), [{ item: 'torch', count: 2 }, { container: 'pouch', item: 'silver coins', action: 'remove', count: 1 }, { item: 'lantern' }, { container: 'pouch', item: 'rope', action: 'remove' }], inventoryConfig(settingsOn({ packSlots: 3 })));
    const d = describeApplied(r.applied, r.rejected, { userName: 'Jordan' });
    check('one line of what happened', d === '+2 torch (pack) · −1 silver coins (pouch) · Jordan\'s pack is full: lantern not added · rope was not in the party pouch: nothing removed', d);
    check('nothing → "no change"', describeApplied([], [], {}) === 'no change' && describeApplied(undefined, undefined) === 'no change');
}

console.log('\n§14 end to end: tag → changes → state → line → swipe');
{
    const reply = 'The warden slumps. You lift the key from his desk and the last torch gutters out.\n\n[ITEM: +1 iron key (from the warden\'s desk) | -1 torch | pouch +3 silver coins]';
    const start = { v: 1, pack: [stack('torch', 1)], pouch: [] };
    const r = applyChanges(start, parseItemTags(reply), cfg);
    check('the state after the reply', names(r.state, 'pack') === 'iron key:1' && names(r.state, 'pouch') === 'silver coins:3' && r.rejected.length === 0, `${names(r.state, 'pack')} / ${names(r.state, 'pouch')}`);
    check('the reply shown without the tag', stripItemTags(reply) === 'The warden slumps. You lift the key from his desk and the last torch gutters out.');
    check('the next line the game master reads', buildInventoryLine(r.state, settingsOn(), { userName: 'Jordan' }).includes('Jordan\'s pack 1/16: iron key (from the warden\'s desk); party pouch 1/8: silver coins ×3.'));
    check('a swipe puts it all back', same(revertApplied(r.state, r.applied), start));
}

console.log(`\n${failures === 0 ? 'ALL PASS' : `${failures} FAILURE(S)`}`);
process.exit(failures === 0 ? 0 : 1);
