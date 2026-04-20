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
let searchQuery = '';
let scope = 'all'; // 'all' | 'chat' | 'active'

export function initCharacterRoster() {
    // Roster is part of the Present Characters Panel feature set; when
    // PCP is off there's nothing to roster.
    if (extensionSettings?.showPortraitBar === false) {
        console.log('[Dooms Tracker] Character Roster disabled (Present Characters Panel off), skipping init');
        return;
    }
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
    $modal.find('#cr-search').val('');
    $modal.find('.cr-scope-pill').each(function () {
        const isActive = $(this).attr('data-scope') === 'all';
        $(this).toggleClass('is-active', isActive).attr('aria-selected', isActive ? 'true' : 'false');
    });
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
        if (action === 'edit') {
            closeCharacterRoster();
            setTimeout(() => {
                window.dispatchEvent(new CustomEvent('dooms:open-workshop', { detail: { characterName: name } }));
            }, 220);
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

    // Click a character tile → open Workshop for that name
    $modal.on('click.cr', '.cr-tile[data-character]', function () {
        const name = $(this).attr('data-character');
        if (!name) return;
        closeCharacterRoster();
        // Defer so this modal's fade-out doesn't overlap the Workshop's fade-in
        setTimeout(() => {
            window.dispatchEvent(new CustomEvent('dooms:open-workshop', { detail: { characterName: name } }));
        }, 220);
    });

    // "+ New Character" tile
    $modal.on('click.cr', '.cr-tile-new', () => handleNewCharacter());
}

function handleNewCharacter() {
    const name = window.prompt('New character name:');
    if (!name) return;
    const trimmed = name.trim();
    if (!trimmed) return;
    // Reject duplicates (case-insensitive) so we don't shadow an existing one.
    const existing = collectCharacterNames();
    const clash = existing.find(n => n.toLowerCase() === trimmed.toLowerCase());
    if (clash) {
        window.alert(`A character named "${clash}" already exists.`);
        return;
    }
    if (!extensionSettings.knownCharacters) extensionSettings.knownCharacters = {};
    extensionSettings.knownCharacters[trimmed] = { emoji: '❓' };
    saveSettings();
    try {
        clearPortraitCache();
        updatePortraitBar();
    } catch (e) {
        console.warn('[Dooms Tracker] Roster: failed to refresh portrait bar after new character', e);
    }
    closeCharacterRoster();
    setTimeout(() => {
        window.dispatchEvent(new CustomEvent('dooms:open-workshop', { detail: { characterName: trimmed } }));
    }, 220);
}

/**
 * Union of every character name that has any persisted state in the
 * extension. Defensive against orphans (e.g. a color set for a character
 * that was removed from knownCharacters).
 */
function collectCharacterNames() {
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
    // Best-effort: relationship lives in volatile lastGeneratedData.
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

    const allNames = collectCharacterNames().sort((a, b) => a.localeCompare(b));
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
    const avatar = extensionSettings?.npcAvatars?.[name] || '';
    const color = extensionSettings?.characterColors?.[name] || '';
    const relEmoji = resolveRelationshipEmoji(name);
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
    const activeClass = isActive ? ' cr-tile-active' : '';
    return (
        `<button type="button" class="cr-tile${activeClass}" role="listitem" data-character="${safeNameAttr}" aria-label="${safeLabel}">
            ${imgHtml}
            ${relHtml}
            ${dotHtml}
            ${activeBadge}
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

function purgeCharacter(name) {
    const s = extensionSettings;
    if (!s) return;
    if (s.characterColors) delete s.characterColors[name];
    if (s.npcAvatars) delete s.npcAvatars[name];
    if (s.npcAvatarsFullRes) delete s.npcAvatarsFullRes[name];
    if (s.knownCharacters) delete s.knownCharacters[name];
    if (s.heroPositions) delete s.heroPositions[name];
    if (s.characterInjection) delete s.characterInjection[name];
    saveSettings();
}
