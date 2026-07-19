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
import { namesAreSimilar, normalizeName } from '../../utils/nameSimilarity.js';
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

// Name normalization comes from nameSimilarity.js (normalizeName) \u2014 this
// module previously carried a byte-identical local copy, which risked the
// two tiers of duplicate detection drifting apart.

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
            const key = normalizeName(name);
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
    const key = normalizeName(name);
    if (!key) return null;
    // Exactly an existing card (modulo case/diacritics/spacing) — not a variant.
    if (canonMap.has(key)) return null;
    // "Nine (Nine-Coins-In-Sequence)" → "Nine"
    const noParen = normalizeName(stripTrailingParenthetical(name));
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
// Decision dialogs are SERIALIZED through this chain — two shown at once
// would destroy each other's DOM (showAliasDecisionDialog wipes any existing
// .dooms-alias-overlay) without ever resolving the first, leaving its pair
// pending forever and stalling every gated bubble pass on the full timeout.
let _dialogQueue = Promise.resolve();
// Variant names (normalized) belonging to those pairs. While a name is in
// here it must not EXIST anywhere: getCharacterList holds it out of the
// PCP (which also blocks knownCharacters card creation and color
// auto-assign), the thoughts renders skip it, and auto-portraits refuse to
// spend a render on it. Answering the popup releases it: Yes folds it into
// the existing card, No/Escape lets it through on the settle repaint.
const _pendingNames = new Set();
// Callers (the chat-bubble pipeline) waiting for all decisions to settle.
const _settlementWaiters = [];

/**
 * True while `name` has an open (or queued) duplicate-decision popup.
 * Ingestion consumers (PCP roster, thoughts renders, auto-portraits) skip
 * such names entirely so the maybe-duplicate never visibly spawns while
 * the user is deciding.
 */
export function hasPendingAliasDecision(name) {
    if (_pendingNames.size === 0 || !name) return false;
    return _pendingNames.has(normalizeName(name));
}

/**
 * Normalized-name Set of the player's persona cards. Aliases are an NPC-only
 * concept (the roster's similar-name flow forbids them on user cards):
 * ingestion must never record an alias ON — or propose merging INTO — a
 * persona, or an NPC gets permanently folded into the player character.
 */
function buildUserNameKeySet() {
    const users = extensionSettings.userCharacters || {};
    return new Set(Object.keys(users).map(normalizeName));
}

/**
 * Persist settings through DES's own saveSettings(). This module writes NEW
 * top-level settings keys (aliasDismissals) — ST's bare saveSettingsDebounced()
 * serializes the stale pre-load blob until saveSettings() re-links
 * extension_settings[extensionName], silently dropping them on reload.
 * Dynamic import: persistence.js sits above this module in the import graph.
 */
function persistSettings() {
    import('../../core/persistence.js')
        .then(({ saveSettings }) => saveSettings())
        .catch(() => { try { saveSettingsDebounced(); } catch (e) {} });
}

/**
 * Repaints every surface that renders present characters after a duplicate
 * decision settles, then re-applies chat bubbles to the last message with the
 * corrected roster. The bubble step matters beyond cosmetics: in
 * separate/external mode the tracker arrives via a second LLM roundtrip, so
 * the popup opens AFTER the 800ms bubble pass already ran — without a
 * re-apply here the pre-decision attribution stays baked on the message.
 * Inline thoughts are re-inserted last (bubbles rewrite .mes_text and would
 * wipe them). Dynamic imports — the render stack sits above this module.
 */
async function repaintAliasSurfaces() {
    try {
        const { clearPortraitCache, updatePortraitBar } = await import('../ui/portraitBar.js');
        clearPortraitCache();
        updatePortraitBar();
        const { renderThoughts, updateChatThoughts } = await import('../rendering/thoughts.js');
        renderThoughts();
        try {
            const mode = extensionSettings.chatBubbleMode;
            if (typeof document !== 'undefined' && mode && mode !== 'off') {
                const { applyChatBubbles, revertLastMessageBubbles } = await import('../rendering/chatBubbles.js');
                // Revert-then-apply is safe in both states: not-yet-bubbled
                // (revert is a no-op) and already-bubbled (revert restores the
                // original font-tagged HTML so the re-parse sees clean input).
                revertLastMessageBubbles();
                const lastMes = document.querySelector('#chat .mes:last-child');
                if (lastMes) applyChatBubbles(lastMes, mode);
            }
        } catch (e) { /* bubbles are best-effort */ }
        setTimeout(() => { try { updateChatThoughts(); } catch (e) {} }, 250);
    } catch (e) {
        console.warn('[Dooms Tracker] Aliases: surface repaint failed', e);
    }
}

function settleIfIdle() {
    if (_pendingDecisions.size === 0) {
        while (_settlementWaiters.length) _settlementWaiters.shift()();
    }
}

/**
 * Resolves once no duplicate-decision popups are pending. The chat-bubble
 * pipeline awaits this before attributing dialogue — attributing while a
 * decision is open bakes the wrong speaker onto bubbles when the user then
 * answers "yes, same character". Resolves immediately when nothing is
 * pending; the timeout is a safety valve against an eternally-open popup.
 */
export function waitForAliasDecisions(timeoutMs = 120000) {
    if (_pendingDecisions.size === 0) return Promise.resolve();
    return new Promise((resolve) => {
        const timer = setTimeout(() => {
            const i = _settlementWaiters.indexOf(done);
            if (i >= 0) _settlementWaiters.splice(i, 1);
            resolve();
        }, timeoutMs);
        const done = () => { clearTimeout(timer); resolve(); };
        _settlementWaiters.push(done);
    });
}

/**
 * DES-native yes/no dialog, themed like every other DES modal (data-theme +
 * the .rpg-settings-popup theme token scope) — ST's generic popup can't
 * follow the user's selected DES theme.
 * Resolves true (same character), false (keep separate, never ask again),
 * or null (backdrop/Escape — decide later, may ask again next message).
 */
function showAliasDecisionDialog(name, canonical) {
    return new Promise((resolve) => {
        if (typeof document === 'undefined' || typeof $ === 'undefined') { resolve(null); return; }
        $('.dooms-alias-overlay').remove();
        const theme = extensionSettings.theme;
        const $overlay = $(`
            <div class="dooms-alias-overlay" role="dialog" aria-modal="true" aria-label="Possible duplicate character">
                <div class="dooms-alias-card">
                    <h3><i class="fa-solid fa-user-group"></i> Possible duplicate character</h3>
                    <p>The AI's tracker mentioned <strong>${escapeHtml(name)}</strong>, which looks similar to your existing character <strong>${escapeHtml(canonical)}</strong>.</p>
                    <p>Are they the same character?</p>
                    <p class="dooms-alias-hint">
                        <strong>Yes</strong> — "${escapeHtml(name)}" becomes an alias of ${escapeHtml(canonical)}; no separate character is kept.<br>
                        <strong>No</strong> — they stay separate characters, and you won't be asked about this pair again.<br>
                        Press Escape to decide later.
                    </p>
                    <div class="dooms-alias-actions">
                        <button type="button" class="dooms-alias-no">No, keep separate</button>
                        <button type="button" class="dooms-alias-yes">Yes, same character</button>
                    </div>
                </div>
            </div>
        `);
        if (theme && theme !== 'default') $overlay.attr('data-theme', theme);
        // Inherit the ACTIVE theme's token values (including custom themes,
        // which set inline vars) by copying computed vars off the themed
        // panel — no class borrowing; .rpg-settings-popup's ::before backdrop
        // painted over this dialog when we tried that.
        try {
            const themedSource = document.querySelector('.rpg-panel');
            if (themedSource) {
                const computed = getComputedStyle(themedSource);
                for (const varName of ['--rpg-bg', '--rpg-text', '--rpg-highlight', '--rpg-border', '--rpg-accent']) {
                    const value = computed.getPropertyValue(varName).trim();
                    if (value) $overlay[0].style.setProperty(varName, value);
                }
            }
        } catch (e) {}
        const done = (result) => {
            $overlay.remove();
            $(document).off('keydown.doomsAliasDecision');
            resolve(result);
        };
        $overlay.on('click', '.dooms-alias-yes', () => done(true));
        $overlay.on('click', '.dooms-alias-no', () => done(false));
        $overlay.on('click', function (e) { if (e.target === this) done(null); });
        $(document).on('keydown.doomsAliasDecision', (e) => { if (e.key === 'Escape') done(null); });
        $('body').append($overlay);
    });
}

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
    const canonLower = String(canonical).trim().toLowerCase();
    const findKey = (obj, target) => {
        if (!obj || typeof obj !== 'object') return undefined;
        return Object.keys(obj).find(k => k.toLowerCase() === target);
    };
    // The variant existed for a moment before the user answered: the color
    // harvest bound this message's <font> hex to it, auto-portraits may have
    // rendered art for it. That data belongs to the canonical character —
    // MOVE it rather than delete it. (Deleting the harvested color orphaned
    // the hex actually used in the message, so the bubble splitter fell back
    // to name-adjacency and attributed the dialogue to the wrong character.)
    const transferIfMissing = (obj) => {
        if (!obj || typeof obj !== 'object') return;
        const vKey = findKey(obj, lower);
        if (vKey === undefined || obj[vKey] == null) return;
        if (findKey(obj, canonLower) === undefined) obj[canonical] = obj[vKey];
    };
    // When the canonical already HAS a different color, the variant's hex is
    // still the one painted on this message's font tags — bank it as a
    // previous-color alias so buildColorToSpeakerMap keeps resolving it to
    // the canonical character without overwriting their real color.
    const bankColorAlias = (colorStore, knownStore) => {
        if (!colorStore || typeof colorStore !== 'object') return;
        const vKey = findKey(colorStore, lower);
        if (vKey === undefined || !colorStore[vKey]) return;
        const cKey = findKey(colorStore, canonLower);
        if (cKey === undefined || !colorStore[cKey]) return; // transferIfMissing covers this case
        const variantHex = String(colorStore[vKey]).toLowerCase();
        if (String(colorStore[cKey]).toLowerCase() === variantHex) return;
        const kKey = findKey(knownStore, canonLower);
        const entry = kKey !== undefined ? knownStore[kKey] : undefined;
        if (!entry || typeof entry !== 'object') return;
        if (!Array.isArray(entry.previousColors)) entry.previousColors = [];
        if (!entry.previousColors.some(c => String(c).toLowerCase() === variantHex)) {
            entry.previousColors.push(colorStore[vKey]);
        }
    };
    const scrub = (obj) => {
        if (!obj || typeof obj !== 'object') return;
        for (const key of Object.keys(obj)) {
            if (key.toLowerCase() === lower) delete obj[key];
        }
    };
    for (const store of ['characterColors', 'npcAvatars', 'npcAvatarsFullRes', 'npcAvatarHistory',
        'characterInjection', 'characterRelationships', 'characterKnives', 'heroPositions', 'characterAppearance']) {
        transferIfMissing(extensionSettings[store]);
    }
    bankColorAlias(extensionSettings.characterColors, extensionSettings.knownCharacters);
    // Portrait data that will NOT survive the scrub (the canonical already has
    // its own entry, so no transfer happened): collect the values now so their
    // image files can be removed from disk afterwards — a bare key delete
    // would orphan them in the des-portraits folder forever.
    const orphanedPortraitValues = [];
    for (const store of ['npcAvatars', 'npcAvatarsFullRes', 'npcAvatarHistory']) {
        const obj = extensionSettings[store];
        if (!obj) continue;
        const vKey = findKey(obj, lower);
        if (vKey === undefined || findKey(obj, canonLower) === undefined) continue;
        const val = obj[vKey];
        if (Array.isArray(val)) orphanedPortraitValues.push(...val.filter(v => typeof v === 'string'));
        else if (typeof val === 'string') orphanedPortraitValues.push(val);
    }
    for (const store of ['knownCharacters', 'characterColors', 'npcAvatars', 'npcAvatarsFullRes', 'npcAvatarHistory',
        'characterInjection', 'characterRelationships', 'characterKnives', 'heroPositions', 'characterAppearance']) {
        scrub(extensionSettings[store]);
    }
    try {
        const meta = chat_metadata?.dooms_tracker;
        if (meta) {
            transferIfMissing(meta.characterColors);
            bankColorAlias(meta.characterColors, meta.knownCharacters);
            scrub(meta.knownCharacters);
            scrub(meta.characterColors);
            if (Array.isArray(meta.removedCharacters)) {
                meta.removedCharacters = meta.removedCharacters.filter(n => String(n).toLowerCase() !== lower);
            }
        }
    } catch (e) {}
    persistSettings();

    // Fold the variant out of the live tracker data and repaint. Dynamic
    // imports — the render stack sits above this module in the import graph.
    try {
        lastGeneratedData.characterThoughts = applyCharacterAliases(lastGeneratedData.characterThoughts);
        const { saveChatData } = await import('../../core/persistence.js');
        saveChatData({ immediate: true });
        if (orphanedPortraitValues.length) {
            try {
                const { deletePortraitFromDiskByValue } = await import('../../utils/avatars.js');
                for (const value of orphanedPortraitValues) {
                    try { await deletePortraitFromDiskByValue(value); } catch (e) {}
                }
            } catch (e) { /* disk cleanup is best-effort */ }
        }
        await repaintAliasSurfaces();
    } catch (e) {
        console.warn('[Dooms Tracker] Aliases: post-adopt refresh failed', e);
    }
    if (typeof window !== 'undefined' && window.toastr) {
        window.toastr.success(`"${escapeHtml(variant)}" is now an alias of ${escapeHtml(canonical)}.`, 'Character Aliases', { timeOut: 4000 });
    }
}

/**
 * Tier 2 decision gate. Called during live parses when a NEW tracker name is
 * fuzzy-similar to an existing card: asks the user yes/no (deferred out of
 * the parse call stack). YES → adoptVariantAsAlias; NO → persistent
 * dismissal, the pair is never asked about again.
 */
function queueAliasDecision(name, canonMap, userKeys) {
    const key = normalizeName(name);
    if (!key || canonMap.has(key)) return;
    // One open question per name — a re-parse (swipe, second call site) while
    // this name's popup is pending must not queue a second dialog against a
    // different canonical.
    if (_pendingNames.has(key)) return;
    for (const [candidateKey, canonical] of canonMap) {
        // Cheap gates first: an already-dismissed pair costs two lookups on
        // every future message, not a Levenshtein pass — and a dismissed or
        // persona candidate must not stop the OTHER candidates from being
        // considered (continue, never return).
        const pairKey = `${key}|${candidateKey}`;
        if (extensionSettings.aliasDismissals?.[pairKey]) continue;
        // Merging an NPC into a user persona is never offered — aliases are
        // an NPC-only concept (the roster's flow forbids them on user cards).
        if (userKeys && userKeys.has(candidateKey)) continue;
        if (!namesAreSimilar(stripLeadingArticle(key), stripLeadingArticle(candidateKey))) continue;
        _pendingDecisions.add(pairKey);
        _pendingNames.add(key);
        const job = async () => {
            let decision = null;
            try {
                try {
                    decision = await showAliasDecisionDialog(name, canonical);
                } catch (dialogError) {
                    // The decision still has to happen — plain confirm fallback.
                    decision = typeof window !== 'undefined' && window.confirm(
                        `The AI mentioned "${name}" — similar to your character "${canonical}". Are they the same character?\n\n` +
                        `OK = "${name}" becomes an alias of ${canonical} (no separate character).\n` +
                        `Cancel = keep them separate (you won't be asked again).`
                    );
                }
                if (decision === true) {
                    await adoptVariantAsAlias(canonical, name);
                } else if (decision === false) {
                    if (!extensionSettings.aliasDismissals) extensionSettings.aliasDismissals = {};
                    extensionSettings.aliasDismissals[pairKey] = true;
                    persistSettings();
                }
                // decision === null: closed without deciding — no dismissal
                // recorded, the pair may ask again on a future message.
            } catch (e) {
                console.warn('[Dooms Tracker] Aliases: duplicate-decision flow failed', e);
            } finally {
                _pendingDecisions.delete(pairKey);
                _pendingNames.delete(key);
                // Release the gated bubble passes FIRST (they need the settled
                // roster), then repaint. Yes already repainted inside
                // adoptVariantAsAlias with the variant folded away; No/Escape
                // means the held-back card may exist after all — paint it now
                // instead of on the next message.
                settleIfIdle();
                if (decision !== true) {
                    await repaintAliasSurfaces();
                }
            }
        };
        // Serialized: see _dialogQueue. job never rejects (it catches), but
        // chain both callbacks anyway so one broken run can't stall the queue.
        setTimeout(() => { _dialogQueue = _dialogQueue.then(job, job); }, 50);
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
    const userKeys = buildUserNameKeySet();
    for (const char of characters) {
        if (!char?.name) continue;
        const raw = String(char.name).trim();
        let canonical = lookup.get(raw.toLowerCase());
        if (!canonical) {
            const structural = resolveStructuralVariant(raw, canonMap);
            if (structural) {
                canonical = structural;
                // Remember the variant so future ingestions hit the fast
                // alias path and the user can see/remove it in the Workshop —
                // except on user personas: the fold itself is wanted (no NPC
                // card for a decorated player name), but aliases are an
                // NPC-only concept and must never be recorded on a user card.
                if (!userKeys.has(normalizeName(structural)) && addCharacterAlias(structural, raw)) aliasesRecorded = true;
            } else if (suggestSimilar) {
                queueAliasDecision(raw, canonMap, userKeys);
            }
        }
        if (canonical && canonical !== char.name) {
            char.name = canonical;
            changed = true;
        }
    }
    if (aliasesRecorded) {
        persistSettings();
    }

    if (!changed) return thoughts;
    return wasString ? JSON.stringify(parsed) : parsed;
}
