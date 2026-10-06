/*
 * Doom's Enhancement Suite for SillyTavern — Character Workshop: voice designer
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
 * The Voice tab's "Design" view (docs/google-tts-voices-plan.md §6.1, §8.3):
 * describe a voice (or draft the description from the card), create it on
 * Google, hear the sample, then use it, try again, or discard it. Also lists
 * the voices already designed so one can be reused for another character.
 *
 * Loaded the first time the Design view is opened. Picking a voice is an
 * ordinary Workshop draft edit (ctx.onChange) committed by Save.
 */
import { getEngine, unlockVoicesAudio } from '../voices/voiceBoot.js';
import { getDesKey } from '../voices/transport.js';
import {
    listRegistered,
    getRegistered,
    refFor,
    daysLeft,
    health,
    usedByText,
    designVoice,
    deleteDesignedVoice,
    recreateDesignedVoice,
    draftDescriptionFromCard,
    draftDescriptionFromReference,
} from '../voices/voiceRegistry.js';
import { escapeHtml, escapeAttr } from '../../utils/html.js';
import { DESIGN_LANGUAGES } from '../voices/voiceCatalog.js';
import { MAX_DESIGN_DESCRIPTION, referenceProblem } from '../voices/drafts.js';

/**
 * Per-character designer state (this session only).
 * @type {Map<string, {description: string, reference: string, gender: string, languageCode: string, label: string,
 *   busy: string, error: string, result: {entry: object, sample: object|null}|null}>}
 */
const states = new Map();

function stateFor(ctx) {
    if (!states.has(ctx.name)) {
        states.set(ctx.name, {
            description: ctx.voice?.pendingDesign || '',
            reference: '',
            moreOpen: false,
            gender: '',
            languageCode: '',
            label: `${ctx.name}'s voice`,
            busy: '',
            error: '',
            result: null,
        });
    }
    return states.get(ctx.name);
}

function genderWord(g) {
    return g === 'female' ? 'Female' : g === 'male' ? 'Male' : '';
}

function badge(entry) {
    const h = health(entry);
    if (h === 'gone') return '<span class="cw-voice-badge is-gone">No longer on Google</span>';
    if (h === 'expiring') {
        const d = daysLeft(entry);
        return `<span class="cw-voice-badge is-expiring">Expires in ${Math.max(0, d)} day${d === 1 ? '' : 's'}</span>`;
    }
    return '';
}

/** The "needs a key" panel shared by the designer and My voices. */
function lockedHtml(what) {
    return `
        <div class="cw-voice-locked">
            <p><strong>${what} needs your Google AI Studio key.</strong></p>
            <p class="helper">Paste it in <strong>Settings → Voices → Google AI Studio key</strong>. SillyTavern has no way to design voices, so DES talks to Google directly for this.</p>
        </div>`;
}

/** HTML for Create new → Describe it. */
export function renderStudio(ctx, isPlaying) {
    const st = stateFor(ctx);
    if (!getDesKey()) return lockedHtml('Making voices');

    const pending = ctx.voice && !ctx.voice.id && ctx.voice.pendingDesign
        ? `<p class="helper cw-voice-pending">This character was imported with a designed voice that doesn't exist in your Google project yet. Its description is filled in below &mdash; press <strong>Create voice</strong> to make it.</p>`
        : '';

    const result = st.result;
    const resultHtml = result ? `
        <div class="cw-voice-result">
            <div class="cw-voice-result-head">
                <strong>${escapeHtml(result.entry.label)}</strong> is ready
                ${result.entry.gender ? `<span class="cw-voice-gender">${genderWord(result.entry.gender)}</span>` : ''}
            </div>
            <div class="cw-voice-result-actions">
                <button type="button" class="rpg-btn cw-studio-read-desc" data-voice="${escapeAttr(result.entry.id)}" title="It reads the description you wrote"><i class="fa-solid fa-play"></i> Hear description</button>
                <button type="button" class="rpg-btn cw-studio-try-line" data-voice="${escapeAttr(result.entry.id)}" title="It says the test line above"><i class="fa-solid fa-play"></i> Hear test line</button>
            </div>
            <div class="cw-voice-result-actions">
                <button type="button" class="rpg-btn rpg-btn-primary cw-studio-use" data-voice="${escapeAttr(result.entry.id)}"><i class="fa-solid fa-check"></i> Use for ${escapeHtml(ctx.name)}</button>
                <button type="button" class="rpg-btn cw-studio-again" title="Delete this one and make a new one from the description"><i class="fa-solid fa-rotate"></i> Try again</button>
                <button type="button" class="rpg-btn rpg-btn-danger cw-studio-discard" title="Delete this voice from your Google project"><i class="fa-solid fa-trash"></i> Discard</button>
            </div>
            <p class="helper">It's saved in your Google project and listed under My voices. Press <strong>Use</strong>, then <strong>Save</strong>, to give it to ${escapeHtml(ctx.name)}.</p>
        </div>` : '';

    const busy = st.busy;
    return `
        ${pending}
        <div class="cw-studio-form">
            <div class="cw-studio-assist">
                <span class="cw-studio-step">1. Start from a character <span class="cw-studio-step-hint">optional &mdash; your chat AI writes the description in step 2</span></span>
                <label class="cw-studio-field">
                    <span>I'm thinking of&hellip;</span>
                    <textarea class="rpg-textarea cw-studio-ref-input" rows="2" maxlength="200"
                        placeholder="A character from a game, film, book or show, e.g. Withers from Baldur's Gate 3">${escapeHtml(st.reference)}</textarea>
                </label>
                <div class="cw-studio-assist-actions">
                    <button type="button" class="rpg-btn cw-studio-ref-go" ${busy ? 'disabled' : ''} title="Your chat AI describes how that character sounds (Enter)">
                        <i class="fa-solid fa-lightbulb"></i> ${busy === 'reference' ? 'Writing…' : 'Describe their voice'}
                    </button>
                    <span class="cw-studio-or">or</span>
                    <button type="button" class="rpg-btn cw-studio-draft" ${busy ? 'disabled' : ''} title="Uses ${escapeAttr(ctx.name)}'s appearance and description">
                        <i class="fa-solid fa-wand-magic-sparkles"></i> ${busy === 'draft' ? 'Writing…' : `From ${escapeHtml(ctx.name)}'s card`}
                    </button>
                </div>
            </div>
            <label class="cw-studio-field">
                <span class="cw-studio-step">2. How do they sound?</span>
                <textarea class="rpg-textarea cw-studio-desc" rows="5" maxlength="${MAX_DESIGN_DESCRIPTION}"
                    placeholder="Write it yourself, or fill it from step 1. Cover age, gender, pitch, texture, pace, accent and attitude. e.g. A husky, low-pitched woman in her forties with a slow Southern drawl and a wry, tired warmth.">${escapeHtml(st.description)}</textarea>
            </label>
            <details class="cw-studio-more"${st.moreOpen ? ' open' : ''}>
                <summary>More options <span class="cw-studio-more-hint">name, gender, accent</span></summary>
                <div class="cw-studio-grid">
                    <label class="cw-studio-field">
                        <span>Name</span>
                        <input type="text" class="rpg-input cw-studio-label" maxlength="60" value="${escapeAttr(st.label)}" />
                    </label>
                    <label class="cw-studio-field">
                        <span>Gender</span>
                        <select class="rpg-accordion-select cw-studio-gender">
                            <option value=""${st.gender === '' ? ' selected' : ''}>From the description</option>
                            <option value="female"${st.gender === 'female' ? ' selected' : ''}>Female</option>
                            <option value="male"${st.gender === 'male' ? ' selected' : ''}>Male</option>
                        </select>
                    </label>
                    <label class="cw-studio-field">
                        <span>Language / accent</span>
                        <select class="rpg-accordion-select cw-studio-lang">
                            ${DESIGN_LANGUAGES.map(([code, label]) => `<option value="${code}"${st.languageCode === code ? ' selected' : ''}>${escapeHtml(label)}</option>`).join('')}
                        </select>
                    </label>
                </div>
            </details>
            <div class="cw-studio-row">
                <button type="button" class="rpg-btn rpg-btn-primary cw-studio-create" ${busy || result ? 'disabled' : ''}>
                    <i class="fa-solid fa-wand-magic-sparkles"></i> ${busy === 'create' ? 'Creating… (this can take a little while)' : 'Create voice'}
                </button>
                <span class="helper">Uses 1 of your 200 Google voice slots. Google may reject descriptions that name people.</span>
            </div>
            ${st.error ? `<p class="cw-studio-error">${escapeHtml(st.error)}</p>` : ''}
        </div>
        ${resultHtml}
    `;
}

/** HTML for the My voices tab: every designed and cloned voice. */
export function renderMine(ctx, isPlaying) {
    const st = stateFor(ctx);
    const currentId = ctx.voice && (ctx.voice.source === 'designed' || ctx.voice.source === 'cloned') ? ctx.voice.id : null;
    const mine = listRegistered();
    if (!mine.length) {
        return `
            <div class="cw-voice-empty">
                <p>You haven't made any voices yet.</p>
                <button type="button" class="rpg-btn rpg-btn-primary cw-voice-goto-create"><i class="fa-solid fa-plus"></i> Create a voice</button>
            </div>`;
    }
    const keyNote = getDesKey() ? '' : '<p class="helper cw-voice-note">Your voices need the Google key in Settings → Voices to play.</p>';
    return `
        ${keyNote}
        <div class="cw-voice-mine">
            ${mine.map((entry) => {
                const selected = entry.id === currentId;
                const gone = health(entry) === 'gone';
                const used = usedByText(entry.id);
                const desc = entry.source === 'cloned'
                    ? (health(entry) === 'ok' ? '' : 'Record it again in Create new → Clone a recording to renew it.')
                    : (entry.designPrompt || '');
                return `
                <div class="cw-voice-mine-row${selected ? ' is-selected' : ''}">
                    <button type="button" class="cw-voice-play" data-voice="${escapeAttr(entry.id)}" data-source="designed"
                        aria-label="Preview ${escapeAttr(entry.label || '')}" title="Preview (says the test line)" ${gone ? 'disabled' : ''}>
                        <i class="fa-solid ${isPlaying(entry.id) ? 'fa-stop' : 'fa-play'}"></i>
                    </button>
                    <div class="cw-voice-mine-main">
                        <span class="cw-voice-name">${escapeHtml(entry.label || 'Custom voice')}</span>
                        <span class="cw-voice-gender">${entry.source === 'cloned' ? 'Cloned' : 'Designed'}${entry.gender ? ` · ${genderWord(entry.gender)}` : ''}</span>
                        ${badge(entry)}
                        ${desc ? `<span class="cw-voice-mine-desc" title="${escapeAttr(desc)}">${escapeHtml(desc)}</span>` : ''}
                        <span class="cw-voice-mine-used">${used ? `Used by ${escapeHtml(used)}` : 'Not used by anyone yet'}</span>
                    </div>
                    <div class="cw-voice-mine-actions">
                        ${(gone || health(entry) === 'expiring') && entry.source !== 'cloned'
                            ? `<button type="button" class="rpg-btn cw-studio-recreate" data-voice="${escapeAttr(entry.id)}" title="Make a fresh copy from its description">Recreate</button>`
                            : ''}
                        ${selected ? '<span class="cw-voice-inuse"><i class="fa-solid fa-check"></i> In use</span>'
                            : `<button type="button" class="rpg-btn cw-studio-use" data-voice="${escapeAttr(entry.id)}" ${gone ? 'disabled' : ''}>Use</button>`}
                    </div>
                </div>`;
            }).join('')}
        </div>
        ${st.error ? `<p class="cw-studio-error">${escapeHtml(st.error)}</p>` : ''}
        <p class="helper">Delete voices you no longer need in Settings → Voices → My custom voices.</p>`;
}

function readForm(host, st) {
    const q = (sel) => host.querySelector(sel);
    if (q('.cw-studio-desc')) st.description = q('.cw-studio-desc').value;
    if (q('.cw-studio-ref-input')) st.reference = q('.cw-studio-ref-input').value;
    if (q('.cw-studio-label')) st.label = q('.cw-studio-label').value;
    if (q('.cw-studio-gender')) st.gender = q('.cw-studio-gender').value;
    if (q('.cw-studio-lang')) st.languageCode = q('.cw-studio-lang').value;
}

function describeError(e) {
    if (!e) return 'Something went wrong.';
    if (e.kind === 'no-key') return e.message;
    if (e.kind === 'bad-key') return 'Google rejected the key in Settings → Voices.';
    if (e.kind === 'quota') return 'Your Google project is out of quota, or already has 200 custom voices. Delete some in Settings → Voices → My custom voices.';
    if (e.kind === 'rate') return 'Google is rate-limiting requests. Wait a moment and try again.';
    return `Google said: ${e.message || e}`;
}

/**
 * Handles a click inside the Design view. Returns true when handled.
 * @param {HTMLElement} target
 * @param {HTMLElement} host
 * @param {object} ctx - the Voice tab context
 * @param {() => void} rerender
 */
export async function handleStudioClick(target, host, ctx, rerender) {
    const st = stateFor(ctx);
    const btn = (sel) => target.closest(sel);

    // Remember whether "More options" is open across re-renders. The click
    // still toggles the <details> itself (not handled → no preventDefault).
    if (btn('.cw-studio-more > summary')) {
        st.moreOpen = !target.closest('.cw-studio-more').open;
        return false;
    }

    if (btn('.cw-studio-draft')) {
        readForm(host, st);
        st.busy = 'draft'; st.error = ''; rerender();
        try {
            const text = await draftDescriptionFromCard({ name: ctx.name, appearance: ctx.card?.appearance, description: ctx.card?.description });
            if (text) st.description = text;
            else st.error = 'Your chat AI returned nothing. Try again, or write the description yourself.';
        } catch (e) {
            st.error = `Couldn't draft a description: ${e?.message || e}`;
        }
        st.busy = ''; rerender();
        return true;
    }

    if (btn('.cw-studio-ref-go')) {
        readForm(host, st);
        const who = st.reference.trim();
        if (!who) { st.error = 'Type the character you have in mind first (for example “Withers from Baldur’s Gate 3”).'; rerender(); return true; }
        st.busy = 'reference'; st.error = ''; rerender();
        try {
            const out = await draftDescriptionFromReference(who);
            if (out.status === 'ok') st.description = out.text;
            else st.error = referenceProblem(out.status, who);
        } catch (e) {
            st.error = `Couldn't describe that voice: ${e?.message || e}`;
        }
        st.busy = ''; rerender();
        return true;
    }

    if (btn('.cw-studio-create') || btn('.cw-studio-again')) {
        readForm(host, st);
        if (!st.description.trim()) { st.error = 'Describe the voice first (or use Draft from card).'; rerender(); return true; }
        if (btn('.cw-studio-again') && st.result) {
            if (!window.confirm('Try again? The voice you just made will be deleted from your Google project.')) return true;
            const old = st.result.entry.id;
            st.result = null;
            try { await deleteDesignedVoice(old); } catch (e) { console.warn('[DES Voices] could not delete the previous draft', e); }
        }
        unlockVoicesAudio();
        st.busy = 'create'; st.error = ''; rerender();
        try {
            st.result = await designVoice({
                description: st.description,
                label: st.label.trim() || `${ctx.name}'s voice`,
                gender: st.gender,
                languageCode: st.languageCode,
            });
            // The new voice reads the description it was made from, so you
            // hear it saying what you asked for (not Google's stock sample).
            (await getEngine()).audition(refFor(st.result.entry), st.result.entry.designPrompt);
        } catch (e) {
            st.error = describeError(e);
        }
        st.busy = ''; rerender();
        return true;
    }

    const readDesc = btn('.cw-studio-read-desc');
    if (readDesc) {
        unlockVoicesAudio();
        const entry = getRegistered(readDesc.getAttribute('data-voice'));
        if (entry) (await getEngine()).audition(refFor(entry), entry.designPrompt || ctx.testLine());
        return true;
    }

    const tryLine = btn('.cw-studio-try-line');
    if (tryLine) {
        unlockVoicesAudio();
        const entry = getRegistered(tryLine.getAttribute('data-voice'));
        if (entry) (await getEngine()).audition(refFor(entry), ctx.testLine());
        return true;
    }

    if (btn('.cw-studio-discard') && st.result) {
        if (!window.confirm('Discard this voice? It will be deleted from your Google project.')) return true;
        const id = st.result.entry.id;
        st.result = null;
        try {
            await deleteDesignedVoice(id);
            if (ctx.voice?.id === id) ctx.onChange(null);
        } catch (e) {
            st.error = describeError(e);
        }
        rerender();
        return true;
    }

    const use = btn('.cw-studio-use');
    if (use) {
        const entry = getRegistered(use.getAttribute('data-voice'));
        if (entry) {
            ctx.onChange(refFor(entry));
            if (st.result && st.result.entry.id === entry.id) st.result = null;
        }
        return true;
    }

    const recreate = btn('.cw-studio-recreate');
    if (recreate) {
        const id = recreate.getAttribute('data-voice');
        if (!window.confirm('Recreate this voice from its description? Google designs a fresh copy (it may sound a little different), every character using it switches over, and the old one is deleted.')) return true;
        st.busy = 'create'; st.error = ''; rerender();
        try {
            const { entry, sample } = await recreateDesignedVoice(id);
            // The open card holds a copy of the old ref; point it at the new voice too.
            if (ctx.voice?.id === id) ctx.onChange(refFor(entry));
            (await getEngine()).audition(refFor(entry), entry.designPrompt);
        } catch (e) {
            st.error = describeError(e);
        }
        st.busy = ''; rerender();
        return true;
    }
    return false;
}

/** Keeps typed text when the pane re-renders. */
export function handleStudioInput(target, ctx) {
    const st = stateFor(ctx);
    if (target.classList.contains('cw-studio-desc')) st.description = target.value;
    else if (target.classList.contains('cw-studio-ref-input')) st.reference = target.value;
    else if (target.classList.contains('cw-studio-label')) st.label = target.value;
    else if (target.classList.contains('cw-studio-gender')) st.gender = target.value;
    else if (target.classList.contains('cw-studio-lang')) st.languageCode = target.value;
}

/** True when a designer operation is running (the pane shows it). */
export function isStudioBusy(name) {
    return !!states.get(name)?.busy;
}
