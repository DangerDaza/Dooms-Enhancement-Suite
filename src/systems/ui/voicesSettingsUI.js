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
import { STOCK_VOICES, stockLabel, stockRef, canonicalStockId } from '../voices/voiceCatalog.js';
import { VOICE_MODELS, NARRATOR_FALLBACK_VOICE } from '../voices/voiceSettings.js';
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
} from '../voices/voiceRegistry.js';
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
        ? `<optgroup label="Standard voices">${stock}</optgroup><optgroup label="Your designed voices">${designed.map(e =>
            `<option value="designed:${escapeHtml(e.id)}">${escapeHtml(e.label || 'Designed voice')}</option>`).join('')}</optgroup>`
        : stock);
    $narrator.val(narratorValue());
}

// ─── My designed voices ─────────────────────────────────────────────────────

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
                    <span class="rpg-voices-designed-name">${escapeHtml(e.label || 'Designed voice')} ${e.gender ? `<span class="rpg-voices-designed-meta">· ${e.gender === 'female' ? 'Female' : 'Male'}</span>` : ''} ${badge}</span>
                    <span class="rpg-voices-designed-meta">${used ? `Used by ${escapeHtml(used)}` : 'Not used by anyone'}</span>
                    <span class="rpg-voices-designed-meta">${escapeHtml(e.designPrompt || '')}</span>
                </div>
                <div class="rpg-voices-designed-buttons">
                    <button type="button" class="rpg-accordion-mini-btn rpg-voices-designed-play" title="Preview" ${h === 'gone' ? 'disabled' : ''}>
                        <i class="fa-solid ${playing ? 'fa-stop' : 'fa-play'}"></i>
                    </button>
                    ${h !== 'ok' ? '<button type="button" class="rpg-accordion-mini-btn rpg-voices-designed-recreate" title="Design a fresh copy from its description">Recreate</button>' : ''}
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
    if (!voicesOn) {
        parts.push('DES voices are off. The bullhorn buttons use SillyTavern’s own TTS.');
    } else if (!engine) {
        parts.push('Ready. Nothing has been read yet this session.');
    } else {
        const st = engine.getStatus();
        const route = st.route;
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
        parts.push(`${st.requests} request${st.requests === 1 ? '' : 's'} this session.`);
        if (st.autoReadPaused) parts.push('Auto-read is paused.');
        $('#rpg-voices-resume').prop('hidden', !st.autoReadPaused);
    }
    if (voicesOn && !extensionSettings.enableDialogueColoring) {
        parts.push('Dialogue colouring is off, so DES can’t tell who is speaking — everything will be read by the Narrator.');
    }
    $status.text(parts.join(' '));
}

function populate() {
    fillNarratorOptions();
    $('#rpg-voices-model').html(VOICE_MODELS.map(m =>
        `<option value="${escapeHtml(m.id)}">${escapeHtml(m.label)}</option>`).join(''));

    $('#rpg-voices-enabled').prop('checked', !!v().enabled);
    $('#rpg-voices-autoread').prop('checked', !!v().autoRead);
    renderDesigned();
    $('#rpg-voices-model').val(v().model);
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
    // Google key: saved on change/blur (not per keystroke), trimmed.
    const saveKey = async (value) => {
        const key = String(value || '').trim();
        if (key === (v().googleApiKey || '')) return;
        v().googleApiKey = key;
        saveSettings();
        try {
            const { clearRouteProbe } = await import('../voices/transport.js');
            clearRouteProbe();
        } catch (e) { /* engine not loaded yet */ }
        renderStatus();
    };
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
