#!/usr/bin/env node
/**
 * A vital's mark (docs/long-shot-plan.md D233): the mark on a sheet entry,
 * the crossings a reply makes, the roll and the words, and the lifecycle
 * through a reply, the next generation and a swipe.
 *
 * Usage:  node tools/vital-limits-test.mjs     (from the repo root)
 * Exit:   0 = pass, 1 = failure
 *
 * The pure half needs nothing. The live half reuses the stub sandbox
 * tools/load-check.mjs builds, with `chat`, `chat_metadata` and
 * `getContext()` made real, as tools/vitals-test.mjs does.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { buildSandbox } from './sandbox.mjs';

const { SANDBOX, DES } = buildSandbox();
if (!existsSync(`${DES}/src/systems/features/vitalLimits.js`)) {
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
    { chat: globalThis.__DES_CHAT__, chat_metadata: globalThis.__DES_CHAT_METADATA__, name1: 'Eli Vega', chatId: 'test-chat' },
    { get: (t, p) => (p in t ? t[p] : anything) },
);
globalThis.window = globalThis;
globalThis.self = globalThis;
globalThis.document = anything;
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
Object.defineProperty(globalThis, 'navigator', { value: { hardwareConcurrency: 8, maxTouchPoints: 0 }, configurable: true });
globalThis.jQuery = anything;
globalThis.$ = anything;
const toasts = [];
globalThis.toastr = { info: (t) => toasts.push(['info', t]), success: (t) => toasts.push(['success', t]), warning: (t) => toasts.push(['warning', t]), error: () => {} };
globalThis.requestAnimationFrame = () => 0;
globalThis.cancelAnimationFrame = () => {};
globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });

const chat = globalThis.__DES_CHAT__;
const state = await import(`${DES}/src/core/state.js`);
const { extensionSettings } = state;
const st = await import(`${DES}/src/systems/integration/sillytavern.js`);
const V = await import(`${DES}/src/utils/vitals.js`);
const L = await import(`${DES}/src/utils/vitalLimits.js`);
const F = await import(`${DES}/src/systems/features/vitalLimits.js`);

let failures = 0;
const check = (label, cond, extra = '') => {
    if (cond) { console.log(`pass  ${label}`); }
    else { console.error(`FAIL  ${label}${extra ? '\n      ' + extra : ''}`); failures++; }
};
const quiet = (fn) => { try { return fn(); } catch (e) { return e; } };
/** A die that shows the faces given, in turn (the last again after them). */
const die = (...faces) => { let i = 0; return () => { const f = faces[Math.min(i, faces.length - 1)]; i++; return f - 1; }; };

// ── 1. The mark on a sheet entry ──
{
    const off = V.normalizeLimit(null);
    check('a vital that says nothing has no mark', off.when === 'off' && off.does === 'note' && off.at === 100 && off.dc === V.DEFAULT_LIMIT_DC && off.passTo === null && off.failTo === null && off.note === '');
    check('...and every sheet entry carries the whole mark', JSON.stringify(V.normalizeVitalDef({ name: 'Health' }).limit) === JSON.stringify(off));
    check('a rise sits at the top and a fall at the bottom unless told where', V.normalizeLimit({ when: 'rise' }).at === 100 && V.normalizeLimit({ when: 'fall' }).at === 0 && V.normalizeLimit({ when: 'fall', at: '25%' }).at === 25);
    const l = V.normalizeLimit({ when: 'sideways', does: 'explode', dc: 99, at: 140, passTo: '', failTo: '20', attr: 7, note: ' two\n lines ', pass: 'x'.repeat(400) });
    check('garbage is made safe', l.when === 'off' && l.does === 'note' && l.dc === 40 && l.at === 100 && l.passTo === null && l.failTo === 20 && l.attr === '' && l.note === 'two lines' && l.pass.length === 300, JSON.stringify(l));
    check('a DC that is not a number is the default', V.normalizeLimit({ dc: 'hard' }).dc === V.DEFAULT_LIMIT_DC && V.normalizeLimit({ dc: 0 }).dc === 1);
}

const edge = V.normalizeVitalDef({ id: 'edge', name: 'Edge', icon: '⚡', start: 0, who: 'named', names: ['Eli Vega'], show: 'percent',
    limit: { when: 'rise', at: 100, does: 'roll', dc: 13, pass: 'Eli holds on by a thread', fail: 'Eli blacks out. Cut to the aftermath', failTo: 20 } });
const attention = V.normalizeVitalDef({ id: 'attention', name: 'Attention', start: 10, who: 'named', names: ['Roxy'], show: 'level',
    rungs: [{ at: 0, label: 'Unaware' }, { at: 25, label: 'Curious' }, { at: 50, label: 'Interested' }, { at: 75, label: 'Fixated' }],
    limit: { when: 'rise', at: 75, does: 'note', note: 'Roxy starts turning up where Eli is' } });
const health = V.normalizeVitalDef({ id: 'health', name: 'Health', start: 100, limit: { when: 'fall', at: 0, does: 'note', note: 'They drop' } });

// ── 2. Reaching the mark ──
{
    check('a rise reaches the mark from under it', V.limitCrossed(edge, 90, 100) && V.limitCrossed(attention, 74, 75) && V.limitCrossed(attention, 10, 99));
    check('...and not again while the value stays past it', !V.limitCrossed(edge, 100, 100) && !V.limitCrossed(attention, 80, 90) && !V.limitCrossed(attention, 90, 80));
    check('...nor short of it', !V.limitCrossed(edge, 10, 99));
    check('a fall reaches the mark from over it', V.limitCrossed(health, 5, 0) && !V.limitCrossed(health, 0, 0) && !V.limitCrossed(health, 50, 1));
    check('a value with no past came from the vital\'s start', V.limitCrossed(attention, undefined, 80) && !V.limitCrossed(health, undefined, 100) && V.limitCrossed(health, undefined, 0));
    check('a vital with no mark reaches nothing', !V.limitCrossed(V.normalizeVitalDef({ name: 'Mana' }), 0, 100) && !V.limitCrossed(edge, 90, undefined));

    const defs = [health, edge, attention];
    const prevChars = JSON.stringify([{ name: 'Roxy', stats: [{ name: 'Health', value: 90 }, { name: 'Attention', value: 60 }] }, { name: 'Mara', stats: [{ name: 'Health', value: 4 }] }]);
    const nextChars = JSON.stringify({ characters: [
        { name: 'roxy', stats: [{ name: 'Health', value: 90 }, { name: 'Attention', value: 78 }] },
        { name: 'Mara', stats: [{ name: 'Health', value: 0 }, { name: 'Attention', value: 99 }] },
        { name: 'Jun', stats: [{ name: 'Health', value: 100 }] },
    ] });
    const playerDefs = [health, edge];
    const found = V.limitsCrossed({ defs, prevChars, nextChars, playerDefs, prevPlayer: '{"stats":[{"name":"Health","value":80},{"name":"Edge","value":88}]}', nextPlayer: '{"stats":[{"name":"Health","value":80},{"name":"Edge","value":100}]}', playerName: 'Eli Vega' });
    check('a reply\'s crossings: characters first, then the persona', found.map(c => `${c.who}/${c.def.name}/${c.prev}>${c.next}/${c.isPlayer}`).join() === 'roxy/Attention/60>78/false,Mara/Health/4>0/false,Eli Vega/Edge/88>100/true', found.map(c => `${c.who}/${c.def.name}/${c.prev}>${c.next}`).join());
    check('a vital on a character who does not carry it reaches nothing', !found.some(c => c.who === 'Mara' && c.def.name === 'Attention'));
    check('no marks, no crossings', V.limitsCrossed({ defs: [V.normalizeVitalDef({ name: 'Mana' })], prevChars, nextChars }).length === 0 && V.limitsCrossed().length === 0);
    check('data that is not JSON reaches nothing', V.limitsCrossed({ defs, prevChars: 'Present Characters\n---', nextChars: 'nope', playerDefs, nextPlayer: 'nope' }).length === 0);

    check('setVitalValue writes a character\'s value by name', JSON.parse(V.setVitalValue(nextChars, { who: 'ROXY', vital: 'attention', value: 40 })).characters[0].stats[1].value === 40);
    check('...the persona\'s in its block', V.setVitalValue('{"stats":[{"name":"Edge","value":100}]}', { isPlayer: true, vital: 'Edge', value: 20 }) === '{"stats":[{"name":"Edge","value":20}]}');
    check('...and leaves the data alone when there is nothing to write', V.setVitalValue(nextChars, { who: 'Nobody', vital: 'Edge', value: 1 }) === nextChars && V.setVitalValue('nope', { isPlayer: true, vital: 'Edge', value: 1 }) === 'nope' && V.setVitalValue(nextChars, { who: 'Roxy', vital: 'Edge', value: 'x' }) === nextChars);
}

// A vital whose mark is at the top warns of nothing at the bottom.
check('a low value warns, except on a vital whose mark is reached on a rise',
    V.vitalIsLow(health, 20, 25) && !V.vitalIsLow(health, 26, 25) && !V.vitalIsLow(edge, 5, 25) && V.vitalColor(edge, 5, 25) === edge.color && V.vitalColor(health, 5, 25) === V.LOW_VITAL_COLOR && !V.vitalIsLow(health, 'x', 25));

// ── 3. The roll and the words ──
{
    const crossing = { def: edge, who: 'Eli Vega', isPlayer: true, prev: 88, next: 100 };
    const failed = L.settleLimit(crossing, { rng: die(7), now: 5 });
    check('a failed roll: the record', failed.does === 'roll' && failed.success === false && failed.roll.kept === 7 && failed.roll.total === 7 && failed.roll.dc === 13 && failed.to === 20 && failed.text === 'Eli blacks out. Cut to the aftermath' && failed.from === 88 && failed.value === 100 && failed.ts === 5, JSON.stringify(failed));
    const passed = L.settleLimit(crossing, { rng: die(13), now: 5 });
    check('a passed roll leaves the value where it is unless told', passed.success === true && passed.to === null && passed.text === 'Eli holds on by a thread');
    check('a natural 20 passes and a natural 1 fails whatever the DC', L.settleLimit({ ...crossing, def: { ...edge, limit: { ...edge.limit, dc: 40 } } }, { rng: die(20) }).success === true
        && L.settleLimit({ ...crossing, def: { ...edge, limit: { ...edge.limit, dc: 1 } } }, { rng: die(1) }).success === false);
    check('...unless criticals are off', L.settleLimit({ ...crossing, def: { ...edge, limit: { ...edge.limit, dc: 1 } } }, { rng: die(1), criticals: false }).success === true);
    const withSheet = L.settleLimit(crossing, { rng: die(9), sheet: { attribute: 'Wisdom', abbr: 'WIS', score: 14, proficiency: 2 } });
    check('an attribute\'s modifier and save proficiency ride on the die', withSheet.roll.total === 13 && withSheet.success === true && withSheet.roll.abbr === 'WIS');
    check('the math says a bare die plainly', L.limitMath(failed.roll) === 'd20 = 7 vs DC 13');
    check('...and what rode on it', L.limitMath(withSheet.roll) === 'd20 = 9, +2 (WIS 14), +2 (proficient in Wisdom saves) = 13 vs DC 13');
    const v = L.limitVerdict(failed);
    check('the narrator is handed the move, the roll, the outcome, what follows and where the value stands',
        v === "[STAT: Eli Vega's Edge has risen to 100%, reaching its mark of 100%. A roll decides what follows: d20 = 7 vs DC 13. FAILURE. Eli blacks out. Cut to the aftermath. This outcome is final: narrate it in this reply. Do not re-roll, reverse or soften it. Edge now stands at 20%: carry on from there.]", v);
    const note = L.settleLimit({ def: attention, who: 'Roxy', isPlayer: false, prev: 60, next: 78 }, { now: 5 });
    check('a note: the record has no roll', note.does === 'note' && note.roll === null && note.success === null && note.to === null && note.level === 'Fixated');
    check('...and the narrator is handed the note, with the level reached', L.limitVerdict(note) === "[STAT: Roxy's Attention has risen to 78% (\"Fixated\"), reaching its mark of 75%. Roxy starts turning up where Eli is.]", L.limitVerdict(note));
    check('a mark with nothing to say still says it was reached', L.limitVerdict({ ...note, text: '' }).endsWith('reaching its mark of 75%. Let this reply show it.]'));
    check('a fall is said as a fall', L.limitVerdict(L.settleLimit({ def: health, who: 'Mara', isPlayer: false, prev: 4, next: 0 })).startsWith("[STAT: Mara's Health has fallen to 0%, reaching its mark of 0%. They drop."));
    const both = L.limitVerdicts([note, failed]);
    check('several verdicts end with the reminder that the reply\'s shape stands', both.split('\n').length === 3 && both.endsWith(`[${L.LIMIT_STILL_REQUIRED}]`) && L.limitVerdicts([]) === '' && L.limitVerdicts(null) === '');
    check('the player\'s line for a roll', L.limitLine(failed) === 'Eli Vega · Edge reached 100% · d20 7 vs DC 13 · Failed' && L.limitOutcome(passed) === 'Passed' && L.limitOutcome(note) === '');
    check('...and for a note', L.limitLine(note) === 'Roxy · Attention reached 78%');
}

// ── 4. Through a reply, the next generation and a swipe ──
extensionSettings.enabled = true;
extensionSettings.generationMode = 'together';
extensionSettings.showCharacterThoughts = true;
extensionSettings.trackerConfig.presentCharacters.characterStats = { enabled: true, player: { enabled: true }, customStats: [
    { id: 'health', name: 'Health', enabled: true, start: 100, ai: true },
    { id: 'edge', name: 'Edge', icon: '⚡', enabled: true, start: 0, ai: true, who: 'named', names: ['Eli Vega'], show: 'percent',
        limit: { when: 'rise', at: 100, does: 'roll', dc: 13, pass: 'Eli holds on by a thread', fail: 'Eli blacks out. Cut to the aftermath', failTo: 20 } },
    { id: 'attention', name: 'Attention', enabled: true, start: 10, ai: true, who: 'named', names: ['Roxy'], show: 'level',
        rungs: [{ at: 0, label: 'Unaware' }, { at: 25, label: 'Curious' }, { at: 50, label: 'Interested' }, { at: 75, label: 'Fixated' }],
        limit: { when: 'rise', at: 75, does: 'note', note: 'Roxy starts turning up where Eli is' } },
] };
V.setPlayedNamesSource(() => ['Eli Vega']);
const reply = (edgeValue, attentionValue, prose = 'The bar goes quiet.') => '```json\n' + JSON.stringify({
    characters: [{ name: 'Roxy', stats: [{ name: 'Health', value: 90 }, { name: 'Attention', value: attentionValue }] }],
    player: { stats: [{ name: 'Health', value: 80 }, { name: 'Edge', value: edgeValue }] },
}) + '\n```\n' + prose;
const receive = () => { state.setIsAwaitingNewMessage(true); return quiet(() => st.onMessageReceived()); };
const playerEdge = () => V.readVitals(JSON.parse(state.lastGeneratedData.player).stats, V.playerVitalDefs(extensionSettings)).Edge;

check('the marks are on while a vital in use has one', F.vitalLimitsOn());
state.committedTrackerData.characterThoughts = JSON.stringify([{ name: 'Roxy', stats: [{ name: 'Health', value: 90 }, { name: 'Attention', value: 60 }] }]);
state.committedTrackerData.player = '{"stats":[{"name":"Health","value":80},{"name":"Edge","value":70}]}';

chat.length = 0;
chat.push({ is_user: true, mes: 'I order another.', extra: {} });
chat.push({ is_user: false, mes: reply(85, 70), swipe_id: 0, swipes: ['x'], extra: {} });
receive();
check('a reply that reaches no mark keeps no record', F.vitalEventsOf(chat[1]).length === 0 && !chat[1].extra.dooms_vital_events && toasts.length === 0);
check('...and the next generation is told nothing', (() => { chat.push({ is_user: true, mes: 'And?', extra: {} }); const t = F.buildVitalLimitsForGeneration(); chat.pop(); return t === ''; })());

// The reply carries Edge to 100 and Attention past 75: a failed roll and a note.
F.__setVitalLimitRng(die(7));
chat.length = 0;
chat.push({ is_user: true, mes: 'I put the glass down hard.', extra: {} });
chat.push({ is_user: false, mes: reply(100, 80), swipe_id: 0, swipes: ['x'], extra: {} });
receive();
let events = F.vitalEventsOf(chat[1]);
check('a reply that reaches two marks keeps two records, the character\'s first', events.length === 2 && events[0].vital === 'Attention' && events[0].does === 'note' && events[1].vital === 'Edge' && events[1].does === 'roll', JSON.stringify(events));
check('the roll was made there and then', events[1].roll.kept === 7 && events[1].success === false && events[1].who === 'Eli Vega' && events[1].isPlayer === true);
check('the value the failure leaves it at is in the tracker data', playerEdge() === 20, String(playerEdge()));
check('...and in the swipe store', V.readVitals(JSON.parse(chat[1].extra.dooms_tracker_swipes[0].player).stats, V.playerVitalDefs(extensionSettings)).Edge === 20);
check('the player is told both', toasts.length === 2 && toasts[0][0] === 'info' && toasts[0][1] === 'Roxy · Attention reached 80%' && toasts[1][0] === 'warning' && toasts[1][1] === 'Eli Vega · Edge reached 100% · d20 7 vs DC 13 · Failed', JSON.stringify(toasts));

check('nothing is said to the narrator until the player answers', F.buildVitalLimitsForGeneration() === '');
chat.push({ is_user: true, mes: 'What happened?', extra: {} });
const told = F.buildVitalLimitsForGeneration();
check('the next generation is told both, the reminder last', told.split('\n').length === 3 && told.includes("Roxy's Attention has risen to 80% (\"Fixated\")") && told.includes('d20 = 7 vs DC 13. FAILURE. Eli blacks out. Cut to the aftermath.') && told.includes('Edge now stands at 20%') && told.endsWith(`[${L.LIMIT_STILL_REQUIRED}]`), told);
chat.push({ is_user: false, mes: reply(25, 80, 'Eli wakes in the alley.'), swipe_id: 0, swipes: ['x'], extra: {} });
check('a swipe or regenerate of the answer is told the same', F.buildVitalLimitsForGeneration() === told);
chat.push({ is_user: true, mes: 'I get up.', extra: {} });
check('the reply after is told nothing more', F.buildVitalLimitsForGeneration() === '');
chat.length = 2;

// A group, or a second reply asked for without a word from the player:
// every reply the player's message answers is told, oldest first.
{
    const mark = (vital, who) => ({ vital, who, isPlayer: false, when: 'rise', at: 75, value: 80, from: 60, level: '', does: 'note', text: `${who} is told`, roll: null, success: null, to: null });
    const keep = chat.slice();
    chat.length = 0;
    chat.push({ is_user: true, mes: 'Hello all.', extra: {} });
    chat.push({ is_user: false, mes: 'a', swipe_id: 0, extra: { dooms_vital_events: { 0: [mark('Attention', 'Roxy')] } } });
    chat.push({ is_user: false, is_system: true, mes: 'hidden', extra: {} });
    chat.push({ is_user: false, mes: 'b', swipe_id: 0, extra: {} });
    chat.push({ is_user: false, mes: 'c', swipe_id: 0, extra: { dooms_vital_events: { 0: [mark('Attention', 'Mara')] } } });
    check('a second reply with no word from the player between is told nothing yet', F.buildVitalLimitsForGeneration() === '');
    chat.push({ is_user: true, mes: 'Well?', extra: {} });
    const both = F.buildVitalLimitsForGeneration();
    check('every reply the player answers is told, oldest first', both.split('\n').length === 3 && both.indexOf("Roxy's Attention") >= 0 && both.indexOf("Roxy's Attention") < both.indexOf("Mara's Attention"), both);
    chat.length = 0;
    chat.push(...keep);
}

// A second pass over the same swipe rolls nothing, and writes the value again.
toasts.length = 0;
F.__setVitalLimitRng(die(19));
receive();
events = F.vitalEventsOf(chat[1]);
check('a second pass over the same reply rolls nothing', events.length === 2 && events[1].roll.kept === 7 && toasts.length === 0);
check('...and the value stays where the roll left it', playerEdge() === 20);

// A new swipe of the same reply is a new reply: its own roll.
chat[1].swipe_id = 1;
chat[1].swipes.push('y');
receive();
events = F.vitalEventsOf(chat[1]);
check('a new swipe rolls again', events.length === 2 && events[1].roll.kept === 19 && events[1].success === true && toasts.length === 2 && toasts[1][0] === 'success');
check('...and a pass leaves the value where the reply put it', playerEdge() === 100);
chat[1].swipe_id = 0;
check('back on the first swipe, its own record is the one in front', F.vitalEventsOf(chat[1])[1].roll.kept === 7);
check('a swipe SillyTavern put away is read from where it was kept', (() => {
    const m = { is_user: false, swipe_id: 0, extra: {}, swipe_info: [{ extra: { dooms_vital_events: { 0: [{ vital: 'Edge', does: 'note', who: 'Eli Vega' }] } } }] };
    return F.vitalEventsOf(m).length === 1;
})());

// Past the mark already: nothing new. Attributes on: the modifier rides.
toasts.length = 0;
state.committedTrackerData.player = '{"stats":[{"name":"Health","value":80},{"name":"Edge","value":100}]}';
state.committedTrackerData.characterThoughts = JSON.stringify([{ name: 'Roxy', stats: [{ name: 'Health', value: 90 }, { name: 'Attention', value: 80 }] }]);
chat.length = 0;
chat.push({ is_user: true, mes: 'Still here.', extra: {} });
chat.push({ is_user: false, mes: reply(100, 90), swipe_id: 0, swipes: ['x'], extra: {} });
receive();
check('a value that stays past its mark reaches it once only', F.vitalEventsOf(chat[1]).length === 0 && toasts.length === 0);

extensionSettings.attributes = { enabled: true, proficiencyBonus: 2, list: [{ id: 'wis', name: 'Wisdom', abbr: 'WIS', enabled: true }] };
extensionSettings.characterAttributes = { 'user:Eli Vega': { wis: 14, _prof: ['wis:save'] } };
extensionSettings.trackerConfig.presentCharacters.characterStats.customStats[1].limit.attr = 'wis';
state.committedTrackerData.player = '{"stats":[{"name":"Health","value":80},{"name":"Edge","value":60}]}';
F.__setVitalLimitRng(die(9));
chat.length = 0;
chat.push({ is_user: true, mes: 'I breathe.', extra: {} });
chat.push({ is_user: false, mes: reply(100, 90), swipe_id: 0, swipes: ['x'], extra: {} });
receive();
events = F.vitalEventsOf(chat[1]);
check('with attributes on, the named attribute\'s modifier rides on the die', events.length === 1 && events[0].roll.mod === 2 && events[0].roll.abbr === 'WIS', JSON.stringify(events[0] && events[0].roll));
check('...and the save proficiency the sheet has', events[0].roll.prof === 2 && events[0].roll.total === 13 && events[0].success === true, JSON.stringify(events[0] && events[0].roll));
extensionSettings.attributes.enabled = false;
F.__setVitalLimitRng(die(9));
chat[1].swipe_id = 1;
receive();
check('with attributes off, the same mark rolls a bare die', F.vitalEventsOf(chat[1])[0].roll.total === 9 && F.vitalEventsOf(chat[1])[0].roll.abbr === '' && F.vitalEventsOf(chat[1])[0].success === false);
chat[1].swipe_id = 0;

// The box under the reply.
{
    const failedCard = F.vitalCardHtml({ vital: 'Edge', icon: '⚡', who: 'Eli Vega', isPlayer: true, when: 'rise', at: 100, from: 88, value: 100, level: '', does: 'roll', text: 'Eli blacks out <now>', roll: { kept: 7, mod: 0, prof: 0, total: 7, dc: 13, success: false, critical: null, attribute: '', abbr: '', score: null }, success: false, to: 20 });
    check('the box for a failed roll', failedCard.includes('dooms-vital-card is-failure') && failedCard.includes('Eli Vega: Edge reached 100%') && failedCard.includes('d20 7 vs DC 13') && failedCard.includes('>Failed<') && failedCard.includes('Edge set to 20%'), failedCard);
    check('...escapes what the sheet wrote', failedCard.includes('Eli blacks out &lt;now&gt;') && !failedCard.includes('<now>'));
    const noteCard = F.vitalCardHtml({ vital: 'Attention', icon: '', who: 'Roxy', isPlayer: false, when: 'rise', at: 75, value: 80, level: 'Fixated', does: 'note', text: 'Roxy starts turning up', roll: null, success: null, to: null });
    check('the box for a note has no roll and no outcome', noteCard.includes('dooms-vital-card is-note') && noteCard.includes('(Fixated)') && !noteCard.includes('dooms-roll-outcome') && noteCard.includes('Next reply: Roxy starts turning up'), noteCard);
}

// Off: no mark, or vitals off.
extensionSettings.trackerConfig.presentCharacters.characterStats.enabled = false;
check('vitals off: nothing is settled and nothing is said', !F.vitalLimitsOn() && F.buildVitalLimitsForGeneration() === '' && F.settleVitalLimits({ player: '{}' }, chat[1]).length === 0);
extensionSettings.trackerConfig.presentCharacters.characterStats.enabled = true;
for (const e of extensionSettings.trackerConfig.presentCharacters.characterStats.customStats) delete e.limit;
check('no vital with a mark: the same', !F.vitalLimitsOn());
F.__setVitalLimitRng(null);
V.setPlayedNamesSource(() => []);

console.log(failures === 0 ? '\nAll vital-limits checks pass' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
