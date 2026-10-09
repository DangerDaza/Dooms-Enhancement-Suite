/**
 * Chat scope — where Better Stats keeps what belongs to one story.
 *
 * Everything the story changes lives in the chat itself, so another chat
 * with the same character starts clean (and a branch or copy of a chat takes
 * its data along, while deleting a chat deletes it):
 *   chat_metadata.dooms_tracker.betterStats[root][characterKey] = ...
 * where root is one of CHAT_ROOTS and characterKey "npc:Name" / "user:Name".
 *
 * What stays global (extensionSettings) is who the characters are: stat
 * sheets with their starting values, which stats are on, colours, custom
 * stats and all settings.
 *
 * Versions before this kept the same data per Lore Library campaign in
 * extensionSettings; migrateLegacyToChat() moves it, once, into the first
 * chat with a story that is opened afterwards.
 */
import { chat, chat_metadata } from '../../../../../../../script.js';
import { extensionSettings } from '../../core/state.js';
import { saveSettings, saveChatData } from '../../core/persistence.js';

/** The per-chat stores, and the extensionSettings key each used to live under. */
export const CHAT_ROOTS = [
    'characterStatValues',
    'characterMemories',
    'characterEquipment',
    'characterEquipmentSeeded',
    'characterConditions',
    'characterAbilities',
    'characterAbilitiesSeeded',
    'characterProgress',
];

/** Undo records are tagged with this; they live in the chat, so it is constant. */
export const CHAT_SCOPE = 'chat';

function container(create) {
    if (!chat_metadata || typeof chat_metadata !== 'object') return null;
    if (!chat_metadata.dooms_tracker || typeof chat_metadata.dooms_tracker !== 'object') {
        if (!create) return null;
        chat_metadata.dooms_tracker = {};
    }
    const t = chat_metadata.dooms_tracker;
    if (!t.betterStats || typeof t.betterStats !== 'object') {
        if (!create) return null;
        t.betterStats = {};
    }
    return t.betterStats;
}

/**
 * The open chat's store for `root` ({ characterKey: data }), or null when
 * there is none and `create` is false.
 */
export function chatStore(root, create = false) {
    const c = container(create);
    if (!c) return null;
    if (!c[root] || typeof c[root] !== 'object' || Array.isArray(c[root])) {
        if (!create) return null;
        c[root] = {};
    }
    return c[root];
}

/** Saves the open chat (debounced) — call after changing a chat store. */
export function saveChatScope() {
    try { saveChatData(); } catch (e) { /* no chat open */ }
}

/**
 * One-time move of the data older versions kept per campaign: the active
 * campaign's data (or the no-campaign data) goes into the open chat, if that
 * chat already has a story and nothing of its own yet. The old copies are
 * then removed from the settings. Returns true when something moved.
 */
export function migrateLegacyToChat() {
    if (extensionSettings.betterStatsChatScoped) return false;
    const legacy = CHAT_ROOTS.filter(r => extensionSettings[r] && typeof extensionSettings[r] === 'object' && Object.keys(extensionSettings[r]).length);
    if (!legacy.length) {
        extensionSettings.betterStatsChatScoped = true;
        return false;
    }
    if (!Array.isArray(chat) || chat.length < 2) return false; // wait for a chat with a story
    const existing = container(false);
    if (existing && Object.keys(existing).length) return false;
    const id = extensionSettings.lorebook?.activeCampaignId;
    const campaign = typeof id === 'string' && id ? id : '_base';
    const target = container(true);
    if (!target) return false;
    let moved = 0;
    for (const root of legacy) {
        const data = extensionSettings[root][campaign];
        if (data && typeof data === 'object' && Object.keys(data).length) {
            target[root] = JSON.parse(JSON.stringify(data));
            moved++;
        }
    }
    for (const root of CHAT_ROOTS) delete extensionSettings[root];
    extensionSettings.betterStatsChatScoped = true;
    saveSettings();
    saveChatScope();
    console.log(`[Dooms Tracker] Better Stats: moved ${moved} kind(s) of character data from campaign "${campaign}" into this chat`);
    try {
        if (moved) window.toastr?.info('Stats, equipment, memories and the rest now belong to each chat. What you had so far was moved into this chat; other chats start clean.', 'Better Stats', { timeOut: 9000 });
        window.dispatchEvent(new CustomEvent('dooms:stats-changed', { detail: { source: 'migrated' } }));
    } catch (e) { /* no window (tests) */ }
    return moved > 0;
}

/**
 * The open chat's store wrapped as { chat: store } (or null), for code that
 * walks "every bucket" of a root — it now walks the one chat.
 */
export function chatRootView(root) {
    const s = chatStore(root);
    return s ? { [CHAT_SCOPE]: s } : null;
}
