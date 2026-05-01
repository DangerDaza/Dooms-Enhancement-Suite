/**
 * Character Roster — list view of all known characters.
 *
 * Opens from the "Open Character Roster" button in the DES settings popup
 * (#rpg-open-character-roster). Renders a grid of tiles: one "+ New
 * Character" tile first, then every character in the union of
 *   extensionSettings.knownCharacters
 *   extensionSettings.characterColors
 *   extensionSettings.npcAvatars
 * (the union is to include orphans that have portraits/colors but no
 * roster entry). Click a tile to open the Character Workshop for that
 * character via the same window CustomEvent the portrait-bar menu uses
 * ('dooms:open-workshop'), so this module does not need to import
 * characterWorkshop.js.
 */

import { extensionSettings } from '../../core/state.js';
import { saveSettings } from '../../core/persistence.js';
import { clearPortraitCache, updatePortraitBar, getCharacterList } from './portraitBar.js';
import { power_user } from '../../../../../../power-user.js';

let contextMenuTarget = ''; // character name currently under right-click

const REL_EMOJI = {
    Lover: '❤️',
    Friend: '⭐',
    Ally: '🤝',
    Enemy: '⚔️',
    Neutral: '⚖️',
};

let $modal = null;
let listenersBound = false;
let _crInitialized = false; // guard: don't double-register document/window listeners
let searchQuery = '';
let scope = 'all'; // 'all' | 'chat' | 'active'
let rosterMode = 'characters'; // 'characters' (NPCs) | 'users' (player characters)

function isPinned(name) {
    const list = extensionSettings?.pinnedCharacters;
    if (!Array.isArray(list) || !name) return false;
    const lower = name.toLowerCase();
    return list.some(n => typeof n === 'string' && n.toLowerCase() === lower);
}
function togglePin(name) {
    if (!name) return;
    if (!Array.isArray(extensionSettings.pinnedCharacters)) {
        extensionSettings.pinnedCharacters = [];
    }
    const list = extensionSettings.pinnedCharacters;
    const lower = name.toLowerCase();
    const idx = list.findIndex(n => typeof n === 'string' && n.toLowerCase() === lower);
    if (idx >= 0) list.splice(idx, 1);
    else list.push(name);
    saveSettings();
}

export function initCharacterRoster() {
    // Roster is part of the Present Characters Panel feature set; when
    // PCP is off there's nothing to roster.
    if (extensionSettings?.showPortraitBar === false) {
        console.log('[Dooms Tracker] Character Roster disabled (Present Characters Panel off), skipping init');
        return;
    }
    // Idempotency guard: prevent double-registration of the settings-button
    // click delegate and the window 'dooms:open-roster' listener if init
    // runs twice.
    if (_crInitialized) return;
    _crInitialized = true;
    // The button lives inside the settings popup template; delegate from
    // document so we catch clicks even if the popup is re-rendered.
    $(document).on('click.cr', '#rpg-open-character-roster', () => openCharacterRoster());
    // Portrait-bar header button opens via a decoupled window event so
    // portraitBar.js doesn't need to import this module.
    window.addEventListener('dooms:open-roster', () => openCharacterRoster());
}

export function openCharacterRoster() {
    if (!ensureModal()) return;
    if (!listenersBound) {
        bindListeners();
        listenersBound = true;
    }
    searchQuery = '';
    scope = 'all';
    rosterMode = 'characters';
    $modal.find('#cr-search').val('');
    $modal.find('.cr-scope-pill').each(function () {
        const isActive = $(this).attr('data-scope') === 'all';
        $(this).toggleClass('is-active', isActive).attr('aria-selected', isActive ? 'true' : 'false');
    });
    $modal.find('.cr-mode-pill').each(function () {
        const isActive = $(this).attr('data-mode') === 'characters';
        $(this).toggleClass('is-active', isActive).attr('aria-selected', isActive ? 'true' : 'false');
    });
    $modal.attr('data-mode', 'characters');
    $modal.find('#cr-title').text('Character Roster');
    $modal.find('#cr-import-personas-btn').hide();
    renderGrid();
    // Apply the active DES theme so the theme-specific token overrides
    // take effect (matches trackerEditor / settings popup convention).
    $modal.attr('data-theme', extensionSettings?.theme || 'default');
    $modal.addClass('is-open').css('display', '');
}

export function closeCharacterRoster() {
    if (!$modal || !$modal.length) return;
    $modal.removeClass('is-open').addClass('is-closing');
    setTimeout(() => $modal.removeClass('is-closing').hide(), 200);
}

// ---------------------------------------------------------------------------

function ensureModal() {
    if ($modal && $modal.length) return true;
    $modal = $('#character-roster-popup');
    if (!$modal.length) {
        console.warn('[Dooms Tracker] #character-roster-popup not in DOM — template.html missing block?');
        $modal = null;
        return false;
    }
    return true;
}

function bindListeners() {
    // Close controls
    $modal.on('click.cr', '#cr-close, #cr-footer-close', () => closeCharacterRoster());
    $modal.on('click.cr', function (e) {
        if (e.target === this) closeCharacterRoster();
    });
    // Esc key while modal is open
    $(document).on('keydown.cr', (e) => {
        if (e.key !== 'Escape') return;
        // If the new-character dialog is open, Esc only closes that.
        if (!$modal.find('#cr-newchar-overlay').prop('hidden')) {
            closeNewCharacterDialog();
            return;
        }
        // If the context menu is open, Esc only closes that.
        if (!$modal.find('#cr-context-menu').prop('hidden')) {
            hideContextMenu();
            return;
        }
        if ($modal.hasClass('is-open')) closeCharacterRoster();
    });

    // Right-click a tile → open contextual menu
    $modal.on('contextmenu.cr', '.cr-tile[data-character]', function (e) {
        e.preventDefault();
        e.stopPropagation();
        contextMenuTarget = $(this).attr('data-character') || '';
        showContextMenu(e.clientX, e.clientY);
    });
    // Plain left-click anywhere in the modal hides the menu if open.
    $modal.on('mousedown.cr', function (e) {
        if ($(e.target).closest('#cr-context-menu').length) return;
        hideContextMenu();
    });
    // Act on menu item
    $modal.on('click.cr', '.cr-context-item', function () {
        const action = $(this).attr('data-action');
        const name = contextMenuTarget;
        hideContextMenu();
        if (!name) return;
        const isUser = rosterMode === 'users';
        if (action === 'edit') {
            closeCharacterRoster();
            setTimeout(() => {
                window.dispatchEvent(new CustomEvent('dooms:open-workshop', { detail: { characterName: name, isUser } }));
            }, 220);
        } else if (action === 'pin') {
            togglePin(name);
            renderGrid();
        } else if (action === 'delete') {
            confirmAndDelete(name);
        }
    });

    // Live search
    $modal.on('input.cr', '#cr-search', function () {
        searchQuery = ($(this).val() || '').toString().trim().toLowerCase();
        renderGrid();
    });

    // Scope pills
    $modal.on('click.cr', '.cr-scope-pill', function () {
        const next = $(this).attr('data-scope') || 'all';
        if (next === scope) return;
        scope = next;
        $modal.find('.cr-scope-pill').each(function () {
            const isActive = $(this).attr('data-scope') === scope;
            $(this).toggleClass('is-active', isActive).attr('aria-selected', isActive ? 'true' : 'false');
        });
        renderGrid();
    });

    // Mode pills (Characters / Users) — flips the roster's data source
    $modal.on('click.cr', '.cr-mode-pill', function () {
        const next = $(this).attr('data-mode') || 'characters';
        if (next === rosterMode) return;
        rosterMode = next;
        $modal.find('.cr-mode-pill').each(function () {
            const isActive = $(this).attr('data-mode') === rosterMode;
            $(this).toggleClass('is-active', isActive).attr('aria-selected', isActive ? 'true' : 'false');
        });
        $modal.attr('data-mode', rosterMode);
        // Title & footer affordances follow the mode
        $modal.find('#cr-title').text(rosterMode === 'users' ? 'User Characters' : 'Character Roster');
        $modal.find('#cr-import-personas-btn').toggle(rosterMode === 'users');
        // The "active in scene" scope doesn't apply to user characters —
        // CSS hides the pill, but if it was selected we fall back to "all".
        if (rosterMode === 'users' && scope === 'active') {
            scope = 'all';
            $modal.find('.cr-scope-pill').each(function () {
                const isActive = $(this).attr('data-scope') === scope;
                $(this).toggleClass('is-active', isActive).attr('aria-selected', isActive ? 'true' : 'false');
            });
        }
        renderGrid();
    });

    // Click a character tile → open Workshop for that name
    $modal.on('click.cr', '.cr-tile[data-character]', function () {
        const name = $(this).attr('data-character');
        if (!name) return;
        closeCharacterRoster();
        const isUser = rosterMode === 'users';
        // Defer so this modal's fade-out doesn't overlap the Workshop's fade-in
        setTimeout(() => {
            window.dispatchEvent(new CustomEvent('dooms:open-workshop', { detail: { characterName: name, isUser } }));
        }, 220);
    });

    // "+ New Character" tile
    $modal.on('click.cr', '.cr-tile-new', () => handleNewCharacter());

    // Import from JSON file
    $modal.on('click.cr', '#cr-import-btn', () => {
        $modal.find('#cr-import-file').val('').trigger('click');
    });

    // Import user characters from SillyTavern personas (Users mode only)
    $modal.on('click.cr', '#cr-import-personas-btn', () => {
        importFromSillyTavernPersonas();
    });
    $modal.on('change.cr', '#cr-import-file', function () {
        const file = this.files && this.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
            try {
                const payload = JSON.parse(String(ev?.target?.result || ''));
                importCharacterPayload(payload);
            } catch (err) {
                console.warn('[Dooms Tracker] Roster: import JSON parse failed', err);
                if (window.toastr) window.toastr.error('Could not read that file — make sure it\'s a valid character JSON export.', 'Import failed');
            }
            this.value = '';
        };
        reader.onerror = () => {
            if (window.toastr) window.toastr.error('Failed to read the selected file.', 'Import failed');
        };
        reader.readAsText(file);
    });

    // Inline new-character dialog
    $modal.on('click.cr', '#cr-newchar-cancel', () => closeNewCharacterDialog());
    $modal.on('click.cr', '#cr-newchar-create', () => commitNewCharacter());
    $modal.on('keydown.cr', '#cr-newchar-input', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); commitNewCharacter(); }
        else if (e.key === 'Escape') { e.stopPropagation(); closeNewCharacterDialog(); }
    });
    // Backdrop click closes the inline dialog (but not the roster itself).
    $modal.on('click.cr', '#cr-newchar-overlay', function (e) {
        if (e.target === this) closeNewCharacterDialog();
    });
}

function handleNewCharacter() {
    // Open the inline dialog. Actual creation happens in
    // commitNewCharacter() wired to the Create button / Enter key.
    const $dialog = $modal.find('#cr-newchar-overlay');
    const $input = $modal.find('#cr-newchar-input');
    const $error = $modal.find('#cr-newchar-error');
    if (!$dialog.length) {
        console.warn('[Dooms Tracker] Roster: #cr-newchar-overlay not in DOM');
        return;
    }
    $input.val('');
    $error.prop('hidden', true).text('');
    $dialog.prop('hidden', false);
    // Defer focus so the dialog is visible first on slow mobile browsers.
    setTimeout(() => $input.trigger('focus'), 0);
}

function closeNewCharacterDialog() {
    const $dialog = $modal?.find('#cr-newchar-overlay');
    if ($dialog && $dialog.length) $dialog.prop('hidden', true);
}

function commitNewCharacter() {
    const $input = $modal.find('#cr-newchar-input');
    const $error = $modal.find('#cr-newchar-error');
    const raw = String($input.val() || '');
    const trimmed = raw.trim();
    if (!trimmed) {
        $error.prop('hidden', false).text('Name is required.');
        return;
    }
    const existing = collectCharacterNames();
    const clash = existing.find(n => n.toLowerCase() === trimmed.toLowerCase());
    if (clash) {
        $error.prop('hidden', false).text(`A character named "${clash}" already exists.`);
        return;
    }
    if (rosterMode === 'users') {
        if (!extensionSettings.userCharacters) extensionSettings.userCharacters = {};
        extensionSettings.userCharacters[trimmed] = {
            color: '', avatar: '', avatarFullRes: '', pronouns: '', linkedPersona: '',
            injection: { description: '', lorebook: '' },
        };
        saveSettings();
    } else {
        if (!extensionSettings.knownCharacters) extensionSettings.knownCharacters = {};
        extensionSettings.knownCharacters[trimmed] = { emoji: '❓' };
        saveSettings();
        try {
            clearPortraitCache();
            updatePortraitBar();
        } catch (e) {
            console.warn('[Dooms Tracker] Roster: failed to refresh portrait bar after new character', e);
        }
    }
    closeNewCharacterDialog();
    closeCharacterRoster();
    const isUser = rosterMode === 'users';
    setTimeout(() => {
        window.dispatchEvent(new CustomEvent('dooms:open-workshop', { detail: { characterName: trimmed, isUser } }));
    }, 220);
}

/**
 * Union of every character name that has any persisted state in the
 * extension. Defensive against orphans (e.g. a color set for a character
 * that was removed from knownCharacters). When the roster is in "users"
 * mode, returns the user-character names instead.
 */
function collectCharacterNames() {
    if (rosterMode === 'users') {
        const uc = extensionSettings?.userCharacters;
        if (!uc || typeof uc !== 'object') return [];
        return Object.keys(uc).filter(n => n && typeof n === 'string');
    }
    const set = new Set();
    const sources = [
        extensionSettings?.knownCharacters,
        extensionSettings?.characterColors,
        extensionSettings?.npcAvatars,
    ];
    for (const src of sources) {
        if (!src || typeof src !== 'object') continue;
        for (const name of Object.keys(src)) {
            if (name && typeof name === 'string') set.add(name);
        }
    }
    return Array.from(set);
}

function resolveRelationshipEmoji(name) {
    // Persistent user-set override wins over the AI's per-turn classification.
    const override = extensionSettings?.characterRelationships?.[name];
    if (override && REL_EMOJI[override]) return REL_EMOJI[override];
    // Fallback: best-effort read from volatile lastGeneratedData.
    try {
        const raw = window?.dooms_lastGeneratedData?.characterThoughts;
        if (!raw) return '';
        const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
        const list = parsed?.characters || [];
        const found = list.find(c => c?.name === name);
        const rel = found?.relationship?.status;
        return rel && REL_EMOJI[rel] ? REL_EMOJI[rel] : '';
    } catch (e) {
        return '';
    }
}

function renderGrid() {
    const $grid = $modal.find('#cr-grid').empty();
    const $empty = $modal.find('#cr-empty');

    // Pull this-chat and active scopes once per render. Both come from
    // getCharacterList(), which merges the current chat's present +
    // absent characters.
    const chatNames = new Set();   // all characters in this chat's panel
    const activeSet = new Set();   // subset: currently in scene
    try {
        const list = getCharacterList() || [];
        for (const c of list) {
            if (!c?.name) continue;
            const key = c.name.toLowerCase();
            chatNames.add(key);
            if (c.present) activeSet.add(key);
        }
    } catch (e) {
        console.warn('[Dooms Tracker] Roster: getCharacterList failed', e);
    }

    // The "+ New Character" tile is always present regardless of search/scope.
    $grid.append(
        `<button type="button" class="cr-tile cr-tile-new" role="listitem" aria-label="New character">
            <i class="fa-solid fa-plus" aria-hidden="true"></i>
            <span>+ New Character</span>
        </button>`
    );

    const allNames = collectCharacterNames().sort((a, b) => {
        // Pinned first (alphabetical among themselves), then unpinned
        // (also alphabetical). Pin state is case-insensitive.
        const pa = isPinned(a), pb = isPinned(b);
        if (pa && !pb) return -1;
        if (!pa && pb) return 1;
        return a.localeCompare(b);
    });
    const scopeFiltered = allNames.filter(n => {
        if (scope === 'chat') return chatNames.has(n.toLowerCase());
        if (scope === 'active') return activeSet.has(n.toLowerCase());
        return true;
    });
    const filtered = searchQuery
        ? scopeFiltered.filter(n => n.toLowerCase().includes(searchQuery))
        : scopeFiltered;

    for (const name of filtered) {
        $grid.append(buildTile(name, activeSet.has(name.toLowerCase())));
    }

    // Count badge — total in current scope, plus active count when any.
    const total = scopeFiltered.length;
    const activeCount = scopeFiltered.reduce((n, name) => n + (activeSet.has(name.toLowerCase()) ? 1 : 0), 0);
    const activeTxt = activeCount > 0 && scope !== 'active' ? ` · ${activeCount} active` : '';
    const scopeTxt = scope === 'chat' ? ' in this chat' : scope === 'active' ? ' active' : '';
    $modal.find('#cr-count').text(`${total} ${total === 1 ? 'character' : 'characters'}${scopeTxt}${activeTxt}`);

    // Empty state: triggered by either an empty scope or a zero-result search.
    const noResults = filtered.length === 0;
    $empty.prop('hidden', !noResults);
    if (noResults) {
        const msg = scope === 'chat'
            ? 'No characters in this chat yet.'
            : scope === 'active'
            ? 'No characters currently in the scene.'
            : 'No characters match that search.';
        $empty.find('p').text(msg);
    }
}

function buildTile(name, isActive) {
    // In user-character mode the data lives in a single namespace.
    const isUserMode = rosterMode === 'users';
    const userEntry = isUserMode ? (extensionSettings?.userCharacters?.[name] || {}) : null;
    const avatar = isUserMode
        ? (userEntry.avatar || '')
        : (extensionSettings?.npcAvatars?.[name] || '');
    const color = isUserMode
        ? (userEntry.color || '')
        : (extensionSettings?.characterColors?.[name] || '');
    const relEmoji = isUserMode ? '' : resolveRelationshipEmoji(name);
    const isActiveUser = isUserMode && extensionSettings?.activeUserCharacter === name;
    const safeName = escapeHtml(name);
    const safeNameAttr = escapeAttr(name);
    const activeSuffix = isActive ? ' (active in chat)' : '';
    const safeLabel = escapeAttr(`Open ${name} in Workshop${activeSuffix}`);
    const imgHtml = avatar
        ? `<img src="${escapeAttr(avatar)}" alt="">`
        : `<div class="cr-placeholder" aria-hidden="true">&#128100;</div>`;
    const dotHtml = color
        ? `<span class="cr-tile-dot" style="background:${escapeAttr(color)};" aria-hidden="true"></span>`
        : '';
    const relHtml = relEmoji
        ? `<span class="cr-tile-rel" aria-hidden="true">${relEmoji}</span>`
        : '';
    const activeBadge = isActive
        ? `<span class="cr-tile-active-badge" title="Currently in scene">
                <span class="cr-tile-active-dot"></span>
                <span class="cr-tile-active-label">ACTIVE</span>
            </span>`
        : '';
    const pinned = isPinned(name);
    const pinBadge = pinned
        ? `<span class="cr-tile-pin" title="Pinned"><i class="fa-solid fa-thumbtack" aria-hidden="true"></i></span>`
        : '';
    const activeClass = (isActive ? ' cr-tile-active' : '') + (pinned ? ' cr-tile-pinned' : '');
    const userBadge = isUserMode
        ? `<span class="cr-tile-user-badge">${isActiveUser ? '★ Active' : 'User'}</span>`
        : '';
    return (
        `<button type="button" class="cr-tile${activeClass}" role="listitem" data-character="${safeNameAttr}" aria-label="${safeLabel}">
            ${imgHtml}
            ${relHtml}
            ${dotHtml}
            ${pinBadge}
            ${activeBadge}
            ${userBadge}
            <span class="cr-tile-name">${safeName}</span>
        </button>`
    );
}

function escapeAttr(s) {
    return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function showContextMenu(x, y) {
    const $menu = $modal.find('#cr-context-menu');
    if (!$menu.length) return;
    // Update the Pin menu label based on the currently-targeted character.
    const pinned = contextMenuTarget && isPinned(contextMenuTarget);
    $menu.find('.cr-context-pin-label').text(pinned ? 'Unpin' : 'Pin to top');
    $menu.find('[data-action="pin"] i')
        .toggleClass('fa-thumbtack', true)
        .css('transform', pinned ? 'rotate(45deg)' : '');
    $menu.css({ visibility: 'hidden' }).prop('hidden', false);
    // Clamp to viewport so the menu doesn't spill off the screen.
    const menuW = $menu.outerWidth() || 180;
    const menuH = $menu.outerHeight() || 80;
    const maxX = window.innerWidth - menuW - 6;
    const maxY = window.innerHeight - menuH - 6;
    $menu.css({
        left: Math.max(6, Math.min(x, maxX)) + 'px',
        top: Math.max(6, Math.min(y, maxY)) + 'px',
        visibility: 'visible',
    });
}

function hideContextMenu() {
    const $menu = $modal?.find('#cr-context-menu');
    if ($menu && $menu.length) $menu.prop('hidden', true);
    contextMenuTarget = '';
}

function confirmAndDelete(name) {
    const ok = window.confirm(
        `Delete "${name}" from this chat's roster?\n\n` +
        `Removes the portrait, dialogue color, relationship/hero position, ` +
        `known-character entry, and any Workshop injection extras (description / lorebook). ` +
        `Sheet data is kept.`
    );
    if (!ok) return;
    purgeCharacter(name);
    renderGrid();
    try {
        clearPortraitCache();
        updatePortraitBar();
    } catch (e) {
        console.warn('[Dooms Tracker] Roster: failed to refresh portrait bar after delete', e);
    }
    try {
        if (window.toastr) window.toastr.info(`Deleted "${name}".`, 'Roster', { timeOut: 3000 });
    } catch (e) {}
}

/**
 * Import every SillyTavern persona as a user character. Reads from
 * window.power_user.personas (a map of avatar filename → persona name).
 * Skips personas whose name already exists in userCharacters.
 */
function importFromSillyTavernPersonas() {
    // power_user is imported at module top — fall through to the window
    // reference in case ST exposes it that way on some forks.
    const pu = power_user || (typeof window !== 'undefined' && window.power_user) || null;
    const personas = (pu && pu.personas) || {};
    const personaDescs = (pu && pu.persona_descriptions) || {};
    const entries = Object.entries(personas).filter(([avatarFile, name]) => avatarFile && name);
    if (!entries.length) {
        try {
            if (window.toastr) {
                window.toastr.info('No SillyTavern personas found.', 'Import', { timeOut: 4000 });
            } else {
                window.alert('No SillyTavern personas found.');
            }
        } catch (e) {}
        return;
    }
    if (!extensionSettings.userCharacters) extensionSettings.userCharacters = {};
    const existingNames = new Set(Object.keys(extensionSettings.userCharacters).map(n => n.toLowerCase()));
    const toImport = entries.filter(([, name]) => !existingNames.has(String(name).toLowerCase()));
    const skipped = entries.length - toImport.length;
    if (!toImport.length) {
        try {
            if (window.toastr) {
                window.toastr.info(
                    `All ${entries.length} persona${entries.length === 1 ? '' : 's'} already exist as user characters.`,
                    'Import',
                    { timeOut: 4000 },
                );
            }
        } catch (e) {}
        return;
    }
    const lines = toImport.map(([, name]) => `  • ${name}`).join('\n');
    const msg = `Import ${toImport.length} persona${toImport.length === 1 ? '' : 's'} as user character${toImport.length === 1 ? '' : 's'}?\n\n${lines}` +
        (skipped > 0 ? `\n\n(${skipped} already exist as user character${skipped === 1 ? '' : 's'} and will be skipped.)` : '');
    if (!window.confirm(msg)) return;
    for (const [avatarFile, name] of toImport) {
        const description = typeof personaDescs[avatarFile] === 'object'
            ? (personaDescs[avatarFile]?.description || '')
            : (personaDescs[avatarFile] || '');
        // ST serves persona avatars from /User Avatars/<filename>. The
        // filename may contain spaces, so encode each segment.
        const avatarUrl = '/User%20Avatars/' + encodeURIComponent(avatarFile);
        extensionSettings.userCharacters[name] = {
            color: '',
            avatar: avatarUrl,
            avatarFullRes: avatarUrl,
            pronouns: '',
            linkedPersona: avatarFile,
            injection: { description: String(description || '').trim(), lorebook: '' },
        };
    }
    saveSettings();
    renderGrid();
    try {
        if (window.toastr) {
            window.toastr.success(
                `Imported ${toImport.length} persona${toImport.length === 1 ? '' : 's'}.`,
                'Roster',
                { timeOut: 4000 },
            );
        }
    } catch (e) {}
}

/**
 * Ingest a parsed character JSON payload (from Workshop's Export).
 * Shape is validated loosely — only string fields are copied, and the
 * caller may conflict-resolve by choosing to overwrite or rename.
 */
function importCharacterPayload(payload) {
    if (!payload || typeof payload !== 'object') {
        if (window.toastr) window.toastr.error('File isn\'t a character export.', 'Import failed');
        return;
    }
    const rawName = typeof payload.name === 'string' ? payload.name.trim() : '';
    if (!rawName) {
        if (window.toastr) window.toastr.error('Export is missing a character name.', 'Import failed');
        return;
    }

    // Conflict detection: if a character with this name (case-insensitive)
    // already exists in any store we'd write to, prompt the user.
    const existing = collectCharacterNames();
    const clash = existing.find(n => n.toLowerCase() === rawName.toLowerCase());

    let targetName = rawName;
    if (clash) {
        const choice = window.confirm(
            `A character named "${clash}" already exists.\n\n` +
            `OK  = overwrite "${clash}" with the imported data\n` +
            `Cancel = import under a new name ("${rawName} (imported)")`
        );
        if (!choice) {
            targetName = `${rawName} (imported)`;
            let suffix = 2;
            while (existing.some(n => n.toLowerCase() === targetName.toLowerCase())) {
                targetName = `${rawName} (imported ${suffix++})`;
            }
        } else {
            targetName = clash; // keep existing casing
        }
    }

    // Copy fields defensively.
    if (!extensionSettings.knownCharacters) extensionSettings.knownCharacters = {};
    if (!extensionSettings.knownCharacters[targetName]) {
        extensionSettings.knownCharacters[targetName] = { emoji: '❓' };
    }

    const color = typeof payload.color === 'string' ? payload.color.trim() : '';
    if (color) {
        if (!extensionSettings.characterColors) extensionSettings.characterColors = {};
        extensionSettings.characterColors[targetName] = color;
    }

    const avatar = typeof payload.avatar === 'string' ? payload.avatar : '';
    const avatarFull = typeof payload.avatarFullRes === 'string' ? payload.avatarFullRes : '';
    if (avatar) {
        if (!extensionSettings.npcAvatars) extensionSettings.npcAvatars = {};
        if (!extensionSettings.npcAvatarsFullRes) extensionSettings.npcAvatarsFullRes = {};
        extensionSettings.npcAvatars[targetName] = avatar;
        extensionSettings.npcAvatarsFullRes[targetName] = avatarFull || avatar;
    }

    const rel = typeof payload.relationship === 'string' ? payload.relationship.trim() : '';
    const RELS = ['Lover', 'Friend', 'Ally', 'Enemy', 'Neutral'];
    if (rel && RELS.some(r => r.toLowerCase() === rel.toLowerCase())) {
        if (!extensionSettings.characterRelationships) extensionSettings.characterRelationships = {};
        // Canonicalize to the titlecase form the chip row uses.
        extensionSettings.characterRelationships[targetName] = RELS.find(r => r.toLowerCase() === rel.toLowerCase());
    }

    const inj = payload.injection && typeof payload.injection === 'object' ? payload.injection : null;
    if (inj) {
        const desc = typeof inj.description === 'string' ? inj.description.trim() : '';
        const book = typeof inj.lorebook === 'string' ? inj.lorebook.trim() : '';
        const tpl = typeof inj.promptTemplate === 'string' ? inj.promptTemplate.trim() : '';
        if (desc || book || tpl) {
            if (!extensionSettings.characterInjection) extensionSettings.characterInjection = {};
            const entry = { description: desc, lorebook: book };
            if (tpl) entry.promptTemplate = tpl;
            extensionSettings.characterInjection[targetName] = entry;
        }
    }

    saveSettings();
    try {
        clearPortraitCache();
        updatePortraitBar();
    } catch (e) {
        console.warn('[Dooms Tracker] Roster: failed to refresh portrait bar after import', e);
    }
    renderGrid();
    if (window.toastr) {
        window.toastr.success(`Imported "${targetName}".`, 'Character Workshop', { timeOut: 4000 });
    }
}

function purgeCharacter(name) {
    const s = extensionSettings;
    if (!s) return;
    // User-character mode purges only the userCharacters namespace and
    // clears activeUserCharacter if it was pointing at this entry.
    if (rosterMode === 'users') {
        if (s.userCharacters) delete s.userCharacters[name];
        if (s.activeUserCharacter === name) s.activeUserCharacter = null;
        saveSettings();
        return;
    }
    if (s.characterColors) delete s.characterColors[name];
    if (s.npcAvatars) delete s.npcAvatars[name];
    if (s.npcAvatarsFullRes) delete s.npcAvatarsFullRes[name];
    if (s.knownCharacters) delete s.knownCharacters[name];
    if (s.heroPositions) delete s.heroPositions[name];
    if (s.characterInjection) delete s.characterInjection[name];
    if (s.characterRelationships) delete s.characterRelationships[name];
    // Also drop the pin entry so the name doesn't linger as a ghost
    // at the top of the roster.
    if (Array.isArray(s.pinnedCharacters)) {
        const lower = String(name || '').toLowerCase();
        s.pinnedCharacters = s.pinnedCharacters.filter(n =>
            typeof n !== 'string' || n.toLowerCase() !== lower
        );
    }
    saveSettings();
}
