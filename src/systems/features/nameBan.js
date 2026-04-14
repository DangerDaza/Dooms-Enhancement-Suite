/**
 * Name Ban Module
 * Detects new character names in AI responses, shows a modal for user approval/remapping,
 * and enforces name rules across the message text and parsed character data.
 */
import { extensionSettings } from '../../core/state.js';
import { getActiveKnownCharacters, saveSettings, saveCharacterRosterChange } from '../../core/persistence.js';
import { getContext } from '../../../../../../extensions.js';
import { chat_metadata } from '../../../../../../../script.js';
import { selected_group, getGroupMembers } from '../../../../../../group-chats.js';
import { Popup, POPUP_TYPE, POPUP_RESULT } from '../../../../../../popup.js';

// ─────────────────────────────────────────────
//  Constants
// ─────────────────────────────────────────────

/** Words that should never be flagged as character names */
const EXCLUDED_WORDS = new Set([
    // Titles & honorifics
    'Sir', 'Lord', 'Lady', 'King', 'Queen', 'Prince', 'Princess', 'Duke', 'Duchess',
    'Count', 'Countess', 'Baron', 'Baroness', 'Captain', 'Commander', 'General',
    'Doctor', 'Professor', 'Master', 'Mistress', 'Father', 'Mother', 'Sister', 'Brother',
    'Elder', 'Chief', 'Mayor', 'Emperor', 'Empress', 'Knight', 'Squire', 'Bishop',
    'Priest', 'Priestess', 'Sage', 'Oracle', 'Prophet', 'Saint', 'Madam', 'Madame',
    // Days & months
    'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday',
    'January', 'February', 'March', 'April', 'May', 'June', 'July',
    'August', 'September', 'October', 'November', 'December',
    // Common narrative words often capitalized
    'The', 'This', 'That', 'There', 'Then', 'They', 'Their', 'Them', 'Those',
    'Here', 'Where', 'When', 'What', 'Which', 'While', 'With', 'From',
    'Some', 'Many', 'Most', 'Much', 'More', 'Other', 'Another', 'Every',
    'After', 'Before', 'Between', 'Above', 'Below', 'Behind', 'Beyond',
    'North', 'South', 'East', 'West',
    // Common RP setting words
    'Guild', 'Tavern', 'Inn', 'Castle', 'Temple', 'Tower', 'Forest', 'Mountain',
    'River', 'Kingdom', 'Empire', 'Village', 'City', 'Town', 'Palace', 'Dungeon',
    'Church', 'Academy', 'Council', 'Order', 'Alliance', 'Court',
    // Species/race words
    'Human', 'Elf', 'Dwarf', 'Orc', 'Dragon', 'Demon', 'Angel', 'Vampire',
    'Werewolf', 'Giant', 'Goblin', 'Troll', 'Fairy', 'Witch', 'Wizard', 'Mage',
]);

/** Dialogue attribution verbs for name detection */
const ATTRIBUTION_VERBS = 'said|replied|exclaimed|whispered|shouted|asked|answered|murmured|called|yelled|spoke|added|continued|remarked|noted|stated|declared|insisted|mentioned|muttered|responded|announced|growled|sighed|laughed|chuckled|snapped|hissed|breathed|stammered|stuttered|pleaded|demanded|warned|offered|suggested|agreed|argued|protested|interrupted|began|finished';

/** Action verbs for name detection */
const ACTION_VERBS = 'walked|appeared|stepped|entered|turned|looked|smiled|frowned|nodded|shook|sighed|laughed|approached|stood|sat|leaned|crossed|reached|placed|moved|grabbed|pulled|pushed|dropped|lifted|threw|caught|held|took|gave|ran|rushed|hurried|paused|stopped|started|continued|followed|led|watched|stared|glanced|gazed|blinked|waved|pointed|gestured|bowed|knelt|rose|fell|stumbled|tripped|jumped|landed';

// ─────────────────────────────────────────────
//  Detection engine
// ─────────────────────────────────────────────

/**
 * @typedef {Object} DetectedName
 * @property {string} name - The detected name string
 * @property {number} startIndex - Start position in message text
 * @property {number} endIndex - End position in message text
 * @property {string} context - ~80 chars of surrounding text for display
 * @property {string} pattern - Which heuristic matched
 */

/**
 * Scans message text for potential new character name introductions.
 * @param {string} messageText - Raw message text
 * @param {Set<string>} knownNamesLower - Lowercased known names to exclude
 * @param {string} sensitivity - 'strict' | 'normal' | 'aggressive'
 * @param {string[]} customExcluded - User-defined words to never flag
 * @returns {DetectedName[]}
 */
export function detectNewNames(messageText, knownNamesLower, sensitivity, customExcluded = []) {
    if (!messageText) return [];

    const excludedLower = new Set([
        ...[...EXCLUDED_WORDS].map(w => w.toLowerCase()),
        ...customExcluded.map(w => w.toLowerCase()),
    ]);

    const detections = new Map(); // name → DetectedName (dedup by name)

    const addDetection = (name, index, pattern) => {
        const lowerName = name.toLowerCase();
        if (knownNamesLower.has(lowerName)) return;
        if (excludedLower.has(lowerName)) return;
        if (name.length < 2 || name.length > 25) return;
        if (detections.has(lowerName)) return;

        // Build context snippet
        const ctxStart = Math.max(0, index - 40);
        const ctxEnd = Math.min(messageText.length, index + name.length + 40);
        const context = (ctxStart > 0 ? '...' : '') +
            messageText.slice(ctxStart, ctxEnd) +
            (ctxEnd < messageText.length ? '...' : '');

        detections.set(lowerName, {
            name,
            startIndex: index,
            endIndex: index + name.length,
            context,
            pattern,
        });
    };

    // ── Tier 1: Dialogue attribution (all sensitivity levels) ──

    // "..." said Elena / "..." Elena replied
    const postDialogue = new RegExp(
        `[""\\u201C\\u201D][^""\\u201C\\u201D]*[""\\u201C\\u201D]\\s*(?:${ATTRIBUTION_VERBS})\\s+([A-Z][a-z]{1,24})\\b`,
        'g'
    );
    for (const match of messageText.matchAll(postDialogue)) {
        addDetection(match[1], match.index + match[0].lastIndexOf(match[1]), 'dialogue_attribution');
    }

    // Elena said "..." / Elena replied, "..."
    const preDialogue = new RegExp(
        `\\b([A-Z][a-z]{1,24})\\s+(?:${ATTRIBUTION_VERBS})\\s*[,:]?\\s*[""\\u201C\\u201D]`,
        'g'
    );
    for (const match of messageText.matchAll(preDialogue)) {
        addDetection(match[1], match.index, 'dialogue_attribution');
    }

    // Introduction patterns: "I'm Elena", "My name is Elena", "Call me Elena"
    const introPatterns = /(?:I'm|I am|name is|call me|they call me|known as|name's)\s+([A-Z][a-z]{1,24})\b/gi;
    for (const match of messageText.matchAll(introPatterns)) {
        addDetection(match[1], match.index + match[0].lastIndexOf(match[1]), 'introduction');
    }

    // ── Tier 2: Action attribution (normal + aggressive) ──
    if (sensitivity === 'normal' || sensitivity === 'aggressive') {
        const actionPattern = new RegExp(
            `(?:^|[.!?]\\s+|\\n\\s*\\*?)\\s*([A-Z][a-z]{1,24})\\s+(?:${ACTION_VERBS})\\b`,
            'gm'
        );
        for (const match of messageText.matchAll(actionPattern)) {
            addDetection(match[1], match.index + match[0].indexOf(match[1]), 'action_attribution');
        }
    }

    // ── Tier 3: Repeated capitalized words (aggressive only) ──
    if (sensitivity === 'aggressive') {
        const wordCounts = new Map();
        const capWord = /\b([A-Z][a-z]{2,24})\b/g;
        for (const match of messageText.matchAll(capWord)) {
            const word = match[1];
            const lower = word.toLowerCase();
            if (knownNamesLower.has(lower) || excludedLower.has(lower)) continue;
            if (!wordCounts.has(lower)) {
                wordCounts.set(lower, { name: word, count: 0, firstIndex: match.index });
            }
            wordCounts.get(lower).count++;
        }
        for (const [lower, info] of wordCounts) {
            if (info.count >= 2 && !detections.has(lower)) {
                addDetection(info.name, info.firstIndex, 'repeated_capitalized');
            }
        }
    }

    return [...detections.values()];
}

// ─────────────────────────────────────────────
//  Known names aggregation
// ─────────────────────────────────────────────

/**
 * Builds a Set of lowercased known names from all sources.
 * @returns {Set<string>}
 */
export function buildKnownNamesSet() {
    const names = new Set();
    const add = (n) => { if (n) names.add(n.toLowerCase()); };

    // Current character + user
    const context = getContext();
    add(context.name1);
    add(context.name2);

    // Group members
    if (selected_group) {
        const members = getGroupMembers(selected_group);
        if (members) {
            for (const m of members) {
                if (m?.name) add(m.name);
            }
        }
    }

    // Name Ban lists
    const nb = getActiveNameBanData();
    for (const name of (nb.approvedNames || [])) add(name);
    for (const name of (nb.ignoredNames || [])) add(name);
    for (const [banned, approved] of Object.entries(nb.nameMappings || {})) {
        add(banned);
        add(approved);
    }

    // Portrait bar known characters
    const knownChars = getActiveKnownCharacters();
    for (const name of Object.keys(knownChars)) {
        add(name);
    }

    return names;
}

/**
 * Gets the active name ban data, respecting per-chat tracking.
 * @returns {{ approvedNames: string[], nameMappings: Object, ignoredNames: string[] }}
 */
export function getActiveNameBanData() {
    if (extensionSettings.perChatCharacterTracking && chat_metadata?.dooms_tracker) {
        if (!chat_metadata.dooms_tracker.nameBan) {
            chat_metadata.dooms_tracker.nameBan = {
                approvedNames: [],
                nameMappings: {},
                ignoredNames: [],
            };
        }
        // Merge global + per-chat: per-chat overrides take precedence for mappings
        const global = extensionSettings.nameBan || {};
        const perChat = chat_metadata.dooms_tracker.nameBan;
        return {
            approvedNames: [...new Set([...(global.approvedNames || []), ...(perChat.approvedNames || [])])],
            nameMappings: { ...(global.nameMappings || {}), ...(perChat.nameMappings || {}) },
            ignoredNames: [...new Set([...(global.ignoredNames || []), ...(perChat.ignoredNames || [])])],
        };
    }
    return extensionSettings.nameBan || { approvedNames: [], nameMappings: {}, ignoredNames: [] };
}

// ─────────────────────────────────────────────
//  Text replacement
// ─────────────────────────────────────────────

/**
 * Replaces all occurrences of oldName with newName using word boundaries.
 * @param {string} text
 * @param {string} oldName
 * @param {string} newName
 * @returns {string}
 */
function replaceNameInText(text, oldName, newName) {
    if (!text || !oldName || !newName || oldName === newName) return text;
    const escaped = oldName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return text.replace(new RegExp(`\\b${escaped}\\b`, 'gi'), newName);
}

/**
 * Applies all known mappings to a text string.
 * @param {string} text
 * @param {Object} mappings - { bannedName: approvedName }
 * @returns {string}
 */
export function applyNameReplacements(text, mappings) {
    if (!text || !mappings) return text;
    let result = text;
    for (const [banned, approved] of Object.entries(mappings)) {
        result = replaceNameInText(result, banned, approved);
    }
    return result;
}

/**
 * Patches character names in a parsed characterThoughts structure.
 * @param {*} thoughts - Parsed character thoughts (array or JSON string)
 * @param {Object} mappings - { bannedName: approvedName }
 * @returns {*} Patched thoughts in the same format as input
 */
function patchThoughtsNames(thoughts, mappings) {
    if (!thoughts || !mappings || Object.keys(mappings).length === 0) return thoughts;

    let parsed;
    let wasString = false;
    try {
        if (typeof thoughts === 'string') {
            parsed = JSON.parse(thoughts);
            wasString = true;
        } else {
            parsed = thoughts;
        }
    } catch {
        // If it's a text-format string, apply text replacement
        if (typeof thoughts === 'string') {
            return applyNameReplacements(thoughts, mappings);
        }
        return thoughts;
    }

    const characters = Array.isArray(parsed) ? parsed : (parsed.characters || []);
    for (const char of characters) {
        if (!char.name) continue;
        const lowerName = char.name.toLowerCase();
        for (const [banned, approved] of Object.entries(mappings)) {
            if (lowerName === banned.toLowerCase()) {
                char.name = approved;
                break;
            }
        }
    }

    return wasString ? JSON.stringify(parsed) : parsed;
}

// ─────────────────────────────────────────────
//  Modal UI
// ─────────────────────────────────────────────

/**
 * Builds the modal HTML content for detected names.
 * @param {DetectedName[]} detections
 * @returns {string} HTML string
 */
function buildModalContent(detections) {
    const nb = getActiveNameBanData();
    const knownChars = getActiveKnownCharacters();
    const existingNames = [...new Set([
        ...(nb.approvedNames || []),
        ...Object.keys(knownChars),
    ])].sort();

    let html = '<div class="dooms-nb-modal">';

    for (let i = 0; i < detections.length; i++) {
        const det = detections[i];
        const escapedName = det.name.replace(/</g, '&lt;').replace(/>/g, '&gt;');
        const escapedContext = det.context
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(new RegExp(`\\b(${det.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})\\b`, 'gi'),
                '<span class="dooms-nb-highlight">$1</span>');

        html += `
        <div class="dooms-nb-detection" data-index="${i}" data-name="${escapedName}">
            <div class="dooms-nb-context">${escapedContext}</div>
            <div class="dooms-nb-actions">
                <label class="dooms-nb-radio">
                    <input type="radio" name="nb-action-${i}" value="approve" checked>
                    <span>Approve <strong>"${escapedName}"</strong> as-is</span>
                </label>
                <label class="dooms-nb-radio dooms-nb-replace-label">
                    <input type="radio" name="nb-action-${i}" value="replace">
                    <span>Replace with:</span>
                    <select class="dooms-nb-select text_pole" data-index="${i}" style="margin-left:8px; max-width:160px;">
                        <option value="" disabled selected>Choose name...</option>
                        ${existingNames.map(n => `<option value="${n.replace(/"/g, '&quot;')}">${n.replace(/</g, '&lt;')}</option>`).join('')}
                    </select>
                    <span style="margin:0 6px; color:#6b7394; font-size:0.8em;">or</span>
                    <input type="text" class="dooms-nb-custom text_pole" data-index="${i}"
                           placeholder="Custom name..." style="max-width:140px;">
                </label>
                <label class="dooms-nb-radio">
                    <input type="radio" name="nb-action-${i}" value="ignore">
                    <span>Ignore <span style="opacity:0.6">(never flag this name)</span></span>
                </label>
                <label class="dooms-nb-radio">
                    <input type="radio" name="nb-action-${i}" value="skip">
                    <span>Skip <span style="opacity:0.6">(do nothing this time)</span></span>
                </label>
                <label class="dooms-nb-remember">
                    <input type="checkbox" class="dooms-nb-remember-cb" data-index="${i}" checked>
                    <span>Remember this decision</span>
                </label>
            </div>
        </div>`;
    }

    html += '</div>';
    return html;
}

/**
 * Shows the name ban modal and returns user decisions.
 * @param {DetectedName[]} detections
 * @returns {Promise<Array<{name:string, action:string, replacement:string|null, remember:boolean}>|null>}
 */
async function showNameBanModal(detections) {
    const content = buildModalContent(detections);

    const popup = new Popup(content, POPUP_TYPE.TEXT, '', {
        wide: true,
        allowVerticalScrolling: true,
        okButton: 'Apply',
        cancelButton: 'Skip All',
    });

    const result = await popup.show();

    if (result !== POPUP_RESULT.AFFIRMATIVE) return null;

    // Collect decisions from the DOM
    const decisions = [];
    const dlg = popup.dlg;

    for (let i = 0; i < detections.length; i++) {
        const action = dlg.querySelector(`input[name="nb-action-${i}"]:checked`)?.value || 'skip';
        const remember = dlg.querySelector(`.dooms-nb-remember-cb[data-index="${i}"]`)?.checked ?? true;
        let replacement = null;

        if (action === 'replace') {
            const selectVal = dlg.querySelector(`.dooms-nb-select[data-index="${i}"]`)?.value;
            const customVal = dlg.querySelector(`.dooms-nb-custom[data-index="${i}"]`)?.value?.trim();
            replacement = customVal || selectVal || null;
        }

        decisions.push({
            name: detections[i].name,
            action,
            replacement,
            remember,
        });
    }

    return decisions;
}

// ─────────────────────────────────────────────
//  Decision persistence
// ─────────────────────────────────────────────

/**
 * Persists user decisions to extension settings.
 * @param {Array<{name:string, action:string, replacement:string|null, remember:boolean}>} decisions
 */
function persistDecisions(decisions) {
    const nb = extensionSettings.nameBan;
    if (!nb) return;

    for (const decision of decisions) {
        if (!decision.remember) continue;

        switch (decision.action) {
            case 'approve':
                if (!nb.approvedNames.includes(decision.name)) {
                    nb.approvedNames.push(decision.name);
                }
                break;
            case 'replace':
                if (decision.replacement) {
                    nb.nameMappings[decision.name] = decision.replacement;
                    // Also approve the replacement name
                    if (!nb.approvedNames.includes(decision.replacement)) {
                        nb.approvedNames.push(decision.replacement);
                    }
                }
                break;
            case 'ignore':
                if (!nb.ignoredNames.includes(decision.name)) {
                    nb.ignoredNames.push(decision.name);
                }
                break;
        }
    }

    saveSettings();

    // Also persist to per-chat if tracking is per-chat
    if (extensionSettings.perChatCharacterTracking && chat_metadata?.dooms_tracker) {
        if (!chat_metadata.dooms_tracker.nameBan) {
            chat_metadata.dooms_tracker.nameBan = { approvedNames: [], nameMappings: {}, ignoredNames: [] };
        }
        const pcNb = chat_metadata.dooms_tracker.nameBan;
        for (const decision of decisions) {
            if (!decision.remember) continue;
            switch (decision.action) {
                case 'approve':
                    if (!pcNb.approvedNames.includes(decision.name)) {
                        pcNb.approvedNames.push(decision.name);
                    }
                    break;
                case 'replace':
                    if (decision.replacement) {
                        pcNb.nameMappings[decision.name] = decision.replacement;
                        if (!pcNb.approvedNames.includes(decision.replacement)) {
                            pcNb.approvedNames.push(decision.replacement);
                        }
                    }
                    break;
                case 'ignore':
                    if (!pcNb.ignoredNames.includes(decision.name)) {
                        pcNb.ignoredNames.push(decision.name);
                    }
                    break;
            }
        }
        saveCharacterRosterChange();
    }
}

// ─────────────────────────────────────────────
//  Main enforcement function
// ─────────────────────────────────────────────

/**
 * Main entry point: enforces name ban rules on a message and its parsed character data.
 * Called from onMessageReceived() after parseResponse() but before rendering.
 *
 * @param {string} messageText - The raw message text (chat[].mes)
 * @param {*} parsedCharacterThoughts - Parsed character thoughts from parseResponse()
 * @returns {Promise<{ text: string, thoughts: * }>}
 */
export async function enforceNameBan(messageText, parsedCharacterThoughts) {
    const nb = extensionSettings.nameBan;
    if (!nb?.enabled) return { text: messageText, thoughts: parsedCharacterThoughts };

    let text = messageText;
    let thoughts = parsedCharacterThoughts;
    const activeMappings = getActiveNameBanData().nameMappings || {};

    // Step 1: Auto-apply known mappings
    if (nb.autoApplyKnownMappings && Object.keys(activeMappings).length > 0) {
        text = applyNameReplacements(text, activeMappings);
        thoughts = patchThoughtsNames(thoughts, activeMappings);
    }

    // Step 2: Also check characterThoughts for unknown names
    const thoughtsNames = extractNamesFromThoughts(thoughts);

    // Step 3: Detect new names in message text
    const knownNames = buildKnownNamesSet();
    const detectedInText = detectNewNames(text, knownNames, nb.sensitivity, nb.customExcludedWords || []);

    // Step 4: Check thoughts names against known names
    const unknownThoughtsNames = thoughtsNames.filter(n => !knownNames.has(n.toLowerCase()));

    // Merge: add thoughts-only names that weren't detected in text
    const allDetected = [...detectedInText];
    const detectedTextLower = new Set(detectedInText.map(d => d.name.toLowerCase()));
    for (const thoughtsName of unknownThoughtsNames) {
        if (!detectedTextLower.has(thoughtsName.toLowerCase())) {
            allDetected.push({
                name: thoughtsName,
                startIndex: -1,
                endIndex: -1,
                context: `(detected in character data as "${thoughtsName}")`,
                pattern: 'character_thoughts',
            });
        }
    }

    if (allDetected.length === 0) return { text, thoughts };

    // Step 5: Show modal or auto-approve
    if (nb.showModalForNew) {
        const decisions = await showNameBanModal(allDetected);
        if (decisions) {
            const newMappings = {};
            for (const decision of decisions) {
                if (decision.action === 'replace' && decision.replacement) {
                    newMappings[decision.name] = decision.replacement;
                }
            }
            // Apply replacement decisions
            if (Object.keys(newMappings).length > 0) {
                text = applyNameReplacements(text, newMappings);
                thoughts = patchThoughtsNames(thoughts, newMappings);
            }
            // Persist all decisions
            persistDecisions(decisions);
        }
    } else {
        // Auto-approve all unknown names silently
        const nb2 = extensionSettings.nameBan;
        for (const det of allDetected) {
            if (!nb2.approvedNames.includes(det.name)) {
                nb2.approvedNames.push(det.name);
            }
        }
        saveSettings();
    }

    return { text, thoughts };
}

/**
 * Extracts character names from parsed character thoughts.
 * @param {*} thoughts
 * @returns {string[]}
 */
function extractNamesFromThoughts(thoughts) {
    if (!thoughts) return [];
    try {
        const parsed = typeof thoughts === 'string' ? JSON.parse(thoughts) : thoughts;
        const characters = Array.isArray(parsed) ? parsed : (parsed.characters || []);
        return characters.filter(c => c.name).map(c => c.name);
    } catch {
        return [];
    }
}

// ─────────────────────────────────────────────
//  Prompt instruction builder
// ─────────────────────────────────────────────

/**
 * Builds an instruction string for AI prompt injection.
 * @returns {string}
 */
export function buildNameBanInstruction() {
    const nb = extensionSettings.nameBan;
    if (!nb?.enabled || !nb?.injectIntoPrompt) return '';

    const parts = [];
    const mappings = nb.nameMappings || {};
    if (Object.keys(mappings).length > 0) {
        const mappingStr = Object.entries(mappings)
            .map(([banned, approved]) => `Do NOT use the name "${banned}" — use "${approved}" instead`)
            .join('; ');
        parts.push(mappingStr + '.');
    }
    if (nb.approvedNames?.length > 0) {
        parts.push(`Approved character names to use: ${nb.approvedNames.join(', ')}.`);
    }

    return parts.length > 0 ? `\n- ${parts.join(' ')}\n` : '';
}

// ─────────────────────────────────────────────
//  Settings UI helpers (called from index.js)
// ─────────────────────────────────────────────

/**
 * Renders the approved names tag list into a container.
 * @param {jQuery} $container
 */
export function renderApprovedNamesTags($container) {
    const nb = extensionSettings.nameBan || {};
    $container.empty();
    for (const name of (nb.approvedNames || [])) {
        $container.append(`
            <span class="dooms-nb-tag dooms-nb-tag-approved">
                ${name.replace(/</g, '&lt;')}
                <button class="dooms-nb-tag-remove" data-name="${name.replace(/"/g, '&quot;')}" data-list="approvedNames">&times;</button>
            </span>
        `);
    }
}

/**
 * Renders the ignored names tag list into a container.
 * @param {jQuery} $container
 */
export function renderIgnoredNamesTags($container) {
    const nb = extensionSettings.nameBan || {};
    $container.empty();
    for (const name of (nb.ignoredNames || [])) {
        $container.append(`
            <span class="dooms-nb-tag dooms-nb-tag-ignored">
                ${name.replace(/</g, '&lt;')}
                <button class="dooms-nb-tag-remove" data-name="${name.replace(/"/g, '&quot;')}" data-list="ignoredNames">&times;</button>
            </span>
        `);
    }
}

/**
 * Renders the name mappings table into a container.
 * @param {jQuery} $container
 */
export function renderMappingsTable($container) {
    const nb = extensionSettings.nameBan || {};
    const mappings = nb.nameMappings || {};
    const entries = Object.entries(mappings);

    let html = '';
    if (entries.length === 0) {
        html = '<div style="opacity:0.5; padding:8px; font-size:0.85em;">No mappings yet</div>';
    } else {
        html = '<table class="dooms-nb-mappings-table"><thead><tr><th>Banned</th><th>Replacement</th><th></th></tr></thead><tbody>';
        for (const [banned, approved] of entries) {
            html += `<tr>
                <td class="dooms-nb-from">${banned.replace(/</g, '&lt;')}</td>
                <td class="dooms-nb-to">${approved.replace(/</g, '&lt;')}</td>
                <td><button class="dooms-nb-mapping-delete menu_button" data-banned="${banned.replace(/"/g, '&quot;')}">&times;</button></td>
            </tr>`;
        }
        html += '</tbody></table>';
    }
    $container.html(html);
}
