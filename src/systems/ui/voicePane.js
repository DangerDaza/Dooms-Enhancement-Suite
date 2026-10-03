/*
 * Doom's Enhancement Suite for SillyTavern — Character Workshop: Voice tab
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
 * The Workshop's Voice tab (docs/google-tts-voices-plan.md §6.1). Loaded the
 * first time the tab is opened. The Workshop owns the draft; this module
 * only renders it and reports a pick through ctx.onChange, so choosing a
 * voice is an ordinary draft edit committed by the Workshop's Save.
 *
 * A "current voice" card on top, then three tabs: Standard (Google's 30
 * voices, filterable by gender), My voices (designed and cloned voices,
 * from voiceStudio.js) and Create new, which is either Describe it
 * (voiceStudio.js) or Clone a recording (voiceCloner.js). The tools load on
 * first use.
 */
import { extensionSettings } from '../../core/state.js';
import { STOCK_VOICES, stockLabel, stockRef, canonicalStockId } from '../voices/voiceCatalog.js';
import { getEngine, getEngineIfLoaded, unlockVoicesAudio } from '../voices/voiceBoot.js';
import { escapeHtml, escapeAttr } from '../../utils/html.js';

/** Per-character test lines typed this session (not saved). */
const testLines = new Map();
let stateListenerBound = false;
const FILTER_KEY = 'dooms_voices_gender_filter';
/** 'standard' | 'mine' | 'create' — per character, this session. */
const views = new Map();
/** Create new: 'describe' | 'clone' — per character, this session. */
const createModes = new Map();
let studio = null; // voiceStudio.js once loaded
let cloner = null; // voiceCloner.js once loaded

function readFilter() {
    try {
        const f = localStorage.getItem(FILTER_KEY);
        return f === 'female' || f === 'male' ? f : 'all';
    } catch (e) {
        return 'all';
    }
}

function writeFilter(f) {
    try { localStorage.setItem(FILTER_KEY, f); } catch (e) { /* per-device nicety */ }
}

/**
 * @typedef {object} VoicePaneContext
 * @property {string} name
 * @property {boolean} isUser
 * @property {boolean} isLive
 * @property {string} versionLabel
 * @property {boolean} isBase
 * @property {{source?: string, id: string|null, label?: string, pendingDesign?: string}|null} voice
 * @property {boolean} isCardCharacter
 * @property {string[]} sharesColorWith
 * @property {{appearance?: string, description?: string}} [card]
 * @property {(ref: object|null) => void} onChange
 */

/** @type {{host: HTMLElement, ctx: VoicePaneContext}|null} */
let last = null;

function defaultTestLine(name) {
    return `Hello, I'm ${name}.`;
}

function testLineFor(name) {
    return (testLines.get(name) ?? defaultTestLine(name)).trim() || defaultTestLine(name);
}

function statusLines(ctx) {
    const lines = [];
    const who = escapeHtml(ctx.name);
    if (ctx.isUser) {
        lines.push(`Used for your persona's lines while it is shown on the Present Characters panel ("Show me in Present Characters" must be on). Otherwise the Narrator reads them.`);
    } else {
        lines.push(`Heard only while ${who} is on the Present Characters panel. Otherwise the Narrator reads their lines.`);
        if (!ctx.isLive) {
            lines.push(`This is ${who}'s voice in the <strong>${escapeHtml(ctx.versionLabel)}</strong> version; it's used while that campaign is active.`);
        } else if (!ctx.isBase) {
            lines.push(`This is ${who}'s voice in <strong>${escapeHtml(ctx.versionLabel)}</strong>, the active campaign.`);
        }
        if (ctx.isCardCharacter) {
            lines.push('The card’s own character is only voiced when the tracker lists them as present.');
        }
    }
    if (ctx.sharesColorWith && ctx.sharesColorWith.length) {
        lines.push(`⚠️ ${who} shares a dialogue colour with ${ctx.sharesColorWith.map(escapeHtml).join(', ')}, so some lines may be read in the wrong voice. Give them different colours in Appearance.`);
    }
    const v = extensionSettings.voices || {};
    if (!v.enabled) {
        lines.push('DES voices are off. Turn them on in <strong>Settings → Voices</strong> to hear these voices in chat. Previews work either way.');
    } else if (!extensionSettings.enableDialogueColoring) {
        lines.push('Dialogue colouring is off, so DES can’t tell who is speaking and the Narrator reads everything.');
    }
    return lines;
}

function isPlaying(voiceId) {
    const engine = getEngineIfLoaded();
    return !!engine && engine.isAuditioning(voiceId);
}

function registryEntry(id) {
    return id ? (extensionSettings.voices?.customVoices || {})[id] || null : null;
}

function currentVoiceText(ctx) {
    const v = ctx.voice;
    if (!v) return { label: 'None', kind: '', note: 'The Narrator reads their lines. Pick a voice below.' };
    if (!v.id && v.pendingDesign) return { label: v.label || 'Designed voice', kind: 'Not created yet', note: 'Open Create new → Describe it and press Create voice to make it.' };
    const source = v.source || 'stock';
    if (source === 'stock') return { label: stockLabel(canonicalStockId(v.id) || v.id), kind: 'Standard', note: '' };
    const entry = registryEntry(v.id);
    const kind = (entry?.source || v.source) === 'cloned' ? 'Cloned' : 'Designed';
    const label = entry?.label || v.label || 'Custom voice';
    if (!extensionSettings.voices?.googleApiKey) {
        return { label, kind, note: `Needs your Google key in Settings → Voices; until then ${v.fallbackStock || 'a standard voice'} reads their lines.` };
    }
    if (entry?.status === 'gone') {
        return { label, kind, note: `This voice no longer exists on Google, so ${v.fallbackStock || 'a standard voice'} reads their lines. Recreate it in My voices.` };
    }
    return { label, kind, note: '' };
}

function stockGrid(ctx) {
    const current = ctx.voice && (ctx.voice.source || 'stock') === 'stock' ? canonicalStockId(ctx.voice.id) : null;
    const filter = readFilter();
    const card = (voice) => {
        const selected = voice.id === current;
        const playing = isPlaying(voice.id);
        return `
            <div class="cw-voice-card${selected ? ' is-selected' : ''}" data-voice="${escapeAttr(voice.id)}" data-gender="${voice.gender}">
                <button type="button" class="cw-voice-pick" data-voice="${escapeAttr(voice.id)}" aria-pressed="${selected}"
                    title="Use ${escapeAttr(voice.id)} for ${escapeAttr(ctx.name)}">
                    <span class="cw-voice-name">${escapeHtml(voice.id)}</span>
                    <span class="cw-voice-trait">${escapeHtml(voice.trait)} · ${voice.gender === 'female' ? 'Female' : 'Male'}</span>
                </button>
                <button type="button" class="cw-voice-play${playing ? ' is-playing' : ''}" data-voice="${escapeAttr(voice.id)}"
                    aria-label="${playing ? 'Stop' : 'Preview'} ${escapeAttr(voice.id)}" title="${playing ? 'Stop' : 'Preview'}">
                    <i class="fa-solid ${playing ? 'fa-stop' : 'fa-play'}"></i>
                </button>
            </div>`;
    };
    const byName = (a, b) => a.id.localeCompare(b.id);
    const female = STOCK_VOICES.filter(v => v.gender === 'female').sort(byName);
    const male = STOCK_VOICES.filter(v => v.gender === 'male').sort(byName);
    const chip = (value, label, count) =>
        `<button type="button" class="cw-voice-filter${filter === value ? ' is-active' : ''}" data-filter="${value}" role="tab" aria-selected="${filter === value}">${label} <span class="cw-voice-count">${count}</span></button>`;
    let grid;
    if (filter === 'female') grid = `<div class="cw-voice-grid" role="list">${female.map(card).join('')}</div>`;
    else if (filter === 'male') grid = `<div class="cw-voice-grid" role="list">${male.map(card).join('')}</div>`;
    else {
        grid = `<h5 class="cw-voice-group">Female</h5><div class="cw-voice-grid" role="list">${female.map(card).join('')}</div>
                <h5 class="cw-voice-group">Male</h5><div class="cw-voice-grid" role="list">${male.map(card).join('')}</div>`;
    }
    return `
        <div class="cw-voice-filters" role="tablist" aria-label="Filter by gender">
            ${chip('all', 'All', STOCK_VOICES.length)}${chip('female', 'Female', female.length)}${chip('male', 'Male', male.length)}
        </div>
        ${grid}
        <p class="helper">Tap a voice to use it (you'll hear it), then press <strong>Save</strong>. &#9654; only previews.</p>`;
}

function viewFor(ctx) {
    if (!views.has(ctx.name)) {
        const v = ctx.voice;
        const pending = v && !v.id && v.pendingDesign;
        const custom = v && (v.source === 'designed' || v.source === 'cloned');
        views.set(ctx.name, pending ? 'create' : custom ? 'mine' : 'standard');
    }
    return views.get(ctx.name);
}

function createModeFor(ctx) {
    return createModes.get(ctx.name) === 'clone' ? 'clone' : 'describe';
}

/** Which lazily loaded tool the current view needs: 'studio', 'cloner' or null. */
function toolFor(ctx) {
    const view = viewFor(ctx);
    if (view === 'mine') return 'studio';
    if (view === 'create') return createModeFor(ctx) === 'clone' ? 'cloner' : 'studio';
    return null;
}

function toolLoaded(tool) {
    return tool === 'studio' ? !!studio : tool === 'cloner' ? !!cloner : true;
}

function render(host, ctx) {
    const current = ctx.voice && (ctx.voice.id || ctx.voice.pendingDesign) ? ctx.voice : null;
    const { label: currentLabel, kind: currentKind, note } = currentVoiceText(ctx);
    const testLine = testLines.get(ctx.name) ?? defaultTestLine(ctx.name);
    const view = viewFor(ctx);
    const mode = createModeFor(ctx);
    const toolCtx = { ...ctx, testLine: () => testLineFor(ctx.name) };
    let body;
    if (view === 'mine') {
        body = studio ? studio.renderMine(toolCtx, isPlaying) : '<p class="helper">Loading your voices…</p>';
    } else if (view === 'create') {
        const modeBtn = (value, icon, label) =>
            `<button type="button" class="cw-voice-mode${mode === value ? ' is-active' : ''}" data-mode="${value}" role="radio" aria-checked="${mode === value}">${icon} ${label}</button>`;
        const tool = mode === 'clone'
            ? (cloner ? cloner.renderCloner(toolCtx, isPlaying) : '<p class="helper">Loading…</p>')
            : (studio ? studio.renderStudio(toolCtx, isPlaying) : '<p class="helper">Loading the voice designer…</p>');
        body = `
            <div class="cw-voice-modes" role="radiogroup" aria-label="How to make the voice">
                ${modeBtn('describe', '&#9997;&#65039;', 'Describe it')}${modeBtn('clone', '&#127897;&#65039;', 'Clone a recording')}
            </div>
            <p class="helper cw-voice-mode-hint">${mode === 'clone'
                ? 'Copy a real person’s voice from a short recording. They have to record a consent statement too.'
                : 'Google makes a brand-new voice from a written description.'}</p>
            ${tool}`;
    } else {
        body = stockGrid(ctx);
    }
    const canPreview = current && current.id;
    const tab = (value, label) =>
        `<button type="button" class="cw-voice-view${view === value ? ' is-active' : ''}" data-view="${value}" role="tab" aria-selected="${view === value}">${label}</button>`;

    host.innerHTML = `
        <h4>&#127908; Voice</h4>
        ${statusLines(ctx).map(line => `<p class="helper">${line}</p>`).join('')}
        <div class="cw-voice-current${current ? '' : ' is-empty'}">
            <div class="cw-voice-current-text">
                <span class="cw-voice-current-label">Current voice</span>
                <span class="cw-voice-current-name">
                    <strong class="cw-voice-current-value">${escapeHtml(currentLabel)}</strong>
                    ${currentKind ? `<span class="cw-voice-kind">${escapeHtml(currentKind)}</span>` : ''}
                </span>
            </div>
            <div class="cw-voice-current-actions">
                ${canPreview ? `<button type="button" class="rpg-btn cw-voice-play-current" title="Say the test line in this voice"><i class="fa-solid ${isPlaying(current.id) ? 'fa-stop' : 'fa-play'}"></i> Play</button>` : ''}
                ${current ? `<button type="button" class="rpg-btn cw-voice-clear" title="Take this voice off ${escapeAttr(ctx.name)}; the Narrator reads their lines"><i class="fa-solid fa-xmark"></i> Remove</button>` : ''}
            </div>
        </div>
        ${note ? `<p class="helper cw-voice-note">${escapeHtml(note)}</p>` : ''}
        <label class="cw-voice-test">
            <span>Test line <span class="cw-voice-test-hint">— what previews say. Each new line is one short Google request; replays are free.</span></span>
            <input type="text" class="rpg-input cw-voice-test-input" value="${escapeAttr(testLine)}" maxlength="300" />
        </label>
        <div class="cw-voice-views" role="tablist" aria-label="Voices">
            ${tab('standard', 'Standard')}${tab('mine', 'My voices')}${tab('create', '&#10133; Create new')}
        </div>
        <div class="cw-voice-body">${body}</div>
    `;
}

async function ensureStudio() {
    if (studio) return studio;
    studio = await import('./voiceStudio.js');
    return studio;
}

async function ensureCloner() {
    if (cloner) return cloner;
    cloner = await import('./voiceCloner.js');
    return cloner;
}

async function ensureTool(tool) {
    try {
        if (tool === 'studio') await ensureStudio();
        if (tool === 'cloner') await ensureCloner();
    } catch (err) {
        console.error('[DES Voices] voice tools failed to load', err);
    }
}

/** The Workshop closed: drop any clone recordings still in memory. */
export function onWorkshopClosed() {
    cloner?.clearClonerRecordings();
}

async function audition(ref, name) {
    unlockVoicesAudio();
    const engine = await getEngine();
    engine.audition(ref, testLineFor(name));
    refreshPlayButtons();
}

/** Flips the ▶/■ buttons without rebuilding the pane (keeps focus in the test line). */
function refreshPlayButtons() {
    if (!last || !last.host.isConnected) return;
    last.host.querySelectorAll('.cw-voice-play').forEach((btn) => {
        const id = btn.getAttribute('data-voice');
        const playing = isPlaying(id);
        btn.classList.toggle('is-playing', playing);
        btn.setAttribute('aria-label', `${playing ? 'Stop' : 'Preview'} ${id}`);
        btn.setAttribute('title', playing ? 'Stop' : 'Preview');
        const icon = btn.querySelector('i');
        if (icon) icon.className = `fa-solid ${playing ? 'fa-stop' : 'fa-play'}`;
    });
    const currentId = last.ctx.voice?.id;
    const currentIcon = last.host.querySelector('.cw-voice-play-current i');
    if (currentIcon && currentId) currentIcon.className = `fa-solid ${isPlaying(currentId) ? 'fa-stop' : 'fa-play'}`;
}

function rerender() {
    if (last && last.host.isConnected) render(last.host, last.ctx);
}

function bindOnce(host) {
    if (host.dataset.voiceBound === '1') return;
    host.dataset.voiceBound = '1';
    host.addEventListener('click', async (e) => {
        const ctx = last?.ctx;
        if (!ctx) return;
        const target = /** @type {HTMLElement} */ (e.target);
        const viewBtn = target.closest('.cw-voice-view, .cw-voice-mode, .cw-voice-goto-create');
        if (viewBtn) {
            e.preventDefault();
            if (viewBtn.classList.contains('cw-voice-mode')) {
                views.set(ctx.name, 'create');
                createModes.set(ctx.name, viewBtn.getAttribute('data-mode'));
            } else if (viewBtn.classList.contains('cw-voice-goto-create')) {
                views.set(ctx.name, 'create');
            } else {
                views.set(ctx.name, viewBtn.getAttribute('data-view'));
            }
            const tool = toolFor(ctx);
            if (!toolLoaded(tool)) {
                render(host, ctx);
                await ensureTool(tool);
            }
            rerender();
            return;
        }
        const filterBtn = target.closest('.cw-voice-filter');
        if (filterBtn) {
            e.preventDefault();
            writeFilter(filterBtn.getAttribute('data-filter'));
            rerender();
            return;
        }
        const play = target.closest('.cw-voice-play');
        if (play) {
            e.preventDefault();
            const id = play.getAttribute('data-voice');
            const source = play.getAttribute('data-source') || 'stock';
            audition(source === 'stock' ? stockRef(id) : { source, id }, ctx.name);
            return;
        }
        const pick = target.closest('.cw-voice-pick');
        if (pick) {
            e.preventDefault();
            const id = pick.getAttribute('data-voice');
            ctx.onChange(stockRef(id));
            audition(stockRef(id), ctx.name);
            return;
        }
        if (target.closest('.cw-voice-play-current')) {
            e.preventDefault();
            if (ctx.voice?.id) audition(ctx.voice, ctx.name);
            return;
        }
        if (target.closest('.cw-voice-clear')) {
            e.preventDefault();
            ctx.onChange(null);
            return;
        }
        const toolCtx = { ...ctx, testLine: () => testLineFor(ctx.name) };
        const tool = toolFor(ctx);
        if (studio && tool === 'studio') {
            const handled = await studio.handleStudioClick(target, host, toolCtx, rerender);
            if (handled) e.preventDefault();
        } else if (cloner && tool === 'cloner') {
            // Let the file picker's <label> open the dialog.
            if (target.closest('.cw-clone-upload-label')) return;
            const handled = await cloner.handleClonerClick(target, host, toolCtx, rerender, isPlaying);
            if (handled) e.preventDefault();
        }
    });
    const onInput = (e) => {
        const input = /** @type {HTMLElement} */ (e.target);
        if (!last) return;
        if (input.classList?.contains('cw-voice-test-input')) {
            testLines.set(last.ctx.name, /** @type {HTMLInputElement} */ (input).value);
            return;
        }
        if (studio && toolFor(last.ctx) === 'studio') studio.handleStudioInput(input, last.ctx);
    };
    host.addEventListener('input', onInput);
    // Enter in "I'm thinking of…" asks the AI, like the button next to it.
    host.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' || !e.target.classList?.contains('cw-studio-ref-input')) return;
        e.preventDefault();
        host.querySelector('.cw-studio-ref-go')?.click();
    });
    host.addEventListener('change', onInput);
    // The clone wizard's checkbox, selects and file picker act on "change" only
    // (a file input fires both events; handling both would read the file twice).
    host.addEventListener('change', (e) => {
        if (!last || !cloner || toolFor(last.ctx) !== 'cloner') return;
        cloner.handleClonerInput(/** @type {HTMLElement} */ (e.target), last.ctx, rerender);
    });
}

/**
 * @param {HTMLElement} host - #cw-voice-pane
 * @param {VoicePaneContext} ctx
 */
export async function renderVoicePane(host, ctx) {
    last = { host, ctx };
    bindOnce(host);
    const tool = toolFor(ctx);
    if (!toolLoaded(tool)) {
        render(host, ctx);
        await ensureTool(tool);
    }
    render(host, ctx);
    if (!stateListenerBound) {
        stateListenerBound = true;
        // Flip ▶/■ when a preview starts or ends.
        document.addEventListener('dooms:voices-state', refreshPlayButtons);
        // A designed voice was created, deleted or recreated somewhere else.
        document.addEventListener('dooms:voices-registry', rerender);
    }
}
