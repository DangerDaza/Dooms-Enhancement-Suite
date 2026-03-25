/**
 * Character Sheet — full-screen popup with hero art + collapsible fullsheet sections.
 *
 * Data is stored per-chat in chat_metadata.dooms_tracker.characterSheets.
 * Users import sheets by clicking an import button on messages containing
 * Bunny Mo !fullsheet output.
 */
import { extensionSettings } from '../../core/state.js';
import { saveChatData } from '../../core/persistence.js';
import { resolvePortrait } from './portraitBar.js';
import { chat_metadata } from '../../../../../../../script.js';
import { callGenericPopup, POPUP_TYPE } from '../../../../../../popup.js';

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
//  Renderer
// ─────────────────────────────────────────────

/**
 * Simple markdown-to-HTML for sheet content (bold, italic, lists, line breaks).
 */
function renderMarkdown(text) {
    if (!text) return '';
    let html = text
        // Escape HTML
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
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
    const portraitSrc = resolvePortrait(characterName);

    // Hero art
    const $art = $modal.find('.rpg-cs-hero-art');
    if (portraitSrc) {
        $art.attr('src', portraitSrc).show();
    } else {
        $art.hide();
    }

    // Character name
    $modal.find('.rpg-cs-hero-name').text(characterName);

    // Sections
    const $sections = $modal.find('.rpg-cs-sections');
    $sections.empty();

    if (!sheetData || !sheetData.sections || sheetData.sections.length === 0) {
        $sections.append(`
            <div class="rpg-cs-empty">
                <i class="fa-solid fa-scroll" style="font-size: 2em; opacity: 0.3; margin-bottom: 12px;"></i>
                <p>No character sheet data.</p>
                <p style="font-size: 0.85em; opacity: 0.6;">Use Bunny Mo's <code>!fullsheet</code> command to generate one, then click the import button on the resulting message.</p>
            </div>
        `);
    } else {
        if (sheetData.characterTitle) {
            $sections.append(`<div class="rpg-cs-title">${sheetData.characterTitle}</div>`);
        }

        for (const section of sheetData.sections) {
            const sectionHtml = `
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
            $sections.append(sectionHtml);
        }
    }

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

    // Pre-fill with detected name or ask user
    const defaultName = parsed.characterName || message.name || '';
    const name = await callGenericPopup(
        `<h3>Import Character Sheet</h3><p>Enter the character name to assign this sheet to:</p>`,
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
