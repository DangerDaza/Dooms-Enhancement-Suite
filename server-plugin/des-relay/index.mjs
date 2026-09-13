/**
 * Doom's Enhancement Suite — Generation Relay (SillyTavern server plugin)
 *
 * Problem it solves: SillyTavern's browser tab owns every generation. On a
 * phone the tab is frozen the moment the screen locks, the fetch dies, and
 * ST's backend aborts the upstream request when the client socket closes —
 * the reply is lost. Through a Cloudflare tunnel the same thing happens on
 * any long idle.
 *
 * With this plugin the DES client sends the exact request body ST would
 * have sent to `/api/backends/chat-completions/generate` here instead. The
 * plugin forwards it to that very endpoint over loopback (so every provider,
 * secret, proxy and prompt post-processing rule ST knows about still
 * applies), owns the upstream connection, records every byte, and lets the
 * client (or a later tab) read the job back from any byte offset. Finished
 * jobs are written to disk so they survive a page reload — and a server
 * restart — until the client confirms it has applied them ("consume").
 *
 * The plugin never touches chat files. Applying a recovered reply to the
 * chat is the client's job (single-writer rule).
 *
 * Routes (mounted by ST at /api/plugins/des-relay, behind ST's own auth):
 *   GET  /info                    handshake { protocol, version, limits }
 *   POST /generate                body = ST generate payload, header
 *                                 x-des-relay-meta = encodeURIComponent(JSON)
 *                                 → { jobId }
 *   GET  /jobs?chatId=            unconsumed jobs of this user (for a chat)
 *   GET  /jobs/:id                job summary
 *   GET  /jobs/:id/stream?offset= raw upstream bytes from offset, live until
 *                                 the job ends (streaming jobs only)
 *   GET  /jobs/:id/result?wait=   long-poll: 202 while running, else the
 *                                 upstream status + body
 *   POST /jobs/:id/abort          abort the upstream request
 *   POST /jobs/:id/consume        mark applied (409 if already consumed)
 *
 * Install: copy or symlink this folder to <SillyTavern>/plugins/des-relay and
 * set `enableServerPlugins: true` in config.yaml. See ../README.md.
 */
import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const info = {
    id: 'des-relay',
    name: 'DES Generation Relay',
    description: 'Keeps chat-completion generations alive on the server when the client tab freezes or dies (Doom\'s Enhancement Suite).',
};

export const PROTOCOL = 1;
export const VERSION = '1.0.0';

const GENERATE_PATH = '/api/backends/chat-completions/generate';
const META_HEADER = 'x-des-relay-meta';
const FORWARD_HEADERS = ['cookie', 'x-csrf-token', 'authorization', 'host', 'user-agent', 'accept', 'accept-language'];
const META_STRING_KEYS = ['chatId', 'kind', 'type', 'source', 'label'];
const META_NUMBER_KEYS = ['messageIndex', 'swipeId'];
const FINISHED = new Set(['done', 'error', 'aborted']);

export const DEFAULT_OPTIONS = Object.freeze({
    dataDir: path.join(path.dirname(fileURLToPath(import.meta.url)), 'data'),
    maxJobDurationMs: 15 * 60 * 1000,
    maxBodyBytes: 8 * 1024 * 1024,
    retentionMs: 24 * 60 * 60 * 1000,
    heartbeatMs: 20 * 1000,
    headerWaitMs: 30 * 1000,
    maxResultWaitMs: 25 * 1000,
    maxJobsPerUser: 200,
    pruneIntervalMs: 60 * 60 * 1000,
    log: (...args) => console.log('[DES Relay]', ...args),
    warn: (...args) => console.warn('[DES Relay]', ...args),
});

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

function sendJson(res, code, obj) {
    if (res.headersSent) {
        if (!res.writableEnded) res.end();
        return;
    }
    res.statusCode = code;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify(obj));
}

function userOf(req) {
    const handle = req?.user?.profile?.handle;
    return typeof handle === 'string' && handle ? handle : 'default-user';
}

function safeName(value) {
    return String(value).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64) || '_';
}

function clampInt(value, min, max, fallback = min) {
    const n = Number.parseInt(value, 10);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
}

function sanitizeMeta(raw) {
    const meta = {};
    if (!raw || typeof raw !== 'object') return meta;
    for (const key of META_STRING_KEYS) {
        if (typeof raw[key] === 'string') meta[key] = raw[key].slice(0, 512);
    }
    for (const key of META_NUMBER_KEYS) {
        if (Number.isInteger(raw[key])) meta[key] = raw[key];
    }
    return meta;
}

function parseMetaHeader(value) {
    if (typeof value !== 'string' || !value) return {};
    try {
        return sanitizeMeta(JSON.parse(decodeURIComponent(value)));
    } catch {
        return {};
    }
}

/** ST maps 401 to 400 so the browser's Basic-auth prompt is not reset. */
function clientStatus(code) {
    return code === 401 ? 400 : code;
}

function loopbackHost(req) {
    let address = req?.socket?.localAddress;
    if (typeof address !== 'string' || !address) return '127.0.0.1';
    if (address.startsWith('::ffff:')) address = address.slice(7);
    return address;
}

/* ------------------------------------------------------------------ */
/* relay                                                               */
/* ------------------------------------------------------------------ */

/**
 * Creates an independent relay instance (the plugin uses one; tests can
 * create several with their own data directories).
 */
export function createRelay(userOptions = {}) {
    const options = { ...DEFAULT_OPTIONS, ...userOptions };
    /** @type {Map<string, object>} */
    const jobs = new Map();
    let heartbeatTimer = null;
    let pruneTimer = null;
    let closed = false;

    /* ---------- persistence ---------- */

    function jobFile(job) {
        return path.join(options.dataDir, safeName(job.user), `${job.id}.json`);
    }

    function persistJob(job) {
        if (!FINISHED.has(job.status)) return;
        const file = jobFile(job);
        const record = {
            id: job.id,
            user: job.user,
            meta: job.meta,
            stream: job.stream,
            status: job.status,
            statusCode: job.statusCode,
            statusMessage: job.statusMessage,
            contentType: job.contentType,
            size: job.size,
            startedAt: job.startedAt,
            endedAt: job.endedAt,
            error: job.error,
            body: Buffer.concat(job.chunks, job.size).toString('base64'),
        };
        try {
            fs.mkdirSync(path.dirname(file), { recursive: true });
            const tmp = `${file}.${process.pid}.tmp`;
            fs.writeFileSync(tmp, JSON.stringify(record));
            fs.renameSync(tmp, file);
        } catch (e) {
            options.warn(`could not persist job ${job.id}: ${e.message}`);
        }
    }

    function deleteJobFile(job) {
        try {
            fs.rmSync(jobFile(job), { force: true });
        } catch (e) {
            options.warn(`could not delete job file ${job.id}: ${e.message}`);
        }
    }

    function loadPersisted() {
        let loaded = 0;
        let userDirs = [];
        try {
            userDirs = fs.readdirSync(options.dataDir, { withFileTypes: true }).filter(d => d.isDirectory());
        } catch {
            return 0;
        }
        for (const dir of userDirs) {
            const dirPath = path.join(options.dataDir, dir.name);
            let files = [];
            try {
                files = fs.readdirSync(dirPath).filter(f => f.endsWith('.json'));
            } catch {
                continue;
            }
            for (const file of files) {
                const filePath = path.join(dirPath, file);
                try {
                    const record = JSON.parse(fs.readFileSync(filePath, 'utf8'));
                    if (!record || typeof record.id !== 'string' || !FINISHED.has(record.status)) {
                        fs.rmSync(filePath, { force: true });
                        continue;
                    }
                    const body = Buffer.from(record.body || '', 'base64');
                    jobs.set(record.id, {
                        id: record.id,
                        user: typeof record.user === 'string' ? record.user : 'default-user',
                        meta: sanitizeMeta(record.meta),
                        stream: !!record.stream,
                        status: record.status,
                        statusCode: Number.isInteger(record.statusCode) ? record.statusCode : null,
                        statusMessage: record.statusMessage ?? null,
                        contentType: record.contentType ?? null,
                        chunks: body.length ? [body] : [],
                        size: body.length,
                        tail: body.subarray(Math.max(0, body.length - 4)).toString('latin1'),
                        startedAt: Number(record.startedAt) || 0,
                        endedAt: Number(record.endedAt) || 0,
                        error: record.error ?? null,
                        consumed: false,
                        subscribers: new Set(),
                        headerWaiters: [],
                        finishWaiters: [],
                        upstream: null,
                        timer: null,
                    });
                    loaded++;
                } catch (e) {
                    options.warn(`ignoring unreadable job file ${filePath}: ${e.message}`);
                }
            }
        }
        return loaded;
    }

    function prune(now = Date.now()) {
        const perUser = new Map();
        for (const job of jobs.values()) {
            if (!FINISHED.has(job.status)) continue;
            if (job.endedAt && now - job.endedAt > options.retentionMs) {
                jobs.delete(job.id);
                deleteJobFile(job);
                continue;
            }
            if (!perUser.has(job.user)) perUser.set(job.user, []);
            perUser.get(job.user).push(job);
        }
        for (const list of perUser.values()) {
            if (list.length <= options.maxJobsPerUser) continue;
            list.sort((a, b) => a.endedAt - b.endedAt);
            for (const job of list.slice(0, list.length - options.maxJobsPerUser)) {
                jobs.delete(job.id);
                deleteJobFile(job);
            }
        }
    }

    /* ---------- job lifecycle ---------- */

    function summary(job) {
        return {
            id: job.id,
            meta: job.meta,
            stream: job.stream,
            status: job.status,
            statusCode: job.statusCode,
            size: job.size,
            startedAt: job.startedAt,
            endedAt: job.endedAt,
            error: job.error,
        };
    }

    function createJob(user, meta, stream) {
        const job = {
            id: crypto.randomUUID(),
            user,
            meta,
            stream,
            status: 'running',
            statusCode: null,
            statusMessage: null,
            contentType: null,
            chunks: [],
            size: 0,
            tail: '',
            startedAt: Date.now(),
            endedAt: 0,
            error: null,
            consumed: false,
            subscribers: new Set(),
            headerWaiters: [],
            finishWaiters: [],
            upstream: null,
            timer: null,
        };
        jobs.set(job.id, job);
        return job;
    }

    function notifyHeaders(job) {
        const waiters = job.headerWaiters;
        job.headerWaiters = [];
        for (const resolve of waiters) resolve();
    }

    function finishJob(job, status, error = null) {
        if (FINISHED.has(job.status)) return;
        job.status = status;
        job.error = error;
        job.endedAt = Date.now();
        if (job.timer) {
            clearTimeout(job.timer);
            job.timer = null;
        }
        if (job.size > 0 && job.chunks.length > 1) {
            job.chunks = [Buffer.concat(job.chunks, job.size)];
        }
        notifyHeaders(job);
        const finishWaiters = job.finishWaiters;
        job.finishWaiters = [];
        for (const resolve of finishWaiters) resolve();
        for (const sub of job.subscribers) {
            try {
                if (sub.sentStatus === 200 && Number.isInteger(job.statusCode) && job.statusCode >= 400) {
                    // The client was told 200 before upstream answered; surface the
                    // failure in-band so ST's stream parser can toast it.
                    const text = Buffer.concat(job.chunks, job.size).toString('utf8').slice(0, 2000);
                    sub.res.write(`data: ${JSON.stringify({ error: { message: `${job.statusCode} ${job.statusMessage || ''}: ${text}`.trim() } })}\n\n`);
                } else if (sub.sentStatus === 200 && job.statusCode == null && status !== 'done') {
                    sub.res.write(`data: ${JSON.stringify({ error: { message: error || `generation ${status}` } })}\n\n`);
                }
                sub.res.end();
            } catch { /* client gone */ }
        }
        job.subscribers.clear();
        job.upstream = null;
        persistJob(job);
    }

    function abortJob(job, status = 'aborted', error = null) {
        if (FINISHED.has(job.status)) return;
        const upstream = job.upstream;
        finishJob(job, status, error);
        if (upstream) {
            try {
                upstream.destroy();
            } catch { /* already gone */ }
        }
    }

    function appendChunk(job, chunk) {
        if (FINISHED.has(job.status)) return;
        job.chunks.push(chunk);
        job.size += chunk.length;
        job.tail = (job.tail + chunk.subarray(Math.max(0, chunk.length - 4)).toString('latin1')).slice(-4);
        if (job.size > options.maxBodyBytes) {
            abortJob(job, 'error', `response exceeded ${options.maxBodyBytes} bytes`);
            return;
        }
        for (const sub of job.subscribers) {
            try {
                sub.res.write(chunk);
                sub.lastWrite = Date.now();
            } catch { /* client gone */ }
        }
    }

    function startForward(job, req, payloadObject) {
        const payload = Buffer.from(JSON.stringify(payloadObject));
        const encrypted = Boolean(req.socket?.encrypted);
        const port = req.socket?.localPort || options.fallbackPort;
        const headers = {
            'content-type': 'application/json',
            'content-length': payload.length,
            'x-des-relay-job': job.id,
        };
        for (const name of FORWARD_HEADERS) {
            if (req.headers?.[name] !== undefined) headers[name] = req.headers[name];
        }
        const lib = encrypted ? https : http;
        const upstream = lib.request({
            host: loopbackHost(req),
            port,
            path: GENERATE_PATH,
            method: 'POST',
            headers,
            rejectUnauthorized: false,
        }, (res) => {
            job.statusCode = res.statusCode;
            job.statusMessage = res.statusMessage || null;
            job.contentType = res.headers['content-type'] || null;
            notifyHeaders(job);
            res.on('data', (chunk) => appendChunk(job, chunk));
            res.on('end', () => finishJob(job, 'done'));
            res.on('error', (e) => finishJob(job, 'error', `upstream connection failed: ${e.message}`));
            res.on('close', () => {
                if (!FINISHED.has(job.status)) finishJob(job, 'error', 'upstream connection closed early');
            });
        });
        upstream.on('error', (e) => finishJob(job, 'error', `loopback request failed: ${e.message}`));
        job.upstream = upstream;
        job.timer = setTimeout(() => abortJob(job, 'error', `generation exceeded ${Math.round(options.maxJobDurationMs / 60000)} minutes`), options.maxJobDurationMs);
        upstream.end(payload);
    }

    function waitFor(job, list, ms) {
        if (FINISHED.has(job.status) || ms <= 0) return Promise.resolve();
        return new Promise((resolve) => {
            let done = false;
            const finish = () => {
                if (done) return;
                done = true;
                clearTimeout(timer);
                resolve();
            };
            const timer = setTimeout(finish, ms);
            job[list].push(finish);
        });
    }

    /** True when the stored bytes end on an SSE event boundary (or are empty),
     *  i.e. a heartbeat comment can be injected without splitting an event. */
    function atEventBoundary(job) {
        return job.size === 0 || job.tail.endsWith('\n\n') || job.tail.endsWith('\r\n\r\n') || job.tail.endsWith('\r\r');
    }

    function heartbeat() {
        const now = Date.now();
        for (const job of jobs.values()) {
            if (job.status !== 'running' || !job.stream || job.subscribers.size === 0) continue;
            if (!atEventBoundary(job)) continue;
            for (const sub of job.subscribers) {
                if (now - sub.lastWrite < options.heartbeatMs) continue;
                try {
                    sub.res.write(': ping\n\n');
                    sub.lastWrite = now;
                } catch { /* client gone */ }
            }
        }
    }

    function jobFor(req, res) {
        const job = jobs.get(String(req.params?.id || ''));
        if (!job || job.user !== userOf(req) || job.consumed) {
            sendJson(res, 404, { error: 'job not found' });
            return null;
        }
        return job;
    }

    /* ---------- routes ---------- */

    function attach(router) {
        const wrap = (fn) => async (req, res) => {
            try {
                await fn(req, res);
            } catch (e) {
                options.warn(`route error: ${e?.stack || e}`);
                sendJson(res, 500, { error: String(e?.message || e) });
            }
        };

        router.get('/info', wrap((req, res) => {
            sendJson(res, 200, {
                ok: true,
                id: info.id,
                protocol: PROTOCOL,
                version: VERSION,
                limits: {
                    maxJobDurationMs: options.maxJobDurationMs,
                    maxBodyBytes: options.maxBodyBytes,
                    retentionMs: options.retentionMs,
                    heartbeatMs: options.heartbeatMs,
                },
            });
        }));

        router.post('/generate', wrap((req, res) => {
            if (closed) return sendJson(res, 503, { error: 'relay is shutting down' });
            const payload = req.body;
            if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
                return sendJson(res, 400, { error: 'request body must be the generate payload object' });
            }
            const meta = parseMetaHeader(req.headers?.[META_HEADER]);
            const job = createJob(userOf(req), meta, payload.stream === true);
            startForward(job, req, payload);
            sendJson(res, 200, { jobId: job.id, status: job.status });
        }));

        router.get('/jobs', wrap((req, res) => {
            const user = userOf(req);
            const chatId = typeof req.query?.chatId === 'string' ? req.query.chatId : null;
            const list = [];
            for (const job of jobs.values()) {
                if (job.user !== user || job.consumed) continue;
                if (chatId !== null && job.meta?.chatId !== chatId) continue;
                list.push(summary(job));
            }
            list.sort((a, b) => a.startedAt - b.startedAt);
            sendJson(res, 200, { jobs: list });
        }));

        router.get('/jobs/:id', wrap((req, res) => {
            const job = jobFor(req, res);
            if (job) sendJson(res, 200, summary(job));
        }));

        router.get('/jobs/:id/stream', wrap(async (req, res) => {
            const job = jobFor(req, res);
            if (!job) return;
            if (!job.stream) return sendJson(res, 400, { error: 'not a streaming job' });
            const offset = clampInt(req.query?.offset, 0, Number.MAX_SAFE_INTEGER, 0);

            if (job.statusCode == null) await waitFor(job, 'headerWaiters', options.headerWaitMs);
            if (job.statusCode == null && FINISHED.has(job.status)) {
                return sendJson(res, 502, { error: { message: job.error || `generation ${job.status} before the backend answered` } });
            }
            if (res.socket?.destroyed || res.writableEnded) return;

            const sentStatus = job.statusCode == null ? 200 : clientStatus(job.statusCode);
            res.statusCode = sentStatus;
            if (job.statusMessage && job.statusCode != null) res.statusMessage = job.statusMessage;
            // No Content-Type on purpose: ST's own backend streams without one
            // so the compression middleware leaves the bytes alone.
            res.setHeader('Cache-Control', 'no-cache, no-transform');
            res.setHeader('X-Accel-Buffering', 'no');
            res.setHeader('X-DES-Relay-Job', job.id);
            if (typeof res.flushHeaders === 'function') res.flushHeaders();

            if (offset < job.size) {
                const body = job.chunks.length === 1 ? job.chunks[0] : Buffer.concat(job.chunks, job.size);
                res.write(body.subarray(offset));
                if (job.chunks.length > 1) job.chunks = [body];
            }
            if (FINISHED.has(job.status)) {
                if (sentStatus === 200 && job.statusCode == null) {
                    res.write(`data: ${JSON.stringify({ error: { message: job.error || `generation ${job.status}` } })}\n\n`);
                }
                return res.end();
            }
            const sub = { res, sentStatus, lastWrite: Date.now() };
            job.subscribers.add(sub);
            res.on('close', () => job.subscribers.delete(sub));
        }));

        router.get('/jobs/:id/result', wrap(async (req, res) => {
            const job = jobFor(req, res);
            if (!job) return;
            const wait = clampInt(req.query?.wait, 0, options.maxResultWaitMs, 0);
            if (!FINISHED.has(job.status)) await waitFor(job, 'finishWaiters', wait);
            if (!FINISHED.has(job.status)) {
                res.setHeader('X-DES-Relay', 'running');
                return sendJson(res, 202, { relay: 'running', size: job.size });
            }
            if (job.statusCode == null) {
                return sendJson(res, 502, { error: { message: job.error || `generation ${job.status} before the backend answered` } });
            }
            res.statusCode = clientStatus(job.statusCode);
            if (job.statusMessage) res.statusMessage = job.statusMessage;
            res.setHeader('Content-Type', job.stream ? 'text/plain; charset=utf-8' : (job.contentType || 'application/json; charset=utf-8'));
            res.setHeader('Cache-Control', 'no-store');
            res.setHeader('X-DES-Relay-Status', job.status);
            res.end(job.chunks.length === 1 ? job.chunks[0] : Buffer.concat(job.chunks, job.size));
        }));

        router.post('/jobs/:id/abort', wrap((req, res) => {
            const job = jobFor(req, res);
            if (!job) return;
            abortJob(job, 'aborted', 'aborted by the client');
            sendJson(res, 200, summary(job));
        }));

        router.post('/jobs/:id/consume', wrap((req, res) => {
            const job = jobFor(req, res);
            if (!job) return;
            if (!FINISHED.has(job.status)) return sendJson(res, 409, { error: 'job still running', running: true });
            if (job.consumed) return sendJson(res, 409, { error: 'already consumed', consumed: true });
            job.consumed = true;
            jobs.delete(job.id);
            deleteJobFile(job);
            sendJson(res, 200, { ok: true, id: job.id });
        }));
    }

    /* ---------- boot / shutdown ---------- */

    const loaded = loadPersisted();
    prune();
    heartbeatTimer = setInterval(heartbeat, Math.max(250, Math.floor(options.heartbeatMs / 4)));
    pruneTimer = setInterval(() => prune(), options.pruneIntervalMs);
    heartbeatTimer.unref?.();
    pruneTimer.unref?.();
    if (loaded) options.log(`restored ${loaded} finished generation(s) from disk`);

    function close(reason = 'server shutting down') {
        closed = true;
        clearInterval(heartbeatTimer);
        clearInterval(pruneTimer);
        for (const job of jobs.values()) {
            if (!FINISHED.has(job.status)) abortJob(job, 'error', reason);
        }
    }

    return { attach, close, jobs, options, summary, prune };
}

/* ------------------------------------------------------------------ */
/* SillyTavern plugin entry points                                     */
/* ------------------------------------------------------------------ */

let relay = null;

export async function init(router) {
    relay = createRelay();
    relay.attach(router);
    relay.options.log(`ready (protocol ${PROTOCOL}, v${VERSION})`);
}

export async function exit() {
    if (relay) {
        relay.close();
        relay = null;
    }
}
