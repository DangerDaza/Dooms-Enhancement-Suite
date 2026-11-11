#!/usr/bin/env node
/**
 * The board for real (docs/hub-plan.md D124, D134, D135): Leaflet mounted by
 * src/systems/ui/hubBoard.js in a headless Chromium over a picture. The nodes
 * sit where their fractions say and keep their size after a zoom; a click on
 * a node names it; in edit mode a drag moves a node, a place dropped from a
 * list lands where it was dropped, a tap places the picked place, a node's
 * menu takes it off; an update moves and removes markers; destroy leaves the
 * frame clean. The repo is served over HTTP for the run (ES modules do not
 * load from file: URLs).
 *
 * Needs Playwright with Chromium; without it the check says so and passes.
 *
 * Usage:  node tools/hub-board-browser-test.mjs [--shots]   (from the repo root; --shots writes a PNG per mode)
 * Exit:   0 = pass or skipped, 1 = failure
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, resolve, dirname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const shots = process.argv.includes('--shots');
const shotDir = shots ? mkdtempSync(join(process.env.TMPDIR || tmpdir(), 'des-board-')) : '';

function loadPlaywright() {
    const require = createRequire(import.meta.url);
    for (const spec of ['playwright', '/opt/node-tools/node_modules/playwright']) {
        try { return require(spec); } catch (e) { /* next */ }
    }
    return null;
}
const pw = loadPlaywright();
if (!pw) { console.log('hub-board-browser-test: skipped (no Playwright with Chromium on this machine)'); process.exit(0); }

const TYPES = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };
const harness = `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="/lib/leaflet/leaflet.css"><link rel="stylesheet" href="/styles/modals.css"><link rel="stylesheet" href="/style.css">
<style>html, body { margin: 0; background: #111; } #board { width: 800px; height: 400px; }</style></head>
<body><div id="board"></div>
<script type="module">
import { mountBoard } from '/src/systems/ui/hubBoard.js';
window.__events = [];
window.__mount = async (opts) => {
    window.__board = await mountBoard(document.getElementById('board'), { ...opts, on: {
        node: (id) => window.__events.push(['node', id]),
        move: (id, n) => window.__events.push(['move', id, n]),
        drop: (id, n) => window.__events.push(['drop', id, n]),
        tap: (n) => window.__events.push(['tap', n]),
        remove: (id) => window.__events.push(['remove', id]),
        error: () => window.__events.push(['error']),
    } });
    return true;
};
</script></body></html>`;
// A window with a board in it, on the settings popup's shell (the World Builder's Map tab is one; the old Hub window was
// another, docs/long-shot-plan.md D195): the board in its frame, the backdrop bound through the window stack's helper
// (no SillyTavern: no controller is loaded; the helper, the shell's classes and the board are the real ones).
const windowHarness = `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="/lib/leaflet/leaflet.css"><link rel="stylesheet" href="/styles/modals.css"><link rel="stylesheet" href="/style.css">
<style>html, body { margin: 0; background: #222; } .dooms-test-map { height: 460px; }</style></head>
<body>
<script type="module">
import { mountBoard } from '/src/systems/ui/hubBoard.js';
import { closeOnBackdrop } from '/src/systems/ui/windowStack.js';
import { normalizePack, seedWorldState } from '/src/utils/liveWorld.js';
import { boardModel } from '/src/utils/worldPicture.js';
const POPUP_ID = 'dooms-test-popup';
window.__closes = 0;
document.body.insertAdjacentHTML('beforeend', '<div id="' + POPUP_ID + '" class="rpg-settings-popup" role="dialog" aria-modal="true" style="display: none;"><div class="rpg-settings-popup-content"><header class="rpg-settings-popup-header"><h3>A window with a board</h3></header><div class="rpg-settings-popup-body"><div class="dooms-test-map"></div></div></div></div>');
closeOnBackdrop(POPUP_ID, () => { window.__closes++; });
window.__open = async (picture) => {
    const raw = await (await fetch('/worldpacks/example.json')).json();
    const placed = raw.places.map(p => (p.id === 'the-anchor' ? { ...p, x: 0.2, y: 0.7 } : p.id === 'customs-house' ? { ...p, x: 0.6, y: 0.3 } : p.id === 'harbourside' ? { ...p, x: 0.5, y: 0.5 } : p));
    const pack = normalizePack({ ...raw, id: 'harbourside', map: { ...picture, source: 'upload' }, places: placed }).pack;
    const state = seedWorldState(pack, { name: '' });
    const model = boardModel({ pack, state, player: 'Jordan' });
    const popup = document.getElementById(POPUP_ID);
    popup.style.display = 'flex';
    const host = popup.querySelector('.dooms-test-map');
    host.innerHTML = '';
    window.__board = await mountBoard(host, { picture, nodes: model.nodes, mode: 'hub', on: { node: () => {} } });
    return true;
};
window.__ready = true;
</script></body></html>`;
const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname === '/harness.html') { res.writeHead(200, { 'content-type': 'text/html' }); res.end(harness); return; }
    if (url.pathname === '/window.html') { res.writeHead(200, { 'content-type': 'text/html' }); res.end(windowHarness); return; }
    const file = normalize(join(repo, decodeURIComponent(url.pathname)));
    if (!file.startsWith(repo)) { res.writeHead(403); res.end(); return; }
    try { const data = await readFile(file); res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' }); res.end(data); }
    catch (e) { res.writeHead(404); res.end(); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="500"><rect width="1000" height="500" fill="#334455"/><rect width="500" height="250" fill="#446655"/></svg>';
const picture = { image: `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`, width: 1000, height: 500 };
const nodes = [
    { id: 'a', label: 'The Anchor', x: 0.2, y: 0.7, image: '', region: 'Harbourside', isRegion: false, visited: true, people: ['Old Marit'], player: true, weather: null },
    { id: 'b', label: 'Customs house', x: 0.6, y: 0.3, image: '', region: 'Harbourside', isRegion: false, visited: false, people: [], player: false, weather: { emoji: '🌧', text: 'rain' } },
    { id: 'r', label: 'Harbourside', x: 0.5, y: 0.5, image: '', region: '', isRegion: true, visited: true, people: ['A', 'B', 'C', 'D', 'E'], player: false, weather: null },
];

let failures = 0;
const check = (name, cond, detail = '') => { if (cond) console.log(`pass  ${name}`); else { failures++; console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ''}`); } };
const near = (a, b, tol) => Math.abs(a - b) <= tol;

const browser = await pw.chromium.launch();
const page = await browser.newPage({ viewport: { width: 1000, height: 600 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e && e.message ? e.message : e)));
await page.goto(`${base}/harness.html`, { waitUntil: 'load' });

/** Where things are on screen: the picture's rect and each node's centre. */
const layout = () => page.evaluate(() => {
    const img = document.querySelector('#board .leaflet-image-layer');
    const ir = img ? img.getBoundingClientRect() : null;
    const out = {};
    document.querySelectorAll('#board .dooms-node').forEach(el => {
        const r = el.getBoundingClientRect();
        const label = el.querySelector('.dooms-node-label');
        out[label ? label.textContent : '?'] = { cx: r.left + r.width / 2, cy: r.top + r.height / 2, w: r.width, h: r.height, cls: el.className, faces: el.querySelectorAll('.dooms-node-face').length };
    });
    return { img: ir ? { left: ir.left, top: ir.top, width: ir.width, height: ir.height } : null, nodes: out, mounted: !!document.querySelector('#board.leaflet-container'), count: document.querySelectorAll('#board .dooms-node').length };
});
const expectAt = (lay, label, x, y, tol = 3) => {
    const n = lay.nodes[label];
    return !!n && near(n.cx, lay.img.left + x * lay.img.width, tol) && near(n.cy, lay.img.top + y * lay.img.height, tol);
};

console.log('\n§1 the board, read only (the old Hub window\'s mode: no window uses it now, the board itself is the same)');
{
    await page.evaluate((o) => window.__mount(o), { picture, nodes, mode: 'hub' });
    await page.waitForTimeout(150);
    const lay = await layout();
    check('Leaflet is mounted over the picture, fitted to the frame, with the three nodes', lay.mounted && lay.count === 3 && lay.img && lay.img.width > 500 && lay.img.width <= 800 && near(lay.img.width / lay.img.height, 2, 0.02), JSON.stringify(lay.img));
    check('each node sits where its fractions say', expectAt(lay, 'The Anchor', 0.2, 0.7) && expectAt(lay, 'Customs house', 0.6, 0.3) && expectAt(lay, 'Harbourside', 0.5, 0.5), JSON.stringify(lay));
    check('the people on the rim (four faces, then +n), the player ringed, the unvisited dimmed, the region dashed', lay.nodes['Harbourside'].faces === 5 && lay.nodes['The Anchor'].faces === 1 && /is-player/.test(lay.nodes['The Anchor'].cls) && /is-unvisited/.test(lay.nodes['Customs house'].cls) && /is-region/.test(lay.nodes['Harbourside'].cls));
    if (shots) await page.screenshot({ path: join(shotDir, 'board-hub.png'), clip: { x: 0, y: 0, width: 800, height: 400 } });
    const before = lay;
    await page.evaluate(() => window.__board.map.zoomIn(1, { animate: false }));
    await page.waitForTimeout(100);
    const zoomed = await layout();
    check('zoomed in by one: the picture twice as wide, the nodes the same size and still on their spots', near(zoomed.img.width, before.img.width * 2, 2) && near(zoomed.nodes['The Anchor'].w, before.nodes['The Anchor'].w, 1) && expectAt(zoomed, 'The Anchor', 0.2, 0.7) && expectAt(zoomed, 'Customs house', 0.6, 0.3), JSON.stringify([before.img, zoomed.img]));
    const r = zoomed.nodes['Harbourside'];    // the picture's centre stays in the frame after the zoom; The Anchor is off its left edge now
    await page.mouse.click(r.cx, r.cy);
    await page.waitForTimeout(50);
    const ev = await page.evaluate(() => window.__events.splice(0));
    check('a click on a node names it', ev.some(x => x[0] === 'node' && x[1] === 'r'), JSON.stringify(ev));
    await page.evaluate(() => window.__board.update({ nodes: [{ id: 'a', label: 'The Anchor', x: 0.1, y: 0.1, people: [], player: false, visited: true, isRegion: false }, { id: 'r', label: 'Harbourside', x: 0.5, y: 0.5, isRegion: true, people: [], visited: true }] }));
    await page.waitForTimeout(50);
    const upd = await layout();
    check('an update moves a node, redraws it and removes the one that is gone', upd.count === 2 && expectAt(upd, 'The Anchor', 0.1, 0.1) && upd.nodes['The Anchor'].faces === 0 && !/is-player/.test(upd.nodes['The Anchor'].cls) && !upd.nodes['Customs house'], JSON.stringify(upd.nodes));
    await page.evaluate(() => window.__board.destroy());
    const gone = await page.evaluate(() => ({ mounted: !!document.querySelector('#board.leaflet-container'), html: document.getElementById('board').innerHTML.length, cls: document.getElementById('board').className }));
    check('destroyed: the frame is clean', !gone.mounted && gone.html === 0 && gone.cls === '', JSON.stringify(gone));
}

console.log('\n§2 the builder\'s board (edit mode)');
{
    await page.evaluate((o) => window.__mount(o), { picture, nodes, mode: 'edit' });
    await page.waitForTimeout(150);
    const lay = await layout();
    check('mounted in edit mode with the nodes', lay.mounted && lay.count === 3 && /is-edit/.test(lay.nodes['The Anchor'].cls));
    if (shots) await page.screenshot({ path: join(shotDir, 'board-edit.png'), clip: { x: 0, y: 0, width: 800, height: 400 } });
    const a = lay.nodes['The Anchor'];
    await page.mouse.move(a.cx, a.cy);
    await page.mouse.down();
    await page.mouse.move(a.cx + 50, a.cy + 25, { steps: 8 });
    await page.mouse.move(a.cx + 100, a.cy + 50, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(80);
    let ev = await page.evaluate(() => window.__events.splice(0));
    const moved = ev.find(x => x[0] === 'move' && x[1] === 'a');
    check('a node dragged tells its new fractions', !!moved && near(moved[2].x, (a.cx + 100 - lay.img.left) / lay.img.width, 0.02) && near(moved[2].y, (a.cy + 50 - lay.img.top) / lay.img.height, 0.02), JSON.stringify(ev));
    const dropped = await page.evaluate(({ cx, cy }) => {
        const el = document.getElementById('board');
        const dt = new DataTransfer();
        dt.setData('text/plain', 'new-place');
        const over = new DragEvent('dragover', { bubbles: true, cancelable: true, clientX: cx, clientY: cy, dataTransfer: dt });
        el.dispatchEvent(over);
        const drop = new DragEvent('drop', { bubbles: true, cancelable: true, clientX: cx, clientY: cy, dataTransfer: dt });
        el.dispatchEvent(drop);
        return { prevented: over.defaultPrevented && drop.defaultPrevented };
    }, { cx: lay.img.left + lay.img.width * 0.5, cy: lay.img.top + lay.img.height * 0.5 });
    ev = await page.evaluate(() => window.__events.splice(0));
    const drop = ev.find(x => x[0] === 'drop');
    check('a place dropped from the list lands where it was dropped', dropped.prevented && !!drop && drop[1] === 'new-place' && near(drop[2].x, 0.5, 0.01) && near(drop[2].y, 0.5, 0.01), JSON.stringify(ev));
    await page.mouse.click(lay.img.left + lay.img.width * 0.8, lay.img.top + lay.img.height * 0.8);
    await page.waitForTimeout(80);
    ev = await page.evaluate(() => window.__events.splice(0));
    const tap = ev.find(x => x[0] === 'tap');
    check('a tap on the picture gives its fractions (the picked place goes there)', !!tap && near(tap[1].x, 0.8, 0.01) && near(tap[1].y, 0.8, 0.01), JSON.stringify(ev));
    const b = lay.nodes['Customs house'];
    await page.mouse.click(b.cx, b.cy);
    await page.waitForTimeout(100);
    const pop = await page.evaluate(() => { const p = document.querySelector('.dooms-node-popup'); const btn = p ? p.querySelector('[data-act="node-remove"]') : null; if (btn) { const r = btn.getBoundingClientRect(); return { open: true, id: btn.getAttribute('data-id'), x: r.left + r.width / 2, y: r.top + r.height / 2 }; } return { open: false }; });
    check('a click on a node in edit mode opens its menu', pop.open && pop.id === 'b', JSON.stringify(pop));
    if (shots) await page.screenshot({ path: join(shotDir, 'board-edit-menu.png'), clip: { x: 0, y: 0, width: 800, height: 400 } });
    if (pop.open) { await page.mouse.click(pop.x, pop.y); await page.waitForTimeout(80); }
    ev = await page.evaluate(() => window.__events.splice(0));
    const closed = await page.evaluate(() => !document.querySelector('.dooms-node-popup'));
    check('"Take off the map" names the node and closes the menu', ev.some(x => x[0] === 'remove' && x[1] === 'b') && closed, JSON.stringify(ev));
    await page.evaluate(() => window.__board.destroy());
}
console.log('\n§3 a picture that will not load');
{
    await page.evaluate((o) => window.__mount(o), { picture: { image: '/no-such-folder/gone.png', width: 1000, height: 500 }, nodes, mode: 'hub' });
    await page.waitForTimeout(300);
    const ev = await page.evaluate(() => window.__events.splice(0));
    const lay = await layout();
    check('the file gone: the host hears error (the nodes would float over a dark frame without a word otherwise)', ev.some(x => x[0] === 'error') && lay.mounted, JSON.stringify(ev));
    await page.evaluate(() => window.__board.destroy());
    await page.evaluate((o) => window.__mount(o), { picture: { image: 'C:\\maps\\world.png', width: 1000, height: 500 }, nodes, mode: 'hub' });
    await page.waitForTimeout(300);
    const ev2 = await page.evaluate(() => window.__events.splice(0));
    check('a path safeImageUrl refuses (an empty src): error too', ev2.some(x => x[0] === 'error'), JSON.stringify(ev2));
    await page.evaluate(() => window.__board.destroy());
}

console.log('\n§4 the window\'s backdrop: a pan let go past the window\'s edge is not a close (D134)');
{
    const win = await browser.newPage({ viewport: { width: 1366, height: 768 } });
    win.on('pageerror', (e) => errors.push(String(e && e.message ? e.message : e)));
    await win.goto(`${base}/window.html`, { waitUntil: 'load' });
    await win.waitForFunction(() => window.__ready === true);
    await win.evaluate((p) => window.__open(p), picture);
    await win.waitForTimeout(300);
    const rects = await win.evaluate(() => {
        const r = (sel) => { const b = document.querySelector(sel).getBoundingClientRect(); return { left: b.left, top: b.top, right: b.right, bottom: b.bottom, width: b.width, height: b.height }; };
        const nodes = [...document.querySelectorAll('#dooms-test-popup .dooms-node')].map(el => { const b = el.getBoundingClientRect(); return { left: b.left, top: b.top, right: b.right, bottom: b.bottom }; });
        return { content: r('#dooms-test-popup .rpg-settings-popup-content'), host: r('#dooms-test-popup .dooms-test-map'), nodes };
    });
    const band = Math.max(2, Math.floor(rects.content.left / 2));    // the backdrop's band left of the window
    const press = { x: rects.host.left + 30, y: rects.host.bottom - 30 };
    const onNode = rects.nodes.some(n => press.x >= n.left && press.x <= n.right && press.y >= n.top && press.y <= n.bottom);
    check('the window leaves a band of backdrop beside it on a desktop, and the press spot is clear of every node', rects.content.left > 8 && !onNode, JSON.stringify(rects));
    const centre = () => win.evaluate(() => { const c = window.__board.map.getCenter(); return [c.lat, c.lng]; });
    const before = await centre();
    await win.mouse.move(press.x, press.y);
    await win.mouse.down();
    await win.mouse.move(band, press.y, { steps: 12 });
    await win.mouse.up();
    await win.waitForTimeout(150);
    const after = await centre();
    let closes = await win.evaluate(() => window.__closes);
    check('a pan from the board released over the backdrop pans the map and does not close the window', JSON.stringify(before) !== JSON.stringify(after) && closes === 0, JSON.stringify({ before, after, closes }));
    await win.mouse.click(band, rects.content.top + 40);
    await win.waitForTimeout(100);
    closes = await win.evaluate(() => window.__closes);
    check('a click on the backdrop itself still closes', closes === 1, String(closes));
    await win.mouse.move(rects.host.left + 30, rects.host.top + 30);
    await win.mouse.down();
    await win.mouse.move(rects.host.left + 30, Math.max(2, Math.floor(rects.content.top / 2)), { steps: 10 });
    await win.mouse.up();
    await win.waitForTimeout(150);
    closes = await win.evaluate(() => window.__closes);
    check('a pan released over the backdrop above the window: not a close either', closes === 1, String(closes));
    if (shots) await win.screenshot({ path: join(shotDir, 'window-backdrop.png') });
    await win.close();
}
check('no page errors', errors.length === 0, errors.join(' | '));

await browser.close();
server.close();
if (shots) console.log(`screenshots: ${shotDir}`);
console.log(`\n${failures === 0 ? 'All hub board browser checks pass' : `${failures} FAILURE(S)`}`);
process.exit(failures === 0 ? 0 : 1);
