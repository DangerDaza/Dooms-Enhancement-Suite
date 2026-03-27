/**
 * World Forge — AI-Powered Lorebook Generator
 *
 * Uses the user's connected API to generate lorebook entries from natural
 * language prompts. No chat context is used — generation is completely
 * independent of the current conversation.
 *
 * Modes:
 *   - New Entries: Generate fresh entries from a creative prompt
 *   - Expand: Flesh out existing entries with more detail
 *   - Revise: Rewrite/improve existing entries
 */
import { safeGenerateRaw } from '../../utils/responseExtractor.js';
import * as lorebookAPI from '../lorebook/lorebookAPI.js';

// ─── Constants ───────────────────────────────────────────────────────────────

const SYSTEM_PROMPT_BASE = `You are a World Forge — an expert worldbuilding assistant that creates lorebook entries for a roleplay AI system.

## Lorebook Entry Format
You MUST respond with a JSON array of entry objects. Each entry has these fields:

- "comment": (string) The entry's display name/title (e.g., "The Northern Kingdom", "Elara Moonwhisper")
- "key": (string array) Primary trigger keywords. When these words appear in chat, this entry activates. Use specific, relevant terms. (e.g., ["northern kingdom", "Northland", "the north"])
- "keysecondary": (string array) Optional secondary keywords for more precise triggering. Entry only activates if BOTH a primary AND secondary key match.
- "content": (string) The actual lore text that gets injected into the AI's context. Write in a dense, informative style. Include relevant details, relationships, history, personality traits, etc. Aim for 100-400 words per entry.
- "position": (number) Where in the prompt this entry appears: 0 = before character defs, 1 = after character defs, 4 = at specific depth. Default: 0
- "depth": (number) Only used when position=4. How many messages back from the latest to insert. Default: 4
- "group": (string) Optional inclusion group name. Entries in the same group are mutually exclusive — only the highest priority match is used.
- "order": (number) Priority order. Higher = inserted later (closer to the latest message). Default: 100

## Rules
1. ALWAYS respond with a valid JSON array, no markdown fences, no explanation outside the JSON
2. Keywords should be specific enough to trigger only when relevant
3. Content should be written as factual reference material, not narrative prose
4. Include cross-references between related entries via shared keywords
5. Each entry should be self-contained but complement related entries`;

const MODE_PROMPTS = {
    new: `\n\n## Your Task
Generate NEW lorebook entries based on the user's creative direction. Create well-structured entries with appropriate keywords, content, and metadata.`,

    expand: `\n\n## Your Task
EXPAND the provided existing entries with more detail, depth, and connections. Keep the original content but add substantially more information. Return the complete expanded entries (not just additions).`,

    revise: `\n\n## Your Task
REVISE and IMPROVE the provided existing entries. Fix any issues, improve writing quality, add missing keywords, and enhance the content. Return the complete revised entries.`,

    deepdive: `\n\n## Your Task — Deep Dive Mode
You are in DEEP DIVE mode. Do NOT generate entries yet. Instead, act as a worldbuilding consultant.

When the user describes what they want, respond with 5-8 probing questions that will help you create richer, more interconnected lore. Ask about:
- History and origins
- Relationships and conflicts
- Rules, limitations, and costs
- Cultural impact and societal views
- Notable figures and exceptions
- Connections to other existing lore
- Sensory details and aesthetics
- Secrets, mysteries, or hidden aspects

Format your response as plain text with numbered questions. Do NOT use JSON format yet.

Once the user has answered your questions (they may answer some or all), THEN generate the lorebook entries as a JSON array. The entries should be significantly deeper and more detailed than they would be without the questionnaire — that's the whole point.

If the user says something like "generate", "create them", "that's enough", or "go ahead", treat that as the signal to produce the JSON entries based on everything discussed so far.`,
};

// ─── Conversation State ──────────────────────────────────────────────────────

let conversationHistory = []; // Array of { role: 'user'|'assistant', content: string }
let lastGeneratedEntries = []; // Last batch of parsed entries

// ─── Prompt Building ─────────────────────────────────────────────────────────

function buildSystemPrompt(mode) {
    return SYSTEM_PROMPT_BASE + (MODE_PROMPTS[mode] || MODE_PROMPTS.new);
}

async function buildContextBlock(targetBook, includeExisting) {
    if (!includeExisting || !targetBook) return '';

    try {
        const data = await lorebookAPI.loadWorldData(targetBook);
        if (!data?.entries) return '';

        const sorted = lorebookAPI.getEntriesSorted(data);
        if (sorted.length === 0) return '';

        const entries = sorted.slice(0, 30).map(({ entry }) => ({
            comment: entry.comment || '',
            key: entry.key || [],
            content: (entry.content || '').substring(0, 200) + ((entry.content || '').length > 200 ? '...' : ''),
        }));

        return `\n\n## Existing Entries in "${targetBook}" (for context)\n${JSON.stringify(entries, null, 2)}`;
    } catch {
        return '';
    }
}

function buildMessageArray(systemPrompt, userMessage, existingContext) {
    const messages = [
        { role: 'system', content: systemPrompt + existingContext },
    ];

    // Include conversation history for multi-turn
    for (const msg of conversationHistory) {
        messages.push({ role: msg.role, content: msg.content });
    }

    // Add the new user message
    messages.push({ role: 'user', content: userMessage });

    return messages;
}

// ─── Response Parsing ────────────────────────────────────────────────────────

function parseEntryResponse(response) {
    if (!response || typeof response !== 'string') return [];

    // Try to extract JSON array from the response
    let text = response.trim();

    // Remove markdown code fences if present
    text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');

    // Find the JSON array
    const arrayMatch = text.match(/\[[\s\S]*\]/);
    if (!arrayMatch) return [];

    try {
        const parsed = JSON.parse(arrayMatch[0]);
        if (!Array.isArray(parsed)) return [];

        // Validate and normalize each entry
        return parsed.map((entry, idx) => ({
            comment: String(entry.comment || entry.title || entry.name || `Entry ${idx + 1}`),
            key: Array.isArray(entry.key) ? entry.key.map(String) : (typeof entry.key === 'string' ? [entry.key] : []),
            keysecondary: Array.isArray(entry.keysecondary) ? entry.keysecondary.map(String) : [],
            content: String(entry.content || ''),
            position: typeof entry.position === 'number' ? entry.position : 0,
            depth: typeof entry.depth === 'number' ? entry.depth : 4,
            group: String(entry.group || ''),
            order: typeof entry.order === 'number' ? entry.order : 100,
            // UI state
            _accepted: false,
            _editing: false,
            _id: Date.now() + idx,
        }));
    } catch {
        return [];
    }
}

// ─── Generation ──────────────────────────────────────────────────────────────

/**
 * Generate lorebook entries from a user prompt
 * @param {string} userMessage - The user's creative direction
 * @param {Object} options
 * @param {string} options.mode - 'new' | 'expand' | 'revise' | 'deepdive'
 * @param {string} options.targetBook - Target lorebook name
 * @param {boolean} options.includeExisting - Include existing entries as context
 * @param {Object[]} [options.selectedEntries] - Entries to expand/revise (for expand/revise modes)
 * @returns {Promise<{entries: Object[], rawResponse: string}>}
 */
export async function generateEntries(userMessage, options = {}) {
    const { mode = 'new', targetBook = '', includeExisting = false, selectedEntries = [] } = options;

    const systemPrompt = buildSystemPrompt(mode);
    const existingContext = await buildContextBlock(targetBook, includeExisting);

    // For expand/revise, prepend selected entries to the user message
    let fullUserMessage = userMessage;
    if ((mode === 'expand' || mode === 'revise') && selectedEntries.length > 0) {
        const entriesJson = JSON.stringify(selectedEntries.map(e => ({
            comment: e.comment,
            key: e.key,
            keysecondary: e.keysecondary,
            content: e.content,
            position: e.position,
            depth: e.depth,
            group: e.group,
            order: e.order,
        })), null, 2);
        fullUserMessage = `Here are the entries to ${mode}:\n${entriesJson}\n\nInstructions: ${userMessage}`;
    }

    const messages = buildMessageArray(systemPrompt, fullUserMessage, existingContext);

    const rawResponse = await safeGenerateRaw({
        prompt: messages,
        quietToLoud: false,
    });

    const entries = parseEntryResponse(rawResponse);

    // Update conversation history
    conversationHistory.push({ role: 'user', content: userMessage });
    conversationHistory.push({ role: 'assistant', content: rawResponse });
    lastGeneratedEntries = entries;

    return { entries, rawResponse };
}

// ─── Save to Lorebook ────────────────────────────────────────────────────────

/**
 * Save accepted entries to a lorebook
 * @param {string} worldName - Target lorebook name
 * @param {Object[]} entries - Array of entry objects to save
 * @returns {Promise<number>} Number of entries saved
 */
export async function saveEntriesToBook(worldName, entries) {
    const data = await lorebookAPI.loadWorldData(worldName);
    if (!data) throw new Error(`Could not load lorebook: ${worldName}`);

    let saved = 0;
    for (const entry of entries) {
        // createEntry returns the new entry object (not the full data)
        const newEntry = lorebookAPI.createEntry(worldName, data);
        if (!newEntry) continue;

        // Populate with our generated data
        newEntry.comment = entry.comment || '';
        newEntry.key = entry.key || [];
        newEntry.keysecondary = entry.keysecondary || [];
        newEntry.content = entry.content || '';
        newEntry.position = entry.position ?? 0;
        newEntry.depth = entry.depth ?? 4;
        newEntry.group = entry.group || '';
        newEntry.order = entry.order ?? 100;
        newEntry.disable = false;
        newEntry.constant = false;
        saved++;
    }

    await lorebookAPI.saveWorldData(worldName, data);
    return saved;
}

// ─── State Management ────────────────────────────────────────────────────────

export function clearConversation() {
    conversationHistory = [];
    lastGeneratedEntries = [];
}

export function getConversationHistory() {
    return [...conversationHistory];
}

export function getLastGeneratedEntries() {
    return [...lastGeneratedEntries];
}
