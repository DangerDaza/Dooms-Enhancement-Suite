/**
 * Doom Counter Module
 * Tension-driven plot twist system that monitors a 1-10 numeric tension scale.
 * When tension stays low (1-4) for too long, a visible countdown begins.
 * When the countdown expires, the user is prompted to generate twist options.
 *
 * Two-phase system:
 *   Phase 1 (Detection): Invisible tracking of consecutive low-tension responses.
 *   Phase 2 (Countdown): Visible countdown that ticks down faster at lower tension.
 *
 * Tension speed rules:
 *   tension 1   → countdown decrements by 3
 *   tension 2   → countdown decrements by 2
 *   tension 3-4 → countdown decrements by 1
 *   tension 5+  → resets streak entirely (story is tense enough)
 */
import { getContext } from '../../../../../../extensions.js';
import { chat } from '../../../../../../../script.js';
import { extensionSettings, lastGeneratedData, committedTrackerData } from '../../core/state.js';
import { getDoomCounterState, setDoomCounterState, saveChatData } from '../../core/persistence.js';
import { safeGenerateRaw } from '../../utils/responseExtractor.js';

// ─── Constants ────────────────────────────────────────────────────────────────

/** Prompt slot ID for twist injection */
export const DOOM_TWIST_SLOT = 'dooms-doom-counter-twist';

/** Prompt slot ID for tension scale injection */
export const DOOM_TENSION_SLOT = 'dooms-doom-counter-tension';

// ─── Tension Evaluation ───────────────────────────────────────────────────────

/**
 * Reads the numeric tension value from the last generated tracker data.
 * The Doom Counter injects its own "doomTension" field into the JSON prompt,
 * so we look for it in the parsed infoBox data.
 *
 * @returns {number|null} Tension value 1-10, or null if not found
 */
export function readTensionValue() {
    let infoBox = lastGeneratedData.infoBox;
    if (!infoBox) return null;

    // Parse if string
    if (typeof infoBox === 'string') {
        try { infoBox = JSON.parse(infoBox); } catch { return null; }
    }

    // Look for doomTension field (our custom numeric field)
    const raw = infoBox.doomTension;
    if (raw === undefined || raw === null) return null;

    // Handle {value: N} or plain number
    const num = typeof raw === 'object' ? Number(raw.value) : Number(raw);
    if (isNaN(num) || num < 1 || num > 10) return null;

    return Math.round(num);
}

/**
 * Determines the countdown decrement speed based on tension level.
 *   1   → 3 (very calm = fast countdown)
 *   2   → 2
 *   3-4 → 1
 *
 * @param {number} tension - Tension value 1-10
 * @returns {number} How much to decrement the countdown by
 */
function getCountdownSpeed(tension) {
    if (tension <= 1) return 3;
    if (tension <= 2) return 2;
    return 1; // 3-4
}

// ─── Core Logic ───────────────────────────────────────────────────────────────

/**
 * Called after each AI response. Reads tension, updates streak/countdown,
 * and determines if the Doom Counter should trigger.
 *
 * @returns {Object} Status: { triggered, countdownActive, countdownCount, lowStreakCount, tensionValue }
 */
export function onResponseReceived() {
    if (!extensionSettings.doomCounter?.enabled) {
        return { triggered: false, countdownActive: false, countdownCount: 0, lowStreakCount: 0, tensionValue: null };
    }

    const state = getDoomCounterState();
    const tension = readTensionValue();
    const dc = extensionSettings.doomCounter;
    const ceiling = dc.lowTensionCeiling || 4;

    // Already triggered or has a pending twist — don't change state, just report it.
    // This prevents re-triggering on every message while the modal is open or
    // a twist is waiting to be injected.
    if (state.triggered || state.pendingTwist) {
        return {
            triggered: state.triggered,
            countdownActive: state.countdownActive,
            countdownCount: state.countdownCount,
            lowStreakCount: state.lowStreakCount,
            tensionValue: tension
        };
    }

    // If no tension data, don't change anything
    if (tension === null) {
        setDoomCounterState(state);
        return {
            triggered: false,
            countdownActive: state.countdownActive,
            countdownCount: state.countdownCount,
            lowStreakCount: state.lowStreakCount,
            tensionValue: null
        };
    }

    // Tension is HIGH (above ceiling) → reset everything
    if (tension > ceiling) {
        state.lowStreakCount = 0;
        state.countdownActive = false;
        state.countdownCount = dc.countdownLength || 3;
        state.triggered = false;
        setDoomCounterState(state);
        return {
            triggered: false,
            countdownActive: false,
            countdownCount: state.countdownCount,
            lowStreakCount: 0,
            tensionValue: tension
        };
    }

    // Tension is LOW (at or below ceiling)
    state.lowStreakCount++;

    // Phase 1 → Phase 2 transition
    if (!state.countdownActive && state.lowStreakCount >= (dc.lowTensionThreshold || 5)) {
        state.countdownActive = true;
        state.countdownCount = dc.countdownLength || 3;
        console.log(`[Doom Counter] Countdown activated! ${state.countdownCount} messages remaining.`);
    }

    // Phase 2: countdown ticks
    if (state.countdownActive) {
        const decrement = getCountdownSpeed(tension);
        state.countdownCount = Math.max(0, state.countdownCount - decrement);
        console.log(`[Doom Counter] Countdown: ${state.countdownCount} (tension ${tension}, decrement ${decrement})`);

        if (state.countdownCount <= 0) {
            // DOOM TRIGGERED
            state.triggered = true;
            state.totalTwistsTriggered = (state.totalTwistsTriggered || 0) + 1;
            console.log(`[Doom Counter] ☠️ TRIGGERED! Total triggers: ${state.totalTwistsTriggered}`);
        }
    }

    setDoomCounterState(state);

    return {
        triggered: state.triggered,
        countdownActive: state.countdownActive,
        countdownCount: state.countdownCount,
        lowStreakCount: state.lowStreakCount,
        tensionValue: tension
    };
}

/**
 * Resets the Doom Counter to initial state.
 * Called after a twist is chosen, or manually.
 */
export function resetCounters() {
    const dc = extensionSettings.doomCounter;
    const state = getDoomCounterState();
    state.lowStreakCount = 0;
    state.countdownActive = false;
    state.countdownCount = dc?.countdownLength || 3;
    state.triggered = false;
    state.pendingTwist = null;
    setDoomCounterState(state);
}

// ─── Twist Generation ─────────────────────────────────────────────────────────

/**
 * Builds the prompt for generating twist options.
 * Uses scene context from committed tracker data + recent messages.
 *
 * @param {number} twistCount - Number of twist options to generate (2-4)
 * @returns {Array<{role: string, content: string}>} Message array for API call
 */
function buildTwistPrompt(twistCount) {
    const context = getContext();
    const chatMessages = context.chat || [];

    // Extract scene context from committed data
    let location = 'Unknown';
    let time = 'Unknown';
    let date = 'Unknown';
    let characters = [];
    let recentEvents = [];

    // Parse committed infoBox
    let infoBox = committedTrackerData.infoBox;
    if (infoBox) {
        if (typeof infoBox === 'string') {
            try { infoBox = JSON.parse(infoBox); } catch { infoBox = null; }
        }
        if (infoBox) {
            location = infoBox.location?.value || infoBox.location || 'Unknown';
            if (infoBox.time) {
                time = infoBox.time.start
                    ? `${infoBox.time.start} - ${infoBox.time.end || ''}`
                    : (infoBox.time.value || 'Unknown');
            }
            date = infoBox.date?.value || infoBox.date || 'Unknown';
            if (Array.isArray(infoBox.recentEvents)) {
                recentEvents = infoBox.recentEvents;
            }
        }
    }

    // Parse committed characters
    let charData = committedTrackerData.characterThoughts;
    if (charData) {
        if (typeof charData === 'string') {
            try { charData = JSON.parse(charData); } catch { charData = null; }
        }
        if (charData) {
            const arr = Array.isArray(charData) ? charData : (charData.characters || []);
            characters = arr.map(c => c.name).filter(Boolean);
        }
    }

    // Get last 5 messages for context
    const recentChat = chatMessages.slice(-5).map(m => {
        const role = m.is_user ? 'User' : (m.name || 'Character');
        const text = (m.mes || '').substring(0, 200);
        return `${role}: ${text}`;
    }).join('\n');

    const systemPrompt = `You are a creative plot twist generator for a roleplay story. The story has been calm for a while and needs a dramatic shake-up. Based on the current scene, generate exactly ${twistCount} plot twist options.

Current scene:
- Location: ${location}
- Time: ${time}
- Date: ${date}
- Characters present: ${characters.length > 0 ? characters.join(', ') : 'Unknown'}
- Recent events: ${recentEvents.length > 0 ? recentEvents.join('; ') : 'None noted'}

Recent conversation:
${recentChat}

Return ONLY a JSON array with exactly ${twistCount} objects:
[
  {"emoji": "🌀", "title": "Short 3-5 word title", "description": "2-3 sentence description of the twist and how it disrupts the current calm"},
  ...
]

Rules:
- Twists must be plausible given the current scene and characters
- Each twist should be a DIFFERENT type (interpersonal, environmental, revelation, arrival, threat, etc.)
- Twists should be dramatic but not story-breaking
- The goal is to shake the story out of a lull, not destroy it`;

    return [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Generate ${twistCount} plot twist options for this scene.` }
    ];
}

/**
 * Generates twist options via a separate API call.
 *
 * @param {number} [count] - Number of twists to generate (defaults to settings)
 * @returns {Promise<Array<{emoji: string, title: string, description: string}>>} Array of twist options
 */
export async function generateTwistOptions(count) {
    const twistCount = count || extensionSettings.doomCounter?.twistChoiceCount || 3;
    const prompt = buildTwistPrompt(twistCount);

    try {
        const response = await safeGenerateRaw({
            prompt: prompt,
            quietToLoud: false
        });

        if (!response) {
            throw new Error('No response from API');
        }

        // Extract JSON array from response
        const jsonMatch = response.match(/\[[\s\S]*\]/);
        if (!jsonMatch) {
            throw new Error('No JSON array found in response');
        }

        const twists = JSON.parse(jsonMatch[0]);
        if (!Array.isArray(twists) || twists.length === 0) {
            throw new Error('Invalid twist data returned');
        }

        // Validate and clean each twist
        return twists.slice(0, twistCount).map((t, i) => ({
            emoji: t.emoji || '🎲',
            title: t.title || `Twist ${i + 1}`,
            description: t.description || 'An unexpected turn of events...'
        }));
    } catch (error) {
        console.error('[Doom Counter] Error generating twists:', error);
        // Return fallback twists so the modal still shows
        return [
            { emoji: '⚡', title: 'Sudden Confrontation', description: 'An unexpected challenge emerges from the shadows, forcing the characters to react.' },
            { emoji: '🔮', title: 'Hidden Revelation', description: 'A secret comes to light that changes everything about the current situation.' },
            { emoji: '🌪️', title: 'Environmental Chaos', description: 'The world around the characters shifts dramatically, creating new urgency.' }
        ].slice(0, twistCount);
    }
}

// ─── Twist Modal ──────────────────────────────────────────────────────────────

/**
 * Shows the twist selection modal with clickable cards.
 * User MUST pick a twist — there is no cancel option.
 *
 * @param {Array<{emoji: string, title: string, description: string}>} twists - The twist options
 * @returns {Promise<string>} The chosen twist description
 */
export function showTwistModal(twists) {
    return new Promise((resolve) => {
        // Build card HTML
        const cardsHtml = twists.map((twist, index) => `
            <div class="dooms-dc-card" data-index="${index}" tabindex="0">
                <div class="dooms-dc-card-emoji">${twist.emoji}</div>
                <div class="dooms-dc-card-title">${twist.title}</div>
                <div class="dooms-dc-card-desc">${twist.description}</div>
            </div>
        `).join('');

        const modalHtml = `
            <div class="dooms-dc-modal">
                <div class="dooms-dc-header">
                    <i class="fa-solid fa-skull"></i> The Doom Counter has triggered...
                </div>
                <div class="dooms-dc-subtitle">The calm has lasted too long. Choose your fate:</div>
                <div class="dooms-dc-cards">
                    ${cardsHtml}
                </div>
            </div>
        `;

        // Use SillyTavern's Popup (callGenericPopup) for the modal
        // We create a custom popup with no buttons — user must click a card
        const $modal = $(modalHtml);

        // Create popup dialog
        const $dialog = $('<div class="dooms-dc-dialog"></div>');
        $dialog.append($modal);
        $('body').append($dialog);

        // Add overlay
        const $overlay = $('<div class="dooms-dc-overlay"></div>');
        $('body').append($overlay);

        // Card click handlers
        $dialog.on('click', '.dooms-dc-card', function () {
            const index = parseInt($(this).data('index'));
            const chosen = twists[index];

            // Visual feedback
            $(this).addClass('dooms-dc-card-selected');
            $dialog.find('.dooms-dc-card').not(this).addClass('dooms-dc-card-dimmed');

            // Close after brief animation
            setTimeout(() => {
                $overlay.remove();
                $dialog.remove();
                resolve(chosen.description);
            }, 400);
        });

        // Keyboard support
        $dialog.on('keydown', '.dooms-dc-card', function (e) {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                $(this).trigger('click');
            }
        });
    });
}

// ─── Orchestration ────────────────────────────────────────────────────────────

/** Guard flag — prevents the modal from being opened multiple times concurrently. */
let _triggerInProgress = false;

/**
 * Returns whether a trigger is currently in progress (modal open / twists generating).
 * @returns {boolean}
 */
export function isTriggerInProgress() {
    return _triggerInProgress;
}

/**
 * Main trigger flow: show loading modal immediately → generate twists → swap in cards → store pending twist.
 * Called when the Doom Counter triggers naturally or via "Trigger Now" button.
 *
 * The modal appears instantly so the user sees feedback right away.
 * The loading spinner is replaced with twist cards once the API responds.
 *
 * @returns {Promise<void>}
 */
export async function triggerDoomCounter() {
    const dc = extensionSettings.doomCounter;
    if (!dc) return;

    // Prevent concurrent triggers (e.g. rapid clicks or re-trigger on next message)
    if (_triggerInProgress) {
        console.log('[Doom Counter] Trigger already in progress, skipping.');
        return;
    }
    _triggerInProgress = true;

    // ── Show overlay + modal shell immediately (loading state) ──────────────
    const $overlay = $('<div class="dooms-dc-overlay"></div>');
    const $dialog = $(`
        <div class="dooms-dc-dialog">
            <div class="dooms-dc-modal">
                <div class="dooms-dc-header">
                    <i class="fa-solid fa-skull"></i> The Doom Counter has triggered...
                </div>
                <div class="dooms-dc-subtitle">The calm has lasted too long. Consulting the fates...</div>
                <div class="dooms-dc-loading">
                    <div class="dooms-dc-loading-icon"><i class="fa-solid fa-skull"></i></div>
                    <div class="dooms-dc-loading-dots">
                        <span></span><span></span><span></span>
                    </div>
                    <div class="dooms-dc-loading-label">Generating twists...</div>
                </div>
            </div>
        </div>
    `);
    $('body').append($overlay);
    $('body').append($dialog);

    try {
        console.log('[Doom Counter] Generating twist options...');

        // Generate while loading state is visible
        const twists = await generateTwistOptions(dc.twistChoiceCount || 3);

        // ── Swap loading content for twist cards ────────────────────────────
        const cardsHtml = twists.map((twist, index) => `
            <div class="dooms-dc-card" data-index="${index}" tabindex="0">
                <div class="dooms-dc-card-emoji">${twist.emoji}</div>
                <div class="dooms-dc-card-title">${twist.title}</div>
                <div class="dooms-dc-card-desc">${twist.description}</div>
            </div>
        `).join('');

        const $modal = $dialog.find('.dooms-dc-modal');
        $modal.find('.dooms-dc-loading').remove();
        $modal.find('.dooms-dc-subtitle').text('Choose your fate:');
        $modal.append(`<div class="dooms-dc-cards dooms-dc-cards-enter">${cardsHtml}</div>`);

        // Remove enter class after animation fires
        setTimeout(() => $modal.find('.dooms-dc-cards').removeClass('dooms-dc-cards-enter'), 400);

        // ── Wait for user to pick a card ────────────────────────────────────
        const chosenTwist = await new Promise((resolve) => {
            $dialog.on('click', '.dooms-dc-card', function () {
                const index = parseInt($(this).data('index'));
                const chosen = twists[index];

                $(this).addClass('dooms-dc-card-selected');
                $dialog.find('.dooms-dc-card').not(this).addClass('dooms-dc-card-dimmed');

                setTimeout(() => {
                    $overlay.remove();
                    $dialog.remove();
                    resolve(chosen.description);
                }, 400);
            });

            $dialog.on('keydown', '.dooms-dc-card', function (e) {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    $(this).trigger('click');
                }
            });
        });

        // Store the chosen twist for injection on next generation
        const state = getDoomCounterState();
        state.pendingTwist = chosenTwist;
        state.triggered = false;
        state.lowStreakCount = 0;
        state.countdownActive = false;
        state.countdownCount = dc.countdownLength || 3;
        setDoomCounterState(state);

        console.log(`[Doom Counter] Twist chosen: "${chosenTwist}"`);
        toastr.success('Twist selected! It will be woven into the next AI response.', '', { timeOut: 4000 });

        // Update the settings panel display
        updateDoomCounterUI();
    } catch (error) {
        $overlay.remove();
        $dialog.remove();
        console.error('[Doom Counter] Error during trigger flow:', error);
        toastr.error('Failed to generate twists. Try again or use Trigger Now in settings.', '☠️ Doom Counter Error', { timeOut: 5000 });
    } finally {
        _triggerInProgress = false;
    }
}

/**
 * Checks if there is a pending twist waiting to be injected.
 * Called by injector.js during onGenerationStarted.
 *
 * @returns {string|null} The pending twist text, or null
 */
export function getPendingTwist() {
    const state = getDoomCounterState();
    return state.pendingTwist || null;
}

/**
 * Clears the pending twist after it has been injected.
 * Called by injector.js after injection.
 */
export function clearPendingTwist() {
    const state = getDoomCounterState();
    state.pendingTwist = null;
    setDoomCounterState(state);
}

// ─── Tension Prompt Injection ─────────────────────────────────────────────────

/**
 * Builds the JSON instruction fragment for the doomTension field.
 * This gets appended to the tracker instructions so the AI generates
 * a numeric tension value alongside its normal tracker data.
 *
 * @returns {string} JSON instruction fragment for doomTension
 */
export function buildDoomTensionInstruction() {
    return '  "doomTension": <number 1-10 rating the current scene tension. 1=completely calm/peaceful/boring, 5=moderate tension/anticipation, 10=extreme danger/conflict/crisis>';
}

// ─── UI Updates ───────────────────────────────────────────────────────────────

/**
 * Updates the Doom Counter display in the settings panel.
 * Shows current streak, countdown status, and trigger state.
 * Also refreshes the floating debug HUD if debug mode is on.
 */
export function updateDoomCounterUI() {
    const dc = extensionSettings.doomCounter;
    if (!dc?.enabled) {
        $('#rpg-dc-status').text('Disabled');
        $('#rpg-dc-streak').text('0');
        $('#rpg-dc-countdown-display').hide();
        hideDoomDebugHud();
        return;
    }

    const state = getDoomCounterState();
    const threshold = dc.lowTensionThreshold || 5;

    // Update streak display
    $('#rpg-dc-streak').text(state.lowStreakCount);
    $('#rpg-dc-streak-max').text(threshold);

    // Update status
    if (state.pendingTwist) {
        $('#rpg-dc-status').html('<span style="color: #f0c040;">⚡ Twist pending injection</span>');
    } else if (state.triggered) {
        $('#rpg-dc-status').html('<span style="color: #e94560;">☠️ TRIGGERED — Generate twists!</span>');
    } else if (state.countdownActive) {
        $('#rpg-dc-status').html(`<span style="color: #f0c040;">⏳ Countdown active</span>`);
        $('#rpg-dc-countdown-display').show();
        $('#rpg-dc-countdown-current').text(state.countdownCount);
    } else {
        $('#rpg-dc-status').text('Monitoring...');
        $('#rpg-dc-countdown-display').hide();
    }

    // Update badge
    $('#rpg-dc-badge').text(dc.enabled ? 'on' : 'off');

    // Sync floating debug HUD
    updateDoomDebugHud();
}

// ─── Floating Debug HUD ───────────────────────────────────────────────────────

/**
 * Creates or updates the floating Doom Counter debug HUD.
 * Visible in the bottom-right corner whenever debug mode is active.
 * Shows live tension, streak, countdown, and status — persists between messages.
 */
export function updateDoomDebugHud() {
    const dc = extensionSettings.doomCounter;
    if (!dc?.enabled || !dc?.debugDisplay) {
        hideDoomDebugHud();
        return;
    }

    const state = getDoomCounterState();
    const tension = readTensionValue();
    const threshold = dc.lowTensionThreshold ?? 5;
    const ceiling = dc.lowTensionCeiling ?? 4;

    // Determine status
    let statusClass = 'monitoring';
    let statusText = 'Monitoring';
    if (state.pendingTwist) {
        statusClass = 'pending';
        statusText = '⚡ Pending injection';
    } else if (state.triggered) {
        statusClass = 'triggered';
        statusText = '☠️ Triggered!';
    } else if (state.countdownActive) {
        statusClass = 'countdown';
        statusText = `⏳ Countdown`;
    }

    // Tension color class
    const tensionClass = tension === null ? '' : (tension <= ceiling ? 'low' : 'high');
    const tensionStr = tension !== null ? `${tension}/10` : '?/10';

    // Create HUD element if it doesn't exist yet
    let $hud = $('#dooms-dc-debug-hud');
    if (!$hud.length) {
        $hud = $('<div id="dooms-dc-debug-hud" class="dooms-dc-debug-hud"></div>');
        $('body').append($hud);
    }

    $hud.attr('data-status', statusClass).html(`
        <div class="dooms-dc-hud-header">
            <i class="fa-solid fa-skull"></i>
            <span class="dooms-dc-hud-title">Doom Counter</span>
            <span class="dooms-dc-hud-dot"></span>
        </div>
        <div class="dooms-dc-hud-rows">
            <div class="dooms-dc-hud-row">
                <span class="dooms-dc-hud-lbl">Tension</span>
                <span class="dooms-dc-hud-val dooms-dc-hud-tension-${tensionClass}">${tensionStr}</span>
            </div>
            <div class="dooms-dc-hud-row">
                <span class="dooms-dc-hud-lbl">Streak</span>
                <span class="dooms-dc-hud-val">${state.lowStreakCount} / ${threshold}</span>
            </div>
            ${state.countdownActive ? `
            <div class="dooms-dc-hud-row">
                <span class="dooms-dc-hud-lbl">Countdown</span>
                <span class="dooms-dc-hud-val dooms-dc-hud-countdown">${state.countdownCount}</span>
            </div>` : ''}
            <div class="dooms-dc-hud-row dooms-dc-hud-status-row">
                <span class="dooms-dc-hud-status-text">${statusText}</span>
            </div>
        </div>
    `);
}

/**
 * Removes the floating debug HUD from the DOM.
 */
export function hideDoomDebugHud() {
    $('#dooms-dc-debug-hud').remove();
}
