/**
 * Character Sheet — full-screen popup with hero art + collapsible fullsheet sections.
 *
 * Data is stored per-chat in chat_metadata.dooms_tracker.characterSheets.
 * Users import sheets by clicking an import button on messages containing
 * Bunny Mo !fullsheet output.
 */
import { extensionSettings } from '../../core/state.js';
import { saveChatData } from '../../core/persistence.js';
import { resolvePortrait, resolveFullPortrait } from './portraitBar.js';
import { chat_metadata, chat } from '../../../../../../../script.js';
import { callGenericPopup, POPUP_TYPE } from '../../../../../../popup.js';

// ─────────────────────────────────────────────
//  Stats cache (cleared on chat change)
// ─────────────────────────────────────────────
const statsCache = new Map();

export function clearStatsCache() {
    statsCache.clear();
}

// ─────────────────────────────────────────────
//  Parser
// ─────────────────────────────────────────────

/**
 * Parses a Bunny Mo !fullsheet output from a message string.
 * Returns { characterTitle, sections: [{ number, emoji, title, content }] } or null.
 */
export function parseFullSheet(text) {
    if (!text || !text.includes('SECTION 1/')) return null;

    // Match sections like: ## SECTION 1/14: 🆔 **Core Identity & Context**
    const sectionRegex = /##\s*SECTION\s+(\d+)\/\d+:\s*(.+)/g;
    const matches = [];
    let match;

    while ((match = sectionRegex.exec(text)) !== null) {
        matches.push({
            number: parseInt(match[1]),
            fullHeader: match[2].trim(),
            startIndex: match.index,
            headerEndIndex: match.index + match[0].length,
        });
    }

    if (matches.length < 2) return null; // Need at least 2 sections to be a valid fullsheet

    const sections = matches.map((m, idx) => {
        // Content runs from end of this header to start of next section (or end of text)
        const contentStart = m.headerEndIndex;
        const contentEnd = idx < matches.length - 1 ? matches[idx + 1].startIndex : text.length;
        let content = text.substring(contentStart, contentEnd).trim();

        // Remove trailing --- dividers
        content = content.replace(/\n---\s*$/, '').trim();

        // Extract emoji and title from header like "🆔 **Core Identity & Context**"
        const headerClean = m.fullHeader.replace(/\*\*/g, '').trim();
        // First character(s) might be emoji
        const emojiMatch = headerClean.match(/^(\p{Emoji_Presentation}|\p{Emoji}\uFE0F?)\s*/u);
        const emoji = emojiMatch ? emojiMatch[1] : '';
        const title = emojiMatch ? headerClean.substring(emojiMatch[0].length).trim() : headerClean;

        return {
            number: m.number,
            emoji,
            title,
            content,
        };
    });

    // Try to extract character title from the text before first section
    const preSection = text.substring(0, matches[0].startIndex);
    const titleMatch = preSection.match(/Character Title:\s*(?:The\s+)?(.+?)(?:\n|$)/i);
    const characterTitle = titleMatch ? titleMatch[1].replace(/\*\*/g, '').trim() : '';

    // Try to extract character name from Section 1 content
    const nameMatch = sections[0]?.content.match(/\*\*Name:\*\*\s*(.+?)(?:\n|$)/i);
    const characterName = nameMatch ? nameMatch[1].replace(/[\[\]]/g, '').trim() : '';

    return {
        characterTitle,
        characterName,
        sections,
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

export function getCharacterSheet(name) {
    if (!ensureSheetStorage()) return null;
    if (!name) return null;
    // Case-insensitive lookup
    const lower = name.toLowerCase();
    for (const [key, val] of Object.entries(chat_metadata.dooms_tracker.characterSheets)) {
        if (key.toLowerCase() === lower) return val;
    }
    return null;
}

export function saveCharacterSheet(name, data) {
    if (!ensureSheetStorage()) return;
    chat_metadata.dooms_tracker.characterSheets[name] = data;
    saveChatData();
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

        // Speaking: this character is the message author
        if (message.name && namesMatchLoose(message.name, target)) {
            speakingCount++;
            if (firstSpoken === null) firstSpoken = i;
            lastSpoken = i;
        }

        // Mentioned in message text (lightweight check)
        if (message.mes && message.mes.toLowerCase().includes(target)) {
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
    const $art = $modal.find('.rpg-cs-hero-art');
    if (portraitSrc) {
        $art.attr('src', portraitSrc).show();
    } else {
        $art.hide();
    }

    // Character name
    $modal.find('.rpg-cs-hero-name').text(characterName);

    // Build tab bar + content area
    const $sections = $modal.find('.rpg-cs-sections');
    $sections.empty();

    // Tab bar
    $sections.append(`
        <div class="rpg-cs-tabs">
            <div class="rpg-cs-tab active" data-tab="sheet"><i class="fa-solid fa-scroll"></i> Sheet</div>
            <div class="rpg-cs-tab" data-tab="stats"><i class="fa-solid fa-chart-bar"></i> Stats</div>
        </div>
    `);

    // Sheet tab content
    let sheetHTML = '';
    if (!sheetData || !sheetData.sections || sheetData.sections.length === 0) {
        sheetHTML = `
            <div class="rpg-cs-empty">
                <i class="fa-solid fa-scroll" style="font-size: 2em; opacity: 0.3; margin-bottom: 12px;"></i>
                <p>No character sheet data.</p>
                <p style="font-size: 0.85em; opacity: 0.6;">Use Bunny Mo's <code>!fullsheet</code> command to generate one, then click the import button on the resulting message.</p>
            </div>
        `;
    } else {
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
    }
    $sections.append(`<div class="rpg-cs-tab-content" data-tab="sheet">${sheetHTML}</div>`);

    // Stats tab content (lazy — computed on first click)
    $sections.append(`<div class="rpg-cs-tab-content" data-tab="stats" style="display: none;" data-character="${characterName}"></div>`);

    $modal.css('display', 'flex');
}

function closeCharacterSheet() {
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

    saveCharacterSheet(name.trim(), parsed);
    toastr.success(`Character sheet imported for ${name.trim()}.`, '', { timeOut: 3000 });
}

/**
 * Checks if a message contains fullsheet content and returns true if so.
 * Used to determine whether to show the import button.
 */
export function messageHasFullSheet(messageText) {
    return messageText && messageText.includes('SECTION 1/') && messageText.includes('SECTION 2/');
}

/**
 * Scans all existing chat messages and injects the import button
 * on any that contain fullsheet data. Called on CHAT_CHANGED.
 */
export function injectFullSheetButtons() {
    if (!extensionSettings.enabled || !extensionSettings.bunnyMoIntegration) return;
    const context = SillyTavern.getContext();
    const chat = context.chat || [];

    $('#chat .mes').each(function () {
        const mesId = parseInt($(this).attr('mesid'));
        if (isNaN(mesId)) return;
        const msg = chat[mesId];
        if (!msg || msg.is_user || msg.is_system) return;
        if (!messageHasFullSheet(msg.mes)) return;

        const $extraBtns = $(this).find('.mes_buttons .extraMesButtons');
        if ($extraBtns.length && !$extraBtns.find('.dooms-import-fullsheet-btn').length) {
            $extraBtns.prepend(`<div class="dooms-import-fullsheet-btn mes_button fa-solid fa-scroll" title="Import Character Sheet"></div>`);
        }
    });
}

// ─────────────────────────────────────────────
//  Copy
// ─────────────────────────────────────────────

function copyCharacterSheet() {
    const $sections = $('.rpg-cs-sections');
    const name = $('.rpg-cs-hero-name').text();
    const sectionTexts = [];

    $sections.find('.rpg-cs-section').each(function () {
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

    // Section collapse/expand
    $(document).on('click', '.rpg-cs-section-header', function () {
        const $body = $(this).next('.rpg-cs-section-body');
        const $chevron = $(this).find('.rpg-cs-chevron');
        $body.slideToggle(200);
        $chevron.toggleClass('fa-chevron-down fa-chevron-up');
    });

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
