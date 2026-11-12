/**
 * What a scene's End changed in its world (docs/long-shot-plan.md D206):
 * a log, so that a scene can be deleted and what it did taken back.
 *
 * An End does not only add. It replaces the date and the place, where
 * people stand, the clocks, the counts in the inventory. So an entry of
 * the log is "this was X; the scene made it Y", and taking a scene back
 * puts X where the value is still Y. Where a later scene (or the player)
 * has changed the same thing again it is left as it stands: that is no
 * longer this scene's to take back. A scene can therefore be deleted
 * from the middle of a story, not only from its end, and the answer says
 * how much of what it changed was taken back and how much stays.
 *
 * The log is the difference between the world's entry before the End and
 * after it. Y is kept as a short mark (its length and a hash), X in full:
 * the log of a scene is about as big as what the scene changed, not as
 * big as the world. Pure: no DOM, no SillyTavern.
 *
 * An entry:
 *   { p, op: 'set', h, b }        a value replaced: b was there, the mark of what the scene put is h
 *   { p, op: 'set', h, n: 1 }     a value put where there was none
 *   { p, op: 'add', f, key, h }   an item added to a list whose items are told apart by the field f
 *   { p, op: 'del', f, key, b, i } an item taken out of such a list: b, from place i
 *   { p, op: 'make', b | n, list? } an object or a list made where there was none (taken away again once it is empty)
 * `p` is the path: keys, and { f, key } for an item of such a list.
 */
const isObj = (o) => !!o && typeof o === 'object' && !Array.isArray(o);
const copy = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

/** A value as text with its keys in order, so that two equal values read the same. A key with no value is no key. */
export function stable(v) {
    if (v === undefined) return '';
    if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? '';
    if (Array.isArray(v)) return `[${v.map(x => (x === undefined ? 'null' : stable(x))).join(',')}]`;
    return `{${Object.keys(v).filter(k => v[k] !== undefined).sort().map(k => `${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}`;
}

/** A short mark of a value: its length as text and a 32-bit hash of it. Two values with one mark are taken to be equal. */
export function markOf(v) {
    const s = stable(v);
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return `${s.length}:${(h >>> 0).toString(36)}`;
}

/** The field the items of these lists are told apart by (`id`, else `name`), or '' when they are not that kind of list. */
function keyFieldOf(...lists) {
    for (const f of ['id', 'name']) {
        const ok = lists.every(list => {
            const seen = new Set();
            return list.every(x => {
                if (!isObj(x) || (typeof x[f] !== 'string' && typeof x[f] !== 'number') || x[f] === '') return false;
                const k = String(x[f]);
                if (seen.has(k)) return false;
                seen.add(k);
                return true;
            });
        });
        if (ok) return f;
    }
    return '';
}

function walk(b, a, path, out) {
    if (stable(b) === stable(a)) return;
    if (isObj(a) && (isObj(b) || b === null || b === undefined)) {
        if (!isObj(b)) out.push(b === undefined ? { p: path, op: 'make', n: 1 } : { p: path, op: 'make', b: null });
        const from = isObj(b) ? b : {};
        for (const k of new Set([...Object.keys(from), ...Object.keys(a)])) walk(from[k], a[k], [...path, k], out);
        return;
    }
    // A list that was not there before is read as an empty one where its items have names of their own: each is then the
    // scene's to take back by itself, not the whole list at once (the first End of a world makes every list it has).
    if (Array.isArray(a) && (Array.isArray(b) || ((b === null || b === undefined) && a.length))) {
        const from = Array.isArray(b) ? b : [];
        const f = keyFieldOf(from, a);
        if (f) {
            if (!Array.isArray(b)) out.push(b === undefined ? { p: path, op: 'make', n: 1, list: 1 } : { p: path, op: 'make', b: null, list: 1 });
            const was = new Map(from.map((x, i) => [String(x[f]), { x, i }]));
            const is = new Map(a.map((x) => [String(x[f]), x]));
            for (const [key, { x, i }] of was) if (!is.has(key)) out.push({ p: path, op: 'del', f, key, b: copy(x), i });
            for (const [key, x] of is) {
                if (!was.has(key)) out.push({ p: path, op: 'add', f, key, h: markOf(x) });
                else walk(was.get(key).x, x, [...path, { f, key }], out);
            }
            return;
        }
    }
    out.push(b === undefined ? { p: path, op: 'set', h: markOf(a), n: 1 } : { p: path, op: 'set', h: markOf(a), b: copy(b) });
}

/**
 * What changed between a world's entry before an End and after it. The
 * list of scenes and their count are left out: they are the records
 * themselves, and the scene's own goes when the scene does.
 * @returns {object[]} the log's entries, in the order they were found
 */
export function diffEntry(before, after, { skip = ['scenes', 'seq'] } = {}) {
    const out = [];
    const b = isObj(before) ? before : {};
    const a = isObj(after) ? after : {};
    for (const k of new Set([...Object.keys(b), ...Object.keys(a)])) if (!skip.includes(k)) walk(b[k], a[k], [k], out);
    return out;
}

/** Where a change is, in the player's words: the ledger, where people stand, the threads, the tracker… */
export function areaOf(path) {
    const [a, b, c] = Array.isArray(path) ? path : [];
    if (a === 'continuity') return b === 'people' ? 'people' : b === 'threads' ? 'threads' : 'book';
    if (a === 'memory') {
        if (b === 'stores') return ({ dooms_canon: 'ledger', dooms_world: 'world', dooms_tracker: 'tracker', dooms_inventory: 'inventory', dooms_quests_done: 'quests', dooms_hooks: 'hooks', dooms_atlas: 'map' })[c] || 'other';
        return 'when';
    }
    if (a === 'style') return 'style';
    return 'other';
}

/** The thing a path leads to, and what holds it; null where the way there is gone. */
function reach(root, path) {
    let at = root;
    for (let i = 0; i < path.length - 1; i++) {
        const seg = path[i];
        if (isObj(seg)) { if (!Array.isArray(at)) return null; at = at.find(x => isObj(x) && String(x[seg.f]) === seg.key); }
        else { if (!isObj(at)) return null; at = at[seg]; }
        if (at === undefined || at === null) return null;
    }
    return at;
}
const listAt = (root, path) => { const holder = path.length ? reach(root, [...path, '']) : root; return Array.isArray(holder) ? holder : null; };

function undoOne(root, c) {
    if (c.op === 'add' || c.op === 'del') {
        const list = listAt(root, c.p);
        if (!list) return false;
        const at = list.findIndex(x => isObj(x) && String(x[c.f]) === c.key);
        if (c.op === 'add') {
            if (at < 0 || markOf(list[at]) !== c.h) return false;    // gone already, or changed since: not this scene's to take away
            list.splice(at, 1);
            return true;
        }
        if (at >= 0) return false;    // something of that name is there again
        list.splice(Math.min(Math.max(0, c.i | 0), list.length), 0, copy(c.b));
        return true;
    }
    const holder = reach(root, c.p);
    const key = c.p[c.p.length - 1];
    if (!isObj(holder) || typeof key !== 'string') return false;
    if (c.op === 'make') {
        // The object or the list the scene made, emptied by what was taken back before it: it goes too. One with anything left in it stays.
        const v = holder[key];
        const empty = c.list ? (Array.isArray(v) && !v.length) : (isObj(v) && !Object.keys(v).length);
        if (empty) { if (c.n) delete holder[key]; else holder[key] = null; }
        return null;
    }
    if (markOf(holder[key]) !== c.h) return false;    // changed again since: it stays as it stands
    if (c.n) delete holder[key]; else holder[key] = copy(c.b);
    return true;
}

/**
 * A scene's changes taken back out of a world's entry, as far as they
 * still stand. `ends` is the scene's log: one list of entries for each
 * time it was ended (a scene reopened and ended again has two), oldest
 * first. Nothing is changed in the entry given.
 * @returns {{ entry: object, undone: number, kept: number, areas: Object<string, { undone: number, kept: number }> }}
 */
export function undoChanges(entry, ends) {
    const next = copy(isObj(entry) ? entry : {});
    const areas = {};
    let undone = 0;
    let kept = 0;
    const lists = (Array.isArray(ends) ? ends : []).map(e => (Array.isArray(e) ? e : (e && Array.isArray(e.changes) ? e.changes : [])));
    for (let k = lists.length - 1; k >= 0; k--) {
        for (let i = lists[k].length - 1; i >= 0; i--) {
            const c = lists[k][i];
            if (!c || !Array.isArray(c.p) || !c.p.length) continue;
            const r = undoOne(next, c);
            if (r === null) continue;
            const area = areaOf(c.p);
            if (!areas[area]) areas[area] = { undone: 0, kept: 0 };
            if (r) { undone++; areas[area].undone++; } else { kept++; areas[area].kept++; }
        }
    }
    return { entry: next, undone, kept, areas };
}

/** The areas a log touches, in the order a person would say them, for the question asked before a scene is deleted. */
export function areasInWords(areas) {
    const words = { when: 'the date and the place', tracker: 'the tracker', people: 'where people stand', threads: 'the open threads', ledger: 'the ledger', inventory: 'the inventory', quests: 'the quests', world: 'the world\'s clocks and who is where', hooks: 'the hooks', map: 'the map', style: 'the phrases held back' };
    return Object.keys(words).filter(k => areas && areas[k] && (areas[k].undone + areas[k].kept) > 0).map(k => words[k]);
}
