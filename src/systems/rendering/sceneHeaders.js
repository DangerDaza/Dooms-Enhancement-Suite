/**
 * Scene Headers Rendering Module
 * Injects compact scene info blocks after assistant messages in the chat.
 * These blocks sit OUTSIDE .mes_text so TTS won't read them.
 */
import { extensionSettings, lastGeneratedData, committedTrackerData } from '../../core/state.js';

/** Cache of last rendered scene data JSON to skip redundant DOM rebuilds */
let _lastSceneDataJSON = null;

/**
 * Helper: converts a hex color (#rrggbb) to an "r, g, b" string for use in rgba().
 * @param {string} hex
 * @returns {string}
 */
function hexToRgb(hex) {
    const h = hex.replace('#', '');
    const r = parseInt(h.substring(0, 2), 16);
    const g = parseInt(h.substring(2, 4), 16);
    const b = parseInt(h.substring(4, 6), 16);
    return `${r}, ${g}, ${b}`;
}

/**
 * Builds the inline CSS custom-property style string from the scene tracker settings.
 * @returns {string} e.g. "--st-accent-rgb: 233, 69, 96; --st-bg-opacity: 0.08; ..."
 */
function buildStyleVars() {
    const st = extensionSettings.sceneTracker || {};
    const vars = [];

    // Color RGB decompositions (for rgba usage)
    vars.push(`--st-bg-rgb: ${hexToRgb(st.bgColor || '#e94560')}`);
    vars.push(`--st-border-rgb: ${hexToRgb(st.borderColor || '#e94560')}`);
    vars.push(`--st-accent-rgb: ${hexToRgb(st.accentColor || '#e94560')}`);
    vars.push(`--st-badge-rgb: ${hexToRgb(st.charBadgeBg || '#e94560')}`);

    // Opacity values (0–1 range)
    vars.push(`--st-bg-opacity: ${(st.bgOpacity ?? 8) / 100}`);
    vars.push(`--st-border-opacity: ${(st.borderOpacity ?? 15) / 100}`);
    vars.push(`--st-badge-opacity: ${(st.charBadgeOpacity ?? 12) / 100}`);

    // Direct color values
    vars.push(`--st-accent: ${st.accentColor || '#e94560'}`);
    vars.push(`--st-border-color: ${st.borderColor || '#e94560'}`);
    vars.push(`--st-label-color: ${st.labelColor || '#888888'}`);
    vars.push(`--st-text-color: ${st.textColor || '#d0d0d0'}`);
    vars.push(`--st-quest-icon: ${st.questIconColor || '#f0c040'}`);
    vars.push(`--st-events-text: ${st.eventsTextColor || '#999999'}`);

    // Sizing
    vars.push(`--st-font-size: ${st.fontSize ?? 82}`);
    vars.push(`--st-border-radius: ${st.borderRadius ?? 8}px`);
    vars.push(`--st-padding: ${st.padding ?? 10}px`);
    vars.push(`--st-border-width: ${st.borderWidth ?? 3}px`);

    return vars.join('; ');
}

/**
 * Applies scene tracker CSS custom properties to all existing .dooms-scene-header elements.
 * Called from index.js when settings change (for live preview without full re-render).
 */
export function applySceneTrackerSettings() {
    const style = buildStyleVars();
    const st = extensionSettings.sceneTracker || {};
    const layout = st.layout || 'grid';

    $('.dooms-scene-header').each(function () {
        this.setAttribute('style', style);
        // Update layout class
        this.classList.remove('dooms-scene-layout-grid', 'dooms-scene-layout-stacked', 'dooms-scene-layout-compact');
        this.classList.add(`dooms-scene-layout-${layout}`);
    });
}

/**
 * Reset the scene header cache (call on chat change so first render always runs).
 */
export function resetSceneHeaderCache() {
    _lastSceneDataJSON = null;
}

/**
 * Main entry point. Removes old scene headers, finds the last assistant message,
 * extracts scene data, and injects a scene header block after it.
 */
export function updateChatSceneHeaders() {
    if (!extensionSettings.enabled) {
        $('.dooms-scene-header').remove();
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
        $('.dooms-scene-header').remove();
        _lastSceneDataJSON = null;
        return;
    }
    // Skip rebuild if data + settings are identical to last render
    const st = extensionSettings.sceneTracker || {};
    const cacheKey = JSON.stringify({ sceneData, st });
    if (cacheKey === _lastSceneDataJSON && $('.dooms-scene-header').length) {
        return;
    }
    _lastSceneDataJSON = cacheKey;
    // Remove existing scene headers before inserting new one
    $('.dooms-scene-header').remove();
    // Find the most recent non-user message
    const $messages = $('#chat .mes');
    let $targetMessage = null;
    for (let i = $messages.length - 1; i >= 0; i--) {
        const $message = $messages.eq(i);
        if ($message.attr('is_user') !== 'true') {
            $targetMessage = $message;
            break;
        }
    }
    if (!$targetMessage) {
        return;
    }
    // Build and inject the scene header
    const headerHTML = createSceneHeaderHTML(sceneData);
    $targetMessage.after(headerHTML);
}

/**
 * Extracts scene data from the three data sources into a flat object.
 * @param {string|object|null} infoBoxData - Info box data (JSON string or object)
 * @param {string|object|null} characterThoughtsData - Character thoughts data
 * @param {object|null} questsData - Quests data from extensionSettings
 * @returns {{ time: string, date: string, location: string, presentCharacters: Array<{name: string, emoji: string}>, activeQuest: string, recentEvents: string }}
 */
function extractSceneData(infoBoxData, characterThoughtsData, questsData) {
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
    if (characterThoughtsData) {
        try {
            const parsed = typeof characterThoughtsData === 'string'
                ? JSON.parse(characterThoughtsData)
                : characterThoughtsData;
            const characters = Array.isArray(parsed) ? parsed : (parsed.characters || []);
            result.presentCharacters = characters.map(char => ({
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

/**
 * Builds the scene header HTML string.
 * Reads sceneTracker settings for field visibility, layout class, and inline CSS vars.
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
