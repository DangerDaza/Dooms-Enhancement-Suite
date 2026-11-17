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
    extensionSettings.campaignUserProfiles = {};
    extensionSettings.campaignUserBaseShadow = {};
    extensionSettings.characterInjection = { Hex: { description: 'base hex', lorebook: '' } };
    extensionSettings.characterAppearance = { Hex: 'silver hair' };
    extensionSettings.npcAvatars = { Hex: '/user/images/des-portraits/hex-aaaaaaaa.png?t=1', Lucy: '/user/images/des-portraits/lucy-bbbbbbbb.png?t=1' };
    extensionSettings.npcAvatarsFullRes = { Hex: '/user/images/des-portraits/hex-aaaaaaaa.png?t=1' };
    extensionSettings.npcAvatarHistory = {};
    extensionSettings.characterRelationships = { Hex: 'Ally' };
    extensionSettings.characterKnives = { Hex: [{ id: 'k1', text: 'owes money', used: false }] };
    extensionSettings.heroPositions = { Hex: { x: 40, y: 10 } };
    extensionSettings.generatedPortraits = {};
    extensionSettings.characterVoices = { Hex: { source: 'stock', id: 'Kore' } };
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

test('a live deletion under an active campaign frees the file (stale banked copy is ignored)', () => {
    cp.addProfile('c1', 'Hex');
    const own = '/user/images/des-portraits/hex-mecha-only.png?t=5';
    cp.writeVersion('c1', 'Hex', { ...cp.readVersion('c1', 'Hex'), avatar: own, avatarFullRes: own });
    activate('c1');
    cp.bankActiveCampaign(); // bucket now holds the same URL as live
    delete extensionSettings.npcAvatars.Hex;
    delete extensionSettings.npcAvatarsFullRes.Hex;
    assert.deepEqual(cp.unreferencedPortraits([own]), [own]);
    // base's own file is still pinned by the shadow
    assert.deepEqual(cp.unreferencedPortraits(['/user/images/des-portraits/hex-aaaaaaaa.png?t=1']), []);
    // and a copy held by an INACTIVE campaign pins too
    cp.addProfile('c2', 'Lucy');
    cp.writeVersion('c2', 'Lucy', { avatar: own });
    assert.deepEqual(cp.unreferencedPortraits([own]), []);
});

test('portraitRefCount counts every entry that shares the file', () => {
    // Hex: npcAvatars + npcAvatarsFullRes share one file
    assert.equal(cp.portraitRefCount(extensionSettings.npcAvatars.Hex), 2);
    delete extensionSettings.npcAvatarsFullRes.Hex;
    assert.equal(cp.portraitRefCount(extensionSettings.npcAvatars.Hex), 1);
    // a clone in an inactive campaign adds one
    cp.addProfile('c1', 'Hex');
    assert.equal(cp.portraitRefCount(extensionSettings.npcAvatars.Hex), 2);
    // once that campaign is active its bucket is the live view (not counted) but
    // the shadowed base entry now holds the shared file — still 2, so an
    // in-place overwrite of the file is refused
    activate('c1');
    assert.equal(cp.portraitRefCount(extensionSettings.npcAvatars.Hex), 2);
    // give the override its own file: only live references it
    extensionSettings.npcAvatars.Hex = '/user/images/des-portraits/hex-solo.png';
    assert.equal(cp.portraitRefCount(extensionSettings.npcAvatars.Hex), 1);
    assert.equal(cp.portraitRefCount('data:image/png;base64,xyz'), 0);
});

test('alias merge when the active campaign overrides the canonical but not the variant keeps the variant base', () => {
    // Base Alice has no portrait; Base Alyce has P; Mecha overrides Alice with Q.
    extensionSettings.npcAvatars.Alyce = '/user/images/des-portraits/alyce-pppppppp.png';
    extensionSettings.characterInjection.Alyce = { description: 'alyce base', lorebook: '' };
    extensionSettings.characterInjection.Alice = { description: 'alice base', lorebook: '' };
    cp.addProfile('c1', 'Alice');
    cp.writeVersion('c1', 'Alice', { injection: { description: 'alice mecha', lorebook: '' }, avatar: '/user/images/des-portraits/alice-qqqqqqqq.png' });
    activate('c1');
    const candidates = cp.mergeVariantIntoCanonicalProfiles('Alice', 'Alyce');
    // P moved into Alice's shadowed base, so it survives the live scrub
    assert.equal(extensionSettings.campaignBaseShadow.Alice.avatar, '/user/images/des-portraits/alyce-pppppppp.png');
    assert.equal(extensionSettings.campaignBaseShadow.Alice.injection.description, 'alice base');
    cp.removeFromLive('Alyce');
    assert.deepEqual(cp.unreferencedPortraits([...candidates, '/user/images/des-portraits/alyce-pppppppp.png']), []);
    activate(null);
    assert.equal(extensionSettings.npcAvatars.Alice, '/user/images/des-portraits/alyce-pppppppp.png');
});

test('ensureCampaignSettings scrubs non-string entries out of every book list', () => {
    extensionSettings.lorebook.campaigns.c1.books = ['Mecha Lore', undefined, '', null, 'Shared Rules'];
    extensionSettings.lorebook.globalBooks = [undefined, 'G'];
    extensionSettings.lorebook.campaignActivated = ['Mecha Lore', 42];
    const books = extensionSettings.lorebook.campaigns.c1.books; // same array must survive (UI may hold it)
    assert.equal(cp.ensureCampaignSettings(), true);
    assert.deepEqual(extensionSettings.lorebook.campaigns.c1.books, ['Mecha Lore', 'Shared Rules']);
    assert.equal(extensionSettings.lorebook.campaigns.c1.books, books);
    assert.deepEqual(extensionSettings.lorebook.globalBooks, ['G']);
    assert.deepEqual(extensionSettings.lorebook.campaignActivated, ['Mecha Lore']);
    assert.equal(cp.ensureCampaignSettings(), false);
});

test('ensureCampaignSettings drops buckets whose campaign no longer exists', () => {
    cp.addProfile('c1', 'Hex');
    extensionSettings.campaignProfiles.ghost = { Hex: { appearance: 'orphan' } };
    assert.deepEqual(cp.listProfileCampaigns('Hex'), ['c1']);
    assert.equal(cp.ensureCampaignSettings(), true);
    assert.equal(extensionSettings.campaignProfiles.ghost, undefined);
    assert.equal(cp.hasProfile('c1', 'Hex'), true);
});

test('alias merge under an active campaign survives a round-trip switch without resurrecting the variant', () => {
    extensionSettings.characterInjection.Hexley = { description: 'variant base', lorebook: '' };
    cp.addProfile('c1', 'Hexley');
    activate('c1');
    extensionSettings.characterInjection.Hexley.description = 'variant mecha (unbanked edit)';
    cp.mergeVariantIntoCanonicalProfiles('Hex', 'Hexley');
    // the merge banked first, so the canonical inherited the live edit in the active bucket
    assert.equal(extensionSettings.campaignProfiles.c1.Hex.injection.description, 'variant mecha (unbanked edit)');
    // simulate the live merge + scrub characterAliases performs next
    cp.removeFromLive('Hexley');
    cp.bankActiveCampaign();
    activate(null);
    activate('c1');
    activate(null);
    assert.equal(extensionSettings.characterInjection.Hexley, undefined);
    assert.equal(cp.hasProfile('c1', 'Hexley'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(extensionSettings.campaignBaseShadow, 'Hexley'), false);
    // the canonical's base was parked and comes back intact
    assert.equal(extensionSettings.characterInjection.Hex.description, 'base hex');
});

// ─── DES voices: the voice is versioned like the portrait ───────────────────

test('voice: a new campaign version clones base\'s voice', () => {
    const p = cp.addProfile('c1', 'Hex');
    assert.deepEqual(p.voice, { source: 'stock', id: 'Kore' });
    assert.deepEqual(cp.readVersion('c1', 'Hex').voice, { source: 'stock', id: 'Kore' });
});

test('voice: switching campaigns switches the live voice and back', () => {
    cp.addProfile('c1', 'Hex');
    const v = cp.readVersion('c1', 'Hex');
    v.voice = { source: 'stock', id: 'Puck' };
    cp.writeVersion('c1', 'Hex', v);
    assert.equal(extensionSettings.characterVoices.Hex.id, 'Kore', 'inactive edit does not touch live');
    activate('c1');
    assert.equal(extensionSettings.characterVoices.Hex.id, 'Puck');
    activate(null);
    assert.equal(extensionSettings.characterVoices.Hex.id, 'Kore');
});

test('voice: an edit made while a campaign is active is banked into that campaign', () => {
    cp.addProfile('c1', 'Hex');
    activate('c1');
    extensionSettings.characterVoices.Hex = { source: 'stock', id: 'Leda' };
    cp.bankActiveCampaign();
    activate(null);
    assert.equal(extensionSettings.characterVoices.Hex.id, 'Kore');
    assert.equal(cp.readVersion('c1', 'Hex').voice.id, 'Leda');
});

test('voice: removing a campaign\'s voice leaves the key absent (Narrator), not null', () => {
    cp.addProfile('c1', 'Hex');
    const v = cp.readVersion('c1', 'Hex');
    delete v.voice;
    cp.writeVersion('c1', 'Hex', v);
    activate('c1');
    assert.equal(Object.prototype.hasOwnProperty.call(extensionSettings.characterVoices, 'Hex'), false);
    activate(null);
    assert.equal(extensionSettings.characterVoices.Hex.id, 'Kore');
});

test('voice: deleteCharacterEverywhere + removeFromLive clear every copy', () => {
    cp.addProfile('c1', 'Hex');
    cp.deleteCharacterEverywhere('Hex');
    cp.removeFromLive('Hex');
    assert.equal(extensionSettings.characterVoices.Hex, undefined);
    assert.equal(cp.hasProfile('c1', 'Hex'), false);
});

test('voice: alias merge carries the variant\'s campaign voice to the canonical', () => {
    extensionSettings.characterVoices.Hexley = { source: 'stock', id: 'Fenrir' };
    extensionSettings.characterInjection.Hexley = { description: 'variant', lorebook: '' };
    cp.addProfile('c2', 'Hexley');
    cp.mergeVariantIntoCanonicalProfiles('Hex', 'Hexley');
    assert.equal(cp.readVersion('c2', 'Hex').voice.id, 'Fenrir');
});

test('voice refs: counted across live, shadow, inactive buckets, personas and the Narrator', () => {
    extensionSettings.characterVoices = { Hex: { source: 'designed', id: 'voice_A' }, Lucy: { source: 'designed', id: 'voice_A' } };
    cp.addProfile('c1', 'Hex');           // inactive c1 clones voice_A
    const c2 = cp.addProfile('c2', 'Hex'); // then give c2 a different voice
    cp.writeVersion('c2', 'Hex', { ...c2, voice: { source: 'designed', id: 'voice_B' } });
    extensionSettings.userCharacters = { Me: { voice: { source: 'designed', id: 'voice_A' } } };
    extensionSettings.voices = { narratorVoice: { source: 'designed', id: 'voice_B' } };
    assert.equal(cp.voiceRefCount('voice_A'), 4); // Hex base, Lucy, Hex c1, persona
    assert.equal(cp.voiceRefCount('voice_B'), 2); // Hex c2, Narrator
    const uses = cp.voiceUses('voice_B').map(u => `${u.kind}:${u.name}:${u.versionId}`).sort();
    assert.deepEqual(uses, ['character:Hex:c2', 'narrator:null:null']);
});

test('voice refs: the active bucket is not double-counted and live reports its campaign', () => {
    extensionSettings.characterVoices = { Hex: { source: 'designed', id: 'voice_A' } };
    cp.addProfile('c1', 'Hex');
    activate('c1');
    const uses = cp.voiceUses('voice_A').map(u => `${u.name}:${u.versionId}`).sort();
    assert.deepEqual(uses, ['Hex:base', 'Hex:c1']); // live (= c1) + shadowed base
});

test('voice refs: rewrite replaces every copy, including the active bucket, and survives a switch', () => {
    extensionSettings.characterVoices = { Hex: { source: 'designed', id: 'voice_A', label: 'Old' } };
    cp.addProfile('c1', 'Hex');
    cp.addProfile('c2', 'Hex');
    activate('c1');
    extensionSettings.voices = { narratorVoice: { source: 'designed', id: 'voice_A' } };
    const n = cp.rewriteVoiceRefs('voice_A', 'voice_NEW', { label: 'New' });
    assert.ok(n >= 4, 'changed ' + n);
    assert.equal(cp.voiceRefCount('voice_A'), 0);
    activate('c2');
    assert.deepEqual(extensionSettings.characterVoices.Hex, { source: 'designed', id: 'voice_NEW', label: 'New' });
    activate(null);
    assert.equal(extensionSettings.characterVoices.Hex.id, 'voice_NEW');
    assert.equal(extensionSettings.voices.narratorVoice.id, 'voice_NEW');
});

test('voice refs: rewrite to null removes the voice (Narrator fallback) everywhere', () => {
    extensionSettings.characterVoices = { Hex: { source: 'designed', id: 'voice_A' }, Lucy: { source: 'stock', id: 'Kore' } };
    cp.addProfile('c1', 'Hex');
    extensionSettings.userCharacters = { Me: { voice: { source: 'designed', id: 'voice_A' } } };
    extensionSettings.voices = { narratorVoice: { source: 'designed', id: 'voice_A' } };
    cp.rewriteVoiceRefs('voice_A', null);
    assert.equal(extensionSettings.characterVoices.Hex, undefined);
    assert.equal(extensionSettings.characterVoices.Lucy.id, 'Kore');
    assert.equal(cp.readVersion('c1', 'Hex').voice, undefined);
    assert.equal(extensionSettings.userCharacters.Me.voice, undefined);
    assert.deepEqual(extensionSettings.voices.narratorVoice, { source: 'stock', id: 'Charon' });
});

// ─── The player's own cards (userCharacters) ────────────────────────────────

const U = true; // the isUser argument

/** A player's card as the Workshop saves it. */
function seedPlayer() {
    extensionSettings.userCharacters = {
        Jordan: {
            color: '#abcdef',
            pronouns: 'they/them',
            linkedPersona: 'jordan.png',
            avatar: '/user/images/des-portraits/jordan-11111111.png?t=1',
            avatarFullRes: '/user/images/des-portraits/jordan-11111111.png?t=1',
            injection: { description: 'base jordan', lorebook: '' },
            knives: [{ id: 'k1', text: 'left home', used: false }],
            voice: { source: 'stock', id: 'Puck' },
        },
    };
}
const card = () => extensionSettings.userCharacters.Jordan;

test('player: with no campaign Base is live and holds only the versioned fields', () => {
    seedPlayer();
    assert.equal(cp.isLiveVersion('base', 'Jordan', U), true);
    assert.equal(cp.countVersions('Jordan', U), 1);
    const base = cp.readVersion('base', 'Jordan', U);
    assert.deepEqual(Object.keys(base).sort(), ['avatar', 'avatarFullRes', 'injection', 'knives', 'voice']);
    assert.equal(base.injection.description, 'base jordan');
    assert.equal(cp.readVersion('base', 'Nobody', U), null);
});

test('player: a version in an inactive campaign is a clone; activating swaps the card, leaving swaps it back', () => {
    seedPlayer();
    cp.addProfile('c1', 'Jordan', { isUser: U });
    assert.equal(cp.hasProfile('c1', 'Jordan', U), true);
    assert.equal(cp.hasProfile('c1', 'Jordan'), false, 'not an NPC version');
    assert.deepEqual(cp.listProfileCampaigns('Jordan', U), ['c1']);
    assert.equal(cp.countVersions('Jordan', U), 2);
    assert.equal(card().injection.description, 'base jordan', 'the card is untouched while c1 is inactive');

    const v = cp.readVersion('c1', 'Jordan', U);
    v.injection.description = 'mecha pilot jordan';
    v.avatar = '/user/images/des-portraits/jordan-22222222.png?t=1';
    v.avatarFullRes = v.avatar;
    v.knives = [];
    delete v.voice;
    cp.writeVersion('c1', 'Jordan', v, U);
    assert.equal(card().injection.description, 'base jordan');

    activate('c1');
    assert.equal(cp.isLiveVersion('c1', 'Jordan', U), true);
    assert.equal(cp.isLiveVersion('base', 'Jordan', U), false);
    assert.equal(card().injection.description, 'mecha pilot jordan');
    assert.equal(card().avatar, '/user/images/des-portraits/jordan-22222222.png?t=1');
    assert.deepEqual(card().knives, []);
    assert.equal(card().voice, undefined, 'a version without a voice has none on the card');
    // The card's own fields are the same whichever campaign is active.
    assert.equal(card().color, '#abcdef');
    assert.equal(card().pronouns, 'they/them');
    assert.equal(card().linkedPersona, 'jordan.png');
    assert.equal(cp.readVersion('base', 'Jordan', U).injection.description, 'base jordan', 'Base is parked');

    activate(null);
    assert.equal(card().injection.description, 'base jordan');
    assert.equal(card().avatar, '/user/images/des-portraits/jordan-11111111.png?t=1');
    assert.deepEqual(card().voice, { source: 'stock', id: 'Puck' });
    assert.deepEqual(extensionSettings.campaignUserBaseShadow, {});
    assert.equal(cp.readVersion('c1', 'Jordan', U).injection.description, 'mecha pilot jordan');
});

test('player: edits made while a campaign is active are banked and survive a switch to another campaign', () => {
    seedPlayer();
    cp.addProfile('c1', 'Jordan', { isUser: U });
    cp.addProfile('c2', 'Jordan', { isUser: U });
    activate('c1');
    card().injection.description = 'edited in play';
    card().color = '#111111';
    assert.equal(cp.bankActiveCampaign(), 1);
    assert.equal(extensionSettings.campaignUserProfiles.c1.Jordan.injection.description, 'edited in play');
    assert.equal(extensionSettings.campaignUserProfiles.c1.Jordan.color, undefined, 'colour is not a versioned field');
    activate('c2');
    assert.equal(card().injection.description, 'base jordan', 'c2 was cloned from Base');
    assert.equal(card().color, '#111111', 'the colour edit stays on the card');
    activate('c1');
    assert.equal(card().injection.description, 'edited in play');
    activate(null);
    assert.equal(card().injection.description, 'base jordan');
});

test('player: adding a version while its campaign is active parks Base; removing it brings Base back', () => {
    seedPlayer();
    activate('c1');
    cp.addProfile('c1', 'Jordan', { isUser: U });
    assert.equal(cp.isOverridden('Jordan', U), true);
    assert.equal(extensionSettings.campaignUserBaseShadow.Jordan.injection.description, 'base jordan');
    card().injection.description = 'c1 jordan';
    card().avatar = '/user/images/des-portraits/jordan-33333333.png?t=1';
    const candidates = cp.removeProfile('c1', 'Jordan', U);
    assert.equal(card().injection.description, 'base jordan');
    assert.equal(card().avatar, '/user/images/des-portraits/jordan-11111111.png?t=1');
    assert.ok(candidates.includes('/user/images/des-portraits/jordan-33333333.png?t=1'), 'the dropped version\'s portrait is a deletion candidate');
    assert.deepEqual(extensionSettings.campaignUserBaseShadow, {});
    assert.equal(cp.hasProfile('c1', 'Jordan', U), false);
    // Base's file is still on the card, so it is not an orphan.
    assert.deepEqual(cp.unreferencedPortraits(candidates), ['/user/images/des-portraits/jordan-33333333.png?t=1']);
});

test('player: a persona and an NPC of one name keep separate versions', () => {
    seedPlayer();
    extensionSettings.userCharacters.Hex = { color: '#fff', injection: { description: 'player hex', lorebook: '' } };
    cp.addProfile('c1', 'Hex');
    cp.addProfile('c1', 'Hex', { isUser: U });
    const npc = cp.readVersion('c1', 'Hex');
    npc.injection.description = 'npc hex in mecha';
    cp.writeVersion('c1', 'Hex', npc);
    const player = cp.readVersion('c1', 'Hex', U);
    player.injection.description = 'player hex in mecha';
    cp.writeVersion('c1', 'Hex', player, U);
    activate('c1');
    assert.equal(extensionSettings.characterInjection.Hex.description, 'npc hex in mecha');
    assert.equal(extensionSettings.userCharacters.Hex.injection.description, 'player hex in mecha');
    // Deleting the NPC everywhere leaves the player's versions alone, and the other way round.
    cp.deleteCharacterEverywhere('Hex');
    assert.equal(cp.hasProfile('c1', 'Hex', U), true);
    cp.deleteCharacterEverywhere('Hex', U);
    assert.equal(cp.hasProfile('c1', 'Hex', U), false);
    assert.equal(extensionSettings.campaignUserBaseShadow.Hex, undefined);
});

test('player: deleting the card everywhere returns every version\'s portraits', () => {
    seedPlayer();
    cp.addProfile('c1', 'Jordan', { isUser: U });
    const v = cp.readVersion('c1', 'Jordan', U);
    v.avatar = '/user/images/des-portraits/jordan-22222222.png?t=1';
    v.avatarFullRes = v.avatar;
    cp.writeVersion('c1', 'Jordan', v, U);
    activate('c1');
    const live = [card().avatar, card().avatarFullRes];
    delete extensionSettings.userCharacters.Jordan;
    const candidates = [...live, ...cp.deleteCharacterEverywhere('Jordan', U)];
    assert.equal(cp.countVersions('Jordan', U), 1);
    assert.deepEqual(extensionSettings.campaignUserBaseShadow, {});
    const orphans = cp.unreferencedPortraits(candidates).map(cp.portraitRefKey).sort();
    assert.deepEqual(orphans, ['/user/images/des-portraits/jordan-11111111.png', '/user/images/des-portraits/jordan-22222222.png']);
});

test('player: a version never brings back a card the player deleted', () => {
    seedPlayer();
    cp.addProfile('c1', 'Jordan', { isUser: U });
    assert.equal(cp.addProfile('c1', 'Ghost', { isUser: U }), null, 'no card, no version');
    // The card goes without its versions being cleared (a crash between the two steps).
    delete extensionSettings.userCharacters.Jordan;
    activate('c1');
    assert.equal(extensionSettings.userCharacters.Jordan, undefined);
    assert.deepEqual(extensionSettings.campaignUserBaseShadow, {});
    cp.bankActiveCampaign();
    assert.equal(extensionSettings.campaignUserProfiles.c1.Jordan.injection.description, 'base jordan', 'the saved version is not banked over');
    activate(null);
    assert.equal(extensionSettings.userCharacters.Jordan, undefined);
});

test('player: deleting a campaign drops its player versions and reports their portraits', () => {
    seedPlayer();
    cp.addProfile('c1', 'Jordan', { isUser: U });
    cp.addProfile('c1', 'Hex');
    const candidates = cp.deleteCampaignProfiles('c1');
    assert.equal(extensionSettings.campaignUserProfiles.c1, undefined);
    assert.equal(extensionSettings.campaignProfiles.c1, undefined);
    assert.ok(candidates.includes('/user/images/des-portraits/jordan-11111111.png?t=1'));
    assert.deepEqual(cp.unreferencedPortraits(candidates), [], 'Base still uses both files');
});

test('player: a portrait only an inactive version uses is still referenced', () => {
    seedPlayer();
    cp.addProfile('c1', 'Jordan', { isUser: U });
    // Base gets a new picture; the old file now belongs to c1's version alone.
    const old = card().avatar;
    card().avatar = '/user/images/des-portraits/jordan-44444444.png?t=1';
    card().avatarFullRes = card().avatar;
    assert.deepEqual(cp.unreferencedPortraits([old]), []);
    assert.equal(cp.portraitRefCount(old), 2, 'c1\'s avatar and avatarFullRes');
    cp.removeProfile('c1', 'Jordan', U);
    assert.deepEqual(cp.unreferencedPortraits([old]), [old]);
});

test('player: voice uses name the version, and a rewrite reaches every version', () => {
    seedPlayer();
    card().voice = { source: 'designed', id: 'voice_A' };
    cp.addProfile('c1', 'Jordan', { isUser: U });
    cp.addProfile('c2', 'Jordan', { isUser: U });
    assert.deepEqual(cp.voiceUses('voice_A').map(u => `${u.kind}:${u.name}:${u.versionId}`).sort(),
        ['persona:Jordan:base', 'persona:Jordan:c1', 'persona:Jordan:c2']);
    activate('c1');
    assert.deepEqual(cp.voiceUses('voice_A').map(u => `${u.kind}:${u.name}:${u.versionId}`).sort(),
        ['persona:Jordan:base', 'persona:Jordan:c1', 'persona:Jordan:c2'], 'the same three with c1 live');
    assert.equal(cp.rewriteVoiceRefs('voice_A', 'voice_B'), 4, 'the card, the parked Base and both buckets');
    assert.equal(cp.voiceRefCount('voice_A'), 0);
    activate('c2');
    assert.equal(card().voice.id, 'voice_B');
    activate(null);
    assert.equal(card().voice.id, 'voice_B');
    cp.rewriteVoiceRefs('voice_B', null);
    assert.equal(card().voice, undefined);
    assert.equal(cp.readVersion('c1', 'Jordan', U).voice, undefined);
});

test('player: the load-time guard gives the stores their shape and repairs a dangling active campaign', () => {
    seedPlayer();
    delete extensionSettings.campaignUserProfiles;
    delete extensionSettings.campaignUserBaseShadow;
    assert.equal(cp.ensureCampaignSettings(), true);
    assert.deepEqual(extensionSettings.campaignUserProfiles, {});
    assert.deepEqual(extensionSettings.campaignUserBaseShadow, {});

    cp.addProfile('c1', 'Jordan', { isUser: U });
    const v = cp.readVersion('c1', 'Jordan', U);
    v.injection.description = 'c1 jordan';
    cp.writeVersion('c1', 'Jordan', v, U);
    activate('c1');
    assert.equal(card().injection.description, 'c1 jordan');
    // The campaign is deleted on another device while it was active here.
    delete extensionSettings.lorebook.campaigns.c1;
    assert.equal(cp.ensureCampaignSettings(), true);
    assert.equal(extensionSettings.lorebook.activeCampaignId, null);
    assert.equal(card().injection.description, 'base jordan', 'Base is back on the card');
    assert.equal(extensionSettings.campaignUserProfiles.c1, undefined, 'the orphaned bucket is gone');
    assert.deepEqual(extensionSettings.campaignUserBaseShadow, {});
});

test('player: the cards a switch changes are those either campaign has a version of', () => {
    seedPlayer();
    extensionSettings.userCharacters.Ash = { color: '#000' };
    cp.addProfile('c1', 'Jordan', { isUser: U });
    cp.addProfile('c2', 'Ash', { isUser: U });
    assert.deepEqual(cp.userNamesWithVersionIn('c1', null), ['Jordan']);
    assert.deepEqual(cp.userNamesWithVersionIn('c1', 'c2').sort(), ['Ash', 'Jordan']);
    assert.deepEqual(cp.userNamesWithVersionIn(null, null), []);
});

// ─── The linked persona's avatar file ───────────────────────────────────────

test('persona file: a portrait value that is the persona\'s own file is recognised in every form it takes', () => {
    const is = cp.isPersonaFileRef;
    assert.equal(is('/User%20Avatars/jordan.png', 'jordan.png'), true, 'as the persona import stores it');
    assert.equal(is('/User Avatars/jordan.png', 'jordan.png'), true);
    assert.equal(is('/User%20Avatars/jordan.png?t=1700000000', 'jordan.png'), true, 'with a cache-bust');
    assert.equal(is('User Avatars/Jordan.PNG', 'jordan.png'), true, 'case does not make another file');
    assert.equal(is('/User%20Avatars/my%20hero%20(1).png', 'my hero (1).png'), true, 'spaces and brackets in the file name');
    assert.equal(is('/thumbnail?type=persona&file=jordan.png', 'jordan.png'), true, 'its thumbnail');
    assert.equal(is('/thumbnail?type=persona&file=my%20hero%20(1).png', 'my hero (1).png'), true);
    // Not the persona's file:
    assert.equal(is('/User%20Avatars/other.png', 'jordan.png'), false, 'another persona\'s file');
    assert.equal(is('/User%20Avatars/notjordan.png', 'jordan.png'), false);
    assert.equal(is('/thumbnail?type=avatar&file=jordan.png', 'jordan.png'), false, 'a character card\'s thumbnail');
    assert.equal(is('/thumbnail?type=persona&file=jordan.png.bak', 'jordan.png'), false);
    assert.equal(is('/user/images/des-portraits/jordan-11111111.png?t=1', 'jordan.png'), false, 'a portrait DES keeps');
    assert.equal(is('data:image/png;base64,AAAA', 'jordan.png'), false, 'a fresh upload');
    assert.equal(is('', 'jordan.png'), false);
    assert.equal(is('/User%20Avatars/jordan.png', ''), false, 'no linked persona');
    assert.equal(is('/User%20Avatars/100%25.png', '100%.png'), true, 'a % in the file name, encoded as the import writes it');
    assert.equal(is('/User%20Avatars/100%.png', '100%.png'), true, 'a stray % does not throw');
    assert.equal(is('/User Avatars/100%.png', '100%.png'), true);
});

test('persona file: the versions with no portrait of their own are named, wherever each version is kept', () => {
    seedPlayer();
    // Every version has its own portrait (a clone shares Base's file: still its own).
    cp.addProfile('c1', 'Jordan', { isUser: U });
    assert.deepEqual(cp.userVersionsWithoutOwnPortrait('Jordan'), []);
    // An imported persona: Base holds the persona's file itself.
    card().avatar = '/User%20Avatars/jordan.png';
    card().avatarFullRes = card().avatar;
    assert.deepEqual(cp.userVersionsWithoutOwnPortrait('Jordan'), ['base']);
    // The same answer with c1 live, when Base sits in the shadow.
    activate('c1');
    assert.deepEqual(cp.userVersionsWithoutOwnPortrait('Jordan'), ['base']);
    // A version with no portrait at all counts too; so does one that is not active.
    cp.addProfile('c2', 'Jordan', { isUser: U });
    const v = cp.readVersion('c2', 'Jordan', U);
    delete v.avatar; delete v.avatarFullRes;
    cp.writeVersion('c2', 'Jordan', v, U);
    assert.deepEqual(cp.userVersionsWithoutOwnPortrait('Jordan'), ['base', 'c2']);
    activate(null);
    // Base gets a portrait of its own: only c2 is left.
    card().avatar = '/user/images/des-portraits/jordan-55555555.png?t=1';
    assert.deepEqual(cp.userVersionsWithoutOwnPortrait('Jordan'), ['c2']);
    // Another persona's file is a picture this card's persona file cannot change.
    const w = cp.readVersion('c2', 'Jordan', U);
    w.avatar = '/User%20Avatars/someone-else.png';
    cp.writeVersion('c2', 'Jordan', w, U);
    assert.deepEqual(cp.userVersionsWithoutOwnPortrait('Jordan'), []);
    assert.deepEqual(cp.userVersionsWithoutOwnPortrait('Nobody'), [], 'no such card');
});

if (failures) {
    console.error(`\n${failures} failed, ${passes} passed`);
    process.exit(1);
}
console.log(`campaign-profiles-test: ${passes} passed`);
