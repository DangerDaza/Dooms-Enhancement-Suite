/**
 * DES Event Bus
 * Central event router that subscribes once to SillyTavern lifecycle events,
 * computes a state snapshot per event, and notifies feature modules only when
 * relevant state actually changed. Batches UI notifications via rAF.
 *
 * Feature modules register interest in specific state keys. The bus coalesces
 * rapid-fire events and delivers a single notification per animation frame.
 */

import { eventSource, event_types } from '../../../../../../script.js';
import { DESStateStore } from './stateStore.js';
import { diffSnapshots } from './diffEngine.js';
import { debounce } from '../utils/debounce.js';
import { throttle } from '../utils/throttle.js';

// ── Types ──

/**
 * @typedef {Object} Subscription
 * @property {string} id           - Unique subscription ID
 * @property {Set<string>} keys    - State keys this subscriber cares about
 * @property {Function} callback   - (changedKeys: Set<string>, snapshot: Object) => void
 */

// ── Internal state ──

/** @type {Map<string, Subscription>} */
const _subscriptions = new Map();

/** Monotonic subscription counter */
let _nextId = 0;

/** Whether a rAF notification pass is already queued */
let _rafQueued = false;

/** Pending changed keys accumulated since last flush */
let _pendingChangedKeys = new Set();

/** Latest snapshot at the time changes were detected */
let _pendingSnapshot = null;

/** Whether the bus has been wired to SillyTavern events */
let _initialized = false;

/** Handlers we registered on eventSource, kept for cleanup */
const _stHandlers = new Map();

// ── Core class ──

export class DESEventBus {
    /**
     * Subscribe to state changes.
     *
     * @param {string[]|'*'} keys - State keys to watch, or '*' for all changes
     * @param {Function} callback - (changedKeys: Set<string>, snapshot: Object) => void
     * @returns {string} Subscription ID (pass to unsubscribe)
     */
    subscribe(keys, callback) {
        if (typeof callback !== 'function') {
            throw new TypeError('[DES EventBus] callback must be a function');
        }
        const id = `des_sub_${_nextId++}`;
        _subscriptions.set(id, {
            id,
            keys: keys === '*' ? '*' : new Set(Array.isArray(keys) ? keys : [keys]),
            callback,
        });
        return id;
    }

    /**
     * Remove a subscription.
     * @param {string} id - Subscription ID returned by subscribe()
     */
    unsubscribe(id) {
        _subscriptions.delete(id);
    }

    /**
     * Manually emit a set of changed keys. Useful for DES-internal events
     * that don't originate from SillyTavern (e.g. user toggling a setting).
     *
     * @param {string[]|Set<string>} changedKeys
     * @param {Object} [snapshot] - Optional override snapshot; defaults to current
     */
    emit(changedKeys, snapshot) {
        const keys = changedKeys instanceof Set ? changedKeys : new Set(changedKeys);
        if (keys.size === 0) return;

        const snap = snapshot || DESStateStore.getSnapshot();
        for (const k of keys) {
            _pendingChangedKeys.add(k);
        }
        _pendingSnapshot = snap;
        _scheduleFlush();
    }

    /**
     * Wire the bus to SillyTavern lifecycle events. Safe to call multiple times;
     * only the first call attaches listeners.
     */
    init() {
        if (_initialized) return;
        _initialized = true;
        _attachSTListeners();
    }

    /**
     * Tear down all SillyTavern listeners and clear subscriptions.
     */
    destroy() {
        for (const [eventType, handler] of _stHandlers) {
            eventSource.off(eventType, handler);
        }
        _stHandlers.clear();
        _subscriptions.clear();
        _pendingChangedKeys.clear();
        _pendingSnapshot = null;
        _initialized = false;
    }

    /** Number of active subscriptions (for diagnostics). */
    get size() {
        return _subscriptions.size;
    }
}

// ── rAF batching ──

function _scheduleFlush() {
    if (_rafQueued) return;
    _rafQueued = true;
    requestAnimationFrame(_flush);
}

function _flush() {
    _rafQueued = false;

    const changed = _pendingChangedKeys;
    const snapshot = _pendingSnapshot;
    _pendingChangedKeys = new Set();
    _pendingSnapshot = null;

    if (changed.size === 0 || !snapshot) return;

    for (const sub of _subscriptions.values()) {
        try {
            if (sub.keys === '*' || _keysOverlap(sub.keys, changed)) {
                sub.callback(changed, snapshot);
            }
        } catch (err) {
            console.error('[DES EventBus] subscriber error:', err);
        }
    }
}

/**
 * Check if two Sets share at least one element.
 * @param {Set<string>} a
 * @param {Set<string>} b
 * @returns {boolean}
 */
function _keysOverlap(a, b) {
    // Iterate over the smaller set for efficiency
    const [smaller, larger] = a.size <= b.size ? [a, b] : [b, a];
    for (const key of smaller) {
        if (larger.has(key)) return true;
    }
    return false;
}

// ── SillyTavern event wiring ──

/**
 * Maps ST event names to options controlling how often we sample state.
 * High-frequency events get debounced/throttled so we don't diff every keystroke.
 */
const _EVENT_CONFIG = {
    // Chat lifecycle — immediate
    [event_types.CHAT_CHANGED]:        { mode: 'immediate' },
    [event_types.MESSAGE_RECEIVED]:    { mode: 'immediate' },
    [event_types.MESSAGE_SENT]:        { mode: 'immediate' },
    [event_types.MESSAGE_DELETED]:     { mode: 'immediate' },
    [event_types.MESSAGE_EDITED]:      { mode: 'immediate' },
    [event_types.MESSAGE_SWIPED]:      { mode: 'immediate' },
    [event_types.GENERATION_ENDED]:    { mode: 'immediate' },

    // Potentially bursty — debounce
    [event_types.CHAT_COMPLETION_SETTINGS_READY]: { mode: 'debounce', wait: 200 },
    [event_types.SETTINGS_UPDATED]:    { mode: 'debounce', wait: 300 },

    // Character / group changes — immediate but infrequent
    [event_types.CHARACTER_EDITED]:    { mode: 'immediate' },
    [event_types.GROUP_UPDATED]:       { mode: 'immediate' },
};

/**
 * Core handler: snapshot state, diff against previous, queue changed keys.
 */
let _prevSnapshot = null;

function _onSTEvent() {
    DESStateStore.invalidate();
    const next = DESStateStore.getSnapshot();

    const changed = diffSnapshots(_prevSnapshot, next, {
        deepKeys: ['chatMetadata', 'desMetadata'],
    });

    _prevSnapshot = next;

    if (changed.size === 0) return;

    for (const k of changed) {
        _pendingChangedKeys.add(k);
    }
    _pendingSnapshot = next;
    _scheduleFlush();
}

function _attachSTListeners() {
    _prevSnapshot = DESStateStore.getSnapshot();

    for (const [eventType, config] of Object.entries(_EVENT_CONFIG)) {
        let handler;

        switch (config.mode) {
            case 'debounce':
                handler = debounce(_onSTEvent, config.wait);
                break;
            case 'throttle':
                handler = throttle(_onSTEvent, config.wait);
                break;
            case 'immediate':
            default:
                handler = _onSTEvent;
                break;
        }

        eventSource.on(eventType, handler);
        _stHandlers.set(eventType, handler);
    }
}

// ── Singleton ──

export const desEventBus = new DESEventBus();
