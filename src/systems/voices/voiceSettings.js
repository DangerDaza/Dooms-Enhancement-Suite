/*
 * Doom's Enhancement Suite for SillyTavern — Voices: settings defaults
 * Copyright (C) 2026 Jordan (DangerDaza)
 *
 * This file is part of Doom's Enhancement Suite and is licensed under the
 * GNU Affero General Public License v3.0 or later. If you redistribute this
 * file or a modified version of it, you must keep this notice intact, state
 * your changes, and release your version under the same license.
 *
 * See the LICENSE file in the project root for the full terms and for
 * additional copyright notices.
 *
 * https://github.com/DangerDaza/Dooms-Enhancement-Suite
 */

/**
 * Defaults and load-time repair for extensionSettings.voices and
 * extensionSettings.characterVoices (docs/google-tts-voices-plan.md §4).
 *
 * Pure: no imports, so persistence.js can call it at load and the Node
 * tests can exercise it directly.
 */

/** Google TTS models DES offers. The first is the default. */
export const VOICE_MODELS = Object.freeze([
    { id: 'gemini-3.8-flash-lite-tts', label: 'Gemini 3.8 Flash-Lite (cheaper)' },
    { id: 'gemini-3.8-flash-tts', label: 'Gemini 3.8 Flash (richer)' },
]);

/** The model SillyTavern's own Google provider defaults to; used when its route can't send 3.8. */
export const ST_FALLBACK_MODEL = 'gemini-3.1-flash-tts-preview';

/** Stock voice used when the Narrator voice is missing or unplayable. */
export const NARRATOR_FALLBACK_VOICE = 'Charon';

export function defaultVoiceSettings() {
    return {
        enabled: false,
        autoRead: false,
        model: VOICE_MODELS[0].id,
        narratorVoice: { source: 'stock', id: NARRATOR_FALLBACK_VOICE },
        // Google AI Studio key for voices. '' = use the key saved in
        // SillyTavern (through its server). Stored with DES settings, so it
        // syncs to every device (and sits in SillyTavern's settings file).
        googleApiKey: '',
        readUserMessages: false,
        playbackRate: 1,
        maxSegmentsPerMessage: 24,
        sessionRequestBudget: 300,
        // Designed (and later cloned) voices made through DES, keyed by
        // Google's voice id. Plan §4.2: {id, source, label, designPrompt,
        // gender, languageCode, createdAt, expireTime, keyTag, status}.
        customVoices: {},
    };
}

/** A registry entry is usable when it is an object with a Google voice id. */
function isValidCustomVoice(entry, id) {
    return isPlainObject(entry) && typeof id === 'string' && id.length > 0 &&
        (entry.id === undefined || entry.id === id);
}

function isPlainObject(v) {
    return !!v && typeof v === 'object' && !Array.isArray(v);
}

/** A stored VoiceRef is usable when it is an object with a string id. */
export function isValidVoiceRef(ref) {
    if (!isPlainObject(ref) || (ref.source !== undefined && typeof ref.source !== 'string')) return false;
    if (typeof ref.id === 'string' && ref.id.length > 0) return true;
    // An imported designed voice waiting to be re-created: no id yet.
    return ref.id === null && typeof ref.pendingDesign === 'string' && ref.pendingDesign.length > 0;
}

/**
 * Fills missing voices.* keys and repairs broken shapes. Guards test the
 * SAVED blob (the shallow merge in persistence.js would otherwise hide a
 * missing sub-key behind the state.js default object).
 *
 * @param {object|null} saved - the user's persisted settings blob
 * @param {object} live - extensionSettings after the load merge
 * @returns {boolean} true when anything was written
 */
export function ensureVoiceSettings(saved, live) {
    let changed = false;
    const defaults = defaultVoiceSettings();
    const savedVoices = saved && isPlainObject(saved.voices) ? saved.voices : null;
    if (!savedVoices) {
        live.voices = defaults;
        changed = true;
    } else {
        // live.voices is the saved object after the shallow merge.
        if (!isPlainObject(live.voices)) live.voices = savedVoices;
        for (const [key, value] of Object.entries(defaults)) {
            if (live.voices[key] === undefined) {
                live.voices[key] = value;
                changed = true;
            }
        }
        if (!isValidVoiceRef(live.voices.narratorVoice)) {
            live.voices.narratorVoice = defaults.narratorVoice;
            changed = true;
        }
        if (typeof live.voices.googleApiKey !== 'string') {
            live.voices.googleApiKey = '';
            changed = true;
        }
        // Replaced by googleApiKey (trial builds only).
        if ('connectionProfile' in live.voices) {
            delete live.voices.connectionProfile;
            changed = true;
        }
        if (!isPlainObject(live.voices.customVoices)) {
            live.voices.customVoices = {};
            changed = true;
        } else {
            for (const [id, entry] of Object.entries(live.voices.customVoices)) {
                if (!isValidCustomVoice(entry, id)) {
                    delete live.voices.customVoices[id];
                    changed = true;
                }
            }
        }
        if (!VOICE_MODELS.some(m => m.id === live.voices.model)) {
            live.voices.model = defaults.model;
            changed = true;
        }
    }
    if (!isPlainObject(live.characterVoices)) {
        live.characterVoices = {};
        changed = true;
    } else {
        for (const [name, ref] of Object.entries(live.characterVoices)) {
            if (!isValidVoiceRef(ref)) {
                delete live.characterVoices[name];
                changed = true;
            }
        }
    }
    return changed;
}
