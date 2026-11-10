#!/usr/bin/env node
/**
 * The Atlas for real (docs/long-shot-plan.md D139, D142, D145–D147,
 * D151–D154): its shell and views (src/systems/ui/atlasViews.js), its map
 * (src/systems/ui/atlasMap.js) and its stylesheet in a headless Chromium,
 * with a fixture world and a book kept in the page. The window fills the
 * screen; nothing stands on the map until it is placed; a tray row is
 * dragged onto the map, or tapped and then the map; Place all; a marker
 * is made by hand, dragged while moving is on, merged, deleted and
 * brought back; the land, the regions and the paths are SVG and the
 * markers HTML (nothing is a picture, unless the world has one of its
 * own); the kinds switch markers off; a search dims what does not match;
 * the card says how far the party is; a marker keeps its size after a
 * zoom; the looks restyle the sidebar. The repo is served over HTTP for
 * the run (ES modules do not load from file: URLs). The controller
 * (atlas.js) needs SillyTavern and is not loaded: the page's own few
 * lines stand in for it.
 *
 * Needs Playwright with Chromium; without it the check says so and passes.
 *
 * Usage:  node tools/atlas-browser-test.mjs [--shots] [--out=<folder>]   (from the repo root)
 *         DES_FA=<a Font Awesome folder with css/ and webfonts/> draws the icons in the screenshots
 * Exit:   0 = pass or skipped, 1 = failure
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, resolve, dirname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const shots = process.argv.includes('--shots');
const shotArg = process.argv.find(a => a.startsWith('--out='));
let shotDir = '';
if (shots) { shotDir = shotArg ? shotArg.slice(6) : mkdtempSync(join(process.env.TMPDIR || tmpdir(), 'des-atlas-')); mkdirSync(shotDir, { recursive: true }); }

function loadPlaywright() {
    const require = createRequire(import.meta.url);
    for (const spec of ['playwright', '/opt/node-tools/node_modules/playwright']) {
        try { return require(spec); } catch (e) { /* next */ }
    }
    return null;
}
const pw = loadPlaywright();
if (!pw) { console.log('atlas-browser-test: skipped (no Playwright with Chromium on this machine)'); process.exit(0); }

const FA = process.env.DES_FA ? normalize(process.env.DES_FA) : '';
const TYPES = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.ttf': 'font/ttf' };
const harness = `<!doctype html><html><head><meta charset="utf-8">
${FA ? '<link rel="stylesheet" href="/__fa/css/all.min.css">' : ''}<link rel="stylesheet" href="/lib/leaflet/leaflet.css"><link rel="stylesheet" href="/styles/modals.css"><link rel="stylesheet" href="/style.css"><link rel="stylesheet" href="/styles/overhaul.css"><link rel="stylesheet" href="/styles/atlas.css">
<style>html, body { margin: 0; background: #222; font-family: sans-serif; }</style></head>
<body>
<script type="module">
import { ATLAS_ID, atlasShellHtml, atlasSideHtml, atlasPlacesHtml, atlasResultsHtml, atlasCardHtml, atlasStartHtml, atlasTrailHtml } from '/src/systems/ui/atlasViews.js';
import { mountAtlasMap } from '/src/systems/ui/atlasMap.js';
import { normalizePack, seedWorldState, blankPack } from '/src/utils/liveWorld.js';
import * as A from '/src/utils/atlas.js';
const REALM = {
    id: 'realm', name: 'The Realm of Vael',
    places: [
        { id: 'northmarch', label: 'The Northmarch' }, { id: 'greywood', label: 'Greywood Forest' }, { id: 'saltcoast', label: 'The Salt Coast' }, { id: 'dunes', label: 'The Amber Dunes' }, { id: 'ironpeaks', label: 'The Iron Peaks' },
        { id: 'frosthold', label: 'Frosthold Keep', parent: 'northmarch', note: 'The last garrison before the ice.' }, { id: 'iron-inn', label: 'The Iron Inn', parent: 'northmarch', note: 'Warm, loud, and full of soldiers.' }, { id: 'white-shrine', label: 'The White Shrine', parent: 'northmarch' }, { id: 'wolfs-den', label: "Wolf's Den", parent: 'northmarch' },
        { id: 'old-shrine', label: 'The Old Shrine', parent: 'greywood', kind: 'ruin' }, { id: 'hunters-camp', label: "Hunters' Camp", parent: 'greywood' }, { id: 'elderglade', label: 'Elderglade', parent: 'greywood', kind: 'settlement' }, { id: 'witchs-hut', label: "The Witch's Hut", parent: 'greywood' },
        { id: 'saltport', label: 'Saltport', parent: 'saltcoast', kind: 'settlement', note: 'A harbour town that never sleeps.' }, { id: 'lighthouse', label: 'Gull Lighthouse', parent: 'saltcoast' }, { id: 'smugglers-cove', label: "Smugglers' Cove", parent: 'saltcoast', kind: 'ruin' },
        { id: 'fish-market', label: 'Fish Market', parent: 'saltport' }, { id: 'drowned-rat', label: 'The Drowned Rat Tavern', parent: 'saltport' }, { id: 'harbour-watch', label: 'Harbour Watch', parent: 'saltport' },
        { id: 'sunspire', label: 'Sunspire', parent: 'dunes', kind: 'settlement' }, { id: 'buried-tomb', label: 'The Buried Tomb', parent: 'dunes' }, { id: 'oasis', label: 'Mirror Oasis', parent: 'dunes', kind: 'water' },
        { id: 'deepdelve', label: 'Deepdelve Mine', parent: 'ironpeaks' }, { id: 'eagle-pass', label: 'Eagle Pass', parent: 'ironpeaks' }, { id: 'forge-hall', label: 'The Great Forge', parent: 'ironpeaks' },
    ],
    cast: [{ name: 'Mara Vane', place: 'iron-inn' }, { name: 'Odo', place: 'fish-market' }, { name: 'Sister Hale', place: 'old-shrine' }, { name: 'Captain Rusk', place: 'frosthold' }, { name: 'Tam', place: 'iron-inn' }, { name: 'Jex', place: 'iron-inn' }, { name: 'Bryn', place: 'iron-inn' }],
};
// A long campaign grown from play: every wording of a place the tracker ever wrote.
const CAMPAIGN = ["Jordan's House, Bedroom", "Jordan's House - Kitchen", "Jordan's House (hallway)", "Jordan's House", 'Bedroom', 'bedroom on the wall', 'Bedroom, by the window', 'The Rusty Anchor', 'The Rusty Anchor, back room', 'Miller Street', 'Old Chapel', 'Harbour Market', 'Harbour Market, fish stalls', 'Dr. Hale\\'s Clinic', 'The Lighthouse'];
document.body.insertAdjacentHTML('beforeend', atlasShellHtml());
const root = document.getElementById(ATLAS_ID);
window.A = A;
window.__events = [];
window.__ui = { hidden: [], query: '', moving: false, armed: '', cardMode: 'view', picture: null, layer: '' };
window.__book = null;
let pack = null, state = null;
const model = () => A.atlasModel({ pack, state, player: 'Jordan', book: window.__book, layer: window.__ui.layer, weather: pack.id === 'realm' ? { greywood: { emoji: '🌧️', text: 'Steady rain' } } : {} });
const card = (m) => { const mod = window.__model; return atlasCardHtml({ marker: mod.markers.find(x => x.id === m.id) || m, mode: window.__ui.cardMode, others: mod.all.filter(x => x.id !== m.id).map(x => ({ id: x.id, label: x.label, layerLabel: x.layerLabel, inside: x.inside })), distance: A.describeDistance(mod, mod.party, m.id), canTravel: true, rumours: m.id === 'saltport' ? ['The harbour chain has been raised at Saltport.'] : [], news: [] }); };
function draw() {
    const m = window.__model = model();
    const ui = window.__ui;
    root.querySelector('.dooms-atlas-side').innerHTML = atlasSideHtml({ name: pack.name, facts: { date: '14th of Frostfall', time: 'Dusk', location: 'Saltport, the quay', weather: 'Sea fog' }, tab: 'places', body: atlasPlacesHtml({ markers: m.markers, tray: m.tray, deleted: m.deleted, query: ui.query, hidden: ui.hidden, armed: ui.armed, scale: m.measure.scale, all: m.all, layer: m.layer, layerLabel: m.layerLabel, ground: m.ground }), status: 'Last advanced on 13th of Frostfall · next in 4 replies.', canAdvance: true, editLabel: 'Edit this world' });
    const hint = root.querySelector('.dooms-atlas-hint');
    const word = m.markers.length ? '' : 'Nothing is on the map yet. Drag a place from the list on the left onto the map, or press Place all.';
    hint.hidden = !word; hint.textContent = word;
    const start = root.querySelector('.dooms-atlas-start');
    const waiting = m.tray.filter(t => t.here !== false).length;
    start.hidden = m.markers.length > 0; start.innerHTML = start.hidden ? '' : atlasStartHtml({ waiting, loose: m.tray.length - waiting, picture: !!ui.picture, layerLabel: m.layerLabel });
    const trail = root.querySelector('.dooms-atlas-trail');
    trail.hidden = !m.layer; trail.innerHTML = atlasTrailHtml({ world: pack.name, trail: m.trail });
    if (window.__board) window.__board.update({ model: m, picture: ui.layer ? null : ui.picture, hidden: ui.hidden, query: ui.query, moving: ui.moving });
}
window.__draw = draw;
window.__open = async ({ look = '', world = 'realm', book = null, picture = null } = {}) => {
    if (look) document.body.setAttribute('data-dooms-ui', look); else document.body.removeAttribute('data-dooms-ui');
    if (world === 'campaign') {
        pack = blankPack('Harbourside Nights');
        state = seedWorldState(pack, { name: 'Harbourside Nights' });
        state.visited = CAMPAIGN.map((label, i) => ({ id: 'loc:' + label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''), label, packId: '', path: '', visits: i === 0 ? [9] : [i] }));
        state.where = { Mara: 'loc:the-rusty-anchor', Tam: 'loc:the-rusty-anchor-back-room', 'Dr. Hale': 'loc:dr-hale-s-clinic' };
    } else {
        pack = normalizePack(REALM).pack;
        state = seedWorldState(pack, { name: '' });
        state.visited = [{ id: 'saltport', label: 'Saltport', packId: 'saltport', path: 'saltcoast/saltport', visits: [9] }, { id: 'iron-inn', label: 'The Iron Inn', packId: 'iron-inn', path: 'northmarch/iron-inn', visits: [4] }, { id: 'old-shrine', label: 'The Old Shrine', packId: 'old-shrine', path: 'greywood/old-shrine', visits: [2] }];
    }
    window.__pack = pack;
    window.__book = book;
    window.__ui = { hidden: [], query: '', moving: false, armed: '', cardMode: 'view', picture, layer: '' };
    if (window.__board) { window.__board.destroy(); window.__board = null; }
    root.classList.add('is-open');
    root.style.display = 'flex';    // the controller's own way: the shell is hidden inline until it opens
    draw();
    window.__board = await mountAtlasMap(root.querySelector('.dooms-atlas-map'), {
        model: window.__model, picture, hidden: [], query: '', moving: false, card,
        on: {
            open: (id) => window.__events.push(['open', id]), close: () => { window.__events.push(['close']); window.__ui.cardMode = 'view'; },
            drop: (id, at) => { window.__events.push(['drop', id, at]); window.__book = A.placeAt(window.__book, id, at, window.__ui.layer); draw(); },
            enter: (id) => { window.__events.push(['enter', id]); window.__layer(id); },
            tap: (at) => { window.__events.push(['tap', at]); const ui = window.__ui; if (ui.armed === '+') { ui.armed = ''; const made = A.addPin(window.__book, { label: 'New place', x: at.x, y: at.y, layer: ui.layer }); window.__book = made.book; draw(); window.__board.open(made.id); ui.cardMode = 'edit'; window.__board.redrawCard(); } else if (ui.armed) { window.__book = A.placeAt(window.__book, ui.armed, at, ui.layer); ui.armed = ''; draw(); } },
            move: (id, at) => { window.__events.push(['move', id, at]); window.__book = A.placeAt(window.__book, id, at); draw(); },
            scale: (s) => { window.__scale = s; root.querySelector('.dooms-atlas-scale-bar').style.width = s.px + 'px'; root.querySelector('.dooms-atlas-scale-text').textContent = s.length + ' miles'; },
            pictureError: () => window.__events.push(['picture-error']),
        },
    });
    return true;
};
window.__layer = (id) => { window.__board.closeCard(); window.__ui.layer = id; window.__ui.cardMode = 'view'; draw(); window.__board.fit(); return true; };
window.__set = (next) => { Object.assign(window.__ui, next); draw(); return true; };
window.__edit = (fn) => { window.__book = fn(window.__book, window.__model, window.__pack); draw(); return true; };
window.__results = (q) => atlasResultsHtml({ markers: window.__model.markers, query: q, hidden: window.__ui.hidden, all: window.__model.all, layer: window.__model.layer });
// A tray row's own drag: its id rides the drag (the controller's listener, here).
document.addEventListener('dragstart', (ev) => { const row = ev.target.closest ? ev.target.closest('.dooms-atlas-tray-row[data-id]') : null; if (row && ev.dataTransfer) ev.dataTransfer.setData('text/plain', row.getAttribute('data-id')); });
window.__ready = true;
</script></body></html>`;

const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname === '/atlas.html') { res.writeHead(200, { 'content-type': 'text/html' }); res.end(harness); return; }
    const inFa = FA && url.pathname.startsWith('/__fa/');
    const file = inFa ? normalize(join(FA, decodeURIComponent(url.pathname.slice(6)))) : normalize(join(repo, decodeURIComponent(url.pathname)));
    if (!file.startsWith(inFa ? FA : repo)) { res.writeHead(403); res.end(); return; }
    try { const data = await readFile(file); res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' }); res.end(data); }
    catch (e) { res.writeHead(404); res.end(); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

let failures = 0;
const check = (name, cond, detail = '') => { if (cond) console.log(`pass  ${name}`); else { failures++; console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ''}`); } };
const near = (a, b, tol) => Math.abs(a - b) <= tol;

const browser = await pw.chromium.launch();
const VIEW = { width: 1600, height: 900 };
const page = await browser.newPage({ viewport: VIEW, deviceScaleFactor: shots ? 2 : 1 });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e && e.message ? e.message : e)));
await page.goto(`${base}/atlas.html`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__ready === true);
const shot = async (name) => { if (shots) await page.screenshot({ path: join(shotDir, `${name}.png`) }); };
const settle = () => page.waitForTimeout(350);

const layout = () => page.evaluate(() => {
    const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { left: b.left, top: b.top, width: b.width, height: b.height, right: b.right, bottom: b.bottom, cx: b.left + b.width / 2, cy: b.top + b.height / 2 }; };
    const shown = (el) => !!el && getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().width > 0;
    const markers = {};
    document.querySelectorAll('#dooms-atlas .dooms-atlas-marker').forEach(el => {
        const name = (el.querySelector('.dooms-atlas-label') || {}).textContent || '?';
        markers[name] = { box: r(el), pin: r(el.querySelector('.dooms-atlas-pin')), label: shown(el.querySelector('.dooms-atlas-label')), cls: el.className, faces: el.querySelectorAll('.dooms-atlas-face').length, opacity: Number(getComputedStyle(el).opacity) };
    });
    const q = (sel) => document.querySelectorAll(`#dooms-atlas ${sel}`).length;
    const side = document.querySelector('.dooms-atlas-side');
    return {
        atlas: r(document.getElementById('dooms-atlas')), side: r(side), stage: r(document.querySelector('.dooms-atlas-stage')), map: r(document.querySelector('.dooms-atlas-map')),
        sideShown: shown(side), markers, count: Object.keys(markers).length,
        shore: q('path.dooms-atlas-shore'), coast: q('path.dooms-atlas-coast'), ripples: q('path.dooms-atlas-ripple'), regions: q('path.dooms-atlas-land'), glyphs: q('path.dooms-atlas-glyph'), routes: q('path.dooms-atlas-route'), regionNames: [...document.querySelectorAll('#dooms-atlas .dooms-atlas-region-name')].map(x => x.textContent),
        images: q('.leaflet-pane img') + q('canvas'),
        zoom: document.querySelector('.dooms-atlas-map').getAttribute('data-zoom'),
        ground: document.querySelector('.dooms-atlas-map').getAttribute('data-ground'), groundLines: q('path.dooms-atlas-ground'), walls: q('path.dooms-atlas-wall'), passages: q('path.dooms-atlas-passage'), sea: q('path.dooms-atlas-water.is-sea'), mapBg: getComputedStyle(document.querySelector('.dooms-atlas-map')).backgroundColor, groundPick: (document.querySelector('.dooms-atlas-ground-select') || {}).value || '',
        kinds: [...document.querySelectorAll('.dooms-atlas-kind')].map(k => ({ id: k.getAttribute('data-kind'), count: Number(k.querySelector('.dooms-atlas-kind-count').textContent), off: k.classList.contains('is-off') })),
        tray: [...document.querySelectorAll('.dooms-atlas-tray-row')].map(x => x.querySelector('.dooms-atlas-row-name').textContent),
        rows: q('.dooms-atlas-results .dooms-atlas-row'),
        deleted: [...document.querySelectorAll('.dooms-atlas-deleted li .dooms-atlas-row-name')].map(x => x.textContent),
        hint: (() => { const h = document.querySelector('.dooms-atlas-hint'); return h && !h.hidden ? h.textContent : ''; })(),
        card: r(document.querySelector('.dooms-atlas-card')), cardText: ((document.querySelector('.dooms-atlas-card') || {}).textContent || '').replace(/\s+/g, ' '),
        cardInputs: q('.dooms-atlas-card .dooms-atlas-input'),
        trail: (() => { const t = document.querySelector('.dooms-atlas-trail'); return t && !t.hidden ? t.textContent.replace(/\s+/g, ' ').trim() : ''; })(),
        far: [...document.querySelectorAll('.dooms-atlas-results [data-layer]')].map(x => x.querySelector('.dooms-atlas-row-name').textContent),
        paper: shown(document.querySelector('.dooms-atlas-paper')), compass: shown(document.querySelector('.dooms-atlas-compass')),
        scale: window.__scale || null,
        overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        sideOverflow: side ? side.scrollWidth > side.clientWidth + 1 : false,
    };
});
/** A marker's spot in the model, and where the map draws that spot on screen. */
const spotOf = (id) => page.evaluate((k) => { const m = window.__model.markers.find(x => x.id === k); if (!m) return null; const p = window.__board.map.latLngToContainerPoint([-m.y, m.x]); const box = document.querySelector('.dooms-atlas-map').getBoundingClientRect(); return { x: m.x, y: m.y, sx: box.left + p.x, sy: box.top + p.y }; }, id);

console.log('\n§1 a long campaign: nothing lands by itself');
{
    await page.evaluate(() => window.__open({ world: 'campaign' }));
    await settle();
    const l = await layout();
    check('the Atlas fills the screen, the sidebar on the left, the map in the rest', near(l.atlas.width, VIEW.width, 1) && near(l.atlas.height, VIEW.height, 1) && l.side.left === 0 && near(l.side.width, 340, 1) && near(l.stage.left, 340, 1) && near(l.stage.right, VIEW.width, 1) && near(l.map.height, VIEW.height, 1));
    check('the map is empty: no marker, no land', l.count === 0 && l.shore === 0 && l.routes === 0);
    check('the map says how it fills', /Drag a place/.test(l.hint));
    const start = await page.evaluate(() => { const c = document.querySelector('.dooms-atlas-start-card'); if (!c) return null; const b = c.getBoundingClientRect(); const map = document.querySelector('.dooms-atlas-map').getBoundingClientRect(); return { text: c.textContent.replace(/\s+/g, ' '), buttons: [...c.querySelectorAll('button')].map(x => x.getAttribute('data-act')), centred: Math.abs((b.left + b.width / 2) - (map.left + map.width / 2)) < 4, inside: b.top >= 0 && b.bottom <= innerHeight }; });
    check('an empty map shows Start your map in its middle: place them all, or place them yourself', !!start && /Start your map/.test(start.text) && /8 places are waiting/.test(start.text) && /Place all 8 for me/.test(start.text) && start.buttons.join() === 'place-all,start-dismiss' && start.centred && start.inside, JSON.stringify(start));
    check('fifteen wordings are eight places in the tray: the rooms folded into their buildings', l.tray.length === 8 && l.tray.includes("Jordan's House") && l.tray.includes('Bedroom') && l.tray.includes('The Rusty Anchor') && l.tray.includes('Harbour Market') && !l.tray.some(t => /wall|window|Kitchen|back room|stalls/.test(t)), JSON.stringify(l.tray));
    check('the party\'s place is first in the tray', l.tray[0] === "Jordan's House");
    check('the paper lies over the map and the compass is drawn', l.paper && l.compass);
    check('nothing runs past the screen or the sidebar', !l.overflowX && !l.sideOverflow);
    await shot('1-campaign-empty');
}

console.log('\n§2 placing: a drag, a tap, Place all');
{
    // A tray row dragged onto the map and let go at a point.
    const drop = { x: 900, y: 420 };
    await page.evaluate(({ x, y }) => {
        const row = [...document.querySelectorAll('.dooms-atlas-tray-row')].find(r => r.textContent.includes("Jordan's House"));
        const dt = new DataTransfer();
        row.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
        const map = document.querySelector('.dooms-atlas-map');
        map.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: x, clientY: y }));
        map.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: x, clientY: y }));
    }, drop);
    await settle();
    let l = await layout();
    const house = l.markers["Jordan's House"];
    check('a place dragged from the tray lands where it was dropped', !!house && near(house.pin.cx, drop.x, 3) && near(house.pin.cy, drop.y, 3), JSON.stringify(house && house.pin));
    check('with something on the map the Start panel is gone', await page.evaluate(() => document.querySelector('.dooms-atlas-start').hidden === true));
    check('it leaves the tray; a town\'s map is streets all over, not an island', l.tray.length === 7 && !l.tray.includes("Jordan's House") && l.ground === 'city' && l.shore === 0 && l.groundLines === 1 && l.hint === '');
    check('the party is marked on its place', /is-player/.test(house.cls) && house.label === true);
    // A tray row tapped, then the map tapped.
    await page.evaluate(() => { const id = window.__model.tray.find(t => t.label === 'The Rusty Anchor').id; window.__set({ armed: id }); });
    await page.mouse.click(1100, 300);
    await settle();
    l = await layout();
    const anchor = l.markers['The Rusty Anchor'];
    check('a place tapped in the tray lands where the map is tapped next', !!anchor && near(anchor.pin.cx, 1100, 3) && near(anchor.pin.cy, 300, 3), JSON.stringify(anchor && anchor.pin));
    check('the people of its rooms stand at it, and a path joins the two places', anchor.faces === 2 && l.routes === 1);
    await page.evaluate(() => window.__edit((b, m) => window.A.placeAll(b, m)));
    await page.evaluate(() => window.__board.fit());
    await settle();
    l = await layout();
    check('Place all puts the rest on the map and keeps what was placed where it was', l.count === 8 && l.tray.length === 0 && (await page.evaluate(() => { const m = window.__model.markers; return m.every((a, i) => m.every((b, j) => i >= j || Math.hypot(a.x - b.x, a.y - b.y) >= 1.29)); })));
    check('the map is vectors: the streets, the paths, and no picture', l.groundLines === 1 && l.routes === 7 && l.images === 0);
    await shot('2-campaign-placed');
}

console.log('\n§3 made by hand, moved, merged, deleted, brought back');
{
    await page.evaluate(() => window.__set({ armed: '+' }));
    await page.mouse.click(600, 700);
    await settle();
    let l = await layout();
    check('a marker made by hand lands where the map was tapped and opens on its name', l.count === 9 && !!l.markers['New place'] && l.cardInputs === 3 && /Name.*Kind.*Note/.test(l.cardText));
    await shot('3-new-marker');
    await page.evaluate(() => { window.__board.closeCard(); window.__edit((b) => window.A.editMarker(b, 'pin:new-place', { label: 'The Old Well', kind: 'water', note: 'Dry since spring.' })); });
    await settle();
    l = await layout();
    check('renamed, it carries its new name and kind', !!l.markers['The Old Well'] && /kind-water/.test(l.markers['The Old Well'].cls) && !l.markers['New place']);
    // Moving: off, a drag pans the map; on, a drag moves the marker.
    await page.evaluate(() => window.__set({ moving: true }));
    const from = await spotOf('pin:new-place');
    await page.mouse.move(from.sx, from.sy);
    await page.mouse.down();
    await page.mouse.move(from.sx + 40, from.sy - 30, { steps: 4 });
    await page.mouse.move(from.sx + 120, from.sy - 90, { steps: 6 });
    await page.mouse.up();
    await settle();
    const to = await spotOf('pin:new-place');
    const moved = await page.evaluate(() => window.__events.filter(e => e[0] === 'move').length);
    check('with moving on, a marker dragged stays where it was let go', moved === 1 && near(to.sx, from.sx + 120, 4) && near(to.sy, from.sy - 90, 4) && (to.x !== from.x || to.y !== from.y), `${JSON.stringify(from)} → ${JSON.stringify(to)}`);
    await page.evaluate(() => window.__set({ moving: false }));
    // The card's tools, and a merge.
    await page.mouse.move(700, 5);
    await page.evaluate(() => window.__board.show(window.__model.markers.find(m => m.label === 'Bedroom').id));
    await page.waitForTimeout(600);
    l = await layout();
    check('the card lists the rooms folded into the place and offers Enter, Edit, Merge, Move, Take off, Delete', /Inside.*bedroom on the wall.*by the window/.test(l.cardText) && /Enter.*Edit.*Merge.*Move.*Take off.*Delete/.test(l.cardText), l.cardText.slice(0, 260));
    await shot('4-card');
    await page.evaluate(() => { window.__ui.cardMode = 'edit'; window.__board.redrawCard(); });
    await page.locator('#dooms-atlas .dooms-atlas-marker', { hasText: 'The Rusty Anchor' }).locator('.dooms-atlas-pin').click();
    await settle();
    l = await layout();
    check('another marker opened while one is being edited opens to be read', /The Rusty Anchor/.test(l.cardText) && l.cardInputs === 0 && /Travel here/.test(l.cardText), l.cardText.slice(0, 160));
    await page.evaluate(() => window.__board.show(window.__model.markers.find(m => m.label === 'Bedroom').id));
    await page.waitForTimeout(600);
    await page.evaluate(() => { window.__ui.cardMode = 'merge'; window.__board.redrawCard(); });
    l = await layout();
    check('Merge offers the other places', /Merge into/.test(l.cardText) && /Jordan's House/.test(l.cardText) && l.cardInputs === 1);
    await page.evaluate(() => { window.__board.closeCard(); const m = window.__model.markers; window.__edit((b) => window.A.mergeInto(b, m.find(x => x.label === 'Bedroom').id, m.find(x => x.label === "Jordan's House").id)); });
    await page.evaluate(() => window.__board.show(window.__model.markers.find(m => m.label === "Jordan's House").id));
    await page.waitForTimeout(600);
    l = await layout();
    check('merged: one marker fewer, the house is also called Bedroom and holds its rooms', l.count === 8 && !l.markers['Bedroom'] && /Also called.*Bedroom/.test(l.cardText) && /Inside.*Kitchen.*bedroom on the wall/.test(l.cardText), l.cardText.slice(0, 300));
    await page.evaluate(() => { window.__board.closeCard(); window.__edit((b) => window.A.removeMarker(b, window.__model.markers.find(x => x.label === 'Miller Street').id)); });
    await settle();
    l = await layout();
    check('deleted: off the map, not in the tray, listed under Deleted', l.count === 7 && !l.markers['Miller Street'] && !l.tray.includes('Miller Street') && l.deleted.includes('Miller Street'));
    await page.evaluate(() => window.__edit((b) => window.A.restoreMarker(b, window.__model.deleted[0].id)));
    l = await layout();
    check('brought back: it waits in the tray', l.tray.includes('Miller Street') && l.deleted.length === 0);
    await page.evaluate(() => window.__edit((b) => window.A.unplace(b, 'pin:new-place')));
    l = await layout();
    check('taken off the map: it waits in the tray', l.tray.includes('The Old Well') && !l.markers['The Old Well']);
}

console.log('\n§4 layers: a place entered, its own map, the way back out (D156)');
{
    await page.evaluate(() => window.__open({ world: 'realm' }));
    await page.evaluate(() => window.__edit((b, m) => window.A.placeAll(b, m)));
    await page.evaluate(() => window.__board.fit());
    await settle();
    let l = await layout();
    check('the top map holds the five regions, each a marker that holds a map of its own', l.count === 5 && l.tray.length === 0 && Object.values(l.markers).every(m => /is-layer/.test(m.cls)) && l.trail === '', `${l.count} ${JSON.stringify(Object.keys(l.markers))}`);
    check('the party inside a region marks it', /is-player/.test(l.markers['The Salt Coast'].cls));
    check('a marker whose name tells a terrain stands on tinted ground with its drawings', l.regions >= 3 && l.glyphs >= 3);
    check('the top map of a world whose places hold maps reads as a region', (await page.evaluate(() => window.__model.measure.scale)) === 'region');
    await shot('5-realm-top');
    await page.evaluate(() => window.__board.show('northmarch'));
    await page.waitForTimeout(600);
    l = await layout();
    check('the card offers Enter, with how many places are inside', /Enter \(4 places inside\)/.test(l.cardText) && /Regions|Other places|Wilds/.test(l.cardText) === true || /4 places inside/.test(l.cardText));
    await page.evaluate(() => window.__board.closeCard());
    await page.mouse.move(700, 5);
    const at = await spotOf('northmarch');
    await page.mouse.dblclick(at.sx, at.sy);
    await settle();
    l = await layout();
    check('a marker double-clicked is entered: its own map, empty until its places are put down', (await page.evaluate(() => window.__events.some(e => e[0] === 'enter' && e[1] === 'northmarch'))) && l.count === 0 && l.tray.length === 4 && l.tray.includes('Frosthold Keep'));
    check('the trail says where this map is: the world, then the place', /The Realm of Vael.*The Northmarch/.test(l.trail), l.trail);
    const start = await page.evaluate(() => (document.querySelector('.dooms-atlas-start-card') || {}).textContent || '');
    check('an empty inner map says it is inside the place', /Inside The Northmarch/.test(start) && /Place all 4 for me/.test(start.replace(/\s+/g, ' ')));
    await page.evaluate(() => window.__edit((b, m) => window.A.placeAll(b, m)));
    await page.evaluate(() => window.__board.fit());
    await settle();
    l = await layout();
    check('its places stand on its own map, at a town\'s scale', l.count === 4 && !!l.markers['Frosthold Keep'] && !l.markers['The Northmarch'] && (await page.evaluate(() => window.__model.measure.scale)) === 'town');
    check('the people stand at their places: three faces and a count for more', l.markers['The Iron Inn'].faces === 4 && l.markers['Frosthold Keep'].faces === 1);
    await shot('6-inside-northmarch');
    await page.evaluate(() => window.__set({ hidden: ['tavern'] }));
    await settle();
    l = await layout();
    check('a kind switched off takes its markers away; its switch is struck through', !l.markers['The Iron Inn'] && !!l.markers['Frosthold Keep'] && l.kinds.find(k => k.id === 'tavern').off && !l.kinds.find(k => k.id === 'stronghold').off);
    await page.evaluate(() => window.__set({ hidden: [], query: 'inn' }));
    await settle();
    l = await layout();
    check('a search dims what does not match, and the list holds the matches', l.markers['The Iron Inn'].opacity === 1 && l.markers['Frosthold Keep'].opacity < 0.5 && l.rows === 1);
    await page.evaluate(() => window.__set({ query: 'salt' }));
    l = await layout();
    check('a search reaches the other maps: The Salt Coast is on the top map', l.far.includes('The Salt Coast') && l.rows === 1, JSON.stringify(l.far));
    check('a search with no match says so', /Nothing on any map matches/.test(await page.evaluate(() => window.__results('zzzz'))));
    await page.evaluate(() => window.__set({ query: '' }));
    await page.evaluate(() => window.__board.show('frosthold'));
    await page.waitForTimeout(600);
    l = await layout();
    check('the card names the place, its kind, its note and who is there', /Frosthold Keep/.test(l.cardText) && /Strongholds/.test(l.cardText) && /last garrison/.test(l.cardText) && /Captain Rusk/.test(l.cardText));
    check('the party is on another map: no distance is told, Travel here is offered', !/on foot/.test(l.cardText) && /Travel here/.test(l.cardText));
    check('the card is inside the screen', l.card.left >= 0 && l.card.right <= VIEW.width && l.card.top >= 0 && l.card.bottom <= VIEW.height, JSON.stringify(l.card));
    await page.evaluate(() => { window.__ui.cardMode = 'move'; window.__board.redrawCard(); });
    l = await layout();
    check('Move offers the top map and the other places', /Move into/.test(l.cardText) && /The top map/.test(l.cardText) && /Greywood Forest/.test(l.cardText) && l.cardInputs === 1);
    await page.evaluate(() => { window.__board.closeCard(); window.__edit((b) => window.A.moveInto(b, 'frosthold', 'greywood')); });
    l = await layout();
    check('moved into another place: it leaves this map', l.count === 3 && !l.markers['Frosthold Keep'] && !l.tray.includes('Frosthold Keep'));
    await page.locator('.dooms-atlas-trail-up').click({ force: true }).catch(() => {});
    await page.evaluate(() => window.__layer(''));
    await settle();
    l = await layout();
    check('back out on the top map: the five regions where they were, no trail', l.count === 5 && l.trail === '' && !!l.markers['The Northmarch']);
    await page.evaluate(() => window.__layer('saltcoast'));
    await page.evaluate(() => window.__edit((b, m) => window.A.placeAll(b, m)));
    await page.evaluate(() => window.__board.fit());
    await settle();
    await page.evaluate(() => window.__board.show('saltport'));
    await page.waitForTimeout(600);
    l = await layout();
    check('the party\'s own place says You are here, with no Travel, and what is said of it', /You are here/.test(l.cardText) && !/Travel here/.test(l.cardText) && /harbour chain/.test(l.cardText) && /3 places inside/.test(l.cardText));
    await page.evaluate(() => window.__board.show('lighthouse'));
    await page.waitForTimeout(600);
    l = await layout();
    check('on the party\'s own map a card says how far the party is', /(miles|mile), about .+ on foot|a few steps away/.test(l.cardText), l.cardText.slice(0, 200));
    await page.evaluate(() => window.__board.closeCard());
}

console.log('\n§5 the zoom');
{
    await page.evaluate(() => window.__layer('northmarch'));
    await page.mouse.move(700, 5);    // off the markers: a pin under the pointer is drawn larger
    await page.evaluate(() => { const b = window.__board; const m = window.__model.markers.find(x => x.id === 'iron-inn'); b.map.setView([-m.y, m.x], 6, { animate: false }); });
    await settle();
    const before = await layout();
    await page.evaluate(() => { const b = window.__board; b.map.setView(b.map.getCenter(), b.map.getZoom() + 2, { animate: false }); });
    await settle();
    const after = await layout();
    const a = before.markers['The Iron Inn'].pin;
    const z = after.markers['The Iron Inn'].pin;
    check('a marker keeps its size after a zoom', near(a.width, z.width, 0.5) && near(a.width, 30, 1) && before.markers['The Iron Inn'].label === true, `${a.width} → ${z.width}`);
    check('the ground is still vectors after a zoom (nothing to pixelate)', after.groundLines === 1 && after.images === 0);
    check('the scale bar follows the zoom', near(after.scale.perPx * 4, before.scale.perPx, before.scale.perPx * 0.01));
    await page.evaluate(() => { const b = window.__board; b.map.setView(b.map.getCenter(), 3.5, { animate: false }); });
    await settle();
    const far = await layout();
    check('as far out as a small map goes, the places are still pins (dots are for maps too wide for them)', far.zoom !== 'far' && near(far.markers['The Iron Inn'].pin.width, 30, 1), far.zoom);
    const view = await page.evaluate(() => { const v = window.__board.view(); return { lat: v.center.lat, lng: v.center.lng, zoom: v.zoom }; });
    await page.evaluate(() => window.__draw());
    const kept = await page.evaluate(() => { const v = window.__board.view(); return { lat: v.center.lat, lng: v.center.lng, zoom: v.zoom }; });
    check('an update keeps the view (to within a pixel)', near(view.lat, kept.lat, 0.2) && near(view.lng, kept.lng, 0.2) && view.zoom === kept.zoom, `${JSON.stringify(view)} → ${JSON.stringify(kept)}`);
}

console.log('\n§5b the grounds (D158)');
{
    await page.evaluate(() => window.__open({ world: 'realm' }));
    await page.evaluate(() => window.__edit((b, m) => window.A.placeAll(b, m)));
    await page.evaluate(() => window.__board.fit());
    await settle();
    let l = await layout();
    const sea = await page.evaluate(() => getComputedStyle(document.querySelector('.dooms-atlas-stage')).backgroundColor);
    check('the top map of a region is open country: land all over, no shore, no island', l.ground === 'country' && l.shore === 0 && l.ripples === 0 && l.groundLines === 1 && l.mapBg !== sea && l.groundPick === 'country', `${l.ground} ${l.mapBg} ${sea}`);
    await shot('7a-ground-country');
    await page.evaluate(() => window.__edit((b) => window.A.withGround(b, 'coast-s')));
    await settle();
    l = await layout();
    check('a coast: the sea past one shore, the land everywhere else', l.ground === 'coast-s' && l.sea === 1 && l.ripples === 1 && l.groundPick === 'coast-s');
    await shot('7b-ground-coast');
    await page.evaluate(() => window.__edit((b) => window.A.withGround(b, 'island')));
    await settle();
    l = await layout();
    check('the islands: a shore around every place, as before', l.ground === 'island' && l.shore === 5 && l.ripples === 10 && l.mapBg === sea);
    await page.evaluate(() => window.__edit((b) => window.A.withGround(b, '')));
    await page.evaluate(() => window.__layer('northmarch'));
    await page.evaluate(() => window.__edit((b, m) => window.A.placeAll(b, m)));
    await page.evaluate(() => window.__board.fit());
    await settle();
    l = await layout();
    check('inside a place, a town: streets', l.ground === 'city' && l.groundLines === 1 && l.shore === 0);
    await shot('7c-ground-city');
    await page.evaluate(() => window.__edit((b) => window.A.withGround(window.A.withScale(b, 'site', 'northmarch'), 'underground', 'northmarch')));
    await settle();
    l = await layout();
    check('the underground: chambers around the places joined by passages, in the dark', l.ground === 'underground' && l.walls === 4 && l.passages === 2 && l.routes === 0 && /rgb\(74, 67, 60\)/.test(l.mapBg), `${l.walls} ${l.passages} ${l.mapBg}`);
    await shot('7d-ground-underground');
    await page.evaluate(() => window.__edit((b) => window.A.withGround(b, 'indoors', 'northmarch')));
    await settle();
    l = await layout();
    check('indoors: a floor\'s squares', l.ground === 'indoors' && l.groundLines === 1 && l.walls === 0);
}

console.log('\n§6 a world with a picture of its own (D154)');
{
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800"><rect width="1200" height="800" fill="#3c5a4a"/><circle cx="600" cy="400" r="260" fill="#8a7a52"/></svg>';
    const picture = { image: `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`, width: 1200, height: 800 };
    await page.evaluate((pic) => window.__open({ world: 'realm', picture: pic, book: window.A.placeAt(window.A.placeAt(null, 'northmarch', { x: -3, y: -2 }), 'saltcoast', { x: 4, y: 3 }) }), picture);
    await settle();
    const l = await layout();
    const img = await page.evaluate(() => { const i = document.querySelector('#dooms-atlas img.dooms-atlas-picture'); if (!i) return null; const b = i.getBoundingClientRect(); return { w: b.width, h: b.height }; });
    check('the picture lies under the markers, whole, at its own shape', !!img && near(img.w / img.h, 1.5, 0.01) && img.h <= VIEW.height + 1, JSON.stringify(img));
    check('with a picture the drawn land is left out; the markers and their path stay', l.shore === 0 && l.regions === 0 && l.count === 2 && l.routes === 1);
    await page.evaluate(() => window.__layer('northmarch'));
    await settle();
    check('a place\'s own map is drawn, not the world\'s picture', await page.evaluate(() => !document.querySelector('#dooms-atlas img.dooms-atlas-picture')));
    await page.evaluate(() => window.__layer(''));
    await shot('7-picture');
}

console.log('\n§7 the sidebar folds; the looks; a phone');
{
    await page.evaluate(() => window.__open({ world: 'realm' }));
    await page.evaluate(() => window.__edit((b, m) => window.A.placeAll(b, m)));
    await page.evaluate(() => { document.getElementById('dooms-atlas').classList.add('is-folded'); window.__board.size(); });
    await settle();
    let l = await layout();
    check('folded: the map takes the whole screen', !l.sideShown && near(l.stage.left, 0, 1) && near(l.stage.width, VIEW.width, 1));
    await page.evaluate(() => { document.getElementById('dooms-atlas').classList.remove('is-folded'); });
    const sides = {};
    for (const look of ['', 'arcade', 'console', 'grimoire', 'inked', 'lumen']) {
        await page.evaluate((k) => window.__open({ look: k, world: 'realm' }), look);
        await page.evaluate(() => window.__edit((b, m) => window.A.placeAll(b, m)));
        await page.evaluate(() => window.__board.fit());
        await settle();
        l = await layout();
        sides[look || 'default'] = await page.evaluate(() => getComputedStyle(document.querySelector('.dooms-atlas-side')).backgroundColor);
        check(`the look "${look || 'default'}": the window, the markers and the land`, near(l.atlas.width, VIEW.width, 1) && l.count === 5 && l.ground === 'country' && l.groundLines === 1 && !l.overflowX && !l.sideOverflow);
        await shot(`8-look-${look || 'default'}`);
    }
    check('the looks colour the sidebar their own way', new Set(Object.values(sides)).size >= 3, JSON.stringify(sides));
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => window.__open({ look: '', world: 'campaign' }));
    await settle();
    l = await layout();
    check('a phone: the map fills it, the sidebar a sheet over it', near(l.stage.width, 390, 1) && near(l.stage.left, 0, 1) && l.side.width <= 345 && !l.overflowX);
    await shot('9-phone');
}

check('no errors on the page', errors.length === 0, errors.join(' | '));
await browser.close();
server.close();
if (shots) console.log(`\nscreenshots: ${shotDir}`);
console.log(failures ? `\n${failures} failure(s)` : '\nall pass');
process.exit(failures ? 1 : 0);
