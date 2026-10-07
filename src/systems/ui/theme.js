/**
 * Theme Management Module
 * Handles theme application, custom colors, and animations
 */
import { extensionSettings, $panelContainer } from '../../core/state.js';
import { ensureCss } from '../../core/cssLoader.js';
import { resolveThemeCss } from './themePalettes.js';
import { syncComposer } from './composer.js';

/**
 * UI setups are the second axis of DES's look. A theme picks the colours;
 * a setup picks the shapes and type: how the scene tracker, chat bubbles,
 * portrait shelf, Doom Counter, windows and composer are built. 'classic'
 * is the look DES always had. The other five live in styles/overhaul.css,
 * hung off <body data-dooms-ui="...">, and read the active theme's palette
 * from body-level --dooms-ui-* variables that applyUiSetup() keeps current.
 * Each loads its own web fonts, with local fallbacks in every CSS stack so
 * an offline SillyTavern still gets the shapes in system faces.
 */
export const UI_SETUPS = {
    classic:  { label: 'Classic',     fonts: null },
    grimoire: { label: 'Grimoire',    fonts: 'family=Cinzel:wght@600;700&family=Lora:ital,wght@0,400;0,500;0,600;1,400;1,500' },
    console:  { label: 'Ops Console', fonts: 'family=JetBrains+Mono:wght@400;500;700&family=IBM+Plex+Sans:wght@400;500;700' },
    lumen:    { label: 'Lumen',       fonts: 'family=Manrope:wght@400;500;600;700;800' },
    arcade:   { label: 'Arcade',      fonts: 'family=Bebas+Neue&family=Barlow:ital,wght@0,400;0,500;0,700;1,400' },
    inked:    { label: 'Inked',       fonts: 'family=Archivo+Black&family=Nunito:ital,wght@0,500;0,700;0,800;1,500' },
};

/**
 * @param {string} setup
 * @returns {boolean} true for one of the five styled setups (not 'classic')
 */
export function isStyledUiSetup(setup) {
    return setup !== 'classic' && Object.prototype.hasOwnProperty.call(UI_SETUPS, setup);
}

const FONT_LINK_ID = 'dooms-ui-fonts';
const UI_VARS = ['bg', 'accent', 'text', 'highlight', 'border'];

/**
 * Applies the chosen UI setup: stamps (or clears) the body attribute,
 * loads the setup stylesheet on first use, swaps the web-font link, and
 * publishes the active theme's palette as --dooms-ui-* on <body> so the
 * setup's chat-side surfaces use the same colours as the windows.
 * Idempotent; runs from applyTheme() so a theme change re-publishes.
 */
export function applyUiSetup() {
    const body = document.body;
    if (!body) return;
    const setup = UI_SETUPS[extensionSettings.uiSetup] ? extensionSettings.uiSetup : 'classic';
    const existingLink = document.getElementById(FONT_LINK_ID);
    // The SillyTavern background follows the setup (lazy: it pulls in
    // SillyTavern's backgrounds module only when first needed).
    import('./setupBackgrounds.js')
        .then(m => m.syncSetupBackground(setup, extensionSettings.theme))
        .catch(e => console.warn('[Dooms Tracker] setup backgrounds unavailable:', e));
    // SillyTavern's message box is re-hosted in two tiers for a styled
    // setup (and put back for Classic or when the option is off).
    try {
        syncComposer(setup, extensionSettings.uiComposer !== false);
    } catch (e) {
        console.warn('[Dooms Tracker] composer unavailable:', e);
    }
    if (!isStyledUiSetup(setup)) {
        body.removeAttribute('data-dooms-ui');
        for (const k of UI_VARS) body.style.removeProperty(`--dooms-ui-${k}`);
        if (existingLink) existingLink.remove();
        return;
    }
    // Stylesheet first so the attribute never shows unstyled surfaces.
    ensureCss('overhaul').catch(() => { });
    const palette = resolveThemeCss(extensionSettings.theme, extensionSettings.customColors);
    for (const k of UI_VARS) body.style.setProperty(`--dooms-ui-${k}`, palette[k]);
    body.setAttribute('data-dooms-ui', setup);
    const href = `https://fonts.googleapis.com/css2?${UI_SETUPS[setup].fonts}&display=swap`;
    if (existingLink && existingLink.getAttribute('href') === href) return;
    if (existingLink) existingLink.remove();
    const link = document.createElement('link');
    link.id = FONT_LINK_ID;
    link.rel = 'stylesheet';
    link.href = href;
    // A blocked or offline font host must not surface as an error: the CSS
    // stacks fall back to local serif / sans / mono faces.
    link.onerror = () => { };
    document.head.appendChild(link);
}

/**
 * Converts hex color and opacity percentage to rgba string
 * @param {string} hex - Hex color (e.g., '#ff0000')
 * @param {number} opacity - Opacity percentage (0-100)
 * @returns {string} - RGBA color string
 */
export function hexToRgba(hex, opacity = 100) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    const a = opacity / 100;
    return `rgba(${r}, ${g}, ${b}, ${a})`;
}
/**
 * Applies the selected theme to the panel.
 */
export function applyTheme() {
    const theme = extensionSettings.theme;
    // The UI setup lives on <body>, independent of any panel existing, and
    // re-reads the palette here so a theme change recolours it.
    try { applyUiSetup(); } catch (e) { console.error('[Dooms Tracker] applyUiSetup failed:', e); }
    // Find the panel element — use cached ref if available, otherwise query DOM
    const $panel = $panelContainer || $('.rpg-panel');
    if (!$panel || !$panel.length) return;
    // Remove all theme attributes first
    $panel.removeAttr('data-theme');
    // Clear any inline CSS variable overrides
    $panel.css({
        '--rpg-bg': '',
        '--rpg-accent': '',
        '--rpg-text': '',
        '--rpg-highlight': '',
        '--rpg-border': '',
        '--rpg-shadow': ''
    });
    // Apply the selected theme
    if (theme === 'custom') {
        applyCustomTheme();
    } else if (theme !== 'default') {
        // For non-default themes, set the data-theme attribute
        // which will trigger the CSS theme rules
        $panel.attr('data-theme', theme);
    }
    // For 'default', we do nothing - it will use the CSS variables from .rpg-panel class
    // which fall back to SillyTavern's theme variables
    // Apply theme to mobile toggle and thought elements as well
    const $mobileToggle = $('#rpg-mobile-toggle');
    const $thoughtIcon = $('#rpg-thought-icon');
    const $thoughtPanel = $('#rpg-thought-panel');
    if ($mobileToggle.length) {
        if (theme === 'default') {
            $mobileToggle.removeAttr('data-theme');
        } else {
            $mobileToggle.attr('data-theme', theme);
        }
    }
    if ($thoughtIcon.length) {
        if (theme === 'default') {
            $thoughtIcon.removeAttr('data-theme');
        } else {
            $thoughtIcon.attr('data-theme', theme);
        }
    }
    if ($thoughtPanel.length) {
        if (theme === 'default') {
            $thoughtPanel.removeAttr('data-theme');
        } else {
            $thoughtPanel.attr('data-theme', theme);
        }
    }
    const $fab = $('#dooms-settings-fab');
    if ($fab.length) {
        if (theme === 'default') {
            $fab.removeAttr('data-theme');
        } else {
            $fab.attr('data-theme', theme);
        }
    }
    // Also stamp the settings and tracker editor popups so theme CSS takes effect
    // immediately on load, not only when the user opens the popup for the first time.
    const $settingsPopup = $('#rpg-settings-popup');
    if ($settingsPopup.length) {
        if (theme === 'default') { $settingsPopup.removeAttr('data-theme'); }
        else { $settingsPopup.attr('data-theme', theme); }
    }
    const $trackerEditorPopup = $('#rpg-tracker-editor-popup');
    if ($trackerEditorPopup.length) {
        if (theme === 'default') { $trackerEditorPopup.removeAttr('data-theme'); }
        else { $trackerEditorPopup.attr('data-theme', theme); }
    }
    const $promptsEditorPopup = $('#rpg-prompts-editor-popup');
    if ($promptsEditorPopup.length) {
        if (theme === 'default') { $promptsEditorPopup.removeAttr('data-theme'); }
        else { $promptsEditorPopup.attr('data-theme', theme); }
    }
    const $charDataEditorPopup = $('#rpg-character-data-editor-popup');
    if ($charDataEditorPopup.length) {
        if (theme === 'default') { $charDataEditorPopup.removeAttr('data-theme'); }
        else { $charDataEditorPopup.attr('data-theme', theme); }
    }
}
/**
 * Applies custom colors when custom theme is selected.
 */
export function applyCustomTheme() {
    const $panel = $panelContainer || $('.rpg-panel');
    if (!$panel || !$panel.length) return;
    const colors = extensionSettings.customColors;
    // Convert hex colors with opacity to rgba
    const bgColor = hexToRgba(colors.bg, colors.bgOpacity ?? 100);
    const accentColor = hexToRgba(colors.accent, colors.accentOpacity ?? 100);
    const textColor = hexToRgba(colors.text, colors.textOpacity ?? 100);
    const highlightColor = hexToRgba(colors.highlight, colors.highlightOpacity ?? 100);
    // Create shadow with 50% opacity of highlight color
    const shadowColor = hexToRgba(colors.highlight, (colors.highlightOpacity ?? 100) * 0.5);
    // Apply custom CSS variables as inline styles to main panel
    $panel.css({
        '--rpg-bg': bgColor,
        '--rpg-accent': accentColor,
        '--rpg-text': textColor,
        '--rpg-highlight': highlightColor,
        '--rpg-border': highlightColor,
        '--rpg-shadow': shadowColor
    });
    // Apply custom colors to mobile toggle and thought elements
    const customStyles = {
        '--rpg-bg': bgColor,
        '--rpg-accent': accentColor,
        '--rpg-text': textColor,
        '--rpg-highlight': highlightColor,
        '--rpg-border': highlightColor,
        '--rpg-shadow': shadowColor
    };
    const $mobileToggle = $('#rpg-mobile-toggle');
    const $thoughtIcon = $('#rpg-thought-icon');
    const $thoughtPanel = $('#rpg-thought-panel');
    if ($mobileToggle.length) {
        $mobileToggle.attr('data-theme', 'custom').css(customStyles);
    }
    if ($thoughtIcon.length) {
        $thoughtIcon.attr('data-theme', 'custom').css(customStyles);
    }
    if ($thoughtPanel.length) {
        $thoughtPanel.attr('data-theme', 'custom').css(customStyles);
    }
    const $fab = $('#dooms-settings-fab');
    if ($fab.length) {
        $fab.attr('data-theme', 'custom').css(customStyles);
    }
}
/**
 * Toggles visibility of custom color pickers.
 */
export function toggleCustomColors() {
    const isCustom = extensionSettings.theme === 'custom';
    $('#rpg-custom-colors').toggle(isCustom);
}
/**
 * Toggles animations on/off by adding/removing a class to the panel.
 */
export function toggleAnimations() {
    const $panel = $panelContainer || $('.rpg-panel');
    if (!$panel || !$panel.length) return;
    if (extensionSettings.enableAnimations) {
        $panel.addClass('rpg-animations-enabled');
    } else {
        $panel.removeClass('rpg-animations-enabled');
    }
}
/**
 * Updates visibility of feature toggles in main panel based on settings
 */
export function updateFeatureTogglesVisibility() {
    const $featuresRow = $('#rpg-features-row');
    const $htmlToggle = $('#rpg-html-toggle-wrapper');
    const $dialogueColoringToggle = $('#rpg-dialogue-coloring-toggle-wrapper');
    const $dynamicWeatherToggle = $('#rpg-dynamic-weather-toggle-wrapper');
    const $narratorToggle = $('#rpg-narrator-toggle-wrapper');
    const $autoAvatarsToggle = $('#rpg-auto-avatars-toggle-wrapper');
    // Show/hide individual toggles
    $htmlToggle.toggle(extensionSettings.showHtmlToggle);
    $dialogueColoringToggle.toggle(extensionSettings.showDialogueColoringToggle);
    $dynamicWeatherToggle.toggle(extensionSettings.showDynamicWeatherToggle);
    $narratorToggle.toggle(extensionSettings.showNarratorMode);
    $autoAvatarsToggle.toggle(extensionSettings.showAutoAvatars);
    // Hide entire row if all toggles are hidden
    const anyVisible = extensionSettings.showHtmlToggle ||
                      extensionSettings.showDialogueColoringToggle ||
                      extensionSettings.showDynamicWeatherToggle ||
                      extensionSettings.showNarratorMode ||
                      extensionSettings.showAutoAvatars;
    $featuresRow.toggle(anyVisible);
}
/**
 * Updates the settings popup theme in real-time.
 * Backwards compatible wrapper for SettingsModal class.
 * @param {Object} settingsModal - The SettingsModal instance (passed as parameter to avoid circular dependency)
 */
export function updateSettingsPopupTheme(settingsModal) {
    if (settingsModal) {
        settingsModal.updateTheme();
    }
}
/**
 * Applies custom theme colors to the settings popup.
 * Backwards compatible wrapper for SettingsModal class.
 * @deprecated Use settingsModal.updateTheme() instead
 * @param {Object} settingsModal - The SettingsModal instance (passed as parameter to avoid circular dependency)
 */
export function applyCustomThemeToSettingsPopup(settingsModal) {
    if (settingsModal) {
        settingsModal._applyCustomTheme();
    }
}
