/**
 * JSON Prompt Builder Helpers
 * Helper functions for building JSON format tracker prompts
 */
import { extensionSettings, committedTrackerData } from '../../core/state.js';
import { getContext } from '../../../../../../extensions.js';
import { i18n } from '../../core/i18n.js';
import { getWeatherKeywordsAsPromptString } from '../ui/weatherEffects.js';
/**
 * Converts a field name to snake_case for use as JSON key
 * Example: "Test Tracker" -> "test_tracker"
 * @param {string} name - Field name to convert
 * @returns {string} snake_case version
 */
function toSnakeCase(name) {
    return name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');
}
/**
 * Extracts the base name (before parentheses) and converts to snake_case for use as JSON key.
 * Parenthetical content is treated as a description/hint, not part of the key.
 * Example: "Conditions (up to 5 traits)" -> "conditions"
 * Example: "Status Effects" -> "status_effects"
 * @param {string} name - Field name, possibly with parenthetical description
 * @returns {string} snake_case key from the base name only
 */
export function toFieldKey(name) {
    const baseName = name.replace(/\s*\(.*\)\s*$/, '').trim();
    return toSnakeCase(baseName);
}
/**
 * Built-in infoBox JSON keys that user-defined custom scene fields must not shadow.
 * A custom field named e.g. "Tension" would otherwise collide with the built-in key.
 */
const RESERVED_INFOBOX_KEYS = ['date', 'time', 'location', 'weather', 'temperature', 'recentEvents', 'moonPhase', 'tension', 'timeSinceRest', 'conditions', 'terrain', 'doomTension'];
/**
 * Returns the enabled user-defined custom scene fields with their resolved JSON keys.
 * Filters out fields with empty/reserved/duplicate keys so prompt, rendering, and
 * history persistence all agree on exactly which fields exist.
 *
 * @returns {Array<{key: string, name: string, label: string, icon: string, description: string, persistInHistory: boolean}>}
 */
export function getCustomSceneFields() {
    const fields = extensionSettings.trackerConfig?.infoBox?.customFields || [];
    const seen = new Set(RESERVED_INFOBOX_KEYS);
    const result = [];
    for (const field of fields) {
        if (!field || !field.enabled || !field.name) continue;
        const key = toFieldKey(field.name);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        result.push({
            key,
            name: field.name,
            label: field.name.replace(/\s*\(.*\)\s*$/, '').trim(),
            icon: field.icon || '✨',
            description: field.description || field.name,
            persistInHistory: field.persistInHistory === true
        });
    }
    return result;
}
// NOTE: buildUserStatsJSONInstruction() has been archived to src/archived-features-userstats.js
// User stats (Health, Satiety, Energy, Hygiene, Arousal), mood/status, RPG attributes,
// skills, and inventory have been removed. Quests are now a top-level tracker.

/**
 * Builds Quests JSON format instruction (independent top-level tracker)
 * @returns {string} JSON format instruction for quests
 */
export function buildQuestsJSONInstruction() {
    let instruction = '{\n';
    instruction += '  "main": {"title": "Quest title"},\n';
    instruction += '  "optional": [\n';
    instruction += '    {"title": "Quest1"},\n';
    instruction += '    {"title": "Quest2"}\n';
    instruction += '  ]\n';
    instruction += '}';
    return instruction;
}
/**
 * Builds Info Box JSON format instruction
 * @returns {string} JSON format instruction for info box
 */
export function buildInfoBoxJSONInstruction() {
    const infoBoxConfig = extensionSettings.trackerConfig?.infoBox;
    const widgets = infoBoxConfig?.widgets || {};
    // Core fields are always included — they are fundamental tracker fields that should
    // never be gated behind an enabled flag. If they somehow got disabled (e.g. from an
    // old save), force them on here so the prompt always asks the AI for them.
    const CORE_FIELDS = ['date', 'time', 'location', 'recentEvents'];
    for (const key of CORE_FIELDS) {
        if (!widgets[key]) widgets[key] = { enabled: true, persistInHistory: true };
        else if (!widgets[key].enabled) widgets[key].enabled = true;
    }
    let instruction = '{\n';
    let hasFields = false;
    if (widgets.date?.enabled) {
        const dateFormat = widgets.date.format || 'Weekday, Month, Year';
        instruction += `  "date": {"value": "${dateFormat}"}`;
        hasFields = true;
    }
    if (widgets.time?.enabled) {
        instruction += (hasFields ? ',\n' : '') + '  "time": {"start": "TimeStart", "end": "TimeEnd"}';
        hasFields = true;
    }
    if (widgets.location?.enabled) {
        instruction += (hasFields ? ',\n' : '') + '  "location": {"value": "Location"}';
        hasFields = true;
    }
    if (widgets.weather?.enabled) {
        const keywordsHint = getWeatherKeywordsAsPromptString('en');
        const defaultWeatherInstruction = `SINGLE keyword only. ${keywordsHint}`;
        const weatherInstruction = extensionSettings.customWeatherPrompt || defaultWeatherInstruction;
        instruction += (hasFields ? ',\n' : '') + `  "weather": {"emoji": "WeatherEmoji", "forecast": "${weatherInstruction}"}`;
        hasFields = true;
    }
    if (widgets.temperature?.enabled) {
        const unit = widgets.temperature.unit || 'C';
        instruction += (hasFields ? ',\n' : '') + `  "temperature": {"value": <number>, "unit": "${unit}"}`;
        hasFields = true;
    }
    if (widgets.recentEvents?.enabled) {
        instruction += (hasFields ? ',\n' : '') + '  "recentEvents": ["1-2 brief major events only"]';
        hasFields = true;
    }
    const compact = extensionSettings.compactPrompts !== false;
    if (widgets.moonPhase?.enabled) {
        instruction += (hasFields ? ',\n' : '') + (compact
            ? '  "moonPhase": "New Moon|Waxing Crescent|First Quarter|Waxing Gibbous|Full Moon|Waning Gibbous|Last Quarter|Waning Crescent"'
            : '  "moonPhase": "Current moon phase (New Moon / Waxing Crescent / First Quarter / Waxing Gibbous / Full Moon / Waning Gibbous / Last Quarter / Waning Crescent)"');
        hasFields = true;
    }
    if (widgets.tension?.enabled) {
        instruction += (hasFields ? ',\n' : '') + (compact
            ? '  "tension": "Calm|Uneasy|Tense|Hostile|Volatile|Intimate"'
            : '  "tension": "Overall scene tension (Calm / Uneasy / Tense / Hostile / Volatile / Intimate)"');
        hasFields = true;
    }
    if (widgets.timeSinceRest?.enabled) {
        instruction += (hasFields ? ',\n' : '') + (compact
            ? '  "timeSinceRest": "Time since player last rested, e.g. \\"6 hours\\""'
            : '  "timeSinceRest": "Time since the player character last slept or rested (e.g. \\"6 hours\\", \\"2 days\\")"');
        hasFields = true;
    }
    if (widgets.conditions?.enabled) {
        instruction += (hasFields ? ',\n' : '') + (compact
            ? '  "conditions": "Active conditions on the player, comma-separated, or \\"None\\""'
            : '  "conditions": "Comma-separated active physical or magical conditions on the player (e.g. \\"Transformed, Poisoned\\" or \\"None\\")"');
        hasFields = true;
    }
    if (widgets.terrain?.enabled) {
        instruction += (hasFields ? ',\n' : '') + (compact
            ? '  "terrain": "Terrain/environment type, e.g. \\"Dense Forest\\""'
            : '  "terrain": "General terrain or environment type at the current location (e.g. \\"Dense Forest\\", \\"City Streets\\", \\"Underground Dungeon\\")"');
        hasFields = true;
    }
    // User-defined custom scene fields
    for (const field of getCustomSceneFields()) {
        const desc = field.description.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
        instruction += (hasFields ? ',\n' : '') + `  "${field.key}": "${desc}"`;
        hasFields = true;
    }
    // Doom Counter: inject numeric tension scale (1-10) for automated tension tracking
    if (extensionSettings.doomCounter?.enabled) {
        instruction += (hasFields ? ',\n' : '') + (compact
            ? '  "doomTension": <number 1-10: scene tension, 1=calm, 5=moderate, 10=crisis>'
            : '  "doomTension": <number 1-10 rating the current scene tension. 1=completely calm/peaceful/boring, 5=moderate tension/anticipation, 10=extreme danger/conflict/crisis>');
        hasFields = true;
    }
    instruction += '\n}';
    return instruction;
}
/**
 * Builds Present Characters JSON format instruction
 * @returns {string} JSON format instruction for present characters
 */
export function buildCharactersJSONInstruction() {
    const userName = getContext().name1;
    const presentCharsConfig = extensionSettings.trackerConfig?.presentCharacters;
    const enabledFields = presentCharsConfig?.customFields?.filter(f => f && f.enabled && f.name) || [];
    const relationshipsEnabled = presentCharsConfig?.relationships?.enabled !== false;
    const thoughtsConfig = presentCharsConfig?.thoughts;
    const characterStats = presentCharsConfig?.characterStats;
    const enabledCharStats = characterStats?.enabled && characterStats?.customStats?.filter(s => s && s.enabled && s.name) || [];
    let instruction = '[\n';
    instruction += '  {\n';
    instruction += '    "name": "CharacterName",\n';
    instruction += '    "emoji": "Character Emoji"';
    // Dialogue color — only ask for it when dialogue coloring is on, since
    // it's the only feature that consumes the field. Including the color
    // each character is being voiced in lets the bubble splitter look up
    // speakers directly instead of guessing from surrounding narration.
    if (extensionSettings.enableDialogueColoring) {
        instruction += ',\n    "color": "#RRGGBB hex matching the <font color> you use for this character\'s dialogue"';
    }
    // Details fields
    if (enabledFields.length > 0) {
        instruction += ',\n    "details": {\n';
        for (let i = 0; i < enabledFields.length; i++) {
            const field = enabledFields[i];
            const fieldKey = toSnakeCase(field.name);
            const comma = i < enabledFields.length - 1 ? ',' : '';
            instruction += `      "${fieldKey}": "${field.description}"${comma}\n`;
        }
        instruction += '    }';
    }
    // Relationship
    if (relationshipsEnabled) {
        const relationshipFields = presentCharsConfig?.relationshipFields || [];
        const options = relationshipFields.join('/');
        instruction += ',\n    "relationship": {"status": "(choose one: ' + options + ')"}';
    }
    // Stats
    if (enabledCharStats.length > 0) {
        instruction += ',\n    "stats": [\n';
        for (let i = 0; i < enabledCharStats.length; i++) {
            const stat = enabledCharStats[i];
            const comma = i < enabledCharStats.length - 1 ? ',' : '';
            instruction += `      {"name": "${stat.name}", "value": X}${comma}\n`;
        }
        instruction += '    ]';
    }
    // Thoughts
    if (thoughtsConfig?.enabled) {
        const thoughtsDescription = extensionSettings.customCharacterThoughtsPrompt || thoughtsConfig.description || 'Internal monologue';
        instruction += `,\n    "thoughts": {"content": "${thoughtsDescription}"}`;
    }
    instruction += '\n  }\n';
    instruction += ']';
    return instruction;
}
/**
 * Adds lock information to instruction text
 * @param {string} baseInstruction - Base instruction text
 * @returns {string} Instruction with lock information added
 */
export function addLockInstruction(baseInstruction) {
    if (extensionSettings.compactPrompts !== false) {
        return baseInstruction + '\n\nIMPORTANT: Any field with "locked": true must keep its exact previous value. Omit "locked" on unlocked items.';
    }
    return baseInstruction + '\n\nIMPORTANT: If an item, stat, quest, or field has "locked": true in its object, you MUST NOT change its value. Keep it exactly as it appears in the previous trackers. Only unlocked items can be modified. The "locked" field should ONLY be included if the item is actually locked - omit it for unlocked items.';
}
