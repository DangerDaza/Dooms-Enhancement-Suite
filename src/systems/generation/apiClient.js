/**
 * API Client Module
 * Handles API calls for RPG tracker generation
 */
import { chat, eventSource } from '../../../../../../../script.js';
import { executeSlashCommandsOnChatInput } from '../../../../../../../scripts/slash-commands.js';
import { getContext } from '../../../../../../extensions.js';
import { safeGenerateRaw, extractTextFromResponse } from '../../utils/responseExtractor.js';
// Custom event name for when Doom's Character Tracker finishes updating tracker data
// Other extensions can listen for this event to know when Doom's Character Tracker is done
export const DOOMS_TRACKER_UPDATE_COMPLETE = 'dooms_tracker_update_complete';
import {
    extensionSettings,
    lastGeneratedData,
    committedTrackerData,
    isGenerating,
    lastActionWasSwipe,
    setIsGenerating,
    setLastActionWasSwipe
} from '../../core/state.js';
import { saveChatData } from '../../core/persistence.js';
import {
    generateSeparateUpdatePrompt
} from './promptBuilder.js';
import { parseResponse, parseQuests } from './parser.js';
import { renderInfoBox } from '../rendering/infoBox.js';
import { removeLocks } from './lockManager.js';
import { renderThoughts, updateChatThoughts } from '../rendering/thoughts.js';
import { renderQuests } from '../rendering/quests.js';
import { i18n } from '../../core/i18n.js';
import { generateAvatarsForCharacters } from '../features/avatarGenerator.js';
// Store the original preset name to restore after tracker generation
let originalPresetName = null;
/**
 * Generates tracker data using an external OpenAI-compatible API.
 * Used when generationMode is 'external'.
 *
 * @param {Array<{role: string, content: string}>} messages - Array of message objects for the API
 * @returns {Promise<string>} The generated response content
 * @throws {Error} If the API call fails or configuration is invalid
 */
export async function generateWithExternalAPI(messages) {
    const { baseUrl, model, maxTokens, temperature } = extensionSettings.externalApiSettings || {};
    // Retrieve API key from secure storage (not shared extension settings)
    const apiKey = localStorage.getItem('dooms_tracker_external_api_key');
    // Validate required settings
    if (!baseUrl || !baseUrl.trim()) {
        throw new Error('External API base URL is not configured');
    }
    if (!model || !model.trim()) {
        throw new Error('External API model is not configured');
    }
    // Normalize base URL (remove trailing slash if present)
    const normalizedBaseUrl = baseUrl.trim().replace(/\/+$/, '');
    const endpoint = `${normalizedBaseUrl}/chat/completions`;
    // Prepare headers - only include Authorization if API key is provided
    const headers = {
        'Content-Type': 'application/json'
    };
    if (apiKey && apiKey.trim()) {
        headers['Authorization'] = `Bearer ${apiKey.trim()}`;
    }
    try {
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify({
                model: model.trim(),
                messages: messages,
                max_tokens: maxTokens || 2048,
                temperature: temperature ?? 0.7
            })
        });
        if (!response.ok) {
            const errorText = await response.text();
            let errorMessage = `External API error: ${response.status} ${response.statusText}`;
            try {
                const errorJson = JSON.parse(errorText);
                if (errorJson.error?.message) {
                    errorMessage = `External API error: ${errorJson.error.message}`;
                }
            } catch (e) {
                // If parsing fails, use the raw text if it's short enough
                if (errorText.length < 200) {
                    errorMessage = `External API error: ${errorText}`;
                }
            }
            throw new Error(errorMessage);
        }
        const data = await response.json();
        const content = extractTextFromResponse(data);
        if (!content || !content.trim()) {
            throw new Error('Invalid response format from external API — no text content found');
        }
        return content;
    } catch (error) {
        if (error.name === 'TypeError' && (error.message.includes('fetch') || error.message.includes('Failed to fetch') || error.message.includes('NetworkError'))) {
            throw new Error(`CORS Access Blocked: This API endpoint (${normalizedBaseUrl}) does not allow direct access from a browser. This is a browser security restriction (CORS), not a bug in the extension. Please use an endpoint that supports CORS (like OpenRouter or a local proxy) or use SillyTavern's internal API system (Separate Mode).`);
        }
        throw error;
    }
}
/**
 * Tests the external API connection with a simple request.
 * @returns {Promise<{success: boolean, message: string, model?: string}>}
 */
export async function testExternalAPIConnection() {
    const { baseUrl, model } = extensionSettings.externalApiSettings || {};
    const apiKey = localStorage.getItem('dooms_tracker_external_api_key');
    if (!baseUrl || !model) {
        return {
            success: false,
            message: 'Please fill in all required fields (Base URL and Model). API Key is optional for local servers.'
        };
    }
    try {
        const testMessages = [
            { role: 'user', content: 'Respond with exactly: "Connection successful"' }
        ];
        const response = await generateWithExternalAPI(testMessages);
        return {
            success: true,
            message: `Connection successful! Model: ${model}`,
            model: model
        };
    } catch (error) {
        return {
            success: false,
            message: error.message || 'Connection failed'
        };
    }
}
/**
 * Gets the current preset name using the /preset command
 * @returns {Promise<string|null>} Current preset name or null if unavailable
 */
export async function getCurrentPresetName() {
    try {
        // Use /preset without arguments to get the current preset name
        const result = await executeSlashCommandsOnChatInput('/preset', { quiet: true });
        // The result should be an object with a 'pipe' property containing the preset name
        if (result && typeof result === 'object' && result.pipe) {
            const presetName = String(result.pipe).trim();
            return presetName || null;
        }
        // Fallback if result is a string
        if (typeof result === 'string') {
            return result.trim() || null;
        }
        return null;
    } catch (error) {
        console.error('[Dooms Tracker] Error getting current preset:', error);
        return null;
    }
}
/**
 * Switches to a specific preset by name using the /preset slash command
 * @param {string} presetName - Name of the preset to switch to
 * @returns {Promise<boolean>} True if switching succeeded, false otherwise
 */
export async function switchToPreset(presetName) {
    try {
        // Use the /preset slash command to switch presets
        // This is the proper way to change presets in SillyTavern
        await executeSlashCommandsOnChatInput(`/preset ${presetName}`, { quiet: true });
        return true;
    } catch (error) {
        console.error('[Dooms Tracker] Error switching preset:', error);
        return false;
    }
}
/**
 * Gets the current connection profile name using the /profile command.
 * @returns {Promise<string|null>} Current profile name, '<None>' if no profile, or null on error
 */
export async function getCurrentProfileName() {
    try {
        const result = await executeSlashCommandsOnChatInput('/profile', { quiet: true });
        if (result && typeof result === 'object' && result.pipe) {
            return String(result.pipe).trim() || null;
        }
        if (typeof result === 'string') {
            return result.trim() || null;
        }
        return null;
    } catch (error) {
        console.error('[Dooms Tracker] Error getting current profile:', error);
        return null;
    }
}
/**
 * Switches to a specific connection profile by name using the /profile slash command.
 * @param {string} profileName - Name of the profile to switch to, or '<None>' to deselect
 * @returns {Promise<boolean>} True if switching succeeded
 */
export async function switchToProfile(profileName) {
    try {
        await executeSlashCommandsOnChatInput(
            `/profile ${profileName} --await=true --timeout=3000`,
            { quiet: true }
        );
        return true;
    } catch (error) {
        console.error('[Dooms Tracker] Error switching profile:', error);
        return false;
    }
}
/**
 * Checks if a connection profile with the given name exists in the Connection Manager.
 * @param {string} profileName - Name of the profile to check
 * @returns {boolean} True if the profile exists
 */
export function isConnectionProfileAvailable(profileName) {
    try {
        const context = getContext();
        const profiles = context.extension_settings?.connectionManager?.profiles;
        if (!Array.isArray(profiles)) return false;
        return profiles.some(p => p.name === profileName);
    } catch {
        return false;
    }
}
/**
 * Gets all available connection profile names from the Connection Manager.
 * @returns {string[]} Array of profile names, empty if Connection Manager is not available
 */
export function getAvailableConnectionProfiles() {
    try {
        const context = getContext();
        const profiles = context.extension_settings?.connectionManager?.profiles;
        if (!Array.isArray(profiles)) return [];
        return profiles.map(p => p.name).sort((a, b) => a.localeCompare(b));
    } catch {
        return [];
    }
}
/**
 * Updates RPG tracker data using separate API call (separate mode only).
 * Makes a dedicated API call to generate tracker data, then stores it
 * in the last assistant message's swipe data.
 *
 * @param {Function} renderInfoBox - UI function to render info box
 * @param {Function} renderThoughts - UI function to render character thoughts
 */
export async function updateRPGData(renderInfoBox, renderThoughts) {
    if (isGenerating) {
        return;
    }
    if (!extensionSettings.enabled) {
        return;
    }
    if (extensionSettings.generationMode !== 'separate' && extensionSettings.generationMode !== 'external') {
        return;
    }
    const isExternalMode = extensionSettings.generationMode === 'external';
    let originalProfileName = null;
    let profileSwitched = false;
    try {
        setIsGenerating(true);
        // Update button to show "Updating..." state
        const $updateBtn = $('#rpg-manual-update');
        const $stripRefreshBtn = $('#rpg-strip-refresh');
        const updatingText = i18n.getTranslation('template.mainPanel.updating') || 'Updating...';
        $updateBtn.html(`<i class="fa-solid fa-spinner fa-spin"></i> ${updatingText}`).prop('disabled', true);
        $stripRefreshBtn.html('<i class="fa-solid fa-spinner fa-spin"></i>').prop('disabled', true);
        // Switch connection profile if configured (separate mode only, not external)
        if (!isExternalMode && extensionSettings.connectionProfile) {
            if (isConnectionProfileAvailable(extensionSettings.connectionProfile)) {
                originalProfileName = await getCurrentProfileName();
                if (originalProfileName !== extensionSettings.connectionProfile) {
                    console.log(`[Dooms Tracker] Switching to connection profile: ${extensionSettings.connectionProfile}`);
                    const switched = await switchToProfile(extensionSettings.connectionProfile);
                    if (switched) {
                        profileSwitched = true;
                    } else {
                        console.warn('[Dooms Tracker] Failed to switch connection profile, continuing with current');
                    }
                }
            } else {
                console.warn(`[Dooms Tracker] Connection profile "${extensionSettings.connectionProfile}" not found, using current connection`);
            }
        }
        const prompt = await generateSeparateUpdatePrompt();
        // Generate response based on mode
        let response;
        if (isExternalMode) {
            // External mode: Use external OpenAI-compatible API directly
            response = await generateWithExternalAPI(prompt);
        } else {
            // Separate mode: Use SillyTavern's generateRaw (with extended thinking fallback)
            response = await safeGenerateRaw({
                prompt: prompt,
                quietToLoud: false
            });
        }
        if (response) {
            const parsedData = parseResponse(response);
            // Check if parsing completely failed (no tracker data found)
            if (parsedData.parsingFailed) {
                toastr.error(i18n.getTranslation('errors.parsingError'), '', { timeOut: 5000 });
            }
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
            // Store RPG data for the last assistant message (separate mode)
            const lastMessage = chat && chat.length > 0 ? chat[chat.length - 1] : null;
            // Update lastGeneratedData for display (regardless of message type)
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
            // Also store on assistant message if present (existing behavior)
            if (lastMessage && !lastMessage.is_user) {
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
            }
            // Only commit on TRULY first generation (no committed data exists at all)
            const hasAnyCommittedContent = (
                (committedTrackerData.quests && committedTrackerData.quests.trim() !== '') ||
                (committedTrackerData.infoBox && committedTrackerData.infoBox.trim() !== '' && committedTrackerData.infoBox !== 'Info Box\n---\n') ||
                (committedTrackerData.characterThoughts && committedTrackerData.characterThoughts.trim() !== '' && committedTrackerData.characterThoughts !== 'Present Characters\n---\n')
            );
            if (!hasAnyCommittedContent) {
                committedTrackerData.quests = parsedData.quests;
                committedTrackerData.infoBox = parsedData.infoBox;
                committedTrackerData.characterThoughts = parsedData.characterThoughts;
            }
            // Render the updated data
            renderInfoBox();
            renderThoughts();
            renderQuests();
            // Insert inline thought dropdowns into the chat message
            updateChatThoughts();
            // Save to chat metadata
            saveChatData();
            // Generate avatars if auto-generate is enabled (runs within this workflow)
            // This uses the Doom's Character Tracker Trackers preset and keeps the button spinning
            if (extensionSettings.autoGenerateAvatars) {
                const charactersNeedingAvatars = parseCharactersFromThoughts(parsedData.characterThoughts);
                if (charactersNeedingAvatars.length > 0) {
                    // Generate avatars - this awaits completion
                    await generateAvatarsForCharacters(charactersNeedingAvatars, (names) => {
                        // Callback when generation starts - re-render to show loading spinners
                        renderThoughts();
                    });
                    // Re-render once all avatars are generated
                    renderThoughts();
                }
            }
        }
    } catch (error) {
        console.error('[Dooms Tracker] Error updating RPG data:', error);
        if (isExternalMode) {
            toastr.error(error.message, "Doom's Character Tracker External API Error");
        }
    } finally {
        // Restore connection profile if we switched
        if (profileSwitched && originalProfileName) {
            try {
                console.log(`[Dooms Tracker] Restoring connection profile: ${originalProfileName}`);
                await switchToProfile(originalProfileName);
            } catch (restoreError) {
                console.error('[Dooms Tracker] Failed to restore connection profile:', restoreError);
                toastr.warning(
                    `Failed to restore connection profile "${originalProfileName}". Please switch back manually.`,
                    "Doom's Tracker"
                );
            }
        }
        setIsGenerating(false);
        // Restore button to original state
        const $updateBtn = $('#rpg-manual-update');
        const $stripRefreshBtn = $('#rpg-strip-refresh');
        const refreshText = i18n.getTranslation('template.mainPanel.refreshRpgInfo') || 'Refresh RPG Info';
        $updateBtn.html(`<i class="fa-solid fa-sync"></i> ${refreshText}`).prop('disabled', false);
        $stripRefreshBtn.html('<i class="fa-solid fa-sync"></i>').prop('disabled', false);
        // Reset the flag after tracker generation completes
        // This ensures the flag persists through both main generation AND tracker generation
        setLastActionWasSwipe(false);
        // Emit event for other extensions to know Doom's Character Tracker has finished updating
        console.debug('[Dooms Tracker] Emitting DOOMS_TRACKER_UPDATE_COMPLETE event');
        eventSource.emit(DOOMS_TRACKER_UPDATE_COMPLETE);
    }
}
/**
 * Parses character names from Present Characters thoughts data
 * @param {string} characterThoughtsData - Raw character thoughts data
 * @returns {Array<string>} Array of character names found
 */
function parseCharactersFromThoughts(characterThoughtsData) {
    if (!characterThoughtsData) return [];
    // Try parsing as JSON first (current format)
    try {
        const parsed = typeof characterThoughtsData === 'string'
            ? JSON.parse(characterThoughtsData)
            : characterThoughtsData;
        // Handle both {characters: [...]} and direct array formats
        const charactersArray = Array.isArray(parsed) ? parsed : (parsed.characters || []);
        if (charactersArray.length > 0) {
            // Extract names from JSON character objects
            return charactersArray
                .map(char => char.name)
                .filter(name => name && name.toLowerCase() !== 'unavailable');
        }
    } catch (e) {
        // Not JSON, fall back to text parsing
    }
    // Fallback: Parse text format (legacy)
    const lines = characterThoughtsData.split('\n');
    const characters = [];
    for (const line of lines) {
        if (line.trim().startsWith('- ')) {
            const name = line.trim().substring(2).trim();
            if (name && name.toLowerCase() !== 'unavailable') {
                characters.push(name);
            }
        }
    }
    return characters;
}
