/**
 * The Stats beta's "Report a problem": what the report holds and how it
 * fits into a GitHub issue URL.
 *
 * Pure. The environment lines come from the settings object, the two logs
 * arrive as text, and the result is a URL that prefills a GitHub issue:
 * the form in .github/ISSUE_TEMPLATE/stats-beta.yml (fields by id: title,
 * environment, logs) once it is on the default branch, else the issue body
 * as Markdown. GitHub refuses a URL past about 8,150 characters (measured:
 * 8,150 accepted, 8,208 refused with 414), and log text roughly triples
 * when encoded, so the URL carries a condensed tail of the logs; the whole
 * report goes into a file and onto the clipboard in
 * src/systems/features/betaReport.js, which does the reading, saving,
 * copying and opening.
 */
import { attributesConfig, attributesOn } from './d20.js';
import { vitalsConfig, vitalsOn, playerVitalsOn } from './vitals.js';

export const REPO_URL = 'https://github.com/DangerDaza/Dooms-Enhancement-Suite';
export const ISSUE_TEMPLATE = 'stats-beta.yml';
export const ISSUE_TITLE = '[Stats beta] ';
/**
 * GitHub reads issue forms from the default branch only. Until the beta is
 * on main, this path answers 404 and the report goes into the issue body.
 */
export const ISSUE_FORM_CHECK_URL = `https://api.github.com/repos/DangerDaza/Dooms-Enhancement-Suite/contents/.github/ISSUE_TEMPLATE/${ISSUE_TEMPLATE}`;
/** Right under GitHub's measured ceiling of about 8,150 characters. */
export const URL_BUDGET = 8000;
/** What the logs tail says when it was cut. */
export const LEFT_OUT_LINE = '…(earlier lines left out; the report file and your clipboard have the whole log)';

const onOff = (v) => (v ? 'on' : 'off');

/**
 * One line per thing the maintainer asks first.
 * @param {object} settings - extensionSettings
 * @param {{ version?: string, api?: string, userAgent?: string }} [extra]
 * @returns {string}
 */
export function environmentLines(settings, { version = '', api = '', userAgent = '' } = {}) {
    const s = settings || {};
    const lines = [];
    lines.push(`DES ${version || 'unknown version'}`);
    lines.push(`Generation mode: ${s.generationMode || 'together'}`);
    lines.push(`Tracker instructions: ${s.customTrackerInstructionsPrompt ? 'custom override' : 'default'}`);
    let vit = 'off';
    if (vitalsOn(s)) {
        const cfg = vitalsConfig(s);
        const all = Array.isArray(cfg.customStats) ? cfg.customStats : [];
        const live = all.filter(v => v && v.enabled !== false).length;
        vit = `on (${live} of ${all.length} vitals on, persona ${onOff(playerVitalsOn(s))})`;
    }
    lines.push(`Vitals: ${vit}`);
    if (attributesOn(s)) {
        const a = attributesConfig(s);
        const calls = a.aiCalls || {};
        lines.push('Attributes & checks: on');
        lines.push(`  Calls: ${calls.enabled === false ? 'off' : `on (line ${onOff(calls.tag !== false)}, tool ${onOff(calls.tool !== false)}, NPCs ${onOff(calls.npcs !== false)}, ${calls.frequency || 'sparingly'})`}`);
        lines.push(`  Scores to the AI: ${a.sendToAI || 'withRoll'}; override ${onOff(a.allowOverride)}; notify ${onOff(a.notify !== false)}; proficiency bonus ${a.proficiencyBonus ?? 2}`);
    } else {
        lines.push('Attributes & checks: off');
    }
    lines.push(`Fetch the tracker when a reply skips it: ${onOff(s.recoverMissingTracker !== false)}`);
    lines.push(`Tracker data in chat: ${onOff(s.showTrackerJsonInChat)}`);
    lines.push(`UI setup: ${s.uiSetup || 'classic'}; theme: ${s.theme || 'default'}`);
    if (api) lines.push(`API: ${api}`);
    if (userAgent) lines.push(`Browser: ${userAgent}`);
    return lines.join('\n');
}

/**
 * Whether a line is a stack frame ("    at fn (file:line)").
 * @param {string} line
 */
function isFrame(line) {
    return /^\s+at\s/.test(line);
}

/**
 * The log with stack traces folded to one line each, for the URL. A
 * SillyTavern error at page load carries a dozen frames; in a 2,000
 * character tail they are most of the space. The frames stay in the file
 * and on the clipboard.
 * @param {string} text
 * @returns {string}
 */
export function condenseForUrl(text) {
    const t = typeof text === 'string' ? text : '';
    if (!t) return t;
    const out = [];
    let frames = 0;
    const flush = () => {
        if (frames > 0) {
            out.push(`    … ${frames} stack frame${frames === 1 ? '' : 's'} (in the report file)`);
            frames = 0;
        }
    };
    for (const line of t.split('\n')) {
        if (isFrame(line)) { frames++; continue; }
        flush();
        out.push(line);
    }
    flush();
    return out.join('\n');
}

/**
 * The last part of a text, opening on a whole log entry when one can be
 * found (a line starting with "["), else on a whole line, and marked when
 * anything was left out.
 * @param {string} text
 * @param {number} maxChars
 * @returns {string}
 */
export function tailOf(text, maxChars) {
    const t = typeof text === 'string' ? text : '';
    if (maxChars <= 0) return '';
    if (t.length <= maxChars) return t;
    let cut = t.slice(t.length - maxChars);
    const entry = cut.indexOf('\n[');
    const nl = cut.indexOf('\n');
    if (entry >= 0 && entry < cut.length - 2) cut = cut.slice(entry + 1);
    else if (nl >= 0 && nl < cut.length - 1) cut = cut.slice(nl + 1);
    return `${LEFT_OUT_LINE}\n${cut}`;
}

/**
 * Whether a Notification Log text holds nothing.
 * @param {string} notifications
 */
function noNotifications(notifications) {
    const t = typeof notifications === 'string' ? notifications.trim() : '';
    return !t || /^\(no notifications/i.test(t);
}

/**
 * The two logs as one section for the URL: the condensed tail of each, the
 * System Log taking two thirds of the room, or all of it when there are no
 * notifications to show.
 * @param {string} notifications
 * @param {string} system
 * @param {number} [maxChars]
 * @returns {string}
 */
export function logsForUrl(notifications, system, maxChars = 2400) {
    const sys = condenseForUrl(system);
    if (noNotifications(notifications)) {
        return `== Notification Log ==\n(none since the page loaded)\n\n== System Log ==\n${tailOf(sys, maxChars)}`;
    }
    const sysShare = Math.floor((maxChars * 2) / 3);
    const notifShare = Math.max(0, maxChars - sysShare);
    return `== Notification Log ==\n${tailOf(condenseForUrl(notifications), notifShare)}\n\n== System Log ==\n${tailOf(sys, sysShare)}`;
}

/**
 * The whole report, for the file and the clipboard.
 * @param {{ environment: string, notifications: string, system: string }} parts
 * @returns {string}
 */
export function buildReportText({ environment, notifications, system }) {
    return [
        '===== Doom\'s Enhancement Suite — Stats beta report =====',
        '',
        '== Environment ==',
        environment || '',
        '',
        '== Notification Log ==',
        notifications || '(empty)',
        '',
        '== System Log ==',
        system || '(empty)',
        '',
    ].join('\n');
}

/**
 * The file name the full report is saved under.
 * @param {Date} [now]
 * @returns {string}
 */
export function reportFileName(now = new Date()) {
    const stamp = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
    return `des-beta-report-${stamp}.txt`;
}

/**
 * The sentence that tells the tester where the whole log is.
 * @param {string} [fileName] - '' when no file could be saved
 */
function whereTheRestIs(fileName) {
    return fileName
        ? `The full report, both logs complete, was saved to your Downloads as ${fileName}: drag that file into this issue.`
        : 'The full report, both logs complete, is on your clipboard: paste it over this block.';
}

/**
 * The issue body for a repository without the form (the default branch
 * before the beta is merged): the form's sections as Markdown headings.
 * @param {{ environment?: string, logs?: string, fileName?: string }} parts
 * @returns {string}
 */
export function buildIssueBody({ environment = '', logs = '', fileName = '' } = {}) {
    return [
        '### What happened',
        '',
        'What you did, what DES did. A screenshot of the box, the chip or the panel helps.',
        '',
        '### What you expected',
        '',
        '',
        '### Environment',
        '',
        '```text',
        environment,
        '```',
        '',
        '### Logs',
        '',
        `The last lines of the System Log (and the Notification Log when it has any). ${whereTheRestIs(fileName)}`,
        '',
        '```text',
        logs,
        '```',
        '',
        '### Chat export',
        '',
        'In SillyTavern: the chat menu (the three lines above the message box) → Manage chat files → Export (JSONL). Zip the file and drag it here.',
        '',
    ].join('\n');
}

/**
 * The prefilled issue URL. In 'form' mode the fields of the issue form are
 * filled by id; in 'body' mode (no form on the default branch) the report
 * goes into the issue body as Markdown. Either way the logs shrink until
 * the URL fits the budget; the title, the environment and the line that
 * says where the whole log is are never cut.
 * @param {{ title?: string, environment?: string, logs?: string, mode?: 'form'|'body', fileName?: string }} fields
 * @param {{ budget?: number }} [options]
 * @returns {{ url: string, logs: string, truncated: boolean, mode: string }}
 */
export function buildIssueUrl({ title = ISSUE_TITLE, environment = '', logs = '', mode = 'form', fileName = '' } = {}, { budget = URL_BUDGET } = {}) {
    const enc = encodeURIComponent;
    const all = typeof logs === 'string' ? logs : '';
    const make = mode === 'body'
        ? (text) => `${REPO_URL}/issues/new?title=${enc(title)}&body=${enc(buildIssueBody({ environment, logs: text, fileName }))}`
        : (text) => `${REPO_URL}/issues/new?template=${ISSUE_TEMPLATE}&title=${enc(title)}&environment=${enc(environment)}&logs=${enc(`${whereTheRestIs(fileName)}\n\n${text}`)}`;
    let kept = all;
    let url = make(kept);
    // Measure how much the encoding grows this text (log lines run about
    // 1.5×: spaces, brackets and colons become three characters each), aim
    // the tail at the room left, then shrink until it fits. Each try tails
    // the original, so the "left out" line never stacks.
    const ratio = all.length ? Math.max(1, enc(all).length / all.length) : 1;
    const room = Math.max(0, budget - make('').length);
    let target = Math.min(all.length - 1, Math.floor(room / ratio - LEFT_OUT_LINE.length - 2));
    let guard = 0;
    while (url.length > budget && target > 0 && guard++ < 60) {
        kept = tailOf(all, target);
        url = make(kept);
        target = Math.floor(target * 0.9);
    }
    if (url.length > budget) {
        kept = '';
        url = make('');
    }
    return { url, logs: kept, truncated: kept.length < all.length, mode };
}
