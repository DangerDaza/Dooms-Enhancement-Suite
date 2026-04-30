/**
 * Knives Module
 *
 * Player-authored story hooks the AI holds and deploys at dramatic moments.
 * Modeled on the tabletop "knives" technique (and its cousin in *Blades in the Dark*):
 * the player gives the DM a small inventory of debts, secrets, vows, and enemies,
 * and the DM sharpens / draws / fires them with proper pacing — never all at once.
 *
 * Three responsibilities, cleanly split:
 *   - Authoring is owner-scoped and global. A knife is a *template* attached to an
 *     owner key (`__user__` for the player, or a character name). Templates live in
 *     `extensionSettings.knives.byOwner[ownerKey]` and travel with their owner across chats.
 *   - Code owns eligibility and lifecycle promotion (deterministic, runs each generation,
 *     reads chat-local runtime state).
 *   - The AI owns narrative deployment (it sees `drawn` knives in the prompt and weaves
 *     them in).
 *
 * `status === 'drawn'` means *the LLM has been told to deploy it this turn*, not that it
 * actually did. `firedAtMessageIndex` (per-chat) records actual deployment, detected
 * post-message via heuristic text match.
 *
 * Owner inclusion rule: at injection time we gather templates from `__user__` plus every
 * character currently *present* in the scene. Absent characters' knives stay dormant.
 *
 * Template / runtime split: templates carry authoring data (title, description, severity,
 * foreshadowingHints). Runtime entries — keyed by knife id in
 * `chat_metadata.dooms_tracker.knives.runtime` — carry chat-local state (status,
 * lastTransitionMessageIndex, firedAtMessageIndex, lastPromotedAtMessageIndex). Runtime
 * entries are lazy-created on first reference; deleted templates' orphaned runtime
 * entries are pruned on read.
 */
import { chat_metadata, extension_prompt_types, setExtensionPrompt, eventSource, event_types } from '../../../../../../../script.js';
import { getContext } from '../../../../../../extensions.js';
import { extensionSettings, lastGeneratedData, committedTrackerData } from '../../core/state.js';
import { saveSettings, saveChatData, getDoomCounterState } from '../../core/persistence.js';
import { readTensionValue } from '../generation/doomCounter.js';
import { safeGenerateRaw } from '../../utils/responseExtractor.js';

// ─── Constants ────────────────────────────────────────────────────────────────

/** Prompt slot ID — kept stable so the slot can be cleared from anywhere. */
export const KNIVES_SLOT = 'dooms-knives-state';

/** Reserved owner key for the player's own knives. */
export const USER_OWNER_KEY = '__user__';

const VALID_STATUSES = new Set(['dormant', 'sharpening', 'drawn', 'spent', 'defused']);
const MAX_SHARPENING_SIMULTANEOUS = 3;

// ─── Internal helpers ─────────────────────────────────────────────────────────

function generateKnifeId() {
    return `knf_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Returns the per-chat runtime container (`chat_metadata.dooms_tracker.knives`),
 * scaffolding it if missing. Returns null only when there is no active chat.
 */
function ensureChatRuntime() {
    if (!chat_metadata) return null;
    if (!chat_metadata.dooms_tracker) chat_metadata.dooms_tracker = {};
    if (!chat_metadata.dooms_tracker.knives || typeof chat_metadata.dooms_tracker.knives !== 'object') {
        chat_metadata.dooms_tracker.knives = { runtime: {}, cooldownUntilMessageIndex: 0, schemaVersion: 1 };
    }
    if (!chat_metadata.dooms_tracker.knives.runtime || typeof chat_metadata.dooms_tracker.knives.runtime !== 'object') {
        chat_metadata.dooms_tracker.knives.runtime = {};
    }
    return chat_metadata.dooms_tracker.knives;
}

function ensureOwnerBucket(ownerKey) {
    if (!extensionSettings.knives) return null;
    if (!extensionSettings.knives.byOwner || typeof extensionSettings.knives.byOwner !== 'object') {
        extensionSettings.knives.byOwner = {};
    }
    if (!extensionSettings.knives.byOwner[ownerKey] || typeof extensionSettings.knives.byOwner[ownerKey] !== 'object') {
        extensionSettings.knives.byOwner[ownerKey] = { templates: [] };
    }
    if (!Array.isArray(extensionSettings.knives.byOwner[ownerKey].templates)) {
        extensionSettings.knives.byOwner[ownerKey].templates = [];
    }
    return extensionSettings.knives.byOwner[ownerKey];
}

/**
 * Read-only present-character probe. Mirrors the parsing in portraitBar.getCharacterList
 * but does NOT mutate the known-characters roster — we only need names.
 */
function getPresentCharacterNames() {
    const data = lastGeneratedData?.characterThoughts || committedTrackerData?.characterThoughts;
    if (!data) return [];
    const offScene = /\b(not\s+(currently\s+)?(in|at|present\s+in|present\s+at)\s+(the\s+)?(scene|area|room|location|vicinity))\b|\b(off[\s-]?scene)\b|\b(not\s+physically\s+present)\b|\b(absent\s+from\s+(the\s+)?(scene|room|area|location))\b/i;
    try {
        const parsed = typeof data === 'string' ? JSON.parse(data) : data;
        const characters = Array.isArray(parsed) ? parsed : (parsed.characters || []);
        const out = [];
        for (const c of characters) {
            const name = (c?.name || '').trim();
            if (!name) continue;
            const thoughts = c?.thoughts?.content || c?.thoughts || '';
            if (thoughts && offScene.test(thoughts)) continue;
            out.push(name);
        }
        return out;
    } catch {
        return [];
    }
}

// ─── Authoring (templates) ────────────────────────────────────────────────────

/**
 * Returns all owner keys that currently have a bucket (whether or not it has
 * templates). Includes the user key only if it has been seeded.
 */
export function listOwners() {
    const byOwner = extensionSettings.knives?.byOwner;
    if (!byOwner || typeof byOwner !== 'object') return [];
    return Object.keys(byOwner);
}

/**
 * Returns the templates for an owner. Always returns an array (empty if absent).
 */
export function getTemplates(ownerKey) {
    const bucket = extensionSettings.knives?.byOwner?.[ownerKey];
    return Array.isArray(bucket?.templates) ? bucket.templates : [];
}

/**
 * Adds a new knife template under the given owner. Mints a fresh id, validates
 * fields, persists settings. Returns the created template, or null if knives
 * are unavailable (e.g. settings root missing).
 */
export function addTemplate(ownerKey, fields) {
    if (!ownerKey) return null;
    const bucket = ensureOwnerBucket(ownerKey);
    if (!bucket) return null;
    const severity = [1, 2, 3].includes(fields?.severity) ? fields.severity : 1;
    const tpl = {
        id: generateKnifeId(),
        title: String(fields?.title || '').trim() || 'Untitled Knife',
        description: String(fields?.description || '').trim(),
        severity,
        foreshadowingHints: Array.isArray(fields?.foreshadowingHints)
            ? fields.foreshadowingHints.map(h => String(h).trim()).filter(Boolean).slice(0, 8)
            : [],
        createdAt: Date.now(),
    };
    bucket.templates.push(tpl);
    saveSettings();
    return tpl;
}

/**
 * Patches the named fields on an existing template. Unknown fields are ignored.
 * Returns true on a successful update, false if the template can't be found.
 */
export function updateTemplate(ownerKey, id, patch) {
    const bucket = extensionSettings.knives?.byOwner?.[ownerKey];
    if (!Array.isArray(bucket?.templates)) return false;
    const tpl = bucket.templates.find(t => t.id === id);
    if (!tpl) return false;
    if (typeof patch?.title === 'string') {
        const trimmed = patch.title.trim();
        if (trimmed) tpl.title = trimmed;
    }
    if (typeof patch?.description === 'string') tpl.description = patch.description.trim();
    if ([1, 2, 3].includes(patch?.severity)) tpl.severity = patch.severity;
    if (Array.isArray(patch?.foreshadowingHints)) {
        tpl.foreshadowingHints = patch.foreshadowingHints.map(h => String(h).trim()).filter(Boolean).slice(0, 8);
    }
    saveSettings();
    return true;
}

/**
 * Removes a template and clears its runtime entry in the current chat.
 * Other chats' runtime entries become orphans and will be pruned on next
 * `getEligibleKnives()` read.
 */
export function deleteTemplate(ownerKey, id) {
    const bucket = extensionSettings.knives?.byOwner?.[ownerKey];
    if (!Array.isArray(bucket?.templates)) return false;
    const before = bucket.templates.length;
    bucket.templates = bucket.templates.filter(t => t.id !== id);
    if (bucket.templates.length === before) return false;
    const rt = chat_metadata?.dooms_tracker?.knives?.runtime;
    if (rt && rt[id]) {
        delete rt[id];
        saveChatData();
    }
    saveSettings();
    return true;
}

/**
 * Re-keys a non-user owner bucket. If `newKey` already exists, the templates
 * merge into it. Used when a character is renamed in the roster.
 */
export function renameOwner(oldKey, newKey) {
    if (!oldKey || !newKey || oldKey === newKey) return false;
    if (oldKey === USER_OWNER_KEY || newKey === USER_OWNER_KEY) return false;
    const byOwner = extensionSettings.knives?.byOwner;
    if (!byOwner?.[oldKey]) return false;
    if (byOwner[newKey]) {
        const merged = (byOwner[newKey].templates || []).concat(byOwner[oldKey].templates || []);
        byOwner[newKey].templates = merged;
    } else {
        byOwner[newKey] = byOwner[oldKey];
    }
    delete byOwner[oldKey];
    saveSettings();
    return true;
}

/**
 * Removes an entire owner bucket (and its templates). User bucket is preserved
 * — pass `__user__` only when the player explicitly resets their list. Per-chat
 * runtime entries become orphans and prune on next read.
 */
export function deleteOwner(ownerKey) {
    const byOwner = extensionSettings.knives?.byOwner;
    if (!byOwner?.[ownerKey]) return false;
    delete byOwner[ownerKey];
    saveSettings();
    return true;
}

// ─── Runtime (per-chat status) ────────────────────────────────────────────────

function makeDormantRuntime(idx) {
    return {
        status: 'dormant',
        firstSeenMessageIndex: idx,
        lastTransitionMessageIndex: idx,
        lastTransitionAt: Date.now(),
        firedAtMessageIndex: null,
        lastPromotedAtMessageIndex: null,
    };
}

function getOrCreateRuntime(knifeId, idx) {
    const data = ensureChatRuntime();
    if (!data) return null;
    if (!data.runtime[knifeId]) data.runtime[knifeId] = makeDormantRuntime(idx);
    return data.runtime[knifeId];
}

/**
 * Looks up the runtime entry for a knife in the current chat. Does NOT
 * lazy-create — returns null when there's no entry yet.
 */
export function getRuntime(knifeId) {
    return chat_metadata?.dooms_tracker?.knives?.runtime?.[knifeId] || null;
}

function transition(knifeId, newStatus, idx) {
    if (!VALID_STATUSES.has(newStatus)) return false;
    const rt = getOrCreateRuntime(knifeId, idx);
    if (!rt) return false;
    rt.status = newStatus;
    rt.lastTransitionMessageIndex = idx;
    rt.lastTransitionAt = Date.now();
    return true;
}

function currentChatLength() {
    try { return getContext().chat?.length || 0; } catch { return 0; }
}

// ─── Manual overrides (UI-driven) ─────────────────────────────────────────────

export function defuseKnife(knifeId) {
    if (transition(knifeId, 'defused', currentChatLength())) saveChatData();
}

export function forceSharpenKnife(knifeId) {
    if (transition(knifeId, 'sharpening', currentChatLength())) saveChatData();
}

export function forceDrawKnife(knifeId) {
    // Bypass the usual one-drawn-at-a-time rule — this is a manual override.
    const idx = currentChatLength();
    if (transition(knifeId, 'drawn', idx)) {
        const rt = getRuntime(knifeId);
        if (rt) rt.lastPromotedAtMessageIndex = idx;
        saveChatData();
    }
}

export function resetKnife(knifeId) {
    if (transition(knifeId, 'dormant', currentChatLength())) saveChatData();
}

// ─── Eligibility & joining ────────────────────────────────────────────────────

/**
 * Joins per-owner templates with their per-chat runtime entries, filtered by
 * the present-character rule. Lazy-creates dormant runtime entries for newly
 * eligible templates. Prunes orphaned runtime entries (templates that no
 * longer exist).
 *
 * Returns: `[{ ownerKey, template, runtime }]`. Both promotion and injection
 * use this so they always see the same view.
 */
export function getEligibleKnives() {
    if (!extensionSettings.knives?.enabled) return [];
    const idx = currentChatLength();
    const data = ensureChatRuntime();
    if (!data) return [];
    const requirePresent = extensionSettings.knives.requireCharacterPresent !== false;
    const presentSet = requirePresent ? new Set(getPresentCharacterNames()) : null;
    const out = [];
    const validIds = new Set();
    const byOwner = extensionSettings.knives.byOwner || {};
    for (const ownerKey of Object.keys(byOwner)) {
        if (ownerKey !== USER_OWNER_KEY && requirePresent && !presentSet.has(ownerKey)) continue;
        const templates = Array.isArray(byOwner[ownerKey]?.templates) ? byOwner[ownerKey].templates : [];
        for (const tpl of templates) {
            if (!tpl?.id) continue;
            validIds.add(tpl.id);
            const runtime = getOrCreateRuntime(tpl.id, idx);
            if (!runtime) continue;
            out.push({ ownerKey, template: tpl, runtime });
        }
    }
    // Prune orphans — runtime entries whose templates were deleted, or whose
    // owner was removed entirely. We only prune ids we *don't* see; absent
    // characters' runtime is preserved so re-entering the scene resumes state.
    const allTemplateIds = new Set();
    for (const ownerKey of Object.keys(byOwner)) {
        const templates = Array.isArray(byOwner[ownerKey]?.templates) ? byOwner[ownerKey].templates : [];
        for (const tpl of templates) if (tpl?.id) allTemplateIds.add(tpl.id);
    }
    let pruned = false;
    for (const id of Object.keys(data.runtime)) {
        if (!allTemplateIds.has(id)) {
            delete data.runtime[id];
            pruned = true;
        }
    }
    if (pruned) saveChatData();
    return out;
}

// ─── Lifecycle: pre-generation promotion ──────────────────────────────────────

/**
 * Runs in `injector.onGenerationStarted` *before* injection so the knife being
 * promoted this turn is the one injected this turn.
 *
 * Order matters:
 *   1. Drawn-lifetime failsafe — auto-spend any drawn knife the AI has been
 *      sitting on for too many turns.
 *   2. Sharpening promotion — flip aged dormant knives toward sharpening
 *      (capped at 3 simultaneous across the chat).
 *   3. Drawn promotion — at most one knife is drawn at a time, and only past
 *      cooldown. Severity is gated by the tension scale (and Doom Counter
 *      countdown / triggered for catastrophic).
 *
 * Skipped on swipes/regenerates so the same knife stays drawn rather than
 * re-rolling each swipe.
 */
export function promoteKnivesPreGeneration(shouldSuppress) {
    if (!extensionSettings.knives?.enabled || shouldSuppress) return;
    const idx = currentChatLength();
    const data = ensureChatRuntime();
    if (!data) return;
    const eligible = getEligibleKnives();
    if (!eligible.length) return;

    // Swipe / regenerate guard: if any runtime entry was promoted at this exact
    // chat length already, this is a re-roll of the same turn — bail out.
    const swipeReroll = eligible.some(k => k.runtime.lastPromotedAtMessageIndex === idx);
    if (swipeReroll) return;

    const tension = readTensionValue() ?? 3;
    const doomState = (typeof getDoomCounterState === 'function' ? getDoomCounterState() : null) || {};
    const cfg = extensionSettings.knives;
    let changed = false;

    // 1. Drawn-lifetime failsafe.
    for (const { runtime } of eligible) {
        if (runtime.status === 'drawn'
            && idx - runtime.lastTransitionMessageIndex >= (cfg.drawnMaxLifetimeMessages || 4)) {
            runtime.status = 'spent';
            runtime.lastTransitionMessageIndex = idx;
            runtime.lastTransitionAt = Date.now();
            data.cooldownUntilMessageIndex = idx + (cfg.cooldownMessages || 0);
            changed = true;
        }
    }

    // 2. Sharpening promotion.
    const currentlySharpening = eligible.filter(k => k.runtime.status === 'sharpening').length;
    let sharpenSlots = Math.max(0, MAX_SHARPENING_SIMULTANEOUS - currentlySharpening);
    for (const { runtime } of eligible) {
        if (sharpenSlots <= 0) break;
        if (runtime.status !== 'dormant') continue;
        const age = idx - runtime.firstSeenMessageIndex;
        if (age < (cfg.sharpeningMinAge || 0)) continue;
        if (Math.random() < (cfg.sharpeningPromotionChance || 0)) {
            runtime.status = 'sharpening';
            runtime.lastTransitionMessageIndex = idx;
            runtime.lastTransitionAt = Date.now();
            sharpenSlots--;
            changed = true;
        }
    }

    // 3. Drawn promotion. Only if no knife is drawn AND we're past cooldown.
    const anyDrawn = eligible.some(k => k.runtime.status === 'drawn');
    if (!anyDrawn && idx >= (data.cooldownUntilMessageIndex || 0)) {
        const candidates = eligible.filter(({ template, runtime }) => {
            if (runtime.status !== 'sharpening') return false;
            if (template.severity === 1) return true;
            if (template.severity === 2) return tension >= (cfg.seriousTensionThreshold || 5);
            if (template.severity === 3) {
                return tension >= (cfg.catastrophicTensionThreshold || 8)
                    || doomState.countdownActive
                    || doomState.triggered;
            }
            return false;
        });
        candidates.sort((a, b) => a.runtime.lastTransitionMessageIndex - b.runtime.lastTransitionMessageIndex);
        for (const { template, runtime } of candidates) {
            const gate = template.severity === 3 ? (cfg.catastrophicTensionThreshold || 8)
                : template.severity === 2 ? (cfg.seriousTensionThreshold || 5)
                : 0;
            const probability = 0.30 + 0.10 * Math.max(0, tension - gate);
            if (Math.random() < probability) {
                runtime.status = 'drawn';
                runtime.lastTransitionMessageIndex = idx;
                runtime.lastTransitionAt = Date.now();
                runtime.lastPromotedAtMessageIndex = idx;
                changed = true;
                break; // One drawn at a time.
            }
        }
    }

    if (changed) saveChatData();
}

// ─── Lifecycle: post-generation retirement ────────────────────────────────────

function tokenize(text) {
    return String(text || '')
        .toLowerCase()
        .split(/[^a-z0-9]+/i)
        .filter(t => t.length >= 6);
}

/**
 * Runs on `MESSAGE_RECEIVED`. For each currently-drawn knife, looks at the just-
 * received assistant message and decides whether the AI actually deployed it.
 * Heuristic: the knife's title appears (case-insensitive substring) OR at least
 * two distinctive 6+-char tokens from the description appear. On match: status
 * goes `drawn → spent`, `firedAtMessageIndex` is recorded, cooldown engages.
 */
export function advanceKnivesPostGeneration() {
    if (!extensionSettings.knives?.enabled) return;
    let chat;
    try { chat = getContext().chat; } catch { return; }
    if (!Array.isArray(chat) || !chat.length) return;
    const idx = chat.length;
    const lastMessage = chat[chat.length - 1];
    if (!lastMessage || lastMessage.is_user) return;
    const messageText = String(lastMessage.mes || '').toLowerCase();
    if (!messageText) return;

    const eligible = getEligibleKnives();
    const data = ensureChatRuntime();
    if (!data) return;
    let changed = false;
    for (const { template, runtime } of eligible) {
        if (runtime.status !== 'drawn') continue;
        const titleHit = template.title && messageText.includes(template.title.toLowerCase());
        let tokenHits = 0;
        if (!titleHit) {
            const descTokens = tokenize(template.description);
            for (const tok of descTokens) {
                if (messageText.includes(tok)) tokenHits++;
                if (tokenHits >= 2) break;
            }
        }
        if (titleHit || tokenHits >= 2) {
            runtime.status = 'spent';
            runtime.firedAtMessageIndex = idx;
            runtime.lastTransitionMessageIndex = idx;
            runtime.lastTransitionAt = Date.now();
            data.cooldownUntilMessageIndex = idx + (extensionSettings.knives.cooldownMessages || 0);
            changed = true;
        }
    }
    if (changed) saveChatData();
}

// ─── Prompt injection ─────────────────────────────────────────────────────────

function ownerLabel(ownerKey) {
    return ownerKey === USER_OWNER_KEY ? 'Player' : ownerKey;
}

function severityLabel(severity) {
    if (severity === 3) return 'catastrophic';
    if (severity === 2) return 'serious';
    return 'minor';
}

function renderKnivesText(eligible) {
    const sharpening = eligible.filter(k => k.runtime.status === 'sharpening');
    const drawn = eligible.filter(k => k.runtime.status === 'drawn');
    if (!sharpening.length && !drawn.length) return '';
    const lines = [
        '[Active Story Hooks - "Knives"]',
        'The following are player-authored story threads tied to specific people. Weave them into the narrative with proper DM pacing. Do NOT fire all of them at once — they are recurring undercurrents that should erupt at dramatic beats.',
        '',
    ];
    if (sharpening.length) {
        lines.push('Currently sharpening (foreshadow subtly — hint, do not deploy):');
        for (const { ownerKey, template } of sharpening) {
            const hints = (template.foreshadowingHints || []).filter(Boolean).join('; ');
            const hintsTail = hints ? ` Hints: ${hints}.` : '';
            const desc = template.description ? `: ${template.description}` : '';
            lines.push(`- {${ownerLabel(ownerKey)}} "${template.title}" (${severityLabel(template.severity)})${desc}${hintsTail}`);
        }
        lines.push('');
    }
    if (drawn.length) {
        lines.push('Currently drawn (DEPLOY THIS RESPONSE — escalate naturally through action, dialogue, or environment tied to its owner; do not force):');
        for (const { ownerKey, template } of drawn) {
            const desc = template.description ? `: ${template.description}` : '';
            lines.push(`- {${ownerLabel(ownerKey)}} "${template.title}" (${severityLabel(template.severity)})${desc}`);
        }
        lines.push('');
    }
    lines.push(
        'Pacing rules:',
        '- At most one drawn knife is active at a time across all owners.',
        "- A character's knives should only surface when that character is present.",
        '- After a knife resolves, leave breathing room before the next.',
        '- Foreshadowed knives should feel "earned" by the time they fire.',
        '[/Active Story Hooks]',
    );
    return lines.join('\n');
}

/**
 * Injects (or clears) the knives prompt slot. Called from the injector right
 * after `promoteKnivesPreGeneration`. Slot is cleared when disabled, suppressed,
 * or when no knives are eligible — so toggling off produces zero behavioral diff.
 */
export function injectKnivesPrompt(shouldSuppress) {
    if (!extensionSettings.knives?.enabled || shouldSuppress) {
        setExtensionPrompt(KNIVES_SLOT, '', extension_prompt_types.IN_CHAT, 0, false);
        return;
    }
    const eligible = getEligibleKnives();
    const text = renderKnivesText(eligible);
    if (!text) {
        setExtensionPrompt(KNIVES_SLOT, '', extension_prompt_types.IN_CHAT, 0, false);
        return;
    }
    setExtensionPrompt(KNIVES_SLOT, `\n${text}\n`, extension_prompt_types.IN_CHAT, 0, false);
}

export function clearKnivesPrompt() {
    setExtensionPrompt(KNIVES_SLOT, '', extension_prompt_types.IN_CHAT, 0, false);
}

// ─── AI suggestion sub-call ───────────────────────────────────────────────────

const SUGGEST_SYSTEM_PROMPT = `You are a tabletop RPG dungeon master generating "knives" — player-authored story hooks the DM can hold and deploy at dramatic moments. Examples: a debt to a dangerous creditor; a wronged lover seeking revenge; a secret about lineage; a vow that demands a costly payment.

Given the description below, propose 3 to 5 knives. Output STRICT JSON only — no prose, no code fences. Format:
{
  "knives": [
    {
      "title": "<short evocative name>",
      "description": "<one or two sentences naming the specific person, place, debt, or secret>",
      "severity": 1,
      "foreshadowingHints": ["<one-sentence breadcrumb>", "<another>"]
    }
  ]
}

Severity: 1 = minor inconvenience, 2 = serious complication, 3 = catastrophic. Spread severities across the list. Keep descriptions concrete (named NPCs, specific places, exact debts). Provide 1–3 foreshadowing hints per knife.`;

function tryParseSuggestionJson(text) {
    if (!text) return null;
    let s = String(text).trim();
    // Strip code fences if present.
    s = s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '');
    try { return JSON.parse(s); } catch { /* fall through */ }
    // Last-ditch: slice the outer braces.
    const start = s.indexOf('{');
    const end = s.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start) return null;
    try { return JSON.parse(s.slice(start, end + 1)); } catch { return null; }
}

function normalizeSuggestion(s) {
    if (!s || typeof s !== 'object') return null;
    const title = String(s.title || '').trim();
    if (!title) return null;
    const description = String(s.description || '').trim();
    let severity = Number(s.severity);
    if (![1, 2, 3].includes(severity)) severity = 1;
    let hints = [];
    if (Array.isArray(s.foreshadowingHints)) {
        hints = s.foreshadowingHints.map(h => String(h).trim()).filter(Boolean).slice(0, 5);
    }
    return { title, description, severity, foreshadowingHints: hints };
}

/**
 * Asks the model for 3-5 knife suggestions based on a free-text description
 * (Bunny Mo character sheet or persona description). Returns:
 *   { suggestions: [...], rawText: '<for debug>' }            on success
 *   { suggestions: [], rawText, error: '<msg>' }              on parse / gen failure
 *
 * The caller renders these in a confirm-modal so the player edits/accepts
 * before anything saves.
 */
export async function suggestKnives(descriptionText) {
    const desc = String(descriptionText || '').trim();
    if (!desc) {
        return { suggestions: [], rawText: '', error: 'No description provided.' };
    }
    let raw = '';
    try {
        raw = await safeGenerateRaw({
            prompt: [
                { role: 'system', content: SUGGEST_SYSTEM_PROMPT },
                { role: 'user', content: `Description:\n${desc}` },
            ],
            quietToLoud: false,
        });
    } catch (e) {
        return { suggestions: [], rawText: '', error: `Generation failed: ${e?.message || e}` };
    }
    const parsed = tryParseSuggestionJson(raw);
    const list = Array.isArray(parsed?.knives)
        ? parsed.knives
        : (Array.isArray(parsed) ? parsed : null);
    if (!list) {
        return { suggestions: [], rawText: raw, error: 'Could not parse suggestions JSON.' };
    }
    const suggestions = list.map(normalizeSuggestion).filter(Boolean);
    if (!suggestions.length) {
        return { suggestions: [], rawText: raw, error: 'Suggestions were empty after normalization.' };
    }
    return { suggestions, rawText: raw };
}

// ─── Init ─────────────────────────────────────────────────────────────────────

let _initialized = false;

/**
 * Wires the post-generation event listener. Idempotent. The listener early-
 * returns when the feature is disabled, so attaching unconditionally is safe
 * and produces no behavioral diff when the master toggle is off.
 */
export function initKnives() {
    if (_initialized) return;
    _initialized = true;
    eventSource.on(event_types.MESSAGE_RECEIVED, () => {
        try {
            advanceKnivesPostGeneration();
        } catch (e) {
            console.warn('[Dooms Knives] post-generation advance failed:', e);
        }
    });
}
