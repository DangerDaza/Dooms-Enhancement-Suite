/**
 * Encounter UI Module
 * Encounters have been removed from this version.
 * This file is kept as a no-op stub for compatibility.
 */
export class EncounterModal {
    constructor() {}
    async open() {}
    async initialize() {}
    async showNarrativeConfigModal() { return false; }
    createModal() {}
    renderCombatUI() {}
    renderEnemies() { return ''; }
    renderParty() { return ''; }
    getCharacterAvatar() { return null; }
    async showTargetSelection() { return null; }
    renderPlayerControls() { return ''; }
    attachControlListeners() {}
    async processCombatAction() {}
    updateCombatUI() {}
    haveActionsChanged() { return false; }
    async addLogsSequentially() {}
    addToLog() {}
    async concludeEncounter() {}
    async endCombat() {}
    getCombatNarrator() { return 'Narrator'; }
    showCombatOverScreen() {}
    updateCombatOverScreen() {}
    showLoadingState() {}
    showError() {}
    showErrorWithRegenerate() {}
    async regenerateLastRequest() {}
    applyEnvironmentStyling() {}
    close() {}
}
export const encounterModal = new EncounterModal();
export function openEncounterModal() {
    // Encounters have been removed
}
