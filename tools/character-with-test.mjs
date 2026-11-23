#!/usr/bin/env node
/**
 * A character as each of the player's characters knows them
 * (src/utils/characterWith.js, D234), and its place among the Workshop's
 * version-backed stores (src/systems/lorebook/campaignProfiles.js).
 *
 * Usage:  node tools/character-with-test.mjs     (from the repo root)
 * Exit:   0 = pass, 1 = failure
 */
import { strict as assert } from 'node:assert';
import { cleanView, cleanWith, withOf, playersWith, viewFor, relationshipFor, descriptionFor, setView, withChoices, WITH_RELATIONSHIP_MAX } from '../src/utils/characterWith.js';

const { extensionSettings } = await import('../src/core/state.js');
const cp = await import('../src/systems/lorebook/campaignProfiles.js');

let failures = 0;
let passes = 0;
function test(name, fn) {
    try { fn(); passes++; } catch (e) { failures++; console.error(`FAIL: ${name}\n  ${e?.message || e}`); }
}

const world = () => ({
    userCharacters: { Jack: {}, 'Eli Vega': {} },
    characterRelationships: { Roxy: 'Lover', Mara: 'Friend' },
    characterInjection: {
        Roxy: { description: 'Roxy Vance, 26, bartender. Jack\'s on-and-off girlfriend.', lorebook: 'Nightcity' },
        Mara: { description: 'Mara, a fixer.', lorebook: '' },
    },
    characterWith: {
        Roxy: { 'Eli Vega': { relationship: 'Enemy', description: 'Roxy Vance, 26, bartender. Knows Eli only as the Minotaur.' } },
    },
});

// ── 1. The rule ──
test('a player with a side reads their own', () => {
    const s = world();
    assert.equal(relationshipFor(s, 'Roxy', 'Eli Vega'), 'Enemy');
    assert.equal(descriptionFor(s, 'Roxy', 'Eli Vega'), 'Roxy Vance, 26, bartender. Knows Eli only as the Minotaur.');
});
test('a player with none reads the shared ones', () => {
    const s = world();
    assert.equal(relationshipFor(s, 'Roxy', 'Jack'), 'Lover');
    assert.equal(descriptionFor(s, 'Roxy', 'Jack'), 'Roxy Vance, 26, bartender. Jack\'s on-and-off girlfriend.');
    assert.equal(relationshipFor(s, 'Mara', 'Eli Vega'), 'Friend');
});
test('nobody played reads the shared ones', () => {
    const s = world();
    assert.equal(relationshipFor(s, 'Roxy', ''), 'Lover');
    assert.equal(relationshipFor(s, 'Roxy', null), 'Lover');
    assert.equal(descriptionFor(s, 'Roxy'), 'Roxy Vance, 26, bartender. Jack\'s on-and-off girlfriend.');
});
test('a field left empty for a player is the shared one', () => {
    const s = world();
    s.characterWith.Roxy['Eli Vega'] = { relationship: 'Enemy' };
    assert.equal(relationshipFor(s, 'Roxy', 'Eli Vega'), 'Enemy');
    assert.equal(descriptionFor(s, 'Roxy', 'Eli Vega'), 'Roxy Vance, 26, bartender. Jack\'s on-and-off girlfriend.');
    s.characterWith.Roxy['Eli Vega'] = { description: 'Only the notes.' };
    assert.equal(relationshipFor(s, 'Roxy', 'Eli Vega'), 'Lover');
    assert.equal(descriptionFor(s, 'Roxy', 'Eli Vega'), 'Only the notes.');
});
test('names are found whatever their case', () => {
    const s = world();
    assert.equal(relationshipFor(s, 'roxy', 'eli vega'), 'Enemy');
    assert.equal(relationshipFor(s, 'ROXY', 'JACK'), 'Lover');
    assert.deepEqual(viewFor(s, 'roxy', 'ELI VEGA'), s.characterWith.Roxy['Eli Vega']);
});
test('a character with nothing set reads nothing', () => {
    const s = world();
    assert.equal(relationshipFor(s, 'Nobody', 'Jack'), '');
    assert.equal(descriptionFor(s, 'Nobody', 'Eli Vega'), '');
    assert.equal(relationshipFor({}, 'Roxy', 'Jack'), '');
    assert.equal(descriptionFor(null, 'Roxy', 'Jack'), '');
    assert.equal(viewFor(s, 'Mara', 'Eli Vega'), null);
});

// ── 2. Made safe ──
test('a side keeps only what is written', () => {
    assert.deepEqual(cleanView({ relationship: '  Enemy ', description: '  ', extra: 1 }), { relationship: 'Enemy' });
    assert.deepEqual(cleanView({ description: ' Notes. ' }), { description: 'Notes.' });
    assert.equal(cleanView({ relationship: '', description: '' }), null);
    assert.equal(cleanView(null), null);
    assert.equal(cleanView('Enemy'), null);
    assert.equal(cleanView({ relationship: 'x'.repeat(200) }).relationship.length, WITH_RELATIONSHIP_MAX);
});
test('a character\'s sides: a player once, empty sides dropped', () => {
    assert.deepEqual(cleanWith({ 'Eli Vega': { relationship: 'Enemy' }, 'eli vega': { relationship: 'Friend' }, Jack: {}, '': { relationship: 'Ally' } }), { 'Eli Vega': { relationship: 'Enemy' } });
    assert.equal(cleanWith({ Jack: { relationship: '' } }), null);
    assert.equal(cleanWith([]), null);
});
test('what is stored is read safely and never handed out to be changed', () => {
    const s = world();
    s.characterWith.Roxy.Broken = 'nope';
    const sides = withOf(s, 'Roxy');
    assert.deepEqual(Object.keys(sides), ['Eli Vega']);
    sides['Eli Vega'].relationship = 'Changed';
    assert.equal(s.characterWith.Roxy['Eli Vega'].relationship, 'Enemy');
    assert.deepEqual(playersWith(s, 'Roxy'), ['Eli Vega']);
    assert.deepEqual(playersWith(s, 'Mara'), []);
});

// ── 3. Setting a side ──
test('setting a field keeps the other', () => {
    const s = world();
    assert.deepEqual(setView(s, 'Roxy', 'Eli Vega', { relationship: 'Ally' }), { relationship: 'Ally', description: 'Roxy Vance, 26, bartender. Knows Eli only as the Minotaur.' });
    assert.equal(relationshipFor(s, 'Roxy', 'Eli Vega'), 'Ally');
});
test('clearing a field leaves the other; clearing both drops the side and the entry', () => {
    const s = world();
    setView(s, 'Roxy', 'Eli Vega', { relationship: '' });
    assert.deepEqual(s.characterWith.Roxy, { 'Eli Vega': { description: 'Roxy Vance, 26, bartender. Knows Eli only as the Minotaur.' } });
    assert.equal(setView(s, 'Roxy', 'Eli Vega', { description: '' }), null);
    assert.equal('Roxy' in s.characterWith, false);
    assert.equal(relationshipFor(s, 'Roxy', 'Eli Vega'), 'Lover');
});
test('a first side makes the entry, and the store when there is none', () => {
    const s = { characterRelationships: { Mara: 'Friend' } };
    setView(s, 'Mara', 'Jack', { relationship: 'Enemy' });
    assert.deepEqual(s.characterWith, { Mara: { Jack: { relationship: 'Enemy' } } });
    setView(s, 'Mara', 'Eli Vega', { description: 'Owes Eli.' });
    assert.deepEqual(Object.keys(s.characterWith.Mara), ['Jack', 'Eli Vega']);
});
test('a side is set under the spelling it already has', () => {
    const s = world();
    setView(s, 'roxy', 'ELI VEGA', { relationship: 'Friend' });
    assert.deepEqual(Object.keys(s.characterWith), ['Roxy']);
    assert.deepEqual(Object.keys(s.characterWith.Roxy), ['Eli Vega']);
    assert.equal(s.characterWith.Roxy['Eli Vega'].relationship, 'Friend');
});
test('nothing is set for no one', () => {
    const s = world();
    assert.equal(setView(s, 'Roxy', '', { relationship: 'Ally' }), null);
    assert.equal(setView(s, '', 'Jack', { relationship: 'Ally' }), null);
    assert.equal(setView(null, 'Roxy', 'Jack', { relationship: 'Ally' }), null);
    assert.deepEqual(Object.keys(s.characterWith.Roxy), ['Eli Vega']);
});

// ── 4. The Workshop's choices ──
test('fewer than two user characters and nothing written: no choice to make', () => {
    assert.deepEqual(withChoices(['Jack'], {}), []);
    assert.deepEqual(withChoices([], null), []);
});
test('two user characters: everyone, then each', () => {
    assert.deepEqual(withChoices(['Jack', 'Eli Vega'], { 'Eli Vega': { relationship: 'Enemy' } }), [
        { id: '', label: 'Everyone', written: true, gone: false },
        { id: 'Jack', label: 'Jack', written: false, gone: false },
        { id: 'Eli Vega', label: 'Eli Vega', written: true, gone: false },
    ]);
});
test('a side for someone who is no longer a user character can still be reached', () => {
    const c = withChoices(['Jack'], { 'Old Hand': { description: 'Notes.' } });
    assert.deepEqual(c.map(x => x.id), ['', 'Jack', 'Old Hand']);
    assert.equal(c[2].gone, true);
    assert.equal(c[2].written, true);
});

// ── 5. A campaign's version of a character carries its own sides ──
function resetSettings() {
    for (const k of ['characterInjection', 'characterRelationships', 'characterWith', 'npcAvatars', 'npcAvatarsFullRes', 'npcAvatarHistory', 'characterKnives', 'heroPositions', 'generatedPortraits', 'characterVoices', 'characterAppearance', 'characterLoras']) extensionSettings[k] = {};
    extensionSettings.campaignProfiles = {};
    extensionSettings.campaignBaseShadow = {};
    extensionSettings.lorebook = { activeCampaignId: null, campaigns: { nc: { name: 'Night City', books: [] }, nd: { name: 'Neverdark', books: [] } } };
}
const switchTo = (id) => { cp.switchCampaignProfiles(cp.getActiveCampaignId(), id); extensionSettings.lorebook.activeCampaignId = id; };

test('a version made from another starts with its sides, and then keeps its own', () => {
    resetSettings();
    extensionSettings.characterRelationships.Nina = 'Friend';
    extensionSettings.characterWith.Nina = { Jack: { relationship: 'Lover' } };
    cp.addProfile('nd', 'Nina');
    assert.deepEqual(cp.getProfile('nd', 'Nina').with, { Jack: { relationship: 'Lover' } });
    switchTo('nd');
    setView(extensionSettings, 'Nina', 'Eli', { relationship: 'Enemy' });
    setView(extensionSettings, 'Nina', 'Jack', { relationship: '' });
    assert.deepEqual(extensionSettings.characterWith.Nina, { Eli: { relationship: 'Enemy' } });
    switchTo(null);
    assert.deepEqual(extensionSettings.characterWith.Nina, { Jack: { relationship: 'Lover' } }, 'the base sides are back');
    assert.deepEqual(cp.getProfile('nd', 'Nina').with, { Eli: { relationship: 'Enemy' } }, 'the campaign kept its own');
    switchTo('nd');
    assert.equal(relationshipFor(extensionSettings, 'Nina', 'Eli'), 'Enemy');
    assert.equal(relationshipFor(extensionSettings, 'Nina', 'Jack'), 'Friend');
});
test('a character the campaign has no version of keeps one set of sides', () => {
    resetSettings();
    extensionSettings.characterWith.Roxy = { 'Eli Vega': { relationship: 'Enemy' } };
    switchTo('nc');
    assert.deepEqual(extensionSettings.characterWith.Roxy, { 'Eli Vega': { relationship: 'Enemy' } });
    setView(extensionSettings, 'Roxy', 'Jack', { relationship: 'Lover' });
    switchTo(null);
    assert.deepEqual(Object.keys(extensionSettings.characterWith.Roxy), ['Eli Vega', 'Jack']);
});
test('a character deleted takes its sides along', () => {
    resetSettings();
    extensionSettings.characterWith.Roxy = { 'Eli Vega': { relationship: 'Enemy' } };
    cp.addProfile('nc', 'Roxy');
    cp.deleteCharacterEverywhere('Roxy');
    cp.removeFromLive('Roxy');
    assert.equal('Roxy' in extensionSettings.characterWith, false);
    assert.equal(cp.hasProfile('nc', 'Roxy'), false);
});
test('a profile saved before there were sides is read as having none', () => {
    resetSettings();
    extensionSettings.campaignProfiles.nc = { Roxy: { relationship: 'Friend', injection: { description: 'As saved.', lorebook: '' } } };
    switchTo('nc');
    assert.equal('Roxy' in extensionSettings.characterWith, false);
    assert.equal(relationshipFor(extensionSettings, 'Roxy', 'Eli Vega'), 'Friend');
    assert.equal(descriptionFor(extensionSettings, 'Roxy', 'Eli Vega'), 'As saved.');
});

console.log(`character-with-test: ${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
