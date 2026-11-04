/**
 * Quest hooks (docs/hooks-canon-plan.md D100–D104): what the world offers
 * to do next, proposed from what Live World knows that the player could
 * know too (the clocks' public effects, the rumours, who was last seen
 * where, the places visited) and what the quests already hold. The pure
 * parts: the store, the request, its reading and checking, a round
 * offered, a hook taken or set aside, the quest a hook becomes. No
 * SillyTavern: tools/quest-hooks-test.mjs imports this directly.
 */
import { jsonObjectsIn, publicEffects, placeLabel } from './liveWorld.js';
import { MAX_QUEST } from './questCut.js';

export const HOOKS_PER_ROUND = 3;
export const MAX_TAKEN = 30;
export const MAX_SET_ASIDE = 60;
export const MAX_HOOK_TITLE = 60;
export const MAX_HOOK_TEXT = 240;
export const HOOK_KINDS = Object.freeze(['clock', 'person', 'place', 'quest', 'other']);

const clean = (v, max = 200) => String(v ?? '').normalize('NFC').replace(/\s+/g, ' ').trim().slice(0, max);
/** Two texts are the same hook when they match this: case, punctuation and spacing apart. */
export const hookKey = (s) => clean(s, 240).toLowerCase().replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ').trim();

export function emptyHooks() {
    return { v: 1, proposed: [], taken: [], aside: [], last: null, seq: 0 };
}

function cleanHook(h, s) {
    if (!h || typeof h !== 'object') return null;
    const title = clean(h.title, MAX_HOOK_TITLE);
    const text = clean(h.text, MAX_HOOK_TEXT);
    if (!title && !text) return null;
    const id = clean(h.id, 24) || `h${++s.seq}`;
    return {
        id,
        title: title || text.slice(0, MAX_HOOK_TITLE),
        text: text || title,
        grounds: clean(h.grounds, 120),
        kind: HOOK_KINDS.includes(h.kind) ? h.kind : 'other',
        msgId: typeof h.msgId === 'string' ? h.msgId : null,
        gameDate: clean(h.gameDate, 80),
        at: Number.isFinite(h.at) ? h.at : 0,
    };
}

/** A stored hooks record made safe: a round of at most three, the taken and the set-aside within their caps. */
export function normalizeHooks(raw) {
    const r = raw && typeof raw === 'object' ? raw : {};
    const s = emptyHooks();
    s.seq = Number.isInteger(r.seq) && r.seq >= 0 ? r.seq : 0;
    s.proposed = (Array.isArray(r.proposed) ? r.proposed : []).map(h => cleanHook(h, s)).filter(Boolean).slice(0, HOOKS_PER_ROUND);
    s.taken = (Array.isArray(r.taken) ? r.taken : []).map(h => cleanHook(h, s)).filter(Boolean).slice(-MAX_TAKEN);
    s.aside = (Array.isArray(r.aside) ? r.aside : []).map(x => clean(x, MAX_HOOK_TITLE)).filter(Boolean).slice(-MAX_SET_ASIDE);
    s.last = r.last && typeof r.last === 'object'
        ? { ranAt: Number.isFinite(r.last.ranAt) ? r.last.ranAt : 0, ok: r.last.ok === true, error: clean(r.last.error, 300), msgId: typeof r.last.msgId === 'string' ? r.last.msgId : null }
        : null;
    return s;
}

const playerList = (player) => (Array.isArray(player) ? player : [player]).map(p => clean(p, 60)).filter(Boolean);

/**
 * The request (D101): the world as the player could know it, what the
 * quests hold, what not to offer again, and the exact JSON asked for.
 * Nothing hidden is given: the public effects only, the blurb, the
 * last-seen places of known people, the places visited.
 * @returns {{ system: string, user: string }}
 */
export function buildHooksPrompt({ pack = null, state = null, quests = { main: 'None', optional: [] }, done = [], taken = [], aside = [], recent = '', now = {}, player = '', count = HOOKS_PER_ROUND } = {}) {
    const name = (pack && pack.name) || 'the world';
    const effects = pack && state ? publicEffects(state, pack) : [];
    const blurb = state && state.blurb ? state.blurb : '';
    const known = state && state.known ? state.known : {};
    const people = Object.entries(state && state.where ? state.where : {}).filter(([n]) => known[n] === 'known').slice(0, 20).map(([n, p]) => `- ${n}: ${placeLabel(pack, p)}`);
    const heard = Object.entries(known).filter(([, t]) => t === 'heard').map(([n]) => n).slice(0, 12);
    const places = (state && Array.isArray(state.visited) ? state.visited : []).slice(0, 12).map(e => `- ${e.label || e.id}`);
    const q = quests && typeof quests === 'object' ? quests : {};
    const open = [q.main && q.main !== 'None' ? `- ${q.main} (the main quest)` : '', ...(Array.isArray(q.optional) ? q.optional : []).filter(x => x && x !== 'None').map(x => `- ${x}`)].filter(Boolean);
    const avoid = [...done.map(d => (d && typeof d === 'object' ? d.text : d)), ...taken.map(t => (t && typeof t === 'object' ? t.title : t)), ...aside].map(x => clean(x, 120)).filter(Boolean).slice(-30);
    const players = playerList(player);
    const system = `You offer story hooks for a roleplay set in ${name}: things the player could do next, each grounded in what the world is doing right now. You never write story and you never invent what the world has not shown. Answer with ONE JSON object and nothing else:
{"hooks":[{"title":"<four to six words>","text":"<one or two sentences: what the player could do, where, with whom, and what makes it pressing now>","grounds":"<the clock, person, place or rumour it comes from, in a few words>","kind":"clock|person|place|quest|other"}]}
Rules: ${count} hooks, as different in kind as the world allows; each names a place from the places given or a person from the people given; each follows from a public effect, a rumour, where someone was last seen or a quest that is open; none repeats a quest open, completed, taken or set aside; nothing the player could not know; the player decides, so offer, never command${players.length ? `; the player (${players.join(' / ')}) is never cast as someone to meet` : ''}; no commentary, no code fences.`;
    const user = `World: ${name}${pack && pack.description ? ` — ${pack.description}` : ''}

What the street sees now:
${effects.length ? effects.map(e => `- ${e.text}`).join('\n') : '- nothing in particular'}
${blurb ? `\nWord on the street: ${blurb}\n` : ''}
People and where they were last seen:
${people.join('\n') || '- no one placed yet'}${heard.length ? `\nHeard of, not met: ${heard.join(', ')}` : ''}

Places the story has been, the latest first:
${places.join('\n') || '- none yet'}

Quests open:
${open.join('\n') || '- none'}

Not to be offered again (done, taken or set aside):
${avoid.map(a => `- ${a}`).join('\n') || '- nothing yet'}

Now: ${[now.date, now.time].filter(Boolean).join(', ') || 'unknown'}${now.location ? `, at ${now.location}` : ''}.

Recent scenes:
${recent || '(none)'}

Answer with the JSON object only.`;
    return { system, user };
}

/** The hooks a reply holds: an object with a hooks list, a bare list, or one hook; null when nothing parses. */
export function parseHooksReply(text) {
    const s = String(text || '').trim();
    const objects = jsonObjectsIn(s);
    const withList = objects.find(v => Array.isArray(v.hooks));
    if (withList) return withList.hooks;
    const single = objects.find(v => typeof v.text === 'string' || typeof v.hook === 'string');
    if (single) return [single];
    // A bare list, fenced or not.
    const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(s);
    for (const candidate of [fenced ? fenced[1] : '', s]) {
        const t = String(candidate || '').trim();
        if (!t.startsWith('[')) continue;
        try { const v = JSON.parse(t); if (Array.isArray(v)) return v; } catch (e) { /* next */ }
    }
    return null;
}

/**
 * The reply checked: every hook with a text, none a quest already open,
 * completed, taken or set aside, none a repeat within the round, at most
 * `count`. The round stands with what passes; the errors say what was
 * dropped. Nothing usable fails the round.
 * @returns {{ ok: boolean, errors: string[], hooks: Array<{ title: string, text: string, grounds: string, kind: string }> }}
 */
export function validateHooks(list, { quests = { main: 'None', optional: [] }, done = [], taken = [], aside = [], count = HOOKS_PER_ROUND } = {}) {
    const errors = [];
    if (!Array.isArray(list)) return { ok: false, errors: ['The reply holds no hooks.'], hooks: [] };
    const q = quests && typeof quests === 'object' ? quests : {};
    const avoid = new Set([
        ...done.map(d => hookKey(d && typeof d === 'object' ? d.text : d)),
        ...taken.flatMap(t => (t && typeof t === 'object' ? [hookKey(t.title), hookKey(t.text)] : [hookKey(t)])),
        ...aside.map(hookKey),
        hookKey(q.main === 'None' ? '' : q.main),
        ...(Array.isArray(q.optional) ? q.optional : []).map(hookKey),
    ].filter(Boolean));
    const out = [];
    const seen = new Set();
    for (const h of list) {
        if (!h || typeof h !== 'object') { errors.push('A hook is not an object.'); continue; }
        const title = clean(h.title, MAX_HOOK_TITLE);
        const text = clean(h.text || h.hook, MAX_HOOK_TEXT);
        if (!text) { errors.push('A hook has no text.'); continue; }
        const kTitle = hookKey(title);
        const kText = hookKey(text);
        if ((kTitle && (seen.has(kTitle) || avoid.has(kTitle))) || seen.has(kText) || avoid.has(kText)) {
            errors.push(`"${title || text.slice(0, 40)}" is a quest already open, done, taken or set aside, or a repeat.`);
            continue;
        }
        if (kTitle) seen.add(kTitle);
        seen.add(kText);
        const kind = String(h.kind || '').toLowerCase();
        out.push({ title: title || text.slice(0, MAX_HOOK_TITLE), text, grounds: clean(h.grounds, 120), kind: HOOK_KINDS.includes(kind) ? kind : 'other' });
        if (out.length >= count) break;
    }
    if (!out.length) return { ok: false, errors: errors.length ? errors : ['No usable hook in the reply.'], hooks: [] };
    return { ok: true, errors, hooks: out };
}

/** A new round offered: the hooks given take ids and the reply's stamp; the last round goes. Never mutates the input. */
export function proposeRound(hooks, found, { msgId = null, gameDate = '', ranAt = 0 } = {}) {
    const next = normalizeHooks(hooks);
    next.proposed = (Array.isArray(found) ? found : []).slice(0, HOOKS_PER_ROUND).map(h => ({
        id: `h${++next.seq}`, title: clean(h.title, MAX_HOOK_TITLE), text: clean(h.text, MAX_HOOK_TEXT), grounds: clean(h.grounds, 120),
        kind: HOOK_KINDS.includes(h.kind) ? h.kind : 'other', msgId: typeof msgId === 'string' ? msgId : null, gameDate: clean(gameDate, 80), at: ranAt,
    }));
    next.last = { ranAt, ok: true, error: '', msgId: typeof msgId === 'string' ? msgId : null };
    return next;
}

/** A round that could not be had: the last one stays on offer, the failure noted. */
export function failRound(hooks, { error = '', ranAt = 0, msgId = null } = {}) {
    const next = normalizeHooks(hooks);
    next.last = { ranAt, ok: false, error: clean(error, 300), msgId: typeof msgId === 'string' ? msgId : null };
    return next;
}

/** A hook taken (D102): off the round, onto the taken list. `hook` is null when the id is not on offer. */
export function takeHook(hooks, id, { takenAt = 0 } = {}) {
    const next = normalizeHooks(hooks);
    const i = next.proposed.findIndex(h => h.id === id);
    if (i < 0) return { hooks: next, hook: null };
    const [hook] = next.proposed.splice(i, 1);
    next.taken.push({ ...hook, at: takenAt || hook.at });
    if (next.taken.length > MAX_TAKEN) next.taken.splice(0, next.taken.length - MAX_TAKEN);
    return { hooks: next, hook };
}

/**
 * A hook played that the round no longer holds (another round landed while
 * the Start waited on the line): recorded as taken from what the seed kept
 * of it, so the memory's Played list and the next round's "not again" know
 * it. A hook already taken under that id is left as it is.
 */
export function recordTaken(hooks, hook, { takenAt = 0 } = {}) {
    const next = normalizeHooks(hooks);
    const id = clean(hook && hook.id, 24);
    const title = clean(hook && hook.title, MAX_HOOK_TITLE);
    const text = clean(hook && hook.text, MAX_HOOK_TEXT);
    if (!title && !text) return { hooks: next, hook: null };
    const have = id ? next.taken.find(h => h.id === id) : null;
    if (have) return { hooks: next, hook: have };
    const taken = { id: id || `h${++next.seq}`, title: title || text.slice(0, MAX_HOOK_TITLE), text: text || title, grounds: clean(hook && hook.grounds, 120), kind: HOOK_KINDS.includes(hook && hook.kind) ? hook.kind : 'other', msgId: null, gameDate: '', at: takenAt };
    next.taken.push(taken);
    if (next.taken.length > MAX_TAKEN) next.taken.splice(0, next.taken.length - MAX_TAKEN);
    return { hooks: next, hook: taken };
}

/** A hook set aside (D103): off the round, its title remembered so it is not offered again. */
export function setAside(hooks, id) {
    const next = normalizeHooks(hooks);
    const i = next.proposed.findIndex(h => h.id === id);
    if (i < 0) return { hooks: next, hook: null };
    const [hook] = next.proposed.splice(i, 1);
    if (!next.aside.some(t => hookKey(t) === hookKey(hook.title))) next.aside.push(hook.title);
    if (next.aside.length > MAX_SET_ASIDE) next.aside.splice(0, next.aside.length - MAX_SET_ASIDE);
    return { hooks: next, hook };
}

/** The quest a hook becomes on the shelf: its text, within a quest's length. */
export function questFromHook(hook) {
    return clean(hook && (hook.text || hook.title), MAX_QUEST);
}

/** One line for the Map window's foot after a round was asked for. */
export function describeHooksResult(r) {
    if (!r) return 'Nothing happened.';
    if (r.ok) return `${r.hooks.length} hook${r.hooks.length === 1 ? '' : 's'} on offer.`;
    if (r.reason === 'off') return 'Live World is off, or this chat has no world.';
    if (r.reason === 'running') return 'Hooks are already being asked for.';
    if (r.reason === 'scene-open') return 'A scene is open: its hooks are the Hub window\'s until you end it or set it aside.';
    if (r.reason === 'busy') return 'Another request is running; try again in a moment.';
    if (r.reason === 'stale') return 'The chat changed while the hooks were asked for.';
    if (r.reason === 'invalid') return `No usable hook came back${r.errors && r.errors.length ? `: ${r.errors[0]}` : ''}.`;
    return `Failed: ${r.error || 'the request did not complete'}.`;
}
