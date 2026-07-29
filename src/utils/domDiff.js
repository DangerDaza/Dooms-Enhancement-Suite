/**
 * Keyed DOM reconciliation.
 *
 * Replaces the "rebuild the whole container with .html()" pattern: instead of
 * destroying and recreating every child (which costs a full parse + layout and
 * loses focus/animation/scroll state), existing children are matched to data
 * items by key and updated in place; only genuinely new items create DOM and
 * only departed items are removed.
 */

/**
 * Reconcile a container's children against a list of data items.
 *
 * @param {HTMLElement} container - Parent whose children are managed.
 * @param {Array} items - Data items, in desired display order.
 * @param {Object} opts
 * @param {(item) => string} opts.key - Stable key for an item.
 * @param {(item) => HTMLElement} opts.create - Build the element for a new item.
 *        The returned element gets data-reconcile-key set automatically.
 * @param {(el: HTMLElement, item) => void} opts.update - Patch an existing
 *        element in place for the (possibly changed) item.
 * @param {(el: HTMLElement, item) => void} [opts.onEnter] - Called after a new
 *        element is inserted (entrance animations go here, NOT in update).
 * @param {(el: HTMLElement) => void} [opts.onExit] - Called instead of plain
 *        remove() for departing elements (must remove the element itself).
 * @returns {{created: HTMLElement[], removed: number}}
 */
export function keyedReconcile(container, items, { key, create, update, onEnter, onExit }) {
    // A missing container is a caller-state bug (stale cached reference),
    // but crashing here takes the caller's whole render pass down with it —
    // return the empty result instead.
    if (!container) return { created: [], removed: 0 };
    const existing = new Map();
    for (const child of [...container.children]) {
        const k = child.getAttribute('data-reconcile-key');
        if (k === null) continue;
        if (existing.has(k)) {
            // Duplicate-keyed child (e.g. the tracker listed one name twice
            // on a previous render): keep the first, discard the extra —
            // otherwise the overwritten entry is never matched OR removed
            // and leaks one orphan node per render.
            if (onExit) onExit(child); else child.remove();
            continue;
        }
        existing.set(k, child);
    }

    const created = [];
    let removed = 0;
    let cursor = container.firstElementChild;
    const seenKeys = new Set();

    for (const item of items) {
        const k = String(key(item));
        if (seenKeys.has(k)) continue; // duplicate data item — first wins
        seenKeys.add(k);
        let el = existing.get(k);
        if (el) {
            existing.delete(k);
            update(el, item);
        } else {
            el = create(item);
            el.setAttribute('data-reconcile-key', k);
            created.push(el);
        }
        // Ensure correct position with minimal moves: el belongs at `cursor`.
        if (el === cursor) {
            cursor = cursor.nextElementSibling;
        } else {
            container.insertBefore(el, cursor);
        }
    }

    // Anything left in `existing` is no longer in the data.
    for (const el of existing.values()) {
        removed++;
        if (onExit) onExit(el);
        else el.remove();
    }

    if (onEnter) {
        for (const el of created) {
            const item = items.find(it => String(key(it)) === el.getAttribute('data-reconcile-key'));
            onEnter(el, item);
        }
    }

    return { created, removed };
}
