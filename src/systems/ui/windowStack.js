/**
 * The windows' order (docs/hub-plan.md §4.4): the Map window, the World
 * Builder and the Hub each close on Escape and on a click on their own
 * backdrop; opened over one another, only the one on top should answer.
 * Each pushes its name when it opens and pops it when it closes, asks
 * `takesEscape` on a key and binds its backdrop through `closeOnBackdrop`.
 */
const stack = [];
const ESCAPE_MARK = '__doomsEscapeTaken';

export function pushWindow(name) {
    popWindow(name);
    stack.push(String(name));
}

export function popWindow(name) {
    const i = stack.lastIndexOf(String(name));
    if (i >= 0) stack.splice(i, 1);
}

export function isTopmost(name) {
    return stack.length > 0 && stack[stack.length - 1] === String(name);
}

export function topWindow() {
    return stack.length ? stack[stack.length - 1] : '';
}

/**
 * Whether an Escape keydown is this window's to answer: the key, the
 * window on top, and no other window's handler answered it in the same
 * keystroke. The window on top closes and pops itself inside its handler,
 * so a handler bound later would find itself on top in the same dispatch
 * and close too; the first to answer marks the event, and the mark is on
 * the browser's own event (jQuery's wrapper is a fresh object per handler).
 */
export function takesEscape(name, ev) {
    if (!ev || ev.key !== 'Escape' || !isTopmost(name)) return false;
    const native = ev.originalEvent && typeof ev.originalEvent === 'object' ? ev.originalEvent : ev;
    if (native[ESCAPE_MARK]) return false;
    try { native[ESCAPE_MARK] = true; } catch (e) { /* a frozen event: the first answer still stands by the stack */ }
    return true;
}

/**
 * Closes a window on a click on its own backdrop: the popup element (the
 * dim band around the content) pressed and released. A press inside the
 * window released over the band is not a close: a pan on the board or a
 * node's drag that overshoots the window's edge, a text selection. The
 * browser fires that click at the popup, the press's and the release's
 * common ancestor, so the press's target is remembered (in the capture
 * phase, before anything inside can stop it) and both must be the popup.
 */
export function closeOnBackdrop(popupId, close) {
    let pressed = null;
    document.addEventListener('pointerdown', (ev) => { pressed = ev.target; }, true);
    document.addEventListener('click', (ev) => {
        const p = pressed;
        pressed = null;
        if (ev.target && ev.target.id === popupId && p === ev.target) close();
    });
}
