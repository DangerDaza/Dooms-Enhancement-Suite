/**
 * Fullsheet detection + import-button injection (eager half of the character
 * sheet feature).
 *
 * Split out of characterSheet.js so the chat event handlers can detect
 * fullsheet messages and inject import buttons WITHOUT pulling in the whole
 * 800-line character sheet module at startup — that module (parser, popup,
 * stats rendering) loads lazily with the settings template.
 */
import { extensionSettings } from '../../core/state.js';

// ─────────────────────────────────────────────
//  Stats cache (cleared on chat change; shared with characterSheet.js)
// ─────────────────────────────────────────────
export const statsCache = new Map();

export function clearStatsCache() {
    statsCache.clear();
}

/**
 * Heuristic: does a message contain BunnyMo fullsheet data?
 * Counts numbered section headers (e.g. "## SECTION 1/8", "## 部分 1/8").
 */
export function messageHasFullSheet(messageText) {
    if (!messageText) return false;
    const headerMatches = messageText.match(/^#{0,2}\s*\S+\s+\d+\s*\/\s*\d+/gim);
    return headerMatches !== null && headerMatches.length >= 2;
}

/**
 * Scans all existing chat messages and injects the import button
 * on any that contain fullsheet data. Called on CHAT_CHANGED.
 */
export function injectFullSheetButtons() {
    if (!extensionSettings.enabled) return;
    const context = SillyTavern.getContext();
    const chat = context.chat || [];

    $('#chat .mes').each(function () {
        const mesId = parseInt($(this).attr('mesid'));
        if (isNaN(mesId)) return;
        const msg = chat[mesId];
        if (!msg || msg.is_user || msg.is_system) return;
        if (!messageHasFullSheet(msg.mes)) return;

        const $extraBtns = $(this).find('.mes_buttons .extraMesButtons');
        if ($extraBtns.length && !$extraBtns.find('.dooms-import-fullsheet-btn').length) {
            $extraBtns.prepend(`<div class="dooms-import-fullsheet-btn mes_button fa-solid fa-scroll" title="Import Character Sheet"></div>`);
        }
    });
}
