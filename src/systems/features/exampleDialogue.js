/**
 * Example dialogue of the characters in play (docs/long-shot-plan.md
 * D212). A character's card in the Workshop keeps lines that show how
 * they speak (the Dialogue tab); with every reply, the lines of whoever
 * the tracker has in the scene are sent to the narrator in one block of
 * the extension's own, at the depth set in Settings. A character who is
 * not in the scene costs nothing: only the people present are sent.
 *
 * Who is present is the tracker's word as the reply is asked for: the
 * committed tracker data (what the reply is written from), else the last
 * generated. A scene's first reply has its people from the scene's seed.
 */
import { getContext } from '../../../../../../extensions.js';
import { setExtensionPrompt, extension_prompt_types, extension_prompt_roles } from '../../../../../../../script.js';
import { extensionSettings, lastGeneratedData, committedTrackerData, addDebugLog } from '../../core/state.js';
import { structuralCanonical } from './characterAliases.js';
import { resolvePersonaName } from './diceRolls.js';
import { dialogueConfig, presentWithDialogue, buildDialogueBlock } from '../../utils/exampleDialogue.js';

export const DIALOGUE_SLOT = 'dooms-example-dialogue';

function log(message, data = null) {
    try { addDebugLog(`[Dialogue] ${message}`, data); } catch (e) { /* no log */ }
}

function playerNames() {
    const names = [];
    const add = (v) => { const t = String(v || '').trim(); if (t && !names.some(n => n.toLowerCase() === t.toLowerCase())) names.push(t); };
    try { add(resolvePersonaName()); } catch (e) { /* none */ }
    try { add(getContext().name1); } catch (e) { /* none */ }
    for (const n of Object.keys((extensionSettings && extensionSettings.userCharacters) || {})) add(n);
    return names;
}

/**
 * The characters in the scene who have example dialogue, as the next
 * reply would be sent them: [{ name, dialogue }]. Empty when the feature
 * or the extension is off.
 */
export function dialogueInPlay() {
    if (!extensionSettings || extensionSettings.enabled === false || !dialogueConfig(extensionSettings).enabled) return [];
    const raw = (committedTrackerData && committedTrackerData.characterThoughts) || (lastGeneratedData && lastGeneratedData.characterThoughts) || null;
    if (!raw) return [];
    return presentWithDialogue(raw, extensionSettings.characterInjection, { resolve: structuralCanonical, players: playerNames() });
}

/** The block as it would ride the next reply; '' when no one in the scene has any. */
export function buildDialogueBlockNow() {
    const players = playerNames();
    return buildDialogueBlock(dialogueInPlay(), { player: players[0] || '' });
}

/** GENERATION_STARTED: the block rides the generation (not a quiet one, not one written as the player), at the depth set. */
export function onDialogueGenerationStarted(type, data, dryRun) {
    if (dryRun) return;
    const c = dialogueConfig(extensionSettings);
    const quiet = type === 'quiet' || type === 'impersonate' || !!(data && (data.quiet_prompt || data.quietImage || data.quiet_image));
    let text = '';
    try { text = quiet ? '' : buildDialogueBlockNow(); } catch (e) { text = ''; log('the block could not be built', String(e && e.message || e)); }
    const role = c.role === 'user' ? extension_prompt_roles.USER : c.role === 'assistant' ? extension_prompt_roles.ASSISTANT : extension_prompt_roles.SYSTEM;
    try {
        setExtensionPrompt(DIALOGUE_SLOT, text ? `\n${text}\n` : '', extension_prompt_types.IN_CHAT, c.depth, false, role);
    } catch (e) {
        log('injection failed', String(e && e.message || e));
    }
}

/** The slot emptied: the extension or the feature switched off, a chat changed. */
export function clearDialogueSlot() {
    try { setExtensionPrompt(DIALOGUE_SLOT, '', extension_prompt_types.IN_CHAT, dialogueConfig(extensionSettings).depth, false, extension_prompt_roles.SYSTEM); } catch (e) { /* no SillyTavern */ }
}
