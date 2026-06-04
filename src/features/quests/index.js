/**
 * Quests Feature Wrapper
 * Wraps quests.js with performance optimizations:
 *   - Skip re-render if quest data unchanged (deepEqual comparison)
 *   - Use batchWrite for DOM updates
 */
import { deepEqual } from '../../core/diffEngine.js';
import { batchWrite } from '../../utils/dom.js';
import { extensionSettings } from '../../core/state.js';

import {
    renderQuests as _renderQuests,
    initQuestEventDelegation as _initQuestEventDelegation,
    renderQuestsSubTabs,
    renderMainQuestView,
    renderOptionalQuestsView,
} from '../../systems/rendering/quests.js';

// Re-export sub-renderers unchanged
export { renderQuestsSubTabs, renderMainQuestView, renderOptionalQuestsView };

// --- Quest data diff cache ---
let _lastQuestSnapshot = null;

/**
 * Capture a snapshot of quest data for comparison.
 */
function captureQuestData() {
    try {
        return extensionSettings.quests || null;
    } catch {
        return null;
    }
}

/**
 * Renders the quests panel. Skips the render entirely when the quest
 * data hasn't changed since the last render, avoiding unnecessary DOM
 * teardown/rebuild.
 */
export function renderQuests() {
    const currentData = captureQuestData();

    if (_lastQuestSnapshot !== null && currentData !== null) {
        if (deepEqual(_lastQuestSnapshot, currentData)) {
            return; // Nothing changed, skip render
        }
    }

    batchWrite(() => {
        _renderQuests();
    });

    // Deep-clone the snapshot so mutations to extensionSettings.quests
    // don't silently invalidate our cached reference.
    try {
        _lastQuestSnapshot = currentData ? JSON.parse(JSON.stringify(currentData)) : null;
    } catch {
        _lastQuestSnapshot = null;
    }
}

export function initQuestEventDelegation() {
    _initQuestEventDelegation();
}

/**
 * Force-clear the quest cache so the next renderQuests() always runs.
 * Call this on chat change or when quests are edited via the UI.
 */
export function invalidateQuestCache() {
    _lastQuestSnapshot = null;
}
