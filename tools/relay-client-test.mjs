#!/usr/bin/env node
/**
 * End-to-end test of the browser-side relay client (src/systems/relay/
 * relayClient.js) against the real server plugin, in Node.
 *
 * SillyTavern internals the client imports (script.js, extensions.js, DES
 * state) are replaced by small stubs in a sandbox copy; `window.fetch` is
 * Node's fetch resolved against a local server that hosts both the plugin
 * router and a scripted "backend". The interesting case — the connection
 * carrying the stream is cut mid-reply — is simulated by the server
 * destroying the socket, and the test checks SillyTavern would still receive
 * every byte exactly once.
 *
 * Usage: node tools/relay-client-test.mjs
 */
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.join(here, '..');
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

/* ---------------- sandbox with stubs ---------------- */

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'des-relay-client-'));
const des = path.join(sandbox, 'scripts/extensions/third-party/DES');
fs.mkdirSync(path.join(des, 'src/systems/relay'), { recursive: true });
fs.mkdirSync(path.join(des, 'src/core'), { recursive: true });
for (const f of ['relayClient.js', 'relayPlan.js']) {
    fs.copyFileSync(path.join(repo, 'src/systems/relay', f), path.join(des, 'src/systems/relay', f));
}
fs.writeFileSync(path.join(des, 'src/core/state.js'), `export const extensionSettings = { enabled: true, relay: { enabled: true, wakeLock: false } };\n`);
fs.writeFileSync(path.join(sandbox, 'script.js'), `export function getRequestHeaders({ omitContentType = false } = {}) { const h = { 'Content-Type': 'application/json', 'X-CSRF-Token': 'csrf-1' }; if (omitContentType) delete h['Content-Type']; return h; }\nexport const saves = { count: 0 };\nexport async function saveChatConditional() { saves.count++; }\n`);
fs.writeFileSync(path.join(sandbox, 'scripts/extensions.js'), `export const ctx = { groupId: null, characterId: 0, characters: [{ avatar: 'hex.png' }], chatId: 'chat-1', chat: [{ is_user: true, mes: 'hi' }] };\nexport function getContext() { return ctx; }\n`);

globalThis.window = globalThis;
globalThis.document = { visibilityState: 'visible', addEventListener() {} };
const nodeFetch = globalThis.fetch;
let base = '';
globalThis.fetch = (input, init) => nodeFetch(new URL(typeof input === 'string' ? input : input.url, base), init);

/* ---------------- server: plugin + scripted backend ---------------- */

const { createRelay } = await import(pathToFileURL(path.join(repo, 'server-plugin/des-relay/index.mjs')).href);
const dataDir = path.join(sandbox, 'data');
const relay = createRelay({ dataDir, heartbeatMs: 50, headerWaitMs: 40, log: () => {}, warn: () => {} });

function makeRouter() {
    const routes = [];
    const add = (method) => (pattern, handler) => {
        const keys = [];
        const re = new RegExp('^' + pattern.replace(/:([a-zA-Z]+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
        routes.push({ method, re, keys, handler });
    };
    return {
        get: add('GET'), post: add('POST'),
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
const router = makeRouter();
relay.attach(router);

const backend = {
    seen: [],
    events: ['{"choices":[{"delta":{"content":"Hel"}}]}', '{"choices":[{"delta":{"content":"lo"}}]}', '{"choices":[{"delta":{"content":" world"}}]}', '{"choices":[{"delta":{"content":"!"}}]}'],
    gapMs: 30,
    cutStreamOnce: false,   // destroy the client's /stream socket after the first bytes (once)
    lateErrorMs: 0,         // > 0: answer with 429 after this delay instead of streaming
};
const expectedStream = () => backend.events.map(e => `data: ${e}\n\n`).join('') + 'data: [DONE]\n\n';

const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = Buffer.concat(chunks);
    if (url.pathname === '/api/backends/chat-completions/generate') {
        const payload = JSON.parse(body.toString() || '{}');
        backend.seen.push({ headers: req.headers, body: payload });
        if (backend.lateErrorMs) {
            await sleep(backend.lateErrorMs);
            res.statusCode = 429;
            return res.end('{"error":{"message":"rate limited"}}');
        }
        if (!payload.stream) {
            await sleep(backend.gapMs);
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            return res.end(JSON.stringify({ choices: [{ message: { content: 'plain reply' } }] }));
        }
        res.flushHeaders();
        for (const ev of backend.events) {
            if (res.destroyed) return;
            res.write(`data: ${ev}\n\n`);
            await sleep(backend.gapMs);
        }
        res.write('data: [DONE]\n\n');
        return res.end();
    }
    const prefix = '/api/plugins/des-relay';
    if (!url.pathname.startsWith(prefix)) { res.statusCode = 404; return res.end(); }
    const m = router.match(req.method, url.pathname.slice(prefix.length) || '/');
    if (!m) { res.statusCode = 404; return res.end('no route'); }
    req.params = m.params;
    req.query = Object.fromEntries(url.searchParams);
    req.user = { profile: { handle: 'default-user' } };
    try { req.body = body.length ? JSON.parse(body.toString()) : undefined; } catch { req.body = undefined; }
    if (m.params.id && url.pathname.endsWith('/stream') && backend.cutStreamOnce) {
        backend.cutStreamOnce = false;
        // Let a first chunk (or the headers) through, then kill the connection under the client.
        const origWrite = res.write.bind(res);
        let writes = 0;
        res.write = (chunk, ...rest) => {
            const r = origWrite(chunk, ...rest);
            if (++writes === 1) setTimeout(() => res.socket?.destroy(), 5);
            return r;
        };
        if (backend.lateErrorMs) setTimeout(() => res.socket?.destroy(), 60);
    }
    await m.handler(req, res);
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
base = `http://127.0.0.1:${server.address().port}`;

/* ---------------- the client under test ---------------- */

const client = await import(pathToFileURL(path.join(des, 'src/systems/relay/relayClient.js')).href);
const { ctx } = await import(pathToFileURL(path.join(sandbox, 'scripts/extensions.js')).href);
const { saves } = await import(pathToFileURL(path.join(sandbox, 'script.js')).href);
const GEN = '/api/backends/chat-completions/generate';
const stHeaders = () => ({ 'Content-Type': 'application/json', 'X-CSRF-Token': 'csrf-1' });
const readAll = async (res) => Buffer.from(await res.arrayBuffer()).toString();
const jobsOnServer = async () => (await (await client.relayFetch('/jobs')).json()).jobs;

await test('handshake connects and installs the wrapper once', async () => {
    const c = await client.initRelayClient();
    assert.equal(c.state, 'connected');
    assert.equal(window.fetch.__desRelayWrapper, true);
    const w = window.fetch;
    client.initRelayClient();
    assert.equal(window.fetch, w, 'second init keeps the same wrapper');
});

await test('streaming reply goes through the relay and arrives byte-identical', async () => {
    client.onGenerationStarted(undefined, {}, false);
    const res = await window.fetch(GEN, { method: 'POST', headers: stHeaders(), body: JSON.stringify({ stream: true, chat_completion_source: 'openai', messages: [] }) });
    assert.equal(res.ok, true);
    assert.equal(await readAll(res), expectedStream());
    const fwd = backend.seen.at(-1);
    assert.ok(fwd.headers['x-des-relay-job'], 'backend request came from the plugin');
    assert.equal(fwd.headers['x-csrf-token'], 'csrf-1');
    const jobs = await jobsOnServer();
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].meta.kind, 'normal');
    assert.equal(jobs[0].meta.messageIndex, 1, 'reply will be pushed at chat.length');
    assert.equal(jobs[0].meta.chatId, 'c:hex.png:chat-1');
    assert.match(jobs[0].id, /^[0-9a-f-]{36}$/, 'client-chosen job id');
    const savesBefore = saves.count;
    client.onGenerationEnded();
    await sleep(1700); // consume runs 1.5 s after GENERATION_ENDED
    assert.equal(saves.count, savesBefore + 1, 'chat saved before the server forgets the job');
    assert.equal((await jobsOnServer()).length, 0, 'job consumed after the chat save');
});

await test('a cut connection mid-stream is resumed at the byte offset — no gap, no repeat', async () => {
    backend.cutStreamOnce = true;
    backend.gapMs = 60;
    client.onGenerationStarted('normal', {}, false);
    const res = await window.fetch(GEN, { method: 'POST', headers: stHeaders(), body: JSON.stringify({ stream: true, messages: [] }) });
    assert.equal(res.ok, true);
    const text = await readAll(res);
    assert.equal(text, expectedStream(), 'SillyTavern sees the whole reply exactly once');
    assert.equal(backend.cutStreamOnce, false, 'the cut actually happened');
    backend.gapMs = 30;
    client.onGenerationEnded();
    await sleep(1700);
    assert.equal((await jobsOnServer()).length, 0);
});

await test('a backend error that lands after a reconnect is surfaced in-band, not retried for minutes', async () => {
    backend.lateErrorMs = 120;      // backend answers 429 after the header wait (40 ms) expired
    backend.cutStreamOnce = true;   // the first /stream (sent as 200) is cut under the client
    client.onGenerationStarted('normal', {}, false);
    const t0 = Date.now();
    const res = await window.fetch(GEN, { method: 'POST', headers: stHeaders(), body: JSON.stringify({ stream: true, messages: [] }) });
    const text = await readAll(res);
    backend.lateErrorMs = 0;
    assert.equal(res.status, 200, 'ST was handed 200 before the backend answered');
    assert.ok(Date.now() - t0 < 5000, 'finished promptly');
    assert.match(text, /data: \{"error":\{"message":"429: .*rate limited/, `in-band error event, got: ${text}`);
    await sleep(50);
    assert.equal((await jobsOnServer()).length, 0, 'nothing left to recover');
    client.onGenerationEnded();
});

await test('swipe meta records the target message and pending swipe slot', async () => {
    ctx.chat = [{ is_user: true, mes: 'hi' }, { is_user: false, mes: '...', swipes: ['first'], swipe_id: 1 }];
    client.onGenerationStarted('swipe', {}, false);
    const res = await window.fetch(GEN, { method: 'POST', headers: stHeaders(), body: JSON.stringify({ stream: true, messages: [] }) });
    await readAll(res);
    const [job] = await jobsOnServer();
    assert.equal(job.meta.kind, 'swipe');
    assert.equal(job.meta.messageIndex, 1);
    assert.equal(job.meta.swipeId, 1);
    ctx.chat = [{ is_user: true, mes: 'hi' }];
    client.onGenerationEnded();
    await sleep(1700);
});

await test('non-streaming request long-polls and returns the mirrored JSON; DES tags consume at once', async () => {
    backend.gapMs = 120;
    const res = await client.withRelayKind('des-tracker', () => window.fetch(GEN, { method: 'POST', headers: stHeaders(), body: JSON.stringify({ stream: false, messages: [] }) }));
    assert.equal(res.ok, true);
    assert.match(res.headers.get('content-type'), /application\/json/);
    assert.equal((await res.json()).choices[0].message.content, 'plain reply');
    await sleep(50);
    assert.equal((await jobsOnServer()).length, 0, 'tracker job consumed immediately');
    backend.gapMs = 30;
});

await test('Stop (AbortSignal) aborts the server job and rejects the fetch with AbortError', async () => {
    backend.gapMs = 150;
    const ac = new AbortController();
    client.onGenerationStarted('normal', {}, false);
    const res = await window.fetch(GEN, { method: 'POST', headers: stHeaders(), body: JSON.stringify({ stream: true, messages: [] }), signal: ac.signal });
    const reader = res.body.getReader();
    await reader.read();
    ac.abort();
    let err = null;
    try {
        while (!(await reader.read()).done) { /* drain */ }
    } catch (e) {
        err = e;
    }
    assert.ok(err && err.name === 'AbortError', `stream errors with AbortError, got ${err?.name}`);
    await sleep(100);
    assert.equal((await jobsOnServer()).length, 0, 'aborted job consumed');
    backend.gapMs = 30;
    client.onGenerationStopped();
});

await test('pass-through: other URLs, group chats, and the disabled toggle never touch the relay', async () => {
    const before = backend.seen.length;
    await window.fetch(`${base}/api/plugins/des-relay/info`);
    ctx.groupId = 'g1';
    const r1 = await window.fetch(GEN, { method: 'POST', headers: stHeaders(), body: JSON.stringify({ stream: false, messages: [] }) });
    assert.equal(r1.ok, true);
    assert.equal(backend.seen.at(-1).headers['x-des-relay-job'], undefined, 'group chat request went direct');
    ctx.groupId = null;
    await client.setRelayEnabled(false);
    const r2 = await window.fetch(GEN, { method: 'POST', headers: stHeaders(), body: JSON.stringify({ stream: false, messages: [] }) });
    assert.equal(r2.ok, true);
    assert.equal(backend.seen.at(-1).headers['x-des-relay-job'], undefined, 'disabled → direct');
    assert.equal(backend.seen.length, before + 2);
    await client.setRelayEnabled(true);
    assert.equal(client.getRelayConnection().state, 'connected');
});

await test('relay gone at request time falls back to a direct request', async () => {
    relay.close(); // /generate now answers 503
    client.onGenerationStarted('normal', {}, false);
    const res = await window.fetch(GEN, { method: 'POST', headers: stHeaders(), body: JSON.stringify({ stream: true, messages: [] }) });
    assert.equal(await readAll(res), expectedStream());
    assert.equal(backend.seen.at(-1).headers['x-des-relay-job'], undefined, 'served directly');
    client.onGenerationEnded();
});

server.close();
fs.rmSync(sandbox, { recursive: true, force: true });
console.log(process.exitCode ? `\n${passed} passed, some FAILED` : `\nALL ${passed} PASSED`);
process.exit(process.exitCode || 0);
