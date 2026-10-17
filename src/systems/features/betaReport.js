/**
 * Stats beta: "Report a problem" (Settings → Stats). Loaded on the first
 * press. Builds the report from the settings and the two logs, saves the
 * whole of it as a text file to drag into the issue, copies it to the
 * clipboard as well, and opens a GitHub issue with the environment and a
 * condensed tail of the logs filled in: the issue form once it is on the
 * default branch, the issue body until then. The pure part is
 * src/utils/betaReport.js.
 */
import { extensionSettings } from '../../core/state.js';
import { getExtensionVersion } from '../../core/config.js';
import { getContext } from '../../../../../../extensions.js';
import { getSystemLogText } from '../ui/systemLog.js';
import { getNotificationLogText } from '../ui/notificationLog.js';
import {
    environmentLines, logsForUrl, buildReportText, buildIssueUrl, reportFileName,
    ISSUE_TITLE, ISSUE_FORM_CHECK_URL,
} from '../../utils/betaReport.js';

const TITLE = "Doom's Enhancement Suite";

/** Whether the issue form is on the default branch; asked once per session. */
let formOnDefaultBranch = null;

async function issueFormExists() {
    if (formOnDefaultBranch !== null) return formOnDefaultBranch;
    try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 2500);
        const resp = await fetch(ISSUE_FORM_CHECK_URL, { headers: { 'Accept': 'application/vnd.github+json' }, signal: ctrl.signal });
        clearTimeout(timer);
        formOnDefaultBranch = !!resp.ok;
    } catch (e) {
        // Offline, blocked or slow: the body works on any repository.
        formOnDefaultBranch = false;
    }
    return formOnDefaultBranch;
}

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
 * Gather, save, copy, open: in that order. The file and the clipboard need
 * this tab focused, and opening the issue takes the focus away, so the
 * issue opens last; the form check runs alongside the gathering so the
 * whole thing stays inside the click's activation window (about five
 * seconds in Chrome and Firefox).
 */
export async function openBetaReport() {
    const formCheck = issueFormExists();
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

    // The file first, while the click is still fresh: it is the one channel
    // that carries the whole log whatever its size.
    const wanted = reportFileName();
    const saved = downloadText(full, wanted);
    const fileName = saved ? wanted : '';
    const copied = await copyText(full);

    const mode = (await formCheck) ? 'form' : 'body';
    const { url } = buildIssueUrl({ title: ISSUE_TITLE, environment, logs: logsForUrl(notifications, system), mode, fileName });

    const opened = !!window.open(url, '_blank', 'noopener,noreferrer');
    if (!opened) {
        toastr.warning(`The browser blocked the new window. Allow pop-ups for SillyTavern and press Report a problem again.${saved ? ` The full report is in your Downloads as ${wanted}.` : ''}`, TITLE, { timeOut: 10000 });
        return;
    }
    if (saved) {
        toastr.info(`The issue has your version, switches and the last log lines. The full report is in your Downloads as ${wanted}: drag it into the issue.${copied ? ' It is on your clipboard too.' : ''}`, TITLE, { timeOut: 10000 });
    } else if (copied) {
        toastr.info('The issue has your version, switches and the last log lines. The file could not be saved, but the full report is on your clipboard: paste it over the Logs block.', TITLE, { timeOut: 10000 });
    } else {
        toastr.warning('The issue opened, but the full logs could be neither saved nor copied. Use Copy All in the Notification Log and the System Log (Settings → Tools) and paste them in.', TITLE, { timeOut: 10000 });
    }
}
