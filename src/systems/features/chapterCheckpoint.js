/**
 * Chapter Checkpoint Module
 * Allows users to mark messages as "chapter start" points to filter context
 * Uses SillyTavern's /hide and /unhide commands to exclude messages from context
 */
import { getContext } from '../../../../../../extensions.js';
import { chat_metadata, saveChatDebounced } from '../../../../../../../script.js';
import { executeSlashCommandsOnChatInput } from '../../../../../../../scripts/slash-commands.js';
// Track the message range that is currently hidden
let currentlyHiddenRange = null;
// Debounce restore to prevent loops
let isRestoring = false;
let restoreTimeout = null;
let pendingResolve = null;
/**
 * Gets the current chapter checkpoint message ID for the active chat
 * @returns {number|null} Message ID of the checkpoint, or null if none set
 */
export function getChapterCheckpoint() {
    const context = getContext();
    if (!context || !chat_metadata) return null;
    return chat_metadata.dooms_tracker_chapter_checkpoint || null;
}
/**
 * Sets a message as the chapter checkpoint
 * Automatically clears any previous checkpoint (only one checkpoint allowed at a time)
 * Hides all messages before the checkpoint
 * @param {number} messageId - The chat message index to set as checkpoint
 * @returns {Promise<boolean>} True if successful
 */
export async function setChapterCheckpoint(messageId) {
    const context = getContext();
    const chat = context.chat;
    if (!chat || messageId < 0 || messageId >= chat.length) {
        console.error('[Dooms Tracker] Invalid message ID for checkpoint:', messageId);
        return false;
    }
    const previousCheckpoint = chat_metadata.dooms_tracker_chapter_checkpoint;
    // If moving checkpoint, unhide the old range first
    if (previousCheckpoint !== null && previousCheckpoint !== undefined && previousCheckpoint !== messageId && currentlyHiddenRange !== null) {
        const { start, end } = currentlyHiddenRange;
        await executeSlashCommandsOnChatInput(`/unhide ${start}-${end}`, { quiet: true });
    }
    // Store in chat metadata (this automatically overrides any previous checkpoint)
    chat_metadata.dooms_tracker_chapter_checkpoint = messageId;
    saveChatDebounced();
    // Hide all messages before the checkpoint
    if (messageId > 0) {
        const rangeEnd = messageId - 1;
        await executeSlashCommandsOnChatInput(`/hide 0-${rangeEnd}`, { quiet: true });
        currentlyHiddenRange = { start: 0, end: rangeEnd };
    }
    if (previousCheckpoint !== null && previousCheckpoint !== undefined && previousCheckpoint !== messageId) {
    } else {
    }
    // Emit event for UI updates
    if (typeof document !== 'undefined') {
        const event = new CustomEvent('dooms-tracker-checkpoint-changed', {
            detail: { messageId, previousCheckpoint }
        });
        document.dispatchEvent(event);
    }
    return true;
}
/**
 * Clears the chapter checkpoint and unhides all hidden messages
 */
export async function clearChapterCheckpoint() {
    if (!chat_metadata) return;
    // Unhide any hidden messages
    if (currentlyHiddenRange !== null) {
        const { start, end } = currentlyHiddenRange;
        await executeSlashCommandsOnChatInput(`/unhide ${start}-${end}`, { quiet: true });
        currentlyHiddenRange = null;
    }
    delete chat_metadata.dooms_tracker_chapter_checkpoint;
    saveChatDebounced();
    // Emit event for UI updates
    if (typeof document !== 'undefined') {
        const event = new CustomEvent('dooms-tracker-checkpoint-changed', {
            detail: { messageId: null }
        });
        document.dispatchEvent(event);
    }
}
/**
 * Checks if a message is the current checkpoint
 * @param {number} messageId - The message index to check
 * @returns {boolean} True if this is the checkpoint message
 */
export function isCheckpointMessage(messageId) {
    const checkpointId = getChapterCheckpoint();
    return checkpointId === messageId;
}
/**
 * Restores checkpoint state after page reload or generation events
 * Checks if a checkpoint exists and re-applies the /hide command
 * Debounced to prevent loops when called from multiple events
 */
export async function restoreCheckpointOnLoad() {
    // Prevent concurrent executions
    if (isRestoring) {
        return;
    }
    // Clear any pending timeout and resolve the pending promise
    if (restoreTimeout) {
        clearTimeout(restoreTimeout);
        restoreTimeout = null;
    }
    if (pendingResolve) {
        pendingResolve();
        pendingResolve = null;
    }
    // Debounce: wait 100ms before actually restoring
    return new Promise((resolve) => {
        pendingResolve = resolve;
        restoreTimeout = setTimeout(async () => {
            isRestoring = true;
            try {
                const checkpointId = getChapterCheckpoint();
                if (checkpointId !== null && checkpointId !== undefined && checkpointId > 0) {
                    const context = getContext();
                    const chat = context.chat;
                    if (chat && checkpointId < chat.length) {
                        const rangeEnd = checkpointId - 1;
                        // Check if messages are already hidden
                        let needsRestore = false;
                        let hiddenCount = 0;
                        let visibleCount = 0;
                        for (let i = 0; i <= rangeEnd; i++) {
                            if (chat[i]) {
                                if (chat[i].is_system) {
                                    hiddenCount++;
                                } else {
                                    visibleCount++;
                                    needsRestore = true;
                                }
                            }
                        }
                        if (needsRestore) {
                            await executeSlashCommandsOnChatInput(`/hide 0-${rangeEnd}`, { quiet: true });
                            currentlyHiddenRange = { start: 0, end: rangeEnd };
                        } else {
                            currentlyHiddenRange = { start: 0, end: rangeEnd };
                        }
                    }
                }
            } finally {
                isRestoring = false;
                pendingResolve = null;
                resolve();
            }
        }, 100);
    });
}
