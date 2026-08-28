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

// ── 10. Characters block: only the fields still in use are requested ──
// The Present Characters tab was removed and details/relationship/stats are
// no longer asked for. These pin BOTH halves: the four fields that must stay
// (each has a live consumer) and the three that must not come back by
// accident, since every one costs tokens on every single generation.
resetSettings();
extensionSettings.enableDialogueColoring = true;
const chars = jh.buildCharactersJSONInstruction();
check('characters still asks for name', chars.includes('"name"'));
check('characters still asks for emoji', chars.includes('"emoji"'));
check('characters still asks for color (bubble attribution depends on it)',
    chars.includes('"color"'));
check('characters still asks for thoughts', chars.includes('"thoughts"'));
check('characters no longer asks for details', !chars.includes('"details"'));
check('characters no longer asks for relationship', !chars.includes('"relationship"'));
check('characters no longer asks for stats', !chars.includes('"stats"'));
// Custom character fields must not resurrect the details block either.
extensionSettings.trackerConfig.presentCharacters.customFields = [
    { id: 'appearance', name: 'Appearance', enabled: true, description: 'Looks' },
];
check('a configured custom character field stays out of the prompt',
    !jh.buildCharactersJSONInstruction().includes('"details"'));
extensionSettings.trackerConfig.presentCharacters.customFields = [];
// Colour is load-bearing: dropping dialogue colouring is the only thing that
// should remove it.
extensionSettings.enableDialogueColoring = false;
check('color is omitted only when dialogue colouring is off',
    !jh.buildCharactersJSONInstruction().includes('"color"'));
extensionSettings.enableDialogueColoring = true;

console.log(failures === 0 ? '\nAll tracker-prompt fixtures pass' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
