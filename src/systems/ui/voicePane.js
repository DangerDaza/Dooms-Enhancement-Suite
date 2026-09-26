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
 * This release offers Google's 30 standard voices. The voice library,
 * voice design and cloning come in later milestones.
 */
import { extensionSettings } from '../../core/state.js';
import { STOCK_VOICES, stockLabel, stockRef, canonicalStockId } from '../voices/voiceCatalog.js';
import { getEngine, getEngineIfLoaded, unlockVoicesAudio } from '../voices/voiceBoot.js';
import { escapeHtml, escapeAttr } from '../../utils/html.js';

/** Per-character test lines typed this session (not saved). */
const testLines = new Map();
let stateListenerBound = false;

/**
 * @typedef {object} VoicePaneContext
 * @property {string} name
 * @property {boolean} isUser
 * @property {boolean} isLive
 * @property {string} versionLabel
 * @property {boolean} isBase
 * @property {{source?: string, id: string}|null} voice
 * @property {boolean} isCardCharacter
 * @property {string[]} sharesColorWith
 * @property {(ref: object|null) => void} onChange
 */

/** @type {{host: HTMLElement, ctx: VoicePaneContext}|null} */
let last = null;

function defaultTestLine(name) {
    return `Hello, I'm ${name}.`;
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

function render(host, ctx) {
    const current = ctx.voice && ctx.voice.id ? ctx.voice : null;
    const currentStock = current && (current.source || 'stock') === 'stock' ? canonicalStockId(current.id) : null;
    const currentLabel = current
        ? (currentStock ? stockLabel(currentStock) : `${current.label || current.id} (not playable in this version of DES)`)
        : 'None — the Narrator reads their lines';
    const testLine = testLines.get(ctx.name) ?? defaultTestLine(ctx.name);

    const cards = STOCK_VOICES.map((voice) => {
        const selected = voice.id === currentStock;
        const playing = isPlaying(voice.id);
        return `
            <div class="cw-voice-card${selected ? ' is-selected' : ''}" data-voice="${escapeAttr(voice.id)}">
                <button type="button" class="cw-voice-pick" data-voice="${escapeAttr(voice.id)}" aria-pressed="${selected}"
                    title="Use ${escapeAttr(voice.id)} for ${escapeAttr(ctx.name)}">
                    <span class="cw-voice-name">${escapeHtml(voice.id)}</span>
                    <span class="cw-voice-trait">${escapeHtml(voice.trait)}</span>
                </button>
                <button type="button" class="cw-voice-play${playing ? ' is-playing' : ''}" data-voice="${escapeAttr(voice.id)}"
                    aria-label="${playing ? 'Stop' : 'Preview'} ${escapeAttr(voice.id)}" title="${playing ? 'Stop' : 'Preview'}">
                    <i class="fa-solid ${playing ? 'fa-stop' : 'fa-play'}"></i>
                </button>
            </div>`;
    }).join('');

    host.innerHTML = `
        <h4>&#127908; Voice</h4>
        ${statusLines(ctx).map(line => `<p class="helper">${line}</p>`).join('')}
        <div class="cw-voice-current">
            <span class="cw-voice-current-label">Current voice:</span>
            <strong class="cw-voice-current-value">${escapeHtml(currentLabel)}</strong>
            ${current ? `<button type="button" class="rpg-btn cw-voice-play-current" title="Preview"><i class="fa-solid fa-play"></i> Preview</button>` : ''}
            ${current ? `<button type="button" class="rpg-btn cw-voice-clear">Use Narrator (no voice)</button>` : ''}
        </div>
        <label class="cw-voice-test">
            <span>Test line</span>
            <input type="text" class="rpg-input cw-voice-test-input" value="${escapeAttr(testLine)}" maxlength="300" />
        </label>
        <p class="helper cw-voice-cost">Each preview is a short Google request. Replaying the same line is free.</p>
        <h4 class="cw-voice-subhead">Standard voices</h4>
        <div class="cw-voice-grid" role="list">${cards}</div>
        <p class="helper">Click a voice to use it, then <strong>Save</strong>. Google's voice library, designing a voice from a description, and cloning come in a later update.</p>
    `;
}

async function audition(voiceId, name) {
    unlockVoicesAudio();
    const engine = await getEngine();
    const line = (testLines.get(name) ?? defaultTestLine(name)).trim() || defaultTestLine(name);
    engine.audition(stockRef(voiceId), line);
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
}

function bindOnce(host) {
    if (host.dataset.voiceBound === '1') return;
    host.dataset.voiceBound = '1';
    host.addEventListener('click', (e) => {
        const ctx = last?.ctx;
        if (!ctx) return;
        const target = /** @type {HTMLElement} */ (e.target);
        const play = target.closest('.cw-voice-play');
        if (play) {
            e.preventDefault();
            audition(play.getAttribute('data-voice'), ctx.name);
            return;
        }
        const pick = target.closest('.cw-voice-pick');
        if (pick) {
            e.preventDefault();
            const id = pick.getAttribute('data-voice');
            ctx.onChange(stockRef(id));
            audition(id, ctx.name);
            return;
        }
        if (target.closest('.cw-voice-play-current')) {
            e.preventDefault();
            if (ctx.voice?.id) audition(ctx.voice.id, ctx.name);
            return;
        }
        if (target.closest('.cw-voice-clear')) {
            e.preventDefault();
            ctx.onChange(null);
        }
    });
    host.addEventListener('input', (e) => {
        const input = /** @type {HTMLElement} */ (e.target);
        if (!input.classList?.contains('cw-voice-test-input') || !last) return;
        testLines.set(last.ctx.name, /** @type {HTMLInputElement} */ (input).value);
    });
}

/**
 * @param {HTMLElement} host - #cw-voice-pane
 * @param {VoicePaneContext} ctx
 */
export function renderVoicePane(host, ctx) {
    last = { host, ctx };
    bindOnce(host);
    render(host, ctx);
    if (!stateListenerBound) {
        stateListenerBound = true;
        // Flip ▶/■ when a preview starts or ends.
        document.addEventListener('dooms:voices-state', refreshPlayButtons);
    }
}
