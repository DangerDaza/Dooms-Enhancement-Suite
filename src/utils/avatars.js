/**
 * Avatar Utilities Module
 * Handles safe avatar/thumbnail URL generation with error handling.
 * Also hosts the on-disk portrait persistence layer (Pass 2 of the perf
 * refactor): uploadPortraitToDisk / persistPortrait / extractDesPortraitFilename.
 * See plans/doom-s-enhancement-suite-vivid-torvalds.md for the full design.
 */
import { getRequestHeaders, getThumbnailUrl } from '../../../../../../script.js';
import { extensionSettings } from '../core/state.js';
import { getExpressionPortraitForCharacter } from '../systems/integration/expressionSync.js';
import { unreferencedPortraits } from '../systems/lorebook/campaignProfiles.js';

// Subdirectory under data/default-user/user/images/ where DES drops cropped
// portraits. ST creates this on first POST via ensureDirectoryExistence in
// src/endpoints/images.js — users never need to know it exists.
export const DES_PORTRAITS_CH_NAME = 'des-portraits';
const DES_PORTRAITS_URL_PREFIX = `/user/images/${DES_PORTRAITS_CH_NAME}/`;
const DES_PORTRAIT_FILENAME_RE = /^[a-z0-9_-]+-[0-9a-f]{8}\.png$/i;
/**
 * Safely retrieves a thumbnail URL from SillyTavern's API with error handling.
 * Returns null instead of throwing errors to prevent extension crashes.
 *
 * @param {string} type - Type of thumbnail ('avatar' or 'persona')
 * @param {string} filename - Filename of the avatar/persona
 * @returns {string|null} Thumbnail URL or null if unavailable/error
 */
export function getSafeThumbnailUrl(type, filename) {
    // Return null if no filename provided
    if (!filename || filename === 'none') {
        return null;
    }
    try {
        // Attempt to get thumbnail URL from SillyTavern API
        const url = getThumbnailUrl(type, filename);
        // Validate that we got a string back
        if (typeof url !== 'string' || url.trim() === '') {
            console.warn(`[Dooms Tracker] getThumbnailUrl returned invalid result for ${type}:`, filename);
            return null;
        }
        return url;
    } catch (error) {
        // Log detailed error information for debugging
        console.error(`[Dooms Tracker] Failed to get ${type} thumbnail for "${filename}":`, error);
        console.error('[Dooms Tracker] Error details:', {
            type,
            filename,
            errorMessage: error.message,
            errorStack: error.stack
        });
        return null;
    }
}


/**
 * Returns a synced Character Expressions portrait for a character when enabled.
 * Falls back to the provided portrait URL when no synced expression is available.
 */
export function getExpressionAwarePortrait(characterName, fallbackUrl = null) {
    if (extensionSettings.syncExpressionsToPresentCharacters) {
        const expressionUrl = getExpressionPortraitForCharacter(characterName);
        if (expressionUrl) return expressionUrl;
    }
    return fallbackUrl;
}

// ────────────────────────────────────────────────────────────────────────────
// Pass 2: on-disk portrait persistence
// ────────────────────────────────────────────────────────────────────────────

export function isDataUrl(value) {
    return typeof value === 'string' && value.startsWith('data:');
}

// Distinguishes a DES-managed on-disk portrait URL from a raw data URL,
// a /characters/<file> URL (ST card import), or anything else. Returns the
// bare filename (with extension, no query string) when matched, else null.
export function extractDesPortraitFilename(value) {
    if (typeof value !== 'string') return null;
    const idx = value.indexOf(DES_PORTRAITS_URL_PREFIX);
    if (idx === -1) return null;
    const tail = value.slice(idx + DES_PORTRAITS_URL_PREFIX.length);
    const file = tail.split('?')[0].split('#')[0];
    if (!file) return null;
    try { return decodeURIComponent(file); } catch (e) { return file; }
}

function sanitizePortraitName(name) {
    return String(name || 'untitled')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 48) || 'untitled';
}

function rand8Hex() {
    const bytes = new Uint8Array(4);
    (globalThis.crypto || window.crypto).getRandomValues(bytes);
    return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

function buildPortraitUrl(filename, mtime) {
    return `${DES_PORTRAITS_URL_PREFIX}${encodeURIComponent(filename)}?t=${mtime}`;
}

// POST /api/images/upload with the cropped portrait as base64. Strips the
// "data:image/png;base64," prefix client-side because the endpoint does
// Buffer.from(image, 'base64'). Returns the new URL with cache-bust baked in.
export async function uploadPortraitToDisk(filename, dataUrl) {
    if (!filename || !isDataUrl(dataUrl)) {
        throw new Error('uploadPortraitToDisk: filename and data URL required');
    }
    const commaIdx = dataUrl.indexOf(',');
    if (commaIdx === -1) throw new Error('uploadPortraitToDisk: malformed data URL');
    const base64 = dataUrl.slice(commaIdx + 1);
    const resp = await fetch('/api/images/upload', {
        method: 'POST',
        headers: getRequestHeaders(),
        body: JSON.stringify({
            image: base64,
            format: 'png',
            ch_name: DES_PORTRAITS_CH_NAME,
            filename,
        }),
    });
    if (!resp.ok) {
        const text = await resp.text().catch(() => '');
        throw new Error(text || `HTTP ${resp.status}`);
    }
    return { url: buildPortraitUrl(filename, Date.now()) };
}

// Best-effort: ask the server to delete the on-disk PNG for a portrait whose
// settings entry is being cleared. Never throws; a failure just leaves an
// orphan file (silent leak; settings remains correct).
export async function deletePortraitFromDiskByValue(value) {
    const filename = extractDesPortraitFilename(value);
    if (!filename) return false;
    try {
        const resp = await fetch('/api/images/delete', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({ path: `user/images/${DES_PORTRAITS_CH_NAME}/${filename}` }),
        });
        return resp.ok || resp.status === 404;
    } catch (e) {
        console.warn(`[Dooms Tracker] avatars: delete-on-disk failed for "${filename}":`, e);
        return false;
    }
}

/**
 * Reference-counted disk cleanup. Deletes only the portrait files that no
 * store, user character, shadowed base entry or campaign version still
 * points at — a campaign version cloned from Base shares Base's file, so a
 * bare delete of "the value we just cleared" would take the other version's
 * picture with it. Call AFTER the settings entries have been removed.
 * @param {string[]} values - candidate portrait values (URLs / data URLs)
 * @returns {Promise<number>} files deleted
 */
export async function deletePortraitsIfUnreferenced(values) {
    let survivors = [];
    try { survivors = unreferencedPortraits(values); } catch (e) { survivors = []; }
    let n = 0;
    for (const value of survivors) {
        try { if (await deletePortraitFromDiskByValue(value)) n++; } catch (e) {}
    }
    return n;
}

// ────────────────────────────────────────────────────────────────────────────
// Portrait history — replaced portraits are KEPT, not deleted.
//
// When a portrait is regenerated, the old image file stays where it already
// lives (the des-portraits folder for DES-managed files) and its URLs move
// into extensionSettings.npcAvatarHistory[name] so it isn't an orphan (the
// player's card keeps them on its own entry, userCharacters[name].portraitHistory).
// "Restore Previous Portrait" swaps the newest history entry back in. Only
// two things ever delete history files from disk: trimming past the per-
// character cap, and full character deletion (purgePortraitHistory).
// ────────────────────────────────────────────────────────────────────────────

const PORTRAIT_HISTORY_LIMIT = 5;

/** How many replaced portraits are kept for this character. */
/**
 * Where a name's portrait and its history live. NPCs: the flat stores
 * (npcAvatars / npcAvatarsFullRes / npcAvatarHistory[name]). The player's
 * card (isUser): its own userCharacters entry (avatar / avatarFullRes /
 * portraitHistory), so an NPC of the same name never shares them (D91).
 * Nothing is created for an empty write.
 */
function portraitSlot(name, isUser) {
    const str = (v) => (typeof v === 'string' ? v : '');
    if (isUser) {
        const entry = (create) => {
            if (!extensionSettings.userCharacters) { if (!create) return null; extensionSettings.userCharacters = {}; }
            const map = extensionSettings.userCharacters;
            if (!map[name] || typeof map[name] !== 'object') { if (!create) return null; map[name] = {}; }
            return map[name];
        };
        return {
            history: () => entry(false)?.portraitHistory,
            setHistory: (list) => {
                const keep = Array.isArray(list) && list.length > 0;
                const u = entry(keep);
                if (!u) return;
                if (keep) u.portraitHistory = list; else delete u.portraitHistory;
            },
            current: () => { const u = entry(false); return { avatar: str(u?.avatar), avatarFullRes: str(u?.avatarFullRes) }; },
            setCurrent: ({ avatar, avatarFullRes }) => {
                const u = entry(Boolean(avatar || avatarFullRes));
                if (!u) return;
                u.avatar = str(avatar);
                u.avatarFullRes = str(avatarFullRes);
            },
        };
    }
    return {
        history: () => extensionSettings.npcAvatarHistory?.[name],
        setHistory: (list) => {
            if (Array.isArray(list) && list.length) {
                if (!extensionSettings.npcAvatarHistory) extensionSettings.npcAvatarHistory = {};
                extensionSettings.npcAvatarHistory[name] = list;
            } else if (extensionSettings.npcAvatarHistory) delete extensionSettings.npcAvatarHistory[name];
        },
        current: () => ({ avatar: str(extensionSettings.npcAvatars?.[name]), avatarFullRes: str(extensionSettings.npcAvatarsFullRes?.[name]) }),
        setCurrent: ({ avatar, avatarFullRes }) => {
            if (avatar) { if (!extensionSettings.npcAvatars) extensionSettings.npcAvatars = {}; extensionSettings.npcAvatars[name] = avatar; }
            else if (extensionSettings.npcAvatars) delete extensionSettings.npcAvatars[name];
            if (avatarFullRes) { if (!extensionSettings.npcAvatarsFullRes) extensionSettings.npcAvatarsFullRes = {}; extensionSettings.npcAvatarsFullRes[name] = avatarFullRes; }
            else if (extensionSettings.npcAvatarsFullRes) delete extensionSettings.npcAvatarsFullRes[name];
        },
    };
}

/** @param {{ isUser?: boolean }} [opts] isUser: the player's card (its userCharacters entry), not the NPC stores */
export function getPortraitHistoryCount(name, { isUser = false } = {}) {
    const list = portraitSlot(name, isUser).history();
    return Array.isArray(list) ? list.length : 0;
}

/**
 * Moves the character's CURRENT portrait entries (low-res + full-res) into
 * their history instead of deleting them. Trims history beyond the cap,
 * deleting only the evicted files from disk. Caller persists via saveSettings.
 * @param {{ isUser?: boolean }} [opts] isUser: the player's card
 * @returns {boolean} true if there was a current portrait to stash
 */
export function stashCurrentPortraitToHistory(name, { isUser = false } = {}) {
    const slot = portraitSlot(name, isUser);
    const { avatar, avatarFullRes } = slot.current();
    if (!avatar && !avatarFullRes) return false;
    const list = Array.isArray(slot.history()) ? slot.history() : [];
    list.push({ avatar, avatarFullRes, replacedAt: new Date().toISOString() });
    const evictedValues = [];
    while (list.length > PORTRAIT_HISTORY_LIMIT) {
        const evicted = list.shift();
        evictedValues.push(evicted?.avatar, evicted?.avatarFullRes);
    }
    slot.setHistory(list);
    slot.setCurrent({ avatar: '', avatarFullRes: '' });
    // Evicted files go only if no other version of the character (or anyone
    // else) still references them.
    if (evictedValues.length) deletePortraitsIfUnreferenced(evictedValues).catch(() => {});
    return true;
}

/**
 * Swaps the newest history entry back in as the current portrait; the
 * currently live portrait (if any) takes its place in history, so repeated
 * restores toggle between the last two and nothing is ever lost.
 * Caller persists via saveSettings.
 * @param {{ isUser?: boolean }} [opts] isUser: the player's card
 * @returns {boolean} true if a previous portrait existed and was restored
 */
export function restorePreviousPortrait(name, { isUser = false } = {}) {
    const slot = portraitSlot(name, isUser);
    const list = slot.history();
    if (!Array.isArray(list) || !list.length) return false;
    const prev = list.pop();
    const { avatar: currentAvatar, avatarFullRes: currentFull } = slot.current();
    if (currentAvatar || currentFull) {
        list.push({ avatar: currentAvatar, avatarFullRes: currentFull, replacedAt: new Date().toISOString() });
    }
    slot.setCurrent({ avatar: prev?.avatar || '', avatarFullRes: prev?.avatarFullRes || '' });
    slot.setHistory(list);
    return true;
}

/**
 * Drops a character's live portrait history entry and returns the portrait
 * values it held, WITHOUT touching disk. Full-deletion paths collect these
 * together with the current portrait values, remove every settings entry,
 * then hand the whole list to deletePortraitsIfUnreferenced.
 * @param {{ isUser?: boolean }} [opts] isUser: the player's card
 * @returns {string[]}
 */
export function takePortraitHistoryValues(name, { isUser = false } = {}) {
    const slot = portraitSlot(name, isUser);
    const list = slot.history();
    const values = [];
    if (Array.isArray(list)) {
        for (const entry of list) {
            if (entry && typeof entry === 'object') values.push(entry.avatar, entry.avatarFullRes);
            else values.push(entry);
        }
    }
    slot.setHistory([]);
    return values.filter(v => typeof v === 'string' && v);
}

/**
 * Deletes every kept portrait file for a character (that nothing else still
 * references) and drops their history entry. Only for FULL character
 * deletion — regeneration never calls this.
 */
export function purgePortraitHistory(name, opts = {}) {
    const values = takePortraitHistoryValues(name, opts);
    if (values.length) deletePortraitsIfUnreferenced(values).catch(() => {});
}

// High-level wrapper used by the workshop, the portrait-bar drop handler,
// the avatar generator, and the migration. Reuses an existing on-disk
// filename when currentValue already points at one (so re-saves overwrite
// in place); otherwise generates <sanitizedName>-<rand8hex>.png.
//
// Returns the URL string the caller should write back into the legacy
// avatar field (npcAvatars[name], userCharacters[name].avatar, etc).
export async function persistPortrait(currentValue, name, dataUrl) {
    if (!isDataUrl(dataUrl)) {
        throw new Error('persistPortrait: dataUrl must be a data: URL');
    }
    let filename = extractDesPortraitFilename(currentValue);
    if (!filename || !DES_PORTRAIT_FILENAME_RE.test(filename)) {
        filename = `${sanitizePortraitName(name)}-${rand8Hex()}.png`;
    }
    const { url } = await uploadPortraitToDisk(filename, dataUrl);
    return url;
}
