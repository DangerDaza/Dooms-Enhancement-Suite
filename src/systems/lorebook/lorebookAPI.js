/**
 * Lorebook API Adapter
 * Thin wrapper around SillyTavern's World Info API for use by the Lorebook Manager.
 * All WI interactions go through this module to keep the rest of the lorebook code
 * decoupled from ST internals.
 */
import {
    world_names,
    selected_world_info,
    loadWorldInfo,
    saveWorldInfo,
    createWorldInfoEntry,
    deleteWorldInfoEntry,
    createNewWorldInfo,
    updateWorldInfoList,
    importWorldInfo,
    // Global WI settings (read)
    world_info_depth,
    world_info_budget,
    world_info_budget_cap,
    world_info_min_activations,
    world_info_min_activations_depth_max,
    world_info_max_recursion_steps,
    world_info_character_strategy,
    world_info_include_names,
    world_info_recursive,
    world_info_case_sensitive,
    world_info_match_whole_words,
    world_info_use_group_scoring,
    world_info_overflow_alert,
    // Global WI settings (write)
    updateWorldInfoSettings,
} from '../../../../../../../scripts/world-info.js';

import { saveSettingsDebounced } from '../../../../../../../script.js';
import { download } from '../../../../../../../scripts/utils.js';

// ─── Cache ──────────────────────────────────────────────────────────────────
// Module-level cache for loaded WI data so we don't reload on every expand
const wiDataCache = new Map();

/**
 * Clears the WI data cache (call when world info changes externally)
 */
export function clearWICache() {
    wiDataCache.clear();
}

/**
 * Removes a single entry from the cache
 * @param {string} name - WI filename to invalidate
 */
export function invalidateWICache(name) {
    wiDataCache.delete(name);
}

// ─── World Names ────────────────────────────────────────────────────────────

/**
 * Returns the full list of available WI filenames
 * @returns {string[]}
 */
export function getAllWorldNames() {
    return world_names || [];
}

/**
 * Returns the list of currently active (selected) WI filenames
 * @returns {string[]}
 */
export function getActiveWorldNames() {
    return selected_world_info || [];
}

/**
 * Checks whether a WI file is currently active
 * @param {string} name - WI filename
 * @returns {boolean}
 */
export function isWorldActive(name) {
    return (selected_world_info || []).includes(name);
}

// ─── Activate / Deactivate ──────────────────────────────────────────────────

/**
 * Activates a WI file by adding it to selected_world_info
 * @param {string} name - WI filename to activate
 */
export async function activateWorld(name) {
    if (!selected_world_info.includes(name)) {
        selected_world_info.push(name);
        await updateWorldInfoList();
        // Trigger ST's native change handler so it syncs world_info.globalSelect
        // and persists via its own saveSettingsDebounced (which includes the sync).
        // Without this, the global saveSettingsDebounced doesn't update globalSelect,
        // causing active lorebooks to revert on page reload.
        $('#world_info').trigger('change');
    }
}

/**
 * Deactivates a WI file by removing it from selected_world_info
 * @param {string} name - WI filename to deactivate
 */
export async function deactivateWorld(name) {
    const idx = selected_world_info.indexOf(name);
    if (idx !== -1) {
        selected_world_info.splice(idx, 1);
        await updateWorldInfoList();
        // Trigger ST's native change handler so it syncs world_info.globalSelect
        // and persists correctly (see activateWorld comment for details).
        $('#world_info').trigger('change');
    }
}

// ─── Load / Save ────────────────────────────────────────────────────────────

/**
 * Loads WI data for a given world name (with caching)
 * @param {string} name - WI filename
 * @param {boolean} [forceReload=false] - Skip cache and reload from disk
 * @returns {Promise<Object>} The WI data object (entries keyed by uid)
 */
export async function loadWorldData(name, forceReload = false) {
    if (!forceReload && wiDataCache.has(name)) {
        return wiDataCache.get(name);
    }
    const data = await loadWorldInfo(name);
    if (data) {
        wiDataCache.set(name, data);
    }
    return data;
}

/**
 * Saves WI data for a given world name and updates cache
 * @param {string} name - WI filename
 * @param {Object} data - The WI data object
 */
export async function saveWorldData(name, data) {
    wiDataCache.set(name, data);
    await saveWorldInfo(name, data, true);
}

// ─── Entry CRUD ─────────────────────────────────────────────────────────────

/**
 * Creates a new entry in a WI file
 * @param {string} name - WI filename
 * @param {Object} data - The WI data object
 * @returns {Object} The updated data with the new entry
 */
export function createEntry(name, data) {
    return createWorldInfoEntry(name, data);
}

/**
 * Deletes an entry from a WI file
 * @param {Object} data - The WI data object
 * @param {number} uid - Entry UID to delete
 */
export async function deleteEntry(data, uid) {
    await deleteWorldInfoEntry(data, uid, { silent: true });
}

// ─── World CRUD ─────────────────────────────────────────────────────────────

/**
 * Creates a brand-new WI file
 * @param {string} name - Name for the new world
 */
export async function createNewWorld(name) {
    await createNewWorldInfo(name, { interactive: false });
}

// ─── Utilities ──────────────────────────────────────────────────────────────

/**
 * Counts the number of entries in a WI data object
 * @param {Object} data - WI data object
 * @returns {number}
 */
export function getEntryCount(data) {
    if (!data || !data.entries) return 0;
    return Object.keys(data.entries).length;
}

/**
 * Rough token estimate for a WI data object (all entry content combined)
 * Uses ~3.5 chars per token as a rough heuristic
 * @param {Object} data - WI data object
 * @returns {number} Estimated token count
 */
export function estimateTokens(data) {
    if (!data || !data.entries) return 0;
    let totalChars = 0;
    for (const entry of Object.values(data.entries)) {
        if (entry.content) totalChars += entry.content.length;
        if (entry.key && Array.isArray(entry.key)) totalChars += entry.key.join(', ').length;
        if (entry.keysecondary && Array.isArray(entry.keysecondary)) totalChars += entry.keysecondary.join(', ').length;
    }
    return Math.round(totalChars / 3.5);
}

/**
 * Gets entries from a WI data object as an array sorted by order (descending by default)
 * @param {Object} data - WI data object
 * @returns {Array<{uid: number, entry: Object}>}
 */
export function getEntriesSorted(data) {
    if (!data || !data.entries) return [];
    return Object.entries(data.entries)
        .map(([uid, entry]) => ({ uid: Number(uid), entry }))
        .sort((a, b) => (b.entry.order ?? 0) - (a.entry.order ?? 0));
}

/**
 * Updates a single field on a WI entry
 * @param {Object} data - WI data object
 * @param {number} uid - Entry UID
 * @param {string} field - Field name to update
 * @param {*} value - New value
 */
export function updateEntryField(data, uid, field, value) {
    if (data && data.entries && data.entries[uid] !== undefined) {
        data.entries[uid][field] = value;
    }
}

// ─── Global WI Settings ─────────────────────────────────────────────────────

/**
 * Returns the current global WI activation settings (live values from ST).
 * These are NOT per-entry settings — they control how WI scanning/insertion works globally.
 * @returns {Object}
 */
export function getGlobalWISettings() {
    return {
        world_info_depth,
        world_info_budget,
        world_info_budget_cap,
        world_info_min_activations,
        world_info_min_activations_depth_max,
        world_info_max_recursion_steps,
        world_info_character_strategy,
        world_info_include_names,
        world_info_recursive,
        world_info_case_sensitive,
        world_info_match_whole_words,
        world_info_use_group_scoring,
        world_info_overflow_alert,
    };
}

/**
 * Updates a single global WI setting and syncs with ST's native UI elements.
 * @param {string} key - Setting key (e.g., 'world_info_depth')
 * @param {*} value - New value
 */
export function setGlobalWISetting(key, value) {
    // Update ST's internal variables
    updateWorldInfoSettings({ [key]: value });

    // Sync the native ST DOM element so the WI drawer stays in sync
    const $nativeEl = $(`#${key}`);
    if ($nativeEl.length) {
        if ($nativeEl.is(':checkbox')) {
            $nativeEl.prop('checked', Boolean(value)).trigger('change');
        } else {
            $nativeEl.val(value).trigger('input');
        }
    }

    saveSettingsDebounced();
}

// ─── Import / Export ─────────────────────────────────────────────────────────

/**
 * Imports a lorebook file using ST's native import pipeline.
 * Supports .json, .lorebook (Novel), and .png (embedded data).
 * @param {File} file - File object from a file input
 */
export async function importWorld(file) {
    await importWorldInfo(file);
}

/**
 * Exports a lorebook as a .json download.
 * @param {string} name - WI filename to export
 */
export async function exportWorld(name) {
    const data = await loadWorldData(name, true);
    if (!data) return;
    download(JSON.stringify(data), `${name}.json`, 'application/json');
}
