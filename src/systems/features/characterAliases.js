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
import { chat_metadata, saveSettingsDebounced } from '../../../../../../../script.js';
import { ensureSettingsUI } from '../../core/lazyUI.js';
import { namesAreSimilar } from '../../utils/nameSimilarity.js';

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

// ────────────────────────────────────────────────────────────────────────────
// Structural variant detection — the popup-free half of duplicate prevention.
//
// The roster's similar-name panel guards MANUAL character creation, but most
// duplicate cards are born at tracker INGESTION: the AI decorates an existing
// name ("Nine" → "Nine (Nine-Coins-In-Sequence)", "The Gardener" →
// "Gardener") and the unknown name auto-creates a card. No popup is possible
// mid-generation, so ingestion gets two tiers instead:
//   Tier 1 (silent auto-fold, high precision): parenthetical decorations of an
//     existing card name, leading-article variants, and diacritic/spacing
//     variants are canonicalized automatically and RECORDED as aliases — so
//     they show up in Workshop → Identity → Aliases where the user can undo.
//   Tier 2 (suggestion, fuzzy): merely-similar names ("Garden" vs "The
//     Gardener") are NOT auto-merged — similar names can be genuinely
//     different characters — but a one-time toast suggests adding the alias.
// A name that exactly matches an EXISTING card is never touched by either
// tier: explicit user setup wins.
// ────────────────────────────────────────────────────────────────────────────

function normalizeNameKey(s) {
    return String(s || '')
        .trim()
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/\s+/g, ' ');
}

function stripLeadingArticle(s) {
    return s.replace(/^(?:the|a|an)\s+/i, '').trim();
}

function stripTrailingParenthetical(s) {
    return s.replace(/\s*[(（][^)）]*[)）]\s*$/, '').trim();
}

/**
 * Every canonical card name (NPC global + chat-scoped + user characters),
 * keyed by normalized name. Reads the stores directly — this module sits
 * below persistence.js in the import graph and cannot use its getters.
 * @returns {Map<string, string>} normalized key → canonical name
 */
function buildCanonicalNameMap() {
    const map = new Map();
    const push = (obj) => {
        if (!obj || typeof obj !== 'object') return;
        for (const name of Object.keys(obj)) {
            const key = normalizeNameKey(name);
            if (key && !map.has(key)) map.set(key, name);
        }
    };
    push(extensionSettings.knownCharacters);
    push(extensionSettings.userCharacters);
    try { push(chat_metadata?.dooms_tracker?.knownCharacters); } catch (e) {}
    return map;
}

/**
 * Tier 1: resolves a tracker name that is a STRUCTURAL variant of an existing
 * card. Returns the canonical card name, or null when the name is its own
 * card / no safe match exists.
 */
function resolveStructuralVariant(name, canonMap) {
    const key = normalizeNameKey(name);
    if (!key) return null;
    // Exactly an existing card (modulo case/diacritics/spacing) — not a variant.
    if (canonMap.has(key)) return null;
    // "Nine (Nine-Coins-In-Sequence)" → "Nine"
    const noParen = normalizeNameKey(stripTrailingParenthetical(name));
    if (noParen && noParen !== key && canonMap.has(noParen)) return canonMap.get(noParen);
    // "Gardener" ↔ "The Gardener" (article-insensitive exact)
    const noArticle = stripLeadingArticle(key);
    for (const [candidateKey, canonical] of canonMap) {
        if (candidateKey !== key && stripLeadingArticle(candidateKey) === noArticle) return canonical;
    }
    return null;
}

// Tier 2: fuzzy pairs already suggested this session (variant|canonical) —
// one toast per pair, not one per message.
const _suggestedPairs = new Set();

function maybeSuggestAlias(name, canonMap) {
    if (typeof window === 'undefined' || !window.toastr) return;
    const key = normalizeNameKey(name);
    if (!key || canonMap.has(key)) return;
    for (const canonical of canonMap.values()) {
        if (!namesAreSimilar(stripLeadingArticle(normalizeNameKey(name)), stripLeadingArticle(normalizeNameKey(canonical)))) continue;
        const pairKey = `${key}|${normalizeNameKey(canonical)}`;
        if (_suggestedPairs.has(pairKey)) return;
        _suggestedPairs.add(pairKey);
        window.toastr.info(
            `The tracker mentioned "${name}" — similar to your character "${canonical}". If they're the same, click here to open ${canonical} in the Workshop and add "${name}" as an alias; otherwise ignore this.`,
            'Possible duplicate character',
            {
                timeOut: 12000,
                onclick: () => {
                    ensureSettingsUI().then(() => {
                        window.dispatchEvent(new CustomEvent('dooms:open-workshop', { detail: { characterName: canonical, isUser: false } }));
                    }).catch(() => {});
                },
            },
        );
        return;
    }
}

/**
 * Rewrites alias names to canonical card names inside parsed characterThoughts
 * tracker data. Accepts a JSON string or object (array of characters or
 * {characters: []} wrapper) and returns the same shape. Called at the tracker
 * ingestion chokepoint so every downstream consumer sees canonical names.
 *
 * Beyond stored aliases, structural variants of existing card names
 * (parentheticals, leading articles, diacritic/spacing differences) are
 * folded in automatically and recorded as aliases (Tier 1 above). With
 * options.suggestSimilar (live-generation call sites only), merely-similar
 * new names trigger a one-time suggestion toast instead (Tier 2).
 *
 * @param {string|Object|null} thoughts - characterThoughts data
 * @param {{suggestSimilar?: boolean}} [options]
 * @returns {string|Object|null} The data with alias names canonicalized
 */
export function applyCharacterAliases(thoughts, { suggestSimilar = false } = {}) {
    if (!thoughts) return thoughts;
    const lookup = buildAliasLookup();

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
    let aliasesRecorded = false;
    const canonMap = buildCanonicalNameMap();
    for (const char of characters) {
        if (!char?.name) continue;
        const raw = String(char.name).trim();
        let canonical = lookup.get(raw.toLowerCase());
        if (!canonical) {
            const structural = resolveStructuralVariant(raw, canonMap);
            if (structural) {
                canonical = structural;
                // Remember the variant so future ingestions hit the fast
                // alias path and the user can see/remove it in the Workshop.
                if (addCharacterAlias(structural, raw)) aliasesRecorded = true;
            } else if (suggestSimilar) {
                maybeSuggestAlias(raw, canonMap);
            }
        }
        if (canonical && canonical !== char.name) {
            char.name = canonical;
            changed = true;
        }
    }
    if (aliasesRecorded) {
        try { saveSettingsDebounced(); } catch (e) {}
    }

    if (!changed) return thoughts;
    return wasString ? JSON.stringify(parsed) : parsed;
}
