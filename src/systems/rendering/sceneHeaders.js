/**
 * Scene Headers Rendering Module
 * Injects compact scene info blocks after assistant messages in the chat.
 * These blocks sit OUTSIDE .mes_text so TTS won't read them.
 *
 * Layout modes:
 *   - "grid"     — 2-column grid (default)
 *   - "stacked"  — single column
 *   - "compact"  — inline
 *   - "banner"   — horizontal strip after last assistant message
 *   - "hud"      — frosted-glass panel floating at top of chat
 *   - "ticker"   — collapsible bar pinned to top of chat
 */
import { extensionSettings, lastGeneratedData, committedTrackerData } from '../../core/state.js';

/** Cache of last rendered scene data JSON to skip redundant DOM rebuilds */
let _lastSceneDataJSON = null;

/**
 * Theme color palettes — exact values from the CSS popup theme blocks
 * (`#rpg-settings-popup[data-theme="..."] .rpg-settings-popup-content`).
 * Used when sceneTracker.themeControlled is true so the scene tracker
 * matches the visual style of the settings popup for the active theme.
 *
 * Fields: bg, accent, text, highlight, border
 */
const THEME_COLORS = {
    'sci-fi':        { bg: '#0a0e27', accent: '#1a1f3a', text: '#00ffff', highlight: '#ff00ff', border: '#00ffff' },
    'fantasy':       { bg: '#2b1810', accent: '#3d2516', text: '#f4e4c1', highlight: '#d4af37', border: '#8b6914' },
    'cyberpunk':     { bg: '#0d0221', accent: '#1a0b2e', text: '#00ff9f', highlight: '#ff00ff', border: '#ff00ff' },
    'midnight-rose': { bg: '#1a1025', accent: '#2a1838', text: '#e8d5e8', highlight: '#e8729a', border: '#9b4dca' },
    'emerald-grove': { bg: '#0d1f12', accent: '#1a3320', text: '#d4e8c8', highlight: '#c8a240', border: '#4a8c3f' },
    'arctic':        { bg: '#0c1929', accent: '#132640', text: '#dce8f4', highlight: '#64b5f6', border: '#4a8db7' },
    'volcanic':      { bg: '#1a1210', accent: '#2b1e18', text: '#f0dcc8', highlight: '#e8651a', border: '#b84a0f' },
    'dracula':       { bg: '#282a36', accent: '#343746', text: '#f8f8f2', highlight: '#ff5555', border: '#6272a4' },
    'ocean-depths':  { bg: '#0a1628', accent: '#0f2038', text: '#b8d8e8', highlight: '#00e5c8', border: '#1a6b8a' },
};

/**
 * Helper: converts a hex color (#rrggbb) to an "r, g, b" string for use in rgba().
 * @param {string} hex
 * @returns {string}
 */
export function hexToRgb(hex) {
    const h = hex.replace('#', '');
    const r = parseInt(h.substring(0, 2), 16);
    const g = parseInt(h.substring(2, 4), 16);
    const b = parseInt(h.substring(4, 6), 16);
    return `${r}, ${g}, ${b}`;
}

/**
 * Builds the inline CSS custom-property style string from the scene tracker settings.
 * When sceneTracker.themeControlled is true, derives colors from the active theme palette
 * instead of the individual color pickers.
 * @returns {string} e.g. "--st-accent-rgb: 233, 69, 96; --st-bg-opacity: 0.08; ..."
 */
function buildStyleVars() {
    const st = extensionSettings.sceneTracker || {};
    const vars = [];

    // Determine effective colors — either from theme palette or manual pickers
    let bgColor, borderColor, accentColor, badgeColor, labelColor, textColor, questIconColor, questTextColor, eventsTextColor;
    let bgOpacity, borderOpacity, badgeOpacity;

    if (st.themeControlled) {
        // Pull colors from the theme palette
        const themeName = extensionSettings.theme || 'default';
        const palette = THEME_COLORS[themeName] || null;
        if (palette) {
            bgColor         = palette.bg;
            borderColor     = palette.border;
            accentColor     = palette.highlight; // icons & left-border accent use the theme highlight
            badgeColor      = palette.highlight;
            labelColor      = palette.border;    // "Time:", "Location:" labels use the border color — distinct from both icons and body text
            textColor       = palette.text;      // body text (values) use the theme's main text color
            questIconColor  = palette.highlight;
            questTextColor  = palette.text;
            eventsTextColor = palette.border;    // events text uses border color — slightly muted vs body text
        } else {
            // 'default' or 'custom' — fall back to manual values
            bgColor        = st.bgColor        || '#e94560';
            borderColor    = st.borderColor    || '#e94560';
            accentColor    = st.accentColor    || '#e94560';
            badgeColor     = st.charBadgeBg    || '#e94560';
            labelColor     = st.labelColor     || '#888888';
            textColor      = st.textColor      || '#d0d0d0';
            questIconColor = st.questIconColor || '#f0c040';
            questTextColor = st.questTextColor || st.questIconColor || '#f0c040';
            eventsTextColor = st.eventsTextColor || '#999999';
        }
        // Use slightly more visible opacities when theme-controlled
        bgOpacity     = 12;
        borderOpacity = 20;
        badgeOpacity  = 15;
    } else {
        // Manual color picker values
        bgColor        = st.bgColor        || '#e94560';
        borderColor    = st.borderColor    || '#e94560';
        accentColor    = st.accentColor    || '#e94560';
        badgeColor     = st.charBadgeBg    || '#e94560';
        labelColor     = st.labelColor     || '#888888';
        textColor      = st.textColor      || '#d0d0d0';
        questIconColor = st.questIconColor || '#f0c040';
        questTextColor = st.questTextColor || st.questIconColor || '#f0c040';
        eventsTextColor = st.eventsTextColor || '#999999';
        bgOpacity     = st.bgOpacity     ?? 8;
        borderOpacity = st.borderOpacity ?? 15;
        badgeOpacity  = st.charBadgeOpacity ?? 12;
    }

    // Color RGB decompositions (for rgba usage)
    vars.push(`--st-bg-rgb: ${hexToRgb(bgColor)}`);
    vars.push(`--st-border-rgb: ${hexToRgb(borderColor)}`);
    vars.push(`--st-accent-rgb: ${hexToRgb(accentColor)}`);
    vars.push(`--st-badge-rgb: ${hexToRgb(badgeColor)}`);

    // Opacity values (0–1 range)
    vars.push(`--st-bg-opacity: ${bgOpacity / 100}`);
    vars.push(`--st-border-opacity: ${borderOpacity / 100}`);
    vars.push(`--st-badge-opacity: ${badgeOpacity / 100}`);

    // Direct color values
    vars.push(`--st-accent: ${accentColor}`);
    vars.push(`--st-border-color: ${borderColor}`);
    vars.push(`--st-label-color: ${labelColor}`);
    vars.push(`--st-text-color: ${textColor}`);
    vars.push(`--st-quest-icon: ${questIconColor}`);
    vars.push(`--st-quest-text: ${questTextColor}`);
    vars.push(`--st-events-text: ${eventsTextColor}`);

    // Sizing (always from manual settings)
    vars.push(`--st-font-size: ${st.fontSize ?? 82}`);
    vars.push(`--st-border-radius: ${st.borderRadius ?? 8}px`);
    vars.push(`--st-padding: ${st.padding ?? 10}px`);
    vars.push(`--st-border-width: ${st.borderWidth ?? 3}px`);

    // HUD-specific
    vars.push(`--st-hud-width: 220px`);
    vars.push(`--st-hud-opacity: 0.85`);

    return vars.join('; ');
}

/**
 * Applies scene tracker CSS custom properties to all existing scene header elements.
 * Called from index.js when settings change (for live preview without full re-render).
 */
export function applySceneTrackerSettings() {
    const style = buildStyleVars();
    const st = extensionSettings.sceneTracker || {};
    const layout = st.layout || 'grid';

    // Update classic layouts
    $('.dooms-scene-header').each(function () {
        this.setAttribute('style', style);
        // Update layout class
        this.classList.remove('dooms-scene-layout-grid', 'dooms-scene-layout-stacked', 'dooms-scene-layout-compact');
        this.classList.add(`dooms-scene-layout-${layout}`);
    });

    // Update banner/hud/ticker layouts
    $('.dooms-info-banner, .dooms-info-hud, .dooms-info-ticker-wrapper').each(function () {
        this.setAttribute('style', style);
    });
}

/**
 * Reset the scene header cache (call on chat change so first render always runs).
 */
export function resetSceneHeaderCache() {
    _lastSceneDataJSON = null;
}

// ─────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────

function getCharacterColor(name) {
    return extensionSettings.characterColors?.[name] || null;
}

/**
 * Removes all scene header / info panel elements from the DOM.
 */
function removeAllSceneElements() {
    $('.dooms-scene-header, .dooms-info-banner, .dooms-info-hud, .dooms-info-ticker-wrapper').remove();
}

/**
 * Find the last non-user message in #chat.
 */
function findLastAssistantMessage() {
    const $messages = $('#chat .mes');
    for (let i = $messages.length - 1; i >= 0; i--) {
        const $msg = $messages.eq(i);
        if ($msg.attr('is_user') !== 'true') return $msg;
    }
    return null;
}

// ─────────────────────────────────────────────
//  Main entry point
// ─────────────────────────────────────────────

/**
 * Main entry point. Removes old scene headers, finds the last assistant message,
 * extracts scene data, and injects a scene header block after it.
 */
export function updateChatSceneHeaders() {
    if (!extensionSettings.enabled) {
        removeAllSceneElements();
        _lastSceneDataJSON = null;
        return;
    }
    // Extract scene data from current state, respecting display toggle settings
    const sceneData = extractSceneData(
        extensionSettings.showInfoBox ? (lastGeneratedData.infoBox || committedTrackerData.infoBox) : null,
        extensionSettings.showCharacterThoughts ? (lastGeneratedData.characterThoughts || committedTrackerData.characterThoughts) : null,
        extensionSettings.showQuests ? extensionSettings.quests : null
    );
    // If there's no meaningful data, remove existing header and return
    if (!sceneData.time && !sceneData.date && !sceneData.location && sceneData.presentCharacters.length === 0 && !sceneData.activeQuest) {
        removeAllSceneElements();
        _lastSceneDataJSON = null;
        return;
    }
    // Skip rebuild if data + settings are identical to last render
    const st = extensionSettings.sceneTracker || {};
    const cacheKey = JSON.stringify({ sceneData, st });
    if (cacheKey === _lastSceneDataJSON) {
        // Check if the element is still in the DOM
        if ($('.dooms-scene-header, .dooms-info-banner, .dooms-info-hud, .dooms-info-ticker-wrapper').length) {
            return;
        }
    }
    _lastSceneDataJSON = cacheKey;
    // Remove existing scene headers before inserting new one
    removeAllSceneElements();

    const layout = st.layout || 'grid';

    // Dispatch to the appropriate renderer
    if (layout === 'banner') {
        const html = createBannerHTML(sceneData);
        if (html) {
            const $target = findLastAssistantMessage();
            if ($target) {
                $target.after(html);
                // Scroll the banner into view so it isn't hidden below the viewport
                const $banner = $('.dooms-info-banner').last();
                if ($banner.length) {
                    $banner[0].scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                }
            }
        }
    } else if (layout === 'hud') {
        const html = createHudHTML(sceneData);
        if (html) $('#chat').prepend(html);
    } else if (layout === 'ticker') {
        const html = createTickerHTML(sceneData);
        if (html) $('#chat').prepend(html);
    } else {
        // Classic layouts: grid, stacked, compact
        const $target = findLastAssistantMessage();
        if (!$target) return;
        const headerHTML = createSceneHeaderHTML(sceneData);
        $target.after(headerHTML);
    }
}

// ─────────────────────────────────────────────
//  Data extraction
// ─────────────────────────────────────────────

/**
 * Extracts scene data from the three data sources into a flat object.
 * @param {string|object|null} infoBoxData - Info box data (JSON string or object)
 * @param {string|object|null} characterThoughtsData - Character thoughts data
 * @param {object|null} questsData - Quests data from extensionSettings
 * @returns {{ time: string, date: string, location: string, presentCharacters: Array<{name: string, emoji: string}>, activeQuest: string, recentEvents: string }}
 */
export function extractSceneData(infoBoxData, characterThoughtsData, questsData) {
    const result = {
        time: '',
        date: '',
        location: '',
        presentCharacters: [],
        activeQuest: '',
        recentEvents: ''
    };
    // --- Parse Info Box ---
    if (infoBoxData) {
        try {
            const info = typeof infoBoxData === 'string' ? JSON.parse(infoBoxData) : infoBoxData;
            // Time
            if (info.time) {
                if (info.time.start && info.time.end) {
                    result.time = `${info.time.start} → ${info.time.end}`;
                } else if (info.time.start) {
                    result.time = info.time.start;
                } else if (info.time.value) {
                    result.time = info.time.value;
                }
            }
            // Date
            if (info.date) {
                result.date = info.date.value || '';
            }
            // Location
            if (info.location) {
                result.location = info.location.value || '';
            }
            // Recent Events (limit to 2 major events for the scene header)
            if (info.recentEvents) {
                if (Array.isArray(info.recentEvents)) {
                    result.recentEvents = info.recentEvents.slice(0, 2).join('; ');
                } else if (typeof info.recentEvents === 'string') {
                    result.recentEvents = info.recentEvents;
                } else if (info.recentEvents.value) {
                    result.recentEvents = info.recentEvents.value;
                } else if (info.recentEvents.events) {
                    result.recentEvents = Array.isArray(info.recentEvents.events)
                        ? info.recentEvents.events.slice(0, 2).join('; ')
                        : info.recentEvents.events;
                }
            }
        } catch (e) {
            // Try legacy text format
            if (typeof infoBoxData === 'string') {
                const lines = infoBoxData.split('\n');
                for (const line of lines) {
                    const trimmed = line.trim();
                    if (trimmed.match(/^🕒|^Time:/i)) {
                        result.time = trimmed.replace(/^🕒\s*|^Time:\s*/i, '').trim();
                    } else if (trimmed.match(/^🗓️|^Date:/i)) {
                        result.date = trimmed.replace(/^🗓️\s*|^Date:\s*/i, '').trim();
                    } else if (trimmed.match(/^🗺️|^Location:/i)) {
                        result.location = trimmed.replace(/^🗺️\s*|^Location:\s*/i, '').trim();
                    }
                }
            }
        }
    }
    // --- Parse Present Characters ---
    const offScenePatterns = /\b(not\s+(currently\s+)?(in|at|present|in\s+the)\s+(the\s+)?(scene|area|room|location|vicinity))\b|\b(off[\s-]?scene)\b|\b(not\s+present)\b|\b(absent)\b|\b(away\s+from\s+(the\s+)?scene)\b/i;
    if (characterThoughtsData) {
        try {
            const parsed = typeof characterThoughtsData === 'string'
                ? JSON.parse(characterThoughtsData)
                : characterThoughtsData;
            const characters = Array.isArray(parsed) ? parsed : (parsed.characters || []);
            result.presentCharacters = characters
                .filter(char => {
                    const thoughts = char.thoughts?.content || char.thoughts || '';
                    return !thoughts || !offScenePatterns.test(thoughts);
                })
                .map(char => ({
                    name: char.name || 'Unknown',
                    emoji: char.emoji || '👤'
                }));
        } catch (e) {
            // Try text format - look for "- CharacterName" lines
            if (typeof characterThoughtsData === 'string') {
                const lines = characterThoughtsData.split('\n');
                for (const line of lines) {
                    const match = line.trim().match(/^-\s+(.+)$/);
                    if (match && !match[1].includes(':') && !match[1].includes('---')) {
                        result.presentCharacters.push({
                            name: match[1].trim(),
                            emoji: '👤'
                        });
                    }
                }
            }
        }
    }
    // --- Parse Quests ---
    if (questsData) {
        if (questsData.main && questsData.main !== 'None' && questsData.main !== 'none') {
            result.activeQuest = questsData.main;
        }
    }
    return result;
}

// ─────────────────────────────────────────────
//  Classic Layout Renderer (grid / stacked / compact)
// ─────────────────────────────────────────────

/**
 * Builds the classic scene header HTML string.
 * @param {{ time: string, date: string, location: string, presentCharacters: Array<{name: string, emoji: string}>, activeQuest: string, recentEvents: string }} data
 * @returns {string} HTML string
 */
function createSceneHeaderHTML(data) {
    const st = extensionSettings.sceneTracker || {};
    const rows = [];

    // Time
    if (data.time && st.showTime !== false) {
        rows.push(`
            <div class="dooms-scene-row">
                <i class="fa-solid fa-clock"></i>
                <span class="dooms-scene-label">Time:</span>
                <span class="dooms-scene-value">${escapeHtml(data.time)}</span>
            </div>
        `);
    }
    // Date
    if (data.date && st.showDate !== false) {
        rows.push(`
            <div class="dooms-scene-row">
                <i class="fa-solid fa-calendar"></i>
                <span class="dooms-scene-label">Date:</span>
                <span class="dooms-scene-value">${escapeHtml(data.date)}</span>
            </div>
        `);
    }
    // Location
    if (data.location && st.showLocation !== false) {
        rows.push(`
            <div class="dooms-scene-row">
                <i class="fa-solid fa-location-dot"></i>
                <span class="dooms-scene-label">Location:</span>
                <span class="dooms-scene-value">${escapeHtml(data.location)}</span>
            </div>
        `);
    }
    // Present Characters
    if (data.presentCharacters.length > 0 && st.showCharacters !== false) {
        const badges = data.presentCharacters.map(c =>
            `<span class="dooms-scene-char-badge"><span class="dooms-scene-char-avatar">${escapeHtml(c.emoji)}</span> ${escapeHtml(c.name)}</span>`
        ).join('');
        rows.push(`
            <div class="dooms-scene-characters">
                <i class="fa-solid fa-users"></i>
                <span class="dooms-scene-label">Present:</span>
                <div class="dooms-scene-chars-list">${badges}</div>
            </div>
        `);
    }
    // Active Quest
    if (data.activeQuest && st.showQuest !== false) {
        rows.push(`
            <div class="dooms-scene-quest">
                <i class="fa-solid fa-scroll"></i>
                <span class="dooms-scene-label">Quest:</span>
                <span class="dooms-scene-value">${escapeHtml(data.activeQuest)}</span>
            </div>
        `);
    }
    // Recent Events
    if (data.recentEvents && st.showRecentEvents !== false) {
        rows.push(`
            <div class="dooms-scene-events">
                <i class="fa-solid fa-bolt"></i>
                <span class="dooms-scene-label">Recent:</span>
                <span class="dooms-scene-value dooms-scene-events-text">${escapeHtml(data.recentEvents)}</span>
            </div>
        `);
    }

    // If all rows were hidden by settings, return empty
    if (rows.length === 0) return '';

    const layout = st.layout || 'grid';
    const styleVars = buildStyleVars();

    return `<div class="dooms-scene-header dooms-scene-layout-${escapeHtml(layout)}" style="${styleVars}">${rows.join('')}</div>`;
}

// ─────────────────────────────────────────────
//  Banner Renderer (Inline strip after last message)
// ─────────────────────────────────────────────

function createBannerHTML(data) {
    const st = extensionSettings.sceneTracker || {};
    const styleVars = buildStyleVars();
    const items = [];

    if (data.time && st.showTime !== false) {
        items.push(`<div class="dooms-ip-item">
            <i class="fa-solid fa-clock"></i>
            <span class="dooms-ip-label">Time:</span>
            <span class="dooms-ip-value">${escapeHtml(data.time)}</span>
        </div>`);
    }
    if (data.date && st.showDate !== false) {
        items.push(`<div class="dooms-ip-item">
            <i class="fa-solid fa-calendar"></i>
            <span class="dooms-ip-label">Date:</span>
            <span class="dooms-ip-value">${escapeHtml(data.date)}</span>
        </div>`);
    }
    if (data.location && st.showLocation !== false) {
        items.push(`<div class="dooms-ip-item">
            <i class="fa-solid fa-location-dot"></i>
            <span class="dooms-ip-label">Location:</span>
            <span class="dooms-ip-value">${escapeHtml(data.location)}</span>
        </div>`);
    }

    const itemsWithDividers = items.length > 1
        ? items.join('<div class="dooms-ip-divider"></div>')
        : items.join('');

    // Characters
    let charsHtml = '';
    if (data.presentCharacters.length > 0 && st.showCharacters !== false) {
        const badges = data.presentCharacters.map(c => {
            const color = getCharacterColor(c.name);
            const dotStyle = color ? ` style="background: ${escapeHtml(color)}"` : '';
            return `<span class="dooms-ip-char"><span class="dooms-ip-char-dot"${dotStyle}></span> ${escapeHtml(c.name)}</span>`;
        }).join('');
        charsHtml = `<div class="dooms-ip-item">
            <i class="fa-solid fa-users"></i>
            <span class="dooms-ip-label">Present:</span>
            <div class="dooms-ip-chars">${badges}</div>
        </div>`;
    }

    // Quest
    let questHtml = '';
    if (data.activeQuest && st.showQuest !== false) {
        questHtml = `<div class="dooms-ip-quest">
            <i class="fa-solid fa-scroll"></i>
            <span class="dooms-ip-label">Quest:</span>
            <span class="dooms-ip-value">${escapeHtml(data.activeQuest)}</span>
        </div>`;
    }

    // Recent events
    let eventsHtml = '';
    if (data.recentEvents && st.showRecentEvents !== false) {
        eventsHtml = `<div class="dooms-ip-quest dooms-ip-events">
            <i class="fa-solid fa-bolt"></i>
            <span class="dooms-ip-label">Recent:</span>
            <span class="dooms-ip-value dooms-ip-events-text">${escapeHtml(data.recentEvents)}</span>
        </div>`;
    }

    if (!itemsWithDividers && !charsHtml && !questHtml && !eventsHtml) return '';

    return `<div class="dooms-info-banner" style="${styleVars}">
        ${itemsWithDividers}
        ${charsHtml ? (items.length ? '<div class="dooms-ip-divider"></div>' : '') + charsHtml : ''}
        ${questHtml}
        ${eventsHtml}
    </div>`;
}

// ─────────────────────────────────────────────
//  HUD Renderer (Floating panel at top of chat)
// ─────────────────────────────────────────────

function createHudHTML(data) {
    const st = extensionSettings.sceneTracker || {};
    const styleVars = buildStyleVars();
    const rows = [];

    if (data.time && st.showTime !== false) {
        rows.push(`<div class="dooms-ip-hud-row">
            <i class="fa-solid fa-clock"></i>
            <span class="dooms-ip-hud-label">Time</span>
            <span class="dooms-ip-hud-value">${escapeHtml(data.time)}</span>
        </div>`);
    }
    if (data.date && st.showDate !== false) {
        rows.push(`<div class="dooms-ip-hud-row">
            <i class="fa-solid fa-calendar"></i>
            <span class="dooms-ip-hud-label">Date</span>
            <span class="dooms-ip-hud-value">${escapeHtml(data.date)}</span>
        </div>`);
    }
    if (data.location && st.showLocation !== false) {
        rows.push(`<div class="dooms-ip-hud-row">
            <i class="fa-solid fa-location-dot"></i>
            <span class="dooms-ip-hud-label">Location</span>
            <span class="dooms-ip-hud-value">${escapeHtml(data.location)}</span>
        </div>`);
    }

    // Characters
    if (data.presentCharacters.length > 0 && st.showCharacters !== false) {
        const chars = data.presentCharacters.map(c => {
            const color = getCharacterColor(c.name);
            const dotStyle = color ? ` style="background: ${escapeHtml(color)}"` : '';
            return `<span class="dooms-ip-hud-char"><span class="dooms-ip-hud-char-dot"${dotStyle}></span> ${escapeHtml(c.name)}</span>`;
        }).join('');
        rows.push(`<div class="dooms-ip-hud-divider"></div>`);
        rows.push(`<div class="dooms-ip-hud-row">
            <i class="fa-solid fa-users"></i>
            <span class="dooms-ip-hud-label">Present</span>
            <div class="dooms-ip-hud-chars">${chars}</div>
        </div>`);
    }

    // Quest
    if (data.activeQuest && st.showQuest !== false) {
        rows.push(`<div class="dooms-ip-hud-divider"></div>`);
        rows.push(`<div class="dooms-ip-hud-row dooms-ip-hud-quest">
            <i class="fa-solid fa-scroll"></i>
            <span class="dooms-ip-hud-label">Quest</span>
            <span class="dooms-ip-hud-value">${escapeHtml(data.activeQuest)}</span>
        </div>`);
    }

    // Recent Events
    if (data.recentEvents && st.showRecentEvents !== false) {
        rows.push(`<div class="dooms-ip-hud-divider"></div>`);
        rows.push(`<div class="dooms-ip-hud-row" style="flex-direction: column; gap: 4px;">
            <div style="display: flex; align-items: center; gap: 5px;">
                <i class="fa-solid fa-bolt"></i>
                <span class="dooms-ip-hud-label">Recent</span>
            </div>
            <div class="dooms-ip-hud-events">
                ${data.recentEvents.split(';').map(e => e.trim()).filter(e => e).map(e =>
                    `<div class="dooms-ip-hud-event"><span class="dooms-ip-hud-event-bullet">&bull;</span> ${escapeHtml(e)}</div>`
                ).join('')}
            </div>
        </div>`);
    }

    if (!rows.length) return '';

    return `<div class="dooms-info-hud" style="${styleVars}">
        <div class="dooms-ip-hud-title">
            <i class="fa-solid fa-compass"></i>
            Scene Info
        </div>
        ${rows.join('')}
    </div>`;
}

// ─────────────────────────────────────────────
//  Ticker Renderer (Collapsible bar at top of chat)
// ─────────────────────────────────────────────

function createTickerHTML(data) {
    const st = extensionSettings.sceneTracker || {};
    const styleVars = buildStyleVars();

    // Collapsed bar items
    const tickerItems = [];
    if (data.time && st.showTime !== false) {
        tickerItems.push(`<span class="dooms-ip-ticker-item">
            <i class="fa-solid fa-clock"></i> ${escapeHtml(data.time.split('→')[0].trim())}
        </span>`);
    }
    if (data.location && st.showLocation !== false) {
        const loc = data.location.length > 30 ? data.location.substring(0, 28) + '...' : data.location;
        tickerItems.push(`<span class="dooms-ip-ticker-item">
            <i class="fa-solid fa-location-dot"></i> ${escapeHtml(loc)}
        </span>`);
    }
    if (data.activeQuest && st.showQuest !== false) {
        const quest = data.activeQuest.length > 30 ? data.activeQuest.substring(0, 28) + '...' : data.activeQuest;
        tickerItems.push(`<span class="dooms-ip-ticker-item dooms-ip-ticker-quest">
            <i class="fa-solid fa-scroll"></i> ${escapeHtml(quest)}
        </span>`);
    }

    // Character color dots
    let charDots = '';
    if (data.presentCharacters.length > 0 && st.showCharacters !== false) {
        charDots = data.presentCharacters.map(c => {
            const color = getCharacterColor(c.name);
            const style = color ? ` style="background: ${escapeHtml(color)}"` : '';
            return `<span class="dooms-ip-ticker-char-dot"${style} title="${escapeHtml(c.name)}"></span>`;
        }).join('');
    }

    // Expanded panel rows
    const panelRows = [];
    if (data.time && st.showTime !== false) {
        panelRows.push(`<div class="dooms-ip-panel-row">
            <i class="fa-solid fa-clock"></i>
            <span class="dooms-ip-panel-label">Time</span>
            <span class="dooms-ip-panel-value">${escapeHtml(data.time)}</span>
        </div>`);
    }
    if (data.date && st.showDate !== false) {
        panelRows.push(`<div class="dooms-ip-panel-row">
            <i class="fa-solid fa-calendar"></i>
            <span class="dooms-ip-panel-label">Date</span>
            <span class="dooms-ip-panel-value">${escapeHtml(data.date)}</span>
        </div>`);
    }
    if (data.location && st.showLocation !== false) {
        panelRows.push(`<div class="dooms-ip-panel-row dooms-ip-panel-full">
            <i class="fa-solid fa-location-dot"></i>
            <span class="dooms-ip-panel-label">Location</span>
            <span class="dooms-ip-panel-value">${escapeHtml(data.location)}</span>
        </div>`);
    }
    if (data.presentCharacters.length > 0 && st.showCharacters !== false) {
        const chars = data.presentCharacters.map(c => {
            const color = getCharacterColor(c.name);
            const dotStyle = color ? ` style="background: ${escapeHtml(color)}"` : '';
            return `<span class="dooms-ip-panel-char"><span class="dooms-ip-panel-char-dot"${dotStyle}></span> ${escapeHtml(c.name)}</span>`;
        }).join('');
        panelRows.push(`<div class="dooms-ip-panel-row dooms-ip-panel-full">
            <i class="fa-solid fa-users"></i>
            <span class="dooms-ip-panel-label">Present</span>
            <div class="dooms-ip-panel-chars">${chars}</div>
        </div>`);
    }
    if (data.activeQuest && st.showQuest !== false) {
        panelRows.push(`<div class="dooms-ip-panel-row dooms-ip-panel-full dooms-ip-panel-quest">
            <i class="fa-solid fa-scroll"></i>
            <span class="dooms-ip-panel-label">Quest</span>
            <span class="dooms-ip-panel-value">${escapeHtml(data.activeQuest)}</span>
        </div>`);
    }
    if (data.recentEvents && st.showRecentEvents !== false) {
        const events = data.recentEvents.split(';').map(e => e.trim()).filter(e => e).map(e =>
            `<div class="dooms-ip-panel-event"><span class="dooms-ip-panel-event-bullet">&bull;</span> ${escapeHtml(e)}</div>`
        ).join('');
        panelRows.push(`<div class="dooms-ip-panel-events dooms-ip-panel-full">${events}</div>`);
    }

    if (!tickerItems.length && !charDots && !panelRows.length) return '';

    return `<div class="dooms-info-ticker-wrapper" style="${styleVars}">
        <div class="dooms-info-ticker">
            <span class="dooms-ip-ticker-icon"><i class="fa-solid fa-compass"></i></span>
            <div class="dooms-ip-ticker-items">
                ${tickerItems.join('<span class="dooms-ip-ticker-sep">|</span>')}
            </div>
            ${charDots ? `<div class="dooms-ip-ticker-chars">${charDots}</div>` : ''}
            <span class="dooms-ip-ticker-expand"><i class="fa-solid fa-chevron-down"></i></span>
        </div>
        <div class="dooms-info-ticker-panel">
            <div class="dooms-ip-panel-grid">
                ${panelRows.join('')}
            </div>
        </div>
    </div>`;
}

// ─────────────────────────────────────────────
//  Utility
// ─────────────────────────────────────────────

/**
 * Simple HTML escape to prevent XSS from AI-generated content.
 * @param {string} str
 * @returns {string}
 */
function escapeHtml(str) {
    if (!str) return '';
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}
