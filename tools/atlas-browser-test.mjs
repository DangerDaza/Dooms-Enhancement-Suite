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
import { ATLAS_ID, atlasShellHtml, atlasSideHtml, atlasPlacesHtml, atlasResultsHtml, atlasCardHtml, atlasStartHtml, atlasTrailHtml, atlasSetupHtml, atlasFillHtml, atlasScenesHtml, scenesRefusalText, atlasStartSceneHtml, atlasEndSceneHtml, atlasStripHtml, atlasRoadHtml, roadTimeHours, roadTimeParts, atlasWorldGenHtml, atlasNamesHtml , atlasSceneListHtml, atlasWaysHtml, atlasWorldHooksHtml } from '/src/systems/ui/atlasViews.js';
import { newsHtml, rumoursHtml, peopleHtml } from '/src/systems/ui/worldViews.js';
import * as S from '/src/utils/atlasSetup.js';
import * as W from '/src/utils/atlasWorld.js';
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
const card = (m) => { const mod = window.__model; return atlasCardHtml({ marker: mod.markers.find(x => x.id === m.id) || m, mode: window.__ui.cardMode, others: mod.all.filter(x => x.id !== m.id).map(x => ({ id: x.id, label: x.label, layerLabel: x.layerLabel, inside: x.inside })), distance: A.describeDistance(mod, mod.party, m.id), canTravel: !window.__ui.between, canStart: !!window.__ui.canStart, sceneNo: 4, draw: window.__ui.draw || null, rumours: m.id === 'saltport' ? ['The harbour chain has been raised at Saltport.'] : [], news: [] }); };
function draw() {
    const m = window.__model = model();
    const ui = window.__ui;
    root.querySelector('.dooms-atlas-side').innerHTML = atlasSideHtml({ name: pack.name, facts: { date: '14th of Frostfall', time: 'Dusk', location: 'Saltport, the quay', weather: 'Sea fog' }, tab: 'places', body: atlasPlacesHtml({ markers: m.markers, tray: m.tray, deleted: m.deleted, query: ui.query, hidden: ui.hidden, armed: ui.armed, scale: m.measure.scale, all: m.all, layer: m.layer, layerLabel: m.layerLabel, ground: m.ground, world: m.world, toName: m.world ? W.landsToName(m).length : 0 }), status: 'Last advanced on 13th of Frostfall · next in 4 replies.', canAdvance: true, editLabel: 'Edit this world', scenes: !ui.between && !ui.ending, between: ui.between || null, ending: ui.ending || null, undoEnd: ui.undoEnd || null });
    const hint = root.querySelector('.dooms-atlas-hint');
    const word = m.markers.length ? '' : m.realm ? 'Nothing stands in ' + m.layerLabel + ' yet. Drag a place from the list on the left onto its land, or add one with the pin button above.' : 'Nothing is on the map yet. Drag a place from the list on the left onto the map, or press Place all.';
    hint.hidden = !word; hint.textContent = word;
    const start = root.querySelector('.dooms-atlas-start');
    const waiting = m.tray.filter(t => t.here !== false).length;
    start.hidden = m.markers.length > 0 || !!m.realm || !!m.world; start.innerHTML = start.hidden ? '' : atlasStartHtml({ waiting, loose: m.tray.length - waiting, picture: !!ui.picture, layerLabel: m.layerLabel });
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
        road: (r) => { const m = window.__model; const cur = m.routes.find(x => (x.a === r.a && x.b === r.b) || (x.a === r.b && x.b === r.a)) || r; const len = (cur.units || 0) * m.measure.per; const name = (id) => (m.markers.find(x => x.id === id) || {}).label || id; return atlasRoadHtml({ a: { id: cur.a, label: name(cur.a) }, b: { id: cur.b, label: name(cur.b) }, drawn: A.describeLength(len, m.measure.unit) + ', ' + A.describeTime(A.travelHours(len, m.measure)) + ' on foot', hours: cur.hours || 0, unit: m.measure.scale === 'world' || m.measure.scale === 'region' ? 'days' : 'minutes' }); },
        on: {
            open: (id) => window.__events.push(['open', id]), close: () => { window.__events.push(['close']); window.__ui.cardMode = 'view'; },
            drop: (id, at) => { const into = (() => { const it = [...window.__model.tray, ...window.__model.markers].find(x => x.id === id); return it && it.kind === 'region' ? '' : A.territoryAt(window.__model, at.x, at.y); })(); window.__events.push(['drop', id, at, into]); const spot = into ? A.spotOnLand(A.atlasModel({ pack, state, player: 'Jordan', book: window.__book, layer: into }).realm, at) : at; window.__book = A.placeAt(window.__book, id, spot, into || window.__ui.layer); draw(); },
            enter: (id) => { window.__events.push(['enter', id]); window.__layer(id); },
            pick: (id) => { window.__events.push(['pick', id]); const ui = window.__ui; if (!ui.first || ui.first === id) { ui.first = ui.first === id ? '' : id; window.__board.update({ picked: ui.first }); return; } const a = ui.first; ui.first = ''; window.__board.update({ picked: '' }); window.__book = A.toggleRoad(window.__book, a, id, window.__model); draw(); },
            tap: (at) => { window.__events.push(['tap', at]); const ui = window.__ui; if (ui.armed === '+') { ui.armed = ''; const made = A.addPin(window.__book, { label: 'New place', x: at.x, y: at.y, layer: ui.layer }); window.__book = made.book; draw(); window.__board.open(made.id); ui.cardMode = 'edit'; window.__board.redrawCard(); } else if (ui.armed) { window.__book = A.placeAt(window.__book, ui.armed, at, ui.layer); ui.armed = ''; draw(); } },
            move: (id, at) => { window.__events.push(['move', id, at]); window.__book = A.placeAt(window.__book, id, at); draw(); },
            scale: (s) => { window.__scale = s; root.querySelector('.dooms-atlas-scale-bar').style.width = s.px + 'px'; root.querySelector('.dooms-atlas-scale-text').textContent = s.length + ' miles'; },
            pictureError: () => window.__events.push(['picture-error']),
        },
    });
    return true;
};
window.S = S;
// The set-up's panel with a fixture draft (the controller's own lines, here).
window.__setup = (step) => {
    const panel = root.querySelector('.dooms-atlas-setup');
    if (!step) { panel.hidden = true; panel.innerHTML = ''; return true; }
    const reply = JSON.stringify({ scale: 'region', places: [
        { name: 'Hask', kind: 'settlement', note: 'A landlocked walled city.', inside: '', was: [1], near: [{ to: 'The Old Road', dir: 's', far: 'near' }] },
        { name: 'The Old Road', kind: 'wild', inside: '', guess: true },
        { name: 'The House on the Lane', kind: 'home', inside: 'Hask', was: [2, 3], near: [{ to: 'The Temple', dir: 'n', far: 'close' }] },
        { name: 'The Temple', kind: 'sacred', inside: 'Hask' },
        { name: 'The Counting Room', kind: 'shop', inside: 'Hask', near: [{ to: 'The Temple', dir: 'w', far: 'far' }] },
        { name: 'The Black Stair', kind: 'ruin', inside: 'The Temple' },
        { name: 'First Landing', kind: 'ruin', inside: 'The Black Stair' }, { name: 'Second Landing', kind: 'ruin', inside: 'The Black Stair', guess: true },
    ], drop: [4] });
    const draft = S.parseSetup(reply, window.__model).draft;
    window.__draft = draft;
    panel.hidden = false;
    panel.innerHTML = atlasSetupHtml({ step, notes: step === 'notes' ? '' : 'Hask is a landlocked city.', reach: step === 'notes' ? 'recent' : 'full', cost: { messages: 412, parts: 9, skipped: 0 }, progress: { done: 3, total: 10, word: 'Reading the chat: part 4 of 9' }, draft, error: '', onMap: window.__model.all.length, note: '' });
    return true;
};
window.__applySetup = () => { const r = S.applySetup(window.__draft, window.__book); window.__book = r.book; window.__ids = Object.fromEntries(r.ids); window.__setup(''); window.__ui.layer = ''; draw(); window.__board.fit(); return true; };
// The fill's panel with fixture suggestions.
window.__fill = (step) => {
    const panel = root.querySelector('.dooms-atlas-setup');
    const m = window.__model;
    const reply = JSON.stringify({ places: [
        { name: 'The Pit', kind: 'landmark', note: 'A fighting pit where debts are settled; the place to find hired blades.', near: [{ to: 'The Temple', dir: 'w', far: 'far' }] },
        { name: "Tanner's Row", kind: 'shop', note: 'Stinking yards and cheap leather; someone here always knows who came through the gate.', near: [{ to: 'The Pit', dir: 'n', far: 'close' }] },
        { name: 'The Gilded Ewer', kind: 'tavern', note: 'A quiet inn with a locked upper room.', near: [{ to: 'The Counting Room', dir: 'e', far: 'near' }] },
        { name: 'Ashgate', kind: 'landmark', note: 'The north gate, shut at dusk.', near: [{ to: 'The Temple', dir: 's', far: 'far' }] },
    ] });
    window.__fillPlaces = S.parseFill(reply, m).places;
    panel.hidden = false;
    panel.innerHTML = atlasFillHtml({ step, mapLabel: m.layerLabel || 'the world', wish: '', count: 8, places: window.__fillPlaces, error: '' });
    return true;
};
window.__applyFill = () => { const r = S.applyFill(window.__book, window.__model, window.__fillPlaces); window.__book = r.book; window.__setup(''); draw(); window.__board.fit(); return r.ids; };
// Fill out with regions (D166): the panel with what the map allows, and the suggestions applied with their home region.
window.__fillRegions = (step, reply) => {
    const panel = root.querySelector('.dooms-atlas-setup');
    const m = window.__model;
    const fo = S.fillOptions(m);
    const r = reply ? S.parseFill(reply, m, { what: 'regions' }) : { places: [], home: '' };
    window.__fillPlaces = r.places; window.__fillHome = r.home;
    panel.hidden = false;
    panel.innerHTML = atlasFillHtml({ step, mapLabel: m.layerLabel || pack.name, options: fo.options, what: step === 'ask' ? fo.options[0] : 'regions', homeNeeded: fo.home, homeHolds: m.markers.filter(x => x.kind !== 'region').length + m.tray.filter(t => t.here !== false && t.kind !== 'region').length, home: r.home, places: r.places });
    return fo;
};
window.__applyFillRegions = () => { const home = S.fillOptions(window.__model).home ? (document.querySelector('.dooms-atlas-fill-home') || {}).value || window.__fillHome : ''; const r = S.applyFill(window.__book, window.__model, window.__fillPlaces, { home }); window.__book = r.book; window.__homeId = r.homeId; window.__setup(''); draw(); window.__board.fit(); return r; };
// Playing the story as scenes (D172): the panel at a step, with a plan as the scene engine would give it.
window.__scenes = (o) => { const panel = root.querySelector('.dooms-atlas-setup'); panel.hidden = false; panel.innerHTML = atlasScenesHtml(o); return true; };
window.__refusal = (plan) => scenesRefusalText(plan);
// Starting a scene from a marker (D174): the sheet at a step.
// Ending a scene (D176): the sheet in a state; the strip that stands above a scene's chat, in a box with the strip's own id.
window.__endScene = (o) => { const panel = root.querySelector('.dooms-atlas-setup'); panel.hidden = false; panel.innerHTML = atlasEndSceneHtml(o); return true; };
window.__strip = (o) => { let el = document.getElementById('dooms-scene-strip'); if (!el) { document.body.insertAdjacentHTML('afterbegin', '<div id="dooms-scene-strip" class="dooms-scene-strip" style="position:fixed;left:0;top:0;width:900px;z-index:99999"></div>'); el = document.getElementById('dooms-scene-strip'); } el.innerHTML = o ? atlasStripHtml(o) : ''; if (!o) el.remove(); return true; };
// The sidebar with another tab's body, a world picker, the Scenes tab (D193, D194): the controller's own lines, here.
window.__side = (o) => { root.querySelector('.dooms-atlas-side').innerHTML = atlasSideHtml({ name: pack.name, facts: { date: '14th of Frostfall', time: 'Dusk', location: 'Saltport, the quay', weather: 'Sea fog' }, ...o }); return true; };
window.__V = { atlasSceneListHtml, atlasWaysHtml, atlasWorldHooksHtml, newsHtml, rumoursHtml, peopleHtml };
window.__state = () => state;
window.__lw = { normalizePack, seedWorldState };
window.__sceneStart = (o) => { const panel = root.querySelector('.dooms-atlas-setup'); panel.hidden = false; panel.innerHTML = atlasStartSceneHtml(o); return true; };
// World gen (D182): the panel for a set of choices (the controller's own lines, here), the world applied, the names' sheet.
window.W = W;
window.__worldgen = (choices) => {
    const panel = root.querySelector('.dooms-atlas-setup');
    if (!choices) { panel.hidden = true; panel.innerHTML = ''; return true; }
    const top = A.atlasModel({ pack, state, player: 'Jordan', book: window.__book, layer: '' });
    const d = W.worldGenDefaults(window.__book, top);
    const c = { ...d, seed: 'alpha', ...choices };
    const plan = W.planWorldGen(window.__book, top, c);
    panel.hidden = false;
    panel.innerHTML = atlasWorldGenHtml({ ...c, state: W.worldGenState(window.__book, top), plan, reach: plan ? W.worldReach(plan.spec, { per: 60, unit: 'mi' }) : '', error: c.seed ? '' : 'A world needs a seed: type one, or press Roll again.' });
    window.__choices = c;
    return { defaults: d, added: plan ? plan.added.length : 0, lands: plan ? plan.lands.length : 0, unplaced: plan ? plan.unplaced : 0 };
};
window.__applyWorld = () => { const top = A.atlasModel({ pack, state, player: 'Jordan', book: window.__book, layer: '' }); const r = W.applyWorldGen(window.__book, top, window.__choices); window.__book = r.book; window.__worldgen(null); window.__ui.layer = ''; draw(); window.__board.fit(); return { added: r.added, unplaced: r.unplaced, replaced: r.replaced }; };
window.__names = (o) => { const panel = root.querySelector('.dooms-atlas-setup'); if (!o) { panel.hidden = true; panel.innerHTML = ''; return true; } panel.hidden = false; panel.innerHTML = atlasNamesHtml(o); return true; };
// A person or a new thread crossed off a record's sheet (D188): the row goes (the controller's own line, here).
document.addEventListener('click', (ev) => { const b = ev.target.closest ? ev.target.closest('[data-act="cont-drop"]') : null; if (b) b.closest('li').remove(); });
window.__roadTime = { hours: roadTimeHours, parts: roadTimeParts };
// A road's card saved (the controller's lines, here): the figure and the unit read from the card, the time set on the road.
window.__saveRoad = () => { const c = document.querySelector('.dooms-atlas-card.is-road'); const hours = roadTimeHours(c.querySelector('[data-field="amount"]').value, c.querySelector('[data-field="unit"]').value); window.__book = A.setRoadTime(window.__book, c.getAttribute('data-a'), c.getAttribute('data-b'), hours); window.__board.closeCard(); draw(); return hours; };
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
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

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
        ground: document.querySelector('.dooms-atlas-map').getAttribute('data-ground'), groundLines: q('path.dooms-atlas-ground'), lands: q('path.dooms-atlas-territory'), realm: q('path.dooms-atlas-realm'), beyond: q('path.dooms-atlas-beyond'), beyondNames: [...document.querySelectorAll('#dooms-atlas .dooms-atlas-beyond-name')].map(x => x.textContent), peaks: q('path.dooms-atlas-peak'), trees: q('path.dooms-atlas-tree'), ponds: q('path.dooms-atlas-pond'), woods: q('path.dooms-atlas-wood'), startShown: (() => { const st = document.querySelector('.dooms-atlas-start'); return !!st && !st.hidden; })(), looseLands: q('path.dooms-atlas-territory.is-loose'), hits: q('path.dooms-atlas-route-hit'), setRoads: q('path.dooms-atlas-route.is-set'), woods: q('path.dooms-atlas-wood'), trees: q('path.dooms-atlas-tree'), ponds: q('path.dooms-atlas-pond'), walls: q('path.dooms-atlas-wall'), passages: q('path.dooms-atlas-passage'), sea: q('path.dooms-atlas-water.is-sea'), mapBg: getComputedStyle(document.querySelector('.dooms-atlas-map')).backgroundColor, groundPick: (document.querySelector('.dooms-atlas-ground-select') || {}).value || '',
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
    check('an empty map shows Start your map in its middle: place them all, or place them yourself', !!start && /Start your map/.test(start.text) && /8 places are waiting/.test(start.text) && /Place all 8 for me/.test(start.text) && start.buttons.join() === 'worldgen,setup,place-all,start-dismiss' && start.centred && start.inside, JSON.stringify(start));
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
    check('the party is marked on its place; no name shows until the pointer is on a marker', /is-player/.test(house.cls) && house.label === false);
    await page.mouse.move(drop.x, drop.y);
    const hovered = await layout();
    check('a marker under the pointer shows its name', hovered.markers["Jordan's House"].label === true);
    await page.mouse.move(700, 5);
    check('the name goes when the pointer leaves', (await layout()).markers["Jordan's House"].label === false);
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

console.log('\n§2b roads drawn by hand (D164)');
{
    check('the tools offer Roads', await page.evaluate(() => !!document.querySelector('.dooms-atlas-tool[data-act="roads"]')));
    const pair = await page.evaluate(() => { const m = window.__model; const linked = (a, b) => m.routes.some(r => (r.a === a && r.b === b) || (r.a === b && r.b === a)); for (const a of m.markers) for (const b of m.markers) if (a.id < b.id && !linked(a.id, b.id)) return [a.id, b.id]; return null; });
    await page.evaluate(() => { window.__events.length = 0; window.__board.update({ picking: true }); });
    const p1 = await spotOf(pair[0]);
    const p2 = await spotOf(pair[1]);
    await page.mouse.click(p1.sx, p1.sy);
    await settle();
    let l = await layout();
    check('with Roads on, a place clicked is picked (ringed) and opens no card', !l.card && Object.values(l.markers).filter(m => /is-picked/.test(m.cls)).length === 1 && (await page.evaluate(() => window.__events.some(e => e[0] === 'pick'))));
    await page.mouse.click(p2.sx, p2.sy);
    await settle();
    l = await layout();
    check('a second place clicked: a road joins the two, and nothing is ringed', l.routes === 8 && Object.values(l.markers).filter(m => /is-picked/.test(m.cls)).length === 0 && (await page.evaluate((pr) => window.__model.routes.some(r => !r.auto && ((r.a === pr[0] && r.b === pr[1]) || (r.a === pr[1] && r.b === pr[0]))), pair)));
    await shot('2b-road-drawn');
    await page.mouse.move(700, 5);
    await page.mouse.click(p1.sx, p1.sy);
    await page.mouse.click(p2.sx, p2.sy);
    await settle();
    l = await layout();
    check('the same two clicked again: their road is taken away', l.routes === 7);
    const auto = await page.evaluate(() => { const r = window.__model.routes.find(x => x.auto); return [r.a, r.b]; });
    const a1 = await spotOf(auto[0]);
    const a2 = await spotOf(auto[1]);
    await page.mouse.click(a1.sx, a1.sy);
    await page.mouse.click(a2.sx, a2.sy);
    await settle();
    l = await layout();
    check('a road the map drew by itself can be taken away too', l.routes === 6 && (await page.evaluate((pr) => window.__book.cut.some(c => c.includes(pr[0]) && c.includes(pr[1])), auto)));
    await page.mouse.click(a1.sx, a1.sy);
    await page.mouse.click(a2.sx, a2.sy);
    await settle();
    check('and drawn back', (await layout()).routes === 7);
    await page.evaluate(() => window.__board.update({ picking: false }));
    await page.mouse.move(700, 5);
    await page.mouse.click(p1.sx, p1.sy);
    await settle();
    check('with Roads off, a place clicked opens its card again', !!(await layout()).card);
    await page.evaluate(() => window.__board.closeCard());
}

console.log('\n§2c the time is the roads\' (D165)');
{
    // The owner's case on a region's map: a city, and a castle the story says is two days out but drawn further.
    const keptBook = await page.evaluate(() => window.__book);    // the campaign as the sections before left it: put back at the end
    await page.evaluate(() => {
        let b = window.A.withScale(null, 'region');
        b = window.A.addPin(b, { label: 'Hask', kind: 'settlement', x: 0, y: 0 }).book;
        b = window.A.addPin(b, { label: 'Redfall Castle', kind: 'stronghold', x: 5, y: 2 }).book;
        b = window.A.addPin(b, { label: 'Lone Tower', kind: 'stronghold', x: -3, y: 4 }).book;
        b = window.A.mergeInto(b, 'loc:jordan-s-house', 'pin:hask');    // the party's place is Hask: distances are told from it
        return window.__open({ world: 'campaign', book: b });
    });
    check('the party stands at Hask on this map', (await page.evaluate(() => window.__model.party)) === 'pin:hask');
    await page.evaluate(() => window.__board.fit());
    await settle();
    let l = await layout();
    check('every road has a line of its own to take a click', l.routes === 2 && l.hits === 2 && l.setRoads === 0);
    await page.evaluate(() => window.__board.show('pin:redfall-castle'));
    await page.waitForTimeout(600);
    l = await layout();
    check('a place joined by road: the card tells the way by road and how long at the pace', /81 miles by road, about 3\.5 days on foot/.test(l.cardText), l.cardText.slice(0, 160));
    await page.evaluate(() => window.__board.closeCard());
    // The road itself clicked: its card.
    const mid = await page.evaluate(() => { const m = window.__model.markers; const a = m.find(x => x.id === 'pin:hask'), b = m.find(x => x.id === 'pin:redfall-castle'); const p = window.__board.map.latLngToContainerPoint([-(a.y + b.y) / 2, (a.x + b.x) / 2]); const box = document.querySelector('.dooms-atlas-map').getBoundingClientRect(); return { x: box.left + p.x, y: box.top + p.y }; });
    await page.mouse.click(mid.x, mid.y);
    await settle();
    l = await layout();
    const fields = await page.evaluate(() => { const c = document.querySelector('.dooms-atlas-card.is-road'); return c ? { amount: c.querySelector('[data-field="amount"]').value, unit: c.querySelector('[data-field="unit"]').value, acts: [...c.querySelectorAll('button[data-act]')].map(b => b.getAttribute('data-act')) } : null; });
    check('a road clicked opens its card: the two places, what it is as drawn, a time to set, Save and Remove', !!fields && /Road/.test(l.cardText) && /Hask.*Redfall Castle|Redfall Castle.*Hask/.test(l.cardText) && /As drawn: 81 miles, about 3\.5 days on foot/.test(l.cardText) && fields.amount === '' && fields.unit === 'days' && fields.acts.join() === 'road-save,road-remove', JSON.stringify(fields));
    check('the road\'s card is inside the screen', l.card.left >= 0 && l.card.right <= VIEW.width && l.card.top >= 0 && l.card.bottom <= VIEW.height);
    await shot('2c-road-card');
    await page.locator('.dooms-atlas-card.is-road [data-field="amount"]').fill('2');
    const saved = await page.evaluate(() => window.__saveRoad());
    await settle();
    l = await layout();
    check('two days set: the road is drawn firmer and no card is left open', saved === 16 && l.setRoads === 1 && !l.card);
    await page.evaluate(() => window.__board.show('pin:redfall-castle'));
    await page.waitForTimeout(600);
    l = await layout();
    check('the place\'s card goes by the set time, and leaves the drawn miles out', /about 2 days by road/.test(l.cardText) && !/81 miles/.test(l.cardText), l.cardText.slice(0, 160));
    await shot('2d-road-set');
    await page.evaluate(() => window.__board.closeCard());
    await page.mouse.click(mid.x, mid.y);
    await settle();
    const again = await page.evaluate(() => { const c = document.querySelector('.dooms-atlas-card.is-road'); return c ? { amount: c.querySelector('[data-field="amount"]').value, unit: c.querySelector('[data-field="unit"]').value, text: c.textContent.replace(/\s+/g, ' ') } : null; });
    check('opened again, the road shows what it was set to', !!again && again.amount === '2' && again.unit === 'days' && /Set to 2 days/.test(again.text), JSON.stringify(again));
    await page.evaluate(() => window.__board.closeCard());
    // No road: across country.
    await page.evaluate(() => { window.__book = window.A.toggleRoad(window.__book, 'pin:hask', 'pin:lone-tower', window.__model); window.__draw(); });
    await page.evaluate(() => window.__board.show('pin:lone-tower'));
    await page.waitForTimeout(600);
    l = await layout();
    check('a place no road reaches: the card says cross-country, and it takes half as long again', /75 miles cross-country, about 4\.5 days on foot/.test(l.cardText), l.cardText.slice(0, 160));
    await page.evaluate(() => window.__board.closeCard());
    const parts = await page.evaluate(() => [window.__roadTime.parts(16), window.__roadTime.parts(3), window.__roadTime.parts(0.25), window.__roadTime.parts(0), window.__roadTime.hours('2', 'days'), window.__roadTime.hours('1,5', 'hours'), window.__roadTime.hours('30', 'minutes'), window.__roadTime.hours('', 'days'), window.__roadTime.hours('-2', 'days')]);
    check('a set time reads back in the unit that suits it, and a figure is read with its unit', JSON.stringify(parts) === JSON.stringify([{ amount: '2', unit: 'days' }, { amount: '3', unit: 'hours' }, { amount: '15', unit: 'minutes' }, { amount: '', unit: '' }, 16, 1.5, 0.5, 0, 0]), JSON.stringify(parts));
    // While a marker waits to be put down, a click on a road puts it there.
    await page.evaluate(() => { window.__events.length = 0; window.__set({ armed: '+' }); document.getElementById('dooms-atlas').classList.add('is-armed'); });
    await page.mouse.click(mid.x, mid.y);
    await settle();
    const ev = await page.evaluate(() => { document.getElementById('dooms-atlas').classList.remove('is-armed'); return window.__events.map(e => e[0]); });
    check('with a marker waiting, a click on a road puts it down and opens no road card', ev.includes('tap') && (await page.evaluate(() => !document.querySelector('.dooms-atlas-card.is-road'))));
    await page.evaluate(() => window.__board.closeCard());
    await page.evaluate((b) => window.__open({ world: 'campaign', book: b }), keptBook);
    await page.evaluate(() => window.__board.fit());
    await settle();
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
    check('on the party\'s own map a card says how far the party is', /(miles|mile)( by road| cross-country|, partly by road)?, about .+ on foot|a few steps away/.test(l.cardText), l.cardText.slice(0, 200));
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
    check('a marker keeps its size after a zoom', near(a.width, z.width, 0.5) && near(a.width, 30, 1) && before.markers['The Iron Inn'].label === false, `${a.width} → ${z.width}`);
    check('the ground is still vectors after a zoom (nothing to pixelate)', after.groundLines === 1 && after.images === 0);
    check('the scale bar follows the zoom', near(after.scale.perPx * 4, before.scale.perPx, before.scale.perPx * 0.01));
    await page.evaluate(() => { const b = window.__board; b.map.setView(b.map.getCenter(), 3.5, { animate: false }); });
    await settle();
    const far = await layout();
    check('far out the places are dots', far.zoom === 'far' && near(far.markers['The Iron Inn'].pin.width, 12, 1), far.zoom);
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
    check('the top map of a region is open country: land all over with woods and ponds, no shore, no island, still no picture', l.ground === 'country' && l.shore === 0 && l.ripples === 0 && l.groundLines === 0 && l.woods > 5 && l.trees === 1 && l.ponds > 0 && l.images === 0 && l.mapBg !== sea && l.groundPick === 'country', `${l.ground} ${l.mapBg} ${sea}`);
    await shot('7a-ground-country');
    // The view is the player's: dragged away from the middle, it stays where it was let go.
    const c0 = await page.evaluate(() => { const c = window.__board.map.getCenter(); return { lat: c.lat, lng: c.lng }; });
    await page.mouse.move(1000, 150);
    await page.mouse.down();
    await page.mouse.move(800, 300, { steps: 5 });
    await page.mouse.move(600, 450, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(900);
    const c1 = await page.evaluate(() => { const c = window.__board.map.getCenter(); const z = window.__board.map.getZoom(); return { lat: c.lat, lng: c.lng, px: Math.pow(2, z) }; });
    await page.waitForTimeout(700);
    const c1b = await page.evaluate(() => { const c = window.__board.map.getCenter(); return { lat: c.lat, lng: c.lng }; });
    check('the map dragged goes where it was dragged (and a little on, as it was flung), and is not pulled back to the middle', (c1.lng - c0.lng) * c1.px >= 390 && (c1.lat - c0.lat) * c1.px >= 290 && Math.abs(c1b.lat - c1.lat) < 0.01 && Math.abs(c1b.lng - c1.lng) < 0.01, `${JSON.stringify(c0)} → ${JSON.stringify(c1)} → ${JSON.stringify(c1b)}`);
    await page.evaluate(() => window.__draw());
    await page.waitForTimeout(300);
    const c2 = await page.evaluate(() => { const c = window.__board.map.getCenter(); return { lat: c.lat, lng: c.lng }; });
    check('and stays there when the map is drawn again (the world moved, a marker changed)', Math.abs(c2.lat - c1.lat) < 0.05 && Math.abs(c2.lng - c1.lng) < 0.05);
    await page.mouse.move(700, 5);
    await page.evaluate(() => window.__board.fit());
    await settle();
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

console.log('\n§5c setting up the world (D159)');
{
    await page.evaluate(() => window.__open({ world: 'campaign' }));
    await settle();
    const start = await page.evaluate(() => (document.querySelector('.dooms-atlas-start-card') || {}).textContent || '');
    check('an empty top map offers Set up this world first, then placing by hand', /Set up this world/.test(start) && start.indexOf('Set up this world') < start.indexOf('Place all'));
    check('the Places tab offers it too, beside the clean-up', await page.evaluate(() => !!document.querySelector('.dooms-atlas-tidy [data-act="setup"]') && !!document.querySelector('.dooms-atlas-tidy [data-act="tidy"]')));
    const panel = () => page.evaluate(() => {
        const c = document.querySelector('.dooms-atlas-setup-card'); if (!c) return null;
        const b = c.getBoundingClientRect(); const stage = document.querySelector('.dooms-atlas-stage').getBoundingClientRect();
        const inside = (el) => { const r = el.getBoundingClientRect(); return r.left >= b.left - 1 && r.right <= b.right + 1; };
        return { text: c.textContent.replace(/\s+/g, ' '), inStage: b.left >= stage.left && b.right <= stage.right && b.top >= 0 && b.bottom <= innerHeight, acts: [...c.querySelectorAll('button[data-act]')].map(x => x.getAttribute('data-act')), rows: c.querySelectorAll('.dooms-atlas-setup-row').length, fit: [...c.querySelectorAll('input, select, textarea, button')].every(inside), depths: [...c.querySelectorAll('.dooms-atlas-setup-row')].map(r => Math.round(r.querySelector('.dooms-atlas-setup-name input').getBoundingClientRect().left - b.left)), guesses: c.querySelectorAll('.dooms-atlas-setup-guess').length, radios: [...c.querySelectorAll('input[type=radio]')].map(x => `${x.value}:${x.checked}`), bar: (c.querySelector('.dooms-atlas-setup-bar span') || { style: {} }).style.width || '' };
    });
    await page.evaluate(() => window.__setup('notes'));
    let p = await panel();
    check('the first step: the notes, how much of the chat to read with what the whole of it costs, Draft', /Your notes/.test(p.text) && /412 messages, 10 requests/.test(p.text) && p.radios.join() === 'recent:true,full:false' && p.acts.join() === 'setup-draft,setup-close' && p.inStage && p.fit, JSON.stringify(p));
    await shot('7e-setup-notes');
    await page.evaluate(() => window.__setup('busy'));
    p = await panel();
    check('while it reads: which part, how far, that nothing changes yet, Stop', /part 4 of 9/.test(p.text) && /Nothing on your map changes/.test(p.text) && p.acts.join() === 'setup-stop' && parseFloat(p.bar) > 20 && parseFloat(p.bar) < 60, JSON.stringify(p));
    await page.evaluate(() => window.__setup('review'));
    p = await panel();
    check('the review: every place a row, indented under what it is inside, the guesses marked', p.rows === 8 && p.guesses === 2 && p.depths[1] > p.depths[0] && p.depths[3] > p.depths[2] && p.depths[4] > p.depths[3] && p.depths[7] === p.depths[0] && /8 places, 2 of them guessed/.test(p.text), JSON.stringify(p.depths));
    check('it says Apply replaces the map and how much is on it, and offers Apply, Back and Cancel', /Apply replaces the map this chat has now \(8 places\)/.test(p.text) && /Not places, to be deleted/.test(p.text) && p.acts.filter(a => a !== 'setup-remove').join() === 'setup-apply,setup-back,setup-close' && p.inStage && p.fit);
    await shot('7f-setup-review');
    await page.evaluate(() => window.__applySetup());
    await settle();
    let l = await layout();
    check('applied: the top map holds Hask and the road, placed, nothing waiting', l.count === 2 && !!l.markers['Hask'] && !!l.markers['The Old Road'] && l.tray.length <= 5 && l.ground === 'country');
    const road = await spotOf(await page.evaluate(() => window.__ids['old road']));
    const hask = await spotOf(await page.evaluate(() => window.__ids['hask']));
    check('the road lies south of Hask, as the draft said', road.sy > hask.sy + 40 && Math.abs(road.sx - hask.sx) < 30);
    await page.evaluate(() => window.__layer(window.__ids['hask']));
    await settle();
    l = await layout();
    check('inside Hask: its three places on streets, already placed', l.count === 3 && l.ground === 'city' && !!l.markers['The Temple'] && /Hask/.test(l.trail));
    await shot('7g-setup-applied-hask');
    // Filling out the map inside Hask (D160).
    check('the Places tab offers Fill out this map', await page.evaluate(() => !!document.querySelector('.dooms-atlas-tidy [data-act="fill"]')));
    await page.evaluate(() => window.__fill('ask'));
    p = await panel();
    check('fill out: what the player wants more of, how many, Suggest', /Fill out Hask/.test(p.text) && /What do you want more of/.test(p.text) && /not canon/.test(p.text) && p.acts.join() === 'fill-draft,setup-close' && p.inStage && p.fit);
    await page.evaluate(() => window.__fill('review'));
    p = await panel();
    const fillRows = await page.evaluate(() => document.querySelectorAll('.dooms-atlas-fill-row').length);
    check('the suggestions: each with its name, kind and note, to keep or leave out', fillRows === 4 && /Suggestions for Hask/.test(p.text) && /fighting pit/.test(p.text) && p.acts.filter(a => a !== 'fill-remove').join() === 'fill-apply,fill-again,setup-close' && p.inStage && p.fit);
    await shot('7i-fill-review');
    const beforeFill = await page.evaluate(() => window.__model.markers.map(m => [m.id, m.x, m.y]));
    await page.evaluate(() => window.__applyFill());
    await settle();
    l = await layout();
    const afterFill = await page.evaluate(() => window.__model.markers.map(m => [m.id, m.x, m.y]));
    check('added: four more markers ringed as not canon, the three already there where they were', l.count === 7 && Object.values(l.markers).filter(m => /is-loose/.test(m.cls)).length === 4 && beforeFill.every(b => afterFill.some(a => a[0] === b[0] && a[1] === b[1] && a[2] === b[2])));
    await page.evaluate(() => window.__board.show(window.__model.markers.find(m => m.label === 'The Pit').id));
    await page.waitForTimeout(600);
    l = await layout();
    check('its card says it is not canon and offers to make it so', /Not canon/.test(l.cardText) && /Make it canon/.test(l.cardText) && /fighting pit/.test(l.cardText));
    await shot('7j-fill-applied');
    await page.evaluate(() => window.__board.closeCard());
    await page.evaluate(() => window.__layer(window.__ids['black stair']));
    await settle();
    l = await layout();
    check('inside the stair: its landings, underground', l.count === 2 && l.ground === 'underground' && /Hask.*The Temple.*The Black Stair/.test(l.trail));
    await shot('7h-setup-applied-stair');
}

console.log('\n§5d territories: regions as lands that share borders, clicked to enter (D163)');
{
    // The owner's world: a city and a castle two days out, on the top map.
    await page.evaluate(() => { let b = window.A.addPin(null, { label: 'Hask', kind: 'settlement', x: 0, y: 0 }).book; b = window.A.addPin(b, { label: 'Redfall Castle', kind: 'stronghold', x: 2.5, y: 1.5 }).book; return window.__open({ world: 'campaign', book: b }); });
    await settle();
    check('a map of pins offers Group into a region', await page.evaluate(() => !!document.querySelector('.dooms-atlas-tidy [data-act="group"]')));
    await page.evaluate(() => { const r = window.A.wrapInRegion(window.__book, window.__model, { label: 'The Haskmarch' }); window.__book = r.book; window.__region = r.id; window.__draw(); window.__board.fit(); });
    await settle();
    let l = await layout();
    check('grouped: the top map is one land, the city and the castle inside it', l.lands === 1 && l.count === 1 && /is-territory/.test(Object.values(l.markers)[0].cls) && l.routes === 0 && (await page.evaluate(() => window.__model.measure.scale)) === 'region');
    check('a map that holds a region no longer offers to group', await page.evaluate(() => !document.querySelector('.dooms-atlas-tidy [data-act="group"]')));
    // Neighbours, as Fill out this map would add them: regions, not canon.
    await page.evaluate(() => {
        const reply = JSON.stringify({ places: [
            { name: 'The Grey Forest', kind: 'wild', note: 'Old woods where the road gives out.', near: [{ to: 'The Haskmarch', dir: 'e', far: 'near' }] },
            { name: 'The Salt Fens', kind: 'region', note: 'Brackish marsh and reed-cutters.', near: [{ to: 'The Haskmarch', dir: 'n', far: 'near' }] },
            { name: 'Redfall Heights', kind: 'region', note: 'Cold uplands above the castle.', near: [{ to: 'The Haskmarch', dir: 'w', far: 'near' }] },
            { name: 'The Amber Waste', kind: 'region', note: 'Dry country nobody claims.', near: [{ to: 'The Haskmarch', dir: 's', far: 'near' }] },
            { name: 'Kessel Vale', kind: 'region', note: 'Farmland and a toll road.', near: [{ to: 'The Grey Forest', dir: 's', far: 'near' }] },
        ] });
        const places = window.S.parseFill(reply, window.__model).places;
        window.__fillKinds = places.map(p => p.kind);
        window.__book = window.S.applyFill(window.__book, window.__model, places).book;
        window.__draw(); window.__board.fit();
    });
    await settle();
    l = await layout();
    check('filled out: six lands, the five new ones not canon, every new place a region whatever the reply called it', l.lands === 6 && l.looseLands === 5 && (await page.evaluate(() => window.__fillKinds.every(k => k === 'region'))));
    const geo = await page.evaluate(() => {
        const t = window.__model.territories;
        const inside = (poly, [x, y]) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, yi] = poly[i], [xj, yj] = poly[j]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c; } return c; };
        const own = t.every(a => inside(a.outline, [a.x, a.y]) && t.every(b => a === b || !inside(a.outline, [b.x, b.y])));
        const fills = new Set([...document.querySelectorAll('path.dooms-atlas-territory')].map(p => getComputedStyle(p).fill));
        return { own, fills: fills.size, shared: t.filter(a => a.neighbours.length > 0).length };
    });
    check('each land holds its own spot and no other\'s; the lands border one another, each in a shade of its own', geo.own && geo.shared === 6 && geo.fills === 6, JSON.stringify(geo));
    await shot('7k-territories');
    // Hover names the land; a click enters it.
    const mid = await page.evaluate(() => { const t = window.__model.territories.find(x => x.label === 'The Salt Fens'); const p = window.__board.map.latLngToContainerPoint([-(t.y - 1.2), t.x + 1.2]); const box = document.querySelector('.dooms-atlas-map').getBoundingClientRect(); return { x: box.left + p.x, y: box.top + p.y }; });
    await page.mouse.move(mid.x, mid.y);
    await page.waitForTimeout(250);
    const tip = await page.evaluate(() => (document.querySelector('.dooms-atlas-territory-name') || {}).textContent || '');
    check('a land under the pointer names itself', tip === 'The Salt Fens', tip);
    await shot('7l-territory-hover');
    await page.evaluate(() => { window.__events.length = 0; });
    await page.mouse.click(mid.x, mid.y);
    await settle();
    l = await layout();
    check('a land clicked is entered: its own map, a region\'s, on open country, with the trail back', (await page.evaluate(() => window.__events.some(e => e[0] === 'enter'))) && /The Salt Fens/.test(l.trail) && l.ground === 'country' && l.lands === 0 && (await page.evaluate(() => window.__model.measure.scale)) === 'region');
    await page.evaluate(() => window.__layer(window.__region));
    await settle();
    l = await layout();
    check('inside the first region: the city and the castle as pins, where they were', l.count === 2 && !!l.markers['Hask'] && !!l.markers['Redfall Castle'] && l.lands === 0);
    await page.evaluate(() => window.__layer(''));
    await settle();
    // The land's own marker (its standard) opens its card; so does a right-click on the land.
    await page.locator('#dooms-atlas .dooms-atlas-marker.is-territory', { hasText: 'The Haskmarch' }).locator('.dooms-atlas-standard').click();
    await settle();
    l = await layout();
    check('a land\'s standard opens its card: a region, what is inside (the two pins and the eight places that waited), Enter and the tools', /The Haskmarch/.test(l.cardText) && /Regions · 10 places inside/.test(l.cardText) && /Enter \(10 places inside\)/.test(l.cardText) && /Edit.*Merge.*Move.*Take off.*Delete/.test(l.cardText), l.cardText.slice(0, 200));
    await page.evaluate(() => window.__board.closeCard());
    await page.mouse.click(mid.x, mid.y, { button: 'right' });
    await settle();
    l = await layout();
    check('a right-click on a land opens its card too, with the mark that it is not canon', /The Salt Fens/.test(l.cardText) && /Not canon/.test(l.cardText) && /reed-cutters/.test(l.cardText));
    await page.evaluate(() => window.__board.closeCard());
    // While something waits to be put down, a click on a land puts it there instead of entering.
    await page.evaluate(() => { window.__events.length = 0; window.__set({ armed: '+' }); document.getElementById('dooms-atlas').classList.add('is-armed'); });
    await page.mouse.click(mid.x, mid.y);
    await settle();
    const armedEvents = await page.evaluate(() => { document.getElementById('dooms-atlas').classList.remove('is-armed'); return window.__events.map(e => e[0]); });
    check('with a marker waiting, a click on a land puts it down and does not enter', armedEvents.includes('tap') && !armedEvents.includes('enter') && (await page.evaluate(() => window.__model.markers.some(m => m.label === 'New place'))));
    await page.evaluate(() => window.__board.closeCard());
}

console.log('\n§5e regions always border one another; Fill out with regions; a place put on a land (D166)');
{
    // The owner's map as he reported it: places on the top map, and regions a fill had added standing apart from one another.
    await page.evaluate(() => {
        let b = window.A.withScale(null, 'region');
        for (const [label, kind, x, y] of [['Hask', 'settlement', 0, 0], ['Redfall Castle', 'stronghold', 4, 2], ['Mirefen Ferry', 'water', -3, -2], ['The Ashwood', 'wild', -3, 1]]) b = window.A.addPin(b, { label, kind, x, y }).book;
        for (const [label, x, y] of [['The Amber Waste', 16, -9], ['The Salt Fens', -4, 15], ['Kessel Vale', -17, -6], ['Redfall Heights', 5, -17]]) b = window.A.addPin(b, { label, kind: 'region', x, y, loose: true }).book;
        return window.__open({ world: 'campaign', book: b });
    });
    await page.evaluate(() => window.__board.fit());
    await settle();
    let l = await layout();
    const touching = () => page.evaluate(() => { const t = window.__model.territories; return t.length > 1 && t.every(a => a.neighbours.length >= 1 && a.neighbours.every(n => t.find(o => o.id === n).neighbours.includes(a.id))); });
    const shades = () => page.evaluate(() => { const fills = [...document.querySelectorAll('path.dooms-atlas-territory')].map(p => getComputedStyle(p).fill); return { each: new Set(fills).size === fills.length, n: fills.length, model: window.__model.territories.every(t => t.neighbours.every(n => window.__model.territories.find(o => o.id === n).fill !== t.fill)) }; });
    check('four regions that stood far apart now border one another: no land stands alone', l.lands === 4 && (await touching()));
    check('each land is drawn in a shade of its own, and no land shares its neighbour\'s (D167)', (await shades()).each && (await shades()).model && (await shades()).n === 4, JSON.stringify(await shades()));
    check('a land clicked is not left with a box drawn round it', await page.evaluate(() => { const p = document.querySelector('path.dooms-atlas-territory'); p.focus(); const o = getComputedStyle(p); return o.outlineStyle === 'none' || o.outlineWidth === '0px'; }));
    const mixedWord = await page.evaluate(() => (document.querySelector('.dooms-atlas-mixed') || {}).textContent || '');
    check('with regions and places side by side, the Places tab says so and offers Group into a region', /regions and places side by side/.test(mixedWord) && (await page.evaluate(() => !!document.querySelector('.dooms-atlas-tidy [data-act="group"]'))));
    await shot('7m-mixed-before');
    await page.evaluate(() => { const r = window.A.wrapInRegion(window.__book, window.__model, { label: 'The Haskmarch' }); window.__book = r.book; window.__homeId = r.id; window.__draw(); window.__board.fit(); });
    await settle();
    l = await layout();
    check('grouped: five lands and nothing else on the map; every land borders a neighbour; the word and the button are gone', l.lands === 5 && l.count === 5 && Object.values(l.markers).every(m => /is-territory/.test(m.cls)) && (await touching()) && (await page.evaluate(() => !document.querySelector('.dooms-atlas-mixed') && !document.querySelector('.dooms-atlas-tidy [data-act="group"]'))));
    check('the home region\'s land is where its places were, and they are inside it', (await page.evaluate(() => window.A.territoryAt(window.__model, 0, 0) === window.__homeId)) && (await page.evaluate(() => window.__model.all.filter(x => x.layer === window.__homeId && x.placed).length)) === 4);
    await shot('7n-regions-bordering');

    // Fill out with regions, from a map of places: the owner's first step done right.
    await page.evaluate(() => {
        let b = window.A.withScale(null, 'region');
        for (const [label, kind, x, y] of [['Hask', 'settlement', 0, 0], ['Redfall Castle', 'stronghold', 4, 2], ['Mirefen Ferry', 'water', -3, -2]]) b = window.A.addPin(b, { label, kind, x, y }).book;
        return window.__open({ world: 'campaign', book: b });
    });
    await settle();
    const fo = await page.evaluate(() => window.__fillRegions('ask'));
    let p = await page.evaluate(() => { const c = document.querySelector('.dooms-atlas-setup-card'); return { text: c.textContent.replace(/\s+/g, ' '), radios: [...c.querySelectorAll('input[name="dooms-atlas-fill-what"]')].map(x => `${x.value}:${x.checked}`) }; });
    check('Fill out on a map of places asks what to add: places here, or neighbouring regions', fo.options.join() === 'places,regions' && fo.home === true && p.radios.join() === 'places:true,regions:false' && /Neighbouring regions/.test(p.text) && /go inside a region of their own first/.test(p.text), JSON.stringify(p.radios));
    await shot('7o-fill-what');
    await page.evaluate(() => window.__fillRegions('review', JSON.stringify({ home: 'The Haskmarch', places: [
        { name: 'Redfall Heights', note: 'Cold uplands above the castle.', near: [{ to: 'home', dir: 's', far: 'near' }] },
        { name: 'The Salt Fens', note: 'Brackish marsh and reed-cutters.', near: [{ to: 'home', dir: 'n', far: 'near' }] },
        { name: 'The Amber Waste', note: 'Dry country nobody claims.', near: [{ to: 'home', dir: 'w', far: 'near' }] },
        { name: 'Kessel Vale', note: 'Farmland and a toll road.', near: [{ to: 'home', dir: 'e', far: 'near' }] },
    ] })));
    p = await page.evaluate(() => { const c = document.querySelector('.dooms-atlas-setup-card'); const b = c.getBoundingClientRect(); return { text: c.textContent.replace(/\s+/g, ' '), home: (c.querySelector('.dooms-atlas-fill-home') || {}).value || '', rows: c.querySelectorAll('.dooms-atlas-fill-row').length, kinds: c.querySelectorAll('.dooms-atlas-fill-row select').length, inside: b.top >= 0 && b.bottom <= innerHeight }; });
    check('the review names the home region (to rename) and lists the regions around it, with no kind to pick', p.home === 'The Haskmarch' && p.rows === 4 && p.kinds === 0 && /Regions around The Haskmarch/.test(p.text) && /the 11 places on this map go inside/.test(p.text) && /dashed border/.test(p.text) && p.inside, JSON.stringify(p));
    await shot('7p-fill-regions-review');
    await page.locator('.dooms-atlas-fill-home').fill('The Hask Marches');
    await page.evaluate(() => window.__applyFillRegions());
    await settle();
    l = await layout();
    check('added: the map is five lands that border one another, the home region under the name typed', l.lands === 5 && l.count === 5 && l.looseLands === 5 && (await touching()) && (await page.evaluate(() => window.__model.markers.find(m => m.id === window.__homeId).label)) === 'The Hask Marches');
    check('the places are inside the home region where they were', (await page.evaluate(() => { const m = window.A.atlasModel({ pack: window.__pack, book: window.__book, layer: window.__homeId }); return JSON.stringify(m.markers.map(x => [x.label, x.x, x.y])); })) === JSON.stringify([['Hask', 0, 0], ['Redfall Castle', 4, 2], ['Mirefen Ferry', -3, -2]]));
    await shot('7q-fill-regions-applied');
    check('a map of regions is then filled with regions only', (await page.evaluate(() => window.S.fillOptions(window.__model).options.join())) === 'regions');

    // A place from the list dropped on a land goes inside that region.
    const target = await page.evaluate(() => { const t = window.__model.territories.find(x => x.label === 'The Salt Fens'); const p = window.__board.map.latLngToContainerPoint([-t.y, t.x + 1.5]); const box = document.querySelector('.dooms-atlas-map').getBoundingClientRect(); return { x: box.left + p.x, y: box.top + p.y, id: t.id }; });
    const hadTray = (await layout()).tray.length;
    if (hadTray === 0) await page.evaluate(() => { window.__book = window.A.addPin({ ...window.__book }, { label: 'Reedcutters\' Landing', x: NaN, y: NaN }).book; const made = window.__book.made[window.__book.made.length - 1]; delete window.__book.spots[made.id]; window.__draw(); });
    const row = await page.evaluate(() => (document.querySelector('.dooms-atlas-tray-row .dooms-atlas-row-name') || {}).textContent || '');
    await page.evaluate(({ x, y }) => {
        const r = document.querySelector('.dooms-atlas-tray-row');
        const dt = new DataTransfer();
        r.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
        const map = document.querySelector('.dooms-atlas-map');
        map.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: x, clientY: y }));
    }, target);
    await settle();
    l = await layout();
    const dropped = await page.evaluate(() => window.__events.filter(e => e[0] === 'drop').pop());
    check('a place dropped on a land goes inside that region, not onto the map of regions', !!row && dropped[3] === target.id && l.count === 5 && !l.tray.includes(row) && (await page.evaluate((nm) => { const it = window.__model.all.find(x => x.label === nm); return !!it && it.layer; }, row)) === target.id, `${row} ${JSON.stringify(dropped)}`);
}

console.log('\n§5f inside a region: its land, its neighbours named on the borders, its terrain (D168)');
{
    // The owner's world, a step on: his city and castle in their region, and the regions a fill put around it.
    await page.evaluate(() => {
        let b = window.A.withScale(null, 'region');
        for (const [label, kind, x, y] of [['Hask', 'settlement', 0, 0], ['Redfall Castle', 'stronghold', 3.2, 1.2], ['Mirefen Ferry', 'water', -2.4, -1.6]]) b = window.A.addPin(b, { label, kind, x, y }).book;
        const g = window.A.wrapInRegion(b, window.A.atlasModel({ pack: window.__pack || null, book: b }), { label: 'The Haskmarch' });
        b = g.book;
        window.__lands = {};
        for (const [label, x, y] of [['The Amber Waste', 10, -5], ['The Salt Fens', -3, 10], ['Kessel Vale', -11, -3], ['Redfall Heights', 3, -10], ['The Greywood Forest', 11, 6], ['Iron Peaks', -9, 8]]) { const r = window.A.addPin(b, { label, kind: 'region', x, y, loose: true }); b = r.book; window.__lands[label] = r.id; }
        window.__home = g.id;
        return window.__open({ world: 'campaign', book: b });
    });
    await page.evaluate(() => window.__board.fit());
    await settle();
    const topFill = await page.evaluate(() => window.__model.territories.find(t => t.id === window.__home).fill);
    // The land clicked on the map of regions (clear of its standard): the map inside it.
    const at = await page.evaluate(() => { const t = window.__model.territories.find(x => x.id === window.__home); const p = window.__board.map.latLngToContainerPoint([-(t.y + 1.6), t.x + 1.4]); const box = document.querySelector('.dooms-atlas-map').getBoundingClientRect(); return { x: box.left + p.x, y: box.top + p.y }; });
    await page.mouse.click(at.x, at.y);
    await settle();
    let l = await layout();
    const seen = () => page.evaluate(() => {
        const m = window.__model, map = window.__board.map;
        const box = document.querySelector('.dooms-atlas-map').getBoundingClientRect();
        const path = document.querySelector('path.dooms-atlas-realm');
        const r = path ? path.getBoundingClientRect() : null;
        const names = [...document.querySelectorAll('#dooms-atlas .dooms-atlas-beyond-name')].map(el => { const b = el.getBoundingClientRect(); const n = m.realm.neighbours.find(x => x.label === el.textContent); const p = n ? map.latLngToContainerPoint([-n.at[1], n.at[0]]) : null; return { text: el.textContent, off: p ? Math.hypot(b.left + b.width / 2 - box.left - p.x, b.top + b.height / 2 - box.top - p.y) : 999, turned: getComputedStyle(el).transform !== 'none' }; });
        return {
            realm: m.realm ? { id: m.realm.id, k: m.realm.k, n: m.realm.neighbours.map(x => x.label).sort() } : null,
            fill: path ? path.getAttribute('fill') : '', box: r ? { w: r.width, h: r.height, in: r.left >= box.left - 1 && r.right <= box.right + 1 && r.top >= box.top - 1 && r.bottom <= box.bottom + 1 } : null, map: { w: box.width, h: box.height },
            zoom: map.getZoom(), min: map.getMinZoom(), names, peaks: m.decor.peaks ? m.decor.peaks.length : -1,
            onLand: m.markers.every(x => window.A.pointInPolygon(m.realm ? m.realm.outline : [], x.x, x.y)),
        };
    });
    let v = await seen();
    check('the land clicked is entered: one land drawn in the shape and the colour it has on the map above, no map of lands', (await page.evaluate(() => window.__events.some(e => e[0] === 'enter' && e[1] === window.__home))) && /The Haskmarch/.test(l.trail) && l.realm === 1 && l.lands === 0 && v.realm.id === (await page.evaluate(() => window.__home)) && v.realm.k === 1 && v.fill === topFill && l.ground === 'country', JSON.stringify(v.realm));
    check('the view is fitted to the land: all of it on screen, filling most of the map', v.box.in && Math.max(v.box.w / v.map.w, v.box.h / v.map.h) > 0.6 && v.zoom > v.min, JSON.stringify([v.box, v.map, v.zoom, v.min]));
    check('its places stand on it as pins, where they were, joined by their roads', l.count === 3 && !!l.markers['Hask'] && !!l.markers['Redfall Castle'] && !!l.markers['Mirefen Ferry'] && v.onLand && l.routes === 2);
    check('the six lands it borders lie around it, dimmed, each named on the border it shares', l.beyond === 6 && same(v.realm.n, ['Iron Peaks', 'Kessel Vale', 'Redfall Heights', 'The Amber Waste', 'The Greywood Forest', 'The Salt Fens']) && same([...l.beyondNames].sort(), v.realm.n) && v.names.every(n => n.off < 26), JSON.stringify(v.names));
    check('a name runs the way its border runs', v.names.filter(n => n.turned).length >= 4);
    check('its terrain is drawn across it: woods with their trees, and each peak a shape of its own', l.woods >= 2 && l.trees === 1 && l.peaks === v.peaks && l.groundLines === 0, JSON.stringify([l.woods, l.trees, l.peaks, v.peaks]));
    check('no panel is laid over a region\'s land', !l.startShown);
    await shot('7r-inside-region');

    // A neighbour under the pointer names itself; its name on the border is clicked to go there.
    const beside = (label, px) => page.evaluate(({ label, px }) => { const m = window.__model, map = window.__board.map; const n = m.realm.neighbours.find(x => x.label === label); const rad = n.angle * Math.PI / 180; const p = map.latLngToContainerPoint([-n.at[1], n.at[0]]); const box = document.querySelector('.dooms-atlas-map').getBoundingClientRect(); return { x: box.left + p.x - Math.sin(rad) * n.side * px, y: box.top + p.y + Math.cos(rad) * n.side * px, id: n.id }; }, { label, px });
    const fens = await beside('The Salt Fens', 70);
    await page.mouse.move(fens.x, fens.y);
    await page.waitForTimeout(250);
    check('a neighbouring land under the pointer names itself', (await page.evaluate(() => (document.querySelector('.dooms-atlas-territory-name') || {}).textContent || '')) === 'The Salt Fens');
    await shot('7s-neighbour-hover');
    await page.evaluate(() => { window.__events.length = 0; });
    await page.locator('#dooms-atlas .dooms-atlas-beyond-name', { hasText: 'Iron Peaks' }).click();
    await settle();
    l = await layout();
    v = await seen();
    check('a neighbour\'s name clicked goes there: its own land, the region left behind now one of its neighbours', (await page.evaluate(() => window.__events.some(e => e[0] === 'enter' && e[1] === window.__lands['Iron Peaks']))) && /Iron Peaks/.test(l.trail) && !/Haskmarch/.test(l.trail) && l.realm === 1 && v.realm.n.includes('The Haskmarch') && l.beyondNames.includes('The Haskmarch'));
    check('a land of mountains is drawn with its ranges; nothing stands on it yet, and the line says so with no panel over the land', l.peaks >= 12 && l.count === 0 && !l.startShown && /Nothing stands in Iron Peaks yet/.test(l.hint), `${l.peaks} ${l.hint}`);
    check('the view is fitted to the new land', v.box.in && Math.max(v.box.w / v.map.w, v.box.h / v.map.h) > 0.6, JSON.stringify(v.box));
    await shot('7t-mountains');
    // A neighbouring land itself is clicked to go there too.
    const wood = await beside('The Haskmarch', 60);
    await page.evaluate(() => { window.__events.length = 0; });
    await page.mouse.click(wood.x, wood.y);
    await settle();
    l = await layout();
    check('a neighbouring land clicked goes there', (await page.evaluate(() => window.__events.some(e => e[0] === 'enter' && e[1] === window.__home))) && /The Haskmarch/.test(l.trail) && l.count === 3);
    // While something waits to be put down, a click on a neighbour puts it down on this map and goes nowhere.
    const waste = await beside('The Amber Waste', 60);
    await page.evaluate(() => { window.__events.length = 0; window.__set({ armed: '+' }); document.getElementById('dooms-atlas').classList.add('is-armed'); });
    await page.mouse.click(waste.x, waste.y);
    await settle();
    const armed = await page.evaluate(() => { document.getElementById('dooms-atlas').classList.remove('is-armed'); return window.__events.map(e => e[0]); });
    v = await seen();
    check('with a marker waiting, a click on a neighbour puts it down and goes nowhere; the land is drawn wider to hold it', armed.includes('tap') && !armed.includes('enter') && (await page.evaluate(() => window.__model.layer === window.__home && window.__model.markers.some(m => m.label === 'New place'))) && v.realm.k > 1 && v.onLand, JSON.stringify(v.realm));
    await page.evaluate(() => window.__board.closeCard());

    // The other terrains, each its own land.
    for (const [name, file, test] of [['The Greywood Forest', '7u-forest', (m) => m.trees > 160 && m.woods >= 5], ['The Salt Fens', '7v-fens', (m) => m.ponds >= 3 && m.marks > 20], ['The Amber Waste', '7w-desert', (m) => m.marks >= 10 && m.woods === 0]]) {
        await page.evaluate((nm) => window.__layer(window.__lands[nm]), name);
        await settle();
        const m = await page.evaluate(() => { const d = window.__model.decor; return { trees: d.trees.length, woods: d.woods.length, ponds: d.ponds.length, marks: d.marks.length, peaks: d.peaks.length, look: d.look, paths: document.querySelectorAll('.dooms-atlas-map svg path').length }; });
        check(`${name}: drawn as its name tells (${m.look}), in few shapes`, test(m) && m.paths < 120, JSON.stringify(m));
        await shot(file);
    }

    // A region whose places were laid out before its land was there, and wider than it: the land is laid under them.
    await page.evaluate(() => {
        let b = window.A.withScale(null, 'region');
        const made = {};
        for (const [label, x, y] of [['The Haskmarch', 14, -3], ['Kessel Vale', 3, -4], ['The Salt Fens', 12, 8], ['Redfall Heights', 22, 4]]) { const r = window.A.addPin(b, { label, kind: 'region', x, y }); b = r.book; made[label] = r.id; }
        for (const [label, kind, x, y] of [['Hask', 'settlement', 0, 0], ['Redfall Castle', 'stronghold', 9, 3], ['Mirefen Ferry', 'water', -8, -5], ['The Ashwood', 'wild', -3, 6], ['Tollgate', 'landmark', 5, -7]]) b = window.A.addPin(b, { label, kind, x, y, layer: made['The Haskmarch'] }).book;
        const lost = window.A.addPin(b, { label: 'Reedcutters\' Landing' }); b = window.A.unplace(lost.book, lost.id);
        window.__home = made['The Haskmarch'];
        return window.__open({ world: 'campaign', book: b });
    });
    await page.evaluate(() => window.__layer(window.__home));
    await settle();
    l = await layout();
    v = await seen();
    check('places laid out off the land and wider than it: the land is laid under them and drawn wide enough to hold them all', v.realm.k > 1 && v.onLand && l.count === 5 && l.beyond === 3 && v.box.in, JSON.stringify(v.realm));
    await shot('7x-land-laid-under');
    // From the map above, a place dropped on that land goes to the matching spot of it inside.
    await page.evaluate(() => window.__layer(''));
    await settle();
    const drop = await page.evaluate(() => { const t = window.__model.territories.find(x => x.id === window.__home); const p = window.__board.map.latLngToContainerPoint([-(t.y + 1.5), t.x - 1]); const box = document.querySelector('.dooms-atlas-map').getBoundingClientRect(); return { x: box.left + p.x, y: box.top + p.y, at: [t.x - 1, t.y + 1.5] }; });
    await page.evaluate(({ x, y }) => {
        const r = [...document.querySelectorAll('.dooms-atlas-tray-row')].find(el => /Reedcutters/.test(el.textContent));
        const dt = new DataTransfer();
        r.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
        document.querySelector('.dooms-atlas-map').dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: x, clientY: y }));
    }, drop);
    await settle();
    const landed = await page.evaluate((at) => { const inner = window.A.atlasModel({ pack: window.__pack, book: window.__book, layer: window.__home }); const m = inner.markers.find(x => /Reedcutters/.test(x.label)); if (!m) return null; const back = [(m.x - inner.realm.dx) / inner.realm.k, (m.y - inner.realm.dy) / inner.realm.k]; return { on: window.A.pointInPolygon(inner.realm.outline, m.x, m.y), off: Math.hypot(back[0] - at[0], back[1] - at[1]), k: inner.realm.k, same: m.x === at[0] && m.y === at[1] }; }, drop.at);
    check('a place dropped on a land that is laid wider inside lands on the matching spot of it, not on the same numbers', !!landed && landed.on && landed.k > 1 && landed.off < 0.6 && !landed.same, JSON.stringify(landed));
}

console.log('\n§5g playing the story as scenes: the way in and its panel (D172)');
{
    await page.evaluate(() => {
        let b = window.A.withScale(null, 'region');
        for (const [label, kind, x, y] of [['Hask', 'settlement', 0, 0], ['Redfall Castle', 'stronghold', 3.2, 1.2]]) b = window.A.addPin(b, { label, kind, x, y }).book;
        return window.__open({ world: 'campaign', book: b });
    });
    await settle();
    const foot = await page.evaluate(() => { const b = document.querySelector('.dooms-atlas-foot [data-act="scenes"]'); const f = document.querySelector('.dooms-atlas-foot'); const r = b ? b.getBoundingClientRect() : null; const fr = f.getBoundingClientRect(); return b ? { text: b.textContent.trim(), in: r.left >= fr.left && r.right <= fr.right + 1 && r.bottom <= innerHeight + 1 } : null; });
    check('the sidebar\'s foot offers Play as scenes, inside the sidebar', !!foot && foot.text === 'Play as scenes' && foot.in, JSON.stringify(foot));
    const plan = { ok: true, reason: '', world: { id: 'first-descent', name: 'First Descent', made: true }, campaign: { id: 'camp1', name: 'First Descent' }, card: { avatar: 'The Redward.png', name: 'The Redward' }, replaces: false, scenes: 0 };
    const panel = () => page.evaluate(() => { const c = document.querySelector('.dooms-atlas-setup-card'); if (!c) return null; const b = c.getBoundingClientRect(); return { text: c.textContent.replace(/\s+/g, ' ').trim(), acts: [...c.querySelectorAll('[data-act]')].map(x => `${x.getAttribute('data-act')}${x.disabled ? ':off' : ''}`), inside: b.top >= 0 && b.bottom <= innerHeight && b.left >= 0 && b.right <= innerWidth, recap: (c.querySelector('.dooms-atlas-scenes-recap') || {}).value, tick: !!c.querySelector('.dooms-atlas-scenes-replace') }; });
    await page.evaluate((p) => window.__scenes({ step: 'ask', plan: p, messages: 412 }), plan);
    let v = await panel();
    check('the panel says what will happen before anything does: the world made under the campaign\'s name, the narrator, what becomes the memory, the chat kept', /Play First Descent as scenes/.test(v.text) && /A world named First Descent is made for the campaign First Descent/.test(v.text) && /your map and the places the story has named stay exactly as they are/.test(v.text) && /The Redward narrates its scenes/.test(v.text) && /the canon, the hooks and the map/.test(v.text) && /kept as scene 0/.test(v.text) && /last forty messages of 412/.test(v.text) && /A copy of the chat as it is now is saved beside it first\. If the copy cannot be saved, nothing is changed\./.test(v.text) && v.acts.join() === 'scenes-prepare,setup-close' && v.inside, JSON.stringify(v));
    await shot('7y-scenes-ask');
    await page.evaluate((p) => window.__scenes({ step: 'busy', plan: p }), plan);
    v = await panel();
    check('while the record is written the panel says so and offers nothing to press', /Writing the record of the chat so far/.test(v.text) && v.acts.length === 0);
    await page.evaluate((p) => window.__scenes({ step: 'review', plan: p, recap: 'The company came up from the Fourth Landing with the inkstone; Kiyoha walked out on her own feet.' }), plan);
    v = await panel();
    check('the record is shown to read and correct, with Play as scenes', v.recap.startsWith('The company came up') && /the first scene is told this/.test(v.text) && v.acts.join() === 'scenes-go,scenes-again,setup-close' && !v.tick && v.inside, JSON.stringify(v.acts));
    await shot('7z-scenes-review');
    await page.evaluate((p) => window.__scenes({ step: 'review', plan: { ...p, world: { ...p.world, made: false }, replaces: true, scenes: 3 }, recap: 'x', error: 'The record could not be written (the connection dropped). Write a few lines yourself, or leave it empty.' }), plan);
    v = await panel();
    check('a world already played as scenes: the panel warns that its memory is replaced and holds Play as scenes until the box is ticked; a record that failed says so', /already played as scenes \(3 played\)/.test(v.text) && /replaces what it remembers/.test(v.text) && v.tick && v.acts[0] === 'scenes-go:off' && /could not be written \(the connection dropped\)/.test(v.text));
    await page.evaluate((p) => window.__scenes({ step: 'review', plan: { ...p, replaces: true, scenes: 3 }, recap: 'x', replace: true }), plan);
    check('ticked, it can be pressed', (await panel()).acts[0] === 'scenes-go');
    await page.evaluate((p) => window.__scenes({ step: 'done', plan: p, result: { ok: true, worldId: 'first-descent', worldName: 'First Descent', made: true, card: 'The Redward', replaced: false, backup: 'The Redward - 2026-10-01@20h00m - before scenes' } }), plan);
    v = await panel();
    check('done: it says so, names the copy that was saved of the chat as it was, and says how the first scene is started', /First Descent is played as scenes/.test(v.text) && /kept as scene 0/.test(v.text) && /each scene opens on your map/.test(v.text) && /A copy of the chat as it was is saved beside it as The Redward - 2026-10-01@20h00m - before scenes\./.test(v.text) && /open a place on the map and press Start scene 1 here/.test(v.text) && v.acts.join() === 'setup-close' && v.inside, v.text);
    check('a copy that could not be saved has its own words', /could not be saved first \(the disk is full\), so nothing was changed/.test(await page.evaluate(() => window.__refusal({ reason: 'backup', errors: ['the disk is full'] }))));
    await shot('7za-scenes-done');

    // A long chat read whole (D198): how much to read is asked, and the read shows a bar for every request.
    const reach = { messages: 216, pages: 11, capped: false, recent: 40, tokens: 61000 };
    const bars = () => page.evaluate(() => {
        const list = document.querySelector('.dooms-atlas-setup-card .dooms-atlas-passes');
        if (!list) return null;
        const lb = list.getBoundingClientRect();
        const cb = document.querySelector('.dooms-atlas-setup-card').getBoundingClientRect();
        return { count: list.children.length, inside: lb.left >= cb.left && lb.right <= cb.right + 1, scrolls: list.scrollHeight > list.clientHeight + 1, rows: [...list.children].map(li => {
            const track = li.querySelector('.dooms-atlas-pass-bar');
            const fill = track.firstElementChild;
            const cs = getComputedStyle(fill);
            return { state: li.className.replace('dooms-atlas-pass is-', ''), n: li.querySelector('.dooms-atlas-pass-n').textContent, word: li.querySelector('.dooms-atlas-pass-word').textContent, track: Math.round(track.getBoundingClientRect().width), fill: Math.round(fill.offsetWidth), moving: cs.animationName, colour: cs.backgroundColor, label: track.getAttribute('aria-label'), seen: li.getBoundingClientRect().top >= lb.top - 1 && li.getBoundingClientRect().bottom <= lb.bottom + 1 };
        }) };
    });
    await page.evaluate(({ p, r }) => window.__scenes({ step: 'ask', plan: p, messages: 216, reach: r }), { p: plan, r: reach });
    v = await panel();
    const radios = await page.evaluate(() => [...document.querySelectorAll('.dooms-atlas-setup-card .dooms-atlas-scenes-reach')].map(x => `${x.value}${x.checked ? ':on' : ''}`));
    check('a chat longer than one request reads is asked how much to read: the whole of it a part at a time (the choice made already, with the requests it takes, one at a time), the whole of it in one request, or its last stretch', same(radios, ['parts:on', 'once', 'recent']) && /The whole chat, a part at a time: 216 messages in 11 requests, sent one after another, never together/.test(v.text) && /The whole chat in one request: about 61,000 tokens at once, for a model that reads that much\. If it cannot, the request fails and nothing is lost\./.test(v.text) && /Only its last stretch: one request, the last forty messages at most/.test(v.text) && /Only one request is ever out at a time\./.test(v.text) && /There is a bar for each request, the read can be stopped and taken up again/.test(v.text) && !/last forty messages of 216/.test(v.text) && v.acts.join() === 'scenes-prepare,setup-close' && v.inside, JSON.stringify([radios, v.acts, v.inside]));
    await shot('7zb-scenes-ask-whole');
    await page.evaluate(({ p, r }) => window.__scenes({ step: 'ask', plan: p, messages: 3000, reach: { ...r, messages: 3000, pages: 60, capped: true } }), { p: plan, r: reach });
    check('a chat longer than is read says the read begins part-way in', /longer than 60 requests read: the whole-chat read begins part-way in/.test((await panel()).text));
    const states = (done, now, total) => Array.from({ length: total }, (x, k) => (k < done ? 'done' : k === done ? now : 'wait'));
    await page.evaluate(({ p, r, st }) => window.__scenes({ step: 'busy', plan: p, reach: r, progress: { part: 'record', page: 3, pages: 11, states: st } }), { p: plan, r: reach, st: states(2, 'run', 11) });
    v = await panel();
    let pb = await bars();
    check('while the chat is read there is a bar for every request, numbered: the ones done full, the one being asked for moving, the ones to come empty', !!pb && pb.count === 11 && pb.inside && same(pb.rows.map(x => x.state), states(2, 'run', 11)) && same(pb.rows.map(x => x.n), ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11']) && pb.rows.slice(0, 2).every(x => x.fill >= x.track - 3 && x.word === 'done' && x.moving === 'none') && pb.rows[2].moving === 'dooms-atlas-pass-run' && pb.rows[2].fill > 0 && pb.rows[2].fill < pb.rows[2].track && pb.rows[2].word === 'reading…' && pb.rows.slice(3).every(x => x.fill === 0 && x.word === 'waiting') && pb.rows.every(x => x.track >= 120), JSON.stringify(pb));
    check('it says which request is being asked for and that they go one at a time, each bar says its own state to a screen reader, and the read can be stopped', /Reading the chat: request 3 of 11\./.test(v.text) && pb.rows[2].label === 'Request 3 of 11: reading…' && pb.rows[0].label === 'Request 1 of 11: done' && /The requests go one at a time, each after the one before it has come back\./.test(v.text) && /tried once more after a wait/.test(v.text) && v.acts.join() === 'scenes-stop' && v.inside, JSON.stringify([v.acts, v.inside]));
    await shot('7zc-scenes-reading');
    await page.evaluate(({ p, r, st }) => window.__scenes({ step: 'busy', plan: p, reach: r, progress: { part: 'record', page: 3, pages: 11, states: st } }), { p: plan, r: reach, st: states(2, 'retry', 11) });
    v = await panel();
    pb = await bars();
    check('a request that did not come back right is tried once more after a wait, and its bar says so', /Request 3 of 11 did not come back right\. Waiting a moment, then trying it once more\./.test(v.text) && pb.rows[2].state === 'retry' && pb.rows[2].word === 'trying again…' && pb.rows[2].moving === 'dooms-atlas-pass-run' && pb.rows[2].label === 'Request 3 of 11: trying again…' && v.acts.join() === 'scenes-stop', JSON.stringify(pb.rows[2]));
    await page.evaluate(({ p, r }) => window.__scenes({ step: 'busy', plan: p, reach: r, mode: 'once', progress: { part: 'record', page: 1, pages: 1, states: ['run'] } }), { p: plan, r: reach });
    v = await panel();
    pb = await bars();
    check('read in one request there is the one bar, and nothing to stop', pb.count === 1 && pb.rows[0].state === 'run' && /Writing the record of the chat so far/.test(v.text) && v.acts.length === 0);
    await page.evaluate(({ p, r, st }) => window.__scenes({ step: 'busy', plan: p, reach: r, stopping: true, progress: { part: 'record', page: 3, pages: 11, states: st } }), { p: plan, r: reach, st: states(2, 'run', 11) });
    v = await panel();
    check('Stop pressed: the request in hand is waited for, and Stop cannot be pressed twice', /Stopping after this request…/.test(v.text) && v.acts.join() === 'scenes-stop:off');
    await page.evaluate(({ p, r, st }) => window.__scenes({ step: 'paused', plan: p, reach: r, progress: { part: 'record', page: 5, pages: 11, states: st, error: '503 from the provider', reason: 'pass' } }), { p: plan, r: reach, st: states(4, 'failed', 11) });
    v = await panel();
    pb = await bars();
    check('a request that failed: the read waits at it, its bar says so, the ones before it stay done, and it can be tried again, skipped or started over', /Request 5 of 11 failed: 503 from the provider/.test(v.text) && /What was read before it is kept\./.test(v.text) && /the record will not cover it/.test(v.text) && pb.rows[4].state === 'failed' && pb.rows[4].word === 'failed' && pb.rows[4].colour !== pb.rows[3].colour && pb.rows.slice(0, 4).every(x => x.state === 'done') && pb.rows[5].fill === 0 && v.acts.join() === 'scenes-retry,scenes-skip,scenes-drop,setup-close' && /Try it again/.test(v.text) && v.inside, JSON.stringify([v.acts, v.inside, pb.rows[4]]));
    await shot('7zd-scenes-failed');
    await page.evaluate(({ p, r, st }) => window.__scenes({ step: 'paused', plan: p, reach: r, progress: { part: 'record', page: 5, pages: 11, states: st, error: '', reason: 'stopped' } }), { p: plan, r: reach, st: states(4, 'wait', 11) });
    v = await panel();
    check('a read that was stopped says where, and is carried on from there', /Stopped before request 5 of 11\./.test(v.text) && /Carry on/.test(v.text) && !/failed/.test(v.text) && v.acts[0] === 'scenes-retry');
    const sk = states(11, 'done', 11);
    sk[4] = 'skipped';
    await page.evaluate(({ p, r }) => window.__scenes({ step: 'review', plan: p, reach: r, recap: 'The road ran as far as the mill.', read: { whole: true, pages: 11, skipped: 1, capped: false }, canon: true, wantLedger: true }), { p: plan, r: reach });
    v = await panel();
    const tick = await page.evaluate(() => { const t = document.querySelector('.dooms-atlas-setup-card .dooms-atlas-scenes-ledger'); return t ? { on: t.checked, text: t.closest('label').textContent.replace(/\s+/g, ' ').trim() } : null; });
    check('the record read: it says what it was written from and what was skipped, and offers the ledger the same read, ticked', /Written from the whole chat: 216 messages in 11 requests\. 1 part was skipped, so the record does not cover it\./.test(v.text) && !!tick && tick.on && /Read the whole chat into the ledger first \(11 requests more\)/.test(tick.text) && /Canon's list of what the story has established/.test(v.text) && /Read it again/.test(v.text) && v.acts.join() === 'scenes-go,scenes-again,setup-close' && v.inside, JSON.stringify([tick, v.acts, v.inside]));
    await shot('7ze-scenes-review-whole');
    await page.evaluate(({ p, r }) => window.__scenes({ step: 'review', plan: p, reach: r, mode: 'once', recap: 'x', read: { whole: true, pages: 1, skipped: 0, capped: false }, canon: true, wantLedger: true }), { p: plan, r: reach });
    v = await panel();
    check('a record written in one request says so, and the ledger is offered the same: one more request', /Written from the whole chat: 216 messages in one request\./.test(v.text) && /Read the whole chat into the ledger first \(1 request more\)/.test(v.text) && /in one request as the record was/.test(v.text));
    await page.evaluate(({ p, r }) => window.__scenes({ step: 'review', plan: p, reach: r, mode: 'recent', recap: 'x', read: { whole: false, pages: 1, skipped: 0, capped: false }, canon: false }), { p: plan, r: reach });
    v = await panel();
    check('with Canon off there is no ledger to offer, and it says so; a record of the last stretch says that is what it is', /Canon is off, so this chat has no ledger of facts/.test(v.text) && /Written from the last stretch of the chat only\./.test(v.text) && !(await page.evaluate(() => !!document.querySelector('.dooms-atlas-scenes-ledger'))));
    await page.evaluate(({ p, r, st }) => window.__scenes({ step: 'busy', plan: p, reach: r, progress: { part: 'ledger', page: 2, pages: 11, states: st } }), { p: plan, r: reach, st: states(1, 'run', 11) });
    v = await panel();
    pb = await bars();
    check('the ledger\'s read has its own bars, a request each', /Reading the chat into the ledger: request 2 of 11\./.test(v.text) && pb.count === 11 && pb.rows[1].state === 'run' && v.acts.join() === 'scenes-stop');
    await page.evaluate(({ p, r, st }) => window.__scenes({ step: 'paused', plan: p, reach: r, progress: { part: 'ledger', page: 2, pages: 11, states: st, error: 'The reply holds no ledger.', reason: 'pass' } }), { p: plan, r: reach, st: states(1, 'failed', 11) });
    v = await panel();
    check('a ledger request that failed: tried again, skipped, or the chat taken with the ledger as far as it got', /Request 2 of 11 failed: The reply holds no ledger\./.test(v.text) && /kept in the ledger/.test(v.text) && /the ledger will not hold what it established/.test(v.text) && v.acts.join() === 'scenes-retry,scenes-skip,scenes-go-now,scenes-back,setup-close' && v.inside, JSON.stringify(v.acts));
    await page.evaluate(({ p, r, st }) => window.__scenes({ step: 'busy', plan: p, reach: r, progress: { part: 'ledger', page: 11, pages: 11, states: st, taking: true } }), { p: plan, r: reach, st: states(11, 'done', 11) });
    v = await panel();
    check('read, the chat is taken: every bar full, and nothing to stop', /Taking the chat…/.test(v.text) && (await bars()).rows.every(x => x.state === 'done') && v.acts.join() === 'scenes-stop:off');
    await page.evaluate((p) => window.__scenes({ step: 'done', plan: p, result: { ok: true, worldName: 'First Descent', card: 'The Redward', replaced: false, backup: 'x - before scenes' }, ledger: { partial: false, pages: 11, read: 10, skipped: 1, added: 38 } }), plan);
    check('done says what the ledger read', /The ledger has read the whole chat: 38 facts added, 1 part skipped\./.test((await panel()).text));
    await page.evaluate((p) => window.__scenes({ step: 'done', plan: p, result: { ok: true, worldName: 'First Descent', card: 'The Redward' }, ledger: { partial: true, pages: 11, read: 4, skipped: 0, added: 12 } }), plan);
    check('or how far it got when the rest was given up', /The ledger read 4 of 11 parts of the chat \(12 facts added\)\./.test((await panel()).text));
    // Sixty requests: the list scrolls inside the panel, the panel stays on the screen.
    await page.evaluate(({ p, st }) => window.__scenes({ step: 'busy', plan: p, reach: { messages: 3000, pages: 60, capped: true }, progress: { part: 'record', page: 41, pages: 60, states: st } }), { p: plan, st: states(40, 'run', 60) });
    v = await panel();
    pb = await bars();
    check('a read of sixty requests keeps its bars in a list that scrolls, the panel on the screen with Stop in reach', pb.count === 60 && pb.scrolls && v.inside && v.acts.join() === 'scenes-stop', JSON.stringify([pb.count, pb.scrolls, v.inside]));
    await page.setViewportSize({ width: 412, height: 800 });
    await page.evaluate(({ p, r, st }) => window.__scenes({ step: 'busy', plan: p, reach: r, progress: { part: 'record', page: 3, pages: 11, states: st } }), { p: plan, r: reach, st: states(2, 'run', 11) });
    await settle();
    pb = await bars();
    const phone = await page.evaluate(() => { const c = document.querySelector('.dooms-atlas-setup-card'); const s = c.querySelector('[data-act="scenes-stop"]').getBoundingClientRect(); const cb = c.getBoundingClientRect(); return { wide: cb.width, left: cb.left, right: cb.right, stop: s.width > 0 && s.left >= 0 && s.right <= innerWidth + 1, over: document.documentElement.scrollWidth > innerWidth + 1 }; });
    check('on a phone the bars fit the screen\'s width, every one of them, with Stop beside nothing it could be mistaken for', pb.count === 11 && pb.inside && pb.rows.every(x => x.track >= 150) && phone.left >= -1 && phone.right <= 413 && phone.stop && !phone.over, JSON.stringify([phone, pb.rows[0]]));
    await shot('7zf2-scenes-reading-phone');
    await page.setViewportSize(VIEW);
    await settle();
    await page.evaluate(() => window.__scenes({ step: 'ask', plan: { ok: false, reason: 'bound-elsewhere', boundTo: 'harbourside', card: { name: 'Mara Vane' }, world: { name: 'Mara Vane', made: true } } }));
    v = await panel();
    check('a chat that cannot be played as scenes says why and what to do, and only closes', /Mara Vane already narrates another world \(harbourside\)/.test(v.text) && v.acts.join() === 'setup-close');
    const words = await page.evaluate(() => ['group', 'no-chat', 'no-world', 'no-card', 'scene', 'off', 'busy', 'changed'].map(r => window.__refusal({ reason: r })));
    check('every refusal has its own words', new Set(words).size === words.length && words.every(w => w.length > 30) && /group chat/.test(words[0]) && /scene already/.test(words[4]) && /Live World is off/.test(words[5]));
    await page.evaluate(() => window.__setup(''));
    // Between scenes (D173): the sidebar says the world's memory is shown, names the scene being played and offers the way to it.
    await page.evaluate(() => window.__set({ between: { open: null } }));
    let b = await page.evaluate(() => { const el = document.querySelector('.dooms-atlas-between'); const side = document.querySelector('.dooms-atlas-side').getBoundingClientRect(); const r = el ? el.getBoundingClientRect() : null; return el ? { text: el.textContent.replace(/\s+/g, ' ').trim(), go: !!el.querySelector('[data-act="scene-go"]'), in: r.left >= side.left && r.right <= side.right + 1, play: !!document.querySelector('.dooms-atlas-foot [data-act="scenes"]') } : null; });
    check('between scenes the sidebar says so under the world\'s name, and Play as scenes is not offered', !!b && /Between scenes: the world as it stands now, not as this chat left it\./.test(b.text) && !b.go && b.in && !b.play, JSON.stringify(b));
    await page.evaluate(() => window.__set({ between: { open: { id: 's3', number: '3', title: 'The gate at dusk' } } }));
    b = await page.evaluate(() => { const el = document.querySelector('.dooms-atlas-between'); const go = el ? el.querySelector('[data-act="scene-go"]') : null; return el ? { text: el.textContent.replace(/\s+/g, ' ').trim(), id: go ? go.getAttribute('data-id') : '' } : null; });
    check('with a scene being played it is named, with the way to it', !!b && /Scene 3 \(The gate at dusk\) is being played, and the map is changed there\./.test(b.text) && /Go to it/.test(b.text) && b.id === 's3', JSON.stringify(b));
    await shot('7zb-between-scenes');
    await page.evaluate(() => window.__set({ between: null }));
}

console.log('\n§5h starting a scene from a place (D174)');
{
    // The place's card: in a chat that was taken as the scenes' beginning both ways of going there are offered; between scenes, the scene alone.
    await page.evaluate(() => window.__set({ canStart: true }));
    await page.locator('#dooms-atlas .dooms-atlas-marker', { hasText: 'Redfall Castle' }).locator('.dooms-atlas-pin').click();
    await settle();
    let c = await page.evaluate(() => { const card = document.querySelector('.dooms-atlas-card'); const st = card.querySelector('[data-act="scene-start"]'); const tr = card.querySelector('[data-act="travel"]'); return { start: st ? st.textContent.trim() : '', startPrimary: st ? st.classList.contains('is-primary') : false, travel: !!tr, travelPrimary: tr ? tr.classList.contains('is-primary') : false, id: st ? st.getAttribute('data-id') : '' }; });
    check('a place\'s card offers Start scene 4 here beside Travel here, the scene the quieter of the two', c.start === 'Start scene 4 here' && c.travel && c.travelPrimary && !c.startPrimary && c.id === (await page.evaluate(() => window.__model.markers.find(m => m.label === 'Redfall Castle').id)), JSON.stringify(c));
    await page.evaluate(() => window.__board.closeCard());
    await page.evaluate(() => window.__set({ between: { open: null } }));
    await page.locator('#dooms-atlas .dooms-atlas-marker', { hasText: 'Redfall Castle' }).locator('.dooms-atlas-pin').click();
    await settle();
    c = await page.evaluate(() => { const card = document.querySelector('.dooms-atlas-card'); const st = card.querySelector('[data-act="scene-start"]'); return { start: st ? st.textContent.trim() : '', startPrimary: st ? st.classList.contains('is-primary') : false, travel: !!card.querySelector('[data-act="travel"]'), fits: card.scrollWidth <= card.clientWidth + 1 }; });
    check('between scenes there is no chat to travel in: the card offers the scene alone, as the thing to press', c.start === 'Start scene 4 here' && c.startPrimary && !c.travel && c.fits, JSON.stringify(c));
    await shot('7zc-card-start-scene');
    await page.evaluate(() => window.__board.closeCard());
    await page.evaluate(() => window.__set({ between: null, canStart: false }));

    const panel = () => page.evaluate(() => { const el = document.querySelector('.dooms-atlas-setup-card'); if (!el) return null; const b = el.getBoundingClientRect(); return { text: el.textContent.replace(/\s+/g, ' ').trim(), acts: [...el.querySelectorAll('[data-act]')].map(x => x.getAttribute('data-act') + (x.hasAttribute('data-choice') ? ':' + x.getAttribute('data-choice') : '')), inside: b.top >= 0 && b.bottom <= innerHeight && b.left >= 0 && b.right <= innerWidth, ticked: [...el.querySelectorAll('input[name="dooms-atlas-cast"]:checked')].map(x => x.value), gap: (el.querySelector('input[name="dooms-atlas-gap"]:checked') || {}).value, when: (el.querySelector('.dooms-atlas-scene-when') || {}).value, seed: (el.querySelector('.dooms-atlas-scene-seed') || {}).value, overflow: el.scrollWidth > el.clientWidth + 1 }; });
    const form = { step: 'form', place: { id: 'pin:redfall-castle', label: 'Redfall Castle' }, sceneNo: 4, card: 'The Redward', people: [{ name: 'Kiyoha', here: true }, { name: 'Lysandra', here: true }, { name: 'Dagger', here: false }, { name: 'Solveig', here: false }, { name: 'Blythe', here: false }], cast: ['Kiyoha', 'Lysandra'], gap: { id: 'when', words: 'about 2 days later' }, journey: 'about 2 days on foot by road (48 miles)', seedText: 'The party came here from Hask: about 2 days on foot by road (48 miles).' };
    await page.evaluate((o) => window.__sceneStart(o), form);
    let v = await panel();
    check('the sheet: the scene and its place named, the people last seen there ticked, the time counted from the journey on the map, what brings the party filled in from it', /Scene 4 at Redfall Castle/.test(v.text) && /A fresh chat with The Redward/.test(v.text) && v.ticked.join() === 'Kiyoha,Lysandra' && v.gap === 'when' && v.when === 'about 2 days later' && /The map puts the way here at about 2 days on foot by road \(48 miles\)/.test(v.text) && v.seed.startsWith('The party came here from Hask') && v.acts.join() === 'scene-write,setup-close' && v.inside && !v.overflow, JSON.stringify(v));
    check('every gap can be picked, the player\'s own words among them', (await page.evaluate(() => [...document.querySelectorAll('input[name="dooms-atlas-gap"]')].map(x => x.value).join())) === 'now,later,tomorrow,days,weeks,when');
    await shot('7zd-scene-sheet');
    await page.evaluate((o) => window.__sceneStart({ ...o, step: 'busy' }), form);
    check('while the openings are written the sheet says so', /Writing three ways it could open/.test((await panel()).text) && (await panel()).acts.length === 0);
    const pending = { when: { date: 'Day 44', time: 'dusk' }, openers: [{ title: 'The gate', text: 'Fog lies on the causeway. Kiyoha is already at the gate, axe across her shoulders, singing badly.' }, { title: 'The yard', text: 'The castle yard is empty but for a boy with a bucket, who will not look at Lysandra\'s hands.' }, { title: 'A summons', text: 'A steward waits under the arch with a sealed letter and the look of a man told to hurry.' }] };
    await page.evaluate((o) => window.__sceneStart(o), { ...form, step: 'pick', pending });
    v = await panel();
    check('three openings to pick from, each with its own button; or the player\'s own, or three more, or back', /How does scene 4 open\?/.test(v.text) && /Redfall Castle · Day 44, dusk/.test(v.text) && /singing badly/.test(v.text) && /sealed letter/.test(v.text) && v.acts.join() === 'scene-pick:0,scene-pick:1,scene-pick:2,scene-own,scene-again,scene-back' && v.inside && !v.overflow, JSON.stringify(v.acts));
    await shot('7ze-scene-openings');
    await page.evaluate((o) => window.__sceneStart(o), { ...form, step: 'pick', pending: { ...pending, lore: { found: ['Kiyoha', 'Lysandra'], missing: ['Dagger'], standing: true, books: ['FD - Campaign Complete', 'FD - Continuity'] } } });
    v = await panel();
    check('the sheet says whose lorebook entries the openings were written with, and who had none and how one is found (D177)', /Written with the lorebook entries of Kiyoha and Lysandra and the story's standing notes\./.test(v.text) && /No entry was found for Dagger: the opening has only a line about them\. An entry whose title begins with the name, or that has the name among its keywords, is found\./.test(v.text) && v.inside && !v.overflow, v.text.slice(0, 400));
    await shot('7zh-scene-openings-lore');
    await page.evaluate((o) => window.__sceneStart(o), { ...form, step: 'pick', pending: { ...pending, lore: { found: [], missing: [], standing: false, books: [] } } });
    check('with no lorebook read it says nothing of them', !/lorebook/.test((await panel()).text));
    await page.evaluate((o) => window.__sceneStart(o), { ...form, step: 'pick', pending: { when: null, openers: [] }, error: 'The narrator wrote no usable opener; write your own, ask again, or start without one.' });
    v = await panel();
    check('no opening written: the sheet says so and still lets the player write one or ask again', /No opening was written/.test(v.text) && /wrote no usable opener/.test(v.text) && v.acts.join() === 'scene-own,scene-again,scene-back');
    await page.evaluate((o) => window.__sceneStart({ ...o, step: 'opening' }), form);
    check('while the scene is opened the sheet says so', /Opening the scene/.test((await panel()).text));
    await page.evaluate(() => window.__setup(''));
}

console.log('\n§5i ending a scene from the Atlas; the strip above a scene\'s chat (D176)');
{
    await page.evaluate(() => window.__set({ ending: { number: '3' } }));
    const foot = await page.evaluate(() => { const b = document.querySelector('.dooms-atlas-foot [data-act="end-scene"]'); return { end: b ? b.textContent.trim() : '', play: !!document.querySelector('.dooms-atlas-foot [data-act="scenes"]') }; });
    check('in a scene being played the sidebar\'s foot offers End scene 3, and Play as scenes is not there', foot.end === 'End scene 3' && !foot.play, JSON.stringify(foot));
    const panel = () => page.evaluate(() => { const el = document.querySelector('.dooms-atlas-setup-card'); if (!el) return null; const b = el.getBoundingClientRect(); const ta = el.querySelector('.dooms-atlas-end-recap'); return { text: el.textContent.replace(/\s+/g, ' ').trim(), acts: [...el.querySelectorAll('[data-act]')].map(x => x.getAttribute('data-act') + (x.disabled ? ':off' : '')), inside: b.top >= 0 && b.bottom <= innerHeight, recap: ta ? ta.value : '', readonly: ta ? ta.readOnly : false, parts: [...el.querySelectorAll('.dooms-atlas-part')].map(x => x.className.replace('dooms-atlas-part ', '') + '=' + x.querySelector('.dooms-atlas-part-state').textContent), skips: el.querySelectorAll('.dooms-atlas-part-skip input').length, replace: !!el.querySelector('.dooms-atlas-end-replace') }; });
    const scene = { id: 's3', title: 'The gate at dusk' };
    await page.evaluate((sc) => window.__endScene({ prep: { scene: sc }, busy: true }), scene);
    let v = await panel();
    check('opened, the sheet names the scene and says the record is being written; End waits for it', /End scene 3: The gate at dusk/.test(v.text) && /What happened \(being written…\)/.test(v.text) && v.readonly && v.acts.join() === 'end-go:off,end-continue:off,setup-close', JSON.stringify(v.acts));
    await page.evaluate((sc) => window.__endScene({ prep: { scene: sc }, busy: true, passes: ['done', 'run', 'wait'] }), scene);
    const endBars = await page.evaluate(() => [...document.querySelectorAll('.dooms-atlas-setup-card .dooms-atlas-passes .dooms-atlas-pass')].map(li => `${li.className.replace('dooms-atlas-pass is-', '')}:${getComputedStyle(li.querySelector('.dooms-atlas-pass-bar > span')).animationName}`));
    check('a long scene\'s record is written in several requests, and each has its bar (D198)', same(endBars, ['done:none', 'run:dooms-atlas-pass-run', 'wait:none']), JSON.stringify(endBars));
    const prep = { ok: true, scene, recap: 'They met at the gate in the fog; Kiyoha carried the new healer\'s pack and said nothing about it.', from: 'Day 42', to: 'Day 42, night', stale: false, canonDone: false, steps: { canon: true, world: true } };
    await page.evaluate((p) => window.__endScene({ prep: p }), prep);
    v = await panel();
    check('the record is shown to be corrected, with what ending will do: the record, the ledger, the world, the memory; the ledger and the world can each be left out', v.recap.startsWith('They met at the gate') && !v.readonly && /From Day 42 to Day 42, night\./.test(v.text) && /Canon reads the whole scene/.test(v.text) && /the clocks tick and people move, by the time the scene took/.test(v.text) && /with the map, kept for the next scene/.test(v.text) && v.parts.join() === 'is-waiting=waiting,is-waiting=waiting,is-waiting=waiting,is-waiting=waiting' && v.skips === 2 && !v.replace && v.acts.join() === 'end-go,end-continue,setup-close' && v.inside, JSON.stringify(v.parts));
    await shot('7zf-end-sheet');
    // The style law (D179): what the narration leaned on, counted, each a tick; the worst ticked already.
    const style = { messages: 31, phrases: [{ phrase: 'sweetheart', kind: 'address', count: 17, inMessages: 15, ticked: true }, { phrase: 'slight knowing smile', kind: 'phrase', count: 10, inMessages: 10, ticked: true }, { phrase: 'nine years', kind: 'phrase', count: 6, inMessages: 6, ticked: false }] };
    await page.evaluate(({ p, st }) => window.__endScene({ prep: { ...p, style: st } }), { p: prep, st: style });
    const habits = await page.evaluate(() => { const el = document.querySelector('.dooms-atlas-setup-card'); const b = el.getBoundingClientRect(); return { text: (el.querySelector('.dooms-atlas-habits-field') || { textContent: '' }).textContent.replace(/\s+/g, ' ').trim(), ticks: [...el.querySelectorAll('.dooms-atlas-end-ban')].map(x => `${x.value}:${x.checked}:${x.getAttribute('data-kind')}:${x.getAttribute('data-count')}`), inside: b.top >= 0 && b.bottom <= innerHeight, overflow: el.scrollWidth > el.clientWidth + 1 }; });
    check('the End sheet lists the phrases the narration leaned on, each with its count, the worst ticked already, and says what a tick does', /Phrases the narration leaned on \(31 messages counted\)/.test(habits.text) && /“sweetheart”\s*17× · said to someone/.test(habits.text) && /“slight knowing smile”\s*10×/.test(habits.text) && /held against the next scenes/.test(habits.text) && /drops off the list by itself/.test(habits.text) && habits.ticks.join() === 'sweetheart:true:address:17,slight knowing smile:true:phrase:10,nine years:false:phrase:6' && habits.inside && !habits.overflow, JSON.stringify(habits));
    await shot('7zi-end-sheet-habits');
    await page.evaluate(({ p, st }) => window.__endScene({ prep: { ...p, style: { messages: 12, phrases: [] } } }), { p: prep, st: style });
    check('a scene with no habit shows no such list', (await page.evaluate(() => !document.querySelector('.dooms-atlas-habits-field'))));
    // Where the people stand and the threads (D188): what the record said of each, to be corrected or crossed off.
    check('a record that said nothing of the people or the threads shows no such fields', (await page.evaluate(() => !document.querySelector('.dooms-atlas-cont'))));
    const cont = { people: [{ name: 'Kiyoha', now: 'At the stair foot, shoulder bound; owes Jordan her life and says so.', was: 'At the Fourth Landing, shoulder cut; sworn to see Jordan down the stair.' }, { name: 'Dagger', now: 'Joined the company on the stair; wants the Factor\'s key.', was: '' }], opened: [{ key: 'new:4', text: 'The Factor wants his key back.' }, { key: 'new:5', text: 'Dagger has not said why he came.' }], closed: [{ id: 't1', text: 'The debt to the Counting Room, due at the new moon.' }], open: 2 };
    await page.evaluate(({ p, c }) => window.__endScene({ prep: { ...p, continuity: c } }), { p: prep, c: cont });
    const contOf = () => page.evaluate(() => {
        const el = document.querySelector('.dooms-atlas-setup-card'); const b = el.getBoundingClientRect();
        return {
            people: [...el.querySelectorAll('.dooms-atlas-cont-person')].map(li => ({ name: li.getAttribute('data-name'), now: li.querySelector('.dooms-atlas-cont-now').value, was: (li.querySelector('.dooms-atlas-cont-was') || { textContent: '' }).textContent, ro: li.querySelector('.dooms-atlas-cont-now').readOnly, cross: !!li.querySelector('[data-act="cont-drop"]') })),
            opened: [...el.querySelectorAll('.dooms-atlas-cont-thread.is-new')].map(li => ({ key: li.getAttribute('data-key'), text: li.querySelector('.dooms-atlas-cont-thread-text').value })),
            closed: [...el.querySelectorAll('.dooms-atlas-cont-closed')].map(x => `${x.value}:${x.checked}:${x.disabled}`),
            text: [...el.querySelectorAll('.dooms-atlas-cont')].map(f => f.textContent.replace(/\s+/g, ' ').trim()).join(' | '),
            order: el.querySelector('.dooms-atlas-cont').compareDocumentPosition(el.querySelector('.dooms-atlas-parts')) === Node.DOCUMENT_POSITION_FOLLOWING && el.querySelector('.dooms-atlas-end-recap').compareDocumentPosition(el.querySelector('.dooms-atlas-cont')) === Node.DOCUMENT_POSITION_FOLLOWING,
            inside: b.top >= 0 && b.bottom <= innerHeight + 1, overflow: el.scrollWidth > el.clientWidth + 1, scrolls: el.scrollHeight > el.clientHeight + 1,
        };
    });
    let cv = await contOf();
    check('the End sheet shows where each person the record spoke of stands now, to be corrected, with where they stood before', cv.people.length === 2 && cv.people[0].name === 'Kiyoha' && cv.people[0].now.startsWith('At the stair foot') && /^Before: At the Fourth Landing/.test(cv.people[0].was) && cv.people[1].was === '' && cv.people.every(p => !p.ro && p.cross) && /Where they stand now/.test(cv.text) && /The next scene is told this of whoever is in it/.test(cv.text), JSON.stringify(cv.people));
    check('and the threads: the ones the scene opened, to be reworded or crossed off; the one it settled, ticked; how many stay open', same(cv.opened, [{ key: 'new:4', text: 'The Factor wants his key back.' }, { key: 'new:5', text: 'Dagger has not said why he came.' }]) && same(cv.closed, ['t1:true:false']) && /settled The debt to the Counting Room/.test(cv.text) && /2 other threads stay open from before/.test(cv.text) && /Untick one that is not settled after all/.test(cv.text), cv.text);
    check('they sit between the record and what ending does, and the sheet still fits the window (scrolling inside itself when it is long)', cv.order && cv.inside && !cv.overflow);
    v = await panel();
    check('with something to keep, ending also writes the world\'s continuity lorebook, and the sheet says the entries are there to be changed', v.parts.length === 5 && v.parts[4] === 'is-waiting=waiting' && /The book where people stand and the open threads, written to a lorebook of the world's own/.test(v.text) && /written to a lorebook of the world's own in your Lore Library, an entry a person/.test(cv.text), v.text.slice(-500));
    await page.evaluate(({ p, c }) => window.__endScene({ prep: { ...p, continuity: c, book: 'FD - Scenes Continuity' }, states: { recap: 'ok', canon: 'ok', world: 'ok', snapshot: 'ok', book: 'running' } }), { p: prep, c: cont });
    v = await panel();
    check('a world that has its book is told it by name; the book\'s step shows its state like the others', /written to the lorebook FD - Scenes Continuity/.test(v.text) && /Each is an entry in the lorebook FD - Scenes Continuity, keyed by the name: what you change there is taken as how things stand/.test(v.text) && v.parts[4] === 'is-running=running…');
    await page.evaluate(({ p, c }) => window.__endScene({ prep: { ...p, continuity: c } }), { p: prep, c: cont });
    await shot('7zj-end-sheet-continuity');
    await page.fill('.dooms-atlas-cont-person[data-name="Kiyoha"] .dooms-atlas-cont-now', 'At the stair foot, asleep on her axe.');
    await page.click('.dooms-atlas-cont-person[data-name="Dagger"] [data-act="cont-drop"]');
    await page.click('.dooms-atlas-cont-thread[data-key="new:4"] [data-act="cont-drop"]');
    await page.uncheck('.dooms-atlas-cont-closed');
    cv = await contOf();
    check('a line corrected stays as typed; someone or a thread crossed off is gone from the sheet and nothing else is drawn again; a settled thread can be unticked', same(cv.people.map(p => [p.name, p.now]), [['Kiyoha', 'At the stair foot, asleep on her axe.']]) && same(cv.opened.map(t => t.key), ['new:5']) && same(cv.closed, ['t1:false:false']) && (await page.evaluate(() => document.querySelector('.dooms-atlas-end-recap').value.startsWith('They met at the gate'))));
    await page.evaluate(({ p, c }) => window.__endScene({ prep: { ...p, continuity: c }, states: { recap: 'ok', canon: 'ok', world: 'ok', snapshot: 'ok' }, result: { ok: true } }), { p: prep, c: cont });
    cv = await contOf();
    check('once the scene is ended they are shown as kept and can no longer be changed', cv.people.every(p => p.ro && !p.cross) && same(cv.closed, ['t1:true:true']));
    await page.evaluate(({ p }) => window.__endScene({ prep: { ...p, continuity: { people: [], opened: [], closed: [], open: 3 } } }), { p: prep });
    check('a record that changed nothing shows no fields, however many threads stay open', (await page.evaluate(() => !document.querySelector('.dooms-atlas-cont'))));
    // What the scene contradicts (D190): listed before the scene is ended, kept after, with one Undo of the End.
    check('a record that found no contradiction shows no such list', (await page.evaluate(() => !document.querySelector('.dooms-atlas-conflicts'))));
    const clashes = [{ scene: 'Dagger still holds the Factor\'s key.', established: 'The Factor\'s key was returned in run 2.', source: 'the standing notes' }, { scene: 'Kiyoha says she has never met Solveig.', established: 'She and Solveig came up the stair together.', source: 'Kiyoha\'s notes' }];
    const checked = { ledger: true, notes: ['Kiyoha', 'Lysandra'], standing: true };
    await page.evaluate(({ p, c, cl, ck }) => window.__endScene({ prep: { ...p, continuity: c, conflicts: cl, checked: ck } }), { p: prep, c: cont, cl: clashes, ck: checked });
    const clashOf = () => page.evaluate(() => {
        const el = document.querySelector('.dooms-atlas-setup-card'); const f = el.querySelector('.dooms-atlas-conflicts'); const b = el.getBoundingClientRect();
        return { rows: f ? [...f.querySelectorAll('.dooms-atlas-conflict')].map(li => li.textContent.replace(/\s+/g, ' ').trim()) : [], legend: f ? f.querySelector('legend').textContent.trim() : '', note: f ? f.querySelector('.dooms-atlas-start-note').textContent.replace(/\s+/g, ' ').trim() : '', before: f ? f.compareDocumentPosition(el.querySelector('.dooms-atlas-parts')) === Node.DOCUMENT_POSITION_FOLLOWING && el.querySelector('.dooms-atlas-cont').compareDocumentPosition(f) === Node.DOCUMENT_POSITION_FOLLOWING : false, acts: [...el.querySelectorAll('.dooms-atlas-setup-actions [data-act]')].map(x => x.getAttribute('data-act') + (x.disabled ? ':off' : '')), inside: b.top >= 0 && b.bottom <= innerHeight + 1, overflow: el.scrollWidth > el.clientWidth + 1 };
    });
    let cl = await clashOf();
    check('the End sheet lists what the scene contradicts before the scene is ended: what it says, what was established, and where', cl.rows.length === 2 && /the scene Dagger still holds the Factor's key\. established The Factor's key was returned in run 2\. \(the standing notes\)/.test(cl.rows[0]) && /\(Kiyoha's notes\)/.test(cl.rows[1]) && /Against what was established · 2/.test(cl.legend) && cl.before, JSON.stringify(cl.rows));
    check('it says what to do about one, what it was checked against, and that ending keeps the list with one Undo', /What was played stands unless you change it/.test(cl.note) && /Keep playing and put it right in the chat/.test(cl.note) && /one Undo puts the End back/.test(cl.note) && /Checked against the ledger, the lorebook entries of Kiyoha and Lysandra, the story's standing notes, where each person stood\./.test(cl.note) && cl.acts.join() === 'end-go,end-continue,setup-close' && cl.inside && !cl.overflow, cl.note);
    await shot('7zk-end-sheet-conflicts');
    await page.evaluate(({ p, c, cl, ck }) => window.__endScene({ prep: { ...p, continuity: c, conflicts: cl, checked: ck, book: 'FD - Scenes Continuity' }, states: { recap: 'ok', canon: 'ok', world: 'ok', snapshot: 'ok', book: 'ok' }, result: { ok: true, conflicts: 2 }, canUndo: true }), { p: prep, c: cont, cl: clashes, ck: checked });
    cl = await clashOf();
    check('once the scene is ended the list stays, and the End can be undone, all of it, from the sheet', cl.rows.length === 2 && /These are kept with the scene\. If one is a slip, Undo puts the End back, all of it/.test(cl.note) && cl.acts.join() === 'setup-close,end-undo' && (await page.evaluate(() => { const b = document.querySelector('[data-act="end-undo"]'); return /Undo this End/.test(b.textContent) && /the record, the world, where people stand, the threads, the ledger and the continuity book are as they were/.test(b.title); })), JSON.stringify(cl.acts));
    await shot('7zl-end-sheet-ended-undo');
    await page.evaluate(({ p, c, cl }) => window.__endScene({ prep: { ...p, continuity: c, conflicts: cl }, states: { recap: 'ok', canon: 'ok', world: 'ok', snapshot: 'ok' }, result: { ok: true }, canUndo: true, undoing: true }), { p: prep, c: cont, cl: clashes });
    check('while it is being undone neither button can be pressed', (await clashOf()).acts.join() === 'setup-close:off,end-undo:off');
    await page.evaluate(({ p }) => window.__endScene({ prep: p, states: { recap: 'ok', canon: 'ok', world: 'ok', snapshot: 'ok' }, result: { ok: true }, canUndo: false }), { p: prep });
    check('an End that can no longer be put back offers no Undo', (await clashOf()).acts.join() === 'setup-close');
    await page.evaluate(() => { window.__endScene({ prep: null }); document.querySelector('.dooms-atlas-setup').hidden = true; window.__set({ ending: null, between: { open: null }, undoEnd: { number: '3', conflicts: 2 } }); });
    const footUndo = await page.evaluate(() => { const b = document.querySelector('.dooms-atlas-foot [data-act="end-undo"]'); return b ? { text: b.textContent.replace(/\s+/g, ' ').trim(), title: b.title, fits: b.getBoundingClientRect().right <= document.querySelector('.dooms-atlas-side').getBoundingClientRect().right + 1 } : null; });
    check('between scenes the sidebar\'s foot offers the Undo too, until the next scene starts, and says when the scene went against canon', !!footUndo && footUndo.text === 'Undo End of scene 3 · 2 against canon' && /Offered until the next scene starts/.test(footUndo.title) && footUndo.fits, JSON.stringify(footUndo));
    await page.evaluate(() => window.__set({ between: null, undoEnd: null, ending: { number: '3' } }));
    check('with no End to put back there is no such button', (await page.evaluate(() => !document.querySelector('.dooms-atlas-foot [data-act="end-undo"]'))));
    await page.evaluate((p) => window.__endScene({ prep: { ...p, stale: true, steps: { canon: false, world: true } } }), prep);
    v = await panel();
    check('a scene the world has moved past: the sheet says its End keeps the newer memory, with the tick to replace it; Canon off is shown as off; it cannot be gone straight on from', /began before a later one ended/.test(v.text) && v.replace && /Canon is off/.test(v.text) && v.parts[1] === 'is-off=off' && v.skips === 1 && v.acts.join() === 'end-go,end-continue:off,setup-close');
    await page.evaluate((p) => window.__endScene({ prep: p, states: { recap: 'ok', canon: 'running', world: 'waiting', snapshot: 'waiting' } }), prep);
    const partBars = await page.evaluate(() => [...document.querySelectorAll('.dooms-atlas-setup-card .dooms-atlas-part')].map(li => { const t = li.querySelector('.dooms-atlas-part-bar'); return t ? `${t.className.replace('dooms-atlas-pass-bar dooms-atlas-part-bar is-', '')}:${Math.round(t.firstElementChild.offsetWidth)}>${Math.round(t.getBoundingClientRect().width)}` : 'none'; }));
    check('while End runs each part that runs has a bar: done full, the one in hand moving, the ones to come empty (D198)', partBars.length >= 4 && /^done:(\d+)>\1$/.test(partBars[0].replace(/(\d+)>(\d+)/, (m, a2, b2) => `${Math.abs(a2 - b2) <= 3 ? b2 : a2}>${b2}`)) && /^run:/.test(partBars[1]) && partBars.slice(2, 4).every(x => /^wait:0>/.test(x)), JSON.stringify(partBars));
    v = await panel();
    check('while it runs each part shows its state, and neither button can be pressed', v.parts.join() === 'is-ok=done,is-running=running…,is-waiting=waiting,is-waiting=waiting' && v.skips === 0 && v.acts.join() === 'end-go:off,end-continue:off,setup-close:off' && /Ending…/.test(v.text));
    await page.evaluate((p) => window.__endScene({ prep: p, states: { recap: 'ok', canon: 'ok', world: 'skipped', snapshot: 'ok' }, result: { ok: true } }), prep);
    v = await panel();
    check('ended: it says so and what the map shows now, the record can no longer be changed, and the one button goes to the map', /The scene is ended and remembered\. The map shows the world as it stands now: open a place to start the next scene\./.test(v.text) && v.readonly && v.parts.join() === 'is-ok=done,is-ok=done,is-skipped=left out,is-ok=done' && v.acts.join() === 'setup-close' && /To the map/.test(v.text));
    await shot('7zg-end-done');
    await page.evaluate((p) => window.__endScene({ prep: p, states: { recap: 'ok', canon: 'ok', world: 'skipped', snapshot: 'ok' }, result: { ok: true }, going: 'Writing how the next scene opens…' }), prep);
    v = await panel();
    check('End and continue here: ended, the sheet says what is being done for the next scene and nothing can be pressed (D181)', /The scene is ended and remembered\. Writing how the next scene opens…/.test(v.text) && v.acts.join() === 'setup-close:off');
    check('the sheet\'s End and continue here says what it does', await page.evaluate((p) => { window.__endScene({ prep: p }); const b = document.querySelector('.dooms-atlas-setup-card [data-act="end-continue"]'); return /End and continue here/.test(b.textContent) && /same place, the same people, no time passed, so the world is not moved/.test(b.getAttribute('title')); }, prep));
    await page.evaluate(() => window.__endScene({ prep: null, error: 'The scene is not open.' }));
    v = await panel();
    check('a chat whose scene cannot be ended says why, and End cannot be pressed', /The scene is not open\./.test(v.text) && v.acts.join() === 'end-go:off,end-continue:off,setup-close');
    await page.evaluate(() => window.__setup(''));
    await page.evaluate(() => window.__set({ ending: null }));

    // The strip above a scene's chat (D176, D181): the scene, its place, its date and its length; the Atlas, Continue fresh and End scene.
    const strip = () => page.evaluate(() => { const el = document.getElementById('dooms-scene-strip'); const r = el.getBoundingClientRect(); return { text: el.querySelector('.dooms-strip-text span').textContent.trim(), nudge: (el.querySelector('.dooms-strip-nudge') || { textContent: '' }).textContent.trim(), note: (el.querySelector('.dooms-strip-note') || { textContent: '' }).textContent.trim(), acts: [...el.querySelectorAll('[data-act]')].map(x => `${x.getAttribute('data-act')}=${x.textContent.trim()}${x.disabled ? ':off' : ''}${x.classList.contains('is-nudged') ? ':lit' : ''}`), fits: el.scrollWidth <= el.clientWidth + 1, h: r.height }; });
    const mark = { scene: 's3', title: 'The gate at dusk', place: { label: 'Hask' }, startDate: 'Day 42' };
    await page.evaluate((m) => window.__strip({ mark: m, scene: null, ended: false, count: 37 }), mark);
    let st = await strip();
    check('the strip of a scene being played: the scene, its place, its date and how long it has run; the Atlas, Continue fresh and End scene', st.text === 'Scene 3: The gate at dusk · Hask · Day 42 · 37 messages' && st.nudge === '' && st.acts.join() === 'atlas=Atlas,continue=Continue fresh,end=End scene' && st.fits, JSON.stringify(st));
    await page.evaluate((m) => window.__strip({ mark: m, scene: null, ended: false, count: 61, long: true }), mark);
    st = await strip();
    check('past the length the player set, the strip says a fresh chat is worth it and Continue fresh is lit', st.text === 'Scene 3: The gate at dusk · Hask · Day 42 · 61 messages' && st.nudge === 'a good place to go on in a fresh chat' && st.acts.join() === 'atlas=Atlas,continue=Continue fresh:lit,end=End scene' && st.fits, JSON.stringify(st));
    check('Continue fresh says what it does', await page.evaluate(() => /End this scene and go straight on in a fresh chat: the same place, the same people, no time passed/.test(document.querySelector('#dooms-scene-strip [data-act="continue"]').getAttribute('title'))));
    await shot('7zj-strip-long');
    await page.evaluate((m) => window.__strip({ mark: m, scene: null, ended: false, count: 61, long: true, busy: 'Writing the record of the scene…' }), mark);
    st = await strip();
    check('while it goes on in a fresh chat the strip says what is being done and nothing can be pressed', st.text === 'Writing the record of the scene…' && st.nudge === '' && st.acts.join() === 'atlas=Atlas:off,continue=Continue fresh:off,end=End scene:off', JSON.stringify(st));
    await page.evaluate((m) => window.__strip({ mark: m, scene: null, ended: false, count: 61, long: true, note: 'The record of the scene could not be written. Use End scene to write it yourself.' }), mark);
    st = await strip();
    check('when it stops the strip says why, on a line of its own', st.note === 'The record of the scene could not be written. Use End scene to write it yourself.' && st.acts.length === 3 && st.fits);
    await page.evaluate((m) => window.__strip({ mark: { ...m, endDate: 'Day 42, night', endedAt: 9 }, scene: null, ended: true, count: 61 }), mark);
    st = await strip();
    check('the strip of a scene that has ended: says so, with the Atlas (where the next one starts), Continue fresh (straight on from it) and Reopen; its length is no longer told', st.text === 'Scene 3: The gate at dusk · ended · Day 42, night' && st.acts.join() === 'atlas=Atlas,continue=Continue fresh,reopen=Reopen', JSON.stringify(st));
    await page.evaluate(() => window.__strip(null));
}

console.log('\n§5j World gen: the land made first, the regions put on it (D182–D186)');
{
    const panelOf = () => page.evaluate(() => {
        const p = document.querySelector('.dooms-atlas-setup');
        const card = p.querySelector('.dooms-atlas-setup-card');
        const svg = p.querySelector('.dooms-atlas-worldgen-map');
        const box = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { w: b.width, h: b.height, left: b.left, right: b.right, top: b.top, bottom: b.bottom }; };
        return {
            shown: !p.hidden, title: card ? card.querySelector('h3').textContent : '', card: box(card), svg: box(svg), form: box(p.querySelector('.dooms-atlas-worldgen-form')),
            shapes: [...p.querySelectorAll('input[name="dooms-atlas-wg-shape"]')].map(i => [i.value, i.checked]), sizes: [...p.querySelectorAll('input[name="dooms-atlas-wg-size"]')].map(i => [i.value, i.checked]),
            modes: [...p.querySelectorAll('input[name="dooms-atlas-wg-mode"]')].map(i => [i.value, i.checked]),
            regions: (p.querySelector('.dooms-atlas-wg-regions') || {}).value, seed: (p.querySelector('.dooms-atlas-wg-seed') || {}).value,
            lands: p.querySelectorAll('.dooms-wg-land').length, added: p.querySelectorAll('.dooms-wg-land.is-added').length, names: [...p.querySelectorAll('.dooms-wg-name')].map(t => t.textContent), places: p.querySelectorAll('.dooms-wg-place').length, peaks: p.querySelectorAll('.dooms-wg-peak').length,
            rivers: p.querySelectorAll('.dooms-wg-river').length, climes: [...p.querySelectorAll('.dooms-wg-clime')].map(x => x.getAttribute('class').replace('dooms-wg-clime is-', '')), capped: p.querySelectorAll('.dooms-wg-peak.is-capped').length,
            caption: (p.querySelector('figcaption') || {}).textContent || '', acts: [...p.querySelectorAll('.dooms-atlas-setup-actions [data-act]')].map(x => [x.getAttribute('data-act'), x.disabled]),
            text: card ? card.textContent.replace(/\s+/g, ' ') : '', overflow: card ? card.scrollWidth > card.clientWidth + 1 : false,
        };
    });
    const mapOf = () => page.evaluate(() => {
        const q = (sel) => document.querySelectorAll(`#dooms-atlas .dooms-atlas-map ${sel}`).length;
        const m = window.__model;
        return {
            ground: document.querySelector('.dooms-atlas-map').getAttribute('data-ground'), bg: getComputedStyle(document.querySelector('.dooms-atlas-map')).backgroundColor,
            wild: q('path.dooms-atlas-wild'), shallows: q('path.dooms-atlas-shallows'), coastline: q('path.dooms-atlas-coastline'), forest: q('path.dooms-atlas-wood.is-forest'), lake: q('path.dooms-atlas-pond.is-lake'), peaks: q('path.dooms-atlas-peak'), trees: q('path.dooms-atlas-tree'),
            rivers: q('path.dooms-atlas-river'), climes: q('path.dooms-atlas-clime'), capped: q('path.dooms-atlas-peak.is-capped'), dunes: q('path.dooms-atlas-glyph.is-desert'), reeds: q('path.dooms-atlas-glyph.is-swamp'),
            lands: q('path.dooms-atlas-territory'), loose: q('path.dooms-atlas-territory.is-loose'), realm: q('path.dooms-atlas-realm'), beyond: q('path.dooms-atlas-beyond'), rocks: q('path.dooms-atlas-coast'),
            start: !document.querySelector('.dooms-atlas-start').hidden, tray: document.querySelectorAll('.dooms-atlas-tray-row').length, markers: m.markers.length, territories: m.territories.length, world: m.world,
            buttons: [...document.querySelectorAll('.dooms-atlas-tidy-buttons [data-act]')].map(x => `${x.getAttribute('data-act')}:${x.textContent.trim()}`), line: (document.querySelector('.dooms-atlas-world-line') || {}).textContent || '', groundSelect: !!document.querySelector('.dooms-atlas-ground-select'),
        };
    });

    // An empty map: the start panel offers it; the panel opens on Pangea with a handful of regions.
    await page.evaluate(() => window.__open({ world: 'campaign', book: window.A.normalizeBook({ gone: window.A.atlasModel({ pack: window.__pack || null, state: null, book: null }).all.map(x => x.id) }) }));
    await page.evaluate(() => { const m = window.A.atlasModel({ pack: window.__pack, state: null, book: null }); window.__book = null; window.__edit((b, model) => window.A.normalizeBook({ gone: [...model.tray, ...model.markers].map(x => x.id) })); });
    await settle();
    const bare = await mapOf();
    check('an empty map\'s start panel offers World gen first, and the list a Generate a world button', bare.start && (await page.evaluate(() => { const b = document.querySelector('.dooms-atlas-start [data-act="worldgen"]'); return !!b && /Generate a world/.test(b.textContent) && b.compareDocumentPosition(document.querySelector('.dooms-atlas-start [data-act="setup"]')) === Node.DOCUMENT_POSITION_FOLLOWING; })) && bare.buttons[0] === 'worldgen:Generate a world' && bare.groundSelect && !bare.line, JSON.stringify(bare.buttons));
    let info = await page.evaluate(() => window.__worldgen({}));
    let pn = await panelOf();
    check('the panel: four shapes, three sizes, the regions to add, the seed, and the world they make drawn beside them', pn.shown && pn.title === 'Generate a world' && same(pn.shapes, [['pangea', true], ['earth', false], ['islands', false], ['divide', false]]) && same(pn.sizes, [['small', false], ['medium', true], ['large', false]]) && pn.regions === '9' && pn.seed === 'alpha' && pn.svg && pn.svg.w > 400 && pn.svg.h > 250 && pn.lands === 9 && pn.added === 9 && pn.peaks > 10, JSON.stringify({ ...pn, text: '' }));
    check('an empty map is asked nothing about what is on it; nothing to remove yet', pn.modes.length === 0 && same(pn.acts, [['worldgen-apply', false], ['setup-close', false]]));
    check('the picture says what the world is: its landmasses, its size at the map\'s scale, its regions', /^1 landmass · about 3850 by 2650 miles · 9 regions$/.test(pn.caption) && pn.names.length === 9 && pn.names.includes('The Heartland'), pn.caption);
    check('the picture draws the world\'s rivers and climates: desert, snow and marsh, the peaks in the cold capped (D192)', pn.rivers >= 5 && same(pn.climes, ['desert', 'snow', 'swamp']) && pn.capped >= 1 && pn.capped < pn.peaks && /rivers and lakes, forests, deserts, snow and marsh/.test(pn.text), JSON.stringify([pn.rivers, pn.climes, pn.capped, pn.peaks]));
    check('the panel fits the window: the choices beside the picture, nothing cut off', !pn.overflow && pn.card.w <= VIEW.width && pn.card.bottom <= VIEW.height + 1 && pn.form.right <= pn.svg.left + 1 && /no AI request/.test(pn.text));
    await shot('60-worldgen-panel');
    for (const shape of ['earth', 'islands', 'divide']) {
        info = await page.evaluate((sh) => window.__worldgen({ shape: sh }), shape);
        pn = await panelOf();
        check(`${shape}: the picture follows the choice`, pn.shapes.find(x => x[0] === shape)[1] && pn.lands >= 6 && (shape === 'divide' ? /^[23] landmasses/.test(pn.caption) : /^\d+ landmasses/.test(pn.caption)), pn.caption);
        await shot(`61-worldgen-${shape}`);
    }
    await page.evaluate(() => window.__worldgen({ seed: '' }));
    pn = await panelOf();
    check('with no seed there is no world to use, and the panel says so', !pn.svg && pn.acts[0][1] === true && /needs a seed/.test(pn.text) && /Type a seed/.test(pn.caption));

    // Applied.
    await page.evaluate(() => window.__worldgen({ shape: 'pangea' }));
    const done = await page.evaluate(() => window.__applyWorld());
    await settle();
    let mp = await mapOf();
    check('applied: the map is the world, the sea its ground, the land on it with shallows, forests, lakes, peaks and its coast', done.added.length === 9 && mp.ground === 'world' && mp.wild === 1 && mp.shallows === 2 && mp.coastline === 1 && mp.forest === 1 && mp.lake === 1 && mp.peaks > 10 && mp.trees === 1 && !mp.start && /205, 210, 189/.test(mp.bg), JSON.stringify(mp));
    check('with its rivers, the ground of its desert, snow and marsh, its dunes and reeds, and snow on the peaks in the cold (D192)', mp.rivers >= 1 && mp.rivers <= 2 && mp.climes === 3 && mp.dunes === 1 && mp.reeds === 1 && mp.capped >= 1 && mp.capped < mp.peaks, JSON.stringify([mp.rivers, mp.climes, mp.dunes, mp.reeds, mp.capped, mp.peaks]));
    {
        const river = await page.evaluate(() => { const r = document.querySelector('path.dooms-atlas-river'); const c = document.querySelector('path.dooms-atlas-clime.is-snow'); const cs = getComputedStyle(r); return { fill: cs.fill, stroke: cs.stroke, width: parseFloat(cs.strokeWidth), long: r.getTotalLength(), snow: getComputedStyle(c).fill, snowStroke: getComputedStyle(c).stroke }; });
        check('a river is a line of water, not a shape; the snow a ground with no edge of its own', river.fill === 'none' && river.stroke !== 'none' && river.width >= 1 && river.long > 100 && /^rgba?\(/.test(river.snow) && river.snowStroke === 'none', JSON.stringify(river));
    }
    check('the nine regions stand on it, each a land with a dashed border: not canon yet', mp.lands === 9 && mp.loose === 9 && mp.territories === 9 && mp.markers === 9);
    const labels = await page.evaluate(() => [...document.querySelectorAll('.dooms-atlas-land-label .dooms-atlas-region-name')].map(x => ({ text: x.textContent, shown: getComputedStyle(x.parentElement).display !== 'none' && x.getBoundingClientRect().width > 0 })));
    check('each land carries its name on the map', labels.length === 9 && labels.every(x => x.shown) && labels.some(x => x.text === 'The Heartland'), JSON.stringify(labels));
    check('the list offers Change the world and Name the lands; the ground is told, not chosen', mp.buttons[0] === 'worldgen:Change the world' && mp.buttons[1] === 'names:Name the lands · 9' && !mp.groundSelect && /The ground is a generated world: Pangea, seed alpha\./.test(mp.line), JSON.stringify(mp.buttons));
    await shot('62-world-applied');
    // The whole world is in view, and a land names itself under the pointer.
    const view = await page.evaluate(() => { const b = window.__model.bounds; const map = window.__board.map; const a = map.latLngToContainerPoint([-b.minY, b.minX]), z = map.latLngToContainerPoint([-b.maxY, b.maxX]); const box = document.querySelector('.dooms-atlas-map').getBoundingClientRect(); return { left: a.x, top: a.y, right: z.x, bottom: z.y, w: box.width, h: box.height }; });
    check('the whole world is in view', view.left >= -2 && view.top >= -2 && view.right <= view.w + 2 && view.bottom <= view.h + 2 && (view.right - view.left > view.w * 0.6 || view.bottom - view.top > view.h * 0.9), JSON.stringify(view));

    // A region dragged: its borders follow, the coast does not.
    const before = await page.evaluate(() => { const t = window.__model.territories[0]; window.__coasts = window.__model.decor.coasts; return { id: t.id, outline: JSON.stringify(t.outline), x: t.x, y: t.y }; });
    await page.evaluate(() => window.__set({ moving: true }));
    await settle();
    const from = await spotOf(before.id);
    await page.mouse.move(from.sx, from.sy); await page.mouse.down(); await page.mouse.move(from.sx + 30, from.sy + 12, { steps: 5 }); await page.mouse.move(from.sx + 60, from.sy + 24, { steps: 5 }); await page.mouse.up();
    await settle();
    const after = await page.evaluate((id) => { const t = window.__model.territories.find(x => x.id === id); return { outline: JSON.stringify(t.outline), x: t.x, y: t.y, sameCoast: window.__model.decor.coasts === window.__coasts, lands: document.querySelectorAll('path.dooms-atlas-territory').length, coastlines: document.querySelectorAll('path.dooms-atlas-coastline').length }; }, before.id);
    check('a region dragged: its borders follow it, the coast stays where it is', (after.x !== before.x || after.y !== before.y) && after.outline !== before.outline && after.sameCoast && after.lands === 9 && after.coastlines === 1, JSON.stringify({ from: [before.x, before.y], to: [after.x, after.y], sameCoast: after.sameCoast, lands: after.lands }));
    await page.evaluate(() => window.__set({ moving: false }));

    // A place dropped on a land goes inside that region; inside, the land is the world's with the sea past its coast.
    const land = await page.evaluate(() => { const t = window.__model.territories.find(x => x.label === 'The Heartland') || window.__model.territories[0]; window.__edit((b) => { for (const [label, kind, dx, dy] of [['Hask', 'settlement', 0.4, 0.2], ['Redfall Castle', 'stronghold', 1.8, -1.2], ['Mirefen Ferry', 'water', -1.6, 1.1]]) b = window.A.addPin(b, { label, kind, x: t.x + dx, y: t.y + dy, layer: t.id }).book; return b; }); return { id: t.id, label: t.label }; });
    await page.evaluate((id) => window.__layer(id), land.id);
    await settle();
    mp = await mapOf();
    check('inside a region of the world: its own land, its neighbours around it, the world\'s terrain across it, the sea past the coast', mp.ground === 'world' && mp.realm === 1 && mp.beyond >= 2 && mp.wild === 1 && mp.coastline === 1 && mp.peaks > 10 && mp.forest === 1 && mp.rivers >= 1 && mp.climes === 3 && mp.markers === 3 && mp.world === null && mp.groundSelect, JSON.stringify(mp));
    check('the region\'s places stand on its land as the world\'s map has it', await page.evaluate(() => { const m = window.__model; return m.realm.k === 1 && m.markers.every(x => window.A.pointInPolygon(m.realm.outline, x.x, x.y)); }));
    await shot('63-world-inside-a-region');
    const card = await page.evaluate(async () => { const m = window.__model; const a = m.markers.find(x => x.label === 'Hask'), b = m.markers.find(x => x.label === 'Redfall Castle'); return { way: window.A.describeDistance(m, a.id, b.id), route: window.A.routeBetween(m, a.id, b.id) }; });
    check('the way between two of its places is told over the world\'s ground', /miles/.test(card.way) && card.route.hours > 0, card.way);
    await page.evaluate(() => window.__layer(''));
    await settle();

    // Made again: what was taken up stays, the rest is replaced; a map with things on it is asked what becomes of them.
    await page.evaluate((id) => window.__edit((b) => window.A.editMarker(b, id, { label: 'The Redward' })), land.id);
    info = await page.evaluate(() => window.__worldgen({ seed: 'beta', regions: 0 }));
    pn = await panelOf();
    check('made again: the panel opens on the world the map has, and can take it away', pn.title === 'Change the world' && pn.shapes[0][1] && same(pn.acts.map(a => a[0]), ['worldgen-apply', 'worldgen-remove', 'setup-close']) && info.defaults.seed === 'alpha' && info.defaults.regions === 8);
    check('a map with a region of the player\'s own is asked what becomes of it: around it, or clean', same(pn.modes, [['keep', true], ['clean', false]]) && /The 1 region on this map keeps its spot/.test(pn.text) && /The 8 regions the last world gen added that nobody named or filled are replaced/.test(pn.text), pn.text.slice(0, 1400));
    check('the picture shows the region kept where it is, by its name', pn.names.includes('The Redward') && pn.lands === 1 && pn.added === 0, JSON.stringify(pn.names));
    await shot('64-worldgen-again');
    info = await page.evaluate(() => window.__worldgen({ seed: 'beta', regions: 6, mode: 'clean', shape: 'divide' }));
    pn = await panelOf();
    check('clean: the picture has only the new regions, and says what waits to be put down again', pn.lands === 6 && pn.added === 6 && !pn.names.includes('The Redward') && /1 thing waits to be put down again/.test(pn.caption) && pn.modes[1][1], pn.caption);
    const again = await page.evaluate(() => window.__applyWorld());
    await settle();
    mp = await mapOf();
    check('applied clean: the player\'s region waits in the list with its places still inside it; the stand-ins are replaced', again.unplaced === 1 && again.replaced === 8 && again.added.length === 6 && mp.lands === 6 && mp.tray === 1 && (await page.evaluate(() => window.__model.tray[0].label === 'The Redward' && window.__model.tray[0].holds === 3)) && mp.world.shape === 'divide' && mp.world.seed === 'beta');
    // Put down again by a drag from the list: it takes the land around where it lands.
    await page.evaluate(() => {
        const w = window.__model.geo.world; const g = w.grid;
        const c = g.landCells.find(k => g.shore[k] >= 5 && g.kind[k] === 1 && window.__model.markers.every(m => Math.hypot(m.x - g.xOf(k), m.y - g.yOf(k)) > 4));
        const p = window.__board.map.latLngToContainerPoint([-g.yOf(c), g.xOf(c)]);
        const map = document.querySelector('.dooms-atlas-map');
        const box = map.getBoundingClientRect();
        const dt = new DataTransfer();
        document.querySelector('.dooms-atlas-tray-row').dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
        map.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: box.left + p.x, clientY: box.top + p.y }));
    });
    await settle();
    mp = await mapOf();
    check('a region dragged from the list onto the land takes the land around where it is put', mp.lands === 7 && mp.tray === 0 && (await page.evaluate(() => { const t = window.__model.territories.find(x => x.label === 'The Redward'); return !!t && t.area > 10 && window.A.territoryAt(window.__model, t.x, t.y) === t.id; })));
    await shot('65-world-divide-placed');

    // Naming the lands.
    await page.evaluate(() => window.__names({ step: 'ask', count: 6, wish: '' }));
    let nm = await page.evaluate(() => { const c = document.querySelector('.dooms-atlas-setup-card'); return { text: c.textContent.replace(/\s+/g, ' '), acts: [...c.querySelectorAll('[data-act]')].map(x => x.getAttribute('data-act')), wish: !!c.querySelector('.dooms-atlas-names-wish') }; });
    check('Name the lands: says what it costs and that the names are checked first', /6 lands of this world still carry a plain name\. One request/.test(nm.text) && /You check the names before any is used/.test(nm.text) && same(nm.acts, ['names-draft', 'setup-close']) && nm.wish);
    const names = await page.evaluate(() => { const m = window.__model; const p = window.W.buildNamesPrompt({ model: m, world: 'Vael' }); const reply = JSON.stringify({ lands: p.lands.map((l, i) => ({ n: l.n, name: ['Skaldmark', 'The Ashen Coast', 'Wyrmreach', 'Ostfold', 'The Drowned Shire', 'Thule'][i], note: 'A land of the far ' + ['north', 'coast', 'east', 'east', 'south', 'ice'][i] + '.' })) }); const r = window.W.parseNames(reply, m, p.lands); window.__namesList = r.names; window.__names({ step: 'review', count: p.count, names: r.names }); return { count: p.count, names: r.names.length, prompt: p.user }; });
    nm = await page.evaluate(() => { const c = document.querySelector('.dooms-atlas-setup-card'); const b = c.getBoundingClientRect(); return { rows: c.querySelectorAll('.dooms-atlas-name-row').length, first: c.querySelector('.dooms-atlas-name-row input').value, was: c.querySelector('.dooms-atlas-name-was').textContent, acts: [...c.querySelectorAll('.dooms-atlas-setup-actions [data-act]')].map(x => x.getAttribute('data-act')), fits: b.bottom <= window.innerHeight + 1 && c.scrollWidth <= c.clientWidth + 1 }; });
    check('the names to check: each beside the plain name it replaces, to change or leave out', names.count === 6 && names.names === 6 && nm.rows === 6 && nm.first === 'Skaldmark' && /^was (The Heartland|\w+ \w+)/.test(nm.was) && same(nm.acts, ['names-apply', 'names-again', 'setup-close']) && nm.fits && /The lands that have their names \(do not rename them\):\n- The Redward/.test(names.prompt), JSON.stringify(nm));
    await shot('66-names-review');
    await page.evaluate(() => { window.__edit((b) => window.W.applyNames(b, window.__namesList)); window.__names(null); });
    await settle();
    mp = await mapOf();
    check('used: the lands carry their names, still not canon, and nothing is left to name', mp.loose === 7 && !mp.buttons.some(b => b.startsWith('names:')) && (await page.evaluate(() => ['Skaldmark', 'Thule'].every(n => window.__model.territories.some(t => t.label === n)))), JSON.stringify({ loose: mp.loose, buttons: mp.buttons, labels: await page.evaluate(() => window.__model.territories.map(t => t.label)) }));
    await page.evaluate(() => window.__board.fit());
    await settle();
    await shot('67-world-named');
}

console.log('\n§5k the scenes of a world in the Atlas: the list, the ways in, the world picker (D193, D194)');
{
    await page.evaluate(() => window.__open({ world: 'campaign', book: null }));
    await settle();
    const scenes = [
        { id: 's1', title: 'The Fourth Landing', status: 'ended', place: { id: 'pin:hask', label: 'Hask' }, cast: ['Kiyoha', 'Lysandra'], startDate: '9th of Frostfall', endDate: '10th of Frostfall', recap: 'The company came up from the Fourth Landing with the inkstone; Kiyoha walked out on her own feet.' },
        { id: 's2', title: 'A debt called in', status: 'ended', place: { id: '', label: 'The Anchor' }, cast: ['Old Marit'], startDate: '11th of Frostfall', endDate: '11th of Frostfall', recap: '', conflicts: [{ text: 'x' }, { text: 'y' }] },
        { id: 's3', title: 'Lost on the moor', status: 'ended', gone: true, place: { id: '', label: '' }, cast: [], recap: 'Gone.' },
        { id: 's4', title: 'The long watch', status: 'aside', place: { id: 'pin:redfall-castle', label: 'Redfall Castle' }, cast: ['Dagger'], startDate: '12th of Frostfall' },
        { id: 's5', title: 'Fog on the quay', status: 'open', place: { id: '', label: 'Saltport, the quay' }, cast: ['Kiyoha'], startDate: '14th of Frostfall', reopened: true },
    ];
    const side = () => page.evaluate(() => {
        const el = document.querySelector('.dooms-atlas-side');
        const body = el.querySelector('.dooms-atlas-body');
        return {
            tabs: [...el.querySelectorAll('.dooms-atlas-tab')].map(t => t.getAttribute('data-tab') + (t.classList.contains('is-active') ? '*' : '')),
            tabsFit: [...el.querySelectorAll('.dooms-atlas-tab')].every(t => t.scrollWidth <= t.clientWidth + 1), fits: body.scrollWidth <= body.clientWidth + 1,
            rows: [...el.querySelectorAll('.dooms-atlas-scene')].map(li => ({ id: li.getAttribute('data-id'), cls: li.className.replace('dooms-atlas-scene ', ''), tags: [...li.querySelectorAll('.dooms-atlas-scene-tag')].map(x => x.textContent), acts: [...li.querySelectorAll('[data-act]')].map(x => x.getAttribute('data-act') + (x.disabled ? '!' : '')), meta: (li.querySelector('.dooms-atlas-scene-meta') || {}).textContent || '', recap: (li.querySelector('.dooms-atlas-scene-recap') || {}).textContent || '' })),
            top: (el.querySelector('.dooms-atlas-scenes-top') || { textContent: '' }).textContent.replace(/\s+/g, ' ').trim(), topActs: [...el.querySelectorAll('.dooms-atlas-scenes-top [data-act]')].map(x => x.getAttribute('data-act')),
            text: body.textContent.replace(/\s+/g, ' ').trim(),
        };
    });

    // The Scenes tab.
    await page.evaluate(() => window.__side({ tab: 'places', body: '' }));
    let sd = await side();
    check('a world not played as scenes has five tabs and no Scenes', same(sd.tabs, ['places*', 'people', 'news', 'rumours', 'hooks']));
    await page.evaluate((sc) => window.__side({ tab: 'scenes', scenesTab: true, body: window.__V.atlasSceneListHtml({ scenes: sc, plan: { ok: false, reason: 'scene-open' }, why: 'Scene 5 (Fog on the quay) is open: end it or set it aside first.', front: 's5' }) }), scenes);
    sd = await side();
    check('a world played as scenes has a sixth tab, Scenes, and all six fit the sidebar', same(sd.tabs, ['places', 'people', 'news', 'rumours', 'hooks', 'scenes*']) && sd.tabsFit && sd.fits);
    check('the list: the scene being played first, then the one set aside, then the ended ones newest first', same(sd.rows.map(r => r.id), ['s5', 's4', 's3', 's2', 's1']));
    const row = (id) => sd.rows.find(r => r.id === id);
    check('the scene in front is being played: it is ended or set aside from here', same(row('s5').tags, ['being played', 'reopened']) && same(row('s5').acts, ['sc-end', 'sc-aside']) && /is-open/.test(row('s5').cls) && /is-front/.test(row('s5').cls) && row('s5').meta === 'Saltport, the quay · Kiyoha · from 14th of Frostfall');
    check('one set aside is resumed, or ended; an ended one is read again or gone on from; one whose chat is gone can only be removed', same(row('s4').acts, ['sc-resume', 'sc-end', 'sc-delete']) && same(row('s1').acts, ['sc-open', 'sc-continue!']) && same(row('s3').acts, ['sc-remove']) && same(row('s3').tags, ['chat gone']));
    check('Delete is for a scene that never ended (D197): the one set aside has it; an ended one has none, nor has one that was ended and reopened, though it is being played', row('s4').acts.includes('sc-delete') && !row('s1').acts.includes('sc-delete') && !row('s2').acts.includes('sc-delete') && !row('s5').acts.includes('sc-delete'));
    {
        // Delete asks on the scene's own row before anything goes.
        const list = (o) => page.evaluate(([sc, extra]) => window.__side({ tab: 'scenes', scenesTab: true, body: window.__V.atlasSceneListHtml({ scenes: sc, plan: { ok: false, reason: 'scene-open' }, why: 'Scene 6 is open: end it or set it aside first.', front: 's6', ...extra }) }), [[...scenes.filter(x => x.id !== 's5'), { id: 's6', title: 'A wrong turn', status: 'open', place: { id: '', label: 'The moor' }, cast: ['Kiyoha'], startDate: '15th of Frostfall' }], o]);
        await list({});
        sd = await side();
        check('a scene being played that never ended can be deleted too, beside End and Set aside', same(row('s6').acts, ['sc-end', 'sc-aside', 'sc-delete']) && same(row('s4').acts, ['sc-resume', 'sc-end', 'sc-delete']));
        await list({ deleting: 's4' });
        sd = await side();
        const ask = await page.evaluate(() => { const li = document.querySelector('.dooms-atlas-scene[data-id="s4"]'); const c = li.querySelector('.dooms-atlas-scene-confirm'); const go = c.querySelector('[data-act="sc-delete-go"]'); const b = c.getBoundingClientRect(); const body = document.querySelector('.dooms-atlas-body').getBoundingClientRect(); return { text: c.textContent.replace(/\s+/g, ' ').trim(), role: c.getAttribute('role'), go: go.textContent.trim(), goBg: getComputedStyle(go).backgroundColor, inside: b.left >= body.left && b.right <= body.right + 1 }; });
        check('pressed, Delete asks on the scene\'s own row: what goes, that the world stays as it is, that it cannot be undone', same(row('s4').acts, ['sc-delete-go', 'sc-delete-no']) && ask.role === 'alertdialog' && /^Delete scene 4 and its chat\? The chat is removed from SillyTavern\. Nothing of this scene was remembered, so the world stays as it is\. This cannot be undone\./.test(ask.text) && ask.go === 'Delete scene 4' && ask.inside && sd.fits, JSON.stringify(ask));
        check('the other scenes keep their own buttons while one is asked about', same(row('s6').acts, ['sc-end', 'sc-aside', 'sc-delete']) && same(row('s1').acts, ['sc-open', 'sc-continue!']));
        await shot('68b-scene-delete-ask');
        await list({ deleting: 's6' });
        sd = await side();
        const front = await page.evaluate(() => document.querySelector('.dooms-atlas-scene[data-id="s6"] .dooms-atlas-scene-confirm').textContent.replace(/\s+/g, ' ').trim());
        check('for the scene in front it says another chat opens in its place', /The chat is removed from SillyTavern, and another chat opens in its place\./.test(front), front);
        await list({ busy: 's4' });
        sd = await side();
        check('while one is being deleted its row says so, and no other Delete can be pressed', /Deleting…/.test(await page.evaluate(() => document.querySelector('.dooms-atlas-scene[data-id="s4"]').textContent)) && same(row('s4').acts, []) && same(row('s6').acts, ['sc-end', 'sc-aside', 'sc-delete!']));
        await list({ deleting: 's1' });
        sd = await side();
        check('an ended scene is never asked about, whatever is asked for', same(row('s1').acts, ['sc-open', 'sc-continue!']) && !(await page.evaluate(() => !!document.querySelector('.dooms-atlas-scene-confirm'))));
        // The list as it was, for the checks after this.
        await page.evaluate((sc) => window.__side({ tab: 'scenes', scenesTab: true, body: window.__V.atlasSceneListHtml({ scenes: sc, plan: { ok: false, reason: 'scene-open' }, why: 'Scene 5 (Fog on the quay) is open: end it or set it aside first.', front: 's5' }) }), scenes);
        sd = await side();
    }
    check('an ended scene shows its record, or says none was kept, and what it found against canon', /^The company came up/.test(row('s1').recap) && row('s2').recap === 'No record was kept.' && same(row('s2').tags, ['ended', '2 against canon']) && row('s2').meta === 'The Anchor · Old Marit · from 11th of Frostfall to 11th of Frostfall');
    check('while a scene is open no other is started, and the list says why', same(sd.topActs, []) && /Scene 5 \(Fog on the quay\) is open: end it or set it aside first\./.test(sd.top));
    await shot('68-scenes-tab');
    await page.evaluate((sc) => window.__side({ tab: 'scenes', scenesTab: true, between: { open: null }, body: window.__V.atlasSceneListHtml({ scenes: sc.map(s => (s.id === 's5' ? { ...s, status: 'ended', endDate: '14th of Frostfall', recap: 'Fog, and a boat that did not come.' } : s)), plan: { ok: true, number: 6 }, why: '', front: 's5' }) }), scenes);
    sd = await side();
    check('between scenes: Start scene 6 at the top, the ended scene in front is not opened again, and any ended scene can be gone on from', same(sd.topActs, ['scene-new']) && /^Start scene 6/.test(sd.top) && same(row('s5').acts, ['sc-open!', 'sc-continue']) && same(row('s1').acts, ['sc-open', 'sc-continue']) && same(sd.rows.map(r => r.id), ['s4', 's5', 's3', 's2', 's1']));
    await page.evaluate(() => window.__side({ tab: 'scenes', scenesTab: true, body: window.__V.atlasSceneListHtml({ scenes: [], plan: { ok: true, number: 1 }, why: '' }) }));
    sd = await side();
    check('a world with no scene yet says what a scene is, and offers the first', same(sd.topActs, ['scene-new']) && /No scene has been played in this world yet/.test(sd.text) && sd.rows.length === 0);

    // The ways in.
    const ways = await page.evaluate(() => {
        // A small world with a clock, so there is something said on the street.
        const pk = window.__lw.normalizePack({ id: 'quayside', name: 'Quayside', places: [{ id: 'the-docks', label: 'The Docks' }], cast: [{ name: 'Old Marit', tier: 'major', place: 'the-docks' }], clocks: [{ id: 'blockade', label: 'The blockade', place: 'the-docks', start: 1, max: 3, step: 1, effects: { 0: 'Ships come and go as they please.', 1: 'A navy cutter sits at the harbour mouth; captains grumble.', 2: 'Cargo is searched on the quay.', 3: 'The harbour is closed.' } }] }).pack;
        const st = window.__lw.seedWorldState(pk, { name: 'Quayside' });
        const cfg = { spoilerFree: false };
        const V = window.__V;
        const plainNews = V.atlasWaysHtml({ kind: 'news', on: false, body: V.newsHtml({ state: st, pack: pk, cfg }) });
        window.__side({ tab: 'rumours', scenesTab: true, between: { open: null }, body: V.atlasWaysHtml({ kind: 'rumour', on: true, number: 6, body: V.rumoursHtml({ state: st, pack: pk, cfg }) }) });
        const li = document.querySelector('.dooms-atlas-ways[data-way="rumour"] .dooms-world-effects li');
        const out = { plain: !/dooms-atlas-ways/.test(plainNews), lines: document.querySelectorAll('.dooms-atlas-ways[data-way="rumour"] .dooms-world-effects li').length, cursor: li ? getComputedStyle(li).cursor : '', index: li ? li.getAttribute('data-i') : null, hint: (document.querySelector('.dooms-atlas-ways > .dooms-atlas-start-note') || {}).textContent || '' };
        const people = V.atlasWaysHtml({ kind: 'person', on: true, number: 6, body: V.peopleHtml({ state: st, pack: pk, portraits: () => '', present: [] }) });
        out.person = /data-way="person"/.test(people) && /A face is a way in: its card has Start a scene with them \(scene 6\)\./.test(people);
        return out;
    });
    check('a line of Rumours is a way into a scene while one can be started: it is pressed like a button, carries its place in the list, and the tab says so', ways.lines >= 1 && ways.cursor === 'pointer' && ways.index === '0' && /A line is a way in: click one to start scene 6 from it\./.test(ways.hint), JSON.stringify(ways));
    check('while none can be started the tab is as it was; People says where the way in is', ways.plain && ways.person);
    await shot('69-rumours-as-ways-in');

    // Hooks between scenes.
    const hooks = { proposed: [{ id: 'h1', title: 'The cellar door', text: 'See what the Anchor keeps behind its cellar door.', grounds: 'Old Marit' }, { id: 'h2', title: 'The drowned bell', text: 'Find who rang it.', grounds: '' }], taken: [{ id: 'h0', title: 'The inkstone' }], aside: [], last: null };
    const hk = (o) => page.evaluate((x) => { window.__side({ tab: 'hooks', scenesTab: true, between: { open: null }, body: window.__V.atlasWorldHooksHtml(x) }); const el = document.querySelector('.dooms-atlas-body'); return { acts: [...el.querySelectorAll('[data-act]')].map(b => b.getAttribute('data-act') + (b.disabled ? '!' : '')), ids: [...el.querySelectorAll('[data-act="hook-play"]')].map(b => b.getAttribute('data-hook')), text: el.textContent.replace(/\s+/g, ' '), fits: el.scrollWidth <= el.clientWidth + 1 }; }, o);
    let hv = await hk({ hooks, busy: false, sceneOpen: false, canStart: true });
    check('between scenes a hook is played as a scene or set aside, and others are asked for, over the world\'s memory', same(hv.acts, ['hook-play', 'hook-drop', 'hook-play', 'hook-drop', 'hooks-offer']) && same(hv.ids, ['h1', 'h2']) && /Play as a scene/.test(hv.text) && /Offer others/.test(hv.text) && /Played/.test(hv.text) && hv.fits, JSON.stringify(hv.acts));
    await shot('70-hooks-between-scenes');
    hv = await hk({ hooks, busy: false, sceneOpen: true, canStart: false, why: 'Scene 5 is open: end it or set it aside first.' });
    check('while a scene of the world is being played its round is only read: nothing is played, set aside or asked for', same(hv.acts, ['hook-play!', 'hook-drop!', 'hook-play!', 'hook-drop!', 'hooks-offer!']));
    hv = await hk({ hooks: null, busy: true, sceneOpen: false, canStart: true });
    check('with no round yet it says so, and while one is asked for the button waits', /Asking the world…/.test(hv.text) && same(hv.acts, ['hooks-offer!']));

    // The world picker.
    const pick = (o) => page.evaluate((x) => { window.__side({ tab: 'places', body: '', ...x }); const sel = document.querySelector('.dooms-atlas-world-select'); const head = document.querySelector('.dooms-atlas-head'); const b = document.querySelector('.dooms-atlas-between'); return { has: !!sel, options: sel ? [...sel.options].map(op => `${op.value}|${op.textContent.trim()}${op.selected ? '*' : ''}`) : [], fits: head.scrollWidth <= head.clientWidth + 1, between: b ? b.textContent.replace(/\s+/g, ' ').trim() : '', go: b ? !!b.querySelector('[data-act="scene-go"]') : false }; }, o);
    let pk = await pick({});
    check('with no world played as scenes there is nothing to pick', !pk.has);
    pk = await pick({ worlds: [{ id: 'first-descent', name: 'First Descent', card: 'The Redward' }, { id: 'newland', name: 'Newland', card: '' }], chatWorld: 'Harbourside Nights' });
    check('the picker: this chat\'s world first, then every world of the player\'s own; one with no narrator card says so', pk.has && same(pk.options, ['|This chat: Harbourside Nights*', 'first-descent|First Descent', 'newland|Newland (no narrator card)']) && pk.fits, JSON.stringify(pk.options));
    pk = await pick({ worlds: [{ id: 'first-descent', name: 'First Descent', card: 'The Redward' }], picked: 'first-descent', chatWorld: 'Harbourside Nights', between: { open: { id: 's5', number: '5', title: 'Fog on the quay' }, picked: true, fresh: false } });
    check('a world picked is shown as it stands between scenes, whatever chat is open; a scene of it being played is named, with the way to it', same(pk.options, ['|This chat: Harbourside Nights', 'first-descent|First Descent*']) && /^This world as it stands between scenes, whatever chat is open\. Scene 5 \(Fog on the quay\) is being played, and the map is changed there\./.test(pk.between) && pk.go && pk.fits, pk.between);
    await shot('71-world-picker');
    pk = await pick({ worlds: [{ id: 'newland', name: 'Newland', card: 'Narrator' }], picked: 'newland', chatWorld: '', between: { open: null, picked: true, fresh: true } });
    check('a world no scene has ended in says this is where it begins; with no chat\'s world the first choice is just "This chat"', /^No scene of this world has ended yet: this is where it begins\.$/.test(pk.between) && pk.options[0] === '|This chat' && !pk.go, pk.between);
    pk = await pick({ between: { open: null } });
    check('between scenes in the chat\'s own world the word is as it was', /^Between scenes: the world as it stands now, not as this chat left it\.$/.test(pk.between));
    await page.evaluate(() => window.__draw());

    // The sheet opened from something other than a place's card.
    const sheet = (o) => page.evaluate((x) => { window.__sceneStart(x); const el = document.querySelector('.dooms-atlas-setup-card'); const sel = el.querySelector('.dooms-atlas-scene-where'); const typed = el.querySelector('.dooms-atlas-scene-where-new'); const b = el.getBoundingClientRect(); return { title: el.querySelector('h3').textContent, from: (el.querySelector('.dooms-atlas-scene-from') || {}).textContent ? el.querySelector('.dooms-atlas-scene-from').textContent.replace(/\s+/g, ' ').trim() : '', where: sel ? [...sel.options].map(op => `${op.value}|${op.textContent.trim()}${op.selected ? '*' : ''}`) : null, typedShown: typed ? !typed.hidden && typed.getBoundingClientRect().height > 0 : false, typed: typed ? typed.value : '', seed: el.querySelector('.dooms-atlas-scene-seed').value, ticked: [...el.querySelectorAll('input[name="dooms-atlas-cast"]:checked')].map(i => i.value), extra: el.querySelector('.dooms-atlas-scene-who').value, text: el.textContent.replace(/\s+/g, ' '), inside: b.top >= 0 && b.bottom <= innerHeight && b.right <= innerWidth, overflow: el.scrollWidth > el.clientWidth + 1 }; }, o);
    const places = [{ id: 'pin:hask', label: 'Hask', where: '' }, { id: 'pin:redfall-castle', label: 'Redfall Castle', where: 'The Redward' }, { id: 'pin:saltport', label: 'Saltport', where: '' }];
    const people = [{ name: 'Kiyoha', here: true }, { name: 'Dagger', here: false }, { name: 'Lysandra', here: false }];
    const base = { step: 'form', sceneNo: 6, card: 'The Redward', people, gap: { id: 'later', words: '' }, journey: '', note: '' };
    let sv = await sheet({ ...base, place: { id: '', label: '' }, places, cast: [], seedText: '' });
    check('started from nothing: the sheet has a Where to choose, opening where the story left off; it is "Scene 6" until a place is chosen', sv.title === 'Scene 6' && same(sv.where, ['|Where the story left off*', 'pin:hask|Hask', 'pin:redfall-castle|Redfall Castle (The Redward)', 'pin:saltport|Saltport', '__new__|Somewhere new…']) && !sv.typedShown && sv.from === '' && /What brings the party there/.test(sv.text) && sv.inside && !sv.overflow, JSON.stringify(sv.where));
    sv = await sheet({ ...base, place: { id: 'pin:redfall-castle', label: 'Redfall Castle' }, places, cast: ['Kiyoha'], seed: { kind: 'person', label: 'Kiyoha' }, from: { kind: 'person', label: 'Kiyoha' }, seedText: '' });
    check('from a person: the place they were last seen chosen, they ticked, and the sheet says who it is with', sv.title === 'Scene 6 at Redfall Castle' && sv.where.includes('pin:redfall-castle|Redfall Castle (The Redward)*') && same(sv.ticked, ['Kiyoha']) && /^With Kiyoha: the sheet opens where they were last seen\.$/.test(sv.from) && /What brings the party here/.test(sv.text), sv.from);
    sv = await sheet({ ...base, place: { id: '', label: '' }, places, cast: [], from: { kind: 'rumour' }, seedText: 'They say the harbour chain was cut from the inside.' });
    check('from a rumour: what it says is what brings the party, to change as you like', /^From a rumour: it is what brings the party, below\. Change it as you like\.$/.test(sv.from) && sv.seed === 'They say the harbour chain was cut from the inside.');
    sv = await sheet({ ...base, place: { id: '', label: '' }, places, cast: [], from: { kind: 'hook', label: 'The cellar door' }, seedText: 'See what the Anchor keeps behind its cellar door.' });
    check('from a hook: the sheet names it and says the scene takes it as a quest', /^From the hook “The cellar door”: the scene takes it as a quest\.$/.test(sv.from) && /^See what the Anchor keeps/.test(sv.seed));
    sv = await sheet({ ...base, place: { id: '', label: 'The Anchor' }, whereNew: 'The Anchor', places, cast: [], extra: 'Old Marit', from: { kind: 'scene', label: 'scene 2, A debt called in' }, seedText: 'The scene before: none.' });
    check('going on from a scene at a place that is on no map: Somewhere new, its name typed in, its people named; the sheet says which scene', sv.where.includes('__new__|Somewhere new…*') && sv.typedShown && sv.typed === 'The Anchor' && sv.title === 'Scene 6 at The Anchor' && sv.extra === 'Old Marit' && /^Going on from scene 2, A debt called in: the same place and the same people, to change as you like\.$/.test(sv.from) && sv.inside && !sv.overflow, JSON.stringify([sv.where, sv.typed, sv.from]));
    await shot('72-scene-from-a-scene');
    sv = await sheet({ ...base, place: { id: 'pin:hask', label: 'Hask' }, cast: [], seedText: '' });
    check('from a place\'s own card the sheet is as it was: the place given, no Where to choose', sv.where === null && sv.title === 'Scene 6 at Hask' && sv.from === '');
    await page.evaluate(() => { const p = document.querySelector('.dooms-atlas-setup'); p.hidden = true; p.innerHTML = ''; });

    // A place's picture is drawn from its card (D195, the old Map window's Draw).
    await page.evaluate(() => window.__open({ world: 'campaign', book: window.A.normalizeBook({ gone: window.A.atlasModel({ pack: window.__pack || null, state: null, book: null }).all.map(x => x.id) }) }));
    await page.evaluate(() => window.__edit((b, m) => window.A.addPin(window.A.normalizeBook({ gone: [...m.tray, ...m.markers].map(x => x.id) }), { label: 'Hask', kind: 'settlement', x: 0, y: 0 }).book));
    await page.evaluate(() => window.__board.fit());
    await settle();
    const tools = async (draw) => {
        await page.evaluate((d) => { window.__board.closeCard(); window.__set({ draw: d }); }, draw);
        await page.locator('#dooms-atlas .dooms-atlas-marker', { hasText: 'Hask' }).first().locator('.dooms-atlas-pin').click();
        await settle();
        return page.evaluate(() => { const card = document.querySelector('.dooms-atlas-card'); const row = card.querySelector('.dooms-atlas-card-tools'); const d = row.querySelector('[data-act="draw"]'); const acts = [...row.querySelectorAll('[data-act]')].map(x => x.getAttribute('data-act')); return { acts, draw: d ? { text: d.textContent.trim(), off: d.disabled, title: d.getAttribute('title'), place: d.getAttribute('data-place'), spin: !!d.querySelector('.fa-spinner') } : null, fits: row.scrollWidth <= row.clientWidth + 1 && card.scrollWidth <= card.clientWidth + 1, oneRow: new Set([...row.children].map(x => Math.round(x.getBoundingClientRect().top))).size === 1 }; });
    };
    let tl = await tools(null);
    const plainTools = tl.acts.length;
    check('a place the story has not been to in this chat has no Draw on its card', !tl.draw && !tl.acts.includes('draw') && tl.fits);
    tl = await tools({ id: 'pin:hask', drawn: false, busy: false, mine: false, problem: '' });
    check('a place the story has been to has Draw among its card\'s tools, for that place, and the tools still fit on one row', !!tl.draw && tl.draw.text === 'Draw' && !tl.draw.off && tl.draw.place === 'pin:hask' && /Settings → Image Generation/.test(tl.draw.title) && tl.acts.length === plainTools + 1 && tl.acts[1] === 'draw' && tl.fits && tl.oneRow, JSON.stringify(tl));
    await shot('73-card-draw');
    tl = await tools({ id: 'pin:hask', drawn: true, busy: false, mine: false, problem: '' });
    check('one that has a picture offers Redraw', tl.draw.text === 'Redraw' && !tl.draw.off && /Draw it again/.test(tl.draw.title));
    tl = await tools({ id: 'pin:hask', drawn: false, busy: true, mine: true, problem: '' });
    check('while its picture is being made the tool says so and waits', tl.draw.text === 'Drawing…' && tl.draw.off && tl.draw.spin && tl.fits);
    tl = await tools({ id: 'pin:hask', drawn: false, busy: false, mine: false, problem: 'no ComfyUI workflow is chosen on Settings → Image Generation' });
    check('with no way to draw the tool is off and says why', tl.draw.off && /^Cannot draw: no ComfyUI workflow is chosen/.test(tl.draw.title));
    await page.evaluate(() => { window.__board.closeCard(); window.__set({ draw: null }); });
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
        sides[look || 'default'] = await page.evaluate(() => { const cs = getComputedStyle(document.querySelector('.dooms-atlas-side')); return cs.backgroundImage + ' ' + cs.color + ' ' + cs.fontFamily; });
        check(`the look "${look || 'default'}": the window, the markers and the land`, near(l.atlas.width, VIEW.width, 1) && l.count === 5 && l.ground === 'country' && l.groundLines === 0 && !l.overflowX && !l.sideOverflow);
        await shot(`8-look-${look || 'default'}`);
    }
    check('the looks colour the sidebar their own way', new Set(Object.values(sides)).size >= 3, JSON.stringify(sides));
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => window.__open({ look: '', world: 'campaign' }));
    await settle();
    l = await layout();
    check('a phone: the map fills it, and the sidebar is the whole screen over it', near(l.stage.width, 390, 1) && near(l.stage.left, 0, 1) && near(l.side.width, 390, 1) && near(l.side.height, 844, 1) && !l.overflowX);
    await shot('9-phone');
}

console.log('\n§8 nothing shows through the Atlas, and a phone (D196: the owner\'s report)');
{
    // The owner's phone: a look, a theme whose tint is mostly see-through, and the chat behind.
    await page.setViewportSize({ width: 412, height: 800 });
    await page.evaluate(() => {
        const chat = document.createElement('div');
        chat.id = 'page-behind';
        chat.style.cssText = 'position:fixed;inset:0;z-index:1;font:700 22px/1.5 Georgia,serif;color:#00ff9c;background:#fff;padding:10px;overflow:hidden;';
        chat.textContent = 'Eighth bell, three quarters. The house on the lane above the temple, the kitchen. '.repeat(40);
        document.body.appendChild(chat);
        for (const [k, v] of Object.entries({ '--dooms-ui-bg': 'rgba(14, 4, 46, 0.25)', '--dooms-ui-text': '#00e08a', '--dooms-ui-highlight': '#ff2bd6', '--dooms-ui-border': '#ff2bd6', '--dooms-ui-accent': 'rgba(255, 43, 214, 0.12)' })) document.body.style.setProperty(k, v);
    });
    const theme = { tab: 'places', scenesTab: true, worlds: [{ id: 'eld', name: 'The Eld', card: 'Narrator' }], chatWorld: 'The Eld', status: 'Last advanced on Tail of Harvestide, the second morning after the return (about three quarters of a bell, from a quarter past the Eighth bell to the Ninth passed) · next run in 2 replies.', result: 'This chat is not a scene, so there is nothing to end.', canAdvance: true, scenes: true };
    const openOn = async (look) => {
        await page.evaluate((k) => window.__open({ look: k, world: 'campaign', book: null }), look);
        await page.evaluate(() => window.__edit((b, m) => window.A.placeAll(b, m)));
        await page.evaluate(() => window.__board.fit());
        await settle();
        await page.evaluate((o) => window.__side({ ...o, body: document.querySelector('.dooms-atlas-body').innerHTML }), theme);
    };
    /** Whether an element paints every pixel of its box: a colour with no see-through in it under whatever else it paints. */
    const solid = (sel) => page.evaluate((q) => {
        const el = document.querySelector(q);
        if (!el) return 'missing';
        const c = getComputedStyle(el).backgroundColor;
        const m = /\/\s*([\d.]+)\s*\)$/.exec(c) || /^rgba\([^)]*,\s*([\d.]+)\s*\)$/.exec(c);
        const alpha = c === 'transparent' ? 0 : m ? Number(m[1]) : 1;
        return alpha === 1 ? 'solid' : `see-through (${c})`;
    }, sel);
    const prep = { ok: true, scene: { id: 's3', title: 'The gate at dusk' }, recap: 'They met at the gate in the fog; Kiyoha carried the new healer\'s pack and said nothing about it.', from: 'Day 42', to: 'Day 42, night', stale: false, canonDone: false, steps: { canon: true, world: true }, continuity: { people: [{ name: 'Kiyoha', now: 'At the gate, carrying the healer\'s pack.', was: 'In the yard.' }, { name: 'Solveig', now: 'Has set her rule.', was: '' }], threads: { open: [{ id: 't1', text: 'Who cut the harbour chain?' }], opened: ['What is in the healer\'s pack?'], closed: [] } } };
    for (const look of ['console', 'lumen', '']) {
        await openOn(look);
        const name = look || 'no look';
        const window_ = await solid('#dooms-atlas'), side = await solid('.dooms-atlas-side');
        await page.evaluate(() => { document.getElementById('dooms-atlas').classList.add('is-folded'); window.__board.size(); });
        await settle();
        const tool = await solid('.dooms-atlas-tools .dooms-atlas-tool');
        await page.locator('#dooms-atlas .dooms-atlas-marker').first().locator('.dooms-atlas-pin').click();
        await settle();
        const card = await solid('.dooms-atlas-popup .leaflet-popup-content-wrapper');
        await page.evaluate(() => { window.__board.closeCard(); document.getElementById('dooms-atlas').classList.remove('is-folded'); });
        await page.evaluate((p) => window.__endScene({ prep: p }), prep);
        await settle();
        const sheet = await solid('.dooms-atlas-setup-card'), bar = await solid('.dooms-atlas-setup-card.is-end .dooms-atlas-setup-actions');
        await page.evaluate(() => { const p = document.querySelector('.dooms-atlas-setup'); p.hidden = true; p.innerHTML = ''; });
        check(`${name}, a see-through theme: the window, the sidebar, the map's tools, a place's card, a sheet and its bar of buttons are all solid`, [window_, side, tool, card, sheet, bar].every(x => x === 'solid'), JSON.stringify({ window: window_, side, tool, card, sheet, bar }));
    }
    await openOn('console');
    const seen = await page.evaluate(() => { const hit = (x, y) => { const el = document.elementFromPoint(x, y); return el ? (el.closest('#dooms-atlas') ? 'atlas' : el.id || el.tagName) : 'nothing'; }; return [[10, 10], [200, 400], [400, 790], [206, 60]].map(([x, y]) => hit(x, y)); });
    check('and the page behind is under it at every corner', seen.every(x => x === 'atlas'), JSON.stringify(seen));
    const ink = await page.evaluate(() => { const on = (sel) => { const el = document.querySelector(sel); if (!el) return 'missing'; const c = getComputedStyle(el).color; return /\/\s*0?\.\d+\s*\)$/.test(c) || /^rgba\(/.test(c) ? `see-through (${c})` : 'solid'; }; document.querySelector('.dooms-atlas-setup').hidden = true; return on('.dooms-atlas-here, .dooms-atlas-tray-here, .dooms-atlas-btn.is-primary'); });
    check('what is written on the accent can be read: it is solid too', ink === 'solid' || ink === 'missing', ink);

    // The sidebar on a phone: the whole screen, with its own way to the map and its own way out.
    let ph = await page.evaluate(() => {
        const box = (el) => { const b = el.getBoundingClientRect(); return { left: Math.round(b.left), top: Math.round(b.top), right: Math.round(b.right), bottom: Math.round(b.bottom), w: Math.round(b.width), h: Math.round(b.height) }; };
        const side = document.querySelector('.dooms-atlas-side');
        const tools = [...side.querySelectorAll('.dooms-atlas-head-tools [data-act]')];
        const marker = document.querySelector('#dooms-atlas .dooms-atlas-marker').getBoundingClientRect();
        const over = document.elementFromPoint(marker.left + marker.width / 2, marker.top + marker.height / 2);
        const mapTool = document.querySelector('.dooms-atlas-tools .dooms-atlas-tool').getBoundingClientRect();
        const overTool = document.elementFromPoint(mapTool.left + 5, mapTool.top + 5);
        const tabs = [...side.querySelectorAll('.dooms-atlas-tab')];
        return {
            atlas: box(document.getElementById('dooms-atlas')), side: box(side), head: box(side.querySelector('.dooms-atlas-head')), body: box(side.querySelector('.dooms-atlas-body')), foot: box(side.querySelector('.dooms-atlas-foot')),
            tools: tools.map(t => [t.getAttribute('data-act'), box(t)]), title: box(side.querySelector('.dooms-atlas-title')),
            overMarker: over ? !!over.closest('.dooms-atlas-side') : false, overTool: overTool ? !!overTool.closest('.dooms-atlas-side') : false,
            tabs: tabs.length, tabsFit: tabs.every(t => t.scrollWidth <= t.clientWidth + 1), sideOverflow: side.scrollWidth > side.clientWidth + 1,
            footActs: [...side.querySelectorAll('.dooms-atlas-foot [data-act]')].map(b => box(b)),
        };
    });
    check('a phone: the window is the screen, and the sidebar is all of it', same([ph.atlas.left, ph.atlas.top, ph.atlas.w, ph.atlas.h], [0, 0, 412, 800]) && same([ph.side.left, ph.side.top, ph.side.w, ph.side.h], [0, 0, 412, 800]) && !ph.sideOverflow, JSON.stringify([ph.atlas, ph.side]));
    check('its head has Map and Close, each a finger wide, clear of the world\'s name', same(ph.tools.map(t => t[0]), ['fold', 'close']) && ph.tools.every(t => t[1].w >= 40 && t[1].h >= 40 && t[1].right <= 412 && t[1].top >= 0) && ph.title.right <= ph.tools[0][1].left, JSON.stringify([ph.tools, ph.title]));
    check('the head, the tabs, the tab\'s own list and the foot share the height, the list scrolling between them: nothing lies on anything else', ph.head.bottom <= ph.body.top && ph.body.bottom <= ph.foot.top + 1 && ph.foot.bottom <= 800 && ph.body.h >= 250 && ph.tabs === 6 && ph.tabsFit, JSON.stringify([ph.head, ph.body, ph.foot]));
    check('the foot\'s buttons are on the screen and a finger tall', ph.footActs.length >= 3 && ph.footActs.every(b => b.left >= 0 && b.right <= 412 && b.bottom <= 800 && b.h >= 40), JSON.stringify(ph.footActs));
    check('nothing of the map is drawn on top of the sidebar: not its markers, not its tools', ph.overMarker && ph.overTool);
    await shot('9a-phone-sidebar');

    // The map on a phone: the sidebar put away, every tool on the screen at any width.
    for (const width of [412, 360, 320]) {
        await page.setViewportSize({ width, height: 800 });
        await page.evaluate(() => { document.getElementById('dooms-atlas').classList.add('is-folded'); window.__board.size(); });
        await settle();
        const tl = await page.evaluate(() => [...document.querySelectorAll('.dooms-atlas-tools .dooms-atlas-tool')].filter(t => getComputedStyle(t).display !== 'none').map(t => { const b = t.getBoundingClientRect(); return [t.getAttribute('data-act'), Math.round(b.left), Math.round(b.right), Math.round(b.top), Math.round(b.width)]; }));
        check(`${width} wide: every one of the map's tools is on the screen, the first of them the way back to the sidebar`, tl.length >= 6 && tl[0][0] === 'fold' && tl.every(t => t[1] >= 0 && t[2] <= width && t[4] >= 34), JSON.stringify(tl));
        await page.evaluate(() => { document.getElementById('dooms-atlas').classList.remove('is-folded'); });
    }
    await page.setViewportSize({ width: 412, height: 800 });
    await page.evaluate(() => { document.getElementById('dooms-atlas').classList.add('is-folded'); window.__board.size(); });
    await settle();
    await page.locator('#dooms-atlas .dooms-atlas-marker').first().locator('.dooms-atlas-pin').click();
    await settle();
    const pc = await page.evaluate(() => { const c = document.querySelector('.dooms-atlas-popup .leaflet-popup-content-wrapper').getBoundingClientRect(); return { left: Math.round(c.left), right: Math.round(c.right), top: Math.round(c.top), bottom: Math.round(c.bottom) }; });
    check('a place\'s card is on the screen', pc.left >= 0 && pc.right <= 412 && pc.top >= 0 && pc.bottom <= 800, JSON.stringify(pc));
    await shot('9b-phone-map');
    await page.evaluate(() => { window.__board.closeCard(); document.getElementById('dooms-atlas').classList.remove('is-folded'); });

    // A sheet on a phone: the sidebar makes way, the sheet is the screen, and its buttons stay in reach while it scrolls.
    await page.evaluate((p) => window.__endScene({ prep: p }), prep);
    await settle();
    const sheetAt = () => page.evaluate(() => {
        const c = document.querySelector('.dooms-atlas-setup-card'); const b = c.getBoundingClientRect();
        const acts = [...c.querySelectorAll('.dooms-atlas-setup-actions [data-act]')].map(x => { const r = x.getBoundingClientRect(); const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return { act: x.getAttribute('data-act'), left: Math.round(r.left), right: Math.round(r.right), top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height), reachable: !!top && (top === x || x.contains(top)) }; });
        return { side: getComputedStyle(document.querySelector('.dooms-atlas-side')).display, card: [Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height)], scrolls: c.scrollHeight > c.clientHeight + 1, overflowX: c.scrollWidth > c.clientWidth + 1, acts, scrollTop: Math.round(c.scrollTop), max: c.scrollHeight - c.clientHeight };
    });
    let sh = await sheetAt();
    check('End scene on a phone: the sidebar makes way and the sheet is the whole screen', sh.side === 'none' && same(sh.card, [0, 0, 412, 800]) && !sh.overflowX, JSON.stringify([sh.side, sh.card]));
    check('its buttons are on the screen and can be pressed before any scrolling, each a finger tall', sh.scrolls && same(sh.acts.map(a => a.act), ['end-go', 'end-continue', 'setup-close']) && sh.acts.every(a => a.left >= 0 && a.right <= 412 && a.bottom <= 800 && a.h >= 40 && a.reachable), JSON.stringify(sh.acts));
    await shot('9c-phone-end-sheet');
    await page.evaluate(() => { const c = document.querySelector('.dooms-atlas-setup-card'); c.scrollTop = c.scrollHeight; });
    sh = await sheetAt();
    const lastPart = await page.evaluate(() => { const parts = document.querySelectorAll('.dooms-atlas-part'); const p = parts[parts.length - 1].getBoundingClientRect(); const bar = document.querySelector('.dooms-atlas-setup-card.is-end .dooms-atlas-setup-actions').getBoundingClientRect(); return { part: Math.round(p.bottom), bar: Math.round(bar.top), parts: parts.length }; });
    check('scrolled to its end, the last part of the record is above the buttons, not under them', sh.scrollTop > 0 && lastPart.parts >= 4 && lastPart.part <= lastPart.bar + 1 && sh.acts.every(a => a.bottom <= 800 && a.reachable), JSON.stringify([lastPart, sh.scrollTop, sh.max]));
    await page.evaluate(() => { const p = document.querySelector('.dooms-atlas-setup'); p.hidden = true; p.innerHTML = ''; });
    check('the sheet closed, the sidebar is back', (await page.evaluate(() => getComputedStyle(document.querySelector('.dooms-atlas-side')).display)) !== 'none');
    // Start a scene and World gen are sheets too.
    await page.evaluate(() => window.__sceneStart({ step: 'form', place: { id: '', label: '' }, sceneNo: 6, card: 'The Redward', people: [{ name: 'Kiyoha', here: true }, { name: 'Dagger', here: false }], cast: [], gap: { id: 'later', words: '' }, journey: '', seedText: '', note: '', places: [{ id: 'pin:hask', label: 'Hask', where: '' }] }));
    await settle();
    let other = await page.evaluate(() => { const c = document.querySelector('.dooms-atlas-setup-card'); const b = c.getBoundingClientRect(); const go = c.querySelector('[data-act="scene-write"]').getBoundingClientRect(); return { card: [Math.round(b.left), Math.round(b.width)], overflowX: c.scrollWidth > c.clientWidth + 1, side: getComputedStyle(document.querySelector('.dooms-atlas-side')).display, go: [Math.round(go.left), Math.round(go.right)] }; });
    check('Start a scene on a phone: the sheet is the screen\'s width, nothing spills sideways', same(other.card, [0, 412]) && !other.overflowX && other.side === 'none' && other.go[0] >= 0 && other.go[1] <= 412, JSON.stringify(other));
    await shot('9d-phone-start-sheet');
    await page.evaluate(() => window.__worldgen({ shape: 'pangea' }));
    await settle();
    other = await page.evaluate(() => { const c = document.querySelector('.dooms-atlas-setup-card'); const b = c.getBoundingClientRect(); const svg = c.querySelector('.dooms-atlas-worldgen-map').getBoundingClientRect(); return { card: [Math.round(b.left), Math.round(b.width)], overflowX: c.scrollWidth > c.clientWidth + 1, svg: [Math.round(svg.left), Math.round(svg.right), Math.round(svg.height)] }; });
    check('World gen on a phone: the picture above the choices, all of it within the screen', same(other.card, [0, 412]) && !other.overflowX && other.svg[0] >= 0 && other.svg[1] <= 412 && other.svg[2] > 100, JSON.stringify(other));
    await page.evaluate(() => window.__worldgen(null));

    // The window is the screen even where "the whole of what holds it" is not (SillyTavern's phone layout: the Workshop's rule).
    await page.evaluate(() => { document.body.style.transform = 'translateZ(0)'; document.body.style.height = '430px'; });
    const held = await page.evaluate(() => { const b = document.getElementById('dooms-atlas').getBoundingClientRect(); const s = document.querySelector('.dooms-atlas-side').getBoundingClientRect(); const f = document.querySelector('.dooms-atlas-foot').getBoundingClientRect(); return { atlas: [Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height)], side: Math.round(s.height), foot: Math.round(f.bottom) }; });
    check('held by something only half the screen tall, the window is still the whole screen, its foot at the bottom', same(held.atlas, [0, 0, 412, 800]) && held.side === 800 && held.foot === 800, JSON.stringify(held));
    await page.evaluate(() => { document.body.style.transform = ''; document.body.style.height = ''; document.getElementById('page-behind').remove(); for (const k of ['--dooms-ui-bg', '--dooms-ui-text', '--dooms-ui-highlight', '--dooms-ui-border', '--dooms-ui-accent']) document.body.style.removeProperty(k); });

    // A wide screen is as it was: the head's two tools are a phone's.
    await page.setViewportSize(VIEW);
    await page.evaluate(() => window.__open({ look: '', world: 'realm' }));
    await settle();
    const wide = await page.evaluate(() => ({ head: getComputedStyle(document.querySelector('.dooms-atlas-head-tools')).display, side: Math.round(document.querySelector('.dooms-atlas-side').getBoundingClientRect().width), atlas: Math.round(document.getElementById('dooms-atlas').getBoundingClientRect().width) }));
    check('on a wide screen the head has no tools of its own, and the sidebar is beside the map as before', wide.head === 'none' && wide.side === 340 && wide.atlas === VIEW.width, JSON.stringify(wide));
}

console.log('\n§9 the Doom button\'s menu: the scene\'s options in it, and it stays on the screen (D200)');
{
    await page.setViewportSize({ width: 412, height: 800 });
    await page.evaluate(async () => {
        document.getElementById('dooms-atlas').style.display = 'none';
        document.querySelectorAll('#page-behind').forEach(x => x.remove());
        const { mountFabMenu } = await import('/src/systems/ui/fabMenu.js');
        document.body.insertAdjacentHTML('beforeend', '<div id="dooms-settings-fab" class="dooms-settings-fab"><button id="dooms-fab-settings" class="dooms-fab-btn" title="Settings"><span class="doom-icon"></span></button></div>');
        const fab = document.getElementById('dooms-settings-fab');
        window.__ran = [];
        window.__scene = { label: 'Scene 1', long: false, busy: false, note: '' };
        const host = ['AI Response Configuration', 'API Connections', 'AI Response Formatting', 'World Info', 'User Settings', 'Change Background Image', 'Extensions', 'Persona Management', 'Character Management', 'Workshop', 'Atlas'];
        window.__count = host.length;
        const items = () => [
            ...host.slice(0, window.__count).map((label, k) => ({ id: `h${k}`, label, iconClass: 'fa-solid fa-gear', action: () => window.__ran.push(label) })),
            ...(window.__scene ? [{ id: 'scene', label: window.__scene.label, iconClass: 'fa-solid fa-clapperboard', lit: window.__scene.long, children: () => [
                { note: window.__scene.busy ? 'Writing the record…' : 'Scene 1: Porridge Before Anything', sub: window.__scene.busy ? '' : 'The house on the lane above the temple, the kitchen · Tail of Harvestide, the second morning after the return · 1 message' },
                ...(window.__scene.long ? [{ note: 'A good place to go on in a fresh chat.' }] : []),
                ...(window.__scene.note ? [{ note: window.__scene.note, warn: true }] : []),
                { id: 'scene-continue', label: 'Continue fresh', iconClass: 'fa-solid fa-forward-step', disabled: window.__scene.busy, lit: window.__scene.long, action: () => window.__ran.push('continue') },
                { id: 'scene-end', label: 'End scene 1', iconClass: 'fa-solid fa-flag-checkered', disabled: window.__scene.busy, action: () => window.__ran.push('end') },
            ] }] : []),
            { id: 'des-settings', label: "Doom's Settings", iconClass: 'fa-solid fa-gear', action: () => window.__ran.push('settings') },
        ];
        window.__fab = mountFabMenu(fab, { items });
        window.__place = (left, top) => { fab.style.left = left + 'px'; fab.style.top = top + 'px'; fab.style.right = 'auto'; fab.style.bottom = 'auto'; };
    });
    const menu = () => page.evaluate(() => {
        const list = document.querySelector('#dooms-settings-fab .dooms-fab-menu');
        const fab = document.getElementById('dooms-fab-settings').getBoundingClientRect();
        const lb = list.getBoundingClientRect();
        const rows = [...list.children].map(li => { const b = li.querySelector('.dooms-fab-menu-item'); const r = (b || li).getBoundingClientRect(); return { text: li.textContent.replace(/\s+/g, ' ').trim(), note: li.classList.contains('dooms-fab-menu-note'), warn: li.classList.contains('is-warn'), off: !!(b && b.disabled), lit: !!(b && b.classList.contains('is-lit')), more: !!(b && b.querySelector('.dooms-fab-menu-more')), left: r.left, right: r.right, top: r.top, bottom: r.bottom, seen: r.top >= lb.top - 1 && r.bottom <= lb.bottom + 1 }; });
        return { open: list.classList.contains('open'), dir: list.getAttribute('data-direction'), scroll: list.classList.contains('is-scroll'), top: lb.top, bottom: lb.bottom, tall: list.scrollHeight, high: list.clientHeight, fabTop: fab.top, fabBottom: fab.bottom, rows, vh: innerHeight, vw: innerWidth, over: document.documentElement.scrollWidth > innerWidth + 1 };
    });
    const tap = (text) => page.evaluate((t) => { const b = [...document.querySelectorAll('#dooms-settings-fab .dooms-fab-menu-item')].find(x => x.textContent.replace(/\s+/g, ' ').trim() === t); if (b) b.click(); return !!b; }, text);

    // Where the owner keeps it: near the top-left of a phone, thirteen entries.
    await page.evaluate(() => { window.__place(10, 110); window.__fab.open(); });
    await settle();
    let m = await menu();
    check('opened near the top of a phone, the list goes down from the button and ends on the screen: taller than the room, it scrolls inside it', m.open && m.dir === 'down' && m.rows.length === 13 && m.top >= m.fabBottom && m.bottom <= m.vh - 6 && (m.scroll ? m.tall > m.high : m.tall <= m.high + 1) && m.rows[0].seen && !m.over, JSON.stringify({ dir: m.dir, top: m.top, bottom: m.bottom, scroll: m.scroll, tall: m.tall, high: m.high }));
    check('a scene in front is one entry in it, named for the scene, that opens to more; End scene is no longer an entry of its own', m.rows.filter(r => r.text === 'Scene 1' && r.more).length === 1 && !m.rows.some(r => /^End scene/.test(r.text)) && m.rows[m.rows.length - 1].text === "Doom's Settings");
    await shot('9a-fab-menu-phone');
    await tap('Scene 1');
    await settle();
    m = await menu();
    check('pressed, the fly-out is the scene\'s own list: which scene it is with its place and date, Continue fresh, End scene and the way back', m.open && same(m.rows.map(r => r.text.slice(0, 34)), ['Scene 1: Porridge Before AnythingT', 'Continue fresh', 'End scene 1', 'Back']) && m.rows[0].note && /Tail of Harvestide.*1 message$/.test(m.rows[0].text) && !m.rows[1].off && !m.rows[2].off, JSON.stringify(m.rows.map(r => r.text)));
    check('it fits a phone: nothing off either side, the scene\'s line wrapped, the list on the screen', m.rows.every(r => r.left >= 0 && r.right <= m.vw) && m.rows[0].bottom - m.rows[0].top > 40 && m.top >= 0 && m.bottom <= m.vh && !m.scroll && !m.over, JSON.stringify(m.rows.map(r => [Math.round(r.left), Math.round(r.right)])));
    await shot('9b-fab-scene-phone');
    await tap('Back');
    await settle();
    m = await menu();
    check('Back is the fly-out again', m.open && m.rows.length === 13 && m.rows.some(r => r.text === 'Scene 1'));
    await tap('Scene 1');
    await tap('End scene 1');
    await settle();
    m = await menu();
    check('an option pressed closes the fly-out and is done', !m.open && same(await page.evaluate(() => window.__ran), ['end']));
    await page.evaluate(() => { const b = document.querySelector('#dooms-settings-fab .dooms-fab-menu-item'); if (b) b.click(); });
    check('a list that is closed does nothing, whatever reaches its rows', same(await page.evaluate(() => window.__ran), ['end']));

    // A scene that has run long, a handover running, one that stopped.
    await page.evaluate(() => { window.__ran = []; window.__scene = { label: 'Scene 1', long: true, busy: false, note: '' }; document.getElementById('dooms-settings-fab').classList.add('dooms-fab-scene-long'); window.__fab.open(); });
    await settle();
    m = await menu();
    const dot = await page.evaluate(() => { const cs = getComputedStyle(document.getElementById('dooms-settings-fab'), '::after'); return { w: parseFloat(cs.width), content: cs.content, bg: cs.backgroundColor }; });
    check('a scene that has run long: a dot on the Doom button, and its entry lit', dot.w >= 8 && dot.content !== 'none' && m.rows.find(r => r.text === 'Scene 1').lit, JSON.stringify(dot));
    await tap('Scene 1');
    await settle();
    m = await menu();
    check('opened, it says a fresh chat is due and Continue fresh is lit', m.rows.some(r => r.note && r.text === 'A good place to go on in a fresh chat.') && m.rows.find(r => r.text === 'Continue fresh').lit && !m.rows.find(r => r.text === 'End scene 1').lit);
    await page.evaluate(() => { window.__fab.close(); window.__scene = { label: 'Scene 1', long: false, busy: true, note: '' }; window.__fab.open(); });
    await tap('Scene 1');
    await tap('Continue fresh');
    await settle();
    m = await menu();
    check('while a handover runs the list says what is being done, and nothing in it can be pressed', m.open && m.rows[0].text === 'Writing the record…' && m.rows.find(r => r.text === 'Continue fresh').off && m.rows.find(r => r.text === 'End scene 1').off && same(await page.evaluate(() => window.__ran), []));
    await page.evaluate(() => { window.__fab.close(); window.__scene = { label: 'Scene 1', long: false, busy: false, note: 'The record of the scene could not be written. Use End scene to write it yourself.' }; window.__fab.open(); });
    await tap('Scene 1');
    await settle();
    m = await menu();
    check('why the last handover stopped is said in the list, marked, and wraps inside the screen', m.rows.some(r => r.warn && /could not be written/.test(r.text) && r.right <= m.vw && r.left >= 0));

    // No scene in front: no entry. The button at the bottom: the list goes up and stays under the top of the screen.
    await page.evaluate(() => { window.__fab.close(); window.__scene = null; document.getElementById('dooms-settings-fab').classList.remove('dooms-fab-scene-long'); window.__place(10, 750); window.__fab.open(); });
    await settle();
    m = await menu();
    check('a chat that is no scene has no such entry, and the fly-out is one shorter', m.rows.length === 12 && !m.rows.some(r => /^Scene/.test(r.text)));
    check('from the bottom of the screen the list goes up and stops below the top of it, the entry nearest the button in view', m.dir === 'up' && m.top >= 6 && m.bottom <= m.fabTop + 1 && m.rows[m.rows.length - 1].seen && m.rows[m.rows.length - 1].text === "Doom's Settings" && (m.scroll ? m.tall > m.high : true), JSON.stringify({ top: m.top, bottom: m.bottom, scroll: m.scroll }));
    // A short screen (a phone on its side): the same list scrolls and nothing leaves the screen.
    await page.evaluate(() => window.__fab.close());
    await page.setViewportSize({ width: 800, height: 360 });
    await page.evaluate(() => { window.__place(10, 310); window.__fab.open(); });
    await settle();
    m = await menu();
    check('on a screen too short for the whole list it scrolls: every entry is still there, none off the screen', m.scroll && m.tall > m.high && m.top >= 6 && m.bottom <= m.vh && m.rows.length === 12 && m.rows[m.rows.length - 1].seen && !m.rows[0].seen, JSON.stringify({ top: m.top, bottom: m.bottom, tall: m.tall, high: m.high }));
    const reached = await page.evaluate(() => { const list = document.querySelector('#dooms-settings-fab .dooms-fab-menu'); list.scrollTop = 0; const first = list.children[0].getBoundingClientRect(); const lb = list.getBoundingClientRect(); return first.top >= lb.top - 1 && first.bottom <= lb.bottom + 1 && getComputedStyle(list).pointerEvents === 'auto'; });
    check('scrolled, the far end of the list is reached', reached);
    await page.mouse.click(700, 100);
    await settle();
    check('a press outside closes it', !(await menu()).open);

    // The knock (D201): three quick taps on the screen put the button away, three more bring it back.
    await page.setViewportSize({ width: 412, height: 800 });
    await page.evaluate(async () => {
        const { mountKnock } = await import('/src/systems/ui/fabMenu.js');
        const fab = document.getElementById('dooms-settings-fab');
        window.__place(10, 110);
        document.body.insertAdjacentHTML('beforeend', '<div id="knock-page" style="position:fixed;inset:0;z-index:5;font:16px/1.5 sans-serif;color:#ddd;padding:220px 16px 0;"><p id="knock-text" style="margin:0 0 20px;">The house on the lane above the temple, the kitchen. Porridge before anything.</p><button id="knock-btn" type="button" style="display:block;width:200px;height:60px;">A button</button><textarea id="knock-box" style="display:block;width:300px;height:60px;margin-top:20px;"></textarea><div id="knock-dialog" role="dialog" style="position:absolute;left:16px;top:700px;width:380px;height:80px;background:#333;">A window of its own</div></div>');
        window.__knockMode = 'button';
        window.__knocks = [];
        window.__knock = mountKnock(fab, { mode: () => window.__knockMode, menu: window.__fab, onChange: (h) => { window.__knocks.push(h); if (h) window.__fab.close(); } });
        const wait = (ms) => new Promise(r => setTimeout(r, ms));
        // A press as the browser reports it: down, perhaps a move, up, at one spot of the page.
        // `compat`: the mouse events a touch screen sends for the same tap once the finger is up (mousedown, mouseup, click),
        // to whatever is under the point by then.
        window.__press = async (x, y, { type = 'touch', hold = 40, drift = 0, cancel = false, id = 7, compat = false } = {}) => {
            const el = document.elementFromPoint(x, y) || document.body;
            const ev = (name, yy) => new PointerEvent(name, { bubbles: true, cancelable: true, composed: true, pointerId: id, pointerType: type, isPrimary: true, button: 0, clientX: x, clientY: yy });
            el.dispatchEvent(ev('pointerdown', y));
            await wait(hold);
            if (cancel) { el.dispatchEvent(ev('pointercancel', y)); return; }
            (document.elementFromPoint(x, y + drift) || el).dispatchEvent(ev('pointerup', y + drift));
            if (!compat) return;
            // Not awaited past the tap when the browser holds them back: the next tap does not wait for this one's click.
            const late = async () => {
                await wait(compat === true ? 8 : compat);
                const under = document.elementFromPoint(x, y) || document.body;
                window.__clickedOn = under.closest ? (under.closest('.dooms-fab-menu-item') ? 'entry' : under.id || under.tagName) : '';
                for (const name of ['mousedown', 'mouseup', 'click']) under.dispatchEvent(new MouseEvent(name, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 }));
            };
            if (compat === true) await late(); else late();
        };
        window.__taps = async (points, { gap = 70, ...o } = {}) => { for (const [x, y] of points) { await window.__press(x, y, o); await wait(gap); } };
    });
    const fabState = () => page.evaluate(() => { const f = document.getElementById('dooms-settings-fab'); const cs = getComputedStyle(f); return { knocked: f.classList.contains('dooms-fab-knocked'), seen: cs.visibility !== 'hidden' && Number(cs.opacity) > 0.9, press: cs.pointerEvents, aria: f.getAttribute('aria-hidden'), log: window.__knocks.slice(), menu: document.querySelector('#dooms-settings-fab .dooms-fab-menu').classList.contains('open') }; });
    const spot = [[300, 600], [304, 603], [298, 598]];
    await page.evaluate((p) => window.__taps(p), spot);
    await settle();
    let f = await fabState();
    check('three quick taps on the screen put the Doom button away: not seen, not pressable', f.knocked && !f.seen && f.press === 'none' && f.aria === 'true' && same(f.log, [true]), JSON.stringify(f));
    await shot('9c-knocked-away');
    await page.evaluate((p) => window.__taps(p), spot);
    await settle();
    f = await fabState();
    check('three more bring it back, as it was', !f.knocked && f.seen && f.press !== 'none' && same(f.log, [true, false]), JSON.stringify(f));
    await page.evaluate((p) => window.__taps(p), spot.slice(0, 2));
    await page.waitForTimeout(600);
    await page.evaluate((p) => window.__taps(p), spot.slice(0, 1));
    await page.evaluate((p) => window.__taps(p, { gap: 600 }), spot);
    f = await fabState();
    check('two taps and a pause are not a knock, nor three slow ones', !f.knocked && f.log.length === 2);
    await page.waitForTimeout(600);
    await page.evaluate(() => window.__taps([[60, 600], [200, 600], [340, 600]]));
    f = await fabState();
    check('three taps in three different places are not a knock', !f.knocked && f.log.length === 2);
    await page.waitForTimeout(600);
    const onButton = await page.evaluate(async () => { const r = document.getElementById('knock-btn').getBoundingClientRect(); const b = document.getElementById('knock-box').getBoundingClientRect(); await window.__taps([[r.left + 40, r.top + 30], [r.left + 42, r.top + 31], [r.left + 41, r.top + 29]]); await new Promise(x => setTimeout(x, 600)); await window.__taps([[b.left + 40, b.top + 30], [b.left + 42, b.top + 31], [b.left + 41, b.top + 29]]); return true; });
    f = await fabState();
    check('taps on a button or in a text box are presses of those, not a knock', onButton && !f.knocked && f.log.length === 2);
    await page.waitForTimeout(600);
    await page.evaluate(() => window.__taps([[200, 740], [202, 742], [199, 739]]));
    f = await fabState();
    check('taps inside a window of its own (a dialog, the Atlas) are that window\'s, not a knock', !f.knocked && f.log.length === 2);
    await page.waitForTimeout(600);
    await page.evaluate((p) => window.__taps(p, { drift: 60 }), spot);
    await page.waitForTimeout(600);
    await page.evaluate((p) => window.__taps(p, { hold: 500 }), spot);
    await page.waitForTimeout(600);
    await page.evaluate((p) => window.__taps(p, { cancel: true }), spot);
    f = await fabState();
    check('a scroll, a held press and a press the browser took over are not taps', !f.knocked && f.log.length === 2);
    await page.waitForTimeout(600);
    // A mouse: three clicks on text select the paragraph and are left alone; three on an empty spot are a knock.
    const picked = await page.evaluate(async () => { const t = document.getElementById('knock-text'); const r = t.getBoundingClientRect(); const sel = window.getSelection(); const range = document.createRange(); range.selectNodeContents(t); sel.removeAllRanges(); sel.addRange(range); await window.__taps([[r.left + 30, r.top + 8], [r.left + 31, r.top + 8], [r.left + 30, r.top + 9]], { type: 'mouse' }); const had = String(sel).length > 10; sel.removeAllRanges(); return had; });
    f = await fabState();
    check('three clicks of a mouse that selected a paragraph are a selection, not a knock', picked && !f.knocked && f.log.length === 2);
    await page.waitForTimeout(600);
    await page.evaluate((p) => window.__taps(p, { type: 'mouse' }), spot);
    await settle();
    f = await fabState();
    check('three clicks on an empty spot are a knock with a mouse too', f.knocked && same(f.log, [true, false, true]));
    await page.evaluate((p) => window.__taps(p), spot);
    await settle();
    // Put away with its fly-out open: the fly-out closes with it.
    await page.evaluate(() => window.__fab.open());
    await settle();
    await page.evaluate((p) => window.__taps(p), spot);
    await settle();
    f = await fabState();
    check('put away with its fly-out open, the fly-out closes with it', f.knocked && !f.menu && !f.seen);
    // The switch off: a button that was put away comes back, and the knock does nothing.
    await page.evaluate(() => { window.__knockMode = 'off'; window.__knock.sync(); });
    await page.waitForTimeout(600);
    await page.evaluate((p) => window.__taps(p), spot);
    await settle();
    f = await fabState();
    check('switched off, the button is back and three taps do nothing', !f.knocked && f.seen && same(f.log, [true, false, true, false, true, false]), JSON.stringify(f.log));

    // No button at all: the taps open its fly-out at the left edge of the screen.
    const side = () => page.evaluate(() => {
        const fab = document.getElementById('dooms-settings-fab');
        const btn = document.getElementById('dooms-fab-settings');
        const list = fab.querySelector('.dooms-fab-menu');
        const lb = list.getBoundingClientRect();
        const first = list.children[0] ? list.children[0].getBoundingClientRect() : null;
        return { nobutton: fab.classList.contains('dooms-fab-nobutton'), button: getComputedStyle(btn).visibility, boxPress: getComputedStyle(fab).pointerEvents, open: list.classList.contains('open'), dir: list.getAttribute('data-direction'), left: first ? first.left : null, top: lb.top, bottom: lb.bottom, mid: (lb.top + lb.bottom) / 2, rows: list.children.length, scroll: list.classList.contains('is-scroll'), vh: innerHeight, vw: innerWidth, right: Math.max(...[...list.querySelectorAll('.dooms-fab-menu-item, .dooms-fab-menu-note')].map(x => x.getBoundingClientRect().right), 0), ran: window.__ran.slice(), under: (() => { const e = document.elementFromPoint(20, 130); return e ? (e.id || e.className || e.tagName) : ''; })() };
    });
    await page.evaluate(() => { window.__ran = []; window.__scene = { label: 'Scene 1', long: false, busy: false, note: '' }; window.__knockMode = 'menu'; window.__knock.sync(); });
    await settle();
    let sd = await side();
    check('with no button chosen, the Doom button is not on the screen and its box takes no press: what is under it is the page', sd.nobutton && sd.button === 'hidden' && sd.boxPress === 'none' && !sd.open && sd.under !== 'dooms-fab-settings' && !/dooms-fab-btn/.test(String(sd.under)), JSON.stringify(sd));
    await page.waitForTimeout(600);
    // Tapped where the list will come up, as a phone reports it: the tap's own mouse events arrive after the list is open.
    const early = await page.evaluate(async () => { await window.__taps([[40, 600], [42, 602], [39, 599]], { compat: true, gap: 60 }); const list = document.querySelector('#dooms-settings-fab .dooms-fab-menu'); const b = list.querySelector('.dooms-fab-menu-item'); if (b) b.click(); return { open: list.classList.contains('open'), ran: window.__ran.slice() }; });
    check('the taps that opened the list are not taken for a press of an entry that came up under them, nor for a press outside that closes it', early.open && early.ran.length === 0, JSON.stringify(early));
    await settle();
    // The owner's report: a phone that holds the tap's click back a third of a second and more (it waits for a double
    // tap). By then an entry stands under the finger: the list was opened, and Persona Management with it.
    for (const held of [330, 420, 700]) {
        await page.evaluate(() => { window.__fab.close(); window.__ran = []; window.__clickedOn = ''; });
        await page.waitForTimeout(600);
        const r = await page.evaluate(async (ms) => { await window.__taps([[60, 450], [62, 452], [59, 449]], { compat: ms, gap: 60 }); await new Promise(x => setTimeout(x, ms + 150)); return { open: document.querySelector('#dooms-settings-fab .dooms-fab-menu').classList.contains('open'), ran: window.__ran.slice(), on: window.__clickedOn }; }, held);
        check(`a click the phone holds back ${held} ms after the knock presses nothing in the list and leaves it open${held > 400 ? ', though it lands on an entry' : ''}`, r.open && r.ran.length === 0 && (held <= 400 || r.on === 'entry'), JSON.stringify(r));
    }
    await page.waitForTimeout(500);
    const after = await page.evaluate(() => { const b = [...document.querySelectorAll('#dooms-settings-fab .dooms-fab-menu-item')].find(x => x.textContent.trim() === 'Atlas'); const r = b.getBoundingClientRect(); b.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: r.left + 20, clientY: r.top + 10 })); return window.__ran.slice(); });
    check('an entry away from where the knock landed is pressed as soon as the list is up', same(after, ['Atlas']), JSON.stringify(after));
    await page.evaluate(() => { window.__ran = []; });
    await page.waitForTimeout(600);
    await page.evaluate(() => window.__taps([[60, 450], [62, 452], [59, 449]], { gap: 60 }));
    await page.waitForTimeout(1100);
    const late = await page.evaluate(() => { const el = document.elementFromPoint(60, 450); const b = el && el.closest ? el.closest('.dooms-fab-menu-item') : null; if (b) b.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 60, clientY: 450 })); return { hit: !!b, ran: window.__ran.length }; });
    check('and the entry at that very spot is pressed too, a second after the knock', late.hit && late.ran === 1, JSON.stringify(late));
    await page.evaluate(() => { window.__fab.close(); window.__ran = []; });
    await page.waitForTimeout(600);
    await page.evaluate((p) => window.__taps(p), spot);
    await settle();
    sd = await side();
    check('three quick taps open its fly-out at the left edge of the screen, in the middle of its height, all of it on the screen', sd.open && sd.dir === 'side' && sd.rows === 13 && sd.left >= 8 && sd.left <= 14 && sd.top >= 6 && sd.bottom <= sd.vh - 6 && Math.abs(sd.mid - sd.vh / 2) <= 24 && sd.right <= sd.vw, JSON.stringify(sd));
    await shot('9d-knock-menu');
    await page.waitForTimeout(450);
    await tap('Scene 1');
    await settle();
    sd = await side();
    check('the scene\'s own list opens in the same place', sd.open && sd.dir === 'side' && sd.rows === 4 && sd.left >= 8 && sd.left <= 14 && Math.abs(sd.mid - sd.vh / 2) <= 24, JSON.stringify(sd));
    await tap('End scene 1');
    await settle();
    sd = await side();
    check('an entry pressed is done and the list goes', !sd.open && same(sd.ran, ['end']));
    // Three taps while it is open close it, and do not open it again.
    await page.waitForTimeout(600);
    await page.evaluate((p) => window.__taps(p), spot);
    await settle();
    await page.waitForTimeout(600);
    const openNow = (await side()).open;
    await page.evaluate((p) => window.__taps(p, { compat: true }), spot);    // the first tap, outside the list, closes it; the third must not open it again
    await settle();
    sd = await side();
    check('three taps with the list open close it and leave it closed', openNow && !sd.open, JSON.stringify([openNow, sd.open]));
    // A screen too short for the list: it scrolls, and still starts on the screen.
    await page.setViewportSize({ width: 800, height: 360 });
    await page.waitForTimeout(600);
    await page.evaluate(() => window.__taps([[500, 200], [503, 202], [498, 199]]));
    await settle();
    sd = await side();
    check('on a short screen the list at the edge scrolls inside the screen', sd.open && sd.scroll && sd.top >= 6 && sd.bottom <= sd.vh - 6 && sd.left >= 8 && sd.left <= 14, JSON.stringify(sd));
    await page.mouse.click(700, 100);
    await settle();
    check('a press outside closes it', !(await side()).open);
    await page.setViewportSize({ width: 412, height: 800 });
    // The choice changed back: the button is on the screen again, and its fly-out hangs from it as before.
    await page.evaluate(() => { window.__knockMode = 'off'; window.__knock.sync(); window.__fab.open(); });
    await settle();
    sd = await side();
    check('the choice taken back, the button is on the screen again and its fly-out hangs from it as before', !sd.nobutton && sd.button === 'visible' && sd.boxPress !== 'none' && sd.open && sd.dir !== 'side');
    await page.evaluate(() => { window.__fab.close(); window.__knock.destroy(); document.getElementById('knock-page').remove(); });
    await page.evaluate(() => { document.getElementById('dooms-settings-fab').remove(); });
    await page.setViewportSize(VIEW);
}

check('no errors on the page', errors.length === 0, errors.join(' | '));
await browser.close();
server.close();
if (shots) console.log(`\nscreenshots: ${shotDir}`);
console.log(failures ? `\n${failures} failure(s)` : '\nall pass');
process.exit(failures ? 1 : 0);
