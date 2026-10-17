/**
 * Inventory in play (Project Short Fuse, Phase 5).
 *
 * The model lives in src/utils/inventory.js (pure). This module is the part
 * that touches the chat and the settings:
 *
 *   - the per-chat store (chat_metadata.dooms_inventory) and its load;
 *   - the end-of-reply tag: read when a reply renders, applied once per
 *     swipe, put back when the swipe, the text or the chat's shape changes,
 *     and shown as a line in the reply;
 *   - the dooms_inventory tool: applied as the model calls it, kept on the
 *     player's message until the reply it belongs to renders, then owned by
 *     that reply's swipe exactly like a tag;
 *   - the two prompt slots: what is carried, and how to record a change;
 *   - hand edits for the shelf's Inventory page.
 *
 * What a reply changed is kept on the message itself (message.dooms_inventory),
 * not under message.extra: SillyTavern swaps a reply's extra with each swipe,
 * and the record has to outlive the swipe it was made on so the next one can
 * put its changes back.
 *
 * It imports no UI module. The shelf listens for INVENTORY_CHANGED_EVENT.
 */
import { getContext } from '../../../../../../extensions.js';
import { chat, chat_metadata, saveChatDebounced } from '../../../../../../../script.js';
import { extensionSettings } from '../../core/state.js';
import { escapeHtml } from '../../utils/html.js';
import { resolvePersonaName, findLastUserMessage } from './diceRolls.js';
import {
    MAX_SLOTS,
    INVENTORY_TOOL_NAME,
    inventoryConfig,
    itemKey,
    emptyState,
    normalizeState,
    applyChanges,
    revertApplied,
    setStack,
    moveStack,
    parseItemTags,
    changesFromToolArgs,
    buildInventoryToolDefinition,
    buildInventoryLine,
    buildItemTagInstruction,
    buildItemToolInstruction,
    describeApplied,
} from '../../utils/inventory.js';

export const INVENTORY_CHANGED_EVENT = 'dooms:inventory-changed';
export const INVENTORY_LINE_SLOT = 'dooms-inventory-line';
export const INVENTORY_RULES_SLOT = 'dooms-inventory-rules';

/** Said after every tool answer, for the reason the dice verdict says it: a model that reads an aside last tends to drop the block it was asked for. */
export const STILL_REQUIRED_ITEMS = 'Nothing else about your reply changes: the tracker data block and everything else you are required to output still follow as usual.';

const META_KEY = 'dooms_inventory';      // chat_metadata: the state
const MESSAGE_KEY = 'dooms_inventory';   // a message: what its reply or tool call changed
/** On load nothing is dropped for being past the slot count; the shelf shows the overflow and no new kind fits until it clears. */
const LOAD_CFG = Object.freeze({ packSlots: MAX_SLOTS, pouchSlots: MAX_SLOTS });
const NOT_LOADED = Symbol('not loaded');

let state = emptyState();
let loadedFor = NOT_LOADED;
/** Messages whose changes are in the state, so a deletion can put them back. */
let ledger = new Set();

// ─── Helpers ────────────────────────────────────────────────────────────────

function chatArray() {
    if (Array.isArray(chat)) return chat;
    try {
        const c = getContext().chat;
        return Array.isArray(c) ? c : null;
    } catch (e) {
        return null;
    }
}

function chatId() {
    try { return getContext().chatId; } catch (e) { return undefined; }
}

function persona() {
    return resolvePersonaName() || 'the player';
}

function cfgNow() {
    return inventoryConfig(extensionSettings);
}

function toolCallingLive() {
    try {
        const ctx = getContext();
        return typeof ctx.isToolCallingSupported === 'function' && ctx.isToolCallingSupported() === true;
    } catch (e) {
        return false;
    }
}

function copyOf(s) {
    return { v: 1, pack: (s?.pack || []).map(i => ({ ...i })), pouch: (s?.pouch || []).map(i => ({ ...i })) };
}

/** The master switch and DES's own. */
export function isInventoryOn() {
    return !!extensionSettings.enabled && cfgNow().enabled;
}

/** Tells the shelf's Inventory page (and anything else listening) to repaint. */
export function notifyInventoryChanged(detail = {}) {
    try {
        window.dispatchEvent(new CustomEvent(INVENTORY_CHANGED_EVENT, { detail }));
    } catch (e) { /* no window (tests) */ }
}

/**
 * An inventory event the player can see: always a console line, and a toast
 * while Settings → Stats → Inventory → Notify is on (toasts also land in
 * DES's Notification Log).
 */
export function inventoryNotice(text, { kind = 'info', title = 'Inventory' } = {}) {
    try { console.debug(`[Dooms Tracker] Inventory: ${text}`); } catch (e) { /* no console */ }
    if (!cfgNow().notify) return;
    try {
        const t = typeof window !== 'undefined' ? window.toastr : null;
        if (t && typeof t[kind] === 'function') t[kind](text, title, { timeOut: 6000, escapeHtml: true });
    } catch (e) { /* no toastr */ }
}

// ─── The store ──────────────────────────────────────────────────────────────

function load() {
    const raw = chat_metadata && typeof chat_metadata === 'object' ? chat_metadata[META_KEY] : null;
    state = normalizeState(raw, LOAD_CFG);
    loadedFor = chatId();
    ledger = new Set();
    for (const m of chatArray() || []) {
        const rec = m && m[MESSAGE_KEY];
        if (!rec || typeof rec !== 'object') continue;
        const liveReply = Number.isInteger(rec.live) && rec.swipes && rec.swipes[rec.live];
        const unclaimedTool = Array.isArray(rec.tool) && rec.tool.some(e => e && e.attached == null);
        if (liveReply || unclaimedTool) ledger.add(m);
    }
}

/** The state belongs to a chat; a read after a chat switch this module has not heard of loads first. */
function ensureLoaded() {
    if (loadedFor === NOT_LOADED || loadedFor !== chatId()) load();
}

function commit(next, detail) {
    state = next;
    if (chat_metadata && typeof chat_metadata === 'object') chat_metadata[META_KEY] = copyOf(state);
    try { saveChatDebounced(); } catch (e) { /* no chat open */ }
    notifyInventoryChanged(detail);
}

function saveRecords() {
    try { saveChatDebounced(); } catch (e) { /* no chat open */ }
}

/** CHAT_CHANGED: this chat's inventory. */
export function onInventoryChatChanged() {
    load();
    notifyInventoryChanged({ source: 'chat' });
}

/** A copy of the state: both containers, every stack. */
export function getInventoryState() {
    ensureLoaded();
    return copyOf(state);
}

/** The rules block as the shelf should read it. */
export function getInventoryConfig() {
    return cfgNow();
}

// ─── What a reply changed ───────────────────────────────────────────────────
//
// A reply's record: { live: swipeId | null, swipes: { [swipeId]: entry } }
// with entry = { sig, tag: changes[], tool: changes[], applied, rejected }.
// `live` names the swipe whose changes are in the state. Rendering another
// swipe puts them back and applies that swipe's own (again, from its recorded
// changes, against whatever the state is now). `sig` is the tag's signature,
// so an edit that changes the tag is seen as a new reply.

function replyRecord(m) {
    let rec = m[MESSAGE_KEY];
    if (!rec || typeof rec !== 'object' || Array.isArray(rec)) rec = m[MESSAGE_KEY] = {};
    if (!rec.swipes || typeof rec.swipes !== 'object') rec.swipes = {};
    if (!Number.isInteger(rec.live)) rec.live = null;
    return rec;
}

function signatureOf(changes) {
    return changes.length ? JSON.stringify(changes.map(c => [c.container, c.action, itemKey(c.name), c.count, c.note])) : '';
}

function undoLine(applied) {
    const parts = (applied || []).map(a => `${a.action === 'add' ? '−' : '+'}${a.count} ${a.name}`);
    return parts.length ? parts.join(' · ') : 'nothing';
}

/**
 * Tool outcomes made since the player's last message that no reply has
 * claimed yet, claimed for the reply at `index`. Only a reply after that
 * message can claim them: an old reply re-rendering never does.
 */
function claimToolOutcomes(index) {
    const found = findLastUserMessage();
    if (!found || index <= found.index) return [];
    const rec = found.message[MESSAGE_KEY];
    if (!rec || !Array.isArray(rec.tool)) return [];
    const out = [];
    for (const e of rec.tool) {
        if (e && e.attached == null) { e.attached = index; out.push(e); }
    }
    if (out.length && !rec.tool.some(e => e && e.attached == null)) ledger.delete(found.message);
    return out;
}

/**
 * CHARACTER_MESSAGE_RENDERED, MESSAGE_SWIPED, MESSAGE_UPDATED: reads the
 * reply for an "[ITEM: ...]" tag and applies it once for its swipe. The
 * swipe shown before gives its changes back first; a swipe seen before gets
 * its own applied again. Tool outcomes of this turn join the reply here. The
 * tag in the shown text becomes a line saying what changed.
 */
export function onInventoryReplyRendered(messageId) {
    const list = chatArray();
    const i = parseInt(messageId, 10);
    const m = list && Number.isFinite(i) ? list[i] : null;
    if (!m || m.is_user || m.is_system) return;
    if (Array.isArray(m.extra?.tool_invocations)) return;
    const cfg = cfgNow();
    if (!extensionSettings.enabled || !cfg.enabled || !cfg.aiChanges.enabled) return;
    if (!cfg.aiChanges.endOfReply && !cfg.aiChanges.tool) return;
    ensureLoaded();
    const swipeId = m.swipe_id || 0;
    const text = typeof m.mes === 'string' ? m.mes : '';
    const tagChanges = cfg.aiChanges.endOfReply ? parseItemTags(text) : [];
    const sig = signatureOf(tagChanges);
    const rec = replyRecord(m);
    const claimed = claimToolOutcomes(i);
    let next = state;
    let changed = false;
    let touched = claimed.length > 0;

    // 1. The shown reply is no longer the one that made the live changes
    //    (another swipe, or an edit that changed its tag): put them back.
    const liveEntry = rec.live !== null ? rec.swipes[rec.live] : null;
    if (liveEntry && (rec.live !== swipeId || liveEntry.sig !== sig)) {
        if (liveEntry.applied.length) {
            next = revertApplied(next, liveEntry.applied);
            changed = true;
            inventoryNotice(`${rec.live !== swipeId ? 'Swipe' : 'Edit'}: put back ${undoLine(liveEntry.applied)}`);
        }
        if (rec.live === swipeId) delete rec.swipes[swipeId];
        rec.live = null;
        touched = true;
    }

    // 2. This swipe's own changes.
    let entry = rec.live === swipeId ? rec.swipes[swipeId] : null;
    if (entry) {
        // Live and unchanged. A tool outcome claimed now joins it (already in the state).
        for (const e of claimed) {
            entry.tool.push(...e.changes);
            entry.applied.push(...e.applied);
            entry.rejected.push(...e.rejected);
        }
    } else {
        const prior = rec.swipes[swipeId] || null;
        if (sig || claimed.length || (prior && (prior.tool.length || prior.tag.length))) {
            entry = { sig, tag: tagChanges, tool: [], applied: [], rejected: [] };
            // A swipe seen before has its changes applied again, in the order
            // they first happened: the tool's during generation, then the tag's.
            if (prior && prior.tool.length) {
                const r = applyChanges(next, prior.tool, cfg);
                next = r.state;
                entry.tool.push(...prior.tool);
                entry.applied.push(...r.applied);
                entry.rejected.push(...r.rejected);
                if (r.applied.length) changed = true;
            }
            for (const e of claimed) {
                entry.tool.push(...e.changes);
                entry.applied.push(...e.applied);
                entry.rejected.push(...e.rejected);
            }
            if (tagChanges.length) {
                const r = applyChanges(next, tagChanges, cfg);
                next = r.state;
                entry.applied.push(...r.applied);
                entry.rejected.push(...r.rejected);
                if (r.applied.length) changed = true;
                if (r.applied.length || r.rejected.length) {
                    inventoryNotice(`${prior ? 'Swipe back' : 'Reply'}: ${describeApplied(r.applied, r.rejected, { userName: persona() })}`, { kind: r.rejected.length ? 'warning' : 'success' });
                }
            } else if (prior && prior.tool.length) {
                inventoryNotice(`Swipe back: ${describeApplied(entry.applied, entry.rejected, { userName: persona() })}`);
            }
            rec.swipes[swipeId] = entry;
            rec.live = swipeId;
            touched = true;
        }
    }

    if (Number.isInteger(rec.live)) ledger.add(m);
    else ledger.delete(m);
    if (changed) commit(next, { source: 'reply', index: i });
    else if (touched) saveRecords();
    decorateItemTag(i, entry);
}

/**
 * MESSAGE_DELETED: a message whose changes are in the state and that is no
 * longer in the chat gives them back. SillyTavern does not say which message
 * went, so this looks for the ones it remembers.
 */
export function onInventoryMessageDeleted() {
    if (!ledger.size) return;
    const list = chatArray();
    if (!list) return;
    ensureLoaded();
    let next = state;
    let changed = false;
    for (const m of [...ledger]) {
        if (list.includes(m)) continue;
        ledger.delete(m);
        const rec = m[MESSAGE_KEY];
        if (!rec || typeof rec !== 'object') continue;
        const applied = [];
        if (Number.isInteger(rec.live) && rec.swipes && rec.swipes[rec.live]) applied.push(...rec.swipes[rec.live].applied);
        if (Array.isArray(rec.tool)) {
            for (const e of rec.tool) if (e && e.attached == null) applied.push(...e.applied);
        }
        if (!applied.length) continue;
        next = revertApplied(next, applied);
        changed = true;
        inventoryNotice(`Deleted message: put back ${undoLine(applied)}`);
    }
    if (changed) commit(next, { source: 'delete' });
}

function itemLineHtml(entry) {
    return `<span class="dooms-item-line"><span class="dooms-item-line-icon" aria-hidden="true">🎒</span> ${escapeHtml(describeApplied(entry.applied, entry.rejected, { userName: persona() }))}</span>`;
}

/**
 * Replaces the "[ITEM: ...]" text in the shown reply with a line that says
 * what changed (and what would not fit). Works on the text nodes that hold
 * the tag, never by re-serialising the message, so nothing else DES or
 * SillyTavern bound inside the reply is disturbed. A tag that yielded no
 * change simply goes.
 */
function decorateItemTag(index, entry) {
    if (typeof document === 'undefined' || typeof document.querySelector !== 'function' || typeof document.createTreeWalker !== 'function') return;
    const el = document.querySelector(`#chat .mes[mesid="${index}"] .mes_text`);
    // A real element has string text; the test sandbox's stand-ins do not.
    if (!el || typeof el.textContent !== 'string' || !/\[\s*ITEMS?\s*:/i.test(el.textContent)) return;
    const probe = /\[\s*ITEMS?\s*:[^\]]*\]/i;
    const re = /[ \t]*\[\s*ITEMS?\s*:[^\]]*\]/gi;
    const walker = document.createTreeWalker(el, 4 /* NodeFilter.SHOW_TEXT */);
    const hits = [];
    for (let node = walker.nextNode(), guard = 0; node && guard < 5000; node = walker.nextNode(), guard++) {
        if (node.nodeType === 3 && typeof node.nodeValue === 'string' && probe.test(node.nodeValue)) hits.push(node);
    }
    if (!hits.length) return;
    const replacement = entry && (entry.applied.length || entry.rejected.length) ? itemLineHtml(entry) : '';
    hits.forEach((node, n) => {
        const last = n === hits.length - 1;
        const frag = document.createDocumentFragment();
        let cursor = 0;
        const text = node.nodeValue;
        const all = [...text.matchAll(re)];
        all.forEach((m, k) => {
            if (m.index > cursor) frag.appendChild(document.createTextNode(text.slice(cursor, m.index)));
            // Only the last tag of the last node becomes the line; earlier ones vanish.
            if (last && k === all.length - 1 && replacement) {
                const span = document.createElement('span');
                span.innerHTML = replacement;
                frag.appendChild(span.firstElementChild || span);
            }
            cursor = m.index + m[0].length;
        });
        if (cursor < text.length) frag.appendChild(document.createTextNode(text.slice(cursor)));
        node.parentNode?.replaceChild(frag, node);
    });
}

// ─── The tool ───────────────────────────────────────────────────────────────
//
// The player's message carries the turn's tool outcomes:
// { tool: [{ key, changes, applied, rejected, text, attached }] }. Each is
// applied as the model calls it; `attached` is null until the reply the call
// belongs to renders and claims it (onInventoryReplyRendered), after which
// the reply's swipe owns the change. The same call again in the same turn
// is kept, not applied twice; after a swipe it is a new call.

function toolRecord(message, create) {
    let rec = message[MESSAGE_KEY];
    if (!rec || typeof rec !== 'object' || Array.isArray(rec)) {
        if (!create) return null;
        rec = message[MESSAGE_KEY] = {};
    }
    if (!Array.isArray(rec.tool)) {
        if (!create) return null;
        rec.tool = [];
    }
    return rec;
}

function changeKey(changes) {
    return JSON.stringify(changes.map(c => [c.container, c.action, itemKey(c.name), c.count, c.note]));
}

/** The dooms_inventory tool's action: records the changes and answers with what was recorded. */
export function inventoryToolAction(args) {
    const changes = changesFromToolArgs(args);
    if (!changes) return 'Nothing was recorded. Pass changes as a list of { action: "add" | "remove", item, count, container: "pack" | "pouch", note }.';
    ensureLoaded();
    const found = findLastUserMessage();
    const rec = found ? toolRecord(found.message, true) : null;
    const key = changeKey(changes);
    const kept = rec ? rec.tool.find(e => e && e.attached == null && e.key === key) : null;
    if (kept) {
        inventoryNotice('Inventory tool asked again for the same change · kept');
        return `Already recorded: ${kept.text}. ${STILL_REQUIRED_ITEMS}`;
    }
    const r = applyChanges(state, changes, cfgNow());
    const text = describeApplied(r.applied, r.rejected, { userName: persona() });
    if (rec) {
        rec.tool.push({ key, changes, applied: r.applied, rejected: r.rejected, text, attached: null });
        ledger.add(found.message);
    }
    commit(r.state, { source: 'tool' });
    inventoryNotice(`Inventory tool · ${text}`, { kind: r.rejected.length ? 'warning' : 'success' });
    return `Recorded: ${text}. ${STILL_REQUIRED_ITEMS}`;
}

/** TOOL_CALLS_PERFORMED: marks each inventory invocation with its outcome, for anything that shows the record. */
export function onInventoryToolCallsPerformed(invocations) {
    if (!Array.isArray(invocations)) return;
    const found = findLastUserMessage();
    const rec = found ? toolRecord(found.message, false) : null;
    if (!rec) return;
    for (const inv of invocations) {
        if (!inv || inv.name !== INVENTORY_TOOL_NAME) continue;
        let args = inv.parameters;
        if (typeof args === 'string') {
            try { args = JSON.parse(args); } catch (e) { continue; }
        }
        const changes = changesFromToolArgs(args);
        if (!changes) continue;
        const key = changeKey(changes);
        const e = [...rec.tool].reverse().find(x => x && x.key === key);
        if (e) inv.dooms_inventory = e.text;
    }
}

/**
 * Registers (or re-registers, after the persona or the slots change) the
 * inventory tool with SillyTavern. shouldRegister keeps it out of prompts
 * while the inventory or the tool switch is off; SillyTavern itself leaves
 * it out on APIs that cannot call tools.
 */
export function registerInventoryTool() {
    let ctx;
    try { ctx = getContext(); } catch (e) { return false; }
    if (!ctx || typeof ctx.registerFunctionTool !== 'function') return false;
    const def = buildInventoryToolDefinition({ settings: extensionSettings, userName: persona() });
    try {
        ctx.registerFunctionTool({
            ...def,
            action: (args) => inventoryToolAction(args),
            formatMessage: () => '',
            shouldRegister: () => {
                const c = cfgNow();
                return !!extensionSettings.enabled && c.enabled && c.aiChanges.enabled && c.aiChanges.tool;
            },
            stealth: false,
        });
        return true;
    } catch (e) {
        console.warn('[Dooms Tracker] Inventory: the tool could not be registered', e);
        return false;
    }
}

/** Registers the tool once at start. */
export function initInventory() {
    try { registerInventoryTool(); } catch (e) { /* no ToolManager */ }
}

// ─── Prompt ─────────────────────────────────────────────────────────────────

/** The one line the model reads about what is carried, or '' while off or not told. */
export function buildInventoryLineForGeneration() {
    if (!extensionSettings.enabled) return '';
    const cfg = cfgNow();
    if (!cfg.enabled || !cfg.tellTheAI) return '';
    ensureLoaded();
    return buildInventoryLine(state, extensionSettings, { userName: persona() });
}

/**
 * How the game master may record a change this generation: the tool
 * instruction when the tool is on and the API can call tools, else the
 * end-of-reply form, else nothing. '' when AI changes are off.
 */
export function buildInventoryRulesForGeneration() {
    if (!extensionSettings.enabled) return '';
    const cfg = cfgNow();
    if (!cfg.enabled || !cfg.aiChanges.enabled) return '';
    ensureLoaded();
    const userName = persona();
    if (cfg.aiChanges.tool && toolCallingLive()) return buildItemToolInstruction({ settings: extensionSettings, userName, state });
    if (cfg.aiChanges.endOfReply) return buildItemTagInstruction({ settings: extensionSettings, userName, state });
    return '';
}

// ─── Hand edits ─────────────────────────────────────────────────────────────

/** Sets a stack's fields by hand (count 0 removes it; a new name adds). */
export function editStack(container, name, fields) {
    ensureLoaded();
    const r = setStack(state, container, name, fields, cfgNow());
    if (r.ok) commit(r.state, { source: 'edit', container });
    return r;
}

/** Takes a stack out by hand. */
export function removeStack(container, name) {
    return editStack(container, name, { count: 0 });
}

/** Moves some or all of a stack between the pack and the pouch. */
export function moveItem(name, from, to, count) {
    ensureLoaded();
    const r = moveStack(state, name, from, to, count, cfgNow());
    if (r.ok) commit(r.state, { source: 'edit', container: to });
    return r;
}

/** Empties a container by hand. */
export function clearContainer(container) {
    ensureLoaded();
    if (container !== 'pack' && container !== 'pouch') return { ok: false, reason: 'containers' };
    const next = copyOf(state);
    next[container] = [];
    commit(next, { source: 'edit', container });
    return { ok: true };
}
