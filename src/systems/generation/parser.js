/**
 * Parser Module
 * Handles parsing of AI responses to extract tracker data
 * Supports both legacy text format and new v3 JSON format
 */
import { extensionSettings, addDebugLog } from '../../core/state.js';
import { saveSettings } from '../../core/persistence.js';
import { repairJSON } from '../../utils/jsonRepair.js';
// NOTE: FEATURE_FLAGS, extractInventory, separateEmojiFromText imports removed — userStats system archived
/**
 * Extracts the base name (before parentheses) and converts to snake_case for use as JSON key.
 * Example: "Conditions (up to 5 traits)" -> "conditions"
 * @param {string} name - Field name, possibly with parenthetical description
 * @returns {string} snake_case key from the base name only
 */
function toFieldKey(name) {
    const baseName = name.replace(/\s*\(.*\)\s*$/, '').trim();
    return baseName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');
}
/**
 * Helper to strip enclosing brackets from text and remove placeholder brackets
 * Removes [], {}, and () from the entire text if it's wrapped, plus removes
 * placeholder content like [Location], [Mood Emoji], etc.
 * @param {string} text - Text that may contain brackets
 * @returns {string} Text with brackets and placeholders removed
 */
function stripBrackets(text) {
    if (!text) return text;
    // Remove leading and trailing whitespace first
    text = text.trim();
    // Check if the entire text is wrapped in brackets and remove them
    // This handles cases where models wrap entire sections in brackets
    while (
        (text.startsWith('[') && text.endsWith(']')) ||
        (text.startsWith('{') && text.endsWith('}')) ||
        (text.startsWith('(') && text.endsWith(')'))
    ) {
        text = text.substring(1, text.length - 1).trim();
    }
    // Remove placeholder text patterns like [Location], [Mood Emoji], [Name], etc.
    // Pattern matches: [anything with letters/spaces inside]
    // This preserves actual content while removing template placeholders
    const placeholderPattern = /\[([A-Za-z\s\/]+)\]/g;
    // Check if a bracketed text looks like a placeholder vs real content
    const isPlaceholder = (match, content) => {
        // Common placeholder words to detect
        const placeholderKeywords = [
            'location', 'mood', 'emoji', 'name', 'description', 'placeholder',
            'time', 'date', 'weather', 'temperature', 'action', 'appearance',
            'skill', 'quest', 'item', 'character', 'field', 'value', 'details',
            'relationship', 'thoughts', 'stat', 'status', 'lover', 'friend',
            'enemy', 'neutral', 'weekday', 'month', 'year', 'forecast'
        ];
        const lowerContent = content.toLowerCase().trim();
        // If it contains common placeholder keywords, it's likely a placeholder
        if (placeholderKeywords.some(keyword => lowerContent.includes(keyword))) {
            return true;
        }
        // If it's a short generic phrase (1-3 words) with only letters/spaces, might be placeholder
        const wordCount = content.trim().split(/\s+/).length;
        if (wordCount <= 3 && /^[A-Za-z\s\/]+$/.test(content)) {
            return true;
        }
        return false;
    };
    // Replace placeholders with empty string, keep real content
    text = text.replace(placeholderPattern, (match, content) => {
        if (isPlaceholder(match, content)) {
            return ''; // Remove placeholder
        }
        return match; // Keep real bracketed content
    });
    // Clean up any resulting empty labels (e.g., "Status: " with nothing after)
    text = text.replace(/^([A-Za-z\s]+):\s*$/gm, ''); // Remove lines that are just "Label: " with nothing
    text = text.replace(/^([A-Za-z\s]+):\s*,/gm, '$1:'); // Fix "Label: ," patterns
    text = text.replace(/:\s*\|/g, ':'); // Fix ": |" patterns
    text = text.replace(/\|\s*\|/g, '|'); // Fix "| |" patterns (double pipes from removed content)
    text = text.replace(/\|\s*$/gm, ''); // Remove trailing pipes at end of lines
    // Clean up multiple spaces and empty lines
    text = text.replace(/\s{2,}/g, ' '); // Multiple spaces to single space
    text = text.replace(/^\s*\n/gm, ''); // Remove empty lines
    return text.trim();
}
/**
 * Helper to log to both console and debug logs array
 */
function debugLog(message, data = null) {
    if (extensionSettings.debugMode) {
        addDebugLog(message, data);
    }
}
/**
 * Parses the model response to extract the different data sections.
 * Extracts tracker data from markdown code blocks in the AI response.
 * Handles both separate code blocks and combined code blocks gracefully.
 *
 * @param {string} responseText - The raw AI response text
 * @returns {{userStats: string|null, infoBox: string|null, characterThoughts: string|null}} Parsed tracker data
 */
export function parseResponse(responseText) {
    const result = {
        quests: null,
        infoBox: null,
        characterThoughts: null
    };
    // DEBUG: Log full response for troubleshooting
    debugLog('[RPG Parser] ==================== PARSING AI RESPONSE ====================');
    debugLog('[RPG Parser] Response length:', responseText.length + ' chars');
    debugLog('[RPG Parser] First 500 chars:', responseText.substring(0, 500));
    // Remove content inside thinking tags first (model's internal reasoning)
    // This prevents parsing code blocks from the model's thinking process
    let cleanedResponse = responseText.replace(/<think>[\s\S]*?<\/think>/gi, '');
    cleanedResponse = cleanedResponse.replace(/<thinking>[\s\S]*?<\/thinking>/gi, '');
    debugLog('[RPG Parser] Removed thinking tags, new length:', cleanedResponse.length + ' chars');
    // Remove "FORMAT:" markers that the model might accidentally output
    cleanedResponse = cleanedResponse.replace(/FORMAT:\s*/gi, '');
    debugLog('[RPG Parser] Removed FORMAT: markers, new length:', cleanedResponse.length + ' chars');
    // First, try to extract raw JSON objects (v3 format)
    // Note: Prompts now instruct models to use ```json``` code blocks, but we extract
    // from any JSON found using brace-matching for maximum compatibility
    // Use brace-matching to find complete JSON objects
    const extractedObjects = [];
    let i = 0;
    while (i < cleanedResponse.length) {
        if (cleanedResponse[i] === '{') {
            // Found opening brace, find matching closing brace
            let depth = 1;
            let j = i + 1;
            let inString = false;
            let escapeNext = false;
            while (j < cleanedResponse.length && depth > 0) {
                const char = cleanedResponse[j];
                if (escapeNext) {
                    escapeNext = false;
                } else if (char === '\\') {
                    escapeNext = true;
                } else if (char === '"') {
                    inString = !inString;
                } else if (!inString) {
                    if (char === '{') depth++;
                    else if (char === '}') depth--;
                }
                j++;
            }
            if (depth === 0) {
                // Found complete JSON object
                const jsonContent = cleanedResponse.substring(i, j).trim();
                if (jsonContent) {
                    extractedObjects.push(jsonContent);
                }
                i = j;
            } else {
                i++;
            }
        } else {
            i++;
        }
    }
    if (extractedObjects.length > 0) {
        debugLog(`[RPG Parser] ✓ Found ${extractedObjects.length} raw JSON objects (v3 format)`);
        // First, try to parse as unified JSON structure (new v3.1 format)
        if (extractedObjects.length === 1) {
            const parsed = repairJSON(extractedObjects[0]);
            if (parsed && (parsed.quests || parsed.infoBox || parsed.characters)) {
                if (parsed.quests) {
                    result.quests = JSON.stringify(parsed.quests);
                }
                if (parsed.infoBox) {
                    result.infoBox = JSON.stringify(parsed.infoBox);
                }
                if (parsed.characters) {
                    result.characterThoughts = JSON.stringify(parsed.characters);
                }
                if (result.quests || result.infoBox || result.characterThoughts) {
                    debugLog('[RPG Parser] Returning unified JSON parse results');
                    return result;
                }
            }
        }
        // Fall back to parsing multiple separate JSON objects (legacy v3.0 format)
        for (let idx = 0; idx < extractedObjects.length; idx++) {
            const jsonContent = extractedObjects[idx];
            const parsed = repairJSON(jsonContent);
            if (parsed) {
                // Check if object is wrapped (e.g., {"quests": {...}})
                // Unwrap single-key objects that match our tracker types
                let unwrapped = parsed;
                if (Object.keys(parsed).length === 1) {
                    const key = Object.keys(parsed)[0];
                    if (key === 'quests' || key === 'infoBox' || key === 'characters') {
                        unwrapped = parsed[key];
                    }
                }
                // Detect tracker type by checking for top-level fields
                if (unwrapped.main !== undefined || unwrapped.optional !== undefined) {
                    result.quests = jsonContent;
                    debugLog('[RPG Parser] ✓ Extracted raw JSON Quests');
                } else if (unwrapped.date || unwrapped.location || unwrapped.weather || unwrapped.temperature || unwrapped.time) {
                    result.infoBox = jsonContent;
                    debugLog('[RPG Parser] ✓ Extracted raw JSON Info Box');
                } else if (unwrapped.characters || Array.isArray(unwrapped)) {
                    result.characterThoughts = jsonContent;
                    debugLog('[RPG Parser] ✓ Extracted raw JSON Characters');
                } else {
                    console.warn('[RPG Parser] ⚠️ Could not categorize object with keys:', Object.keys(parsed));
                }
            } else {
                console.error('[RPG Parser] ✗ Failed to parse raw JSON object', idx + 1);
            }
        }
        if (result.quests || result.infoBox || result.characterThoughts) {
            debugLog('[RPG Parser] Returning raw JSON parse results');
            return result;
        } else {
            console.warn('[RPG Parser] ⚠️ No tracker data extracted from', extractedObjects.length, 'objects');
        }
    }
    // Check for JSON code blocks (legacy v3 format with ```json fences)
    // Look for ```json code blocks which indicate JSON format
    const jsonBlockRegex = /```json\s*\n([\s\S]*?)```/g;
    const jsonMatches = [...cleanedResponse.matchAll(jsonBlockRegex)];
    if (jsonMatches.length > 0) {
        debugLog('[RPG Parser] ✓ Found JSON code blocks (v3 format), parsing as JSON');
        for (let idx = 0; idx < jsonMatches.length; idx++) {
            const match = jsonMatches[idx];
            const jsonContent = match[1].trim();
            if (!jsonContent) continue;
            const parsed = repairJSON(jsonContent);
            if (parsed) {
                // Detect tracker type by checking for top-level fields
                if (parsed.main !== undefined || parsed.optional !== undefined) {
                    result.quests = jsonContent;
                    debugLog('[RPG Parser] ✓ Extracted JSON Quests');
                } else if (parsed.date || parsed.location || parsed.weather || parsed.temperature || parsed.time) {
                    result.infoBox = jsonContent;
                    debugLog('[RPG Parser] ✓ Extracted JSON Info Box');
                } else if (parsed.characters || Array.isArray(parsed)) {
                    result.characterThoughts = jsonContent;
                    debugLog('[RPG Parser] ✓ Extracted JSON Characters');
                } else {
                    console.warn('[RPG Parser] ⚠️ Could not categorize JSON block with keys:', Object.keys(parsed));
                }
            } else {
                console.error('[RPG Parser] ✗ Failed to parse JSON code block', idx + 1);
                debugLog('[RPG Parser] ✗ Failed to parse JSON block, will try text fallback');
            }
        }
        // If we found at least one valid JSON block, return the result
        // Mixed formats (some JSON, some text) will still work
        if (result.quests || result.infoBox || result.characterThoughts) {
            debugLog('[RPG Parser] Returning JSON parse results');
            return result;
        } else {
            console.warn('[RPG Parser] ⚠️ No tracker data extracted from', jsonMatches.length, 'JSON blocks');
        }
    }
    // Check if response uses XML <trackers> tags (hybrid format)
    const xmlMatch = cleanedResponse.match(/<trackers>([\s\S]*?)<\/trackers>/i);
    if (xmlMatch) {
        debugLog('[RPG Parser] ✓ Found XML <trackers> tags, using XML parser');
        const trackersContent = xmlMatch[1].trim();
        // Try to parse JSON blocks within XML first
        const xmlJsonMatches = [...trackersContent.matchAll(jsonBlockRegex)];
        if (xmlJsonMatches.length > 0) {
            debugLog('[RPG Parser] Found JSON blocks within XML tags');
            for (const match of xmlJsonMatches) {
                const jsonContent = match[1].trim();
                if (!jsonContent) continue;
                const parsed = repairJSON(jsonContent);
                if (parsed) {
                    if (parsed.type === 'quests' || parsed.main !== undefined || parsed.optional !== undefined) {
                        result.quests = jsonContent;
                    } else if (parsed.type === 'infoBox' || parsed.date || parsed.location) {
                        result.infoBox = jsonContent;
                    } else if (parsed.type === 'characters' || parsed.characters || Array.isArray(parsed)) {
                        result.characterThoughts = jsonContent;
                    }
                }
            }
        } else {
            // Fallback to text extraction from XML content (legacy v2 text format)
            // NOTE: Stats text format parsing removed — userStats system archived
            const infoBoxMatch = trackersContent.match(/Info Box\s*\n\s*---[\s\S]*?(?=\n\s*\n\s*Present Characters|$)/i);
            if (infoBoxMatch) {
                result.infoBox = stripBrackets(infoBoxMatch[0].trim());
                debugLog('[RPG Parser] ✓ Extracted Info Box from XML (text format)');
            }
            const charactersMatch = trackersContent.match(/Present Characters\s*\n\s*---[\s\S]*$/i);
            if (charactersMatch) {
                result.characterThoughts = stripBrackets(charactersMatch[0].trim());
                debugLog('[RPG Parser] ✓ Extracted Present Characters from XML (text format)');
            }
        }
        debugLog('[RPG Parser] Parsed from XML:', result);
        return result;
    }
    // Fallback to markdown code block parsing (old text format or mixed format)
    debugLog('[RPG Parser] No XML tags found, using code block parser');
    // Extract code blocks
    const codeBlockRegex = /```([^`]+)```/g;
    const matches = [...cleanedResponse.matchAll(codeBlockRegex)];
    debugLog('[RPG Parser] Found', matches.length + ' code blocks');
    for (let i = 0; i < matches.length; i++) {
        const match = matches[i];
        const content = match[1].trim();
        debugLog(`[RPG Parser] --- Code Block ${i + 1} ---`);
        debugLog('[RPG Parser] First 300 chars:', content.substring(0, 300));
        // Check if this is a combined code block with multiple sections
        const hasMultipleSections = (
            (content.match(/Info Box\s*\n\s*---/i) && content.match(/Present Characters\s*\n\s*---/i))
        );
        if (hasMultipleSections) {
            // Split the combined code block into individual sections
            debugLog('[RPG Parser] ✓ Found combined code block with multiple sections');
            // NOTE: Stats text parsing removed — userStats system archived
            // Extract Info Box section
            const infoBoxMatch = content.match(/Info Box\s*\n\s*---[\s\S]*?(?=\n\s*\n\s*Present Characters|$)/i);
            if (infoBoxMatch && !result.infoBox) {
                result.infoBox = stripBrackets(infoBoxMatch[0].trim());
                debugLog('[RPG Parser] ✓ Extracted Info Box from combined block');
            }
            // Extract Present Characters section
            const charactersMatch = content.match(/Present Characters\s*\n\s*---[\s\S]*$/i);
            if (charactersMatch && !result.characterThoughts) {
                result.characterThoughts = stripBrackets(charactersMatch[0].trim());
                debugLog('[RPG Parser] ✓ Extracted Present Characters from combined block');
            }
        } else {
            // Handle separate code blocks with flexible pattern matching
            // Match Info Box section - flexible patterns
            const isInfoBox =
                content.match(/Info Box\s*\n\s*---/i) ||
                content.match(/Scene Info\s*\n\s*---/i) ||
                content.match(/Information\s*\n\s*---/i) ||
                // Fallback: look for info box keywords
                (content.match(/Date:/i) && content.match(/Location:/i) && content.match(/Time:/i));
            // Match Present Characters section - flexible patterns
            const isCharacters =
                content.match(/Present Characters\s*\n\s*---/i) ||
                content.match(/Characters\s*\n\s*---/i) ||
                content.match(/Character Thoughts\s*\n\s*---/i) ||
                // Fallback: look for new multi-line format patterns
                (content.match(/^-\s+\w+/m) && content.match(/Details:/i));
            if (isInfoBox && !result.infoBox) {
                result.infoBox = stripBrackets(content);
                debugLog('[RPG Parser] ✓ Matched: Info Box section');
            } else if (isCharacters && !result.characterThoughts) {
                result.characterThoughts = stripBrackets(content);
                debugLog('[RPG Parser] ✓ Matched: Present Characters section');
                debugLog('[RPG Parser] Full content:', content);
            } else {
                debugLog('[RPG Parser] ✗ No match - checking patterns:');
                debugLog('[RPG Parser]   - Has "Info Box\\n---"?', !!content.match(/Info Box\s*\n\s*---/i));
                debugLog('[RPG Parser]   - Has info keywords?', !!(content.match(/Date:/i) && content.match(/Location:/i)));
                debugLog('[RPG Parser]   - Has "Present Characters\\n---"?', !!content.match(/Present Characters\s*\n\s*---/i));
                debugLog('[RPG Parser]   - Has new format ("- Name" + "Details:")?', !!(content.match(/^-\s+\w+/m) && content.match(/Details:/i)));
            }
        }
    }
    debugLog('[RPG Parser] ==================== PARSE RESULTS ====================');
    debugLog('[RPG Parser] Found Quests:', !!result.quests);
    debugLog('[RPG Parser] Found Info Box:', !!result.infoBox);
    debugLog('[RPG Parser] Found Characters:', !!result.characterThoughts);
    debugLog('[RPG Parser] =======================================================');
    // Check if we found at least one section - if not, mark as parsing failure
    if (!result.quests && !result.infoBox && !result.characterThoughts) {
        result.parsingFailed = true;
        console.error('[RPG Parser] ❌ No tracker data found in response - parsing failed');
    }
    return result;
} // End parseResponse
/**
 * Parses quests from the AI response and updates extensionSettings.quests.
 * Handles both JSON format (v3) and legacy text format.
 *
 * @param {string} questsText - The raw quests JSON/text from AI response
 */
export function parseQuests(questsText) {
    debugLog('[RPG Parser] ==================== PARSING QUESTS ====================');
    debugLog('[RPG Parser] Quests text length:', questsText.length + ' chars');
    debugLog('[RPG Parser] Quests text preview:', questsText.substring(0, 200));
    try {
        const trimmed = questsText.trim();
        // Try JSON format first
        if (trimmed && (trimmed.startsWith('{') || trimmed.startsWith('['))) {
            const questsData = repairJSON(questsText);
            if (questsData) {
                debugLog('[RPG Parser] ✓ Parsed quests as JSON format');
                // Convert quest objects to strings
                const convertQuest = (quest) => {
                    if (!quest) return '';
                    if (typeof quest === 'string') return quest;
                    if (typeof quest === 'object') {
                        // Check for locked format: {value, locked}
                        let extracted = quest;
                        while (typeof extracted === 'object' && extracted.value !== undefined) {
                            extracted = extracted.value;
                        }
                        if (typeof extracted === 'string') return extracted;
                        return quest.title || quest.description || JSON.stringify(quest);
                    }
                    return String(quest);
                };
                extensionSettings.quests = {
                    main: convertQuest(questsData.main),
                    optional: Array.isArray(questsData.optional)
                        ? questsData.optional.map(convertQuest)
                        : []
                };
                debugLog('[RPG Parser] ✓ Quests extracted:', extensionSettings.quests);
                saveSettings();
                return;
            }
        }
        // Fallback: text format parsing
        debugLog('[RPG Parser] Falling back to text format for quests');
        const mainQuestMatch = questsText.match(/Main Quests?:\s*(.+)/i);
        if (mainQuestMatch) {
            extensionSettings.quests.main = mainQuestMatch[1].trim();
            debugLog('[RPG Parser] Main quest extracted:', mainQuestMatch[1].trim());
        }
        const optionalQuestsMatch = questsText.match(/Optional Quests:\s*(.+)/i);
        if (optionalQuestsMatch) {
            const questsTextVal = optionalQuestsMatch[1].trim();
            if (questsTextVal && questsTextVal !== 'None') {
                extensionSettings.quests.optional = questsTextVal
                    .split(',')
                    .map(q => q.trim())
                    .filter(q => q && q !== 'None');
            } else {
                extensionSettings.quests.optional = [];
            }
            debugLog('[RPG Parser] Optional quests extracted:', extensionSettings.quests.optional);
        }
        saveSettings();
        debugLog('[RPG Parser] Quests saved successfully');
        debugLog('[RPG Parser] =======================================================');
    } catch (error) {
        console.error('[Dooms Tracker] Error parsing quests:', error);
        debugLog('[RPG Parser] ERROR:', error.message);
    }
}
// NOTE: parseUserStats() has been archived to src/archived/archived-features-userstats.js
/**
 * Helper: Extract code blocks from text
 * @param {string} text - Text containing markdown code blocks
 * @returns {Array<string>} Array of code block contents
 */
export function extractCodeBlocks(text) {
    const codeBlockRegex = /```([^`]+)```/g;
    const matches = [...text.matchAll(codeBlockRegex)];
    return matches.map(match => match[1].trim());
}
/**
 * Helper: Parse stats section from code block content
 * @param {string} content - Code block content
 * @returns {boolean} True if this is a stats section
 */
export function isStatsSection(content) {
    return content.match(/Stats\s*\n\s*---/i) !== null;
}
/**
 * Helper: Parse info box section from code block content
 * @param {string} content - Code block content
 * @returns {boolean} True if this is an info box section
 */
export function isInfoBoxSection(content) {
    return content.match(/Info Box\s*\n\s*---/i) !== null;
}
/**
 * Helper: Parse character thoughts section from code block content
 * @param {string} content - Code block content
 * @returns {boolean} True if this is a character thoughts section
 */
export function isCharacterThoughtsSection(content) {
    return content.match(/Present Characters\s*\n\s*---/i) !== null || content.includes(" | ");
}
