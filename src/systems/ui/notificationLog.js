/**
 * Notification Log — captures toastr notifications (error, warning, info, success)
 * into a ring buffer and provides a modal viewer so users can review past messages
 * even after the toast has disappeared.
 */
import { extensionSettings } from '../../core/state.js';

/** @type {Array<{timestamp: string, level: string, title: string, message: string}>} */
const notifBuffer = [];

/** Original toastr methods (preserved for passthrough) */
let _origError = null;
let _origWarning = null;
let _origInfo = null;
let _origSuccess = null;

/**
 * Formats a Date as a compact timestamp string.
 */
function formatTimestamp(date) {
    const h = String(date.getHours()).padStart(2, '0');
    const m = String(date.getMinutes()).padStart(2, '0');
    const s = String(date.getSeconds()).padStart(2, '0');
    return `${h}:${m}:${s}`;
}

/**
 * Captures a toastr notification into the buffer.
 */
function capture(level, message, title) {
    try {
        const maxEntries = extensionSettings.systemLog?.maxEntries || 200;

        notifBuffer.push({
            timestamp: formatTimestamp(new Date()),
            level,
            title: title || '',
            message: message || '',
        });

        // Trim ring buffer
        while (notifBuffer.length > maxEntries) {
            notifBuffer.shift();
        }
    } catch {
        // Never break the original toastr flow
    }
}

/**
 * Installs toastr interceptors. Call once at extension init.
 * Original toastr methods always fire — we just capture alongside.
 */
export function initNotificationLog() {
    if (typeof toastr === 'undefined') {
        console.warn('[Dooms Tracker] toastr not found — Notification Log disabled');
        return;
    }

    _origError = toastr.error;
    _origWarning = toastr.warning;
    _origInfo = toastr.info;
    _origSuccess = toastr.success;

    toastr.error = function (message, title, ...rest) {
        capture('error', message, title);
        return _origError.call(toastr, message, title, ...rest);
    };
    toastr.warning = function (message, title, ...rest) {
        capture('warning', message, title);
        return _origWarning.call(toastr, message, title, ...rest);
    };
    toastr.info = function (message, title, ...rest) {
        capture('info', message, title);
        return _origInfo.call(toastr, message, title, ...rest);
    };
    toastr.success = function (message, title, ...rest) {
        capture('success', message, title);
        return _origSuccess.call(toastr, message, title, ...rest);
    };

    // Wire modal buttons via event delegation
    $(document).on('click', '#rpg-open-notification-log', openNotificationLog);
    $(document).on('click', '#rpg-notification-log-copy', copyNotificationLog);
    $(document).on('click', '#rpg-notification-log-clear', clearNotificationLog);
    $(document).on('click', '#rpg-close-notification-log', closeNotificationLog);

    console.log('[Dooms Tracker] Notification Log initialized');
}

/**
 * Opens the notification log modal and renders current buffer contents.
 */
export function openNotificationLog() {
    const $modal = $('#rpg-notification-log-popup');
    if (!$modal.length) return;

    const $entries = $modal.find('.rpg-notification-log-entries');
    $entries.empty();

    if (notifBuffer.length === 0) {
        $entries.append('<div class="rpg-log-empty">No notifications captured yet.</div>');
    } else {
        const fragment = document.createDocumentFragment();
        for (const entry of notifBuffer) {
            const div = document.createElement('div');
            div.className = `rpg-notif-entry rpg-notif-${entry.level}`;

            const badge = document.createElement('span');
            badge.className = 'rpg-notif-badge';
            badge.textContent = entry.level.toUpperCase();
            div.appendChild(badge);

            const ts = document.createElement('span');
            ts.className = 'rpg-notif-time';
            ts.textContent = entry.timestamp;
            div.appendChild(ts);

            const text = document.createElement('span');
            text.className = 'rpg-notif-text';
            text.textContent = entry.title ? `${entry.title} — ${entry.message}` : entry.message;
            div.appendChild(text);

            fragment.appendChild(div);
        }
        $entries[0].appendChild(fragment);
        // Scroll to bottom
        $entries[0].scrollTop = $entries[0].scrollHeight;
    }

    $modal.css('display', 'flex');
}

/**
 * Closes the notification log modal.
 */
function closeNotificationLog() {
    $('#rpg-notification-log-popup').css('display', 'none');
}

/**
 * Copies all notification entries to clipboard as formatted text.
 */
function copyNotificationLog() {
    if (notifBuffer.length === 0) {
        toastr.info('No notifications to copy.', '', { timeOut: 2000 });
        return;
    }

    const text = notifBuffer.map(e => {
        const label = `[${e.timestamp}] [${e.level.toUpperCase()}]`;
        return e.title ? `${label} ${e.title} — ${e.message}` : `${label} ${e.message}`;
    }).join('\n');

    navigator.clipboard.writeText(text).then(() => {
        toastr.success(`Copied ${notifBuffer.length} notifications to clipboard.`, '', { timeOut: 2000 });
    }).catch(() => {
        // Use original to avoid capture loop
        if (_origError) _origError.call(toastr, 'Failed to copy to clipboard.', '', { timeOut: 2000 });
    });
}

/**
 * Clears the notification buffer and refreshes the modal view.
 */
function clearNotificationLog() {
    notifBuffer.length = 0;
    const $entries = $('.rpg-notification-log-entries');
    if ($entries.length) {
        $entries.empty().append('<div class="rpg-log-empty">Notification log cleared.</div>');
    }
    toastr.info('Notification log cleared.', '', { timeOut: 2000 });
}
