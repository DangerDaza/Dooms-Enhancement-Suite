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
import { extensionSettings, lastGeneratedData, committedTrackerData } from '../../core/state.js';
import { getDoomCounterState, setDoomCounterState, isDoomKnivesEnabled, saveSettings } from '../../core/persistence.js';
import { safeGenerateRaw } from '../../utils/responseExtractor.js';
import { DEFAULT_TWIST_GENERATOR_RULES_PROMPT, DEFAULT_KNIFE_GENERATOR_RULES_PROMPT } from '../ui/promptsEditor.js';
import { escapeHtml } from '../../utils/html.js';
import { repairJSON } from '../../utils/jsonRepair.js';

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
    state.pendingTwistIsKnife = false;
    state.pendingKnifeCharacter = null;
    setDoomCounterState(state);
    // Remove any twist banners from the chat DOM
    $('.dooms-dc-inline').remove();
}

// ─── Knives ───────────────────────────────────────────────────────────────────
// Knives are story beats written in advance and attached to CHARACTERS in the
// Character Workshop — secrets, debts, rivals waiting in the wings. When the
// Doom Counter triggers (and Knives are enabled for the chat), one present
// character with armed knives is chosen at random and their knives are offered
// instead of AI-generated twists. NPC knives live in
// extensionSettings.characterKnives[name]; user-persona knives live on
// extensionSettings.userCharacters[name].knives.

/** Short card title for a knife — the first few words of its text. */
function knifeCardTitle(text) {
    const words = String(text).trim().split(/\s+/);
    return words.length <= 6 ? words.join(' ') : words.slice(0, 6).join(' ') + '…';
}

/** Filters a knife list down to armed (unused, non-empty) knives. */
function armedKnivesOf(list) {
    return Array.isArray(list) ? list.filter(k => k && !k.used && k.text) : [];
}

/**
 * Gathers the characters currently in the scene that hold armed knives.
 * Present NPCs come from the latest characterThoughts tracker data; the
 * player's active persona is always considered present.
 *
 * @returns {Array<{characterName: string, isUser: boolean, knives: Array}>}
 */
export function getSceneKnifeCandidates() {
    if (!isDoomKnivesEnabled()) return [];
    const candidates = [];

    // Present NPCs from the latest tracker data
    const presentLower = new Set();
    let charData = lastGeneratedData.characterThoughts || committedTrackerData.characterThoughts;
    if (charData) {
        if (typeof charData === 'string') {
            try { charData = JSON.parse(charData); } catch { charData = null; }
        }
        if (charData) {
            const arr = Array.isArray(charData) ? charData : (charData.characters || []);
            for (const c of arr) {
                if (c?.name && c.present !== false) presentLower.add(String(c.name).toLowerCase());
            }
        }
    }
    const knifeMap = extensionSettings.characterKnives || {};
    for (const [name, knives] of Object.entries(knifeMap)) {
        if (!presentLower.has(name.toLowerCase())) continue;
        const armed = armedKnivesOf(knives);
        if (armed.length) candidates.push({ characterName: name, isUser: false, knives: armed });
    }

    // The player's persona is always in the scene
    const userChars = extensionSettings.userCharacters || {};
    let activeName = extensionSettings.activeUserCharacter;
    if (!activeName) {
        try { activeName = getContext().name1; } catch { activeName = null; }
    }
    if (activeName) {
        const lower = String(activeName).toLowerCase();
        const key = Object.keys(userChars).find(k => k.toLowerCase() === lower);
        if (key) {
            const armed = armedKnivesOf(userChars[key].knives);
            if (armed.length) candidates.push({ characterName: key, isUser: true, knives: armed });
        }
    }

    return candidates;
}

/**
 * Marks one of a character's knives as used (spent).
 * @param {string} characterName - The knife owner's name
 * @param {string} knifeId - The knife id
 * @param {boolean} isUser - True if the owner is a user persona
 */
export function markCharacterKnifeUsed(characterName, knifeId, isUser) {
    const spend = (list) => list.map(k => k.id === knifeId ? { ...k, used: true } : k);
    if (isUser) {
        const u = extensionSettings.userCharacters?.[characterName];
        if (u && Array.isArray(u.knives)) {
            u.knives = spend(u.knives);
            saveSettings();
        }
    } else {
        const map = extensionSettings.characterKnives;
        if (map && Array.isArray(map[characterName])) {
            map[characterName] = spend(map[characterName]);
            saveSettings();
        }
    }
}

/**
 * Generates knife suggestions for a character via a separate API call.
 * Used by the Character Workshop's "Generate Knives" button — the player
 * picks which suggestions to keep, so this returns plain texts.
 *
 * @param {string} characterName - The character to write knives for
 * @param {Object} [options]
 * @param {boolean} [options.isUser=false] - True if the owner is a user persona
 * @param {number} [options.count=5] - Number of suggestions to generate
 * @param {Array<string>} [options.existingKnives=[]] - Knife texts to avoid duplicating
 * @param {{label: string, guidance: string}|null} [options.theme=null] - Style/theme steering the batch
 * @returns {Promise<Array<string>>} Suggested knife texts
 */
export async function generateKnifeSuggestions(characterName, { isUser = false, count = 5, existingKnives = [], theme = null } = {}) {
    const context = getContext();
    const playerName = context.name1 || 'the player';

    // Pull what we know about the character from their Workshop record
    let description = '';
    let relationship = '';
    if (isUser) {
        description = extensionSettings.userCharacters?.[characterName]?.injection?.description || '';
    } else {
        description = extensionSettings.characterInjection?.[characterName]?.description || '';
        relationship = extensionSettings.characterRelationships?.[characterName] || '';
    }

    // Recent conversation for tone/setting (same budget as the twist generator)
    const dc = extensionSettings.doomCounter || {};
    const contextMessages = dc.twistContextMessages || 15;
    const messageTruncation = dc.twistMessageTruncation || 1200;
    const chatMessages = context.chat || [];
    const recentChat = chatMessages.slice(-contextMessages).map(m => {
        const role = m.is_user ? playerName : (m.name || 'AI');
        return `${role}: ${(m.mes || '').substring(0, messageTruncation)}`;
    }).join('\n');

    // Theme guidance may reference the player via {{user}} — resolve it to
    // the actual name so the AI targets the right person.
    const themeLine = theme?.guidance
        ? `- Theme: ${theme.label}. ${theme.guidance.replace(/\{\{user\}\}/g, playerName)}`
        : '- Vary the type across the options: debts, secrets, old flames, rivals, regrets, lucky breaks';

    // Requirements are user-editable (Prompts Editor → Knife Generator Rules);
    // {character} resolves to the knife owner's name.
    const rulesText = (extensionSettings.customKnifeGeneratorRulesPrompt || DEFAULT_KNIFE_GENERATOR_RULES_PROMPT)
        .replace(/\{character\}/g, characterName);

    const systemPrompt = `You are generating "Knives" for a roleplay story. A Knife is a pre-planned story beat tied to one character: a secret, debt, grudge, obligation, or unresolved past that lies dormant until the story needs drama, then resurfaces with consequences.

Write knives for this character:
- Name: ${characterName}${isUser ? ` (the player's own character; the player is ${playerName})` : ''}
${relationship ? `- Relationship to ${playerName}: ${relationship}\n` : ''}${description ? `- Description: ${description}\n` : ''}
${existingKnives.length ? `Existing knives — do NOT duplicate or rephrase these:\n${existingKnives.map(t => `  • ${t}`).join('\n')}\n` : ''}
Recent conversation (for tone and setting):
${recentChat || '(no messages yet)'}

Requirements:
${themeLine}
${rulesText}

Return ONLY a JSON array of exactly ${count} strings.`;

    const response = await safeGenerateRaw({
        prompt: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: `Generate ${count} knives for ${characterName}.` }
        ],
        quietToLoud: false
    });
    if (!response) throw new Error('No response from API');

    const jsonMatch = response.match(/\[[\s\S]*\]/);
    if (!jsonMatch) throw new Error('No JSON array found in response');

    // repairJSON tolerates markdown fences, thinking tags, and trailing
    // commas; it returns null on unrecoverable input, which fails the
    // Array.isArray check below and keeps the caller's error path intact.
    const parsed = repairJSON(jsonMatch[0]);
    if (!Array.isArray(parsed)) throw new Error('Invalid knife data returned');

    return parsed
        .map(item => typeof item === 'string' ? item : (item?.text || item?.description || ''))
        .map(t => String(t).trim())
        .filter(Boolean)
        .slice(0, count);
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

    // ── Player & AI character identity ──
    const playerName = context.name1 || 'the player';
    const aiCharName = context.name2 || 'the character';

    // ── Scene context from FRESH tracker data (lastGeneratedData has the latest state) ──
    let location = 'Unknown';
    let time = 'Unknown';
    let date = 'Unknown';
    let recentEvents = [];
    let tension = 'low';

    let infoBox = lastGeneratedData.infoBox || committedTrackerData.infoBox;
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
            tension = infoBox.tension?.value || infoBox.tension || 'low';
        }
    }

    // ── Rich character data (name, relationship, thoughts, presence) ──
    let characterSummaries = [];
    let charData = lastGeneratedData.characterThoughts || committedTrackerData.characterThoughts;
    if (charData) {
        if (typeof charData === 'string') {
            try { charData = JSON.parse(charData); } catch { charData = null; }
        }
        if (charData) {
            const arr = Array.isArray(charData) ? charData : (charData.characters || []);
            characterSummaries = arr.filter(c => c.name).map(c => {
                const parts = [c.name];
                // Relationship to player
                const rel = c.Relationship || c.relationship?.status || c.relationship;
                if (rel) parts.push(`(${rel} to ${playerName})`);
                // Present or absent
                if (c.present === false) parts.push('[absent]');
                // Current thoughts if available
                const thoughts = c.thoughts?.content || c.thoughts;
                if (thoughts) parts.push(`— thinking: "${thoughts}"`);
                return parts.join(' ');
            });
        }
    }

    // ── Recent conversation (configurable message count and truncation) ──
    const dc = extensionSettings.doomCounter || {};
    const contextMessages = dc.twistContextMessages || 15;
    const messageTruncation = dc.twistMessageTruncation || 1200;
    const recentChat = chatMessages.slice(-contextMessages).map(m => {
        const role = m.is_user ? playerName : (m.name || aiCharName);
        const text = (m.mes || '').substring(0, messageTruncation);
        return `${role}: ${text}`;
    }).join('\n');

    const systemPrompt = `You are a creative plot twist generator for an ongoing roleplay story. The story has been calm for several exchanges and could use something unexpected to shift the dynamic.

CRITICAL — Character knowledge:
- The PLAYER CHARACTER is named "${playerName}" — they are already in the story, do NOT introduce them as a new or unknown character.
- The main AI character is "${aiCharName}" — also already established in the story.
- The following characters are ALREADY ESTABLISHED in this story. Do NOT treat any of them as strangers or newcomers:
${characterSummaries.length > 0 ? characterSummaries.map(s => `  • ${s}`).join('\n') : '  (No character data available)'}

Current scene:
- Location: ${location}
- Time: ${time}
- Date: ${date}
- Tension level: ${tension}
- Recent events: ${recentEvents.length > 0 ? recentEvents.join('; ') : 'None noted'}

Recent conversation:
${recentChat}

Return ONLY a JSON array with exactly ${twistCount} objects:
[
  {"emoji": "🌀", "title": "Short 3-5 word title", "description": "2-3 sentence description of what happens and how it changes the scene dynamic"}
]

${extensionSettings.customTwistGeneratorRulesPrompt || DEFAULT_TWIST_GENERATOR_RULES_PROMPT}`;

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

        const twists = repairJSON(jsonMatch[0]);
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
 * Main trigger flow: inject inline twist element into chat → generate twists → show cards → store pending twist.
 * Called when the Doom Counter triggers naturally or via "Trigger Now" button.
 *
 * The inline element appears at the bottom of chat so the user can still read
 * the last message while choosing a twist.
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

    // ── Trap Mode: silent trigger, 1 twist, auto-inject ──────────────
    if (dc.trapMode) {
        try {
            // Character knives take priority: one present character with armed
            // knives is chosen at random, then one of their knives.
            const candidates = getSceneKnifeCandidates();
            let chosenText;
            let isKnife = false;
            let knifeCharacter = null;
            if (candidates.length > 0) {
                const owner = candidates[Math.floor(Math.random() * candidates.length)];
                const knife = owner.knives[Math.floor(Math.random() * owner.knives.length)];
                markCharacterKnifeUsed(owner.characterName, knife.id, owner.isUser);
                chosenText = knife.text;
                isKnife = true;
                knifeCharacter = owner.characterName;
                console.log(`[Doom Counter] Trap mode: one of ${owner.characterName}'s knives was silently drawn.`);
            } else {
                console.log('[Doom Counter] Trap mode triggered — generating silent twist...');
                const twists = await generateTwistOptions(1);
                if (!twists || twists.length === 0) {
                    console.warn('[Doom Counter] Trap mode: no twists generated.');
                    return;
                }
                chosenText = twists[0].description;
                console.log(`[Doom Counter] Trap mode twist silently injected: "${twists[0].title}"`);
            }

            const state = getDoomCounterState();
            state.pendingTwist = chosenText;
            state.pendingTwistIsKnife = isKnife;
            state.pendingKnifeCharacter = knifeCharacter;
            state.triggered = false;
            state.lowStreakCount = 0;
            state.countdownActive = false;
            state.countdownCount = dc.countdownLength || 3;
            setDoomCounterState(state);

            updateDoomCounterUI();
        } catch (error) {
            console.error('[Doom Counter] Trap mode error:', error);
        } finally {
            _triggerInProgress = false;
        }
        return;
    }

    // ── Normal Mode: visible trigger with card selection ──────────────
    const $inline = $(`
        <div class="dooms-dc-inline">
            <div class="dooms-dc-inline-header">
                <i class="fa-solid fa-skull"></i>
                <span>The Doom Counter has triggered...</span>
            </div>
            <div class="dooms-dc-inline-body">
                <div class="dooms-dc-loading">
                    <div class="dooms-dc-loading-dots">
                        <span></span><span></span><span></span>
                    </div>
                    <div class="dooms-dc-loading-label">Consulting the fates...</div>
                </div>
            </div>
        </div>
    `);

    const $chat = $('#chat');
    $chat.append($inline);

    // Scroll chat to bottom so the inline element is visible
    const chatEl = $chat[0];
    if (chatEl) {
        chatEl.scrollTop = chatEl.scrollHeight;
    }

    try {
        const $body = $inline.find('.dooms-dc-inline-body');

        const renderLoading = () => {
            $inline.find('.dooms-dc-inline-header span').text('The Doom Counter has triggered...');
            $body.html(`
                <div class="dooms-dc-loading">
                    <div class="dooms-dc-loading-dots">
                        <span></span><span></span><span></span>
                    </div>
                    <div class="dooms-dc-loading-label">Consulting the fates...</div>
                </div>
            `);
        };

        // mode: 'knives' (one character's pre-planted story beats) or 'twists' (AI-generated)
        const renderCards = (cards, mode, knifeOwnerName) => {
            const cardsHtml = cards.map((card, index) => `
                <div class="dooms-dc-card${card.knifeId ? ' dooms-dc-card-knife' : ''}" data-index="${index}" tabindex="0">
                    <div class="dooms-dc-card-emoji">${escapeHtml(card.emoji)}</div>
                    <div class="dooms-dc-card-title">${escapeHtml(card.title)}</div>
                    <div class="dooms-dc-card-desc">${escapeHtml(card.description)}</div>
                </div>
            `).join('');

            $body.empty();
            $inline.find('.dooms-dc-inline-header span').text(mode === 'knives'
                ? `${knifeOwnerName}'s knives are drawn — choose:`
                : 'Choose your fate:');
            $body.append(`<div class="dooms-dc-cards dooms-dc-cards-enter">${cardsHtml}</div>`);
            const altAction = mode === 'knives'
                ? `<button type="button" class="dooms-dc-action-btn dooms-dc-generate">
                       <i class="fa-solid fa-dice"></i> Generate twists instead
                   </button>`
                : `<button type="button" class="dooms-dc-action-btn dooms-dc-reroll">
                       <i class="fa-solid fa-dice"></i> Reroll
                   </button>`;
            $body.append(`
                <div class="dooms-dc-actions">
                    ${altAction}
                    <button type="button" class="dooms-dc-action-btn dooms-dc-cancel">
                        <i class="fa-solid fa-xmark"></i> Cancel
                    </button>
                </div>
            `);

            // Remove enter class after animation fires
            setTimeout(() => $body.find('.dooms-dc-cards').removeClass('dooms-dc-cards-enter'), 400);

            // Scroll to show the cards
            if (chatEl) {
                chatEl.scrollTop = chatEl.scrollHeight;
            }
        };

        // Character knives take priority — one present character with armed
        // knives is chosen at random and their knives are offered (no API call).
        const candidates = getSceneKnifeCandidates();
        let currentCards;
        if (candidates.length > 0) {
            const owner = candidates[Math.floor(Math.random() * candidates.length)];
            console.log(`[Doom Counter] ${owner.characterName} drew their knives (${owner.knives.length} armed, ${candidates.length} candidate characters).`);
            currentCards = owner.knives.map(k => ({
                emoji: '🔪',
                title: knifeCardTitle(k.text),
                description: k.text,
                knifeId: k.id,
                knifeOwner: owner.characterName,
                knifeOwnerIsUser: owner.isUser
            }));
            renderCards(currentCards, 'knives', owner.characterName);
        } else {
            console.log('[Doom Counter] Generating twist options...');
            currentCards = await generateTwistOptions(dc.twistChoiceCount || 3);
            renderCards(currentCards, 'twists');
        }

        // ── Wait for user to pick a card, reroll/generate, or cancel ────────
        let generating = false;
        const chosen = await new Promise((resolve) => {
            $inline.on('click', '.dooms-dc-card', function () {
                if (generating) return;
                const index = parseInt($(this).data('index'));
                const card = currentCards[index];

                $(this).addClass('dooms-dc-card-selected');
                $inline.find('.dooms-dc-card').not(this).addClass('dooms-dc-card-dimmed');
                $inline.find('.dooms-dc-actions').remove();

                // Collapse to a compact "chosen" summary after a brief pause
                setTimeout(() => {
                    $inline.find('.dooms-dc-inline-header span').text(card.knifeId ? `${card.knifeOwner}'s knife is drawn` : 'Twist selected');
                    $body.html(`
                        <div class="dooms-dc-chosen">
                            <span class="dooms-dc-chosen-emoji">${escapeHtml(card.emoji)}</span>
                            <span class="dooms-dc-chosen-title">${escapeHtml(card.title)}</span>
                            <span class="dooms-dc-chosen-hint">— will be woven into the next response</span>
                        </div>
                    `);
                    $inline.addClass('dooms-dc-inline-resolved');
                    resolve(card);
                }, 500);
            });

            $inline.on('keydown', '.dooms-dc-card', function (e) {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    $(this).trigger('click');
                }
            });

            // Reroll (twist view) and "Generate twists instead" (knife view)
            // both swap in a fresh set of AI-generated twists.
            $inline.on('click', '.dooms-dc-reroll, .dooms-dc-generate', async function () {
                if (generating) return;
                generating = true;
                try {
                    console.log('[Doom Counter] Generating twist options...');
                    renderLoading();
                    currentCards = await generateTwistOptions(dc.twistChoiceCount || 3);
                    renderCards(currentCards, 'twists');
                } finally {
                    generating = false;
                }
            });

            $inline.on('click', '.dooms-dc-cancel', function () {
                if (generating) return;
                resolve(null);
            });
        });

        // ── Cancelled: dismiss without a twist and reset the counter ────────
        if (chosen === null) {
            console.log('[Doom Counter] Twist selection cancelled by user.');
            resetCounters();
            updateDoomCounterUI();
            return;
        }

        // A chosen knife is spent — mark it used so it isn't offered again
        if (chosen.knifeId) {
            markCharacterKnifeUsed(chosen.knifeOwner, chosen.knifeId, chosen.knifeOwnerIsUser);
        }

        // Store the chosen twist/knife for injection on next generation
        const state = getDoomCounterState();
        state.pendingTwist = chosen.description;
        state.pendingTwistIsKnife = !!chosen.knifeId;
        state.pendingKnifeCharacter = chosen.knifeId ? chosen.knifeOwner : null;
        state.triggered = false;
        state.lowStreakCount = 0;
        state.countdownActive = false;
        state.countdownCount = dc.countdownLength || 3;
        setDoomCounterState(state);

        console.log(`[Doom Counter] ${chosen.knifeId ? 'Knife' : 'Twist'} chosen: "${chosen.description}"`);

        // Update the settings panel display
        updateDoomCounterUI();
    } catch (error) {
        $inline.remove();
        console.error('[Doom Counter] Error during trigger flow:', error);
        toastr.error('Failed to generate twists. Try again or use Trigger Now in settings.', '', { timeOut: 5000 });
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
 * Whether the pending twist is a player-authored Knife (vs an AI-generated twist).
 * Determines which injection template the injector wraps it in.
 * Must be read BEFORE clearPendingTwist(), which resets the flag.
 *
 * @returns {boolean}
 */
export function isPendingTwistAKnife() {
    const state = getDoomCounterState();
    return !!state.pendingTwistIsKnife;
}

/**
 * Name of the character whose knife is pending injection, or null.
 * Used by the injector to fill the {character} placeholder in the knife
 * template. Must be read BEFORE clearPendingTwist(), which resets it.
 *
 * @returns {string|null}
 */
export function getPendingKnifeCharacter() {
    const state = getDoomCounterState();
    return state.pendingKnifeCharacter || null;
}

/**
 * Clears the pending twist after it has been injected.
 * Called by injector.js after injection.
 */
/** Flag set when a trap mode twist is being injected into the next generation */
let _trapTwistPending = false;

export function isTrapTwistPending() {
    return _trapTwistPending;
}

export function clearTrapTwistFlag() {
    _trapTwistPending = false;
}

export function clearPendingTwist() {
    const state = getDoomCounterState();
    // If this was a trap mode twist, set the flag so the next message shows a badge
    if (state.pendingTwist && extensionSettings.doomCounter?.trapMode) {
        _trapTwistPending = true;
    }
    state.pendingTwist = null;
    state.pendingTwistIsKnife = false;
    state.pendingKnifeCharacter = null;
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
    // Keep the per-chat Knives toggle in sync (chat switches change it)
    $('#rpg-dc-knives-enabled').prop('checked', isDoomKnivesEnabled());
    if (!dc?.enabled) {
        $('#rpg-dc-status').text('Disabled');
        $('#rpg-dc-streak').text('0');
        $('#rpg-dc-countdown-display').hide();
        hideDoomDebugHud();
        return;
    }

    const state = getDoomCounterState();
    const threshold = dc.lowTensionThreshold || 5;

    // Trap mode: hide all status indicators
    if (dc.trapMode) {
        $('#rpg-dc-status').html('<span style="color: #666;">🪤 Trap mode — status hidden</span>');
        $('#rpg-dc-streak').text('?');
        $('#rpg-dc-streak-max').text('?');
        $('#rpg-dc-countdown-display').hide();
        $('#rpg-dc-badge').text('trap');
        updateDoomDebugHud();
        return;
    }

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

// ─── Floating Debug HUD (removed) ─────────────────────────────────────────────

/** @deprecated Floating HUD removed — same info lives in scene headers & settings panel. */
export function updateDoomDebugHud() {
    hideDoomDebugHud();
}

/**
 * Removes the floating debug HUD from the DOM.
 */
export function hideDoomDebugHud() {
    $('#dooms-dc-debug-hud').remove();
}
