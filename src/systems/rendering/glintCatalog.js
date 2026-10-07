/*
 * Doom's Enhancement Suite for SillyTavern — Glint Words: catalog
 * Copyright (C) 2026 Jordan (DangerDaza)
 *
 * This file is part of Doom's Enhancement Suite and is licensed under the
 * GNU Affero General Public License v3.0 or later. If you redistribute this
 * file or a modified version of it, you must keep this notice intact, state
 * your changes, and release your version under the same license.
 *
 * See the LICENSE file in the project root for the full terms and for
 * additional copyright notices.
 *
 * https://github.com/DangerDaza/Dooms-Enhancement-Suite
 */

/**
 * Glint Words: words the player lists light up in chat messages. Each group
 * of words has a look (its colours), an entrance (what plays when the word
 * arrives in a new message) and an idle effect (what it does afterwards).
 *
 * Pure data and the settings normaliser. No DOM, so the Node tests and the
 * settings UI can both import it without pulling in the engine.
 */

/** Colour treatments. a → b → c is the gradient across the letters; glow is the halo. */
export const GLINT_LOOKS = Object.freeze([
    { id: 'gold', label: 'Gold', a: '#fff4c2', b: '#f2c230', c: '#a8740a', glow: 'rgba(255, 196, 48, 0.55)' },
    { id: 'silver', label: 'Silver', a: '#ffffff', b: '#c9d3da', c: '#7d8b96', glow: 'rgba(220, 232, 240, 0.55)' },
    { id: 'bronze', label: 'Bronze', a: '#ffd9b0', b: '#cd7f32', c: '#7a4419', glow: 'rgba(205, 127, 50, 0.5)' },
    { id: 'crimson', label: 'Crimson', a: '#ffc2c2', b: '#e3263a', c: '#7d0a16', glow: 'rgba(227, 38, 58, 0.55)' },
    { id: 'ember', label: 'Ember', a: '#fff2a6', b: '#ff8a1f', c: '#c0300a', glow: 'rgba(255, 120, 30, 0.6)' },
    { id: 'arcane', label: 'Arcane', a: '#f3dcff', b: '#b468ff', c: '#5a1fb0', glow: 'rgba(180, 104, 255, 0.6)' },
    { id: 'frost', label: 'Frost', a: '#ffffff', b: '#8fe6ff', c: '#2b86c4', glow: 'rgba(143, 230, 255, 0.6)' },
    { id: 'ocean', label: 'Ocean', a: '#d6fff6', b: '#2fd3c0', c: '#0b6f8a', glow: 'rgba(47, 211, 192, 0.55)' },
    { id: 'toxic', label: 'Toxic', a: '#efffb5', b: '#7ff23d', c: '#2c8c10', glow: 'rgba(127, 242, 61, 0.55)' },
    { id: 'radiant', label: 'Radiant', a: '#ffffff', b: '#fff6c8', c: '#ffcf40', glow: 'rgba(255, 250, 220, 0.85)' },
    { id: 'shadow', label: 'Shadow', a: '#ddd2ff', b: '#7a66d6', c: '#2c2160', glow: 'rgba(122, 102, 214, 0.7)' },
    { id: 'rose', label: 'Rose', a: '#ffe1ee', b: '#ff5d9e', c: '#b0175a', glow: 'rgba(255, 93, 158, 0.55)' },
    { id: 'prism', label: 'Prism (rainbow)', a: '', b: '', c: '', glow: 'rgba(255, 255, 255, 0.5)' },
    { id: 'custom', label: 'Custom colour', a: '', b: '', c: '', glow: '' },
]);

/** What plays when the word arrives in a new message. */
export const GLINT_ENTRANCES = Object.freeze([
    { id: 'flash', label: 'Flash of light' },
    { id: 'sparkle', label: 'Sparkle burst' },
    { id: 'ring', label: 'Shockwave ring' },
    { id: 'pop', label: 'Pop' },
    { id: 'none', label: 'None' },
]);

/** What the word does afterwards, every time it is on screen. */
export const GLINT_IDLES = Object.freeze([
    { id: 'shine', label: 'Shine' },
    { id: 'pulse', label: 'Glow pulse' },
    { id: 'flow', label: 'Flowing colour' },
    { id: 'still', label: 'Still' },
]);

/** One-click starter groups. The words are only a start; players edit them. */
export const GLINT_PRESETS = Object.freeze([
    { id: 'treasure', name: 'Treasure', look: 'gold', entrance: 'flash', idle: 'shine', words: ['gold', 'treasure', 'coins', 'jewels', 'crown'] },
    { id: 'magic', name: 'Magic', look: 'arcane', entrance: 'sparkle', idle: 'flow', words: ['magic', 'spell', 'mana', 'rune', 'enchanted'] },
    { id: 'danger', name: 'Danger', look: 'crimson', entrance: 'ring', idle: 'pulse', words: ['blood', 'danger', 'death', 'curse'] },
    { id: 'holy', name: 'Holy', look: 'radiant', entrance: 'flash', idle: 'pulse', words: ['holy', 'divine', 'blessed', 'sacred'] },
    { id: 'frost', name: 'Frost', look: 'frost', entrance: 'sparkle', idle: 'shine', words: ['ice', 'frost', 'frozen', 'snow'] },
    { id: 'fire', name: 'Fire', look: 'ember', entrance: 'ring', idle: 'flow', words: ['fire', 'flame', 'flames', 'burning', 'inferno'] },
    { id: 'poison', name: 'Poison', look: 'toxic', entrance: 'pop', idle: 'pulse', words: ['poison', 'venom', 'toxic'] },
    { id: 'shadow', name: 'Shadow', look: 'shadow', entrance: 'ring', idle: 'pulse', words: ['shadow', 'shadows', 'darkness', 'void'] },
    { id: 'romance', name: 'Romance', look: 'rose', entrance: 'sparkle', idle: 'pulse', words: ['love', 'heart', 'kiss', 'beloved'] },
    { id: 'legendary', name: 'Legendary', look: 'prism', entrance: 'flash', idle: 'flow', words: ['legendary', 'artifact', 'relic'] },
]);

export const GLINT_MAX_GROUPS = 50;
export const GLINT_MAX_WORDS = 200;
export const GLINT_MAX_WORD_LENGTH = 60;
export const GLINT_DEFAULT_COLOR = '#f2c230';

const LOOK_IDS = new Set(GLINT_LOOKS.map(l => l.id));
const ENTRANCE_IDS = new Set(GLINT_ENTRANCES.map(e => e.id));
const IDLE_IDS = new Set(GLINT_IDLES.map(i => i.id));

export function glintLook(id) {
    return GLINT_LOOKS.find(l => l.id === id) || GLINT_LOOKS[0];
}

/** A fresh settings block: on, no groups (so nothing changes until the player adds words). */
export function defaultGlintSettings() {
    return { enabled: true, groups: [] };
}

/** Collapses whitespace; '' for anything unusable. */
export function cleanWord(word) {
    return String(word ?? '').replace(/\s+/g, ' ').trim().slice(0, GLINT_MAX_WORD_LENGTH);
}

/**
 * Splits what the player typed into words: commas, semicolons and new
 * lines separate them; spaces stay, so "the Iron Crown" is one phrase.
 * Duplicates (ignoring case) are dropped.
 * @param {string|string[]} input
 * @returns {string[]}
 */
export function parseWordList(input) {
    const raw = Array.isArray(input) ? input : String(input ?? '').split(/[,;\n\r]+/);
    const seen = new Set();
    const out = [];
    for (const item of raw) {
        const word = cleanWord(item);
        if (!word) continue;
        const key = word.toLocaleLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(word);
        if (out.length >= GLINT_MAX_WORDS) break;
    }
    return out;
}

function cleanColor(value) {
    const v = String(value ?? '').trim();
    return /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : GLINT_DEFAULT_COLOR;
}

let idCounter = 0;
export function newGlintId() {
    idCounter = (idCounter + 1) % 1e6;
    return `g${Date.now().toString(36)}${idCounter.toString(36)}`;
}

/** A clean group, filling anything missing or invalid with defaults. */
export function normalizeGlintGroup(raw) {
    const g = raw && typeof raw === 'object' ? raw : {};
    return {
        id: typeof g.id === 'string' && /^[\w-]{1,40}$/.test(g.id) ? g.id : newGlintId(),
        name: cleanWord(g.name).slice(0, 40),
        words: parseWordList(Array.isArray(g.words) ? g.words : []),
        look: LOOK_IDS.has(g.look) ? g.look : 'gold',
        color: cleanColor(g.color),
        entrance: ENTRANCE_IDS.has(g.entrance) ? g.entrance : 'flash',
        idle: IDLE_IDS.has(g.idle) ? g.idle : 'shine',
        enabled: g.enabled !== false,
    };
}

/**
 * Makes a stored settings block safe to use. Keeps ids stable so the
 * settings UI can find its rows again.
 * @param {any} raw
 * @returns {{enabled: boolean, groups: object[]}}
 */
export function normalizeGlintSettings(raw) {
    const base = raw && typeof raw === 'object' ? raw : defaultGlintSettings();
    const groups = Array.isArray(base.groups) ? base.groups.slice(0, GLINT_MAX_GROUPS).map(normalizeGlintGroup) : [];
    const ids = new Set();
    for (const g of groups) {
        while (ids.has(g.id)) g.id = newGlintId();
        ids.add(g.id);
    }
    return { enabled: base.enabled !== false, groups };
}

/** A new group from a preset (or a blank one). */
export function groupFromPreset(presetId) {
    const preset = GLINT_PRESETS.find(p => p.id === presetId);
    if (!preset) return normalizeGlintGroup({ name: '', words: [] });
    return normalizeGlintGroup({ ...preset, id: newGlintId(), words: [...preset.words] });
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * One regular expression for every word in every switched-on group, longest
 * first so "the Iron Crown" wins over "Crown". Whole words only, any case.
 * The first group to list a word owns it.
 * @param {object[]} groups - normalised groups
 * @returns {{re: RegExp, byKey: Map<string, object>}|null}
 */
export function buildGlintMatcher(groups) {
    const byKey = new Map();
    for (const g of groups || []) {
        if (!g || g.enabled === false) continue;
        for (const w of g.words || []) {
            const key = keyFor(w);
            if (key && !byKey.has(key)) byKey.set(key, g);
        }
    }
    if (!byKey.size) return null;
    const alternation = [...byKey.keys()]
        .sort((x, y) => y.length - x.length)
        .map(k => escapeRe(k).replace(/ /g, '\\s+'))
        .join('|');
    // Letters, digits and underscores on either side mean it's part of a
    // longer word ("Ash" inside "Ashen"); apostrophes and hyphens don't, so
    // "Excalibur's" still lights "Excalibur".
    const re = new RegExp(`(?<![\\p{L}\\p{N}_])(?:${alternation})(?![\\p{L}\\p{N}_])`, 'giu');
    return { re, byKey };
}

/** The lookup key for a matched or listed word. */
export function keyFor(word) {
    return cleanWord(word).toLocaleLowerCase();
}

/**
 * Splits text into plain and matched pieces.
 * @returns {Array<{text: string, group?: object}>|null} null when nothing matches
 */
export function splitByGlint(text, matcher) {
    if (!matcher || !text) return null;
    const { re, byKey } = matcher;
    re.lastIndex = 0;
    let m;
    let last = 0;
    const pieces = [];
    while ((m = re.exec(text)) !== null) {
        if (!m[0]) { re.lastIndex++; continue; }
        const group = byKey.get(keyFor(m[0]));
        if (!group) continue;
        if (m.index > last) pieces.push({ text: text.slice(last, m.index) });
        pieces.push({ text: m[0], group });
        last = m.index + m[0].length;
    }
    if (!pieces.length) return null;
    if (last < text.length) pieces.push({ text: text.slice(last) });
    return pieces;
}

/** Stable small number from a string (idle animation phase, so words don't shine in step). */
export function glintHash(str) {
    let h = 5381;
    const s = String(str);
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return Math.abs(h);
}
