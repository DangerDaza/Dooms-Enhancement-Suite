#!/usr/bin/env node
/**
 * Dice test (Project Short Fuse, Phase 2): the roll lifecycle in play.
 * Tag a check, get the game master's ruling, roll on send, the roll on the
 * message, the verdict for the next generation, the attributes line that
 * rides with it, removal, and the chat switch.
 *
 * Usage:  node tools/dice-test.mjs     (from the repo root)
 * Exit:   0 = pass, 1 = failure
 *
 * Same sandbox as tools/vitals-test.mjs: load-check's stubs with chat,
 * chat_metadata and getContext() made real. The game master call is
 * replaced through the module's test hook.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const SANDBOX = '/tmp/des-load-check';
const DES = `${SANDBOX}/scripts/extensions/third-party/DES`;

execFileSync(process.execPath, ['tools/load-check.mjs'], { stdio: 'pipe' });
if (!existsSync(`${DES}/src/systems/features/diceRolls.js`)) {
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
const { extensionSettings } = state;
const D = await import(`${DES}/src/utils/d20.js`);
const dice = await import(`${DES}/src/systems/features/diceRolls.js`);
const pb = await import(`${DES}/src/systems/generation/promptBuilder.js`);

let failures = 0;
const check = (label, cond, extra = '') => {
    if (cond) { console.log(`pass  ${label}`); }
    else { console.error(`FAIL  ${label}${extra ? '\n      ' + extra : ''}`); failures++; }
};
const user = (mes) => ({ is_user: true, mes, extra: {} });
const ai = (mes) => ({ is_user: false, mes, swipe_id: 0, swipes: [mes], extra: {} });

extensionSettings.enabled = true;
extensionSettings.generationMode = 'together';
extensionSettings.userCharacters = {};
extensionSettings.attributes = { ...D.defaultAttributesConfig(), enabled: true };
extensionSettings.characterAttributes = {};
D.setSheet(extensionSettings, 'Jordan', true, { str: 15, cha: 8 });

// ── 1. Who ──
check('the persona resolves to SillyTavern\'s name without a Workshop character', dice.resolvePersonaName() === 'Jordan');
extensionSettings.userCharacters = { Kael: { linkedPersona: 'kael.png' } };
globalThis.__DES_CTX__.user_avatar = 'kael.png';
check('...and to the linked Workshop character when there is one', dice.resolvePersonaName() === 'Kael');
globalThis.__DES_CTX__.user_avatar = '';
extensionSettings.userCharacters = {};
check('getPersonaSheet reads the stored scores', (() => { const p = dice.getPersonaSheet(); return p && p.name === 'Jordan' && p.sheet.str === 15 && p.sheet.cha === 8 && p.sheet.dex === 10 && !p.isDefault; })());

// ── 2. Tag ──
let calls = 0;
let lastMessages = null;
const gm = async (messages) => { calls++; lastMessages = messages; return '{"difficulty": "hard", "advantage": "disadvantage", "reason": "The wall is slick with rain."}'; };
dice.__setDiceTransport(gm);
D.setSheet(extensionSettings, 'Jordan', true, { str: 15, cha: 8 }, null, [D.skillKey('str', 'Athletics')]);
chat.length = 0;
chat.push(ai('The wall rises before you.'));
let pending = dice.tagCheck({ attributeId: 'str', skill: 'athletics', context: 'climb the wall' });
check('tagCheck records the attribute, the skill (any case), the score, the proficiency and the context', pending && pending.attribute === 'Strength' && pending.abbr === 'STR' && pending.skill === 'Athletics' && pending.score === 15 && pending.proficient === true && pending.prof === 2 && pending.context === 'climb the wall');
check('...synchronously, with nothing asked yet', calls === 0 && pending.rating === false && dice.getPendingCheck() === pending);
check('an unknown skill is dropped', dice.tagCheck({ attributeId: 'str', skill: 'Flying' }).skill === '');
check('a skill the character is not proficient in adds nothing', (() => { const p = dice.tagCheck({ attributeId: 'cha', skill: 'Persuasion' }); return p.skill === 'Persuasion' && p.proficient === false && p.prof === 0; })());
check('a skill may pair with another attribute and keeps its proficiency (Constitution (Athletics))', (() => { const p = dice.tagCheck({ attributeId: 'con', skill: 'Athletics' }); return p.attribute === 'Constitution' && p.skill === 'Athletics' && p.skillAttributeId === 'str' && p.proficient === true && p.prof === 2 && p.score === 10; })());
check('override is refused while the setting is off', dice.tagCheck({ attributeId: 'str', skill: 'Athletics', context: 'climb the wall', override: { difficultyId: 'easy' } }).override === null && dice.overrideRuling({ difficultyId: 'easy' }) === null);
extensionSettings.attributes.allowOverride = true;
check('override is kept once the setting is on', (() => { const p = dice.overrideRuling({ difficultyId: 'easy', advantage: 'adv' }); return p && p.override.dc === 10 && p.override.advantage === 'adv' && p.override.source === 'override'; })());
check('...and cleared with nothing', dice.overrideRuling(null).override === null);
extensionSettings.attributes.allowOverride = false;

// ── 3. Rule and roll on send ──
chat.push(user('I climb the wall.'));
await dice.onDiceMessageSent();
const roll = chat[1].extra.dooms_roll;
check('the game master is asked once, at send, and sees the context, the skill, the message and the scene', calls === 1 && lastMessages[1].content.includes('"climb the wall", using Strength (Athletics)') && lastMessages[1].content.includes('Their message: "I climb the wall."') && lastMessages[1].content.includes('AI: The wall rises'), lastMessages && lastMessages[1].content);
check('...and not the message being rated as part of the scene', !lastMessages[1].content.includes('Jordan: I climb the wall'));
check('the roll is written to the sent message with the ruling', roll && roll.attribute === 'Strength' && roll.skill === 'Athletics' && roll.score === 15 && roll.mod === 2 && roll.prof === 2 && roll.dc === 20 && roll.difficultyId === 'hard' && roll.advantage === 'dis' && roll.rolls.length === 2 && roll.rulingSource === 'ai' && roll.reason === 'The wall is slick with rain.');
check('...and the arithmetic holds', roll.total === roll.kept + roll.mod + roll.prof && (roll.critical ? true : roll.success === (roll.total >= roll.dc)));
check('the pending check is consumed', dice.getPendingCheck() === null);
check('onDiceMessageSent with nothing pending is a no-op', (await dice.onDiceMessageSent(), chat[1].extra.dooms_roll === roll));

// ── 4. The verdict for the next generation, and the box on the reply ──
let verdict = dice.buildDiceVerdictForGeneration();
check('a fresh reply to the rolled message gets the verdict',
    verdict.includes('\n[DICE: Jordan attempts "climb the wall". Strength (Athletics) check: d20 = ') && verdict.includes('+2 (proficient in Athletics)') && verdict.includes('vs DC 20 (Hard), because The wall is slick with rain') && verdict.includes('This outcome is final'), verdict);
chat.push(ai('You scramble up.'));
check('a swipe or regenerate of that reply gets the same verdict', dice.buildDiceVerdictForGeneration() === verdict);
check('the reply shows the roll of the message it answers', dice.rollsForReply(2).length === 1 && dice.rollsForReply(2)[0] === roll && dice.rollsForReply(1).length === 0 && dice.rollsForReply(0).length === 0);
chat.push(ai('(a second reply, as in a group)'));
check('every reply before the next player message shows it', dice.rollsForReply(3)[0] === roll);
check('with a roll, the attributes line rides in the dice slot ahead of the verdict and lists the proficiency', verdict.indexOf('ATTRIBUTES (D&D scale') === 0 && verdict.includes('Jordan (player): STR 15 (+2), CHA 8 (-1); proficient in Athletics (+2)') && verdict.indexOf('ATTRIBUTES') < verdict.indexOf('[DICE:'), verdict);
check('...and not in the tracker block, which is built before the sent message exists', !pb.generateTrackerInstructions(false, false).includes('ATTRIBUTES'));
extensionSettings.attributes.sendToAI = 'always';
check('always: the tracker block carries the line and the dice slot only the verdict', pb.generateTrackerInstructions(false, false).includes('Jordan (player): STR 15 (+2)') && dice.buildDiceVerdictForGeneration().startsWith('[DICE:'));
extensionSettings.attributes.sendToAI = 'withRoll';
chat.push(user('I walk on.'));
chat.push(ai('The road is quiet.'));
check('a later message without a roll gets no verdict and no box', dice.buildDiceVerdictForGeneration() === '' && dice.rollsForReply(5).length === 0);
check('...and no attributes line', !pb.generateTrackerInstructions(false, false).includes('ATTRIBUTES'));
extensionSettings.attributes.enabled = false;
chat.length = 3;
check('attributes off: no verdict even with a roll on the message', dice.buildDiceVerdictForGeneration() === '');
extensionSettings.attributes.enabled = true;

// ── 4b. A borrowed skill at send: the label, the bonus and what the game master is told ──
chat.length = 0;
chat.push(ai('The strait is wide and cold.'));
chat.push(user('I swim for the mainland.'));
calls = 0;
dice.tagCheck({ attributeId: 'con', skill: 'Athletics', context: 'swim to the mainland' });
await dice.onDiceMessageSent();
const swim = chat[1].extra.dooms_roll;
check('the roll is a Constitution (Athletics) check with the Athletics proficiency', swim && swim.attribute === 'Constitution' && swim.skill === 'Athletics' && swim.skillAttributeId === 'str' && swim.prof === 2 && swim.score === 10 && swim.mod === 0 && swim.total === swim.kept + 2);
check('the game master is told the skill is borrowed', calls === 1 && lastMessages[1].content.includes('using Constitution (Athletics, normally a Strength skill)'), lastMessages && lastMessages[1].content);
check('the verdict and the short form read Constitution (Athletics)', dice.buildDiceVerdictForGeneration().includes('Constitution (Athletics) check: d20 = ') && D.formatRollShort(swim).startsWith('Constitution (Athletics) check · d20 '));

// ── 5. A fixed ruling skips the game master; a discard mid-ruling rolls nothing ──
chat.length = 0;
chat.push(ai('A guard blocks the gate.'));
extensionSettings.attributes.allowOverride = true;
dice.tagCheck({ attributeId: 'cha', skill: 'Persuasion', context: 'talk past the guard', override: { difficultyId: 'easy', advantage: 'adv' } });
extensionSettings.attributes.allowOverride = false;
calls = 0;
chat.push(user('I try to talk my way past.'));
await dice.onDiceMessageSent();
check('with the ruling fixed by the player, nobody is asked and the roll uses it', calls === 0 && chat[1].extra.dooms_roll && chat[1].extra.dooms_roll.dc === 10 && chat[1].extra.dooms_roll.advantage === 'adv' && chat[1].extra.dooms_roll.rulingSource === 'override' && chat[1].extra.dooms_roll.skill === 'Persuasion');
check('a check discarded while the game master thinks rolls nothing', await (async () => {
    dice.__setDiceTransport(async () => { await new Promise(r => setTimeout(r, 20)); return '{"difficulty":"easy"}'; });
    dice.tagCheck({ attributeId: 'str', context: 'x' });
    chat.push(ai('The guard squints.'));
    chat.push(user('I push past.'));
    const p = dice.onDiceMessageSent();
    const wasRating = !!dice.getPendingCheck() && dice.getPendingCheck().rating === true;
    dice.clearPendingCheck({ silent: true });
    await p;
    return wasRating && chat[3].extra.dooms_roll === undefined && dice.getPendingCheck() === null;
})());
dice.__setDiceTransport(gm);

// ── 6. Fallbacks ──
const sendWith = async (transport) => {
    dice.__setDiceTransport(transport);
    dice.tagCheck({ attributeId: 'str', context: 'x' });
    chat.push(ai('...'));
    chat.push(user('I try.'));
    await dice.onDiceMessageSent();
    return chat[chat.length - 1].extra.dooms_roll;
};
let r = await sendWith(async () => { throw new Error('offline'); });
check('a failed rating call falls back to the default difficulty and says so', r && r.difficultyId === 'medium' && r.dc === 15 && r.rulingSource === 'default' && r.rulingError === 'offline');
r = await sendWith(async () => 'Hmm, let me think about that.');
check('an unreadable answer falls back too', r.rulingSource === 'default' && r.rulingError === 'unreadable');
dice.__setRulingTimeout(30);
r = await sendWith(() => new Promise(res => setTimeout(() => res('{"difficulty":"easy"}'), 200)));
check('a game master who takes too long is not waited for', r.rulingSource === 'default' && r.rulingError === 'timeout');
dice.__setRulingTimeout(20000);
calls = 0;
extensionSettings.attributes.aiRatesDifficulty = false;
r = await sendWith(async () => { calls++; return '{"difficulty":"hard"}'; });
check('with the AI not asked, no call is made and the default stands', calls === 0 && r.rulingSource === 'default' && !r.rulingError);
extensionSettings.attributes.aiRatesDifficulty = true;
dice.__setDiceTransport(gm);
check('a second tag replaces the first', (() => { dice.tagCheck({ attributeId: 'str', context: 'first' }); dice.tagCheck({ attributeId: 'dex', skill: 'Stealth', context: 'second' }); const p = dice.getPendingCheck(); return p && p.context === 'second' && p.attribute === 'Dexterity' && p.skill === 'Stealth'; })());
dice.clearPendingCheck();
check('clearPendingCheck', dice.getPendingCheck() === null);
check('tagCheck with attributes off gives null', (extensionSettings.attributes.enabled = false, dice.tagCheck({ attributeId: 'str' }) === null));
extensionSettings.attributes.enabled = true;

// ── 7. The chat switch ──
dice.tagCheck({ attributeId: 'str', context: 'x' });
dice.onDiceChatChanged();
check('a chat switch drops the pending check', dice.getPendingCheck() === null);

// ── 8. The game master's calls at the end of a reply ──
chat.length = 0;
chat.push(ai('The door is locked.'));
chat.push(user('I look for another way in.'));
chat.push(ai('A window above, shutters rotten.\n\n[CHECK: Dexterity (Acrobatics) | Hard | the ledge is narrow]'));
dice.onDiceReplyRendered(2);
pending = dice.getPendingCheck();
check('a player call on the chat\'s last reply becomes the pending check with the game master\'s ruling', pending && pending.calledBy === 'gm' && pending.fromIndex === 2 && pending.attribute === 'Dexterity' && pending.skill === 'Acrobatics' && pending.gmRuling && pending.gmRuling.dc === 20 && pending.gmRuling.source === 'gm' && pending.gmRuling.reason === 'the ledge is narrow', JSON.stringify(pending));
check('...and is kept on the reply for its swipe', !!chat[2].extra.dooms_gm_calls && chat[2].extra.dooms_gm_calls[0].kind === 'player');
calls = 0;
chat.push(user('I climb to the window.'));
await dice.onDiceMessageSent();
const gmRoll = chat[3].extra.dooms_roll;
check('sending rolls it against the game master\'s DC without asking again', calls === 0 && gmRoll && gmRoll.dc === 20 && gmRoll.rulingSource === 'gm' && gmRoll.calledBy === 'gm' && gmRoll.skill === 'Acrobatics');
check('the verdict says the game master called for it', dice.buildDiceVerdictForGeneration().includes('[DICE: Jordan attempts the action in their last message, on a check you called for. Dexterity (Acrobatics) check:'), dice.buildDiceVerdictForGeneration());
chat.length = 3;
chat[2].mes = 'A window above, shutters rotten.';
dice.onDiceReplyRendered(2);
check('a swipe without the call withdraws it', dice.getPendingCheck() === null && chat[2].extra.dooms_gm_calls === undefined);
dice.tagCheck({ attributeId: 'str', context: 'force the door' });
chat[2].mes = 'x\n[CHECK: Dexterity (Acrobatics) | Hard | y]';
dice.onDiceReplyRendered(2);
check('a check the player tagged themselves is not trampled by a call', dice.getPendingCheck().calledBy === 'player' && dice.getPendingCheck().attribute === 'Strength');
dice.clearPendingCheck({ silent: true });
D.setSheet(extensionSettings, 'Guard', false, { wis: 14 }, null, [D.skillKey('wis', 'Perception')]);
chat.length = 0;
chat.push(user('I slip past the guard.'));
chat.push(ai('The guard yawns.\n\n[CHECK: Guard: Wisdom (Perception) | Medium | the corridor is dark]'));
dice.onDiceReplyRendered(1);
const npcEntry = chat[1].extra.dooms_gm_calls && chat[1].extra.dooms_gm_calls[0];
check('an NPC call is rolled at once on the NPC\'s sheet and kept on the reply', !!npcEntry && npcEntry.kind === 'npc' && !!npcEntry.roll && npcEntry.roll.who === 'Guard' && npcEntry.roll.isUser === false && npcEntry.roll.score === 14 && npcEntry.roll.mod === 2 && npcEntry.roll.prof === 2 && npcEntry.roll.dc === 15 && dice.getPendingCheck() === null, JSON.stringify(npcEntry));
const npcRoll = npcEntry.roll;
dice.onDiceReplyRendered(1);
check('rendering the same reply again keeps the roll', chat[1].extra.dooms_gm_calls[0].roll === npcRoll);
chat.push(user('I hold my breath.'));
verdict = dice.buildDiceVerdictForGeneration();
check('the next generation gets the NPC\'s verdict, framed as the game master\'s call', verdict.includes('[DICE: Guard, on a check you called for. Wisdom (Perception) check: d20 = ') && verdict.includes('+2 (WIS 14), +2 (proficient in Perception)'), verdict);
dice.tagCheck({ attributeId: 'dex', skill: 'Stealth', context: 'sneak' });
await dice.onDiceMessageSent();
verdict = dice.buildDiceVerdictForGeneration();
check('...and both verdicts when the player rolled too, the NPC\'s first', verdict.indexOf('[DICE: Guard') < verdict.indexOf('[DICE: Jordan attempts "sneak"') && verdict.indexOf('[DICE: Guard') >= 0);
extensionSettings.attributes.aiCalls.npcs = false;
chat.push(ai('x [CHECK: Guard: Wisdom (Perception) | Medium | y]'));
dice.onDiceReplyRendered(3);
check('with NPC calls off, a named call is read as the player\'s', !!dice.getPendingCheck() && dice.getPendingCheck().isUser === true && dice.getPendingCheck().calledBy === 'gm');
extensionSettings.attributes.aiCalls.npcs = true;
dice.clearPendingCheck({ silent: true });
extensionSettings.attributes.aiCalls.endOfReply = false;
chat.push(ai('x [CHECK: STR | Easy]'));
dice.onDiceReplyRendered(4);
check('with the end-of-reply way off, a tag is ignored', dice.getPendingCheck() === null && chat[4].extra.dooms_gm_calls === undefined);
extensionSettings.attributes.aiCalls.endOfReply = true;
chat.push(ai('Last word.\n[CHECK: Charisma (Persuasion) | Easy | he likes you]'));
dice.onDiceChatChanged();
check('a chat switch restores the call waiting on the chat\'s last reply', !!dice.getPendingCheck() && dice.getPendingCheck().calledBy === 'gm' && dice.getPendingCheck().attribute === 'Charisma');
dice.clearPendingCheck({ silent: true });

// ── 9. The dice tool ──
chat.length = 0;
chat.push(ai('The bridge sways.'));
chat.push(user('I cross.'));
const toolText = dice.diceToolAction({ attribute: 'Dexterity', skill: 'Acrobatics', difficulty: 'Hard', advantage: 'none', reason: 'the planks are wet' });
const memo = chat[1].extra.dooms_tool_rolls;
const memoKeys = Object.keys(memo || {});
check('the tool rolls on the player\'s sheet and answers with the verdict', toolText.startsWith('[DICE: Jordan attempts the action in their last message, on a check you called for. Dexterity (Acrobatics) check: d20 = ') && toolText.includes('vs DC 20 (Hard), because the planks are wet') && memoKeys.length === 1 && memo[memoKeys[0]].calledBy === 'tool', toolText);
check('the same call for the same message rolls once', dice.diceToolAction({ attribute: 'Dexterity', skill: 'Acrobatics', difficulty: 'Hard', reason: 'again' }) === toolText && Object.keys(chat[1].extra.dooms_tool_rolls).length === 1);
const npcText = dice.diceToolAction({ who: 'Guard', attribute: 'Wisdom', skill: 'Perception', difficulty: 'Medium', reason: 'dark' });
check('a named roller uses the NPC\'s sheet', npcText.startsWith('[DICE: Guard, on a check you called for. Wisdom (Perception) check:') && npcText.includes('(WIS 14), +2 (proficient in Perception)'), npcText);
check('an unknown attribute rolls nothing and says which exist', dice.diceToolAction({ attribute: 'Luck', difficulty: 'Hard', reason: 'x' }).startsWith('No check was rolled') && Object.keys(chat[1].extra.dooms_tool_rolls).length === 2);
const invocations = [
    { name: 'dooms_roll_check', parameters: JSON.stringify({ attribute: 'Dexterity', skill: 'Acrobatics', difficulty: 'Hard', reason: 'the planks are wet' }), result: toolText },
    { name: 'other_tool', parameters: '{}', result: 'x' },
    { name: 'dooms_roll_check', parameters: { who: 'Guard', attribute: 'Wisdom', skill: 'Perception', difficulty: 'Medium', reason: 'dark' }, result: npcText },
    { name: 'dooms_roll_check', parameters: 'not json', result: 'x' },
];
dice.onDiceToolCallsPerformed(invocations);
check('each invocation gets its roll, matched by its arguments', !!invocations[0].dooms_roll && invocations[0].dooms_roll.attribute === 'Dexterity' && invocations[1].dooms_roll === undefined && !!invocations[2].dooms_roll && invocations[2].dooms_roll.who === 'Guard' && invocations[3].dooms_roll === undefined);
chat.push({ is_user: false, is_system: true, mes: 'tool', extra: { tool_invocations: invocations } });
chat.push(ai('You make it across.'));
const shown = dice.rollsForReply(3);
check('the reply after the tool message shows the tool rolls', shown.length === 2 && shown[0].attribute === 'Dexterity' && shown[1].who === 'Guard');
let rules = dice.buildDiceRulesForGeneration();
check('without tool calling, the rules are the end-of-reply form', rules.startsWith('[CHECKS:') && rules.includes('[CHECK: Dexterity (Stealth) | Hard | the guards are alert]'), rules);
globalThis.__DES_CTX__.isToolCallingSupported = () => true;
rules = dice.buildDiceRulesForGeneration();
check('with tool calling, the rules name the tool', rules.includes('call the dooms_roll_check tool'));
extensionSettings.attributes.aiCalls.tool = false;
check('...unless the tool way is off', dice.buildDiceRulesForGeneration().includes('[CHECK: Dexterity (Stealth)'));
extensionSettings.attributes.aiCalls.tool = true;
extensionSettings.attributes.aiCalls.enabled = false;
check('with calls off, no rules', dice.buildDiceRulesForGeneration() === '');
extensionSettings.attributes.aiCalls.enabled = true;
delete globalThis.__DES_CTX__.isToolCallingSupported;
check('registerDiceTool hands SillyTavern the tool', dice.registerDiceTool() === true);

const settle = await Promise.resolve();
console.log(failures === 0 ? '\nAll dice checks pass' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
