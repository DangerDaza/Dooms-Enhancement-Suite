/**
 * Character Sheet — full-screen popup with hero art + collapsible fullsheet sections.
 *
 * Data is stored per-chat in chat_metadata.dooms_tracker.characterSheets.
 * Users import sheets by clicking an import button on messages containing
 * numbered section headers (e.g. "## SECTION 1/8: Core Identity").
 * Works standalone — no external extensions required.
 */
import { extensionSettings } from '../../core/state.js';
import { saveChatData, saveSettings } from '../../core/persistence.js';
import { resolvePortrait, resolveFullPortrait } from './portraitBar.js';
import { chat_metadata, chat } from '../../../../../../../script.js';
import { callGenericPopup, POPUP_TYPE } from '../../../../../../popup.js';
import { escapeHtml, escapeAttr } from '../../utils/html.js';
// Eager half (fullsheet detection, import buttons, stats cache) lives in
// fullsheetButtons.js so chat handlers don't need this whole module.
import { statsCache, messageHasFullSheet, collectSectionHeaders, pickDominantSectionGroup } from './fullsheetButtons.js';
export { clearStatsCache, messageHasFullSheet, injectFullSheetButtons, injectFullSheetButtonForMessage } from './fullsheetButtons.js';

// ─────────────────────────────────────────────
//  Parser
// ─────────────────────────────────────────────
// The section header regex lives in fullsheetButtons.js (SECTION_HEADER_SOURCE)
// and is shared with messageHasFullSheet — the detector and the parser must
// accept the same shapes, or the button shows and the import then fails.

// Bunny Mo's terminal machine-tag block; stripped from section prose and kept
// on the sheet as rawTags.
const BUNNYMO_TAGS_BLOCK_RE = /<BunnymoTags>([\s\S]*?)<\/BunnymoTags>/i;

/**
 * Fallback for sheets without a coherent numbered-section group (e.g. a
 * drifted quicksheet): split on standalone bold or hash-heading lines.
 * Returns the same header shape collectSectionHeaders produces, or [].
 */
function collectUnnumberedHeaders(text) {
    // Two shapes: a line LEADING with a short bold token ("**Physical:** silver
    // hair..." — the header ends after the bold, the rest of the line is
    // content), or a plain hash heading on its own line.
    const re = /^\s*(?:#{1,3}\s*)?(?:\S{1,8}\s+)?\*\*([^*\n]{2,40})\*\*:?[ \t]*|^\s*#{1,3}\s+([^\n]{2,60})$/gm;
    const headers = [];
    let match;
    let n = 1;
    while ((match = re.exec(text)) !== null) {
        // Zero-width safety: a bold match can be empty-adjacent on odd input.
        if (!match[0].trim()) { re.lastIndex++; continue; }
        headers.push({
            n: n++,
            m: 0,
            title: (match[1] || match[2] || '').replace(/:$/, '').trim(),
            startIndex: match.index,
            headerEndIndex: match.index + match[0].length,
        });
    }
    return headers;
}

/**
 * Parses a fullsheet/quicksheet output from a message string.
 * Supports any language — section headers just need the N/M numbering
 * pattern; unnumbered quicksheet-style sheets fall back to bold/hash
 * heading splits.
 * Returns { characterTitle, sections: [{ number, emoji, title, content }] } or null.
 */
export function parseFullSheet(text) {
    if (!text) return null;

    // Pull the machine-tag block out first — it's data, not prose.
    let rawTags = '';
    let body = text.replace(BUNNYMO_TAGS_BLOCK_RE, (whole, inner) => {
        rawTags = inner.trim();
        return '';
    });

    // Prefer the coherent numbered-section group (same logic the detector
    // uses); fall back to unnumbered heading splits for drifted quicksheets.
    let matches = pickDominantSectionGroup(collectSectionHeaders(body));
    if (matches.length < 2) {
        matches = collectUnnumberedHeaders(body);
    }
    if (matches.length < 2) return null; // Need at least 2 sections to be a valid sheet

    const sections = matches.map((m, idx) => {
        // Content runs from end of this header to start of next section (or end of text)
        const contentStart = m.headerEndIndex;
        const contentEnd = idx < matches.length - 1 ? matches[idx + 1].startIndex : body.length;
        let content = body.substring(contentStart, contentEnd).trim();

        // Remove trailing --- dividers and dangling details/summary wrappers
        // left behind when the header sat inside a <summary> line.
        content = content
            .replace(/^<\/summary>\s*/i, '')
            .replace(/\n---\s*$/, '')
            .replace(/<\/details>\s*$/i, '')
            .trim();

        // <summary>-wrapped headers put the whole "title</summary>body" run on
        // the header line — split it so the body lands in content, not title.
        let rawTitle = m.title || '';
        const summarySplit = rawTitle.split(/<\/summary>/i);
        if (summarySplit.length > 1) {
            const inlineBody = summarySplit.slice(1).join(' ').replace(/<\/?details[^>]*>/gi, '').trim();
            if (inlineBody) content = (inlineBody + (content ? '\n' + content : '')).trim();
            rawTitle = summarySplit[0];
        }

        // Extract emoji and title from header like "🆔 **Core Identity & Context**"
        // If the header is empty, the section keyword itself (e.g. "SECTION") was consumed —
        // fall back to the full content's first line as a title hint.
        const headerClean = rawTitle.replace(/<\/?(?:summary|details)[^>]*>/gi, '').replace(/\*\*/g, '').trim();
        // First character(s) might be emoji
        const emojiMatch = headerClean.match(/^(\p{Emoji_Presentation}|\p{Emoji}\uFE0F?)\s*/u);
        const emoji = emojiMatch ? emojiMatch[1] : '';
        const title = emojiMatch ? headerClean.substring(emojiMatch[0].length).trim() : headerClean;

        return {
            number: m.n,
            emoji,
            title,
            content,
        };
    });

    // Try to extract character title from the text before first section
    const preSection = body.substring(0, matches[0].startIndex);
    const titleMatch = preSection.match(/Character Title:\s*(?:The\s+)?(.+?)(?:\n|$)/i);
    const characterTitle = titleMatch ? titleMatch[1].replace(/\*\*/g, '').trim() : '';

    // Try to extract character name from Section 1 content
    const nameMatch = sections[0]?.content.match(/\*\*Name:\*\*\s*(.+?)(?:\n|$)/i);
    const characterName = nameMatch ? nameMatch[1].replace(/[\[\]]/g, '').trim() : '';

    return {
        characterTitle,
        characterName,
        sections,
        ...(rawTags ? { rawTags } : {}),
        importedAt: new Date().toISOString(),
    };
}

// ─────────────────────────────────────────────
//  Storage (per-chat)
// ─────────────────────────────────────────────

function ensureSheetStorage() {
    if (!chat_metadata?.dooms_tracker) return false;
    if (!chat_metadata.dooms_tracker.characterSheets) {
        chat_metadata.dooms_tracker.characterSheets = {};
    }
    return true;
}

/** Case-insensitive key lookup — returns the stored key or null. */
function getCharacterSheetKey(name) {
    if (!ensureSheetStorage() || !name) return null;
    const lower = name.toLowerCase();
    for (const key of Object.keys(chat_metadata.dooms_tracker.characterSheets)) {
        if (key.toLowerCase() === lower) return key;
    }
    return null;
}

export function getCharacterSheet(name) {
    const key = getCharacterSheetKey(name);
    return key !== null ? chat_metadata.dooms_tracker.characterSheets[key] : null;
}

export function saveCharacterSheet(name, data, { immediate = false } = {}) {
    if (!ensureSheetStorage()) return;
    // Reuse an existing key that differs only in case — writing under the
    // typed casing would leave two entries for the same character.
    const key = getCharacterSheetKey(name) ?? name;
    chat_metadata.dooms_tracker.characterSheets[key] = data;
    saveChatData({ immediate });
}

/**
 * The sheet entry for a character, created (in notes-ready shape) if absent.
 * Returns null only when there's no chat open yet (no chat_metadata).
 */
function ensureSheetEntry(characterName) {
    if (!ensureSheetStorage() || !characterName) return null;
    let entry = getCharacterSheet(characterName);
    if (!entry) {
        entry = { mode: 'sheet', notesSections: [] };
        chat_metadata.dooms_tracker.characterSheets[characterName] = entry;
    }
    if (!Array.isArray(entry.notesSections)) entry.notesSections = [];
    return entry;
}

// ─────────────────────────────────────────────
//  Hero art positioning (right-click + drag to reposition)
// ─────────────────────────────────────────────

function getHeroPosition(characterName) {
    if (!extensionSettings.heroPositions) extensionSettings.heroPositions = {};
    return extensionSettings.heroPositions[characterName] || { x: 50, y: 20 };
}

function saveHeroPosition(characterName, x, y) {
    if (!extensionSettings.heroPositions) extensionSettings.heroPositions = {};
    extensionSettings.heroPositions[characterName] = {
        x: Math.max(0, Math.min(100, x)),
        y: Math.max(0, Math.min(100, y))
    };
    saveSettings();
}

let _repositionActive = false;
let _repositionCharName = null;

function showHeroContextMenu(e, characterName) {
    e.preventDefault();
    // Remove any existing menu
    $('.rpg-cs-hero-ctx').remove();

    const $menu = $(`
        <div class="rpg-cs-hero-ctx">
            <div class="rpg-cs-hero-ctx-item" data-action="reposition">
                <i class="fa-solid fa-arrows-up-down-left-right"></i> Reposition Image
            </div>
        </div>
    `);

    // Position near cursor
    const $hero = $(e.currentTarget).closest('.rpg-cs-hero');
    const heroRect = $hero[0].getBoundingClientRect();
    $menu.css({
        position: 'absolute',
        top: (e.clientY - heroRect.top) + 'px',
        left: (e.clientX - heroRect.left) + 'px',
        zIndex: 1000
    });

    $hero.append($menu);

    $menu.on('click', '[data-action="reposition"]', function () {
        $menu.remove();
        enterRepositionMode(characterName);
    });

    // Close on click outside
    setTimeout(() => {
        $(document).one('click.heroCtx', () => $menu.remove());
    }, 10);
}

function enterRepositionMode(characterName) {
    _repositionActive = true;
    _repositionCharName = characterName;

    const $art = $('.rpg-cs-hero-art');
    const $hero = $art.closest('.rpg-cs-hero');
    const pos = getHeroPosition(characterName);
    let currentX = pos.x;
    let currentY = pos.y;
    let startMouseX = 0, startMouseY = 0;
    let startPosX = 0, startPosY = 0;
    let isDragging = false;

    $art.addClass('rpg-cs-hero-repositioning');

    // Add confirm/cancel bar
    $hero.append(`
        <div class="rpg-cs-hero-reposition-bar">
            <span class="rpg-cs-reposition-hint">Drag to reposition</span>
            <button class="rpg-cs-reposition-confirm" title="Confirm position"><i class="fa-solid fa-check"></i></button>
            <button class="rpg-cs-reposition-cancel" title="Cancel"><i class="fa-solid fa-xmark"></i></button>
        </div>
    `);

    // Stop mousedown on the confirm/cancel bar from triggering drag
    $hero.on('mousedown.reposition', '.rpg-cs-hero-reposition-bar, .rpg-cs-hero-reposition-bar *', function (e) {
        e.stopPropagation();
    });

    // Drag to reposition (only on the image itself)
    $art.on('mousedown.reposition', function (e) {
        if (e.button !== 0) return; // Left click only
        e.preventDefault();
        isDragging = true;
        startMouseX = e.clientX;
        startMouseY = e.clientY;
        startPosX = currentX;
        startPosY = currentY;
    });

    $(document).on('mousemove.reposition', function (e) {
        if (!isDragging) return;
        e.preventDefault();
        const artWidth = $art.width() || 320;
        const artHeight = $art.height() || 600;
        const dx = ((e.clientX - startMouseX) / artWidth) * -100;
        const dy = ((e.clientY - startMouseY) / artHeight) * -100;
        currentX = Math.max(0, Math.min(100, startPosX + dx));
        currentY = Math.max(0, Math.min(100, startPosY + dy));
        $art.css('object-position', `${currentX}% ${currentY}%`);
    });

    $(document).on('mouseup.reposition', function () {
        isDragging = false;
    });

    // Confirm and Cancel — bind directly to the buttons after they exist in DOM
    setTimeout(() => {
        $hero.find('.rpg-cs-reposition-confirm').on('click', function (e) {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            saveHeroPosition(characterName, currentX, currentY);
            exitRepositionMode();
            toastr.success('Image position saved.', '', { timeOut: 1500 });
        });

        $hero.find('.rpg-cs-reposition-cancel').on('click', function (e) {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            $art.css('object-position', `${pos.x}% ${pos.y}%`);
            exitRepositionMode();
        });
    }, 0);
}

function exitRepositionMode() {
    _repositionActive = false;
    _repositionCharName = null;
    const $art = $('.rpg-cs-hero-art');
    $art.removeClass('rpg-cs-hero-repositioning');
    $art.off('.reposition');
    $(document).off('.reposition');
    $('.rpg-cs-hero').off('.reposition');
    $('.rpg-cs-hero-reposition-bar').remove();
}

function cleanupHeroArtDrag() {
    if (_repositionActive) exitRepositionMode();
    $('.rpg-cs-hero-ctx').remove();
}

// ─────────────────────────────────────────────
//  Stats computation
// ─────────────────────────────────────────────

function namesMatchLoose(a, b) {
    const la = (a || '').trim().toLowerCase();
    const lb = (b || '').trim().toLowerCase();
    if (!la || !lb) return false;
    return la === lb || la.startsWith(lb + ' ') || lb.startsWith(la + ' ');
}

/**
 * Mines chat data to compute stats for a character.
 * Uses two passes:
 *   1. Basic pass over ALL messages — speaking frequency, name mentions, first/last seen
 *      (works even for messages created before the tracker was installed)
 *   2. Rich pass using tracker data — relationships, locations, thoughts, presence tracking
 * Returns a stats object or null if no data found.
 */
export function computeCharacterStats(characterName) {
    if (!characterName || !chat || !Array.isArray(chat)) return null;

    const cached = statsCache.get(characterName.toLowerCase());
    if (cached) return cached;

    const target = characterName.toLowerCase();

    // ── Pass 1: Basic stats from raw chat (ALL messages) ──
    let totalAssistantMessages = 0;
    let speakingCount = 0;
    let mentionCount = 0;
    let firstSpoken = null;
    let lastSpoken = null;

    for (let i = 0; i < chat.length; i++) {
        const message = chat[i];
        if (!message || message.is_user || message.is_system) continue;
        totalAssistantMessages++;

        const mesText = message.mes || '';
        const mesLower = mesText.toLowerCase();

        // Speaking detection: check multiple signals
        let isSpeaking = false;

        // Signal 1: message.name matches (works for solo character chats)
        if (message.name && namesMatchLoose(message.name, target)) {
            isSpeaking = true;
        }

        // Signal 2: Character has dialogue in this message (font color tags with their name nearby)
        // Pattern: character name appears near/before a <font color> dialogue block
        if (!isSpeaking && mesLower.includes(target)) {
            // Check for "CharName:" or "**CharName**" speaker patterns followed by dialogue
            const namePatterns = [
                new RegExp(`\\b${target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b\\s*[:：]\\s*[""\u201c]`, 'i'),  // Name: "dialogue"
                new RegExp(`\\*\\*${target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\*\\*`, 'i'),  // **Name**
                new RegExp(`<font[^>]*>[^<]*</font>[^]*?\\b${target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i'),  // font tag near name
            ];
            // Also check if name appears right before a font-colored dialogue section
            const fontTagRegex = /<font\s+color=["'][^"']+["'][^>]*>/gi;
            const fontMatches = [...mesText.matchAll(fontTagRegex)];
            if (fontMatches.length > 0) {
                // Check if character name appears in the ~200 chars before any font tag
                for (const fm of fontMatches) {
                    const precedingText = mesText.substring(Math.max(0, fm.index - 200), fm.index).toLowerCase();
                    if (precedingText.includes(target)) {
                        isSpeaking = true;
                        break;
                    }
                }
            }
            // Fall back to name: "dialogue" patterns
            if (!isSpeaking) {
                for (const pat of namePatterns) {
                    if (pat.test(mesText)) {
                        isSpeaking = true;
                        break;
                    }
                }
            }
        }

        if (isSpeaking) {
            speakingCount++;
            if (firstSpoken === null) firstSpoken = i;
            lastSpoken = i;
        }

        // Mentioned in message text (lightweight check)
        if (mesLower.includes(target)) {
            mentionCount++;
        }
    }

    // ── Pass 2: Rich stats from tracker data (messages with dooms_tracker_swipes) ──
    let trackerPresentCount = 0;
    let trackerTotalMessages = 0;
    let firstSeen = null;
    let lastSeen = null;
    let longestAbsence = 0;
    let currentAbsence = 0;
    const relationshipChanges = [];
    let lastRelationship = null;
    const locationCounts = {};
    const recentThoughts = [];

    for (let i = 0; i < chat.length; i++) {
        const message = chat[i];
        if (!message || message.is_user || message.is_system) continue;

        // Get per-swipe tracker data
        const swipeId = message.swipe_id || 0;
        let swipeData = message.extra?.dooms_tracker_swipes?.[swipeId];
        if (!swipeData && message.swipe_info?.[swipeId]?.extra?.dooms_tracker_swipes) {
            swipeData = message.swipe_info[swipeId].extra.dooms_tracker_swipes[swipeId];
        }
        if (!swipeData) continue;

        trackerTotalMessages++;

        // Parse characterThoughts
        let charData = swipeData.characterThoughts;
        if (typeof charData === 'string') {
            try { charData = JSON.parse(charData); } catch { charData = null; }
        }
        const characters = Array.isArray(charData) ? charData : (charData?.characters || []);

        // Find this character in the array
        const charEntry = characters.find(c => namesMatchLoose(c.name, target));

        if (charEntry && charEntry.present !== false) {
            trackerPresentCount++;
            if (firstSeen === null) firstSeen = i;
            lastSeen = i;
            if (currentAbsence > longestAbsence) longestAbsence = currentAbsence;
            currentAbsence = 0;

            // Relationship tracking
            const rel = charEntry.Relationship || charEntry.relationship?.status || charEntry.relationship;
            if (rel && typeof rel === 'string' && rel !== lastRelationship) {
                relationshipChanges.push({ messageIndex: i, status: rel });
                lastRelationship = rel;
            }

            // Thoughts
            const thought = charEntry.thoughts?.content || (typeof charEntry.thoughts === 'string' ? charEntry.thoughts : null);
            if (thought) {
                recentThoughts.push({ messageIndex: i, content: thought });
            }
        } else {
            currentAbsence++;
        }

        // Location from infoBox
        let infoBox = swipeData.infoBox;
        if (typeof infoBox === 'string') {
            try { infoBox = JSON.parse(infoBox); } catch { infoBox = null; }
        }
        if (infoBox && charEntry && charEntry.present !== false) {
            const loc = typeof infoBox.location === 'string' ? infoBox.location.trim()
                : (infoBox.location?.value || '');
            if (loc) {
                locationCounts[loc] = (locationCounts[loc] || 0) + 1;
            }
        }
    }

    // Finalize longest absence
    if (currentAbsence > longestAbsence) longestAbsence = currentAbsence;

    // Need at least some data to show stats
    if (totalAssistantMessages === 0 && trackerTotalMessages === 0) {
        statsCache.set(target, null);
        return null;
    }

    // Use the best available presence data:
    // - If tracker data exists, use it for presence (more accurate)
    // - Fall back to speaking + mention counts for basic presence estimate
    const hasTrackerData = trackerTotalMessages > 0;
    const presentCount = hasTrackerData ? trackerPresentCount : speakingCount;
    const presentBase = hasTrackerData ? trackerTotalMessages : totalAssistantMessages;

    // Sort locations by frequency
    const topLocations = Object.entries(locationCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map(([name, count]) => ({ name, count }));

    // Keep last 5 thoughts
    const lastThoughts = recentThoughts.slice(-5).reverse();

    const stats = {
        totalMessages: totalAssistantMessages,
        trackerMessages: trackerTotalMessages,
        hasTrackerData,
        presentCount,
        presentPercent: presentBase > 0 ? Math.round((presentCount / presentBase) * 100) : 0,
        speakingCount,
        speakingPercent: totalAssistantMessages > 0 ? Math.round((speakingCount / totalAssistantMessages) * 100) : 0,
        mentionCount,
        mentionPercent: totalAssistantMessages > 0 ? Math.round((mentionCount / totalAssistantMessages) * 100) : 0,
        silentCount: presentCount > speakingCount ? presentCount - speakingCount : 0,
        silentPercent: presentCount > 0 ? Math.round((Math.max(0, presentCount - speakingCount) / presentCount) * 100) : 0,
        firstSeen: firstSeen !== null ? firstSeen : firstSpoken,
        lastSeen: lastSeen !== null ? lastSeen : lastSpoken,
        longestAbsence,
        relationshipChanges,
        topLocations,
        maxLocationCount: topLocations.length > 0 ? topLocations[0].count : 0,
        lastThoughts,
    };

    statsCache.set(target, stats);
    return stats;
}

/**
 * Renders the stats page HTML for a character.
 */
function renderStatsPage(characterName, stats) {
    if (!stats) {
        return `
            <div class="rpg-cs-empty">
                <i class="fa-solid fa-chart-bar" style="font-size: 2em; opacity: 0.3; margin-bottom: 12px;"></i>
                <p>No stats available.</p>
                <p style="font-size: 0.85em; opacity: 0.6;">Stats are computed from per-message tracker data. Send more messages with the tracker enabled to build data.</p>
            </div>
        `;
    }

    let html = '';

    // Accuracy warning icon
    html += `<div class="rpg-cs-stats-header">
        <div class="rpg-cs-stats-info-btn" title="Click for info about stat accuracy">
            <i class="fa-solid fa-exclamation-circle"></i>
        </div>
        <div class="rpg-cs-stats-info-popup" style="display: none;">
            <p>If you have changed a character's dialogue color or renamed them at any point, the speaking and mention counts may not be fully accurate.</p>
            <p>Stats based on tracker data (scene presence, relationships, thoughts) are not affected by color changes.</p>
        </div>
    </div>`;

    // Data coverage note
    if (stats.hasTrackerData && stats.trackerMessages < stats.totalMessages) {
        html += `<div class="rpg-cs-stat-note">
            <i class="fa-solid fa-info-circle"></i>
            Tracker data available for ${stats.trackerMessages} of ${stats.totalMessages} messages. Basic stats (speaking, mentions) cover all messages.
        </div>`;
    }

    // Presence section
    html += `<div class="rpg-cs-stat-section"><div class="rpg-cs-stat-section-title">Presence</div>`;
    html += statBar('Speaking', stats.speakingPercent, `${stats.speakingCount} / ${stats.totalMessages} messages`);
    html += statBar('Mentioned', stats.mentionPercent, `${stats.mentionCount} / ${stats.totalMessages} messages`);
    if (stats.hasTrackerData) {
        html += statBar('Scene Presence', stats.presentPercent, `${stats.presentCount} / ${stats.trackerMessages} tracked`);
    }
    html += statRow('First Seen', stats.firstSeen !== null ? `Message #${stats.firstSeen + 1}` : '—');
    html += statRow('Last Seen', stats.lastSeen !== null ? `Message #${stats.lastSeen + 1}` : '—');
    if (stats.longestAbsence > 0) {
        html += statRow('Longest Absence', `${stats.longestAbsence} messages`);
    }
    html += `</div>`;

    // Activity section (only if tracker data exists for silent/speaking split)
    if (stats.hasTrackerData && stats.presentCount > 0) {
        html += `<div class="rpg-cs-stat-section"><div class="rpg-cs-stat-section-title">Activity (Tracked)</div>`;
        const trackerSpeakPct = stats.presentCount > 0 ? Math.round((stats.speakingCount / stats.presentCount) * 100) : 0;
        html += statBar('Speaking', trackerSpeakPct, `${stats.speakingCount} messages`);
        html += statBar('Silent Presence', stats.silentPercent, `${stats.silentCount} messages`);
        html += `</div>`;
    }

    // Relationship timeline
    if (stats.relationshipChanges.length > 0) {
        html += `<div class="rpg-cs-stat-section"><div class="rpg-cs-stat-section-title">Relationship Timeline</div>`;
        html += `<div class="rpg-cs-timeline">`;
        for (const change of stats.relationshipChanges) {
            html += `<div class="rpg-cs-timeline-entry">
                <span class="rpg-cs-timeline-msg">#${change.messageIndex + 1}</span>
                <span class="rpg-cs-timeline-line"></span>
                <span class="rpg-cs-timeline-status">${change.status}</span>
            </div>`;
        }
        html += `</div></div>`;
    }

    // Recent thoughts
    if (stats.lastThoughts.length > 0) {
        html += `<div class="rpg-cs-stat-section"><div class="rpg-cs-stat-section-title">Recent Thoughts</div>`;
        for (const t of stats.lastThoughts) {
            html += `<div class="rpg-cs-thought-entry">
                <span class="rpg-cs-thought-msg">#${t.messageIndex + 1}</span>
                <span class="rpg-cs-thought-text">"${t.content}"</span>
            </div>`;
        }
        html += `</div>`;
    }

    return html;
}

function statBar(label, percent, detail) {
    return `<div class="rpg-cs-stat-row">
        <span class="rpg-cs-stat-label">${label}</span>
        <div class="rpg-cs-stat-bar"><div class="rpg-cs-stat-bar-fill" style="width: ${percent}%"></div></div>
        <span class="rpg-cs-stat-value">${detail}</span>
    </div>`;
}

function statRow(label, value) {
    return `<div class="rpg-cs-stat-row">
        <span class="rpg-cs-stat-label">${label}</span>
        <span class="rpg-cs-stat-value">${value}</span>
    </div>`;
}

// ─────────────────────────────────────────────
//  Renderer
// ─────────────────────────────────────────────

/** HTML tags allowed through in character sheet content (Bunny Mo uses details/summary/div/span with inline styles) */
const ALLOWED_TAGS = /^(details|summary|div|span|br|hr|b|i|em|strong|u|s|ul|ol|li|p|h[1-6]|table|thead|tbody|tr|th|td|blockquote|code|pre)$/i;

/**
 * Simple markdown-to-HTML for sheet content (bold, italic, lists, line breaks).
 * Allows safe HTML tags through (details, summary, div, span, etc.) so Bunny Mo
 * collapsible sections and styled blocks render correctly.
 */
function renderMarkdown(text) {
    if (!text) return '';
    // Selectively escape HTML — allow safe tags through, escape everything else
    let html = text.replace(/(<\/?)([\w-]+)([^>]*>)/g, (match, open, tag, rest) => {
        if (ALLOWED_TAGS.test(tag)) return match;
        return open.replace(/</g, '&lt;') + tag + rest.replace(/>/g, '&gt;');
    });
    html = html
        // Bold
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        // Italic
        .replace(/\*(.+?)\*/g, '<em>$1</em>')
        // Line breaks
        .replace(/\n/g, '<br>');
    return html;
}

/**
 * Opens the character sheet popup for the given character name.
 */
export function openCharacterSheet(characterName) {
    if (!characterName) return;

    const $modal = $('#rpg-character-sheet-popup');
    if (!$modal.length) return;

    const sheetData = getCharacterSheet(characterName);
    const portraitSrc = resolveFullPortrait(characterName);

    // Hero art
    cleanupHeroArtDrag(); // Clean up any previous state
    const $art = $modal.find('.rpg-cs-hero-art');
    if (portraitSrc) {
        const pos = getHeroPosition(characterName);
        $art.attr('src', portraitSrc)
            .css('object-position', `${pos.x}% ${pos.y}%`)
            .show();
        // Right-click context menu on hero art
        $art.off('contextmenu.heroCtx').on('contextmenu.heroCtx', (e) => {
            if (!_repositionActive) showHeroContextMenu(e, characterName);
        });
    } else {
        $art.hide();
    }

    // Character name
    $modal.find('.rpg-cs-hero-name').text(characterName);
    // Notes handlers need the open character's name after the fact.
    $modal.attr('data-cs-character', characterName);

    // Build tab bar + content area
    const $sections = $modal.find('.rpg-cs-sections');
    $sections.empty();

    const notesMode = sheetData?.mode === 'notes';

    // Tab bar — with the per-character Notes Mode toggle on the right.
    $sections.append(`
        <div class="rpg-cs-tabs">
            <div class="rpg-cs-tab active" data-tab="sheet"><i class="fa-solid ${notesMode ? 'fa-note-sticky' : 'fa-scroll'}"></i> ${notesMode ? 'Notes' : 'Sheet'}</div>
            <div class="rpg-cs-tab" data-tab="stats"><i class="fa-solid fa-chart-bar"></i> Stats</div>
            <label class="rpg-cs-mode-toggle" title="Replace the imported sheet view with your own notes for this character. The imported sheet is kept and comes back when you toggle off.">
                <input type="checkbox" id="rpg-cs-notes-toggle" ${notesMode ? 'checked' : ''}> Notes Mode
            </label>
        </div>
    `);

    // Sheet tab content — imported sheet, or the editable notes area when
    // this character is in Notes Mode.
    const sheetHTML = notesMode ? renderNotesArea(sheetData) : renderImportedSheet(sheetData);
    $sections.append(`<div class="rpg-cs-tab-content" data-tab="sheet">${sheetHTML}</div>`);

    // Stats tab content (lazy — computed on first click)
    $sections.append(`<div class="rpg-cs-tab-content" data-tab="stats" style="display: none;" data-character="${escapeAttr(characterName)}"></div>`);

    $modal.css('display', 'flex');
}

function renderImportedSheet(sheetData) {
    if (!sheetData || !sheetData.sections || sheetData.sections.length === 0) {
        return `
            <div class="rpg-cs-empty">
                <i class="fa-solid fa-scroll" style="font-size: 2em; opacity: 0.3; margin-bottom: 12px;"></i>
                <p>No character sheet data.</p>
                <p style="font-size: 0.85em; opacity: 0.6;">Use Bunny Mo's <code>!fullsheet</code> command to generate one, then click the import button on the resulting message.<br>Or flip <strong>Notes Mode</strong> above to keep your own notes for this character.</p>
            </div>
        `;
    }
    let sheetHTML = '';
    if (sheetData.characterTitle) {
        sheetHTML += `<div class="rpg-cs-title">${sheetData.characterTitle}</div>`;
    }
    for (const section of sheetData.sections) {
        sheetHTML += `
            <div class="rpg-cs-section">
                <div class="rpg-cs-section-header">
                    <span class="rpg-cs-section-emoji">${section.emoji || ''}</span>
                    <span class="rpg-cs-section-title">${section.title}</span>
                    <i class="fa-solid fa-chevron-down rpg-cs-chevron"></i>
                </div>
                <div class="rpg-cs-section-body" style="display: none;">
                    ${renderMarkdown(section.content)}
                </div>
            </div>
        `;
    }
    return sheetHTML;
}

// ─────────────────────────────────────────────
//  Notes mode (user-created dropdown sections)
// ─────────────────────────────────────────────

function renderNotesArea(sheetData) {
    const sections = Array.isArray(sheetData?.notesSections) ? sheetData.notesSections : [];
    let html = '';
    if (!sections.length) {
        html += `
            <div class="rpg-cs-empty">
                <i class="fa-solid fa-note-sticky" style="font-size: 2em; opacity: 0.3; margin-bottom: 12px;"></i>
                <p>No notes yet.</p>
                <p style="font-size: 0.85em; opacity: 0.6;">Add your first section below — each section is a collapsible dropdown, like an imported sheet's.</p>
            </div>
        `;
    }
    for (const section of sections) {
        html += renderNoteSection(section);
    }
    html += `<button class="rpg-cs-note-add rpg-accordion-action-btn" type="button"><i class="fa-solid fa-plus"></i> Add Section</button>`;
    return html;
}

function renderNoteSection(section) {
    // Unlike imported sheets (whose text was already on-screen as a chat
    // message), note titles/emoji are user-typed — escape them.
    return `
        <div class="rpg-cs-section rpg-cs-note" data-note-id="${escapeAttr(section.id)}">
            <div class="rpg-cs-section-header">
                <span class="rpg-cs-section-emoji">${escapeHtml(section.emoji || '')}</span>
                <span class="rpg-cs-section-title">${escapeHtml(section.title || 'Untitled')}</span>
                <span class="rpg-cs-note-controls">
                    <i class="fa-solid fa-arrow-up rpg-cs-note-up" title="Move up"></i>
                    <i class="fa-solid fa-arrow-down rpg-cs-note-down" title="Move down"></i>
                    <i class="fa-solid fa-pencil rpg-cs-note-edit" title="Edit section"></i>
                    <i class="fa-solid fa-trash rpg-cs-note-delete" title="Delete section"></i>
                </span>
                <i class="fa-solid fa-chevron-down rpg-cs-chevron"></i>
            </div>
            <div class="rpg-cs-section-body" style="display: none;">${renderMarkdown(section.content || '')}</div>
        </div>
    `;
}

function renderNoteEditor(section) {
    return `
        <div class="rpg-cs-note-editor">
            <div class="rpg-cs-note-editor-row">
                <input type="text" class="rpg-cs-note-emoji-input" maxlength="4" placeholder="📝" value="${escapeAttr(section.emoji || '')}" title="Emoji (optional)">
                <input type="text" class="rpg-cs-note-title-input" maxlength="80" placeholder="Section title" value="${escapeAttr(section.title || '')}">
            </div>
            <textarea class="rpg-cs-note-content-input" rows="7" placeholder="Write your notes… **bold** and *italic* markdown works.">${escapeHtml(section.content || '')}</textarea>
            <div class="rpg-cs-note-editor-actions">
                <button type="button" class="rpg-btn rpg-btn-ghost rpg-cs-note-cancel">Cancel</button>
                <button type="button" class="rpg-btn rpg-btn-primary rpg-cs-note-save">Save</button>
            </div>
        </div>
    `;
}

/** The character whose sheet popup is currently open. */
function openSheetCharacter() {
    return $('#rpg-character-sheet-popup').attr('data-cs-character') || '';
}

/** Re-renders the whole popup body for the open character (cheap). */
function rerenderOpenSheet() {
    const name = openSheetCharacter();
    if (name) openCharacterSheet(name);
}

function closeCharacterSheet() {
    cleanupHeroArtDrag();
    $('#rpg-character-sheet-popup').css('display', 'none');
}

// ─────────────────────────────────────────────
//  Import from message
// ─────────────────────────────────────────────

/**
 * Import a fullsheet from a specific chat message.
 * Prompts user to confirm character name before saving.
 */
export async function importFullSheetFromMessage(messageId) {
    const context = SillyTavern.getContext();
    const chat = context.chat || [];
    const message = chat[messageId];

    if (!message) {
        toastr.error('Message not found.', '', { timeOut: 3000 });
        return;
    }

    const text = message.mes || '';
    const parsed = parseFullSheet(text);

    if (!parsed) {
        toastr.warning('No fullsheet data found in this message.', '', { timeOut: 3000 });
        return;
    }

    // Pre-fill with detected name — only use short, clean names (no narrative text)
    let defaultName = '';
    if (parsed.characterName && parsed.characterName.length < 40 && !parsed.characterName.includes('.')) {
        defaultName = parsed.characterName;
    }
    const name = await callGenericPopup(
        `<h3>Import Character Sheet</h3><p>Enter the character name to assign this sheet to:</p><p style="font-size: 0.75em; opacity: 0.6; margin-top: 4px;">Name must match exactly as it appears in the Present Characters panel (case-sensitive).</p>`,
        POPUP_TYPE.INPUT,
        defaultName
    );

    if (!name || !name.trim()) {
        toastr.info('Import cancelled.', '', { timeOut: 2000 });
        return;
    }

    // Merge over any existing entry — an overwrite would wipe fields the
    // sheet popup stores alongside the import (notes mode, notes sections).
    const existing = getCharacterSheet(name.trim());
    saveCharacterSheet(name.trim(), { ...(existing || {}), ...parsed });
    if (existing?.mode === 'notes') {
        toastr.success(`Character sheet imported for ${name.trim()}. Notes Mode is on for this character — toggle it off in the sheet popup to view the import.`, '', { timeOut: 5000 });
    } else {
        toastr.success(`Character sheet imported for ${name.trim()}.`, '', { timeOut: 3000 });
    }
}

/**
 * Checks if a message contains fullsheet content and returns true if so.
 * Used to determine whether to show the import button.
 * Language-agnostic — matches any N/M numbered section headers, not just English "SECTION".
 */
// messageHasFullSheet moved to fullsheetButtons.js

/**
 * Scans all existing chat messages and injects the import button
 * on any that contain fullsheet data. Called on CHAT_CHANGED.
 */
// injectFullSheetButtons moved to fullsheetButtons.js

// ─────────────────────────────────────────────
//  Copy
// ─────────────────────────────────────────────

function copyCharacterSheet() {
    const $sections = $('.rpg-cs-sections');
    const name = $('.rpg-cs-hero-name').text();
    const sectionTexts = [];

    $sections.find('.rpg-cs-section').each(function () {
        // A notes section mid-edit renders inputs, not content — skip it.
        if ($(this).find('.rpg-cs-note-editor').length) return;
        const title = $(this).find('.rpg-cs-section-title').text();
        const emoji = $(this).find('.rpg-cs-section-emoji').text();
        const body = $(this).find('.rpg-cs-section-body').html()
            ?.replace(/<br\s*\/?>/gi, '\n')
            .replace(/<strong>(.+?)<\/strong>/g, '**$1**')
            .replace(/<em>(.+?)<\/em>/g, '*$1*')
            .replace(/<[^>]+>/g, '')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>') || '';
        sectionTexts.push(`## ${emoji} ${title}\n${body}`);
    });

    const fullText = `# Character Sheet: ${name}\n\n${sectionTexts.join('\n\n---\n\n')}`;

    navigator.clipboard.writeText(fullText).then(() => {
        toastr.success('Character sheet copied to clipboard.', '', { timeOut: 2000 });
    }).catch(() => {
        toastr.error('Failed to copy to clipboard.', '', { timeOut: 2000 });
    });
}

// ─────────────────────────────────────────────
//  Init
// ─────────────────────────────────────────────

export function initCharacterSheet() {
    // Tab switching
    $(document).on('click', '.rpg-cs-tab', function () {
        const tabName = $(this).data('tab');
        const $modal = $(this).closest('#rpg-character-sheet-popup');

        // Update active tab
        $modal.find('.rpg-cs-tab').removeClass('active');
        $(this).addClass('active');

        // Show/hide tab content
        $modal.find('.rpg-cs-tab-content').hide();
        $modal.find(`.rpg-cs-tab-content[data-tab="${tabName}"]`).show();

        // Lazy-load stats on first click
        if (tabName === 'stats') {
            const $statsPanel = $modal.find('.rpg-cs-tab-content[data-tab="stats"]');
            if ($statsPanel.children().length === 0) {
                const charName = $statsPanel.data('character');
                const stats = computeCharacterStats(charName);
                $statsPanel.html(renderStatsPage(charName, stats));
            }
        }
    });

    // Stats info popup toggle
    $(document).on('click', '.rpg-cs-stats-info-btn', function () {
        $(this).siblings('.rpg-cs-stats-info-popup').slideToggle(150);
    });

    // Section collapse/expand
    $(document).on('click', '.rpg-cs-section-header', function (e) {
        // Clicks on the note edit/delete/reorder controls must not toggle.
        if ($(e.target).closest('.rpg-cs-note-controls').length) return;
        const $body = $(this).next('.rpg-cs-section-body');
        // Don't collapse a section that's showing its editor.
        if ($body.find('.rpg-cs-note-editor').length) return;
        const $chevron = $(this).find('.rpg-cs-chevron');
        $body.slideToggle(200);
        $chevron.toggleClass('fa-chevron-down fa-chevron-up');
    });

    // ── Notes Mode ──

    // Per-character toggle between the imported sheet and the notes area.
    $(document).on('change', '#rpg-cs-notes-toggle', function () {
        const name = openSheetCharacter();
        if (!name) return;
        const entry = ensureSheetEntry(name);
        if (!entry) {
            $(this).prop('checked', false);
            toastr.warning('No chat data yet — send a message in this chat first.', '', { timeOut: 3000 });
            return;
        }
        entry.mode = $(this).prop('checked') ? 'notes' : 'sheet';
        saveCharacterSheet(name, entry, { immediate: true });
        rerenderOpenSheet();
    });

    // Add a new section — rendered straight into edit state; it only joins
    // the stored array when the user hits Save.
    $(document).on('click', '.rpg-cs-note-add', function () {
        const blank = { id: 'note-' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36), emoji: '', title: '', content: '' };
        const $section = $(renderNoteSection(blank));
        $section.attr('data-note-new', '1');
        $section.find('.rpg-cs-section-body').html(renderNoteEditor(blank)).show();
        $(this).before($section);
        $section.find('.rpg-cs-note-title-input').trigger('focus');
    });

    // Edit an existing section in place.
    $(document).on('click', '.rpg-cs-note-edit', function (e) {
        e.stopPropagation();
        const name = openSheetCharacter();
        const $section = $(this).closest('.rpg-cs-note');
        const entry = name ? getCharacterSheet(name) : null;
        const section = entry?.notesSections?.find(s => s.id === $section.attr('data-note-id'));
        if (!section) return;
        $section.find('.rpg-cs-section-body').html(renderNoteEditor(section)).show();
        $section.find('.rpg-cs-note-title-input').trigger('focus');
    });

    // Save (new or edited) section.
    $(document).on('click', '.rpg-cs-note-save', function () {
        const name = openSheetCharacter();
        if (!name) return;
        const entry = ensureSheetEntry(name);
        if (!entry) return;
        const $section = $(this).closest('.rpg-cs-note');
        const id = $section.attr('data-note-id');
        const emoji = String($section.find('.rpg-cs-note-emoji-input').val() || '').trim();
        const title = String($section.find('.rpg-cs-note-title-input').val() || '').trim() || 'Untitled';
        const content = String($section.find('.rpg-cs-note-content-input').val() || '');
        const existing = entry.notesSections.find(s => s.id === id);
        if (existing) {
            Object.assign(existing, { emoji, title, content });
        } else {
            entry.notesSections.push({ id, emoji, title, content });
        }
        saveCharacterSheet(name, entry, { immediate: true });
        rerenderOpenSheet();
    });

    // Cancel editing — a never-saved section disappears, an edited one
    // returns to its stored state.
    $(document).on('click', '.rpg-cs-note-cancel', function () {
        const $section = $(this).closest('.rpg-cs-note');
        if ($section.attr('data-note-new')) {
            $section.remove();
            return;
        }
        rerenderOpenSheet();
    });

    // Delete a section.
    $(document).on('click', '.rpg-cs-note-delete', function (e) {
        e.stopPropagation();
        const name = openSheetCharacter();
        if (!name) return;
        const entry = getCharacterSheet(name);
        if (!entry?.notesSections) return;
        const $section = $(this).closest('.rpg-cs-note');
        const id = $section.attr('data-note-id');
        const section = entry.notesSections.find(s => s.id === id);
        const label = section?.title ? `"${section.title}"` : 'this section';
        if (!window.confirm(`Delete ${label}? This can't be undone.`)) return;
        entry.notesSections = entry.notesSections.filter(s => s.id !== id);
        saveCharacterSheet(name, entry, { immediate: true });
        rerenderOpenSheet();
    });

    // Reorder.
    const moveNote = (el, delta) => {
        const name = openSheetCharacter();
        if (!name) return;
        const entry = getCharacterSheet(name);
        if (!entry?.notesSections) return;
        const id = $(el).closest('.rpg-cs-note').attr('data-note-id');
        const idx = entry.notesSections.findIndex(s => s.id === id);
        const target = idx + delta;
        if (idx < 0 || target < 0 || target >= entry.notesSections.length) return;
        const [moved] = entry.notesSections.splice(idx, 1);
        entry.notesSections.splice(target, 0, moved);
        saveCharacterSheet(name, entry, { immediate: true });
        rerenderOpenSheet();
    };
    $(document).on('click', '.rpg-cs-note-up', function (e) { e.stopPropagation(); moveNote(this, -1); });
    $(document).on('click', '.rpg-cs-note-down', function (e) { e.stopPropagation(); moveNote(this, 1); });

    // Close button
    $(document).on('click', '#rpg-close-character-sheet', closeCharacterSheet);

    // Copy button
    $(document).on('click', '#rpg-cs-copy', copyCharacterSheet);

    // Close on backdrop click
    $(document).on('click', '#rpg-character-sheet-popup', function (e) {
        if (e.target === this) closeCharacterSheet();
    });

    console.log('[Dooms Tracker] Character Sheet module initialized');
}

