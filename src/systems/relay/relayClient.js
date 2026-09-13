/**
 * Generation Relay — client side.
 *
 * When the des-relay server plugin is installed (server-plugin/des-relay),
 * every chat-completion generation SillyTavern would send straight to
 * `/api/backends/chat-completions/generate` is sent to the plugin instead.
 * The plugin owns the upstream request; this module hands SillyTavern a
 * Response whose body is read from the plugin *by byte offset*, so a frozen
 * tab (phone locked, app backgrounded, tunnel hiccup) simply resumes where
 * it left off when it wakes. SillyTavern's own request code
 * (`sendOpenAIRequest`, the streaming processor, saveReply) is untouched.
 *
 * If the tab is killed instead of frozen, relayRecovery.js picks the finished
 * job up from the plugin on the next open.
 *
 * Nothing here runs unless the plugin answered the `/info` handshake; without
 * it the fetch wrapper is a transparent pass-through.
 */
import { getRequestHeaders, saveChatConditional } from '../../../../../../../script.js';
import { getContext } from '../../../../../../extensions.js';
import { extensionSettings } from '../../core/state.js';
import { chatKeyOf, resolveMarker, CHAT_KINDS, DES_INTERNAL_KIND } from './relayPlan.js';

export const RELAY_BASE = '/api/plugins/des-relay';
export const RELAY_PROTOCOL = 1;
const GENERATE_SUFFIX = '/api/backends/chat-completions/generate';
const META_HEADER = 'X-DES-Relay-Meta';
const LOG = '[DES Relay]';
const MAX_FAILURES = 40;          // × backoff (capped at 15 s) ≈ 10 minutes of reconnecting
const MAX_BACKOFF_MS = 15000;
const RESULT_WAIT_MS = 25000;     // long-poll length; under Cloudflare's 100 s cap
const MISSING_RECHECK_MS = 60000;
const CONSUME_DELAY_MS = 1500;    // after GENERATION_ENDED, so ST's chat save is on disk first
const FINISHED = new Set(['done', 'error', 'aborted']);

/* ------------------------------------------------------------------ */
/* state                                                               */
/* ------------------------------------------------------------------ */

/** The fetch that was on window before the wrapper — every relay call uses it. */
let realFetch = null;

/** @type {{state: 'unknown'|'connected'|'missing'|'disabled', info: object|null, checkedAt: number, error: string|null}} */
let connection = { state: 'unknown', info: null, checkedAt: 0, error: null };
const statusListeners = new Set();

/** Markers describing the request about to be sent (see relayPlan.resolveKind). */
let started = null;   // { type, at }  — from GENERATION_STARTED
let tagged = null;    // { kind, at }  — from markNextRelayKind / withRelayKind

/**
 * Jobs this tab is driving live. `settled` = our read loop is over;
 * `ok` = nothing is left on the server worth recovering (consume it).
 * @type {Map<string, {id: string, kind: string, stream: boolean, settled: boolean, ok: boolean, chatId: string}>}
 */
const driven = new Map();
/** Set while a POST /generate is in flight (the server may already hold the job). */
let pendingGenerates = 0;
let generating = false;
let wakeLock = null;
let initialized = false;

/* ------------------------------------------------------------------ */
/* small helpers                                                       */
/* ------------------------------------------------------------------ */

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const isAbortError = (e) => e && (e.name === 'AbortError' || e.code === 20);

function abortError() {
    try {
        return new DOMException('The user aborted a request.', 'AbortError');
    } catch {
        const e = new Error('The user aborted a request.');
        e.name = 'AbortError';
        return e;
    }
}

function throwIfAborted(signal) {
    if (signal?.aborted) throw abortError();
}

function newJobId() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    // http:// on a LAN has no crypto.randomUUID; RFC 4122 v4 from Math.random is fine for a job id
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = Math.random() * 16 | 0;
        return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
}

function sseErrorEvent(message) {
    return new TextEncoder().encode(`data: ${JSON.stringify({ error: { message } })}\n\n`);
}

async function backoff(failures, signal) {
    const ms = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** Math.max(0, failures - 1));
    await sleep(ms);
    throwIfAborted(signal);
}

function setConnection(state, info, error) {
    connection = { state, info, checkedAt: Date.now(), error };
    for (const fn of statusListeners) {
        try {
            fn(connection);
        } catch (e) {
            console.warn(LOG, 'status listener failed', e);
        }
    }
    return connection;
}

/* ------------------------------------------------------------------ */
/* public state API                                                    */
/* ------------------------------------------------------------------ */

export function isRelayEnabled() {
    return extensionSettings.enabled !== false && extensionSettings.relay?.enabled !== false;
}

export function isRelayActive() {
    return isRelayEnabled() && connection.state === 'connected';
}

export function getRelayConnection() {
    return connection;
}

/** @param {(c: typeof connection) => void} fn @returns {() => void} unsubscribe */
export function onRelayStatus(fn) {
    statusListeners.add(fn);
    return () => statusListeners.delete(fn);
}

/** Stable identity of the open chat (null in group chats / no chat). */
export function currentChatKey() {
    try {
        const ctx = getContext();
        return chatKeyOf({
            groupId: ctx.groupId,
            characterAvatar: ctx.characters?.[ctx.characterId]?.avatar,
            chatId: ctx.chatId,
        });
    } catch {
        return null;
    }
}

/** The relay-facing fetch: bypasses the wrapper, adds ST's CSRF header. */
export function relayFetch(path, init = {}) {
    const doFetch = realFetch || window.fetch;
    const method = (init.method || 'GET').toUpperCase();
    const headers = { ...getRequestHeaders({ omitContentType: method === 'GET' }), ...(init.headers || {}) };
    return doFetch.call(window, `${RELAY_BASE}${path}`, { ...init, method, headers, cache: 'no-store' });
}

export function drivenState(jobId) {
    return driven.get(jobId) || null;
}

/** True while this tab is creating a job (its id is not yet in `driven`). */
export function isGeneratePending() {
    return pendingGenerates > 0;
}

/** Marks the next generate request as DES's own (des-tracker / des-internal). */
export function markNextRelayKind(kind) {
    tagged = { kind, at: Date.now() };
}

/**
 * Runs `fn` with the next generate request tagged as `kind`; clears the tag
 * afterwards if no request consumed it (so it can never leak onto a later
 * user generation).
 */
export async function withRelayKind(kind, fn) {
    const marker = { kind, at: Date.now() };
    tagged = marker;
    try {
        return await fn();
    } finally {
        if (tagged === marker) tagged = null;
    }
}

/* ------------------------------------------------------------------ */
/* handshake                                                           */
/* ------------------------------------------------------------------ */

/**
 * Asks the plugin whether it is there. Cached: a connected answer sticks
 * until a request fails, a missing answer is re-tried at most once a minute.
 */
export async function probeRelay({ force = false } = {}) {
    if (!isRelayEnabled()) return setConnection('disabled', null, null);
    if (!force) {
        if (connection.state === 'connected') return connection;
        if (connection.state === 'missing' && Date.now() - connection.checkedAt < MISSING_RECHECK_MS) return connection;
    }
    try {
        const res = await relayFetch('/info');
        if (res.status === 404) return setConnection('missing', null, 'plugin not installed (404)');
        if (!res.ok) return setConnection('missing', null, `HTTP ${res.status}`);
        const info = await res.json();
        if (info?.protocol !== RELAY_PROTOCOL) {
            return setConnection('missing', info, `plugin protocol ${info?.protocol ?? '?'} does not match ${RELAY_PROTOCOL}`);
        }
        return setConnection('connected', info, null);
    } catch (e) {
        return setConnection('missing', null, e?.message || String(e));
    }
}

/* ------------------------------------------------------------------ */
/* job plumbing                                                        */
/* ------------------------------------------------------------------ */

export async function consumeJob(jobId) {
    driven.delete(jobId);
    try {
        const res = await relayFetch(`/jobs/${encodeURIComponent(jobId)}/consume`, { method: 'POST' });
        return res.ok || res.status === 404 || res.status === 409;
    } catch (e) {
        console.debug(LOG, 'consume failed (will retry on next scan)', e);
        return false;
    }
}

export async function abortJob(jobId) {
    const job = driven.get(jobId);
    if (job) job.settled = true;
    try {
        await relayFetch(`/jobs/${encodeURIComponent(jobId)}/abort`, { method: 'POST' });
    } catch (e) {
        console.debug(LOG, 'abort failed', e);
    }
    // ST keeps whatever streamed in before the stop; nothing left to recover.
    await consumeJob(jobId);
}

async function getJobStatus(jobId, signal) {
    const res = await relayFetch(`/jobs/${encodeURIComponent(jobId)}`, { signal });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`relay status ${res.status}`);
    return res.json();
}

function openStream(jobId, offset, signal) {
    return relayFetch(`/jobs/${encodeURIComponent(jobId)}/stream?offset=${offset}`, { signal });
}

/* ------------------------------------------------------------------ */
/* the interception                                                    */
/* ------------------------------------------------------------------ */

function requestUrl(input) {
    if (typeof input === 'string') return input;
    if (input && typeof input === 'object') {
        if (typeof input.href === 'string') return input.href;
        if (typeof input.url === 'string') return input.url;
    }
    return '';
}

function shouldRelay(url, init) {
    if (!isRelayActive()) return false;
    if (!url || !url.split('?')[0].endsWith(GENERATE_SUFFIX)) return false;
    if ((init?.method || 'GET').toUpperCase() !== 'POST') return false;
    return typeof init?.body === 'string';
}

/** Describes the request so a later tab knows where the reply belongs. */
function buildMeta(bodyText) {
    const { kind, from } = resolveMarker({ started, tagged });
    // Only the marker that described this request is spent; the other one
    // (e.g. a user's GENERATION_STARTED while a DES helper request went out
    // first) stays for the fetch it belongs to.
    if (from === 'started') started = null;
    if (from === 'tagged') tagged = null;
    const chatId = currentChatKey();
    if (!chatId) return null;
    let stream = false;
    let source = '';
    try {
        const body = JSON.parse(bodyText);
        stream = body?.stream === true;
        source = typeof body?.chat_completion_source === 'string' ? body.chat_completion_source : '';
    } catch {
        return null;
    }
    const chat = getContext().chat || [];
    const meta = { jobId: newJobId(), chatId, kind, type: kind, stream, source, messageIndex: chat.length };
    if (kind === 'swipe') {
        const last = chat[chat.length - 1];
        meta.messageIndex = chat.length - 1;
        meta.swipeId = Number.isInteger(last?.swipe_id) ? last.swipe_id : (Array.isArray(last?.swipes) ? last.swipes.length : 0);
    }
    return meta;
}

async function interceptFetch(input, init) {
    const url = requestUrl(input);
    if (!shouldRelay(url, init)) return realFetch.call(window, input, init);
    const meta = buildMeta(init.body);
    if (!meta) return realFetch.call(window, input, init);
    try {
        return await relayGenerate(init, meta);
    } catch (e) {
        if (isAbortError(e)) throw e;
        if (e?.relayFatal) setConnection('missing', null, e.message);
        if (e?.relayJobExists) {
            // The server holds the job; a direct retry would generate the reply
            // twice. Let ST report the error — recovery picks the job up later.
            console.warn(LOG, 'lost contact with the relay; the generation continues on the server:', e?.message || e);
            throw e;
        }
        console.warn(LOG, 'relay unavailable for this request, sending it directly:', e?.message || e);
        return realFetch.call(window, input, init);
    }
}

async function relayGenerate(init, meta) {
    const signal = init.signal;
    throwIfAborted(signal);
    const jobId = meta.jobId;
    // The id is ours, so Stop pressed while the POST is still in flight can
    // already abort the job the server may have created from it.
    const onAbort = () => { abortJob(jobId); };
    if (signal) signal.addEventListener('abort', onAbort, { once: true });

    const headers = { ...getRequestHeaders(), [META_HEADER]: encodeURIComponent(JSON.stringify(meta)) };
    const doFetch = realFetch;
    let res;
    pendingGenerates++;
    try {
        res = await doFetch.call(window, `${RELAY_BASE}/generate`, { method: 'POST', headers, body: init.body, signal, cache: 'no-store' });
    } catch (e) {
        pendingGenerates--;
        if (!isAbortError(e)) {
            // Unknown whether the server got the request; never generate twice.
            abortJob(jobId);
            e.relayJobExists = true;
        }
        throw e;
    }
    pendingGenerates--;
    if (res.status === 404) {
        signal?.removeEventListener('abort', onAbort);
        const e = new Error('relay plugin is gone (404)');
        e.relayFatal = true;
        throw e;
    }
    if (!res.ok) {
        signal?.removeEventListener('abort', onAbort);
        throw new Error(`relay /generate answered ${res.status}`);
    }
    const answer = await res.json();
    if (answer?.jobId !== jobId) {
        const e = new Error('relay job id mismatch');
        e.relayJobExists = true;
        if (typeof answer?.jobId === 'string') abortJob(answer.jobId);
        throw e;
    }

    const job = { id: jobId, kind: meta.kind, stream: meta.stream, settled: false, ok: false, chatId: meta.chatId };
    driven.set(jobId, job);
    if (signal?.aborted) {
        abortJob(jobId);
        throw abortError();
    }

    try {
        return meta.stream ? await openResilientStream(job, signal) : await pollResult(job, signal);
    } catch (e) {
        if (!isAbortError(e)) e.relayJobExists = true;
        throw e;
    }
}

/**
 * Streaming: returns a Response whose body is pulled from the plugin and
 * transparently re-opened at the current byte offset after any drop.
 */
async function openResilientStream(job, signal) {
    const first = await openStream(job.id, 0, signal);
    if (first.status === 404) throw new Error('relay job vanished');
    if (!first.ok) {
        // The backend answered with an error; ST reads the text and throws.
        job.settled = true;
        job.ok = true;
        consumeJob(job.id);
        return first;
    }

    let offset = 0;
    let failures = 0;
    let current = first;

    const body = new ReadableStream({
        start(controller) {
            (async () => {
                while (true) {
                    try {
                        if (!current) {
                            current = await openStream(job.id, offset, signal);
                            if (current.status === 404) throw Object.assign(new Error('relay job vanished'), { fatal: true });
                            if (!current.ok) {
                                // The backend answered with an error after we had
                                // already handed ST a 200: surface it in-band (ST's
                                // stream parser toasts it) and finish.
                                const text = (await current.text()).slice(0, 2000);
                                controller.enqueue(sseErrorEvent(`${current.status}: ${text}`));
                                job.settled = true;
                                job.ok = true;
                                consumeJob(job.id);
                                controller.close();
                                return;
                            }
                        }
                        const reader = current.body.getReader();
                        while (true) {
                            const { done, value } = await reader.read();
                            if (done) break;
                            if (value?.byteLength) {
                                offset += value.byteLength;
                                controller.enqueue(value);
                                failures = 0;
                            }
                        }
                        current = null;
                        const status = await getJobStatus(job.id, signal);
                        if (!status) throw Object.assign(new Error('relay job vanished'), { fatal: true });
                        if (FINISHED.has(status.status) && offset >= status.size) {
                            job.settled = true;
                            job.ok = true;
                            controller.close();
                            return;
                        }
                        // Still running, or bytes we have not seen yet: reopen at offset.
                    } catch (e) {
                        current = null;
                        if (signal?.aborted || isAbortError(e)) {
                            job.settled = true;
                            controller.error(abortError());
                            return;
                        }
                        failures++;
                        if (e?.fatal || failures > MAX_FAILURES) {
                            job.settled = true;
                            job.ok = false;
                            controller.error(new Error(`relay connection lost: ${e?.message || e}`));
                            return;
                        }
                        try {
                            await backoff(failures, signal);
                        } catch (abort) {
                            job.settled = true;
                            controller.error(abort);
                            return;
                        }
                    }
                }
            })();
        },
        cancel() {
            if (!job.settled) abortJob(job.id);
        },
    });

    const headers = new Headers();
    const contentType = first.headers.get('content-type');
    if (contentType) headers.set('content-type', contentType);
    return new Response(body, { status: first.status, statusText: first.statusText, headers });
}

/**
 * Non-streaming: long-polls the plugin until the reply is in, then hands ST
 * the mirrored backend response. Survives freezes by construction.
 */
async function pollResult(job, signal) {
    let failures = 0;
    while (true) {
        throwIfAborted(signal);
        let res;
        try {
            res = await relayFetch(`/jobs/${encodeURIComponent(job.id)}/result?wait=${RESULT_WAIT_MS}`, { signal });
        } catch (e) {
            if (isAbortError(e)) throw e;
            failures++;
            if (failures > MAX_FAILURES) throw e;
            await backoff(failures, signal);
            continue;
        }
        failures = 0;
        if (res.status === 202) continue;
        if (res.status === 404) throw new Error('relay job vanished');
        job.settled = true;
        job.ok = true;
        if (!CHAT_KINDS.has(job.kind)) {
            // quiet / raw replies are handed to their caller right now; nothing
            // to recover later. Chat replies wait for GENERATION_ENDED (after save).
            consumeJob(job.id);
        }
        return res;
    }
}

/* ------------------------------------------------------------------ */
/* wake lock                                                           */
/* ------------------------------------------------------------------ */

async function acquireWakeLock() {
    if (extensionSettings.relay?.wakeLock === false) return;
    if (typeof navigator === 'undefined' || !navigator.wakeLock?.request) return;
    if (wakeLock && !wakeLock.released) return;
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    try {
        wakeLock = await navigator.wakeLock.request('screen');
        wakeLock.addEventListener?.('release', () => { wakeLock = null; });
    } catch (e) {
        console.debug(LOG, 'wake lock unavailable', e?.message || e);
    }
}

function releaseWakeLock() {
    const lock = wakeLock;
    wakeLock = null;
    if (lock && typeof lock.release === 'function') lock.release().catch(() => {});
}

/* ------------------------------------------------------------------ */
/* SillyTavern events                                                  */
/* ------------------------------------------------------------------ */

export function onGenerationStarted(type, params, dryRun) {
    if (dryRun) return;
    started = { type, at: Date.now() };
    generating = true;
    acquireWakeLock();
}

export function onGenerationEnded() {
    generating = false;
    started = null;
    releaseWakeLock();
    const settled = [...driven.values()].filter(j => j.settled);
    if (!settled.length) return;
    setTimeout(async () => {
        // Streaming replies: GENERATION_ENDED fires before ST's own chat save
        // (hideStopButton → unblockGeneration → … → saveChatConditional). Make
        // sure the reply is on disk before the server forgets it.
        if (settled.some(j => j.ok && j.stream)) {
            try {
                if (typeof saveChatConditional === 'function') await saveChatConditional();
            } catch (e) {
                console.debug(LOG, 'chat save before consume failed', e);
            }
        }
        for (const job of settled) {
            if (job.ok) consumeJob(job.id);
            else driven.delete(job.id); // leave it for recovery
        }
    }, CONSUME_DELAY_MS);
}

export function onGenerationStopped() {
    generating = false;
    started = null;
    releaseWakeLock();
    // Jobs still live are aborted through ST's abort signal (→ abortJob).
}

/* ------------------------------------------------------------------ */
/* install                                                             */
/* ------------------------------------------------------------------ */

/**
 * Installs the wrapper exactly once. It is never re-installed: code that
 * wraps fetch temporarily around its own call (DES's safeGenerateRaw does)
 * captures *this* wrapper and puts it back, so it stays in the chain; a
 * second install on top of such a temporary wrapper would leave two of ours
 * pointing at each other once the temporary one is removed.
 */
function ensureFetchWrapper() {
    if (typeof window === 'undefined' || realFetch) return;
    const current = window.fetch;
    if (typeof current !== 'function' || current.__desRelayWrapper) return;
    realFetch = current;
    const wrapper = function desRelayFetch(input, init) {
        return interceptFetch(input, init);
    };
    wrapper.__desRelayWrapper = true;
    window.fetch = wrapper;
}

/** Removes the wrapper (only if it is still the outermost fetch). */
export function uninstallRelayFetch() {
    if (typeof window === 'undefined') return;
    if (window.fetch?.__desRelayWrapper && realFetch) window.fetch = realFetch;
}

/**
 * Installs the fetch wrapper and probes the plugin. Safe to call more than
 * once. Call before the first generation can happen (right after settings
 * load).
 */
export function initRelayClient() {
    ensureFetchWrapper();
    if (!initialized) {
        initialized = true;
        if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
            document.addEventListener('visibilitychange', () => {
                if (document.visibilityState === 'visible' && generating) acquireWakeLock();
            });
        }
    }
    return probeRelay({ force: true });
}

/** Settings toggle: re-probe when turned on, mark disabled when turned off. */
export function setRelayEnabled(enabled) {
    if (!extensionSettings.relay || typeof extensionSettings.relay !== 'object') extensionSettings.relay = {};
    extensionSettings.relay.enabled = !!enabled;
    if (enabled) return probeRelay({ force: true });
    return Promise.resolve(setConnection('disabled', null, null));
}

export { DES_INTERNAL_KIND };
