#!/usr/bin/env node
/**
 * Inventory flow test (Project Short Fuse, Phase 5): the per-chat store,
 * the end-of-reply tag applied once per swipe and put back on a swipe, an
 * edit or a deletion, the tool's outcome kept on the player's message until
 * its reply claims it, the two prompt slots, hand edits and the chat switch.
 *
 * Usage:  node tools/inventory-flow-test.mjs     (from the repo root)
 * Exit:   0 = pass, 1 = failure
 *
 * Same sandbox as tools/dice-test.mjs: load-check's stubs with chat,
 * chat_metadata and getContext() made real.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const SANDBOX = '/tmp/des-load-check';
const DES = `${SANDBOX}/scripts/extensions/third-party/DES`;

execFileSync(process.execPath, ['tools/load-check.mjs'], { stdio: 'pipe' });
if (!existsSync(`${DES}/src/systems/features/inventory.js`)) {
    console.error('FAIL: sandbox missing after load-check — cannot run.');
    process.exit(1);
}

globalThis.__DES_CHAT__ = [];
globalThis.__DES_CHAT_METADATA__ = {};
const scriptStub = `${SANDBOX}/script.js`;
writeFileSync(scriptStub, readFileSync(scriptStub, 'utf8')
    .replace('export const chat_metadata = anything;', 'export const chat_metadata = globalThis.__DES_CHAT_METADATA__;')
    .replace('export const chat = anything;', 'export const chat = globalThis.__DES_CHAT__;'));
const extStub = `${SANDBOX}/scripts/extensions.js`;
writeFileSync(extStub, readFileSync(extStub, 'utf8')
    .replace('export const getContext = anything;', 'export const getContext = () => globalThis.__DES_CTX__;'));

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
globalThis.__DES_CTX__ = new Proxy(
    { chat: globalThis.__DES_CHAT__, chat_metadata: globalThis.__DES_CHAT_METADATA__, name1: 'Jordan', chatId: 'test-chat', user_avatar: '' },
    { get: (t, p) => (p in t ? t[p] : anything) },
);
globalThis.window = globalThis;
globalThis.self = globalThis;
globalThis.document = anything;
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
Object.defineProperty(globalThis, 'navigator', {
    value: { hardwareConcurrency: 8, maxTouchPoints: 0 }, configurable: true,
});
globalThis.jQuery = anything;
globalThis.$ = anything;
globalThis.toastr = anything;
globalThis.requestAnimationFrame = () => 0;
globalThis.cancelAnimationFrame = () => {};
globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });

const chat = globalThis.__DES_CHAT__;
const meta = globalThis.__DES_CHAT_METADATA__;
const state = await import(`${DES}/src/core/state.js`);
const { extensionSettings } = state;
const M = await import(`${DES}/src/utils/inventory.js`);
const inv = await import(`${DES}/src/systems/features/inventory.js`);

let failures = 0;
const check = (label, cond, extra = '') => {
    if (cond) { console.log(`pass  ${label}`); }
    else { console.error(`FAIL  ${label}${extra ? '\n      ' + extra : ''}`); failures++; }
};
const user = (mes) => ({ is_user: true, mes, extra: {} });
const ai = (mes) => ({ is_user: false, mes, swipe_id: 0, swipes: [mes], extra: {} });
const names = (container) => inv.getInventoryState()[container].map(i => `${i.name}:${i.count}`).join(',');
const both = () => `${names('pack')} / ${names('pouch')}`;
const resetMeta = () => { for (const k of Object.keys(meta)) delete meta[k]; };

extensionSettings.enabled = true;
extensionSettings.userCharacters = {};
extensionSettings.inventory = { ...M.defaultInventoryConfig(), enabled: true };
chat.length = 0;
resetMeta();
inv.onInventoryChatChanged();

console.log('\n§1 the store');
check('a chat with nothing stored starts empty', names('pack') === '' && names('pouch') === '');
check('isInventoryOn follows the switch', inv.isInventoryOn() && (extensionSettings.inventory.enabled = false, !inv.isInventoryOn()) && (extensionSettings.inventory.enabled = true, inv.isInventoryOn()));

console.log('\n§2 the prompt slots');
{
    const line = inv.buildInventoryLineForGeneration();
    check('the inventory line names the persona and both containers', line === "[INVENTORY: Jordan's pack 0/16: empty; party pouch 0/8: empty. Read-only here: say what changes, never rewrite the list.]", line);
    let rules = inv.buildInventoryRulesForGeneration();
    check('without tool calling the rules are the tag form', rules.startsWith('[ITEMS: ') && rules.includes('[ITEM: +1 iron key') && rules.includes('Jordan picks up'), rules.slice(0, 80));
    extensionSettings.inventory.tellTheAI = false;
    check('tellTheAI off → no line', inv.buildInventoryLineForGeneration() === '');
    extensionSettings.inventory.tellTheAI = true;
    extensionSettings.inventory.aiChanges.endOfReply = false;
    check('tag off and the tool not live → no rules', inv.buildInventoryRulesForGeneration() === '');
    extensionSettings.inventory.aiChanges.endOfReply = true;
    globalThis.__DES_CTX__.isToolCallingSupported = () => true;
    rules = inv.buildInventoryRulesForGeneration();
    check('with tool calling live the rules name the tool', rules.includes('call the dooms_inventory tool once'), rules.slice(0, 80));
    extensionSettings.inventory.aiChanges.tool = false;
    check('...unless the tool switch is off: back to the tag form', inv.buildInventoryRulesForGeneration().includes('[ITEM: +1 iron key'));
    extensionSettings.inventory.aiChanges.tool = true;
    globalThis.__DES_CTX__.isToolCallingSupported = () => false;
    extensionSettings.inventory.aiChanges.enabled = false;
    check('AI changes off → no rules, the line still rides', inv.buildInventoryRulesForGeneration() === '' && inv.buildInventoryLineForGeneration() !== '');
    extensionSettings.inventory.aiChanges.enabled = true;
    extensionSettings.inventory.enabled = false;
    check('inventory off → nothing at all', inv.buildInventoryRulesForGeneration() === '' && inv.buildInventoryLineForGeneration() === '');
    extensionSettings.inventory.enabled = true;
    extensionSettings.enabled = false;
    check('DES off → nothing at all', inv.buildInventoryRulesForGeneration() === '' && inv.buildInventoryLineForGeneration() === '');
    extensionSettings.enabled = true;
}

console.log('\n§3 a reply with a tag');
chat.push(user('I search the desk.'));
chat.push(ai("You find a key.\n\n[ITEM: +1 iron key (the warden's desk) | pouch +3 silver coins]"));
inv.onInventoryReplyRendered(1);
check('the tag is applied when the reply renders', names('pack') === 'iron key:1' && names('pouch') === 'silver coins:3', both());
check('...and written to the chat metadata', meta.dooms_inventory && meta.dooms_inventory.pack[0].name === 'iron key' && meta.dooms_inventory.pack[0].note === "the warden's desk" && meta.dooms_inventory.pack[0].icon === '🗝️');
check('the reply remembers what its swipe changed, on the message and not under extra', chat[1].dooms_inventory && chat[1].dooms_inventory.live === 0 && chat[1].dooms_inventory.swipes[0].applied.length === 2 && !chat[1].extra.dooms_inventory);
inv.onInventoryReplyRendered(1);
check('rendering again applies nothing twice', names('pack') === 'iron key:1' && names('pouch') === 'silver coins:3');
check('the line the game master reads now carries it', inv.buildInventoryLineForGeneration().includes("Jordan's pack 1/16: iron key (the warden's desk); party pouch 1/8: silver coins ×3."));

console.log('\n§4 an edit');
chat[1].mes = "You find a key.\n\n[ITEM: +1 iron key (the warden's desk)]";
chat[1].swipes[0] = chat[1].mes;
inv.onInventoryReplyRendered(1);
check('an edited tag puts the old changes back and applies the new', names('pack') === 'iron key:1' && names('pouch') === '', both());
chat[1].mes = 'You find nothing.';
chat[1].swipes[0] = chat[1].mes;
inv.onInventoryReplyRendered(1);
check('a tag edited away puts everything back', names('pack') === '' && chat[1].dooms_inventory.live === null, both());
chat[1].mes = "You find a key.\n\n[ITEM: +1 iron key (the warden's desk)]";
chat[1].swipes[0] = chat[1].mes;
inv.onInventoryReplyRendered(1);
check('and back again', names('pack') === 'iron key:1');

console.log('\n§5 swipes');
chat[1].swipes.push('');
chat[1].swipe_id = 1;
chat[1].mes = '';
chat[1].extra = {};   // SillyTavern swaps extra per swipe
inv.onInventoryReplyRendered(1);
check("a new swipe puts the old swipe's changes back", names('pack') === '' && chat[1].dooms_inventory.live === null && !!chat[1].dooms_inventory.swipes[0], both());
chat[1].mes = 'Dust, and two torches.\n\n[ITEM: +2 torches]';
chat[1].swipes[1] = chat[1].mes;
inv.onInventoryReplyRendered(1);
check("the new swipe's tag applies", names('pack') === 'torches:2' && chat[1].dooms_inventory.live === 1, both());
chat[1].swipe_id = 0;
chat[1].mes = chat[1].swipes[0];
inv.onInventoryReplyRendered(1);
check('swiping back puts the torches back and the key out again', names('pack') === 'iron key:1' && chat[1].dooms_inventory.live === 0, both());
chat[1].swipe_id = 1;
chat[1].mes = chat[1].swipes[1];
inv.onInventoryReplyRendered(1);
check('and forward again', names('pack') === 'torches:2');
const ed = inv.editStack('pack', 'rope', { count: 1, note: 'coiled' });
check('a hand edit adds a stack and saves', ed.ok && names('pack') === 'torches:2,rope:1' && meta.dooms_inventory.pack[1].note === 'coiled');
chat[1].swipe_id = 0;
chat[1].mes = chat[1].swipes[0];
inv.onInventoryReplyRendered(1);
check('a swipe leaves the hand-added rope alone', names('pack') === 'rope:1,iron key:1', both());

console.log('\n§6 the tool');
chat.push(user('I take the lantern from the hook.'));
let answer = inv.inventoryToolAction({ changes: [{ action: 'add', item: 'lantern', note: 'from the hook' }] });
check('the tool applies at once and answers with what it recorded', answer.startsWith('Recorded: +1 lantern (pack).') && answer.endsWith(inv.STILL_REQUIRED_ITEMS) && names('pack') === 'rope:1,iron key:1,lantern:1', answer);
check("the outcome waits on the player's message, unclaimed", chat[2].dooms_inventory.tool.length === 1 && chat[2].dooms_inventory.tool[0].attached === null);
answer = inv.inventoryToolAction({ changes: [{ action: 'add', item: 'lantern', note: 'from the hook' }] });
check('the same call again is kept, not applied twice', answer.startsWith('Already recorded:') && names('pack') === 'rope:1,iron key:1,lantern:1', answer);
check('a call with nothing in it records nothing', inv.inventoryToolAction({}).startsWith('Nothing was recorded') && inv.inventoryToolAction('{bad').startsWith('Nothing was recorded'));
answer = inv.inventoryToolAction({ changes: [{ action: 'remove', item: 'rope' }, { action: 'remove', item: 'sword' }] });
check('a second, different call in the same turn adds to it', answer.includes('−1 rope (pack)') && answer.includes("sword was not in Jordan's pack") && names('pack') === 'iron key:1,lantern:1', answer);
const invs = [{ name: 'dooms_inventory', parameters: '{"changes":[{"action":"remove","item":"rope"},{"action":"remove","item":"sword"}]}' }, { name: 'other' }];
inv.onInventoryToolCallsPerformed(invs);
check('TOOL_CALLS_PERFORMED marks the invocation with the outcome', !!invs[0].dooms_inventory && invs[0].dooms_inventory.includes('−1 rope') && !invs[1].dooms_inventory);
chat.push(ai('You lift the lantern down and leave the frayed rope behind.'));
inv.onInventoryReplyRendered(3);
check("the reply claims the turn's tool outcomes", chat[2].dooms_inventory.tool.every(e => e.attached === 3) && chat[3].dooms_inventory.live === 0 && chat[3].dooms_inventory.swipes[0].tool.length === 3 && chat[3].dooms_inventory.swipes[0].applied.length === 2, JSON.stringify(chat[3].dooms_inventory));
check('...without applying them again', names('pack') === 'iron key:1,lantern:1');
chat[3].swipes.push('');
chat[3].swipe_id = 1;
chat[3].mes = '';
chat[3].extra = {};
inv.onInventoryReplyRendered(3);
check("swiping that reply puts the tool's changes back too", names('pack') === 'rope:1,iron key:1', both());
answer = inv.inventoryToolAction({ changes: [{ action: 'add', item: 'lantern' }] });
check('the regenerated reply may call the tool afresh', answer.startsWith('Recorded: +1 lantern') && names('pack') === 'rope:1,iron key:1,lantern:1', answer);
chat[3].mes = 'You take only the lantern.';
chat[3].swipes[1] = chat[3].mes;
inv.onInventoryReplyRendered(3);
check('and the new swipe claims it', chat[3].dooms_inventory.live === 1 && chat[3].dooms_inventory.swipes[1].tool.length === 1 && chat[2].dooms_inventory.tool[2].attached === 3, JSON.stringify(chat[3].dooms_inventory));
chat[3].swipe_id = 0;
chat[3].mes = chat[3].swipes[0];
inv.onInventoryReplyRendered(3);
check("swiping back replays the first swipe's tool changes", names('pack') === 'iron key:1,lantern:1', both());

console.log('\n§7 deletion');
chat.splice(3, 1);
inv.onInventoryMessageDeleted();
check('deleting the reply puts its changes back', names('pack') === 'rope:1,iron key:1', both());
chat.splice(2, 1);
inv.onInventoryMessageDeleted();
check("deleting the player's message whose outcomes a reply claimed changes nothing", names('pack') === 'rope:1,iron key:1', both());
chat.push(user('I pocket the coins.'));
inv.inventoryToolAction({ changes: [{ action: 'add', item: 'coins', count: 5, container: 'pouch' }] });
check('a tool change to the pouch', names('pouch') === 'coins:5');
chat.splice(2, 1);
inv.onInventoryMessageDeleted();
check("deleting the player's message before its reply arrives puts an unclaimed outcome back", names('pouch') === '', both());
chat.push(user('More.'));
chat.push(ai('Another key.\n\n[ITEM: +1 iron key]'));
inv.onInventoryReplyRendered(3);
check('a later reply stacks onto the key', names('pack') === 'rope:1,iron key:2', both());
chat.splice(1, 2);
inv.onInventoryMessageDeleted();
check('deleting the older reply undoes only its share', names('pack') === 'rope:1,iron key:1', both());

console.log('\n§8 the switches on the render path');
extensionSettings.inventory.aiChanges.endOfReply = false;
chat.push(ai('Found a map.\n\n[ITEM: +1 map]'));
inv.onInventoryReplyRendered(chat.length - 1);
check('with the tag switch off a tag does nothing', names('pack') === 'rope:1,iron key:1', both());
extensionSettings.inventory.aiChanges.endOfReply = true;
inv.onInventoryReplyRendered(chat.length - 1);
check('on again, the same reply applies', names('pack') === 'rope:1,iron key:1,map:1', both());
extensionSettings.inventory.enabled = false;
chat[chat.length - 1].mes = 'Found a map and a coin.\n\n[ITEM: +1 map | +1 coin]';
inv.onInventoryReplyRendered(chat.length - 1);
check('with the inventory off a re-render neither applies nor puts back', names('pack') === 'rope:1,iron key:1,map:1', both());
extensionSettings.inventory.enabled = true;
chat.push({ is_user: false, is_system: true, mes: '[ITEM: +1 ghost]', extra: { tool_invocations: [{ name: 'x' }] } });
inv.onInventoryReplyRendered(chat.length - 1);
check('a tool record is not a reply', names('pack') === 'rope:1,iron key:1,map:1');
chat.pop();

console.log('\n§9 hand edits');
check('moveItem', inv.moveItem('map', 'pack', 'pouch', 1).ok && names('pouch') === 'map:1' && names('pack') === 'rope:1,iron key:1', both());
check('removeStack', inv.removeStack('pouch', 'map').ok && names('pouch') === '');
check('an edit that cannot happen says why', !inv.editStack('pack', 'rope', { name: '' }).ok && inv.moveItem('ghost', 'pack', 'pouch', 1).reason === 'missing');
check('clearContainer', inv.clearContainer('pack').ok && names('pack') === '' && !inv.clearContainer('bag').ok);
if (typeof CustomEvent === 'function') {
    let events = 0;
    globalThis.dispatchEvent = (e) => { if (e.type === inv.INVENTORY_CHANGED_EVENT) events++; return true; };
    inv.editStack('pack', 'torch', { count: 1 });
    check('a change fires the window event the shelf listens for', events === 1);
    delete globalThis.dispatchEvent;
}

console.log('\n§10 the tool registration');
{
    let captured = null;
    globalThis.__DES_CTX__.registerFunctionTool = (def) => { captured = def; };
    check('registerInventoryTool hands SillyTavern the definition', inv.registerInventoryTool() === true && !!captured && captured.name === 'dooms_inventory' && captured.description.includes('Jordan') && typeof captured.action === 'function' && captured.formatMessage() === '');
    check('shouldRegister follows the switches', captured.shouldRegister() === true
        && (extensionSettings.inventory.aiChanges.tool = false, captured.shouldRegister() === false)
        && (extensionSettings.inventory.aiChanges.tool = true, captured.shouldRegister() === true)
        && (extensionSettings.inventory.aiChanges.enabled = false, captured.shouldRegister() === false)
        && (extensionSettings.inventory.aiChanges.enabled = true, captured.shouldRegister() === true)
        && (extensionSettings.enabled = false, captured.shouldRegister() === false)
        && (extensionSettings.enabled = true, captured.shouldRegister() === true));
    chat.push(user('chalk?'));
    check('the registered action is the tool action', captured.action({ changes: [{ action: 'add', item: 'chalk' }] }).startsWith('Recorded: +1 chalk'));
}

console.log('\n§11 the chat switch');
resetMeta();
meta.dooms_inventory = { v: 1, pack: Array.from({ length: 20 }, (_, i) => ({ name: `thing ${i}`, count: 1 })), pouch: [{ name: 'Coins', count: 0 }, { name: 'lamp' }] };
chat.length = 0;
globalThis.__DES_CTX__.chatId = 'another-chat';
inv.onInventoryChatChanged();
check('a chat switch loads the stored inventory', names('pouch') === 'lamp:1', both());
check('a stack past the configured slots is kept on load, never dropped silently', inv.getInventoryState().pack.length === 20);
check('getInventoryState hands out a copy', (inv.getInventoryState().pack.pop(), inv.getInventoryState().pack.length === 20));
globalThis.__DES_CTX__.chatId = 'third-chat';
resetMeta();
check('a read after an unseen chat switch reloads', names('pack') === '' && names('pouch') === '');
chat.push(user('hi'));
chat.push(ai('A coin.\n\n[ITEM: +1 coin]'));
inv.onInventoryReplyRendered(1);
check('...and writes to the new chat', meta.dooms_inventory.pack[0].name === 'coin');

console.log('\n§12 the shelf pages markup');
{
    const pages = await import(`${DES}/src/systems/ui/shelfPages.js`);
    resetMeta();
    chat.length = 0;
    globalThis.__DES_CTX__.chatId = 'pages-chat';
    inv.onInventoryChatChanged();
    inv.editStack('pack', 'iron key', { count: 1, note: 'opens the cell' });
    inv.editStack('pack', 'torch', { count: 3 });
    inv.editStack('pouch', 'silver coins', { count: 12 });
    extensionSettings.inventory.packSlots = 6;
    extensionSettings.inventory.pouchSlots = 2;
    const html = pages.inventoryPageHtml();
    const count = (s, re) => (s.match(re) || []).length;
    check('the pack section names the persona and shows kinds over slots', html.includes('Jordan&#39;s pack') && html.includes('>2/6<') && html.includes('Party pouch') && html.includes('>1/2<'), html.slice(0, 300));
    check('one slot per stack plus dashed empties up to the slot count', count(html, /class="dooms-inv-slot"/g) === 3 && count(html, /dooms-inv-slot is-empty/g) === 5, `${count(html, /class="dooms-inv-slot"/g)} / ${count(html, /dooms-inv-slot is-empty/g)}`);
    check('a stack shows its icon, a count badge past one, its name and a note dot', html.includes('🗝️') && html.includes('<span class="dooms-inv-count">3</span>') && html.includes('<span class="dooms-inv-name">iron key</span>') && count(html, /dooms-inv-dot/g) === 1 && !html.includes('<span class="dooms-inv-count">1</span>'));
    check('the note rides in the title', html.includes('title="iron key — opens the cell"'));
    extensionSettings.inventory.pouchSlots = 1;
    const html2 = pages.inventoryPageHtml();
    check('a full container is marked', html2.includes('class="dooms-inv-fill is-full"') && html2.includes('>1/1<'));
    extensionSettings.inventory.packSlots = 1;
    const html3 = pages.inventoryPageHtml();
    check('a stack past a lowered slot count is kept and marked over', html3.includes('>2/1<') && count(html3, /dooms-inv-slot is-over/g) === 1 && count(html3, /dooms-inv-slot is-empty/g) === 0);
    extensionSettings.inventory.packSlots = 16;
    extensionSettings.inventory.pouchSlots = 8;
    extensionSettings.quests = { main: 'Find the warden', optional: ['Feed the cat', 'None', { value: 'Fix the roof' }] };
    const qh = pages.questsPageHtml();
    check('the main quest is a box of its own', qh.includes('dooms-quest-box is-main') && qh.includes('>Find the warden</div>'));
    check('optional quests keep their indices and skip blanks', qh.includes('data-field="optional" data-index="0"') && qh.includes('data-index="2"') && !qh.includes('data-index="1"') && qh.includes('Fix the roof') && qh.includes('<span class="dooms-inv-fill">2</span>'));
    check('an add box for the optional list, none for a set main quest', qh.includes('data-add="optional"') && !qh.includes('data-add="main"'));
    extensionSettings.quests = { main: 'None', optional: [] };
    const qe = pages.questsPageHtml();
    check('with nothing set, both lists offer to add', qe.includes('data-add="main"') && qe.includes('data-add="optional"') && !qe.includes('dooms-quest-done'));
}

console.log(`\n${failures === 0 ? 'All inventory flow checks pass' : `${failures} FAILURE(S)`}`);
process.exit(failures === 0 ? 0 : 1);
