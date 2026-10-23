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
 *     the reply that answers the rolled message, where the die number is a
 *     button that steps the result after the die has landed (D57), behind
 *     Settings → Stats → Let me change the ruling; the dice tool's rolls get
 *     the same buttons on SillyTavern's "Tool calls" line, and a change
 *     rewrites the result the model is given on the next regenerate.
 *
 * It imports no UI module. The popover (src/systems/ui/dicePanel.js) and the
 * shelf listen for DICE_CHANGED_EVENT instead.
 */
import { getContext } from '../../../../../../extensions.js';
import { chat, saveChatDebounced, deleteLastMessage } from '../../../../../../../script.js';
import { callGenericPopup, POPUP_TYPE, POPUP_RESULT } from '../../../../../../popup.js';
import { extensionSettings, committedTrackerData, lastGeneratedData } from '../../core/state.js';
import { parseTrackerJson } from '../../utils/trackerParse.js';
import { escapeHtml } from '../../utils/html.js';
import {
    attributesConfig,
    attributesOn,
    attributeDefs,
    getSheet,
    sheetNames,
    resolveSheetName,
    getProficiencies,
    isProficient,
    isSaveProficient,
    getCastingAbility,
    castingAbilityFor,
    isCastingSkill,
    CASTING_CHECK_NAME,
    dcAbilityId,
    findSkill,
    findAttribute,
    isDefaultSheet,
    buildAttributesLine,
    difficultyById,
    buildDifficultyRatingPrompt,
    parseDifficultyRating,
    rollCheck,
    overrideRoll,
    isSaveRoll,
    saveDC,
    applySaveDC,
    verdictText,
    ownershipSentence,
    describeDC,
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
export function diceNotice(text, { kind = 'info', title = 'Dice', toast = true } = {}) {
    try { console.debug(`[Dooms Tracker] Dice: ${text}`); } catch (e) { /* no console */ }
    if (!toast || !attributesConfig(extensionSettings).notify) return;
    try {
        const t = typeof window !== 'undefined' ? window.toastr : null;
        if (t && typeof t[kind] === 'function') t[kind](text, title, { timeOut: 6000, escapeHtml: true });
    } catch (e) { /* no toastr */ }
}

/** A roll in one line for notices. */
function rollLine(roll) {
    const who = roll.isUser === false ? `${roll.who}: ` : '';
    const dice = roll.advantage !== 'none' && Array.isArray(roll.rolls) && roll.rolls.length === 2 ? `${roll.kept} (${roll.rolls.join('/')})` : String(roll.kept);
    return `${who}${checkLabel(roll)}${isSaveRoll(roll) ? ' save' : ''} · d20 ${dice} ${formatModifier(roll.mod)}${roll.prof ? ` +${roll.prof}` : ''} = ${roll.total} vs ${describeDC(roll, roll.difficultyLabel)} · ${outcomeLabel(roll)}`;
}

/** "Charisma saving throw" or "Wisdom (Insight) check", for notices and the box. */
function kindLabel(rollOrCall) {
    return `${checkLabel(rollOrCall)} ${rollOrCall && rollOrCall.kind === 'save' ? 'saving throw' : 'check'}`;
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

/**
 * Said after every verdict the model is handed. A verdict is an imperative
 * about narration, and a model that reads it last tends to answer with
 * narration alone and drop the tracker block it was asked for.
 */
export const STILL_REQUIRED = 'This decides only how the attempt went. The shape of your reply does not change: the tracker data block still comes exactly where your instructions place it (before the story unless they say otherwise), and everything else they require still follows.';

let pending = null;
let transport = null;          // test hook: (messages) => Promise<string>
let rulingTimeoutMs = 20000;   // the game master gets this long before the default stands
let listenersBound = false;
let openKey = '';            // the roll whose die is open for stepping, as "index:slot" (slot -1: the player's own roll; k: a tool invocation) (D57)
let openStart = null;        // what that die showed when it was opened: closing it on a different face asks whether to regenerate

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
export function recentChatText(count, { before = -1, truncation = 600 } = {}) {
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
    // Different Abilities" variant); the proficiency follows the skill. The
    // Casting skill (§12) sits on the chosen attribute itself: proficient
    // exactly when that attribute is the persona's casting ability.
    const persona = getPersonaSheet();
    const hit = isCastingSkill(skill) ? { attributeId: def.id, name: CASTING_CHECK_NAME } : findSkill(defs, skill);
    const skillName = hit ? hit.name : '';
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
 * answers with a difficulty word, advantage or disadvantage, and a reason,
 * or (§10) with another character's saving throw against the player's
 * ability. Falls back to the configured default difficulty when the AI is
 * not asked, cannot be reached, takes too long, or cannot be read; `source`
 * and `error` say which happened.
 */
export async function rateAttempt({ attributeId, skill = '', context = '', messageText = '', beforeIndex = -1 } = {}) {
    const cfg = attributesConfig(extensionSettings);
    const defs = attributeDefs(extensionSettings);
    const def = defs.find(d => d.id === attributeId);
    if (!cfg.aiRatesDifficulty || !def) return defaultRuling();
    // A borrowed skill is named with its home so the game master knows the
    // pairing is the player's call under the variant rule.
    const home = skill ? findSkill(defs, skill) : null;
    const homeDef = home && home.attributeId !== def.id ? defs.find(d => d.id === home.attributeId) : null;
    const persona = resolvePersonaName() || 'The player';
    const prompt = buildDifficultyRatingPrompt({
        userName: persona,
        attempt: context,
        attributeName: def.name,
        skillName: homeDef ? `${skill}, normally a ${homeDef.name} skill` : skill,
        messageText,
        recentText: recentChatText(cfg.contextMessages, { before: beforeIndex }),
        settings: extensionSettings,
        targets: committedCharacterNames().filter(n => n.toLowerCase() !== persona.toLowerCase()),
    });
    try {
        const text = await withTimeout((transport || defaultTransport)([
            { role: 'system', content: prompt.system },
            { role: 'user', content: prompt.user },
        ]), rulingTimeoutMs);
        const parsed = parseDifficultyRating(text, extensionSettings);
        if (parsed && parsed.kind === 'save') {
            const target = resolveRoller(parsed.who);
            // The player is the actor here; a save of their own makes no sense for their own attempt.
            if (target.isUser) return { ...defaultRuling(), error: 'the game master named the player as the one saving' };
            const saveDef = findAttribute(defs, parsed.attribute) || def;
            const againstDef = findAttribute(defs, parsed.against) || def;
            return {
                kind: 'save',
                who: target.name,
                attributeId: saveDef.id,
                againstAttributeId: againstDef.id,
                advantage: parsed.advantage,
                reason: parsed.reason,
                source: 'ai',
            };
        }
        if (parsed) return { ...parsed, source: 'ai' };
        return { ...defaultRuling(), error: 'unreadable' };
    } catch (e) {
        console.warn('[Dooms Tracker] Dice: the difficulty call failed, using the default', e);
        return { ...defaultRuling(), error: e?.message || String(e) };
    }
}

/**
 * The ruling said another character saves against the player's ability:
 * that character's sheet for the throw, the player's for the DC (§10.1).
 * Returns the check (the target's) and its ruling, in the shapes
 * performRoll expects.
 */
function saveCheckFromRuling(ruling, playerCheck) {
    const defs = attributeDefs(extensionSettings);
    const cfg = attributesConfig(extensionSettings);
    const saveDef = defs.find(d => d.id === ruling.attributeId) || defs[0];
    const target = { name: ruling.who, isUser: false };
    const sheet = getSheet(extensionSettings, target.name, false, defs);
    const profs = getProficiencies(extensionSettings, target.name, false);
    const proficient = isSaveProficient(profs, saveDef.id);
    const persona = playerCheck.who || resolvePersonaName() || 'The player';
    const actorSheet = getSheet(extensionSettings, persona, true, defs);
    // The actor's casting ability sets the DC for anything their power does (§10.1).
    const dcId = dcAbilityId({ namedId: ruling.againstAttributeId, castingId: getCastingAbility(getProficiencies(extensionSettings, persona, true)) });
    const againstDef = defs.find(d => d.id === dcId) || defs.find(d => d.id === ruling.againstAttributeId) || saveDef;
    const actorScore = actorSheet[againstDef.id] ?? DEFAULT_SCORE;
    const filled = applySaveDC(
        { kind: 'save', against: { who: persona, attributeId: againstDef.id, attribute: againstDef.name, abbr: againstDef.abbr } },
        { who: persona, isUser: true, score: actorScore, proficiencyBonus: cfg.proficiencyBonus },
    );
    const check = {
        kind: 'save',
        attributeId: saveDef.id,
        attribute: saveDef.name,
        abbr: saveDef.abbr,
        skill: '',
        skillAttributeId: '',
        score: sheet[saveDef.id] ?? DEFAULT_SCORE,
        proficient,
        prof: proficient ? cfg.proficiencyBonus : 0,
        context: playerCheck.context || '',
        who: target.name,
        isUser: false,
        against: filled.against,
        calledBy: playerCheck.calledBy || 'player',
        fromIndex: playerCheck.fromIndex,
    };
    const rulingOut = {
        kind: 'save',
        difficultyId: '',
        dc: filled.dc,
        label: filled.label,
        advantage: ruling.advantage || 'none',
        reason: ruling.reason || '',
        source: ruling.source || 'ai',
    };
    return { check, ruling: rulingOut };
}

function performRoll(check, ruling) {
    const cfg = attributesConfig(extensionSettings);
    const kind = check.kind === 'save' ? 'save' : 'check';
    const result = rollCheck({
        attribute: check.attribute,
        abbr: check.abbr,
        skill: check.skill,
        score: check.score,
        dc: ruling.dc,
        advantage: ruling.advantage,
        criticals: cfg.criticals,
        proficiency: check.prof,
        kind,
    });
    return {
        ...result,
        attributeId: check.attributeId,
        skillAttributeId: check.skillAttributeId || '',
        against: kind === 'save' && check.against && typeof check.against === 'object' ? { ...check.against } : null,
        difficultyId: ruling.difficultyId || '',
        difficultyLabel: ruling.label || '',
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
        if (ruling.kind === 'save') {
            const made = saveCheckFromRuling(ruling, check);
            diceNotice(`Game master rules a saving throw: ${made.check.who}'s ${made.check.attribute} save ${made.ruling.label} (DC ${made.ruling.dc})${adv}${ruling.reason ? `: ${ruling.reason}` : ''}`);
            pending = null;
            const saved = performRoll(made.check, made.ruling);
            attachRollToMessage(found.message, saved, found.index);
            diceNotice(`Rolled on send · ${rollLine(saved)}`, { kind: saved.success ? 'warning' : 'success' });
            return;
        }
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
    parts.push(`[${STILL_REQUIRED}]`);
    return parts.join('\n');
}

/** One roll's verdict, framed for who rolled, who asked, and whose roll it is (§10, D17). */
function verdictFor(roll) {
    const persona = resolvePersonaName() || 'The player';
    const who = roll.who || persona;
    const called = roll.calledBy === 'gm' || roll.calledBy === 'tool' ? ', on a throw you called for' : '';
    let framing = '';
    let actorName = '';
    if (isSaveRoll(roll)) {
        const a = roll.against;
        if (a && a.who) {
            framing = `${who} makes a ${roll.attribute} saving throw against ${a.who}'s ${a.attribute}${called}`;
            actorName = a.who;
        } else {
            framing = `${who} makes a ${roll.attribute} saving throw${called}`;
        }
    } else if (roll.isUser === false) {
        framing = `${who}, on a check you called for`;
        actorName = persona;
    } else if (roll.calledBy === 'gm' || roll.calledBy === 'tool') {
        framing = `${who} attempts ${roll.attempt ? `"${String(roll.attempt).trim()}"` : 'the action in their last message'}, on a check you called for`;
    }
    return verdictText(roll, {
        userName: who,
        attempt: roll.attempt,
        difficultyLabel: roll.difficultyLabel,
        reason: roll.reason,
        framing,
        ownership: ownershipSentence(roll, { actorName }),
    });
}

// ─── The roll box at the top of the reply ───────────────────────────────────
//
// The roll is stored on the player's message; the box is shown on every
// reply that answers it (each swipe alike, and each reply in a group until
// the next player message), inserted before .mes_text in the reply's
// .mes_block so SillyTavern's own re-renders of the text leave it alone.
// Nothing on it removes the roll. With Let me change the ruling on, the die
// number is a button: pressed, arrows appear either side of it and step the
// result (D57); the reply already written stands until its next swipe or
// regenerate, which follow the set result. A roll is located by the message it
// sits on and a slot: -1 for the player's own roll (message.extra.dooms_roll),
// k for the k-th invocation of a tool-call message.

const CARD_CLASS = 'dooms-roll-card';

/**
 * The rolls a reply at `index` answers: the one on the nearest player
 * message above it, then any the dice tool made on the way to this reply
 * (kept on SillyTavern's tool-call messages in between). [] when none.
 */
export function rollsForReply(index) {
    return rollsForReplyDetailed(index).rolls;
}

const rollKey = (index, slot) => `${index}:${slot}`;
const isToolMessage = (m) => !!(m && Array.isArray(m.extra && m.extra.tool_invocations));

/** The dice tool's invocations of a message with their rolls, as [{ inv, roll, slot }]. */
function toolRollsOf(m) {
    if (!isToolMessage(m)) return [];
    const out = [];
    m.extra.tool_invocations.forEach((inv, slot) => {
        if (inv && inv.name === DICE_TOOL_NAME && inv.dooms_roll && typeof inv.dooms_roll === 'object') out.push({ inv, roll: inv.dooms_roll, slot });
    });
    return out;
}

/** The same as rollsForReply, each roll with the message it sits on and its slot, and the player's own roll apart. */
function rollsForReplyDetailed(index) {
    const none = { rolls: [], items: [], own: null, ownIndex: -1 };
    const list = chatArray();
    if (!list || !Number.isFinite(index) || index < 0 || index >= list.length) return none;
    const m = list[index];
    if (!m || m.is_user || m.is_system) return none;
    const tool = [];
    let i = index - 1;
    for (; i >= 0; i--) {
        const p = list[i];
        if (!p) continue;
        if (p.is_user) break;
        // Walking back message by message; within a message, in the order the model called.
        if (p.is_system && isToolMessage(p)) tool.unshift(...toolRollsOf(p).map(t => ({ roll: t.roll, index: i, slot: t.slot })));
    }
    const r = i >= 0 ? list[i].extra?.dooms_roll : null;
    const own = r && typeof r === 'object' ? r : null;
    const items = (own ? [{ roll: own, index: i, slot: -1 }] : []).concat(tool);
    return { rolls: items.map(x => x.roll), items, own, ownIndex: own ? i : -1 };
}

/** The die number as a button; open, with ▼ ▲ either side of it. */
function dieControlHtml(roll, open) {
    const keptText = Number.isFinite(roll.kept) ? String(roll.kept) : '?';
    const btn = `<button type="button" class="dooms-roll-die-btn${open ? ' is-open' : ''}" title="${open ? 'Done' : 'Change the die'}" aria-label="The die shows ${keptText}. ${open ? 'Done changing it' : 'Change it'}" aria-expanded="${open ? 'true' : 'false'}">${keptText}</button>`;
    return open
        ? `<span class="dooms-roll-step"><button type="button" class="dooms-roll-step-down" title="Down one (1 wraps to 20)" aria-label="Lower the die by one">▼</button>${btn}<button type="button" class="dooms-roll-step-up" title="Up one (20 wraps to 1)" aria-label="Raise the die by one">▲</button></span>`
        : btn;
}

/**
 * The dice tool's rolls for SillyTavern's "Tool calls" line of a tool-call
 * message at `index`: each with its die as a button (the result changes
 * right there, D57), or '' when there is nothing to show. Pure.
 */
export function toolDiceHtml(message, index, { editable = false, openKey: openNow = '' } = {}) {
    if (!editable) return '';
    const rolls = toolRollsOf(message);
    if (!rolls.length) return '';
    const parts = rolls.map(({ roll, slot }) => {
        const who = roll.isUser === false ? `${escapeHtml(roll.who || 'NPC')}: ` : '';
        const set = roll.setBy === 'player' && roll.before && Number.isFinite(roll.before.kept) ? ` <small class="dooms-tool-roll-was" title="${escapeHtml(beforeWords(roll.before))}">(was ${roll.before.kept})</small>` : '';
        return `<span class="dooms-tool-roll" data-index="${index}" data-slot="${slot}"><span class="dooms-roll-die" aria-hidden="true">🎲</span> ${who}${escapeHtml(checkLabel(roll))}${isSaveRoll(roll) ? ' save' : ''} · d20 ${dieControlHtml(roll, openNow === rollKey(index, slot))} ${escapeHtml(formatModifier(roll.mod))}${roll.prof ? ` +${roll.prof}` : ''} = <b>${roll.total}</b> vs DC ${roll.dc} · <span class="dooms-tool-roll-outcome ${roll.success ? 'is-success' : 'is-failure'}">${escapeHtml(outcomeLabel(roll))}</span>${set}</span>`;
    });
    return `<span class="dooms-tool-dice" role="group" aria-label="Dice results">${parts.join('')}</span>`;
}

/** What the die first showed, for the note on a set result. */
function beforeWords(before) {
    if (!before || typeof before !== 'object' || !Number.isFinite(before.kept)) return '';
    const was = before.critical === 'success' ? 'a critical success' : before.critical === 'failure' ? 'a critical failure' : before.success ? 'a success' : 'a failure';
    return `Set by you: the die showed ${before.kept}, ${was}.`;
}

/**
 * The box for one roll. `editable` makes the die number a button (the roll
 * on the player's message at `index`, with the setting on) and `open` shows
 * the ▼ ▲ either side of it; `canRegenerate` adds Regenerate the reply to a
 * set result on the chat's last reply.
 */
export function rollCardHtml(roll, { editable = false, index = -1, slot = -1, canRegenerate = false, open = false } = {}) {
    const set = roll.setBy === 'player';
    const cls = [CARD_CLASS, roll.success ? 'is-success' : 'is-failure', roll.critical ? 'is-crit' : '', set ? 'is-set' : ''].filter(Boolean).join(' ');
    const whoLabel = roll.isUser === false ? `${escapeHtml(roll.who || 'NPC')}: ` : '';
    const asked = roll.calledBy === 'gm' || roll.calledBy === 'tool' ? ' <small>(the game master called for it)</small>' : '';
    const twoDice = roll.advantage !== 'none' && Array.isArray(roll.rolls) && roll.rolls.length === 2;
    const keptText = Number.isFinite(roll.kept) ? String(roll.kept) : '?';
    const face = editable ? dieControlHtml(roll, open) : keptText;
    const dice = twoDice
        ? `${face} <small>(${roll.rolls[0]}/${roll.rolls[1]}, ${roll.advantage === 'adv' ? 'advantage' : 'disadvantage'})</small>`
        : face;
    const math = `d20 ${dice} ${formatModifier(roll.mod)}${roll.prof ? ` +${roll.prof}` : ''} = <b>${roll.total}</b> vs ${escapeHtml(describeDC(roll, roll.difficultyLabel))}`;
    const outcome = outcomeLabel(roll) + (roll.critical ? '' : `, ${marginWord(roll.margin)}`);
    let why = '';
    if (roll.rulingSource === 'ai' && roll.reason) why = `“${escapeHtml(roll.reason)}” — the game master`;
    else if (roll.rulingSource === 'override') why = 'Your ruling.';
    else if (roll.rulingError) why = 'The game master could not be asked; the default difficulty stood.';
    const attempt = roll.attempt ? `<span class="dooms-roll-attempt">${escapeHtml(roll.attempt)}</span>` : '';
    const setNote = set ? escapeHtml(beforeWords(roll.before)) : '';
    const regen = set && canRegenerate ? ' <button type="button" class="dooms-roll-regen" title="Generate the reply again, with this result">Regenerate the reply</button>' : '';
    const whyParts = [attempt, why, setNote ? `<span class="dooms-roll-set-note">${setNote}</span>${regen}` : ''].filter(Boolean);
    const why2 = whyParts.length ? `<div class="dooms-roll-why">${whyParts.join(' · ')}</div>` : '';
    return `<div class="${cls}" role="note"${editable ? ` data-index="${index}" data-slot="${slot}"` : ''}>
        <div class="dooms-roll-line">
            <span class="dooms-roll-die" aria-hidden="true">🎲</span>
            <span class="dooms-roll-label">${whoLabel}${escapeHtml(kindLabel(roll))}${asked}</span>
            <span class="dooms-roll-math">${math}</span>
            <span class="dooms-roll-outcome">${escapeHtml(outcome)}</span>
        </div>
        ${why2}
    </div>`;
}

/** The roll at a locator: the player's own roll on their message (slot -1) or a dice-tool invocation's (slot k). */
function rollAt(index, slot = -1) {
    const list = chatArray();
    const m = list && Number.isFinite(index) ? list[index] : null;
    if (!m) return null;
    if (slot >= 0) {
        const inv = isToolMessage(m) ? m.extra.tool_invocations[slot] : null;
        const roll = inv && inv.name === DICE_TOOL_NAME ? inv.dooms_roll : null;
        return roll && typeof roll === 'object' ? { m, inv, roll } : null;
    }
    const roll = m.is_user && m.extra ? m.extra.dooms_roll : null;
    return roll && typeof roll === 'object' ? { m, inv: null, roll } : null;
}

/** The tool-roll memo on the nearest player message above `index` (what a repeated call for the same check answers with). */
function memoAbove(index) {
    const list = chatArray();
    if (!list) return null;
    for (let i = index - 1; i >= 0; i--) {
        const p = list[i];
        if (p && p.is_user) return p.extra && p.extra.dooms_tool_rolls && typeof p.extra.dooms_tool_rolls === 'object' ? p.extra.dooms_tool_rolls : null;
    }
    return null;
}

/** After a tool roll changed: the stored "Tool calls" text shows the invocations as they now are (SillyTavern wrote it before the roll was attached). */
function refreshToolMessageText(m) {
    try {
        if (typeof m.mes !== 'string' || !m.mes.includes('<code class="language-json">')) return;
        const data = JSON.parse(JSON.stringify(m.extra.tool_invocations)).map(inv => {
            if (!inv || typeof inv !== 'object') return inv;
            const { dooms_roll, ...rest } = inv;    // the roll record is DES's own, not part of what SillyTavern printed
            for (const k of ['parameters', 'result']) {
                if (typeof rest[k] === 'string') { try { rest[k] = JSON.parse(rest[k]); } catch (e) { /* plain text stays */ } }
            }
            return rest;
        });
        m.mes = m.mes.replace(/(<code class="language-json">)[\s\S]*?(<\/code>)/, (_, a, b) => a + escapeHtml(JSON.stringify(data, null, 2)) + b);
    } catch (e) { /* the text stands */ }
}

/**
 * Sets the result of a roll (D57): the player's own roll on their message
 * at `index`, or the dice tool's roll in invocation `slot` of a tool-call
 * message there. A die face, or an outcome (the face that just makes or
 * just misses the DC). A tool roll's change also rewrites the result text
 * the model is given (the invocation's `result`), the memo a repeated call
 * answers with, and the "Tool calls" text. Refused while Let me change the
 * ruling is off, for no roll, and for a bad face. Returns the new roll, or
 * null.
 */
export function setRollResult(index, { kept = null, success = null, slot = -1, quiet = false } = {}) {
    if (!attributesOn(extensionSettings)) return null;
    const cfg = attributesConfig(extensionSettings);
    if (!cfg.allowOverride) return null;
    const at = rollAt(index, slot);
    if (!at) return null;
    const next = overrideRoll(at.roll, { kept, success, criticals: cfg.criticals });
    if (!next) return null;
    if (at.inv) {
        at.inv.dooms_roll = next;
        at.inv.result = `${verdictFor(next)} ${STILL_REQUIRED}`;
        const memo = memoAbove(index);
        if (memo) for (const key of Object.keys(memo)) { const r = memo[key]; if (r && typeof r === 'object' && r.ts === at.roll.ts && r.who === at.roll.who) memo[key] = next; }
        refreshToolMessageText(at.m);
    } else {
        at.m.extra.dooms_roll = next;
    }
    saveRollChange();
    syncRollCardForMessage(index);
    notifyDiceChanged({ source: 'set', index, slot });
    diceNotice(`Result set by you · ${rollLine(next)}`, { kind: next.success ? 'success' : 'warning', toast: !quiet });
    return next;
}

/** Moves a roll's die by `delta` faces, 20 wrapping to 1 (the arrows). Quiet: the box shows it. */
export function stepRollResult(index, delta, slot = -1) {
    const at = rollAt(index, slot);
    if (!at) return null;
    const from = Number.isFinite(at.roll.kept) ? Math.round(at.roll.kept) : 10;
    const d = Math.round(Number(delta) || 0);
    const next = ((((from - 1 + d) % 20) + 20) % 20) + 1;
    return setRollResult(index, { kept: next, slot, quiet: true });
}

/** A message DES's scene pictures posted (src/systems/features/scenePictures.js): the one thing DES may take down on its own. */
function isScenePicture(m) {
    return !!(m && !m.is_user && m.extra && m.extra.dooms_scene && typeof m.extra.dooms_scene === 'object');
}

/**
 * What stands between the message at `index` and the end of the chat.
 * SillyTavern's Regenerate replaces only the chat's last message, so the
 * reply that answers a roll can be regenerated only when nothing follows it
 * but DES's own scene pictures, which are taken down first. Anything else
 * after it (a message of the player's, a system note, another reply) blocks.
 * Pure: `list` is the chat.
 * @returns {{ ok: boolean, pictures: number, blocker: object|null }}
 */
export function afterTheReply(list, index) {
    if (!Array.isArray(list) || !Number.isFinite(index) || index < 0 || index >= list.length) return { ok: false, pictures: 0, blocker: null };
    let pictures = 0;
    for (let i = index + 1; i < list.length; i++) {
        const m = list[i];
        if (isScenePicture(m)) { pictures++; continue; }
        return { ok: false, pictures, blocker: m || null };
    }
    return { ok: true, pictures, blocker: null };
}

/** Whether the reply that answers the roll on the message at `index` can be regenerated: nothing after it but scene pictures. */
function canRegenerateAfter(index) {
    const list = chatArray();
    if (!list || !list.length || !Number.isFinite(index)) return false;
    for (let i = index; i < list.length; i++) {
        const m = list[i];
        // The roll rides the player's message or SillyTavern's "Tool calls" line; the reply that answers it comes after.
        if (!m || m.is_user || m.is_system || isScenePicture(m)) continue;
        return afterTheReply(list, i).ok;
    }
    return false;
}

/**
 * After the die was changed and closed: asks whether to regenerate the reply
 * so the story follows the new result (only when that reply is the chat's
 * last). Nothing when the face is back where it started.
 */
async function offerRegenerate(index, slot, startedAt) {
    const at = rollAt(index, slot);
    if (!at || !Number.isFinite(startedAt) || at.roll.kept === startedAt || !canRegenerateAfter(index)) return false;
    const text = `The die now shows ${at.roll.kept}: ${kindLabel(at.roll)}, ${outcomeLabel(at.roll).toLowerCase()}. Regenerate the reply so the story follows it?`;
    let yes = false;
    try {
        yes = (await callGenericPopup(text, POPUP_TYPE.CONFIRM, '', { okButton: 'Regenerate', cancelButton: 'Not now' })) === POPUP_RESULT.AFFIRMATIVE;
    } catch (e) { yes = false; }
    if (yes) await regenerateLastReply(index);
    return yes;
}

/**
 * Plays a set result out through SillyTavern's own Regenerate (its
 * options-menu entry works with the menu closed). Regenerate replaces only
 * the chat's last message, so a scene picture that landed after the reply
 * is taken down first (SillyTavern's deleteLastMessage: the chat, the
 * screen, MESSAGE_DELETED); anything else after the reply stops it with a
 * notice rather than letting Regenerate replace the wrong message.
 * `index`: the message that carries the roll (the reply, or the player's
 * message the reply answers).
 */
export async function regenerateLastReply(index = NaN) {
    const list = chatArray();
    if (list && list.length) {
        let at = Number.isFinite(index) ? index : -1;
        if (at < 0) { at = list.length - 1; while (at > 0 && isScenePicture(list[at])) at--; }
        if (!canRegenerateAfter(at)) {
            diceNotice('Regenerate replaces only the last message of the chat, and something else follows this reply: delete what follows it first.', { kind: 'warning' });
            return false;
        }
        let taken = 0;
        try {
            while (list.length > at + 1 && isScenePicture(list[list.length - 1])) {
                await deleteLastMessage();
                taken++;
            }
        } catch (e) {
            console.warn('[Dooms Tracker] Dice: a scene picture after the reply could not be taken down', e);
        }
        if (taken) {
            try { saveChatDebounced(); } catch (e) { /* no save */ }
            diceNotice(`The scene picture${taken === 1 ? '' : 's'} after the reply came down so the reply could be regenerated.`);
        }
    }
    try {
        const el = typeof document !== 'undefined' && typeof document.getElementById === 'function' ? document.getElementById('option_regenerate') : null;
        if (el && typeof $ === 'function') { $(el).trigger('click'); return true; }
    } catch (e) { /* no DOM */ }
    diceNotice('Regenerate the reply from its menu to play the result out.');
    return false;
}

function syncCardOnReply(messageElement, index) {
    const $block = $(messageElement).find('.mes_block').first();
    if (!$block.length) return;
    const $existing = $block.children(`.${CARD_CLASS}`);
    const detail = extensionSettings.enabled && attributesOn(extensionSettings) ? rollsForReplyDetailed(index) : null;
    const rolls = detail ? detail.rolls : [];
    $existing.remove();
    if (!rolls.length) return;
    const editable = attributesConfig(extensionSettings).allowOverride;
    const html = detail.items.map(item => rollCardHtml(item.roll, {
        editable,
        index: item.index,
        slot: item.slot,
        canRegenerate: canRegenerateAfter(index),
        open: openKey === rollKey(item.index, item.slot),
    })).join('');
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
    const m = list[mesId];
    if (!m.is_user && !isToolMessage(m)) {
        syncReplyAt(list, mesId);
        return;
    }
    if (isToolMessage(m)) decorateToolLine(mesId);    // its own line, then the replies under it, which show its rolls
    for (let i = mesId + 1; i < list.length; i++) {
        if (list[i] && list[i].is_user) break;
        syncReplyAt(list, i);
    }
}

/** The dice tool's die buttons on a tool-call message's "Tool calls" line (inside SillyTavern's summary, so they sit on that line). */
function decorateToolLine(index) {
    if (typeof document === 'undefined' || typeof document.querySelector !== 'function') return;
    const list = chatArray();
    const m = list ? list[index] : null;
    const el = document.querySelector(`#chat .mes[mesid="${index}"]`);
    if (!m || !el || typeof el !== 'object' || typeof el.querySelector !== 'function') return;
    const old = el.querySelector('.dooms-tool-dice');
    if (old) old.remove();
    const editable = !!extensionSettings.enabled && attributesOn(extensionSettings) && attributesConfig(extensionSettings).allowOverride;
    const html = toolDiceHtml(m, index, { editable, openKey });
    if (!html) return;
    const host = el.querySelector('.mes_text details > summary') || el.querySelector('.mes_text summary') || el.querySelector('.mes_text');
    if (host) host.insertAdjacentHTML('beforeend', html);
}

/** Full sweep (CHAT_CHANGED, "show more messages", deletions). */
export function updateRollCards() {
    const list = chatArray();
    if (!list || typeof $ !== 'function') return;
    const any = extensionSettings.enabled && attributesOn(extensionSettings)
        && list.some(m => m && m.extra && (m.extra.dooms_roll || m.extra.dooms_gm_calls || (Array.isArray(m.extra.tool_invocations) && m.extra.tool_invocations.some(inv => inv && inv.dooms_roll))));
    if (!any) {
        $(`#chat .${CARD_CLASS}, #chat .dooms-tool-dice`).remove();
        return;
    }
    $('#chat .mes').each(function () {
        const mesId = parseInt($(this).attr('mesid'), 10);
        if (!Number.isFinite(mesId) || !list[mesId] || list[mesId].is_user) return;
        if (isToolMessage(list[mesId])) { decorateToolLine(mesId); return; }
        syncCardOnReply(this, mesId);
    });
}

/** CHAT_CHANGED: a pending check belongs to the chat it was tagged in. */
export function onDiceChatChanged() {
    clearPendingCheck({ silent: true });
    openKey = '';
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
    bindRollCardControls();
}

/**
 * The die button and its arrows on the roll boxes (D57), delegated once. Each
 * press re-renders the box (the result is read back from the message), so the
 * open state lives in `openStep` and focus is put back where it was.
 */
function bindRollCardControls() {
    if (typeof $ !== 'function' || typeof document === 'undefined') return;
    try {
        const $doc = $(document);
        // A roll's locator from the control pressed: the box on a reply or the entry on a "Tool calls" line.
        const whereOf = (el) => {
            const $host = $(el).closest('[data-index][data-slot]');
            const index = parseInt($host.attr('data-index'), 10);
            const slot = parseInt($host.attr('data-slot'), 10);
            return Number.isFinite(index) ? { index, slot: Number.isFinite(slot) ? slot : -1, key: rollKey(index, Number.isFinite(slot) ? slot : -1) } : null;
        };
        const focusIn = (w, selector) => {
            try {
                const el = document.querySelector(`#chat [data-index="${w.index}"][data-slot="${w.slot}"] ${selector}`);
                if (el && typeof el.focus === 'function') el.focus({ preventScroll: true });
            } catch (e) { /* no DOM */ }
        };
        const indexOfKey = (key) => parseInt(String(key).split(':')[0], 10);
        const openOn = (w) => {    // one die open at a time: what was open before is redrawn closed
            const prev = openKey;
            if (prev === w.key) return;
            openKey = w.key;
            const at = rollAt(w.index, w.slot);
            openStart = at && Number.isFinite(at.roll.kept) ? at.roll.kept : null;
            if (prev) syncRollCardForMessage(indexOfKey(prev));
        };
        const step = (w, delta, selector) => {
            if (!w) return;
            openOn(w);
            if (stepRollResult(w.index, delta, w.slot)) focusIn(w, selector);
        };
        const close = (w, { ask = true } = {}) => {
            if (!w) return;
            const startedAt = openStart;
            openKey = '';
            openStart = null;
            syncRollCardForMessage(w.index);
            focusIn(w, '.dooms-roll-die-btn');
            if (ask) offerRegenerate(w.index, w.slot, startedAt).catch(() => {});
        };
        const whereOfKey = (key) => { const [i, s] = String(key).split(':').map(Number); return Number.isFinite(i) ? { index: i, slot: Number.isFinite(s) ? s : -1, key } : null; };
        // Inside SillyTavern's <summary>, a click would also fold the tool calls open or shut: ours do not.
        const own = (e) => { e.preventDefault(); e.stopPropagation(); };
        $doc.on('click', '#chat .dooms-roll-die-btn', function (e) {
            own(e);
            const w = whereOf(this);
            if (!w) return;
            if (openKey === w.key) { close(w); return; }
            openOn(w);
            syncRollCardForMessage(w.index);
            focusIn(w, '.dooms-roll-die-btn');
        });
        $doc.on('click', '#chat .dooms-roll-step-up', function (e) { own(e); step(whereOf(this), 1, '.dooms-roll-step-up'); });
        $doc.on('click', '#chat .dooms-roll-step-down', function (e) { own(e); step(whereOf(this), -1, '.dooms-roll-step-down'); });
        $doc.on('keydown', '#chat .dooms-roll-die-btn, #chat .dooms-roll-step button', function (e) {
            const w = whereOf(this);
            if (!w) return;
            if (e.key === 'ArrowUp' || e.key === 'ArrowRight') { own(e); step(w, 1, '.dooms-roll-die-btn'); }
            else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') { own(e); step(w, -1, '.dooms-roll-die-btn'); }
            else if (e.key === 'Escape' && openKey === w.key) { own(e); close(w); }
        });
        $doc.on('click', `#chat .${CARD_CLASS} .dooms-roll-regen`, function () {
            if (openKey) close(whereOfKey(openKey), { ask: false });    // the player is regenerating already
            const index = Number($(this).closest(`.${CARD_CLASS}`).attr('data-index'));
            regenerateLastReply(Number.isFinite(index) ? index : NaN).catch(() => {});
        });
        // A click anywhere else ends the stepping (and asks about regenerating when the die moved).
        $doc.on('click', function (e) {
            if (!openKey) return;
            if ($(e.target).closest('.dooms-roll-step, .dooms-roll-die-btn, .dooms-roll-regen').length) return;
            close(whereOfKey(openKey));
        });
    } catch (e) { /* no jQuery events (tests) */ }
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
    // The name as the sheet is stored (D59): "Mara", "the guard" or an alias
    // finds "Mara Vane"'s sheet; the persona's full name finds theirs.
    const name = resolveSheetName(w, {
        names: [...(persona ? [persona] : []), ...sheetNames(extensionSettings, false)],
        aliases: extensionSettings.characterAliases || {},
        present: committedCharacterNames(),
    });
    if (persona && name.toLowerCase() === persona.toLowerCase()) return { name: persona, isUser: true };
    return { name, isUser: false };
}

/**
 * A bare Casting call (§12) with the roller's ability filled in: their
 * casting ability, or Charisma when none is set (D27), the Casting skill
 * riding on it. Done once, up front, so the stored call, the pending check
 * and the shown line all agree. Any other call comes back as it was.
 */
function fillCastingCall(call, roller) {
    if (!call || !call.castingCheck || call.attributeId) return call;
    const defs = attributeDefs(extensionSettings);
    const d = defs.find(x => x.id === castingAbilityFor(getProficiencies(extensionSettings, roller.name, roller.isUser), defs)) || defs[0];
    return d ? { ...call, attributeId: d.id, attribute: d.name, abbr: d.abbr, skillAttributeId: d.id } : call;
}

/**
 * A call plus the roller's sheet, in the shape onDiceMessageSent and
 * performRoll expect. A save whose DC another character sets reads that
 * character's sheet here (§10.1): 8 + proficiency bonus + their modifier.
 */
function checkFromCall(call, roller) {
    const defs = attributeDefs(extensionSettings);
    const cfg = attributesConfig(extensionSettings);
    const save = call.kind === 'save';
    const sheet = getSheet(extensionSettings, roller.name, roller.isUser, defs);
    const profs = getProficiencies(extensionSettings, roller.name, roller.isUser);
    call = fillCastingCall(call, roller);
    const proficient = save
        ? isSaveProficient(profs, call.attributeId)
        : (!!call.skill && isProficient(profs, call.skillAttributeId || call.attributeId, call.skill));
    let resolved = call;
    if (save && call.against && typeof call.against === 'object') {
        const actor = resolveRoller(call.against.who);
        const actorSheet = getSheet(extensionSettings, actor.name, actor.isUser, defs);
        // The actor's casting ability sets the DC for anything their power does (§10.1).
        const dcId = dcAbilityId({ namedId: call.against.attributeId, castingId: getCastingAbility(getProficiencies(extensionSettings, actor.name, actor.isUser)) });
        const dcDef = defs.find(d => d.id === dcId);
        const withAbility = dcDef && dcDef.id !== call.against.attributeId
            ? { ...call, against: { ...call.against, attributeId: dcDef.id, attribute: dcDef.name, abbr: dcDef.abbr } }
            : call;
        resolved = applySaveDC(withAbility, {
            who: actor.name,
            isUser: actor.isUser,
            score: actorSheet[withAbility.against.attributeId] ?? DEFAULT_SCORE,
            proficiencyBonus: cfg.proficiencyBonus,
        });
    }
    return {
        kind: save ? 'save' : 'check',
        attributeId: call.attributeId,
        attribute: call.attribute,
        abbr: call.abbr,
        skill: save ? '' : call.skill,
        skillAttributeId: save ? '' : (call.skillAttributeId || ''),
        score: sheet[call.attributeId] ?? DEFAULT_SCORE,
        proficient,
        prof: proficient ? cfg.proficiencyBonus : 0,
        context: '',
        who: roller.name,
        isUser: roller.isUser,
        against: save && resolved.against ? { ...resolved.against } : null,
        calledBy: 'gm',
        gmRuling: {
            kind: save ? 'save' : 'check',
            difficultyId: resolved.difficultyId || '',
            dc: resolved.dc,
            label: resolved.label,
            advantage: call.advantage,
            reason: call.reason,
            source: call.difficultySource === 'ai' || call.difficultySource === 'character' ? 'gm' : 'default',
        },
        override: null,
        rating: false,
        ts: Date.now() + Math.random(),
    };
}

function sameCall(a, b) {
    const againstOf = (c) => c && c.against && typeof c.against === 'object' ? `${String(c.against.who || '').toLowerCase()}:${c.against.attributeId || ''}` : '';
    return !!a && !!b && (a.kind || 'check') === (b.kind || 'check') && a.attributeId === b.attributeId && a.skill === b.skill && a.difficultyId === b.difficultyId
        && againstOf(a) === againstOf(b)
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
    let call = on ? parseCheckCall(typeof m.mes === 'string' ? m.mes : '', extensionSettings) : null;
    const store = gmCallStore(m);
    const prev = store[swipeId] || null;
    const isLast = i === list.length - 1;
    let changed = false;
    if (!call) {
        if (prev) { delete store[swipeId]; changed = true; }
        if (pending && pending.calledBy === 'gm' && pending.fromIndex === i) clearPendingCheck();
    } else {
        const roller = resolveRoller(cfg.aiCalls.npcs ? call.who : '');
        call = fillCastingCall(call, roller);
        if (roller.isUser) {
            const check = checkFromCall(call, roller);
            if (!prev || prev.kind !== 'player' || !sameCall(prev.call, call)) { store[swipeId] = { kind: 'player', call, ruling: check.gmRuling }; changed = true; }
            // A check the player tagged themselves is theirs; otherwise the
            // game master's call waits on the chip for their next message.
            if (isLast && (!pending || pending.calledBy === 'gm')) {
                const fresh = !pending || pending.fromIndex !== i || !sameCall({ ...pending, who: '' }, { ...call, who: '' });
                pending = { ...check, fromIndex: i };
                notifyDiceChanged({ source: 'gm-call' });
                if (fresh) diceNotice(`Game master calls for a ${kindLabel(call)}, ${check.gmRuling.label} (DC ${check.gmRuling.dc})${call.reason ? `: ${call.reason}` : ''} · rolls when you send`);
            }
        } else {
            if (!prev || prev.kind !== 'npc' || !prev.roll || !sameCall(prev.call, call)) {
                const check = checkFromCall(call, roller);
                const roll = performRoll(check, check.gmRuling);
                store[swipeId] = { kind: 'npc', call, roll };
                changed = true;
                diceNotice(`Game master called an NPC ${call.kind === 'save' ? 'saving throw' : 'check'} · ${rollLine(roll)}`, { kind: roll.success ? 'success' : 'warning' });
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

function playerCallHtml(entry) {
    const call = entry.call;
    const ruling = entry.ruling || call;
    const adv = call.advantage === 'adv' ? ', with advantage' : call.advantage === 'dis' ? ', with disadvantage' : '';
    const why = call.reason ? ` ${escapeHtml(call.reason.replace(/\.$/, ''))}.` : '';
    return `<span class="dooms-gm-call"><span class="dooms-gm-call-die" aria-hidden="true">🎲</span> The game master calls for a <b>${escapeHtml(kindLabel(call))}</b>, <b>${escapeHtml(ruling.label || '')}</b> (DC ${ruling.dc})${adv}.${why} It rolls when you send your next message.</span>`;
}

function npcCallHtml(entry) {
    const roll = entry.roll;
    const outcome = outcomeLabel(roll) + (roll.critical ? '' : `, ${marginWord(roll.margin)}`);
    const cls = roll.success ? 'is-success' : 'is-failure';
    return `<span class="dooms-gm-call is-npc ${cls}"><span class="dooms-gm-call-die" aria-hidden="true">🎲</span> <b>${escapeHtml(roll.who || 'NPC')}</b>: ${escapeHtml(kindLabel(roll))} · d20 ${roll.kept} ${escapeHtml(formatModifier(roll.mod))}${roll.prof ? ` +${roll.prof}` : ''} = <b>${roll.total}</b> vs ${escapeHtml(describeDC(roll, roll.difficultyLabel))} · <b>${escapeHtml(outcome)}</b>${roll.reason ? ` <i>${escapeHtml(roll.reason)}</i>` : ''}</span>`;
}

/**
 * Replaces the "[CHECK: ...]" text in the shown reply with a line that says
 * what was called (and, for an NPC, how it fell). Works on the text nodes
 * that hold the tag, never by re-serialising the message, so nothing else
 * DES or SillyTavern bound inside the reply is disturbed. A tag split
 * across markup is left as it is.
 */
function decorateCallTag(index, entry) {
    if (typeof document === 'undefined' || typeof document.querySelector !== 'function' || typeof document.createTreeWalker !== 'function') return;
    const el = document.querySelector(`#chat .mes[mesid="${index}"] .mes_text`);
    // A real element has string text; the test sandbox's stand-ins do not.
    if (!el || typeof el.textContent !== 'string' || !(el.textContent.includes('[CHECK:') || el.textContent.includes('[SAVE:'))) return;
    const re = /\[(?:CHECK|SAVE):[^\]]*\]/g;
    const walker = document.createTreeWalker(el, 4 /* NodeFilter.SHOW_TEXT */);
    const hits = [];
    for (let node = walker.nextNode(), guard = 0; node && guard < 5000; node = walker.nextNode(), guard++) {
        if (node.nodeType === 3 && typeof node.nodeValue === 'string' && (node.nodeValue.includes('[CHECK:') || node.nodeValue.includes('[SAVE:')) && re.test(node.nodeValue)) hits.push(node);
        re.lastIndex = 0;
    }
    if (!hits.length) return;
    let replacement = '';
    if (entry && entry.kind === 'npc' && entry.roll) replacement = npcCallHtml(entry);
    else if (entry && entry.kind === 'player') replacement = playerCallHtml(entry);
    hits.forEach((node, n) => {
        const last = n === hits.length - 1;
        const frag = document.createDocumentFragment();
        let cursor = 0;
        const text = node.nodeValue;
        const all = [...text.matchAll(re)];
        all.forEach((m, k) => {
            if (m.index > cursor) frag.appendChild(document.createTextNode(text.slice(cursor, m.index)));
            // Only the last tag of the last node becomes the line; earlier ones vanish.
            if (last && k === all.length - 1 && replacement) {
                const span = document.createElement('span');
                span.innerHTML = replacement;
                frag.appendChild(span.firstElementChild || span);
            }
            cursor = m.index + m[0].length;
        });
        if (cursor < text.length) frag.appendChild(document.createTextNode(text.slice(cursor)));
        node.parentNode?.replaceChild(frag, node);
    });
}

// ─── The dice tool ──────────────────────────────────────────────────────────

/** The key a tool roll is kept under on the player's message: who, what kind, what, against what. */
function toolMemoKey(call, roller) {
    const against = call.against && typeof call.against === 'object' ? `vs:${String(call.against.who || '').toLowerCase()}:${call.against.attributeId || ''}` : (call.difficultyId || '');
    return JSON.stringify([roller.name.toLowerCase(), call.kind || 'check', call.attributeId, String(call.skill || '').toLowerCase(), against, call.advantage]);
}

/** The tool's arguments as a check or save description and its roller, or null. */
function callFromToolArgs(args) {
    const cfg = attributesConfig(extensionSettings);
    const a = args && typeof args === 'object' ? args : {};
    const call = resolveCheckCall({
        kind: String(a.kind || '').toLowerCase() === 'save' ? 'save' : 'check',
        who: cfg.aiCalls.npcs ? a.who : '',
        attribute: a.attribute,
        skill: a.skill,
        difficulty: a.difficulty,
        advantage: a.advantage,
        reason: a.reason,
        against: a.against,
        againstAttribute: a.againstAttribute,
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
        return `Nothing was rolled: "${String(a.attribute || '')}" is not an attribute on the sheet. Use one of: ${attributeDefs(extensionSettings).map(d => d.name).join(', ')}, or ${CASTING_CHECK_NAME} for a casting check.`;
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
        diceNotice(`Dice tool asked again for the same ${call.kind === 'save' ? 'saving throw' : 'check'} · kept ${rollLine(roll)}`);
    }
    notifyDiceChanged({ source: 'tool' });
    return `${verdictFor(roll)} ${STILL_REQUIRED}`;
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
