/**
 * Lore Library Feature Wrapper
 * Wraps lorebook.js and lorebookModal.js with performance optimizations:
 *   - Debounced search/filter (200ms) applied at the feature layer
 *   - Virtualization hint for large entry lists (see TODO below)
 *
 * The underlying lorebook.js already debounces its own save and search
 * internally; this wrapper re-exports the public API and layers additional
 * guards at the feature boundary.
 */
import { debounce } from '../../utils/debounce.js';

import {
    renderLorebook as _renderLorebook,
    initLorebookEventDelegation as _initLorebookEventDelegation,
    resetLorebookViewState,
    setSelectedBookAndEntry,
} from '../../systems/rendering/lorebook.js';

import {
    setupLorebookModal as _setupLorebookModal,
    getLorebookModal as _getLorebookModal,
} from '../../systems/ui/lorebookModal.js';

// Re-export state helpers unchanged
export { resetLorebookViewState, setSelectedBookAndEntry };

// --- Debounced render for rapid filter/search operations ---
// When multiple filter pills or keystrokes fire in quick succession,
// collapse them into one render pass.
const _debouncedRender = debounce(function _wrappedRender() {
    _renderLorebook();
}, 200, { leading: true, trailing: true });

let _renderCount = 0;

/**
 * Renders the lorebook modal. The first call is immediate (leading edge);
 * subsequent rapid calls within 200ms are collapsed.
 */
export function renderLorebook() {
    // First render should be immediate for perceived responsiveness
    if (_renderCount === 0) {
        _renderCount++;
        _renderLorebook();
        return;
    }
    _renderCount++;
    _debouncedRender();
}

export function initLorebookEventDelegation() {
    _initLorebookEventDelegation();
}

export function setupLorebookModal() {
    _setupLorebookModal();
}

export function getLorebookModal() {
    return _getLorebookModal();
}

// TODO: Add virtual scrolling for the entry list when a lorebook has 200+
// entries. The current implementation renders all entries as DOM nodes,
// which can cause jank on large books. A future pass should use
// IntersectionObserver + a fixed-height container to only render the
// visible slice of entries, recycling DOM nodes as the user scrolls.
