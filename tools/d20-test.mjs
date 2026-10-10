#!/usr/bin/env node
/**
 * d20 test (Project Short Fuse, Phase 2): the pure attributes-and-dice
 * model in src/utils/d20.js. No sandbox needed; the module imports nothing.
 *
 * Usage:  node tools/d20-test.mjs     (from the repo root)
 * Exit:   0 = pass, 1 = failure
 */
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const D = await import(pathToFileURL(join(here, '..', 'src', 'utils', 'd20.js')).href);

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
check('findSkill finds a skill under any attribute, any case, and names its home', (() => { const a = D.findSkill(sdefs, 'athletics'); const b = D.findSkill(sdefs, 'Sleight of Hand'); return a && a.attributeId === 'str' && a.name === 'Athletics' && b && b.attributeId === 'dex' && D.findSkill(sdefs, 'Flying') === null && D.findSkill(sdefs, '') === null; })());
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

// ── 7. The game master's own calls ──
check('notify defaults on and a false survives', D.attributesConfig(settings).notify === true && D.attributesConfig({ attributes: { notify: false } }).notify === false);
check('aiCalls defaults: on, both ways, NPCs too, sparingly', (() => { const c = D.attributesConfig(settings).aiCalls; return c.enabled && c.endOfReply && c.tool && c.npcs && c.frequency === 'sparingly'; })());
check('aiCalls migration fills a missing block and a missing key', (() => {
    const s1 = { attributes: { enabled: true, list: [{ name: 'Strength' }] } };
    D.migrateAttributesConfig(s1);
    const s2 = { attributes: { enabled: true, list: [{ name: 'Strength' }], aiCalls: { enabled: false } } };
    const changed = D.migrateAttributesConfig(s2);
    return s1.attributes.aiCalls.enabled === true && changed && s2.attributes.aiCalls.enabled === false && s2.attributes.aiCalls.tool === true;
})());
check('normalizeAiCalls tolerates garbage', D.normalizeAiCalls({ frequency: 'always', npcs: 'no' }).frequency === 'sparingly' && D.normalizeAiCalls({ npcs: false }).npcs === false && D.normalizeAiCalls(null).enabled === true);
settings.attributes.difficulty.hard = 20;
let call = D.parseCheckCall('The guards turn the corner.\n\n[CHECK: Dexterity (Stealth) | Hard, disadvantage | because the lamps are lit]', settings);
check('a call at the end of a reply: attribute, skill, difficulty, advantage, reason', call && call.who === '' && call.attributeId === 'dex' && call.skill === 'Stealth' && call.skillAttributeId === 'dex' && call.difficultyId === 'hard' && call.dc === 20 && call.advantage === 'dis' && call.reason === 'the lamps are lit' && call.difficultySource === 'ai' && call.raw.startsWith('[CHECK:'), JSON.stringify(call));
call = D.parseCheckCall('[CHECK: Guard: Wisdom (Perception) | Medium | the corridor is dark]', settings);
check('a named roller is an NPC check', call && call.who === 'Guard' && call.attributeId === 'wis' && call.skill === 'Perception' && call.difficultyId === 'medium');
call = D.parseCheckCall('[CHECK: STR | very hard]', settings);
check('short form, no skill, no reason, "very hard" not "hard"', call && call.attributeId === 'str' && call.skill === '' && call.difficultyId === 'veryHard' && call.reason === '');
call = D.parseCheckCall('[CHECK: Constitution (Athletics) | Easy | a long swim]', settings);
check('a borrowed skill keeps its home', call && call.attributeId === 'con' && call.skill === 'Athletics' && call.skillAttributeId === 'str');
call = D.parseCheckCall('[CHECK: Stealth | Hard]', settings);
check('a skill alone means its home attribute', call && call.attributeId === 'dex' && call.skill === 'Stealth');
call = D.parseCheckCall('[CHECK: Dexterity: Stealth | Hard]', settings);
check('"Attribute: Skill" is read as attribute and skill, not a roller', call && call.who === '' && call.attributeId === 'dex' && call.skill === 'Stealth');
call = D.parseCheckCall('[CHECK: Charisma (Persuasion)]', settings);
check('no difficulty falls back to the default and says so', call && call.difficultyId === 'medium' && call.difficultySource === 'default');
check('an unknown attribute is no call; no tag is no call', D.parseCheckCall('[CHECK: Luck | Hard]', settings) === null && D.parseCheckCall('No tag here.', settings) === null);
check('the last tag wins', D.parseCheckCall('[CHECK: STR | Easy] ... [CHECK: DEX | Hard]', settings).attributeId === 'dex');
check('stripCheckCalls removes the tag and tidies the end', D.stripCheckCalls('She nods.\n\n[CHECK: Dexterity (Stealth) | Hard | x]\n') === 'She nods.' && D.stripCheckCalls('a\n\n\n\n[CHECK: STR | Easy]\n\nb') === 'a\n\nb');
check('resolveCheckCall from tool arguments', (() => { const r = D.resolveCheckCall({ who: 'Mara', attribute: 'Wisdom', skill: 'insight', difficulty: 'Nearly impossible', advantage: 'advantage', reason: 'because she is lying well' }, settings); return r && r.who === 'Mara' && r.attributeId === 'wis' && r.skill === 'Insight' && r.difficultyId === 'nearlyImpossible' && r.advantage === 'adv' && r.reason === 'she is lying well'; })());
const inst = D.buildCheckCallInstruction({ settings, userName: 'Jordan' });
check('the end-of-reply instruction names the sheet, the form, the words, the NPC form and the restraint',
    inst.startsWith('[CHECKS: The game rolls the dice; you never do. Jordan\'s attributes and skills: STR Strength (Athletics); DEX Dexterity (Acrobatics, Sleight of Hand, Stealth); CON Constitution;') && inst.includes('[CHECK: Dexterity (Stealth) | Hard | the guards are alert]') && inst.includes('Easy, Medium, Hard, Very hard, Nearly impossible') && inst.includes('[CHECK: Guard: Wisdom (Perception)') && inst.includes('most replies have none') && inst.includes('only when the stakes are real'), inst);
settings.attributes.aiCalls.npcs = false;
settings.attributes.aiCalls.frequency = 'whenUncertain';
check('...without NPCs and with the looser frequency', !D.buildCheckCallInstruction({ settings }).includes('Guard:') && D.buildCheckCallInstruction({ settings }).includes('whenever an attempt could plausibly fail'));
settings.attributes.aiCalls.npcs = true;
settings.attributes.aiCalls.frequency = 'sparingly';
const toolInst = D.buildToolCallInstruction({ settings, userName: 'Jordan' });
check('the tool instruction names the tool and the restraint', toolInst.includes('call the dooms_roll_check tool') && toolInst.includes('who is rolling when it is not the player') && toolInst.includes('most replies have none'));
const tool = D.buildDiceToolDefinition({ settings, userName: 'Jordan' });
check('the tool definition: enums from the sheet, who only with NPCs on',
    tool.name === 'dooms_roll_check' && tool.parameters.properties.attribute.enum.join() === 'Strength,Dexterity,Constitution,Intelligence,Wisdom,Charisma' && tool.parameters.properties.difficulty.enum.length === 5 && tool.parameters.required.join() === 'attribute,difficulty,reason' && !!tool.parameters.properties.who && tool.parameters.properties.skill.description.includes('Stealth (DEX)'));
settings.attributes.aiCalls.npcs = false;
check('...no who parameter without NPCs', D.buildDiceToolDefinition({ settings }).parameters.properties.who === undefined);
settings.attributes.aiCalls.npcs = true;

console.log(failures === 0 ? '\nAll d20 checks pass' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
