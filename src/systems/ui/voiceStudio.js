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
} from '../voices/voiceRegistry.js';
import { escapeHtml, escapeAttr } from '../../utils/html.js';

/** Accents Google's voice design understands as a language code (optional). */
const LANGUAGES = [
    ['', 'Any / from the description'],
    ['en-US', 'English (US)'],
    ['en-GB', 'English (UK)'],
    ['en-AU', 'English (Australia)'],
    ['en-IN', 'English (India)'],
    ['es-ES', 'Spanish (Spain)'],
    ['es-MX', 'Spanish (Mexico)'],
    ['fr-FR', 'French (France)'],
    ['fr-CA', 'French (Canada)'],
    ['de-DE', 'German'],
    ['it-IT', 'Italian'],
    ['pt-BR', 'Portuguese (Brazil)'],
    ['ja-JP', 'Japanese'],
    ['ko-KR', 'Korean'],
];

/**
 * Per-character designer state (this session only).
 * @type {Map<string, {description: string, gender: string, languageCode: string, label: string,
 *   busy: string, error: string, result: {entry: object, sample: object|null}|null}>}
 */
const states = new Map();

function stateFor(ctx) {
    if (!states.has(ctx.name)) {
        states.set(ctx.name, {
            description: ctx.voice?.pendingDesign || '',
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

/** HTML for the Design view. */
export function renderStudio(ctx, isPlaying) {
    const st = stateFor(ctx);
    const hasKey = !!getDesKey();
    const currentId = ctx.voice && ctx.voice.source === 'designed' ? ctx.voice.id : null;

    if (!hasKey) {
        return `
            <div class="cw-voice-locked">
                <p><strong>Designing voices needs your Google AI Studio key.</strong></p>
                <p class="helper">Paste it in <strong>Settings → Voices → Google AI Studio key</strong>. SillyTavern has no way to design voices, so DES talks to Google directly for this.</p>
            </div>`;
    }

    const pending = ctx.voice && !ctx.voice.id && ctx.voice.pendingDesign
        ? `<p class="helper cw-voice-pending">This character was imported with a designed voice that doesn't exist in your Google project yet. The description is filled in below &mdash; press <strong>Create voice</strong> to make it.</p>`
        : '';

    const result = st.result;
    const resultHtml = result ? `
        <div class="cw-voice-result">
            <div class="cw-voice-result-head">
                <strong>${escapeHtml(result.entry.label)}</strong>
                ${result.entry.gender ? `<span class="cw-voice-gender">${genderWord(result.entry.gender)}</span>` : ''}
            </div>
            <div class="cw-voice-result-actions">
                ${result.sample ? `<button type="button" class="rpg-btn cw-studio-sample"><i class="fa-solid ${isPlaying(`sample:${result.entry.id}`) ? 'fa-stop' : 'fa-play'}"></i> Google's sample</button>` : ''}
                <button type="button" class="rpg-btn cw-studio-try-line" data-voice="${escapeAttr(result.entry.id)}"><i class="fa-solid fa-play"></i> Test line</button>
                <button type="button" class="rpg-btn rpg-btn-primary cw-studio-use" data-voice="${escapeAttr(result.entry.id)}">Use this voice</button>
                <button type="button" class="rpg-btn cw-studio-again">Try again</button>
                <button type="button" class="rpg-btn rpg-btn-danger cw-studio-discard">Discard</button>
            </div>
            <p class="helper">The voice is saved in your Google project now. It's attached to ${escapeHtml(ctx.name)} when you press <strong>Save</strong>.</p>
        </div>` : '';

    const mine = listRegistered();
    const mineHtml = mine.length ? `
        <h4 class="cw-voice-subhead">Your designed voices</h4>
        <div class="cw-voice-mine">
            ${mine.map((entry) => {
                const selected = entry.id === currentId;
                const gone = health(entry) === 'gone';
                const used = usedByText(entry.id);
                return `
                <div class="cw-voice-mine-row${selected ? ' is-selected' : ''}">
                    <div class="cw-voice-mine-main">
                        <span class="cw-voice-name">${escapeHtml(entry.label || 'Designed voice')}</span>
                        ${entry.gender ? `<span class="cw-voice-gender">${genderWord(entry.gender)}</span>` : ''}
                        ${badge(entry)}
                        <span class="cw-voice-mine-desc">${escapeHtml(entry.designPrompt || '')}</span>
                        <span class="cw-voice-mine-used">${used ? `Used by ${escapeHtml(used)}` : 'Not used by anyone yet'}</span>
                    </div>
                    <div class="cw-voice-mine-actions">
                        <button type="button" class="cw-voice-play" data-voice="${escapeAttr(entry.id)}" data-source="designed"
                            aria-label="Preview ${escapeAttr(entry.label || '')}" title="Preview" ${gone ? 'disabled' : ''}>
                            <i class="fa-solid ${isPlaying(entry.id) ? 'fa-stop' : 'fa-play'}"></i>
                        </button>
                        ${gone || health(entry) === 'expiring'
                            ? `<button type="button" class="rpg-btn cw-studio-recreate" data-voice="${escapeAttr(entry.id)}">Recreate</button>`
                            : ''}
                        ${selected ? '<span class="cw-voice-inuse">In use</span>'
                            : `<button type="button" class="rpg-btn cw-studio-use" data-voice="${escapeAttr(entry.id)}" ${gone ? 'disabled' : ''}>Use for ${escapeHtml(ctx.name)}</button>`}
                    </div>
                </div>`;
            }).join('')}
        </div>` : '';

    const busy = st.busy;
    return `
        ${pending}
        <div class="cw-studio-form">
            <label class="cw-studio-field">
                <span>Describe the voice</span>
                <textarea class="rpg-textarea cw-studio-desc" rows="3" maxlength="600"
                    placeholder="e.g. A husky, low-pitched woman in her forties with a slow Southern drawl and a wry, tired warmth.">${escapeHtml(st.description)}</textarea>
            </label>
            <div class="cw-studio-row">
                <button type="button" class="rpg-btn cw-studio-draft" ${busy ? 'disabled' : ''}>
                    <i class="fa-solid fa-wand-magic-sparkles"></i> ${busy === 'draft' ? 'Drafting…' : 'Draft from card'}
                </button>
                <span class="helper">Asks your chat AI to describe ${escapeHtml(ctx.name)}'s voice from their appearance and description. You can edit it before creating.</span>
            </div>
            <p class="helper">Best results: one or two sentences covering age, gender, pitch, texture and accent. Don't name real people.</p>
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
                        ${LANGUAGES.map(([code, label]) => `<option value="${code}"${st.languageCode === code ? ' selected' : ''}>${escapeHtml(label)}</option>`).join('')}
                    </select>
                </label>
            </div>
            <div class="cw-studio-row">
                <button type="button" class="rpg-btn rpg-btn-primary cw-studio-create" ${busy || result ? 'disabled' : ''}>
                    ${busy === 'create' ? 'Creating… (this can take a little while)' : 'Create voice'}
                </button>
                <span class="helper">Each voice uses one of your Google project's 200 custom-voice slots until it's deleted. Discard ones you don't keep.</span>
            </div>
            ${st.error ? `<p class="cw-studio-error">${escapeHtml(st.error)}</p>` : ''}
        </div>
        ${resultHtml}
        ${mineHtml}
    `;
}

function readForm(host, st) {
    const q = (sel) => host.querySelector(sel);
    if (q('.cw-studio-desc')) st.description = q('.cw-studio-desc').value;
    if (q('.cw-studio-label')) st.label = q('.cw-studio-label').value;
    if (q('.cw-studio-gender')) st.gender = q('.cw-studio-gender').value;
    if (q('.cw-studio-lang')) st.languageCode = q('.cw-studio-lang').value;
}

function describeError(e) {
    if (!e) return 'Something went wrong.';
    if (e.kind === 'no-key') return e.message;
    if (e.kind === 'bad-key') return 'Google rejected the key in Settings → Voices.';
    if (e.kind === 'quota') return 'Your Google project is out of quota, or already has 200 custom voices. Delete some in Settings → Voices → My designed voices.';
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
            if (st.result.sample) (await getEngine()).playSample(`sample:${st.result.entry.id}`, st.result.sample);
        } catch (e) {
            st.error = describeError(e);
        }
        st.busy = ''; rerender();
        return true;
    }

    if (btn('.cw-studio-sample') && st.result?.sample) {
        unlockVoicesAudio();
        (await getEngine()).playSample(`sample:${st.result.entry.id}`, st.result.sample);
        rerender();
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
            if (sample) (await getEngine()).playSample(`sample:${entry.id}`, sample);
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
    else if (target.classList.contains('cw-studio-label')) st.label = target.value;
    else if (target.classList.contains('cw-studio-gender')) st.gender = target.value;
    else if (target.classList.contains('cw-studio-lang')) st.languageCode = target.value;
}

/** True when a designer operation is running (the pane shows it). */
export function isStudioBusy(name) {
    return !!states.get(name)?.busy;
}
