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

const EXCLUDED_WORDS = new Set([
    'Sir', 'Lord', 'Lady', 'King', 'Queen', 'Prince', 'Princess', 'Duke', 'Duchess',
    'Count', 'Countess', 'Baron', 'Baroness', 'Captain', 'Commander', 'General',
    'Doctor', 'Professor', 'Master', 'Mistress', 'Father', 'Mother', 'Sister', 'Brother',
    'Elder', 'Chief', 'Mayor', 'Emperor', 'Empress', 'Knight', 'Squire', 'Bishop',
    'Priest', 'Priestess', 'Sage', 'Oracle', 'Prophet', 'Saint', 'Madam', 'Madame',
    'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday',
    'January', 'February', 'March', 'April', 'May', 'June', 'July',
    'August', 'September', 'October', 'November', 'December',
    'The', 'This', 'That', 'There', 'Then', 'They', 'Their', 'Them', 'Those',
    'Here', 'Where', 'When', 'What', 'Which', 'While', 'With', 'From',
    'Some', 'Many', 'Most', 'Much', 'More', 'Other', 'Another', 'Every',
    'After', 'Before', 'Between', 'Above', 'Below', 'Behind', 'Beyond',
    'North', 'South', 'East', 'West',
    'Guild', 'Tavern', 'Inn', 'Castle', 'Temple', 'Tower', 'Forest', 'Mountain',
    'River', 'Kingdom', 'Empire', 'Village', 'City', 'Town', 'Palace', 'Dungeon',
    'Church', 'Academy', 'Council', 'Order', 'Alliance', 'Court',
    'Human', 'Elf', 'Dwarf', 'Orc', 'Dragon', 'Demon', 'Angel', 'Vampire',
    'Werewolf', 'Giant', 'Goblin', 'Troll', 'Fairy', 'Witch', 'Wizard', 'Mage',
]);

const ATTRIBUTION_VERBS = 'said|replied|exclaimed|whispered|shouted|asked|answered|murmured|called|yelled|spoke|added|continued|remarked|noted|stated|declared|insisted|mentioned|muttered|responded|announced|growled|sighed|laughed|chuckled|snapped|hissed|breathed|stammered|stuttered|pleaded|demanded|warned|offered|suggested|agreed|argued|protested|interrupted|began|finished';
const ACTION_VERBS = 'walked|appeared|stepped|entered|turned|looked|smiled|frowned|nodded|shook|sighed|laughed|approached|stood|sat|leaned|crossed|reached|placed|moved|grabbed|pulled|pushed|dropped|lifted|threw|caught|held|took|gave|ran|rushed|hurried|paused|stopped|started|continued|followed|led|watched|stared|glanced|gazed|blinked|waved|pointed|gestured|bowed|knelt|rose|fell|stumbled|tripped|jumped|landed';

// ─────────────────────────────────────────────
//  Detection engine
// ─────────────────────────────────────────────

export function detectNewNames(messageText, knownNamesLower, sensitivity, customExcluded = []) {
    if (!messageText) return [];
    const excludedLower = new Set([...[...EXCLUDED_WORDS].map(w => w.toLowerCase()), ...customExcluded.map(w => w.toLowerCase())]);
    const detections = new Map();
    const addDetection = (name, index, pattern) => {
        const lowerName = name.toLowerCase();
        if (knownNamesLower.has(lowerName) || excludedLower.has(lowerName)) return;
        if (name.length < 2 || name.length > 25 || detections.has(lowerName)) return;
        const ctxStart = Math.max(0, index - 40);
        const ctxEnd = Math.min(messageText.length, index + name.length + 40);
        const context = (ctxStart > 0 ? '...' : '') + messageText.slice(ctxStart, ctxEnd) + (ctxEnd < messageText.length ? '...' : '');
        detections.set(lowerName, { name, startIndex: index, endIndex: index + name.length, context, pattern });
    };
    const postDialogue = new RegExp(`[""\\u201C\\u201D][^""\\u201C\\u201D]*[""\\u201C\\u201D]\\s*(?:${ATTRIBUTION_VERBS})\\s+([A-Z][a-z]{1,24})\\b`, 'g');
    for (const match of messageText.matchAll(postDialogue)) addDetection(match[1], match.index + match[0].lastIndexOf(match[1]), 'dialogue_attribution');
    const preDialogue = new RegExp(`\\b([A-Z][a-z]{1,24})\\s+(?:${ATTRIBUTION_VERBS})\\s*[,:]?\\s*[""\\u201C\\u201D]`, 'g');
    for (const match of messageText.matchAll(preDialogue)) addDetection(match[1], match.index, 'dialogue_attribution');
    const introPatterns = /(?:I'm|I am|name is|call me|they call me|known as|name's)\s+([A-Z][a-z]{1,24})\b/gi;
    for (const match of messageText.matchAll(introPatterns)) addDetection(match[1], match.index + match[0].lastIndexOf(match[1]), 'introduction');
    if (sensitivity === 'normal' || sensitivity === 'aggressive') {
        const actionPattern = new RegExp(`(?:^|[.!?]\\s+|\\n\\s*\\*?)\\s*([A-Z][a-z]{1,24})\\s+(?:${ACTION_VERBS})\\b`, 'gm');
        for (const match of messageText.matchAll(actionPattern)) addDetection(match[1], match.index + match[0].indexOf(match[1]), 'action_attribution');
    }
    if (sensitivity === 'aggressive') {
        const wordCounts = new Map();
        const capWord = /\b([A-Z][a-z]{2,24})\b/g;
        for (const match of messageText.matchAll(capWord)) {
            const lower = match[1].toLowerCase();
            if (knownNamesLower.has(lower) || excludedLower.has(lower)) continue;
            if (!wordCounts.has(lower)) wordCounts.set(lower, { name: match[1], count: 0, firstIndex: match.index });
            wordCounts.get(lower).count++;
        }
        for (const [lower, info] of wordCounts) { if (info.count >= 2 && !detections.has(lower)) addDetection(info.name, info.firstIndex, 'repeated_capitalized'); }
    }
    return [...detections.values()];
}

// ─────────────────────────────────────────────
//  Known names aggregation
// ─────────────────────────────────────────────

export function buildKnownNamesSet() {
    const names = new Set();
    const add = (n) => { if (n) names.add(n.toLowerCase()); };
    const context = getContext();
    add(context.name1); add(context.name2);
    if (selected_group) { const members = getGroupMembers(selected_group); if (members) for (const m of members) { if (m?.name) add(m.name); } }
    const nb = getActiveNameBanData();
    for (const name of (nb.approvedNames || [])) add(name);
    for (const name of (nb.ignoredNames || [])) add(name);
    for (const [banned, approved] of Object.entries(nb.nameMappings || {})) { add(banned); add(approved); }
    const knownChars = getActiveKnownCharacters();
    for (const name of Object.keys(knownChars)) add(name);
    return names;
}

export function getActiveNameBanData() {
    if (extensionSettings.perChatCharacterTracking && chat_metadata?.dooms_tracker) {
        if (!chat_metadata.dooms_tracker.nameBan) { chat_metadata.dooms_tracker.nameBan = { approvedNames: [], nameMappings: {}, ignoredNames: [] }; }
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

function replaceNameInText(text, oldName, newName) {
    if (!text || !oldName || !newName || oldName === newName) return text;
    const escaped = oldName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return text.replace(new RegExp(`\\b${escaped}\\b`, 'gi'), newName);
}

export function applyNameReplacements(text, mappings) {
    if (!text || !mappings) return text;
    let result = text;
    for (const [banned, approved] of Object.entries(mappings)) result = replaceNameInText(result, banned, approved);
    return result;
}

function patchThoughtsNames(thoughts, mappings) {
    if (!thoughts || !mappings || Object.keys(mappings).length === 0) return thoughts;
    let parsed; let wasString = false;
    try { if (typeof thoughts === 'string') { parsed = JSON.parse(thoughts); wasString = true; } else { parsed = thoughts; } } catch { if (typeof thoughts === 'string') return applyNameReplacements(thoughts, mappings); return thoughts; }
    const characters = Array.isArray(parsed) ? parsed : (parsed.characters || []);
    for (const char of characters) { if (!char.name) continue; const lowerName = char.name.toLowerCase(); for (const [banned, approved] of Object.entries(mappings)) { if (lowerName === banned.toLowerCase()) { char.name = approved; break; } } }
    return wasString ? JSON.stringify(parsed) : parsed;
}

// ─────────────────────────────────────────────
//  Modal UI
// ─────────────────────────────────────────────

function buildModalContent(detections) {
    const nb = getActiveNameBanData();
    const knownChars = getActiveKnownCharacters();
    const existingNames = [...new Set([...(nb.approvedNames || []), ...Object.keys(knownChars)])].sort();
    let html = '<div class="dooms-nb-modal">';
    for (let i = 0; i < detections.length; i++) {
        const det = detections[i];
        const escapedName = det.name.replace(/</g, '&lt;').replace(/>/g, '&gt;');
        const escapedContext = det.context.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(new RegExp(`\\b(${det.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})\\b`, 'gi'), '<span class="dooms-nb-highlight">$1</span>');
        html += `<div class="dooms-nb-detection" data-index="${i}" data-name="${escapedName}"><div class="dooms-nb-context">${escapedContext}</div><div class="dooms-nb-actions"><label class="dooms-nb-radio"><input type="radio" name="nb-action-${i}" value="approve" checked><span>Approve <strong>"${escapedName}"</strong> as-is</span></label><label class="dooms-nb-radio dooms-nb-replace-label"><input type="radio" name="nb-action-${i}" value="replace"><span>Replace with:</span><select class="dooms-nb-select text_pole" data-index="${i}" style="margin-left:8px;max-width:160px;"><option value="" disabled selected>Choose name...</option>${existingNames.map(n => `<option value="${n.replace(/"/g, '&quot;')}">${n.replace(/</g, '&lt;')}</option>`).join('')}</select><span style="margin:0 6px;color:#6b7394;font-size:0.8em;">or</span><input type="text" class="dooms-nb-custom text_pole" data-index="${i}" placeholder="Custom name..." style="max-width:140px;"></label><label class="dooms-nb-radio"><input type="radio" name="nb-action-${i}" value="ignore"><span>Ignore <span style="opacity:0.6">(never flag this name)</span></span></label><label class="dooms-nb-radio"><input type="radio" name="nb-action-${i}" value="skip"><span>Skip <span style="opacity:0.6">(do nothing this time)</span></span></label><label class="dooms-nb-remember"><input type="checkbox" class="dooms-nb-remember-cb" data-index="${i}" checked><span>Remember this decision</span></label></div></div>`;
    }
    html += '</div>';
    return html;
}

async function showNameBanModal(detections) {
    const popup = new Popup(buildModalContent(detections), POPUP_TYPE.TEXT, '', { wide: true, allowVerticalScrolling: true, okButton: 'Apply', cancelButton: 'Skip All' });
    const result = await popup.show();
    if (result !== POPUP_RESULT.AFFIRMATIVE) return null;
    const decisions = []; const dlg = popup.dlg;
    for (let i = 0; i < detections.length; i++) {
        const action = dlg.querySelector(`input[name="nb-action-${i}"]:checked`)?.value || 'skip';
        const remember = dlg.querySelector(`.dooms-nb-remember-cb[data-index="${i}"]`)?.checked ?? true;
        let replacement = null;
        if (action === 'replace') { const selectVal = dlg.querySelector(`.dooms-nb-select[data-index="${i}"]`)?.value; const customVal = dlg.querySelector(`.dooms-nb-custom[data-index="${i}"]`)?.value?.trim(); replacement = customVal || selectVal || null; }
        decisions.push({ name: detections[i].name, action, replacement, remember });
    }
    return decisions;
}

function persistDecisions(decisions) {
    const nb = extensionSettings.nameBan; if (!nb) return;
    for (const d of decisions) { if (!d.remember) continue; switch (d.action) { case 'approve': if (!nb.approvedNames.includes(d.name)) nb.approvedNames.push(d.name); break; case 'replace': if (d.replacement) { nb.nameMappings[d.name] = d.replacement; if (!nb.approvedNames.includes(d.replacement)) nb.approvedNames.push(d.replacement); } break; case 'ignore': if (!nb.ignoredNames.includes(d.name)) nb.ignoredNames.push(d.name); break; } }
    saveSettings();
    if (extensionSettings.perChatCharacterTracking && chat_metadata?.dooms_tracker) {
        if (!chat_metadata.dooms_tracker.nameBan) chat_metadata.dooms_tracker.nameBan = { approvedNames: [], nameMappings: {}, ignoredNames: [] };
        const pcNb = chat_metadata.dooms_tracker.nameBan;
        for (const d of decisions) { if (!d.remember) continue; switch (d.action) { case 'approve': if (!pcNb.approvedNames.includes(d.name)) pcNb.approvedNames.push(d.name); break; case 'replace': if (d.replacement) { pcNb.nameMappings[d.name] = d.replacement; if (!pcNb.approvedNames.includes(d.replacement)) pcNb.approvedNames.push(d.replacement); } break; case 'ignore': if (!pcNb.ignoredNames.includes(d.name)) pcNb.ignoredNames.push(d.name); break; } }
        saveCharacterRosterChange();
    }
}

// ─────────────────────────────────────────────
//  Main enforcement function
// ─────────────────────────────────────────────

export async function enforceNameBan(messageText, parsedCharacterThoughts) {
    const nb = extensionSettings.nameBan;
    if (!nb?.enabled) return { text: messageText, thoughts: parsedCharacterThoughts };
    let text = messageText; let thoughts = parsedCharacterThoughts;
    const activeMappings = getActiveNameBanData().nameMappings || {};
    if (nb.autoApplyKnownMappings && Object.keys(activeMappings).length > 0) { text = applyNameReplacements(text, activeMappings); thoughts = patchThoughtsNames(thoughts, activeMappings); }
    const thoughtsNames = extractNamesFromThoughts(thoughts);
    const knownNames = buildKnownNamesSet();
    const detectedInText = detectNewNames(text, knownNames, nb.sensitivity, nb.customExcludedWords || []);
    const unknownThoughtsNames = thoughtsNames.filter(n => !knownNames.has(n.toLowerCase()));
    const allDetected = [...detectedInText];
    const detectedTextLower = new Set(detectedInText.map(d => d.name.toLowerCase()));
    for (const thoughtsName of unknownThoughtsNames) { if (!detectedTextLower.has(thoughtsName.toLowerCase())) allDetected.push({ name: thoughtsName, startIndex: -1, endIndex: -1, context: `(detected in character data as "${thoughtsName}")`, pattern: 'character_thoughts' }); }
    if (allDetected.length === 0) return { text, thoughts };
    if (nb.showModalForNew) {
        const decisions = await showNameBanModal(allDetected);
        if (decisions) { const newMappings = {}; for (const d of decisions) { if (d.action === 'replace' && d.replacement) newMappings[d.name] = d.replacement; } if (Object.keys(newMappings).length > 0) { text = applyNameReplacements(text, newMappings); thoughts = patchThoughtsNames(thoughts, newMappings); } persistDecisions(decisions); }
    } else { for (const det of allDetected) { if (!nb.approvedNames.includes(det.name)) nb.approvedNames.push(det.name); } saveSettings(); }
    return { text, thoughts };
}

function extractNamesFromThoughts(thoughts) {
    if (!thoughts) return [];
    try { const parsed = typeof thoughts === 'string' ? JSON.parse(thoughts) : thoughts; const characters = Array.isArray(parsed) ? parsed : (parsed.characters || []); return characters.filter(c => c.name).map(c => c.name); } catch { return []; }
}

// ─────────────────────────────────────────────
//  Prompt instruction builder
// ─────────────────────────────────────────────

export function buildNameBanInstruction() {
    const nb = extensionSettings.nameBan;
    if (!nb?.enabled || !nb?.injectIntoPrompt) return '';
    const parts = [];
    const mappings = nb.nameMappings || {};
    if (Object.keys(mappings).length > 0) { const mappingStr = Object.entries(mappings).map(([banned, approved]) => `Do NOT use the name "${banned}" — use "${approved}" instead`).join('; '); parts.push(mappingStr + '.'); }
    if (nb.approvedNames?.length > 0) parts.push(`Approved character names to use: ${nb.approvedNames.join(', ')}.`);
    return parts.length > 0 ? `\n- ${parts.join(' ')}\n` : '';
}

// ─────────────────────────────────────────────
//  Settings UI helpers
// ─────────────────────────────────────────────

export function renderApprovedNamesTags($container) {
    const nb = extensionSettings.nameBan || {}; $container.empty();
    for (const name of (nb.approvedNames || [])) $container.append(`<span class="dooms-nb-tag dooms-nb-tag-approved">${name.replace(/</g, '&lt;')}<button class="dooms-nb-tag-remove" data-name="${name.replace(/"/g, '&quot;')}" data-list="approvedNames">&times;</button></span>`);
}

export function renderIgnoredNamesTags($container) {
    const nb = extensionSettings.nameBan || {}; $container.empty();
    for (const name of (nb.ignoredNames || [])) $container.append(`<span class="dooms-nb-tag dooms-nb-tag-ignored">${name.replace(/</g, '&lt;')}<button class="dooms-nb-tag-remove" data-name="${name.replace(/"/g, '&quot;')}" data-list="ignoredNames">&times;</button></span>`);
}

export function renderMappingsTable($container) {
    const nb = extensionSettings.nameBan || {}; const entries = Object.entries(nb.nameMappings || {});
    let html = entries.length === 0 ? '<div style="opacity:0.5;padding:8px;font-size:0.85em;">No mappings yet</div>' : '<table class="dooms-nb-mappings-table"><thead><tr><th>Banned</th><th>Replacement</th><th></th></tr></thead><tbody>' + entries.map(([b, a]) => `<tr><td class="dooms-nb-from">${b.replace(/</g, '&lt;')}</td><td class="dooms-nb-to">${a.replace(/</g, '&lt;')}</td><td><button class="dooms-nb-mapping-delete menu_button" data-banned="${b.replace(/"/g, '&quot;')}">&times;</button></td></tr>`).join('') + '</tbody></table>';
    $container.html(html);
}
