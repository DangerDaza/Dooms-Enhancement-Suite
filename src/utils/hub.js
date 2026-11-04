/**
 * The Hub (docs/hub-plan.md D113–D133): a world played as many small
 * chats. Between scenes the world keeps a sealed snapshot of the chat's own
 * stores (D115); a scene is a fresh chat whose file is written whole and
 * then opened (D118): the snapshot in its header, the brief as its
 * scenario (D120), the chosen opener as its first message with the other
 * two as swipes (D119). End reads the chat back into the snapshot (D122).
 *
 * The pure parts: the rules, the snapshot taken, sealed and seeded, the
 * brief, the openers' request and reading, the first message, the header
 * and the file name, the recap's request and reading, the scene records.
 * No SillyTavern: tools/hub-test.mjs imports this directly. The store, the
 * chat bridge, the requests and the commands live in
 * src/systems/features/hub.js; the window in src/systems/ui/hub.js.
 */
import { normalizeWorldState, jsonObjectsIn, sameName } from './liveWorld.js';
import { normalizeCanon, buildCanonBlock } from './canon.js';
import { normalizeHooks, takeHook as takeHookPure, recordTaken, questFromHook } from './questHooks.js';
import { sceneFactsFrom, cleanWhen } from './questCut.js';

export const HUB_META_KEY = 'dooms_hub';
/** The per-chat stores a snapshot carries, by the keys the chat keeps them under (D115). */
export const HUB_KEYS = Object.freeze(['dooms_tracker', 'dooms_inventory', 'dooms_quests_done', 'dooms_world', 'dooms_canon', 'dooms_hooks']);
export const OPENERS = 3;
export const MAX_OPENER_TITLE = 60;
export const MAX_OPENER_TEXT = 1500;
export const MAX_BRIEF = 2500;
export const MAX_LINE = 200;           // a person's line in the brief
export const MAX_SEED = 400;           // what brought us here
export const MAX_NOTE = 300;           // the player's line
export const MAX_CAST = 12;
export const MAX_TITLE = 60;           // a scene's title
export const MAX_SCENES = 200;
export const RECAP_CHARS = 600;
export const OLD_RECAP_CHARS = 200;    // the recaps of all but the last RECENT_RECAPS
export const RECENT_RECAPS = 20;
export const RECAP_BUDGET = 24000;     // characters of the scene's text a recap or a Canon run over the scene reads
export const SCENE_STATUS = Object.freeze(['open', 'aside', 'ended']);
export const SEED_KINDS = Object.freeze(['place', 'person', 'rumour', 'news', 'hook', 'scene', 'anywhere']);

/** The gaps a scene may start after (D117): the words the advancer and the brief get; `when` takes the player's own words. */
export const GAPS = Object.freeze([
    { id: 'now', label: 'Right after', words: '' },
    { id: 'later', label: 'Later that day', words: 'later that day' },
    { id: 'tomorrow', label: 'The next day', words: 'the next day' },
    { id: 'days', label: 'Days later', words: 'some days later' },
    { id: 'weeks', label: 'Weeks later', words: 'some weeks later' },
    { id: 'when', label: 'When…', words: '' },
]);

const clean = (v, max = 200) => String(v ?? '').normalize('NFC').replace(/\s+/g, ' ').trim().slice(0, max);
const isInt = (n) => Number.isInteger(n);
const copy = (o) => JSON.parse(JSON.stringify(o));
const isObj = (o) => !!o && typeof o === 'object' && !Array.isArray(o);

// ─── The rules ──────────────────────────────────────────────────────────

const CONFIG_DEFAULTS = Object.freeze({
    gap: 'later',          // the Start sheet's first choice
    recapChars: RECAP_CHARS,
    closeOnStart: true,    // the hub closes when a scene opens
});

export function defaultHubConfig() {
    return { ...CONFIG_DEFAULTS };
}

/** settings.hub's rules with the defaults filled in and every value within its range. */
export function hubConfig(settings) {
    const h = settings && isObj(settings.hub) ? settings.hub : {};
    const int = (v, lo, hi, d) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
    return {
        gap: GAPS.some(g => g.id === h.gap && g.id !== 'when') ? h.gap : CONFIG_DEFAULTS.gap,
        recapChars: int(h.recapChars, 200, 1500, CONFIG_DEFAULTS.recapChars),
        closeOnStart: h.closeOnStart !== false,
    };
}

/** A gap as the Start sheet chose it: an id from GAPS, with the player's own words for `when`. */
export function gapOf(id, text = '') {
    const g = GAPS.find(x => x.id === id) || GAPS[0];
    const words = g.id === 'when' ? cleanWhen(text) : g.words;
    return { id: g.id === 'when' && !words ? 'now' : g.id, words };
}

/** Whether the world moves before the scene (anything but Right after). */
export function gapMoves(gap) {
    return !!(gap && gap.id !== 'now' && gap.words);
}

// ─── The store ──────────────────────────────────────────────────────────

export function emptyWorldEntry() {
    return { card: '', memory: null, scenes: [], seq: 0 };
}

function cleanSeed(raw) {
    const s = isObj(raw) ? raw : {};
    return {
        kind: SEED_KINDS.includes(s.kind) ? s.kind : 'anywhere',
        id: clean(s.id, 120),
        label: clean(s.label, 80),
        text: clean(s.text, MAX_SEED),
    };
}

function cleanPlace(raw) {
    const p = isObj(raw) ? raw : { label: raw };
    return { id: clean(p.id, 120), label: clean(p.label, 80), region: clean(p.region, 80) };
}

function cleanGap(raw) {
    const g = isObj(raw) ? raw : {};
    return gapOf(g.id, g.words);
}

export function normalizeScene(raw, seq = 0) {
    const r = isObj(raw) ? raw : {};
    const id = clean(r.id, 24) || `s${seq}`;
    return {
        id,
        title: clean(r.title, MAX_TITLE),
        seed: cleanSeed(r.seed),
        place: cleanPlace(r.place),
        cast: (Array.isArray(r.cast) ? r.cast : []).map(n => clean(n, 60)).filter(Boolean).slice(0, MAX_CAST),
        gap: cleanGap(r.gap),
        chat: clean(r.chat, 200),
        card: clean(r.card, 200),
        startedAt: Number.isFinite(r.startedAt) ? r.startedAt : 0,
        endedAt: Number.isFinite(r.endedAt) ? r.endedAt : 0,
        startDate: clean(r.startDate, 80),
        endDate: clean(r.endDate, 80),
        status: SCENE_STATUS.includes(r.status) ? r.status : 'open',
        recap: clean(r.recap, 1500),
        reopened: r.reopened === true,
        gone: r.gone === true,
        noRecap: r.noRecap === true,
    };
}

export function normalizeMemory(raw) {
    if (!isObj(raw) || !isObj(raw.stores)) return null;
    const stores = {};
    for (const k of HUB_KEYS) if (raw.stores[k] !== undefined && raw.stores[k] !== null) stores[k] = copy(raw.stores[k]);
    const f = isObj(raw.facts) ? raw.facts : {};
    return {
        v: 1,
        takenAt: Number.isFinite(raw.takenAt) ? raw.takenAt : 0,
        scene: clean(raw.scene, 24),
        player: clean(raw.player, 60),
        stores: sealStores(stores),
        facts: { date: clean(f.date, 80), time: clean(f.time, 80), location: clean(f.location, 80), weather: clean(f.weather, 120) },
    };
}

export function normalizeWorldEntry(raw) {
    const r = isObj(raw) ? raw : {};
    const e = emptyWorldEntry();
    e.card = clean(r.card, 200);
    e.memory = normalizeMemory(r.memory);
    e.seq = isInt(r.seq) && r.seq >= 0 ? r.seq : 0;
    const seen = new Set();
    let n = 0;
    for (const s of Array.isArray(r.scenes) ? r.scenes : []) {
        const sc = normalizeScene(s, ++n);
        if (seen.has(sc.id)) continue;
        seen.add(sc.id);
        e.scenes.push(sc);
    }
    for (const sc of e.scenes) { const m = /^s(\d+)$/.exec(sc.id); if (m && Number(m[1]) > e.seq) e.seq = Number(m[1]); }
    return capScenes(e);
}

/** extensionSettings.hub made safe: the rules and every world's entry. */
export function normalizeHub(raw) {
    const r = isObj(raw) ? raw : {};
    const out = { v: 1, ...hubConfig({ hub: r }), worlds: {} };
    if (isObj(r.worlds)) for (const [id, w] of Object.entries(r.worlds)) { const k = clean(id, 60); if (k) out.worlds[k] = normalizeWorldEntry(w); }
    return out;
}

/** The caps (D128): two hundred scenes a world, the recaps of all but the last twenty cut short. Same entry back when nothing changed. */
export function capScenes(entry) {
    let scenes = entry.scenes;
    let changed = false;
    if (scenes.length > MAX_SCENES) { scenes = scenes.slice(scenes.length - MAX_SCENES); changed = true; }
    const cutBefore = scenes.length - RECENT_RECAPS;
    scenes = scenes.map((s, i) => {
        if (i < cutBefore && s.recap.length > OLD_RECAP_CHARS) { changed = true; return { ...s, recap: cutText(s.recap, OLD_RECAP_CHARS) }; }
        return s;
    });
    return changed ? { ...entry, scenes } : entry;
}

/** Text cut to `max` characters at the last sentence end when one is near enough, else at a word, with an ellipsis. */
export function cutText(text, max) {
    const t = clean(text, 100000);
    if (t.length <= max) return t;
    const head = t.slice(0, max);
    // The last sentence end within the head that a space (or the end of the head) follows.
    let stop = -1;
    for (let i = head.length - 1; i >= 0; i--) {
        if (!/[.!?…"”]/.test(head[i])) continue;
        const after = i + 1 < head.length ? head[i + 1] : t[max];
        if (after === ' ' || after === undefined) { stop = i; break; }
    }
    if (stop >= max * 0.6) return head.slice(0, stop + 1).trim();
    const body = t.slice(0, Math.max(0, max - 1));
    const space = body.lastIndexOf(' ');
    return `${(space > max * 0.5 ? body.slice(0, space) : body).trimEnd()}…`;
}

// ─── The snapshot: taken, sealed, seeded ────────────────────────────────

/**
 * Sealed (D115, §3.2): every reply id stripped, so the loaders of a fresh
 * chat, which wind back whatever is tied to a reply the chat does not
 * hold, keep every line. Live World's log, runs and last run get a null
 * id, its count empties, its visits empty (an entry with no visits stands
 * where it is, its picture kept); Canon's lines and last run get a null id
 * and its count empties; the inventory loses its chat binding (Start
 * rewrites it); Hooks' ids are nulled for tidiness. Each store passes
 * through its own normaliser first. Idempotent.
 */
export function sealStores(stores) {
    const out = {};
    const src = isObj(stores) ? stores : {};
    if (src.dooms_world !== undefined && src.dooms_world !== null) {
        const w = normalizeWorldState(src.dooms_world);
        w.log = w.log.map(e => ({ ...e, msgId: null }));
        w.runs = w.runs.map(r => ({ ...r, msgId: null }));
        if (w.last) w.last = { ...w.last, msgId: null };
        w.lastError = null;
        w.retryNext = false;
        w.counted = [];
        w.sinceLast = 0;
        w.visited = w.visited.map(v => ({ ...v, visits: [] }));
        out.dooms_world = w;
    }
    if (src.dooms_canon !== undefined && src.dooms_canon !== null) {
        const c = normalizeCanon(src.dooms_canon);
        c.entries = c.entries.map(e => ({ ...e, msgId: null }));
        if (c.last) c.last = { ...c.last, msgId: null };
        c.lastError = null;
        c.retryNext = false;
        c.counted = [];
        c.sinceLast = 0;
        out.dooms_canon = c;
    }
    if (src.dooms_hooks !== undefined && src.dooms_hooks !== null) {
        const h = normalizeHooks(src.dooms_hooks);
        h.proposed = h.proposed.map(x => ({ ...x, msgId: null }));
        h.taken = h.taken.map(x => ({ ...x, msgId: null }));
        if (h.last) h.last = { ...h.last, msgId: null };
        out.dooms_hooks = h;
    }
    if (isObj(src.dooms_inventory)) {
        const inv = copy(src.dooms_inventory);
        delete inv.chat;
        out.dooms_inventory = inv;
    }
    if (Array.isArray(src.dooms_quests_done)) out.dooms_quests_done = copy(src.dooms_quests_done);
    if (isObj(src.dooms_tracker)) {
        const t = copy(src.dooms_tracker);
        t.syncedExpressionPortraits = {};
        t.syncedExpressionLabels = {};
        if (isObj(t.doomCounterState)) {
            // The counter's total stays; what was pending in the old scene does not (resetCounters' shape).
            t.doomCounterState = { ...t.doomCounterState, pendingTwist: null, pendingTwistIsKnife: false, pendingKnifeCharacter: null, triggered: false, countdownActive: false, lowStreakCount: 0 };
        }
        out.dooms_tracker = t;
    }
    return out;
}

/** The tracker's facts (date, time, location, weather) read from a data object's info box; '' for the unknown. */
export function factsFrom(trackerData) {
    const d = isObj(trackerData) ? trackerData : {};
    const box = parseLoose(d.infoBox);
    const f = sceneFactsFrom(box || d.infoBox || null);
    return { date: clean(f.date, 80), time: clean(f.time, 80), location: clean(f.location, 80), weather: weatherText(box) };
}

/** "🌧 rain over the harbour" from an info box's weather field, in any of its shapes. */
export function weatherText(box) {
    const w = isObj(box) ? box.weather : null;
    if (typeof w === 'string') return clean(w, 120);
    if (!isObj(w)) return '';
    const emoji = clean(w.emoji, 8);
    const text = clean(w.forecast ?? w.text ?? w.value, 100);
    return [emoji, text].filter(Boolean).join(' ');
}

function parseLoose(v) {
    if (isObj(v)) return v;
    if (typeof v !== 'string') return null;
    const s = v.trim().replace(/^```[a-z]*\s*/i, '').replace(/\s*```$/, '');
    if (!s.startsWith('{')) return null;
    try { const o = JSON.parse(s); return isObj(o) ? o : null; } catch (e) { return null; }
}

/**
 * The snapshot taken at End (D122): the chat's stores sealed, the facts
 * from the committed tracker data (the last generated when none is
 * committed), the scene that wrote it.
 */
export function takeSnapshot(chatMeta, { scene = '', takenAt = 0, player = '' } = {}) {
    const meta = isObj(chatMeta) ? chatMeta : {};
    const stores = {};
    for (const k of HUB_KEYS) if (meta[k] !== undefined && meta[k] !== null) stores[k] = meta[k];
    const tracker = isObj(meta.dooms_tracker) ? meta.dooms_tracker : {};
    // The last generated data is the newest (the committed copy lags a reply behind it, Live World's own order).
    const data = isObj(tracker.lastGeneratedData) && tracker.lastGeneratedData.infoBox ? tracker.lastGeneratedData : tracker.committedTrackerData;
    return { v: 1, takenAt, scene: clean(scene, 24), player: clean(player, 60), stores: sealStores(stores), facts: factsFrom(data) };
}

/** A scene is stale when the world's memory was written after it began: ending it would replace what a newer scene wrote (D123). */
export function isStaleScene(scene, memory) {
    if (!scene || !memory || !Number.isFinite(memory.takenAt) || !memory.takenAt) return false;
    const began = Number.isFinite(scene.startedAt) ? scene.startedAt : 0;
    return began > 0 && began < memory.takenAt;
}

/** The snapshot sealed again (an End stamps the opener too; the seal is cheap and idempotent). */
export function sealSnapshot(memory) {
    return normalizeMemory(memory);
}

function setBoxField(box, key, value, shape) {
    if (!value) return;
    const cur = box[key];
    if (key === 'time') {
        if (isObj(cur)) box.time = { ...cur, start: value, end: value };
        else box.time = shape === 'object' ? { start: value, end: value } : value;
        return;
    }
    if (key === 'weather') {
        const m = /^(\p{Extended_Pictographic}[️‍\p{Extended_Pictographic}]*)\s*(.*)$/u.exec(value);
        const emoji = m ? m[1] : '';
        const text = m ? m[2] : value;
        if (isObj(cur) || shape === 'object') box.weather = { ...(isObj(cur) ? cur : {}), emoji: emoji || (isObj(cur) ? cur.emoji : '') || '', forecast: text || emoji };
        else box.weather = value;
        return;
    }
    if (isObj(cur)) box[key] = { ...cur, value };
    else box[key] = shape === 'object' ? { value } : value;
}

/** The present characters' JSON read into { wasArray, list, outer }; an empty list when unreadable. */
function readCharacters(json) {
    const parsed = typeof json === 'string' ? (() => { try { return JSON.parse(json); } catch (e) { return null; } })() : json;
    if (Array.isArray(parsed)) return { wasArray: true, list: parsed, outer: null };
    if (isObj(parsed) && Array.isArray(parsed.characters)) return { wasArray: false, list: parsed.characters, outer: parsed };
    return { wasArray: false, list: [], outer: null };
}

/**
 * The stores a scene's header carries (D118, §3.4): the snapshot sealed
 * again, the tracker's last generated and committed data both pointed at
 * the scene (the place, the cast with the vitals the snapshot knows, the
 * weather, the date and time when given), the inventory bound to the new
 * chat, the seeding hook moved to taken. Returns the stores and the facts
 * the brief says.
 */
export function seedStores(memory, { chatId = '', place = '', cast = [], player = [], weather = '', when = null, hookId = '', hook = null, now = 0 } = {}) {
    const mem = normalizeMemory(memory) || { stores: {}, facts: { date: '', time: '', location: '', weather: '' }, player: '' };
    const stores = sealStores(mem.stores);
    const players = (Array.isArray(player) ? player : [player]).map(p => clean(p, 60)).filter(Boolean);
    // A hook played from the hub is a quest too, as a hook taken in the Map window is (D102): the quest rides the seeded stores.
    // A round that landed while the Start waited no longer holds the hook: what the seed kept of it is recorded as taken instead.
    let hookQuest = '';
    if (hookId && (stores.dooms_hooks || (hook && typeof hook === 'object'))) {
        const taken = takeHookPure(stores.dooms_hooks || null, hookId, { takenAt: now });
        stores.dooms_hooks = taken.hooks;
        let played = taken.hook;
        if (!played && hook && typeof hook === 'object') { const r = recordTaken(stores.dooms_hooks, { ...hook, id: hookId }, { takenAt: now }); stores.dooms_hooks = r.hooks; played = r.hook; }
        if (played) hookQuest = questFromHook(played);
    }
    // The persona's vitals are the persona's: another persona starts fresh (the block carries no name, so the snapshot does).
    const personaChanged = !!(mem.player && players[0] && !sameName(mem.player, players[0]));
    const isPlayer = (n) => players.some(p => sameName(p, n));
    const names = [];
    for (const n of Array.isArray(cast) ? cast : []) { const c = clean(n, 60); if (c && !isPlayer(c) && !names.some(x => sameName(x, c))) names.push(c); }
    const facts = {
        date: when && clean(when.date, 80) ? clean(when.date, 80) : mem.facts.date,
        time: when && clean(when.time, 80) ? clean(when.time, 80) : mem.facts.time,
        location: clean(place, 80) || mem.facts.location,
        weather: clean(weather, 120) || mem.facts.weather,
    };
    const tracker = isObj(stores.dooms_tracker) ? stores.dooms_tracker : {};
    if (!isObj(tracker.quests)) tracker.quests = { main: 'None', optional: [] };
    if (hookQuest && !tracker.quests.optional.some(q => sameName(q, hookQuest))) tracker.quests = { ...tracker.quests, optional: [...tracker.quests.optional, hookQuest] };
    const questsJson = JSON.stringify(tracker.quests);
    const adjust = (data) => {
        const d = isObj(data) ? { ...data } : { quests: null, infoBox: null, characterThoughts: null, player: null };
        d.quests = questsJson;
        if (personaChanged) d.player = null;
        const box = parseLoose(d.infoBox) || {};
        const shape = isObj(box.date) || isObj(box.location) || isObj(box.time) ? 'object' : (d.infoBox ? 'string' : 'object');
        setBoxField(box, 'date', facts.date, shape);
        setBoxField(box, 'time', facts.time, shape);
        setBoxField(box, 'location', facts.location, shape);
        setBoxField(box, 'weather', facts.weather, shape);
        d.infoBox = Object.keys(box).length ? JSON.stringify(box) : d.infoBox;
        const { wasArray, list, outer } = readCharacters(d.characterThoughts);
        const next = names.map(name => {
            const prev = list.find(c => isObj(c) && typeof c.name === 'string' && sameName(c.name, name));
            const base = prev ? { ...prev, name: prev.name } : { name, emoji: '🙂' };
            return { ...base, thoughts: { content: '' } };
        });
        d.characterThoughts = JSON.stringify(wasArray ? next : { ...(outer || {}), characters: next });
        return d;
    };
    // Both copies from the newest data (the committed copy lags a reply behind in a chat; a scene starts with one truth).
    const generated = adjust(tracker.lastGeneratedData && tracker.lastGeneratedData.infoBox ? tracker.lastGeneratedData : (tracker.committedTrackerData || tracker.lastGeneratedData));
    const committed = { ...generated };
    stores.dooms_tracker = { ...tracker, lastGeneratedData: generated, committedTrackerData: committed, syncedExpressionPortraits: {}, syncedExpressionLabels: {}, timestamp: now || tracker.timestamp || 0 };
    if (isObj(stores.dooms_inventory)) stores.dooms_inventory = { ...stores.dooms_inventory, chat: clean(chatId, 200) || null };
    return { stores, facts, cast: names, hookQuest, tracker: { quests: questsJson, infoBox: generated.infoBox || null, characterThoughts: generated.characterThoughts || null, player: generated.player || null } };
}

// ─── The brief ──────────────────────────────────────────────────────────

const noStop = (s) => String(s || '').replace(/[.;,\s]+$/, '');

/** One line for a person in the brief: the Workshop's description cut short, else the pack's line, else the tier word. */
export function personLine(name, { description = '', line = '', tier = '' } = {}) {
    const text = clean(description, MAX_LINE) || clean(line, MAX_LINE) || (tier === 'known' ? 'someone the player knows' : tier === 'heard' ? 'someone the player has heard of' : '');
    return text ? `${clean(name, 60)}: ${text}` : clean(name, 60);
}

/**
 * The brief (D120): the chat's scenario override. At most MAX_BRIEF
 * characters, the older parts cut first: before that, then since last
 * time, then last time, then the people's lines, then the seed.
 */
export function buildBrief({ world = '', sceneNo = 0, place = '', region = '', date = '', time = '', weather = '', gapWords = '', cast = [], seed = '', since = [], lastRecap = '', beforeRecap = '', player = '', note = '' } = {}) {
    const head = `[SCENE BRIEF: ${clean(world, 80) || 'the world'}${sceneNo ? `, scene ${sceneNo}` : ''}.`;
    const whereParts = [];
    if (place) whereParts.push(`Where: ${clean(place, 80)}${region && !sameName(region, place) ? ` (${clean(region, 80)})` : ''}.`);
    const when = [date, time].map(s => clean(s, 80)).filter(Boolean).join(', ');
    if (when || gapWords) whereParts.push(`When: ${[when, gapWords ? `${clean(gapWords, 80)} since the last scene` : ''].filter(Boolean).join('; ')}.`);
    if (weather) whereParts.push(`Weather: ${clean(weather, 120)}.`);
    const parts = {
        where: whereParts.join(' '),
        who: cast.length ? `Who is here: ${cast.slice(0, MAX_CAST).map(c => noStop(typeof c === 'string' ? clean(c, 260) : personLine(c.name, c))).join('; ')}.` : '',
        seed: seed ? `What brought us here: ${clean(seed, MAX_SEED)}` : '',
        since: since.length ? `Since last time: ${since.map(s => noStop(clean(s, 160))).filter(Boolean).slice(0, 12).join('; ')}.` : '',
        last: lastRecap ? `Last time: ${clean(lastRecap, 1500)}` : '',
        before: beforeRecap ? `Before that: ${clean(beforeRecap, 1500)}` : '',
        note: note ? `${clean(player, 60) || 'The player'} wants: ${clean(note, MAX_NOTE)}` : '',
    };
    const end = (s) => (s && !/[.!?…"”\]]$/.test(s) ? `${s}.` : s);
    const assemble = () => [head, parts.where, parts.who, end(parts.seed), parts.since, end(parts.last), end(parts.before), end(parts.note)].filter(Boolean).join('\n') + ']';
    const order = ['before', 'since', 'last', 'who', 'seed', 'note'];
    let text = assemble();
    for (const key of order) {
        if (text.length <= MAX_BRIEF) break;
        const over = text.length - MAX_BRIEF;
        if (!parts[key]) continue;
        if (parts[key].length - over < 40) parts[key] = '';
        else parts[key] = cutText(parts[key], parts[key].length - over - 1);
        text = assemble();
    }
    if (text.length > MAX_BRIEF) text = `${text.slice(0, MAX_BRIEF - 2).trimEnd()}…]`;
    return text;
}

// ─── The openers (D119, §5.1) ───────────────────────────────────────────

/**
 * The request: the public world, the spot, the people, the seed, the gap,
 * the ledger's block, the last recaps, the open quests, the player's line,
 * the narrator's template; and the exact JSON asked for.
 * @returns {{ system: string, user: string }}
 */
export function buildOpenersPrompt({ world = {}, place = '', region = '', weather = '', date = '', time = '', gapWords = '', cast = [], seed = '', canonBlock = '', recaps = [], quests = { main: 'None', optional: [] }, player = '', note = '', count = OPENERS } = {}) {
    const name = clean(world.name, 80) || 'the world';
    const who = clean(player, 60) || 'the player';
    const n = Math.min(OPENERS, Math.max(1, count | 0));
    const system = `You are the narrator of ${name}. A new scene is about to open and you write its first message: how the scene opens, before ${who} has done anything. You answer with one JSON object and nothing else, in exactly this shape:
{"when": {"date": "<the story's date when the scene opens>", "time": "<the time of day>"}, "openers": [{"title": "<four words at most>", "text": "<the opening narration>", "who": ["<names of the people present>"]}]}
Write ${n} opener${n > 1 ? 's' : ''} that differ in what happens, not in wording. Each opener: the place as ${who} finds it, who is there, the first thing that happens, and it stops with the first move still ${who}'s; a paragraph or two, plain prose, no markup, no headings, no dice, nothing resolved or decided. Never speak or act for ${who}. Nobody ${who} has not met is named as a friend. ${world.template ? `The narrator's own rules: ${clean(world.template, 1200)}` : ''}`.trim();
    const people = cast.length ? cast.map(c => (typeof c === 'string' ? clean(c, 260) : personLine(c.name, c))).join('\n- ') : 'no one in particular';
    const q = [quests && quests.main && quests.main !== 'None' ? `Main: ${clean(quests.main, 200)}` : '', ...((quests && Array.isArray(quests.optional)) ? quests.optional.map(x => clean(x, 200)).filter(Boolean).slice(0, 6) : [])].filter(Boolean);
    const user = `World: ${name}${world.blurb ? `. ${clean(world.blurb, 600)}` : ''}
Where the scene opens: ${clean(place, 80) || 'anywhere that fits'}${region && !sameName(region, place) ? ` (${clean(region, 80)})` : ''}${weather ? `. Weather: ${clean(weather, 120)}` : ''}
The story's date at the last scene: ${[date, time].map(s => clean(s, 80)).filter(Boolean).join(', ') || 'unknown'}${gapWords ? `; this scene opens ${clean(gapWords, 80)}` : '; this scene opens right after'}.
People here:
- ${people}
What brought us here: ${clean(seed, MAX_SEED) || 'nothing in particular; the world as it is'}
${canonBlock ? `What the story has established:\n${clean(canonBlock, 1200)}\n` : ''}${recaps.length ? `Last time:\n${recaps.map(r => clean(r, 700)).filter(Boolean).slice(0, 2).map((r, i) => `${i ? 'Before that' : 'Last scene'}: ${r}`).join('\n')}\n` : ''}${q.length ? `Open quests: ${q.join('; ')}\n` : ''}${note ? `${who} wants from this scene: ${clean(note, MAX_NOTE)}\n` : ''}The player: ${who} (never written for).

Answer with the JSON object only.`;
    return { system, user };
}

/** The first object in the reply that carries openers (fenced, bare or whole); null when none. */
export function parseOpenersReply(text) {
    const objects = jsonObjectsIn(text);
    return objects.find(o => isObj(o) && Array.isArray(o.openers)) || objects.find(o => isObj(o) && (o.title || o.text)) || null;
}

/**
 * The reply checked: one to `max` openers with a title and a text within
 * length, `who` cut to the cast and the known, `when` taken whole or not
 * at all. A reply with nothing usable fails.
 * @returns {{ ok: boolean, errors: string[], clean: { when: {date:string,time:string}|null, openers: {title:string,text:string,who:string[]}[] }|null }}
 */
export function validateOpeners(reply, { cast = [], known = [], max = OPENERS } = {}) {
    const errors = [];
    if (!isObj(reply)) return { ok: false, errors: ['The reply is not a JSON object.'], clean: null };
    const list = Array.isArray(reply.openers) ? reply.openers : ((reply.title || reply.text) ? [reply] : []);
    if (!list.length) return { ok: false, errors: ['The reply carries no openers.'], clean: null };
    const names = [...cast, ...known].map(n => clean(n, 60)).filter(Boolean);
    const openers = [];
    const seen = new Set();
    for (const o of list) {
        if (!isObj(o)) { errors.push('An opener is not an object.'); continue; }
        const textRaw = typeof o.text === 'string' ? o.text.replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim() : '';
        if (!textRaw) { errors.push('An opener has no text.'); continue; }
        const text = textRaw.length > MAX_OPENER_TEXT ? cutText(textRaw, MAX_OPENER_TEXT) : textRaw;
        if (/<\/?(details|summary|script|style)\b/i.test(text)) { errors.push('An opener carries markup.'); continue; }
        let title = clean(o.title, MAX_OPENER_TITLE);
        if (!title) title = cutText(text.split(/(?<=[.!?])\s/)[0], MAX_OPENER_TITLE).replace(/[.…]+$/, '');
        const key = text.toLowerCase().slice(0, 200);
        if (seen.has(key)) { errors.push('An opener repeats another.'); continue; }
        seen.add(key);
        const who = [];
        for (const w of Array.isArray(o.who) ? o.who : []) { if (typeof w !== 'string') continue; const hit = names.find(n => sameName(n, w)); if (hit && !who.includes(hit)) who.push(hit); }
        openers.push({ title, text, who });
        if (openers.length >= Math.min(OPENERS, Math.max(1, max | 0))) break;
    }
    if (!openers.length) return { ok: false, errors: errors.length ? errors : ['No usable opener.'], clean: null };
    let when = null;
    if (isObj(reply.when)) { const d = clean(reply.when.date, 80); const t = clean(reply.when.time, 80); if (d && t) when = { date: d, time: t }; }
    return { ok: true, errors, clean: { when, openers } };
}

/**
 * The first message (D119): the chosen opener in front with the others as
 * its swipes, the seeded tracker data on every swipe so the Tracker Data
 * view, the scene headers and history persistence see the state on it,
 * and the hub's own mark on the message.
 */
export function openerMessage({ name = 'Narrator', openers = [], chosen = 0, sendDate = '', tracker = null, title = '' } = {}) {
    const list = openers.filter(o => isObj(o) && o.text);
    if (!list.length) return null;
    const i = Math.min(list.length - 1, Math.max(0, chosen | 0));
    const ordered = [list[i], ...list.filter((_, k) => k !== i)];
    const swipes = ordered.map(o => o.text);
    const swipeData = {};
    if (isObj(tracker)) for (let k = 0; k < swipes.length; k++) swipeData[k] = copy(tracker);
    const extraFor = () => ({ ...(isObj(tracker) ? { dooms_tracker_swipes: copy(swipeData) } : {}), [HUB_META_KEY]: { opener: true, title: clean(title || ordered[0].title, MAX_TITLE) } });
    return {
        name: clean(name, 100) || 'Narrator',
        is_user: false,
        is_system: false,
        send_date: sendDate,
        mes: swipes[0],
        swipe_id: 0,
        swipes,
        swipe_info: swipes.map(() => ({ send_date: sendDate, gen_started: sendDate, gen_finished: sendDate, extra: extraFor() })),
        extra: extraFor(),
    };
}

/** A scene's title: the opener's, else the seed's label, else the place's. */
export function sceneTitle({ opener = null, seed = null, place = '' } = {}) {
    return clean(opener && opener.title, MAX_TITLE) || clean(seed && (seed.label || seed.text), MAX_TITLE) || clean(place, MAX_TITLE) || 'A scene';
}

// ─── The file (D118) ────────────────────────────────────────────────────

/** The hub's mark on a scene chat: what the strip, the Scenes panel and a rebuild from the card's chats read. */
export function hubMark({ world = '', scene = '', title = '', seed = null, place = null, cast = [], gap = null, startedAt = 0, startDate = '', file = '', brief = '' } = {}) {
    return { v: 1, world: clean(world, 60), scene: clean(scene, 24), file: clean(file, 200), title: clean(title, MAX_TITLE), seed: cleanSeed(seed), place: cleanPlace(place), cast: cast.map(n => clean(n, 60)).filter(Boolean).slice(0, MAX_CAST), gap: cleanGap(gap), startedAt: Number.isFinite(startedAt) ? startedAt : 0, startDate: clean(startDate, 80), brief: String(brief || '').slice(0, MAX_BRIEF + 200), endedAt: 0, endDate: '', end: null };
}

/** Whether a mark belongs to this chat file: a branch or a checkpoint of a scene carries the scene's mark under another name and is not the scene (D113). */
export function markIsOfFile(mark, file) {
    if (!mark) return false;
    if (!mark.file) return true;    // a mark from before the file was recorded: trusted
    const a = String(mark.file).replace(/\.jsonl$/i, '').toLowerCase();
    const b = String(file || '').replace(/\.jsonl$/i, '').toLowerCase();
    return !b || a === b;
}

/** The mark read back from a chat's metadata; null when the chat is not a scene. */
export function readMark(chatMeta) {
    const m = isObj(chatMeta) ? chatMeta[HUB_META_KEY] : null;
    if (!isObj(m) || !clean(m.world, 60) || !clean(m.scene, 24)) return null;
    const end = isObj(m.end) ? { canonAt: clean(m.end.canonAt, 60) } : null;
    return { ...hubMark(m), endedAt: Number.isFinite(m.endedAt) ? m.endedAt : 0, endDate: clean(m.endDate, 80), end };
}

/** The mark after End (the date it ended) or after Reopen (the end cleared). */
export function markEnded(mark, { endedAt = 0, endDate = '', end = undefined } = {}) {
    return { ...mark, endedAt: Number.isFinite(endedAt) ? endedAt : 0, endDate: clean(endDate, 80), end: end === undefined ? (mark && mark.end ? mark.end : null) : end };
}

/**
 * The file's first line: the chat's metadata, SillyTavern's own two unused
 * names beside it. The stores, the mark, the brief as the scenario, the
 * world's book as the chat lorebook when there is one, an integrity id.
 */
export function sceneHeader({ stores = {}, mark = null, scenario = '', worldInfo = '', integrity = '', persona = '' } = {}) {
    const meta = {};
    for (const k of HUB_KEYS) if (stores[k] !== undefined && stores[k] !== null) meta[k] = copy(stores[k]);
    if (mark) meta[HUB_META_KEY] = copy(mark);
    if (scenario) meta.scenario = String(scenario);
    if (worldInfo) meta.world_info = clean(worldInfo, 200);
    if (integrity) meta.integrity = clean(integrity, 80);
    if (persona) meta.persona = clean(persona, 200);    // SillyTavern's own per-chat persona lock: the scene opens under the persona it was started with
    meta.tainted = true;    // SillyTavern's own "this chat has been played" flag: without it message 0 is a pristine greeting (overswipe loops, a card save replaces it)
    return { chat_metadata: meta, user_name: 'unused', character_name: 'unused' };
}

/** A chat file's name: "Scene <n> - <title>", safe for a file, free among `existing` (names with or without .jsonl). */
export function sceneFileName(n, title, existing = []) {
    const safeTitle = clean(title, MAX_TITLE).replace(/[<>:"/\\|?*\u0000-\u001f]+/g, ' ').replace(/[.\s]+$/g, '').replace(/\s+/g, ' ').trim() || 'A scene';
    const base = `Scene ${Math.max(1, n | 0)} - ${safeTitle}`.slice(0, 100).trim();
    const taken = new Set((Array.isArray(existing) ? existing : []).map(x => String(x || '').replace(/\.jsonl$/i, '').toLowerCase()));
    if (!taken.has(base.toLowerCase())) return base;
    for (let i = 2; i < 1000; i++) { const name = `${base} (${i})`; if (!taken.has(name.toLowerCase())) return name; }
    return `${base} (${Date.now()})`;
}

// ─── The recap (D122, §5.2) ─────────────────────────────────────────────

/** The scene's text for a recap or a Canon run over the scene: the newest kept within the budget. */
export function sceneTranscript(chat, { budget = RECAP_BUDGET, persona = 'Player', truncation = 1200 } = {}) {
    const list = Array.isArray(chat) ? chat : [];
    const out = [];
    let used = 0;
    for (let i = list.length - 1; i >= 0; i--) {
        const m = list[i];
        if (!m || typeof m !== 'object' || m.is_system || typeof m.mes !== 'string') continue;
        let text = m.mes.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/<trackers?>[\s\S]*?<\/trackers?>/gi, '').replace(/```[\s\S]*?```/g, '').replace(/\[(ITEM|CHECK|SAVE)[^\]]*\]/g, '').replace(/\s+/g, ' ').trim();
        if (!text) continue;
        if (text.length > truncation) text = `${text.slice(0, truncation - 1).trimEnd()}…`;
        const line = `${m.is_user ? (m.name || persona) : (m.name || 'Narrator')}: ${text}`;
        if (used + line.length > budget && out.length) break;
        out.unshift(line);
        used += line.length + 1;
    }
    return out.join('\n');
}

/**
 * The scene's text in pages, oldest first, each within the budget, for a
 * recap written in passes when one page cannot hold the scene (§5.2). A
 * scene within the budget is one page.
 */
export function sceneTranscriptPages(chat, { budget = RECAP_BUDGET, persona = 'Player', truncation = 1200, maxPages = 4 } = {}) {
    const list = Array.isArray(chat) ? chat : [];
    const lines = [];
    for (const m of list) {
        if (!m || typeof m !== 'object' || m.is_system || typeof m.mes !== 'string') continue;
        let text = m.mes.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/<trackers?>[\s\S]*?<\/trackers?>/gi, '').replace(/```[\s\S]*?```/g, '').replace(/\[(ITEM|CHECK|SAVE)[^\]]*\]/g, '').replace(/\s+/g, ' ').trim();
        if (!text) continue;
        if (text.length > truncation) text = `${text.slice(0, truncation - 1).trimEnd()}…`;
        lines.push(`${m.is_user ? (m.name || persona) : (m.name || 'Narrator')}: ${text}`);
    }
    const pages = [];
    let page = [];
    let used = 0;
    for (const line of lines) {
        if (used + line.length > budget && page.length) { pages.push(page.join('\n')); page = []; used = 0; }
        page.push(line);
        used += line.length + 1;
    }
    if (page.length) pages.push(page.join('\n'));
    if (pages.length > maxPages) return pages.slice(pages.length - maxPages);    // the oldest beyond the passes are not read
    return pages;
}

export function buildRecapPrompt({ transcript = '', brief = '', player = '', maxChars = RECAP_CHARS, soFar = '', last = true } = {}) {
    const who = clean(player, 60) || 'the player';
    const system = `You write the record of a scene that has just ended, for the narrator of the next one. You answer with one JSON object and nothing else: {"recap": "<what happened in this scene>"}. Rules: at most ${maxChars} characters; past tense; ${who} by name; what was said, learned, promised, lost and gained; nothing that did not happen; no advice, no questions, no markup.${soFar ? ' The record so far covers the earlier part of the scene: carry what still matters forward and add what this part adds.' : ''}${!last ? ' This is not the end of the scene yet: the record will be continued.' : ''}`;
    const user = `${brief ? `The scene's brief:\n${clean(brief, 2500)}\n\n` : ''}${soFar ? `The record so far:\n${clean(soFar, 1500)}\n\n` : ''}The scene${soFar ? ', continued' : ''}:\n${transcript || '(nothing was played)'}\n\nAnswer with the JSON object only.`;
    return { system, user };
}

/** The recap read: the JSON's recap, else the plain text when the reply is prose; cut to the length, empty when nothing usable. */
export function parseRecapReply(text, { maxChars = RECAP_CHARS } = {}) {
    const raw = String(text ?? '');
    const obj = jsonObjectsIn(raw).find(o => isObj(o) && typeof o.recap === 'string');
    let recap = obj ? obj.recap : '';
    if (!recap) {
        const plain = raw.replace(/```[\s\S]*?```/g, '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
        if (plain && !plain.startsWith('{')) recap = plain;
    }
    recap = clean(recap, 5000);
    if (!recap) return { ok: false, recap: '', errors: ['The reply holds no recap.'] };
    return { ok: true, recap: recap.length > maxChars ? cutText(recap, maxChars) : recap, errors: [] };
}

// ─── The scene records (D123, D128) ─────────────────────────────────────

const touch = (entry) => ({ ...entry, scenes: entry.scenes.slice() });

/** The open scene of a world, or null. */
export function openSceneOf(entry) {
    return (entry && Array.isArray(entry.scenes) ? entry.scenes : []).find(s => s.status === 'open') || null;
}

/** The scenes set aside, newest first. */
export function asideScenes(entry) {
    return (entry && Array.isArray(entry.scenes) ? entry.scenes : []).filter(s => s.status === 'aside').reverse();
}

/**
 * A scene opened (D117): a new record, status open; any scene open before
 * it is set aside (one open scene at a time). Returns the entry and the
 * scene.
 */
export function openScene(entry, { title = '', seed = null, place = null, cast = [], gap = null, chat = '', card = '', startedAt = 0, startDate = '' } = {}) {
    const next = touch(normalizeWorldEntry(entry));
    next.scenes = next.scenes.map(s => (s.status === 'open' ? { ...s, status: 'aside' } : s));
    next.seq += 1;
    const scene = normalizeScene({ id: `s${next.seq}`, title, seed, place, cast, gap, chat, card, startedAt, startDate, status: 'open' }, next.seq);
    next.scenes.push(scene);
    return { entry: capScenes(next), scene };
}

function withScene(entry, id, fn) {
    const next = touch(normalizeWorldEntry(entry));
    const i = next.scenes.findIndex(s => s.id === id);
    if (i < 0) return { entry: next, scene: null };
    const scene = fn({ ...next.scenes[i] }, next);
    next.scenes[i] = scene;
    return { entry: next, scene };
}

export function setSceneAside(entry, id) {
    return withScene(entry, id, s => (s.status === 'open' ? { ...s, status: 'aside' } : s));
}

/** Resume sets the scene open and any other open scene aside. */
export function resumeScene(entry, id) {
    return withScene(entry, id, (s, next) => {
        if (s.gone) return s;
        next.scenes = next.scenes.map(x => (x.status === 'open' && x.id !== id ? { ...x, status: 'aside' } : x));
        return { ...s, status: 'open' };
    });
}

/** End (D122): status ended, the recap, the dates. */
export function endSceneRecord(entry, id, { endedAt = 0, endDate = '', recap = '', noRecap = false } = {}) {
    const r = withScene(entry, id, s => ({ ...s, status: 'ended', endedAt: Number.isFinite(endedAt) ? endedAt : 0, endDate: clean(endDate, 80), recap: clean(recap, 1500), noRecap: noRecap === true || !clean(recap, 1500) }));
    return { ...r, entry: capScenes(r.entry) };
}

/** Reopen: an ended scene back to open (others aside), marked reopened. */
export function reopenScene(entry, id) {
    return withScene(entry, id, (s, next) => {
        if (s.status !== 'ended' || s.gone) return s;
        next.scenes = next.scenes.map(x => (x.status === 'open' ? { ...x, status: 'aside' } : x));
        return { ...s, status: 'open', reopened: true, endedAt: 0, endDate: '' };
    });
}

/** The scene whose chat file this is (names with or without .jsonl), or null. */
export function sceneByChat(entry, file) {
    const key = String(file || '').replace(/\.jsonl$/i, '').toLowerCase();
    if (!key) return null;
    return (entry && Array.isArray(entry.scenes) ? entry.scenes : []).find(s => s.chat.toLowerCase() === key) || null;
}

/** A chat deleted in SillyTavern: its record stays, marked gone; an open one is no longer open. */
export function markChatGone(entry, file) {
    const s = sceneByChat(entry, file);
    if (!s) return { entry: normalizeWorldEntry(entry), scene: null };
    return withScene(entry, s.id, x => ({ ...x, gone: true, status: x.status === 'open' ? 'aside' : x.status }));
}

/** A chat renamed in SillyTavern: the record follows. */
export function renameSceneChat(entry, oldFile, newFile) {
    const s = sceneByChat(entry, oldFile);
    if (!s) return { entry: normalizeWorldEntry(entry), scene: null };
    return withScene(entry, s.id, x => ({ ...x, chat: String(newFile || '').replace(/\.jsonl$/i, '') }));
}

/** A record removed, only when its chat is gone (nothing else leaves the list). */
export function removeGoneScene(entry, id) {
    const next = touch(normalizeWorldEntry(entry));
    const s = next.scenes.find(x => x.id === id);
    if (!s || !s.gone) return { entry: next, removed: false };
    next.scenes = next.scenes.filter(x => x.id !== id);
    return { entry: next, removed: true };
}

/**
 * The records against the card's chat list (D128): a record whose file is
 * missing is marked gone; a chat carrying the hub's mark for this world
 * that no record names is added back (a rebuild after lost settings), its
 * status from the mark (ended when it says so, else aside).
 * @param {object} entry
 * @param {{ file: string, meta?: object }[]} chats - the card's chats, names with or without .jsonl, each with its header's metadata when listed with it
 * @param {string} worldId
 */
export function reconcileScenesWithChats(entry, chats, worldId) {
    const next = touch(normalizeWorldEntry(entry));
    const list = (Array.isArray(chats) ? chats : []).map(c => ({ file: String(c && (c.file ?? c.file_name ?? c.file_id) || '').replace(/\.jsonl$/i, ''), meta: c && isObj(c.meta) ? c.meta : (c && isObj(c.chat_metadata) ? c.chat_metadata : null) })).filter(c => c.file);
    const files = new Set(list.map(c => c.file.toLowerCase()));
    let changed = 0;
    next.scenes = next.scenes.map(s => {
        const present = s.chat && files.has(s.chat.toLowerCase());
        if (s.chat && !present && !s.gone) { changed++; return { ...s, gone: true, status: s.status === 'open' ? 'aside' : s.status }; }
        if (present && s.gone) { changed++; return { ...s, gone: false }; }
        return s;
    });
    for (const c of list) {
        const mark = readMark(c.meta);
        if (!mark || mark.world !== clean(worldId, 60)) continue;
        if (next.scenes.some(s => s.chat.toLowerCase() === c.file.toLowerCase())) continue;
        if (!markIsOfFile(mark, c.file)) {
            // The mark names another file. Its original still listed: a branch or a checkpoint, not the scene.
            // Its original gone: the scene was renamed in SillyTavern; its record follows the file.
            if (files.has(String(mark.file).replace(/\.jsonl$/i, '').toLowerCase())) continue;
            const mine = next.scenes.find(s => s.id === mark.scene && (s.gone || !files.has(s.chat.toLowerCase())));
            if (mine) { mine.chat = c.file; mine.gone = false; changed++; continue; }
        }
        next.seq += 1;
        next.scenes.push(normalizeScene({ id: next.scenes.some(s => s.id === mark.scene) ? `s${next.seq}` : mark.scene, title: mark.title, seed: mark.seed, place: mark.place, cast: mark.cast, gap: mark.gap, chat: c.file, startedAt: mark.startedAt, startDate: mark.startDate, endedAt: mark.endedAt, endDate: mark.endDate, status: mark.endedAt ? 'ended' : 'aside' }, next.seq));
        changed++;
    }
    for (const sc of next.scenes) { const m = /^s(\d+)$/.exec(sc.id); if (m && Number(m[1]) > next.seq) next.seq = Number(m[1]); }
    return { entry: changed ? capScenes(next) : next, changed };
}

/** The last recaps, newest first, for the brief and the openers. */
export function lastRecaps(entry, count = 2) {
    return (entry && Array.isArray(entry.scenes) ? entry.scenes : []).filter(s => s.status === 'ended' && s.recap).map(s => s.recap).reverse().slice(0, count);
}

// ─── The lines ──────────────────────────────────────────────────────────

/** One line for the hub's foot and the Settings status (D128). */
export function hubStatusLine({ worldName = '', entry = null, cardName = '' } = {}) {
    const name = clean(worldName, 80) || 'This world';
    if (!entry || !entry.card) return `${name}: no narrator card yet; pick one to play it from the Map.`;
    const open = openSceneOf(entry);
    const ended = entry.scenes.filter(s => s.status === 'ended').length;
    const aside = entry.scenes.filter(s => s.status === 'aside' && !s.gone).length;
    const facts = entry.memory && entry.memory.facts;
    const when = facts && facts.date ? `the world's date is ${facts.date}${facts.time ? `, ${facts.time}` : ''}` : 'no scene ended yet';
    const narrated = cardName ? `narrated by ${clean(cardName, 80)}` : 'narrator card set';
    const count = `${ended} scene${ended === 1 ? '' : 's'} played${aside ? `, ${aside} set aside` : ''}`;
    const now = open ? `scene ${open.id.replace(/^s/, '')} open${open.place.label ? ` at ${open.place.label}` : ''}${open.startDate ? ` since ${open.startDate}` : ''}` : when;
    return `${name}: ${narrated}; ${count}; ${now}.`;
}

/** One line for the Start sheet after Start was pressed. */
export function describeStartResult(r) {
    if (!r) return '';
    if (r.ok) return `Scene ${String(r.scene && r.scene.id || '').replace(/^s/, '') || ''} is open${r.scene && r.scene.place && r.scene.place.label ? ` at ${r.scene.place.label}` : ''}.`;
    const why = {
        off: 'Live World is off (Settings → Live World).',
        'no-card': 'This world has no narrator card yet.',
        'card-gone': 'The narrator card is gone; pick another.',
        'no-world': 'No world to play.',
        'scene-open': 'A scene is still open: end it or set it aside first.',
        temporary: 'A temporary chat is in front; open any card first.',
        group: 'A group cannot be the narrator.',
        'too-old': 'This SillyTavern is too old for the Map.',
        openers: 'The narrator wrote no usable opener; write your own, ask again, or start without one.',
        file: 'SillyTavern refused the new chat file.',
        open: 'The chat is written; open it from Scenes.',
        busy: 'Another request is running; try again in a moment.',
        cancelled: 'Nothing was started.',
    };
    return why[r.reason] || `Nothing was started: ${r.error || r.reason || 'unknown'}.`;
}

/** One line for the End sheet after End ran. */
export function describeEndResult(r) {
    if (!r) return '';
    if (r.ok) {
        const parts = [];
        if (r.recap === 'skipped') parts.push('no recap'); else if (r.recap) parts.push('the recap kept');
        if (r.canon === 'ok') parts.push('the ledger read'); else if (r.canon === 'skipped') parts.push('the ledger skipped'); else if (r.canon === 'off') parts.push('Canon off');
        if (r.world === 'ok') parts.push('the world moved'); else if (r.world === 'skipped') parts.push('the world not moved'); else if (r.world === 'off') parts.push('Live World off');
        if (r.book === 'ok') parts.push('the book mirrored'); else if (r.book === 'failed') parts.push('the book not written');
        return `The scene is ended and remembered${parts.length ? ` (${parts.join(', ')})` : ''}.`;
    }
    const why = {
        'not-scene': 'This chat is not a scene.',
        'not-open': 'The scene is not open.',
        'wrong-chat': 'The scene\'s chat is not in front; open it from Scenes.',
        flush: 'The chat could not be saved; nothing in the world was touched.',
        changed: 'The chat changed; end it again from the Scenes panel.',
        busy: 'A generation is running; End waits for it.',
        cancelled: 'The scene stays open.',
    };
    return why[r.reason] || `The scene stays open: ${r.error || r.reason || 'unknown'}.`;
}
