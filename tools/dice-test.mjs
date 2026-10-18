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
check('the verdict ends by saying the tracker block is still required', verdict.trimEnd().endsWith(`[${dice.STILL_REQUIRED}]`) && verdict.indexOf('[DICE:') < verdict.indexOf('[This decides only'));
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
check('the tool rolls on the player\'s sheet and answers with the verdict, then says the block is still required', toolText.startsWith('[DICE: Jordan attempts the action in their last message, on a check you called for. Dexterity (Acrobatics) check: d20 = ') && toolText.includes('vs DC 20 (Hard), because the planks are wet') && toolText.endsWith(dice.STILL_REQUIRED) && memoKeys.length === 1 && memo[memoKeys[0]].calledBy === 'tool', toolText);
check('the same call for the same message rolls once', dice.diceToolAction({ attribute: 'Dexterity', skill: 'Acrobatics', difficulty: 'Hard', reason: 'again' }) === toolText && Object.keys(chat[1].extra.dooms_tool_rolls).length === 1);
const npcText = dice.diceToolAction({ who: 'Guard', attribute: 'Wisdom', skill: 'Perception', difficulty: 'Medium', reason: 'dark' });
check('a named roller uses the NPC\'s sheet', npcText.startsWith('[DICE: Guard, on a check you called for. Wisdom (Perception) check:') && npcText.includes('(WIS 14), +2 (proficient in Perception)'), npcText);
check('an unknown attribute rolls nothing and says which exist', dice.diceToolAction({ attribute: 'Luck', difficulty: 'Hard', reason: 'x' }).startsWith('Nothing was rolled') && Object.keys(chat[1].extra.dooms_tool_rolls).length === 2);
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

// ── 10. Saving throws and opposed actions (Phase 4a, §10) ──
D.setSheet(extensionSettings, 'Jordan', true, { str: 15, cha: 8 }, null, [D.skillKey('str', 'Athletics')]);
D.setSheet(extensionSettings, 'Guard', false, { wis: 14 }, null, [D.skillKey('wis', 'Perception'), D.saveKey('wis')]);
dice.__setDiceTransport(async () => '{"save": {"who": "Guard", "attribute": "Wisdom", "against": "Charisma"}, "advantage": "none", "reason": "He feels the push."}');
chat.length = 0;
chat.push(ai('The guard eyes you.'));
dice.tagCheck({ attributeId: 'cha', context: 'read his mind' });
chat.push(user('I reach into his thoughts.'));
await dice.onDiceMessageSent();
const saveRoll = chat[1].extra.dooms_roll;
check('a ruling that names a save rolls the target\'s save against the player\'s ability: DC 8 + 2 - 1 on Jordan\'s Charisma 8, the Guard proficient in Wisdom saves',
    !!saveRoll && saveRoll.kind === 'save' && saveRoll.who === 'Guard' && saveRoll.isUser === false && saveRoll.attribute === 'Wisdom' && saveRoll.score === 14 && saveRoll.prof === 2 && saveRoll.dc === 9
    && saveRoll.against && saveRoll.against.who === 'Jordan' && saveRoll.against.attribute === 'Charisma' && saveRoll.against.mod === -1 && saveRoll.against.prof === 2 && saveRoll.attempt === 'read his mind' && dice.getPendingCheck() === null, JSON.stringify(saveRoll));
verdict = dice.buildDiceVerdictForGeneration();
check('...and the verdict names the throw, the formula and whose roll it is',
    verdict.includes('[DICE: Guard makes a Wisdom saving throw against Jordan\'s Charisma. Wisdom saving throw: d20 = ') && verdict.includes('+2 (WIS 14), +2 (proficient in Wisdom saves) = ') && verdict.includes('vs DC 9 (Jordan\'s Charisma: 8 + 2 proficiency -1), because He feels the push.')
    && verdict.includes(saveRoll.success ? 'This roll is Guard\'s: Guard resists, and Jordan\'s effect on them fails.' : 'This roll is Guard\'s: Guard does not resist, and Jordan\'s effect on them takes hold.'), verdict);
dice.__setDiceTransport(gm);
chat.push(ai('He blinks.\n[SAVE: Guard: Wisdom | vs Jordan\'s Charisma | the push goes deeper]'));
dice.onDiceReplyRendered(2);
const npcSave = chat[2].extra.dooms_gm_calls && chat[2].extra.dooms_gm_calls[0];
check('an NPC SAVE tag is rolled on render against the player\'s DC', !!npcSave && npcSave.kind === 'npc' && npcSave.roll.kind === 'save' && npcSave.roll.dc === 9 && npcSave.roll.who === 'Guard' && npcSave.roll.against.who === 'Jordan' && dice.getPendingCheck() === null, JSON.stringify(npcSave));
chat.push(user('I press on.'));
verdict = dice.buildDiceVerdictForGeneration();
check('...and rides to the next generation as a save', verdict.includes('[DICE: Guard makes a Wisdom saving throw against Jordan\'s Charisma, on a throw you called for. Wisdom saving throw:'), verdict);
chat.push(ai('The vision presses in.\n[SAVE: Wisdom | Hard | the vision presses in]'));
dice.onDiceReplyRendered(4);
const pendingSave = dice.getPendingCheck();
check('a player SAVE tag against the world waits on the chip as a save', !!pendingSave && pendingSave.kind === 'save' && pendingSave.isUser === true && pendingSave.calledBy === 'gm' && pendingSave.gmRuling.dc === 20 && pendingSave.gmRuling.label === 'Hard' && pendingSave.attribute === 'Wisdom', JSON.stringify(pendingSave));
chat.push(user('I hold on.'));
await dice.onDiceMessageSent();
const playerSave = chat[5].extra.dooms_roll;
check('...and rolls on send as Jordan\'s Wisdom save at DC 20', !!playerSave && playerSave.kind === 'save' && playerSave.who === 'Jordan' && playerSave.isUser === true && playerSave.dc === 20 && playerSave.against === null, JSON.stringify(playerSave));
verdict = dice.buildDiceVerdictForGeneration();
check('...with a verdict that says it is Jordan\'s roll', verdict.includes('[DICE: Jordan makes a Wisdom saving throw, on a throw you called for. Wisdom saving throw: d20 = ') && verdict.includes('vs DC 20 (Hard), because the vision presses in') && verdict.includes('This roll is Jordan\'s: Jordan '), verdict);
const toolSave = dice.diceToolAction({ kind: 'save', who: 'Guard', attribute: 'Wisdom', against: '', againstAttribute: 'Charisma', reason: 'the push goes deeper' });
check('the tool rolls a save against the player\'s DC and keeps it apart from a check', toolSave.includes('[DICE: Guard makes a Wisdom saving throw against Jordan\'s Charisma, on a throw you called for. Wisdom saving throw:') && toolSave.includes('vs DC 9 (Jordan\'s Charisma: 8 + 2 proficiency -1)') && toolSave.includes('This roll is Guard\'s:') && toolSave.endsWith(dice.STILL_REQUIRED)
    && Object.keys(chat[5].extra.dooms_tool_rolls).length === 1 && dice.diceToolAction({ who: 'Guard', attribute: 'Wisdom', difficulty: 'Medium', reason: 'x' }) !== toolSave && Object.keys(chat[5].extra.dooms_tool_rolls).length === 2, toolSave);
check('the same save asked again is kept', dice.diceToolAction({ kind: 'save', who: 'Guard', attribute: 'Wisdom', against: '', againstAttribute: 'Charisma', reason: 'again' }) === toolSave);
chat.push({ is_user: false, is_system: true, mes: 'tool', extra: { tool_invocations: [{ name: 'dooms_roll_check', parameters: { kind: 'save', who: 'Guard', attribute: 'Wisdom', against: '', againstAttribute: 'Charisma', reason: 'the push goes deeper' } }] } });
dice.onDiceToolCallsPerformed(chat[6].extra.tool_invocations);
chat.push(ai('He staggers.'));
check('the reply after a tool save shows it in its box', (() => { const r = dice.rollsForReply(7); return r.length === 2 && r[0].kind === 'save' && r[0].who === 'Jordan' && r[1].kind === 'save' && r[1].who === 'Guard'; })());
// The casting ability: Jordan's powers run on Charisma 8 (-1); a save the game master names as Wisdom still uses Charisma.
D.setSheet(extensionSettings, 'Jordan', true, { str: 15, cha: 8, wis: 18 }, null, [D.skillKey('str', 'Athletics'), D.castingKey('cha')]);
chat.push(user('I push into his mind.'));
const castingSave = dice.diceToolAction({ kind: 'save', who: 'Guard', attribute: 'Wisdom', against: 'Jordan', againstAttribute: 'Wisdom', reason: 'the push' });
check('a save named against the caster\'s Wisdom is set by their casting ability instead', castingSave.includes('against Jordan\'s Charisma') && castingSave.includes('vs DC 9 (Jordan\'s Charisma: 8 + 2 proficiency -1)'), castingSave);
const shove = dice.diceToolAction({ kind: 'save', who: 'Guard', attribute: 'Dexterity', against: 'Jordan', againstAttribute: 'Strength', reason: 'the shove' });
check('...but a physical ability the game master names stands', shove.includes('against Jordan\'s Strength') && shove.includes('vs DC 12 (Jordan\'s Strength: 8 + 2 proficiency +2)'), shove);
dice.__setDiceTransport(async () => '{"save": {"who": "Guard", "attribute": "Wisdom", "against": "Wisdom"}, "advantage": "none", "reason": "x"}');
dice.tagCheck({ attributeId: 'wis', context: 'read his mind' });
chat.push(user('I read his mind.'));
await dice.onDiceMessageSent();
const rulingCasting = chat[chat.length - 1].extra.dooms_roll;
check('the ruling path uses the casting ability too', !!rulingCasting && rulingCasting.kind === 'save' && rulingCasting.against.attribute === 'Charisma' && rulingCasting.dc === 9, JSON.stringify(rulingCasting));
dice.__setDiceTransport(gm);

// ── 11. Casting checks and talents (Phase 4c, §12) ──
D.setSheet(extensionSettings, 'Jordan', true, { str: 15, cha: 8, wis: 18 }, null, [D.skillKey('str', 'Athletics'), D.castingKey('cha'), D.talentKey('Telepathy', 'master'), D.talentKey('Mist-walking')]);
chat.length = 0;
chat.push(ai('The ward hums.'));
let castingPending = dice.tagCheck({ attributeId: 'cha', skill: 'Casting', context: 'unpick the ward' });
check('tagCheck takes the Casting skill on the casting ability, proficient by definition', !!castingPending && castingPending.skill === 'Casting' && castingPending.skillAttributeId === 'cha' && castingPending.proficient === true && castingPending.prof === 2 && castingPending.score === 8, JSON.stringify(castingPending));
check('...and unpractised on any other attribute', (() => { const p = dice.tagCheck({ attributeId: 'wis', skill: 'casting' }); return p.skill === 'Casting' && p.skillAttributeId === 'wis' && p.proficient === false && p.prof === 0; })());
dice.tagCheck({ attributeId: 'cha', skill: 'Casting', context: 'unpick the ward' });
chat.push(user('I work at the ward.'));
await dice.onDiceMessageSent();
const castingRoll = chat[1].extra.dooms_roll;
check('the ruling call sees Charisma (Casting); the roll adds the modifier and proficiency', lastMessages[1].content.includes('using Charisma (Casting)') && !!castingRoll && castingRoll.skill === 'Casting' && castingRoll.mod === -1 && castingRoll.prof === 2 && castingRoll.dc === 20, JSON.stringify(castingRoll));
verdict = dice.buildDiceVerdictForGeneration();
check('the verdict reads Charisma (Casting) and the attributes line carries the numbers and the talents',
    verdict.includes('Charisma (Casting) check: d20 = ') && verdict.includes('+2 (proficient in Casting)') && verdict.includes('casting ability Charisma (save DC 9, casting check +1); talents: Telepathy (Master), Mist-walking'), verdict);
chat.push(ai('The ward resists.\n[CHECK: Casting | Hard | the ward is old]'));
dice.onDiceReplyRendered(2);
const castingCall = dice.getPendingCheck();
check('a bare [CHECK: Casting] for the player fills Charisma from the sheet, proficient', !!castingCall && castingCall.calledBy === 'gm' && castingCall.attributeId === 'cha' && castingCall.attribute === 'Charisma' && castingCall.abbr === 'CHA' && castingCall.skill === 'Casting' && castingCall.skillAttributeId === 'cha' && castingCall.proficient === true && castingCall.gmRuling.dc === 20, JSON.stringify(castingCall));
dice.clearPendingCheck();
chat.push(user('I push harder.'));
const npcCasting = dice.diceToolAction({ who: 'Guard', attribute: 'Casting', difficulty: 'Medium', reason: 'a warding word' });
check('the tool: an NPC with no casting ability casts with Charisma, unpractised (D27)', npcCasting.includes('[DICE: Guard, on a check you called for. Charisma (Casting) check: d20 = ') && !npcCasting.includes('proficient in Casting') && npcCasting.includes('vs DC 15 (Medium), because a warding word'), npcCasting);
const noAttr = dice.diceToolAction({ attribute: 'Luck', difficulty: 'Medium', reason: 'x' });
check('...and the refusal names Casting', noAttr.startsWith('Nothing was rolled') && noAttr.includes(', or Casting for a casting check.'), noAttr);

// ── 12. A result set by the player (3.1.2, D57) ──
extensionSettings.attributes.allowOverride = false;
extensionSettings.attributes.criticals = true;
globalThis.__DES_CTX__.isToolCallingSupported = () => false;
chat.length = 0;
chat.push(ai('The gate is barred.'));
dice.__setDiceTransport(async () => '{"difficulty": "medium", "advantage": "none", "reason": "a heavy bar"}');
dice.tagCheck({ attributeId: 'str', skill: 'Athletics', context: 'lift the bar' });
chat.push(user('I heave at the bar.'));
await dice.onDiceMessageSent();
chat.push(ai('It does not budge.'));
const barRoll = chat[1].extra.dooms_roll;
const barWas = barRoll.critical === 'success' ? 'a critical success' : barRoll.critical === 'failure' ? 'a critical failure' : barRoll.success ? 'a success' : 'a failure';    // the first die is random
check('with the switch off a result cannot be set or stepped, and the die is plain text', !!barRoll && dice.setRollResult(1, { kept: 20 }) === null && dice.stepRollResult(1, 1) === null && chat[1].extra.dooms_roll === barRoll && !dice.rollCardHtml(barRoll, { editable: false }).includes('dooms-roll-die-btn') && !dice.rollCardHtml(barRoll, { editable: false }).includes('is-set'));
extensionSettings.attributes.allowOverride = true;
const setRoll = dice.setRollResult(1, { kept: 20 });
check('with it on, the die is set on the message and the first result is kept', !!setRoll && chat[1].extra.dooms_roll === setRoll && setRoll.kept === 20 && setRoll.critical === 'success' && setRoll.success === true && setRoll.setBy === 'player' && setRoll.before.kept === barRoll.kept && setRoll.before.success === barRoll.success, JSON.stringify(setRoll));
const setVerdict = dice.buildDiceVerdictForGeneration();
check('the next generation gets the set verdict, final, with nothing about the setting', setVerdict.includes('d20 = 20') && setVerdict.includes('NATURAL 20, a critical success') && setVerdict.includes('This outcome is final') && !setVerdict.toLowerCase().includes('set by'), setVerdict);
check('the reply shows the set roll', dice.rollsForReply(2)[0] === setRoll);
const setHtml = dice.rollCardHtml(setRoll, { editable: true, index: 1, canRegenerate: true });
check('the box: the die as a button, no arrows while closed, what the die showed, and Regenerate on the last reply', setHtml.includes('class="dooms-roll-die-btn"') && setHtml.includes('aria-expanded="false">20</button>') && !setHtml.includes('dooms-roll-step-up') && setHtml.includes(`Set by you: the die showed ${barRoll.kept}, ${barWas}.`) && setHtml.includes('role="note" data-index="1"') && setHtml.includes('class="dooms-roll-regen"') && setHtml.includes(' is-set'), setHtml);
const openHtml = dice.rollCardHtml(setRoll, { editable: true, index: 1, canRegenerate: true, open: true });
check('open: the arrows either side of the die, the die marked open', openHtml.includes('class="dooms-roll-step-down"') && openHtml.includes('class="dooms-roll-die-btn is-open"') && openHtml.includes('aria-expanded="true">20</button>') && openHtml.indexOf('dooms-roll-step-down') < openHtml.indexOf('dooms-roll-die-btn') && openHtml.indexOf('dooms-roll-die-btn') < openHtml.indexOf('dooms-roll-step-up'), openHtml);
check('an older reply offers no Regenerate; an unset roll shows no note; an NPC or tool roll stays plain', !dice.rollCardHtml(setRoll, { editable: true, index: 1, canRegenerate: false }).includes('dooms-roll-regen') && !dice.rollCardHtml(barRoll, { editable: true, index: 1, canRegenerate: true }).includes('Set by you') && !dice.rollCardHtml({ ...barRoll, isUser: false, who: 'Guard' }, { editable: false }).includes('dooms-roll-die-btn'));
const up = dice.stepRollResult(1, 1);
check('the arrows step the die one face at a time and 20 wraps to 1', up.kept === 1 && up.critical === 'failure' && chat[1].extra.dooms_roll === up && up.before.kept === barRoll.kept && dice.stepRollResult(1, -1).kept === 20 && dice.stepRollResult(1, -3).kept === 17 && dice.stepRollResult(1, 5).kept === 2 && dice.buildDiceVerdictForGeneration().includes('d20 = 2'));
check('stepping a reply or nothing is refused', dice.stepRollResult(2, 1) === null && dice.stepRollResult(0, 1) === null && dice.stepRollResult(99, 1) === null);
const turned = dice.setRollResult(1, { success: false });
check('"a failure" picks the face that just misses, and the first result is still the one kept', turned.kept === D.thresholdFace(barRoll, false) && turned.success === false && chat[1].extra.dooms_roll.before.kept === barRoll.kept && dice.buildDiceVerdictForGeneration().includes('FAILURE'));
check('a bad face is refused and changes nothing', dice.setRollResult(1, { kept: 42 }) === null && dice.setRollResult(1, {}) === null && chat[1].extra.dooms_roll === turned);
check('a message without a roll, a reply, or no message cannot be set', dice.setRollResult(0, { kept: 5 }) === null && dice.setRollResult(2, { kept: 5 }) === null && dice.setRollResult(99, { kept: 5 }) === null && dice.setRollResult(-1, { kept: 5 }) === null);
extensionSettings.attributes.allowOverride = false;
check('with the switch off again the set result still reads as set', dice.rollCardHtml(chat[1].extra.dooms_roll, { editable: false }).includes('Set by you') && !dice.rollCardHtml(chat[1].extra.dooms_roll, { editable: false }).includes('dooms-roll-die-btn'));
// the dice tool's rolls: the button on the "Tool calls" line, the result text the model is handed, the memo
extensionSettings.attributes.allowOverride = true;
chat.length = 0;
chat.push(ai('The planks sway.'));
chat.push(user('I cross the rope bridge.'));
const bridgeArgs = { attribute: 'Dexterity', skill: 'Acrobatics', difficulty: 'Hard', advantage: 'none', reason: 'the planks are wet' };
const bridgeText = dice.diceToolAction(bridgeArgs);
const bridgeInv = [{ id: 't1', name: 'dooms_roll_check', displayName: 'Dice check', parameters: JSON.stringify(bridgeArgs), result: bridgeText }];
dice.onDiceToolCallsPerformed(bridgeInv);
chat.push({ is_user: false, is_system: true, name: 'System', mes: `<details><summary>Tool calls: Dice check</summary><pre><code class="language-json">${JSON.stringify([{ id: 't1', name: 'dooms_roll_check', displayName: 'Dice check', parameters: bridgeArgs, result: bridgeText }], null, 2)}</code></pre></details>`, extra: { isSmallSys: true, tool_invocations: bridgeInv } });
chat.push(ai('You wobble across.'));
const toolIdx = 2;
const toolRoll = bridgeInv[0].dooms_roll;
const line = dice.toolDiceHtml(chat[toolIdx], toolIdx, { editable: true });
check('the tool roll shows on the "Tool calls" line with its die as the button, nothing when the switch is off', !!toolRoll && line.includes('class="dooms-tool-dice"') && line.includes(`data-index="${toolIdx}" data-slot="0"`) && line.includes('Dexterity (Acrobatics)') && line.includes(`aria-expanded="false">${toolRoll.kept}</button>`) && line.includes('vs DC 20') && dice.toolDiceHtml(chat[toolIdx], toolIdx, { editable: false }) === '' && dice.toolDiceHtml(chat[1], 1, { editable: true }) === '', line);
check('open, the arrows sit either side of it on the line', dice.toolDiceHtml(chat[toolIdx], toolIdx, { editable: true, openKey: `${toolIdx}:0` }).includes('class="dooms-roll-step-down"') && !dice.toolDiceHtml(chat[toolIdx], toolIdx, { editable: true, openKey: `${toolIdx}:1` }).includes('dooms-roll-step-down'));
const toolSet = dice.setRollResult(toolIdx, { kept: 20, slot: 0 });
const toolSetParts = [!!toolSet, bridgeInv[0].dooms_roll === toolSet, toolSet && toolSet.kept === 20, toolSet && toolSet.critical === 'success', toolSet && toolSet.before.kept === toolRoll.kept, bridgeInv[0].result.includes('d20 = 20'), bridgeInv[0].result.includes('NATURAL 20'), Object.values(chat[1].extra.dooms_tool_rolls || {}).some(r => r === toolSet), chat[toolIdx].mes.includes('d20 = 20'), !chat[toolIdx].mes.includes('&quot;dooms_roll&quot;'), chat[toolIdx].mes.includes('&quot;dooms_roll_check&quot;')];
check('setting a tool roll rewrites the invocation, the result the model is handed, the memo and the "Tool calls" text (without DES\'s own record)', toolSetParts.every(Boolean), JSON.stringify(toolSetParts));
check('the reply below shows the changed tool roll, with the button and the note', dice.rollsForReply(3)[0] === toolSet && dice.rollCardHtml(toolSet, { editable: true, index: toolIdx, slot: 0, canRegenerate: true }).includes(`data-index="${toolIdx}" data-slot="0"`) && dice.rollCardHtml(toolSet, { editable: true, index: toolIdx, slot: 0, canRegenerate: true }).includes(`Set by you: the die showed ${toolRoll.kept}`) && dice.toolDiceHtml(chat[toolIdx], toolIdx, { editable: true }).includes(`(was ${toolRoll.kept})`));
check('a repeated call for the same check answers with the changed roll', dice.diceToolAction(bridgeArgs).includes('d20 = 20'));
check('the arrows step a tool roll too, 20 wrapping to 1; a slot with no roll is refused', dice.stepRollResult(toolIdx, 1, 0).kept === 1 && bridgeInv[0].result.includes('d20 = 1,') && dice.stepRollResult(toolIdx, -1, 0).kept === 20 && dice.stepRollResult(toolIdx, 1, 1) === null && dice.setRollResult(toolIdx, { kept: 5 }) === null);
extensionSettings.attributes.allowOverride = false;
check('with the switch off a tool roll cannot be changed', dice.setRollResult(toolIdx, { kept: 5, slot: 0 }) === null && bridgeInv[0].dooms_roll.kept === 20);

const settle = await Promise.resolve();
console.log(failures === 0 ? '\nAll dice checks pass' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
