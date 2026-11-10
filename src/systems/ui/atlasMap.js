/**
 * The Atlas's map (docs/long-shot-plan.md D139, D147, D151, D153): the
 * model drawn under Leaflet. One SVG layer holds the land (drawn as one
 * shore with its ripples), the regions with their terrain's drawings and
 * the paths; the places are HTML markers that keep their size while the
 * map zooms. Nothing of that is a picture, so nothing pixelates, and a
 * zoom repaints one SVG and moves the markers, no more. A world that has
 * a picture of its own shows it under the markers instead of the drawn
 * land (D154). A place is dropped from the tray or put where the map is
 * tapped; with moving on, a marker is dragged to where it belongs.
 *
 * No SillyTavern here: the controller (atlas.js) hands the model in and
 * hears what was done; tools/atlas-browser-test.mjs mounts it in a
 * headless browser. Leaflet (lib/leaflet, vendored) is imported only when
 * a map mounts; the caller injects its stylesheet first:
 * ensureCss('leaflet', LEAFLET_CSS). Layout units have y down; Leaflet's
 * latitude grows upward: lat = -y.
 */
import { atlasMarkerHtml, atlasMarkerClass, atlasRegionHtml, scaleBarFor } from './atlasViews.js';

export const LEAFLET_CSS = 'lib/leaflet/leaflet.css';
export const PIN_SIZE = 30;          // a marker's box in CSS pixels; the name hangs below it
// What the zoom shows, by how many pixels one layout unit is on screen.
export const DOT_PX = 26;            // under this the places are dots: the pins would sit on one another
export const LABEL_PX = 52;          // from this the places carry their names
export const MAX_PX = 1024;          // the closest look
export const SHOW_PX = 110;          // the look `show` flies to
export const PICTURE_WIDTH = 24;     // a world's own picture is this many layout units wide, its middle at the map's

let leafletModule = null;
async function leaflet() {
    if (!leafletModule) leafletModule = await import('../../../lib/leaflet/leaflet-src.esm.js');
    return leafletModule;
}

const ll = (x, y) => [-y, x];
const round4 = (n) => Math.round(n * 10000) / 10000;

/** The rectangle a world's picture lies on, in layout units. */
export function pictureRect(picture) {
    const w = picture && picture.width > 0 ? picture.width : 1;
    const h = picture && picture.height > 0 ? picture.height : 1;
    const half = PICTURE_WIDTH / 2;
    const tall = (PICTURE_WIDTH * h / w) / 2;
    return { minX: -half, minY: -tall, maxX: half, maxY: tall };
}

/**
 * Mounts the map in `el`, which needs a size of its own.
 * @param {HTMLElement} el
 * @param {object} o
 * @param {object} o.model            atlasModel()
 * @param {{ image: string, width: number, height: number }|null} o.picture  the world's own picture, or null for the drawn land
 * @param {string[]} o.hidden         the kinds switched off
 * @param {string} o.query            the search (markers that do not match are dimmed)
 * @param {boolean} o.moving          markers can be dragged
 * @param {Function} o.portraits      name -> a portrait URL or ''
 * @param {Function} o.card           marker -> the card's HTML (asked when a marker opens, and again on an update)
 * @param {{ open?: Function, close?: Function, scale?: Function, drop?: Function, tap?: Function, move?: Function, pictureError?: Function }} o.on
 *   `open(id)` a card opened; `close()`; `scale({ px, length, unit, perPx })` after a zoom; `drop(id, { x, y })` a tray row dropped on the map;
 *   `enter(id)` a marker double-clicked; `tap({ x, y })` the map itself tapped; `move(id, { x, y })` a marker dragged; `pictureError()` the picture would not load
 * @param {{ center: any, zoom: number }|null} o.view  a view to restore
 */
export async function mountAtlasMap(el, { model, picture = null, hidden = [], query = '', moving = false, portraits = () => '', card = () => '', on = {}, view = null } = {}) {
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
        maxBoundsViscosity: 1,    // the edge of the canvas stops a drag; nothing springs back after it
        renderer: L.svg({ padding: 0.6 }),
    });
    const shapes = L.layerGroup().addTo(map);
    const names = L.layerGroup().addTo(map);
    const markers = new Map();    // marker id -> { marker, html, data }
    let current = model;
    let pic = picture && picture.image ? picture : null;
    let overlay = null;
    let off = new Set(hidden);
    let search = String(query || '').trim().toLowerCase();
    let canMove = !!moving;
    let opened = '';

    const rectBounds = (b) => L.latLngBounds(ll(b.minX, b.maxY), ll(b.maxX, b.minY));
    /** The canvas: everything the map can be panned over. */
    function canvas() {
        const b = { ...current.bounds };
        if (pic) { const r = pictureRect(pic); b.minX = Math.min(b.minX, r.minX); b.minY = Math.min(b.minY, r.minY); b.maxX = Math.max(b.maxX, r.maxX); b.maxY = Math.max(b.maxY, r.maxY); }
        return b;
    }
    /** What a fit shows: the picture when there is one, else the land with a margin, else the empty canvas. */
    function content() {
        if (pic) return pictureRect(pic);
        if (!current.land.length) return current.bounds;
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const b of current.land) { minX = Math.min(minX, b.x - b.radius); minY = Math.min(minY, b.y - b.radius); maxX = Math.max(maxX, b.x + b.radius); maxY = Math.max(maxY, b.y + b.radius); }
        const pad = Math.max(1.2, Math.max(maxX - minX, maxY - minY) * 0.12);
        const half = Math.max(4, (maxX - minX) / 2 + pad, (maxY - minY) / 2 + pad);    // a lone marker is not shown at the closest zoom
        const cx = (minX + maxX) / 2;
        const cy = (minY + maxY) / 2;
        return { minX: cx - half, minY: cy - half, maxX: cx + half, maxY: cy + half };
    }

    function drawShapes() {
        shapes.clearLayers();
        names.clearLayers();
        if (overlay) { overlay.remove(); overlay = null; }
        const poly = (pts, className) => L.polygon(pts.map(([x, y]) => ll(x, y)), { className, interactive: false, smoothFactor: 0.4 }).addTo(shapes);
        if (pic) {
            overlay = L.imageOverlay(pic.image, rectBounds(pictureRect(pic)), { interactive: false, alt: '', className: 'dooms-atlas-picture' });
            overlay.on('error', () => { if (typeof on.pictureError === 'function') on.pictureError(); });
            overlay.addTo(map);
        } else {
            const ground = current.ground || 'island';
            const decor = current.decor || { lines: [], sea: null, ripples: [] };
            const lines = (list, className) => { if (list.length) L.polyline(list.map(line => line.map(([x, y]) => ll(x, y))), { className, interactive: false, smoothFactor: 0.3 }).addTo(shapes); };
            if (ground === 'island') {
                // One shore: each ring's line for every blob, then that ring filled with sea for every blob (so the lines
                // inside a neighbour's ring are covered), from the outer ripple in; last the land itself.
                for (const b of current.land) poly(b.ripple2, 'dooms-atlas-ripple is-outer');
                for (const b of current.land) poly(b.ripple2, 'dooms-atlas-water');
                for (const b of current.land) poly(b.ripple1, 'dooms-atlas-ripple');
                for (const b of current.land) poly(b.ripple1, 'dooms-atlas-water');
                for (const b of current.land) poly(b.outline, 'dooms-atlas-shore');
                for (const b of current.land) poly(b.outline, 'dooms-atlas-coast');
            } else if (ground === 'underground') {
                // Chambers hewn from the rock around every place, joined by passages: the walls first, the floors over them.
                for (const b of current.land) poly(b.outline, 'dooms-atlas-wall');
                lines(current.routes.map(r => r.points), 'dooms-atlas-passage is-wall');
                for (const b of current.land) poly(b.outline, 'dooms-atlas-floor');
                lines(current.routes.map(r => r.points), 'dooms-atlas-passage');
            } else {
                // The land is everywhere (D158): what the ground draws over it, and the sea past a coast's shore.
                if (decor.sea) { poly(decor.sea, 'dooms-atlas-water is-sea'); lines(decor.ripples, 'dooms-atlas-ripple'); lines(decor.lines, 'dooms-atlas-shore is-line'); }
                else lines(decor.lines, `dooms-atlas-ground is-${ground}`);
            }
            for (const r of current.regions) {
                poly(r.outline, `dooms-atlas-land is-${r.terrain}`);
                if (r.glyphs.length) L.polyline(r.glyphs.map(line => line.map(([x, y]) => ll(x, y))), { className: `dooms-atlas-glyph is-${r.terrain}`, interactive: false, smoothFactor: 0.2 }).addTo(shapes);
            }
        }
        el.setAttribute('data-ground', pic ? 'picture' : (current.ground || 'island'));
        if (pic || current.ground !== 'underground') for (const r of current.routes) L.polyline(r.points.map(([x, y]) => ll(x, y)), { className: `dooms-atlas-route is-${r.kind}`, interactive: false }).addTo(shapes);
        for (const r of current.regions) {
            if (!r.label) continue;
            L.marker(ll(r.x, r.y - r.radius * 0.72), { icon: L.divIcon({ className: 'dooms-atlas-region', html: atlasRegionHtml(r), iconSize: [0, 0] }), interactive: false, keyboard: false, zIndexOffset: -1000 }).addTo(names);
        }
    }

    const matches = (m) => !search || [m.label, m.note, ...(m.rooms || []), ...(m.names || []).map(n => n.label), ...(m.people || [])].some(t => String(t || '').toLowerCase().includes(search));
    const iconOf = (m) => L.divIcon({ className: `${atlasMarkerClass(m)}${matches(m) ? '' : ' is-dim'}`, html: atlasMarkerHtml(m, { portraits }), iconSize: [PIN_SIZE, PIN_SIZE], iconAnchor: [PIN_SIZE / 2, PIN_SIZE / 2], popupAnchor: [0, -PIN_SIZE / 2] });

    function openCard(id) {
        const have = markers.get(id);
        if (!have) return;
        map.closePopup();    // the card that was open closes first (and tells the host), so this one is drawn as the host means it now
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
                if (have.html !== html) { have.marker.setIcon(iconOf(m)); have.html = html; if (canMove && have.marker.dragging) have.marker.dragging.enable(); }
                continue;
            }
            const marker = L.marker(ll(m.x, m.y), { icon: iconOf(m), draggable: canMove, autoPan: true, keyboard: true, title: '', alt: m.label, riseOnHover: true, zIndexOffset: m.player ? 1000 : 0 });
            marker.on('click', () => openCard(m.id));
            marker.on('dblclick', () => { if (typeof on.enter === 'function') on.enter(m.id); });    // a place entered: its own map (D156)
            marker.on('keypress', (ev) => { if (ev.originalEvent && ev.originalEvent.key === 'Enter') openCard(m.id); });
            marker.on('dragstart', () => { map.closePopup(); });
            marker.on('dragend', () => { const at = marker.getLatLng(); if (typeof on.move === 'function') on.move(m.id, { x: round4(at.lng), y: round4(-at.lat) }); });
            marker.addTo(map);
            markers.set(m.id, { marker, html, data: m });
        }
        for (const [id, have] of markers) if (!keep.has(id)) { have.marker.remove(); markers.delete(id); if (opened === id) opened = ''; }
    }

    /** The zoom told to the stylesheet (dots, pins, names) and to the scale bar. */
    function zoomed() {
        const unitPx = Math.pow(2, map.getZoom());    // CRS.Simple: one layout unit is 2^zoom pixels
        el.setAttribute('data-zoom', unitPx >= LABEL_PX ? 'close' : unitPx >= DOT_PX ? 'mid' : 'far');
        if (typeof on.scale === 'function') {
            const perPx = current.measure.per / unitPx;
            on.scale({ ...scaleBarFor(perPx), unit: current.measure.unit, perPx });
        }
    }

    /** The limits set from the canvas; with `show`, the view fitted to the content. */
    function fit({ show = true } = {}) {
        map.invalidateSize(false);
        const all = rectBounds(canvas());
        map.setMinZoom(-20);
        map.setMaxBounds(null);
        const z = map.getBoundsZoom(all, false);
        if (show) map.fitBounds(rectBounds(content()), { animate: false, maxZoom: Math.log2(SHOW_PX) });
        // The view is the player's: it is never pulled back to the middle. The limits only stop the map being lost
        // (a canvas three times as wide as what a fit shows, held firmly at its edge rather than sprung back from it).
        map.setMaxBounds(all.pad(1.5));
        map.setMinZoom(z - 1);
        map.setMaxZoom(Math.max(z + 2, Math.log2(MAX_PX)));
    }

    // A place dragged from the tray and let go over the map; the map itself tapped.
    function onDragOver(ev) { ev.preventDefault(); if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'move'; }
    function onDrop(ev) {
        ev.preventDefault();
        const id = ev.dataTransfer ? String(ev.dataTransfer.getData('text/plain') || '') : '';
        if (!id) return;
        const at = map.mouseEventToLatLng(ev);
        if (typeof on.drop === 'function') on.drop(id, { x: round4(at.lng), y: round4(-at.lat) });
    }
    el.addEventListener('dragover', onDragOver);
    el.addEventListener('drop', onDrop);
    map.on('click', (ev) => { if (typeof on.tap === 'function') on.tap({ x: round4(ev.latlng.lng), y: round4(-ev.latlng.lat) }); });

    drawShapes();
    drawMarkers();
    fit();
    if (view && view.center && Number.isFinite(view.zoom)) map.setView(view.center, Math.min(Math.max(view.zoom, map.getMinZoom()), map.getMaxZoom()), { animate: false });
    map.on('zoomend', zoomed);
    map.on('popupclose', () => { opened = ''; if (typeof on.close === 'function') on.close(); });
    zoomed();

    return {
        map,
        /** A new model, a new picture, new switches, a new search, moving on or off: the shapes redrawn, the markers added, moved, redrawn or removed. The view stays. */
        update({ model: next = null, picture: nextPic, hidden: h = null, query: q = null, moving: mv = null } = {}) {
            if (next) current = next;
            if (nextPic !== undefined) pic = nextPic && nextPic.image ? nextPic : null;
            if (h) off = new Set(h);
            if (q !== null) search = String(q || '').trim().toLowerCase();
            if (mv !== null && !!mv !== canMove) {
                canMove = !!mv;
                for (const have of markers.values()) if (have.marker.dragging) { if (canMove) have.marker.dragging.enable(); else have.marker.dragging.disable(); }
            }
            if (next || nextPic !== undefined) { drawShapes(); fit({ show: false }); }
            drawMarkers();
            zoomed();
            if (opened && markers.has(opened)) { const have = markers.get(opened); const html = card(have.data); if (html) have.marker.setPopupContent(html); }
        },
        /** The open card drawn again (it changed its mode). */
        redrawCard() {
            if (!opened || !markers.has(opened)) return;
            const have = markers.get(opened);
            const html = card(have.data);
            if (html) have.marker.setPopupContent(html);
        },
        /** Flies to a marker and opens its card; false when it is switched off or not on the map. */
        show(id, { open = true } = {}) {
            const have = markers.get(id);
            if (!have) return false;
            map.setView(have.marker.getLatLng(), Math.min(Math.max(map.getZoom(), Math.log2(SHOW_PX)), map.getMaxZoom()), { animate: true });
            if (open) openCard(id);
            return true;
        },
        open(id) { openCard(id); },
        opened() { return opened; },
        closeCard() { map.closePopup(); },
        view() { return { center: map.getCenter(), zoom: map.getZoom() }; },
        fit() { fit(); zoomed(); },
        size() { map.invalidateSize(false); },
        destroy() {
            el.removeEventListener('dragover', onDragOver);
            el.removeEventListener('drop', onDrop);
            try { map.remove(); } catch (err) { /* already gone */ }
            markers.clear();
            el.classList.remove('dooms-atlas-leaflet');
            el.removeAttribute('data-zoom');
            el.removeAttribute('data-ground');
            for (const c of [...el.classList]) if (c.startsWith('leaflet-')) el.classList.remove(c);    // Leaflet leaves its container classes behind
            el.innerHTML = '';
        },
    };
}
