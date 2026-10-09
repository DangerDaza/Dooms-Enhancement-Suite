/**
 * Attribute effects — shared by equipped items and conditions.
 *
 * An effect is a bonus or malus on an ATTRIBUTE (the D&D six or a custom
 * attribute), stored by stat id: { str: 2, dex: -1 }. Effects are never
 * written into the attribute itself: the effective value is computed
 * (base/current + every active effect), so removing the item or condition
 * removes the bonus by itself.
 */
import { findStat } from './statsModel.js';

export const EFFECT_MIN = -20;
export const EFFECT_MAX = 20;

function clampEffect(n) {
    return Math.max(EFFECT_MIN, Math.min(EFFECT_MAX, Math.round(n)));
}

/**
 * Reads effects in whatever form they come: an object { "STR": 2,
 * "Dexterity": "-1" } or a string "STR +2, DEX -1". Only attributes of the
 * given stat list are kept; zero and unknown entries are dropped.
 * @param {*} raw
 * @param {object[]} stats - the character's resolved stat list
 * @returns {Object<string, number>} { statId: n }
 */
export function parseEffects(raw, stats) {
    const attrs = (stats || []).filter(s => s.kind === 'attribute');
    const out = {};
    const put = (label, value) => {
        const stat = findStat(attrs, String(label).trim());
        const n = typeof value === 'number' ? value : Number(String(value).replace(/\s+/g, ''));
        if (!stat || !Number.isFinite(n) || n === 0) return;
        out[stat.id] = clampEffect((out[stat.id] || 0) + n);
        if (out[stat.id] === 0) delete out[stat.id];
    };
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        for (const [k, v] of Object.entries(raw)) put(k, v);
        return out;
    }
    if (Array.isArray(raw)) {
        for (const e of raw) {
            if (typeof e === 'string') Object.assign(out, mergeEffects(out, parseEffects(e, stats)));
            else if (e && typeof e === 'object') put(e.stat ?? e.attribute ?? e.name, e.value ?? e.bonus ?? e.amount);
        }
        return out;
    }
    if (typeof raw === 'string') {
        // "STR +2, DEX -1" / "+2 STR" / "Strength: 2"
        for (const part of raw.split(/[,;/]+/)) {
            const p = part.trim();
            if (!p) continue;
            let m = p.match(/^([\p{L}][\p{L}\s]*?)\s*:?\s*([+\-−]?\s*\d+)$/u);
            if (m) { put(m[1], m[2].replace('−', '-')); continue; }
            m = p.match(/^([+\-−]?\s*\d+)\s+([\p{L}][\p{L}\s]*)$/u);
            if (m) put(m[2], m[1].replace('−', '-'));
        }
    }
    return out;
}

/** Sum of two effect maps. */
export function mergeEffects(a, b) {
    const out = { ...(a || {}) };
    for (const [k, v] of Object.entries(b || {})) {
        out[k] = clampEffect((out[k] || 0) + v);
        if (!out[k]) delete out[k];
    }
    return out;
}

/** "STR +2, DEX −1" using each stat's short label. */
export function formatEffects(effects, stats) {
    const parts = [];
    for (const [id, v] of Object.entries(effects || {})) {
        if (!v) continue;
        const s = (stats || []).find(x => x.id === id);
        const label = s ? (s.abbr || s.name) : id.toUpperCase();
        parts.push(`${label} ${v > 0 ? '+' : '−'}${Math.abs(v)}`);
    }
    return parts.join(', ');
}

/**
 * Which sources change each attribute.
 * @param {Array<{label: string, effects: object}>} sources
 * @returns {Object<string, {total: number, parts: Array<{label: string, value: number}>}>}
 */
export function collectModifiers(sources) {
    const out = {};
    for (const src of sources || []) {
        for (const [id, v] of Object.entries(src.effects || {})) {
            if (!v) continue;
            if (!out[id]) out[id] = { total: 0, parts: [] };
            out[id].total += v;
            out[id].parts.push({ label: src.label, value: v });
        }
    }
    return out;
}
