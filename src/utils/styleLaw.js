/**
 * The style law (docs/long-shot-plan.md D179): what a narrator leans on,
 * counted. A long story's characters flatten into one voice, and the
 * plainest sign of it is the same few phrases in every mouth: one term of
 * endearment used by everyone, one stock gesture. This counts them over
 * the narrator's own messages of a scene (words, never a model's
 * impression), names the ones that recur, and keeps a short list held
 * against the scenes that follow. A phrase that stops turning up drops
 * off the list by itself. Pure: no SillyTavern, no AI; tools/style-law-test.mjs
 * imports this directly.
 */

export const STYLE_MAX_BANS = 10;     // phrases held against the next scenes at the most
export const STYLE_LAPSE = 3;         // scenes a phrase stays on the list after it was last seen
export const STYLE_SHOWN = 12;        // phrases a count reports at the most
export const STYLE_TICKED = 6;        // of which this many are chosen by themselves

const clean = (v, max = 200) => String(v ?? '').normalize('NFC').replace(/\s+/g, ' ').trim().slice(0, max);
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

// Words that carry no style of their own: a phrase neither begins nor ends with one.
const STOP = new Set(`a an the and or but nor so yet for of in on at to from by with without into onto over under up down out off about above below between through across after before again against along among around as back behind beside beyond during inside near outside past since than that then there these this those though till until upon when where which while who whom whose why how what
i me my mine myself we us our ours ourselves you your yours yourself he him his himself she her hers herself it its itself they them their theirs themselves
am is are was were be been being have has had having do does did doing will would shall should can could may might must not no yes if else just very too also only even still such more most much many some any each every all both few own same other another one two
s t d ll m re ve don didn doesn isn wasn aren weren hasn haven hadn won wouldn couldn shouldn ain`.split(/\s+/));

// Words set off by commas in speech that are no way of addressing anyone.
const TAG_WORDS = new Set(`though then too yes no well please now really right okay ok however anyway perhaps maybe still here there again either instead also actually indeed sure fine good great oh ah hm hmm huh eh so and but or because if when while once later soon today tonight tomorrow yesterday always never sometimes often first second third last next finally honestly frankly clearly certainly probably obviously thanks sorry hello hi hey goodbye wait look listen see come go stop enough exactly true false alone together alright`.split(/\s+/));
const TAG_PHRASES = new Set(['of course', 'at least', 'at last', 'after all', 'in fact', 'for now', 'by now', 'even so', 'not yet', 'thank you', 'excuse me', 'never mind', 'i think', 'i suppose', 'i guess', 'you know', 'you see']);
const isTag = (term) => TAG_PHRASES.has(term) || term.split(' ').every(w => TAG_WORDS.has(w) || STOP.has(w));

// A clause, not a name for someone: any of these among the words rules it out.
const CLAUSE = new Set('i we you he she it they is are was were am be do does did have has had will would can could should'.split(' '));

const words = (text) => (String(text || '').toLowerCase().replace(/[’‘]/g, "'").match(/[\p{L}\p{M}][\p{L}\p{M}']*/gu) || []).map(w => w.replace(/'+$/, '')).filter(Boolean);

/**
 * The narrator's own words of a chat, a text a message: the assistant's
 * messages as they stand (`mes` only: swipes are takes that were passed
 * over), with what is no prose taken out (thinking, tracker blocks, code,
 * tags in brackets, markup).
 * @param {Array<object>} chat
 * @returns {string[]}
 */
export function narratorTexts(chat) {
    const out = [];
    for (const m of Array.isArray(chat) ? chat : []) {
        if (!m || typeof m !== 'object' || m.is_user || m.is_system || typeof m.mes !== 'string') continue;
        const text = m.mes
            .replace(/<think>[\s\S]*?<\/think>/gi, ' ')
            .replace(/<trackers?>[\s\S]*?<\/trackers?>/gi, ' ')
            .replace(/```[\s\S]*?```/g, ' ')
            .replace(/<[^>]{1,200}>/g, ' ')
            .replace(/\[(ITEM|CHECK|SAVE)[^\]]*\]/gi, ' ')
            .replace(/[*_~`#>]+/g, ' ')
            .trim();
        if (text) out.push(text);
    }
    return out;
}

/** The words of names (three letters and up), lower-cased: a phrase made of a name is no habit of style. */
function nameWords(names) {
    const out = new Set();
    for (const n of Array.isArray(names) ? names : []) for (const w of words(n)) if (w.length >= 3) out.add(w);
    return out;
}

/** How a phrase is said back: its words as counted. */
const say = (tokens) => tokens.join(' ');

/**
 * What the narrator leaned on in a scene (D179). Over the narrator's
 * texts: the ways of addressing someone that recur in speech (a word or
 * two set off by a comma inside quotes: "sweetheart", "little one"), and
 * the phrases of two to six words that recur. A phrase neither begins
 * nor ends with a function word and holds no one's name; a phrase that
 * is only part of a longer one counted nearly as often is left to the
 * longer. How often is too often scales with the scene's length: at
 * least three times, and a tenth of the narrator's messages for a short
 * phrase (a sixteenth for one of three words and up, and for a way of
 * addressing someone). Chosen by itself (`ticked`): every recurring way
 * of addressing someone, and a phrase half as often again as the mark or
 * in three messages of every eight.
 * @param {string[]} texts          narratorTexts()
 * @param {{ names?: string[] }} o  the people's and the player's names
 * @returns {{ messages: number, phrases: Array<{ phrase: string, kind: 'address'|'phrase', count: number, inMessages: number, ticked: boolean }> }}
 *   the weightiest first, STYLE_SHOWN at the most; `ticked` on the ones worth holding against the next scene
 */
export function countStyle(texts, { names = [] } = {}) {
    const list = (Array.isArray(texts) ? texts : []).filter(t => typeof t === 'string' && t.trim());
    const M = list.length;
    const named = nameWords(names);
    const grams = new Map();      // phrase -> { n, count, inMessages }
    const address = new Map();    // term -> { count, inMessages }
    const leads = [];             // a term before the first comma of a speech, with its message's own set
    const bump = (map, key, extra, seen) => {
        let e = map.get(key);
        if (!e) { e = { ...extra, count: 0, inMessages: 0 }; map.set(key, e); }
        e.count++;
        if (!seen.has(key)) { seen.add(key); e.inMessages++; }
    };
    for (const text of list) {
        const seen = new Set();
        const seenAddress = new Set();
        // Phrases: within a stretch of prose that no stop or quote breaks.
        for (const stretch of text.split(/[.!?…;:,\n"“”()\[\]—–]+/)) {
            const w = words(stretch);
            for (let n = 2; n <= 6; n++) {
                for (let i = 0; i + n <= w.length; i++) {
                    const g = w.slice(i, i + n);
                    if (STOP.has(g[0]) || STOP.has(g[n - 1])) continue;
                    if (g.some(x => named.has(x))) continue;
                    if (g.every(x => x.length <= 2)) continue;
                    bump(grams, say(g), { n }, seen);
                }
            }
        }
        // Ways of addressing someone: in speech, a word or two between a comma and the end of the clause, or before the first comma.
        for (const q of text.match(/["“][^"”]{1,600}["”]/g) || []) {
            const inner = q.slice(1, -1);
            const term = (f) => {
                const w = words(f);
                if (!w.length || w.length > 2) return '';
                const t = say(w);
                if (isTag(t) || w.some(x => CLAUSE.has(x) || named.has(x)) || w[w.length - 1].length < 3) return '';
                return t;
            };
            // After a comma, at the end of a clause: "Careful, sweetheart." That is where someone is addressed.
            for (const m of inner.matchAll(/,\s*([\p{L}\p{M}' ]{2,24}?)\s*(?=[,.!?…]|$)/gu)) { const t = term(m[1]); if (t) bump(address, t, {}, seenAddress); }
            // Before the first comma it may as well be a call or a warning ("Careful, ..."): counted only for a term also met after one.
            const first = /^\s*([\p{L}\p{M}' ]{2,24}?)\s*,/u.exec(inner);
            const lead = first ? term(first[1]) : '';
            if (lead) leads.push({ term: lead, at: seenAddress });
        }
    }
    for (const l of leads) if (address.has(l.term)) bump(address, l.term, {}, l.at);
    const few = Math.max(3, Math.round(M / 16));
    const many = Math.max(3, Math.round(M / 10));
    const out = [];
    for (const [term, e] of address) if (e.count >= few) out.push({ phrase: term, kind: 'address', count: e.count, inMessages: e.inMessages, weight: e.count * 3, over: e.count / few });
    const kept = [...grams].filter(([, e]) => e.count >= (e.n >= 3 ? few : many)).map(([phrase, e]) => ({ phrase, n: e.n, count: e.count, inMessages: e.inMessages }));
    // One stock sentence gives a run of phrases that overlap one another. The most used is kept, the longest of those
    // first; a phrase counted nearly as often that lies inside one already kept, or runs on from its end or into its
    // start (its last words are the other's first), is the same habit.
    kept.sort((a, b) => b.count - a.count || b.n - a.n || a.phrase.localeCompare(b.phrase));
    const joins = (a, b) => {
        if (` ${b} `.includes(` ${a} `)) return true;
        const x = a.split(' '), y = b.split(' ');
        for (let k = 1; k < Math.min(x.length, y.length); k++) {
            if (x.slice(-k).join(' ') === y.slice(0, k).join(' ') || y.slice(-k).join(' ') === x.slice(0, k).join(' ')) return true;
        }
        return false;
    };
    const held = [];
    for (const a of kept) {
        if (held.some(b => b.count * 0.75 <= a.count && a.count * 0.75 <= b.count && joins(a.phrase, b.phrase))) continue;
        held.push(a);
    }
    for (const g of held) {
        if (out.some(o => o.kind === 'address' && o.phrase === g.phrase)) continue;
        // How far past the mark: by the count, and by the share of the messages it is in (in a short scene three uses may be most of it).
        out.push({ phrase: g.phrase, kind: 'phrase', count: g.count, inMessages: g.inMessages, weight: g.count * (g.n - 0.5), over: Math.max(g.count / (g.n >= 3 ? few : many), M ? (g.inMessages / M) / 0.25 : 0) });
    }
    out.sort((a, b) => b.weight - a.weight || b.count - a.count || a.phrase.localeCompare(b.phrase));
    const shown = out.slice(0, STYLE_SHOWN);
    // Chosen by themselves: every way of addressing someone that recurs, and the phrases well past the mark, the weightiest first.
    let ticked = 0;
    const phrases = shown.map(p => {
        const worth = (p.kind === 'address' || p.over >= 1.5) && ticked < STYLE_TICKED;
        if (worth) ticked++;
        return { phrase: p.phrase, kind: p.kind, count: p.count, inMessages: p.inMessages, ticked: worth };
    });
    return { messages: M, phrases };
}

/** How often a phrase turns up in the texts, whole words, whatever the case. */
export function phraseCount(texts, phrase) {
    const want = words(phrase);
    if (!want.length) return 0;
    let n = 0;
    for (const text of Array.isArray(texts) ? texts : []) {
        const w = words(text);
        for (let i = 0; i + want.length <= w.length; i++) {
            let hit = true;
            for (let j = 0; j < want.length; j++) if (w[i + j] !== want[j]) { hit = false; break; }
            if (hit) n++;
        }
    }
    return n;
}

/** A world's style law made safe: { bans: [{ phrase, kind, count, since, idle }] }. */
export function normalizeStyle(raw) {
    const r = isObj(raw) ? raw : {};
    const seen = new Set();
    const bans = [];
    for (const b of Array.isArray(r.bans) ? r.bans : []) {
        if (!isObj(b)) continue;
        const phrase = say(words(clean(b.phrase, 80)));
        if (!phrase || seen.has(phrase)) continue;
        seen.add(phrase);
        bans.push({ phrase, kind: b.kind === 'address' ? 'address' : 'phrase', count: Number.isInteger(b.count) && b.count > 0 ? b.count : 0, since: clean(b.since, 24), idle: Number.isInteger(b.idle) && b.idle >= 0 ? b.idle : 0 });
    }
    return { bans: bans.slice(0, STYLE_MAX_BANS) };
}

/**
 * The law after a scene (D179). A phrase on the list that turned up
 * again stays, with its new count; one that did not has been idle a
 * scene longer, and drops off after STYLE_LAPSE of them. The phrases
 * chosen at this End join it. At most STYLE_MAX_BANS are kept: the ones
 * still turning up first, then the most used.
 * @param {object} style                 the world's law so far
 * @param {object} o
 * @param {string[]} o.texts             the scene's narrator texts
 * @param {Array<{ phrase: string, kind?: string, count?: number }>} o.chosen  the phrases to hold against the next scenes
 * @param {string} o.scene               the scene's id
 */
export function applyStyle(style, { texts = [], chosen = [], scene = '' } = {}) {
    const cur = normalizeStyle(style);
    const next = [];
    for (const b of cur.bans) {
        const n = phraseCount(texts, b.phrase);
        if (n > 0) next.push({ ...b, count: n, idle: 0 });
        else if (b.idle + 1 < STYLE_LAPSE) next.push({ ...b, idle: b.idle + 1 });
    }
    for (const c of Array.isArray(chosen) ? chosen : []) {
        const phrase = say(words(clean(c && c.phrase, 80)));
        if (!phrase) continue;
        const have = next.find(b => b.phrase === phrase);
        const count = Number.isInteger(c.count) && c.count > 0 ? c.count : phraseCount(texts, phrase);
        if (have) { have.count = Math.max(have.count, count); have.idle = 0; if (c.kind === 'address') have.kind = 'address'; }
        else next.push({ phrase, kind: c.kind === 'address' ? 'address' : 'phrase', count, since: clean(scene, 24), idle: 0 });
    }
    next.sort((a, b) => a.idle - b.idle || b.count - a.count || a.phrase.localeCompare(b.phrase));
    return { bans: next.slice(0, STYLE_MAX_BANS) };
}

/** The law as the narrator is told it, one line within a length; '' with nothing on the list. */
export function styleLawText(style, { max = 700 } = {}) {
    const bans = normalizeStyle(style).bans;
    if (!bans.length) return '';
    const parts = bans.map(b => (b.kind === 'address' ? `"${b.phrase}" as a way of addressing anyone` : `"${b.phrase}"`));
    let text = `Style law: the narration leaned on these and does not use them again: ${parts.join('; ')}. Each person speaks in their own way; no pet name or gesture is shared between them.`;
    while (text.length > max && parts.length > 1) {
        parts.pop();
        text = `Style law: the narration leaned on these and does not use them again: ${parts.join('; ')}. Each person speaks in their own way; no pet name or gesture is shared between them.`;
    }
    return text.slice(0, max);
}
