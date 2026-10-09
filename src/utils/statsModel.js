/**
 * Character Stats — pure model.
 *
 * No SillyTavern imports: everything here is plain data in, plain data out,
 * so it can be unit-tested outside the browser. Storage, events and prompt
 * injection live in src/systems/features/characterStats.js.
 *
 * Two kinds of stat:
 *   - attribute: the classic D&D six plus any the user adds, 1–100 on a human
 *     scale: 10 is an ordinary person, below 10 a weakness, 20 the human peak,
 *     above 20 superhuman. Fixed by default: the AI only reads them.
 *   - state:     Health, Satiety, Energy, Hygiene, Morale, Mana plus any the
 *     user adds, a 0–100 percentage drawn as a ring. The AI updates them by
 *     default.
 * Every stat carries an "ai" flag (may the AI change it?) that the user can
 * flip per character. Custom stats are shared by every character: their
 * definitions live in one global list (extensionSettings.characterStatCustom),
 * while each character keeps its own starting value and AI tick for them.
 *
 * Stored sheet shape (extensionSettings.characterStatSheets[ns][name]):
 *   { base: { [statId]: number }, ai: { [statId]: boolean },
 *     pending?: true }   // NPC waiting for the AI to generate its values
 * (Sheets saved before custom stats went global may still carry a
 * `custom` array; characterStats.js folds it into the global list.)
 * Missing entries fall back to the defaults below, so new built-ins added in
 * a later release show up on existing sheets automatically.
 *
 * Built-in stats can be switched off globally (Settings → Stats). A switched
 * off stat keeps its stored values but is resolved with enabled: false, and
 * every consumer (panel, Workshop, prompt, AI updates) skips it.
 */

export const STAT_KINDS = {
    attribute: { min: 1, max: 100, defaultBase: 10, defaultAi: false },
    state: { min: 0, max: 100, defaultBase: 100, defaultAi: true },
};

/** Attribute scale: an ordinary person, and the best a human can be. */
export const HUMAN_AVERAGE = 10;
export const HUMAN_PEAK = 20;

export const BUILTIN_ATTRIBUTES = [
    { id: 'str', name: 'Strength', abbr: 'STR', description: 'Raw physical power: lifting, pushing, melee force, athletics.' },
    { id: 'dex', name: 'Dexterity', abbr: 'DEX', description: 'Agility, reflexes, balance, stealth and fine motor control.' },
    { id: 'con', name: 'Constitution', abbr: 'CON', description: 'Endurance, toughness and resistance to illness, poison and fatigue.' },
    { id: 'int', name: 'Intelligence', abbr: 'INT', description: 'Reasoning, memory, knowledge and analytical skill.' },
    { id: 'wis', name: 'Wisdom', abbr: 'WIS', description: 'Perception, intuition, insight and willpower.' },
    { id: 'cha', name: 'Charisma', abbr: 'CHA', description: 'Force of personality: persuasion, presence, deception, leadership.' },
];

export const BUILTIN_STATES = [
    { id: 'health', name: 'Health', color: '#e5484d', base: 100, description: 'Physical wellbeing. Drops with wounds, illness or poison; recovers with rest, treatment or healing.' },
    { id: 'satiety', name: 'Satiety', color: '#2fbf71', base: 80, description: 'How fed the character is. Slowly drops as time passes and with effort; rises when eating.' },
    { id: 'energy', name: 'Energy', color: '#f5b301', base: 100, description: 'Stamina and wakefulness. Drops with exertion and lack of sleep; recovers with rest and sleep.' },
    { id: 'hygiene', name: 'Hygiene', color: '#22b8cf', base: 100, description: 'Cleanliness. Drops with time, sweat, dirt and blood; restored by washing or bathing.' },
    { id: 'morale', name: 'Morale', color: '#4c8dff', base: 75, description: 'Mood and motivation. Rises with successes, comfort and good company; drops with setbacks, fear and loss.' },
    { id: 'mana', name: 'Mana', color: '#a66bff', base: 100, description: 'Magical reserves. Spent by casting spells or using magic; recovers with rest or meditation.' },
];

/** Colours handed out to custom states, in order. */
export const CUSTOM_STATE_COLORS = ['#ff7a45', '#f06595', '#20c997', '#94d82d', '#fab005', '#748ffc', '#e599f7', '#63e6be'];

/** At or below this percentage a state ring turns to the warning colour. */
export const LOW_STATE_THRESHOLD = 30;
export const LOW_STATE_COLOR = '#e5484d';

export const MAX_CUSTOM_STATS = 24;

/** #rgb / #rrggbb only — anything else is ignored. */
export function isHexColor(v) {
    return typeof v === 'string' && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v);
}

function isFiniteNumber(v) {
    return typeof v === 'number' && Number.isFinite(v);
}

/** Clamps and rounds a value into a stat's range. Non-numbers give null. */
export function clampStatValue(stat, value) {
    const n = typeof value === 'string' ? Number(String(value).replace('%', '').trim()) : value;
    if (!isFiniteNumber(n)) return null;
    const kind = STAT_KINDS[stat?.kind] || STAT_KINDS.attribute;
    const min = isFiniteNumber(stat?.min) ? stat.min : kind.min;
    const max = isFiniteNumber(stat?.max) ? stat.max : kind.max;
    return Math.min(max, Math.max(min, Math.round(n)));
}

/** Short label for a stat: the abbreviation for attributes, else the name. */
export function statLabel(stat) {
    return stat?.abbr || stat?.name || '';
}

/** Slug used to build ids for custom stats. */
export function slugify(text) {
    return String(text || '')
        .toLowerCase()
        .normalize('NFKD').replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 32) || 'stat';
}

/**
 * Turns a stored sheet (or nothing) into the full ordered stat list:
 * built-in attributes, custom attributes, built-in states, custom states.
 * @param {object|null|undefined} stored
 * @returns {Array<object>}
 */
export function resolveSheet(stored, { disabled = [], colors = {}, custom = [] } = {}) {
    const off = new Set(Array.isArray(disabled) ? disabled : []);
    const palette = colors && typeof colors === 'object' ? colors : {};
    const base = stored && typeof stored.base === 'object' && stored.base ? stored.base : {};
    const ai = stored && typeof stored.ai === 'object' && stored.ai ? stored.ai : {};
    // Custom stats come from the global list (shared by every character).
    const customDefs = Array.isArray(custom) ? custom : [];

    const build = (def, kind, builtin) => {
        const k = STAT_KINDS[kind];
        const stat = {
            id: def.id,
            name: def.name,
            abbr: def.abbr || '',
            description: def.description || '',
            kind,
            min: k.min,
            max: k.max,
            builtin,
            // Colours can be changed globally (Settings / Workshop).
            color: (isHexColor(palette[def.id]) ? palette[def.id] : def.color) || '',
        };
        const fallbackBase = isFiniteNumber(def.base) ? def.base : k.defaultBase;
        stat.base = clampStatValue(stat, isFiniteNumber(base[def.id]) ? base[def.id] : fallbackBase);
        const defaultAi = typeof def.ai === 'boolean' ? def.ai : k.defaultAi;
        stat.ai = typeof ai[def.id] === 'boolean' ? ai[def.id] : defaultAi;
        stat.enabled = !off.has(def.id);
        return stat;
    };

    const seen = new Set();
    const customValid = customDefs.filter(c => {
        if (!c || typeof c !== 'object') return false;
        if (typeof c.id !== 'string' || !c.id || typeof c.name !== 'string' || !c.name.trim()) return false;
        if (!STAT_KINDS[c.kind]) return false;
        if (seen.has(c.id)) return false;
        seen.add(c.id);
        return true;
    });

    let colorIdx = 0;
    const customOf = (kind) => customValid
        .filter(c => c.kind === kind)
        .map(c => {
            // A custom stat has no built-in starting value of its own.
            const def = { ...c, name: c.name.trim(), base: undefined };
            if (kind === 'state' && !def.color) def.color = CUSTOM_STATE_COLORS[colorIdx++ % CUSTOM_STATE_COLORS.length];
            return build(def, kind, false);
        });

    return [
        ...BUILTIN_ATTRIBUTES.map(d => build(d, 'attribute', true)),
        ...customOf('attribute'),
        ...BUILTIN_STATES.map(d => build(d, 'state', true)),
        ...customOf('state'),
    ];
}

/**
 * Inverse of resolveSheet: the stored shape for a resolved stat list.
 * @param {Array<object>} stats
 */
export function serializeSheet(stats, { pending = false } = {}) {
    const out = { base: {}, ai: {} };
    if (pending) out.pending = true;
    for (const s of stats || []) {
        if (!s || !s.id) continue;
        const v = clampStatValue(s, s.base);
        if (v !== null) out.base[s.id] = v;
        out.ai[s.id] = !!s.ai;
    }
    return out;
}

/** The global definition stored for a custom stat. */
export function customStatDefinition(stat) {
    const entry = {
        id: stat.id,
        name: String(stat.name || '').trim(),
        description: String(stat.description || '').trim(),
        kind: stat.kind,
        ai: !!stat.ai,
    };
    if (stat.color) entry.color = stat.color;
    return entry;
}

/**
 * Builds a new custom stat. Returns { stat } or { error }.
 * @param {Array<object>} existing - the character's current stat list
 * @param {{name: string, description?: string, kind?: string, ai?: boolean}} input
 */
export function createCustomStat(existing, input) {
    const name = String(input?.name || '').trim().slice(0, 40);
    if (!name) return { error: 'Give the stat a name.' };
    const kind = STAT_KINDS[input?.kind] ? input.kind : 'attribute';
    const list = Array.isArray(existing) ? existing : [];
    const lower = name.toLowerCase();
    if (list.some(s => s.name.toLowerCase() === lower || (s.abbr && s.abbr.toLowerCase() === lower))) {
        return { error: `There is already a stat called "${name}".` };
    }
    if (list.filter(s => !s.builtin).length >= MAX_CUSTOM_STATS) {
        return { error: `You can have at most ${MAX_CUSTOM_STATS} custom stats.` };
    }
    const ids = new Set(list.map(s => s.id));
    let id = 'c_' + slugify(name);
    let n = 2;
    while (ids.has(id)) id = `c_${slugify(name)}_${n++}`;
    const k = STAT_KINDS[kind];
    const stat = {
        id,
        name,
        abbr: '',
        description: String(input?.description || '').trim().slice(0, 400),
        kind,
        min: k.min,
        max: k.max,
        builtin: false,
        color: '',
        base: k.defaultBase,
        ai: typeof input?.ai === 'boolean' ? input.ai : k.defaultAi,
    };
    if (kind === 'state') {
        const used = new Set(list.map(s => s.color));
        stat.color = CUSTOM_STATE_COLORS.find(c => !used.has(c)) || CUSTOM_STATE_COLORS[list.length % CUSTOM_STATE_COLORS.length];
    }
    return { stat };
}

/** The stats that are switched on. */
export function activeStats(stats) {
    return (stats || []).filter(s => s && s.enabled !== false);
}

/** Every built-in stat, in display order (for the Settings list). */
export function builtinStatList() {
    return [
        ...BUILTIN_ATTRIBUTES.map(d => ({ ...d, kind: 'attribute' })),
        ...BUILTIN_STATES.map(d => ({ ...d, kind: 'state' })),
    ];
}

/** Finds a stat by id, name or abbreviation (case-insensitive). */
export function findStat(stats, label) {
    const key = String(label || '').trim().toLowerCase();
    if (!key) return null;
    return (stats || []).find(s =>
        s.id.toLowerCase() === key
        || s.name.toLowerCase() === key
        || (s.abbr && s.abbr.toLowerCase() === key)
        || slugify(s.name) === slugify(key),
    ) || null;
}

/** Current values with the base filling anything not yet set. */
export function resolveCurrentValues(stats, stored) {
    const out = {};
    const src = stored && typeof stored === 'object' ? stored : {};
    for (const s of stats || []) {
        const v = isFiniteNumber(src[s.id]) ? clampStatValue(s, src[s.id]) : null;
        out[s.id] = v === null ? s.base : v;
    }
    return out;
}

/** Colour of a state ring at a given value. */
export function ringColor(stat, value) {
    if (stat?.kind === 'state' && isFiniteNumber(value) && value <= LOW_STATE_THRESHOLD) return LOW_STATE_COLOR;
    return stat?.color || '#4c8dff';
}

/**
 * Normalises whatever shape the AI used for "stats" into
 * [{ name, values: { label: value } }].
 * Accepts { "Name": { "Health": 80 } } and
 * [{ "name": "Name", "stats": { ... } }] / [{ "name": "Name", "Health": 80 }].
 */
export function normalizeAIStats(raw) {
    let data = raw;
    if (typeof data === 'string') {
        try { data = JSON.parse(data); } catch (e) { return []; }
    }
    if (!data || typeof data !== 'object') return [];
    const out = [];
    const pushEntry = (name, values) => {
        if (typeof name !== 'string' || !name.trim() || !values || typeof values !== 'object' || Array.isArray(values)) return;
        out.push({ name: name.trim(), values });
    };
    if (Array.isArray(data)) {
        for (const item of data) {
            if (!item || typeof item !== 'object') continue;
            if (item.stats && typeof item.stats === 'object') pushEntry(item.name, item.stats);
            else {
                const { name, ...rest } = item;
                pushEntry(name, rest);
            }
        }
        return out;
    }
    for (const [name, values] of Object.entries(data)) pushEntry(name, values);
    return out;
}

/**
 * Works out which AI-reported values actually change something.
 * @param {Array<{key: string, names: string[], stats: object[], current: object}>} targets
 * @param {*} raw - the "stats" value from the AI's tracker JSON
 * @returns {Array<{key: string, statId: string, before: number, after: number}>}
 */
export function computeAIChanges(targets, raw) {
    const entries = normalizeAIStats(raw);
    const changes = [];
    const done = new Set();
    for (const entry of entries) {
        const lower = entry.name.toLowerCase();
        const target = (targets || []).find(t => (t.names || []).some(n => String(n).toLowerCase() === lower));
        if (!target) continue;
        for (const [label, rawValue] of Object.entries(entry.values)) {
            const stat = findStat(target.stats, label);
            // A character being generated takes every stat, locked or not;
            // switched-off stats are never touched.
            if (!stat || stat.enabled === false || (!stat.ai && !target.generate)) continue;
            const dedupe = `${target.key}\u0000${stat.id}`;
            if (done.has(dedupe)) continue;
            const value = clampStatValue(stat, typeof rawValue === 'object' && rawValue ? rawValue.value : rawValue);
            if (value === null) continue;
            done.add(dedupe);
            const before = target.current?.[stat.id];
            if (target.generate) {
                changes.push({ key: target.key, statId: stat.id, before, after: value, generated: true });
                continue;
            }
            if (before === value) continue;
            changes.push({ key: target.key, statId: stat.id, before, after: value });
        }
    }
    return changes;
}

/**
 * Folds a newer change set into an older one recorded for the same message
 * (a "Refresh" of the trackers): the earliest "before" survives so an undo
 * still restores what the message started from.
 */
export function mergeChangeSets(older, newer) {
    const map = new Map();
    for (const c of older || []) map.set(`${c.key}\u0000${c.statId}`, { ...c });
    for (const c of newer || []) {
        const k = `${c.key}\u0000${c.statId}`;
        if (map.has(k)) map.get(k).after = c.after;
        else map.set(k, { ...c });
    }
    return [...map.values()].filter(c => c.before !== c.after);
}

/**
 * Which changes an undo should roll back: only stats still holding the value
 * the AI wrote, so a manual edit made afterwards is never thrown away.
 * @param {Array} changes
 * @param {(key: string, statId: string) => number|undefined} readCurrent
 */
export function changesToRevert(changes, readCurrent) {
    return (changes || []).filter(c => readCurrent(c.key, c.statId) === c.after);
}

/** One line telling the AI how the attribute numbers read. */
export function attributeScaleLine(compact = true) {
    return compact
        ? `Attribute scale: ${HUMAN_AVERAGE} = ordinary person, below ${HUMAN_AVERAGE} = a weakness, ${HUMAN_PEAK} = human peak, above ${HUMAN_PEAK} = superhuman (max 100).`
        : `Attributes use a human scale: ${HUMAN_AVERAGE} is an ordinary person, anything below ${HUMAN_AVERAGE} is a weakness or flaw, ${HUMAN_PEAK} is the peak a human can reach, and values above ${HUMAN_PEAK} (up to 100) are superhuman.`;
}

/**
 * Builds the prompt section that hands the AI its stats.
 * Entries with `generate: true` are NPCs that have no stats yet: the AI is
 * asked to create every value for them, fitting who they are.
 * @param {Array<{displayName: string, isUser: boolean, stats: object[], current: object, generate?: boolean}>} entries
 * @param {{compact?: boolean, standalone?: boolean}} [options]
 * @returns {string} '' when there is nothing to send
 */
export function buildStatsPrompt(entries, { compact = true, standalone = false } = {}) {
    const list = (entries || [])
        .filter(e => e && e.displayName && Array.isArray(e.stats))
        .map(e => ({ ...e, stats: activeStats(e.stats) }))
        .filter(e => e.stats.length);
    if (!list.length) return '';

    const payload = {};
    const fixedLines = [];
    const bonusLines = [];
    const describe = new Map(); // description key -> line
    const toGenerate = [];
    let hasAttributes = false;
    const addDescription = (e, s) => {
        const descKey = s.id;
        // Compact prompts trust the AI with the well-known built-ins and only
        // explain the stats the user invented.
        if (describe.has(descKey) || !s.description || (compact && s.builtin)) return;
        const range = s.kind === 'state' ? '0-100%' : '1-100';
        describe.set(descKey, `- ${s.name}, ${range}: ${s.description}`);
    };
    for (const e of list) {
        const values = {};
        const fixed = [];
        if (e.generate) {
            toGenerate.push(e.displayName);
            for (const s of e.stats) {
                values[s.name] = 'X';
                if (s.kind === 'attribute') hasAttributes = true;
                addDescription(e, s);
            }
            payload[e.displayName] = values;
            continue;
        }
        const mods = e.modifiers || {};
        const bonus = [];
        const plainAttrs = []; // attribute values with no bonus, for the compact "all 10" form
        for (const s of e.stats) {
            // Compact prompts name built-in attributes by abbreviation (STR, DEX…).
            const label = compact && s.builtin !== false && s.abbr ? s.abbr : s.name;
            const v = e.current?.[s.id] ?? s.base;
            if (s.kind === 'attribute') hasAttributes = true;
            const m = s.kind === 'attribute' ? (mods[s.id]?.total || 0) : 0;
            if (m) {
                const from = (mods[s.id].parts || []).map(p => p.label).join(', ');
                bonus.push(`${s.abbr || s.name} ${m > 0 ? '+' : '−'}${Math.abs(m)}${from ? ` (${from})` : ''}`);
            }
            if (s.ai) {
                values[s.name] = v;
                addDescription(e, s);
            } else if (m) {
                const eff = clampStatValue(s, v + m);
                fixed.push(`${label} ${eff} (${v} ${m > 0 ? '+' : '−'} ${Math.abs(m)})`);
            } else {
                fixed.push(`${label} ${v}${s.kind === 'state' ? '%' : ''}`);
                if (s.kind === 'attribute') plainAttrs.push(v);
            }
        }
        // Every fixed stat is an attribute with the same value: say it once.
        if (compact && plainAttrs.length >= 4 && plainAttrs.length === fixed.length && plainAttrs.every(v => v === plainAttrs[0])) {
            fixed.splice(0, fixed.length, `all attributes ${plainAttrs[0]}`);
        }
        if (Object.keys(values).length) payload[e.displayName] = values;
        if (fixed.length) fixedLines.push(`- ${e.displayName}${e.isUser ? ' (player character)' : ''}: ${fixed.join(', ')}`);
        if (bonus.length) bonusLines.push(`- ${e.displayName}: ${bonus.join(', ')}`);
    }

    let out = '';
    if (Object.keys(payload).length) {
        // One line per character: a lot fewer tokens than indented JSON.
        const body = '"stats": {\n' + Object.entries(payload)
            .map(([name, vals]) => `    ${JSON.stringify(name)}: ${JSON.stringify(vals).replace(/,"/g, ', "').replace(/":/g, '": ')}`)
            .join(',\n') + '\n  }';
        if (standalone) {
            out += compact
                ? 'Start every reply with ONE JSON code block holding the character stats below, updated:\n'
                : 'At the start of every reply, attach ONE JSON code block with the character stats below, updated to reflect what happens:\n';
            out += '```json\n{\n  ' + body + '\n}\n```\n';
        } else {
            out += compact
                ? 'CHARACTER STATS: also put this "stats" key in the same tracker JSON object (current values shown):\n'
                : 'CHARACTER STATS: in the SAME unified tracker JSON object, also include this top-level "stats" key. These are the current values:\n';
            out += '```json\n  ' + body + '\n```\n';
        }
        out += compact
            ? 'Return every character and stat listed, as whole numbers (states are percentages). Change them realistically per what happens; keep them unchanged when nothing affects them.'
            : 'Return every character and stat listed above as whole numbers within their range (states are percentages from 0 to 100). Raise, lower or keep each value realistically based on what happens in the scene, the passage of time and logical consequences; keep it unchanged when nothing affects it. Do not add stats or characters that are not listed.';
        if (toGenerate.length) {
            out += compact
                ? `\nNEW: ${toGenerate.join(', ')} ${toGenerate.length === 1 ? 'has' : 'have'} no stats yet — replace every X with values that fit who they are (role, build, training, condition right now). This happens once.`
                : `\nNEW CHARACTERS: ${toGenerate.join(', ')} ${toGenerate.length === 1 ? 'has' : 'have'} no stats yet. Replace every X with a value that fits who they are — their role, build, training, age and current condition (a veteran soldier is strong and tough, a scholar is clever but frail, a wounded guard has low Health). This is done only once; afterwards their values are tracked like everyone else's.`;
        }
        if (hasAttributes) out += '\n' + attributeScaleLine(compact);
        if (describe.size) out += '\nWhat they mean:\n' + [...describe.values()].join('\n');
    }
    if (fixedLines.length) {
        out += (out ? '\n' : '');
        out += compact
            ? 'Fixed stats (read-only, never output them; let them shape what each character can do):\n'
            : 'Fixed stats — read-only. Do NOT output them, but let them shape what each character is capable of and how they act:\n';
        out += fixedLines.join('\n');
        if (hasAttributes && !Object.keys(payload).length) out += '\n' + attributeScaleLine(compact);
    }
    if (bonusLines.length) {
        out += (out ? '\n' : '');
        out += compact
            ? 'Attribute bonuses in effect (from equipped items and conditions; already counted — never add them to the values yourself):\n'
            : 'Attribute bonuses and maluses in effect right now, from equipped items and conditions. DES adds them automatically on top of the values above — never fold them into the attributes yourself:\n';
        out += bonusLines.join('\n');
    }
    return out.trim();
}
