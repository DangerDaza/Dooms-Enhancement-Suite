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
import { onGenerationStarted, initHistoryInjectionListeners } from '../generation/injector.js';
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
 * Refreshes the tracker display from data already stored in the last AI message.
 * No API call is made — this simply reads the parsed tracker data that was
 * saved when the message was originally received and re-renders the UI.
 * Used by the Regenerate Tracker button so users don't incur extra API costs.
 */
export function refreshTrackerFromStoredData() {
    const context = getContext();
    const chatData = context.chat;
    if (!chatData || chatData.length === 0) return;

    // Find the last assistant message
    let lastAssistant = null;
    for (let i = chatData.length - 1; i >= 0; i--) {
        if (!chatData[i].is_user) {
            lastAssistant = chatData[i];
            break;
        }
    }
    if (!lastAssistant) return;

    // Read stored tracker data for the current swipe
    const swipeId = lastAssistant.swipe_id || 0;
    const swipeData = lastAssistant.extra?.dooms_tracker_swipes?.[swipeId];
    if (!swipeData) return;

    // Update display data
    if (swipeData.quests) {
        lastGeneratedData.quests = swipeData.quests;
        parseQuests(swipeData.quests);
    }
    if (swipeData.infoBox) {
        lastGeneratedData.infoBox = swipeData.infoBox;
    }
    if (swipeData.characterThoughts) {
        lastGeneratedData.characterThoughts = swipeData.characterThoughts;
    }

    // Render everything
    if (swipeData.infoBox) renderInfoBox();
    if (swipeData.characterThoughts) renderThoughts();
    if (swipeData.quests) renderQuests();

    const hadAnyData = swipeData.infoBox || swipeData.characterThoughts || swipeData.quests;
    if (hadAnyData) {
        updateChatSceneHeaders();
        updatePortraitBar();
    }
    if (swipeData.characterThoughts) {
        setTimeout(() => updateChatThoughts(), 100);
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
    if (extensionSettings.generationMode === 'separate' && extensionSettings.autoUpdateMode !== 'auto') {
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
            // Store RPG data for this specific swipe in the message's extra field
            // (always store so data isn't lost, regardless of update mode)
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
            // Remove the tracker code blocks from the visible message
            // (always clean regardless of update mode so tracker blocks don't show in chat)
            let cleanedMessage = responseText;
            // Note: JSON code blocks are hidden from display by regex script (but preserved in message data)
            // Remove old text format code blocks (legacy support)
            cleanedMessage = cleanedMessage.replace(/```[^`]*?Stats\s*\n\s*---[^`]*?```\s*/gi, '');
            cleanedMessage = cleanedMessage.replace(/```[^`]*?Info Box\s*\n\s*---[^`]*?```\s*/gi, '');
            cleanedMessage = cleanedMessage.replace(/```[^`]*?Present Characters\s*\n\s*---[^`]*?```\s*/gi, '');
            // Remove any stray "---" dividers that might appear after the code blocks
            cleanedMessage = cleanedMessage.replace(/^\s*---\s*$/gm, '');
            // Clean up multiple consecutive newlines
            cleanedMessage = cleanedMessage.replace(/\n{3,}/g, '\n\n');
            // Note: <trackers> XML tags are automatically hidden by SillyTavern
            // Note: <Song - Artist/> tags are also automatically hidden by SillyTavern
            // Update the message in chat history
            lastMessage.mes = cleanedMessage.trim();
            // Update the swipe text as well
            if (lastMessage.swipes && lastMessage.swipes[currentSwipeId] !== undefined) {
                lastMessage.swipes[currentSwipeId] = cleanedMessage.trim();
            }
            // Then update the DOM to reflect the cleaned message
            // Using updateMessageBlock to perform macro substitutions + regex formatting
            const messageId = chat.length - 1;
            updateMessageBlock(messageId, lastMessage, { rerenderMessage: true });
            // Only update tracker display when autoUpdateMode is 'auto'
            // In 'manual' or 'off' mode, data is stored but the tracker UI is not refreshed
            if (extensionSettings.autoUpdateMode === 'auto') {
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
                // (must be after updateMessageBlock so the .mes_text content is finalized)
                if (parsedData.characterThoughts) {
                    setTimeout(() => updateChatThoughts(), 100);
                }
            }
            // Save to chat metadata
            saveChatData();
        }
    } else if (extensionSettings.generationMode === 'separate' || extensionSettings.generationMode === 'external') {
        // In separate/external mode, no additional rendering needed for the main message
        // The main roleplay message doesn't contain tracker data in these modes
        // Trigger auto-update if enabled (for both separate and external modes)
        // Only trigger if this is a newly generated message, not loading chat history
        if (extensionSettings.autoUpdateMode === 'auto' && isAwaitingNewMessage) {
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
    updatePortraitBar();
    // Delay DOM-dependent renders — SillyTavern renders chat messages asynchronously
    // after CHAT_CHANGED fires, so #chat .mes elements may not exist yet.
    // Poll until messages appear in the DOM (up to 3 seconds).
    let attempts = 0;
    const maxAttempts = 15;
    const tryRenderChat = () => {
        attempts++;
        if ($('#chat .mes').length > 0) {
            updateChatSceneHeaders();
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
