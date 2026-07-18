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

// ────────────────────────────────────────────────────────────────────────────
// Portrait history — replaced portraits are KEPT, not deleted.
//
// When a portrait is regenerated, the old image file stays where it already
// lives (the des-portraits folder for DES-managed files) and its URLs move
// into extensionSettings.npcAvatarHistory[name] so it isn't an orphan.
// "Restore Previous Portrait" swaps the newest history entry back in. Only
// two things ever delete history files from disk: trimming past the per-
// character cap, and full character deletion (purgePortraitHistory).
// ────────────────────────────────────────────────────────────────────────────

const PORTRAIT_HISTORY_LIMIT = 5;

/** How many replaced portraits are kept for this character. */
export function getPortraitHistoryCount(name) {
    const list = extensionSettings.npcAvatarHistory?.[name];
    return Array.isArray(list) ? list.length : 0;
}

/**
 * Moves the character's CURRENT portrait entries (low-res + full-res) into
 * their history instead of deleting them. Trims history beyond the cap,
 * deleting only the evicted files from disk. Caller persists via saveSettings.
 * @returns {boolean} true if there was a current portrait to stash
 */
export function stashCurrentPortraitToHistory(name) {
    const avatar = extensionSettings.npcAvatars?.[name] || '';
    const avatarFullRes = extensionSettings.npcAvatarsFullRes?.[name] || '';
    if (!avatar && !avatarFullRes) return false;
    if (!extensionSettings.npcAvatarHistory) extensionSettings.npcAvatarHistory = {};
    const store = extensionSettings.npcAvatarHistory;
    if (!Array.isArray(store[name])) store[name] = [];
    store[name].push({ avatar, avatarFullRes, replacedAt: new Date().toISOString() });
    while (store[name].length > PORTRAIT_HISTORY_LIMIT) {
        const evicted = store[name].shift();
        try { deletePortraitFromDiskByValue(evicted.avatar); } catch (e) {}
        try { deletePortraitFromDiskByValue(evicted.avatarFullRes); } catch (e) {}
    }
    if (extensionSettings.npcAvatars) delete extensionSettings.npcAvatars[name];
    if (extensionSettings.npcAvatarsFullRes) delete extensionSettings.npcAvatarsFullRes[name];
    return true;
}

/**
 * Swaps the newest history entry back in as the current portrait; the
 * currently live portrait (if any) takes its place in history, so repeated
 * restores toggle between the last two and nothing is ever lost.
 * Caller persists via saveSettings.
 * @returns {boolean} true if a previous portrait existed and was restored
 */
export function restorePreviousPortrait(name) {
    const list = extensionSettings.npcAvatarHistory?.[name];
    if (!Array.isArray(list) || !list.length) return false;
    const prev = list.pop();
    const currentAvatar = extensionSettings.npcAvatars?.[name] || '';
    const currentFull = extensionSettings.npcAvatarsFullRes?.[name] || '';
    if (currentAvatar || currentFull) {
        list.push({ avatar: currentAvatar, avatarFullRes: currentFull, replacedAt: new Date().toISOString() });
    }
    if (!extensionSettings.npcAvatars) extensionSettings.npcAvatars = {};
    if (!extensionSettings.npcAvatarsFullRes) extensionSettings.npcAvatarsFullRes = {};
    if (prev.avatar) extensionSettings.npcAvatars[name] = prev.avatar;
    else delete extensionSettings.npcAvatars[name];
    if (prev.avatarFullRes) extensionSettings.npcAvatarsFullRes[name] = prev.avatarFullRes;
    else delete extensionSettings.npcAvatarsFullRes[name];
    if (!list.length) delete extensionSettings.npcAvatarHistory[name];
    return true;
}

/**
 * Deletes every kept portrait file for a character and drops their history
 * entry. Only for FULL character deletion — regeneration never calls this.
 */
export function purgePortraitHistory(name) {
    const list = extensionSettings.npcAvatarHistory?.[name];
    if (Array.isArray(list)) {
        for (const entry of list) {
            try { deletePortraitFromDiskByValue(entry.avatar); } catch (e) {}
            try { deletePortraitFromDiskByValue(entry.avatarFullRes); } catch (e) {}
        }
    }
    if (extensionSettings.npcAvatarHistory) delete extensionSettings.npcAvatarHistory[name];
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
