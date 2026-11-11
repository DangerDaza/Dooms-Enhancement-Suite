#!/usr/bin/env node
/**
 * DES Voices through OpenRouter, the real module with the network stubbed
 * (docs/tts-connections-plan.md §6.1): one line asked for over the browser
 * route and over SillyTavern's server route, and what comes back made
 * playable.
 *
 * The stubs answer as the real services do. OpenRouter gives Gemini TTS
 * as raw PCM only (16-bit little-endian mono, marked audio/pcm) and
 * refuses any other format with a 400: the report on 3.2.0-beta.1,
 * 'Gemini TTS only supports response_format="pcm". Got "mp3".'
 * SillyTavern's /api/openai/custom/generate-voice forwards the format it
 * is given, relays a refusal as a 500 with OpenRouter's text, and marks
 * the audio it relays audio/mpeg whatever it is.
 *
 * Usage:  node tools/voices-openrouter-flow-test.mjs     (from the repo root)
 * Exit:   0 = pass, 1 = failure
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { buildSandbox } from './sandbox.mjs';

const { SANDBOX, DES } = buildSandbox();
if (!existsSync(`${DES}/src/systems/voices/openrouter.js`)) {
    console.error('FAIL: sandbox missing after load-check — cannot run.');
    process.exit(1);
}

// SillyTavern's own modules, as far as this module reads them: the saved keys and the headers of a request to its server.
globalThis.__DES_SECRETS__ = {};
const patch = (file, from, to) => {
    const before = readFileSync(file, 'utf8');
    if (!before.includes(from)) { console.error(`FAIL: the stub ${file} was not patched (an import changed name?)`); process.exit(1); }
    writeFileSync(file, before.replace(from, to));
};
patch(`${SANDBOX}/scripts/secrets.js`, 'export const secret_state = anything;', 'export const secret_state = globalThis.__DES_SECRETS__;');
patch(`${SANDBOX}/script.js`, 'export const getRequestHeaders = anything;', "export const getRequestHeaders = () => ({ 'Content-Type': 'application/json' });");

const anything = new Proxy(function () {}, {
    get(t, p) {
        if (p === Symbol.toPrimitive) return () => 'stub';
        if (p === 'then') return undefined;
        if (p === Symbol.iterator) return function* () {};
        return anything;
    },
    apply() { return anything; },
    construct() { return {}; },
});
globalThis.__DES_ANYTHING__ = anything;
globalThis.window = globalThis;
globalThis.self = globalThis;
globalThis.document = anything;
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
Object.defineProperty(globalThis, 'navigator', { value: { hardwareConcurrency: 8, maxTouchPoints: 0 }, configurable: true });
globalThis.jQuery = anything;
globalThis.$ = anything;
globalThis.toastr = anything;

let failures = 0;
const check = (label, cond, extra = '') => {
    if (cond) { console.log(`pass  ${label}`); }
    else { console.error(`FAIL  ${label}${extra ? '\n      ' + extra : ''}`); failures++; }
};

// ─── The services ───────────────────────────────────────────────────────────

const OPENROUTER = 'https://openrouter.ai/api/v1/audio/speech';
const ST_ROUTE = '/api/openai/custom/generate-voice';
/** A tenth of a second of a 440 Hz tone: 2400 samples at 24 kHz, 16-bit little-endian, no header. */
const PCM = (() => {
    const out = new Uint8Array(2400 * 2);
    const view = new DataView(out.buffer);
    for (let i = 0; i < 2400; i++) view.setInt16(i * 2, Math.round(Math.sin(2 * Math.PI * 440 * i / 24000) * 9000), true);
    return out;
})();
const refusal = (asked) => JSON.stringify({ error: { code: 400, message: `Gemini TTS only supports response_format="pcm". Got "${asked}".` } });

let calls = [];
let mode = 'ok';    // 'ok' | 'cors' (the browser cannot reach OpenRouter) | 'wav' (a WAV file comes back) | 'empty'
globalThis.fetch = async (url, init = {}) => {
    const body = JSON.parse(init.body || '{}');
    const to = String(url);
    calls.push({ to, body, auth: init.headers ? init.headers.Authorization : undefined });
    if (to === OPENROUTER) {
        if (mode === 'cors') throw new TypeError('Failed to fetch');
        if (body.response_format !== 'pcm') return new Response(refusal(body.response_format), { status: 400, headers: { 'content-type': 'application/json' } });
        if (mode === 'empty') return new Response(new Uint8Array(0), { status: 200, headers: { 'content-type': 'audio/pcm' } });
        return new Response(PCM, { status: 200, headers: { 'content-type': 'audio/pcm' } });
    }
    if (to === ST_ROUTE) {
        if (body.response_format !== 'pcm') return new Response(refusal(body.response_format), { status: 500 });
        if (mode === 'wav') return new Response(wavOf(PCM), { status: 200, headers: { 'content-type': 'audio/mpeg' } });
        return new Response(PCM, { status: 200, headers: { 'content-type': 'audio/mpeg' } });
    }
    return new Response('not found', { status: 404 });
};

const { extensionSettings } = await import(`${DES}/src/core/state.js`);
const { pcm16ToWav } = await import(`${DES}/src/systems/voices/wav.js`);
const { TtsError } = await import(`${DES}/src/systems/voices/transport.js`);
const or = await import(`${DES}/src/systems/voices/openrouter.js`);
const wavOf = (pcm) => pcm16ToWav(pcm, 24000);

const settings = (v) => { extensionSettings.voices = { openrouterKey: '', openrouterRoute: 'auto', ...v }; or.resetOpenRouterState(); calls = []; mode = 'ok'; };
const say = (text = 'The harbour is quiet tonight.') => or.synthesizeOpenRouter({ text, voiceId: 'Kore', model: 'gemini-3.8-flash-lite-tts', style: 'calm' });
/** What a blob is, read the way a browser's decoder would: its type, its header, its samples. */
const read = async (blob) => {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const view = new DataView(bytes.buffer);
    const word = (at) => String.fromCharCode(...bytes.slice(at, at + 4));
    return { type: blob.type, riff: word(0), wave: word(8), channels: view.getUint16(22, true), rate: view.getUint32(24, true), bits: view.getUint16(34, true), data: view.getUint32(40, true), samples: bytes.slice(44), size: bytes.length };
};
const sameBytes = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

// ─── The checks ─────────────────────────────────────────────────────────────

console.log('\n§1 straight from the browser');
{
    settings({ openrouterKey: 'sk-or-test' });
    let out = null, error = null;
    try { out = await say(); } catch (e) { error = e; }
    check('the line is asked for as raw PCM, with the key, the Gemini model and the voice: OpenRouter does not refuse it', !error && calls.length === 1 && calls[0].to === OPENROUTER && calls[0].auth === 'Bearer sk-or-test' && calls[0].body.response_format === 'pcm' && calls[0].body.model === 'google/gemini-3.8-flash-lite-tts' && calls[0].body.voice === 'Kore' && calls[0].body.input === 'The harbour is quiet tonight.', error ? `${error.kind}: ${error.message}` : JSON.stringify(calls));
    check('the delivery note still rides with it', !error && calls[0].body.provider && calls[0].body.provider.options['google-ai-studio'].speech_metadata.style === 'calm');
    const a = out ? await read(out.blob) : null;
    check('what comes back is a WAV file a browser can play: 24 kHz, mono, 16 bits', !!a && a.type === 'audio/wav' && a.riff === 'RIFF' && a.wave === 'WAVE' && a.channels === 1 && a.rate === 24000 && a.bits === 16, JSON.stringify(a && { ...a, samples: undefined }));
    check('with every sample OpenRouter sent, as it sent them', !!a && a.data === PCM.length && a.size === 44 + PCM.length && sameBytes(a.samples, PCM));
    check('and the model it was played with is named', !!out && out.model === 'google/gemini-3.8-flash-lite-tts' && or.getOpenRouterState().lastRoute === 'browser');
}

console.log('\n§2 through SillyTavern\'s server route');
{
    globalThis.__DES_SECRETS__.api_key_custom_openai_tts = [{ id: 'k1' }];
    settings({ openrouterRoute: 'server' });
    let out = null, error = null;
    try { out = await say(); } catch (e) { error = e; }
    check('the server route asks for raw PCM too, at OpenRouter\'s speech address', !error && calls.length === 1 && calls[0].to === ST_ROUTE && calls[0].body.response_format === 'pcm' && calls[0].body.provider_endpoint === OPENROUTER && calls[0].body.model === 'google/gemini-3.8-flash-lite-tts' && calls[0].body.voice === 'Kore', error ? `${error.kind}: ${error.message}` : JSON.stringify(calls));
    const a = out ? await read(out.blob) : null;
    check('SillyTavern marks what it relays audio/mpeg; it is PCM all the same, and is wrapped as a WAV', !!a && a.type === 'audio/wav' && a.riff === 'RIFF' && a.rate === 24000 && a.data === PCM.length && sameBytes(a.samples, PCM), JSON.stringify(a && { ...a, samples: undefined }));
    mode = 'wav';
    calls = [];
    const again = await read((await say()).blob);
    check('a WAV file relayed that way is played as it is, not wrapped a second time', again.type === 'audio/wav' && again.size === 44 + PCM.length && sameBytes(again.samples, PCM));
}

console.log('\n§3 the browser cannot reach OpenRouter: the server route takes over');
{
    settings({ openrouterKey: 'sk-or-test', openrouterRoute: 'auto' });
    mode = 'cors';
    const out = await say();
    const a = await read(out.blob);
    check('one try from the browser, then SillyTavern\'s route, and the line plays', calls.length === 2 && calls[0].to === OPENROUTER && calls[1].to === ST_ROUTE && calls[1].body.response_format === 'pcm' && a.type === 'audio/wav' && sameBytes(a.samples, PCM) && or.getOpenRouterState().lastRoute === 'server' && or.getOpenRouterState().browserBlocked === true);
    calls = [];
    await say('A second line.');
    check('the next line goes straight to the server route', calls.length === 1 && calls[0].to === ST_ROUTE);
}

console.log('\n§4 what still fails says so');
{
    settings({ openrouterKey: 'sk-or-test' });
    mode = 'empty';
    let error = null;
    try { await say(); } catch (e) { error = e; }
    check('an answer with no audio in it is an error, not a silent file', error instanceof TtsError && error.kind === 'content' && /no audio/.test(error.message) && error.provider === 'openrouter', error ? `${error.kind}: ${error.message}` : 'no error');
    delete globalThis.__DES_SECRETS__.api_key_custom_openai_tts;
    settings({});
    error = null;
    try { await say(); } catch (e) { error = e; }
    check('with no key anywhere nothing is sent, and the message says where the key goes', error instanceof TtsError && error.kind === 'no-key' && calls.length === 0);
}

console.log(failures ? `\n${failures} FAILED` : '\nall pass');
process.exit(failures ? 1 : 0);
