/*
 * Doom's Enhancement Suite for SillyTavern — Voices: stock voice catalog
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
 * Google's 30 prebuilt Gemini TTS voices with the trait word Google lists
 * for each (https://ai.google.dev/gemini-api/docs/speech-generation#voices)
 * and the gender Google's Cloud TTS lists for the same-named Chirp 3 HD
 * voices (https://docs.cloud.google.com/text-to-speech/docs/chirp3-hd).
 * Spelled as Google spells them — note "Callirrhoe", which SillyTavern's own
 * list gets wrong. DES never asks SillyTavern for this list.
 */
export const STOCK_VOICES = Object.freeze([
    { id: 'Zephyr', trait: 'Bright', gender: 'female' },
    { id: 'Puck', trait: 'Upbeat', gender: 'male' },
    { id: 'Charon', trait: 'Informative', gender: 'male' },
    { id: 'Kore', trait: 'Firm', gender: 'female' },
    { id: 'Fenrir', trait: 'Excitable', gender: 'male' },
    { id: 'Leda', trait: 'Youthful', gender: 'female' },
    { id: 'Orus', trait: 'Firm', gender: 'male' },
    { id: 'Aoede', trait: 'Breezy', gender: 'female' },
    { id: 'Callirrhoe', trait: 'Easy-going', gender: 'female' },
    { id: 'Autonoe', trait: 'Bright', gender: 'female' },
    { id: 'Enceladus', trait: 'Breathy', gender: 'male' },
    { id: 'Iapetus', trait: 'Clear', gender: 'male' },
    { id: 'Umbriel', trait: 'Easy-going', gender: 'male' },
    { id: 'Algieba', trait: 'Smooth', gender: 'male' },
    { id: 'Despina', trait: 'Smooth', gender: 'female' },
    { id: 'Erinome', trait: 'Clear', gender: 'female' },
    { id: 'Algenib', trait: 'Gravelly', gender: 'male' },
    { id: 'Rasalgethi', trait: 'Informative', gender: 'male' },
    { id: 'Laomedeia', trait: 'Upbeat', gender: 'female' },
    { id: 'Achernar', trait: 'Soft', gender: 'female' },
    { id: 'Alnilam', trait: 'Firm', gender: 'male' },
    { id: 'Schedar', trait: 'Even', gender: 'male' },
    { id: 'Gacrux', trait: 'Mature', gender: 'female' },
    { id: 'Pulcherrima', trait: 'Forward', gender: 'female' },
    { id: 'Achird', trait: 'Friendly', gender: 'male' },
    { id: 'Zubenelgenubi', trait: 'Casual', gender: 'male' },
    { id: 'Vindemiatrix', trait: 'Gentle', gender: 'female' },
    { id: 'Sadachbia', trait: 'Lively', gender: 'male' },
    { id: 'Sadaltager', trait: 'Knowledgeable', gender: 'male' },
    { id: 'Sulafat', trait: 'Warm', gender: 'female' },
]);

const byLower = new Map(STOCK_VOICES.map(v => [v.id.toLowerCase(), v]));

/** True for one of the 30 prebuilt voice names (case-insensitive). */
export function isStockVoice(id) {
    return typeof id === 'string' && byLower.has(id.toLowerCase());
}

/** Google's spelling of a stock voice name, or null. */
export function canonicalStockId(id) {
    return typeof id === 'string' ? (byLower.get(id.toLowerCase())?.id || null) : null;
}

/** 'female' | 'male' | null for a stock voice. */
export function stockGender(id) {
    const v = typeof id === 'string' ? byLower.get(id.toLowerCase()) : null;
    return v ? v.gender : null;
}

/** A stock voice of the given gender, for fallbacks ('female' → Kore, 'male' → Charon). */
export function defaultStockFor(gender) {
    return gender === 'female' ? 'Kore' : 'Charon';
}

/** "Kore — Firm" for display. */
export function stockLabel(id) {
    const v = typeof id === 'string' ? byLower.get(id.toLowerCase()) : null;
    return v ? `${v.id} — ${v.trait}` : String(id || '');
}

/** A VoiceRef for a stock voice. */
export function stockRef(id) {
    const canonical = canonicalStockId(id) || id;
    return { source: 'stock', id: canonical };
}
