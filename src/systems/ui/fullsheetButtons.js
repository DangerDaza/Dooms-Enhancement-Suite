/**
 * Fullsheet detection + import-button injection (eager half of the character
 * sheet feature).
 *
 * Split out of characterSheet.js so the chat event handlers can detect
 * fullsheet messages and inject import buttons WITHOUT pulling in the whole
 * 800-line character sheet module at startup — that module (parser, popup,
 * stats rendering) loads lazily with the settings template.
 *
 * Invariant: button shown ⇒ import succeeds. Every signal that makes
 * messageHasFullSheet return true corresponds to a shape parseFullSheet
 * (characterSheet.js) can turn into at least one section — the header
 * collectors and tag extractors below are shared with the parser for that
 * reason. Keep them in lockstep.
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
//  Header + tag collectors (shared with the parser)
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
 * Groups: 1 = summary wrapper (or ''), 2 = hashes (or ''), 3 = section word,
 * 4 = N, 5 = M, 6 = colon (or ''), 7 = rest of line.
 */
const SECTION_HEADER_SOURCE = String.raw`^\s*(?:<details[^>]*>\s*)?(<summary[^>]*>)?\s*(#{0,3})\s*(?:\S{1,8}\s+)?(\S+)\s+(\d{1,3})\s*[\/／]\s*(\d{1,3})(:?)\s*(.*)$`;
// Compiled once — the 'g' flag's lastIndex is reset per call. Detection runs
// per message on several hot event paths; per-call compilation was measurable
// on full-chat sweeps.
const SECTION_HEADER_RE = new RegExp(SECTION_HEADER_SOURCE, 'gim');

/**
 * Collects all numbered section headers in a message.
 * Returns [{ word, n, m, hasColon, structural, title, startIndex, headerEndIndex }].
 * `structural` = the line looks like markup (hash heading, **bold**, or a
 * <summary> wrapper), not plain prose — the discriminator that separates
 * "## SECTION 1/8: Core" from a diary line like "Day 1/7: We arrived".
 */
export function collectSectionHeaders(text) {
    if (!text) return [];
    SECTION_HEADER_RE.lastIndex = 0;
    const headers = [];
    let match;
    while ((match = SECTION_HEADER_RE.exec(text)) !== null) {
        const word = match[3];
        const title = (match[7] || '').trim();
        headers.push({
            word,
            n: parseInt(match[4]),
            m: parseInt(match[5]),
            hasColon: match[6] === ':',
            structural: !!(match[1] || match[2] || word.includes('**') || title.includes('**')),
            title,
            startIndex: match.index,
            headerEndIndex: match.index + match[0].length,
        });
    }
    return headers;
}

/**
 * Per-header sanity filter: a header can plausibly belong to a character
 * sheet when its denominator is in sheet range (BunnyMo has shipped /6
 * through /14; 24 leaves headroom for long variants while still excluding
 * "HP 45/100" and "Day 3/365") and its section number doesn't overshoot.
 */
export function saneSectionHeaders(headers) {
    return headers.filter(h => h.m >= 2 && h.m <= 24 && h.n >= 1 && h.n <= h.m);
}

/**
 * Picks the "dominant" coherent group of section headers: same denominator M,
 * ≥2 distinct section numbers, starting low (or 3+ headers for a sheet
 * continued from an earlier message). This is what keeps "HP 45/100" +
 * "MP 30/50" stat blocks and "Day 3/10" counters from reading as character
 * sheets. Returns the group's headers (in document order) or [].
 */
export function pickDominantSectionGroup(headers) {
    const byM = new Map();
    for (const h of saneSectionHeaders(headers)) {
        if (!byM.has(h.m)) byM.set(h.m, []);
        byM.get(h.m).push(h);
    }
    let best = [];
    for (const group of byM.values()) {
        const ns = new Set(group.map(h => h.n));
        if (ns.size < 2) continue;
        // Small groups need STRONG headers — the "N/M:" colon every official
        // template uses plus markup structure (hashes / bold / <summary>).
        // That's what separates "## SECTION 1/8: Core" from prose counters
        // like "Day 1/7: We arrived ... Day 2/7: We sailed". A tall same-M
        // ladder (4+ distinct sections) is overwhelming evidence on its own,
        // which keeps colon-less non-English sheets ("##セクション 1/8 ...")
        // detectable. (Trade-off: 2-3-section colon-less tails are missed.)
        const strongCount = group.filter(h => h.hasColon && h.structural).length;
        if (strongCount < 2 && ns.size < 4) continue;
        if (group.length > best.length) best = group;
    }
    return best;
}

/**
 * Fallback header collector for sheets without a coherent numbered group
 * (e.g. a drifted quicksheet). Two shapes: a line LEADING with a short bold
 * token ("**Physical:** silver hair..." — header ends after the bold, rest of
 * line is content), or a plain hash heading on its own line.
 * Same shape as collectSectionHeaders minus the numbering fields.
 */
const UNNUMBERED_HEADER_RE = /^\s*(?:#{1,3}\s*)?(?:\S{1,8}\s+)?\*\*([^*\n]{2,40})\*\*:?[ \t]*|^\s*#{1,3}\s+([^\n]{2,60})$/gm;

export function collectUnnumberedHeaders(text) {
    if (!text) return [];
    UNNUMBERED_HEADER_RE.lastIndex = 0;
    const headers = [];
    let match;
    let n = 1;
    while ((match = UNNUMBERED_HEADER_RE.exec(text)) !== null) {
        if (!match[0].trim()) { UNNUMBERED_HEADER_RE.lastIndex++; continue; }
        headers.push({
            n: n++,
            m: 0,
            title: (match[1] || match[2] || '').replace(/:$/, '').trim(),
            startIndex: match.index,
            headerEndIndex: match.index + match[0].length,
        });
    }
    return headers;
}

// Bunny Mo terminal tag block — present at the end of current fullsheet AND
// quicksheet output. Highest-precision signal we have, and truncation-proof.
export const BUNNYMO_TAGS_BLOCK_RE = /<BunnymoTags>([\s\S]*?)<\/BunnymoTags>/i;
const BUNNYMO_TAGS_OPEN = /<BunnymoTags>/i;
// <TAG:value> machine tags (CarrotKernel's fallback signal). The (?!\/\/)
// keeps angle-bracketed URLs (<https://...>) from counting as tags.
const BUNNYMO_TAG_RE = /<[A-Za-z][A-Za-z0-9_]*:(?!\/\/)[^>\n]+>/g;

/** All <TAG:value> machine tags in a message (shared with the parser). */
export function collectMachineTags(text) {
    if (!text) return [];
    return text.match(BUNNYMO_TAG_RE) || [];
}

// Quicksheet title line, e.g. "# 🎯 QUICKSHEET CHARACTER ANALYSIS 🎯" or
// "# 🐰 QUICK SHEET: Luna". Anchored, at most one token before the word.
const QUICKSHEET_TITLE_RE = /^\s*#{0,3}\s*\S*\s*QUICK\s?SHEET/im;

// ─────────────────────────────────────────────
//  Detection
// ─────────────────────────────────────────────

// Detection results memoized by message text: the same immutable text is
// re-tested on every sweep (chat change, "show more messages", boot) and on
// swipe navigation. Content-pure, so no invalidation needed — just a size cap.
const detectCache = new Map();

/**
 * Heuristic: does a message contain BunnyMo fullsheet/quicksheet data?
 * Multi-signal — any of:
 *   S3: a coherent group of numbered section headers (see above)
 *   S1: a <BunnymoTags> block or ≥3 <TAG:value> machine tags (the parser
 *       turns these into a Tags section, so the import always succeeds)
 *   S2: a quicksheet title line + ≥2 unnumbered headers the parser's
 *       fallback splitter will find (drifted quicksheets)
 */
export function messageHasFullSheet(messageText) {
    if (!messageText || messageText.length < 40) return false;
    const cached = detectCache.get(messageText);
    if (cached !== undefined) return cached;
    if (detectCache.size > 2000) detectCache.clear();

    let result = false;
    if (pickDominantSectionGroup(collectSectionHeaders(messageText)).length >= 2) {
        result = true;
    } else if (BUNNYMO_TAGS_OPEN.test(messageText) || collectMachineTags(messageText).length >= 3) {
        result = true;
    } else if (QUICKSHEET_TITLE_RE.test(messageText)
        && collectUnnumberedHeaders(messageText).length >= 2) {
        result = true;
    }
    detectCache.set(messageText, result);
    return result;
}

// ─────────────────────────────────────────────
//  Button injection
// ─────────────────────────────────────────────

const IMPORT_BTN_HTML = `<div class="dooms-import-fullsheet-btn mes_button fa-solid fa-scroll" title="Import Character Sheet"></div>`;

/**
 * Syncs the import button on a message's ALWAYS-VISIBLE button row: adds it
 * when the current text is a sheet, removes it when not (a swipe or edit can
 * replace a sheet with prose — a stale button would import garbage).
 * Previously the button went inside `.extraMesButtons`, which SillyTavern
 * hides behind the "..." Message Actions flyout by default
 * (power_user.expand_message_actions defaults to false) — so for most users
 * it never appeared on the message at all.
 */
function syncButtonOnElement(messageElement, hasSheet) {
    const $btnRow = $(messageElement).find('.mes_buttons');
    if (!$btnRow.length) {
        if (hasSheet) console.debug('[Dooms Tracker] Fullsheet detected but .mes_buttons row missing on message', $(messageElement).attr('mesid'));
        return;
    }
    const $existing = $btnRow.find('.dooms-import-fullsheet-btn');
    if (hasSheet && !$existing.length) {
        $btnRow.prepend(IMPORT_BTN_HTML);
    } else if (!hasSheet && $existing.length) {
        $existing.remove();
    }
}

/**
 * Detect + sync for a single message by id. Shared by every event path
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
    const messageElement = document.querySelector(`#chat .mes[mesid="${mesId}"]`);
    if (messageElement) syncButtonOnElement(messageElement, messageHasFullSheet(msg.mes));
}

/**
 * Scans all rendered chat messages and syncs the import button on each.
 * Called on CHAT_CHANGED, MORE_MESSAGES_LOADED, and boot. Cheap on re-sweeps:
 * detection is memoized by message text.
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
        syncButtonOnElement(this, messageHasFullSheet(msg.mes));
    });
}
