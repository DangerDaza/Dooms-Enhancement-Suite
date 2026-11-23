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
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { buildSandbox } from './sandbox.mjs';

const { SANDBOX, DES } = buildSandbox();
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
{
    // stripVitals: what the prompt sends while vitals are off. Both shapes, the
    // wrapper, the legacy object form; the same reference back when there is nothing to strip.
    const arr = [{ name: 'Mara', emoji: '🗡️', stats: [{ name: 'Health', value: 72 }] }, { name: 'Tom' }];
    const bare = V.stripVitals(arr);
    check('stripVitals: array shape loses stats, keeps the rest, leaves the input alone', bare[0].stats === undefined && bare[0].emoji === '🗡️' && bare[1].name === 'Tom' && arr[0].stats.length === 1);
    const wrapped = V.stripVitals({ characters: [{ name: 'Mara', stats: { Health: 40 } }], note: 'x' });
    check('stripVitals: the wrapper shape and the legacy object form', wrapped.characters[0].stats === undefined && wrapped.note === 'x');
    const one = { stats: [{ name: 'Health', value: 91 }], mood: 'wary' };
    check('stripVitals: a single block (the player)', V.stripVitals(one).stats === undefined && V.stripVitals(one).mood === 'wary');
    const plain = [{ name: 'Mara' }];
    check('stripVitals: nothing to strip gives the same reference back', V.stripVitals(plain) === plain && V.stripVitals(null) === null && V.stripVitals('text') === 'text');
}
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

// ── 7. Editing the persona's vitals by hand ──
const th = await import(`${DES}/src/systems/rendering/thoughts.js`);
chat.length = 0;
chat.push({ is_user: false, mes: 'x', swipe_id: 0, swipes: ['x'], extra: { dooms_tracker_swipes: { 0: { player: null } } } });
state.lastGeneratedData.player = '{"stats":[{"name":"Health","value":70},{"name":"Energy","value":44}]}';
check('updatePlayerVital clamps and stores the value',
    th.updatePlayerVital('health', '150%') === 100
    && V.readVitals(JSON.parse(state.lastGeneratedData.player).stats, defs).Health === 100);
check('updatePlayerVital keeps the other vitals',
    V.readVitals(JSON.parse(state.lastGeneratedData.player).stats, defs).Energy === 44);
check('updatePlayerVital reaches committed data and the swipe store',
    state.committedTrackerData.player === state.lastGeneratedData.player
    && chat[0].extra.dooms_tracker_swipes[0].player === state.lastGeneratedData.player);
check('updatePlayerVital rejects an unknown vital', th.updatePlayerVital('Rage', 10) === null);
state.lastGeneratedData.player = null;
check('updatePlayerVital on an empty block seeds the rest from the sheet', (() => {
    th.updatePlayerVital('Energy', 9);
    const m = V.readVitals(JSON.parse(state.lastGeneratedData.player).stats, defs);
    return m.Energy === 9 && m.Health === 100;
})());

// ── 8. Who a vital is for (D231) ──
{
    const scoped = (patch = {}) => ({ trackerConfig: { presentCharacters: { characterStats: { enabled: true, customStats: [
        { id: 'health', name: 'Health', enabled: true, start: 100, ai: true },
        { id: 'edge', name: 'Edge', enabled: true, start: 0, ai: true, who: 'named', names: ['Eli Vega'] },
        { id: 'attention', name: 'Attention', enabled: true, start: 10, ai: true, who: 'named', names: ['Roxy', ' roxy ', 7] },
        { id: 'hunger', name: 'Hunger', enabled: true, start: 50, ai: true, who: 'player' },
        { id: 'threat', name: 'Threat', enabled: true, start: 20, ai: true, who: 'others' },
    ], player: { enabled: true }, ...patch } } } });
    const sd = V.vitalDefs(scoped());
    const byName = (n) => sd.find(d => d.name === n);
    check('D231: an entry without who is for everyone, with no names', defs[0].who === 'all' && Array.isArray(defs[0].names) && defs[0].names.length === 0);
    check('D231: an unknown who reads as everyone', V.normalizeVitalDef({ name: 'X', who: 'aliens' }).who === 'all');
    check('D231: names are trimmed, kept once, strings only', JSON.stringify(byName('Attention').names) === '["Roxy"]');
    check('D231: parseVitalNames splits on commas and lines', JSON.stringify(V.parseVitalNames('Roxy, Eli Vega;\nroxy ,, ')) === '["Roxy","Eli Vega"]');
    check('D231: sameWho takes a first name for the full one, either way', V.sameWho('Roxy', 'Roxy Vance') && V.sameWho('Eli Vega', 'eli') && V.sameWho('Élise', 'elise'));
    check('D231: sameWho tells different people apart', !V.sameWho('Jack', 'Eli Vega') && !V.sameWho('Roxy', 'Roxanne') && !V.sameWho('', 'Roxy'));
    check('D231: a vital for everyone is everyone\'s', V.vitalAppliesTo(byName('Health'), { name: 'Mara' }) && V.vitalAppliesTo(byName('Health'), { isPlayer: true }));
    check('D231: ...and stops at the persona while "Your character too" is off', !V.vitalAppliesTo(byName('Health'), { isPlayer: true, shared: false }));
    check('D231: a vital for the player is the persona\'s only', V.vitalAppliesTo(byName('Hunger'), { isPlayer: true, shared: false }) && !V.vitalAppliesTo(byName('Hunger'), { name: 'Mara' }));
    check('D231: a vital for the others is never the persona\'s', V.vitalAppliesTo(byName('Threat'), { name: 'Mara' }) && !V.vitalAppliesTo(byName('Threat'), { isPlayer: true }));
    check('D231: a named vital is its character\'s only', V.vitalAppliesTo(byName('Attention'), { name: 'Roxy Vance' }) && !V.vitalAppliesTo(byName('Attention'), { name: 'Mara' }));
    check('D231: a named vital is the persona\'s when the name is one the player goes by',
        V.vitalAppliesTo(byName('Edge'), { isPlayer: true, playerNames: ['Eli Vega'] }) && !V.vitalAppliesTo(byName('Edge'), { isPlayer: true, playerNames: ['Jack'] }));
    check('D231: ...and that character\'s when another story meets them', V.vitalAppliesTo(byName('Edge'), { name: 'Eli Vega' }));
    check('D231: a named vital with no names is nobody\'s', !V.vitalAppliesTo({ who: 'named', names: [] }, { name: 'Roxy' }) && !V.vitalAppliesTo({ who: 'named', names: [] }, { isPlayer: true, playerNames: ['Roxy'] }));
    check('D231: vitalsFor hands the same list back when all of it applies', V.vitalsFor(defs, { name: 'Mara' }) === defs);
    check('D231: vitalsFor keeps sheet order', V.vitalsFor(sd, { name: 'Roxy' }).map(d => d.name).join() === 'Health,Attention,Threat');
    check('D231: the sample character shows what every character carries', V.castVitalDefs(sd).map(d => d.name).join() === 'Health,Threat');
    check('D231: the named notes leave the player\'s own out',
        JSON.stringify(V.namedVitalNotes(sd, ['Eli Vega'])) === '[{"name":"Attention","names":["Roxy"]}]' && V.namedVitalNotes(sd, ['Jack']).length === 2);
    check('D231: the persona\'s vitals, played as Eli', V.playerVitalDefs(scoped(), ['Eli Vega']).map(d => d.name).join() === 'Health,Edge,Hunger');
    check('D231: ...played as Jack', V.playerVitalDefs(scoped(), ['Jack']).map(d => d.name).join() === 'Health,Hunger');
    check('D231: ...with "Your character too" off, the ones meant for the player stay',
        V.playerVitalDefs(scoped({ player: { enabled: false } }), ['Eli Vega']).map(d => d.name).join() === 'Edge,Hunger' && V.playerVitalsOn(scoped({ player: { enabled: false } }), ['Eli Vega']));
    check('D231: a plain sheet with "Your character too" off still gives the persona none', !V.playerVitalsOn(sheet({ player: { enabled: false } })) && V.playerVitalsOn(sheet()));
    check('D231: vitals off gives the persona none', V.playerVitalDefs(scoped({ enabled: false }), ['Eli Vega']).length === 0);

    const next = JSON.stringify({ characters: [
        { name: 'Roxy Vance', stats: [{ name: 'Health', value: 80 }, { name: 'Attention', value: 55 }, { name: 'Edge', value: 90 }] },
        { name: 'Mara', stats: [{ name: 'Health', value: 70 }, { name: 'Attention', value: 99 }, { name: 'Hunger', value: 1 }] },
    ] });
    const out = JSON.parse(V.applyVitalsToCharacters(next, null, sd)).characters;
    check('D231: applying keeps a named vital on its character', out[0].stats.map(x => `${x.name}=${x.value}`).join() === 'Health=80,Attention=55,Threat=20', JSON.stringify(out[0].stats));
    check('D231: ...and drops it from everyone else, the player\'s too', out[1].stats.map(x => `${x.name}=${x.value}`).join() === 'Health=70,Threat=20', JSON.stringify(out[1].stats));
    const onlyNamed = V.vitalDefs({ trackerConfig: { presentCharacters: { characterStats: { enabled: true, customStats: [{ name: 'Attention', who: 'named', names: ['Roxy'] }] } } } });
    const lone = JSON.parse(V.applyVitalsToCharacters('[{"name":"Mara","stats":[{"name":"Attention","value":5}]},{"name":"Roxy"}]', null, onlyNamed));
    check('D231: a character who carries none has no stats at all', !('stats' in lone[0]) && lone[1].stats[0].name === 'Attention' && lone[1].stats[0].value === 100, JSON.stringify(lone));
    const pl = JSON.parse(V.applyVitalsToPlayer('{"stats":[{"name":"Edge","value":62},{"name":"Attention","value":40}]}', null, V.playerVitalDefs(scoped(), ['Eli Vega'])));
    check('D231: the persona\'s block holds the persona\'s vitals', pl.stats.map(x => `${x.name}=${x.value}`).join() === 'Health=100,Edge=62,Hunger=50', JSON.stringify(pl.stats));

    // Through the prompt and a reply, as Eli and as Jack.
    const jp = await import(`${DES}/src/systems/generation/jsonPromptHelpers.js`);
    extensionSettings.trackerConfig.presentCharacters.characterStats = scoped().trackerConfig.presentCharacters.characterStats;
    V.setPlayedNamesSource(() => ['Eli Vega', 'Jordan']);
    const castSpec = jp.buildCharactersJSONInstruction();
    check('D231: the characters spec asks for what every character carries', castSpec.includes('"Health"') && castSpec.includes('"Threat"') && !castSpec.includes('"Edge"') && !castSpec.includes('"Attention"') && !castSpec.includes('"Hunger"'), castSpec);
    const playerSpec = jp.buildPlayerJSONInstruction();
    check('D231: the player spec asks for the persona\'s own', playerSpec.includes('"Edge"') && playerSpec.includes('"Hunger"') && playerSpec.includes('"Health"') && !playerSpec.includes('"Attention"') && !playerSpec.includes('"Threat"'), playerSpec);
    const guide = jp.buildVitalsGuidance(false, 'Eli Vega');
    check('D231: the guidance asks for a named vital by name', guide.includes('Only Roxy has "Attention"') && guide.includes('{"name": "Attention", "value": X}'), guide);
    check('D231: ...and not for the one that is the player\'s', !guide.includes('"Edge"'), guide);
    check('D231: the compact guidance does the same in fewer words', (() => { const g = jp.buildVitalsGuidance(true, 'Eli Vega'); return g.includes('Only Roxy:') && g.includes('"Attention"') && !g.includes('"Edge"'); })());
    V.setPlayedNamesSource(() => ['Jack']);
    check('D231: played as Jack, Edge is asked for on Eli\'s entry instead', jp.buildVitalsGuidance(false, 'Jack').includes('Only Eli Vega has "Edge"') && !jp.buildPlayerJSONInstruction().includes('"Edge"'));
    check('D231: a plain sheet\'s guidance is as it was', (() => {
        extensionSettings.trackerConfig.presentCharacters.characterStats = sheet().trackerConfig.presentCharacters.characterStats;
        const g = jp.buildVitalsGuidance(false, 'Jordan');
        extensionSettings.trackerConfig.presentCharacters.characterStats = scoped().trackerConfig.presentCharacters.characterStats;
        return !g.includes('Only ') && g.endsWith('follows the same rules.');
    })());

    V.setPlayedNamesSource(() => ['Eli Vega']);
    state.committedTrackerData.characterThoughts = JSON.stringify([{ name: 'Roxy', stats: [{ name: 'Health', value: 90 }, { name: 'Attention', value: 30 }] }]);
    state.committedTrackerData.player = '{"stats":[{"name":"Edge","value":40}]}';
    chat.length = 0;
    chat.push({ is_user: true, mes: 'I lean on the bar.', extra: {} });
    chat.push({ is_user: false, mes: '```json\n' + JSON.stringify({
        characters: [{ name: 'Roxy', stats: [{ name: 'Health', value: 88 }, { name: 'Attention', value: 45 }] }, { name: 'Mara', stats: [{ name: 'Health', value: 60 }] }],
        player: { stats: [{ name: 'Health', value: 75 }, { name: 'Edge', value: 52 }, { name: 'Attention', value: 9 }] },
    }) + '\n```\nRoxy looks up.', swipe_id: 0, swipes: ['x'], extra: {} });
    state.setIsAwaitingNewMessage(true);
    quiet(() => st.onMessageReceived());
    const cast = JSON.parse(state.lastGeneratedData.characterThoughts);
    check('D231: a reply leaves Roxy her Attention and gives Mara none',
        cast[0].stats.some(x => x.name === 'Attention' && x.value === 45) && !cast[1].stats.some(x => x.name === 'Attention'), JSON.stringify(cast));
    const me = JSON.parse(state.lastGeneratedData.player).stats;
    check('D231: ...and the persona their Edge, not Roxy\'s Attention', me.map(x => `${x.name}=${x.value}`).join() === 'Health=75,Edge=52,Hunger=50', JSON.stringify(me));
    check('D231: the persona\'s card takes an edit to their own vital only', th.updatePlayerVital('Edge', 70) === 70 && th.updatePlayerVital('Attention', 5) === null);
    V.setPlayedNamesSource(() => []);
    extensionSettings.trackerConfig.presentCharacters.characterStats = sheet().trackerConfig.presentCharacters.characterStats;
}

console.log(failures === 0 ? '\nAll vitals checks pass' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
