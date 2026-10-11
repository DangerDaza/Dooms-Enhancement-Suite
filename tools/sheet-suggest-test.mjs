#!/usr/bin/env node
/**
 * Sheet suggestion test (Project Short Fuse, Phase 4b, §11): the small call
 * that rates a character, how its answer lands on the sheet, and the
 * automatic trigger behind its switch.
 *
 * Usage:  node tools/sheet-suggest-test.mjs     (from the repo root)
 * Exit:   0 = pass, 1 = failure
 *
 * Same sandbox as tools/dice-test.mjs. The game master call is replaced
 * through the module's test hook.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const SANDBOX = '/tmp/des-load-check';
const DES = `${SANDBOX}/scripts/extensions/third-party/DES`;

execFileSync(process.execPath, ['tools/load-check.mjs'], { stdio: 'pipe' });
if (!existsSync(`${DES}/src/systems/features/sheetSuggest.js`)) {
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
const state = await import(`${DES}/src/core/state.js`);
const { extensionSettings, lastGeneratedData } = state;
const D = await import(`${DES}/src/utils/d20.js`);
const S = await import(`${DES}/src/systems/features/sheetSuggest.js`);

let failures = 0;
const check = (label, cond, extra = '') => {
    if (cond) { console.log(`pass  ${label}`); }
    else { console.error(`FAIL  ${label}${extra ? '\n      ' + extra : ''}`); failures++; }
};

extensionSettings.enabled = true;
extensionSettings.generationMode = 'together';
extensionSettings.userCharacters = {};
extensionSettings.attributes = { ...D.defaultAttributesConfig(), enabled: true };
extensionSettings.characterAttributes = {};
extensionSettings.characterInjection = { 'Ines Arden': { description: 'A clerk at the Office, twenty, nervous and quick.', lorebook: '' } };
extensionSettings.characterAppearance = { 'Ines Arden': 'Small, dark coat.' };
chat.push({ is_user: false, mes: 'Ines looks up from the ledger.', extra: {} });
const defs = D.attributeDefs(extensionSettings);

// ── 1. The call ──
let calls = 0;
let lastMessages = null;
S.__setSuggestTransport(async (messages) => { calls++; lastMessages = messages; return 'Sure: {"tier": "Ordinary", "scores": {"Strength": 9, "Dexterity": 12, "Constitution": 10, "Intelligence": 12, "Wisdom": 11, "Charisma": 12}, "reasons": {"Dexterity": "quick hands", "Charisma": "quick to smile"}}'; });
S.__resetSuggestions({ timeout: 2000 });
const s1 = await S.suggestSheet({ name: 'Ines Arden', description: 'A clerk at the Office.', appearance: 'Small, dark coat.' });
check('suggestSheet asks once with the card text and the scene, and returns the parsed answer',
    calls === 1 && lastMessages.length === 2 && lastMessages[0].role === 'system' && lastMessages[0].content.includes('Ordinary (8–12): most people')
    && lastMessages[1].content.includes('Character: Ines Arden.') && lastMessages[1].content.includes('Who they are: A clerk at the Office.') && lastMessages[1].content.includes('Ines looks up from the ledger.')
    && s1.tierId === 'ordinary' && s1.scores.dex === 12 && s1.scores.str === 9 && s1.reasons.cha === 'quick to smile', JSON.stringify({ s1, user: lastMessages && lastMessages[1].content }));
S.__setSuggestTransport(async () => 'I would rather not.');
let threw = null;
try { await S.suggestSheet({ name: 'Ines Arden' }); } catch (e) { threw = e; }
check('an unreadable answer throws', threw && /could not be read/.test(threw.message));

// ── 2. Applying ──
const applied = S.applySuggestion('Ines Arden', false, s1, { suggested: true });
const stored = D.getSheet(extensionSettings, 'Ines Arden', false, defs);
const profs = D.getProficiencies(extensionSettings, 'Ines Arden', false);
check('applySuggestion stores the scores, the tier and the suggested mark', stored.dex === 12 && stored.str === 9 && stored.cha === 12 && D.getTier(profs) === 'ordinary' && D.isSuggested(profs) && applied.proficiencies.includes('tier:ordinary'), JSON.stringify({ stored, profs }));
S.applySuggestion('Ines Arden', false, { tierId: 'trained', scores: { cha: 14 } }, { suggested: false });
const profs2 = D.getProficiencies(extensionSettings, 'Ines Arden', false);
check('...a second application replaces the tier, keeps untouched scores and clears the mark when the owner is looking', D.getTier(profs2) === 'trained' && !D.isSuggested(profs2) && D.getSheet(extensionSettings, 'Ines Arden', false, defs).cha === 14 && D.getSheet(extensionSettings, 'Ines Arden', false, defs).dex === 12);

// ── 3. The automatic trigger ──
extensionSettings.characterAttributes = {};
S.__setSuggestTransport(async (messages) => { calls++; lastMessages = messages; return '{"tier": "Legend", "scores": {"Charisma": 28, "Wisdom": 20}}'; });
S.__resetSuggestions({ timeout: 2000 });
calls = 0;
lastGeneratedData.characterThoughts = JSON.stringify({ characters: [{ name: 'Ines Arden', thoughts: 'x' }, { name: 'Jordan', thoughts: 'y' }, { name: 'Silvy', thoughts: 'z' }] });
check('the switch is off by default: nothing is asked', await S.maybeAutoSuggestSheets() === 0 && calls === 0);
extensionSettings.attributes.suggestNewSheets = true;
D.setSheet(extensionSettings, 'Silvy', false, { dex: 14 });
const filled = await S.maybeAutoSuggestSheets();
check('on: one call for the one face with no sheet; the persona and a sheeted character are skipped; the sheet is stored with the mark',
    filled === 1 && calls === 1 && lastMessages[1].content.includes('Character: Ines Arden.')
    && D.getSheet(extensionSettings, 'Ines Arden', false, defs).cha === 28 && D.getTier(D.getProficiencies(extensionSettings, 'Ines Arden', false)) === 'legend' && D.isSuggested(D.getProficiencies(extensionSettings, 'Ines Arden', false))
    && D.getSheet(extensionSettings, 'Jordan', true, defs).cha === 10 && D.getSheet(extensionSettings, 'Silvy', false, defs).cha === 10, JSON.stringify(extensionSettings.characterAttributes));
check('...and the same face is not asked about again this session', await S.maybeAutoSuggestSheets() === 0 && calls === 1);
extensionSettings.characterAttributes = {};
D.setSheet(extensionSettings, 'Silvy', false, { dex: 14 });
D.setSheet(extensionSettings, 'Ines Arden', false, {}, null, ['tier:ordinary']);
S.__resetSuggestions({ timeout: 2000 });
check('a character with a tier but no numbers is left alone', await S.maybeAutoSuggestSheets() === 0 && calls === 1);
extensionSettings.characterAttributes = {};
D.setSheet(extensionSettings, 'Silvy', false, { dex: 14 });
S.__setSuggestTransport(async () => { calls++; throw new Error('offline'); });
S.__resetSuggestions({ timeout: 2000 });
check('a failed call fills nothing, throws nothing, and is not retried this session', await S.maybeAutoSuggestSheets() === 0 && calls === 2 && await S.maybeAutoSuggestSheets() === 0 && calls === 2 && Object.keys(extensionSettings.characterAttributes).join() === 'npc:Silvy');
extensionSettings.attributes.enabled = false;
S.__resetSuggestions({ timeout: 2000 });
check('with attributes off, nothing is asked', await S.maybeAutoSuggestSheets() === 0 && calls === 2);

console.log(failures === 0 ? '\nAll sheet suggestion checks pass' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
