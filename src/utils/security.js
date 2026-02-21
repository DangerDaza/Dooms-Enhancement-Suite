/**
 * Security Utilities Module
 * Handles input sanitization and validation to prevent security vulnerabilities
 */
import { parseItems, serializeItems } from './itemParser.js';
/**
 * List of dangerous property names that could cause prototype pollution
 * or shadow critical object methods.
 * @private
 */
const BLOCKED_PROPERTY_NAMES = [
    '__proto__',
    'constructor',
    'prototype',
    'toString',
    'valueOf',
    'hasOwnProperty',
    '__defineGetter__',
    '__defineSetter__',
    '__lookupGetter__',
    '__lookupSetter__'
];
/**
 * Validates and sanitizes storage location names.
 * Prevents prototype pollution and object property shadowing attacks.
 *
 * @param {string} name - Location name to validate
 * @returns {string|null} Sanitized location name or null if invalid/dangerous
 *
 * @example
 * sanitizeLocationName("Home") // "Home"
 * sanitizeLocationName("__proto__") // null (blocked, logs warning)
 * sanitizeLocationName("A".repeat(300)) // "AAA..." (truncated to 200 chars)
 */
export function sanitizeLocationName(name) {
    if (!name || typeof name !== 'string') {
        return null;
    }
    const trimmed = name.trim();
    // Empty check
    if (trimmed === '') {
        return null;
    }
    // Check for dangerous property names (case-insensitive)
    const lowerName = trimmed.toLowerCase();
    if (BLOCKED_PROPERTY_NAMES.some(blocked => lowerName === blocked.toLowerCase())) {
        console.warn(`[Dooms Tracker] Blocked dangerous location name: "${trimmed}"`);
        return null;
    }
    // Max length check (reasonable location name)
    const MAX_LOCATION_LENGTH = 200;
    if (trimmed.length > MAX_LOCATION_LENGTH) {
        console.warn(`[Dooms Tracker] Location name too long (${trimmed.length} chars), truncating to ${MAX_LOCATION_LENGTH}`);
        return trimmed.slice(0, MAX_LOCATION_LENGTH);
    }
    return trimmed;
}
/**
 * Validates and sanitizes item names.
 * Prevents excessively long item names that could cause DoS or UI issues.
 *
 * @param {string} name - Item name to validate
 * @returns {string|null} Sanitized item name or null if invalid
 *
 * @example
 * sanitizeItemName("Sword") // "Sword"
 * sanitizeItemName("") // null
 * sanitizeItemName("A".repeat(600)) // "AAA..." (truncated to 500 chars)
 */
export function sanitizeItemName(name) {
    if (!name || typeof name !== 'string') {
        return null;
    }
    const trimmed = name.trim();
    // Empty check
    if (trimmed === '' || trimmed.toLowerCase() === 'none') {
        return null;
    }
    // Max length check (reasonable item name with description)
    const MAX_ITEM_LENGTH = 500;
    if (trimmed.length > MAX_ITEM_LENGTH) {
        console.warn(`[Dooms Tracker] Item name too long (${trimmed.length} chars), truncating to ${MAX_ITEM_LENGTH}`);
        return trimmed.slice(0, MAX_ITEM_LENGTH);
    }
    return trimmed;
}
/**
 * Validates and cleans a stored inventory object.
 * Ensures all keys are safe property names and all values are strings.
 * Cleans items within each location (removes corrupted/dangerous items).
 * Preserves empty locations (with "None") so users can add items later.
 * Prevents prototype pollution attacks via object keys.
 *
 * @param {Object} stored - Raw stored inventory object
 * @returns {Object} Cleaned stored inventory object (always a plain object)
 *
 * @example
 * validateStoredInventory({ "Home": "Sword, Shield" })
 * // → { "Home": "Sword, Shield" }
 *
 * validateStoredInventory({ "Home": "Sword, __proto__, Shield" })
 * // → { "Home": "Sword, Shield" } (dangerous item removed, logged)
 *
 * validateStoredInventory({ "Home": "None" })
 * // → { "Home": "None" } (empty location preserved)
 *
 * validateStoredInventory({ "__proto__": "malicious" })
 * // → {} (dangerous key removed, logged)
 *
 * validateStoredInventory({ "BadLocation": "__proto__, constructor" })
 * // → { "BadLocation": "None" } (all items removed, location kept empty)
 *
 * validateStoredInventory(null)
 * // → {} (invalid input, returns empty object)
 */
export function validateStoredInventory(stored) {
    // Handle invalid input
    if (!stored || typeof stored !== 'object' || Array.isArray(stored)) {
        return {};
    }
    const cleaned = {};
    // Validate each property
    for (const key in stored) {
        // Only check own properties (not inherited)
        if (!Object.prototype.hasOwnProperty.call(stored, key)) {
            continue;
        }
        // Sanitize the location name
        const sanitizedKey = sanitizeLocationName(key);
        if (!sanitizedKey) {
            // Key was invalid or dangerous, skip it
            continue;
        }
        // Ensure value is a string
        const value = stored[key];
        if (typeof value !== 'string') {
            console.warn(`[Dooms Tracker] Invalid stored inventory value for location "${sanitizedKey}", skipping`);
            continue;
        }
        // Clean items within this location (removes corrupted/dangerous items)
        const cleanedValue = cleanItemString(value);
        // Always keep the location (even if empty/"None")
        // "None" is a valid state - it means the location exists but has no items yet
        cleaned[sanitizedKey] = cleanedValue;
        // Warn if we had to clean corrupted items (but only if original wasn't just "None")
        if (value !== cleanedValue && value.toLowerCase() !== 'none') {
            console.warn(`[Dooms Tracker] Cleaned corrupted items from location "${sanitizedKey}": "${value}" → "${cleanedValue}"`);
        }
    }
    return cleaned;
}
/**
 * Maximum number of items allowed in a single inventory section.
 * Prevents DoS via extremely large item lists.
 * @constant {number}
 */
export const MAX_ITEMS_PER_SECTION = 500;
/**
 * Cleans an item string by parsing and re-serializing.
 * Removes corrupted, dangerous, or invalid items while preserving valid ones.
 * Applies ALL parsing rules: markdown stripping, sanitization, length limits, etc.
 *
 * This is used at LOAD time to clean persisted data immediately, not just at render time.
 *
 * @param {string} itemString - Raw item string (possibly corrupted)
 * @returns {string} Clean item string with only valid items, or "None" if no valid items
 *
 * @example
 * cleanItemString("Sword, Shield") // "Sword, Shield" (unchanged)
 * cleanItemString("Sword, __proto__, Shield") // "Sword, Shield" (dangerous item removed)
 * cleanItemString("A".repeat(600) + ", Sword") // "AAA... (truncated), Sword"
 * cleanItemString("**Sword**, *Shield*") // "Sword, Shield" (markdown stripped)
 * cleanItemString("__proto__, constructor") // "None" (all items invalid)
 */
export function cleanItemString(itemString) {
    // Parse using robust parser (handles all edge cases, sanitizes each item)
    // This applies: newlines→commas, markdown stripping, parenthesis-aware splitting,
    // sanitizeItemName() validation, length limits, max items limit
    const items = parseItems(itemString);
    // If no valid items remain after parsing/sanitization, return "None"
    if (items.length === 0) {
        return "None";
    }
    // Re-serialize clean items back to string format
    return serializeItems(items);
}
