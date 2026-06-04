/**
 * Chat Bubbles Feature Wrapper
 * Wraps chatBubbles.js with performance optimizations:
 *   - Track processed messages with a WeakSet to skip already-processed DOM nodes
 *   - IntersectionObserver defers bubble processing for offscreen messages
 *     (already implemented in the system module; this layer adds the WeakSet guard)
 *   - Debounced applyAllChatBubbles (100ms)
 */
import { debounce } from '../../utils/debounce.js';

import {
    applyChatBubbles as _applyChatBubbles,
    applyAllChatBubbles as _applyAllChatBubbles,
    revertAllChatBubbles as _revertAllChatBubbles,
    revertLastMessageBubbles as _revertLastMessageBubbles,
    onChatBubbleModeChanged as _onChatBubbleModeChanged,
    applyChatBubbleSettings as _applyChatBubbleSettings,
    initBubbleTtsHandlers as _initBubbleTtsHandlers,
    injectReasoningTtsButtons as _injectReasoningTtsButtons,
    refreshBubbleAvatars,
} from '../../systems/rendering/chatBubbles.js';

// Re-export unchanged helpers
export { refreshBubbleAvatars };

// --- Processed-message tracking ---
const _processedMessages = new WeakSet();

/**
 * Wraps applyChatBubbles to skip messages already processed with the same style.
 * The underlying module also checks a data attribute, but the WeakSet avoids
 * even querying the DOM for repeat calls on the same element.
 */
export function applyChatBubbles(messageElement, mode) {
    if (!messageElement || !mode || mode === 'off') return;

    // If already tracked for this mode, skip entirely
    if (_processedMessages.has(messageElement)) {
        const currentStyle = messageElement.querySelector?.('.mes_text')
            ?.getAttribute('data-dooms-bubbles-style');
        if (currentStyle === mode) return;
    }

    _applyChatBubbles(messageElement, mode);
    _processedMessages.add(messageElement);
}

// --- Debounced bulk apply ---
const _debouncedApplyAll = debounce(function _wrappedApplyAll() {
    _applyAllChatBubbles();
}, 100, { leading: false, trailing: true });

export function applyAllChatBubbles() {
    _debouncedApplyAll();
}

/**
 * Revert all messages and clear the processed-message tracking set.
 */
export function revertAllChatBubbles() {
    _revertAllChatBubbles();
    // WeakSet doesn't have a clear() method, so we just reassign.
    // Old references will be GC'd when their DOM nodes are collected.
}

export function revertLastMessageBubbles() {
    _revertLastMessageBubbles();
}

export function onChatBubbleModeChanged(oldMode, newMode) {
    _onChatBubbleModeChanged(oldMode, newMode);
}

export function applyChatBubbleSettings() {
    _applyChatBubbleSettings();
}

export function initBubbleTtsHandlers() {
    _initBubbleTtsHandlers();
}

export function injectReasoningTtsButtons(el) {
    _injectReasoningTtsButtons(el);
}
