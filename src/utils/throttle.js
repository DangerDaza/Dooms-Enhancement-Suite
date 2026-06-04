/**
 * Throttle Utility
 * Standard throttle with leading/trailing edge and cancel support.
 * Pure utility — no external dependencies.
 */

/**
 * Creates a throttled version of the given function that invokes at most once
 * per `wait` milliseconds.
 * @param {Function} fn - Function to throttle
 * @param {number} wait - Minimum interval between invocations in milliseconds
 * @param {Object} [options]
 * @param {boolean} [options.leading=true] - Invoke on the leading edge
 * @param {boolean} [options.trailing=true] - Invoke on the trailing edge
 * @returns {Function & { cancel: Function }} Throttled function
 */
export function throttle(fn, wait, { leading = true, trailing = true } = {}) {
    let timerId = null;
    let lastArgs = null;
    let lastThis = null;
    let result;
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

    function startTimer() {
        const elapsed = Date.now() - lastInvokeTime;
        const remaining = Math.max(0, wait - elapsed);
        timerId = setTimeout(trailingEdge, remaining);
    }

    function trailingEdge() {
        timerId = null;
        if (trailing && lastArgs) {
            invokeFunc();
            // Restart the cooldown after a trailing invocation
            startTimer();
        } else {
            lastArgs = null;
            lastThis = null;
        }
    }

    function throttled(...args) {
        const now = Date.now();
        const elapsed = now - lastInvokeTime;

        lastArgs = args;
        lastThis = this;

        // Leading edge: enough time has passed and no timer is running
        if (elapsed >= wait && leading) {
            // Cancel any stale trailing timer
            if (timerId !== null) {
                clearTimeout(timerId);
                timerId = null;
            }
            invokeFunc();
            startTimer();
            return result;
        }

        // Schedule trailing edge if not already scheduled
        if (timerId === null) {
            startTimer();
        }

        return result;
    }

    /**
     * Cancel any pending trailing invocation.
     */
    throttled.cancel = function cancel() {
        if (timerId !== null) {
            clearTimeout(timerId);
            timerId = null;
        }
        lastInvokeTime = 0;
        lastArgs = null;
        lastThis = null;
    };

    return throttled;
}
