/**
 * DES composer — SillyTavern's message box, re-hosted.
 *
 * SillyTavern wires its send form to the actual DOM nodes once at startup:
 * the click handlers are bound on #send_but and friends, the auto-grow code
 * keeps a module-level reference to #send_textarea, and the Options menu and
 * the extensions wand are anchored with Popper to their original buttons. A
 * lookalike with the same ids would therefore be a dead box. So DES keeps
 * every node SillyTavern made and moves it instead: the textarea becomes a
 * full-width tier of its own above a slim toolbar, and the two holders every
 * extension appends its buttons into (#leftSendForm, #rightSendForm) stay
 * the real holders, so those buttons land in the DES composer whether they
 * were added before or after it mounted.
 *
 * Buttons that are not SillyTavern's own are swept out of the holders into
 * an overflow tray behind a single "⋯" button, so the toolbar stays five
 * controls wide however many extensions are installed. Whole bars that an
 * extension hangs directly on the form (Guided Generations puts a row of
 * buttons there) ride in the tray too, flattened by CSS into the same list.
 * MutationObservers catch buttons and bars injected later. Unmounting puts
 * every node back exactly where it was, so Classic (or the toggle) gets the
 * stock box.
 *
 * If a SillyTavern update changes the form's shape, mount refuses and the
 * stock box is left alone rather than half-moved.
 */

/** SillyTavern's own composer controls: never corralled. */
const CORE_IDS = new Set([
    'options_button', 'extensionsMenuButton',
    'send_but', 'mes_continue', 'mes_impersonate', 'mes_stop',
    'stscript_continue', 'stscript_pause', 'stscript_stop',
]);
/** Children of #send_form that belong there: SillyTavern's own and DES's. */
const KNOWN_FORM_CHILDREN = new Set(['file_form', 'nonQRFormItems', 'qr--bar']);
const BAR_CLASS = 'dooms-ext-bar';
/** Interactive things inside a swept bar, for the count badge. */
const BAR_TOOL_SELECTOR = 'button, [role="button"], [class*="button"]:not([class*="container"]):not([class*="buttons"])';
const TRAY_ID = 'dooms-composer-tray';
const TRAY_BTN_ID = 'dooms-composer-tray-btn';
const EDGE = 8;

let mounted = false;
/** @type {MutationObserver|null} */
let holderObserver = null;
/** @type {MutationObserver|null} */
let trayObserver = null;
/** @type {MutationObserver|null} */
let formObserver = null;
/** @type {HTMLElement|null} */
let field = null;
/** @type {HTMLElement|null} */
let trayBtn = null;
/** @type {HTMLElement|null} */
let tray = null;
/** Where each corralled button came from, so unmount can put it back. */
const homes = new WeakMap();
let countFrame = 0;

/**
 * @param {Element} el
 * @returns {boolean} true for a control SillyTavern itself put in the form
 */
function isCore(el) {
    return CORE_IDS.has(el.id)
        || el.classList.contains('stscript_btn')
        || el.classList.contains('mes_stop');
}

/**
 * @param {Element} el a direct child of #send_form
 * @returns {boolean} true for a child that belongs on the form
 */
function isKnownFormChild(el) {
    if (KNOWN_FORM_CHILDREN.has(el.id) || el.id === TRAY_BTN_ID) return true;
    // DES's own additions (the mobile quick-jump button, widgets) stay put.
    for (const c of el.classList) if (c.startsWith('dooms-')) return true;
    return false;
}

/**
 * Moves every non-core child of a holder into the tray, remembering where
 * it sat so it can go back.
 * @param {HTMLElement} holder
 */
function sweep(holder) {
    if (!tray) return;
    for (const el of Array.from(holder.children)) {
        if (!(el instanceof HTMLElement) || isCore(el)) continue;
        homes.set(el, { holder, next: el.nextElementSibling });
        tray.appendChild(el);
    }
    scheduleCount();
}

/**
 * Moves every bar an extension hung directly on the form into the tray.
 * @param {HTMLElement} form
 */
function sweepForm(form) {
    if (!tray) return;
    for (const el of Array.from(form.children)) {
        if (!(el instanceof HTMLElement) || isKnownFormChild(el)) continue;
        homes.set(el, { holder: form, next: el.nextElementSibling });
        el.classList.add(BAR_CLASS);
        tray.appendChild(el);
    }
    scheduleCount();
}

/**
 * @param {Element} el
 * @param {Element} root stop here (exclusive)
 * @returns {boolean} true when el or an ancestor below root is display:none
 */
function hiddenWithin(el, root) {
    for (let p = el; p && p !== root; p = p.parentElement) {
        if (p instanceof HTMLElement && p.hidden) return true;
        if (getComputedStyle(p).display === 'none') return true;
    }
    return false;
}

/**
 * @param {Element} el a tray child
 * @returns {number} how many tools it stands for
 */
function countTools(el) {
    if (!tray || hiddenWithin(el, tray)) return 0;
    if (!el.classList.contains(BAR_CLASS)) return 1;
    let n = 0;
    for (const b of el.querySelectorAll(BAR_TOOL_SELECTOR)) {
        if (!hiddenWithin(b, el)) n++;
    }
    return n;
}

function scheduleCount() {
    if (countFrame) return;
    countFrame = requestAnimationFrame(() => {
        countFrame = 0;
        updateCount();
    });
}

/** Shows the tray button only while the tray holds something visible. */
function updateCount() {
    if (!tray || !trayBtn) return;
    let n = 0;
    for (const el of tray.children) n += countTools(el);
    trayBtn.hidden = n === 0;
    trayBtn.dataset.count = String(n);
    trayBtn.title = n === 1 ? '1 more tool' : `${n} more tools`;
    if (n === 0) closeTray();
}

function placeTray() {
    if (!tray || !trayBtn) return;
    const r = trayBtn.getBoundingClientRect();
    tray.style.bottom = `${Math.max(EDGE, window.innerHeight - r.top + 6)}px`;
    let left = r.left;
    const width = tray.offsetWidth;
    if (left + width > window.innerWidth - EDGE) left = window.innerWidth - EDGE - width;
    tray.style.left = `${Math.max(EDGE, left)}px`;
}

function openTray() {
    if (!tray || !trayBtn || trayBtn.hidden) return;
    tray.hidden = false;
    trayBtn.classList.add('is-open');
    placeTray();
}

function closeTray() {
    if (!tray || tray.hidden) return;
    tray.hidden = true;
    trayBtn?.classList.remove('is-open');
}

function toggleTray() {
    if (!tray) return;
    if (tray.hidden) openTray(); else closeTray();
}

/** @param {PointerEvent} e */
function onPointerDown(e) {
    if (!tray || tray.hidden || !trayBtn) return;
    const t = e.target;
    if (!(t instanceof Node)) return;
    if (tray.contains(t) || trayBtn.contains(t)) return;
    closeTray();
}

/** Focus moving anywhere outside the tray (the textarea, say) closes it. */
function onFocusIn(e) {
    if (!tray || tray.hidden || !trayBtn) return;
    const t = e.target;
    if (!(t instanceof Node)) return;
    if (tray.contains(t) || trayBtn.contains(t)) return;
    closeTray();
}

/** @param {KeyboardEvent} e */
function onKeyDown(e) {
    if (e.key !== 'Escape' || !tray || tray.hidden) return;
    closeTray();
    trayBtn?.focus();
}

/** @param {KeyboardEvent} e */
function onTrayBtnKey(e) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    toggleTray();
}

/**
 * Re-hosts SillyTavern's send form. Idempotent.
 * @returns {boolean} true when the DES composer is up
 */
export function mountComposer() {
    if (mounted) return true;
    const form = document.getElementById('send_form');
    const items = document.getElementById('nonQRFormItems');
    const left = document.getElementById('leftSendForm');
    const right = document.getElementById('rightSendForm');
    const textarea = document.getElementById('send_textarea');
    const shapeOk = form && items && left && right && textarea
        && items.parentElement === form
        && textarea.parentElement === items
        && left.parentElement === items
        && right.parentElement === items;
    if (!shapeOk) {
        console.warn('[Dooms Tracker] composer: SillyTavern\'s send form is not the shape DES expects; leaving it as it is.');
        return false;
    }

    field = document.createElement('div');
    field.className = 'dooms-composer-field';
    items.before(field);
    field.appendChild(textarea);

    trayBtn = document.createElement('div');
    trayBtn.id = TRAY_BTN_ID;
    trayBtn.setAttribute('role', 'button');
    trayBtn.setAttribute('tabindex', '0');
    trayBtn.hidden = true;
    trayBtn.innerHTML = '<i class="fa-solid fa-ellipsis"></i>';
    left.after(trayBtn);

    tray = document.createElement('div');
    tray.id = TRAY_ID;
    tray.hidden = true;
    document.body.appendChild(tray);

    form.classList.add('dooms-composer');
    sweep(left);
    sweep(right);
    sweepForm(form);

    holderObserver = new MutationObserver(() => {
        sweep(left);
        sweep(right);
    });
    holderObserver.observe(left, { childList: true });
    holderObserver.observe(right, { childList: true });
    formObserver = new MutationObserver(() => sweepForm(form));
    formObserver.observe(form, { childList: true });
    trayObserver = new MutationObserver(scheduleCount);
    trayObserver.observe(tray, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class', 'hidden'] });

    trayBtn.addEventListener('click', toggleTray);
    trayBtn.addEventListener('keydown', onTrayBtnKey);
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('resize', closeTray);
    mounted = true;
    return true;
}

/** Puts SillyTavern's send form back the way it was. Idempotent. */
export function unmountComposer() {
    if (!mounted) return;
    holderObserver?.disconnect();
    trayObserver?.disconnect();
    formObserver?.disconnect();
    holderObserver = null;
    trayObserver = null;
    formObserver = null;
    if (countFrame) {
        cancelAnimationFrame(countFrame);
        countFrame = 0;
    }
    closeTray();
    document.removeEventListener('pointerdown', onPointerDown, true);
    document.removeEventListener('focusin', onFocusIn);
    document.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('resize', closeTray);

    if (tray) {
        // Last corralled goes back first, so each one's remembered neighbour
        // is already home when its turn comes and the original order holds.
        for (const el of Array.from(tray.children).reverse()) {
            const home = homes.get(el);
            if (!home || !home.holder.isConnected) continue;
            el.classList.remove(BAR_CLASS);
            if (home.next && home.next.parentElement === home.holder) home.holder.insertBefore(el, home.next);
            else home.holder.appendChild(el);
            homes.delete(el);
        }
    }
    const items = document.getElementById('nonQRFormItems');
    const right = document.getElementById('rightSendForm');
    const textarea = document.getElementById('send_textarea');
    if (items && textarea) {
        if (right && right.parentElement === items) items.insertBefore(textarea, right);
        else items.appendChild(textarea);
    }
    field?.remove();
    trayBtn?.remove();
    tray?.remove();
    document.getElementById('send_form')?.classList.remove('dooms-composer');
    field = null;
    trayBtn = null;
    tray = null;
    mounted = false;
}

/**
 * Mounts for a styled setup with the option on, unmounts otherwise.
 * @param {string} setup active UI setup id
 * @param {boolean} enabled the Enhanced composer option
 */
export function syncComposer(setup, enabled) {
    if (enabled && setup && setup !== 'classic') mountComposer();
    else unmountComposer();
}

/** @returns {boolean} */
export function isComposerMounted() {
    return mounted;
}
