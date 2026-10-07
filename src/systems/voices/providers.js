/*
 * Doom's Enhancement Suite for SillyTavern — Voices: provider routing
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
 * Turns one line into audio with the right service
 * (docs/tts-connections-plan.md §4.1). The player calls this; everything
 * above it (segments, scene rule, delivery note) is service-agnostic.
 */
import { secret_state } from '../../../../../../secrets.js';
import { extensionSettings } from '../../core/state.js';
import { synthesize as synthesizeGoogle, TtsError } from './transport.js';
import { synthesizeOpenRouter } from './openrouter.js';
import { providerFor, isConnected, anyConnected } from './connections.js';

function v() {
    return extensionSettings.voices || {};
}

/** The service a voice ref plays through. */
export function providerForRef(ref) {
    return providerFor(ref, v());
}

/** Is this service set up on this device? */
export function isProviderConnected(provider) {
    return isConnected(provider, v(), secret_state);
}

/** Is any voice service set up on this device? */
export function anyProviderConnected() {
    return anyConnected(v(), secret_state);
}

/**
 * @param {{text: string, voiceId: string, voiceSource?: string, provider?: string, model: string, style?: string, signal?: AbortSignal}} req
 * @returns {Promise<{blob: Blob, model: string}>}
 */
export async function synthesizeLine(req) {
    const provider = req.provider || providerFor({ source: req.voiceSource }, v());
    if (provider === 'openrouter') return synthesizeOpenRouter(req);
    try {
        return await synthesizeGoogle(req);
    } catch (e) {
        if (e instanceof TtsError && !e.provider) e.provider = 'google';
        throw e;
    }
}
