/**
 * The Map window's pure model (docs/map-window-plan.md D82–D86): the places
 * the story has visited, newest first, as the row of circles shows them;
 * the rewind when replies go; where a character's place sits in the row;
 * the description a place's picture is drawn from; Travel here's
 * instruction; the completed quests. No SillyTavern, no DOM:
 * tools/world-map-test.mjs imports this directly.
 */
import { placeChain, placePath, placeFromText, normalizeVisited, locPlaceId, isLocId, MAX_PLACE, VISITS_KEEP } from './liveWorld.js';
import { safeImageUrl, placeOf } from './worldBoard.js';
import { cleanWhen } from './questCut.js';

export const MAX_DONE = 100;
export const PLACE_FRAMES = Object.freeze({ portrait: 'a tall frame', square: 'a square frame', landscape: 'a wide frame' });

const clean = (v, max = 200) => String(v ?? '').normalize('NFC').replace(/\s+/g, ' ').trim().slice(0, max);
const cloneState = (s) => JSON.parse(JSON.stringify(s));
const hasId = (id) => id !== null && id !== undefined && id !== '';

/** The parent line of a pack place: its ancestors nearest first, "the Low Market, Gilead". */
function parentLine(pack, id) {
    const chain = placeChain(pack, id);
    return chain.length > 1 ? chain.slice(0, -1).map(p => p.label).reverse().join(', ') : '';
}

/**
 * Where a tracker location line points: the pack place it names (the
 * deepest, as placeFromText reads it), else the text itself as a place of
 * its own, keyed by a slug of it under "loc:". null when there is nothing.
 * @returns {{ id: string, label: string, packId: string, path: string, parent: string } | null}
 */
export function placeKeyFor(pack, location) {
    const text = clean(location, MAX_PLACE);
    if (!text) return null;
    const packId = pack ? placeFromText(pack, text) : '';
    if (packId) {
        const chain = placeChain(pack, packId);
        const place = chain[chain.length - 1];
        return { id: packId, label: (place && place.label) || packId, packId, path: placePath(pack, packId), parent: parentLine(pack, packId) };
    }
    const id = locPlaceId(text);    // the key shared with the state's own placing (D93)
    if (!id) return null;
    return { id, label: text, packId: '', path: '', parent: '' };
}

/**
 * The scene's place recorded as a visit (D82): a new place goes to the
 * front; a place seen before moves to the front and takes the reply's id
 * (once); the dates follow the latest visit. Hands the same state back
 * when nothing changed.
 * @returns {{ state: object, changed: boolean, added: boolean, id: string }}
 */
export function visitPlace(state, pack, { location = '', msgId = null, gameDate = '', gameTime = '' } = {}) {
    const key = placeKeyFor(pack, location);
    if (!state || !key) return { state, changed: false, added: false, id: '' };
    const list = normalizeVisited(state.visited);
    const pos = list.findIndex(e => e.id === key.id);
    let entry;
    if (pos >= 0) {
        entry = { ...list[pos], visits: list[pos].visits.slice() };
        let changed = pos !== 0;
        if (hasId(msgId) && !entry.visits.includes(msgId)) {
            entry.visits.push(msgId);
            if (entry.visits.length > VISITS_KEEP) entry.visits.splice(0, entry.visits.length - VISITS_KEEP);
            changed = true;
        }
        if (entry.label !== key.label) { entry.label = key.label; changed = true; }
        if (entry.path !== key.path) { entry.path = key.path; changed = true; }
        const date = clean(gameDate, 80);
        const time = clean(gameTime, 80);
        if (date && (entry.lastDate !== date || entry.lastTime !== time)) { entry.lastDate = date; entry.lastTime = time; changed = true; }
        if (!changed) return { state, changed: false, added: false, id: key.id };
        list.splice(pos, 1);
    } else {
        const date = clean(gameDate, 80);
        entry = { id: key.id, label: key.label, packId: key.packId, path: key.path, visits: hasId(msgId) ? [msgId] : [], firstDate: date, lastDate: date, lastTime: clean(gameTime, 80), image: '', prompt: '', drawnAt: 0 };
    }
    list.unshift(entry);
    const next = cloneState(state);
    next.visited = normalizeVisited(list);
    return { state: next, changed: true, added: pos < 0, id: key.id };
}

/**
 * The rewind (a deleted reply, a regenerate, a branch): a visit whose reply
 * is gone leaves its place; a place with no standing visit sinks to the end
 * of the row when it has a picture (paid for) and leaves when it has none.
 * Same state back when nothing changed.
 * @returns {{ state: object, pruned: number, dropped: number }}
 */
export function reconcileVisited(state, presentIds) {
    const list = state && Array.isArray(state.visited) ? state.visited : [];
    if (!list.length) return { state, pruned: 0, dropped: 0 };
    const present = new Set(Array.isArray(presentIds) ? presentIds : []);
    let pruned = 0;
    let dropped = 0;
    const standing = [];
    const sunk = [];
    for (const e of list) {
        const keep = (e.visits || []).filter(id => present.has(id));
        const lost = (e.visits || []).length - keep.length;
        pruned += lost;
        if (keep.length) { standing.push(lost ? { ...e, visits: keep } : e); continue; }
        if (!lost) { standing.push(e); continue; }       // never tied to a reply (a seed, an import): it stands where it is
        if (e.image) sunk.push({ ...e, visits: [] });
        else dropped++;
    }
    if (!pruned && !dropped) return { state, pruned: 0, dropped: 0 };
    const next = cloneState(state);
    next.visited = [...standing, ...sunk];
    return { state: next, pruned, dropped };
}

/** Where the party is: the newest place with a standing visit (the first entry when none has one). */
export function currentPlace(state) {
    const list = state && Array.isArray(state.visited) ? state.visited : [];
    return list.find(e => Array.isArray(e.visits) && e.visits.length) || list[0] || null;
}

/**
 * The row of circles, newest first: each place with its picture (the drawn
 * one, else the pack's art, else none), its name and parent line, when it
 * was last visited, whether the party is there.
 */
export function placesRow(state, pack) {
    const list = state && Array.isArray(state.visited) ? state.visited : [];
    const here = currentPlace(state);
    const byId = new Map(((pack && pack.places) || []).map(p => [p.id, p]));
    return list.map(e => {
        const p = e.packId ? byId.get(e.packId) : null;
        const drawn = safeImageUrl(e.image);
        const image = drawn || (p ? safeImageUrl(p.image) : '');
        return {
            id: e.id,
            label: p ? (p.label || e.label) : e.label,
            parent: p ? parentLine(pack, p.id) : '',
            image,
            drawn: !!drawn,
            packId: e.packId,
            visits: Array.isArray(e.visits) ? e.visits.length : 0,
            lastDate: e.lastDate || '',
            lastTime: e.lastTime || '',
            here: !!here && here.id === e.id,
            prompt: e.prompt || '',
        };
    });
}

/** The row entry a known character stands in: their place when it is in the row, else the nearest visited place above it; '' when none. */
export function rowIdForCharacter(state, pack, name) {
    const id = placeOf(state, name);
    if (!id) return '';
    const ids = new Set(((state && state.visited) || []).map(e => e.id));
    if (isLocId(id)) return ids.has(id) ? id : '';    // a place the pack does not name (D93): its own row entry
    for (const pid of placeChain(pack, id).map(p => p.id).reverse()) if (ids.has(pid)) return pid;
    return '';
}

/**
 * The description a place's picture is drawn from (D83): the system and
 * user messages for the background request. No names, no story: the
 * place as a viewer sees it, from the scenes at or near it.
 */
export function buildPlacePrompt({ place, recent = '', world = '', size = 'square' } = {}) {
    const label = clean(place && place.label, MAX_PLACE) || 'the place';
    const parent = clean(place && place.parent, 200);
    const w = clean(world, 80);
    const frame = PLACE_FRAMES[size] || PLACE_FRAMES.square;
    const system = [
        `You describe one place for an image model: ${label}${w ? `, in ${w}` : ''}.`,
        `Natural language, 2 to 4 sentences, one paragraph: begin with the medium and the framing (a wide establishing view of the place that fills ${frame}, no one in focus), then the place as a viewer sees it: the buildings or the land, materials, light, weather, the time of day, the mood.`,
        'Draw on what the scenes below show of it and invent nothing they contradict. Never a character\'s name, never the story, never what happened there.',
        'Nothing but the description: no title, no quotes, no list, no notes.',
    ].join(' ');
    const scenes = String(recent || '').trim();
    const user = `The place: ${label}${parent ? `, part of ${parent}` : ''}.\n\n${scenes ? `Scenes at or near it:\n${scenes}` : 'No scene text is at hand: describe the place from its name and the world.'}`;
    return { system, user };
}

/**
 * Travel here's instruction (D84), the quest cut's shape: a brief montage
 * of the road from now, then the arrival with the first move the player's;
 * the tracker's location moves to the place.
 */
export function buildTravelInstruction({ place, when = '', userName = 'the player', facts = {} } = {}) {
    const to = clean(place && typeof place === 'object' ? place.label : place, MAX_PLACE).replace(/[\[\]]/g, '').replace(/"([^"]*)"/g, '“$1”').replace(/"/g, '”');
    if (!to) return '';
    const who = clean(userName, 80) || 'the player';
    const now = [facts.date, facts.time, facts.location ? `at ${facts.location}` : ''].map(s => String(s || '').trim()).filter(Boolean).join(', ');
    const nowClause = now ? ` from now (${now})` : ' from now';
    const w = cleanWhen(when);
    const whenClause = w ? ` ${who} arrives ${w}.` : ' How long the road takes is yours to judge from the distance: hours or days, whatever it plausibly takes.';
    return `[TRAVEL: ${who} has chosen to travel to ${to}. This reply is the journey. First, a brief montage of a paragraph or two: the road${nowClause} to ${to}, the hours or days it takes, the rest, the weather and the company, told in summary and never played out; nothing on the way is resolved or decided.${whenClause} Then open on the arrival: ${to} as ${who} finds it, who is there, the first thing that happens, and stop with the first move still ${who}'s. Everything else about your reply is unchanged: the tracker data block and everything else you are required to output still follow as usual, with the date, time and location moved to the arrival at ${to}, and what ${who} carries kept consistent with the journey.]`;
}

/** The completed quests (D86) made safe: text, when (the clock), the tracker's date; newest first, one entry per text, capped. */
export function normalizeDone(raw) {
    const out = [];
    const seen = new Set();
    for (const e of Array.isArray(raw) ? raw : []) {
        const text = clean(e && typeof e === 'object' ? e.text : e, 200);
        if (!text) continue;
        const key = text.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ text, at: e && Number.isInteger(e.at) ? e.at : 0, gameDate: clean(e && typeof e === 'object' ? e.gameDate : '', 80) });
        if (out.length >= MAX_DONE) break;
    }
    return out;
}

/** A quest completed now, at the front; the same text completed again moves to the front with the new date. "None" and nothing are not quests. */
export function addDone(raw, text, { at = 0, gameDate = '' } = {}) {
    const t = clean(text, 200);
    const list = normalizeDone(raw);
    if (!t || t === 'None') return { list, added: false };
    const rest = list.filter(e => e.text.toLowerCase() !== t.toLowerCase());
    return { list: [{ text: t, at: Number.isInteger(at) ? at : 0, gameDate: clean(gameDate, 80) }, ...rest].slice(0, MAX_DONE), added: true };
}
