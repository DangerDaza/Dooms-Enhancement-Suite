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
import { extensionSettings, lastGeneratedData } from '../../core/state.js';
import { chat_metadata, saveSettingsDebounced } from '../../../../../../../script.js';
import { namesAreSimilar } from '../../utils/nameSimilarity.js';
import { escapeHtml } from '../../utils/html.js';

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
//   Tier 2 (decision gate, fuzzy): merely-similar names ("Garden" vs "The
//     Gardener") are NOT auto-merged — similar names can be genuinely
//     different characters. Instead a yes/no popup asks once per pair:
//     YES folds the name in as an alias AND scrubs any just-created
//     duplicate card/color/avatar entries; NO records a persistent
//     dismissal (extensionSettings.aliasDismissals) so the pair is never
//     asked about again and the separate character stands.
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

// Tier 2: pairs currently showing (or queued to show) their yes/no popup.
const _pendingDecisions = new Set();

/**
 * Adopts a variant name as an alias of an existing card and scrubs every
 * trace of the duplicate character the variant may have just auto-created:
 * card entries, colors, avatars, injection extras — global and chat-scoped —
 * then re-canonicalizes the live tracker data and refreshes the panels so
 * the duplicate card vanishes immediately.
 */
export async function adoptVariantAsAlias(canonical, variant) {
    addCharacterAlias(canonical, variant);

    const lower = String(variant).trim().toLowerCase();
    const scrub = (obj) => {
        if (!obj || typeof obj !== 'object') return;
        for (const key of Object.keys(obj)) {
            if (key.toLowerCase() === lower) delete obj[key];
        }
    };
    for (const store of ['knownCharacters', 'characterColors', 'npcAvatars', 'npcAvatarsFullRes',
        'characterInjection', 'characterRelationships', 'characterKnives', 'heroPositions', 'characterAppearance']) {
        scrub(extensionSettings[store]);
    }
    try {
        const meta = chat_metadata?.dooms_tracker;
        if (meta) {
            scrub(meta.knownCharacters);
            scrub(meta.characterColors);
            if (Array.isArray(meta.removedCharacters)) {
                meta.removedCharacters = meta.removedCharacters.filter(n => String(n).toLowerCase() !== lower);
            }
        }
    } catch (e) {}
    try { saveSettingsDebounced(); } catch (e) {}

    // Fold the variant out of the live tracker data and repaint. Dynamic
    // imports — the render stack sits above this module in the import graph.
    try {
        lastGeneratedData.characterThoughts = applyCharacterAliases(lastGeneratedData.characterThoughts);
        const { saveChatData } = await import('../../core/persistence.js');
        saveChatData({ immediate: true });
        const { clearPortraitCache, updatePortraitBar } = await import('../ui/portraitBar.js');
        clearPortraitCache();
        updatePortraitBar();
        const { renderThoughts } = await import('../rendering/thoughts.js');
        renderThoughts();
    } catch (e) {
        console.warn('[Dooms Tracker] Aliases: post-adopt refresh failed', e);
    }
    if (typeof window !== 'undefined' && window.toastr) {
        window.toastr.success(`"${variant}" is now an alias of ${canonical}.`, 'Character Aliases', { timeOut: 4000 });
    }
}

/**
 * Tier 2 decision gate. Called during live parses when a NEW tracker name is
 * fuzzy-similar to an existing card: asks the user yes/no (deferred out of
 * the parse call stack). YES → adoptVariantAsAlias; NO → persistent
 * dismissal, the pair is never asked about again.
 */
function queueAliasDecision(name, canonMap) {
    const key = normalizeNameKey(name);
    if (!key || canonMap.has(key)) return;
    for (const canonical of canonMap.values()) {
        if (!namesAreSimilar(stripLeadingArticle(key), stripLeadingArticle(normalizeNameKey(canonical)))) continue;
        const pairKey = `${key}|${normalizeNameKey(canonical)}`;
        if (_pendingDecisions.has(pairKey)) return;
        if (extensionSettings.aliasDismissals?.[pairKey]) return;
        _pendingDecisions.add(pairKey);
        setTimeout(async () => {
            try {
                let yes = false;
                try {
                    const { callGenericPopup, POPUP_TYPE, POPUP_RESULT } = await import('../../../../../../popup.js');
                    if (!callGenericPopup || !POPUP_TYPE) throw new Error('popup module unavailable');
                    const html = `
                        <h3>Possible duplicate character</h3>
                        <p>The AI's tracker mentioned <strong>${escapeHtml(name)}</strong>, which looks similar to your existing character <strong>${escapeHtml(canonical)}</strong>.</p>
                        <p>Are they the same character?</p>
                        <p style="font-size: 0.85em; opacity: 0.7;">
                            Yes — "${escapeHtml(name)}" becomes an alias of ${escapeHtml(canonical)}; no separate character is kept.<br>
                            No — they stay separate characters, and you won't be asked about this pair again.
                        </p>`;
                    const result = await callGenericPopup(html, POPUP_TYPE.CONFIRM, '', {
                        okButton: 'Yes, same character',
                        cancelButton: 'No, keep separate',
                    });
                    yes = (POPUP_RESULT && result === POPUP_RESULT.AFFIRMATIVE) || result === 1 || result === true;
                } catch (popupError) {
                    // The decision still has to happen — plain confirm fallback.
                    yes = typeof window !== 'undefined' && window.confirm(
                        `The AI mentioned "${name}" — similar to your character "${canonical}". Are they the same character?\n\n` +
                        `OK = "${name}" becomes an alias of ${canonical} (no separate character).\n` +
                        `Cancel = keep them separate (you won't be asked again).`
                    );
                }
                if (yes) {
                    await adoptVariantAsAlias(canonical, name);
                } else {
                    if (!extensionSettings.aliasDismissals) extensionSettings.aliasDismissals = {};
                    extensionSettings.aliasDismissals[pairKey] = true;
                    try { saveSettingsDebounced(); } catch (e) {}
                }
            } catch (e) {
                console.warn('[Dooms Tracker] Aliases: duplicate-decision flow failed', e);
            } finally {
                _pendingDecisions.delete(pairKey);
            }
        }, 50);
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
 * new names raise a yes/no duplicate-decision popup instead (Tier 2):
 * yes adopts the alias and scrubs the duplicate, no dismisses permanently.
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
                queueAliasDecision(raw, canonMap);
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
