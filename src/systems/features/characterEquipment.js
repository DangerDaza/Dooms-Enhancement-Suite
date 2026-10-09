/**
 * Character Equipment — storage and AI round-trip.
 *
 * Every character (persona and NPCs) carries items shown in the Stats panel.
 * Equipment belongs to the chat (see chatScope.js):
 *   chat_metadata.dooms_tracker.betterStats.characterEquipment["npc:Name"|"user:Name"] = [item, ...]
 *
 * The AI adds and removes items through an "equipment" key in the tracker
 * JSON. It can only remove items whose aiCanRemove is on; the others are
 * locked by the user.
 *
 * Starting gear: a character whose list is empty is asked about once — the
 * AI adds what they already carry, from their description and the scene.
 * betterStats.characterEquipmentSeeded[key] is true once
 * asked, or 'request' when the user asked for it again from the panel. Swiping or regenerating a reply undoes its changes
 * (chat_metadata.dooms_tracker.equipmentUndo).
 *
 * The pure logic is in src/utils/equipmentModel.js.
 */
import { getContext } from '../../../../../../extensions.js';
import { chat, chat_metadata } from '../../../../../../../script.js';
import { extensionSettings } from '../../core/state.js';
import { isRpgModeActive } from './rpgMode.js';
import { chatStore, chatRootView, saveChatScope, CHAT_SCOPE } from './chatScope.js';
import { saveSettings, saveChatData } from '../../core/persistence.js';
import {
    MAX_ITEMS,
    MAX_QTY,
    makeItem,
    findItem,
    normalizeItem,
    normalizeAIEquipment,
    applyEquipmentChange,
    buildEquipmentPrompt,
    formatLoadout,
} from '../../utils/equipmentModel.js';
import { parseEffects, formatEffects } from '../../utils/effectsModel.js';
import {
    getStatCharacters,
    getStatSheet,
    statKey,
    notifyStatsChanged,
    PLAYER_WORDS,
} from './characterStats.js';

// ─── Settings ───────────────────────────────────────────────────────────────

export function isEquipmentEnabled() {
    return isRpgModeActive() && extensionSettings.characterEquipmentEnabled !== false;
}

export function setEquipmentEnabled(on) {
    extensionSettings.characterEquipmentEnabled = !!on;
    saveSettings();
    notifyStatsChanged({ source: 'settings' });
}

// ─── Storage ────────────────────────────────────────────────────────────────

function bucket(create = false) {
    return chatStore('characterEquipment', create);
}

function findKey(obj, key) {
    if (!obj || !key) return undefined;
    if (Object.prototype.hasOwnProperty.call(obj, key)) return key;
    const lower = key.toLowerCase();
    return Object.keys(obj).find(k => k.toLowerCase() === lower);
}

function listByKey(key, create = false) {
    const b = bucket(create);
    if (!b) return null;
    const k = findKey(b, key);
    if (k !== undefined) return b[k];
    if (!create) return null;
    b[key] = [];
    return b[key];
}

/** The character's items in the open chat (live array; old items get qty/equipped/effects). */
export function getEquipment(name, isUser = false) {
    const list = listByKey(statKey(name, isUser));
    if (!Array.isArray(list)) return [];
    for (const i of list) normalizeItem(i);
    return list;
}

/** Raw effects (object or "STR +2") → { statId: n } for this character's attributes. */
export function resolveEffectsFor(name, isUser, raw) {
    return parseEffects(raw, getStatSheet(name, isUser));
}

/** "STR +2, DEX −1" for this character. */
export function describeEffects(name, isUser, effects) {
    return formatEffects(effects, getStatSheet(name, isUser));
}

function changed(detail) {
    saveChatScope();
    notifyStatsChanged({ source: 'equipment', ...detail });
}

/** Adds an item by hand. Returns the item or { error }. */
export function addItem(name, isUser, input) {
    const effects = input && input.effects !== undefined ? resolveEffectsFor(name, isUser, input.effects) : {};
    const item = makeItem({ ...input, effects, source: 'user' });
    if (!item) return { error: 'Give the item a name.' };
    const list = listByKey(statKey(name, isUser), true);
    if (findItem(list, item.name)) return { error: `${name} already has "${item.name}".` };
    if (list.length >= MAX_ITEMS) return { error: `At most ${MAX_ITEMS} items.` };
    list.push(item);
    changed({ name });
    return item;
}

export function updateItem(name, isUser, id, changes = {}) {
    const item = getEquipment(name, isUser).find(i => i.id === id);
    if (!item) return false;
    if (typeof changes.aiCanRemove === 'boolean') item.aiCanRemove = changes.aiCanRemove;
    if (typeof changes.desc === 'string') item.desc = changes.desc.trim().slice(0, 120);
    if (typeof changes.icon === 'string' && changes.icon.trim()) item.icon = makeItem({ name: 'x', icon: changes.icon }).icon;
    if (typeof changes.name === 'string' && changes.name.trim()) {
        const n = changes.name.trim().slice(0, 40);
        const dup = findItem(getEquipment(name, isUser), n);
        if (dup && dup.id !== id) return { error: `${name} already has "${n}".` };
        item.name = n;
    }
    if (typeof changes.equipped === 'boolean') item.equipped = changes.equipped;
    if (changes.qty !== undefined) {
        const q = Math.round(Number(changes.qty));
        if (Number.isFinite(q)) {
            if (q <= 0) return removeItem(name, isUser, id);
            item.qty = Math.min(MAX_QTY, q);
        }
    }
    if (changes.effects !== undefined) item.effects = resolveEffectsFor(name, isUser, changes.effects);
    changed({ name });
    return true;
}

/** The user removes an item — locked or not. */
export function removeItem(name, isUser, id) {
    const list = listByKey(statKey(name, isUser));
    if (!list) return false;
    const i = list.findIndex(x => x.id === id);
    if (i === -1) return false;
    list.splice(i, 1);
    changed({ name });
    return true;
}

/** Forgets a deleted character's equipment, in the open chat. */
export function deleteEquipmentEverywhere(name, isUser = false) {
    const root = chatRootView('characterEquipment');
    if (!root || !name) return;
    const key = statKey(name, isUser).toLowerCase();
    for (const b of Object.values(root)) {
        for (const k of Object.keys(b || {})) if (k.toLowerCase() === key) delete b[k];
    }
}

/** An alias merge: the variant's items join the canonical NPC's. */
export function mergeEquipment(canonical, variant) {
    const root = chatRootView('characterEquipment');
    if (!root || !canonical || !variant) return;
    const vKey = statKey(variant, false);
    const cKey = statKey(canonical, false);
    for (const b of Object.values(root)) {
        const vk = findKey(b, vKey);
        if (vk === undefined) continue;
        const ck = findKey(b, cKey);
        const target = ck !== undefined ? b[ck] : (b[cKey] = []);
        for (const it of b[vk] || []) if (!findItem(target, it.name)) target.push(it);
        if (vk !== (ck ?? cKey)) delete b[vk];
    }
}

// ─── Starting gear ──────────────────────────────────────────────────────────

function seededBucket(create = false) {
    return chatStore('characterEquipmentSeeded', create);
}

function seededState(key) {
    const b = seededBucket();
    const k = findKey(b, key);
    return k !== undefined ? b[k] : undefined;
}

/** Will the next reply be asked to fill in this character's starting gear? */
export function needsStartingGear(name, isUser = false) {
    const key = statKey(name, isUser);
    const state = seededState(key);
    if (state === 'request') return true;
    return !state && getEquipment(name, isUser).length === 0;
}

/** The user asks for the starting gear again (next reply, even with a list). */
export function requestStartingGear(name, isUser = false) {
    const b = seededBucket(true);
    const key = statKey(name, isUser);
    const k = findKey(b, key);
    b[k !== undefined ? k : key] = 'request';
    changed({ name });
}

/** Cancels a pending request (or marks the gear as already handled). */
export function cancelStartingGear(name, isUser = false) {
    const b = seededBucket(true);
    const key = statKey(name, isUser);
    const k = findKey(b, key);
    b[k !== undefined ? k : key] = true;
    changed({ name });
}

// ─── Prompt ─────────────────────────────────────────────────────────────────

export function buildEquipmentPromptForGeneration({ compact = true, standalone = false } = {}) {
    if (!isEquipmentEnabled()) return '';
    const entries = getStatCharacters().map(({ name, isUser }) => ({
        name,
        isUser,
        items: getEquipment(name, isUser),
        needsGear: needsStartingGear(name, isUser),
        formatEffect: (eff) => describeEffects(name, isUser, eff),
    }));
    return buildEquipmentPrompt(entries, { compact, standalone });
}

export function buildEquipmentContextSummary() {
    if (!isEquipmentEnabled()) return '';
    const lines = getStatCharacters()
        .map(({ name, isUser }) => ({ name, isUser, items: getEquipment(name, isUser) }))
        .filter(e => e.items.length)
        .map(e => `${e.name} — ${formatLoadout(e.items, (eff) => describeEffects(e.name, e.isUser, eff), { icons: false })}`);
    return lines.length ? 'Equipment:\n' + lines.join('\n') : '';
}

// ─── Applying the AI's update ───────────────────────────────────────────────

/** Maps a name the AI used to a storage key (persona, alias, scene, or as given). */
export function resolveTarget(name) {
    const lower = String(name).trim().toLowerCase();
    if (!lower) return null;
    let userName = '';
    try { userName = String(getContext().name1 || '').toLowerCase(); } catch (e) {}
    const scene = getStatCharacters();
    const persona = scene.find(c => c.isUser);
    if (persona && (persona.name.toLowerCase() === lower || lower === userName || PLAYER_WORDS.includes(lower))) return { name: persona.name, isUser: true };
    const aliases = extensionSettings.characterAliases || {};
    for (const [canon, list] of Object.entries(aliases)) {
        if (Array.isArray(list) && list.some(a => String(a).toLowerCase() === lower)) return { name: canon, isUser: false };
    }
    const npc = scene.find(c => !c.isUser && c.name.toLowerCase() === lower);
    if (npc) return { name: npc.name, isUser: false };
    if (Object.keys(extensionSettings.userCharacters || {}).some(n => n.toLowerCase() === lower)) return null;
    // Anyone else must be a character DES already knows — otherwise a stray
    // key (e.g. an old-style inventory's "onPerson") would become a character.
    const known = [
        extensionSettings.knownCharacters,
        chat_metadata?.dooms_tracker?.knownCharacters,
        extensionSettings.characterStatSheets?.npc,
        extensionSettings.npcAvatars,
    ];
    for (const map of known) {
        const k = map && typeof map === 'object' ? Object.keys(map).find(n => n.toLowerCase() === lower) : undefined;
        if (k) return { name: k, isUser: false };
    }
    const existing = bucket();
    const ek = existing ? Object.keys(existing).find(k => k.toLowerCase() === `npc:${lower}`) : undefined;
    if (ek) return { name: ek.slice(4), isUser: false };
    console.log(`[Dooms Tracker] Equipment: ignored "${name}" — not a known character`);
    return null;
}

/**
 * Applies the AI's equipment changes for a fresh reply.
 * Undo keeps a snapshot of every list the reply touched (before and after):
 * a swipe restores "before" only where the list still equals "after", so an
 * edit the user made since is never thrown away.
 * @returns {{added: number, removed: number, changed: number, blocked: Array<{name: string, item: string}>}}
 */
export function applyAIEquipment(raw, messageIndex) {
    const result = { added: 0, removed: 0, changed: 0, blocked: [] };
    if (!isEquipmentEnabled() || raw === null || raw === undefined) return result;
    const snapshots = [];
    // The characters this reply was asked to give starting gear to: asked
    // once, so they are marked as done whatever the reply contained.
    const asked = getStatCharacters()
        .filter(c => needsStartingGear(c.name, c.isUser))
        .map(c => ({ key: statKey(c.name, c.isUser), prev: seededState(statKey(c.name, c.isUser)) ?? null }));
    for (const change of normalizeAIEquipment(raw)) {
        const target = resolveTarget(change.name);
        if (!target) continue;
        const key = statKey(target.name, target.isUser);
        const live = listByKey(key, true);
        for (const i of live) normalizeItem(i);
        const before = JSON.parse(JSON.stringify(live));
        const res = applyEquipmentChange(live, change, (rawEff) => resolveEffectsFor(target.name, target.isUser, rawEff));
        for (const item of res.blocked) result.blocked.push({ name: target.name, item: item.name });
        if (!res.added && !res.removed && !res.changed) continue;
        live.splice(0, live.length, ...res.list);
        result.added += res.added;
        result.removed += res.removed;
        result.changed += res.changed;
        const prevSnap = snapshots.find(x => x.key === key);
        if (prevSnap) prevSnap.after = JSON.parse(JSON.stringify(live));
        else snapshots.push({ key, before, after: JSON.parse(JSON.stringify(live)) });
    }
    console.log(`[Dooms Tracker] Equipment: ${result.added} added, ${result.removed} removed, ${result.changed} changed${result.blocked.length ? `, ${result.blocked.length} locked kept` : ''}`);
    if (asked.length) {
        const sb = seededBucket(true);
        for (const a of asked) {
            const k = findKey(sb, a.key);
            sb[k !== undefined ? k : a.key] = true;
        }
    }
    if (!snapshots.length && !asked.length) return result;
    const campaign = CHAT_SCOPE;
    try {
        if (chat_metadata) {
            if (!chat_metadata.dooms_tracker) chat_metadata.dooms_tracker = {};
            const prev = chat_metadata.dooms_tracker.equipmentUndo;
            const same = prev && prev.messageIndex === messageIndex && prev.campaign === campaign;
            let snaps = snapshots;
            if (same && Array.isArray(prev.snapshots)) {
                // A Refresh of the same reply: keep the oldest "before".
                snaps = prev.snapshots.map(p => ({ ...p }));
                for (const sn of snapshots) {
                    const old = snaps.find(x => x.key === sn.key);
                    if (old) old.after = sn.after;
                    else snaps.push(sn);
                }
            }
            chat_metadata.dooms_tracker.equipmentUndo = {
                messageIndex,
                campaign,
                snapshots: snaps,
                seeded: same ? [...(prev.seeded || []), ...asked] : asked,
            };
        }
    } catch (e) { /* undo is best-effort */ }
    changed({ source: 'ai' });
    return result;
}

/** Before a swipe/regenerate replaces a reply, undo its equipment changes. */
export function revertAIEquipmentForReplacedMessage(replacedIndex) {
    try {
        const rec = chat_metadata?.dooms_tracker?.equipmentUndo;
        if (!rec) return 0;
        const lastIdx = Array.isArray(chat) ? chat.length - 1 : -1;
        const idx = typeof replacedIndex === 'number' ? replacedIndex : lastIdx;
        if (rec.messageIndex !== idx && rec.messageIndex !== idx + 1) return 0;
        delete chat_metadata.dooms_tracker.equipmentUndo;
        if (rec.campaign !== CHAT_SCOPE) return 0;
        let n = 0;
        for (const { key, before, after } of rec.snapshots || []) {
            const live = listByKey(key, true);
            // Only where nothing changed since the AI's update.
            if (JSON.stringify(live) !== JSON.stringify(after)) continue;
            live.splice(0, live.length, ...JSON.parse(JSON.stringify(before)));
            n++;
        }
        // The replaced reply was the one asked for starting gear: ask again.
        const sb = seededBucket();
        for (const { key, prev } of rec.seeded || []) {
            if (!sb) break;
            const k = findKey(sb, key);
            if (k === undefined) continue;
            if (prev === null || prev === undefined) delete sb[k];
            else sb[k] = prev;
        }
        if (n || (rec.seeded || []).length) changed({ source: 'undo' });
        saveChatData();
        return n;
    } catch (e) {
        console.warn('[Dooms Tracker] Equipment: undo failed', e);
        return 0;
    }
}

/** Tells the user when the AI tried to take away a locked item. */
export function notifyBlockedRemovals(result) {
    const blocked = result && Array.isArray(result.blocked) ? result.blocked : [];
    if (!blocked.length) return;
    try {
        const list = blocked.map(b => `${b.name}: ${b.item}`).join(', ');
        window.toastr?.info(`The story tried to remove locked entries (${list}). They were kept — remove them from the Stats panel if you agree.`, 'Stats', { timeOut: 6000 });
    } catch (e) {}
}
