/**
 * Layout Management Module
 * Handles section visibility (panel has been removed — data renders via scene headers)
 */
import {
    extensionSettings,
    $infoBoxContainer,
    $thoughtsContainer,
    $questsContainer,
    lastGeneratedData,
    committedTrackerData
} from '../../core/state.js';

/**
 * Updates the visibility of individual sections.
 * Note: With the panel removed, these containers may not exist in DOM.
 * This function is kept for compatibility with settings toggle handlers.
 */
export function updateSectionVisibility() {
    if ($infoBoxContainer) {
        if (extensionSettings.showInfoBox) {
            const infoBoxData = lastGeneratedData.infoBox || committedTrackerData.infoBox;
            if (infoBoxData) {
                $infoBoxContainer.show();
            } else {
                $infoBoxContainer.hide();
            }
        } else {
            $infoBoxContainer.hide();
        }
    }
    if ($thoughtsContainer) {
        if (extensionSettings.showCharacterThoughts) {
            $thoughtsContainer.show();
        } else {
            $thoughtsContainer.hide();
        }
    }
    if (extensionSettings.showQuests) {
        $('#rpg-quests').show();
    } else {
        $('#rpg-quests').hide();
    }
}
