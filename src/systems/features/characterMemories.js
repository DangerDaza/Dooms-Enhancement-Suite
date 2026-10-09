/**
 * Character Memories — storage and AI round-trip.
 *
 * NPCs (never the persona) keep one-line memories of important events.
 * Memories belong to the chat (see chatScope.js), so another chat with the
 * same character starts without them:
 *   chat_metadata.dooms_tracker.betterStats.characterMemories[npcName] = [entry, ...]
 *
 * The AI can only add memories (the "memories" key of the tracker JSON),
 * and at most ONE per reply: extra ones are dropped (an important one wins).
 * Swiping or regenerating a reply removes the memories that reply added
 * (chat_metadata.dooms_tracker.memoriesUndo). Users add, edit, star and
 * delete memories in the Workshop.
 *
 * The pure logic is in src/utils/memoryModel.js.
 */
import { getContext } from '../../../../../../extensions.js';
import { chat, chat_metadata } from '../../../../../../../script.js';
import { extensionSettings } from '../../core/state.js';
import { isRpgModeActive } from './rpgMode.js';
import { chatStore, chatRootView, saveChatScope, CHAT_SCOPE } from './chatScope.js';
import { saveSettings, saveChatData } from '../../core/persistence.js';
import {
    DEFAULT_RECENT_LIMIT,
    makeMemory,
    isDuplicateMemory,
    cleanMemoryText,
    normalizeAIMemories,
    buildMemoriesPrompt,
    selectForPrompt,
} from '../../utils/memoryModel.js';
import { getStatCharacters, notifyStatsChanged, PLAYER_WORDS } from './characterStats.js';

export const MEMORIES_CHANGED_EVENT = 'dooms:memories-changed';
export const MAX_MEMORIES_PER_REPLY = 1;

// ─── Settings ───────────────────────────────────────────────────────────────

export function isMemoriesEnabled() {
    return isRpgModeActive() && extensionSettings.characterMemoriesEnabled !== false;
}

export function setMemoriesEnabled(on) {
    extensionSettings.characterMemoriesEnabled = !!on;
    saveSettings();
    notifyMemoriesChanged({ source: 'settings' });
}

/** How many normal (non-★) memories per character are still sent to the AI. */
export function getRecentLimit() {
    const n = Number(extensionSettings.characterMemoriesRecent);
    return Number.isFinite(n) && n >= 0 ? Math.min(50, Math.round(n)) : DEFAULT_RECENT_LIMIT;
}

export function setRecentLimit(n) {
    const v = Number(n);
    extensionSettings.characterMemoriesRecent = Number.isFinite(v) ? Math.max(0, Math.min(50, Math.round(v))) : DEFAULT_RECENT_LIMIT;
    saveSettings();
    notifyMemoriesChanged({ source: 'settings' });
}

// ─── Storage ────────────────────────────────────────────────────────────────

export function notifyMemoriesChanged(detail = {}) {
    try {
        window.dispatchEvent(new CustomEvent(MEMORIES_CHANGED_EVENT, { detail }));
    } catch (e) { /* no window (tests) */ }
}

function bucket(create = false) {
    return chatStore('characterMemories', create);
}

function findKey(obj, name) {
    if (!obj || !name) return undefined;
    if (Object.prototype.hasOwnProperty.call(obj, name)) return name;
    const lower = String(name).toLowerCase();
    return Object.keys(obj).find(k => k.toLowerCase() === lower);
}

/** The NPC's memories in the open chat (live array — copy before editing). */
export function getMemories(name) {
    const b = bucket();
    const k = findKey(b, name);
    const list = k !== undefined ? b[k] : null;
    return Array.isArray(list) ? list : [];
}

function listFor(name, create = true) {
    const b = bucket(create);
    if (!b) return null;
    const k = findKey(b, name);
    if (k !== undefined) return b[k];
    if (!create) return null;
    b[name] = [];
    return b[name];
}

/**
 * Adds a memory. Returns the new entry, or { error } when it is empty or a
 * repeat of one the character already has.
 */
export function addMemory(name, text, { important = false, source = 'user', persist = true } = {}) {
    if (!name) return { error: 'No character.' };
    const entry = makeMemory(text, { important, source });
    if (!entry) return { error: 'Write the memory first.' };
    const list = listFor(name);
    if (isDuplicateMemory(list, entry.text)) return { error: `${name} already remembers this.` };
    list.push(entry);
    if (persist) {
        saveChatScope();
        notifyMemoriesChanged({ name });
    }
    return entry;
}

export function updateMemory(name, id, changes = {}) {
    const m = getMemories(name).find(x => x.id === id);
    if (!m) return false;
    if (typeof changes.text === 'string') {
        const t = cleanMemoryText(changes.text);
        if (!t) return false;
        m.text = t;
    }
    if (typeof changes.important === 'boolean') m.important = changes.important;
    saveChatScope();
    notifyMemoriesChanged({ name });
    return true;
}

export function deleteMemory(name, id) {
    const list = listFor(name, false);
    if (!list) return false;
    const idx = list.findIndex(x => x.id === id);
    if (idx === -1) return false;
    list.splice(idx, 1);
    saveChatScope();
    notifyMemoriesChanged({ name });
    return true;
}

/** Forgets every memory of a deleted character, in the open chat. */
export function deleteMemoriesEverywhere(name) {
    const root = chatRootView('characterMemories');
    if (!root || !name) return;
    for (const b of Object.values(root)) {
        const k = findKey(b, name);
        if (k !== undefined) delete b[k];
    }
}

/** An alias merge: the variant's memories join the canonical character's, in the open chat. */
export function mergeMemories(canonical, variant) {
    const root = chatRootView('characterMemories');
    if (!root || !canonical || !variant) return;
    for (const b of Object.values(root)) {
        const vk = findKey(b, variant);
        if (vk === undefined) continue;
        const ck = findKey(b, canonical);
        const target = ck !== undefined ? b[ck] : (b[canonical] = []);
        for (const m of b[vk] || []) if (!isDuplicateMemory(target, m.text)) target.push(m);
        if (vk !== (ck ?? canonical)) delete b[vk];
    }
}

// ─── Prompt ─────────────────────────────────────────────────────────────────

/** NPCs in the scene (memories are never kept for the persona). */
function presentNpcs() {
    return getStatCharacters().filter(c => !c.isUser).map(c => c.name);
}

export function buildMemoriesPromptForGeneration({ compact = true, standalone = false } = {}) {
    if (!isMemoriesEnabled()) return '';
    const entries = presentNpcs().map(name => ({ name, memories: getMemories(name) }));
    return buildMemoriesPrompt(entries, { compact, standalone, recentLimit: getRecentLimit() });
}

/** Plain lines for the separate-mode context block. */
export function buildMemoriesContextSummary() {
    if (!isMemoriesEnabled()) return '';
    const limit = getRecentLimit();
    const lines = presentNpcs()
        .map(name => ({ name, shown: selectForPrompt(getMemories(name), limit) }))
        .filter(e => e.shown.length)
        .map(e => `${e.name} remembers: ${e.shown.map(m => m.text).join('; ')}`);
    return lines.length ? 'Character memories:\n' + lines.join('\n') : '';
}

// ─── Applying the AI's update ───────────────────────────────────────────────

function resolveNpcName(name) {
    const lower = String(name).toLowerCase();
    let userName = '';
    try { userName = String(getContext().name1 || '').toLowerCase(); } catch (e) {}
    const userNames = new Set(Object.keys(extensionSettings.userCharacters || {}).map(n => n.toLowerCase()));
    if (lower === userName || userNames.has(lower) || PLAYER_WORDS.includes(lower)) return null;
    // Alias → card name, then the scene's spelling, then as given.
    const aliases = extensionSettings.characterAliases || {};
    for (const [canon, list] of Object.entries(aliases)) {
        if (Array.isArray(list) && list.some(a => String(a).toLowerCase() === lower)) return canon;
    }
    const present = presentNpcs().find(n => n.toLowerCase() === lower);
    return present || String(name).trim();
}

/**
 * Adds the memories from a fresh AI reply and records an undo for it.
 * @returns {number} memories added
 */
export function applyAIMemories(raw, messageIndex) {
    if (!isMemoriesEnabled() || raw === null || raw === undefined) return 0;
    const added = [];
    // One memory per reply: candidates in order, important ones (★ or
    // flagged) first; the first one that is new for its character wins.
    const candidates = [];
    for (const entry of normalizeAIMemories(raw)) {
        const name = resolveNpcName(entry.name);
        if (!name) continue;
        for (const item of entry.items) {
            const starred = item.important || /^\s*(★|☆|\*|!)/.test(String(item.text));
            candidates.push({ name, item, starred });
        }
    }
    candidates.sort((a, b) => Number(b.starred) - Number(a.starred));
    // A Refresh of the same reply may already have added its one memory.
    const prevRec = chat_metadata?.dooms_tracker?.memoriesUndo;
    const alreadyAdded = prevRec && prevRec.messageIndex === messageIndex && prevRec.campaign === CHAT_SCOPE
        ? (prevRec.added || []).length : 0;
    for (const { name, item } of candidates) {
        if (added.length + alreadyAdded >= MAX_MEMORIES_PER_REPLY) break;
        const res = addMemory(name, item.text, { important: item.important, source: 'ai', persist: false });
        if (res && res.id) added.push({ name, id: res.id });
    }
    if (!added.length) return 0;
    const campaign = CHAT_SCOPE;
    try {
        if (chat_metadata) {
            if (!chat_metadata.dooms_tracker) chat_metadata.dooms_tracker = {};
            const prev = chat_metadata.dooms_tracker.memoriesUndo;
            const same = prev && prev.messageIndex === messageIndex && prev.campaign === campaign;
            chat_metadata.dooms_tracker.memoriesUndo = {
                messageIndex,
                campaign,
                added: same ? [...prev.added, ...added] : added,
            };
        }
    } catch (e) { /* undo is best-effort */ }
    saveChatScope();
    notifyMemoriesChanged({ source: 'ai' });
    try { notifyStatsChanged({ source: 'memories' }); } catch (e) {}
    return added.length;
}

/** Before a swipe/regenerate replaces a reply, drop the memories it added. */
export function revertAIMemoriesForReplacedMessage(replacedIndex) {
    try {
        const rec = chat_metadata?.dooms_tracker?.memoriesUndo;
        if (!rec || !Array.isArray(rec.added)) return 0;
        const lastIdx = Array.isArray(chat) ? chat.length - 1 : -1;
        const idx = typeof replacedIndex === 'number' ? replacedIndex : lastIdx;
        if (rec.messageIndex !== idx && rec.messageIndex !== idx + 1) return 0;
        delete chat_metadata.dooms_tracker.memoriesUndo;
        if (rec.campaign !== CHAT_SCOPE) return 0;
        let removed = 0;
        for (const { name, id } of rec.added) {
            const list = listFor(name, false);
            if (!list) continue;
            const i = list.findIndex(m => m.id === id && m.source === 'ai');
            if (i !== -1) { list.splice(i, 1); removed++; }
        }
        if (removed) {
            saveChatScope();
            notifyMemoriesChanged({ source: 'undo' });
        }
        saveChatData();
        return removed;
    } catch (e) {
        console.warn('[Dooms Tracker] Memories: undo failed', e);
        return 0;
    }
}
