/**
 * Frame Scheduler
 * RAF-based scheduler that queues DOM reads and writes separately to avoid
 * layout thrashing. Supports three priority levels and pauses automatically
 * when the page is hidden.
 *
 * Pure utility — no SillyTavern dependencies.
 */

// ── Priority levels ──

export const Priority = Object.freeze({
    /** Execute in the current rAF pass, ahead of normal work. */
    IMMEDIATE: 0,
    /** Default priority — batched in the next rAF. */
    NORMAL: 1,
    /** Deferred to requestIdleCallback (or next rAF fallback). */
    IDLE: 2,
});

// ── Internal queues ──

/**
 * @typedef {Object} ScheduledTask
 * @property {Function} fn
 * @property {number} priority
 */

/** @type {ScheduledTask[]} */
let _readQueue = [];
/** @type {ScheduledTask[]} */
let _writeQueue = [];

let _rafId = null;
let _idleId = null;
let _paused = false;
let _visibilityBound = false;

// ── Public API ──

/**
 * Schedule a DOM read (measurement) in the next frame.
 * Reads execute before writes within the same frame.
 *
 * @param {Function} fn
 * @param {number} [priority=Priority.NORMAL]
 */
export function scheduleRead(fn, priority = Priority.NORMAL) {
    if (typeof fn !== 'function') return;

    if (priority === Priority.IDLE) {
        _enqueueIdle(() => _readQueue.push({ fn, priority: Priority.NORMAL }));
        return;
    }

    _readQueue.push({ fn, priority });
    _ensureScheduled();
}

/**
 * Schedule a DOM write (mutation) in the next frame.
 * Writes execute after all reads in the same frame.
 *
 * @param {Function} fn
 * @param {number} [priority=Priority.NORMAL]
 */
export function scheduleWrite(fn, priority = Priority.NORMAL) {
    if (typeof fn !== 'function') return;

    if (priority === Priority.IDLE) {
        _enqueueIdle(() => _writeQueue.push({ fn, priority: Priority.NORMAL }));
        return;
    }

    _writeQueue.push({ fn, priority });
    _ensureScheduled();
}

/**
 * Convenience: schedule a read followed by a write in the same frame.
 * The write receives the return value of the read.
 *
 * @param {Function} readFn  - () => value
 * @param {Function} writeFn - (value) => void
 * @param {number} [priority=Priority.NORMAL]
 */
export function scheduleMeasureMutate(readFn, writeFn, priority = Priority.NORMAL) {
    let measured;
    scheduleRead(() => { measured = readFn(); }, priority);
    scheduleWrite(() => { writeFn(measured); }, priority);
}

/**
 * Manually flush all queued work synchronously.
 * Useful in tests or when you need immediate layout.
 */
export function flushScheduler() {
    _cancelScheduled();
    _processFrame();
}

/**
 * Pause scheduling (e.g. page hidden). Queued work is preserved
 * and will execute when resumed.
 */
export function pause() {
    _paused = true;
    _cancelScheduled();
}

/**
 * Resume scheduling after a pause.
 */
export function resume() {
    _paused = false;
    if (_readQueue.length > 0 || _writeQueue.length > 0) {
        _ensureScheduled();
    }
}

/**
 * Clear all queued tasks without executing them.
 */
export function clearScheduler() {
    _cancelScheduled();
    _readQueue = [];
    _writeQueue = [];
}

/**
 * Bind to document.visibilitychange so the scheduler pauses when the tab
 * is hidden and resumes when visible. Safe to call multiple times.
 */
export function bindVisibility() {
    if (_visibilityBound) return;
    _visibilityBound = true;

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') {
            pause();
        } else {
            resume();
        }
    });
}

// ── Diagnostics ──

/**
 * Return current queue sizes (for debugging).
 * @returns {{ reads: number, writes: number, paused: boolean }}
 */
export function schedulerStats() {
    return {
        reads: _readQueue.length,
        writes: _writeQueue.length,
        paused: _paused,
    };
}

// ── Internal helpers ──

function _ensureScheduled() {
    if (_paused || _rafId !== null) return;
    _rafId = requestAnimationFrame(_processFrame);
}

function _cancelScheduled() {
    if (_rafId !== null) {
        cancelAnimationFrame(_rafId);
        _rafId = null;
    }
}

/**
 * Process one frame: execute all reads, then all writes, prioritizing
 * IMMEDIATE tasks within each phase.
 */
function _processFrame() {
    _rafId = null;

    // Snapshot and clear queues so tasks enqueued during execution
    // are picked up in the next frame, not the current one.
    const reads = _readQueue;
    const writes = _writeQueue;
    _readQueue = [];
    _writeQueue = [];

    // Sort: IMMEDIATE (0) before NORMAL (1)
    _sortByPriority(reads);
    _sortByPriority(writes);

    // Phase 1: reads (measurements)
    for (let i = 0; i < reads.length; i++) {
        try { reads[i].fn(); } catch (e) { console.error('[DES Scheduler] read error:', e); }
    }

    // Phase 2: writes (mutations)
    for (let i = 0; i < writes.length; i++) {
        try { writes[i].fn(); } catch (e) { console.error('[DES Scheduler] write error:', e); }
    }

    // If new work was enqueued during execution, schedule another frame
    if (!_paused && (_readQueue.length > 0 || _writeQueue.length > 0)) {
        _ensureScheduled();
    }
}

/**
 * Sort tasks in place by priority (lower number = higher priority).
 * Uses a simple insertion sort — the queues are typically small.
 * @param {ScheduledTask[]} tasks
 */
function _sortByPriority(tasks) {
    for (let i = 1; i < tasks.length; i++) {
        const task = tasks[i];
        let j = i - 1;
        while (j >= 0 && tasks[j].priority > task.priority) {
            tasks[j + 1] = tasks[j];
            j--;
        }
        tasks[j + 1] = task;
    }
}

/**
 * Enqueue work via requestIdleCallback (with rAF fallback).
 * The callback pushes into the normal queue and schedules a frame.
 * @param {Function} fn
 */
function _enqueueIdle(fn) {
    const idleCb = typeof requestIdleCallback === 'function' ? requestIdleCallback : _rafFallback;
    idleCb(() => {
        if (_paused) return;
        fn();
        _ensureScheduled();
    });
}

/**
 * Fallback for environments without requestIdleCallback.
 * @param {Function} cb
 */
function _rafFallback(cb) {
    // Use a double-rAF to approximate idle timing
    requestAnimationFrame(() => requestAnimationFrame(cb));
}
