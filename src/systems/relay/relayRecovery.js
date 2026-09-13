/**
 * Generation Relay — recovery.
 *
 * When a tab was killed mid-generation (not merely frozen — that case never
 * reaches here, see relayClient.js), the finished reply is still sitting in
 * the des-relay plugin. On every boot, chat change, return to the foreground
 * and network return this module asks the plugin for unconsumed jobs of the
 * open chat and puts each one where it belongs:
 *
 *   - normal / regenerate / swipe replies → straight into the chat when the
 *     chat still looks like it did when the request went out (relayPlan.js
 *     decides; it never overwrites text that is not a prefix of the reply);
 *   - DES's own tracker request → parsed and applied like a separate-mode
 *     update;
 *   - DES-internal helpers (avatar prompts, classifiers) → dropped;
 *   - everything else (quiet prompts from other extensions, continue,
 *     impersonate, anything that no longer fits) → the Recovered Generations
 *     tray, where the text can be copied, put in the input box, added as a
 *     reply, or dismissed.
 *
 * A job is "consumed" (deleted on the server) only after it has been applied
 * or dismissed, so a second device or a crash in between cannot lose it.
 */
import {
    chat,
    eventSource,
    event_types,
    saveReply,
    saveChatConditional,
    updateMessageBlock,
    syncMesToSwipe,
    extractMessageFromData,
    cleanUpMessage,
} from '../../../../../../../script.js';
import { getStreamingReply } from '../../../../../../openai.js';
import { extractReasoningFromData, parseReasoningFromString } from '../../../../../../reasoning.js';
import { power_user } from '../../../../../../power-user.js';
import { extensionSettings } from '../../core/state.js';
import { applySeparateTrackerResponse } from '../generation/apiClient.js';
import {
    isRelayEnabled,
    probeRelay,
    relayFetch,
    currentChatKey,
    drivenState,
    isGeneratePending,
    consumeJob,
} from './relayClient.js';
import { planReplyApply, foldStream, CHAT_KINDS, DES_TRACKER_KIND, DES_INTERNAL_KIND } from './relayPlan.js';

const LOG = '[DES Relay]';
const FINISHED = new Set(['done', 'error', 'aborted']);
const WATCH_POLL_MS = 4000;
const SCAN_DEBOUNCE_MS = 400;

/* ------------------------------------------------------------------ */
/* tray store                                                          */
/* ------------------------------------------------------------------ */

/**
 * @typedef {object} TrayItem
 * @property {string} id            relay job id
 * @property {string} kind          generation kind (normal, quiet, raw, …)
 * @property {string} chatId        chat key the job belongs to
 * @property {boolean} running      still generating on the server
 * @property {string} text          recovered reply text ('' while running)
 * @property {string} reasoning
 * @property {string|null} error
 * @property {number} startedAt
 * @property {number} endedAt
 * @property {string} reason        why it was not applied automatically
 */

/** @type {Map<string, TrayItem>} */
const tray = new Map();
const trayListeners = new Set();
const watching = new Map();   // jobId → { timer }
let scanPromise = null;
let scanTimer = null;
let initialized = false;

function notifyTray() {
    for (const fn of trayListeners) {
        try {
            fn(getTrayItems());
        } catch (e) {
            console.warn(LOG, 'tray listener failed', e);
        }
    }
}

/** @returns {TrayItem[]} newest first */
export function getTrayItems() {
    return [...tray.values()].sort((a, b) => (b.endedAt || b.startedAt) - (a.endedAt || a.startedAt));
}

export function getTrayCount() {
    return tray.size;
}

/** @param {(items: TrayItem[]) => void} fn @returns {() => void} */
export function onTrayChange(fn) {
    trayListeners.add(fn);
    return () => trayListeners.delete(fn);
}

function trayPut(item) {
    tray.set(item.id, item);
    notifyTray();
}

function trayDrop(id) {
    if (tray.delete(id)) notifyTray();
}

/* ------------------------------------------------------------------ */
/* reading a finished job                                              */
/* ------------------------------------------------------------------ */

/**
 * Fetches the stored backend response and turns it into reply text.
 * @returns {Promise<{text: string, reasoning: string, error: string|null, pending?: boolean}>}
 */
async function readJobPayload(job) {
    const res = await relayFetch(`/jobs/${encodeURIComponent(job.id)}/result`);
    if (res.status === 202) return { pending: true, text: '', reasoning: '', error: null };
    const raw = await res.text();
    if (!res.ok) {
        let message = raw.slice(0, 400);
        try {
            const parsed = JSON.parse(raw);
            message = parsed?.error?.message || parsed?.message || message;
        } catch { /* plain text error */ }
        return { text: '', reasoning: '', error: `${res.status}: ${message}` };
    }
    const source = job.meta?.source || null;
    if (job.stream) {
        const folded = foldStream(raw, (parsed, state) => getStreamingReply(parsed, state, { chatCompletionSource: source }));
        return { text: folded.text, reasoning: folded.reasoning, error: folded.error };
    }
    let data;
    try {
        data = JSON.parse(raw);
    } catch {
        return { text: raw, reasoning: '', error: null };
    }
    if (data && data.error) {
        return { text: '', reasoning: '', error: String(data.error.message || data.error) };
    }
    let text = '';
    let reasoning = '';
    try {
        text = extractMessageFromData(data, 'openai') || '';
        reasoning = extractReasoningFromData(data, { mainApi: 'openai', chatCompletionSource: source }) || '';
    } catch (e) {
        console.warn(LOG, 'could not extract reply text', e);
    }
    return { text, reasoning, error: null };
}

/**
 * The same finalisation ST applies to a live reply (names, stop strings,
 * incomplete-sentence trim, auto-parsed reasoning) so a reply ST already
 * saved compares equal to the recovered one and is recognised as present.
 * @returns {{text: string, reasoning: string}}
 */
function tidyReply(text, reasoning = '') {
    let out = text;
    try {
        out = cleanUpMessage({ getMessage: text, isImpersonate: false, isContinue: false, displayIncompleteSentences: false }) || text;
    } catch { /* keep raw */ }
    try {
        if (power_user?.reasoning?.auto_parse) {
            const parsed = parseReasoningFromString(out);
            if (parsed && typeof parsed.content === 'string') {
                out = parsed.content;
                if (!reasoning && parsed.reasoning) reasoning = parsed.reasoning;
            }
        }
    } catch { /* keep as is */ }
    return { text: out, reasoning };
}

/* ------------------------------------------------------------------ */
/* applying to the chat                                                */
/* ------------------------------------------------------------------ */

function emitRendered(index, kind) {
    return eventSource.emit(event_types.MESSAGE_RECEIVED, index, kind)
        .then(() => eventSource.emit(event_types.CHARACTER_MESSAGE_RENDERED, index, kind));
}

async function replaceMessageText(index, text, reasoning, kind) {
    const message = chat[index];
    message.mes = text;
    if (!message.extra || typeof message.extra !== 'object') message.extra = {};
    if (reasoning) message.extra.reasoning = reasoning;
    message.gen_finished = new Date();
    syncMesToSwipe(index);
    updateMessageBlock(index, message);
    await emitRendered(index, kind);
    await saveChatConditional();
}

async function appendReply(text, reasoning) {
    await saveReply({ type: 'normal', getMessage: text, reasoning: reasoning || '' });
    await saveChatConditional();
}

async function addSwipe(index, text, reasoning) {
    const message = chat[index];
    if (!Array.isArray(message.swipes)) message.swipes = [message.mes ?? ''];
    if (!Array.isArray(message.swipe_info)) message.swipe_info = [];
    message.swipe_id = message.swipes.length;
    await saveReply({ type: 'swipe', getMessage: text, reasoning: reasoning || '' });
    await saveChatConditional();
}

async function replaceSwipe(index, swipeId, text, reasoning, kind) {
    const message = chat[index];
    message.swipes[swipeId] = text;
    if (message.swipe_id === swipeId) {
        await replaceMessageText(index, text, reasoning, kind);
    } else {
        await saveChatConditional();
    }
}

/**
 * @returns {Promise<'applied'|'noop'|'tray'>}
 */
async function applyChatReply(job, payload) {
    const { text, reasoning } = tidyReply(payload.text, payload.reasoning);
    const plan = planReplyApply(job.meta, chat, text);
    const kind = job.meta.kind;
    switch (plan.action) {
        case 'append':
            await appendReply(text, reasoning);
            return 'applied';
        case 'replace':
            await replaceMessageText(plan.index, text, reasoning, kind);
            return 'applied';
        case 'swipe-add':
            await addSwipe(plan.index, text, reasoning);
            return 'applied';
        case 'swipe-replace':
            await replaceSwipe(plan.index, plan.swipeId, text, reasoning, kind);
            return 'applied';
        case 'noop':
            return 'noop';
        default:
            return 'tray';
    }
}

/* ------------------------------------------------------------------ */
/* per-job handling                                                    */
/* ------------------------------------------------------------------ */

function kindLabel(kind) {
    switch (kind) {
        case 'normal': return 'Reply';
        case 'regenerate': return 'Regenerated reply';
        case 'swipe': return 'Swipe';
        case 'continue': return 'Continue';
        case 'impersonate': return 'Impersonation';
        case 'quiet': return 'Quiet prompt';
        case DES_TRACKER_KIND: return 'Tracker update';
        case 'raw': return 'Background request';
        default: return kind || 'Generation';
    }
}

function toTray(job, payload, reason) {
    trayPut({
        id: job.id,
        kind: job.meta?.kind || 'raw',
        label: kindLabel(job.meta?.kind),
        chatId: job.meta?.chatId || '',
        running: false,
        text: payload?.text || '',
        reasoning: payload?.reasoning || '',
        error: payload?.error || (job.status !== 'done' ? (job.error || `generation ${job.status}`) : null),
        startedAt: job.startedAt || 0,
        endedAt: job.endedAt || Date.now(),
        reason,
    });
}

/**
 * Handles one finished job for the open chat.
 * @returns {Promise<'applied'|'tray'|'dropped'>}
 */
async function handleFinished(job, chatKey) {
    const kind = job.meta?.kind || 'raw';
    if (kind === DES_INTERNAL_KIND || job.status === 'aborted') {
        await consumeJob(job.id);
        return 'dropped';
    }
    const payload = await readJobPayload(job);
    if (payload.pending) return 'dropped';
    if (currentChatKey() !== chatKey) return 'dropped'; // chat changed under us; next scan retries

    if (payload.error || job.status !== 'done') {
        if (kind === DES_TRACKER_KIND) {
            await consumeJob(job.id);
            return 'dropped';
        }
        toTray(job, payload, 'error');
        return 'tray';
    }
    if (!payload.text || !payload.text.trim()) {
        await consumeJob(job.id);
        return 'dropped';
    }

    if (kind === DES_TRACKER_KIND) {
        // The tracker describes the reply that was last when it was requested
        // (messageIndex = chat length at that moment). If the chat has moved
        // on, stale tracker data must not be written onto a newer message.
        if (Number.isInteger(job.meta?.messageIndex) && job.meta.messageIndex !== chat.length) {
            await consumeJob(job.id);
            return 'dropped';
        }
        try {
            await applySeparateTrackerResponse(payload.text);
        } catch (e) {
            console.warn(LOG, 'tracker apply failed', e);
        }
        await consumeJob(job.id);
        return 'applied';
    }

    if (CHAT_KINDS.has(kind)) {
        let outcome = 'tray';
        try {
            outcome = await applyChatReply(job, payload);
        } catch (e) {
            console.warn(LOG, 'apply failed, sending to tray', e);
        }
        if (outcome === 'tray') {
            toTray(job, payload, 'conflict');
            return 'tray';
        }
        await consumeJob(job.id);
        return outcome === 'applied' ? 'applied' : 'dropped';
    }

    toTray(job, payload, 'kind');
    return 'tray';
}

/** Follows a job that is still generating on the server after this tab reopened. */
function watchRunning(job, chatKey) {
    if (watching.has(job.id)) return;
    trayPut({
        id: job.id,
        kind: job.meta?.kind || 'raw',
        label: kindLabel(job.meta?.kind),
        chatId: job.meta?.chatId || '',
        running: true,
        text: '',
        reasoning: '',
        error: null,
        startedAt: job.startedAt || Date.now(),
        endedAt: 0,
        reason: 'running',
    });
    const entry = { timer: null };
    watching.set(job.id, entry);
    const tick = async () => {
        if (drivenState(job.id)) {
            // This tab started streaming it after all (a scan raced the POST).
            watching.delete(job.id);
            trayDrop(job.id);
            return;
        }
        try {
            const res = await relayFetch(`/jobs/${encodeURIComponent(job.id)}`);
            if (res.status === 404) {
                watching.delete(job.id);
                trayDrop(job.id);
                return;
            }
            if (res.ok) {
                const fresh = await res.json();
                if (FINISHED.has(fresh.status)) {
                    watching.delete(job.id);
                    trayDrop(job.id);
                    if (currentChatKey() === chatKey) {
                        const outcome = await handleFinished(fresh, chatKey);
                        announce({ applied: outcome === 'applied' ? 1 : 0, tray: outcome === 'tray' ? 1 : 0 });
                    }
                    return;
                }
            }
        } catch (e) {
            console.debug(LOG, 'watch poll failed', e?.message || e);
        }
        entry.timer = setTimeout(tick, WATCH_POLL_MS);
    };
    entry.timer = setTimeout(tick, WATCH_POLL_MS);
}

/* ------------------------------------------------------------------ */
/* scanning                                                            */
/* ------------------------------------------------------------------ */

let openTrayHandler = null;
/** The UI registers how to open the tray so toasts can deep-link to it. */
export function setTrayOpener(fn) {
    openTrayHandler = fn;
}

function announce({ applied = 0, tray: trayed = 0 }) {
    if (typeof toastr === 'undefined') return;
    if (applied > 0) {
        toastr.success(
            applied === 1 ? 'A reply that finished while the app was away has been added to the chat.' : `${applied} replies that finished while the app was away have been added to the chat.`,
            'Generation Relay', { timeOut: 6000 });
    }
    if (trayed > 0) {
        toastr.info(
            trayed === 1 ? 'A generation finished while you were away. Tap to see it.' : `${trayed} generations finished while you were away. Tap to see them.`,
            'Generation Relay', { timeOut: 10000, onclick: () => openTrayHandler?.() });
    }
}

async function doScan(reason) {
    if (!extensionSettings.enabled || !isRelayEnabled()) return;
    const connection = await probeRelay();
    if (connection.state !== 'connected') return;
    const chatKey = currentChatKey();
    if (!chatKey) return;
    const scanStartedAt = Date.now();
    const res = await relayFetch(`/jobs?chatId=${encodeURIComponent(chatKey)}`);
    if (!res.ok) return;
    const { jobs } = await res.json();
    if (!Array.isArray(jobs) || !jobs.length) return;
    let applied = 0;
    let trayed = 0;
    for (const job of jobs) {
        if (currentChatKey() !== chatKey) break;
        const live = drivenState(job.id);
        if (live && !live.settled) continue;            // this tab is streaming it right now
        if (live && live.settled && live.ok) {          // finished here; ST already has it
            consumeJob(job.id);
            continue;
        }
        if (!FINISHED.has(job.status)) {
            // A job this tab is creating right now is not yet in `driven`;
            // never adopt a running job younger than this scan or while a
            // POST /generate is in flight.
            if (isGeneratePending() || (job.startedAt || 0) >= scanStartedAt - 2000) continue;
            watchRunning(job, chatKey);
            continue;
        }
        if (watching.has(job.id) || tray.has(job.id)) continue;
        try {
            const outcome = await handleFinished(job, chatKey);
            if (outcome === 'applied') applied++;
            if (outcome === 'tray') trayed++;
        } catch (e) {
            console.warn(LOG, `recovery of job ${job.id} failed (${reason})`, e);
        }
    }
    announce({ applied, tray: trayed });
}

/** Runs one recovery scan (deduplicated while one is in flight). */
export function scanRelayJobs(reason = 'manual') {
    if (scanPromise) return scanPromise;
    scanPromise = doScan(reason)
        .catch(e => console.warn(LOG, 'scan failed', e))
        .finally(() => { scanPromise = null; });
    return scanPromise;
}

function scheduleScan(reason) {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(() => scanRelayJobs(reason), SCAN_DEBOUNCE_MS);
}

/* ------------------------------------------------------------------ */
/* tray actions (used by relayUI.js)                                   */
/* ------------------------------------------------------------------ */

export async function dismissTrayItem(id) {
    const item = tray.get(id);
    trayDrop(id);
    const watcher = watching.get(id);
    if (watcher) {
        clearTimeout(watcher.timer);
        watching.delete(id);
        try {
            await relayFetch(`/jobs/${encodeURIComponent(id)}/abort`, { method: 'POST' });
        } catch { /* best effort */ }
    }
    if (item) await consumeJob(id);
}

/** Puts the text into the send box (does not send). */
export async function insertTrayItemIntoInput(id) {
    const item = tray.get(id);
    if (!item || !item.text) return false;
    const $box = $('#send_textarea');
    if (!$box.length) return false;
    const existing = String($box.val() || '');
    $box.val(existing ? `${existing}\n${item.text}` : item.text);
    $box[0].dispatchEvent(new Event('input', { bubbles: true }));
    await dismissTrayItem(id);
    return true;
}

/** Appends the text as a new character reply in the open chat. */
export async function addTrayItemAsReply(id) {
    const item = tray.get(id);
    if (!item || !item.text) return false;
    if (item.chatId && currentChatKey() !== item.chatId) return false;
    const tidy = tidyReply(item.text, item.reasoning);
    await appendReply(tidy.text, tidy.reasoning);
    await dismissTrayItem(id);
    return true;
}

/* ------------------------------------------------------------------ */
/* events                                                              */
/* ------------------------------------------------------------------ */

export function onRelayChatChanged() {
    // Items belong to the chat they were found in; a new chat gets a fresh scan.
    for (const [id, watcher] of watching) {
        clearTimeout(watcher.timer);
        watching.delete(id);
    }
    if (tray.size) {
        tray.clear();
        notifyTray();
    }
    scheduleScan('chat');
}

export function initRelayRecovery() {
    if (initialized) return;
    initialized = true;
    if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') scheduleScan('visible');
        });
    }
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
        window.addEventListener('online', () => scheduleScan('online'));
        window.addEventListener('pageshow', (e) => { if (e.persisted) scheduleScan('pageshow'); });
    }
    scheduleScan('boot');
}
