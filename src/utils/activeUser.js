/**
 * Who the player is playing (docs/long-shot-plan.md D226, D230): one rule
 * for every place DES asks, where five copies of it had drifted.
 *
 * A world may hold a story for each of the player's characters (D216), so
 * the answer can no longer be one name pinned in the settings. The
 * character card is the anchor (D230): a card is tied, in the Workshop, to
 * the user character who is played on it. In order:
 *   1. the user character tied to the narrator card of the story the chat
 *      in front belongs to, else to the chat's own card;
 *   2. the player that story remembers (the name its memory keeps), when
 *      that is one of the user characters;
 *   3. the user character linked to the SillyTavern persona in use;
 *   4. the one picked by hand in the Workshop ("Set as active persona");
 *   5. the only user character, when there is one.
 * Before this the hand pick came first, so a world's second story was
 * played as its first story's player.
 *
 * Pure, no SillyTavern: the persona in use is handed in. The anchor (the
 * cards and the story's player) is set by the Hub when the chat in front
 * changes (src/systems/features/hub.js). tools/active-user-test.mjs.
 */

let anchor = { player: '', cards: [] };

const text = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/**
 * What the chat in front is anchored to: the cards to look for a tie on,
 * the story's narrator card first and the chat's own card after it, and
 * the player the story remembers ('' when the chat is part of none).
 * @param {{ player?: string, cards?: string[] }} a
 */
export function setStoryAnchor({ player = '', cards = [] } = {}) {
    const list = [];
    for (const c of Array.isArray(cards) ? cards : []) { const t = text(c, 200); if (t && !list.includes(t)) list.push(t); }
    anchor = { player: text(player, 60), cards: list };
}

export function getStoryAnchor() {
    return { player: anchor.player, cards: anchor.cards.slice() };
}

const keyOf = (map, name) => {
    const want = String(name || '').trim().toLowerCase();
    return want ? Object.keys(map).find(k => k.toLowerCase() === want) || '' : '';
};

const asMap = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});

/** The cards a user character is played on (D230), made safe: file names, each once. */
export function cardsOf(entry) {
    const out = [];
    for (const c of entry && Array.isArray(entry.cards) ? entry.cards : []) { const t = text(c, 200); if (t && !out.includes(t)) out.push(t); }
    return out;
}

/** The user character tied to a card (D230); '' when none is. */
export function userOfCard(userCharacters, card) {
    const want = text(card, 200);
    if (!want) return '';
    for (const [name, entry] of Object.entries(asMap(userCharacters))) if (cardsOf(entry).includes(want)) return name;
    return '';
}

/**
 * A user character's cards set (D230), in place: kept when any, dropped
 * when none. A card is played as one user character at a time, so a card
 * taken here is let go by whoever had it.
 * @returns {string[]} the cards the user character now has
 */
export function setCardsOf(userCharacters, name, cards) {
    const map = asMap(userCharacters);
    const entry = map[name];
    if (!entry || typeof entry !== 'object') return [];
    const mine = cardsOf({ cards });
    if (mine.length) entry.cards = mine; else delete entry.cards;
    for (const [other, e] of Object.entries(map)) {
        if (other === name || !e || !Array.isArray(e.cards)) continue;
        const kept = cardsOf(e).filter(a => !mine.includes(a));
        if (kept.length) e.cards = kept; else delete e.cards;
    }
    return mine;
}

/**
 * The cards a user character may be given, as the Workshop lists them
 * (D230): the ones it has left out, each with a label that tells two
 * cards of one name apart by their files and says whose a card is when it
 * is another's (adding it here moves it).
 * @param {Array<{ avatar: string, name: string }>} choices  the cards there are, in the order to list them
 * @param {string[]} mine  the cards the one being edited has, as the draft stands
 * @returns {Array<{ avatar: string, label: string }>}
 */
export function cardOptions(choices, userCharacters, name, mine = []) {
    const list = (Array.isArray(choices) ? choices : []).filter(c => c && typeof c.avatar === 'string' && c.avatar);
    const has = Array.isArray(mine) ? mine : [];
    const count = new Map();
    for (const c of list) { const k = String(c.name || '').toLowerCase(); count.set(k, (count.get(k) || 0) + 1); }
    const out = [];
    for (const c of list) {
        if (has.includes(c.avatar)) continue;
        const label = String(c.name || c.avatar);
        const other = userOfCard(userCharacters, c.avatar);
        out.push({ avatar: c.avatar, label: `${label}${count.get(label.toLowerCase()) > 1 ? ` (${c.avatar})` : ''}${other && other !== name ? ` (played as ${other})` : ''}` });
    }
    return out;
}

/**
 * The user character being played, by the rule above; '' when none is.
 * @param {{ userCharacters?: object, cards?: string[], story?: string, avatar?: string, pin?: string }} p
 */
export function pickActiveUser({ userCharacters = {}, cards = anchor.cards, story = anchor.player, avatar = '', pin = '' } = {}) {
    const map = asMap(userCharacters);
    for (const c of Array.isArray(cards) ? cards : []) { const tied = userOfCard(map, c); if (tied) return tied; }
    const fromStory = keyOf(map, story);
    if (fromStory) return fromStory;
    if (avatar) {
        for (const [name, entry] of Object.entries(map)) if (entry && entry.linkedPersona === avatar) return name;
    }
    if (pin && map[pin]) return pin;
    const names = Object.keys(map);
    return names.length === 1 ? names[0] : '';
}
