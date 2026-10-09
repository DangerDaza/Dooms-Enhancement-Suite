#!/usr/bin/env node
/**
 * d20 test (Project Short Fuse, Phase 2): the pure attributes-and-dice
 * model in src/utils/d20.js. No sandbox needed; the module imports nothing.
 *
 * Usage:  node tools/d20-test.mjs     (from the repo root)
 * Exit:   0 = pass, 1 = failure
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const D = await import(join(here, '..', 'src', 'utils', 'd20.js'));

let failures = 0;
const check = (label, cond, extra = '') => {
    if (cond) { console.log(`pass  ${label}`); }
    else { console.error(`FAIL  ${label}${extra ? '\n      ' + extra : ''}`); failures++; }
};
/** A deterministic rng: hands out the given die faces in order (1-based). */
const faces = (...values) => { let i = 0; return (max) => (values[i++ % values.length] - 1) % max; };

// ── 1. Defaults and migration ──
const fresh = D.defaultAttributesConfig();
check('six attributes by default, all on', fresh.list.length === 6 && fresh.list.every(a => a.enabled));
check('off by default; sent only with a roll; criticals on; AI rates; +2 proficiency',
    fresh.enabled === false && fresh.sendToAI === 'withRoll' && fresh.criticals === true && fresh.aiRatesDifficulty === true && fresh.allowOverride === false && fresh.proficiencyBonus === 2 && fresh.rollOnSend === undefined);
check('difficulty table has the five words', Object.keys(fresh.difficulty).length === 5 && fresh.difficulty.nearlyImpossible === 30);
const settings = {};
check('migration fills an empty settings object', D.migrateAttributesConfig(settings) === true && settings.attributes.list.length === 6 && typeof settings.characterAttributes === 'object');
check('...and is a no-op the second time', D.migrateAttributesConfig(settings) === false);
const edited = { attributes: { enabled: true, list: [{ id: 'str', name: 'Strength' }, { name: 'Luck' }] } };
D.migrateAttributesConfig(edited);
check('an edited list is kept and filled in', edited.attributes.list.length === 2 && edited.attributes.list[0].abbr === 'STR' && edited.attributes.list[1].abbr === 'LUC' && edited.attributes.list[1].id === 'luck');
check('attributesConfig tolerates garbage', D.attributesConfig({ attributes: { sendToAI: 'bogus', difficulty: { hard: 'x' } } }).sendToAI === 'withRoll' && D.attributesConfig({ attributes: { difficulty: { hard: 'x' } } }).difficulty.hard === 20);
check('attributesOn needs the switch and one attribute', !D.attributesOn(settings) && D.attributesOn({ attributes: { enabled: true, list: [{ name: 'Strength' }] } }));
check('attributeDefs filters off ones unless all', (() => { const s = { attributes: { enabled: true, list: [{ name: 'Strength' }, { name: 'Luck', enabled: false }] } }; return D.attributeDefs(s).length === 1 && D.attributeDefs(s, { all: true }).length === 2; })());

// ── 2. Scores, modifiers, sheets ──
const modTable = [[1, -5], [3, -4], [8, -1], [9, -1], [10, 0], [11, 0], [12, 1], [15, 2], [20, 5], [30, 10]];
check('modifier table', modTable.every(([s, m]) => D.modifier(s) === m), modTable.map(([s]) => `${s}:${D.modifier(s)}`).join(' '));
check('clampScore', D.clampScore('15') === 15 && D.clampScore(0) === 1 && D.clampScore(99) === 30 && D.clampScore('x') === null);
check('formatModifier', D.formatModifier(2) === '+2' && D.formatModifier(-1) === '-1' && D.formatModifier(0) === '+0');
settings.attributes.enabled = true;
const defs = D.attributeDefs(settings);
check('a character with nothing stored reads as all 10s', D.isDefaultSheet(D.getSheet(settings, 'Mara', false), defs));
D.setSheet(settings, 'Mara', false, { str: 8, dex: 16, con: 10, int: '12', wis: 'x', cha: 10 });
check('setSheet stores only non-10 scores', JSON.stringify(settings.characterAttributes['npc:Mara']) === JSON.stringify({ str: 8, dex: 16, int: 12 }));
check('getSheet is case-insensitive and fills 10s', (() => { const s = D.getSheet(settings, 'mara', false); return s.str === 8 && s.dex === 16 && s.con === 10 && s.cha === 10; })());
check('a persona sheet lives under its own key', (D.setSheet(settings, 'Jordan', true, { str: 15 }), settings.characterAttributes['user:Jordan'].str === 15 && settings.characterAttributes['npc:Jordan'] === undefined));
check('an all-10 sheet removes the entry', (D.setSheet(settings, 'Jordan', true, { str: 10 }), settings.characterAttributes['user:Jordan'] === undefined));
check('deleteSheet', D.deleteSheet(settings, 'MARA', false) === true && D.deleteSheet(settings, 'Mara', false) === false);
check('standard array', D.STANDARD_ARRAY.join() === '15,14,13,12,10,8');

// ── 3. Dice ──
const counts = new Array(21).fill(0);
for (let i = 0; i < 20000; i++) counts[D.rollDie(20)]++;
check('d20 never leaves 1..20', counts[0] === 0 && counts.slice(1).every(c => c > 0));
const minC = Math.min(...counts.slice(1)); const maxC = Math.max(...counts.slice(1));
check('d20 is close to uniform over 20,000 rolls (each face within 15% of 1000)', minC > 850 && maxC < 1150, `min ${minC} max ${maxC}`);
check('4d6 drop lowest stays in 3..18', (() => { for (let i = 0; i < 2000; i++) { const v = D.roll4d6DropLowest(); if (v < 3 || v > 18) return false; } return true; })());
check('4d6 drop lowest keeps the top three', D.roll4d6DropLowest(faces(1, 6, 5, 2)) === 13);

let r = D.rollCheck({ attribute: 'Strength', abbr: 'STR', score: 15, dc: 15, rng: faces(14) });
check('a plain success: 14 + 2 = 16 vs 15, by 1, narrowly', r.success && r.total === 16 && r.margin === 1 && r.critical === null && D.marginWord(r.margin) === 'narrowly');
r = D.rollCheck({ attribute: 'Strength', abbr: 'STR', score: 8, dc: 15, rng: faces(9) });
check('a failure: 9 - 1 = 8 vs 15, by 7, clearly', !r.success && r.total === 8 && r.margin === -7 && D.marginWord(r.margin) === 'clearly');
check('margin words', D.marginWord(0) === 'narrowly' && D.marginWord(2) === 'narrowly' && D.marginWord(3) === 'clearly' && D.marginWord(7) === 'clearly' && D.marginWord(8) === 'decisively');
r = D.rollCheck({ attribute: 'Strength', score: 30, dc: 5, rng: faces(1) });
check('a natural 1 fails even with +10 against DC 5', !r.success && r.critical === 'failure' && r.total === 11);
r = D.rollCheck({ attribute: 'Strength', score: 1, dc: 30, rng: faces(20) });
check('a natural 20 succeeds even with -5 against DC 30', r.success && r.critical === 'success');
r = D.rollCheck({ attribute: 'Strength', score: 1, dc: 30, criticals: false, rng: faces(20) });
check('criticals off: a 20 is just a 20', !r.success && r.critical === null);
r = D.rollCheck({ attribute: 'Dexterity', abbr: 'DEX', score: 10, dc: 15, advantage: 'adv', rng: faces(3, 17) });
check('advantage keeps the higher of two', r.kept === 17 && r.dropped === 3 && r.rolls.join() === '3,17' && r.success);
r = D.rollCheck({ attribute: 'Dexterity', abbr: 'DEX', score: 10, dc: 15, advantage: 'dis', rng: faces(3, 17) });
check('disadvantage keeps the lower', r.kept === 3 && r.dropped === 17 && !r.success);
check('a bad advantage value means none', D.rollCheck({ attribute: 'x', score: 10, dc: 10, advantage: 'wat', rng: faces(10) }).advantage === 'none');

// ── 4. Text ──
r = D.rollCheck({ attribute: 'Strength', abbr: 'STR', score: 15, dc: 15, rng: faces(14) });
let v = D.verdictText(r, { userName: 'Jordan', attempt: 'climb the wall', difficultyLabel: 'Medium', reason: 'the wall is slick with rain.' });
check('verdict names who, what, the die, the modifier, the DC and the outcome',
    v.startsWith('[DICE: Jordan attempts "climb the wall". Strength check: d20 = 14, +2 (STR 15) = 16 vs DC 15 (Medium), because the wall is slick with rain. SUCCESS, narrowly (by 1).'), v);
check('verdict says it is final', v.includes('This outcome is final: narrate the attempt succeeding, with that margin in mind. Do not re-roll, reverse or soften it.]'));
v = D.verdictText(D.rollCheck({ attribute: 'Charisma', abbr: 'CHA', score: 8, dc: 20, rng: faces(1) }), { userName: 'Jordan' });
check('a critical failure reads as one', v.includes('NATURAL 1, a critical failure') && v.includes('worse than a plain miss') && v.includes('the action in their last message'));
v = D.verdictText(D.rollCheck({ attribute: 'Dexterity', abbr: 'DEX', score: 12, dc: 15, advantage: 'adv', rng: faces(4, 19) }), { userName: 'Jordan' });
check('advantage is spelled out', v.includes('d20 = 19 (rolled 4 and 19; advantage keeps the higher)'));
check('short form for the card', D.formatRollShort(r) === 'Strength check · d20 14 +2 = 16 vs DC 15 · Success', D.formatRollShort(r));
check('short form with advantage and a critical', D.formatRollShort(D.rollCheck({ attribute: 'Dexterity', score: 10, dc: 10, advantage: 'adv', rng: faces(20, 2) })) === 'Dexterity check · d20 20 (20/2) +0 = 20 vs DC 10 · Critical success');

const line = D.buildAttributesLine([
    { name: 'Jordan', isUser: true, sheet: { str: 15, dex: 12, con: 10, int: 8, wis: 10, cha: 14 } },
    { name: 'Orin', isUser: false, sheet: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 } },
    { name: 'Mara', isUser: false, sheet: { str: 8, dex: 16, con: 10, int: 10, wis: 10, cha: 10 } },
], defs);
check('attributes line lists non-default scores with modifiers and skips default sheets',
    line === 'ATTRIBUTES (D&D scale, 10 is average, bonus = (score - 10) / 2; read-only, never output them): Jordan (player): STR 15 (+2), DEX 12 (+1), INT 8 (-1), CHA 14 (+2). Mara: STR 8 (-1), DEX 16 (+3).', line);
check('attributes line is empty when every sheet is default', D.buildAttributesLine([{ name: 'Orin', isUser: false, sheet: { str: 10 } }], defs) === '');

const p = D.buildDifficultyRatingPrompt({ userName: 'Jordan', attempt: 'talk the guard down', attributeName: 'Charisma', recentText: 'Guard: Halt!' });
check('rating prompt asks for one JSON line with the five words', p.system.includes('"difficulty": "<easy|medium|hard|very hard|nearly impossible>"') && p.user.includes('"talk the guard down", using Charisma'));
let rated = D.parseDifficultyRating('{"difficulty": "hard", "advantage": "none", "reason": "He already distrusts you."}', settings);
check('rating: JSON line', rated && rated.difficultyId === 'hard' && rated.dc === 20 && rated.advantage === 'none' && rated.reason === 'He already distrusts you.');
rated = D.parseDifficultyRating('Sure! ```json\n{"difficulty": "Very Hard", "advantage": "disadvantage", "reason": "x"}\n```', settings);
check('rating: fenced JSON, case, "very hard"', rated && rated.difficultyId === 'veryHard' && rated.dc === 25 && rated.advantage === 'dis');
rated = D.parseDifficultyRating('I would call this nearly impossible, and they have advantage from the height.', settings);
check('rating: prose, longest phrase wins, advantage read', rated && rated.difficultyId === 'nearlyImpossible' && rated.advantage === 'adv');
check('rating: prose "very hard" is not "hard"', D.parseDifficultyRating('This is very hard.', settings).difficultyId === 'veryHard');
check('rating: nothing readable gives null', D.parseDifficultyRating('Okay.', settings) === null && D.parseDifficultyRating('', settings) === null);
settings.attributes.difficulty.hard = 18;
check('rating uses the configured DC', D.parseDifficultyRating('hard', settings).dc === 18 && D.difficultyById(settings, 'hard').dc === 18);
check('difficultyById falls back to the default difficulty', D.difficultyById(settings, 'bogus').id === 'medium');

// ── 6. Skills and proficiency ──
check('presets carry the 5e skills; Constitution has none', fresh.list.find(a => a.id === 'dex').skills.join() === 'Acrobatics,Sleight of Hand,Stealth' && fresh.list.find(a => a.id === 'con').skills.length === 0);
check('the default list holds its own skill arrays, not the frozen presets', !Object.isFrozen(fresh.list[0].skills));
check('migration adds skills to a preset entry and none to a custom one', edited.attributes.list[0].skills.join() === 'Athletics' && Array.isArray(edited.attributes.list[1].skills) && edited.attributes.list[1].skills.length === 0);
check('normalizeAttributeDef cleans a skill list', D.normalizeAttributeDef({ id: 'str', skills: [' Athletics ', 'athletics', 'Climbing', '', 42] }).skills.join() === 'Athletics,Climbing,42');
check('skillKey', D.skillKey('dex', 'Sleight of Hand') === 'dex:' + D.attributeSlug('Sleight of Hand') && D.skillKey('dex', 'Stealth') === 'dex:stealth');
const sdefs = D.attributeDefs(settings, { all: true });
D.setSheet(settings, 'Mara', false, { dex: 16 }, sdefs, [D.skillKey('dex', 'Stealth'), 'bogus', D.skillKey('dex', 'Stealth')]);
check('setSheet stores proficiencies once, sorted, beside the scores', JSON.stringify(settings.characterAttributes['npc:Mara']) === JSON.stringify({ dex: 16, _prof: ['dex:stealth'] }), JSON.stringify(settings.characterAttributes['npc:Mara']));
check('getProficiencies and isProficient', D.getProficiencies(settings, 'mara', false).join() === 'dex:stealth' && D.isProficient(D.getProficiencies(settings, 'Mara', false), 'dex', 'Stealth') && !D.isProficient(D.getProficiencies(settings, 'Mara', false), 'dex', 'Acrobatics'));
D.setSheet(settings, 'Mara', false, { dex: 14 }, sdefs);
check('setSheet without proficiencies keeps them', settings.characterAttributes['npc:Mara'].dex === 14 && settings.characterAttributes['npc:Mara']._prof.join() === 'dex:stealth');
check('getSheet never leaks the proficiency key', D.getSheet(settings, 'Mara', false, sdefs)._prof === undefined);
D.setSheet(settings, 'Mara', false, { dex: 10 }, sdefs);
check('an all-10 sheet with proficiencies keeps its entry', !!settings.characterAttributes['npc:Mara'] && settings.characterAttributes['npc:Mara'].dex === undefined && D.getProficiencies(settings, 'Mara', false).length === 1);
D.setSheet(settings, 'Mara', false, { dex: 10 }, sdefs, []);
check('...and clearing them removes it', settings.characterAttributes['npc:Mara'] === undefined);
check('skillNameForKey and pruneProficiencies', D.skillNameForKey(sdefs, 'dex:stealth') === 'Stealth' && D.skillNameForKey(sdefs, 'dex:flying') === '' && D.pruneProficiencies(['dex:stealth', 'dex:flying', 'luck:x'], sdefs).join() === 'dex:stealth');
check('clampProficiency', D.clampProficiency(3) === 3 && D.clampProficiency(0) === 1 && D.clampProficiency(9) === 6 && D.clampProficiency('x') === 2);
let pr = D.rollCheck({ attribute: 'Strength', abbr: 'STR', skill: 'Athletics', score: 15, dc: 15, proficiency: 2, rng: faces(14) });
check('a proficient skill adds the bonus', pr.total === 18 && pr.prof === 2 && pr.skill === 'Athletics' && pr.success && pr.margin === 3);
check('no proficiency means +0 and no skill', (() => { const q = D.rollCheck({ attribute: 'Wisdom', score: 10, dc: 10, rng: faces(10) }); return q.prof === 0 && q.skill === '' && q.total === 10; })());
let pv = D.verdictText(pr, { userName: 'Jordan', attempt: 'climb', difficultyLabel: 'Medium' });
check('verdict names the skill and the bonus', pv.includes('Strength (Athletics) check: d20 = 14, +2 (STR 15), +2 (proficient in Athletics) = 18 vs DC 15 (Medium)'), pv);
check('short form with a skill and bonus', D.formatRollShort(pr) === 'Strength (Athletics) check · d20 14 +2 +2 = 18 vs DC 15 · Success', D.formatRollShort(pr));
check('checkLabel without a skill is the attribute', D.checkLabel(D.rollCheck({ attribute: 'Wisdom', score: 10, dc: 10, rng: faces(10) })) === 'Wisdom');
const pline = D.buildAttributesLine([
    { name: 'Jordan', isUser: true, sheet: { str: 15 }, proficiencies: ['str:athletics', 'cha:persuasion'] },
    { name: 'Orin', isUser: false, sheet: { str: 10 }, proficiencies: ['dex:stealth'] },
    { name: 'Nobody', isUser: false, sheet: { str: 10 }, proficiencies: ['dex:flying'] },
], sdefs, { proficiencyBonus: 3 });
check('attributes line lists proficiencies, includes a proficiency-only character, skips an empty one',
    pline === 'ATTRIBUTES (D&D scale, 10 is average, bonus = (score - 10) / 2; a proficient skill adds +3; read-only, never output them): Jordan (player): STR 15 (+2); proficient in Athletics, Persuasion (+3). Orin: proficient in Stealth (+3).', pline);
const sp = D.buildDifficultyRatingPrompt({ userName: 'Jordan', attempt: '', attributeName: 'Dexterity', skillName: 'Stealth', messageText: 'I slip past the guards.', recentText: 'x' });
check('rating prompt names the skill and quotes the message', sp.user.includes('"what their message describes", using Dexterity (Stealth).') && sp.user.includes('Their message: "I slip past the guards."'), sp.user);

console.log(failures === 0 ? '\nAll d20 checks pass' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
