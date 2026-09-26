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
 * for each (https://ai.google.dev/gemini-api/docs/speech-generation#voices).
 * Spelled as Google spells them — note "Callirrhoe", which SillyTavern's own
 * list gets wrong. DES never asks SillyTavern for this list.
 */
export const STOCK_VOICES = Object.freeze([
    { id: 'Zephyr', trait: 'Bright' },
    { id: 'Puck', trait: 'Upbeat' },
    { id: 'Charon', trait: 'Informative' },
    { id: 'Kore', trait: 'Firm' },
    { id: 'Fenrir', trait: 'Excitable' },
    { id: 'Leda', trait: 'Youthful' },
    { id: 'Orus', trait: 'Firm' },
    { id: 'Aoede', trait: 'Breezy' },
    { id: 'Callirrhoe', trait: 'Easy-going' },
    { id: 'Autonoe', trait: 'Bright' },
    { id: 'Enceladus', trait: 'Breathy' },
    { id: 'Iapetus', trait: 'Clear' },
    { id: 'Umbriel', trait: 'Easy-going' },
    { id: 'Algieba', trait: 'Smooth' },
    { id: 'Despina', trait: 'Smooth' },
    { id: 'Erinome', trait: 'Clear' },
    { id: 'Algenib', trait: 'Gravelly' },
    { id: 'Rasalgethi', trait: 'Informative' },
    { id: 'Laomedeia', trait: 'Upbeat' },
    { id: 'Achernar', trait: 'Soft' },
    { id: 'Alnilam', trait: 'Firm' },
    { id: 'Schedar', trait: 'Even' },
    { id: 'Gacrux', trait: 'Mature' },
    { id: 'Pulcherrima', trait: 'Forward' },
    { id: 'Achird', trait: 'Friendly' },
    { id: 'Zubenelgenubi', trait: 'Casual' },
    { id: 'Vindemiatrix', trait: 'Gentle' },
    { id: 'Sadachbia', trait: 'Lively' },
    { id: 'Sadaltager', trait: 'Knowledgeable' },
    { id: 'Sulafat', trait: 'Warm' },
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
