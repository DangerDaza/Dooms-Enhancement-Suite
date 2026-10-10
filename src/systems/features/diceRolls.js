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
    parseCheckCall,
    resolveCheckCall,
    buildCheckCallInstruction,
    buildToolCallInstruction,
    buildDiceToolDefinition,
    DICE_TOOL_NAME,
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

/** The read-only attributes line, or '' when nobody has a sheet worth sending. */
function attributesLine() {
    const cfg = attributesConfig(extensionSettings);
    return buildAttributesLine(getAttributeEntries(), attributeDefs(extensionSettings), { proficiencyBonus: cfg.proficiencyBonus });
}

/**
 * The attributes line for the tracker block, or ''. Only the 'always'
 * setting puts it there: the block is built when generation starts, which
 * SillyTavern fires before the sent message (and its roll) exists, so the
 * 'withRoll' line rides in the dice slot with the verdict instead
 * (buildDiceVerdictForGeneration). 'never' never.
 */
export function buildAttributesLineForPrompt() {
    if (!attributesOn(extensionSettings)) return '';
    if (attributesConfig(extensionSettings).sendToAI !== 'always') return '';
    return attributesLine();
}

/** Tells open dice views (the popover, the chip, the cards) to repaint. */
export function notifyDiceChanged(detail = {}) {
    try {
        window.dispatchEvent(new CustomEvent(DICE_CHANGED_EVENT, { detail }));
    } catch (e) { /* no window (tests) */ }
}

/**
 * A dice event the player can see while trying the system: always a
 * console line, and a toast while Settings → Stats → Notify on dice events
 * is on (toasts also land in DES's Notification Log).
 */
export function diceNotice(text, { kind = 'info', title = 'Dice' } = {}) {
    try { console.debug(`[Dooms Tracker] Dice: ${text}`); } catch (e) { /* no console */ }
    if (!attributesConfig(extensionSettings).notify) return;
    try {
        const t = typeof window !== 'undefined' ? window.toastr : null;
        if (t && typeof t[kind] === 'function') t[kind](text, title, { timeOut: 6000, escapeHtml: true });
    } catch (e) { /* no toastr */ }
}

/** A roll in one line for notices. */
function rollLine(roll) {
    const who = roll.isUser === false ? `${roll.who}: ` : '';
    const dice = roll.advantage !== 'none' && Array.isArray(roll.rolls) && roll.rolls.length === 2 ? `${roll.kept} (${roll.rolls.join('/')})` : String(roll.kept);
    return `${who}${checkLabel(roll)} · d20 ${dice} ${formatModifier(roll.mod)}${roll.prof ? ` +${roll.prof}` : ''} = ${roll.total} vs DC ${roll.dc}${roll.difficultyLabel ? ` (${roll.difficultyLabel})` : ''} · ${outcomeLabel(roll)}`;
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
export function tagCheck({ attributeId, skill = '', context = '', override = null, gmRuling = null, fromIndex = -1 } = {}) {
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
        who: persona ? persona.name : (resolvePersonaName() || 'The player'),
        isUser: true,
        override: cfg.allowOverride ? normalizeOverride(override) : null,
        // A ruling the game master made when it called for this check.
        gmRuling: gmRuling && typeof gmRuling === 'object' ? { ...gmRuling } : null,
        calledBy: gmRuling ? 'gm' : 'player',
        fromIndex: Number.isFinite(fromIndex) ? fromIndex : -1,
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
        who: check.who || resolvePersonaName() || 'The player',
        isUser: check.isUser !== false,
        calledBy: check.calledBy || 'player',
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
    let ruling = check.override || check.gmRuling;
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
        const adv = ruling.advantage === 'adv' ? ', advantage' : ruling.advantage === 'dis' ? ', disadvantage' : '';
        diceNotice(ruling.source === 'ai'
            ? `Game master rules ${ruling.label} (DC ${ruling.dc})${adv}${ruling.reason ? `: ${ruling.reason}` : ''}`
            : `Default difficulty ${ruling.label} (DC ${ruling.dc})${ruling.error ? ` (the game master could not be asked: ${ruling.error})` : ''}`);
    }
    pending = null;
    const roll = performRoll(check, ruling);
    attachRollToMessage(found.message, roll, found.index);
    diceNotice(`Rolled on send · ${rollLine(roll)}`, { kind: roll.success ? 'success' : 'warning' });
}

/**
 * What the dice slot holds for the next generation: the verdict for the
 * last user message's roll (and, with "Send scores to the AI" = with a
 * roll, the attributes line ahead of it), or '' when that message carries
 * no roll. Derived from the chat, so swipes and regenerates narrate the
 * same outcome. Set by the injector when generation starts and again right
 * after a roll is attached on send: SillyTavern fires generation-started
 * before the sent message exists, so the first pass sees the previous
 * message and only the second can see the roll.
 */
export function buildDiceVerdictForGeneration() {
    if (!attributesOn(extensionSettings)) return '';
    const found = findLastUserMessage();
    if (!found) return '';
    // The game master's NPC checks from the end of the previous reply, then
    // the player's own roll on their message.
    const rolls = [...npcRollsBefore(found.index)];
    const own = found.message.extra?.dooms_roll;
    if (own && typeof own === 'object') rolls.push(own);
    if (!rolls.length) return '';
    const parts = [];
    if (attributesConfig(extensionSettings).sendToAI === 'withRoll') {
        const line = attributesLine();
        if (line) parts.push(line);
    }
    for (const roll of rolls) parts.push(verdictFor(roll));
    return parts.join('\n');
}

/** One roll's verdict, framed for who rolled and who asked. */
function verdictFor(roll) {
    const who = roll.who || resolvePersonaName() || 'The player';
    let framing = '';
    if (roll.isUser === false) {
        framing = `${who}, on a check you called for`;
    } else if (roll.calledBy === 'gm' || roll.calledBy === 'tool') {
        framing = `${who} attempts ${roll.attempt ? `"${String(roll.attempt).trim()}"` : 'the action in their last message'}, on a check you called for`;
    }
    return verdictText(roll, {
        userName: who,
        attempt: roll.attempt,
        difficultyLabel: roll.difficultyLabel,
        reason: roll.reason,
        framing,
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

/**
 * The rolls a reply at `index` answers: the one on the nearest player
 * message above it, then any the dice tool made on the way to this reply
 * (kept on SillyTavern's tool-call messages in between). [] when none.
 */
export function rollsForReply(index) {
    const list = chatArray();
    if (!list || !Number.isFinite(index) || index < 0 || index >= list.length) return [];
    const m = list[index];
    if (!m || m.is_user || m.is_system) return [];
    const tool = [];
    let i = index - 1;
    for (; i >= 0; i--) {
        const p = list[i];
        if (!p) continue;
        if (p.is_user) break;
        if (p.is_system && Array.isArray(p.extra?.tool_invocations)) {
            // Walking back message by message; within a message, in the order the model called.
            const here = p.extra.tool_invocations
                .filter(inv => inv && inv.name === DICE_TOOL_NAME && inv.dooms_roll && typeof inv.dooms_roll === 'object')
                .map(inv => inv.dooms_roll);
            tool.unshift(...here);
        }
    }
    const out = [];
    if (i >= 0) {
        const r = list[i].extra?.dooms_roll;
        if (r && typeof r === 'object') out.push(r);
    }
    return out.concat(tool);
}

function cardHtml(roll) {
    const cls = [CARD_CLASS, roll.success ? 'is-success' : 'is-failure', roll.critical ? 'is-crit' : ''].filter(Boolean).join(' ');
    const whoLabel = roll.isUser === false ? `${escapeHtml(roll.who || 'NPC')}: ` : '';
    const asked = roll.calledBy === 'gm' || roll.calledBy === 'tool' ? ' <small>(the game master called for it)</small>' : '';
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
            <span class="dooms-roll-label">${whoLabel}${escapeHtml(checkLabel(roll))} check${asked}</span>
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
    const rolls = extensionSettings.enabled && attributesOn(extensionSettings) ? rollsForReply(index) : [];
    $existing.remove();
    if (!rolls.length) return;
    const html = rolls.map(cardHtml).join('');
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
    const any = extensionSettings.enabled && attributesOn(extensionSettings)
        && list.some(m => m && m.extra && (m.extra.dooms_roll || m.extra.dooms_gm_calls || (Array.isArray(m.extra.tool_invocations) && m.extra.tool_invocations.some(inv => inv && inv.dooms_roll))));
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
    // A call the game master made at the end of the chat's last reply is
    // still waiting for the player's next message.
    try {
        const list = chatArray();
        if (list && list.length && !list[list.length - 1].is_user) onDiceReplyRendered(list.length - 1);
    } catch (e) { /* no chat */ }
    notifyDiceChanged({ source: 'chat' });
}

/** Mounts the button and listens once. Safe without jQuery (tests). */
export function initDiceRolls() {
    try { mountDiceButton(); } catch (e) { /* no send form yet */ }
    try { registerDiceTool(); } catch (e) { /* no ToolManager */ }
    if (listenersBound || typeof window === 'undefined' || typeof window.addEventListener !== 'function') return;
    listenersBound = true;
    window.addEventListener(DICE_CHANGED_EVENT, () => { try { refreshDiceEntryPoints(); } catch (e) { /* no DOM */ } });
}

// ─── The game master's own calls (Phase 3) ──────────────────────────────────
//
// The AI may call for a check two ways. At the end of a reply, a
// "[CHECK: ...]" line: for the player it becomes a pending check that rolls
// when they send (they can decline it on the chip); for an NPC it is rolled
// at once, kept with that reply (per swipe), and handed to the next
// generation as a verdict. With tool calling, the dooms_roll_check tool:
// the game rolls on the sheet and the result goes straight back into the
// model's context, final. The same call for the same player message rolls
// once, so a swipe never re-rolls.

export const DICE_RULES_SLOT = 'dooms-dice-rules';

/** Who a call is about: the player when `who` is empty or names them, else an NPC by name. */
function resolveRoller(who) {
    const persona = resolvePersonaName();
    const w = String(who || '').trim();
    const isPlayer = !w
        || (persona && w.toLowerCase() === persona.toLowerCase())
        || /^(?:the )?(?:player|user|you)$/i.test(w);
    if (isPlayer) return { name: persona || 'The player', isUser: true };
    return { name: w, isUser: false };
}

/** A call plus the roller's sheet, in the shape onDiceMessageSent and performRoll expect. */
function checkFromCall(call, roller) {
    const defs = attributeDefs(extensionSettings);
    const cfg = attributesConfig(extensionSettings);
    const sheet = getSheet(extensionSettings, roller.name, roller.isUser, defs);
    const profs = getProficiencies(extensionSettings, roller.name, roller.isUser);
    const proficient = !!call.skill && isProficient(profs, call.skillAttributeId || call.attributeId, call.skill);
    return {
        attributeId: call.attributeId,
        attribute: call.attribute,
        abbr: call.abbr,
        skill: call.skill,
        skillAttributeId: call.skillAttributeId || '',
        score: sheet[call.attributeId] ?? DEFAULT_SCORE,
        proficient,
        prof: proficient ? cfg.proficiencyBonus : 0,
        context: '',
        who: roller.name,
        isUser: roller.isUser,
        calledBy: 'gm',
        gmRuling: {
            difficultyId: call.difficultyId,
            dc: call.dc,
            label: call.label,
            advantage: call.advantage,
            reason: call.reason,
            source: call.difficultySource === 'ai' ? 'gm' : 'default',
        },
        override: null,
        rating: false,
        ts: Date.now() + Math.random(),
    };
}

function sameCall(a, b) {
    return !!a && !!b && a.attributeId === b.attributeId && a.skill === b.skill && a.difficultyId === b.difficultyId
        && a.advantage === b.advantage && String(a.who || '').toLowerCase() === String(b.who || '').toLowerCase();
}

function gmCallStore(message) {
    const s = message?.extra?.dooms_gm_calls;
    return s && typeof s === 'object' ? s : {};
}

/**
 * CHARACTER_MESSAGE_RENDERED, MESSAGE_SWIPED, MESSAGE_UPDATED: reads the
 * reply for a "[CHECK: ...]" call. A player's check becomes the pending
 * check (when the reply is the chat's tail); an NPC's is rolled now and
 * kept on the reply for its swipe. A reply without a call withdraws what it
 * had. The tag in the shown text becomes a line saying what was called.
 */
export function onDiceReplyRendered(messageId) {
    const list = chatArray();
    const i = parseInt(messageId, 10);
    const m = list && Number.isFinite(i) ? list[i] : null;
    if (!m || m.is_user || m.is_system) return;
    const cfg = attributesConfig(extensionSettings);
    const on = !!extensionSettings.enabled && attributesOn(extensionSettings) && cfg.aiCalls.enabled && cfg.aiCalls.endOfReply;
    const swipeId = m.swipe_id || 0;
    const call = on ? parseCheckCall(typeof m.mes === 'string' ? m.mes : '', extensionSettings) : null;
    const store = gmCallStore(m);
    const prev = store[swipeId] || null;
    const isLast = i === list.length - 1;
    let changed = false;
    if (!call) {
        if (prev) { delete store[swipeId]; changed = true; }
        if (pending && pending.calledBy === 'gm' && pending.fromIndex === i) clearPendingCheck();
    } else {
        const roller = resolveRoller(cfg.aiCalls.npcs ? call.who : '');
        if (roller.isUser) {
            if (!prev || prev.kind !== 'player' || !sameCall(prev.call, call)) { store[swipeId] = { kind: 'player', call }; changed = true; }
            // A check the player tagged themselves is theirs; otherwise the
            // game master's call waits on the chip for their next message.
            if (isLast && (!pending || pending.calledBy === 'gm')) {
                const fresh = !pending || pending.fromIndex !== i || !sameCall({ ...pending, who: '' }, { ...call, who: '' });
                pending = { ...checkFromCall(call, roller), fromIndex: i };
                notifyDiceChanged({ source: 'gm-call' });
                if (fresh) diceNotice(`Game master calls for a ${call.skill ? `${call.attribute} (${call.skill})` : call.attribute} check, ${call.label} (DC ${call.dc})${call.reason ? `: ${call.reason}` : ''} · rolls when you send`);
            }
        } else {
            if (!prev || prev.kind !== 'npc' || !prev.roll || !sameCall(prev.call, call)) {
                const check = checkFromCall(call, roller);
                const roll = performRoll(check, check.gmRuling);
                store[swipeId] = { kind: 'npc', call, roll };
                changed = true;
                diceNotice(`Game master called an NPC check · ${rollLine(roll)}`, { kind: roll.success ? 'success' : 'warning' });
            }
            if (pending && pending.calledBy === 'gm' && pending.fromIndex === i) clearPendingCheck();
        }
    }
    if (!m.extra || typeof m.extra !== 'object') m.extra = {};
    if (Object.keys(store).length) m.extra.dooms_gm_calls = store;
    else delete m.extra.dooms_gm_calls;
    if (changed) saveRollChange();
    decorateCallTag(i, store[swipeId] || null);
}

/** The NPC rolls the game master made at the end of the reply just before the player's message at `userIndex`. */
function npcRollsBefore(userIndex) {
    const list = chatArray();
    if (!list) return [];
    for (let i = userIndex - 1; i >= 0; i--) {
        const m = list[i];
        if (!m || m.is_system) continue;
        if (m.is_user) return [];
        const entry = gmCallStore(m)[m.swipe_id || 0];
        return entry && entry.kind === 'npc' && entry.roll ? [entry.roll] : [];
    }
    return [];
}

function playerCallHtml(call) {
    const label = call.skill ? `${call.attribute} (${call.skill})` : call.attribute;
    const adv = call.advantage === 'adv' ? ', with advantage' : call.advantage === 'dis' ? ', with disadvantage' : '';
    const why = call.reason ? ` ${escapeHtml(call.reason.replace(/\.$/, ''))}.` : '';
    return `<span class="dooms-gm-call"><span class="dooms-gm-call-die" aria-hidden="true">🎲</span> The game master calls for a <b>${escapeHtml(label)}</b> check, <b>${escapeHtml(call.label)}</b> (DC ${call.dc})${adv}.${why} It rolls when you send your next message.</span>`;
}

function npcCallHtml(entry) {
    const roll = entry.roll;
    const outcome = outcomeLabel(roll) + (roll.critical ? '' : `, ${marginWord(roll.margin)}`);
    const cls = roll.success ? 'is-success' : 'is-failure';
    return `<span class="dooms-gm-call is-npc ${cls}"><span class="dooms-gm-call-die" aria-hidden="true">🎲</span> <b>${escapeHtml(roll.who || 'NPC')}</b>: ${escapeHtml(checkLabel(roll))} check · d20 ${roll.kept} ${escapeHtml(formatModifier(roll.mod))}${roll.prof ? ` +${roll.prof}` : ''} = <b>${roll.total}</b> vs DC ${roll.dc} (${escapeHtml(roll.difficultyLabel || '')}) · <b>${escapeHtml(outcome)}</b>${roll.reason ? ` <i>${escapeHtml(roll.reason)}</i>` : ''}</span>`;
}

/** Replaces the "[CHECK: ...]" text in the shown reply with a line that says what was called (and, for an NPC, how it fell). */
function decorateCallTag(index, entry) {
    if (typeof document === 'undefined' || typeof document.querySelector !== 'function') return;
    const el = document.querySelector(`#chat .mes[mesid="${index}"] .mes_text`);
    if (!el || typeof el.innerHTML !== 'string') return;
    const re = /\[CHECK:[^\]]*\]/g;
    const matches = el.innerHTML.match(re);
    if (!matches) return;
    let replacement = '';
    if (entry && entry.kind === 'npc' && entry.roll) replacement = npcCallHtml(entry);
    else if (entry && entry.kind === 'player') replacement = playerCallHtml(entry.call);
    let seen = 0;
    el.innerHTML = el.innerHTML.replace(re, () => (++seen === matches.length ? replacement : ''));
}

// ─── The dice tool ──────────────────────────────────────────────────────────

/** The key a tool roll is kept under on the player's message: who, what, against what. */
function toolMemoKey(call, roller) {
    return JSON.stringify([roller.name.toLowerCase(), call.attributeId, call.skill.toLowerCase(), call.difficultyId, call.advantage]);
}

/** The tool's arguments as a check description and its roller, or null. */
function callFromToolArgs(args) {
    const cfg = attributesConfig(extensionSettings);
    const a = args && typeof args === 'object' ? args : {};
    const call = resolveCheckCall({
        who: cfg.aiCalls.npcs ? a.who : '',
        attribute: a.attribute,
        skill: a.skill,
        difficulty: a.difficulty,
        advantage: a.advantage,
        reason: a.reason,
    }, extensionSettings);
    return call ? { call, roller: resolveRoller(call.who) } : null;
}

function toolMemo(create = false) {
    const found = findLastUserMessage();
    if (!found) return null;
    const extra = found.message.extra && typeof found.message.extra === 'object' ? found.message.extra : (create ? (found.message.extra = {}) : null);
    if (!extra) return null;
    if (extra.dooms_tool_rolls && typeof extra.dooms_tool_rolls === 'object') return extra.dooms_tool_rolls;
    return create ? (extra.dooms_tool_rolls = {}) : null;
}

function toolCallingLive() {
    try {
        const ctx = getContext();
        return typeof ctx.isToolCallingSupported === 'function' && ctx.isToolCallingSupported() === true;
    } catch (e) {
        return false;
    }
}

/**
 * The dooms_roll_check tool's action: rolls on the roller's sheet against
 * the difficulty the game master set and answers with the verdict. The same
 * call for the same player message rolls once (the roll is kept on that
 * message), so a swipe or a repeated call never re-rolls.
 */
export function diceToolAction(args) {
    const hit = callFromToolArgs(args);
    if (!hit) {
        const a = args && typeof args === 'object' ? args : {};
        return `No check was rolled: "${String(a.attribute || '')}" is not an attribute on the sheet. Use one of: ${attributeDefs(extensionSettings).map(d => d.name).join(', ')}.`;
    }
    const { call, roller } = hit;
    const check = { ...checkFromCall(call, roller), calledBy: 'tool' };
    const memo = toolMemo(true);
    const key = toolMemoKey(call, roller);
    let roll = memo ? memo[key] : null;
    if (!roll || typeof roll !== 'object') {
        roll = performRoll(check, check.gmRuling);
        if (memo) { memo[key] = roll; saveRollChange(); }
        diceNotice(`Dice tool · ${rollLine(roll)}${call.reason ? ` · ${call.reason}` : ''}`, { kind: roll.success ? 'success' : 'warning' });
    } else {
        diceNotice(`Dice tool asked again for the same check · kept ${rollLine(roll)}`);
    }
    notifyDiceChanged({ source: 'tool' });
    return verdictFor(roll);
}

/**
 * TOOL_CALLS_PERFORMED: keeps each roll on its invocation, which SillyTavern
 * saves with the chat and the reply's box reads. Matched by the arguments
 * the model passed, through the same key the roll was kept under, so the
 * order and count of invocations do not matter.
 */
export function onDiceToolCallsPerformed(invocations) {
    if (!Array.isArray(invocations)) return;
    const memo = toolMemo(false);
    if (!memo) return;
    for (const inv of invocations) {
        if (!inv || inv.name !== DICE_TOOL_NAME) continue;
        let args = inv.parameters;
        if (typeof args === 'string') {
            try { args = JSON.parse(args); } catch (e) { continue; }
        }
        const hit = callFromToolArgs(args);
        if (!hit) continue;
        const roll = memo[toolMemoKey(hit.call, hit.roller)];
        if (roll && typeof roll === 'object') inv.dooms_roll = roll;
    }
}

/**
 * Registers (or re-registers, after the sheet changes) the dice tool with
 * SillyTavern. shouldRegister keeps it out of prompts while attributes or
 * the tool switch are off; SillyTavern itself leaves it out on APIs that
 * cannot call tools.
 */
export function registerDiceTool() {
    let ctx;
    try { ctx = getContext(); } catch (e) { return false; }
    if (!ctx || typeof ctx.registerFunctionTool !== 'function') return false;
    const def = buildDiceToolDefinition({ settings: extensionSettings, userName: resolvePersonaName() || 'the player' });
    try {
        ctx.registerFunctionTool({
            ...def,
            action: (args) => diceToolAction(args),
            formatMessage: () => '',
            shouldRegister: () => {
                const cfg = attributesConfig(extensionSettings);
                return !!extensionSettings.enabled && attributesOn(extensionSettings) && cfg.aiCalls.enabled && cfg.aiCalls.tool;
            },
            stealth: false,
        });
        return true;
    } catch (e) {
        console.warn('[Dooms Tracker] Dice: the tool could not be registered', e);
        return false;
    }
}

/**
 * What the game master is told this generation about calling for checks:
 * the tool instruction when the tool is on and the API can call tools,
 * else the end-of-reply form, else nothing. '' when calls are off.
 */
export function buildDiceRulesForGeneration() {
    if (!extensionSettings.enabled || !attributesOn(extensionSettings)) return '';
    const cfg = attributesConfig(extensionSettings);
    if (!cfg.aiCalls.enabled) return '';
    const userName = resolvePersonaName() || 'the player';
    if (cfg.aiCalls.tool && toolCallingLive()) return buildToolCallInstruction({ settings: extensionSettings, userName });
    if (cfg.aiCalls.endOfReply) return buildCheckCallInstruction({ settings: extensionSettings, userName });
    return '';
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
    btn.classList.toggle('is-called', on && !!pending && pending.calledBy === 'gm');
}
