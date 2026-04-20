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

import { extensionSettings } from '../../core/state.js';
import {
    saveSettings,
    getActiveKnownCharacters,
    saveCharacterRosterChange,
} from '../../core/persistence.js';
import { clearPortraitCache, updatePortraitBar } from './portraitBar.js';
import { i18n } from '../../core/i18n.js';
import { getAllWorldNames, activateWorld, isWorldActive } from '../lorebook/lorebookAPI.js';
import {
    setExtensionPrompt,
    extension_prompt_types,
    eventSource,
    event_types,
} from '../../../../../../../script.js';

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
let pendingInjectClear = false; // true between inject click and next GENERATION_ENDED

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
    if (extensionSettings?.characterWorkshopEnabled === false) {
        console.log('[Dooms Tracker] Character Workshop disabled via setting, skipping init');
        return;
    }
    window.addEventListener('dooms:open-workshop', (e) => {
        const name = e?.detail?.characterName;
        if (name) openCharacterWorkshop(name);
    });
    // Clear the inject prompt after each generation so it's truly one-shot.
    try {
        eventSource.on(event_types.GENERATION_ENDED, clearInjectPromptIfPending);
        eventSource.on(event_types.GENERATION_STOPPED, clearInjectPromptIfPending);
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
        dirty: { color: false, avatar: false, injection: false },
    };
}

function resolveCurrentRelationship(name) {
    // Best-effort read of a volatile structure. Never throw.
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
    $modal.on('click.cw', function (e) {
        if (e.target === this) closeCharacterWorkshop();
    });

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

    // 1. Roster membership
    try {
        const roster = getActiveKnownCharacters();
        if (!roster[trimmed]) {
            roster[trimmed] = { emoji: '❓' };
            saveCharacterRosterChange();
        }
        clearPortraitCache();
        updatePortraitBar();
    } catch (e) {
        console.warn('[Dooms Tracker] Workshop: failed to add to roster before inject', e);
    }

    // 2. Resolve any persisted injection extras (description + lorebook).
    const stored = extensionSettings?.characterInjection?.[trimmed] || {};
    const description = (draft.injection?.description ?? stored.description ?? '').trim();
    const lorebook = (draft.injection?.lorebook ?? stored.lorebook ?? '').trim();

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
    const prompt = buildInjectPrompt(trimmed, { description, lorebook });
    try {
        setExtensionPrompt(
            INJECT_SLOT,
            prompt,
            extension_prompt_types.IN_PROMPT,
            0,
            false,
        );
        pendingInjectClear = true;
        console.log(`[Dooms Tracker] Workshop: queued scene-inject for "${trimmed}"`);
    } catch (e) {
        console.warn('[Dooms Tracker] Workshop: setExtensionPrompt failed', e);
    }

    // 5. User feedback
    try {
        if (window.toastr) {
            const extras = [];
            if (description) extras.push('description');
            if (lorebook) extras.push(`lorebook "${lorebook}"`);
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

function buildInjectPrompt(name, extras) {
    const description = extras?.description || '';
    const lorebook = extras?.lorebook || '';
    let out =
        `[SCENE DIRECTION — INJECT CHARACTER]\n` +
        `Incorporate the character "${name}" into your next response. ` +
        `Have them arrive, reveal themselves, or otherwise become present in a way that fits the current scene naturally. ` +
        `Include them in your presentCharacters tracker output for this turn.`;
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
        console.log('[Dooms Tracker] Workshop: cleared scene-inject prompt after generation');
    } catch (e) {
        console.warn('[Dooms Tracker] Workshop: failed to clear inject prompt', e);
    } finally {
        pendingInjectClear = false;
    }
}
