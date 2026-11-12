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
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const GAP = 50;     // the list's edge nearest the button, measured from the button's far edge (style.css: bottom / top: 50px)
const EDGE = 8;     // what is left clear at the edge of the screen
const LEAST = 132;  // a list is never squeezed below about three entries

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
 * @returns {{ open: () => void, close: () => void, isOpen: () => boolean, element: HTMLElement }}
 */
export function mountFabMenu(fabEl, { items }) {
    const list = document.createElement('ul');
    list.className = 'dooms-fab-menu';
    list.setAttribute('role', 'menu');
    fabEl.appendChild(list);
    let rows = [];
    let isOpen = false;
    let armed = 0;

    /** Up or down, by which side of the button has the room; taller than that room, the list scrolls inside it. */
    function place() {
        list.classList.remove('is-scroll');
        list.style.maxHeight = '';
        const rect = fabEl.getBoundingClientRect();
        const above = rect.bottom - GAP - EDGE;
        const below = window.innerHeight - rect.top - GAP - EDGE;
        const need = list.scrollHeight;
        const direction = above < need && below > above ? 'down' : 'up';
        list.setAttribute('data-direction', direction);
        const room = Math.max(LEAST, direction === 'up' ? above : below);
        const lis = Array.from(list.children);
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

    const onDown = (ev) => { if (!fabEl.contains(ev.target)) close(); };
    const onKey = (ev) => { if (ev.key === 'Escape') close(); };

    function close() {
        isOpen = false;
        armed++;
        list.classList.remove('open', 'is-sub');
        fabEl.classList.remove('dooms-fab-open');
        document.removeEventListener('mousedown', onDown);
        document.removeEventListener('keydown', onKey);
    }

    function open() {
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
        if (btn.disabled) return;
        if (btn.hasAttribute('data-back')) { show(items()); return; }
        const row = rows[Number(btn.getAttribute('data-row'))];
        if (!row) return;
        if (typeof row.children === 'function') { show(row.children(), { back: true }); return; }
        close();
        if (typeof row.action === 'function') row.action();
    });

    return { open, close, isOpen: () => isOpen, element: list };
}
