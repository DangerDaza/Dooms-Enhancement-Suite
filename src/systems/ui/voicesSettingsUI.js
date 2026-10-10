/*
 * Doom's Enhancement Suite for SillyTavern — Voices settings
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
 * Binds the Settings → Voices accordion (template.html). Loaded with the
 * rest of the deferred settings UI.
 */
import { extensionSettings } from '../../core/state.js';
import { saveSettings } from '../../core/persistence.js';
import { STOCK_VOICES, stockLabel, stockRef, canonicalStockId, DESIGN_LANGUAGES } from '../voices/voiceCatalog.js';
import { VOICE_MODELS, NARRATOR_FALLBACK_VOICE, DEFAULT_NARRATOR_DESIGN, isValidVoiceRef, clampSteadiness } from '../voices/voiceSettings.js';
import { syncVoicesState, getEngine, getEngineIfLoaded, unlockVoicesAudio } from '../voices/voiceBoot.js';
import {
    listRegistered,
    getRegistered,
    refFor,
    health,
    daysLeft,
    usedByText,
    deleteDesignedVoice,
    recreateDesignedVoice,
    renameRegistered,
    designVoice,
    draftDescriptionFromReference,
} from '../voices/voiceRegistry.js';
import { referenceProblem } from '../voices/drafts.js';
import { DEFAULT_DELIVERY_NOTE } from '../voices/delivery.js';
import { secret_state } from '../../../../../../secrets.js';
import { isOpenRouterConnected, anyConnected, ST_SECRET, stHasSecret } from '../voices/connections.js';
import { voiceRefCount } from '../lorebook/campaignProfiles.js';
import { escapeHtml } from '../../utils/html.js';

let bound = false;

function v() {
    return extensionSettings.voices;
}

/** The Narrator dropdown's value: a stock name, or "designed:<id>". */
function narratorValue() {
    const n = v().narratorVoice;
    if (n && n.source === 'designed' && getRegistered(n.id)) return `designed:${n.id}`;
    return canonicalStockId(n?.id) || NARRATOR_FALLBACK_VOICE;
}

function narratorRef() {
    const value = narratorValue();
    if (value.startsWith('designed:')) {
        const entry = getRegistered(value.slice('designed:'.length));
        if (entry) return refFor(entry);
    }
    return stockRef(value);
}

function fillNarratorOptions() {
    const $narrator = $('#rpg-voices-narrator');
    if (!$narrator.length) return;
    const stock = STOCK_VOICES.map(voice =>
        `<option value="${escapeHtml(voice.id)}">${escapeHtml(stockLabel(voice.id))} · ${voice.gender === 'female' ? 'Female' : 'Male'}</option>`).join('');
    const designed = listRegistered().filter(e => health(e) !== 'gone');
    $narrator.html(designed.length
        ? `<optgroup label="Standard voices">${stock}</optgroup><optgroup label="Your custom voices">${designed.map(e =>
            `<option value="designed:${escapeHtml(e.id)}">${escapeHtml(e.label || 'Designed voice')}</option>`).join('')}</optgroup>`
        : stock);
    $narrator.val(narratorValue());
}

// ─── My custom voices (designed + cloned) ─────────────────────────────────────────────────────

function renderDesigned() {
    const $host = $('#rpg-voices-designed');
    if (!$host.length) return;
    const entries = listRegistered();
    if (!entries.length) {
        $host.html('<p class="rpg-note-text">None yet.</p>');
        $('#rpg-voices-remove-unused').prop('hidden', true);
        return;
    }
    const engine = getEngineIfLoaded();
    $host.html(entries.map((e) => {
        const h = health(e);
        const d = daysLeft(e);
        const badge = h === 'gone' ? '<span class="rpg-voices-badge is-gone">No longer on Google</span>'
            : h === 'expiring' ? `<span class="rpg-voices-badge is-expiring">Expires in ${Math.max(0, d)} day${d === 1 ? '' : 's'}</span>` : '';
        const used = usedByText(e.id);
        const playing = engine && engine.isAuditioning(e.id);
        return `
            <div class="rpg-voices-designed-row" data-voice="${escapeHtml(e.id)}">
                <div class="rpg-voices-designed-main">
                    <span class="rpg-voices-designed-name">${escapeHtml(e.label || 'Custom voice')} <span class="rpg-voices-designed-meta">· ${e.source === 'cloned' ? 'Cloned' : 'Designed'}${e.gender ? ` · ${e.gender === 'female' ? 'Female' : 'Male'}` : ''}</span> ${badge}</span>
                    <span class="rpg-voices-designed-meta">${used ? `Used by ${escapeHtml(used)}` : 'Not used by anyone'}</span>
                    <span class="rpg-voices-designed-meta">${escapeHtml(e.source === 'cloned'
                        ? (h === 'ok' ? '' : 'Record it again in the Workshop (Voice → Clone a voice) to renew it.')
                        : (e.designPrompt || ''))}</span>
                </div>
                <div class="rpg-voices-designed-buttons">
                    <button type="button" class="rpg-accordion-mini-btn rpg-voices-designed-play" title="Preview" ${h === 'gone' ? 'disabled' : ''}>
                        <i class="fa-solid ${playing ? 'fa-stop' : 'fa-play'}"></i>
                    </button>
                    <button type="button" class="rpg-accordion-mini-btn rpg-voices-designed-rename" title="Rename"><i class="fa-solid fa-pen"></i></button>
                    ${h !== 'ok' && e.source !== 'cloned' ? '<button type="button" class="rpg-accordion-mini-btn rpg-voices-designed-recreate" title="Design a fresh copy from its description">Recreate</button>' : ''}
                    <button type="button" class="rpg-accordion-mini-btn rpg-voices-designed-delete" title="Delete from Google"><i class="fa-solid fa-trash"></i></button>
                </div>
            </div>`;
    }).join(''));
    const unused = entries.filter(e => voiceRefCount(e.id) === 0).length;
    $('#rpg-voices-remove-unused').prop('hidden', unused === 0).html(`<i class="fa-solid fa-broom"></i> Remove unused voices (${unused})`);
}

async function withBusy($btn, fn) {
    const html = $btn.html();
    $btn.prop('disabled', true);
    try {
        await fn();
    } catch (e) {
        const msg = e?.kind === 'no-key' ? e.message
            : e?.kind === 'bad-key' ? 'Google rejected the key above.'
            : `Google said: ${e?.message || e}`;
        try { window.toastr?.warning(msg, 'DES Voices', { timeOut: 7000 }); } catch (err) {}
    } finally {
        $btn.prop('disabled', false).html(html);
        renderDesigned();
        fillNarratorOptions();
    }
}

function bindDesigned() {
    $(document).on('click', '#rpg-voices-designed .rpg-voices-designed-play', async function () {
        unlockVoicesAudio();
        const id = $(this).closest('.rpg-voices-designed-row').attr('data-voice');
        const entry = getRegistered(id);
        if (!entry) return;
        (await getEngine()).audition(refFor(entry), 'This is how I sound when I read your story.');
    });
    $(document).on('click', '#rpg-voices-designed .rpg-voices-designed-rename', function () {
        const id = $(this).closest('.rpg-voices-designed-row').attr('data-voice');
        const entry = getRegistered(id);
        if (!entry) return;
        const answer = window.prompt('Rename this voice', entry.label || '');
        if (answer === null) return;
        const next = String(answer).replace(/\s+/g, ' ').trim();
        if (!next) {
            try { window.toastr?.info('A voice needs a name.', 'DES Voices'); } catch (e) {}
            return;
        }
        // The registry event re-renders this list, the narrator picker and the
        // Workshop's My voices list.
        renameRegistered(id, next);
    });
    $(document).on('click', '#rpg-voices-designed .rpg-voices-designed-delete', function () {
        const id = $(this).closest('.rpg-voices-designed-row').attr('data-voice');
        const entry = getRegistered(id);
        if (!entry) return;
        const used = usedByText(id);
        const ok = window.confirm(used
            ? `Delete "${entry.label}" from your Google project?\n\nIt's used by ${used}. They'll go back to the Narrator voice (the Narrator goes back to Charon).`
            : `Delete "${entry.label}" from your Google project?`);
        if (!ok) return;
        withBusy($(this), () => deleteDesignedVoice(id));
    });
    $(document).on('click', '#rpg-voices-designed .rpg-voices-designed-recreate', function () {
        const id = $(this).closest('.rpg-voices-designed-row').attr('data-voice');
        if (!window.confirm('Recreate this voice from its description? Google designs a fresh copy (it may sound a little different), everyone using it switches over, and the old one is deleted.')) return;
        withBusy($(this), () => recreateDesignedVoice(id));
    });
    $('#rpg-voices-remove-unused').on('click', function () {
        const unused = listRegistered().filter(e => voiceRefCount(e.id) === 0);
        if (!unused.length) return;
        if (!window.confirm(`Delete ${unused.length} designed voice${unused.length === 1 ? '' : 's'} nobody uses from your Google project?\n\n${unused.map(e => `• ${e.label}`).join('\n')}`)) return;
        withBusy($(this), async () => {
            for (const e of unused) await deleteDesignedVoice(e.id);
        });
    });
    $('#rpg-voices-count-slots').on('click', function () {
        withBusy($(this), async () => {
            const { listCustomVoices, CUSTOM_VOICE_LIMIT } = await import('../voices/voicesApi.js');
            const all = await listCustomVoices();
            const known = new Set(listRegistered().map(e => e.id));
            const outside = all.filter(x => !known.has(x.id)).length;
            $('#rpg-voices-slots').text(`${all.length} of ${CUSTOM_VOICE_LIMIT} custom voice slots used in your Google project` +
                (outside ? ` (${outside} made outside DES).` : '.'));
        });
    });
    document.addEventListener('dooms:voices-registry', () => { renderDesigned(); fillNarratorOptions(); });
    document.addEventListener('dooms:voices-state', () => {
        const engine = getEngineIfLoaded();
        $('#rpg-voices-designed .rpg-voices-designed-row').each(function () {
            const playing = engine && engine.isAuditioning($(this).attr('data-voice'));
            $(this).find('.rpg-voices-designed-play i').attr('class', `fa-solid ${playing ? 'fa-stop' : 'fa-play'}`);
        });
    });
}

function renderStatus() {
    const $status = $('#rpg-voices-status');
    if (!$status.length) return;
    const voicesOn = !!v().enabled;
    $('#rpg-voices-badge').text(voicesOn ? 'on' : 'off');
    const engine = getEngineIfLoaded();
    const parts = [];
    if (!anyConnected(v(), secret_state)) {
        parts.push('No voice service connected yet. Add an OpenRouter or Google key under Connections.');
    }
    if (!voicesOn) {
        parts.push('DES voices are off. The bullhorn buttons use SillyTavern’s own TTS.');
    } else if (!engine) {
        parts.push('Ready. Nothing has been read yet this session.');
    } else {
        const st = engine.getStatus();
        const route = st.route;
        if (st.geminiVia === 'openrouter') {
            const or = st.openrouter || {};
            parts.push(or.lastRoute === 'server'
                ? 'Standard voices: OpenRouter, through SillyTavern’s server (no delivery note).'
                : or.lastRoute === 'browser' ? 'Standard voices: OpenRouter, from the browser.' : 'Standard voices: OpenRouter.');
            if (or.browserBlocked && !or.serverReady) parts.push('The browser couldn’t reach OpenRouter; press Save key to SillyTavern.');
            if (or.styleRejected) parts.push('OpenRouter refused the delivery note this session.');
        }
        if (st.geminiVia === 'google') {
            parts.push(route.route === 'direct' || (!route.route && v().googleApiKey)
                ? 'Using the key above, directly with Google.'
                : 'Using the Google key saved in SillyTavern.');
            if (route.status === 'ok') {
                const chosen = v().model;
                const used = route.effectiveModel;
                parts.push(used && used !== chosen
                    ? (route.route === 'direct'
                        ? `Google didn’t accept ${chosen} with this key, so voices use ${used}.`
                        : `Your SillyTavern can’t send ${chosen} yet, so voices use ${used}. Paste a key above to call Google directly.`)
                    : `${used || chosen}: working.`);
            } else if (route.status === 'no-key') {
                parts.push('No Google key found. Paste one above, or add one in SillyTavern under API Connections → Google AI Studio.');
            } else if (route.status === 'bad-key') {
                parts.push(route.route === 'direct' ? 'Google rejected the key above.' : 'Google rejected the key saved in SillyTavern.');
            } else if (route.status === 'error') {
                parts.push(`Last request failed: ${route.lastError}`);
            } else {
                parts.push('Ready.');
            }
            if (route.temperatureRejected) parts.push('Google refused the Steadiness temperature this session, so lines go without it.');
        } else if (st.connected?.google) {
            parts.push('Designed and cloned voices: Google.');
        }
        parts.push(`${st.requests} request${st.requests === 1 ? '' : 's'} this session.`);
        if (st.autoReadPaused) parts.push('Auto-read is paused.');
        $('#rpg-voices-resume').prop('hidden', !st.autoReadPaused);
    }
    if (voicesOn && !extensionSettings.enableDialogueColoring) {
        parts.push('Dialogue colouring is off, so DES can’t tell who is speaking — everything will be read by the Narrator.');
    }
    $status.text(parts.join(' '));
}

/** The note under the OpenRouter box: what the server route needs right now. */
function renderOpenRouterNote() {
    const $note = $('#rpg-voices-or-note');
    if (!$note.length) return;
    const saved = stHasSecret(secret_state, ST_SECRET.customTts);
    const route = v().openrouterRoute || 'auto';
    if (route === 'server' && !saved) {
        $note.html('Through SillyTavern’s server only: press <strong>Save key to SillyTavern</strong> first. The delivery note can’t be sent this way.');
    } else if (route === 'server') {
        $note.text('Through SillyTavern’s server, with the key saved there. The delivery note can’t be sent this way.');
    } else {
        $note.html(`Automatic: from the browser, and if your browser can’t reach OpenRouter, through SillyTavern’s server instead${saved ? ' (a key is already saved there).' : '. For that, press <strong>Save key to SillyTavern</strong> once.'} The delivery note only works from the browser.`);
    }
}

async function resetOpenRouter() {
    try {
        const { resetOpenRouterState } = await import('../voices/openrouter.js');
        resetOpenRouterState();
    } catch (e) { /* engine not loaded yet */ }
}

/** Saves the OpenRouter key box (trimmed). */
async function saveOpenRouterKey(value) {
    const key = String(value || '').trim();
    if (key === (v().openrouterKey || '')) return;
    v().openrouterKey = key;
    saveSettings();
    await resetOpenRouter();
    renderStatus();
}

/** Saves the Google key box (trimmed). Called on change/blur, not per keystroke. */
async function saveKey(value) {
    const key = String(value || '').trim();
    if (key === (v().googleApiKey || '')) return;
    v().googleApiKey = key;
    saveSettings();
    try {
        const { clearRouteProbe } = await import('../voices/transport.js');
        clearRouteProbe();
    } catch (e) { /* engine not loaded yet */ }
    renderStatus();
}

// ─── Design a narrator voice ────────────────────────────────────────────────

/** What a newly designed narrator reads first: a storyteller's opening. */
const NARRATOR_SAMPLE = 'Gather close, and mind the fire. This tale is older than the road outside, '
    + 'and it begins, as the best of them do, with a knock at the door on a night when no one should have been travelling.';

/** The voice made in this box this session, and the Narrator it replaced (for Undo). */
let ndLast = null;
let ndBusy = false;

function nd() {
    if (!v().narratorDesign || typeof v().narratorDesign !== 'object') v().narratorDesign = { ...DEFAULT_NARRATOR_DESIGN };
    return v().narratorDesign;
}

function fillNarratorDesign() {
    const d = nd();
    $('#rpg-voices-nd-lang').html(DESIGN_LANGUAGES.map(([code, label]) =>
        `<option value="${escapeHtml(code)}">${escapeHtml(label)}</option>`).join(''));
    $('#rpg-voices-nd-desc').val(d.description);
    $('#rpg-voices-nd-label').val(d.label);
    $('#rpg-voices-nd-gender').val(d.gender);
    $('#rpg-voices-nd-lang').val(d.languageCode);
    renderNarratorDesign();
}

/** Copies the form into voices.narratorDesign. */
function readNarratorDesign() {
    const d = nd();
    d.description = String($('#rpg-voices-nd-desc').val() || '');
    d.label = String($('#rpg-voices-nd-label').val() || '');
    d.gender = String($('#rpg-voices-nd-gender').val() || '');
    d.languageCode = String($('#rpg-voices-nd-lang').val() || '');
    saveSettings();
    return d;
}

function describeDesignError(e) {
    if (!e) return 'Something went wrong.';
    if (e.kind === 'no-key') return e.message;
    if (e.kind === 'bad-key') return 'Google rejected the key below.';
    if (e.kind === 'quota') return 'Your Google project is out of quota, or already has 200 custom voices. Delete some under My custom voices.';
    if (e.kind === 'rate') return 'Google is rate-limiting requests. Wait a moment and try again.';
    return `Google said: ${e.message || e}`;
}

function renderNarratorDesign(error) {
    const $create = $('#rpg-voices-nd-create');
    $create.prop('disabled', ndBusy).html(ndBusy
        ? '<i class="fa-solid fa-spinner fa-spin"></i> Creating… (this can take a little while)'
        : '<i class="fa-solid fa-wand-magic-sparkles"></i> Create narrator voice');
    $('#rpg-voices-nd-reset').prop('disabled', ndBusy);
    const $result = $('#rpg-voices-nd-result');
    const entry = ndLast && getRegistered(ndLast.id);
    if (error) {
        $result.prop('hidden', false).html(`<p class="rpg-voices-nd-error">${escapeHtml(error)}</p>`);
        return;
    }
    if (!entry || ndBusy) {
        $result.prop('hidden', true).empty();
        return;
    }
    const playing = getEngineIfLoaded()?.isAuditioning(entry.id);
    $result.prop('hidden', false).html(`
        <span>The Narrator is now <strong>${escapeHtml(entry.label || 'your designed voice')}</strong>.</span>
        <div class="rpg-voices-nd-actions">
            <button type="button" class="rpg-accordion-mini-btn" id="rpg-voices-nd-hear"><i class="fa-solid ${playing ? 'fa-stop' : 'fa-play'}"></i> Hear it</button>
            <button type="button" class="rpg-accordion-mini-btn" id="rpg-voices-nd-again" title="Delete this one and design a new one from the description">Try again</button>
            <button type="button" class="rpg-accordion-mini-btn" id="rpg-voices-nd-undo" title="Delete this voice and go back to the previous Narrator">Undo</button>
        </div>`);
}

/** Designs a narrator voice from the form and makes it the Narrator. */
async function createNarratorVoice({ replace = false } = {}) {
    const d = readNarratorDesign();
    if (!d.description.trim()) { renderNarratorDesign('Describe how the narrator sounds first (or reset to the old wizard).'); return; }
    // The key box saves itself on change (which fires before this click).
    if (!(v().googleApiKey || '').trim()) {
        renderNarratorDesign('Paste your Google AI Studio key in the box below first. Designing a voice needs it.');
        return;
    }
    unlockVoicesAudio();
    const previous = ndLast ? ndLast.previous : { ...v().narratorVoice };
    if (replace && ndLast) {
        const old = ndLast.id;
        ndLast = null;
        try { await deleteDesignedVoice(old); } catch (e) { console.warn('[DES Voices] could not delete the previous narrator draft', e); }
    }
    ndBusy = true;
    renderNarratorDesign();
    try {
        const { entry } = await designVoice({
            description: d.description.trim(),
            label: d.label.trim() || 'Narrator',
            gender: d.gender,
            languageCode: d.languageCode,
        });
        v().narratorVoice = refFor(entry);
        saveSettings();
        getEngineIfLoaded()?.invalidate();
        ndLast = { id: entry.id, previous };
        ndBusy = false;
        fillNarratorOptions();
        renderDesigned();
        renderNarratorDesign();
        (await getEngine()).audition(refFor(entry), NARRATOR_SAMPLE);
    } catch (e) {
        ndBusy = false;
        renderNarratorDesign(describeDesignError(e));
    }
}

function bindNarratorDesign() {
    $('#rpg-voices-nd-desc, #rpg-voices-nd-label, #rpg-voices-nd-gender, #rpg-voices-nd-lang')
        .on('change', () => readNarratorDesign());
    $('#rpg-voices-nd-reset').on('click', function () {
        const d = nd();
        if (d.description.trim() && d.description !== DEFAULT_NARRATOR_DESIGN.description
            && !window.confirm('Replace your description with the old wizard?')) return;
        v().narratorDesign = { ...DEFAULT_NARRATOR_DESIGN };
        saveSettings();
        fillNarratorDesign();
    });
    $('#rpg-voices-nd-create').on('click', () => createNarratorVoice());
    // "I'm thinking of…": the chat AI describes a named character's voice.
    const describeReference = async () => {
        const who = String($('#rpg-voices-nd-ref').val() || '').trim();
        if (!who) { renderNarratorDesign('Type the character you have in mind first (for example “Withers from Baldur’s Gate 3”).'); return; }
        const $go = $('#rpg-voices-nd-ref-go');
        const html = $go.html();
        $go.prop('disabled', true).html('<i class="fa-solid fa-spinner fa-spin"></i> Describing…');
        try {
            const out = await draftDescriptionFromReference(who);
            if (out.status === 'ok') {
                $('#rpg-voices-nd-desc').val(out.text);
                readNarratorDesign();
                renderNarratorDesign();
            } else {
                renderNarratorDesign(referenceProblem(out.status, who));
            }
        } catch (e) {
            renderNarratorDesign(`Couldn't describe that voice: ${e?.message || e}`);
        } finally {
            $go.prop('disabled', false).html(html);
        }
    };
    $('#rpg-voices-nd-ref-go').on('click', describeReference);
    // Enter asks the AI; Shift+Enter starts a new line.
    $('#rpg-voices-nd-ref').on('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); describeReference(); } });
    $('#rpg-voices-nd-result').on('click', '#rpg-voices-nd-hear', async () => {
        const entry = ndLast && getRegistered(ndLast.id);
        if (!entry) return;
        unlockVoicesAudio();
        (await getEngine()).audition(refFor(entry), NARRATOR_SAMPLE);
    });
    $('#rpg-voices-nd-result').on('click', '#rpg-voices-nd-again', () => {
        if (!window.confirm('Try again? The narrator voice you just made will be deleted from your Google project.')) return;
        createNarratorVoice({ replace: true });
    });
    $('#rpg-voices-nd-result').on('click', '#rpg-voices-nd-undo', async () => {
        if (!ndLast) return;
        if (!window.confirm('Undo? This narrator voice will be deleted from your Google project, and the Narrator goes back to what it was.')) return;
        const { id, previous } = ndLast;
        ndLast = null;
        getEngineIfLoaded()?.stopAudition();
        try { await deleteDesignedVoice(id); } catch (e) { console.warn('[DES Voices] could not delete the narrator voice', e); }
        const back = previous && isValidVoiceRef(previous)
            && (previous.source !== 'designed' && previous.source !== 'cloned' || getRegistered(previous.id));
        v().narratorVoice = back ? previous : stockRef(NARRATOR_FALLBACK_VOICE);
        saveSettings();
        getEngineIfLoaded()?.invalidate();
        fillNarratorOptions();
        renderDesigned();
        renderNarratorDesign();
    });
    document.addEventListener('dooms:voices-state', () => {
        if (ndLast && !ndBusy) renderNarratorDesign();
    });
    document.addEventListener('dooms:voices-registry', () => {
        if (ndLast && !getRegistered(ndLast.id)) ndLast = null;
        if (!ndBusy) renderNarratorDesign();
    });
}

/** The Steadiness switch and its slider (the slider shows only while the switch is on). */
function renderSteadiness() {
    const on = v().steadiness === true;
    const t = clampSteadiness(v().steadinessTemperature);
    $('#rpg-voices-steady').prop('checked', on);
    $('#rpg-voices-steady-row').prop('hidden', !on);
    $('#rpg-voices-steady-temp').val(t);
    $('#rpg-voices-steady-value').text(t.toFixed(2));
}

/** A changed Steadiness setting gets another go, even if Google refused the last value this session. */
async function forgetTemperatureRejection() {
    try {
        const { forgetTemperatureRejection: forget } = await import('../voices/transport.js');
        forget();
    } catch (e) { /* engine not loaded yet */ }
}

function populate() {
    fillNarratorOptions();
    $('#rpg-voices-model').html(VOICE_MODELS.map(m =>
        `<option value="${escapeHtml(m.id)}">${escapeHtml(m.label)}</option>`).join(''));

    $('#rpg-voices-enabled').prop('checked', !!v().enabled);
    $('#rpg-voices-autoread').prop('checked', !!v().autoRead);
    renderDesigned();
    fillNarratorDesign();
    $('#rpg-voices-model').val(v().model);
    $('#rpg-voices-delivery').val(v().deliveryNote || '');
    $('#rpg-voices-never-whisper').prop('checked', !!v().neverWhisper);
    renderSteadiness();
    $('#rpg-voices-guide').prop('open', v().guideOpen !== false);
    $('#rpg-voices-via').val(v().geminiVia === 'openrouter' ? 'openrouter' : 'google');
    $('#rpg-voices-or-key').val(v().openrouterKey || '').attr('type', 'password');
    $('#rpg-voices-or-route').val(v().openrouterRoute || 'auto');
    renderOpenRouterNote();
    $('#rpg-voices-key').val(v().googleApiKey || '').attr('type', 'password');
    const rate = Number(v().playbackRate) || 1;
    $('#rpg-voices-rate').val(rate);
    $('#rpg-voices-rate-value').text(`${rate.toFixed(2)}×`);
    $('#rpg-voices-read-user').prop('checked', !!v().readUserMessages);
    $('#rpg-voices-budget').val(Number(v().sessionRequestBudget) || 0);
    renderStatus();
}

export function bindVoicesSettingsUI() {
    if (bound) { populate(); return; }
    if (!extensionSettings.voices) return;
    bound = true;
    bindDesigned();
    bindNarratorDesign();
    populate();

    $('#rpg-voices-enabled').on('change', async function () {
        unlockVoicesAudio();
        v().enabled = $(this).prop('checked');
        saveSettings();
        await syncVoicesState();
        renderStatus();
    });
    $('#rpg-voices-autoread').on('change', function () {
        unlockVoicesAudio();
        v().autoRead = $(this).prop('checked');
        saveSettings();
        if (v().autoRead) getEngineIfLoaded()?.resumeAutoRead();
        renderStatus();
    });
    $('#rpg-voices-narrator').on('change', function () {
        const value = String($(this).val());
        const entry = value.startsWith('designed:') ? getRegistered(value.slice('designed:'.length)) : null;
        v().narratorVoice = entry ? refFor(entry) : stockRef(value);
        saveSettings();
        getEngineIfLoaded()?.invalidate();
    });
    $('#rpg-voices-narrator-preview').on('click', async function () {
        unlockVoicesAudio();
        const engine = await getEngine();
        engine.audition(narratorRef(), 'The rain had not stopped for three days, and the city was starting to forget what the sun looked like.');
    });
    $('#rpg-voices-key').on('change', function () { saveKey($(this).val()); });
    $('#rpg-voices-key-toggle').on('click', function () {
        const $input = $('#rpg-voices-key');
        const show = $input.attr('type') === 'password';
        $input.attr('type', show ? 'text' : 'password');
        $(this).find('i').toggleClass('fa-eye', !show).toggleClass('fa-eye-slash', show);
    });
    $('#rpg-voices-key-clear').on('click', function () {
        $('#rpg-voices-key').val('');
        saveKey('');
    });
    $('#rpg-voices-key-test').on('click', async function () {
        unlockVoicesAudio();
        await saveKey($('#rpg-voices-key').val());
        const engine = await getEngine();
        engine.audition(stockRef(narratorValue().startsWith('designed:') ? NARRATOR_FALLBACK_VOICE : narratorValue()), 'Your Google voice key works.');
        renderStatus();
    });
    // Delivery note: saved on change (not per keystroke); new lines use it.
    const saveDelivery = (value) => {
        v().deliveryNote = String(value || '').replace(/\s+/g, ' ').trim().slice(0, 160);
        $('#rpg-voices-delivery').val(v().deliveryNote);
        saveSettings();
    };
    $('#rpg-voices-delivery').on('change', function () { saveDelivery($(this).val()); });
    $('#rpg-voices-delivery-reset').on('click', () => saveDelivery(DEFAULT_DELIVERY_NOTE));
    // Never whisper: the style is part of the audio cache key, so a flipped
    // switch re-makes a line on its next play (one request each) rather than
    // replaying the old delivery.
    $('#rpg-voices-never-whisper').on('change', function () {
        v().neverWhisper = $(this).prop('checked');
        saveSettings();
    });
    // Steadiness: the temperature is part of the audio cache key too, so a
    // change re-makes lines on their next play instead of replaying old renders.
    $('#rpg-voices-steady').on('change', function () {
        v().steadiness = $(this).prop('checked');
        v().steadinessTemperature = clampSteadiness(v().steadinessTemperature);
        saveSettings();
        forgetTemperatureRejection();
        renderSteadiness();
        renderStatus();
    });
    $('#rpg-voices-steady-temp').on('input change', function () {
        const t = clampSteadiness($(this).val());
        v().steadinessTemperature = t;
        $('#rpg-voices-steady-value').text(t.toFixed(2));
        saveSettings();
        forgetTemperatureRejection();
    });
    // How DES voices work: remember open/closed.
    $('#rpg-voices-guide').on('toggle', function () {
        v().guideOpen = !!this.open;
        saveSettings();
    });
    $('#rpg-voices-via').on('change', function () {
        v().geminiVia = $(this).val() === 'openrouter' ? 'openrouter' : 'google';
        saveSettings();
        getEngineIfLoaded()?.invalidate();
        renderStatus();
    });
    $('#rpg-voices-or-key').on('change', function () { saveOpenRouterKey($(this).val()); });
    $('#rpg-voices-or-key-toggle').on('click', function () {
        const $input = $('#rpg-voices-or-key');
        const show = $input.attr('type') === 'password';
        $input.attr('type', show ? 'text' : 'password');
        $(this).find('i').toggleClass('fa-eye', !show).toggleClass('fa-eye-slash', show);
    });
    $('#rpg-voices-or-key-clear').on('click', function () {
        $('#rpg-voices-or-key').val('');
        saveOpenRouterKey('');
    });
    $('#rpg-voices-or-route').on('change', async function () {
        const route = String($(this).val());
        v().openrouterRoute = ['auto', 'browser', 'server'].includes(route) ? route : 'auto';
        saveSettings();
        await resetOpenRouter();
        renderOpenRouterNote();
        renderStatus();
    });
    $('#rpg-voices-or-test').on('click', async function () {
        unlockVoicesAudio();
        await saveOpenRouterKey($('#rpg-voices-or-key').val());
        if (!isOpenRouterConnected(v(), secret_state)) {
            try { window.toastr?.info('Paste your OpenRouter key first (or save it to SillyTavern and choose the server route).', 'DES Voices'); } catch (e) {}
            return;
        }
        const engine = await getEngine();
        const narrator = narratorValue();
        engine.audition(stockRef(narrator.startsWith('designed:') ? NARRATOR_FALLBACK_VOICE : narrator), 'Your OpenRouter key works.', { provider: 'openrouter' });
        renderStatus();
    });
    $('#rpg-voices-or-save').on('click', async function () {
        const key = String($('#rpg-voices-or-key').val() || v().openrouterKey || '').trim();
        if (!key) {
            try { window.toastr?.info('Paste your OpenRouter key in the box first.', 'DES Voices'); } catch (e) {}
            return;
        }
        if (stHasSecret(secret_state, ST_SECRET.customTts)
            && !window.confirm('SillyTavern already has a key in its "Custom OpenAI TTS" slot (used by SillyTavern\'s own OpenAI Compatible voices). Save the OpenRouter key there and make it the active one? The old key stays in SillyTavern\'s key list.')) return;
        const $btn = $(this);
        $btn.prop('disabled', true);
        try {
            const { saveKeyToSillyTavern } = await import('../voices/openrouter.js');
            const ok = await saveKeyToSillyTavern(key);
            try { window.toastr?.[ok ? 'success' : 'warning'](ok ? 'Saved in SillyTavern. DES can now reach OpenRouter through SillyTavern\'s server.' : 'SillyTavern didn\'t save the key.', 'DES Voices'); } catch (e) {}
            await resetOpenRouter();
        } finally {
            $btn.prop('disabled', false);
            renderOpenRouterNote();
            renderStatus();
        }
    });
    $('#rpg-voices-model').on('change', function () {
        v().model = String($(this).val());
        saveSettings();
        renderStatus();
    });
    $('#rpg-voices-rate').on('input change', function () {
        const rate = Math.min(1.5, Math.max(0.75, Number($(this).val()) || 1));
        v().playbackRate = rate;
        $('#rpg-voices-rate-value').text(`${rate.toFixed(2)}×`);
        saveSettings();
    });
    $('#rpg-voices-read-user').on('change', function () {
        v().readUserMessages = $(this).prop('checked');
        saveSettings();
    });
    $('#rpg-voices-budget').on('change', function () {
        const n = Math.max(0, Math.min(10000, Math.round(Number($(this).val()) || 0)));
        v().sessionRequestBudget = n;
        $(this).val(n);
        saveSettings();
    });
    $('#rpg-voices-resume').on('click', function () {
        getEngineIfLoaded()?.resumeAutoRead();
        renderStatus();
    });
    document.addEventListener('dooms:voices-state', renderStatus);
}
