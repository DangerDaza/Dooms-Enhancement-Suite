/**
 * What happens when a vital reaches its mark (docs/long-shot-plan.md D233):
 * the roll, the words the narrator is handed, and the line the player
 * reads.
 *
 * A vital's `limit` (src/utils/vitals.js) is one mark and what a reply
 * that carries the value to it sets off: a note for the narrator, or a d20
 * against a DC with a line for each way it can go. The crossing is found
 * there (limitsCrossed); this file settles it into a record, kept on the
 * reply it happened in, and says it.
 *
 * The record of one mark reached:
 *   { vital, icon, who, isPlayer,      whose vital
 *     when, at, from, value, level,    the mark and the move across it
 *     does, text,                      'note' | 'roll', and what the narrator is told
 *     roll, success,                   the d20 (null for a note)
 *     to, ts }                         the value the roll left it at, or null
 *
 * Pure: the die is d20.js's (crypto, or the one handed in), nothing here
 * reads SillyTavern or DES state. tools/vital-limits-test.mjs.
 */
import { rollCheck, formatModifier } from './d20.js';
import { rungOf } from './vitals.js';

/**
 * Settles one crossing (vitals.js limitsCrossed) into its record. For a
 * roll, `sheet` carries what rides on the die when the mark names an
 * attribute: `{ attribute, abbr, score, proficiency }`; without it the die
 * is rolled bare. `criticals`: a natural 20 passes and a natural 1 fails.
 * @param {{ def: object, who: string, isPlayer: boolean, prev: number, next: number }} crossing
 * @param {{ sheet?: object|null, criticals?: boolean, rng?: Function, now?: number }} [opts]
 */
export function settleLimit(crossing, { sheet = null, criticals = true, rng, now = 0 } = {}) {
    const { def, who, isPlayer, prev, next } = crossing;
    const l = def.limit;
    const rung = rungOf(def, next);
    const base = {
        vital: def.name,
        icon: def.icon || '',
        who: String(who || ''),
        isPlayer: !!isPlayer,
        when: l.when,
        at: l.at,
        from: prev,
        value: next,
        level: rung ? rung.label : '',
        does: l.does === 'roll' ? 'roll' : 'note',
        ts: now || Date.now(),
    };
    if (base.does !== 'roll') return { ...base, text: l.note, roll: null, success: null, to: null };
    const s = sheet && typeof sheet === 'object' ? sheet : null;
    const r = rollCheck({
        attribute: s ? s.attribute : '',
        abbr: s ? s.abbr : '',
        score: s ? s.score : 10,
        proficiency: s ? s.proficiency : 0,
        dc: l.dc,
        criticals,
        kind: 'save',
        ...(typeof rng === 'function' ? { rng } : {}),
    });
    return {
        ...base,
        text: r.success ? l.pass : l.fail,
        roll: {
            kept: r.kept, mod: r.mod, prof: r.prof, total: r.total, dc: r.dc,
            success: r.success, critical: r.critical, margin: r.margin,
            attribute: s ? r.attribute : '', abbr: s ? r.abbr : '', score: s ? r.score : null,
        },
        success: r.success,
        to: r.success ? l.passTo : l.failTo,
    };
}

const moved = (e) => (e.when === 'fall' ? 'fallen' : 'risen');
const whose = (e) => `${e.who || 'The player'}'s ${e.vital}`;
const endDot = (t) => { const x = String(t || '').trim(); return x ? (/[.!?]$/.test(x) ? x : `${x}.`) : ''; };

/** "d20 = 7, +1 (WIS 12), +2 (proficient in Wisdom saves) = 10 vs DC 13", or "d20 = 7 vs DC 13" for a bare die. */
export function limitMath(roll) {
    if (!roll) return '';
    const parts = [`d20 = ${roll.kept}`];
    if (roll.attribute || roll.abbr) {
        parts.push(`${formatModifier(roll.mod)}${roll.abbr ? ` (${roll.abbr} ${roll.score})` : ''}`);
        if (roll.prof) parts.push(`+${roll.prof} (proficient in ${roll.attribute || roll.abbr} saves)`);
        return `${parts.join(', ')} = ${roll.total} vs DC ${roll.dc}`;
    }
    return `${parts[0]} vs DC ${roll.dc}`;
}

function outcomeWords(roll) {
    if (roll.critical === 'success') return 'NATURAL 20, a critical success';
    if (roll.critical === 'failure') return 'NATURAL 1, a critical failure';
    return roll.success ? 'SUCCESS' : 'FAILURE';
}

/**
 * The block the narrator is handed for one mark reached: what moved, the
 * roll and its outcome when there was one, what follows, and that it is
 * final.
 */
export function limitVerdict(e) {
    const level = e.level ? ` ("${e.level}")` : '';
    let out = `[STAT: ${whose(e)} has ${moved(e)} to ${e.value}%${level}, reaching its mark of ${e.at}%.`;
    const text = endDot(e.text);
    if (e.does === 'roll' && e.roll) {
        out += ` A roll decides what follows: ${limitMath(e.roll)}. ${outcomeWords(e.roll)}.`;
        if (text) out += ` ${text}`;
        out += ' This outcome is final: narrate it in this reply. Do not re-roll, reverse or soften it.';
        if (typeof e.to === 'number') out += ` ${e.vital} now stands at ${e.to}%: carry on from there.`;
    } else {
        out += text ? ` ${text}` : ' Let this reply show it.';
    }
    return `${out}]`;
}

/**
 * Said after the verdicts, as the dice say it after theirs: a verdict is an
 * instruction about narration, and a model that reads it last tends to
 * answer with narration alone and drop the tracker block.
 */
export const LIMIT_STILL_REQUIRED = 'This says only what has happened. The shape of your reply does not change: the tracker data block still comes exactly where your instructions place it (before the story unless they say otherwise), and everything else they require still follows.';

/** Every record's verdict, then the reminder; '' for none. */
export function limitVerdicts(events) {
    const list = (Array.isArray(events) ? events : []).filter(e => e && typeof e === 'object' && e.vital);
    if (!list.length) return '';
    return [...list.map(limitVerdict), `[${LIMIT_STILL_REQUIRED}]`].join('\n');
}

/** One record in a line for the player: "Eli Vega · Edge reached 100% · d20 7 vs DC 13 · Failed". */
export function limitLine(e) {
    const parts = [`${e.who ? `${e.who} · ` : ''}${e.vital} ${e.when === 'fall' ? 'fell to' : 'reached'} ${e.value}%`];
    if (e.does === 'roll' && e.roll) {
        parts.push(limitMath(e.roll).replace('d20 = ', 'd20 '));
        parts.push(limitOutcome(e));
    }
    return parts.join(' · ');
}

/** The outcome in a word or two for a card: "Passed", "Failed", "Natural 20", "Natural 1"; '' for a note. */
export function limitOutcome(e) {
    if (!e || e.does !== 'roll' || !e.roll) return '';
    if (e.roll.critical === 'success') return 'Natural 20';
    if (e.roll.critical === 'failure') return 'Natural 1';
    return e.roll.success ? 'Passed' : 'Failed';
}
