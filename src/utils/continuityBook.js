/**
 * The continuity book (docs/long-shot-plan.md D170, D189): the world's
 * continuity (continuity.js) kept as a real lorebook, the way the owner's
 * hand-made Continuity book is: an entry for each person, keyed by their
 * name, saying where they stand now, and one entry that is always on
 * with the threads left open. SillyTavern's own World Info then carries
 * them into every reply: a person's entry when their name comes up, the
 * threads always.
 *
 * The book is DES's to write and the player's to edit. DES remembers,
 * for each entry it wrote, the entry's id and a mark of the text it last
 * saw there. Before it reads the continuity (an End, a Start) it looks at
 * the book: an entry whose text is no longer the one it saw was changed
 * by hand, and that text is taken as how things stand; an entry that is
 * gone was deleted, and the person's standing goes with it. It writes
 * only the text of entries it made, never their keys, order or switches,
 * never an entry it did not make, and never over a text the player wrote
 * until the story has moved that person on.
 *
 * Pure, no SillyTavern: the book's data is handed in and what to write
 * is handed back. tools/continuity-book-test.mjs. The reading and writing
 * of the file is in src/systems/features/hub.js.
 */
import { normalizeContinuity, nameKey, CONT } from './continuity.js';

export const BOOK_SUFFIX = ' - Scenes Continuity';
export const THREADS_TITLE = 'Open threads';
export const BOOK_ORDER = Object.freeze({ person: 95, threads: 96 });    // after an entry on who a person is (the owner's are at 90): how they stand now is read last
const THREADS_HEAD = 'Still open in the story:';
const THREADS_NONE = 'Nothing is left open in the story right now.';

const clean = (v, max = 200) => String(v ?? '').normalize('NFC').replace(/\s+/g, ' ').trim().slice(0, max);
const isObj = (o) => !!o && typeof o === 'object' && !Array.isArray(o);
const threadKey = (t) => clean(t, 400).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/** The book's name for a campaign or a world: "<name> - Scenes Continuity", safe as a file's name. */
export function continuityBookName(base) {
    const name = clean(base, 60).replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim() || 'World';
    return `${name}${BOOK_SUFFIX}`;
}

/** A mark of a text: the same text gives the same mark (FNV-1a, in hex). */
export function hashText(text) {
    let h = 0x811c9dc5;
    const s = String(text ?? '');
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return (h >>> 0).toString(16).padStart(8, '0');
}

/** A person's entry as DES writes it. */
export const personTitle = (name) => `${clean(name, 60)}: as things stand now`;
export const personContent = (p) => `${clean(p.name, 60)}, as the story stands now: ${clean(p.now, CONT.editChars)}`;

/** The threads' entry as DES writes it. */
export function threadsContent(threads) {
    const list = (Array.isArray(threads) ? threads : []).map(t => clean(isObj(t) ? t.text : t, CONT.threadChars)).filter(Boolean);
    return list.length ? `${THREADS_HEAD}\n${list.map(t => `- ${t}`).join('\n')}` : THREADS_NONE;
}

/** Where a person stands, read from their entry's text: what follows DES's own opening words when they are still there, else the whole of it. */
export function standingFrom(content, name) {
    const text = String(content ?? '').trim();
    const lead = `${clean(name, 60)}, as the story stands now:`;
    return clean(text.toLowerCase().startsWith(lead.toLowerCase()) ? text.slice(lead.length) : text, CONT.editChars);
}

/** The threads read from their entry's text: a line a thread, the heading and the bullets aside. */
export function threadsFrom(content) {
    const out = [];
    const seen = new Set();
    for (const raw of String(content ?? '').split(/\r?\n/)) {
        const line = clean(raw.replace(/^\s*(?:[-*•–]|\d+[.)])\s*/, ''), CONT.threadChars);
        if (!line || line.length < 4 || threadKey(line) === threadKey(THREADS_HEAD) || threadKey(line) === threadKey(THREADS_NONE)) continue;
        if (seen.has(threadKey(line))) continue;
        seen.add(threadKey(line));
        out.push(line);
    }
    return out;
}

/**
 * What the book says that the continuity does not (D189): the entries
 * the player changed by hand taken as how things stand, the ones they
 * deleted let go. Nothing is written. With no book, or one that could not
 * be read, nothing is changed.
 * @param {object} data  the lorebook's data ({ entries: { uid: entry } }), or null
 * @returns {{ cont: object, changed: boolean, adopted: { people: string[], removed: string[], threads: boolean } }}
 */
export function readBook(cont, data) {
    const c = normalizeContinuity(cont);
    const out = { cont: c, changed: false, adopted: { people: [], removed: [], threads: false } };
    if (!c.book || !isObj(data) || !isObj(data.entries)) return out;
    const entries = data.entries;
    const people = c.people.slice();
    const track = { ...c.book.people };
    for (const [k, t] of Object.entries(c.book.people)) {
        const i = people.findIndex(p => nameKey(p.name) === k);
        const e = entries[t.uid];
        if (i < 0) { delete track[k]; out.changed = true; continue; }    // tracked for someone the continuity no longer has
        if (!isObj(e)) {
            out.adopted.removed.push(people[i].name);
            people.splice(i, 1);
            delete track[k];
            out.changed = true;
            continue;
        }
        const content = String(e.content ?? '');
        if (hashText(content) === t.hash) continue;
        const now = standingFrom(content, people[i].name);
        if (!now) { out.adopted.removed.push(people[i].name); people.splice(i, 1); delete track[k]; out.changed = true; continue; }    // emptied: let go, the entry left as it is
        people[i] = { ...people[i], now, by: 'you' };
        track[k] = { uid: t.uid, hash: hashText(content) };
        out.adopted.people.push(people[i].name);
        out.changed = true;
    }
    let threads = c.threads;
    let seq = c.seq;
    let threadsTrack = c.book.threads;
    if (threadsTrack) {
        const e = entries[threadsTrack.uid];
        if (!isObj(e)) { threadsTrack = null; out.changed = true; }    // deleted: the threads stay, the entry is made again when they are next written
        else if (hashText(String(e.content ?? '')) !== threadsTrack.hash) {
            const lines = threadsFrom(e.content);
            const next = [];
            for (const line of lines) {
                const have = c.threads.find(x => threadKey(x.text) === threadKey(line));
                next.push(have ? { ...have, text: line } : { id: `t${++seq}`, text: line, scene: '', at: 0 });
            }
            threads = next;
            threadsTrack = { uid: threadsTrack.uid, hash: hashText(String(e.content ?? '')), by: 'you' };
            out.adopted.threads = true;
            out.changed = true;
        }
    }
    if (out.changed) out.cont = normalizeContinuity({ people, threads, seq, book: { name: c.book.name, people: track, threads: threadsTrack } });
    return out;
}

/**
 * What must be written for the book to say what the continuity says
 * (D189): an entry made for each person who has none, the text changed
 * where a person's standing has moved on since DES last wrote it, the
 * threads' entry made or brought up to date. A text the player wrote is
 * left as they wrote it. `readBook` is run first, so nothing here is
 * written over a change DES has not seen.
 * @param {string} name  the book's name
 * @param {object} data  the lorebook's data, or null for a book not made yet
 * @returns {{ ops: Array<{ op: 'create'|'update', who: string, uid?: number, fields?: object, content?: string }>, people: number, threads: boolean }}
 *   `who` is a person's name, or '#threads'; a create's `fields` are the entry's own (comment, key, content, constant, order, position)
 */
export function planBook(cont, data, { force = false } = {}) {
    const c = normalizeContinuity(cont);
    const entries = isObj(data) && isObj(data.entries) ? data.entries : {};
    const track = c.book || { name: '', people: {}, threads: null };
    const ops = [];
    let people = 0;
    for (const p of c.people) {
        const t = track.people[nameKey(p.name)];
        const content = personContent(p);
        if (t && isObj(entries[t.uid])) {
            // Theirs as they wrote it, or already said. Forced (the continuity was put back to an earlier state, D206), "already said"
            // is asked of the entry itself, not of the mark kept of what was last written there.
            if (p.by === 'you' || (force ? String(entries[t.uid].content ?? '') === content : hashText(content) === t.hash)) continue;
            ops.push({ op: 'update', who: p.name, uid: t.uid, content });
        } else ops.push({ op: 'create', who: p.name, fields: { comment: personTitle(p.name), key: [p.name], content, constant: false, order: BOOK_ORDER.person, position: 0 } });
        people++;
    }
    let threads = false;
    const text = threadsContent(c.threads);
    const tt = track.threads;
    if (tt && isObj(entries[tt.uid])) {
        if (tt.by !== 'you' && (force ? String(entries[tt.uid].content ?? '') !== text : hashText(text) !== tt.hash)) { ops.push({ op: 'update', who: '#threads', uid: tt.uid, content: text }); threads = true; }
    } else if (c.threads.length) { ops.push({ op: 'create', who: '#threads', fields: { comment: THREADS_TITLE, key: [], content: text, constant: true, order: BOOK_ORDER.threads, position: 0 } }); threads = true; }
    return { ops, people, threads };
}

/**
 * The continuity with what was written remembered: for each entry made
 * or changed, its id and the mark of its text. A person whose standing
 * DES has now written is no longer "as the player wrote it".
 * @param {Array<{ who: string, uid: number, content: string }>} written  what was written, with the id each entry has in the book
 */
export function trackWritten(cont, name, written) {
    const c = normalizeContinuity(cont);
    const people = { ...(c.book ? c.book.people : {}) };
    let threads = c.book ? c.book.threads : null;
    for (const w of Array.isArray(written) ? written : []) {
        if (!w || !Number.isInteger(w.uid)) continue;
        const mark = { uid: w.uid, hash: hashText(w.content) };
        if (w.who === '#threads') threads = mark; else people[nameKey(w.who)] = mark;
    }
    return normalizeContinuity({ ...c, book: { name: clean(name, 120) || (c.book ? c.book.name : ''), people, threads } });
}

/** The continuity with its book forgotten (the book was deleted, or is another's now): the standings and the threads stay. */
export function forgetBook(cont) {
    const c = normalizeContinuity(cont);
    return normalizeContinuity({ ...c, book: null });
}

/** The continuity with its book under another name (it was renamed in the Lore Library). */
export function renameBook(cont, name) {
    const c = normalizeContinuity(cont);
    return c.book && clean(name, 120) ? normalizeContinuity({ ...c, book: { ...c.book, name: clean(name, 120) } }) : c;
}
