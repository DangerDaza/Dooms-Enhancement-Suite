/**
 * Modal Management Module
 * Handles DiceModal and SettingsModal ES6 classes with state management
 */
import { getContext } from '../../../../../../extensions.js';
import {
    extensionSettings,
    lastGeneratedData,
    committedTrackerData,
    $infoBoxContainer,
    $thoughtsContainer,
    clearSessionAvatarPrompts
} from '../../core/state.js';
import { saveSettings, saveChatData } from '../../core/persistence.js';
import { renderInfoBox } from '../rendering/infoBox.js';
import { renderThoughts, updateChatThoughts } from '../rendering/thoughts.js';
import { renderQuests } from '../rendering/quests.js';
// NOTE: DiceModal imports removed — dice system archived to src/archived/
import { i18n } from '../../core/i18n.js';
/**
 * SettingsModal - Manages the settings popup modal
 * Handles opening, closing, theming, and animations
 */
export class SettingsModal {
    constructor() {
        this.modal = document.getElementById('rpg-settings-popup');
        this.content = this.modal?.querySelector('.rpg-settings-popup-content');
        this.isAnimating = false;
    }
    /**
     * Opens the modal with proper animation
     */
    open() {
        if (this.isAnimating || !this.modal) return;
        // Apply theme
        const theme = extensionSettings.theme || 'default';
        this.modal.setAttribute('data-theme', theme);
        // Apply custom theme if needed
        if (theme === 'custom') {
            this._applyCustomTheme();
        }
        // Open modal with CSS class
        this.modal.classList.add('is-open');
        this.modal.classList.remove('is-closing');
        // Focus management
        this.modal.querySelector('#rpg-close-settings')?.focus();
    }
    /**
     * Closes the modal with animation
     */
    close() {
        if (this.isAnimating || !this.modal) return;
        this.isAnimating = true;
        this.modal.classList.add('is-closing');
        this.modal.classList.remove('is-open');
        // Wait for animation to complete
        setTimeout(() => {
            this.modal.classList.remove('is-closing');
            this.isAnimating = false;
        }, 200);
    }
    /**
     * Updates the theme in real-time (used when theme selector changes)
     */
    updateTheme() {
        if (!this.modal) return;
        const theme = extensionSettings.theme || 'default';
        this.modal.setAttribute('data-theme', theme);
        if (theme === 'custom') {
            this._applyCustomTheme();
        } else {
            // Clear custom CSS variables to let theme CSS take over
            this._clearCustomTheme();
        }
    }
    /**
     * Applies custom theme colors
     * @private
     */
    _applyCustomTheme() {
        if (!this.content || !extensionSettings.customColors) return;
        this.content.style.setProperty('--rpg-bg', extensionSettings.customColors.bg);
        this.content.style.setProperty('--rpg-accent', extensionSettings.customColors.accent);
        this.content.style.setProperty('--rpg-text', extensionSettings.customColors.text);
        this.content.style.setProperty('--rpg-highlight', extensionSettings.customColors.highlight);
    }
    /**
     * Clears custom theme colors
     * @private
     */
    _clearCustomTheme() {
        if (!this.content) return;
        this.content.style.setProperty('--rpg-bg', '');
        this.content.style.setProperty('--rpg-accent', '');
        this.content.style.setProperty('--rpg-text', '');
        this.content.style.setProperty('--rpg-highlight', '');
    }
}
// Global instances
let diceModal = null;
let settingsModal = null;
/**
 * Sets up the settings popup functionality.
 * @returns {SettingsModal} The initialized SettingsModal instance
 */
export function setupSettingsPopup() {
    // Initialize SettingsModal instance
    settingsModal = new SettingsModal();
    // Open settings popup
    $('#rpg-open-settings').on('click', function() {
        openSettingsPopup();
    });
    // Close settings popup - close button
    $('#rpg-close-settings').on('click', function() {
        closeSettingsPopup();
    });
    // Close on backdrop click (clicking outside content)
    $('#rpg-settings-popup').on('click', function(e) {
        if (e.target === this) {
            closeSettingsPopup();
        }
    });
    // Clear cache button
    $('#rpg-clear-cache').on('click', function() {
        // Clear the data (set to null so panels show "not generated yet")
        lastGeneratedData.quests = null;
        lastGeneratedData.infoBox = null;
        lastGeneratedData.characterThoughts = null;
        lastGeneratedData.html = null;
        // Clear committed tracker data (used for generation context)
        committedTrackerData.quests = null;
        committedTrackerData.infoBox = null;
        committedTrackerData.characterThoughts = null;
        // Clear session avatar prompts
        clearSessionAvatarPrompts();
        // Clear chat metadata immediately (don't wait for debounced save)
        const context = getContext();
        if (context.chat_metadata && context.chat_metadata.dooms_tracker) {
            delete context.chat_metadata.dooms_tracker;
        }
        // Clear all message swipe data
        const chat = context.chat;
        if (chat && chat.length > 0) {
            for (let i = 0; i < chat.length; i++) {
                const message = chat[i];
                if (message.extra && message.extra.dooms_tracker_swipes) {
                    delete message.extra.dooms_tracker_swipes;
                }
            }
        }
        // Clear the UI
        if ($infoBoxContainer) {
            $infoBoxContainer.empty();
        }
        if ($thoughtsContainer) {
            $thoughtsContainer.empty();
        }
        // NOTE: userStats reset removed — system archived
        // Reset quests to defaults
        extensionSettings.quests = {
            main: "None",
            optional: []
        };
        // Reset info box to defaults (as object)
        extensionSettings.infoBox = {
            date: new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }),
            weather: '☀️ Clear skies',
            temperature: '20°C',
            time: '00:00 - 00:00',
            location: 'Unknown Location',
            recentEvents: []
        };
        // Reset character thoughts to empty (as object)
        extensionSettings.characterThoughts = {
            characters: []
        };
        // NOTE: classicStats reset removed — system archived
        // Clear all locked items
        extensionSettings.lockedItems = {
            stats: [],
            skills: [],
            inventory: {
                onPerson: [],
                clothing: [],
                stored: {},
                assets: []
            },
            quests: {
                main: false,
                optional: []
            },
            infoBox: {
                date: false,
                time: false,
                location: false,
                recentEvents: false
            },
            characters: {}
        };
        // Save everything
        saveChatData();
        saveSettings();
        // Re-render all panels - they will show "not generated yet" messages since data is null
        renderInfoBox();
        renderThoughts();
        // NOTE: updateDiceDisplayCore() call removed — dice system archived
        updateChatThoughts();
    });
    return settingsModal;
}
/**
 * Opens the settings popup.
 * Backwards compatible wrapper for SettingsModal class.
 */
export function openSettingsPopup() {
    if (settingsModal) {
        settingsModal.open();
    }
}
/**
 * Closes the settings popup.
 * Backwards compatible wrapper for SettingsModal class.
 */
export function closeSettingsPopup() {
    if (settingsModal) {
        settingsModal.close();
    }
}
/**
 * Returns the SettingsModal instance for external use
 * @returns {SettingsModal} The global SettingsModal instance
 */
export function getSettingsModal() {
    return settingsModal;
}
/**
 * Shows the welcome modal for v3.0.0 on first launch
 * Checks if user has already seen this version's welcome screen
 */
export function showWelcomeModalIfNeeded() {
    const WELCOME_VERSION = '3.0.1';
    const STORAGE_KEY = 'dooms_tracker_welcome_seen';
    try {
        const seenVersion = localStorage.getItem(STORAGE_KEY);
        // If user hasn't seen v3.0.0 welcome yet, show it
        if (seenVersion !== WELCOME_VERSION) {
            showWelcomeModal(WELCOME_VERSION, STORAGE_KEY);
        }
    } catch (error) {
        console.error('[Dooms Tracker] Failed to check welcome modal status:', error);
    }
}
/**
 * Shows the welcome modal
 * @param {string} version - The version to mark as seen
 * @param {string} storageKey - The localStorage key to use
 */
function showWelcomeModal(version, storageKey) {
    const modal = document.getElementById('rpg-welcome-modal');
    if (!modal) {
        console.error('[Dooms Tracker] Welcome modal element not found');
        return;
    }
    // Apply current theme to modal
    const theme = extensionSettings.theme || 'default';
    modal.setAttribute('data-theme', theme);
    // Show modal
    modal.style.display = 'flex';
    modal.classList.add('is-open');
    // Close button handler
    const closeBtn = document.getElementById('rpg-welcome-close');
    const gotItBtn = document.getElementById('rpg-welcome-got-it');
    const closeModal = () => {
        modal.classList.add('is-closing');
        setTimeout(() => {
            modal.style.display = 'none';
            modal.classList.remove('is-open', 'is-closing');
        }, 200);
        // Mark this version as seen
        try {
            localStorage.setItem(storageKey, version);
        } catch (error) {
            console.error('[Dooms Tracker] Failed to save welcome modal status:', error);
        }
    };
    // Attach event listeners
    closeBtn?.addEventListener('click', closeModal, { once: true });
    gotItBtn?.addEventListener('click', closeModal, { once: true });
    // Close on background click
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            closeModal();
        }
    }, { once: true });
}
