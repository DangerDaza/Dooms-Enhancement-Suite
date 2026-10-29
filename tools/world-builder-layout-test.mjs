#!/usr/bin/env node
/**
 * The World Builder rendered for real (docs/world-builder-plan.md D99): its
 * views (src/systems/ui/worldBuilderViews.js, pure) with a fixture world in
 * the window's shell, the live stylesheets, a headless Chromium, under the
 * default look and the five looks, at desktop and phone width, on each of
 * its tabs and with no world open. Fails when anything runs past the window
 * sideways, when a tab or a foot button is out of the window or too wide,
 * when a field is squeezed, or when the list of worlds takes the phone's
 * screen. --shots writes a PNG per look, width and tab to the folder it
 * prints.
 *
 * Needs Playwright with Chromium; without it the check says so and passes.
 *
 * Usage:  node tools/world-builder-layout-test.mjs [--shots]   (from the repo root)
 * Exit:   0 = pass or skipped, 1 = the window is wrong
 */
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const LOOKS = ['', 'arcade', 'console', 'grimoire', 'inked', 'lumen'];
const WIDTHS = [{ name: 'desktop', width: 1200, height: 900 }, { name: 'phone', width: 390, height: 844 }];
const shots = process.argv.includes('--shots');

function loadPlaywright() {
    const require = createRequire(import.meta.url);
    for (const spec of ['playwright', '/opt/node-tools/node_modules/playwright']) {
        try { return require(spec); } catch (e) { /* next */ }
    }
    return null;
}
const pw = loadPlaywright();
if (!pw) { console.log('world-builder-layout-test: skipped (no Playwright with Chromium on this machine)'); process.exit(0); }

const M = await import(pathToFileURL(join(repo, 'src/utils/liveWorld.js')).href);
const B = await import(pathToFileURL(join(repo, 'src/utils/worldBuilder.js')).href);
const V = await import(pathToFileURL(join(repo, 'src/systems/ui/worldBuilderViews.js')).href);

const harbour = M.normalizePack(JSON.parse(readFileSync(join(repo, 'worldpacks/example.json'), 'utf8'))).pack;
const draft = B.worldToRaw(harbour);
draft.places.push({ id: 'the-long-stair', label: 'The long stair down to the water, past the chandlery and the rope-walk', parent: 'the-hill' });
draft.cast.push({ name: 'A nameless courier with a very long name indeed', tier: 'heard' });
const broken = B.worldToRaw(harbour);
broken.places[1].parent = 'nowhere';
broken.clocks[0].max = 0;
const worlds = [
    { id: 'harbourside', name: 'Harbourside', custom: true, template: false, ok: true, errors: [], summary: B.worldSummary(harbour) },
    { id: 'skyreach', name: 'Skyreach, the long campaign of the northern crossings', custom: true, template: false, ok: true, errors: [], summary: '6 places · 2 clocks · 2 people' },
    { id: 'broken', name: 'broken', custom: true, template: false, ok: false, errors: ['A place has no id.'], summary: '' },
    { id: 'example', name: 'Harbourside', custom: false, template: true, ok: true, errors: [], summary: B.worldSummary(harbour) },
];
const where = { pack: 'harbourside', chatPack: 'skyreach', chatOpen: true };
const scenes = [
    { name: 'empty', html: V.builderHtml({ worlds, selectedId: '', draft: null, where }) },
    ...V.WB_TABS.map(t => ({ name: t.id, html: V.builderHtml({ worlds, selectedId: 'harbourside', draft, dirty: true, tab: t.id, note: 'Saved.', where }) })),
    { name: 'errors', html: V.builderHtml({ worlds, selectedId: 'new', draft: broken, dirty: true, tab: 'places', note: 'Drafted, with problems listed below.', adoptOnSave: true, where }) },
];

const css = ['styles/modals.css', 'style.css', 'styles/overhaul.css'].map(f => `<link rel="stylesheet" href="${pathToFileURL(join(repo, f)).href}">`).join('\n');
const out = mkdtempSync(join(process.env.TMPDIR || tmpdir(), 'des-wb-'));
const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">${css}<style>html, body { margin: 0; background: #111; } #${V.POPUP_ID} { display: flex !important; }</style></head><body>${V.builderShellHtml()}</body></html>`;
writeFileSync(join(out, 'harness.html'), html);
if (shots) mkdirSync(join(out, 'shots'), { recursive: true });

const browser = await pw.chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
page.on('pageerror', () => {});
await page.goto(pathToFileURL(join(out, 'harness.html')).href, { waitUntil: 'load' });

const failures = [];
let renders = 0;
for (const w of WIDTHS) {
    await page.setViewportSize({ width: w.width, height: w.height });
    for (const look of LOOKS) {
        await page.evaluate((l) => { if (l) document.body.setAttribute('data-dooms-ui', l); else document.body.removeAttribute('data-dooms-ui'); }, look);
        for (const scene of scenes) {
            await page.evaluate(({ id, inner }) => { document.querySelector(`#${id} .dooms-wb-body`).innerHTML = inner; }, { id: V.POPUP_ID, inner: scene.html });
            const report = await page.evaluate(({ id, phone }) => {
                const faults = [];
                const popup = document.getElementById(id);
                const content = popup.querySelector('.rpg-settings-popup-content');
                const cb = content.getBoundingClientRect();
                const inside = (el, what, slack = 1) => {
                    const r = el.getBoundingClientRect();
                    if (r.width === 0 && r.height === 0) return;
                    if (r.left < cb.left - slack || r.right > cb.right + slack) faults.push(`${what} runs past the window sideways (${Math.round(r.left)}..${Math.round(r.right)} of ${Math.round(cb.left)}..${Math.round(cb.right)})`);
                };
                if (content.scrollWidth > content.clientWidth + 1) faults.push(`the window scrolls sideways (${content.scrollWidth} > ${content.clientWidth})`);
                const pane = popup.querySelector('.dooms-wb-pane');
                if (pane && pane.scrollWidth > pane.clientWidth + 1) faults.push(`the pane scrolls sideways (${pane.scrollWidth} > ${pane.clientWidth})`);
                const list = popup.querySelector('.dooms-wb-list');
                if (list) {
                    inside(list, 'the list of worlds');
                    const lr = list.getBoundingClientRect();
                    if (phone && lr.height > cb.height * 0.5) faults.push(`the list takes ${Math.round(lr.height / cb.height * 100)}% of the phone's window`);
                    if (!phone && (lr.width < 200 || lr.width > 320)) faults.push(`the list is ${Math.round(lr.width)}px wide`);
                }
                // The worlds: in their scroller (a column on the desktop, a row that scrolls sideways on a phone); the scroller itself in the window.
                const worldsEl = popup.querySelector('.dooms-wb-worlds');
                if (worldsEl) {
                    inside(worldsEl, 'the worlds list');
                    const sideways = phone;    // the row scrolls sideways on a phone (style.css, max-width: 700px); a column on the desktop
                    const wr = worldsEl.getBoundingClientRect();
                    popup.querySelectorAll('.dooms-wb-world').forEach(el => {
                        const r = el.getBoundingClientRect();
                        const name = el.querySelector('.dooms-wb-world-name') ? el.querySelector('.dooms-wb-world-name').textContent.trim().slice(0, 24) : '?';
                        if (sideways) { if (r.top < wr.top - 1 || r.bottom > wr.bottom + 1) faults.push(`the world "${name}" runs out of the row vertically`); }
                        else inside(el, `the world "${name}"`);
                    });
                    if (sideways && worldsEl.scrollWidth <= worldsEl.clientWidth && popup.querySelectorAll('.dooms-wb-world').length > 2) faults.push('the worlds row on the phone does not scroll sideways');
                    if (list && wr.bottom > list.getBoundingClientRect().bottom + 1) faults.push(`the worlds row is cut off below the list (${Math.round(wr.bottom)} > ${Math.round(list.getBoundingClientRect().bottom)})`);
                }
                popup.querySelectorAll('.dooms-wb-tab').forEach(el => inside(el, `the tab "${el.textContent.trim()}"`));
                popup.querySelectorAll('.dooms-wb-foot button, .dooms-wb-new button').forEach(el => {
                    inside(el, `the button "${el.textContent.trim()}"`);
                    const share = phone ? 0.9 : 0.6;    // a phone's window is narrow: only a button stretched across it is a fault there
                    if (el.getBoundingClientRect().width > cb.width * share) faults.push(`the button "${el.textContent.trim()}" is wider than ${Math.round(share * 100)}% of the window`);
                });
                if (pane) {
                    const pr = pane.getBoundingClientRect();
                    pane.querySelectorAll('input, select, textarea').forEach(el => {
                        const r = el.getBoundingClientRect();
                        if (r.width === 0 || el.type === 'checkbox') return;
                        const label = el.getAttribute('aria-label') || el.getAttribute('data-f') || el.tagName;
                        if (r.left < pr.left - 1 || r.right > pr.right + 1) faults.push(`the field "${label}" runs past the pane (${Math.round(r.left)}..${Math.round(r.right)} of ${Math.round(pr.left)}..${Math.round(pr.right)})`);
                        const min = el.type === 'number' ? 44 : (el.tagName === 'SELECT' ? 70 : 90);
                        if (r.width < min) faults.push(`the field "${label}" is ${Math.round(r.width)}px wide`);
                    });
                    pane.querySelectorAll('.dooms-wb-step').forEach(el => { const r = el.getBoundingClientRect(); if (r.width < (phone ? 200 : 180)) faults.push(`a clock step is ${Math.round(r.width)}px wide`); });
                }
                return faults;
            }, { id: V.POPUP_ID, phone: w.name === 'phone' });
            renders++;
            for (const f of report) failures.push(`${look || 'default'} / ${w.name} / ${scene.name}: ${f}`);
            if (shots) await page.screenshot({ path: join(out, 'shots', `wb-${look || 'default'}-${w.name}-${scene.name}.png`) });
        }
    }
}
await browser.close();
if (shots) console.log(`screenshots: ${join(out, 'shots')}`);
if (failures.length) {
    console.error(`world-builder-layout-test: ${failures.length} fault(s) in ${renders} renders`);
    for (const f of [...new Set(failures)]) console.error(`  ${f}`);
    process.exit(1);
}
console.log(`world-builder-layout-test: ${renders} renders (${scenes.length} scenes × ${LOOKS.length} looks × ${WIDTHS.length} widths), nothing runs past the window, the tabs, the buttons and the fields hold`);
