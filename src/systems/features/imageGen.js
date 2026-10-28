/**
 * Image Generation — the one service every picture DES makes goes through
 * (docs/image-gen-plan.md). The source is chosen on Settings → Image
 * Generation:
 *
 *   - 'sillytavern': SillyTavern's own Image Generation extension, through
 *     its /sd command (quiet: no message in the chat). Whatever engine,
 *     size and sampler the extension is set to. The extension saves the
 *     file; the answer is its URL.
 *   - 'comfy': a ComfyUI card reached through SillyTavern's server
 *     (/api/sd/comfy/*), with a workflow from SillyTavern's store: DES
 *     fills the placeholders (src/utils/comfy.js), splices this chat's
 *     LoRAs, follows the render over ComfyUI's WebSocket, and hands back
 *     the picture as a data URL for the caller to save where it belongs.
 *
 * renderImage(req, { onProgress }) is the call; testSource() is the page's
 * Test button; listWorkflows / loadWorkflow / saveWorkflow are the store.
 */
import { getRequestHeaders } from '../../../../../../../script.js';
import { getContext } from '../../../../../../extensions.js';
import { SlashCommandParser } from '../../../../../../../scripts/slash-commands/SlashCommandParser.js';
import { executeSlashCommandsOnChatInput } from '../../../../../../../scripts/slash-commands.js';
import { extensionSettings } from '../../core/state.js';
import { imageGenConfig, renderValues, describeSource, slashSafe } from '../../utils/imageGen.js';
import { workflowPlaceholders, isEditorWorkflow, fillWorkflow, injectLoras, comfyGenerateBody, readComfyResult, comfyWsUrl, newClientId, nodeKinds } from '../../utils/comfy.js';

let transport = null;    // tests: { comfy(kind, body) → json, sd(prompt, negative) → url }

/** Tests: the transports behind functions. */
export function __setImageTransport(t) { transport = t || null; }

/** settings.imageGen with defaults filled in. */
export function imageCfg() { return imageGenConfig(extensionSettings); }

const log = (message, data = null) => {
    const line = `[Dooms Tracker] Image Generation: ${message}`;
    if (data !== null) console.log(line, data); else console.log(line);
};

/** Is SillyTavern's Image Generation extension (the /sd command) loaded? */
export function isSdAvailable() {
    try { return !!SlashCommandParser.commands['sd']; } catch (e) { return false; }
}

/** The engine SillyTavern's Image Generation is set to, as its settings name it ('' when unknown). */
export function sdSourceName() {
    try {
        const sd = getContext().extensionSettings?.sd;
        return sd && typeof sd.source === 'string' ? sd.source : '';
    } catch (e) { return ''; }
}

/** The status line for Settings → Image Generation. */
export function sourceStatus() {
    return describeSource(imageCfg(), { stAvailable: isSdAvailable(), stSourceName: sdSourceName() });
}

// ─── ComfyUI, through SillyTavern's server ───────────────────────────────

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
    if (isEditorWorkflow(text)) throw new Error('this is the ComfyUI editor\'s save format (nodes and links); DES needs the API graph: in ComfyUI, Workflow → Export (API)');
    await comfy('save-workflow', { file_name: name, workflow: text });
    return name;
}

/**
 * Settings → Test: for ComfyUI, the card answers at the address, the store's
 * workflows, and the chosen workflow read with its placeholders checked
 * against what DES fills; for SillyTavern's extension, whether /sd exists
 * and what it is set to. Throws only when the server cannot be reached.
 * @returns {Promise<{ ok: boolean, line: string, workflows: string[], ping: string }>}
 */
export async function testSource() {
    const g = imageCfg();
    if (g.source !== 'comfy') {
        return { ok: isSdAvailable(), line: sourceStatus(), workflows: [], ping: isSdAvailable() ? 'ok' : 'down' };
    }
    const c = g.comfy;
    // The ping goes through SillyTavern's server to ComfyUI's /system_stats; a
    // card mid-render answers it slowly, so a slow ping is noted, not fatal.
    let ping = 'ok';
    let pingError = '';
    try { await comfy('ping', { url: c.url }, { timeoutMs: 60000 }); }
    catch (e) { pingError = e && e.message ? e.message : String(e); ping = /within \d+ s/.test(pingError) ? 'slow' : 'down'; }
    let workflows = [];
    try { workflows = await listWorkflows(); } catch (e) { /* the store is SillyTavern's; a miss here is its answer */ }
    let line = ping === 'ok' ? `ComfyUI answers at ${c.url}.`
        : ping === 'slow' ? `ComfyUI at ${c.url} did not answer within 60 s: a card mid-render answers slowly, and the picture itself waits up to ${c.timeoutSec} s.`
            : pingError;
    let ok = ping === 'ok';
    if (!c.workflow) { line += ' Pick a workflow.'; ok = false; }
    else {
        try {
            const text = await loadWorkflow(c.workflow);
            const found = workflowPlaceholders(text);
            const { missing } = fillWorkflow(text, renderValues({ prompt: 'test', negative: 'test', size: 'square', comfy: c, seed: 1 }));
            if (isEditorWorkflow(text)) { line += ` The workflow "${c.workflow}" is the ComfyUI editor's save format (nodes and links). DES needs the API graph: in ComfyUI, Workflow → Export (API), and paste that.`; ok = false; }
            else if (!found.includes('prompt')) { line += ` The workflow "${c.workflow}" has no %prompt%${found.length ? ` (it has ${found.map(f => `%${f}%`).join(', ')})` : ''}: the picture's prompt would go nowhere.`; ok = false; }
            else if (missing.length) { line += ` The workflow needs ${missing.map(m => `%${m}%`).join(', ')} and nothing fills ${missing.length === 1 ? 'it' : 'them'}: set the models above, or take the placeholder out of the workflow.`; ok = false; }
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
function watchComfy(comfyUrl, clientId, kinds, onProgress, stageOf) {
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
                if (stageOf() === 'queued' && Number.isFinite(q)) onProgress({ queue: Math.max(0, q - 1) });
                break;
            }
            case 'execution_start': onProgress({ stage: 'rendering', value: 0, max: 0, node: '' }); break;
            case 'executing':
                if (d.node === null || d.node === undefined) { if (stageOf() === 'rendering') onProgress({ stage: 'saving' }); }
                else onProgress({ stage: 'rendering', node: kinds[String(d.node)] || '', value: 0, max: 0 });
                break;
            case 'progress': onProgress({ stage: 'rendering', value: Number(d.value) || 0, max: Number(d.max) || 0, node: d.node !== undefined && kinds[String(d.node)] ? kinds[String(d.node)] : undefined }); break;
            case 'execution_error': onProgress({ error: String(d.exception_message || 'ComfyUI reported an error') }); break;
            default: break;
        }
    };
    return { ready, close() { try { ws.close(); } catch (e) { /* closed already */ } } };
}

async function renderOnComfy(c, { prompt, negative, size, loras, seed }, onProgress, stageOf) {
    if (!c.workflow) throw new Error('no workflow is chosen (Settings → Image Generation)');
    const text = await loadWorkflow(c.workflow);
    if (!text) throw new Error(`the workflow "${c.workflow}" is empty or missing from SillyTavern's store`);
    if (isEditorWorkflow(text)) throw new Error(`the workflow "${c.workflow}" is the editor's save format; DES needs the API graph (Workflow → Export (API))`);
    if (!workflowPlaceholders(text).includes('prompt')) throw new Error(`the workflow "${c.workflow}" has no %prompt%: the prompt would go nowhere`);
    const filled = fillWorkflow(text, renderValues({ prompt, negative, size, comfy: c, seed }));
    if (filled.missing.length) throw new Error(`the workflow needs ${filled.missing.map(m => `%${m}%`).join(', ')} and nothing fills ${filled.missing.length === 1 ? 'it' : 'them'} (Settings → Image Generation)`);
    let graph;
    try { graph = JSON.parse(filled.text); } catch (e) { throw new Error(`the workflow "${c.workflow}" is not valid JSON once filled: ${e && e.message ? e.message : e}`); }
    const spliced = injectLoras(graph, loras);
    if (Array.isArray(loras) && loras.length && !spliced.inserted) log('no model loader found in the workflow: the LoRAs were not applied');
    log('generate', { workflow: c.workflow, loras: spliced.inserted });
    const clientId = newClientId();
    const watcher = watchComfy(c.url, clientId, nodeKinds(spliced.graph), onProgress, stageOf);
    await watcher.ready;    // open before the prompt is queued, so no event is missed; a second and a half at most
    onProgress({ stage: 'queued', queue: 0 });
    let result;
    try {
        result = await comfy('generate', comfyGenerateBody(c.url, spliced.graph, clientId), { timeoutMs: c.timeoutSec * 1000 });
    } finally {
        watcher.close();
    }
    onProgress({ stage: 'saving' });
    const dataUrl = readComfyResult(result);
    if (!dataUrl) throw new Error('ComfyUI returned no image');
    return { file: c.workflow, dataUrl };
}

// ─── SillyTavern's Image Generation ─────────────────────────────────────

/** The URL out of the /sd command's answer, '' when there is none. */
function urlOf(result) {
    if (!result) return '';
    if (typeof result === 'string') return /^(https?:|data:|\/)/.test(result) ? result : '';
    if (typeof result === 'object') {
        const u = result.pipe || result.output || result.image || result.url || result.result;
        return typeof u === 'string' && /^(https?:|data:|\/)/.test(u) ? u : '';
    }
    return '';
}

async function renderOnSillyTavern({ prompt, negative }, onProgress) {
    if (transport && transport.sd) return { file: 'sillytavern', url: await transport.sd(prompt, negative) };
    if (!isSdAvailable()) throw new Error("SillyTavern's Image Generation is not enabled: Extensions → Image Generation, switch it on and pick a source, or choose ComfyUI (direct) on Settings → Image Generation");
    onProgress({ stage: 'rendering', value: 0, max: 0, node: '' });
    const neg = slashSafe(negative);
    const command = `/sd quiet=true ${neg ? `negative="${neg.replace(/"/g, "'")}" ` : ''}${slashSafe(prompt)}`;
    const result = await executeSlashCommandsOnChatInput(command, { clearChatInput: false });
    const url = urlOf(result);
    if (!url) throw new Error("SillyTavern's Image Generation returned no picture (its own settings decide the engine; check Extensions → Image Generation)");
    return { file: 'sillytavern', url };
}

// ─── The call ───────────────────────────────────────────────────────────

/**
 * One picture through the chosen source.
 * @param {{ purpose?: string, prompt: string, negative?: string, size?: string, loras?: Array, seed?: number }} req
 * @param {{ onProgress?: (patch: object) => void, stageOf?: () => string }} [hooks] - the caller's progress bar, if any
 * @returns {Promise<{ file: string, url?: string, dataUrl?: string, source: string }>}
 *   url: the source saved the file (SillyTavern's extension); dataUrl: the caller saves it (ComfyUI).
 */
export async function renderImage(req, { onProgress = () => {}, stageOf = () => '' } = {}) {
    const g = imageCfg();
    const r = { purpose: 'scene', negative: '', size: 'square', loras: [], seed: -1, ...(req || {}) };
    if (!r.prompt || !String(r.prompt).trim()) throw new Error('nothing to draw: the prompt is empty');
    const out = g.source === 'comfy'
        ? await renderOnComfy(g.comfy, r, onProgress, stageOf)
        : await renderOnSillyTavern(r, onProgress);
    return { ...out, source: g.source };
}
