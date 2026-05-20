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

/**
 * Sample viewport / chat / sheld heights every 200ms for 5 seconds after
 * a keyboard-triggering input loses focus. Helps diagnose the "UI sits
 * mid-screen for 10 seconds after keyboard dismisses" issue by showing
 * whether the browser updates visualViewport.height promptly and
 * whether #sheld / #chat actually grow back to fill it.
 *
 * Output format:
 *   [DES kbd-close] T+0ms  vv.h=520  win.h=520  sheld.h=520  chat.h=240
 *   [DES kbd-close] T+200ms vv.h=720 win.h=720  sheld.h=520  chat.h=240   <-- viewport grew but sheld stuck
 *   ...
 *
 * Drop together with the rest of this file once we've identified the
 * culprit.
 */
function startCloseSampling(triggerEl) {
    const start = performance.now();
    const sheld = document.getElementById('sheld');
    const chat = document.getElementById('chat');
    const sendForm = document.getElementById('send_form');
    const sample = () => {
        const t = Math.round(performance.now() - start);
        const vv = window.visualViewport;
        console.log(
            `[DES kbd-close] T+${t}ms ` +
            `vv.h=${vv ? Math.round(vv.height) : '?'} ` +
            `win.h=${window.innerHeight} ` +
            `sheld.h=${sheld ? Math.round(sheld.getBoundingClientRect().height) : '?'} ` +
            `chat.h=${chat ? Math.round(chat.getBoundingClientRect().height) : '?'} ` +
            `form.h=${sendForm ? Math.round(sendForm.getBoundingClientRect().height) : '?'} ` +
            `body.h=${Math.round(document.body.getBoundingClientRect().height)} ` +
            `scrollY=${Math.round(window.scrollY)}`
        );
    };
    sample();
    // Five seconds of 200ms samples = 26 lines. Long enough to capture
    // a 10-second stuck state's first half — the second half is just
    // more of the same and not worth the console spam.
    let count = 0;
    const interval = setInterval(() => {
        sample();
        if (++count >= 24) clearInterval(interval);
    }, 200);
}

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
    // Sample post-close viewport heights so we can see whether the
    // browser updates them promptly.
    document.addEventListener('focusout', (e) => {
        if (window.innerWidth > 1000) return;
        if (!isKeyboardTriggering(e.target)) return;
        startCloseSampling(e.target);
    }, /*useCapture*/ true);
    console.log('[Dooms Tracker] MobileFocusLogger initialized — watching focus events and post-close viewport reflow.');
}
