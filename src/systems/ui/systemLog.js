/**
 * System Log — captures DES console messages, unhandled errors, and
 * promise rejections into a ring buffer, plus snapshots a diagnostic
 * header on copy so a single paste tells the maintainer everything they
 * need to triage a report.
 */
import { extensionSettings } from '../../core/state.js';
import { extensionVersion, getExtensionVersion } from '../../core/config.js';

/** @type {Array<{timestamp: string, level: string, message: string}>} */
const logBuffer = [];

/** Original console methods (preserved for passthrough) */
const _origLog = console.log;
const _origWarn = console.warn;
const _origError = console.error;

/**
 * Prefixes that mark a log line as DES-originated. Anything starting with
 * one of these is captured at every level (log/warn/error). Lines without
 * a prefix are still captured at warn/error so unhandled ST/library
 * failures that affect DES still land in the buffer.
 */
const DES_PREFIXES = ['[Dooms', '[DES', '[Doom Counter]', '[Doom\'s'];

function isBranded(text) {
    if (typeof text !== 'string') return false;
    for (const p of DES_PREFIXES) {
        if (text.startsWith(p) || text.includes(p)) return true;
    }
    return false;
}

/**
 * Other extensions whose normal logging would otherwise flood DES's
 * System Log ring buffer. GuidedGenerations alone emits dozens of
 * `[AUTOTRIGGER-DEBUG]` lines per send (each with a full stack trace),
 * which can rotate older real-DES errors out of the 500-entry buffer
 * before users have a chance to copy them. We drop these at capture
 * time. Errors and warnings still go through the underlying console —
 * we just don't store them in our diagnostic bundle.
 */
const NOISY_PREFIXES = [
    '[GuidedGenerations]',
    '[AUTOTRIGGER-DEBUG]',
    'GuidedGenerations-Extension:',
    '[QR2]',                      // Quick Replies 2 — also chatty per turn
    '[TunnelVision]',             // Tool preflight log per generation
    'STMemoryBooks:',             // Per-message processing chatter
];

function isNoisyExternal(text) {
    if (typeof text !== 'string') return false;
    for (const p of NOISY_PREFIXES) {
        if (text.startsWith(p)) return true;
    }
    return false;
}

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

function pushEntry(level, message) {
    const maxEntries = extensionSettings.systemLog?.maxEntries || 500;
    logBuffer.push({
        timestamp: formatTimestamp(new Date()),
        level,
        message,
    });
    while (logBuffer.length > maxEntries) {
        logBuffer.shift();
    }
}

function stringifyArg(a) {
    if (typeof a === 'string') return a;
    if (a instanceof Error) {
        const stack = a.stack ? `\n${a.stack}` : '';
        return `${a.name}: ${a.message}${stack}`;
    }
    try { return JSON.stringify(a); } catch { return String(a); }
}

/**
 * Captures a console message. DES-prefixed messages are always captured;
 * unbranded warn/error messages are captured tagged with [unbranded] so
 * silent ST/library throws don't get lost.
 */
function capture(level, args) {
    try {
        const first = args[0];
        const branded = isBranded(first);
        // Drop logs from other chatty extensions (GuidedGenerations'
        // autotrigger debug, QR2 hooks, STMemoryBooks per-message chatter,
        // TunnelVision tool preflight). Dropping at capture time only —
        // the underlying console still gets them so devtools is unaffected.
        if (!branded && isNoisyExternal(first)) return;
        // For log level, only capture branded lines — otherwise we'd flood
        // the buffer with normal ST chatter (rendered N messages, etc.).
        if (level === 'log' && !branded) return;
        const message = args.map(stringifyArg).join(' ');
        const tagged = branded ? message : `[unbranded] ${message}`;
        pushEntry(level, tagged);
    } catch {
        // Never break the original console flow
    }
}

/**
 * Installs console interceptors and global error handlers. Call once at
 * extension init. Original console methods always fire — we just capture
 * alongside.
 */
export function initSystemLog() {
    console.log = (...args) => { capture('log', args); _origLog.apply(console, args); };
    console.warn = (...args) => { capture('warn', args); _origWarn.apply(console, args); };
    console.error = (...args) => { capture('error', args); _origError.apply(console, args); };

    // Catch unhandled exceptions and promise rejections from any source.
    // These rarely surface as console.error calls — they fire on window
    // and are easy to miss without devtools open. Stack traces here are
    // usually the actual diagnostic gold.
    window.addEventListener('error', (e) => {
        try {
            const where = e.filename ? ` @ ${e.filename}:${e.lineno}:${e.colno}` : '';
            const stack = e.error?.stack ? `\n${e.error.stack}` : '';
            pushEntry('error', `[window.error] ${e.message || ''}${where}${stack}`);
        } catch {}
    });
    window.addEventListener('unhandledrejection', (e) => {
        try {
            const reason = e.reason;
            const text = (reason instanceof Error)
                ? `${reason.name}: ${reason.message}${reason.stack ? `\n${reason.stack}` : ''}`
                : stringifyArg(reason);
            pushEntry('error', `[unhandledrejection] ${text}`);
        } catch {}
    });

    // Wire modal buttons via event delegation
    $(document).on('click', '#rpg-open-system-log', openSystemLog);
    $(document).on('click', '#rpg-system-log-copy', copySystemLog);
    $(document).on('click', '#rpg-system-log-clear', clearSystemLog);
    $(document).on('click', '#rpg-close-system-log', closeSystemLog);

    _origLog.call(console, '[Dooms Tracker] System Log initialized');
}

/**
 * Builds a one-shot diagnostic snapshot prepended to the copied log so
 * the recipient (typically the maintainer triaging a bug report) gets
 * the user's environment + key DES settings without having to ask.
 */
function buildDiagnosticHeader() {
    const lines = ['===== Doom\'s Enhancement Suite — Diagnostic Bundle ====='];
    lines.push(`Captured: ${new Date().toISOString()}`);
    lines.push(`DES version: ${extensionVersion || 'unknown'}`);
    try {
        lines.push(`Browser: ${navigator.userAgent}`);
    } catch {}
    try {
        const s = extensionSettings || {};
        lines.push('--- Settings snapshot ---');
        lines.push(`enabled: ${s.enabled}`);
        lines.push(`generationMode: ${s.generationMode || '(unset)'}`);
        lines.push(`autoUpdate: ${s.autoUpdate}`);
        lines.push(`updateDepth: ${s.updateDepth}`);
        lines.push(`syncExpressionsToPresentCharacters: ${s.syncExpressionsToPresentCharacters}`);
        lines.push(`hideDefaultExpressionDisplay: ${s.hideDefaultExpressionDisplay}`);
        lines.push(`enableHtmlPrompt: ${s.enableHtmlPrompt}`);
        lines.push(`enableDialogueColoring: ${s.enableDialogueColoring}`);
        lines.push(`enableNarratorMode: ${s.enableNarratorMode}`);
        lines.push(`autoGenerateAvatars: ${s.autoGenerateAvatars}`);
        lines.push(`perChatCharacterTracking: ${s.perChatCharacterTracking}`);
        lines.push(`historyPersistence.enabled: ${s.historyPersistence?.enabled}`);
        lines.push(`historyPersistence.injectionPosition: ${s.historyPersistence?.injectionPosition || '(unset)'}`);
        lines.push(`historyPersistence.contextPreamble: ${JSON.stringify(s.historyPersistence?.contextPreamble || '')}`);
        lines.push(`nameBan.enabled: ${s.nameBan?.enabled}`);
        lines.push(`doomCounter.enabled: ${s.doomCounter?.enabled}`);
        lines.push(`theme: ${s.theme || '(unset)'}`);
        lines.push(`activeUserCharacter: ${s.activeUserCharacter || '(none)'}`);
        lines.push(`userCharacters count: ${Object.keys(s.userCharacters || {}).length}`);
    } catch (e) {
        lines.push(`(settings snapshot failed: ${e?.message || e})`);
    }
    try {
        const ctx = (typeof window.SillyTavern?.getContext === 'function') ? window.SillyTavern.getContext() : null;
        if (ctx) {
            lines.push('--- Chat context ---');
            lines.push(`chatId: ${ctx.chatId || '(none)'}`);
            lines.push(`groupId: ${ctx.groupId || '(none)'}`);
            lines.push(`chat length: ${Array.isArray(ctx.chat) ? ctx.chat.length : 'n/a'}`);
            lines.push(`character: ${ctx.name2 || '(none)'}`);
            lines.push(`user: ${ctx.name1 || '(none)'}`);
        }
    } catch {}
    lines.push(`Buffer entries: ${logBuffer.length}`);
    lines.push('===== End header =====');
    lines.push('');
    return lines.join('\n');
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
 * Copies all log entries to clipboard with a diagnostic header so a
 * single paste gives the maintainer DES version + settings + chat
 * context + the captured log lines. Triggers a one-shot version fetch
 * if the cached value isn't ready yet.
 */
function copySystemLog() {
    if (logBuffer.length === 0) {
        toastr.info('No log entries to copy.', '', { timeOut: 2000 });
        return;
    }

    const finish = () => {
        const header = buildDiagnosticHeader();
        const body = logBuffer.map(e =>
            `[${e.timestamp}] [${e.level.toUpperCase()}] ${e.message}`
        ).join('\n');
        const text = header + body;

        navigator.clipboard.writeText(text).then(() => {
            toastr.success(`Copied diagnostic bundle (${logBuffer.length} log entries).`, '', { timeOut: 2500 });
        }).catch(() => {
            toastr.error('Failed to copy to clipboard.', '', { timeOut: 2000 });
        });
    };

    // Resolve version if it hasn't been fetched yet, then copy. Best-effort.
    if (!extensionVersion) {
        getExtensionVersion().finally(finish);
    } else {
        finish();
    }
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
