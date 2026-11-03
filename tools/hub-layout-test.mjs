#!/usr/bin/env node
/**
 * The Hub rendered for real (docs/hub-plan.md D129): its views
 * (src/systems/ui/hubViews.js, pure) with a fixture world in the window's
 * shell, the live stylesheets, a headless Chromium, under the default look
 * and the five looks, at desktop and phone width: the window with its
 * Scenes panel (with and without a narrator card, with one world and with
 * two), the Start sheet, the opener picker (three openers, none, busy), the
 * End sheet (ready, running, done), and the strip over a chat column. Fails
 * when anything runs past the window sideways, a button is out of its row
 * or stretched across it, a field's label is missing, a card's text spills,
 * a chip or a step is cut, or the window is not the phone's full width.
 * --shots writes a PNG per look, width and scene to the folder it prints.
 *
 * Needs Playwright with Chromium; without it the check says so and passes.
 *
 * Usage:  node tools/hub-layout-test.mjs [--shots]   (from the repo root)
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
if (!pw) { console.log('hub-layout-test: skipped (no Playwright with Chromium on this machine)'); process.exit(0); }

const M = await import(pathToFileURL(join(repo, 'src/utils/liveWorld.js')).href);
const H = await import(pathToFileURL(join(repo, 'src/utils/hub.js')).href);
const V = await import(pathToFileURL(join(repo, 'src/systems/ui/hubViews.js')).href);
const P = await import(pathToFileURL(join(repo, 'src/utils/worldPicture.js')).href);

const pack = M.normalizePack({ ...JSON.parse(readFileSync(join(repo, 'worldpacks/example.json'), 'utf8')), id: 'harbourside' }).pack;
const recap = 'Jordan asked Old Marit about the governor\'s ring; she said it sank with the Kestrel and would not say more. Captain Reyes stamped the papers and watched the door. By night the cutter had moved to the harbour mouth and the quay was empty.';
const entry = H.normalizeWorldEntry({
    card: 'Mara Vane.png',
    memory: { stores: { dooms_world: M.seedWorldState(pack) }, facts: { date: 'Day 14', time: 'morning', location: 'The Anchor, a tavern', weather: '🌧 rain over the harbour' } },
    scenes: [
        { id: 's1', title: 'The queue', status: 'ended', place: { id: 'customs-house', label: 'The customs house' }, cast: ['Captain Reyes'], startDate: 'Day 11', endDate: 'Day 11', recap },
        { id: 's2', title: 'A quiet corner in the back room of the Anchor where everything is heard', status: 'ended', place: { id: 'the-anchor', label: 'The Anchor, a tavern' }, cast: ['Old Marit', 'The governor', 'A nameless courier with a very long name indeed'], startDate: 'Day 12', endDate: 'Day 13', recap, reopened: true },
        { id: 's3', title: 'The sunken Kestrel', status: 'aside', place: { label: 'The wreck' }, cast: ['Old Marit'], startDate: 'Day 13' },
        { id: 's4', title: 'The stranger at the door', status: 'ended', place: { id: 'the-anchor', label: 'The Anchor, a tavern' }, cast: [], startDate: 'Day 13', endDate: 'Day 13', recap: '', gone: true },
        { id: 's5', title: 'Rain on the quay', status: 'open', place: { id: 'the-quay', label: 'The quay' }, cast: ['Captain Reyes', 'Old Marit'], startDate: 'Day 14' },
    ],
});
const noOpen = H.normalizeWorldEntry({ ...entry, scenes: entry.scenes.filter(s => s.status !== 'open') });    // the same world with no scene open (the Hooks panel's buttons live)
const worlds = [{ id: 'harbourside', name: 'Harbourside', card: 'Mara Vane.png', cardName: 'Mara Vane' }];
const twoWorlds = [...worlds, { id: 'skyreach', name: 'Skyreach, the long campaign of the northern crossings', card: '', cardName: '' }];
const card = { name: 'Mara Vane' };
const places = pack.places.map(p => { const chain = M.placeChain(pack, p.id); return { id: p.id, label: p.label, region: chain.length > 1 ? chain[0].label : '' }; });
const people = [...pack.cast.map(m => ({ name: m.name, tier: m.tier, here: m.place === 'the-anchor' })), { name: 'A nameless courier with a very long name indeed', tier: 'heard', here: false }, { name: 'The governor', tier: 'heard', here: false }];
const openers = [
    { title: 'The queue', text: 'The customs house is loud with the morning\'s business. Captain Reyes stamps a paper without looking up; the queue shuffles forward a step. Somewhere behind you a sailor is arguing about salt. Reyes finally lifts his eyes, and they settle on you.\n\nWhat do you do?', who: ['Captain Reyes'] },
    { title: 'A quiet corner', text: 'Rain drums on the shutters of the Anchor. Old Marit waves you to the back room without a word, and the door closes on the noise of the taproom.', who: ['Old Marit'] },
    { title: 'The stranger', text: 'A stranger blocks the door of the Anchor, hood up, one hand on the frame. Behind him Marit shakes her head at you, slow and small. The stranger has not seen it.', who: ['Old Marit'] },
];
const sheetBase = { worlds, worldId: 'harbourside', pack, entry, card, liveWorldOn: true };
// The board (D124): the picture world with its nodes and people, and the same world without a picture as a tree.
const boardState = { ...M.seedWorldState(pack), where: { 'Old Marit': 'harbourside/old-town/the-anchor/back-room', 'Captain Reyes': 'harbourside/the-docks/customs-house', 'Jordan': 'harbourside/old-town/the-anchor', 'The governor': 'harbourside/the-hill/governors-house', 'A nameless courier with a very long name indeed': 'loc:the-mill', 'Wanderer': 'loc:the-mill' }, visited: [{ id: 'the-anchor' }, { id: 'customs-house' }, { id: 'loc:the-mill', label: 'The old mill' }] };
const picPack = { ...pack, map: { image: '/user/images/des-worlds/harbourside-map.png', width: 1600, height: 1000, source: 'upload' }, places: pack.places.map(p => (p.id === 'the-anchor' ? { ...p, x: 0.2, y: 0.7 } : p.id === 'customs-house' ? { ...p, x: 0.6, y: 0.3 } : p.id === 'harbourside' ? { ...p, x: 0.5, y: 0.5 } : p)) };
const boardPicture = { mode: 'picture', model: P.boardModel({ pack: picPack, state: boardState, player: 'Jordan' }), tree: null };
const boardTree = { mode: 'tree', model: null, tree: P.treeModel({ pack, state: boardState, player: 'Jordan' }) };
const world = { state: boardState, pack: picPack, cfg: M.liveWorldConfig(null) };
const hooksFixture = { proposed: [{ id: 'h2', title: 'The cutter\'s papers', text: 'Get a look at the cutter\'s manifest at the customs house before Reyes files it.', grounds: 'the blockade', kind: 'clock' }, { id: 'h3', title: 'Marit\'s errand', text: 'Carry Old Marit\'s message to the governor\'s house by dusk, past the watch on the hill road.', grounds: 'Old Marit', kind: 'person' }], taken: [{ id: 'h1', title: 'An errand for Marit' }], aside: [], last: { ok: false, error: 'the line was busy' } };
const placeSheet = { kind: 'place', id: 'the-anchor', label: 'The Anchor, a tavern', region: 'Harbourside', picture: '', people: ['Old Marit', 'A nameless courier with a very long name indeed'], player: true, rumours: ['A navy cutter sits at the harbour mouth and every hold is searched; the Anchor is full of sailors with nowhere to sail.'], scenes: [{ id: 's2', title: 'A quiet corner in the back room of the Anchor where everything is heard', status: 'ended', startDate: 'Day 12', endDate: 'Day 13' }, { id: 's5', title: 'Rain on the quay', status: 'open', startDate: 'Day 14' }], canStart: true };
const scenes = [
    { name: 'hub', html: V.hubHtml({ ...sheetBase, note: '', board: boardTree }) },
    { name: 'board', html: V.hubHtml({ ...sheetBase, pack: picPack, note: '', board: boardPicture, panel: 'scenes' }) },
    { name: 'board-map', html: V.hubHtml({ ...sheetBase, pack: picPack, note: '', board: boardPicture, panel: 'map' }) },
    { name: 'board-tree-map', html: V.hubHtml({ ...sheetBase, note: '', board: boardTree, panel: 'map' }) },
    { name: 'board-news', html: V.hubHtml({ ...sheetBase, pack: picPack, board: boardPicture, panel: 'news', world }) },
    { name: 'board-rumours', html: V.hubHtml({ ...sheetBase, pack: picPack, board: boardPicture, panel: 'rumours', world }) },
    { name: 'board-hooks', html: V.hubHtml({ ...sheetBase, entry: noOpen, pack: picPack, board: boardPicture, panel: 'hooks', world, hooks: hooksFixture }) },
    { name: 'board-hooks-open', html: V.hubHtml({ ...sheetBase, pack: picPack, board: boardPicture, panel: 'hooks', world, hooks: hooksFixture }) },    // a scene open: Offer and Not this one held, the reason said
    { name: 'board-hooks-busy', html: V.hubHtml({ ...sheetBase, entry: noOpen, pack: picPack, board: boardPicture, panel: 'hooks', world, hooks: { proposed: [], taken: [], aside: [], last: null }, hooksBusy: true }) },
    { name: 'board-tree-broken', html: V.hubHtml({ ...sheetBase, pack: picPack, note: '', board: { ...boardTree, broken: true } }) },    // the picture would not load: the tree with the note
    { name: 'board-people', html: V.hubHtml({ ...sheetBase, board: boardTree, panel: 'people', world: { ...world, pack } }) },
    { name: 'place', html: V.hubHtml({ ...sheetBase, sheet: placeSheet }) },
    { name: 'place-bare', html: V.hubHtml({ ...sheetBase, sheet: { kind: 'place', id: 'loc:the-mill', label: 'The old mill', region: '', picture: '', people: [], player: false, rumours: [], scenes: [], canStart: false } }) },
    { name: 'hub-two-worlds', html: V.hubHtml({ ...sheetBase, worlds: twoWorlds, note: 'Scene 5 is open at The quay.', board: boardTree }) },
    { name: 'hub-nocard', html: V.hubHtml({ ...sheetBase, card: null, entry: H.normalizeWorldEntry({ card: '' }) }) },
    { name: 'hub-empty', html: V.hubHtml({ ...sheetBase, entry: H.normalizeWorldEntry({ card: 'Mara Vane.png' }) }) },
    { name: 'start', html: V.hubHtml({ ...sheetBase, sheet: { kind: 'start', places, people, place: { id: 'the-anchor', label: 'The Anchor, a tavern' }, cast: ['Old Marit'], gap: H.gapOf('later'), seedText: 'A rumour: the cutter will search every hold tonight, they say on the quay.', note: 'find the ring', error: '' } }) },
    { name: 'start-error', html: V.hubHtml({ ...sheetBase, sheet: { kind: 'start', places, people, place: null, cast: [], gap: H.gapOf('when', 'the next full moon'), seedText: '', note: '', error: 'The narrator wrote no usable opener; write your own, ask again, or start without one.', busy: false } }) },
    { name: 'picker', html: V.hubHtml({ ...sheetBase, sheet: { kind: 'picker', pending: { place: { label: 'The Anchor, a tavern' }, openers, errors: [], notes: ['The world did not move for the gap (busy).'] }, busy: false, error: '', sceneNo: 6 } }) },
    { name: 'picker-empty', html: V.hubHtml({ ...sheetBase, sheet: { kind: 'picker', pending: { place: { label: 'The quay' }, openers: [], errors: ['The reply carries no openers.'], notes: [] }, busy: false, error: '', sceneNo: 6 } }) },
    { name: 'picker-busy', html: V.hubHtml({ ...sheetBase, sheet: { kind: 'picker', pending: { place: { label: 'The quay' }, openers, errors: [], notes: [] }, busy: true, error: '', sceneNo: 6 } }) },
    { name: 'end', html: V.hubHtml({ ...sheetBase, sheet: { kind: 'end', prep: { recap, error: '', from: 'Day 14', to: 'Day 14, night', steps: { canon: true, world: true }, scene: { id: 's5', title: 'Rain on the quay' } }, busy: false, states: {}, result: null, error: '' } }) },
    { name: 'end-stale', html: V.hubHtml({ ...sheetBase, sheet: { kind: 'end', prep: { recap, error: '', from: 'Day 13', to: 'Day 14', stale: true, canonDone: true, steps: { canon: false, world: true }, scene: { id: 's3', title: 'The sunken Kestrel' } }, busy: false, states: {}, result: null, error: '' } }) },
    { name: 'end-running', html: V.hubHtml({ ...sheetBase, sheet: { kind: 'end', prep: { recap, error: '', from: 'Day 14', to: 'Day 14, night', steps: { canon: true, world: false }, scene: { id: 's5', title: 'Rain on the quay' } }, busy: false, states: { recap: 'ok', canon: 'ok', world: 'off', snapshot: 'running' }, result: null, error: '' } }) },
    { name: 'end-done', html: V.hubHtml({ ...sheetBase, sheet: { kind: 'end', prep: { recap, error: 'network down', from: 'Day 14', to: 'Day 14, night', steps: { canon: true, world: true }, scene: { id: 's5', title: 'Rain on the quay' } }, busy: false, states: { recap: 'ok', canon: 'failed', world: 'ok', snapshot: 'ok' }, result: { ok: true }, error: '' } }) },
];
const stripOpen = V.stripHtml({ mark: { scene: 's5', title: 'Rain on the quay', place: { label: 'The quay' }, startDate: 'Day 14, morning' }, ended: false });
const stripEnded = V.stripHtml({ mark: { scene: 's2', title: 'A quiet corner in the back room of the Anchor where everything is heard', place: { label: 'The Anchor, a tavern' }, startDate: 'Day 12', endDate: 'Day 13' }, ended: true });

const css = ['styles/modals.css', 'style.css', 'styles/overhaul.css'].map(f => `<link rel="stylesheet" href="${pathToFileURL(join(repo, f)).href}">`).join('\n');
const out = mkdtempSync(join(process.env.TMPDIR || tmpdir(), 'des-hub-'));
const column = (strip) => `<div id="sheld" style="width: 100%; max-width: 900px; margin: 0 auto; height: 100vh; display: flex; flex-direction: column; padding: 8px; box-sizing: border-box;"><div id="dooms-scene-strip" class="dooms-scene-strip">${strip}</div><div id="chat" style="flex: 1 1 auto; overflow: auto; color: #ccc; font-size: 0.9em;">${'<div style="padding:10px;border-bottom:1px solid #333;">A message of the scene, with a line or two of narration under the strip.</div>'.repeat(4)}</div></div>`;
const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">${css}<style>html, body { margin: 0; background: #111; } #${V.POPUP_ID} { display: flex !important; } #${V.POPUP_ID} .rpg-settings-popup-content { animation: none !important; transition: none !important; } #${V.POPUP_ID}.is-hidden { display: none !important; } #strip-stage { display: none; } #strip-stage.is-shown { display: block; }</style></head><body>${V.hubShellHtml()}<div id="strip-stage"></div></body></html>`;
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
    const phone = w.name === 'phone';
    for (const look of LOOKS) {
        await page.evaluate((l) => { if (l) document.body.setAttribute('data-dooms-ui', l); else document.body.removeAttribute('data-dooms-ui'); }, look);
        for (const scene of scenes) {
            await page.evaluate(({ id, inner }) => { document.getElementById(id).classList.remove('is-hidden'); document.getElementById('strip-stage').classList.remove('is-shown'); document.querySelector(`#${id} .dooms-hub-body`).innerHTML = inner; }, { id: V.POPUP_ID, inner: scene.html });
            const report = await page.evaluate(({ id, phone, vw }) => {
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
                if (phone && cb.width < vw - 2) faults.push(`the window is not the phone's full width (${Math.round(cb.width)} of ${vw})`);
                if (phone && (cb.top > 1 || cb.bottom < window.innerHeight - 1)) faults.push(`the window does not span the phone's screen (${Math.round(cb.top)}..${Math.round(cb.bottom)} of ${window.innerHeight})`);
                popup.querySelectorAll('.dooms-hub-sheet, .dooms-hub-main, .dooms-hub-head, .dooms-hub-foot').forEach(el => { if (el.scrollWidth > el.clientWidth + 1) faults.push(`"${el.className}" scrolls sideways (${el.scrollWidth} > ${el.clientWidth})`); });
                if (!phone && cb.width < 1000) faults.push(`the window is only ${Math.round(cb.width)}px wide on the desktop`);
                const title = popup.querySelector('.dooms-hub-title');
                if (title && title.getBoundingClientRect().height === 0) faults.push('the world\'s name is not shown');
                popup.querySelectorAll('.rpg-accordion-action-btn, .rpg-accordion-select').forEach(el => {
                    const text = (el.textContent || el.value || '').trim().slice(0, 24) || el.tagName.toLowerCase();
                    inside(el, `the control "${text}"`);
                    const row = el.closest('.dooms-hub-head-actions, .dooms-hub-foot, .dooms-hub-sheet-actions, .dooms-hub-card-actions, .dooms-hub-scene-actions');
                    if (row && el.classList.contains('rpg-accordion-action-btn')) {
                        const share = phone ? 0.9 : (el.closest('.dooms-hub-side') ? 0.85 : 0.6);    // the side column beside the board is a third of the window
                        const r = el.getBoundingClientRect(); const rr = row.getBoundingClientRect();
                        if (r.width === 0 && r.height === 0) return;    // in a panel the phone's other tab hides
                        if (rr.width > 0 && r.width > rr.width * share) faults.push(`the button "${text}" takes ${Math.round(r.width / rr.width * 100)}% of its row`);
                        if (r.height < 26) faults.push(`the button "${text}" is only ${Math.round(r.height)}px tall`);
                    }
                });
                popup.querySelectorAll('.dooms-hub-chip, .dooms-hub-scene, .dooms-hub-card, .dooms-hub-step, .dooms-hub-field .rpg-accordion-input, .dooms-hub-field textarea').forEach(el => inside(el, `the element "${(el.textContent || el.placeholder || '').trim().slice(0, 24)}"`));
                popup.querySelectorAll('.dooms-hub-field > label, .dooms-hub-field-label').forEach(el => { if (el.getBoundingClientRect().height === 0) faults.push(`the field label "${el.textContent.trim().slice(0, 24)}" is not shown`); });
                popup.querySelectorAll('.dooms-hub-card').forEach(el => { if (el.scrollWidth > el.clientWidth + 1) faults.push(`an opener's card spills sideways (${el.scrollWidth} > ${el.clientWidth})`); });
                popup.querySelectorAll('.dooms-hub-scene-title').forEach(el => { const r = el.getBoundingClientRect(); if (r.height > 80) faults.push(`a scene's title wraps to ${Math.round(r.height)}px`); });
                const foot = popup.querySelector('.dooms-hub-foot');
                if (foot && foot.getBoundingClientRect().bottom > cb.bottom + 1) faults.push('the foot is below the window');
                // The board (D124): the picture's frame or the tree beside the panels on the desktop; one at a time under tabs on a phone.
                const main = popup.querySelector('.dooms-hub-main.is-board');
                if (main) {
                    const frame = main.querySelector('.dooms-hub-map');
                    const tree = main.querySelector('.dooms-tree');
                    const side = main.querySelector('.dooms-hub-side');
                    const tabs = main.querySelector('.dooms-hub-tabs');
                    const shown = (el) => el && el.getBoundingClientRect().height > 0;
                    const onMap = main.getAttribute('data-panel') === 'map';
                    const sideNav = main.querySelector('.dooms-hub-side-nav');
                    const sideBody = main.querySelector('.dooms-hub-side-body');
                    if (phone) {
                        if (!shown(tabs)) faults.push('the phone has no tabs over the board');
                        main.querySelectorAll('.dooms-hub-tab').forEach(el => { const r = el.getBoundingClientRect(); if (r.height > 0 && r.height < 44) faults.push(`the tab "${el.textContent.trim()}" is ${Math.round(r.height)}px tall (44 is the touch target, §4.2)`); });
                        const wrap = main.querySelector('.dooms-hub-board-wrap');
                        const notes = main.querySelector('.dooms-hub-board-notes');
                        if (onMap && wrap && notes && shown(notes) && notes.getBoundingClientRect().bottom > wrap.getBoundingClientRect().bottom + 1 && !(wrap.scrollHeight > wrap.clientHeight + 1)) faults.push('the notes under the map sit under the foot and cannot be scrolled to');
                        if (shown(sideNav)) faults.push('the phone shows the side nav as well as the tabs');
                        if (!onMap && !shown(sideBody)) faults.push('the panel tab shows no panel');
                        if (onMap && shown(side)) faults.push('the Map tab shows the panels too');
                        if (!onMap && (shown(frame) || shown(tree))) faults.push('the Scenes tab shows the board too');
                        if (onMap && frame && frame.getBoundingClientRect().height < window.innerHeight * 0.4) faults.push(`the map is only ${Math.round(frame.getBoundingClientRect().height)}px tall on the phone`);
                    } else {
                        if (shown(tabs)) faults.push('the desktop shows the phone\'s tabs');
                        if (!shown(side)) faults.push('the panels are not shown beside the board');
                        if (!shown(sideNav)) faults.push('the side has no nav');
                        if (sideBody && sideBody.scrollWidth > sideBody.clientWidth + 1) faults.push(`the panel scrolls sideways (${sideBody.scrollWidth} > ${sideBody.clientWidth})`);
                        main.querySelectorAll('.dooms-hub-side-tab').forEach(el => inside(el, `the side tab "${el.textContent.trim()}"`));
                        if (frame && frame.getBoundingClientRect().height < 240) faults.push(`the map frame is ${Math.round(frame.getBoundingClientRect().height)}px tall`);
                        if (frame && side && frame.getBoundingClientRect().right > side.getBoundingClientRect().left) faults.push('the map frame overlaps the panels');
                    }
                    if (shown(frame)) inside(frame, 'the map frame');
                    main.querySelectorAll('.dooms-tree-place').forEach(el => { if (shown(el)) { inside(el, `the place "${el.getAttribute('title').slice(0, 20)}"`); const r = el.getBoundingClientRect(); if (r.height < 60) faults.push(`the place "${el.getAttribute('title').slice(0, 20)}" is ${Math.round(r.height)}px tall`); } });
                    main.querySelectorAll('.dooms-tree-group').forEach(el => { if (el.scrollWidth > el.clientWidth + 1) faults.push('a tree group scrolls sideways'); });
                }
                const place = popup.querySelector('.dooms-hub-sheet-place');
                if (place) {
                    const pic = place.querySelector('.dooms-hub-place-pic');
                    if (pic) inside(pic, 'the place\'s picture');
                    place.querySelectorAll('.dooms-hub-place-people li, .dooms-hub-place-rumours li, .dooms-hub-place-scenes li').forEach(el => inside(el, 'a line of the place sheet'));
                }
                return faults;
            }, { id: V.POPUP_ID, phone, vw: w.width });
            renders++;
            for (const f of report) failures.push(`${w.name}/${look || 'default'}/${scene.name}: ${f}`);
            if (shots) await page.screenshot({ path: join(out, 'shots', `${w.name}-${look || 'default'}-${scene.name}.png`), fullPage: false });
        }
        for (const [name, strip] of [['strip-open', stripOpen], ['strip-ended', stripEnded]]) {
            await page.evaluate(({ id, inner }) => { document.getElementById(id).classList.add('is-hidden'); const stage = document.getElementById('strip-stage'); stage.innerHTML = inner; stage.classList.add('is-shown'); }, { id: V.POPUP_ID, inner: column(strip) });
            const report = await page.evaluate(({ phone }) => {
                const faults = [];
                const sheld = document.getElementById('sheld');
                const sb = sheld.getBoundingClientRect();
                const strip = document.getElementById('dooms-scene-strip');
                const r = strip.getBoundingClientRect();
                if (r.left < sb.left - 1 || r.right > sb.right + 1) faults.push('the strip runs past the chat column');
                if (r.height > (phone ? 120 : 60)) faults.push(`the strip is ${Math.round(r.height)}px tall`);
                strip.querySelectorAll('.rpg-accordion-action-btn').forEach(el => { const b = el.getBoundingClientRect(); if (b.left < sb.left - 1 || b.right > sb.right + 1) faults.push(`the strip's button "${el.textContent.trim()}" runs past the column`); if (b.height < 24) faults.push(`the strip's button "${el.textContent.trim()}" is only ${Math.round(b.height)}px tall`); });
                const text = strip.querySelector('.dooms-strip-text span');
                if (text && text.getBoundingClientRect().width < 60) faults.push('the strip\'s text is squeezed');
                return faults;
            }, { phone });
            renders++;
            for (const f of report) failures.push(`${w.name}/${look || 'default'}/${name}: ${f}`);
            if (shots) await page.screenshot({ path: join(out, 'shots', `${w.name}-${look || 'default'}-${name}.png`), fullPage: false });
        }
    }
}
await browser.close();

if (failures.length) {
    console.error(`hub-layout-test: ${failures.length} fault(s) in ${renders} renders`);
    for (const f of failures) console.error(`  ${f}`);
    if (shots) console.error(`shots: ${join(out, 'shots')}`);
    process.exit(1);
}
console.log(`hub-layout-test: ${renders} renders clean${shots ? `; shots in ${join(out, 'shots')}` : ''}`);
