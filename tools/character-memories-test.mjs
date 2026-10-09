#!/usr/bin/env node
/**
 * Character Memories test: the pure model, storage per chat, the AI
 * round-trip (prompt -> parse -> add) and the swipe undo.
 *
 * Usage:  node tools/character-memories-test.mjs     (from the repo root)
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
const M = await import(`${DES}/src/utils/memoryModel.js`);
const Mem = await import(`${DES}/src/systems/features/characterMemories.js`);
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
check('a leading star marks an important memory', M.makeMemory('★ Lost her brother').important === true && M.makeMemory('★ Lost her brother').text === 'Lost her brother');
check('long text is capped', M.makeMemory('x'.repeat(500)).text.length <= M.MEMORY_MAX_CHARS);
check('duplicates are detected (case / punctuation)', M.isDuplicateMemory([{ text: 'Mastera saved her from the wolves' }], 'mastera saved her from the wolves!'));
check('a different memory is not a duplicate', !M.isDuplicateMemory([{ text: 'Mastera saved her' }], 'She saved Mastera'));
const list = [];
for (let i = 1; i <= 12; i++) list.push({ id: 'n' + i, text: 'normal ' + i, important: false });
list.splice(2, 0, { id: 'imp', text: 'life-changing', important: true });
const shown = M.selectForPrompt(list, 8);
check('important memories are always sent', shown.some(m => m.id === 'imp'));
check('only the most recent normal memories are sent', shown.filter(m => !m.important).length === 8 && shown.some(m => m.id === 'n12') && !shown.some(m => m.id === 'n1'));
check('older normal memories fade', M.fadedIds(list, 8).has('n1') && !M.fadedIds(list, 8).has('imp'));
check('AI shapes are normalised', M.normalizeAIMemories({ Elena: ['a', { text: 'b', important: true }] })[0].items.length === 2
    && M.normalizeAIMemories([{ name: 'Elena', memory: 'c' }])[0].items[0].text === 'c'
    && M.normalizeAIMemories('{"Elena":"d"}')[0].items[0].text === 'd');

// ── 2. Storage per chat ──
const added = Mem.addMemory('Elena', 'Met Mastera at the crossroads');
check('memory added by hand', added.id && added.source === 'user');
check('a repeat is refused', !!Mem.addMemory('Elena', 'met mastera at the crossroads.').error);
check('an empty one is refused', !!Mem.addMemory('Elena', '   ').error);
otherChat();
check('another chat has its own memories', Mem.getMemories('Elena').length === 0);
Mem.addMemory('Elena', 'Fought the Ash King');
backToChat();
check('...and switching back finds the first ones', Mem.getMemories('Elena').length === 1 && Mem.getMemories('Elena')[0].text.startsWith('Met'));
Mem.updateMemory('Elena', added.id, { important: true, text: 'Met Mastera at the old crossroads' });
check('a memory can be starred and edited', Mem.getMemories('Elena')[0].important && Mem.getMemories('Elena')[0].text.includes('old'));

// ── 3. Prompt ──
const instr = pb.generateTrackerInstructions(false, false);
check('present NPCs\' memories are sent', instr.includes('- Elena: ★ Met Mastera at the old crossroads'));
check('the AI is told how to add memories', instr.includes('"memories"') && instr.includes('Elena'));
check('no memories are asked for the persona', !/"Mastera":\s*\[/.test(instr));
check('separate-mode context lists memories', pb.generateContextualSummary().includes('Elena remembers:'));
extensionSettings.showInfoBox = false; extensionSettings.showCharacterThoughts = false;
const lone = pb.generateTrackerInstructions(false, true);
check('memories ride with the stats block when no tracker is on', lone.includes('"memories"'));
extensionSettings.showInfoBox = true; extensionSettings.showCharacterThoughts = true;
Mem.setMemoriesEnabled(false);
check('switched off: nothing is sent', !pb.generateTrackerInstructions(false, false).includes('CHARACTER MEMORIES') && !pb.generateTrackerInstructions(false, false).includes('"memories"'));
Mem.setMemoriesEnabled(true);

// ── 4. AI round-trip ──
const reply = 'Hi\n```json\n{"characters":[{"name":"Elena"}],"memories":{"Lady Elena":["★ Mastera spared the Ash King for her","met Mastera at the old crossroads"],"Mastera":["should be ignored"]}}\n```\nStory';
const parsed = parseResponse(reply);
check('parser extracts the memories key', !!parsed.memories && !parsed.parsingFailed);
check('a memories-only reply is not a parse failure', !parseResponse('```json\n{"memories":{"Elena":["x happened"]}}\n```').parsingFailed);
chat.push({ is_user: true, mes: 'go' }, { is_user: false, mes: reply });
const n = Mem.applyAIMemories(parsed.memories, chat.length - 1);
check('new AI memory added via alias, repeat skipped, persona ignored', n === 1, `n=${n}`);
check('the prompt allows at most one new memory', instr.includes('at most ONE new memory per reply'));
const newest = Mem.getMemories('Elena').at(-1);
check('...marked important and as AI-written', newest.important && newest.source === 'ai' && newest.text === 'Mastera spared the Ash King for her');
check('...older memories are untouched', Mem.getMemories('Elena').length === 2);
check('undo recorded', chat_metadata.dooms_tracker?.memoriesUndo?.added?.length === 1);
check('swipe removes the reply\'s memories', Mem.revertAIMemoriesForReplacedMessage(1) === 1 && Mem.getMemories('Elena').length === 1);
check('...once', Mem.revertAIMemoriesForReplacedMessage(1) === 0);
chat.push({ is_user: true, mes: 'more' }, { is_user: false, mes: 'ok' });
const many = Mem.applyAIMemories({ Elena: ['Ate a quiet dinner', '★ Was knighted by the queen', 'Saw a comet'] }, chat.length - 1);
check('only one memory per reply is kept', many === 1);
check('...and an important one wins', Mem.getMemories('Elena').at(-1).text === 'Was knighted by the queen');
check('a second update of the same reply adds nothing more', Mem.applyAIMemories({ Elena: ['Saw a comet'] }, chat.length - 1) === 0);

// ── 5. Settings + cleanup ──
Mem.setRecentLimit(500);
check('recent limit is clamped', Mem.getRecentLimit() === 50);
Mem.setRecentLimit(8);
Mem.mergeMemories('Elena', 'Elly');
chat_metadata.dooms_tracker.betterStats.characterMemories.Elly = [{ id: 'x1', text: 'Elly memory', important: false, source: 'ai' }];
Mem.mergeMemories('Elena', 'Elly');
check('alias merge moves memories to the canonical character', Mem.getMemories('Elena').some(m => m.text === 'Elly memory') && !chat_metadata.dooms_tracker.betterStats.characterMemories.Elly);
Mem.deleteMemoriesEverywhere('Elena');
check('deleting a character drops its memories', Mem.getMemories('Elena').length === 0);

if (failures) { console.error(`\n${failures} character-memories check(s) failed`); process.exit(1); }
console.log('\nAll character-memories checks pass');
