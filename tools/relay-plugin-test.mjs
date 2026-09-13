#!/usr/bin/env node
/**
 * Tests for the des-relay SillyTavern server plugin (server-plugin/des-relay).
 *
 * Boots one Node http server that plays both roles: the "SillyTavern backend"
 * at /api/backends/chat-completions/generate (scripted SSE / JSON replies) and
 * the plugin router at /api/plugins/des-relay/* through a tiny express-like
 * shim (params, query, body, user). The plugin forwards over loopback to the
 * very same server, exactly as it does inside SillyTavern.
 *
 * Usage: node tools/relay-plugin-test.mjs
 */
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const { createRelay, PROTOCOL } = await import(path.join(here, '..', 'server-plugin', 'des-relay', 'index.mjs'));

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let passed = 0;
async function test(name, fn) {
    try {
        await fn();
        passed++;
        console.log(`  ok  ${name}`);
    } catch (e) {
        console.error(`FAIL  ${name}\n${e?.stack || e}`);
        process.exitCode = 1;
    }
}

/* ---------------- express-like router shim ---------------- */

function makeRouter() {
    const routes = [];
    const add = (method) => (pattern, handler) => {
        const keys = [];
        const re = new RegExp('^' + pattern.replace(/:([a-zA-Z]+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
        routes.push({ method, re, keys, handler });
    };
    return {
        get: add('GET'),
        post: add('POST'),
        match(method, pathname) {
            for (const r of routes) {
                if (r.method !== method) continue;
                const m = r.re.exec(pathname);
                if (!m) continue;
                const params = {};
                r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
                return { handler: r.handler, params };
            }
            return null;
        },
    };
}

async function readBody(req) {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    return Buffer.concat(chunks);
}

/* ---------------- scripted backend ---------------- */

const backend = {
    seen: [],           // forwarded requests {headers, body}
    mode: 'stream',     // 'stream' | 'json' | 'error' | 'slow-headers' | 'hang'
    events: ['{"choices":[{"delta":{"content":"Hel"}}]}', '{"choices":[{"delta":{"content":"lo"}}]}', '{"choices":[{"delta":{"content":" world"}}]}'],
    gapMs: 20,
    closes: 0,
};

async function serveBackend(req, res, body) {
    backend.seen.push({ headers: req.headers, body: JSON.parse(body.toString() || '{}') });
    res.on('close', () => { if (!res.writableEnded) backend.closes++; });
    if (backend.mode === 'error') {
        res.statusCode = 401;
        res.end('{"error":{"message":"bad key"}}');
        return;
    }
    if (backend.mode === 'hang') {
        return; // never answers; the relay's max-duration timer must fire
    }
    if (backend.mode === 'json') {
        await sleep(backend.gapMs);
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ choices: [{ message: { content: 'plain reply' } }] }));
        return;
    }
    if (backend.mode === 'slow-headers') {
        await sleep(backend.gapMs);
    }
    res.statusCode = 200;
    res.flushHeaders();
    for (const ev of backend.events) {
        if (res.writableEnded || res.destroyed) return;
        res.write(`data: ${ev}\n\n`);
        await sleep(backend.gapMs);
    }
    res.write('data: [DONE]\n\n');
    res.end();
}

/* ---------------- server ---------------- */

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'des-relay-test-'));
let relay = createRelay({ dataDir, heartbeatMs: 60, log: () => {}, warn: () => {} });
let router = makeRouter();
relay.attach(router);

const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const body = await readBody(req);
    if (url.pathname === '/api/backends/chat-completions/generate') return serveBackend(req, res, body);
    const prefix = '/api/plugins/des-relay';
    if (!url.pathname.startsWith(prefix)) { res.statusCode = 404; return res.end(); }
    const m = router.match(req.method, url.pathname.slice(prefix.length) || '/');
    if (!m) { res.statusCode = 404; return res.end('no route'); }
    req.params = m.params;
    req.query = Object.fromEntries(url.searchParams);
    req.user = { profile: { handle: req.headers['x-test-user'] || 'default-user' } };
    try { req.body = body.length ? JSON.parse(body.toString()) : undefined; } catch { req.body = undefined; }
    await m.handler(req, res);
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const base = `http://127.0.0.1:${server.address().port}/api/plugins/des-relay`;

const H = { cookie: 'session=abc', 'x-csrf-token': 'tok', authorization: 'Basic xyz', host: 'st.example.com' };
const meta = (m) => ({ 'x-des-relay-meta': encodeURIComponent(JSON.stringify(m)) });

async function generate(payload, m = { chatId: 'c:a.png:chat1', kind: 'normal', messageIndex: 3 }, extra = {}) {
    // node's fetch (undici) drops a caller-supplied Host header, so use http.request:
    // in the browser the Host header is always present and the plugin must forward it.
    const body = JSON.stringify(payload);
    const { port } = server.address();
    const text = await new Promise((resolve, reject) => {
        const req = http.request({ host: '127.0.0.1', port, path: '/api/plugins/des-relay/generate', method: 'POST',
            headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body), ...H, ...meta(m), ...extra } }, (res) => {
            const chunks = [];
            res.on('data', c => chunks.push(c));
            res.on('end', () => {
                assert.equal(res.statusCode, 200);
                resolve(Buffer.concat(chunks).toString());
            });
        });
        req.on('error', reject);
        req.end(body);
    });
    return JSON.parse(text).jobId;
}
const status = async (id, extra = {}) => (await fetch(`${base}/jobs/${id}`, { headers: extra })).json();
async function waitDone(id) {
    for (let i = 0; i < 200; i++) {
        const s = await status(id);
        if (['done', 'error', 'aborted'].includes(s.status)) return s;
        await sleep(10);
    }
    throw new Error('job never finished');
}
const sseData = (text) => text.split(/\n\n/).map(ev => ev.split('\n').filter(l => l.startsWith('data: ')).map(l => l.slice(6)).join('')).filter(Boolean);

/* ---------------- tests ---------------- */

await test('info handshake', async () => {
    const r = await fetch(`${base}/info`);
    const j = await r.json();
    assert.equal(j.ok, true);
    assert.equal(j.protocol, PROTOCOL);
    assert.ok(j.limits.maxBodyBytes > 0);
});

await test('streaming job: forwarded over loopback with auth headers, replayed byte for byte', async () => {
    backend.mode = 'stream';
    const id = await generate({ stream: true, messages: [{ role: 'user', content: 'hi' }], chat_completion_source: 'openai' });
    const r = await fetch(`${base}/jobs/${id}/stream?offset=0`);
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('content-type'), null, 'no content-type so compression leaves the stream alone');
    const text = await r.text();
    assert.deepEqual(sseData(text), [...backend.events, '[DONE]']);
    const fwd = backend.seen.at(-1);
    assert.equal(fwd.headers.cookie, 'session=abc');
    assert.equal(fwd.headers['x-csrf-token'], 'tok');
    assert.equal(fwd.headers.authorization, 'Basic xyz');
    assert.equal(fwd.headers.host, 'st.example.com');
    assert.equal(fwd.headers['x-des-relay-job'], id);
    assert.equal(fwd.body.stream, true);
    assert.equal(fwd.body.messages[0].content, 'hi');
    const s = await waitDone(id);
    assert.equal(s.status, 'done');
    assert.equal(s.statusCode, 200);
    assert.equal(s.meta.kind, 'normal');
    assert.equal(s.meta.messageIndex, 3);
    // listing + consume semantics
    const list = await (await fetch(`${base}/jobs?chatId=${encodeURIComponent('c:a.png:chat1')}`)).json();
    assert.ok(list.jobs.some(j => j.id === id));
    const other = await (await fetch(`${base}/jobs?chatId=other`)).json();
    assert.ok(!other.jobs.some(j => j.id === id));
    assert.equal((await fetch(`${base}/jobs/${id}/consume`, { method: 'POST' })).status, 200);
    assert.equal((await fetch(`${base}/jobs/${id}/consume`, { method: 'POST' })).status, 404, 'consumed jobs are gone');
    assert.equal((await fetch(`${base}/jobs/${id}`)).status, 404);
});

await test('resume from a byte offset while the job is still running', async () => {
    backend.mode = 'stream';
    backend.gapMs = 40;
    const id = await generate({ stream: true, messages: [] });
    await sleep(60); // first event stored
    const first = await status(id);
    assert.ok(first.size > 0 && first.status === 'running');
    const head = await (await fetch(`${base}/jobs/${id}/stream?offset=0`)).text();
    const cut = Math.floor(head.length / 2);
    const tail = await (await fetch(`${base}/jobs/${id}/stream?offset=${cut}`)).text();
    assert.equal(head.slice(cut), tail, 'offset replay is exact');
    assert.deepEqual(sseData(head), [...backend.events, '[DONE]']);
    backend.gapMs = 20;
    await fetch(`${base}/jobs/${id}/consume`, { method: 'POST' });
});

await test('heartbeat comments are injected only on event boundaries and do not corrupt events', async () => {
    backend.mode = 'stream';
    backend.gapMs = 150; // > heartbeatMs (60) so pings fire between events
    const id = await generate({ stream: true, messages: [] });
    const text = await (await fetch(`${base}/jobs/${id}/stream`)).text();
    assert.ok(text.includes(': ping\n\n'), 'at least one heartbeat was sent');
    assert.deepEqual(sseData(text), [...backend.events, '[DONE]'], 'data events intact');
    const stored = await (await fetch(`${base}/jobs/${id}/result`)).text();
    assert.ok(!stored.includes(': ping'), 'heartbeats are never stored');
    backend.gapMs = 20;
    await fetch(`${base}/jobs/${id}/consume`, { method: 'POST' });
});

await test('non-streaming job: result long-poll answers 202 while running, then mirrors the backend', async () => {
    backend.mode = 'json';
    backend.gapMs = 120;
    const id = await generate({ stream: false, messages: [] }, { chatId: 'c', kind: 'des-tracker' });
    const early = await fetch(`${base}/jobs/${id}/result?wait=10`);
    assert.equal(early.status, 202);
    assert.equal(early.headers.get('x-des-relay'), 'running');
    const late = await fetch(`${base}/jobs/${id}/result?wait=5000`);
    assert.equal(late.status, 200);
    assert.match(late.headers.get('content-type'), /application\/json/);
    assert.equal(late.headers.get('x-des-relay-status'), 'done');
    assert.equal((await late.json()).choices[0].message.content, 'plain reply');
    assert.equal((await fetch(`${base}/jobs/${id}/stream`)).status, 400, 'stream route refuses non-stream jobs');
    backend.gapMs = 20;
    await fetch(`${base}/jobs/${id}/consume`, { method: 'POST' });
});

await test('backend error status is mirrored (401 becomes 400 like SillyTavern does)', async () => {
    backend.mode = 'error';
    const id = await generate({ stream: true, messages: [] });
    const r = await fetch(`${base}/jobs/${id}/stream`);
    assert.equal(r.status, 400);
    assert.match(await r.text(), /bad key/);
    const s = await waitDone(id);
    assert.equal(s.statusCode, 401);
    await fetch(`${base}/jobs/${id}/consume`, { method: 'POST' });
});

await test('abort closes the upstream request and ends open streams', async () => {
    backend.mode = 'stream';
    backend.gapMs = 200;
    const before = backend.closes;
    const id = await generate({ stream: true, messages: [] });
    const streamPromise = fetch(`${base}/jobs/${id}/stream`).then(r => r.text());
    await sleep(50);
    const a = await (await fetch(`${base}/jobs/${id}/abort`, { method: 'POST' })).json();
    assert.equal(a.status, 'aborted');
    const text = await streamPromise;
    assert.ok(text.length >= 0);
    await sleep(80);
    assert.equal(backend.closes, before + 1, 'backend saw the socket close');
    assert.equal((await fetch(`${base}/jobs/${id}/consume`, { method: 'POST' })).status, 200);
    backend.gapMs = 20;
});

await test('max duration turns a hung backend into an error job; result reports it', async () => {
    relay.close();
    relay = createRelay({ dataDir, maxJobDurationMs: 300, log: () => {}, warn: () => {} });
    router = makeRouter();
    relay.attach(router);
    backend.mode = 'hang';
    const id = await generate({ stream: false, messages: [] });
    const s = await waitDone(id);
    assert.equal(s.status, 'error');
    assert.match(s.error, /exceeded/);
    const r = await fetch(`${base}/jobs/${id}/result`);
    assert.equal(r.status, 502);
    assert.match((await r.json()).error.message, /exceeded/);
    await fetch(`${base}/jobs/${id}/consume`, { method: 'POST' });
    backend.mode = 'stream';
});

await test('jobs are private to their user', async () => {
    backend.mode = 'json';
    const id = await generate({ stream: false, messages: [] }, { chatId: 'c' }, { 'x-test-user': 'alice' });
    await sleep(60);
    assert.equal((await fetch(`${base}/jobs/${id}`, { headers: { 'x-test-user': 'bob' } })).status, 404);
    assert.equal((await fetch(`${base}/jobs/${id}/consume`, { method: 'POST', headers: { 'x-test-user': 'bob' } })).status, 404);
    const mine = await (await fetch(`${base}/jobs`, { headers: { 'x-test-user': 'alice' } })).json();
    assert.ok(mine.jobs.some(j => j.id === id));
    assert.equal((await fetch(`${base}/jobs/${id}/consume`, { method: 'POST', headers: { 'x-test-user': 'alice' } })).status, 200);
    backend.mode = 'stream';
});

await test('finished jobs survive a restart of the relay and are pruned by retention', async () => {
    backend.mode = 'json';
    const id = await generate({ stream: false, messages: [] }, { chatId: 'persist', kind: 'normal', messageIndex: 1 });
    const s = await waitDone(id);
    assert.equal(s.status, 'done');
    const file = path.join(dataDir, 'default-user', `${id}.json`);
    assert.ok(fs.existsSync(file), 'job file written');
    relay.close();
    relay = createRelay({ dataDir, log: () => {}, warn: () => {} });
    router = makeRouter();
    relay.attach(router);
    const again = await status(id);
    assert.equal(again.status, 'done');
    assert.equal(again.meta.chatId, 'persist');
    const body = await (await fetch(`${base}/jobs/${id}/result`)).json();
    assert.equal(body.choices[0].message.content, 'plain reply');
    // retention prune
    relay.jobs.get(id).endedAt = Date.now() - 48 * 3600 * 1000;
    relay.prune();
    assert.equal((await fetch(`${base}/jobs/${id}`)).status, 404);
    assert.ok(!fs.existsSync(file), 'job file removed by prune');
    backend.mode = 'stream';
});

await test('oversized responses are cut off as errors', async () => {
    relay.close();
    relay = createRelay({ dataDir, maxBodyBytes: 40, log: () => {}, warn: () => {} });
    router = makeRouter();
    relay.attach(router);
    backend.mode = 'stream';
    const id = await generate({ stream: true, messages: [] });
    const s = await waitDone(id);
    assert.equal(s.status, 'error');
    assert.match(s.error, /exceeded 40 bytes/);
    await fetch(`${base}/jobs/${id}/consume`, { method: 'POST' });
});

relay.close();
server.close();
fs.rmSync(dataDir, { recursive: true, force: true });
console.log(process.exitCode ? `\n${passed} passed, some FAILED` : `\nALL ${passed} PASSED`);
