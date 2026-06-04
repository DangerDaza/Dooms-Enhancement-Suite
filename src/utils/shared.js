/**
 * Shared Utilities
 * Common functions extracted from multiple modules to avoid duplication.
 * Pure utility — no SillyTavern dependencies.
 */

/**
 * Escape a string for safe insertion into HTML.
 * Uses a single reusable text node instead of creating/destroying DOM elements.
 * @param {string} str
 * @returns {string}
 */
let _escapeDiv = null;
export function escapeHtml(str) {
    if (!str) return '';
    if (!_escapeDiv) {
        _escapeDiv = document.createElement('div');
    }
    _escapeDiv.textContent = str;
    return _escapeDiv.innerHTML;
}

/**
 * Convert a hex color string to RGB components.
 * Supports #RGB and #RRGGBB formats.
 * @param {string} hex
 * @returns {{ r: number, g: number, b: number }|null}
 */
export function hexToRgb(hex) {
    if (!hex || typeof hex !== 'string') return null;
    hex = hex.replace(/^#/, '');
    if (hex.length === 3) {
        hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
    }
    if (hex.length !== 6) return null;
    const num = parseInt(hex, 16);
    if (isNaN(num)) return null;
    return {
        r: (num >> 16) & 255,
        g: (num >> 8) & 255,
        b: num & 255,
    };
}

/**
 * Case-insensitive, whitespace-tolerant name comparison.
 * Matches "Sakura", "sakura", " Sakura " etc.
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
export function namesMatch(a, b) {
    if (!a || !b) return false;
    return String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
}

/**
 * Clamp a number to a range.
 * @param {number} value
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
export function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
}
