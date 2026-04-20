/**
 * Character Workshop — per-character editor + scene injector.
 *
 * Scope: Identity (read-only) and Appearance (portrait + dialogue color).
 * Plus an "Inject into Scene" action that (a) adds the character to the
 * active known-characters roster so they appear on the portrait bar,
 * and (b) queues a one-shot SillyTavern extension prompt instructing
 * the AI to bring the character into the scene on the next turn. The
 * injection is cleared automatically once generation ends.
 *
 * Opening is decoupled from portraitBar.js via a window CustomEvent
 * ('dooms:open-workshop') so portraitBar does not import this module.
 */

import { extensionSettings, lastGeneratedData, updateLastGeneratedData } from '../../core/state.js';
import {
    saveSettings,
    saveChatData,
    getActiveKnownCharacters,
    getActiveRemovedCharacters,
    saveCharacterRosterChange,
} from '../../core/persistence.js';
import { clearPortraitCache, updatePortraitBar, openExpressionFolder } from './portraitBar.js';
import { renderThoughts } from '../rendering/thoughts.js';
import { i18n } from '../../core/i18n.js';
import { getAllWorldNames, activateWorld, isWorldActive } from '../lorebook/lorebookAPI.js';
import {
    setExtensionPrompt,
    extension_prompt_types,
    eventSource,
    event_types,
} from '../../../../../../../script.js';
import { getContext } from '../../../../../../extensions.js';

// SillyTavern extension-prompt slot key; must be unique per feature.
const INJECT_SLOT = 'dooms-workshop-scene-inject';

// Dialogue color palette copied verbatim from portraitBar.js:29-38.
const DIALOGUE_COLORS = [
    '#e94560', '#e07b39', '#f0c040', '#2ecc71',
    '#1abc9c', '#4a7ba7', '#9b59b6', '#e84393',
    '#5dade2', '#f39c12', '#8e44ad', '#d35400',
    '#16a085', '#c0392b', '#00b894', '#6c5ce7',
    '#fd79a8', '#a29bfe', '#55efc4', '#fab1a0',
    '#74b9ff', '#ffeaa7', '#e17055', '#00cec9',
    '#0984e3', '#fdcb6e', '#d63031', '#e056fd',
    '#7ed6df', '#badc58',
];

let draft = null;
let $modal = null;
let listenersBound = false;
let pendingInjectClear = false; // true while an inject prompt is queued
// Number of GENERATION_STARTED fires to let pass before clearing. Set to 1
// at inject time; the generation the inject was for passes without clearing,
// any subsequent START triggers a clear in case GENERATION_ENDED never fired.
let injectStartsToSkip = 0;

// Characters currently mid-inject. Keyed lowercase so lookups are stable
// regardless of casing. Each entry tracks anything we need to undo on
// either a natural completion or a manual Cancel.
const pendingInjects = new Map(); // name.toLowerCase() -> { name, disarmAttach: fn|null }

function broadcastInjectState(name, pending) {
    try {
        window.dispatchEvent(new CustomEvent('dooms:inject-state-changed', {
            detail: { name, pending: !!pending },
        }));
    } catch (e) {}
}

function t(key, fallback, vars) {
    let s;
    try {
        s = i18n?.getTranslation?.(key);
    } catch (e) {
        s = null;
    }
    if (!s) s = fallback;
    if (vars && typeof s === 'string') {
        for (const [k, v] of Object.entries(vars)) {
            s = s.split(`{${k}}`).join(v);
        }
    }
    return s;
}

export function initCharacterWorkshop() {
    // Workshop is part of the Present Characters Panel feature set;
    // when PCP is disabled the Workshop has nothing useful to do, so
    // we early-return and skip listener registration.
    if (extensionSettings?.showPortraitBar === false) {
        console.log('[Dooms Tracker] Character Workshop disabled (Present Characters Panel off), skipping init');
        return;
    }
    window.addEventListener('dooms:open-workshop', (e) => {
        const name = e?.detail?.characterName;
        if (name) openCharacterWorkshop(name);
    });
    // Portrait-bar (or any other surface) can request a pending-inject be
    // cancelled via this event. Same decoupling pattern as open-workshop.
    window.addEventListener('dooms:cancel-inject', (e) => {
        const name = e?.detail?.name;
        if (name) cancelInject(name);
    });
    // Clear the inject prompt after the targeted generation. Belt-and-
    // suspenders: trigger from ENDED/STOPPED (normal path) and also from
    // the START of any *subsequent* generation (covers streaming paths or
    // aborts where ENDED never fires).
    try {
        eventSource.on(event_types.GENERATION_ENDED, clearInjectPromptIfPending);
        eventSource.on(event_types.GENERATION_STOPPED, clearInjectPromptIfPending);
        eventSource.on(event_types.GENERATION_STARTED, onGenerationStartedForInject);
    } catch (e) {
        console.warn('[Dooms Tracker] Workshop: failed to register GENERATION_ENDED listener', e);
    }
}

export function openCharacterWorkshop(characterName) {
    if (!characterName) {
        console.warn('[Dooms Tracker] openCharacterWorkshop called without a name');
        return;
    }
    if (!ensureModal()) return;

    draft = buildDraft(characterName);

    renderTitle();
    renderHiddenBanner();
    renderIdentity();
    renderAppearance();
    renderInjection();
    activatePane('identity');

    if (!listenersBound) {
        bindStaticListeners();
        listenersBound = true;
    }

    $modal.attr('data-theme', extensionSettings?.theme || 'default');
    $modal.addClass('is-open').css('display', '');
}

export function closeCharacterWorkshop() {
    if (!$modal || !$modal.length) return;
    $modal.removeClass('is-open').addClass('is-closing');
    setTimeout(() => $modal.removeClass('is-closing').hide(), 200);
    draft = null;
}

/**
 * Is this character currently mid-inject (post-click, pre-AI-reply)?
 * Case-insensitive. Used by portraitBar to decide whether to show the
 * INJECTING overlay + Cancel Injection context-menu item.
 */
export function isInjectPending(name) {
    if (!name) return false;
    return pendingInjects.has(String(name).toLowerCase());
}

/**
 * Cancel a pending inject for this character:
 *  - clears the SillyTavern extension prompt so the AI doesn't receive the
 *    one-shot scene-direction text
 *  - disarms the portrait-attach MESSAGE_SENT listener if armed
 *  - removes the character from the present list (undoes cw-57's splice)
 *  - removes them from the pending set and broadcasts the new state
 * Leaves knownCharacters, Workshop data, and lorebook activation alone —
 * those were either pre-existing or user-chosen, and keeping them avoids
 * surprise data loss.
 */
export function cancelInject(name) {
    if (!name) return;
    const key = String(name).toLowerCase();
    const entry = pendingInjects.get(key);
    if (!entry) return;

    // Clear the extension-prompt text if this cancel is for the most
    // recently armed inject. If multiple were queued in rapid succession,
    // we optimistically clear — a subsequent GENERATION_ENDED would have
    // cleared it anyway.
    try {
        setExtensionPrompt(INJECT_SLOT, '', extension_prompt_types.IN_PROMPT, 0, false);
    } catch (e) { /* best-effort */ }
    pendingInjectClear = false;
    injectStartsToSkip = 0;

    // Disarm the portrait-attach listener if one was armed for this char.
    try { entry.disarmAttach?.(); } catch (e) {}

    // Undo the "present now" splice so the character no longer sits in the
    // panel as though they were in the scene.
    try { unmarkCharacterPresentNow(entry.name); } catch (e) {}

    pendingInjects.delete(key);
    broadcastInjectState(entry.name, false);

    try {
        if (window.toastr) window.toastr.info(`Inject cancelled for "${entry.name}".`, 'Character Workshop', { timeOut: 3000 });
    } catch (e) {}
    console.log(`[Dooms Tracker] Workshop: inject cancelled for "${entry.name}"`);
}

// ---------------------------------------------------------------------------

function ensureModal() {
    if ($modal && $modal.length) return true;
    $modal = $('#character-workshop-popup');
    if (!$modal.length) {
        console.warn('[Dooms Tracker] #character-workshop-popup not in DOM — template.html missing block?');
        $modal = null;
        return false;
    }
    return true;
}

function buildDraft(name) {
    const inj = extensionSettings?.characterInjection?.[name] || {};
    return {
        name,
        color: extensionSettings?.characterColors?.[name] || '',
        avatar: extensionSettings?.npcAvatars?.[name] || '',
        avatarFullRes: extensionSettings?.npcAvatarsFullRes?.[name] || '',
        relationship: resolveCurrentRelationship(name),
        injection: {
            description: typeof inj.description === 'string' ? inj.description : '',
            lorebook: typeof inj.lorebook === 'string' ? inj.lorebook : '',
        },
        dirty: { color: false, avatar: false, injection: false, relationship: false },
    };
}

function resolveCurrentRelationship(name) {
    // Persistent user-set override wins over the AI's per-turn classification.
    const override = extensionSettings?.characterRelationships?.[name];
    if (typeof override === 'string' && override) return override;
    // Fallback: best-effort read from the AI's volatile tracker data.
    try {
        const raw = window?.dooms_lastGeneratedData?.characterThoughts;
        if (!raw) return '';
        const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
        const list = parsed?.characters || [];
        const found = list.find(c => c?.name === name);
        return found?.relationship?.status || '';
    } catch (e) {
        return '';
    }
}

function renderTitle() {
    $modal.find('#cw-char-title').text(draft.name);
}

function isHiddenFromPanel(name) {
    try {
        const removed = getActiveRemovedCharacters();
        if (!Array.isArray(removed)) return false;
        const lower = String(name || '').toLowerCase();
        return removed.some(n => typeof n === 'string' && n.toLowerCase() === lower);
    } catch (e) { return false; }
}

function renderHiddenBanner() {
    const hidden = !!draft && isHiddenFromPanel(draft.name);
    $modal.find('#cw-hidden-banner').prop('hidden', !hidden);
}

function restoreCharacterToPanel() {
    if (!draft) return;
    const name = draft.name;
    try {
        const removed = getActiveRemovedCharacters();
        if (Array.isArray(removed) && removed.length) {
            const lower = String(name || '').toLowerCase();
            for (let i = removed.length - 1; i >= 0; i--) {
                if (typeof removed[i] === 'string' && removed[i].toLowerCase() === lower) {
                    removed.splice(i, 1);
                }
            }
            saveCharacterRosterChange();
        }
        clearPortraitCache();
        updatePortraitBar();
    } catch (e) {
        console.warn('[Dooms Tracker] Workshop: restoreCharacterToPanel failed', e);
    }
    renderHiddenBanner();
    try {
        if (window.toastr) window.toastr.success(`"${name}" returned to the panel.`, 'Character Workshop', { timeOut: 3000 });
    } catch (e) {}
}

function renderIdentity() {
    $modal.find('#cw-name').val(draft.name);
    const rel = (draft.relationship || '').toLowerCase();
    $modal.find('.rpg-rel-chip').each(function () {
        const $chip = $(this);
        const matches = ($chip.attr('data-rel') || '').toLowerCase() === rel;
        $chip.toggleClass('selected', matches);
        $chip.attr('aria-checked', matches ? 'true' : 'false');
    });
    const $rel = $modal.find('#cw-preview-rel');
    if (draft.relationship) {
        const $match = $modal.find(`.rpg-rel-chip[data-rel="${draft.relationship}"]`);
        const emoji = $match.attr('data-emoji') || '';
        $rel.text(`${emoji} ${draft.relationship}`.trim());
    } else {
        $rel.text('');
    }
    $modal.find('#cw-preview-name').text(draft.name);
    $modal.find('#cw-preview-card-name').text(draft.name);
    applyPreviewColor(draft.color || '#e94560');
}

function renderAppearance() {
    const $img = $modal.find('#cw-preview-img');
    const $placeholder = $modal.find('#cw-preview-placeholder');
    if (draft.avatar) {
        $img.attr('src', draft.avatar).show();
        $placeholder.hide();
    } else {
        $img.removeAttr('src').hide();
        $placeholder.show();
    }
    const $palette = $modal.find('#cw-palette').empty();
    for (const hex of DIALOGUE_COLORS) {
        const isSelected = (draft.color || '').toLowerCase() === hex.toLowerCase();
        const $sw = $(`<button type="button" class="rpg-color-swatch${isSelected ? ' selected' : ''}"></button>`);
        $sw.css('background', hex);
        $sw.attr({
            role: 'radio',
            'aria-checked': isSelected ? 'true' : 'false',
            'aria-label': hex,
            'data-hex': hex,
        });
        $palette.append($sw);
    }
}

// Cache of available lorebook names; rebuilt every open so newly-created
// SillyTavern lorebooks show up without a reload. Used by the combobox
// filter to render the dropdown list.
let lorebookOptions = [];

function renderInjection() {
    $modal.find('#cw-inj-description').val(draft.injection.description || '');

    // Refresh the available lorebook list.
    try {
        lorebookOptions = getAllWorldNames() || [];
    } catch (e) {
        console.warn('[Dooms Tracker] Workshop: getAllWorldNames failed', e);
        lorebookOptions = [];
    }

    // Pre-fill the combobox input with the saved lorebook (if any).
    $modal.find('#cw-inj-lorebook').val(draft.injection.lorebook || '');
    closeLorebookCombo();

    // Sync the global "Attach portrait to message" toggle.
    $modal.find('#cw-inj-attach-portrait').prop('checked', extensionSettings?.injectAttachPortrait === true);
}

function renderLorebookComboList(filter) {
    const $list = $modal.find('#cw-inj-lorebook-list').empty();
    const needle = (filter || '').trim().toLowerCase();
    const matches = lorebookOptions.filter(n => !needle || n.toLowerCase().includes(needle));
    const saved = draft?.injection?.lorebook || '';

    // Always include "None" at the top so the user can clear without
    // selecting all the text.
    if (!needle || 'none'.includes(needle) || '— none —'.includes(needle)) {
        const $none = $('<li class="cw-combobox-none" data-value="">— None —</li>');
        if (!saved) $none.addClass('is-active');
        $list.append($none);
    }

    if (matches.length === 0 && needle) {
        $list.append('<li class="cw-combobox-empty">No lorebooks match.</li>');
    } else {
        for (const wname of matches) {
            const $li = $('<li></li>')
                .attr('data-value', wname)
                .text(wname);
            if (wname === saved) $li.addClass('is-active');
            $list.append($li);
        }
    }

    // If the saved value isn't present in the available names, surface it
    // at the bottom flagged as missing so the user can see it's stale.
    if (saved && !lorebookOptions.includes(saved) && (!needle || saved.toLowerCase().includes(needle))) {
        const $li = $('<li></li>')
            .attr('data-value', saved)
            .addClass('is-missing is-active')
            .text(`${saved} (missing)`);
        $list.append($li);
    }
}

function openLorebookCombo() {
    const $combo = $modal.find('#cw-inj-lorebook-combo');
    const $list = $modal.find('#cw-inj-lorebook-list');
    const $input = $modal.find('#cw-inj-lorebook');
    if ($combo.hasClass('is-open')) return;
    renderLorebookComboList($input.val());
    $combo.addClass('is-open');
    $list.prop('hidden', false);
    $input.attr('aria-expanded', 'true');
}

function closeLorebookCombo() {
    const $combo = $modal.find('#cw-inj-lorebook-combo');
    const $list = $modal.find('#cw-inj-lorebook-list');
    const $input = $modal.find('#cw-inj-lorebook');
    $combo.removeClass('is-open');
    $list.prop('hidden', true);
    $input.attr('aria-expanded', 'false');
}

function commitLorebookSelection(value) {
    if (!draft) return;
    draft.injection.lorebook = String(value || '').trim();
    draft.dirty.injection = true;
    $modal.find('#cw-inj-lorebook').val(draft.injection.lorebook);
    closeLorebookCombo();
}

function applyPreviewColor(hex) {
    $modal.find('#cw-preview-card-name').css('color', hex);
    $modal.find('#cw-preview-name').css('color', hex);
    $modal.find('#cw-preview-color-dot').css('background', hex);
    // Keep the custom-color button's preview chip in sync too.
    $modal.find('#cw-color-custom-preview').css('background', hex);
    $modal.find('#cw-color-custom-input').val(hex);
}

/**
 * Commit a new dialogue color to the draft and refresh all UI that
 * shows it (palette selection state, preview card, custom button chip).
 * Accepts any hex; if the color matches a palette swatch, that swatch
 * gets the 'selected' highlight too.
 */
function commitColorSelection(hex) {
    if (!draft || !hex) return;
    const lower = String(hex).toLowerCase();
    draft.color = lower;
    draft.dirty.color = true;
    $modal.find('.rpg-color-swatch').each(function () {
        const match = ($(this).attr('data-hex') || '').toLowerCase() === lower;
        $(this).toggleClass('selected', match);
        $(this).attr('aria-checked', match ? 'true' : 'false');
    });
    applyPreviewColor(lower);
}

function activatePane(paneId) {
    $modal.find('.workshop-nav button').each(function () {
        $(this).toggleClass('active', $(this).attr('data-pane') === paneId);
    });
    $modal.find('.rpg-editor-pane').each(function () {
        $(this).toggleClass('active', $(this).attr('data-pane') === paneId);
    });
}

function bindStaticListeners() {
    $modal.on('click.cw', '.workshop-nav button', function () {
        const pane = $(this).attr('data-pane');
        if (pane) activatePane(pane);
    });

    $modal.on('click.cw', '#cw-close, #cw-cancel', () => closeCharacterWorkshop());
    $modal.on('click.cw', '#cw-hidden-restore', () => restoreCharacterToPanel());
    $modal.on('click.cw', function (e) {
        if (e.target === this) closeCharacterWorkshop();
    });

    $modal.on('click.cw', '.rpg-color-swatch', function () {
        if (!draft) return;
        const hex = $(this).attr('data-hex');
        if (!hex) return;
        commitColorSelection(hex);
    });

    // Relationship chip click — set persistent override. Click again to clear.
    $modal.on('click.cw', '.rpg-rel-chip', function () {
        if (!draft) return;
        const $chip = $(this);
        const picked = String($chip.attr('data-rel') || '');
        const current = String(draft.relationship || '');
        // Toggle off if they clicked the already-selected chip.
        const next = (current.toLowerCase() === picked.toLowerCase()) ? '' : picked;
        draft.relationship = next;
        draft.dirty.relationship = true;
        // Reflect immediately in the chip row and left-rail preview.
        $modal.find('.rpg-rel-chip').each(function () {
            const match = ($(this).attr('data-rel') || '').toLowerCase() === next.toLowerCase() && !!next;
            $(this).toggleClass('selected', match);
            $(this).attr('aria-checked', match ? 'true' : 'false');
        });
        const $rel = $modal.find('#cw-preview-rel');
        if (next) {
            const emoji = $chip.attr('data-emoji') || '';
            $rel.text(`${emoji} ${next}`.trim());
        } else {
            $rel.text('');
        }
    });

    // Custom-color dropper — opens the native color picker sheet.
    $modal.on('click.cw', '#cw-color-custom-btn', function (e) {
        e.preventDefault();
        const $input = $modal.find('#cw-color-custom-input');
        if (!$input.length) return;
        // Seed the picker with the draft's current color so it opens on it.
        if (draft?.color) $input.val(draft.color);
        $input[0].click();
    });
    $modal.on('input.cw change.cw', '#cw-color-custom-input', function () {
        if (!draft) return;
        const hex = String($(this).val() || '').toLowerCase();
        if (!/^#[0-9a-f]{6}$/.test(hex)) return;
        commitColorSelection(hex);
    });

    $modal.on('change.cw', '#cw-portrait-file', function () {
        if (!draft) return;
        const file = this.files && this.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
            const url = ev?.target?.result;
            if (typeof url !== 'string') return;
            draft.avatar = url;
            draft.avatarFullRes = url;
            draft.dirty.avatar = true;
            $modal.find('#cw-preview-img').attr('src', url).show();
            $modal.find('#cw-preview-placeholder').hide();
        };
        reader.onerror = () => console.warn('[Dooms Tracker] Failed to read portrait file');
        reader.readAsDataURL(file);
    });

    $modal.on('input.cw change.cw', '#cw-inj-description', function () {
        if (!draft) return;
        draft.injection.description = String($(this).val() || '');
        draft.dirty.injection = true;
    });

    // "Attach portrait to message" — global setting (not per-character).
    // Persisted immediately on toggle so it sticks even if the user closes
    // the Workshop with Cancel.
    $modal.on('change.cw', '#cw-inj-attach-portrait', function () {
        extensionSettings.injectAttachPortrait = $(this).prop('checked');
        try { saveSettings(); } catch (e) { console.warn('[Dooms Tracker] Workshop: failed to save injectAttachPortrait', e); }
    });

    // Combobox: open on focus / click, filter as the user types.
    $modal.on('focus.cw click.cw', '#cw-inj-lorebook', function () {
        openLorebookCombo();
    });
    $modal.on('input.cw', '#cw-inj-lorebook', function () {
        openLorebookCombo();
        renderLorebookComboList($(this).val());
        // Don't commit yet — only on selection or blur. But mark dirty so
        // a Save right after typing a literal name still persists.
        if (!draft) return;
        draft.injection.lorebook = String($(this).val() || '').trim();
        draft.dirty.injection = true;
    });
    $modal.on('keydown.cw', '#cw-inj-lorebook', function (e) {
        if (e.key === 'Escape') {
            e.stopPropagation();
            closeLorebookCombo();
        } else if (e.key === 'Enter') {
            e.preventDefault();
            // Pick the first match in the current filter.
            const first = $modal.find('#cw-inj-lorebook-list li[data-value]').first();
            if (first.length) commitLorebookSelection(first.attr('data-value') || '');
        }
    });
    $modal.on('click.cw', '#cw-inj-lorebook-toggle', function (e) {
        e.preventDefault();
        if ($modal.find('#cw-inj-lorebook-combo').hasClass('is-open')) {
            closeLorebookCombo();
        } else {
            openLorebookCombo();
            $modal.find('#cw-inj-lorebook').trigger('focus');
        }
    });
    $modal.on('mousedown.cw', '#cw-inj-lorebook-list li[data-value]', function (e) {
        e.preventDefault(); // keep input focus
        commitLorebookSelection($(this).attr('data-value') || '');
    });
    // Click outside the combobox closes it.
    $modal.on('click.cw', function (e) {
        if (!$modal.find('#cw-inj-lorebook-combo').hasClass('is-open')) return;
        if ($(e.target).closest('#cw-inj-lorebook-combo').length === 0) {
            closeLorebookCombo();
        }
    });

    $modal.on('click.cw', '#cw-open-expressions', () => {
        if (!draft) return;
        try {
            openExpressionFolder(draft.name);
        } catch (e) {
            console.warn('[Dooms Tracker] Workshop: openExpressionFolder failed', e);
        }
    });

    $modal.on('click.cw', '#cw-portrait-clear', () => {
        if (!draft) return;
        draft.avatar = '';
        draft.avatarFullRes = '';
        draft.dirty.avatar = true;
        $modal.find('#cw-portrait-file').val('');
        $modal.find('#cw-preview-img').removeAttr('src').hide();
        $modal.find('#cw-preview-placeholder').show();
    });

    $modal.on('click.cw', '#cw-save', () => {
        if (!draft) return;
        commitDraft();
        closeCharacterWorkshop();
    });

    $modal.on('click.cw', '#cw-inject', () => {
        if (!draft) return;
        commitDraft(); // persist any pending appearance edits first
        injectIntoScene(draft.name);
        closeCharacterWorkshop();
    });

    $modal.on('click.cw', '#cw-export', () => {
        if (!draft) return;
        try {
            exportDraft();
        } catch (e) {
            console.warn('[Dooms Tracker] Workshop: export failed', e);
            if (window.toastr) window.toastr.error('Export failed — see console for details.', 'Character Workshop');
        }
    });

    $modal.on('click.cw', '#cw-delete', () => {
        if (!draft) return;
        const name = draft.name;
        const ok = window.confirm(t(
            'characterWorkshop.confirmDelete',
            `Delete "{name}" from this chat's roster?\n\nThis removes the portrait, dialogue color, and known-character entry. Sheet data is kept.`,
            { name },
        ));
        if (!ok) return;
        deleteCharacter(name);
        closeCharacterWorkshop();
    });
}

function commitDraft() {
    if (!draft) return;
    const name = draft.name;
    let changed = false;

    if (draft.dirty.color) {
        if (!extensionSettings.characterColors) extensionSettings.characterColors = {};
        if (draft.color) {
            extensionSettings.characterColors[name] = draft.color;
        } else {
            delete extensionSettings.characterColors[name];
        }
        changed = true;
    }

    if (draft.dirty.avatar) {
        if (!extensionSettings.npcAvatars) extensionSettings.npcAvatars = {};
        if (!extensionSettings.npcAvatarsFullRes) extensionSettings.npcAvatarsFullRes = {};
        if (draft.avatar) {
            extensionSettings.npcAvatars[name] = draft.avatar;
            extensionSettings.npcAvatarsFullRes[name] = draft.avatarFullRes || draft.avatar;
        } else {
            delete extensionSettings.npcAvatars[name];
            delete extensionSettings.npcAvatarsFullRes[name];
        }
        changed = true;
    }

    if (draft.dirty.relationship) {
        if (!extensionSettings.characterRelationships) extensionSettings.characterRelationships = {};
        if (draft.relationship) {
            extensionSettings.characterRelationships[name] = draft.relationship;
        } else {
            delete extensionSettings.characterRelationships[name];
        }
        changed = true;
    }

    if (draft.dirty.injection) {
        if (!extensionSettings.characterInjection) extensionSettings.characterInjection = {};
        const desc = (draft.injection.description || '').trim();
        const book = (draft.injection.lorebook || '').trim();
        if (desc || book) {
            extensionSettings.characterInjection[name] = { description: desc, lorebook: book };
        } else {
            delete extensionSettings.characterInjection[name];
        }
        changed = true;
    }

    if (!changed) return;
    saveSettings();
    try {
        clearPortraitCache();
        updatePortraitBar();
    } catch (e) {
        console.warn('[Dooms Tracker] Workshop: failed to refresh portrait bar after save', e);
    }
}

function deleteCharacter(name) {
    if (extensionSettings.characterColors) delete extensionSettings.characterColors[name];
    if (extensionSettings.npcAvatars) delete extensionSettings.npcAvatars[name];
    if (extensionSettings.npcAvatarsFullRes) delete extensionSettings.npcAvatarsFullRes[name];
    if (extensionSettings.knownCharacters) delete extensionSettings.knownCharacters[name];
    if (extensionSettings.heroPositions) delete extensionSettings.heroPositions[name];
    // Match characterRoster.purgeCharacter — wipe Workshop-specific
    // injection extras too (description / lorebook attachment) so
    // delete-from-Workshop and delete-from-Roster are symmetric.
    if (extensionSettings.characterInjection) delete extensionSettings.characterInjection[name];
    if (extensionSettings.characterRelationships) delete extensionSettings.characterRelationships[name];
    saveSettings();
    try {
        clearPortraitCache();
        updatePortraitBar();
    } catch (e) {
        console.warn('[Dooms Tracker] Workshop: failed to refresh portrait bar after delete', e);
    }
}

/**
 * Bring the character into the current chat:
 *   1. Ensure the active known-characters map has them (chat-scoped if
 *      perChatCharacterTracking is on, global otherwise) so the portrait
 *      bar renders them immediately.
 *   2. Queue a one-shot extension prompt telling the AI to incorporate
 *      the character in the next response. The prompt self-clears on
 *      GENERATION_ENDED (see initCharacterWorkshop listener).
 */
function injectIntoScene(name) {
    const trimmed = String(name || '').trim();
    if (!trimmed) return;

    // 1. Roster membership + lift any soft-remove. If the user previously
    //    right-clicked 'Remove from panel' the name sits in removedCharacters;
    //    getCharacterList() filters those out AFTER the present-splice, so
    //    without this the injected card would never appear.
    try {
        const roster = getActiveKnownCharacters();
        if (!roster[trimmed]) {
            roster[trimmed] = { emoji: '❓' };
            saveCharacterRosterChange();
        }
        try {
            const removed = getActiveRemovedCharacters();
            if (Array.isArray(removed) && removed.length) {
                const lower = trimmed.toLowerCase();
                for (let i = removed.length - 1; i >= 0; i--) {
                    if (typeof removed[i] === 'string' && removed[i].toLowerCase() === lower) {
                        removed.splice(i, 1);
                    }
                }
                saveCharacterRosterChange();
            }
        } catch (e) { /* best-effort un-hide */ }
        clearPortraitCache();
        updatePortraitBar();
    } catch (e) {
        console.warn('[Dooms Tracker] Workshop: failed to add to roster before inject', e);
    }

    // 1b. Mark the character as PRESENT in the current scene immediately so
    //     the Present Characters panel highlights them right away, instead
    //     of waiting for the next AI turn to put them into characterThoughts.
    try { markCharacterPresentNow(trimmed); } catch (e) {
        console.warn('[Dooms Tracker] Workshop: failed to mark character present', e);
    }

    // 2. Resolve any persisted injection extras (description + lorebook + relationship).
    const stored = extensionSettings?.characterInjection?.[trimmed] || {};
    const description = (draft.injection?.description ?? stored.description ?? '').trim();
    const lorebook = (draft.injection?.lorebook ?? stored.lorebook ?? '').trim();
    const relationship = (draft.relationship || extensionSettings?.characterRelationships?.[trimmed] || '').trim();

    // 3. If a lorebook is attached and not already active, activate it so
    //    SillyTavern's WI engine pulls from it for the next generation.
    if (lorebook) {
        try {
            if (typeof isWorldActive === 'function' && !isWorldActive(lorebook)) {
                activateWorld(lorebook);
                console.log(`[Dooms Tracker] Workshop: activated lorebook "${lorebook}" for inject`);
            }
        } catch (e) {
            console.warn(`[Dooms Tracker] Workshop: failed to activate lorebook "${lorebook}"`, e);
        }
    }

    // 4. One-shot prompt
    const prompt = buildInjectPrompt(trimmed, { description, lorebook, relationship });
    try {
        setExtensionPrompt(
            INJECT_SLOT,
            prompt,
            extension_prompt_types.IN_PROMPT,
            0,
            false,
        );
        pendingInjectClear = true;
        // Allow the very next GENERATION_STARTED (the one this inject is
        // intended for) to pass without clearing. Any subsequent START
        // will trigger the clear.
        injectStartsToSkip = 1;
        console.log(`[Dooms Tracker] Workshop: queued scene-inject for "${trimmed}"`);
    } catch (e) {
        console.warn('[Dooms Tracker] Workshop: setExtensionPrompt failed', e);
    }

    // 5. Optional portrait attachment for vision-capable models. Arms a
    //    one-shot MESSAGE_SENT listener that stamps extra.image on the
    //    user's next outgoing message; SillyTavern's Generate then includes
    //    that image in the request payload (multimodal APIs only).
    let attached = false;
    let disarmAttach = null;
    if (extensionSettings?.injectAttachPortrait === true && draft?.avatar) {
        disarmAttach = armPortraitAttach(trimmed, draft.avatar);
        attached = true;
    }

    // 5b. Track this character as mid-inject so the portrait-bar can show
    //     an 'INJECTING' overlay and a right-click Cancel menu item.
    pendingInjects.set(trimmed.toLowerCase(), { name: trimmed, disarmAttach });
    broadcastInjectState(trimmed, true);

    // 6. User feedback
    try {
        if (window.toastr) {
            const extras = [];
            if (relationship) extras.push(`relationship=${relationship}`);
            if (description) extras.push('description');
            if (lorebook) extras.push(`lorebook "${lorebook}"`);
            if (attached) extras.push('portrait');
            const tail = extras.length ? ` (with ${extras.join(' + ')})` : '';
            window.toastr.success(
                `${trimmed} will be brought into the scene next turn${tail}.`,
                'Character Injected',
                { timeOut: 4000 },
            );
        }
    } catch (e) {
        // toastr optional
    }
}

/**
 * Mark a character as present in the live scene by splicing them into
 * lastGeneratedData.characterThoughts (the source of truth for
 * getCharacterList() and the Present Characters panel). Persists through
 * saveChatData so the state survives a reload until the next AI turn
 * either confirms or drops the character.
 */
function markCharacterPresentNow(name) {
    const trimmed = String(name || '').trim();
    if (!trimmed) return;

    const raw = lastGeneratedData?.characterThoughts;
    let parsed;
    try {
        parsed = (typeof raw === 'string' && raw)
            ? JSON.parse(raw)
            : (raw && typeof raw === 'object' ? raw : { characters: [] });
    } catch (e) {
        parsed = { characters: [] };
    }
    if (!parsed || typeof parsed !== 'object') parsed = { characters: [] };
    if (!Array.isArray(parsed.characters)) parsed.characters = [];

    const lower = trimmed.toLowerCase();
    const existing = parsed.characters.find(c => typeof c?.name === 'string' && c.name.toLowerCase() === lower);
    if (!existing) {
        // Build a minimal "present" entry. thoughts stays empty so the
        // existing off-scene pattern filter in getCharacterList doesn't
        // accidentally exclude them.
        const rel = extensionSettings?.characterRelationships?.[trimmed];
        parsed.characters.push({
            name: trimmed,
            emoji: '🙂',
            thoughts: { content: '' },
            ...(rel ? { relationship: { status: rel } } : {}),
        });
    }

    // Write back in the same shape the rest of the codebase expects
    // (characterThoughts is normally a JSON string).
    const serialized = JSON.stringify(parsed);
    try { updateLastGeneratedData({ characterThoughts: serialized }); }
    catch (e) { console.warn('[Dooms Tracker] Workshop: updateLastGeneratedData failed', e); }

    // Mirror the classic persistence pattern — write to chat_metadata so a
    // reload keeps the character in the panel until the AI updates it.
    try { saveChatData(); } catch (e) { /* best-effort */ }

    // Refresh the UI surfaces that key off the present list.
    try { clearPortraitCache(); updatePortraitBar(); } catch (e) {}
    try { renderThoughts(); } catch (e) {}
}

/**
 * Reverse of markCharacterPresentNow — removes the splice from
 * lastGeneratedData.characterThoughts so the character no longer appears
 * in the Present row. Best-effort; silent on any structural surprise.
 */
function unmarkCharacterPresentNow(name) {
    const trimmed = String(name || '').trim();
    if (!trimmed) return;
    const raw = lastGeneratedData?.characterThoughts;
    if (!raw) return;
    let parsed;
    try {
        parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch (e) { return; }
    if (!parsed || !Array.isArray(parsed.characters)) return;
    const lower = trimmed.toLowerCase();
    const before = parsed.characters.length;
    parsed.characters = parsed.characters.filter(c => typeof c?.name !== 'string' || c.name.toLowerCase() !== lower);
    if (parsed.characters.length === before) return;
    try { updateLastGeneratedData({ characterThoughts: JSON.stringify(parsed) }); } catch (e) {}
    try { saveChatData(); } catch (e) {}
    try { clearPortraitCache(); updatePortraitBar(); } catch (e) {}
    try { renderThoughts(); } catch (e) {}
}

/**
 * One-shot: when the user next sends a message, stamp the character's
 * portrait onto that message's `extra.image` so SillyTavern's Generate
 * includes the image in the outgoing request (vision-capable models).
 * Falls back silently if anything in the chain is missing.
 */
function armPortraitAttach(name, dataUrl) {
    let consumed = false;
    const disarm = () => {
        if (consumed) return;
        consumed = true;
        try { eventSource.removeListener?.(event_types.MESSAGE_SENT, onSent); } catch (e) {}
        try { eventSource.off?.(event_types.MESSAGE_SENT, onSent); } catch (e) {}
    };
    const onSent = () => {
        if (consumed) return;
        consumed = true;
        try { eventSource.removeListener?.(event_types.MESSAGE_SENT, onSent); } catch (e) {}
        try { eventSource.off?.(event_types.MESSAGE_SENT, onSent); } catch (e) {}
        try {
            const ctx = (typeof getContext === 'function') ? getContext() : null;
            const chat = ctx?.chat;
            if (!Array.isArray(chat) || chat.length === 0) return;
            const last = chat[chat.length - 1];
            if (!last || last.is_user === false) return;
            if (!last.extra || typeof last.extra !== 'object') last.extra = {};
            last.extra.image = dataUrl;
            last.extra.inline_image = true;
            console.log(`[Dooms Tracker] Workshop: attached "${name}" portrait to outgoing message`);
        } catch (e) {
            console.warn('[Dooms Tracker] Workshop: portrait attach failed', e);
        }
    };
    try {
        eventSource.on(event_types.MESSAGE_SENT, onSent);
    } catch (e) {
        console.warn('[Dooms Tracker] Workshop: failed to register MESSAGE_SENT for portrait attach', e);
    }
    // Self-disarm after 2 minutes if the user never sends a message.
    setTimeout(() => disarm(), 2 * 60 * 1000);
    return disarm;
}

function exportDraft() {
    if (!draft) return;
    const payload = {
        $schema: 'dooms-character-v1',
        name: draft.name,
        color: draft.color || '',
        avatar: draft.avatar || '',
        avatarFullRes: draft.avatarFullRes || '',
        relationship: draft.relationship || '',
        injection: {
            description: draft.injection?.description || '',
            lorebook: draft.injection?.lorebook || '',
        },
    };
    const json = JSON.stringify(payload, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const safeName = String(draft.name || 'character').replace(/[^\w.-]+/g, '_');
    const a = document.createElement('a');
    a.href = url;
    a.download = `character-${safeName}.json`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }, 100);
    if (window.toastr) {
        window.toastr.success(`Exported "${draft.name}" to character-${safeName}.json`, 'Character Workshop', { timeOut: 4000 });
    }
}

function buildInjectPrompt(name, extras) {
    const description = extras?.description || '';
    const lorebook = extras?.lorebook || '';
    const relationship = extras?.relationship || '';
    let out =
        `[SCENE DIRECTION — INJECT CHARACTER]\n` +
        `Incorporate the character "${name}" into your next response. ` +
        `Have them arrive, reveal themselves, or otherwise become present in a way that fits the current scene naturally. ` +
        `Include them in your presentCharacters tracker output for this turn.`;
    if (relationship) {
        out += `\n\nRelationship to the player: ${relationship}. Reflect this dynamic in how they act and speak.`;
    }
    if (description) {
        out += `\n\nCharacter notes for "${name}":\n${description}`;
    }
    if (lorebook) {
        out += `\n\nThe lorebook "${lorebook}" has been activated for additional context about this character; consult its entries as relevant.`;
    }
    out += `\n\nThis is a one-time direction from the user; do not mention these bracketed instructions in your reply.\n`;
    return out;
}

function clearInjectPromptIfPending() {
    if (!pendingInjectClear) return;
    try {
        setExtensionPrompt(INJECT_SLOT, '', extension_prompt_types.IN_PROMPT, 0, false);
        console.log('[Dooms Tracker] Workshop: cleared scene-inject prompt');
    } catch (e) {
        console.warn('[Dooms Tracker] Workshop: failed to clear inject prompt', e);
    } finally {
        pendingInjectClear = false;
        injectStartsToSkip = 0;
        // Inject completed naturally (AI responded) — mark everyone no-longer-pending.
        for (const [, entry] of pendingInjects) {
            broadcastInjectState(entry.name, false);
        }
        pendingInjects.clear();
    }
}

function onGenerationStartedForInject() {
    // The generation the inject is intended for should pass. After that,
    // any START means a NEW generation is happening (swipe / regenerate /
    // new turn) and we must not re-apply the old direction.
    if (injectStartsToSkip > 0) {
        injectStartsToSkip--;
        return;
    }
    if (pendingInjectClear) {
        console.log('[Dooms Tracker] Workshop: new generation starting — clearing stale inject');
        clearInjectPromptIfPending();
    }
}
