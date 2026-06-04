/**
 * Doom Counter Feature Wrapper
 * Wraps doomCounter.js with performance optimizations:
 *   - Cache recent context extraction results (tension value)
 *   - Throttle UI updates to 500ms
 *   - Ensure twist modal renders once and updates in place
 */
import { throttle } from '../../utils/throttle.js';

import {
    triggerDoomCounter as _triggerDoomCounter,
    updateDoomCounterUI as _updateDoomCounterUI,
    resetCounters as _resetCounters,
    isTrapTwistPending as _isTrapTwistPending,
    clearTrapTwistFlag as _clearTrapTwistFlag,
    onResponseReceived,
    readTensionValue,
    generateTwistOptions,
    getPendingTwist,
    clearPendingTwist,
    isTriggerInProgress,
    buildDoomTensionInstruction,
    updateDoomDebugHud,
    hideDoomDebugHud,
    DOOM_TWIST_SLOT,
    DOOM_TENSION_SLOT,
} from '../../systems/generation/doomCounter.js';

// Re-export unchanged helpers
export {
    onResponseReceived,
    readTensionValue,
    generateTwistOptions,
    getPendingTwist,
    clearPendingTwist,
    isTriggerInProgress,
    buildDoomTensionInstruction,
    updateDoomDebugHud,
    hideDoomDebugHud,
    DOOM_TWIST_SLOT,
    DOOM_TENSION_SLOT,
};

// --- Cached tension value ---
let _lastTensionValue = undefined;
let _lastTensionReadTime = 0;
const TENSION_CACHE_TTL = 1000; // 1 second

/**
 * Read tension value with short-lived cache to avoid re-parsing
 * the same infoBox JSON multiple times within a single event cycle.
 */
export function readCachedTensionValue() {
    const now = Date.now();
    if (now - _lastTensionReadTime < TENSION_CACHE_TTL && _lastTensionValue !== undefined) {
        return _lastTensionValue;
    }
    _lastTensionValue = readTensionValue();
    _lastTensionReadTime = now;
    return _lastTensionValue;
}

// --- Throttled UI update ---
const _throttledUIUpdate = throttle(function _wrappedUIUpdate() {
    _updateDoomCounterUI();
}, 500, { leading: true, trailing: true });

// --- Trigger guard ---
// The underlying module already has a _triggerInProgress guard, but we add
// a second layer so callers never even await generateTwistOptions unnecessarily.
let _triggerQueued = false;

// --- Exports ---

export async function triggerDoomCounter() {
    if (_triggerQueued) return;
    _triggerQueued = true;
    try {
        await _triggerDoomCounter();
    } finally {
        _triggerQueued = false;
    }
}

export function updateDoomCounterUI() {
    _throttledUIUpdate();
}

export function resetCounters() {
    _lastTensionValue = undefined;
    _lastTensionReadTime = 0;
    _resetCounters();
}

export function isTrapTwistPending() {
    return _isTrapTwistPending();
}

export function clearTrapTwistFlag() {
    _clearTrapTwistFlag();
}
