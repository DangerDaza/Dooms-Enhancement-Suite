#!/usr/bin/env node
/**
 * The Map window rendered for real: its views (src/systems/ui/worldViews.js,
 * pure) with a fixture world in the window's shell, the live stylesheets, a
 * headless Chromium, under the default look and the five looks, at desktop
 * and phone width. Fails when anything runs past the window, when the row
 * of places does not scroll sideways with more places than fit, or when
 * the panel is taller than its cap. --shots writes a PNG per look and
 * width to the folder it prints.
 *
 * Needs Playwright with Chromium; without it the check says so and passes.
 *
 * Usage:  node tools/map-window-layout-test.mjs [--shots]   (from the repo root)
 * Exit:   0 = pass or skipped, 1 = the window is wrong
 */
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const LOOKS = ['', 'arcade', 'console', 'grimoire', 'inked', 'lumen'];
const shots = process.argv.includes('--shots');

function loadPlaywright() {
    const require = createRequire(import.meta.url);
    for (const spec of ['playwright', '/opt/node-tools/node_modules/playwright']) {
        try { return require(spec); } catch (e) { /* next */ }
    }
    return null;
}
const pw = loadPlaywright();
if (!pw) { console.log('map-window-layout-test: skipped (no Playwright with Chromium on this machine)'); process.exit(0); }

const M = await import(pathToFileURL(join(repo, 'src/utils/liveWorld.js')).href);
const W = await import(pathToFileURL(join(repo, 'src/utils/worldMap.js')).href);
const V = await import(pathToFileURL(join(repo, 'src/systems/ui/worldViews.js')).href);

// A world with places visited, some drawn, people moved, a clock stepped, quests done.
const pack = M.normalizePack(JSON.parse(readFileSync(join(repo, 'worldpacks/example.json'), 'utf8'))).pack;
const art = (hue, text) => `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue},60%,45%)"/><stop offset="1" stop-color="hsl(${hue + 40},50%,20%)"/></linearGradient></defs><rect width="300" height="300" fill="url(#g)"/><text x="150" y="160" font-size="28" fill="#fff" text-anchor="middle" font-family="sans-serif">${text}</text></svg>`)}`;
let st = M.seedWorldState(pack);
const places = ['The Anchor, the old town', 'the quay', 'The docks', 'Old Town', 'The Hill', 'the archive', 'A nameless road', 'the governor\'s house', 'the chandlery', 'the fever ward'];
places.forEach((loc, i) => { st = W.visitPlace(st, pack, { location: loc, msgId: `m${i}`, gameDate: `Day ${i + 1}`, gameTime: i % 2 ? 'dusk' : 'dawn' }).state; });
st.visited.forEach((e, i) => { if (i % 2 === 0) e.image = art(30 * i, e.label.slice(0, 14)); });
st = M.applyAdvance(st, { clocks: { blockade: 2 }, moved: [{ who: 'Old Marit', to: 'governors-house', reason: 'summoned' }], blurb: 'Talk of a search on the quay; the governor keeps to his house.', heard: ['Maeve'] }, pack, { msgId: 'm9', gameDate: 'Day 10', gameTime: 'dusk' });
const cfg = M.liveWorldConfig({ liveWorld: { enabled: true, every: 6 } });
const row = W.placesRow(st, pack);
const facts = { date: 'Day 10', time: 'dusk', location: 'the fever ward' };
const done = [{ text: 'Find the warden', at: 1, gameDate: 'Day 3' }, { text: 'Feed the cat of the Anchor', at: 2, gameDate: 'Day 7' }];
const panels = { news: {}, people: {}, done: {}, rumours: {} };
const body = (panel, selected) => V.mapWindowHtml({ state: st, pack, cfg, facts, portraits: (n) => (n === 'Old Marit' ? art(200, 'OM') : ''), row, selected, drawing: '', panel, done, present: ['Old Marit'] });

const css = ['styles/modals.css', 'style.css', 'styles/overhaul.css'].map(f => `<link rel="stylesheet" href="${pathToFileURL(join(repo, f)).href}">`).join('\n');
const shell = (inner) => `<div id="rpg-world-popup" class="rpg-settings-popup" role="dialog" style="display: flex;"><div class="rpg-settings-popup-content"><header class="rpg-settings-popup-header"><h3 id="rpg-world-title"><i class="fa-solid fa-map"></i> <span>Map</span></h3><button class="rpg-popup-close" type="button">&times;</button></header><div class="rpg-settings-popup-body"><div class="dooms-world-body">${inner}</div></div><footer class="rpg-settings-popup-footer rpg-world-actions"><button class="rpg-accordion-action-btn" type="button">Advance now</button><button class="rpg-accordion-action-btn" type="button">Refresh</button><button class="rpg-accordion-action-btn" type="button"><i class="fa-solid fa-earth-europe"></i> <span>Make this a world</span></button><span class="dooms-world-result">The world moved.</span></footer></div></div>`;
const out = mkdtempSync(join(process.env.TMPDIR || tmpdir(), 'des-map-'));
const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">${css}<style>html, body { margin: 0; background: #111; }</style></head><body>${shell(body('news', 'the-docks'))}</body></html>`;
writeFileSync(join(out, 'harness.html'), html);

const browser = await pw.chromium.launch();
const failures = [];
let measured = 0;
for (const [label, viewport] of [['desktop', { width: 1200, height: 900 }], ['phone', { width: 390, height: 844 }]]) {
    const page = await browser.newPage({ viewport, isMobile: label === 'phone', hasTouch: label === 'phone' });
    page.on('pageerror', () => {});
    await page.goto(pathToFileURL(join(out, 'harness.html')).href, { waitUntil: 'load' });
    for (const look of LOOKS) {
        await page.evaluate((l) => { if (l) document.body.setAttribute('data-dooms-ui', l); else document.body.removeAttribute('data-dooms-ui'); }, look);
        for (const panel of Object.keys(panels)) {
            await page.evaluate(({ html }) => { document.querySelector('.dooms-world-body').innerHTML = html; }, { html: body(panel, 'the-docks') });
            const r = await page.evaluate(() => {
                const content = document.querySelector('#rpg-world-popup .rpg-settings-popup-content');
                const cr = content.getBoundingClientRect();
                const problems = [];
                const visible = (el) => { const b = el.getBoundingClientRect(); return b.width > 0 && b.height > 0; };
                for (const el of content.querySelectorAll('.dooms-map *')) {
                    if (!visible(el)) continue;
                    if (el.closest('.dooms-map-row')) continue;    // the row scrolls sideways by design
                    const b = el.getBoundingClientRect();
                    if (b.right > cr.right + 2 || b.left < cr.left - 2) { problems.push(`<${el.tagName.toLowerCase()} class="${el.className}"> runs past the window (${Math.round(b.left)}..${Math.round(b.right)} of ${Math.round(cr.left)}..${Math.round(cr.right)})`); break; }
                }
                const rowEl = content.querySelector('.dooms-map-row');
                if (!rowEl) problems.push('no row of places');
                else if (rowEl.scrollWidth <= rowEl.clientWidth + 2) problems.push(`the row does not scroll with ${rowEl.children.length} places (scroll ${rowEl.scrollWidth}, visible ${rowEl.clientWidth})`);
                const panelEl = content.querySelector('.dooms-map-panel');
                const ph = panelEl ? panelEl.getBoundingClientRect().height : 0;
                if (panelEl && ph > 361) problems.push(`the panel is ${Math.round(ph)}px tall`);
                const strip = content.querySelector('.dooms-map-strip');
                if (!strip || !strip.textContent.includes('Travel here') && !strip.querySelector('[data-act="travel"]')) problems.push('the strip has no Travel here for a place that is not the current one');
                if (strip) {
                    const sb = strip.getBoundingClientRect();
                    for (const b of strip.querySelectorAll('button, input')) {
                        const r = b.getBoundingClientRect();
                        if (r.bottom > sb.bottom + 2 || r.top < sb.top - 2) { problems.push(`the strip's <${b.tagName.toLowerCase()}> "${(b.textContent || b.placeholder || '').trim().slice(0, 20)}" sticks out of the strip (${Math.round(r.top)}..${Math.round(r.bottom)} of ${Math.round(sb.top)}..${Math.round(sb.bottom)})`); break; }
                    }
                    const stripButtons = strip.querySelectorAll('button');
                    if (stripButtons.length && Array.from(stripButtons).some(b => b.getBoundingClientRect().width > sb.width * 0.6)) problems.push('a strip button takes most of the strip');
                }
                const wrap = content.querySelector('.dooms-map-row-wrap');
                if (wrap) {
                    const wb = wrap.getBoundingClientRect();
                    for (const name of wrap.querySelectorAll('.dooms-map-name')) {
                        const r = name.getBoundingClientRect();
                        if (r.right < wb.left || r.left > wb.right) continue;    // scrolled out of view sideways, by design
                        if (r.bottom > wb.bottom + 1 || r.top < wb.top - 1) { problems.push(`a place's name "${name.textContent.trim()}" is clipped by the row (${Math.round(r.top)}..${Math.round(r.bottom)} of ${Math.round(wb.top)}..${Math.round(wb.bottom)})`); break; }
                    }
                }
                const foot = content.querySelector('.rpg-world-actions');
                // A phone's foot is narrow: a long label there is not a stretched button; only one across most of it is.
                const footShare = window.innerWidth < 700 ? 0.75 : 0.6;
                if (foot && Array.from(foot.querySelectorAll('button')).some(b => b.getBoundingClientRect().width > foot.getBoundingClientRect().width * footShare)) problems.push('a foot button takes most of the foot');
                const art = content.querySelector('.dooms-map-place.has-image .dooms-map-art');
                if (art && !getComputedStyle(art).backgroundImage.includes('data:image')) problems.push('a drawn place shows no picture');
                return { problems, count: content.querySelectorAll('.dooms-map *').length };
            });
            measured += r.count;
            for (const p of r.problems) failures.push(`[${label}/${look || 'default'}/${panel}] ${p}`);
            if (shots) {
                mkdirSync(join(out, 'shots'), { recursive: true });
                await page.screenshot({ path: join(out, 'shots', `${label}-${look || 'default'}-${panel}.png`) }).catch(() => {});
            }
        }
    }
    await page.close();
}
await browser.close();
if (shots) console.log(`screenshots: ${join(out, 'shots')}`);
if (failures.length) {
    for (const f of failures) console.error(`FAIL  ${f}`);
    console.error(`\n${failures.length} layout failure(s)`);
    process.exit(1);
}
console.log(`map-window-layout-test: ${measured} elements measured under ${LOOKS.length} looks at two widths; nothing runs past the window, the row scrolls, the panel keeps its height`);
