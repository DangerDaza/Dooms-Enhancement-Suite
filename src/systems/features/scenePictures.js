/**
 * Scene pictures — the lifecycle (Project Short Fuse, Phase 7; docs/scene-pictures-plan.md).
 *
 * Every N of the player's turns (D64) a background request on the tracker's
 * connection profile turns the recent messages into one caption (D61),
 * Moss Studio renders it with this chat's LoRAs (D62, D63) and the picture
 * lands in the chat as a message from the narrator (D60). The model
 * (src/utils/scenePictures.js) holds every rule; this module holds the
 * chat, the clock and the network.
 *
 *   - this chat's state under chat_metadata.dooms_scene, bound to the
 *     chat it was loaded from (a run whose chat changed is discarded);
 *   - MESSAGE_SENT counts the player's turn; GENERATION_ENDED starts a run
 *     that is due, once the main generation and any other background
 *     request are over;
 *   - the caption through withBackgroundProfile (external mode respected),
 *     the picture through the studio's API, saved into SillyTavern, posted
 *     the way SillyTavern's own image extension posts;
 *   - /scene runs one now; the settings page reads getSceneStatus().
 */
import { chat, chat_metadata, saveChatConditional, eventSource, event_types, addOneMessage, default_avatar } from '../../../../../../../script.js';
import * as ST from '../../../../../../../script.js';    // is_send_press read by name: a build without it reads undefined, not a link error
import { getContext } from '../../../../../../extensions.js';
import { saveBase64AsFile } from '../../../../../../utils.js';
import { getMessageTimeStamp } from '../../../../../../RossAscends-mods.js';
import { SlashCommandParser } from '../../../../../../../scripts/slash-commands/SlashCommandParser.js';
import { SlashCommand } from '../../../../../../../scripts/slash-commands/SlashCommand.js';
import { extensionSettings, lastGeneratedData, committedTrackerData } from '../../core/state.js';
import { withBackgroundProfile, BACKGROUND_BUSY, generateWithExternalAPI, parseCharacterEntriesFromThoughts, backgroundHolder } from '../generation/apiClient.js';
import { safeGenerateRaw } from '../../utils/responseExtractor.js';
import { buildRecentText } from '../../utils/liveWorld.js';
import { resolvePersonaName } from './diceRolls.js';
import {
    SCENE_META_KEY, scenePicturesConfig, freshSceneState, sceneStateOf, countTurn, pictureDue, afterPicture, afterFailure,
    normalizeLoras, buildCaptionPrompt, parseCaptionReply, captionLine, studioEndpoints, buildGenerateBody, readJobId, readJobs,
    readLoraNames, preflightLine,
} from '../../utils/scenePictures.js';

// ─── State ──────────────────────────────────────────────────────────────────

export const SCENE_CHANGED_EVENT = 'dooms:scene-pictures-changed';

let state = freshSceneState();
let loadToken = 0;          // bumped by every chat load; a run that outlives its chat is discarded
let loadedMeta = null;      // the chat_metadata object the state was loaded from
let loadedChat = undefined; // the chat id it was loaded with
let running = false;
let armed = false;          // a run is due and waits for the generation to end
let transport = null;       // tests: { caption(prompt) → text, studio(kind, url, body) → json | { blob } }

const log = (message, data = null) => {
    const line = `[Dooms Tracker] Scene pictures: ${message}`;
    if (data !== null && cfg().debug) console.log(line, data); else console.log(line);
};

function cfg() { return scenePicturesConfig(extensionSettings); }

function chatId() {
    try { return getContext().chatId; } catch (e) { return undefined; }
}

function chatArray() {
    try { const ctx = getContext(); if (ctx && Array.isArray(ctx.chat)) return ctx.chat; } catch (e) { /* fall through */ }
    return Array.isArray(chat) ? chat : null;
}

/** On: the extension and the feature both switched on, with a chat open. */
function ready() {
    return !!(extensionSettings.enabled && cfg().enabled && chat_metadata && chat_metadata === loadedMeta);
}

function commit(next) {
    state = next;
    if (chat_metadata && typeof chat_metadata === 'object' && chat_metadata === loadedMeta) {
        chat_metadata[SCENE_META_KEY] = JSON.parse(JSON.stringify(state));
    }
    announce();
}

function announce() {
    try { if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') window.dispatchEvent(new CustomEvent(SCENE_CHANGED_EVENT)); } catch (e) { /* no window */ }
}

/** CHAT_CHANGED (and start): this chat's state, a fresh one when it has none. */
export function onSceneChatChanged() {
    loadToken++;
    loadedMeta = chat_metadata && typeof chat_metadata === 'object' ? chat_metadata : null;
    loadedChat = chatId();
    armed = false;
    state = sceneStateOf(loadedMeta ? loadedMeta[SCENE_META_KEY] : null);
    announce();
}

export function getSceneState() { return state; }

/** The chat's LoRA list (D63) and identity notes, set from the settings page. */
export function setSceneLoras(list) { commit({ ...state, loras: normalizeLoras(list) }); }
export function setSceneIdentity(text) { commit({ ...state, identity: String(text || '') }); }

export function getSceneStatus() {
    const c = cfg();
    return { enabled: c.enabled, every: c.every, sinceLast: state.sinceLast, retryNext: state.retryNext, running, armed, last: state.last, chatBound: !!loadedMeta };
}

/** A message's key for counting: its id when SillyTavern gives one, else its send date and text. */
function messageKey(m) {
    if (!m) return '';
    if (typeof m.dooms_scene_key === 'string' && m.dooms_scene_key) return m.dooms_scene_key;
    const key = `${m.send_date || ''}|${String(m.mes || '').slice(0, 80)}`;
    try { m.dooms_scene_key = key; } catch (e) { /* frozen, the key still works */ }
    return key;
}

// ─── Events ─────────────────────────────────────────────────────────────────

/** MESSAGE_SENT: the player's turn counts once; every N, the run is armed for the end of the reply. */
export function onSceneMessageSent() {
    if (!ready()) return;
    const list = chatArray();
    const m = list && list.length ? list[list.length - 1] : null;
    if (!m || !m.is_user) return;
    const r = countTurn(state, messageKey(m));
    if (!r.counted) return;
    commit(r.state);
    if (pictureDue(state, cfg().every)) { armed = true; log(`due after ${state.sinceLast} turn${state.sinceLast === 1 ? '' : 's'}; runs when the reply is done`); }
}

/** GENERATION_ENDED and GENERATION_STOPPED: an armed run goes now. */
export function onSceneGenerationEnded() {
    if (!ready() || !armed || running) return;
    armed = false;
    illustrateNow({ reason: 'count' }).catch(e => log(`run failed: ${e && e.message ? e.message : e}`));
}

// ─── The run ────────────────────────────────────────────────────────────────

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/** Waits for the main generation and any other background request to be over, up to maxMs. */
async function whenIdle(maxMs = 120000) {
    const started = Date.now();
    while (Date.now() - started < maxMs) {
        const mainBusy = ST.is_send_press === true;
        const bgBusy = !!backgroundHolder();
        if (!mainBusy && !bgBusy) return true;
        await sleep(1500);
    }
    return false;
}

function presentNames() {
    try {
        const entries = parseCharacterEntriesFromThoughts(committedTrackerData.characterThoughts || lastGeneratedData.characterThoughts);
        return (Array.isArray(entries) ? entries : []).map(e => (e && typeof e.name === 'string' ? e.name.trim() : '')).filter(Boolean);
    } catch (e) { return []; }
}

function withTimeout(promise, ms, what) {
    return new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error(`${what} took longer than ${Math.round(ms / 1000)} s`)), ms);
        Promise.resolve(promise).then(v => { clearTimeout(t); resolve(v); }, e => { clearTimeout(t); reject(e); });
    });
}

/** The caption, through the background request (D61). BACKGROUND_BUSY when another holds the flag. */
async function writeCaption(c) {
    const persona = resolvePersonaName() || 'Player';
    const recent = buildRecentText(chatArray(), { count: c.window, persona });
    const prompt = buildCaptionPrompt({ recent, present: presentNames(), identity: state.identity, guide: c.guide, size: c.size });
    const external = extensionSettings.generationMode === 'external';
    const messages = [{ role: 'system', content: prompt.system }, { role: 'user', content: prompt.user }];
    const run = async () => {
        if (transport && transport.caption) return transport.caption(prompt);
        if (external) return generateWithExternalAPI(messages);
        return safeGenerateRaw({ prompt: messages, quietToLoud: false });
    };
    const result = await withBackgroundProfile(() => withTimeout(run(), 90000, 'the caption request'), { external, label: 'scene' });
    if (result === BACKGROUND_BUSY) return BACKGROUND_BUSY;
    const text = typeof result === 'string' ? result : (result && typeof result === 'object' && typeof result.text === 'string' ? result.text : String(result ?? ''));
    return parseCaptionReply(text);
}

/** One request to the studio: JSON in and out, or a blob for an image; a refused origin named for what it is. */
async function studio(kind, url, body = null, { timeoutMs = 20000 } = {}) {
    if (transport && transport.studio) return transport.studio(kind, url, body);
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    try {
        const init = { method: body ? 'POST' : 'GET', signal: controller ? controller.signal : undefined };
        if (body) { init.headers = { 'Content-Type': 'application/json' }; init.body = JSON.stringify(body); }
        let response;
        try {
            response = await fetch(url, init);
        } catch (e) {
            if (e && e.name === 'AbortError') throw new Error(`the studio did not answer within ${Math.round(timeoutMs / 1000)} s (${url})`);
            throw new Error(`the studio could not be reached at ${url}: it is not running, or it refused this page's origin (it has to send Access-Control-Allow-Origin)`);
        }
        if (!response.ok) throw new Error(`the studio answered ${response.status} for ${url}`);
        if (kind === 'blob') return { blob: await response.blob() };
        return await response.json();
    } finally {
        if (timer) clearTimeout(timer);
    }
}

/** Settings → Test connection: the preflight in a line, and the LoRA names the studio lists. */
export async function testStudio() {
    const c = cfg();
    const e = studioEndpoints(c);
    const pre = await studio('json', e.preflight);
    let loras = [];
    try { loras = readLoraNames(await studio('json', e.loras)); } catch (err) { /* the preflight is the answer */ }
    log('preflight', pre);
    return { line: preflightLine(pre), loras, raw: pre };
}

export async function listStudioLoras() {
    return readLoraNames(await studio('json', studioEndpoints(cfg()).loras));
}

/** The picture: generate, poll the job, fetch the file; { file, dataUrl }. */
async function renderPicture(c, caption, stale) {
    const e = studioEndpoints(c);
    const body = buildGenerateBody(c, state, caption, { title: `DES scene ${new Date().toISOString().slice(0, 16)}` });
    log('generate', body);
    const started = await studio('json', e.generate, body);
    const id = readJobId(started);
    if (!id) throw new Error(`the studio gave no job id (${JSON.stringify(started).slice(0, 200)})`);
    const deadline = Date.now() + c.timeoutSec * 1000;
    let job = null;
    while (Date.now() < deadline) {
        await sleep(2000);
        if (stale()) throw new Error('the chat changed while the studio rendered');
        job = readJobs(await studio('json', e.jobs), id);
        if (job.failed) throw new Error(`the studio reported the job failed${job.error ? `: ${job.error}` : ''}`);
        if (job.done) break;
    }
    if (!job || !job.done) throw new Error(`the studio did not finish job ${id} within ${c.timeoutSec} s`);
    if (!job.images.length) throw new Error(`job ${id} finished with no image`);
    const file = job.images[0];
    const { blob } = await studio('blob', e.image(file), null, { timeoutMs: 60000 });
    const dataUrl = await new Promise((resolve, reject) => {
        try {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result || ''));
            reader.onerror = () => reject(new Error('the image could not be read'));
            reader.readAsDataURL(blob);
        } catch (err) { reject(err); }
    });
    return { file, dataUrl };
}

/** The picture saved into SillyTavern's own images and posted as the narrator's message (D60). */
async function postPicture(c, { caption, file, dataUrl, loras }) {
    const comma = dataUrl.indexOf(',');
    const base64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
    const format = /^data:image\/(\w+)/.exec(dataUrl)?.[1] || 'png';
    let folder = 'scenes';
    try { folder = getContext().name2 || folder; } catch (e) { /* no context, the default folder */ }
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const url = await saveBase64AsFile(base64, folder, `des-scene-${stamp}`, format);
    const message = {
        name: c.narrator,
        is_user: false,
        is_system: !c.toAI,
        send_date: getMessageTimeStamp(),
        mes: captionLine(caption) ? `*${captionLine(caption)}*` : '',
        force_avatar: default_avatar,
        original_avatar: default_avatar,
        extra: {
            image: url,
            title: caption,
            inline_image: false,
            dooms_scene: { caption, file, loras, at: Date.now() },
        },
    };
    const list = chatArray() || chat;
    list.push(message);
    const index = list.length - 1;
    await eventSource.emit(event_types.MESSAGE_RECEIVED, index, 'extension');
    try { addOneMessage(message); } catch (e) { log(`the message could not be rendered: ${e && e.message ? e.message : e}`); }
    await eventSource.emit(event_types.CHARACTER_MESSAGE_RENDERED, index, 'extension');
    try { await saveChatConditional(); } catch (e) { log('the chat could not be saved at once; the next save carries it'); }
    return { url, index };
}

function notice(text, kind = 'info') {
    if (!cfg().notify) return;
    try { if (typeof toastr !== 'undefined' && toastr && typeof toastr[kind] === 'function') toastr[kind](text, "Doom's Enhancement Suite", { timeOut: kind === 'error' ? 8000 : 5000 }); } catch (e) { /* no toastr */ }
}

/**
 * One picture of the scene now: the caption, the render, the message.
 * `reason`: 'count' (the cadence), 'command' (/scene), 'manual' (settings).
 */
export async function illustrateNow({ reason = 'manual' } = {}) {
    if (!extensionSettings.enabled) return { ok: false, reason: 'off' };
    const c = cfg();
    if (reason === 'count' && !c.enabled) return { ok: false, reason: 'off' };
    if (!loadedMeta) return { ok: false, reason: 'no-chat' };
    if (running) return { ok: false, reason: 'running' };
    running = true;
    const token = loadToken;
    const stale = () => token !== loadToken || chat_metadata !== loadedMeta || (chatId() !== undefined && chatId() !== loadedChat);
    try {
        if (!(await whenIdle())) { commit(afterFailure(state, { at: Date.now(), error: 'the chat stayed busy' })); return { ok: false, reason: 'busy' }; }
        if (stale()) return { ok: false, reason: 'stale' };
        log(`run (${reason})`);
        const caption = await writeCaption(c);
        if (stale()) return { ok: false, reason: 'stale' };
        if (caption === BACKGROUND_BUSY) { commit({ ...state, retryNext: true }); log('waits: another background request holds the flag'); return { ok: false, reason: 'busy' }; }
        if (!caption) throw new Error('the caption request gave nothing usable');
        log('caption', caption);
        const picture = await renderPicture(c, caption, stale);
        if (stale()) return { ok: false, reason: 'stale' };
        const posted = await postPicture(c, { caption, file: picture.file, dataUrl: picture.dataUrl, loras: state.loras });
        commit(afterPicture(state, { at: Date.now(), caption, file: picture.file, url: posted.url }));
        notice('A picture of the scene is in the chat.', 'success');
        return { ok: true, url: posted.url, caption };
    } catch (e) {
        const error = e && e.message ? e.message : String(e);
        log(`failed: ${error}`);
        if (!stale()) commit(afterFailure(state, { at: Date.now(), error }));
        notice(`No picture this time: ${error}`, 'error');
        return { ok: false, reason: 'error', error };
    } finally {
        running = false;
        announce();
    }
}

// ─── Commands and start ─────────────────────────────────────────────────────

function registerSceneCommands() {
    try {
        SlashCommandParser.addCommandObject(SlashCommand.fromProps({
            name: 'scene',
            callback: async () => {
                const r = await illustrateNow({ reason: 'command' });
                if (r.ok) return 'A picture of the scene is in the chat.';
                const why = { off: 'Doom\'s Enhancement Suite is off.', 'no-chat': 'No chat is open.', running: 'A picture is already being made.', busy: 'The chat is busy; it tries again after the next reply.', stale: 'The chat changed meanwhile.' };
                return why[r.reason] || `No picture: ${r.error || r.reason}`;
            },
            helpString: 'Scene pictures: makes one picture of the recent scene now, through Moss Studio, and posts it as the narrator.',
            returns: 'one line saying what happened',
        }));
    } catch (e) {
        console.warn('[Dooms Tracker] Scene pictures: /scene could not be registered', e);
    }
}

/** Registers /scene. The events are wired by index.js. */
export function initScenePictures() {
    registerSceneCommands();
}

/** Tests: the caption and the studio behind functions. */
export function __setSceneTransport(fn) { transport = fn || null; }
