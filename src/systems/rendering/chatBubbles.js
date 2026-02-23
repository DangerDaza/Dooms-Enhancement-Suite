/**
 * Chat Bubbles Rendering Module
 * Transforms AI messages into per-character chat bubbles with portraits.
 * Supports two visual styles: "discord" (full-width blocks) and "cards" (rounded cards).
 *
 * Works by parsing the rendered HTML inside .mes_text, splitting it into
 * narrator and dialogue segments, then re-rendering as styled bubbles.
 * Original HTML is preserved in a data attribute for clean revert.
 */
import { extensionSettings } from '../../core/state.js';
import { resolvePortrait, getCharacterList } from '../ui/portraitBar.js';
import { hexToRgb } from './sceneHeaders.js';
import { executeSlashCommandsOnChatInput } from '../../../../../../../scripts/slash-commands.js';

// ─────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────

/** HTML-escape a string for safe insertion */
function escapeHtml(str) {
    const div = document.createElement('div');
    div.appendChild(document.createTextNode(str));
    return div.innerHTML;
}

/** Strip HTML tags and return plain text */
function stripHtml(html) {
    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    return tmp.textContent || tmp.innerText || '';
}

/** Strip <font color> tags from HTML, keeping their inner content */
function stripFontColors(html) {
    return html.replace(/<\/?font[^>]*>/gi, '');
}

/**
 * Look up a character's assigned color from extensionSettings.characterColors.
 * Tries exact match first, then case-insensitive, then partial/substring match.
 */
function getAssignedColor(speakerName) {
    if (!speakerName || !extensionSettings.characterColors) return null;
    const colors = extensionSettings.characterColors;

    // 1. Exact match
    if (colors[speakerName]) return colors[speakerName];

    // 2. Case-insensitive match
    const lowerSpeaker = speakerName.toLowerCase();
    for (const [name, color] of Object.entries(colors)) {
        if (name.toLowerCase() === lowerSpeaker) return color;
    }

    // 3. Speaker name is contained in a stored name (e.g. "Sakura" matches "Sakura (Haruno)")
    //    or stored name is contained in speaker name
    for (const [name, color] of Object.entries(colors)) {
        const lowerName = name.toLowerCase();
        if (lowerName.includes(lowerSpeaker) || lowerSpeaker.includes(lowerName)) {
            return color;
        }
    }

    return null;
}

/** Build a map from lowercase hex colour → character name */
function buildColorToSpeakerMap() {
    const map = new Map();
    if (extensionSettings.characterColors) {
        for (const [name, color] of Object.entries(extensionSettings.characterColors)) {
            if (color) map.set(color.toLowerCase(), name);
        }
    }
    return map;
}

/** Build a set of known character names (lowercase → original) */
function buildNameLookup() {
    const map = new Map();
    const chars = getCharacterList();
    for (const c of chars) {
        map.set(c.name.toLowerCase(), c.name);
    }
    if (extensionSettings.knownCharacters) {
        for (const name of Object.keys(extensionSettings.knownCharacters)) {
            if (!map.has(name.toLowerCase())) map.set(name.toLowerCase(), name);
        }
    }
    return map;
}

// ─────────────────────────────────────────────
//  Parser — split .mes_text HTML into segments
// ─────────────────────────────────────────────

/**
 * Parse a .mes_text element's content into an ordered array of segments.
 * @param {HTMLElement} mesText - The .mes_text DOM element
 * @returns {Array<{type: string, speaker: string|null, color: string|null, html: string}>}
 */
function parseMessageIntoBubbles(mesText) {
    const colorMap = buildColorToSpeakerMap();
    const nameLookup = buildNameLookup();

    // Clone so we can safely manipulate
    const clone = mesText.cloneNode(true);

    // Remove inline thoughts (they live in .mes_text but aren't part of the message)
    clone.querySelectorAll('.dooms-inline-thought').forEach(el => el.remove());
    // Remove any previously applied bubble wrappers (safety)
    clone.querySelectorAll('.dooms-bubbles').forEach(el => el.remove());

    const allSegments = [];
    const blocks = getTopLevelBlocks(clone);

    for (const block of blocks) {
        const segs = parseBlockIntoSegments(block, colorMap, nameLookup);
        allSegments.push(...segs);
    }

    return mergeConsecutiveNarration(allSegments);
}

/**
 * Split a container into top-level blocks (paragraphs, or text-runs separated by <br>).
 */
function getTopLevelBlocks(container) {
    const blocks = [];
    let currentHtml = '';

    for (const child of container.childNodes) {
        if (child.nodeType === Node.ELEMENT_NODE &&
            (child.tagName === 'P' || child.tagName === 'DIV')) {
            // Flush accumulated inline content
            if (currentHtml.trim()) {
                const wrapper = document.createElement('span');
                wrapper.innerHTML = currentHtml;
                blocks.push(wrapper);
                currentHtml = '';
            }
            blocks.push(child);
        } else if (child.nodeType === Node.ELEMENT_NODE && child.tagName === 'BR') {
            // BR acts as a block separator
            if (currentHtml.trim()) {
                const wrapper = document.createElement('span');
                wrapper.innerHTML = currentHtml;
                blocks.push(wrapper);
                currentHtml = '';
            }
        } else {
            // Text node or inline element — accumulate
            if (child.nodeType === Node.TEXT_NODE) {
                currentHtml += child.textContent;
            } else {
                currentHtml += child.outerHTML || child.textContent || '';
            }
        }
    }

    if (currentHtml.trim()) {
        const wrapper = document.createElement('span');
        wrapper.innerHTML = currentHtml;
        blocks.push(wrapper);
    }

    return blocks;
}

/**
 * Parse a single block element into segments (narrator text vs character dialogue).
 * Uses a recursive walk so that <font color> tags nested inside <em>, <strong>,
 * <q>, <span>, etc. (from markdown rendering) are still found and extracted.
 */
function parseBlockIntoSegments(block, colorMap, nameLookup) {
    const segments = [];
    const fontElements = block.querySelectorAll('font[color]');

    // No font tags at all → pure narrator block
    if (fontElements.length === 0) {
        const text = block.innerHTML.trim();
        if (text && stripHtml(text).trim()) {
            segments.push({ type: 'narrator', speaker: null, color: null, html: text });
        }
        return segments;
    }

    // Recursively walk the DOM tree to find <font color> elements at any depth.
    // Elements that DON'T contain a <font color> descendant are kept as opaque
    // narration HTML.  Elements that DO contain one are descended into so we
    // can split around the <font> boundaries.
    const parts = []; // { type: 'font', node } | { type: 'text', html }

    function walkNodes(parent) {
        for (const child of parent.childNodes) {
            if (child.nodeType === Node.ELEMENT_NODE &&
                child.tagName === 'FONT' && child.getAttribute('color')) {
                // Found a <font color="..."> — yield it as dialogue
                parts.push({ type: 'font', node: child });
            } else if (child.nodeType === Node.TEXT_NODE) {
                const text = child.textContent;
                if (text) parts.push({ type: 'text', html: text });
            } else if (child.nodeType === Node.ELEMENT_NODE) {
                // Does this element contain a <font color> somewhere inside?
                if (child.querySelector('font[color]')) {
                    // Yes — descend into it to split around the font tags
                    walkNodes(child);
                } else {
                    // No font descendants — treat the whole element as narration
                    parts.push({ type: 'text', html: child.outerHTML });
                }
            }
        }
    }

    walkNodes(block);

    // Convert the flat parts list into narrator / dialogue segments
    let currentNarrationHtml = '';

    for (const part of parts) {
        if (part.type === 'font') {
            // Flush accumulated narration
            const narrationText = currentNarrationHtml.trim();
            if (narrationText && stripHtml(narrationText).trim()) {
                segments.push({ type: 'narrator', speaker: null, color: null, html: narrationText });
            }
            currentNarrationHtml = '';

            // Extract dialogue segment
            const fontColor = part.node.getAttribute('color');
            const dialogueHtml = part.node.innerHTML;
            const speaker = detectSpeaker(fontColor, narrationText, block, colorMap, nameLookup);

            segments.push({
                type: 'dialogue',
                speaker: speaker,
                color: fontColor,
                html: dialogueHtml
            });
        } else {
            currentNarrationHtml += part.html;
        }
    }

    // Flush remaining narration
    const finalNarration = currentNarrationHtml.trim();
    if (finalNarration && stripHtml(finalNarration).trim()) {
        segments.push({ type: 'narrator', speaker: null, color: null, html: finalNarration });
    }

    return segments;
}

/**
 * Detect which character is speaking based on font colour and surrounding text.
 */
function detectSpeaker(fontColor, precedingText, blockElement, colorMap, nameLookup) {
    // Strategy 1: Direct colour-to-name match (most reliable)
    if (fontColor) {
        const normalised = fontColor.toLowerCase();
        if (colorMap.has(normalised)) return colorMap.get(normalised);
    }

    // Strategy 2: Search for a known character name in the preceding narration text
    const searchText = (precedingText || '').toLowerCase();
    if (searchText) {
        for (const [lower, original] of nameLookup) {
            // Word boundary check
            const re = new RegExp(`\\b${lower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
            if (re.test(searchText)) return original;
        }
    }

    // Strategy 3: Search the entire block's text for a nearby name
    const fullText = (blockElement.textContent || '').toLowerCase();
    for (const [lower, original] of nameLookup) {
        const re = new RegExp(`\\b${lower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
        if (re.test(fullText)) return original;
    }

    return null; // Unknown speaker
}

/**
 * Merge consecutive narrator segments into one so we don't get fragmented blocks.
 */
function mergeConsecutiveNarration(segments) {
    if (segments.length <= 1) return segments;
    const merged = [];
    for (const seg of segments) {
        const prev = merged[merged.length - 1];
        if (prev && prev.type === 'narrator' && seg.type === 'narrator') {
            prev.html += '<br>' + seg.html;
        } else {
            merged.push({ ...seg });
        }
    }
    return merged;
}

// ─────────────────────────────────────────────
//  Avatar HTML helper
// ─────────────────────────────────────────────

function getAvatarHtml(speakerName, prefix) {
    if (!speakerName) {
        // Narrator
        return `<div class="${prefix}-avatar-letter">\u{1F4D6}</div>`;
    }

    const portraitSrc = resolvePortrait(speakerName);
    const emoji = extensionSettings.knownCharacters?.[speakerName]?.emoji || '\u{1F464}';

    if (portraitSrc) {
        return `<img src="${escapeHtml(portraitSrc)}" alt="${escapeHtml(speakerName)}"
                     onerror="this.style.display='none';this.nextElementSibling.style.display='flex';" />
                <div class="${prefix}-avatar-letter" style="display:none;">${emoji}</div>`;
    }

    return `<div class="${prefix}-avatar-letter">${emoji}</div>`;
}

// ─────────────────────────────────────────────
//  Discord-style Renderer (Mockup 2)
// ─────────────────────────────────────────────

function renderDiscordBubbles(segments) {
    if (!segments.length) return '';
    let lastSpeaker = null;
    const cbs = extensionSettings.chatBubbleSettings || {};
    const showAvatars = cbs.showAvatars !== false;
    const showAuthorNames = cbs.showAuthorNames !== false;
    const showNarratorLabel = cbs.showNarratorLabel !== false;

    const html = segments.map((seg, index) => {
        const isNarrator = seg.type === 'narrator';
        const speaker = isNarrator ? '__narrator__' : (seg.speaker || '__unknown__');
        const displayName = isNarrator ? 'Narrator' : (seg.speaker || 'Unknown');
        const isContinuation = speaker === lastSpeaker;
        lastSpeaker = speaker;

        // Prefer the AI's font tag color (what the AI intended for this dialogue),
        // fall back to the extension's assigned color for the detected speaker
        const assignedColor = seg.speaker && getAssignedColor(seg.speaker);
        const color = seg.color || assignedColor || '';
        const borderStyle = color ? ` style="border-left-color: ${escapeHtml(color)}"` : '';
        const textStyle = color ? ` style="color: ${escapeHtml(color)}"` : '';

        const typeClass = isNarrator ? 'dooms-bubble-narrator' :
            (seg.speaker ? 'dooms-bubble-character' : 'dooms-bubble-unknown');
        const contClass = isContinuation ? 'dooms-bubble-continuation' : 'dooms-bubble-new-speaker';

        // Respect showAvatars toggle (never show for narrator or continuations)
        const avatarContent = (!showAvatars || isContinuation || isNarrator) ? '' : `
            <div class="dooms-bubble-avatar">
                ${getAvatarHtml(seg.speaker, 'dooms-bubble')}
            </div>`;

        // Respect showAuthorNames + showNarratorLabel toggles
        const showHeader = !isContinuation && showAuthorNames && (!isNarrator || showNarratorLabel);
        const headerContent = showHeader ? `
            <div class="dooms-bubble-header">
                <span class="dooms-bubble-author">${escapeHtml(displayName)}</span>
            </div>` : '';

        const textHtml = stripFontColors(seg.html);

        // Add hide-avatar class if avatars are hidden (adjusts narrator indent)
        const hideAvatarClass = !showAvatars ? ' dooms-bubble-no-avatar' : '';

        // TTS button (visible on hover)
        const ttsButton = `<button class="dooms-bubble-tts" title="Read from here"><i class="fa-solid fa-bullhorn"></i></button>`;

        return `<div class="dooms-bubble ${typeClass} ${contClass}${hideAvatarClass}" data-segment-index="${index}" data-speaker="${escapeHtml(seg.speaker || '')}"${borderStyle}>
            ${avatarContent}
            <div class="dooms-bubble-content">
                ${headerContent}
                <div class="dooms-bubble-text"${textStyle}>${textHtml}</div>
                ${ttsButton}
            </div>
        </div>`;
    }).join('');

    return `<div class="dooms-bubbles dooms-bubbles-discord">${html}</div>`;
}

function renderDiscordUserBubble(html) {
    return `<div class="dooms-bubbles dooms-bubbles-discord">
        <div class="dooms-bubble dooms-bubble-user dooms-bubble-new-speaker">
            <div class="dooms-bubble-content">
                <div class="dooms-bubble-text">${html}</div>
            </div>
        </div>
    </div>`;
}

// ─────────────────────────────────────────────
//  Card-style Renderer (Mockup 3)
// ─────────────────────────────────────────────

function renderCardBubbles(segments) {
    if (!segments.length) return '';
    const cbs = extensionSettings.chatBubbleSettings || {};
    const showAvatars = cbs.showAvatars !== false;
    const showAuthorNames = cbs.showAuthorNames !== false;
    const showNarratorLabel = cbs.showNarratorLabel !== false;

    const html = segments.map(seg => {
        const isNarrator = seg.type === 'narrator';
        const displayName = isNarrator ? 'Narrator' : (seg.speaker || 'Unknown');
        // Prefer the AI's font tag color (what the AI intended for this dialogue),
        // fall back to the extension's assigned color for the detected speaker
        const assignedColor = seg.speaker && getAssignedColor(seg.speaker);
        const color = seg.color || assignedColor || '';
        const borderStyle = color ? ` style="border-left-color: ${escapeHtml(color)}"` : '';
        const textStyle = color ? ` style="color: ${escapeHtml(color)}"` : '';
        const ringStyle = color ? ` style="background: linear-gradient(135deg, ${escapeHtml(color)}, ${escapeHtml(color)}88)"` : '';

        const typeClass = isNarrator ? 'dooms-card-narrator' :
            (seg.speaker ? 'dooms-card-character' : 'dooms-card-unknown');
        const roleLabel = isNarrator ? 'Narration' : 'Speaking';
        const roleClass = isNarrator ? 'dooms-card-role-narrator' : 'dooms-card-role-character';

        // Respect showAvatars toggle (never show for narrator)
        const avatarCol = (!showAvatars || isNarrator) ? '' : `
            <div class="dooms-card-avatar-col">
                <div class="dooms-card-avatar-ring"${ringStyle}>
                    <div class="dooms-card-avatar">
                        ${getAvatarHtml(seg.speaker, 'dooms-card')}
                    </div>
                </div>
                <span class="dooms-card-avatar-name">${escapeHtml(displayName)}</span>
            </div>`;

        // Respect showAuthorNames + showNarratorLabel toggles
        const showHeader = showAuthorNames && (!isNarrator || showNarratorLabel);
        const headerHtml = showHeader ? `
                <div class="dooms-card-header">
                    <span class="dooms-card-author">${escapeHtml(displayName)}</span>
                    <span class="dooms-card-role ${roleClass}">${roleLabel}</span>
                </div>` : '';

        return `<div class="dooms-card ${typeClass}"${borderStyle}>
            ${avatarCol}
            <div class="dooms-card-body">
                ${headerHtml}
                <div class="dooms-card-text"${textStyle}>${stripFontColors(seg.html)}</div>
            </div>
        </div>`;
    }).join('');

    return `<div class="dooms-bubbles dooms-bubbles-cards">${html}</div>`;
}

function renderCardUserBubble(html) {
    return `<div class="dooms-bubbles dooms-bubbles-cards">
        <div class="dooms-card dooms-card-user">
            <div class="dooms-card-body">
                <div class="dooms-card-text">${html}</div>
            </div>
        </div>
    </div>`;
}

// ─────────────────────────────────────────────
//  Apply / Revert
// ─────────────────────────────────────────────

/**
 * Apply chat bubble rendering to a single message element.
 */
export function applyChatBubbles(messageElement, style) {
    if (!style || style === 'off') return;

    const mesText = messageElement.querySelector('.mes_text');
    if (!mesText) return;

    const isUser = messageElement.getAttribute('is_user') === 'true';

    // Check if already processed with this style
    const currentStyle = mesText.getAttribute('data-dooms-bubbles-style');
    if (currentStyle === style) return;

    // If processed with a different style, revert first
    if (currentStyle) {
        revertSingleMessage(mesText);
    }

    // Store original HTML for clean revert
    if (!mesText.getAttribute('data-dooms-original-html')) {
        mesText.setAttribute('data-dooms-original-html', mesText.innerHTML);
    }

    mesText.setAttribute('data-dooms-bubbles-applied', 'true');
    mesText.setAttribute('data-dooms-bubbles-style', style);

    if (isUser) {
        mesText.innerHTML = style === 'discord'
            ? renderDiscordUserBubble(mesText.getAttribute('data-dooms-original-html'))
            : renderCardUserBubble(mesText.getAttribute('data-dooms-original-html'));
        return;
    }

    // Parse AI message into segments
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = mesText.getAttribute('data-dooms-original-html');
    const segments = parseMessageIntoBubbles(tempDiv);

    // Render bubbles
    const bubblesHtml = style === 'discord'
        ? renderDiscordBubbles(segments)
        : renderCardBubbles(segments);

    // Preserve inline thoughts that may have been appended
    const thoughts = mesText.querySelectorAll('.dooms-inline-thought');
    const thoughtsHtml = Array.from(thoughts).map(t => t.outerHTML).join('');

    mesText.innerHTML = bubblesHtml + thoughtsHtml;
}

/**
 * Revert a single message to its original HTML.
 */
function revertSingleMessage(mesText) {
    const original = mesText.getAttribute('data-dooms-original-html');
    if (original !== null) {
        mesText.innerHTML = original;
    }
    mesText.removeAttribute('data-dooms-bubbles-applied');
    mesText.removeAttribute('data-dooms-bubbles-style');
    mesText.removeAttribute('data-dooms-original-html');
}

/**
 * Apply bubbles to ALL messages in the chat.
 */
export function applyAllChatBubbles() {
    const style = extensionSettings.chatBubbleMode;
    if (!style || style === 'off') return;

    const messages = document.querySelectorAll('#chat .mes');
    for (const msg of messages) {
        applyChatBubbles(msg, style);
    }
}

/**
 * Revert ALL messages in the chat to original HTML.
 */
export function revertAllChatBubbles() {
    const processed = document.querySelectorAll('#chat .mes .mes_text[data-dooms-bubbles-applied]');
    for (const mesText of processed) {
        revertSingleMessage(mesText);
    }
}

/**
 * Handle the chat bubble mode setting changing.
 */
export function onChatBubbleModeChanged(oldMode, newMode) {
    if (oldMode === newMode) return;

    if (newMode === 'off') {
        revertAllChatBubbles();
    } else {
        // Revert first (in case switching between discord ↔ cards)
        revertAllChatBubbles();
        applyAllChatBubbles();
    }
}

/**
 * Apply chat bubble CSS custom properties to :root for live theming.
 * Called when chatBubbleSettings change so the CSS vars update in real-time.
 */
export function applyChatBubbleSettings() {
    const s = extensionSettings.chatBubbleSettings || {};
    const root = document.documentElement;

    // Colors
    root.style.setProperty('--cb-narrator-color', s.narratorTextColor || '#999999');
    root.style.setProperty('--cb-unknown-color', s.unknownSpeakerColor || '#aaaaaa');
    root.style.setProperty('--cb-accent', s.accentColor || '#e94560');

    // Background tint — decompose into RGB for rgba()
    const tintRgb = hexToRgb(s.backgroundTint || '#1a1a2e');
    root.style.setProperty('--cb-bg-tint-rgb', tintRgb);
    root.style.setProperty('--cb-bg-opacity', String((s.backgroundOpacity ?? 5) / 100));

    // Sizing
    root.style.setProperty('--cb-font-size', `${(s.fontSize ?? 92) / 100}em`);
    root.style.setProperty('--cb-avatar-size', `${s.avatarSize ?? 40}px`);
    root.style.setProperty('--cb-avatar-height', `${Math.round((s.avatarSize ?? 40) * 1.28)}px`);
    root.style.setProperty('--cb-border-radius', `${s.borderRadius ?? 6}px`);
    root.style.setProperty('--cb-spacing', `${s.spacing ?? 12}px`);
}

// ─────────────────────────────────────────────
//  Bubble TTS — read-from-here button
// ─────────────────────────────────────────────

/**
 * Collects text from the given bubble element through the end of the message.
 * @param {HTMLElement} bubbleEl - The .dooms-bubble element to start from
 * @returns {string} Combined text content
 */
function getTextFromBubbleForward(bubbleEl) {
    const container = bubbleEl.closest('.dooms-bubbles');
    if (!container) return '';
    const allBubbles = container.querySelectorAll('.dooms-bubble');
    const startIdx = Array.from(allBubbles).indexOf(bubbleEl);
    if (startIdx === -1) return '';

    let text = '';
    for (let i = startIdx; i < allBubbles.length; i++) {
        const textDiv = allBubbles[i].querySelector('.dooms-bubble-text');
        if (textDiv) {
            text += textDiv.textContent.trim() + '\n';
        }
    }
    return text.trim();
}

/**
 * Initializes the delegated click handler for bubble TTS buttons.
 * Should be called once during extension initialization.
 */
export function initBubbleTtsHandlers() {
    $(document).on('click', '.dooms-bubble-tts', async function (e) {
        e.preventDefault();
        e.stopPropagation();

        const bubble = $(this).closest('.dooms-bubble')[0];
        if (!bubble) return;

        const text = getTextFromBubbleForward(bubble);
        if (!text) return;

        // Determine voice: use the bubble's speaker, or fall back to the message's character
        let voice = bubble.getAttribute('data-speaker') || '';
        if (!voice) {
            const mesEl = $(bubble).closest('.mes')[0];
            if (mesEl) {
                voice = mesEl.getAttribute('ch_name') || '';
            }
        }

        // Build the /speak command
        const voiceArg = voice ? `voice="${voice}" ` : '';
        try {
            await executeSlashCommandsOnChatInput(`/speak ${voiceArg}${text}`, { quiet: true });
        } catch (err) {
            console.error('[Dooms Tracker] TTS speak failed:', err);
            toastr.info('TTS is not available. Make sure a TTS extension is enabled.', "Doom's Tracker");
        }
    });
}
