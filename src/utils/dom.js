/**
 * DOM Utilities
 * Helpers for efficient, batched DOM manipulation.
 * Pure utility — no external dependencies.
 */

// ── RAF batching ──

/** @type {Function[]} */
let _pendingReads = [];
/** @type {Function[]} */
let _pendingWrites = [];
let _rafScheduled = false;

function _flushBatch() {
    _rafScheduled = false;

    // Execute all reads first (measure), then all writes (mutate).
    // This avoids interleaved read/write which triggers forced layout.
    const reads = _pendingReads;
    const writes = _pendingWrites;
    _pendingReads = [];
    _pendingWrites = [];

    for (let i = 0; i < reads.length; i++) {
        try { reads[i](); } catch (e) { console.error('[DES DOM] read error:', e); }
    }
    for (let i = 0; i < writes.length; i++) {
        try { writes[i](); } catch (e) { console.error('[DES DOM] write error:', e); }
    }
}

function _scheduleFlush() {
    if (!_rafScheduled) {
        _rafScheduled = true;
        requestAnimationFrame(_flushBatch);
    }
}

/**
 * Schedule a DOM read (measurement) in the next animation frame.
 * Reads run before writes to avoid layout thrashing.
 * @param {Function} fn
 */
export function batchRead(fn) {
    _pendingReads.push(fn);
    _scheduleFlush();
}

/**
 * Schedule a DOM write (mutation) in the next animation frame.
 * Writes run after all reads in the same frame.
 * @param {Function} fn
 */
export function batchWrite(fn) {
    _pendingWrites.push(fn);
    _scheduleFlush();
}

// ── Batch replace ──

/**
 * Replace all children of a container using a DocumentFragment for a single reflow.
 * @param {HTMLElement} container
 * @param {HTMLElement[]|NodeList} newChildren
 */
export function batchReplace(container, newChildren) {
    if (!container) return;
    const fragment = document.createDocumentFragment();
    for (let i = 0; i < newChildren.length; i++) {
        fragment.appendChild(newChildren[i]);
    }
    container.textContent = ''; // fastest way to clear
    container.appendChild(fragment);
}

// ── Keyed reconciliation ──

/**
 * Reconcile children of a container against a list of items using stable keys.
 * Minimizes DOM mutations by reusing, reordering, creating, and removing nodes.
 *
 * @param {HTMLElement} container - Parent element
 * @param {Array} newItems - New list of data items
 * @param {Function} keyFn - (item) => string — returns a unique key per item
 * @param {Function} createFn - (item) => HTMLElement — creates a new DOM node
 * @param {Function} updateFn - (existingEl, item) => void — updates an existing DOM node
 */
export function reconcileChildren(container, newItems, keyFn, createFn, updateFn) {
    if (!container) return;

    // Build a map of existing keyed children
    const existingByKey = new Map();
    const children = container.children;
    for (let i = 0; i < children.length; i++) {
        const key = children[i].dataset.desKey;
        if (key !== undefined) {
            existingByKey.set(key, children[i]);
        }
    }

    const newKeys = new Set();
    const fragment = document.createDocumentFragment();

    for (let i = 0; i < newItems.length; i++) {
        const item = newItems[i];
        const key = String(keyFn(item));
        newKeys.add(key);

        let el = existingByKey.get(key);
        if (el) {
            updateFn(el, item);
        } else {
            el = createFn(item);
            el.dataset.desKey = key;
        }
        fragment.appendChild(el);
    }

    // Remove nodes whose keys are no longer present
    for (const [key, el] of existingByKey) {
        if (!newKeys.has(key)) {
            el.remove();
        }
    }

    container.textContent = '';
    container.appendChild(fragment);
}

// ── Safe query ──

/**
 * Safe querySelector that always returns null (never throws) and supports
 * an optional context element.
 * @param {string} selector
 * @param {Element|Document} [context=document]
 * @returns {Element|null}
 */
export function safeQuery(selector, context = document) {
    if (!selector || !context) return null;
    try {
        return context.querySelector(selector);
    } catch {
        return null;
    }
}

// ── Toggle class without redundant writes ──

/**
 * Add or remove a class only when the current state differs from the desired state.
 * Avoids triggering style recalc when nothing changes.
 * @param {Element} el
 * @param {string} className
 * @param {boolean} [force] - If provided, add when true, remove when false
 */
export function toggleClass(el, className, force) {
    if (!el || !className) return;
    const has = el.classList.contains(className);
    const want = force !== undefined ? force : !has;
    if (has !== want) {
        el.classList.toggle(className, want);
    }
}
