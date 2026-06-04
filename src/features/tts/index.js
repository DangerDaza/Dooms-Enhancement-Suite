/**
 * TTS / Thoughts Feature Wrapper
 * Wraps thoughts.js rendering with performance optimizations:
 *   - Throttle updateChatThoughts to 300ms
 *   - Skip renderThoughts if thought data unchanged
 */
import { throttle } from '../../utils/throttle.js';
import {
    lastGeneratedData,
    committedTrackerData,
} from '../../core/state.js';

import {
    renderThoughts as _renderThoughts,
    updateCharacterField as _updateCharacterField,
    removeCharacter as _removeCharacter,
    updateChatThoughts as _updateChatThoughts,
    createThoughtPanel as _createThoughtPanel,
    initThoughtsEventDelegation as _initThoughtsEventDelegation,
    addNewCharacter,
} from '../../systems/rendering/thoughts.js';

// Re-export unchanged helper
export { addNewCharacter };

// --- Thought data diff cache ---
let _lastThoughtDataKey = null;

/**
 * Build a lightweight key from the thought data sources to detect changes.
 */
function buildThoughtKey() {
    try {
        const data = lastGeneratedData.characterThoughts || committedTrackerData.characterThoughts || '';
        return typeof data === 'string' ? data : JSON.stringify(data);
    } catch {
        return null;
    }
}

/**
 * Renders the thoughts panel. Skips the render when the underlying
 * thought data hasn't changed, unless `force` is set.
 */
export function renderThoughts(opts = {}) {
    const key = buildThoughtKey();
    // Skip only when the data is identical AND the caller didn't request
    // preserveScroll (which implies an explicit re-render request).
    if (!opts.preserveScroll && key !== null && key === _lastThoughtDataKey) {
        return;
    }
    _renderThoughts(opts);
    _lastThoughtDataKey = key;
}

export function updateCharacterField(characterName, field, value) {
    _updateCharacterField(characterName, field, value);
    // Invalidate cache since data was modified
    _lastThoughtDataKey = null;
}

export function removeCharacter(characterName) {
    _removeCharacter(characterName);
    _lastThoughtDataKey = null;
}

// --- Throttled updateChatThoughts ---
const _throttledChatThoughts = throttle(function _wrappedChatThoughts() {
    _updateChatThoughts();
    _lastThoughtDataKey = buildThoughtKey();
}, 300, { leading: true, trailing: true });

export function updateChatThoughts() {
    _throttledChatThoughts();
}

export function createThoughtPanel($message, thoughtsArray) {
    return _createThoughtPanel($message, thoughtsArray);
}

export function initThoughtsEventDelegation() {
    _initThoughtsEventDelegation();
}

/**
 * Force-clear the thought cache so the next render always runs.
 * Call this on chat change.
 */
export function invalidateThoughtCache() {
    _lastThoughtDataKey = null;
}
