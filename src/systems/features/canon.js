/**
 * Canon (docs/hooks-canon-plan.md D105–D112): the ledger of what the story
 * has established, kept per chat in chat_metadata.dooms_canon. Every N
 * counted replies a background request on the tracker's profile reads the
 * recent scenes and adds to the ledger or drops what they contradict;
 * one compact block rides every generation (raw setExtensionPrompt, like
 * Live World's line: never in the Context Inspector, never in the chat).
 * A deleted reply takes its lines back unless they are yours. The pure
 * parts are src/utils/canon.js; the page is the shelf's Canon page.
 */
import { getContext } from '../../../../../../extensions.js';
import { chat, chat_metadata, saveChatDebounced, saveChatConditional, setExtensionPrompt, extension_prompt_types, extension_prompt_roles } from '../../../../../../../script.js';
import * as ST from '../../../../../../../script.js';    // is_send_press read by name: a build without it reads undefined, not a link error
import { SlashCommandParser } from '../../../../../../../scripts/slash-commands/SlashCommandParser.js';
import { SlashCommand } from '../../../../../../../scripts/slash-commands/SlashCommand.js';
import { extensionSettings, lastGeneratedData, committedTrackerData, addDebugLog } from '../../core/state.js';
import { withBackgroundProfile, BACKGROUND_BUSY, generateWithExternalAPI, DOOMS_TRACKER_UPDATE_COMPLETE, parseCharacterEntriesFromThoughts } from '../generation/apiClient.js';
import { safeGenerateRaw } from '../../utils/responseExtractor.js';
import { sceneFactsFrom } from '../../utils/questCut.js';
import { buildRecentText } from '../../utils/liveWorld.js';
import { sceneTranscript, RECAP_BUDGET } from '../../utils/hub.js';
import {
    CANON_SLOT, canonConfig, emptyCanon, normalizeCanon, countCanonReply, canonDue, buildCanonPrompt, parseCanonReply,
    validateCanon, applyCanon, failCanon, addCanonEntry, editCanonEntry, pinCanonEntry, removeCanonEntry, reconcileCanon,
    buildCanonBlock, canonToLorebookEntries, canonToMarkdown,
} from '../../utils/canon.js';
import { resolvePersonaName } from './diceRolls.js';

export const CANON_CHANGED_EVENT = 'dooms:canon-changed';
const META_KEY = 'dooms_canon';
const STAMP = 'dooms_canon_id';
const RUN_DELAY_MS = 1500;
const BUSY_RETRY_MS = 4000;

let state = null;
let loadedMeta = null;
let loadedChat = undefined;
let loadToken = 0;
let updating = false;
let timer = null;
let transport = null;      // test hook: ({ system, user }) => Promise<string>
let lorebookSink = null;   // test hook, or the lazy lorebookAPI

function cfg() {
    return canonConfig(extensionSettings);
}

export function isCanonOn() {
    return !!extensionSettings.enabled && cfg().enabled;
}

function log(message, data = null) {
    try { addDebugLog(`[Canon] ${message}`, data); } catch (e) { /* no log */ }
    if (cfg().debug) { try { console.debug(`[Canon] ${message}`, data ?? ''); } catch (e) { /* no console */ } }
}

function notify(detail = {}) {
    try { window.dispatchEvent(new CustomEvent(CANON_CHANGED_EVENT, { detail })); } catch (e) { /* no window (tests) */ }
}

function chatArray() {
    if (Array.isArray(chat)) return chat;
    try { const c = getContext().chat; return Array.isArray(c) ? c : null; } catch (e) { return null; }
}

function chatId() {
    try { return getContext().chatId; } catch (e) { return undefined; }
}

function ready() {
    if (!isCanonOn() || !state) return false;
    if (chat_metadata !== loadedMeta) return false;
    const id = chatId();
    return id === undefined || id === loadedChat;
}

const isToolRecord = (m) => !!(m && m.extra && Array.isArray(m.extra.tool_invocations));
const isReply = (m) => !!(m && !m.is_user && !m.is_system && !isToolRecord(m));

/** A reply's stamp, given the first time (a swipe keeps it). Live World's stamp is shared when the reply has one, so the two rewinds agree. */
function stamp(m) {
    if (!m || typeof m !== 'object') return '';
    if (typeof m[STAMP] === 'string' && m[STAMP]) return m[STAMP];
    m[STAMP] = typeof m.dooms_world_id === 'string' && m.dooms_world_id ? m.dooms_world_id : `k${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    return m[STAMP];
}

function presentIds() {
    const list = chatArray();
    if (!list) return [];
    const ids = [];
    for (const m of list) { const id = m && typeof m[STAMP] === 'string' ? m[STAMP] : ''; if (id) ids.push(id); }
    return ids;
}

function commit(next, detail, { immediate = false } = {}) {
    state = next;
    if (chat_metadata && typeof chat_metadata === 'object') chat_metadata[META_KEY] = JSON.parse(JSON.stringify(state));
    try {
        if (immediate) Promise.resolve(saveChatConditional()).catch(e => log('chat save failed', String(e && e.message || e)));
        else saveChatDebounced();
    } catch (e) { /* no chat open */ }
    notify(detail);
}

function clearSlot() {
    try { setExtensionPrompt(CANON_SLOT, '', extension_prompt_types.IN_CHAT, cfg().depth, false, extension_prompt_roles.SYSTEM); } catch (e) { /* no ST */ }
}

function reconcile(detail) {
    if (!ready()) return false;
    const r = reconcileCanon(state, presentIds());
    if (r.state === state) return false;
    log(`the chat no longer holds ${r.dropped} line(s) and ${r.pruned} counted repl${r.pruned === 1 ? 'y' : 'ies'}; the ledger follows it`);
    commit(r.state, { source: 'rewind', ...detail }, { immediate: true });
    return true;
}

// ─── The chat ───────────────────────────────────────────────────────────

/** CHAT_CHANGED: this chat's ledger, or none while Canon is off. */
export function onCanonChatChanged() {
    loadToken++;
    state = null;
    loadedMeta = null;
    loadedChat = undefined;
    if (timer) { clearTimeout(timer); timer = null; }
    if (!isCanonOn()) { clearSlot(); notify({ source: 'chat' }); return; }
    const id = chatId();
    if (!id) { clearSlot(); notify({ source: 'chat' }); return; }
    const meta = chat_metadata;
    const raw = meta && typeof meta === 'object' ? meta[META_KEY] : null;
    loadedMeta = meta;
    loadedChat = id;
    state = raw && typeof raw === 'object' ? normalizeCanon(raw) : emptyCanon();
    reconcile({ at: 'load' });
    notify({ source: 'chat' });
}

/** MESSAGE_RECEIVED: a fresh reply counts once; every N, a run. */
export function onCanonMessageReceived(messageId, type) {
    const list = chatArray();
    const m = list && list.length ? list[list.length - 1] : null;
    if (!isReply(m)) return;
    if (!ready()) return;
    if (type === 'first_message' || list.length <= 1) return;
    const r = countCanonReply(state, stamp(m));
    if (!r.counted) return;
    commit(r.state, { source: 'count' });
    if (canonDue(state, cfg().every)) scheduleRun('count');
}

/** MESSAGE_DELETED: a reply gone takes its lines and its count. */
export function onCanonMessageDeleted() {
    if (!ready()) return;
    reconcile({ at: 'delete' });
}

/** GENERATION_STARTED: the block rides the generation (not a quiet one), raw, at the configured depth. */
export function onCanonGenerationStarted(type, data, dryRun) {
    if (dryRun) return;
    const c = cfg();
    const quiet = type === 'quiet' || type === 'impersonate' || !!(data && (data.quiet_prompt || data.quietImage || data.quiet_image));
    const text = ready() && c.inject && !quiet ? buildCanonBlock(state, { maxChars: c.maxChars }) : '';
    const role = c.role === 'user' ? extension_prompt_roles.USER : c.role === 'assistant' ? extension_prompt_roles.ASSISTANT : extension_prompt_roles.SYSTEM;
    try {
        setExtensionPrompt(CANON_SLOT, text ? `\n${text}\n` : '', extension_prompt_types.IN_CHAT, c.depth, false, role);
    } catch (e) {
        log('injection failed', String(e && e.message || e));
    }
}

/** The tracker's separate request done: a run that waited for a free line goes now. */
export function onCanonTrackerUpdateComplete() {
    if (!ready()) return;
    if (canonDue(state, cfg().every) && !timer && !updating) scheduleRun('tracker');
}

function scheduleRun(reason, delay = RUN_DELAY_MS) {
    if (timer) clearTimeout(timer);
    const token = loadToken;
    timer = setTimeout(() => {
        timer = null;
        if (token !== loadToken) return;
        updateCanon({ reason }).catch(err => log('run threw', String(err && err.message || err)));
    }, delay);
}

function mainGenerationBusy() {
    return ST.is_send_press === true;
}

function knownNames() {
    const names = [];
    try {
        for (const c of parseCharacterEntriesFromThoughts(lastGeneratedData.characterThoughts || committedTrackerData.characterThoughts) || []) if (c && c.name) names.push(c.name);
    } catch (e) { /* none */ }
    return names;
}

function playerNames() {
    const names = [];
    const add = (v) => { const t = String(v || '').trim(); if (t && !names.some(n => n.toLowerCase() === t.toLowerCase())) names.push(t); };
    try { add(resolvePersonaName()); } catch (e) { /* none */ }
    try { add(getContext().name1); } catch (e) { /* none */ }
    return names;
}

export function __setCanonTransport(fn) {
    transport = typeof fn === 'function' ? fn : null;
}

/**
 * A run now (D107, D108): the request, the reply read and checked, the
 * ledger written or the failure noted. Nothing is written when the reply
 * breaks a rule (the next reply runs it again), when another background
 * request holds the line (a retry a little later), or when the chat
 * changed meanwhile.
 * @returns {Promise<{ ok: boolean, reason?: string, added?: number, dropped?: number, errors?: string[], error?: string }>}
 */
/** A run over a whole scene (docs/hub-plan.md D122): the scene's messages in place of the recent window, the caps doubled for the one run. */
const SCENE_ADDS = 16;
const SCENE_DROPS = 8;

export async function updateCanon({ reason = 'manual', scope = 'recent' } = {}) {
    if (!ready()) return { ok: false, reason: 'off' };
    if (updating) return { ok: false, reason: 'running' };
    if (reason !== 'manual' && scope !== 'scene' && mainGenerationBusy()) { scheduleRun(reason, BUSY_RETRY_MS); return { ok: false, reason: 'busy' }; }
    if (scope === 'scene' && mainGenerationBusy()) return { ok: false, reason: 'busy' };
    updating = true;
    notify({ source: 'run-start' });
    const token = loadToken;
    const stale = () => token !== loadToken || chat_metadata !== loadedMeta || (chatId() !== undefined && chatId() !== loadedChat);
    try {
        const c = cfg();
        const players = playerNames();
        const now = sceneFactsFrom(lastGeneratedData.infoBox || committedTrackerData.infoBox);
        const scene = scope === 'scene';
        const recent = scene
            ? sceneTranscript(chatArray() || [], { budget: RECAP_BUDGET, persona: players[0] || 'Player' })
            : buildRecentText(chatArray() || [], { count: c.recentMessages, persona: players[0] || 'Player' });
        const caps = scene ? { adds: SCENE_ADDS, drops: SCENE_DROPS } : {};
        const prompt = buildCanonPrompt({ entries: state.entries, recent, now, player: players, names: knownNames(), ...caps });
        const external = extensionSettings.generationMode === 'external';
        const messages = [{ role: 'system', content: prompt.system }, { role: 'user', content: prompt.user }];
        const run = async () => {
            if (transport) return transport(prompt);
            if (external) return generateWithExternalAPI(messages);
            return safeGenerateRaw({ prompt: messages, quietToLoud: false });
        };
        log(`run (${reason}) requested`, { entries: state.entries.length, sinceLast: state.sinceLast });
        const result = await withBackgroundProfile(run, { external, label: 'canon' });
        if (stale()) return { ok: false, reason: 'stale' };
        if (result === BACKGROUND_BUSY) {
            if (reason !== 'manual' && !scene) scheduleRun(reason, BUSY_RETRY_MS);    // a run over a whole scene is End's to retry, never parked
            return { ok: false, reason: 'busy' };
        }
        const text = typeof result === 'string' ? result : (result && typeof result === 'object' && typeof result.text === 'string' ? result.text : String(result ?? ''));
        const v = validateCanon(parseCanonReply(text), state, caps);
        const list = chatArray();
        const last = list && list.length ? list[list.length - 1] : null;
        const msgId = isReply(last) ? stamp(last) : null;
        if (!v.ok) {
            commit(failCanon(state, { error: v.errors.join(' '), kind: 'invalid', ranAt: Date.now() }), { source: 'run-failed' }, { immediate: true });
            log('run discarded', { errors: v.errors, reply: text.slice(0, 400) });
            return { ok: false, reason: 'invalid', errors: v.errors };
        }
        const next = applyCanon(state, v.clean, { msgId, gameDate: now.date || '', ranAt: Date.now() });
        commit(next, { source: 'run' }, { immediate: true });
        log('run applied', { added: next.last.added, dropped: next.last.dropped, dropsRefused: v.errors });
        return { ok: true, added: next.last.added, dropped: next.last.dropped, errors: v.errors };
    } catch (e) {
        const error = String(e && e.message || e);
        if (stale()) return { ok: false, reason: 'stale', error };
        if (state) commit(failCanon(state, { error, kind: 'error', ranAt: Date.now() }), { source: 'run-failed' }, { immediate: true });
        log('run failed', error);
        return { ok: false, reason: 'error', error };
    } finally {
        updating = false;
        notify({ source: 'run-end' });
    }
}

export function isUpdating() {
    return updating;
}

// ─── Reading and editing ────────────────────────────────────────────────

/** A copy of this chat's ledger, or null. */
export function getCanon() {
    return state ? JSON.parse(JSON.stringify(state)) : null;
}

/** The block as it would ride now. */
export function buildCanonBlockNow() {
    return ready() ? buildCanonBlock(state, { maxChars: cfg().maxChars }) : '';
}

export function addCanonLine({ kind, name, text } = {}) {
    if (!ready()) return null;
    const r = addCanonEntry(state, { kind, name, text }, { at: Date.now() });
    if (!r.entry) return null;
    commit(r.state, { source: 'edit' }, { immediate: true });
    return r.entry;
}

export function editCanonLine(id, patch = {}) {
    if (!ready()) return null;
    const r = editCanonEntry(state, id, patch, { at: Date.now() });
    if (!r.entry) return null;
    commit(r.state, { source: 'edit' }, { immediate: true });
    return r.entry;
}

export function pinCanonLine(id, pinned = true) {
    if (!ready()) return false;
    const next = pinCanonEntry(state, id, pinned);
    if (next === state) return false;
    commit(next, { source: 'edit' }, { immediate: true });
    return true;
}

export function removeCanonLine(id) {
    if (!ready()) return false;
    const next = removeCanonEntry(state, id);
    if (next === state) return false;
    commit(next, { source: 'edit' }, { immediate: true });
    return true;
}

/** The ledger emptied (asked first by the page). */
export function clearCanon() {
    if (!ready()) return false;
    commit(emptyCanon(), { source: 'clear' }, { immediate: true });
    return true;
}

// ─── The exports ────────────────────────────────────────────────────────

export function __setCanonLorebook(sink) {
    lorebookSink = sink && typeof sink === 'object' ? sink : null;
}

async function lorebook() {
    if (lorebookSink) return lorebookSink;
    const api = await import('../lorebook/lorebookAPI.js');
    return {
        names: () => api.getAllWorldNames(),
        createWorld: (name) => api.createNewWorld(name),
        load: (name) => api.loadWorldData(name, true),
        createEntry: (name, data) => api.createEntry(name, data),
        deleteEntry: (data, uid) => api.deleteEntry(data, uid),
        save: (name, data) => api.saveWorldData(name, data),
    };
}

/** The lorebook a chat's canon goes to: "Canon of <the chat's character>" (a file name: no colon). */
export function canonBookName() {
    let who = '';
    try { who = String(getContext().name2 || '').trim(); } catch (e) { who = ''; }
    return `Canon of ${who || 'the chat'}`.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
}

/**
 * The ledger written to a lorebook (D111): one entry per line, keyed by its
 * name, titled "Canon · kind: name"; an entry the book already holds under
 * that title is rewritten, so exporting again keeps one of each. The book
 * is made when it is not there.
 * @returns {Promise<{ ok: boolean, book?: string, written?: number, error?: string }>}
 */
export async function exportCanonToLorebook({ name = '', mirror = false, ledger = null } = {}) {
    const source = ledger && typeof ledger === 'object' ? normalizeCanon(ledger) : (ready() ? state : null);
    if (!source) return { ok: false, error: 'Canon is off, or no chat is open.' };
    const book = String(name || '').trim() || canonBookName();
    const lines = canonToLorebookEntries(source);
    if (!lines.length && !mirror) return { ok: false, error: 'The ledger is empty.' };
    try {
        const lb = await lorebook();
        const names = lb.names() || [];
        if (!names.includes(book)) await lb.createWorld(book);
        const data = await lb.load(book);
        if (!data || typeof data !== 'object') return { ok: false, error: `The lorebook "${book}" could not be read.` };
        if (!data.entries || typeof data.entries !== 'object') data.entries = {};
        const byComment = new Map(Object.values(data.entries).filter(e => e && typeof e === 'object').map(e => [String(e.comment || ''), e]));
        let written = 0;
        for (const line of lines) {
            let entry = byComment.get(line.comment);
            if (!entry) { entry = lb.createEntry(book, data); if (!entry) continue; }
            entry.comment = line.comment;
            entry.key = line.key.slice();
            entry.content = line.content;
            if (entry.disable === undefined) entry.disable = false;
            written++;
        }
        // A mirror (docs/hub-plan.md D126): the book holds the ledger and nothing the ledger dropped; only the entries Canon titled are touched.
        let removed = 0;
        if (mirror) {
            const keep = new Set(lines.map(l => l.comment));
            for (const [comment, entry] of byComment) {
                if (!comment.startsWith('Canon · ') || keep.has(comment)) continue;
                if (typeof lb.deleteEntry === 'function' && entry.uid !== undefined) { await lb.deleteEntry(data, entry.uid); removed++; }
                else if (data.entries && entry.uid !== undefined) { delete data.entries[entry.uid]; removed++; }
            }
        }
        await lb.save(book, data);
        log(`exported ${written} line(s) to the lorebook "${book}"${removed ? `, ${removed} gone` : ''}`);
        return { ok: true, book, written, removed };
    } catch (e) {
        const error = String(e && e.message || e);
        log('export failed', error);
        return { ok: false, error };
    }
}

/** The ledger as Markdown (a file the page downloads). */
export function canonMarkdownNow() {
    if (!ready()) return '';
    let who = '';
    try { who = String(getContext().name2 || '').trim(); } catch (e) { who = ''; }
    return canonToMarkdown(state, { title: `Canon of ${who || 'the chat'}` });
}

// ─── Init ───────────────────────────────────────────────────────────────

/** Registers /canon: a run now. The events are wired by index.js. */
export function initCanon() {
    try {
        SlashCommandParser.addCommandObject(SlashCommand.fromProps({
            name: 'canon',
            callback: async () => {
                const r = await updateCanon({ reason: 'manual' });
                const { describeCanonResult } = await import('../../utils/canon.js');
                return describeCanonResult(r);
            },
            helpString: 'Canon: reads the recent scenes now and brings the ledger up to date (Settings → Canon).',
        }));
    } catch (e) {
        log('the /canon command could not be registered', String(e && e.message || e));
    }
}

// The tracker's completion: a run that waited while the tracker's own request had the line.
try {
    const { eventSource } = await import('../../../../../../../script.js');
    eventSource.on(DOOMS_TRACKER_UPDATE_COMPLETE, onCanonTrackerUpdateComplete);
} catch (e) { /* no event source (tests) */ }
