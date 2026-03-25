/**
 * System Log — captures [Dooms Tracker] console messages into a ring buffer
 * and provides a modal viewer for troubleshooting.
 */
import { extensionSettings } from '../../core/state.js';

/** @type {Array<{timestamp: string, level: string, message: string}>} */
const logBuffer = [];

/** Original console methods (preserved for passthrough) */
const _origLog = console.log;
const _origWarn = console.warn;
const _origError = console.error;

/**
 * Formats a Date as a compact timestamp string.
 */
function formatTimestamp(date) {
    const h = String(date.getHours()).padStart(2, '0');
    const m = String(date.getMinutes()).padStart(2, '0');
    const s = String(date.getSeconds()).padStart(2, '0');
    const ms = String(date.getMilliseconds()).padStart(3, '0');
    return `${h}:${m}:${s}.${ms}`;
}

/**
 * Captures a console message if it contains the Dooms prefix.
 */
function capture(level, args) {
    try {
        const first = args[0];
        if (typeof first !== 'string' || !first.includes('[Dooms')) return;

        const maxEntries = extensionSettings.systemLog?.maxEntries || 200;
        const message = args.map(a => {
            if (typeof a === 'string') return a;
            try { return JSON.stringify(a); } catch { return String(a); }
        }).join(' ');

        logBuffer.push({
            timestamp: formatTimestamp(new Date()),
            level,
            message,
        });

        // Trim ring buffer
        while (logBuffer.length > maxEntries) {
            logBuffer.shift();
        }
    } catch {
        // Never break the original console flow
    }
}

/**
 * Installs console interceptors. Call once at extension init.
 * Original console methods always fire — we just capture alongside.
 */
export function initSystemLog() {
    console.log = (...args) => { capture('log', args); _origLog.apply(console, args); };
    console.warn = (...args) => { capture('warn', args); _origWarn.apply(console, args); };
    console.error = (...args) => { capture('error', args); _origError.apply(console, args); };

    // Wire modal buttons via event delegation
    $(document).on('click', '#rpg-open-system-log', openSystemLog);
    $(document).on('click', '#rpg-system-log-copy', copySystemLog);
    $(document).on('click', '#rpg-system-log-clear', clearSystemLog);
    $(document).on('click', '#rpg-close-system-log', closeSystemLog);

    _origLog.call(console, '[Dooms Tracker] System Log initialized');
}

/**
 * Opens the system log modal and renders current buffer contents.
 */
export function openSystemLog() {
    const $modal = $('#rpg-system-log-popup');
    if (!$modal.length) return;

    const $entries = $modal.find('.rpg-system-log-entries');
    $entries.empty();

    if (logBuffer.length === 0) {
        $entries.append('<div class="rpg-log-empty">No log entries captured yet.</div>');
    } else {
        const fragment = document.createDocumentFragment();
        for (const entry of logBuffer) {
            const div = document.createElement('div');
            div.className = `rpg-log-entry rpg-log-${entry.level}`;
            div.textContent = `[${entry.timestamp}] [${entry.level.toUpperCase()}] ${entry.message}`;
            fragment.appendChild(div);
        }
        $entries[0].appendChild(fragment);
        // Scroll to bottom
        $entries[0].scrollTop = $entries[0].scrollHeight;
    }

    $modal.css('display', 'flex');
}

/**
 * Closes the system log modal.
 */
function closeSystemLog() {
    $('#rpg-system-log-popup').css('display', 'none');
}

/**
 * Copies all log entries to clipboard as formatted text.
 */
function copySystemLog() {
    if (logBuffer.length === 0) {
        toastr.info('No log entries to copy.', '', { timeOut: 2000 });
        return;
    }

    const text = logBuffer.map(e =>
        `[${e.timestamp}] [${e.level.toUpperCase()}] ${e.message}`
    ).join('\n');

    navigator.clipboard.writeText(text).then(() => {
        toastr.success(`Copied ${logBuffer.length} log entries to clipboard.`, '', { timeOut: 2000 });
    }).catch(() => {
        toastr.error('Failed to copy to clipboard.', '', { timeOut: 2000 });
    });
}

/**
 * Clears the log buffer and refreshes the modal view.
 */
function clearSystemLog() {
    logBuffer.length = 0;
    const $entries = $('.rpg-system-log-entries');
    if ($entries.length) {
        $entries.empty().append('<div class="rpg-log-empty">Log cleared.</div>');
    }
    toastr.info('System log cleared.', '', { timeOut: 2000 });
}
