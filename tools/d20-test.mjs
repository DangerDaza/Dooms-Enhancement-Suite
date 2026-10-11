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
    tool.name === 'dooms_roll_check' && tool.parameters.properties.attribute.enum.join() === 'Strength,Dexterity,Constitution,Intelligence,Wisdom,Charisma,Casting' && tool.parameters.properties.difficulty.enum.length === 5 && tool.parameters.required.join() === 'attribute,reason' && !!tool.parameters.properties.who && tool.parameters.properties.skill.description.includes('Stealth (DEX)'));
settings.attributes.aiCalls.npcs = false;
check('...no who parameter without NPCs', D.buildDiceToolDefinition({ settings }).parameters.properties.who === undefined);
settings.attributes.aiCalls.npcs = true;

// ── 8. Saving throws and opposed actions (Phase 4a, §10, 2024 rules) ──
check('save keys: "wis:save", recognised, and a skill cannot be called Save',
    D.saveKey('wis') === 'wis:save' && D.isSaveKey('wis:save') && !D.isSaveKey('wis:perception') && !D.isSaveKey('save')
    && D.isSaveProficient(['wis:save', 'dex:stealth'], 'wis') && !D.isSaveProficient(['dex:stealth'], 'wis')
    && D.normalizeSkills(['Save', 'Stealth', ' save ']).join() === 'Stealth');
check('pruneProficiencies keeps a save whose attribute exists and drops one whose attribute is gone',
    D.pruneProficiencies(['wis:save', 'luck:save', 'dex:stealth', 'dex:gone'], defs).join() === 'dex:stealth,wis:save');
check('saveProficiencyDefs lists the attributes in list order', D.saveProficiencyDefs(defs, ['cha:save', 'str:save']).map(d => d.id).join() === 'str,cha');
check('saveDC: 8 + proficiency + modifier (Charisma 30, +2 → 20; a 10 → 10; a +3 bonus → 11)',
    D.saveDC(30, 2) === 20 && D.saveDC(10, 2) === 10 && D.saveDC(10, 3) === 11 && D.SAVE_DC_BASE === 8);
const guide = D.difficultyGuide(settings);
check('the guide carries the configured DCs with the odds for +0 and +5, the one-step rule and who rolls',
    guide.startsWith('DIFFICULTY: judge the task and the circumstances, never the character')
    && guide.includes('Easy (DC 10; a +0 roll makes it 55% of the time, a +5 roll 80%)')
    && guide.includes('Medium (DC 15; a +0 roll makes it 30% of the time, a +5 roll 55%)')
    && guide.includes('Hard (DC 20; a +0 roll makes it 5% of the time, a +5 roll 30%)')
    && guide.includes('Very hard (DC 25; a +0 roll makes it 0% of the time, a +5 roll 5%)')
    && guide.includes('When unsure, Medium.') && guide.includes('never both') && guide.includes('starts at Hard')
    && guide.includes('Who rolls:') && guide.includes('8 + the actor\'s proficiency bonus of 2 + the actor\'s modifier'), guide);
check('...the brief form is shorter and still says who rolls', (() => { const b = D.difficultyGuide(settings, { brief: true }); return b.length < guide.length / 2 && b.includes('Who rolls:') && b.includes('Medium is the usual call'); })());
check('...and follows an edited table', D.difficultyGuide({ attributes: { difficulty: { hard: 28 } } }).includes('Hard (DC 28; a +0 roll makes it 0% of the time, a +5 roll 0%)'));
const saveRoll = D.rollCheck({ attribute: 'Charisma', abbr: 'CHA', score: 10, dc: 20, proficiency: 0, kind: 'save', rng: faces(18) });
check('rollCheck carries the kind; an old record is a check', saveRoll.kind === 'save' && D.isSaveRoll(saveRoll) && D.rollCheck({ attribute: 'Strength', score: 10, dc: 10, rng: faces(5) }).kind === 'check' && !D.isSaveRoll({ attribute: 'Strength' }));
const saveRecord = { ...saveRoll, who: 'Ines Arden', isUser: false, against: { who: 'Muzen', isUser: true, attributeId: 'cha', attribute: 'Charisma', abbr: 'CHA', score: 30, mod: 10, prof: 2 } };
const saveVerdict = D.verdictText(saveRecord, { framing: 'Ines Arden makes a Charisma saving throw against Muzen\'s Charisma', reason: 'the push goes deep', ownership: D.ownershipSentence(saveRecord) });
check('a save verdict: the throw, the DC formula, the failure, and whose roll it is',
    saveVerdict.includes('Charisma saving throw: d20 = 18, +0 (CHA 10) = 18 vs DC 20 (Muzen\'s Charisma: 8 + 2 proficiency +10), because the push goes deep. FAILURE, narrowly (by 2). This roll is Ines Arden\'s: Ines Arden does not resist, and Muzen\'s effect on them takes hold. This outcome is final: narrate the effect taking hold and its consequences.'), saveVerdict);
const saved = { ...saveRecord, ...D.rollCheck({ attribute: 'Charisma', abbr: 'CHA', score: 10, dc: 20, kind: 'save', rng: faces(20) }), who: 'Ines Arden', isUser: false };
check('...a success resists; a natural 20 shrugs it off', D.ownershipSentence(saved) === 'This roll is Ines Arden\'s: Ines Arden resists, and Muzen\'s effect on them fails.' && D.verdictText(saved, { ownership: '' }).includes('NATURAL 20, a critical success. This outcome is final: narrate the effect shrugged off entirely.'));
check('an NPC\'s check says whose roll it is and whose attempt it is not; the player\'s own check says nothing extra',
    D.ownershipSentence({ kind: 'check', who: 'Ines Arden', isUser: false, success: true }, { actorName: 'Muzen' }) === 'This roll is Ines Arden\'s: it decides whether Ines Arden succeeds at what the reason describes, nothing about Muzen\'s own attempt.'
    && D.ownershipSentence({ kind: 'check', who: 'Muzen', isUser: true, success: true }) === '');
check('describeDC falls back to the word for checks', D.describeDC({ kind: 'check', dc: 15 }, 'Medium') === 'DC 15 (Medium)' && D.formatRollShort(saveRecord).startsWith('Charisma save · d20 18'));
check('the attributes line names save proficiencies',
    D.buildAttributesLine([{ name: 'Jordan', isUser: true, sheet: { str: 15 }, proficiencies: ['wis:save', 'cha:save', 'str:athletics'] }], defs, { proficiencyBonus: 2 })
    === 'ATTRIBUTES (D&D scale, 10 is average, bonus = (score - 10) / 2; a proficient skill adds +2; read-only, never output them): Jordan (player): STR 15 (+2); proficient in Athletics (+2); proficient in Wisdom, Charisma saves (+2).');
const rp = D.buildDifficultyRatingPrompt({ userName: 'Muzen', attempt: 'read her mind', attributeName: 'Charisma', settings, targets: ['Ines Arden', 'Silvy'] });
check('the ruling prompt carries the full guide, both answer forms and the names who could resist',
    rp.system.includes('DIFFICULTY: judge the task') && rp.system.includes('"save": {"who": "<their name>"') && rp.system.includes('"difficulty": "<easy|medium|hard|very hard|nearly impossible>"')
    && rp.user.includes('Characters in the scene who could resist: Ines Arden, Silvy.'), rp.user);
const savedAnswer = D.parseDifficultyRating('{"save": {"who": "Ines Arden", "attribute": "Charisma", "against": "Charisma"}, "advantage": "disadvantage", "reason": "She is distracted."}', settings);
check('a save answer is read as one', savedAnswer && savedAnswer.kind === 'save' && savedAnswer.who === 'Ines Arden' && savedAnswer.attribute === 'Charisma' && savedAnswer.against === 'Charisma' && savedAnswer.advantage === 'dis' && savedAnswer.reason === 'She is distracted.');
check('a check answer still reads as a check', D.parseDifficultyRating('{"difficulty": "hard", "advantage": "none", "reason": "x"}', settings).kind === 'check');
check('parseAgainst', JSON.stringify(D.parseAgainst('vs Muzen\'s Charisma')) === '{"who":"Muzen","attribute":"Charisma"}' && JSON.stringify(D.parseAgainst('against the player’s Wisdom')) === '{"who":"the player","attribute":"Wisdom"}' && JSON.stringify(D.parseAgainst('vs Charisma')) === '{"who":"","attribute":"Charisma"}' && D.parseAgainst('Hard') === null);
const sc = D.resolveCheckCall({ kind: 'save', who: 'Ines Arden', attribute: 'Charisma', difficulty: 'vs Muzen\'s Charisma', reason: 'the push goes deep' }, settings);
check('a save against a character resolves with the DC pending', sc && sc.kind === 'save' && sc.who === 'Ines Arden' && sc.attributeId === 'cha' && sc.skill === '' && sc.dc === null && sc.difficultySource === 'character' && sc.against.who === 'Muzen' && sc.against.attributeId === 'cha', JSON.stringify(sc));
const sc2 = D.applySaveDC(sc, { who: 'Muzen', isUser: true, score: 30, proficiencyBonus: 2 });
check('applySaveDC fills 8 + 2 + 10 and the label', sc2.dc === 20 && sc2.label === 'vs Muzen\'s Charisma' && sc2.against.mod === 10 && sc2.against.prof === 2 && sc2.against.score === 30 && sc.dc === null);
check('a save against the world takes the word', (() => { const w = D.resolveCheckCall({ kind: 'save', attribute: 'Wisdom', difficulty: 'Hard, disadvantage', reason: 'the vision presses in' }, settings); return w && w.kind === 'save' && w.dc === 20 && w.label === 'Hard' && w.advantage === 'dis' && w.against === null && w.difficultySource === 'ai'; })());
check('the tool\'s against fields resolve the same way', (() => { const t = D.resolveCheckCall({ kind: 'save', who: 'Ines Arden', attribute: 'Charisma', against: '', againstAttribute: 'Charisma', reason: 'x' }, settings); return t && t.against && t.against.who === '' && t.against.attributeId === 'cha' && t.dc === null; })());
const tagged = D.parseCheckCall('She frowns.\n[CHECK: Wisdom (Insight) | Medium | something is off]\nThen it hits her.\n[SAVE: Ines Arden: Charisma | vs Muzen\'s Charisma | the push goes deep]', settings);
check('the last tag wins, and a SAVE tag reads as a save', tagged && tagged.kind === 'save' && tagged.who === 'Ines Arden' && tagged.attributeId === 'cha' && tagged.against.who === 'Muzen' && tagged.raw.startsWith('[SAVE:'), JSON.stringify(tagged));
check('a CHECK tag after a SAVE tag still wins', D.parseCheckCall('[SAVE: Wisdom | Hard | x]\n[CHECK: Stealth | Hard | y]', settings).kind === 'check');
check('stripCheckCalls removes SAVE tags too', D.stripCheckCalls('Text.\n[SAVE: Wisdom | Hard | x]\n[CHECK: Stealth | Hard | y]') === 'Text.');
check('the end-of-reply instruction shows the SAVE form and the brief guide', inst.includes('[SAVE: Guard: Wisdom | vs Jordan\'s Charisma |') && inst.includes('Set the difficulty by the task and the circumstances') && inst.includes('Who rolls:'));
check('the tool instruction and definition carry saves', toolInst.includes('kind "save"') && tool.parameters.properties.kind.enum.join() === 'check,save' && tool.parameters.properties.againstAttribute.enum.length === 6 && tool.parameters.properties.difficulty.description.includes('DIFFICULTY: judge the task') && tool.description.includes('the actor never rolls'));
check('casting ability: stored as "cha:casting", one per sheet, cleared with empty, and a skill cannot be called Casting',
    D.castingKey('cha') === 'cha:casting' && D.isCastingKey('cha:casting') && !D.isCastingKey('cha:save')
    && D.getCastingAbility(['wis:save', 'cha:casting']) === 'cha' && D.getCastingAbility(['wis:save']) === ''
    && D.withCastingAbility(['wis:save', 'int:casting'], 'cha').join() === 'cha:casting,wis:save' && D.withCastingAbility(['cha:casting', 'wis:save'], '').join() === 'wis:save'
    && D.normalizeSkills(['Casting', 'Stealth']).join() === 'Stealth');
check('pruneProficiencies keeps a casting slot whose attribute exists', D.pruneProficiencies(['cha:casting', 'luck:casting', 'wis:save'], defs).join() === 'cha:casting,wis:save');
check('castingCandidateIds: the mental three, else every attribute', D.castingCandidateIds(defs).join() === 'int,wis,cha' && D.castingCandidateIds([{ id: 'luck' }, { id: 'grit' }]).join() === 'luck,grit');
check('dcAbilityId: casting wins over a named mental ability, a physical one stands, no casting means the named one',
    D.dcAbilityId({ namedId: 'wis', castingId: 'cha' }) === 'cha' && D.dcAbilityId({ namedId: '', castingId: 'cha' }) === 'cha' && D.dcAbilityId({ namedId: 'str', castingId: 'cha' }) === 'str' && D.dcAbilityId({ namedId: 'wis', castingId: '' }) === 'wis' && D.dcAbilityId({}) === '');
check('the attributes line names the casting ability with its numbers', D.buildAttributesLine([{ name: 'Muzen', isUser: true, sheet: { cha: 30 }, proficiencies: ['cha:casting'] }], defs, { proficiencyBonus: 2 }).endsWith('Muzen (player): CHA 30 (+10); casting ability Charisma (save DC 20, casting check +12).'));
check('the guide says a casting ability imposes everything a power does', guide.includes('A character with a casting ability on their sheet imposes everything their magic or powers do through it'));

// ── 9. Tiers and NPC sheets (Phase 4b, §11) ──
check('five tiers, ascending, each with a six-score array inside its range',
    D.TIERS.length === 5 && D.TIERS.map(t => t.id).join() === 'ordinary,trained,exceptional,heroic,legend'
    && D.TIERS.every(t => t.array.length === 6 && t.array.every(v => v >= t.min && v <= t.max)) && D.TIERS[4].max === 30 && D.TIERS[0].min === 8);
check('tierById takes an id or a label, any case', D.tierById('Legend').id === 'legend' && D.tierById('ORDINARY').id === 'ordinary' && D.tierById('demigod') === null && D.tierById('') === null);
check('the tier rides in the proficiency list, one at most, and clears with empty',
    D.withTier(['str:athletics'], 'legend').join() === 'str:athletics,tier:legend' && D.getTier(['tier:legend', 'str:athletics']) === 'legend'
    && D.withTier(['tier:legend', 'str:athletics'], 'Ordinary').join() === 'str:athletics,tier:ordinary' && D.withTier(['tier:legend'], '').join() === '' && D.getTier(['tier:demigod']) === '');
check('the suggested mark', D.withSuggestedMark(['tier:ordinary'], true).join() === 'mark:suggested,tier:ordinary' && D.isSuggested(['mark:suggested']) && D.withSuggestedMark(['mark:suggested', 'tier:ordinary'], false).join() === 'tier:ordinary');
check('pruneProficiencies keeps a known tier and any mark and drops an unknown tier', D.pruneProficiencies(['tier:legend', 'tier:demigod', 'mark:suggested', 'str:athletics'], defs).join() === 'mark:suggested,str:athletics,tier:legend');
check('an attribute cannot take the id "tier" or "mark"', D.normalizeAttributeDef({ name: 'Tier' }).id === 'attr_tier' && D.normalizeAttributeDef({ name: 'Mark' }).id === 'attr_mark');
check('tierFit', D.tierFit(30, 'legend') === 'in' && D.tierFit(17, 'legend') === 'below' && D.tierFit(13, 'ordinary') === 'above' && D.tierFit(10, '') === 'in');
check('fillByTier lays the array over the current ranking, ties by list order',
    JSON.stringify(D.fillByTier({ cha: 14, wis: 12 }, defs, 'legend')) === '{"cha":30,"wis":26,"str":24,"dex":22,"con":20,"int":18}'
    && JSON.stringify(D.fillByTier({}, defs, 'ordinary')) === '{"str":12,"dex":11,"con":10,"int":10,"wis":9,"cha":8}'
    && JSON.stringify(D.fillByTier({}, [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }, { id: 'e' }, { id: 'f' }, { id: 'g' }], 'trained')) === '{"a":14,"b":13,"c":12,"d":11,"e":10,"f":10,"g":10}'
    && JSON.stringify(D.fillByTier({}, defs, 'nope')) === '{}');
check('the attributes line carries the tier, and a tier alone is enough to be listed',
    D.buildAttributesLine([{ name: 'Ines Arden', isUser: false, sheet: {}, proficiencies: ['tier:ordinary'] }, { name: 'Muzen', isUser: true, sheet: { cha: 30 }, proficiencies: ['tier:legend', 'cha:casting'] }], defs, { proficiencyBonus: 2 })
    === 'ATTRIBUTES (D&D scale, 10 is average, bonus = (score - 10) / 2; a tier word says where they stand, Ordinary (8–12): most people; Trained (10–14): good at their trade; Exceptional (12–17): the best in a city; Heroic (15–20): the best alive; Legend (18–30): beyond human; read-only, never output them): Ines Arden, Ordinary. Muzen (player), Legend: CHA 30 (+10); casting ability Charisma (save DC 20, casting check +12).');
check('...and leaves it out with sendTier off', D.buildAttributesLine([{ name: 'Ines Arden', isUser: false, sheet: {}, proficiencies: ['tier:ordinary'] }], defs, { sendTier: false }) === '');
check('config: sendTier on and suggestNewSheets off by default, migration fills them', (() => { const c = D.attributesConfig({}); const s = { attributes: { enabled: true } }; D.migrateAttributesConfig(s); return c.sendTier === true && c.suggestNewSheets === false && s.attributes.sendTier === true && s.attributes.suggestNewSheets === false && D.attributesConfig({ attributes: { suggestNewSheets: true, sendTier: false } }).suggestNewSheets === true; })());
const sp2 = D.buildSheetSuggestionPrompt({ name: 'Ines Arden', description: 'A clerk at the Office, twenty, nervous.', appearance: 'Small, dark coat.', recentText: 'Ines: Hello.', settings });
check('the suggestion prompt carries the scale, the attributes and the character', sp2.system.includes('Ordinary (8–12): most people') && sp2.system.includes('"Strength": <1-30>') && sp2.user.startsWith('Character: Ines Arden. Attributes to score: Strength, Dexterity, Constitution, Intelligence, Wisdom, Charisma.') && sp2.user.includes('Who they are: A clerk at the Office') && sp2.user.includes('How they look: Small, dark coat.'), sp2.user);
const parsedSheet = D.parseSheetSuggestion('Here: {"tier": "ordinary", "scores": {"Strength": 9, "Charisma": 12, "Luck": 20, "Wisdom": 99}, "reasons": {"Charisma": "quick to smile", "Luck": "x"}}', settings);
check('parseSheetSuggestion reads the tier, clamps, drops unknown attributes and keeps known reasons', parsedSheet && parsedSheet.tierId === 'ordinary' && JSON.stringify(parsedSheet.scores) === '{"str":9,"cha":12,"wis":30}' && JSON.stringify(parsedSheet.reasons) === '{"cha":"quick to smile"}', JSON.stringify(parsedSheet));
check('...a label works, a bare tier works, garbage is null', D.parseSheetSuggestion('{"tier": "Legend", "scores": {}}', settings).tierId === 'legend' && D.parseSheetSuggestion('nothing here', settings) === null && D.parseSheetSuggestion('{"scores": {"Nope": 1}}', settings) === null);

// ── 10. Casting checks and talents (Phase 4c, §12) ──
check('the Casting skill: its slug is the casting slot, so the proficiency is the casting key',
    D.CASTING_CHECK_NAME === 'Casting' && D.isCastingSkill('casting') && D.isCastingSkill(' CASTING ') && !D.isCastingSkill('Stealth')
    && D.isProficient(['cha:casting'], 'cha', 'Casting') && !D.isProficient(['cha:casting'], 'wis', 'Casting') && !D.isProficient(['wis:save'], 'cha', 'Casting'));
check('castingCheckBonus is the modifier plus proficiency; castingAbilityFor falls back to Charisma, then the first candidate (D27)',
    D.castingCheckBonus(30, 2) === 12 && D.castingCheckBonus(8, 3) === 2 && D.castingAbilityFor(['int:casting'], defs) === 'int' && D.castingAbilityFor([], defs) === 'cha'
    && D.defaultCastingId([{ id: 'luck' }, { id: 'grit' }]) === 'luck' && D.defaultCastingId([{ id: 'int' }, { id: 'wis' }]) === 'int');
call = D.parseCheckCall('The ward hums.\n[CHECK: Casting | Hard | the ward is old]', settings);
check('[CHECK: Casting | Hard] is a casting check with the attribute left for the sheet', call && call.castingCheck === true && call.attributeId === '' && call.attribute === 'Casting' && call.abbr === 'CAST' && call.skill === 'Casting' && call.skillAttributeId === '' && call.difficultyId === 'hard' && call.dc === 20 && call.reason === 'the ward is old', JSON.stringify(call));
call = D.parseCheckCall('[CHECK: Muzen: Casting | Medium | the reach is long]', settings);
check('...with a named roller', call && call.who === 'Muzen' && call.castingCheck === true && call.difficultyId === 'medium');
call = D.parseCheckCall('[CHECK: Charisma (Casting) | Very hard | x]', settings);
check('"Charisma (Casting)" names the attribute and keeps the Casting skill on it', call && call.castingCheck === true && call.attributeId === 'cha' && call.skill === 'Casting' && call.skillAttributeId === 'cha' && call.difficultyId === 'veryHard', JSON.stringify(call));
check('the tool arguments: attribute Casting; and a save never becomes a casting check',
    (() => { const r = D.resolveCheckCall({ attribute: 'Casting', difficulty: 'Hard', reason: 'x' }, settings); return r && r.castingCheck === true && r.attributeId === '' && r.skill === 'Casting'; })()
    && (() => { const r = D.resolveCheckCall({ kind: 'save', attribute: 'Casting', difficulty: 'Hard', reason: 'x' }, settings); return r === null; })()
    && (() => { const r = D.resolveCheckCall({ attribute: 'Wisdom', skill: 'casting', difficulty: 'Easy', reason: 'x' }, settings); return r && r.castingCheck === true && r.attributeId === 'wis' && r.skill === 'Casting'; })());
check('an ordinary check carries no castingCheck flag', D.resolveCheckCall({ attribute: 'Wisdom', skill: 'Insight', difficulty: 'Easy', reason: 'x' }, settings).castingCheck === undefined);
check('talent keys: "talent:master:Telepathy", parsed back, malformed ones null',
    D.talentKey('Telepathy', 'master') === 'talent:master:Telepathy' && D.talentKey('  Blood   binding ', 'Nope') === 'talent:practised:Blood binding' && D.talentKey('Mist-walking', 'Master') === 'talent:master:Mist-walking'
    && JSON.stringify(D.parseTalentKey('talent:master:Telepathy')) === '{"name":"Telepathy","level":"master"}' && D.parseTalentKey('talent:demigod:Telepathy') === null && D.parseTalentKey('talent:master:') === null && D.parseTalentKey('talent:Telepathy') === null && D.parseTalentKey('cha:casting') === null
    && D.isTalentKey('talent:master:x') && !D.isTalentKey('tier:legend'));
check('withTalent: one entry per name (any case), level replaced, empty name ignored; withoutTalent removes it',
    D.withTalent(['cha:casting'], 'Telepathy', 'master').join() === 'cha:casting,talent:master:Telepathy'
    && D.withTalent(['talent:master:Telepathy', 'cha:casting'], 'telepathy', 'practised').join() === 'cha:casting,talent:practised:telepathy'
    && D.withTalent(['cha:casting'], '   ').join() === 'cha:casting'
    && D.withoutTalent(['talent:master:Telepathy', 'talent:practised:Blood-binding', 'cha:casting'], 'TELEPATHY').join() === 'cha:casting,talent:practised:Blood-binding');
check('getTalents: Masters first, then by name; talentsText writes them',
    JSON.stringify(D.getTalents(['talent:practised:Mist-walking', 'talent:master:Telepathy', 'talent:practised:Blood-binding', 'cha:casting'])) === '[{"name":"Telepathy","level":"master"},{"name":"Blood-binding","level":"practised"},{"name":"Mist-walking","level":"practised"}]'
    && D.talentsText(['talent:practised:Mist-walking', 'talent:master:Telepathy']) === 'Telepathy (Master), Mist-walking' && D.talentsText(['cha:casting']) === '');
check('pruneProficiencies keeps a well-formed talent and drops a malformed one; an attribute cannot take the id "talent"',
    D.pruneProficiencies(['talent:master:Telepathy', 'talent:demigod:X', 'talent:master:', 'str:athletics'], defs).join() === 'str:athletics,talent:master:Telepathy' && D.normalizeAttributeDef({ name: 'Talent' }).id === 'attr_talent');
check('the attributes line lists the talents, and talents alone are enough to be listed',
    D.buildAttributesLine([{ name: 'Muzen', isUser: true, sheet: { cha: 30 }, proficiencies: ['cha:casting', 'talent:master:Telepathy', 'talent:practised:Blood-binding'] }], defs, { proficiencyBonus: 2 }).endsWith('Muzen (player): CHA 30 (+10); casting ability Charisma (save DC 20, casting check +12); talents: Telepathy (Master), Blood-binding.')
    && D.buildAttributesLine([{ name: 'Silvy', isUser: false, sheet: {}, proficiencies: ['talent:practised:Lockpicking'] }], defs, { proficiencyBonus: 2 }).endsWith('Silvy: talents: Lockpicking.'));
check('the guide carries the three resolutions and the talent rule, in both forms',
    D.difficultyGuide(settings).includes('Magic and powers: done to someone who can resist, that someone saves against the caster\'s DC as above; contending with the world') && D.difficultyGuide(settings).includes('written Casting (their casting ability plus proficiency; advantage inside a Master talent on their sheet; outside their listed talents no proficiency, but never refused); nothing resisting, no roll. Holding a working through harm is a Constitution save.')
    && D.difficultyGuide(settings, { brief: true }).includes('nothing resisting, no roll'));
check('the instructions and the tool know Casting',
    D.buildCheckCallInstruction({ settings, userName: 'Jordan' }).includes('[CHECK: Casting | Hard | the ward is old] for a casting check') && D.buildToolCallInstruction({ settings, userName: 'Jordan' }).includes('(or Casting for a casting check)')
    && D.buildDiceToolDefinition({ settings }).parameters.properties.attribute.description.includes('Casting is a casting check') && D.buildDiceToolDefinition({ settings }).parameters.properties.skill.description.includes('Casting with the casting ability is the casting check'));

console.log(failures === 0 ? '\nAll d20 checks pass' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
