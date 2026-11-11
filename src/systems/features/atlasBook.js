/**
 * The Atlas's book (docs/long-shot-plan.md D151): what the player did to
 * this chat's map. Where each marker was put, what was deleted, what was
 * merged into what, the markers made by hand, the names, kinds and notes
 * changed, the scale. Kept in chat_metadata.dooms_atlas, saved with the
 * chat; the pure edits are in src/utils/atlas.js (normalizeBook, placeAt,
 * removeMarker, mergeInto…). The clean-up pass (D155) is asked for here:
 * one background request on the tracker's profile; nothing is changed by
 * it, the player approves each proposal. Loaded with the Atlas, on first
 * open.
 */
import { chat_metadata, saveChatDebounced } from '../../../../../../../script.js';
import * as ST from '../../../../../../../script.js';    // is_send_press read by name: a build without it reads undefined, not a link error
import { extensionSettings, addDebugLog } from '../../core/state.js';
import { withBackgroundProfile, BACKGROUND_BUSY, generateWithExternalAPI, backgroundHolder } from '../generation/apiClient.js';
import { safeGenerateRaw } from '../../utils/responseExtractor.js';
import { normalizeBook, buildTidyPrompt, parseTidy } from '../../utils/atlas.js';
import { stripSceneNoise } from '../../utils/liveWorld.js';
import { chatLines, chunkLines, recentLines, buildScanPrompt, parseScan, mergeScans, buildSetupPrompt, parseSetup, SETUP_LIMITS, buildFillPrompt, parseFill } from '../../utils/atlasSetup.js';
import { buildNamesPrompt, parseNames } from '../../utils/atlasWorld.js';
import { chatArray, cardOfTheChat, loreOfTheChat, playerNames } from './liveWorld.js';
import { carrySceneBook } from './hub.js';

const META_KEY = 'dooms_atlas';
export const ATLAS_BOOK_CHANGED_EVENT = 'dooms:atlas-book-changed';

/** This chat's book, made safe; an empty one when the chat has none. */
export function getBook() {
    const raw = chat_metadata && typeof chat_metadata === 'object' ? chat_metadata[META_KEY] : null;
    return normalizeBook(raw);
}

/** The book replaced and saved with the chat; false when no chat's metadata is there to keep it. */
export function setBook(book) {
    if (!chat_metadata || typeof chat_metadata !== 'object') return false;
    chat_metadata[META_KEY] = normalizeBook(book);
    try { saveChatDebounced(); } catch (e) { /* no chat open */ }
    try { carrySceneBook(chat_metadata[META_KEY]); } catch (e) { /* not a scene, or the hub is away: the chat keeps it */ }    // in a scene being played, the world has it at once (D173)
    try { window.dispatchEvent(new CustomEvent(ATLAS_BOOK_CHANGED_EVENT)); } catch (e) { /* no window (tests) */ }
    return true;
}

// ─── Waiting for the line ───────────────────────────────────────────────────

// A background request runs on the tracker's connection profile: started while the player's own message is being
// answered, it would switch the profile under that reply. So every request here waits until no reply is being
// written and no other background request holds the line (as the Hub's and Live World's do), and gives up after a while.
let idleTiming = { stepMs: 250, maxMs: 120000 };
const WAITING = 'A reply is still being written. Try again when it is done.';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/** Test hook: how often the line is looked at and how long it is waited for. */
export function __setAtlasIdleTiming(t) { idleTiming = { ...idleTiming, ...(t || {}) }; }

/** True once nothing is being generated; false when the wait ran out. */
async function whenIdle() {
    const started = Date.now();
    for (;;) {
        if (ST.is_send_press !== true && !backgroundHolder()) return true;
        if (Date.now() - started >= idleTiming.maxMs) return false;
        await sleep(idleTiming.stepMs);
    }
}

// ─── The clean-up pass (D155) ───────────────────────────────────────────────

let tidying = false;
let tidyTransport = null;    // test hook: ({ system, user }) => Promise<string>

/** Test hook: the request's transport, or null for the real one. */
export function __setTidyTransport(fn) {
    tidyTransport = typeof fn === 'function' ? fn : null;
}

export function isTidying() {
    return tidying;
}

/**
 * Asks the AI to look over the map's places (the markers and the tray)
 * and propose merges and deletions. Nothing is stored and nothing is
 * changed: the proposals go to the player.
 * @returns {Promise<{ ok: boolean, reason: string, items: Array, error: string }>}
 */
export async function proposeTidy(model, { world = '' } = {}) {
    if (tidying) return { ok: false, reason: 'running', items: [], error: 'A clean-up is already being asked for.' };
    const prompt = buildTidyPrompt({ model, world });
    if (prompt.count < 2) return { ok: true, reason: 'few', items: [], error: '' };
    tidying = true;
    try {
        const external = extensionSettings.generationMode === 'external';
        const messages = [{ role: 'system', content: prompt.system }, { role: 'user', content: prompt.user }];
        const run = async () => {
            if (tidyTransport) return tidyTransport(prompt);
            if (external) return generateWithExternalAPI(messages);
            return safeGenerateRaw({ prompt: messages, quietToLoud: false });
        };
        if (!(await whenIdle())) return { ok: false, reason: 'busy', items: [], error: WAITING };
        const result = await withBackgroundProfile(run, { external, label: 'atlas-tidy' });
        if (result === BACKGROUND_BUSY) return { ok: false, reason: 'busy', items: [], error: 'Another request is running; try again in a moment.' };
        const text = typeof result === 'string' ? result : (result && typeof result === 'object' && typeof result.text === 'string' ? result.text : String(result ?? ''));
        const r = parseTidy(text, model);
        try { addDebugLog(`[Atlas] clean-up: ${r.ok ? `${r.items.length} proposal(s)` : r.error}`, r.ok ? null : { reply: text.slice(0, 400) }); } catch (e) { /* no log */ }
        return { ok: r.ok, reason: r.ok ? '' : 'invalid', items: r.items, error: r.error };
    } catch (e) {
        return { ok: false, reason: 'error', items: [], error: String(e && e.message || e) };
    } finally {
        tidying = false;
    }
}

// ─── Setting up a world's map (D143, D159) ──────────────────────────────────

let settingUp = false;
let setupStop = false;
let setupTransport = null;    // test hook: ({ system, user, kind: 'scan' | 'draft' }) => Promise<string>

/** Test hook: the requests' transport, or null for the real one. */
export function __setSetupTransport(fn) {
    setupTransport = typeof fn === 'function' ? fn : null;
}

export function isSettingUp() {
    return settingUp;
}

/** Stops a set-up that is reading the chat: the part in hand finishes, no more are asked for, and nothing is drafted. */
export function stopSetup() {
    if (settingUp) setupStop = true;
}

/** What the whole chat would cost to read: its messages, and the parts it would be read in (one request each, and one more for the draft). */
export function setupReach() {
    const lines = chatLines(chatArray(), { strip: stripSceneNoise });
    const { chunks, skipped } = chunkLines(lines);
    return { messages: lines.length, parts: chunks.length, skipped, max: SETUP_LIMITS.chunks };
}

async function ask(prompt, kind, label) {
    const external = extensionSettings.generationMode === 'external';
    const messages = [{ role: 'system', content: prompt.system }, { role: 'user', content: prompt.user }];
    const run = async () => {
        if (setupTransport) return setupTransport({ ...prompt, kind });
        if (external) return generateWithExternalAPI(messages);
        return safeGenerateRaw({ prompt: messages, quietToLoud: false });
    };
    if (!(await whenIdle())) throw new Error(WAITING);    // before every part of a long set-up: a message sent meanwhile is answered first
    const result = await withBackgroundProfile(run, { external, label });
    if (result === BACKGROUND_BUSY) throw new Error('Another request is running; try again in a moment.');
    return typeof result === 'string' ? result : (result && typeof result === 'object' && typeof result.text === 'string' ? result.text : String(result ?? ''));
}

/**
 * Drafts the world's places for the map (D143): with `reach` 'full' the
 * whole chat is read first, part by part (one request each, `onProgress`
 * told after each), for the places it names; then one request drafts the
 * places around the player's notes from the card, the lore, the recent
 * scenes, what the scans found and the places the map already knows.
 * Nothing is stored and nothing is changed: the draft goes to the player.
 * @param {object} o
 * @param {string} o.notes
 * @param {'recent'|'full'} o.reach
 * @param {object} o.model        the Atlas's model (the known places)
 * @param {string} o.world        the world's name
 * @param {Function} o.onProgress ({ done, total, word }) => void
 * @returns {Promise<{ ok: boolean, reason: string, draft: object|null, error: string, parts: number, skipped: number }>}
 */
export async function draftSetup({ notes = '', reach = 'recent', model = null, world = '', onProgress = () => {} } = {}) {
    if (settingUp) return { ok: false, reason: 'running', draft: null, error: 'A set-up is already running.', parts: 0, skipped: 0 };
    settingUp = true;
    setupStop = false;
    let parts = 0;
    let skipped = 0;
    try {
        const players = playerNames();
        const lines = chatLines(chatArray(), { strip: stripSceneNoise, persona: players[0] || 'Player' });
        let found = [];
        if (reach === 'full') {
            const cut = chunkLines(lines);
            skipped = cut.skipped;
            const scans = [];
            for (let i = 0; i < cut.chunks.length; i++) {
                if (setupStop) return { ok: false, reason: 'stopped', draft: null, error: 'Stopped: nothing was changed.', parts, skipped };
                try { onProgress({ done: i, total: cut.chunks.length + 1, word: `Reading the chat: part ${i + 1} of ${cut.chunks.length}` }); } catch (e) { /* the window is gone */ }
                // A part that fails is left out: the rest of the chat is still worth reading.
                try { scans.push(parseScan(await ask(buildScanPrompt(cut.chunks[i], { part: i + 1, parts: cut.chunks.length }), 'scan', 'atlas-scan'))); parts++; } catch (e) { try { addDebugLog(`[Atlas] set-up: part ${i + 1} could not be read`, String(e && e.message || e)); } catch (x) { /* no log */ } }
            }
            found = mergeScans(scans);
            if (setupStop) return { ok: false, reason: 'stopped', draft: null, error: 'Stopped: nothing was changed.', parts, skipped };
            try { onProgress({ done: cut.chunks.length, total: cut.chunks.length + 1, word: 'Drafting the places' }); } catch (e) { /* gone */ }
        } else {
            try { onProgress({ done: 0, total: 1, word: 'Drafting the places' }); } catch (e) { /* gone */ }
        }
        const prompt = buildSetupPrompt({ notes, world, card: cardOfTheChat(), lore: await loreOfTheChat(), recent: recentLines(lines), found, model, players });
        const text = await ask(prompt, 'draft', 'atlas-setup');
        const r = parseSetup(text, model);
        try { addDebugLog(`[Atlas] set-up: ${r.ok ? `${r.draft.places.length} place(s) drafted` : r.error}`, r.ok ? null : { reply: text.slice(0, 400) }); } catch (e) { /* no log */ }
        return { ok: r.ok, reason: r.ok ? '' : 'invalid', draft: r.draft, error: r.error, parts, skipped };
    } catch (e) {
        return { ok: false, reason: 'error', draft: null, error: String(e && e.message || e), parts, skipped };
    } finally {
        settingUp = false;
        setupStop = false;
    }
}

/**
 * Asks the AI to fill out one map (D160): places that plausibly belong on
 * it, around the ones already there. Nothing is stored and nothing is
 * changed: the suggestions go to the player.
 * `what`: places for the map, or regions around it (D166). With regions asked for on a map of places, `home` is the name for the region those places go inside.
 * @returns {Promise<{ ok: boolean, reason: string, places: Array, what: string, home: string, error: string }>}
 */
export async function draftFill({ model = null, world = '', wish = '', count = 8, what = '' } = {}) {
    if (settingUp) return { ok: false, reason: 'running', places: [], error: 'A request is already running.' };
    settingUp = true;
    try {
        const prompt = buildFillPrompt({ model, world, wish, count, what, lore: await loreOfTheChat(), card: cardOfTheChat() });
        const text = await ask(prompt, 'fill', 'atlas-fill');
        const r = parseFill(text, model, { what });
        try { addDebugLog(`[Atlas] fill: ${r.ok ? `${r.places.length} place(s) suggested` : r.error}`, r.ok ? null : { reply: text.slice(0, 400) }); } catch (e) { /* no log */ }
        return { ok: r.ok, reason: r.ok ? '' : 'invalid', places: r.places, what: r.what, home: r.home, error: r.error };
    } catch (e) {
        return { ok: false, reason: 'error', places: [], what: '', home: '', error: String(e && e.message || e) };
    } finally {
        settingUp = false;
    }
}

/**
 * Asks the AI to name the lands a world gen added (D186): the regions on
 * the top map that still carry a plain stand-in name, each told by where
 * it lies, its ground and what it borders. Nothing is stored and nothing
 * is changed: the names go to the player.
 * @returns {Promise<{ ok: boolean, reason: string, names: Array<{ id: string, was: string, name: string, note: string }>, error: string }>}
 */
export async function draftNames({ model = null, world = '', wish = '' } = {}) {
    if (settingUp) return { ok: false, reason: 'running', names: [], error: 'A request is already running.' };
    settingUp = true;
    try {
        const prompt = buildNamesPrompt({ model, world, wish, lore: await loreOfTheChat(), card: cardOfTheChat() });
        if (!prompt.count) return { ok: false, reason: 'none', names: [], error: 'Every land on this map has a name of its own already.' };
        const text = await ask(prompt, 'names', 'atlas-names');
        const r = parseNames(text, model, prompt.lands);
        try { addDebugLog(`[Atlas] names: ${r.ok ? `${r.names.length} of ${prompt.count} land(s) named` : r.error}`, r.ok ? null : { reply: text.slice(0, 400) }); } catch (e) { /* no log */ }
        return { ok: r.ok, reason: r.ok ? '' : 'invalid', names: r.names, error: r.error };
    } catch (e) {
        return { ok: false, reason: 'error', names: [], error: String(e && e.message || e) };
    } finally {
        settingUp = false;
    }
}
