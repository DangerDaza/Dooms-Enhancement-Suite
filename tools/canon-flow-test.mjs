#!/usr/bin/env node
/**
 * Canon in the chat (docs/hooks-canon-plan.md D105–D112): the ledger kept
 * per chat, a reply counted once, the run through the background wrapper
 * with its reply applied or discarded, the block that rides a generation,
 * a line of your own pinned through a run, the rewind on a deleted reply,
 * the lorebook export through a fake lorebook, the chat switch.
 *
 * Usage:  node tools/canon-flow-test.mjs     (from the repo root)
 * Exit:   0 = pass, 1 = failure
 *
 * Same sandbox as tools/live-world-flow-test.mjs; the request is replaced
 * through the module's test hook, so no profile switch and no network.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { buildSandbox } from './sandbox.mjs';

const { SANDBOX, DES } = buildSandbox();
if (!existsSync(`${DES}/src/systems/features/canon.js`)) {
    console.error('FAIL: sandbox missing after load-check — cannot run.');
    process.exit(1);
}

globalThis.__DES_CHAT__ = [];
globalThis.__DES_CHAT_METADATA__ = {};
globalThis.__DES_SLOTS__ = {};
const scriptStub = `${SANDBOX}/script.js`;
writeFileSync(scriptStub, readFileSync(scriptStub, 'utf8')
    .replace('export const chat_metadata = anything;', 'export const chat_metadata = globalThis.__DES_CHAT_METADATA__;')
    .replace('export const chat = anything;', 'export const chat = globalThis.__DES_CHAT__;')
    .replace('export const setExtensionPrompt = anything;', 'export const setExtensionPrompt = (key, value, position, depth, scan, role) => { globalThis.__DES_SLOTS__[key] = { value, position, depth, role }; };')
    .replace('export const extension_prompt_roles = anything;', 'export const extension_prompt_roles = { SYSTEM: 0, USER: 1, ASSISTANT: 2 };')
    .replace('export const extension_prompt_types = anything;', 'export const extension_prompt_types = { IN_PROMPT: 0, IN_CHAT: 1 };')
    .replace('export const saveChatDebounced = anything;', 'export const saveChatDebounced = () => { globalThis.__DES_SAVES__.debounced++; };')
    .replace('export const saveChatConditional = anything;', 'export const saveChatConditional = async () => { globalThis.__DES_SAVES__.immediate++; };')
    + '\nexport let is_send_press = false;\nexport const __setSendPress = (v) => { is_send_press = v; };\n');
globalThis.__DES_SAVES__ = { debounced: 0, immediate: 0 };
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
    { chat: globalThis.__DES_CHAT__, chat_metadata: globalThis.__DES_CHAT_METADATA__, name1: 'Jordan', name2: 'Mara Vane', chatId: 'test-chat', user_avatar: '' },
    { get: (t, p) => (p in t ? t[p] : anything) },
);
globalThis.window = globalThis;
globalThis.self = globalThis;
globalThis.document = anything;
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
Object.defineProperty(globalThis, 'navigator', { value: { hardwareConcurrency: 8, maxTouchPoints: 0 }, configurable: true });
globalThis.jQuery = anything;
globalThis.$ = anything;
globalThis.toastr = anything;
globalThis.requestAnimationFrame = () => 0;
globalThis.cancelAnimationFrame = () => {};
globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
globalThis.fetch = async () => ({ ok: false, status: 404, json: async () => ({}) });
globalThis.CustomEvent = class { constructor(type, init) { this.type = type; this.detail = init && init.detail; } };
globalThis.dispatchEvent = () => true;

const chat = globalThis.__DES_CHAT__;
const meta = globalThis.__DES_CHAT_METADATA__;
const slots = globalThis.__DES_SLOTS__;
const saves = globalThis.__DES_SAVES__;
const state = await import(`${DES}/src/core/state.js`);
const { extensionSettings, lastGeneratedData, committedTrackerData } = state;
const cn = await import(`${DES}/src/systems/features/canon.js`);
const STUB = await import(`${SANDBOX}/script.js`);

let failures = 0;
const check = (label, cond, extra = '') => {
    if (cond) { console.log(`pass  ${label}`); }
    else { console.error(`FAIL  ${label}${extra ? '\n      ' + extra : ''}`); failures++; }
};
const user = (mes) => ({ is_user: true, name: 'Jordan', mes, extra: {} });
const ai = (mes) => ({ is_user: false, name: 'Narrator', mes, swipe_id: 0, swipes: [mes], extra: {} });
const resetMeta = () => { for (const k of Object.keys(meta)) delete meta[k]; };
const wait = (ms) => new Promise(r => setTimeout(r, ms));

extensionSettings.enabled = true;
extensionSettings.generationMode = 'together';
extensionSettings.connectionProfile = '';
extensionSettings.userCharacters = {};
extensionSettings.canon = { enabled: true, every: 2, recentMessages: 6, inject: true, depth: 3, role: 'system', maxChars: 1500 };
lastGeneratedData.infoBox = '{"date":"Tuesday","time":"dusk","location":"the quay"}';
lastGeneratedData.characterThoughts = JSON.stringify({ characters: [{ name: 'Old Marit', thoughts: 'x' }] });
committedTrackerData.characterThoughts = null;

console.log('\n§1 the ledger and the count');
resetMeta(); chat.length = 0;
cn.onCanonChatChanged();
let s = cn.getCanon();
check('a new chat starts with an empty ledger, nothing written yet', !!s && s.entries.length === 0 && s.sinceLast === 0 && !meta.dooms_canon);
chat.push(user('I walk down to the quay.'));
chat.push(ai('Old Marit mends a net on the quay.'));
cn.onCanonMessageReceived();
s = cn.getCanon();
check('a fresh reply counts once and gets a stamp, saved debounced', s.sinceLast === 1 && typeof chat[1].dooms_canon_id === 'string' && s.counted.includes(chat[1].dooms_canon_id) && saves.debounced === 1);
cn.onCanonMessageReceived();
check('the same reply again does not count', cn.getCanon().sinceLast === 1);
check('nothing rides a generation yet (an empty ledger)', (cn.onCanonGenerationStarted(undefined, {}, false), slots['dooms-canon'].value === ''));

console.log('\n§2 the run');
let lastPrompt = null;
cn.__setCanonTransport(async (prompt) => { lastPrompt = prompt; return '```json\n{"add":[{"kind":"person","name":"Old Marit","text":"Mends nets on the quay and keeps the Anchor."},{"kind":"place","name":"The quay","text":"Slick with rain; where the story found Old Marit."},{"kind":"promise","name":"The net","text":"Old Marit will mend Jordan\'s net by dusk."}],"drop":[]}\n```'; });
chat.push(user('I ask about her net.'));
chat.push(ai('"By dusk," she says.'));
cn.onCanonMessageReceived();
check('the second reply is due; the run is scheduled, not run at once', cn.getCanon().sinceLast === 2 && cn.getCanon().entries.length === 0);
await wait(1800);
s = cn.getCanon();
check('the run: the request carried the scenes and the names; three lines written, stamped on the reply, the count restarted, saved at once', s.entries.length === 3 && s.entries[0].name === 'Old Marit' && s.entries[0].msgId === chat[3].dooms_canon_id && s.entries[0].gameDate === 'Tuesday' && s.sinceLast === 0 && s.last.ok && s.last.added === 3 && lastPrompt && lastPrompt.user.includes('Narrator: "By dusk," she says.') && lastPrompt.user.includes('Names the story knows: Old Marit') && lastPrompt.system.includes('(Jordan) is never an entry') && saves.immediate >= 1, JSON.stringify(s));
check('the block rides a generation at the configured depth and role, raw', (cn.onCanonGenerationStarted(undefined, {}, false), slots['dooms-canon'].value.includes('[CANON — what the story has established. People: Old Marit: Mends nets on the quay') && slots['dooms-canon'].value.includes('Promises: The net:') && slots['dooms-canon'].depth === 3 && slots['dooms-canon'].role === 0 && slots['dooms-canon'].position === 1));
check('a quiet prompt gets nothing', (cn.onCanonGenerationStarted('quiet', {}, false), slots['dooms-canon'].value === ''));
extensionSettings.canon.inject = false;
check('inject off: the slot is emptied', (cn.onCanonGenerationStarted(undefined, {}, false), slots['dooms-canon'].value === ''));
extensionSettings.canon.inject = true;

console.log('\n§3 your line stands, a change replaces, a drop drops');
const mine = cn.addCanonLine({ kind: 'secret', name: 'The ring', text: 'Hidden in the chandlery; only Jordan knows.' });
check('a line of your own: pinned, by you, saved at once', mine && mine.pinned && mine.by === 'you' && cn.getCanon().entries.length === 4);
cn.__setCanonTransport(async () => '{"add":[{"kind":"secret","name":"The ring","text":"Everyone knows now."},{"kind":"person","name":"Old Marit","text":"Keeps the Anchor; owes the governor."}],"drop":["The quay"]}');
const r = await cn.updateCanon({ reason: 'manual' });
s = cn.getCanon();
check('a manual run: the pinned line refused (said in the errors), the changed line replaced, the unpinned place dropped', r.ok && r.added === 1 && r.dropped === 1 && r.errors[0].includes('pinned') && s.entries.find(e => e.name === 'The ring').text === 'Hidden in the chandlery; only Jordan knows.' && s.entries.find(e => e.name === 'Old Marit').text === 'Keeps the Anchor; owes the governor.' && !s.entries.some(e => e.name === 'The quay'), JSON.stringify(r));
check('edit, pin off and on, remove', cn.editCanonLine(mine.id, { text: 'Hidden in the chandlery.' }).text === 'Hidden in the chandlery.' && cn.pinCanonLine(mine.id, false) && !cn.getCanon().entries.find(e => e.id === mine.id).pinned && cn.pinCanonLine(mine.id, true) && cn.removeCanonLine(mine.id) && !cn.getCanon().entries.some(e => e.id === mine.id) && cn.removeCanonLine('nope') === false);

console.log('\n§4 a reply that breaks the rules, a request that fails');
cn.__setCanonTransport(async () => 'I would rather not.');
const bad = await cn.updateCanon({ reason: 'manual' });
s = cn.getCanon();
check('no JSON: discarded, retry on the next reply, the ledger untouched', !bad.ok && bad.reason === 'invalid' && s.retryNext && s.lastError && s.lastError.kind === 'invalid' && s.entries.length === 2);
cn.__setCanonTransport(async () => { throw new Error('network down'); });
const err = await cn.updateCanon({ reason: 'manual' });
check('a request that fails: noted as an error', !err.ok && err.reason === 'error' && cn.getCanon().lastError.error === 'network down');
cn.__setCanonTransport(async () => '{"add":[]}');
const none = await cn.updateCanon({ reason: 'manual' });
check('nothing new is a sound run: the retry cleared', none.ok && none.added === 0 && !cn.getCanon().retryNext && cn.getCanon().lastError === null);

console.log('\n§5 the rewind');
chat.push(user('Later.'));
chat.push(ai('The tide turns.'));
cn.__setCanonTransport(async () => '{"add":[{"kind":"fact","name":"The tide","text":"Turned at dusk."}]}');
cn.onCanonMessageReceived();
await cn.updateCanon({ reason: 'manual' });
s = cn.getCanon();
const tideId = chat[5].dooms_canon_id;
check('a line stamped on the latest reply', s.entries.find(e => e.name === 'The tide').msgId === tideId && s.counted.includes(tideId));
chat.splice(4, 2);
cn.onCanonMessageDeleted();
s = cn.getCanon();
check('the reply deleted: its line and its count go; the earlier lines stand', !s.entries.some(e => e.name === 'The tide') && !s.counted.includes(tideId) && s.entries.length === 2 && s.last === null, JSON.stringify(s.entries.map(e => e.name)));

console.log('\n§6 the export, the chat switch, the switch off');
const books = {};
cn.__setCanonLorebook({
    names: () => Object.keys(books),
    createWorld: async (name) => { books[name] = { entries: {} }; },
    load: async (name) => books[name],
    createEntry: (name, data) => { const uid = Object.keys(data.entries).length; data.entries[uid] = { uid, key: [], content: '', comment: '', disable: false }; return data.entries[uid]; },
    save: async (name, data) => { books[name] = data; },
});
const ex = await cn.exportCanonToLorebook();
const book = books['Canon of Mara Vane'];
check('exported to "Canon of <the chat\'s character>": one entry per line, keyed by its name', ex.ok && ex.book === 'Canon of Mara Vane' && ex.written === 2 && book && Object.keys(book.entries).length === 2 && Object.values(book.entries).some(e => e.comment === 'Canon · person: Old Marit' && e.key[0] === 'Old Marit' && e.content.startsWith('Old Marit: Keeps the Anchor')));
cn.addCanonLine({ kind: 'fact', name: 'The blockade', text: 'Tightens by the day.' });
const ex2 = await cn.exportCanonToLorebook();
check('exported again: the same entries rewritten, the new one added, nothing doubled', ex2.ok && ex2.written === 3 && Object.keys(books['Canon of Mara Vane'].entries).length === 3);
check('the markdown', cn.canonMarkdownNow().startsWith('# Canon of Mara Vane') && cn.canonMarkdownNow().includes('- **The blockade**: Tightens by the day.'));
const saved = JSON.parse(JSON.stringify(meta.dooms_canon));
const savedChat = chat.slice();
resetMeta(); chat.length = 0; globalThis.__DES_CTX__.chatId = 'other-chat';
cn.onCanonChatChanged();
check('another chat: its own ledger, empty', cn.getCanon().entries.length === 0);
meta.dooms_canon = saved; globalThis.__DES_CTX__.chatId = 'test-chat';
chat.push(...savedChat);
cn.onCanonChatChanged();
check('coming back loads the stored ledger, its lines still standing on their replies', cn.getCanon().entries.length === 3 && cn.getCanon().entries.some(e => e.name === 'Old Marit'));
chat.length = 0; chat.push(user('A new history.')); chat.push(ai('Nobody here.'));
cn.onCanonChatChanged();
check('a history that no longer holds the replies: their lines go, the pinned line stays (D109)', cn.getCanon().entries.length === 1 && cn.getCanon().entries[0].name === 'The blockade');
extensionSettings.canon.enabled = false;
cn.onCanonChatChanged();
check('Canon off: no ledger, the slot emptied, nothing counted', cn.getCanon() === null && slots['dooms-canon'].value === '' && (cn.onCanonMessageReceived(), cn.getCanon() === null));

console.log('\n§7 a message that fed a run, deleted, swiped or regenerated: the run taken back and redone');
extensionSettings.canon = { enabled: true, every: 50, recentMessages: 6, inject: true, depth: 3, role: 'system', maxChars: 1500 };
resetMeta(); chat.length = 0; globalThis.__DES_CTX__.chatId = 'rollback-chat';
cn.onCanonChatChanged();
const answer = (obj) => async (prompt) => { asked.push(prompt.user); return JSON.stringify(obj); };
let asked = [];
chat.push(user('I meet the smith.'));
chat.push(ai('Hask the smith grunts a greeting.'));
chat.push(user('I ask about the sword.'));
chat.push(ai('"Done by the new moon," Hask says.'));
cn.onCanonMessageReceived();
cn.__setCanonTransport(answer({ add: [{ kind: 'person', name: 'Hask', text: 'The smith; gruff.' }, { kind: 'promise', name: 'The sword', text: 'Hask will finish it by the new moon.' }] }));
let r7 = await cn.updateCanon({ reason: 'manual' });
s = cn.getCanon();
check('a run notes what it read, one version id per message, and what it added', r7.ok && s.runs.length === 1 && s.runs[0].read.length === 4 && s.runs[0].added.length === 2 && chat.every(m => m.dooms_canon_v && typeof m.dooms_canon_v['0'] === 'string'), JSON.stringify(s.runs));
cn.addCanonLine({ kind: 'secret', name: 'The ore', text: 'Stolen from the mine.' });
chat.push(user('I wait.'));
chat.push(ai('Hask hammers; the sword is nearly done.'));
cn.__setCanonTransport(answer({ add: [{ kind: 'promise', name: 'The sword', text: 'Nearly done.' }], drop: ['Hask'] }));
r7 = await cn.updateCanon({ reason: 'manual' });
s = cn.getCanon();
check('a second run rewrote one line and dropped another', r7.ok && s.runs.length === 2 && s.entries.find(e => e.name === 'The sword').text === 'Nearly done.' && !s.entries.some(e => e.name === 'Hask'));

// The swipe: the newest reply swiped to an existing other version.
const lastAi = chat[5];
lastAi.swipes.push('Hask sleeps by the forge.');
lastAi.swipe_id = 1; lastAi.mes = 'Hask sleeps by the forge.';
asked = [];
cn.__setCanonTransport(answer({ add: [{ kind: 'fact', name: 'The forge', text: 'Hask sleeps beside it.' }] }));
cn.onCanonMessageSwiped(5);
s = cn.getCanon();
check('swiped to another version: the second run is taken back (old text back, the dropped line back), the first stands, your line untouched', s.runs.length === 1 && s.entries.find(e => e.name === 'The sword').text === 'Hask will finish it by the new moon.' && s.entries.some(e => e.name === 'Hask') && s.entries.some(e => e.name === 'The ore' && e.pinned), JSON.stringify(s.entries.map(e => `${e.name}=${e.text}`)));
await wait(4300);
s = cn.getCanon();
check('the redo runs over the chat as it is now, and is noted like any run', asked.length === 1 && asked[0].includes('Hask sleeps by the forge.') && !asked[0].includes('nearly done') && s.runs.length === 2 && s.entries.some(e => e.name === 'The forge'), JSON.stringify({ asked: asked.length, runs: s.runs.length }));

// Swiping back: the redo read the version now gone, so it is taken back and redone again.
lastAi.swipe_id = 0; lastAi.mes = lastAi.swipes[0];
asked = [];
cn.__setCanonTransport(answer({ add: [] }));
cn.onCanonMessageSwiped(5);
check('swiping back takes the redo back (its line goes)', !cn.getCanon().entries.some(e => e.name === 'The forge'));
await wait(4300);
check('and reads the version in front again', asked.length === 1 && asked[0].includes('nearly done'));

// A new swipe: the ledger is put back at once, the redo waits for the reply.
lastAi.swipes.push(''); lastAi.swipe_id = 2; lastAi.mes = '';
asked = [];
cn.__setCanonTransport(answer({ add: [{ kind: 'fact', name: 'The quench', text: 'The blade cracked.' }] }));
const runsBefore = cn.getCanon().runs.length;
cn.onCanonMessageSwiped(5);
await wait(4300);
check('a new swipe: the run that read the old version goes, nothing asked while the reply is written', cn.getCanon().runs.length === runsBefore - 1 && asked.length === 0);
lastAi.swipes[2] = 'The blade cracks in the quench.'; lastAi.mes = lastAi.swipes[2];
cn.onCanonMessageReceived(5, 'swipe');
await wait(4300);
check('the reply lands: the redo goes and reads it', asked.length === 1 && asked[0].includes('The blade cracks') && cn.getCanon().entries.some(e => e.name === 'The quench'));

// A regenerate: the reply deleted and a new one in its place (a new message, even if Live World hands it the old stamp).
asked = [];
const oldStamp = chat[5].dooms_canon_id;
chat.splice(5, 1);
STUB.__setSendPress(true);
cn.onCanonMessageDeleted();
s = cn.getCanon();
check('a regenerate\'s deletion: the run taken back, the redo waits for the generation', !s.entries.some(e => e.name === 'The quench') && asked.length === 0);
chat.push({ ...ai('Hask shrugs and starts over.'), dooms_canon_id: oldStamp, dooms_world_id: oldStamp });
STUB.__setSendPress(false);
cn.__setCanonTransport(answer({ add: [{ kind: 'fact', name: 'The second blade', text: 'Begun again.' }] }));
cn.onCanonMessageReceived(5, 'regenerate');
await wait(4300);
check('the regenerated reply lands: the redo reads it', asked.length === 1 && asked[0].includes('starts over') && cn.getCanon().entries.some(e => e.name === 'The second blade'));

// A message from the middle deleted: every run that read it, and every run after, taken back; one redo over what they read.
asked = [];
const runsNow = cn.getCanon().runs.length;
chat.splice(1, 1);
cn.__setCanonTransport(answer({ add: [{ kind: 'person', name: 'Hask', text: 'The smith.' }] }));
cn.onCanonMessageDeleted();
s = cn.getCanon();
check('a message from the middle deleted: all the runs that read it are taken back, your line stands', runsNow === 2 && s.runs.length === 0 && s.entries.length === 1 && s.entries[0].name === 'The ore', JSON.stringify(s.entries.map(e => e.name)));
await wait(4300);
check('one redo over the chat as it is', asked.length === 1 && cn.getCanon().runs.length === 1 && cn.getCanon().entries.some(e => e.name === 'Hask'));

// A message read by a run deleted while the run is being asked: the answer is not used.
let release;
cn.__setCanonTransport(() => new Promise(res => { release = () => res(JSON.stringify({ add: [{ kind: 'fact', name: 'Stale', text: 'From a chat that changed.' }] })); }));
const pending = cn.updateCanon({ reason: 'manual' });
await wait(10);
chat.splice(0, 1);
release();
const rp = await pending;
check('a message the run read went while it was asked: nothing from it is written', !rp.ok && rp.reason === 'changed' && !cn.getCanon().entries.some(e => e.name === 'Stale'));
cn.__setCanonTransport(answer({ add: [] }));
await wait(4300);

console.log(`\n${failures === 0 ? 'All canon flow checks pass' : `${failures} FAILURE(S)`}`);
process.exit(failures === 0 ? 0 : 1);
