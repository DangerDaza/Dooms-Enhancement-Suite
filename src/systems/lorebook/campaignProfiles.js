/**
 * Campaign Profiles — per-campaign versions of a character's identity.
 *
 * The Character Workshop's identity stores are flat and keyed by bare name
 * (extensionSettings.characterInjection[name], npcAvatars[name], ...). Every
 * module that renders or prompts reads them directly. Rather than teach ~30
 * call sites about campaigns, an active campaign PHYSICALLY SWAPS those flat
 * stores: the campaign's saved version of each character it overrides is
 * written into the stores, and the base entry it displaces is parked in a
 * shadow map until the campaign is switched away again.
 *
 * Invariant while a campaign is active:
 *     live (flat stores) = base ⊕ campaignProfiles[active]
 *     campaignBaseShadow = exactly the base entries hidden by that ⊕
 * With no active campaign the shadow is empty and the flat stores ARE the
 * base — byte-for-byte the pre-campaign behaviour.
 *
 * Storage (all additive, see state.js defaults):
 *     extensionSettings.campaignProfiles   = { [campaignId]: { [name]: Profile } }
 *     extensionSettings.campaignBaseShadow = { [name]: Profile | null }   (null = no base entry)
 *     extensionSettings.lorebook.activeCampaignId = campaignId | null
 *
 * A Profile mirrors one character's slice of the flat stores; see
 * PROFILE_FIELDS for the field ↔ store mapping. Absent field = absent key.
 *
 * This module imports ONLY state.js so it is unit-testable in plain Node
 * (tools/campaign-profiles-test.mjs) and importable from persistence.js
 * without a cycle. It never persists — callers save.
 *
 * Banking: persistence.saveSettings() calls bankActiveCampaign() first, so
 * the active campaign's bucket always mirrors the live stores before any
 * write hits disk. Edits made while playing can therefore never be lost on
 * the next switch, and no unload hook is needed.
 */
import { extensionSettings } from '../../core/state.js';

/** Profile field ↔ flat store, in a stable order. */
export const PROFILE_FIELDS = Object.freeze([
    { field: 'injection',     store: 'characterInjection' },
    { field: 'appearance',    store: 'characterAppearance' },
    { field: 'avatar',        store: 'npcAvatars' },
    { field: 'avatarFullRes', store: 'npcAvatarsFullRes' },
    { field: 'avatarHistory', store: 'npcAvatarHistory' },
    { field: 'relationship',  store: 'characterRelationships' },
    { field: 'knives',        store: 'characterKnives' },
    { field: 'heroPosition',  store: 'heroPositions' },
    { field: 'portraitMeta',  store: 'generatedPortraits' },
    { field: 'voice',         store: 'characterVoices' },
]);

/** The version id of the flat stores themselves. */
export const BASE_VERSION = 'base';

// ─── Internals ──────────────────────────────────────────────────────────────

const hasOwn = (obj, key) => !!obj && typeof obj === 'object' && Object.prototype.hasOwnProperty.call(obj, key);

function clone(value) {
    if (value === undefined) return undefined;
    if (value === null) return null;
    if (typeof value !== 'object') return value;
    return JSON.parse(JSON.stringify(value));
}

function findKey(obj, lowerName) {
    if (!obj || typeof obj !== 'object') return undefined;
    return Object.keys(obj).find(k => k.toLowerCase() === lowerName);
}

function profilesRoot() {
    if (!extensionSettings.campaignProfiles || typeof extensionSettings.campaignProfiles !== 'object' || Array.isArray(extensionSettings.campaignProfiles)) {
        extensionSettings.campaignProfiles = {};
    }
    return extensionSettings.campaignProfiles;
}

function shadowRoot() {
    if (!extensionSettings.campaignBaseShadow || typeof extensionSettings.campaignBaseShadow !== 'object' || Array.isArray(extensionSettings.campaignBaseShadow)) {
        extensionSettings.campaignBaseShadow = {};
    }
    return extensionSettings.campaignBaseShadow;
}

function bucket(campaignId, create = false) {
    if (!campaignId) return null;
    const root = profilesRoot();
    if (!root[campaignId] || typeof root[campaignId] !== 'object' || Array.isArray(root[campaignId])) {
        if (!create) return null;
        root[campaignId] = {};
    }
    return root[campaignId];
}

function isBase(versionId) {
    return !versionId || versionId === BASE_VERSION;
}

/**
 * Two references to the same on-disk DES portrait can differ only by the
 * cache-bust query (`?t=<mtime>`) — persistPortrait reuses the filename when
 * it re-saves in place. Reference counting must therefore compare files,
 * not strings. Non-DES values (data: URLs, /characters/<file>) compare as-is.
 */
export function portraitRefKey(value) {
    if (typeof value !== 'string' || !value) return '';
    if (value.startsWith('data:')) return value;
    const q = value.search(/[?#]/);
    return q === -1 ? value : value.slice(0, q);
}

// ─── Queries ────────────────────────────────────────────────────────────────

/** @returns {string|null} */
export function getActiveCampaignId() {
    const id = extensionSettings.lorebook?.activeCampaignId;
    return typeof id === 'string' && id ? id : null;
}

/** Whether `campaignId` holds a saved version of `name`. */
export function hasProfile(campaignId, name) {
    const b = bucket(campaignId);
    return !!(b && hasOwn(b, name) && b[name] && typeof b[name] === 'object');
}

/** A clone of the stored (not live) version, or null. */
export function getProfile(campaignId, name) {
    return hasProfile(campaignId, name) ? clone(bucket(campaignId)[name]) : null;
}

/**
 * Campaign ids that hold a version of `name`, in campaignProfiles key order.
 * Buckets whose campaign no longer exists are ignored (ensureCampaignSettings
 * removes them on the next load).
 */
export function listProfileCampaigns(name) {
    const campaigns = extensionSettings.lorebook?.campaigns;
    return Object.keys(profilesRoot()).filter(id => hasProfile(id, name) && (!campaigns || !!campaigns[id]));
}

/** Base + every campaign version. Always ≥ 1. */
export function countVersions(name) {
    return 1 + listProfileCampaigns(name).length;
}

/** True when the active campaign overrides `name` (so the base entry is in the shadow). */
export function isOverridden(name) {
    const active = getActiveCampaignId();
    return !!active && hasProfile(active, name);
}

/**
 * True when `versionId` for `name` resolves to the flat stores:
 * the active campaign's version, or base when nothing overrides the name.
 */
export function isLiveVersion(versionId, name) {
    if (isBase(versionId)) return !isOverridden(name);
    return versionId === getActiveCampaignId();
}

// ─── Live store access ──────────────────────────────────────────────────────

/**
 * The character's current slice of the flat stores as a Profile (deep clone),
 * or null when no store has the key.
 */
export function snapshotLive(name) {
    const out = {};
    let any = false;
    for (const { field, store } of PROFILE_FIELDS) {
        const map = extensionSettings[store];
        if (!hasOwn(map, name)) continue;
        const value = map[name];
        if (value === undefined || value === null) continue;
        out[field] = clone(value);
        any = true;
    }
    return any ? out : null;
}

/** Writes a Profile into the flat stores; absent fields delete the store key. */
export function applyToLive(name, profile) {
    for (const { field, store } of PROFILE_FIELDS) {
        const value = profile && typeof profile === 'object' ? profile[field] : undefined;
        if (value === undefined || value === null) {
            const map = extensionSettings[store];
            if (map && typeof map === 'object') delete map[name];
        } else {
            if (!extensionSettings[store] || typeof extensionSettings[store] !== 'object') extensionSettings[store] = {};
            extensionSettings[store][name] = clone(value);
        }
    }
}

/** Deletes `name` from every profile-backed flat store. */
export function removeFromLive(name) {
    applyToLive(name, null);
}

// ─── Version read / write (what the Workshop shows and saves) ───────────────

/**
 * The version of `name` the user asked to see: live stores, the shadowed base
 * entry, or an inactive campaign's bucket. Returns a clone or null.
 * @param {string} versionId - 'base' or a campaign id
 */
export function readVersion(versionId, name) {
    if (isLiveVersion(versionId, name)) return snapshotLive(name);
    if (isBase(versionId)) {
        const shadow = shadowRoot();
        return hasOwn(shadow, name) && shadow[name] ? clone(shadow[name]) : null;
    }
    return getProfile(versionId, name);
}

/** Inverse of readVersion. `profile` null clears that version's entry. */
export function writeVersion(versionId, name, profile) {
    if (isLiveVersion(versionId, name)) {
        applyToLive(name, profile);
        return;
    }
    if (isBase(versionId)) {
        shadowRoot()[name] = profile ? clone(profile) : null;
        return;
    }
    bucket(versionId, true)[name] = profile ? clone(profile) : {};
}

// ─── Profile lifecycle ──────────────────────────────────────────────────────

/**
 * Creates `campaignId`'s version of `name` as a clone of another version
 * (base by default). When the campaign is active the clone immediately
 * becomes the live view and the displaced base entry moves to the shadow.
 * No-op (returns the existing profile) when the version already exists.
 */
export function addProfile(campaignId, name, { from = BASE_VERSION } = {}) {
    if (!campaignId || !name) return null;
    if (hasProfile(campaignId, name)) return getProfile(campaignId, name);
    const source = readVersion(from, name) || {};
    if (campaignId === getActiveCampaignId()) {
        shadowRoot()[name] = snapshotLive(name);
        bucket(campaignId, true)[name] = clone(source);
        applyToLive(name, source);
    } else {
        bucket(campaignId, true)[name] = clone(source);
    }
    return clone(source);
}

/**
 * Drops `campaignId`'s version of `name`. When the campaign is active the
 * base entry returns to the live stores. Returns the portrait values the
 * dropped version referenced — the caller decides (via unreferencedPortraits)
 * which files nothing else still points at.
 * @returns {string[]}
 */
export function removeProfile(campaignId, name) {
    const b = bucket(campaignId);
    if (!b || !hasOwn(b, name)) return [];
    const candidates = portraitValuesOf(b[name]);
    delete b[name];
    if (campaignId === getActiveCampaignId()) {
        candidates.push(...portraitValuesOf(snapshotLive(name)));
        const shadow = shadowRoot();
        applyToLive(name, hasOwn(shadow, name) ? shadow[name] : null);
        delete shadow[name];
    }
    return candidates;
}

/**
 * Copies the live stores back into the active campaign's bucket for every
 * character it overrides. Idempotent and cheap; runs on every saveSettings.
 * @returns {number} profiles banked
 */
export function bankActiveCampaign() {
    const active = getActiveCampaignId();
    const b = bucket(active);
    if (!b) return 0;
    let n = 0;
    for (const name of Object.keys(b)) {
        b[name] = snapshotLive(name) || {};
        n++;
    }
    return n;
}

/**
 * The profile half of a campaign switch (books are campaignManager's job).
 * Banks the outgoing campaign, restores the base entries it was hiding, then
 * parks the base entries the incoming campaign overrides and applies its
 * versions. Either id may be null. Pure and synchronous; caller sets
 * lorebook.activeCampaignId = nextId afterwards and saves.
 */
export function switchCampaignProfiles(prevId, nextId) {
    const shadow = shadowRoot();
    const prevBucket = bucket(prevId);
    if (prevBucket) {
        for (const name of Object.keys(prevBucket)) prevBucket[name] = snapshotLive(name) || {};
    }
    // Restore whatever the shadow holds even if prevId is null — a stale
    // shadow can only come from a crash mid-switch and must not leak.
    for (const name of Object.keys(shadow)) applyToLive(name, shadow[name]);
    extensionSettings.campaignBaseShadow = {};
    const nextBucket = bucket(nextId);
    if (nextBucket) {
        const nextShadow = extensionSettings.campaignBaseShadow;
        for (const name of Object.keys(nextBucket)) {
            nextShadow[name] = snapshotLive(name);
            applyToLive(name, nextBucket[name]);
        }
    }
}

/**
 * Removes every campaign version of `name` and its shadow entry. The live
 * stores are the caller's job (it owns the chat-scoped stores too). Returns
 * the portrait values those versions referenced.
 * @returns {string[]}
 */
export function deleteCharacterEverywhere(name) {
    const candidates = [];
    const root = profilesRoot();
    for (const id of Object.keys(root)) {
        const b = root[id];
        if (!hasOwn(b, name)) continue;
        candidates.push(...portraitValuesOf(b[name]));
        delete b[name];
    }
    const shadow = shadowRoot();
    if (hasOwn(shadow, name)) {
        candidates.push(...portraitValuesOf(shadow[name]));
        delete shadow[name];
    }
    return candidates;
}

/**
 * Drops a whole campaign bucket. The campaign must not be active (switch to
 * null first). Returns the portrait values it referenced.
 * @returns {string[]}
 */
export function deleteCampaignProfiles(campaignId) {
    const b = bucket(campaignId);
    if (!b) return [];
    const candidates = [];
    for (const profile of Object.values(b)) candidates.push(...portraitValuesOf(profile));
    delete profilesRoot()[campaignId];
    return candidates;
}

/**
 * Alias adoption: folds `variant`'s versions into `canonical`'s, bucket by
 * bucket, with the same transfer-if-missing rule the live merge uses. MUST
 * run BEFORE characterAliases merges the live stores, because when the
 * active campaign overrides the variant but not the canonical, the
 * canonical's base entry (its live value right now) has to be parked in the
 * shadow before the live merge changes it. Returns the portrait values that
 * did not survive (canonical already had that field) for ref-counted cleanup.
 * @returns {string[]}
 */
export function mergeVariantIntoCanonicalProfiles(canonical, variant) {
    const lower = String(variant || '').toLowerCase();
    const canonLower = String(canonical || '').toLowerCase();
    if (!lower || !canonLower || lower === canonLower) return [];
    const candidates = [];
    const active = getActiveCampaignId();
    const shadow = shadowRoot();
    // The active bucket only lags behind live between saves; refresh it so
    // the merge below sees the variant's current version, not a stale copy.
    bankActiveCampaign();
    const activeBucket = bucket(active);

    // The active campaign overrides the variant but not the canonical: the
    // canonical is about to become overridden too (it inherits the variant's
    // version), so its base — which is its live entry at this moment — must
    // be parked first or a later switch-away would lose it.
    const activeHasVariant = !!activeBucket && findKey(activeBucket, lower) !== undefined;
    const activeHasCanonical = !!activeBucket && findKey(activeBucket, canonLower) !== undefined;
    if (activeHasVariant && !activeHasCanonical) {
        if (findKey(shadow, canonLower) === undefined) shadow[canonical] = snapshotLive(canonical);
    }
    // The reverse: the active campaign overrides the canonical but not the
    // variant. The variant's live entry IS its base, and the live merge that
    // follows would fold it into the canonical's CAMPAIGN version only — its
    // base would never reach the canonical's base and its portrait file would
    // be deleted as an orphan. Fold it into the canonical's shadowed base here.
    if (activeHasCanonical && !activeHasVariant) {
        const variantBase = snapshotLive(variant);
        if (variantBase) {
            const sKey = findKey(shadow, canonLower);
            const target = (sKey !== undefined && shadow[sKey] && typeof shadow[sKey] === 'object') ? shadow[sKey] : {};
            for (const { field } of PROFILE_FIELDS) {
                const vValue = variantBase[field];
                if (vValue === undefined || vValue === null) continue;
                if (target[field] === undefined || target[field] === null) target[field] = vValue;
                else candidates.push(...portraitValuesOf({ [field]: vValue }));
            }
            shadow[sKey !== undefined ? sKey : canonical] = target;
        }
    }

    const mergeBucket = (b) => {
        const vKey = findKey(b, lower);
        if (vKey === undefined) return;
        const vProfile = b[vKey];
        const cKey = findKey(b, canonLower);
        if (cKey === undefined) {
            b[canonical] = vProfile;
        } else if (b[cKey] && typeof b[cKey] === 'object') {
            const cProfile = b[cKey];
            for (const { field } of PROFILE_FIELDS) {
                const vValue = vProfile && typeof vProfile === 'object' ? vProfile[field] : undefined;
                if (vValue === undefined || vValue === null) continue;
                if (cProfile[field] === undefined || cProfile[field] === null) {
                    cProfile[field] = vValue;
                } else {
                    candidates.push(...portraitValuesOf({ [field]: vValue }));
                }
            }
        } else {
            // canonical key present but null (no base entry): the variant's becomes it
            b[cKey] = vProfile;
        }
        delete b[vKey];
    };

    mergeBucket(shadow);
    for (const b of Object.values(profilesRoot())) {
        if (b && typeof b === 'object') mergeBucket(b);
    }
    return candidates;
}

// ─── Portrait reference counting ────────────────────────────────────────────

/** Every portrait value string a Profile carries. */
export function portraitValuesOf(profile) {
    if (!profile || typeof profile !== 'object') return [];
    const out = [];
    const add = (v) => { if (typeof v === 'string' && v) out.push(v); };
    add(profile.avatar);
    add(profile.avatarFullRes);
    add(profile.portraitMeta?.url);
    if (Array.isArray(profile.avatarHistory)) {
        for (const entry of profile.avatarHistory) {
            if (entry && typeof entry === 'object') { add(entry.avatar); add(entry.avatarFullRes); }
            else add(entry);
        }
    }
    return out;
}

/**
 * Visits every portrait value still referenced anywhere: live stores
 * (current, full-res, history, auto-portrait meta), user characters, the
 * shadow and every INACTIVE campaign bucket. The active campaign's bucket is
 * deliberately skipped — the live stores ARE that bucket, and its banked
 * copy only lags behind live (a value just deleted from live would still
 * show up there and pin its file forever).
 */
function forEachPortraitRef(visit) {
    const add = (v) => { if (typeof v === 'string' && v) visit(v); };
    for (const store of ['npcAvatars', 'npcAvatarsFullRes']) {
        const map = extensionSettings[store];
        if (map && typeof map === 'object') for (const v of Object.values(map)) add(v);
    }
    const history = extensionSettings.npcAvatarHistory;
    if (history && typeof history === 'object') {
        for (const list of Object.values(history)) {
            if (!Array.isArray(list)) continue;
            for (const entry of list) {
                if (entry && typeof entry === 'object') { add(entry.avatar); add(entry.avatarFullRes); }
                else add(entry);
            }
        }
    }
    const generated = extensionSettings.generatedPortraits;
    if (generated && typeof generated === 'object') for (const meta of Object.values(generated)) add(meta?.url);
    const users = extensionSettings.userCharacters;
    if (users && typeof users === 'object') for (const u of Object.values(users)) { add(u?.avatar); add(u?.avatarFullRes); }
    const active = getActiveCampaignId();
    const root = profilesRoot();
    const buckets = [shadowRoot(), ...Object.keys(root).filter(id => id !== active).map(id => root[id])];
    for (const b of buckets) {
        if (!b || typeof b !== 'object') continue;
        for (const profile of Object.values(b)) for (const v of portraitValuesOf(profile)) add(v);
    }
}

/**
 * Every portrait file still referenced (see forEachPortraitRef for the
 * sources). Keys are portraitRefKey() values.
 * @returns {Set<string>}
 */
export function collectPortraitRefs() {
    const refs = new Set();
    forEachPortraitRef((v) => { const k = portraitRefKey(v); if (k) refs.add(k); });
    return refs;
}

/**
 * How many store entries point at the same file as `value`. A portrait file
 * may only be overwritten in place (persistPortrait reuses the filename)
 * when this is at most 1 — i.e. only the entry being replaced references it.
 * @returns {number}
 */
export function portraitRefCount(value) {
    const key = portraitRefKey(value);
    if (!key) return 0;
    let n = 0;
    forEachPortraitRef((v) => { if (portraitRefKey(v) === key) n++; });
    return n;
}

/**
 * The subset of `candidates` no store, shadow or profile still references.
 * Call AFTER the removal that orphaned them. Deduplicated by file.
 * @returns {string[]}
 */
export function unreferencedPortraits(candidates) {
    const refs = collectPortraitRefs();
    const seen = new Set();
    const out = [];
    for (const value of candidates || []) {
        const key = portraitRefKey(value);
        if (!key || seen.has(key) || refs.has(key)) continue;
        seen.add(key);
        out.push(value);
    }
    return out;
}

// ─── Voice reference counting (DES voices) ──────────────────────────────────

/**
 * @typedef {{kind: 'character'|'persona'|'narrator', name: string|null, versionId: string|null}} VoiceUse
 *   versionId: BASE_VERSION or a campaign id for characters; null otherwise.
 */

/**
 * Visits every place a voice id is used: live characterVoices (as the
 * version it currently is), the shadowed base entries, every INACTIVE
 * campaign bucket, persona voices and the Narrator. As with portraits the
 * active bucket is skipped — live IS that version and its banked copy lags.
 * @param {(id: string, use: VoiceUse) => void} visit
 */
export function forEachVoiceRef(visit) {
    const active = getActiveCampaignId();
    const add = (ref, use) => { if (ref && typeof ref === 'object' && typeof ref.id === 'string' && ref.id) visit(ref.id, use); };
    const live = extensionSettings.characterVoices;
    if (live && typeof live === 'object') {
        for (const [name, ref] of Object.entries(live)) {
            add(ref, { kind: 'character', name, versionId: active && hasProfile(active, name) ? active : BASE_VERSION });
        }
    }
    const shadow = shadowRoot();
    for (const [name, profile] of Object.entries(shadow)) add(profile?.voice, { kind: 'character', name, versionId: BASE_VERSION });
    const root = profilesRoot();
    for (const [campaignId, b] of Object.entries(root)) {
        if (campaignId === active || !b || typeof b !== 'object') continue;
        for (const [name, profile] of Object.entries(b)) add(profile?.voice, { kind: 'character', name, versionId: campaignId });
    }
    const users = extensionSettings.userCharacters;
    if (users && typeof users === 'object') {
        for (const [name, u] of Object.entries(users)) add(u?.voice, { kind: 'persona', name, versionId: null });
    }
    add(extensionSettings.voices?.narratorVoice, { kind: 'narrator', name: null, versionId: null });
}

/** Where a voice id is used (see forEachVoiceRef). */
export function voiceUses(id) {
    const out = [];
    if (!id) return out;
    forEachVoiceRef((refId, use) => { if (refId === id) out.push(use); });
    return out;
}

/** How many places use a voice id. */
export function voiceRefCount(id) {
    return voiceUses(id).length;
}

/**
 * Replaces (or, with newId null, removes) every reference to a voice id —
 * live stores, the shadow, EVERY campaign bucket (the active one too, so it
 * can't resurrect a stale id), personas and the Narrator. A removed
 * character/persona voice falls back to the Narrator; a removed Narrator
 * voice falls back to the built-in default. Caller saves.
 * @param {string} oldId
 * @param {string|null} newId
 * @param {object} [patch] - extra fields for the replacement ref (e.g. label)
 * @returns {number} references changed
 */
export function rewriteVoiceRefs(oldId, newId, patch = {}) {
    if (!oldId) return 0;
    let n = 0;
    const next = (ref) => (newId ? { ...ref, ...patch, id: newId } : null);
    const fix = (holder, key) => {
        const ref = holder?.[key];
        if (!ref || typeof ref !== 'object' || ref.id !== oldId) return;
        const repl = next(ref);
        if (repl) holder[key] = repl;
        else delete holder[key];
        n++;
    };
    const live = extensionSettings.characterVoices;
    if (live && typeof live === 'object') for (const name of Object.keys(live)) fix(live, name);
    const shadow = shadowRoot();
    for (const profile of Object.values(shadow)) if (profile && typeof profile === 'object') fix(profile, 'voice');
    for (const b of Object.values(profilesRoot())) {
        if (!b || typeof b !== 'object') continue;
        for (const profile of Object.values(b)) if (profile && typeof profile === 'object') fix(profile, 'voice');
    }
    const users = extensionSettings.userCharacters;
    if (users && typeof users === 'object') for (const u of Object.values(users)) if (u && typeof u === 'object') fix(u, 'voice');
    const v = extensionSettings.voices;
    if (v && v.narratorVoice && v.narratorVoice.id === oldId) {
        v.narratorVoice = newId ? { ...v.narratorVoice, ...patch, id: newId } : { source: 'stock', id: 'Charon' };
        n++;
    }
    return n;
}

// ─── Book bookkeeping shared with campaignManager ───────────────────────────

/** A lorebook was renamed: keep the global list, the ledger and campaign folders pointing at it. */
export function renameBookEverywhere(oldName, newName) {
    const lb = extensionSettings.lorebook;
    if (!lb || !oldName || !newName || oldName === newName) return;
    const swap = (list) => {
        if (!Array.isArray(list)) return;
        const idx = list.indexOf(oldName);
        if (idx !== -1) list[idx] = newName;
    };
    swap(lb.globalBooks);
    swap(lb.campaignActivated);
    swap(lb.autoLinked);
    for (const campaign of Object.values(lb.campaigns || {})) swap(campaign?.books);
}

/** A lorebook was deleted: drop every reference. */
export function forgetBook(name) {
    const lb = extensionSettings.lorebook;
    if (!lb || !name) return;
    const drop = (list) => {
        if (!Array.isArray(list)) return;
        const idx = list.indexOf(name);
        if (idx !== -1) list.splice(idx, 1);
    };
    drop(lb.globalBooks);
    drop(lb.campaignActivated);
    drop(lb.autoLinked);
    for (const campaign of Object.values(lb.campaigns || {})) drop(campaign?.books);
}

// ─── Load-time shape guard ──────────────────────────────────────────────────

/**
 * Additive migration: gives every new key its default shape and repairs a
 * dangling activeCampaignId (campaign deleted while active on another
 * device, or a crash mid-switch) by restoring the shadow. Safe to call
 * repeatedly. Returns true when anything changed.
 */
export function ensureCampaignSettings() {
    let changed = false;
    if (!extensionSettings.campaignProfiles || typeof extensionSettings.campaignProfiles !== 'object' || Array.isArray(extensionSettings.campaignProfiles)) {
        extensionSettings.campaignProfiles = {};
        changed = true;
    }
    if (!extensionSettings.campaignBaseShadow || typeof extensionSettings.campaignBaseShadow !== 'object' || Array.isArray(extensionSettings.campaignBaseShadow)) {
        extensionSettings.campaignBaseShadow = {};
        changed = true;
    }
    const lb = extensionSettings.lorebook;
    if (lb && typeof lb === 'object') {
        if (lb.activeCampaignId === undefined) { lb.activeCampaignId = null; changed = true; }
        if (!Array.isArray(lb.globalBooks)) { lb.globalBooks = []; changed = true; }
        if (!Array.isArray(lb.campaignActivated)) { lb.campaignActivated = []; changed = true; }
        if (lb.autoLinkByName === undefined) { lb.autoLinkByName = true; changed = true; }
        if (!Array.isArray(lb.autoLinked)) { lb.autoLinked = []; changed = true; }
        // A pre-campaign bug in the mobile bulk "Move to" filed `undefined`
        // in campaign folders. Book lists hold WI filenames only.
        const isBookName = (v) => typeof v === 'string' && v.length > 0;
        const scrubList = (list) => {
            if (!Array.isArray(list)) return list;
            const clean = list.filter(isBookName);
            if (clean.length !== list.length) { list.length = 0; list.push(...clean); changed = true; }
            return list;
        };
        scrubList(lb.globalBooks);
        scrubList(lb.campaignActivated);
        scrubList(lb.autoLinked);
        if (lb.campaigns && typeof lb.campaigns === 'object') {
            for (const campaign of Object.values(lb.campaigns)) {
                if (!campaign || typeof campaign !== 'object') continue;
                if (!Array.isArray(campaign.books)) { campaign.books = []; changed = true; continue; }
                scrubList(campaign.books);
            }
        }
        const active = getActiveCampaignId();
        if (active && !(lb.campaigns && lb.campaigns[active])) {
            switchCampaignProfiles(active, null);
            lb.activeCampaignId = null;
            // The ledger is left as is: the next reconcile turns those books off.
            changed = true;
        }
        // Buckets for campaigns that no longer exist (deleted on another
        // device, or a crash between deleteCampaign's steps) would still show
        // up as versions in the Workshop. Drop them; any portrait files only
        // they referenced are reclaimed by the next ref-counted deletion.
        if (lb.campaigns && typeof lb.campaigns === 'object') {
            const root = profilesRoot();
            for (const id of Object.keys(root)) {
                if (!lb.campaigns[id]) {
                    delete root[id];
                    changed = true;
                }
            }
        }
    }
    return changed;
}
