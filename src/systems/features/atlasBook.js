/**
 * The Atlas's book (docs/long-shot-plan.md D151): what the player did to
 * this chat's map. Where each marker was put, what was deleted, what was
 * merged into what, the markers made by hand, the names, kinds and notes
 * changed, the scale. Kept in chat_metadata.dooms_atlas, saved with the
 * chat; the pure edits are in src/utils/atlas.js (normalizeBook, placeAt,
 * removeMarker, mergeInto…). The clean-up pass (D155) is asked for here:
 * one background request on the tracker's profile; nothing is changed by
 * it, the player approves each proposal. Loaded with the Atlas, on first
 * open.
 */
import { chat_metadata, saveChatDebounced } from '../../../../../../../script.js';
import { extensionSettings, addDebugLog } from '../../core/state.js';
import { withBackgroundProfile, BACKGROUND_BUSY, generateWithExternalAPI } from '../generation/apiClient.js';
import { safeGenerateRaw } from '../../utils/responseExtractor.js';
import { normalizeBook, buildTidyPrompt, parseTidy } from '../../utils/atlas.js';

const META_KEY = 'dooms_atlas';
export const ATLAS_BOOK_CHANGED_EVENT = 'dooms:atlas-book-changed';

/** This chat's book, made safe; an empty one when the chat has none. */
export function getBook() {
    const raw = chat_metadata && typeof chat_metadata === 'object' ? chat_metadata[META_KEY] : null;
    return normalizeBook(raw);
}

/** The book replaced and saved with the chat; false when no chat's metadata is there to keep it. */
export function setBook(book) {
    if (!chat_metadata || typeof chat_metadata !== 'object') return false;
    chat_metadata[META_KEY] = normalizeBook(book);
    try { saveChatDebounced(); } catch (e) { /* no chat open */ }
    try { window.dispatchEvent(new CustomEvent(ATLAS_BOOK_CHANGED_EVENT)); } catch (e) { /* no window (tests) */ }
    return true;
}

// ─── The clean-up pass (D155) ───────────────────────────────────────────────

let tidying = false;
let tidyTransport = null;    // test hook: ({ system, user }) => Promise<string>

/** Test hook: the request's transport, or null for the real one. */
export function __setTidyTransport(fn) {
    tidyTransport = typeof fn === 'function' ? fn : null;
}

export function isTidying() {
    return tidying;
}

/**
 * Asks the AI to look over the map's places (the markers and the tray)
 * and propose merges and deletions. Nothing is stored and nothing is
 * changed: the proposals go to the player.
 * @returns {Promise<{ ok: boolean, reason: string, items: Array, error: string }>}
 */
export async function proposeTidy(model, { world = '' } = {}) {
    if (tidying) return { ok: false, reason: 'running', items: [], error: 'A clean-up is already being asked for.' };
    const prompt = buildTidyPrompt({ model, world });
    if (prompt.count < 2) return { ok: true, reason: 'few', items: [], error: '' };
    tidying = true;
    try {
        const external = extensionSettings.generationMode === 'external';
        const messages = [{ role: 'system', content: prompt.system }, { role: 'user', content: prompt.user }];
        const run = async () => {
            if (tidyTransport) return tidyTransport(prompt);
            if (external) return generateWithExternalAPI(messages);
            return safeGenerateRaw({ prompt: messages, quietToLoud: false });
        };
        const result = await withBackgroundProfile(run, { external, label: 'atlas-tidy' });
        if (result === BACKGROUND_BUSY) return { ok: false, reason: 'busy', items: [], error: 'Another request is running; try again in a moment.' };
        const text = typeof result === 'string' ? result : (result && typeof result === 'object' && typeof result.text === 'string' ? result.text : String(result ?? ''));
        const r = parseTidy(text, model);
        try { addDebugLog(`[Atlas] clean-up: ${r.ok ? `${r.items.length} proposal(s)` : r.error}`, r.ok ? null : { reply: text.slice(0, 400) }); } catch (e) { /* no log */ }
        return { ok: r.ok, reason: r.ok ? '' : 'invalid', items: r.items, error: r.error };
    } catch (e) {
        return { ok: false, reason: 'error', items: [], error: String(e && e.message || e) };
    } finally {
        tidying = false;
    }
}
