/**
 * Memoized parsing for tracker JSON blobs (characterThoughts / infoBox).
 *
 * The same JSON strings from lastGeneratedData/committedTrackerData are read
 * by several renderers back-to-back on every message (scene headers, portrait
 * bar, thoughts panel, info box, chat bubbles). A tiny string-identity cache
 * means each blob is parsed once per change instead of 6–8 times per render.
 */

/** @type {Array<{ raw: string, result: object|Array|null }>} */
const cache = [];
const CACHE_SIZE = 4; // characterThoughts + infoBox for both last/committed sources

/**
 * Parses a tracker JSON string with memoization.
 *
 * Keyed on string identity: the same string returns the SAME parsed object,
 * so callers MUST treat the result as read-only. Paths that mutate and
 * re-stringify tracker data must keep using JSON.parse — writing the new
 * string back naturally invalidates this cache.
 *
 * @param {*} raw Tracker blob. Non-strings (already-parsed data) are returned
 *   as-is; unparseable strings return null (callers keep their legacy
 *   text-format fallbacks). Parse failures are cached too, so malformed blobs
 *   aren't re-parsed on every render.
 * @returns {object|Array|null}
 */
export function parseTrackerJson(raw) {
    if (typeof raw !== 'string') return raw ?? null;
    for (const entry of cache) {
        if (entry.raw === raw) return entry.result;
    }
    let result = null;
    try {
        result = JSON.parse(raw);
    } catch (e) {
        result = null;
    }
    cache.push({ raw, result });
    if (cache.length > CACHE_SIZE) cache.shift();
    return result;
}
