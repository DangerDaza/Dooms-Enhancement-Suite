/**
 * Lorebook Modal Module
 * Manages the Lorebook Manager modal popup (open/close/theme).
 * Follows the same pattern as SettingsModal in modals.js.
 */
import { extensionSettings } from '../../core/state.js';
import { renderLorebook } from '../rendering/lorebook.js';

/**
 * LorebookModal - Manages the lorebook manager modal popup
 */
export class LorebookModal {
    constructor() {
        this.modal = document.getElementById('rpg-lorebook-modal');
        this.content = this.modal?.querySelector('.rpg-lb-modal-content');
        this.isAnimating = false;
        this._isOpen = false;
    }

    /**
     * Opens the modal with proper animation and triggers a render
     */
    open() {
        if (this.isAnimating || !this.modal) return;

        // Apply theme
        const theme = extensionSettings.theme || 'default';
        this.modal.setAttribute('data-theme', theme);

        if (theme === 'custom') {
            this._applyCustomTheme();
        }

        // Open modal
        this.modal.classList.add('is-open');
        this.modal.classList.remove('is-closing');
        this._isOpen = true;

        // Prevent background scroll on mobile
        document.body.style.overflow = 'hidden';

        // Focus the close button
        this.modal.querySelector('.rpg-lb-close')?.focus();

        // Render lorebook content
        renderLorebook();
    }

    /**
     * Closes the modal with animation
     */
    close() {
        if (this.isAnimating || !this.modal) return;

        this.isAnimating = true;
        this._isOpen = false;
        this.modal.classList.add('is-closing');
        this.modal.classList.remove('is-open');

        // Restore background scroll
        document.body.style.overflow = '';

        // Wait for animation to complete
        setTimeout(() => {
            this.modal.classList.remove('is-closing');
            this.isAnimating = false;
        }, 200);
    }

    /**
     * Returns whether the modal is currently open
     * @returns {boolean}
     */
    isOpen() {
        return this._isOpen;
    }

    /**
     * Updates the theme in real-time
     */
    updateTheme() {
        if (!this.modal) return;
        const theme = extensionSettings.theme || 'default';
        this.modal.setAttribute('data-theme', theme);
        if (theme === 'custom') {
            this._applyCustomTheme();
        } else {
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

// ─── Singleton ──────────────────────────────────────────────────────────────

let lorebookModal = null;

/**
 * Initializes the singleton LorebookModal instance
 */
export function setupLorebookModal() {
    lorebookModal = new LorebookModal();
}

/**
 * Returns the singleton LorebookModal instance
 * @returns {LorebookModal|null}
 */
export function getLorebookModal() {
    return lorebookModal;
}
