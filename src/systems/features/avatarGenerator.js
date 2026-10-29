/**
 * Portraits — the pictures on the Present Characters cards.
 *
 * Every portrait DES draws goes through the image service
 * (src/systems/features/imageGen.js: Settings → Image Generation decides
 * the source). Two ways in:
 *
 * - Automatic, after a fresh reply, under the one rule on the page
 *   (Portraits: Off / Only missing / State changed / Every reply), the same
 *   in every tracker mode and never from a recovery (docs/image-gen-plan.md
 *   D75–D77; the rule itself is portraitPlan in src/utils/imageGen.js).
 * - On request: the Workshop's Render portrait and the card menu's
 *   Regenerate, whatever the mode says.
 *
 * The prompt is the character's own Portrait prompt line when one is kept,
 * else written by the LLM from the tracker's entry; the page's portrait
 * preamble, negative and size shape the picture, and on ComfyUI direct the
 * character's own LoRAs ride it ahead of the page's list.
 */
import { characters, this_chid } from '../../../../../../../script.js';
import { safeGenerateRaw } from '../../utils/responseExtractor.js';
import { selected_group, getGroupMembers } from '../../../../../../group-chats.js';
import { renderImage, sourceProblem, imageCfg } from './imageGen.js';
import { portraitPlan, portraitStateHash } from '../../utils/imageGen.js';
import { parseLoraList } from '../../utils/scenePictures.js';
import { normalizeLoras } from '../../utils/comfy.js';
import { extensionSettings, sessionAvatarPrompts, setSessionAvatarPrompt } from '../../core/state.js';
import { saveSettings } from '../../core/persistence.js';
import { deletePortraitsIfUnreferenced, isDataUrl, persistPortrait, stashCurrentPortraitToHistory } from '../../utils/avatars.js';
import { BASE_VERSION, getActiveCampaignId, hasProfile, portraitRefCount, readVersion, writeVersion } from '../lorebook/campaignProfiles.js';
import { generateAvatarPromptGenerationPrompt, generateAutoPortraitPromptGenerationPrompt, generateDescriptionPortraitPrompt } from '../generation/promptBuilder.js';
import { getCurrentPresetName, switchToPreset, generateWithExternalAPI } from '../generation/apiClient.js';
import { hasPendingAliasDecision } from './characterAliases.js';
// Generation state - tracks characters currently being generated
const pendingGenerations = new Set();
const AUTO_PORTRAIT_SOURCE = 'des.autoPortrait';
let saidSo = false;             // D77: the first automatic run in a session says so, once
let warnedSource = false;       // the "cannot draw" warning, once a session

/**
 * Flattens a portrait prompt to a single clean line before it goes into
 * `/sd`, and neutralizes every character that detonates somewhere in the
 * delivery chain (verified against ST's stable-diffusion extension source):
 *
 * - newlines: broke ComfyUI workflow-JSON substitution on older ST builds
 *   (plain string replace into JSON; current builds JSON.stringify), and
 *   /sd free-mode prompts bypass ST's own processReply() sanitizer entirely.
 * - `|`: STscript's command separator — a pipe in an LLM-written prompt
 *   truncates the /sd command and executes the remainder as STscript.
 * - `{{` `}}`: macro syntax — substituteParams() runs on free-mode prompts,
 *   so stray braces get macro-expanded into who-knows-what.
 * - `"`: unescaped quotes broke the older workflow-JSON substitution too.
 */
export function sanitizePortraitPrompt(prompt) {
    return String(prompt || '')
        .replace(/\s*[\r\n]+\s*/g, ', ')    // newlines → comma-space
        .replace(/\|/g, ', ')               // STscript pipe → separator
        .replace(/\{\{|\}\}/g, ' ')         // defuse {{macro}} syntax
        .replace(/["“”]/g, '\'')            // quotes → apostrophes
        .replace(/(?:\s*,\s*)+/g, ', ')     // collapse comma runs (",,", ", ,")
        .replace(/\s+/g, ' ')               // collapse whitespace
        .replace(/^[,\s]+|[,\s]+$/g, '');   // no leading/trailing commas
}

/**
 * Can the chosen image source draw right now? (Settings → Image Generation:
 * SillyTavern's extension loaded, or a ComfyUI workflow picked.) The name
 * is the old one; the Workshop and the card menu read it.
 */
export function isSdAvailable() {
    return sourceProblem() === '';
}

/** Why it cannot, '' when it can: for the Workshop's and the card menu's messages. */
export function imageSourceProblem() {
    return sourceProblem();
}

/**
 * The user-maintained, appearance-only portrait prompt for a character
 * (Workshop → Appearance → "Portrait prompt"). When set, portrait
 * generation uses THIS line verbatim instead of asking the LLM to write a
 * prompt — single-line tag-style appearance prompts outperform prose dumps
 * on SD-family backends, stay consistent between regenerations, and give
 * the user a knob instead of a mystery. For the player's card (isUser) the
 * line on their own user-card entry comes first (D91), then the NPC store's
 * line for the name (a persona copied from an NPC keeps it).
 * @param {{ isUser?: boolean }} [opts]
 */
export function getCharacterAppearance(characterName, { isUser = false } = {}) {
    if (!characterName) return '';
    if (isUser) {
        const own = extensionSettings.userCharacters?.[characterName]?.appearance;
        if (typeof own === 'string' && own.trim()) return own.trim();
    }
    const store = extensionSettings.characterAppearance;
    if (!store) return '';
    if (typeof store[characterName] === 'string') return store[characterName].trim();
    const lower = characterName.toLowerCase();
    for (const [key, value] of Object.entries(store)) {
        if (key.toLowerCase() === lower && typeof value === 'string') return value.trim();
    }
    return '';
}

/**
 * The LoRAs kept for a character (Workshop → Appearance → "LoRAs for this
 * character", one per line, name:strength), as a list. Spliced into the
 * workflow ahead of the page's own list when the source is ComfyUI direct.
 * The player's card (isUser): the list on their own entry first (D91).
 * @param {{ isUser?: boolean }} [opts]
 */
export function getCharacterLoras(characterName, { isUser = false } = {}) {
    if (!characterName) return [];
    if (isUser) {
        const own = extensionSettings.userCharacters?.[characterName]?.loras;
        if (typeof own === 'string' && own.trim()) return parseLoraList(own);
    }
    const store = extensionSettings.characterLoras;
    if (!store) return [];
    let text = '';
    if (typeof store[characterName] === 'string') text = store[characterName];
    else {
        const lower = characterName.toLowerCase();
        for (const [key, value] of Object.entries(store)) if (key.toLowerCase() === lower && typeof value === 'string') { text = value; break; }
    }
    return parseLoraList(text);
}

/** Are automatic portraits on at all (the page's mode is not Off)? */
export function isAutoPortraitModeEnabled() {
    return Boolean(extensionSettings.enabled && imageCfg().portraits.mode !== 'off');
}

function getGeneratedPortraitMeta(characterName) {
    const meta = extensionSettings.generatedPortraits?.[characterName];
    if (meta?.source !== AUTO_PORTRAIT_SOURCE) return null;
    const currentUrl = extensionSettings.npcAvatars?.[characterName];
    if (meta.url && currentUrl && meta.url !== currentUrl) return null;
    return meta;
}

function buildGeneratedPortraitMeta(prompt, stateHash, url) {
    return {
        source: AUTO_PORTRAIT_SOURCE,
        prompt,
        stateHash,
        url,
        createdAt: Date.now(),
    };
}

function setGeneratedPortraitMeta(characterName, prompt, stateHash, url) {
    if (!extensionSettings.generatedPortraits || typeof extensionSettings.generatedPortraits !== 'object') {
        extensionSettings.generatedPortraits = {};
    }
    extensionSettings.generatedPortraits[characterName] = buildGeneratedPortraitMeta(prompt, stateHash, url);
}

/**
 * The version of `characterName` the live stores hold right now: the active
 * campaign's when it overrides the name, else Base. Captured BEFORE a
 * generation awaits so its result can be filed where it belongs.
 */
function liveVersionIdFor(characterName) {
    const active = getActiveCampaignId();
    return active && hasProfile(active, characterName) ? active : BASE_VERSION;
}

/**
 * Portrait generation awaits /sd (and often an LLM prompt) for many seconds.
 * If the user switched the active campaign meanwhile, the live stores now
 * belong to a different campaign and the result must land in the version
 * it was generated for instead. Returns true when it did so (the caller
 * must then NOT write the live stores).
 * @param {string|null} campaignAtStart - getActiveCampaignId() when the generation began
 * @param {string} startVersionId - liveVersionIdFor(characterName) when it began — 'base'
 *   when the campaign did not override the character, so a Base portrait never
 *   invents a campaign version out of thin air
 */
function storeResultInStartingVersion(campaignAtStart, startVersionId, characterName, imageUrl, meta = null) {
    if (getActiveCampaignId() === campaignAtStart) return false;
    const versionId = startVersionId || BASE_VERSION;
    const profile = readVersion(versionId, characterName) || {};
    profile.avatar = imageUrl;
    if (meta) profile.portraitMeta = meta;
    writeVersion(versionId, characterName, profile);
    console.log(`[Dooms Tracker] portrait for ${characterName} finished after a campaign switch — stored in the version it was generated for`);
    return true;
}

function stripReasoning(text) {
    if (!text) return '';
    return String(text)
        .replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, '')
        .replace(/<reasoning>[\s\S]*?<\/reasoning>/gi, '')
        .replace(/<reflection>[\s\S]*?<\/reflection>/gi, '')
        .replace(/<\|start\|>assistant<\|channel\|>(?:analysis|thought)[\s\S]*?(?=<\|start\|>assistant<\|channel\|>final<\|message\|>|$)/gi, '')
        .replace(/<\|channel\|>(?:analysis|thought)<\|message\|>[\s\S]*?(?=<\|channel\|>final<\|message\|>|$)/gi, '')
        .replace(/<channel\|>(?:analysis|thought)[\s\S]*?(?=<channel\|>final|$)/gi, '')
        .replace(/<\|start\|>assistant<\|channel\|>final<\|message\|>/gi, '')
        .replace(/<\|channel\|>final<\|message\|>/gi, '')
        .replace(/<channel\|>final/gi, '')
        .trim();
}
/**
 * Checks if a character is pending generation (waiting or actively generating)
 * @param {string} characterName - Name of character to check
 * @returns {boolean} True if generation is pending
 */
export function isGenerating(characterName) {
    return pendingGenerations.has(characterName);
}
/**
 * Checks if any avatars are currently being generated
 * @returns {boolean} True if any generation is in progress
 */
export function isAnyGenerating() {
    return pendingGenerations.size > 0;
}
/**
 * Gets all characters currently pending generation
 * @returns {string[]} Array of character names
 */
export function getPendingGenerations() {
    return [...pendingGenerations];
}
/**
 * Helper to check if two character names match (case-insensitive, handles partial matches)
 * @param {string} cardName - Name from character card
 * @param {string} aiName - Name from AI response
 * @returns {boolean} True if names match
 */
function namesMatch(cardName, aiName) {
    if (!cardName || !aiName) return false;
    const cardLower = cardName.toLowerCase().trim();
    const aiLower = aiName.toLowerCase().trim();
    if (cardLower === aiLower) return true;
    const cardCore = cardLower.split(/[\s,'"]+/)[0];
    const aiCore = aiLower.split(/[\s,'"]+/)[0];
    if (cardCore === aiCore) return true;
    const escapedCardCore = cardCore.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const wordBoundary = new RegExp(`\\b${escapedCardCore}\\b`);
    return wordBoundary.test(aiCore);
}
/** The portrait DES holds for a character ('' when none). */
function portraitOf(characterName) {
    const avatar = extensionSettings.npcAvatars ? extensionSettings.npcAvatars[characterName] : '';
    return typeof avatar === 'string' ? avatar : '';
}

/**
 * Checks if a character already has an avatar (custom NPC avatar or from character card)
 * @param {string} characterName - Name of character to check
 * @returns {boolean} True if character has an avatar
 */
export function hasExistingAvatar(characterName) {
    return !!portraitOf(characterName) || hasCardAvatar(characterName);
}

/** Does a SillyTavern card (a group member, a character, the chat's own) already give this name a face? */
export function hasCardAvatar(characterName) {
    // Check group members for avatar
    if (selected_group) {
        try {
            const groupMembers = getGroupMembers(selected_group);
            if (groupMembers && groupMembers.length > 0) {
                const matchingMember = groupMembers.find(member =>
                    member && member.name && namesMatch(member.name, characterName)
                );
                if (matchingMember && matchingMember.avatar && matchingMember.avatar !== 'none') {
                    return true;
                }
            }
        } catch (e) {
            // Ignore errors
        }
    }
    // Check all characters for avatar
    if (characters && characters.length > 0) {
        const matchingCharacter = characters.find(c =>
            c && c.name && namesMatch(c.name, characterName)
        );
        if (matchingCharacter && matchingCharacter.avatar && matchingCharacter.avatar !== 'none') {
            return true;
        }
    }
    // Check current character in 1-on-1 chat
    if (this_chid !== undefined && characters[this_chid] &&
        characters[this_chid].name && namesMatch(characters[this_chid].name, characterName)) {
        if (characters[this_chid].avatar && characters[this_chid].avatar !== 'none') {
            return true;
        }
    }
    return false;
}

function normalizeCharacterEntries(characterEntries) {
    if (!Array.isArray(characterEntries)) return [];
    return characterEntries
        .map(entry => typeof entry === 'string' ? { name: entry } : entry)
        .filter(entry => entry && entry.name && String(entry.name).toLowerCase() !== 'unavailable');
}

/**
 * A portrait DES made before 3.2 carries a hash of the whole tracker entry;
 * the rule's hash (portraitStateHash) reads only what a portrait shows. The
 * first look after the upgrade adopts the current state as that portrait's
 * state, so "State changed" does not redraw every portrait once.
 * @returns {boolean} whether any record changed (the caller saves)
 */
function adoptLegacyPortraitHashes(entries) {
    let changed = false;
    for (const entry of entries) {
        const meta = getGeneratedPortraitMeta(entry.name);
        if (!meta || (typeof meta.stateHash === 'string' && meta.stateHash.startsWith('v1:'))) continue;
        meta.stateHash = portraitStateHash(entry);
        changed = true;
    }
    return changed;
}

/**
 * The facts the rule asks about each name: the portrait held, the state a
 * DES-made one was drawn from, whether one is being made, whether a card
 * already gives the face.
 */
function portraitFacts() {
    return {
        existing: (name) => portraitOf(name),
        generatedHash: (name) => { const meta = getGeneratedPortraitMeta(name); return meta ? (meta.stateHash || '') : null; },
        pending: (name) => pendingGenerations.has(name),
        cardAvatar: (name) => hasCardAvatar(name),
    };
}

/**
 * Which of these present characters would get a portrait now, and why not
 * (for the diagnostics and the tests). Draws nothing.
 * @param {Array} characterEntries - the tracker's entries
 * @param {{ fresh?: boolean, recovery?: boolean }} [when]
 */
export function planAutoPortraits(characterEntries, when = {}) {
    if (!extensionSettings.enabled) return { names: [], hashes: {}, reason: 'DES off' };
    const entries = normalizeCharacterEntries(characterEntries).filter(e => !hasPendingAliasDecision(e.name));
    return portraitPlan(imageCfg(), entries, portraitFacts(), when);
}

/**
 * Portraits after a reply, under the page's rule (D75–D77).
 * @param {Array} characterEntries - the tracker's present characters
 * @param {string} [messageText] - the reply, for the LLM's prompt
 * @param {Function|null} [onStarted] - called with the names once they are reserved (the cards show a spinner)
 * @param {{ fresh?: boolean, recovery?: boolean }} [when] - fresh: a reply just arrived or Refresh was pressed; recovery: the repair request (never draws)
 */
export async function generateAutoPortraitsForCharacters(characterEntries, messageText = '', onStarted = null, when = {}) {
    if (!isAutoPortraitModeEnabled()) return;
    const entries = normalizeCharacterEntries(characterEntries)
        // Never spend a render on a name whose duplicate-decision popup is
        // still open — a Yes answer folds the card away and orphans the art.
        // If the name survives (No/Escape), the next message queues it.
        .filter(e => !hasPendingAliasDecision(e.name));
    if (adoptLegacyPortraitHashes(entries)) saveSettings();
    const plan = portraitPlan(imageCfg(), entries, portraitFacts(), when);
    if (!plan.names.length) return;
    const problem = sourceProblem();
    if (problem) {
        if (!warnedSource) {
            warnedSource = true;
            console.warn(`[DES Portraits] not drawing: ${problem}`);
            if (typeof toastr !== 'undefined') toastr.warning(`Portraits are on, but ${problem}.`, 'Image Generation', { timeOut: 8000 });
        }
        return;
    }
    const queue = plan.names.map(name => ({ characterData: entries.find(e => String(e.name).trim() === name) || { name }, stateHash: plan.hashes[name] }));
    for (const item of queue) pendingGenerations.add(item.characterData.name);
    saySo(plan.names);
    if (onStarted) {
        try {
            onStarted(queue.map(item => item.characterData.name));
        } catch (e) {
            console.error('[DES Portraits] Error in onStarted callback:', e);
        }
    }
    for (let i = 0; i < queue.length; i++) {
        const { characterData, stateHash } = queue[i];
        const name = characterData.name;
        try {
            const prompt = await generateAutoPortraitPrompt(characterData, messageText);
            await generateSingleAutoPortrait(name, prompt, stateHash);
        } catch (error) {
            console.error(`[DES Portraits] Failed for ${name}:`, error);
        } finally {
            pendingGenerations.delete(name);
        }
        if (i < queue.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 500));
        }
    }
}

/** D77: the first automatic run in a session names the characters, the source, and where the switch is. */
function saySo(names) {
    if (saidSo) return;
    saidSo = true;
    const g = imageCfg();
    if (!g.portraits.notify) return;
    const source = g.source === 'comfy' ? 'ComfyUI (direct)' : "SillyTavern's Image Generation";
    const list = names.length > 3 ? `${names.slice(0, 3).join(', ')} and ${names.length - 3} more` : names.join(', ');
    const mode = { only_missing: 'Only missing', state_changed: 'State changed', every_reply: 'Every reply' }[g.portraits.mode] || g.portraits.mode;
    if (typeof toastr !== 'undefined') {
        toastr.info(`Drawing portraits for ${list} with ${source} (Portraits: ${mode}). Settings → Image Generation → Portraits to change or switch off.`, 'Image Generation', { timeOut: 10000 });
    }
    console.log(`[DES Portraits] drawing ${names.join(', ')} with ${source} (${g.portraits.mode})`);
}

/**
 * One portrait through the image service: the page's preamble, negative and
 * size around the character's prompt. Returns the picture as the source
 * gave it (a URL the extension saved, or ComfyUI's data URL), '' for none.
 */
async function renderPortrait(prompt, characterName = '', { isUser = false } = {}) {
    const p = imageCfg().portraits;
    const loras = normalizeLoras([...getCharacterLoras(characterName, { isUser }), ...(p.loras || [])]);    // the character's own first; a name in both counts once
    const out = await renderImage({ purpose: 'portrait', prompt: `${p.preamble || ''}${prompt}`.trim(), negative: p.negative || '', size: p.size, loras });
    return out.url || out.dataUrl || '';
}

async function generateAutoPortraitPrompt(characterData, messageText = '') {
    const name = characterData?.name || 'Unknown Character';
    // A user-maintained appearance line skips LLM prompt-writing entirely.
    const appearance = getCharacterAppearance(name);
    if (appearance) return appearance;
    try {
        const promptMessages = await generateAutoPortraitPromptGenerationPrompt(characterData, messageText);
        let response;
        if (extensionSettings.generationMode === 'external') {
            response = await generateWithExternalAPI(promptMessages);
        } else {
            response = await safeGenerateRaw({
                prompt: promptMessages,
                quietToLoud: false,
            });
        }
        const prompt = stripReasoning(response)
            .replace(/^["']|["']$/g, '')
            .replace(/^prompt\s*:\s*/i, '')
            .trim();
        if (prompt) return prompt;
    } catch (error) {
        console.error(`[DES Auto Portraits] Prompt generation failed for ${name}:`, error);
    }
    return buildAutoPortraitFallbackPrompt(characterData);
}

function buildAutoPortraitFallbackPrompt(characterData) {
    const name = characterData?.name || String(characterData || 'Unknown Character');
    const details = [];
    const relationship = characterData?.relationship || characterData?.role;
    const appearance = characterData?.details?.appearance || characterData?.appearance;
    const demeanor = characterData?.details?.demeanor || characterData?.demeanor;
    const equipment = characterData?.details?.equipment || characterData?.details?.equipement || characterData?.equipment || characterData?.equipement;
    const effects = characterData?.details?.effects || characterData?.effects || characterData?.status;
    for (const value of [relationship, appearance, demeanor, equipment, effects]) {
        if (value) details.push(String(value));
    }
    const body = details.length ? ` ${details.join(' ')}` : '';
    return `${name} stands alone in a cinematic character portrait, framed from the waist up with the current scene shaping their posture and expression.${body}`;
}

async function generateSingleAutoPortrait(characterName, prompt, stateHash) {
    if (!prompt) {
        prompt = buildAutoPortraitFallbackPrompt({ name: characterName });
    }
    const previous = extensionSettings.npcAvatars?.[characterName];
    const campaignAtStart = getActiveCampaignId();
    const startVersionId = liveVersionIdFor(characterName);
    const previousMeta = getGeneratedPortraitMeta(characterName);
    try {
        let imageUrl = await renderPortrait(prompt, characterName);
        if (!imageUrl) {
            console.warn(`[DES Portraits] the image source returned no picture for ${characterName}`);
            return null;
        }
        if (!extensionSettings.npcAvatars) {
            extensionSettings.npcAvatars = {};
        }
        if (isDataUrl(imageUrl)) {
            // Only the previous portrait's own entry may point at its file
            // for the upload to reuse the filename (persistPortrait
            // overwrites in place). A campaign version cloned from Base
            // shares Base's file — overwriting it would silently repaint the
            // other version too. Decided NOW, not before the /sd await: a
            // version cloned while it ran shares the file as well.
            const reusable = previous && portraitRefCount(previous) <= 1 ? previous : null;
            imageUrl = await persistPortrait(reusable, characterName, imageUrl);
        }
        const meta = buildGeneratedPortraitMeta(prompt, stateHash, imageUrl);
        if (!storeResultInStartingVersion(campaignAtStart, startVersionId, characterName, imageUrl, meta)) {
            extensionSettings.npcAvatars[characterName] = imageUrl;
            setGeneratedPortraitMeta(characterName, prompt, stateHash, imageUrl);
        }
        saveSettings();
        // The replaced auto-portrait file goes only if nothing still references it.
        if (previous && previousMeta && previous !== imageUrl) {
            deletePortraitsIfUnreferenced([previous]).catch(() => {});
        }
        return imageUrl;
    } catch (error) {
        console.error(`[DES Portraits] generation failed for ${characterName}:`, error);
        return null;
    }
}
/**
 * Regenerates avatar for a specific character
 * Clears existing avatar and prompt, then generates new ones
 * Handles preset switching if useSeparatePreset is enabled
 *
 * @param {string} characterName - Name of character to regenerate
 * @param {{ isUser?: boolean }} [opts] isUser: the player's card — its own
 *        entry is read and written, never the NPC stores (D91)
 * @returns {Promise<string|null>} New avatar URL or null if failed
 */
export async function regenerateAvatar(characterName, { isUser = false } = {}) {
    // Re-entry guard — a second call while one is in flight would delete the
    // half-written result and double-bill the image API.
    if (pendingGenerations.has(characterName)) return null;
    // Mark as pending immediately
    pendingGenerations.add(characterName);
    // Move the existing portrait (BOTH stores — leaving npcAvatarsFullRes
    // live would keep showing the old image in the sheet popup's hero art)
    // into the character's portrait history instead of deleting it. The old
    // file stays in the des-portraits folder and "Restore Previous Portrait"
    // can bring it back.
    stashCurrentPortraitToHistory(characterName, { isUser });
    saveSettings();
    // Clear existing prompt cache
    if (sessionAvatarPrompts[characterName]) {
        delete sessionAvatarPrompts[characterName];
    }
    try {
        // Generate new LLM prompt
        const prompt = await generateAvatarPrompt(characterName, { isUser });
        // Generate the avatar
        return await generateSingleAvatar(characterName, prompt, { isUser });
    } finally {
        // Remove from pending when done
        pendingGenerations.delete(characterName);
    }
}
/**
 * Step 1 of the Workshop's description→portrait flow: distill the Injection
 * description into a single-line tag prompt. NO image is generated — the
 * Workshop puts the result in the Portrait prompt field for the user to
 * review and tweak before rendering (step 2, generateAvatarWithPrompt).
 *
 * @param {string} characterName
 * @param {string} description - The Injection section's description text
 * @returns {Promise<string>} The distilled prompt, or '' if the LLM call failed
 */
export async function distillDescriptionPrompt(characterName, description) {
    try {
        const messages = generateDescriptionPortraitPrompt(characterName, description);
        let response;
        if (extensionSettings.generationMode === 'external') {
            response = await generateWithExternalAPI(messages);
        } else {
            response = await safeGenerateRaw({ prompt: messages, quietToLoud: false });
        }
        return stripReasoning(response || '')
            .replace(/^["']|["']$/g, '')
            .replace(/^prompt\s*:\s*/i, '')
            .trim();
    } catch (error) {
        console.error(`[RPG Avatar] Description distillation failed for ${characterName}:`, error);
        return '';
    }
}

/**
 * Step 2: render a portrait with an explicit prompt (whatever is in the
 * Portrait prompt field — distilled, hand-written, or tweaked). Banks the
 * current portrait to history first, like every regeneration.
 *
 * @param {string} characterName
 * @param {string} prompt
 * @param {{ isUser?: boolean }} [opts] isUser: the player's card (D91)
 * @returns {Promise<string|null>} Image URL, or null on failure /
 *          when a generation for this character is already in flight
 */
export async function generateAvatarWithPrompt(characterName, prompt, { isUser = false } = {}) {
    if (pendingGenerations.has(characterName)) return null;
    pendingGenerations.add(characterName);
    try {
        stashCurrentPortraitToHistory(characterName, { isUser });
        saveSettings();
        return await generateSingleAvatar(characterName, prompt, { isUser });
    } finally {
        pendingGenerations.delete(characterName);
    }
}

/**
 * Generates an LLM prompt for a single character
 *
 * @param {string} characterName - Name of character
 * @returns {Promise<string|null>} Generated prompt or null if failed
 */
async function generateAvatarPrompt(characterName, { isUser = false } = {}) {
    // A user-maintained appearance line skips LLM prompt-writing entirely
    // (and bypasses the session cache — it's already deterministic).
    const appearance = getCharacterAppearance(characterName, { isUser });
    if (appearance) return appearance;
    // The player's card: the LLM prompt below is written from the chat's
    // character card and the trackers, which describe everyone but the
    // player. Their own description (the user card's, else SillyTavern's
    // persona description) is distilled into tags instead when there is one.
    if (isUser) {
        const description = playerDescription(characterName);
        if (description) {
            const distilled = await distillDescriptionPrompt(characterName, description);
            if (distilled) return distilled;
        }
    }
    // Check cache first if not forcing regeneration
    if (sessionAvatarPrompts[characterName]) {
        return sessionAvatarPrompts[characterName];
    }
    try {
        const promptMessages = await generateAvatarPromptGenerationPrompt(characterName);
        let response;
        if (extensionSettings.generationMode === 'external') {
            response = await generateWithExternalAPI(promptMessages);
        } else {
            response = await safeGenerateRaw({
                prompt: promptMessages,
                quietToLoud: false
            });
        }
        if (response) {
            const prompt = response.trim();
            // Store prompt in session storage
            setSessionAvatarPrompt(characterName, prompt);
            return prompt;
        }
    } catch (error) {
        console.error(`[RPG Avatar] Failed to generate LLM prompt for ${characterName}:`, error);
    }
    return null;
}
/**
 * Builds a fallback prompt when LLM prompt generation fails or isn't available
 * Uses information embedded in the character name if present (e.g., from malformed tracker output)
 *
 * @param {string} characterName - Character name (may contain additional details)
 * @returns {string} A basic prompt for image generation
 */
function buildFallbackPrompt(characterName) {
    // Check if the name contains embedded details (malformed format from weaker models)
    // e.g., "Eris Details: 🌟 | beautiful girl with white hair | kind expression"
    if (characterName.includes('Details:') || characterName.includes('|')) {
        // Extract useful description parts
        const parts = characterName.split(/Details:|[|]/).map(p => p.trim()).filter(p => p && !p.match(/^[\p{Emoji}]+$/u));
        if (parts.length > 1) {
            // First part is likely the name, rest are descriptions
            const name = parts[0];
            const descriptions = parts.slice(1).join(', ');
            return `portrait of ${name}, ${descriptions}, fantasy art style, detailed`;
        }
    }
    // Simple fallback - just use the name
    return `portrait of ${characterName}, character portrait, fantasy art style, detailed face, high quality`;
}
/**
 * Generates a single avatar through the image service (the Workshop's and the card menu's path)
 *
 * @param {string} characterName - Name of character to generate avatar for
 * @param {string|null} prompt - The prompt to use (optional, will fallback if null)
 * @returns {Promise<string|null>} Avatar URL or null if failed
 */
/** The player's description: the user card's Injection description, else SillyTavern's description of the active persona. */
function playerDescription(characterName) {
    const u = extensionSettings.userCharacters?.[characterName];
    const own = typeof u?.injection?.description === 'string' ? u.injection.description.trim() : '';
    if (own) return own;
    try {
        const ctx = (typeof window !== 'undefined' && window.SillyTavern && window.SillyTavern.getContext) ? window.SillyTavern.getContext() : null;
        const d = ctx?.powerUserSettings?.persona_descriptions?.[ctx.userAvatar];
        if (d && typeof d.description === 'string') return d.description.trim();
    } catch (e) { /* no persona description */ }
    return '';
}

/** The player's card's own picture: both sizes point at the one file DES made (the sheet's hero art reads avatarFullRes). */
function storePlayerPortrait(characterName, imageUrl) {
    if (!extensionSettings.userCharacters) extensionSettings.userCharacters = {};
    const u = extensionSettings.userCharacters[characterName];
    const entry = u && typeof u === 'object' ? u : {};
    entry.avatar = imageUrl;
    entry.avatarFullRes = imageUrl;
    extensionSettings.userCharacters[characterName] = entry;
}

async function generateSingleAvatar(characterName, prompt = null, { isUser = false } = {}) {
    // Use provided prompt, or check cache, or build fallback
    if (!prompt) {
        prompt = sessionAvatarPrompts[characterName];
    }
    if (!prompt) {
        prompt = buildFallbackPrompt(characterName);
    }
    const campaignAtStart = getActiveCampaignId();
    const startVersionId = liveVersionIdFor(characterName);
    try {
        const problem = sourceProblem();
        if (problem) {
            console.warn(`[RPG Avatar] not drawing ${characterName}: ${problem}`);
            return null;
        }
        let imageUrl = await renderPortrait(prompt, characterName, { isUser });
        if (imageUrl) {
            if (isDataUrl(imageUrl)) {
                // ComfyUI direct (and some of the extension's engines) hand
                // back the bytes: to disk now, under des-portraits, like an
                // automatic portrait. The previous portrait was banked to
                // history by the caller, so no file is reused here.
                imageUrl = await persistPortrait(null, characterName, imageUrl);
            }
            if (isUser) {
                // The player's card (D91): on its own entry. Personas have no
                // campaign versions, so no version bookkeeping.
                storePlayerPortrait(characterName, imageUrl);
            } else {
                // Store the avatar — in the version it was generated for if the
                // active campaign changed while the picture was being made.
                if (!extensionSettings.npcAvatars) extensionSettings.npcAvatars = {};
                if (!storeResultInStartingVersion(campaignAtStart, startVersionId, characterName, imageUrl)) {
                    extensionSettings.npcAvatars[characterName] = imageUrl;
                }
            }
            saveSettings();
            return imageUrl;
        } else {
            console.warn(`[RPG Avatar] the image source returned no picture for ${characterName}`);
            return null;
        }
    } catch (error) {
        console.error(`[RPG Avatar] Generation failed for ${characterName}:`, error);
        return null;
    }
}
/**
 * Clears all pending generations and resets state
 */
export function clearPendingGenerations() {
    pendingGenerations.clear();
}
/**
 * Gets the current generation status for display
 * @returns {{pending: number, names: string[]}}
 */
export function getGenerationStatus() {
    return {
        pending: pendingGenerations.size,
        names: [...pendingGenerations]
    };
}
