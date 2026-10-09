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
 */

export const ATTRIBUTE_PRESETS = Object.freeze([
    { id: 'str', name: 'Strength',     abbr: 'STR', enabled: true },
    { id: 'dex', name: 'Dexterity',    abbr: 'DEX', enabled: true },
    { id: 'con', name: 'Constitution', abbr: 'CON', enabled: true },
    { id: 'int', name: 'Intelligence', abbr: 'INT', enabled: true },
    { id: 'wis', name: 'Wisdom',       abbr: 'WIS', enabled: true },
    { id: 'cha', name: 'Charisma',     abbr: 'CHA', enabled: true },
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
export const STANDARD_ARRAY = Object.freeze([15, 14, 13, 12, 10, 8]);

const CONFIG_DEFAULTS = Object.freeze({
    enabled: false,
    sendToAI: 'withRoll',          // 'always' | 'withRoll' | 'never'
    defaultDifficulty: 'medium',   // used when the AI is not asked, or its answer cannot be read
    criticals: true,               // natural 20 succeeds, natural 1 fails
    aiRatesDifficulty: true,       // one small separate call rates the attempt
    allowOverride: false,          // may the player change the AI's ruling?
    rollOnSend: true,              // tag the message, roll when it is sent
    contextMessages: 6,            // recent messages the rating call sees
});

const SEND_MODES = ['always', 'withRoll', 'never'];

/** A fresh, fully-populated rules block. */
export function defaultAttributesConfig() {
    return {
        enabled: CONFIG_DEFAULTS.enabled,
        list: ATTRIBUTE_PRESETS.map(p => ({ ...p })),
        sendToAI: CONFIG_DEFAULTS.sendToAI,
        difficulty: Object.fromEntries(DIFFICULTIES.map(d => [d.id, d.dc])),
        defaultDifficulty: CONFIG_DEFAULTS.defaultDifficulty,
        criticals: CONFIG_DEFAULTS.criticals,
        aiRatesDifficulty: CONFIG_DEFAULTS.aiRatesDifficulty,
        allowOverride: CONFIG_DEFAULTS.allowOverride,
        rollOnSend: CONFIG_DEFAULTS.rollOnSend,
        contextMessages: CONFIG_DEFAULTS.contextMessages,
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
    };
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
        rollOnSend: a.rollOnSend !== false,
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
            for (const key of ['id', 'name', 'abbr', 'enabled']) {
                if (entry[key] === undefined) { entry[key] = full[key]; changed = true; }
            }
        });
        if (!a.difficulty || typeof a.difficulty !== 'object') { a.difficulty = fresh.difficulty; changed = true; }
        for (const d of DIFFICULTIES) {
            if (a.difficulty[d.id] === undefined) { a.difficulty[d.id] = d.dc; changed = true; }
        }
        for (const key of ['enabled', 'sendToAI', 'defaultDifficulty', 'criticals', 'aiRatesDifficulty', 'allowOverride', 'rollOnSend', 'contextMessages']) {
            if (a[key] === undefined) { a[key] = fresh[key]; changed = true; }
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
export function setSheet(settings, name, isUser, scores, defs = null) {
    if (!settings || typeof settings !== 'object' || !name) return null;
    if (!settings.characterAttributes || typeof settings.characterAttributes !== 'object') settings.characterAttributes = {};
    const list = defs || attributeDefs(settings, { all: true });
    const store = settings.characterAttributes;
    const key = characterKey(name, isUser);
    const existing = findStoreKey(store, key);
    if (existing !== undefined && existing !== key) delete store[existing];
    const out = {};
    for (const d of list) {
        const v = clampScore(scores ? scores[d.id] : undefined);
        if (v !== null && v !== DEFAULT_SCORE) out[d.id] = v;
    }
    if (Object.keys(out).length) store[key] = out;
    else delete store[key];
    return store[key] || null;
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
export function rollCheck({ attribute, abbr = '', score, dc, advantage = 'none', criticals = true, rng = cryptoRandomInt }) {
    const s = clampScore(score) ?? DEFAULT_SCORE;
    const mod = modifier(s);
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
    const total = kept + mod;
    let success = total >= target;
    let critical = null;
    if (criticals) {
        if (kept === 20) { success = true; critical = 'success'; }
        else if (kept === 1) { success = false; critical = 'failure'; }
    }
    return {
        attribute: String(attribute || ''),
        abbr: String(abbr || ''),
        score: s,
        mod,
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
    if (roll.critical === 'success') return 'narrate it going better than hoped';
    if (roll.critical === 'failure') return 'narrate it going worse than a plain miss';
    if (roll.success) return 'narrate the attempt succeeding, with that margin in mind';
    return 'narrate the attempt failing and its consequences';
}

/**
 * The one block the AI sees for a roll: the arithmetic, the outcome, and
 * the instruction that it is final.
 */
export function verdictText(roll, { userName = 'The player', attempt = '', difficultyLabel = '', reason = '' } = {}) {
    const who = String(userName || 'The player');
    const what = attempt ? `"${String(attempt).trim()}"` : 'the action in their last message';
    const label = roll.attribute || roll.abbr || 'Ability';
    let dice = `d20 = ${roll.kept}`;
    if (roll.advantage !== 'none' && roll.rolls.length === 2) {
        dice += ` (rolled ${roll.rolls[0]} and ${roll.rolls[1]}; ${roll.advantage === 'adv' ? 'advantage keeps the higher' : 'disadvantage keeps the lower'})`;
    }
    const modPart = `${formatModifier(roll.mod)}${roll.abbr ? ` (${roll.abbr} ${roll.score})` : ''}`;
    const dcPart = `DC ${roll.dc}${difficultyLabel ? ` (${difficultyLabel})` : ''}${reason ? `, because ${String(reason).trim().replace(/\.$/, '')}` : ''}`;
    return `[DICE: ${who} attempts ${what}. ${label} check: ${dice}, ${modPart} = ${roll.total} vs ${dcPart}. ${outcomeWords(roll)}. This outcome is final: ${narrateWords(roll)}. Do not re-roll, reverse or soften it.]`;
}

/** Short form for the chip and the roll card. */
export function formatRollShort(roll) {
    const label = roll.attribute || roll.abbr || 'Ability';
    const dice = roll.advantage !== 'none' && roll.rolls.length === 2 ? `${roll.kept} (${roll.rolls[0]}/${roll.rolls[1]})` : `${roll.kept}`;
    const outcome = roll.critical === 'success' ? 'Critical success'
        : roll.critical === 'failure' ? 'Critical failure'
            : roll.success ? 'Success' : 'Failure';
    return `${label} check · d20 ${dice} ${formatModifier(roll.mod)} = ${roll.total} vs DC ${roll.dc} · ${outcome}`;
}

// ─── Prompt text ────────────────────────────────────────────────────────────

/**
 * The read-only attributes line for the prompt. `entries` are
 * [{ name, isUser, sheet }]; a character whose sheet is all 10s is left
 * out, and only scores other than 10 are listed. '' when nothing to say.
 */
export function buildAttributesLine(entries, defs) {
    const parts = [];
    for (const e of entries || []) {
        if (!e || !e.name || !e.sheet || isDefaultSheet(e.sheet, defs)) continue;
        const scores = defs
            .filter(d => e.sheet[d.id] !== undefined && e.sheet[d.id] !== DEFAULT_SCORE)
            .map(d => `${d.abbr} ${e.sheet[d.id]} (${formatModifier(modifier(e.sheet[d.id]))})`);
        if (scores.length) parts.push(`${e.name}${e.isUser ? ' (player)' : ''}: ${scores.join(', ')}`);
    }
    if (!parts.length) return '';
    return 'ATTRIBUTES (D&D scale, 10 is average, bonus = (score - 10) / 2; read-only, never output them): ' + parts.join('. ') + '.';
}

/**
 * The small separate call that rates an attempt: what the game master is
 * asked, and what it is shown.
 */
export function buildDifficultyRatingPrompt({ userName = 'The player', attempt = '', attributeName = 'an ability', recentText = '' } = {}) {
    const words = DIFFICULTIES.map(d => d.label.toLowerCase()).join('|');
    const system = `You are the game master of a roleplay. The player is about to attempt something and will roll a d20 against a difficulty you set. Judge how hard the attempt is for this character in this scene, as a fair but demanding game master would: an ordinary act is easy, a real test medium, something most people would fail hard, a feat very hard, a miracle nearly impossible. Give advantage only when circumstances clearly favour the attempt and disadvantage only when they clearly hinder it. Answer with ONE line of JSON and nothing else: {"difficulty": "<${words}>", "advantage": "<none|advantage|disadvantage>", "reason": "<one short sentence>"}`;
    const user = `Recent scene:\n${recentText || '(no messages yet)'}\n\nThe player (${userName}) attempts: "${String(attempt || '').trim() || 'what their next message describes'}", using ${attributeName}.\nRate it.`;
    return { system, user };
}

/**
 * Reads the game master's answer. A JSON line is preferred; prose with the
 * difficulty words in it is accepted. Null when nothing can be read.
 * @returns {{ difficultyId: string, dc: number, label: string, advantage: 'none'|'adv'|'dis', reason: string }|null}
 */
export function parseDifficultyRating(text, settings) {
    const s = String(text || '');
    if (!s.trim()) return null;
    const table = difficultyTable(settings);
    let difficultyId = null;
    let advantage = 'none';
    let reason = '';
    const m = s.match(/\{[\s\S]*?\}/);
    if (m) {
        try {
            const j = JSON.parse(m[0]);
            const word = String(j.difficulty || '').toLowerCase();
            const hit = DIFFICULTIES.find(d => d.label.toLowerCase() === word || d.id.toLowerCase() === word.replace(/\s+/g, ''));
            if (hit) difficultyId = hit.id;
            const advWord = String(j.advantage || '').toLowerCase();
            if (advWord.startsWith('dis')) advantage = 'dis';
            else if (advWord.startsWith('adv')) advantage = 'adv';
            if (typeof j.reason === 'string') reason = j.reason.trim().slice(0, 200);
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
    return { difficultyId, dc: entry.dc, label: entry.label, advantage, reason };
}
