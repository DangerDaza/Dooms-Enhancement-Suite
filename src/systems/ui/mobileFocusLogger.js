/**
 * Mobile Focus Logger — diagnostic-only.
 *
 * Hooked from index.js to log every focus event on mobile that would
 * cause the soft keyboard to pop up (textarea, input, contenteditable).
 * Captures a short stack trace so we can see WHO called .focus() and
 * narrow down the trigger.
 *
 * To strip after diagnosis: remove the import + init call in index.js
 * and delete this file. No other code references it.
 *
 * Output format in console:
 *   [DES focus] tag=<TAG> id=<id> class=<class> at HH:MM:SS.mmm
 *     activeElement: <prev>
 *     stack: <top of stack>
 */

const KEYBOARD_TRIGGERING_TAGS = new Set(['TEXTAREA', 'INPUT']);

function isKeyboardTriggering(el) {
    if (!el || el.nodeType !== 1) return false;
    if (KEYBOARD_TRIGGERING_TAGS.has(el.tagName)) {
        // Some input types don't open a keyboard (button, checkbox, etc.).
        if (el.tagName === 'INPUT') {
            const t = (el.type || '').toLowerCase();
            const nonKeyboard = ['button', 'submit', 'reset', 'checkbox', 'radio', 'file', 'image', 'hidden', 'range', 'color'];
            if (nonKeyboard.includes(t)) return false;
        }
        return true;
    }
    if (el.getAttribute && el.getAttribute('contenteditable') === 'true') return true;
    return false;
}

function shortDesc(el) {
    if (!el || el.nodeType !== 1) return String(el);
    const tag = el.tagName?.toLowerCase() || '?';
    const id = el.id ? `#${el.id}` : '';
    const cls = el.className && typeof el.className === 'string'
        ? '.' + el.className.split(/\s+/).filter(Boolean).slice(0, 3).join('.')
        : '';
    return `${tag}${id}${cls}`;
}

function ts() {
    const d = new Date();
    const pad = (n, w = 2) => String(n).padStart(w, '0');
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

let _bound = false;

export function initMobileFocusLogger() {
    if (_bound) return;
    _bound = true;
    // Capture phase so we see the focus before any handler can shift it
    // around or stop propagation.
    document.addEventListener('focusin', (e) => {
        const el = e.target;
        if (!isKeyboardTriggering(el)) return;
        const prev = e.relatedTarget;
        const stack = (new Error()).stack || '(no stack)';
        // First few frames are the listener itself and the Error
        // constructor — skip them so the user sees the actual caller.
        const trimmedStack = stack.split('\n').slice(2, 8).join('\n');
        console.log(
            `[DES focus] ${shortDesc(el)} at ${ts()}\n` +
            `  fromActiveElement: ${shortDesc(prev || document.activeElement)}\n` +
            `  innerWidth=${window.innerWidth}\n` +
            `  stack:\n${trimmedStack}`
        );
    }, /*useCapture*/ true);
    console.log('[Dooms Tracker] MobileFocusLogger initialized — watching keyboard-triggering focus events.');
}
