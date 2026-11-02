/**
 * Canon (docs/hooks-canon-plan.md D105–D112): what the story has
 * established, kept as a ledger per chat: people with one line each,
 * places, things, facts, promises, secrets. A background request every N
 * replies adds to it from the recent scenes and drops what the scenes
 * contradict; one compact block tells the narrator what stands. The pure
 * parts: the rules, the ledger, the request and its reading, the block,
 * the rewind, the export. No SillyTavern: tools/canon-test.mjs imports
 * this directly.
 */
import { jsonObjectsIn } from './liveWorld.js';

export const CANON_SLOT = 'dooms-canon';
export const CANON_KINDS = Object.freeze(['person', 'place', 'thing', 'fact', 'promise', 'secret']);
export const KIND_LABELS = Object.freeze({ person: 'People', place: 'Places', thing: 'Things', fact: 'Facts', promise: 'Promises', secret: 'Secrets' });
export const PER_KIND = 40;
export const TOTAL = 160;
export const MAX_NAME = 60;
export const MAX_TEXT = 200;
export const COUNTED_KEEP = 400;
export const ADDS_PER_RUN = 8;
export const DROPS_PER_RUN = 4;

const clean = (v, max = 200) => String(v ?? '').normalize('NFC').replace(/\s+/g, ' ').trim().slice(0, max);
const isInt = (n) => Number.isInteger(n);
const cloneState = (s) => JSON.parse(JSON.stringify(s));

/** One key per (kind, name): case, punctuation and spacing apart. */
export function canonKey(kind, name) {
    return `${kind}|${clean(name, MAX_NAME).toLowerCase().replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ').trim()}`;
}
const nameKey = (name) => canonKey('', name).slice(1);

// ─── The rules ──────────────────────────────────────────────────────────

const CONFIG_DEFAULTS = Object.freeze({
    enabled: false,          // off until switched on: a background request every N replies is the user's call
    every: 8,                // replies between runs
    recentMessages: 16,      // the window each run reads
    inject: true,            // the block rides every generation while on
    depth: 3,
    role: 'system',
    maxChars: 1500,          // the block's size
    debug: false,
});

export function defaultCanonConfig() {
    return { ...CONFIG_DEFAULTS };
}

/** settings.canon with the defaults filled in and every value within its range. */
export function canonConfig(settings) {
    const c = settings && settings.canon && typeof settings.canon === 'object' ? settings.canon : {};
    const int = (v, lo, hi, d) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
    return {
        enabled: c.enabled === true,
        every: int(c.every, 1, 50, CONFIG_DEFAULTS.every),
        recentMessages: int(c.recentMessages, 4, 60, CONFIG_DEFAULTS.recentMessages),
        inject: c.inject !== false,
        depth: int(c.depth, 0, 20, CONFIG_DEFAULTS.depth),
        role: c.role === 'user' || c.role === 'assistant' ? c.role : 'system',
        maxChars: int(c.maxChars, 300, 6000, CONFIG_DEFAULTS.maxChars),
        debug: c.debug === true,
    };
}

// ─── The ledger ─────────────────────────────────────────────────────────

export function emptyCanon() {
    return { v: 1, entries: [], counted: [], sinceLast: 0, last: null, lastError: null, retryNext: false, seq: 0 };
}

function cleanEntry(e, s) {
    if (!e || typeof e !== 'object') return null;
    const name = clean(e.name, MAX_NAME);
    const text = clean(e.text, MAX_TEXT);
    if (!name || !text) return null;
    return {
        id: clean(e.id, 24) || `c${++s.seq}`,
        kind: CANON_KINDS.includes(String(e.kind || '').toLowerCase()) ? String(e.kind).toLowerCase() : 'fact',
        name,
        text,
        msgId: typeof e.msgId === 'string' ? e.msgId : null,
        gameDate: clean(e.gameDate, 80),
        at: Number.isFinite(e.at) ? e.at : 0,
        pinned: e.pinned === true,
        by: e.by === 'you' ? 'you' : 'ai',
    };
}

/** A stored ledger made safe: one entry per kind and name (the later wins), the caps kept, the counts and the runs as they were. */
export function normalizeCanon(raw) {
    const r = raw && typeof raw === 'object' ? raw : {};
    const s = emptyCanon();
    s.seq = isInt(r.seq) && r.seq >= 0 ? r.seq : 0;
    const seen = new Map();
    for (const e of Array.isArray(r.entries) ? r.entries : []) {
        const c = cleanEntry(e, s);
        if (!c) continue;
        const key = canonKey(c.kind, c.name);
        const prev = seen.get(key);
        if (prev) c.id = prev.id;    // the later line wins, under the first id
        seen.set(key, c);
    }
    s.entries = capEntries([...seen.values()]);
    s.counted = (Array.isArray(r.counted) ? r.counted : []).filter(x => typeof x === 'string' && x).slice(-COUNTED_KEEP);
    s.sinceLast = isInt(r.sinceLast) && r.sinceLast >= 0 ? r.sinceLast : 0;
    s.last = r.last && typeof r.last === 'object' ? { msgId: typeof r.last.msgId === 'string' ? r.last.msgId : null, ranAt: Number.isFinite(r.last.ranAt) ? r.last.ranAt : 0, ok: r.last.ok === true, added: isInt(r.last.added) ? r.last.added : 0, dropped: isInt(r.last.dropped) ? r.last.dropped : 0, gameDate: clean(r.last.gameDate, 80) } : null;
    s.lastError = r.lastError && typeof r.lastError === 'object' ? { error: clean(r.lastError.error, 300), kind: r.lastError.kind === 'error' ? 'error' : 'invalid', ranAt: Number.isFinite(r.lastError.ranAt) ? r.lastError.ranAt : 0 } : null;
    s.retryNext = r.retryNext === true;
    return s;
}

/** The caps: at most PER_KIND of a kind and TOTAL in all, the oldest unpinned going first. */
function capEntries(list) {
    const out = list.slice();
    const evict = (candidates, over) => {
        const unpinned = candidates.filter(e => !e.pinned).sort((a, b) => (a.at || 0) - (b.at || 0));
        for (const e of unpinned.slice(0, over)) { const i = out.indexOf(e); if (i >= 0) out.splice(i, 1); }
    };
    for (const kind of CANON_KINDS) {
        const mine = out.filter(e => e.kind === kind);
        if (mine.length > PER_KIND) evict(mine, mine.length - PER_KIND);
    }
    if (out.length > TOTAL) evict(out, out.length - TOTAL);
    return out;
}

/** A reply counted once; a swipe or a regenerate reuses its id and is not counted again. */
export function countCanonReply(state, id) {
    if (!id || state.counted.includes(id)) return { state, counted: false };
    const next = cloneState(state);
    next.counted.push(id);
    if (next.counted.length > COUNTED_KEEP) next.counted.splice(0, next.counted.length - COUNTED_KEEP);
    next.sinceLast += 1;
    return { state: next, counted: true };
}

export function canonDue(state, every) {
    return state.retryNext || state.sinceLast >= Math.max(1, every);
}

// ─── The request ────────────────────────────────────────────────────────

/** The ledger as the request shows it: one line per entry, by kind, pinned first. */
function ledgerLines(entries, { maxChars = 4000 } = {}) {
    const lines = [];
    for (const kind of CANON_KINDS) {
        const mine = entries.filter(e => e.kind === kind);
        if (!mine.length) continue;
        lines.push(`${KIND_LABELS[kind]}:`);
        for (const e of sortForBlock(mine)) lines.push(`- ${e.name}: ${e.text}`);
    }
    let text = lines.join('\n');
    if (text.length > maxChars) text = `${text.slice(0, maxChars - 1).trimEnd()}…`;
    return text;
}

function sortForBlock(list) {
    return list.slice().sort((a, b) => (b.pinned - a.pinned) || ((b.at || 0) - (a.at || 0)));
}

/**
 * The request (D107): the ledger so far, the recent scenes, the exact
 * JSON asked for. Only what the scenes establish, in present tense, one
 * line each; a change to an entry is an add under the same kind and name.
 * @returns {{ system: string, user: string }}
 */
export function buildCanonPrompt({ entries = [], recent = '', now = {}, player = '', names = [] } = {}) {
    const players = (Array.isArray(player) ? player : [player]).map(p => clean(p, MAX_NAME)).filter(Boolean);
    const known = (Array.isArray(names) ? names : []).map(n => clean(n, MAX_NAME)).filter(Boolean).slice(0, 40);
    const system = `You keep the canon of a roleplay: the facts the story has established, as a ledger of one-line entries. You never write story and you never guess. From the ledger so far and the recent scenes, answer with ONE JSON object and nothing else:
{"add":[{"kind":"person|place|thing|fact|promise|secret","name":"<who or what, as the story spells it>","text":"<one line, present tense: the fact as the scenes establish it now>"}],"drop":["<the name of an entry the scenes have made untrue>"]}
Rules: only what the scenes establish outright, never what you infer; a person's line says who they are to the story now (their place in it, what they want, what they have done), not their looks; a place's line what it is and what happened there; a thing's line what it is and who holds it; a fact is anything else established; a promise is something owed or sworn, by whom to whom; a secret is something revealed to the player that others do not know; an entry that changed is an add under the same kind and name (it replaces the old line); at most ${ADDS_PER_RUN} adds and ${DROPS_PER_RUN} drops, the new and the changed first; nothing already in the ledger unless it changed; names as the story spells them${players.length ? `; the player (${players.join(' / ')}) is never an entry` : ''}; no commentary, no code fences.`;
    const user = `The ledger so far:
${ledgerLines(entries) || '(empty)'}
${known.length ? `\nNames the story knows: ${known.join(', ')}\n` : ''}
Now: ${[now.date, now.time].filter(Boolean).join(', ') || 'unknown'}${now.location ? `, at ${now.location}` : ''}.

Recent scenes:
${recent || '(none)'}

Answer with the JSON object only.`;
    return { system, user };
}

/** The first JSON object with add or drop; null when none parses. */
export function parseCanonReply(text) {
    return jsonObjectsIn(text).find(v => 'add' in v || 'drop' in v) || null;
}

/**
 * The reply checked: adds with a kind, a name and a text (an unknown kind
 * is a fact), drops by name; the caps per run; an add that would overwrite
 * a pinned entry is dropped (the user's line stands, D110).
 * @returns {{ ok: boolean, errors: string[], clean: { add: object[], drop: string[] } | null }}
 */
export function validateCanon(reply, state) {
    const errors = [];
    if (!reply || typeof reply !== 'object' || Array.isArray(reply)) return { ok: false, errors: ['The reply is not a JSON object.'], clean: null };
    if (!('add' in reply) && !('drop' in reply)) return { ok: false, errors: ['The reply carries neither add nor drop.'], clean: null };
    const pinned = new Set((state && Array.isArray(state.entries) ? state.entries : []).filter(e => e.pinned).map(e => canonKey(e.kind, e.name)));
    const add = [];
    if (reply.add !== undefined) {
        if (!Array.isArray(reply.add)) errors.push('"add" is not a list.');
        else {
            const seen = new Set();
            for (const a of reply.add) {
                if (!a || typeof a !== 'object') { errors.push('An add is not an object.'); continue; }
                const kindRaw = String(a.kind || '').toLowerCase().trim();
                const kind = CANON_KINDS.includes(kindRaw) ? kindRaw : 'fact';
                const name = clean(a.name, MAX_NAME);
                const text = clean(a.text, MAX_TEXT);
                if (!name || !text) { errors.push('An add has no name or no text.'); continue; }
                const k = canonKey(kind, name);
                if (seen.has(k)) continue;
                if (pinned.has(k)) { errors.push(`"${name}" is pinned; the ledger keeps its own line.`); continue; }
                seen.add(k);
                add.push({ kind, name, text });
                if (add.length >= ADDS_PER_RUN) break;
            }
        }
    }
    const drop = [];
    if (reply.drop !== undefined) {
        if (!Array.isArray(reply.drop)) errors.push('"drop" is not a list.');
        else for (const d of reply.drop) {
            const name = clean(typeof d === 'string' ? d : (d && typeof d === 'object' ? d.name : ''), MAX_NAME);
            if (!name) continue;
            drop.push(name);
            if (drop.length >= DROPS_PER_RUN) break;
        }
    }
    if (errors.some(e => e.includes('is not a list') || e.includes('not a JSON'))) return { ok: false, errors, clean: null };
    if (!add.length && !drop.length) return { ok: true, errors, clean: { add: [], drop: [] } };    // nothing new: a sound answer
    return { ok: true, errors, clean: { add, drop } };
}

/**
 * A validated run written (D108): adds replace the line under the same
 * kind and name (pinned lines stay), new lines are stamped on the reply;
 * drops remove unpinned entries by name, any kind; then the caps, the run
 * noted, the count restarted. Never mutates the input.
 */
export function applyCanon(state, run, { msgId = null, gameDate = '', ranAt = 0 } = {}) {
    const next = cloneState(state);
    let added = 0;
    for (const a of run.add || []) {
        const k = canonKey(a.kind, a.name);
        const i = next.entries.findIndex(e => canonKey(e.kind, e.name) === k);
        if (i >= 0) {
            if (next.entries[i].pinned) continue;
            if (next.entries[i].text === a.text) continue;
            next.entries[i] = { ...next.entries[i], text: a.text, msgId, gameDate: clean(gameDate, 80), at: ranAt, by: 'ai' };
            added++;
            continue;
        }
        next.entries.push({ id: `c${++next.seq}`, kind: a.kind, name: a.name, text: a.text, msgId, gameDate: clean(gameDate, 80), at: ranAt, pinned: false, by: 'ai' });
        added++;
    }
    let dropped = 0;
    for (const name of run.drop || []) {
        const nk = nameKey(name);
        const before = next.entries.length;
        next.entries = next.entries.filter(e => e.pinned || nameKey(e.name) !== nk);
        dropped += before - next.entries.length;
    }
    next.entries = capEntries(next.entries);
    next.last = { msgId, ranAt, ok: true, added, dropped, gameDate: clean(gameDate, 80) };
    next.lastError = null;
    next.sinceLast = 0;
    next.retryNext = false;
    return next;
}

/** A failed run: nothing written, the next new reply runs it again. */
export function failCanon(state, { error = '', kind = 'invalid', ranAt = 0 } = {}) {
    const next = cloneState(state);
    next.retryNext = true;
    next.lastError = { error: clean(error, 300), kind: kind === 'error' ? 'error' : 'invalid', ranAt };
    return next;
}

// ─── Your own lines ─────────────────────────────────────────────────────

/** A line of your own (D110): pinned, so no run rewrites or drops it. The same kind and name replaces. */
export function addCanonEntry(state, { kind = 'fact', name = '', text = '' } = {}, { at = 0 } = {}) {
    const n = clean(name, MAX_NAME);
    const t = clean(text, MAX_TEXT);
    if (!n || !t) return { state, entry: null };
    const next = cloneState(state);
    const k = CANON_KINDS.includes(kind) ? kind : 'fact';
    const key = canonKey(k, n);
    const i = next.entries.findIndex(e => canonKey(e.kind, e.name) === key);
    const entry = { id: i >= 0 ? next.entries[i].id : `c${++next.seq}`, kind: k, name: n, text: t, msgId: i >= 0 ? next.entries[i].msgId : null, gameDate: i >= 0 ? next.entries[i].gameDate : '', at, pinned: true, by: 'you' };
    if (i >= 0) next.entries[i] = entry; else next.entries.push(entry);
    next.entries = capEntries(next.entries);
    return { state: next, entry };
}

export function editCanonEntry(state, id, { name, text, kind } = {}, { at = 0 } = {}) {
    const i = state.entries.findIndex(e => e.id === id);
    if (i < 0) return { state, entry: null };
    const cur = state.entries[i];
    const n = name !== undefined ? clean(name, MAX_NAME) : cur.name;
    const t = text !== undefined ? clean(text, MAX_TEXT) : cur.text;
    const k = kind !== undefined && CANON_KINDS.includes(kind) ? kind : cur.kind;
    if (!n || !t) return { state, entry: null };
    const next = cloneState(state);
    const entry = { ...cur, name: n, text: t, kind: k, pinned: true, by: 'you', at: at || cur.at };
    next.entries[i] = entry;
    // another entry under the same kind and name goes
    next.entries = next.entries.filter((e, j) => j === i || canonKey(e.kind, e.name) !== canonKey(k, n));
    return { state: next, entry };
}

export function pinCanonEntry(state, id, pinned = true) {
    const i = state.entries.findIndex(e => e.id === id);
    if (i < 0) return state;
    const next = cloneState(state);
    next.entries[i].pinned = pinned === true;
    return next;
}

export function removeCanonEntry(state, id) {
    const i = state.entries.findIndex(e => e.id === id);
    if (i < 0) return state;
    const next = cloneState(state);
    next.entries.splice(i, 1);
    return next;
}

// ─── The rewind ─────────────────────────────────────────────────────────

/**
 * The ledger brought back to the chat it sits in (D109): a line stamped
 * on a reply that is gone goes, unless pinned (yours stand); a count for a
 * reply that is gone goes; a run stamped on a gone reply is no longer the
 * last. The same state back when nothing changed.
 * @returns {{ state: object, dropped: number, pruned: number }}
 */
export function reconcileCanon(state, presentIds) {
    const present = new Set(Array.isArray(presentIds) ? presentIds : []);
    const keep = state.entries.filter(e => e.pinned || !e.msgId || present.has(e.msgId));
    const dropped = state.entries.length - keep.length;
    const counted = state.counted.filter(id => present.has(id));
    const pruned = state.counted.length - counted.length;
    const lastGone = !!(state.last && state.last.msgId && !present.has(state.last.msgId));
    if (!dropped && !pruned && !lastGone) return { state, dropped: 0, pruned: 0 };
    const next = cloneState(state);
    next.entries = keep;
    next.counted = counted;
    if (pruned) next.sinceLast = Math.max(0, next.sinceLast - pruned);
    if (lastGone) next.last = null;
    return { state: next, dropped, pruned };
}

// ─── The block, the exports ─────────────────────────────────────────────

/**
 * What the narrator is told (D108): one block, by kind, pinned lines first,
 * then the newest; cut to `maxChars`. '' with nothing to say.
 */
export function buildCanonBlock(state, { maxChars = 1500 } = {}) {
    if (!state || !Array.isArray(state.entries) || !state.entries.length) return '';
    const parts = [];
    for (const kind of CANON_KINDS) {
        const mine = state.entries.filter(e => e.kind === kind);
        if (!mine.length) continue;
        parts.push(`${KIND_LABELS[kind]}: ${sortForBlock(mine).map(e => `${e.name}: ${e.text}`).join('; ')}.`);
    }
    let text = `[CANON — what the story has established. ${parts.join(' ')}]`;
    if (text.length > maxChars) text = `${text.slice(0, Math.max(0, maxChars - 2)).trimEnd()}…]`;
    return text;
}

/** The ledger as Markdown, for a file or a note. */
export function canonToMarkdown(state, { title = 'Canon' } = {}) {
    const lines = [`# ${title}`, ''];
    for (const kind of CANON_KINDS) {
        const mine = (state && Array.isArray(state.entries) ? state.entries : []).filter(e => e.kind === kind);
        if (!mine.length) continue;
        lines.push(`## ${KIND_LABELS[kind]}`, '');
        for (const e of sortForBlock(mine)) lines.push(`- **${e.name}**: ${e.text}${e.gameDate ? ` _(${e.gameDate})_` : ''}`);
        lines.push('');
    }
    return lines.join('\n').trimEnd() + '\n';
}

/**
 * The ledger as lorebook entries (D111): one per line, keyed by its name
 * (a fact or a promise by the words of its name), titled "Canon · kind:
 * name" so a later export finds and rewrites its own entries.
 * @returns {Array<{ comment: string, key: string[], content: string, kind: string }>}
 */
export function canonToLorebookEntries(state) {
    const out = [];
    for (const e of state && Array.isArray(state.entries) ? state.entries : []) {
        const words = e.name.split(/[\s,;:]+/).map(w => w.replace(/[^\p{L}\p{M}\p{N}'-]/gu, '')).filter(w => w.length > 3);
        const key = e.kind === 'person' || e.kind === 'place' || e.kind === 'thing' ? [e.name] : [e.name, ...words.slice(0, 3)];
        out.push({ comment: `Canon · ${e.kind}: ${e.name}`, key: [...new Set(key)], content: `${e.name}: ${e.text}`, kind: e.kind });
    }
    return out;
}

/** One line for a run's result, for the settings page and the toast. */
export function describeCanonResult(r) {
    if (!r) return 'Nothing happened.';
    if (r.ok) return r.added || r.dropped ? `The canon moved: ${r.added} line${r.added === 1 ? '' : 's'} added or changed, ${r.dropped} dropped.` : 'Nothing new to record.';
    if (r.reason === 'off') return 'Canon is off, or no chat is open.';
    if (r.reason === 'running') return 'A run is already going.';
    if (r.reason === 'busy') return 'Another request is running; it runs again on the next reply.';
    if (r.reason === 'stale') return 'The chat changed while it ran; nothing written.';
    if (r.reason === 'invalid') return `The reply broke a rule and was discarded: ${(r.errors || []).join(' ')}`;
    return `Failed: ${r.error || 'the request did not complete'}; it runs again on the next reply.`;
}
