#!/usr/bin/env node
/**
 * Golden-file test for the tracker prompt.
 *
 * The Tracker Prompt editor (P1) refactored the prompt assembly out of
 * generateTrackerInstructions into buildTrackerPromptBlock so the editor can
 * show and replace the real thing. The hard requirement of that refactor is
 * that a DEFAULT configuration still emits a BYTE-IDENTICAL prompt — a silent
 * wording drift here changes what every user's model receives.
 *
 * This locks that down, plus the override path and the key-warning helper.
 *
 * Usage:  node tools/tracker-prompt-test.mjs     (from the repo root)
 * Exit:   0 = pass, 1 = failure
 *
 * Mechanism: promptBuilder.js imports SillyTavern modules that don't exist
 * outside the browser, so this reuses the stub sandbox tools/load-check.mjs
 * already builds (it runs load-check first, then imports from /tmp/des-load-check).
 * Run it after load-check in the same push.
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const SANDBOX = '/tmp/des-load-check';
const DES = `${SANDBOX}/scripts/extensions/third-party/DES`;

// Rebuild the sandbox from the current working tree.
execFileSync(process.execPath, ['tools/load-check.mjs'], { stdio: 'pipe' });
if (!existsSync(`${DES}/src/systems/generation/promptBuilder.js`)) {
    console.error('FAIL: sandbox missing after load-check — cannot run.');
    process.exit(1);
}

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
globalThis.$ = anything;
globalThis.toastr = anything;

const { extensionSettings } = await import(`${DES}/src/core/state.js`);
const pb = await import(`${DES}/src/systems/generation/promptBuilder.js`);

let failures = 0;
const check = (label, cond, extra = '') => {
    if (cond) { console.log(`pass  ${label}`); }
    else { console.error(`FAIL  ${label}${extra ? '\n      ' + extra : ''}`); failures++; }
};

// A default-ish config: every tracker on, nothing customized.
function resetSettings() {
    extensionSettings.showQuests = true;
    extensionSettings.showInfoBox = true;
    extensionSettings.showCharacterThoughts = true;
    extensionSettings.compactPrompts = true;
    extensionSettings.customTrackerPrompt = '';
    extensionSettings.customTrackerInstructionsPrompt = '';
    extensionSettings.customTrackerContinuationPrompt = '';
    extensionSettings.enableHtmlPrompt = false;
    extensionSettings.doomCounter = { enabled: false };
}
resetSettings();

// ── 1. The generated block is embedded verbatim in the full instructions ──
// This is the invariant that proves the extraction didn't alter assembly:
// whatever buildTrackerPromptBlock returns must appear, unmodified, inside
// generateTrackerInstructions' output.
// Resolve the user name exactly the way generateTrackerInstructions does, so
// the comparison isolates the assembly and not the persona lookup.
const { getContext } = await import(`${SANDBOX}/scripts/extensions.js`);
const CTX_NAME = getContext().name1;
const block = pb.buildTrackerPromptBlock(CTX_NAME, true);
const full = pb.generateTrackerInstructions(false, false);
check('generated block is embedded verbatim in the full instructions',
    full.includes(block),
    'block and assembled output diverged — the refactor changed the prompt');
check('block still carries the FORMAT spec', block.includes('FORMAT:') && block.includes('```json'));
check('block declares every enabled section',
    block.includes('"quests"') && block.includes('"infoBox"') && block.includes('"characters"'));

// ── 2. Compact vs verbose still differ (the setting still reaches the text) ──
const verbose = pb.buildTrackerPromptBlock(CTX_NAME, false);
check('compact and verbose blocks differ', block !== verbose);
check('verbose keeps the long header', verbose.startsWith('At the start of every reply'));
check('compact keeps the short header', block.startsWith('Start every reply'));

// ── 3. Disabled sections drop out of the spec ──
extensionSettings.showQuests = false;
const noQuests = pb.buildTrackerPromptBlock(CTX_NAME, true);
check('disabling quests removes it from the spec', !noQuests.includes('"quests"'));
check('...without disturbing the other sections',
    noQuests.includes('"infoBox"') && noQuests.includes('"characters"'));
resetSettings();

// ── 4. A saved override replaces the block verbatim ──
extensionSettings.customTrackerPrompt = 'MY OWN PROMPT for {userName} with "location": "x"';
const overridden = pb.generateTrackerInstructions(false, false);
check('override text is sent', overridden.includes('MY OWN PROMPT'));
check('override substitutes {userName}', !overridden.includes('{userName}'));
check('override suppresses the generated FORMAT spec', !overridden.includes('FORMAT:'));

// ── 5. getAssembledTrackerPrompt reflects override vs generated ──
check('editor prefill shows the override when set',
    pb.getAssembledTrackerPrompt().includes('MY OWN PROMPT'));
check('generatedOnly ignores the override (Restore Default)',
    !pb.getAssembledTrackerPrompt({ generatedOnly: true }).includes('MY OWN PROMPT'));
extensionSettings.customTrackerPrompt = '';
check('editor prefill falls back to the generated block',
    pb.getAssembledTrackerPrompt().includes('FORMAT:'));

// ── 6. Key warnings fire for keys the panels need ──
resetSettings();
const good = pb.getTrackerPromptKeyWarnings(pb.getAssembledTrackerPrompt());
check('generated prompt raises no key warnings', good.length === 0,
    good.map(w => w.key).join(', '));
const stripped = pb.getTrackerPromptKeyWarnings('nothing useful here');
const keys = stripped.map(w => w.key);
check('missing top-level sections are reported',
    keys.includes('quests') && keys.includes('infoBox') && keys.includes('characters'));
check('missing scene fields are reported', keys.includes('location'));
const renamed = pb.getTrackerPromptKeyWarnings(
    pb.getAssembledTrackerPrompt().replace(/"location"\s*:/, '"place":'));
check('renaming a key is reported',
    renamed.some(w => w.key === 'location'));
check('...and only that key', renamed.length === 1, renamed.map(w => w.key).join(', '));

// ── 7. Doom Counter's key is only required when it's enabled ──
extensionSettings.doomCounter = { enabled: true };
check('doomTension warned about when the Doom Counter is on',
    pb.getTrackerPromptKeyWarnings('"quests":"" "infoBox":"" "characters":"" "name":"" "location":"" "time":"" "date":""')
        .some(w => w.key === 'doomTension'));
extensionSettings.doomCounter = { enabled: false };
check('...and not when it is off',
    !pb.getTrackerPromptKeyWarnings('"quests":"" "infoBox":"" "characters":"" "name":"" "location":"" "time":"" "date":""')
        .some(w => w.key === 'doomTension'));

// ── 8. Field types (P2) ──
// The whole point of the type system is that it must be INVISIBLE to anyone
// who never uses it: an untyped/'text' field has to emit exactly what it did
// before typing existed.
resetSettings();
const jh = await import(`${DES}/src/systems/generation/jsonPromptHelpers.js`);
const spec = (f, compact = true) => jh.buildFieldSpec(f, compact);

check('untyped field emits the historical quoted description',
    spec({ description: 'Ambient noise' }) === '"Ambient noise"');
check('explicit text type is identical to untyped',
    spec({ type: 'text', description: 'Ambient noise' }) === '"Ambient noise"');
check('number without a range', spec({ type: 'number', description: 'Coins' }) === '<number: Coins>');
check('number with a range',
    spec({ type: 'number', description: 'Morale', min: 1, max: 10 }) === '<number 1-10: Morale>');
check('progress is a 0-100 number',
    spec({ type: 'progress', description: 'Fuel' }) === '<number 0-100: Fuel>');
check('boolean', spec({ type: 'boolean', description: 'Raining?' }) === '<true|false: Raining?>');
check('list', spec({ type: 'list', description: 'Items carried' }) === '["Items carried"]');
check('enum compact uses pipes',
    spec({ type: 'enum', description: 'Alert', options: ['Low', 'High'] }, true) === '"Low|High"');
check('enum verbose spells out the choices',
    spec({ type: 'enum', description: 'Alert', options: ['Low', 'High'] }, false)
        === '"Alert (choose one: Low / High)"');
check('enum with no options degrades to text',
    spec({ type: 'enum', description: 'Alert', options: [] }) === '"Alert"');
check('an unknown type degrades to text',
    spec({ type: 'bogus', description: 'Alert' }) === '"Alert"');
check('descriptions are escaped for JSON',
    spec({ description: 'He said "hi"' }) === '"He said \\"hi\\""');

// A typed custom scene field reaches the actual prompt.
extensionSettings.trackerConfig.infoBox.customFields = [
    { id: 'c1', name: 'Alert Level', enabled: true, description: 'Threat level',
      type: 'enum', options: ['Green', 'Red'] },
];
const withCustom = pb.buildTrackerPromptBlock(CTX_NAME, true);
check('typed custom scene field appears in the spec with its type',
    withCustom.includes('"alert_level": "Green|Red"'),
    withCustom.split('\n').filter(l => l.includes('alert_level')).join(' | '));
extensionSettings.trackerConfig.infoBox.customFields = [];

// ── 9. Per-field wording for descriptive built-ins (P2) ──
extensionSettings.trackerConfig.infoBox.widgets.terrain = { enabled: true, persistInHistory: false };
const shipped = pb.buildTrackerPromptBlock(CTX_NAME, true);
check('a descriptive built-in uses its shipped wording by default',
    shipped.includes('"terrain": "Terrain/environment type'));
extensionSettings.trackerConfig.infoBox.widgets.terrain.prompt = 'One word for the ground underfoot';
const reworded = pb.buildTrackerPromptBlock(CTX_NAME, true);
check('a reworded built-in sends the user text',
    reworded.includes('"terrain": "One word for the ground underfoot"'));
check('...and drops the shipped wording', !reworded.includes('Terrain/environment type'));
extensionSettings.trackerConfig.infoBox.widgets.terrain.prompt = '';
check('clearing the wording restores the shipped text',
    pb.buildTrackerPromptBlock(CTX_NAME, true).includes('"terrain": "Terrain/environment type'));
delete extensionSettings.trackerConfig.infoBox.widgets.terrain;

// ── 10. Characters block: every consumer's field is requested ──
// Each of these has a live consumer, so a silent drop breaks a visible
// feature: color drives chat-bubble speaker attribution, details.appearance
// feeds auto-portrait prompts and the card back-face, relationship draws the
// badge, stats draw the back-face bars.
resetSettings();
extensionSettings.enableDialogueColoring = true;
extensionSettings.trackerConfig.presentCharacters.customFields = [
    { id: 'appearance', name: 'Appearance', enabled: true, description: 'Looks' },
];
extensionSettings.trackerConfig.presentCharacters.relationships = { enabled: true };
extensionSettings.trackerConfig.presentCharacters.relationshipFields = ['Lover', 'Enemy'];
extensionSettings.trackerConfig.presentCharacters.characterStats = {
    enabled: true, customStats: [{ name: 'Trust', enabled: true }],
};
const chars = jh.buildCharactersJSONInstruction();
check('characters asks for name', chars.includes('"name"'));
check('characters asks for emoji', chars.includes('"emoji"'));
check('characters asks for color (bubble attribution depends on it)', chars.includes('"color"'));
check('characters asks for thoughts', chars.includes('"thoughts"'));
check('characters asks for details (auto-portraits + back-face)', chars.includes('"details"'));
check('...including the configured custom field', chars.includes('"appearance"'));
check('characters asks for relationship (card badge)', chars.includes('"relationship"'));
check('...with the configured options', chars.includes('Lover/Enemy'));
check('characters asks for stats when enabled', chars.includes('"stats"'));

// Relationship options come from the Workshop settings section, which writes
// relationshipFields — an empty list must not emit a broken "choose one: ".
extensionSettings.trackerConfig.presentCharacters.relationships = { enabled: false };
check('relationship omitted when tracking is turned off',
    !jh.buildCharactersJSONInstruction().includes('"relationship"'));
extensionSettings.trackerConfig.presentCharacters.relationships = { enabled: true };

extensionSettings.enableDialogueColoring = false;
check('color is omitted only when dialogue colouring is off',
    !jh.buildCharactersJSONInstruction().includes('"color"'));
extensionSettings.enableDialogueColoring = true;
resetSettings();

// ── 11. Relationship wording override (Settings → Workshop → Wording) ──
// Without a wording the emitted spec must stay byte-identical to the version
// that shipped before the box existed — otherwise every existing setup takes
// a silent prompt change on upgrade.
resetSettings();
const relCfg = extensionSettings.trackerConfig.presentCharacters;
relCfg.relationships = { enabled: true };
relCfg.relationshipFields = ['Lover', 'Enemy'];
check('no wording set emits the historical spec byte-for-byte',
    jh.buildRelationshipSpec(relCfg) === '(choose one: Lover/Enemy)');
check('...and an empty-string wording is treated the same as unset',
    (relCfg.relationships.prompt = '', jh.buildRelationshipSpec(relCfg)) === '(choose one: Lover/Enemy)');
check('...as is a whitespace-only wording',
    (relCfg.relationships.prompt = '   ', jh.buildRelationshipSpec(relCfg)) === '(choose one: Lover/Enemy)');

relCfg.relationships.prompt = 'feeling toward {{user}}';
check('wording is prefixed ahead of the options',
    jh.buildRelationshipSpec(relCfg) === 'feeling toward {{user}} (choose one: Lover/Enemy)');
check('...and reaches the assembled characters block',
    jh.buildCharactersJSONInstruction().includes('feeling toward {{user}} (choose one: Lover/Enemy)'));

// The wording lands inside a JSON string in the spec, so a stray quote or
// backslash would otherwise break the shape the model is asked to copy.
relCfg.relationships.prompt = 'how they "feel" about C:\\Users';
const escaped = jh.buildRelationshipSpec(relCfg);
check('quotes in the wording are escaped', escaped.includes('\\"feel\\"'));
check('backslashes in the wording are escaped', escaped.includes('C:\\\\Users'));
check('escaped wording keeps the JSON block parseable', (() => {
    const block = jh.buildCharactersJSONInstruction();
    const m = block.match(/"relationship": \{"status": "(.*)"\}/);
    return !!m && JSON.parse(`{"status": "${m[1]}"}`).status.includes('"feel"');
})());

// Custom relationship names must reach the model, not just the built-ins.
relCfg.relationships.prompt = '';
relCfg.relationshipFields = ['Sworn Rival', 'Reluctant Ally', 'Blood Debt'];
check('custom relationship names are offered to the model',
    jh.buildRelationshipSpec(relCfg) === '(choose one: Sworn Rival/Reluctant Ally/Blood Debt)');
resetSettings();

// ── 11. Vitals (Project Short Fuse) ──
// Off by default, and off must mean INVISIBLE: with vitals off the block
// carries no stats array, no player key and no guidance, and switching them
// off again after use gives back the same bytes.
resetSettings();
const { committedTrackerData } = await import(`${DES}/src/core/state.js`);
const vitalsCfg = () => extensionSettings.trackerConfig.presentCharacters.characterStats;
const setVitals = (patch) => { extensionSettings.trackerConfig.presentCharacters.characterStats = { ...vitalsCfg(), ...patch }; };
setVitals({ enabled: false });
const baseline = pb.buildTrackerPromptBlock(CTX_NAME, true);
check('vitals off: no stats array in the characters spec', !baseline.includes('"stats"'));
check('vitals off: no player key, no guidance', !baseline.includes('"player"') && !baseline.includes('VITALS'));
check('vitals off: the example is unchanged by the sheet', (() => {
    committedTrackerData.characterThoughts = JSON.stringify({ characters: [{ name: 'Mara', stats: [{ name: 'Health', value: 72 }] }] });
    const ex = pb.generateTrackerExample();
    committedTrackerData.characterThoughts = null;
    return ex.includes('"value": 72') && !ex.includes('"locked"');
})());

setVitals({ enabled: true, customStats: [
    { id: 'health', name: 'Health', enabled: true, ai: true },
    { id: 'energy', name: 'Energy', enabled: true, ai: false },
    { id: 'mana', name: 'Mana', enabled: false, ai: true },
], player: { enabled: true } });
const withVitals = pb.buildTrackerPromptBlock(CTX_NAME, true);
check('vitals on: the characters spec carries the stats array',
    withVitals.includes('"stats": [') && withVitals.includes('{"name": "Health", "value": X}'));
check('vitals on: a switched-off vital is not asked for', !withVitals.includes('"Mana"'));
check('vitals on: the player key follows characters, with the same stats shape',
    /"characters": \[[\s\S]*\n  \],\n  "player": \{\n    "stats": \[\n      \{"name": "Health", "value": X\},\n      \{"name": "Energy", "value": X\}\n    \]\n  \}\n\}\n```/.test(withVitals),
    withVitals.slice(withVitals.indexOf('"player"') - 10, withVitals.indexOf('"player"') + 160));
check('vitals on: guidance names the player',
    withVitals.includes('VITALS:') && withVitals.includes(`"player" is ${CTX_NAME}'s`));
check('vitals on: verbose differs but carries the same keys', (() => {
    const v = pb.buildTrackerPromptBlock(CTX_NAME, false);
    return v !== withVitals && v.includes('"player"') && v.includes('VITALS:');
})());
check('vitals on: assembly still embeds the block verbatim',
    pb.generateTrackerInstructions(false, false).includes(withVitals));
const warnedVitals = pb.getTrackerPromptKeyWarnings('"quests":"" "infoBox":"" "characters":"" "name":"" "location":"" "time":"" "date":""');
check('vitals on: missing stats and player keys are warned about',
    warnedVitals.some(w => w.key === 'stats') && warnedVitals.some(w => w.key === 'player'));
check('vitals on: the generated prompt raises no warnings',
    pb.getTrackerPromptKeyWarnings(pb.getAssembledTrackerPrompt()).length === 0,
    pb.getTrackerPromptKeyWarnings(pb.getAssembledTrackerPrompt()).map(w => w.key).join(', '));

setVitals({ player: { enabled: false } });
const noPlayer = pb.buildTrackerPromptBlock(CTX_NAME, true);
check('player off: stats stay, player key goes', noPlayer.includes('"stats": [') && !noPlayer.includes('"player"'));
check('player off: characters is again the last section (no trailing comma)', /\]\n\}\n```/.test(noPlayer));
check('player off: guidance drops the player sentence', !noPlayer.includes('own vitals'));

setVitals({ player: { enabled: true } });
extensionSettings.showCharacterThoughts = false;
const onlyPlayer = pb.buildTrackerPromptBlock(CTX_NAME, true);
check('characters tracker off: the player block is still asked for',
    onlyPlayer.includes('"player": {') && !onlyPlayer.includes('"characters": '));
extensionSettings.showQuests = false;
extensionSettings.showInfoBox = false;
check('only the player on: instructions are still emitted',
    pb.generateTrackerInstructions(false, false).includes('"player"'));
resetSettings();

// Fixed vitals are shown as locked in the previous-tracker example, on
// characters and on the player, and free ones are not.
committedTrackerData.characterThoughts = JSON.stringify({ characters: [
    { name: 'Mara', emoji: '🗡️', stats: [{ name: 'Health', value: 72 }, { name: 'Energy', value: 50 }] },
] });
committedTrackerData.player = JSON.stringify({ stats: [{ name: 'Health', value: 91 }, { name: 'Energy', value: 40 }] });
const example = pb.generateTrackerExample();
check('example: the fixed vital carries locked on the character',
    /"name": "Energy",\s*"value": 50,\s*"locked": true/.test(example), example);
check('example: the free vital does not', !/"name": "Health",\s*"value": 72,\s*"locked"/.test(example));
check('example: the player block is echoed with its lock',
    example.includes('"player"') && /"name": "Energy",\s*"value": 40,\s*"locked": true/.test(example));
check('example: still one JSON object', (() => { try { JSON.parse(example); return true; } catch (e) { return false; } })(), example);
committedTrackerData.characterThoughts = null;
committedTrackerData.player = null;

setVitals({ enabled: false });
check('vitals off again: the block is back to the baseline byte for byte',
    pb.buildTrackerPromptBlock(CTX_NAME, true) === baseline);
resetSettings();

// ── 12. Attributes (Project Short Fuse, Phase 2) ──
// One read-only line outside the tracker JSON, gated three ways: the master
// switch, a sheet worth sending, and the "when" setting.
resetSettings();
extensionSettings.attributes = { ...extensionSettings.attributes, enabled: false };
const attrBaseline = pb.generateTrackerInstructions(false, false);
check('attributes off: no ATTRIBUTES line', !attrBaseline.includes('ATTRIBUTES'));
extensionSettings.attributes = { ...extensionSettings.attributes, enabled: true, sendToAI: 'always' };
extensionSettings.characterAttributes = {};
check('attributes on, every sheet default: still no line', !pb.generateTrackerInstructions(false, false).includes('ATTRIBUTES'));
extensionSettings.characterAttributes = { [`user:${CTX_NAME}`]: { str: 15 }, 'npc:Mara': { dex: 16 }, 'npc:Orin': {} };
committedTrackerData.characterThoughts = JSON.stringify([{ name: 'Mara' }, { name: 'Orin' }]);
const withAttrs = pb.generateTrackerInstructions(false, false);
check('always: the line names the persona and the NPCs with non-default sheets',
    withAttrs.includes('ATTRIBUTES (D&D scale') && withAttrs.includes(`${CTX_NAME} (player): STR 15 (+2)`) && withAttrs.includes('Mara: DEX 16 (+3)') && !withAttrs.includes('Orin'), withAttrs);
check('always: the line sits after the tracker block and before the continuation', (() => {
    const full = pb.generateTrackerInstructions(false, true);
    return full.indexOf('ATTRIBUTES') > full.indexOf('ONE unified JSON object only') && full.indexOf('ATTRIBUTES') < full.indexOf('Then continue the story');
})());
check('always: the separate-mode context carries the same line', pb.generateContextualSummary().includes('Mara: DEX 16 (+3)'));
extensionSettings.attributes = { ...extensionSettings.attributes, sendToAI: 'withRoll' };
check('with a roll only: no roll in the chat, no line', !pb.generateTrackerInstructions(false, false).includes('ATTRIBUTES'));
extensionSettings.attributes = { ...extensionSettings.attributes, sendToAI: 'never' };
check('never: no line', !pb.generateTrackerInstructions(false, false).includes('ATTRIBUTES'));
extensionSettings.attributes = { ...extensionSettings.attributes, sendToAI: 'always' };
extensionSettings.showQuests = false; extensionSettings.showInfoBox = false; extensionSettings.showCharacterThoughts = false;
check('no tracker on at all: the line is still sent', pb.generateTrackerInstructions(false, false).includes('ATTRIBUTES'));
resetSettings();
committedTrackerData.characterThoughts = null;
extensionSettings.characterAttributes = {};
extensionSettings.attributes = { ...extensionSettings.attributes, enabled: false, sendToAI: 'withRoll' };
check('attributes off again: instructions back to the baseline byte for byte', pb.generateTrackerInstructions(false, false) === attrBaseline);
resetSettings();

console.log(failures === 0 ? '\nAll tracker-prompt fixtures pass' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
