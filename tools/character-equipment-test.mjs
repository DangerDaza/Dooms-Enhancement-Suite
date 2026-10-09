#!/usr/bin/env node
/**
 * Character Equipment test: the pure model, storage per chat, the AI
 * round-trip (prompt -> parse -> add/remove), locked items and the swipe undo.
 *
 * Usage:  node tools/character-equipment-test.mjs     (from the repo root)
 * Exit:   0 = pass, 1 = failure
 *
 * Reuses the stub sandbox tools/load-check.mjs builds, with two stubs made
 * real (chat and chat_metadata) because the undo record lives there.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const SANDBOX = '/tmp/des-load-check';
const DES = `${SANDBOX}/scripts/extensions/third-party/DES`;

execFileSync(process.execPath, ['tools/load-check.mjs'], { stdio: 'pipe' });
const scriptStub = `${SANDBOX}/script.js`;
writeFileSync(scriptStub, readFileSync(scriptStub, 'utf8')
    .replace('export const chat_metadata = anything;', 'export const chat_metadata = {};')
    .replace('export const chat = anything;', 'export const chat = [];'));

const anything = new Proxy(function () {}, {
    get(t, p) {
        if (p === Symbol.toPrimitive) return () => 'stub';
        if (p === 'then') return undefined;
        if (p === Symbol.iterator) return function* () {};
        return anything;
    },
    apply() { return anything; },
    construct() { return {}; },
});
globalThis.__DES_ANYTHING__ = anything;
globalThis.window = globalThis;
globalThis.self = globalThis;
globalThis.document = anything;
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
Object.defineProperty(globalThis, 'navigator', { value: { hardwareConcurrency: 8, maxTouchPoints: 0 }, configurable: true });
globalThis.jQuery = anything;
globalThis.$ = anything;
globalThis.toastr = anything;
globalThis.SillyTavern = anything;
globalThis.requestAnimationFrame = () => 0;
const events = [];
globalThis.CustomEvent = class { constructor(type, init) { this.type = type; this.detail = init?.detail; } };
globalThis.dispatchEvent = (e) => { events.push(e.type); return true; };

const { extensionSettings, committedTrackerData } = await import(`${DES}/src/core/state.js`);
const { chat, chat_metadata } = await import(`${SANDBOX}/script.js`);
// Data belongs to the chat: another chat is another dooms_tracker blob.
const savedChats = [];
const otherChat = () => { savedChats.push(chat_metadata.dooms_tracker); chat_metadata.dooms_tracker = {}; };
const backToChat = () => { chat_metadata.dooms_tracker = savedChats.pop(); };
const S = await import(`${DES}/src/systems/features/characterStats.js`);
const M = await import(`${DES}/src/utils/equipmentModel.js`);
const Eq = await import(`${DES}/src/systems/features/characterEquipment.js`);
const { parseResponse } = await import(`${DES}/src/systems/generation/parser.js`);
const pb = await import(`${DES}/src/systems/generation/promptBuilder.js`);

let failures = 0;
const check = (label, cond, extra = '') => {
    if (cond) console.log(`pass  ${label}`);
    else { console.error(`FAIL  ${label}${extra ? '\n      ' + extra : ''}`); failures++; }
};

extensionSettings.enabled = true;
extensionSettings.userCharacters = { Mastera: {} };
extensionSettings.activeUserCharacter = 'Mastera';
extensionSettings.lorebook = { campaigns: { camp1: { name: 'Camp One' } }, activeCampaignId: null };
extensionSettings.showInfoBox = true;
extensionSettings.showCharacterThoughts = true;
extensionSettings.showQuests = false;
extensionSettings.compactPrompts = true;
extensionSettings.customTrackerPrompt = '';
extensionSettings.characterAliases = { Elena: ['Lady Elena'] };
committedTrackerData.characterThoughts = JSON.stringify({ characters: [{ name: 'Elena' }, { name: 'Mastera' }] });

// ── 1. Pure model ──
check('one emoji is kept as the icon', M.cleanIcon('🗡️ sword') === '🗡️');
check('letters fall back to the box', M.cleanIcon('abc') === M.DEFAULT_ICON && M.cleanIcon('') === M.DEFAULT_ICON);
check('names and descriptions are capped', M.makeItem({ name: 'x'.repeat(99), desc: 'y'.repeat(999) }).name.length <= 40 && M.makeItem({ name: 'a', desc: 'y'.repeat(999) }).desc.length <= 120);
check('no name, no item', M.makeItem({ name: '  ' }) === null);
const norm = M.normalizeAIEquipment({ Elena: { add: [{ icon: '🗡️', name: 'Sword', desc: 'Sharp' }, 'Rope'], remove: 'Torch' } });
check('AI shapes are normalised', norm[0].add.length === 2 && norm[0].remove[0].name === 'Torch');
const cur = [{ id: 'a', name: 'Torch', aiCanRemove: true }, { id: 'b', name: "Father's sword", aiCanRemove: false }];
const plan = M.applyEquipmentChange(cur, { add: [{ name: 'torch' }, { name: 'Map' }], remove: [{ name: 'TORCH' }, { name: "father's sword" }, { name: 'Ghost' }] });
check('unlocked items can be removed by the AI', !plan.list.some(i => i.id === 'a') && plan.removed === 1);
check('locked items are blocked', plan.blocked.length === 1 && plan.blocked[0].id === 'b');
check('an item removed in the same update can come back; existing ones are not doubled', plan.list.map(i => i.name).join() === "Father's sword,torch,Map");
check('the input list is not modified', cur.length === 2);
// quantities, equipped, effects
const stack = M.applyEquipmentChange([{ id: 'p', name: 'Healing potion', qty: 3, aiCanRemove: true }], {
    add: [{ name: 'Healing potion', qty: 2 }, { name: 'Iron sword', equipped: true, effects: 'STR +2' }],
    remove: [{ name: 'Healing potion', qty: 1 }], equip: [], unequip: [],
}, (raw) => ({ str: 2 }));
const pot = stack.list.find(i => i.name === 'Healing potion');
check('a qty removal uses some up, an explicit qty add stacks', pot.qty === 4);
check('a new item can arrive equipped with effects', stack.list.find(i => i.name === 'Iron sword').equipped === true && stack.list.find(i => i.name === 'Iron sword').effects.str === 2);
const relisted = M.applyEquipmentChange([{ id: 'p', name: 'Healing potion', qty: 3 }], { add: [{ name: 'Healing potion', fromList: true }] });
check('a re-listed item does not stack', relisted.list[0].qty === 3 && relisted.changed === 0);
const used = M.applyEquipmentChange([{ id: 'p', name: 'Healing potion', qty: 2, aiCanRemove: true }], { remove: [{ name: 'Healing potion', qty: 5 }] });
check('using up more than there is removes the stack', used.list.length === 0);
const eq = M.applyEquipmentChange([{ id: 's', name: 'Oak shield' }, { id: 'c', name: 'Cloak', equipped: true }], { equip: ['oak shield'], unequip: ['Cloak'] });
check('equip / unequip move items between equipped and backpack', eq.list[0].equipped === true && eq.list[1].equipped === false);
const nested = M.normalizeAIEquipment({ Mastera: { add: [{ name: 'Potion', quantity: 3, worn: false, bonus: { STR: 1 } }], remove: [{ name: 'Potion', qty: 1 }], wield: ['Axe'], stow: 'Bow' } });
check('alternative field names are understood', nested[0].add[0].qty === 3 && nested[0].add[0].effects.STR === 1 && nested[0].equip[0] === 'Axe' && nested[0].unequip[0] === 'Bow' && nested[0].remove[0].qty === 1);
check('the loadout separates equipped and backpack', M.formatLoadout([{ name: 'Sword', icon: '🗡️', equipped: true, effects: { str: 2 } }, { name: 'Potion', icon: '🧪', qty: 3 }], () => 'STR +2') === 'equipped: 🗡️ Sword (STR +2); backpack: 🧪 Potion ×3');

// ── 2. Storage per chat ──
const sword = Eq.addItem('Mastera', true, { icon: '🗡️', name: "Father's sword", desc: 'Old but sharp', aiCanRemove: false });
check('item added by hand', sword.id && sword.aiCanRemove === false && sword.source === 'user');
check('a duplicate is refused', !!Eq.addItem('Mastera', true, { name: "father's SWORD" }).error);
Eq.addItem('Mastera', true, { icon: '🔦', name: 'Torch', desc: 'Half burnt' });
otherChat();
check('another chat has its own equipment', Eq.getEquipment('Mastera', true).length === 0);
backToChat();
check('...switching back finds it', Eq.getEquipment('Mastera', true).length === 2);
check('persona and NPC lists are separate', Eq.getEquipment('Mastera', false).length === 0);

// ── 3. Prompt ──
const instr = pb.generateTrackerInstructions(false, false);
check('current equipment is sent, locked items marked', instr.includes('- Mastera (player character): backpack: 🔒Father\'s sword, Torch'));
check('NPCs with nothing are listed too', instr.includes('- Elena: nothing listed yet'));
check('the AI is told how to change equipment', instr.includes('"equipment"') && instr.includes('Never remove 🔒'));
check('a character with an empty list is asked for starting gear', /STARTING GEAR: add what Elena already carries/.test(instr));
check('...but not one that already has items', !/STARTING GEAR: add what [^\n]*Mastera/.test(instr));
check('items the player takes out are to be added', instr.includes("anything Mastera takes out in the user's message"));
check('items shown being used are to be added', instr.includes('is shown having one not listed'));
check('separate-mode context lists equipment', pb.generateContextualSummary().includes('Mastera — backpack:'));
Eq.setEquipmentEnabled(false);
check('switched off: nothing is sent', !pb.generateTrackerInstructions(false, false).includes('EQUIPMENT'));
Eq.setEquipmentEnabled(true);

// ── 4. AI round-trip ──
const reply = 'Hi\n```json\n{"characters":[{"name":"Elena"}],"equipment":{"Mastera":{"add":[{"icon":"🗺️","name":"Old map","desc":"Shows the marsh paths"}],"remove":["Torch","Father\'s sword"]},"Lady Elena":{"add":[{"icon":"🏹","name":"Longbow","desc":"Yew, well kept"}]}}}\n```\nStory';
const parsed = parseResponse(reply);
check('parser extracts the equipment key', !!parsed.equipment && !parsed.parsingFailed);
check('an equipment-only reply is not a parse failure', !parseResponse('```json\n{"equipment":{"Elena":{"add":["Rope"]}}}\n```').parsingFailed);
chat.push({ is_user: true, mes: 'go' }, { is_user: false, mes: reply });
const res = Eq.applyAIEquipment(parsed.equipment, chat.length - 1);
check('items added and removed', res.added === 2 && res.removed === 1, JSON.stringify(res));
check('the locked item stays and is reported', Eq.getEquipment('Mastera', true).some(i => i.name === "Father's sword") && res.blocked.length === 1);
check('aliases resolve to the card name', Eq.getEquipment('Elena').some(i => i.name === 'Longbow'));
check('the torch is gone, the map is there', !Eq.getEquipment('Mastera', true).some(i => i.name === 'Torch') && Eq.getEquipment('Mastera', true).some(i => i.name === 'Old map' && i.icon === '🗺️'));
check('swipe undoes it', Eq.revertAIEquipmentForReplacedMessage(1) === 2
    && Eq.getEquipment('Mastera', true).map(i => i.name).join() === "Father's sword,Torch" && Eq.getEquipment('Elena').length === 0);
check('...once', Eq.revertAIEquipmentForReplacedMessage(1) === 0);

// ── 4a. Starting gear is asked once, and again on request ──
check('the swipe in section 4 made Elena\'s starting gear pending again', Eq.needsStartingGear('Elena'));
chat.push({ is_user: true, mes: 'x' }, { is_user: false, mes: 'y' });
Eq.applyAIEquipment({ Elena: ['🏹 Longbow', '🧥 Green cloak'] }, chat.length - 1);
check('starting gear from a reply is added', Eq.getEquipment('Elena').length === 2);
check('...and she is not asked again', !Eq.needsStartingGear('Elena'));
Eq.revertAIEquipmentForReplacedMessage(chat.length - 1);
check('a swipe of that reply removes it and asks again', Eq.getEquipment('Elena').length === 0 && Eq.needsStartingGear('Elena'));
chat.push({ is_user: true, mes: 'x' }, { is_user: false, mes: 'y' });
Eq.applyAIEquipment({ Mastera: { add: ['🍎 Apple'] } }, chat.length - 1);
check('a reply that ignored her still counts as asked', !Eq.needsStartingGear('Elena') && Eq.getEquipment('Elena').length === 0);
Eq.requestStartingGear('Mastera', true);
check('the user can ask again, even with a full list', Eq.needsStartingGear('Mastera', true) && /STARTING GEAR: add what Mastera/.test(pb.generateTrackerInstructions(false, false)));
Eq.cancelStartingGear('Mastera', true);
check('...and cancel it', !Eq.needsStartingGear('Mastera', true));
Eq.removeItem('Mastera', true, Eq.getEquipment('Mastera', true).find(i => i.name === 'Apple').id);

// ── 4b. Robustness: how the player is named, the example, no Workshop persona ──
committedTrackerData.infoBox = JSON.stringify({ location: { value: 'Hill' } });
const ex = pb.generateTrackerExample();
check('the previous-reply example shows the new keys', ex.includes('"equipment": {}') && ex.includes('"memories": {}') && ex.includes('"stats"'));
chat.push({ is_user: true, mes: 'pick it up' }, { is_user: false, mes: 'ok' });
Eq.applyAIEquipment({ you: { add: [{ icon: '⚡', name: 'Electric stone', desc: 'Hums with static' }] } }, chat.length - 1);
check('"you" means the player\'s character', Eq.getEquipment('Mastera', true).some(i => i.name === 'Electric stone'));
const savedUsers = extensionSettings.userCharacters;
extensionSettings.userCharacters = { A: {}, B: {} }; // two personas, none active or linked
extensionSettings.activeUserCharacter = null;
const fallbackInstr = pb.generateTrackerInstructions(false, false);
check('without a resolvable Workshop persona, SillyTavern\'s persona is still in the prompt', /\(player character\)/.test(fallbackInstr));
extensionSettings.userCharacters = savedUsers;
extensionSettings.activeUserCharacter = 'Mastera';

// ── 4c. Every shape a model plausibly uses ends up in the list ──
const shapes = {
    'a plain list of strings': '"equipment":{"Mastera":["⚡ Spark stone"]}',
    'a list of objects': '"equipment":{"Mastera":[{"icon":"⚡","name":"Spark stone","desc":"Hums"}]}',
    'an "items" key': '"equipment":{"Mastera":{"items":[{"icon":"⚡","name":"Spark stone"}]}}',
    'an "inventory" key': '"inventory":{"Mastera":{"add":[{"icon":"⚡","name":"Spark stone"}]}}',
    'an emoji in front of the name': '"equipment":{"Mastera":{"add":["⚡ Spark stone"]}}',
};
for (const [label, body] of Object.entries(shapes)) {
    const before = Eq.getEquipment('Mastera', true).filter(i => i.name !== 'Spark stone');
    chat_metadata.dooms_tracker.betterStats.characterEquipment['user:Mastera'] = before;
    const p = parseResponse('```json\n{"infoBox":{"location":{"value":"Cave"}},' + body + '}\n```\nStory');
    chat.push({ is_user: true, mes: 'x' }, { is_user: false, mes: 'y' });
    Eq.applyAIEquipment(p.equipment, chat.length - 1);
    const got = Eq.getEquipment('Mastera', true).find(i => i.name === 'Spark stone');
    check(`equipment from ${label}`, !!got && got.icon === '⚡', JSON.stringify(Eq.getEquipment('Mastera', true).map(i => i.icon + i.name)));
}
const legacy = parseResponse('```json\n{"inventory":{"onPerson":"sword","stored":{}}}\n```\nx');
Eq.applyAIEquipment(legacy.equipment, 999);
check('an old-style inventory does not invent characters', !Object.keys(chat_metadata.dooms_tracker.betterStats.characterEquipment).some(k => /onperson|stored/i.test(k)));
check('a list never removes what it leaves out', Eq.getEquipment('Mastera', true).some(i => i.name === "Father's sword"));

// ── 5. Editing + cleanup ──
const t = Eq.getEquipment('Mastera', true).find(i => i.name === 'Torch');
Eq.updateItem('Mastera', true, t.id, { aiCanRemove: false });
check('an item can be locked', Eq.getEquipment('Mastera', true).find(i => i.id === t.id).aiCanRemove === false);
check('the user can remove a locked item', Eq.removeItem('Mastera', true, sword.id) && !Eq.getEquipment('Mastera', true).some(i => i.id === sword.id));
chat_metadata.dooms_tracker.betterStats.characterEquipment['npc:Elly'] = [{ id: 'e1', name: 'Dagger', icon: '🗡️', aiCanRemove: true }];
Eq.mergeEquipment('Elena', 'Elly');
check('alias merge moves the items', Eq.getEquipment('Elena').some(i => i.name === 'Dagger') && !chat_metadata.dooms_tracker.betterStats.characterEquipment['npc:Elly']);
Eq.deleteEquipmentEverywhere('Elena');
check('deleting a character drops its items', Eq.getEquipment('Elena').length === 0);

if (failures) { console.error(`\n${failures} character-equipment check(s) failed`); process.exit(1); }
console.log('\nAll character-equipment checks pass');
