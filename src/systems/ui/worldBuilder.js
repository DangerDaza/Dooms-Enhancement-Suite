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
import { normalizePack, liveWorldConfig, BLANK_PACK_ID } from '../../utils/liveWorld.js';
import { emptyWorld, worldFileName, worldToJson, packWarnings } from '../../utils/worldBuilder.js';
import {
    listWorlds, getWorldRaw, saveWorld, deleteWorld, importWorldJson, worldFromThisChat, adoptWorld, draftWorldFromChat,
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
    $body.html(builderHtml({ worlds, selectedId, draft, dirty, tab, note, busy: isDrafting() ? 'draft' : '', adoptOnSave, where: where() }));
    const pane = $body.find('.dooms-wb-pane')[0];
    if (pane) pane.scrollTop = scroll;
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
    note = 'Name it, then add places, clocks and people; Save keeps it.';
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

// ─── The window ─────────────────────────────────────────────────────────

function build() {
    if (built) return;
    built = true;
    $('body').append(builderShellHtml());
    const root = `#${POPUP_ID}`;
    $(document).on('click', '#dooms-wb-close', close);
    $(document).on('click', root, (ev) => { if (ev.target && ev.target.id === POPUP_ID) close(); });
    $(document).on('keydown', (ev) => { if (ev.key === 'Escape' && isOpen) close(); });
    $(document).on('click', `${root} [data-act]`, async function (ev) {
        const act = this.getAttribute('data-act');
        if (act === 'open') { await openWorld(this.getAttribute('data-id') || ''); return; }
        if (act === 'new') { newWorld(); return; }
        if (act === 'template') { if (discardOk()) await openWorld('example', { force: true }); return; }
        if (act === 'draft') { await draftFromChat(); return; }
        if (act === 'import') { importFile(); return; }
        if (act === 'save') { await save(); return; }
        if (act === 'copy') { await saveCopy(); return; }
        if (act === 'export') { exportFile(); return; }
        if (act === 'delete') { await remove(); return; }
        if (act === 'use') { useForNewChats(); return; }
        if (act === 'tab') { const t = this.getAttribute('data-tab'); if (WB_TABS.some(x => x.id === t)) { tab = t; render(); } return; }
        if (!draft) return;
        if (act === 'add-place') { if (!Array.isArray(draft.places)) draft.places = []; draft.places.push({ id: uniqueId('new-place', draft.places), label: '', parent: null }); dirty = true; tab = 'places'; render(); focusLast('.dooms-wb-place'); return; }
        if (act === 'add-clock') { if (!Array.isArray(draft.clocks)) draft.clocks = []; draft.clocks.push({ id: uniqueId('new-clock', draft.clocks), label: '', start: 0, max: 6, effects: {} }); dirty = true; tab = 'clocks'; render(); focusLast('.dooms-wb-clock'); return; }
        if (act === 'add-person') { if (!Array.isArray(draft.cast)) draft.cast = []; draft.cast.push({ name: '', tier: 'heard' }); dirty = true; tab = 'cast'; render(); focusLast('.dooms-wb-person'); return; }
        if (act === 'remove') { removeItem(this.getAttribute('data-kind'), Number(this.getAttribute('data-i'))); render(); ev.preventDefault(); }
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
            note = 'This chat as it stands. Name it, add what you like, then Save: the chat carries over to it.';
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
    $(`#${POPUP_ID}`).css('display', 'none');
}
