/**
 * A character as each of the player's characters knows them
 * (docs/long-shot-plan.md D234).
 *
 * A world may hold a story for each of the player's characters (D216), and
 * its cast is shared between them. Two things the Workshop keeps about a
 * character are not about the character alone but about them and the
 * player: the relationship set by hand, and whatever of the description
 * says who they are to the player ("Jack's on-and-off girlfriend"). With
 * one of each a world's second story read its first story's.
 *
 * So a character may carry, beside the relationship and the description
 * everyone gets, one of either for a named user character:
 *
 *     extensionSettings.characterWith = {
 *         [character]: { [user character]: { relationship?, description? } }
 *     }
 *
 * The rule, in one place: what a player's story reads is that player's
 * own where one is written, else the shared one. A field left empty for a
 * player is the shared one, so a character with nothing written here is
 * as it was. The store is one of the Workshop's version-backed stores
 * (campaignProfiles PROFILE_FIELDS, field `with`), so a campaign's version
 * of a character carries its own.
 *
 * Portrait, voice, look, example lines, knives and the lorebook are the
 * character's and are not kept a player: there is one Roxy.
 *
 * Pure, no SillyTavern: the settings and the player are handed in.
 * tools/character-with-test.mjs.
 */

/** A relationship is a short label (the Workshop's chips); a description is as long as the Workshop lets one be. */
export const WITH_RELATIONSHIP_MAX = 60;

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const lower = (v) => String(v ?? '').trim().toLowerCase();

/** The key of a map that is this name, whatever its case; undefined when none is. */
function keyOf(map, name) {
    if (!isObj(map)) return undefined;
    const want = lower(name);
    if (!want) return undefined;
    if (Object.prototype.hasOwnProperty.call(map, name)) return name;
    return Object.keys(map).find(k => k.toLowerCase() === want);
}

/** One player's side made safe: only what is written; null when nothing is. */
export function cleanView(raw) {
    if (!isObj(raw)) return null;
    const out = {};
    const rel = typeof raw.relationship === 'string' ? raw.relationship.trim().slice(0, WITH_RELATIONSHIP_MAX) : '';
    const desc = typeof raw.description === 'string' ? raw.description.trim() : '';
    if (rel) out.relationship = rel;
    if (desc) out.description = desc;
    return rel || desc ? out : null;
}

/** A character's sides made safe: a player once (the first spelling kept), empty sides dropped; null when none is left. */
export function cleanWith(raw) {
    if (!isObj(raw)) return null;
    const out = {};
    const seen = new Set();
    for (const [player, view] of Object.entries(raw)) {
        const name = String(player || '').trim();
        const key = name.toLowerCase();
        if (!name || seen.has(key)) continue;
        const v = cleanView(view);
        if (!v) continue;
        seen.add(key);
        out[name] = v;
    }
    return seen.size ? out : null;
}

/** A character's sides as stored in the live store, made safe (a copy); {} when it has none. */
export function withOf(settings, name) {
    const store = settings && settings.characterWith;
    const key = keyOf(store, name);
    return (key !== undefined && cleanWith(store[key])) || {};
}

/** The players a character has a side for, as written. */
export function playersWith(settings, name) {
    return Object.keys(withOf(settings, name));
}

/** One player's side of a character: `{ relationship?, description? }`, or null when nothing is written for them. */
export function viewFor(settings, name, player) {
    if (!lower(player)) return null;
    const sides = withOf(settings, name);
    const key = keyOf(sides, player);
    return key === undefined ? null : sides[key];
}

/** The shared relationship set by hand ('' when none is). */
function sharedRelationship(settings, name) {
    const store = settings && settings.characterRelationships;
    const key = keyOf(store, name);
    return key !== undefined && typeof store[key] === 'string' ? store[key].trim() : '';
}

/** The shared description ('' when none is). */
function sharedDescription(settings, name) {
    const store = settings && settings.characterInjection;
    const key = keyOf(store, name);
    const entry = key !== undefined ? store[key] : null;
    return isObj(entry) && typeof entry.description === 'string' ? entry.description.trim() : '';
}

/**
 * The relationship set by hand that a player's story reads: the player's
 * own, else the shared one; '' when neither is set (the tracker's own
 * reading of the scene is then all there is).
 */
export function relationshipFor(settings, name, player) {
    const view = viewFor(settings, name, player);
    return (view && view.relationship) || sharedRelationship(settings, name);
}

/** The description a player's story reads: the player's own, else the shared one. */
export function descriptionFor(settings, name, player) {
    const view = viewFor(settings, name, player);
    return (view && view.description) || sharedDescription(settings, name);
}

/**
 * Sets one player's side of a character, in place. `patch` holds the
 * fields to change; a field set to '' is cleared, one left out is kept. A
 * side with nothing left is dropped, and a character with no side has no
 * entry.
 * @returns {object|null} the side as it now stands
 */
export function setView(settings, name, player, patch = {}) {
    const who = String(player || '').trim();
    const whom = String(name || '').trim();
    if (!settings || !who || !whom) return null;
    if (!isObj(settings.characterWith)) settings.characterWith = {};
    const store = settings.characterWith;
    const nameKey = keyOf(store, whom);
    const sides = (nameKey !== undefined && cleanWith(store[nameKey])) || {};
    const playerKey = keyOf(sides, who);
    const next = cleanView({ ...(playerKey !== undefined ? sides[playerKey] : {}), ...(isObj(patch) ? patch : {}) });
    if (playerKey !== undefined) delete sides[playerKey];
    if (next) sides[playerKey !== undefined ? playerKey : who] = next;
    const target = nameKey !== undefined ? nameKey : whom;
    if (Object.keys(sides).length) store[target] = sides; else delete store[target];
    return next;
}

/**
 * The choices of the Workshop's "For" switch for a character: everyone,
 * then each user character, then anyone a side is written for who is not
 * (or no longer) a user character, so it can still be read and cleared.
 * Empty when there is nothing to choose between: fewer than two user
 * characters and no side written.
 * @param {string[]} users  the user characters' names
 * @param {object} sides    the character's sides as the draft stands
 * @returns {Array<{ id: string, label: string, written: boolean, gone: boolean }>}
 */
export function withChoices(users, sides) {
    const names = [];
    const add = (n) => { const t = String(n || '').trim(); if (t && !names.some(x => x.toLowerCase() === t.toLowerCase())) names.push(t); };
    const userList = (Array.isArray(users) ? users : []).map(u => String(u || '').trim()).filter(Boolean);
    for (const u of userList) add(u);
    const clean = cleanWith(sides) || {};
    for (const p of Object.keys(clean)) add(p);
    if (userList.length < 2 && !Object.keys(clean).length) return [];
    return [
        { id: '', label: 'Everyone', written: true, gone: false },
        ...names.map(n => ({
            id: n,
            label: n,
            written: keyOf(clean, n) !== undefined,
            gone: !userList.some(u => u.toLowerCase() === n.toLowerCase()),
        })),
    ];
}
