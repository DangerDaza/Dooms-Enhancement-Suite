/**
 * A world's news between its stories (docs/long-shot-plan.md D235).
 *
 * A world may hold a story for each of the player's characters (D216),
 * each with its own date, people, ledger and memory, and until now
 * nothing of one reached another. But they are one world on one
 * timeline: when Jack burns a warehouse down, Eli's story a week later
 * has a burnt warehouse in it.
 *
 * So a scene's End may send out what the wider world would hear of
 * (a world event: one sentence, and who or what it concerns) and how it
 * moved the world's clocks; both are kept with the world, beside its
 * map, not with either story:
 *
 *     hub.news[world] = { share, seq, items: [
 *         { id, kind: 'event', about, text, story, scene, at, date, time, taken: { [story]: scene } },
 *         { id, kind: 'clock', clock, from, to, story, scene, at, date, time, taken },
 *     ] }
 *
 * A scene's Start in another story takes in what has not reached that
 * story yet and is not in its future: an event is told to the openings
 * and the scene's brief and written into the story's ledger as a fact;
 * a clock catches up. What stays a story's own: where people stand, the
 * threads, relationships, the ledger apart from those facts, the quests
 * and the inventory.
 *
 * "Not in its future" is read from the stories' dates, which are free
 * text: a date this cannot read is taken as not later (the news arrives,
 * with its date said), except for a story that has no date at all yet,
 * which waits for one.
 *
 * Pure, no SillyTavern and no DOM: tools/world-news-test.mjs.
 */
import { normalizeCanon, canonKey, MAX_TEXT as CANON_TEXT, MAX_NAME as CANON_NAME } from './canon.js';
import { normalizeWorldState } from './liveWorld.js';

export const NEWS = Object.freeze({
    perAsk: 4,          // world events one request for a scene's record may list
    perEnd: 6,          // world events one End may send out (a long scene's record is written in several requests)
    textChars: 150,     // one event, a sentence
    aboutChars: 40,     // who or what it concerns
    keep: 120,          // items a world keeps: the oldest go first
    perStart: 8,        // events one Start takes in, the oldest first; the rest wait for the next Start
    onByDefault: true,  // a world with two or more stories shares its events unless switched off (the owner)
});

const isObj = (o) => !!o && typeof o === 'object' && !Array.isArray(o);
const isInt = (n) => Number.isInteger(n);
const clean = (v, max = 200) => String(v ?? '').normalize('NFC').replace(/\s+/g, ' ').trim().slice(0, max);
const lower = (v) => clean(v, 400).toLowerCase();

/** Text cut at a word where it is too long, with an ellipsis. */
function cutAtWord(text, max) {
    const t = clean(text, 100000);
    if (t.length <= max) return t;
    const body = t.slice(0, Math.max(1, max - 1));
    const space = body.lastIndexOf(' ');
    return `${(space > max * 0.5 ? body.slice(0, space) : body).replace(/[\s,;:.]+$/, '')}…`;
}

// ─── The store ──────────────────────────────────────────────────────────

export function emptyNews() {
    return { v: 1, share: '', seq: 0, items: [] };
}

function cleanTaken(raw) {
    const out = {};
    if (isObj(raw)) for (const [story, scene] of Object.entries(raw)) { const k = clean(story, 70); if (k) out[k] = clean(scene, 24); }
    return out;
}

function cleanItem(raw) {
    if (!isObj(raw)) return null;
    const base = { id: clean(raw.id, 24), story: clean(raw.story, 70), scene: clean(raw.scene, 24), at: Number.isFinite(raw.at) ? raw.at : 0, date: clean(raw.date, 80), time: clean(raw.time, 80), taken: cleanTaken(raw.taken) };
    if (!base.id || !base.story) return null;
    if (raw.kind === 'clock') {
        const clock = clean(raw.clock, 60);
        if (!clock || !isInt(raw.from) || !isInt(raw.to) || raw.from === raw.to) return null;
        return { ...base, kind: 'clock', clock, from: raw.from, to: raw.to };
    }
    const text = cutAtWord(raw.text, NEWS.textChars);
    if (!text) return null;
    return { ...base, kind: 'event', about: clean(raw.about, NEWS.aboutChars), text };
}

/** A world's news made safe: each item once, the cap kept, the switch as it was set ('' where it never was). */
export function normalizeNews(raw) {
    const r = isObj(raw) ? raw : {};
    const out = emptyNews();
    out.share = r.share === 'on' || r.share === 'off' ? r.share : '';
    out.seq = isInt(r.seq) && r.seq >= 0 ? r.seq : 0;
    const seen = new Set();
    for (const x of Array.isArray(r.items) ? r.items : []) {
        const item = cleanItem(x);
        if (!item || seen.has(item.id)) continue;
        seen.add(item.id);
        out.items.push(item);
        const m = /^n(\d+)$/.exec(item.id);
        if (m && Number(m[1]) > out.seq) out.seq = Number(m[1]);
    }
    if (out.items.length > NEWS.keep) out.items = out.items.slice(out.items.length - NEWS.keep);
    return out;
}

/**
 * Whether a world's stories share their events: only a world with two or
 * more stories has anyone to share with; then as the switch was set, and
 * on where it never was.
 */
export function newsShared(news, stories = 0) {
    if (!(Number(stories) >= 2)) return false;
    const share = isObj(news) ? news.share : '';
    return share === 'on' || (share !== 'off' && NEWS.onByDefault);
}

/** The switch set for a world. */
export function setNewsShare(news, on) {
    return { ...normalizeNews(news), share: on ? 'on' : 'off' };
}

// ─── What a scene sends out ─────────────────────────────────────────────

/**
 * World events made safe: each a sentence and, where given, who or what
 * it concerns; each once (by its text), `max` at the most, the later ones
 * kept where there are more. Reads a list of strings, or of objects in
 * the shapes a model answers in.
 * @returns {Array<{ about: string, text: string }>}
 */
export function cleanEvents(list, { max = NEWS.perEnd } = {}) {
    const out = [];
    const seen = new Set();
    for (const x of Array.isArray(list) ? list : []) {
        if (typeof x !== 'string' && !isObj(x)) continue;
        const text = cutAtWord(isObj(x) ? (x.what ?? x.text ?? x.event ?? x.news ?? '') : x, NEWS.textChars);
        if (!text) continue;
        const k = lower(text);
        if (seen.has(k)) continue;
        seen.add(k);
        const about = isObj(x) ? clean(Array.isArray(x.about) ? x.about.join(', ') : (x.about ?? x.who ?? x.name ?? x.subject ?? ''), NEWS.aboutChars) : '';
        out.push({ about, text });
    }
    return out.length > max ? out.slice(out.length - max) : out;
}

/** What a record's reply lists for the world (the reply's JSON, or null for prose). */
export const readWorldEvents = (reply) => cleanEvents(isObj(reply) ? reply.world : null, { max: NEWS.perAsk });

/** Two lists as one (a record written in passes finds them a page at a time). */
export const mergeEvents = (a, b) => cleanEvents([...(Array.isArray(a) ? a : []), ...(Array.isArray(b) ? b : [])]);

/**
 * What the request for a scene's record is told and asked, where the
 * world's stories share their events: the shape of the answer's part,
 * the rules, and what was listed from the earlier part of a long scene.
 * @param {{ player?: string, soFar?: Array<{ text: string }> }} o
 * @returns {{ shape: string, rules: string, listed: string }}
 */
export function worldAsk({ player = '', soFar = [] } = {}) {
    const who = clean(player, 60) || 'the player';
    const had = cleanEvents(soFar).map(x => `- ${x.text}`).join('\n');
    return {
        shape: '"world": [{"about": "<who or what it concerns, a few words>", "what": "<what happened, one sentence>"}]',
        rules: ` "world": other stories are being told in this same world, with other people at their centre, and they hear of what happens here only as news. List what happened in this scene that people elsewhere in the world would hear of or see for themselves: someone killed, hurt, arrested or gone missing; a fight, a fire or a wreck in the open; a place closed, taken over or destroyed; something announced or made public; a change in who holds power. Each "what" is one sentence of at most ${NEWS.textChars} characters that stands by itself: past tense, people and places by their full names, told as someone who was not there would tell it. ${who} is named in it only where people would know it was them, and is "someone" or left out where they would not. "about" is the person, place or thing it mainly concerns. Never: what was said in private, what only the people in the room know, anyone's feelings or plans, how anyone stands with ${who}, anything the scene keeps secret. At most ${NEWS.perAsk}${had ? ', none that is listed already' : ''}; an empty list where the scene changed nothing the wider world would notice, which is the usual case.`,
        listed: had ? `Already listed for the world from the earlier part of the scene (not to be listed again):\n${had}` : '',
    };
}

/** A clock's value in a world state as its pack allows it (the pack's start where the state has none). */
function clockValue(state, def) {
    const v = state && isObj(state.clocks) && isInt(state.clocks[def.id]) ? state.clocks[def.id] : def.start;
    return Math.min(def.max, Math.max(0, v));
}

/**
 * How a scene moved the world's clocks: each clock of the pack whose
 * value after the scene's End differs from the value before it.
 * @returns {Array<{ clock: string, from: number, to: number }>}
 */
export function clockChanges(before, after, pack) {
    const out = [];
    for (const def of (pack && Array.isArray(pack.clocks) ? pack.clocks : [])) {
        const from = clockValue(before, def);
        const to = clockValue(after, def);
        if (from !== to) out.push({ clock: def.id, from, to });
    }
    return out;
}

/**
 * A scene's End sends its news out. A scene ended again (it was reopened)
 * replaces what its earlier End sent, as far as no other story has taken
 * it in: what has reached a story is part of that story now, and stays.
 * `replaced` is what went, for an Undo of this End to put back.
 * @returns {{ news: object, posted: number, replaced: object[] }}
 */
export function postNews(news, { story = '', scene = '', at = 0, date = '', time = '', events = [], clocks = [] } = {}) {
    const next = normalizeNews(news);
    const s = clean(story, 70);
    const sc = clean(scene, 24);
    if (!s) return { news: next, posted: 0, replaced: [] };
    const goes = (i) => i.story === s && i.scene === sc && !Object.keys(i.taken).length;
    const replaced = next.items.filter(goes);
    next.items = next.items.filter(i => !goes(i));
    const have = new Set(next.items.filter(i => i.story === s && i.scene === sc && i.kind === 'event').map(i => lower(i.text)));
    const stamp = { story: s, scene: sc, at: Number.isFinite(at) ? at : 0, date: clean(date, 80), time: clean(time, 80), taken: {} };
    let posted = 0;
    for (const ev of cleanEvents(events)) {
        if (have.has(lower(ev.text))) continue;
        next.items.push({ id: `n${++next.seq}`, kind: 'event', about: ev.about, text: ev.text, ...stamp, taken: {} });
        posted++;
    }
    for (const c of Array.isArray(clocks) ? clocks : []) {
        if (!isObj(c) || !clean(c.clock, 60) || !isInt(c.from) || !isInt(c.to) || c.from === c.to) continue;
        next.items.push({ id: `n${++next.seq}`, kind: 'clock', clock: clean(c.clock, 60), from: c.from, to: c.to, ...stamp, taken: {} });
        posted++;
    }
    if (next.items.length > NEWS.keep) next.items = next.items.slice(next.items.length - NEWS.keep);
    return { news: next, posted, replaced };
}

/**
 * What a scene sent out is taken back, whether or not a story has taken
 * it in: all of it (the scene is deleted), or with `at` what one End of
 * it sent (that End is undone).
 */
export function withdrawNews(news, { story = '', scene = '', at = null } = {}) {
    const next = normalizeNews(news);
    const before = next.items.length;
    next.items = next.items.filter(i => !(i.story === String(story) && i.scene === String(scene) && (at === null || i.at === at)));
    return { news: next, removed: before - next.items.length };
}

/** Items put back as they were (what an End replaced, when that End is undone): each where its number puts it, none twice. */
export function restoreNews(news, items) {
    const next = normalizeNews(news);
    const have = new Set(next.items.map(i => i.id));
    const back = (Array.isArray(items) ? items : []).map(cleanItem).filter(i => i && !have.has(i.id));
    if (!back.length) return next;
    const no = (i) => { const m = /^n(\d+)$/.exec(i.id); return m ? Number(m[1]) : 0; };
    next.items = [...next.items, ...back].sort((a, b) => no(a) - no(b));
    return normalizeNews(next);
}

/** One item taken out of a world's news by hand. */
export function removeNewsItem(news, id) {
    const next = normalizeNews(news);
    const before = next.items.length;
    next.items = next.items.filter(i => i.id !== String(id));
    return { news: next, removed: before - next.items.length };
}

// ─── Dates ──────────────────────────────────────────────────────────────

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
/** A month's number by its name or its usual short form ("March", "Mar", "Sept."); 0 for any other word. */
function monthNo(word) {
    const w = String(word || '').toLowerCase().replace(/\.$/, '');
    const i = MONTHS.findIndex(m => m === w || (w.length === 3 && m.startsWith(w)) || (w === 'sept' && m === 'september'));
    return i + 1;
}
const calDay = (y, m, d) => (y * 12 + (m - 1)) * 31 + (d - 1);
const okMD = (m, d) => isInt(m) && isInt(d) && m >= 1 && m <= 12 && d >= 1 && d <= 31;

/**
 * A story's date read for its order in time. `kind` says what it was
 * read as: two dates are compared only where both were read the same
 * way. Read: a count ("Day 12", "Week 2, Day 3", "Year 1, Month 4, Day
 * 9"), a date with its year as figures ("2077-03-14", "14/03/2077" where
 * the day is plain) or with the month named ("March 14, 2077", "14th of
 * March 2077", with or without a weekday), and a named month and day
 * with no year. Null for anything else: a calendar of the story's own, a
 * year alone. Figures that could be read two ways ("03/04/2077") carry
 * both readings (`alt` is the day-first one).
 * @returns {{ kind: string, value: number, alt?: number }|null}
 */
export function storyDay(text) {
    const t = clean(text, 120).toLowerCase();
    if (!t) return null;
    // A count of days, with weeks, months and years where the story counts those too.
    const units = {};
    for (const m of t.matchAll(/\b(year|month|week|day)\s*#?\s*(\d{1,6})\b/g)) if (!(m[1] in units)) units[m[1]] = Number(m[2]);
    if ('day' in units) {
        const kind = `count:${['year', 'month', 'week'].filter(u => u in units).map(u => u[0]).join('')}`;
        return { kind, value: (units.year || 0) * 372 + (units.month || 0) * 31 + (units.week || 0) * 7 + units.day };
    }
    // Figures, the year first.
    let m = /\b(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\b/.exec(t);
    if (m && okMD(Number(m[2]), Number(m[3]))) return { kind: 'cal', value: calDay(Number(m[1]), Number(m[2]), Number(m[3])) };
    // Figures, the year last: read only where one of the two cannot be a month.
    m = /\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})\b/.exec(t);
    if (m) {
        const a = Number(m[1]), b = Number(m[2]), y = Number(m[3]);
        if (a > 12 && okMD(b, a)) return { kind: 'cal', value: calDay(y, b, a) };
        if (b > 12 && okMD(a, b)) return { kind: 'cal', value: calDay(y, a, b) };
        if (a === b && okMD(a, b)) return { kind: 'cal', value: calDay(y, a, b) };
        // Either could be the month: both readings are kept, and two dates are in order only where both readings agree.
        return okMD(a, b) && okMD(b, a) ? { kind: 'cal', value: calDay(y, a, b), alt: calDay(y, b, a) } : null;
    }
    // A named month: "March 14, 2077", "14 March 2077", "14th of March", "Mar 14". The first pair that names a month is the date.
    const word = '([a-z]{3,9})\\.?';
    const day = '(\\d{1,2})(?:st|nd|rd|th)?';
    const year = '(?:,?\\s+(\\d{3,4})\\b)?';
    let mo = 0, d = 0, y = null;
    for (const x of t.matchAll(new RegExp(`\\b${word}\\s+${day}\\b${year}`, 'g'))) {
        if (!monthNo(x[1])) continue;
        mo = monthNo(x[1]); d = Number(x[2]); y = x[3] ? Number(x[3]) : null;
        break;
    }
    if (!mo) for (const x of t.matchAll(new RegExp(`\\b${day}\\s+(?:of\\s+)?${word}${year}`, 'g'))) {
        if (!monthNo(x[2])) continue;
        mo = monthNo(x[2]); d = Number(x[1]); y = x[3] ? Number(x[3]) : null;
        break;
    }
    if (!okMD(mo, d)) return null;
    return y === null ? { kind: 'md', value: calDay(0, mo, d) } : { kind: 'cal', value: calDay(y, mo, d) };
}

const DAY_WORDS = [
    [/\bmidnight\b/, 23 * 60 + 59], [/\b(?:pre-?dawn|before dawn|small hours)\b/, 4 * 60], [/\b(?:dawn|sunrise|daybreak|first light)\b/, 6 * 60],
    [/\bearly morning\b/, 7 * 60], [/\blate morning\b/, 11 * 60], [/\bmorning\b/, 9 * 60], [/\b(?:noon|midday)\b/, 12 * 60],
    [/\bearly afternoon\b/, 13 * 60 + 30], [/\blate afternoon\b/, 16 * 60 + 30], [/\bafternoon\b/, 15 * 60],
    [/\b(?:dusk|sunset|twilight|nightfall)\b/, 18 * 60 + 30], [/\bearly evening\b/, 18 * 60], [/\blate evening\b/, 21 * 60 + 30], [/\bevening\b/, 20 * 60],
    [/\blate (?:at )?night\b/, 23 * 60 + 30], [/\bnight\b/, 22 * 60],
];

/** A time of day as minutes past midnight: a clock time, else a word for the part of the day; null where it says neither. A span ("20:00 → 21:40") is read at its end. */
export function dayMinutes(text) {
    const parts = clean(text, 80).toLowerCase().split(/\s*(?:→|->|–|—| to )\s*/).filter(Boolean);
    const t = parts.length ? parts[parts.length - 1] : '';
    if (!t) return null;
    let m = /\b(\d{1,2})[:.](\d{2})\s*(am|pm|a\.m\.|p\.m\.)?/.exec(t);
    if (m) {
        let h = Number(m[1]);
        const min = Number(m[2]);
        const half = m[3] ? m[3].replace(/\./g, '') : '';
        if (half === 'pm' && h < 12) h += 12;
        if (half === 'am' && h === 12) h = 0;
        return h <= 23 && min <= 59 ? h * 60 + min : null;
    }
    m = /\b(\d{1,2})\s*(am|pm|a\.m\.|p\.m\.)/.exec(t);
    if (m) {
        let h = Number(m[1]);
        const half = m[2].replace(/\./g, '');
        if (h < 1 || h > 12) return null;
        if (half === 'pm' && h < 12) h += 12;
        if (half === 'am' && h === 12) h = 0;
        return h * 60;
    }
    for (const [re, v] of DAY_WORDS) if (re.test(t)) return v;
    return null;
}

/**
 * Two moments of the story in order: -1 where the first is earlier, 1
 * where it is later, 0 where they are the same day and the time of day
 * does not part them; null where their dates cannot be compared.
 * @param {{ date?: string, time?: string }} a
 * @param {{ date?: string, time?: string }} b
 */
export function compareWhen(a, b) {
    const da = storyDay(a && a.date);
    const db = storyDay(b && b.date);
    if (!da || !db || da.kind !== db.kind) return null;
    const sign = (x, y) => (x === y ? 0 : x < y ? -1 : 1);
    const order = sign(da.value, db.value);
    // A date whose figures could be read two ways: the order holds only where it is the same under both readings.
    if ((da.alt !== undefined || db.alt !== undefined) && sign(da.alt ?? da.value, db.alt ?? db.value) !== order) return null;
    if (order) return order;
    const ta = dayMinutes(a && a.time);
    const tb = dayMinutes(b && b.time);
    if (ta === null || tb === null || ta === tb) return 0;
    return ta < tb ? -1 : 1;
}

// ─── What a scene takes in ──────────────────────────────────────────────

/**
 * The news a story's next scene takes in: what other stories sent out,
 * has not reached this story yet, and is not in its future by the date
 * the scene opens at. `fresh` is a story that has no date at all yet
 * (nothing has ended in it): it cannot be placed in time, so it waits.
 * Events in the order they were sent, `limit` at the most (the rest wait
 * for the next Start); every clock move that is due.
 * @returns {{ events: object[], clocks: object[], later: number, waiting: number }}
 */
export function newsDue(news, { story = '', date = '', time = '', fresh = false, limit = NEWS.perStart } = {}) {
    const n = normalizeNews(news);
    const s = String(story || '');
    const out = { events: [], clocks: [], later: 0, waiting: 0 };
    if (!s) return out;
    const noDate = !clean(date, 80);
    for (const item of n.items) {
        if (item.story === s || item.taken[s] !== undefined) continue;
        const order = compareWhen({ date: item.date, time: item.time }, { date, time });
        if (order === 1 || (order === null && noDate && fresh)) { out.later++; continue; }
        if (item.kind === 'clock') out.clocks.push(item);
        else if (out.events.length < limit) out.events.push(item);
        else out.waiting++;
    }
    return out;
}

/** The items a Start prepared with that are still there to be taken, and not taken by this story meanwhile. */
export function stillDue(news, due, story) {
    const n = normalizeNews(news);
    const open = new Set(n.items.filter(i => i.taken[String(story)] === undefined).map(i => i.id));
    const keep = (list) => (Array.isArray(list) ? list : []).filter(i => i && open.has(i.id));
    return { events: keep(due && due.events), clocks: keep(due && due.clocks) };
}

/** Items marked as having reached a story, at the scene that took them in. */
export function markTaken(news, story, ids, scene = '') {
    const next = normalizeNews(news);
    const s = clean(story, 70);
    const set = new Set((Array.isArray(ids) ? ids : []).map(String));
    if (!s || !set.size) return next;
    next.items = next.items.map(i => (set.has(i.id) ? { ...i, taken: { ...i.taken, [s]: clean(scene, 24) } } : i));
    return next;
}

/** An event as a line for a request: the sentence, and its date where it has one. */
export const newsLine = (ev) => `${clean(ev && ev.text, NEWS.textChars + 10)}${ev && ev.date ? ` (${clean(ev.date, 40)})` : ''}`;

/** An event as a line of a scene's brief ("Since last time"). */
export const newsBriefLine = (ev) => `Elsewhere${ev && ev.date ? `, ${clean(ev.date, 24)}` : ''}: ${clean(ev && ev.text, NEWS.textChars + 10)}`;

/**
 * The clocks of a story's world caught up with what other stories did to
 * them. A move that raised a clock raises this story's to at least where
 * it went; one that lowered it lowers this story's to at most that: so a
 * move told twice changes nothing, and two stories that each counted the
 * same days do not count them double. Each change is logged as the
 * story's own clock moves are (its public face reaches the news and the
 * scene's brief), marked as come from elsewhere.
 * @returns {{ state: object, moved: number }}
 */
export function applyNewsClocks(state, clocks, pack) {
    const next = normalizeWorldState(state);
    let moved = 0;
    for (const c of Array.isArray(clocks) ? clocks : []) {
        const def = isObj(c) && pack && Array.isArray(pack.clocks) ? pack.clocks.find(x => x.id === c.clock) : null;
        if (!def || !isInt(c.from) || !isInt(c.to) || c.from === c.to) continue;
        const cur = clockValue(next, def);
        const to = Math.min(def.max, Math.max(0, c.to));
        const want = c.to > c.from ? Math.max(cur, to) : Math.min(cur, to);
        if (want === cur) continue;
        next.clocks[def.id] = want;
        next.log.push({ kind: 'clock', clock: def.id, from: cur, to: want, msgId: null, gameDate: clean(c.date, 80), gameTime: clean(c.time, 80), news: clean(c.story, 70) });
        moved++;
    }
    return { state: moved ? normalizeWorldState(next) : next, moved };
}

/**
 * What the clocks that caught up now show, for a request: the public
 * face of each clock whose value changed between two states of a world,
 * as the story's own news words it. A hidden clock, and a step with no
 * public face, say nothing.
 * @returns {string[]}
 */
export function clockNewsLines(before, after, pack, { spoilerFree = false } = {}) {
    const out = [];
    for (const def of (pack && Array.isArray(pack.clocks) ? pack.clocks : [])) {
        if (def.hidden) continue;
        const to = clockValue(after, def);
        if (clockValue(before, def) === to) continue;
        const effect = def.effects && def.effects[to] ? def.effects[to] : '';
        if (effect) out.push(spoilerFree ? effect : `${def.label}: ${effect}`);
    }
    return out;
}

/** What an event is filed under in a ledger: who or what it concerns, else its first words. */
function ledgerName(ev) {
    const about = clean(ev.about, NEWS.aboutChars);
    return about || cutAtWord(String(ev.text || '').replace(/[.!?…]+$/, ''), Math.min(NEWS.aboutChars, CANON_NAME));
}

/**
 * Events written into a story's ledger as facts, each marked as news from
 * elsewhere with its date: the ledger rides every reply, so the story
 * goes on knowing them after the scene they arrived in. A line the
 * player pinned under the same name is theirs and is not replaced.
 * @returns {{ canon: object, added: number }}
 */
export function newsToCanon(canonRaw, events, { at = 0 } = {}) {
    const s = normalizeCanon(canonRaw);
    let added = 0;
    for (const ev of Array.isArray(events) ? events : []) {
        const name = ledgerName(ev);
        if (!name || !ev.text) continue;
        const tail = ` (news from elsewhere${ev.date ? `, ${clean(ev.date, 24)}` : ''})`;
        const text = `${cutAtWord(ev.text, CANON_TEXT - tail.length)}${tail}`;
        const key = canonKey('fact', name);
        const i = s.entries.findIndex(e => canonKey(e.kind, e.name) === key);
        if (i >= 0) {
            if (s.entries[i].pinned || s.entries[i].text === text) continue;
            s.entries[i] = { ...s.entries[i], text, msgId: null, gameDate: clean(ev.date, 80), at, by: 'ai' };
        } else s.entries.push({ id: `c${++s.seq}`, kind: 'fact', name, text, msgId: null, gameDate: clean(ev.date, 80), at, pinned: false, by: 'ai' });
        added++;
    }
    return { canon: added ? normalizeCanon(s) : s, added };
}

/**
 * A story's memory with the news taken in: its world's clocks caught up,
 * and, where the ledger is kept (`canon`), the events written into it.
 * The memory handed in is not changed.
 * @returns {{ memory: object, clocks: number, facts: number }}
 */
export function takeNews(memory, due, pack, { at = 0, canon = false } = {}) {
    const m = isObj(memory) ? memory : null;
    const events = due && Array.isArray(due.events) ? due.events : [];
    const clocks = due && Array.isArray(due.clocks) ? due.clocks : [];
    if (!m || !isObj(m.stores) || (!events.length && !clocks.length)) return { memory, clocks: 0, facts: 0 };
    const stores = { ...m.stores };
    let moved = 0;
    let facts = 0;
    if (clocks.length && stores.dooms_world) { const r = applyNewsClocks(stores.dooms_world, clocks, pack); if (r.moved) { stores.dooms_world = r.state; moved = r.moved; } }
    if (canon && events.length) { const r = newsToCanon(stores.dooms_canon, events, { at }); if (r.added) { stores.dooms_canon = r.canon; facts = r.added; } }
    return { memory: moved || facts ? { ...m, stores } : memory, clocks: moved, facts };
}

/**
 * A world's news for a list: its events, newest first, each with the
 * story it came from and the stories it has reached and has yet to; and
 * how many clock moves are kept beside them.
 * @param {Array<{ id: string, name: string }>} stories  the world's stories
 * @returns {{ events: Array<{ id: string, text: string, about: string, date: string, from: string, reached: string[], waiting: string[] }>, clocks: number }}
 */
export function newsList(news, stories = []) {
    const n = normalizeNews(news);
    const list = (Array.isArray(stories) ? stories : []).filter(x => x && x.id);
    const nameOf = (id) => { const s = list.find(x => x.id === id); return s ? clean(s.name, 80) : ''; };
    const events = n.items.filter(i => i.kind === 'event').reverse().map(i => {
        const others = list.filter(x => x.id !== i.story);
        return { id: i.id, text: i.text, about: i.about, date: i.date, from: nameOf(i.story) || 'another story', reached: others.filter(x => i.taken[x.id] !== undefined).map(x => clean(x.name, 80)), waiting: others.filter(x => i.taken[x.id] === undefined).map(x => clean(x.name, 80)) };
    });
    return { events, clocks: n.items.filter(i => i.kind === 'clock').length };
}

