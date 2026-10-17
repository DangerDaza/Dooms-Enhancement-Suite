/**
 * The shelf's pages (Project Short Fuse, Phase 5).
 *
 * With the inventory on, the Present Characters shelf flips between three
 * pages: Characters (the cards, rendered by portraitBar.js as always),
 * Inventory and Quests. This module renders the latter two into the shelf's
 * page container as boxes: square slots for the pack and the party pouch
 * (icon, count badge, name beneath, dashed empties), and quest boxes edited
 * in place. A slot opens a small editor (name, count, note, icon, move,
 * remove); an empty slot adds. Loaded the first time a page other than
 * Characters shows.
 */
import { extensionSettings } from '../../core/state.js';
import { saveSettings, saveChatData } from '../../core/persistence.js';
import { escapeHtml } from '../../utils/html.js';
import { MAX_COUNT, MAX_NAME, MAX_NOTE, findStack, iconFor, slotsFor } from '../../utils/inventory.js';
import { getInventoryState, getInventoryConfig, editStack, removeStack, moveItem } from '../features/inventory.js';
import { resolvePersonaName } from '../features/diceRolls.js';
import { renderQuests, syncQuestsToCommittedData } from '../rendering/quests.js';
import { openEmojiPicker, closeEmojiPicker } from './emojiPicker.js';
import { updatePortraitBar } from './portraitBar.js';

const PAGE_ID = 'dooms-pb-page';
const EDITOR_ID = 'dooms-inv-editor';

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

/** The text of a quest entry, which older chats may keep wrapped in an object. */
function questText(q) {
    let v = q;
    for (let guard = 0; v && typeof v === 'object' && guard < 5; guard++) {
        v = v.value !== undefined ? v.value : (v.title !== undefined ? v.title : '');
    }
    return String(v ?? '').trim();
}

function questBox(field, index, text, main) {
    const idx = index != null ? ` data-index="${index}"` : '';
    return `<div class="dooms-quest-box${main ? ' is-main' : ''}" data-field="${field}"${idx}>
        <div class="dooms-quest-text" contenteditable="true" spellcheck="false" data-field="${field}"${idx} title="Click to edit">${escapeHtml(text)}</div>
        <button type="button" class="dooms-quest-done" data-field="${field}"${idx} title="Complete and remove"><i class="fa-solid fa-check"></i></button>
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

/** Drops the page's render cache so the next shelf render rebuilds it. */
function forceRerender() {
    const el = document.getElementById(PAGE_ID);
    if (el) delete el.dataset.html;
    updatePortraitBar();
}

function removeQuest(field, index) {
    writeQuests(q => {
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
    if (isNew) {
        writeQuests(d => { if (field === 'main') d.main = text; else d.optional.push(text); });
    } else if (field === 'main') {
        if (questText(q.main) !== text) writeQuests(d => { d.main = text; });
    } else if (index !== null && Number.isInteger(index)) {
        if (questText(Array.isArray(q.optional) ? q.optional[index] : '') !== text) writeQuests(d => { d.optional[index] = text; });
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
        }
    });
    document.addEventListener('focusout', (e) => {
        const t = e.target;
        if (!t || !t.classList || !t.classList.contains('dooms-quest-text') || !inPage(t)) return;
        finishQuestEdit(t);
    });
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
    const html = page === 'inventory' ? inventoryPageHtml() : page === 'quests' ? questsPageHtml() : '';
    if (container.dataset.html === html) return;
    const active = document.activeElement;
    if (active && container.contains(active) && (active.isContentEditable || active.tagName === 'INPUT')) return;
    if (editor) closeEditor();
    container.dataset.html = html;
    container.innerHTML = html;
}
