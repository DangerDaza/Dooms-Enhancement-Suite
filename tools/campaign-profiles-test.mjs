#!/usr/bin/env node
/**
 * Unit test for the campaign-profile data layer
 * (src/systems/lorebook/campaignProfiles.js).
 *
 * The module imports only state.js, so this runs in plain Node with no
 * SillyTavern stubs. It pins the live/shadow/bucket invariant through the
 * sequences that matter: switching between campaigns, editing while a
 * campaign is active (base and override), adding/removing a version while
 * active, deleting a character everywhere, alias merges, and the portrait
 * reference count that keeps a cloned profile from deleting base's file.
 *
 * Usage:  node tools/campaign-profiles-test.mjs     (from the repo root)
 * Exit:   0 = pass, 1 = failure
 */
import { strict as assert } from 'node:assert';

const { extensionSettings } = await import('../src/core/state.js');
const cp = await import('../src/systems/lorebook/campaignProfiles.js');

let failures = 0;
let passes = 0;
function test(name, fn) {
    try {
        reset();
        fn();
        passes++;
    } catch (e) {
        failures++;
        console.error(`FAIL: ${name}\n  ${e?.message || e}`);
    }
}

function reset() {
    extensionSettings.lorebook = {
        enabled: true,
        campaigns: {
            c1: { id: 'c1', name: 'Mecha', icon: 'fa-robot', color: '#ff0', books: ['Mecha Lore', 'Shared Rules'] },
            c2: { id: 'c2', name: 'Noir', icon: 'fa-city', color: '#0ff', books: ['Noir Lore'] },
        },
        campaignOrder: ['c1', 'c2'],
        activeCampaignId: null,
        globalBooks: [],
        campaignActivated: [],
    };
    extensionSettings.campaignProfiles = {};
    extensionSettings.campaignBaseShadow = {};
    extensionSettings.characterInjection = { Hex: { description: 'base hex', lorebook: '' } };
    extensionSettings.characterAppearance = { Hex: 'silver hair' };
    extensionSettings.npcAvatars = { Hex: '/user/images/des-portraits/hex-aaaaaaaa.png?t=1', Lucy: '/user/images/des-portraits/lucy-bbbbbbbb.png?t=1' };
    extensionSettings.npcAvatarsFullRes = { Hex: '/user/images/des-portraits/hex-aaaaaaaa.png?t=1' };
    extensionSettings.npcAvatarHistory = {};
    extensionSettings.characterRelationships = { Hex: 'Ally' };
    extensionSettings.characterKnives = { Hex: [{ id: 'k1', text: 'owes money', used: false }] };
    extensionSettings.heroPositions = { Hex: { x: 40, y: 10 } };
    extensionSettings.generatedPortraits = {};
    extensionSettings.userCharacters = {};
}

// Simulates campaignManager.setActiveCampaign's profile half.
function activate(id) {
    cp.switchCampaignProfiles(cp.getActiveCampaignId(), id);
    extensionSettings.lorebook.activeCampaignId = id;
}

test('no active campaign: base is live and reads the flat stores', () => {
    assert.equal(cp.getActiveCampaignId(), null);
    assert.equal(cp.isLiveVersion('base', 'Hex'), true);
    assert.deepEqual(cp.readVersion('base', 'Hex'), cp.snapshotLive('Hex'));
    assert.equal(cp.readVersion('base', 'Nobody'), null);
    assert.equal(cp.countVersions('Hex'), 1);
});

test('addProfile on an inactive campaign clones base without touching live', () => {
    const before = JSON.stringify(cp.snapshotLive('Hex'));
    const p = cp.addProfile('c1', 'Hex');
    assert.equal(p.injection.description, 'base hex');
    assert.equal(cp.hasProfile('c1', 'Hex'), true);
    assert.equal(JSON.stringify(cp.snapshotLive('Hex')), before);
    assert.deepEqual(extensionSettings.campaignBaseShadow, {});
    assert.deepEqual(cp.listProfileCampaigns('Hex'), ['c1']);
    assert.equal(cp.countVersions('Hex'), 2);
    // idempotent
    cp.addProfile('c1', 'Hex');
    assert.equal(cp.listProfileCampaigns('Hex').length, 1);
});

test('switching in applies the override and parks base in the shadow', () => {
    cp.addProfile('c1', 'Hex');
    cp.writeVersion('c1', 'Hex', { ...cp.readVersion('c1', 'Hex'), avatar: '/user/images/des-portraits/hex-mecha.png', injection: { description: 'mecha hex', lorebook: '' } });
    activate('c1');
    assert.equal(extensionSettings.npcAvatars.Hex, '/user/images/des-portraits/hex-mecha.png');
    assert.equal(extensionSettings.characterInjection.Hex.description, 'mecha hex');
    // fields the override kept from the clone survive
    assert.equal(extensionSettings.characterRelationships.Hex, 'Ally');
    assert.equal(extensionSettings.campaignBaseShadow.Hex.injection.description, 'base hex');
    assert.equal(extensionSettings.campaignBaseShadow.Hex.avatar, '/user/images/des-portraits/hex-aaaaaaaa.png?t=1');
    // an un-overridden character is untouched
    assert.equal(extensionSettings.npcAvatars.Lucy, '/user/images/des-portraits/lucy-bbbbbbbb.png?t=1');
    assert.equal(cp.isLiveVersion('c1', 'Hex'), true);
    assert.equal(cp.isLiveVersion('base', 'Hex'), false);
    assert.equal(cp.isLiveVersion('base', 'Lucy'), true);
});

test('edits while active bank into the campaign; base edits stay base', () => {
    cp.addProfile('c1', 'Hex');
    activate('c1');
    extensionSettings.characterInjection.Hex.description = 'edited in play';
    extensionSettings.characterAppearance.Lucy = 'red coat'; // Lucy has no override → base edit
    assert.equal(cp.bankActiveCampaign(), 1);
    assert.equal(extensionSettings.campaignProfiles.c1.Hex.injection.description, 'edited in play');
    activate(null);
    assert.equal(extensionSettings.characterInjection.Hex.description, 'base hex');
    assert.equal(extensionSettings.characterAppearance.Lucy, 'red coat');
    assert.deepEqual(extensionSettings.campaignBaseShadow, {});
    assert.equal(extensionSettings.campaignProfiles.c1.Hex.injection.description, 'edited in play');
    // and it comes back on the next switch
    activate('c1');
    assert.equal(extensionSettings.characterInjection.Hex.description, 'edited in play');
});

test('switching campaign to campaign restores one override and applies the other', () => {
    cp.addProfile('c1', 'Hex');
    cp.addProfile('c2', 'Lucy');
    cp.writeVersion('c2', 'Lucy', { avatar: '/user/images/des-portraits/lucy-noir.png', relationship: 'Enemy' });
    activate('c1');
    activate('c2');
    assert.equal(extensionSettings.characterInjection.Hex.description, 'base hex');
    assert.equal(extensionSettings.npcAvatars.Lucy, '/user/images/des-portraits/lucy-noir.png');
    assert.equal(extensionSettings.characterRelationships.Lucy, 'Enemy');
    assert.deepEqual(Object.keys(extensionSettings.campaignBaseShadow), ['Lucy']);
    assert.equal(extensionSettings.campaignBaseShadow.Lucy.avatar, '/user/images/des-portraits/lucy-bbbbbbbb.png?t=1');
    activate(null);
    assert.equal(extensionSettings.npcAvatars.Lucy, '/user/images/des-portraits/lucy-bbbbbbbb.png?t=1');
    assert.equal(extensionSettings.characterRelationships.Lucy, undefined);
});

test('a character with no base entry disappears when the campaign switches away', () => {
    cp.addProfile('c1', 'Ghost');
    cp.writeVersion('c1', 'Ghost', { injection: { description: 'only in mecha', lorebook: '' } });
    activate('c1');
    assert.equal(extensionSettings.characterInjection.Ghost.description, 'only in mecha');
    assert.equal(extensionSettings.campaignBaseShadow.Ghost, null);
    activate(null);
    assert.equal(extensionSettings.characterInjection.Ghost, undefined);
    assert.equal(cp.readVersion('c1', 'Ghost').injection.description, 'only in mecha');
});

test('addProfile while active parks base and keeps live unchanged', () => {
    activate('c1');
    const liveBefore = JSON.stringify(cp.snapshotLive('Hex'));
    cp.addProfile('c1', 'Hex');
    assert.equal(JSON.stringify(cp.snapshotLive('Hex')), liveBefore);
    assert.equal(extensionSettings.campaignBaseShadow.Hex.injection.description, 'base hex');
    assert.equal(cp.isOverridden('Hex'), true);
    // editing the Base tab while overridden writes the shadow, not live
    cp.writeVersion('base', 'Hex', { ...cp.readVersion('base', 'Hex'), appearance: 'base-only edit' });
    assert.equal(extensionSettings.characterAppearance.Hex, 'silver hair');
    assert.equal(cp.readVersion('base', 'Hex').appearance, 'base-only edit');
    activate(null);
    assert.equal(extensionSettings.characterAppearance.Hex, 'base-only edit');
});

test('removeProfile while active restores base and reports its portraits', () => {
    cp.addProfile('c1', 'Hex');
    cp.writeVersion('c1', 'Hex', { ...cp.readVersion('c1', 'Hex'), avatar: '/user/images/des-portraits/hex-mecha.png', avatarFullRes: '/user/images/des-portraits/hex-mecha.png' });
    activate('c1');
    const candidates = cp.removeProfile('c1', 'Hex');
    assert.ok(candidates.includes('/user/images/des-portraits/hex-mecha.png'));
    assert.equal(extensionSettings.npcAvatars.Hex, '/user/images/des-portraits/hex-aaaaaaaa.png?t=1');
    assert.equal(cp.hasProfile('c1', 'Hex'), false);
    assert.deepEqual(extensionSettings.campaignBaseShadow, {});
    assert.deepEqual(cp.unreferencedPortraits(candidates), ['/user/images/des-portraits/hex-mecha.png']);
});

test('reference counting protects a file a cloned profile still shares', () => {
    cp.addProfile('c1', 'Hex'); // clone shares hex-aaaaaaaa.png
    const shared = extensionSettings.npcAvatars.Hex;
    delete extensionSettings.npcAvatars.Hex;
    delete extensionSettings.npcAvatarsFullRes.Hex;
    assert.deepEqual(cp.unreferencedPortraits([shared]), []);
    cp.removeProfile('c1', 'Hex');
    assert.deepEqual(cp.unreferencedPortraits([shared]), [shared]);
    // ?t= cache-bust variants are the same file
    extensionSettings.npcAvatars.Other = '/user/images/des-portraits/hex-aaaaaaaa.png?t=999';
    assert.deepEqual(cp.unreferencedPortraits([shared]), []);
    // user characters count as references too
    delete extensionSettings.npcAvatars.Other;
    extensionSettings.userCharacters = { Hex: { avatar: '/user/images/des-portraits/hex-aaaaaaaa.png' } };
    assert.deepEqual(cp.unreferencedPortraits([shared]), []);
});

test('deleteCharacterEverywhere clears every bucket and the shadow', () => {
    cp.addProfile('c1', 'Hex');
    cp.addProfile('c2', 'Hex');
    activate('c1');
    const candidates = cp.deleteCharacterEverywhere('Hex');
    assert.equal(cp.hasProfile('c1', 'Hex'), false);
    assert.equal(cp.hasProfile('c2', 'Hex'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(extensionSettings.campaignBaseShadow, 'Hex'), false);
    assert.ok(candidates.length >= 2);
    // live is the caller's job — still present here
    assert.ok(extensionSettings.npcAvatars.Hex);
    cp.removeFromLive('Hex');
    assert.equal(extensionSettings.npcAvatars.Hex, undefined);
    assert.equal(extensionSettings.characterKnives.Hex, undefined);
    // switching away afterwards must not resurrect anything
    activate(null);
    assert.equal(extensionSettings.npcAvatars.Hex, undefined);
});

test('deleteCampaignProfiles drops the bucket', () => {
    cp.addProfile('c1', 'Hex');
    cp.addProfile('c1', 'Lucy');
    const candidates = cp.deleteCampaignProfiles('c1');
    assert.equal(extensionSettings.campaignProfiles.c1, undefined);
    assert.ok(candidates.includes('/user/images/des-portraits/hex-aaaaaaaa.png?t=1'));
});

test('alias merge folds the variant into the canonical per bucket and parks the canonical base', () => {
    // Hexley is an active-campaign override; Hex is not overridden.
    extensionSettings.characterInjection.Hexley = { description: 'variant live', lorebook: '' };
    extensionSettings.npcAvatars.Hexley = '/user/images/des-portraits/hexley-cccccccc.png';
    cp.addProfile('c1', 'Hexley');
    cp.addProfile('c2', 'Hexley');
    cp.addProfile('c2', 'Hex');
    activate('c1');
    const candidates = cp.mergeVariantIntoCanonicalProfiles('Hex', 'Hexley');
    // canonical's base (its live entry right now) is parked
    assert.equal(extensionSettings.campaignBaseShadow.Hex.injection.description, 'base hex');
    assert.equal(cp.hasProfile('c1', 'Hexley'), false);
    assert.equal(cp.hasProfile('c1', 'Hex'), true);
    assert.equal(extensionSettings.campaignProfiles.c1.Hex.injection.description, 'variant live');
    // c2 had both: canonical keeps its own fields, variant's portrait is reported as dropped
    assert.equal(cp.hasProfile('c2', 'Hexley'), false);
    assert.equal(extensionSettings.campaignProfiles.c2.Hex.injection.description, 'base hex');
    assert.ok(candidates.includes('/user/images/des-portraits/hexley-cccccccc.png'));
    // shadow held Hexley's base too (it was overridden) and it merged into Hex's shadow entry
    assert.equal(Object.prototype.hasOwnProperty.call(extensionSettings.campaignBaseShadow, 'Hexley'), false);
});

test('ensureCampaignSettings repairs shape and a dangling active id', () => {
    delete extensionSettings.campaignProfiles;
    delete extensionSettings.lorebook.globalBooks;
    delete extensionSettings.lorebook.activeCampaignId;
    assert.equal(cp.ensureCampaignSettings(), true);
    assert.deepEqual(extensionSettings.campaignProfiles, {});
    assert.deepEqual(extensionSettings.lorebook.globalBooks, []);
    assert.equal(extensionSettings.lorebook.activeCampaignId, null);
    assert.equal(cp.ensureCampaignSettings(), false);
    // dangling id: campaign gone but its override is still live
    cp.addProfile('c1', 'Hex');
    cp.writeVersion('c1', 'Hex', { ...cp.readVersion('c1', 'Hex'), appearance: 'mecha look' });
    activate('c1');
    delete extensionSettings.lorebook.campaigns.c1;
    assert.equal(cp.ensureCampaignSettings(), true);
    assert.equal(extensionSettings.lorebook.activeCampaignId, null);
    assert.equal(extensionSettings.characterAppearance.Hex, 'silver hair');
    assert.deepEqual(extensionSettings.campaignBaseShadow, {});
});

test('book bookkeeping follows renames and deletes', () => {
    extensionSettings.lorebook.globalBooks = ['Shared Rules'];
    extensionSettings.lorebook.campaignActivated = ['Mecha Lore', 'Shared Rules'];
    cp.renameBookEverywhere('Shared Rules', 'House Rules');
    assert.deepEqual(extensionSettings.lorebook.globalBooks, ['House Rules']);
    assert.deepEqual(extensionSettings.lorebook.campaignActivated, ['Mecha Lore', 'House Rules']);
    assert.deepEqual(extensionSettings.lorebook.campaigns.c1.books, ['Mecha Lore', 'House Rules']);
    cp.forgetBook('House Rules');
    assert.deepEqual(extensionSettings.lorebook.globalBooks, []);
    assert.deepEqual(extensionSettings.lorebook.campaignActivated, ['Mecha Lore']);
    assert.deepEqual(extensionSettings.lorebook.campaigns.c1.books, ['Mecha Lore']);
});

test('snapshots are clones, not references', () => {
    const snap = cp.snapshotLive('Hex');
    snap.knives[0].text = 'mutated';
    assert.equal(extensionSettings.characterKnives.Hex[0].text, 'owes money');
    cp.addProfile('c1', 'Hex');
    const p = cp.getProfile('c1', 'Hex');
    p.injection.description = 'mutated';
    assert.equal(extensionSettings.campaignProfiles.c1.Hex.injection.description, 'base hex');
});

if (failures) {
    console.error(`\n${failures} failed, ${passes} passed`);
    process.exit(1);
}
console.log(`campaign-profiles-test: ${passes} passed`);
