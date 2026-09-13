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
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';

const SANDBOX = '/tmp/des-load-check';
const DES = `${SANDBOX}/scripts/extensions/third-party/DES`;

execFileSync(process.execPath, ['tools/load-check.mjs'], { stdio: 'pipe' });
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
    .replace(/export const updateWorldInfoList = anything;/, 'export const updateWorldInfoList = async () => { globalThis.__wiUpdates = (globalThis.__wiUpdates || 0) + 1; };');
assert.notEqual(patched, original, 'world-info stub did not contain the expected exports');
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
    };
    extensionSettings.campaignProfiles = {};
    extensionSettings.campaignBaseShadow = {};
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

await test('rename and delete bookkeeping follow the book', async () => {
    await cm.setActiveCampaign('c1', { silent: true });
    cm.onWorldRenamed('A', 'A2');
    assert.deepEqual(extensionSettings.lorebook.campaigns.c1.books, ['A2', 'B']);
    assert.deepEqual(extensionSettings.lorebook.campaignActivated, ['A2', 'B']);
    cm.onWorldDeleted('B');
    assert.deepEqual(extensionSettings.lorebook.campaigns.c1.books, ['A2']);
    assert.deepEqual(extensionSettings.lorebook.campaignActivated, ['A2']);
    assert.deepEqual(extensionSettings.lorebook.campaigns.c2.books, ['C', 'Missing']);
});

if (failures) {
    console.error(`\n${failures} failed, ${passes} passed`);
    process.exit(1);
}
console.log(`campaign-switch-test: ${passes} passed`);
