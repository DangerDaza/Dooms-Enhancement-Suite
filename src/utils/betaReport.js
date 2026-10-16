/**
 * The Stats beta's "Report a problem": what the report holds and how it
 * fits into a GitHub issue URL.
 *
 * Pure. The environment lines come from the settings object, the two logs
 * arrive as text, and the result is a URL that prefills the issue form in
 * .github/ISSUE_TEMPLATE/stats-beta.yml (its fields are keyed by id:
 * title, environment, logs). A URL holds only a few kilobytes, so the logs
 * in it are the tails; the full report text goes to the clipboard, or to a
 * file, in src/systems/features/betaReport.js, which does the reading,
 * copying and opening.
 */
import { attributesConfig, attributesOn } from './d20.js';
import { vitalsConfig, vitalsOn, playerVitalsOn } from './vitals.js';

export const REPO_URL = 'https://github.com/DangerDaza/Dooms-Enhancement-Suite';
export const ISSUE_TEMPLATE = 'stats-beta.yml';
export const ISSUE_TITLE = '[Stats beta] ';
/** Browsers and GitHub both stop reading a URL somewhere past 8,000 characters. */
export const URL_BUDGET = 7000;

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
 * The last part of a text, cut at a line start, marked when anything was
 * left out.
 * @param {string} text
 * @param {number} maxChars
 * @returns {string}
 */
export function tailOf(text, maxChars) {
    const t = typeof text === 'string' ? text : '';
    if (maxChars <= 0) return '';
    if (t.length <= maxChars) return t;
    let cut = t.slice(t.length - maxChars);
    const nl = cut.indexOf('\n');
    if (nl >= 0 && nl < cut.length - 1) cut = cut.slice(nl + 1);
    return `…(earlier lines left out; the full log is on your clipboard)\n${cut}`;
}

/**
 * The two logs as one section for the URL: the tail of each, the budget
 * shared between them.
 * @param {string} notifications
 * @param {string} system
 * @param {number} [maxChars]
 * @returns {string}
 */
export function logsForUrl(notifications, system, maxChars = 2400) {
    const half = Math.floor(maxChars / 2);
    return `== Notification Log ==\n${tailOf(notifications, half)}\n\n== System Log ==\n${tailOf(system, half)}`;
}

/**
 * The whole report, for the clipboard or a file.
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
 * The prefilled issue URL. The logs field shrinks until the URL fits the
 * budget; the title and environment are never cut.
 * @param {{ title?: string, environment?: string, logs?: string }} fields
 * @param {{ budget?: number }} [options]
 * @returns {{ url: string, logs: string, truncated: boolean }}
 */
export function buildIssueUrl({ title = ISSUE_TITLE, environment = '', logs = '' } = {}, { budget = URL_BUDGET } = {}) {
    const enc = encodeURIComponent;
    const fixed = `${REPO_URL}/issues/new?template=${ISSUE_TEMPLATE}&title=${enc(title)}&environment=${enc(environment)}`;
    const all = typeof logs === 'string' ? logs : '';
    const make = (text) => `${fixed}&logs=${enc(text)}`;
    let kept = all;
    let url = make(kept);
    // Encoded length runs about three times the raw length for log text:
    // aim under the room left, then shrink until it fits. Each try tails
    // the original, so the "left out" line never stacks.
    const room = Math.max(0, budget - fixed.length - '&logs='.length);
    let target = Math.min(all.length - 1, Math.floor(room / 3.2));
    let guard = 0;
    while (url.length > budget && target > 0 && guard++ < 60) {
        kept = tailOf(all, target);
        url = make(kept);
        target = Math.floor(target * 0.8);
    }
    if (url.length > budget) {
        kept = '';
        url = make('');
    }
    return { url, logs: kept, truncated: kept.length < (logs || '').length };
}
