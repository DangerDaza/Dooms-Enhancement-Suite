/**
 * Dice rolls — attributes and checks in play (Project Short Fuse, Phase 2).
 *
 * The arithmetic lives in src/utils/d20.js (pure). This module is the part
 * that touches the chat and the settings:
 *
 *   - which characters' attributes the prompt mentions, and when;
 *   - the pending check: the attribute, skill and context the player tagged
 *     the next message with;
 *   - at send: the game master's ruling (one small separate call), the roll,
 *     and the roll on the message it rode with (message.extra.dooms_roll);
 *   - the verdict handed to the next generation, and the box at the top of
 *     the reply that answers the rolled message.
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
    getProficiencies,
    isProficient,
    findSkill,
    isDefaultSheet,
    buildAttributesLine,
    difficultyById,
    buildDifficultyRatingPrompt,
    parseDifficultyRating,
    rollCheck,
    verdictText,
    formatModifier,
    checkLabel,
    outcomeLabel,
    marginWord,
    DEFAULT_SCORE,
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
        out.push({ name: persona, isUser: true, sheet: getSheet(extensionSettings, persona, true, defs), proficiencies: getProficiencies(extensionSettings, persona, true) });
        seen.add(persona.toLowerCase());
    }
    for (const name of committedCharacterNames()) {
        const lower = name.toLowerCase();
        if (seen.has(lower)) continue;
        seen.add(lower);
        out.push({ name, isUser: false, sheet: getSheet(extensionSettings, name, false, defs), proficiencies: getProficiencies(extensionSettings, name, false) });
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
    const proficiencies = getProficiencies(extensionSettings, persona, true);
    // "Default" means nothing worth sending: all 10s and no proficiencies.
    return { name: persona, sheet, defs, proficiencies, isDefault: isDefaultSheet(sheet, defs) && proficiencies.length === 0 };
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
    return buildAttributesLine(getAttributeEntries(), attributeDefs(extensionSettings), { proficiencyBonus: cfg.proficiencyBonus });
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
// One check at a time: the attribute and skill the player picked and the
// line of context they gave. It waits here until the next message is sent,
// when the game master rules, the die is rolled and the roll is written to
// that message; or until it is discarded. Nothing rolls before send, and
// nothing rolls twice.

export const DICE_VERDICT_SLOT = 'dooms-dice-verdict';

let pending = null;
let transport = null;          // test hook: (messages) => Promise<string>
let rulingTimeoutMs = 20000;   // the game master gets this long before the default stands
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

/** Tests shorten the wait for a ruling. */
export function __setRulingTimeout(ms) {
    rulingTimeoutMs = Number.isFinite(ms) && ms > 0 ? ms : 20000;
}

async function defaultTransport(messages) {
    const { safeGenerateRaw } = await import('../../utils/responseExtractor.js');
    return safeGenerateRaw({ prompt: messages, quietToLoud: false });
}

function withTimeout(promise, ms) {
    return new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('timeout')), ms);
        Promise.resolve(promise).then(
            v => { clearTimeout(t); resolve(v); },
            e => { clearTimeout(t); reject(e); },
        );
    });
}

/** The last `count` messages before `before` (the whole chat when -1), one line each. */
function recentChatText(count, { before = -1, truncation = 600 } = {}) {
    const list = chatArray();
    if (!list) return '';
    const persona = resolvePersonaName() || 'Player';
    const upto = before >= 0 ? list.slice(0, before) : list;
    return upto
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

/** A player's fixed ruling in the same shape as the game master's, or null. */
function normalizeOverride(o) {
    if (!o || typeof o !== 'object' || !o.difficultyId) return null;
    const d = difficultyById(extensionSettings, o.difficultyId);
    const adv = o.advantage === 'adv' || o.advantage === 'dis' ? o.advantage : 'none';
    return { difficultyId: d.id, dc: d.dc, label: d.label, advantage: adv, reason: '', source: 'override' };
}

/**
 * Tags the next message with a check. The player's decisions: the
 * attribute, a skill under it (or none, for a plain check) and a line of
 * context for the game master. With the override setting on, a difficulty
 * and advantage may be fixed here instead of asking. Synchronous: nothing
 * is asked and nothing is rolled until the message is sent.
 * Returns the pending check, or null when attributes are off.
 */
export function tagCheck({ attributeId, skill = '', context = '', override = null } = {}) {
    if (!attributesOn(extensionSettings)) return null;
    const defs = attributeDefs(extensionSettings);
    const def = defs.find(d => d.id === attributeId) || defs[0];
    if (!def) return null;
    // Any skill on the list may pair with any attribute (the "Skills with
    // Different Abilities" variant); the proficiency follows the skill.
    const hit = findSkill(defs, skill);
    const skillName = hit ? hit.name : '';
    const persona = getPersonaSheet();
    const cfg = attributesConfig(extensionSettings);
    const proficient = !!hit && !!persona && isProficient(persona.proficiencies, hit.attributeId, hit.name);
    pending = {
        attributeId: def.id,
        attribute: def.name,
        abbr: def.abbr,
        skill: skillName,
        skillAttributeId: hit ? hit.attributeId : '',
        score: persona ? persona.sheet[def.id] : DEFAULT_SCORE,
        proficient,
        prof: proficient ? cfg.proficiencyBonus : 0,
        context: String(context || '').trim().slice(0, 300),
        override: cfg.allowOverride ? normalizeOverride(override) : null,
        rating: false,
        ts: Date.now() + Math.random(),
    };
    notifyDiceChanged({ source: 'tag' });
    return pending;
}

/**
 * Sets or clears the player's fixed ruling on the pending check, only when
 * the setting allows it. Returns the pending check, or null when refused.
 */
export function overrideRuling(override) {
    if (!pending || pending.rating) return null;
    if (!attributesConfig(extensionSettings).allowOverride) return null;
    pending.override = normalizeOverride(override);
    notifyDiceChanged({ source: 'override' });
    return pending;
}

/**
 * The game master's ruling for an attempt: one small separate call that
 * answers with a difficulty word, advantage or disadvantage, and a reason.
 * Falls back to the configured default difficulty when the AI is not asked,
 * cannot be reached, takes too long, or cannot be read; `source` and
 * `error` say which happened.
 */
export async function rateAttempt({ attributeId, skill = '', context = '', messageText = '', beforeIndex = -1 } = {}) {
    const cfg = attributesConfig(extensionSettings);
    const def = attributeDefs(extensionSettings).find(d => d.id === attributeId);
    if (!cfg.aiRatesDifficulty || !def) return defaultRuling();
    // A borrowed skill is named with its home so the game master knows the
    // pairing is the player's call under the variant rule.
    const home = skill ? findSkill(attributeDefs(extensionSettings), skill) : null;
    const homeDef = home && home.attributeId !== def.id ? attributeDefs(extensionSettings).find(d => d.id === home.attributeId) : null;
    const prompt = buildDifficultyRatingPrompt({
        userName: resolvePersonaName() || 'The player',
        attempt: context,
        attributeName: def.name,
        skillName: homeDef ? `${skill}, normally a ${homeDef.name} skill` : skill,
        messageText,
        recentText: recentChatText(cfg.contextMessages, { before: beforeIndex }),
    });
    try {
        const text = await withTimeout((transport || defaultTransport)([
            { role: 'system', content: prompt.system },
            { role: 'user', content: prompt.user },
        ]), rulingTimeoutMs);
        const parsed = parseDifficultyRating(text, extensionSettings);
        if (parsed) return { ...parsed, source: 'ai' };
        return { ...defaultRuling(), error: 'unreadable' };
    } catch (e) {
        console.warn('[Dooms Tracker] Dice: the difficulty call failed, using the default', e);
        return { ...defaultRuling(), error: e?.message || String(e) };
    }
}

function performRoll(check, ruling) {
    const cfg = attributesConfig(extensionSettings);
    const result = rollCheck({
        attribute: check.attribute,
        abbr: check.abbr,
        skill: check.skill,
        score: check.score,
        dc: ruling.dc,
        advantage: ruling.advantage,
        criticals: cfg.criticals,
        proficiency: check.prof,
    });
    return {
        ...result,
        attributeId: check.attributeId,
        skillAttributeId: check.skillAttributeId || '',
        difficultyId: ruling.difficultyId,
        difficultyLabel: ruling.label,
        reason: ruling.reason || '',
        rulingSource: ruling.source || 'default',
        rulingError: ruling.error || '',
        attempt: check.context || '',
        ts: Date.now(),
    };
}

// ─── The roll on a message ──────────────────────────────────────────────────

/** Writes a roll to a message and repaints the box on the replies under it. */
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
 * MESSAGE_SENT: the pending check rides with the message just sent. The
 * game master rules now, seeing the message itself (unless the player fixed
 * the ruling), the die is rolled, and the roll is written to the message.
 * SillyTavern awaits this handler, so the reply is generated with the
 * verdict in hand. A check discarded while the game master thinks rolls
 * nothing.
 */
export async function onDiceMessageSent() {
    if (!pending) return;
    const found = findLastUserMessage();
    if (!found) return;
    const check = pending;
    let ruling = check.override;
    if (!ruling) {
        check.rating = true;
        notifyDiceChanged({ source: 'rating' });
        ruling = await rateAttempt({
            attributeId: check.attributeId,
            skill: check.skill,
            context: check.context,
            messageText: typeof found.message.mes === 'string' ? found.message.mes : '',
            beforeIndex: found.index,
        });
        if (pending !== check) return;
    }
    pending = null;
    attachRollToMessage(found.message, performRoll(check, ruling), found.index);
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

// ─── The roll box at the top of the reply ───────────────────────────────────
//
// The roll is stored on the player's message; the box is shown on every
// reply that answers it (each swipe alike, and each reply in a group until
// the next player message), inserted before .mes_text in the reply's
// .mes_block so SillyTavern's own re-renders of the text leave it alone.
// Nothing on it removes the roll: an outcome is final.

const CARD_CLASS = 'dooms-roll-card';

/** The roll a reply at `index` answers: the one on the nearest player message above it, or null. */
export function rollForReply(index) {
    const list = chatArray();
    if (!list || !Number.isFinite(index) || index < 0 || index >= list.length) return null;
    const m = list[index];
    if (!m || m.is_user || m.is_system) return null;
    for (let i = index - 1; i >= 0; i--) {
        const p = list[i];
        if (!p || p.is_system || !p.is_user) continue;
        const r = p.extra?.dooms_roll;
        return r && typeof r === 'object' ? r : null;
    }
    return null;
}

function cardHtml(roll) {
    const cls = [CARD_CLASS, roll.success ? 'is-success' : 'is-failure', roll.critical ? 'is-crit' : ''].filter(Boolean).join(' ');
    const twoDice = roll.advantage !== 'none' && Array.isArray(roll.rolls) && roll.rolls.length === 2;
    const dice = twoDice
        ? `${roll.kept} <small>(${roll.rolls[0]}/${roll.rolls[1]}, ${roll.advantage === 'adv' ? 'advantage' : 'disadvantage'})</small>`
        : `${roll.kept}`;
    const math = `d20 ${dice} ${formatModifier(roll.mod)}${roll.prof ? ` +${roll.prof}` : ''} = <b>${roll.total}</b> vs DC ${roll.dc}${roll.difficultyLabel ? ` (${escapeHtml(roll.difficultyLabel)})` : ''}`;
    const outcome = outcomeLabel(roll) + (roll.critical ? '' : `, ${marginWord(roll.margin)}`);
    let why = '';
    if (roll.rulingSource === 'ai' && roll.reason) why = `“${escapeHtml(roll.reason)}” — the game master`;
    else if (roll.rulingSource === 'override') why = 'Your ruling.';
    else if (roll.rulingError) why = 'The game master could not be asked; the default difficulty stood.';
    const attempt = roll.attempt ? `<span class="dooms-roll-attempt">${escapeHtml(roll.attempt)}</span>` : '';
    const why2 = attempt || why ? `<div class="dooms-roll-why">${attempt}${attempt && why ? ' · ' : ''}${why}</div>` : '';
    return `<div class="${cls}" role="note">
        <div class="dooms-roll-line">
            <span class="dooms-roll-die" aria-hidden="true">🎲</span>
            <span class="dooms-roll-label">${escapeHtml(checkLabel(roll))} check</span>
            <span class="dooms-roll-math">${math}</span>
            <span class="dooms-roll-outcome">${escapeHtml(outcome)}</span>
        </div>
        ${why2}
    </div>`;
}

function syncCardOnReply(messageElement, index) {
    const $block = $(messageElement).find('.mes_block').first();
    if (!$block.length) return;
    const $existing = $block.children(`.${CARD_CLASS}`);
    const roll = extensionSettings.enabled && attributesOn(extensionSettings) ? rollForReply(index) : null;
    if (!roll) {
        $existing.remove();
        return;
    }
    const html = cardHtml(roll);
    if ($existing.length) {
        $existing.first().replaceWith(html);
        return;
    }
    const $text = $block.children('.mes_text').first();
    if ($text.length) $text.before(html);
    else $block.prepend(html);
}

function syncReplyAt(list, i) {
    const el = document.querySelector(`#chat .mes[mesid="${i}"]`);
    if (el && typeof el === 'object' && list[i] && !list[i].is_user) syncCardOnReply(el, i);
}

/**
 * Per-message sync by id (CHARACTER_MESSAGE_RENDERED, MESSAGE_SWIPED, edits,
 * attach): a reply syncs its own box; a player message syncs the replies
 * under it.
 */
export function syncRollCardForMessage(messageId) {
    const list = chatArray();
    const mesId = parseInt(messageId, 10);
    if (!list || !Number.isFinite(mesId) || !list[mesId]) return;
    if (typeof document === 'undefined' || typeof document.querySelector !== 'function') return;
    if (!list[mesId].is_user) {
        syncReplyAt(list, mesId);
        return;
    }
    for (let i = mesId + 1; i < list.length; i++) {
        if (list[i] && list[i].is_user) break;
        syncReplyAt(list, i);
    }
}

/** Full sweep (CHAT_CHANGED, "show more messages", deletions). */
export function updateRollCards() {
    const list = chatArray();
    if (!list || typeof $ !== 'function') return;
    const any = extensionSettings.enabled && attributesOn(extensionSettings) && list.some(m => m && m.extra && m.extra.dooms_roll);
    if (!any) {
        $(`#chat .${CARD_CLASS}`).remove();
        return;
    }
    $('#chat .mes').each(function () {
        const mesId = parseInt($(this).attr('mesid'), 10);
        if (!Number.isFinite(mesId) || !list[mesId] || list[mesId].is_user) return;
        syncCardOnReply(this, mesId);
    });
}

/** CHAT_CHANGED: a pending check belongs to the chat it was tagged in. */
export function onDiceChatChanged() {
    clearPendingCheck({ silent: true });
    try { mountDiceButton(); } catch (e) { /* no DOM */ }
    try { updateRollCards(); } catch (e) { /* no DOM */ }
    notifyDiceChanged({ source: 'chat' });
}

/** Mounts the button and listens once. Safe without jQuery (tests). */
export function initDiceRolls() {
    try { mountDiceButton(); } catch (e) { /* no send form yet */ }
    if (listenersBound || typeof window === 'undefined' || typeof window.addEventListener !== 'function') return;
    listenersBound = true;
    window.addEventListener(DICE_CHANGED_EVENT, () => { try { refreshDiceEntryPoints(); } catch (e) { /* no DOM */ } });
}

// ─── Entry point in the message row ─────────────────────────────────────────
//
// A d20 button beside SillyTavern's own left-hand buttons, under every look
// (the DES composer keeps DES's own buttons in the row). Shown only while
// attributes are on. The popover loads on first click.

const BUTTON_ID = 'dooms-dice-btn';

function openPanelLazily() {
    import('../ui/dicePanel.js')
        .then(m => m.openDicePanel())
        .catch(err => console.error('[Dooms Tracker] Dice panel failed to load:', err));
}

/** Adds the button once; safe to call again. */
export function mountDiceButton() {
    if (typeof document === 'undefined' || typeof document.getElementById !== 'function') return;
    if (document.getElementById(BUTTON_ID)) { refreshDiceEntryPoints(); return; }
    const left = document.getElementById('leftSendForm');
    if (!left || typeof left.appendChild !== 'function') return;
    const btn = document.createElement('div');
    btn.id = BUTTON_ID;
    btn.className = 'dooms-dice-btn fa-solid fa-dice-d20 interactable';
    btn.title = 'Roll a check';
    btn.setAttribute('role', 'button');
    btn.setAttribute('tabindex', '0');
    btn.addEventListener('click', (e) => { e.preventDefault(); openPanelLazily(); });
    btn.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openPanelLazily(); } });
    const wand = document.getElementById('extensionsMenuButton');
    if (wand && wand.parentElement === left) wand.after(btn);
    else left.appendChild(btn);
    refreshDiceEntryPoints();
}

/** Shows or hides the button with the attributes switch. */
export function refreshDiceEntryPoints() {
    if (typeof document === 'undefined' || typeof document.getElementById !== 'function') return;
    const btn = document.getElementById(BUTTON_ID);
    if (!btn || !btn.style) return;
    const on = !!extensionSettings.enabled && attributesOn(extensionSettings);
    btn.style.display = on ? '' : 'none';
    btn.classList.toggle('is-pending', on && !!pending);
}
