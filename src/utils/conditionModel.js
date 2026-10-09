/**
 * Character Conditions — pure model.
 *
 * Temporary states such as Poisoned, Wounded leg, Drunk, Blessed. The AI
 * adds them when they happen and removes them when they end; the user can
 * add and remove them from the Stats panel. A condition can carry attribute
 * effects (Wounded leg: DEX −3) that apply while it lasts.
 *
 * Condition shape: { id, icon, name, desc, effects, source: 'ai'|'user', createdAt }
 */
import { cleanIcon, splitLeadingEmoji, itemKey } from './equipmentModel.js';

export const CONDITION_NAME_MAX = 40;
export const CONDITION_DESC_MAX = 120;
export const DEFAULT_CONDITION_ICON = '✨';
export const MAX_CONDITIONS = 20;

/** Emoji offered in the panel's quick picker. */
export const CONDITION_EMOJI = [
    '🤢', '🩸', '🤕', '🦴', '🔥', '🧊', '⚡', '☠️', '😵', '😴', '🥴', '🍺',
    '😨', '😡', '😢', '🥰', '😤', '🫨', '🙏', '✨', '🛡️', '💪', '🏃', '👁️',
    '🌀', '🌙', '☀️', '🕸️', '⛓️', '🧠', '💤', '🌡️',
];

let idCounter = 0;
function newConditionId() {
    idCounter = (idCounter + 1) % 1000;
    return 'cnd_' + Date.now().toString(36) + '_' + idCounter.toString(36) + Math.random().toString(36).slice(2, 5);
}

function clip(text, max) {
    const t = String(text ?? '').replace(/\s+/g, ' ').trim();
    return t.length > max ? t.slice(0, max - 1).trimEnd() + '…' : t;
}

export function findCondition(list, name) {
    const k = itemKey(splitLeadingEmoji(name).name);
    if (!k) return null;
    return (list || []).find(c => itemKey(c.name) === k) || null;
}

/** Builds a condition, or null without a name. `effects` is a { statId: n } map. */
export function makeCondition({ icon, name, desc, effects = {}, source = 'user' } = {}) {
    const split = splitLeadingEmoji(name);
    const n = clip(split.name, CONDITION_NAME_MAX);
    if (!n) return null;
    const ic = cleanIcon(String(icon ?? '').trim() ? icon : split.icon);
    return {
        id: newConditionId(),
        icon: ic === '📦' ? DEFAULT_CONDITION_ICON : ic,
        name: n,
        desc: clip(desc, CONDITION_DESC_MAX),
        effects: effects && typeof effects === 'object' && !Array.isArray(effects) ? { ...effects } : {},
        source,
        createdAt: Date.now(),
    };
}

/**
 * Normalises the AI's "conditions" value into [{ name, add: [...], remove: [names] }].
 * Accepts { "Name": { "add": [...], "remove": [...] } }, { "Name": [...] }
 * (a list → added) and [{ "name": "Name", "add": [...], "remove": [...] }].
 */
export function normalizeAIConditions(raw) {
    let data = raw;
    if (typeof data === 'string') {
        try { data = JSON.parse(data); } catch (e) { return []; }
    }
    if (!data || typeof data !== 'object') return [];
    const toAdd = (v) => {
        if (typeof v === 'string') return { name: v };
        if (v && typeof v === 'object') return {
            icon: v.icon ?? v.emoji,
            name: v.name ?? v.condition ?? v.status,
            desc: v.desc ?? v.description ?? v.note,
            effects: v.effects ?? v.modifiers ?? v.bonus,
        };
        return null;
    };
    const toName = (v) => {
        const r = typeof v === 'string' ? v : (v && typeof v === 'object' ? (v.name ?? v.condition) : null);
        return typeof r === 'string' && r.trim() ? splitLeadingEmoji(r).name : null;
    };
    const arr = (v) => (Array.isArray(v) ? v : (v === undefined || v === null ? [] : [v]));
    const out = [];
    const push = (name, val) => {
        if (typeof name !== 'string' || !name.trim() || !val || typeof val !== 'object') return;
        if (Array.isArray(val)) val = { add: val };
        const add = arr(val.add ?? val.added ?? val.gain ?? val.start ?? val.conditions).map(toAdd)
            .filter(a => a && typeof a.name === 'string' && a.name.trim());
        const remove = arr(val.remove ?? val.removed ?? val.end ?? val.ended ?? val.cure ?? val.cured).map(toName).filter(Boolean);
        if (add.length || remove.length) out.push({ name: name.trim(), add, remove });
    };
    if (Array.isArray(data)) {
        for (const c of data) if (c && typeof c === 'object') push(c.name, c);
        return out;
    }
    for (const [name, val] of Object.entries(data)) push(name, val);
    return out;
}

/**
 * Applies one character's AI change to a COPY of their list.
 * @returns {{ list: object[], added: number, removed: number }}
 */
export function applyConditionChange(list, change, resolveEffects = () => ({})) {
    const next = (Array.isArray(list) ? list : []).map(c => ({ ...c, effects: { ...(c.effects || {}) } }));
    const res = { list: next, added: 0, removed: 0 };
    for (const n of change.remove || []) {
        const c = findCondition(next, n);
        if (!c) continue;
        next.splice(next.indexOf(c), 1);
        res.removed++;
    }
    for (const a of change.add || []) {
        if (findCondition(next, a.name)) continue;
        if (next.length >= MAX_CONDITIONS) break;
        const c = makeCondition({
            icon: a.icon, name: a.name, desc: a.desc,
            effects: a.effects === undefined || a.effects === null ? {} : resolveEffects(a.effects),
            source: 'ai',
        });
        if (!c || !itemKey(c.name)) continue;
        next.push(c);
        res.added++;
    }
    return res;
}

/** Conditions as modifier sources. */
export function conditionModifierSources(list) {
    return (list || [])
        .filter(c => c && c.effects && Object.keys(c.effects).length)
        .map(c => ({ label: c.name, effects: c.effects }));
}

/** "🤢 Poisoned (CON −2), 🍺 Tipsy" */
export function formatConditions(list, formatEffect = null, { icons = true } = {}) {
    return (list || []).map(c => {
        const eff = formatEffect && c.effects && Object.keys(c.effects).length ? formatEffect(c.effects) : '';
        return `${icons ? `${c.icon || DEFAULT_CONDITION_ICON} ` : ''}${c.name}${eff ? ` (${eff})` : ''}`;
    }).join(', ');
}

/**
 * The prompt section for the characters in the scene.
 * @param {Array<{name: string, isUser: boolean, conditions: object[], formatEffect?: Function}>} entries
 */
export function buildConditionsPrompt(entries, { compact = true, standalone = false } = {}) {
    const list = (entries || []).filter(e => e && e.name);
    if (!list.length) return '';
    const withAny = list.filter(e => e.conditions.length);
    const example = JSON.stringify({ conditions: { [list[0].name]: {
        add: [{ icon: '🤢', name: 'Poisoned', desc: 'Weak and feverish', effects: { CON: -2 } }],
        remove: ['Tipsy'],
    } } });
    const where = standalone ? 'start your reply with ONE JSON code block' : 'add a "conditions" key to the same tracker JSON object';
    let out = '';
    if (withAny.length) {
        out += compact ? 'CONDITIONS (temporary, in effect now):\n' : 'CONDITIONS — temporary states in effect right now; let them shape the scene:\n';
        out += withAny.map(e => `- ${e.name}${e.isUser ? ' (player character)' : ''}: ${formatConditions(e.conditions, e.formatEffect, { icons: !compact })}`).join('\n') + '\n';
    }
    out += compact
        ? `When a temporary condition (poisoned, wounded, drunk, blessed…) starts or ends, ${where}: ${example} — one emoji, short name, desc under 8 words, "effects" only for real attribute changes (applied while it lasts). Omit the key when nothing changes.`
        : `CONDITION CHANGES: when a temporary condition starts for one of the characters in the scene — poisoned, wounded, sick, exhausted, drunk, frightened, enraged, blessed, cursed and so on — or when one ends, ${where}, like ${example}. Each condition has one emoji, a short name, a description under 8 words and, only when it genuinely affects an attribute, "effects" (e.g. {"DEX": -3}); DES applies them automatically while the condition lasts, so never raise or lower attributes yourself because of it. Remove a condition as soon as it ends (healed, sobered up, rested). Leave the key out entirely when nothing changes.`;
    return out.trim();
}
