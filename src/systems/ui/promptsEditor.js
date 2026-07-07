/**
 * Prompts Editor Module
 * Provides UI for customizing all AI prompts used in the extension
 */
import { extensionSettings } from '../../core/state.js';
import { saveSettings } from '../../core/persistence.js';
import { DEFAULT_HTML_PROMPT, DEFAULT_DIALOGUE_COLORING_PROMPT, DEFAULT_NARRATOR_PROMPT, DEFAULT_CONTEXT_INSTRUCTIONS_PROMPT, DEFAULT_AUTO_PORTRAIT_PROMPT } from '../generation/promptBuilder.js';
import { getWeatherKeywordsAsPromptString } from '../ui/weatherEffects.js';
let $editorModal = null;
let tempPrompts = null; // Temporary prompts for cancel functionality

// Default prompt template constants live in generation/defaultPrompts.js
// (import-free module) so generation code doesn't depend on this UI module.
// Re-exported here for backward compatibility.
export {
    DEFAULT_PLOT_TWIST_TEMPLATE_PROMPT,
    DEFAULT_KNIFE_TEMPLATE_PROMPT,
    DEFAULT_KNIFE_GENERATOR_RULES_PROMPT,
    DEFAULT_NEW_FIELDS_BOOST_PROMPT,
    DEFAULT_TWIST_GENERATOR_RULES_PROMPT,
} from '../generation/defaultPrompts.js';
import {
    DEFAULT_PLOT_TWIST_TEMPLATE_PROMPT,
    DEFAULT_KNIFE_TEMPLATE_PROMPT,
    DEFAULT_KNIFE_GENERATOR_RULES_PROMPT,
    DEFAULT_NEW_FIELDS_BOOST_PROMPT,
    DEFAULT_TWIST_GENERATOR_RULES_PROMPT,
} from '../generation/defaultPrompts.js';

// Default prompts
// Weather default is lazily computed since it depends on getWeatherKeywordsAsPromptString
function getDefaultWeatherPrompt() {
    const keywordsHint = getWeatherKeywordsAsPromptString('en');
    return `SINGLE keyword only. ${keywordsHint}`;
}
const DEFAULT_PROMPTS = {
    html: DEFAULT_HTML_PROMPT,
    dialogueColoring: DEFAULT_DIALOGUE_COLORING_PROMPT,
    // NOTE: deception, omniscience, cyoa, spotify removed (see git history)
    narrator: DEFAULT_NARRATOR_PROMPT,
    contextInstructions: DEFAULT_CONTEXT_INSTRUCTIONS_PROMPT,
    plotTwistTemplate: DEFAULT_PLOT_TWIST_TEMPLATE_PROMPT,
    knifeTemplate: DEFAULT_KNIFE_TEMPLATE_PROMPT,
    knifeGeneratorRules: DEFAULT_KNIFE_GENERATOR_RULES_PROMPT,
    newFieldsBoost: DEFAULT_NEW_FIELDS_BOOST_PROMPT,
    twistGeneratorRules: DEFAULT_TWIST_GENERATOR_RULES_PROMPT,
    trackerInstructions: 'Replace X with actual numbers (e.g., 69) and replace all placeholders with concrete in-world details that {userName} perceives about the current scene and the present characters. For example: "Location" becomes Forest Clearing, "Mood Emoji" becomes "\u{1F60A}". DO NOT include {userName} in the characters section, only NPCs. Consider the last trackers in the conversation (if they exist). Manage them accordingly and realistically; raise, lower, change, or keep the values unchanged based on the user\'s actions, the passage of time, and logical consequences (0% if the time progressed only by a few minutes, 1-5% normally, and above 5% only if a major time-skip/event occurs).',
    trackerContinuation: 'After updating the trackers, continue directly from where the last message in the chat history left off. Ensure the trackers you provide naturally reflect and influence the narrative. Character behavior, dialogue, and story events should acknowledge these conditions when relevant, such as fatigue affecting the protagonist\'s performance, low hygiene influencing their social interactions, environmental factors shaping the scene, a character\'s emotional state coloring their responses, and so on. Remember, all placeholders (e.g., "Location", "Mood Emoji") MUST be replaced with actual content.',
    characterThoughts: "Internal Monologue (in first person from character's POV, up to three sentences long)",
    autoPortrait: DEFAULT_AUTO_PORTRAIT_PROMPT,
    get weather() { return getDefaultWeatherPrompt(); },
};
/**
 * Initialize the prompts editor modal
 */
export function initPromptsEditor() {
    $editorModal = $('#rpg-prompts-editor-popup');
    if (!$editorModal.length) {
        console.error('[Dooms Tracker] Prompts editor modal not found in template');
        return;
    }
    // Save button
    $(document).on('click', '#rpg-prompts-save', function() {
        savePrompts();
        closePromptsEditor();
        toastr.success('Prompts saved successfully.');
    });
    // Cancel button
    $(document).on('click', '#rpg-prompts-cancel', function() {
        closePromptsEditor();
    });
    // Close X button
    $(document).on('click', '#rpg-close-prompts-editor', function() {
        closePromptsEditor();
    });
    // Restore All button
    $(document).on('click', '#rpg-prompts-restore-all', function() {
        restoreAllToDefaults();
        toastr.success('All prompts restored to defaults.');
    });
    // Individual restore buttons
    $(document).on('click', '.rpg-restore-prompt-btn', function() {
        const promptType = $(this).data('prompt');
        restorePromptToDefault(promptType);
        toastr.success('Prompt restored to default.');
    });
    // Close on background click
    $(document).on('click', '#rpg-prompts-editor-popup', function(e) {
        if (e.target.id === 'rpg-prompts-editor-popup') {
            closePromptsEditor();
        }
    });
    // Open button
    $(document).on('click', '#rpg-open-prompts-editor', function() {
        openPromptsEditor();
    });
}
/**
 * Open the prompts editor modal
 */
function openPromptsEditor() {
    // Create temporary copy for cancel functionality
    tempPrompts = {
        html: extensionSettings.customHtmlPrompt || '',
        dialogueColoring: extensionSettings.customDialogueColoringPrompt || '',
        narrator: extensionSettings.customNarratorPrompt || '',
        contextInstructions: extensionSettings.customContextInstructionsPrompt || '',
        plotTwistTemplate: extensionSettings.customPlotTwistTemplatePrompt || '',
        knifeTemplate: extensionSettings.customKnifeTemplatePrompt || '',
        knifeGeneratorRules: extensionSettings.customKnifeGeneratorRulesPrompt || '',
        newFieldsBoost: extensionSettings.customNewFieldsBoostPrompt || '',
        twistGeneratorRules: extensionSettings.customTwistGeneratorRulesPrompt || '',
        trackerInstructions: extensionSettings.customTrackerInstructionsPrompt || '',
        trackerContinuation: extensionSettings.customTrackerContinuationPrompt || '',
        weather: extensionSettings.customWeatherPrompt || '',
        characterThoughts: extensionSettings.customCharacterThoughtsPrompt || '',
        autoPortrait: extensionSettings.customAutoPortraitPrompt || '',
    };
    // Load current values or defaults
    $('#rpg-prompt-html').val(extensionSettings.customHtmlPrompt || DEFAULT_PROMPTS.html);
    $('#rpg-prompt-dialogue-coloring').val(extensionSettings.customDialogueColoringPrompt || DEFAULT_PROMPTS.dialogueColoring);
    $('#rpg-prompt-narrator').val(extensionSettings.customNarratorPrompt || DEFAULT_PROMPTS.narrator);
    $('#rpg-prompt-context-instructions').val(extensionSettings.customContextInstructionsPrompt || DEFAULT_PROMPTS.contextInstructions);
    $('#rpg-prompt-plot-twist-template').val(extensionSettings.customPlotTwistTemplatePrompt || DEFAULT_PROMPTS.plotTwistTemplate);
    $('#rpg-prompt-knife-template').val(extensionSettings.customKnifeTemplatePrompt || DEFAULT_PROMPTS.knifeTemplate);
    $('#rpg-prompt-knife-generator-rules').val(extensionSettings.customKnifeGeneratorRulesPrompt || DEFAULT_PROMPTS.knifeGeneratorRules);
    $('#rpg-prompt-new-fields-boost').val(extensionSettings.customNewFieldsBoostPrompt || DEFAULT_PROMPTS.newFieldsBoost);
    $('#rpg-prompt-twist-generator-rules').val(extensionSettings.customTwistGeneratorRulesPrompt || DEFAULT_PROMPTS.twistGeneratorRules);
    $('#rpg-prompt-tracker-instructions').val(extensionSettings.customTrackerInstructionsPrompt || DEFAULT_PROMPTS.trackerInstructions);
    $('#rpg-prompt-tracker-continuation').val(extensionSettings.customTrackerContinuationPrompt || DEFAULT_PROMPTS.trackerContinuation);
    $('#rpg-prompt-weather').val(extensionSettings.customWeatherPrompt || DEFAULT_PROMPTS.weather);
    $('#rpg-prompt-character-thoughts').val(extensionSettings.customCharacterThoughtsPrompt || DEFAULT_PROMPTS.characterThoughts);
    $('#rpg-prompt-auto-portrait').val(extensionSettings.customAutoPortraitPrompt || DEFAULT_PROMPTS.autoPortrait);
    // Load per-prompt injection depth & role settings
    const pInjection = extensionSettings.promptInjection || {};
    const defaultDepths = { html: 0, dialogueColoring: 0, trackerInstructions: 0, contextInstructions: 1 };
    const defaultRoles = { html: '', dialogueColoring: '', trackerInstructions: 'user', contextInstructions: '' };
    for (const key of ['html', 'dialogueColoring', 'trackerInstructions', 'contextInstructions']) {
        const settings = pInjection[key] || {};
        $(`.rpg-prompt-depth-select[data-prompt-key="${key}"]`).val(settings.depth ?? defaultDepths[key]);
        $(`.rpg-prompt-role-select[data-prompt-key="${key}"]`).val(settings.role ?? defaultRoles[key]);
    }
    // Set theme to match current extension theme
    const theme = extensionSettings.theme || 'default';
    $editorModal.attr('data-theme', theme);
    // Apply custom theme colors if custom theme is selected
    const $content = $editorModal.find('.rpg-settings-popup-content');
    if (theme === 'custom' && extensionSettings.customColors) {
        const colors = extensionSettings.customColors;
        $content.css({
            '--rpg-bg': colors.bg,
            '--rpg-accent': colors.accent,
            '--rpg-text': colors.text,
            '--rpg-highlight': colors.highlight,
        });
    } else {
        $content.css({
            '--rpg-bg': '',
            '--rpg-accent': '',
            '--rpg-text': '',
            '--rpg-highlight': '',
        });
    }
    $editorModal.addClass('is-open').css('display', '');
}
/**
 * Close the prompts editor modal
 */
function closePromptsEditor() {
    // Restore from temp if canceling
    if (tempPrompts) {
        tempPrompts = null;
    }
    $editorModal.removeClass('is-open').addClass('is-closing');
    setTimeout(() => {
        $editorModal.removeClass('is-closing').hide();
    }, 200);
}
/**
 * Save all prompts from the editor
 */
function savePrompts() {
    extensionSettings.customHtmlPrompt = $('#rpg-prompt-html').val().trim();
    extensionSettings.customDialogueColoringPrompt = $('#rpg-prompt-dialogue-coloring').val().trim();
    extensionSettings.customNarratorPrompt = $('#rpg-prompt-narrator').val().trim();
    extensionSettings.customContextInstructionsPrompt = $('#rpg-prompt-context-instructions').val().trim();
    extensionSettings.customPlotTwistTemplatePrompt = $('#rpg-prompt-plot-twist-template').val().trim();
    extensionSettings.customKnifeTemplatePrompt = $('#rpg-prompt-knife-template').val().trim();
    extensionSettings.customKnifeGeneratorRulesPrompt = $('#rpg-prompt-knife-generator-rules').val().trim();
    extensionSettings.customNewFieldsBoostPrompt = $('#rpg-prompt-new-fields-boost').val().trim();
    extensionSettings.customTwistGeneratorRulesPrompt = $('#rpg-prompt-twist-generator-rules').val().trim();
    extensionSettings.customTrackerInstructionsPrompt = $('#rpg-prompt-tracker-instructions').val().trim();
    extensionSettings.customTrackerContinuationPrompt = $('#rpg-prompt-tracker-continuation').val().trim();
    extensionSettings.customWeatherPrompt = $('#rpg-prompt-weather').val().trim();
    extensionSettings.customCharacterThoughtsPrompt = $('#rpg-prompt-character-thoughts').val().trim();
    extensionSettings.customAutoPortraitPrompt = $('#rpg-prompt-auto-portrait').val().trim();
    // Save per-prompt injection depth & role settings
    if (!extensionSettings.promptInjection) extensionSettings.promptInjection = {};
    for (const key of ['html', 'dialogueColoring', 'trackerInstructions', 'contextInstructions']) {
        if (!extensionSettings.promptInjection[key]) extensionSettings.promptInjection[key] = {};
        const depthVal = $(`.rpg-prompt-depth-select[data-prompt-key="${key}"]`).val();
        const roleVal = $(`.rpg-prompt-role-select[data-prompt-key="${key}"]`).val();
        extensionSettings.promptInjection[key].depth = parseInt(String(depthVal));
        extensionSettings.promptInjection[key].role = roleVal;
    }
    saveSettings();
}
/**
 * Restore a specific prompt to its default
 * @param {string} promptType - Type of prompt to restore
 */
function restorePromptToDefault(promptType) {
    const defaultValue = DEFAULT_PROMPTS[promptType] || '';
    $(`#rpg-prompt-${promptType.replace(/([A-Z])/g, '-$1').toLowerCase()}`).val(defaultValue);
    // Also update the setting immediately
    switch(promptType) {
        case 'html':
            extensionSettings.customHtmlPrompt = '';
            break;
        case 'dialogueColoring':
            extensionSettings.customDialogueColoringPrompt = '';
            break;
        // NOTE: deception, omniscience, cyoa, spotify cases archived
        case 'narrator':
            extensionSettings.customNarratorPrompt = '';
            break;
        case 'contextInstructions':
            extensionSettings.customContextInstructionsPrompt = '';
            break;
        case 'plotTwistTemplate':
            extensionSettings.customPlotTwistTemplatePrompt = '';
            break;
        case 'knifeTemplate':
            extensionSettings.customKnifeTemplatePrompt = '';
            break;
        case 'knifeGeneratorRules':
            extensionSettings.customKnifeGeneratorRulesPrompt = '';
            break;
        case 'newFieldsBoost':
            extensionSettings.customNewFieldsBoostPrompt = '';
            break;
        case 'twistGeneratorRules':
            extensionSettings.customTwistGeneratorRulesPrompt = '';
            break;
        case 'trackerInstructions':
            extensionSettings.customTrackerInstructionsPrompt = '';
            break;
        case 'trackerContinuation':
            extensionSettings.customTrackerContinuationPrompt = '';
            break;
        case 'weather':
            extensionSettings.customWeatherPrompt = '';
            break;
        case 'characterThoughts':
            extensionSettings.customCharacterThoughtsPrompt = '';
            break;
        case 'autoPortrait':
            extensionSettings.customAutoPortraitPrompt = '';
            break;
    }
    saveSettings();
}
/**
 * Restore all prompts to their defaults
 */
function restoreAllToDefaults() {
    $('#rpg-prompt-html').val(DEFAULT_PROMPTS.html);
    $('#rpg-prompt-dialogue-coloring').val(DEFAULT_PROMPTS.dialogueColoring);
    // NOTE: deception, omniscience, cyoa, spotify restore lines archived
    $('#rpg-prompt-narrator').val(DEFAULT_PROMPTS.narrator);
    $('#rpg-prompt-context-instructions').val(DEFAULT_PROMPTS.contextInstructions);
    $('#rpg-prompt-plot-twist-template').val(DEFAULT_PROMPTS.plotTwistTemplate);
    $('#rpg-prompt-knife-template').val(DEFAULT_PROMPTS.knifeTemplate);
    $('#rpg-prompt-knife-generator-rules').val(DEFAULT_PROMPTS.knifeGeneratorRules);
    $('#rpg-prompt-new-fields-boost').val(DEFAULT_PROMPTS.newFieldsBoost);
    $('#rpg-prompt-twist-generator-rules').val(DEFAULT_PROMPTS.twistGeneratorRules);
    $('#rpg-prompt-tracker-instructions').val(DEFAULT_PROMPTS.trackerInstructions);
    $('#rpg-prompt-tracker-continuation').val(DEFAULT_PROMPTS.trackerContinuation);
    $('#rpg-prompt-weather').val(DEFAULT_PROMPTS.weather);
    $('#rpg-prompt-character-thoughts').val(DEFAULT_PROMPTS.characterThoughts);
    $('#rpg-prompt-auto-portrait').val(DEFAULT_PROMPTS.autoPortrait);
    // Reset per-prompt injection depth & role to defaults
    const defaultDepths = { html: 0, dialogueColoring: 0, trackerInstructions: 0, contextInstructions: 1 };
    const defaultRoles = { html: '', dialogueColoring: '', trackerInstructions: 'user', contextInstructions: '' };
    for (const key of ['html', 'dialogueColoring', 'trackerInstructions', 'contextInstructions']) {
        $(`.rpg-prompt-depth-select[data-prompt-key="${key}"]`).val(defaultDepths[key]);
        $(`.rpg-prompt-role-select[data-prompt-key="${key}"]`).val(defaultRoles[key]);
    }
    extensionSettings.promptInjection = {
        html: { depth: 0, role: '' },
        dialogueColoring: { depth: 0, role: '' },
        trackerInstructions: { depth: 0, role: 'user' },
        contextInstructions: { depth: 1, role: '' },
    };
    // Clear all custom prompts
    extensionSettings.customHtmlPrompt = '';
    extensionSettings.customDialogueColoringPrompt = '';
    // NOTE: customDeceptionPrompt, customOmnisciencePrompt, customCYOAPrompt, customSpotifyPrompt archived
    extensionSettings.customNarratorPrompt = '';
    extensionSettings.customContextInstructionsPrompt = '';
    extensionSettings.customPlotTwistTemplatePrompt = '';
    extensionSettings.customKnifeTemplatePrompt = '';
    extensionSettings.customKnifeGeneratorRulesPrompt = '';
    extensionSettings.customNewFieldsBoostPrompt = '';
    extensionSettings.customTwistGeneratorRulesPrompt = '';
    extensionSettings.customTrackerInstructionsPrompt = '';
    extensionSettings.customTrackerContinuationPrompt = '';
    extensionSettings.customWeatherPrompt = '';
    extensionSettings.customCharacterThoughtsPrompt = '';
    extensionSettings.customAutoPortraitPrompt = '';
    saveSettings();
}
/**
 * Get default prompts (for export/other modules)
 */
export function getDefaultPrompts() {
    return { ...DEFAULT_PROMPTS };
}
