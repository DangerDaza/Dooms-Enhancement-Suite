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

/**
 * Settings → Voices → Steadiness: the range of generationConfig.temperature
 * a line may carry on the direct route (lower = less variation between
 * renders), and where the slider starts when the switch goes on.
 */
export const STEADINESS = Object.freeze({ min: 0.5, max: 1, step: 0.05, default: 0.7 });

/**
 * What the "Design a narrator voice" box (Settings → Voices) starts with:
 * an old wizard telling the tale by the fire. Written for Google's voice
 * designer: who is speaking, the sound of the voice, then how they pace and
 * colour a story, then what to avoid.
 */
export const DEFAULT_NARRATOR_DESIGN = Object.freeze({
    label: 'Old Wizard',
    gender: 'male',
    languageCode: 'en-GB',
    description: 'An ancient wizard telling a long tale by firelight to listeners he is fond of. '
        + 'A very old man\u2019s voice: a deep, warm baritone worn thin and papery with age, with a soft gravelly rasp '
        + 'and a little breath at the ends of phrases. He speaks slowly, in an unhurried storyteller\u2019s rhythm, '
        + 'lingering on vivid words, pausing as if remembering, dropping almost to a whisper for secrets and omens, '
        + 'and swelling with quiet grandeur for great deeds. Wry and knowing, with a twinkle of dry humour and the '
        + 'gravity of someone who has watched kingdoms rise and fall. Clear, careful diction with a faint old-world '
        + 'English lilt. He never shouts and never rushes.',
});

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
        // Standard Gemini voices go through 'google' or 'openrouter'
        // (docs/tts-connections-plan.md §4.4). Designed/cloned voices are
        // always Google's.
        geminiVia: 'google',
        // OpenRouter key for voices ('' = none in DES), and the route:
        // 'auto' (browser, then SillyTavern's server if the browser is
        // blocked), 'browser' or 'server' (key saved in SillyTavern's
        // "Custom OpenAI TTS" slot).
        openrouterKey: '',
        openrouterRoute: 'auto',
        // The "How DES voices work" guide in Settings starts open.
        guideOpen: true,
        readUserMessages: false,
        playbackRate: 1,
        maxSegmentsPerMessage: 24,
        sessionRequestBudget: 300,
        // Designed (and later cloned) voices made through DES, keyed by
        // Google's voice id. Plan §4.2: {id, source, label, designPrompt,
        // gender, languageCode, createdAt, expireTime, keyTag, status}.
        customVoices: {},
        // Style note sent with every line on the direct route (Gemini 3.8
        // speech_metadata.style) so voices don't drift into whispering.
        // '' = send none. Mirrors DEFAULT_DELIVERY_NOTE in delivery.js.
        deliveryNote: 'clear, natural speaking voice at a normal, steady volume',
        // Settings → Voices → Never whisper: the ban rides with the note on
        // every line and the story's whisper cues are ignored.
        neverWhisper: false,
        // Settings → Voices → Steadiness: when on, every line on the direct
        // route carries generationConfig.temperature (STEADINESS.min–max,
        // lower = steadier) so a designed voice renders more alike from
        // line to line. Off = Google's own default.
        steadiness: false,
        steadinessTemperature: STEADINESS.default,
        // Settings → Voices → Anchor designed voices to their description:
        // a short reminder of the design (gender, language, opening clause)
        // rides with the style note on every line of a designed voice.
        anchorDesignedVoices: true,
        // The "Design a narrator voice" box, so edits survive a reload.
        narratorDesign: { ...DEFAULT_NARRATOR_DESIGN },
    };
}

/** A temperature inside the Steadiness range (two decimals); the default when it isn't a number. */
export function clampSteadiness(value) {
    const t = typeof value === 'number' ? value : (typeof value === 'string' && value.trim() ? Number(value) : NaN);
    if (!Number.isFinite(t)) return STEADINESS.default;
    return Math.min(STEADINESS.max, Math.max(STEADINESS.min, Math.round(t * 100) / 100));
}

/**
 * The temperature a line should carry, or null when Steadiness is off.
 * @param {{steadiness?: boolean, steadinessTemperature?: number}|null|undefined} voices - extensionSettings.voices
 */
export function steadinessTemperature(voices) {
    if (!voices || voices.steadiness !== true) return null;
    return clampSteadiness(voices.steadinessTemperature);
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
        if (live.voices.geminiVia !== 'google' && live.voices.geminiVia !== 'openrouter') {
            live.voices.geminiVia = defaults.geminiVia;
            changed = true;
        }
        if (typeof live.voices.openrouterKey !== 'string') {
            live.voices.openrouterKey = '';
            changed = true;
        }
        if (!['auto', 'browser', 'server'].includes(live.voices.openrouterRoute)) {
            live.voices.openrouterRoute = defaults.openrouterRoute;
            changed = true;
        }
        if (typeof live.voices.deliveryNote !== 'string') {
            live.voices.deliveryNote = defaults.deliveryNote;
            changed = true;
        }
        if (typeof live.voices.neverWhisper !== 'boolean') {
            live.voices.neverWhisper = defaults.neverWhisper;
            changed = true;
        }
        if (typeof live.voices.steadiness !== 'boolean') {
            live.voices.steadiness = defaults.steadiness;
            changed = true;
        }
        const steadyTemperature = clampSteadiness(live.voices.steadinessTemperature);
        if (steadyTemperature !== live.voices.steadinessTemperature) {
            live.voices.steadinessTemperature = steadyTemperature;
            changed = true;
        }
        if (typeof live.voices.anchorDesignedVoices !== 'boolean') {
            live.voices.anchorDesignedVoices = defaults.anchorDesignedVoices;
            changed = true;
        }
        const nd = live.voices.narratorDesign;
        if (!isPlainObject(nd) || typeof nd.description !== 'string' || typeof nd.label !== 'string'
            || typeof nd.gender !== 'string' || typeof nd.languageCode !== 'string') {
            live.voices.narratorDesign = { ...DEFAULT_NARRATOR_DESIGN };
            changed = true;
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
