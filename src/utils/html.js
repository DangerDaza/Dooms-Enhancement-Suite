/**
 * Shared HTML escaping utilities.
 * Single audited implementation — do not add per-module copies.
 */

/**
 * Escapes the 5 HTML-significant characters. Safe for element text content
 * AND for values inside double- or single-quoted attributes.
 * @param {*} value Coerced to string; null/undefined become ''.
 * @returns {string}
 */
export function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/**
 * Alias for quoted-attribute contexts. Same 5-char escape — separate name so
 * call sites document intent. NOT for unquoted attributes and NOT for jQuery
 * selectors (see portraitBar's local escapeJsString for that).
 */
export const escapeAttr = escapeHtml;
