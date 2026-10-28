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
 * Travel here (docs/map-window-plan.md D84) is the same cut with
 * `kind: 'travel'` and a place for the quest: the road, then the arrival.
 * The completed quests (D86) are kept here too, chat_metadata.dooms_quests_done,
 * written when the shelf's Complete removes a quest.
 *
 * The text itself is src/utils/questCut.js and src/utils/worldMap.js (pure);
 * the menu is in src/systems/ui/shelfPages.js; the Map window asks for the
 * travel.
 */
import { chat_metadata, saveChatDebounced } from '../../../../../../../script.js';
import { executeSlashCommandsOnChatInput } from '../../../../../../../scripts/slash-commands.js';
import { extensionSettings, lastGeneratedData, committedTrackerData } from '../../core/state.js';
import { resolvePersonaName } from './diceRolls.js';
import { buildQuestCutInstruction, sceneFactsFrom, normalizeQuests, cleanWhen, MAX_QUEST } from '../../utils/questCut.js';
import { buildTravelInstruction, normalizeDone, addDone } from '../../utils/worldMap.js';
import { MAX_PLACE } from '../../utils/liveWorld.js';

export const QUEST_CUT_CHANGED_EVENT = 'dooms:quest-cut-changed';
export const QUESTS_DONE_CHANGED_EVENT = 'dooms:quests-done-changed';
const META_KEY = 'dooms_quest_cut';
const DONE_KEY = 'dooms_quests_done';

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

/** The cut armed for this chat (a quest's, or a travel's with `kind: 'travel'`), or null. */
export function getPendingQuestCut() {
    const p = chat_metadata && typeof chat_metadata === 'object' ? chat_metadata[META_KEY] : null;
    if (!p || typeof p !== 'object') return null;
    if (p.kind === 'travel') return typeof p.place === 'string' && p.place ? p : null;
    return typeof p.quest === 'string' && p.quest ? p : null;
}

function setPending(p) {
    if (!chat_metadata || typeof chat_metadata !== 'object') return;
    if (p) chat_metadata[META_KEY] = p;
    else delete chat_metadata[META_KEY];
    try { saveChatDebounced(); } catch (e) { /* no chat open */ }
    notify({ pending: !!p });
}

/** The tracker's date, time and place as they stand. */
function factsNow() {
    try { return sceneFactsFrom(lastGeneratedData.infoBox || committedTrackerData.infoBox); } catch (e) { return {}; }
}

/**
 * Arms the cut and asks SillyTavern for the reply. The quest list has been
 * changed by the caller already (the quest is the main quest now). The
 * facts of now are captured here: a swipe of the montage must start from
 * the same now, not from where the first montage landed.
 * @param {{ quest: string, when?: string }} args
 * @returns {Promise<boolean>} whether a reply was asked for
 */
export async function startQuestCut({ quest, when = '' } = {}) {
    const q = String(quest || '').replace(/\s+/g, ' ').trim().slice(0, MAX_QUEST);
    if (!q) return false;
    setPending({ quest: q, when: cleanWhen(when), at: Date.now(), facts: factsNow() });
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

/**
 * Travel here (D84): arms a cut to the place and asks for the reply. The
 * facts of now are captured here, as for a quest.
 * @param {{ place: string, placeId?: string, when?: string }} args
 * @returns {Promise<boolean>} whether a reply was asked for
 */
export async function startTravelCut({ place, placeId = '', when = '' } = {}) {
    const to = String(place || '').replace(/\s+/g, ' ').trim().slice(0, MAX_PLACE);
    if (!to) return false;
    setPending({ kind: 'travel', place: to, placeId: String(placeId || ''), when: cleanWhen(when), at: Date.now(), facts: factsNow() });
    toast('info', `Travelling to ${to}…`);
    try {
        await executeSlashCommandsOnChatInput('/trigger', { quiet: true });
        return true;
    } catch (e) {
        console.warn('[Dooms Tracker] Travel: the reply could not be asked for', e);
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
    const facts = p.facts && typeof p.facts === 'object' ? p.facts : factsNow();
    if (p.kind === 'travel') return buildTravelInstruction({ place: p.place, when: p.when, userName: resolvePersonaName() || 'the player', facts });
    const quests = normalizeQuests(extensionSettings.quests);
    const others = quests.optional.filter(t => t && t !== 'None' && t !== p.quest).slice(0, 6);
    return buildQuestCutInstruction({ quest: p.quest, when: p.when, userName: resolvePersonaName() || 'the player', facts, otherQuests: others });
}

// ─── The completed quests (D86) ─────────────────────────────────────────────

/** This chat's completed quests, newest first. */
export function getCompletedQuests() {
    const raw = chat_metadata && typeof chat_metadata === 'object' ? chat_metadata[DONE_KEY] : null;
    return normalizeDone(raw);
}

/** A quest completed now (the shelf's Complete): recorded with the tracker's date; "None" and nothing are not recorded. */
export function recordCompletedQuest(text) {
    if (!chat_metadata || typeof chat_metadata !== 'object') return false;
    const r = addDone(chat_metadata[DONE_KEY], text, { at: Date.now(), gameDate: (factsNow() || {}).date || '' });
    if (!r.added) return false;
    chat_metadata[DONE_KEY] = r.list;
    try { saveChatDebounced(); } catch (e) { /* no chat open */ }
    try { window.dispatchEvent(new CustomEvent(QUESTS_DONE_CHANGED_EVENT, { detail: { count: r.list.length } })); } catch (e) { /* no window (tests) */ }
    return true;
}
