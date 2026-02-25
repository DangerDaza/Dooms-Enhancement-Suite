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
import { getDoomCounterState } from '../../core/persistence.js';

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
            accentColor     = palette.highlight; // icons & left-border accent: theme highlight (e.g. gold for fantasy)
            badgeColor      = palette.highlight;
            labelColor      = palette.text;      // "Time:", "Location:" labels: theme text color (e.g. cream for fantasy) — distinct from gold icons
            textColor       = palette.text;      // value text: same as labels for clean reading
            questIconColor  = palette.highlight;
            questTextColor  = palette.text;
            eventsTextColor = palette.text;
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
    $('#dooms-ticker-rotate-style').remove();
    $('#chat').removeClass('dooms-ticker-active dooms-ticker-bottom-active');
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
    const infoBoxData = extensionSettings.showInfoBox ? (lastGeneratedData.infoBox || committedTrackerData.infoBox) : null;
    const sceneData = extractSceneData(
        infoBoxData,
        extensionSettings.showCharacterThoughts ? (lastGeneratedData.characterThoughts || committedTrackerData.characterThoughts) : null,
        extensionSettings.showQuests ? extensionSettings.quests : null
    );
    const st = extensionSettings.sceneTracker || {};
    const layout = st.layout || 'grid';
    // If there's no meaningful data, remove existing header and return
    const hasAnyData = sceneData.time || sceneData.date || sceneData.location ||
        sceneData.recentEvents || sceneData.activeQuest ||
        sceneData.moonPhase || sceneData.tension || sceneData.timeSinceRest ||
        sceneData.conditions || sceneData.terrain ||
        sceneData.presentCharacters.length > 0;
    if (!hasAnyData) {
        removeAllSceneElements();
        _lastSceneDataJSON = null;
        return;
    }
    // Skip rebuild if data + settings are identical to last render
    // Include doom counter state in cache key so badge updates when streak/countdown changes
    const dcState = (extensionSettings.doomCounter?.enabled && extensionSettings.doomCounter?.debugDisplay) ? getDoomCounterState() : null;
    const cacheKey = JSON.stringify({ sceneData, st, dcState });
    if (cacheKey === _lastSceneDataJSON) {
        // Check if the element is still in the DOM
        if ($('.dooms-scene-header, .dooms-info-banner, .dooms-info-hud, .dooms-info-ticker-wrapper').length) {
            return;
        }
    }
    _lastSceneDataJSON = cacheKey;
    // Remove existing scene headers before inserting new one
    removeAllSceneElements();

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
        // Insert the ticker as a flex child of #sheld, directly before #chat.
        // This keeps it in the same stacking context as other extensions (e.g.
        // PathWeaver) so z-index conflicts don't occur. The ticker flows
        // naturally in the layout — no position:fixed, no padding hacks.
        const html = createTickerHTML(sceneData);
        if (html) {
            const $chat = $('#chat');
            if ($chat.length) {
                $chat.before(html);
            } else {
                $('body').append(html);
            }
            $('#chat').addClass('dooms-ticker-active');
        }
    } else if (layout === 'ticker-bottom') {
        // Insert the ticker as a flex child of #sheld, directly before #form_sheld.
        // This means it sits naturally in the layout flow — no position:fixed, no JS
        // measurement of the input bar height, and no snapping on initial render.
        const html = createTickerHTML(sceneData);
        if (html) {
            const $el = $(html);
            $el.addClass('ticker-bottom');
            const $formSheld = $('#form_sheld');
            if ($formSheld.length) {
                $formSheld.before($el);
            } else {
                $('body').append($el);
            }
            $('#chat').addClass('dooms-ticker-bottom-active');
        }
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
        moonPhase: '',
        tension: '',
        timeSinceRest: '',
        conditions: '',
        terrain: '',
        doomTension: null,
        presentCharacters: [],
        activeQuest: '',
        recentEvents: ''
    };
    // --- Parse Info Box ---
    if (infoBoxData) {
        try {
            const info = typeof infoBoxData === 'string' ? JSON.parse(infoBoxData) : infoBoxData;
            // Time — handle nested object {start, end} or {value} or flat string
            if (info.time) {
                if (typeof info.time === 'string') {
                    result.time = info.time;
                } else if (info.time.start && info.time.end) {
                    result.time = `${info.time.start} → ${info.time.end}`;
                } else if (info.time.start) {
                    result.time = info.time.start;
                } else if (info.time.value) {
                    result.time = info.time.value;
                }
            }
            // Date — handle nested object {value} or flat string
            if (info.date) {
                if (typeof info.date === 'string') {
                    result.date = info.date;
                } else {
                    result.date = info.date.value || '';
                }
            }
            // Location — handle nested object {value} or flat string
            if (info.location) {
                if (typeof info.location === 'string') {
                    result.location = info.location;
                } else {
                    result.location = info.location.value || '';
                }
            }
            // New optional fields — all flat strings
            if (info.moonPhase) {
                result.moonPhase = typeof info.moonPhase === 'string' ? info.moonPhase : (info.moonPhase.value || '');
            }
            if (info.tension) {
                result.tension = typeof info.tension === 'string' ? info.tension : (info.tension.value || '');
            }
            if (info.timeSinceRest) {
                result.timeSinceRest = typeof info.timeSinceRest === 'string' ? info.timeSinceRest : (info.timeSinceRest.value || '');
            }
            if (info.conditions) {
                result.conditions = typeof info.conditions === 'string' ? info.conditions : (info.conditions.value || '');
            }
            if (info.terrain) {
                result.terrain = typeof info.terrain === 'string' ? info.terrain : (info.terrain.value || '');
            }
            // Doom Tension (numeric 1-10)
            if (info.doomTension !== undefined && info.doomTension !== null) {
                const raw = typeof info.doomTension === 'object' ? info.doomTension.value : info.doomTension;
                const num = Number(raw);
                if (!isNaN(num) && num >= 1 && num <= 10) {
                    result.doomTension = Math.round(num);
                }
            }
            // Recent Events (limit to 2 major events for the scene header)
            if (info.recentEvents) {
                if (Array.isArray(info.recentEvents)) {
                    // Array of strings or objects — extract string values
                    const events = info.recentEvents.map(e => typeof e === 'string' ? e : (e.value || e.text || e.description || JSON.stringify(e)));
                    result.recentEvents = events.slice(0, 2).join('; ');
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
    // Moon Phase
    if (data.moonPhase && st.showMoonPhase !== false) {
        rows.push(`
            <div class="dooms-scene-row">
                <i class="fa-solid fa-moon"></i>
                <span class="dooms-scene-label">Moon Phase:</span>
                <span class="dooms-scene-value">${escapeHtml(data.moonPhase)}</span>
            </div>
        `);
    }
    // Tension
    if (data.tension && st.showTension !== false) {
        rows.push(`
            <div class="dooms-scene-row">
                <i class="fa-solid fa-fire"></i>
                <span class="dooms-scene-label">Tension:</span>
                <span class="dooms-scene-value">${escapeHtml(data.tension)}</span>
            </div>
        `);
    }
    // Time Since Rest
    if (data.timeSinceRest && st.showTimeSinceRest !== false) {
        rows.push(`
            <div class="dooms-scene-row">
                <i class="fa-solid fa-hourglass-half"></i>
                <span class="dooms-scene-label">Rest:</span>
                <span class="dooms-scene-value">${escapeHtml(data.timeSinceRest)}</span>
            </div>
        `);
    }
    // Active Conditions
    if (data.conditions && st.showConditions !== false) {
        rows.push(`
            <div class="dooms-scene-row">
                <i class="fa-solid fa-heart-crack"></i>
                <span class="dooms-scene-label">Conditions:</span>
                <span class="dooms-scene-value">${escapeHtml(data.conditions)}</span>
            </div>
        `);
    }
    // Terrain
    if (data.terrain && st.showTerrain !== false) {
        rows.push(`
            <div class="dooms-scene-row">
                <i class="fa-solid fa-tree"></i>
                <span class="dooms-scene-label">Terrain:</span>
                <span class="dooms-scene-value">${escapeHtml(data.terrain)}</span>
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
                <i class="fa-solid fa-newspaper"></i>
                <span class="dooms-scene-label">Recent:</span>
                <span class="dooms-scene-value dooms-scene-events-text">${escapeHtml(data.recentEvents)}</span>
            </div>
        `);
    }

    // If all rows were hidden by settings, return empty
    if (rows.length === 0) return '';

    const layout = st.layout || 'grid';
    const styleVars = buildStyleVars();

    const doomBadge = buildDoomCounterBadge(data.doomTension);

    return `<div class="dooms-scene-header dooms-scene-layout-${escapeHtml(layout)}" style="${styleVars}">${doomBadge}${rows.join('')}</div>`;
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
    if (data.moonPhase && st.showMoonPhase !== false) {
        items.push(`<div class="dooms-ip-item">
            <i class="fa-solid fa-moon"></i>
            <span class="dooms-ip-label">Moon Phase:</span>
            <span class="dooms-ip-value">${escapeHtml(data.moonPhase)}</span>
        </div>`);
    }
    if (data.tension && st.showTension !== false) {
        items.push(`<div class="dooms-ip-item">
            <i class="fa-solid fa-fire"></i>
            <span class="dooms-ip-label">Tension:</span>
            <span class="dooms-ip-value">${escapeHtml(data.tension)}</span>
        </div>`);
    }
    if (data.timeSinceRest && st.showTimeSinceRest !== false) {
        items.push(`<div class="dooms-ip-item">
            <i class="fa-solid fa-hourglass-half"></i>
            <span class="dooms-ip-label">Rest:</span>
            <span class="dooms-ip-value">${escapeHtml(data.timeSinceRest)}</span>
        </div>`);
    }
    if (data.conditions && st.showConditions !== false) {
        items.push(`<div class="dooms-ip-item">
            <i class="fa-solid fa-heart-crack"></i>
            <span class="dooms-ip-label">Conditions:</span>
            <span class="dooms-ip-value">${escapeHtml(data.conditions)}</span>
        </div>`);
    }
    if (data.terrain && st.showTerrain !== false) {
        items.push(`<div class="dooms-ip-item">
            <i class="fa-solid fa-tree"></i>
            <span class="dooms-ip-label">Terrain:</span>
            <span class="dooms-ip-value">${escapeHtml(data.terrain)}</span>
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
            <i class="fa-solid fa-newspaper"></i>
            <span class="dooms-ip-label">Recent:</span>
            <span class="dooms-ip-value dooms-ip-events-text">${escapeHtml(data.recentEvents)}</span>
        </div>`;
    }

    if (!itemsWithDividers && !charsHtml && !questHtml && !eventsHtml) return '';

    const doomBadge = buildDoomCounterBadge(data.doomTension);

    return `<div class="dooms-info-banner" style="${styleVars}">
        ${doomBadge}
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
    if (data.moonPhase && st.showMoonPhase !== false) {
        rows.push(`<div class="dooms-ip-hud-row">
            <i class="fa-solid fa-moon"></i>
            <span class="dooms-ip-hud-label">Moon Phase</span>
            <span class="dooms-ip-hud-value">${escapeHtml(data.moonPhase)}</span>
        </div>`);
    }
    if (data.tension && st.showTension !== false) {
        rows.push(`<div class="dooms-ip-hud-row">
            <i class="fa-solid fa-fire"></i>
            <span class="dooms-ip-hud-label">Tension</span>
            <span class="dooms-ip-hud-value">${escapeHtml(data.tension)}</span>
        </div>`);
    }
    if (data.timeSinceRest && st.showTimeSinceRest !== false) {
        rows.push(`<div class="dooms-ip-hud-row">
            <i class="fa-solid fa-hourglass-half"></i>
            <span class="dooms-ip-hud-label">Rest</span>
            <span class="dooms-ip-hud-value">${escapeHtml(data.timeSinceRest)}</span>
        </div>`);
    }
    if (data.conditions && st.showConditions !== false) {
        rows.push(`<div class="dooms-ip-hud-row">
            <i class="fa-solid fa-heart-crack"></i>
            <span class="dooms-ip-hud-label">Conditions</span>
            <span class="dooms-ip-hud-value">${escapeHtml(data.conditions)}</span>
        </div>`);
    }
    if (data.terrain && st.showTerrain !== false) {
        rows.push(`<div class="dooms-ip-hud-row">
            <i class="fa-solid fa-tree"></i>
            <span class="dooms-ip-hud-label">Terrain</span>
            <span class="dooms-ip-hud-value">${escapeHtml(data.terrain)}</span>
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
                <i class="fa-solid fa-newspaper"></i>
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

    const doomBadge = buildDoomCounterBadge(data.doomTension);

    return `<div class="dooms-info-hud" style="${styleVars}">
        <div class="dooms-ip-hud-title">
            <i class="fa-solid fa-compass"></i>
            Scene Info
            ${doomBadge}
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

    // Collapsed bar items — each one rotates in one at a time (full bar width available,
    // no need for aggressive truncation; 60-char soft cap keeps it readable)
    const MAX_LEN = 60;
    const trunc = (s) => s.length > MAX_LEN ? s.substring(0, MAX_LEN - 1) + '…' : s;
    const tickerItems = [];
    if (data.time && st.showTime !== false) {
        tickerItems.push(`<span class="dooms-ip-ticker-item">
            <i class="fa-solid fa-clock"></i> ${escapeHtml(data.time.split('→')[0].trim())}
        </span>`);
    }
    if (data.date && st.showDate !== false) {
        tickerItems.push(`<span class="dooms-ip-ticker-item">
            <i class="fa-solid fa-calendar"></i> ${escapeHtml(trunc(data.date))}
        </span>`);
    }
    if (data.location && st.showLocation !== false) {
        tickerItems.push(`<span class="dooms-ip-ticker-item">
            <i class="fa-solid fa-location-dot"></i> ${escapeHtml(trunc(data.location))}
        </span>`);
    }
    if (data.moonPhase && st.showMoonPhase !== false) {
        tickerItems.push(`<span class="dooms-ip-ticker-item">
            <i class="fa-solid fa-moon"></i> ${escapeHtml(data.moonPhase)}
        </span>`);
    }
    if (data.tension && st.showTension !== false) {
        tickerItems.push(`<span class="dooms-ip-ticker-item">
            <i class="fa-solid fa-fire"></i> ${escapeHtml(data.tension)}
        </span>`);
    }
    if (data.timeSinceRest && st.showTimeSinceRest !== false) {
        tickerItems.push(`<span class="dooms-ip-ticker-item">
            <i class="fa-solid fa-hourglass-half"></i> ${escapeHtml(data.timeSinceRest)}
        </span>`);
    }
    if (data.conditions && st.showConditions !== false) {
        tickerItems.push(`<span class="dooms-ip-ticker-item">
            <i class="fa-solid fa-heart-crack"></i> ${escapeHtml(trunc(data.conditions))}
        </span>`);
    }
    if (data.terrain && st.showTerrain !== false) {
        tickerItems.push(`<span class="dooms-ip-ticker-item">
            <i class="fa-solid fa-tree"></i> ${escapeHtml(trunc(data.terrain))}
        </span>`);
    }
    if (data.activeQuest && st.showQuest !== false) {
        tickerItems.push(`<span class="dooms-ip-ticker-item dooms-ip-ticker-quest">
            <i class="fa-solid fa-scroll"></i> ${escapeHtml(trunc(data.activeQuest))}
        </span>`);
    }
    if (data.recentEvents && st.showRecentEvents !== false) {
        // Show only the first event in the rotating ticker (truncated); full list in expanded panel
        const firstEvent = data.recentEvents.split(';')[0].trim();
        tickerItems.push(`<span class="dooms-ip-ticker-item">
            <i class="fa-solid fa-newspaper"></i> ${escapeHtml(trunc(firstEvent))}
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

    // Expanded panel — two columns for compact fields, full-width for wide fields.
    // Collect compact rows first, then split evenly into left/right columns so both
    // are always filled regardless of which optional fields are enabled.
    const compactRows = [];
    if (data.time && st.showTime !== false) {
        compactRows.push(`<div class="dooms-ip-panel-row">
            <i class="fa-solid fa-clock"></i>
            <span class="dooms-ip-panel-label">Time</span>
            <span class="dooms-ip-panel-value">${escapeHtml(data.time)}</span>
        </div>`);
    }
    if (data.date && st.showDate !== false) {
        compactRows.push(`<div class="dooms-ip-panel-row">
            <i class="fa-solid fa-calendar"></i>
            <span class="dooms-ip-panel-label">Date</span>
            <span class="dooms-ip-panel-value">${escapeHtml(data.date)}</span>
        </div>`);
    }
    if (data.location && st.showLocation !== false) {
        compactRows.push(`<div class="dooms-ip-panel-row">
            <i class="fa-solid fa-location-dot"></i>
            <span class="dooms-ip-panel-label">Location</span>
            <span class="dooms-ip-panel-value">${escapeHtml(data.location)}</span>
        </div>`);
    }
    if (data.moonPhase && st.showMoonPhase !== false) {
        compactRows.push(`<div class="dooms-ip-panel-row">
            <i class="fa-solid fa-moon"></i>
            <span class="dooms-ip-panel-label">Moon Phase</span>
            <span class="dooms-ip-panel-value">${escapeHtml(data.moonPhase)}</span>
        </div>`);
    }
    if (data.tension && st.showTension !== false) {
        compactRows.push(`<div class="dooms-ip-panel-row">
            <i class="fa-solid fa-fire"></i>
            <span class="dooms-ip-panel-label">Tension</span>
            <span class="dooms-ip-panel-value">${escapeHtml(data.tension)}</span>
        </div>`);
    }
    if (data.timeSinceRest && st.showTimeSinceRest !== false) {
        compactRows.push(`<div class="dooms-ip-panel-row">
            <i class="fa-solid fa-hourglass-half"></i>
            <span class="dooms-ip-panel-label">Rest</span>
            <span class="dooms-ip-panel-value">${escapeHtml(data.timeSinceRest)}</span>
        </div>`);
    }
    if (data.terrain && st.showTerrain !== false) {
        compactRows.push(`<div class="dooms-ip-panel-row">
            <i class="fa-solid fa-tree"></i>
            <span class="dooms-ip-panel-label">Terrain</span>
            <span class="dooms-ip-panel-value">${escapeHtml(data.terrain)}</span>
        </div>`);
    }
    if (data.conditions && st.showConditions !== false) {
        compactRows.push(`<div class="dooms-ip-panel-row">
            <i class="fa-solid fa-heart-crack"></i>
            <span class="dooms-ip-panel-label">Conditions</span>
            <span class="dooms-ip-panel-value">${escapeHtml(data.conditions)}</span>
        </div>`);
    }

    // Present and Quest also fit as compact two-column rows
    if (data.presentCharacters.length > 0 && st.showCharacters !== false) {
        const charNames = data.presentCharacters.map(c => {
            const color = getCharacterColor(c.name);
            const dotStyle = color ? ` style="background:${escapeHtml(color)}"` : '';
            return `<span class="dooms-ip-panel-char"><span class="dooms-ip-panel-char-dot"${dotStyle}></span>${escapeHtml(c.name)}</span>`;
        }).join(' ');
        compactRows.push(`<div class="dooms-ip-panel-row">
            <i class="fa-solid fa-users"></i>
            <span class="dooms-ip-panel-label">Present</span>
            <span class="dooms-ip-panel-value">${charNames}</span>
        </div>`);
    }
    if (data.activeQuest && st.showQuest !== false) {
        compactRows.push(`<div class="dooms-ip-panel-row dooms-ip-panel-quest">
            <i class="fa-solid fa-scroll"></i>
            <span class="dooms-ip-panel-label">Quest</span>
            <span class="dooms-ip-panel-value">${escapeHtml(data.activeQuest)}</span>
        </div>`);
    }

    // Recent Events goes into the compact grid as the last item (right column).
    // Keeping it compact means it sits on the right side as requested.
    // We show only the first event truncated; full bullets visible on hover/scroll.
    if (data.recentEvents && st.showRecentEvents !== false) {
        const firstEvent = data.recentEvents.split(';')[0].trim();
        const allEvents = data.recentEvents.split(';').map(e => e.trim()).filter(e => e).map(e =>
            `<div class="dooms-ip-panel-event"><span class="dooms-ip-panel-event-bullet">&bull;</span> ${escapeHtml(e)}</div>`
        ).join('');
        compactRows.push(`<div class="dooms-ip-panel-row dooms-ip-panel-events-row">
            <i class="fa-solid fa-newspaper"></i>
            <span class="dooms-ip-panel-label">Recent</span>
            <div class="dooms-ip-panel-events dooms-ip-panel-events-compact">${allEvents}</div>
        </div>`);
    }

    // If odd number of compact rows, add an invisible pad so the grid stays balanced
    if (compactRows.length % 2 !== 0) {
        compactRows.push(`<div class="dooms-ip-panel-row dooms-ip-panel-empty"></div>`);
    }

    // Build the final panel HTML.
    // All rows go into a single CSS grid (2 cols) — auto-placed left→right,
    // so col1 and col2 share the same grid row height automatically.
    const panelRows = [];
    if (compactRows.length > 0) {
        panelRows.push(`<div class="dooms-ip-panel-cols">${compactRows.join('')}</div>`);
    }

    if (!tickerItems.length && !charDots && !panelRows.length) return '';

    // Rotating broadcast display: items cycle one at a time, each visible for HOLD_SECS.
    // We generate a concrete @keyframes block in JS so percentage stops are plain numbers
    // (CSS custom properties inside keyframe selectors are not supported by browsers).
    const HOLD_SECS = 5;
    const n = tickerItems.length;
    let rotatingItems;
    let tickerStyleBlock = '';

    if (n === 1) {
        // Single item — show statically (centering comes from the CSS class)
        rotatingItems = tickerItems[0].replace(
            /^(\s*<span\b)/,
            '$1 style="opacity:1"'
        );
    } else {
        const totalSecs = n * HOLD_SECS;
        // Percentage of the full cycle that one slot occupies = 100/n
        // Keyframe stops (as % of full cycle):
        //   0%        → invisible
        //   fadeIn%   → 8% into this slot → fully visible
        //   holdEnd%  → 85% into this slot → start fade
        //   slotEnd%  → end of slot → invisible
        //   100%      → still invisible (loop)
        const slotPct   = 100 / n;
        const pFadeIn   = (slotPct * 0.08).toFixed(3);
        const pHoldEnd  = (slotPct * 0.85).toFixed(3);
        const pSlotEnd  = (slotPct * 1.00).toFixed(3);

        // Build a concrete @keyframes rule (no CSS vars in stops = universally supported)
        const keyframeName = 'dooms-ticker-rotate-n' + n;
        tickerStyleBlock = `<style id="dooms-ticker-rotate-style">
@keyframes ${keyframeName} {
    0%           { opacity: 0; transform: translateY(3px);  }
    ${pFadeIn}%  { opacity: 1; transform: translateY(0);    }
    ${pHoldEnd}% { opacity: 1; transform: translateY(0);    }
    ${pSlotEnd}% { opacity: 0; transform: translateY(-3px); }
    100%         { opacity: 0; transform: translateY(-3px); }
}
</style>`;

        rotatingItems = tickerItems.map((item, i) => {
            const style = [
                `animation-name:${keyframeName}`,
                `animation-delay:${i * HOLD_SECS}s`,
                `animation-duration:${totalSecs}s`
            ].join('; ');
            return item.replace(/^(\s*<span\b)/, `$1 style="${style}"`);
        }).join('');
    }

    const doomBadge = buildDoomCounterBadge(data.doomTension);

    return `${tickerStyleBlock}<div class="dooms-info-ticker-wrapper" style="${styleVars}">
        <div class="dooms-info-ticker">
            <span class="dooms-ip-ticker-icon"><i class="fa-solid fa-compass"></i></span>
            ${doomBadge}
            <div class="dooms-ip-ticker-items">
                ${rotatingItems}
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
//  Doom Counter Debug Badge
// ─────────────────────────────────────────────

/**
 * Builds a compact Doom Counter debug badge for the scene header.
 * Shows: skull icon, tension value, streak, countdown (when active).
 * Only renders when doomCounter.enabled AND doomCounter.debugDisplay are true.
 *
 * @param {number|null} doomTension - The current doomTension value from sceneData
 * @returns {string} HTML string (empty if debug display is off)
 */
function buildDoomCounterBadge(doomTension) {
    const dc = extensionSettings.doomCounter;
    if (!dc?.enabled || !dc?.debugDisplay) return '';

    const state = getDoomCounterState();
    const ceiling = dc.lowTensionCeiling || 4;
    const threshold = dc.lowTensionThreshold || 5;
    const tensionStr = doomTension !== null ? `${doomTension}` : '?';
    const isLow = doomTension !== null && doomTension <= ceiling;

    // Color the tension number: red if low, green if high
    const tensionColor = doomTension === null ? '#888' : (isLow ? '#e94560' : '#4ade80');

    let badgeContent = '';

    // Tension value
    badgeContent += `<span class="dooms-dc-debug-tension" style="color:${tensionColor}">${tensionStr}</span>`;

    // Streak counter (show as fraction: 3/5)
    badgeContent += `<span class="dooms-dc-debug-streak">${state.lowStreakCount}/${threshold}</span>`;

    // Countdown (only if active)
    if (state.countdownActive) {
        badgeContent += `<span class="dooms-dc-debug-countdown">${state.countdownCount}</span>`;
    }

    // Pending twist indicator
    if (state.pendingTwist) {
        badgeContent += `<span class="dooms-dc-debug-pending" title="Twist pending injection">⚡</span>`;
    }

    return `<div class="dooms-dc-debug-badge" title="Doom Counter: Tension ${tensionStr}/10 | Streak ${state.lowStreakCount}/${threshold}${state.countdownActive ? ' | Countdown ' + state.countdownCount : ''}">
        <i class="fa-solid fa-skull"></i>
        ${badgeContent}
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
