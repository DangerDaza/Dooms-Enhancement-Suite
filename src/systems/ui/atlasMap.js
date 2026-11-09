/**
 * The Atlas's map (docs/long-shot-plan.md D139, D147): the model drawn as
 * vectors under Leaflet. One SVG layer holds the regions and the routes;
 * the places are HTML markers that keep their size while the map zooms.
 * Nothing is a picture, so nothing pixelates, and a zoom repaints one SVG
 * and moves the markers, no more. No SillyTavern here: the controller
 * (atlas.js) hands the model in and hears what was clicked;
 * tools/atlas-browser-test.mjs mounts it in a headless browser.
 *
 * Leaflet (lib/leaflet, vendored) is imported only when a map mounts.
 * The caller injects its stylesheet first: ensureCss('leaflet', LEAFLET_CSS).
 * Layout units have y down; Leaflet's latitude grows upward: lat = -y.
 */
import { atlasMarkerHtml, atlasMarkerClass, scaleBarFor } from './atlasViews.js';

export const LEAFLET_CSS = 'lib/leaflet/leaflet.css';
export const PIN_SIZE = 30;          // a marker's box in CSS pixels; the name hangs below it
// What the zoom shows, by how many pixels one layout unit (the step between two places of a region) is on screen.
export const DOT_PX = 30;            // under this the places are dots: the pins would sit on one another
export const LABEL_PX = 84;          // from this the places carry their names
export const NEAR_PX = 420;          // from this the places inside places appear (their own step is a tenth of a unit)
export const MAX_PX = 4096;          // the closest look
export const SHOW_PX = { region: 46, place: 120, inside: 560 };    // the look `show` flies to, by what the marker is

let leafletModule = null;
async function leaflet() {
    if (!leafletModule) leafletModule = await import('../../../lib/leaflet/leaflet-src.esm.js');
    return leafletModule;
}

const ll = (x, y) => [-y, x];

/**
 * Mounts the map in `el`, which needs a size of its own.
 * @param {HTMLElement} el
 * @param {object} o
 * @param {object} o.model            atlasModel()
 * @param {string[]} o.hidden         the kinds switched off
 * @param {string} o.query            the search (markers that do not match are dimmed)
 * @param {Function} o.portraits      name -> a portrait URL or ''
 * @param {Function} o.card           marker -> the card's HTML (asked when a marker opens)
 * @param {{ open?: Function, close?: Function, scale?: Function }} o.on  `open(id)` a marker's card opened; `close()`; `scale({ px, length })` the scale bar's figures after a zoom
 * @param {{ center: any, zoom: number }|null} o.view  a view to restore
 */
export async function mountAtlasMap(el, { model, hidden = [], query = '', portraits = () => '', card = () => '', on = {}, view = null } = {}) {
    const L = await leaflet();
    el.classList.add('dooms-atlas-leaflet');
    const map = L.map(el, {
        crs: L.CRS.Simple,
        minZoom: -20,
        maxZoom: 20,
        zoomSnap: 0.25,
        zoomDelta: 0.75,
        wheelPxPerZoomLevel: 110,
        zoomControl: true,
        attributionControl: false,
        keyboard: true,
        fadeAnimation: false,
        markerZoomAnimation: true,
        renderer: L.svg({ padding: 0.6 }),
    });
    const shapes = L.layerGroup().addTo(map);
    const markers = new Map();    // marker id -> { marker, html, data }
    let fitZoom = 0;
    let current = model;
    let off = new Set(hidden);
    let search = String(query || '').trim().toLowerCase();
    let opened = '';

    const boundsOf = (m) => L.latLngBounds(ll(m.bounds.minX, m.bounds.maxY), ll(m.bounds.maxX, m.bounds.minY));

    function drawShapes() {
        shapes.clearLayers();
        // The landmass: every coast's line first, then every coast's fill over them, so coasts that overlap read as one shore.
        for (const r of current.regions) L.polygon(r.coast.map(([x, y]) => ll(x, y)), { className: 'dooms-atlas-shore', interactive: false, smoothFactor: 0.5 }).addTo(shapes);
        for (const r of current.regions) L.polygon(r.coast.map(([x, y]) => ll(x, y)), { className: 'dooms-atlas-coast', interactive: false, smoothFactor: 0.5 }).addTo(shapes);
        for (const r of current.regions) {
            L.polygon(r.outline.map(([x, y]) => ll(x, y)), { className: `dooms-atlas-land is-${r.terrain}`, interactive: false, smoothFactor: 0.5 }).addTo(shapes);
        }
        for (const r of current.routes) {
            L.polyline(r.points.map(([x, y]) => ll(x, y)), { className: `dooms-atlas-route is-${r.kind}`, interactive: false }).addTo(shapes);
        }
    }

    const matches = (m) => !search || [m.label, m.note, m.regionLabel, m.parentLabel, ...(m.people || [])].some(t => String(t || '').toLowerCase().includes(search));
    const iconOf = (m) => L.divIcon({ className: `${atlasMarkerClass(m)}${matches(m) ? '' : ' is-dim'}`, html: atlasMarkerHtml(m, { portraits }), iconSize: [PIN_SIZE, PIN_SIZE], iconAnchor: [PIN_SIZE / 2, PIN_SIZE / 2], popupAnchor: [0, -PIN_SIZE / 2] });

    function openCard(id) {
        const have = markers.get(id);
        if (!have) return;
        const html = card(have.data);
        if (!html) return;
        opened = id;
        have.marker.unbindPopup();
        have.marker.bindPopup(html, { className: 'dooms-atlas-popup', closeButton: true, maxWidth: 340, minWidth: 260, autoPanPadding: [40, 40] });
        have.marker.openPopup();
        if (typeof on.open === 'function') on.open(id);
    }

    function drawMarkers() {
        const keep = new Set();
        for (const m of current.markers) {
            if (off.has(m.kind)) continue;
            keep.add(m.id);
            const html = atlasMarkerHtml(m, { portraits }) + atlasMarkerClass(m) + (matches(m) ? '' : ' is-dim');
            const have = markers.get(m.id);
            if (have) {
                have.data = m;
                have.marker.setLatLng(ll(m.x, m.y));
                if (have.html !== html) { have.marker.setIcon(iconOf(m)); have.html = html; }
                continue;
            }
            const marker = L.marker(ll(m.x, m.y), { icon: iconOf(m), keyboard: true, title: '', alt: m.label, riseOnHover: true, zIndexOffset: m.player ? 1000 : m.isRegion ? -500 : 0 });
            marker.on('click', () => openCard(m.id));
            marker.on('keypress', (ev) => { if (ev.originalEvent && ev.originalEvent.key === 'Enter') openCard(m.id); });
            marker.addTo(map);
            markers.set(m.id, { marker, html, data: m });
        }
        for (const [id, have] of markers) if (!keep.has(id)) { have.marker.remove(); markers.delete(id); if (opened === id) opened = ''; }
    }

    /** The zoom told to the stylesheet (dots, pins, names, the places inside places) and to the scale bar. */
    function zoomed() {
        const unitPx = Math.pow(2, map.getZoom());    // CRS.Simple: one layout unit is 2^zoom pixels
        el.setAttribute('data-zoom', unitPx >= NEAR_PX ? 'near' : unitPx >= LABEL_PX ? 'close' : unitPx >= DOT_PX ? 'mid' : 'far');
        if (typeof on.scale === 'function') {
            const perPx = current.measure.per / unitPx;
            on.scale({ ...scaleBarFor(perPx), unit: current.measure.unit, perPx });
        }
    }

    function fit({ keepZoom = false } = {}) {
        map.invalidateSize(false);
        const b = boundsOf(current);
        if (!keepZoom) map.setMinZoom(-20);
        const z = map.getBoundsZoom(b, false);
        fitZoom = z;
        map.setMaxBounds(b.pad(0.6));
        map.setMinZoom(z - 0.5);
        map.setMaxZoom(Math.max(z + 2, Math.log2(MAX_PX)));
        if (!keepZoom) map.fitBounds(b, { animate: false });
    }

    drawShapes();
    drawMarkers();
    fit();
    if (view && view.center && Number.isFinite(view.zoom)) map.setView(view.center, Math.min(Math.max(view.zoom, map.getMinZoom()), map.getMaxZoom()), { animate: false });
    map.on('zoomend', zoomed);
    map.on('popupclose', () => { opened = ''; if (typeof on.close === 'function') on.close(); });
    zoomed();

    return {
        map,
        /** A new model, new switches, a new search: the shapes redrawn, the markers added, moved, redrawn or removed. The view stays. */
        update({ model: next = null, hidden: h = null, query: q = null } = {}) {
            if (next) current = next;
            if (h) off = new Set(h);
            if (q !== null) search = String(q || '').trim().toLowerCase();
            if (next) { drawShapes(); fit({ keepZoom: true }); }
            drawMarkers();
            zoomed();
            if (opened && markers.has(opened)) { const have = markers.get(opened); const html = card(have.data); if (html) have.marker.setPopupContent(html); }
        },
        /** Flies to a marker and opens its card; false when it is switched off or not on the map. */
        show(id, { open = true } = {}) {
            const have = markers.get(id);
            if (!have) return false;
            const target = Math.max(map.getZoom(), Math.log2(have.data.depth >= 2 ? SHOW_PX.inside : have.data.isRegion ? SHOW_PX.region : SHOW_PX.place));
            map.setView(have.marker.getLatLng(), Math.min(target, map.getMaxZoom()), { animate: true });
            if (open) openCard(id);
            return true;
        },
        opened() { return opened; },
        closeCard() { map.closePopup(); },
        view() { return { center: map.getCenter(), zoom: map.getZoom() }; },
        fit() { fit(); zoomed(); },
        size() { map.invalidateSize(false); },
        destroy() {
            try { map.remove(); } catch (err) { /* already gone */ }
            markers.clear();
            el.classList.remove('dooms-atlas-leaflet');
            el.removeAttribute('data-zoom');
            for (const c of [...el.classList]) if (c.startsWith('leaflet-')) el.classList.remove(c);    // Leaflet leaves its container classes behind
            el.innerHTML = '';
        },
    };
}
