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

// ─────────────────────────────────────────────
//  Detection
// ─────────────────────────────────────────────

/**
 * Section header regex source, shared with parseFullSheet() so the detector
 * and the parser can never disagree about what a header is.
 *
 * Tolerates: leading indentation, <details>/<summary> wrappers, up to ###
 * hashes, an optional short decorator token (emoji, bullet, 🥕) before the
 * section word, ASCII or fullwidth slash. Language-agnostic — the section
 * word is any non-whitespace run ("SECTION", "セクション", "SECCIÓN"...).
 *
 * Groups: 1 = section word, 2 = N, 3 = M, 4 = colon (or ''), 5 = rest of line.
 */
export const SECTION_HEADER_SOURCE = String.raw`^\s*(?:<details[^>]*>\s*)?(?:<summary[^>]*>\s*)?#{0,3}\s*(?:\S{1,8}\s+)?(\S+)\s+(\d{1,3})\s*[\/／]\s*(\d{1,3})(:?)\s*(.*)$`;

/**
 * Collects all numbered section headers in a message.
 * Returns [{ word, n, m, hasColon, title, startIndex, headerEndIndex }].
 */
export function collectSectionHeaders(text) {
    if (!text) return [];
    const re = new RegExp(SECTION_HEADER_SOURCE, 'gim');
    const headers = [];
    let match;
    while ((match = re.exec(text)) !== null) {
        headers.push({
            word: match[1],
            n: parseInt(match[2]),
            m: parseInt(match[3]),
            hasColon: match[4] === ':',
            title: (match[5] || '').trim(),
            startIndex: match.index,
            headerEndIndex: match.index + match[0].length,
        });
    }
    return headers;
}

/**
 * Picks the "dominant" coherent group of section headers: same denominator M
 * in sheet range, ≥2 distinct section numbers ≤ M, starting low (or 3+
 * headers for a sheet continued from an earlier message). This is what keeps
 * "HP 45/100" + "MP 30/50" stat blocks and "Day 3/10" counters from reading
 * as character sheets. Returns the group's headers (in document order) or [].
 */
export function pickDominantSectionGroup(headers) {
    const byM = new Map();
    for (const h of headers) {
        if (h.m < 2 || h.m > 20 || h.n < 1 || h.n > h.m) continue;
        if (!byM.has(h.m)) byM.set(h.m, []);
        byM.get(h.m).push(h);
    }
    let best = [];
    for (const group of byM.values()) {
        const ns = new Set(group.map(h => h.n));
        if (ns.size < 2) continue;
        // A 2-header group that starts high (e.g. only sections 7/8 + 8/8 —
        // a sheet tail continued in a fresh message) is only trusted when
        // both headers carry the "N/M:" colon every official template uses;
        // "Day 6/10 ... Day 7/10" day-counters don't.
        if (Math.min(...ns) > 2 && ns.size < 3 && !group.every(h => h.hasColon)) continue;
        if (group.length > best.length) best = group;
    }
    return best;
}

// Bunny Mo terminal tag block — present at the end of current fullsheet AND
// quicksheet output. Highest-precision signal we have.
const BUNNYMO_TAGS_BLOCK = /<BunnymoTags>/i;
// <TAG:value> machine tags (CarrotKernel's fallback signal). The (?!\/\/)
// keeps angle-bracketed URLs (<https://...>) from counting as tags.
const BUNNYMO_TAG = /<[A-Za-z][A-Za-z0-9_]*:(?!\/\/)[^>\n]+>/g;
// Quicksheet title line, e.g. "# 🎯 QUICKSHEET CHARACTER ANALYSIS 🎯" or
// "# 🐰 QUICK SHEET: Luna". Anchored, at most one token before the word.
const QUICKSHEET_TITLE = /^\s*#{0,3}\s*\S*\s*QUICK\s?SHEET/im;
const BOLD_BLOCK = /\*\*[^*\n]+\*\*/g;

/**
 * Heuristic: does a message contain BunnyMo fullsheet/quicksheet data?
 * Multi-signal — any of:
 *   S1: a <BunnymoTags> block or ≥3 <TAG:value> machine tags
 *   S2: a quicksheet title line (with length + bold-structure guards so
 *       prose merely mentioning "quicksheet" doesn't count)
 *   S3: a coherent group of numbered section headers (see above)
 */
export function messageHasFullSheet(messageText) {
    if (!messageText) return false;
    if (BUNNYMO_TAGS_BLOCK.test(messageText)) return true;
    if ((messageText.match(BUNNYMO_TAG) || []).length >= 3) return true;
    if (QUICKSHEET_TITLE.test(messageText)
        && messageText.length >= 300
        && (messageText.match(BOLD_BLOCK) || []).length >= 2) return true;
    return pickDominantSectionGroup(collectSectionHeaders(messageText)).length >= 2;
}

// ─────────────────────────────────────────────
//  Button injection
// ─────────────────────────────────────────────

const IMPORT_BTN_HTML = `<div class="dooms-import-fullsheet-btn mes_button fa-solid fa-scroll" title="Import Character Sheet"></div>`;

/**
 * Injects the import button into a message's ALWAYS-VISIBLE button row.
 * Previously the button went inside `.extraMesButtons`, which SillyTavern
 * hides behind the "..." Message Actions flyout by default
 * (power_user.expand_message_actions defaults to false) — so for most users
 * it never appeared on the message at all. Idempotent: the guard scans the
 * whole `.mes_buttons` row, covering buttons injected at the old position.
 */
function injectButtonIntoElement(messageElement) {
    const $btnRow = $(messageElement).find('.mes_buttons');
    if (!$btnRow.length) {
        console.debug('[Dooms Tracker] Fullsheet detected but .mes_buttons row missing on message', $(messageElement).attr('mesid'));
        return;
    }
    if ($btnRow.find('.dooms-import-fullsheet-btn').length) return;
    $btnRow.prepend(IMPORT_BTN_HTML);
}

/**
 * Detects + injects for a single message by id. Shared by every event path
 * (render, swipe, edit, more-messages-loaded) so they can't drift apart.
 */
export function injectFullSheetButtonForMessage(messageId) {
    if (!extensionSettings.enabled) return;
    const context = SillyTavern.getContext();
    const chat = context.chat || [];
    const mesId = parseInt(messageId);
    if (isNaN(mesId)) return;
    const msg = chat[mesId];
    if (!msg || msg.is_user || msg.is_system) return;
    if (!messageHasFullSheet(msg.mes)) return;
    const messageElement = document.querySelector(`#chat .mes[mesid="${mesId}"]`);
    if (messageElement) injectButtonIntoElement(messageElement);
}

/**
 * Scans all rendered chat messages and injects the import button
 * on any that contain fullsheet data. Called on CHAT_CHANGED and boot.
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
        injectButtonIntoElement(this);
    });
}
