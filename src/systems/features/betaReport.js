/**
 * Stats beta: "Report a problem" (Settings → Stats). Loaded on the first
 * press. Builds the report from the settings and the two logs, copies the
 * full text to the clipboard (or downloads it when the clipboard is not
 * available), and opens a GitHub issue with the environment and the tail
 * of the logs filled in. The pure part is src/utils/betaReport.js.
 */
import { extensionSettings } from '../../core/state.js';
import { getExtensionVersion } from '../../core/config.js';
import { getContext } from '../../../../../../extensions.js';
import { getSystemLogText } from '../ui/systemLog.js';
import { getNotificationLogText } from '../ui/notificationLog.js';
import { environmentLines, logsForUrl, buildReportText, buildIssueUrl, ISSUE_TITLE } from '../../utils/betaReport.js';

const TITLE = "Doom's Enhancement Suite";

async function copyText(text) {
    try {
        if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(text);
            return true;
        }
    } catch (e) { /* fall through to the textarea route */ }
    try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand('copy');
        ta.remove();
        return !!ok;
    } catch (e) {
        return false;
    }
}

function downloadText(text, filename) {
    try {
        const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        return true;
    } catch (e) {
        return false;
    }
}

/**
 * Gather, copy, open.
 */
export async function openBetaReport() {
    let version = '';
    try { version = (await getExtensionVersion()) || ''; } catch (e) { /* unknown */ }
    let api = '';
    try {
        const ctx = getContext();
        if (ctx && ctx.mainApi) api = String(ctx.mainApi);
    } catch (e) { /* no context */ }
    let userAgent = '';
    try { userAgent = navigator.userAgent; } catch (e) { /* none */ }

    const environment = environmentLines(extensionSettings, { version, api, userAgent });
    const notifications = getNotificationLogText();
    const system = getSystemLogText();
    const full = buildReportText({ environment, notifications, system });
    const { url, truncated } = buildIssueUrl({ title: ISSUE_TITLE, environment, logs: logsForUrl(notifications, system) });

    const copied = await copyText(full);
    let saved = false;
    if (!copied) {
        const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        saved = downloadText(full, `des-beta-report-${stamp}.txt`);
    }

    const win = window.open(url, '_blank', 'noopener,noreferrer');
    if (!win) {
        toastr.warning('The browser blocked the new window. Allow pop-ups for SillyTavern and press Report a problem again.', TITLE, { timeOut: 8000 });
        return;
    }
    if (copied) {
        toastr.info(truncated
            ? 'The issue has your version, switches and the last log lines. The full logs are on your clipboard: paste them into the Logs box.'
            : 'The issue has your version, switches and both logs. The full report is on your clipboard too.', TITLE, { timeOut: 8000 });
    } else if (saved) {
        toastr.info('The issue has your version and switches. The clipboard was not available, so the full logs were saved as a text file: drag it into the issue.', TITLE, { timeOut: 10000 });
    } else {
        toastr.warning('The issue opened, but the logs could not be copied or saved. Use Copy All in the Notification Log and the System Log (Settings → Tools) and paste them in.', TITLE, { timeOut: 10000 });
    }
}
