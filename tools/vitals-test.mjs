#!/usr/bin/env node
/**
 * Vitals test (Project Short Fuse): the "player" tracker key end to end and,
 * from commit 5 on, the vitals model itself.
 *
 * Usage:  node tools/vitals-test.mjs     (from the repo root)
 * Exit:   0 = pass, 1 = failure
 *
 * Mechanism: reuses the stub sandbox tools/load-check.mjs builds (it runs
 * load-check first), with three stubs made real — `chat`, `chat_metadata`
 * and `getContext()` — because the swipe store and the chat save live there.
 * Everything else SillyTavern-side stays the "anything" proxy.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const SANDBOX = '/tmp/des-load-check';
const DES = `${SANDBOX}/scripts/extensions/third-party/DES`;

execFileSync(process.execPath, ['tools/load-check.mjs'], { stdio: 'pipe' });
if (!existsSync(`${DES}/src/systems/generation/parser.js`)) {
    console.error('FAIL: sandbox missing after load-check — cannot run.');
    process.exit(1);
}

// Real chat state, shared by the script.js stub and getContext().
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
    { chat: globalThis.__DES_CHAT__, chat_metadata: globalThis.__DES_CHAT_METADATA__, name1: 'Jordan', chatId: 'test-chat' },
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
// The renderers the swipe/delete handlers call afterwards touch these; they
// are irrelevant here but noisy without them.
globalThis.requestAnimationFrame = () => 0;
globalThis.cancelAnimationFrame = () => {};
globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });

const chat = globalThis.__DES_CHAT__;
const chat_metadata = globalThis.__DES_CHAT_METADATA__;
// The module namespace keeps the live bindings: loadChatData() REPLACES the
// tracker-data objects (setLastGeneratedData), so a destructured copy taken
// at import time would go stale halfway through.
const state = await import(`${DES}/src/core/state.js`);
const { extensionSettings } = state;
const { parseResponse } = await import(`${DES}/src/systems/generation/parser.js`);
const persistence = await import(`${DES}/src/core/persistence.js`);
const st = await import(`${DES}/src/systems/integration/sillytavern.js`);

let failures = 0;
const check = (label, cond, extra = '') => {
    if (cond) { console.log(`pass  ${label}`); }
    else { console.error(`FAIL  ${label}${extra ? '\n      ' + extra : ''}`); failures++; }
};
const quiet = (fn) => { try { return fn(); } catch (e) { return e; } };

extensionSettings.enabled = true;
extensionSettings.generationMode = 'together';
extensionSettings.showQuests = true;
extensionSettings.showInfoBox = true;
extensionSettings.showCharacterThoughts = true;

// ── 1. The parser returns the player block ──
const unified = '```json\n' + JSON.stringify({
    quests: { main: 'Find the well', optional: [] },
    infoBox: { location: 'Ridge', time: { start: '09:00', end: '09:30' } },
    characters: [{ name: 'Mara', emoji: '🗡️', stats: [{ name: 'Health', value: 72 }] }],
    player: { stats: [{ name: 'Health', value: 91 }, { name: 'Energy', value: 60 }] },
}, null, 2) + '\n```\nThe wind picks up.';
let r = parseResponse(unified);
check('unified block: player comes back as a JSON string', typeof r.player === 'string' && JSON.parse(r.player).stats[1].value === 60);
check('unified block: the other sections are untouched',
    r.quests && r.infoBox && r.characterThoughts && JSON.parse(r.characterThoughts)[0].stats[0].value === 72);
check('unified block: not a parsing failure', !r.parsingFailed);

r = parseResponse('```json\n{"quests": {"main": "x", "optional": []}, "characters": [{"name": "Mara"}]}\n```');
check('no player in the block: player stays null', r.player === null && !!r.quests);

r = parseResponse('```json\n{"player": {"stats": [{"name": "Health", "value": 55}]}}\n```');
check('a lone {"player": …} block is the player', typeof r.player === 'string' && JSON.parse(r.player).stats[0].value === 55);
check('...and counts as tracker data', !r.parsingFailed);

r = parseResponse('```json\n{"stats": [{"name": "Health", "value": 40}]}\n```');
check('a bare {"stats": …} block is the player', typeof r.player === 'string' && JSON.parse(r.player).stats[0].value === 40);

r = parseResponse('Just prose, no trackers at all.');
check('prose only: player null and parsing failed', r.player === null && r.parsingFailed === true);

// ── 2. The swipe store carries it ──
chat.length = 0;
chat.push({ is_user: true, mes: 'Hello', extra: {} });
chat.push({ is_user: false, mes: 'Reply', swipe_id: 0, swipes: ['Reply'], extra: {} });
state.lastGeneratedData.quests = null;
state.lastGeneratedData.infoBox = null;
state.lastGeneratedData.characterThoughts = JSON.stringify({ characters: [{ name: 'Mara', emoji: '🗡️' }] });
state.lastGeneratedData.player = JSON.stringify({ stats: [{ name: 'Health', value: 91 }] });
persistence.updateMessageSwipeData();
const stored = chat[1].extra.dooms_tracker_swipes[0];
// The entry is a live reference the "old chat" step below strips, so keep the blob itself.
const playerBlob = state.lastGeneratedData.player;
check('updateMessageSwipeData writes player next to characterThoughts',
    stored && stored.player === playerBlob && stored.characterThoughts === state.lastGeneratedData.characterThoughts);

state.committedTrackerData.player = null;
st.commitTrackerData();
check('commitTrackerData copies player into the committed set', state.committedTrackerData.player === playerBlob);

state.lastGeneratedData.player = null;
quiet(() => st.onMessageSwiped(1));   // the renderers it calls afterwards may not like the stubs
check('onMessageSwiped restores player for display', state.lastGeneratedData.player === playerBlob);

// ── 3. The chat save round-trips it ──
persistence.saveChatData();
check('saveChatData keeps player in the chat blob',
    chat_metadata.dooms_tracker?.lastGeneratedData?.player === playerBlob
    && chat_metadata.dooms_tracker?.committedTrackerData?.player === playerBlob);
state.lastGeneratedData.player = null;
state.committedTrackerData.player = null;
quiet(() => persistence.loadChatData());
check('loadChatData brings player back on display and committed data',
    state.lastGeneratedData.player === playerBlob && state.committedTrackerData.player === playerBlob);

// A chat saved before vitals existed has no player anywhere: nothing breaks.
delete chat_metadata.dooms_tracker.lastGeneratedData.player;
delete chat_metadata.dooms_tracker.committedTrackerData.player;
delete chat[1].extra.dooms_tracker_swipes[0].player;
quiet(() => persistence.loadChatData());
check('an old chat without player loads with player null', state.lastGeneratedData.player === null || state.lastGeneratedData.player === undefined);

// ── 4. Deleting the tail rolls player back ──
chat[1].extra.dooms_tracker_swipes[0].player = playerBlob;
quiet(() => st.onMessageDeleted());
check('onMessageDeleted takes player from the new tail', state.lastGeneratedData.player === playerBlob && state.committedTrackerData.player === playerBlob);
chat.length = 1;
quiet(() => st.onMessageDeleted());
check('...and clears it when no assistant message is left', state.lastGeneratedData.player === null && state.committedTrackerData.player === null);

console.log(failures === 0 ? '\nAll vitals checks pass' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
