/**
 * Visibility Utilities
 * IntersectionObserver and Page Visibility API wrappers.
 * Pure utility — no external dependencies.
 */

// ── Page Visibility ──

/** @type {Set<Function>} */
const _visibleCallbacks = new Set();
/** @type {Set<Function>} */
const _hiddenCallbacks = new Set();
let _pageListenerAttached = false;

function _ensurePageListener() {
    if (_pageListenerAttached) return;
    _pageListenerAttached = true;
    document.addEventListener('visibilitychange', () => {
        const hidden = document.visibilityState === 'hidden';
        const set = hidden ? _hiddenCallbacks : _visibleCallbacks;
        for (const cb of set) {
            try { cb(); } catch (e) { console.error('[DES Visibility]', e); }
        }
    });
}

/**
 * Register a callback that fires when the page becomes visible.
 * @param {Function} callback
 * @returns {Function} Unsubscribe function
 */
export function onPageVisible(callback) {
    _ensurePageListener();
    _visibleCallbacks.add(callback);
    return () => _visibleCallbacks.delete(callback);
}

/**
 * Register a callback that fires when the page becomes hidden.
 * @param {Function} callback
 * @returns {Function} Unsubscribe function
 */
export function onPageHidden(callback) {
    _ensurePageListener();
    _hiddenCallbacks.add(callback);
    return () => _hiddenCallbacks.delete(callback);
}

/**
 * Check if the page is currently visible.
 * @returns {boolean}
 */
export function isPageVisible() {
    return document.visibilityState !== 'hidden';
}

// ── IntersectionObserver ──

/**
 * Create an IntersectionObserver that calls `callback(entries, observer)`.
 * Returns an object with `observe(el)`, `unobserve(el)`, and `disconnect()`.
 *
 * @param {IntersectionObserverCallback} callback
 * @param {IntersectionObserverInit} [options]
 * @returns {{ observe: Function, unobserve: Function, disconnect: Function }}
 */
export function createVisibilityObserver(callback, options = {}) {
    const observer = new IntersectionObserver(callback, {
        threshold: options.threshold ?? 0,
        root: options.root ?? null,
        rootMargin: options.rootMargin ?? '0px',
    });

    return {
        observe(el) { if (el) observer.observe(el); },
        unobserve(el) { if (el) observer.unobserve(el); },
        disconnect() { observer.disconnect(); },
    };
}

/**
 * Quick synchronous check whether an element is visible in the viewport.
 * Uses getBoundingClientRect — suitable for one-off checks, not loops.
 * @param {Element} el
 * @returns {boolean}
 */
export function isElementVisible(el) {
    if (!el) return false;

    // Must be connected to the DOM
    if (!el.isConnected) return false;

    // Check CSS visibility / display
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
        return false;
    }

    // Check viewport intersection
    const rect = el.getBoundingClientRect();
    return (
        rect.width > 0 &&
        rect.height > 0 &&
        rect.bottom > 0 &&
        rect.right > 0 &&
        rect.top < (window.innerHeight || document.documentElement.clientHeight) &&
        rect.left < (window.innerWidth || document.documentElement.clientWidth)
    );
}

/**
 * Observe a single element for enter/leave viewport transitions.
 * Returns an unsubscribe function.
 *
 * @param {Element} el
 * @param {Function} onVisible - Called when the element enters the viewport
 * @param {Function} [onHidden] - Called when the element leaves the viewport
 * @param {IntersectionObserverInit} [options]
 * @returns {Function} Disconnect / unsubscribe function
 */
export function observeElement(el, onVisible, onHidden, options = {}) {
    if (!el) return () => {};

    const observer = new IntersectionObserver((entries) => {
        for (const entry of entries) {
            if (entry.isIntersecting) {
                try { onVisible(entry); } catch (e) { console.error('[DES Visibility]', e); }
            } else if (onHidden) {
                try { onHidden(entry); } catch (e) { console.error('[DES Visibility]', e); }
            }
        }
    }, {
        threshold: options.threshold ?? 0,
        root: options.root ?? null,
        rootMargin: options.rootMargin ?? '0px',
    });

    observer.observe(el);

    return () => {
        observer.unobserve(el);
        observer.disconnect();
    };
}
