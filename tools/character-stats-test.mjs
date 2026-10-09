#!/usr/bin/env node
/**
 * Character Stats test: the pure model, storage per chat, the AI
 * round-trip (prompt -> parse -> apply) and the swipe undo.
 *
 * Usage:  node tools/character-stats-test.mjs     (from the repo root)
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
const M = await import(`${DES}/src/utils/statsModel.js`);
const { parseResponse } = await import(`${DES}/src/systems/generation/parser.js`);
const pb = await import(`${DES}/src/systems/generation/promptBuilder.js`);

let failures = 0;
const check = (label, cond, extra = '') => {
    if (cond) console.log(`pass  ${label}`);
    else { console.error(`FAIL  ${label}${extra ? '\n      ' + extra : ''}`); failures++; }
};

// ── Setup: a persona and one NPC in the scene ──
extensionSettings.enabled = true;
extensionSettings.userCharacters = { Mastera: {} };
extensionSettings.activeUserCharacter = 'Mastera';
extensionSettings.lorebook = { campaigns: { camp1: { name: 'Camp One' } }, activeCampaignId: null };
extensionSettings.showQuests = false;
extensionSettings.showInfoBox = true;
extensionSettings.showCharacterThoughts = true;
extensionSettings.compactPrompts = true;
extensionSettings.customTrackerPrompt = '';
committedTrackerData.characterThoughts = JSON.stringify({ characters: [{ name: 'Elena' }, { name: 'Mastera' }] });

// ── 1. Defaults ──
const sheet = S.getStatSheet('Elena');
check('every character starts with 6 attributes + 6 states', sheet.length === 12);
check('states are AI-updated by default, attributes are not',
    sheet.filter(s => s.ai).every(s => s.kind === 'state') && sheet.filter(s => s.kind === 'state').every(s => s.ai));
check('attributes default to an ordinary person (10)', sheet.find(s => s.id === 'str').base === 10);
check('a new NPC is waiting for generation', S.isStatGenerationPending('Elena') === true);
check('the persona never is', S.isStatGenerationPending('Mastera', true) === false);
check('persona and present NPC are the stat characters',
    JSON.stringify(S.getStatCharacters()) === JSON.stringify([{ name: 'Mastera', isUser: true }, { name: 'Elena', isUser: false }]));

// ── 2. Sheet save + custom stats shared by every character ──
// A sheet saved before custom stats went global is folded into the list.
extensionSettings.characterStatCustomMigrated = false; // as on an install that predates the change
extensionSettings.characterStatSheets = { npc: {}, user: { Old: { base: { c_luck: 15 }, ai: {}, custom: [{ id: 'c_luck', name: 'Luck', kind: 'attribute', description: 'Fortune' }] } } };
check('old per-character custom stats are migrated to the global list', S.getStatSheet('Elena').some(s => s.id === 'c_luck') && S.getStatSheet('Old', true).find(s => s.id === 'c_luck').base === 15);
check('...and dropped from the sheet', !('custom' in extensionSettings.characterStatSheets.user.Old));
S.deleteCustomStat('c_luck');
S.deleteStatSheet('Old', true);
const { stat: sanity, error: addErr } = S.addCustomStat({ name: 'Sanity', kind: 'state', description: 'Grip on reality' });
check('custom stat added', !!sanity && !addErr, addErr);
check('a duplicate name is refused', !!S.addCustomStat({ name: 'sanity' }).error);
const list = S.getStatSheet('Mastera', true);
list.find(s => s.id === 'str').base = 70;
S.saveStatSheet('Mastera', true, list);
check('custom stat is on the persona', S.getStatSheet('Mastera', true).some(s => s.id === sanity.id));
check('...and on every other character', S.getStatSheet('Elena').some(s => s.id === sanity.id));
check('custom stats are not stored in the sheet', !('custom' in extensionSettings.characterStatSheets.user.Mastera));
check('base value saved', S.getStatSheet('Mastera', true).find(s => s.id === 'str').base === 70);
check('changes broadcast an event', events.includes(S.STATS_CHANGED_EVENT));

// ── 3. Current values are per chat; base is shared ──
check('current falls back to base', S.getCurrentStatValues('Mastera', true).str === 70);
S.setCurrentStatValue('Mastera', true, 'satiety', 40);
check('current value set (this chat)', S.getCurrentStatValues('Mastera', true).satiety === 40);
otherChat();
check('another chat starts from the base', S.getCurrentStatValues('Mastera', true).satiety === 80);
S.setCurrentStatValue('Mastera', true, 'satiety', 10);
backToChat();
check('switching back keeps each campaign\'s own value', S.getCurrentStatValues('Mastera', true).satiety === 40);
check('values are clamped', S.setCurrentStatValue('Mastera', true, 'str', 999) === 100);
S.setCurrentStatValue('Mastera', true, 'str', 70);

// ── 4. Prompt carries the stats ──
const instr = pb.generateTrackerInstructions(false, false);
check('tracker instructions ask for "stats"', instr.includes('"stats"') && instr.includes('"Elena"') && instr.includes('"Mastera"'));
check('fixed stats are read-only context', /Fixed stats/.test(instr) && /STR 70/.test(instr));
check('custom stat is explained to the AI', instr.includes('- Sanity, 0-100%: Grip on reality'));
check('the attribute scale is explained', instr.includes('10 = ordinary person') && instr.includes('20 = human peak'));
check('a new NPC is asked to be generated', /NEW: Elena has no stats yet/.test(instr) && /"Strength": "X"/.test(instr));
extensionSettings.customTrackerPrompt = 'MY OWN PROMPT';
check('stats survive a custom tracker prompt', pb.generateTrackerInstructions(false, false).includes('"stats"'));
extensionSettings.customTrackerPrompt = '';
extensionSettings.showInfoBox = false;
extensionSettings.showCharacterThoughts = false;
const standalone = pb.generateTrackerInstructions(false, true);
check('stats get their own JSON block when no tracker is on', standalone.includes('Start every reply with ONE JSON code block') && standalone.includes('"stats"'));
extensionSettings.showInfoBox = true;
extensionSettings.showCharacterThoughts = true;
check('separate-mode context lists the stats', pb.generateContextualSummary().includes('Character stats:'));

// ── 5. Parse + apply an AI reply ──
// First reply: Elena's sheet is generated, Mastera's states are updated.
const gen = {"Strength":8,"Dexterity":15,"Constitution":9,"Intelligence":17,"Wisdom":14,"Charisma":12,"Health":70,"Satiety":60,"Energy":80,"Hygiene":90,"Morale":65,"Mana":40};
const reply = 'Hi\n```json\n{"infoBox":{"location":{"value":"Hill"}},"characters":[{"name":"Elena"}],"stats":{"Elena":' + JSON.stringify(gen) + ',"Mastera":{"Health":"60","Sanity":90}}}\n```\nStory...';
const parsed = parseResponse(reply);
check('parser extracts the stats key', !!parsed.stats && !!parsed.infoBox && !parsed.parsingFailed);
check('a stats-only reply is not a parse failure', !parseResponse('```json\n{"stats":{"Elena":{"Energy":5}}}\n```').parsingFailed);
chat.push({ is_user: true, mes: 'go' }, { is_user: false, mes: reply });
const changed = S.applyAIStatUpdates(parsed.stats, chat.length - 1);
check('AI update + generation applied', changed === 14, `changed=${changed}`);
check('generated values become the NPC\'s starting values', S.getStatSheet('Elena').find(s => s.id === 'int').base === 17 && S.getStatSheet('Elena').find(s => s.id === 'health').base === 70);
check('...and current values', S.getCurrentStatValues('Elena').str === 8);
check('...and the NPC is no longer pending', S.isStatGenerationPending('Elena') === false);
check('persona states updated', S.getCurrentStatValues('Mastera', true).health === 60);
check('generation is not part of the swipe undo', !(chat_metadata.dooms_tracker?.statsUndo?.changes || []).some(c => c.key === 'npc:Elena'));
// Second reply: normal tracking — locked attributes stay put.
chat.push({ is_user: true, mes: 'eat' }, { is_user: false, mes: 'ok' });
S.applyAIStatUpdates({ Elena: { Satiety: 95, Strength: 30 } }, chat.length - 1);
check('AI-editable stats change', S.getCurrentStatValues('Elena').satiety === 95);
check('...locked ones never do', S.getCurrentStatValues('Elena').str === 8);
check('undo recorded for the reply', chat_metadata.dooms_tracker?.statsUndo?.messageIndex === 3);
// A thin reply does not count as a generation.
S.requestStatGeneration('Elena');
check('regeneration can be requested', S.isStatGenerationPending('Elena'));
S.applyAIStatUpdates({ Elena: { Strength: 3 } }, chat.length - 1);
check('...and a reply with too few values leaves it pending', S.isStatGenerationPending('Elena') && S.getStatSheet('Elena').find(s => s.id === 'str').base === 8);

// ── 6. Swipe undo keeps manual edits ──
S.setCurrentStatValue('Mastera', true, 'health', 75); // user edits after the reply
const reverted = S.revertAIStatsForReplacedMessage(3);
check('swipe rolls back the AI\'s changes', S.getCurrentStatValues('Elena').satiety === 60, `satiety=${S.getCurrentStatValues('Elena').satiety}`);
check('...but keeps a value the user edited since', S.getCurrentStatValues('Mastera', true).health === 75 && reverted === 1);
check('undo is consumed once', S.revertAIStatsForReplacedMessage(3) === 0);

// ── 6b. Switching a stat off for everyone ──
S.setCurrentStatValue('Mastera', true, 'mana', 33);
S.setStatEnabled('mana', false);
check('a switched-off stat is resolved as disabled', S.getStatSheet('Mastera', true).find(s => s.id === 'mana').enabled === false);
check('...and is not sent to the AI', !pb.generateTrackerInstructions(false, false).includes('"Mana"'));
check('...nor listed in the separate-mode context', !/Mana/.test(pb.generateContextualSummary()));
S.applyAIStatUpdates({ Mastera: { Mana: 90 } }, chat.length - 1);
check('...and the AI cannot change it', S.getCurrentStatValues('Mastera', true).mana === 33);
S.saveStatSheet('Mastera', true, S.getStatSheet('Mastera', true));
S.setStatEnabled('mana', true);
check('switching it back on keeps its values', S.getCurrentStatValues('Mastera', true).mana === 33 && S.getStatSheet('Mastera', true).find(s => s.id === 'mana').enabled);
check('the setting is global (other characters too)', (S.setStatEnabled('str', false), S.getStatSheet('Elena').find(s => s.id === 'str').enabled === false));
S.setStatEnabled('str', true);
S.setStatColor('health', '#00FF88');
check('a built-in stat colour applies to every character', S.getStatSheet('Elena').find(s => s.id === 'health').color === '#00ff88' && S.getStatSheet('Mastera', true).find(s => s.id === 'health').color === '#00ff88');
S.setStatColor('health', '');
check('...and can be reset to the default', S.getStatSheet('Elena').find(s => s.id === 'health').color === '#e5484d');
S.setStatColor('health', 'red; background:url(x)');
check('...ignoring anything that is not a hex colour', S.getStatSheet('Elena').find(s => s.id === 'health').color === '#e5484d');

// ── 7. Deleting a custom stat / character cleans up ──
S.setCurrentStatValue('Mastera', true, sanity.id, 33);
S.setCurrentStatValue('Elena', false, sanity.id, 44);
S.deleteCustomStat(sanity.id);
check('deleting a custom stat removes it from everyone', !S.getStatSheet('Mastera', true).some(s => s.id === sanity.id) && !S.getStatSheet('Elena').some(s => s.id === sanity.id));
check('...and drops every current value',
    !Object.values(chat_metadata.dooms_tracker.betterStats.characterStatValues).some(v => sanity.id in v));
S.deleteStatSheet('Mastera', true);
check('deleting a character drops sheet and values',
    !extensionSettings.characterStatSheets.user.Mastera && !("user:Mastera" in chat_metadata.dooms_tracker.betterStats.characterStatValues));

if (failures) { console.error(`\n${failures} character-stats check(s) failed`); process.exit(1); }
console.log('\nAll character-stats checks pass');
