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
 *     settingsVersion stays at 1, retried on next boot.
 *   - settingsVersion only bumps to 2 after every entry is URL-shaped, so
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
            map[name] = url;
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

// Returns a count of remaining data:-URL entries across all four maps.
// settingsVersion may only bump to 2 when this is zero.
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
            if ((extensionSettings.settingsVersion ?? 1) < 2) {
                extensionSettings.settingsVersion = 2;
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

        const remaining = countRemainingDataUrls();
        if (remaining === 0) {
            extensionSettings.settingsVersion = 2;
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
