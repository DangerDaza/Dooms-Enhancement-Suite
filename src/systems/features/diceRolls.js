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
import { escapeHtml } from '../../utils/html.js';
import {
    attributesConfig,
    attributesOn,
    attributeDefs,
    getSheet,
    isDefaultSheet,
    buildAttributesLine,
    difficultyById,
    buildDifficultyRatingPrompt,
    parseDifficultyRating,
    rollCheck,
    verdictText,
    formatRollShort,
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

// ─── The pending check ──────────────────────────────────────────────────────
//
// One check at a time: the attribute the player tagged, the game master's
// ruling once it arrives, and the roll once it happens. It lives here until
// it is written to a message (on send, or at once with Roll now when the
// chat's tail is already the player's message) or discarded.

export const DICE_VERDICT_SLOT = 'dooms-dice-verdict';

let pending = null;
let transport = null;   // test hook: (messages) => Promise<string>
let listenersBound = false;

/** The check waiting for a message, or null. Read-only to callers. */
export function getPendingCheck() {
    return pending;
}

/** Drops the pending check. */
export function clearPendingCheck({ silent = false } = {}) {
    if (!pending) return;
    pending = null;
    if (!silent) notifyDiceChanged({ source: 'clear' });
}

/** Tests replace the model call; nothing else should. */
export function __setDiceTransport(fn) {
    transport = typeof fn === 'function' ? fn : null;
}

async function defaultTransport(messages) {
    const { safeGenerateRaw } = await import('../../utils/responseExtractor.js');
    return safeGenerateRaw({ prompt: messages, quietToLoud: false });
}

function draftText() {
    try {
        const el = typeof document !== 'undefined' && typeof document.getElementById === 'function'
            ? document.getElementById('send_textarea')
            : null;
        const v = el ? el.value : '';
        return typeof v === 'string' ? v : '';
    } catch (e) {
        return '';
    }
}

function recentChatText(count, truncation = 600) {
    const list = chatArray();
    if (!list) return '';
    const persona = resolvePersonaName() || 'Player';
    return list
        .filter(m => m && !m.is_system && typeof m.mes === 'string' && m.mes !== '...')
        .slice(-Math.max(1, count))
        .map(m => `${m.is_user ? persona : (m.name || 'AI')}: ${m.mes.substring(0, truncation)}`)
        .join('\n');
}

function defaultRuling() {
    const cfg = attributesConfig(extensionSettings);
    const d = difficultyById(extensionSettings, cfg.defaultDifficulty);
    return { difficultyId: d.id, dc: d.dc, label: d.label, advantage: 'none', reason: '', source: 'default' };
}

/**
 * The game master's ruling for an attempt: one small separate call that
 * answers with a difficulty word, advantage or disadvantage, and a reason.
 * Falls back to the configured default difficulty when the AI is not asked,
 * cannot be reached, or cannot be read; `source` says which happened.
 */
export async function rateAttempt({ attributeId, attempt = '' } = {}) {
    const cfg = attributesConfig(extensionSettings);
    const def = attributeDefs(extensionSettings).find(d => d.id === attributeId);
    if (!cfg.aiRatesDifficulty || !def) return defaultRuling();
    const prompt = buildDifficultyRatingPrompt({
        userName: resolvePersonaName() || 'The player',
        attempt,
        attributeName: def.name,
        recentText: recentChatText(cfg.contextMessages),
    });
    try {
        const text = await (transport || defaultTransport)([
            { role: 'system', content: prompt.system },
            { role: 'user', content: prompt.user },
        ]);
        const parsed = parseDifficultyRating(text, extensionSettings);
        if (parsed) return { ...parsed, source: 'ai' };
        return { ...defaultRuling(), error: 'unreadable' };
    } catch (e) {
        console.warn('[Dooms Tracker] Dice: the difficulty call failed, using the default', e);
        return { ...defaultRuling(), error: e?.message || String(e) };
    }
}

/**
 * Tags the next message with a check: records the attribute (the player's
 * one decision), then asks the game master. Resolves when the ruling is in
 * (or the default stood in). Returns the pending check, or null when
 * attributes are off.
 */
export async function tagCheck({ attributeId, attempt = '' } = {}) {
    if (!attributesOn(extensionSettings)) return null;
    const defs = attributeDefs(extensionSettings);
    const def = defs.find(d => d.id === attributeId) || defs[0];
    if (!def) return null;
    const persona = getPersonaSheet();
    const check = {
        attributeId: def.id,
        attribute: def.name,
        abbr: def.abbr,
        score: persona ? persona.sheet[def.id] : 10,
        attempt: String(attempt || draftText()).trim().slice(0, 300),
        ruling: null,
        rating: true,
        roll: null,
        mode: 'onSend',
        ts: Date.now() + Math.random(),
    };
    pending = check;
    notifyDiceChanged({ source: 'tag' });
    const ruling = await rateAttempt({ attributeId: def.id, attempt: check.attempt });
    if (pending !== check) return pending;   // discarded or re-tagged meanwhile
    check.ruling = ruling;
    check.rating = false;
    notifyDiceChanged({ source: 'ruling' });
    return check;
}

/** Asks the game master again, with whatever the message box holds now. */
export async function reRateCheck() {
    if (!pending || pending.roll) return pending;
    const check = pending;
    check.attempt = String(draftText()).trim().slice(0, 300) || check.attempt;
    check.rating = true;
    notifyDiceChanged({ source: 'tag' });
    const ruling = await rateAttempt({ attributeId: check.attributeId, attempt: check.attempt });
    if (pending !== check) return pending;
    check.ruling = ruling;
    check.rating = false;
    notifyDiceChanged({ source: 'ruling' });
    return check;
}

/**
 * The player's override of the ruling, only when the setting allows it.
 * Returns the pending check, or null when refused.
 */
export function overrideRuling({ difficultyId, advantage } = {}) {
    if (!pending || pending.roll) return null;
    if (!attributesConfig(extensionSettings).allowOverride) return null;
    const d = difficultyById(extensionSettings, difficultyId);
    const adv = advantage === 'adv' || advantage === 'dis' ? advantage : 'none';
    pending.ruling = { difficultyId: d.id, dc: d.dc, label: d.label, advantage: adv, reason: pending.ruling?.reason || '', source: 'override' };
    pending.rating = false;
    notifyDiceChanged({ source: 'ruling' });
    return pending;
}

function performRoll(check) {
    const cfg = attributesConfig(extensionSettings);
    const ruling = check.ruling || defaultRuling();
    const result = rollCheck({
        attribute: check.attribute,
        abbr: check.abbr,
        score: check.score,
        dc: ruling.dc,
        advantage: ruling.advantage,
        criticals: cfg.criticals,
    });
    return {
        ...result,
        attributeId: check.attributeId,
        difficultyId: ruling.difficultyId,
        difficultyLabel: ruling.label,
        reason: ruling.reason || '',
        rulingSource: ruling.source || 'default',
        attempt: check.attempt || '',
        ts: Date.now(),
    };
}

/** Writes a roll to a message and repaints its card. */
export function attachRollToMessage(message, roll, index = -1) {
    if (!message || typeof message !== 'object' || !roll) return false;
    if (!message.extra || typeof message.extra !== 'object') message.extra = {};
    message.extra.dooms_roll = roll;
    saveRollChange();
    const list = chatArray();
    const idx = index >= 0 ? index : (list ? list.indexOf(message) : -1);
    if (idx >= 0) syncRollCardForMessage(idx);
    notifyDiceChanged({ source: 'attached', index: idx });
    return true;
}

/**
 * Rolls the pending check now. When the chat's tail is the player's own
 * message with no reply yet, the roll attaches to it at once and the
 * pending check is done; otherwise the roll waits for the next message.
 * Returns the roll, or null when there is nothing to roll yet.
 */
export function rollNow() {
    if (!pending || pending.rating) return null;
    if (!pending.ruling) pending.ruling = defaultRuling();
    pending.roll = performRoll(pending);
    pending.mode = 'now';
    const list = chatArray();
    const tail = list && list.length ? list[list.length - 1] : null;
    if (tail && tail.is_user && !tail.is_system) {
        const roll = pending.roll;
        const check = pending;
        pending = null;
        attachRollToMessage(tail, roll, list.length - 1);
        return check.roll;
    }
    notifyDiceChanged({ source: 'rolled' });
    return pending.roll;
}

/**
 * MESSAGE_SENT: the pending check rides with the message just sent. A check
 * that was tagged but not rolled is rolled now (with the ruling in hand, or
 * the default when the game master has not answered yet).
 */
export function onDiceMessageSent() {
    if (!pending) return;
    const found = findLastUserMessage();
    if (!found) return;
    const check = pending;
    if (!check.ruling) check.ruling = defaultRuling();
    if (!check.roll) check.roll = performRoll(check);
    pending = null;
    attachRollToMessage(found.message, check.roll, found.index);
}

/**
 * The verdict the next generation is handed, or '' when the last user
 * message carries no roll. Called by the injector on every generation, so
 * swipes and regenerates narrate the same outcome.
 */
export function buildDiceVerdictForGeneration() {
    if (!attributesOn(extensionSettings)) return '';
    const roll = getRollForGeneration();
    if (!roll) return '';
    return verdictText(roll, {
        userName: resolvePersonaName() || 'The player',
        attempt: roll.attempt,
        difficultyLabel: roll.difficultyLabel,
        reason: roll.reason,
    });
}

// ─── The roll card under the message ────────────────────────────────────────

const CARD_CLASS = 'dooms-roll-card';

function cardHtml(mesId, roll) {
    const cls = [CARD_CLASS, roll.success ? 'is-success' : 'is-failure', roll.critical ? 'is-crit' : ''].filter(Boolean).join(' ');
    const ruling = roll.difficultyLabel
        ? `<span class="dooms-roll-ruling">${escapeHtml(roll.difficultyLabel)}${roll.reason ? ` · ${escapeHtml(roll.reason)}` : ''}</span>`
        : '';
    const tip = roll.attempt ? `Attempt: ${roll.attempt}` : 'Roll attached to this message';
    return `<div class="${cls}" data-mesid="${escapeHtml(String(mesId))}" title="${escapeHtml(tip)}">
        <span class="dooms-roll-die" aria-hidden="true">🎲</span>
        <span class="dooms-roll-text">${escapeHtml(formatRollShort(roll))}</span>
        ${ruling}
        <button type="button" class="dooms-roll-remove" title="Remove this roll from the message">&times;</button>
    </div>`;
}

function syncRollCardOnElement(messageElement, message, mesId) {
    const $block = $(messageElement).find('.mes_block');
    if (!$block.length) return;
    const $existing = $block.find(`.${CARD_CLASS}`);
    const roll = extensionSettings.enabled ? message?.extra?.dooms_roll : null;
    if (!roll || typeof roll !== 'object') {
        $existing.remove();
        return;
    }
    const html = cardHtml(mesId, roll);
    if ($existing.length) $existing.replaceWith(html);
    else $block.append(html);
}

/** Per-message sync by id (USER_MESSAGE_RENDERED, edits, attach). */
export function syncRollCardForMessage(messageId) {
    const list = chatArray();
    const mesId = parseInt(messageId, 10);
    if (!list || !Number.isFinite(mesId)) return;
    const el = typeof document !== 'undefined' && typeof document.querySelector === 'function'
        ? document.querySelector(`#chat .mes[mesid="${mesId}"]`)
        : null;
    if (el && typeof el === 'object') syncRollCardOnElement(el, list[mesId], mesId);
}

/** Full sweep (CHAT_CHANGED, "show more messages", deletions). */
export function updateRollCards() {
    const list = chatArray();
    if (!list || typeof $ !== 'function') return;
    const any = extensionSettings.enabled && list.some(m => m && m.extra && m.extra.dooms_roll);
    if (!any) {
        $(`#chat .${CARD_CLASS}`).remove();
        return;
    }
    $('#chat .mes').each(function () {
        const mesId = parseInt($(this).attr('mesid'), 10);
        if (!Number.isFinite(mesId)) return;
        syncRollCardOnElement(this, list[mesId], mesId);
    });
}

/** Removes the roll from a message. The reply already written is left alone. */
export function removeRollFromMessage(messageId) {
    const list = chatArray();
    const mesId = parseInt(messageId, 10);
    const message = list && Number.isFinite(mesId) ? list[mesId] : null;
    if (!message || !message.extra || !message.extra.dooms_roll) return false;
    delete message.extra.dooms_roll;
    saveRollChange();
    syncRollCardForMessage(mesId);
    notifyDiceChanged({ source: 'removed', index: mesId });
    return true;
}

/** CHAT_CHANGED: a pending check belongs to the chat it was tagged in. */
export function onDiceChatChanged() {
    clearPendingCheck({ silent: true });
    try { updateRollCards(); } catch (e) { /* no DOM */ }
    notifyDiceChanged({ source: 'chat' });
}

/** Binds the card's remove button once. Safe without jQuery (tests). */
export function initDiceRolls() {
    if (listenersBound || typeof $ !== 'function') return;
    listenersBound = true;
    $(document).on('click', `.${CARD_CLASS} .dooms-roll-remove`, function (e) {
        e.preventDefault();
        e.stopPropagation();
        const mesId = $(this).closest(`.${CARD_CLASS}`).attr('data-mesid');
        removeRollFromMessage(mesId);
    });
}
