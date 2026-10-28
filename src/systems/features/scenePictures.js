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
 *     the picture through the image service (Settings → Image Generation:
 *     SillyTavern's own extension or ComfyUI direct), saved into SillyTavern, posted the way
 *     SillyTavern's own image extension posts, always hidden from the
 *     prompt (D71: neither the picture nor its caption reaches the AI);
 *   - /scene runs one now; the settings page reads getSceneStatus().
 */
import { chat, chat_metadata, saveChatConditional, eventSource, event_types, addOneMessage, default_avatar, deleteLastMessage } from '../../../../../../../script.js';
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
import { getCharacterAppearance } from './avatarGenerator.js';
import {
    SCENE_META_KEY, scenePicturesConfig, freshSceneState, sceneStateOf, countTurn, pictureDue, afterPicture, afterFailure,
    normalizeLoras, buildCaptionPrompt, parseCaptionReply, captionLine, mergeIdentityNotes,
} from '../../utils/scenePictures.js';
import { renderImage, __setImageTransport } from './imageGen.js';
// The store and the Test button, for the settings page, from the service that owns them now.
export { listWorkflows, loadWorkflow, saveWorkflow, testSource as testComfy } from './imageGen.js';

// ─── State ──────────────────────────────────────────────────────────────────

export const SCENE_CHANGED_EVENT = 'dooms:scene-pictures-changed';

let state = freshSceneState();
let loadToken = 0;          // bumped by every chat load; a run that outlives its chat is discarded
let loadedMeta = null;      // the chat_metadata object the state was loaded from
let loadedChat = undefined; // the chat id it was loaded with
let running = false;
let armed = false;          // a run is due and waits for the generation to end
let transport = null;       // tests: { caption(prompt) → text }; a comfy(kind, body) given here is handed to the image service
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
    hidePicturesFromThePrompt();
    announce();
}

/**
 * D71: a picture's message is always hidden from the prompt (is_system),
 * so SillyTavern's "Send inline media" never inlines the pixels; chats
 * from before carried them as narrator messages when the old "Captions
 * reach the AI" switch was on, every picture then riding every request,
 * and a provider's size limit ended the chat. Flipped once on load, saved
 * with the chat. Nothing of a picture reaches the AI: not the pixels, not
 * the caption (the owner: no reason to send either).
 */
function hidePicturesFromThePrompt() {
    const list = chatArray() || chat;
    if (!Array.isArray(list)) return 0;
    let flipped = 0;
    for (const m of list) {
        if (m && m.extra && m.extra.dooms_scene && !m.is_user && m.is_system !== true) { m.is_system = true; flipped++; }
    }
    if (flipped) {
        log(`${flipped} picture message${flipped === 1 ? '' : 's'} hidden from the prompt`);
        try { Promise.resolve(saveChatConditional()).catch(() => {}); } catch (e) { /* the next save carries it */ }
    }
    return flipped;
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

/**
 * D72: SillyTavern's Regenerate replaces the chat's LAST message (unless it
 * is the player's), and it decides which message that is after this event.
 * A scene picture after the reply was the one replaced: the picture went,
 * the old reply stayed, the new one landed under it. So a regenerate takes
 * DES's own trailing pictures down first, and SillyTavern's deletion then
 * hits the reply. Only the pictures: anything else after the reply is the
 * player's or SillyTavern's and stays. SillyTavern awaits this event, so
 * every MESSAGE_DELETED is heard before it goes on.
 * @returns {Promise<number>} pictures taken down
 */
export async function onSceneGenerationStarted(type, params, dryRun) {
    if (type !== 'regenerate' || dryRun) return 0;
    const { taken, done } = takeDownTrailingPictures();
    await done;
    if (taken) notice(`The scene picture${taken === 1 ? '' : 's'} after the reply came down so the reply could be regenerated.`);
    return taken;
}

/** A message DES's scene pictures posted: the one thing DES takes down on its own. */
function isPictureMessage(m) {
    return !!(m && !m.is_user && m.extra && m.extra.dooms_scene && typeof m.extra.dooms_scene === 'object');
}

/**
 * Takes DES's scene pictures off the end of the chat. The chat and the
 * screen change synchronously (SillyTavern's deleteLastMessage pops the
 * message and its element before it awaits MESSAGE_DELETED), so a caller
 * that cannot wait still sees them gone; `done` settles when every
 * MESSAGE_DELETED has been heard.
 * @returns {{ taken: number, done: Promise<unknown> }}
 */
function takeDownTrailingPictures() {
    const list = chatArray() || chat;
    const waits = [];
    let taken = 0;
    try {
        while (Array.isArray(list) && list.length && isPictureMessage(list[list.length - 1])) {
            const before = list.length;
            waits.push(Promise.resolve(deleteLastMessage()).catch(() => {}));
            if (list.length >= before) break;    // nothing moved: do not spin
            taken++;
        }
    } catch (e) { log(`a trailing picture could not be taken down: ${e && e.message ? e.message : e}`); }
    if (taken) {
        log(`${taken} trailing picture${taken === 1 ? '' : 's'} taken down for a regenerate`);
        try { Promise.resolve(saveChatConditional()).catch(() => {}); } catch (e) { /* the next save carries it */ }
    }
    return { taken, done: Promise.all(waits) };
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

function presentEntries() {
    try {
        const entries = parseCharacterEntriesFromThoughts(committedTrackerData.characterThoughts || lastGeneratedData.characterThoughts);
        return (Array.isArray(entries) ? entries : []).filter(e => e && typeof e.name === 'string' && e.name.trim());
    } catch (e) { return []; }
}

function presentNames() {
    return presentEntries().map(e => e.name.trim());
}

const LOOK_MAX = 500;

/**
 * How each character in the scene looks, for the caption (the image model
 * knows no names): the persona first, then every character on the shelf.
 * For each, the Workshop's Appearance line (the portrait prompt, the
 * owner's own words) wins; else the tracker's appearance for them this
 * scene; else, for the chat's character, the card's description, and for
 * the persona, SillyTavern's persona description or the Workshop's user
 * card. [{ name, look }], looks empty where nothing is known.
 */
function looksOfTheScene() {
    const looks = [];
    let ctx = null;
    try { ctx = getContext(); } catch (e) { ctx = null; }
    const persona = resolvePersonaName();
    if (persona) {
        let look = getCharacterAppearance(persona);
        if (!look) {
            const card = extensionSettings.userCharacters && extensionSettings.userCharacters[persona];
            if (card && typeof card.appearance === 'string' && card.appearance.trim()) look = card.appearance.trim();
            else if (card && card.injection && typeof card.injection.description === 'string' && card.injection.description.trim()) look = card.injection.description.trim();
        }
        if (!look && ctx) {
            try {
                const pu = ctx.powerUserSettings;
                const d = pu && pu.persona_descriptions && ctx.userAvatar ? pu.persona_descriptions[ctx.userAvatar] : null;
                if (d && typeof d.description === 'string') look = d.description.trim();
            } catch (e) { /* no persona description */ }
        }
        looks.push({ name: persona, look: look || '' });
    }
    const mainChar = ctx && Array.isArray(ctx.characters) && ctx.characterId !== undefined ? ctx.characters[ctx.characterId] : null;
    for (const e of presentEntries()) {
        const name = e.name.trim();
        if (persona && name.toLowerCase() === persona.toLowerCase()) continue;
        let look = getCharacterAppearance(name);
        if (!look) {
            const fromTracker = e.details && typeof e.details.appearance === 'string' ? e.details.appearance : (typeof e.appearance === 'string' ? e.appearance : '');
            if (fromTracker && fromTracker.trim()) look = fromTracker.trim();
        }
        if (!look && mainChar && typeof mainChar.name === 'string' && mainChar.name.trim().toLowerCase() === name.toLowerCase() && typeof mainChar.description === 'string') look = mainChar.description.trim();
        looks.push({ name, look: look || '' });
    }
    return looks.map(l => ({ name: l.name, look: l.look.length > LOOK_MAX ? `${l.look.slice(0, LOOK_MAX - 1).trimEnd()}…` : l.look }));
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
    const identity = mergeIdentityNotes(state.identity, looksOfTheScene());
    const prompt = buildCaptionPrompt({ recent, present: presentNames(), identity, guide: c.guide, size: c.size });
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
 * The picture through the image service (Settings → Image Generation): the
 * preamble and the caption as the prompt, the scene's negative and size,
 * this chat's LoRAs. The service's progress lands in this run's bar.
 * @returns {Promise<{ file: string, dataUrl?: string, url?: string }>}
 */
async function renderPicture(c, caption) {
    return renderImage(
        { purpose: 'scene', prompt: `${c.preamble || ''}${caption}`.trim(), negative: c.negative || '', size: c.size, loras: state.loras },
        { onProgress: (patch) => setProgress(patch), stageOf: () => progress.stage },
    );
}

/** The picture saved into SillyTavern's own images and posted as the narrator's message (D60). */
async function postPicture(c, { caption, file, dataUrl, url: givenUrl, loras }) {
    let url = givenUrl || '';
    if (!url) {
        const comma = dataUrl.indexOf(',');
        const base64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
        const format = /^data:image\/(\w+)/.exec(dataUrl)?.[1] || 'png';
        let folder = 'scenes';
        try { folder = getContext().name2 || folder; } catch (e) { /* no context, the default folder */ }
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        url = await saveBase64AsFile(base64, folder, `des-scene-${stamp}`, format);
    }
    const message = {
        name: c.narrator,
        is_user: false,
        is_system: true,    // D71: never in the prompt; the AI gets neither the picture nor the caption
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
        const posted = await postPicture(c, { caption, file: picture.file, dataUrl: picture.dataUrl, url: picture.url, loras: state.loras });
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
    // D72, group chats: SillyTavern's group Regenerate stops at a system
    // message, so a trailing picture would stay and the new reply land under
    // it, and GENERATION_STARTED comes too late there (per member, as a
    // normal generation). The Regenerate menu entry's click is caught first
    // instead, in the capture phase. (The keyboard shortcut's synthetic
    // click runs SillyTavern's handler before ours and is not covered.)
    try {
        document.addEventListener('click', (e) => {
            const t = e.target;
            if (!t || typeof t.closest !== 'function' || !t.closest('#option_regenerate')) return;
            let inGroup = false;
            try { inGroup = !!getContext().groupId; } catch (err) { inGroup = false; }
            if (!inGroup || ST.is_send_press) return;
            const { taken } = takeDownTrailingPictures();
            if (taken) notice(`The scene picture${taken === 1 ? '' : 's'} after the reply came down so the reply could be regenerated.`);
        }, true);
    } catch (e) { /* no document (tests) */ }
}

/** Tests: the caption and SillyTavern's ComfyUI endpoints behind functions, and the waits made short. */
export function __setSceneTransport(t) {
    transport = t && t.caption ? { caption: t.caption } : null;
    __setImageTransport(t && (t.comfy || t.sd) ? { comfy: t.comfy, sd: t.sd } : null);
}
export function __setSceneTiming(t) { timing = { ...timing, ...(t || {}) }; }
