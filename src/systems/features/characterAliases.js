/**
 * Character Aliases Module
 * Alternative names for a character card, edited in the Character Workshop.
 *
 * When the AI's tracker output names a character by an alias — e.g. the card
 * is "Sarah" and the AI starts saying "Sarah Greenfield" after a name reveal —
 * the parsed character data is silently normalized to the canonical card name
 * before anything downstream (portrait bar, colors, sheets, knives, card
 * creation) sees it. This stops DES from spawning a duplicate character card.
 *
 * Unlike the old Name Ban mappings, aliases are passive: the message prose is
 * left untouched and the AI is never instructed to avoid the alias — it's a
 * legitimate name for the character, not a banned one.
 *
 * Storage: extensionSettings.characterAliases = { [canonicalName]: string[] }
 */
import { extensionSettings } from '../../core/state.js';

/**
 * Builds a lowercase alias → canonical-name lookup from settings.
 * @returns {Map<string, string>}
 */
function buildAliasLookup() {
    const lookup = new Map();
    const aliasMap = extensionSettings.characterAliases || {};
    for (const [canonical, aliases] of Object.entries(aliasMap)) {
        if (!Array.isArray(aliases)) continue;
        for (const alias of aliases) {
            if (typeof alias !== 'string') continue;
            const key = alias.trim().toLowerCase();
            if (key) lookup.set(key, canonical);
        }
    }
    return lookup;
}

/**
 * Resolves a single name to its canonical card name if it matches an alias
 * (case-insensitive). Returns the input unchanged otherwise.
 *
 * @param {string} name
 * @returns {string}
 */
export function resolveCharacterAlias(name) {
    if (!name) return name;
    return buildAliasLookup().get(String(name).trim().toLowerCase()) || name;
}

/**
 * Records `alias` as an alias of `canonical` (case-insensitive dedup).
 * This module owns the storage format — every writer must go through here
 * (or replicate commitDraft's whole-array replace in characterWorkshop.js)
 * so the shape can't drift. Caller is responsible for persisting via
 * saveSettings().
 *
 * @param {string} canonical - existing NPC card name
 * @param {string} alias - the alternative name to record
 * @returns {boolean} true if the alias was added, false if it already existed
 */
export function addCharacterAlias(canonical, alias) {
    if (!canonical || !alias) return false;
    if (!extensionSettings.characterAliases) extensionSettings.characterAliases = {};
    const list = Array.isArray(extensionSettings.characterAliases[canonical])
        ? extensionSettings.characterAliases[canonical]
        : [];
    if (list.some(a => String(a).toLowerCase() === String(alias).toLowerCase())) {
        extensionSettings.characterAliases[canonical] = list;
        return false;
    }
    list.push(alias);
    extensionSettings.characterAliases[canonical] = list;
    return true;
}

/**
 * Rewrites alias names to canonical card names inside parsed characterThoughts
 * tracker data. Accepts a JSON string or object (array of characters or
 * {characters: []} wrapper) and returns the same shape. Called at the tracker
 * ingestion chokepoint so every downstream consumer sees canonical names.
 *
 * @param {string|Object|null} thoughts - characterThoughts data
 * @returns {string|Object|null} The data with alias names canonicalized
 */
export function applyCharacterAliases(thoughts) {
    if (!thoughts) return thoughts;
    const lookup = buildAliasLookup();
    if (!lookup.size) return thoughts;

    let parsed;
    let wasString = false;
    if (typeof thoughts === 'string') {
        try {
            parsed = JSON.parse(thoughts);
            wasString = true;
        } catch {
            return thoughts;
        }
    } else {
        parsed = thoughts;
    }

    const characters = Array.isArray(parsed) ? parsed : (parsed?.characters || []);
    let changed = false;
    for (const char of characters) {
        if (!char?.name) continue;
        const canonical = lookup.get(String(char.name).trim().toLowerCase());
        if (canonical && canonical !== char.name) {
            char.name = canonical;
            changed = true;
        }
    }

    if (!changed) return thoughts;
    return wasString ? JSON.stringify(parsed) : parsed;
}
