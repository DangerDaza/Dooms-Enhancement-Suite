/**
 * d20 — attributes and dice (Project Short Fuse, Phase 2).
 *
 * Pure: no SillyTavern or DES state imports. Every function takes the data
 * it works on, so the prompt, the roll lifecycle, the Workshop and the
 * settings page share one reader and `tools/d20-test.mjs` runs it in Node.
 *
 * What lives where:
 *   extensionSettings.attributes          the rules: the attribute list,
 *                                         when attributes go to the AI, the
 *                                         difficulty table, criticals, how a
 *                                         roll is triggered
 *   extensionSettings.characterAttributes the scores, global per character:
 *                                         { "user:Jordan": { str: 15 }, "npc:Mara": { dex: 16 } }
 *                                         Only scores other than 10 are stored;
 *                                         a missing attribute is 10 (+0).
 *   message.extra.dooms_roll              one roll, on the user message it
 *                                         rode with (src/systems/features/diceRolls.js)
 *
 * The arithmetic is D&D's: modifier = floor((score − 10) / 2), a d20 plus
 * the modifier against a difficulty class. Advantage rolls two and keeps the
 * higher, disadvantage the lower. With criticals on, a natural 20 succeeds
 * and a natural 1 fails whatever the total. The AI never decides any of
 * this; it is handed the verdict to narrate.
 *
 * Saving throws (Phase 4a, docs/stats-plan.md §10, 2024 rules): the one
 * acted upon rolls d20 + modifier (+ the proficiency bonus when proficient
 * in that save) against a DC the actor's ability sets, 8 + proficiency
 * bonus + modifier, or against a difficulty word when the world is the
 * source. A roll carries `kind: 'check' | 'save'`.
 */

/** The 5e skills under each ability. Constitution has none; a plain check is always offered. */
export const SKILL_PRESETS = Object.freeze({
    str: Object.freeze(['Athletics']),
    dex: Object.freeze(['Acrobatics', 'Sleight of Hand', 'Stealth']),
    con: Object.freeze([]),
    int: Object.freeze(['Arcana', 'History', 'Investigation', 'Nature', 'Religion']),
    wis: Object.freeze(['Animal Handling', 'Insight', 'Medicine', 'Perception', 'Survival']),
    cha: Object.freeze(['Deception', 'Intimidation', 'Performance', 'Persuasion']),
});

export const ATTRIBUTE_PRESETS = Object.freeze([
    { id: 'str', name: 'Strength',     abbr: 'STR', enabled: true, skills: SKILL_PRESETS.str },
    { id: 'dex', name: 'Dexterity',    abbr: 'DEX', enabled: true, skills: SKILL_PRESETS.dex },
    { id: 'con', name: 'Constitution', abbr: 'CON', enabled: true, skills: SKILL_PRESETS.con },
    { id: 'int', name: 'Intelligence', abbr: 'INT', enabled: true, skills: SKILL_PRESETS.int },
    { id: 'wis', name: 'Wisdom',       abbr: 'WIS', enabled: true, skills: SKILL_PRESETS.wis },
    { id: 'cha', name: 'Charisma',     abbr: 'CHA', enabled: true, skills: SKILL_PRESETS.cha },
]);

/** The difficulty words the game master picks from, and their default DCs. */
export const DIFFICULTIES = Object.freeze([
    { id: 'easy',             label: 'Easy',              dc: 10 },
    { id: 'medium',           label: 'Medium',            dc: 15 },
    { id: 'hard',             label: 'Hard',              dc: 20 },
    { id: 'veryHard',         label: 'Very hard',         dc: 25 },
    { id: 'nearlyImpossible', label: 'Nearly impossible', dc: 30 },
]);

export const MIN_SCORE = 1;
export const MAX_SCORE = 30;
export const DEFAULT_SCORE = 10;
export const MAX_ATTRIBUTES = 12;
export const MAX_SKILLS = 12;            // per attribute
export const MIN_PROFICIENCY = 1;
export const MAX_PROFICIENCY = 6;
export const STANDARD_ARRAY = Object.freeze([15, 14, 13, 12, 10, 8]);

const CONFIG_DEFAULTS = Object.freeze({
    enabled: false,
    sendToAI: 'withRoll',          // 'always' | 'withRoll' | 'never'
    defaultDifficulty: 'medium',   // used when the AI is not asked, or its answer cannot be read
    criticals: true,               // natural 20 succeeds, natural 1 fails
    aiRatesDifficulty: true,       // one small separate call rates the attempt
    allowOverride: false,          // may the player change the AI's ruling?
    proficiencyBonus: 2,           // added to a roll on a skill the character is proficient in
    notify: true,                  // toasts when a check is called, ruled or rolled (debugging aid)
    // The game master's own calls for checks (Phase 3). On with attributes.
    aiCalls: Object.freeze({
        enabled: true,
        endOfReply: true,          // "[CHECK: ...]" as the last line of a reply; any model
        tool: true,                // the dooms_roll_check function tool, where the model supports tools
        npcs: true,                // may call checks on NPCs' own actions, on their sheets
        frequency: 'sparingly',    // 'sparingly' | 'whenUncertain'
    }),
    contextMessages: 6,            // recent messages the rating call sees
});

const SEND_MODES = ['always', 'withRoll', 'never'];
export const CALL_FREQUENCIES = Object.freeze(['sparingly', 'whenUncertain']);

/** The aiCalls block with defaults filled in. Never mutates. */
export function normalizeAiCalls(raw) {
    const d = CONFIG_DEFAULTS.aiCalls;
    const a = raw && typeof raw === 'object' ? raw : {};
    return {
        enabled: a.enabled !== false,
        endOfReply: a.endOfReply !== false,
        tool: a.tool !== false,
        npcs: a.npcs !== false,
        frequency: CALL_FREQUENCIES.includes(a.frequency) ? a.frequency : d.frequency,
    };
}

/** A fresh, fully-populated rules block. */
export function defaultAttributesConfig() {
    return {
        enabled: CONFIG_DEFAULTS.enabled,
        list: ATTRIBUTE_PRESETS.map(p => ({ ...p, skills: [...p.skills] })),
        sendToAI: CONFIG_DEFAULTS.sendToAI,
        difficulty: Object.fromEntries(DIFFICULTIES.map(d => [d.id, d.dc])),
        defaultDifficulty: CONFIG_DEFAULTS.defaultDifficulty,
        criticals: CONFIG_DEFAULTS.criticals,
        aiRatesDifficulty: CONFIG_DEFAULTS.aiRatesDifficulty,
        allowOverride: CONFIG_DEFAULTS.allowOverride,
        proficiencyBonus: CONFIG_DEFAULTS.proficiencyBonus,
        notify: CONFIG_DEFAULTS.notify,
        contextMessages: CONFIG_DEFAULTS.contextMessages,
        aiCalls: { ...CONFIG_DEFAULTS.aiCalls },
    };
}

/** Slug used to build ids for attributes the user adds. */
export function attributeSlug(text) {
    return String(text || '')
        .toLowerCase()
        .normalize('NFKD').replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 24) || 'attr';
}

function presetFor(entry) {
    const id = typeof entry?.id === 'string' ? entry.id.toLowerCase() : '';
    const name = typeof entry?.name === 'string' ? entry.name.trim().toLowerCase() : '';
    return ATTRIBUTE_PRESETS.find(p => p.id === id || p.name.toLowerCase() === name) || null;
}

/** One attribute definition with every field present. Does not mutate `entry`. */
export function normalizeAttributeDef(entry) {
    const e = entry && typeof entry === 'object' ? entry : {};
    const preset = presetFor(e);
    const name = typeof e.name === 'string' && e.name.trim() ? e.name.trim().slice(0, 32) : (preset?.name || '');
    const id = typeof e.id === 'string' && e.id ? e.id : (preset?.id || attributeSlug(name));
    const abbrRaw = typeof e.abbr === 'string' && e.abbr.trim() ? e.abbr.trim() : (preset?.abbr || name.slice(0, 3));
    return {
        id,
        name,
        abbr: abbrRaw.toUpperCase().slice(0, 5),
        enabled: e.enabled !== false,
        skills: normalizeSkills(Array.isArray(e.skills) ? e.skills : (preset?.skills || [])),
    };
}

/** Skill names as stored on an attribute: trimmed, unique (case-insensitively), at most MAX_SKILLS. */
export function normalizeSkills(list) {
    const out = [];
    const seen = new Set();
    for (const raw of Array.isArray(list) ? list : []) {
        const name = String(raw ?? '').trim().slice(0, 32);
        if (!name) continue;
        // "save" is the saving-throw proficiency's slot on the sheet.
        if (attributeSlug(name) === SAVE_SLUG) continue;
        const lower = name.toLowerCase();
        if (seen.has(lower)) continue;
        seen.add(lower);
        out.push(name);
        if (out.length >= MAX_SKILLS) break;
    }
    return out;
}

/** The proficiency bonus as a whole number within range; the default when unreadable. */
export function clampProficiency(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return CONFIG_DEFAULTS.proficiencyBonus;
    return Math.min(MAX_PROFICIENCY, Math.max(MIN_PROFICIENCY, Math.round(n)));
}

/**
 * The rules block as every reader should see it: a normalised copy of
 * `settings.attributes` with defaults filled in. Never mutates settings.
 */
export function attributesConfig(settings) {
    const raw = settings?.attributes;
    const a = raw && typeof raw === 'object' ? raw : {};
    const list = Array.isArray(a.list) ? a.list : [];
    const diff = a.difficulty && typeof a.difficulty === 'object' ? a.difficulty : {};
    const difficulty = {};
    for (const d of DIFFICULTIES) {
        const v = Number(diff[d.id]);
        difficulty[d.id] = Number.isFinite(v) ? Math.min(40, Math.max(1, Math.round(v))) : d.dc;
    }
    const ctx = Number(a.contextMessages);
    return {
        enabled: a.enabled === true,
        list: list.map(e => normalizeAttributeDef(e)).filter(d => d.name),
        sendToAI: SEND_MODES.includes(a.sendToAI) ? a.sendToAI : CONFIG_DEFAULTS.sendToAI,
        difficulty,
        defaultDifficulty: DIFFICULTIES.some(d => d.id === a.defaultDifficulty) ? a.defaultDifficulty : CONFIG_DEFAULTS.defaultDifficulty,
        criticals: a.criticals !== false,
        aiRatesDifficulty: a.aiRatesDifficulty !== false,
        allowOverride: a.allowOverride === true,
        proficiencyBonus: clampProficiency(a.proficiencyBonus),
        notify: a.notify !== false,
        aiCalls: normalizeAiCalls(a.aiCalls),
        contextMessages: Number.isFinite(ctx) ? Math.min(30, Math.max(1, Math.round(ctx))) : CONFIG_DEFAULTS.contextMessages,
    };
}

/** The attributes that are switched on, in order. `all: true` includes the off ones. */
export function attributeDefs(settings, { all = false } = {}) {
    const defs = attributesConfig(settings).list;
    return all ? defs : defs.filter(d => d.enabled);
}

/** Master switch AND at least one attribute on. */
export function attributesOn(settings) {
    const cfg = attributesConfig(settings);
    return cfg.enabled && cfg.list.some(d => d.enabled);
}

/**
 * Additive migration: gives `settings.attributes` and
 * `settings.characterAttributes` their shape when missing. Mutates settings
 * and returns true when anything changed. Safe to run on every load.
 */
export function migrateAttributesConfig(settings) {
    if (!settings || typeof settings !== 'object') return false;
    let changed = false;
    if (!settings.attributes || typeof settings.attributes !== 'object' || Array.isArray(settings.attributes)) {
        settings.attributes = defaultAttributesConfig();
        changed = true;
    } else {
        const a = settings.attributes;
        const fresh = defaultAttributesConfig();
        if (!Array.isArray(a.list)) { a.list = fresh.list; changed = true; }
        a.list = a.list.filter(e => e && typeof e === 'object');
        a.list.forEach(entry => {
            const full = normalizeAttributeDef(entry);
            for (const key of ['id', 'name', 'abbr', 'enabled', 'skills']) {
                if (entry[key] === undefined) { entry[key] = full[key]; changed = true; }
            }
        });
        if (!a.difficulty || typeof a.difficulty !== 'object') { a.difficulty = fresh.difficulty; changed = true; }
        for (const d of DIFFICULTIES) {
            if (a.difficulty[d.id] === undefined) { a.difficulty[d.id] = d.dc; changed = true; }
        }
        for (const key of ['enabled', 'sendToAI', 'defaultDifficulty', 'criticals', 'aiRatesDifficulty', 'allowOverride', 'proficiencyBonus', 'notify', 'contextMessages']) {
            if (a[key] === undefined) { a[key] = fresh[key]; changed = true; }
        }
        if (!a.aiCalls || typeof a.aiCalls !== 'object' || Array.isArray(a.aiCalls)) {
            a.aiCalls = { ...fresh.aiCalls };
            changed = true;
        } else {
            for (const key of Object.keys(fresh.aiCalls)) {
                if (a.aiCalls[key] === undefined) { a.aiCalls[key] = fresh.aiCalls[key]; changed = true; }
            }
        }
    }
    if (!settings.characterAttributes || typeof settings.characterAttributes !== 'object' || Array.isArray(settings.characterAttributes)) {
        settings.characterAttributes = {};
        changed = true;
    }
    return changed;
}

// ─── Difficulty ─────────────────────────────────────────────────────────────

/** The difficulty table with the settings' DCs: [{ id, label, dc }]. */
export function difficultyTable(settings) {
    const cfg = attributesConfig(settings);
    return DIFFICULTIES.map(d => ({ id: d.id, label: d.label, dc: cfg.difficulty[d.id] }));
}

/** One difficulty entry by id; the configured default when the id is unknown. */
export function difficultyById(settings, id) {
    const table = difficultyTable(settings);
    const cfg = attributesConfig(settings);
    return table.find(d => d.id === id) || table.find(d => d.id === cfg.defaultDifficulty) || table[1];
}

/** 2024 rules: a DC a character sets with an ability is 8 + proficiency bonus + modifier (the spell save DC). */
export const SAVE_DC_BASE = 8;

/** The DC a character's ability sets for a saving throw against them. */
export function saveDC(score, proficiencyBonus = CONFIG_DEFAULTS.proficiencyBonus) {
    return SAVE_DC_BASE + clampProficiency(proficiencyBonus) + modifier(score);
}

/** The chance, as "55%", that d20 + bonus reaches dc. */
function oddsText(dc, bonus) {
    const p = Math.max(0, Math.min(1, (21 - (dc - bonus)) / 20));
    return `${Math.round(p * 100)}%`;
}

/**
 * What the game master is told about choosing a difficulty, and who rolls
 * (§10, D17): the task not the character, the five words with the
 * configured DCs and the odds for a +0 and a +5 roll, the one-step rule,
 * and the save rule. The brief form rides in the per-turn instruction; the
 * full form in the ruling call and the tool.
 */
export function difficultyGuide(settings, { brief = false } = {}) {
    const cfg = attributesConfig(settings);
    const meaning = {
        easy: 'a capable person nearly always manages this; call it only because failing would still matter',
        medium: 'a real test with a real chance of failing; the usual call',
        hard: 'most people fail and a skilled one often does',
        veryHard: 'a feat, for the skilled with luck',
        nearlyImpossible: 'a legend’s miracle, once a campaign',
    };
    const scale = difficultyTable(settings)
        .map(d => `${d.label} (DC ${d.dc}; a +0 roll makes it ${oddsText(d.dc, 0)} of the time, a +5 roll ${oddsText(d.dc, 5)}): ${meaning[d.id]}`)
        .join('. ');
    const who = `Who rolls: the one whose own action is uncertain makes an ability check against a difficulty. When the action is done to someone who can resist it, that someone makes a saving throw and the actor's ability sets the DC (${SAVE_DC_BASE} + the actor's proficiency bonus of ${cfg.proficiencyBonus} + the actor's modifier); the actor does not roll.`;
    if (brief) {
        return `Set the difficulty by the task and the circumstances, never by who attempts it (their bonus is added afterwards); Medium is the usual call, Hard when most people would fail. ${who}`;
    }
    return `DIFFICULTY: judge the task and the circumstances, never the character: the roller's modifier and proficiency are added afterwards, so a master and a novice face the same DC and differ in their bonus. ${scale}. When unsure, Medium. Circumstances move the call one step (dark, hurried, wounded, a hostile listener) or give advantage or disadvantage, never both. A social check on someone who does not want to be moved starts at Hard; on someone already inclined, Easy. The reason names the one thing that could go wrong. ${who}`;
}

// ─── Scores and sheets ──────────────────────────────────────────────────────

/** Rounds and clamps into 1–30; garbage gives null. */
export function clampScore(value) {
    const n = typeof value === 'string' ? Number(value.trim()) : value;
    if (typeof n !== 'number' || !Number.isFinite(n)) return null;
    return Math.min(MAX_SCORE, Math.max(MIN_SCORE, Math.round(n)));
}

/** D&D's modifier: floor((score − 10) / 2). */
export function modifier(score) {
    const s = clampScore(score);
    return Math.floor(((s === null ? DEFAULT_SCORE : s) - 10) / 2);
}

/** "+2", "-1", "+0". */
export function formatModifier(m) {
    const n = Number.isFinite(m) ? m : 0;
    return n < 0 ? `-${Math.abs(n)}` : `+${n}`;
}

/** The storage key for a character's sheet: "user:Name" or "npc:Name". */
export function characterKey(name, isUser) {
    return `${isUser ? 'user' : 'npc'}:${String(name || '').trim()}`;
}

function findStoreKey(store, key) {
    if (!store || typeof store !== 'object') return undefined;
    if (Object.prototype.hasOwnProperty.call(store, key)) return key;
    const lower = key.toLowerCase();
    return Object.keys(store).find(k => k.toLowerCase() === lower);
}

/**
 * A character's scores for every attribute on the list, 10 where nothing is
 * stored. Name lookup is case-insensitive.
 */
export function getSheet(settings, name, isUser, defs = null) {
    const list = defs || attributeDefs(settings);
    const store = settings?.characterAttributes;
    const k = findStoreKey(store, characterKey(name, isUser));
    const stored = k !== undefined && store[k] && typeof store[k] === 'object' ? store[k] : {};
    const out = {};
    for (const d of list) {
        const v = clampScore(stored[d.id]);
        out[d.id] = v === null ? DEFAULT_SCORE : v;
    }
    return out;
}

/** True when every score on the sheet is 10: nothing worth sending. */
export function isDefaultSheet(sheet, defs) {
    return (defs || []).every(d => !sheet || sheet[d.id] === undefined || sheet[d.id] === DEFAULT_SCORE);
}

/**
 * Stores a character's scores. Only scores other than 10 are kept, and an
 * all-10 sheet removes the entry, so "default" stays trivially detectable.
 * Mutates settings.characterAttributes; returns the stored object or null.
 */
export function setSheet(settings, name, isUser, scores, defs = null, proficiencies = null) {
    if (!settings || typeof settings !== 'object' || !name) return null;
    if (!settings.characterAttributes || typeof settings.characterAttributes !== 'object') settings.characterAttributes = {};
    const list = defs || attributeDefs(settings, { all: true });
    const store = settings.characterAttributes;
    const key = characterKey(name, isUser);
    const existing = findStoreKey(store, key);
    // Proficiencies not passed are kept as they were.
    const prof = normalizeProfKeys(Array.isArray(proficiencies) ? proficiencies : (existing !== undefined ? store[existing]?.[PROF_KEY] : null));
    if (existing !== undefined && existing !== key) delete store[existing];
    const out = {};
    for (const d of list) {
        const v = clampScore(scores ? scores[d.id] : undefined);
        if (v !== null && v !== DEFAULT_SCORE) out[d.id] = v;
    }
    if (prof.length) out[PROF_KEY] = prof;
    if (Object.keys(out).length) store[key] = out;
    else delete store[key];
    return store[key] || null;
}

// ─── Skills and proficiency ─────────────────────────────────────────────────
//
// A proficiency is "this character is good at this skill": the proficiency
// bonus is added to a roll on it. Stored on the sheet under a reserved key
// as "attributeId:skill-slug" strings, so an attribute or skill that goes
// away takes its proficiencies with it (see index.js's settings handlers).

const PROF_KEY = '_prof';

/** The stored form of a proficiency: "dex:sleight_of_hand" (the attribute id, then the skill's slug). */
export function skillKey(attributeId, skillName) {
    return `${String(attributeId || '')}:${attributeSlug(skillName)}`;
}

function normalizeProfKeys(list) {
    const out = [];
    for (const raw of Array.isArray(list) ? list : []) {
        const k = String(raw ?? '').trim();
        if (k && k.includes(':') && !out.includes(k)) out.push(k);
    }
    return out.sort();
}

/** A character's proficiency keys, [] when none are stored. Name lookup is case-insensitive. */
export function getProficiencies(settings, name, isUser) {
    const store = settings?.characterAttributes;
    const k = findStoreKey(store, characterKey(name, isUser));
    if (k === undefined) return [];
    return normalizeProfKeys(store[k]?.[PROF_KEY]);
}

/** True when the key for this attribute and skill is among the proficiencies. */
export function isProficient(proficiencies, attributeId, skillName) {
    return Array.isArray(proficiencies) && proficiencies.includes(skillKey(attributeId, skillName));
}

/** The reserved slug of a saving-throw proficiency: "wis:save". A skill cannot take this name. */
export const SAVE_SLUG = 'save';

/** The stored form of a saving-throw proficiency: "wis:save". */
export function saveKey(attributeId) {
    return `${String(attributeId || '')}:${SAVE_SLUG}`;
}

/** True for an "attr:save" key. */
export function isSaveKey(key) {
    const k = String(key || '');
    const i = k.indexOf(':');
    return i > 0 && k.slice(i + 1) === SAVE_SLUG;
}

/** True when the character is proficient in saving throws with this attribute. */
export function isSaveProficient(proficiencies, attributeId) {
    return Array.isArray(proficiencies) && proficiencies.includes(saveKey(attributeId));
}

/** The attributes (by def) a character has save proficiency in, in list order. */
export function saveProficiencyDefs(defs, proficiencies) {
    return (defs || []).filter(d => isSaveProficient(proficiencies, d.id));
}

/** Resolves a proficiency key back to its skill's display name, or '' when no def carries it. */
export function skillNameForKey(defs, key) {
    const i = String(key || '').indexOf(':');
    if (i < 0) return '';
    const attributeId = key.slice(0, i);
    const slug = key.slice(i + 1);
    const def = (defs || []).find(d => d.id === attributeId);
    if (!def) return '';
    return (def.skills || []).find(sk => attributeSlug(sk) === slug) || '';
}

/**
 * A skill by name, wherever it sits on the list: { attributeId, name } with
 * the attribute it belongs to (its "home"), or null. Case-insensitive. The
 * variant rule "Skills with Different Abilities" pairs any skill with any
 * attribute (Constitution (Athletics), Strength (Intimidation)); the
 * proficiency stays keyed by the skill's home attribute, so a tick on
 * Athletics applies whichever attribute the check uses.
 */
export function findSkill(defs, name) {
    const wanted = String(name || '').trim().toLowerCase();
    if (!wanted) return null;
    for (const d of defs || []) {
        const hit = (d.skills || []).find(sk => sk.toLowerCase() === wanted);
        if (hit) return { attributeId: d.id, name: hit };
    }
    return null;
}

/** Keeps only the proficiencies whose attribute and skill (or save) still exist on the defs. */
export function pruneProficiencies(proficiencies, defs) {
    return normalizeProfKeys((proficiencies || []).filter(k => {
        if (isSaveKey(k)) return (defs || []).some(d => d.id === String(k).slice(0, String(k).indexOf(':')));
        return !!skillNameForKey(defs, k);
    }));
}

/** Removes a character's sheet. */
export function deleteSheet(settings, name, isUser) {
    const store = settings?.characterAttributes;
    const k = findStoreKey(store, characterKey(name, isUser));
    if (k === undefined) return false;
    delete store[k];
    return true;
}

// ─── Dice ───────────────────────────────────────────────────────────────────

/**
 * A uniform integer in [0, max) from crypto.getRandomValues with rejection
 * sampling, so no face of a die is favoured. Falls back to Math.random only
 * when no crypto is available at all.
 */
export function cryptoRandomInt(max) {
    const m = Math.max(1, Math.floor(max));
    const c = globalThis.crypto;
    if (!c || typeof c.getRandomValues !== 'function') return Math.floor(Math.random() * m);
    const buf = new Uint32Array(1);
    const limit = Math.floor(0x100000000 / m) * m;
    let x;
    do {
        c.getRandomValues(buf);
        x = buf[0];
    } while (x >= limit);
    return x % m;
}

/** 1..sides. `rng(max)` gives an integer in [0, max). */
export function rollDie(sides, rng = cryptoRandomInt) {
    const s = Math.max(2, Math.floor(sides));
    return rng(s) + 1;
}

/** 4d6, drop the lowest: 3–18. */
export function roll4d6DropLowest(rng = cryptoRandomInt) {
    const dice = [rollDie(6, rng), rollDie(6, rng), rollDie(6, rng), rollDie(6, rng)].sort((a, b) => b - a);
    return dice[0] + dice[1] + dice[2];
}

/**
 * One check. Returns everything the verdict, the card and the record need.
 * @param {{ attribute: string, abbr?: string, score: number, dc: number,
 *           advantage?: 'none'|'adv'|'dis', criticals?: boolean, rng?: Function }} p
 */
export function rollCheck({ attribute, abbr = '', skill = '', score, dc, advantage = 'none', criticals = true, proficiency = 0, kind = 'check', rng = cryptoRandomInt }) {
    const s = clampScore(score) ?? DEFAULT_SCORE;
    const mod = modifier(s);
    const prof = Number.isFinite(Number(proficiency)) ? Math.max(0, Math.round(Number(proficiency))) : 0;
    const target = Number.isFinite(dc) ? Math.round(dc) : 15;
    const adv = advantage === 'adv' || advantage === 'dis' ? advantage : 'none';
    const first = rollDie(20, rng);
    let rolls = [first];
    let kept = first;
    let dropped = null;
    if (adv !== 'none') {
        const second = rollDie(20, rng);
        rolls = [first, second];
        kept = adv === 'adv' ? Math.max(first, second) : Math.min(first, second);
        dropped = adv === 'adv' ? Math.min(first, second) : Math.max(first, second);
    }
    const total = kept + mod + prof;
    let success = total >= target;
    let critical = null;
    if (criticals) {
        if (kept === 20) { success = true; critical = 'success'; }
        else if (kept === 1) { success = false; critical = 'failure'; }
    }
    return {
        kind: kind === 'save' ? 'save' : 'check',
        attribute: String(attribute || ''),
        abbr: String(abbr || ''),
        skill: String(skill || ''),
        score: s,
        mod,
        prof,
        rolls,
        kept,
        dropped,
        total,
        dc: target,
        advantage: adv,
        success,
        margin: total - target,
        critical,
    };
}

/** True for a saving throw; an old record without a kind is a check. */
export function isSaveRoll(roll) {
    return !!roll && roll.kind === 'save';
}

/** How wide a margin reads: narrowly, clearly, decisively. */
export function marginWord(margin) {
    const m = Math.abs(Number(margin) || 0);
    if (m <= 2) return 'narrowly';
    if (m <= 7) return 'clearly';
    return 'decisively';
}

function outcomeWords(roll) {
    if (roll.critical === 'success') return 'NATURAL 20, a critical success';
    if (roll.critical === 'failure') return 'NATURAL 1, a critical failure';
    if (roll.success) return `SUCCESS, ${marginWord(roll.margin)} (by ${Math.abs(roll.margin)})`;
    return `FAILURE, ${marginWord(roll.margin)} (by ${Math.abs(roll.margin)})`;
}

function narrateWords(roll) {
    const save = isSaveRoll(roll);
    if (roll.critical === 'success') return save ? 'narrate the effect shrugged off entirely' : 'narrate it going better than hoped';
    if (roll.critical === 'failure') return save ? 'narrate the effect taking hold worse than a plain failure' : 'narrate it going worse than a plain miss';
    if (roll.success) return save ? 'narrate the effect being resisted, with that margin in mind' : 'narrate the attempt succeeding, with that margin in mind';
    return save ? 'narrate the effect taking hold and its consequences' : 'narrate the attempt failing and its consequences';
}

/**
 * Whose roll this is and what its outcome decides, so a verdict about one
 * character's roll is never read as the other's result (§10, D17). '' for
 * the player's own check, whose opening already says who attempts what.
 * @param {object} roll
 * @param {{ actorName?: string }} [opts] - who imposed a save, or whose attempt an NPC's check is not about
 */
export function ownershipSentence(roll, { actorName = '' } = {}) {
    const who = String(roll?.who || '').trim();
    if (!who) return '';
    const actor = String(actorName || roll?.against?.who || '').trim();
    if (isSaveRoll(roll)) {
        const effect = actor ? `${actor}'s effect on them` : 'what the reason describes';
        return `This roll is ${who}'s: ${who} ${roll.success ? `resists, and ${effect} fails` : `does not resist, and ${effect} takes hold`}.`;
    }
    if (roll.isUser === false) {
        return `This roll is ${who}'s: it decides whether ${who} succeeds at what the reason describes${actor ? `, nothing about ${actor}'s own attempt` : ''}.`;
    }
    return '';
}

/** "DC 20 (Muzen's Charisma: 8 + 2 proficiency +10)" for a save a character set; "DC 15 (Medium)" otherwise. */
export function describeDC(roll, difficultyLabel = '') {
    const a = roll?.against;
    if (isSaveRoll(roll) && a && typeof a === 'object' && a.who) {
        return `DC ${roll.dc} (${a.who}'s ${a.attribute || a.abbr || 'ability'}: ${SAVE_DC_BASE} + ${a.prof} proficiency ${formatModifier(a.mod)})`;
    }
    return `DC ${roll.dc}${difficultyLabel ? ` (${difficultyLabel})` : ''}`;
}

/**
 * The one block the AI sees for a roll: the arithmetic, the outcome, whose
 * roll it is, and the instruction that it is final.
 */
export function verdictText(roll, { userName = 'The player', attempt = '', difficultyLabel = '', reason = '', framing = '', ownership = '' } = {}) {
    const who = String(userName || 'The player');
    const what = attempt ? `"${String(attempt).trim()}"` : 'the action in their last message';
    const opening = framing ? String(framing).trim().replace(/\.$/, '') : `${who} attempts ${what}`;
    const save = isSaveRoll(roll);
    const label = `${checkLabel(roll)} ${save ? 'saving throw' : 'check'}`;
    let dice = `d20 = ${roll.kept}`;
    if (roll.advantage !== 'none' && roll.rolls.length === 2) {
        dice += ` (rolled ${roll.rolls[0]} and ${roll.rolls[1]}; ${roll.advantage === 'adv' ? 'advantage keeps the higher' : 'disadvantage keeps the lower'})`;
    }
    const profIn = save ? `${roll.attribute || roll.abbr || 'these'} saves` : (roll.skill || 'this');
    const modPart = `${formatModifier(roll.mod)}${roll.abbr ? ` (${roll.abbr} ${roll.score})` : ''}${roll.prof ? `, +${roll.prof} (proficient in ${profIn})` : ''}`;
    const dcPart = `${describeDC(roll, difficultyLabel)}${reason ? `, because ${String(reason).trim().replace(/\.$/, '')}` : ''}`;
    const own = ownership ? ` ${String(ownership).trim()}` : '';
    return `[DICE: ${opening}. ${label}: ${dice}, ${modPart} = ${roll.total} vs ${dcPart}. ${outcomeWords(roll)}.${own} This outcome is final: ${narrateWords(roll)}. Do not re-roll, reverse or soften it.]`;
}

/** "Dexterity (Stealth)" or "Strength": the attribute with the skill when there is one. */
export function checkLabel(roll) {
    const base = roll?.attribute || roll?.abbr || 'Ability';
    return roll?.skill ? `${base} (${roll.skill})` : base;
}

/** The outcome in two words for cards and chips. */
export function outcomeLabel(roll) {
    return roll.critical === 'success' ? 'Critical success'
        : roll.critical === 'failure' ? 'Critical failure'
            : roll.success ? 'Success' : 'Failure';
}

/** Short form for the chip and the roll card. */
export function formatRollShort(roll) {
    const dice = roll.advantage !== 'none' && roll.rolls.length === 2 ? `${roll.kept} (${roll.rolls[0]}/${roll.rolls[1]})` : `${roll.kept}`;
    return `${checkLabel(roll)} ${isSaveRoll(roll) ? 'save' : 'check'} · d20 ${dice} ${formatModifier(roll.mod)}${roll.prof ? ` +${roll.prof}` : ''} = ${roll.total} vs DC ${roll.dc} · ${outcomeLabel(roll)}`;
}

// ─── Prompt text ────────────────────────────────────────────────────────────

/**
 * The read-only attributes line for the prompt. `entries` are
 * [{ name, isUser, sheet }]; a character whose sheet is all 10s is left
 * out, and only scores other than 10 are listed. '' when nothing to say.
 */
export function buildAttributesLine(entries, defs, { proficiencyBonus = CONFIG_DEFAULTS.proficiencyBonus } = {}) {
    const parts = [];
    let anyProf = false;
    for (const e of entries || []) {
        if (!e || !e.name) continue;
        const sheet = e.sheet || {};
        const scores = defs
            .filter(d => sheet[d.id] !== undefined && sheet[d.id] !== DEFAULT_SCORE)
            .map(d => `${d.abbr} ${sheet[d.id]} (${formatModifier(modifier(sheet[d.id]))})`);
        const prof = (e.proficiencies || []).map(k => skillNameForKey(defs, k)).filter(Boolean);
        const saves = saveProficiencyDefs(defs, e.proficiencies).map(d => d.name);
        if (!scores.length && !prof.length && !saves.length) continue;
        if (prof.length || saves.length) anyProf = true;
        const bits = [];
        if (scores.length) bits.push(scores.join(', '));
        if (prof.length) bits.push(`proficient in ${prof.join(', ')} (+${proficiencyBonus})`);
        if (saves.length) bits.push(`proficient in ${saves.join(', ')} saves (+${proficiencyBonus})`);
        parts.push(`${e.name}${e.isUser ? ' (player)' : ''}: ${bits.join('; ')}`);
    }
    if (!parts.length) return '';
    const head = 'ATTRIBUTES (D&D scale, 10 is average, bonus = (score - 10) / 2' + (anyProf ? `; a proficient skill adds +${proficiencyBonus}` : '') + '; read-only, never output them): ';
    return head + parts.join('. ') + '.';
}

/**
 * The small separate call that rates an attempt: what the game master is
 * asked, and what it is shown.
 */
export function buildDifficultyRatingPrompt({ userName = 'The player', attempt = '', attributeName = 'an ability', skillName = '', messageText = '', recentText = '', settings = null, targets = [] } = {}) {
    const words = DIFFICULTIES.map(d => d.label.toLowerCase()).join('|');
    const system = `You are the game master of a roleplay. The player is about to attempt something; the game rolls the d20 for it, never you. ${difficultyGuide(settings)} Give advantage only when circumstances clearly favour the attempt and disadvantage only when they clearly hinder it. Answer with ONE line of JSON and nothing else. For the player's own check: {"difficulty": "<${words}>", "advantage": "<none|advantage|disadvantage>", "reason": "<one short sentence>"}. When the attempt works on another character who can resist it, answer instead with that character's saving throw: {"save": {"who": "<their name>", "attribute": "<the ability they resist with>", "against": "<the player's ability that sets the DC>"}, "advantage": "<none|advantage|disadvantage>", "reason": "<one short sentence>"}; the player's ability is the one named in the attempt unless another clearly fits better.`;
    const using = `${attributeName}${skillName ? ` (${skillName})` : ''}`;
    const message = String(messageText || '').trim();
    const names = (Array.isArray(targets) ? targets : []).map(t => String(t || '').trim()).filter(Boolean);
    const user = `Recent scene:\n${recentText || '(no messages yet)'}\n\nThe player (${userName}) attempts: "${String(attempt || '').trim() || (message ? 'what their message describes' : 'what their next message describes')}", using ${using}.${message ? `\nTheir message: "${message.slice(0, 600)}"` : ''}${names.length ? `\nCharacters in the scene who could resist: ${names.join(', ')}.` : ''}\nRate it.`;
    return { system, user };
}

/**
 * Reads the game master's answer. A JSON line is preferred; prose with the
 * difficulty words in it is accepted. Null when nothing can be read. A
 * save answer comes back as { kind: 'save', who, attribute, against,
 * advantage, reason } with the names as written; the caller resolves them
 * against the sheet.
 * @returns {{ kind: 'check', difficultyId: string, dc: number, label: string, advantage: 'none'|'adv'|'dis', reason: string }
 *   | { kind: 'save', who: string, attribute: string, against: string, advantage: 'none'|'adv'|'dis', reason: string } | null}
 */
export function parseDifficultyRating(text, settings) {
    const s = String(text || '');
    if (!s.trim()) return null;
    const table = difficultyTable(settings);
    let difficultyId = null;
    let advantage = 'none';
    let reason = '';
    // The whole answer when it is JSON (a save answer nests an object), else the first object in it.
    const m = s.match(/\{[\s\S]*\}/);
    if (m) {
        try {
            const j = JSON.parse(m[0]);
            const advWord = String(j.advantage || '').toLowerCase();
            if (advWord.startsWith('dis')) advantage = 'dis';
            else if (advWord.startsWith('adv')) advantage = 'adv';
            if (typeof j.reason === 'string') reason = j.reason.trim().slice(0, 200);
            if (j.save && typeof j.save === 'object' && String(j.save.who || '').trim()) {
                return {
                    kind: 'save',
                    who: String(j.save.who).trim().slice(0, 60),
                    attribute: String(j.save.attribute || '').trim().slice(0, 32),
                    against: String(j.save.against || '').trim().slice(0, 32),
                    advantage,
                    reason,
                };
            }
            const word = String(j.difficulty || '').toLowerCase();
            const hit = DIFFICULTIES.find(d => d.label.toLowerCase() === word || d.id.toLowerCase() === word.replace(/\s+/g, ''));
            if (hit) difficultyId = hit.id;
        } catch (e) { /* fall through to the prose scan */ }
    }
    if (!difficultyId) {
        const lower = s.toLowerCase();
        // Longer phrases first: "very hard" contains "hard".
        const order = ['nearlyImpossible', 'veryHard', 'hard', 'medium', 'easy'];
        for (const id of order) {
            const label = DIFFICULTIES.find(d => d.id === id).label.toLowerCase();
            if (lower.includes(label)) { difficultyId = id; break; }
        }
        if (!difficultyId) return null;
        if (lower.includes('disadvantage')) advantage = 'dis';
        else if (lower.includes('advantage')) advantage = 'adv';
    }
    const entry = table.find(d => d.id === difficultyId);
    return { kind: 'check', difficultyId, dc: entry.dc, label: entry.label, advantage, reason };
}

// ─── The game master's own calls (Phase 3) ──────────────────────────────────
//
// Two ways for the AI to call for a check: a "[CHECK: ...]" line at the end
// of a reply (any model), or the dooms_roll_check function tool (models with
// tool calling). Either way the AI names the attribute, a skill, the
// difficulty and a reason before any die exists; the game rolls.

const CHECK_CALL_RE = /\[CHECK:\s*([^\]]*?)\s*\]/gi;
const SAVE_CALL_RE = /\[SAVE:\s*([^\]]*?)\s*\]/gi;

/**
 * "vs Muzen's Charisma", "against the player's Wisdom", "vs Charisma": who
 * sets the DC (empty for the player) and with which ability. Null when the
 * text is not of that form.
 */
export function parseAgainst(text) {
    const t = String(text || '').trim();
    const m = t.match(/^(?:vs\.?|versus|against)\s+(.+?)\s*$/i);
    if (!m) return null;
    const rest = m[1].trim();
    const owned = rest.match(/^(.+?)(?:'s|’s)\s+(.+)$/);
    if (owned) return { who: owned[1].trim(), attribute: owned[2].trim() };
    return { who: '', attribute: rest };
}

function matchDifficultyWords(text, settings) {
    const lower = String(text || '').toLowerCase();
    let difficultyId = null;
    for (const id of ['nearlyImpossible', 'veryHard', 'hard', 'medium', 'easy']) {
        const label = DIFFICULTIES.find(d => d.id === id).label.toLowerCase();
        if (lower.includes(label)) { difficultyId = id; break; }
    }
    let advantage = 'none';
    if (lower.includes('disadvantage')) advantage = 'dis';
    else if (lower.includes('advantage')) advantage = 'adv';
    return { difficultyId, advantage };
}

/** An attribute def by name or short form, case-insensitive, or null. */
export function findAttribute(defs, text) {
    const t = String(text || '').trim().toLowerCase();
    if (!t) return null;
    return (defs || []).find(d => d.name.toLowerCase() === t || d.abbr.toLowerCase() === t) || null;
}

/**
 * Turns the pieces of a call (from the tag or the tool) into one check or
 * save description, or null when no attribute can be read. A check with no
 * difficulty falls back to the configured default, and says so in
 * `difficultySource`. A save whose DC another character sets carries
 * `against: { who, attribute, attributeId, abbr }` with `dc` null until
 * the lifecycle reads that character's sheet (`applySaveDC`); `who` empty
 * in `against` means the player. A save with a difficulty word instead is
 * against the world and has its DC at once.
 */
export function resolveCheckCall({ kind = 'check', who = '', attribute = '', skill = '', difficulty = '', advantage = '', reason = '', against = '', againstAttribute = '' } = {}, settings) {
    const defs = attributeDefs(settings);
    const save = kind === 'save';
    let def = findAttribute(defs, attribute);
    let hit = save ? null : findSkill(defs, skill);
    // "[CHECK: Stealth | Hard]": a skill alone means its home attribute.
    if (!def && !hit && !save) hit = findSkill(defs, attribute);
    if (!def && hit) def = defs.find(d => d.id === hit.attributeId) || null;
    if (!def) return null;
    const cfg = attributesConfig(settings);
    const words = matchDifficultyWords(`${difficulty} ${advantage}`, settings);
    const base = {
        kind: save ? 'save' : 'check',
        who: String(who || '').trim().slice(0, 60),
        attributeId: def.id,
        attribute: def.name,
        abbr: def.abbr,
        skill: hit ? hit.name : '',
        skillAttributeId: hit ? hit.attributeId : '',
        advantage: words.advantage,
        reason: String(reason || '').trim().replace(/^because\s+/i, '').slice(0, 200),
    };
    if (save) {
        // "vs Muzen's Charisma" in the difficulty slot, or the tool's against fields.
        const parsed = parseAgainst(difficulty);
        const whoSets = parsed ? parsed.who : String(against || '').trim();
        const abilityText = parsed ? parsed.attribute : String(againstAttribute || '').trim();
        const againstDef = abilityText ? findAttribute(defs, abilityText) : null;
        if (againstDef || (!words.difficultyId && (abilityText || whoSets || against))) {
            // The DC comes from a character: the actor's ability. When no ability was named, the save's own ability.
            const a = againstDef || def;
            return {
                ...base,
                against: { who: String(whoSets || '').trim().slice(0, 60), attributeId: a.id, attribute: a.name, abbr: a.abbr },
                difficultyId: '',
                dc: null,
                label: '',
                difficultySource: 'character',
            };
        }
    }
    const d = difficultyById(settings, words.difficultyId || cfg.defaultDifficulty);
    return {
        ...base,
        against: null,
        difficultyId: d.id,
        dc: d.dc,
        label: d.label,
        difficultySource: words.difficultyId ? 'ai' : 'default',
    };
}

/**
 * Fills a save's DC from the sheet of the character who sets it (§10.1):
 * 8 + proficiency bonus + their modifier. Returns a new call with `dc`, a
 * label like "vs Muzen's Charisma", and the formula's parts on `against`.
 * @param {object} call - from resolveCheckCall, difficultySource 'character'
 * @param {{ who: string, isUser?: boolean, score: number, proficiencyBonus?: number }} actor
 */
export function applySaveDC(call, { who, isUser = false, score, proficiencyBonus = CONFIG_DEFAULTS.proficiencyBonus } = {}) {
    if (!call || !call.against) return call;
    const s = clampScore(score) ?? DEFAULT_SCORE;
    const prof = clampProficiency(proficiencyBonus);
    const mod = modifier(s);
    const name = String(who || call.against.who || 'the player').trim();
    return {
        ...call,
        against: { ...call.against, who: name, isUser: !!isUser, score: s, mod, prof },
        dc: SAVE_DC_BASE + prof + mod,
        label: `vs ${name}'s ${call.against.attribute}`,
        difficultySource: 'character',
    };
}

/**
 * The last "[CHECK: ...]" tag in a reply, read into a check description, or
 * null. The form the game master is asked for:
 *   [CHECK: Dexterity (Stealth) | Hard, disadvantage | the guards are alert]
 *   [CHECK: Guard: Wisdom (Perception) | Medium | the corridor is dark]
 * A missing skill, difficulty or reason is tolerated; a missing or unknown
 * attribute is not.
 */
export function parseCheckCall(text, settings) {
    const s = String(text || '');
    const checks = [...s.matchAll(CHECK_CALL_RE)].map(m => ({ m, kind: 'check' }));
    const saves = [...s.matchAll(SAVE_CALL_RE)].map(m => ({ m, kind: 'save' }));
    const all = checks.concat(saves).sort((a, b) => a.m.index - b.m.index);
    if (!all.length) return null;
    const { m, kind } = all[all.length - 1];
    const parts = m[1].split('|').map(p => p.trim());
    let head = parts[0] || '';
    let who = '';
    const defs = attributeDefs(settings);
    const colon = head.indexOf(':');
    if (colon > 0) {
        const before = head.slice(0, colon).trim();
        // "Guard: Wisdom (Perception)" names who rolls; "Dexterity: Stealth"
        // is just a loose way of writing the attribute and skill.
        if (findAttribute(defs, before)) {
            head = `${before} (${head.slice(colon + 1).trim().replace(/^\(|\)$/g, '')})`;
        } else {
            who = before;
            head = head.slice(colon + 1).trim();
        }
    }
    const paren = head.match(/^([^()]*?)\s*\(([^)]*)\)\s*$/);
    const attribute = paren ? paren[1].trim() : head.trim();
    const skill = paren ? paren[2].trim() : '';
    const call = resolveCheckCall({ kind, who, attribute, skill, difficulty: parts[1] || '', reason: parts[2] || '' }, settings);
    return call ? { ...call, raw: m[0] } : null;
}

/** The reply with every "[CHECK: ...]" and "[SAVE: ...]" tag removed, for display. */
export function stripCheckCalls(text) {
    return String(text || '').replace(CHECK_CALL_RE, '').replace(SAVE_CALL_RE, '').replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n').trim();
}

function attributeMenu(defs) {
    return (defs || []).map(d => `${d.abbr} ${d.name}${d.skills && d.skills.length ? ` (${d.skills.join(', ')})` : ''}`).join('; ');
}

function frequencyClause(frequency) {
    return frequency === 'whenUncertain'
        ? 'whenever an attempt could plausibly fail'
        : 'only when the stakes are real and the outcome could go either way';
}

/**
 * What the game master is told when it may call for checks by ending a
 * reply with a tag. Short, and firm that most replies have none.
 */
export function buildCheckCallInstruction({ settings, userName = 'the player' } = {}) {
    const cfg = attributesConfig(settings);
    const defs = attributeDefs(settings);
    const words = DIFFICULTIES.map(d => d.label).join(', ');
    const npc = cfg.aiCalls.npcs
        ? ' For a character other than the player, start with their name: [CHECK: Guard: Wisdom (Perception) | Medium | the corridor is dark].'
        : '';
    const saveExample = cfg.aiCalls.npcs
        ? `[SAVE: Guard: Wisdom | vs ${userName}'s Charisma | the suggestion presses on his mind]`
        : `[SAVE: Wisdom | Hard | the vision presses in]`;
    return `[CHECKS: The game rolls the dice; you never do. ${userName}'s attributes and skills: ${attributeMenu(defs)}. When an action's outcome is genuinely uncertain and matters, you may call for ONE check by putting a line in exactly this form at the end of your narration: [CHECK: Dexterity (Stealth) | Hard | the guards are alert]. Difficulty is one of ${words}; you may add "advantage" or "disadvantage" after it.${npc} ${difficultyGuide(settings, { brief: true })} For a saving throw write ${saveExample}: the one who saves, the ability they resist with, then either "vs <name>'s <ability>" for the character whose ability sets the DC (a bare "vs <ability>" means ${userName}'s) or a difficulty word when the world is the source. The line replaces nothing: anything else you are required to output (a tracker or data block, for instance) still follows as usual. Call for a check ${frequencyClause(cfg.aiCalls.frequency)}; never for routine actions, conversation or scene-setting, and most replies have none. Never roll, resolve or narrate the outcome yourself: the result arrives with the next message and you narrate it then.]`;
}

export const DICE_TOOL_NAME = 'dooms_roll_check';

/** What the game master is told when the dice tool is available to it. */
export function buildToolCallInstruction({ settings, userName = 'the player' } = {}) {
    const cfg = attributesConfig(settings);
    const defs = attributeDefs(settings);
    const npc = cfg.aiCalls.npcs ? ', and who is rolling when it is not the player' : '';
    return `[CHECKS: The game rolls the dice; you never do. ${userName}'s attributes and skills: ${attributeMenu(defs)}. When an action's outcome is genuinely uncertain and matters, call the ${DICE_TOOL_NAME} tool with the attribute, a skill if one applies, the difficulty and a short reason${npc}; the result comes back to you, is final, and you narrate it as it fell. ${difficultyGuide(settings, { brief: true })} For a saving throw call the tool with kind "save": who saves and the ability they resist with, and either the character whose ability sets the DC (against and againstAttribute) or a difficulty word when the world is the source. A tool call does not change the shape of your reply: after the result, produce the tracker data block exactly where your instructions place it, then the story. Call for a check ${frequencyClause(cfg.aiCalls.frequency)}; never for routine actions, conversation or scene-setting, and most replies have none. Never invent a roll or an outcome without the tool.]`;
}

/**
 * The dice tool as SillyTavern's ToolManager wants it, without the action
 * (the feature module adds that). Attribute and difficulty are enums so a
 * model cannot name what the sheet does not have.
 */
export function buildDiceToolDefinition({ settings, userName = 'the player' } = {}) {
    const cfg = attributesConfig(settings);
    const defs = attributeDefs(settings);
    const skills = defs.flatMap(d => (d.skills || []).map(sk => `${sk} (${d.abbr})`));
    const names = defs.map(d => d.name);
    const properties = {
        kind: { type: 'string', enum: ['check', 'save'], description: 'check: the roller’s own uncertain action against a difficulty (the default). save: the roller resists something done to them; the DC comes from the character doing it (against, againstAttribute) or from a difficulty word when the world is the source.' },
        attribute: { type: 'string', enum: names, description: 'The attribute the check is made with, or the ability a save is made with.' },
        skill: { type: 'string', description: `A skill that applies to a check, or empty for a plain attribute check (never for a save). Any skill may pair with any attribute. Known skills: ${skills.join(', ') || 'none'}.` },
        difficulty: { type: 'string', enum: DIFFICULTIES.map(d => d.label), description: `Required for a check, and for a save the world imposes. ${difficultyGuide(settings)}` },
        advantage: { type: 'string', enum: ['none', 'advantage', 'disadvantage'], description: 'Advantage only when circumstances clearly favour the roller, disadvantage only when they clearly hinder them.' },
        reason: { type: 'string', description: 'One short sentence: the one thing that could go wrong, and why this difficulty.' },
        against: { type: 'string', description: `For a save a character imposes: that character's name as it appears in the scene, or empty for ${userName}.` },
        againstAttribute: { type: 'string', enum: names, description: 'For a save a character imposes: the ability of theirs that sets the DC (8 + their proficiency bonus + their modifier).' },
    };
    const required = ['attribute', 'reason'];
    if (cfg.aiCalls.npcs) {
        properties.who = { type: 'string', description: `Who rolls: leave empty for ${userName}, or an NPC's name as it appears in the scene. For a save, the one resisting.` };
    }
    return {
        name: DICE_TOOL_NAME,
        displayName: 'Dice check',
        description: `Rolls a d20 check or saving throw for ${userName}${cfg.aiCalls.npcs ? ' or an NPC' : ''}, using their sheet (modifier and proficiency), against a difficulty you set or the DC another character's ability sets. The one acting rolls a check; the one acted upon rolls a save, and the actor never rolls. Call it only when an action's outcome is genuinely uncertain and matters; most replies need none. The result is final: narrate it as it fell.`,
        parameters: { type: 'object', properties, required },
    };
}
