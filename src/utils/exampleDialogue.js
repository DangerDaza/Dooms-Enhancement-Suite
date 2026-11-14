/**
 * Example dialogue for the Workshop's characters
 * (docs/long-shot-plan.md D212): lines that show how a character speaks,
 * kept on the character's card in the Workshop and sent with every reply
 * while the tracker has that character in the scene.
 *
 * Kept with the character's injection entry, as `dialogue`, so that it
 * goes wherever that entry goes: a campaign's version of the character,
 * a rename, an export. Pure: no DOM, no SillyTavern.
 */
import { presentFromTracker } from './hub.js';
import { sameName } from './liveWorld.js';

export const DIALOGUE = Object.freeze({
    stored: 6000,    // characters of example dialogue a card keeps
    perChar: 1500,   // of one character's sent with a reply
    total: 6000,     // of everyone's together
    people: 8,       // characters whose examples are sent with one reply
    opening: 800,    // of one character's told to a scene's openings
});

const CONFIG_DEFAULTS = Object.freeze({
    enabled: true,   // sent with every reply while the character is in the scene
    depth: 4,        // how many messages from the end the block sits
    role: 'system',
});

const isObj = (o) => !!o && typeof o === 'object' && !Array.isArray(o);

/** extensionSettings.exampleDialogue made safe: the switch, the depth, whose voice the block takes. */
export function dialogueConfig(settings) {
    const d = settings && isObj(settings.exampleDialogue) ? settings.exampleDialogue : {};
    const depth = Math.round(Number(d.depth));
    return {
        enabled: typeof d.enabled === 'boolean' ? d.enabled : CONFIG_DEFAULTS.enabled,
        depth: Number.isFinite(depth) ? Math.min(20, Math.max(0, depth)) : CONFIG_DEFAULTS.depth,
        role: ['system', 'user', 'assistant'].includes(d.role) ? d.role : CONFIG_DEFAULTS.role,
    };
}

/** What a card keeps: the text as typed, its line ends made one kind, cut to what a card holds. Trailing space on a line goes; blank lines stay. */
export function cleanDialogue(text) {
    const t = String(text ?? '').replace(/\r\n?/g, '\n').split('\n').map(l => l.replace(/[ \t]+$/, '')).join('\n').replace(/^\n+|\n+$/g, '');
    return t.length > DIALOGUE.stored ? t.slice(0, DIALOGUE.stored) : t;
}

/** A character's card in the Workshop's store (characterInjection) with its example dialogue: by the name as given, else whatever its case. The name is the card's own spelling. Null when there is none written. */
export function dialogueCard(store, name) {
    if (!isObj(store) || !name) return null;
    const key = Object.prototype.hasOwnProperty.call(store, name) ? name : Object.keys(store).find(k => sameName(k, name));
    const hit = key === undefined ? null : store[key];
    const dialogue = isObj(hit) && typeof hit.dialogue === 'string' ? cleanDialogue(hit.dialogue) : '';
    return dialogue ? { name: key, dialogue } : null;
}

/** A character's example dialogue from the Workshop's store; '' when none. */
export function dialogueOf(store, name) {
    const card = dialogueCard(store, name);
    return card ? card.dialogue : '';
}

/**
 * The text as it is sent: SillyTavern's own marks read the way its
 * example dialogue reads them ({{char}} is the character, {{user}} the
 * player, <START> a break between examples), and cut to `max` characters
 * at a line's end where there is one.
 */
export function dialogueText(text, { name = '', player = '', max = DIALOGUE.perChar } = {}) {
    let t = cleanDialogue(text)
        .replace(/\{\{char\}\}/gi, name || 'the character')
        .replace(/\{\{user\}\}/gi, player || 'the player')
        .replace(/^[ \t]*<START>[ \t]*$/gim, '')
        .replace(/\n{3,}/g, '\n\n')
        .replace(/^\n+|\n+$/g, '');
    if (t.length <= max) return t;
    const head = t.slice(0, max);
    const cut = head.lastIndexOf('\n');
    return (cut >= max * 0.5 ? head.slice(0, cut) : `${head.slice(0, max - 1).trimEnd()}…`).replace(/\n+$/, '');
}

/**
 * Who the tracker has in the scene and has example dialogue in the
 * Workshop, in the tracker's order: [{ name, dialogue }]. A character
 * the tracker marks as off the scene is not in it; the player never is.
 * `resolve` turns the tracker's name for someone into the Workshop's
 * (an alias, "the" before a name); the card is looked for under both.
 * @param {*} raw       the tracker's characterThoughts
 * @param {object} store  extensionSettings.characterInjection
 */
export function presentWithDialogue(raw, store, { resolve = null, players = [] } = {}) {
    const out = [];
    const mine = (Array.isArray(players) ? players : [players]).filter(Boolean);
    for (const p of presentFromTracker(raw)) {
        let canon = p.name;
        try { if (typeof resolve === 'function') canon = resolve(p.name) || p.name; } catch (e) { canon = p.name; }
        if (mine.some(m => sameName(m, p.name) || sameName(m, canon))) continue;
        // Named as the card names them, whatever the tracker's spelling.
        const card = dialogueCard(store, canon) || dialogueCard(store, p.name);
        if (!card || out.some(x => sameName(x.name, card.name))) continue;
        out.push(card);
        if (out.length >= DIALOGUE.people) break;
    }
    return out;
}

/**
 * The block sent with a reply: what the lines are for, then each
 * character's under their name. '' when no one has any. The first
 * characters are given in full (to `perChar`); once `total` is reached
 * the rest are left out, never cut to a stub.
 * @param {{ name: string, dialogue: string }[]} people
 */
export function buildDialogueBlock(people, { player = '', perChar = DIALOGUE.perChar, total = DIALOGUE.total } = {}) {
    const parts = [];
    let used = 0;
    for (const p of Array.isArray(people) ? people : []) {
        if (!isObj(p) || !p.name || !p.dialogue) continue;
        const text = dialogueText(p.dialogue, { name: p.name, player, max: perChar });
        if (!text) continue;
        if (parts.length && used + text.length > total) break;
        parts.push(`${p.name}:\n${text}`);
        used += text.length;
        if (parts.length >= DIALOGUE.people) break;
    }
    if (!parts.length) return '';
    return `[How the people in this scene speak. Below are example lines for ${parts.length === 1 ? 'one of them' : 'each of them'}: they show that person's voice (their words, their rhythm, their manner). Write what they say in that voice. The lines are examples and were never said in this story: do not repeat or quote them.]\n${parts.join('\n\n')}`;
}
