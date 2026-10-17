/**
 * Cut to a quest (Project Short Fuse, Phase 5b): the pure parts.
 *
 * The player picks a quest on the shelf and the next reply is the cut: a
 * brief montage of what passes between now and the moment the quest begins,
 * then its opening beat, with the first move left to the player. Nothing of
 * the player's shows in the chat; the instruction rides the next generation
 * and the shelf asks SillyTavern for a reply. The quest becomes the main
 * quest and the main quest it displaces drops to the top of the optional
 * list.
 *
 * No SillyTavern imports: tools/quest-cut-test.mjs imports this directly.
 * The arming, the slot and the trigger live in
 * src/systems/features/questCut.js; the menu in src/systems/ui/shelfPages.js.
 */
import { parseTrackerJson } from './trackerParse.js';

export const QUEST_CUT_SLOT = 'dooms-quest-cut';
export const MAX_QUEST = 200;
export const MAX_WHEN = 80;

/** The text of a quest entry, which older chats may keep wrapped in an object. */
export function questText(q) {
    let v = q;
    for (let guard = 0; v && typeof v === 'object' && guard < 5; guard++) {
        v = v.value !== undefined ? v.value : (v.title !== undefined ? v.title : '');
    }
    return String(v ?? '').replace(/\s+/g, ' ').trim();
}

/** A quest list as plain strings: { main, optional[] }, 'None' meaning no main quest; positions kept. */
export function normalizeQuests(raw) {
    const r = raw && typeof raw === 'object' ? raw : {};
    const main = questText(r.main) || 'None';
    const optional = (Array.isArray(r.optional) ? r.optional : []).map(questText);
    return { main, optional };
}

/** "When" as the player typed it, made safe for the instruction. */
export function cleanWhen(when) {
    return String(when || '').replace(/\s+/g, ' ').replace(/[\[\]]/g, '').trim().replace(/[.。]+$/, '').slice(0, MAX_WHEN);
}

function cleanQuest(quest) {
    return String(quest || '')
        .replace(/\s+/g, ' ')
        .replace(/[\[\]]/g, '')
        .replace(/"([^"]*)"/g, '\u201c$1\u201d')
        .replace(/"/g, '\u201d')
        .trim()
        .slice(0, MAX_QUEST);
}

/**
 * The quest list after "cut to it": the chosen quest becomes the main quest
 * and the main quest it displaces goes to the top of the optional list. The
 * main quest itself, or nothing, changes nothing.
 * @param {object} raw - extensionSettings.quests
 * @param {'main'|'optional'} field
 * @param {number|string} [index] - position in the optional list
 * @returns {{ quests: { main: string, optional: string[] }, quest: string, changed: boolean }}
 */
export function promoteQuest(raw, field, index) {
    const q = normalizeQuests(raw);
    if (field === 'main') return { quests: q, quest: q.main !== 'None' ? q.main : '', changed: false };
    const i = Number(index);
    const quest = Number.isInteger(i) && i >= 0 && i < q.optional.length ? q.optional[i] : '';
    if (!quest || quest === 'None') return { quests: q, quest: '', changed: false };
    const optional = q.optional.filter((_, k) => k !== i);
    if (q.main && q.main !== 'None') optional.unshift(q.main);
    return { quests: { main: quest, optional }, quest, changed: true };
}

function val(v) {
    if (v === null || v === undefined) return '';
    if (typeof v === 'object') return v.value !== undefined ? val(v.value) : '';
    return String(v).replace(/\s+/g, ' ').trim();
}

function factsFromObject(o) {
    const out = { date: val(o.date), time: '', location: val(o.location) };
    if (typeof o.time === 'string') {
        out.time = o.time.replace(/\s+/g, ' ').trim();
    } else if (o.time && typeof o.time === 'object') {
        const s = val(o.time.start);
        const e = val(o.time.end);
        out.time = s && e && s !== e ? `${s} → ${e}` : (s || e || val(o.time));
    }
    return out;
}

/**
 * What the tracker says about now: { date, time, location }, '' when unknown.
 * Reads the info box in its JSON form (strings or { value } objects, time as
 * "start → end" or { start, end }) or its older text form.
 */
export function sceneFactsFrom(infoBox) {
    const empty = { date: '', time: '', location: '' };
    if (!infoBox) return empty;
    if (typeof infoBox === 'object') return factsFromObject(infoBox);
    const raw = String(infoBox).trim();
    if (!raw) return empty;
    if (raw.startsWith('{') || raw.startsWith('```')) {
        const unfenced = raw.replace(/^```[a-z]*\s*/i, '').replace(/\s*```$/, '').trim();
        let parsed = null;
        try { parsed = parseTrackerJson(unfenced); } catch (e) { parsed = null; }
        if (!parsed) {
            try { parsed = JSON.parse(unfenced); } catch (e) { parsed = null; }
        }
        if (parsed && typeof parsed === 'object') return factsFromObject(parsed);
    }
    const out = { ...empty };
    for (const line of raw.split('\n')) {
        const l = line.trim();
        let m;
        if (!out.date && (m = l.match(/^(?:Date:|📅:?)\s*(.+)$/))) out.date = m[1].trim();
        else if (!out.time && (m = l.match(/^(?:Time:|🕒:?)\s*(.+)$/))) out.time = m[1].trim();
        else if (!out.location && (m = l.match(/^(?:Location:|🗺️:?)\s*(.+)$/))) out.location = m[1].trim();
    }
    return out;
}

/**
 * The instruction the next generation reads. The montage first, brief and
 * in summary; then the quest's first scene at its threshold, the first move
 * the player's; never the quest itself. The date, time and place of now
 * anchor the skip; the tracker moves them to where the cut lands.
 */
export function buildQuestCutInstruction({ quest, when = '', userName = 'the player', facts = {}, otherQuests = [] } = {}) {
    const q = cleanQuest(quest);
    if (!q) return '';
    const now = [facts.date, facts.time, facts.location ? `at ${facts.location}` : ''].map(s => String(s || '').trim()).filter(Boolean).join(', ');
    const nowClause = now ? ` from now (${now})` : ' from now';
    const w = cleanWhen(when);
    const whenClause = w
        ? ` It begins ${w}.`
        : ' How much time passes is yours to judge from the quest: hours or days, whatever it plausibly takes.';
    const others = (otherQuests || []).map(cleanQuest).filter(t => t && t !== 'None' && t !== q);
    const othersClause = others.length ? ` The other quests (${others.join('; ')}) stay as they are unless the skip plainly touches them.` : '';
    return `[CUT TO A QUEST: ${userName} has chosen to skip ahead to this quest: "${q}". This reply is the cut. First, a brief montage of a paragraph or two: what passes${nowClause} until the moment this quest begins, the travel, rest and errands and the hours or days they take, told in summary and never played out.${whenClause} Then open on the quest's first scene at its threshold: the place, who is there, the first thing that happens, and stop with the first move still ${userName}'s. Do not play the quest or resolve any part of it in this reply.${othersClause} Everything else about your reply is unchanged: the tracker data block and everything else you are required to output still follow as usual, with the date, time and location moved to where the cut lands and what ${userName} carries kept consistent with the skip.]`;
}
