import { getContext, renderExtensionTemplateAsync, extension_settings as st_extension_settings } from '../../../extensions.js';
import { eventSource, event_types, substituteParams, chat, saveSettingsDebounced, chat_metadata, saveChatDebounced, user_avatar, getThumbnailUrl, characters, this_chid, extension_prompt_types, extension_prompt_roles, setExtensionPrompt, reloadCurrentChat, Generate, getRequestHeaders, messageFormatting } from '../../../../script.js';
import { selected_group, getGroupMembers } from '../../../group-chats.js';
import { power_user } from '../../../power-user.js';
import { callGenericPopup, POPUP_TYPE, POPUP_RESULT } from '../../../popup.js';
// Core modules
import { extensionName, extensionFolderPath, getExtensionVersion } from './src/core/config.js';
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
    applyPortraitBarSettings,
    applySideModeStyling
} from './src/systems/ui/portraitBar.js';
import { initCharacterWorkshop } from './src/systems/ui/characterWorkshop.js';
import { initCharacterRoster } from './src/systems/ui/characterRoster.js';
import {
    initWeatherEffects,
    updateWeatherEffect,
    toggleDynamicWeather,
    cleanupWeatherEffects
} from './src/systems/ui/weatherEffects.js';
import {
    applyChatBubbles,
    applyAllChatBubbles,
    revertAllChatBubbles,
    revertLastMessageBubbles,
    onChatBubbleModeChanged,
    applyChatBubbleSettings,
    initBubbleTtsHandlers,
    injectReasoningTtsButtons
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
import { renderApprovedNamesTags, renderIgnoredNamesTags, renderMappingsTable } from './src/systems/features/nameBan.js';
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
    initHistoryInjection,
    initDoomCounterListener
} from './src/systems/integration/sillytavern.js';
import {
    initExpressionSync,
    queueExpressionCaptureForSpeaker,
    syncExpressionFromLatestMessage,
    onExpressionSyncSettingChanged,
    onHideDefaultExpressionDisplaySettingChanged,
    clearExpressionSyncCache,
    onExpressionSyncChatChanged
} from './src/systems/integration/expressionSync.js';
// Doom Counter
import { triggerDoomCounter, updateDoomCounterUI, resetCounters, isTrapTwistPending, clearTrapTwistFlag } from './src/systems/generation/doomCounter.js';
// System Log & Notification Log
import { initSystemLog, openSystemLog } from './src/systems/ui/systemLog.js';
import { initNotificationLog } from './src/systems/ui/notificationLog.js';
// Character Sheet
import { initCharacterSheet, importFullSheetFromMessage, messageHasFullSheet, injectFullSheetButtons, clearStatsCache } from './src/systems/ui/characterSheet.js';
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
    // Initialize log captures early so they catch all init messages
    try { initSystemLog(); } catch(e) { console.error('[Dooms Tracker] initSystemLog() FAILED:', e); }
    try { initNotificationLog(); } catch(e) { console.error('[Dooms Tracker] initNotificationLog() FAILED:', e); }
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
            clearExpressionSyncCache();
            onHideDefaultExpressionDisplaySettingChanged(extensionSettings.hideDefaultExpressionDisplay);
        } else if (extensionSettings.enabled && !wasEnabled) {
            // Enabling extension - initialize UI
            await initUI();
            loadChatData(); // Load chat data for current chat
            updateChatThoughts(); // Create thought bubbles if data exists
            onHideDefaultExpressionDisplaySettingChanged(extensionSettings.hideDefaultExpressionDisplay);
            if (extensionSettings.syncExpressionsToPresentCharacters) {
                initExpressionSync();
                syncExpressionFromLatestMessage();
            }
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
    // "Star on GitHub" button in the extension dropdown
    $('#dooms-github-star-btn').on('click', function() {
        window.open('https://github.com/DangerDaza/Dooms-Enhancement-Suite', '_blank', 'noopener,noreferrer');
    });
    fetch('https://api.github.com/repos/DangerDaza/Dooms-Enhancement-Suite', { headers: { 'Accept': 'application/vnd.github+json' } })
        .then(res => res.ok ? res.json() : null)
        .then(data => {
            if (data && typeof data.stargazers_count === 'number') {
                $('#dooms-github-star-btn .dooms-github-star-count').text(data.stargazers_count.toLocaleString());
            }
        })
        .catch(() => {});
    // Populate version from manifest.json so the dropdown always reflects the current release
    getExtensionVersion().then(v => {
        if (v) $('#dooms-version-display').text(`v${v}`);
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
 * Shows/hides UI elements based on the current generation mode.
 * Together: hides manual update button, auto-update toggle, external API settings
 * Separate: shows manual update + auto-update, hides external API settings
 * External: shows manual update + auto-update + external API settings
 */
function updateGenerationModeUI() {
    const mode = extensionSettings.generationMode || 'together';
    if (mode === 'together') {
        $('#rpg-manual-update').hide();
        $('#rpg-auto-update-container').hide();
        $('#rpg-external-api-settings').slideUp(200);
    } else if (mode === 'separate') {
        $('#rpg-manual-update').show();
        $('#rpg-auto-update-container').show();
        $('#rpg-external-api-settings').slideUp(200);
    } else if (mode === 'external') {
        $('#rpg-manual-update').show();
        $('#rpg-auto-update-container').show();
        $('#rpg-external-api-settings').slideDown(200);
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
    $('#rpg-cb-narrator-italic').prop('checked', cbs.narratorItalic !== false);
    $('#rpg-cb-hide-st-avatar').prop('checked', cbs.hideStAvatar === true);

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
    $('#rpg-generation-mode').on('change', function() {
        extensionSettings.generationMode = String($(this).val());
        saveSettings();
        updateGenerationModeUI();
    });
    $('#rpg-toggle-auto-update').on('change', function() {
        extensionSettings.autoUpdate = $(this).prop('checked');
        saveSettings();
    });
    $('#rpg-update-depth').on('change', function() {
        const value = $(this).val();
        extensionSettings.updateDepth = parseInt(String(value));
        saveSettings();
    });
    $('#rpg-manual-update').on('click', async function() {
        const $btn = $(this);
        const originalHtml = $btn.html();
        $btn.html('<i class="fa-solid fa-spinner fa-spin"></i> Generating...').prop('disabled', true);
        try {
            await updateRPGData(renderInfoBox, renderThoughts);
            updateChatSceneHeaders();
            updatePortraitBar();
            updateChatThoughts();
        } finally {
            $btn.html(originalHtml).prop('disabled', false);
        }
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
    // Lock Icons toggle removed — lock UI disabled until wired into scene tracker
    $('#rpg-toggle-portrait-bar').on('change', function() {
        const on = $(this).prop('checked');
        extensionSettings.showPortraitBar = on;
        saveSettings();
        updatePortraitBar();
        $('#rpg-pb-badge').text(on ? 'on' : 'off');
        // Workshop/Roster are part of PCP — track the live toggle.
        $('#rpg-open-character-roster').toggle(on);
        $('#dooms-pb-open-roster').toggle(on);
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
        // Show side-only options only when a side mode is active.
        const isSide = $(this).val() === 'left' || $(this).val() === 'right';
        $('#rpg-pb-side-options').toggle(isSide);
        relabelPortraitAlignmentOptions(isSide);
    });
    $('#rpg-pb-side-columns').on('change', function() {
        const cols = parseInt($(this).val(), 10);
        extensionSettings.portraitSideColumns = (cols >= 1 && cols <= 2) ? cols : 1;
        saveSettings();
        try { applySideModeStyling(); } catch (e) {}
    });
    $('#rpg-pb-side-height').on('change', function() {
        const val = $(this).val();
        extensionSettings.portraitSideHeight = (val === 'full') ? 'full' : 'auto';
        saveSettings();
        try { applySideModeStyling(); } catch (e) {}
    });

    /**
     * Contextual labels for the Alignment dropdown.
     * Horizontal position (above / below / top): "Inline (Left)" / "Centered"
     * Side position (left / right): "Top" / "Bottom"
     * Underlying values stay 'left' / 'center' so settings persist across mode changes.
     */
    function relabelPortraitAlignmentOptions(isSide) {
        const $left = $('#rpg-portrait-alignment option[value="left"]');
        const $center = $('#rpg-portrait-alignment option[value="center"]');
        if (isSide) {
            $left.text('Top');
            $center.text('Bottom');
        } else {
            $left.text('Inline (Left)');
            $center.text('Centered');
        }
    }
    window.__doomsRelabelAlignment = relabelPortraitAlignmentOptions;

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
    $('#rpg-pb-auto-import').on('change', function() { extensionSettings.portraitAutoImport = $(this).prop('checked'); saveSettings(); });

    // Export portraits as individual image downloads
    $('#rpg-export-portraits').on('click', async function() {
        const avatars = extensionSettings.npcAvatars || {};
        const fullRes = extensionSettings.npcAvatarsFullRes || {};
        const names = Object.keys({ ...avatars, ...fullRes });
        if (names.length === 0) {
            toastr.info('No uploaded portraits to export.', '', { timeOut: 2000 });
            return;
        }
        let exported = 0;
        for (const name of names) {
            // Prefer full-res, fall back to cropped
            const dataUri = fullRes[name] || avatars[name];
            if (!dataUri) continue;
            try {
                // Extract mime type and extension
                const match = dataUri.match(/^data:image\/(\w+);base64,/);
                const ext = match ? match[1].replace('jpeg', 'jpg') : 'png';
                // Convert base64 to blob
                const byteString = atob(dataUri.split(',')[1]);
                const ab = new ArrayBuffer(byteString.length);
                const ia = new Uint8Array(ab);
                for (let i = 0; i < byteString.length; i++) ia[i] = byteString.charCodeAt(i);
                const blob = new Blob([ab], { type: match ? `image/${match[1]}` : 'image/png' });
                // Trigger download
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `${name.replace(/[^a-zA-Z0-9_-]/g, '_')}.${ext}`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
                exported++;
                // Small delay between downloads so browser doesn't block them
                if (names.length > 1) await new Promise(r => setTimeout(r, 300));
            } catch (e) {
                console.error(`[Dooms Tracker] Failed to export portrait for ${name}:`, e);
            }
        }
        toastr.success(`Exported ${exported} portrait${exported !== 1 ? 's' : ''}.`, '', { timeOut: 3000 });
    });

    $('#rpg-pb-sync-expressions').on('change', function() {
        extensionSettings.syncExpressionsToPresentCharacters = $(this).prop('checked');
        saveSettings();
        onExpressionSyncSettingChanged(extensionSettings.syncExpressionsToPresentCharacters);
        $('#rpg-expression-options').toggle($(this).prop('checked'));
    });
    $('#rpg-expression-classifier-api').on('change', function() {
        extensionSettings.expressionClassifierApi = $(this).val();
        saveSettings();
        $('#rpg-expression-batch-row').toggle($(this).val() === 'llm');
    });
    $('#rpg-expression-batch-mode').on('change', function() {
        extensionSettings.expressionBatchMode = $(this).prop('checked');
        saveSettings();
    });
    $('#rpg-pb-hide-default-expressions').on('change', function() {
        extensionSettings.hideDefaultExpressionDisplay = $(this).prop('checked');
        saveSettings();
        onHideDefaultExpressionDisplaySettingChanged(extensionSettings.hideDefaultExpressionDisplay);
    });
    $('#rpg-pb-show-expression-in-tooltip').on('change', function() {
        extensionSettings.showExpressionInTooltip = $(this).prop('checked');
        saveSettings();
        // Rebuild cards so the new title attr takes effect immediately.
        try { updatePortraitBar(); } catch (e) { console.warn('[Dooms Tracker] updatePortraitBar() after tooltip toggle failed:', e); }
    });
    // Subsection info popup (DES Settings → Expressions). Click the (i) button
    // to toggle the help card; click anywhere else or press Esc to dismiss.
    $(document).on('click', '#rpg-expressions-info-btn', function (e) {
        e.preventDefault(); e.stopPropagation();
        const $popup = $('#rpg-expressions-info-popup');
        const open = $popup.prop('hidden');
        $popup.prop('hidden', !open);
        $(this).attr('aria-expanded', open ? 'true' : 'false');
    });
    $(document).on('click', function (e) {
        const $popup = $('#rpg-expressions-info-popup');
        if (!$popup.length || $popup.prop('hidden')) return;
        if ($(e.target).closest('#rpg-expressions-info-popup, #rpg-expressions-info-btn').length) return;
        $popup.prop('hidden', true);
        $('#rpg-expressions-info-btn').attr('aria-expanded', 'false');
    });
    $(document).on('keydown', function (e) {
        if (e.key !== 'Escape') return;
        const $popup = $('#rpg-expressions-info-popup');
        if (!$popup.length || $popup.prop('hidden')) return;
        $popup.prop('hidden', true);
        $('#rpg-expressions-info-btn').attr('aria-expanded', 'false');
    });
    $('#rpg-pb-per-chat-tracking').on('change', function() {
        extensionSettings.perChatCharacterTracking = $(this).prop('checked');
        saveSettings();
        loadChatData();
        updatePortraitBar();
    });

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

    /**
     * Shows/hides the color pickers and theme-controlled notice in the
     * Scene Tracker → Colors section based on the themeControlled toggle state.
     */
    function _updateStThemeControlledUI(controlled) {
        if (controlled) {
            $('#rpg-st-colors-group').hide();
            $('#rpg-st-theme-msg').show();
        } else {
            $('#rpg-st-colors-group').show();
            $('#rpg-st-theme-msg').hide();
        }
    }

    // Visibility toggles
    $('#rpg-st-show-time').on('change', function() { _stSettings().showTime = $(this).prop('checked'); _saveSt(); });
    $('#rpg-st-show-date').on('change', function() { _stSettings().showDate = $(this).prop('checked'); _saveSt(); });
    $('#rpg-st-show-location').on('change', function() { _stSettings().showLocation = $(this).prop('checked'); _saveSt(); });
    $('#rpg-st-show-characters').on('change', function() { _stSettings().showCharacters = $(this).prop('checked'); _saveSt(); });
    $('#rpg-st-show-quest').on('change', function() { _stSettings().showQuest = $(this).prop('checked'); _saveSt(); });
    $('#rpg-st-show-events').on('change', function() { _stSettings().showRecentEvents = $(this).prop('checked'); _saveSt(); });
    // Optional fields: Scene Tracker toggle and infoBox widget enabled flag are the same concept.
    // Syncing both ensures the AI generates the field AND the tracker bar displays it.
    const _syncOptionalField = (widgetKey, checked) => {
        const widgets = extensionSettings.trackerConfig?.infoBox?.widgets;
        if (widgets) {
            if (!widgets[widgetKey]) widgets[widgetKey] = { enabled: false, persistInHistory: false };
            widgets[widgetKey].enabled = checked;
        }
    };
    $('#rpg-st-show-moonphase').on('change', function() {
        const v = $(this).prop('checked');
        _stSettings().showMoonPhase = v;
        _syncOptionalField('moonPhase', v);
        _saveSt();
    });
    $('#rpg-st-show-tension').on('change', function() {
        const v = $(this).prop('checked');
        _stSettings().showTension = v;
        _syncOptionalField('tension', v);
        _saveSt();
    });
    $('#rpg-st-show-timesincerest').on('change', function() {
        const v = $(this).prop('checked');
        _stSettings().showTimeSinceRest = v;
        _syncOptionalField('timeSinceRest', v);
        _saveSt();
    });
    $('#rpg-st-show-conditions').on('change', function() {
        const v = $(this).prop('checked');
        _stSettings().showConditions = v;
        _syncOptionalField('conditions', v);
        _saveSt();
    });
    $('#rpg-st-show-terrain').on('change', function() {
        const v = $(this).prop('checked');
        _stSettings().showTerrain = v;
        _syncOptionalField('terrain', v);
        _saveSt();
    });
    $('#rpg-st-show-weather').on('change', function() {
        const v = $(this).prop('checked');
        _stSettings().showWeather = v;
        _syncOptionalField('weather', v);
        _saveSt();
    });
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
    $('#rpg-st-quest-text-color').on('input', function() { _stSettings().questTextColor = $(this).val(); _saveSt(); });
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
            themeControlled: false,
        };
        extensionSettings.sceneTracker = { ...defaults };
        $('#rpg-st-theme-controlled').prop('checked', false);
        _updateStThemeControlledUI(false);
        // Update all inputs
        $('#rpg-st-show-time').prop('checked', true);
        $('#rpg-st-show-date').prop('checked', true);
        $('#rpg-st-show-location').prop('checked', true);
        $('#rpg-st-show-characters').prop('checked', true);
        $('#rpg-st-show-quest').prop('checked', true);
        $('#rpg-st-show-events').prop('checked', true);
        $('#rpg-st-show-moonphase').prop('checked', false);
        $('#rpg-st-show-tension').prop('checked', false);
        $('#rpg-st-show-timesincerest').prop('checked', false);
        $('#rpg-st-show-conditions').prop('checked', false);
        $('#rpg-st-show-terrain').prop('checked', false);
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
        $('#rpg-st-quest-text-color').val('#f0c040');
        $('#rpg-st-events-color').val('#999999');
        _saveSt();
        updateChatSceneHeaders();
    });

    // ── Bunny Mo Integration ──
    $('#rpg-toggle-bunny-mo').on('change', function () {
        extensionSettings.bunnyMoIntegration = $(this).prop('checked');
        $('#rpg-bm-badge').text(extensionSettings.bunnyMoIntegration ? 'on' : 'off');
        saveSettings();
        if (extensionSettings.bunnyMoIntegration) {
            setTimeout(() => injectFullSheetButtons(), 100);
        }
    });

    // ── Doom Counter customization ──
    // ── Inline Banners ──
    const _ibSettings = () => {
        if (!extensionSettings.inlineBanners) extensionSettings.inlineBanners = {};
        return extensionSettings.inlineBanners;
    };

    $('#rpg-ib-toggle').on('change', function () {
        _ibSettings().enabled = $(this).prop('checked');
        $('#rpg-ib-badge').text($(this).prop('checked') ? 'on' : 'off');
        $('#rpg-ib-options').toggle($(this).prop('checked'));
        saveSettings();
        updateChatSceneHeaders();
    });

    $('#rpg-ib-style').on('change', function () {
        _ibSettings().style = $(this).val();
        saveSettings();
        updateChatSceneHeaders();
    });

    // ── Doom Counter ──
    const _dcSettings = () => {
        if (!extensionSettings.doomCounter) extensionSettings.doomCounter = {};
        return extensionSettings.doomCounter;
    };

    $('#rpg-toggle-doom-counter').on('change', function () {
        _dcSettings().enabled = $(this).prop('checked');
        saveSettings();
        $('#rpg-dc-badge').text($(this).prop('checked') ? 'on' : 'off');
        $('#rpg-dc-options').toggle($(this).prop('checked'));
        updateDoomCounterUI();
    });

    $('#rpg-dc-ceiling').on('input', function () {
        const v = parseInt($(this).val());
        _dcSettings().lowTensionCeiling = v;
        $('#rpg-dc-ceiling-value').text(`1-${v}`);
        saveSettings();
    });

    $('#rpg-dc-threshold').on('input', function () {
        const v = parseInt($(this).val());
        _dcSettings().lowTensionThreshold = v;
        $('#rpg-dc-threshold-value').text(v);
        $('#rpg-dc-streak-max').text(v);
        saveSettings();
    });

    $('#rpg-dc-countdown').on('input', function () {
        const v = parseInt($(this).val());
        _dcSettings().countdownLength = v;
        $('#rpg-dc-countdown-value').text(v);
        saveSettings();
    });

    $('#rpg-dc-choices').on('change', function () {
        _dcSettings().twistChoiceCount = parseInt($(this).val());
        saveSettings();
    });

    $('#rpg-dc-trap-mode').on('change', function () {
        _dcSettings().trapMode = $(this).prop('checked');
        saveSettings();
        updateDoomCounterUI();
        updateChatSceneHeaders();
    });

    // ── Advanced section toggle ──
    $('.rpg-dc-advanced-toggle').on('click', function () {
        const $body = $('.rpg-dc-advanced-body');
        const $chevron = $(this).find('.rpg-dc-advanced-chevron');
        $body.slideToggle(200);
        $chevron.toggleClass('fa-chevron-down fa-chevron-up');
    });

    // ── Advanced: Context Messages ──
    $('#rpg-dc-context-messages').on('input', function () {
        const v = parseInt($(this).val());
        _dcSettings().twistContextMessages = v;
        $('#rpg-dc-context-messages-value').text(v);
        saveSettings();
    });

    // ── Advanced: Message Truncation ──
    $('#rpg-dc-msg-truncation').on('input', function () {
        const v = parseInt($(this).val());
        _dcSettings().twistMessageTruncation = v;
        $('#rpg-dc-msg-truncation-value').text(v);
        saveSettings();
    });

    // ── Advanced: Twist Injection Depth ──
    $('#rpg-dc-injection-depth').on('input', function () {
        const v = parseInt($(this).val());
        _dcSettings().twistInjectionDepth = v;
        $('#rpg-dc-injection-depth-value').text(v);
        saveSettings();
    });

    $('#rpg-dc-debug-display').on('change', function () {
        const isDebug = $(this).prop('checked');
        _dcSettings().debugDisplay = isDebug;
        saveSettings();
        updateChatSceneHeaders();
        // Expand threshold slider range to 0 in debug mode for quick testing
        const $slider = $('#rpg-dc-threshold');
        if (isDebug) {
            $slider.attr('min', 0);
        } else {
            $slider.attr('min', 3);
            // Clamp value back up if it was set below 3
            const cur = parseInt($slider.val());
            if (cur < 3) {
                $slider.val(3);
                _dcSettings().lowTensionThreshold = 3;
                $('#rpg-dc-threshold-value').text(3);
                $('#rpg-dc-streak-max').text(3);
                saveSettings();
            }
        }
    });

    $('#rpg-dc-trigger-now').on('click', function () {
        triggerDoomCounter().catch(err => console.error('[Doom Counter] Manual trigger failed:', err));
    });

    $('#rpg-dc-reset').on('click', function () {
        resetCounters();
        saveChatData();
        updateDoomCounterUI();
        toastr.info('Doom Counter reset.', '', { timeOut: 2000 });
    });

    // ── Name Ban ──
    const _nbSettings = () => {
        if (!extensionSettings.nameBan) extensionSettings.nameBan = {};
        return extensionSettings.nameBan;
    };
    const _renderNbLists = () => {
        renderApprovedNamesTags($('#rpg-nb-approved-tags'));
        renderIgnoredNamesTags($('#rpg-nb-ignored-tags'));
        renderMappingsTable($('#rpg-nb-mappings-container'));
    };

    $('#rpg-toggle-name-ban').on('change', function () {
        _nbSettings().enabled = $(this).prop('checked');
        saveSettings();
        $('#rpg-nb-badge').text($(this).prop('checked') ? 'on' : 'off');
        $('#rpg-nb-options').toggle($(this).prop('checked'));
    });
    $('#rpg-nb-sensitivity').on('change', function () { _nbSettings().sensitivity = $(this).val(); saveSettings(); });
    $('#rpg-nb-show-modal').on('change', function () { _nbSettings().showModalForNew = $(this).prop('checked'); saveSettings(); });
    $('#rpg-nb-auto-apply').on('change', function () { _nbSettings().autoApplyKnownMappings = $(this).prop('checked'); saveSettings(); });
    $('#rpg-nb-inject-prompt').on('change', function () { _nbSettings().injectIntoPrompt = $(this).prop('checked'); saveSettings(); });
    const addApprovedName = () => { const name = $('#rpg-nb-add-approved').val().trim(); if (!name) return; const nb = _nbSettings(); if (!nb.approvedNames) nb.approvedNames = []; if (!nb.approvedNames.includes(name)) { nb.approvedNames.push(name); saveSettings(); _renderNbLists(); } $('#rpg-nb-add-approved').val(''); };
    $('#rpg-nb-add-approved-btn').on('click', addApprovedName);
    $('#rpg-nb-add-approved').on('keypress', function (e) { if (e.key === 'Enter') addApprovedName(); });
    const addIgnoredName = () => { const name = $('#rpg-nb-add-ignored').val().trim(); if (!name) return; const nb = _nbSettings(); if (!nb.ignoredNames) nb.ignoredNames = []; if (!nb.ignoredNames.includes(name)) { nb.ignoredNames.push(name); saveSettings(); _renderNbLists(); } $('#rpg-nb-add-ignored').val(''); };
    $('#rpg-nb-add-ignored-btn').on('click', addIgnoredName);
    $('#rpg-nb-add-ignored').on('keypress', function (e) { if (e.key === 'Enter') addIgnoredName(); });
    const addMapping = () => { const from = $('#rpg-nb-add-mapping-from').val().trim(); const to = $('#rpg-nb-add-mapping-to').val().trim(); if (!from || !to) return; const nb = _nbSettings(); if (!nb.nameMappings) nb.nameMappings = {}; nb.nameMappings[from] = to; saveSettings(); _renderNbLists(); $('#rpg-nb-add-mapping-from').val(''); $('#rpg-nb-add-mapping-to').val(''); };
    $('#rpg-nb-add-mapping-btn').on('click', addMapping);
    $('#rpg-nb-add-mapping-to').on('keypress', function (e) { if (e.key === 'Enter') addMapping(); });
    $(document).on('click', '.dooms-nb-tag-remove', function () { const name = $(this).data('name'); const list = $(this).data('list'); const nb = _nbSettings(); if (nb[list]) { nb[list] = nb[list].filter(n => n !== name); saveSettings(); _renderNbLists(); } });
    $(document).on('click', '.dooms-nb-mapping-delete', function () { const banned = $(this).data('banned'); const nb = _nbSettings(); if (nb.nameMappings) { delete nb.nameMappings[banned]; saveSettings(); _renderNbLists(); } });
    $('#rpg-nb-excluded-words').on('change', function () { _nbSettings().customExcludedWords = $(this).val().split('\n').map(w => w.trim()).filter(Boolean); saveSettings(); });
    $('#rpg-nb-clear-all').on('click', async function () { const confirm = await callGenericPopup('Clear all Name Ban data?', POPUP_TYPE.CONFIRM); if (confirm === POPUP_RESULT.AFFIRMATIVE) { const nb = _nbSettings(); nb.approvedNames = []; nb.nameMappings = {}; nb.ignoredNames = []; nb.customExcludedWords = []; saveSettings(); _renderNbLists(); $('#rpg-nb-excluded-words').val(''); } });

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
    $('#rpg-cb-show-avatars').on('change', function() {
        _cbSettings().showAvatars = $(this).prop('checked');
        _saveCb();
        const show = $(this).prop('checked');
        document.querySelectorAll('.dooms-bubbles').forEach(el => {
            el.classList.toggle('dooms-bubbles--no-avatars', !show);
        });
    });
    $('#rpg-cb-show-author-names').on('change', function() { _cbSettings().showAuthorNames = $(this).prop('checked'); _saveCbRerender(); });
    $('#rpg-cb-show-narrator-label').on('change', function() { _cbSettings().showNarratorLabel = $(this).prop('checked'); _saveCbRerender(); });
    $('#rpg-cb-narrator-italic').on('change', function() { _cbSettings().narratorItalic = $(this).prop('checked'); _saveCb(); });
    $('#rpg-cb-hide-st-avatar').on('change', function() {
        _cbSettings().hideStAvatar = $(this).prop('checked');
        _saveCb();
        document.body.classList.toggle('dooms-hide-st-avatar', $(this).prop('checked'));
    });

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
            narratorItalic: true,
            hideStAvatar: false,
        };
        document.body.classList.remove('dooms-hide-st-avatar');
        // Update all inputs to defaults
        loadChatBubbleSettingsUI();
        _saveCb();
        revertAllChatBubbles();
        applyAllChatBubbles();
    });

    // Ticker click delegation — expand/collapse
    // Uses $(document) delegation since the ticker is appended to <body> (position:fixed)
    $(document).on('click', '.dooms-info-ticker', function() {
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
        toggleDynamicWeather(extensionSettings.enableDynamicWeather);
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
        // Re-render scene tracker if theme-controlled colors are active
        if (extensionSettings.sceneTracker?.themeControlled) {
            applySceneTrackerSettings();
            updateChatSceneHeaders();
        }
    });
    // ── Animations toggle ──
    $('#rpg-toggle-animations').on('change', function() {
        extensionSettings.enableAnimations = $(this).prop('checked');
        saveSettings();
        toggleAnimations();
    });
    // ── Theme Controls Scene Tracker toggle ──
    $('#rpg-st-theme-controlled').on('change', function() {
        const controlled = $(this).prop('checked');
        extensionSettings.sceneTracker.themeControlled = controlled;
        saveSettings();
        _updateStThemeControlledUI(controlled);
        applySceneTrackerSettings();
        updateChatSceneHeaders();
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
    $('#rpg-generation-mode').val(extensionSettings.generationMode || 'together');
    $('#rpg-toggle-auto-update').prop('checked', extensionSettings.autoUpdate);
    $('#rpg-update-depth').val(extensionSettings.updateDepth);
    $('#rpg-toggle-narrator').prop('checked', extensionSettings.narratorMode);
    $('#rpg-skip-guided-mode').val(extensionSettings.skipInjectionsForGuided);
    populateConnectionProfileDropdown();
    updateGenerationModeUI();
    // Display
    $('#rpg-toggle-info-box').prop('checked', extensionSettings.showInfoBox);
    $('#rpg-toggle-thoughts').prop('checked', extensionSettings.showCharacterThoughts);
    $('#rpg-toggle-quests').prop('checked', extensionSettings.showQuests);
    // Lock Icons toggle removed — lock UI disabled until wired into scene tracker
    $('#rpg-toggle-portrait-bar').prop('checked', extensionSettings.showPortraitBar ?? true);
    $('#rpg-portrait-alignment').val(extensionSettings.portraitAlignment || 'left');
    $('#rpg-portrait-position').val(extensionSettings.portraitPosition || 'above');
    // Side-mode subordinate settings
    $('#rpg-pb-side-columns').val(String(extensionSettings.portraitSideColumns || 1));
    $('#rpg-pb-side-height').val(extensionSettings.portraitSideHeight === 'full' ? 'full' : 'auto');
    {
        const sideOpen = extensionSettings.portraitPosition === 'left' || extensionSettings.portraitPosition === 'right';
        $('#rpg-pb-side-options').toggle(sideOpen);
        try { applySideModeStyling(); } catch (e) {}
        // Relabel the alignment dropdown so side mode shows Top/Bottom.
        try { (window.__doomsRelabelAlignment || (()=>{}))(sideOpen); } catch (e) {}
    }
    // Portrait Bar customization
    const pb = extensionSettings.portraitBarSettings || {};
    $('#rpg-pb-badge').text((extensionSettings.showPortraitBar ?? true) ? 'on' : 'off');
    $('#rpg-pb-show-header').prop('checked', pb.showHeader !== false);
    $('#rpg-pb-show-absent').prop('checked', pb.showAbsentCharacters !== false);
    $('#rpg-pb-show-arrows').prop('checked', pb.showScrollArrows !== false);
    $('#rpg-pb-auto-import').prop('checked', extensionSettings.portraitAutoImport !== false);
    $('#rpg-pb-sync-expressions').prop('checked', extensionSettings.syncExpressionsToPresentCharacters === true);
    $('#rpg-expression-options').toggle(extensionSettings.syncExpressionsToPresentCharacters === true);
    $('#rpg-expression-classifier-api').val(extensionSettings.expressionClassifierApi || 'local');
    $('#rpg-expression-batch-mode').prop('checked', extensionSettings.expressionBatchMode !== false);
    $('#rpg-expression-batch-row').toggle((extensionSettings.expressionClassifierApi || 'local') === 'llm');
    $('#rpg-pb-hide-default-expressions').prop('checked', extensionSettings.hideDefaultExpressionDisplay === true);
    $('#rpg-pb-show-expression-in-tooltip').prop('checked', extensionSettings.showExpressionInTooltip === true);
    // Hide the 'Open Character Roster' settings button when PCP is off —
    // the Workshop is part of the Present Characters Panel feature set.
    $('#rpg-open-character-roster').toggle(extensionSettings.showPortraitBar !== false);
    $('#rpg-pb-per-chat-tracking').prop('checked', extensionSettings.perChatCharacterTracking === true);
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
    $('#rpg-st-show-moonphase').prop('checked', st.showMoonPhase === true);
    $('#rpg-st-show-tension').prop('checked', st.showTension === true);
    $('#rpg-st-show-timesincerest').prop('checked', st.showTimeSinceRest === true);
    $('#rpg-st-show-conditions').prop('checked', st.showConditions === true);
    $('#rpg-st-show-terrain').prop('checked', st.showTerrain === true);
    $('#rpg-st-show-weather').prop('checked', st.showWeather === true);
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
    $('#rpg-st-quest-text-color').val(st.questTextColor || st.questIconColor || '#f0c040');
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
    // Theme Controls Scene Tracker
    const _tcst = extensionSettings.sceneTracker?.themeControlled ?? false;
    $('#rpg-st-theme-controlled').prop('checked', _tcst);
    _updateStThemeControlledUI(_tcst);
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
    // Bunny Mo Integration
    $('#rpg-toggle-bunny-mo').prop('checked', extensionSettings.bunnyMoIntegration || false);
    $('#rpg-bm-badge').text(extensionSettings.bunnyMoIntegration ? 'on' : 'off');

    // Inline Banners
    const ib = extensionSettings.inlineBanners || {};
    $('#rpg-ib-toggle').prop('checked', ib.enabled || false);
    $('#rpg-ib-badge').text(ib.enabled ? 'on' : 'off');
    $('#rpg-ib-options').toggle(ib.enabled || false);
    $('#rpg-ib-style').val(ib.style || 'cinematic');

    // Doom Counter
    const dc = extensionSettings.doomCounter || {};
    $('#rpg-toggle-doom-counter').prop('checked', dc.enabled || false);
    $('#rpg-dc-badge').text(dc.enabled ? 'on' : 'off');
    $('#rpg-dc-options').toggle(dc.enabled || false);
    $('#rpg-dc-ceiling').val(dc.lowTensionCeiling || 4);
    $('#rpg-dc-ceiling-value').text(`1-${dc.lowTensionCeiling || 4}`);
    $('#rpg-dc-threshold').attr('min', dc.debugDisplay ? 0 : 3).val(dc.lowTensionThreshold || 5);
    $('#rpg-dc-threshold-value').text(dc.lowTensionThreshold || 5);
    $('#rpg-dc-streak-max').text(dc.lowTensionThreshold || 5);
    $('#rpg-dc-countdown').val(dc.countdownLength || 3);
    $('#rpg-dc-countdown-value').text(dc.countdownLength || 3);
    $('#rpg-dc-choices').val(dc.twistChoiceCount || 3);
    $('#rpg-dc-context-messages').val(dc.twistContextMessages || 15);
    $('#rpg-dc-context-messages-value').text(dc.twistContextMessages || 15);
    $('#rpg-dc-msg-truncation').val(dc.twistMessageTruncation || 1200);
    $('#rpg-dc-msg-truncation-value').text(dc.twistMessageTruncation || 1200);
    $('#rpg-dc-injection-depth').val(dc.twistInjectionDepth || 0);
    $('#rpg-dc-injection-depth-value').text(dc.twistInjectionDepth || 0);
    $('#rpg-dc-trap-mode').prop('checked', dc.trapMode || false);
    $('#rpg-dc-debug-display').prop('checked', dc.debugDisplay || false);
    updateDoomCounterUI();
    // Initialize Doom Counter toast button listener
    initDoomCounterListener();

    // Name Ban
    const nb = extensionSettings.nameBan || {};
    $('#rpg-toggle-name-ban').prop('checked', nb.enabled || false);
    $('#rpg-nb-badge').text(nb.enabled ? 'on' : 'off');
    $('#rpg-nb-options').toggle(nb.enabled || false);
    $('#rpg-nb-sensitivity').val(nb.sensitivity || 'normal');
    $('#rpg-nb-show-modal').prop('checked', nb.showModalForNew !== false);
    $('#rpg-nb-auto-apply').prop('checked', nb.autoApplyKnownMappings !== false);
    $('#rpg-nb-inject-prompt').prop('checked', nb.injectIntoPrompt !== false);
    $('#rpg-nb-excluded-words').val((nb.customExcludedWords || []).join('\n'));
    renderApprovedNamesTags($('#rpg-nb-approved-tags'));
    renderIgnoredNamesTags($('#rpg-nb-ignored-tags'));
    renderMappingsTable($('#rpg-nb-mappings-container'));

    // ── Doom Button (FAB) ──
    if (!extensionSettings.fab || typeof extensionSettings.fab !== 'object') {
        extensionSettings.fab = { bypassFlyout: false, hiddenButtons: [] };
    }
    $('#rpg-toggle-fab-bypass').prop('checked', !!extensionSettings.fab.bypassFlyout);
    $('#rpg-toggle-fab-bypass').off('change.fab').on('change.fab', function() {
        extensionSettings.fab.bypassFlyout = $(this).prop('checked');
        saveSettings();
    });
    const applyHideStTopBar = () => {
        document.body.classList.toggle('dooms-hide-st-topbar', !!extensionSettings.fab.hideStTopBar);
    };
    $('#rpg-toggle-hide-st-topbar').prop('checked', !!extensionSettings.fab.hideStTopBar);
    $('#rpg-toggle-hide-st-topbar').off('change.fab').on('change.fab', function() {
        extensionSettings.fab.hideStTopBar = $(this).prop('checked');
        applyHideStTopBar();
        saveSettings();
    });
    applyHideStTopBar();
    // Per-button toggles populate dynamically (top bar may not exist yet
    // on first call). Re-populate on every settings open so the list is fresh.
    if (typeof window.__doomsFabPopulateToggles === 'function') {
        window.__doomsFabPopulateToggles();
    }
    $(document).off('change.fabToggle', '#rpg-fab-menu-toggles input[data-fab-toggle-id]');
    $(document).on('change.fabToggle', '#rpg-fab-menu-toggles input[data-fab-toggle-id]', function() {
        const id = $(this).attr('data-fab-toggle-id');
        const enabled = $(this).prop('checked');
        const hidden = new Set(extensionSettings.fab.hiddenButtons || []);
        if (enabled) hidden.delete(id); else hidden.add(id);
        extensionSettings.fab.hiddenButtons = Array.from(hidden);
        saveSettings();
    });
    $('#rpg-fab-reset-position').off('click.fab').on('click.fab', function() {
        delete extensionSettings.fabPosition;
        saveSettings();
        const fab = document.getElementById('dooms-settings-fab');
        if (fab) {
            fab.style.left = '';
            fab.style.top = '';
            fab.style.right = '';
            fab.style.bottom = '';
        }
    });

    // Chat Bubbles & Info Panel
    loadChatBubbleSettingsUI();
    applyChatBubbleSettings();
    if (extensionSettings.chatBubbleSettings?.hideStAvatar) {
        document.body.classList.add('dooms-hide-st-avatar');
    }
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
    try { initCharacterSheet(); console.log('[Dooms Tracker] initCharacterSheet() OK'); } catch(e) { console.error('[Dooms Tracker] initCharacterSheet() FAILED:', e); }
    try { initCharacterWorkshop(); console.log('[Dooms Tracker] initCharacterWorkshop() OK'); } catch(e) { console.error('[Dooms Tracker] initCharacterWorkshop() FAILED:', e); }
    try { initCharacterRoster(); console.log('[Dooms Tracker] initCharacterRoster() OK'); } catch(e) { console.error('[Dooms Tracker] initCharacterRoster() FAILED:', e); }
    try { initExpressionSync(); console.log('[Dooms Tracker] initExpressionSync() OK'); } catch(e) { console.error('[Dooms Tracker] initExpressionSync() FAILED:', e); }
    try { initWeatherEffects(); console.log('[Dooms Tracker] initWeatherEffects() OK'); } catch(e) { console.error('[Dooms Tracker] initWeatherEffects() FAILED:', e); }
    // Add settings button as a fixed-position element on <body> so it's
    // always accessible even when the portrait bar is hidden
    if ($('#dooms-settings-fab').length === 0) {
        // Initialize FAB-specific settings shape
        if (!extensionSettings.fab || typeof extensionSettings.fab !== 'object') {
            extensionSettings.fab = { bypassFlyout: false, hiddenButtons: [] };
        }
        if (!Array.isArray(extensionSettings.fab.hiddenButtons)) {
            extensionSettings.fab.hiddenButtons = [];
        }
        if (typeof extensionSettings.fab.bypassFlyout !== 'boolean') {
            extensionSettings.fab.bypassFlyout = false;
        }
        const fabHtml = `
            <div id="dooms-settings-fab" class="dooms-settings-fab" title="Doom's Tracker Settings (right-click to move)">
                <button id="dooms-fab-settings" class="dooms-fab-btn" title="Settings">
                    <span class="doom-icon"></span>
                </button>
            </div>
        `;
        $('body').append(fabHtml);
        const fabEl = document.getElementById('dooms-settings-fab');
        let suppressClick = false;
        const openSettingsDirect = () => {
            const modal = getSettingsModal();
            if (modal) { modal.open(); } else { $('#rpg-settings-popup').show(); }
        };
        const clampPosition = (left, top) => {
            const w = fabEl.offsetWidth || 56;
            const h = fabEl.offsetHeight || 56;
            return {
                left: Math.max(0, Math.min(window.innerWidth - w, left)),
                top: Math.max(0, Math.min(window.innerHeight - h, top)),
            };
        };
        const applySavedPosition = () => {
            const pos = extensionSettings.fabPosition;
            if (pos && typeof pos.left === 'number' && typeof pos.top === 'number') {
                const c = clampPosition(pos.left, pos.top);
                fabEl.style.left = c.left + 'px';
                fabEl.style.top = c.top + 'px';
                fabEl.style.right = 'auto';
                fabEl.style.bottom = 'auto';
            }
        };
        applySavedPosition();
        // Re-clamp if the viewport shrinks below the saved position
        window.addEventListener('resize', applySavedPosition);
        // Fly-out menu: DES Settings + each button from SillyTavern's top bar.
        // Built dynamically so the menu always reflects whatever the host UI shows.
        const $menuList = $('<ul class="dooms-fab-menu" role="menu"></ul>');
        $(fabEl).append($menuList);
        // Returns every possible flyout entry (without filtering). Used for
        // both the live menu and the settings panel toggle list.
        const buildAllMenuItems = () => {
            const items = [{
                id: 'des-settings',
                label: "Doom's Settings",
                iconClass: 'fa-solid fa-gear',
                action: openSettingsDirect,
            }];
            $('#top-settings-holder .drawer-icon').each(function() {
                const $icon = $(this);
                const label = ($icon.attr('title') || $icon.attr('aria-label') || 'Untitled').trim();
                const rawClass = ($icon.attr('class') || '');
                const iconClass = rawClass.split(/\s+/)
                    .filter(c => c.startsWith('fa-'))
                    .join(' ') || 'fa-solid fa-square';
                items.push({
                    id: $icon.attr('id') || label.toLowerCase().replace(/\s+/g, '-'),
                    label,
                    iconClass,
                    action: () => { $icon.trigger('click'); },
                });
            });
            return items;
        };
        const buildMenuItems = () => {
            const hidden = new Set(extensionSettings.fab.hiddenButtons || []);
            return buildAllMenuItems().filter(i => !hidden.has(i.id));
        };
        // Settings panel: list every entry as an enable/disable row
        const populateFabSettingsToggles = () => {
            const $container = $('#rpg-fab-menu-toggles');
            if (!$container.length) return;
            const items = buildAllMenuItems();
            $container.empty();
            for (const item of items) {
                const hidden = (extensionSettings.fab.hiddenButtons || []).includes(item.id);
                const $row = $('<div class="rpg-setting-row"></div>');
                const $label = $('<div class="rpg-setting-label-group"></div>')
                    .append($('<span class="rpg-setting-label"></span>')
                        .append($('<i></i>').attr('class', item.iconClass).css({ marginRight: '8px', opacity: 0.85 }))
                        .append(document.createTextNode(item.label)));
                const $toggle = $('<label class="rpg-toggle-switch"></label>')
                    .append($('<input type="checkbox">').prop('checked', !hidden).attr('data-fab-toggle-id', item.id))
                    .append($('<span class="rpg-toggle-slider"></span>'));
                $row.append($label).append($toggle);
                $container.append($row);
            }
        };
        // Expose for the settings UI binder below
        window.__doomsFabPopulateToggles = populateFabSettingsToggles;
        const renderMenuItems = () => {
            $menuList.empty();
            for (const item of buildMenuItems()) {
                const $li = $('<li></li>');
                const $btn = $('<button type="button" class="dooms-fab-menu-item"></button>')
                    .attr('data-action', item.id)
                    .append($('<i></i>').attr('class', item.iconClass))
                    .append($('<span></span>').text(item.label));
                $btn.on('click', function(ev) {
                    ev.stopPropagation();
                    closeFlyout();
                    if (typeof item.action === 'function') item.action();
                });
                $li.append($btn);
                $menuList.append($li);
            }
        };
        const closeFlyout = () => {
            $menuList.removeClass('open');
            fabEl.classList.remove('dooms-fab-open');
            $(document).off('mousedown.fabflyout keydown.fabflyout');
        };
        const openFlyout = () => {
            renderMenuItems();
            // Choose direction (up vs down) based on space available
            const rect = fabEl.getBoundingClientRect();
            const spaceAbove = rect.top;
            const spaceBelow = window.innerHeight - rect.bottom;
            const $items = $menuList.children('li');
            const total = $items.length;
            // Estimate: ~36px per item + 8px margin
            const estimated = total * 44 + 20;
            const direction = (spaceAbove < estimated && spaceBelow > spaceAbove) ? 'down' : 'up';
            $menuList.attr('data-direction', direction);
            // Stagger: item nearest the button animates first
            $items.each(function(idx) {
                const stagger = direction === 'up' ? (total - 1 - idx) : idx;
                this.style.transitionDelay = (stagger * 0.04) + 's';
            });
            $menuList.addClass('open');
            fabEl.classList.add('dooms-fab-open');
            setTimeout(() => {
                $(document).on('mousedown.fabflyout', function(ev) {
                    if (!$(ev.target).closest('#dooms-settings-fab').length) closeFlyout();
                });
                $(document).on('keydown.fabflyout', function(ev) {
                    if (ev.key === 'Escape') closeFlyout();
                });
            }, 0);
        };
        $('#dooms-fab-settings').on('click', function(e) {
            if (suppressClick) {
                suppressClick = false;
                e.preventDefault();
                e.stopPropagation();
                return;
            }
            e.preventDefault();
            e.stopPropagation();
            if (extensionSettings.fab.bypassFlyout) {
                if ($menuList.hasClass('open')) closeFlyout();
                openSettingsDirect();
                return;
            }
            if ($menuList.hasClass('open')) closeFlyout();
            else openFlyout();
        });
        // Right-click context menu: Move / Reset
        const closeContextMenu = () => {
            $('.dooms-fab-context-menu').remove();
            $(document).off('mousedown.fabctx keydown.fabctx');
        };
        const showContextMenu = (x, y) => {
            closeContextMenu();
            const hasCustom = !!extensionSettings.fabPosition;
            const $menu = $(`
                <div class="dooms-fab-context-menu" role="menu">
                    <button type="button" class="dooms-fab-context-item" data-action="move">
                        <i class="fa-solid fa-arrows-up-down-left-right"></i><span>Move button</span>
                    </button>
                    ${hasCustom ? `
                    <button type="button" class="dooms-fab-context-item" data-action="reset">
                        <i class="fa-solid fa-rotate-left"></i><span>Reset to bottom-left</span>
                    </button>` : ''}
                </div>
            `);
            $('body').append($menu);
            const m = $menu[0];
            m.style.left = x + 'px';
            m.style.top = y + 'px';
            const rect = m.getBoundingClientRect();
            if (rect.right > window.innerWidth) m.style.left = Math.max(0, window.innerWidth - rect.width - 8) + 'px';
            if (rect.bottom > window.innerHeight) m.style.top = Math.max(0, window.innerHeight - rect.height - 8) + 'px';
            $menu.on('click', '.dooms-fab-context-item', function(ev) {
                ev.stopPropagation();
                const action = $(this).data('action');
                closeContextMenu();
                if (action === 'move') startMoveMode();
                else if (action === 'reset') resetPosition();
            });
            // Defer outside-click binding so the opening contextmenu event doesn't immediately dismiss it
            setTimeout(() => {
                $(document).on('mousedown.fabctx', function(ev) {
                    if (!$(ev.target).closest('.dooms-fab-context-menu').length) closeContextMenu();
                });
                $(document).on('keydown.fabctx', function(ev) {
                    if (ev.key === 'Escape') closeContextMenu();
                });
            }, 0);
        };
        $('#dooms-settings-fab').on('contextmenu', function(e) {
            e.preventDefault();
            e.stopPropagation();
            showContextMenu(e.clientX, e.clientY);
        });
        const resetPosition = () => {
            delete extensionSettings.fabPosition;
            saveSettings();
            fabEl.style.left = '';
            fabEl.style.top = '';
            fabEl.style.right = '';
            fabEl.style.bottom = '';
        };
        // Move mode: arm one drag session, persist position on release.
        const startMoveMode = () => {
            fabEl.classList.add('dooms-fab-moving');
            let dragging = false, moved = false;
            let startX = 0, startY = 0, startLeft = 0, startTop = 0, activePointerId = null;
            const onPointerDown = (ev) => {
                if (ev.button !== 0 && ev.pointerType === 'mouse') return;
                ev.preventDefault();
                ev.stopPropagation();
                dragging = true;
                moved = false;
                activePointerId = ev.pointerId;
                try { fabEl.setPointerCapture(ev.pointerId); } catch (_) {}
                const rect = fabEl.getBoundingClientRect();
                startX = ev.clientX;
                startY = ev.clientY;
                startLeft = rect.left;
                startTop = rect.top;
                fabEl.style.left = startLeft + 'px';
                fabEl.style.top = startTop + 'px';
                fabEl.style.right = 'auto';
                fabEl.style.bottom = 'auto';
                fabEl.classList.add('dooms-fab-dragging');
                fabEl.addEventListener('pointermove', onPointerMove);
                fabEl.addEventListener('pointerup', onPointerUp);
                fabEl.addEventListener('pointercancel', onPointerUp);
            };
            const onPointerMove = (ev) => {
                if (!dragging || ev.pointerId !== activePointerId) return;
                const dx = ev.clientX - startX;
                const dy = ev.clientY - startY;
                if (Math.abs(dx) > 2 || Math.abs(dy) > 2) moved = true;
                const c = clampPosition(startLeft + dx, startTop + dy);
                fabEl.style.left = c.left + 'px';
                fabEl.style.top = c.top + 'px';
            };
            const onPointerUp = (ev) => {
                if (!dragging || ev.pointerId !== activePointerId) return;
                dragging = false;
                try { fabEl.releasePointerCapture(ev.pointerId); } catch (_) {}
                fabEl.removeEventListener('pointermove', onPointerMove);
                fabEl.removeEventListener('pointerup', onPointerUp);
                fabEl.removeEventListener('pointercancel', onPointerUp);
                fabEl.removeEventListener('pointerdown', onPointerDown);
                document.removeEventListener('keydown', onEsc);
                fabEl.classList.remove('dooms-fab-moving');
                fabEl.classList.remove('dooms-fab-dragging');
                if (moved) {
                    const left = parseFloat(fabEl.style.left) || 0;
                    const top = parseFloat(fabEl.style.top) || 0;
                    extensionSettings.fabPosition = { left, top };
                    saveSettings();
                }
                // Suppress the click that follows pointerup so move-mode
                // never accidentally opens the flyout.
                suppressClick = true;
            };
            const onEsc = (ev) => {
                if (ev.key !== 'Escape') return;
                fabEl.removeEventListener('pointerdown', onPointerDown);
                document.removeEventListener('keydown', onEsc);
                fabEl.classList.remove('dooms-fab-moving');
            };
            fabEl.addEventListener('pointerdown', onPointerDown);
            document.addEventListener('keydown', onEsc);
        };
        // Now that the FAB is built and __doomsFabPopulateToggles exists,
        // populate the settings panel's per-button toggle list. The settings
        // init code earlier in initUI() ran before this, so the placeholder
        // is still showing — refresh it.
        populateFabSettingsToggles();
        // applyTheme() ran before the FAB existed, so stamp the theme now.
        try { applyTheme(); } catch (_) {}
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
        // Mobile keyboard resize fix — when the on-screen keyboard opens/closes
        // the viewport height changes and CSS transitions try to smoothly animate
        // viewport-relative properties, causing a slow "rubber-band" effect.
        // We kill ALL transitions during the resize and hold the kill long enough
        // for the keyboard animation + browser reflow to fully complete.
        try {
            let vkTimer;
            let vkActive = false;
            const killTransitions = () => {
                // Apply the class synchronously on the FIRST fire so transitions
                // are killed before the browser can start a transitioning layout.
                // Subsequent fires during the same keyboard animation are no-ops
                // (classList.add is idempotent and vkActive skips the timer reset).
                if (!vkActive) {
                    vkActive = true;
                    document.body.classList.add('dooms-vk-resizing');
                }
                clearTimeout(vkTimer);
                // 600ms covers the keyboard animation (~300-400ms) plus one
                // full reflow cycle.  We only re-enable after a full rAF so the
                // browser has actually painted the new layout before transitions
                // can kick in again.
                vkTimer = setTimeout(() => {
                    requestAnimationFrame(() => {
                        vkActive = false;
                        document.body.classList.remove('dooms-vk-resizing');
                    });
                }, 600);
            };
            // visualViewport fires during the keyboard animation itself
            if (window.visualViewport) {
                window.visualViewport.addEventListener('resize', killTransitions);
            }
            // window resize fires as a fallback / when visualViewport isn't available
            window.addEventListener('resize', killTransitions);

            // ── Force textarea into view on keyboard open ──
            // On mobile, the #chat flex child (100s of messages) can take seconds
            // to reflow when #sheld shrinks.  Belt-and-suspenders: after the
            // keyboard animation settles, explicitly scroll the focused textarea
            // into view so users can type immediately.
            const $textarea = document.getElementById('send_textarea');
            if ($textarea && window.innerWidth <= 1000) {
                $textarea.addEventListener('focus', () => {
                    setTimeout(() => {
                        $textarea.scrollIntoView({ behavior: 'instant', block: 'end' });
                    }, 350);
                });
            }
        } catch (error) {
            console.error('[Dooms Tracker] Viewport resize listener failed:', error);
        }
        // Mobile keyboard dismissal — prevent virtual keyboard from appearing
        // when tapping buttons, tabs, or other non-input elements while an
        // input/contenteditable is focused. Blurs the active editable element
        // so the keyboard is dismissed on any non-input tap.
        try {
            if (window.innerWidth <= 1000) {
                document.addEventListener('touchend', function(e) {
                    const target = e.target;
                    // Don't blur if the user tapped an editable element (they want to type)
                    if (target.isContentEditable ||
                        target.tagName === 'INPUT' ||
                        target.tagName === 'TEXTAREA' ||
                        target.tagName === 'SELECT') {
                        return;
                    }
                    // If something editable is currently focused, blur it to dismiss keyboard
                    const active = document.activeElement;
                    if (active && (
                        active.isContentEditable ||
                        active.tagName === 'INPUT' ||
                        active.tagName === 'TEXTAREA'
                    )) {
                        active.blur();
                    }
                });
            }
        } catch (error) {
            console.error('[Dooms Tracker] Mobile keyboard dismissal setup failed:', error);
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
        // IMPORTANT: This must happen BEFORE await introPromise so we don't miss
        // the CHAT_CHANGED event that ST fires while the loading intro is playing.
        try {
            registerAllEvents({
                [event_types.MESSAGE_SENT]: onMessageSent,
                [event_types.GENERATION_STARTED]: onGenerationStarted,
                [event_types.MESSAGE_RECEIVED]: onMessageReceived,
                [event_types.GENERATION_STOPPED]: onGenerationEnded,
                [event_types.GENERATION_ENDED]: onGenerationEnded,
                [event_types.CHAT_CHANGED]: [onCharacterChanged, updatePersonaAvatar, clearSessionAvatarPrompts, clearPortraitCache, clearExpressionSyncCache, clearStatsCache],
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
                //
                // Chunked into batches via requestAnimationFrame to avoid blocking
                // the main thread on large chats (perf fix).
                const CHUNK_SIZE = 50;
                let cursor = 0;
                const affectedIds = [];

                function processChunk() {
                    const end = Math.min(cursor + CHUNK_SIZE, chat.length);
                    for (let i = cursor; i < end; i++) {
                        const msg = chat[i];
                        if (!msg || msg.is_user || !msg.extra) continue;
                        if (msg.extra.display_text !== undefined) {
                            delete msg.extra.display_text;
                            if (msg.mes && /<font\s/i.test(msg.mes)) {
                                affectedIds.push(i);
                            }
                        }
                    }
                    cursor = end;
                    if (cursor < chat.length) {
                        requestAnimationFrame(processChunk);
                    } else {
                        // All messages scanned — re-render affected ones in chunks too
                        if (affectedIds.length > 0) {
                            console.log(`[Dooms Tracker] Re-rendering ${affectedIds.length} messages to restore dialogue colours`);
                            let renderCursor = 0;
                            function renderChunk() {
                                const renderEnd = Math.min(renderCursor + CHUNK_SIZE, affectedIds.length);
                                for (let j = renderCursor; j < renderEnd; j++) {
                                    const id = affectedIds[j];
                                    const msg = chat[id];
                                    const mesEl = document.querySelector(`#chat .mes[mesid="${id}"] .mes_text`);
                                    if (mesEl && msg) {
                                        mesEl.innerHTML = messageFormatting(
                                            msg.mes, msg.name, msg.is_system, msg.is_user, id, {}, false
                                        );
                                    }
                                }
                                renderCursor = renderEnd;
                                if (renderCursor < affectedIds.length) {
                                    requestAnimationFrame(renderChunk);
                                }
                            }
                            requestAnimationFrame(renderChunk);
                        }
                    }
                }
                if (chat.length > 0) {
                    requestAnimationFrame(processChunk);
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
            // ── Chat Bubbles: revert last message before Continue ──
            // When the user hits "Continue", SillyTavern reads/modifies .mes_text
            // to stream new content. If bubbles are active, .mes_text contains
            // bubble-wrapped HTML with <font> tags already stripped by
            // stripFontColors(). Reverting to the stored original (which still
            // has <font> tags) ensures SillyTavern sees clean HTML.
            // IMPORTANT: Only revert for 'continue' — normal generations create a
            // NEW message element and never touch the old one, so reverting would
            // leave the previous message without bubbles.
            eventSource.on(event_types.GENERATION_STARTED, (type) => {
                if (type !== 'continue') return;
                if (!extensionSettings.enabled) return;
                if (!extensionSettings.chatBubbleMode || extensionSettings.chatBubbleMode === 'off') return;
                revertLastMessageBubbles();
            });

            // ── Chat Bubbles: apply per-character bubbles to messages ──
            eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, (messageId) => {
                if (!extensionSettings.enabled) return;
                const messageElement = document.querySelector(`#chat .mes[mesid="${messageId}"]`);

                // Inject reasoning TTS button into the thinking panel
                if (messageElement) {
                    injectReasoningTtsButtons(messageElement);
                }

                // Apply chat bubbles if active
                if (extensionSettings.chatBubbleMode && extensionSettings.chatBubbleMode !== 'off') {
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
                // Show trap mode notification on the message that received the silent twist
                if (isTrapTwistPending() && messageElement) {
                    clearTrapTwistFlag();
                    const $mes = $(messageElement);
                    if (!$mes.find('.dooms-dc-trap-badge').length) {
                        $mes.find('.mes_block').append(`
                            <div class="dooms-dc-trap-badge" title="A hidden plot twist was woven into this response by the Doom Counter's Trap Mode">
                                <i class="fa-solid fa-skull"></i> Trap triggered
                            </div>
                        `);
                    }
                }
                const renderedMessage = chat[messageId];
                if (renderedMessage && !renderedMessage.is_user && !renderedMessage.is_system) {
                    queueExpressionCaptureForSpeaker(renderedMessage.name);
                    // Add fullsheet import button if message contains fullsheet data and character sheet integration is on
                    if (extensionSettings.bunnyMoIntegration && messageHasFullSheet(renderedMessage.mes) && messageElement) {
                        const $extraBtns = $(messageElement).find('.mes_buttons .extraMesButtons');
                        if ($extraBtns.length && !$extraBtns.find('.dooms-import-fullsheet-btn').length) {
                            $extraBtns.prepend(`<div class="dooms-import-fullsheet-btn mes_button fa-solid fa-scroll" title="Import Character Sheet"></div>`);
                        }
                    }
                }
            });
            // ── Fullsheet import button click handler ──
            $(document).on('click', '.dooms-import-fullsheet-btn', function (e) {
                e.stopPropagation();
                const messageId = $(this).closest('.mes').attr('mesid');
                if (messageId !== undefined) {
                    importFullSheetFromMessage(parseInt(messageId));
                }
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
                // Inject reasoning TTS buttons into all messages (deferred to idle)
                (window.requestIdleCallback || requestAnimationFrame)(() => injectReasoningTtsButtons());
                // Re-attach expression sync / native expression visibility after chat DOM rebuilds.
                setTimeout(() => onExpressionSyncChatChanged(), 0);
                // Inject fullsheet import buttons on existing messages
                setTimeout(() => injectFullSheetButtons(), 200);
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
                const updatedMessage = chat[messageId];
                if (updatedMessage && !updatedMessage.is_user && !updatedMessage.is_system) {
                    queueExpressionCaptureForSpeaker(updatedMessage.name);
                }
            });
            // MESSAGE_DELETED does not fire the same render/update hooks as swipes or edits.
            // Reset Doom's transient expression-sync state so the observer doesn't keep
            // attributing later ST expression changes to the speaker of the deleted message.
            eventSource.on(event_types.MESSAGE_DELETED, () => {
                if (!extensionSettings.enabled) return;
                clearExpressionSyncCache();
                setTimeout(() => onExpressionSyncChatChanged(), 0);
            });
            // MESSAGE_SWIPED fires when the user navigates between swipe variants.
            // SillyTavern replaces .mes_text with the new swipe content, destroying
            // any bubble DOM we previously rendered.  CHARACTER_MESSAGE_RENDERED does
            // NOT fire for existing swipes, so we must re-apply bubbles here.
            // We wait 800ms because colored-dialogues recolors on swipe with a 600ms
            // debounce, and we need the <font color> tags in place before parsing.
            eventSource.on(event_types.MESSAGE_SWIPED, (messageIndex) => {
                const swipedMessage = chat[messageIndex];
                if (swipedMessage && !swipedMessage.is_user && !swipedMessage.is_system) {
                    queueExpressionCaptureForSpeaker(swipedMessage.name);
                }
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
                // Delay to let colored-dialogues finish recoloring (600ms debounce + processing).
                // Re-query the DOM element inside setTimeout because a failed swipe causes ST
                // to "swipe back" and re-render the message, replacing the DOM node entirely.
                // Using the stale reference captured above would apply bubbles to a detached node.
                setTimeout(() => {
                    const freshEl = document.querySelector(`#chat .mes[mesid="${messageIndex}"]`);
                    if (freshEl) applyChatBubbles(freshEl, extensionSettings.chatBubbleMode);
                }, 800);
            });
            // GENERATION_STOPPED safety net — when a generation is aborted (e.g. failed
            // swipe), ST may re-render the last message without firing MESSAGE_SWIPED or
            // CHARACTER_MESSAGE_RENDERED. Re-apply bubbles to the last message if missing.
            eventSource.on(event_types.GENERATION_STOPPED, () => {
                if (!extensionSettings.enabled) return;
                if (!extensionSettings.chatBubbleMode || extensionSettings.chatBubbleMode === 'off') return;
                setTimeout(() => {
                    const lastMes = document.querySelector('#chat .mes:last-child');
                    if (!lastMes) return;
                    const mesText = lastMes.querySelector('.mes_text');
                    if (mesText && !mesText.getAttribute('data-dooms-bubbles-applied')) {
                        applyChatBubbles(lastMes, extensionSettings.chatBubbleMode);
                    }
                }, 1200);
            });
        } catch (error) {
            console.error('[Dooms Tracker] Event registration failed:', error);
            throw error; // This is critical - can't continue without events
        }
        // If CHAT_CHANGED already fired while we were initializing (e.g. while the
        // loading intro was playing), our handlers weren't registered in time and the
        // initial render never happened. Trigger it now as a safety net.
        if (chat && chat.length > 0) {
            onCharacterChanged();
        }
        console.log('[Dooms Tracker] ✅ Extension loaded successfully.');
        // Wait for the intro animation to finish (if it's still playing).
        // Everything is fully initialized at this point — we're just waiting for
        // the visual overlay to fade out before revealing the loaded UI.
        try {
            await introPromise;
        } catch (error) {
            console.error('[Dooms Tracker] Loading intro failed:', error);
        }
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
