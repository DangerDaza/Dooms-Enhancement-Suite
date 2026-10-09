/**
 * Dice rolls — attributes and checks in play (Project Short Fuse, Phase 2).
 *
 * The arithmetic lives in src/utils/d20.js (pure). This module is the part
 * that touches the chat and the settings:
 *
 *   - which characters' attributes the prompt mentions, and when;
 *   - the pending check: the attribute the player tagged, the game master's
 *     ruling (one small separate call), and the roll once it happens;
 *   - the roll on the message it rode with (message.extra.dooms_roll), the
 *     verdict handed to the next generation, and the card under the message.
 *
 * It imports no UI module. The popover (src/systems/ui/dicePanel.js) and the
 * shelf listen for DICE_CHANGED_EVENT instead.
 */
import { getContext } from '../../../../../../extensions.js';
import { chat, saveChatDebounced } from '../../../../../../../script.js';
import { extensionSettings, committedTrackerData, lastGeneratedData } from '../../core/state.js';
import { parseTrackerJson } from '../../utils/trackerParse.js';
import {
    attributesConfig,
    attributesOn,
    attributeDefs,
    getSheet,
    isDefaultSheet,
    buildAttributesLine,
} from '../../utils/d20.js';

export const DICE_CHANGED_EVENT = 'dooms:dice-changed';

// ─── Who ────────────────────────────────────────────────────────────────────

/**
 * The player's character as attributes see it: the Workshop's active user
 * character when one resolves (manual pick → persona link → the only one),
 * otherwise SillyTavern's persona name. Mirrors portraitBar's resolver so
 * this module stays free of UI imports.
 */
export function resolvePersonaName() {
    const s = extensionSettings || {};
    const userMap = s.userCharacters && typeof s.userCharacters === 'object' ? s.userCharacters : {};
    if (s.activeUserCharacter && userMap[s.activeUserCharacter]) return s.activeUserCharacter;
    let avatar = '';
    try { avatar = getContext().user_avatar || ''; } catch (e) { avatar = ''; }
    if (avatar) {
        for (const [name, entry] of Object.entries(userMap)) {
            if (entry && entry.linkedPersona === avatar) return name;
        }
    }
    const names = Object.keys(userMap);
    if (names.length === 1) return names[0];
    try {
        const n = String(getContext().name1 || '').trim();
        return n || null;
    } catch (e) {
        return null;
    }
}

function committedCharacterNames() {
    const raw = committedTrackerData.characterThoughts || lastGeneratedData.characterThoughts;
    if (!raw) return [];
    const parsed = parseTrackerJson(raw);
    const list = Array.isArray(parsed) ? parsed : (parsed && Array.isArray(parsed.characters) ? parsed.characters : []);
    const out = [];
    for (const c of list) {
        const name = c && typeof c.name === 'string' ? c.name.trim() : '';
        if (name) out.push(name);
    }
    return out;
}

/**
 * The characters whose attributes the prompt may mention: the persona first,
 * then the NPCs in the committed tracker data. Each entry carries its sheet.
 * @returns {Array<{ name: string, isUser: boolean, sheet: object }>}
 */
export function getAttributeEntries() {
    if (!attributesOn(extensionSettings)) return [];
    const defs = attributeDefs(extensionSettings);
    const out = [];
    const seen = new Set();
    const persona = resolvePersonaName();
    if (persona) {
        out.push({ name: persona, isUser: true, sheet: getSheet(extensionSettings, persona, true, defs) });
        seen.add(persona.toLowerCase());
    }
    for (const name of committedCharacterNames()) {
        const lower = name.toLowerCase();
        if (seen.has(lower)) continue;
        seen.add(lower);
        out.push({ name, isUser: false, sheet: getSheet(extensionSettings, name, false, defs) });
    }
    return out;
}

/** The persona's own sheet, or null when attributes are off. */
export function getPersonaSheet() {
    if (!attributesOn(extensionSettings)) return null;
    const persona = resolvePersonaName();
    if (!persona) return null;
    const defs = attributeDefs(extensionSettings);
    const sheet = getSheet(extensionSettings, persona, true, defs);
    return { name: persona, sheet, defs, isDefault: isDefaultSheet(sheet, defs) };
}

// ─── The roll on a message ──────────────────────────────────────────────────

function chatArray() {
    if (Array.isArray(chat)) return chat;
    try {
        const c = getContext().chat;
        return Array.isArray(c) ? c : null;
    } catch (e) {
        return null;
    }
}

/**
 * The last user message in the chat (the streaming placeholder and any reply
 * after it are skipped), with its index.
 * @returns {{ message: object, index: number }|null}
 */
export function findLastUserMessage() {
    const list = chatArray();
    if (!list) return null;
    for (let i = list.length - 1; i >= 0; i--) {
        const m = list[i];
        if (m && m.is_user && !m.is_system) return { message: m, index: i };
    }
    return null;
}

/**
 * The roll the next generation answers: the one on the last user message,
 * whether that message is the chat's tail (a fresh reply) or sits under a
 * reply being swiped, regenerated or continued. Null when there is none.
 */
export function getRollForGeneration() {
    const found = findLastUserMessage();
    const roll = found?.message?.extra?.dooms_roll;
    return roll && typeof roll === 'object' ? roll : null;
}

// ─── Prompt ─────────────────────────────────────────────────────────────────

/**
 * The read-only attributes line for this generation, or '' when attributes
 * are off, nobody has a sheet worth sending, or the setting keeps them out:
 * 'always' sends them every turn, 'withRoll' only on a turn that answers a
 * rolled message, 'never' never.
 */
export function buildAttributesLineForPrompt() {
    if (!attributesOn(extensionSettings)) return '';
    const cfg = attributesConfig(extensionSettings);
    if (cfg.sendToAI === 'never') return '';
    if (cfg.sendToAI === 'withRoll' && !getRollForGeneration()) return '';
    return buildAttributesLine(getAttributeEntries(), attributeDefs(extensionSettings));
}

/** Tells open dice views (the popover, the chip, the cards) to repaint. */
export function notifyDiceChanged(detail = {}) {
    try {
        window.dispatchEvent(new CustomEvent(DICE_CHANGED_EVENT, { detail }));
    } catch (e) { /* no window (tests) */ }
}

/** Saves the chat after a roll is written to or removed from a message. */
export function saveRollChange() {
    try { saveChatDebounced(); } catch (e) { /* no chat open */ }
}
