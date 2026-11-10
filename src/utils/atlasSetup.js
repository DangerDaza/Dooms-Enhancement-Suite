/**
 * Setting up a world's map (docs/long-shot-plan.md D143, D144, D159), the
 * pure parts. The player writes what matters to them; the chat is read
 * (its recent scenes in one go, or the whole of it in parts, each part
 * scanned for the places it names); one request drafts the places around
 * the notes: what is inside what, a kind and a note for each, what is
 * near what, which of the places already known each one is; the player
 * corrects the draft; the draft becomes the chat's book, every place on
 * its own map at a spot solved from what is near what. The AI never
 * writes a coordinate (D144).
 *
 * The requests are in src/systems/features/atlasBook.js; the window's
 * steps in src/systems/ui/atlasViews.js. tools/atlas-setup-test.mjs.
 */
import { ATLAS_KINDS, ATLAS_SCALES, ATLAS_GROUNDS, cleanKind, guessKind, normalizeBook, addPin, mergeInto, removeMarker, withScale, tidyList, wrapInRegion, TERRITORY_RADIUS } from './atlas.js';

const clean = (v, max = 200) => String(v ?? '').normalize('NFC').replace(/\s+/g, ' ').trim().slice(0, max);
const norm = (t) => clean(t, 120).toLowerCase().replace(/^the\s+/, '').replace(/[’]/g, "'");
const round4 = (n) => Math.round(n * 10000) / 10000;

export const SETUP_LIMITS = Object.freeze({
    notes: 3000,        // what the player wrote
    card: 3000,
    lore: 6000,
    recent: 12000,      // the recent scenes, sent whole
    chunk: 14000,       // one part of the whole chat
    chunks: 60,         // parts read at most: the oldest are left out past this, and the player is told
    found: 160,         // places kept from the scans
    places: 80,         // places a draft may hold
    message: 1800,      // one message, cut to this
});
export const SETUP_REACHES = Object.freeze(['recent', 'full']);
const DIRS = Object.freeze({ n: [0, -1], ne: [0.707, -0.707], e: [1, 0], se: [0.707, 0.707], s: [0, 1], sw: [-0.707, 0.707], w: [-1, 0], nw: [-0.707, -0.707] });
const FARS = Object.freeze({ close: 1.5, near: 2.6, far: 4.4 });
const KIND_LIST = ATLAS_KINDS.map(k => k.id).join(', ');
const WIDE = TERRITORY_RADIUS * 1.35;    // regions are lands: they stand this far apart, and what is near a region is further off by the same measure
const REGION_FAR = 2.5;

/** A chat's messages as lines, "Name: what was said", each cut to length; the empty ones left out. `strip` cleans a message (the tracker blocks, the thinking). */
export function chatLines(chat, { strip = (t) => String(t || ''), persona = 'Player' } = {}) {
    const out = [];
    for (const m of Array.isArray(chat) ? chat : []) {
        if (!m || m.is_system) continue;
        const text = clean(strip(m.mes), SETUP_LIMITS.message);
        if (!text) continue;
        out.push(`${clean(m.name, 60) || (m.is_user ? persona : 'Narrator')}: ${text}`);
    }
    return out;
}

/** The lines in parts of about `size` characters, oldest first; `skipped` counts the lines left out when the chat is longer than `max` parts (the oldest go). */
export function chunkLines(lines, { size = SETUP_LIMITS.chunk, max = SETUP_LIMITS.chunks } = {}) {
    const chunks = [];
    let cur = [];
    let len = 0;
    for (const line of Array.isArray(lines) ? lines : []) {
        if (len + line.length > size && cur.length) { chunks.push(cur); cur = []; len = 0; }
        cur.push(line);
        len += line.length + 1;
    }
    if (cur.length) chunks.push(cur);
    const kept = chunks.length > max ? chunks.slice(chunks.length - max) : chunks;
    const skipped = chunks.slice(0, chunks.length - kept.length).reduce((n, c) => n + c.length, 0);
    return { chunks: kept.map(c => c.join('\n')), skipped };
}

/** The last lines that fit `size` characters, in order: the recent scenes. */
export function recentLines(lines, size = SETUP_LIMITS.recent) {
    const out = [];
    let len = 0;
    for (let i = (Array.isArray(lines) ? lines.length : 0) - 1; i >= 0; i--) {
        if (len + lines[i].length > size && out.length) break;
        out.unshift(lines[i]);
        len += lines[i].length + 1;
    }
    return out.join('\n');
}

/** The first JSON object in a reply (fenced, bare, with words around it), or null. */
export function jsonIn(text) {
    const raw = String(text ?? '');
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start < 0 || end <= start) return null;
    try { const v = JSON.parse(raw.slice(start, end + 1)); return v && typeof v === 'object' ? v : null; } catch (e) { return null; }
}

/** The request that scans one part of the chat for the places it names. */
export function buildScanPrompt(chunk, { part = 1, parts = 1 } = {}) {
    const system = [
        'You read one part of a long role-play story and list the places it names. A place is somewhere a scene can happen: a city, a district, a building, a wilderness, a dungeon or one of its levels. Not a room, not a piece of furniture, not a mood.',
        'Reply with one JSON object and nothing else: {"places":[{"name":"<the place\'s proper name>","inside":"<the larger place it is in, or empty>","note":"<a few words on what it is>"}]}',
        'Use the name the story uses. List each place once. If this part names no place, reply {"places":[]}.',
    ].join('\n');
    return { system, user: `Part ${part} of ${parts} of the story:\n\n${chunk}` };
}

/** A scan's reply read: the places with a name, cleaned. */
export function parseScan(text) {
    const obj = jsonIn(text);
    const out = [];
    for (const p of obj && Array.isArray(obj.places) ? obj.places : []) {
        const name = clean(p && p.name, 80);
        if (name) out.push({ name, inside: clean(p.inside, 80), note: clean(p.note, 160) });
    }
    return out;
}

/** The scans joined: one entry per name (the article and the case apart), the first fuller word on each kept. */
export function mergeScans(lists) {
    const byKey = new Map();
    for (const list of Array.isArray(lists) ? lists : []) {
        for (const p of Array.isArray(list) ? list : []) {
            const key = norm(p.name);
            if (!key) continue;
            const have = byKey.get(key);
            if (!have) { if (byKey.size < SETUP_LIMITS.found) byKey.set(key, { ...p }); continue; }
            if (!have.inside && p.inside) have.inside = p.inside;
            if (!have.note && p.note) have.note = p.note;
        }
    }
    return [...byKey.values()];
}

/**
 * The request that drafts the world's places (D143, D144).
 * @param {object} o
 * @param {string} o.notes     what the player wrote: it outranks everything else
 * @param {string} o.world     the world's name
 * @param {{description?:string,scenario?:string}} o.card
 * @param {string} o.lore      the lorebooks' entries, cut to length
 * @param {string} o.recent    the recent scenes, whole
 * @param {Array} o.found      the places the scans found in the whole chat ([] for the recent reach)
 * @param {object} o.model     the Atlas's model: the places already known are numbered from it (tidyList)
 * @param {string[]} o.players the player's names: never a place, never moved
 */
export function buildSetupPrompt({ notes = '', world = '', card = {}, lore = '', recent = '', found = [], model = null, players = [] } = {}) {
    const known = tidyList(model);
    const system = [
        'You set up the map of a role-play story\'s world. From what you are given, write the list of its places: what each is, what is inside what, and what is near what. You never write coordinates.',
        'Reply with one JSON object and nothing else:',
        '{"scale":"town|region|world","places":[{"name":"<proper name>","kind":"<one kind>","note":"<one sentence>","inside":"<name of the place it is inside, or empty for the top map>","was":[<numbers of the known places this one is>],"guess":<true if nothing you were given says this, false otherwise>,"near":[{"to":"<name of another place on the same map>","dir":"n|ne|e|se|s|sw|w|nw","far":"close|near|far"}]}],"drop":[<numbers of known places that are not places>]}',
        `Kinds: ${KIND_LIST}.`,
        'Rules:',
        '- THE PLAYER\'S NOTES OUTRANK EVERYTHING. If they name a place, it is in the list as they named it. If they say something is true, it is true.',
        '- A region (kind "region") is a land with borders: a march, a vale, a kingdom, a stretch of wilds. When the story reaches beyond one settlement, the top map holds regions and nothing else, and every city, castle and wild place is inside the region it lies in. Name the region the story is in even when the sources do not (mark it "guess"), and add its neighbours only when the sources name them.',
        '- "inside" builds layers: a city is inside its region (or on the top map of a one-town story); a house, a temple, a dungeon\'s entrance are inside the city; a dungeon\'s levels are inside the dungeon. A place has at most one "inside", and it names another place of your list exactly. Do not list rooms, furniture or corners: they are part of their building.',
        '- "near" only between places with the same "inside". "dir" is the way you would walk from this place to reach the other ("dir":"n" means the other place lies to the north). Give what the sources say; when they say nothing, leave it empty rather than invent it.',
        '- "was": every known place you are given is the same as one of your places (put its number in that place\'s "was"), or is a room or part of one (put its number in the building\'s "was"), or is not a place at all (put its number in "drop"). Use each number once.',
        '- "scale" is what the top map shows: a town when the whole story is in one town, a region for a few settlements and the land between, a world for more.',
        `- At most ${SETUP_LIMITS.places} places. Prefer the places the story has been to and the ones the notes name over a full gazetteer. Mark "guess": true on anything you added to make the world hang together.`,
        players.length ? `- ${players.join(' and ')} is the player: not a place.` : '',
    ].filter(Boolean).join('\n');
    const parts = [];
    if (clean(notes, 10)) parts.push(`THE PLAYER'S NOTES (these outrank everything below):\n${String(notes).trim().slice(0, SETUP_LIMITS.notes)}`);
    if (world) parts.push(`The world is called: ${clean(world, 120)}`);
    const cardText = [card.description, card.scenario].filter(Boolean).join('\n').trim().slice(0, SETUP_LIMITS.card);
    if (cardText) parts.push(`The character card:\n${cardText}`);
    if (lore) parts.push(`The lore:\n${String(lore).slice(0, SETUP_LIMITS.lore)}`);
    if (found.length) parts.push(`Places named across the whole story (name, what it is inside, what it is):\n${found.map(p => `- ${p.name}${p.inside ? ` (in ${p.inside})` : ''}${p.note ? `: ${p.note}` : ''}`).join('\n')}`);
    if (recent) parts.push(`The recent scenes:\n${String(recent).slice(-SETUP_LIMITS.recent)}`);
    parts.push(known.length
        ? `The known places, numbered (the map as it stands; gathered automatically, so it holds duplicates and things that are not places):\n${known.map(p => `${p.n}. ${p.label}${p.layerLabel ? ` [in ${p.layerLabel}]` : ''}${p.rooms.length ? ` (inside it: ${p.rooms.slice(0, 6).join('; ')})` : ''}`).join('\n')}`
        : 'There are no known places yet.');
    return { system, user: parts.join('\n\n'), known: known.length };
}

/**
 * The draft read from the reply and made safe. Each place gets a key (its
 * name, the article and the case apart); "inside" and "near" are turned
 * into keys, and one that names no place of the list is dropped; a place
 * inside itself, or in a loop, stands on the top map; a known place's
 * number is used once.
 * @returns {{ ok: boolean, draft: { scale: string, places: Array, drop: string[] }|null, error: string }}
 */
export function parseSetup(text, model = null) {
    const obj = jsonIn(text);
    if (!obj || !Array.isArray(obj.places)) return { ok: false, draft: null, error: 'The reply was not the list of places asked for.' };
    const known = tidyList(model);
    const byN = new Map(known.map(p => [p.n, p]));
    const num = (v) => { const n = typeof v === 'string' && /^\d+$/.test(v.trim()) ? Number(v) : v; return Number.isInteger(n) ? n : 0; };
    const places = [];
    const keys = new Set();
    for (const p of obj.places) {
        const name = clean(p && p.name, 80);
        const key = norm(name);
        if (!key || keys.has(key)) continue;
        keys.add(key);
        places.push({ key, name, kind: cleanKind(p.kind) || guessKind(name), note: clean(p.note, 300), inside: norm(p.inside), was: Array.isArray(p.was) ? p.was : [], guess: p.guess === true, near: Array.isArray(p.near) ? p.near : [] });
        if (places.length >= SETUP_LIMITS.places) break;
    }
    if (!places.length) return { ok: false, draft: null, error: 'The reply listed no places.' };
    const used = new Set();
    for (const p of places) {
        if (!keys.has(p.inside) || p.inside === p.key) p.inside = '';
        p.was = p.was.map(n => byN.get(num(n))).filter(k => k && !used.has(k.id) && used.add(k.id)).map(k => ({ id: k.id, label: k.label }));
    }
    const byKey = new Map(places.map(p => [p.key, p]));
    for (const p of places) {    // a loop of "inside" is broken at the place that closes it
        let cur = p.inside;
        for (let i = 0; cur && i <= places.length; i++) { if (cur === p.key) { p.inside = ''; break; } cur = byKey.get(cur).inside; }
    }
    for (const p of places) {
        const seen = new Set();
        p.near = p.near.map(r => ({ to: norm(r && r.to), dir: typeof (r && r.dir) === 'string' && DIRS[r.dir.trim().toLowerCase()] ? r.dir.trim().toLowerCase() : '', far: FARS[String(r && r.far || '').trim().toLowerCase()] ? String(r.far).trim().toLowerCase() : 'near' }))
            .filter(r => r.dir && r.to !== p.key && byKey.has(r.to) && byKey.get(r.to).inside === p.inside && !seen.has(r.to) && seen.add(r.to));
    }
    const drop = [];
    for (const n of Array.isArray(obj.drop) ? obj.drop : []) { const k = byN.get(num(n)); if (k && !used.has(k.id)) { used.add(k.id); drop.push({ id: k.id, label: k.label }); } }
    return { ok: true, draft: { scale: ATLAS_SCALES[obj.scale] && obj.scale !== 'site' ? obj.scale : '', places, drop }, error: '' };
}

// ─── The player's corrections (the review) ──────────────────────────────────

const copy = (draft) => ({ scale: draft.scale, places: draft.places.map(p => ({ ...p, was: [...p.was], near: [...p.near] })), drop: [...draft.drop] });

/** A place's name or kind changed. The name is its word; its key stays, so what points at it still does. */
export function editDraftPlace(draft, key, { name, kind } = {}) {
    const d = copy(draft);
    const p = d.places.find(x => x.key === key);
    if (!p) return d;
    if (clean(name, 80)) p.name = clean(name, 80);
    if (kind !== undefined && cleanKind(kind)) p.kind = cleanKind(kind);
    p.guess = false;    // the player touched it: it is theirs now
    return d;
}

/** The keys a place is inside of, nearest first. */
export function draftChain(draft, key) {
    const byKey = new Map(draft.places.map(p => [p.key, p]));
    const out = [];
    let cur = byKey.get(key) ? byKey.get(key).inside : '';
    for (let i = 0; cur && i <= draft.places.length; i++) { out.push(cur); cur = byKey.get(cur) ? byKey.get(cur).inside : ''; }
    return out;
}

/** A place put inside another ('' = the top map). Inside itself, or inside something that is inside it, is refused. What it was near is let go: that was on its old map. */
export function setDraftInside(draft, key, inside) {
    const d = copy(draft);
    const p = d.places.find(x => x.key === key);
    if (!p || inside === key || (inside && (!d.places.some(x => x.key === inside) || draftChain(d, inside).includes(key)))) return d;
    p.inside = inside || '';
    p.near = [];
    for (const o of d.places) o.near = o.near.filter(r => r.to !== key);
    p.guess = false;
    return d;
}

/** A place taken out of the draft: what was inside it moves up to where it stood; the known places it was are left as they are. */
export function removeDraftPlace(draft, key) {
    const d = copy(draft);
    const p = d.places.find(x => x.key === key);
    if (!p) return d;
    for (const o of d.places) { if (o.inside === key) { o.inside = p.inside; o.near = []; } o.near = o.near.filter(r => r.to !== key); }
    d.places = d.places.filter(x => x.key !== key);
    return d;
}

/** The draft as rows for the review: each place with how deep it is, in the order a tree reads (a place, then what is inside it). */
export function draftRows(draft) {
    const kids = new Map();
    for (const p of draft.places) { if (!kids.has(p.inside)) kids.set(p.inside, []); kids.get(p.inside).push(p); }
    const out = [];
    const walk = (key, depth) => { for (const p of kids.get(key) || []) { out.push({ ...p, depth, holds: (kids.get(p.key) || []).length }); walk(p.key, depth + 1); } };
    walk('', 0);
    return out;
}

// ─── The spots: what is near what, solved (D144) ────────────────────────────

/**
 * A spot for every place of the draft, each map laid out on its own. A
 * map's first place stands in the middle; a place said to be near one
 * already placed stands in that direction at that distance; the rest go
 * on a spiral; then anything too close to another is pushed apart. The
 * same draft gives the same spots.
 * @returns {Map<string, { x: number, y: number }>}
 */
export function layoutDraft(draft) {
    const out = new Map();
    const layers = new Map();
    for (const p of draft.places) { if (!layers.has(p.inside)) layers.set(p.inside, []); layers.get(p.inside).push(p); }
    const GOLDEN = Math.PI * (3 - Math.sqrt(5));
    for (const list of layers.values()) {
        const at = new Map();
        // "dir" is the way from the place to the other one. Both ways of every relation: "B lies north of A" also places A south of B.
        const rel = new Map(list.map(p => [p.key, []]));
        const kindOfKey = new Map(list.map(p => [p.key, p.kind]));
        const wide = (a, b) => kindOfKey.get(a) === 'region' || kindOfKey.get(b) === 'region';
        for (const p of list) for (const r of p.near) { if (!rel.has(r.to)) continue; const [dx, dy] = DIRS[r.dir]; const d = (FARS[r.far] || FARS.near) * (wide(p.key, r.to) ? REGION_FAR : 1); rel.get(p.key).push({ to: r.to, dx: dx * d, dy: dy * d }); rel.get(r.to).push({ to: p.key, dx: -dx * d, dy: -dy * d }); }
        let spare = 0;
        const anyWide = list.some(p => p.kind === 'region');
        const next = () => { const i = spare++; const r = (anyWide ? WIDE : 2.2) * Math.sqrt(i + 0.5); return { x: r * Math.cos(i * GOLDEN + 0.6), y: r * Math.sin(i * GOLDEN + 0.6) }; };
        for (const start of list) {
            if (at.has(start.key)) continue;
            at.set(start.key, at.size ? next() : { x: 0, y: 0 });
            const queue = [start.key];
            while (queue.length) {
                const cur = queue.shift();
                const from = at.get(cur);
                for (const r of rel.get(cur)) { if (at.has(r.to)) continue; at.set(r.to, { x: from.x + r.dx, y: from.y + r.dy }); queue.push(r.to); }
            }
        }
        // Apart: any two closer than a marker's own land are pushed along the line between them (or sideways when they coincide).
        const keys = list.map(p => p.key);
        for (let pass = 0; pass < 200; pass++) {
            let moved = false;
            for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++) {
                const a = at.get(keys[i]), b = at.get(keys[j]);
                let dx = b.x - a.x, dy = b.y - a.y;
                let d = Math.hypot(dx, dy);
                const gap = wide(keys[i], keys[j]) ? WIDE : 1.35;
                if (d >= gap) continue;
                if (d < 1e-6) { dx = Math.cos(j * GOLDEN); dy = Math.sin(j * GOLDEN); d = 1; }
                const push = (gap + 0.05 - Math.min(d, gap + 0.05)) / 2 + 0.01;
                a.x -= dx / d * push; a.y -= dy / d * push; b.x += dx / d * push; b.y += dy / d * push;
                moved = true;
            }
            if (!moved) break;
        }
        for (const [key, p] of at) out.set(key, { x: round4(p.x), y: round4(p.y) });
    }
    return out;
}

// ─── The draft made the map (D159) ──────────────────────────────────────────

/**
 * The chat's book made from the draft, replacing the one it had: every
 * place a marker made by hand, on the map of the place it is inside, at
 * its solved spot; the known places it was merged into it (so the people
 * and the visits there count at it, and the story naming them again goes
 * to it); the ones that are not places deleted. A map's scale follows its
 * depth unless the draft named the top map's. Known places the draft did
 * not mention are left as they are, to be placed by hand. `drawn` and the
 * top map's ground are kept from the old book.
 * @returns {{ book: object, ids: Map<string,string>, placed: number, merged: number, dropped: number }}
 */
export function applySetup(draft, previous = null) {
    const old = normalizeBook(previous);
    let book = normalizeBook({ drawn: old.drawn, ground: old.ground });
    const ids = new Map();
    const spots = layoutDraft(draft);
    // A place before what is inside it, so a holder's id is known when its places are made.
    for (const row of draftRows(draft)) {
        const at = spots.get(row.key) || { x: 0, y: 0 };
        const made = addPin(book, { label: row.name, kind: row.kind, note: row.note, x: at.x, y: at.y, layer: row.inside ? (ids.get(row.inside) || '') : '', loose: row.guess === true });    // what the AI guessed is not canon until the player says so (D160)
        book = made.book;
        ids.set(row.key, made.id);
    }
    let merged = 0;
    for (const p of draft.places) for (const k of p.was) { if (k.id !== ids.get(p.key)) { book = mergeInto(book, k.id, ids.get(p.key)); merged++; } }
    for (const k of draft.drop) book = removeMarker(book, k.id);
    if (draft.scale) book = withScale(book, draft.scale);
    return { book, ids, placed: draft.places.length, merged, dropped: draft.drop.length };
}

// ─── Filling out a map (D160): the AI adds places around what is there ─────

export const FILL_COUNTS = Object.freeze([4, 8, 12]);

/** Where a marker stands, in words the AI can read: steps east or west, north or south of the map's middle. */
function whereWords(m) {
    const ew = Math.round(m.x), ns = Math.round(m.y);
    const parts = [ew ? `${Math.abs(ew)} ${ew > 0 ? 'east' : 'west'}` : '', ns ? `${Math.abs(ns)} ${ns > 0 ? 'south' : 'north'}` : ''].filter(Boolean);
    return parts.length ? parts.join(', ') : 'at the middle';
}

export const HOME_ID = '@home';    // in a fill's "near": the home region the places of the map are about to go inside
const PLACE_KINDS = ATLAS_KINDS.filter(k => k.id !== 'region').map(k => k.id).join(', ');
const HOME_NAMES = Object.freeze(['The Heartland', 'The Home Country', 'The Middle Lands']);

/**
 * What Fill out can add to a map (D166): `places` on a map of places,
 * `regions` on the top map or on a map that holds regions. `home` says
 * the map has places of its own that regions would stand beside: choosing
 * regions puts those places inside a home region first, so the lands
 * border one another and no place is left between them.
 */
export function fillOptions(model) {
    const markers = model && Array.isArray(model.markers) ? model.markers : [];
    const hasRegions = markers.some(m => m.kind === 'region');
    const hasPlaces = markers.some(m => m.kind !== 'region');
    const options = [];
    if (!hasRegions) options.push('places');
    if (hasRegions || !model || !model.layer) options.push('regions');
    return { options, home: hasPlaces, hasRegions };
}

/** What a fill adds, of what the map allows: the one asked for, else the first the map offers. */
export function fillWhat(model, want = '') {
    const { options } = fillOptions(model);
    return options.includes(want) ? want : options[0];
}

/**
 * The request that fills out one map: the places on it now with where
 * they stand, what the map is of, what the player asked for; and what to
 * send back. The new places are not canon: the story has not named them.
 * @param {object} o
 * @param {object} o.model   the Atlas's model of the map to fill
 * @param {string} o.world   the world's name
 * @param {string} o.wish    what the player asked for ("more shops", "a rough quarter to the east")
 * @param {number} o.count   how many to add
 * @param {string} o.lore    the lorebooks' entries, cut short
 * @param {{description?:string,scenario?:string}} o.card
 * @param {'places'|'regions'} o.what  places for this map, or regions around it (fillOptions says which the map allows)
 */
export function buildFillPrompt({ model = null, world = '', wish = '', count = 8, lore = '', card = {}, what = '' } = {}) {
    const markers = model && Array.isArray(model.markers) ? model.markers : [];
    const n = FILL_COUNTS.includes(Number(count)) ? Number(count) : 8;
    const scale = model && model.measure ? (ATLAS_SCALES[model.measure.scale] || {}).label || '' : '';
    const ground = model ? (ATLAS_GROUNDS.find(g => g.id === model.ground) || {}).label || '' : '';
    const other = model && Array.isArray(model.all) ? model.all.filter(x => x.layer !== model.layer).map(x => x.label) : [];
    const w = fillWhat(model, what);
    const regions = w === 'regions';
    const home = regions && fillOptions(model).home;
    const lands = markers.filter(m => m.kind === 'region');
    const places = markers.filter(m => m.kind !== 'region');
    const shape = `{${home ? '"home":"<a name for the region the places of this map lie in>",' : ''}"places":[{"name":"<proper name>",${regions ? '' : '"kind":"<one kind>",'}"note":"<one sentence: ${regions ? 'what kind of land it is, and a reason someone might go there' : 'what it is, and a reason someone might go there'}>","near":[{"to":"<${regions ? (home ? '"home", or the name of another region: one already there, or another of yours' : 'the name of a region on this map: one already there, or another of yours') : 'name of a place on this map: one already there, or another of yours'}>","dir":"n|ne|e|se|s|sw|w|nw","far":"close|near|far"}]}]}`;
    const system = [
        regions
            ? 'You fill out the map of a role-play story\'s world with regions: lands with borders that lie around the ones already known, so the world has somewhere beyond the edge of what the story has seen. The story has not named these lands; they are suggestions the player can keep, change or remove.'
            : 'You fill out one map of a role-play story\'s world: you add places that plausibly belong on it, around the places already there, so the area feels lived in and there is somewhere to go. The story has not named these places; they are suggestions the player can keep, change or remove.',
        'Reply with one JSON object and nothing else:',
        shape,
        ...(regions ? [] : [`Kinds: ${PLACE_KINDS}.`]),
        'Rules:',
        ...(regions ? [
            `- Exactly ${n} new regions. A region is a land with borders and a character of its own: a march, a vale, a forest, a waste, a kingdom's shire. Not a town, a building or a single landmark.`,
            ...(home ? ['- The places listed below all lie in one region, their home region, which has no name yet. Name it in "home": a name for the land around them, in the style of the world\'s names. Your regions lie around it.'] : []),
            `- Each region has one "near" ${home ? 'to "home" or to another region' : 'to a region already on the map, or to another of yours'} ("dir" is the way you would travel from the new region to reach the other). Spread them round: not all on one side.`,
        ] : [
            `- Exactly ${n} new places. Fit the map: for a city, its districts, markets, inns, temples, gates; for a region, its villages, roads, ruins, wilds; for a dungeon or a building, its halls, chambers, levels.`,
            '- Do not add regions, lands or countries: this map shows places. Do not add rooms, furniture or people.',
            '- Each new place has one "near" to a place already on the map when there is one ("dir" is the way you would walk from the new place to reach the other). Spread them: not all on one side, not all "close".',
        ]),
        '- Fit the world: its tone, its names, its level of magic and technology. Use names in the style of the names already there. Do not contradict the lore.',
        '- Do not repeat or rename anything already on this map or elsewhere in the world.',
        '- You never write coordinates.',
    ].join('\n');
    const parts = [];
    if (clean(wish, 4)) parts.push(`WHAT THE PLAYER ASKED FOR (this outranks the rest):\n${String(wish).trim().slice(0, 600)}`);
    parts.push(`The world: ${clean(world, 120) || 'unnamed'}. This map: ${model && model.layerLabel ? `inside ${model.layerLabel}` : 'the top map'}${scale ? `, ${scale.toLowerCase()}` : ''}${ground ? `, ${ground.toLowerCase()}` : ''}.`);
    const cardText = [card.description, card.scenario].filter(Boolean).join('\n').trim().slice(0, 1500);
    if (cardText) parts.push(`The character card:\n${cardText}`);
    if (lore) parts.push(`The lore:\n${String(lore).slice(0, 3000)}`);
    const line = (m) => `- ${m.label} (${m.kind}; ${whereWords(m)})${m.note ? `: ${m.note}` : ''}`;
    if (regions) {
        if (lands.length) parts.push(`The regions on this map now (with where each stands from the map's middle, in steps):\n${lands.map(line).join('\n')}`);
        if (home) parts.push(`The places of the home region (they go inside it; do not repeat them):\n${places.map(m => `- ${m.label} (${m.kind})${m.note ? `: ${m.note}` : ''}`).join('\n')}`);
        if (!lands.length && !home) parts.push('This map has no regions yet: yours are its first.');
    } else {
        parts.push(markers.length ? `The places on this map now (with where each stands from the map's middle, in steps):\n${markers.map(line).join('\n')}` : 'This map has no places yet: yours are its first.');
    }
    if (other.length) parts.push(`Places elsewhere in the world (do not repeat them): ${other.slice(0, 80).join('; ')}`);
    return { system, user: parts.join('\n\n'), count: n, what: w, home };
}

/**
 * The fill's reply read: the new places with a name that nothing in the
 * world carries yet, each "near" turned into the marker it names (`id`:
 * a marker's, or HOME_ID for the home region) or the other new place
 * (`key`). Asked for places, nothing comes back a region; asked for
 * regions, everything does. With a home region wanted, its name comes
 * back in `home` (a stock one when the reply gave none that is free).
 * @returns {{ ok: boolean, places: Array, what: string, home: string, error: string }}
 */
export function parseFill(text, model = null, { what = '' } = {}) {
    const w = fillWhat(model, what);
    const regions = w === 'regions';
    const wantsHome = regions && fillOptions(model).home;
    const obj = jsonIn(text);
    if (!obj || !Array.isArray(obj.places)) return { ok: false, places: [], what: w, home: '', error: 'The reply was not the list of places asked for.' };
    const markers = model && Array.isArray(model.markers) ? model.markers : [];
    const taken = new Set((model && Array.isArray(model.all) ? model.all : []).flatMap(x => [norm(x.label), ...(x.names || []).map(n => norm(n.label))]));
    let home = '';
    if (wantsHome) {
        const given = clean(obj.home, 80);
        home = given && !taken.has(norm(given)) ? given : HOME_NAMES.find(nm => !taken.has(norm(nm))) || 'The Heartland';
    }
    // What a "near" can name on the map: asked for regions, the regions there (a place there stands for the home region it goes inside); else every marker.
    const onMap = new Map(markers.filter(m => !regions || m.kind === 'region').map(m => [norm(m.label), m.id]));
    if (wantsHome) { onMap.set('home', HOME_ID); onMap.set(norm(home), HOME_ID); for (const m of markers) if (m.kind !== 'region') onMap.set(norm(m.label), HOME_ID); }
    const places = [];
    const keys = new Set();
    for (const p of obj.places) {
        const name = clean(p && p.name, 80);
        const key = norm(name);
        if (!key || keys.has(key) || taken.has(key) || (home && key === norm(home))) continue;
        keys.add(key);
        const kind = cleanKind(p.kind);
        places.push({ key, name, kind: regions ? 'region' : (kind && kind !== 'region' ? kind : guessKind(name)), note: clean(p.note, 300), near: Array.isArray(p.near) ? p.near : [] });
        if (places.length >= 16) break;
    }
    if (!places.length) return { ok: false, places: [], what: w, home: '', error: regions ? 'The reply added no new regions.' : 'The reply added no new places.' };
    for (const p of places) {
        p.near = p.near.map(r => {
            const to = norm(r && r.to);
            const dir = typeof (r && r.dir) === 'string' && DIRS[r.dir.trim().toLowerCase()] ? r.dir.trim().toLowerCase() : '';
            const far = FARS[String(r && r.far || '').trim().toLowerCase()] ? String(r.far).trim().toLowerCase() : 'near';
            if (!dir || to === p.key) return null;
            if (onMap.has(to)) return { id: onMap.get(to), dir, far };
            return keys.has(to) ? { key: to, dir, far } : null;
        }).filter(Boolean).slice(0, 3);
    }
    return { ok: true, places, what: w, home, error: '' };
}

/** Where the home region would stand: the middle of the map's own places (wrapInRegion puts it there). */
function homeSpot(model) {
    const placed = (model && Array.isArray(model.markers) ? model.markers : []).filter(m => m.kind !== 'region');
    return placed.length ? { x: placed.reduce((n, m) => n + m.x, 0) / placed.length, y: placed.reduce((n, m) => n + m.y, 0) / placed.length } : { x: 0, y: 0 };
}

/**
 * A spot for every new place, the markers already on the map left where
 * they are. A new place said to be near something already placed stands
 * the other way from it at that distance ("dir" is the way from the new
 * place to the other); the rest go on a spiral around the map's places;
 * then a new place too close to anything is pushed off it. Only the new
 * ones move. With `home`, the map's own places are about to go inside a
 * home region: that region, where it will stand, is what the new ones are
 * laid out around, with the regions already there.
 * @returns {Map<string, { x: number, y: number }>}
 */
export function layoutFill(model, places, { home = false } = {}) {
    const markers = model && Array.isArray(model.markers) ? model.markers : [];
    const fixed = home
        ? [...markers.filter(m => m.kind === 'region').map(m => ({ id: m.id, x: m.x, y: m.y, wide: true })), { id: HOME_ID, ...homeSpot(model), wide: true }]
        : markers.map(m => ({ id: m.id, x: m.x, y: m.y, wide: m.kind === 'region' }));
    const byId = new Map(fixed.map(f => [f.id, f]));
    const at = new Map();
    const GOLDEN = Math.PI * (3 - Math.sqrt(5));
    // On a region's own map with nothing on it yet, the new places are laid out from the region's spot: on its land (D168).
    const land = !fixed.length && model && model.realm ? model.realm : null;
    const cx = fixed.length ? fixed.reduce((n, f) => n + f.x, 0) / fixed.length : land ? land.x : 0;
    const cy = fixed.length ? fixed.reduce((n, f) => n + f.y, 0) / fixed.length : land ? land.y : 0;
    const reach = fixed.length ? Math.max(...fixed.map(f => Math.hypot(f.x - cx, f.y - cy))) : land ? -1.4 : 0;    // from the spot itself, not a ring around it
    const list = Array.isArray(places) ? places : [];
    for (let round = 0; round < list.length + 1; round++) {
        let any = false;
        for (const p of list) {
            if (at.has(p.key)) continue;
            for (const r of p.near) {
                const anchor = r.id ? byId.get(r.id) : at.get(r.key);
                if (!anchor) continue;
                const [dx, dy] = DIRS[r.dir];
                const d = (FARS[r.far] || FARS.near) * (p.kind === 'region' || anchor.wide ? REGION_FAR : 1);
                at.set(p.key, { x: anchor.x - dx * d, y: anchor.y - dy * d, wide: p.kind === 'region' });
                any = true;
                break;
            }
        }
        if (!any) break;
    }
    let spare = 0;
    for (const p of list) {
        if (at.has(p.key)) continue;
        const i = spare++;
        const r = reach + (p.kind === 'region' ? WIDE : 2) + (p.kind === 'region' ? 2.4 : 0.9) * Math.sqrt(i);
        at.set(p.key, { x: cx + r * Math.cos(i * GOLDEN + 0.4), y: cy + r * Math.sin(i * GOLDEN + 0.4), wide: p.kind === 'region' });
    }
    const keys = list.map(p => p.key);
    for (let pass = 0; pass < 200; pass++) {
        let moved = false;
        for (let i = 0; i < keys.length; i++) {
            const a = at.get(keys[i]);
            const others = [...fixed, ...keys.filter((_, j) => j !== i).map(k => at.get(k))];
            for (const b of others) {
                let dx = a.x - b.x, dy = a.y - b.y;
                let d = Math.hypot(dx, dy);
                const gap = a.wide || b.wide ? WIDE : 1.35;
                if (d >= gap) continue;
                if (d < 1e-6) { dx = Math.cos(i * GOLDEN + 1); dy = Math.sin(i * GOLDEN + 1); d = 1; }
                const push = gap + 0.07 - Math.min(d, gap + 0.07) + 0.01;
                a.x += dx / d * push; a.y += dy / d * push;
                moved = true;
            }
        }
        if (!moved) break;
    }
    return new Map(keys.map(k => [k, { x: round4(at.get(k).x), y: round4(at.get(k).y) }]));
}

/**
 * The new places added to the chat's book, on the map that was filled,
 * each marked as not canon. Nothing already there is moved. With `home`
 * (a name): the map's own places go inside a new home region of that
 * name first (wrapInRegion; not canon, since the name is the AI's), and
 * the new regions stand around it.
 * @returns {{ book: object, ids: string[], homeId: string }}
 */
export function applyFill(book, model, places, { home = '' } = {}) {
    let b = normalizeBook(book);
    let homeId = '';
    if (home) { const w = wrapInRegion(b, model, { label: home, loose: true }); b = w.book; homeId = w.id; }
    const spots = layoutFill(model, places, { home: !!home });
    const ids = [];
    for (const p of Array.isArray(places) ? places : []) {
        const at = spots.get(p.key);
        if (!at) continue;
        const made = addPin(b, { label: p.name, kind: p.kind, note: p.note, x: at.x, y: at.y, layer: model ? model.layer : '', loose: true });
        b = made.book;
        ids.push(made.id);
    }
    return { book: b, ids, homeId };
}
