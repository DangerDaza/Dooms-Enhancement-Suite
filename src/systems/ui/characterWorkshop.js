/**
 * Character Workshop — unified per-character editor modal.
 *
 * v1 scope: Identity (read-only), Appearance (portrait + dialogue color),
 * Sheet (Bunny Mo sections). Trackers tab is a placeholder; per-turn
 * tracker values are AI-generated and owned by thoughts.js.
 *
 * This file is an intentional stub for commit cw-1. The modal markup,
 * styles, and real behavior land in subsequent commits (cw-2..cw-8).
 *
 * Opening the workshop is decoupled from portraitBar.js via a window
 * CustomEvent ('dooms:open-workshop') so the portrait-bar module does
 * not need to import this one.
 */

import { extensionSettings } from '../../core/state.js';

/**
 * Register the workshop's window event listener. Called once from
 * index.js initUI(). Respects extensionSettings.characterWorkshopEnabled
 * as a kill switch — if false, does nothing.
 */
export function initCharacterWorkshop() {
    if (extensionSettings?.characterWorkshopEnabled === false) {
        console.log('[Dooms Tracker] Character Workshop disabled via setting, skipping init');
        return;
    }
    window.addEventListener('dooms:open-workshop', (e) => {
        const name = e?.detail?.characterName;
        if (name) openCharacterWorkshop(name);
    });
}

/**
 * Open the workshop for the named character. Stub in cw-1; real
 * implementation lands in cw-4.
 */
export function openCharacterWorkshop(characterName) {
    console.log('[Dooms Tracker] openCharacterWorkshop stub called for:', characterName);
}

/**
 * Close the workshop. Stub in cw-1; real implementation lands in cw-4.
 */
export function closeCharacterWorkshop() {
    // no-op
}
