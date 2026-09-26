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
import { escapeHtml } from '../../utils/html.js';

let bound = false;

function v() {
    return extensionSettings.voices;
}

function narratorId() {
    return canonicalStockId(v().narratorVoice?.id) || NARRATOR_FALLBACK_VOICE;
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
    const $narrator = $('#rpg-voices-narrator');
    $narrator.html(STOCK_VOICES.map(voice =>
        `<option value="${escapeHtml(voice.id)}">${escapeHtml(stockLabel(voice.id))}</option>`).join(''));
    $('#rpg-voices-model').html(VOICE_MODELS.map(m =>
        `<option value="${escapeHtml(m.id)}">${escapeHtml(m.label)}</option>`).join(''));

    $('#rpg-voices-enabled').prop('checked', !!v().enabled);
    $('#rpg-voices-autoread').prop('checked', !!v().autoRead);
    $narrator.val(narratorId());
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
        v().narratorVoice = stockRef(String($(this).val()));
        saveSettings();
        getEngineIfLoaded()?.invalidate();
    });
    $('#rpg-voices-narrator-preview').on('click', async function () {
        unlockVoicesAudio();
        const engine = await getEngine();
        engine.audition(stockRef(narratorId()), 'The rain had not stopped for three days, and the city was starting to forget what the sun looked like.');
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
        engine.audition(stockRef(narratorId()), 'Your Google voice key works.');
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
