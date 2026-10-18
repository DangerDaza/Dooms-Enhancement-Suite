#!/usr/bin/env node
/**
 * Cut to a quest, in the chat: arming the cut, the reply asked for, the
 * instruction that rides the next generation with the facts of now, the
 * cut ending with the player's next message, the chat switch.
 *
 * Usage:  node tools/quest-cut-flow-test.mjs     (from the repo root)
 * Exit:   0 = pass, 1 = failure
 *
 * Same sandbox as tools/dice-test.mjs, with the slash-command runner made real.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { buildSandbox } from './sandbox.mjs';

const { SANDBOX, DES } = buildSandbox();
if (!existsSync(`${DES}/src/systems/features/questCut.js`)) {
    console.error('FAIL: sandbox missing after load-check — cannot run.');
    process.exit(1);
}

globalThis.__DES_CHAT__ = [];
globalThis.__DES_CHAT_METADATA__ = {};
globalThis.__DES_SLASH_CALLS__ = [];
const scriptStub = `${SANDBOX}/script.js`;
writeFileSync(scriptStub, readFileSync(scriptStub, 'utf8')
    .replace('export const chat_metadata = anything;', 'export const chat_metadata = globalThis.__DES_CHAT_METADATA__;')
    .replace('export const chat = anything;', 'export const chat = globalThis.__DES_CHAT__;'));
const extStub = `${SANDBOX}/scripts/extensions.js`;
writeFileSync(extStub, readFileSync(extStub, 'utf8')
    .replace('export const getContext = anything;', 'export const getContext = () => globalThis.__DES_CTX__;'));
const slashStub = `${SANDBOX}/scripts/slash-commands.js`;
writeFileSync(slashStub, readFileSync(slashStub, 'utf8')
    .replace('export const executeSlashCommandsOnChatInput = anything;', 'export const executeSlashCommandsOnChatInput = async (cmd, opts) => { globalThis.__DES_SLASH_CALLS__.push([cmd, opts]); if (globalThis.__DES_SLASH_FAIL__) throw new Error(\'no\'); return {}; };'));

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

const meta = globalThis.__DES_CHAT_METADATA__;
const calls = globalThis.__DES_SLASH_CALLS__;
const state = await import(`${DES}/src/core/state.js`);
const { extensionSettings, lastGeneratedData, committedTrackerData } = state;
const qc = await import(`${DES}/src/systems/features/questCut.js`);
const inj = await import(`${DES}/src/systems/generation/injector.js`);
const chat = globalThis.__DES_CHAT__;

let failures = 0;
const check = (label, cond, extra = '') => {
    if (cond) { console.log(`pass  ${label}`); }
    else { console.error(`FAIL  ${label}${extra ? '\n      ' + extra : ''}`); failures++; }
};
const resetMeta = () => { for (const k of Object.keys(meta)) delete meta[k]; };

extensionSettings.enabled = true;
extensionSettings.userCharacters = {};
extensionSettings.quests = { main: "Sole's key: twelve crowns", optional: ['Feed the cat', 'None', { value: 'Fix the roof' }] };
lastGeneratedData.infoBox = '{"date":"Tuesday, 3 Harvest","time":{"start":"dusk","end":"night"},"location":{"value":"The Knife Wall"}}';
committedTrackerData.infoBox = null;

console.log('\n§1 nothing armed');
check('no cut, no instruction', qc.getPendingQuestCut() === null && qc.buildQuestCutForGeneration() === '');
check('cancelling nothing is fine', (qc.cancelQuestCut(), qc.getPendingQuestCut() === null));

console.log('\n§2 the cut');
const ok = await qc.startQuestCut({ quest: "Sole's key: twelve crowns" });
check('arming asks SillyTavern for a reply with no message of the player\'s', ok === true && calls.length === 1 && calls[0][0] === '/trigger', JSON.stringify(calls));
check('the cut is kept on the chat', !!meta.dooms_quest_cut && meta.dooms_quest_cut.quest === "Sole's key: twelve crowns" && meta.dooms_quest_cut.when === '' && qc.getPendingQuestCut().quest === "Sole's key: twelve crowns");
let text = qc.buildQuestCutForGeneration();
check('the instruction names the player, the quest and the facts of now', text.startsWith('[CUT TO A QUEST: Jordan has chosen to skip ahead to this quest: "Sole\'s key: twelve crowns".') && text.includes('from now (Tuesday, 3 Harvest, dusk → night, at The Knife Wall)'), text.slice(0, 200));
check('the other quests ride without None and without the quest itself', text.includes('The other quests (Feed the cat; Fix the roof) stay as they are'), text);
check('the AI judges the time when none is given', text.includes('yours to judge from the quest'));
check('a regenerate or swipe of the montage keeps the cut', qc.buildQuestCutForGeneration() === text);
lastGeneratedData.infoBox = '{"date":"Friday","time":"dawn","location":"The Sunken Chapel"}';
check('...anchored at the now the cut was armed from, not where the first montage landed', qc.buildQuestCutForGeneration().includes('from now (Tuesday, 3 Harvest, dusk → night, at The Knife Wall)') && !qc.buildQuestCutForGeneration().includes('Sunken Chapel'));
lastGeneratedData.infoBox = '{"date":"Tuesday, 3 Harvest","time":{"start":"dusk","end":"night"},"location":{"value":"The Knife Wall"}}';
extensionSettings.enabled = false;
check('DES off: nothing rides', qc.buildQuestCutForGeneration() === '');
extensionSettings.enabled = true;
qc.onQuestCutMessageSent();
check("the player's next message ends the cut", qc.getPendingQuestCut() === null && qc.buildQuestCutForGeneration() === '' && !meta.dooms_quest_cut);

console.log('\n§3 with a when, and the facts from the committed block');
lastGeneratedData.infoBox = null;
committedTrackerData.infoBox = 'Date: Wednesday\nTime: dawn\nLocation: The road south';
await qc.startQuestCut({ quest: 'Fix the roof', when: ' after the thaw. ' });
text = qc.buildQuestCutForGeneration();
check('the when replaces the judging clause and is cleaned', text.includes('It begins after the thaw.') && !text.includes('yours to judge') && meta.dooms_quest_cut.when === 'after the thaw');
check('the facts come from the committed block when nothing fresher exists', text.includes('from now (Wednesday, dawn, at The road south)'), text);
check('the quest itself is left out of the others', text.includes("The other quests (Sole's key: twelve crowns; Feed the cat) stay") || text.includes('The other quests (Feed the cat') , text);
qc.cancelQuestCut();
check('cancel disarms', qc.getPendingQuestCut() === null && qc.buildQuestCutForGeneration() === '');

console.log('\n§4 edge cases');
check('no quest, no cut', (await qc.startQuestCut({ quest: '   ' })) === false && qc.getPendingQuestCut() === null && calls.length === 2);
globalThis.__DES_SLASH_FAIL__ = true;
check('a failed trigger disarms and says so', (await qc.startQuestCut({ quest: 'Q' })) === false && qc.getPendingQuestCut() === null);
globalThis.__DES_SLASH_FAIL__ = false;
await qc.startQuestCut({ quest: 'Q' });
check('armed again', qc.getPendingQuestCut().quest === 'Q');
resetMeta();
check('another chat (its metadata) has no cut', qc.getPendingQuestCut() === null && qc.buildQuestCutForGeneration() === '');
meta.dooms_quest_cut = { quest: 'From a reload', when: '', at: 1 };
check('a cut saved with the chat survives a reload', qc.buildQuestCutForGeneration().includes('"From a reload"'));
meta.dooms_quest_cut = { junk: true };
check('junk in the slot is no cut', qc.getPendingQuestCut() === null);

console.log('\n§5 the together-mode commit around a cut');
{
    extensionSettings.generationMode = 'together';
    const r1 = '{"date":"Tuesday","time":"dusk","location":"The Knife Wall"}';
    const m = '{"date":"Friday","time":"dawn","location":"The Sunken Chapel"}';
    chat.length = 0;
    chat.push({ is_user: true, mes: 'I look around.', extra: {} });
    chat.push({ is_user: false, mes: 'The wall rises.', swipe_id: 0, swipes: ['The wall rises.'], extra: {} });
    lastGeneratedData.infoBox = r1;
    committedTrackerData.infoBox = null;
    await inj.onGenerationStarted('normal', {}, false);          // /trigger: the cut's generation
    check("the cut's generation commits the previous reply's block", committedTrackerData.infoBox === r1);
    chat.push({ is_user: false, mes: 'Three days pass…', swipe_id: 0, swipes: ['Three days pass…'], extra: {} });
    lastGeneratedData.infoBox = m;
    await inj.onGenerationStarted(undefined, {}, false);         // the player's first message after the montage
    check("the player's first message after the montage commits the montage's block, though two replies sit in a row", committedTrackerData.infoBox === m, String(committedTrackerData.infoBox));
    chat.push({ is_user: true, mes: 'I push the door.', extra: {} });
    chat.push({ is_user: false, mes: 'It gives.', swipe_id: 0, swipes: ['It gives.'], extra: {} });
    lastGeneratedData.infoBox = '{"date":"Friday","time":"noon","location":"Inside"}';
    await inj.onGenerationStarted('swipe', {}, false);
    check('a swipe commits nothing', committedTrackerData.infoBox === m);
    await inj.onGenerationStarted('regenerate', {}, false);
    check('a regenerate commits nothing', committedTrackerData.infoBox === m);
    await inj.onGenerationStarted('impersonate', {}, false);
    await inj.onGenerationStarted('quiet', {}, false);
    check('an impersonation or a quiet prompt commits nothing', committedTrackerData.infoBox === m);
    await inj.onGenerationStarted(undefined, {}, false);
    check('the next send commits the latest reply', committedTrackerData.infoBox === '{"date":"Friday","time":"noon","location":"Inside"}');
    await inj.onGenerationStarted(undefined, {}, false);
    check('the same length is not committed twice', committedTrackerData.infoBox === '{"date":"Friday","time":"noon","location":"Inside"}');
}

console.log(`\n${failures === 0 ? 'All quest cut flow checks pass' : `${failures} FAILURE(S)`}`);
process.exit(failures === 0 ? 0 : 1);
