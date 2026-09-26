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
import { getAvailableConnectionProfiles } from '../generation/apiClient.js';

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
        parts.push(`Using ${st.connection}.`);
        if (route.status === 'ok') {
            const chosen = v().model;
            const used = route.effectiveModel;
            parts.push(used && used !== chosen
                ? `Your SillyTavern can’t send ${chosen} yet, so voices use ${used} through SillyTavern.`
                : `${used || chosen}: working.`);
        } else if (route.status === 'no-key') {
            parts.push('No Google key found in SillyTavern. Add one under API Connections → Google AI Studio.');
        } else if (route.status === 'bad-key') {
            parts.push('Google rejected the key saved in SillyTavern.');
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

/**
 * Fills Settings → Voices → Connection from SillyTavern's connection
 * profiles. Only Google AI Studio profiles can be picked; others are listed
 * disabled so it's clear why they're missing. A saved profile that no longer
 * exists stays selected (marked missing) instead of silently switching keys.
 */
export async function refreshVoicesConnectionOptions() {
    const $select = $('#rpg-voices-connection');
    if (!$select.length) return;
    let profiles = [];
    try {
        const { listProfiles } = await import('../voices/connection.js');
        profiles = listProfiles();
    } catch (e) {
        // connection.js failed to load; fall back to names only
        profiles = getAvailableConnectionProfiles().map(name => ({ name, usable: true, why: '' }));
    }
    const current = v().connectionProfile || '';
    const options = ['<option value="">Current SillyTavern connection (active Google key)</option>'];
    for (const p of profiles) {
        options.push(`<option value="${escapeHtml(p.name)}"${p.usable ? '' : ' disabled'}>${escapeHtml(p.name)}${p.usable ? '' : ` \u2014 ${escapeHtml(p.why)}`}</option>`);
    }
    if (current && !profiles.some(p => p.name === current)) {
        options.push(`<option value="${escapeHtml(current)}">${escapeHtml(current)} \u2014 missing</option>`);
    }
    $select.html(options.join(''));
    $select.val(current);
    renderStatus();
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
    refreshVoicesConnectionOptions();
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
    $('#rpg-voices-connection').on('change', function () {
        v().connectionProfile = String($(this).val() || '');
        saveSettings();
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
