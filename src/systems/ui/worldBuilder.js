/**
 * The World Builder (docs/world-builder-plan.md D94–D98): the window where
 * worlds are made and edited, drafted from the chat, imported and
 * exported, and where a chat's own world is kept (Make this a world). The
 * views are src/systems/ui/worldBuilderViews.js (pure); the worlds live in
 * src/systems/features/liveWorld.js. Lazy: loaded when first opened.
 */
import { extensionSettings } from '../../core/state.js';
import { saveSettings } from '../../core/persistence.js';
import { ensureCss } from '../../core/cssLoader.js';
import { escapeHtml } from '../../utils/html.js';
import { normalizePack, liveWorldConfig, BLANK_PACK_ID } from '../../utils/liveWorld.js';
import { hasMap, mapSize, withMap, withNode, boardModel, pictureKey } from '../../utils/worldPicture.js';
import { safeImageUrl } from '../../utils/worldBoard.js';
import { getBase64Async, saveBase64AsFile } from '../../../../../../utils.js';
import { renderImage, sourceProblem } from '../features/imageGen.js';
import { pushWindow, popWindow, takesEscape, closeOnBackdrop } from './windowStack.js';
import { emptyWorld, worldFileName, worldToJson, packWarnings } from '../../utils/worldBuilder.js';
import {
    TEMPLATE_PACK_ID, BUILTIN_PACKS, listWorlds, getWorldRaw, saveWorld, deleteWorld, importWorldJson, worldFromThisChat, adoptWorld, draftWorldFromChat,
    isDrafting, getWorldState, WORLD_CHANGED_EVENT,
} from '../features/liveWorld.js';
import { builderShellHtml, builderHtml, statusHtml, nameHtml, POPUP_ID, WB_TABS } from './worldBuilderViews.js';

let built = false;
let isOpen = false;
let worlds = [];
let selectedId = '';     // the world open: an id, 'new', or ''
let draft = null;        // the world being edited, in the file's shape
let draftFrom = '';      // the id it was opened from ('' for a new one, or the template)
let dirty = false;
let tab = 'world';
let note = '';
let adoptOnSave = false; // Save makes it the open chat's world (D96)
let fileInput = null;
let mapInput = null;     // the Map tab's file picker (docs/hub-plan.md D137)
let mapPicked = '';      // the Map tab: a place picked from the list, waiting for a tap on the picture
let mapBusy = '';        // the Map tab: 'upload' | 'draw' while a picture is saved or drawn
let board = null;        // the Map tab's board (Leaflet's host), mounted while the tab shows a picture
let boardView = null;    // the board's view kept across re-renders, with the key of the picture it belongs to
let boardKey = '';       // the picture the mounted board shows (pictureKey)
let mapToken = 0;        // a mount that outlives its render is dropped

const slugOf = (v) => String(v || '').normalize('NFC').trim().toLowerCase().replace(/[^\p{L}\p{M}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 60);
const AUTO_ID = /^new-(place|clock)(-\d+)?$/;

function chatOpen() {
    try {
        const ctx = window.SillyTavern && window.SillyTavern.getContext ? window.SillyTavern.getContext() : null;
        return !!(ctx && ctx.chatId);
    } catch (e) { return false; }
}

function where() {
    const cfg = liveWorldConfig(extensionSettings);
    const s = getWorldState();
    return { pack: cfg.pack, chatPack: s ? s.pack : '', chatOpen: chatOpen() };
}

async function refreshWorlds() {
    try { worlds = await listWorlds(); } catch (e) { worlds = []; }
}

function render() {
    const $body = $(`#${POPUP_ID} .dooms-wb-body`);
    if (!$body.length) return;
    const paneEl = $body.find('.dooms-wb-pane')[0];
    const scroll = paneEl ? paneEl.scrollTop : 0;
    unmountMap();
    $body.html(builderHtml({ worlds, selectedId, draft, dirty, tab, note, busy: isDrafting() ? 'draft' : '', adoptOnSave, where: where(), mapPicked, mapBusy }));
    const pane = $body.find('.dooms-wb-pane')[0];
    if (pane) pane.scrollTop = scroll;
    if (tab === 'map' && draft) mountMap();
}

/** The status and the head follow a keystroke; the pane is left alone so the field keeps its focus. */
function renderStatus() {
    if (!draft) return;
    const n = normalizePack(draft);
    $(`#${POPUP_ID} .dooms-wb-status`).html(statusHtml(n.errors, n.ok ? packWarnings(n.pack) : [], note));
    $(`#${POPUP_ID} [data-act="save"], #${POPUP_ID} [data-act="copy"], #${POPUP_ID} [data-act="export"]`).prop('disabled', n.errors.length > 0);
    $(`#${POPUP_ID} .dooms-wb-name`).html(nameHtml(draft, dirty));
}

// ─── The draft's fields ─────────────────────────────────────────────────

function setPath(path, value) {
    const keys = String(path).split('.');
    let cur = draft;
    for (let i = 0; i < keys.length - 1; i++) {
        const k = keys[i];
        const idx = Array.isArray(cur) ? Number(k) : k;
        let next = cur[idx];
        if (next === undefined || next === null || typeof next !== 'object') {
            if (Array.isArray(cur)) return;    // an item that is gone
            next = {};
            cur[idx] = next;
        }
        cur = next;
    }
    const last = keys[keys.length - 1];
    if (value === undefined) delete cur[last];
    else cur[last] = value;
}

function readControl(el) {
    if (el.type === 'checkbox') return el.checked ? true : undefined;
    const raw = String(el.value ?? '');
    if (el.type === 'number') {
        const t = raw.trim();
        if (!t) return undefined;
        const n = Number(t);
        return Number.isFinite(n) ? Math.round(n) : undefined;
    }
    return raw;
}

function applyField(el) {
    const path = el.getAttribute('data-f');
    if (!path || !draft) return;
    let value = readControl(el);
    if (/\.parent$/.test(path)) value = value ? value : null;
    else if (/\.(place|image|step)$/.test(path) && value === '') value = undefined;
    else if (path === 'template' && value === '') value = undefined;
    else if (/\.effects\.\d+$/.test(path) && value === '') value = undefined;
    else if (/\.tier$/.test(path)) value = value === 'known' ? 'known' : 'heard';
    setPath(path, value);
    dirty = true;
}

function uniqueId(base, list) {
    const s = slugOf(base) || 'item';
    let id = s;
    let n = 2;
    while (list.some(x => x && x.id === id)) id = `${s}-${n++}`;
    return id;
}

/** A place or clock added with a stand-in id takes its id from its label once the label is typed; what pointed at the old id follows. */
function reidIfAuto(kind, i) {
    const list = Array.isArray(draft[kind]) ? draft[kind] : [];
    const item = list[i];
    if (!item || !AUTO_ID.test(String(item.id || ''))) return false;
    const wanted = slugOf(item.label);
    if (!wanted || wanted === item.id) return false;
    const old = item.id;
    item.id = uniqueId(wanted, list.filter(x => x !== item));
    if (kind === 'places') {
        for (const p of list) if (p && p.parent === old) p.parent = item.id;
        for (const c of Array.isArray(draft.clocks) ? draft.clocks : []) if (c && c.place === old) c.place = item.id;
        for (const m of Array.isArray(draft.cast) ? draft.cast : []) if (m && m.place === old) m.place = item.id;
    }
    return true;
}

function removeItem(kind, i) {
    const list = Array.isArray(draft[kind]) ? draft[kind] : [];
    const item = list[i];
    if (!item) return;
    list.splice(i, 1);
    if (kind === 'places') {
        // its children move up to its parent; a clock or a person at it stand nowhere
        for (const p of list) if (p && p.parent === item.id) p.parent = item.parent || null;
        for (const c of Array.isArray(draft.clocks) ? draft.clocks : []) if (c && c.place === item.id) delete c.place;
        for (const m of Array.isArray(draft.cast) ? draft.cast : []) if (m && m.place === item.id) delete m.place;
    }
    dirty = true;
}

// ─── Opening worlds ─────────────────────────────────────────────────────

function discardOk() {
    return !dirty || window.confirm('Discard the changes to this world?');
}

async function openWorld(id, { force = false } = {}) {
    if (!force && !discardOk()) return false;
    const r = await getWorldRaw(id);
    if (!r.raw) { note = r.errors.join(' ') || `The world "${id}" could not be read.`; render(); return false; }
    draft = r.raw;
    draftFrom = r.custom ? id : '';
    if (BUILTIN_PACKS.includes(id)) draft.id = uniqueId(draft.name || id, worlds);    // Save keeps a copy as your own (D92): the copy takes an id of its own, the template keeps its key
    selectedId = id;
    dirty = false;
    adoptOnSave = false;
    tab = 'world';
    note = r.errors.length ? `Read with problems: ${r.errors.join(' ')}` : '';
    render();
    return true;
}

function newWorld() {
    if (!discardOk()) return;
    draft = emptyWorld({ name: 'New world' });
    draftFrom = '';
    selectedId = 'new';
    dirty = true;
    adoptOnSave = false;
    tab = 'world';
    note = 'A world with nothing in it yet. Name it here, lay out its places, add the clocks that will move between scenes and the people who live there, then Save. Or leave the places empty: the story fills them in as it names them.';
    render();
}

async function draftFromChat() {
    if (!discardOk()) return;
    note = 'Drafting a world from this chat…';
    render();
    const d = await draftWorldFromChat({ name: draft && selectedId === 'new' ? draft.name : '' });
    if (d.raw) {
        draft = d.raw;
        draftFrom = '';
        selectedId = 'new';
        dirty = true;
        adoptOnSave = false;
        tab = 'world';
    }
    if (d.ok) note = 'Drafted. Read it through, change what you like, then Save.';
    else if (d.raw) note = 'Drafted, with problems listed below.';
    else note = `The draft could not be written: ${(d.errors || []).join(' ')}`;
    render();
}

function importFile() {
    if (!discardOk()) return;
    if (!fileInput) {
        fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = '.json,application/json';
        fileInput.style.display = 'none';
        document.body.appendChild(fileInput);
        fileInput.addEventListener('change', async () => {
            const file = fileInput.files && fileInput.files[0];
            fileInput.value = '';
            if (!file) return;
            let text = '';
            try { text = await file.text(); } catch (e) { note = `The file could not be read: ${e.message}`; render(); return; }
            const r = await importWorldJson(text);
            if (!r.ok) { note = `Not imported: ${r.errors.join(' ')}`; render(); return; }
            await refreshWorlds();
            await openWorld(r.pack.id, { force: true });
            note = `Imported "${r.pack.name}".`;
            render();
        });
    }
    fileInput.click();
}

// ─── Saving ─────────────────────────────────────────────────────────────

async function save() {
    if (!draft) return;
    const r = await saveWorld(draft, { previousId: draftFrom });
    if (!r.ok) { note = r.errors.join(' '); renderStatus(); return; }
    const id = r.pack.id;
    if (adoptOnSave) {
        const a = await adoptWorld(id);
        note = a.ok ? `Saved; this chat now plays in "${r.pack.name}".` : `Saved; the chat could not carry over: ${a.error}`;
        adoptOnSave = false;
    } else note = 'Saved.';
    draftFrom = id;
    selectedId = id;
    dirty = false;
    await refreshWorlds();
    render();
}

async function saveCopy() {
    if (!draft) return;
    const name = window.prompt('A name for the copy', `${draft.name || 'World'} (copy)`);
    if (!name || !name.trim()) return;
    const raw = JSON.parse(JSON.stringify(draft));
    raw.name = name.trim();
    raw.id = name.trim();
    const r = await saveWorld(raw);
    if (!r.ok) { note = r.errors.join(' '); renderStatus(); return; }
    await refreshWorlds();
    await openWorld(r.pack.id, { force: true });
    note = `Saved as "${r.pack.name}".`;
    render();
}

function exportFile() {
    if (!draft) return;
    const n = normalizePack(draft);
    if (!n.ok) { note = n.errors.join(' '); renderStatus(); return; }
    const blob = new Blob([worldToJson(draft)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = worldFileName(n.pack);
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 0);
    note = `Exported ${worldFileName(n.pack)}.`;
    renderStatus();
}

async function remove() {
    if (!draft || !selectedId || selectedId === 'new') return;
    if (!window.confirm(`Delete the world "${draft.name || selectedId}"? A chat in it goes on in the blank world until the world is imported back.`)) return;
    const ok = await deleteWorld(selectedId);
    note = ok ? 'Deleted.' : 'Only a world of your own can be deleted.';
    if (ok) { draft = null; selectedId = ''; draftFrom = ''; dirty = false; adoptOnSave = false; }
    await refreshWorlds();
    render();
}

function useForNewChats() {
    if (!selectedId || selectedId === 'new') return;
    if (!extensionSettings.liveWorld || typeof extensionSettings.liveWorld !== 'object') extensionSettings.liveWorld = {};
    extensionSettings.liveWorld.pack = selectedId;
    try { saveSettings(); } catch (e) { console.warn('[Dooms Tracker] World Builder: settings save failed', e); }
    try { window.dispatchEvent(new CustomEvent(WORLD_CHANGED_EVENT, { detail: { source: 'world' } })); } catch (e) { /* no window */ }
    note = `New chats start in "${draft ? draft.name : selectedId}".`;
    render();
}

// ─── The Map tab (docs/hub-plan.md D136, D137) ──────────────────────────

function unmountMap() {
    if (!board) return;
    try { boardView = { key: boardKey, ...board.view() }; board.destroy(); } catch (e) { /* the frame is gone already */ }
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

/** The board in the Map tab's frame: Leaflet over the world's picture, the nodes draggable, a dropped or tapped place set. */
async function mountMap() {
    const host = document.querySelector(`#${POPUP_ID} .dooms-wb-map:not(.is-empty)`);
    if (!host || !draft) return;
    const pack = normalizePack(draft).pack;
    if (!hasMap(pack)) return;
    const token = ++mapToken;
    let size = mapSize(pack);
    if (!size) {
        try { size = await readImageSize(safeImageUrl(pack.map.image)); } catch (e) { host.innerHTML = '<p class="dooms-wb-map-wait dooms-world-muted">The picture could not be read: check its path, or upload it again.</p>'; return; }
        if (token !== mapToken || !isOpen || !draft) return;
        draft = withMap(draft, { ...pack.map, ...size });    // the size kept beside the path from now on; not an edit of the user's (the next Save keeps it)
    }
    let mod;
    try {
        mod = await import('./hubBoard.js');
        await ensureCss('leaflet', mod.LEAFLET_CSS);
    } catch (e) { host.innerHTML = `<p class="dooms-wb-map-wait dooms-world-muted">The map could not load: ${escapeHtml(e && e.message ? e.message : String(e))}</p>`; return; }
    if (token !== mapToken || !isOpen || tab !== 'map' || !draft || !document.body.contains(host)) return;
    host.innerHTML = '';
    const current = normalizePack(draft).pack;
    const picture = { ...current.map, ...size };
    const key = pictureKey(picture);
    board = await mod.mountBoard(host, {
        picture,
        nodes: boardModel({ pack: current }).nodes,
        mode: 'edit',
        view: boardView && boardView.key === key ? boardView : null,    // a view kept for this picture alone: another world's picture opens fitted
        on: {
            move: (id, node) => { if (!draft) return; draft = withNode(draft, id, node); dirty = true; renderStatus(); },
            drop: (id, node) => { if (!draft) return; draft = withNode(draft, id, node); dirty = true; mapPicked = ''; render(); },
            tap: (node) => { if (!draft || !mapPicked) return; draft = withNode(draft, mapPicked, node); dirty = true; mapPicked = ''; render(); },
            remove: (id) => { if (!draft) return; draft = withNode(draft, id, null); dirty = true; render(); },
            error: () => {    // the file is gone, or its path refused: said in the frame, the places' lists beside it stay
                if (token !== mapToken) return;
                setTimeout(() => { if (token !== mapToken) return; unmountMap(); boardView = null; host.innerHTML = '<p class="dooms-wb-map-wait dooms-world-muted">The picture could not be read: check its path, or upload it again.</p>'; }, 0);
            },
        },
    });
    if (token !== mapToken || !document.body.contains(host)) { try { board.destroy(); } catch (e) { /* gone */ } board = null; return; }    // a render came while Leaflet loaded
    boardKey = key;
    boardView = null;
}

/** A data URL saved as a file in SillyTavern's images folder (D136): the path, the size, the source. */
async function savePicture(dataUrl, source) {
    const comma = dataUrl.indexOf(',');
    const base64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
    const mime = (/^data:image\/(\w+)/.exec(dataUrl) || [])[1] || 'png';
    const ext = mime === 'jpeg' ? 'jpg' : mime;
    const size = await readImageSize(dataUrl);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const name = `${slugOf((draft && (draft.id || draft.name)) || '') || 'world'}-map-${stamp}`;
    const path = await saveBase64AsFile(base64, 'des-worlds', name, ext);
    if (!path) throw new Error('SillyTavern saved the picture but gave no path back');
    return { image: String(path), width: size.width, height: size.height, source };
}

function pickMapFile() {
    if (!draft || mapBusy) return;
    if (!mapInput) {
        mapInput = document.createElement('input');
        mapInput.type = 'file';
        mapInput.accept = 'image/png,image/jpeg,image/webp,image/gif';
        mapInput.style.display = 'none';
        document.body.appendChild(mapInput);
        mapInput.addEventListener('change', async () => {
            const file = mapInput.files && mapInput.files[0];
            mapInput.value = '';
            if (!file || !draft) return;
            mapBusy = 'upload';
            render();
            try {
                const dataUrl = await getBase64Async(file);
                const m = await savePicture(dataUrl, 'upload');
                if (draft) { draft = withMap(draft, m); dirty = true; boardView = null; note = `The picture is saved (${m.width} × ${m.height}). Drag the places onto it.`; }
            } catch (e) { note = `The picture was not saved: ${e && e.message ? e.message : e}`; }
            mapBusy = '';
            render();
        });
    }
    mapInput.click();
}

/** What Image Generation is asked for (D136): the world as a page of an atlas from its name, its blurb and its description, its regions and places named, no writing on it. */
function mapPrompt(d) {
    const n = normalizePack(d).pack;
    const roots = n.places.filter(p => !p.parent).map(p => p.label);
    const rest = n.places.filter(p => p.parent).map(p => p.label);
    return [
        `A map of ${n.name}, seen from above, painted as a page of a fantasy atlas: coastlines, hills, forests, rivers and roads, the whole land on one sheet, no writing on it.`,
        n.blurb,
        n.description,
        roots.length ? `Its regions: ${roots.join(', ')}.` : '',
        rest.length ? `Its places: ${rest.slice(0, 12).join(', ')}.` : '',
    ].filter(Boolean).join(' ');
}

async function drawMap() {
    if (!draft || mapBusy) return;
    const problem = sourceProblem();
    if (problem) { note = `The map cannot be drawn: ${problem}.`; renderStatus(); return; }
    mapBusy = 'draw';
    note = 'Drawing the map…';
    render();
    try {
        const r = await renderImage(
            { purpose: 'map', prompt: mapPrompt(draft), negative: 'text, letters, writing, labels, watermark, frame, border', size: 'landscape' },
            { onProgress: (p) => { if (!p) return; if (p.error) note = `Drawing the map… ${p.error}`; else if (p.stage) note = `Drawing the map… ${p.stage}${p.max ? ` ${p.value || 0}/${p.max}` : ''}`; renderStatus(); } },
        );
        let m;
        if (r && r.dataUrl) m = await savePicture(r.dataUrl, 'drawn');
        else if (r && r.url) { const size = await readImageSize(safeImageUrl(r.url)); m = { image: String(r.url), ...size, source: 'drawn' }; }
        else throw new Error('the image source answered with no picture');
        if (draft) { draft = withMap(draft, m); dirty = true; boardView = null; note = `The map is drawn (${m.width} × ${m.height}). Draw it again if it is not the one; drag the places onto it when it is.`; }
    } catch (e) { note = `The map was not drawn: ${e && e.message ? e.message : e}`; }
    mapBusy = '';
    render();
}

// ─── The window ─────────────────────────────────────────────────────────

function build() {
    if (built) return;
    built = true;
    $('body').append(builderShellHtml());
    const root = `#${POPUP_ID}`;
    $(document).on('click', '#dooms-wb-close', close);
    closeOnBackdrop(POPUP_ID, close);    // a press on the backdrop released there; a node's drag or a pan let go past the window's edge is not a close
    $(document).on('keydown', (ev) => { if (isOpen && takesEscape('builder', ev)) close(); });
    $(document).on('click', `${root} [data-act]`, async function (ev) {
        const act = this.getAttribute('data-act');
        if (act === 'open') { await openWorld(this.getAttribute('data-id') || ''); return; }
        if (act === 'new') { newWorld(); return; }
        if (act === 'template') { if (discardOk()) await openWorld(TEMPLATE_PACK_ID, { force: true }); return; }
        if (act === 'draft') { await draftFromChat(); return; }
        if (act === 'import') { importFile(); return; }
        if (act === 'save') { await save(); return; }
        if (act === 'copy') { await saveCopy(); return; }
        if (act === 'export') { exportFile(); return; }
        if (act === 'delete') { await remove(); return; }
        if (act === 'use') { useForNewChats(); return; }
        if (act === 'play') {    // the Atlas on this world, whatever chat is in front (docs/long-shot-plan.md D194)
            const id = selectedId;
            if (!id || id === 'new' || !discardOk()) return;
            if (dirty) await openWorld(id, { force: true });    // the edits let go: the world as saved is what the builder holds when it opens again
            close();
            import('./atlas.js').then(m => m.openAtlas({ worldId: id, tab: 'scenes' })).catch(err => console.error('[Dooms Tracker] The Atlas failed to load:', err));
            return;
        }
        if (act === 'tab') { const t = this.getAttribute('data-tab'); if (WB_TABS.some(x => x.id === t)) { tab = t; mapPicked = ''; render(); } return; }
        if (!draft) return;
        if (act === 'map-upload') { pickMapFile(); return; }
        if (act === 'map-draw') { await drawMap(); return; }
        if (act === 'map-remove') { if (!window.confirm('Remove the picture from this world? The places keep their spots; the file stays in SillyTavern\'s images folder.')) return; draft = withMap(draft, null); dirty = true; mapPicked = ''; render(); return; }
        if (act === 'map-pick') { const id = this.getAttribute('data-id') || ''; mapPicked = mapPicked === id ? '' : id; render(); return; }
        if (act === 'map-unplace') { draft = withNode(draft, this.getAttribute('data-id') || '', null); dirty = true; render(); return; }
        if (act === 'add-place') { if (!Array.isArray(draft.places)) draft.places = []; draft.places.push({ id: uniqueId('new-place', draft.places), label: '', parent: null }); dirty = true; tab = 'places'; render(); focusLast('.dooms-wb-place'); return; }
        if (act === 'add-clock') { if (!Array.isArray(draft.clocks)) draft.clocks = []; draft.clocks.push({ id: uniqueId('new-clock', draft.clocks), label: '', start: 0, max: 6, effects: {} }); dirty = true; tab = 'clocks'; render(); focusLast('.dooms-wb-clock'); return; }
        if (act === 'add-person') { if (!Array.isArray(draft.cast)) draft.cast = []; draft.cast.push({ name: '', tier: 'heard' }); dirty = true; tab = 'cast'; render(); focusLast('.dooms-wb-person'); return; }
        if (act === 'remove') { removeItem(this.getAttribute('data-kind'), Number(this.getAttribute('data-i'))); render(); ev.preventDefault(); }
    });
    // The Map tab: a place dragged from its list onto the picture carries its id (the board reads it on drop).
    $(document).on('dragstart', `${root} .dooms-wb-map-place`, function (ev) {
        const dt = ev.originalEvent && ev.originalEvent.dataTransfer;
        if (!dt) return;
        dt.setData('text/plain', this.getAttribute('data-id') || '');
        dt.effectAllowed = 'move';
    });
    // A keystroke updates the world and the status only; leaving the field (change) redraws, so the selects follow a new label.
    $(document).on('input', `${root} [data-f]`, function () { applyField(this); renderStatus(); });
    $(document).on('change', `${root} [data-f]`, function () {
        applyField(this);
        const m = /^(places|clocks)\.(\d+)\.label$/.exec(this.getAttribute('data-f') || '');
        if (m) reidIfAuto(m[1], Number(m[2]));
        if (this.type === 'checkbox' || this.tagName === 'SELECT' || /\.(max|label|id)$/.test(this.getAttribute('data-f') || '') || this.getAttribute('data-f') === 'name') render();
        else renderStatus();
    });
    window.addEventListener(WORLD_CHANGED_EVENT, async (ev) => {
        if (!isOpen) return;
        const source = ev && ev.detail ? ev.detail.source : '';
        if (source === 'draft-start' || source === 'draft-end') { render(); return; }
        if (source === 'chat' || source === 'world' || source === 'seed') { await refreshWorlds(); render(); }
    });
}

function focusLast(selector) {
    const rows = $(`#${POPUP_ID} ${selector}`);
    const last = rows.last().find('input[type="text"]').first();
    if (last.length) last.trigger('focus');
}

/**
 * Opens the window. `id` opens that world; `fromChat` opens the open
 * chat's world as it stands, to be saved as a world of its own (D96).
 */
export async function openWorldBuilder({ id = '', fromChat = false } = {}) {
    try { await ensureCss('modals'); } catch (e) { /* the sheet failed to load: the window still opens */ }
    build();
    isOpen = true;
    pushWindow('builder');
    await refreshWorlds();
    if (fromChat) {
        const raw = worldFromThisChat();
        if (raw) {
            draft = raw;
            draftFrom = '';
            selectedId = 'new';
            dirty = true;
            adoptOnSave = true;
            tab = 'places';
            note = 'This is your chat so far, turned into a world you can keep and edit: the places the story has visited and the people it has met, as they stand now. Name it, add clocks or more places if you like, then Save. The chat goes on in this world from here; nothing is reset.';
        } else note = 'This chat has no world yet.';
    } else if (id && id !== BLANK_PACK_ID) {
        await openWorld(id, { force: true });
    }
    render();
    $(`#${POPUP_ID}`).css('display', 'flex');
}

export function closeWorldBuilder() {
    close();
}

function close() {
    if (!isOpen) return;
    if (!discardOk()) return;
    isOpen = false;
    popWindow('builder');
    unmountMap();
    boardView = null;
    $(`#${POPUP_ID}`).css('display', 'none');
}
