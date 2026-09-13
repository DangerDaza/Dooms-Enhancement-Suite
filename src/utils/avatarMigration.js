/**
 * Avatar Migration Module (Pass 2 of the perf refactor)
 *
 * Walks extensionSettings.npcAvatars / npcAvatarsFullRes and
 * userCharacters[*].avatar / .avatarFullRes. For every data:-URL entry,
 * uploads the bytes to data/default-user/user/images/des-portraits/ via
 * POST /api/images/upload and replaces the data URL with the resulting
 * /user/images/... URL (cache-bust baked into ?t=).
 *
 * Zero-disruption guarantees:
 *   - On per-character failure: legacy data URL is left in place. Portrait
 *     still renders.
 *   - On server-unreachable or first-upload failure: whole batch aborts,
 *     settingsVersion stays at 23, retried on next boot.
 *   - settingsVersion only bumps to 24 after every entry is URL-shaped, so
 *     a partially-completed run will resume on next boot.
 *   - URL strings work as <img>.src in v1.10.7 too — downgrade safe.
 *   - __avatarBackupV1 snapshot kept inside settings as belt-and-suspenders
 *     against corruption (retired in v1.12).
 */
import { extensionSettings } from '../core/state.js';
import { isDataUrl, persistPortrait } from './avatars.js';

let migrationInFlight = false;

const THROTTLE_MS = 250;
const sleep = ms => new Promise(r => setTimeout(r, ms));

function takeBackupOnce() {
    if (extensionSettings.__avatarBackupV1) return;
    extensionSettings.__avatarBackupV1 = {
        npcAvatars: { ...(extensionSettings.npcAvatars || {}) },
        npcAvatarsFullRes: { ...(extensionSettings.npcAvatarsFullRes || {}) },
        userCharacters: JSON.parse(JSON.stringify(extensionSettings.userCharacters || {})),
        ts: Date.now(),
    };
}

function approxBase64Bytes(map) {
    let n = 0;
    for (const v of Object.values(map || {})) {
        if (isDataUrl(v)) n += v.length;
    }
    return n;
}

// Walks one map of {name: dataUrl-or-URL}. For each data URL, uploads via
// persistPortrait and writes the URL back. Mutates the map in place.
// Returns { migrated, failed, byName: Map<name, url> } where byName lets the
// caller reuse the same URL for parallel sibling maps (cropped vs fullres).
async function migrateMap(label, map, byNameSeed = null) {
    const result = { migrated: 0, failed: 0, byName: new Map(byNameSeed || []) };
    if (!map || typeof map !== 'object') return result;

    const names = Object.keys(map);
    for (const name of names) {
        const value = map[name];
        if (!isDataUrl(value)) continue; // already migrated, ST URL, or empty

        // Reuse a sibling map's already-uploaded URL when the bytes match.
        // This is the workshop-created case where avatar === avatarFullRes.
        const sibling = result.byName.get(name);
        if (sibling && sibling.dataUrl === value) {
            map[name] = sibling.url;
            result.migrated++;
            continue;
        }
        try {
            const url = await persistPortrait(value, name, value);
            // Compare-and-swap: a campaign switch during the upload can have
            // moved this data URL out of the live map (banked into a campaign
            // version) and put another version's URL here. Never overwrite a
            // value that changed under us — write the URL wherever the data
            // URL went instead.
            if (map[name] === value) {
                map[name] = url;
            } else {
                relocateMigratedValue(value, url);
            }
            result.byName.set(name, { dataUrl: value, url });
            result.migrated++;
            await sleep(THROTTLE_MS);
        } catch (err) {
            console.warn(`[Dooms Tracker] avatar migration: ${label} "${name}" failed:`, err);
            result.failed++;
            // First upload failure aborts the batch — bubble up so the caller
            // can stop without partial progress poisoning future runs.
            if (result.migrated === 0 && result.failed === 1) throw err;
        }
    }
    return result;
}

async function migrateUserCharacters(userCharacters, sharedByName) {
    const result = { migrated: 0, failed: 0, byName: new Map(sharedByName || []) };
    if (!userCharacters || typeof userCharacters !== 'object') return result;

    for (const name of Object.keys(userCharacters)) {
        const entry = userCharacters[name];
        if (!entry || typeof entry !== 'object') continue;

        // Track per-character: cropped first, then fullres can reuse.
        let crop = entry.avatar;
        let full = entry.avatarFullRes;

        let cropUrl = null;
        if (isDataUrl(crop)) {
            try {
                cropUrl = await persistPortrait(crop, name, crop);
                entry.avatar = cropUrl;
                result.migrated++;
                await sleep(THROTTLE_MS);
            } catch (err) {
                console.warn(`[Dooms Tracker] avatar migration: userCharacters["${name}"].avatar failed:`, err);
                result.failed++;
                if (result.migrated === 0 && result.failed === 1) throw err;
            }
        }
        if (isDataUrl(full)) {
            // If fullres is byte-identical to cropped (workshop case), reuse URL.
            if (cropUrl && full === crop) {
                entry.avatarFullRes = cropUrl;
                result.migrated++;
                continue;
            }
            try {
                const fullUrl = await persistPortrait(full, `${name}-full`, full);
                entry.avatarFullRes = fullUrl;
                result.migrated++;
                await sleep(THROTTLE_MS);
            } catch (err) {
                console.warn(`[Dooms Tracker] avatar migration: userCharacters["${name}"].avatarFullRes failed:`, err);
                result.failed++;
                if (result.migrated === 0 && result.failed === 1) throw err;
            }
        }
    }
    return result;
}

// Every campaign-version bucket that can hold a portrait: the shadowed base
// entries plus each campaign's saved versions. Shape: { [name]: Profile|null }.
function profileBuckets() {
    const out = [];
    const shadow = extensionSettings.campaignBaseShadow;
    if (shadow && typeof shadow === 'object') out.push(shadow);
    const profiles = extensionSettings.campaignProfiles;
    if (profiles && typeof profiles === 'object') {
        for (const b of Object.values(profiles)) if (b && typeof b === 'object') out.push(b);
    }
    return out;
}

// After an await, a value we uploaded may have moved (campaign switch banked
// it into a bucket / restored another version into the live map). Find every
// place that still holds the data URL and put the uploaded URL there.
function relocateMigratedValue(dataUrl, url) {
    const swapIn = (obj, key) => { if (obj && obj[key] === dataUrl) obj[key] = url; };
    for (const store of ['npcAvatars', 'npcAvatarsFullRes']) {
        const map = extensionSettings[store];
        if (map && typeof map === 'object') for (const name of Object.keys(map)) swapIn(map, name);
    }
    for (const bucket of profileBuckets()) {
        for (const profile of Object.values(bucket)) {
            if (!profile || typeof profile !== 'object') continue;
            swapIn(profile, 'avatar');
            swapIn(profile, 'avatarFullRes');
        }
    }
}

// Walks the campaign-version buckets. A portrait uploaded while viewing an
// inactive campaign's version (or the shadowed Base) never passes through the
// flat maps, so it has to be moved to disk from here. The ACTIVE campaign's
// bucket is skipped: it mirrors the live maps (banked on every save), so the
// live walk above already covered it and uploading again would duplicate the
// file. Byte-identical data URLs upload once (uploadedByBytes).
async function migrateProfileBuckets(uploadedByBytes) {
    const result = { migrated: 0, failed: 0 };
    const active = extensionSettings.lorebook?.activeCampaignId || null;
    const buckets = [];
    const shadow = extensionSettings.campaignBaseShadow;
    if (shadow && typeof shadow === 'object') buckets.push(shadow);
    const profiles = extensionSettings.campaignProfiles;
    if (profiles && typeof profiles === 'object') {
        for (const id of Object.keys(profiles)) {
            if (id !== active && profiles[id] && typeof profiles[id] === 'object') buckets.push(profiles[id]);
        }
    }
    const upload = async (bucket, name, field, label) => {
        const value = bucket[name]?.[field];
        if (!isDataUrl(value)) return;
        let url = uploadedByBytes.get(value);
        if (!url) {
            try {
                url = await persistPortrait(value, label, value);
                uploadedByBytes.set(value, url);
                result.migrated++;
                await sleep(THROTTLE_MS);
            } catch (err) {
                console.warn(`[Dooms Tracker] avatar migration: campaign version "${name}".${field} failed:`, err);
                result.failed++;
                if (result.migrated === 0 && result.failed === 1) throw err;
                return;
            }
        }
        // Re-read after the await — bankActiveCampaign / a switch may have
        // replaced the profile object meanwhile.
        const current = bucket[name];
        if (current && typeof current === 'object' && current[field] === value) current[field] = url;
        else relocateMigratedValue(value, url);
    };
    for (const bucket of buckets) {
        for (const name of Object.keys(bucket)) {
            if (!bucket[name] || typeof bucket[name] !== 'object') continue;
            await upload(bucket, name, 'avatar', name);
            await upload(bucket, name, 'avatarFullRes', `${name}-full`);
        }
    }
    return result;
}

/**
 * True when any portrait anywhere (flat maps, user characters, campaign
 * versions) is still a data: URL. persistence.js uses it to schedule the
 * migration on installs already past v24 — a portrait saved into a campaign
 * version whose upload failed would otherwise sit as base64 until the next
 * Workshop save.
 */
export function hasPendingPortraitDataUrls() {
    try { return countRemainingDataUrls() > 0; } catch (e) { return false; }
}

// Returns a count of remaining data:-URL entries across all four maps plus
// the campaign-version buckets. settingsVersion may only bump to 24 when
// this is zero.
function countRemainingDataUrls() {
    let n = 0;
    const npc = extensionSettings.npcAvatars || {};
    const npcFull = extensionSettings.npcAvatarsFullRes || {};
    for (const v of Object.values(npc)) if (isDataUrl(v)) n++;
    for (const v of Object.values(npcFull)) if (isDataUrl(v)) n++;
    const users = extensionSettings.userCharacters || {};
    for (const u of Object.values(users)) {
        if (isDataUrl(u?.avatar)) n++;
        if (isDataUrl(u?.avatarFullRes)) n++;
    }
    for (const bucket of profileBuckets()) {
        for (const p of Object.values(bucket)) {
            if (isDataUrl(p?.avatar)) n++;
            if (isDataUrl(p?.avatarFullRes)) n++;
        }
    }
    return n;
}

/**
 * Run the avatar migration. Idempotent: re-running after a partial completion
 * picks up only the entries still shaped as data URLs. Caller must call
 * saveSettings() after to persist.
 *
 * @param {() => void} saveSettings - persistence flusher
 * @returns {Promise<{ migrated: number, failed: number, aborted: boolean, sizeFreed: number }>}
 */
export async function migrateAvatarsToFiles(saveSettings) {
    if (migrationInFlight) {
        return { migrated: 0, failed: 0, aborted: true, sizeFreed: 0 };
    }
    migrationInFlight = true;
    const out = { migrated: 0, failed: 0, aborted: false, sizeFreed: 0 };

    try {
        const before = approxBase64Bytes(extensionSettings.npcAvatars)
            + approxBase64Bytes(extensionSettings.npcAvatarsFullRes)
            + Object.values(extensionSettings.userCharacters || {})
                .reduce((acc, u) => acc + (isDataUrl(u?.avatar) ? u.avatar.length : 0)
                                       + (isDataUrl(u?.avatarFullRes) ? u.avatarFullRes.length : 0), 0);

        if (before === 0 && countRemainingDataUrls() === 0) {
            // Nothing to do — already migrated. Bump version idempotently.
            if ((extensionSettings.settingsVersion ?? 1) < 24) {
                extensionSettings.settingsVersion = 24;
                if (typeof saveSettings === 'function') saveSettings();
            }
            return out;
        }

        // Snapshot before any mutation. Lives inside settings (so it's
        // automatically persisted by saveSettingsDebounced) and gives a
        // corruption-recovery path. Retired in v1.12.
        takeBackupOnce();

        // NPC cropped + fullres share a `byName` cache so identical bytes
        // upload once and reuse the URL.
        const npcCrop = await migrateMap('npcAvatars', extensionSettings.npcAvatars);
        out.migrated += npcCrop.migrated;
        out.failed += npcCrop.failed;

        const npcFull = await migrateMap('npcAvatarsFullRes', extensionSettings.npcAvatarsFullRes, npcCrop.byName);
        out.migrated += npcFull.migrated;
        out.failed += npcFull.failed;

        const users = await migrateUserCharacters(extensionSettings.userCharacters);
        out.migrated += users.migrated;
        out.failed += users.failed;

        // Bytes already uploaded by the live walk (Workshop saves clone the
        // same data URL into a campaign version) must not upload twice.
        const uploadedByBytes = new Map();
        for (const { dataUrl, url } of npcCrop.byName.values()) uploadedByBytes.set(dataUrl, url);
        for (const { dataUrl, url } of npcFull.byName.values()) uploadedByBytes.set(dataUrl, url);
        const buckets = await migrateProfileBuckets(uploadedByBytes);
        out.migrated += buckets.migrated;
        out.failed += buckets.failed;

        const remaining = countRemainingDataUrls();
        if (remaining === 0) {
            extensionSettings.settingsVersion = 24;
        }
        if (typeof saveSettings === 'function') saveSettings();

        const after = approxBase64Bytes(extensionSettings.npcAvatars)
            + approxBase64Bytes(extensionSettings.npcAvatarsFullRes);
        out.sizeFreed = Math.max(0, before - after);

        if (out.migrated > 0) {
            const kb = Math.round(out.sizeFreed / 1024);
            console.log(`[Dooms Tracker] avatar migration: moved ${out.migrated} portrait(s) to disk; settings is ~${kb} KB smaller`);
            try {
                if (window.toastr && remaining === 0) {
                    window.toastr.success(
                        `Moved ${out.migrated} portrait(s) to disk. Settings file is ${kb} KB smaller.`,
                        'DES portrait migration',
                        { timeOut: 4000 },
                    );
                }
            } catch (e) {}
        }
    } catch (err) {
        // First-upload failure (server unreachable etc). Don't bump version;
        // legacy data URLs remain in place and still render.
        out.aborted = true;
        console.warn('[Dooms Tracker] avatar migration aborted:', err);
        try {
            if (window.toastr) {
                window.toastr.info(
                    'Avatar migration deferred — will retry on next reload.',
                    'DES portrait migration',
                    { timeOut: 4000 },
                );
            }
        } catch (e) {}
    } finally {
        migrationInFlight = false;
    }

    return out;
}

/**
 * Reclaims the in-memory/in-settings corruption-recovery snapshot once the
 * avatar migration has fully completed in a *previous* session.
 *
 * The snapshot (__avatarBackupV1) is a full duplicate of every avatar's base64
 * payload, so for users upgrading from a legacy (pre-v24) save it can hold tens
 * of MB resident in extensionSettings indefinitely. It exists only as a safety
 * net while the migration is in flight; once settingsVersion has reached 24 and
 * no data: URLs remain (i.e. the migration succeeded and persisted), the backup
 * is dead weight. We retire it on the next load after a successful migration,
 * which still leaves one full session of safety after the bytes hit disk.
 *
 * Safe no-op when there's no backup, the migration is incomplete, or any data
 * URL is still present (in which case the backup is still needed).
 *
 * @param {() => void} saveSettings - persistence flusher
 * @returns {boolean} true if a backup was retired
 */
export function retireAvatarBackupIfComplete(saveSettings) {
    if (!extensionSettings.__avatarBackupV1) return false;
    if ((extensionSettings.settingsVersion ?? 1) < 24) return false;
    if (countRemainingDataUrls() !== 0) return false;

    delete extensionSettings.__avatarBackupV1;
    if (typeof saveSettings === 'function') saveSettings();
    console.log('[Dooms Tracker] avatar migration: retired __avatarBackupV1 snapshot; settings is smaller');
    return true;
}

// Schedules migrateAvatarsToFiles() to run during browser idle time so
// first-paint after upgrade isn't blocked on portrait uploads.
export function scheduleAvatarMigration(saveSettings) {
    const run = () => { migrateAvatarsToFiles(saveSettings); };
    if (typeof window.requestIdleCallback === 'function') {
        window.requestIdleCallback(run, { timeout: 5000 });
    } else {
        setTimeout(run, 1500);
    }
}
