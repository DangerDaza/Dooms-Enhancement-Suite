/*
 * Doom's Enhancement Suite for SillyTavern — Character Workshop: voice cloning
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
 * The Voice tab's "Clone" view (docs/google-tts-voices-plan.md §8.4): a
 * four-step wizard —
 *   1. rights: the user confirms they own the voice or have the (adult)
 *      speaker's permission;
 *   2. sample: record or upload 10–30 s of clean speech;
 *   3. consent: the same speaker reads Google's statement, verbatim, in one
 *      of Google's 30 locales (consentPhrases.js);
 *   4. name it and create it on Google.
 *
 * Recordings live only in this module's memory: never written to settings,
 * browser storage, SillyTavern files or exports, and dropped when the
 * wizard finishes, is cancelled, or the Workshop closes. Loaded the first
 * time the Clone view is opened.
 */
import { getEngine, unlockVoicesAudio } from '../voices/voiceBoot.js';
import { getDesKey } from '../voices/transport.js';
import { cloneVoice, deleteDesignedVoice, refFor, getRegistered } from '../voices/voiceRegistry.js';
import { CONSENT_PHRASES, consentPhraseFor } from '../voices/consentPhrases.js';
import { prepareClip, canRecord, startRecording } from '../voices/audioPrep.js';
import { escapeHtml, escapeAttr } from '../../utils/html.js';

const MIN_SAMPLE_S = 10;
const MAX_SAMPLE_S = 30;
const MIN_CONSENT_S = 2;
const MAX_CONSENT_S = 30;

/**
 * @typedef {{prep: {duration: number, peak: number, base64: string}, from: 'recording'|'upload'}} Clip
 * @typedef {{step: number, agreed: boolean, sample: Clip|null, consent: Clip|null, locale: string,
 *   label: string, gender: string, recording: {which: string, seconds: number, stop: () => void}|null,
 *   busy: string, error: string, errorStep: number, result: {entry: object}|null}} ClonerState
 */

/** @type {Map<string, ClonerState>} per character, this session only */
const states = new Map();

function fresh(name) {
    return {
        step: 1,
        agreed: false,
        sample: null,
        consent: null,
        locale: 'en-US',
        label: `${name}'s voice`,
        gender: '',
        recording: null,
        busy: '',
        error: '',
        errorStep: 0,
        result: null,
    };
}

function stateFor(ctx) {
    if (!states.has(ctx.name)) states.set(ctx.name, fresh(ctx.name));
    return states.get(ctx.name);
}

/** Drops every recording (Workshop closed). */
export function clearClonerRecordings() {
    for (const st of states.values()) {
        try { st.recording?.stop(); } catch (e) {}
    }
    states.clear();
}

function clipStatus(clip, min, max) {
    if (!clip) return { ok: false, text: '' };
    const d = clip.prep.duration;
    const secs = `${d.toFixed(1)} s`;
    if (d < min) return { ok: false, text: `${secs} — too short, Google needs at least ${min} seconds.` };
    if (d > max + 0.5) return { ok: false, text: `${secs} — too long, keep it under ${max} seconds.` };
    if (clip.prep.peak < 0.02) return { ok: false, text: `${secs} — almost silent. Check the microphone and try again.` };
    return { ok: true, text: `${secs} — good.` };
}

function clipControls(which, st, min, max, isPlaying) {
    const clip = st[which];
    const rec = st.recording && st.recording.which === which ? st.recording : null;
    const status = clipStatus(clip, min, max);
    const recordBtn = canRecord()
        ? (rec
            ? `<button type="button" class="rpg-btn rpg-btn-danger cw-clone-stop" data-which="${which}"><i class="fa-solid fa-stop"></i> Stop (${rec.seconds.toFixed(0)} s)</button>`
            : `<button type="button" class="rpg-btn cw-clone-record" data-which="${which}" ${st.recording || st.busy ? 'disabled' : ''}><i class="fa-solid fa-microphone"></i> ${clip ? 'Record again' : 'Record'}</button>`)
        : '';
    const noMic = canRecord() ? '' : '<p class="helper">Recording needs a secure page (HTTPS or localhost). You can still upload a recording.</p>';
    return `
        <div class="cw-studio-row">
            ${recordBtn}
            <label class="rpg-btn cw-clone-upload-label">
                <i class="fa-solid fa-upload"></i> Upload a file
                <input type="file" class="cw-clone-upload" data-which="${which}" accept="audio/*" hidden ${st.recording || st.busy ? 'disabled' : ''} />
            </label>
            ${clip ? `<button type="button" class="rpg-btn cw-clone-play" data-which="${which}"><i class="fa-solid ${isPlaying(`clip:${which}`) ? 'fa-stop' : 'fa-play'}"></i> Listen</button>` : ''}
        </div>
        ${noMic}
        ${st.busy === `prep-${which}` ? '<p class="helper">Processing the recording…</p>' : ''}
        ${status.text ? `<p class="cw-clone-status ${status.ok ? 'is-ok' : 'is-bad'}">${escapeHtml(status.text)}</p>` : ''}`;
}

/** HTML for the Clone view. */
export function renderCloner(ctx, isPlaying) {
    if (!getDesKey()) {
        return `
            <div class="cw-voice-locked">
                <p><strong>Cloning a voice needs your Google AI Studio key.</strong></p>
                <p class="helper">Paste it in <strong>Settings → Voices → Google AI Studio key</strong>. SillyTavern has no way to clone voices, so DES talks to Google directly for this.</p>
            </div>`;
    }
    const st = stateFor(ctx);
    const steps = ['Permission', 'Voice sample', 'Consent', 'Create'];
    const header = `
        <ol class="cw-clone-steps">
            ${steps.map((label, i) => `<li class="${st.step === i + 1 ? 'is-current' : st.step > i + 1 ? 'is-done' : ''}">${i + 1}. ${label}</li>`).join('')}
        </ol>`;
    const cancel = st.step > 1 || st.sample || st.consent
        ? '<button type="button" class="rpg-btn cw-clone-cancel">Start over</button>' : '';
    const error = st.error ? `<p class="cw-studio-error">${escapeHtml(st.error)}</p>` : '';
    let body = '';

    if (st.result) {
        const entry = getRegistered(st.result.entry.id) || st.result.entry;
        body = `
            <div class="cw-voice-result">
                <div class="cw-voice-result-head"><strong>${escapeHtml(entry.label)}</strong> <span class="cw-voice-gender">Cloned</span></div>
                <div class="cw-voice-result-actions">
                    <button type="button" class="rpg-btn cw-clone-try" data-voice="${escapeAttr(entry.id)}"><i class="fa-solid fa-play"></i> Test line</button>
                    <button type="button" class="rpg-btn rpg-btn-primary cw-studio-use" data-voice="${escapeAttr(entry.id)}">Use this voice</button>
                    <button type="button" class="rpg-btn rpg-btn-danger cw-clone-discard">Discard</button>
                </div>
                <p class="helper">The voice is saved in your Google project now. It's attached to ${escapeHtml(ctx.name)} when you press <strong>Save</strong>. The recordings have been thrown away.</p>
            </div>`;
        return header + body + error;
    }

    if (st.step === 1) {
        body = `
            <div class="cw-clone-rights">
                <p><strong>Only clone your own voice, or the voice of an adult who is recording with you and agrees to it.</strong></p>
                <p class="helper">You'll record two clips of the same person: a 10–30 second sample of them talking, and them reading Google's consent statement. Google checks that the consent recording matches the sample; DES can't check who is speaking. Voice cloning may not be available in every region.</p>
                <p class="helper">The recordings are sent to Google once, to make the voice, and are never saved by DES — if you lose the voice, you'll need to record again.</p>
                <label class="cw-clone-agree"><input type="checkbox" class="cw-clone-agree-box" ${st.agreed ? 'checked' : ''} /> This is my voice, or I have the speaker's permission and they're an adult.</label>
            </div>
            <div class="cw-studio-row">
                <button type="button" class="rpg-btn rpg-btn-primary cw-clone-next" data-to="2" ${st.agreed ? '' : 'disabled'}>Continue</button>
            </div>`;
    } else if (st.step === 2) {
        const ok = clipStatus(st.sample, MIN_SAMPLE_S, MAX_SAMPLE_S).ok;
        body = `
            <p class="helper"><strong>Record 10–30 seconds of the speaker talking naturally</strong> — read a paragraph from a book, or describe your day. Use a quiet room, no music, one voice. Use the same microphone and room for the next step.</p>
            ${clipControls('sample', st, MIN_SAMPLE_S, MAX_SAMPLE_S, isPlaying)}
            <div class="cw-studio-row">
                <button type="button" class="rpg-btn cw-clone-next" data-to="1">Back</button>
                <button type="button" class="rpg-btn rpg-btn-primary cw-clone-next" data-to="3" ${ok && !st.recording ? '' : 'disabled'}>Continue</button>
                ${cancel}
            </div>`;
    } else if (st.step === 3) {
        const phrase = consentPhraseFor(st.locale);
        const ok = clipStatus(st.consent, MIN_CONSENT_S, MAX_CONSENT_S).ok;
        body = `
            <label class="cw-studio-field">
                <span>Language of the statement</span>
                <select class="rpg-accordion-select cw-clone-locale">
                    ${CONSENT_PHRASES.map(p => `<option value="${p.locale}"${p.locale === st.locale ? ' selected' : ''}>${escapeHtml(p.language)}</option>`).join('')}
                </select>
            </label>
            <p class="helper">The same person reads this aloud, word for word:</p>
            <blockquote class="cw-clone-phrase" lang="${escapeAttr(phrase.locale)}">${escapeHtml(phrase.text)}</blockquote>
            ${clipControls('consent', st, MIN_CONSENT_S, MAX_CONSENT_S, isPlaying)}
            <div class="cw-studio-row">
                <button type="button" class="rpg-btn cw-clone-next" data-to="2">Back</button>
                <button type="button" class="rpg-btn rpg-btn-primary cw-clone-next" data-to="4" ${ok && !st.recording ? '' : 'disabled'}>Continue</button>
                ${cancel}
            </div>`;
    } else {
        body = `
            <div class="cw-studio-grid">
                <label class="cw-studio-field">
                    <span>Name</span>
                    <input type="text" class="rpg-input cw-clone-label" maxlength="60" value="${escapeAttr(st.label)}" />
                </label>
                <label class="cw-studio-field">
                    <span>The voice sounds</span>
                    <select class="rpg-accordion-select cw-clone-gender">
                        <option value=""${st.gender === '' ? ' selected' : ''}>Not sure</option>
                        <option value="female"${st.gender === 'female' ? ' selected' : ''}>Female</option>
                        <option value="male"${st.gender === 'male' ? ' selected' : ''}>Male</option>
                    </select>
                </label>
            </div>
            <p class="helper">Used to pick a similar standard voice if this one can't be played. Sample: ${st.sample.prep.duration.toFixed(1)} s · consent: ${st.consent.prep.duration.toFixed(1)} s (${escapeHtml(consentPhraseFor(st.locale).language)}).</p>
            <div class="cw-studio-row">
                <button type="button" class="rpg-btn cw-clone-next" data-to="3">Back</button>
                <button type="button" class="rpg-btn rpg-btn-primary cw-clone-create" ${st.busy ? 'disabled' : ''}>${st.busy === 'create' ? 'Creating… (this can take a little while)' : 'Create voice'}</button>
                ${cancel}
            </div>
            <p class="helper">Uses one of your Google project's 200 custom-voice slots until it's deleted.</p>
            ${st.error && st.errorStep ? `<div class="cw-studio-row">
                <button type="button" class="rpg-btn cw-clone-next" data-to="3">Re-record consent</button>
                <button type="button" class="rpg-btn cw-clone-next" data-to="2">Re-record sample</button>
            </div>` : ''}`;
    }
    return header + body + error;
}

function describeError(e) {
    if (!e) return 'Something went wrong.';
    if (e.kind === 'no-key') return e.message;
    if (e.kind === 'bad-key') return 'Google rejected the key in Settings → Voices.';
    if (e.kind === 'quota') return 'Your Google project is out of quota, or already has 200 custom voices. Delete some in Settings → Voices → My custom voices.';
    if (e.kind === 'rate') return 'Google is rate-limiting requests. Wait a moment and try again.';
    return `Google didn't accept the recordings: ${e.message || e}. Check that the same person reads the statement exactly, in the same room and on the same microphone as the sample.`;
}

async function acceptClip(st, which, blob, from, rerender) {
    st.busy = `prep-${which}`; st.error = ''; rerender();
    try {
        const prep = await prepareClip(blob);
        st[which] = { prep, from };
    } catch (e) {
        st.error = e?.message || String(e);
    }
    st.busy = ''; rerender();
}

/** Handles a click inside the Clone view. Returns true when handled. */
export async function handleClonerClick(target, host, ctx, rerender, isPlaying) {
    const st = stateFor(ctx);
    const btn = (sel) => target.closest(sel);

    const next = btn('.cw-clone-next');
    if (next) {
        const to = Number(next.getAttribute('data-to'));
        if (to >= 1 && to <= 4) { st.step = to; st.error = ''; st.errorStep = 0; }
        rerender();
        return true;
    }
    if (btn('.cw-clone-cancel')) {
        try { st.recording?.stop(); } catch (e) {}
        states.set(ctx.name, fresh(ctx.name));
        rerender();
        return true;
    }
    const record = btn('.cw-clone-record');
    if (record) {
        const which = record.getAttribute('data-which');
        unlockVoicesAudio();
        st.error = '';
        try {
            const max = which === 'sample' ? MAX_SAMPLE_S : MAX_CONSENT_S;
            const handle = await startRecording({
                maxSeconds: max,
                onTick: (seconds) => {
                    if (!st.recording) return;
                    st.recording.seconds = seconds;
                    const b = host.querySelector('.cw-clone-stop');
                    if (b) b.innerHTML = `<i class="fa-solid fa-stop"></i> Stop (${seconds.toFixed(0)} s)`;
                },
                onStop: (blob) => {
                    st.recording = null;
                    acceptClip(st, which, blob, 'recording', rerender);
                },
            });
            st.recording = { which, seconds: 0, stop: handle.stop };
        } catch (e) {
            st.recording = null;
            st.error = e?.name === 'NotAllowedError'
                ? 'The browser wasn’t allowed to use the microphone. Allow it for this site, or upload a recording.'
                : `Couldn't start recording: ${e?.message || e}`;
        }
        rerender();
        return true;
    }
    if (btn('.cw-clone-stop')) {
        st.recording?.stop();
        return true;
    }
    const play = btn('.cw-clone-play');
    if (play) {
        const which = play.getAttribute('data-which');
        const clip = st[which];
        if (clip) {
            unlockVoicesAudio();
            (await getEngine()).playSample(`clip:${which}`, { mimeType: 'audio/wav', data: clip.prep.base64 });
            rerender();
        }
        return true;
    }
    if (btn('.cw-clone-create')) {
        if (!st.sample || !st.consent) return true;
        st.busy = 'create'; st.error = ''; st.errorStep = 0; rerender();
        try {
            const { entry } = await cloneVoice({
                label: st.label.trim() || `${ctx.name}'s voice`,
                gender: st.gender,
                locale: st.locale,
                sourceBase64: st.sample.prep.base64,
                consentBase64: st.consent.prep.base64,
            });
            // Recordings are released as soon as Google has them.
            st.sample = null;
            st.consent = null;
            st.result = { entry };
        } catch (e) {
            st.error = describeError(e);
            st.errorStep = 4;
        }
        st.busy = ''; rerender();
        return true;
    }
    const tryBtn = btn('.cw-clone-try');
    if (tryBtn) {
        unlockVoicesAudio();
        const entry = getRegistered(tryBtn.getAttribute('data-voice'));
        if (entry) (await getEngine()).audition(refFor(entry), ctx.testLine());
        return true;
    }
    if (btn('.cw-clone-discard') && st.result) {
        if (!window.confirm('Discard this cloned voice? It will be deleted from your Google project.')) return true;
        const id = st.result.entry.id;
        try {
            await deleteDesignedVoice(id);
            if (ctx.voice?.id === id) ctx.onChange(null);
            states.set(ctx.name, fresh(ctx.name));
        } catch (e) {
            st.error = describeError(e);
        }
        rerender();
        return true;
    }
    const use = btn('.cw-studio-use');
    if (use && st.result) {
        const entry = getRegistered(use.getAttribute('data-voice'));
        if (entry) {
            ctx.onChange(refFor(entry));
            states.set(ctx.name, fresh(ctx.name));
        }
        return true;
    }
    return false;
}

/** Inputs and selects inside the Clone view. */
export function handleClonerInput(target, ctx, rerender) {
    const st = stateFor(ctx);
    if (target.classList.contains('cw-clone-agree-box')) { st.agreed = target.checked; rerender(); return; }
    if (target.classList.contains('cw-clone-locale')) { st.locale = target.value; rerender(); return; }
    if (target.classList.contains('cw-clone-label')) { st.label = target.value; return; }
    if (target.classList.contains('cw-clone-gender')) { st.gender = target.value; return; }
    if (target.classList.contains('cw-clone-upload') && target.files && target.files[0]) {
        const which = target.getAttribute('data-which');
        const file = target.files[0];
        target.value = '';
        acceptClip(st, which, file, 'upload', rerender);
    }
}
