/**
 * Runtime CSS loader for split feature stylesheets.
 *
 * manifest.json only supports one eager CSS file, so style.css holds the
 * always-needed core and the rest lives in styles/<id>.css files injected
 * on demand:
 *   - 'modals'        — all DES modal/settings UI (with the deferred template)
 *   - 'weather'       — weather overlay/ambience styles (only when enabled)
 *   - 'whats-new'     — release-notes screen (desktop, once per release)
 *
 * ensureCss() resolves when the sheet has loaded, so callers can await it
 * before inserting matching DOM (no flash of unstyled content).
 */
import { extensionFolderPath } from './config.js';

const loaded = new Map(); // id -> Promise<void>

/**
 * Injects styles/<id>.css once. Subsequent calls return the same promise.
 * `href` names another path under the extension's folder instead (a
 * vendored stylesheet: `lib/leaflet/leaflet.css`).
 * @param {string} id
 * @param {string} [href]  a path under the extension's folder, without a leading slash
 * @returns {Promise<void>}
 */
export function ensureCss(id, href = '') {
    if (loaded.has(id)) return loaded.get(id);
    const file = href ? String(href).replace(/^\/+/, '') : `styles/${id}.css`;
    const promise = new Promise((resolve, reject) => {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.id = `dooms-css-${id}`;
        link.href = `/${extensionFolderPath}/${file}`;
        link.onload = () => resolve();
        link.onerror = () => {
            console.error(`[Dooms Tracker] Failed to load ${file}`);
            // Remove the dead link and uncache so the next ensureCss(id)
            // retries instead of permanently treating the sheet as loaded
            // (which left features building unstyled DOM forever).
            link.remove();
            loaded.delete(id);
            reject(new Error(`${file} failed to load`));
        };
        document.head.appendChild(link);
    });
    loaded.set(id, promise);
    return promise;
}

/**
 * Removes a previously injected sheet (feature teardown).
 * @param {string} id
 */
export function removeCss(id) {
    document.getElementById(`dooms-css-${id}`)?.remove();
    loaded.delete(id);
}
