/**
 * Mobile Compose Overlay — optional (mobileComposeOverlay, default off).
 *
 * On mobile, tapping SillyTavern's message input normally makes the on-screen
 * keyboard resize/relayout the ENTIRE chat UI, which can take seconds to
 * settle on slower phones before typing is possible. With this on, tapping
 * the input instead opens a fullscreen compose sheet: only the sheet has to
 * fit the keyboard (sized off visualViewport — one cheap resize), the chat
 * behind it can relayout at its leisure, and typing is instant.
 *
 * Everything typed is mirrored into the real #send_textarea on every
 * keystroke (value + an 'input' event, so ST's token counter and send-button
 * state stay live). Send taps ST's own #send_but. Closing keeps the text in
 * the original box.
 *
 * Known limitation (documented in the setting hint): slash-command
 * autocomplete doesn't pop up inside the sheet — the command text itself
 * still works because it lands in the real input.
 */
import { extensionSettings } from '../../core/state.js';

let _initialized = false;
let _overlayOpen = false;
// Closing the sheet can be followed by ST programmatically refocusing the
// real input (e.g. after send) — a short suppression window keeps that from
// bouncing the sheet right back open.
let _suppressUntil = 0;

function isMobileViewport() {
    return window.innerWidth <= 1000;
}

function getSendTextarea() {
    return document.getElementById('send_textarea');
}

function ensureOverlay() {
    let el = document.getElementById('dooms-compose-overlay');
    if (el) return el;
    $('body').append(`
        <div id="dooms-compose-overlay" style="display:none;" role="dialog" aria-modal="true" aria-label="Compose message">
            <div class="dooms-compose-bar">
                <span class="dooms-compose-title"><i class="fa-solid fa-pen-to-square"></i> Compose</span>
                <button type="button" class="dooms-compose-close" title="Close — your text stays in the message box"><i class="fa-solid fa-xmark"></i></button>
            </div>
            <textarea id="dooms-compose-input" placeholder="Type your message…"></textarea>
            <div class="dooms-compose-actions">
                <button type="button" class="dooms-compose-send"><i class="fa-solid fa-paper-plane"></i> Send</button>
            </div>
        </div>
    `);
    return document.getElementById('dooms-compose-overlay');
}

/** Mirrors the sheet's text into the real input so ST state stays live. */
function syncToOriginal() {
    const original = getSendTextarea();
    const compose = document.getElementById('dooms-compose-input');
    if (!original || !compose) return;
    if (original.value !== compose.value) {
        original.value = compose.value;
        original.dispatchEvent(new Event('input', { bubbles: true }));
    }
}

/** Keeps the sheet inside the VISUAL viewport so the keyboard never covers
 *  the Send button — this is the one element that resizes for the keyboard. */
function fitToViewport() {
    if (!_overlayOpen) return;
    const el = document.getElementById('dooms-compose-overlay');
    const vv = window.visualViewport;
    if (!el || !vv) return;
    el.style.height = vv.height + 'px';
    el.style.top = vv.offsetTop + 'px';
}

function openOverlay() {
    const el = ensureOverlay();
    const original = getSendTextarea();
    const compose = document.getElementById('dooms-compose-input');
    if (!compose) return;
    compose.value = original ? original.value : '';
    el.style.display = 'flex';
    _overlayOpen = true;
    fitToViewport();
    // Focus after paint; moving focus between two text inputs keeps the
    // keyboard open without a dismiss/reopen cycle.
    requestAnimationFrame(() => compose.focus({ preventScroll: true }));
}

function closeOverlay({ blurKeyboard = true } = {}) {
    syncToOriginal();
    const el = document.getElementById('dooms-compose-overlay');
    if (el) el.style.display = 'none';
    _overlayOpen = false;
    _suppressUntil = Date.now() + 600;
    if (blurKeyboard) {
        const compose = document.getElementById('dooms-compose-input');
        compose?.blur();
    }
}

function sendFromOverlay() {
    // Order matters: closeOverlay() also syncs, and it must run while the
    // sheet still holds the text — clearing the sheet first would mirror an
    // EMPTY value into the real input and send nothing. ST clears the real
    // textarea itself on send; the sheet re-prefills from it on next open.
    syncToOriginal();
    closeOverlay();
    // ST's own send button — every ST-side behavior (slash commands, group
    // handling, generation kickoff) runs exactly as if typed natively.
    document.getElementById('send_but')?.click();
}

export function initMobileCompose() {
    if (_initialized) return;
    _initialized = true;

    // Intercept focus on the real input. focusin bubbles (focus doesn't), so
    // a delegated listener works even though ST builds the form early.
    $(document).on('focusin.doomsCompose', '#send_textarea', function () {
        if (!extensionSettings.enabled || !extensionSettings.mobileComposeOverlay) return;
        if (!isMobileViewport() || _overlayOpen) return;
        if (Date.now() < _suppressUntil) return;
        openOverlay();
    });

    $(document).on('input.doomsCompose', '#dooms-compose-input', syncToOriginal);
    $(document).on('click.doomsCompose', '.dooms-compose-close', () => closeOverlay());
    $(document).on('click.doomsCompose', '.dooms-compose-send', sendFromOverlay);
    $(document).on('keydown.doomsCompose', '#dooms-compose-input', function (e) {
        if (e.key === 'Escape') {
            e.preventDefault();
            closeOverlay();
        }
    });

    if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', fitToViewport);
        window.visualViewport.addEventListener('scroll', fitToViewport);
    }
}

/** Used by the settings toggle to close a sheet that's open when disabling. */
export function closeMobileCompose() {
    if (_overlayOpen) closeOverlay();
}
