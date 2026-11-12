/**
 * The Doom button's fly-out (docs/long-shot-plan.md D200): the list that
 * opens from the D button. An entry is a button that does something, or
 * one that opens to a list of its own (the scene in front: which scene it
 * is, Continue fresh, End scene), which takes the fly-out's place with a
 * Back row; a line that is only read is a note. However many entries
 * there are, the list stays on the screen: it opens to the side of the
 * button with more room and scrolls when it is taller than that room.
 *
 * Plain DOM, no jQuery: index.js mounts it in the button and hands it the
 * entries each time it opens, so the list is always what the host shows.
 *
 * A row:
 *   { id, label, iconClass, action, title?, disabled?, lit?, children? }
 *   { note, sub?, warn? }       a line to read, not to press
 */
import { knockCounter, isTap } from '../../utils/knock.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const GAP = 50;     // the list's edge nearest the button, measured from the button's far edge (style.css: bottom / top: 50px)
const EDGE = 8;     // what is left clear at the edge of the screen
const LEAST = 132;  // a list is never squeezed below about three entries
const SIDE = 10;    // where the list stands from the left edge of the screen when there is no button to hang from

/** The rows as list items. `back` puts the way back to the fly-out last, nearest the button of a list that opens upward. */
export function fabMenuHtml(rows, { back = false } = {}) {
    const list = (Array.isArray(rows) ? rows : []).map((r, i) => {
        if (!r || typeof r !== 'object') return '';
        if (r.note !== undefined) return `<li class="dooms-fab-menu-note${r.warn ? ' is-warn' : ''}" role="presentation"><span class="dooms-fab-menu-note-line">${esc(r.note)}</span>${r.sub ? `<span class="dooms-fab-menu-note-sub">${esc(r.sub)}</span>` : ''}</li>`;
        const more = typeof r.children === 'function';
        return `<li><button type="button" class="dooms-fab-menu-item${r.lit ? ' is-lit' : ''}${more ? ' has-more' : ''}" role="menuitem" data-row="${i}" data-action="${esc(r.id || '')}"${r.title ? ` title="${esc(r.title)}"` : ''}${more ? ' aria-haspopup="menu"' : ''}${r.disabled ? ' disabled' : ''}><i class="${esc(r.iconClass || 'fa-solid fa-square')}" aria-hidden="true"></i><span>${esc(r.label)}</span>${more ? '<i class="fa-solid fa-chevron-right dooms-fab-menu-more" aria-hidden="true"></i>' : ''}</button></li>`;
    });
    if (back) list.push('<li><button type="button" class="dooms-fab-menu-item is-back" role="menuitem" data-back="1"><i class="fa-solid fa-chevron-left" aria-hidden="true"></i><span>Back</span></button></li>');
    return list.join('');
}

/**
 * The fly-out mounted in the Doom button.
 * @param {HTMLElement} fabEl          the button's box (#dooms-settings-fab)
 * @param {{ items: () => object[] }} o   the entries, asked for each time the fly-out opens
 * @returns {{ open: (o?: { guardMs?: number }) => void, close: () => void, isOpen: () => boolean, element: HTMLElement }}
 */
export function mountFabMenu(fabEl, { items }) {
    const list = document.createElement('ul');
    list.className = 'dooms-fab-menu';
    list.setAttribute('role', 'menu');
    fabEl.appendChild(list);
    let rows = [];
    let isOpen = false;
    let armed = 0;
    let deafUntil = 0;    // a list opened by a knock does not take the press that opened it for a press of its own

    /** Up or down, by which side of the button has the room; taller than that room, the list scrolls inside it. */
    function place() {
        list.classList.remove('is-scroll');
        list.style.maxHeight = '';
        list.style.left = '';
        list.style.top = '';
        list.style.bottom = '';
        const lis = Array.from(list.children);
        // No button on the screen (the knock's menu mode, D201): the list stands at the left edge of the screen, in the
        // middle of its height, wherever the button was left. Set from the button's own box, which is what it hangs in.
        if (fabEl.classList.contains('dooms-fab-nobutton')) {
            const box = fabEl.getBoundingClientRect();
            const room = Math.max(LEAST, window.innerHeight - EDGE * 2);
            list.setAttribute('data-direction', 'side');
            if (list.scrollHeight > room) { list.classList.add('is-scroll'); list.style.maxHeight = `${room}px`; }
            const high = Math.min(list.scrollHeight, room);
            list.style.left = `${SIDE - box.left}px`;
            list.style.top = `${Math.max(EDGE, Math.round((window.innerHeight - high) / 2)) - box.top}px`;
            list.style.bottom = 'auto';
            lis.forEach((li, idx) => { li.style.transitionDelay = `${Math.min(idx, 8) * 0.03}s`; });
            list.scrollTop = 0;
            return;
        }
        const rect = fabEl.getBoundingClientRect();
        const above = rect.bottom - GAP - EDGE;
        const below = window.innerHeight - rect.top - GAP - EDGE;
        const need = list.scrollHeight;
        const direction = above < need && below > above ? 'down' : 'up';
        list.setAttribute('data-direction', direction);
        const room = Math.max(LEAST, direction === 'up' ? above : below);
        // The entry nearest the button comes in first; a long list does not wait on its far end.
        lis.forEach((li, idx) => { li.style.transitionDelay = `${Math.min(direction === 'up' ? lis.length - 1 - idx : idx, 8) * 0.04}s`; });
        if (need > room) {
            list.classList.add('is-scroll');
            list.style.maxHeight = `${room}px`;
            list.scrollTop = direction === 'up' ? list.scrollHeight : 0;    // the end nearest the button is the one in view
        }
    }

    function show(next, { back = false } = {}) {
        rows = Array.isArray(next) ? next : [];
        list.innerHTML = fabMenuHtml(rows, { back });
        list.classList.toggle('is-sub', back);
        place();
    }

    // A press outside closes the list. Not the press that opened it: on a touch screen the browser sends that tap's
    // mouse events after the knock has already opened the list.
    const onDown = (ev) => { if (Date.now() < deafUntil) return; if (!fabEl.contains(ev.target)) close(); };
    const onKey = (ev) => { if (ev.key === 'Escape') close(); };

    function close() {
        isOpen = false;
        armed++;
        list.classList.remove('open', 'is-sub');
        fabEl.classList.remove('dooms-fab-open');
        document.removeEventListener('mousedown', onDown);
        document.removeEventListener('keydown', onKey);
    }

    function open({ guardMs = 0 } = {}) {
        deafUntil = guardMs > 0 ? Date.now() + guardMs : 0;
        show(items());
        list.classList.add('open');
        fabEl.classList.add('dooms-fab-open');
        isOpen = true;
        const mine = ++armed;
        // After this turn: the press that opened the fly-out is not the press outside that closes it.
        setTimeout(() => {
            if (!isOpen || mine !== armed) return;
            document.addEventListener('mousedown', onDown);
            document.addEventListener('keydown', onKey);
        }, 0);
    }

    list.addEventListener('click', (ev) => {
        const btn = ev.target && ev.target.closest ? ev.target.closest('.dooms-fab-menu-item') : null;
        if (!btn || !list.contains(btn)) return;
        ev.stopPropagation();
        if (!isOpen || btn.disabled || Date.now() < deafUntil) return;    // a list that is closed keeps its rows, and they do nothing
        if (btn.hasAttribute('data-back')) { show(items()); return; }
        const row = rows[Number(btn.getAttribute('data-row'))];
        if (!row) return;
        if (typeof row.children === 'function') { show(row.children(), { back: true }); return; }
        close();
        if (typeof row.action === 'function') row.action();
    });

    return { open, close, isOpen: () => isOpen, element: list };
}

/** Where a tap is a press of something, not a knock on the screen. */
const NOT_A_KNOCK = 'button, a, input, textarea, select, option, label, summary, [contenteditable=""], [contenteditable="true"], [role="button"], [role="menuitem"], [role="tab"], [role="slider"], [data-act], .mes_button, .swipe_left, .swipe_right, .drawer-icon, .menu_button, .interactable, #send_form, #dooms-settings-fab, '
    // nor is a tap in a window of its own: the Atlas's map is tapped quickly for its own reasons, and a dialog's taps are the dialog's
    + '#dooms-atlas, .leaflet-container, dialog, [role="dialog"], .popup, .drawer-content';

/**
 * The knock (docs/long-shot-plan.md D201): three quick taps in one spot
 * of the screen, for a screen with nothing on it but the story. What they
 * do is the player's choice:
 *   'button'  the Doom button is put away, and brought back by three more.
 *             Put away is not stored: a reload shows it again.
 *   'menu'    there is no button on the screen at all; the taps open its
 *             fly-out at the left edge of the screen, and three more (or
 *             a press outside it) close it.
 *   'off'     nothing.
 * A tap on a button, a link or a text box is not counted, nor is a scroll,
 * nor a triple click with a mouse that selected a paragraph. The button is
 * taken off the screen by this code and no other, so it is off only where
 * the knock is listening; `/des` in the message box opens the settings
 * whatever the screen shows.
 * @param {HTMLElement} fabEl
 * @param {{ mode: () => 'off'|'button'|'menu', menu?: { open: Function, close: Function, isOpen: Function }|null, onChange?: (hidden: boolean) => void }} o
 * @returns {{ isHidden: () => boolean, set: (hidden: boolean) => void, sync: () => void, destroy: () => void }}
 */
export function mountKnock(fabEl, { mode, menu = null, onChange = null }) {
    const counter = knockCounter();
    let down = null;
    let menuWasOpen = false;
    const now = () => { let m = 'off'; try { m = mode(); } catch (e) { m = 'off'; } return m === 'menu' || m === 'button' ? m : 'off'; };
    const isHidden = () => fabEl.classList.contains('dooms-fab-knocked');
    function set(hidden) {
        const want = !!hidden;
        if (want === isHidden()) return;
        fabEl.classList.toggle('dooms-fab-knocked', want);
        if (want) fabEl.setAttribute('aria-hidden', 'true'); else fabEl.removeAttribute('aria-hidden');
        try { if (typeof onChange === 'function') onChange(want); } catch (e) { /* the host's own business */ }
    }
    /** The mode as it stands, drawn: no button in 'menu', a button put away only in 'button'. */
    function sync() {
        const m = now();
        const was = fabEl.classList.contains('dooms-fab-nobutton');
        fabEl.classList.toggle('dooms-fab-nobutton', m === 'menu');
        if (was && m !== 'menu' && menu && menu.isOpen()) menu.close();    // a list standing at the screen's edge has no button to go back to
        if (m !== 'button') set(false);
        return m;
    }
    const onDown = (ev) => {
        sync();    // a setting changed since the last press is drawn before anything is counted
        down = ev.isPrimary === false || (ev.pointerType === 'mouse' && ev.button !== 0) ? null : { t: ev.timeStamp, x: ev.clientX, y: ev.clientY, id: ev.pointerId };
        // Whether the fly-out was open when the knock began: its first tap, outside the list, closes it, and the third must not open it again.
        if (down && counter.count() === 0) menuWasOpen = !!(menu && menu.isOpen());
    };
    const onUp = (ev) => {
        const d = down;
        down = null;
        if (!d || d.id !== ev.pointerId) return;
        const m = now();
        const el = ev.target && typeof ev.target.closest === 'function' ? ev.target : null;
        const up = { t: ev.timeStamp, x: ev.clientX, y: ev.clientY };
        if (m === 'off' || !el || !isTap(d, up) || el.closest(NOT_A_KNOCK)) { counter.reset(); return; }
        if (!counter.tap(up)) return;
        // Three clicks of a mouse on text select the paragraph: that was a selection, not a knock.
        if (ev.pointerType === 'mouse') { let picked = ''; try { picked = String(window.getSelection ? window.getSelection() : ''); } catch (e) { picked = ''; } if (picked.trim()) return; }
        if (m === 'menu') {
            if (!menu) return;
            if (menuWasOpen) menu.close(); else menu.open({ guardMs: 350 });    // the tap that opened it is still in the browser's hands: the list is deaf to it
            return;
        }
        set(!isHidden());
    };
    const onCancel = () => { down = null; };    // the browser took the press for a scroll
    const opts = { capture: true, passive: true };
    document.addEventListener('pointerdown', onDown, opts);
    document.addEventListener('pointerup', onUp, opts);
    document.addEventListener('pointercancel', onCancel, opts);
    sync();
    return {
        isHidden,
        set,
        sync,
        destroy() {
            document.removeEventListener('pointerdown', onDown, opts);
            document.removeEventListener('pointerup', onUp, opts);
            document.removeEventListener('pointercancel', onCancel, opts);
        },
    };
}
