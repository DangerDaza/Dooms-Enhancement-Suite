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
    check('a damaged book is made safe on the way out', same(book.getBook(), { scale: '', drawn: false, spots: { b: { x: 1, y: 1 } }, gone: [], merged: {}, made: [], edits: {} }));
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

console.log(failures ? `\n${failures} failure(s)` : '\nall pass');
process.exit(failures ? 1 : 0);
