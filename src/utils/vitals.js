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
 *         color, icon, start, ai,      //   new: bar colour, emoji, value a new
 *         who, names,                  //   character starts at, "AI updates it";
 *         show, about, rungs,          //   who the vital is for (D231), how it
 *         limit },                     //   is shown and its levels (D232), what
 *     ],                               //   happens at a mark (D233), below
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
 *
 * Who a vital is for (docs/long-shot-plan.md D231). A sheet used to be one
 * list every character carried, the persona included. `who` scopes a vital:
 *   'all'     everyone (the persona too, while "Your character too" is on)
 *   'player'  the character being played, whoever that is
 *   'others'  everyone but the character being played
 *   'named'   only the characters in `names` ("Roxy", "Eli Vega"); one of
 *             them is the player when the name is one the player goes by
 * so Eli's Edge sits on Eli's card and nobody else's, in whichever story he
 * is played or met. An entry without `who` is 'all', as before.
 *
 * How a vital is shown, and its levels (D232). The value stays 0–100 for
 * every vital; what differs is what a card makes of it:
 *   show   'bar' (as before), 'percent' (the number: "Edge 62%"), or
 *          'level' (the name of the level the value is on: "Interested")
 *   about  one line told to the AI: what the vital measures and what moves it
 *   rungs  the named levels, lowest first: [{ at, label, note }]; a value is
 *          on the highest rung whose `at` it has reached. The AI is told
 *          the levels and what each means, and moves the value; the level
 *          follows from it.
 * An entry with none of these is a bar with no levels, as before.
 *
 * What happens at a mark (D233). `limit` is one mark on a vital and what a
 * reply that carries the value to it sets off:
 *   when   'off' (as before), 'rise' (the value rises to `at` or past it)
 *          or 'fall' (falls to `at` or under it)
 *   does   'note': the narrator is told `note` once, in the next reply's
 *          prompt; 'roll': a d20 is rolled against `dc` there and then (an
 *          attribute's modifier riding on it when `attr` names one), the
 *          narrator is told `pass` or `fail` as final, and the value is
 *          set to `passTo` / `failTo` when those are given.
 * This file finds the crossings (limitsCrossed); the roll and the words
 * are src/utils/vitalLimits.js, the lifecycle
 * src/systems/features/vitalLimits.js.
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

/** When a vital's mark is reached, and what reaching it does (D233). */
export const VITAL_LIMIT_WHEN = Object.freeze(['off', 'rise', 'fall']);
export const VITAL_LIMIT_DOES = Object.freeze(['note', 'roll']);
export const DEFAULT_LIMIT_DC = 12;

/** How a vital can be shown (D232). */
export const VITAL_SHOWS = Object.freeze(['bar', 'percent', 'level']);
export const MAX_VITAL_RUNGS = 8;

/** Who a vital can be for (D231), in the order the settings page lists them. */
export const VITAL_WHO = Object.freeze(['all', 'player', 'others', 'named']);
export const MAX_VITAL_NAMES = 12;

// The names the player goes by in the chat in front: the Workshop user
// character being played and the persona's own name. Handed in once
// (index.js) so this file stays free of SillyTavern; [] until then.
let playedNamesSource = () => [];

/** Sets where the names the player goes by come from. */
export function setPlayedNamesSource(fn) {
    playedNamesSource = typeof fn === 'function' ? fn : () => [];
}

/** The names the player goes by, each once; [] when nothing says. */
export function getPlayedNames() {
    let raw = [];
    try { raw = playedNamesSource(); } catch (e) { raw = []; }
    return cleanNames(raw);
}

/** A list of names made safe: strings, trimmed, each once (whatever the case), at most MAX_VITAL_NAMES. */
function cleanNames(list) {
    const out = [];
    for (const n of Array.isArray(list) ? list : []) {
        const t = typeof n === 'string' ? n.trim().slice(0, 60) : '';
        if (t && !out.some(x => x.toLowerCase() === t.toLowerCase())) out.push(t);
        if (out.length >= MAX_VITAL_NAMES) break;
    }
    return out;
}

/** "Roxy, Eli Vega" as the names it lists (the settings page's one text box). */
export function parseVitalNames(text) {
    return cleanNames(String(text ?? '').split(/[,;\n]+/));
}

const nameWords = (s) => String(s ?? '').toLowerCase()
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);

/**
 * Whether two names are one character: the same words, or every word of
 * the shorter found in the longer, so the "Roxy" a sheet names is the
 * "Roxy Vance" the AI lists.
 */
export function sameWho(a, b) {
    const x = nameWords(a);
    const y = nameWords(b);
    if (!x.length || !y.length) return false;
    const [few, many] = x.length <= y.length ? [x, y] : [y, x];
    return few.every(w => many.includes(w));
}

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
        who: VITAL_WHO.includes(e.who) ? e.who : 'all',
        names: cleanNames(e.names),
        show: VITAL_SHOWS.includes(e.show) ? e.show : 'bar',
        about: oneLine(e.about, 240),
        rungs: normalizeRungs(e.rungs),
        limit: normalizeLimit(e.limit),
    };
}

/**
 * A vital's mark made safe (D233), every field present: off unless it says
 * when, at the top for a rise and the bottom for a fall unless it says
 * where, a note unless it says a roll.
 */
export function normalizeLimit(raw) {
    const l = raw && typeof raw === 'object' ? raw : {};
    const when = VITAL_LIMIT_WHEN.includes(l.when) ? l.when : 'off';
    const at = clampVital(l.at);
    const dc = l.dc === null || l.dc === undefined || l.dc === '' ? NaN : Number(l.dc);
    const to = (v) => (v === null || v === undefined || v === '' ? null : clampVital(v));
    return {
        when,
        at: at === null ? (when === 'fall' ? 0 : 100) : at,
        does: VITAL_LIMIT_DOES.includes(l.does) ? l.does : 'note',
        note: oneLine(l.note, 300),
        dc: Number.isFinite(dc) ? Math.min(40, Math.max(1, Math.round(dc))) : DEFAULT_LIMIT_DC,
        attr: typeof l.attr === 'string' ? l.attr.trim().slice(0, 40) : '',
        pass: oneLine(l.pass, 300),
        fail: oneLine(l.fail, 300),
        passTo: to(l.passTo),
        failTo: to(l.failTo),
    };
}

/**
 * Whether a value moving from `prev` to `next` reaches the vital's mark
 * (D233): it was short of the mark and is now at it or past it. A value
 * that stays past the mark does not reach it again; one with no previous
 * value came from the vital's start.
 */
export function limitCrossed(def, prev, next) {
    const l = def && def.limit;
    if (!l || l.when === 'off' || typeof next !== 'number') return false;
    const before = typeof prev === 'number' ? prev : def.start;
    return l.when === 'fall' ? (before > l.at && next <= l.at) : (before < l.at && next >= l.at);
}

const oneLine = (v, max) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');

/**
 * A vital's levels made safe (D232): each with a name and the value it
 * starts at, lowest first, one level a value, at most MAX_VITAL_RUNGS. A
 * rung with no name, or no readable value, is dropped.
 * @returns {Array<{ at: number, label: string, note: string }>}
 */
export function normalizeRungs(list) {
    const out = [];
    for (const r of Array.isArray(list) ? list : []) {
        if (!r || typeof r !== 'object') continue;
        const label = oneLine(r.label, 30);
        const at = clampVital(r.at);
        if (!label || at === null || out.some(x => x.at === at)) continue;
        out.push({ at, label, note: oneLine(r.note, 200) });
    }
    out.sort((a, b) => a.at - b.at);
    return out.slice(0, MAX_VITAL_RUNGS);
}

/** Levels spread evenly over 0–100 from their names alone: four names start at 0, 25, 50 and 75. */
export function evenRungs(labels) {
    const names = [];
    for (const l of Array.isArray(labels) ? labels : []) { const t = oneLine(l, 30); if (t) names.push(t); }
    const list = names.slice(0, MAX_VITAL_RUNGS);
    return normalizeRungs(list.map((label, i) => ({ at: Math.round(i * 100 / list.length), label })));
}

/**
 * The level a value is on (D232): the highest rung it has reached, with
 * where the rung sits (`index` of `count`) and the values it covers (`at`
 * to `upTo`). null when the vital has no levels, or the value is under the
 * lowest.
 */
export function rungOf(def, value) {
    const rungs = def && Array.isArray(def.rungs) ? def.rungs : [];
    const v = clampVital(value);
    if (!rungs.length || v === null) return null;
    let i = -1;
    for (let k = 0; k < rungs.length; k++) if (rungs[k].at <= v) i = k;
    if (i < 0) return null;
    return {
        index: i,
        count: rungs.length,
        at: rungs[i].at,
        upTo: i + 1 < rungs.length ? rungs[i + 1].at - 1 : 100,
        label: rungs[i].label,
        note: rungs[i].note,
    };
}

/** What a card says for a value, by how the vital is shown (D232): the level's name for 'level' (when it is on one), "62%" otherwise; '' for no value. */
export function vitalText(def, value) {
    const v = clampVital(value);
    if (v === null) return '';
    if (def && def.show === 'level') {
        const rung = rungOf(def, v);
        if (rung) return rung.label;
    }
    return `${v}%`;
}

/** A vital in full, for a tooltip: "Edge 62%", "Attention: Interested (55%)". */
export function vitalTip(def, value) {
    const v = clampVital(value);
    if (v === null) return def?.name || '';
    const rung = rungOf(def, v);
    return rung ? `${def.name}: ${rung.label} (${v}%)` : `${def.name} ${v}%`;
}

/**
 * What the AI is told about the vitals that say more than a name (D232):
 * one line each, what it measures and its levels by value with what each
 * means. [] when no vital has either.
 */
export function vitalGuideLines(defs) {
    const out = [];
    for (const d of defs || []) {
        const rungs = Array.isArray(d.rungs) ? d.rungs : [];
        if (!d.about && !rungs.length) continue;
        let line = `"${d.name}"`;
        if (d.about) line += `: ${d.about.replace(/[.\s]+$/, '')}.`;
        if (rungs.length) {
            const levels = rungs.map((r, i) => {
                const upTo = i + 1 < rungs.length ? rungs[i + 1].at - 1 : 100;
                const span = upTo > r.at ? `${r.at}-${upTo}` : `${r.at}`;
                return `${span} "${r.label}"${r.note ? ` (${r.note.replace(/[.\s]+$/, '')})` : ''}`;
            });
            line += `${d.about ? ' Its' : ' has'} levels by value: ${levels.join('; ')}.`;
        }
        out.push(line);
    }
    return out;
}

/**
 * Whether a vital is one a character carries (D231). `who` says which
 * character: `{ name }` for one the tracker lists, `{ isPlayer: true }` for
 * the persona. `shared: false` is "Your character too" switched off: the
 * vitals for everyone stop at the persona, while one meant for the player
 * (by 'player', or by name) stays. `playerNames` overrides the names the
 * player goes by (tests; getPlayedNames() otherwise).
 * @param {object} def - a normalised sheet entry
 * @param {{ name?: string, isPlayer?: boolean, shared?: boolean, playerNames?: string[] }} [who]
 */
export function vitalAppliesTo(def, who = {}) {
    const { name = '', isPlayer = false, shared = true } = who || {};
    const kind = def && VITAL_WHO.includes(def.who) ? def.who : 'all';
    if (kind === 'player') return !!isPlayer;
    if (kind === 'others') return !isPlayer;
    if (kind === 'named') {
        const list = Array.isArray(def.names) ? def.names : [];
        if (!isPlayer) return list.some(n => sameWho(n, name));
        const mine = Array.isArray(who.playerNames) ? who.playerNames : getPlayedNames();
        return mine.some(m => list.some(n => sameWho(n, m)));
    }
    return isPlayer ? shared !== false : true;
}

/** The vitals of `defs` one character carries, in sheet order (D231). The same array back when all of them are. */
export function vitalsFor(defs, who) {
    const list = Array.isArray(defs) ? defs : [];
    const mine = list.filter(d => vitalAppliesTo(d, who));
    return mine.length === list.length ? list : mine;
}

/**
 * The vitals the tracker's sample character shows (D231): the ones every
 * listed character carries. A vital for named characters is asked for in a
 * sentence of its own (namedVitalNotes), one for the player in "player".
 */
export function castVitalDefs(defs) {
    return (defs || []).filter(d => d.who !== 'player' && d.who !== 'named');
}

/**
 * The vitals only named characters carry, each with the names the tracker
 * can list (the player's own left out: theirs rides in "player"): what the
 * guidance spells out, one sentence a vital. [] when there is none.
 * @returns {Array<{ name: string, names: string[] }>}
 */
export function namedVitalNotes(defs, playerNames) {
    const mine = Array.isArray(playerNames) ? playerNames : getPlayedNames();
    const out = [];
    for (const d of defs || []) {
        if (d.who !== 'named') continue;
        const names = (d.names || []).filter(n => !mine.some(m => sameWho(n, m)));
        if (names.length) out.push({ name: d.name, names });
    }
    return out;
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

/**
 * The vitals the persona carries (D231): the ones for everyone while "Your
 * character too" is on, and the ones meant for the player either way. []
 * when vitals are off.
 */
export function playerVitalDefs(settings, playerNames) {
    const cfg = vitalsConfig(settings);
    if (!cfg.enabled) return [];
    const who = { isPlayer: true, shared: cfg.player.enabled };
    if (Array.isArray(playerNames)) who.playerNames = playerNames;
    return cfg.customStats.filter(d => d.enabled && vitalAppliesTo(d, who));
}

/** Vitals on AND the persona carries at least one. */
export function playerVitalsOn(settings, playerNames) {
    return playerVitalDefs(settings, playerNames).length > 0;
}

/** Case-insensitive lookup of a sheet entry by the name the AI uses (or its id). */
export function findVitalDef(defs, name) {
    const n = String(name ?? '').trim().toLowerCase();
    if (!n) return null;
    return (defs || []).find(d => d.name.toLowerCase() === n || d.id === n) || null;
}

/** Whether any vital on the sheet is fixed (the AI may not change it). */
export function hasFixedVitals(defs) {
    return (defs || []).some(d => d.ai === false);
}

/**
 * Marks fixed vitals as locked in a copy of tracker data, for the
 * previous-tracker example the AI is shown. `data` is the parsed characters
 * tracker (an array or `{ characters: [...] }`) or a parsed player block
 * (`{ stats }`). Array-shaped stats gain `locked: true` on the entry; the
 * object shape becomes `{ value, locked: true }`, the form the lock sentence
 * in the prompt already describes. Returns `data` itself when nothing on the
 * sheet is fixed.
 */
export function markFixedVitals(data, defs) {
    const fixed = (defs || []).filter(d => d.ai === false);
    if (!fixed.length || !data || typeof data !== 'object') return data;
    const isFixed = (name) => !!findVitalDef(fixed, name);
    const markStats = (stats) => {
        if (Array.isArray(stats)) {
            return stats.map(s => (s && typeof s === 'object' && isFixed(s.name)) ? { ...s, locked: true } : s);
        }
        if (stats && typeof stats === 'object') {
            const out = {};
            for (const [k, v] of Object.entries(stats)) {
                if (!isFixed(k)) { out[k] = v; continue; }
                out[k] = (v && typeof v === 'object') ? { ...v, locked: true } : { value: v, locked: true };
            }
            return out;
        }
        return stats;
    };
    if (Array.isArray(data)) {
        return data.map(c => (c && typeof c === 'object' && c.stats !== undefined) ? { ...c, stats: markStats(c.stats) } : c);
    }
    if (Array.isArray(data.characters)) {
        return { ...data, characters: markFixedVitals(data.characters, defs) };
    }
    if (data.stats !== undefined) {
        return { ...data, stats: markStats(data.stats) };
    }
    return data;
}

/**
 * The data without its vitals: what the prompt sends while vitals are off,
 * so stats a chat stored while they were on are neither shown to the AI nor
 * asked for again. Characters as an array or under `characters`, a single
 * block (the player), either stats shape. Never mutates; hands the same
 * reference back when there was nothing to strip.
 */
export function stripVitals(data) {
    if (!data || typeof data !== 'object') return data;
    if (Array.isArray(data)) {
        let changed = false;
        const out = data.map(c => {
            if (!c || typeof c !== 'object' || c.stats === undefined) return c;
            changed = true;
            const { stats, ...rest } = c;
            return rest;
        });
        return changed ? out : data;
    }
    if (Array.isArray(data.characters)) {
        const bare = stripVitals(data.characters);
        return bare === data.characters ? data : { ...data, characters: bare };
    }
    if (data.stats !== undefined) {
        const { stats, ...rest } = data;
        return rest;
    }
    return data;
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

// ─── Values ─────────────────────────────────────────────────────────────────
//
// A character's vitals live in the `stats` field of its tracker object. The
// AI is asked for the array shape, [{ name, value }], and that is what DES
// writes back; the object shape ({ Health: 80 } or { Health: { value: 80 } })
// is read for old data and for models that drift.

function unwrapValue(v) {
    if (v && typeof v === 'object' && !Array.isArray(v) && 'value' in v) return unwrapValue(v.value);
    return v;
}

/**
 * The vitals a stats field holds, keyed by sheet name: `{ Health: 72 }`.
 * Only vitals on the sheet are read; anything else the AI wrote is dropped.
 * @param {*} statsField - array or object shape, or nothing
 * @param {Array<object>} defs - vitalDefs()
 * @returns {Object.<string, number>}
 */
export function readVitals(statsField, defs) {
    const out = {};
    if (!statsField || typeof statsField !== 'object') return out;
    const put = (name, raw) => {
        const def = findVitalDef(defs, name);
        if (!def) return;
        const v = clampVital(unwrapValue(raw));
        if (v !== null) out[def.name] = v;
    };
    if (Array.isArray(statsField)) {
        for (const entry of statsField) {
            if (entry && typeof entry === 'object') put(entry.name, entry.value);
        }
    } else {
        for (const [name, raw] of Object.entries(statsField)) put(name, raw);
    }
    return out;
}

/** The array shape the AI uses, in sheet order, for the vitals present in `map`. */
export function toStatsArray(map, defs) {
    const out = [];
    for (const def of defs) {
        if (map && typeof map[def.name] === 'number') out.push({ name: def.name, value: map[def.name] });
    }
    return out;
}

/**
 * What a character's vitals become after a reply: for every vital on the
 * sheet, a fixed one (ai: false) keeps its previous value, a free one takes
 * the AI's, and a vital with no value yet starts at the sheet's start value.
 * @returns {Object.<string, number>} a value for every enabled vital
 */
export function resolveVitals(nextMap, prevMap, defs) {
    const out = {};
    for (const def of defs) {
        const next = nextMap ? nextMap[def.name] : undefined;
        const prev = prevMap ? prevMap[def.name] : undefined;
        if (def.ai === false) {
            out[def.name] = typeof prev === 'number' ? prev : (typeof next === 'number' ? next : def.start);
        } else {
            out[def.name] = typeof next === 'number' ? next : (typeof prev === 'number' ? prev : def.start);
        }
    }
    return out;
}

function parseLoose(json) {
    if (json === null || json === undefined || json === '') return null;
    if (typeof json !== 'string') return json;
    try { return JSON.parse(json); } catch (e) { return null; }
}

function characterList(parsed) {
    if (Array.isArray(parsed)) return parsed;
    if (parsed && Array.isArray(parsed.characters)) return parsed.characters;
    return null;
}

/**
 * Normalises the vitals in a fresh characters tracker against the one the
 * AI was shown (committed data): fixed vitals keep their value, missing ones
 * are seeded, both shapes become the array shape, and only the sheet's
 * vitals survive, each character keeping the ones it carries (D231).
 * Characters are matched by name, case-insensitively.
 * Returns the new JSON string, or the input untouched when it is not JSON.
 * @param {string|object} nextJson
 * @param {string|object|null} prevJson
 * @param {Array<object>} defs
 */
export function applyVitalsToCharacters(nextJson, prevJson, defs) {
    const parsed = parseLoose(nextJson);
    const chars = characterList(parsed);
    if (!chars) return nextJson;
    const prevByName = new Map();
    for (const c of characterList(parseLoose(prevJson)) || []) {
        if (c && typeof c.name === 'string') prevByName.set(c.name.trim().toLowerCase(), c);
    }
    for (const c of chars) {
        if (!c || typeof c !== 'object') continue;
        const prev = typeof c.name === 'string' ? prevByName.get(c.name.trim().toLowerCase()) : null;
        // Only the vitals this character carries (D231); one with none carries no "stats".
        const mine = vitalsFor(defs, { name: typeof c.name === 'string' ? c.name : '' });
        if (mine.length) c.stats = toStatsArray(resolveVitals(readVitals(c.stats, mine), readVitals(prev?.stats, mine), mine), mine);
        else delete c.stats;
    }
    return typeof nextJson === 'string' ? JSON.stringify(parsed) : parsed;
}

/**
 * The persona's block after a reply, always as a JSON string `{ stats: [...] }`:
 * the AI's values where it gave them, the previous values for fixed vitals,
 * the start values for the rest. A missing or malformed block still yields
 * a seeded one, so the persona's bars never sit empty. `defs` are the
 * persona's own (playerVitalDefs).
 */
export function applyVitalsToPlayer(nextJson, prevJson, defs) {
    const next = parseLoose(nextJson);
    const prev = parseLoose(prevJson);
    const nextStats = next && typeof next === 'object' ? next.stats : undefined;
    const prevStats = prev && typeof prev === 'object' ? prev.stats : undefined;
    const base = next && typeof next === 'object' && !Array.isArray(next) ? { ...next } : {};
    base.stats = toStatsArray(resolveVitals(readVitals(nextStats, defs), readVitals(prevStats, defs), defs), defs);
    return JSON.stringify(base);
}

/**
 * The marks a reply carried a value to (D233), characters first and the
 * persona last, each in sheet order. The data is the tracker's, before and
 * after: strings or parsed, characters as an array or under `characters`,
 * the persona's block as `{ stats }`. Characters are matched by name.
 * @param {{ defs?: object[], prevChars?: *, nextChars?: *, playerDefs?: object[], prevPlayer?: *, nextPlayer?: *, playerName?: string }} p
 * @returns {Array<{ def: object, who: string, isPlayer: boolean, prev: number, next: number }>}
 */
export function limitsCrossed({ defs = [], prevChars = null, nextChars = null, playerDefs = [], prevPlayer = null, nextPlayer = null, playerName = '' } = {}) {
    const out = [];
    const marked = (list) => (list || []).some(d => d.limit && d.limit.when !== 'off');
    if (marked(defs)) {
        const prevByName = new Map();
        for (const c of characterList(parseLoose(prevChars)) || []) {
            if (c && typeof c.name === 'string') prevByName.set(c.name.trim().toLowerCase(), c);
        }
        for (const c of characterList(parseLoose(nextChars)) || []) {
            if (!c || typeof c !== 'object' || typeof c.name !== 'string' || !c.name.trim()) continue;
            const mine = vitalsFor(defs, { name: c.name });
            if (!marked(mine)) continue;
            const next = readVitals(c.stats, mine);
            const prev = readVitals(prevByName.get(c.name.trim().toLowerCase())?.stats, mine);
            for (const d of mine) {
                if (limitCrossed(d, prev[d.name], next[d.name])) {
                    out.push({ def: d, who: c.name.trim(), isPlayer: false, prev: typeof prev[d.name] === 'number' ? prev[d.name] : d.start, next: next[d.name] });
                }
            }
        }
    }
    if (marked(playerDefs)) {
        const nextBlock = parseLoose(nextPlayer);
        const prevBlock = parseLoose(prevPlayer);
        const next = readVitals(nextBlock && typeof nextBlock === 'object' ? nextBlock.stats : null, playerDefs);
        const prev = readVitals(prevBlock && typeof prevBlock === 'object' ? prevBlock.stats : null, playerDefs);
        for (const d of playerDefs) {
            if (limitCrossed(d, prev[d.name], next[d.name])) {
                out.push({ def: d, who: String(playerName || '').trim() || 'The player', isPlayer: true, prev: typeof prev[d.name] === 'number' ? prev[d.name] : d.start, next: next[d.name] });
            }
        }
    }
    return out;
}

/**
 * Sets one vital's value in tracker data (D233: the value a roll leaves it
 * at): a character's by name in the characters data, or the persona's in
 * its block. Strings come back as strings. The input untouched when the
 * character or the vital is not there.
 * @param {string|object} json
 * @param {{ who?: string, isPlayer?: boolean, vital: string, value: number }} p
 */
export function setVitalValue(json, { who = '', isPlayer = false, vital = '', value } = {}) {
    const parsed = parseLoose(json);
    const v = clampVital(value);
    if (!parsed || typeof parsed !== 'object' || v === null) return json;
    const want = String(vital || '').trim().toLowerCase();
    const write = (holder) => {
        if (!holder || typeof holder !== 'object' || !Array.isArray(holder.stats)) return false;
        const entry = holder.stats.find(s => s && typeof s.name === 'string' && s.name.trim().toLowerCase() === want);
        if (!entry) return false;
        entry.value = v;
        return true;
    };
    let done = false;
    if (isPlayer) {
        done = write(parsed);
    } else {
        const name = String(who || '').trim().toLowerCase();
        const c = (characterList(parsed) || []).find(x => x && typeof x.name === 'string' && x.name.trim().toLowerCase() === name);
        done = write(c);
    }
    if (!done) return json;
    return typeof json === 'string' ? JSON.stringify(parsed) : parsed;
}

/**
 * Whether a value is low enough to warn of: at or below `lowAt`. Not for a
 * vital whose mark is reached on a rise (D233): what it warns of is at the
 * top, and a low Edge is the good news.
 */
export function vitalIsLow(def, value, lowAt) {
    const v = clampVital(value);
    if (v === null || typeof lowAt !== 'number' || v > lowAt) return false;
    return !(def && def.limit && def.limit.when === 'rise');
}

/** The colour a bar shows: the vital's own, or the warning colour when the value is low (vitalIsLow). */
export function vitalColor(def, value, lowAt) {
    if (vitalIsLow(def, value, lowAt)) return LOW_VITAL_COLOR;
    return def?.color || EXTRA_VITAL_COLORS[0];
}

/** "Health 72%, Energy 50%" for the vitals in `map`, in sheet order; one with levels says the level it is on: "Attention 55% (Interested)". */
export function formatVitalsLine(map, defs) {
    return defs
        .filter(d => map && typeof map[d.name] === 'number')
        .map(d => {
            const rung = rungOf(d, map[d.name]);
            return `${d.name} ${map[d.name]}%${rung ? ` (${rung.label})` : ''}`;
        })
        .join(', ');
}
