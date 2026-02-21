/**
 * Avatar Utilities Module
 * Handles safe avatar/thumbnail URL generation with error handling
 */
import { getThumbnailUrl } from '../../../../../../script.js';
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
