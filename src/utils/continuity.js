/**
 * The continuity a world's scenes carry (docs/long-shot-plan.md D188):
 * where each person stands now, and the threads the story has left open.
 * It is the part of the owner's chat-to-canon run that a recap alone does
 * not hold: a scene's record says what happened; this says how things
 * stand because of it, person by person, and what is still owed an
 * answer. It is written by the request that writes a scene's record (no
 * request of its own), read and corrected on the End sheet, kept with the
 * world, and told to the next scene's openings and brief for the people
 * who are in it.
 *
 * Pure, no SillyTavern: tools/continuity-test.mjs imports this directly.
 * The request is asked in src/systems/features/hub.js (prepareEnd); the
 * record's own prompt and reading are in src/utils/hub.js.
 */
import { sameName } from './liveWorld.js';

export const CONT = Object.freeze({
    people: 60,          // people a world keeps the standing of
    personChars: 320,    // one person's standing
    threads: 40,         // open threads a world keeps
    threadChars: 180,
    scenePeople: 12,     // people one scene's record may speak of
    sceneOpened: 8,      // threads one scene may open
    promptThreads: 24,   // open threads a record's request is given, the newest
    briefThreads: 6,     // open threads a scene's brief carries, the newest
});

const clean = (v, max = 200) => String(v ?? '').normalize('NFC').replace(/\s+/g, ' ').trim().slice(0, max);
const isObj = (o) => !!o && typeof o === 'object' && !Array.isArray(o);
const key = (t) => clean(t, 400).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const noStop = (s) => String(s || '').replace(/[.;,\s]+$/, '');

export function emptyContinuity() {
    return { people: [], threads: [], seq: 0 };
}

/**
 * A world's continuity made safe: each person once (the later telling
 * wins), each open thread once with an id of its own, within the caps
 * (the people told longest ago and the oldest threads go first).
 * @returns {{ people: Array<{ name: string, now: string, scene: string, at: number }>, threads: Array<{ id: string, text: string, scene: string, at: number }>, seq: number }}
 */
export function normalizeContinuity(raw) {
    const r = isObj(raw) ? raw : {};
    const people = [];
    for (const p of Array.isArray(r.people) ? r.people : []) {
        if (!isObj(p)) continue;
        const name = clean(p.name, 60), now = clean(p.now, CONT.personChars);
        if (!name || !now) continue;
        const one = { name, now, scene: clean(p.scene, 24), at: Number.isFinite(p.at) ? p.at : 0 };
        const i = people.findIndex(x => sameName(x.name, name));
        if (i >= 0) people[i] = { ...one, name: people[i].name }; else people.push(one);    // the name as it was first spelt
    }
    const threads = [];
    const ids = new Set(), texts = new Set();
    let seq = Number.isInteger(r.seq) && r.seq >= 0 ? r.seq : 0;
    for (const t of Array.isArray(r.threads) ? r.threads : []) {
        if (!isObj(t)) continue;
        const text = clean(t.text, CONT.threadChars);
        if (!text || texts.has(key(text))) continue;
        let id = clean(t.id, 24);
        if (!/^t\d+$/.test(id) || ids.has(id)) id = `t${++seq}`;
        ids.add(id);
        texts.add(key(text));
        threads.push({ id, text, scene: clean(t.scene, 24), at: Number.isFinite(t.at) ? t.at : 0 });
    }
    for (const t of threads) { const n = Number(t.id.slice(1)); if (n > seq) seq = n; }
    const byAge = (list) => list.map((x, i) => ({ x, i })).sort((a, b) => (b.x.at - a.x.at) || (b.i - a.i)).map(o => o.x);
    return {
        people: people.length > CONT.people ? byAge(people).slice(0, CONT.people) : people,
        threads: threads.length > CONT.threads ? byAge(threads).slice(0, CONT.threads).reverse() : threads,
        seq,
    };
}

/** Whether a world has any continuity to speak of. */
export const hasContinuity = (cont) => !!(cont && ((cont.people && cont.people.length) || (cont.threads && cont.threads.length)));

// ─── A scene's record: what it is told, what it changes ─────────────────────

/**
 * The continuity as a scene's record finds it: where the scene's people
 * stood before it and the threads open before it, numbered as the request
 * is given them. A record written in passes carries this from pass to
 * pass: `stepDraft` takes what a pass said.
 * @param {string[]} names  the people of the scene
 * @returns {{ people: Array<{ name: string, now: string, was: string, told: boolean }>, threads: Array<{ key: string, text: string, fresh: boolean }>, closed: Array<{ id: string, text: string }>, hidden: number }}
 *   `people`: `was` where they stood before the scene, `told` once the record has spoken of them;
 *   `threads`: the open ones as they stand (a `fresh` one was opened by this scene);
 *   `closed`: threads open before the scene that it settled; `hidden`: older open threads the request is not given
 */
export function continuityDraft(cont, names = []) {
    const c = normalizeContinuity(cont);
    const people = [];
    for (const n of Array.isArray(names) ? names : []) {
        const p = c.people.find(x => sameName(x.name, n));
        if (p && !people.some(x => sameName(x.name, p.name))) people.push({ name: p.name, now: p.now, was: p.now, told: false });
    }
    const given = c.threads.slice(-CONT.promptThreads);
    return { people: people.slice(0, CONT.scenePeople), threads: given.map(t => ({ key: t.id, text: t.text, fresh: false })), closed: [], hidden: c.threads.length - given.length };
}

/** What the record's request is told of the continuity so far: two blocks of text, either or both empty. */
export function draftBlocks(draft, { soFar = false } = {}) {
    const d = draft || { people: [], threads: [] };
    const people = d.people.filter(p => p.now);
    return {
        people: people.length ? `${soFar ? 'Where they stand as of the record so far' : 'Where they stood before this scene'}:\n${people.map(p => `- ${p.name}: ${p.now}`).join('\n')}` : '',
        threads: d.threads.length ? `Open threads:\n${d.threads.map((t, i) => `${i + 1}. ${t.text}`).join('\n')}` : '',
    };
}

/**
 * What a record's reply says of the continuity, checked against the draft
 * it was asked with: the people it speaks of (never the player; someone
 * the scene's text does not name and the world does not know is passed
 * over), the numbers of the listed threads it settles, and the threads it
 * opens (none that is listed already).
 * @param {object|null} reply  the reply's JSON
 * @param {object} o
 * @param {string[]} o.players   the player's names
 * @param {string[]} o.known     names the world knows (the cast, the people met)
 * @param {string} o.text        the scene's text, to check a new name against
 * @returns {{ people: Array<{ name: string, now: string }>, closed: number[], opened: string[] }}
 */
export function readContinuity(reply, draft, { players = [], known = [], text = '' } = {}) {
    const out = { people: [], closed: [], opened: [] };
    if (!isObj(reply)) return out;
    const d = draft || { people: [], threads: [] };
    const low = String(text || '').toLowerCase();
    const names = [...known, ...d.people.map(p => p.name)];
    for (const p of Array.isArray(reply.people) ? reply.people : []) {
        if (!isObj(p) || out.people.length >= CONT.scenePeople) continue;
        let name = clean(p.name, 60);
        const now = clean(p.now ?? p.stands ?? p.state, CONT.personChars);
        if (!name || !now || players.some(x => sameName(x, name)) || out.people.some(x => sameName(x.name, name))) continue;
        const have = names.find(x => sameName(x, name));
        if (have) name = have;    // the world's own spelling of the name
        else if (!low || !low.includes(name.toLowerCase())) continue;    // nobody the scene names
        out.people.push({ name, now });
    }
    const th = isObj(reply.threads) ? reply.threads : {};
    for (const n of Array.isArray(th.closed) ? th.closed : []) {
        const i = Math.round(Number(n));
        if (Number.isFinite(i) && i >= 1 && i <= d.threads.length && !out.closed.includes(i)) out.closed.push(i);
    }
    const listed = new Set(d.threads.map(t => key(t.text)));
    for (const t of Array.isArray(th.opened) ? th.opened : (Array.isArray(reply.threads) ? reply.threads : [])) {
        const line = clean(isObj(t) ? (t.thread ?? t.text) : t, CONT.threadChars);
        if (!line || line.length < 6 || listed.has(key(line)) || out.opened.length >= CONT.sceneOpened) continue;
        listed.add(key(line));
        out.opened.push(line);
    }
    return out;
}

/** The draft after a pass of the record: the people it spoke of stand as it said, the threads it settled are off the list, the ones it opened are on it. */
export function stepDraft(draft, read) {
    const d = draft || { people: [], threads: [], closed: [], hidden: 0 };
    const r = read || { people: [], closed: [], opened: [] };
    const people = d.people.map(p => ({ ...p }));
    for (const p of r.people) {
        const i = people.findIndex(x => sameName(x.name, p.name));
        if (i >= 0) people[i] = { ...people[i], now: p.now, told: true };
        else if (people.length < CONT.scenePeople) people.push({ name: p.name, now: p.now, was: '', told: true });
    }
    const gone = new Set(r.closed.map(n => n - 1));
    const closed = d.closed.slice();
    const threads = [];
    d.threads.forEach((t, i) => {
        if (!gone.has(i)) { threads.push(t); return; }
        if (!t.fresh) closed.push({ id: t.key, text: t.text });    // one this scene opened and settled was never the story's
    });
    let n = Math.max(0, ...d.threads.filter(t => t.fresh).map(t => Number(String(t.key).slice(4)) || 0));    // a new thread's key is its own for the whole of the record
    for (const text of r.opened) if (threads.filter(t => t.fresh).length < CONT.sceneOpened) threads.push({ key: `new:${++n}`, text, fresh: true });
    return { people, threads, closed, hidden: d.hidden || 0 };
}

/**
 * What a scene's record changes in the continuity, as the End sheet
 * shows it and as it is kept when nobody changes it: the people the
 * record spoke of, the threads the scene opened, the ones it settled, and
 * how many stay open untouched.
 * @returns {{ people: Array<{ name: string, now: string, was: string }>, opened: Array<{ key: string, text: string }>, closed: Array<{ id: string, text: string }>, open: number }}
 */
export function draftChanges(draft) {
    const d = draft || { people: [], threads: [], closed: [], hidden: 0 };
    return {
        people: d.people.filter(p => p.told).map(p => ({ name: p.name, now: p.now, was: p.was })),
        opened: d.threads.filter(t => t.fresh).map(t => ({ key: t.key, text: t.text })),
        closed: d.closed.map(t => ({ id: t.id, text: t.text })),
        open: d.threads.filter(t => !t.fresh).length + (d.hidden || 0),
    };
}

/**
 * The continuity after a scene (D188): each person told of stands as the
 * record says (the scene and the time it was said kept with it), the
 * threads settled are gone, the ones opened are added. Everyone and
 * everything else stays as it was.
 * @param {object} change  { people: [{ name, now }], opened: [text | { text }], closed: [thread ids] }
 */
export function applyContinuity(cont, change, { scene = '', at = 0 } = {}) {
    const c = normalizeContinuity(cont);
    const ch = isObj(change) ? change : {};
    const people = c.people.slice();
    for (const p of Array.isArray(ch.people) ? ch.people : []) {
        const name = clean(p && p.name, 60), now = clean(p && p.now, CONT.personChars);
        if (!name || !now) continue;
        const i = people.findIndex(x => sameName(x.name, name));
        const one = { name: i >= 0 ? people[i].name : name, now, scene: clean(scene, 24), at: Number.isFinite(at) ? at : 0 };
        if (i >= 0) people[i] = one; else people.push(one);
    }
    const gone = new Set((Array.isArray(ch.closed) ? ch.closed : []).map(x => clean(isObj(x) ? x.id : x, 24)));
    const threads = c.threads.filter(t => !gone.has(t.id));
    let seq = c.seq;
    const have = new Set(threads.map(t => key(t.text)));
    for (const t of Array.isArray(ch.opened) ? ch.opened : []) {
        const text = clean(isObj(t) ? t.text : t, CONT.threadChars);
        if (!text || have.has(key(text))) continue;
        have.add(key(text));
        threads.push({ id: `t${++seq}`, text, scene: clean(scene, 24), at: Number.isFinite(at) ? at : 0 });
    }
    return normalizeContinuity({ people, threads, seq });
}

/** How many of each a change holds, for the word that says what End kept. */
export function changeCounts(change) {
    const ch = isObj(change) ? change : {};
    const n = (v) => (Array.isArray(v) ? v.length : 0);
    return { people: n(ch.people), opened: n(ch.opened), closed: n(ch.closed) };
}

// ─── The next scene: what it is told ────────────────────────────────────────

/** Where the people of a scene stand, for its openings and its brief: one line a person, for those the world has a standing of. */
export function standingLines(cont, names = [], { max = CONT.personChars } = {}) {
    const c = normalizeContinuity(cont);
    const out = [];
    for (const n of Array.isArray(names) ? names : []) {
        const p = c.people.find(x => sameName(x.name, n));
        if (p && !out.some(x => sameName(x.name, p.name))) out.push({ name: p.name, now: noStop(clean(p.now, max)) });
    }
    return out;
}

/** The open threads a scene is told, the newest first. */
export function threadLines(cont, { count = CONT.briefThreads, max = CONT.threadChars } = {}) {
    const c = normalizeContinuity(cont);
    return c.threads.slice().reverse().slice(0, Math.max(0, count)).map(t => noStop(clean(t.text, max)));
}
