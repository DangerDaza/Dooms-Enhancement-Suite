/**
 * Portrait Bar Module
 * Renders a collapsible card-shelf of character portraits between
 * the chat area and the input area in SillyTavern.
 *
 * Portrait lookup priority:
 *   1. npcAvatars (base64 data URI stored in extensionSettings — shared with thoughts panel)
 *   2. SillyTavern character card avatars (group members → all characters → current character)
 *   3. Local `portraits/` folder (e.g. portraits/Lyra.png)
 *   4. Character emoji fallback
 *
 * Right-clicking a portrait card opens a context menu with "Upload Portrait"
 * and "Remove Portrait" options.
 */
import { extensionSettings, lastGeneratedData, committedTrackerData, FALLBACK_AVATAR_DATA_URI, getSyncedExpressionLabel } from '../../core/state.js';
import { extensionFolderPath } from '../../core/config.js';
import { saveSettings, getActiveKnownCharacters, getActiveRemovedCharacters, getActiveCharacterColors, saveCharacterRosterChange } from '../../core/persistence.js';
import { callGenericPopup, POPUP_TYPE } from '../../../../../../popup.js';
import { getBase64Async } from '../../../../../../utils.js';
import { this_chid, characters, chat_metadata, getRequestHeaders } from '../../../../../../../script.js';
import { selected_group, getGroupMembers } from '../../../../../../group-chats.js';
import { getSafeThumbnailUrl, getExpressionAwarePortrait } from '../../utils/avatars.js';
import { openCharacterSheet } from './characterSheet.js';

/** Supported image extensions to probe for, in priority order */
const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'gif'];

/** Palette of dialogue colors auto-assigned to new characters */
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

// ─────────────────────────────────────────────
//  Settings → CSS custom properties
// ─────────────────────────────────────────────

/** Parses a hex colour like "#e94560" into [r, g, b]. */
function hexToRgb(hex) {
    const h = hex.replace('#', '');
    return [parseInt(h.substring(0, 2), 16), parseInt(h.substring(2, 4), 16), parseInt(h.substring(4, 6), 16)];
}

/**
 * Reads portraitBarSettings and pushes CSS custom properties onto :root.
 * Call this whenever a setting slider/picker changes.
 */
export function applyPortraitBarSettings() {
    const s = extensionSettings.portraitBarSettings || {};
    const root = document.documentElement.style;

    // Card dimensions
    root.setProperty('--dooms-pb-card-w', (s.cardWidth ?? 110) + 'px');
    root.setProperty('--dooms-pb-card-h', (s.cardHeight ?? 150) + 'px');
    root.setProperty('--dooms-pb-card-radius', (s.cardBorderRadius ?? 8) + 'px');
    root.setProperty('--dooms-pb-card-gap', (s.cardGap ?? 8) + 'px');

    // Bar background
    const [bgR, bgG, bgB] = hexToRgb(s.barBackground || '#000000');
    root.setProperty('--dooms-pb-bg-r', bgR);
    root.setProperty('--dooms-pb-bg-g', bgG);
    root.setProperty('--dooms-pb-bg-b', bgB);
    root.setProperty('--dooms-pb-bg-opacity', ((s.barBackgroundOpacity ?? 20) / 100).toFixed(2));

    // Header / accent colour
    const [acR, acG, acB] = hexToRgb(s.headerColor || '#e94560');
    root.setProperty('--dooms-pb-accent-r', acR);
    root.setProperty('--dooms-pb-accent-g', acG);
    root.setProperty('--dooms-pb-accent-b', acB);

    // Card border
    const [brR, brG, brB] = hexToRgb(s.cardBorderColor || '#ffffff');
    root.setProperty('--dooms-pb-border-r', brR);
    root.setProperty('--dooms-pb-border-g', brG);
    root.setProperty('--dooms-pb-border-b', brB);
    root.setProperty('--dooms-pb-border-opacity', ((s.cardBorderOpacity ?? 6) / 100).toFixed(2));

    // Hover glow
    const [hvR, hvG, hvB] = hexToRgb(s.hoverGlowColor || '#e94560');
    root.setProperty('--dooms-pb-hover-r', hvR);
    root.setProperty('--dooms-pb-hover-g', hvG);
    root.setProperty('--dooms-pb-hover-b', hvB);
    root.setProperty('--dooms-pb-hover-glow', (s.hoverGlowIntensity ?? 12) + 'px');

    // Speaker pulse
    const [spR, spG, spB] = hexToRgb(s.speakingPulseColor || '#e94560');
    root.setProperty('--dooms-pb-speaking-r', spR);
    root.setProperty('--dooms-pb-speaking-g', spG);
    root.setProperty('--dooms-pb-speaking-b', spB);

    // Name overlay
    root.setProperty('--dooms-pb-name-opacity', ((s.nameOverlayOpacity ?? 85) / 100).toFixed(2));

    // Absent opacity
    root.setProperty('--dooms-pb-absent-opacity', ((s.absentOpacity ?? 45) / 100).toFixed(2));

    // Toggle visibility of header, arrows, absent characters
    const $bar = $('#dooms-portrait-bar');
    $bar.find('.dooms-pb-header').toggle(s.showHeader !== false);
    $bar.toggleClass('dooms-pb-arrows-hidden', s.showScrollArrows === false);
}

/** Cache of portrait file-based URL existence checks */
const portraitFileCache = new Map(); // characterName → url | null

// Pre-populate cache with characters confirmed to have no portrait file (persisted across reloads)
try {
    const _noPortrait = JSON.parse(localStorage.getItem('dooms-portrait-no-file') || '[]');
    _noPortrait.forEach(name => portraitFileCache.set(name, null));
} catch (e) { /* ignore */ }

/** Tracks which portrait cards are currently flipped (showing back face) */
const flippedPortraitCards = new Set();

/** Whether the bar is currently expanded */
let isExpanded = true;

/** Tracks character names from the previous render to detect new arrivals */
let _previousCharacterNames = new Set();

/** Whether we've done the initial render (skip entrance anim on first load) */
let _initialRenderDone = false;

// ─────────────────────────────────────────────
//  Initialisation
// ─────────────────────────────────────────────

/**
 * Builds the static wrapper HTML and inserts it into the DOM.
 * Should be called once during initUI().
 */
export function initPortraitBar() {
    // Don't double-init
    if ($('#dooms-portrait-bar-wrapper').length) return;

    const wrapperHtml = `
        <div id="dooms-portrait-bar-wrapper">
            <div class="dooms-pb-toggle dooms-pb-open" id="dooms-pb-toggle">
                <div class="dooms-pb-toggle-dots">
                    <span class="dooms-pb-toggle-dot"></span>
                    <span class="dooms-pb-toggle-dot"></span>
                    <span class="dooms-pb-toggle-dot"></span>
                </div>
                <span class="dooms-pb-toggle-label">Characters</span>
                <i class="fa-solid fa-chevron-up dooms-pb-toggle-chevron"></i>
            </div>
            <div class="dooms-portrait-bar dooms-pb-expanded" id="dooms-portrait-bar">
                <div class="dooms-pb-header">
                    <span class="dooms-pb-title"><i class="fa-solid fa-users"></i> Present Characters</span>
                    <span class="dooms-pb-count" id="dooms-pb-count">0 characters</span>
                    <button class="dooms-pb-restore-btn dooms-pb-roster-btn" id="dooms-pb-open-roster" title="Open Character Roster" type="button">
                        <i class="fa-solid fa-users-rectangle"></i>
                    </button>
                </div>
                <button class="dooms-pb-arrow dooms-pb-left" id="dooms-pb-left"><i class="fa-solid fa-chevron-left"></i></button>
                <button class="dooms-pb-arrow dooms-pb-right" id="dooms-pb-right"><i class="fa-solid fa-chevron-right"></i></button>
                <div class="dooms-pb-scroll" id="dooms-pb-scroll"></div>
            </div>
        </div>
        <!-- Context menu (hidden by default) -->
        <div id="dooms-pb-context-menu" class="dooms-pb-context-menu" style="display:none;">
            <div class="dooms-pb-ctx-item" data-action="open-workshop">
                <i class="fa-solid fa-wand-magic-sparkles"></i> Open in Workshop
            </div>
            <div class="dooms-pb-ctx-divider"></div>
            <div class="dooms-pb-ctx-item" data-action="upload">
                <i class="fa-solid fa-image"></i> Upload Portrait
            </div>
            <div class="dooms-pb-ctx-item" data-action="remove">
                <i class="fa-solid fa-trash-can"></i> Remove Portrait
            </div>
            <div class="dooms-pb-ctx-divider"></div>
            <div class="dooms-pb-ctx-item dooms-pb-ctx-color" data-action="set-color">
                <i class="fa-solid fa-palette"></i> Set Dialogue Color
                <input type="color" id="dooms-pb-color-input" class="dooms-pb-color-input" />
            </div>
            <div class="dooms-pb-ctx-item" data-action="clear-color">
                <i class="fa-solid fa-eraser"></i> Clear Dialogue Color
            </div>
            <div class="dooms-pb-ctx-divider"></div>
            <div class="dooms-pb-ctx-item" data-action="character-sheet">
                <i class="fa-solid fa-scroll"></i> Character Sheet
            </div>
            <div class="dooms-pb-ctx-item" data-action="open-expressions">
                <i class="fa-solid fa-face-smile"></i> Open Expression Folder
            </div>
            <div class="dooms-pb-ctx-divider"></div>
            <div class="dooms-pb-ctx-item" data-action="remove-character" title="Hide from this chat's Present Characters panel — data is kept in the Workshop Roster">
                <i class="fa-solid fa-user-minus"></i> Remove from panel
            </div>
        </div>
    `;

    // Insert based on position setting
    const pos = extensionSettings.portraitPosition || 'above';
    const $sendForm = $('#send_form');
    const $sheld = $('#sheld');

    if (pos === 'top') {
        // Insert at the top of #sheld (before #chat) so it sits in the flex column
        const $chat = $sheld.find('#chat');
        if ($chat.length) {
            $chat.before(wrapperHtml);
        } else if ($sheld.length) {
            $sheld.prepend(wrapperHtml);
        } else {
            $('body').prepend(wrapperHtml);
        }
        $('#dooms-portrait-bar-wrapper').addClass('dooms-pb-position-top');
    } else if ($sendForm.length) {
        if (pos === 'below') {
            $sendForm.after(wrapperHtml);
        } else {
            $sendForm.before(wrapperHtml);
        }
    } else {
        ($sheld.length ? $sheld : $('body')).append(wrapperHtml);
    }

    // ── Collapse / expand toggle ──
    $('#dooms-pb-toggle').on('click', function () {
        isExpanded = !isExpanded;
        const $bar = $('#dooms-portrait-bar');
        const $toggle = $(this);
        if (isExpanded) {
            $bar.removeClass('dooms-pb-collapsed').addClass('dooms-pb-expanded');
            $toggle.addClass('dooms-pb-open');
        } else {
            $bar.removeClass('dooms-pb-expanded').addClass('dooms-pb-collapsed');
            $toggle.removeClass('dooms-pb-open');
        }
    });

    // ── Scroll arrows ──
    $('#dooms-pb-left').on('click', function () {
        $('#dooms-pb-scroll').scrollLeft($('#dooms-pb-scroll').scrollLeft() - 200);
    });
    $('#dooms-pb-right').on('click', function () {
        $('#dooms-pb-scroll').scrollLeft($('#dooms-pb-scroll').scrollLeft() + 200);
    });

    // ── Left-click portrait card — flip to show detail sheet ──
    $(document).on('click', '.dooms-portrait-card', function (e) {
        // Don't flip if clicking on context menu items or other interactive children
        if ($(e.target).closest('.dooms-pb-ctx-item, button, a, input').length) return;
        const $card = $(this);
        if ($card.hasClass('dooms-pb-flipping')) return; // prevent double-click
        const charName = $card.attr('data-char');
        // Phase 1: squish card to zero width
        $card.addClass('dooms-pb-flipping');
        // Phase 2: at midpoint, swap faces and expand back
        setTimeout(() => {
            $card.toggleClass('dooms-pb-flipped');
            $card.removeClass('dooms-pb-flipping');
            // Track state for re-render preservation
            if (charName) {
                if ($card.hasClass('dooms-pb-flipped')) {
                    flippedPortraitCards.add(charName);
                } else {
                    flippedPortraitCards.delete(charName);
                }
            }
        }, 200);
    });

    // ── Right-click context menu on portrait cards (delegated) ──
    $(document).on('contextmenu', '.dooms-portrait-card', function (e) {
        e.preventDefault();
        e.stopPropagation();
        // Read from data-char (canonical name). The title attr can contain
        // the tooltip decoration 'Name — expression' when the expression
        // tooltip toggle is on, which would then flow through every
        // action (open-folder, colors, etc.) as if the expression were
        // part of the name.
        const characterName = $(this).attr('data-char') || $(this).attr('title');
        if (!characterName) return;

        const $menu = $('#dooms-pb-context-menu');
        $menu.data('character', characterName);

        // Show or hide "Remove Portrait" based on whether one exists
        const hasCustomAvatar = extensionSettings.npcAvatars && extensionSettings.npcAvatars[characterName];
        $menu.find('[data-action="remove"]').toggle(!!hasCustomAvatar);

        // Set color picker to current character color (or default white)
        const ctxColors = getActiveCharacterColors();
        const currentColor = ctxColors[characterName] || '#ffffff';
        $menu.find('#dooms-pb-color-input').val(currentColor);
        // Show or hide "Clear Dialogue Color" based on whether one is set
        $menu.find('[data-action="clear-color"]').toggle(!!ctxColors[characterName]);
        // Show "Character Sheet" only when Bunny Mo integration is enabled
        $menu.find('[data-action="character-sheet"]').toggle(!!extensionSettings.bunnyMoIntegration);
        // Show "Open in Workshop" unless explicitly disabled via feature flag.
        // Workshop tracks the PCP toggle; if PCP is off the menu item
        // wouldn't be reachable anyway, but keep the gate for defensiveness.
        $menu.find('[data-action="open-workshop"]').toggle(extensionSettings.showPortraitBar !== false);

        // Position near the cursor, clamped to viewport
        $menu.css({ display: 'block', top: 0, left: 0 });
        const menuW = $menu.outerWidth();
        const menuH = $menu.outerHeight();
        const viewW = window.innerWidth;
        const viewH = window.innerHeight;
        const top = Math.max(0, Math.min(e.clientY, viewH - menuH));
        const left = Math.max(0, Math.min(e.clientX, viewW - menuW));
        $menu.css({ top: top + 'px', left: left + 'px' });

        // Register a one-time click handler to dismiss the menu when clicking elsewhere
        // Using setTimeout(0) so this click event doesn't immediately trigger dismissal
        setTimeout(() => {
            $(document).one('click.dooms-pb-ctx', function () {
                hideContextMenu();
            });
        }, 0);
    });

    // ── Context menu item clicks ──
    $(document).on('click', '.dooms-pb-ctx-item', function (e) {
        const action = $(this).data('action');
        const characterName = $('#dooms-pb-context-menu').data('character');

        // "Set Dialogue Color" — open the native color picker, don't close menu yet
        if (action === 'set-color') {
            e.stopPropagation();
            $('#dooms-pb-color-input')[0].click();
            return;
        }

        hideContextMenu();
        if (!characterName) return;

        if (action === 'upload') {
            triggerPortraitUpload(characterName);
        } else if (action === 'remove') {
            removePortrait(characterName);
        } else if (action === 'remove-character') {
            removeCharacter(characterName);
        } else if (action === 'clear-color') {
            clearCharacterColor(characterName);
        } else if (action === 'character-sheet') {
            openCharacterSheet(characterName);
        } else if (action === 'open-expressions') {
            openExpressionFolder(characterName);
        } else if (action === 'open-workshop') {
            window.dispatchEvent(new CustomEvent('dooms:open-workshop', { detail: { characterName } }));
        }
    });

    // ── Color picker change handler ──
    $(document).on('change', '#dooms-pb-color-input', function () {
        const characterName = $('#dooms-pb-context-menu').data('character');
        if (!characterName) return;
        const color = $(this).val();
        setCharacterColor(characterName, color);
        hideContextMenu();
    });

    // ── Open Character Roster button ──
    $('#dooms-pb-open-roster').on('click', function (e) {
        e.stopPropagation();
        if (extensionSettings.showPortraitBar === false) return;
        window.dispatchEvent(new CustomEvent('dooms:open-roster'));
    });
    // Hide the roster button when PCP is off (Workshop is part of PCP).
    if (extensionSettings.showPortraitBar === false) {
        $('#dooms-pb-open-roster').hide();
    }

    // Initial render
    updatePortraitBar();
}

// ─────────────────────────────────────────────
//  Rendering
// ─────────────────────────────────────────────

/**
 * Refreshes the portrait cards based on current character data.
 */
export function updatePortraitBar() {
    const $scroll = $('#dooms-pb-scroll');
    if (!$scroll.length) return;

    if (!extensionSettings.enabled || extensionSettings.showPortraitBar === false) {
        $('#dooms-portrait-bar-wrapper').hide();
        return;
    }
    $('#dooms-portrait-bar-wrapper').show();

    try {
    // Apply alignment setting
    const centered = extensionSettings.portraitAlignment === 'center';
    $scroll.toggleClass('dooms-pb-centered', centered);

    const allCharacters = getCharacterList();
    const pbSettings = extensionSettings.portraitBarSettings || {};
    const showAbsent = pbSettings.showAbsentCharacters !== false;
    const characters = showAbsent ? allCharacters : allCharacters.filter(c => c.present);
    const presentCount = allCharacters.filter(c => c.present).length;
    const totalCount = allCharacters.length;

    const countText = presentCount === totalCount
        ? `${totalCount} ${totalCount === 1 ? 'character' : 'characters'}`
        : `${presentCount} present / ${totalCount} known`;
    $('#dooms-pb-count').text(countText);

    if (totalCount === 0) {
        $scroll.html('<div class="dooms-pb-empty">No characters present</div>');
        _previousCharacterNames = new Set();
        _initialRenderDone = true;
        return;
    }

    // Detect newly-arrived characters (only present ones, not absent)
    const currentPresentNames = new Set(characters.filter(c => c.present).map(c => c.name));
    const newCharNames = new Set();
    if (_initialRenderDone && extensionSettings.enableAnimations !== false) {
        for (const name of currentPresentNames) {
            if (!_previousCharacterNames.has(name)) {
                newCharNames.add(name);
            }
        }
    }

    // ── Auto-assign dialogue colors to characters that don't have one yet ──
    const activeColors = getActiveCharacterColors();
    const usedColors = new Set(Object.values(activeColors));
    let colorsAssigned = false;
    for (const char of characters) {
        if (!activeColors[char.name]) {
            // Pick the first unused palette color; fall back to random if all taken
            let color = DIALOGUE_COLORS.find(c => !usedColors.has(c));
            if (!color) {
                color = DIALOGUE_COLORS[Math.floor(Math.random() * DIALOGUE_COLORS.length)];
            }
            activeColors[char.name] = color;
            usedColors.add(color);
            colorsAssigned = true;
        }
    }
    if (colorsAssigned) saveCharacterRosterChange();

    const cards = characters.map((char, idx) => {
        const portraitSrc = resolvePortrait(char.name);
        const speakingClass = (char.present && idx === 0) ? ' dooms-pb-speaking' : '';
        const absentClass = char.present ? '' : ' dooms-pb-absent';
        const isNew = newCharNames.has(char.name);
        const entranceClass = isNew ? ' dooms-pb-entrance' : '';
        const nameEsc = escapeHtml(char.name);
        const emoji = char.emoji || '👤';
        const absentOverlay = char.present ? '' : '<div class="dooms-pb-absent-overlay"></div>';
        const charColor = activeColors[char.name];
        const colorDot = charColor
            ? `<span class="dooms-portrait-card-color-dot" style="background:${charColor};"></span>`
            : '';
        const newBadge = isNew ? '<span class="dooms-pb-new-badge">&#x2726; New</span>' : '';

        let backFace = '';
        try {
            backFace = buildPortraitBackFace(char.name, emoji);
        } catch (e) {
            console.error(`[Dooms Portrait Bar] Error building back face for ${char.name}:`, e);
        }
        const flippedClass = flippedPortraitCards.has(char.name) ? ' dooms-pb-flipped' : '';

        // Tooltip: when the user has opted in, append the current expression
        // label to the native title attr so hovering the card shows both.
        let cardTitle = nameEsc;
        if (extensionSettings.showExpressionInTooltip === true) {
            const expr = getSyncedExpressionLabel(char.name);
            if (expr) cardTitle = `${nameEsc} — ${escapeHtml(expr)}`;
        }

        if (portraitSrc) {
            return `<div class="dooms-portrait-card${speakingClass}${absentClass}${entranceClass}${flippedClass}" title="${cardTitle}" data-char="${nameEsc}">
                <img src="${portraitSrc}" alt="${nameEsc}" onerror="this.style.display='none';this.nextElementSibling.style.display='flex';" />
                <div class="dooms-portrait-card-emoji" style="display:none;">${emoji}</div>
                ${absentOverlay}
                ${newBadge}
                <div class="dooms-portrait-card-name${isNew ? ' dooms-pb-name-highlight' : ''}">${colorDot}${nameEsc}</div>
                ${backFace}
            </div>`;
        } else {
            return `<div class="dooms-portrait-card${speakingClass}${absentClass}${entranceClass}${flippedClass}" title="${cardTitle}" data-char="${nameEsc}">
                <div class="dooms-portrait-card-emoji">${emoji}</div>
                ${absentOverlay}
                ${newBadge}
                <div class="dooms-portrait-card-name${isNew ? ' dooms-pb-name-highlight' : ''}">${colorDot}${nameEsc}</div>
                ${backFace}
            </div>`;
        }
    });

    $scroll.html(cards.join(''));

    // Fire glow burst on new cards
    if (newCharNames.size > 0) {
        requestAnimationFrame(() => {
            newCharNames.forEach(name => {
                const $card = $scroll.find(`.dooms-portrait-card[data-char="${escapeAttr(name)}"]`);
                if (!$card.length) return;

                // Create glow burst overlay
                const $glow = $('<div class="dooms-pb-glow-burst"></div>');
                $card.append($glow);

                // Auto-scroll to reveal the new card
                const cardEl = $card[0];
                const scrollEl = $scroll[0];
                const cardRight = cardEl.offsetLeft + cardEl.offsetWidth;
                if (cardRight > scrollEl.scrollLeft + scrollEl.clientWidth) {
                    scrollEl.scrollTo({ left: cardRight - scrollEl.clientWidth + 20, behavior: 'smooth' });
                }

                // Clean up animation classes after they finish
                setTimeout(() => {
                    $card.removeClass('dooms-pb-entrance');
                    $card.find('.dooms-pb-new-badge').remove();
                    $card.find('.dooms-pb-name-highlight').removeClass('dooms-pb-name-highlight');
                    $glow.remove();
                }, 3500);
            });
        });
    }

    // Update tracking set
    _previousCharacterNames = currentPresentNames;
    _initialRenderDone = true;

    // Re-apply visual settings (header visibility, arrow visibility, etc.)
    applyPortraitBarSettings();
    } catch (e) {
        console.error('[Dooms Portrait Bar] Error updating portrait bar:', e);
    }
}

/**
 * Moves the portrait bar wrapper above/below #send_form or to the top of the screen
 * based on the portraitPosition setting.
 */
export function repositionPortraitBar() {
    const $wrapper = $('#dooms-portrait-bar-wrapper');
    const $sendForm = $('#send_form');
    if (!$wrapper.length) return;

    const pos = extensionSettings.portraitPosition || 'above';

    // Remove top-of-screen class first
    $wrapper.removeClass('dooms-pb-position-top');

    if (pos === 'top') {
        // Insert at the top of #sheld (before #chat) so it sits in the flex column
        const $sheld = $('#sheld');
        const $chat = $sheld.find('#chat');
        if ($chat.length) {
            $chat.before($wrapper);
        } else if ($sheld.length) {
            $sheld.prepend($wrapper);
        }
        $wrapper.addClass('dooms-pb-position-top');
    } else if ($sendForm.length) {
        if (pos === 'below') {
            $sendForm.after($wrapper);
        } else {
            $sendForm.before($wrapper);
        }
    }
}

// ─────────────────────────────────────────────
//  Portrait resolution (npcAvatars → ST characters → file → null)
// ─────────────────────────────────────────────

/**
 * Fuzzy-match a SillyTavern character card name against an AI-generated name.
 * Tries exact, parenthesis-stripped, and word-boundary matching.
 */
function namesMatch(cardName, aiName) {
    if (!cardName || !aiName) return false;
    if (cardName.toLowerCase() === aiName.toLowerCase()) return true;
    const stripParens = (s) => s.replace(/\s*\([^)]*\)/g, '').trim();
    const cardCore = stripParens(cardName).toLowerCase();
    const aiCore = stripParens(aiName).toLowerCase();
    if (cardCore === aiCore) return true;
    const escapedCardCore = cardCore.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`\\b${escapedCardCore}\\b`).test(aiCore);
}

/**
 * Returns the best available portrait source for a character.
 * Priority: npcAvatars base64 → ST character card avatar → portraits/ folder → null
 */
export function resolvePortrait(name) {
    if (!name) return null;

    const syncedExpression = getExpressionAwarePortrait(name, null);
    if (syncedExpression) return syncedExpression;

    // 1. Custom uploaded avatars (npcAvatars)
    const avatars = extensionSettings.npcAvatars;
    if (avatars) {
        // Exact match
        if (avatars[name]) return avatars[name];

        // Partial match — handle short names expanded to full names
        // e.g. "Sakura" → "Sakura Ashenveil"
        const lowerName = name.toLowerCase();
        for (const key of Object.keys(avatars)) {
            if (key.toLowerCase().startsWith(lowerName + ' ')) {
                return avatars[key];
            }
        }
    }

    // 2. SillyTavern character card avatars (group members first, then all)
    if (extensionSettings.portraitAutoImport !== false) {
        try {
            if (selected_group) {
                const groupMembers = getGroupMembers(selected_group);
                if (groupMembers?.length) {
                    const match = groupMembers.find(m => m?.name && namesMatch(m.name, name));
                    if (match?.avatar && match.avatar !== 'none') {
                        const url = getSafeThumbnailUrl('avatar', match.avatar);
                        if (url) return url;
                    }
                }
            }
            if (characters?.length) {
                const match = characters.find(c => c?.name && namesMatch(c.name, name));
                if (match?.avatar && match.avatar !== 'none') {
                    const url = getSafeThumbnailUrl('avatar', match.avatar);
                    if (url) return url;
                }
            }
            if (this_chid !== undefined && characters[this_chid]?.name &&
                namesMatch(characters[this_chid].name, name)) {
                const url = getSafeThumbnailUrl('avatar', characters[this_chid].avatar);
                if (url) return url;
            }
        } catch (e) {
            console.warn('[Dooms Portrait Bar] Character card avatar lookup failed:', e.message);
        }
    }

    // 3. Check file-based portraits/ folder
    return getPortraitFileUrl(name);
}

/**
 * Returns a full-resolution portrait URL for a character.
 * Same logic as resolvePortrait() but uses full-res avatar paths
 * instead of thumbnails. Use this for character sheets and chat bubbles
 * where image quality matters.
 */
export function resolveFullPortrait(name) {
    if (!name) return null;

    const syncedExpression = getExpressionAwarePortrait(name, null);
    if (syncedExpression) return syncedExpression;

    // 1. Try SillyTavern character card avatars first — these are full resolution
    //    Preferred over npcAvatars which are cropped/downscaled to 330×440.
    if (extensionSettings.portraitAutoImport !== false) {
        try {
            const findFullRes = (charList) => {
                const match = charList?.find(c => c?.name && namesMatch(c.name, name));
                if (match?.avatar && match.avatar !== 'none') {
                    return `/characters/${encodeURIComponent(match.avatar)}`;
                }
                return null;
            };

            if (selected_group) {
                const groupMembers = getGroupMembers(selected_group);
                const url = findFullRes(groupMembers);
                if (url) return url;
            }
            if (characters?.length) {
                const url = findFullRes(characters);
                if (url) return url;
            }
            if (this_chid !== undefined && characters[this_chid]?.name &&
                namesMatch(characters[this_chid].name, name)) {
                return `/characters/${encodeURIComponent(characters[this_chid].avatar)}`;
            }
        } catch (e) {
            console.warn('[Dooms Portrait Bar] Full-res avatar lookup failed:', e.message);
        }
    }

    // 2. Full-res originals stored at upload time (pre-crop)
    const fullRes = extensionSettings.npcAvatarsFullRes;
    if (fullRes) {
        if (fullRes[name]) return fullRes[name];
        const lowerName = name.toLowerCase();
        for (const key of Object.keys(fullRes)) {
            if (key.toLowerCase().startsWith(lowerName + ' ')) {
                return fullRes[key];
            }
        }
    }

    // 3. Cropped portraits (npcAvatars — 660×880 data URIs)
    const avatars = extensionSettings.npcAvatars;
    if (avatars) {
        if (avatars[name]) return avatars[name];
        const lowerName = name.toLowerCase();
        for (const key of Object.keys(avatars)) {
            if (key.toLowerCase().startsWith(lowerName + ' ')) {
                return avatars[key];
            }
        }
    }

    // 3. Fall back to regular resolve (file-based portraits, thumbnails)
    return resolvePortrait(name);
}

/**
 * Returns a portrait file URL, probing asynchronously on first call.
 */
function getPortraitFileUrl(name) {
    if (portraitFileCache.has(name)) {
        return portraitFileCache.get(name);
    }

    // Check persistent no-portrait cache before firing any network requests.
    // This prevents 5+ HEAD 404s per character on every page reload.
    try {
        const noPortrait = JSON.parse(localStorage.getItem('dooms-portrait-no-file') || '[]');
        if (noPortrait.includes(name)) {
            portraitFileCache.set(name, null);
            return null;
        }
    } catch (e) { /* ignore */ }

    const sanitizedName = sanitizeFilename(name);
    const basePath = `/${extensionFolderPath}/portraits/${sanitizedName}`;
    const url = `${basePath}.png`;
    portraitFileCache.set(name, url);

    // Async probe for real extension
    probePortraitFileUrl(name, basePath);

    return url;
}

async function probePortraitFileUrl(name, basePath) {
    for (const ext of IMAGE_EXTENSIONS) {
        const testUrl = `${basePath}.${ext}`;
        try {
            const response = await fetch(testUrl, { method: 'HEAD' });
            if (response.ok) {
                portraitFileCache.set(name, testUrl);
                // Update DOM if the card is still showing the optimistic .png
                const $img = $(`.dooms-portrait-card[data-char="${escapeAttr(name)}"] img`);
                if ($img.length && $img.attr('src') !== testUrl) {
                    $img.attr('src', testUrl);
                }
                return;
            }
        } catch (e) { /* continue */ }
    }

    // No file found — cache null and persist so we skip probing on next reload
    portraitFileCache.set(name, null);
    try {
        const _noPortrait = JSON.parse(localStorage.getItem('dooms-portrait-no-file') || '[]');
        if (!_noPortrait.includes(name)) {
            _noPortrait.push(name);
            localStorage.setItem('dooms-portrait-no-file', JSON.stringify(_noPortrait));
        }
    } catch (e) { /* ignore */ }

    // If no npcAvatar either, show emoji fallback
    if (!(extensionSettings.npcAvatars && extensionSettings.npcAvatars[name])) {
        const $card = $(`.dooms-portrait-card[data-char="${escapeAttr(name)}"]`);
        if ($card.length && $card.find('img').length) {
            const $img = $card.find('img');
            $img.hide();
            $card.find('.dooms-portrait-card-emoji').show();
        }
    }
}

// ─────────────────────────────────────────────
//  Upload & Remove actions
// ─────────────────────────────────────────────

/**
 * Opens a file picker → SillyTavern's crop dialog (circle preview, square save)
 * → stores the cropped image as a base64 npcAvatar.
 */
function triggerPortraitUpload(characterName) {
    const fileInput = $('<input type="file" accept="image/*" style="display:none;">');
    fileInput.on('change', async function () {
        const file = this.files[0];
        if (!file) return;

        try {
            // Convert to base64 data URL
            const dataUrl = await getBase64Async(file);

            // Open SillyTavern's built-in crop popup (square aspect = circular preview)
            const croppedImage = await callGenericPopup(
                `<h3>Crop portrait for ${escapeHtml(characterName)}</h3>`,
                POPUP_TYPE.CROP,
                '',
                { cropAspect: 3 / 4, cropImage: dataUrl }
            );

            if (!croppedImage) {
                console.log(`[Dooms Tracker] Portrait crop cancelled for ${characterName}`);
                return;
            }

            // Upscale the cropped image to a high-res size and re-encode as PNG.
            // The built-in crop popup returns a low-res JPEG at the cropped pixel size,
            // so we redraw it onto a larger canvas for crisp portrait display.
            const PORTRAIT_W = 660;
            const PORTRAIT_H = 880;
            const hiResDataUrl = await upscaleImage(String(croppedImage), PORTRAIT_W, PORTRAIT_H);

            // Store cropped portrait for portrait bar / chat bubbles
            if (!extensionSettings.npcAvatars) {
                extensionSettings.npcAvatars = {};
            }
            extensionSettings.npcAvatars[characterName] = hiResDataUrl;

            // Store the original full-res image (pre-crop) for character sheets
            if (!extensionSettings.npcAvatarsFullRes) {
                extensionSettings.npcAvatarsFullRes = {};
            }
            extensionSettings.npcAvatarsFullRes[characterName] = dataUrl;

            saveSettings();

            // Clear file cache so resolvePortrait picks up the new npcAvatar
            portraitFileCache.delete(characterName);
            // Remove from no-portrait localStorage cache so future file probing can resume
            try {
                const _noPortrait = JSON.parse(localStorage.getItem('dooms-portrait-no-file') || '[]');
                localStorage.setItem('dooms-portrait-no-file', JSON.stringify(_noPortrait.filter(n => n !== characterName)));
            } catch (e) { /* ignore */ }

            // Re-render the portrait bar
            updatePortraitBar();

            console.log(`[Dooms Tracker] Portrait uploaded & cropped for ${characterName}`);
        } catch (err) {
            console.error(`[Dooms Tracker] Portrait upload failed for ${characterName}:`, err);
        }
    });
    $('body').append(fileInput);
    fileInput.trigger('click');
    // Clean up the hidden input after use
    setTimeout(() => fileInput.remove(), 60000);
}

/**
 * Removes a character's custom portrait (npcAvatar).
 */
function removePortrait(characterName) {
    if (extensionSettings.npcAvatars && extensionSettings.npcAvatars[characterName]) {
        delete extensionSettings.npcAvatars[characterName];
        // Also remove the full-res original if stored
        if (extensionSettings.npcAvatarsFullRes && extensionSettings.npcAvatarsFullRes[characterName]) {
            delete extensionSettings.npcAvatarsFullRes[characterName];
        }
        saveSettings();
        portraitFileCache.delete(characterName);
        // Remove from no-portrait localStorage cache so file probing can resume for this character
        try {
            const _noPortrait = JSON.parse(localStorage.getItem('dooms-portrait-no-file') || '[]');
            localStorage.setItem('dooms-portrait-no-file', JSON.stringify(_noPortrait.filter(n => n !== characterName)));
        } catch (e) { /* ignore */ }
        updatePortraitBar();
        console.log(`[Dooms Tracker] Portrait removed for ${characterName}`);
    }
}

/**
 * Opens the character's expression/sprite folder in the OS file explorer.
 */
export async function openExpressionFolder(characterName) {
    try {
        const response = await fetch('/api/sprites/open-folder', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({ name: characterName }),
        });
        if (response.ok) {
            console.log(`[Dooms Tracker] Opened expression folder for: ${characterName}`);
        } else if (response.status === 404) {
            toastr.info(
                `Expression sprites go in: data/default-user/characters/${characterName}/`,
                'Open Folder Not Available',
                { timeOut: 6000 }
            );
        } else {
            toastr.error('Failed to open expression folder.', 'Error');
        }
    } catch (err) {
        console.error('[Dooms Tracker] Failed to open expression folder:', err);
        toastr.info(
            `Expression sprites go in: data/default-user/characters/${characterName}/`,
            'Open Folder Not Available',
            { timeOut: 6000 }
        );
    }
}

/**
 * Sets a character's dialogue color.
 */
function setCharacterColor(characterName, color) {
    const colors = getActiveCharacterColors();
    colors[characterName] = color;
    saveCharacterRosterChange();
    updatePortraitBar();
    console.log(`[Dooms Tracker] Dialogue color set for ${characterName}: ${color}`);
}

/**
 * Clears a character's dialogue color (AI will pick its own).
 */
function clearCharacterColor(characterName) {
    const colors = getActiveCharacterColors();
    if (colors[characterName]) {
        delete colors[characterName];
        saveCharacterRosterChange();
        updatePortraitBar();
        console.log(`[Dooms Tracker] Dialogue color cleared for ${characterName}`);
    }
}

/**
 * Removes a character from the current chat's Present Characters panel
 * (soft remove — keeps their Workshop/Roster data intact).
 */
function removeCharacter(characterName) {
    // Soft-remove: hide from the current chat's Present Characters panel
    // by adding to the removedCharacters blacklist. Preserves the
    // roster entry, portrait, color, and injection data so the character
    // can still be found (and re-injected) via the Character Workshop /
    // Roster. Full delete stays in those two surfaces.
    const removedList = getActiveRemovedCharacters();
    const lowerName = characterName.toLowerCase();
    if (!removedList.some(n => n.toLowerCase() === lowerName)) {
        removedList.push(characterName);
    }
    // Reset entrance/cache tracking so a future re-add re-animates.
    _previousCharacterNames.delete(characterName);
    portraitFileCache.delete(characterName);
    saveCharacterRosterChange();
    updatePortraitBar();
    console.log(`[Dooms Tracker] Character hidden from panel (soft remove): ${characterName}`);
}

// ─────────────────────────────────────────────
//  Context menu helpers
// ─────────────────────────────────────────────

function hideContextMenu() {
    $('#dooms-pb-context-menu').hide();
    // Clean up the one-time dismiss handler if it hasn't fired yet
    $(document).off('click.dooms-pb-ctx');
}

// ─────────────────────────────────────────────
//  Character data extraction
// ─────────────────────────────────────────────

/**
 * Returns a merged list of present + absent (known but not in scene) characters.
 * Each entry has { name, emoji, present: boolean }.
 * Present characters come first, absent characters after.
 */
export function getCharacterList() {
    const data = lastGeneratedData.characterThoughts || committedTrackerData.characterThoughts;
    let presentChars = [];

    // Pattern to detect off-scene characters from their thoughts
    const offScenePatterns = /\b(not\s+(currently\s+)?(in|at|present\s+in|present\s+at)\s+(the\s+)?(scene|area|room|location|vicinity))\b|\b(off[\s-]?scene)\b|\b(not\s+physically\s+present)\b|\b(absent\s+from\s+(the\s+)?(scene|room|area|location))\b|\b(away\s+from\s+(the\s+)?scene)\b/i;

    if (data) {
        try {
            const parsed = typeof data === 'string' ? JSON.parse(data) : data;
            const characters = Array.isArray(parsed) ? parsed : (parsed.characters || []);
            presentChars = characters
                .filter(c => {
                    // Filter out characters whose thoughts indicate they're off-scene
                    const thoughts = c.thoughts?.content || c.thoughts || '';
                    if (thoughts && offScenePatterns.test(thoughts)) {
                        console.log(`[Dooms Portrait Bar] Filtered off-scene: ${c.name}`);
                        return false;
                    }
                    return true;
                })
                .map(c => ({
                    name: c.name || 'Unknown',
                    emoji: c.emoji || '👤',
                    present: true
                }));
        } catch (e) {
            if (typeof data === 'string') {
                const lines = data.split('\n');
                for (const line of lines) {
                    const match = line.trim().match(/^-\s+(.+)$/);
                    if (match && !match[1].includes(':') && !match[1].includes('---')) {
                        presentChars.push({ name: match[1].trim(), emoji: '👤', present: true });
                    }
                }
            }
        }
    }

    // Filter out characters the user has explicitly removed
    // Case-insensitive matching — AI may output name variants between generations
    const removed = getActiveRemovedCharacters();
    const removedLower = new Set(removed.map(n => n.toLowerCase()));
    const beforeRemoval = presentChars.length;
    presentChars = presentChars.filter(c => {
        if (removedLower.has(c.name.toLowerCase())) {
            console.log(`[Dooms Portrait Bar] Filtered removed character: ${c.name}`);
            return false;
        }
        return true;
    });
    if (beforeRemoval !== presentChars.length) {
        console.log(`[Dooms Portrait Bar] removedCharacters list:`, removed);
    }

    // Update the persistent known-characters roster
    const knownChars = getActiveKnownCharacters();
    let rosterChanged = false;
    for (const char of presentChars) {
        if (!knownChars[char.name]) {
            knownChars[char.name] = { emoji: char.emoji };
            rosterChanged = true;
        } else if (knownChars[char.name].emoji !== char.emoji) {
            knownChars[char.name].emoji = char.emoji;
            rosterChanged = true;
        }
    }
    if (rosterChanged) {
        saveCharacterRosterChange();
    }

    // Build absent list from known characters not currently present
    const presentNames = new Set(presentChars.map(c => c.name));
    const absentChars = [];
    for (const [name, info] of Object.entries(knownChars)) {
        if (!presentNames.has(name) && !removedLower.has(name.toLowerCase())) {
            absentChars.push({ name, emoji: info.emoji || '👤', present: false });
        }
    }

    // Present first, then absent (alphabetical)
    absentChars.sort((a, b) => a.name.localeCompare(b.name));
    return [...presentChars, ...absentChars];
}

// ─────────────────────────────────────────────
//  Cache & utilities
// ─────────────────────────────────────────────

export function clearPortraitCache() {
    portraitFileCache.clear();
}

/**
 * Redraws a data-URL image onto a canvas of the given size and returns a PNG data URL.
 * Uses high-quality bicubic-like smoothing (imageSmoothingQuality: 'high').
 */
function upscaleImage(srcDataUrl, width, height) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';
            ctx.drawImage(img, 0, 0, width, height);
            resolve(canvas.toDataURL('image/png'));
        };
        img.onerror = reject;
        img.src = srcDataUrl;
    });
}

function sanitizeFilename(name) {
    return name.trim().replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_\-]/g, '');
}

function escapeHtml(str) {
    if (!str) return '';
    if (typeof str !== 'string') str = String(str);
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function escapeAttr(str) {
    if (!str) return '';
    return str.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/**
 * Extracts the full character details object from committed tracker data.
 * Returns null if no data is available for the character.
 */
function getCharacterDetails(charName) {
    const data = lastGeneratedData.characterThoughts || committedTrackerData.characterThoughts;
    if (!data) return null;
    try {
        const parsed = typeof data === 'string' ? JSON.parse(data) : data;
        const characters = Array.isArray(parsed) ? parsed : (parsed.characters || []);
        return characters.find(c => c.name === charName) || null;
    } catch (e) {
        return null;
    }
}

/**
 * Builds the HTML for a portrait card back face detail sheet.
 * Shows relationship status, appearance, demeanor, and other key character info.
 * Thoughts are omitted here since they're shown in the sidebar Thoughts panel.
 */
function buildPortraitBackFace(charName, emoji) {
    const details = getCharacterDetails(charName);
    const nameEsc = escapeHtml(charName);

    let sectionsHtml = '';

    if (details) {
        // Relationship — may be { status: "Lover" } object or a flat string
        const rawRelationship = details.Relationship || details.relationship || '';
        const relationship = (typeof rawRelationship === 'object' && rawRelationship !== null)
            ? (rawRelationship.status || rawRelationship.value || JSON.stringify(rawRelationship))
            : String(rawRelationship || '');
        if (relationship) {
            sectionsHtml += `<div class="dooms-pb-back-section">
                <div class="dooms-pb-back-label">❤️ Relationship</div>
                <div class="dooms-pb-back-value">${escapeHtml(relationship)}</div>
            </div>`;
        }

        // Appearance & demeanor — nested inside details.details object
        const nested = details.details || {};
        const appearance = (typeof nested === 'object' && nested !== null)
            ? (nested.appearance || nested.Appearance || '') : '';
        const demeanor = (typeof nested === 'object' && nested !== null)
            ? (nested.demeanor || nested.Demeanor || '') : '';

        if (appearance) {
            sectionsHtml += `<div class="dooms-pb-back-section">
                <div class="dooms-pb-back-label">👁️ Appearance</div>
                <div class="dooms-pb-back-value">${escapeHtml(String(appearance))}</div>
            </div>`;
        }
        if (demeanor) {
            sectionsHtml += `<div class="dooms-pb-back-section">
                <div class="dooms-pb-back-label">🎭 Demeanor</div>
                <div class="dooms-pb-back-value">${escapeHtml(String(demeanor))}</div>
            </div>`;
        }

        // Show any other nested detail fields we haven't explicitly handled
        if (typeof nested === 'object' && nested !== null) {
            const handledDetailFields = new Set(['appearance', 'demeanor']);
            for (const [key, val] of Object.entries(nested)) {
                if (handledDetailFields.has(key.toLowerCase()) || !val || typeof val === 'object') continue;
                sectionsHtml += `<div class="dooms-pb-back-section">
                    <div class="dooms-pb-back-label">${escapeHtml(key)}</div>
                    <div class="dooms-pb-back-value">${escapeHtml(String(val))}</div>
                </div>`;
            }
        }

        // Show other top-level fields (skip name, emoji, thoughts, relationship, details, stats)
        const skipFields = new Set(['name', 'emoji', 'thoughts', 'relationship', 'details', 'stats', 'thoughtscontent']);
        for (const [key, val] of Object.entries(details)) {
            if (skipFields.has(key.toLowerCase()) || !val || typeof val === 'object') continue;
            sectionsHtml += `<div class="dooms-pb-back-section">
                <div class="dooms-pb-back-label">${escapeHtml(key)}</div>
                <div class="dooms-pb-back-value">${escapeHtml(String(val))}</div>
            </div>`;
        }
    }

    if (!sectionsHtml) {
        sectionsHtml = '<div class="dooms-pb-back-empty">No details available</div>';
    }

    return `<div class="dooms-pb-card-back">
        <div class="dooms-pb-back-header">
            <span class="dooms-pb-back-emoji">${emoji}</span>
            <span class="dooms-pb-back-name">${nameEsc}</span>
        </div>
        <div class="dooms-pb-back-body">${sectionsHtml}</div>
        <div class="dooms-pb-back-hint"><i class="fa-solid fa-rotate-left"></i></div>
    </div>`;
}
