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
    syncedExpressionPortraits,
    setSyncedExpressionPortraits,
    clearSyncedExpressionPortraits,
    syncedExpressionLabels,
    setSyncedExpressionLabels,
    clearSyncedExpressionLabels,
} from './state.js';
import { migrateToV3JSON } from '../utils/jsonMigration.js';
import { scheduleAvatarMigration, retireAvatarBackupIfComplete } from '../utils/avatarMigration.js';
import { parseQuests } from '../systems/generation/parser.js';
import { applyCharacterAliases } from '../systems/features/characterAliases.js';
import { extensionName } from './config.js';
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
            // fabPosition only exists in saved settings once the user drags
            // the D button — the 'center' DEFAULT is for fresh installs only
            // and must not leak into existing setups through the merge.
            if (savedSettings.fabPosition === undefined) {
                delete extensionSettings.fabPosition;
            }
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
            // Migration to version 7: Add new optional infoBox widgets (moonPhase, tension, timeSinceRest, conditions, terrain)
            // These were added after many users already had saved settings, so old saves won't have them.
            if (currentVersion < 7) {
                const widgets = extensionSettings.trackerConfig?.infoBox?.widgets;
                if (widgets) {
                    if (!widgets.moonPhase)     widgets.moonPhase     = { enabled: false, persistInHistory: false };
                    if (!widgets.tension)       widgets.tension       = { enabled: false, persistInHistory: false };
                    if (!widgets.timeSinceRest) widgets.timeSinceRest = { enabled: false, persistInHistory: false };
                    if (!widgets.conditions)    widgets.conditions    = { enabled: false, persistInHistory: false };
                    if (!widgets.terrain)       widgets.terrain       = { enabled: false, persistInHistory: false };
                }
                // Also migrate all saved presets so they get the new widgets too
                const presets = extensionSettings.presetManager?.presets;
                if (presets) {
                    for (const presetId of Object.keys(presets)) {
                        const presetWidgets = presets[presetId]?.trackerConfig?.infoBox?.widgets;
                        if (presetWidgets) {
                            if (!presetWidgets.moonPhase)     presetWidgets.moonPhase     = { enabled: false, persistInHistory: false };
                            if (!presetWidgets.tension)       presetWidgets.tension       = { enabled: false, persistInHistory: false };
                            if (!presetWidgets.timeSinceRest) presetWidgets.timeSinceRest = { enabled: false, persistInHistory: false };
                            if (!presetWidgets.conditions)    presetWidgets.conditions    = { enabled: false, persistInHistory: false };
                            if (!presetWidgets.terrain)       presetWidgets.terrain       = { enabled: false, persistInHistory: false };
                        }
                    }
                }
                extensionSettings.settingsVersion = 7;
                settingsChanged = true;
            }
            // Migration to version 8: Sync sceneTracker show-flags → infoBox widget enabled flags.
            // Before this version the two settings were independent; users who turned on the
            // Scene Tracker show-toggle (thinking it would make the AI generate the field) had
            // sceneTracker.showX = true but widgets[x].enabled = false, so the AI never produced
            // the field. This migration copies the user's intent from showX into widgets[x].enabled.
            if (currentVersion < 8) {
                const st = extensionSettings.sceneTracker || {};
                const widgets = extensionSettings.trackerConfig?.infoBox?.widgets;
                if (widgets) {
                    const syncPairs = [
                        ['showMoonPhase',    'moonPhase'],
                        ['showTension',      'tension'],
                        ['showTimeSinceRest','timeSinceRest'],
                        ['showConditions',   'conditions'],
                        ['showTerrain',      'terrain'],
                    ];
                    for (const [showKey, widgetKey] of syncPairs) {
                        if (st[showKey] === true) {
                            if (!widgets[widgetKey]) widgets[widgetKey] = { persistInHistory: false };
                            widgets[widgetKey].enabled = true;
                        }
                    }
                }
                extensionSettings.settingsVersion = 8;
                settingsChanged = true;
            }
            // Migration to version 9: Ensure core infoBox widgets (time, date, location, recentEvents)
            // are always enabled. These are fundamental fields that should never be disabled — but
            // users who had settings saved from an earlier buggy state could have them as enabled:false,
            // causing the AI to skip them entirely and the ticker panel to show only optional fields.
            if (currentVersion < 9) {
                const widgets = extensionSettings.trackerConfig?.infoBox?.widgets;
                if (widgets) {
                    const coreWidgets = ['time', 'date', 'location', 'recentEvents'];
                    for (const key of coreWidgets) {
                        if (!widgets[key]) widgets[key] = { persistInHistory: true };
                        widgets[key].enabled = true;
                    }
                }
                extensionSettings.settingsVersion = 9;
                settingsChanged = true;
            }

            // Migration to version 10: Add Doom Counter defaults
            if (currentVersion < 10) {
                if (!extensionSettings.doomCounter) {
                    extensionSettings.doomCounter = {
                        enabled: false,
                        lowTensionThreshold: 5,
                        countdownLength: 3,
                        twistChoiceCount: 3,
                        lowTensionCeiling: 4,
                    };
                }
                // Clean up old lowTensionValues if it exists (was string-based, now numeric)
                if (extensionSettings.doomCounter.lowTensionValues) {
                    delete extensionSettings.doomCounter.lowTensionValues;
                    if (extensionSettings.doomCounter.lowTensionCeiling === undefined) {
                        extensionSettings.doomCounter.lowTensionCeiling = 4;
                    }
                }
                extensionSettings.settingsVersion = 10;
                settingsChanged = true;
            }
            // Migration to version 11: Ensure weather and temperature widgets exist in trackerConfig
            // These fields were missing from buildInfoBoxJSONInstruction(), so existing users
            // may not have them in their saved widget config even though the defaults include them.
            if (currentVersion < 11) {
                const widgets = extensionSettings.trackerConfig?.infoBox?.widgets;
                if (widgets) {
                    if (!widgets.weather) {
                        widgets.weather = { enabled: true, persistInHistory: true };
                    }
                    if (!widgets.temperature) {
                        widgets.temperature = { enabled: true, unit: 'C', persistInHistory: false };
                    }
                }
                extensionSettings.settingsVersion = 11;
                settingsChanged = true;
            }
            // Migration to version 12: Initialize Character Expressions portrait sync toggle
            if (currentVersion < 12) {
                if (extensionSettings.syncExpressionsToPresentCharacters === undefined) {
                    extensionSettings.syncExpressionsToPresentCharacters = false;
                }
                extensionSettings.settingsVersion = 12;
                settingsChanged = true;
            }
            // Migration to version 13: Initialize native expression display hide toggle
            if (currentVersion < 13) {
                if (extensionSettings.hideDefaultExpressionDisplay === undefined) {
                    extensionSettings.hideDefaultExpressionDisplay = false;
                }
                extensionSettings.settingsVersion = 13;
                settingsChanged = true;
            }
            // Migration to version 14: previously initialized Name Ban settings.
            // Name Ban was removed (superseded by Character Aliases in the
            // Workshop) — keeping the version bump so the chain stays monotonic.
            if (currentVersion < 14) {
                extensionSettings.settingsVersion = 14;
                settingsChanged = true;
            }
            // Migration to version 15: Add expression classifier settings
            if (currentVersion < 15) {
                if (extensionSettings.expressionClassifierApi === undefined) {
                    extensionSettings.expressionClassifierApi = 'local';
                }
                if (extensionSettings.expressionBatchMode === undefined) {
                    extensionSettings.expressionBatchMode = true;
                }
                extensionSettings.settingsVersion = 15;
                settingsChanged = true;
            }
            // Migration to version 16: previously seeded a Character Workshop
            // feature flag. Workshop now follows extensionSettings.showPortraitBar
            // (PCP toggle) instead — keeping the version bump so the migration
            // chain stays monotonic, no property writes needed.
            if (currentVersion < 16) {
                extensionSettings.settingsVersion = 16;
                settingsChanged = true;
            }
            // Migration to version 17: Initialize show-expression-in-tooltip
            if (currentVersion < 17) {
                if (extensionSettings.showExpressionInTooltip === undefined) {
                    extensionSettings.showExpressionInTooltip = false;
                }
                extensionSettings.settingsVersion = 17;
                settingsChanged = true;
            }
            // Migration to version 18: Initialize side-mode portrait-bar
            // column count. portraitSidePush was seeded here in an earlier
            // build and then removed in cw-41 — the property lingers as
            // harmless junk in old saves.
            if (currentVersion < 18) {
                if (extensionSettings.portraitSideColumns === undefined) {
                    extensionSettings.portraitSideColumns = 1;
                }
                extensionSettings.settingsVersion = 18;
                settingsChanged = true;
            }
            // Migration to version 19: Initialize pinnedCharacters list
            // (global pin-to-top state for the Character Roster).
            if (currentVersion < 19) {
                if (!Array.isArray(extensionSettings.pinnedCharacters)) {
                    extensionSettings.pinnedCharacters = [];
                }
                extensionSettings.settingsVersion = 19;
                settingsChanged = true;
            }
            // Migration to version 20: Initialize portraitSideHeight
            // ('auto' = fit content and vertically center, 'full' = top to
            // bottom like earlier side-mode behavior).
            if (currentVersion < 20) {
                if (extensionSettings.portraitSideHeight !== 'full') {
                    extensionSettings.portraitSideHeight = 'auto';
                }
                extensionSettings.settingsVersion = 20;
                settingsChanged = true;
            }
            // Migration to version 21: Initialize characterRelationships —
            // persistent per-character relationship overrides set from the
            // Workshop (Lover / Friend / Ally / Enemy / Neutral). When set,
            // they win over the AI's per-turn classification.
            if (currentVersion < 21) {
                if (!extensionSettings.characterRelationships || typeof extensionSettings.characterRelationships !== 'object') {
                    extensionSettings.characterRelationships = {};
                }
                extensionSettings.settingsVersion = 21;
                settingsChanged = true;
            }
            // Migration to version 22: Initialize injectAttachPortrait toggle
            // (Workshop's "Attach portrait to message" — vision-model addon).
            if (currentVersion < 22) {
                if (extensionSettings.injectAttachPortrait !== true) {
                    extensionSettings.injectAttachPortrait = false;
                }
                extensionSettings.settingsVersion = 22;
                settingsChanged = true;
            }
            // Migration to version 23: Adopt orphaned soft-removed characters
            // into the Workshop. Pre-1.9.2 "Send to Workshop" could leave a
            // character in removedCharacters with no knownCharacters entry —
            // then nothing surfaced them in the Workshop / Roster, so the
            // "Return to panel" restore path was unreachable. Ensure every
            // name in removedCharacters also has a roster record.
            if (currentVersion < 23) {
                const removed = extensionSettings.removedCharacters;
                if (Array.isArray(removed) && removed.length) {
                    if (!extensionSettings.knownCharacters || typeof extensionSettings.knownCharacters !== 'object') {
                        extensionSettings.knownCharacters = {};
                    }
                    const known = extensionSettings.knownCharacters;
                    const userChars = extensionSettings.userCharacters || {};
                    // Case-insensitive set of user-persona names for the
                    // collision guard — removedCharacters entries can carry
                    // whatever casing the original soft-remove pushed.
                    const userLower = new Set(Object.keys(userChars).map(k => k.toLowerCase()));
                    const knownLower = new Set(Object.keys(known).map(k => k.toLowerCase()));
                    let adopted = 0;
                    for (const name of removed) {
                        // Don't adopt names that are already user personas —
                        // doing so creates an NPC twin and the Roster shows
                        // the same name in both Characters and Users tabs.
                        if (typeof name !== 'string' || !name) continue;
                        const lower = name.toLowerCase();
                        if (knownLower.has(lower) || userLower.has(lower)) continue;
                        known[name] = { emoji: '👤' };
                        knownLower.add(lower);
                        adopted++;
                    }
                    if (adopted) {
                        console.log(`[Dooms Tracker] Migration v23: adopted ${adopted} orphaned removed-characters into Workshop`);
                    }
                }
                extensionSettings.settingsVersion = 23;
                settingsChanged = true;
            }

            // Migration to version 24: Move cropped portrait base64 data URLs
            // out of extensionSettings (npcAvatars, npcAvatarsFullRes, and
            // userCharacters[*].avatar/avatarFullRes) and onto disk under
            // data/default-user/user/images/des-portraits/. The legacy fields
            // are reused — they hold absolute /user/images/... URLs after
            // migration, which renders identically via <img>.src in v1.10.7
            // and earlier. Async; schedule from idle and let the migration
            // bump settingsVersion to 24 only after every upload succeeds.
            if (currentVersion < 24) {
                scheduleAvatarMigration(saveSettings);
            } else {
                // Migration already completed and persisted in a prior session —
                // the corruption-recovery snapshot is now dead weight (a full
                // duplicate of every avatar's base64). Reclaim that memory.
                retireAvatarBackupIfComplete(saveSettings);
            }

            // Auto Portraits were added after the expression system. They are
            // intentionally opt-in and default back to the existing sprite flow.
            if (extensionSettings.portraitEnhancementMode === undefined) {
                extensionSettings.portraitEnhancementMode = 'expressions';
                settingsChanged = true;
            }
            if (extensionSettings.autoPortraitMode === undefined) {
                extensionSettings.autoPortraitMode = 'only_missing';
                settingsChanged = true;
            }
            if (!extensionSettings.generatedPortraits || typeof extensionSettings.generatedPortraits !== 'object') {
                extensionSettings.generatedPortraits = {};
                settingsChanged = true;
            }
            if (extensionSettings.customAutoPortraitPrompt === undefined) {
                extensionSettings.customAutoPortraitPrompt = '';
                settingsChanged = true;
            }

            // ── Rebuild guards: keys whose DEFAULT changed (or is new) on the
            // Rebuild branch. CRITICAL: these must test savedSettings — the
            // user's persisted blob — NOT extensionSettings, which after the
            // shallow merge above always carries the state.js default and is
            // therefore never undefined. (Audit finding: the merged-object
            // form made every one of these guards dead code.)
            // For each key absent from the saved blob, an EXISTING install
            // keeps the behavior it had on main; only fresh installs get the
            // new-player defaults from state.js.

            // Compact tracker prompts: existing installs keep the verbose
            // prompts their setups were tuned on.
            if (savedSettings.compactPrompts === undefined) {
                extensionSettings.compactPrompts = false;
                settingsChanged = true;
            }

            // New-player profile flips — existing installs keep main's
            // behavior for any key their blob doesn't carry (covers very old
            // installs and blobs imported from the legacy extension keys).
            if (savedSettings.showQuests === undefined) {
                extensionSettings.showQuests = true;
                settingsChanged = true;
            }
            if (savedSettings.enableDialogueColoring === undefined) {
                extensionSettings.enableDialogueColoring = false;
                settingsChanged = true;
            }
            if (savedSettings.chatBubbleMode === undefined) {
                extensionSettings.chatBubbleMode = 'off';
                settingsChanged = true;
            }
            if (savedSettings.lorebook === undefined) {
                // Lore Library was enabled-by-default on main; an existing
                // install without the object must keep it on, not inherit
                // the fresh-install default (off).
                extensionSettings.lorebook.enabled = true;
                settingsChanged = true;
            }

            // What's New: drop the retired interim-build key. Deliberately
            // NOT carried into whatsNewOptOut — it was set by the removed
            // in-dialog button, whose permanence was the bug. (Seen-version /
            // performanceMode need no guard: their fresh defaults already
            // match the desired existing-user state.)
            if (extensionSettings.whatsNewDisabled !== undefined) {
                delete extensionSettings.whatsNewDisabled;
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
    } catch (error) {
        console.error('[Dooms Tracker] Error loading settings:', error);
        console.error('[Dooms Tracker] Error details:', error.message, error.stack);
        console.warn('[Dooms Tracker] Using default settings due to load error');
        // Settings will remain at defaults from state.js
    }
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
 * @param {Object} [options]
 * @param {boolean} [options.immediate=false] Write through with
 *   saveChatConditional instead of the debounced save. Use at commit points
 *   (generation end, modal save) — a debounced write is silently lost if the
 *   user switches chats before it fires.
 */
export function saveChatData({ immediate = false } = {}) {
    if (!chat_metadata) {
        return;
    }
    const trackerData = {
        quests: extensionSettings.quests,
        lastGeneratedData: lastGeneratedData,
        committedTrackerData: committedTrackerData,
        syncedExpressionPortraits: syncedExpressionPortraits,
        syncedExpressionLabels: syncedExpressionLabels,
        doomCounterState: chat_metadata.dooms_tracker?.doomCounterState || null,
        characterSheets: chat_metadata.dooms_tracker?.characterSheets || {},
        timestamp: Date.now()
    };
    // Persist per-chat character tracking data when enabled
    if (extensionSettings.perChatCharacterTracking) {
        trackerData.knownCharacters = chat_metadata.dooms_tracker?.knownCharacters || {};
        trackerData.removedCharacters = chat_metadata.dooms_tracker?.removedCharacters || [];
        trackerData.characterColors = chat_metadata.dooms_tracker?.characterColors || {};
        trackerData.bannedCharacters = chat_metadata.dooms_tracker?.bannedCharacters || [];
    }
    chat_metadata.dooms_tracker = trackerData;
    // Debounced save by default — the standard SillyTavern pattern; immediate
    // saves on every UI edit caused performance issues. Commit points pass
    // { immediate: true } so the write can't be dropped by a fast chat switch.
    if (immediate) {
        Promise.resolve(saveChatConditional()).catch(err => console.error('[DES] chat save failed', err));
    } else {
        saveChatDebounced();
    }
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
    if (!chat_metadata) {
        return;
    }
    if (!chat_metadata.dooms_tracker) {
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
        // Scaffold per-chat character tracking for new chats so accessors
        // never fall through to global state when the toggle is on.
        if (extensionSettings.perChatCharacterTracking) {
            chat_metadata.dooms_tracker = {
                knownCharacters: {},
                removedCharacters: [],
                characterColors: {},
                characterSheets: {},
                timestamp: Date.now()
            };
            saveChatDebounced();
        }
        clearSyncedExpressionPortraits();
        return;
    }
    const savedData = chat_metadata.dooms_tracker;
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
    // Restore synced expression portraits for this chat
    if (savedData.syncedExpressionPortraits && typeof savedData.syncedExpressionPortraits === 'object') {
        setSyncedExpressionPortraits(savedData.syncedExpressionPortraits);
    } else {
        clearSyncedExpressionPortraits();
    }
    // Restore synced expression labels (used by the portrait-tooltip toggle).
    if (savedData.syncedExpressionLabels && typeof savedData.syncedExpressionLabels === 'object') {
        setSyncedExpressionLabels(savedData.syncedExpressionLabels);
    } else {
        clearSyncedExpressionLabels();
    }
    // Restore Doom Counter state (per-chat counter data)
    // This is exported so doomCounter.js can access it on chat load
    if (savedData.doomCounterState) {
        chat_metadata.dooms_tracker.doomCounterState = savedData.doomCounterState;
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
                        // Canonicalize alias names on restore — stored data may
                        // predate an alias (or the aliases feature itself).
                        if (swipeData.characterThoughts) latestData.characterThoughts = applyCharacterAliases(swipeData.characterThoughts);
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

    // Initialize per-chat character tracking data if enabled and not yet present
    if (extensionSettings.perChatCharacterTracking && chat_metadata?.dooms_tracker) {
        if (!chat_metadata.dooms_tracker.knownCharacters) {
            chat_metadata.dooms_tracker.knownCharacters = {};
        }
        if (!chat_metadata.dooms_tracker.removedCharacters) {
            chat_metadata.dooms_tracker.removedCharacters = [];
        }
        if (!chat_metadata.dooms_tracker.characterColors) {
            chat_metadata.dooms_tracker.characterColors = {};
        }

        // Adopt orphaned soft-removed characters into this chat's Workshop.
        // Mirrors the global v23 settings migration — per-chat roster data
        // saved before 1.9.2 could strand characters with a removedCharacters
        // entry but no knownCharacters record, which left them unreachable
        // from the Workshop / Roster.
        try {
            const meta = chat_metadata.dooms_tracker;
            if (Array.isArray(meta.removedCharacters) && meta.removedCharacters.length) {
                const userChars = extensionSettings.userCharacters || {};
                const userLower = new Set(Object.keys(userChars).map(k => k.toLowerCase()));
                const knownLower = new Set(Object.keys(meta.knownCharacters).map(k => k.toLowerCase()));
                let adopted = 0;
                for (const name of meta.removedCharacters) {
                    // Skip user-persona names — adopting them as NPCs creates
                    // a duplicate that shows in both Roster tabs and the PCP.
                    if (typeof name !== 'string' || !name) continue;
                    const lower = name.toLowerCase();
                    if (knownLower.has(lower) || userLower.has(lower)) continue;
                    meta.knownCharacters[name] = { emoji: '👤' };
                    knownLower.add(lower);
                    adopted++;
                }
                if (adopted) {
                    console.log(`[Dooms Tracker] Per-chat orphan-adopt: moved ${adopted} removed-characters into Workshop`);
                    saveChatDebounced();
                }
            }
        } catch (e) {
            console.warn('[Dooms Tracker] Per-chat orphan-adopt failed:', e.message);
        }
    }
}

// ─────────────────────────────────────────────
//  Per-chat character tracking accessors
// ─────────────────────────────────────────────

/**
 * Returns the active knownCharacters object.
 * When perChatCharacterTracking is ON, reads from chat_metadata; otherwise from extensionSettings.
 * @returns {Object} knownCharacters map (name → { emoji })
 */
export function getActiveKnownCharacters() {
    if (extensionSettings.perChatCharacterTracking && chat_metadata?.dooms_tracker) {
        if (!chat_metadata.dooms_tracker.knownCharacters) {
            chat_metadata.dooms_tracker.knownCharacters = {};
        }
        return chat_metadata.dooms_tracker.knownCharacters;
    }
    if (!extensionSettings.knownCharacters) {
        extensionSettings.knownCharacters = {};
    }
    return extensionSettings.knownCharacters;
}

/**
 * Returns the active removedCharacters array.
 * When perChatCharacterTracking is ON, reads from chat_metadata; otherwise from extensionSettings.
 * @returns {Array<string>} removedCharacters list
 */
export function getActiveRemovedCharacters() {
    if (extensionSettings.perChatCharacterTracking && chat_metadata?.dooms_tracker) {
        if (!chat_metadata.dooms_tracker.removedCharacters) {
            chat_metadata.dooms_tracker.removedCharacters = [];
        }
        return chat_metadata.dooms_tracker.removedCharacters;
    }
    if (!extensionSettings.removedCharacters) {
        extensionSettings.removedCharacters = [];
    }
    return extensionSettings.removedCharacters;
}

/**
 * Returns the active bannedCharacters array — names the user has explicitly
 * marked as "not in this scene, ever". Workshop pushes a standing extension
 * prompt so the AI is told every turn not to include them.
 * @returns {Array<string>}
 */
export function getActiveBannedCharacters() {
    if (extensionSettings.perChatCharacterTracking && chat_metadata?.dooms_tracker) {
        if (!Array.isArray(chat_metadata.dooms_tracker.bannedCharacters)) {
            chat_metadata.dooms_tracker.bannedCharacters = [];
        }
        return chat_metadata.dooms_tracker.bannedCharacters;
    }
    if (!Array.isArray(extensionSettings.bannedCharacters)) {
        extensionSettings.bannedCharacters = [];
    }
    return extensionSettings.bannedCharacters;
}

/**
 * Returns the active characterColors object.
 * When perChatCharacterTracking is ON, reads from chat_metadata; otherwise from extensionSettings.
 * @returns {Object} characterColors map (name → hex color)
 */
export function getActiveCharacterColors() {
    if (extensionSettings.perChatCharacterTracking && chat_metadata?.dooms_tracker) {
        if (!chat_metadata.dooms_tracker.characterColors) {
            chat_metadata.dooms_tracker.characterColors = {};
        }
        return chat_metadata.dooms_tracker.characterColors;
    }
    if (!extensionSettings.characterColors) {
        extensionSettings.characterColors = {};
    }
    return extensionSettings.characterColors;
}

/**
 * Persists a character roster change to the correct storage location.
 * When perChatCharacterTracking is ON, saves to chat_metadata; otherwise to extensionSettings.
 */
export function saveCharacterRosterChange() {
    if (extensionSettings.perChatCharacterTracking) {
        saveChatData();
    } else {
        saveSettings();
    }
}

/**
 * Gets the current Doom Counter state from chat metadata.
 * @returns {Object} The doom counter state, or defaults if not present
 */
export function getDoomCounterState() {
    const defaults = {
        lowStreakCount: 0,
        countdownActive: false,
        countdownCount: extensionSettings.doomCounter?.countdownLength || 3,
        pendingTwist: null,
        triggered: false,
        totalTwistsTriggered: 0
    };
    if (!chat_metadata?.dooms_tracker?.doomCounterState) {
        return { ...defaults };
    }
    return { ...defaults, ...chat_metadata.dooms_tracker.doomCounterState };
}

/**
 * Saves the Doom Counter state to chat metadata.
 * @param {Object} state - The doom counter state to save
 */
export function setDoomCounterState(state) {
    if (!chat_metadata) return;
    if (!chat_metadata.dooms_tracker) {
        chat_metadata.dooms_tracker = {};
    }
    chat_metadata.dooms_tracker.doomCounterState = state;
    // Immediate save: this fires at most once per AI message, and a debounced
    // write is lost if the user switches chats before it flushes.
    Promise.resolve(saveChatConditional()).catch(err => console.error('[DES] doom counter save failed', err));
}

/**
 * Whether Knives are enabled for the current chat. Knives themselves live on
 * character records (Character Workshop); this per-chat switch controls
 * whether the Doom Counter draws them when it triggers. Default: off.
 * @returns {boolean}
 */
export function isDoomKnivesEnabled() {
    return chat_metadata?.dooms_tracker?.knivesEnabled === true;
}

/**
 * Enables/disables Knives for the current chat.
 * @param {boolean} enabled
 */
export function setDoomKnivesEnabled(enabled) {
    if (!chat_metadata) return;
    if (!chat_metadata.dooms_tracker) {
        chat_metadata.dooms_tracker = {};
    }
    chat_metadata.dooms_tracker.knivesEnabled = !!enabled;
    // Immediate save: fires once per toggle click; see setDoomCounterState.
    Promise.resolve(saveChatConditional()).catch(err => console.error('[DES] knives toggle save failed', err));
}

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
        // Migrate old presets: ensure all new optional infoBox widgets exist.
        // Presets saved before these fields were added won't have them — fill in defaults.
        const widgets = extensionSettings.trackerConfig?.infoBox?.widgets;
        if (widgets) {
            if (!widgets.moonPhase)     widgets.moonPhase     = { enabled: false, persistInHistory: false };
            if (!widgets.tension)       widgets.tension       = { enabled: false, persistInHistory: false };
            if (!widgets.timeSinceRest) widgets.timeSinceRest = { enabled: false, persistInHistory: false };
            if (!widgets.conditions)    widgets.conditions    = { enabled: false, persistInHistory: false };
            if (!widgets.terrain)       widgets.terrain       = { enabled: false, persistInHistory: false };
        }
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
