/**
 * Debounce Utility
 * Standard debounce with leading/trailing edge, cancel, and flush support.
 * Pure utility — no external dependencies.
 */

/**
 * Creates a debounced version of the given function.
 * @param {Function} fn - Function to debounce
 * @param {number} wait - Delay in milliseconds
 * @param {Object} [options]
 * @param {boolean} [options.leading=false] - Invoke on the leading edge
 * @param {boolean} [options.trailing=true] - Invoke on the trailing edge
 * @returns {Function & { cancel: Function, flush: Function }} Debounced function
 */
export function debounce(fn, wait, { leading = false, trailing = true } = {}) {
    let timerId = null;
    let lastArgs = null;
    let lastThis = null;
    let result;
    let lastCallTime = 0;
    let lastInvokeTime = 0;

    function invokeFunc() {
        const args = lastArgs;
        const thisArg = lastThis;
        lastArgs = null;
        lastThis = null;
        lastInvokeTime = Date.now();
        result = fn.apply(thisArg, args);
        return result;
    }

    function startTimer(pendingFn, delay) {
        timerId = setTimeout(pendingFn, delay);
    }

    function cancelTimer() {
        if (timerId !== null) {
            clearTimeout(timerId);
            timerId = null;
        }
    }

    function trailingEdge() {
        timerId = null;
        if (trailing && lastArgs) {
            return invokeFunc();
        }
        lastArgs = null;
        lastThis = null;
        return result;
    }

    function remainingWait() {
        const timeSinceLastCall = Date.now() - lastCallTime;
        return Math.max(0, wait - timeSinceLastCall);
    }

    function shouldInvoke(time) {
        const timeSinceLastCall = time - lastCallTime;
        const timeSinceLastInvoke = time - lastInvokeTime;
        // First call, or enough time passed, or system clock went backwards
        return (
            lastCallTime === 0 ||
            timeSinceLastCall >= wait ||
            timeSinceLastCall < 0
        );
    }

    function timerExpired() {
        const time = Date.now();
        if (shouldInvoke(time)) {
            return trailingEdge();
        }
        // Restart timer with remaining delay
        startTimer(timerExpired, remainingWait());
    }

    function leadingEdge() {
        lastInvokeTime = Date.now();
        // Start timer for the trailing edge
        startTimer(timerExpired, wait);
        // Invoke on leading edge if configured
        return leading ? invokeFunc() : result;
    }

    function debounced(...args) {
        const time = Date.now();
        const isInvoking = shouldInvoke(time);

        lastArgs = args;
        lastThis = this;
        lastCallTime = time;

        if (isInvoking) {
            if (timerId === null) {
                return leadingEdge();
            }
        }
        if (timerId === null) {
            startTimer(timerExpired, wait);
        }
        return result;
    }

    /**
     * Cancel any pending invocation.
     */
    debounced.cancel = function cancel() {
        cancelTimer();
        lastInvokeTime = 0;
        lastCallTime = 0;
        lastArgs = null;
        lastThis = null;
    };

    /**
     * Immediately invoke the pending function if one exists.
     * @returns {*} Result of the invoked function
     */
    debounced.flush = function flush() {
        if (timerId === null) {
            return result;
        }
        cancelTimer();
        return trailingEdge();
    };

    /**
     * Check if a timer is currently pending.
     * @returns {boolean}
     */
    debounced.pending = function pending() {
        return timerId !== null;
    };

    return debounced;
}
