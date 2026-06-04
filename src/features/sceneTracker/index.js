/**
 * Scene Tracker Feature Wrapper
 * Wraps sceneHeaders.js with performance optimizations:
 *   - Throttled updateChatSceneHeaders (max 1x per 200ms)
 *   - Cache parsed scene data by serialized key; skip re-render if unchanged
 *   - Use requestAnimationFrame for DOM updates
 */
import { throttle } from '../../utils/throttle.js';
import {
    updateChatSceneHeaders as _updateChatSceneHeaders,
    applySceneTrackerSettings as _applySceneTrackerSettings,
    resetSceneHeaderCache as _resetSceneHeaderCache,
    extractSceneData,
    hexToRgb,
} from '../../systems/rendering/sceneHeaders.js';
import {
    extensionSettings,
    lastGeneratedData,
    committedTrackerData,
} from '../../core/state.js';

// Re-export unchanged utilities
export { extractSceneData, hexToRgb };

// --- Scene data diff cache ---
let _lastSceneCacheKey = null;

/**
 * Build a lightweight cache key from the inputs that drive scene rendering.
 * The underlying module has its own JSON cache, but we gate the call itself
 * to avoid even entering the function when nothing changed.
 */
function buildSceneCacheKey() {
    try {
        const infoBox = lastGeneratedData.infoBox || committedTrackerData.infoBox || '';
        const charData = lastGeneratedData.characterThoughts || committedTrackerData.characterThoughts || '';
        const quests = extensionSettings.quests ? JSON.stringify(extensionSettings.quests) : '';
        const layout = extensionSettings.sceneTracker?.layout || 'grid';
        return `${typeof infoBox === 'string' ? infoBox : JSON.stringify(infoBox)}|${typeof charData === 'string' ? charData : JSON.stringify(charData)}|${quests}|${layout}`;
    } catch {
        return null;
    }
}

// --- Throttled + RAF update ---
const _throttledUpdate = throttle(function _wrappedSceneUpdate() {
    const key = buildSceneCacheKey();
    if (key !== null && key === _lastSceneCacheKey) return;

    requestAnimationFrame(() => {
        _updateChatSceneHeaders();
        _lastSceneCacheKey = key;
    });
}, 200, { leading: true, trailing: true });

// --- Exports ---

export function updateChatSceneHeaders() {
    _throttledUpdate();
}

export function applySceneTrackerSettings() {
    requestAnimationFrame(() => {
        _applySceneTrackerSettings();
    });
}

export function resetSceneHeaderCache() {
    _lastSceneCacheKey = null;
    _resetSceneHeaderCache();
}
