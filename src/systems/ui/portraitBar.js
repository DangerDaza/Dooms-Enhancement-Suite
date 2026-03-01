/**
 * Portrait Bar Module
 * Renders a collapsible card-shelf of character portraits between
 * the chat area and the input area in SillyTavern.
 *
 * Portrait lookup priority:
 *   1. npcAvatars (base64 data URI stored in extensionSettings — shared with thoughts panel)
 *   2. Local `portraits/` folder (e.g. portraits/Lyra.png)
 *   3. Character emoji fallback
 *
 * Right-clicking a portrait card opens a context menu with "Upload Portrait"
 * and "Remove Portrait" options.
 */
import { extensionSettings, lastGeneratedData, committedTrackerData, FALLBACK_AVATAR_DATA_URI } from '../../core/state.js';
import { extensionFolderPath } from '../../core/config.js';
import { saveSettings } from '../../core/persistence.js';
import { callGenericPopup, POPUP_TYPE } from '../../../../../../popup.js';
import { getBase64Async } from '../../../../../../utils.js';

/** Supported image extensions to probe for, in priority order */
const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'gif'];

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
                </div>
                <button class="dooms-pb-arrow dooms-pb-left" id="dooms-pb-left"><i class="fa-solid fa-chevron-left"></i></button>
                <button class="dooms-pb-arrow dooms-pb-right" id="dooms-pb-right"><i class="fa-solid fa-chevron-right"></i></button>
                <div class="dooms-pb-scroll" id="dooms-pb-scroll"></div>
            </div>
        </div>
        <!-- Context menu (hidden by default) -->
        <div id="dooms-pb-context-menu" class="dooms-pb-context-menu" style="display:none;">
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
            <div class="dooms-pb-ctx-item dooms-pb-ctx-danger" data-action="remove-character">
                <i class="fa-solid fa-user-xmark"></i> Remove Character
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
        const characterName = $(this).attr('title');
        if (!characterName) return;

        const $menu = $('#dooms-pb-context-menu');
        $menu.data('character', characterName);

        // Show or hide "Remove Portrait" based on whether one exists
        const hasCustomAvatar = extensionSettings.npcAvatars && extensionSettings.npcAvatars[characterName];
        $menu.find('[data-action="remove"]').toggle(!!hasCustomAvatar);

        // Set color picker to current character color (or default white)
        const currentColor = extensionSettings.characterColors?.[characterName] || '#ffffff';
        $menu.find('#dooms-pb-color-input').val(currentColor);
        // Show or hide "Clear Dialogue Color" based on whether one is set
        $menu.find('[data-action="clear-color"]').toggle(!!extensionSettings.characterColors?.[characterName]);

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

    const cards = characters.map((char, idx) => {
        const portraitSrc = resolvePortrait(char.name);
        const speakingClass = (char.present && idx === 0) ? ' dooms-pb-speaking' : '';
        const absentClass = char.present ? '' : ' dooms-pb-absent';
        const isNew = newCharNames.has(char.name);
        const entranceClass = isNew ? ' dooms-pb-entrance' : '';
        const nameEsc = escapeHtml(char.name);
        const emoji = char.emoji || '👤';
        const absentOverlay = char.present ? '' : '<div class="dooms-pb-absent-overlay"></div>';
        const charColor = extensionSettings.characterColors?.[char.name];
        const colorDot = charColor
            ? `<span class="dooms-portrait-card-color-dot" style="background:${charColor};"></span>`
            : '';
        const newBadge = isNew ? '<span class="dooms-pb-new-badge">&#x2726; New</span>' : '';

        const backFace = buildPortraitBackFace(char.name, emoji);
        const flippedClass = flippedPortraitCards.has(char.name) ? ' dooms-pb-flipped' : '';

        if (portraitSrc) {
            return `<div class="dooms-portrait-card${speakingClass}${absentClass}${entranceClass}${flippedClass}" title="${nameEsc}" data-char="${nameEsc}">
                <img src="${portraitSrc}" alt="${nameEsc}" onerror="this.style.display='none';this.nextElementSibling.style.display='flex';" />
                <div class="dooms-portrait-card-emoji" style="display:none;">${emoji}</div>
                ${absentOverlay}
                ${newBadge}
                <div class="dooms-portrait-card-name${isNew ? ' dooms-pb-name-highlight' : ''}">${colorDot}${nameEsc}</div>
                ${backFace}
            </div>`;
        } else {
            return `<div class="dooms-portrait-card${speakingClass}${absentClass}${entranceClass}${flippedClass}" title="${nameEsc}" data-char="${nameEsc}">
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
//  Portrait resolution (npcAvatars → file → null)
// ─────────────────────────────────────────────

/**
 * Returns the best available portrait source for a character.
 * Priority: npcAvatars base64 → portraits/ folder file → null
 */
export function resolvePortrait(name) {
    if (!name) return null;

    const avatars = extensionSettings.npcAvatars;
    if (avatars) {
        // 1. Exact match
        if (avatars[name]) return avatars[name];

        // 2. Partial match — handle short names that have since been expanded to full names
        //    e.g. "Sakura" → "Sakura Ashenveil", "Satori" → "Satori Thornblood"
        //    Only matches when the lookup name is a complete first word of the stored key
        const lowerName = name.toLowerCase();
        for (const key of Object.keys(avatars)) {
            if (key.toLowerCase().startsWith(lowerName + ' ')) {
                return avatars[key];
            }
        }
    }

    // 3. Check file-based portraits/ folder
    return getPortraitFileUrl(name);
}

/**
 * Returns a portrait file URL, probing asynchronously on first call.
 */
function getPortraitFileUrl(name) {
    if (portraitFileCache.has(name)) {
        return portraitFileCache.get(name);
    }

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
                const $img = $(`.dooms-portrait-card[title="${escapeAttr(name)}"] img`);
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
        const $card = $(`.dooms-portrait-card[title="${escapeAttr(name)}"]`);
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

            // Upscale the cropped image to a consistent high-res size and re-encode as PNG.
            // The built-in crop popup returns a low-res JPEG at the cropped pixel size,
            // so we redraw it onto a larger canvas for crisp portrait display.
            const PORTRAIT_W = 330;
            const PORTRAIT_H = 440;
            const hiResDataUrl = await upscaleImage(String(croppedImage), PORTRAIT_W, PORTRAIT_H);

            // Store in npcAvatars (same store as thoughts panel)
            if (!extensionSettings.npcAvatars) {
                extensionSettings.npcAvatars = {};
            }
            extensionSettings.npcAvatars[characterName] = hiResDataUrl;
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
 * Sets a character's dialogue color.
 */
function setCharacterColor(characterName, color) {
    if (!extensionSettings.characterColors) {
        extensionSettings.characterColors = {};
    }
    extensionSettings.characterColors[characterName] = color;
    saveSettings();
    updatePortraitBar();
    console.log(`[Dooms Tracker] Dialogue color set for ${characterName}: ${color}`);
}

/**
 * Clears a character's dialogue color (AI will pick its own).
 */
function clearCharacterColor(characterName) {
    if (extensionSettings.characterColors && extensionSettings.characterColors[characterName]) {
        delete extensionSettings.characterColors[characterName];
        saveSettings();
        updatePortraitBar();
        console.log(`[Dooms Tracker] Dialogue color cleared for ${characterName}`);
    }
}

/**
 * Removes a character from the known-characters roster (and their portrait if any).
 */
function removeCharacter(characterName) {
    // Add to removed-characters blacklist so getCharacterList() filters them out
    if (!extensionSettings.removedCharacters) {
        extensionSettings.removedCharacters = [];
    }
    if (!extensionSettings.removedCharacters.includes(characterName)) {
        extensionSettings.removedCharacters.push(characterName);
    }
    // Remove from known characters roster
    if (extensionSettings.knownCharacters && extensionSettings.knownCharacters[characterName]) {
        delete extensionSettings.knownCharacters[characterName];
    }
    // Also remove their portrait if one exists
    if (extensionSettings.npcAvatars && extensionSettings.npcAvatars[characterName]) {
        delete extensionSettings.npcAvatars[characterName];
    }
    // Remove from entrance animation tracking so they don't re-trigger
    _previousCharacterNames.delete(characterName);
    portraitFileCache.delete(characterName);
    saveSettings();
    updatePortraitBar();
    console.log(`[Dooms Tracker] Character removed from roster: ${characterName}`);
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
                    return !thoughts || !offScenePatterns.test(thoughts);
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
    const removed = extensionSettings.removedCharacters || [];
    const removedSet = new Set(removed);
    presentChars = presentChars.filter(c => !removedSet.has(c.name));

    // Update the persistent known-characters roster
    if (!extensionSettings.knownCharacters) {
        extensionSettings.knownCharacters = {};
    }
    let rosterChanged = false;
    for (const char of presentChars) {
        if (!extensionSettings.knownCharacters[char.name]) {
            extensionSettings.knownCharacters[char.name] = { emoji: char.emoji };
            rosterChanged = true;
        } else if (extensionSettings.knownCharacters[char.name].emoji !== char.emoji) {
            extensionSettings.knownCharacters[char.name].emoji = char.emoji;
            rosterChanged = true;
        }
    }
    if (rosterChanged) {
        saveSettings();
    }

    // Build absent list from known characters not currently present
    const presentNames = new Set(presentChars.map(c => c.name));
    const absentChars = [];
    for (const [name, info] of Object.entries(extensionSettings.knownCharacters)) {
        if (!presentNames.has(name) && !removedSet.has(name)) {
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
 * Shows thoughts, relationship, and key character info in compact form.
 */
function buildPortraitBackFace(charName, emoji) {
    const details = getCharacterDetails(charName);
    const nameEsc = escapeHtml(charName);

    let sectionsHtml = '';

    if (details) {
        // Thoughts
        const thoughts = details.thoughts?.content || details.thoughts || '';
        if (thoughts) {
            sectionsHtml += `<div class="dooms-pb-back-section">
                <div class="dooms-pb-back-label">💭 Thoughts</div>
                <div class="dooms-pb-back-value dooms-pb-back-thoughts">${escapeHtml(thoughts)}</div>
            </div>`;
        }

        // Relationship
        const relationship = details.Relationship || details.relationship || '';
        if (relationship) {
            sectionsHtml += `<div class="dooms-pb-back-section">
                <div class="dooms-pb-back-label">❤️ Relationship</div>
                <div class="dooms-pb-back-value">${escapeHtml(relationship)}</div>
            </div>`;
        }

        // Show other fields (skip name, emoji, thoughts, relationship which are already shown)
        const skipFields = new Set(['name', 'emoji', 'thoughts', 'relationship', 'stats']);
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
