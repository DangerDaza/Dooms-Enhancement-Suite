#!/usr/bin/env node
/**
 * Tracker recovery test (together mode): did a reply carry its block, which
 * reply is the last one, the two halves of a reply split by a tool call,
 * and when a recovery request should follow.
 *
 * Usage:  node tools/tracker-recovery-test.mjs     (from the repo root)
 * Exit:   0 = pass, 1 = failure
 *
 * The module under test has no SillyTavern imports, so no sandbox is needed.
 */
import {
    hasTrackerData, swipeEntryOf, wasRecovered, markRecovered, isReplyMessage,
    replyLacksTracker, lastReply, earlierPartsOfTurn, adoptBlockFromTurn, shouldRecoverTracker,
} from '../src/systems/generation/trackerRecovery.js';

let failures = 0;
function check(name, ok, detail = '') {
    if (ok) {
        console.log(`pass  ${name}`);
    } else {
        failures++;
        console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
    }
}

const user = (mes = 'I open the door') => ({ is_user: true, name: 'Jordan', mes });
const reply = (mes = 'The door creaks.', extra = {}) => ({ is_user: false, name: 'Narrator', mes, swipe_id: 0, extra });
const toolRecord = () => ({ is_user: false, is_system: true, name: 'SillyTavern System', mes: '<details>', extra: { isSmallSys: true, tool_invocations: [{ name: 'dooms_roll_check' }] } });
const note = () => ({ is_user: false, is_system: true, name: 'System', mes: 'hidden' });
const withData = (mes = 'Story.') => reply(mes, { dooms_tracker_swipes: { 0: { characterThoughts: 'Present Characters\n---\nSilvy' } } });
const withEmpty = (mes = 'Story.') => reply(mes, { dooms_tracker_swipes: { 0: { quests: undefined, infoBox: undefined, characterThoughts: undefined, player: undefined } } });

console.log('\n§1 hasTrackerData');
check('nothing', !hasTrackerData(undefined) && !hasTrackerData(null) && !hasTrackerData('x'));
check('empty entry', !hasTrackerData({}));
check('entry of undefineds (together mode after a failed parse)', !hasTrackerData({ quests: undefined, infoBox: undefined, characterThoughts: undefined, player: undefined }));
check('whitespace only', !hasTrackerData({ infoBox: '   \n' }));
check('a string section', hasTrackerData({ characterThoughts: 'Present Characters\n---\nSilvy' }));
check('an object section', hasTrackerData({ player: { vitals: [{ id: 'hp' }] } }));
check('an empty object section', !hasTrackerData({ player: {} }));

console.log('\n§2 swipeEntryOf');
check('from extra', swipeEntryOf(withData()).characterThoughts.includes('Silvy'));
check('follows swipe_id', swipeEntryOf({ swipe_id: 2, extra: { dooms_tracker_swipes: { 0: { infoBox: 'a' }, 2: { infoBox: 'b' } } } }).infoBox === 'b');
check('from swipe_info once loaded from file', swipeEntryOf({ swipe_id: 1, swipe_info: [{}, { extra: { dooms_tracker_swipes: { 1: { quests: 'q' } } } }] }).quests === 'q');
check('none stored', swipeEntryOf(reply()) === undefined && swipeEntryOf(null) === undefined);

console.log('\n§3 isReplyMessage / replyLacksTracker / recovered mark');
check('user message is no reply', !isReplyMessage(user()) && !replyLacksTracker(user()));
check('tool record is no reply', !isReplyMessage(toolRecord()) && !replyLacksTracker(toolRecord()));
check('system note is no reply', !isReplyMessage(note()));
check('reply with no entry lacks it', replyLacksTracker(reply()));
check('reply with an empty entry lacks it', replyLacksTracker(withEmpty()));
check('reply with data has it', !replyLacksTracker(withData()));
{
    const m = withData();
    check('not recovered by default', !wasRecovered(m));
    markRecovered(m);
    check('marked recovered', wasRecovered(m) && m.extra.dooms_tracker_recovered[0] === true);
    check('a recovered reply still counts as lacking (its text had no block)', replyLacksTracker(m));
    const other = { ...m, swipe_id: 1 };
    check('the mark is per swipe', !wasRecovered(other));
    markRecovered(null);
    check('marking nothing is harmless', true);
}

console.log('\n§4 lastReply');
check('empty chat', lastReply([]) === null && lastReply(undefined) === null);
check('skips the user message', lastReply([withData('a'), user()]).mes === 'a');
check('skips a tool record', lastReply([withData('a'), user(), toolRecord()]).mes === 'a');
check('skips a system note', lastReply([withData('a'), note()]).mes === 'a');
check('finds the continuation after a tool call', lastReply([user(), toolRecord(), reply('cont')]).mes === 'cont');
check('a half-written reply that a tool record follows is not finished: the previous turn\'s reply counts', lastReply([withData('prev'), user(), reply('half'), toolRecord()]).mes === 'prev');
check('two tool calls in progress: still the previous turn\'s reply', lastReply([withData('prev'), user(), reply('a'), toolRecord(), reply('b'), toolRecord()]).mes === 'prev');
check('the continuation after the half is the finished one', lastReply([withData('prev'), user(), reply('half'), toolRecord(), reply('cont')]).mes === 'cont');
check('a chat of user messages has none', lastReply([user(), user()]) === null);

console.log('\n§5 earlierPartsOfTurn');
{
    const chat = [withData('old'), user(), reply('first half'), toolRecord(), reply('cont')];
    const parts = earlierPartsOfTurn(chat, 4);
    check('the half before the tool call', parts.length === 1 && parts[0].mes === 'first half');
    check('stops at the user message (the previous reply is not part of the turn)', !parts.some(p => p.mes === 'old'));
}
check('a plain reply has no earlier parts', earlierPartsOfTurn([withData('old'), user(), reply('cont')], 2).length === 0);
check('a tool call with nothing streamed before it', earlierPartsOfTurn([user(), toolRecord(), reply('cont')], 2).length === 0);
{
    const chat = [user(), reply('a'), toolRecord(), reply('b'), toolRecord(), reply('c')];
    const parts = earlierPartsOfTurn(chat, 5);
    check('two tool calls: both earlier parts, nearest first', parts.length === 2 && parts[0].mes === 'b' && parts[1].mes === 'a');
}
check('stops at a system note', earlierPartsOfTurn([reply('x'), note(), reply('cont')], 2).length === 0);
check('bad input', earlierPartsOfTurn(undefined, 3).length === 0 && earlierPartsOfTurn([], 0).length === 0);

console.log('\n§6 adoptBlockFromTurn');
const parse = (text) => (text.includes('```json') ? { parsingFailed: false, characterThoughts: `from:${text.slice(0, 5)}` } : { parsingFailed: true });
{
    const chat = [user(), reply('```json {}``` first half'), toolRecord(), reply('cont')];
    const got = adoptBlockFromTurn(chat, 3, parse);
    check('adopts the block from the half before the tool call', got && got.characterThoughts === 'from:```js');
}
check('nothing to adopt when the first half had none', adoptBlockFromTurn([user(), reply('plain'), toolRecord(), reply('cont')], 3, parse) === null);
check('nothing to adopt for a plain reply', adoptBlockFromTurn([withData('```json old```'), user(), reply('cont')], 2, parse) === null);
check('a throwing parser is survived', adoptBlockFromTurn([user(), reply('x'), toolRecord(), reply('cont')], 3, () => { throw new Error('boom'); }) === null);
check('an empty first half is skipped', adoptBlockFromTurn([user(), reply(''), toolRecord(), reply('cont')], 3, parse) === null);

console.log('\n§7 shouldRecoverTracker');
const base = { enabled: true, generationMode: 'together', recoverMissingTracker: true, showInfoBox: true, showCharacterThoughts: true, showQuests: false };
const fresh = { fresh: true, parsingFailed: true, message: reply() };
check('fresh reply without a block, together mode: recover', shouldRecoverTracker(base, fresh));
check('switch off: no', !shouldRecoverTracker({ ...base, recoverMissingTracker: false }, fresh));
check('switch missing (older settings): yes, it is on by default', shouldRecoverTracker({ ...base, recoverMissingTracker: undefined }, fresh));
check('extension off: no', !shouldRecoverTracker({ ...base, enabled: false }, fresh));
check('separate mode: no (it has its own request)', !shouldRecoverTracker({ ...base, generationMode: 'separate' }, fresh));
check('external mode: no', !shouldRecoverTracker({ ...base, generationMode: 'external' }, fresh));
check('history load (not fresh): no', !shouldRecoverTracker(base, { ...fresh, fresh: false }));
check('the block parsed: no', !shouldRecoverTracker(base, { ...fresh, parsingFailed: false }));
check('a user message: no', !shouldRecoverTracker(base, { ...fresh, message: user() }));
check('a tool record: no', !shouldRecoverTracker(base, { ...fresh, message: toolRecord() }));
check('every section hidden: no (the request would ask for nothing)', !shouldRecoverTracker({ ...base, showInfoBox: false, showCharacterThoughts: false, showQuests: false }, fresh));
check('only quests shown: yes', shouldRecoverTracker({ ...base, showInfoBox: false, showCharacterThoughts: false, showQuests: true }, fresh));
check('no settings: no', !shouldRecoverTracker(null, fresh));

console.log('');
if (failures) {
    console.log(`${failures} tracker recovery check(s) failed`);
    process.exit(1);
}
console.log('All tracker recovery checks pass');
