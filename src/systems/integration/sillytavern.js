/**
 * SillyTavern Integration Module
 * Handles all event listeners and integration with SillyTavern's event system
 */
import { getContext } from '../../../../../../extensions.js';
import { chat, user_avatar, setExtensionPrompt, extension_prompt_types, saveChatDebounced } from '../../../../../../../script.js';
// Core modules
import {
    extensionSettings,
    lastGeneratedData,
    committedTrackerData,
    lastActionWasSwipe,
    isAwaitingNewMessage,
    setLastActionWasSwipe,
    setIsGenerating,
    setIsAwaitingNewMessage,
    updateLastGeneratedData,
    updateCommittedTrackerData
} from '../../core/state.js';
import { saveChatData, loadChatData, autoSwitchPresetForEntity } from '../../core/persistence.js';
import { i18n } from '../../core/i18n.js';
// Generation & Parsing
import { parseResponse, parseQuests } from '../generation/parser.js';
import { updateRPGData } from '../generation/apiClient.js';
import { removeLocks } from '../generation/lockManager.js';
import { onGenerationStarted, initHistoryInjectionListeners, clearBoostForAppearedFields } from '../generation/injector.js';
// Rendering
import { renderInfoBox } from '../rendering/infoBox.js';
import { renderThoughts, updateChatThoughts } from '../rendering/thoughts.js';
import { renderQuests } from '../rendering/quests.js';
import { updateChatSceneHeaders, resetSceneHeaderCache } from '../rendering/sceneHeaders.js';
import { updatePortraitBar } from '../ui/portraitBar.js';
// Utils
import { getSafeThumbnailUrl } from '../../utils/avatars.js';
/**
 * Commits the tracker data from the last assistant message to be used as source for next generation.
 * This should be called when the user has replied to a message, ensuring all swipes of the next
 * response use the same committed context.
 */
export function commitTrackerData() {
    const chat = getContext().chat;
    if (!chat || chat.length === 0) {
        return;
    }
    // Find the last assistant message
    for (let i = chat.length - 1; i >= 0; i--) {
        const message = chat[i];
        if (!message.is_user) {
            // Found last assistant message - commit its tracker data
            if (message.extra && message.extra.dooms_tracker_swipes) {
                const swipeId = message.swipe_id || 0;
                const swipeData = message.extra.dooms_tracker_swipes[swipeId];
                if (swipeData) {
                    committedTrackerData.quests = swipeData.quests || null;
                    committedTrackerData.infoBox = swipeData.infoBox || null;
                    committedTrackerData.characterThoughts = swipeData.characterThoughts || null;
                } else {
                }
            } else {
            }
            break;
        }
    }
}
/**
 * Event handler for when the user sends a message.
 * Sets the flag to indicate this is NOT a swipe.
 * In together mode, commits displayed data (only for real messages, not streaming placeholders).
 */
export function onMessageSent() {
    if (!extensionSettings.enabled) return;
    // Check if this is a streaming placeholder message (content = "...")
    // When streaming is on, ST sends a "..." placeholder before generation starts
    const context = getContext();
    const chat = context.chat;
    const lastMessage = chat && chat.length > 0 ? chat[chat.length - 1] : null;
    if (lastMessage && lastMessage.mes === '...') {
        return;
    }
    // Set flag to indicate we're expecting a new message from generation
    // This allows auto-update to distinguish between new generations and loading chat history
    setIsAwaitingNewMessage(true);
    // Note: FAB spinning is NOT shown for together mode since no extra API request is made
    // The RPG data comes embedded in the main response
    // FAB spinning is handled by apiClient.js for separate/external modes when updateRPGData() is called
    // For separate mode with auto-update disabled, commit displayed tracker
    if (extensionSettings.generationMode === 'separate' && !extensionSettings.autoUpdate) {
        if (lastGeneratedData.quests || lastGeneratedData.infoBox || lastGeneratedData.characterThoughts) {
            committedTrackerData.quests = lastGeneratedData.quests;
            committedTrackerData.infoBox = lastGeneratedData.infoBox;
            committedTrackerData.characterThoughts = lastGeneratedData.characterThoughts;
        }
    }
}
/**
 * Event handler for when a message is generated.
 */
export async function onMessageReceived(data) {
    if (!extensionSettings.enabled) {
        return;
    }
    // Reset swipe flag after generation completes
    // This ensures next user message (whether from original or swipe) triggers commit
    setLastActionWasSwipe(false);
    if (extensionSettings.generationMode === 'together') {
        // In together mode, parse the response to extract RPG data
        // Commit happens in onMessageSent (when user sends message, before generation)
        const lastMessage = chat[chat.length - 1];
        if (lastMessage && !lastMessage.is_user) {
            const responseText = lastMessage.mes;
            const parsedData = parseResponse(responseText);
            // Note: Don't show parsing error here - this event fires when loading chat history too
            // Error notification is handled in apiClient.js for fresh generations only
            // Remove locks from parsed data (JSON format only, text format is unaffected)
            if (parsedData.quests) {
                parsedData.quests = removeLocks(parsedData.quests);
            }
            if (parsedData.infoBox) {
                parsedData.infoBox = removeLocks(parsedData.infoBox);
            }
            if (parsedData.characterThoughts) {
                parsedData.characterThoughts = removeLocks(parsedData.characterThoughts);
            }
            // Update display data with newly parsed response
            if (parsedData.quests) {
                lastGeneratedData.quests = parsedData.quests;
                parseQuests(parsedData.quests);
            }
            if (parsedData.infoBox) {
                lastGeneratedData.infoBox = parsedData.infoBox;
            }
            if (parsedData.characterThoughts) {
                lastGeneratedData.characterThoughts = parsedData.characterThoughts;
            }
            // Store RPG data for this specific swipe in the message's extra field
            if (!lastMessage.extra) {
                lastMessage.extra = {};
            }
            if (!lastMessage.extra.dooms_tracker_swipes) {
                lastMessage.extra.dooms_tracker_swipes = {};
            }
            const currentSwipeId = lastMessage.swipe_id || 0;
            lastMessage.extra.dooms_tracker_swipes[currentSwipeId] = {
                quests: parsedData.quests,
                infoBox: parsedData.infoBox,
                characterThoughts: parsedData.characterThoughts
            };
            // Note: JSON code blocks are hidden from the display by our registered regex script
            // (ensureJsonCleaningRegex). Legacy text format blocks (```Stats---```) are also
            // handled by the same script. We intentionally do NOT modify lastMessage.mes here —
            // doing so would cause SillyTavern's Expression Classifier to fire an extra classify
            // call on the raw JSON-laden text before the regex script has a chance to clean it.
            // Clear boost counters for any fields that now appear in the AI output
            if (parsedData.infoBox) clearBoostForAppearedFields();
            // Render only the sections that had new data parsed
            if (parsedData.infoBox) renderInfoBox();
            if (parsedData.characterThoughts) renderThoughts();
            if (parsedData.quests) renderQuests();
            // Scene headers & portrait bar depend on any of the above
            const hadAnyData = parsedData.infoBox || parsedData.characterThoughts || parsedData.quests;
            if (hadAnyData) {
                updateChatSceneHeaders();
                updatePortraitBar();
            }
            // Insert inline thought dropdowns into the chat message
            // (CHARACTER_MESSAGE_RENDERED fires after addOneMessage, so thoughts go in then)
            if (parsedData.characterThoughts) {
                setTimeout(() => updateChatThoughts(), 100);
            }
            // Save to chat metadata
            saveChatData();
        }
    } else if (extensionSettings.generationMode === 'separate' || extensionSettings.generationMode === 'external') {
        // In separate/external mode, no additional rendering needed for the main message
        // The main roleplay message doesn't contain tracker data in these modes
        // Trigger auto-update if enabled (for both separate and external modes)
        // Only trigger if this is a newly generated message, not loading chat history
        if (extensionSettings.autoUpdate && isAwaitingNewMessage) {
            setTimeout(async () => {
                await updateRPGData(renderInfoBox, renderThoughts);
                updateChatSceneHeaders();
                updatePortraitBar();
                updateChatThoughts();
            }, 500);
        }
    }
    // Reset the awaiting flag after processing the message
    setIsAwaitingNewMessage(false);
    // Reset the swipe flag after generation completes
    // This ensures that if the user swiped → auto-reply generated → flag is now cleared
    // so the next user message will be treated as a new message (not a swipe)
    if (lastActionWasSwipe) {
        setLastActionWasSwipe(false);
    }
}
/**
 * Event handler for character change.
 */
export function onCharacterChanged() {
    // Remove thought panel and icon when changing characters
    $('#rpg-thought-panel').remove();
    $('#rpg-thought-icon').remove();
    $('#chat').off('scroll.thoughtPanel');
    $(window).off('resize.thoughtPanel');
    $(document).off('click.thoughtPanel');
    // Auto-switch to the preset associated with this character/group (if any)
    const presetSwitched = autoSwitchPresetForEntity();
    // if (presetSwitched) {
    // }
    // Load chat-specific data when switching chats
    resetSceneHeaderCache();
    loadChatData();
    // Don't call commitTrackerData() here - it would overwrite the loaded committedTrackerData
    // with data from the last message, which may be null/empty. The loaded committedTrackerData
    // already contains the committed state from when we last left this chat.
    // commitTrackerData() will be called naturally when new messages arrive.
    // Re-render sidebar panels immediately (they don't depend on #chat DOM)
    renderInfoBox();
    renderThoughts();
    renderQuests();
    // Scene header layouts that render into <body> or #chat directly (not into a specific
    // message element) can also render immediately — ticker, ticker-bottom, and hud don't
    // need any .mes elements to exist. This lets the scene tracker appear at the same
    // time as the portrait bar instead of 200–3000ms later.
    const immediateLayout = (extensionSettings.sceneTracker || {}).layout || 'grid';
    const isBodyLayout = immediateLayout === 'ticker' || immediateLayout === 'ticker-bottom' || immediateLayout === 'hud';
    if (isBodyLayout) {
        updateChatSceneHeaders();
    }
    updatePortraitBar();
    // Delay DOM-dependent renders — SillyTavern renders chat messages asynchronously
    // after CHAT_CHANGED fires, so #chat .mes elements may not exist yet.
    // For body-level layouts we already rendered above; still poll to catch the case
    // where chat messages appear later and need thoughts overlays injected.
    let attempts = 0;
    const maxAttempts = 15;
    const tryRenderChat = () => {
        attempts++;
        if ($('#chat .mes').length > 0) {
            // For classic layouts (grid/stacked/compact/banner) that inject after a
            // specific .mes element, render now that the DOM is ready.
            if (!isBodyLayout) {
                updateChatSceneHeaders();
            }
            updateChatThoughts();
        } else if (attempts < maxAttempts) {
            setTimeout(tryRenderChat, 200);
        }
    };
    setTimeout(tryRenderChat, 200);
}
/**
 * Event handler for when a message is swiped.
 * Loads the RPG data for the swipe the user navigated to.
 */
export function onMessageSwiped(messageIndex) {
    if (!extensionSettings.enabled) {
        return;
    }
    // Get the message that was swiped
    const message = chat[messageIndex];
    if (!message || message.is_user) {
        return;
    }
    const currentSwipeId = message.swipe_id || 0;
    // Only set flag to true if this swipe will trigger a NEW generation
    // Check if the swipe already exists (has content in the swipes array)
    const isExistingSwipe = message.swipes &&
        message.swipes[currentSwipeId] !== undefined &&
        message.swipes[currentSwipeId] !== null &&
        message.swipes[currentSwipeId].length > 0;
    if (!isExistingSwipe) {
        // This is a NEW swipe that will trigger generation
        setLastActionWasSwipe(true);
        setIsAwaitingNewMessage(true);
    } else {
        // This is navigating to an EXISTING swipe - don't change the flag
    }
    // IMPORTANT: onMessageSwiped is for DISPLAY only!
    // lastGeneratedData is for DISPLAY, committedTrackerData is for GENERATION
    // It's safe to load swipe data into lastGeneratedData - it won't be committed due to !lastActionWasSwipe check
    if (message.extra && message.extra.dooms_tracker_swipes && message.extra.dooms_tracker_swipes[currentSwipeId]) {
        const swipeData = message.extra.dooms_tracker_swipes[currentSwipeId];
        // Load swipe data into lastGeneratedData for display (both modes)
        lastGeneratedData.quests = swipeData.quests || null;
        lastGeneratedData.infoBox = swipeData.infoBox || null;
        // Normalize characterThoughts to string format (for backward compatibility with old object format)
        if (swipeData.characterThoughts && typeof swipeData.characterThoughts === 'object') {
            lastGeneratedData.characterThoughts = JSON.stringify(swipeData.characterThoughts, null, 2);
        } else {
            lastGeneratedData.characterThoughts = swipeData.characterThoughts || null;
        }
        // DON'T parse user stats when loading swipe data
        // This would overwrite manually edited fields (like Conditions) with old swipe data
        // The lastGeneratedData is loaded for display purposes only
        // parseUserStats() updates extensionSettings.userStats which should only be modified
        // by new generations or manual edits, not by swipe navigation
    } else {
    }
    // Re-render the panels
    renderInfoBox();
    renderThoughts();
    renderQuests();
    resetSceneHeaderCache();
    updateChatSceneHeaders();
    updatePortraitBar();
    // Update chat thought overlays
    updateChatThoughts();
}
/**
 * Update the persona avatar image when user switches personas
 */
export function updatePersonaAvatar() {
    const portraitImg = document.querySelector('.rpg-user-portrait');
    if (!portraitImg) {
        return;
    }
    // Get current user_avatar from context instead of using imported value
    const context = getContext();
    const currentUserAvatar = context.user_avatar || user_avatar;
    // Try to get a valid thumbnail URL using our safe helper
    if (currentUserAvatar) {
        const thumbnailUrl = getSafeThumbnailUrl('persona', currentUserAvatar);
        if (thumbnailUrl) {
            // Only update the src if we got a valid URL
            portraitImg.src = thumbnailUrl;
        } else {
            // Don't update the src if we couldn't get a valid URL
            // This prevents 400 errors and keeps the existing image
        }
    } else {
    }
}
/**
 * Clears all extension prompts.
 */
export function clearExtensionPrompts() {
    setExtensionPrompt('dooms-tracker-inject', '', extension_prompt_types.IN_CHAT, 0, false);
    setExtensionPrompt('dooms-tracker-example', '', extension_prompt_types.IN_CHAT, 0, false);
    setExtensionPrompt('dooms-tracker-html', '', extension_prompt_types.IN_CHAT, 0, false);
    setExtensionPrompt('dooms-tracker-dialogue-coloring', '', extension_prompt_types.IN_CHAT, 0, false);
    setExtensionPrompt('dooms-tracker-spotify', '', extension_prompt_types.IN_CHAT, 0, false);
    setExtensionPrompt('dooms-tracker-context', '', extension_prompt_types.IN_CHAT, 1, false);
    // Note: dooms-tracker-plot is not cleared here since it's passed via quiet_prompt option
}
/**
 * Event handler for when generation stops or ends
 */
export async function onGenerationEnded() {
    // Note: isGenerating flag is cleared in onMessageReceived after parsing (together mode)
    // or in apiClient.js after separate generation completes (separate mode)
}
/**
 * Initialize history injection event listeners.
 * Should be called once during extension initialization.
 */
export function initHistoryInjection() {
    initHistoryInjectionListeners();
}
