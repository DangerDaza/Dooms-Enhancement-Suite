#!/usr/bin/env node
/**
 * Character Conditions + attribute modifiers test: conditions storage and AI
 * round-trip, effects parsing, effective attributes from equipped items and
 * conditions, and how they reach the prompt.
 *
 * Usage:  node tools/character-conditions-test.mjs     (from the repo root)
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
const Eq = await import(`${DES}/src/systems/features/characterEquipment.js`);
const Cd = await import(`${DES}/src/systems/features/characterConditions.js`);
const Mod = await import(`${DES}/src/systems/features/characterModifiers.js`);
const Ef = await import(`${DES}/src/utils/effectsModel.js`);
const Sm = await import(`${DES}/src/utils/statsModel.js`);
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
extensionSettings.knownCharacters = { Elena: {} };
committedTrackerData.characterThoughts = JSON.stringify({ characters: [{ name: 'Elena' }, { name: 'Mastera' }] });
Eq.cancelStartingGear('Mastera', true); Eq.cancelStartingGear('Elena');

// ── 1. Effects parsing ──
const sheet = Sm.resolveSheet(null);
check('effects from text', JSON.stringify(Ef.parseEffects('STR +2, DEX -1', sheet)) === '{"str":2,"dex":-1}');
check('effects from an object, names or abbreviations', JSON.stringify(Ef.parseEffects({ Strength: 2, CON: '-1' }, sheet)) === '{"str":2,"con":-1}');
check('states are not attributes', Object.keys(Ef.parseEffects({ Health: 5 }, sheet)).length === 0);
check('effects are capped', Ef.parseEffects('STR +99', sheet).str === Ef.EFFECT_MAX);

// ── 2. Effective attributes ──
Eq.addItem('Mastera', true, { name: 'Iron sword', equipped: true, effects: 'STR +2' });
Eq.addItem('Mastera', true, { name: 'Ring', equipped: false, effects: 'DEX +1' });
Cd.addCondition('Mastera', true, { icon: '🦴', name: 'Wounded leg', effects: 'DEX -3' });
let eff = Mod.getEffectiveStatValues('Mastera', true);
check('equipped items add their bonus', eff.values.str === 12 && eff.modifiers.str.parts[0].label === 'Iron sword');
check('backpack items do not', eff.values.dex === 7);
check('conditions apply while they last', eff.modifiers.dex.total === -3);
check('the base value itself never changes', S.getCurrentStatValues('Mastera', true).str === 10);
const ring = Eq.getEquipment('Mastera', true).find(i => i.name === 'Ring');
Eq.updateItem('Mastera', true, ring.id, { equipped: true });
check('equipping adds the bonus', Mod.getEffectiveStatValues('Mastera', true).values.dex === 8);
Eq.setEquipmentEnabled(false);
check('equipment switched off: no item bonuses', Mod.getEffectiveStatValues('Mastera', true).values.str === 10);
Eq.setEquipmentEnabled(true);

// ── 3. Prompt ──
let instr = pb.generateTrackerInstructions(false, false);
check('fixed attributes are sent with their effective value', instr.includes('STR 12 (10 + 2)'));
check('bonuses are listed with their sources', instr.includes('STR +2 (Iron sword)') && instr.includes('DEX −2 (Ring, Wounded leg)'));
check('the AI is told not to fold bonuses into attributes', /never add them to the values yourself/.test(instr));
check('conditions are sent', instr.includes('- Mastera (player character): Wounded leg (DEX −3)'));
check('the AI is told how to change conditions', instr.includes('"conditions"'));
check('separate-mode context lists conditions and effective attributes', pb.generateContextualSummary().includes('Conditions:') && pb.generateContextualSummary().includes('STR 12 (+2)'));
const ex = pb.generateTrackerExample.call ? (committedTrackerData.infoBox = '{"location":{"value":"x"}}', pb.generateTrackerExample()) : '';
check('the example shows the conditions key', ex.includes('"conditions": {}'));

// ── 4. AI round-trip ──
const reply = '```json\n{"infoBox":{"location":{"value":"Inn"}},"conditions":{"Elena":{"add":[{"icon":"🤢","name":"Poisoned","desc":"Feverish","effects":{"CON":-2}}]},"you":{"remove":["Wounded leg"],"add":["🍺 Tipsy"]}}}\n```\nStory';
const parsed = parseResponse(reply);
check('parser extracts conditions', !!parsed.conditions && !parsed.parsingFailed);
chat.push({ is_user: true, mes: 'drink' }, { is_user: false, mes: reply });
const r = Cd.applyAIConditions(parsed.conditions, chat.length - 1);
check('conditions added and ended', r.added === 2 && r.removed === 1, JSON.stringify(r));
check('the AI condition carries its effects', Mod.getEffectiveStatValues('Elena').values.con === 8);
check('a string with an emoji becomes icon + name', Cd.getConditions('Mastera', true).some(c => c.icon === '🍺' && c.name === 'Tipsy'));
check('the healed leg no longer lowers DEX', Mod.getEffectiveStatValues('Mastera', true).values.dex === 11);
check('swipe restores the conditions', Cd.revertAIConditionsForReplacedMessage(chat.length - 1) === 2
    && Cd.getConditions('Mastera', true).map(c => c.name).join() === 'Wounded leg' && Cd.getConditions('Elena').length === 0);
// a user edit after the AI update is never thrown away by a swipe
Cd.applyAIConditions({ Elena: ['Tired'] }, chat.length - 1);
Cd.addCondition('Elena', false, { name: 'Brave' });
check('a list edited since the reply is left alone by a swipe', Cd.revertAIConditionsForReplacedMessage(chat.length - 1) === 0 && Cd.getConditions('Elena').length === 2);

// ── 5. Per chat, cleanup ──
otherChat();
check('another chat has its own conditions', Cd.getConditions('Mastera', true).length === 0);
backToChat();
Cd.setConditionsEnabled(false);
check('switched off: no conditions in the prompt or modifiers', !pb.generateTrackerInstructions(false, false).includes('"conditions"') && Mod.getEffectiveStatValues('Mastera', true).modifiers.dex.total === 1);
Cd.setConditionsEnabled(true);
Cd.deleteConditionsEverywhere('Elena');
check('deleting a character drops its conditions', Cd.getConditions('Elena').length === 0);

if (failures) { console.error(`\n${failures} character-conditions check(s) failed`); process.exit(1); }
console.log('\nAll character-conditions checks pass');
