/**
 * Feature Registry
 * Manages lifecycle of feature modules: init, enable, disable, destroy.
 * Feature modules register themselves with dependencies and the registry
 * ensures they initialize in the correct order.
 */

import { DESPerf } from './perf.js';

/**
 * @typedef {Object} FeatureModule
 * @property {string} id - Unique feature identifier
 * @property {Function} [init] - Called once during startup
 * @property {Function} [enable] - Called when the feature is enabled
 * @property {Function} [disable] - Called when the feature is disabled
 * @property {Function} [destroy] - Called during teardown
 * @property {string[]} [dependencies] - IDs of features that must init first
 */

/** @type {Map<string, FeatureModule>} */
const _features = new Map();

/** @type {Set<string>} */
const _initialized = new Set();

/** @type {Set<string>} */
const _enabled = new Set();

export const FeatureRegistry = {
    /**
     * Register a feature module.
     * @param {FeatureModule} feature
     */
    register(feature) {
        if (!feature || !feature.id) {
            console.error('[DES Registry] Feature must have an id');
            return;
        }
        if (_features.has(feature.id)) {
            console.warn(`[DES Registry] Feature "${feature.id}" already registered, replacing`);
        }
        _features.set(feature.id, feature);
    },

    /**
     * Initialize all registered features in dependency order.
     * @returns {Promise<void>}
     */
    async initAll() {
        const sorted = _topologicalSort();
        for (const id of sorted) {
            await this.initFeature(id);
        }
    },

    /**
     * Initialize a single feature by ID.
     * @param {string} id
     * @returns {Promise<void>}
     */
    async initFeature(id) {
        if (_initialized.has(id)) return;
        const feature = _features.get(id);
        if (!feature) return;

        // Init dependencies first
        if (feature.dependencies) {
            for (const depId of feature.dependencies) {
                await this.initFeature(depId);
            }
        }

        if (feature.init) {
            try {
                await DESPerf.time(`init:${id}`, () => feature.init());
                _initialized.add(id);
                _enabled.add(id);
            } catch (err) {
                console.error(`[DES Registry] Failed to init feature "${id}":`, err);
            }
        } else {
            _initialized.add(id);
            _enabled.add(id);
        }
    },

    /**
     * Enable a feature (calls its enable() if present).
     * @param {string} id
     */
    enable(id) {
        const feature = _features.get(id);
        if (!feature || !_initialized.has(id)) return;
        if (_enabled.has(id)) return;

        try {
            if (feature.enable) feature.enable();
            _enabled.add(id);
        } catch (err) {
            console.error(`[DES Registry] Failed to enable feature "${id}":`, err);
        }
    },

    /**
     * Disable a feature (calls its disable() if present).
     * @param {string} id
     */
    disable(id) {
        const feature = _features.get(id);
        if (!feature || !_enabled.has(id)) return;

        try {
            if (feature.disable) feature.disable();
            _enabled.delete(id);
        } catch (err) {
            console.error(`[DES Registry] Failed to disable feature "${id}":`, err);
        }
    },

    /**
     * Destroy all features (reverse init order).
     */
    destroyAll() {
        const sorted = _topologicalSort().reverse();
        for (const id of sorted) {
            const feature = _features.get(id);
            if (feature && feature.destroy) {
                try {
                    feature.destroy();
                } catch (err) {
                    console.error(`[DES Registry] Failed to destroy feature "${id}":`, err);
                }
            }
        }
        _initialized.clear();
        _enabled.clear();
    },

    /** @returns {boolean} */
    isInitialized(id) { return _initialized.has(id); },

    /** @returns {boolean} */
    isEnabled(id) { return _enabled.has(id); },

    /** @returns {string[]} All registered feature IDs */
    getFeatureIds() { return [..._features.keys()]; },
};

/**
 * Simple topological sort for dependency ordering.
 * Falls back to registration order if no deps.
 * @returns {string[]}
 */
function _topologicalSort() {
    const visited = new Set();
    const result = [];

    function visit(id) {
        if (visited.has(id)) return;
        visited.add(id);
        const feature = _features.get(id);
        if (feature?.dependencies) {
            for (const depId of feature.dependencies) {
                visit(depId);
            }
        }
        result.push(id);
    }

    for (const id of _features.keys()) {
        visit(id);
    }
    return result;
}
