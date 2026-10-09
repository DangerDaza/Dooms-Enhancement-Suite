/**
 * RPG mode — one switch for the whole Better Stats layer.
 *
 * Not every card needs stats, equipment, levels and so on. When RPG mode is
 * off, nothing of it is sent to the AI, applied from replies or shown in the
 * Stats panel (the data is kept, just ignored).
 *
 * The setting is resolved, first match wins:
 *   1. this chat:  chat_metadata.dooms_tracker.rpgMode   (true / false / unset)
 *   2. this card:  extensionSettings.rpgModeCards[cardKey] (true / false / unset)
 *   3. default:    extensionSettings.rpgModeDefault        (on unless false)
 * cardKey is the character's avatar file, or "group:<id>" in a group chat.
 */
import { getContext } from '../../../../../../extensions.js';
import { chat_metadata } from '../../../../../../../script.js';
import { extensionSettings } from '../../core/state.js';
import { saveSettings, saveChatData } from '../../core/persistence.js';

export const RPG_MODE_CHANGED_EVENT = 'dooms:rpg-mode-changed';

/** The key the current card's setting is stored under, or '' (no card open). */
export function currentCardKey() {
    try {
        const ctx = getContext();
        if (ctx.groupId) return `group:${ctx.groupId}`;
        const ch = Array.isArray(ctx.characters) && ctx.characterId !== undefined && ctx.characterId !== null
            ? ctx.characters[ctx.characterId]
            : null;
        return (ch && typeof ch.avatar === 'string' && ch.avatar) || '';
    } catch (e) {
        return '';
    }
}

/** The display name of the current card (for the settings label). */
export function currentCardName() {
    try {
        const ctx = getContext();
        if (ctx.groupId) {
            const g = (ctx.groups || []).find(x => x.id === ctx.groupId);
            return g?.name || 'this group';
        }
        const ch = Array.isArray(ctx.characters) ? ctx.characters[ctx.characterId] : null;
        return ch?.name || '';
    } catch (e) {
        return '';
    }
}

/** true / false set for this chat, or null when it follows the card. */
export function getChatRpgMode() {
    const v = chat_metadata?.dooms_tracker?.rpgMode;
    return typeof v === 'boolean' ? v : null;
}

/** true / false set for the current card, or null when it follows the default. */
export function getCardRpgMode(cardKey = currentCardKey()) {
    const map = extensionSettings.rpgModeCards;
    const v = cardKey && map && typeof map === 'object' ? map[cardKey] : undefined;
    return typeof v === 'boolean' ? v : null;
}

export function getDefaultRpgMode() {
    return extensionSettings.rpgModeDefault !== false;
}

/** Whether the Better Stats layer is on for the chat that is open now. */
export function isRpgModeActive() {
    if (extensionSettings.enabled === false) return false;
    const chatMode = getChatRpgMode();
    if (chatMode !== null) return chatMode;
    const cardMode = getCardRpgMode();
    if (cardMode !== null) return cardMode;
    return getDefaultRpgMode();
}

/** Where the active setting comes from: 'chat', 'card' or 'default'. */
export function rpgModeSource() {
    if (getChatRpgMode() !== null) return 'chat';
    if (getCardRpgMode() !== null) return 'card';
    return 'default';
}

function changed() {
    try {
        window.dispatchEvent(new CustomEvent(RPG_MODE_CHANGED_EVENT, { detail: { active: isRpgModeActive() } }));
        // Stat views repaint on this one.
        window.dispatchEvent(new CustomEvent('dooms:stats-changed', { detail: { source: 'rpg-mode' } }));
    } catch (e) { /* no window (tests) */ }
}

/** Sets this chat's RPG mode: true, false, or null to follow the card. */
export function setChatRpgMode(value) {
    if (!chat_metadata) return;
    if (!chat_metadata.dooms_tracker) chat_metadata.dooms_tracker = {};
    if (typeof value === 'boolean') chat_metadata.dooms_tracker.rpgMode = value;
    else delete chat_metadata.dooms_tracker.rpgMode;
    saveChatData();
    changed();
}

/** Sets the current card's RPG mode: true, false, or null to follow the default. */
export function setCardRpgMode(value, cardKey = currentCardKey()) {
    if (!cardKey) return;
    if (!extensionSettings.rpgModeCards || typeof extensionSettings.rpgModeCards !== 'object') extensionSettings.rpgModeCards = {};
    if (typeof value === 'boolean') extensionSettings.rpgModeCards[cardKey] = value;
    else delete extensionSettings.rpgModeCards[cardKey];
    saveSettings();
    changed();
}

export function setDefaultRpgMode(on) {
    extensionSettings.rpgModeDefault = !!on;
    saveSettings();
    changed();
}

/**
 * Turns RPG mode on or off for what is open now, the simplest way: a chat
 * override when the chat has one, otherwise the card's setting.
 */
export function toggleRpgModeHere(on) {
    if (getChatRpgMode() !== null || !currentCardKey()) setChatRpgMode(on);
    else setCardRpgMode(on);
}

/** CHAT_CHANGED hook: another chat or card may have another RPG mode. */
export function onChatChangedRpgMode() {
    changed();
}
