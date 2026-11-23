/**
 * A vital's mark, live (docs/long-shot-plan.md D233): what a reply that
 * carries a value to its mark sets off, where that is kept, how the
 * narrator hears of it, and the box the player sees.
 *
 * The rules are src/utils/vitals.js (the mark on the sheet entry, the
 * crossings) and src/utils/vitalLimits.js (the roll, the words). Here:
 *
 *   A reply lands        settleVitalLimits(), called where the reply's
 *                        vitals have just been normalised (together mode:
 *                        sillytavern.js; separate mode: apiClient.js). The
 *                        marks the reply reached are settled, a die rolled
 *                        for those that ask for one, and the records kept
 *                        on the reply: message.extra.dooms_vital_events,
 *                        by swipe. A roll that leaves the value somewhere
 *                        writes it into the tracker data before it is
 *                        stored. A reply is settled once: a second pass
 *                        over the same swipe finds its records and rolls
 *                        nothing.
 *   The next reply       buildVitalLimitsForGeneration(): the records of
 *                        the replies the player's last message answers
 *                        (one in a solo chat, each member's in a group),
 *                        as verdicts, in a slot of their own beside the
 *                        dice (injector.js). Read from the chat, so a
 *                        swipe or a regenerate of the answer is told the
 *                        same thing.
 *   What the player sees a toast when it happens, and a box under the
 *                        reply it happened in (syncVitalCardForMessage).
 *
 * No UI module is imported; index.js wires the events.
 */
import { getContext } from '../../../../../../extensions.js';
import { chat, saveChatDebounced } from '../../../../../../../script.js';
import { extensionSettings, committedTrackerData } from '../../core/state.js';
import { vitalsOn, vitalDefs, playerVitalDefs, limitsCrossed, setVitalValue, getPlayedNames } from '../../utils/vitals.js';
import { settleLimit, limitVerdicts, limitLine, limitMath, limitOutcome } from '../../utils/vitalLimits.js';
import { attributesOn, attributesConfig, attributeDefs, getSheet, getProficiencies, isSaveProficient } from '../../utils/d20.js';

export const VITAL_LIMIT_SLOT = 'dooms-dice-vital';
const STORE_KEY = 'dooms_vital_events';
const CARD_CLASS = 'dooms-vital-card';

let rng = null;   // test hook: the die

/** Test hook: the die the marks roll (null: d20.js's own). */
export function __setVitalLimitRng(fn) {
    rng = typeof fn === 'function' ? fn : null;
}

const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function chatArray() {
    if (Array.isArray(chat)) return chat;
    try {
        const c = getContext().chat;
        return Array.isArray(c) ? c : null;
    } catch (e) {
        return null;
    }
}

/** Whether any vital in use has a mark: nothing below does anything without one. */
export function vitalLimitsOn() {
    if (!extensionSettings.enabled || !vitalsOn(extensionSettings)) return false;
    return vitalDefs(extensionSettings).some(d => d.limit.when !== 'off');
}

/** The name the persona's records carry: the user character being played, else the persona's own name. */
function playerName() {
    return getPlayedNames()[0] || 'The player';
}

/** The records of a reply's swipes, by swipe id; made when asked to be. */
function eventStore(message, create = false) {
    if (!message || typeof message !== 'object') return {};
    if (!message.extra || typeof message.extra !== 'object') {
        if (!create) return {};
        message.extra = {};
    }
    const s = message.extra[STORE_KEY];
    if (s && typeof s === 'object' && !Array.isArray(s)) return s;
    if (!create) return {};
    message.extra[STORE_KEY] = {};
    return message.extra[STORE_KEY];
}

/** A swipe's records as stored: on the message, else in what SillyTavern kept of that swipe; null when it has none. */
function storedEvents(message, swipeId) {
    const here = eventStore(message)[swipeId];
    if (Array.isArray(here)) return here;
    const kept = message && message.swipe_info && message.swipe_info[swipeId] && message.swipe_info[swipeId].extra
        ? message.swipe_info[swipeId].extra[STORE_KEY] : null;
    const there = kept && typeof kept === 'object' ? kept[swipeId] : null;
    return Array.isArray(there) ? there : null;
}

/** The marks a reply reached on the swipe in front, [] when none. */
export function vitalEventsOf(message) {
    if (!message || message.is_user) return [];
    const list = storedEvents(message, message.swipe_id || 0);
    return Array.isArray(list) ? list.filter(e => e && typeof e === 'object' && e.vital) : [];
}

/** What rides on the die for a mark that names an attribute, or null for a bare die. */
function sheetFor(crossing) {
    const attr = crossing.def.limit.attr;
    if (!attr || !attributesOn(extensionSettings)) return null;
    const defs = attributeDefs(extensionSettings);
    const def = defs.find(d => d.id === attr);
    if (!def) return null;
    const scores = getSheet(extensionSettings, crossing.who, crossing.isPlayer, defs);
    const proficient = isSaveProficient(getProficiencies(extensionSettings, crossing.who, crossing.isPlayer), def.id);
    return {
        attribute: def.name,
        abbr: def.abbr || '',
        score: scores[def.id],
        proficiency: proficient ? attributesConfig(extensionSettings).proficiencyBonus : 0,
    };
}

function announce(event) {
    const line = limitLine(event);
    try { console.debug(`[Dooms Tracker] Vitals: ${line}`); } catch (e) { /* no console */ }
    try {
        const t = typeof window !== 'undefined' ? window.toastr : null;
        if (!t) return;
        const kind = event.does === 'roll' ? (event.success ? 'success' : 'warning') : 'info';
        if (typeof t[kind] === 'function') t[kind](line, 'Stats', { timeOut: 7000, escapeHtml: true });
    } catch (e) { /* no toastr */ }
}

/**
 * Settles the marks a reply reached. `parsedData` is the reply's tracker
 * data with its vitals already normalised (`characterThoughts` and
 * `player`, JSON strings); it is changed in place where a roll leaves a
 * value somewhere. `prev` is the data the AI was shown.
 * @returns {object[]} the reply's records ([] when it reached no mark)
 */
export function settleVitalLimits(parsedData, message, prev = committedTrackerData) {
    if (!parsedData || !message || message.is_user || !vitalLimitsOn()) return [];
    const swipeId = message.swipe_id || 0;
    let events = storedEvents(message, swipeId);
    if (!Array.isArray(events)) {
        const crossings = limitsCrossed({
            defs: vitalDefs(extensionSettings),
            prevChars: prev ? prev.characterThoughts : null,
            nextChars: parsedData.characterThoughts,
            playerDefs: parsedData.player ? playerVitalDefs(extensionSettings) : [],
            prevPlayer: prev ? prev.player : null,
            nextPlayer: parsedData.player,
            playerName: playerName(),
        });
        if (!crossings.length) return [];
        const criticals = attributesConfig(extensionSettings).criticals;
        events = crossings.map(c => settleLimit(c, { sheet: sheetFor(c), criticals, rng: rng || undefined }));
        eventStore(message, true)[swipeId] = events;
        for (const e of events) announce(e);
        try { saveChatDebounced(); } catch (e) { /* no chat open */ }
        // Separate mode settles after the reply is on the page; together
        // mode before it is, and the rendered event draws the box.
        try {
            const list = chatArray();
            const index = list ? list.indexOf(message) : -1;
            if (index >= 0) syncVitalCardForMessage(index);
        } catch (e) { /* no DOM */ }
    }
    // The value a roll leaves the vital at; written again on a second pass
    // over the same swipe, whose data is the reply's own once more.
    for (const e of events) {
        if (!e || typeof e.to !== 'number') continue;
        if (e.isPlayer) {
            if (parsedData.player) parsedData.player = setVitalValue(parsedData.player, { isPlayer: true, vital: e.vital, value: e.to });
        } else if (parsedData.characterThoughts) {
            parsedData.characterThoughts = setVitalValue(parsedData.characterThoughts, { who: e.who, vital: e.vital, value: e.to });
        }
    }
    return events;
}

/**
 * The records of the replies the player's message at `userIndex` answers:
 * every reply since the player last spoke before it, oldest first. One
 * reply in a solo chat; in a group, or where a second reply was asked for
 * without a word from the player, each of them.
 */
function eventsBefore(list, userIndex) {
    const out = [];
    for (let i = userIndex - 1; i >= 0; i--) {
        const m = list[i];
        if (!m || m.is_system) continue;
        if (m.is_user) break;
        out.unshift(...vitalEventsOf(m));
    }
    return out;
}

/**
 * What the vital slot holds for the next generation: the verdicts for the
 * marks reached in the replies the player's last message answers, or ''
 * when they reached none. Found from the player's last message, so the
 * answer's swipes and regenerates are told the same.
 */
export function buildVitalLimitsForGeneration() {
    if (!vitalLimitsOn()) return '';
    const list = chatArray();
    if (!list) return '';
    for (let i = list.length - 1; i >= 0; i--) {
        const m = list[i];
        if (m && m.is_user && !m.is_system) return limitVerdicts(eventsBefore(list, i));
    }
    return '';
}

// ─── The box under the reply ────────────────────────────────────────────────

/** The box for one mark reached: what moved, the roll when there was one, and what the narrator is told next. */
export function vitalCardHtml(e) {
    const rolled = e.does === 'roll' && e.roll;
    const cls = [CARD_CLASS, rolled ? (e.success ? 'is-success' : 'is-failure') : 'is-note', rolled && e.roll.critical ? 'is-crit' : ''].filter(Boolean).join(' ');
    const level = e.level ? ` <small>(${escapeHtml(e.level)})</small>` : '';
    const what = `${escapeHtml(e.vital)} ${e.when === 'fall' ? 'fell to' : 'reached'} ${escapeHtml(e.value)}%${level}`;
    const math = rolled ? `<span class="dooms-roll-math">${escapeHtml(limitMath(e.roll).replace('d20 = ', 'd20 '))}</span>` : '';
    const outcome = rolled ? `<span class="dooms-roll-outcome">${escapeHtml(limitOutcome(e))}</span>` : '';
    const then = [];
    if (e.text) then.push(`Next reply: ${escapeHtml(e.text)}`);
    if (typeof e.to === 'number') then.push(`${escapeHtml(e.vital)} set to ${escapeHtml(e.to)}%`);
    return `<div class="${cls}" role="note">
        <div class="dooms-roll-line">
            <span class="dooms-roll-die" aria-hidden="true">${rolled ? '🎲' : escapeHtml(e.icon || '📈')}</span>
            <span class="dooms-roll-label">${e.who ? `${escapeHtml(e.who)}: ` : ''}${what}</span>
            ${math}
            ${outcome}
        </div>
        ${then.length ? `<div class="dooms-roll-why">${then.join(' · ')}</div>` : ''}
    </div>`;
}

function syncCardOnReply(el, message) {
    if (!el || typeof el.querySelector !== 'function') return;
    const block = el.querySelector('.mes_block');
    if (!block) return;
    block.querySelectorAll(`:scope > .${CARD_CLASS}`).forEach(n => n.remove());
    const events = vitalLimitsOn() ? vitalEventsOf(message) : [];
    if (!events.length) return;
    const html = events.map(vitalCardHtml).join('');
    const text = block.querySelector(':scope > .mes_text');
    if (text) text.insertAdjacentHTML('afterend', html);
    else block.insertAdjacentHTML('beforeend', html);
}

/** Per-message sync by id (a reply rendered, swiped or edited): its box follows the swipe in front. */
export function syncVitalCardForMessage(messageId) {
    const list = chatArray();
    const mesId = parseInt(messageId, 10);
    if (!list || !Number.isFinite(mesId) || !list[mesId] || list[mesId].is_user) return;
    if (typeof document === 'undefined' || typeof document.querySelector !== 'function') return;
    syncCardOnReply(document.querySelector(`#chat .mes[mesid="${mesId}"]`), list[mesId]);
}

/** Full sweep (a chat opened, more messages loaded, a deletion, the vitals switched). */
export function updateVitalCards() {
    const list = chatArray();
    if (!list || typeof document === 'undefined' || typeof document.querySelectorAll !== 'function') return;
    const any = vitalLimitsOn() && list.some(m => m && !m.is_user && vitalEventsOf(m).length > 0);
    if (!any) {
        document.querySelectorAll(`#chat .${CARD_CLASS}`).forEach(n => n.remove());
        return;
    }
    document.querySelectorAll('#chat .mes').forEach(el => {
        const mesId = parseInt(el.getAttribute('mesid'), 10);
        if (!Number.isFinite(mesId) || !list[mesId] || list[mesId].is_user) return;
        syncCardOnReply(el, list[mesId]);
    });
}
