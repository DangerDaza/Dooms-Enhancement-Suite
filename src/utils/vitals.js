/**
 * Vitals — the 0–100 bars on the Present Characters shelf (Project Short Fuse).
 *
 * Pure helpers over the per-character stats config that has shipped dormant
 * since the fork: `trackerConfig.presentCharacters.characterStats`. Nothing in
 * this file imports SillyTavern or DES state; every function takes the data
 * it works on, so the prompt, parser, storage and rendering code share one
 * reader and `tools/vitals-test.mjs` can exercise it in Node.
 *
 * Sheet shape. Stored key names are unchanged (presets and old blobs keep
 * loading); the fields marked "new" are additive and are filled in by
 * migrateVitalsConfig() on load and by vitalsConfig() on every read:
 *
 *   characterStats = {
 *     enabled: false,                  // master switch (existing)
 *     customStats: [                   // the sheet (existing key)
 *       { id, name, enabled,           //   existing
 *         color, icon, start, ai },    //   new: bar colour, emoji, value a new
 *     ],                               //   character starts at, "AI updates it"
 *     player: { enabled: true },       // new: the persona has vitals too
 *     showOnCards: true,               // new: bars on the card front
 *     maxBars: 3,                      // new: how many bars the front shows
 *     lowAt: 25,                       // new: at or below → warning colour
 *     persistInHistory: false,         // new: include in History Persistence
 *   }
 *
 * `ai: false` is a fixed vital: it is still asked for in the tracker JSON (so
 * its value rides along per swipe like everything else) and the AI is told
 * it is locked, but whatever comes back, the previous value is written over
 * it after parsing. Deterministic, no prompt dependence.
 */

/** The sheet a fresh install (or an install that never switched vitals on) gets. */
export const VITAL_PRESETS = Object.freeze([
    { id: 'health',  name: 'Health',  icon: '❤️', color: '#e5484d', start: 100, enabled: true },
    { id: 'energy',  name: 'Energy',  icon: '⚡', color: '#f5b301', start: 100, enabled: true },
    { id: 'satiety', name: 'Satiety', icon: '🍖', color: '#2fbf71', start: 80,  enabled: true },
    { id: 'stamina', name: 'Stamina', icon: '🏃', color: '#ff7a45', start: 100, enabled: true },
    { id: 'morale',  name: 'Morale',  icon: '🙂', color: '#4c8dff', start: 75,  enabled: true },
    { id: 'sanity',  name: 'Sanity',  icon: '🧠', color: '#20c997', start: 100, enabled: true },
    { id: 'arousal', name: 'Arousal', icon: '🔥', color: '#f06595', start: 0,   enabled: true },
    { id: 'hygiene', name: 'Hygiene', icon: '🧼', color: '#22b8cf', start: 100, enabled: false },
    { id: 'mana',    name: 'Mana',    icon: '✨', color: '#a66bff', start: 100, enabled: false },
]);

/** Colours handed to vitals the user adds, in order, when they pick none. */
export const EXTRA_VITAL_COLORS = Object.freeze([
    '#748ffc', '#94d82d', '#fab005', '#e599f7', '#63e6be', '#ffa94d', '#74c0fc', '#ff8787',
]);

export const LOW_VITAL_COLOR = '#e5484d';
export const MAX_VITALS = 24;

const CONFIG_DEFAULTS = Object.freeze({
    enabled: false,
    player: Object.freeze({ enabled: true }),
    showOnCards: true,
    maxBars: 3,
    lowAt: 25,
    persistInHistory: false,
});

/** A fresh, fully-populated sheet. */
export function defaultVitalsConfig() {
    return {
        enabled: CONFIG_DEFAULTS.enabled,
        customStats: VITAL_PRESETS.map(p => ({ ...p, ai: true })),
        player: { ...CONFIG_DEFAULTS.player },
        showOnCards: CONFIG_DEFAULTS.showOnCards,
        maxBars: CONFIG_DEFAULTS.maxBars,
        lowAt: CONFIG_DEFAULTS.lowAt,
        persistInHistory: CONFIG_DEFAULTS.persistInHistory,
    };
}

/** #rgb / #rrggbb only — anything else is ignored. */
export function isHexColor(v) {
    return typeof v === 'string' && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v);
}

/** Rounds and clamps into 0–100; non-numbers (and '80%') are handled; garbage gives null. */
export function clampVital(value) {
    const n = typeof value === 'string' ? Number(value.replace('%', '').trim()) : value;
    if (typeof n !== 'number' || !Number.isFinite(n)) return null;
    return Math.min(100, Math.max(0, Math.round(n)));
}

/** Slug used to build ids for vitals the user adds. */
export function vitalSlug(text) {
    return String(text || '')
        .toLowerCase()
        .normalize('NFKD').replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 32) || 'vital';
}

function presetFor(entry) {
    const id = typeof entry?.id === 'string' ? entry.id.toLowerCase() : '';
    const name = typeof entry?.name === 'string' ? entry.name.trim().toLowerCase() : '';
    return VITAL_PRESETS.find(p => p.id === id || p.name.toLowerCase() === name) || null;
}

/**
 * One sheet entry with every field present. Does not mutate `entry`.
 * `index` picks a fallback colour for user-added vitals with none.
 */
export function normalizeVitalDef(entry, index = 0) {
    const e = entry && typeof entry === 'object' ? entry : {};
    const preset = presetFor(e);
    const name = typeof e.name === 'string' && e.name.trim() ? e.name.trim().slice(0, 40) : (preset?.name || '');
    const id = typeof e.id === 'string' && e.id ? e.id : (preset?.id || vitalSlug(name));
    const start = clampVital(e.start);
    return {
        id,
        name,
        enabled: e.enabled !== false,
        color: isHexColor(e.color) ? e.color.toLowerCase() : (preset?.color || EXTRA_VITAL_COLORS[index % EXTRA_VITAL_COLORS.length]),
        icon: typeof e.icon === 'string' ? e.icon.slice(0, 4) : (preset?.icon || ''),
        start: start === null ? (preset ? preset.start : 100) : start,
        ai: e.ai !== false,
    };
}

/**
 * The sheet as every reader should see it: a normalised copy of
 * `trackerConfig.presentCharacters.characterStats` with defaults filled in.
 * Tolerates a missing or half-formed config (old blobs, presets saved before
 * these fields existed). Never mutates settings.
 * @param {object} settings - extensionSettings
 */
export function vitalsConfig(settings) {
    const raw = settings?.trackerConfig?.presentCharacters?.characterStats;
    const cs = raw && typeof raw === 'object' ? raw : {};
    const list = Array.isArray(cs.customStats) ? cs.customStats : [];
    const player = cs.player && typeof cs.player === 'object' ? cs.player : {};
    const maxBars = Number.isInteger(cs.maxBars) ? cs.maxBars : CONFIG_DEFAULTS.maxBars;
    const lowAt = clampVital(cs.lowAt);
    return {
        enabled: cs.enabled === true,
        customStats: list
            .map((e, i) => normalizeVitalDef(e, i))
            .filter(d => d.name),
        player: { enabled: player.enabled !== false },
        showOnCards: cs.showOnCards !== false,
        maxBars: Math.min(6, Math.max(1, maxBars)),
        lowAt: lowAt === null ? CONFIG_DEFAULTS.lowAt : lowAt,
        persistInHistory: cs.persistInHistory === true,
    };
}

/**
 * The vitals that are switched on, in sheet order. `all: true` includes the
 * switched-off ones (for the settings page).
 */
export function vitalDefs(settings, { all = false } = {}) {
    const defs = vitalsConfig(settings).customStats;
    return all ? defs : defs.filter(d => d.enabled);
}

/** Master switch AND at least one vital on. */
export function vitalsOn(settings) {
    const cfg = vitalsConfig(settings);
    return cfg.enabled && cfg.customStats.some(d => d.enabled);
}

/** Vitals on AND the persona included. */
export function playerVitalsOn(settings) {
    return vitalsOn(settings) && vitalsConfig(settings).player.enabled;
}

/** True when the stored list is the untouched pre-Short-Fuse default (Health + Arousal, no extra fields). */
function isLegacyDefaultList(list) {
    if (!Array.isArray(list)) return false;
    if (list.length === 0) return true;
    if (list.length !== 2) return false;
    const ids = list.map(e => (e && typeof e.id === 'string' ? e.id : '')).sort();
    if (ids[0] !== 'arousal' || ids[1] !== 'health') return false;
    return list.every(e => e && e.color === undefined && e.start === undefined && e.ai === undefined && e.icon === undefined);
}

/**
 * Additive migration for `trackerConfig.presentCharacters.characterStats`.
 * Mutates `trackerConfig` in place and returns true when anything changed, so
 * the caller can save once. Safe to run on every load.
 *
 * - A missing or malformed block becomes the default sheet.
 * - The old two-entry default (or the empty list the pre-fix migration wrote)
 *   on an install that never switched vitals on becomes the preset sheet. A
 *   list the user ever edited is left alone.
 * - Every entry gains colour, icon, start value and the AI flag.
 * - The new top-level fields are added when missing.
 */
export function migrateVitalsConfig(trackerConfig) {
    const pc = trackerConfig?.presentCharacters;
    if (!pc || typeof pc !== 'object') return false;
    let changed = false;
    if (!pc.characterStats || typeof pc.characterStats !== 'object' || Array.isArray(pc.characterStats)) {
        pc.characterStats = defaultVitalsConfig();
        return true;
    }
    const cs = pc.characterStats;
    if (!Array.isArray(cs.customStats)) {
        cs.customStats = [];
        changed = true;
    }
    if (cs.enabled !== true && isLegacyDefaultList(cs.customStats)) {
        cs.customStats = VITAL_PRESETS.map(p => ({ ...p, ai: true }));
        changed = true;
    }
    cs.customStats = cs.customStats.filter(e => e && typeof e === 'object');
    cs.customStats.forEach((entry, i) => {
        const full = normalizeVitalDef(entry, i);
        for (const key of ['id', 'name', 'enabled', 'color', 'icon', 'start', 'ai']) {
            if (entry[key] === undefined) {
                entry[key] = full[key];
                changed = true;
            }
        }
    });
    if (!cs.player || typeof cs.player !== 'object') {
        cs.player = { ...CONFIG_DEFAULTS.player };
        changed = true;
    } else if (cs.player.enabled === undefined) {
        cs.player.enabled = CONFIG_DEFAULTS.player.enabled;
        changed = true;
    }
    for (const key of ['showOnCards', 'maxBars', 'lowAt', 'persistInHistory']) {
        if (cs[key] === undefined) {
            cs[key] = CONFIG_DEFAULTS[key];
            changed = true;
        }
    }
    return changed;
}
