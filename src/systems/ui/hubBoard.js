/**
 * The board (docs/hub-plan.md D124, D134, D135): the world's picture under
 * Leaflet with its places as nodes that keep their size while the map
 * zooms. One module hosts both boards: the hub's (mode `hub`: the people
 * on the rim, a click opens the place) and the World Builder's Map tab
 * (mode `edit`: drag a node to move it, drop a place from the list, tap a
 * spot for a picked place, a node's menu takes it off the map).
 *
 * Leaflet (lib/leaflet, vendored) is imported only when a board mounts, so
 * nothing of it is in the startup graph or evaluated outside a browser.
 * The caller injects its stylesheet first: ensureCss('leaflet', LEAFLET_CSS).
 */
import { escapeHtml } from '../../utils/html.js';
import { safeImageUrl } from '../../utils/worldBoard.js';
import { boardBounds, nodeLatLng, latLngToNode, MAX_ZOOM_IN } from '../../utils/worldPicture.js';

export const LEAFLET_CSS = 'lib/leaflet/leaflet.css';
export const NODE_SIZE = 48;          // the marker's box in CSS pixels; the label hangs below it
const MAX_FACES = 4;

let leafletModule = null;
async function leaflet() {
    if (!leafletModule) leafletModule = await import('../../../lib/leaflet/leaflet-src.esm.js');
    return leafletModule;
}

const e = escapeHtml;
const attr = (v) => escapeHtml(String(v ?? ''));

/** Two letters for a name, for a face without a portrait. */
export function initialsOf(name) {
    const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '?';
    return (parts.length === 1 ? parts[0].slice(0, 2) : parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** A node's HTML (pure): the circle with the picture or the glyph, the faces on the rim, the label. */
export function nodeHtml(node, { mode = 'hub', portraits = () => '' } = {}) {
    const img = safeImageUrl(node.image);
    const circle = img
        ? `<span class="dooms-node-circle has-picture" style="background-image: url('${attr(img)}')"></span>`
        : `<span class="dooms-node-circle"><i class="fa-solid ${node.isRegion ? 'fa-mountain-sun' : 'fa-location-dot'}" aria-hidden="true"></i></span>`;
    const names = Array.isArray(node.people) ? node.people : [];
    const faces = mode === 'hub' && names.length
        ? `<span class="dooms-node-rim">${names.slice(0, MAX_FACES).map(n => { const p = safeImageUrl(portraits(n)); return p ? `<span class="dooms-node-face has-picture" title="${attr(n)}" style="background-image: url('${attr(p)}')"></span>` : `<span class="dooms-node-face" title="${attr(n)}">${e(initialsOf(n))}</span>`; }).join('')}${names.length > MAX_FACES ? `<span class="dooms-node-face is-more" title="${attr(names.slice(MAX_FACES).join(', '))}">+${names.length - MAX_FACES}</span>` : ''}</span>`
        : '';
    const weather = mode === 'hub' && node.weather && node.weather.emoji ? `<span class="dooms-node-weather" title="${attr(node.weather.text || '')}">${e(node.weather.emoji)}</span>` : '';
    return `${circle}${faces}${weather}<span class="dooms-node-label">${e(node.label || node.id)}</span>`;
}

function nodeClass(node, mode) {
    return ['dooms-node', `is-${mode}`, node.isRegion ? 'is-region' : '', node.player ? 'is-player' : '', node.visited === false && mode === 'hub' ? 'is-unvisited' : ''].filter(Boolean).join(' ');
}

/**
 * Mounts a board in `el`, which needs a height of its own.
 * @param {HTMLElement} el
 * @param {object} o
 * @param {{ image: string, width: number, height: number }} o.picture
 * @param {Array} o.nodes            boardModel().nodes
 * @param {'hub'|'edit'} o.mode
 * @param {{ node?: Function, move?: Function, drop?: Function, tap?: Function, remove?: Function, error?: Function }} o.on  `error`: the picture could not be loaded (a file gone, a path refused)
 * @param {Function} o.portraits     name -> a portrait URL or ''
 * @param {{ center: any, zoom: number }|null} o.view  a view to restore (the builder re-renders; the host keeps it for this picture alone)
 * @returns {Promise<{ map: object, update: Function, view: Function, fit: Function, destroy: Function }>}
 */
export async function mountBoard(el, { picture, nodes = [], mode = 'hub', on = {}, portraits = () => '', view = null } = {}) {
    const L = await leaflet();
    const size = { width: picture.width, height: picture.height };
    const bounds = L.latLngBounds(boardBounds(size));
    el.classList.add('dooms-board', `is-${mode}`);
    const map = L.map(el, {
        crs: L.CRS.Simple,
        minZoom: -10,
        maxZoom: Math.log2(MAX_ZOOM_IN),
        zoomSnap: 0.25,
        zoomDelta: 0.5,
        wheelPxPerZoomLevel: 90,
        zoomControl: true,
        attributionControl: false,
        keyboard: false,
        zoomAnimation: false,    // the nodes' HTML is re-laid out by the browser; no animation keeps a phone smooth
        fadeAnimation: false,
        markerZoomAnimation: false,
    });
    const url = safeImageUrl(picture.image);
    const overlay = L.imageOverlay(url, bounds, { interactive: false, alt: '' });
    // A picture that does not load (the file gone from SillyTavern's folder, a path safeImageUrl refused, so an empty src)
    // fires Leaflet's error: the host hears it, since the nodes would otherwise float over a dark frame without a word.
    overlay.on('error', () => { if (typeof on.error === 'function') on.error(); });
    overlay.addTo(map);
    map.invalidateSize(false);
    map.fitBounds(bounds, { animate: false });
    map.setMinZoom(map.getZoom());
    map.setMaxBounds(bounds.pad(0.25));
    if (view && view.center && Number.isFinite(view.zoom)) map.setView(view.center, Math.max(view.zoom, map.getMinZoom()), { animate: false });

    const markers = new Map();    // place id -> { marker, html }
    const icon = (node) => L.divIcon({ className: nodeClass(node, mode), html: nodeHtml(node, { mode, portraits }), iconSize: [NODE_SIZE, NODE_SIZE], iconAnchor: [NODE_SIZE / 2, NODE_SIZE / 2], popupAnchor: [0, -NODE_SIZE / 2] });
    const popupHtml = (node) => `<div class="dooms-node-pop"><strong>${e(node.label || node.id)}</strong><button type="button" class="rpg-accordion-action-btn" data-act="node-remove" data-id="${attr(node.id)}"><i class="fa-solid fa-xmark" aria-hidden="true"></i> Take off the map</button></div>`;
    function place(node) {
        const html = nodeHtml(node, { mode, portraits }) + nodeClass(node, mode);
        const at = nodeLatLng(node, size);
        const have = markers.get(node.id);
        if (have) {
            have.marker.setLatLng(at);
            if (have.html !== html) { have.marker.setIcon(icon(node)); have.html = html; }
            if (mode === 'edit') have.marker.setPopupContent(popupHtml(node));
            return;
        }
        const marker = L.marker(at, { icon: icon(node), draggable: mode === 'edit', keyboard: false, title: '', riseOnHover: true, autoPan: false });
        marker.addTo(map);
        if (mode === 'edit') {
            marker.bindPopup(popupHtml(node), { closeButton: false, className: 'dooms-node-popup', autoPan: false });
            marker.on('dragend', () => { const ll = marker.getLatLng(); const n = latLngToNode([ll.lat, ll.lng], size); if (n && typeof on.move === 'function') on.move(node.id, n); });
        } else {
            marker.on('click', () => { if (typeof on.node === 'function') on.node(node.id); });
        }
        markers.set(node.id, { marker, html });
    }
    for (const node of nodes) place(node);

    // Edit mode: a place dropped from the list, a spot tapped for a picked place, a node's menu.
    function onDragOver(ev) { ev.preventDefault(); if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'move'; }
    function onDrop(ev) {
        ev.preventDefault();
        const id = ev.dataTransfer ? String(ev.dataTransfer.getData('text/plain') || '') : '';
        if (!id) return;
        const ll = map.mouseEventToLatLng(ev);
        const n = latLngToNode([ll.lat, ll.lng], size);
        if (n && typeof on.drop === 'function') on.drop(id, n);
    }
    function onPopupClick(ev) {
        const b = ev.target && ev.target.closest ? ev.target.closest('[data-act="node-remove"]') : null;
        if (!b) return;
        ev.preventDefault();
        ev.stopPropagation();
        map.closePopup();
        if (typeof on.remove === 'function') on.remove(b.getAttribute('data-id') || '');
    }
    if (mode === 'edit') {
        el.addEventListener('dragover', onDragOver);
        el.addEventListener('drop', onDrop);
        el.addEventListener('click', onPopupClick);
        map.on('click', (ev) => { const n = latLngToNode([ev.latlng.lat, ev.latlng.lng], size); if (n && typeof on.tap === 'function') on.tap(n); });
    }

    return {
        map,
        /** New nodes (and a new picture path, same size): markers added, moved, redrawn or removed. */
        update({ nodes: next = [], picture: pic = null } = {}) {
            if (pic && safeImageUrl(pic.image) !== safeImageUrl(picture.image)) { picture = { ...picture, image: pic.image }; overlay.setUrl(safeImageUrl(pic.image)); }
            const keep = new Set();
            for (const node of next) { keep.add(node.id); place(node); }
            for (const [id, m] of markers) if (!keep.has(id)) { m.marker.remove(); markers.delete(id); }
        },
        view() { return { center: map.getCenter(), zoom: map.getZoom() }; },
        fit() { map.invalidateSize(false); map.fitBounds(bounds, { animate: false }); },
        size() { map.invalidateSize(false); },
        destroy() {
            if (mode === 'edit') { el.removeEventListener('dragover', onDragOver); el.removeEventListener('drop', onDrop); el.removeEventListener('click', onPopupClick); }
            try { map.remove(); } catch (err) { /* already gone */ }
            markers.clear();
            el.classList.remove('dooms-board', `is-${mode}`);
            for (const c of [...el.classList]) if (c.startsWith('leaflet-')) el.classList.remove(c);    // Leaflet leaves its container classes behind
            el.innerHTML = '';
        },
    };
}
