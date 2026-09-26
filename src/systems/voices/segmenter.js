/*
 * Doom's Enhancement Suite for SillyTavern — Voices: message segmenter
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
 * Splits a chat message into ordered speaker segments for TTS
 * (docs/google-tts-voices-plan.md §7.1), using the same attribution the
 * chat bubbles use:
 *
 * - Bubbles applied: read the bubbles themselves, so the voice always
 *   matches the name printed on the bubble.
 * - Bubbles off: parse a detached copy of the message HTML with the bubble
 *   parser in read-only mode.
 *
 * Without dialogue colouring (<font color> tags) there is nothing to
 * attribute and the whole message is narration.
 */
import { chat, messageFormatting } from '../../../../../../../script.js';
import { extensionSettings } from '../../core/state.js';
import { isSyntheticTrackerMessage } from '../../utils/messageGuards.js';
import { parseSegmentsForTts, removeGfxBlocks } from '../rendering/chatBubbles.js';
import { resolveActiveUserName } from '../ui/portraitBar.js';
import { normalizeSegments } from './segments.js';

const BUBBLE_SELECTOR = '.dooms-bubbles .dooms-bubble:not(.dooms-bubble-user), .dooms-bubbles .dooms-card:not(.dooms-card-user)';
const STRIP_SELECTOR = '.dooms-inline-thought, .dooms-bubbles, .mes_reasoning_details, details, img, style, script, pre, code, .dooms-tracker-json';

function htmlToText(html) {
    const div = document.createElement('div');
    div.innerHTML = html;
    return div.textContent || '';
}

function messageElement(messageId) {
    return document.querySelector(`#chat .mes[mesid="${messageId}"]`);
}

/** Raw segments from rendered bubbles, in DOM order. */
function rawFromBubbles(bubbles, fromIdx) {
    const out = [];
    bubbles.forEach((bubble, idx) => {
        if (idx < fromIdx) return;
        const narrator = bubble.classList.contains('dooms-bubble-narrator') || bubble.classList.contains('dooms-card-narrator');
        const textEl = bubble.querySelector('.dooms-bubble-text, .dooms-card-text');
        const speaker = bubble.getAttribute('data-speaker') || null;
        out.push({
            speaker: narrator ? null : speaker,
            kind: narrator ? 'narration' : 'dialogue',
            text: textEl ? textEl.textContent : '',
            idx,
        });
    });
    return out;
}

/** Raw segments by parsing the message HTML (bubbles off, or message not on screen). */
function rawFromHtml(messageId, msg) {
    const mesText = messageElement(messageId)?.querySelector('.mes_text');
    const html = mesText
        ? mesText.innerHTML
        : messageFormatting(msg.mes, msg.name, msg.is_system, msg.is_user, messageId);
    const div = document.createElement('div');
    div.innerHTML = html;
    div.querySelectorAll(STRIP_SELECTOR).forEach(el => el.remove());
    removeGfxBlocks(div);
    return parseSegmentsForTts(div, messageId).map(seg => ({
        speaker: seg.narrator ? null : seg.speaker,
        kind: seg.narrator ? 'narration' : 'dialogue',
        text: htmlToText(seg.html),
    }));
}

/**
 * @param {number} messageId
 * @param {{fromIdx?: number, includeUser?: boolean, resolveSpeaker?: (n: string) => string|null}} [opts]
 * @returns {import('./segments.js').Segment[]}
 */
export function segmentMessageForTts(messageId, opts = {}) {
    const msg = Array.isArray(chat) ? chat[messageId] : null;
    if (!msg || msg.is_system || isSyntheticTrackerMessage(msg)) return [];
    const maxSegments = Number(extensionSettings.voices?.maxSegmentsPerMessage) || 24;
    const normalize = (raw) => normalizeSegments(raw, { maxSegments, resolveSpeaker: opts.resolveSpeaker });

    if (msg.is_user) {
        if (!opts.includeUser) return [];
        const mesText = messageElement(messageId)?.querySelector('.mes_text');
        const text = mesText ? mesText.textContent : htmlToText(messageFormatting(msg.mes, msg.name, msg.is_system, msg.is_user, messageId));
        // The persona's own line; the scene rule still decides whether its voice is used.
        return normalize([{ speaker: resolveActiveUserName() || msg.name || null, kind: 'dialogue', text }]);
    }

    const mes = messageElement(messageId);
    const bubbles = mes ? mes.querySelectorAll(BUBBLE_SELECTOR) : [];
    if (bubbles.length) return normalize(rawFromBubbles(bubbles, Math.max(0, opts.fromIdx || 0)));
    return normalize(rawFromHtml(messageId, msg));
}

/** DOM index of a bubble among its message's bubbles (for "read from here"). */
export function bubbleIndex(bubbleEl) {
    const mes = bubbleEl?.closest('.mes');
    if (!mes) return -1;
    return Array.from(mes.querySelectorAll(BUBBLE_SELECTOR)).indexOf(bubbleEl);
}
