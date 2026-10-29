#!/usr/bin/env node
/**
 * The settings pages rendered for real: template.html with the live
 * stylesheets in a headless Chromium, every section opened, under the
 * default look and each of the five looks, at desktop width. A setting
 * row whose label is squeezed (its control taking the row: a bare
 * full-width button, a control with no wrapper) or anything wider than
 * the popup is a failure, named by its page and its label.
 *
 * Needs Playwright with Chromium (this container has it under
 * /opt/node-tools). Without it the check says so and passes: it is the
 * cloud gate's eye, not a requirement on every machine.
 *
 * Usage:  node tools/settings-layout-test.mjs [--shots]   (from the repo root)
 *         DES_TEMPLATE=<path> runs it against another template file.
 *         --shots writes a PNG per page and look into the scratch folder it prints.
 * Exit:   0 = pass or skipped, 1 = a page is wrong
 */
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const LOOKS = ['', 'arcade', 'console', 'grimoire', 'inked', 'lumen'];
const MIN_LABEL_SHARE = 0.35;    // a label group keeps at least this much of its row
const shots = process.argv.includes('--shots');

async function loadPlaywright() {
    // A package directory resolves through require, not import; the container keeps Playwright under /opt/node-tools.
    const require = createRequire(import.meta.url);
    for (const spec of ['playwright', '/opt/node-tools/node_modules/playwright']) {
        try { return require(spec); } catch (e) { /* next */ }
    }
    return null;
}

const pw = await loadPlaywright();
if (!pw) { console.log('settings-layout-test: skipped (no Playwright with Chromium on this machine)'); process.exit(0); }

const templatePath = process.env.DES_TEMPLATE ? resolve(process.env.DES_TEMPLATE) : join(repo, 'template.html');
const template = readFileSync(templatePath, 'utf8');
const out = mkdtempSync(join(process.env.TMPDIR || tmpdir(), 'des-layout-'));
const css = ['styles/modals.css', 'style.css', 'styles/overhaul.css'].map(f => `<link rel="stylesheet" href="${pathToFileURL(join(repo, f)).href}">`).join('\n');
const harness = `<!doctype html><html><head><meta charset="utf-8">${css}
<style>
  html, body { margin: 0; background: #111; }
  #rpg-settings-popup { display: flex !important; }
  /* every page opened, every folded card unfolded, so each row can be measured */
  .rpg-accordion-section.rpg-accordion-open .rpg-accordion-body { display: block !important; }
</style></head><body>${template}</body></html>`;
writeFileSync(join(out, 'harness.html'), harness);

const browser = await pw.chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
page.on('pageerror', () => {});
await page.goto(pathToFileURL(join(out, 'harness.html')).href, { waitUntil: 'load' });

const failures = [];
let rows = 0;
for (const look of LOOKS) {
    await page.evaluate((l) => { if (l) document.body.setAttribute('data-dooms-ui', l); else document.body.removeAttribute('data-dooms-ui'); }, look);
    const sections = await page.$$eval('#rpg-settings-popup .rpg-accordion-section[data-accordion]', els => els.map(e => e.dataset.accordion));
    for (const id of sections) {
        const report = await page.evaluate(({ id, minShare }) => {
            const popup = document.querySelector('#rpg-settings-popup');
            const content = popup.querySelector('.rpg-settings-popup-content');
            popup.querySelectorAll('.rpg-accordion-section').forEach(s => s.classList.toggle('rpg-accordion-open', s.dataset.accordion === id));
            const section = popup.querySelector(`.rpg-accordion-section[data-accordion="${id}"]`);
            section.querySelectorAll('details').forEach(d => { d.open = true; });
            const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && el.offsetParent !== null; };
            const problems = [];
            let count = 0;
            for (const row of section.querySelectorAll('.rpg-setting-row')) {
                if (!visible(row)) continue;
                const label = row.querySelector(':scope > .rpg-setting-label-group');
                if (!label) continue;
                const controls = Array.from(row.children).filter(c => c !== label && visible(c));
                if (!controls.length) continue;
                count++;
                const rw = row.getBoundingClientRect().width;
                const lw = label.getBoundingClientRect().width;
                const text = (label.querySelector('.rpg-setting-label') || label).textContent.replace(/\s+/g, ' ').trim().slice(0, 60);
                const cw = controls.reduce((m, c) => Math.max(m, c.getBoundingClientRect().width), 0);
                if (lw < rw * minShare) problems.push(`"${text}": the label keeps ${Math.round(lw)}px of ${Math.round(rw)}px (the control is ${Math.round(cw)}px wide)`);
            }
            // anything poking out of the popup's content box
            const cr = content.getBoundingClientRect();
            for (const el of section.querySelectorAll('*')) {
                if (!visible(el)) continue;
                const r = el.getBoundingClientRect();
                if (r.right > cr.right + 2 || r.left < cr.left - 2) {
                    const t = (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40);
                    problems.push(`<${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}> ${t ? `"${t}" ` : ''}runs past the popup (${Math.round(r.left)}..${Math.round(r.right)} of ${Math.round(cr.left)}..${Math.round(cr.right)})`);
                    break;
                }
            }
            return { count, problems };
        }, { id, minShare: MIN_LABEL_SHARE });
        rows += report.count;
        for (const p of report.problems) failures.push(`[${look || 'default'}] ${id}: ${p}`);
        if (shots) {
            mkdirSync(join(out, 'shots'), { recursive: true });
            const el = await page.$(`#rpg-settings-popup .rpg-accordion-section[data-accordion="${id}"]`);
            if (el) await el.screenshot({ path: join(out, 'shots', `${look || 'default'}-${id}.png`) }).catch(() => {});
        }
    }
}
await browser.close();

if (shots) console.log(`screenshots: ${join(out, 'shots')}`);
if (failures.length) {
    for (const f of failures) console.error(`FAIL  ${f}`);
    console.error(`\n${failures.length} layout failure(s) across ${rows} rows measured (${LOOKS.length} looks)`);
    process.exit(1);
}
console.log(`settings-layout-test: ${rows} setting rows measured under ${LOOKS.length} looks, every label keeps its width, nothing runs past the popup`);
