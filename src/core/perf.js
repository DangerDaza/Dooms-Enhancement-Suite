/**
 * DES Performance Instrumentation
 * Lightweight wrappers around the Performance API for measuring code paths.
 * Silent by default — enable debug mode to log slow operations.
 *
 * Pure utility — no SillyTavern dependencies.
 */

// ── Configuration ──

/** Whether debug logging is active */
let _debug = false;

/** Thresholds (ms) for warn / error logging when debug is enabled */
const THRESHOLDS = Object.freeze({
    INFO: 16,   // >16ms  — may cause jank at 60fps
    WARN: 50,   // >50ms  — noticeable delay
    ERROR: 100,  // >100ms — significant delay
});

/** Prefix for all performance marks/measures to avoid collisions */
const PREFIX = 'des:';

/** Whether the Performance API is available */
const _hasPerf = typeof performance !== 'undefined' && typeof performance.mark === 'function';

// ── Public API ──

export const DESPerf = {
    /**
     * Enable or disable debug logging.
     * When enabled, operations exceeding threshold durations are logged.
     *
     * @param {boolean} enabled
     */
    setDebug(enabled) {
        _debug = !!enabled;
    },

    /** @returns {boolean} Whether debug mode is active */
    get debug() {
        return _debug;
    },

    /**
     * Place a performance mark.
     *
     * @param {string} name - Mark name (automatically prefixed with "des:")
     */
    mark(name) {
        if (_hasPerf) {
            try { performance.mark(PREFIX + name); } catch { /* ignore */ }
        }
    },

    /**
     * Measure duration between two marks.
     *
     * @param {string} name  - Measure name
     * @param {string} start - Start mark name
     * @param {string} [end] - End mark name (defaults to now)
     * @returns {number} Duration in milliseconds, or -1 if measurement failed
     */
    measure(name, start, end) {
        if (!_hasPerf) return -1;

        try {
            const opts = { start: PREFIX + start };
            if (end) {
                opts.end = PREFIX + end;
            }
            const entry = performance.measure(PREFIX + name, opts);
            const duration = entry.duration;

            if (_debug) {
                _logDuration(name, duration);
            }

            return duration;
        } catch {
            return -1;
        }
    },

    /**
     * Time a synchronous or asynchronous function.
     *
     * @param {string} label - Label for the measurement
     * @param {Function} fn  - Function to execute (may return a Promise)
     * @returns {*} The return value of fn (or a Promise resolving to it)
     */
    time(label, fn) {
        if (typeof fn !== 'function') {
            throw new TypeError('[DES Perf] fn must be a function');
        }

        const startMark = `${label}:start`;
        const endMark = `${label}:end`;

        this.mark(startMark);

        let result;
        try {
            result = fn();
        } catch (err) {
            this.mark(endMark);
            this.measure(label, startMark, endMark);
            _cleanup(startMark, endMark, label);
            throw err;
        }

        // Handle async functions
        if (result && typeof result.then === 'function') {
            return result.then(
                (value) => {
                    this.mark(endMark);
                    this.measure(label, startMark, endMark);
                    _cleanup(startMark, endMark, label);
                    return value;
                },
                (err) => {
                    this.mark(endMark);
                    this.measure(label, startMark, endMark);
                    _cleanup(startMark, endMark, label);
                    throw err;
                }
            );
        }

        // Synchronous path
        this.mark(endMark);
        this.measure(label, startMark, endMark);
        _cleanup(startMark, endMark, label);
        return result;
    },

    /**
     * Clear all DES performance entries.
     */
    clear() {
        if (!_hasPerf) return;
        try {
            const entries = performance.getEntriesByType('mark')
                .concat(performance.getEntriesByType('measure'));
            for (const entry of entries) {
                if (entry.name.startsWith(PREFIX)) {
                    if (entry.entryType === 'mark') {
                        performance.clearMarks(entry.name);
                    } else {
                        performance.clearMeasures(entry.name);
                    }
                }
            }
        } catch { /* ignore */ }
    },

    /**
     * Get all DES performance measures as an array of { name, duration } objects.
     * Useful for reporting.
     *
     * @returns {Array<{ name: string, duration: number }>}
     */
    getEntries() {
        if (!_hasPerf) return [];
        try {
            return performance.getEntriesByType('measure')
                .filter(e => e.name.startsWith(PREFIX))
                .map(e => ({ name: e.name.slice(PREFIX.length), duration: e.duration }));
        } catch {
            return [];
        }
    },
};

// ── Internal helpers ──

/**
 * Log a duration with severity based on thresholds.
 * Only called when debug mode is enabled.
 *
 * @param {string} label
 * @param {number} duration
 */
function _logDuration(label, duration) {
    if (duration >= THRESHOLDS.ERROR) {
        console.warn(`[DES Perf] SLOW ${label}: ${duration.toFixed(1)}ms (>${THRESHOLDS.ERROR}ms)`);
    } else if (duration >= THRESHOLDS.WARN) {
        console.warn(`[DES Perf] ${label}: ${duration.toFixed(1)}ms (>${THRESHOLDS.WARN}ms)`);
    } else if (duration >= THRESHOLDS.INFO) {
        console.debug(`[DES Perf] ${label}: ${duration.toFixed(1)}ms`);
    }
    // Below INFO threshold: completely silent
}

/**
 * Clean up temporary marks and measures to avoid unbounded memory growth.
 *
 * @param {string} startMark
 * @param {string} endMark
 * @param {string} measureName
 */
function _cleanup(startMark, endMark, measureName) {
    if (!_hasPerf) return;
    try {
        performance.clearMarks(PREFIX + startMark);
        performance.clearMarks(PREFIX + endMark);
        performance.clearMeasures(PREFIX + measureName);
    } catch { /* ignore */ }
}
