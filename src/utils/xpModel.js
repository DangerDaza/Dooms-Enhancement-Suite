/**
 * Experience & levels — pure logic (no SillyTavern imports, testable in node).
 *
 * A progress record, one per character per campaign:
 *   { level, xp, points, spent: {statId: n}, party, levelSet, log: [entry] }
 *   - xp is the running total; level never drops by itself.
 *   - Going from level L to L+1 costs L × xpPerLevel (100 → lv 2, 200 more → lv 3…).
 *   - Each level gained gives pointsPerLevel attribute points to assign.
 *   - levelSet: 'ai' or 'user' once the level was given (NPCs start without).
 *   - levelAsk: true when the AI should give the level again (stats regenerated).
 *   - log entry: { id, amount, reason, source: 'ai'|'quest'|'user', at, level }
 *
 * The AI never picks an amount: it names a size (small / medium / large /
 * epic) and the size is turned into XP with the user's table.
 */

export const XP_SIZES = ['small', 'medium', 'large', 'epic'];
export const DEFAULT_XP_TIERS = { small: 10, medium: 25, large: 50, epic: 100 };
export const DEFAULT_XP_PER_LEVEL = 100;
export const DEFAULT_POINTS_PER_LEVEL = 3;
export const MAX_LEVEL = 100;
export const MAX_XP_AWARD = 100000;
export const LOG_LIMIT = 60;

const SIZE_WORDS = {
    small: 'small', minor: 'small', tiny: 'small', little: 'small', low: 'small', trivial: 'small',
    medium: 'medium', moderate: 'medium', normal: 'medium', average: 'medium', notable: 'medium', mid: 'medium',
    large: 'large', big: 'large', major: 'large', great: 'large', high: 'large', significant: 'large',
    epic: 'epic', legendary: 'epic', huge: 'epic', massive: 'epic', heroic: 'epic', enormous: 'epic',
};

function int(v, fallback = 0) {
    const n = typeof v === 'string' ? parseFloat(v) : v;
    return Number.isFinite(n) ? Math.round(n) : fallback;
}

/** The size table with the user's amounts (each 1–MAX_XP_AWARD). */
export function resolveTiers(custom) {
    const out = { ...DEFAULT_XP_TIERS };
    if (custom && typeof custom === 'object') {
        for (const s of XP_SIZES) {
            const n = int(custom[s], NaN);
            if (Number.isFinite(n) && n > 0) out[s] = Math.min(n, MAX_XP_AWARD);
        }
    }
    return out;
}

export function clampPerLevel(v) {
    const n = int(v, DEFAULT_XP_PER_LEVEL);
    return Math.min(Math.max(n, 1), 100000);
}

export function clampPointsPerLevel(v) {
    const n = int(v, DEFAULT_POINTS_PER_LEVEL);
    return Math.min(Math.max(n, 0), 50);
}

export function clampLevel(v) {
    const n = int(v, 1);
    return Math.min(Math.max(n, 1), MAX_LEVEL);
}

/** Total XP needed to be at `level` (level 1 = 0). */
export function xpToReach(level, perLevel = DEFAULT_XP_PER_LEVEL) {
    const l = clampLevel(level);
    return perLevel * (l - 1) * l / 2;
}

/** The level a running total of XP is worth. */
export function levelForXp(xp, perLevel = DEFAULT_XP_PER_LEVEL) {
    let level = 1;
    while (level < MAX_LEVEL && xpToReach(level + 1, perLevel) <= xp) level++;
    return level;
}

/** A clean record from whatever was stored (missing → level 1, nothing earned). */
export function normalizeRecord(raw) {
    const r = raw && typeof raw === 'object' ? raw : {};
    const spent = {};
    if (r.spent && typeof r.spent === 'object') {
        for (const [k, v] of Object.entries(r.spent)) {
            const n = int(v, 0);
            if (n > 0) spent[k] = n;
        }
    }
    return {
        level: clampLevel(r.level ?? 1),
        xp: Math.max(0, int(r.xp, 0)),
        points: Math.max(0, int(r.points, 0)),
        spent,
        party: r.party === true,
        levelSet: r.levelSet === 'ai' || r.levelSet === 'user' ? r.levelSet : null,
        levelAsk: r.levelAsk === true,
        log: Array.isArray(r.log) ? r.log.filter(e => e && typeof e === 'object' && Number.isFinite(e.amount)) : [],
    };
}

/** Where the character stands inside their level: { level, into, needed, pct }. */
export function levelProgress(record, perLevel = DEFAULT_XP_PER_LEVEL) {
    const r = normalizeRecord(record);
    const start = xpToReach(r.level, perLevel);
    const needed = r.level * perLevel;
    const into = Math.min(Math.max(r.xp - start, 0), needed);
    return { level: r.level, xp: r.xp, into, needed, pct: r.level >= MAX_LEVEL ? 100 : Math.round(into / needed * 100) };
}

let idSeq = 0;
function newId() {
    idSeq = (idSeq + 1) % 1e6;
    return `xp_${Date.now().toString(36)}_${idSeq.toString(36)}`;
}

/**
 * Adds (or, negative, takes away) XP. Levels gained give points; the level
 * never drops. Returns { record, levelsGained, pointsGained }.
 */
export function awardXp(record, amount, {
    reason = '', source = 'ai', perLevel = DEFAULT_XP_PER_LEVEL, pointsPerLevel = DEFAULT_POINTS_PER_LEVEL, now = Date.now(),
} = {}) {
    const r = normalizeRecord(record);
    const n = Math.max(-MAX_XP_AWARD, Math.min(MAX_XP_AWARD, int(amount, 0)));
    if (!n) return { record: r, levelsGained: 0, pointsGained: 0 };
    r.xp = Math.max(0, r.xp + n);
    const newLevel = Math.max(r.level, levelForXp(r.xp, perLevel));
    const levelsGained = newLevel - r.level;
    const pointsGained = levelsGained * pointsPerLevel;
    r.level = newLevel;
    r.points += pointsGained;
    r.log.push({
        id: newId(),
        amount: n,
        reason: String(reason || '').trim().slice(0, 120),
        source,
        at: now,
        level: levelsGained ? newLevel : undefined,
    });
    if (r.log.length > LOG_LIMIT) r.log.splice(0, r.log.length - LOG_LIMIT);
    return { record: r, levelsGained, pointsGained };
}

/** Sets the level directly; XP moves to the start of that level. */
export function setRecordLevel(record, level, { perLevel = DEFAULT_XP_PER_LEVEL, by = 'user' } = {}) {
    const r = normalizeRecord(record);
    r.level = clampLevel(level);
    r.xp = xpToReach(r.level, perLevel);
    r.levelSet = by === 'ai' ? 'ai' : 'user';
    r.levelAsk = false;
    return r;
}

/** Turns an AI "size" (word or number) into one of XP_SIZES, or null. */
export function sizeFromAI(value, tiers = DEFAULT_XP_TIERS) {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
        // A number: the closest size by amount.
        let best = null;
        for (const s of XP_SIZES) {
            if (!best || Math.abs(tiers[s] - value) < Math.abs(tiers[best] - value)) best = s;
        }
        return best;
    }
    if (typeof value !== 'string') return null;
    const words = value.toLowerCase().match(/[a-z]+/g) || [];
    for (const w of words) if (SIZE_WORDS[w]) return SIZE_WORDS[w];
    const num = parseFloat(value);
    return Number.isFinite(num) ? sizeFromAI(num, tiers) : null;
}

function awardFromAny(raw, tiers) {
    if (raw === null || raw === undefined) return null;
    if (typeof raw === 'number') {
        const size = sizeFromAI(raw, tiers);
        return size ? { size, reason: '' } : null;
    }
    if (typeof raw === 'string') {
        const text = raw.trim();
        if (!text) return null;
        // "medium: beat the bandits", "large - rescued the girl", "small"
        const m = text.match(/^\s*([a-z]+|\d+)\s*(?:xp)?\s*[:\-–—,(]\s*(.+?)\)?\s*$/i);
        const size = sizeFromAI(m ? m[1] : text, tiers);
        if (!size) return null;
        return { size, reason: m ? m[2] : '' };
    }
    if (typeof raw !== 'object') return null;
    const sizeRaw = raw.size ?? raw.tier ?? raw.amount ?? raw.xp ?? raw.value ?? raw.award;
    const size = sizeFromAI(sizeRaw, tiers);
    if (!size) return null;
    const reason = raw.reason ?? raw.for ?? raw.why ?? raw.deed ?? raw.description ?? raw.desc ?? raw.quest ?? '';
    return { size, reason: typeof reason === 'string' ? reason : '' };
}

/**
 * The AI's "xp" value → one award { size, amount, reason }, or null.
 * Accepts an object, a list (the biggest wins — one award per reply),
 * "size: reason" strings and numbers (mapped to the closest size).
 */
export function normalizeAIXp(raw, customTiers) {
    const tiers = resolveTiers(customTiers);
    let value = raw;
    if (typeof value === 'string') {
        const t = value.trim();
        if (t.startsWith('{') || t.startsWith('[')) {
            try { value = JSON.parse(t); } catch (e) { /* keep as text */ }
        }
    }
    const list = Array.isArray(value) ? value : [value];
    let best = null;
    for (const item of list) {
        const a = awardFromAny(item, tiers);
        if (a && (!best || tiers[a.size] > tiers[best.size])) best = a;
    }
    if (!best) return null;
    return { size: best.size, amount: tiers[best.size], reason: best.reason.trim().slice(0, 120) };
}

/**
 * The AI's "levels" value → [{ name, level }]. Accepts {"Name": 4},
 * {"Name": "Lv 4"}, {"Name": {"level": 4}} and [{name, level}].
 */
export function normalizeAILevels(raw) {
    let value = raw;
    if (typeof value === 'string') {
        try { value = JSON.parse(value); } catch (e) { return []; }
    }
    const out = [];
    const push = (name, lv) => {
        if (typeof name !== 'string' || !name.trim()) return;
        let n = lv;
        if (lv && typeof lv === 'object') n = lv.level ?? lv.lv ?? lv.value;
        if (typeof n === 'string') n = parseFloat(n.replace(/[^\d.]/g, ''));
        if (!Number.isFinite(n) || n < 1) return;
        out.push({ name: name.trim(), level: clampLevel(n) });
    };
    if (Array.isArray(value)) {
        for (const e of value) if (e && typeof e === 'object') push(e.name ?? e.character, e);
    } else if (value && typeof value === 'object') {
        for (const [k, v] of Object.entries(value)) push(k, v);
    }
    return out;
}

/** "+25 XP" / "−10 XP". */
export function formatXpAmount(n) {
    return `${n >= 0 ? '+' : '−'}${Math.abs(n)} XP`;
}

/**
 * The experience section of the prompt.
 * @param {object} o
 * @param {Array<{name, isUser, level, into, needed}>} o.party - who earns XP
 * @param {Array<{name, level}>} o.known - scene NPCs with a level
 * @param {string[]} o.needLevels - scene NPCs that still need one
 * @param {object} o.tiers - the size table
 * @param {boolean} o.awards - whether XP awards are on
 */
export function buildXpPrompt({ party = [], known = [], needLevels = [], tiers = DEFAULT_XP_TIERS, awards = true, compact = true, standalone = false } = {}) {
    const t = resolveTiers(tiers);
    const parts = [];
    const player = party.find(p => p.isUser);
    const where = standalone ? 'start your reply with ONE JSON code block containing' : 'add to the same tracker JSON object';
    if (awards && party.length) {
        const who = party.map(p => `${p.name}${p.isUser ? ' (player character)' : ''} Lv ${p.level}`).join(', ');
        let s = compact
            ? `EXPERIENCE — the party (${who}) shares XP.\n`
            : `EXPERIENCE — the party (${who}) earns experience together; every member gets the same XP.\n`;
        s += compact
            ? `Only for a real accomplishment in THIS reply (fight won, problem solved, quest completed, key discovery), ${where} ONE award: "xp": {"size": "medium", "reason": "Drove off the bandits"}. Sizes: small (${t.small}), medium (${t.medium}), large (${t.large}, major victory / side quest), epic (${t.epic}, main quest / legendary feat).\n`
            : `When THIS reply contains a real accomplishment by the party (a fight won, a problem solved, a quest completed, an important discovery, a hard social victory), ${where} ONE award: "xp": {"size": "medium", "reason": "Drove off the bandits"}.\nSizes: small (${t.small}) minor success · medium (${t.medium}) notable deed · large (${t.large}) major victory or side quest completed · epic (${t.epic}) main quest completed or legendary feat.\n`;
        s += compact
            ? 'Most replies earn nothing: leave "xp" out.'
            : 'Most replies earn nothing — leave "xp" out then. Never award XP for ordinary actions, conversation or travel, and never more than one award per reply.';
        parts.push(s);
    }
    if (needLevels.length) {
        const ref = player ? ` For comparison, ${player.name} is level ${player.level}.` : '';
        parts.push(
            `LEVELS — give these characters a level fitting who they are, in ${standalone && !(awards && party.length) ? 'ONE JSON code block at the start of your reply' : 'the same JSON object'}: "levels": {${needLevels.map(n => `"${n}": 3`).join(', ')}}. `
            + `1 = ordinary commoner, 3 = trained guard, 5 = seasoned adventurer, 10 = veteran hero, 15+ = legendary.${ref}`,
        );
    }
    if (known.length) {
        parts.push(`Known levels: ${known.map(k => `${k.name} Lv ${k.level}`).join(', ')}.`);
    }
    return parts.join('\n');
}
