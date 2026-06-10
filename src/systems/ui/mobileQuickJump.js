/**
 * Mobile Quick-Jump button.
 *
 * Adds a small floating button right at the corner of the chat input,
 * above the swipe arrow, that lets the user scroll back to their last
 * sent message with one tap. Tapping again (when already at that
 * message) cycles back to the previous user message, so repeated taps
 * walk you up through your own inputs.
 *
 * Lifecycle:
 *   - hidden by default
 *   - upward scroll on #chat reveals the button
 *   - 2 seconds after the last upward scroll, it auto-hides
 *   - tapping the button also hides it immediately
 *
 * Positioning: the button is appended INSIDE ST's #send_form (or its
 * parent if the form isn't there yet) and positioned with plain CSS
 * (absolute, bottom: 100%, right: 14px). No JS measurements, no
 * resize handlers, no chatchange retries — CSS tracks the form
 * automatically when the soft keyboard opens or the layout shifts.
 *
 * Mobile only — uses the same `window.innerWidth <= 1000` breakpoint as
 * the rest of DES's mobile UI (see src/systems/ui/mobile.js).
 *
 * Gated by the `mobileQuickJumpEnabled` setting (Display settings toggle).
 */

import { extensionSettings } from '../../core/state.js';

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
//   - the button is rendered with loud styling (see style.css
//     `body.dooms-debug-quick-jump` rules)
// Console will log "DEBUG_FORCE_VISIBLE on" once at init so you can confirm
// the module loaded.
const DEBUG_FORCE_VISIBLE = false;
// ────────────────────────────────────────────────────────────────────────────

let _btn = null;
let _hideTimer = null;
let _lastScrollTop = 0;
let _bound = false;

function isEnabled() {
    // Default on when the setting hasn't been written yet.
    return extensionSettings.mobileQuickJumpEnabled !== false;
}

function isMobile() {
    if (DEBUG_FORCE_VISIBLE) return true;
    return window.innerWidth <= MOBILE_BREAKPOINT_PX;
}

function getChat() {
    return document.getElementById('chat');
}

/**
 * Pick the closest stable parent to anchor the button to. Preference:
 *   1. #send_form  — sits at the bottom of the chat, moves with keyboard
 *   2. #sheld      — chat wrapper, slightly worse since its bottom is
 *                    affected by other DES injections (portrait bar, etc.)
 *   3. body        — last resort, falls back to viewport-fixed via CSS
 */
function pickAnchor() {
    return document.getElementById('send_form')
        || document.getElementById('sheld')
        || document.body;
}

function ensureButton() {
    const desiredParent = pickAnchor();
    if (_btn && _btn.parentElement === desiredParent) return _btn;
    if (_btn) {
        // Anchor swapped (ST DOM rebuilt) — move the existing element
        // rather than creating a new one to keep its event listener.
        desiredParent.appendChild(_btn);
        return _btn;
    }
    const btn = document.createElement('button');
    btn.id = BUTTON_ID;
    btn.type = 'button';
    btn.className = 'dooms-mobile-quick-jump';
    btn.setAttribute('aria-label', 'Jump to your last message');
    btn.title = 'Jump to your last message';
    btn.innerHTML = '<i class="fa-solid fa-reply" aria-hidden="true"></i>';
    btn.addEventListener('click', onClick);
    desiredParent.appendChild(btn);
    _btn = btn;
    return btn;
}

function showButton() {
    if (!isEnabled() || !isMobile()) {
        hideButton();
        return;
    }
    const btn = ensureButton();
    btn.classList.add('visible');
    if (_hideTimer) clearTimeout(_hideTimer);
    if (!DEBUG_FORCE_VISIBLE) {
        _hideTimer = setTimeout(hideButton, HIDE_DELAY_MS);
    }
}

function hideButton() {
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
    if (top < _lastScrollTop - SCROLL_UP_THRESHOLD_PX) {
        showButton();
    }
    _lastScrollTop = top;
}

// Bind directly to the #chat element. scroll events do NOT bubble, so jQuery
// delegation ($(document).on('scroll', '#chat', ...)) never fires — the
// listener has to sit on the scrolling element itself. Re-bind idempotently
// (same function reference) so chatchange re-attach doesn't stack handlers.
function bindScroll() {
    const chat = getChat();
    if (!chat) return;
    chat.removeEventListener('scroll', onScroll);
    chat.addEventListener('scroll', onScroll, { passive: true });
}

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
    const userMessages = chat.querySelectorAll('.mes[is_user="true"]');
    if (userMessages.length === 0) { hideButton(); return; }
    const chatRect = chat.getBoundingClientRect();
    const activeIdx = findActiveUserMessageIndex(userMessages, chatRect);
    let target;
    if (activeIdx === -1) {
        target = userMessages[userMessages.length - 1];
    } else if (activeIdx > 0) {
        target = userMessages[activeIdx - 1];
    } else {
        hideButton();
        return;
    }
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    hideButton();
}

export function initMobileQuickJump() {
    if (_bound) return;
    _bound = true;
    if (DEBUG_FORCE_VISIBLE) {
        console.log('[Dooms Tracker] MobileQuickJump: DEBUG_FORCE_VISIBLE on — flip the const off in src/systems/ui/mobileQuickJump.js before shipping.');
        document.body.classList.add('dooms-debug-quick-jump');
    }
    bindScroll();
    // #chat may not exist yet this early in ST startup; retry so we don't
    // depend solely on a chatchange firing after init.
    if (!getChat()) {
        setTimeout(bindScroll, 500);
        setTimeout(bindScroll, 1500);
    }
    // Chat changes can rebuild the send form (and our button along
    // with it), so re-ensure the anchor after the DOM settles.
    $(document).on('chatchange.doomsQuickJump', () => {
        _lastScrollTop = 0;
        bindScroll();
        // ST may rebuild #send_form on chat switch — re-attach.
        if (_btn && !document.body.contains(_btn)) {
            ensureButton();
        } else if (_btn) {
            // Anchor swap if needed.
            const desired = pickAnchor();
            if (_btn.parentElement !== desired) {
                desired.appendChild(_btn);
            }
        }
    });
    if (DEBUG_FORCE_VISIBLE) {
        // Show immediately on init so the user can verify the button
        // paints and the click handler works.
        showButton();
        // If the form isn't in the DOM yet, retry mounting once it is.
        setTimeout(() => { if (DEBUG_FORCE_VISIBLE) showButton(); }, 500);
        setTimeout(() => { if (DEBUG_FORCE_VISIBLE) showButton(); }, 1500);
    }
}

/**
 * Apply the current mobileQuickJumpEnabled setting at runtime. Called by the
 * Display settings toggle: when switched off, hide the button immediately;
 * when on, the next scroll-up reveals it.
 */
export function refreshMobileQuickJump() {
    if (!isEnabled()) {
        hideButton();
        return;
    }
    // Re-ensure the scroll listener in case #chat wasn't present at init.
    bindScroll();
}
