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

// ── 5. The vitals model (pure) ──
const V = await import(`${DES}/src/utils/vitals.js`);
const sheet = (patch = {}) => ({ trackerConfig: { presentCharacters: { characterStats: { enabled: true, customStats: [
    { id: 'health', name: 'Health', enabled: true, start: 100, ai: true },
    { id: 'energy', name: 'Energy', enabled: true, start: 100, ai: false },
    { id: 'mana', name: 'Mana', enabled: false, start: 100, ai: true },
], player: { enabled: true }, ...patch } } } });
const defs = V.vitalDefs(sheet());
check('readVitals: array shape, case-insensitive names, percent strings',
    V.readVitals([{ name: 'Health', value: 72 }, { name: 'energy', value: '50%' }], defs).Energy === 50);
check('readVitals: object shape, locked wrapper, invented vital dropped', (() => {
    const m = V.readVitals({ Health: { value: 30, locked: true }, Rage: 99 }, defs);
    return m.Health === 30 && m.Rage === undefined;
})());
check('readVitals: garbage is safe',
    Object.keys(V.readVitals('nope', defs)).length === 0 && Object.keys(V.readVitals(null, defs)).length === 0);
const resolved = V.resolveVitals({ Health: 40, Energy: 10 }, { Health: 90, Energy: 80 }, defs);
check('resolveVitals: a free vital takes the AI value', resolved.Health === 40);
check('resolveVitals: a fixed vital keeps the previous value', resolved.Energy === 80);
check('resolveVitals: a vital with no value starts at start', V.resolveVitals({}, {}, defs).Health === 100);
check('resolveVitals: switched-off vitals are not produced', resolved.Mana === undefined);
const prevChars = JSON.stringify([{ name: 'Mara', stats: [{ name: 'Health', value: 90 }, { name: 'Energy', value: 77 }] }]);
const nextWrapped = JSON.stringify({ characters: [
    { name: 'mara', emoji: '🗡️', stats: { Health: 61, Energy: 5, Rage: 100 } },
    { name: 'Orin', emoji: '🧙' },
] });
const applied = JSON.parse(V.applyVitalsToCharacters(nextWrapped, prevChars, defs));
check('applyVitalsToCharacters: keeps the wrapper and writes the array shape',
    Array.isArray(applied.characters) && Array.isArray(applied.characters[0].stats));
check('applyVitalsToCharacters: free vital updated, fixed vital held, invented one dropped', (() => {
    const m = V.readVitals(applied.characters[0].stats, defs);
    return m.Health === 61 && m.Energy === 77 && applied.characters[0].stats.length === 2;
})(), JSON.stringify(applied.characters[0].stats));
check('applyVitalsToCharacters: a new character is seeded at the start values', (() => {
    const m = V.readVitals(applied.characters[1].stats, defs);
    return m.Health === 100 && m.Energy === 100;
})());
check('applyVitalsToCharacters: a bare array stays a bare array',
    Array.isArray(JSON.parse(V.applyVitalsToCharacters('[{"name":"A"}]', null, defs))));
check('applyVitalsToCharacters: non-JSON is returned untouched',
    V.applyVitalsToCharacters('Present Characters\n---\n', null, defs) === 'Present Characters\n---\n');
const seededPlayer = JSON.parse(V.applyVitalsToPlayer(null, '{"stats":[{"name":"Energy","value":33}]}', defs));
check('applyVitalsToPlayer: a missing block is seeded, the fixed vital from the previous value', (() => {
    const m = V.readVitals(seededPlayer.stats, defs);
    return m.Health === 100 && m.Energy === 33;
})());
check('applyVitalsToPlayer: the AI value wins for a free vital',
    V.readVitals(JSON.parse(V.applyVitalsToPlayer('{"stats":[{"name":"Health","value":12}]}', null, defs)).stats, defs).Health === 12);
check('vitalColor: warning colour at or below lowAt',
    V.vitalColor(defs[0], 25, 25) === V.LOW_VITAL_COLOR && V.vitalColor(defs[0], 26, 25) === defs[0].color);
check('formatVitalsLine', V.formatVitalsLine({ Health: 61, Energy: 77 }, defs) === 'Health 61%, Energy 77%');

// ── 6. The apply path and the context lines ──
extensionSettings.trackerConfig.presentCharacters.characterStats = sheet({ persistInHistory: true }).trackerConfig.presentCharacters.characterStats;
const pb = await import(`${DES}/src/systems/generation/promptBuilder.js`);
state.committedTrackerData.characterThoughts = prevChars;
state.committedTrackerData.player = '{"stats":[{"name":"Health","value":55},{"name":"Energy","value":44}]}';
const ctxSummary = pb.generateContextualSummary();
check('context summary lists vitals from the array shape', ctxSummary.includes('Vitals: Health 90%, Energy 77%'), ctxSummary);
check('context summary carries the persona line', ctxSummary.includes("Jordan's vitals: Health 55%, Energy 44%"), ctxSummary);
const previous = pb.generateRPGPromptText();
check('separate-mode previous block echoes the player with its fixed vital locked',
    previous.includes('"player"') && /"name": "Energy",\s*"value": 44,\s*"locked": true/.test(previous), previous.slice(0, 700));
check('separate-mode previous block marks the character\'s fixed vital too',
    /"name": "Energy",\s*"value": 77,\s*"locked": true/.test(previous));
const histData = { characterThoughts: prevChars, player: state.committedTrackerData.player };
const hist = pb.formatHistoricalTrackerData(histData, extensionSettings.trackerConfig, 'Jordan', false);
check('history persistence includes vitals when the toggle is on',
    hist.includes('Mara: Vitals: Health 90%, Energy 77%') && hist.includes('Jordan: Vitals: Health 55%, Energy 44%'), hist);
extensionSettings.trackerConfig.presentCharacters.characterStats.persistInHistory = false;
check('...and not when it is off',
    !pb.formatHistoricalTrackerData(histData, extensionSettings.trackerConfig, 'Jordan', false).includes('Vitals'));
check('...but "all enabled" on refresh still carries them',
    pb.formatHistoricalTrackerData(histData, extensionSettings.trackerConfig, 'Jordan', true).includes('Vitals: Health 90%'));

// Together mode: a fresh reply goes through onMessageReceived.
chat.length = 0;
chat.push({ is_user: true, mes: 'I rest by the fire.', extra: {} });
chat.push({ is_user: false, mes: '```json\n' + JSON.stringify({
    characters: [{ name: 'Mara', emoji: '🗡️', stats: [{ name: 'Health', value: 95 }, { name: 'Energy', value: 1 }] }],
    player: { stats: [{ name: 'Health', value: 70 }] },
}) + '\n```\nMara stretches.', swipe_id: 0, swipes: ['x'], extra: {} });
state.setIsAwaitingNewMessage(true);
const recvErr = quiet(() => st.onMessageReceived());
const gotChars = V.readVitals(JSON.parse(state.lastGeneratedData.characterThoughts)[0].stats, defs);
check('onMessageReceived: free vital updated from the reply', gotChars.Health === 95, JSON.stringify(gotChars) + (recvErr instanceof Error ? ' / ' + recvErr.message : ''));
check('onMessageReceived: fixed vital held at the committed value', gotChars.Energy === 77, JSON.stringify(gotChars));
const gotPlayer = V.readVitals(JSON.parse(state.lastGeneratedData.player).stats, defs);
check('onMessageReceived: player updated, fixed vital held', gotPlayer.Health === 70 && gotPlayer.Energy === 44, JSON.stringify(gotPlayer));
check('onMessageReceived: the swipe store holds the normalised data',
    chat[1].extra.dooms_tracker_swipes[0].player === state.lastGeneratedData.player
    && chat[1].extra.dooms_tracker_swipes[0].characterThoughts === state.lastGeneratedData.characterThoughts);

console.log(failures === 0 ? '\nAll vitals checks pass' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
