/**
 * Present Characters Feature Wrapper
 * Wraps portraitBar.js and expressionSync.js with performance optimizations:
 *   - Throttled updatePortraitBar (max 1x per 250ms)
 *   - Skip updates when portrait bar is hidden
 *   - Cache last roster state; skip DOM updates when characters unchanged
 *   - Batched DOM writes via batchWrite
 */
import { throttle } from '../../utils/throttle.js';
import { batchWrite } from '../../utils/dom.js';
import { shallowEqual } from '../../core/diffEngine.js';
import { extensionSettings } from '../../core/state.js';

import {
    initPortraitBar,
    updatePortraitBar as _updatePortraitBar,
    repositionPortraitBar,
    clearPortraitCache as _clearPortraitCache,
    applyPortraitBarSettings,
    applySideModeStyling,
    resolvePortrait,
    resolveFullPortrait,
    getCharacterList,
    resolveActiveUserName,
    openExpressionFolder,
    upscaleImage,
} from '../../systems/ui/portraitBar.js';

export {
    classifyAllCharacterExpressions,
    classifyActiveUserExpression,
    initExpressionSync,
    onExpressionSyncChatChanged,
    onExpressionSyncSettingChanged,
    onHideDefaultExpressionDisplaySettingChanged,
    clearExpressionSyncCache,
    isExpressionSpritesModeEnabled,
    getExpressionPortraitForCharacter,
    invalidateSpriteCacheFor,
    clearSpriteCache,
    queueExpressionCaptureForSpeaker,
    syncExpressionFromLatestMessage,
} from '../../systems/integration/expressionSync.js';

// Re-export unchanged helpers from portraitBar
export {
    initPortraitBar,
    applyPortraitBarSettings,
    applySideModeStyling,
    resolvePortrait,
    resolveFullPortrait,
    getCharacterList,
    resolveActiveUserName,
    openExpressionFolder,
    upscaleImage,
};

// ── Caches ──
let _lastRosterSnapshot = null;

/**
 * Build a lightweight snapshot of the current roster for comparison.
 * Only captures identity keys, not full character objects.
 */
function _rosterSnapshot() {
    try {
        const list = getCharacterList();
        if (!list || !Array.isArray(list)) return null;
        return { len: list.length, names: list.map(c => c?.name ?? '').join(',') };
    } catch {
        return null;
    }
}

/**
 * Throttled portrait bar update -- at most once per 250 ms.
 * Skips entirely when the portrait bar is disabled or the roster is unchanged.
 */
const _throttledUpdate = throttle(function _guardedUpdate() {
    if (extensionSettings?.showPortraitBar === false) return;

    const snap = _rosterSnapshot();
    if (_lastRosterSnapshot && shallowEqual(_lastRosterSnapshot, snap)) return;
    _lastRosterSnapshot = snap;

    batchWrite(() => _updatePortraitBar());
}, 250, { leading: true, trailing: true });

/**
 * Throttled reposition -- layout-only, cheap but still throttled to avoid
 * redundant forced-layout during rapid resize streams.
 */
const _throttledReposition = throttle(
    () => batchWrite(() => repositionPortraitBar()),
    200,
    { leading: true, trailing: true },
);

/** Clearing the cache also invalidates the local roster snapshot. */
function wrappedClearPortraitCache() {
    _lastRosterSnapshot = null;
    _clearPortraitCache();
}

// ── Public API -- same shape as the system module ──

export {
    _throttledUpdate as updatePortraitBar,
    _throttledReposition as repositionPortraitBar,
    wrappedClearPortraitCache as clearPortraitCache,
};
