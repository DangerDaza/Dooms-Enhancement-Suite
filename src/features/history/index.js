/**
 * History Feature Wrapper
 * Wraps persistence.js storage functions with performance optimizations:
 *   - Debounced saveChatData (500ms) to avoid writing unchanged JSON
 *   - Dirty-state tracking to skip writes when nothing changed
 *   - saveSettings passthrough (already debounced by SillyTavern)
 */
import { debounce } from '../../utils/debounce.js';
import { committedTrackerData, extensionSettings } from '../../core/state.js';

import {
    saveChatData as _saveChatData,
    saveSettings as _saveSettings,
    loadChatData as _loadChatData,
    loadSettings,
    updateMessageSwipeData,
    getActiveKnownCharacters,
    getActiveRemovedCharacters,
    getActiveBannedCharacters,
    getActiveCharacterColors,
    saveCharacterRosterChange,
    getDoomCounterState,
    setDoomCounterState,
    getCurrentEntityKey,
    getCurrentEntityName,
} from '../../core/persistence.js';

// Re-export helpers that don't need wrapping
export {
    loadSettings,
    updateMessageSwipeData,
    getActiveKnownCharacters,
    getActiveRemovedCharacters,
    getActiveBannedCharacters,
    getActiveCharacterColors,
    saveCharacterRosterChange,
    getDoomCounterState,
    setDoomCounterState,
    getCurrentEntityKey,
    getCurrentEntityName,
};

// --- Dirty-state tracking ---
let _isDirty = false;
let _lastSavedSnapshot = null;

/**
 * Capture a lightweight snapshot of the data that saveChatData persists.
 * Used to detect whether a write is actually needed.
 */
function captureSnapshot() {
    try {
        const parts = [
            committedTrackerData.infoBox || '',
            committedTrackerData.characterThoughts || '',
            committedTrackerData.quests || '',
            JSON.stringify(extensionSettings.quests || {}),
        ];
        return parts.join('|');
    } catch {
        return null;
    }
}

/**
 * Mark the persistence layer as dirty so the next debounced write
 * actually flushes. Called by feature modules after mutations.
 */
export function markDirty() {
    _isDirty = true;
}

// --- Debounced saveChatData ---
const _debouncedSave = debounce(function _wrappedSaveChatData() {
    // Skip the write if nothing has actually changed
    const snap = captureSnapshot();
    if (!_isDirty && snap !== null && snap === _lastSavedSnapshot) {
        return;
    }

    _saveChatData();
    _lastSavedSnapshot = snap;
    _isDirty = false;
}, 500, { leading: false, trailing: true });

/**
 * Debounced saveChatData. Collapses rapid consecutive calls into a
 * single write after 500ms of quiet, and skips the write entirely
 * when the data hasn't changed.
 */
export function saveChatData() {
    _isDirty = true;
    _debouncedSave();
}

/**
 * Flush any pending debounced save immediately.
 * Call this before chat change or extension unload.
 */
export function flushPendingSave() {
    _debouncedSave.flush();
}

/**
 * saveSettings passthrough. SillyTavern already debounces internally
 * via saveSettingsDebounced, so no additional wrapping is needed.
 */
export function saveSettings() {
    _saveSettings();
}

/**
 * Load chat data and reset dirty tracking.
 */
export function loadChatData() {
    _loadChatData();
    _lastSavedSnapshot = captureSnapshot();
    _isDirty = false;
}
