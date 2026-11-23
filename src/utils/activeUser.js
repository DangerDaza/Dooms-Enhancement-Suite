/**
 * Who the player is playing (docs/long-shot-plan.md D226): one rule for
 * every place DES asks, where five copies of it had drifted.
 *
 * A world may hold a story for each of the player's characters (D216), so
 * the answer can no longer be one name pinned in the settings. In order:
 *   1. the user character linked to the SillyTavern persona in use: the
 *      persona the player switched to is who they are playing;
 *   2. the player of the story the chat in front belongs to (the name its
 *      memory keeps), when that is one of the user characters;
 *   3. the one picked by hand in the Workshop ("Set as active persona");
 *   4. the only user character, when there is one.
 * Before this the hand pick came first, so a world's second story was
 * played as its first story's player.
 *
 * Pure, no SillyTavern: the persona in use is handed in. The story's
 * player is set by the Hub when the chat in front changes
 * (src/systems/features/hub.js). tools/active-user-test.mjs.
 */

let storyPlayer = '';

/** The player of the story the chat in front belongs to ('' when it is part of none, or its memory names no one). */
export function setStoryPlayer(name) {
    storyPlayer = typeof name === 'string' ? name.trim().slice(0, 60) : '';
}

export function getStoryPlayer() {
    return storyPlayer;
}

const keyOf = (map, name) => {
    const want = String(name || '').trim().toLowerCase();
    return want ? Object.keys(map).find(k => k.toLowerCase() === want) || '' : '';
};

/**
 * The user character being played, by the rule above; '' when none is.
 * @param {{ userCharacters?: object, avatar?: string, story?: string, pin?: string }} p
 */
export function pickActiveUser({ userCharacters = {}, avatar = '', story = storyPlayer, pin = '' } = {}) {
    const map = userCharacters && typeof userCharacters === 'object' && !Array.isArray(userCharacters) ? userCharacters : {};
    if (avatar) {
        for (const [name, entry] of Object.entries(map)) if (entry && entry.linkedPersona === avatar) return name;
    }
    const fromStory = keyOf(map, story);
    if (fromStory) return fromStory;
    if (pin && map[pin]) return pin;
    const names = Object.keys(map);
    return names.length === 1 ? names[0] : '';
}
