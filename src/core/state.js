/**
 * Core State Management Module
 * Centralizes all extension state variables
 */
/**
 * Extension settings - persisted to SillyTavern settings
 */
export let extensionSettings = {
    settingsVersion: 4, // Version number for settings migrations (v4 = FAB widgets enabled by default)
    enabled: true,
    autoUpdate: false,
    updateDepth: 4, // How many messages to include in the context
    generationMode: 'together', // 'separate' or 'together' - whether to generate with main response or separately
    // NOTE: showUserStats and showInventory have been archived to src/archived/archived-features-userstats.js
    showInfoBox: true,
    showCharacterThoughts: true,
    showQuests: true, // Show quests section
    showThoughtsInChat: true, // Show thoughts overlay in chat
    showPortraitBar: true, // Show collapsible portrait bar above chat input
    narratorMode: false, // Use character card as narrator instead of fixed character references
    customNarratorPrompt: '', // Custom narrator mode prompt text (empty = use default)
    customContextInstructionsPrompt: '', // Custom context instructions prompt text (empty = use default)
    loadingIntroMode: 'off', // Loading intro style: 'off', 'film-credits', or 'typewriter'
    enableHtmlPrompt: false, // Enable immersive HTML prompt injection
    customHtmlPrompt: '', // Custom HTML prompt text (empty = use default)
    enableDialogueColoring: false, // Enable dialogue coloring prompt injection
    customDialogueColoringPrompt: '', // Custom dialogue coloring prompt text (empty = use default)
    // NOTE: enableDeceptionSystem, enableOmniscienceFilter, enableCYOA, enableSpotifyMusic
    // and their custom prompt fields have been archived to src/archived-features.js
    enableDynamicWeather: true, // Enable dynamic weather effects based on Info Box weather field (v2: enabled by default)
    weatherBackground: true, // Show weather effects in background (behind chat)
    weatherForeground: false, // Show weather effects in foreground (on top of chat)
    dismissedHolidayPromo: false, // User dismissed the holiday promotion banner
    showHtmlToggle: true, // Show Immersive HTML toggle in main panel
    showDialogueColoringToggle: true, // Show Dialogue Coloring toggle in main panel (enabled by default)
    // NOTE: showDeceptionToggle, showOmniscienceToggle, showCYOAToggle, showSpotifyToggle
    // have been archived to src/archived-features.js
    showDynamicWeatherToggle: true, // Show Dynamic Weather Effects toggle in main panel
    showNarratorMode: true, // Show Narrator Mode toggle in main panel
    showAutoAvatars: true, // Show Auto-generate Avatars toggle in main panel
    skipInjectionsForGuided: 'none', // skip injections for instruct injections and quiet prompts (GuidedGenerations compatibility)
    enableRandomizedPlot: true, // Show randomized plot progression button above chat input
    enableNaturalPlot: true, // Show natural plot progression button above chat input
    // History persistence settings - inject selected tracker data into historical messages
    historyPersistence: {
        enabled: false, // Master toggle for history persistence feature
        messageCount: 5, // Number of messages to include (0 = all available)
        injectionPosition: 'assistant_message_end', // 'user_message_end', 'assistant_message_end', 'extra_user_message', 'extra_assistant_message'
        contextPreamble: '', // Optional custom preamble text (empty = use default short one)
        sendAllEnabledOnRefresh: false // If true, sends all enabled stats from preset instead of only persistInHistory-enabled stats on Refresh RPG Info
    },
    // Scene Tracker settings - customize the scene header bar shown after the last assistant message
    sceneTracker: {
        // Visibility per field
        showTime: true,
        showDate: true,
        showLocation: true,
        showCharacters: true,
        showQuest: true,
        showRecentEvents: true,
        // Layout
        layout: 'grid', // 'grid' (2-col) | 'compact' (inline flow) | 'stacked' (1-col)
        // Colors
        bgColor: '#e94560',
        bgOpacity: 8,
        borderColor: '#e94560',
        borderOpacity: 15,
        accentColor: '#e94560',
        labelColor: '#888888',
        textColor: '#d0d0d0',
        charBadgeBg: '#e94560',
        charBadgeOpacity: 12,
        questIconColor: '#f0c040',
        eventsTextColor: '#999999',
        // Sizing
        fontSize: 82,
        borderRadius: 8,
        padding: 10,
        borderWidth: 3,
    },
    panelPosition: 'right', // 'left', 'right', or 'top'
    theme: 'default', // Theme: default, sci-fi, fantasy, cyberpunk, custom
    customColors: {
        bg: '#1a1a2e',
        bgOpacity: 100,
        accent: '#16213e',
        accentOpacity: 100,
        text: '#eaeaea',
        textOpacity: 100,
        highlight: '#e94560',
        highlightOpacity: 100
    },
    // NOTE: statBarColorLow, statBarColorHigh, statBarColorLowOpacity, statBarColorHighOpacity archived
    enableAnimations: true, // Enable smooth animations for content updates
    mobileFabPosition: {
        top: 'calc(var(--topBarBlockSize) + 60px)',
        right: '12px'
    }, // Saved position for mobile FAB button
    // Mobile FAB widget display options (8-position system around the button)
    mobileFabWidgets: {
        enabled: true, // Master toggle for FAB widgets
        weatherIcon: { enabled: true, position: 0 },      // Weather emoji (☀️, 🌧️, etc.)
        weatherDesc: { enabled: true, position: 1 },      // Weather description text
        clock: { enabled: true, position: 2 },            // Current time display
        date: { enabled: true, position: 3 },             // Date display
        location: { enabled: true, position: 4 }          // Location name
        // NOTE: stats and attributes FAB widgets archived to src/archived/archived-features-userstats.js
    },
    // Desktop strip widget display options (shown in collapsed panel strip)
    desktopStripWidgets: {
        enabled: true, // Master toggle for strip widgets (enabled by default)
        weatherIcon: { enabled: true },      // Weather emoji (☀️, 🌧️, etc.)
        clock: { enabled: true },            // Current time display
        date: { enabled: true },             // Date display
        location: { enabled: true }          // Location name
        // NOTE: stats and attributes strip widgets archived to src/archived/archived-features-userstats.js
    },
    // NOTE: userStats JSON, statNames, and trackerConfig.userStats have been archived
    // to src/archived/archived-features-userstats.js
    // Tracker customization configuration
    trackerConfig: {
        // NOTE: userStats config (customStats, rpgAttributes, statusSection, skillsSection,
        // inventoryPersistInHistory, questsPersistInHistory) archived to src/archived/archived-features-userstats.js
        // Quests tracker configuration (independent top-level tracker)
        quests: {
            persistInHistory: false // Persist quests in historical messages
        },
        infoBox: {
            widgets: {
                date: { enabled: true, format: 'Weekday, Month, Year', persistInHistory: true }, // Date enabled by default for history
                weather: { enabled: true, persistInHistory: true }, // Weather enabled by default for history
                temperature: { enabled: true, unit: 'C', persistInHistory: false }, // 'C' or 'F'
                time: { enabled: true, persistInHistory: true }, // Time enabled by default for history
                location: { enabled: true, persistInHistory: true }, // Location enabled by default for history
                recentEvents: { enabled: true, persistInHistory: false }
            }
        },
        presentCharacters: {
            // Fixed fields (always shown)
            showEmoji: true,
            showName: true,
            // Relationship fields configuration
            relationships: {
                enabled: true,
                // Relationship to emoji mapping (shown on character portraits)
                relationshipEmojis: {
                    'Lover': '❤️',
                    'Friend': '⭐',
                    'Ally': '🤝',
                    'Enemy': '⚔️',
                    'Neutral': '⚖️'
                }
            },
            // Legacy fields kept for backward compatibility
            relationshipFields: ['Lover', 'Friend', 'Ally', 'Enemy', 'Neutral'],
            relationshipEmojis: {
                'Lover': '❤️',
                'Friend': '⭐',
                'Ally': '🤝',
                'Enemy': '⚔️',
                'Neutral': '⚖️'
            },
            // Custom fields (appearance, demeanor, etc. - shown after relationship, separated by |)
            customFields: [
                { id: 'appearance', name: 'Appearance', enabled: true, description: 'Visible physical appearance (clothing, hair, notable features)', persistInHistory: false },
                { id: 'demeanor', name: 'Demeanor', enabled: true, description: 'Observable demeanor or emotional state', persistInHistory: false }
            ],
            // Thoughts configuration (separate line)
            thoughts: {
                enabled: true,
                name: 'Thoughts',
                description: 'Internal Monologue (in first person from character\'s POV, up to three sentences long)',
                persistInHistory: false
            },
            // Character stats toggle (optional feature)
            characterStats: {
                enabled: false,
                customStats: [
                    { id: 'health', name: 'Health', enabled: true },
                    { id: 'arousal', name: 'Arousal', enabled: true }
                ]
            }
        }
    },
    quests: {
        main: "None",        // Current main quest title
        optional: []         // Array of optional quest titles
    },
    infoBox: JSON.stringify({
        date: { value: new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }) },
        weather: { emoji: '☀️', forecast: 'Clear skies' },
        temperature: { value: 20, unit: 'C' },
        time: { start: '00:00', end: '00:00' },
        location: { value: 'Unknown Location' }
    }, null, 2),
    characterThoughts: JSON.stringify({
        characters: []
    }, null, 2),
    // NOTE: level, classicStats, lastDiceRoll, showDiceDisplay, collapsedInventoryLocations,
    // inventoryViewModes archived to src/archived/archived-features-userstats.js
    npcAvatars: {}, // Store custom avatar images for NPCs (key: character name, value: base64 data URI)
    knownCharacters: {}, // Persistent roster of all characters ever seen (key: name, value: { emoji })
    removedCharacters: [], // Blacklist of character names explicitly removed by the user
    characterColors: {}, // Per-character dialogue colors (key: character name, value: hex color string e.g. "#C71585")
    portraitAlignment: 'left', // Portrait bar alignment: 'left' (inline) or 'center'
    portraitPosition: 'above', // Portrait bar position: 'above', 'below', or 'top' (top of screen)
    portraitBarSettings: {
        cardWidth: 110,              // Portrait card width in px
        cardHeight: 150,             // Portrait card height in px
        cardBorderRadius: 8,         // Card corner rounding in px
        cardGap: 8,                  // Gap between cards in px
        barBackground: '#000000',    // Bar background color
        barBackgroundOpacity: 20,    // Bar background opacity (0-100)
        headerColor: '#e94560',      // "Present Characters" header accent color
        cardBorderColor: '#ffffff',  // Card border color
        cardBorderOpacity: 6,        // Card border opacity (0-100)
        hoverGlowColor: '#e94560',   // Hover glow / border accent color
        hoverGlowIntensity: 12,      // Hover glow blur in px
        speakingPulseColor: '#e94560', // Active speaker pulse dot color
        nameOverlayOpacity: 85,      // Name overlay background opacity (0-100)
        absentOpacity: 45,           // Absent character opacity (0-100)
        showHeader: true,            // Show "Present Characters" header row
        showAbsentCharacters: true,  // Show greyed-out absent characters
        showScrollArrows: true,      // Show left/right scroll arrows on hover
    },
    chatBubbleMode: 'off', // Chat bubble display mode: 'off', 'discord', or 'cards'
    ttsHighlightMode: 'off', // TTS sentence highlight: 'off' or 'highlight' (Gradient Glow Pill)
    ttsHighlightSettings: {
        gradientColorLeft: '#e94560',    // Left color of gradient pill
        gradientColorRight: '#9333ea',   // Right color of gradient pill
        gradientOpacity: 30,             // Gradient background opacity (0–100)
        glowIntensity: 16,               // Box-shadow blur radius in px (0 = no glow)
        readOpacity: 35,                 // Already-read text opacity (0–100)
        unreadOpacity: 55,               // Not-yet-read text opacity (0–100)
        overrideTextColor: false,        // Whether to override text color on active sentence
        activeTextColor: '#ffffff',      // Active sentence text color (only if overrideTextColor is true)
        borderRadius: 4,                 // Pill border radius in px
        transitionSpeed: 300,            // Transition duration in ms
    },
    // Combat encounter settings
    encounterSettings: {
        enabled: true, // Show Start Encounter button above chat input
        historyDepth: 8, // Number of recent messages to include in combat initialization
        autoSaveLogs: false // Save detailed combat logs to file
    },
    // Auto avatar generation settings
    autoGenerateAvatars: true, // Master toggle for auto-generating avatars
    avatarLLMCustomInstruction: '', // Custom instruction for LLM prompt generation
    // External API settings for 'external' generation mode
    externalApiSettings: {
        baseUrl: '',           // OpenAI-compatible API base URL (e.g., "https://api.openai.com/v1")
        // apiKey is NOT stored here for security. It is stored in localStorage('dooms_tracker_api_key')
        model: '',             // Model identifier (e.g., "gpt-4o-mini")
        maxTokens: 8192,       // Maximum tokens for generation
        temperature: 0.7       // Temperature setting for generation
    },
    // Lock state for tracker items (v3 JSON format feature)
    lockedItems: {
        // NOTE: stats, skills, inventory lock arrays archived to src/archived/archived-features-userstats.js
        quests: {
            main: false,        // Boolean for main quest lock
            optional: []        // Array of locked optional quest indices (e.g., [0, 2])
        },
        infoBox: {
            date: false,        // Boolean for date widget lock
            weather: false,     // Boolean for weather widget lock
            temperature: false, // Boolean for temperature widget lock
            time: false,        // Boolean for time widget lock
            location: false,    // Boolean for location widget lock
            recentEvents: false // Boolean for recent events widget lock
        },
        characters: {}          // Object mapping character names to their locked fields (e.g., {"Sarah": {relationship: true, thoughts: false}})
    },
    // Lorebook Manager - campaign grouping for World Info lorebooks
    lorebook: {
        enabled: true,
        campaigns: {},          // uuid -> { id, name, icon, color, books: [WI filename strings] }
        campaignOrder: [],      // array of campaign UUIDs for display ordering
        collapsedCampaigns: [], // UUIDs of collapsed campaign groups (UI state)
        expandedBooks: [],      // WI filenames of expanded book spines (UI state)
        lastActiveTab: 'all',   // last selected campaign tab
        lastFilter: 'all',      // 'all', 'active', 'inactive'
        lastSearch: ''           // last search query
    },
    // Preset management for tracker configurations
    presetManager: {
        // Map of preset ID to preset data (contains name and trackerConfig)
        presets: {},
        // Map of character/group entity to preset ID (e.g., "char_0": "preset_123", "group_abc": "preset_456")
        // Note: This is stored separately and NOT exported with presets
        characterAssociations: {},
        // Currently active preset ID
        activePresetId: null,
        // Default preset ID (used when no character association exists)
        defaultPresetId: null
    }
};
/**
 * Last generated data from AI response
 */
export let lastGeneratedData = {
    quests: null,
    infoBox: null,
    characterThoughts: null,
    html: null
};
/**
 * Tracks the "committed" tracker data that should be used as source for next generation
 * This gets updated when user sends a new message or first time generation
 */
export let committedTrackerData = {
    quests: null,
    infoBox: null,
    characterThoughts: null,
    html: null
};
/**
 * Session-only storage for LLM-generated avatar prompts
 * Maps character names to their generated prompts
 * Resets on new chat (not persisted to extensionSettings)
 */
export let sessionAvatarPrompts = {};
export function setSessionAvatarPrompt(characterName, prompt) {
    sessionAvatarPrompts[characterName] = prompt;
}
export function getSessionAvatarPrompt(characterName) {
    return sessionAvatarPrompts[characterName] || null;
}
export function clearSessionAvatarPrompts() {
    sessionAvatarPrompts = {};
}
/**
 * Tracks whether the last action was a swipe (for separate mode)
 * Used to determine whether to commit lastGeneratedData to committedTrackerData
 */
export let lastActionWasSwipe = false;
/**
 * Flag indicating if generation is in progress
 */
export let isGenerating = false;
/**
 * Flag indicating if we're actively expecting a new message from generation
 * (as opposed to loading chat history)
 */
export let isAwaitingNewMessage = false;
/**
 * Debug logs array for troubleshooting
 */
export let debugLogs = [];
/**
 * Add a debug log entry
 * @param {string} message - The log message
 * @param {any} data - Optional data to log
 */
export function addDebugLog(message, data = null) {
    const timestamp = new Date().toISOString();
    debugLogs.push({ timestamp, message, data });
    // Keep only last 100 logs
    if (debugLogs.length > 100) {
        debugLogs.shift();
    }
}
// NOTE: FEATURE_FLAGS.useNewInventory archived to src/archived/archived-features-userstats.js
/**
 * Fallback avatar image (base64-encoded SVG with "?" icon)
 * Using base64 to avoid quote-encoding issues in HTML attributes
 */
export const FALLBACK_AVATAR_DATA_URI = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMDAiIGhlaWdodD0iMTAwIj48cmVjdCB3aWR0aD0iMTAwIiBoZWlnaHQ9IjEwMCIgZmlsbD0iI2NjY2NjYyIgb3BhY2l0eT0iMC4zIi8+PHRleHQgeD0iNTAlIiB5PSI1MCUiIHRleHQtYW5jaG9yPSJtaWRkbGUiIGR5PSIuM2VtIiBmaWxsPSIjNjY2IiBmb250LXNpemU9IjQwIj4/PC90ZXh0Pjwvc3ZnPg==';
/**
 * UI Element References (jQuery objects)
 */
export let $panelContainer = null;
export let $infoBoxContainer = null;
export let $thoughtsContainer = null;
export let $questsContainer = null;
// NOTE: $userStatsContainer, $inventoryContainer archived to src/archived/archived-features-userstats.js
export let $musicPlayerContainer = null;
export let isPlotProgression = false;
// NOTE: pendingDiceRoll archived to src/archived/archived-features-userstats.js
/**
 * State setters - provide controlled mutation of state variables
 */
export function setExtensionSettings(newSettings) {
    extensionSettings = newSettings;
}
export function updateExtensionSettings(updates) {
    Object.assign(extensionSettings, updates);
}
export function setLastGeneratedData(data) {
    lastGeneratedData = data;
}
export function updateLastGeneratedData(updates) {
    Object.assign(lastGeneratedData, updates);
}
export function setCommittedTrackerData(data) {
    committedTrackerData = data;
}
export function updateCommittedTrackerData(updates) {
    Object.assign(committedTrackerData, updates);
}
export function setLastActionWasSwipe(value) {
    lastActionWasSwipe = value;
}
export function setIsGenerating(value) {
    isGenerating = value;
}
export function setIsAwaitingNewMessage(value) {
    isAwaitingNewMessage = value;
}
export function setPanelContainer($element) {
    $panelContainer = $element;
}
export function setInfoBoxContainer($element) {
    $infoBoxContainer = $element;
}
export function setThoughtsContainer($element) {
    $thoughtsContainer = $element;
}
export function setQuestsContainer($element) {
    $questsContainer = $element;
}
// NOTE: setUserStatsContainer, setInventoryContainer, setPendingDiceRoll, getPendingDiceRoll archived
export function setMusicPlayerContainer($element) { $musicPlayerContainer = $element; }
export function setIsPlotProgression(value) { isPlotProgression = value; }
