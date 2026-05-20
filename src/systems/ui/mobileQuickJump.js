/**
 * Mobile Quick-Jump button.
 *
 * Adds a small floating button on the right edge of the screen, above the
 * chat input, that lets the user scroll back to their last sent message
 * with one tap. Tapping again (when already at that message) cycles back
 * to the previous user message, so repeated taps walk you up through
 * your own inputs.
 *
 * Lifecycle:
 *   - hidden by default
 *   - upward scroll on #chat reveals the button
 *   - 2 seconds after the last upward scroll, it auto-hides
 *   - tapping the button also hides it immediately
 *
 * Mobile only — uses the same `window.innerWidth <= 1000` breakpoint as
 * the rest of DES's mobile UI (see src/systems/ui/mobile.js).
 */

const BUTTON_ID = 'dooms-mobile-quick-jump';
const MOBILE_BREAKPOINT_PX = 1000;
const HIDE_DELAY_MS = 2000;
// How close (in px) to the top of the chat viewport a user message has to
// be for us to consider the user "already at" that message — looser than
// strict intersection so a slightly off-screen-by-a-line message still
// counts and the second tap walks back as expected.
const AT_MESSAGE_TOLERANCE_PX = 120;
// How many px of upward scroll between events to count as a real scroll-up
// (filters jitter and momentum overshoot from touch devices).
const SCROLL_UP_THRESHOLD_PX = 12;

// ─── DEBUG ──────────────────────────────────────────────────────────────────
// Flip to false before shipping. While true:
//   - the button is pinned visible from init (no scroll-up needed)
//   - the 2-second auto-hide timer is suppressed
//   - the mobile breakpoint check is bypassed so you can test on desktop
//     responsive mode and full desktop without a touch device
// Console will log "DEBUG_FORCE_VISIBLE on" once at init so you can confirm
// the module loaded.
const DEBUG_FORCE_VISIBLE = true;
// ────────────────────────────────────────────────────────────────────────────

let _btn = null;
let _hideTimer = null;
let _lastScrollTop = 0;
let _bound = false;

function isMobile() {
    if (DEBUG_FORCE_VISIBLE) return true;
    return window.innerWidth <= MOBILE_BREAKPOINT_PX;
}

function getChat() {
    return document.getElementById('chat');
}

function ensureButton() {
    if (_btn && document.body.contains(_btn)) return _btn;
    const btn = document.createElement('button');
    btn.id = BUTTON_ID;
    btn.type = 'button';
    btn.className = 'dooms-mobile-quick-jump';
    btn.setAttribute('aria-label', 'Jump to your last message');
    btn.title = 'Jump to your last message';
    btn.innerHTML = '<i class="fa-solid fa-reply" aria-hidden="true"></i>';
    btn.addEventListener('click', onClick);
    document.body.appendChild(btn);
    _btn = btn;
    return btn;
}

function showButton() {
    if (!isMobile()) {
        hideButton();
        return;
    }
    const btn = ensureButton();
    btn.classList.add('visible');
    if (_hideTimer) clearTimeout(_hideTimer);
    // Skip the auto-hide while debugging so the button stays pinned and
    // the click handler can be tested at will.
    if (!DEBUG_FORCE_VISIBLE) {
        _hideTimer = setTimeout(hideButton, HIDE_DELAY_MS);
    }
}

function hideButton() {
    // While debugging, no-op: keep the button pinned so the user can test
    // the click handler without racing the auto-hide timer.
    if (DEBUG_FORCE_VISIBLE) return;
    if (_btn) _btn.classList.remove('visible');
    if (_hideTimer) {
        clearTimeout(_hideTimer);
        _hideTimer = null;
    }
}

function onScroll() {
    const chat = getChat();
    if (!chat) return;
    const top = chat.scrollTop;
    // Detect upward scroll. The threshold filters out tiny jitter from
    // touch momentum bouncing back the other direction by 1-2px.
    if (top < _lastScrollTop - SCROLL_UP_THRESHOLD_PX) {
        showButton();
    }
    _lastScrollTop = top;
}

/**
 * Returns the index of the user message currently aligned with the top of
 * the chat viewport (within AT_MESSAGE_TOLERANCE_PX), or -1 if none.
 */
function findActiveUserMessageIndex(userMessages, chatRect) {
    for (let i = 0; i < userMessages.length; i++) {
        const r = userMessages[i].getBoundingClientRect();
        const delta = Math.abs(r.top - chatRect.top);
        if (delta <= AT_MESSAGE_TOLERANCE_PX) {
            return i;
        }
    }
    return -1;
}

function onClick() {
    const chat = getChat();
    if (!chat) { hideButton(); return; }
    // ST renders user messages with `is_user="true"` on the message wrapper.
    const userMessages = chat.querySelectorAll('.mes[is_user="true"]');
    if (userMessages.length === 0) { hideButton(); return; }
    const chatRect = chat.getBoundingClientRect();
    const activeIdx = findActiveUserMessageIndex(userMessages, chatRect);
    let target;
    if (activeIdx === -1) {
        // Not currently sitting on any user message → go to the most
        // recent one. Common case: user just scrolled up to read history.
        target = userMessages[userMessages.length - 1];
    } else if (activeIdx > 0) {
        // Sitting on a user message → walk back one.
        target = userMessages[activeIdx - 1];
    } else {
        // Already at the very first user message — nothing to walk back
        // to, so do nothing rather than jumping somewhere unexpected.
        hideButton();
        return;
    }
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    hideButton();
}

/**
 * Wire up the scroll listener. Safe to call more than once — guard flag
 * prevents double-binding.
 */
export function initMobileQuickJump() {
    if (_bound) return;
    _bound = true;
    if (DEBUG_FORCE_VISIBLE) {
        console.log('[Dooms Tracker] MobileQuickJump: DEBUG_FORCE_VISIBLE on — button pinned visible on all viewports. Flip the const off in src/systems/ui/mobileQuickJump.js before shipping.');
        // Tag body so CSS bypasses the desktop @media hide rule. Without
        // this the button stays invisible on viewports > 1000px even
        // though the JS thinks it's visible.
        document.body.classList.add('dooms-debug-quick-jump');
    }
    // Delegated listener: ST sometimes recreates #chat on chat changes,
    // so binding directly to the current element would break across chats.
    // Listening on document with a #chat selector survives the rebuild.
    $(document).on('scroll.doomsQuickJump', '#chat', onScroll);
    // Reset baseline when the chat element changes so a fresh chat at
    // scrollTop=0 doesn't immediately trigger the button on the next
    // small scroll.
    $(document).on('chatchange.doomsQuickJump', () => { _lastScrollTop = 0; });
    // Hide when leaving mobile viewport.
    window.addEventListener('resize', () => {
        if (!isMobile()) hideButton();
    });
    // While debugging, show the button immediately so the user can verify
    // it renders and the click handler works without depending on scroll
    // detection (which is the most likely thing to be silently broken).
    if (DEBUG_FORCE_VISIBLE) {
        showButton();
    }
}
