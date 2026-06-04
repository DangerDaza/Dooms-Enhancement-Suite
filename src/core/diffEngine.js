/**
 * Diff Engine
 * Lightweight state-diff computation.
 * Compares two snapshots and returns which keys changed.
 * Pure utility — no external dependencies.
 */

/**
 * Shallow-compare two values. Returns true if they are the same reference or
 * structurally identical primitives.
 * @param {*} a
 * @param {*} b
 * @returns {boolean}
 */
export function shallowEqual(a, b) {
    if (Object.is(a, b)) return true;
    // Both must be non-null objects to continue
    if (
        a === null || b === null ||
        typeof a !== 'object' || typeof b !== 'object'
    ) {
        return false;
    }
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);
    if (keysA.length !== keysB.length) return false;
    for (let i = 0; i < keysA.length; i++) {
        const key = keysA[i];
        if (!Object.prototype.hasOwnProperty.call(b, key) || !Object.is(a[key], b[key])) {
            return false;
        }
    }
    return true;
}

/**
 * Deep-compare two values. Returns true if structurally equal.
 * Handles primitives, plain objects, arrays, null, undefined.
 * Does NOT handle Map, Set, Date, RegExp (not needed for state snapshots).
 * @param {*} a
 * @param {*} b
 * @returns {boolean}
 */
export function deepEqual(a, b) {
    if (Object.is(a, b)) return true;
    if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') {
        return false;
    }

    const aIsArray = Array.isArray(a);
    const bIsArray = Array.isArray(b);
    if (aIsArray !== bIsArray) return false;

    if (aIsArray) {
        if (a.length !== b.length) return false;
        for (let i = 0; i < a.length; i++) {
            if (!deepEqual(a[i], b[i])) return false;
        }
        return true;
    }

    const keysA = Object.keys(a);
    const keysB = Object.keys(b);
    if (keysA.length !== keysB.length) return false;

    for (let i = 0; i < keysA.length; i++) {
        const key = keysA[i];
        if (!Object.prototype.hasOwnProperty.call(b, key) || !deepEqual(a[key], b[key])) {
            return false;
        }
    }
    return true;
}

/**
 * Compare two state snapshots and return the set of top-level keys that changed.
 *
 * By default uses reference equality (===) for speed. Pass `deep: true` to
 * use deepEqual for specific keys.
 *
 * @param {Object} prev - Previous snapshot
 * @param {Object} next - Current snapshot
 * @param {Object} [options]
 * @param {string[]} [options.deepKeys] - Keys to compare with deepEqual instead of ===
 * @returns {Set<string>} Set of changed key names
 */
export function diffSnapshots(prev, next, { deepKeys = [] } = {}) {
    const changed = new Set();
    if (!prev || !next) {
        // If either is missing, everything changed
        const source = next || prev || {};
        for (const key of Object.keys(source)) {
            changed.add(key);
        }
        return changed;
    }

    const deepKeySet = deepKeys.length > 0 ? new Set(deepKeys) : null;

    // Check all keys in next
    const nextKeys = Object.keys(next);
    for (let i = 0; i < nextKeys.length; i++) {
        const key = nextKeys[i];
        const pVal = prev[key];
        const nVal = next[key];

        if (Object.is(pVal, nVal)) continue;

        if (deepKeySet && deepKeySet.has(key)) {
            if (!deepEqual(pVal, nVal)) {
                changed.add(key);
            }
        } else {
            // Reference inequality => changed
            changed.add(key);
        }
    }

    // Check for keys removed from prev
    const prevKeys = Object.keys(prev);
    for (let i = 0; i < prevKeys.length; i++) {
        const key = prevKeys[i];
        if (!(key in next)) {
            changed.add(key);
        }
    }

    return changed;
}
