/**
 * Character Equipment — pure model.
 *
 * Every character (persona and NPCs) carries a list of items shown in the
 * Stats panel: an emoji icon, a name and a very short description. The AI
 * can add items and remove the ones the user allows it to (aiCanRemove);
 * items the user locked can only be removed by the user.
 *
 * Item shape: { id, icon, name, desc, qty, equipped, effects, aiCanRemove,
 *               source: 'ai'|'user', createdAt }
 *   qty       — how many (a stack: "Healing potion ×3")
 *   equipped  — worn / in hand (true) or in the backpack (false)
 *   effects   — attribute bonuses while equipped: { statId: n } (effectsModel.js)
 */

export const ITEM_NAME_MAX = 40;
export const ITEM_DESC_MAX = 120;
export const DEFAULT_ICON = '📦';
export const LOCK_MARK = '🔒';
export const MAX_ITEMS = 40;
export const MAX_QTY = 999;

/** Emoji offered in the panel's quick picker. */
export const ITEM_EMOJI = [
    '🗡️', '⚔️', '🏹', '🪓', '🔨', '🛡️', '🪖', '🥾', '🧥', '👕', '💍', '📿',
    '🎒', '👜', '💰', '🪙', '🗝️', '🔑', '📜', '📖', '🗺️', '🧭', '🔦', '🕯️',
    '🧪', '💊', '🩹', '🍞', '🍖', '🍎', '💧', '🍷', '🔫', '💣', '📱', '💻',
    '🔮', '🪄', '💎', '🎵', '🧰', '🪢', '⛺', '🔥', '🐎', '✉️', '🎫', '📦',
];

let idCounter = 0;
export function newItemId() {
    idCounter = (idCounter + 1) % 1000;
    return 'itm_' + Date.now().toString(36) + '_' + idCounter.toString(36) + Math.random().toString(36).slice(2, 5);
}

function clip(text, max) {
    const t = String(text ?? '').replace(/\s+/g, ' ').trim();
    return t.length > max ? t.slice(0, max - 1).trimEnd() + '…' : t;
}

/** The first emoji-ish glyph of the input, or the default box. */
export function cleanIcon(icon) {
    const s = String(icon ?? '').trim();
    if (!s) return DEFAULT_ICON;
    // Keep one grapheme (emoji + variation selector / ZWJ sequence).
    let out = '';
    try {
        const seg = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
        const first = seg.segment(s)[Symbol.iterator]().next().value;
        out = first ? first.segment : '';
    } catch (e) {
        out = Array.from(s).slice(0, 2).join('');
    }
    // Letters are not icons.
    if (!out || /^[\p{L}\p{N}]/u.test(out)) return DEFAULT_ICON;
    return out;
}

/** Comparison key for item names. */
export function itemKey(name) {
    return String(name || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '');
}

export function findItem(list, name) {
    const k = itemKey(splitLeadingEmoji(name).name);
    if (!k) return null;
    return (list || []).find(i => itemKey(i.name) === k) || null;
}

/**
 * "⚡ Electric stone" → { icon: '⚡', name: 'Electric stone' }. A name that
 * does not start with an emoji is returned unchanged with no icon.
 */
export function splitLeadingEmoji(text) {
    const s = String(text ?? '').trim();
    const m = s.match(/^(\p{Extended_Pictographic}(?:\uFE0F|\u200D\p{Extended_Pictographic}|\p{Emoji_Modifier})*)\s*(.*)$/u);
    if (m && m[2]) return { icon: m[1], name: m[2] };
    return { icon: '', name: s };
}

function clampQty(q, fallback = 1) {
    const n = Math.round(Number(q));
    return Number.isFinite(n) ? Math.max(1, Math.min(MAX_QTY, n)) : fallback;
}

/** Fills the fields older saves don't have. */
export function normalizeItem(item) {
    if (!item || typeof item !== 'object') return item;
    if (!Number.isFinite(item.qty) || item.qty < 1) item.qty = 1;
    if (typeof item.equipped !== 'boolean') item.equipped = false;
    if (!item.effects || typeof item.effects !== 'object' || Array.isArray(item.effects)) item.effects = {};
    return item;
}

/**
 * Builds an item, or null without a name. `effects` must already be a
 * { statId: n } map (see effectsModel.parseEffects).
 */
export function makeItem({ icon, name, desc, qty = 1, equipped = false, effects = {}, aiCanRemove = true, source = 'user' } = {}) {
    // An emoji written in front of the name becomes the icon.
    const split = splitLeadingEmoji(name);
    const n = clip(split.name, ITEM_NAME_MAX);
    if (!n) return null;
    return {
        id: newItemId(),
        icon: cleanIcon(String(icon ?? '').trim() ? icon : split.icon),
        name: n,
        desc: clip(desc, ITEM_DESC_MAX),
        qty: clampQty(qty),
        equipped: !!equipped,
        effects: effects && typeof effects === 'object' && !Array.isArray(effects) ? { ...effects } : {},
        aiCanRemove: aiCanRemove !== false,
        source,
        createdAt: Date.now(),
    };
}

/**
 * Normalises the AI's "equipment" value into
 * [{ name, add: [...], remove: [{name, qty}], equip: [names], unequip: [names] }].
 * Accepts, per character:
 *   { "add": [{icon,name,desc,qty,equipped,effects} | "⚡ name"],
 *     "remove": ["name" | {name, qty}], "equip": [...], "unequip": [...] }   (the asked-for shape)
 *   ["⚡ name", {icon,name,...}, ...]                                       (a plain list → added)
 *   { "items" | "inventory" | "equipment" | "carries": [...] }              (→ added)
 * and the list form [{ "name": "Name", "add": [...], ... }].
 * Lists are only ever ADDED, and never stack quantities: an item missing
 * from a list is never removed, and one already carried is left as it is.
 */
export function normalizeAIEquipment(raw) {
    let data = raw;
    if (typeof data === 'string') {
        try { data = JSON.parse(data); } catch (e) { return []; }
    }
    if (!data || typeof data !== 'object') return [];
    const toAdd = (fromList) => (v) => {
        if (typeof v === 'string') return { name: v, fromList };
        if (v && typeof v === 'object') {
            const qty = v.qty ?? v.quantity ?? v.count ?? v.amount;
            return {
                icon: v.icon ?? v.emoji,
                name: v.name ?? v.item ?? v.title,
                desc: v.desc ?? v.description ?? v.note,
                qty: qty === undefined || qty === null ? undefined : qty,
                equipped: typeof v.equipped === 'boolean' ? v.equipped : (typeof v.worn === 'boolean' ? v.worn : undefined),
                effects: v.effects ?? v.bonus ?? v.bonuses ?? v.modifiers,
                fromList,
            };
        }
        return null;
    };
    const toRemove = (v) => {
        const raw = typeof v === 'string' ? v : (v && typeof v === 'object' ? (v.name ?? v.item) : null);
        if (typeof raw !== 'string' || !raw.trim()) return null;
        const qty = v && typeof v === 'object' ? (v.qty ?? v.quantity ?? v.count ?? v.amount) : undefined;
        return { name: splitLeadingEmoji(raw).name, qty: qty === undefined || qty === null ? null : qty };
    };
    const toName = (v) => {
        const raw = typeof v === 'string' ? v : (v && typeof v === 'object' ? (v.name ?? v.item) : null);
        return typeof raw === 'string' && raw.trim() ? splitLeadingEmoji(raw).name : null;
    };
    const arr = (v) => (Array.isArray(v) ? v : (v === undefined || v === null ? [] : [v]));
    const out = [];
    const push = (name, val) => {
        if (typeof name !== 'string' || !name.trim() || !val || typeof val !== 'object') return;
        const isList = Array.isArray(val);
        if (isList) val = { items: val };
        const explicit = val.add ?? val.added ?? val.gain ?? val.gained;
        const listed = val.items ?? val.inventory ?? val.equipment ?? val.carries ?? val.carried;
        const add = [
            ...arr(explicit).map(toAdd(false)),
            ...arr(listed).map(toAdd(true)),
        ].filter(a => a && typeof a.name === 'string' && a.name.trim());
        const remove = arr(val.remove ?? val.removed ?? val.lose ?? val.lost ?? val.use ?? val.used).map(toRemove).filter(Boolean);
        const equip = arr(val.equip ?? val.wear ?? val.wield).map(toName).filter(Boolean);
        const unequip = arr(val.unequip ?? val.stow ?? val.pack ?? val.takeoff).map(toName).filter(Boolean);
        if (add.length || remove.length || equip.length || unequip.length) out.push({ name: name.trim(), add, remove, equip, unequip });
    };
    if (Array.isArray(data)) {
        for (const item of data) if (item && typeof item === 'object') push(item.name, item);
        return out;
    }
    for (const [name, val] of Object.entries(data)) push(name, val);
    return out;
}

/** Item names already carried, for "is this an add?" checks. */
export function sameItemName(a, b) {
    return itemKey(splitLeadingEmoji(a).name) === itemKey(splitLeadingEmoji(b).name);
}

/**
 * Applies one character's AI change to a COPY of their list.
 * @param {object[]} list
 * @param {object} change - one entry of normalizeAIEquipment
 * @param {(raw: *) => object} [resolveEffects] - raw effects → { statId: n }
 * @returns {{ list: object[], added: number, removed: number, changed: number, blocked: object[] }}
 */
export function applyEquipmentChange(list, change, resolveEffects = () => ({})) {
    const next = (Array.isArray(list) ? list : []).map(i => normalizeItem({ ...i, effects: { ...(i.effects || {}) } }));
    const res = { list: next, added: 0, removed: 0, changed: 0, blocked: [] };
    const find = (name) => findItem(next, name);
    for (const r of change.remove || []) {
        const item = find(r.name);
        if (!item) continue;
        if (item.aiCanRemove === false) { res.blocked.push(item); continue; }
        const q = r.qty === null || r.qty === undefined ? null : Math.round(Number(r.qty));
        if (q !== null && Number.isFinite(q) && q > 0 && q < item.qty) {
            item.qty -= q;
            res.changed++;
        } else {
            next.splice(next.indexOf(item), 1);
            res.removed++;
        }
    }
    for (const a of change.add || []) {
        const existing = find(a.name);
        if (existing) {
            // Only an explicit quantity stacks; a re-listed item is left alone.
            const q = Math.round(Number(a.qty));
            if (!a.fromList && a.qty !== undefined && Number.isFinite(q) && q > 0) {
                existing.qty = Math.min(MAX_QTY, existing.qty + q);
                res.changed++;
            }
            if (typeof a.equipped === 'boolean' && existing.equipped !== a.equipped) { existing.equipped = a.equipped; res.changed++; }
            continue;
        }
        if (next.length >= MAX_ITEMS) break;
        const item = makeItem({
            icon: a.icon, name: a.name, desc: a.desc,
            qty: a.qty === undefined ? 1 : a.qty,
            equipped: a.equipped === true,
            effects: a.effects === undefined || a.effects === null ? {} : resolveEffects(a.effects),
            source: 'ai', aiCanRemove: true,
        });
        if (!item || !itemKey(item.name)) continue;
        next.push(item);
        res.added++;
    }
    for (const n of change.equip || []) {
        const item = find(n);
        if (item && !item.equipped) { item.equipped = true; res.changed++; }
    }
    for (const n of change.unequip || []) {
        const item = find(n);
        if (item && item.equipped) { item.equipped = false; res.changed++; }
    }
    return res;
}

/** Effects of the equipped items, as modifier sources. */
export function equipmentModifierSources(list) {
    return (list || [])
        .filter(i => i && i.equipped && i.effects && Object.keys(i.effects).length)
        .map(i => ({ label: i.name, effects: i.effects }));
}

/** "🔒🗡️ Iron sword (STR +2), 🧪 Healing potion ×3" */
export function formatItems(list, formatEffect = null, { icons = true } = {}) {
    return (list || []).map(raw => {
        const i = normalizeItem({ ...raw });
        const eff = formatEffect && Object.keys(i.effects).length ? formatEffect(i.effects) : '';
        return `${i.aiCanRemove === false ? LOCK_MARK : ''}${icons ? `${i.icon || DEFAULT_ICON} ` : ''}${i.name}${i.qty > 1 ? ` ×${i.qty}` : ''}${eff ? ` (${eff})` : ''}`;
    }).join(', ');
}

/** "Equipped: …; Backpack: …" */
export function formatLoadout(list, formatEffect = null, { icons = true } = {}) {
    const items = (list || []).map(i => normalizeItem({ ...i }));
    const on = items.filter(i => i.equipped);
    const pack = items.filter(i => !i.equipped);
    const parts = [];
    if (on.length) parts.push(`equipped: ${formatItems(on, formatEffect, { icons })}`);
    if (pack.length) parts.push(`backpack: ${formatItems(pack, null, { icons })}`);
    return parts.join('; ');
}

/**
 * The prompt section for the characters in the scene.
 * Entries with `needsGear` have an empty list nobody has filled yet: the AI
 * is asked, once, to add what they already carry (from their description,
 * the persona description, or the scene).
 * @param {Array<{name: string, isUser: boolean, items: object[], needsGear?: boolean}>} entries
 * @param {{compact?: boolean, standalone?: boolean}} [options]
 */
export function buildEquipmentPrompt(entries, { compact = true, standalone = false } = {}) {
    const list = (entries || []).filter(e => e && e.name);
    if (!list.length) return '';
    // Compact prompts leave the icons out of the lists: the AI only needs
    // them for items it adds.
    const lines = list.map(e => `- ${e.name}${e.isUser ? ' (player character)' : ''}: ${e.items.length ? formatLoadout(e.items, e.formatEffect, { icons: !compact }) : 'nothing listed yet'}`);
    const seed = list.filter(e => e.needsGear).map(e => e.name);
    const player = list.find(e => e.isUser)?.name;
    const example = JSON.stringify({ equipment: { [list[0].name]: compact
        ? {
            add: [{ icon: '🗡️', name: 'Iron sword', desc: 'Plain blade', equipped: true, effects: { STR: 1 } }],
            remove: [{ name: 'Healing potion', qty: 1 }],
            equip: ['Oak shield'], unequip: ['Cloak'],
        }
        : {
            add: [{ icon: '🗡️', name: 'Iron sword', desc: 'Plain soldier\'s blade', equipped: true, effects: { STR: 1 } }, { icon: '🧪', name: 'Healing potion', qty: 2 }],
            remove: [{ name: 'Torch' }, { name: 'Healing potion', qty: 1 }],
            equip: ['Oak shield'], unequip: ['Cloak'],
        } } });
    const where = standalone ? 'start your reply with ONE JSON code block' : 'add an "equipment" key to the same tracker JSON object';
    let out = compact
        ? 'EQUIPMENT (equipped = worn/in hand; backpack = carried):\n'
        : 'EQUIPMENT — what each character has equipped (worn or in hand) and in their backpack:\n';
    out += lines.join('\n') + '\n';
    const playerNote = player
        ? (compact
            ? `, incl. anything ${player} takes out in the user's message`
            : `. This includes anything ${player} takes out, shows or uses in the user's message, even if it was never mentioned before — the user decides what their character carries`)
        : '';
    out += compact
        ? `When someone gains, loses, uses up, puts on or puts away an item — or is shown having one not listed${playerNote} — ${where}: ${example}. One emoji, short name, desc under 8 words; "qty" for stacks; "effects" only for real attribute bonuses (applied while equipped). Never remove ${LOCK_MARK}. Omit the key when nothing changes.`
        : `EQUIPMENT CHANGES: keep these lists true to the story. Add an item when a character gains it — picks it up, buys it, is given it — or when the story shows them already having, wearing or using something that is not listed yet${playerNote}. Remove an item when they drop it, give it away, break it or use it up; for stacks, remove with a "qty" to use up only some. Use "equip" when they put something on or take it in hand and "unequip" when they put it away in the backpack. Write the change with ${where}, like ${example}. Each new item has one emoji icon, a short name, a description under 8 words, "qty" when there are several, "equipped": true if it is worn or held, and "effects" only for genuine attribute bonuses or maluses (e.g. {"STR": 1}) — DES applies them automatically while the item is equipped, so never raise or lower attributes yourself because of an item. Items marked ${LOCK_MARK} are fixed by the user and must never be removed. Leave the key out entirely when nothing changes.`;
    if (seed.length) {
        out += compact
            ? `\nSTARTING GEAR: add what ${seed.join(', ')} already ${seed.length === 1 ? 'carries' : 'carry'} and ${seed.length === 1 ? 'wears' : 'wear'} now, from their description and the scene (a few key items).`
            : `\nSTARTING GEAR: ${seed.join(', ')} ${seed.length === 1 ? 'has' : 'have'} no equipment listed yet. Add what they already carry and wear right now, based on their character description (or persona description) and the scene — a few key items, not every trinket.`;
    }
    return out.trim();
}
