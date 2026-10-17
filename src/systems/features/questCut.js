/**
 * Cut to a quest (Project Short Fuse, Phase 5b): the part that touches the
 * chat.
 *
 * The shelf arms a cut for the chat (chat_metadata.dooms_quest_cut) and asks
 * SillyTavern for a reply with no message of the player's; the instruction
 * rides that generation in its own slot beside the dice and inventory slots
 * (injector.refreshDiceInjection). The cut stays armed through swipes and
 * regenerates of the montage and ends with the player's next message
 * (MESSAGE_SENT), so the first move after the cut is theirs.
 *
 * The text itself is src/utils/questCut.js (pure); the menu is in
 * src/systems/ui/shelfPages.js.
 */
import { chat_metadata, saveChatDebounced } from '../../../../../../../script.js';
import { executeSlashCommandsOnChatInput } from '../../../../../../../scripts/slash-commands.js';
import { extensionSettings, lastGeneratedData, committedTrackerData } from '../../core/state.js';
import { resolvePersonaName } from './diceRolls.js';
import { buildQuestCutInstruction, sceneFactsFrom, normalizeQuests, cleanWhen, MAX_QUEST } from '../../utils/questCut.js';

export const QUEST_CUT_CHANGED_EVENT = 'dooms:quest-cut-changed';
const META_KEY = 'dooms_quest_cut';

function notify(detail = {}) {
    try {
        window.dispatchEvent(new CustomEvent(QUEST_CUT_CHANGED_EVENT, { detail }));
    } catch (e) { /* no window (tests) */ }
}

function toast(kind, text) {
    try {
        const t = typeof window !== 'undefined' ? window.toastr : null;
        if (t && typeof t[kind] === 'function') t[kind](text, 'Quests', { timeOut: 5000, escapeHtml: true });
    } catch (e) { /* no toastr */ }
}

/** The cut armed for this chat, or null. */
export function getPendingQuestCut() {
    const p = chat_metadata && typeof chat_metadata === 'object' ? chat_metadata[META_KEY] : null;
    return p && typeof p === 'object' && typeof p.quest === 'string' && p.quest ? p : null;
}

function setPending(p) {
    if (!chat_metadata || typeof chat_metadata !== 'object') return;
    if (p) chat_metadata[META_KEY] = p;
    else delete chat_metadata[META_KEY];
    try { saveChatDebounced(); } catch (e) { /* no chat open */ }
    notify({ pending: !!p });
}

/**
 * Arms the cut and asks SillyTavern for the reply. The quest list has been
 * changed by the caller already (the quest is the main quest now).
 * @param {{ quest: string, when?: string }} args
 * @returns {Promise<boolean>} whether a reply was asked for
 */
export async function startQuestCut({ quest, when = '' } = {}) {
    const q = String(quest || '').replace(/\s+/g, ' ').trim().slice(0, MAX_QUEST);
    if (!q) return false;
    setPending({ quest: q, when: cleanWhen(when), at: Date.now() });
    toast('info', `Cutting to "${q}"…`);
    try {
        await executeSlashCommandsOnChatInput('/trigger', { quiet: true });
        return true;
    } catch (e) {
        console.warn('[Dooms Tracker] Quest cut: the reply could not be asked for', e);
        setPending(null);
        toast('error', 'Could not ask for the reply. The System Log has the error.');
        return false;
    }
}

/** Disarms the cut (nothing rides the next generation). */
export function cancelQuestCut() {
    if (getPendingQuestCut()) setPending(null);
}

/** MESSAGE_SENT: the player's next message ends the cut; swipes and regenerates of the montage keep it. */
export function onQuestCutMessageSent() {
    if (getPendingQuestCut()) setPending(null);
}

/** The instruction for this generation, or '' when no cut is armed. */
export function buildQuestCutForGeneration() {
    if (!extensionSettings.enabled) return '';
    const p = getPendingQuestCut();
    if (!p) return '';
    let facts = {};
    try { facts = sceneFactsFrom(lastGeneratedData.infoBox || committedTrackerData.infoBox); } catch (e) { facts = {}; }
    const quests = normalizeQuests(extensionSettings.quests);
    const others = quests.optional.filter(t => t && t !== 'None' && t !== p.quest).slice(0, 6);
    return buildQuestCutInstruction({ quest: p.quest, when: p.when, userName: resolvePersonaName() || 'the player', facts, otherQuests: others });
}
