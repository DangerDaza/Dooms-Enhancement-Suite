import { getContext, renderExtensionTemplateAsync, extension_settings as st_extension_settings } from '../../../extensions.js';
import { eventSource, event_types, substituteParams, chat, saveSettingsDebounced, chat_metadata, saveChatDebounced, user_avatar, getThumbnailUrl, characters, this_chid, extension_prompt_types, extension_prompt_roles, setExtensionPrompt, reloadCurrentChat, Generate, getRequestHeaders, messageFormatting } from '../../../../script.js';
import { selected_group, getGroupMembers } from '../../../group-chats.js';
import { power_user } from '../../../power-user.js';
// Core modules
import { extensionName, extensionFolderPath } from './src/core/config.js';
import { i18n } from './src/core/i18n.js';
import { migrateToV3JSON } from './src/utils/jsonMigration.js';
import {
    extensionSettings,
    lastGeneratedData,
    committedTrackerData,
    lastActionWasSwipe,
    isGenerating,
    FALLBACK_AVATAR_DATA_URI,
    $infoBoxContainer,
    $thoughtsContainer,
    $questsContainer,
    setExtensionSettings,
    updateExtensionSettings,
    setLastGeneratedData,
    updateLastGeneratedData,
    setCommittedTrackerData,
    updateCommittedTrackerData,
    setLastActionWasSwipe,
    setIsGenerating,
    setInfoBoxContainer,
    setThoughtsContainer,
    setQuestsContainer,
    clearSessionAvatarPrompts
} from './src/core/state.js';
import { loadSettings, saveSettings, saveChatData, loadChatData, updateMessageSwipeData } from './src/core/persistence.js';
import { registerAllEvents } from './src/core/events.js';
// Generation & Parsing modules
import {
    generateTrackerExample,
    generateTrackerInstructions,
    generateContextualSummary,
    generateRPGPromptText,
    generateSeparateUpdatePrompt
} from './src/systems/generation/promptBuilder.js';
import { parseResponse, parseQuests } from './src/systems/generation/parser.js';
import { updateRPGData, testExternalAPIConnection, getAvailableConnectionProfiles } from './src/systems/generation/apiClient.js';
import { onGenerationStarted } from './src/systems/generation/injector.js';
// Rendering modules
import { getSafeThumbnailUrl } from './src/utils/avatars.js';
import { renderInfoBox, updateInfoBoxField, initInfoBoxEventDelegation } from './src/systems/rendering/infoBox.js';
import {
    renderThoughts,
    updateCharacterField,
    removeCharacter,
    updateChatThoughts,
    createThoughtPanel,
    initThoughtsEventDelegation
} from './src/systems/rendering/thoughts.js';
import { renderQuests, initQuestEventDelegation } from './src/systems/rendering/quests.js';
// UI Systems modules
import {
    applyTheme,
    applyCustomTheme,
    toggleCustomColors,
    toggleAnimations,
    updateFeatureTogglesVisibility,
    updateSettingsPopupTheme,
    applyCustomThemeToSettingsPopup
} from './src/systems/ui/theme.js';
import {
    SettingsModal,
    setupSettingsPopup,
    getSettingsModal
} from './src/systems/ui/modals.js';
import {
    initTrackerEditor
} from './src/systems/ui/trackerEditor.js';
import {
    initPromptsEditor
} from './src/systems/ui/promptsEditor.js';
import {
    updateSectionVisibility
} from './src/systems/ui/layout.js';
import {
    initPortraitBar,
    updatePortraitBar,
    repositionPortraitBar,
    clearPortraitCache,
    applyPortraitBarSettings
} from './src/systems/ui/portraitBar.js';
import {
    applyChatBubbles,
    applyAllChatBubbles,
    revertAllChatBubbles,
    onChatBubbleModeChanged,
    applyChatBubbleSettings,
    initBubbleTtsHandlers
} from './src/systems/rendering/chatBubbles.js';
// infoPanel.js removed — banner/hud/ticker are now layout modes in sceneHeaders.js
import {
    initTtsHighlight,
    destroyTtsHighlight,
    onTtsHighlightModeChanged,
    applyTtsHighlightSettings
} from './src/systems/rendering/ttsHighlight.js';
import { playLoadingIntro } from './src/systems/ui/loadingIntro.js';
// Lorebook Manager modules
import { setupLorebookModal, getLorebookModal } from './src/systems/ui/lorebookModal.js';
import { initLorebookEventDelegation, renderLorebook } from './src/systems/rendering/lorebook.js';
// Feature modules
import { ensureHtmlCleaningRegex, detectConflictingRegexScripts, ensureTrackerCleaningRegex } from './src/systems/features/htmlCleaning.js';
import { ensureJsonCleaningRegex, removeJsonCleaningRegex } from './src/systems/features/jsonCleaning.js';
import { DEFAULT_HTML_PROMPT } from './src/systems/generation/promptBuilder.js';
// Scene headers (inline chat rendering)
import { updateChatSceneHeaders, applySceneTrackerSettings, resetSceneHeaderCache } from './src/systems/rendering/sceneHeaders.js';
// Integration modules
import {
    commitTrackerData,
    onMessageSent,
    onMessageReceived,
    onCharacterChanged,
    onMessageSwiped,
    updatePersonaAvatar,
    clearExtensionPrompts,
    onGenerationEnded,
    initHistoryInjection
} from './src/systems/integration/sillytavern.js';
// ============ DEBUG: Module loaded successfully ============
console.log('[Dooms Tracker] ✅ All imports resolved successfully. Module body executing.');
/**
 * Updates UI elements that are dynamically generated and not covered by data-i18n-key.
 */
function updateDynamicLabels() {
    // Currently no dynamic labels to update
}
/**
 * Adds the extension settings to the Extensions tab.
 */
async function addExtensionSettings() {
    console.log('[Dooms Tracker] addExtensionSettings() called');
    // Load the HTML template for the settings
    const settingsHtml = await renderExtensionTemplateAsync(extensionName, 'settings');
    console.log('[Dooms Tracker] Settings HTML loaded, length =', settingsHtml?.length || 0);
    $('#extensions_settings2').append(settingsHtml);
    console.log('[Dooms Tracker] Settings HTML appended');
    // Set up the enable/disable toggle
    $('#rpg-extension-enabled').prop('checked', extensionSettings.enabled).on('change', async function() {
        const wasEnabled = extensionSettings.enabled;
        extensionSettings.enabled = $(this).prop('checked');
        saveSettings();
        if (!extensionSettings.enabled && wasEnabled) {
            // Disabling extension - remove UI elements
            clearExtensionPrompts();
            updateChatThoughts(); // Remove thought bubbles
            updateChatSceneHeaders(); // Remove scene headers (handles enabled check internally)
        } else if (extensionSettings.enabled && !wasEnabled) {
            // Enabling extension - initialize UI
            await initUI();
            loadChatData(); // Load chat data for current chat
            updateChatThoughts(); // Create thought bubbles if data exists
        }
    });
    // Set up language selector
    const langSelect = $('#dooms-tracker-language-select');
    if (langSelect.length) {
        langSelect.val(i18n.currentLanguage);
        langSelect.on('change', async function() {
            const selectedLanguage = $(this).val();
            await i18n.setLanguage(selectedLanguage);
            // We need to re-apply translations to the settings panel specifically
            i18n.applyTranslations(document.getElementById('extensions_settings2'));
        });
    }
    // Set up "Open Settings" button in the extension dropdown
    $('#dooms-open-settings-btn').on('click', function() {
        const modal = getSettingsModal();
        if (modal) {
            modal.open();
        } else {
            $('#rpg-settings-popup').show();
        }
    });
}
/**
 * Populates the Connection Profile dropdown from the Connection Manager extension.
 */
function populateConnectionProfileDropdown() {
    const $select = $('#rpg-connection-profile');
    if (!$select.length) return;

    const currentValue = extensionSettings.connectionProfile || '';
    $select.empty();
    $select.append('<option value="">Use Current</option>');

    const profiles = getAvailableConnectionProfiles();
    for (const name of profiles) {
        $select.append($('<option>').val(name).text(name));
    }

    // Restore saved value; if saved profile no longer exists, reset
    if (currentValue && profiles.includes(currentValue)) {
        $select.val(currentValue);
    } else if (currentValue && !profiles.includes(currentValue)) {
        extensionSettings.connectionProfile = '';
        saveSettings();
        $select.val('');
    }
}
/**
 * Populates all Chat Bubbles & Info Panel settings controls from saved state.
 */
function loadChatBubbleSettingsUI() {
    const cbs = extensionSettings.chatBubbleSettings || {};

    // Mode selectors
    $('#rpg-cb-bubble-mode').val(extensionSettings.chatBubbleMode || 'off');
    $('#rpg-cb-badge').text((extensionSettings.chatBubbleMode || 'off') === 'off' ? 'off' : extensionSettings.chatBubbleMode);

    // Toggles
    $('#rpg-cb-show-avatars').prop('checked', cbs.showAvatars !== false);
    $('#rpg-cb-show-author-names').prop('checked', cbs.showAuthorNames !== false);
    $('#rpg-cb-show-narrator-label').prop('checked', cbs.showNarratorLabel !== false);

    // Bubble colors
    $('#rpg-cb-narrator-color').val(cbs.narratorTextColor || '#999999');
    $('#rpg-cb-unknown-color').val(cbs.unknownSpeakerColor || '#aaaaaa');
    $('#rpg-cb-accent-color').val(cbs.accentColor || '#e94560');
    $('#rpg-cb-bg-tint').val(cbs.backgroundTint || '#1a1a2e');

    // Bubble sliders
    $('#rpg-cb-bg-opacity').val(cbs.backgroundOpacity ?? 5);
    $('#rpg-cb-bg-opacity-value').text((cbs.backgroundOpacity ?? 5) + '%');
    $('#rpg-cb-font-size').val(cbs.fontSize ?? 92);
    $('#rpg-cb-font-size-value').text((cbs.fontSize ?? 92) + '%');
    $('#rpg-cb-avatar-size').val(cbs.avatarSize ?? 40);
    $('#rpg-cb-avatar-size-value').text((cbs.avatarSize ?? 40) + 'px');
    $('#rpg-cb-border-radius').val(cbs.borderRadius ?? 6);
    $('#rpg-cb-border-radius-value').text((cbs.borderRadius ?? 6) + 'px');
    $('#rpg-cb-spacing').val(cbs.spacing ?? 12);
    $('#rpg-cb-spacing-value').text((cbs.spacing ?? 12) + 'px');
}

/**
 * Initializes the UI for the extension.
 */
async function initUI() {
    console.log('[Dooms Tracker] initUI() called');
    // Initialize i18n
    await i18n.init();
    console.log('[Dooms Tracker] i18n initialized');
    // Only initialize UI if extension is enabled
    if (!extensionSettings.enabled) {
        console.log('[Dooms Tracker] Extension disabled - skipping UI initialization');
        return;
    }
    console.log('[Dooms Tracker] Extension is enabled, loading template...');
    console.log('[Dooms Tracker] extensionName =', extensionName);
    // Load the HTML template using SillyTavern's template system
    const templateHtml = await renderExtensionTemplateAsync(extensionName, 'template');
    console.log('[Dooms Tracker] Template loaded, length =', templateHtml?.length || 0);
    // Append panel to body - positioning handled by CSS
    $('body').append(templateHtml);
    console.log('[Dooms Tracker] Template appended to body');
    // Cache UI elements using state setters
    setInfoBoxContainer($('#rpg-info-box'));
    setThoughtsContainer($('#rpg-thoughts'));
    setQuestsContainer($('#rpg-quests'));
    // Register delegated event handlers ONCE (instead of re-attaching on every render)
    initInfoBoxEventDelegation();
    initThoughtsEventDelegation();
    initQuestEventDelegation();
    // Lorebook Manager init
    try { initLorebookEventDelegation(); } catch(e) { console.error('[Dooms Tracker] initLorebookEventDelegation() FAILED:', e); }
    try { setupLorebookModal(); } catch(e) { console.error('[Dooms Tracker] setupLorebookModal() FAILED:', e); }
    // Re-apply translations to the entire body to catch all new elements from the template
    i18n.applyTranslations(document.body);
    // ── Accordion toggle behavior ──
    // Use delegated handler so it doesn't block other delegated handlers (like prompts editor)
    $(document).on('click', '.rpg-accordion-header', function() {
        const $section = $(this).closest('.rpg-accordion-section');
        $('.rpg-accordion-section').not($section).removeClass('rpg-accordion-open');
        $section.toggleClass('rpg-accordion-open');
    });
    // ── Generation settings ──
    $('#rpg-toggle-auto-update').on('change', function() {
        extensionSettings.autoUpdate = $(this).prop('checked');
        saveSettings();
    });
    $('#rpg-update-depth').on('change', function() {
        const value = $(this).val();
        extensionSettings.updateDepth = parseInt(String(value));
        saveSettings();
    });
    // ── Display settings ──
    $('#rpg-toggle-info-box').on('change', function() {
        extensionSettings.showInfoBox = $(this).prop('checked');
        saveSettings();
        updateChatSceneHeaders();
    });
    $('#rpg-toggle-thoughts').on('change', function() {
        extensionSettings.showCharacterThoughts = $(this).prop('checked');
        saveSettings();
        updateChatSceneHeaders();
        updatePortraitBar();
    });
    $('#rpg-toggle-quests').on('change', function() {
        extensionSettings.showQuests = $(this).prop('checked');
        saveSettings();
        updateChatSceneHeaders();
    });
    $('#rpg-toggle-lock-icons').on('change', function() {
        extensionSettings.showLockIcons = $(this).prop('checked');
        saveSettings();
        updateChatSceneHeaders();
    });
    $('#rpg-toggle-portrait-bar').on('change', function() {
        extensionSettings.showPortraitBar = $(this).prop('checked');
        saveSettings();
        updatePortraitBar();
        $('#rpg-pb-badge').text($(this).prop('checked') ? 'on' : 'off');
    });
    $('#rpg-portrait-alignment').on('change', function() {
        extensionSettings.portraitAlignment = $(this).val();
        saveSettings();
        updatePortraitBar();
    });
    $('#rpg-portrait-position').on('change', function() {
        extensionSettings.portraitPosition = $(this).val();
        saveSettings();
        repositionPortraitBar();
    });

    // ── Portrait Bar customization ──
    const _pbSettings = () => {
        if (!extensionSettings.portraitBarSettings) extensionSettings.portraitBarSettings = {};
        return extensionSettings.portraitBarSettings;
    };
    const _savePb = () => { saveSettings(); applyPortraitBarSettings(); };

    // Layout toggles
    $('#rpg-pb-show-header').on('change', function() { _pbSettings().showHeader = $(this).prop('checked'); _savePb(); });
    $('#rpg-pb-show-absent').on('change', function() { _pbSettings().showAbsentCharacters = $(this).prop('checked'); _savePb(); updatePortraitBar(); });
    $('#rpg-pb-show-arrows').on('change', function() { _pbSettings().showScrollArrows = $(this).prop('checked'); _savePb(); });

    // Card size sliders
    $('#rpg-pb-card-width').on('input', function() {
        const v = parseInt($(this).val());
        _pbSettings().cardWidth = v;
        $('#rpg-pb-card-width-value').text(v + 'px');
        _savePb();
    });
    $('#rpg-pb-card-height').on('input', function() {
        const v = parseInt($(this).val());
        _pbSettings().cardHeight = v;
        $('#rpg-pb-card-height-value').text(v + 'px');
        _savePb();
    });
    $('#rpg-pb-card-gap').on('input', function() {
        const v = parseInt($(this).val());
        _pbSettings().cardGap = v;
        $('#rpg-pb-card-gap-value').text(v + 'px');
        _savePb();
    });
    $('#rpg-pb-card-radius').on('input', function() {
        const v = parseInt($(this).val());
        _pbSettings().cardBorderRadius = v;
        $('#rpg-pb-card-radius-value').text(v + 'px');
        _savePb();
    });

    // Restore card size defaults
    $('#rpg-pb-reset-card-size').on('click', function() {
        const s = _pbSettings();
        s.cardWidth = 110;
        s.cardHeight = 150;
        s.cardGap = 8;
        s.cardBorderRadius = 8;
        $('#rpg-pb-card-width').val(110);
        $('#rpg-pb-card-width-value').text('110px');
        $('#rpg-pb-card-height').val(150);
        $('#rpg-pb-card-height-value').text('150px');
        $('#rpg-pb-card-gap').val(8);
        $('#rpg-pb-card-gap-value').text('8px');
        $('#rpg-pb-card-radius').val(8);
        $('#rpg-pb-card-radius-value').text('8px');
        _savePb();
    });

    // Color pickers
    $('#rpg-pb-bar-bg-color').on('input', function() { _pbSettings().barBackground = $(this).val(); _savePb(); });
    $('#rpg-pb-header-color').on('input', function() { _pbSettings().headerColor = $(this).val(); _savePb(); });
    $('#rpg-pb-card-border-color').on('input', function() { _pbSettings().cardBorderColor = $(this).val(); _savePb(); });
    $('#rpg-pb-hover-glow-color').on('input', function() { _pbSettings().hoverGlowColor = $(this).val(); _savePb(); });
    $('#rpg-pb-speaking-color').on('input', function() { _pbSettings().speakingPulseColor = $(this).val(); _savePb(); });

    // Opacity/intensity sliders
    $('#rpg-pb-bar-bg-opacity').on('input', function() {
        const v = parseInt($(this).val());
        _pbSettings().barBackgroundOpacity = v;
        $('#rpg-pb-bar-bg-opacity-value').text(v + '%');
        _savePb();
    });
    $('#rpg-pb-card-border-opacity').on('input', function() {
        const v = parseInt($(this).val());
        _pbSettings().cardBorderOpacity = v;
        $('#rpg-pb-card-border-opacity-value').text(v + '%');
        _savePb();
    });
    $('#rpg-pb-hover-glow-intensity').on('input', function() {
        const v = parseInt($(this).val());
        _pbSettings().hoverGlowIntensity = v;
        $('#rpg-pb-hover-glow-intensity-value').text(v + 'px');
        _savePb();
    });
    $('#rpg-pb-name-opacity').on('input', function() {
        const v = parseInt($(this).val());
        _pbSettings().nameOverlayOpacity = v;
        $('#rpg-pb-name-opacity-value').text(v + '%');
        _savePb();
    });
    $('#rpg-pb-absent-opacity').on('input', function() {
        const v = parseInt($(this).val());
        _pbSettings().absentOpacity = v;
        $('#rpg-pb-absent-opacity-value').text(v + '%');
        _savePb();
    });
    $('#rpg-loading-intro-mode').on('change', function() {
        extensionSettings.loadingIntroMode = $(this).val();
        saveSettings();
    });
    $('#rpg-tts-highlight-mode').on('change', function() {
        const oldMode = extensionSettings.ttsHighlightMode;
        extensionSettings.ttsHighlightMode = $(this).val();
        saveSettings();
        onTtsHighlightModeChanged(oldMode, extensionSettings.ttsHighlightMode);
        $('#rpg-tts-badge').text(extensionSettings.ttsHighlightMode === 'off' ? 'off' : 'on');
    });
    // ── TTS Highlight customization ──
    const _ttsSettings = () => {
        if (!extensionSettings.ttsHighlightSettings) extensionSettings.ttsHighlightSettings = {};
        return extensionSettings.ttsHighlightSettings;
    };
    const _saveTts = () => { saveSettings(); applyTtsHighlightSettings(); };

    $('#rpg-tts-color-left').on('input', function() { _ttsSettings().gradientColorLeft = $(this).val(); _saveTts(); });
    $('#rpg-tts-color-right').on('input', function() { _ttsSettings().gradientColorRight = $(this).val(); _saveTts(); });
    $('#rpg-tts-override-text-color').on('change', function() {
        const on = $(this).prop('checked');
        _ttsSettings().overrideTextColor = on;
        $('#rpg-tts-text-color-row').toggle(on);
        _saveTts();
    });
    $('#rpg-tts-active-text-color').on('input', function() { _ttsSettings().activeTextColor = $(this).val(); _saveTts(); });
    $('#rpg-tts-gradient-opacity').on('input', function() {
        const v = parseInt($(this).val());
        _ttsSettings().gradientOpacity = v;
        $('#rpg-tts-gradient-opacity-value').text(v + '%');
        _saveTts();
    });
    $('#rpg-tts-glow-intensity').on('input', function() {
        const v = parseInt($(this).val());
        _ttsSettings().glowIntensity = v;
        $('#rpg-tts-glow-intensity-value').text(v + 'px');
        _saveTts();
    });
    $('#rpg-tts-border-radius').on('input', function() {
        const v = parseInt($(this).val());
        _ttsSettings().borderRadius = v;
        $('#rpg-tts-border-radius-value').text(v + 'px');
        _saveTts();
    });
    $('#rpg-tts-read-opacity').on('input', function() {
        const v = parseInt($(this).val());
        _ttsSettings().readOpacity = v;
        $('#rpg-tts-read-opacity-value').text(v + '%');
        _saveTts();
    });
    $('#rpg-tts-unread-opacity').on('input', function() {
        const v = parseInt($(this).val());
        _ttsSettings().unreadOpacity = v;
        $('#rpg-tts-unread-opacity-value').text(v + '%');
        _saveTts();
    });
    $('#rpg-tts-transition-speed').on('change', function() {
        _ttsSettings().transitionSpeed = parseInt($(this).val());
        _saveTts();
    });
    // ── Scene Tracker customization ──
    const _stSettings = () => {
        if (!extensionSettings.sceneTracker) extensionSettings.sceneTracker = {};
        return extensionSettings.sceneTracker;
    };
    const _saveSt = () => { saveSettings(); applySceneTrackerSettings(); updateChatSceneHeaders(); };

    // Visibility toggles
    $('#rpg-st-show-time').on('change', function() { _stSettings().showTime = $(this).prop('checked'); _saveSt(); });
    $('#rpg-st-show-date').on('change', function() { _stSettings().showDate = $(this).prop('checked'); _saveSt(); });
    $('#rpg-st-show-location').on('change', function() { _stSettings().showLocation = $(this).prop('checked'); _saveSt(); });
    $('#rpg-st-show-characters').on('change', function() { _stSettings().showCharacters = $(this).prop('checked'); _saveSt(); });
    $('#rpg-st-show-quest').on('change', function() { _stSettings().showQuest = $(this).prop('checked'); _saveSt(); });
    $('#rpg-st-show-events').on('change', function() { _stSettings().showRecentEvents = $(this).prop('checked'); _saveSt(); });

    // Layout
    $('#rpg-st-layout').on('change', function() {
        _stSettings().layout = $(this).val();
        _saveSt();
        // Layout change requires full DOM rebuild (different HTML structures)
        resetSceneHeaderCache();
        updateChatSceneHeaders();
    });

    // Sizing sliders
    $('#rpg-st-font-size').on('input', function() {
        const v = parseInt($(this).val());
        _stSettings().fontSize = v;
        $('#rpg-st-font-size-value').text(v + '%');
        _saveSt();
    });
    $('#rpg-st-border-radius').on('input', function() {
        const v = parseInt($(this).val());
        _stSettings().borderRadius = v;
        $('#rpg-st-border-radius-value').text(v + 'px');
        _saveSt();
    });
    $('#rpg-st-padding').on('input', function() {
        const v = parseInt($(this).val());
        _stSettings().padding = v;
        $('#rpg-st-padding-value').text(v + 'px');
        _saveSt();
    });
    $('#rpg-st-border-width').on('input', function() {
        const v = parseInt($(this).val());
        _stSettings().borderWidth = v;
        $('#rpg-st-border-width-value').text(v + 'px');
        _saveSt();
    });

    // Color pickers
    $('#rpg-st-bg-color').on('input', function() { _stSettings().bgColor = $(this).val(); _saveSt(); });
    $('#rpg-st-border-color').on('input', function() { _stSettings().borderColor = $(this).val(); _saveSt(); });
    $('#rpg-st-accent-color').on('input', function() { _stSettings().accentColor = $(this).val(); _saveSt(); });
    $('#rpg-st-label-color').on('input', function() { _stSettings().labelColor = $(this).val(); _saveSt(); });
    $('#rpg-st-text-color').on('input', function() { _stSettings().textColor = $(this).val(); _saveSt(); });
    $('#rpg-st-badge-color').on('input', function() { _stSettings().charBadgeBg = $(this).val(); _saveSt(); });
    $('#rpg-st-quest-color').on('input', function() { _stSettings().questIconColor = $(this).val(); _saveSt(); });
    $('#rpg-st-events-color').on('input', function() { _stSettings().eventsTextColor = $(this).val(); _saveSt(); });

    // Opacity sliders
    $('#rpg-st-bg-opacity').on('input', function() {
        const v = parseInt($(this).val());
        _stSettings().bgOpacity = v;
        $('#rpg-st-bg-opacity-value').text(v + '%');
        _saveSt();
    });
    $('#rpg-st-border-opacity').on('input', function() {
        const v = parseInt($(this).val());
        _stSettings().borderOpacity = v;
        $('#rpg-st-border-opacity-value').text(v + '%');
        _saveSt();
    });
    $('#rpg-st-badge-opacity').on('input', function() {
        const v = parseInt($(this).val());
        _stSettings().charBadgeOpacity = v;
        $('#rpg-st-badge-opacity-value').text(v + '%');
        _saveSt();
    });

    // Reset defaults
    $('#rpg-st-reset').on('click', function() {
        const defaults = {
            showTime: true, showDate: true, showLocation: true,
            showCharacters: true, showQuest: true, showRecentEvents: true,
            layout: 'grid',
            bgColor: '#e94560', bgOpacity: 8,
            borderColor: '#e94560', borderOpacity: 15,
            accentColor: '#e94560', labelColor: '#888888', textColor: '#d0d0d0',
            charBadgeBg: '#e94560', charBadgeOpacity: 12,
            questIconColor: '#f0c040', eventsTextColor: '#999999',
            fontSize: 82, borderRadius: 8, padding: 10, borderWidth: 3,
        };
        extensionSettings.sceneTracker = { ...defaults };
        // Update all inputs
        $('#rpg-st-show-time').prop('checked', true);
        $('#rpg-st-show-date').prop('checked', true);
        $('#rpg-st-show-location').prop('checked', true);
        $('#rpg-st-show-characters').prop('checked', true);
        $('#rpg-st-show-quest').prop('checked', true);
        $('#rpg-st-show-events').prop('checked', true);
        $('#rpg-st-layout').val('grid');
        $('#rpg-st-font-size').val(82); $('#rpg-st-font-size-value').text('82%');
        $('#rpg-st-border-radius').val(8); $('#rpg-st-border-radius-value').text('8px');
        $('#rpg-st-padding').val(10); $('#rpg-st-padding-value').text('10px');
        $('#rpg-st-border-width').val(3); $('#rpg-st-border-width-value').text('3px');
        $('#rpg-st-bg-color').val('#e94560');
        $('#rpg-st-bg-opacity').val(8); $('#rpg-st-bg-opacity-value').text('8%');
        $('#rpg-st-border-color').val('#e94560');
        $('#rpg-st-border-opacity').val(15); $('#rpg-st-border-opacity-value').text('15%');
        $('#rpg-st-accent-color').val('#e94560');
        $('#rpg-st-label-color').val('#888888');
        $('#rpg-st-text-color').val('#d0d0d0');
        $('#rpg-st-badge-color').val('#e94560');
        $('#rpg-st-badge-opacity').val(12); $('#rpg-st-badge-opacity-value').text('12%');
        $('#rpg-st-quest-color').val('#f0c040');
        $('#rpg-st-events-color').val('#999999');
        _saveSt();
        updateChatSceneHeaders();
    });

    // ── Chat Bubbles & Info Panel customization ──
    const _cbSettings = () => {
        if (!extensionSettings.chatBubbleSettings) extensionSettings.chatBubbleSettings = {};
        return extensionSettings.chatBubbleSettings;
    };
    const _saveCb = () => { saveSettings(); applyChatBubbleSettings(); };
    const _saveCbRerender = () => { _saveCb(); revertAllChatBubbles(); applyAllChatBubbles(); };

    // Bubble mode selector
    $('#rpg-cb-bubble-mode').on('change', function() {
        const oldMode = extensionSettings.chatBubbleMode;
        extensionSettings.chatBubbleMode = $(this).val();
        saveSettings();
        onChatBubbleModeChanged(oldMode, extensionSettings.chatBubbleMode);
        $('#rpg-cb-badge').text(extensionSettings.chatBubbleMode === 'off' ? 'off' : extensionSettings.chatBubbleMode);
    });

    // Bubble appearance toggles
    $('#rpg-cb-show-avatars').on('change', function() { _cbSettings().showAvatars = $(this).prop('checked'); _saveCbRerender(); });
    $('#rpg-cb-show-author-names').on('change', function() { _cbSettings().showAuthorNames = $(this).prop('checked'); _saveCbRerender(); });
    $('#rpg-cb-show-narrator-label').on('change', function() { _cbSettings().showNarratorLabel = $(this).prop('checked'); _saveCbRerender(); });

    // Bubble color pickers
    $('#rpg-cb-narrator-color').on('input', function() { _cbSettings().narratorTextColor = $(this).val(); _saveCb(); });
    $('#rpg-cb-unknown-color').on('input', function() { _cbSettings().unknownSpeakerColor = $(this).val(); _saveCb(); });
    $('#rpg-cb-accent-color').on('input', function() { _cbSettings().accentColor = $(this).val(); _saveCb(); });
    $('#rpg-cb-bg-tint').on('input', function() { _cbSettings().backgroundTint = $(this).val(); _saveCb(); });

    // Bubble opacity/sizing sliders
    $('#rpg-cb-bg-opacity').on('input', function() {
        const v = parseInt($(this).val());
        _cbSettings().backgroundOpacity = v;
        $('#rpg-cb-bg-opacity-value').text(v + '%');
        _saveCb();
    });
    $('#rpg-cb-font-size').on('input', function() {
        const v = parseInt($(this).val());
        _cbSettings().fontSize = v;
        $('#rpg-cb-font-size-value').text(v + '%');
        _saveCb();
    });
    $('#rpg-cb-avatar-size').on('input', function() {
        const v = parseInt($(this).val());
        _cbSettings().avatarSize = v;
        $('#rpg-cb-avatar-size-value').text(v + 'px');
        _saveCb();
    });
    $('#rpg-cb-border-radius').on('input', function() {
        const v = parseInt($(this).val());
        _cbSettings().borderRadius = v;
        $('#rpg-cb-border-radius-value').text(v + 'px');
        _saveCb();
    });
    $('#rpg-cb-spacing').on('input', function() {
        const v = parseInt($(this).val());
        _cbSettings().spacing = v;
        $('#rpg-cb-spacing-value').text(v + 'px');
        _saveCb();
    });

    // Reset defaults button (Chat Bubbles only)
    $('#rpg-cb-reset').on('click', function() {
        extensionSettings.chatBubbleSettings = {
            narratorTextColor: '#999999',
            unknownSpeakerColor: '#aaaaaa',
            accentColor: '#e94560',
            backgroundTint: '#1a1a2e',
            backgroundOpacity: 5,
            fontSize: 92,
            avatarSize: 40,
            borderRadius: 6,
            spacing: 12,
            showAvatars: true,
            showAuthorNames: true,
            showNarratorLabel: true,
        };
        // Update all inputs to defaults
        loadChatBubbleSettingsUI();
        _saveCb();
        revertAllChatBubbles();
        applyAllChatBubbles();
    });

    // Ticker click delegation — expand/collapse
    $('#chat').on('click', '.dooms-info-ticker', function() {
        $(this).closest('.dooms-info-ticker-wrapper').toggleClass('expanded');
    });

    $('#rpg-toggle-thoughts-in-chat').on('change', function() {
        extensionSettings.showThoughtsInChat = $(this).prop('checked');
        saveSettings();
        updateChatThoughts();
    });
    // ── Feature pill toggles ──
    $('#rpg-toggle-html-prompt').on('change', function() {
        extensionSettings.enableHtmlPrompt = $(this).prop('checked');
        saveSettings();
    });
    $('#rpg-toggle-dialogue-coloring').on('change', function() {
        extensionSettings.enableDialogueColoring = $(this).prop('checked');
        saveSettings();
    });
    $('#rpg-toggle-dynamic-weather').on('change', function() {
        extensionSettings.enableDynamicWeather = $(this).prop('checked');
        saveSettings();
    });
    $('#rpg-toggle-auto-avatars').on('change', function() {
        extensionSettings.autoGenerateAvatars = $(this).prop('checked');
        saveSettings();
    });
    $('#rpg-toggle-narrator').on('change', function() {
        extensionSettings.narratorMode = $(this).prop('checked');
        saveSettings();
    });
    $('#rpg-skip-guided-mode').on('change', function() {
        extensionSettings.skipInjectionsForGuided = String($(this).val());
        saveSettings();
    });
    // Connection Profile dropdown
    $('#rpg-connection-profile').on('change', function() {
        extensionSettings.connectionProfile = String($(this).val());
        saveSettings();
    });
    // ── History Persistence settings ──
    $('#rpg-toggle-history-persistence').on('change', function() {
        if (!extensionSettings.historyPersistence) {
            extensionSettings.historyPersistence = { enabled: false, messageCount: 5, injectionPosition: 'assistant_message_end', sendAllEnabledOnRefresh: false };
        }
        extensionSettings.historyPersistence.enabled = $(this).prop('checked');
        saveSettings();
    });
    $('#rpg-history-message-count').on('change', function() {
        if (!extensionSettings.historyPersistence) {
            extensionSettings.historyPersistence = { enabled: false, messageCount: 5, injectionPosition: 'assistant_message_end', sendAllEnabledOnRefresh: false };
        }
        extensionSettings.historyPersistence.messageCount = parseInt(String($(this).val()));
        saveSettings();
    });
    $('#rpg-history-injection-position').on('change', function() {
        if (!extensionSettings.historyPersistence) {
            extensionSettings.historyPersistence = { enabled: false, messageCount: 5, injectionPosition: 'assistant_message_end', sendAllEnabledOnRefresh: false };
        }
        extensionSettings.historyPersistence.injectionPosition = String($(this).val());
        saveSettings();
    });
    $('#rpg-toggle-send-all-on-refresh').on('change', function() {
        if (!extensionSettings.historyPersistence) {
            extensionSettings.historyPersistence = { enabled: false, messageCount: 5, injectionPosition: 'assistant_message_end', sendAllEnabledOnRefresh: false };
        }
        extensionSettings.historyPersistence.sendAllEnabledOnRefresh = $(this).prop('checked');
        saveSettings();
    });
    // ── Lorebook Manager settings ──
    $('#rpg-toggle-lorebook').on('change', function() {
        if (!extensionSettings.lorebook) {
            extensionSettings.lorebook = { enabled: true, campaigns: {}, campaignOrder: [], collapsedCampaigns: [], expandedBooks: [], lastActiveTab: 'all', lastFilter: 'all', lastSearch: '' };
        }
        extensionSettings.lorebook.enabled = $(this).prop('checked');
        $('#rpg-lb-badge').text($(this).prop('checked') ? 'on' : 'off');
        saveSettings();
    });
    $('#rpg-open-lorebook').on('click', function() {
        const modal = getLorebookModal();
        if (modal) modal.open();
    });
    // ── Intercept ST's native World Info button ──
    $('#WI-SP-button .drawer-toggle').on('click.rpgLorebook', function(e) {
        // Only intercept if lorebook manager is enabled
        if (!extensionSettings.lorebook?.enabled) return; // let ST handle it normally

        // Prevent ST's doNavbarIconClick from firing
        e.stopImmediatePropagation();
        e.preventDefault();

        // If the WI drawer is already open, close it first
        const $drawer = $('#WorldInfo');
        const $icon = $('#WIDrawerIcon');
        if ($drawer.hasClass('openDrawer')) {
            $icon.removeClass('openIcon').addClass('closedIcon');
            $drawer.removeClass('openDrawer').addClass('closedDrawer');
        }

        // Open our Lorebook Manager modal
        const modal = getLorebookModal();
        if (modal) modal.open();
    });
    // ── Theme selection ──
    $('#rpg-theme-select').on('change', function() {
        const theme = String($(this).val());
        extensionSettings.theme = theme;
        saveSettings();
        applyTheme();
        toggleCustomColors();
        updateSettingsPopupTheme(getSettingsModal());
        updateChatThoughts();
        // Update badge
        $('#rpg-theme-badge').text(theme);
    });
    // ── Animations toggle ──
    $('#rpg-toggle-animations').on('change', function() {
        extensionSettings.enableAnimations = $(this).prop('checked');
        saveSettings();
        toggleAnimations();
    });
    // ── Stat bar colors ──
    $('#rpg-stat-bar-color-low').on('change', function() {
        extensionSettings.statBarColorLow = String($(this).val());
        saveSettings();
    });
    $('#rpg-stat-bar-color-low-opacity').on('input', function() {
        const opacity = Number($(this).val());
        extensionSettings.statBarColorLowOpacity = opacity;
        $('#rpg-stat-bar-color-low-opacity-value').text(opacity + '%');
    }).on('change', function() {
        saveSettings();
    });
    $('#rpg-stat-bar-color-high').on('change', function() {
        extensionSettings.statBarColorHigh = String($(this).val());
        saveSettings();
    });
    $('#rpg-stat-bar-color-high-opacity').on('input', function() {
        const opacity = Number($(this).val());
        extensionSettings.statBarColorHighOpacity = opacity;
        $('#rpg-stat-bar-color-high-opacity-value').text(opacity + '%');
    }).on('change', function() {
        saveSettings();
    });
    // Custom color pickers
    $('#rpg-custom-bg').on('change', function() {
        extensionSettings.customColors.bg = String($(this).val());
        saveSettings();
        if (extensionSettings.theme === 'custom') {
            applyCustomTheme();
            updateSettingsPopupTheme(getSettingsModal()); // Update popup theme instantly
            updateChatThoughts(); // Update thought bubbles
        }
    });
    $('#rpg-custom-bg-opacity').on('input', function() {
        const opacity = Number($(this).val());
        extensionSettings.customColors.bgOpacity = opacity;
        $('#rpg-custom-bg-opacity-value').text(opacity + '%');
        if (extensionSettings.theme === 'custom') {
            applyCustomTheme();
            updateSettingsPopupTheme(getSettingsModal());
            updateChatThoughts();
        }
    }).on('change', function() {
        saveSettings();
    });
    $('#rpg-custom-accent').on('change', function() {
        extensionSettings.customColors.accent = String($(this).val());
        saveSettings();
        if (extensionSettings.theme === 'custom') {
            applyCustomTheme();
            updateSettingsPopupTheme(getSettingsModal()); // Update popup theme instantly
            updateChatThoughts(); // Update thought bubbles
        }
    });
    $('#rpg-custom-accent-opacity').on('input', function() {
        const opacity = Number($(this).val());
        extensionSettings.customColors.accentOpacity = opacity;
        $('#rpg-custom-accent-opacity-value').text(opacity + '%');
        if (extensionSettings.theme === 'custom') {
            applyCustomTheme();
            updateSettingsPopupTheme(getSettingsModal());
            updateChatThoughts();
        }
    }).on('change', function() {
        saveSettings();
    });
    $('#rpg-custom-text').on('change', function() {
        extensionSettings.customColors.text = String($(this).val());
        saveSettings();
        if (extensionSettings.theme === 'custom') {
            applyCustomTheme();
            updateSettingsPopupTheme(getSettingsModal()); // Update popup theme instantly
            updateChatThoughts(); // Update thought bubbles
        }
    });
    $('#rpg-custom-text-opacity').on('input', function() {
        const opacity = Number($(this).val());
        extensionSettings.customColors.textOpacity = opacity;
        $('#rpg-custom-text-opacity-value').text(opacity + '%');
        if (extensionSettings.theme === 'custom') {
            applyCustomTheme();
            updateSettingsPopupTheme(getSettingsModal());
            updateChatThoughts();
        }
    }).on('change', function() {
        saveSettings();
    });
    $('#rpg-custom-highlight').on('change', function() {
        extensionSettings.customColors.highlight = String($(this).val());
        saveSettings();
        if (extensionSettings.theme === 'custom') {
            applyCustomTheme();
            updateSettingsPopupTheme(getSettingsModal()); // Update popup theme instantly
            updateChatThoughts(); // Update thought bubbles
        }
    });
    $('#rpg-custom-highlight-opacity').on('input', function() {
        const opacity = Number($(this).val());
        extensionSettings.customColors.highlightOpacity = opacity;
        $('#rpg-custom-highlight-opacity-value').text(opacity + '%');
        if (extensionSettings.theme === 'custom') {
            applyCustomTheme();
            updateSettingsPopupTheme(getSettingsModal());
            updateChatThoughts();
        }
    }).on('change', function() {
        saveSettings();
    });
    // External API settings event handlers
    $('#rpg-external-base-url').on('change', function() {
        if (!extensionSettings.externalApiSettings) {
            extensionSettings.externalApiSettings = {
                baseUrl: '', apiKey: '', model: '', maxTokens: 8192, temperature: 0.7
            };
        }
        extensionSettings.externalApiSettings.baseUrl = String($(this).val()).trim();
        saveSettings();
    });
    $('#rpg-external-api-key').on('change', function() {
        // Securely store API key in localStorage instead of shared extension settings
        const apiKey = String($(this).val()).trim();
        localStorage.setItem('dooms_tracker_external_api_key', apiKey);
        // Ensure the externalApiSettings object exists, but don't store the key in it
        if (!extensionSettings.externalApiSettings) {
            extensionSettings.externalApiSettings = {
                baseUrl: '', model: '', maxTokens: 8192, temperature: 0.7
            };
            saveSettings();
        }
    });
    $('#rpg-external-model').on('change', function() {
        if (!extensionSettings.externalApiSettings) {
            extensionSettings.externalApiSettings = {
                baseUrl: '', apiKey: '', model: '', maxTokens: 8192, temperature: 0.7
            };
        }
        extensionSettings.externalApiSettings.model = String($(this).val()).trim();
        saveSettings();
    });
    $('#rpg-external-max-tokens').on('change', function() {
        if (!extensionSettings.externalApiSettings) {
            extensionSettings.externalApiSettings = {
                baseUrl: '', apiKey: '', model: '', maxTokens: 8192, temperature: 0.7
            };
        }
        extensionSettings.externalApiSettings.maxTokens = parseInt(String($(this).val()));
        saveSettings();
    });
    $('#rpg-external-temperature').on('change', function() {
        if (!extensionSettings.externalApiSettings) {
            extensionSettings.externalApiSettings = {
                baseUrl: '', apiKey: '', model: '', maxTokens: 8192, temperature: 0.7
            };
        }
        extensionSettings.externalApiSettings.temperature = parseFloat(String($(this).val()));
        saveSettings();
    });
    $('#rpg-toggle-api-key-visibility').on('click', function() {
        const $input = $('#rpg-external-api-key');
        const type = $input.attr('type') === 'password' ? 'text' : 'password';
        $input.attr('type', type);
        $(this).find('i').toggleClass('fa-eye fa-eye-slash');
    });
    $('#rpg-test-external-api').on('click', async function() {
        const $result = $('#rpg-external-api-test-result');
        const $btn = $(this);
        const originalText = $btn.html();
        $btn.html('<i class="fa-solid fa-spinner fa-spin"></i> Testing...').prop('disabled', true);
        $result.hide().removeClass('rpg-success-message rpg-error-message');
        try {
            const result = await testExternalAPIConnection();
            if (result.success) {
                $result.addClass('rpg-success-message')
                    .html(`<i class="fa-solid fa-check-circle"></i> ${result.message}`)
                    .slideDown();
                toastr.success(result.message);
            } else {
                $result.addClass('rpg-error-message')
                    .html(`<i class="fa-solid fa-exclamation-circle"></i> ${result.message}`)
                    .slideDown();
                toastr.error(result.message);
            }
        } catch (error) {
            $result.addClass('rpg-error-message')
                .html(`<i class="fa-solid fa-exclamation-circle"></i> Error: ${error.message}`)
                .slideDown();
        } finally {
            $btn.html(originalText).prop('disabled', false);
        }
    });
    // ── Initialize UI state ──
    // Generation
    $('#rpg-toggle-auto-update').prop('checked', extensionSettings.autoUpdate);
    $('#rpg-update-depth').val(extensionSettings.updateDepth);
    $('#rpg-toggle-narrator').prop('checked', extensionSettings.narratorMode);
    $('#rpg-skip-guided-mode').val(extensionSettings.skipInjectionsForGuided);
    populateConnectionProfileDropdown();
    // Display
    $('#rpg-toggle-info-box').prop('checked', extensionSettings.showInfoBox);
    $('#rpg-toggle-thoughts').prop('checked', extensionSettings.showCharacterThoughts);
    $('#rpg-toggle-quests').prop('checked', extensionSettings.showQuests);
    $('#rpg-toggle-lock-icons').prop('checked', extensionSettings.showLockIcons ?? true);
    $('#rpg-toggle-portrait-bar').prop('checked', extensionSettings.showPortraitBar ?? true);
    $('#rpg-portrait-alignment').val(extensionSettings.portraitAlignment || 'left');
    $('#rpg-portrait-position').val(extensionSettings.portraitPosition || 'above');
    // Portrait Bar customization
    const pb = extensionSettings.portraitBarSettings || {};
    $('#rpg-pb-badge').text((extensionSettings.showPortraitBar ?? true) ? 'on' : 'off');
    $('#rpg-pb-show-header').prop('checked', pb.showHeader !== false);
    $('#rpg-pb-show-absent').prop('checked', pb.showAbsentCharacters !== false);
    $('#rpg-pb-show-arrows').prop('checked', pb.showScrollArrows !== false);
    $('#rpg-pb-card-width').val(pb.cardWidth ?? 110);
    $('#rpg-pb-card-width-value').text((pb.cardWidth ?? 110) + 'px');
    $('#rpg-pb-card-height').val(pb.cardHeight ?? 150);
    $('#rpg-pb-card-height-value').text((pb.cardHeight ?? 150) + 'px');
    $('#rpg-pb-card-gap').val(pb.cardGap ?? 8);
    $('#rpg-pb-card-gap-value').text((pb.cardGap ?? 8) + 'px');
    $('#rpg-pb-card-radius').val(pb.cardBorderRadius ?? 8);
    $('#rpg-pb-card-radius-value').text((pb.cardBorderRadius ?? 8) + 'px');
    $('#rpg-pb-bar-bg-color').val(pb.barBackground || '#000000');
    $('#rpg-pb-bar-bg-opacity').val(pb.barBackgroundOpacity ?? 20);
    $('#rpg-pb-bar-bg-opacity-value').text((pb.barBackgroundOpacity ?? 20) + '%');
    $('#rpg-pb-header-color').val(pb.headerColor || '#e94560');
    $('#rpg-pb-card-border-color').val(pb.cardBorderColor || '#ffffff');
    $('#rpg-pb-card-border-opacity').val(pb.cardBorderOpacity ?? 6);
    $('#rpg-pb-card-border-opacity-value').text((pb.cardBorderOpacity ?? 6) + '%');
    $('#rpg-pb-hover-glow-color').val(pb.hoverGlowColor || '#e94560');
    $('#rpg-pb-hover-glow-intensity').val(pb.hoverGlowIntensity ?? 12);
    $('#rpg-pb-hover-glow-intensity-value').text((pb.hoverGlowIntensity ?? 12) + 'px');
    $('#rpg-pb-speaking-color').val(pb.speakingPulseColor || '#e94560');
    $('#rpg-pb-name-opacity').val(pb.nameOverlayOpacity ?? 85);
    $('#rpg-pb-name-opacity-value').text((pb.nameOverlayOpacity ?? 85) + '%');
    $('#rpg-pb-absent-opacity').val(pb.absentOpacity ?? 45);
    $('#rpg-pb-absent-opacity-value').text((pb.absentOpacity ?? 45) + '%');
    applyPortraitBarSettings();
    $('#rpg-tts-highlight-mode').val(extensionSettings.ttsHighlightMode || 'off');
    $('#rpg-loading-intro-mode').val(extensionSettings.loadingIntroMode || 'off');
    $('#rpg-toggle-thoughts-in-chat').prop('checked', extensionSettings.showThoughtsInChat);
    // Scene Tracker customization
    const st = extensionSettings.sceneTracker || {};
    $('#rpg-st-show-time').prop('checked', st.showTime !== false);
    $('#rpg-st-show-date').prop('checked', st.showDate !== false);
    $('#rpg-st-show-location').prop('checked', st.showLocation !== false);
    $('#rpg-st-show-characters').prop('checked', st.showCharacters !== false);
    $('#rpg-st-show-quest').prop('checked', st.showQuest !== false);
    $('#rpg-st-show-events').prop('checked', st.showRecentEvents !== false);
    $('#rpg-st-layout').val(st.layout || 'grid');
    $('#rpg-st-font-size').val(st.fontSize ?? 82);
    $('#rpg-st-font-size-value').text((st.fontSize ?? 82) + '%');
    $('#rpg-st-border-radius').val(st.borderRadius ?? 8);
    $('#rpg-st-border-radius-value').text((st.borderRadius ?? 8) + 'px');
    $('#rpg-st-padding').val(st.padding ?? 10);
    $('#rpg-st-padding-value').text((st.padding ?? 10) + 'px');
    $('#rpg-st-border-width').val(st.borderWidth ?? 3);
    $('#rpg-st-border-width-value').text((st.borderWidth ?? 3) + 'px');
    $('#rpg-st-bg-color').val(st.bgColor || '#e94560');
    $('#rpg-st-bg-opacity').val(st.bgOpacity ?? 8);
    $('#rpg-st-bg-opacity-value').text((st.bgOpacity ?? 8) + '%');
    $('#rpg-st-border-color').val(st.borderColor || '#e94560');
    $('#rpg-st-border-opacity').val(st.borderOpacity ?? 15);
    $('#rpg-st-border-opacity-value').text((st.borderOpacity ?? 15) + '%');
    $('#rpg-st-accent-color').val(st.accentColor || '#e94560');
    $('#rpg-st-label-color').val(st.labelColor || '#888888');
    $('#rpg-st-text-color').val(st.textColor || '#d0d0d0');
    $('#rpg-st-badge-color').val(st.charBadgeBg || '#e94560');
    $('#rpg-st-badge-opacity').val(st.charBadgeOpacity ?? 12);
    $('#rpg-st-badge-opacity-value').text((st.charBadgeOpacity ?? 12) + '%');
    $('#rpg-st-quest-color').val(st.questIconColor || '#f0c040');
    $('#rpg-st-events-color').val(st.eventsTextColor || '#999999');
    applySceneTrackerSettings();
    // Feature pills
    $('#rpg-toggle-html-prompt').prop('checked', extensionSettings.enableHtmlPrompt);
    $('#rpg-toggle-dialogue-coloring').prop('checked', extensionSettings.enableDialogueColoring);
    $('#rpg-toggle-dynamic-weather').prop('checked', extensionSettings.enableDynamicWeather ?? true);
    $('#rpg-toggle-auto-avatars').prop('checked', extensionSettings.autoGenerateAvatars ?? true);
    // Theme
    $('#rpg-theme-select').val(extensionSettings.theme);
    $('#rpg-theme-badge').text(extensionSettings.theme || 'default');
    $('#rpg-toggle-animations').prop('checked', extensionSettings.enableAnimations ?? true);
    // Custom colors
    $('#rpg-custom-bg').val(extensionSettings.customColors.bg);
    $('#rpg-custom-bg-opacity').val(extensionSettings.customColors.bgOpacity ?? 100);
    $('#rpg-custom-bg-opacity-value').text((extensionSettings.customColors.bgOpacity ?? 100) + '%');
    $('#rpg-custom-accent').val(extensionSettings.customColors.accent);
    $('#rpg-custom-accent-opacity').val(extensionSettings.customColors.accentOpacity ?? 100);
    $('#rpg-custom-accent-opacity-value').text((extensionSettings.customColors.accentOpacity ?? 100) + '%');
    $('#rpg-custom-text').val(extensionSettings.customColors.text);
    $('#rpg-custom-text-opacity').val(extensionSettings.customColors.textOpacity ?? 100);
    $('#rpg-custom-text-opacity-value').text((extensionSettings.customColors.textOpacity ?? 100) + '%');
    $('#rpg-custom-highlight').val(extensionSettings.customColors.highlight);
    $('#rpg-custom-highlight-opacity').val(extensionSettings.customColors.highlightOpacity ?? 100);
    $('#rpg-custom-highlight-opacity-value').text((extensionSettings.customColors.highlightOpacity ?? 100) + '%');
    // Stat bar colors
    $('#rpg-stat-bar-color-low').val(extensionSettings.statBarColorLow || '#cc3333');
    $('#rpg-stat-bar-color-low-opacity').val(extensionSettings.statBarColorLowOpacity ?? 100);
    $('#rpg-stat-bar-color-low-opacity-value').text((extensionSettings.statBarColorLowOpacity ?? 100) + '%');
    $('#rpg-stat-bar-color-high').val(extensionSettings.statBarColorHigh || '#33cc66');
    $('#rpg-stat-bar-color-high-opacity').val(extensionSettings.statBarColorHighOpacity ?? 100);
    $('#rpg-stat-bar-color-high-opacity-value').text((extensionSettings.statBarColorHighOpacity ?? 100) + '%');
    // External API
    if (extensionSettings.externalApiSettings) {
        $('#rpg-external-base-url').val(extensionSettings.externalApiSettings.baseUrl || '');
        const storedApiKey = localStorage.getItem('dooms_tracker_external_api_key') || '';
        $('#rpg-external-api-key').val(storedApiKey);
        $('#rpg-external-model').val(extensionSettings.externalApiSettings.model || '');
        $('#rpg-external-max-tokens').val(extensionSettings.externalApiSettings.maxTokens || 8192);
        $('#rpg-external-temperature').val(extensionSettings.externalApiSettings.temperature ?? 0.7);
    }
    // History Persistence
    const hp = extensionSettings.historyPersistence || {};
    $('#rpg-toggle-history-persistence').prop('checked', hp.enabled || false);
    $('#rpg-history-message-count').val(hp.messageCount ?? 5);
    $('#rpg-history-injection-position').val(hp.injectionPosition || 'assistant_message_end');
    $('#rpg-toggle-send-all-on-refresh').prop('checked', hp.sendAllEnabledOnRefresh || false);
    // Lorebook Manager
    const lbEnabled = extensionSettings.lorebook?.enabled ?? true;
    $('#rpg-toggle-lorebook').prop('checked', lbEnabled);
    $('#rpg-lb-badge').text(lbEnabled ? 'on' : 'off');
    // TTS Highlight
    const tts = extensionSettings.ttsHighlightSettings || {};
    $('#rpg-tts-badge').text(extensionSettings.ttsHighlightMode === 'off' ? 'off' : 'on');
    $('#rpg-tts-color-left').val(tts.gradientColorLeft || '#e94560');
    $('#rpg-tts-color-right').val(tts.gradientColorRight || '#9333ea');
    $('#rpg-tts-override-text-color').prop('checked', tts.overrideTextColor ?? false);
    $('#rpg-tts-text-color-row').toggle(tts.overrideTextColor ?? false);
    $('#rpg-tts-active-text-color').val(tts.activeTextColor || '#ffffff');
    $('#rpg-tts-gradient-opacity').val(tts.gradientOpacity ?? 30);
    $('#rpg-tts-gradient-opacity-value').text((tts.gradientOpacity ?? 30) + '%');
    $('#rpg-tts-glow-intensity').val(tts.glowIntensity ?? 16);
    $('#rpg-tts-glow-intensity-value').text((tts.glowIntensity ?? 16) + 'px');
    $('#rpg-tts-border-radius').val(tts.borderRadius ?? 4);
    $('#rpg-tts-border-radius-value').text((tts.borderRadius ?? 4) + 'px');
    $('#rpg-tts-read-opacity').val(tts.readOpacity ?? 35);
    $('#rpg-tts-read-opacity-value').text((tts.readOpacity ?? 35) + '%');
    $('#rpg-tts-unread-opacity').val(tts.unreadOpacity ?? 55);
    $('#rpg-tts-unread-opacity-value').text((tts.unreadOpacity ?? 55) + '%');
    $('#rpg-tts-transition-speed').val(tts.transitionSpeed ?? 300);
    applyTtsHighlightSettings();
    // Chat Bubbles & Info Panel
    loadChatBubbleSettingsUI();
    applyChatBubbleSettings();
    updateSectionVisibility();
    applyTheme();
    toggleCustomColors();
    toggleAnimations();
    // Render initial data if available (still needed to populate state for scene headers)
    console.log('[Dooms Tracker] About to render initial data...');
    try { renderInfoBox(); console.log('[Dooms Tracker] renderInfoBox() OK'); } catch(e) { console.error('[Dooms Tracker] renderInfoBox() FAILED:', e); }
    try { renderThoughts(); console.log('[Dooms Tracker] renderThoughts() OK'); } catch(e) { console.error('[Dooms Tracker] renderThoughts() FAILED:', e); }
    try { renderQuests(); console.log('[Dooms Tracker] renderQuests() OK'); } catch(e) { console.error('[Dooms Tracker] renderQuests() FAILED:', e); }
    try { updateChatSceneHeaders(); console.log('[Dooms Tracker] updateChatSceneHeaders() OK'); } catch(e) { console.error('[Dooms Tracker] updateChatSceneHeaders() FAILED:', e); }
    // Info panel is now a scene tracker layout mode — no separate updateInfoPanel() needed
    try { initPortraitBar(); console.log('[Dooms Tracker] initPortraitBar() OK'); } catch(e) { console.error('[Dooms Tracker] initPortraitBar() FAILED:', e); }
    // Add settings button as a fixed-position element on <body> so it's
    // always accessible even when the portrait bar is hidden
    if ($('#dooms-settings-fab').length === 0) {
        const fabHtml = `
            <div id="dooms-settings-fab" class="dooms-settings-fab" title="Doom's Tracker Settings">
                <button id="dooms-fab-settings" class="dooms-fab-btn" title="Settings">
                    <span class="doom-icon"></span>
                </button>
            </div>
        `;
        $('body').append(fabHtml);
        $('#dooms-fab-settings').on('click', function() {
            const modal = getSettingsModal();
            if (modal) {
                modal.open();
            } else {
                $('#rpg-settings-popup').show();
            }
        });
    }
    // Initialize TTS sentence highlight — Gradient Glow Pill (monkey-patches speechSynthesis.speak)
    try { initTtsHighlight(); console.log('[Dooms Tracker] initTtsHighlight() OK'); } catch(e) { console.error('[Dooms Tracker] initTtsHighlight() FAILED:', e); }
    try { initBubbleTtsHandlers(); console.log('[Dooms Tracker] initBubbleTtsHandlers() OK'); } catch(e) { console.error('[Dooms Tracker] initBubbleTtsHandlers() FAILED:', e); }
    try { setupSettingsPopup(); console.log('[Dooms Tracker] setupSettingsPopup() OK'); } catch(e) { console.error('[Dooms Tracker] setupSettingsPopup() FAILED:', e); }
    try { initTrackerEditor(); console.log('[Dooms Tracker] initTrackerEditor() OK'); } catch(e) { console.error('[Dooms Tracker] initTrackerEditor() FAILED:', e); }
    try { initPromptsEditor(); console.log('[Dooms Tracker] initPromptsEditor() OK'); } catch(e) { console.error('[Dooms Tracker] initPromptsEditor() FAILED:', e); }
    console.log('[Dooms Tracker] initUI() rendering complete');
}
/**
 * Main initialization function.
 */
jQuery(async () => {
    try {
        console.log('[Dooms Tracker] jQuery ready - Starting initialization...');
        console.log('[Dooms Tracker] extensionName:', extensionName);
        console.log('[Dooms Tracker] extensionSettings.enabled:', extensionSettings.enabled);
        // Load settings with validation
        try {
            console.log('[Dooms Tracker] Loading settings...');
            loadSettings();
            console.log('[Dooms Tracker] Settings loaded OK. enabled =', extensionSettings.enabled);
        } catch (error) {
            console.error('[Dooms Tracker] Settings load failed, continuing with defaults:', error);
        }
        // Play cinematic loading intro (if enabled) — runs CONCURRENTLY with initialization
        // so the animation plays while everything loads in the background
        let introPromise = Promise.resolve();
        try {
            introPromise = playLoadingIntro();
        } catch (error) {
            console.error('[Dooms Tracker] Loading intro failed:', error);
        }
        // Check if migration to v3 JSON format is needed
        try {
            if (extensionSettings.settingsVersion < 3) {
                await migrateToV3JSON();
                updateExtensionSettings({ settingsVersion: 3 });
                await saveSettings();
            }
        } catch (error) {
            console.error('[Dooms Tracker] Migration to v3 failed:', error);
            // Non-critical - extension can still work with v2 format
        }
        // Initialize i18n early for the settings panel
        await i18n.init();
        // Set up a central listener for language changes to update dynamic UI parts
        i18n.addEventListener('languageChanged', updateDynamicLabels);
        // Add extension settings to Extensions tab
        try {
            await addExtensionSettings();
        } catch (error) {
            console.error('[Dooms Tracker] Failed to add extension settings tab:', error);
            // Don't throw - extension can still work without settings tab
        }
        // Initialize UI
        try {
            console.log('[Dooms Tracker] About to call initUI()...');
            await initUI();
            console.log('[Dooms Tracker] initUI() completed OK');
        } catch (error) {
            console.error('[Dooms Tracker] UI initialization failed:', error);
            console.error('[Dooms Tracker] UI error stack:', error.stack);
            throw error; // This is critical - can't continue without UI
        }
        // Load chat-specific data for current chat
        try {
            loadChatData();
            // Re-render sidebar panels immediately (don't depend on #chat DOM)
            try { renderInfoBox(); } catch(e) { console.error('[Dooms Tracker] Post-load renderInfoBox() FAILED:', e); }
            try { renderThoughts(); } catch(e) { console.error('[Dooms Tracker] Post-load renderThoughts() FAILED:', e); }
            try { renderQuests(); } catch(e) { console.error('[Dooms Tracker] Post-load renderQuests() FAILED:', e); }
            try { updatePortraitBar(); } catch(e) { console.error('[Dooms Tracker] Post-load updatePortraitBar() FAILED:', e); }
            console.log('[Dooms Tracker] Post-loadChatData sidebar re-render complete');
            // Note: DOM-dependent renders (scene headers, info panel, thoughts in chat)
            // will be handled by the CHAT_CHANGED event handler when SillyTavern finishes
            // loading and rendering the chat messages.
        } catch (error) {
            console.error('[Dooms Tracker] Chat data load failed, using defaults:', error);
        }
        // Import the HTML cleaning regex if needed
        try {
            await ensureHtmlCleaningRegex(st_extension_settings, saveSettingsDebounced);
        } catch (error) {
            console.error('[Dooms Tracker] HTML regex import failed:', error);
            // Non-critical - continue without it
        }
        // Import the tracker cleaning regex (removes old together mode JSON from prompts)
        try {
            await ensureTrackerCleaningRegex(st_extension_settings, saveSettingsDebounced);
        } catch (error) {
            console.error('[Dooms Tracker] Tracker cleaning regex import failed:', error);
            // Non-critical - continue without it
        }
        // Import the JSON cleaning regex to clean up JSON in messages
        // This cleans historical messages when displayed
        try {
            await ensureJsonCleaningRegex(st_extension_settings, saveSettingsDebounced);
        } catch (error) {
            console.error('[Dooms Tracker] JSON cleaning regex setup failed:', error);
            // Non-critical - continue without it
        }
        // Wait for the intro animation to finish (if it's still playing)
        // At this point all initialization is done — we just wait for the visual to complete
        try {
            await introPromise;
        } catch (error) {
            console.error('[Dooms Tracker] Loading intro failed:', error);
        }
        // Detect conflicting regex scripts from old manual formatters
        try {
            const conflicts = detectConflictingRegexScripts(st_extension_settings);
            if (conflicts.length > 0) {
                // Show user-friendly warning (non-blocking)
                // toastr.warning(
                //     `Found ${conflicts.length} old RPG formatting regex script(s). These may conflict with the extension. Check console for details.`,
                //     'Dooms Tracker Warning',
                //     { timeOut: 8000 }
                // );
            }
        } catch (error) {
            console.error('[Dooms Tracker] Conflict detection failed:', error);
            // Non-critical - continue anyway
        }
        // Initialize history injection event listeners
        // This must be done before event registration so listeners are ready
        try {
            initHistoryInjection();
        } catch (error) {
            console.error('[Dooms Tracker] History injection init failed:', error);
            // Non-critical - continue without it
        }
        // Register all event listeners
        try {
            registerAllEvents({
                [event_types.MESSAGE_SENT]: onMessageSent,
                [event_types.GENERATION_STARTED]: onGenerationStarted,
                [event_types.MESSAGE_RECEIVED]: onMessageReceived,
                [event_types.GENERATION_STOPPED]: onGenerationEnded,
                [event_types.GENERATION_ENDED]: onGenerationEnded,
                [event_types.CHAT_CHANGED]: [onCharacterChanged, updatePersonaAvatar, clearSessionAvatarPrompts, clearPortraitCache],
                [event_types.MESSAGE_SWIPED]: onMessageSwiped,
                [event_types.USER_MESSAGE_RENDERED]: updatePersonaAvatar,
                [event_types.SETTINGS_UPDATED]: updatePersonaAvatar
            });
            // Re-populate connection profile dropdown when profiles are created/deleted/updated
            eventSource.on(event_types.CONNECTION_PROFILE_CREATED, () => populateConnectionProfileDropdown());
            eventSource.on(event_types.CONNECTION_PROFILE_DELETED, () => populateConnectionProfileDropdown());
            eventSource.on(event_types.CONNECTION_PROFILE_UPDATED, () => populateConnectionProfileDropdown());
            // TTS compatibility: remove any stale display_text that prior versions
            // may have saved to chat messages.  SillyTavern uses display_text for
            // RENDERING as well as TTS, so setting it to a font-stripped copy was
            // causing dialogue colors to disappear on chat reload.
            //
            // Instead of display_text we now auto-enable the TTS regex filter to
            // strip <font> tags at narration time only, keeping colors in the UI.
            eventSource.on(event_types.CHAT_CHANGED, () => {
                // Clean up stale display_text from ALL messages so SillyTavern
                // renders from msg.mes (which contains the <font> colour tags).
                // Prior versions set display_text to a font-stripped copy for TTS,
                // but SillyTavern also uses display_text for RENDERING — causing
                // dialogue colours to vanish on reload.
                const affectedIds = [];
                for (let i = 0; i < chat.length; i++) {
                    const msg = chat[i];
                    if (!msg || msg.is_user || !msg.extra) continue;
                    if (msg.extra.display_text !== undefined) {
                        delete msg.extra.display_text;
                        // Only need to re-render if the message actually has font tags
                        if (msg.mes && /<font\s/i.test(msg.mes)) {
                            affectedIds.push(i);
                        }
                    }
                }
                // Re-render affected messages so the DOM reflects msg.mes (with colours)
                if (affectedIds.length > 0) {
                    console.log(`[Dooms Tracker] Re-rendering ${affectedIds.length} messages to restore dialogue colours`);
                    for (const id of affectedIds) {
                        const msg = chat[id];
                        const mesEl = document.querySelector(`#chat .mes[mesid="${id}"] .mes_text`);
                        if (mesEl && msg) {
                            mesEl.innerHTML = messageFormatting(
                                msg.mes, msg.name, msg.is_system, msg.is_user, id, {}, false
                            );
                        }
                    }
                }
                // Auto-configure TTS regex to strip <font> tags at narration time.
                // This keeps colours visible in the chat while giving TTS clean text.
                if (extensionSettings.enableDialogueColoring && st_extension_settings?.tts) {
                    const fontRegex = '/<\\/?font[^>]*>/gi';
                    if (!st_extension_settings.tts.apply_regex) {
                        st_extension_settings.tts.apply_regex = true;
                        $('#tts_regex').prop('checked', true);
                    }
                    if (!st_extension_settings.tts.regex_pattern ||
                        !st_extension_settings.tts.regex_pattern.includes('font')) {
                        // Set or append our font-stripping regex
                        st_extension_settings.tts.regex_pattern = fontRegex;
                        $('#tts_regex_pattern').val(fontRegex);
                        console.log('[Dooms Tracker] Set TTS regex to strip <font> tags for dialogue coloring');
                    }
                }
            });
            // ── Chat Bubbles: apply per-character bubbles to messages ──
            eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, (messageId) => {
                if (!extensionSettings.enabled) return;
                // Apply chat bubbles if active
                if (extensionSettings.chatBubbleMode && extensionSettings.chatBubbleMode !== 'off') {
                    const messageElement = document.querySelector(`#chat .mes[mesid="${messageId}"]`);
                    if (messageElement) {
                        const mesText = messageElement.querySelector('.mes_text');
                        if (mesText) {
                            // Clear stale bubble data — content was just (re)rendered.
                            // Without this, applyChatBubbles sees the old style attribute
                            // and early-returns, skipping bubble re-application.
                            mesText.removeAttribute('data-dooms-original-html');
                            mesText.removeAttribute('data-dooms-bubbles-applied');
                            mesText.removeAttribute('data-dooms-bubbles-style');
                        }
                        // Wait for colored-dialogues to finish adding <font color> tags
                        // (it uses a 600ms debounce on CHARACTER_MESSAGE_RENDERED)
                        setTimeout(() => applyChatBubbles(messageElement, extensionSettings.chatBubbleMode), 800);
                    }
                }
                // Update scene tracker (new data may be available after message render)
                setTimeout(() => updateChatSceneHeaders(), 100);
            });
            eventSource.on(event_types.USER_MESSAGE_RENDERED, (messageId) => {
                if (!extensionSettings.enabled) return;
                if (!extensionSettings.chatBubbleMode || extensionSettings.chatBubbleMode === 'off') return;
                const messageElement = document.querySelector(`#chat .mes[mesid="${messageId}"]`);
                if (messageElement) {
                    applyChatBubbles(messageElement, extensionSettings.chatBubbleMode);
                }
            });
            eventSource.on(event_types.CHAT_CHANGED, () => {
                if (!extensionSettings.enabled) return;
                // Apply chat bubbles if active
                if (extensionSettings.chatBubbleMode && extensionSettings.chatBubbleMode !== 'off') {
                    // Delay to let SillyTavern finish rendering all messages
                    setTimeout(() => applyAllChatBubbles(), 150);
                }
                // Scene tracker re-render is handled by onCharacterChanged via CHAT_CHANGED
            });
            // TTS Highlight: clear all highlights when switching chats
            eventSource.on(event_types.CHAT_CHANGED, () => {
                onTtsHighlightModeChanged('_reset', extensionSettings.ttsHighlightMode || 'off');
            });
            // MESSAGE_UPDATED fires after the DOM is re-rendered with the edited content.
            // CHARACTER_MESSAGE_RENDERED does NOT fire on edits.
            // We need to re-apply chat bubbles AND re-insert inline thoughts.
            eventSource.on(event_types.MESSAGE_UPDATED, (messageId) => {
                if (!extensionSettings.enabled) return;

                // Re-apply chat bubbles if active
                if (extensionSettings.chatBubbleMode && extensionSettings.chatBubbleMode !== 'off') {
                    const messageElement = document.querySelector(`#chat .mes[mesid="${messageId}"]`);
                    if (messageElement) {
                        const mesText = messageElement.querySelector('.mes_text');
                        if (mesText) {
                            // Clear stale original HTML since the content was just edited
                            mesText.removeAttribute('data-dooms-original-html');
                            mesText.removeAttribute('data-dooms-bubbles-applied');
                            mesText.removeAttribute('data-dooms-bubbles-style');
                        }
                        // Wait for colored-dialogues to finish recoloring
                        setTimeout(() => applyChatBubbles(messageElement, extensionSettings.chatBubbleMode), 800);
                    }
                }

                // Re-insert inline character thoughts (editing replaces .mes_text
                // contents, destroying any previously appended thought elements)
                setTimeout(() => updateChatThoughts(), 100);
            });
            // MESSAGE_SWIPED fires when the user navigates between swipe variants.
            // SillyTavern replaces .mes_text with the new swipe content, destroying
            // any bubble DOM we previously rendered.  CHARACTER_MESSAGE_RENDERED does
            // NOT fire for existing swipes, so we must re-apply bubbles here.
            // We wait 800ms because colored-dialogues recolors on swipe with a 600ms
            // debounce, and we need the <font color> tags in place before parsing.
            eventSource.on(event_types.MESSAGE_SWIPED, (messageIndex) => {
                if (!extensionSettings.enabled) return;
                if (!extensionSettings.chatBubbleMode || extensionSettings.chatBubbleMode === 'off') return;

                const messageElement = document.querySelector(`#chat .mes[mesid="${messageIndex}"]`);
                if (!messageElement) return;

                const mesText = messageElement.querySelector('.mes_text');
                if (mesText) {
                    // Clear stale bubble data — the swipe has new content
                    mesText.removeAttribute('data-dooms-original-html');
                    mesText.removeAttribute('data-dooms-bubbles-applied');
                    mesText.removeAttribute('data-dooms-bubbles-style');
                }
                // Delay to let colored-dialogues finish recoloring (600ms debounce + processing)
                setTimeout(() => applyChatBubbles(messageElement, extensionSettings.chatBubbleMode), 800);
            });
        } catch (error) {
            console.error('[Dooms Tracker] Event registration failed:', error);
            throw error; // This is critical - can't continue without events
        }
        console.log('[Dooms Tracker] ✅ Extension loaded successfully.');
    } catch (error) {
        console.error('[Dooms Tracker] ❌ Critical initialization failure:', error);
        console.error('[Dooms Tracker] Error details:', error.message, error.stack);
        // Show user-friendly error message
        toastr.error(
            'Dooms Tracker failed to initialize. Check console for details. Please try refreshing the page or resetting extension settings.',
            'Dooms Tracker Error',
            { timeOut: 10000 }
        );
    }
});
