/**
 * Auto Portraits for Present Characters
 *
 * Keeps the old expression-sync export names used by index.js, but replaces
 * sprite classification with optional present-character portrait generation.
 */
import {
    chat,
    eventSource,
    event_types,
    extension_prompt_roles,
    extension_prompt_types,
    generateRaw,
    saveChatDebounced,
    setExtensionPrompt,
    characters,
    this_chid,
} from '../../../../../../../script.js';
import { executeSlashCommandsOnChatInput } from '../../../../../../../scripts/slash-commands.js';
import { SlashCommandParser } from '../../../../../../../scripts/slash-commands/SlashCommandParser.js';
import { selected_group, getGroupMembers } from '../../../../../../group-chats.js';
import {
    extensionSettings,
    lastGeneratedData,
    committedTrackerData,
    clearSyncedExpressionPortraits,
    setSyncedExpressionLabel,
} from '../../core/state.js';
import { saveSettings, saveChatData, getActiveRemovedCharacters } from '../../core/persistence.js';
import { renderThoughts } from '../rendering/thoughts.js';
import { updatePortraitBar } from '../ui/portraitBar.js';
import { hasExistingAvatar } from '../features/avatarGenerator.js';
import { DEFAULT_AUTO_PORTRAIT_PROMPT } from '../ui/promptsEditor.js';

const PROMPT_KEY = 'DES_AutoPortraitPrompt';
const PORTRAIT_TAG_RE = /<des_portraits>\s*([\s\S]*?)\s*<\/des_portraits>/gi;
const SOURCE = 'dooms-enhancement-suite.auto-portraits';
const DEFAULT_MODE = 'off';
const DEFAULT_PROMPT_SOURCE = 'main_reply_tag';

let hiddenExpressionStyleElement = null;
let promptHooksInstalled = false;
let queue = Promise.resolve();
let warnedSdUnavailable = false;
const pendingGenerations = new Set();

function normalizeName(name) {
    return String(name || '').trim().toLowerCase();
}

function ensureSettings() {
    if (!extensionSettings.generatedPortraits || typeof extensionSettings.generatedPortraits !== 'object') {
        extensionSettings.generatedPortraits = {};
    }
    if (!extensionSettings.autoPortraitMode) {
        extensionSettings.autoPortraitMode = DEFAULT_MODE;
    }
    if (!extensionSettings.autoPortraitPromptSource) {
        extensionSettings.autoPortraitPromptSource = DEFAULT_PROMPT_SOURCE;
    }
    extensionSettings.syncExpressionsToPresentCharacters = extensionSettings.autoPortraitMode !== 'off';
}

function getMode() {
    ensureSettings();
    return extensionSettings.autoPortraitMode || DEFAULT_MODE;
}

function getPromptSource() {
    ensureSettings();
    return extensionSettings.autoPortraitPromptSource || DEFAULT_PROMPT_SOURCE;
}

function isEnabled() {
    return extensionSettings.enabled && getMode() !== 'off';
}

function parseCharactersData() {
    const data = lastGeneratedData.characterThoughts || committedTrackerData.characterThoughts || extensionSettings.characterThoughts;
    if (!data) return [];
    try {
        const parsed = typeof data === 'string' ? JSON.parse(data) : data;
        const charactersData = Array.isArray(parsed) ? parsed : (parsed.characters || []);
        return Array.isArray(charactersData) ? charactersData : [];
    } catch {
        return [];
    }
}

function isOffScene(character) {
    const thoughts = character?.thoughts?.content || character?.thoughts || '';
    const status = character?.status || '';
    const text = `${thoughts} ${status}`;
    return /\b(not\s+(currently\s+)?(in|at|present\s+in|present\s+at)\s+(the\s+)?(scene|area|room|location|vicinity))\b|\b(off[\s-]?scene)\b|\b(not\s+physically\s+present)\b|\b(absent\s+from\s+(the\s+)?(scene|room|area|location))\b|\b(away\s+from\s+(the\s+)?scene)\b/i.test(String(text));
}

function getPresentCharacters() {
    const removed = new Set((getActiveRemovedCharacters() || []).map(n => normalizeName(n)));
    return parseCharactersData()
        .filter(c => c && c.name && !isOffScene(c))
        .map(c => ({ ...c, name: String(c.name).trim() }))
        .filter(c => c.name && !removed.has(normalizeName(c.name)));
}

function getGeneratedMeta(name) {
    ensureSettings();
    return extensionSettings.generatedPortraits[name] || extensionSettings.generatedPortraits[normalizeName(name)] || null;
}

function setGeneratedMeta(name, data) {
    ensureSettings();
    extensionSettings.generatedPortraits[name] = {
        source: SOURCE,
        ...data,
        updatedAt: Date.now(),
    };
}

function stableStringify(value) {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
    return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
}

function hashText(text) {
    let hash = 2166136261;
    for (let i = 0; i < text.length; i++) {
        hash ^= text.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
}

function namesMatch(cardName, aiName) {
    if (!cardName || !aiName) return false;
    const cardLower = String(cardName).toLowerCase().trim();
    const aiLower = String(aiName).toLowerCase().trim();
    if (cardLower === aiLower) return true;
    const cardCore = cardLower.split(/[\s,'"]+/)[0];
    const aiCore = aiLower.split(/[\s,'"]+/)[0];
    if (cardCore === aiCore) return true;
    const escapedCardCore = cardCore.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`\\b${escapedCardCore}\\b`).test(aiLower);
}

function hasStCharacterAvatar(name) {
    if (extensionSettings.portraitAutoImport === false) return false;
    try {
        if (selected_group) {
            const groupMembers = getGroupMembers(selected_group);
            if (groupMembers?.some(m => m?.name && namesMatch(m.name, name) && m.avatar && m.avatar !== 'none')) {
                return true;
            }
        }
        if (characters?.some(c => c?.name && namesMatch(c.name, name) && c.avatar && c.avatar !== 'none')) {
            return true;
        }
        if (this_chid !== undefined && characters?.[this_chid]?.name && namesMatch(characters[this_chid].name, name)) {
            return !!characters[this_chid].avatar && characters[this_chid].avatar !== 'none';
        }
    } catch {}
    return false;
}

function getSceneInfoBox() {
    return committedTrackerData.infoBox || lastGeneratedData.infoBox || extensionSettings.infoBox || '';
}

function getStateHash(character) {
    const info = {
        name: character.name,
        details: character.details || {},
        thoughts: character.thoughts || '',
        stats: character.stats || {},
        equipment: character.equipment || character.equipement || '',
        effects: character.effects || '',
        status: character.status || '',
        infoBox: getSceneInfoBox(),
    };
    return hashText(stableStringify(info));
}

function mayOverwrite(name, stateHash) {
    const meta = getGeneratedMeta(name);
    return meta?.source === SOURCE && !!extensionSettings.npcAvatars?.[name] && (!stateHash || meta.stateHash !== stateHash);
}

function needsPortrait(character) {
    const mode = getMode();
    if (mode === 'off') return false;

    const stateHash = getStateHash(character);
    const generated = getGeneratedMeta(character.name);
    if (hasStCharacterAvatar(character.name)) return false;

    if (mode === 'every_reply') {
        return generated?.source === SOURCE || !hasExistingAvatar(character.name);
    }
    if (mode === 'state_changed') {
        if (generated?.source === SOURCE) return generated.stateHash !== stateHash;
        return !hasExistingAvatar(character.name);
    }
    return !hasExistingAvatar(character.name);
}

function getEligibleCharacters() {
    if (!isEnabled()) return [];
    return getPresentCharacters().filter(needsPortrait);
}

function characterSummary(character) {
    const pieces = [`Name: ${character.name}`];
    if (character.details && typeof character.details === 'object') {
        for (const [key, value] of Object.entries(character.details)) {
            if (value !== undefined && value !== null && String(value).trim()) {
                pieces.push(`${key}: ${String(value).trim()}`);
            }
        }
    }
    for (const key of ['relationship', 'status', 'equipment', 'equipement', 'effects']) {
        if (character[key]) pieces.push(`${key}: ${String(character[key]).trim()}`);
    }
    const thoughts = character.thoughts?.content || character.thoughts || '';
    if (thoughts) pieces.push(`thoughts: ${String(thoughts).trim()}`);
    if (character.stats && typeof character.stats === 'object') {
        pieces.push(`stats: ${Object.entries(character.stats).map(([k, v]) => `${k}: ${v}`).join(', ')}`);
    }
    return pieces.join('\n');
}

function getSceneLocation() {
    try {
        const info = typeof getSceneInfoBox() === 'string' ? JSON.parse(getSceneInfoBox()) : getSceneInfoBox();
        return info?.location?.value || info?.location || '';
    } catch {
        return '';
    }
}

function buildDeterministicPrompt(character) {
    const details = character.details || {};
    const appearance = details.appearance || details.Appearance || '';
    const demeanor = details.demeanor || details.Demeanor || '';
    const equipment = character.equipment || character.equipement || details.equipment || details.equipement || '';
    const effects = character.effects || details.effects || '';
    const location = getSceneLocation();
    return `${character.name} is framed alone in a cinematic medium portrait, with the current appearance from the scene clearly visible: ${appearance || 'their tracked current appearance is preserved exactly'}. The pose and expression show ${demeanor || 'the emotional state implied by the latest scene'}, and ${equipment || 'their current clothing and carried objects'} remain visible where relevant. ${effects ? `Their current body state and ongoing effects are visible: ${effects}. ` : ''}${location ? `The background places them in ${location}, kept secondary so the character remains the centerpiece. ` : ''}The lighting and camera angle emphasize the character's present mood and continuity from the story.`;
}

function getCustomAutoPortraitPrompt() {
    return String(extensionSettings.customAutoPortraitPrompt || DEFAULT_AUTO_PORTRAIT_PROMPT || '').trim();
}

function applyPromptTemplate(template, characters) {
    const roster = characters.map(c => `- ${characterSummary(c)}`).join('\n\n');
    return String(template || DEFAULT_AUTO_PORTRAIT_PROMPT)
        .replaceAll('{characterNames}', characters.map(c => c.name).join(', '))
        .replaceAll('{characterList}', roster)
        .replaceAll('{portraitTag}', 'des_portraits')
        .replaceAll('{sceneInfo}', String(getSceneInfoBox() || ''));
}

function buildPromptInjectionText(characters) {
    if (!characters.length) return '';
    const body = applyPromptTemplate(getCustomAutoPortraitPrompt(), characters);
    return `<des_auto_portraits>
${body}
</des_auto_portraits>`;
}

function syncPromptInjection() {
    ensureSettings();
    try {
        if (!isEnabled() || getPromptSource() !== 'main_reply_tag') {
            setExtensionPrompt(PROMPT_KEY, '', extension_prompt_types.IN_CHAT, 0, false, extension_prompt_roles.SYSTEM);
            return;
        }
        const eligible = getEligibleCharacters();
        setExtensionPrompt(PROMPT_KEY, buildPromptInjectionText(eligible), extension_prompt_types.IN_CHAT, 0, false, extension_prompt_roles.SYSTEM);
    } catch (error) {
        console.warn('[DES Auto Portraits] Failed to sync prompt injection:', error);
    }
}

function extractPortraitBlocks(text) {
    const prompts = [];
    let cleaned = String(text || '');
    cleaned = cleaned.replace(PORTRAIT_TAG_RE, (_, jsonText) => {
        try {
            const parsed = JSON.parse(String(jsonText).trim());
            if (Array.isArray(parsed)) {
                for (const entry of parsed) {
                    if (entry?.name && entry?.prompt) {
                        prompts.push({ name: String(entry.name).trim(), prompt: String(entry.prompt).trim() });
                    }
                }
            }
        } catch (error) {
            console.warn('[DES Auto Portraits] Invalid <des_portraits> JSON:', error);
        }
        return '';
    });
    return { prompts, cleaned };
}

async function generatePromptWithLlm(character) {
    const promptRules = applyPromptTemplate(getCustomAutoPortraitPrompt(), [character]);
    const systemPrompt = `You create natural-language image prompts for Doom's Enhancement Suite portrait cards. Use the user's Auto Portrait prompt rules below, but output only one cinematic paragraph for this one character. Do not output XML tags, JSON, markdown, or [pic prompt] text.\n\n${promptRules}`;
    const context = [
        getSceneInfoBox() ? `Scene info:\n${getSceneInfoBox()}` : '',
        `Character state:\n${characterSummary(character)}`,
    ].filter(Boolean).join('\n\n');
    try {
        const response = await generateRaw({
            prompt: `${context}\n\nCreate the portrait prompt for ${character.name}.`,
            systemPrompt,
            instructOverride: false,
            responseLength: 900,
        });
        const prompt = String(response || '').replace(/^prompt:\s*/i, '').trim();
        return prompt || buildDeterministicPrompt(character);
    } catch (error) {
        console.warn(`[DES Auto Portraits] LLM prompt generation failed for ${character.name}:`, error);
        return buildDeterministicPrompt(character);
    }
}

function extractImageUrl(result) {
    if (!result) return null;
    if (typeof result === 'string') {
        const trimmed = result.trim();
        if (/^(https?:|data:image|\/)/i.test(trimmed)) return trimmed;
        const match = trimmed.match(/(?:src|href)=["']([^"']+)["']/i);
        return match?.[1] || null;
    }
    if (typeof result === 'object') {
        const url = result.pipe || result.output || result.image || result.url || result.result;
        if (typeof url === 'string' && /^(https?:|data:image|\/)/i.test(url)) return url;
    }
    return null;
}

async function runSd(prompt) {
    if (SlashCommandParser.commands?.sd?.callback) {
        const result = await SlashCommandParser.commands.sd.callback({ quiet: 'true' }, prompt);
        const url = extractImageUrl(result);
        if (url) return url;
    }
    const fallback = await executeSlashCommandsOnChatInput(`/sd quiet=true ${prompt}`, { clearChatInput: false });
    return extractImageUrl(fallback);
}

async function generatePortrait(character, prompt) {
    const stateHash = getStateHash(character);
    if (pendingGenerations.has(character.name)) return;
    if (hasStCharacterAvatar(character.name)) return;
    if (hasExistingAvatar(character.name) && !mayOverwrite(character.name, stateHash)) return;

    pendingGenerations.add(character.name);
    setSyncedExpressionLabel(character.name, 'generating');
    refreshExpressionConsumers();
    try {
        const imageUrl = await runSd(prompt);
        if (!imageUrl) {
            if (!warnedSdUnavailable) {
                warnedSdUnavailable = true;
                window?.toastr?.warning?.('/sd returned no image. Check SillyTavern image generation settings.', 'DES Auto Portraits');
            }
            console.warn(`[DES Auto Portraits] /sd returned no image for ${character.name}`);
            return;
        }
        if (!extensionSettings.npcAvatars) extensionSettings.npcAvatars = {};
        extensionSettings.npcAvatars[character.name] = imageUrl;
        setGeneratedMeta(character.name, {
            prompt,
            stateHash,
            createdAt: getGeneratedMeta(character.name)?.createdAt || Date.now(),
        });
        setSyncedExpressionLabel(character.name, 'generated');
        saveSettings();
        saveChatData();
        refreshExpressionConsumers();
    } catch (error) {
        console.error(`[DES Auto Portraits] Generation failed for ${character.name}:`, error);
    } finally {
        pendingGenerations.delete(character.name);
    }
}

function enqueuePortraits(entries) {
    for (const entry of entries) {
        queue = queue.then(async () => {
            const character = getPresentCharacters().find(c => normalizeName(c.name) === normalizeName(entry.name));
            if (!character || !needsPortrait(character)) return;
            await generatePortrait(character, entry.prompt || buildDeterministicPrompt(character));
        }).catch(error => console.error('[DES Auto Portraits] Queue error:', error));
    }
}

async function generateWithoutMainReplyTag() {
    const eligible = getEligibleCharacters();
    const entries = [];
    for (const character of eligible) {
        const prompt = getPromptSource() === 'separate_hidden_call'
            ? await generatePromptWithLlm(character)
            : buildDeterministicPrompt(character);
        entries.push({ name: character.name, prompt });
    }
    enqueuePortraits(entries);
}

function cleanLatestMessageIfNeeded(messageText) {
    const idx = chat.length - 1;
    const message = chat[idx];
    const { prompts, cleaned } = extractPortraitBlocks(messageText || message?.mes || '');
    if (message && prompts.length && cleaned !== message.mes) {
        message.mes = cleaned.trim();
        try { saveChatDebounced(); } catch {}
        try { eventSource.emit(event_types.MESSAGE_UPDATED, idx); } catch {}
    }
    return prompts;
}

export async function classifyAllCharacterExpressions(messageText) {
    if (!isEnabled()) return;
    syncPromptInjection();
    if (getPromptSource() === 'main_reply_tag') {
        const prompts = cleanLatestMessageIfNeeded(messageText);
        if (prompts.length) {
            enqueuePortraits(prompts);
        } else {
            await generateWithoutMainReplyTag();
        }
        return;
    }
    await generateWithoutMainReplyTag();
}

export async function classifyActiveUserExpression() {
    return;
}

let refreshFrame = 0;
function refreshExpressionConsumers() {
    if (refreshFrame) cancelAnimationFrame(refreshFrame);
    refreshFrame = requestAnimationFrame(() => {
        refreshFrame = 0;
        renderThoughts({ preserveScroll: true });
        updatePortraitBar();
        import('../rendering/chatBubbles.js').then(m => m.refreshBubbleAvatars()).catch(() => {});
    });
}

export function getExpressionPortraitForCharacter() {
    return null;
}

export function invalidateSpriteCacheFor() {
    return;
}

export function clearSpriteCache() {
    return;
}

function getHideStyleCss() {
    return `
#expression-image,
#expression-holder,
.expression-holder,
[data-expression-container],
#expression-image img,
#expression-holder img,
.expression-holder img,
[data-expression-container] img {
    position: absolute !important;
    left: -10000px !important;
    top: 0 !important;
    width: 1px !important;
    height: 1px !important;
    overflow: hidden !important;
    opacity: 0 !important;
    pointer-events: none !important;
    visibility: hidden !important;
}
`;
}

function hideNativeExpressionDisplay() {
    if (hiddenExpressionStyleElement?.isConnected) return;
    const styleElement = document.createElement('style');
    styleElement.id = 'rpg-hidden-native-expression-display-style';
    styleElement.textContent = getHideStyleCss();
    document.head.appendChild(styleElement);
    hiddenExpressionStyleElement = styleElement;
}

function showNativeExpressionDisplay() {
    if (hiddenExpressionStyleElement?.isConnected) hiddenExpressionStyleElement.remove();
    else document.getElementById('rpg-hidden-native-expression-display-style')?.remove();
    hiddenExpressionStyleElement = null;
}

function syncNativeExpressionDisplayVisibility() {
    if (extensionSettings.enabled && extensionSettings.hideDefaultExpressionDisplay) hideNativeExpressionDisplay();
    else showNativeExpressionDisplay();
}

function installPromptHooks() {
    if (promptHooksInstalled) return;
    promptHooksInstalled = true;
    try {
        for (const type of [event_types.GENERATION_STARTED, event_types.CHAT_CHANGED, event_types.CHAT_LOADED].filter(Boolean)) {
            eventSource.on(type, syncPromptInjection);
        }
    } catch {}
}

export function queueExpressionCaptureForSpeaker() {
    return;
}

export function syncExpressionFromLatestMessage() {
    if (!isEnabled()) return;
    const lastMessage = chat[chat.length - 1];
    if (lastMessage && !lastMessage.is_user) classifyAllCharacterExpressions(lastMessage.mes);
}

export function initExpressionSync() {
    ensureSettings();
    installPromptHooks();
    syncNativeExpressionDisplayVisibility();
    syncPromptInjection();
}

export function onExpressionSyncChatChanged() {
    pendingGenerations.clear();
    syncNativeExpressionDisplayVisibility();
    syncPromptInjection();
}

export function onExpressionSyncSettingChanged() {
    ensureSettings();
    if (getMode() === 'off') {
        clearSyncedExpressionPortraits();
        setExtensionPrompt(PROMPT_KEY, '', extension_prompt_types.IN_CHAT, 0, false, extension_prompt_roles.SYSTEM);
        refreshExpressionConsumers();
    } else {
        syncPromptInjection();
    }
    syncNativeExpressionDisplayVisibility();
}

export function onHideDefaultExpressionDisplaySettingChanged() {
    syncNativeExpressionDisplayVisibility();
}

export function clearExpressionSyncCache() {
    clearSyncedExpressionPortraits();
    pendingGenerations.clear();
}
