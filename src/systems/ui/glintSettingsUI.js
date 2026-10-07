/*
 * Doom's Enhancement Suite for SillyTavern — Glint Words settings
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
 * Settings → Theme → Glint Words: the on/off switch and one editor per
 * group of words (name, words, look, colour, entrance, idle effect), with a
 * live preview that replays the entrance when clicked.
 */

import { saveSettings } from '../../core/persistence.js';
import { ensureCss } from '../../core/cssLoader.js';
import { escapeHtml } from '../../utils/html.js';
import {
    GLINT_LOOKS,
    GLINT_ENTRANCES,
    GLINT_IDLES,
    GLINT_PRESETS,
    GLINT_MAX_GROUPS,
    groupFromPreset,
    parseWordList,
    cleanWord,
} from '../rendering/glintCatalog.js';
import { getGlintSettings, refreshGlintWords, buildGlintSpan, playGlintEntrance, probeGlintMotion } from '../rendering/glintWords.js';

let refreshTimer = null;
let probeTimer = null;
let watchingMotion = false;

const MOTION_NOTES = {
    perf: 'Glints aren\u2019t moving because DES Performance Mode is on (Display & Features \u2192 Features). Turn on Animate anyway above to keep them moving.',
    system: 'Glints aren\u2019t moving because your system asks for reduced motion (Windows: Settings \u2192 Accessibility \u2192 Visual effects \u2192 Animation effects; Mac: System Settings \u2192 Accessibility \u2192 Display \u2192 Reduce motion). Turn on Animate anyway above to keep them moving.',
    css: 'Glints aren\u2019t moving, and it isn\u2019t Performance Mode or your system setting. Something on the page is stopping animations: most often a theme or a rule in SillyTavern\u2019s User Settings \u2192 Custom CSS, or another extension.',
};

/**
 * Tests whether a glint really animates in the chat and, if not, says why.
 * Runs when the card is bound, when Performance Mode or the system setting
 * changes, and when "Animate anyway" is switched.
 */
function renderMotionNote() {
    const $note = $('#rpg-glint-motion-note');
    if (!$note.length) return;
    const s = getGlintSettings();
    if (!s.enabled) { $note.prop('hidden', true); return; }
    ensureCss('glint').then(() => {
        let result;
        try { result = probeGlintMotion(); } catch (e) { result = { moving: true, reason: '' }; }
        $note.text(result.moving ? '' : (MOTION_NOTES[result.reason] || MOTION_NOTES.css)).prop('hidden', result.moving);
    }).catch(() => { $note.prop('hidden', true); });
}

function scheduleMotionNote() {
    clearTimeout(probeTimer);
    probeTimer = setTimeout(renderMotionNote, 120);
}

/** Re-checks when Performance Mode flips (a body class) or the system setting changes. */
function watchMotionSources() {
    if (watchingMotion) return;
    watchingMotion = true;
    let perfOn = document.body.classList.contains('dooms-perf-mode');
    try {
        new MutationObserver(() => {
            const now = document.body.classList.contains('dooms-perf-mode');
            if (now !== perfOn) { perfOn = now; scheduleMotionNote(); }
        }).observe(document.body, { attributes: true, attributeFilter: ['class'] });
    } catch (e) { /* old browser: checked when the card opens */ }
    try {
        const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
        if (mq.addEventListener) mq.addEventListener('change', scheduleMotionNote);
        else if (mq.addListener) mq.addListener(scheduleMotionNote);
    } catch (e) { /* no matchMedia */ }
}

/** Saves, then re-applies the words to the chat once the player pauses. */
function commit() {
    saveSettings();
    syncBadge();
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
        refreshTimer = null;
        try { refreshGlintWords(); } catch (e) { console.warn('[Dooms Tracker] Glint Words refresh failed:', e); }
    }, 300);
}

function syncBadge() {
    const s = getGlintSettings();
    const words = s.groups.reduce((n, g) => n + (g.enabled ? g.words.length : 0), 0);
    $('#rpg-glint-badge').text(s.enabled ? (words ? `${words} word${words === 1 ? '' : 's'}` : 'on') : 'off');
    $('#rpg-glint-groups, .rpg-glint-add, .rpg-glint-help').toggleClass('rpg-glint-muted', !s.enabled);
}

function findGroup(id) {
    return getGlintSettings().groups.find(g => g.id === id) || null;
}

function options(list, selected) {
    return list.map(o => `<option value="${o.id}"${o.id === selected ? ' selected' : ''}>${escapeHtml(o.label)}</option>`).join('');
}

function groupHtml(g) {
    return `
        <div class="rpg-glint-group${g.enabled ? '' : ' is-off'}" data-glint-id="${escapeHtml(g.id)}">
            <div class="rpg-glint-group-head">
                <span class="rpg-glint-preview" role="button" tabindex="0" title="Play the effect"></span>
                <input type="text" class="rpg-accordion-input rpg-glint-name" maxlength="40"
                    placeholder="Group name" value="${escapeHtml(g.name)}" aria-label="Group name" />
                <label class="rpg-toggle-switch" title="Use this group">
                    <input type="checkbox" class="rpg-glint-enabled"${g.enabled ? ' checked' : ''} />
                    <span class="rpg-toggle-slider"></span>
                </label>
                <button type="button" class="rpg-accordion-mini-btn rpg-glint-delete" title="Delete this group" aria-label="Delete this group">
                    <i class="fa-solid fa-trash"></i>
                </button>
            </div>
            <textarea class="rpg-accordion-input rpg-glint-words" rows="2" spellcheck="false"
                placeholder="Words or phrases, separated by commas" aria-label="Words">${escapeHtml(g.words.join(', '))}</textarea>
            <div class="rpg-glint-options">
                <label class="rpg-glint-option">
                    <span>Look</span>
                    <select class="rpg-accordion-select rpg-glint-look">${options(GLINT_LOOKS, g.look)}</select>
                </label>
                <label class="rpg-glint-option rpg-glint-color-wrap"${g.look === 'custom' ? '' : ' hidden'}>
                    <span>Colour</span>
                    <input type="color" class="rpg-glint-color" value="${escapeHtml(g.color)}" />
                </label>
                <label class="rpg-glint-option">
                    <span>When it appears</span>
                    <select class="rpg-accordion-select rpg-glint-entrance">${options(GLINT_ENTRANCES, g.entrance)}</select>
                </label>
                <label class="rpg-glint-option">
                    <span>Afterwards</span>
                    <select class="rpg-accordion-select rpg-glint-idle">${options(GLINT_IDLES, g.idle)}</select>
                </label>
            </div>
        </div>`;
}

/** Puts the group's first word (or its name) in the preview chip, in its look. */
function renderPreview($group, g, play = false) {
    const $p = $group.find('.rpg-glint-preview');
    $p.empty().removeClass('rpg-glint-preview-empty');
    const word = g.words[0] || g.name;
    if (!word) {
        $p.addClass('rpg-glint-preview-empty').text('no words yet');
        return;
    }
    const span = buildGlintSpan(word, g, g.id);
    $p[0].appendChild(span);
    if (play) playGlintEntrance(span, g.entrance === 'none' ? 'flash' : g.entrance);
}

function renderGroups() {
    const $host = $('#rpg-glint-groups');
    if (!$host.length) return;
    const groups = getGlintSettings().groups;
    if (!groups.length) {
        $host.html('<p class="rpg-note-text rpg-glint-empty">No groups yet. Start a new one, or add a preset below and edit its words.</p>');
    } else {
        $host.html(groups.map(groupHtml).join(''));
        for (const g of groups) renderPreview($host.find(`.rpg-glint-group[data-glint-id="${g.id}"]`), g);
    }
    $('#rpg-glint-add-group').prop('disabled', groups.length >= GLINT_MAX_GROUPS);
    $('#rpg-glint-add-preset').prop('disabled', groups.length >= GLINT_MAX_GROUPS);
    syncBadge();
}

/** The group a control belongs to, with its row. */
function owner(el) {
    const $group = $(el).closest('.rpg-glint-group');
    return { $group, g: findGroup(String($group.attr('data-glint-id') || '')) };
}

function addGroup(group) {
    const s = getGlintSettings();
    if (s.groups.length >= GLINT_MAX_GROUPS) return null;
    s.groups.push(group);
    commit();
    renderGroups();
    const $group = $(`#rpg-glint-groups .rpg-glint-group[data-glint-id="${group.id}"]`);
    try { $group[0]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch (e) { /* old browsers */ }
    return $group;
}

export function bindGlintSettingsUI() {
    ensureCss('glint').catch(() => {});
    const s = getGlintSettings();
    $('#rpg-glint-toggle').prop('checked', s.enabled).on('change', function () {
        getGlintSettings().enabled = $(this).prop('checked');
        commit();
        scheduleMotionNote();
    });
    $('#rpg-glint-animate-always').prop('checked', !!s.animateAlways).on('change', function () {
        getGlintSettings().animateAlways = $(this).prop('checked');
        saveSettings();
        // Applied at once (not after the usual pause) so the note re-checks the new state.
        clearTimeout(refreshTimer);
        refreshTimer = null;
        try { refreshGlintWords(); } catch (e) { console.warn('[Dooms Tracker] Glint Words refresh failed:', e); }
        scheduleMotionNote();
    });
    // Opening the card re-checks too: a theme or custom CSS may have changed since.
    $('#rpg-glint-subsection').on('toggle', function () { if (this.open) scheduleMotionNote(); });
    watchMotionSources();
    $('#rpg-glint-add-preset').append(GLINT_PRESETS.map(p =>
        `<option value="${p.id}">${escapeHtml(p.name)} (${escapeHtml(p.words.slice(0, 3).join(', '))}…)</option>`).join(''));

    $('#rpg-glint-add-group').on('click', function () {
        const $group = addGroup(groupFromPreset(null));
        $group?.find('.rpg-glint-words').trigger('focus');
    });
    $('#rpg-glint-add-preset').on('change', function () {
        const id = String($(this).val() || '');
        $(this).val('');
        if (!id) return;
        const group = groupFromPreset(id);
        const $group = addGroup(group);
        if ($group) renderPreview($group, group, true);
    });

    const $host = $('#rpg-glint-groups');
    $host.on('change', '.rpg-glint-name', function () {
        const { $group, g } = owner(this);
        if (!g) return;
        g.name = cleanWord($(this).val()).slice(0, 40);
        $(this).val(g.name);
        renderPreview($group, g);
        commit();
    });
    $host.on('change', '.rpg-glint-words', function () {
        const { $group, g } = owner(this);
        if (!g) return;
        g.words = parseWordList($(this).val());
        $(this).val(g.words.join(', '));
        renderPreview($group, g);
        commit();
    });
    $host.on('change', '.rpg-glint-look', function () {
        const { $group, g } = owner(this);
        if (!g) return;
        g.look = String($(this).val());
        $group.find('.rpg-glint-color-wrap').prop('hidden', g.look !== 'custom');
        renderPreview($group, g);
        commit();
    });
    $host.on('input change', '.rpg-glint-color', function () {
        const { $group, g } = owner(this);
        if (!g) return;
        const v = String($(this).val() || '');
        if (!/^#[0-9a-f]{6}$/i.test(v)) return;
        g.color = v.toLowerCase();
        renderPreview($group, g);
        commit();
    });
    $host.on('change', '.rpg-glint-entrance', function () {
        const { $group, g } = owner(this);
        if (!g) return;
        g.entrance = String($(this).val());
        renderPreview($group, g, true);
        commit();
    });
    $host.on('change', '.rpg-glint-idle', function () {
        const { $group, g } = owner(this);
        if (!g) return;
        g.idle = String($(this).val());
        renderPreview($group, g);
        commit();
    });
    $host.on('change', '.rpg-glint-enabled', function () {
        const { $group, g } = owner(this);
        if (!g) return;
        g.enabled = $(this).prop('checked');
        $group.toggleClass('is-off', !g.enabled);
        commit();
    });
    $host.on('click', '.rpg-glint-delete', function () {
        const { g } = owner(this);
        if (!g) return;
        const label = g.name || g.words.slice(0, 3).join(', ') || 'this group';
        if (g.words.length && !window.confirm(`Delete "${label}"? Its words stop glinting.`)) return;
        const s2 = getGlintSettings();
        s2.groups = s2.groups.filter(x => x.id !== g.id);
        commit();
        renderGroups();
    });
    $host.on('click keydown', '.rpg-glint-preview', function (e) {
        if (e.type === 'keydown' && e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        const { g } = owner(this);
        const span = this.querySelector('.dooms-glint');
        if (g && span) playGlintEntrance(span, g.entrance === 'none' ? 'flash' : g.entrance);
    });

    renderGroups();
    scheduleMotionNote();
}
