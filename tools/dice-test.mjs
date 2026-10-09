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

// ── 2. Tag and rule ──
let calls = 0;
let lastMessages = null;
dice.__setDiceTransport(async (messages) => { calls++; lastMessages = messages; return '{"difficulty": "hard", "advantage": "disadvantage", "reason": "The wall is slick with rain."}'; });
chat.length = 0;
chat.push(ai('The wall rises before you.'));
let pending = await dice.tagCheck({ attributeId: 'str', attempt: 'climb the wall' });
check('tagCheck records the player\'s attribute and score', pending && pending.attribute === 'Strength' && pending.abbr === 'STR' && pending.score === 15 && pending.attempt === 'climb the wall');
check('...and the game master\'s ruling', pending.ruling && pending.ruling.difficultyId === 'hard' && pending.ruling.dc === 20 && pending.ruling.advantage === 'dis' && pending.ruling.source === 'ai' && pending.rating === false);
check('the rating call saw the attempt, the attribute and the scene', calls === 1 && lastMessages[1].content.includes('"climb the wall", using Strength') && lastMessages[1].content.includes('AI: The wall rises'));
check('getPendingCheck returns it', dice.getPendingCheck() === pending);
check('override is refused while the setting is off', dice.overrideRuling({ difficultyId: 'easy' }) === null && pending.ruling.dc === 20);
extensionSettings.attributes.allowOverride = true;
check('override is honoured once the setting is on', dice.overrideRuling({ difficultyId: 'easy', advantage: 'adv' }) === pending && pending.ruling.dc === 10 && pending.ruling.advantage === 'adv' && pending.ruling.source === 'override');
extensionSettings.attributes.allowOverride = false;

// ── 3. Roll on send ──
chat.push(user('I climb the wall.'));
dice.onDiceMessageSent();
const roll = chat[1].extra.dooms_roll;
check('the roll is written to the sent message', roll && roll.attribute === 'Strength' && roll.score === 15 && roll.mod === 2 && roll.kept >= 1 && roll.kept <= 20);
check('...with the ruling it was rolled against', roll.dc === 10 && roll.difficultyId === 'easy' && roll.advantage === 'adv' && roll.rolls.length === 2 && roll.rulingSource === 'override');
check('...and the arithmetic holds', roll.total === roll.kept + roll.mod && (roll.critical ? true : roll.success === (roll.total >= roll.dc)));
check('the pending check is consumed', dice.getPendingCheck() === null);
check('onDiceMessageSent with nothing pending is a no-op', (dice.onDiceMessageSent(), chat[1].extra.dooms_roll === roll));

// ── 4. The verdict for the next generation ──
let verdict = dice.buildDiceVerdictForGeneration();
check('a fresh reply to the rolled message gets the verdict',
    verdict.startsWith('[DICE: Jordan attempts "climb the wall". Strength check: d20 = ') && verdict.includes('vs DC 10 (Easy), because The wall is slick with rain') && verdict.includes('This outcome is final'), verdict);
chat.push(ai('You scramble up.'));
check('a swipe or regenerate of that reply gets the same verdict', dice.buildDiceVerdictForGeneration() === verdict);
check('the attributes line rides with a roll (with-a-roll mode)', pb.generateTrackerInstructions(false, false).includes('Jordan (player): STR 15 (+2), CHA 8 (-1)'));
chat.push(user('I walk on.'));
check('a later message without a roll gets no verdict', dice.buildDiceVerdictForGeneration() === '');
check('...and no attributes line', !pb.generateTrackerInstructions(false, false).includes('ATTRIBUTES'));
extensionSettings.attributes.enabled = false;
chat.length = 2;
check('attributes off: no verdict even with a roll on the message', dice.buildDiceVerdictForGeneration() === '');
extensionSettings.attributes.enabled = true;

// ── 5. Roll now ──
chat.length = 0;
chat.push(ai('A guard blocks the gate.'));
chat.push(user('I try to talk my way past.'));
pending = await dice.tagCheck({ attributeId: 'cha', attempt: 'talk past the guard' });
const now = dice.rollNow();
check('rollNow attaches at once when the tail is the player\'s own message', now && chat[1].extra.dooms_roll === now && dice.getPendingCheck() === null && now.dc === 20 && now.advantage === 'dis');
chat.push(ai('The guard squints.'));
pending = await dice.tagCheck({ attributeId: 'cha', attempt: 'bluff' });
const waiting = dice.rollNow();
check('rollNow waits for the next message when a reply is the tail', waiting && dice.getPendingCheck() && dice.getPendingCheck().roll === waiting && dice.getPendingCheck().mode === 'now');
chat.push(user('I bluff.'));
dice.onDiceMessageSent();
check('...and that roll, not a new one, rides with the message sent', chat[3].extra.dooms_roll === waiting && dice.getPendingCheck() === null);

// ── 6. Fallbacks ──
dice.__setDiceTransport(async () => { throw new Error('offline'); });
pending = await dice.tagCheck({ attributeId: 'str', attempt: 'x' });
check('a failed rating call falls back to the default difficulty and says so', pending.ruling.difficultyId === 'medium' && pending.ruling.dc === 15 && pending.ruling.source === 'default' && pending.ruling.error === 'offline');
dice.__setDiceTransport(async () => 'Hmm, let me think about that.');
pending = await dice.tagCheck({ attributeId: 'str', attempt: 'x' });
check('an unreadable answer falls back too', pending.ruling.source === 'default' && pending.ruling.error === 'unreadable');
calls = 0;
dice.__setDiceTransport(async () => { calls++; return '{"difficulty":"hard"}'; });
extensionSettings.attributes.aiRatesDifficulty = false;
pending = await dice.tagCheck({ attributeId: 'str', attempt: 'x' });
check('with the AI not asked, no call is made and the default stands', calls === 0 && pending.ruling.source === 'default');
extensionSettings.attributes.aiRatesDifficulty = true;
check('a re-tag while a ruling is in flight wins', await (async () => {
    dice.__setDiceTransport(async () => { await new Promise(r => setTimeout(r, 20)); return '{"difficulty":"easy"}'; });
    const first = dice.tagCheck({ attributeId: 'str', attempt: 'first' });
    const second = dice.tagCheck({ attributeId: 'dex', attempt: 'second' });
    await Promise.all([first, second]);
    const p = dice.getPendingCheck();
    return p && p.attempt === 'second' && p.attribute === 'Dexterity' && p.ruling && p.ruling.difficultyId === 'easy';
})());
dice.clearPendingCheck();
check('clearPendingCheck', dice.getPendingCheck() === null);
check('tagCheck with attributes off gives null', (extensionSettings.attributes.enabled = false, dice.tagCheck({ attributeId: 'str' }).then(v => v === null)));
extensionSettings.attributes.enabled = true;

// ── 7. Removal and the chat switch ──
check('removeRollFromMessage clears the roll', dice.removeRollFromMessage(3) === true && chat[3].extra.dooms_roll === undefined && dice.removeRollFromMessage(3) === false);
pending = await dice.tagCheck({ attributeId: 'str', attempt: 'x' });
dice.onDiceChatChanged();
check('a chat switch drops the pending check', dice.getPendingCheck() === null);

const settle = await Promise.resolve();
console.log(failures === 0 ? '\nAll dice checks pass' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
