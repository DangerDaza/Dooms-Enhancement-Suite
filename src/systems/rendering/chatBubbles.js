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
import { getActiveCharacterColors, getActiveKnownCharacters } from '../../core/persistence.js';
import { resolvePortrait, resolveFullPortrait, getCharacterList } from '../ui/portraitBar.js';
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
    if (!speakerName) return null;
    const colors = getActiveCharacterColors();

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
    const colors = getActiveCharacterColors();
    for (const [name, color] of Object.entries(colors)) {
        if (color) map.set(color.toLowerCase(), name);
    }
    return map;
}

/** Build a set of known character names (lowercase → original).
 *  Also registers first-name shortcuts for multi-word names so that
 *  narration like "Sylvaine turned" matches "Sylvaine Moonwhisper". */
function buildNameLookup() {
    const map = new Map();

    function addName(name) {
        const lower = name.toLowerCase();
        if (!map.has(lower)) map.set(lower, name);
        // Add first name for multi-word names (≥ 3 chars to avoid "Mr", "Le", etc.)
        const parts = name.split(/\s+/);
        if (parts.length > 1 && parts[0].length >= 3) {
            const firstName = parts[0].toLowerCase();
            if (!map.has(firstName)) map.set(firstName, name);
        }
    }

    const chars = getCharacterList();
    for (const c of chars) {
        addName(c.name);
    }
    // Note: knownCharacters is intentionally NOT included here.
    // It contains characters from ALL chats (historically seen), which causes
    // unnamed NPCs (shopkeepers, guards, etc.) to be incorrectly attributed
    // to named characters who aren't even in the current scene.
    // getCharacterList() already returns both present and absent-but-known
    // characters for the current chat, which is the correct scope.
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
    // Track colours resolved during this message so repeated dialogue by the
    // same character is correctly attributed even when narration in between
    // doesn't mention the character's name.
    const resolvedColors = new Map();

    // Clone so we can safely manipulate
    const clone = mesText.cloneNode(true);

    // Remove inline thoughts (they live in .mes_text but aren't part of the message)
    clone.querySelectorAll('.dooms-inline-thought').forEach(el => el.remove());
    // Remove any previously applied bubble wrappers (safety)
    clone.querySelectorAll('.dooms-bubbles').forEach(el => el.remove());

    const allSegments = [];
    const blocks = getTopLevelBlocks(clone);

    for (const block of blocks) {
        const segs = parseBlockIntoSegments(block, colorMap, nameLookup, resolvedColors, allSegments);
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
function parseBlockIntoSegments(block, colorMap, nameLookup, resolvedColors, previousSegments) {
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

    // Pre-build a Set of elements that contain font[color] descendants.
    // This avoids calling child.querySelector('font[color]') inside the recursive
    // walk (O(n²) → O(n) by doing one upfront pass instead of per-child queries).
    const fontAncestors = new Set();
    for (const font of fontElements) {
        let el = font.parentElement;
        while (el && el !== block) {
            fontAncestors.add(el);
            el = el.parentElement;
        }
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
                parts.push({ type: 'font', node: child });
            } else if (child.nodeType === Node.TEXT_NODE) {
                const text = child.textContent;
                if (text) parts.push({ type: 'text', html: text });
            } else if (child.nodeType === Node.ELEMENT_NODE) {
                if (fontAncestors.has(child)) {
                    walkNodes(child);
                } else {
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
            // Combine previous message segments + segments from this block for cross-block search
            const allPrior = previousSegments ? [...previousSegments, ...segments] : segments;
            const speaker = detectSpeaker(fontColor, narrationText, block, colorMap, nameLookup, resolvedColors, allPrior);

            // Remember this colour→speaker mapping for later blocks in the same message
            if (speaker && fontColor) {
                resolvedColors.set(fontColor.toLowerCase(), speaker);
            }

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
 * Find the character name that appears closest to the END of a text string.
 * This ensures that when narration mentions multiple characters, we pick the
 * one mentioned right before the dialogue — not just whichever name happens
 * to iterate first in the Map.
 * @returns {string|null} The original character name or null
 */
function findClosestName(text, nameLookup) {
    if (!text) return null;
    const lower = text.toLowerCase();
    let bestPos = -1;
    let bestName = null;

    for (const [key, original] of nameLookup) {
        const re = new RegExp(`\\b${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
        let match;
        while ((match = re.exec(lower)) !== null) {
            if (match.index > bestPos) {
                bestPos = match.index;
                bestName = original;
            }
        }
    }
    return bestName;
}

/**
 * Detect which character is speaking based on font colour and surrounding text.
 */
function detectSpeaker(fontColor, precedingText, blockElement, colorMap, nameLookup, resolvedColors, previousSegments) {
    // Strategy 1: Direct colour-to-name match from extension settings (most reliable)
    if (fontColor) {
        const normalised = fontColor.toLowerCase();
        if (colorMap.has(normalised)) return colorMap.get(normalised);
    }

    // Strategy 2: Colour was already resolved earlier in this message
    // (same character speaking again, narration in between doesn't repeat their name)
    if (fontColor && resolvedColors) {
        const normalised = fontColor.toLowerCase();
        if (resolvedColors.has(normalised)) return resolvedColors.get(normalised);
    }

    // Strategy 3: Search for the character name closest to the END of the
    // preceding narration text (the name mentioned right before dialogue
    // is most likely the speaker, even if other characters are mentioned earlier)
    const searchText = (precedingText || '');
    if (searchText.trim()) {
        const found = findClosestName(searchText, nameLookup);
        if (found) return found;
    }

    // Strategy 4: Search the block's narration text (excluding dialogue
    // inside <font> tags) for the closest name to the end.
    // We strip font-tagged content first so that character names mentioned
    // INSIDE dialogue don't get falsely attributed as the speaker.
    const blockClone = blockElement.cloneNode(true);
    blockClone.querySelectorAll('font[color]').forEach(el => el.remove());
    const narrationOnlyText = (blockClone.textContent || '');
    const found = findClosestName(narrationOnlyText, nameLookup);
    if (found) return found;

    // Strategy 5: Search backwards through RECENT segments in this message
    // for the nearest character name mention (handles cross-block references
    // where the character is named in earlier narration but not in this block).
    // Limited to the last 3 segments to avoid distant mentions claiming
    // nearby unnamed NPC dialogue.
    if (previousSegments && previousSegments.length > 0) {
        const searchStart = Math.max(0, previousSegments.length - 3);
        for (let i = previousSegments.length - 1; i >= searchStart; i--) {
            const segText = stripHtml(previousSegments[i].html);
            const segFound = findClosestName(segText, nameLookup);
            if (segFound) return segFound;
        }
    }

    // Strategy 6: Only one character is in the scene — it must be them
    // (falls through to null if multiple characters or none)
    if (nameLookup.size === 1) {
        const [, name] = nameLookup.entries().next().value;
        return name;
    }

    return null; // Unknown speaker
}

/**
 * Merge consecutive narrator segments into one so we don't get fragmented blocks.
 */
/**
 * Merge consecutive narrator segments, but only within the same paragraph.
 * Short fragments (single <br>-separated lines from the same block) get merged,
 * but separate paragraphs (<p>/<div> blocks) stay as individual bubbles.
 * This prevents giant walls of narration text in a single bubble.
 */
function mergeConsecutiveNarration(segments) {
    // Don't merge — each paragraph from the parser stays as its own bubble.
    // This gives visual breathing room to long narration passages.
    return segments;
}

// ─────────────────────────────────────────────
//  Avatar HTML helper
// ─────────────────────────────────────────────

function getAvatarHtml(speakerName, prefix) {
    if (!speakerName) {
        // Narrator
        return `<div class="${prefix}-avatar-letter">\u{1F4D6}</div>`;
    }

    // Use resolvePortrait (cropped npcAvatars / ST thumbnails) instead of
    // resolveFullPortrait (raw character card images) — the cropped versions
    // are portrait-oriented and look much better in small bubble avatars.
    const portraitSrc = resolvePortrait(speakerName);
    const emoji = getActiveKnownCharacters()[speakerName]?.emoji || '\u{1F464}';

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
    const noAvatarsClass = showAvatars ? '' : ' dooms-bubbles--no-avatars';

    const html = segments.map((seg, index) => {
        const isNarrator = seg.type === 'narrator';
        const speaker = isNarrator ? '__narrator__' : (seg.speaker || '__unknown__');
        const displayName = isNarrator ? 'Narrator' : (seg.speaker || 'Unknown');
        const isContinuation = speaker === lastSpeaker;
        lastSpeaker = speaker;

        const assignedColor = seg.speaker && getAssignedColor(seg.speaker);
        const color = seg.color || assignedColor || '';
        const borderStyle = color ? ` style="border-left-color: ${escapeHtml(color)}"` : '';
        const textStyle = color ? ` style="color: ${escapeHtml(color)}"` : '';

        const typeClass = isNarrator ? 'dooms-bubble-narrator' :
            (seg.speaker ? 'dooms-bubble-character' : 'dooms-bubble-unknown');
        const contClass = isContinuation ? 'dooms-bubble-continuation' : 'dooms-bubble-new-speaker';

        // Inline avatar: new-speaker dialogue gets avatar, continuation gets spacer, narrator gets nothing
        let avatarContent = '';
        if (!isNarrator && !isContinuation && seg.speaker) {
            avatarContent = `<div class="dooms-bubble-avatar">${getAvatarHtml(seg.speaker, 'dooms-bubble')}</div>`;
        } else if (!isNarrator && isContinuation) {
            avatarContent = '<div class="dooms-bubble-avatar-spacer"></div>';
        }

        const showHeader = !isContinuation && showAuthorNames && (!isNarrator || showNarratorLabel);
        const headerContent = showHeader ? `
            <div class="dooms-bubble-header">
                <span class="dooms-bubble-author">${escapeHtml(displayName)}</span>
            </div>` : '';

        const textHtml = stripFontColors(seg.html);
        const ttsButton = `<button class="dooms-bubble-tts" title="Read from here"><i class="fa-solid fa-bullhorn"></i></button>`;

        return `<div class="dooms-bubble ${typeClass} ${contClass}" data-segment-index="${index}" data-speaker="${escapeHtml(seg.speaker || '')}"${borderStyle}>
            ${avatarContent}
            <div class="dooms-bubble-content">
                ${headerContent}
                <div class="dooms-bubble-text"${textStyle}>${textHtml}</div>
                ${ttsButton}
            </div>
        </div>`;
    }).join('');

    return `<div class="dooms-bubbles dooms-bubbles-discord${noAvatarsClass}">${html}</div>`;
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
    let lastSpeaker = null;
    const cbs = extensionSettings.chatBubbleSettings || {};
    const showAvatars = cbs.showAvatars !== false;
    const showAuthorNames = cbs.showAuthorNames !== false;
    const showNarratorLabel = cbs.showNarratorLabel !== false;
    const noAvatarsClass = showAvatars ? '' : ' dooms-bubbles--no-avatars';

    const html = segments.map((seg, index) => {
        const isNarrator = seg.type === 'narrator';
        const speaker = isNarrator ? '__narrator__' : (seg.speaker || '__unknown__');
        const displayName = isNarrator ? 'Narrator' : (seg.speaker || 'Unknown');
        const isContinuation = speaker === lastSpeaker;
        lastSpeaker = speaker;

        const assignedColor = seg.speaker && getAssignedColor(seg.speaker);
        const color = seg.color || assignedColor || '';
        const borderStyle = color ? ` style="border-left-color: ${escapeHtml(color)}"` : '';
        const textStyle = color ? ` style="color: ${escapeHtml(color)}"` : '';
        const typeClass = isNarrator ? 'dooms-card-narrator' :
            (seg.speaker ? 'dooms-card-character' : 'dooms-card-unknown');
        const contClass = isContinuation ? 'dooms-card-continuation' : 'dooms-card-new-speaker';
        const roleLabel = isNarrator ? 'Narration' : 'Speaking';
        const roleClass = isNarrator ? 'dooms-card-role-narrator' : 'dooms-card-role-character';

        // Inline avatar: new-speaker gets avatar, continuation gets spacer, narrator gets nothing
        let avatarContent = '';
        if (!isNarrator && !isContinuation && seg.speaker) {
            avatarContent = `<div class="dooms-card-avatar">${getAvatarHtml(seg.speaker, 'dooms-card')}</div>`;
        } else if (!isNarrator && isContinuation) {
            avatarContent = '<div class="dooms-card-avatar-spacer"></div>';
        }

        // Only show header on new speaker, same as discord
        const showHeader = !isContinuation && showAuthorNames && (!isNarrator || showNarratorLabel);
        const roleBadge = !isNarrator ? `<span class="dooms-card-role ${roleClass}">${roleLabel}</span>` : '';
        const headerHtml = showHeader ? `
                <div class="dooms-card-header">
                    <span class="dooms-card-author">${escapeHtml(displayName)}</span>
                    ${roleBadge}
                </div>` : '';

        const ttsButton = `<button class="dooms-bubble-tts" title="Read from here"><i class="fa-solid fa-bullhorn"></i></button>`;

        return `<div class="dooms-card ${typeClass} ${contClass}" data-segment-index="${index}" data-speaker="${escapeHtml(seg.speaker || '')}"${borderStyle}>
            ${avatarContent}
            <div class="dooms-card-body">
                ${headerHtml}
                <div class="dooms-card-text"${textStyle}>${stripFontColors(seg.html)}</div>
                ${ttsButton}
            </div>
        </div>`;
    }).join('');

    return `<div class="dooms-bubbles dooms-bubbles-cards${noAvatarsClass}">${html}</div>`;
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

    // Clone the original HTML to work with
    const tempContainer = document.createElement('div');
    tempContainer.innerHTML = mesText.getAttribute('data-dooms-original-html');

    const cbs = extensionSettings.chatBubbleSettings || {};
    const skipStyledDivs = cbs.skipStyledDivs !== false;

    const childNodes = Array.from(tempContainer.childNodes);
    const hasGfxMarkers = childNodes.some(node =>
        node.nodeType === Node.COMMENT_NODE &&
        /\bGFX_START\b/i.test(node.nodeValue || '')
    );

    // Split HTML into "html" and "gfx" parts.
    // Primary signal: explicit <!-- GFX_START --> ... <!-- GFX_END --> markers.
    // Fallback signal: style heuristic for presets that don't emit markers.
    const parts = [];
    const serializeNodes = (nodes) => {
        const wrapper = document.createElement('div');
        for (const node of nodes) {
            wrapper.appendChild(node.cloneNode(true));
        }
        return wrapper.innerHTML;
    };

    if (hasGfxMarkers) {

        let inGfxBlock = false;
        let pendingNodes = [];
        let gfxNodes = [];

        const flushPending = () => {
            if (pendingNodes.length === 0) return;
            const html = serializeNodes(pendingNodes);
            if (html.trim()) {
                parts.push({ type: 'html', content: html });
            }
            pendingNodes = [];
        };

        const flushGfx = () => {
            if (gfxNodes.length === 0) return;
            const html = serializeNodes(gfxNodes);
            if (html.trim()) {
                parts.push({ type: 'gfx', content: html });
            }
            gfxNodes = [];
        };

        for (const node of childNodes) {
            if (node.nodeType === Node.COMMENT_NODE) {
                const comment = node.nodeValue || '';

                if (/\bGFX_START\b/i.test(comment)) {
                    flushPending();
                    inGfxBlock = true;
                    continue;
                }

                if (/\bGFX_END\b/i.test(comment)) {
                    flushGfx();
                    inGfxBlock = false;
                    continue;
                }
            }

            if (inGfxBlock) {
                gfxNodes.push(node);
            } else {
                pendingNodes.push(node);
            }
        }

        // Gracefully handle malformed input where GFX_END is missing.
        if (inGfxBlock) {
            flushGfx();
        }
        flushPending();
    } else if (skipStyledDivs) {
        // Fallback: detect likely GFX divs by inline style patterns.
        const gfxDivs = Array.from(tempContainer.querySelectorAll('div[style*="background"], div[style*="border"], div[style*="padding"]')).filter(div => {
            const style = div.getAttribute('style') || '';
            return (style.includes('background') || style.includes('color')) &&
                (style.includes('padding') || style.includes('border') || style.includes('margin'));
        });

        // If no GFX blocks found, process normally
        if (gfxDivs.length === 0) {
            const segments = parseMessageIntoBubbles(tempContainer);

            const bubblesHtml = style === 'discord'
                ? renderDiscordBubbles(segments)
                : renderCardBubbles(segments);

            const thoughts = mesText.querySelectorAll('.dooms-inline-thought');
            const thoughtsHtml = Array.from(thoughts).map(t => t.outerHTML).join('');

            mesText.innerHTML = bubblesHtml + thoughtsHtml;
            return;
        }

        // Walk top-level child nodes so duplicate GFX div HTML is handled correctly.
        const gfxDivSet = new Set(gfxDivs);
        let pendingNodes = [];

        const flushPending = () => {
            if (pendingNodes.length === 0) return;
            const html = serializeNodes(pendingNodes);
            if (html.trim()) {
                parts.push({ type: 'html', content: html });
            }
            pendingNodes = [];
        };

        for (const child of childNodes) {
            if (gfxDivSet.has(child)) {
                flushPending();
                parts.push({ type: 'gfx', content: child.outerHTML });
            } else {
                pendingNodes.push(child);
            }
        }
        flushPending();
    } else {
        const segments = parseMessageIntoBubbles(tempContainer);

        const bubblesHtml = style === 'discord'
            ? renderDiscordBubbles(segments)
            : renderCardBubbles(segments);

        const thoughts = mesText.querySelectorAll('.dooms-inline-thought');
        const thoughtsHtml = Array.from(thoughts).map(t => t.outerHTML).join('');

        mesText.innerHTML = bubblesHtml + thoughtsHtml;
        return;
    }

    // Process each part
    const finalParts = [];

    for (const part of parts) {
        if (part.type === 'gfx') {
            // GFX block: render as-is with NO bubble wrapper
            finalParts.push(part.content);
        } else {
            // HTML section: apply bubbles
            const div = document.createElement('div');
            div.innerHTML = part.content;
            const segments = parseMessageIntoBubbles(div);

            const bubblesHtml = style === 'discord'
                ? renderDiscordBubbles(segments)
                : renderCardBubbles(segments);

            finalParts.push(bubblesHtml);
        }
    }

    // Combine all parts
    let finalHtml = finalParts.join('');

    // Preserve inline thoughts
    const thoughts = mesText.querySelectorAll('.dooms-inline-thought');
    const thoughtsHtml = Array.from(thoughts).map(t => t.outerHTML).join('');

    mesText.innerHTML = finalHtml + thoughtsHtml;
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
 * Shared IntersectionObserver for lazy chat-bubble application.
 * Created once, reused across calls to applyAllChatBubbles().
 * @type {IntersectionObserver|null}
 */
let _bubbleObserver = null;

/**
 * Disconnect and discard the current bubble observer (if any).
 * Called when bubbles are reverted or on chat change before re-observing.
 */
function _teardownBubbleObserver() {
    if (_bubbleObserver) {
        _bubbleObserver.disconnect();
        _bubbleObserver = null;
    }
}

/**
 * Apply bubbles to ALL messages in the chat.
 *
 * Visible messages are processed immediately; off-screen messages are
 * deferred via an IntersectionObserver so the main thread isn't blocked
 * on large chats (perf fix).
 */
export function applyAllChatBubbles() {
    const style = extensionSettings.chatBubbleMode;
    if (!style || style === 'off') return;

    // Tear down any prior observer so we don't double-process
    _teardownBubbleObserver();

    const chatContainer = document.querySelector('#chat');
    if (!chatContainer) return;

    const messages = chatContainer.querySelectorAll('.mes');
    if (messages.length === 0) return;

    // Defer to next animation frame so we don't block the triggering event
    requestAnimationFrame(() => {
        const viewTop = 0;
        const viewBottom = window.innerHeight;

        const deferred = [];

        for (const msg of messages) {
            const rect = msg.getBoundingClientRect();
            // Visible (with generous margin) — apply now
            if (rect.bottom >= viewTop - 200 && rect.top <= viewBottom + 200) {
                applyChatBubbles(msg, style);
            } else {
                deferred.push(msg);
            }
        }

        // Lazy-apply to off-screen messages as they scroll into view
        if (deferred.length > 0) {
            _bubbleObserver = new IntersectionObserver((entries, obs) => {
                const currentStyle = extensionSettings.chatBubbleMode;
                if (!currentStyle || currentStyle === 'off') {
                    obs.disconnect();
                    return;
                }
                for (const entry of entries) {
                    if (entry.isIntersecting) {
                        applyChatBubbles(entry.target, currentStyle);
                        obs.unobserve(entry.target);
                    }
                }
            }, { rootMargin: '300px 0px' });

            for (const msg of deferred) {
                _bubbleObserver.observe(msg);
            }
        }
    }); // end requestAnimationFrame
}

/**
 * Revert the last AI message's bubbles back to original HTML.
 * Must be called BEFORE SillyTavern starts a Continue/generation so it
 * reads clean HTML instead of bubble-wrapped DOM with stripped font tags.
 */
export function revertLastMessageBubbles() {
    const lastMes = document.querySelector('#chat .mes:last-child');
    if (!lastMes) return;
    const mesText = lastMes.querySelector('.mes_text[data-dooms-bubbles-applied]');
    if (mesText) {
        revertSingleMessage(mesText);
    }
}

/**
 * Revert ALL messages in the chat to original HTML.
 */
export function revertAllChatBubbles() {
    // Stop observing any pending off-screen messages
    _teardownBubbleObserver();
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
 * Update avatar images in existing chat bubbles without a full re-render.
 * Called when expression portraits change so bubble avatars stay in sync.
 */
export function refreshBubbleAvatars() {
    const avatars = document.querySelectorAll('.dooms-bubble-avatar img, .dooms-card-avatar img');
    for (const img of avatars) {
        const bubble = img.closest('[data-speaker]');
        if (!bubble) continue;
        const speaker = bubble.getAttribute('data-speaker');
        if (!speaker) continue;
        const newSrc = resolvePortrait(speaker);
        if (newSrc && img.src !== newSrc) {
            img.src = newSrc;
        }
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
    root.style.setProperty('--cb-narrator-font-style', (s.narratorItalic !== false) ? 'italic' : 'normal');

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
    const allBubbles = container.querySelectorAll('.dooms-bubble, .dooms-card');
    const startIdx = Array.from(allBubbles).indexOf(bubbleEl);
    if (startIdx === -1) return '';

    let text = '';
    for (let i = startIdx; i < allBubbles.length; i++) {
        const textDiv = allBubbles[i].querySelector('.dooms-bubble-text, .dooms-card-text');
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

        const bubble = $(this).closest('.dooms-bubble, .dooms-card')[0];
        if (!bubble) return;

        const text = getTextFromBubbleForward(bubble);
        if (!text) return;

        const mesEl = $(bubble).closest('.mes')[0];

        // Add .tts-speaking class to the parent .mes so the TTS highlight system
        // can find the correct message via _findCurrentTtsMessage()
        if (mesEl) {
            // Remove from any other message first
            document.querySelectorAll('#chat .mes.dooms-bubble-tts-speaking').forEach(el => {
                el.classList.remove('dooms-bubble-tts-speaking');
                el.classList.remove('tts-speaking');
            });
            mesEl.classList.add('tts-speaking');
            mesEl.classList.add('dooms-bubble-tts-speaking');
        }

        // Use /speak without voice arg — SillyTavern's TTS will look up the voice
        // internally from its own voice map. Passing voice= causes errors when the
        // speaker name doesn't have a mapped voice in the TTS extension settings.
        try {
            await executeSlashCommandsOnChatInput(`/speak ${text}`, { quiet: true });
        } catch (err) {
            console.error('[Dooms Tracker] TTS speak failed:', err);
            toastr.info('TTS is not available. Make sure a TTS extension is enabled.', "Doom's Tracker");
        }
    });

    // ── Inline thought TTS button ──
    // Reads only the thought text for the clicked character — stops after that thought.
    $(document).on('click', '.dooms-thought-tts', async function (e) {
        e.preventDefault();
        e.stopPropagation(); // Prevent the <summary> click from toggling the <details>

        const $thought = $(this).closest('.dooms-inline-thought');
        if (!$thought.length) return;

        const text = $thought.find('.dooms-inline-thought-content').text().trim();
        if (!text) return;

        const mesEl = $(this).closest('.mes')[0];
        if (mesEl) {
            document.querySelectorAll('#chat .mes.dooms-bubble-tts-speaking').forEach(el => {
                el.classList.remove('dooms-bubble-tts-speaking');
                el.classList.remove('tts-speaking');
            });
            mesEl.classList.add('tts-speaking');
            mesEl.classList.add('dooms-bubble-tts-speaking');
        }

        try {
            await executeSlashCommandsOnChatInput(`/speak ${text}`, { quiet: true });
        } catch (err) {
            console.error('[Dooms Tracker] Thought TTS failed:', err);
            toastr.info('TTS is not available. Make sure a TTS extension is enabled.', "Doom's Tracker");
        }
    });

    // ── Reasoning / thinking panel TTS button ──
    // Reads the AI's reasoning/thinking text aloud.
    $(document).on('click', '.dooms-reasoning-tts', async function (e) {
        e.preventDefault();
        e.stopPropagation();

        const $details = $(this).closest('.mes_reasoning_details');
        if (!$details.length) return;

        const text = $details.find('.mes_reasoning').text().trim();
        if (!text) return;

        const mesEl = $(this).closest('.mes')[0];
        if (mesEl) {
            document.querySelectorAll('#chat .mes.dooms-bubble-tts-speaking').forEach(el => {
                el.classList.remove('dooms-bubble-tts-speaking');
                el.classList.remove('tts-speaking');
            });
            mesEl.classList.add('tts-speaking');
            mesEl.classList.add('dooms-bubble-tts-speaking');
        }

        try {
            await executeSlashCommandsOnChatInput(`/speak ${text}`, { quiet: true });
        } catch (err) {
            console.error('[Dooms Tracker] Reasoning TTS failed:', err);
            toastr.info('TTS is not available. Make sure a TTS extension is enabled.', "Doom's Tracker");
        }
    });
}

/**
 * Injects a TTS button into reasoning/thinking panel action bars.
 * Safe to call multiple times — skips panels that already have the button.
 *
 * @param {HTMLElement|Document} [scope=document] - Scope to search within (a .mes element or document)
 */
export function injectReasoningTtsButtons(scope = document) {
    const actionBars = scope.querySelectorAll('.mes_reasoning_actions');
    for (const bar of actionBars) {
        // Skip if already injected
        if (bar.querySelector('.dooms-reasoning-tts')) continue;

        const btn = document.createElement('div');
        btn.className = 'dooms-reasoning-tts mes_button fa-solid fa-bullhorn';
        btn.title = 'Read thinking aloud';

        // Insert before the edit (pencil) button so order is: … copy → tts → edit
        const editBtn = bar.querySelector('.mes_reasoning_edit');
        if (editBtn) {
            bar.insertBefore(btn, editBtn);
        } else {
            bar.appendChild(btn);
        }
    }
}
