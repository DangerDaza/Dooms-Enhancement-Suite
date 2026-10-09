#!/usr/bin/env node
/**
 * Spells & Abilities test, plus editing entries: storage per chat, AI
 * round-trip, locks, passive effects, starting abilities, swipe undo, and
 * the edit functions for items, conditions and abilities.
 *
 * Usage:  node tools/character-abilities-test.mjs     (from the repo root)
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
const Ab = await import(`${DES}/src/systems/features/characterAbilities.js`);
const Am = await import(`${DES}/src/utils/abilityModel.js`);
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
committedTrackerData.infoBox = '{"location":{"value":"Inn"}}';
Eq.cancelStartingGear('Mastera', true); Eq.cancelStartingGear('Elena');

// ── 1. Model ──
check('spell-ish types become spell', Am.normalizeAbilityType('Magic') === 'spell' && Am.normalizeAbilityType('incantesimo') === 'spell' && Am.normalizeAbilityType('skill') === 'ability');
check('an icon defaults by type', Am.makeAbility({ name: 'Heal', type: 'spell' }).icon === Am.DEFAULT_SPELL_ICON && Am.makeAbility({ name: 'Climb' }).icon === Am.DEFAULT_ABILITY_ICON);
const n = Am.normalizeAIAbilities({ Elena: ['🔥 Fireball'], Mastera: { learn: [{ name: 'Lockpicking', kind: 'skill' }], forget: 'Old trick' } });
check('AI shapes are normalised', n[0].add[0].name === '🔥 Fireball' && n[1].add[0].type === 'skill' && n[1].remove[0] === 'Old trick');

// ── 2. Storage, passive effects ──
const skin = Ab.addAbility('Mastera', true, { icon: '🛡️', name: 'Iron skin', type: 'ability', effects: 'CON +2', aiCanRemove: false });
check('ability added by hand', skin.id && skin.type === 'ability' && skin.aiCanRemove === false);
check('a duplicate is refused', !!Ab.addAbility('Mastera', true, { name: 'iron SKIN' }).error);
check('passive effects always apply', Mod.getEffectiveStatValues('Mastera', true).values.con === 12);
otherChat();
check('another chat has its own list', Ab.getAbilities('Mastera', true).length === 0);
backToChat();

// ── 3. Prompt ──
const instr = pb.generateTrackerInstructions(false, false);
check('known abilities are sent, locked marked, effects shown', instr.includes('- Mastera (player character): abilities: 🔒Iron skin (CON +2)'));
check('the AI is told how to change abilities', instr.includes('"abilities"') && instr.includes('"type" spell or ability'));
check('an empty list asks for starting abilities', /STARTING ABILITIES: add the spells and abilities Elena already knows/.test(instr));
check('the example shows the abilities key', pb.generateTrackerExample().includes('"abilities": {}'));
check('separate-mode context lists them', pb.generateContextualSummary().includes('Spells & abilities:'));

// ── 4. AI round-trip ──
const reply = '```json\n{"infoBox":{"location":{"value":"Inn"}},"abilities":{"Elena":{"add":[{"icon":"🔥","name":"Fireball","desc":"Burst of flame","type":"spell"},{"name":"Archery","type":"ability"}]},"you":{"remove":["Iron skin"],"add":["⚡ Spark"]}}}\n```\nStory';
const parsed = parseResponse(reply);
check('parser extracts abilities', !!parsed.abilities && !parsed.parsingFailed);
check('"skills" is understood as abilities', !!parseResponse('```json\n{"skills":{"Elena":["Swim"]}}\n```\nx').abilities);
chat.push({ is_user: true, mes: 'x' }, { is_user: false, mes: reply });
const r = Ab.applyAIAbilities(parsed.abilities, chat.length - 1);
check('abilities added', r.added === 3, JSON.stringify(r));
check('a locked ability is kept and reported', r.blocked.length === 1 && Ab.getAbilities('Mastera', true).some(a => a.name === 'Iron skin'));
check('types come through', Ab.getAbilities('Elena').find(a => a.name === 'Fireball').type === 'spell' && Ab.getAbilities('Elena').find(a => a.name === 'Archery').type === 'ability');
check('Elena is not asked again for starting abilities', !Ab.needsStartingAbilities('Elena'));
check('swipe restores the lists and asks again', Ab.revertAIAbilitiesForReplacedMessage(chat.length - 1) === 2 && Ab.getAbilities('Elena').length === 0 && Ab.needsStartingAbilities('Elena'));
Ab.requestStartingAbilities('Mastera', true);
check('the user can ask again for starting abilities', Ab.needsStartingAbilities('Mastera', true));
Ab.cancelStartingAbilities('Mastera', true);

// ── 5. Editing entries ──
check('an ability can be edited', Ab.updateAbility('Mastera', true, skin.id, { name: 'Stone skin', desc: 'Hard as rock', effects: 'CON +3, STR +1', type: 'spell', icon: '🪨' }) === true);
const st = Ab.getAbilities('Mastera', true)[0];
check('...every field', st.name === 'Stone skin' && st.desc === 'Hard as rock' && st.type === 'spell' && st.icon === '🪨' && st.effects.con === 3 && st.effects.str === 1);
check('...and its effects apply', Mod.getEffectiveStatValues('Mastera', true).values.con === 13);
Ab.addAbility('Mastera', true, { name: 'Climb' });
check('renaming onto another entry is refused', !!Ab.updateAbility('Mastera', true, st.id, { name: 'climb' }).error);
const sword = Eq.addItem('Mastera', true, { name: 'Sword', qty: 1 });
Eq.addItem('Mastera', true, { name: 'Shield' });
check('an item can be edited', Eq.updateItem('Mastera', true, sword.id, { name: 'Iron sword', icon: '🗡️', desc: 'Sharp', qty: 2, equipped: true, effects: 'STR +2', aiCanRemove: false }) === true);
const sw = Eq.getEquipment('Mastera', true).find(i => i.id === sword.id);
check('...every field', sw.name === 'Iron sword' && sw.icon === '🗡️' && sw.qty === 2 && sw.equipped && sw.effects.str === 2 && sw.aiCanRemove === false);
check('...an item rename onto another is refused', !!Eq.updateItem('Mastera', true, sword.id, { name: 'shield' }).error);
check('...clearing the effects removes the bonus', Eq.updateItem('Mastera', true, sword.id, { effects: '' }) === true && !Mod.getEffectiveStatValues('Mastera', true).modifiers.str?.parts.some(p => p.label === 'Iron sword'));
const leg = Cd.addCondition('Mastera', true, { name: 'Wounded leg', effects: 'DEX -3' });
check('a condition can be edited', Cd.updateCondition('Mastera', true, leg.id, { name: 'Bruised leg', effects: 'DEX -1', icon: '🦵' }) === true
    && Cd.getConditions('Mastera', true)[0].name === 'Bruised leg' && Mod.getEffectiveStatValues('Mastera', true).values.dex === 9);

// ── 6. Off switch, cleanup ──
Ab.setAbilitiesEnabled(false);
check('switched off: nothing sent, no passive effects', !pb.generateTrackerInstructions(false, false).includes('"abilities"') && !Mod.getEffectiveStatValues('Mastera', true).modifiers.con);
Ab.setAbilitiesEnabled(true);
Ab.deleteAbilitiesEverywhere('Mastera', true);
check('deleting a character drops its abilities', Ab.getAbilities('Mastera', true).length === 0);

if (failures) { console.error(`\n${failures} character-abilities check(s) failed`); process.exit(1); }
console.log('\nAll character-abilities checks pass');
