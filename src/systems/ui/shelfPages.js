/**
 * The shelf's pages (Project Short Fuse, Phase 5).
 *
 * With the inventory on, the Present Characters shelf flips between
 * Characters (the cards, rendered by portraitBar.js as always), Inventory
 * and Quests. This
 * module renders the pages other than Characters into the shelf's page
 * container. Inventory and Quests are boxes: square slots for the pack and
 * the party pouch (icon, count badge, name beneath, dashed empties), and
 * quest boxes edited in place. A slot opens a small editor (name, count,
 * note, icon, move, remove); an empty slot adds. (Live World's World page
 * lived here for a day; D69 moved it into the Live World window.) Loaded
 * the first time a page other than Characters shows.
 */
import { extensionSettings } from '../../core/state.js';
import { saveSettings, saveChatData } from '../../core/persistence.js';
import { escapeHtml } from '../../utils/html.js';
import { MAX_COUNT, MAX_NAME, MAX_NOTE, findStack, iconFor, slotsFor } from '../../utils/inventory.js';
import { getInventoryState, getInventoryConfig, editStack, removeStack, moveItem } from '../features/inventory.js';
import { resolvePersonaName } from '../features/diceRolls.js';
import { renderQuests, syncQuestsToCommittedData } from '../rendering/quests.js';
import { openEmojiPicker, closeEmojiPicker } from './emojiPicker.js';
import { updatePortraitBar, resolvePortrait } from './portraitBar.js';
// Cut to a quest (Phase 5b): the menu on a quest box
import { questText, promoteQuest } from '../../utils/questCut.js';
import { startQuestCut, recordCompletedQuest } from '../features/questCut.js';
// Canon (docs/hooks-canon-plan.md D110): the ledger as a page
import { CANON_KINDS, KIND_LABELS, canonConfig } from '../../utils/canon.js';
import { getCanon, addCanonLine, editCanonLine, pinCanonLine, removeCanonLine, updateCanon, isUpdating, exportCanonToLorebook, canonMarkdownNow, canonBookName, CANON_CHANGED_EVENT } from '../features/canon.js';

const PAGE_ID = 'dooms-pb-page';
const EDITOR_ID = 'dooms-inv-editor';
const QUEST_MENU_ID = 'dooms-quest-menu';
const WHEN_ID = 'dooms-quest-when';

function containerLabel(container) {
    if (container === 'pouch') return 'Party pouch';
    const who = resolvePersonaName();
    return who ? `${who}'s pack` : 'Your pack';
}

function toast(kind, text) {
    try {
        const t = typeof window !== 'undefined' ? window.toastr : null;
        if (t && typeof t[kind] === 'function') t[kind](text, 'Inventory', { timeOut: 4000 });
    } catch (e) { /* no toastr */ }
}

function reasonText(reason, container) {
    const where = container === 'pouch' ? 'the party pouch' : 'the pack';
    if (reason === 'full') return `No free slot in ${where}: take something out first.`;
    if (reason === 'missing') return 'That item is no longer there.';
    if (reason === 'name') return 'Give it a name.';
    return 'That did not work.';
}

// ─── Inventory page ─────────────────────────────────────────────────────────

function slotHtml(container, item, over) {
    const name = escapeHtml(item.name);
    const note = item.note ? escapeHtml(item.note) : '';
    const title = note ? `${name} — ${note}` : name;
    return `<button type="button" class="dooms-inv-slot${over ? ' is-over' : ''}" data-container="${container}" data-name="${name}" title="${title}">
        <span class="dooms-inv-icon" aria-hidden="true">${escapeHtml(item.icon || '📦')}</span>
        ${item.count > 1 ? `<span class="dooms-inv-count">${item.count}</span>` : ''}
        ${note ? '<span class="dooms-inv-dot" aria-hidden="true"></span>' : ''}
        <span class="dooms-inv-name">${name}</span>
    </button>`;
}

function sectionHtml(container, icon, state, cfg) {
    const list = state[container] || [];
    const slots = slotsFor(container, cfg);
    const cells = list.map((item, i) => slotHtml(container, item, i >= slots));
    for (let i = list.length; i < slots; i++) {
        cells.push(`<button type="button" class="dooms-inv-slot is-empty" data-container="${container}" title="Add an item"><span class="dooms-inv-plus" aria-hidden="true">+</span></button>`);
    }
    const full = list.length >= slots;
    const fillTitle = list.length > slots
        ? 'Over the slot count (it was lowered): nothing new fits until it clears'
        : full ? 'Full: no new kind of item fits until something goes' : 'Kinds of item / slots';
    return `<section class="dooms-inv-section" data-container="${container}">
        <div class="dooms-inv-head">
            <span class="dooms-inv-label">${icon} ${escapeHtml(containerLabel(container))}</span>
            <span class="dooms-inv-fill${full ? ' is-full' : ''}" title="${fillTitle}">${list.length}/${slots}</span>
        </div>
        <div class="dooms-inv-grid">${cells.join('')}</div>
    </section>`;
}

/** The Inventory page: the pack, then the party pouch. */
export function inventoryPageHtml() {
    const state = getInventoryState();
    const cfg = getInventoryConfig();
    return `<div class="dooms-pb-page-inner dooms-pb-page-inventory">${sectionHtml('pack', '🎒', state, cfg)}${sectionHtml('pouch', '👝', state, cfg)}</div>`;
}

// ─── Quests page ────────────────────────────────────────────────────────────

function questBox(field, index, text, main) {
    const idx = index != null ? ` data-index="${index}"` : '';
    return `<div class="dooms-quest-box${main ? ' is-main' : ''}" data-field="${field}"${idx} title="Right-click or hold for Cut to it">
        <div class="dooms-quest-text" contenteditable="true" spellcheck="false" data-field="${field}"${idx} title="Click to edit">${escapeHtml(text)}</div>
        <button type="button" class="dooms-quest-done" data-field="${field}"${idx} title="Complete and remove"><i class="fa-solid fa-check"></i></button>
    </div>`;
}

const CANON_ICONS = Object.freeze({ person: '👤', place: '📍', thing: '🎒', fact: '📜', promise: '🤝', secret: '🤫' });
const CANON_HINTS = Object.freeze({
    person: ['Who', 'who they are to the story now'],
    place: ['Where', 'what it is, what happened there'],
    thing: ['What', 'what it is, who holds it'],
    fact: ['What', 'what the story has established'],
    promise: ['What was sworn', 'by whom, to whom, by when'],
    secret: ['What was revealed', 'to the player, and who else knows'],
});

function canonLine(e) {
    const id = escapeHtml(e.id);
    return `<div class="dooms-canon-line${e.pinned ? ' is-pinned' : ''}${e.by === 'you' ? ' is-yours' : ''}" data-id="${id}">
        <span class="dooms-canon-name" contenteditable="true" spellcheck="false" data-canon-field="name" data-id="${id}" title="Click to edit (an edit pins the line)">${escapeHtml(e.name)}</span>
        <span class="dooms-canon-text" contenteditable="true" spellcheck="false" data-canon-field="text" data-id="${id}" title="Click to edit (an edit pins the line)">${escapeHtml(e.text)}</span>
        <span class="dooms-canon-tools">${e.gameDate ? `<span class="dooms-canon-when" title="When the story established it">${escapeHtml(e.gameDate)}</span>` : ''}<button type="button" class="dooms-canon-btn${e.pinned ? ' is-on' : ''}" data-canon-act="pin" data-id="${id}" title="${e.pinned ? 'Pinned: no run rewrites or drops this line. Click to unpin.' : 'Pin: keep this line as it is, whatever the runs say.'}"><i class="fa-solid fa-thumbtack"></i></button><button type="button" class="dooms-canon-btn" data-canon-act="remove" data-id="${id}" title="Remove this line"><i class="fa-solid fa-xmark"></i></button></span>
    </div>`;
}

function finishCanonEdit(el) {
    const field = el.dataset.canonField === 'name' ? 'name' : 'text';
    const id = el.dataset.id;
    const value = String(el.textContent || '').replace(/\s+/g, ' ').trim();
    const s = getCanon();
    const cur = s && s.entries.find(e => e.id === id);
    if (!cur) { forceRerender(); return; }
    if (!value || cur[field] === value) { forceRerender(); return; }
    if (!editCanonLine(id, { [field]: value })) toast('warning', 'The line was not changed.');
    forceRerender();
}

function canonAction(btn) {
    const act = btn.dataset.canonAct;
    const id = btn.dataset.id;
    if (act === 'pin') {
        const s = getCanon();
        const cur = s && s.entries.find(e => e.id === id);
        if (cur) pinCanonLine(id, !cur.pinned);
        forceRerender();
    } else if (act === 'remove') {
        removeCanonLine(id);
        forceRerender();
    } else if (act === 'add') {
        const kind = btn.dataset.kind;
        const row = btn.closest('.dooms-canon-line');
        const name = String(row?.querySelector('[data-canon-new="name"]')?.textContent || '').replace(/\s+/g, ' ').trim();
        const text = String(row?.querySelector('[data-canon-new="text"]')?.textContent || '').replace(/\s+/g, ' ').trim();
        if (!name || !text) { toast('info', 'A line needs a name and a text.'); return; }
        if (!addCanonLine({ kind, name, text })) { toast('warning', 'The line was not added.'); return; }
        forceRerender();
    } else if (act === 'update') {
        btn.disabled = true;
        forceRerender();
        updateCanon({ reason: 'manual' }).then(async (r) => {
            const { describeCanonResult } = await import('../../utils/canon.js');
            toast(r.ok ? 'success' : 'warning', describeCanonResult(r));
        }).catch(e => toast('error', `Failed: ${e && e.message ? e.message : e}`)).finally(() => forceRerender());
    } else if (act === 'export') {
        btn.disabled = true;
        exportCanonToLorebook().then(r => {
            toast(r.ok ? 'success' : 'warning', r.ok ? `${r.written} line${r.written === 1 ? '' : 's'} written to the lorebook "${r.book}".` : `Not exported: ${r.error}`);
        }).finally(() => { btn.disabled = false; });
    } else if (act === 'markdown') {
        const md = canonMarkdownNow();
        if (!md) { toast('info', 'Nothing to download yet.'); return; }
        const blob = new Blob([md], { type: 'text/markdown' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${canonBookName().replace(/[^\w.-]+/g, '_')}.md`;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 0);
    }
}

/** The Canon page (D110): the ledger by kind, each line editable in place, pinnable, removable; a line of your own under each kind; the runs. */
export function canonPageHtml() {
    const s = getCanon();
    if (!s) return '<div class="dooms-pb-page-inner dooms-pb-page-canon"><p class="dooms-world-muted">Canon is off, or no chat is open. Settings → Canon switches it on.</p></div>';
    const cfg = canonConfig(extensionSettings);
    const next = Math.max(0, cfg.every - s.sinceLast);
    const last = s.last && s.last.ok ? `Last run ${s.last.gameDate ? `on ${escapeHtml(s.last.gameDate)}` : 'once'}: ${s.last.added} added or changed, ${s.last.dropped} dropped.` : 'Not run yet.';
    const err = s.lastError ? `<span class="dooms-world-error">${s.lastError.kind === 'error' ? `The last run failed: ${escapeHtml(s.lastError.error || 'the request did not complete')}.` : `Last attempt discarded: ${escapeHtml(s.lastError.error)}.`}</span>` : '';
    const sections = CANON_KINDS.map(kind => {
        const mine = s.entries.filter(e => e.kind === kind).sort((a, b) => (b.pinned - a.pinned) || ((b.at || 0) - (a.at || 0)));
        const [ph1, ph2] = CANON_HINTS[kind];
        return `<section class="dooms-canon-section" data-kind="${kind}">
            <div class="dooms-inv-head"><span class="dooms-inv-label">${CANON_ICONS[kind]} ${KIND_LABELS[kind]}</span><span class="dooms-inv-fill" title="Lines of this kind">${mine.length}</span></div>
            ${mine.map(canonLine).join('')}
            <div class="dooms-canon-line is-new" data-kind="${kind}">
                <span class="dooms-canon-name" contenteditable="true" spellcheck="false" data-canon-new="name" data-kind="${kind}" data-placeholder="${ph1}"></span>
                <span class="dooms-canon-text" contenteditable="true" spellcheck="false" data-canon-new="text" data-kind="${kind}" data-placeholder="${ph2}"></span>
                <span class="dooms-canon-tools"><button type="button" class="dooms-canon-btn" data-canon-act="add" data-kind="${kind}" title="Add this line (yours: pinned, never rewritten)"><i class="fa-solid fa-plus"></i></button></span>
            </div>
        </section>`;
    }).join('');
    return `<div class="dooms-pb-page-inner dooms-pb-page-canon">
        <div class="dooms-canon-head">
            <span class="dooms-world-muted">${s.entries.length} line${s.entries.length === 1 ? '' : 's'}. ${last} Next run in ${s.retryNext ? 'the next reply' : `${next} repl${next === 1 ? 'y' : 'ies'}`}. ${err}</span>
            <div class="dooms-canon-actions">
                <button type="button" class="rpg-accordion-action-btn" data-canon-act="update"${isUpdating() ? ' disabled' : ''} title="A run now (the same as /canon)"><i class="fa-solid ${isUpdating() ? 'fa-spinner fa-spin' : 'fa-forward'}"></i> ${isUpdating() ? 'Running…' : 'Update now'}</button>
                <button type="button" class="rpg-accordion-action-btn" data-canon-act="export" title="The ledger as the lorebook &quot;${escapeHtml(canonBookName())}&quot;, one entry per line"><i class="fa-solid fa-book-atlas"></i> To a lorebook</button>
                <button type="button" class="rpg-accordion-action-btn" data-canon-act="markdown" title="The ledger as a Markdown file"><i class="fa-solid fa-download"></i> Download</button>
            </div>
        </div>
        <p class="dooms-world-muted dooms-canon-hint">What the story has established, one line each, kept by a quiet request every ${cfg.every} repl${cfg.every === 1 ? 'y' : 'ies'} and told to the narrator each turn. Click a line to change it; a line you write or change is pinned (📌) and no run rewrites or drops it.</p>
        ${sections}
    </div>`;
}

/** The Quests page: the main quest, then the optional ones, each a box. */
export function questsPageHtml() {
    const q = extensionSettings.quests && typeof extensionSettings.quests === 'object' ? extensionSettings.quests : {};
    const main = questText(q.main);
    const hasMain = !!main && main !== 'None';
    const optional = (Array.isArray(q.optional) ? q.optional : [])
        .map((entry, i) => ({ text: questText(entry), i }))
        .filter(x => x.text && x.text !== 'None');
    return `<div class="dooms-pb-page-inner dooms-pb-page-quests">
        <section class="dooms-quest-section" data-field="main">
            <div class="dooms-inv-head"><span class="dooms-inv-label">⭐ Main quest</span></div>
            <div class="dooms-quest-grid">${hasMain ? questBox('main', null, main, true) : '<button type="button" class="dooms-quest-box is-empty is-main" data-add="main">+ Set the main quest</button>'}</div>
        </section>
        <section class="dooms-quest-section" data-field="optional">
            <div class="dooms-inv-head"><span class="dooms-inv-label">📜 Optional quests</span><span class="dooms-inv-fill">${optional.length}</span></div>
            <div class="dooms-quest-grid">${optional.map(x => questBox('optional', x.i, x.text, false)).join('')}<button type="button" class="dooms-quest-box is-empty" data-add="optional">+ Add a quest</button></div>
        </section>
    </div>`;
}

function writeQuests(mutate) {
    if (!extensionSettings.quests || typeof extensionSettings.quests !== 'object') extensionSettings.quests = { main: 'None', optional: [] };
    if (!Array.isArray(extensionSettings.quests.optional)) extensionSettings.quests.optional = [];
    mutate(extensionSettings.quests);
    try { syncQuestsToCommittedData(); } catch (e) { /* no tracker data yet */ }
    try { saveSettings(); } catch (e) { /* non-fatal */ }
    try { saveChatData(); } catch (e) { /* no chat open */ }
    try { renderQuests(); } catch (e) { /* no sidebar */ }
    forceRerender();
}

/** A quest added from outside the page (a hook taken in the Map window, docs/hooks-canon-plan.md D102): onto the optional list, once. */
export function addOptionalQuest(text) {
    const t = String(text || '').replace(/\s+/g, ' ').trim();
    if (!t || t === 'None') return false;
    let added = false;
    writeQuests(q => { if (!q.optional.some(x => questText(x) === t)) { q.optional.push(t); added = true; } });
    return added;
}

/** Drops the page's render cache so the next shelf render rebuilds it. */
function forceRerender() {
    const el = document.getElementById(PAGE_ID);
    if (el) delete el.dataset.html;
    updatePortraitBar();
}

function removeQuest(field, index) {
    writeQuests(q => {
        // Completed, so recorded for the Map window's Completed quests (docs/map-window-plan.md D86), then removed.
        const text = field === 'main' ? questText(q.main) : (index !== undefined && index !== null && index !== '' ? questText(q.optional[Number(index)]) : '');
        try { recordCompletedQuest(text); } catch (e) { /* the list is the shelf's; the record is a courtesy */ }
        if (field === 'main') q.main = 'None';
        else if (index !== undefined && index !== null && index !== '') q.optional.splice(Number(index), 1);
    });
}

function startNewQuest(btn) {
    const field = btn.dataset.add === 'main' ? 'main' : 'optional';
    const box = document.createElement('div');
    box.className = `dooms-quest-box is-new${field === 'main' ? ' is-main' : ''}`;
    box.dataset.field = field;
    box.innerHTML = `<div class="dooms-quest-text" contenteditable="true" spellcheck="false" data-field="${field}" data-new="1" data-placeholder="${field === 'main' ? 'The main quest' : 'A side quest'}"></div>`;
    btn.replaceWith(box);
    box.firstElementChild.focus();
}

function finishQuestEdit(el) {
    const cancel = el.dataset.cancel === '1';
    delete el.dataset.cancel;
    const text = String(el.textContent || '').replace(/\s+/g, ' ').trim();
    const field = el.dataset.field === 'main' ? 'main' : 'optional';
    const isNew = el.dataset.new === '1';
    const index = el.dataset.index !== undefined ? Number(el.dataset.index) : null;
    if (cancel || !text) { forceRerender(); return; }
    const q = extensionSettings.quests || {};
    let wrote = false;
    if (isNew) {
        writeQuests(d => { if (field === 'main') d.main = text; else d.optional.push(text); });
        wrote = true;
        // The rebuild may wait while another box has focus: make this box
        // an ordinary edit box now, so a later blur edits rather than adds again.
        delete el.dataset.new;
        if (field === 'optional') el.dataset.index = String(((extensionSettings.quests || {}).optional || []).length - 1);
        el.parentElement?.classList.remove('is-new');
    } else if (field === 'main') {
        if (questText(q.main) !== text) { writeQuests(d => { d.main = text; }); wrote = true; }
    } else if (index !== null && Number.isInteger(index)) {
        if (questText(Array.isArray(q.optional) ? q.optional[index] : '') !== text) { writeQuests(d => { d.optional[index] = text; }); wrote = true; }
    }
    // Nothing written, but a rebuild was owed (skipped while this box had focus): do it now.
    if (!wrote) {
        const c = document.getElementById(PAGE_ID);
        if (c && !c.dataset.html) updatePortraitBar();
    }
}

// ─── The item editor ────────────────────────────────────────────────────────

let editor = null;

function closeEditor() {
    if (!editor) return;
    editor.el.remove();
    document.removeEventListener('mousedown', editor.onDown, true);
    document.removeEventListener('touchstart', editor.onDown, true);
    document.removeEventListener('keydown', editor.onKey, true);
    window.removeEventListener('resize', editor.onResize);
    editor = null;
    try { closeEmojiPicker(); } catch (e) { /* none open */ }
}

function positionEditor(el, anchor) {
    const r = anchor.getBoundingClientRect();
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const left = Math.max(8, Math.min(r.left, vw - w - 8));
    let top = r.bottom + 6;
    if (top + h > vh - 8) top = Math.max(8, r.top - h - 6);
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
}

function openEditor(anchor, { mode, container, name }) {
    closeEditor();
    const stack = mode === 'edit' ? findStack(getInventoryState(), container, name) : null;
    if (mode === 'edit' && !stack) { forceRerender(); return; }
    const other = container === 'pouch' ? 'pack' : 'pouch';
    const icon = stack ? stack.icon : '📦';
    const auto = !stack || stack.icon === iconFor(stack.name);
    const el = document.createElement('div');
    el.id = EDITOR_ID;
    el.className = 'dooms-inv-editor';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', mode === 'add' ? 'Add an item' : 'Edit an item');
    el.innerHTML = `
        <div class="dooms-inv-editor-title">${mode === 'add' ? 'Add to' : 'In'} ${escapeHtml(containerLabel(container))}</div>
        <div class="dooms-inv-editor-row">
            <button type="button" class="dooms-inv-editor-icon" title="Pick an icon" data-icon="${escapeHtml(icon)}">${escapeHtml(icon)}</button>
            <input type="text" class="dooms-inv-editor-name" placeholder="Item" maxlength="${MAX_NAME}" value="${escapeHtml(stack ? stack.name : '')}" autocomplete="off" />
        </div>
        <div class="dooms-inv-editor-row">
            <label>Count <input type="number" class="dooms-inv-editor-count" min="1" max="${MAX_COUNT}" step="1" inputmode="numeric" value="${stack ? stack.count : 1}" /></label>
            <label class="dooms-inv-editor-auto-label" title="Let DES pick the icon from the name"><input type="checkbox" class="dooms-inv-editor-auto"${auto ? ' checked' : ''} /> Auto icon</label>
        </div>
        <div class="dooms-inv-editor-row">
            <input type="text" class="dooms-inv-editor-note" placeholder="Note (optional)" maxlength="${MAX_NOTE}" value="${escapeHtml(stack ? stack.note : '')}" autocomplete="off" />
        </div>
        <div class="dooms-inv-editor-actions">
            ${stack ? `<label>Move <input type="number" class="dooms-inv-editor-move-n" min="1" max="${stack.count}" step="1" inputmode="numeric" value="${stack.count}" /></label>
            <button type="button" class="dooms-inv-btn" data-act="move" title="Move to the ${other === 'pouch' ? 'party pouch' : 'pack'}">to ${other}</button>
            <button type="button" class="dooms-inv-btn is-danger" data-act="remove" title="Take it out">Remove</button>` : ''}
            <span class="dooms-inv-editor-spacer"></span>
            <button type="button" class="dooms-inv-btn" data-act="cancel">Cancel</button>
            <button type="button" class="dooms-inv-btn is-primary" data-act="save">${mode === 'add' ? 'Add' : 'Save'}</button>
        </div>`;
    document.body.appendChild(el);
    const q = (sel) => el.querySelector(sel);
    const nameIn = q('.dooms-inv-editor-name');
    const countIn = q('.dooms-inv-editor-count');
    const noteIn = q('.dooms-inv-editor-note');
    const iconBtn = q('.dooms-inv-editor-icon');
    const autoIn = q('.dooms-inv-editor-auto');
    const refreshIcon = () => {
        if (!autoIn.checked) return;
        const i = iconFor(nameIn.value.trim());
        iconBtn.textContent = i;
        iconBtn.dataset.icon = i;
    };
    refreshIcon();
    nameIn.addEventListener('input', refreshIcon);
    autoIn.addEventListener('change', refreshIcon);
    iconBtn.addEventListener('click', (e) => {
        e.preventDefault();
        openEmojiPicker(iconBtn, (emoji) => {
            if (!emoji) return;
            iconBtn.textContent = emoji;
            iconBtn.dataset.icon = emoji;
            autoIn.checked = false;
        });
    });
    const save = () => {
        const newName = nameIn.value.trim();
        if (!newName) { toast('warning', 'Give it a name.'); nameIn.focus(); return; }
        const count = Math.max(1, Math.min(MAX_COUNT, Math.round(Number(countIn.value)) || 1));
        const note = noteIn.value.trim();
        const iconNow = autoIn.checked ? iconFor(newName) : (iconBtn.dataset.icon || iconFor(newName));
        let r;
        if (stack) {
            r = editStack(container, stack.name, { name: newName, count, note, icon: iconNow });
        } else {
            // Adding a kind already carried adds to it rather than replacing the count.
            const existing = findStack(getInventoryState(), container, newName);
            r = editStack(container, newName, {
                name: newName,
                count: existing ? Math.min(MAX_COUNT, existing.count + count) : count,
                note: note || (existing ? existing.note : ''),
                icon: iconNow,
            });
        }
        if (!r || !r.ok) { toast('warning', reasonText(r && r.reason, container)); return; }
        closeEditor();
        forceRerender();
    };
    el.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-act]');
        if (!btn) return;
        e.preventDefault();
        const act = btn.dataset.act;
        if (act === 'cancel') { closeEditor(); return; }
        if (act === 'save') { save(); return; }
        if (act === 'remove' && stack) {
            const r = removeStack(container, stack.name);
            if (!r.ok) toast('warning', reasonText(r.reason, container));
            closeEditor();
            forceRerender();
            return;
        }
        if (act === 'move' && stack) {
            const n = Math.max(1, Math.min(stack.count, Math.round(Number(q('.dooms-inv-editor-move-n').value)) || stack.count));
            const r = moveItem(stack.name, container, other, n);
            if (!r.ok) { toast('warning', reasonText(r.reason, other)); return; }
            closeEditor();
            forceRerender();
        }
    });
    el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && e.target.tagName === 'INPUT' && e.target.type !== 'checkbox') { e.preventDefault(); save(); }
        else if (e.key === 'Escape') { e.preventDefault(); closeEditor(); }
        e.stopPropagation();
    });
    const onDown = (e) => {
        if (el.contains(e.target)) return;
        if (e.target && typeof e.target.closest === 'function' && e.target.closest('.rpg-emoji-picker')) return;
        closeEditor();
    };
    const onKey = (e) => {
        // The emoji picker closes itself on Escape; the editor goes on the next one.
        if (e.key === 'Escape' && !document.querySelector('.rpg-emoji-picker')) closeEditor();
    };
    const onResize = () => positionEditor(el, anchor);
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('touchstart', onDown, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', onResize);
    editor = { el, onDown, onKey, onResize };
    positionEditor(el, anchor);
    // Only auto-focus on desktop: on a phone this would raise the keyboard at once.
    if (window.innerWidth > 1000) nameIn.focus();
}

// ─── Cut to a quest: the menu on a box ──────────────────────────────────────
//
// Right-click or a long press on a quest box: Cut to it (the next reply is a
// montage up to the quest and its opening beat; the quest becomes the main
// quest), Cut to it, when… (the same with a time the player names), Make it
// the main quest, Complete. The menu is the shelf's own menu, styled alike.

let questMenu = null;    // { el, field, index, expected, onDown, onKey }
let whenDialog = null;   // { el, onDown, onKey }

/** A rebuild the page owed while a menu or dialog was open happens once it closes. */
function rebuildIfOwed() {
    const c = document.getElementById(PAGE_ID);
    if (c && !c.dataset.html) updatePortraitBar();
}

function closeQuestMenu() {
    if (!questMenu) return;
    questMenu.el.remove();
    document.removeEventListener('mousedown', questMenu.onDown, true);
    document.removeEventListener('touchstart', questMenu.onDown, true);
    document.removeEventListener('keydown', questMenu.onKey, true);
    window.removeEventListener('scroll', closeQuestMenu, true);
    questMenu = null;
    rebuildIfOwed();
}

/** Commits an edit still open in a quest box, so an action reads the list as the player sees it. */
function commitOpenQuestEdit() {
    const a = document.activeElement;
    if (a && a.classList && a.classList.contains('dooms-quest-text') && inPage(a)) a.blur();
}

function placeAt(el, x, y) {
    el.style.left = '-9999px';
    el.style.top = '-9999px';
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    el.style.left = `${Math.max(0, Math.min(x, window.innerWidth - w - 4))}px`;
    el.style.top = `${Math.max(0, Math.min(y, window.innerHeight - h - 4))}px`;
}

function openQuestMenu(box, x, y) {
    closeQuestMenu();
    closeWhenDialog();
    const field = box.dataset.field === 'main' ? 'main' : 'optional';
    const index = box.dataset.index !== undefined ? Number(box.dataset.index) : null;
    // The quest as shown: an action checks the list still has it at that place.
    const expected = questText(box.querySelector('.dooms-quest-text')?.textContent || '');
    const el = document.createElement('div');
    el.id = QUEST_MENU_ID;
    el.className = 'dooms-pb-context-menu dooms-quest-menu';
    el.setAttribute('role', 'menu');
    el.innerHTML = `
        <div class="dooms-quest-menu-item" data-act="cut" role="menuitem" title="The next reply skips ahead: a short montage up to this quest, then its opening beat. It becomes the main quest."><i class="fa-solid fa-clapperboard"></i> Cut to it</div>
        <div class="dooms-quest-menu-item" data-act="cut-when" role="menuitem" title="The same, beginning when you say"><i class="fa-regular fa-clock"></i> Cut to it, when…</div>
        <div class="dooms-pb-ctx-divider"></div>
        ${field === 'main' ? '' : '<div class="dooms-quest-menu-item" data-act="promote" role="menuitem" title="Move it to the main quest; the main quest drops to the optional list"><i class="fa-solid fa-star"></i> Make it the main quest</div>'}
        <div class="dooms-quest-menu-item" data-act="complete" role="menuitem" title="Complete and remove"><i class="fa-solid fa-check"></i> Complete</div>`;
    document.body.appendChild(el);
    placeAt(el, x, y);
    // Pressing an item must not blur a quest text being edited; the action commits it first.
    el.addEventListener('mousedown', (e) => e.preventDefault());
    el.addEventListener('click', (e) => {
        const item = e.target.closest('[data-act]');
        if (!item) return;
        e.preventDefault();
        e.stopPropagation();
        const act = item.dataset.act;
        closeQuestMenu();
        commitOpenQuestEdit();
        if (act === 'cut') cutToQuest(field, index, '', expected);
        else if (act === 'cut-when') openWhenDialog(box, field, index, expected);
        else if (act === 'promote') promoteToMain(field, index, expected);
        else if (act === 'complete') removeQuest(field, index);
    });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    const onDown = (e) => { if (!el.contains(e.target)) closeQuestMenu(); };
    const onKey = (e) => { if (e.key === 'Escape') closeQuestMenu(); };
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('touchstart', onDown, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('scroll', closeQuestMenu, true);
    questMenu = { el, field, index, expected, onDown, onKey };
}

/** The quest at this place in the list, or '' when the list changed under the menu. */
function questStillThere(r, expected) {
    if (!r.quest) return '';
    if (expected && r.quest !== expected) return '';
    return r.quest;
}

function promoteToMain(field, index, expected) {
    const r = promoteQuest(extensionSettings.quests, field, index);
    if (!questStillThere(r, expected)) { toast('warning', 'The quests changed under the menu; try again.'); forceRerender(); return; }
    if (!r.changed) return;
    writeQuests(d => { d.main = r.quests.main; d.optional = r.quests.optional; });
}

/** The cut: the quest becomes the main quest, then the reply is asked for. */
function cutToQuest(field, index, when, expected) {
    const r = promoteQuest(extensionSettings.quests, field, index);
    if (!questStillThere(r, expected)) {
        toast('warning', r.quest ? 'The quests changed under the menu; try again.' : 'There is no quest there to cut to.');
        forceRerender();
        return;
    }
    if (r.changed) writeQuests(d => { d.main = r.quests.main; d.optional = r.quests.optional; });
    startQuestCut({ quest: r.quest, when }).catch(err => console.error('[Dooms Tracker] Quest cut failed:', err));
}

function closeWhenDialog() {
    if (!whenDialog) return;
    whenDialog.el.remove();
    document.removeEventListener('mousedown', whenDialog.onDown, true);
    document.removeEventListener('touchstart', whenDialog.onDown, true);
    document.removeEventListener('keydown', whenDialog.onKey, true);
    whenDialog = null;
    rebuildIfOwed();
}

function openWhenDialog(box, field, index, expected) {
    closeWhenDialog();
    const el = document.createElement('div');
    el.id = WHEN_ID;
    el.className = 'dooms-inv-editor dooms-quest-when';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', 'Cut to it, when');
    el.innerHTML = `
        <div class="dooms-inv-editor-title">When does it begin?</div>
        <div class="dooms-inv-editor-row"><input type="text" class="dooms-quest-when-input" placeholder="by nightfall · after the thaw · next market day" maxlength="80" autocomplete="off" /></div>
        <div class="dooms-inv-editor-actions">
            <span class="dooms-inv-editor-spacer"></span>
            <button type="button" class="dooms-inv-btn" data-act="cancel">Cancel</button>
            <button type="button" class="dooms-inv-btn is-primary" data-act="go"><i class="fa-solid fa-clapperboard"></i> Cut</button>
        </div>`;
    document.body.appendChild(el);
    positionEditor(el, box);
    const input = el.querySelector('.dooms-quest-when-input');
    const go = () => {
        const when = input.value.trim();
        closeWhenDialog();
        cutToQuest(field, index, when, expected);
    };
    el.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-act]');
        if (!btn) return;
        e.preventDefault();
        if (btn.dataset.act === 'go') go();
        else closeWhenDialog();
    });
    el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); go(); }
        else if (e.key === 'Escape') { e.preventDefault(); closeWhenDialog(); }
        e.stopPropagation();
    });
    const onDown = (e) => { if (!el.contains(e.target)) closeWhenDialog(); };
    const onKey = (e) => { if (e.key === 'Escape') closeWhenDialog(); };
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('touchstart', onDown, true);
    document.addEventListener('keydown', onKey, true);
    whenDialog = { el, onDown, onKey };
    if (window.innerWidth > 1000) input.focus();
}

// ─── Wiring and render ──────────────────────────────────────────────────────

let bound = false;

function inPage(target) {
    return target && typeof target.closest === 'function' ? target.closest(`#${PAGE_ID}`) : null;
}

function bindOnce() {
    if (bound || typeof document === 'undefined') return;
    bound = true;
    document.addEventListener('click', (e) => {
        if (!inPage(e.target)) return;
        const canonAct = e.target.closest('[data-canon-act]');
        if (canonAct) {
            e.preventDefault();
            e.stopPropagation();
            canonAction(canonAct);
            return;
        }
        const slot = e.target.closest('.dooms-inv-slot');
        if (slot) {
            e.preventDefault();
            e.stopPropagation();
            const container = slot.dataset.container === 'pouch' ? 'pouch' : 'pack';
            if (slot.classList.contains('is-empty')) openEditor(slot, { mode: 'add', container });
            else openEditor(slot, { mode: 'edit', container, name: slot.dataset.name });
            return;
        }
        const done = e.target.closest('.dooms-quest-done');
        if (done) {
            e.preventDefault();
            e.stopPropagation();
            removeQuest(done.dataset.field, done.dataset.index);
            return;
        }
        const add = e.target.closest('[data-add]');
        if (add) {
            e.preventDefault();
            e.stopPropagation();
            startNewQuest(add);
            return;
        }
    });
    document.addEventListener('focusout', (e) => {
        const t = e.target;
        if (!t || !t.classList || !inPage(t)) return;
        if (t.dataset && t.dataset.canonField) { finishCanonEdit(t); return; }
        if (!t.classList.contains('dooms-quest-text')) return;
        finishQuestEdit(t);
    });
    window.addEventListener(CANON_CHANGED_EVENT, () => {
        // the page follows the ledger, unless a line is being typed (the rebuild then waits for the blur)
        const c = document.getElementById(PAGE_ID);
        if (!c || c.hidden) return;
        const active = document.activeElement;
        if (active && c.contains(active) && active.isContentEditable) { delete c.dataset.html; return; }
        forceRerender();
    });
    // The quest menu: right-click, or a long press on a phone.
    const questBoxOf = (target) => {
        if (!inPage(target)) return null;
        const box = target.closest('.dooms-quest-box');
        return box && !box.classList.contains('is-empty') && !box.classList.contains('is-new') ? box : null;
    };
    let press = null;
    let longPressed = false;
    const endPress = () => { if (press) { clearTimeout(press.timer); press = null; } };
    document.addEventListener('contextmenu', (e) => {
        endPress();
        const box = questBoxOf(e.target);
        if (!box) return;
        // Inside a quest text being edited the browser's own menu (paste, spelling) stays.
        const txt = e.target.closest('.dooms-quest-text');
        if (txt && document.activeElement === txt) return;
        e.preventDefault();
        e.stopPropagation();
        openQuestMenu(box, e.clientX, e.clientY);
    });
    document.addEventListener('touchstart', (e) => {
        const box = questBoxOf(e.target);
        if (!box || e.touches.length !== 1) return;
        const t = e.touches[0];
        press = { box, x: t.clientX, y: t.clientY, timer: setTimeout(() => { press = null; longPressed = true; openQuestMenu(box, t.clientX, t.clientY); }, 550) };
    }, { passive: true });
    document.addEventListener('touchmove', (e) => {
        if (!press || e.touches.length !== 1) return;
        const t = e.touches[0];
        if (Math.abs(t.clientX - press.x) > 8 || Math.abs(t.clientY - press.y) > 8) endPress();
    }, { passive: true });
    // After a long press the finger may rest over the menu that just opened:
    // the click Safari makes of that touch would pick an item. Cancelling the
    // touchend stops it; the other touch listeners stay passive for scrolling.
    document.addEventListener('touchend', (e) => {
        if (longPressed) {
            longPressed = false;
            if (e.cancelable) e.preventDefault();
        }
        endPress();
    }, { passive: false });
    document.addEventListener('touchcancel', () => { longPressed = false; endPress(); }, { passive: true });
    document.addEventListener('keydown', (e) => {
        const t = e.target;
        if (!t || !t.classList || !t.classList.contains('dooms-quest-text') || !inPage(t)) return;
        if (e.key === 'Enter') { e.preventDefault(); t.blur(); }
        else if (e.key === 'Escape') { e.preventDefault(); t.dataset.cancel = '1'; t.blur(); }
        e.stopPropagation();
    });
}

/**
 * Renders a page into the shelf's page container. Skips the DOM when the
 * markup is unchanged, and never pulls a box out from under an edit.
 * @param {'inventory'|'quests'} page
 * @param {HTMLElement} container - #dooms-pb-page
 */
export function renderShelfPage(page, container) {
    if (!container) return;
    bindOnce();
    const html = page === 'inventory' ? inventoryPageHtml() : page === 'quests' ? questsPageHtml() : page === 'canon' ? canonPageHtml() : '';
    if (container.dataset.html === html) return;
    const active = document.activeElement;
    if (active && container.contains(active) && (active.isContentEditable || active.tagName === 'INPUT')) return;
    // A menu or dialog over a box keeps its box until it closes (then rebuildIfOwed).
    if (questMenu || whenDialog) return;
    if (editor) closeEditor();
    container.dataset.html = html;
    container.innerHTML = html;
}
