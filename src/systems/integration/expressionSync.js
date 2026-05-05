/**
 * Per-Character Expression Classification & Sprite Display
 *
 * Independent system that classifies emotions for each character in the scene
 * using their dialogue/thoughts text, looks up sprite files per NPC name,
 * and displays expression sprites on portrait bar cards.
 *
 * Replaces the old MutationObserver-based passthrough that mirrored ST's
 * single-character expression panel.
 */
import { chat, getRequestHeaders, generateRaw } from '../../../../../../../script.js';
import {
    extensionSettings,
    syncedExpressionPortraits,
    setSyncedExpressionPortrait,
    getSyncedExpressionPortrait,
    clearSyncedExpressionPortraits,
    setSyncedExpressionLabel,
    lastGeneratedData,
    committedTrackerData,
} from '../../core/state.js';
import { getActiveCharacterColors, saveChatData } from '../../core/persistence.js';
import { renderThoughts } from '../rendering/thoughts.js';
import { updatePortraitBar, resolveActiveUserName } from '../ui/portraitBar.js';

// ─────────────────────────────────────────────
//  Constants
// ─────────────────────────────────────────────

const DEFAULT_EXPRESSIONS = [
    'admiration', 'amusement', 'anger', 'annoyance', 'approval', 'caring',
    'confusion', 'curiosity', 'desire', 'disappointment', 'disapproval',
    'disgust', 'embarrassment', 'excitement', 'fear', 'gratitude', 'grief',
    'joy', 'love', 'nervousness', 'neutral', 'optimism', 'pride',
    'realization', 'relief', 'remorse', 'sadness', 'surprise',
];

/** Sprite cache: Map<normalizedName, { sprites: Map<label, path>, fetchedAt: number }> */
const spriteCache = new Map();
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes

/** Hidden style element for hiding ST's native expression display */
let hiddenExpressionStyleElement = null;

// ─────────────────────────────────────────────
//  Sprite cache
// ─────────────────────────────────────────────

function normalizeName(name) {
    return String(name || '').trim().toLowerCase();
}

/**
 * Fetches and caches the sprite list for a character from ST's sprites API.
 * @param {string} name - Character name (used as folder name)
 * @returns {Promise<Map<string, string>|null>} Map of label→path, or null if no sprites
 */
async function fetchAndCacheSpriteList(name) {
    const key = normalizeName(name);
    const cached = spriteCache.get(key);
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL) {
        return cached.sprites.size > 0 ? cached.sprites : null;
    }

    try {
        const response = await fetch(`/api/sprites/get?name=${encodeURIComponent(name)}`, {
            headers: getRequestHeaders(),
        });
        if (!response.ok) {
            spriteCache.set(key, { sprites: new Map(), fetchedAt: Date.now() });
            return null;
        }
        const data = await response.json();
        const sprites = new Map();
        if (Array.isArray(data)) {
            for (const entry of data) {
                if (entry.label && entry.path) {
                    // Keep first match per label (e.g., joy.png beats joy-1.png)
                    if (!sprites.has(entry.label)) {
                        sprites.set(entry.label, entry.path);
                    }
                }
            }
        }
        spriteCache.set(key, { sprites, fetchedAt: Date.now() });
        return sprites.size > 0 ? sprites : null;
    } catch (err) {
        console.warn(`[DES Expressions] Failed to fetch sprites for "${name}":`, err);
        return null;
    }
}

/**
 * Resolves a sprite URL for a character + expression label.
 * Falls back through: exact label → neutral → first available → null.
 * @param {string} name
 * @param {string} label
 * @returns {string|null}
 */
function resolveSpriteUrl(name, label) {
    const cached = spriteCache.get(normalizeName(name));
    if (!cached || cached.sprites.size === 0) return null;

    const sprites = cached.sprites;
    if (sprites.has(label)) return sprites.get(label);
    if (sprites.has('neutral')) return sprites.get('neutral');
    // Return first available sprite as last resort
    return sprites.values().next().value || null;
}

/**
 * Invalidates the sprite cache for a character (call after upload/delete).
 * @param {string} name
 */
export function invalidateSpriteCacheFor(name) {
    spriteCache.delete(normalizeName(name));
}

/**
 * Clears the entire sprite cache.
 */
export function clearSpriteCache() {
    spriteCache.clear();
}

// ─────────────────────────────────────────────
//  Text extraction
// ─────────────────────────────────────────────

/**
 * Extracts per-character text from a message and character thoughts.
 * Uses dialogue color attribution and character thoughts content.
 * @param {string} messageText - Raw message HTML/text
 * @param {Array} characters - Parsed character objects from characterThoughts
 * @returns {Map<string, string>} Map of characterName → text for classification
 */
function extractCharacterTexts(messageText, characters) {
    const result = new Map();

    // Build color → name mapping from active character colors
    const colors = getActiveCharacterColors();
    const colorToName = new Map();
    if (colors && typeof colors === 'object') {
        for (const [name, color] of Object.entries(colors)) {
            if (color) colorToName.set(color.toLowerCase(), name);
        }
    }

    // Extract dialogue from <font color=...> tags
    if (messageText && colorToName.size > 0) {
        const fontTagRegex = /<font\s+color=["']?(#[0-9a-fA-F]{6})["']?>([\s\S]*?)<\/font>/gi;
        for (const match of messageText.matchAll(fontTagRegex)) {
            const color = match[1].toLowerCase();
            const dialogue = match[2].replace(/<[^>]+>/g, '').trim();
            const name = colorToName.get(color);
            if (name && dialogue) {
                const existing = result.get(name) || '';
                result.set(name, existing + ' ' + dialogue);
            }
        }
    }

    // Supplement with character thoughts (always available from characterThoughts)
    if (Array.isArray(characters)) {
        for (const char of characters) {
            if (!char.name) continue;
            const thoughtText = char.thoughts?.content || char.thoughts || '';
            const demeanor = char.details?.demeanor || '';
            const supplement = [thoughtText, demeanor].filter(Boolean).join(' ').trim();
            if (supplement) {
                const existing = result.get(char.name) || '';
                result.set(char.name, (existing + ' ' + supplement).trim());
            }
        }
    }

    return result;
}

// ─────────────────────────────────────────────
//  Classification engine
// ─────────────────────────────────────────────

/**
 * Classifies a single text snippet using the local BERT model.
 * @param {string} text
 * @returns {Promise<string|null>}
 */
async function classifyLocal(text) {
    try {
        const response = await fetch('/api/extra/classify', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({ text: text.slice(0, 500) }),
        });
        if (!response.ok) return null;
        const data = await response.json();
        return data?.classification?.[0]?.label || null;
    } catch (err) {
        console.warn('[DES Expressions] Local classification failed:', err);
        return null;
    }
}

/**
 * Strips reasoning/thinking blocks from a model response so downstream parsing
 * doesn't trip on them. Thinking models (GLM-5, DeepSeek-R1, o1, Claude
 * extended thinking, etc.) routinely wrap internal reasoning in tags like
 * <think>, <thinking>, <reasoning>, or <reflection>. We also strip the common
 * "Final answer:" preamble.
 */
function stripThinkingTags(text) {
    if (!text) return '';
    return String(text)
        .replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, '')
        .replace(/<reasoning>[\s\S]*?<\/reasoning>/gi, '')
        .replace(/<reflection>[\s\S]*?<\/reflection>/gi, '')
        // Drop unclosed thinking blocks (response was cut off mid-thought)
        .replace(/<think(?:ing)?>[\s\S]*$/gi, '')
        .replace(/<reasoning>[\s\S]*$/gi, '')
        .trim();
}

const REGEX_ESCAPE = /[-/\\^$*+?.()|[\]{}]/g;

/**
 * Finds the first label that appears in a response (case-insensitive,
 * word-boundary matched). Tolerates surrounding prose, JSON, etc.
 */
function findLabelInResponse(response, labels) {
    const cleaned = stripThinkingTags(response).toLowerCase();
    if (!cleaned) return null;
    for (const label of labels) {
        const safe = String(label).toLowerCase().replace(REGEX_ESCAPE, '\\$&');
        if (!safe) continue;
        if (new RegExp(`\\b${safe}\\b`).test(cleaned)) {
            return String(label).toLowerCase();
        }
    }
    return null;
}

/**
 * Classifies emotions for multiple characters in one LLM call.
 * @param {Map<string, string>} characterTexts - Map of name → text
 * @param {Map<string, Map<string, string>>} availableSprites - Map of name → sprites map
 * @returns {Promise<Map<string, string>>} Map of name → expression label
 */
async function classifyLlmBatch(characterTexts, availableSprites) {
    const results = new Map();
    if (characterTexts.size === 0) return results;

    // Build prompt with per-character available labels
    const charEntries = [];
    const labelsByName = new Map();
    for (const [name, text] of characterTexts) {
        const sprites = availableSprites.get(normalizeName(name));
        const labels = sprites ? [...sprites.keys()] : DEFAULT_EXPRESSIONS;
        labelsByName.set(name, labels);
        const snippet = text.slice(0, 200);
        charEntries.push(`${name} (labels: ${labels.join(', ')}): "${snippet}"`);
    }

    const prompt = `Classify the emotion of each character based on their text. Return ONLY valid JSON with character names as keys and emotion labels as values. Choose only from each character's listed labels.

${charEntries.join('\n')}

Return JSON like: {"Name1":"emotion1","Name2":"emotion2"}`;

    try {
        const response = await generateRaw({
            prompt: prompt,
            systemPrompt: 'You are an emotion classifier. Output only valid JSON.',
            instructOverride: false,
            // Generous budget so reasoning/thinking models have room to think
            // and still emit the JSON answer.
            responseLength: 4000,
        });

        const cleaned = stripThinkingTags(response);
        // Greedy match: the JSON object may itself contain quoted strings, so a
        // non-greedy [^{}] regex falsely matches a label list. Find the first
        // '{' and last '}' in the cleaned response.
        const first = cleaned.indexOf('{');
        const last = cleaned.lastIndexOf('}');
        if (first !== -1 && last > first) {
            try {
                const parsed = JSON.parse(cleaned.slice(first, last + 1));
                for (const [name, label] of Object.entries(parsed)) {
                    if (typeof label === 'string') {
                        results.set(name, label.toLowerCase().trim());
                    }
                }
            } catch {
                // JSON didn't parse; fall back to per-character label scan
                for (const [name, labels] of labelsByName) {
                    const found = findLabelInResponse(cleaned, labels);
                    if (found) results.set(name, found);
                }
            }
        } else {
            // No JSON at all — try to recover labels per character
            for (const [name, labels] of labelsByName) {
                const found = findLabelInResponse(cleaned, labels);
                if (found) results.set(name, found);
            }
        }
    } catch (err) {
        console.warn('[DES Expressions] LLM batch classification failed:', err);
    }

    return results;
}

/**
 * Classifies a single text snippet using the LLM.
 * @param {string} text
 * @param {string[]} availableLabels
 * @returns {Promise<string|null>}
 */
async function classifyLlmSingle(text, availableLabels) {
    const labels = availableLabels.length > 0 ? availableLabels : DEFAULT_EXPRESSIONS;
    const prompt = `Classify the emotion of this text. Output just one word from: ${labels.join(', ')}\n\nText: "${text.slice(0, 300)}"`;

    try {
        const response = await generateRaw({
            prompt: prompt,
            systemPrompt: 'You are an emotion classifier. Output only one emotion word.',
            instructOverride: false,
            // Generous budget so reasoning/thinking models (GLM-5, DeepSeek-R1,
            // o1, Claude extended thinking, …) have room for their reasoning
            // pass and still emit a final answer. Non-thinking models stop at
            // the first newline so the extra budget costs nothing.
            responseLength: 1500,
        });
        return findLabelInResponse(response, labels);
    } catch (err) {
        console.warn('[DES Expressions] LLM single classification failed:', err);
        return null;
    }
}

// ─────────────────────────────────────────────
//  Orchestrator
// ─────────────────────────────────────────────

/**
 * Main entry point: classify expressions for all present characters and
 * update their portrait bar sprites.
 * @param {string} messageText - The raw message text (chat[].mes)
 */
export async function classifyAllCharacterExpressions(messageText) {
    if (!extensionSettings.enabled || !extensionSettings.syncExpressionsToPresentCharacters) return;

    // Get character list from parsed thoughts
    const data = lastGeneratedData.characterThoughts || committedTrackerData.characterThoughts;
    if (!data) return;

    let characters;
    try {
        const parsed = typeof data === 'string' ? JSON.parse(data) : data;
        characters = Array.isArray(parsed) ? parsed : (parsed.characters || []);
    } catch {
        return;
    }

    if (characters.length === 0) return;

    const charNames = characters.filter(c => c.name).map(c => c.name);

    // Fetch sprite lists for all characters in parallel
    const spriteFetches = charNames.map(async name => {
        const sprites = await fetchAndCacheSpriteList(name);
        return { name, sprites };
    });
    const spriteResults = await Promise.all(spriteFetches);

    // Build map of characters that have sprites
    const availableSprites = new Map();
    const classifiableNames = [];
    for (const { name, sprites } of spriteResults) {
        if (sprites) {
            availableSprites.set(normalizeName(name), sprites);
            classifiableNames.push(name);
        }
    }

    if (classifiableNames.length === 0) return;

    // Extract per-character text
    const characterTexts = extractCharacterTexts(messageText, characters);

    // Filter to only characters with both sprites AND text
    const toClassify = new Map();
    for (const name of classifiableNames) {
        const text = characterTexts.get(name);
        if (text && text.trim().length > 10) {
            toClassify.set(name, text);
        }
    }

    if (toClassify.size === 0) return;

    // Classify based on selected API
    const api = extensionSettings.expressionClassifierApi || 'local';
    let classifications = new Map();

    if (api === 'llm' && extensionSettings.expressionBatchMode && toClassify.size > 1) {
        // LLM batch mode
        classifications = await classifyLlmBatch(toClassify, availableSprites);
    } else if (api === 'llm') {
        // LLM individual
        const promises = [...toClassify.entries()].map(async ([name, text]) => {
            const sprites = availableSprites.get(normalizeName(name));
            const labels = sprites ? [...sprites.keys()] : DEFAULT_EXPRESSIONS;
            const label = await classifyLlmSingle(text, labels);
            return { name, label };
        });
        const results = await Promise.all(promises);
        for (const { name, label } of results) {
            if (label) classifications.set(name, label);
        }
    } else {
        // Local BERT (parallel)
        const promises = [...toClassify.entries()].map(async ([name, text]) => {
            const label = await classifyLocal(text);
            return { name, label };
        });
        const results = await Promise.all(promises);
        for (const { name, label } of results) {
            if (label) classifications.set(name, label);
        }
    }

    // Resolve sprites and store in state
    let changed = false;
    for (const [name, label] of classifications) {
        const spriteUrl = resolveSpriteUrl(name, label);
        if (spriteUrl) {
            const prev = getSyncedExpressionPortrait(normalizeName(name));
            // Always track the label so UI can surface it even when the
            // sprite URL didn't change this turn (e.g. same expression).
            setSyncedExpressionLabel(normalizeName(name), label);
            if (prev !== spriteUrl) {
                setSyncedExpressionPortrait(normalizeName(name), spriteUrl);
                changed = true;
                console.log(`[DES Expressions] ${name} → ${label} (${spriteUrl})`);
            }
        }
    }

    if (changed) {
        saveChatData();
        refreshExpressionConsumers();
    }
}

/**
 * Classify the user's outgoing message text and set the matching sprite
 * on the active user character — same flow {{char}} expressions take
 * after each AI response. Resolves the active user character via
 * resolveActiveUserName() (manual override → linkedPersona match →
 * single-entry fallback). Silently no-ops if there's no active user
 * character or no sprite folder for them.
 *
 * Gated by extensionSettings.syncExpressionsToPresentCharacters so it
 * shares the master toggle with the NPC classifier.
 */
export async function classifyActiveUserExpression(messageText) {
    if (!extensionSettings.syncExpressionsToPresentCharacters) return;
    const text = String(messageText || '').trim();
    if (!text) return;
    const name = resolveActiveUserName();
    if (!name) return;
    // Make sure sprites exist before classifying — if there are none,
    // the classification result has nowhere to land.
    const sprites = await fetchAndCacheSpriteList(name);
    if (!sprites) return;

    const api = extensionSettings.expressionClassifierApi || 'local';
    let label = null;
    try {
        if (api === 'llm') {
            const labels = Array.from(sprites.keys());
            label = await classifyLlmSingle(text, labels);
        } else {
            label = await classifyLocal(text);
        }
    } catch (err) {
        console.warn('[DES Expressions] User classification failed:', err);
        return;
    }
    if (!label) return;
    const spriteUrl = resolveSpriteUrl(name, label);
    if (!spriteUrl) return;
    const key = normalizeName(name);
    const prev = getSyncedExpressionPortrait(key);
    setSyncedExpressionLabel(key, label);
    if (prev !== spriteUrl) {
        setSyncedExpressionPortrait(key, spriteUrl);
        try { saveChatData(); } catch (e) {}
        refreshExpressionConsumers();
        console.log(`[DES Expressions] (user) ${name} → ${label} (${spriteUrl})`);
    }
}

// ─────────────────────────────────────────────
//  Consumer refresh
// ─────────────────────────────────────────────

let _refreshRAF = 0;

function refreshExpressionConsumers() {
    if (_refreshRAF) cancelAnimationFrame(_refreshRAF);
    _refreshRAF = requestAnimationFrame(() => {
        _refreshRAF = 0;
        renderThoughts({ preserveScroll: true });
        updatePortraitBar();
        // Dynamic import to avoid circular dependency
        import('../rendering/chatBubbles.js').then(m => m.refreshBubbleAvatars()).catch(() => {});
    });
}

// ─────────────────────────────────────────────
//  Portrait lookup (used by avatars.js)
// ─────────────────────────────────────────────

/**
 * Gets the expression portrait URL for a character.
 * @param {string} characterName
 * @returns {string|null}
 */
export function getExpressionPortraitForCharacter(characterName) {
    if (!extensionSettings.enabled || !extensionSettings.syncExpressionsToPresentCharacters) return null;

    const target = normalizeName(characterName);
    if (!target) return null;

    const exact = getSyncedExpressionPortrait(target);
    if (exact) return exact;

    // Fuzzy match: "Stella" matches "stella voss"
    for (const [storedName, src] of Object.entries(syncedExpressionPortraits)) {
        const stored = normalizeName(storedName);
        if (!stored) continue;
        if (stored.startsWith(target + ' ') || target.startsWith(stored + ' ')) {
            return src;
        }
    }

    return null;
}

// ─────────────────────────────────────────────
//  Native expression display hiding (preserved)
// ─────────────────────────────────────────────

function getHideStyleCss() {
    return `
#expression-image,
#expression-holder,
.expression-holder,
[data-expression-container],
#expression-image img,
#expression-holder img,
.expression-holder img,
[data-expression-container] img {
    position: absolute !important;
    left: -10000px !important;
    top: 0 !important;
    width: 1px !important;
    height: 1px !important;
    overflow: hidden !important;
    opacity: 0 !important;
    pointer-events: none !important;
    visibility: hidden !important;
}
`;
}

function hideNativeExpressionDisplay() {
    if (hiddenExpressionStyleElement?.isConnected) return;
    const styleElement = document.createElement('style');
    styleElement.id = 'rpg-hidden-native-expression-display-style';
    styleElement.textContent = getHideStyleCss();
    document.head.appendChild(styleElement);
    hiddenExpressionStyleElement = styleElement;
}

function showNativeExpressionDisplay() {
    if (hiddenExpressionStyleElement?.isConnected) {
        hiddenExpressionStyleElement.remove();
    } else {
        document.getElementById('rpg-hidden-native-expression-display-style')?.remove();
    }
    hiddenExpressionStyleElement = null;
}

function syncNativeExpressionDisplayVisibility() {
    if (extensionSettings.enabled && extensionSettings.hideDefaultExpressionDisplay) {
        hideNativeExpressionDisplay();
    } else {
        showNativeExpressionDisplay();
    }
}

// ─────────────────────────────────────────────
//  Lifecycle exports (same interface as before)
// ─────────────────────────────────────────────

/**
 * Triggers re-classification for a single character.
 * Called when a specific character speaks.
 */
export function queueExpressionCaptureForSpeaker(speakerName) {
    if (!extensionSettings.enabled || !extensionSettings.syncExpressionsToPresentCharacters) return;
    // The orchestrator handles all characters at once, so this is a no-op
    // in the new system. Classification happens in onMessageReceived.
}

/**
 * Syncs expression from latest message (manual trigger).
 */
export function syncExpressionFromLatestMessage() {
    if (!extensionSettings.enabled || !extensionSettings.syncExpressionsToPresentCharacters) return;
    const lastMessage = chat[chat.length - 1];
    if (lastMessage && !lastMessage.is_user) {
        classifyAllCharacterExpressions(lastMessage.mes);
    }
}

/**
 * Initialize the expression system.
 */
export function initExpressionSync() {
    clearSpriteCache();
    syncNativeExpressionDisplayVisibility();
}

/**
 * Called when chat changes.
 */
export function onExpressionSyncChatChanged() {
    clearSpriteCache();
    syncNativeExpressionDisplayVisibility();
    // Synced portraits are loaded from chat_metadata by persistence.js
}

/**
 * Called when expression sync toggle changes.
 */
export function onExpressionSyncSettingChanged(enabled) {
    if (!enabled) {
        clearSyncedExpressionPortraits();
        clearSpriteCache();
        refreshExpressionConsumers();
    }
    syncNativeExpressionDisplayVisibility();
}

/**
 * Called when hide native display toggle changes.
 */
export function onHideDefaultExpressionDisplaySettingChanged(enabled) {
    syncNativeExpressionDisplayVisibility();
}

/**
 * Clears all cached data.
 */
export function clearExpressionSyncCache() {
    clearSyncedExpressionPortraits();
    clearSpriteCache();
}
