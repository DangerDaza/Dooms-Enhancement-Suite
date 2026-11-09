#!/usr/bin/env node
/**
 * The Atlas for real (docs/long-shot-plan.md D139, D142, D146, D147): its
 * shell and views (src/systems/ui/atlasViews.js), its map
 * (src/systems/ui/atlasMap.js, Leaflet over vectors) and its stylesheet in
 * a headless Chromium, with a fixture world. The window fills the screen;
 * the sidebar is on the left and folds; the land and the routes are SVG
 * paths and the markers are HTML (nothing is a picture); a kind switched
 * off takes its markers away; a search dims what does not match; a marker
 * opens its card with the distance and Travel here; a marker keeps its
 * size after a zoom; places inside places wait for a close look; an
 * update keeps the view; the looks restyle it. The repo is served over
 * HTTP for the run (ES modules do not load from file: URLs).
 *
 * Needs Playwright with Chromium; without it the check says so and passes.
 *
 * Usage:  node tools/atlas-browser-test.mjs [--shots]   (from the repo root; --shots writes PNGs to the folder it prints)
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

const FA = process.env.DES_FA || '';    // a folder with Font Awesome's css/ and webfonts/, for screenshots with the icons drawn
const TYPES = { '.ttf': 'font/ttf', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
const harness = `<!doctype html><html><head><meta charset="utf-8">
${FA ? '<link rel="stylesheet" href="/__fa/css/all.min.css">' : ''}<link rel="stylesheet" href="/lib/leaflet/leaflet.css"><link rel="stylesheet" href="/styles/modals.css"><link rel="stylesheet" href="/style.css"><link rel="stylesheet" href="/styles/overhaul.css"><link rel="stylesheet" href="/styles/atlas.css">
<style>html, body { margin: 0; background: #222; font-family: sans-serif; }</style></head>
<body>
<script type="module">
import { ATLAS_ID, atlasShellHtml, atlasSideHtml, atlasPlacesHtml, atlasResultsHtml, atlasCardHtml } from '/src/systems/ui/atlasViews.js';
import { mountAtlasMap } from '/src/systems/ui/atlasMap.js';
import { normalizePack, seedWorldState } from '/src/utils/liveWorld.js';
import { atlasModel, describeDistance } from '/src/utils/atlas.js';
const WORLD = {
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
document.body.insertAdjacentHTML('beforeend', atlasShellHtml());
const root = document.getElementById(ATLAS_ID);
window.__events = [];
window.__state = { hidden: [], query: '' };
window.__open = async ({ look = '', player = 'saltport' } = {}) => {
    if (look) document.body.setAttribute('data-dooms-ui', look); else document.body.removeAttribute('data-dooms-ui');
    const pack = normalizePack(WORLD).pack;
    const state = seedWorldState(pack, { name: '' });
    state.visited = [{ id: player, label: player, packId: player, path: player, visits: [9] }, { id: 'iron-inn', label: 'The Iron Inn', packId: 'iron-inn', path: 'northmarch/iron-inn', visits: [4] }, { id: 'old-shrine', label: 'The Old Shrine', packId: 'old-shrine', path: 'greywood/old-shrine', visits: [2] }, { id: 'loc:the-burnt-mill', label: 'The Burnt Mill', packId: '', path: '', visits: [1] }];
    const model = atlasModel({ pack, state, player: 'Jordan', weather: { greywood: { emoji: '🌧️', text: 'Steady rain' } } });
    window.__model = model;
    const side = () => { root.querySelector('.dooms-atlas-side').innerHTML = atlasSideHtml({ name: pack.name, facts: { date: '14th of Frostfall', time: 'Dusk', location: 'Saltport, the quay', weather: 'Sea fog' }, tab: 'places', body: atlasPlacesHtml({ markers: model.markers, ...window.__state }), status: 'Last advanced on 13th of Frostfall · next in 4 replies.', canAdvance: true, editLabel: 'Edit this world' }); };
    side();
    window.__side = side;
    root.classList.add('is-open');
    root.style.display = 'flex';    // the controller's own way: the shell is hidden inline until it opens
    if (window.__board) window.__board.destroy();
    window.__board = await mountAtlasMap(root.querySelector('.dooms-atlas-map'), {
        model, ...window.__state,
        card: (m) => atlasCardHtml({ marker: m, distance: describeDistance(model, model.party, m.id), canTravel: true, rumours: m.id === 'saltport' ? ['The harbour chain has been raised at Saltport.'] : [], news: [] }),
        on: { open: (id) => window.__events.push(['open', id]), close: () => window.__events.push(['close']), scale: (s) => { window.__scale = s; root.querySelector('.dooms-atlas-scale-bar').style.width = s.px + 'px'; root.querySelector('.dooms-atlas-scale-text').textContent = s.length + ' miles'; } },
    });
    return true;
};
window.__set = (next) => { Object.assign(window.__state, next); window.__side(); window.__board.update(window.__state); return true; };
window.__results = (q) => atlasResultsHtml({ markers: window.__model.markers, query: q, hidden: window.__state.hidden });
window.__ready = true;
</script></body></html>`;

const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname === '/atlas.html') { res.writeHead(200, { 'content-type': 'text/html' }); res.end(harness); return; }
    const file = FA && url.pathname.startsWith('/__fa/') ? normalize(join(FA, decodeURIComponent(url.pathname.slice(6)))) : normalize(join(repo, decodeURIComponent(url.pathname)));
    if (!file.startsWith(repo) && !(FA && file.startsWith(normalize(FA)))) { res.writeHead(403); res.end(); return; }
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
    const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { left: b.left, top: b.top, width: b.width, height: b.height, right: b.right, bottom: b.bottom }; };
    const shown = (el) => !!el && getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().width > 0;
    const markers = {};
    document.querySelectorAll('#dooms-atlas .dooms-atlas-marker').forEach(el => {
        const name = (el.querySelector('.dooms-atlas-label, .dooms-atlas-region-name') || {}).textContent || '?';
        const pin = el.querySelector('.dooms-atlas-pin');
        const label = el.querySelector('.dooms-atlas-label');
        markers[name] = { box: r(el), pin: r(pin), shown: shown(el), label: shown(label), cls: el.className, faces: el.querySelectorAll('.dooms-atlas-face').length, opacity: Number(getComputedStyle(el).opacity) };
    });
    const land = [...document.querySelectorAll('#dooms-atlas path.dooms-atlas-land')];
    return {
        atlas: r(document.getElementById('dooms-atlas')), side: r(document.querySelector('.dooms-atlas-side')), stage: r(document.querySelector('.dooms-atlas-stage')), map: r(document.querySelector('.dooms-atlas-map')),
        sideShown: shown(document.querySelector('.dooms-atlas-side')),
        markers, count: Object.keys(markers).length,
        shore: document.querySelectorAll('#dooms-atlas path.dooms-atlas-shore').length, coast: document.querySelectorAll('#dooms-atlas path.dooms-atlas-coast').length,
        land: land.length, landFills: land.map(p => getComputedStyle(p).fill), routes: document.querySelectorAll('#dooms-atlas path.dooms-atlas-route').length,
        images: document.querySelectorAll('#dooms-atlas .leaflet-pane img, #dooms-atlas canvas').length,
        zoom: document.querySelector('.dooms-atlas-map').getAttribute('data-zoom'),
        kinds: [...document.querySelectorAll('.dooms-atlas-kind')].map(k => ({ id: k.getAttribute('data-kind'), count: Number(k.querySelector('.dooms-atlas-kind-count').textContent), off: k.classList.contains('is-off') })),
        rows: document.querySelectorAll('.dooms-atlas-row').length,
        card: r(document.querySelector('.dooms-atlas-card')),
        cardText: (document.querySelector('.dooms-atlas-card') || {}).textContent || '',
        scale: window.__scale || null,
        overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        sideOverflow: (() => { const s = document.querySelector('.dooms-atlas-side'); return s ? s.scrollWidth > s.clientWidth + 1 : false; })(),
    };
});

console.log('\n§1 the window');
{
    await page.evaluate(() => window.__open({}));
    await settle();
    const l = await layout();
    check('the Atlas fills the screen', near(l.atlas.width, VIEW.width, 1) && near(l.atlas.height, VIEW.height, 1) && l.atlas.left === 0 && l.atlas.top === 0, JSON.stringify(l.atlas));
    check('the sidebar on the left, the map in the rest', l.side.left === 0 && near(l.side.width, 340, 1) && near(l.stage.left, 340, 1) && near(l.stage.right, VIEW.width, 1) && near(l.map.height, VIEW.height, 1));
    check('nothing runs past the screen or the sidebar', !l.overflowX && !l.sideOverflow);
    check('the land and the routes are vectors, and nothing is a picture', l.land === 6 && l.routes >= 20 && l.images === 0, `${l.land} lands, ${l.routes} routes, ${l.images} pictures`);
    check('the terrains have colours of their own', new Set(l.landFills).size >= 4, [...new Set(l.landFills)].join(' | '));
    check('a marker for every place on the map', l.count === 27, String(l.count));
    check('every shown marker is inside the map', Object.values(l.markers).filter(m => m.shown).every(m => m.box.left > l.map.left - 20 && m.box.right < l.map.right + 20 && m.box.top > -20 && m.box.bottom < VIEW.height + 20));
    check('places inside places wait for a close look', l.markers['Fish Market'].shown === false && l.markers['Frosthold Keep'].shown === true && ['far', 'mid'].includes(l.zoom), l.zoom);
    check('zoomed out, the places carry no names; the regions and the party do', l.markers['Frosthold Keep'].label === false && l.markers['Saltport'].label === true && !!l.markers['The Northmarch']);
    check('the coasts are drawn under the land: a line and a fill for every region', l.shore === 6 && l.coast === 6);
    check('the party is marked, the visited places too', /is-player/.test(l.markers['Saltport'].cls) && /is-visited/.test(l.markers['The Iron Inn'].cls) && !/is-visited/.test(l.markers['Frosthold Keep'].cls));
    check('the people stand at their places: three faces and a count for more', l.markers['The Iron Inn'].faces === 4 && l.markers['Frosthold Keep'].faces === 1);
    check('the kinds with their counts', l.kinds.length >= 6 && l.kinds[0].id === 'region' && l.kinds[0].count === 6 && l.kinds.reduce((n, k) => n + k.count, 0) === 27 && l.kinds.every(k => !k.off));
    check('the scale bar reads in the world\'s unit', !!l.scale && l.scale.px > 20 && l.scale.px <= 120 && l.scale.length > 0 && l.scale.unit === 'mi', JSON.stringify(l.scale));
    await shot('1-atlas');
}

console.log('\n§2 the switches and the search');
{
    await page.evaluate(() => window.__set({ hidden: ['ruin', 'region'] }));
    await settle();
    let l = await layout();
    check('a kind switched off takes its markers away', !l.markers['The Old Shrine'] && !l.markers["Smugglers' Cove"] && !l.markers['The Northmarch'] && !!l.markers['Saltport'] && l.count < 27);
    check('its switch is struck through, the others not', l.kinds.find(k => k.id === 'ruin').off && !l.kinds.find(k => k.id === 'settlement').off);
    await page.evaluate(() => window.__set({ hidden: [], query: 'inn' }));
    await settle();
    l = await layout();
    check('a search dims what does not match', l.markers['The Iron Inn'].opacity === 1 && l.markers['Saltport'].opacity < 0.5 && l.count === 27);
    check('the list holds the matches', l.rows === 1, String(l.rows));
    const none = await page.evaluate(() => window.__results('zzzz'));
    check('a search with no match says so', /Nothing on the map matches/.test(none));
    await shot('2-search');
    await page.evaluate(() => window.__set({ query: '' }));
    await settle();
}

console.log('\n§3 the card');
{
    await page.evaluate(() => { window.__events.length = 0; });
    await page.evaluate(() => window.__board.show('frosthold', { open: false }));    // a look close enough for the pins to stand apart
    await page.waitForTimeout(600);
    const closeUp = await layout();
    check('a closer look gives the places their names', closeUp.zoom === 'close' && closeUp.markers['Frosthold Keep'].label === true);
    await page.locator('#dooms-atlas .dooms-atlas-marker', { hasText: 'Frosthold Keep' }).locator('.dooms-atlas-pin').click();
    await settle();
    let l = await layout();
    const ev = await page.evaluate(() => window.__events);
    check('a marker clicked opens its card', !!l.card && ev.some(e => e[0] === 'open' && e[1] === 'frosthold'));
    check('the card names the place, its kind, its region and its note', /Frosthold Keep/.test(l.cardText) && /Strongholds · The Northmarch/.test(l.cardText) && /last garrison/.test(l.cardText));
    check('the card says how far the party is', /\d+(\.\d)? miles, about .+ on foot/.test(l.cardText), l.cardText.replace(/\s+/g, ' ').slice(0, 200));
    check('the card names who is there and offers Travel here', /Captain Rusk/.test(l.cardText) && /Travel here/.test(l.cardText));
    check('the card is inside the screen', l.card.left >= 0 && l.card.right <= VIEW.width && l.card.top >= 0 && l.card.bottom <= VIEW.height, JSON.stringify(l.card));
    await shot('3-card');
    await page.evaluate(() => window.__board.show('saltport'));
    await page.waitForTimeout(600);
    l = await layout();
    check('the party\'s own place says You are here, with no Travel', /You are here/.test(l.cardText) && !/Travel here/.test(l.cardText) && /harbour chain/.test(l.cardText));
    await page.evaluate(() => window.__board.closeCard());
}

console.log('\n§4 the zoom');
{
    await page.mouse.move(700, 5);    // off the markers: a pin under the pointer is drawn larger
    await page.evaluate(() => window.__board.fit());
    await settle();
    const whole = await layout();
    check('the whole map: the places are dots, so no pin sits on another', whole.zoom === 'far' ? near(whole.markers['Frosthold Keep'].pin.width, 12, 1) : near(whole.markers['Frosthold Keep'].pin.width, 30, 1), `${whole.zoom} ${whole.markers['Frosthold Keep'].pin.width}`);
    await page.evaluate(() => { const b = window.__board; const m = window.__model.markers.find(x => x.id === 'frosthold'); b.map.setView([-m.y, m.x], 5.2, { animate: false }); });
    await settle();
    const before = await layout();
    await page.evaluate(() => { const b = window.__board; b.map.setView(b.map.getCenter(), b.map.getZoom() + 2, { animate: false }); });
    await settle();
    const after = await layout();
    const a = before.markers['Frosthold Keep'].pin;
    const z = after.markers['Frosthold Keep'].pin;
    check('a marker keeps its size after a zoom', near(a.width, z.width, 0.5) && near(a.height, z.height, 0.5) && near(a.width, 30, 1), `${a.width} → ${z.width}`);
    check('the land is still vectors after a zoom (nothing to pixelate)', after.land === 6 && after.images === 0);
    check('the scale bar follows the zoom', after.scale.perPx < before.scale.perPx && near(after.scale.perPx * 4, before.scale.perPx, before.scale.perPx * 0.01));
    await page.evaluate(() => window.__board.show('fish-market', { open: false }));
    await page.waitForTimeout(600);
    const close = await layout();
    check('a close look shows the places inside a place', close.zoom === 'near' && close.markers['Fish Market'].shown === true && close.markers['Harbour Watch'].shown === true);
    await shot('4-close');
    const view = await page.evaluate(() => { const v = window.__board.view(); return { lat: v.center.lat, lng: v.center.lng, zoom: v.zoom }; });
    await page.evaluate(() => window.__board.update({ model: window.__model }));
    const kept = await page.evaluate(() => { const v = window.__board.view(); return { lat: v.center.lat, lng: v.center.lng, zoom: v.zoom }; });
    check('an update keeps the view (to within a pixel)', near(view.lat, kept.lat, 0.01) && near(view.lng, kept.lng, 0.01) && view.zoom === kept.zoom, `${JSON.stringify(view)} → ${JSON.stringify(kept)}`);
}

console.log('\n§5 the sidebar folds; the looks');
{
    await page.evaluate(() => { document.getElementById('dooms-atlas').classList.add('is-folded'); window.__board.size(); });
    await settle();
    let l = await layout();
    check('folded: the map takes the whole screen', !l.sideShown && near(l.stage.left, 0, 1) && near(l.stage.width, VIEW.width, 1));
    await page.evaluate(() => { document.getElementById('dooms-atlas').classList.remove('is-folded'); });
    const fills = {};
    for (const look of ['', 'arcade', 'console', 'grimoire', 'inked', 'lumen']) {
        await page.evaluate((k) => window.__open({ look: k }), look);
        await settle();
        l = await layout();
        fills[look || 'default'] = l.landFills[0];
        check(`the look "${look || 'default'}": the window, the markers and the land`, near(l.atlas.width, VIEW.width, 1) && l.count === 27 && l.land === 6 && !l.overflowX && !l.sideOverflow);
        await shot(`5-look-${look || 'default'}`);
    }
    check('the looks colour the land their own way', new Set(Object.values(fills)).size >= 3, JSON.stringify(fills));
}

console.log('\n§6 a phone');
{
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => window.__open({ look: '' }));
    await settle();
    const l = await layout();
    check('the map fills the phone, the sidebar a sheet over it', near(l.stage.width, 390, 1) && near(l.stage.left, 0, 1) && l.side.width <= 345 && !l.overflowX);
    await shot('6-phone');
}

check('no errors on the page', errors.length === 0, errors.join(' | '));
await browser.close();
server.close();
if (shots) console.log(`\nscreenshots: ${shotDir}`);
console.log(failures ? `\n${failures} failure(s)` : '\nall pass');
process.exit(failures ? 1 : 0);
