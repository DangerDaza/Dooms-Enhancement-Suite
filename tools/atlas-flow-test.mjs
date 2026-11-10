#!/usr/bin/env node
/**
 * The Atlas's book in the chat (docs/long-shot-plan.md D151, D155):
 * src/systems/features/atlasBook.js in the sandbox. The book read from the
 * chat's metadata and made safe, written back and saved with the chat; a
 * chat without one reads as an empty book; the clean-up pass asked for
 * through the module's hook (the request names every place, the reply's
 * proposals come back, nothing is changed by asking), a reply that is no
 * JSON, a request that throws, too few places to ask about.
 *
 * Usage:  node tools/atlas-flow-test.mjs     (from the repo root)
 * Exit:   0 = pass, 1 = failure
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { buildSandbox } from './sandbox.mjs';
const { SANDBOX, DES } = buildSandbox();
if (!existsSync(`${DES}/src/systems/features/liveWorld.js`)) {
    console.error('FAIL: sandbox missing after load-check — cannot run.');
    process.exit(1);
}
globalThis.__DES_CHAT__ = [];
globalThis.__DES_CHAT_METADATA__ = {};
globalThis.__DES_SLOTS__ = {};
globalThis.__DES_SAVES__ = { debounced: 0, immediate: 0 };
globalThis.__DES_SAVED_FILES__ = [];
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
const extStub = `${SANDBOX}/scripts/extensions.js`;
writeFileSync(extStub, readFileSync(extStub, 'utf8')
    .replace('export const getContext = anything;', 'export const getContext = () => globalThis.__DES_CTX__;'));
const utilsStub = `${SANDBOX}/scripts/utils.js`;
writeFileSync(utilsStub, readFileSync(utilsStub, 'utf8')
    .replace('export const saveBase64AsFile = anything;', 'export const saveBase64AsFile = async (b64, folder, name, format) => { globalThis.__DES_SAVED_FILES__.push({ b64, folder, name, format }); return `/user/images/${folder}/${name}.${format}`; };'));
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
    { chat: globalThis.__DES_CHAT__, chat_metadata: globalThis.__DES_CHAT_METADATA__, name1: 'Jordan', name2: 'Narrator', chatId: 'test-chat', user_avatar: '', extension_settings: {}, saveSettingsDebounced: () => {} },
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
globalThis.toastr = { info: (m, t) => toasts.push(['info', m, t]), warning: (m, t) => toasts.push(['warning', m, t]), success: (m, t) => toasts.push(['success', m, t]), error: (m, t) => toasts.push(['error', m, t]) };
globalThis.requestAnimationFrame = () => 0;
globalThis.cancelAnimationFrame = () => {};
globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
globalThis.fetch = async () => ({ ok: false, status: 404, json: async () => ({}), text: async () => '' });
globalThis.CustomEvent = class { constructor(type, init) { this.type = type; this.detail = init && init.detail; } };
globalThis.dispatchEvent = () => true;
const meta = globalThis.__DES_CHAT_METADATA__;
const state = await import(`${DES}/src/core/state.js`);
const { extensionSettings } = state;
const book = await import(`${DES}/src/systems/features/atlasBook.js`);
const A = await import(`${DES}/src/utils/atlas.js`);
const LW = await import(`${DES}/src/utils/liveWorld.js`);

let failures = 0;
const check = (label, cond, extra = '') => {
    if (cond) { console.log(`pass  ${label}`); }
    else { console.error(`FAIL  ${label}${extra ? '\n      ' + extra : ''}`); failures++; }
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
extensionSettings.enabled = true;
extensionSettings.generationMode = 'together';
extensionSettings.connectionProfile = '';

console.log('\n§1 the book in the chat');
{
    check('a chat without a book reads as an empty one', same(book.getBook(), A.normalizeBook(null)));
    const saves = globalThis.__DES_SAVES__.debounced;
    const ok = book.setBook(A.placeAt(book.getBook(), 'loc:the-quay', { x: 2, y: -3 }));
    check('a book written is in the chat\'s metadata and saved with the chat', ok === true && same(meta.dooms_atlas.spots, { 'loc:the-quay': { x: 2, y: -3 } }) && globalThis.__DES_SAVES__.debounced === saves + 1);
    check('it reads back as written', same(book.getBook().spots, { 'loc:the-quay': { x: 2, y: -3 } }));
    meta.dooms_atlas = { spots: { a: { x: 'no', y: 1 }, b: { x: 1, y: 1 } }, gone: 'nope', made: [{ id: 'not-a-pin' }] };
    check('a damaged book is made safe on the way out', same(book.getBook(), { scale: '', ground: '', drawn: false, spots: { b: { x: 1, y: 1 } }, inside: {}, scales: {}, grounds: {}, roads: [], cut: [], roadHours: {}, gone: [], merged: {}, made: [], edits: {} }));
    delete meta.dooms_atlas;
}

console.log('\n§2 the clean-up pass');
{
    const pack = LW.blankPack('Harbourside Nights');
    const ws = LW.seedWorldState(pack, { name: 'Harbourside Nights' });
    ws.visited = ['The Rusty Anchor', 'Rusty Anchor pub', 'A dark feeling', 'Old Chapel'].map((label, i) => ({ id: LW.locPlaceId(label), label, packId: '', path: '', visits: [i + 1] }));
    const model = A.atlasModel({ pack, state: ws });
    const n = (label) => A.tidyList(model).find(x => x.label === label).n;
    let seen = null;
    book.__setTidyTransport(async (prompt) => { seen = prompt; return JSON.stringify({ merge: [{ from: n('Rusty Anchor pub'), into: n('The Rusty Anchor'), why: 'the same pub' }], delete: [{ id: n('A dark feeling'), why: 'not a place' }] }); });
    const before = JSON.stringify(meta);
    const r = await book.proposeTidy(model, { world: 'Harbourside Nights' });
    check('the request names every place and the world', !!seen && seen.user.includes('Rusty Anchor pub') && seen.user.includes('Old Chapel') && seen.user.includes('Harbourside Nights'));
    check('the proposals come back: a merge and a deletion', r.ok && r.items.length === 2 && r.items[0].kind === 'merge' && r.items[0].label === 'Rusty Anchor pub' && r.items[0].toLabel === 'The Rusty Anchor' && r.items[1].kind === 'delete' && r.items[1].label === 'A dark feeling', JSON.stringify(r));
    check('asking changes nothing in the chat', JSON.stringify(meta) === before && !book.isTidying());
    book.__setTidyTransport(async () => 'Sorry, I cannot help with that.');
    const bad = await book.proposeTidy(model);
    check('a reply that is no JSON is said, with nothing proposed', bad.ok === false && bad.reason === 'invalid' && bad.items.length === 0 && !!bad.error);
    book.__setTidyTransport(async () => { throw new Error('the connection dropped'); });
    const thrown = await book.proposeTidy(model);
    check('a request that fails is said', thrown.ok === false && thrown.reason === 'error' && /connection dropped/.test(thrown.error) && !book.isTidying());
    let asked = 0;
    book.__setTidyTransport(async () => { asked++; return '{}'; });
    const few = await book.proposeTidy(A.atlasModel({ pack, state: { ...ws, visited: ws.visited.slice(0, 1) } }));
    check('one place is not asked about', few.ok && few.reason === 'few' && asked === 0);
    book.__setTidyTransport(null);
}

console.log('\n§3 setting up the world (D143, D159)');
{
    const S = await import(`${DES}/src/utils/atlasSetup.js`);
    const chat = globalThis.__DES_CHAT__;
    chat.length = 0;
    for (let i = 0; i < 40; i++) chat.push({ is_user: i % 2 === 0, name: i % 2 === 0 ? 'Jordan' : 'Narrator', mes: `Scene ${i}: ${'the lane above the temple in Hask '.repeat(40)}` });
    const pack = LW.blankPack('The Eld');
    const ws = LW.seedWorldState(pack, { name: 'The Eld' });
    ws.visited = ['Hask', 'the black stair'].map((label, i) => ({ id: LW.locPlaceId(label), label, packId: '', path: '', visits: [i + 1] }));
    const model = A.atlasModel({ pack, state: ws });
    const cost = book.setupReach();
    check('the whole chat\'s cost is told before it is read: its messages and its parts', cost.messages === 40 && cost.parts >= 3 && cost.skipped === 0, JSON.stringify(cost));
    const draftReply = JSON.stringify({ scale: 'region', places: [{ name: 'Hask', kind: 'settlement', inside: '', was: [1] }, { name: 'The Temple', kind: 'sacred', inside: 'Hask' }, { name: 'The Black Stair', kind: 'ruin', inside: 'The Temple', was: [2] }], drop: [] });
    const asked = [];
    book.__setSetupTransport(async (p) => { asked.push(p); return p.kind === 'scan' ? '{"places":[{"name":"The Temple","inside":"Hask","note":"cold stone"}]}' : draftReply; });
    const before = JSON.stringify(meta);
    const steps = [];
    const recent = await book.draftSetup({ notes: 'Hask is landlocked.', reach: 'recent', model, world: 'The Eld', onProgress: (p) => steps.push(p.word) });
    check('the recent reach: one request, the notes first in it', recent.ok && asked.length === 1 && asked[0].kind === 'draft' && asked[0].user.indexOf("THE PLAYER'S NOTES") === 0 && asked[0].user.includes('Hask is landlocked.') && asked[0].user.includes('Scene 39') && same(steps, ['Drafting the places']));
    check('the draft comes back read: the places, what is inside what, the known places taken over', recent.draft.places.length === 3 && recent.draft.places[2].inside === 'temple' && recent.draft.places[0].was[0].label === 'Hask' && recent.draft.scale === 'region');
    asked.length = 0; steps.length = 0;
    const full = await book.draftSetup({ notes: '', reach: 'full', model, world: 'The Eld', onProgress: (p) => steps.push(`${p.done}/${p.total}`) });
    check('the whole chat: a request for each part, then the draft, the progress told', full.ok && asked.length === cost.parts + 1 && asked.slice(0, -1).every(p => p.kind === 'scan') && asked[asked.length - 1].kind === 'draft' && full.parts === cost.parts && steps.length === cost.parts + 1 && steps[0] === `0/${cost.parts + 1}`, `${asked.length} ${JSON.stringify(steps)}`);
    check('every part of the chat is read once, oldest first', asked[0].user.includes('Scene 0:') && asked[cost.parts - 1].user.includes('Scene 39:') && /Part 1 of/.test(asked[0].user));
    check('what the scans found is in the draft\'s request', asked[asked.length - 1].user.includes('- The Temple (in Hask): cold stone'));
    check('drafting changes nothing in the chat', JSON.stringify(meta) === before && !book.isSettingUp());
    asked.length = 0;
    let n = 0;
    book.__setSetupTransport(async (p) => { asked.push(p); if (p.kind === 'scan' && ++n === 2) throw new Error('the connection dropped'); return p.kind === 'scan' ? '{"places":[]}' : draftReply; });
    const holed = await book.draftSetup({ reach: 'full', model });
    check('a part that fails is left out and the rest is still read', holed.ok && holed.parts === cost.parts - 1 && asked.length === cost.parts + 1);
    asked.length = 0;
    book.__setSetupTransport(async (p) => { asked.push(p); if (asked.length === 1) book.stopSetup(); return '{"places":[]}'; });
    const stopped = await book.draftSetup({ reach: 'full', model });
    check('stopped while reading: the part in hand finishes, no more are asked for, nothing is drafted', stopped.ok === false && stopped.reason === 'stopped' && asked.length === 1 && !book.isSettingUp());
    book.__setSetupTransport(async () => 'I would rather not.');
    const bad = await book.draftSetup({ reach: 'recent', model });
    check('a reply that is no list is said', bad.ok === false && bad.reason === 'invalid' && !!bad.error);
    book.__setSetupTransport(async () => draftReply);
    const again = await book.draftSetup({ reach: 'recent', model });
    const applied = S.applySetup(again.draft, book.getBook());
    check('applied, the draft is the chat\'s book: saved, three markers, the stair inside the temple inside Hask', book.setBook(applied.book) === true && meta.dooms_atlas.made.length === 3 && meta.dooms_atlas.inside[applied.ids.get('black stair')] === applied.ids.get('temple') && meta.dooms_atlas.merged[LW.locPlaceId('the black stair')] === applied.ids.get('black stair'));
    // Filling out a map (D160).
    const filled = A.atlasModel({ pack, state: ws, book: applied.book, layer: applied.ids.get('hask') });
    let fillAsked = null;
    book.__setSetupTransport(async (p) => { fillAsked = p; return JSON.stringify({ places: [{ name: 'The Pit', kind: 'landmark', note: 'A fighting pit.', near: [{ to: 'The Temple', dir: 'w', far: 'near' }] }, { name: 'The Temple' }] }); });
    const metaBefore = JSON.stringify(meta);
    const fill = await book.draftFill({ model: filled, world: 'The Eld', wish: 'somewhere rough', count: 4 });
    check('fill out: one request that names the map, its places and what was asked for', !!fillAsked && fillAsked.kind === 'fill' && fillAsked.user.includes('somewhere rough') && fillAsked.user.includes('inside Hask') && fillAsked.user.includes('The Temple') && /Exactly 4/.test(fillAsked.system));
    check('the suggestions come back: the new ones only; asking changes nothing', fill.ok && fill.places.length === 1 && fill.places[0].name === 'The Pit' && JSON.stringify(meta) === metaBefore && !book.isSettingUp());
    const added = S.applyFill(book.getBook(), filled, fill.places);
    check('added, the suggestion is in the chat\'s book: inside Hask, not canon', book.setBook(added.book) && meta.dooms_atlas.made.length === 4 && meta.dooms_atlas.made[3].loose === true && meta.dooms_atlas.inside[added.ids[0]] === applied.ids.get('hask'));
    book.__setSetupTransport(async () => 'no thanks');
    check('a reply that is no list is said', (await book.draftFill({ model: filled })).ok === false);
    book.__setSetupTransport(null);
    chat.length = 0;
    delete meta.dooms_atlas;
}

console.log(failures ? `\n${failures} failure(s)` : '\nall pass');
process.exit(failures ? 1 : 0);
