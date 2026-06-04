/**
 * DES State Store
 * Caches a snapshot of SillyTavern context and DES-specific state.
 * Uses reference equality to skip recomputation of derived values.
 *
 * Consumers call getSnapshot() to receive a frozen object whose fields are
 * only recomputed when the underlying references from getContext() change.
 */

import { getContext } from '../../../../../extensions.js';
import { chat_metadata } from '../../../../../../script.js';
import { extensionSettings } from './state.js';
import { extensionName } from './config.js';

// ── Types ──

/**
 * @typedef {Object} DESSnapshot
 * @property {Array}  chat             - Current chat messages array
 * @property {Array}  characters       - All loaded characters
 * @property {Object} chatMetadata     - SillyTavern chat_metadata object
 * @property {Object} currentCharacter - Currently selected character data (or null)
 * @property {number|null} currentCharacterIndex - this_chid equivalent
 * @property {string|null} selectedGroup - Current group chat ID (or null)
 * @property {Object} extensionSettings - Reference to DES extension settings
 * @property {Object} desMetadata      - Per-chat DES metadata from chat_metadata
 * @property {string|null} chatId      - Unique identifier for the current chat
 * @property {number} chatLength       - Number of messages in the current chat
 */

// ── Internal cache ──

/** @type {DESSnapshot|null} */
let _cached = null;

/** Previous raw references for staleness detection */
let _prevRefs = {
    chat: null,
    characters: null,
    chatMetadata: null,
    currentCharacter: null,
    currentCharacterIndex: null,
    selectedGroup: null,
    extensionSettingsRef: null,
};

/** Subscriber callbacks notified on invalidation */
const _subscribers = new Set();

// ── Derived value cache ──

let _derivedChatId = null;
let _derivedChatIdInput = null; // tracks the reference used to compute it

/**
 * Compute a stable chat identifier from context.
 * Uses chat_metadata.main_chat or falls back to a combination of
 * character index + group ID.
 */
function _computeChatId(meta, charIndex, groupId) {
    const inputKey = meta; // reference check
    if (inputKey === _derivedChatIdInput && _derivedChatId !== undefined) {
        return _derivedChatId;
    }
    _derivedChatIdInput = inputKey;

    if (meta && meta.main_chat) {
        _derivedChatId = String(meta.main_chat);
    } else if (groupId) {
        _derivedChatId = `group_${groupId}`;
    } else if (charIndex != null && charIndex >= 0) {
        _derivedChatId = `char_${charIndex}`;
    } else {
        _derivedChatId = null;
    }
    return _derivedChatId;
}

// ── Public API ──

export const DESStateStore = {
    /**
     * Return the current state snapshot. Reuses the cached object if no
     * underlying references have changed since the last call.
     *
     * @returns {Readonly<DESSnapshot>}
     */
    getSnapshot() {
        if (_cached && !_isStale()) {
            return _cached;
        }
        _cached = _buildSnapshot();
        return _cached;
    },

    /**
     * Force the cache to be discarded so the next getSnapshot() rebuilds.
     * Call this when you know SillyTavern state has changed (the EventBus
     * calls this automatically on each ST event).
     */
    invalidate() {
        _cached = null;
        for (const cb of _subscribers) {
            try { cb(); } catch (e) { console.error('[DES StateStore] subscriber error:', e); }
        }
    },

    /**
     * Register a callback invoked whenever the cache is invalidated.
     * Returns an unsubscribe function.
     *
     * @param {Function} callback
     * @returns {Function} unsubscribe
     */
    subscribe(callback) {
        _subscribers.add(callback);
        return () => _subscribers.delete(callback);
    },

    /**
     * Read a single key from the snapshot without building the full object
     * when only one field is needed.
     *
     * @param {string} key
     * @returns {*}
     */
    get(key) {
        return this.getSnapshot()[key];
    },

    /**
     * Reset all internal caches (useful in tests or on full chat reload).
     */
    reset() {
        _cached = null;
        _prevRefs = {
            chat: null,
            characters: null,
            chatMetadata: null,
            currentCharacter: null,
            currentCharacterIndex: null,
            selectedGroup: null,
            extensionSettingsRef: null,
        };
        _derivedChatId = null;
        _derivedChatIdInput = null;
    },
};

// ── Internal helpers ──

/**
 * Check whether any tracked reference has changed since the last snapshot.
 * @returns {boolean}
 */
function _isStale() {
    try {
        const ctx = getContext();
        const meta = chat_metadata;
        const charIndex = ctx.characterId ?? null;
        const charData = (ctx.characters && charIndex != null && charIndex >= 0)
            ? ctx.characters[charIndex]
            : null;

        return (
            ctx.chat !== _prevRefs.chat ||
            ctx.characters !== _prevRefs.characters ||
            meta !== _prevRefs.chatMetadata ||
            charData !== _prevRefs.currentCharacter ||
            charIndex !== _prevRefs.currentCharacterIndex ||
            (ctx.groupId ?? null) !== _prevRefs.selectedGroup ||
            extensionSettings !== _prevRefs.extensionSettingsRef
        );
    } catch {
        // If getContext throws (extension not yet loaded), treat as stale
        return true;
    }
}

/**
 * Build a fresh snapshot from SillyTavern context.
 * @returns {Readonly<DESSnapshot>}
 */
function _buildSnapshot() {
    try {
        const ctx = getContext();
        const meta = chat_metadata;
        const chat = ctx.chat || [];
        const characters = ctx.characters || [];
        const charIndex = ctx.characterId ?? null;
        const currentCharacter = (characters.length && charIndex != null && charIndex >= 0)
            ? characters[charIndex]
            : null;
        const selectedGroup = ctx.groupId ?? null;
        const settings = extensionSettings;

        // Per-chat DES metadata stored inside chat_metadata
        const desMetadata = (meta && meta[extensionName]) ? meta[extensionName] : {};

        const chatId = _computeChatId(meta, charIndex, selectedGroup);

        // Update tracked references
        _prevRefs.chat = chat;
        _prevRefs.characters = characters;
        _prevRefs.chatMetadata = meta;
        _prevRefs.currentCharacter = currentCharacter;
        _prevRefs.currentCharacterIndex = charIndex;
        _prevRefs.selectedGroup = selectedGroup;
        _prevRefs.extensionSettingsRef = settings;

        const snapshot = {
            chat,
            characters,
            chatMetadata: meta || {},
            currentCharacter,
            currentCharacterIndex: charIndex,
            selectedGroup,
            extensionSettings: settings,
            desMetadata,
            chatId,
            chatLength: chat.length,
        };

        return Object.freeze(snapshot);
    } catch (err) {
        // Graceful fallback when context is unavailable (e.g. during startup)
        console.warn('[DES StateStore] Failed to build snapshot:', err.message);
        return Object.freeze({
            chat: [],
            characters: [],
            chatMetadata: {},
            currentCharacter: null,
            currentCharacterIndex: null,
            selectedGroup: null,
            extensionSettings: extensionSettings || {},
            desMetadata: {},
            chatId: null,
            chatLength: 0,
        });
    }
}
