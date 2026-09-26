/*
 * Doom's Enhancement Suite for SillyTavern — Voices: designed-voice registry
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
 * The voices a user has designed through DES (docs/google-tts-voices-plan.md
 * §8.3–8.6). Google keeps the voice; DES keeps a registry entry in
 * extensionSettings.voices.customVoices so it can show who uses a voice,
 * warn before it expires (1-year TTL), recreate it from its description,
 * and delete it.
 *
 * Rules from the plan:
 * - A voice is registered the moment Google creates it, so a design the
 *   user never picks still shows up under "not used by anyone" and can be
 *   cleaned up (each one uses one of the project's 200 slots).
 * - Deleting a character, version or campaign never deletes a Google voice
 *   (D16); only the manager's Delete does, and it removes every reference.
 */
import { generateRaw } from '../../../../../../../script.js';
import { extensionSettings } from '../../core/state.js';
import { saveSettings } from '../../core/persistence.js';
import { voiceUses, rewriteVoiceRefs, BASE_VERSION } from '../lorebook/campaignProfiles.js';
import { getCampaignsInOrder } from '../lorebook/campaignManager.js';
import { DEFAULT_VOICE_DESIGN_PROMPT } from '../generation/defaultPrompts.js';
import { defaultStockFor } from './voiceCatalog.js';
import { getDesKey } from './transport.js';
import { createDesignedVoice, deleteVoice } from './voicesApi.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Saves and tells open views (Workshop Voice tab, Settings → Voices) the registry changed. */
function changed() {
    saveSettings();
    try { document.dispatchEvent(new CustomEvent('dooms:voices-registry')); } catch (e) {}
}
export const EXPIRY_WARNING_DAYS = 30;

function registry() {
    const v = extensionSettings.voices;
    if (!v.customVoices || typeof v.customVoices !== 'object') v.customVoices = {};
    return v.customVoices;
}

export function listRegistered() {
    return Object.values(registry()).sort((a, b) => String(a.label || '').localeCompare(String(b.label || '')));
}

export function getRegistered(id) {
    return registry()[id] || null;
}

/** The VoiceRef stored on a character for a designed voice. */
export function refFor(entry) {
    return {
        source: 'designed',
        id: entry.id,
        label: entry.label || 'Designed voice',
        // A standard voice of the same gender reads their lines if the key is
        // removed or Google loses the voice.
        fallbackStock: defaultStockFor(entry.gender),
    };
}

/** Days until Google deletes the voice, or null when unknown. */
export function daysLeft(entry) {
    const t = entry?.expireTime ? Date.parse(entry.expireTime) : NaN;
    if (!Number.isFinite(t)) return null;
    return Math.floor((t - Date.now()) / DAY_MS);
}

/** 'ok' | 'expiring' | 'gone' */
export function health(entry) {
    if (!entry) return 'gone';
    if (entry.status === 'gone') return 'gone';
    const d = daysLeft(entry);
    if (d !== null && d < 0) return 'gone';
    if (d !== null && d <= EXPIRY_WARNING_DAYS) return 'expiring';
    return 'ok';
}

function campaignName(id) {
    if (!id || id === BASE_VERSION) return 'Base';
    try {
        const c = getCampaignsInOrder().find(x => x && x.id === id);
        return c?.name || 'a removed campaign';
    } catch (e) {
        return id;
    }
}

/** "Mara (Base, Iron Crown), your persona Jordan, the Narrator" — or '' when unused. */
export function usedByText(id) {
    const uses = voiceUses(id);
    const byName = new Map();
    const extra = [];
    for (const use of uses) {
        if (use.kind === 'narrator') extra.push('the Narrator');
        else if (use.kind === 'persona') extra.push(`your persona ${use.name}`);
        else {
            if (!byName.has(use.name)) byName.set(use.name, []);
            byName.get(use.name).push(campaignName(use.versionId));
        }
    }
    const chars = [...byName.entries()].map(([name, versions]) => {
        const hasCampaigns = (extensionSettings.lorebook?.campaignOrder || []).length > 0;
        return hasCampaigns ? `${name} (${[...new Set(versions)].join(', ')})` : name;
    });
    return [...chars, ...extra].join(', ');
}

/**
 * Designs a voice on Google and registers it.
 * @param {{description: string, label: string, gender?: string, languageCode?: string}} spec
 * @returns {Promise<{entry: object, sample: {mimeType: string, data: string}|null}>}
 */
export async function designVoice({ description, label, gender, languageCode }) {
    const voice = await createDesignedVoice({ description, displayName: label, gender, languageCode });
    if (!voice.id) throw new Error('Google didn’t return an id for the new voice.');
    const key = getDesKey();
    const entry = {
        id: voice.id,
        source: 'designed',
        label: label || voice.label || 'Designed voice',
        designPrompt: String(description || '').trim(),
        gender: gender === 'female' || gender === 'male' ? gender : (voice.gender === 'female' || voice.gender === 'male' ? voice.gender : ''),
        languageCode: languageCode || voice.languageCode || '',
        createdAt: Date.now(),
        expireTime: voice.expireTime || new Date(Date.now() + 365 * DAY_MS).toISOString(),
        keyTag: key ? key.slice(-4) : '',
        status: 'ok',
    };
    registry()[entry.id] = entry;
    changed();
    return { entry, sample: voice.sample };
}

/**
 * Deletes a designed voice from Google and removes every reference to it
 * (characters in every version, personas, the Narrator).
 * @returns {Promise<number>} references removed
 */
export async function deleteDesignedVoice(id) {
    await deleteVoice(id); // already-gone counts as deleted
    const n = rewriteVoiceRefs(id, null);
    delete registry()[id];
    changed();
    return n;
}

/**
 * Designs a fresh copy of a voice from its saved description (expiring or
 * gone), points every reference at the new one, then deletes the old one.
 * The new voice may not sound exactly the same.
 * @returns {Promise<{entry: object, sample: object|null}>}
 */
export async function recreateDesignedVoice(id) {
    const old = getRegistered(id);
    if (!old || !old.designPrompt) throw new Error('This voice has no saved description to recreate it from.');
    const { entry, sample } = await designVoice({
        description: old.designPrompt,
        label: old.label,
        gender: old.gender,
        languageCode: old.languageCode,
    });
    rewriteVoiceRefs(id, entry.id, { label: entry.label, fallbackStock: defaultStockFor(entry.gender) });
    delete registry()[id];
    changed();
    try { await deleteVoice(id); } catch (e) { /* the old one may already be gone */ }
    return { entry, sample };
}

/**
 * Asks the chat AI for a voice description based on the character card
 * (Workshop → Voice → Design → Draft from card). Never creates anything.
 * @param {{name: string, appearance?: string, description?: string}} card
 * @returns {Promise<string>}
 */
export async function draftDescriptionFromCard({ name, appearance, description }) {
    const prompt = DEFAULT_VOICE_DESIGN_PROMPT
        .replace(/\{name\}/g, name || 'the character')
        .replace(/\{appearance\}/g, (appearance || '').trim().slice(0, 1200) || '(not given)')
        .replace(/\{description\}/g, (description || '').trim().slice(0, 1600) || '(not given)');
    const response = await generateRaw({
        prompt,
        systemPrompt: 'You write short, concrete voice descriptions for a text-to-speech voice designer. Output only the description.',
        instructOverride: false,
        // Room for reasoning models to think and still answer.
        responseLength: 2000,
    });
    return String(response || '')
        .replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, '')
        .replace(/<think(?:ing)?>[\s\S]*$/gi, '')
        .replace(/^["'\s]+|["'\s]+$/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 600);
}
