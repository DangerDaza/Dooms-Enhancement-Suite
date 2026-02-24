/**
 * Core Persistence Module
 * Handles saving/loading extension settings and chat data
 */
import { saveSettingsDebounced, chat_metadata, saveChatDebounced, saveChatConditional } from '../../../../../../script.js';
import { getContext } from '../../../../../extensions.js';
import {
    extensionSettings,
    lastGeneratedData,
    committedTrackerData,
    setExtensionSettings,
    updateExtensionSettings,
    setLastGeneratedData,
    setCommittedTrackerData,
} from './state.js';
import { migrateToV3JSON } from '../utils/jsonMigration.js';
import { parseQuests } from '../systems/generation/parser.js';
import { extensionName } from './config.js';
// NOTE: FEATURE_FLAGS, migrateInventory, validateStoredInventory, cleanItemString imports removed — userStats system archived
/**
 * Validates extension settings structure
 * @param {Object} settings - Settings object to validate
 * @returns {boolean} True if valid, false otherwise
 */
function validateSettings(settings) {
    if (!settings || typeof settings !== 'object') {
        return false;
    }
    // Check for required top-level properties
    if (typeof settings.enabled !== 'boolean' ||
        typeof settings.autoUpdate !== 'boolean') {
        console.warn('[Dooms Tracker] Settings validation failed: missing required properties');
        return false;
    }
    // NOTE: userStats validation removed — system archived
    return true;
}
/**
 * Loads the extension settings from the global settings object.
 * Automatically migrates v1 inventory to v2 format if needed.
 */
export function loadSettings() {
    try {
        const context = getContext();
        const extension_settings = context.extension_settings || context.extensionSettings;
        // Validate extension_settings structure
        if (!extension_settings || typeof extension_settings !== 'object') {
            console.warn('[Dooms Tracker] extension_settings is not available, using default settings');
            return;
        }
        // Migrate settings from old RPG Companion key if present
        const oldExtensionName = 'third-party/rpg-companion-sillytavern';
        if (!extension_settings[extensionName] && extension_settings[oldExtensionName]) {
            console.log('[Dooms Tracker] Migrating settings from rpg-companion-sillytavern');
            extension_settings[extensionName] = extension_settings[oldExtensionName];
        }
        // Migrate settings from old dooms-character-tracker key if present
        const oldTrackerName = 'third-party/dooms-character-tracker';
        if (extension_settings[oldTrackerName]) {
            if (!extension_settings[extensionName]) {
                // Full migration — new key doesn't exist yet
                console.log('[Dooms Tracker] Migrating settings from dooms-character-tracker');
                extension_settings[extensionName] = extension_settings[oldTrackerName];
            } else {
                // Partial migration — merge critical user data that may be missing from new key
                const oldData = extension_settings[oldTrackerName];
                const newData = extension_settings[extensionName];
                if (oldData.npcAvatars && Object.keys(oldData.npcAvatars).length > 0 &&
                    (!newData.npcAvatars || Object.keys(newData.npcAvatars).length === 0)) {
                    console.log('[Dooms Tracker] Merging npcAvatars from dooms-character-tracker');
                    newData.npcAvatars = oldData.npcAvatars;
                }
                if (oldData.knownCharacters && Object.keys(oldData.knownCharacters).length > Object.keys(newData.knownCharacters || {}).length) {
                    console.log('[Dooms Tracker] Merging knownCharacters from dooms-character-tracker');
                    const merged = Object.assign({}, oldData.knownCharacters, newData.knownCharacters);
                    // Deduplicate: remove short-name entries superseded by full-name entries
                    // e.g. remove "Sakura" when "Sakura Ashenveil" is also present
                    const mergedKeys = Object.keys(merged);
                    for (const shortKey of mergedKeys) {
                        const hasFullName = mergedKeys.some(k => k !== shortKey && k.toLowerCase().startsWith(shortKey.toLowerCase() + ' '));
                        if (hasFullName) {
                            delete merged[shortKey];
                            console.log(`[Dooms Tracker] Removed short-name duplicate: "${shortKey}"`);
                        }
                    }
                    newData.knownCharacters = merged;
                }
                if (oldData.characterColors && Object.keys(oldData.characterColors).length > 0 &&
                    (!newData.characterColors || Object.keys(newData.characterColors).length === 0)) {
                    console.log('[Dooms Tracker] Merging characterColors from dooms-character-tracker');
                    newData.characterColors = oldData.characterColors;
                }
            }
        }
        if (extension_settings[extensionName]) {
            const savedSettings = extension_settings[extensionName];
            // Validate loaded settings
            if (!validateSettings(savedSettings)) {
                console.warn('[Dooms Tracker] Loaded settings failed validation, using defaults');
                console.warn('[Dooms Tracker] Invalid settings:', savedSettings);
                // Save valid defaults to replace corrupt data
                saveSettings();
                return;
            }
            updateExtensionSettings(savedSettings);
            // Perform settings migrations based on version
            const currentVersion = extensionSettings.settingsVersion || 1;
            let settingsChanged = false;
            // Migration to version 2: Enable dynamic weather for existing users
            if (currentVersion < 2) {
                extensionSettings.enableDynamicWeather = true;
                extensionSettings.settingsVersion = 2;
                settingsChanged = true;
            }
            // Migration to version 3: Convert text trackers to JSON format
            if (currentVersion < 3) {
                migrateToV3JSON();
                extensionSettings.settingsVersion = 3;
                settingsChanged = true;
            }
            // Migration to version 4: Enable FAB widgets by default
            if (currentVersion < 4) {
                if (!extensionSettings.mobileFabWidgets) {
                    extensionSettings.mobileFabWidgets = {};
                }
                extensionSettings.mobileFabWidgets.enabled = true;
                extensionSettings.mobileFabWidgets.weatherIcon = { enabled: true };
                extensionSettings.mobileFabWidgets.weatherDesc = { enabled: true };
                extensionSettings.mobileFabWidgets.clock = { enabled: true };
                extensionSettings.mobileFabWidgets.date = { enabled: true };
                extensionSettings.mobileFabWidgets.location = { enabled: true };
                extensionSettings.mobileFabWidgets.stats = { enabled: true };
                extensionSettings.mobileFabWidgets.attributes = { enabled: true };
                extensionSettings.settingsVersion = 4;
                settingsChanged = true;
            }
            // Migration to version 5: Add opacity properties for all colors
            if (currentVersion < 5) {
                if (!extensionSettings.customColors) {
                    extensionSettings.customColors = {};
                }
                if (extensionSettings.customColors.bgOpacity === undefined) extensionSettings.customColors.bgOpacity = 100;
                if (extensionSettings.customColors.accentOpacity === undefined) extensionSettings.customColors.accentOpacity = 100;
                if (extensionSettings.customColors.textOpacity === undefined) extensionSettings.customColors.textOpacity = 100;
                if (extensionSettings.customColors.highlightOpacity === undefined) extensionSettings.customColors.highlightOpacity = 100;
                if (extensionSettings.statBarColorLowOpacity === undefined) extensionSettings.statBarColorLowOpacity = 100;
                if (extensionSettings.statBarColorHighOpacity === undefined) extensionSettings.statBarColorHighOpacity = 100;
                extensionSettings.settingsVersion = 5;
                settingsChanged = true;
            }
            // Migration to version 6: Initialize lorebook manager settings
            if (currentVersion < 6) {
                if (!extensionSettings.lorebook) {
                    extensionSettings.lorebook = {
                        enabled: true,
                        campaigns: {},
                        campaignOrder: [],
                        collapsedCampaigns: [],
                        expandedBooks: [],
                        lastActiveTab: 'all',
                        lastFilter: 'all',
                        lastSearch: ''
                    };
                }
                extensionSettings.settingsVersion = 6;
                settingsChanged = true;
            }

            // Save migrated settings
            if (settingsChanged) {
                saveSettings();
            }
        } else {
        }
        // Migrate to trackerConfig if it doesn't exist
        if (!extensionSettings.trackerConfig) {
            migrateToTrackerConfig();
            saveSettings(); // Persist migration
        }
        // Migrate to preset manager system if presets don't exist
        migrateToPresetManager();
        // NOTE: userStats string parsing, initializeCustomStatusFields, ensureStatsHaveMaxValue
        // removed — userStats system archived to src/archived/archived-features-userstats.js
    } catch (error) {
        console.error('[Dooms Tracker] Error loading settings:', error);
        console.error('[Dooms Tracker] Error details:', error.message, error.stack);
        console.warn('[Dooms Tracker] Using default settings due to load error');
        // Settings will remain at defaults from state.js
    }
    // NOTE: userStats parsing and inventory validation removed — system archived
}
/**
 * Saves the extension settings to the global settings object.
 */
export function saveSettings() {
    const context = getContext();
    const extension_settings = context.extension_settings || context.extensionSettings;
    if (!extension_settings) {
        console.error('[Dooms Tracker] extension_settings is not available, cannot save');
        return;
    }
    extension_settings[extensionName] = extensionSettings;
    saveSettingsDebounced();
}
/**
 * Saves RPG data to the current chat's metadata.
 */
export function saveChatData() {
    if (!chat_metadata) {
        return;
    }
    chat_metadata.dooms_tracker = {
        quests: extensionSettings.quests,
        lastGeneratedData: lastGeneratedData,
        committedTrackerData: committedTrackerData,
        timestamp: Date.now()
    };
    // Use debounced save — the standard SillyTavern pattern.
    // Immediate saves (saveChatConditional) on every UI edit caused performance issues.
    saveChatDebounced();
}
/**
 * Updates the last assistant message's swipe data with current tracker data.
 * This ensures user edits are preserved across swipes and included in generation context.
 */
export function updateMessageSwipeData() {
    const chat = getContext().chat;
    if (!chat || chat.length === 0) {
        return;
    }
    // Find the last assistant message
    for (let i = chat.length - 1; i >= 0; i--) {
        const message = chat[i];
        if (!message.is_user) {
            // Found last assistant message - update its swipe data
            if (!message.extra) {
                message.extra = {};
            }
            if (!message.extra.dooms_tracker_swipes) {
                message.extra.dooms_tracker_swipes = {};
            }
            const swipeId = message.swipe_id || 0;
            message.extra.dooms_tracker_swipes[swipeId] = {
                quests: lastGeneratedData.quests,
                infoBox: lastGeneratedData.infoBox,
                characterThoughts: lastGeneratedData.characterThoughts
            };
            break;
        }
    }
}
/**
 * Loads RPG data from the current chat's metadata.
 * Automatically migrates v1 inventory to v2 format if needed.
 */
export function loadChatData() {
    // Migrate data from old rpg_companion key if it exists
    if (chat_metadata && !chat_metadata.dooms_tracker && chat_metadata.rpg_companion) {
        console.log('[Dooms Tracker] Migrating chat data from rpg_companion to dooms_tracker');
        chat_metadata.dooms_tracker = chat_metadata.rpg_companion;
        delete chat_metadata.rpg_companion;
        saveChatDebounced();
    }
    // Migrate per-message swipe data from old rpg_companion_swipes key
    try {
        const chatContext = getContext();
        const chatMessages = chatContext?.chat;
        if (chatMessages && Array.isArray(chatMessages)) {
            let migratedSwipes = false;
            for (const message of chatMessages) {
                if (message.extra && message.extra.rpg_companion_swipes && !message.extra.dooms_tracker_swipes) {
                    message.extra.dooms_tracker_swipes = message.extra.rpg_companion_swipes;
                    delete message.extra.rpg_companion_swipes;
                    migratedSwipes = true;
                }
            }
            if (migratedSwipes) {
                console.log('[Dooms Tracker] Migrated per-message swipe data from rpg_companion_swipes');
                saveChatDebounced();
            }
        }
    } catch (e) {
        console.warn('[Dooms Tracker] Swipe data migration skipped:', e.message);
    }
    if (!chat_metadata || !chat_metadata.dooms_tracker) {
        // Reset to defaults if no data exists
        updateExtensionSettings({
            quests: {
                main: "None",
                optional: []
            }
        });
        setLastGeneratedData({
            quests: null,
            infoBox: null,
            characterThoughts: null,
            html: null
        });
        setCommittedTrackerData({
            quests: null,
            infoBox: null,
            characterThoughts: null
        });
        return;
    }
    const savedData = chat_metadata.dooms_tracker;
    // NOTE: userStats and classicStats restoration removed — system archived
    // Restore quests
    if (savedData.quests) {
        extensionSettings.quests = { ...savedData.quests };
    } else {
        // Initialize with defaults if not present
        extensionSettings.quests = {
            main: "None",
            optional: []
        };
    }
    // Restore committed tracker data from saved metadata
    if (savedData.committedTrackerData) {
        setCommittedTrackerData({ ...savedData.committedTrackerData });
    }
    // Restore last generated data from saved metadata as initial fallback
    if (savedData.lastGeneratedData) {
        setLastGeneratedData({ ...savedData.lastGeneratedData });
    }
    // Sync with the most recent assistant message's per-message swipe data.
    // This is the most reliable source since it's saved as part of the chat messages
    // themselves and won't be lost if the debounced chat_metadata save didn't flush.
    try {
        const chatContext = getContext();
        const chatMessages = chatContext?.chat;
        if (chatMessages && Array.isArray(chatMessages)) {
            // Find the last assistant message
            for (let i = chatMessages.length - 1; i >= 0; i--) {
                const message = chatMessages[i];
                if (!message.is_user && message.extra) {
                    const swipeId = message.swipe_id || 0;
                    // Check both current session data and persisted swipe_info
                    let swipeData = message.extra.dooms_tracker_swipes?.[swipeId];
                    if (!swipeData && message.swipe_info?.[swipeId]?.extra?.dooms_tracker_swipes) {
                        swipeData = message.swipe_info[swipeId].extra.dooms_tracker_swipes[swipeId];
                    }
                    if (swipeData) {
                        // Use per-message data as the truth for display
                        const latestData = {};
                        if (swipeData.quests) latestData.quests = swipeData.quests;
                        if (swipeData.infoBox) latestData.infoBox = swipeData.infoBox;
                        if (swipeData.characterThoughts) latestData.characterThoughts = swipeData.characterThoughts;
                        if (latestData.quests || latestData.infoBox || latestData.characterThoughts) {
                            setLastGeneratedData({
                                quests: latestData.quests || lastGeneratedData.quests,
                                infoBox: latestData.infoBox || lastGeneratedData.infoBox,
                                characterThoughts: latestData.characterThoughts || lastGeneratedData.characterThoughts,
                                html: lastGeneratedData.html || null
                            });
                            // Also update committed data so next generation has the right context
                            setCommittedTrackerData({
                                quests: latestData.quests || committedTrackerData.quests,
                                infoBox: latestData.infoBox || committedTrackerData.infoBox,
                                characterThoughts: latestData.characterThoughts || committedTrackerData.characterThoughts
                            });
                            // Parse quests from the latest data
                            if (latestData.quests) {
                                parseQuests(latestData.quests);
                            }
                            console.log('[Dooms Tracker] Synced display data from last assistant message swipe data');
                        }
                    }
                    break; // Only check the last assistant message
                }
            }
        }
    } catch (e) {
        console.warn('[Dooms Tracker] Per-message data sync skipped:', e.message);
    }
    // NOTE: inventory validation removed — userStats system archived
}
// NOTE: validateInventoryStructure() removed — inventory system archived to src/archived/
/**
 * Migrates old settings format to new trackerConfig format
 * Converts statNames to customStats array and sets up default config
 */
function migrateToTrackerConfig() {
    // Initialize trackerConfig if it doesn't exist
    if (!extensionSettings.trackerConfig) {
        extensionSettings.trackerConfig = {
            userStats: {
                customStats: [],
                showRPGAttributes: true,
                rpgAttributes: [
                    { id: 'str', name: 'STR', enabled: true },
                    { id: 'dex', name: 'DEX', enabled: true },
                    { id: 'con', name: 'CON', enabled: true },
                    { id: 'int', name: 'INT', enabled: true },
                    { id: 'wis', name: 'WIS', enabled: true },
                    { id: 'cha', name: 'CHA', enabled: true }
                ],
                statusSection: {
                    enabled: true,
                    showMoodEmoji: true,
                    customFields: ['Conditions']
                },
                skillsSection: {
                    enabled: false,
                    label: 'Skills'
                }
            },
            infoBox: {
                widgets: {
                    date: { enabled: true, format: 'Weekday, Month, Year' },
                    weather: { enabled: true },
                    temperature: { enabled: true, unit: 'C' },
                    time: { enabled: true },
                    location: { enabled: true },
                    recentEvents: { enabled: true }
                }
            },
            presentCharacters: {
                showEmoji: true,
                showName: true,
                customFields: [
                    { id: 'physicalState', label: 'Physical State', enabled: true, placeholder: 'Visible Physical State (up to three traits)' },
                    { id: 'demeanor', label: 'Demeanor Cue', enabled: true, placeholder: 'Observable Demeanor Cue (one trait)' },
                    { id: 'relationship', label: 'Relationship', enabled: true, type: 'relationship', placeholder: 'Enemy/Neutral/Friend/Lover' },
                    { id: 'internalMonologue', label: 'Internal Monologue', enabled: true, placeholder: 'Internal Monologue (in first person from character\'s POV, up to three sentences long)' }
                ],
                characterStats: {
                    enabled: false,
                    stats: []
                }
            }
        };
    }
    // NOTE: userStats migration code (statNames, customStats, rpgAttributes, classicStats)
    // has been archived to src/archived/archived-features-userstats.js
    // Legacy trackerConfig.userStats data in saved settings is ignored.

    // Ensure quests config exists at top level of trackerConfig
    if (!extensionSettings.trackerConfig.quests) {
        extensionSettings.trackerConfig.quests = { persistInHistory: false };
    }
    // Migrate old presentCharacters structure to new format
    if (extensionSettings.trackerConfig.presentCharacters) {
        const pc = extensionSettings.trackerConfig.presentCharacters;
        // Check if using old flat customFields structure (has 'label' or 'placeholder' keys)
        if (pc.customFields && pc.customFields.length > 0) {
            const hasOldFormat = pc.customFields.some(f => f.label || f.placeholder || f.type === 'relationship');
            if (hasOldFormat) {
                // Extract relationship fields from old customFields
                const relationshipFields = ['Lover', 'Friend', 'Ally', 'Enemy', 'Neutral'];
                // Extract non-relationship fields and convert to new format
                const newCustomFields = pc.customFields
                    .filter(f => f.type !== 'relationship' && f.id !== 'internalMonologue')
                    .map(f => ({
                        id: f.id,
                        name: f.label || f.name || 'Field',
                        enabled: f.enabled !== false,
                        description: f.placeholder || f.description || ''
                    }));
                // Extract thoughts config from old Internal Monologue field
                const thoughtsField = pc.customFields.find(f => f.id === 'internalMonologue');
                const thoughts = {
                    enabled: thoughtsField ? (thoughtsField.enabled !== false) : true,
                    name: 'Thoughts',
                    description: thoughtsField?.placeholder || 'Internal Monologue (in first person from character\'s POV, up to three sentences long)'
                };
                // Update to new structure
                pc.relationshipFields = relationshipFields;
                pc.customFields = newCustomFields;
                pc.thoughts = thoughts;
                saveSettings(); // Persist the migration
            }
        }
        // Ensure new structure exists even if migration wasn't needed
        if (!pc.relationshipFields) {
            pc.relationshipFields = ['Lover', 'Friend', 'Ally', 'Enemy', 'Neutral'];
        }
        if (!pc.relationshipEmojis) {
            // Create default emoji mapping from relationshipFields
            pc.relationshipEmojis = {
                'Lover': '❤️',
                'Friend': '⭐',
                'Ally': '🤝',
                'Enemy': '⚔️',
                'Neutral': '⚖️'
            };
        }
        // Migrate to new relationships structure if not already present
        if (!pc.relationships) {
            pc.relationships = {
                enabled: true, // Default to enabled for backward compatibility
                relationshipEmojis: pc.relationshipEmojis || {
                    'Lover': '❤️',
                    'Friend': '⭐',
                    'Ally': '🤝',
                    'Enemy': '⚔️',
                    'Neutral': '⚖️'
                }
            };
        }
        if (!pc.thoughts) {
            pc.thoughts = {
                enabled: true,
                name: 'Thoughts',
                description: 'Internal Monologue (in first person from character\'s POV, up to three sentences long)'
            };
        }
    }
}
// ============================================================================
// Preset Management Functions
// ============================================================================
/**
 * Gets the entity key for the current character or group
 * @returns {string|null} Entity key in format "char_{id}" or "group_{id}", or null if no character selected
 */
export function getCurrentEntityKey() {
    const context = getContext();
    if (context.groupId) {
        return `group_${context.groupId}`;
    } else if (context.characterId !== undefined && context.characterId !== null) {
        return `char_${context.characterId}`;
    }
    return null;
}
/**
 * Gets the display name for the current character or group
 * @returns {string} Display name for the current entity
 */
export function getCurrentEntityName() {
    const context = getContext();
    if (context.groupId) {
        const group = context.groups?.find(g => g.id === context.groupId);
        return group?.name || 'Group Chat';
    } else if (context.characterId !== undefined && context.characterId !== null) {
        return context.name2 || 'Character';
    }
    return 'No Character';
}
/**
 * Migrates existing trackerConfig to the preset system if presetManager doesn't exist
 * Creates a "Default" preset from the current trackerConfig
 */
export function migrateToPresetManager() {
    if (!extensionSettings.presetManager || Object.keys(extensionSettings.presetManager.presets || {}).length === 0) {
        // Initialize presetManager if it doesn't exist
        if (!extensionSettings.presetManager) {
            extensionSettings.presetManager = {
                presets: {},
                characterAssociations: {},
                activePresetId: null,
                defaultPresetId: null
            };
        }
        // Create default preset from existing trackerConfig
        const defaultPresetId = 'preset_default';
        extensionSettings.presetManager.presets[defaultPresetId] = {
            id: defaultPresetId,
            name: 'Default',
            trackerConfig: JSON.parse(JSON.stringify(extensionSettings.trackerConfig))
        };
        extensionSettings.presetManager.activePresetId = defaultPresetId;
        extensionSettings.presetManager.defaultPresetId = defaultPresetId;
        saveSettings();
    }
}
// NOTE: initializeCustomStatusFields() and ensureStatsHaveMaxValue() removed — userStats system archived
/**
 * Gets all available presets
 * @returns {Object} Map of preset ID to preset data
 */
export function getPresets() {
    return extensionSettings.presetManager?.presets || {};
}
/**
 * Gets a specific preset by ID
 * @param {string} presetId - The preset ID
 * @returns {Object|null} The preset object or null if not found
 */
export function getPreset(presetId) {
    return extensionSettings.presetManager?.presets?.[presetId] || null;
}
/**
 * Gets the currently active preset ID
 * @returns {string|null} The active preset ID or null
 */
export function getActivePresetId() {
    return extensionSettings.presetManager?.activePresetId || null;
}
/**
 * Gets the default preset ID
 * @returns {string|null} The default preset ID or null
 */
export function getDefaultPresetId() {
    return extensionSettings.presetManager?.defaultPresetId || null;
}
/**
 * Sets a preset as the default
 * @param {string} presetId - The preset ID to set as default
 */
export function setDefaultPreset(presetId) {
    if (extensionSettings.presetManager.presets[presetId]) {
        extensionSettings.presetManager.defaultPresetId = presetId;
        saveSettings();
    }
}
/**
 * Checks if the given preset is the default
 * @param {string} presetId - The preset ID to check
 * @returns {boolean} True if it's the default preset
 */
export function isDefaultPreset(presetId) {
    return extensionSettings.presetManager?.defaultPresetId === presetId;
}
/**
 * Creates a new preset from the current trackerConfig
 * @param {string} name - Name for the new preset
 * @returns {string} The ID of the newly created preset
 */
export function createPreset(name) {
    const presetId = `preset_${Date.now()}`;
    extensionSettings.presetManager.presets[presetId] = {
        id: presetId,
        name: name,
        trackerConfig: JSON.parse(JSON.stringify(extensionSettings.trackerConfig)),
        historyPersistence: extensionSettings.historyPersistence
            ? JSON.parse(JSON.stringify(extensionSettings.historyPersistence))
            : null
    };
    // Also set it as the active preset so edits go to the new preset
    extensionSettings.presetManager.activePresetId = presetId;
    saveSettings();
    return presetId;
}
/**
 * Saves the current trackerConfig and historyPersistence to the specified preset
 * @param {string} presetId - The preset ID to save to
 */
export function saveToPreset(presetId) {
    const preset = extensionSettings.presetManager.presets[presetId];
    if (preset) {
        preset.trackerConfig = JSON.parse(JSON.stringify(extensionSettings.trackerConfig));
        preset.historyPersistence = extensionSettings.historyPersistence
            ? JSON.parse(JSON.stringify(extensionSettings.historyPersistence))
            : null;
        saveSettings();
    }
}
/**
 * Loads a preset's trackerConfig and historyPersistence as the active configuration
 * @param {string} presetId - The preset ID to load
 * @returns {boolean} True if loaded successfully, false otherwise
 */
export function loadPreset(presetId) {
    const preset = extensionSettings.presetManager.presets[presetId];
    if (preset && preset.trackerConfig) {
        extensionSettings.trackerConfig = JSON.parse(JSON.stringify(preset.trackerConfig));
        // Load historyPersistence if present, otherwise use defaults
        if (preset.historyPersistence) {
            extensionSettings.historyPersistence = JSON.parse(JSON.stringify(preset.historyPersistence));
        } else {
            // Default values for presets that don't have historyPersistence yet
            extensionSettings.historyPersistence = {
                enabled: false,
                messageCount: 5,
                injectionPosition: 'assistant_message_end',
                contextPreamble: ''
            };
        }
        extensionSettings.presetManager.activePresetId = presetId;
        saveSettings();
        return true;
    }
    return false;
}
/**
 * Renames a preset
 * @param {string} presetId - The preset ID to rename
 * @param {string} newName - The new name for the preset
 */
export function renamePreset(presetId, newName) {
    const preset = extensionSettings.presetManager.presets[presetId];
    if (preset) {
        preset.name = newName;
        saveSettings();
    }
}
/**
 * Deletes a preset
 * @param {string} presetId - The preset ID to delete
 * @returns {boolean} True if deleted, false if it's the last preset (can't delete)
 */
export function deletePreset(presetId) {
    const presets = extensionSettings.presetManager.presets;
    const presetIds = Object.keys(presets);
    // Don't delete if it's the last preset
    if (presetIds.length <= 1) {
        return false;
    }
    // Remove any character associations using this preset
    const associations = extensionSettings.presetManager.characterAssociations;
    for (const entityKey of Object.keys(associations)) {
        if (associations[entityKey] === presetId) {
            delete associations[entityKey];
        }
    }
    // Delete the preset
    delete presets[presetId];
    // If the deleted preset was active, switch to the first available preset
    if (extensionSettings.presetManager.activePresetId === presetId) {
        const remainingIds = Object.keys(presets);
        if (remainingIds.length > 0) {
            loadPreset(remainingIds[0]);
        }
    }
    saveSettings();
    return true;
}
/**
 * Associates the current preset with the current character/group
 */
export function associatePresetWithCurrentEntity() {
    const entityKey = getCurrentEntityKey();
    const activePresetId = extensionSettings.presetManager.activePresetId;
    if (entityKey && activePresetId) {
        extensionSettings.presetManager.characterAssociations[entityKey] = activePresetId;
        saveSettings();
    }
}
/**
 * Removes the preset association for the current character/group
 */
export function removePresetAssociationForCurrentEntity() {
    const entityKey = getCurrentEntityKey();
    if (entityKey && extensionSettings.presetManager.characterAssociations[entityKey]) {
        delete extensionSettings.presetManager.characterAssociations[entityKey];
        saveSettings();
    }
}
/**
 * Gets the preset ID associated with the current character/group
 * @returns {string|null} The associated preset ID or null
 */
export function getPresetForCurrentEntity() {
    const entityKey = getCurrentEntityKey();
    if (entityKey) {
        return extensionSettings.presetManager.characterAssociations[entityKey] || null;
    }
    return null;
}
/**
 * Checks if the current character/group has a preset association
 * @returns {boolean} True if there's an association
 */
export function hasPresetAssociation() {
    const entityKey = getCurrentEntityKey();
    return entityKey && extensionSettings.presetManager.characterAssociations[entityKey] !== undefined;
}
/**
 * Checks if the current character/group is associated with the currently active preset
 * @returns {boolean} True if the current entity is associated with the active preset
 */
export function isAssociatedWithCurrentPreset() {
    const entityKey = getCurrentEntityKey();
    const activePresetId = extensionSettings.presetManager?.activePresetId;
    if (!entityKey || !activePresetId) return false;
    return extensionSettings.presetManager.characterAssociations[entityKey] === activePresetId;
}
/**
 * Auto-switches to the preset associated with the current character/group
 * Called when character changes. Falls back to default preset if no association.
 * @returns {boolean} True if a preset was switched, false otherwise
 */
export function autoSwitchPresetForEntity() {
    const associatedPresetId = getPresetForCurrentEntity();
    // If there's a character-specific preset, use it
    if (associatedPresetId && associatedPresetId !== extensionSettings.presetManager.activePresetId) {
        // Check if the preset still exists
        if (extensionSettings.presetManager.presets[associatedPresetId]) {
            return loadPreset(associatedPresetId);
        } else {
            // Preset was deleted, remove the stale association
            removePresetAssociationForCurrentEntity();
        }
    }
    // No character association - fall back to default preset if set
    if (!associatedPresetId) {
        const defaultPresetId = extensionSettings.presetManager.defaultPresetId;
        if (defaultPresetId &&
            defaultPresetId !== extensionSettings.presetManager.activePresetId &&
            extensionSettings.presetManager.presets[defaultPresetId]) {
            return loadPreset(defaultPresetId);
        }
    }
    return false;
}
/**
 * Exports presets for sharing (without character associations)
 * @param {string[]} presetIds - Array of preset IDs to export, or empty for all
 * @returns {Object} Export data object
 */
export function exportPresets(presetIds = []) {
    const presetsToExport = {};
    const allPresets = extensionSettings.presetManager.presets;
    // If no specific IDs provided, export all
    const idsToExport = presetIds.length > 0 ? presetIds : Object.keys(allPresets);
    for (const id of idsToExport) {
        if (allPresets[id]) {
            presetsToExport[id] = {
                id: allPresets[id].id,
                name: allPresets[id].name,
                trackerConfig: allPresets[id].trackerConfig
            };
        }
    }
    return {
        version: '1.0',
        exportDate: new Date().toISOString(),
        presets: presetsToExport
        // Note: characterAssociations are intentionally NOT exported
    };
}
/**
 * Imports presets from an export file
 * @param {Object} importData - The imported data object
 * @param {boolean} overwrite - If true, overwrites existing presets with same name
 * @returns {number} Number of presets imported
 */
export function importPresets(importData, overwrite = false) {
    if (!importData.presets || typeof importData.presets !== 'object') {
        throw new Error('Invalid import data: missing presets');
    }
    let importCount = 0;
    const existingNames = new Set(
        Object.values(extensionSettings.presetManager.presets).map(p => p.name.toLowerCase())
    );
    for (const [originalId, preset] of Object.entries(importData.presets)) {
        if (!preset.name || !preset.trackerConfig) {
            continue; // Skip invalid presets
        }
        let name = preset.name;
        const nameLower = name.toLowerCase();
        // Check for name collision
        if (existingNames.has(nameLower)) {
            if (overwrite) {
                // Find and delete the existing preset with this name
                for (const [existingId, existingPreset] of Object.entries(extensionSettings.presetManager.presets)) {
                    if (existingPreset.name.toLowerCase() === nameLower) {
                        delete extensionSettings.presetManager.presets[existingId];
                        break;
                    }
                }
            } else {
                // Generate a unique name
                let counter = 1;
                while (existingNames.has(`${nameLower} (${counter})`)) {
                    counter++;
                }
                name = `${preset.name} (${counter})`;
            }
        }
        // Create new preset with new ID
        const newId = `preset_${Date.now()}_${importCount}`;
        extensionSettings.presetManager.presets[newId] = {
            id: newId,
            name: name,
            trackerConfig: JSON.parse(JSON.stringify(preset.trackerConfig))
        };
        existingNames.add(name.toLowerCase());
        importCount++;
    }
    if (importCount > 0) {
        saveSettings();
    }
    return importCount;
}
