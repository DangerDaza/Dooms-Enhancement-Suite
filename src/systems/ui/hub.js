/**
 * The Hub window (docs/hub-plan.md D116, D117, D119, D122, D127): the
 * world's window on the settings popup's shell, most of the screen; the
 * head with Start a scene, the Scenes panel (the board and the other
 * panels come with phase 2), the foot; the Start sheet, the opener picker
 * and the End sheet in its body. Opened from Hub in the D menu, Settings →
 * Live World → The Hub, /hub, the strip and the Map window's foot. Loaded
 * on first open. The pure rendering is hubViews.js; the lifecycle is
 * src/systems/features/hub.js.
 */
import { extensionSettings } from '../../core/state.js';
import { ensureCss } from '../../core/cssLoader.js';
import { normalizeWorldState, placePath, placeChain, isLocId, locLabel, sameName, seedWorldState, publicEffects, liveWorldConfig } from '../../utils/liveWorld.js';
import { describeHooksResult } from '../../utils/questHooks.js';
import { pushWindow, popWindow, isTopmost } from './windowStack.js';
import { boardModel, treeModel, hasMap, mapSize } from '../../utils/worldPicture.js';
import { safeImageUrl } from '../../utils/worldBoard.js';
import { resolvePortrait } from './portraitBar.js';
import { gapOf, describeStartResult, describeEndResult, hubConfig } from '../../utils/hub.js';
import { isLiveWorldOn, loadPack } from '../features/liveWorld.js';
import {
    HUB_CHANGED_EVENT, isHubOn, hubWorldIds, worldEntry, cardOf, currentScene, prepareScene, pendingStart, askOpenersAgain, cancelStart, commitScene,
    prepareEnd, commitEnd, setSceneAside, resumeScene, openSceneChat, refreshScenes, removeGoneScene,
    hubHooks, isHooksBusy, proposeHubHooks, setHubHookAside,
} from '../features/hub.js';
import { openSettingsPopup } from './modals.js';
import { POPUP_ID, HUB_PANELS, hubShellHtml, hubHtml } from './hubViews.js';

let built = false;
let isOpen = false;
let worldId = '';
let worlds = [];
let pack = null;
let sheet = null;       // { kind: 'start' | 'picker' | 'end' | 'place', ... }
let note = '';
let panel = '';         // the side panel (HUB_PANELS), or 'map' for the phone's board; chosen on the first open
let board = null;       // the board (Leaflet's host) while the picture shows
let boardView = null;   // its view, kept across re-renders
let boardToken = 0;     // a mount that outlives its render is dropped
const sizeCache = new Map();    // world id -> the picture's size read from the image when the pack does not carry it

function $body() {
    return $(`#${POPUP_ID} .dooms-hub-body`);
}

/** The worlds the hub can play, with their names and cards. */
async function loadWorlds() {
    const out = [];
    for (const id of hubWorldIds()) {
        const r = await loadPack(id);
        const card = cardOf(id);
        out.push({ id, name: r.ok ? r.pack.name : id, card: card ? card.avatar : '', cardName: card ? card.name : '' });
    }
    worlds = out;
}

async function refresh() {
    await loadWorlds();
    if (!worldId || !worlds.some(w => w.id === worldId)) {
        const cur = currentScene();
        worldId = (cur && worlds.some(w => w.id === cur.worldId) ? cur.worldId : '') || (worlds.find(w => w.card) || worlds[0] || { id: '' }).id;
    }
    const r = worldId ? await loadPack(worldId) : { ok: false, pack: null };
    pack = r.ok ? r.pack : null;
}

function render() {
    const $b = $body();
    if (!$b.length) return;
    unmountHubBoard();
    const entry = worldId ? worldEntry(worldId) : null;
    const card = worldId ? cardOf(worldId) : null;
    const on = isLiveWorldOn() && isHubOn();
    const data = !sheet && pack && card && on ? boardFor(entry) : null;
    const world = pack ? { state: worldStateFor(entry), pack, cfg: liveWorldConfig(extensionSettings) } : null;
    $b.html(hubHtml({ worlds, worldId, pack, entry, card, sheet, note, liveWorldOn: on, board: data, panel, portraits: portraitOf, world, hooks: worldId ? hubHooks(worldId) : null, hooksBusy: worldId ? isHooksBusy(worldId) : false }));
    if (data && data.mode === 'picture') mountHubBoard(data);
}

// ─── The board (D124) ───────────────────────────────────────────────────

function portraitOf(name) {
    try { return resolvePortrait(name) || ''; } catch (e) { return ''; }
}

/** The player's name: the one the memory was taken under, else the persona in front. */
function playerName(entry) {
    if (entry && entry.memory && entry.memory.player) return entry.memory.player;
    try { const ctx = window.SillyTavern && window.SillyTavern.getContext ? window.SillyTavern.getContext() : null; return ctx && ctx.name1 ? String(ctx.name1) : ''; } catch (e) { return ''; }
}

/** The world state the board shows: the memory's, or the pack's fresh seed while no scene has ended. */
function worldStateFor(entry) {
    const stored = entry && entry.memory && entry.memory.stores && entry.memory.stores.dooms_world ? normalizeWorldState(entry.memory.stores.dooms_world) : null;
    return stored || (pack ? seedWorldState(pack, { name: '' }) : null);
}

function boardFor(entry) {
    if (!pack) return null;
    const state = worldStateFor(entry);
    const player = playerName(entry);
    return hasMap(pack)
        ? { mode: 'picture', model: boardModel({ pack, state, player }), tree: null }
        : { mode: 'tree', model: null, tree: treeModel({ pack, state, player }) };
}

function unmountHubBoard() {
    if (!board) return;
    try { boardView = board.view(); board.destroy(); } catch (e) { /* the frame is gone already */ }
    board = null;
}

function readImageSize(url) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
        img.onerror = () => reject(new Error('the picture could not be read'));
        img.src = url;
    });
}

/** Leaflet over the world's picture in the hub's frame, the nodes a way to their sheets. */
async function mountHubBoard(data) {
    const host = document.querySelector(`#${POPUP_ID} .dooms-hub-map`);
    if (!host || !pack || !hasMap(pack)) return;
    const token = ++boardToken;
    const id = worldId;
    let size = mapSize(pack) || sizeCache.get(id) || null;
    if (!size) {
        try { size = await readImageSize(safeImageUrl(pack.map.image)); sizeCache.set(id, size); } catch (e) { host.innerHTML = '<p class="dooms-hub-map-wait dooms-hub-hint">The picture could not be read. The World Builder\'s Map tab can upload it again.</p>'; return; }
    }
    let mod;
    try {
        mod = await import('./hubBoard.js');
        await ensureCss('leaflet', mod.LEAFLET_CSS);
    } catch (e) { host.innerHTML = `<p class="dooms-hub-map-wait dooms-hub-hint">The map could not load: ${e && e.message ? e.message : e}</p>`; return; }
    if (token !== boardToken || !isOpen || sheet || worldId !== id || !document.body.contains(host)) return;
    host.innerHTML = '';
    board = await mod.mountBoard(host, {
        picture: { ...pack.map, ...size },
        nodes: data.model.nodes,
        mode: 'hub',
        portraits: portraitOf,
        view: boardView,
        on: { node: (placeId) => openPlace(placeId) },
    });
    if (token !== boardToken || !document.body.contains(host)) { try { board.destroy(); } catch (e) { /* gone */ } board = null; return; }
    boardView = null;
}

/** The place sheet's data: the place, its region, its picture, who is here, what names it, the scenes played there. */
function placeSheetData(id) {
    const entry = worldEntry(worldId);
    const state = worldStateFor(entry);
    const place = pack ? pack.places.find(x => x.id === id) : null;
    const tree = pack ? treeModel({ pack, state, player: playerName(entry) }) : { groups: [], elsewhere: [] };
    const node = [...tree.groups.flatMap(g => g.places), ...tree.elsewhere].find(x => x.id === id) || null;
    const label = place ? place.label : (node ? node.label : (isLocId(id) ? locLabel(id) : id));
    const chain = place ? placeChain(pack, id) : [];
    const region = chain.length > 1 ? chain[0].label : '';
    const low = String(label || '').toLowerCase();
    const rumours = pack && state ? publicEffects(state, pack).filter(x => String(x.text || '').toLowerCase().includes(low) || (pack.clocks.find(c => c.id === x.id) || {}).place === id).map(x => x.text) : [];
    const scenes = entry ? entry.scenes.filter(s => s.place && (s.place.id === id || (!s.place.id && label && sameName(s.place.label, label)))).map(s => ({ id: s.id, title: s.title, status: s.status, startDate: s.startDate, endDate: s.endDate })) : [];
    const card = cardOf(worldId);
    return { kind: 'place', id, label, region, picture: place ? place.image : '', people: node ? node.people : [], player: !!(node && node.player), rumours, scenes, canStart: !!card && isLiveWorldOn() };
}

function openPlace(id) {
    if (!id) return;
    sheet = placeSheetData(id);
    render();
}

/** A person as a way in (§4.1): the Start sheet with them, at the place they were last seen. */
function startWithPerson(name) {
    const entry = worldEntry(worldId);
    const state = worldStateFor(entry);
    const at = state && state.where ? String(state.where[name] || '') : '';
    let place = null;
    if (at && pack) {
        const ids = new Set(pack.places.map(p => p.id));
        const parts = at.split('/');
        for (let i = parts.length - 1; i >= 0 && !place; i--) if (ids.has(parts[i])) { const p = pack.places.find(x => x.id === parts[i]); place = { id: p.id, label: p.label }; }
        if (!place && isLocId(at)) place = { label: locLabel(at) };
    }
    openStart({ seed: { kind: 'person', label: name, text: '' }, place, cast: [name] });
}

// ─── The Start sheet ────────────────────────────────────────────────────

/** The places the sheet offers: the pack's, then the story's own from the snapshot. */
function placesForSheet(entry) {
    const out = [];
    if (pack) for (const p of pack.places) { const chain = placeChain(pack, p.id); const root = chain.length > 1 ? chain[0] : null; out.push({ id: p.id, label: p.label, region: root && !sameName(root.label, p.label) ? root.label : '' }); }
    const state = entry && entry.memory && entry.memory.stores && entry.memory.stores.dooms_world ? normalizeWorldState(entry.memory.stores.dooms_world) : null;
    if (state) for (const v of state.visited) if (isLocId(v.id) && !out.some(o => o.id === v.id)) out.push({ id: v.id, label: v.label || locLabel(v.id), region: '' });
    return out;
}

/** The people the sheet offers: the snapshot's known people, those last seen at the place marked. */
function peopleForSheet(entry, placeId) {
    const state = entry && entry.memory && entry.memory.stores && entry.memory.stores.dooms_world ? normalizeWorldState(entry.memory.stores.dooms_world) : null;
    const names = new Set();
    const out = [];
    if (state) {
        for (const [name, tier] of Object.entries(state.known)) { if (names.has(name)) continue; names.add(name); const at = state.where[name] || ''; out.push({ name, tier, here: !!(placeId && at && (at === placeId || at.endsWith(`> ${placeId}`) || (pack && placePath(pack, placeId) === at))) }); }
    } else if (pack) {
        for (const m of pack.cast) { if (names.has(m.name)) continue; names.add(m.name); out.push({ name: m.name, tier: m.tier, here: !!(placeId && m.place === placeId) }); }
    }
    out.sort((a, b) => Number(b.here) - Number(a.here) || a.name.localeCompare(b.name));
    return out;
}

function openStart({ seed = null, place = null, cast = [], gap = null, note: n = '', error = '' } = {}) {
    const entry = worldEntry(worldId);
    const placeId = place && place.id ? place.id : '';
    const people = peopleForSheet(entry, placeId);
    const picked = cast.length ? cast : people.filter(p => p.here).map(p => p.name);
    sheet = { kind: 'start', places: placesForSheet(entry), people, place, cast: picked, gap: gap || gapOf(hubConfig(extensionSettings).gap), seedText: seed && typeof seed === 'object' ? (seed.text || '') : String(seed || ''), seed, note: n, error, busy: false };
    render();
}

function readStart() {
    const root = `#${POPUP_ID}`;
    const whereSel = String($(`${root} #dooms-hub-where`).val() || '');
    const whereNew = String($(`${root} #dooms-hub-where-new`).val() || '').trim();
    let place = null;
    if (whereSel && whereSel !== '__new__') { const p = (sheet.places || []).find(x => x.id === whereSel); place = p ? { id: p.id, label: p.label } : { id: whereSel }; }
    else if (whereNew) place = { label: whereNew };
    const cast = [];
    $(`${root} input[name="dooms-hub-cast"]:checked`).each(function () { cast.push(String($(this).val() || '')); });
    for (const n of String($(`${root} #dooms-hub-who-new`).val() || '').split(',')) { const t = n.trim(); if (t && !cast.some(c => sameName(c, t))) cast.push(t); }
    const gapId = String($(`${root} input[name="dooms-hub-gap"]:checked`).val() || 'now');
    const gap = gapOf(gapId, String($(`${root} #dooms-hub-when`).val() || ''));
    const seedText = String($(`${root} #dooms-hub-seed`).val() || '').trim();
    const seed = sheet.seed && typeof sheet.seed === 'object' && sheet.seed.text === seedText ? sheet.seed : { kind: sheet.seed && sheet.seed.kind ? sheet.seed.kind : 'anywhere', text: seedText, label: sheet.seed && sheet.seed.label ? sheet.seed.label : '' };
    const n = String($(`${root} #dooms-hub-note`).val() || '').trim();
    return { place, cast, gap, seed, note: n };
}

async function startGo() {
    const args = readStart();
    const entry = worldEntry(worldId);
    const nextNo = entry ? entry.seq + 1 : 1;
    sheet = { ...sheet, busy: true, error: '' };
    render();
    const p = await prepareScene({ worldId, ...args });
    if (!isOpen) return;
    if (!p.ok) { openStart({ ...args, error: describeStartResult(p) }); return; }
    sheet = { kind: 'picker', pending: p, busy: false, error: '', sceneNo: nextNo, args };
    render();
}

async function pick(choice, ownText = '') {
    const pending = pendingStart();
    if (!sheet || sheet.kind !== 'picker' || !pending) { sheet = null; render(); return; }
    sheet = { ...sheet, busy: true, error: '' };
    render();
    const r = await commitScene(pending.token, { choice, ownText });
    if (!isOpen) return;
    if (!r.ok) { sheet = { ...sheet, busy: false, error: describeStartResult(r) }; render(); return; }
    note = describeStartResult(r);
    sheet = null;
    if (hubConfig(extensionSettings).closeOnStart) closeHub();
    else { await refresh(); render(); }
}

async function askAgain() {
    const pending = pendingStart();
    if (!sheet || sheet.kind !== 'picker' || !pending) return;
    sheet = { ...sheet, busy: true, error: '' };
    render();
    const r = await askOpenersAgain(pending.token);
    if (!isOpen || !sheet || sheet.kind !== 'picker') return;
    sheet = { ...sheet, busy: false, pending: pendingStart() || sheet.pending, error: r.ok ? '' : (r.errors ? r.errors.join(' ') : describeStartResult(r)) };
    render();
}

// ─── The End sheet ──────────────────────────────────────────────────────

async function openEnd() {
    sheet = { kind: 'end', prep: null, busy: true, states: {}, result: null, error: '' };
    render();
    const p = await prepareEnd();
    if (!isOpen || !sheet || sheet.kind !== 'end') return;
    if (!p.ok) { sheet = { ...sheet, busy: false, error: describeEndResult(p) }; render(); return; }
    sheet = { ...sheet, prep: p, busy: false };
    render();
}

async function endGo() {
    if (!sheet || sheet.kind !== 'end' || !sheet.prep) return;
    const root = `#${POPUP_ID}`;
    const recap = String($(`${root} #dooms-hub-recap`).val() || '').trim();
    const skipCanon = $(`${root} #dooms-hub-skip-canon`).prop('checked') === true;
    const skipWorld = $(`${root} #dooms-hub-skip-world`).prop('checked') === true;
    const replaceMemory = $(`${root} #dooms-hub-replace`).prop('checked') === true;
    const keep = !!sheet.prep.stale && !replaceMemory;
    const states = { recap: recap ? 'ok' : 'skipped', canon: sheet.prep.steps.canon ? (skipCanon ? 'skipped' : 'waiting') : 'off', world: sheet.prep.steps.world ? (keep ? 'kept' : skipWorld ? 'skipped' : 'waiting') : 'off', snapshot: keep ? 'kept' : 'waiting' };
    sheet = { ...sheet, prep: { ...sheet.prep, recap }, states, error: '' };
    render();
    const onStep = (name, state) => { if (sheet && sheet.kind === 'end') { sheet = { ...sheet, states: { ...sheet.states, [name]: state } }; render(); } };
    const r = await commitEnd({ recap, skipRecap: !recap, skipCanon, skipWorld, replaceMemory, onStep });
    if (!isOpen || !sheet || sheet.kind !== 'end') return;
    if (!r.ok) { sheet = { ...sheet, states: { ...sheet.states, snapshot: 'failed' }, error: describeEndResult(r) }; render(); return; }
    sheet = { ...sheet, result: r, states: { ...sheet.states, canon: r.canon === 'ok' ? 'ok' : r.canon === 'failed' ? 'failed' : sheet.states.canon, world: ['ok', 'failed', 'kept', 'skipped'].includes(r.world) ? r.world : sheet.states.world, snapshot: r.snapshot === 'kept' ? 'kept' : 'ok' } };
    note = describeEndResult(r);
    render();
}

// ─── The window ─────────────────────────────────────────────────────────

function build() {
    if (built) return;
    built = true;
    $('body').append(hubShellHtml());
    const root = `#${POPUP_ID}`;
    $(document).on('click', '#dooms-hub-close', closeHub);
    $(document).on('click', root, (ev) => { if (ev.target && ev.target.id === POPUP_ID) closeHub(); });
    $(document).on('keydown', (ev) => {
        if (ev.key !== 'Escape' || !isOpen || !isTopmost('hub')) return;
        // A sheet on top closes first; the hub under it stays (one topmost thing at a time).
        if (sheet) { if (sheet.busy || (sheet.states && Object.values(sheet.states).includes('running'))) return; if (sheet.kind === 'picker') cancelStart(); sheet = null; render(); return; }
        closeHub();
    });
    $(document).on('change', `${root} .dooms-hub-world`, async function () {
        worldId = String($(this).val() || '');
        sheet = null;
        note = '';
        boardView = null;
        await refresh();
        render();
    });
    $(document).on('change', `${root} input[name="dooms-hub-cast"], ${root} input[name="dooms-hub-gap"]`, function () {
        const label = this.closest('label');
        if (!label) return;
        if (this.type === 'radio') $(`${root} .dooms-hub-gap`).removeClass('is-on');
        $(label).toggleClass('is-on', this.checked);
    });
    $(document).on('click', `${root} [data-act]`, async function (ev) {
        const act = this.getAttribute('data-act');
        const id = this.getAttribute('data-id') || '';
        try {
            if (act === 'settings') { closeHub(); try { openSettingsPopup(); } catch (e) { /* the settings popup is not mounted yet */ } return; }
            if (act === 'panel') { const p = this.getAttribute('data-panel') || ''; panel = p === 'map' || HUB_PANELS.some(x => x.id === p) ? p : 'news'; render(); return; }
            if (act === 'hooks-propose') { note = 'Asking the world for hooks…'; render(); const r = await proposeHubHooks(worldId); note = describeHooksResult(r); render(); return; }
            if (act === 'hook-aside') { setHubHookAside(worldId, id); render(); return; }
            if (act === 'hook-play') { const h = hubHooks(worldId).proposed.find(x => x.id === id); if (h) openStart({ seed: { kind: 'hook', id: h.id, label: h.title, text: h.text } }); return; }
            if (act === 'place') { openPlace(id); return; }
            if (act === 'start-here') { const d = placeSheetData(id); openStart({ place: { id, label: d.label } }); return; }
            if (act === 'start') { openStart(); return; }
            if (act === 'start-go') { await startGo(); return; }
            if (act === 'sheet-close') { if (sheet && sheet.kind === 'picker') cancelStart(); sheet = null; await refresh(); render(); return; }
            if (act === 'pick') { await pick(Number(this.getAttribute('data-i')) || 0); return; }
            if (act === 'pick-own') { await pick('own', String($(`${root} #dooms-hub-own`).val() || '')); return; }
            if (act === 'pick-none') { await pick('none'); return; }
            if (act === 'ask-again') { await askAgain(); return; }
            if (act === 'end') {
                const cur = currentScene();
                if (!cur || !cur.scene || cur.scene.id !== id) { const r = await openSceneChat(worldId, id); if (!r.ok) { note = describeStartResult(r); render(); return; } }
                await openEnd();
                return;
            }
            if (act === 'end-go') { await endGo(); return; }
            if (act === 'to-hub') { sheet = null; await refresh(); render(); return; }
            if (act === 'resume') { const r = await resumeScene(worldId, id); if (r.ok) closeHub(); else { note = describeStartResult(r); render(); } return; }
            if (act === 'open-chat') { const r = await openSceneChat(worldId, id); if (r.ok) closeHub(); else { note = describeStartResult(r); render(); } return; }
            if (act === 'aside') { setSceneAside(worldId, id); note = 'Set aside; nothing is remembered until you end it.'; render(); return; }
            if (act === 'continue') {
                const entry = worldEntry(worldId);
                const s = entry ? entry.scenes.find(x => x.id === id) : null;
                if (s) openStart({ seed: { kind: 'scene', id: s.id, label: s.title, text: s.recap ? `The scene before: ${s.recap}` : '' }, place: s.place && s.place.id ? { id: s.place.id, label: s.place.label } : (s.place && s.place.label ? { label: s.place.label } : null), cast: s.cast });
                return;
            }
            if (act === 'remove') { removeGoneScene(worldId, id); render(); return; }
        } catch (e) {
            note = `Failed: ${e && e.message ? e.message : e}`;
            render();
        }
        ev.preventDefault();
    });
    // Every line of the News and Rumours panels and every face of the People panel is a way in (§4.1).
    $(document).on('click', `${root} .dooms-hub-ways[data-way="news"] .dooms-map-changes li, ${root} .dooms-hub-ways[data-way="rumour"] .dooms-world-effects li`, function () {
        const text = String(this.textContent || '').trim();
        const kind = this.closest('.dooms-hub-ways').getAttribute('data-way') === 'rumour' ? 'rumour' : 'news';
        if (text) openStart({ seed: { kind, text } });
    });
    $(document).on('click', `${root} .dooms-hub-ways[data-way="person"] .dooms-world-card[data-name]`, function (ev) {
        ev.preventDefault();
        const name = String(this.getAttribute('data-name') || '');
        if (name) startWithPerson(name);
    });
    $(document).on('change', `${root} .dooms-hub-ways .dooms-map-feed`, function () { render(); });    // the Map window's feed control is not the hub's: the panel keeps its latest twelve
    window.addEventListener(HUB_CHANGED_EVENT, async (ev) => {
        if (!isOpen) return;
        const source = ev && ev.detail ? ev.detail.source : '';
        if (source === 'chat' && sheet && (sheet.kind === 'picker' || sheet.kind === 'end') && (sheet.busy || (sheet.states && Object.values(sheet.states).includes('running')))) return;    // a sheet mid-request keeps its own state
        if (source === 'chat' && sheet && sheet.kind === 'end') return;    // End's own chat change (the resume before it) is not a reason to drop the sheet
        if (['end', 'start', 'gap', 'bind', 'unbind', 'refresh', 'chat-gone', 'reopen', 'aside', 'resume', 'hooks', 'hooks-failed', 'hook-aside', 'hooks-start', 'hooks-end'].includes(source) && !sheet) render();
    });
}

/**
 * Opens the window (building it the first time). `worldId` opens that
 * world; `start` opens the Start sheet at once; `end` the End sheet for
 * the scene in front.
 */
export async function openHub({ worldId: id = '', start = false, end = false, seed = null, place = null, cast = [] } = {}) {
    try { await ensureCss('modals'); } catch (e) { /* the sheet failed to load: the window still opens */ }
    build();
    isOpen = true;
    pushWindow('hub');
    note = '';
    if (!panel) { try { panel = window.matchMedia && window.matchMedia('(max-width: 640px)').matches ? 'map' : 'news'; } catch (e) { panel = 'news'; } }
    if (id) worldId = id;
    if (!id && end) { const cur = currentScene(); if (cur) worldId = cur.worldId; }
    await refresh();
    if (worldId) { try { await refreshScenes(worldId); } catch (e) { /* the list stands as it is */ } }
    sheet = null;
    $(`#${POPUP_ID}`).css('display', 'flex');    // shown before the render, so the board's frame has its size when Leaflet fits the picture
    render();
    if (end) await openEnd();
    else if (start) openStart({ seed, place, cast });
}

/** The End sheet for the scene in front (the strip, the D menu). */
export async function openEndSheet() {
    const cur = currentScene();
    if (!cur) { try { toastr.info('This chat is not a scene of a world.', 'The Hub', { timeOut: 3000 }); } catch (e) { /* no toastr */ } return; }
    await openHub({ worldId: cur.worldId, end: true });
}

export function closeHub() {
    isOpen = false;
    popWindow('hub');
    if (sheet && sheet.kind === 'picker') cancelStart();
    sheet = null;
    unmountHubBoard();
    boardView = null;
    $(`#${POPUP_ID}`).css('display', 'none');
}

export function isHubOpen() {
    return isOpen;
}

