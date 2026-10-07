/*
 * Doom's Enhancement Suite for SillyTavern — Glint Words
 * Copyright (C) 2026 Jordan (DangerDaza)
 *
 * This file is part of Doom's Enhancement Suite and is licensed under the
 * GNU Affero General Public License v3.0 or later. If you redistribute this
 * file or a modified version of it, you must keep this notice intact, state
 * your changes, and release your version under the same license.
 *
 * See the LICENSE file in the project root for the full terms and for
 * additional copyright notices.
 *
 * https://github.com/DangerDaza/Dooms-Enhancement-Suite
 */

/**
 * Glint Words: words the player lists (Settings → Theme → Glint Words) are
 * wrapped in a styled span wherever they appear in a chat message. When a
 * new message finishes loading (after its chat bubbles are built), each
 * listed word in it plays its entrance (a flash of light, say); from then
 * on it keeps its look and idle effect every time it is on screen.
 *
 * Display only: the saved message, what the AI sees, copy, edit and the
 * voices all use the original text.
 *
 * How it stays on screen: SillyTavern, colored-dialogues, the bubble pass,
 * edits, swipes and "show more" all rewrite a message's .mes_text. Rather
 * than chase each of them, one MutationObserver on #chat marks a message
 * dirty whenever its contents change, and a throttled pass re-wraps any
 * listed word that isn't wrapped yet. The pass ignores the mutations it
 * causes itself.
 *
 * When the entrance plays: CHARACTER_MESSAGE_RENDERED / USER_MESSAGE_RENDERED
 * mark the message as new. Its pass waits until the bubbles have been built
 * (or, with bubbles off, until colored-dialogues has had time to recolour),
 * so the effect isn't wiped half-way by the next rewrite. Each new word then
 * keeps its normal colour until it scrolls into view, and plays its entrance
 * there. A Continue only plays it on words past the ones the message already
 * had. Loading a chat plays nothing.
 */

import { extensionSettings } from '../../core/state.js';
import { ensureCss } from '../../core/cssLoader.js';
import { chat } from '../../../../../../../script.js';
import { isSyntheticTrackerMessage } from '../../utils/messageGuards.js';
import { isAliasDecisionOpen } from '../features/characterAliases.js';
import {
    normalizeGlintSettings,
    buildGlintMatcher,
    splitByGlint,
    glintHash,
} from './glintCatalog.js';

/** Throttle for the re-wrap pass (ms). */
const PASS_DELAY_MS = 160;
/** Budget per pass before yielding to the next frame (ms). */
const PASS_BUDGET_MS = 12;
/** Bubbles off: how long a new message is left to settle (colored-dialogues recolours ~600 ms in). */
const QUIET_AI_MS = 900;
const QUIET_USER_MS = 350;
/**
 * Bubbles normally land ~1 s after a message renders. If they haven't after
 * this long they aren't coming (the message was skipped, say), so the words
 * are wrapped anyway. An open "same character?" question holds the bubbles
 * and is waited out separately, with no limit here.
 */
const SETTLE_DEADLINE_MS = 15000;
/** A word's entrance plays once this much of it is on screen. */
const SIGHT_THRESHOLD = 0.9;
/** How long an entrance runs, and the stagger between words in one message. */
const ENTER_MS = 1100;
const ENTER_STAGGER_MS = 140;
const ENTER_STAGGER_MAX = 8;
/** A generation that never reports its end stops counting as streaming after this. */
const GENERATING_TTL_MS = 180000;

/**
 * Where a listed word is never wrapped: code, links and controls, and the
 * parts of a message DES itself draws (bubble names and avatars, thought
 * headers, scene and Doom Counter widgets). Bubble text, thought text and
 * plain message text are fair game.
 */
const SKIP_SELECTOR = [
    'code', 'pre', 'kbd', 'samp', 'a', 'button', 'select', 'option', 'textarea', 'input',
    'script', 'style', 'svg', 'math', 'summary', '[contenteditable="true"]',
    '.dooms-glint',
    '.dooms-bubble-header', '.dooms-bubble-author', '.dooms-bubble-avatar',
    '.dooms-card-header', '.dooms-card-author', '.dooms-card-avatar', '.dooms-card-role',
    '.dooms-inline-thought-summary', '.dooms-scene-header', '.dooms-info-banner',
    '[class*="dooms-dc-"]', '[class*="dooms-tracker-json"]', '.dooms-import-fullsheet-btn',
    '.mes_reasoning_details', '.edit_textarea',
].join(',');

let matcher = null;
let observer = null;
let observedChat = null;
let passTimer = null;
let settleTimer = null;
let attachTries = 0;
/** .mes elements waiting for a pass. */
const dirty = new Set();
/** mesid -> {since, threshold, user} for messages whose entrance hasn't played yet. */
const pending = new Map();
/** mesid -> how many glints the message had after its last pass (Continue only flashes past this). */
const seen = new Map();
/** Nodes this module inserted or removed, so its own mutations are ignored. */
let ours = new WeakSet();
let generating = false;
let generatingSince = 0;

/** The settings block, created if missing. */
export function getGlintSettings() {
    if (!extensionSettings.glintWords || typeof extensionSettings.glintWords !== 'object' || !Array.isArray(extensionSettings.glintWords.groups)) {
        extensionSettings.glintWords = normalizeGlintSettings(extensionSettings.glintWords);
    }
    return extensionSettings.glintWords;
}

function isActive() {
    return extensionSettings.enabled !== false && !!getGlintSettings().enabled && !!matcher;
}

export function isGlintActive() {
    return isActive();
}

// ─── Building spans ─────────────────────────────────────────────────────────

/**
 * The span for one matched word: an outer span for the entrance (burst,
 * ring, pop) and an inner one carrying the look and the idle effect.
 * @param {string} text - the word as written in the message
 * @param {object} group - a normalised group
 * @param {string} [phaseKey] - seeds the idle phase so words don't shine in step
 */
export function buildGlintSpan(text, group, phaseKey = '') {
    const outer = document.createElement('span');
    outer.className = `dooms-glint dooms-glint-look-${group.look} dooms-glint-idle-${group.idle}`;
    outer.dataset.glintGroup = group.id;
    if (group.look === 'custom') outer.style.setProperty('--glint-color', group.color);
    const phase = (glintHash(phaseKey || text) % 4000) / 1000;
    outer.style.setProperty('--glint-phase', `-${phase.toFixed(2)}s`);
    const inner = document.createElement('span');
    inner.className = 'dooms-glint-text';
    inner.textContent = text;
    outer.appendChild(inner);
    return outer;
}

/**
 * Plays a group's entrance on a glint span (or replays it, for the
 * settings preview).
 * @param {HTMLElement} span
 * @param {string} entrance
 * @param {number} [delayMs]
 */
export function playGlintEntrance(span, entrance, delayMs = 0) {
    if (!span || !entrance || entrance === 'none') return;
    const classes = ['dooms-glint-enter', `dooms-glint-enter-${entrance}`];
    span.classList.remove(...[...span.classList].filter(c => c.startsWith('dooms-glint-enter')));
    void span.offsetWidth; // restart the animation
    span.style.setProperty('--glint-enter-delay', `${Math.max(0, delayMs)}ms`);
    span.classList.add(...classes);
    const token = String(Date.now() + Math.random());
    span.dataset.glintEnterToken = token;
    setTimeout(() => {
        if (span.dataset.glintEnterToken !== token) return;
        span.classList.remove(...classes);
        span.style.removeProperty('--glint-enter-delay');
        delete span.dataset.glintEnterToken;
    }, ENTER_MS + delayMs + 120);
}

// ─── Entrances wait until the word is seen ──────────────────────────────────

/** Spans whose entrance is waiting for them to scroll into view. */
const waiting = new Set();
let sightObserver = null;

/** Performance Mode and reduced motion skip entrances: the word is simply gold. */
function motionAllowed() {
    if (document.body?.classList.contains('dooms-perf-mode')) return false;
    try { if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false; } catch (e) { /* old browser */ }
    return typeof IntersectionObserver === 'function';
}

/**
 * Holds a new word in its normal colour until it is on screen, then plays
 * its entrance and lets it turn. A long reply's lower words flash when the
 * player scrolls to them, not unseen while they read the top.
 */
function queueEntrance(span, entrance) {
    if (!motionAllowed()) return;
    span.dataset.glintEntrance = entrance;
    span.classList.add('dooms-glint-waiting');
    waiting.add(span);
    if (!sightObserver) {
        // Root: the viewport, clipped by #chat's scroll box, so a word
        // scrolled out of the chat doesn't count as seen.
        sightObserver = new IntersectionObserver(onSight, { threshold: SIGHT_THRESHOLD, rootMargin: '0px 0px -6% 0px' });
    }
    sightObserver.observe(span);
}

function onSight(entries) {
    const now = [];
    for (const entry of entries) {
        const span = entry.target;
        if (!span.isConnected || !waiting.has(span)) {
            sightObserver?.unobserve(span);
            waiting.delete(span);
            continue;
        }
        if (entry.isIntersecting && entry.intersectionRatio >= SIGHT_THRESHOLD - 0.01) now.push(span);
    }
    // Words that come into view together go off in reading order, one after another.
    now.sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
    now.forEach((span, i) => {
        sightObserver?.unobserve(span);
        waiting.delete(span);
        const entrance = span.dataset.glintEntrance || 'flash';
        delete span.dataset.glintEntrance;
        span.classList.remove('dooms-glint-waiting');
        playGlintEntrance(span, entrance, Math.min(i, ENTER_STAGGER_MAX) * ENTER_STAGGER_MS);
    });
}

/** Lets every waiting word turn without its entrance (settings changed, chat switched). */
function releaseWaiting() {
    if (sightObserver) sightObserver.disconnect();
    sightObserver = null;
    for (const span of waiting) {
        span.classList.remove('dooms-glint-waiting');
        delete span.dataset.glintEntrance;
    }
    waiting.clear();
}

// ─── Wrapping and unwrapping ────────────────────────────────────────────────

function textNodesToWrap(root) {
    const nodes = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
            const value = node.nodeValue;
            if (!value || !value.trim()) return NodeFilter.FILTER_REJECT;
            // Most text has no listed word: test that first, the ancestors after.
            matcher.re.lastIndex = 0;
            if (!matcher.re.test(value)) return NodeFilter.FILTER_REJECT;
            const parent = node.parentElement;
            return !parent || parent.closest(SKIP_SELECTOR) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
        },
    });
    while (walker.nextNode()) nodes.push(walker.currentNode);
    return nodes;
}

/**
 * Wraps every listed word in a message that isn't wrapped yet.
 * @param {HTMLElement} mesText - the message's .mes_text
 * @param {number} enterFrom - play the entrance on the n-th new glint onwards (Infinity: none)
 * @returns {number} glints added
 */
function wrapMessage(mesText, enterFrom = Infinity, mesId = '') {
    if (!matcher) return 0;
    const nodes = textNodesToWrap(mesText);
    let index = 0;
    for (const node of nodes) {
        const pieces = splitByGlint(node.nodeValue, matcher);
        if (!pieces || !node.parentNode) continue;
        const frag = document.createDocumentFragment();
        for (const piece of pieces) {
            if (!piece.group) {
                const t = document.createTextNode(piece.text);
                ours.add(t);
                frag.appendChild(t);
                continue;
            }
            const span = buildGlintSpan(piece.text, piece.group, `${mesId}|${index}|${piece.text}`);
            ours.add(span);
            frag.appendChild(span);
            if (index >= enterFrom && piece.group.entrance !== 'none') queueEntrance(span, piece.group.entrance);
            index++;
        }
        ours.add(node);
        node.parentNode.replaceChild(frag, node);
    }
    return index;
}

/**
 * Puts the plain text back for every glint under root.
 * @param {ParentNode} root
 */
export function unwrapGlints(root) {
    if (!root || !root.querySelectorAll) return;
    const parents = new Set();
    for (const span of root.querySelectorAll('.dooms-glint')) {
        const parent = span.parentNode;
        if (!parent) continue;
        const t = document.createTextNode(span.textContent || '');
        ours.add(span);
        ours.add(t);
        parent.replaceChild(t, span);
        parents.add(parent);
    }
    for (const p of parents) { try { p.normalize(); } catch (e) { /* detached */ } }
}

/**
 * The same HTML without glint spans. Chat bubbles keep a message's original
 * HTML to rebuild from and to restore before a Continue; this keeps that
 * copy free of display-only markup.
 * @param {string} html
 * @returns {string}
 */
export function stripGlintHtml(html) {
    if (typeof html !== 'string' || html.indexOf('dooms-glint') === -1) return html;
    try {
        const tpl = document.createElement('template');
        tpl.innerHTML = html;
        for (const span of tpl.content.querySelectorAll('.dooms-glint')) {
            span.replaceWith(document.createTextNode(span.textContent || ''));
        }
        tpl.content.normalize();
        return tpl.innerHTML;
    } catch (e) {
        return html;
    }
}

// ─── The pass ───────────────────────────────────────────────────────────────

function bubblesOn() {
    const mode = extensionSettings.chatBubbleMode;
    return !!mode && mode !== 'off';
}

/** Has a new message stopped being rewritten by the decoration pipeline? */
function isSettled(mes, p) {
    const elapsed = Date.now() - p.since;
    if (bubblesOn()) {
        // applyChatBubbles stamps this when it builds the bubbles; the render
        // handlers clear it first, so its presence means "built after render".
        const mesText = mes.querySelector('.mes_text');
        if (mesText && mesText.hasAttribute('data-dooms-bubbles-at')) return true;
        // The bubble pass waits for a "same character?" answer; so do we.
        if (isAliasDecisionOpen()) return false;
        return elapsed >= SETTLE_DEADLINE_MS;
    }
    return elapsed >= (p.user ? QUIET_USER_MS : QUIET_AI_MS);
}

/** The message a generation is streaming into (left alone until it finishes). */
function isStreamingInto(mes) {
    if (!generating) return false;
    if (Date.now() - generatingSince > GENERATING_TTL_MS) { generating = false; return false; }
    return mes.classList.contains('last_mes') && mes.getAttribute('is_user') !== 'true';
}

function processMessage(mes) {
    if (!mes.isConnected) return;
    const mesText = mes.querySelector('.mes_text');
    if (!mesText) return;
    const id = mes.getAttribute('mesid') || '';
    const idx = Number(id);
    if (Number.isInteger(idx) && Array.isArray(chat) && isSyntheticTrackerMessage(chat[idx])) return;
    // A rebuild that copied a word still waiting to be seen (bubbles keep
    // inline thoughts by copying their HTML) leaves a copy nobody watches.
    for (const stray of mesText.querySelectorAll('.dooms-glint-waiting')) {
        if (!waiting.has(stray)) stray.classList.remove('dooms-glint-waiting');
    }
    const p = pending.get(id);
    if (p) {
        if (!isSettled(mes, p)) { armSettleCheck(); return; }
        pending.delete(id);
        wrapMessage(mesText, p.threshold, id);
    } else {
        if (isStreamingInto(mes)) return;
        wrapMessage(mesText, Infinity, id);
    }
    seen.set(id, mesText.querySelectorAll('.dooms-glint').length);
}

function runPass() {
    passTimer = null;
    if (!isActive()) { dirty.clear(); return; }
    const start = performance.now();
    const batch = [...dirty];
    dirty.clear();
    for (let i = 0; i < batch.length; i++) {
        if (performance.now() - start > PASS_BUDGET_MS) {
            for (let j = i; j < batch.length; j++) dirty.add(batch[j]);
            schedulePass(16);
            return;
        }
        try { processMessage(batch[i]); } catch (e) { console.warn('[Dooms Tracker] Glint Words pass failed:', e); }
    }
}

function schedulePass(delay = PASS_DELAY_MS) {
    if (passTimer) return;
    passTimer = setTimeout(runPass, delay);
}

function markDirty(mes) {
    if (!mes) return;
    dirty.add(mes);
    schedulePass();
}

function queueAll() {
    const chatEl = document.getElementById('chat');
    if (!chatEl) return;
    for (const mes of chatEl.querySelectorAll('.mes')) dirty.add(mes);
    schedulePass(0);
}

function queueById(mesId) {
    const mes = document.querySelector(`#chat .mes[mesid="${mesId}"]`);
    if (mes) markDirty(mes);
}

/** Wakes when the next new message should have settled, and runs its pass straight away. */
function armSettleCheck() {
    if (settleTimer) return;
    const now = Date.now();
    // Bubbles on: the bubble rewrite also wakes the pass; poll gently while
    // a "same character?" question holds them.
    let wait = isAliasDecisionOpen() ? 500 : 120;
    if (!bubblesOn()) {
        wait = SETTLE_DEADLINE_MS;
        for (const p of pending.values()) {
            const due = p.since + (p.user ? QUIET_USER_MS : QUIET_AI_MS) - now;
            wait = Math.min(wait, due);
        }
    }
    settleTimer = setTimeout(() => {
        settleTimer = null;
        for (const id of pending.keys()) {
            const mes = document.querySelector(`#chat .mes[mesid="${id}"]`);
            if (mes) dirty.add(mes);
        }
        if (passTimer) clearTimeout(passTimer);
        passTimer = setTimeout(runPass, 0);
    }, Math.max(30, wait));
}

// ─── Watching the chat ──────────────────────────────────────────────────────

function isOwnRecord(record) {
    if (record.type !== 'childList') return false;
    for (const n of record.addedNodes) if (!ours.has(n)) return false;
    for (const n of record.removedNodes) if (!ours.has(n)) return false;
    return true;
}

function onMutations(records) {
    if (!isActive()) return;
    for (const record of records) {
        if (isOwnRecord(record)) continue;
        const target = record.target;
        if (target === observedChat) {
            for (const n of record.addedNodes) {
                if (n.nodeType === 1 && n.classList.contains('mes')) markDirty(n);
            }
            continue;
        }
        const el = target.nodeType === 1 ? target : target.parentElement;
        const mes = el && el.closest ? el.closest('.mes') : null;
        if (mes && observedChat && observedChat.contains(mes)) markDirty(mes);
    }
}

function connect() {
    const chatEl = document.getElementById('chat');
    if (!chatEl) {
        // #chat is part of SillyTavern's page; this only waits out a slow load.
        if (attachTries++ < 20) setTimeout(() => { if (isActive()) connect(); }, 500);
        return;
    }
    if (observer && observedChat === chatEl) return;
    disconnect();
    observedChat = chatEl;
    observer = new MutationObserver(onMutations);
    observer.observe(chatEl, { childList: true, subtree: true });
}

function disconnect() {
    if (observer) observer.disconnect();
    observer = null;
    observedChat = null;
}

// ─── Public lifecycle ───────────────────────────────────────────────────────

/** Startup: tidy the settings, and start watching if there is anything to glint. */
export function initGlintWords() {
    extensionSettings.glintWords = normalizeGlintSettings(extensionSettings.glintWords);
    refreshGlintWords();
}

/**
 * Settings changed (or the extension was switched on or off): rebuild the
 * matcher and re-wrap every message from scratch. Plays no entrances.
 */
export function refreshGlintWords() {
    const s = getGlintSettings();
    matcher = s.enabled ? buildGlintMatcher(s.groups) : null;
    releaseWaiting();
    const chatEl = document.getElementById('chat');
    if (chatEl) unwrapGlints(chatEl);
    pending.clear();
    seen.clear();
    dirty.clear();
    if (!isActive()) { disconnect(); return; }
    ensureCss('glint').catch(() => {});
    connect();
    queueAll();
}

/** CHARACTER_MESSAGE_RENDERED: a new AI message (or swipe, or Continue) landed. */
export function onGlintMessageRendered(messageId, type) {
    if (!isActive()) return;
    const id = String(messageId);
    // A Continue re-renders the whole message: only words past the ones it
    // already had get an entrance.
    const threshold = type === 'continue' ? (seen.get(id) ?? 0) : 0;
    pending.set(id, { since: Date.now(), threshold, user: false });
    queueById(id);
}

/** USER_MESSAGE_RENDERED: the player's own new message. */
export function onGlintUserMessageRendered(messageId) {
    if (!isActive()) return;
    const id = String(messageId);
    pending.set(id, { since: Date.now(), threshold: 0, user: true });
    queueById(id);
}

/** GENERATION_STARTED: leave the message being streamed alone until it finishes. */
export function onGlintGenerationStarted(type, _options, dryRun) {
    if (dryRun || type === 'quiet') return;
    generating = true;
    generatingSince = Date.now();
}

/** GENERATION_ENDED / GENERATION_STOPPED */
export function onGlintGenerationEnded() {
    if (!generating) return;
    generating = false;
    if (!isActive()) return;
    const last = document.querySelector('#chat .mes.last_mes');
    if (last) markDirty(last);
}

/** CHAT_CHANGED: a different chat; nothing in it is new. */
export function onGlintChatChanged() {
    releaseWaiting();
    pending.clear();
    seen.clear();
    dirty.clear();
    ours = new WeakSet();
    generating = false;
    if (!isActive()) return;
    connect(); // SillyTavern keeps #chat, but reattach if it was replaced
    queueAll();
}
