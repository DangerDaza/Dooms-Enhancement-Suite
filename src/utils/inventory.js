/**
 * Inventory (Project Short Fuse, Phase 5): the pure model.
 *
 * The persona has a pack; the party shares one pouch. An item is a name, a
 * count and an optional note, with an icon DES picks from the name. Each
 * container has a set number of slots, one per kind of item (a stack);
 * counts inside a stack are free. The AI changes inventories the way it
 * calls for checks: a tag line at the end of a reply, or a function tool
 * where the API can call tools. It never keeps the list itself: it is told
 * what is carried in one line, says what changed, and the code applies it.
 *
 * No SillyTavern imports: tools/inventory-test.mjs imports this directly.
 * Storage, events and the shelf live in src/systems/features/inventory.js
 * and src/systems/ui/shelfPages.js.
 */

export const CONTAINERS = Object.freeze(['pack', 'pouch']);
export const MIN_SLOTS = 1;
export const MAX_SLOTS = 64;
export const MAX_COUNT = 9999;
export const MAX_NAME = 40;
export const MAX_NOTE = 80;
export const MAX_CHANGES = 8;          // per tag or tool call
export const DEFAULT_ICON = '📦';
export const INVENTORY_TOOL_NAME = 'dooms_inventory';

const CONFIG_DEFAULTS = Object.freeze({
    enabled: false,
    packSlots: 16,
    pouchSlots: 8,
    tellTheAI: true,               // the inventory line rides every generation while on
    notify: true,                  // toasts when the AI changes something (debugging aid)
    aiChanges: Object.freeze({
        enabled: true,
        endOfReply: true,          // "[ITEM: ...]" as the last line of a reply; any model
        tool: true,                // the dooms_inventory function tool, where the model supports tools
    }),
});

const clampInt = (v, lo, hi, dflt) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return dflt;
    return Math.min(hi, Math.max(lo, Math.round(n)));
};

/** A fresh copy of the defaults, for settings files. */
export function defaultInventoryConfig() {
    return { ...CONFIG_DEFAULTS, aiChanges: { ...CONFIG_DEFAULTS.aiChanges } };
}

/**
 * The rules block as every reader should see it: `settings.inventory`
 * normalised with defaults filled in. Never mutates settings.
 */
export function inventoryConfig(settings) {
    const raw = settings?.inventory;
    const c = raw && typeof raw === 'object' ? raw : {};
    const a = c.aiChanges && typeof c.aiChanges === 'object' ? c.aiChanges : {};
    return {
        enabled: c.enabled === true,
        packSlots: clampInt(c.packSlots, MIN_SLOTS, MAX_SLOTS, CONFIG_DEFAULTS.packSlots),
        pouchSlots: clampInt(c.pouchSlots, MIN_SLOTS, MAX_SLOTS, CONFIG_DEFAULTS.pouchSlots),
        tellTheAI: c.tellTheAI !== false,
        notify: c.notify !== false,
        aiChanges: {
            enabled: a.enabled !== false,
            endOfReply: a.endOfReply !== false,
            tool: a.tool !== false,
        },
    };
}

/** The master switch. */
export function inventoryOn(settings) {
    return inventoryConfig(settings).enabled;
}

/** Slots of a container under this config. */
export function slotsFor(container, cfg) {
    return container === 'pouch' ? cfg.pouchSlots : cfg.packSlots;
}

// ─── Items ─────────────────────────────────────────────────────────────────

/** The identity of an item: its name, lower-cased, spaces collapsed. */
export function itemKey(name) {
    return String(name || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function cleanName(name) {
    return String(name || '').trim().replace(/\s+/g, ' ').replace(/[.。]+$/, '').slice(0, MAX_NAME);
}

function cleanNote(note) {
    return String(note || '').trim().replace(/\s+/g, ' ').slice(0, MAX_NOTE);
}

/**
 * Icon rules: the first pattern that matches the name wins. Fantasy and
 * modern both, since the stories DES runs are both. Edit by hand on the
 * slot; the table is only the first guess.
 */
export const ICON_RULES = Object.freeze([
    [/\b(coin|coins|gold|silver|copper|money|cash|dollar|credits?|shilling|penny|pennies)\b/i, '🪙'],
    [/\b(wallet|purse)\b/i, '👛'],
    [/\b(key|keys|keyring)\b/i, '🗝️'],
    [/\b(map|chart|atlas)\b/i, '🗺️'],
    [/\b(letter|note|paper|document|file|dossier|report|papers|envelope)\b/i, '📄'],
    [/\b(book|tome|journal|diary|ledger|grimoire|notebook)\b/i, '📖'],
    [/\b(scroll|parchment)\b/i, '📜'],
    [/\b(torch)\b/i, '🔦'],
    [/\b(lantern|lamp)\b/i, '🏮'],
    [/\b(candle|candles)\b/i, '🕯️'],
    [/\b(matches|lighter|flint|tinder)\b/i, '🔥'],
    [/\b(rope|cord|twine|line)\b/i, '🪢'],
    [/\b(chain|chains|shackles|handcuffs|manacles)\b/i, '⛓️'],
    [/\b(sword|blade|sabre|saber|rapier|katana|scimitar|longsword|shortsword)\b/i, '🗡️'],
    [/\b(dagger|knife|knives|dirk|stiletto|shiv)\b/i, '🔪'],
    [/\b(axe|hatchet)\b/i, '🪓'],
    [/\b(hammer|mallet|maul)\b/i, '🔨'],
    [/\b(bow|crossbow|longbow)\b/i, '🏹'],
    [/\b(arrow|arrows|bolt|bolts|quiver)\b/i, '🏹'],
    [/\b(staff|rod|wand|cane|sceptre|scepter)\b/i, '🪄'],
    [/\b(spear|lance|pike|javelin|trident)\b/i, '🔱'],
    [/\b(shield|buckler)\b/i, '🛡️'],
    [/\b(armou?r|mail|breastplate|cuirass|plate|vest|kevlar)\b/i, '🦺'],
    [/\b(helm|helmet|cap|hat|hood|cowl)\b/i, '🪖'],
    [/\b(cloak|cape|coat|jacket|robe|robes|mantle|shawl)\b/i, '🧥'],
    [/\b(boots?|shoes?|sandals?)\b/i, '🥾'],
    [/\b(gloves?|gauntlets?|mittens?)\b/i, '🧤'],
    [/\b(ring)\b/i, '💍'],
    [/\b(amulet|pendant|necklace|locket|talisman|charm|medallion)\b/i, '📿'],
    [/\b(gem|gems|jewel|jewels|ruby|emerald|sapphire|diamond|crystal|pearl)\b/i, '💎'],
    [/\b(potion|elixir|philtre|draught|tonic)\b/i, '🧪'],
    [/\b(vial|flask|bottle|phial|jar)\b/i, '🍶'],
    [/\b(herb|herbs|leaf|leaves|root|roots|flower|flowers|moss|mushroom)\b/i, '🌿'],
    [/\b(bandage|bandages|medkit|first aid|salve|ointment|medicine|pills?|tablets?|syringe)\b/i, '🩹'],
    [/\b(bread|loaf|biscuit|biscuits|cracker|crackers)\b/i, '🍞'],
    [/\b(cheese)\b/i, '🧀'],
    [/\b(meat|jerky|sausage|ham|bacon|steak)\b/i, '🥩'],
    [/\b(apple|apples|pear|fruit|berries|berry)\b/i, '🍎'],
    [/\b(fish|trout|herring)\b/i, '🐟'],
    [/\b(ration|rations|food|meal|provisions|supplies)\b/i, '🥫'],
    [/\b(water|waterskin|canteen)\b/i, '💧'],
    [/\b(wine|ale|beer|mead|whisky|whiskey|rum|brandy|spirits|liquor)\b/i, '🍷'],
    [/\b(tea|coffee)\b/i, '☕'],
    [/\b(tent|bedroll|blanket|sleeping bag|tarp)\b/i, '⛺'],
    [/\b(bag|sack|pouch|satchel|backpack|rucksack|pack|case|suitcase|briefcase)\b/i, '🎒'],
    [/\b(lockpick|lockpicks|picks)\b/i, '🔧'],
    [/\b(tool|tools|wrench|spanner|screwdriver|pliers|pick|pickaxe|shovel|spade|crowbar)\b/i, '🛠️'],
    [/\b(pistol|revolver|handgun|gun|rifle|shotgun|carbine|firearm)\b/i, '🔫'],
    [/\b(ammo|ammunition|bullets?|rounds|cartridges?|magazine|clip|shells)\b/i, '🧨'],
    [/\b(bomb|grenade|dynamite|explosive|explosives)\b/i, '💣'],
    [/\b(phone|telephone|mobile|cell|radio|walkie|pager)\b/i, '📱'],
    [/\b(camera)\b/i, '📷'],
    [/\b(laptop|computer|tablet|terminal|drive|usb|disk|disc)\b/i, '💻'],
    [/\b(watch|clock|pocket watch|timepiece)\b/i, '⌚'],
    [/\b(glasses|spectacles|goggles|monocle|lens|binoculars|telescope|spyglass)\b/i, '🔭'],
    [/\b(badge|warrant|licen[cs]e|pass|permit|id card|identification|papers of)\b/i, '🪪'],
    [/\b(ticket|tickets|stub|voucher|token)\b/i, '🎫'],
    [/\b(card|cards|deck)\b/i, '🃏'],
    [/\b(dice|die)\b/i, '🎲'],
    [/\b(cigarette|cigarettes|cigar|cigars|pipe|tobacco)\b/i, '🚬'],
    [/\b(umbrella|parasol)\b/i, '☂️'],
    [/\b(mirror)\b/i, '🪞'],
    [/\b(bone|bones|skull|tooth|teeth|fang|claw)\b/i, '🦴'],
    [/\b(feather|quill|plume)\b/i, '🪶'],
    [/\b(seal|stamp|signet|wax)\b/i, '📮'],
    [/\b(pen|pencil|ink|chalk)\b/i, '✒️'],
    [/\b(cloth|rag|rags|linen|silk|fabric|bandanna|scarf|handkerchief)\b/i, '🧣'],
    [/\b(needle|thread|sewing)\b/i, '🧵'],
    [/\b(soap|comb|brush|razor|perfume)\b/i, '🧼'],
    [/\b(egg|eggs)\b/i, '🥚'],
    [/\b(salt|spice|spices|pepper|sugar|flour|grain)\b/i, '🧂'],
    [/\b(oil|grease|fuel|petrol|gasoline|kerosene)\b/i, '🛢️'],
    [/\b(horn|whistle|bell|drum|flute|lute|harp|instrument)\b/i, '🎺'],
    [/\b(doll|toy|figurine|idol|statue|statuette|totem)\b/i, '🪆'],
    [/\b(orb|sphere|globe)\b/i, '🔮'],
    [/\b(ash|dust|powder|sand|salt)\b/i, '🫙'],
    [/\b(chest|box|crate|casket|coffer)\b/i, '📦'],
]);

/** The icon DES picks for a name; DEFAULT_ICON when nothing matches. */
export function iconFor(name) {
    const n = String(name || '');
    for (const [re, icon] of ICON_RULES) {
        if (re.test(n)) return icon;
    }
    return DEFAULT_ICON;
}

/** One stack, normalised. Null for a nameless one. */
export function normalizeItem(raw) {
    const r = raw && typeof raw === 'object' ? raw : { name: typeof raw === 'string' ? raw : '' };
    const name = cleanName(r.name);
    if (!name) return null;
    const icon = typeof r.icon === 'string' && r.icon.trim() ? r.icon.trim().slice(0, 8) : iconFor(name);
    return {
        name,
        count: clampInt(r.count, 1, MAX_COUNT, 1),
        note: cleanNote(r.note),
        icon,
    };
}

// ─── State ─────────────────────────────────────────────────────────────────

/** Empty containers. */
export function emptyState() {
    return { v: 1, pack: [], pouch: [] };
}

/**
 * A stored state made safe: both containers present, every stack
 * normalised, duplicates (same key) merged, and nothing past the slot
 * count dropped (the oldest stacks keep their places).
 */
export function normalizeState(raw, cfg) {
    const c = cfg || inventoryConfig(null);
    const out = emptyState();
    const src = raw && typeof raw === 'object' ? raw : {};
    for (const container of CONTAINERS) {
        const list = Array.isArray(src[container]) ? src[container] : [];
        const seen = new Map();
        for (const entry of list) {
            const spent = Number(entry?.count);
            if (Number.isFinite(spent) && spent <= 0) continue;
            const item = normalizeItem(entry);
            if (!item) continue;
            const key = itemKey(item.name);
            const prev = seen.get(key);
            if (prev) {
                prev.count = Math.min(MAX_COUNT, prev.count + item.count);
                if (!prev.note && item.note) prev.note = item.note;
            } else {
                seen.set(key, item);
            }
        }
        out[container] = [...seen.values()].slice(0, slotsFor(container, c));
    }
    return out;
}

function cloneState(state) {
    return {
        v: 1,
        pack: (state?.pack || []).map(i => ({ ...i })),
        pouch: (state?.pouch || []).map(i => ({ ...i })),
    };
}

/** The stack with this name in a container, or null. */
export function findStack(state, container, name) {
    const key = itemKey(name);
    return (state?.[container] || []).find(i => itemKey(i.name) === key) || null;
}

// ─── The stack a change means ──────────────────────────────────────────────

const FILLER_WORDS = new Set(['of', 'a', 'an', 'the', 'some']);
// Plurals in -ves whose singular ends in -f or -fe; "gloves" and "sleeves" stay.
const VES_RE = /^(?:kni|wol|loa|lea|thie|hal|cal|shel|wi|li|el|sel|scar|hoo|dwar)ves$/;

/**
 * One word's stem, the same for its singular and its plural: cigarettes and
 * cigarette, torches and torch, berries and berry, knives and knife, axes
 * and axe. Only equality between stems means anything.
 */
export function stemWord(word) {
    let w = String(word || '').toLowerCase();
    if (w.length <= 2) return w;
    if (/ies$/.test(w)) w = w.slice(0, -3) + 'y';
    else if (VES_RE.test(w)) w = w.slice(0, -3) + 'f';
    else if (/(?:sh|ch|x|z|ss)es$/.test(w)) w = w.slice(0, -2);
    else if (/[^s]s$/.test(w)) w = w.slice(0, -1);
    return w.length >= 3 ? w.replace(/e$/, '') : w;
}

/** A name's words, fillers out, each stemmed: "pack of cigarettes" → ["pack", "cigarett"]. */
export function stemWords(name) {
    return itemKey(name).split(/[^\p{L}\p{N}'’]+/u).filter(w => w && !FILLER_WORDS.has(w)).map(stemWord);
}

/**
 * Which stack of a list a change means. The exact name first (case and
 * spacing aside), then the same words singular or plural ("cigarette" for
 * "cigarettes"); loose, also a name whose words all appear in the other's
 * ("cigarettes" against "pack of cigarettes", "silver" against "silver
 * coins") and last one short word that starts a stack's word ("cig").
 * One distinct stack is a match; several are ambiguous and none wins.
 */
export function matchStack(list, name, { loose = false } = {}) {
    const items = Array.isArray(list) ? list : [];
    const key = itemKey(name);
    const exact = items.findIndex(i => itemKey(i.name) === key);
    if (exact >= 0) return { idx: exact, candidates: [exact] };
    const words = stemWords(name);
    if (!words.length) return { idx: -1, candidates: [] };
    const stems = items.map(i => stemWords(i.name));
    const hits = (test) => stems.reduce((out, w, j) => (test(w) ? out.concat(j) : out), []);
    const sameWords = (a, b) => a.length === b.length && a.every((x, k) => x === b[k]);
    let found = hits(w => sameWords(w, words));
    if (!found.length && loose) {
        found = hits(w => words.every(x => w.includes(x)) || w.every(x => words.includes(x)));
        if (!found.length && words.length === 1 && words[0].length >= 3) {
            found = hits(w => w.some(x => x.startsWith(words[0])));
        }
    }
    return { idx: found.length === 1 ? found[0] : -1, candidates: found };
}

/** How many kinds of item a container holds. */
export function slotsUsed(state, container) {
    return (state?.[container] || []).length;
}

/** Whether a container has no slot for a new kind of item. */
export function isFull(state, container, cfg) {
    return slotsUsed(state, container) >= slotsFor(container, cfg);
}

// ─── Changes ───────────────────────────────────────────────────────────────

/** Tool verbs that mean "remove"; anything else adds. "take" is picking up. */
const REMOVE_ACTIONS = new Set(['remove', 'drop', 'use', 'lose', 'sell', 'give', 'spend', 'discard']);

/**
 * A change: { container: 'pack'|'pouch', action: 'add'|'remove', name,
 * count, note }. Normalised; null when there is nothing to do.
 */
export function normalizeChange(raw) {
    const r = raw && typeof raw === 'object' ? raw : {};
    const name = cleanName(r.name ?? r.item);
    if (!name) return null;
    const container = String(r.container || 'pack').toLowerCase() === 'pouch' ? 'pouch' : 'pack';
    let action = String(r.action || 'add').toLowerCase();
    if (REMOVE_ACTIONS.has(action)) action = 'remove';
    else action = 'add';
    return {
        container,
        action,
        name,
        count: clampInt(r.count, 1, MAX_COUNT, 1),
        note: cleanNote(r.note),
        icon: typeof r.icon === 'string' && r.icon.trim() ? r.icon.trim().slice(0, 8) : '',
    };
}

/**
 * Applies changes in order to a copy of the state. Each applied change
 * records the stack before and after, and its slot, so a swipe can put it
 * back exactly.
 * A new kind of item cannot enter a full container; removing what is not
 * there does nothing. Both are reported, never thrown.
 * @returns {{ state: object, applied: object[], rejected: object[] }}
 */
export function applyChanges(state, changes, cfg) {
    const c = cfg || inventoryConfig(null);
    const next = cloneState(state);
    const applied = [];
    const rejected = [];
    for (const raw of (Array.isArray(changes) ? changes : []).slice(0, MAX_CHANGES)) {
        const ch = normalizeChange(raw);
        if (!ch) continue;
        const list = next[ch.container];
        const found = matchStack(list, ch.name, { loose: ch.action !== 'add' });
        const idx = found.idx;
        const before = idx >= 0 ? { ...list[idx] } : null;
        if (ch.action === 'add') {
            if (idx >= 0) {
                list[idx].count = Math.min(MAX_COUNT, list[idx].count + ch.count);
                if (ch.note) list[idx].note = ch.note;
            } else {
                if (list.length >= slotsFor(ch.container, c)) {
                    rejected.push({ change: ch, reason: 'full' });
                    continue;
                }
                list.push({ name: ch.name, count: ch.count, note: ch.note, icon: ch.icon || iconFor(ch.name) });
            }
            const at = idx >= 0 ? idx : list.length - 1;
            const after = { ...list[at] };
            applied.push({ ...ch, name: after.name, index: at, before, after, delta: after.count - (before ? before.count : 0) });
        } else {
            if (idx < 0) {
                const candidates = found.candidates.map(j => list[j].name);
                rejected.push({ change: ch, reason: candidates.length > 1 ? 'ambiguous' : 'missing', candidates });
                continue;
            }
            const taken = Math.min(ch.count, list[idx].count);
            list[idx].count -= taken;
            let after = null;
            if (list[idx].count <= 0) list.splice(idx, 1);
            else after = { ...list[idx] };
            applied.push({ ...ch, name: before.name, index: idx, count: taken, before, after, delta: -taken });
        }
    }
    return { state: next, applied, rejected };
}

/**
 * Puts back what an applied list did, newest change first. A stack nothing
 * has moved since is restored exactly (its slot, note and icon included);
 * one that later changes touched gives up only this change's share of the
 * count, so undoing an older reply leaves the newer ones standing.
 */
export function revertApplied(state, applied) {
    const next = cloneState(state);
    const at = (list, i) => Math.min(Number.isInteger(i) ? i : list.length, list.length);
    for (const a of [...(applied || [])].reverse()) {
        if (!a || !a.container) continue;
        const list = next[a.container];
        const key = itemKey(a.name);
        const idx = list.findIndex(i => itemKey(i.name) === key);
        const cur = idx >= 0 ? list[idx] : null;
        const untouched = a.after ? !!cur && cur.count === a.after.count : !cur;
        if (untouched) {
            if (a.before) {
                if (idx >= 0) list[idx] = { ...a.before };
                else list.splice(at(list, a.index), 0, { ...a.before });
            } else if (idx >= 0) {
                list.splice(idx, 1);
            }
            continue;
        }
        const delta = Number.isFinite(a.delta) ? a.delta : 0;
        if (!delta) continue;
        if (cur) {
            cur.count = Math.min(MAX_COUNT, cur.count - delta);
            if (cur.count <= 0) list.splice(idx, 1);
        } else if (delta < 0) {
            const base = a.before || a.after || { name: a.name, note: a.note || '', icon: a.icon || iconFor(a.name) };
            list.splice(at(list, a.index), 0, { ...base, count: Math.min(MAX_COUNT, -delta) });
        }
    }
    return next;
}

/** A hand edit: set a stack's fields (count 0 removes it). */
export function setStack(state, container, name, fields, cfg) {
    const c = cfg || inventoryConfig(null);
    const next = cloneState(state);
    const list = next[CONTAINERS.includes(container) ? container : 'pack'];
    const key = itemKey(name);
    const idx = list.findIndex(i => itemKey(i.name) === key);
    const f = fields && typeof fields === 'object' ? fields : {};
    const count = f.count === undefined ? (idx >= 0 ? list[idx].count : 1) : clampInt(f.count, 0, MAX_COUNT, 1);
    if (count <= 0) {
        if (idx >= 0) list.splice(idx, 1);
        return { state: next, ok: true };
    }
    const newName = f.name !== undefined ? cleanName(f.name) : (idx >= 0 ? list[idx].name : cleanName(name));
    if (!newName) return { state, ok: false, reason: 'name' };
    const merged = {
        name: newName,
        count,
        note: f.note !== undefined ? cleanNote(f.note) : (idx >= 0 ? list[idx].note : ''),
        icon: f.icon !== undefined && String(f.icon).trim() ? String(f.icon).trim().slice(0, 8) : (idx >= 0 ? list[idx].icon : iconFor(newName)),
    };
    if (idx >= 0) {
        // A rename onto another stack's name folds into it.
        const other = list.findIndex((i, j) => j !== idx && itemKey(i.name) === itemKey(newName));
        if (other >= 0) {
            list[other].count = Math.min(MAX_COUNT, list[other].count + merged.count);
            list.splice(idx, 1);
        } else {
            list[idx] = merged;
        }
        return { state: next, ok: true };
    }
    if (list.length >= slotsFor(container, c)) return { state, ok: false, reason: 'full' };
    list.push(merged);
    return { state: next, ok: true };
}

/** Moves a count of a stack between the two containers; all or nothing. */
export function moveStack(state, name, from, to, count, cfg) {
    const c = cfg || inventoryConfig(null);
    if (from === to || !CONTAINERS.includes(from) || !CONTAINERS.includes(to)) return { state, ok: false, reason: 'containers' };
    const stack = findStack(state, from, name);
    if (!stack) return { state, ok: false, reason: 'missing' };
    const n = clampInt(count, 1, stack.count, stack.count);
    const target = findStack(state, to, name);
    if (!target && isFull(state, to, c)) return { state, ok: false, reason: 'full' };
    const step1 = applyChanges(state, [{ container: from, action: 'remove', name: stack.name, count: n }], c);
    const step2 = applyChanges(step1.state, [{ container: to, action: 'add', name: stack.name, count: n, note: stack.note, icon: stack.icon }], c);
    if (step2.rejected.length) return { state, ok: false, reason: step2.rejected[0].reason };
    return { state: step2.state, ok: true };
}

// ─── The tag ───────────────────────────────────────────────────────────────

export const ITEM_TAG_RE = /\[\s*ITEMS?\s*:\s*([^\]]*?)\s*\]/gi;

// Verbs a model may write instead of a sign. "takes" is picking up.
const ADD_VERB_RE = /^(?:add|adds|added|gain|gains|gained|take|takes|took|get|gets|got|find|finds|found|buy|buys|bought|receive|receives|received|pick(?:s|ed)? up|keep|keeps|kept)\s+(\d+)?(?:\s*[x×](?=\s))?\s*/i;
const REMOVE_VERB_RE = /^(?:remove|removes|removed|lose|loses|lost|use(?:s|d)?(?:\s+up)?|drop|drops|dropped|give|gives|gave|sell|sells|sold|spend|spends|spent|discard|discards|discarded|hand(?:s|ed)? over|throw(?:s)? away|threw away)\s+(\d+)?(?:\s*[x×](?=\s))?\s*/i;
// Verbs of using something up. They double as names ("smoked ham", "burnt
// offering"), so they count as a verb only before a number or an article.
const CONSUME_VERB_RE = /^(?:smokes?|smoked|eats?|ate|eaten|drinks?|drank|drunk|consumes?|consumed|swallows?|swallowed|quaffs?|quaffed|burns?|burn(?:ed|t))\s+(?=\d|(?:an?|the|some|one|another)\s)(\d+)?(?:\s*[x×](?=\s))?\s*/i;
// What a model writes when told about the tag but nothing changed hands: not an item.
const NOTHING_RE = /^(?:none|nothing(?:\s+changed(?:\s+hands)?)?|no\s+(?:changes?|items?\b.*)|n\/?a|null|nil|[-–—]+)\.?$/i;

/**
 * "[ITEM: +1 iron key (from the warden's desk) | -1 torch | pouch +3 silver
 * coins]" → changes. Every tag in the text, in order. An entry is an
 * optional container word, a sign with an optional count (or no sign, which
 * adds), the name, an optional "×2"/"x2" after it, and an optional note in
 * parentheses. Entries that name nothing are skipped.
 */
export function parseItemTags(text) {
    const s = String(text || '');
    const out = [];
    for (const m of s.matchAll(ITEM_TAG_RE)) {
        const body = m[1];
        if (!body) continue;
        for (const piece of body.split('|')) {
            const ch = parseTagEntry(piece);
            if (ch) out.push(ch);
            if (out.length >= MAX_CHANGES) return out;
        }
    }
    return out;
}

function parseTagEntry(piece) {
    let p = String(piece || '').trim();
    if (!p) return null;
    let container = 'pack';
    // A container word, then a colon or a space, then the item. "pack of
    // cards" and "pouch of herbs" are items; so is a bare "pouch".
    const cm = p.match(/^(?:the\s+)?(?:party(?:['’]s)?\s+)?(?:shared\s+)?(pack|pouch)\b(?!\s+of\b)\s*:?\s*/i);
    if (cm && p.slice(cm[0].length).trim()) {
        container = /pouch/i.test(cm[1]) ? 'pouch' : 'pack';
        p = p.slice(cm[0].length).trim();
    }
    let action = 'add';
    let count = 1;
    const sm = p.match(/^([+\-−–])\s*(\d+)?(?:\s*[x×](?=\s))?\s*/);
    if (sm) {
        action = sm[1] === '+' ? 'add' : 'remove';
        if (sm[2]) count = clampInt(sm[2], 1, MAX_COUNT, 1);
        p = p.slice(sm[0].length).trim();
    } else {
        let vm = p.match(ADD_VERB_RE);
        if (vm) {
            action = 'add';
        } else if ((vm = p.match(REMOVE_VERB_RE)) || (vm = p.match(CONSUME_VERB_RE))) {
            action = 'remove';
        }
        if (vm) {
            if (vm[1]) count = clampInt(vm[1], 1, MAX_COUNT, 1);
            p = p.slice(vm[0].length).trim().replace(/^(?:one|another)\s+/i, '');
        }
    }
    let note = '';
    const nm = p.match(/\(([^)]*)\)\s*$/);
    if (nm) {
        note = nm[1];
        p = p.slice(0, nm.index).trim();
    }
    const xm = p.match(/(?:\s+[x×]\s*|×\s*)(\d+)$/i);
    if (xm) {
        count = clampInt(xm[1], 1, MAX_COUNT, count);
        p = p.slice(0, xm.index).trim();
    }
    const lead = p.match(/^(\d+)(?:\s*[x×](?=\s))?\s+(.+)$/);
    if (lead && !sm?.[2]) {
        count = clampInt(lead[1], 1, MAX_COUNT, count);
        p = lead[2];
    }
    p = p.replace(/^(an?|the|some)\s+/i, '');
    if (NOTHING_RE.test(p)) return null;
    const name = cleanName(p);
    if (!name) return null;
    return { container, action, name, count, note: cleanNote(note), icon: '' };
}

/** The reply with every "[ITEM: ...]" tag removed, for display. */
export function stripItemTags(text) {
    return String(text || '').replace(/[ \t]*\[\s*ITEMS?\s*:\s*[^\]]*?\s*\]/gi, '').replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n').trim();
}

// ─── The tool ──────────────────────────────────────────────────────────────

/** Changes from the tool's arguments ({ changes: [...] }), or null. */
export function changesFromToolArgs(args) {
    let a = args;
    if (typeof a === 'string') {
        try { a = JSON.parse(a); } catch (e) { return null; }
    }
    if (!a || typeof a !== 'object') return null;
    const list = Array.isArray(a.changes) ? a.changes : Array.isArray(a.items) ? a.items : Array.isArray(a) ? a : null;
    if (!list) return null;
    const out = list.map(normalizeChange).filter(Boolean).slice(0, MAX_CHANGES);
    return out.length ? out : null;
}

/** The function tool, for SillyTavern's registerFunctionTool. */
export function buildInventoryToolDefinition({ settings, userName = 'the player' } = {}) {
    const cfg = inventoryConfig(settings);
    return {
        name: INVENTORY_TOOL_NAME,
        displayName: 'Inventory change',
        description: `Record a change to what ${userName} carries (the pack) or to the party's shared pouch: an item picked up, bought, given, found, used up, dropped, sold or handed over in this reply. Call it once per reply at most, only for things that actually changed hands in the story; never to list what is already carried. The pack has ${cfg.packSlots} slots and the pouch ${cfg.pouchSlots}, one per kind of item; a full container cannot take a new kind, so say so in the story instead. The result tells you what was recorded.`,
        parameters: {
            $schema: 'http://json-schema.org/draft-04/schema#',
            type: 'object',
            properties: {
                changes: {
                    type: 'array',
                    description: 'Each item that changed, one entry per kind.',
                    minItems: 1,
                    maxItems: MAX_CHANGES,
                    items: {
                        type: 'object',
                        properties: {
                            container: { type: 'string', enum: ['pack', 'pouch'], description: `pack: ${userName}'s own things (the default); pouch: the party's shared pouch.` },
                            action: { type: 'string', enum: ['add', 'remove'], description: 'add: gained; remove: used up (a cigarette smoked, a ration eaten, a potion drunk), dropped, sold or handed over.' },
                            item: { type: 'string', description: 'The item, short and plain, spelled as the INVENTORY line spells it: "iron key", "torch", "silver coins".' },
                            count: { type: 'integer', minimum: 1, description: 'How many; 1 when left out.' },
                            note: { type: 'string', description: 'A few words only when they matter later: where it came from, what it opens.' },
                        },
                        required: ['action', 'item'],
                    },
                },
                reason: { type: 'string', description: 'Optional: the moment in the story, in a few words.' },
            },
            required: ['changes'],
        },
    };
}

// ─── Prompt text ───────────────────────────────────────────────────────────

function stackText(i, { withNotes = true } = {}) {
    const count = i.count > 1 ? ` ×${i.count}` : '';
    const note = withNotes && i.note ? ` (${i.note.length > 40 ? `${i.note.slice(0, 39).trimEnd()}…` : i.note})` : '';
    return `${i.name}${count}${note}`;
}

function containerText(state, container, cfg, label, opts) {
    const list = state?.[container] || [];
    const slots = slotsFor(container, cfg);
    const body = list.length ? list.map(i => stackText(i, opts)).join(', ') : 'empty';
    return `${label} ${list.length}/${slots}: ${body}`;
}

/**
 * The one line the model reads: both containers, counts and short notes.
 * Notes go first when the line runs long, then the tail of each list.
 */
export function buildInventoryLine(state, settings, { userName = 'the player' } = {}) {
    const cfg = inventoryConfig(settings);
    const make = (opts) => `[INVENTORY: ${containerText(state, 'pack', cfg, `${userName}'s pack`, opts)}; ${containerText(state, 'pouch', cfg, 'party pouch', opts)}. Read-only here: say what changes, never rewrite the list.]`;
    let line = make({ withNotes: true });
    if (line.length > 700) line = make({ withNotes: false });
    return line;
}

function fullness(state, cfg, userName) {
    const parts = [];
    for (const container of CONTAINERS) {
        if (isFull(state, container, cfg)) parts.push(container === 'pack' ? `${userName}'s pack is full` : 'the party pouch is full');
    }
    return parts.length ? ` ${parts.join('; ')}: no new kind of item fits there until something goes; say so in the story rather than adding.` : '';
}

/**
 * What the game master is told when it may record changes by ending a
 * reply with a tag. Short, and firm that most replies have none.
 */
export function buildItemTagInstruction({ settings, userName = 'the player', state } = {}) {
    const cfg = inventoryConfig(settings);
    return `[ITEMS: When something actually changes hands in this reply, ${userName} picks up, buys, is given, finds, uses up, drops, sells or hands over an item, or the party's shared pouch gains or loses something, record it with ONE line in exactly this form at the very end of your narration: [ITEM: +1 iron key (from the warden's desk) | -1 torch | pouch +3 silver coins]. Using one up counts, however small the moment: a cigarette smoked, a ration eaten, a potion drunk, an arrow loosed or a coin spent is "-1" of that stack in the same reply. One entry per kind of item, separated by |; + adds and - removes; a count before the name; name the item as the INVENTORY line spells it ("-1 cigarettes" when the pack says cigarettes); a short note in parentheses only when it will matter later; start an entry with "pouch" for the shared pouch, otherwise it is ${userName}'s pack. Record only what the story showed; never list what is already carried, never invent gear, and most replies have no line at all: when nothing changed hands or was used up, write no line, never a placeholder like "[ITEM: none]".${fullness(state, cfg, userName)} The line replaces nothing: anything else you are required to output (a tracker or data block, for instance) still follows as usual.]`;
}

/** What the game master is told when the inventory tool is available to it. */
export function buildItemToolInstruction({ settings, userName = 'the player', state } = {}) {
    const cfg = inventoryConfig(settings);
    return `[ITEMS: When something actually changes hands in this reply, ${userName} picks up, buys, is given, finds, uses up, drops, sells or hands over an item, or the party's shared pouch gains or loses something, call the ${INVENTORY_TOOL_NAME} tool once with every item that changed, after you know how the scene goes; its result confirms what was recorded. Using one up counts, however small the moment: a cigarette smoked, a ration eaten, a potion drunk, an arrow loosed or a coin spent is a remove of 1 from that stack in the same reply, the item spelled as the INVENTORY line spells it. Record only what the story showed; never list what is already carried, never invent gear, and most replies need no call.${fullness(state, cfg, userName)} A tool call does not change the shape of your reply: the tracker data block and everything else you are required to output still follow as usual.]`;
}

/** One line for a toast or the tool's answer: what went in, what came out, what would not fit. */
export function describeApplied(applied, rejected, { userName = 'the player' } = {}) {
    const parts = [];
    for (const a of applied || []) {
        const where = a.container === 'pouch' ? 'pouch' : 'pack';
        parts.push(`${a.action === 'add' ? '+' : '−'}${a.count} ${a.name} (${where})`);
    }
    for (const r of rejected || []) {
        const ch = r.change || {};
        const where = ch.container === 'pouch' ? 'the party pouch' : `${userName}'s pack`;
        if (r.reason === 'full') parts.push(`${where} is full: ${ch.name} not added`);
        else if (r.reason === 'ambiguous' && Array.isArray(r.candidates) && r.candidates.length > 1) parts.push(`${ch.name} could be ${r.candidates.join(' or ')} in ${where}: nothing removed`);
        else parts.push(`${ch.name} was not in ${where}: nothing removed`);
    }
    return parts.length ? parts.join(' · ') : 'no change';
}
