#!/usr/bin/env node
/**
 * Behaviour test for the active-campaign switch
 * (src/systems/lorebook/campaignManager.js): the book ledger, global books,
 * manual picks, serialization of concurrent switches, deleteCampaign while
 * active, and the rename/delete bookkeeping.
 *
 * Usage:  node tools/campaign-switch-test.mjs     (from the repo root)
 * Exit:   0 = pass, 1 = failure
 *
 * Mechanism: campaignManager.js imports persistence.js and lorebookAPI.js,
 * which import SillyTavern modules that don't exist outside the browser.
 * Like tools/tracker-prompt-test.mjs this reuses the stub sandbox that
 * tools/load-check.mjs builds — but replaces the world-info stub with a
 * tiny functional one so activation is observable.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';
import { buildSandbox } from './sandbox.mjs';

const { SANDBOX, DES } = buildSandbox();
if (!existsSync(`${DES}/src/systems/lorebook/campaignManager.js`)) {
    console.error('FAIL: sandbox missing after load-check — cannot run.');
    process.exit(1);
}

// Functional World Info stub: keep every name the load-check stub exported
// (so lorebookAPI's import list still resolves) but make the three the
// switch depends on real.
const wiStub = `${SANDBOX}/scripts/world-info.js`;
const original = readFileSync(wiStub, 'utf8');
const patched = original
    .replace(/export const world_names = anything;/, 'export const world_names = ["A", "B", "C", "D", "G"];')
    .replace(/export const selected_world_info = anything;/, 'export const selected_world_info = ["D", "G", "B"];')
    // The list refresh also picks up files saved since (as the server's listing does).
    .replace(/export const updateWorldInfoList = anything;/, 'export const updateWorldInfoList = async () => { globalThis.__wiUpdates = (globalThis.__wiUpdates || 0) + 1; for (const n of Object.keys(globalThis.__wiFiles || {})) if (!world_names.includes(n)) world_names.push(n); };')
    // World Info files, in memory: what Duplicate reads and writes.
    .replace(/export const loadWorldInfo = anything;/, 'export const loadWorldInfo = async (name) => { const f = (globalThis.__wiFiles || {})[name]; return f ? JSON.parse(JSON.stringify(f)) : null; };')
    .replace(/export const saveWorldInfo = anything;/, 'export const saveWorldInfo = async (name, data) => { (globalThis.__wiFiles = globalThis.__wiFiles || {})[name] = JSON.parse(JSON.stringify(data)); };');
assert.notEqual(patched, original, 'world-info stub did not contain the expected exports');
assert.ok(patched.includes('__wiFiles') && patched.includes('loadWorldInfo = async') && patched.includes('saveWorldInfo = async'), 'world-info stub lacks loadWorldInfo/saveWorldInfo');
writeFileSync(wiStub, patched);

// Browser-ish globals the module graph touches at evaluation time.
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
globalThis.window = globalThis;
globalThis.self = globalThis;
globalThis.document = anything;
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
Object.defineProperty(globalThis, 'navigator', {
    value: { hardwareConcurrency: 8, maxTouchPoints: 0 }, configurable: true,
});
globalThis.jQuery = anything;
globalThis.$ = () => ({ trigger: () => { globalThis.__wiChangeTriggers = (globalThis.__wiChangeTriggers || 0) + 1; } });
globalThis.toastr = anything;

const { extensionSettings } = await import(`${DES}/src/core/state.js`);
const cp = await import(`${DES}/src/systems/lorebook/campaignProfiles.js`);
const cm = await import(`${DES}/src/systems/lorebook/campaignManager.js`);
const api = await import(`${DES}/src/systems/lorebook/lorebookAPI.js`);
const al = await import(`${DES}/src/systems/lorebook/autoLink.js`);

// Skip the DOM repaints (they are gated on enabled) — this tests data.
extensionSettings.enabled = false;

const active = () => [...api.getActiveWorldNames()].sort();

function reset() {
    const sel = api.getActiveWorldNames();
    sel.length = 0;
    sel.push('D', 'G', 'B');
    extensionSettings.lorebook = {
        enabled: true,
        campaigns: {
            c1: { id: 'c1', name: 'Mecha', icon: 'fa-robot', color: '', books: ['A', 'B'] },
            c2: { id: 'c2', name: 'Noir', icon: 'fa-city', color: '', books: ['B', 'C', 'Missing'] },
        },
        campaignOrder: ['c1', 'c2'],
        collapsedCampaigns: [],
        activeCampaignId: null,
        globalBooks: ['G'],
        campaignActivated: [],
        autoLinkByName: true,
        autoLinked: [],
    };
    extensionSettings.campaignProfiles = {};
    extensionSettings.campaignBaseShadow = {};
    extensionSettings.campaignUserProfiles = {};
    extensionSettings.campaignUserBaseShadow = {};
    extensionSettings.characterInjection = { Hex: { description: 'base hex', lorebook: '' } };
    extensionSettings.npcAvatars = {};
    extensionSettings.npcAvatarsFullRes = {};
    extensionSettings.npcAvatarHistory = {};
    extensionSettings.characterAppearance = {};
    extensionSettings.characterRelationships = {};
    extensionSettings.characterKnives = {};
    extensionSettings.heroPositions = {};
    extensionSettings.generatedPortraits = {};
    extensionSettings.userCharacters = {};
    globalThis.__wiUpdates = 0;
    globalThis.__wiChangeTriggers = 0;
    // The World Info files on "disk", and the list back to its five books.
    globalThis.__wiFiles = {
        A: { entries: { 0: { uid: 0, key: ['mecha'], content: 'Mechs are tall.', order: 100 }, 1: { uid: 1, key: ['pilot'], content: 'Pilots are few.', order: 90 } } },
    };
    const names = api.getAllWorldNames();
    names.length = 0;
    names.push('A', 'B', 'C', 'D', 'G');
}

let failures = 0;
let passes = 0;
async function test(name, fn) {
    try {
        reset();
        await fn();
        passes++;
    } catch (e) {
        failures++;
        console.error(`FAIL: ${name}\n  ${e?.message || e}`);
    }
}

await test('activating a campaign turns its books on, records the ledger, and leaves manual picks alone', async () => {
    assert.equal(await cm.setActiveCampaign('c1', { silent: true }), true);
    assert.deepEqual(active(), ['A', 'B', 'D', 'G']);
    assert.deepEqual(extensionSettings.lorebook.campaignActivated, ['A', 'B']);
    assert.equal(cm.getActiveCampaignId(), 'c1');
    // one round trip for the whole batch
    assert.equal(globalThis.__wiUpdates, 1);
    assert.equal(globalThis.__wiChangeTriggers, 1);
});

await test('switching campaign to campaign turns the previous one off, keeps the overlap and skips missing books', async () => {
    await cm.setActiveCampaign('c1', { silent: true });
    await cm.setActiveCampaign('c2', { silent: true });
    assert.deepEqual(active(), ['B', 'C', 'D', 'G']);
    assert.deepEqual(extensionSettings.lorebook.campaignActivated, ['B', 'C']);
});

await test('deactivating turns the campaign\'s books off but never a global or a manual pick', async () => {
    await cm.setActiveCampaign('c1', { silent: true });
    await cm.setActiveCampaign(null, { silent: true });
    // B was on by hand before c1 was activated; a campaign is a mode, so it goes off with the campaign
    assert.deepEqual(active(), ['D', 'G']);
    assert.deepEqual(extensionSettings.lorebook.campaignActivated, []);
    assert.equal(cm.getActiveCampaignId(), null);
});

await test('a global book survives every switch', async () => {
    assert.equal(cm.toggleGlobalBook('B'), true);
    await cm.setActiveCampaign('c1', { silent: true });
    await cm.setActiveCampaign(null, { silent: true });
    assert.deepEqual(active(), ['B', 'D', 'G']);
    assert.equal(cm.toggleGlobalBook('B'), false);
    assert.equal(cm.isGlobalBook('G'), true);
});

await test('same campaign twice is a no-op; unknown id deactivates', async () => {
    await cm.setActiveCampaign('c1', { silent: true });
    assert.equal(await cm.setActiveCampaign('c1', { silent: true }), false);
    assert.equal(await cm.setActiveCampaign('nope', { silent: true }), true);
    assert.equal(cm.getActiveCampaignId(), null);
});

await test('concurrent switches are serialized and end in a consistent state', async () => {
    const p1 = cm.setActiveCampaign('c1', { silent: true });
    assert.equal(cm.isSwitching(), true);
    const p2 = cm.setActiveCampaign('c2', { silent: true });
    const p3 = cm.setActiveCampaign(null, { silent: true });
    await Promise.all([p1, p2, p3]);
    assert.equal(cm.isSwitching(), false);
    assert.deepEqual(active(), ['D', 'G']);
    assert.deepEqual(extensionSettings.lorebook.campaignActivated, []);
    assert.equal(cm.getActiveCampaignId(), null);
});

await test('the switch swaps character versions and banks edits', async () => {
    cp.addProfile('c1', 'Hex');
    cp.writeVersion('c1', 'Hex', { injection: { description: 'mecha hex', lorebook: '' } });
    await cm.setActiveCampaign('c1', { silent: true });
    assert.equal(extensionSettings.characterInjection.Hex.description, 'mecha hex');
    extensionSettings.characterInjection.Hex.description = 'edited in play';
    await cm.setActiveCampaign(null, { silent: true });
    assert.equal(extensionSettings.characterInjection.Hex.description, 'base hex');
    assert.equal(cp.readVersion('c1', 'Hex').injection.description, 'edited in play');
});

await test('deleting the active campaign deactivates it first and drops its versions', async () => {
    cp.addProfile('c1', 'Hex');
    await cm.setActiveCampaign('c1', { silent: true });
    assert.equal(await cm.deleteCampaign('c1'), true);
    assert.equal(cm.getActiveCampaignId(), null);
    assert.deepEqual(active(), ['D', 'G']);
    assert.equal(extensionSettings.lorebook.campaigns.c1, undefined);
    assert.equal(extensionSettings.campaignProfiles.c1, undefined);
    assert.equal(extensionSettings.characterInjection.Hex.description, 'base hex');
});

await test('the switch swaps the player\'s card too, and leaves its colour, pronouns and linked persona alone', async () => {
    extensionSettings.userCharacters = {
        Jordan: { color: '#abcdef', pronouns: 'they/them', linkedPersona: 'jordan.png', avatar: '/p/base.png', injection: { description: 'base jordan', lorebook: '' }, knives: [] },
    };
    cp.addProfile('c1', 'Jordan', { isUser: true });
    const v = cp.readVersion('c1', 'Jordan', true);
    v.injection.description = 'mecha jordan';
    v.avatar = '/p/mecha.png';
    cp.writeVersion('c1', 'Jordan', v, true);
    const card = () => extensionSettings.userCharacters.Jordan;

    await cm.setActiveCampaign('c1', { silent: true });
    assert.equal(card().injection.description, 'mecha jordan');
    assert.equal(card().avatar, '/p/mecha.png');
    assert.equal(card().color, '#abcdef');
    assert.equal(card().pronouns, 'they/them');
    assert.equal(card().linkedPersona, 'jordan.png');
    // An edit in play is banked for the campaign it was made in.
    card().injection.description = 'mecha jordan, promoted';
    await cm.setActiveCampaign('c2', { silent: true });
    assert.equal(card().injection.description, 'base jordan', 'c2 has no version of the card: Base');
    await cm.setActiveCampaign('c1', { silent: true });
    assert.equal(card().injection.description, 'mecha jordan, promoted');
    await cm.setActiveCampaign(null, { silent: true });
    assert.equal(card().injection.description, 'base jordan');
    assert.equal(card().avatar, '/p/base.png');
    assert.deepEqual(extensionSettings.campaignUserBaseShadow, {});
});

await test('deleting the active campaign brings the player\'s Base back and drops its versions of the card', async () => {
    extensionSettings.userCharacters = { Jordan: { color: '#abcdef', injection: { description: 'base jordan', lorebook: '' } } };
    cp.addProfile('c1', 'Jordan', { isUser: true });
    const v = cp.readVersion('c1', 'Jordan', true);
    v.injection.description = 'mecha jordan';
    cp.writeVersion('c1', 'Jordan', v, true);
    await cm.setActiveCampaign('c1', { silent: true });
    assert.equal(extensionSettings.userCharacters.Jordan.injection.description, 'mecha jordan');
    assert.equal(await cm.deleteCampaign('c1'), true);
    assert.equal(cm.getActiveCampaignId(), null);
    assert.equal(extensionSettings.userCharacters.Jordan.injection.description, 'base jordan');
    assert.equal(extensionSettings.campaignUserProfiles.c1, undefined);
    assert.equal(cp.countVersions('Jordan', true), 1);
});

await test('reconcile after a book joins or leaves the active campaign', async () => {
    await cm.setActiveCampaign('c1', { silent: true });
    cm.addBookToCampaign('c1', 'C');
    await cm.reconcileActiveCampaignBooks();
    assert.deepEqual(active(), ['A', 'B', 'C', 'D', 'G']);
    cm.removeBookFromCampaign('c1', 'A');
    await cm.reconcileActiveCampaignBooks();
    assert.deepEqual(active(), ['B', 'C', 'D', 'G']);
    assert.deepEqual(extensionSettings.lorebook.campaignActivated, ['B', 'C']);
});

await test('a book name that is not a string can never be filed', async () => {
    cm.addBookToCampaign('c1', undefined);
    cm.addBookToCampaign('c1', '');
    cm.addBookToCampaign('c1', null);
    cm.moveBookBetweenCampaigns(null, 'c2', undefined);
    cm.removeBookFromCampaign('c1', undefined);
    assert.deepEqual(extensionSettings.lorebook.campaigns.c1.books, ['A', 'B']);
    assert.deepEqual(extensionSettings.lorebook.campaigns.c2.books, ['B', 'C', 'Missing']);
});

await test('rename and delete bookkeeping follow the book', async () => {
    await cm.setActiveCampaign('c1', { silent: true });
    extensionSettings.lorebook.autoLinked = ['A'];
    cm.onWorldRenamed('A', 'A2');
    assert.deepEqual(extensionSettings.lorebook.campaigns.c1.books, ['A2', 'B']);
    assert.deepEqual(extensionSettings.lorebook.campaignActivated, ['A2', 'B']);
    assert.deepEqual(extensionSettings.lorebook.autoLinked, ['A2']);
    cm.onWorldDeleted('B');
    assert.deepEqual(extensionSettings.lorebook.campaigns.c1.books, ['A2']);
    assert.deepEqual(extensionSettings.lorebook.campaignActivated, ['A2']);
    assert.deepEqual(extensionSettings.lorebook.campaigns.c2.books, ['C', 'Missing']);
    cm.onWorldDeleted('A2');
    assert.deepEqual(extensionSettings.lorebook.autoLinked, []);
});

// ── Auto-link by name ─────────────────────────────────────────────────────

await test('auto-link switches on a book named like a cast member and off when they leave', async () => {
    let r = await al.syncAutoLinkedLorebooks({ cast: { A: {}, D: {}, Nobody: {} } });
    assert.deepEqual(r.activated, ['A']);
    assert.deepEqual(active(), ['A', 'B', 'D', 'G']);
    // D was already on by hand, so it is not ours: only A is in the ledger
    assert.deepEqual(extensionSettings.lorebook.autoLinked, ['A']);
    r = await al.syncAutoLinkedLorebooks({ cast: { D: {} } });
    assert.deepEqual(r.deactivated, ['A']);
    assert.deepEqual(active(), ['B', 'D', 'G']);
    assert.deepEqual(extensionSettings.lorebook.autoLinked, []);
});

await test('auto-link is a no-op when disabled or when the chat has no cast', async () => {
    extensionSettings.lorebook.autoLinkByName = false;
    await al.syncAutoLinkedLorebooks({ cast: { A: {} } });
    assert.deepEqual(active(), ['B', 'D', 'G']);
    extensionSettings.lorebook.autoLinkByName = true;
    await al.syncAutoLinkedLorebooks({ cast: null });
    assert.deepEqual(active(), ['B', 'D', 'G']);
});

await test('auto-link never switches off a book the active campaign keeps on, or a global', async () => {
    await al.syncAutoLinkedLorebooks({ cast: { A: {}, G: {} } });
    assert.deepEqual(extensionSettings.lorebook.autoLinked, ['A']); // G was already on
    await cm.setActiveCampaign('c1', { silent: true });          // c1 wants A and B
    await al.syncAutoLinkedLorebooks({ cast: {} });               // A's character leaves
    assert.deepEqual(active(), ['A', 'B', 'D', 'G']);             // A stays: the campaign owns it now
    assert.deepEqual(extensionSettings.lorebook.autoLinked, []);
    await cm.setActiveCampaign(null, { silent: true });
    assert.deepEqual(active(), ['D', 'G']);                        // and goes with the campaign
});

await test('a campaign switch never switches off a book auto-link still owns', async () => {
    await al.syncAutoLinkedLorebooks({ cast: { A: {} } });        // auto-link owns A
    await cm.setActiveCampaign('c1', { silent: true });          // A already on, B switched on
    assert.deepEqual(extensionSettings.lorebook.campaignActivated, ['A', 'B']);
    await cm.setActiveCampaign(null, { silent: true });
    assert.deepEqual(active(), ['A', 'D', 'G']);                   // B off, A kept for the cast
    assert.deepEqual(extensionSettings.lorebook.autoLinked, ['A']);
    await al.syncAutoLinkedLorebooks({ cast: {} });
    assert.deepEqual(active(), ['D', 'G']);                        // leaves with the character
});

await test('auto-link queues behind an in-flight switch instead of interleaving', async () => {
    const p1 = cm.setActiveCampaign('c1', { silent: true });
    const p2 = al.syncAutoLinkedLorebooks({ cast: { C: {} } });
    await Promise.all([p1, p2]);
    assert.deepEqual(active(), ['A', 'B', 'C', 'D', 'G']);
    assert.deepEqual(extensionSettings.lorebook.campaignActivated, ['A', 'B']);
    assert.deepEqual(extensionSettings.lorebook.autoLinked, ['C']);
});

// ─── Duplicate a lorebook ───────────────────────────────────────────────────

await test('the name offered for a copy is the first free "(copy)" name, compared without case', async () => {
    assert.equal(api.freeCopyName('A'), 'A (copy)');
    assert.equal(api.freeCopyName('A', ['A', 'a (COPY)']), 'A (copy 2)');
    assert.equal(api.freeCopyName('A', ['A', 'A (copy)', 'A (copy 2)', 'A (copy 3)']), 'A (copy 4)');
    assert.equal(api.freeCopyName('  A  ', []), 'A (copy)');
});

await test('duplicating copies every entry into a new book and leaves the original alone', async () => {
    const before = JSON.stringify(globalThis.__wiFiles.A);
    assert.equal(await api.duplicateWorld('A', 'A (copy)'), 'A (copy)');
    assert.ok(api.getAllWorldNames().includes('A (copy)'));
    assert.equal(JSON.stringify(globalThis.__wiFiles['A (copy)']), before);
    assert.equal(JSON.stringify(globalThis.__wiFiles.A), before);
    // The two are separate objects: editing the copy does not reach the original.
    const copy = await api.loadWorldData('A (copy)');
    copy.entries[0].content = 'Changed in the copy.';
    await api.saveWorldData('A (copy)', copy);
    assert.equal((await api.loadWorldData('A', true)).entries[0].content, 'Mechs are tall.');
    // Not switched on by the copy itself.
    assert.equal(api.isWorldActive('A (copy)'), false);
});

await test('duplicating refuses a taken name, an empty one, one the server would change, and a book that will not load', async () => {
    await assert.rejects(api.duplicateWorld('A', 'B'), /already a lorebook named "B"/);
    await assert.rejects(api.duplicateWorld('A', 'b'), /already a lorebook named "b"/, 'case does not make a new file');
    await assert.rejects(api.duplicateWorld('A', '   '), /needs a name/);
    await assert.rejects(api.duplicateWorld('A', 'Mecha/Lore'), /cannot contain/);
    await assert.rejects(api.duplicateWorld('Missing', 'Missing (copy)'), /Could not load/);
    assert.deepEqual([...api.getAllWorldNames()].sort(), ['A', 'B', 'C', 'D', 'G'], 'nothing was created');
});

await test('a copy is filed in the original\'s campaign: on when that campaign is active, off otherwise, never global', async () => {
    // A is in c1 (inactive): the copy joins c1 and stays off.
    await api.duplicateWorld('A', 'A (copy)');
    assert.equal(cm.onWorldDuplicated('A', 'A (copy)'), 'c1');
    assert.deepEqual(extensionSettings.lorebook.campaigns.c1.books, ['A', 'B', 'A (copy)']);
    await cm.queueReconcile();
    assert.equal(api.isWorldActive('A (copy)'), false);
    // With c1 active the campaign's rule applies to it like any of its books.
    await cm.setActiveCampaign('c1', { silent: true });
    assert.equal(api.isWorldActive('A (copy)'), true);
    await api.duplicateWorld('A', 'A (copy 2)');
    cm.onWorldDuplicated('A', 'A (copy 2)');
    await cm.queueReconcile();
    assert.equal(api.isWorldActive('A (copy 2)'), true);
    await cm.setActiveCampaign(null, { silent: true });
    assert.equal(api.isWorldActive('A (copy)'), false);
    assert.equal(api.isWorldActive('A (copy 2)'), false);
    // An unfiled original gives an unfiled copy; a global original a copy that is not global.
    globalThis.__wiFiles.G = { entries: {} };
    await api.duplicateWorld('G', 'G (copy)');
    assert.equal(cm.onWorldDuplicated('G', 'G (copy)'), null);
    assert.equal(cm.getCampaignForBook('G (copy)'), null);
    assert.equal(cm.isGlobalBook('G (copy)'), false);
});

if (failures) {
    console.error(`\n${failures} failed, ${passes} passed`);
    process.exit(1);
}
console.log(`campaign-switch-test: ${passes} passed`);
