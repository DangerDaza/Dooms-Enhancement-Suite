/**
 * Character Workshop — unified per-character editor modal.
 *
 * v1 scope: Identity (read-only name + relationship), Appearance (portrait
 * upload + dialogue color). Sheet tab fills in cw-6. Trackers tab is a
 * placeholder until cw-7.
 *
 * Opening is decoupled from portraitBar.js via a window CustomEvent
 * ('dooms:open-workshop') so portraitBar does not import this module.
 */

import { extensionSettings } from '../../core/state.js';
import { saveSettings } from '../../core/persistence.js';
import { clearPortraitCache, updatePortraitBar } from './portraitBar.js';

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

// Per-session draft. Cleared/reinitialized every time the modal opens.
let draft = null;

// Modal element handle — jQuery, resolved once on first open.
let $modal = null;
// Tracks whether listeners have been bound so reopens don't re-bind.
let listenersBound = false;

/**
 * Register the workshop's window event listener. Called once from
 * index.js initUI(). Respects extensionSettings.characterWorkshopEnabled
 * as a kill switch — if false, does nothing.
 */
export function initCharacterWorkshop() {
    if (extensionSettings?.characterWorkshopEnabled === false) {
        console.log('[Dooms Tracker] Character Workshop disabled via setting, skipping init');
        return;
    }
    window.addEventListener('dooms:open-workshop', (e) => {
        const name = e?.detail?.characterName;
        if (name) openCharacterWorkshop(name);
    });
}

/**
 * Open the workshop for the named character.
 */
export function openCharacterWorkshop(characterName) {
    if (!characterName) {
        console.warn('[Dooms Tracker] openCharacterWorkshop called without a name');
        return;
    }
    if (!ensureModal()) return;

    // Snapshot current persisted state into a local draft.
    draft = buildDraft(characterName);

    // Populate UI from draft.
    renderTitle();
    renderIdentity();
    renderAppearance();
    // Sheet + Trackers rendering lands in cw-6 and cw-7.

    // Reset to the Identity pane every open.
    activatePane('identity');

    if (!listenersBound) {
        bindStaticListeners();
        listenersBound = true;
    }

    // Mirrors trackerEditor.js:237
    $modal.addClass('is-open').css('display', '');
}

/**
 * Close the workshop. Mirrors trackerEditor.js:242-255.
 */
export function closeCharacterWorkshop() {
    if (!$modal || !$modal.length) return;
    $modal.removeClass('is-open').addClass('is-closing');
    setTimeout(() => {
        $modal.removeClass('is-closing').hide();
    }, 200);
    // Drop the draft so reopening always reads fresh.
    draft = null;
}

// ---------------------------------------------------------------------------
// Internals
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
    const color = extensionSettings?.characterColors?.[name] || '';
    const avatar = extensionSettings?.npcAvatars?.[name] || '';
    const avatarFullRes = extensionSettings?.npcAvatarsFullRes?.[name] || '';
    // Relationship: read-only in v1. Source is lastGeneratedData which is
    // volatile and may not be available at workshop-open time; we fall back
    // to empty and the UI simply shows no chip selected.
    const relationship = resolveCurrentRelationship(name);
    return {
        name,
        color,
        avatar,
        avatarFullRes,
        relationship,
        dirty: { color: false, avatar: false },
    };
}

function resolveCurrentRelationship(name) {
    // In v1 this is display-only. If the structure isn't there, return ''.
    try {
        // lastGeneratedData lives in state.js but relationship is parsed
        // from a JSON-encoded string inside characterThoughts. Best-effort
        // only — never throw.
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

function renderIdentity() {
    $modal.find('#cw-name').val(draft.name);
    const rel = (draft.relationship || '').toLowerCase();
    $modal.find('.rpg-rel-chip').each(function () {
        const $chip = $(this);
        const matches = ($chip.attr('data-rel') || '').toLowerCase() === rel;
        $chip.toggleClass('selected', matches);
        $chip.attr('aria-checked', matches ? 'true' : 'false');
        // Read-only in v1 — visual only, no clicks wired here.
    });
    // Update the left-rail preview rel text + color dot.
    const $rel = $modal.find('#cw-preview-rel');
    if (draft.relationship) {
        // Emoji lookup from chip attribute
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
    // Portrait preview
    const $img = $modal.find('#cw-preview-img');
    const $placeholder = $modal.find('#cw-preview-placeholder');
    if (draft.avatar) {
        $img.attr('src', draft.avatar).show();
        $placeholder.hide();
    } else {
        $img.removeAttr('src').hide();
        $placeholder.show();
    }
    // Palette — rebuild once per open so the selected swatch matches draft.
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

function applyPreviewColor(hex) {
    $modal.find('#cw-preview-card-name').css('color', hex);
    $modal.find('#cw-preview-name').css('color', hex);
    $modal.find('#cw-preview-color-dot').css('background', hex);
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
    // Section nav
    $modal.on('click.cw', '.workshop-nav button', function () {
        const pane = $(this).attr('data-pane');
        if (pane) activatePane(pane);
    });

    // Close / Cancel buttons — both discard.
    $modal.on('click.cw', '#cw-close, #cw-cancel', () => closeCharacterWorkshop());

    // Click on backdrop (::before pseudo-element counts as the modal root itself)
    $modal.on('click.cw', function (e) {
        if (e.target === this) closeCharacterWorkshop();
    });

    // Dialogue color swatch click
    $modal.on('click.cw', '.rpg-color-swatch', function () {
        if (!draft) return;
        const hex = $(this).attr('data-hex');
        if (!hex) return;
        draft.color = hex;
        draft.dirty.color = true;
        $modal.find('.rpg-color-swatch').each(function () {
            const selected = $(this).attr('data-hex') === hex;
            $(this).toggleClass('selected', selected);
            $(this).attr('aria-checked', selected ? 'true' : 'false');
        });
        applyPreviewColor(hex);
    });

    // Portrait upload
    $modal.on('change.cw', '#cw-portrait-file', function () {
        if (!draft) return;
        const file = this.files && this.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
            const url = ev?.target?.result;
            if (typeof url !== 'string') return;
            draft.avatar = url;
            draft.avatarFullRes = url; // v1 stores same image for both.
            draft.dirty.avatar = true;
            $modal.find('#cw-preview-img').attr('src', url).show();
            $modal.find('#cw-preview-placeholder').hide();
        };
        reader.onerror = () => console.warn('[Dooms Tracker] Failed to read portrait file');
        reader.readAsDataURL(file);
    });

    // Remove portrait
    $modal.on('click.cw', '#cw-portrait-clear', () => {
        if (!draft) return;
        draft.avatar = '';
        draft.avatarFullRes = '';
        draft.dirty.avatar = true;
        $modal.find('#cw-portrait-file').val('');
        $modal.find('#cw-preview-img').removeAttr('src').hide();
        $modal.find('#cw-preview-placeholder').show();
    });

    // Save
    $modal.on('click.cw', '#cw-save', () => {
        if (!draft) return;
        commitDraft();
        closeCharacterWorkshop();
    });

    // Delete character (confirm first, destructive)
    $modal.on('click.cw', '#cw-delete', () => {
        if (!draft) return;
        const name = draft.name;
        const ok = window.confirm(`Delete "${name}" from this chat's roster?\n\nThis removes the portrait, dialogue color, and known-character entry. Sheet data is kept.`);
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
    saveSettings();
    try {
        clearPortraitCache();
        updatePortraitBar();
    } catch (e) {
        console.warn('[Dooms Tracker] Workshop: failed to refresh portrait bar after delete', e);
    }
}
