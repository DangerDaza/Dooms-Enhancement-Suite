/**
 * Scene pictures — the lifecycle (Project Short Fuse, Phase 7; docs/scene-pictures-plan.md).
 *
 * Every N of the player's turns (D64) a background request on the tracker's
 * connection profile turns the recent messages into one caption (D61), the
 * owner's Moss workflow renders it on ComfyUI with this chat's LoRAs spliced
 * in, through SillyTavern's own ComfyUI endpoints (D62, D63), and the picture
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
 *     the picture through /api/sd/comfy (the workflow from SillyTavern's
 *     store, filled and spliced), saved into SillyTavern, posted the way
 *     SillyTavern's own image extension posts;
 *   - /scene runs one now; the settings page reads getSceneStatus().
 */
import { chat, chat_metadata, saveChatConditional, eventSource, event_types, addOneMessage, default_avatar, getRequestHeaders } from '../../../../../../../script.js';
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
    normalizeLoras, buildCaptionPrompt, parseCaptionReply, captionLine, workflowValues, workflowPlaceholders, isEditorWorkflow, fillWorkflow, injectLoras,
    comfyGenerateBody, readComfyResult, comfyWsUrl, newClientId, nodeKinds,
} from '../../utils/scenePictures.js';

// ─── State ──────────────────────────────────────────────────────────────────

export const SCENE_CHANGED_EVENT = 'dooms:scene-pictures-changed';

let state = freshSceneState();
let loadToken = 0;          // bumped by every chat load; a run that outlives its chat is discarded
let loadedMeta = null;      // the chat_metadata object the state was loaded from
let loadedChat = undefined; // the chat id it was loaded with
let running = false;
let armed = false;          // a run is due and waits for the generation to end
let transport = null;       // tests: { caption(prompt) → text, comfy(kind, body) → json }
let timing = { idleMaxMs: 120000, idleStepMs: 1500 };

// The run in progress, for the bar at the foot of the chat (sceneProgress.js):
// the stage, ComfyUI's step count while it renders, the node it is on, the
// queue ahead, when the run started. 'idle' between runs.
const IDLE_PROGRESS = Object.freeze({ stage: 'idle', value: 0, max: 0, node: '', queue: 0, startedAt: 0, error: '' });
let progress = { ...IDLE_PROGRESS };

function setProgress(patch) {
    progress = { ...progress, ...patch };
    announce();
}

/** The run in progress, a copy; stage 'idle' when none. */
export function getSceneProgress() { return { ...progress }; }

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
    progress = { ...IDLE_PROGRESS };
    announce();
}

export function getSceneState() { return state; }

/** The chat's LoRA list (D63) and identity notes, set from the settings page. */
export function setSceneLoras(list) { commit({ ...state, loras: normalizeLoras(list) }); }
export function setSceneIdentity(text) { commit({ ...state, identity: String(text || '') }); }

export function getSceneStatus() {
    const c = cfg();
    return { enabled: c.enabled, every: c.every, sinceLast: state.sinceLast, retryNext: state.retryNext, running, armed, last: state.last, chatBound: !!loadedMeta, progress: { ...progress } };
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
async function whenIdle(maxMs = timing.idleMaxMs) {
    const started = Date.now();
    for (;;) {
        const mainBusy = ST.is_send_press === true;
        const bgBusy = !!backgroundHolder();
        if (!mainBusy && !bgBusy) return true;
        if (Date.now() - started >= maxMs) return false;
        await sleep(timing.idleStepMs);
    }
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

/**
 * One request to SillyTavern's ComfyUI endpoints (/api/sd/comfy/<kind>):
 * the server talks to ComfyUI, so no header and no second server. A
 * refused answer carries the server's text (ComfyUI's own error for a
 * generate, which names the node and the input that failed).
 */
async function comfy(kind, body, { timeoutMs = 20000 } = {}) {
    if (transport && transport.comfy) return transport.comfy(kind, body);
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    try {
        let response;
        try {
            response = await fetch(`/api/sd/comfy/${kind}`, { method: 'POST', headers: getRequestHeaders(), body: JSON.stringify(body || {}), signal: controller ? controller.signal : undefined });
        } catch (e) {
            if (e && e.name === 'AbortError') throw new Error(`${kind === 'generate' ? 'ComfyUI did not finish the picture' : `the ${kind} request did not answer`} within ${Math.round(timeoutMs / 1000)} s`);
            throw new Error(`SillyTavern's server could not be reached for ${kind}: ${e && e.message ? e.message : e}`);
        }
        const text = await response.text().catch(() => '');
        if (!response.ok) {
            throw new Error(kind === 'ping' ? `ComfyUI at ${body && body.url} did not answer: is that card running?` : `${kind}: ${text || `SillyTavern answered ${response.status}`}`);
        }
        // ping and save-workflow answer with a bare "OK"; the rest with JSON.
        if (!text) return null;
        try { return JSON.parse(text); } catch (e) { return text; }
    } finally {
        if (timer) clearTimeout(timer);
    }
}

/** The workflows in SillyTavern's own store (Image Generation → ComfyUI). */
export async function listWorkflows() {
    const list = await comfy('workflows', {});
    return (Array.isArray(list) ? list : []).map(String);
}

/** One workflow's text from the store, '' for none. */
export async function loadWorkflow(name) {
    const text = await comfy('workflow', { file_name: name });
    return typeof text === 'string' ? text : '';
}

/** A pasted workflow saved into the store under a name, so it can be picked. */
export async function saveWorkflow(name, text) {
    JSON.parse(text);    // not JSON: throws, and the page says so
    if (isEditorWorkflow(text)) throw new Error('this is the ComfyUI editor\'s save format (nodes and links); DES needs the API graph: in ComfyUI, Workflow → Export (API), and paste that');
    await comfy('save-workflow', { file_name: name, workflow: text });
    return name;
}

/**
 * Settings → Test connection: ComfyUI answers at the address, the store's
 * workflows, and the chosen workflow read with its placeholders checked
 * against what DES fills. Throws only when ComfyUI cannot be reached.
 */
export async function testComfy() {
    const c = cfg();
    // The ping goes through SillyTavern's server to ComfyUI's /system_stats; a
    // card mid-render answers it slowly, so a slow ping is noted, not fatal:
    // the workflow checks below need only SillyTavern, and the picture
    // itself waits up to timeoutSec.
    let ping = 'ok';
    let pingError = '';
    try { await comfy('ping', { url: c.comfyUrl }, { timeoutMs: 60000 }); }
    catch (e) { pingError = e && e.message ? e.message : String(e); ping = /within \d+ s/.test(pingError) ? 'slow' : 'down'; }
    let workflows = [];
    try { workflows = await listWorkflows(); } catch (e) { /* the store is SillyTavern's; a miss here is its answer */ }
    let line = ping === 'ok' ? `ComfyUI answers at ${c.comfyUrl}.`
        : ping === 'slow' ? `ComfyUI at ${c.comfyUrl} did not answer within 60 s: a card mid-render answers slowly, and the picture itself waits up to ${c.timeoutSec} s. Try again when it is idle.`
            : pingError;
    let ok = ping === 'ok';
    if (!c.workflow) { line += ' Pick a workflow.'; ok = false; }
    else {
        try {
            const text = await loadWorkflow(c.workflow);
            const found = workflowPlaceholders(text);
            const { missing } = fillWorkflow(text, workflowValues(c, { caption: 'test', seed: 1 }));
            if (isEditorWorkflow(text)) { line += ` The workflow "${c.workflow}" is the ComfyUI editor's save format (nodes and links). DES needs the API graph: in ComfyUI, Workflow → Export (API), and paste that.`; ok = false; }
            else if (!found.includes('prompt')) { line += ` The workflow "${c.workflow}" has no %prompt%${found.length ? ` (it has ${found.map(f => `%${f}%`).join(', ')})` : ' and no placeholder at all'}: the caption would go nowhere. Put %prompt% where the positive text goes.`; ok = false; }
            else if (missing.length) { line += ` The workflow needs ${missing.map(m => `%${m}%`).join(', ')} and nothing fills ${missing.length === 1 ? 'it' : 'them'}: set the models below.`; ok = false; }
            else line += ` The workflow "${c.workflow}" is ready (${found.length} placeholders filled).`;
        } catch (e) {
            line += ` The workflow "${c.workflow}" could not be read: ${e && e.message ? e.message : e}`;
            ok = false;
        }
    }
    return { line, ok, workflows, ping };
}

/**
 * ComfyUI's progress for one render, over its WebSocket (a browser may open
 * one to it directly): the queue ahead, the node it is on, the step count.
 * The client id in the prompt makes ComfyUI send this client its own
 * render's events. No WebSocket, or none that opens: the bar stays
 * indeterminate, nothing else changes. Returns { ready, close }.
 */
function watchComfy(comfyUrl, clientId, kinds) {
    const none = { ready: Promise.resolve(false), close() {} };
    const url = comfyWsUrl(comfyUrl, clientId);
    if (!url || typeof WebSocket !== 'function') return none;
    let ws;
    try { ws = new WebSocket(url); } catch (e) { return none; }
    try { ws.binaryType = 'arraybuffer'; } catch (e) { /* previews come as binary; they are skipped either way */ }
    const ready = new Promise((resolve) => {
        const t = setTimeout(() => resolve(false), 1500);
        ws.onopen = () => { clearTimeout(t); resolve(true); };
        ws.onerror = () => { clearTimeout(t); resolve(false); };
    });
    ws.onmessage = (ev) => {
        if (typeof ev.data !== 'string') return;
        let msg;
        try { msg = JSON.parse(ev.data); } catch (e) { return; }
        const d = msg && msg.data && typeof msg.data === 'object' ? msg.data : {};
        switch (msg && msg.type) {
            case 'status': {
                const q = d.status && d.status.exec_info ? Number(d.status.exec_info.queue_remaining) : NaN;
                if (progress.stage === 'queued' && Number.isFinite(q)) setProgress({ queue: Math.max(0, q - 1) });
                break;
            }
            case 'execution_start': setProgress({ stage: 'rendering', value: 0, max: 0, node: '' }); break;
            case 'executing':
                if (d.node === null || d.node === undefined) { if (progress.stage === 'rendering') setProgress({ stage: 'saving' }); }
                else setProgress({ stage: 'rendering', node: kinds[String(d.node)] || '', value: 0, max: 0 });
                break;
            case 'progress': setProgress({ stage: 'rendering', value: Number(d.value) || 0, max: Number(d.max) || 0, node: d.node !== undefined && kinds[String(d.node)] ? kinds[String(d.node)] : progress.node }); break;
            case 'execution_error': setProgress({ error: String(d.exception_message || 'ComfyUI reported an error') }); break;
            default: break;
        }
    };
    return { ready, close() { try { ws.close(); } catch (e) { /* closed already */ } } };
}

/** The picture: the workflow filled and spliced, posted through the server; { file, dataUrl }. */
async function renderPicture(c, caption) {
    if (!c.workflow) throw new Error('no workflow is chosen (Settings → Scene pictures)');
    const text = await loadWorkflow(c.workflow);
    if (!text) throw new Error(`the workflow "${c.workflow}" is empty or missing from SillyTavern's store`);
    if (isEditorWorkflow(text)) throw new Error(`the workflow "${c.workflow}" is the editor's save format; DES needs the API graph (Workflow → Export (API))`);
    if (!workflowPlaceholders(text).includes('prompt')) throw new Error(`the workflow "${c.workflow}" has no %prompt%: the caption would go nowhere`);
    const filled = fillWorkflow(text, workflowValues(c, { caption }));
    if (filled.missing.length) throw new Error(`the workflow needs ${filled.missing.map(m => `%${m}%`).join(', ')} and nothing fills ${filled.missing.length === 1 ? 'it' : 'them'}`);
    let graph;
    try { graph = JSON.parse(filled.text); } catch (e) { throw new Error(`the workflow "${c.workflow}" is not valid JSON once filled: ${e && e.message ? e.message : e}`); }
    const spliced = injectLoras(graph, state.loras);
    if (state.loras.length && !spliced.inserted) log('no model loader found in the workflow: the LoRAs were not applied');
    log('generate', { workflow: c.workflow, loras: spliced.inserted, placeholders: workflowPlaceholders(text).length });
    const clientId = newClientId();
    const watcher = watchComfy(c.comfyUrl, clientId, nodeKinds(spliced.graph));
    await watcher.ready;    // open before the prompt is queued, so no event is missed; a second and a half at most
    setProgress({ stage: 'queued', queue: 0 });
    let result;
    try {
        result = await comfy('generate', comfyGenerateBody(c.comfyUrl, spliced.graph, clientId), { timeoutMs: c.timeoutSec * 1000 });
    } finally {
        watcher.close();
    }
    setProgress({ stage: 'saving' });
    const dataUrl = readComfyResult(result);
    if (!dataUrl) throw new Error('ComfyUI returned no image');
    return { file: c.workflow, dataUrl };
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
    if (!c.enabled) return { ok: false, reason: 'disabled' };
    if (!loadedMeta) return { ok: false, reason: 'no-chat' };
    if (running) return { ok: false, reason: 'running' };
    running = true;
    const token = loadToken;
    const stale = () => token !== loadToken || chat_metadata !== loadedMeta || (chatId() !== undefined && chatId() !== loadedChat);
    progress = { ...IDLE_PROGRESS, stage: 'waiting', startedAt: Date.now() };
    announce();
    try {
        if (!(await whenIdle())) { commit(afterFailure(state, { at: Date.now(), error: 'the chat stayed busy' })); setProgress({ stage: 'failed', error: 'the chat stayed busy' }); return { ok: false, reason: 'busy' }; }
        if (stale()) { setProgress({ stage: 'idle' }); return { ok: false, reason: 'stale' }; }
        log(`run (${reason})`);
        setProgress({ stage: 'caption' });
        const caption = await writeCaption(c);
        if (stale()) { setProgress({ stage: 'idle' }); return { ok: false, reason: 'stale' }; }
        if (caption === BACKGROUND_BUSY) { commit({ ...state, retryNext: true }); setProgress({ stage: 'idle' }); log('waits: another background request holds the flag'); return { ok: false, reason: 'busy' }; }
        if (!caption) throw new Error('the caption request gave nothing usable');
        log('caption', caption);
        const picture = await renderPicture(c, caption);
        if (stale()) { setProgress({ stage: 'idle' }); return { ok: false, reason: 'stale' }; }
        const posted = await postPicture(c, { caption, file: picture.file, dataUrl: picture.dataUrl, loras: state.loras });
        commit(afterPicture(state, { at: Date.now(), caption, file: picture.file, url: posted.url }));
        setProgress({ stage: 'done', value: progress.max || 1, max: progress.max || 1 });
        notice('A picture of the scene is in the chat.', 'success');
        return { ok: true, url: posted.url, caption };
    } catch (e) {
        const error = e && e.message ? e.message : String(e);
        log(`failed: ${error}`);
        if (!stale()) commit(afterFailure(state, { at: Date.now(), error }));
        setProgress({ stage: 'failed', error });
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
                const why = { off: 'Doom\'s Enhancement Suite is off.', disabled: 'Scene pictures are off (Settings → Scene pictures).', 'no-chat': 'No chat is open.', running: 'A picture is already being made.', busy: 'The chat is busy; it tries again after the next reply.', stale: 'The chat changed meanwhile.' };
                return why[r.reason] || `No picture: ${r.error || r.reason}`;
            },
            helpString: 'Scene pictures: makes one picture of the recent scene now, with the Moss workflow on ComfyUI, and posts it as the narrator.',
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

/** Tests: the caption and SillyTavern's ComfyUI endpoints behind functions, and the waits made short. */
export function __setSceneTransport(fn) { transport = fn || null; }
export function __setSceneTiming(t) { timing = { ...timing, ...(t || {}) }; }
