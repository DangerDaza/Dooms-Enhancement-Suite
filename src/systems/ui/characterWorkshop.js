/**
 * Character Workshop — per-character editor + scene injector.
 *
 * Scope: Identity (read-only) and Appearance (portrait + dialogue color).
 * Plus an "Inject into Scene" action that (a) adds the character to the
 * active known-characters roster so they appear on the portrait bar,
 * and (b) queues a one-shot SillyTavern extension prompt instructing
 * the AI to bring the character into the scene on the next turn. The
 * injection is cleared automatically once generation ends.
 *
 * Opening is decoupled from portraitBar.js via a window CustomEvent
 * ('dooms:open-workshop') so portraitBar does not import this module.
 */

import { extensionSettings, lastGeneratedData, updateLastGeneratedData } from '../../core/state.js';
import {
    saveSettings,
    saveChatData,
    getActiveKnownCharacters,
    getActiveRemovedCharacters,
    getActiveBannedCharacters,
    getActiveCharacterColors,
    saveCharacterRosterChange,
} from '../../core/persistence.js';
import { clearPortraitCache, updatePortraitBar, openExpressionFolder, resolvePortrait, upscaleImage } from './portraitBar.js';
import { callGenericPopup, POPUP_TYPE } from '../../../../../../popup.js';
import { getBase64Async } from '../../../../../../utils.js';
import { renderThoughts } from '../rendering/thoughts.js';
import { i18n } from '../../core/i18n.js';
import { getAllWorldNames, activateWorld, isWorldActive } from '../lorebook/lorebookAPI.js';
import {
    setExtensionPrompt,
    extension_prompt_types,
    eventSource,
    event_types,
    getRequestHeaders,
} from '../../../../../../../script.js';
import { getContext } from '../../../../../../extensions.js';
import { power_user } from '../../../../../../power-user.js';

// SillyTavern extension-prompt slot key; must be unique per feature.
const INJECT_SLOT = 'dooms-workshop-scene-inject';
// Separate slot for "Eject from scene" — strong anti-inject direction
// that tells the AI to stop writing this character even if they appear
// in prior chat history. Distinct slot so eject can be set/cleared
// independently of any pending inject.
const EJECT_SLOT = 'dooms-workshop-scene-eject';
// Persistent ban slot — populated whenever bannedCharacters is non-empty,
// stays in the prompt every turn until the user un-banishes everyone.
// Eject is one-shot; this is the standing version for "the AI keeps
// writing this character no matter what I do."
const BAN_SLOT = 'dooms-workshop-banned-characters';

const DEFAULT_EJECT_PROMPT =
`[SCENE DIRECTION — REMOVE CHARACTER]
The character "{name}" has left the scene and is no longer present. In your next response:
- Do NOT have them speak.
- Do NOT have them act.
- Do NOT describe them as present.
- Do NOT include them in your presentCharacters tracker output.

If they appeared in earlier turns, treat that as a completed scene — they have moved on. Continue the current scene without them.

This is a one-time direction from the user; do not mention these bracketed instructions in your reply.
`;

// Default scene-direction template. Users can override per-character via the
// Injection tab. Supports {name}/{description}/{lorebook}/{relationship}
// substitution plus conditional blocks {?var}...{/var} that are emitted only
// when the variable is a non-empty string.
const DEFAULT_INJECT_PROMPT =
`[SCENE DIRECTION — INJECT CHARACTER]
Incorporate the character "{name}" into your next response. Have them arrive, reveal themselves, or otherwise become present in a way that fits the current scene naturally. Include them in your presentCharacters tracker output for this turn.
{?relationship}
Relationship to the player: {relationship}. Reflect this dynamic in how they act and speak.
{/relationship}{?description}

Character notes for "{name}":
{description}
{/description}{?lorebook}

The lorebook "{lorebook}" has been activated for additional context about this character; consult its entries as relevant.
{/lorebook}

This is a one-time direction from the user; do not mention these bracketed instructions in your reply.
`;

// Dialogue color palette copied verbatim from portraitBar.js:29-38.
const DIALOGUE_COLORS = [
    '#e94560', '#e07b39', '#f0c040', '#2ecc71',
    '#1abc9c', '#4a7ba7', '#9b59b6', '#e84393',
    '#5dade2', '#f39c12', '#8e44ad', '#d35400',
    '#16a085', '#c0392b', '#00b894', '#6c5ce7',
    '#fd79a8', '#a29bfe', '#55efc4', '#fab1a0',
    '#74b9ff', '#ffeaa7', '#e17055', '#00cec9',
    '#0984e3', '#fdcb6e', '#d63031', '#e056fd',
    '#7ed6df', '#badc58',
];

let draft = null;
let $modal = null;
let listenersBound = false;
let _wsInitialized = false; // guard: don't double-register window/eventSource listeners
let pendingInjectClear = false; // true while an inject prompt is queued
// Number of GENERATION_STARTED fires to let pass before clearing. Set to 1
// at inject time; the generation the inject was for passes without clearing,
// any subsequent START triggers a clear in case GENERATION_ENDED never fired.
let injectStartsToSkip = 0;

// Characters currently mid-inject. Keyed lowercase so lookups are stable
// regardless of casing. Each entry tracks anything we need to undo on
// either a natural completion or a manual Cancel.
const pendingInjects = new Map(); // name.toLowerCase() -> { name, disarmAttach: fn|null }

// Mirror state for Eject — same lifecycle as inject (one-shot prompt,
// clears on the generation after the eject was queued).
let pendingEjectClear = false;
let ejectStartsToSkip = 0;

/**
 * Push the standing "these characters are not in this scene" prompt into
 * the BAN_SLOT extension prompt, or clear it if no one is currently
 * banished. Called whenever bannedCharacters changes and once at init so
 * the slot is repopulated on extension load.
 */
function refreshBanPrompt() {
    let banned = [];
    try { banned = getActiveBannedCharacters() || []; } catch (e) {}
    if (!Array.isArray(banned) || banned.length === 0) {
        try {
            setExtensionPrompt(BAN_SLOT, '', extension_prompt_types.IN_PROMPT, 0, false);
        } catch (e) {}
        return;
    }
    const list = banned.map(n => `- "${n}"`).join('\n');
    const prompt =
`[SCENE DIRECTION — CHARACTERS NOT IN SCENE]
The following characters are NOT in the current scene and must NOT appear in your response:
${list}

For each banished character:
- Do NOT have them speak.
- Do NOT have them act or be present.
- Do NOT include them in your presentCharacters tracker output.
- If they were referenced in earlier turns, treat that as a completed scene — they are no longer present.

This is a standing direction; do not mention these bracketed instructions in your reply.
`;
    try {
        setExtensionPrompt(BAN_SLOT, prompt, extension_prompt_types.IN_PROMPT, 0, false);
    } catch (e) {
        console.warn('[Dooms Tracker] Workshop: refreshBanPrompt setExtensionPrompt failed', e);
    }
}

/**
 * Toggle a character's banished state. When banished:
 *  - Added to the active bannedCharacters list (per-chat or global per
 *    perChatCharacterTracking).
 *  - Soft-removed from the panel via removedCharacters so the card
 *    disappears immediately (matches the user intent).
 *  - The standing BAN_SLOT extension prompt is refreshed so the AI is
 *    told not to include them on the next and every subsequent turn
 *    until the user un-banishes.
 * When un-banished: removed from bannedCharacters; soft-remove is left
 * alone (the user can restore via the Workshop's banner).
 */
export function setCharacterBanished(name, banished) {
    const trimmed = String(name || '').trim();
    if (!trimmed) return;
    const lower = trimmed.toLowerCase();
    let banned;
    try { banned = getActiveBannedCharacters(); } catch (e) { return; }
    if (!Array.isArray(banned)) return;
    const isCurrentlyBanned = banned.some(n => typeof n === 'string' && n.toLowerCase() === lower);
    if (banished && !isCurrentlyBanned) {
        banned.push(trimmed);
        // Soft-remove so the card drops out of the panel immediately.
        try {
            const removed = getActiveRemovedCharacters();
            if (Array.isArray(removed) && !removed.some(n => typeof n === 'string' && n.toLowerCase() === lower)) {
                removed.push(trimmed);
            }
        } catch (e) {}
        saveCharacterRosterChange();
        try { saveSettings(); } catch (e) {}
        refreshBanPrompt();
        try { clearPortraitCache(); updatePortraitBar(); } catch (e) {}
        try { renderThoughts(); } catch (e) {}
    } else if (!banished && isCurrentlyBanned) {
        for (let i = banned.length - 1; i >= 0; i--) {
            if (typeof banned[i] === 'string' && banned[i].toLowerCase() === lower) {
                banned.splice(i, 1);
            }
        }
        saveCharacterRosterChange();
        try { saveSettings(); } catch (e) {}
        refreshBanPrompt();
    }
}

/**
 * Lookup helper used by the Workshop's UI to render the toggle state.
 */
function isCharacterBanished(name) {
    const trimmed = String(name || '').trim();
    if (!trimmed) return false;
    const lower = trimmed.toLowerCase();
    try {
        const banned = getActiveBannedCharacters();
        return Array.isArray(banned) && banned.some(n => typeof n === 'string' && n.toLowerCase() === lower);
    } catch (e) { return false; }
}

function broadcastInjectState(name, pending) {
    try {
        window.dispatchEvent(new CustomEvent('dooms:inject-state-changed', {
            detail: { name, pending: !!pending },
        }));
    } catch (e) {}
}

function t(key, fallback, vars) {
    let s;
    try {
        s = i18n?.getTranslation?.(key);
    } catch (e) {
        s = null;
    }
    if (!s) s = fallback;
    if (vars && typeof s === 'string') {
        for (const [k, v] of Object.entries(vars)) {
            s = s.split(`{${k}}`).join(v);
        }
    }
    return s;
}

export function initCharacterWorkshop() {
    // Workshop is part of the Present Characters Panel feature set;
    // when PCP is disabled the Workshop has nothing useful to do, so
    // we early-return and skip listener registration.
    if (extensionSettings?.showPortraitBar === false) {
        console.log('[Dooms Tracker] Character Workshop disabled (Present Characters Panel off), skipping init');
        return;
    }
    // Idempotency guard: if init runs twice (extension hot-reload, manual
    // re-init, etc.) don't double-register the window + eventSource
    // listeners — doing so duplicates every open-workshop / cancel-inject
    // / generation-ended handler and leads to subtle state corruption.
    if (_wsInitialized) return;
    _wsInitialized = true;
    window.addEventListener('dooms:open-workshop', (e) => {
        const name = e?.detail?.characterName;
        const isUser = !!e?.detail?.isUser;
        if (name) openCharacterWorkshop(name, { isUser });
    });
    // Portrait-bar (or any other surface) can request a pending-inject be
    // cancelled via this event. Same decoupling pattern as open-workshop.
    window.addEventListener('dooms:cancel-inject', (e) => {
        const name = e?.detail?.name;
        if (name) cancelInject(name);
    });
    // Clear the inject prompt after the targeted generation. Belt-and-
    // suspenders: trigger from ENDED/STOPPED (normal path) and also from
    // the START of any *subsequent* generation (covers streaming paths or
    // aborts where ENDED never fires).
    try {
        eventSource.on(event_types.GENERATION_ENDED, clearInjectPromptIfPending);
        eventSource.on(event_types.GENERATION_STOPPED, clearInjectPromptIfPending);
        eventSource.on(event_types.GENERATION_STARTED, onGenerationStartedForInject);
    } catch (e) {
        console.warn('[Dooms Tracker] Workshop: failed to register GENERATION_ENDED listener', e);
    }
    // Repopulate the standing ban prompt from saved bannedCharacters so it
    // survives a page reload. Also re-fire on chat changes since the banned
    // list is per-chat when perChatCharacterTracking is on.
    try { refreshBanPrompt(); } catch (e) {}
    try {
        eventSource.on(event_types.CHAT_CHANGED, () => {
            try { refreshBanPrompt(); } catch (err) {}
        });
    } catch (e) {}
}

// Tracks the in-flight close fade-out timeout. Cancelled on reopen so a
// pending .hide() can't fire after we've reopened, and so the closing-
// animation doesn't visibly overlap the new modal's content.
let _pendingCloseTimeout = null;

export function openCharacterWorkshop(characterName, options = {}) {
    if (!characterName) {
        console.warn('[Dooms Tracker] openCharacterWorkshop called without a name');
        return;
    }
    if (!ensureModal()) return;

    // Kill any pending close-fade-out: prevents (a) the previous modal's
    // content flashing during its fadeOut overlapping the new fadeIn,
    // and (b) the close-timeout firing .hide() after we've reopened.
    if (_pendingCloseTimeout) {
        clearTimeout(_pendingCloseTimeout);
        _pendingCloseTimeout = null;
    }
    $modal.removeClass('is-closing');

    const isUser = !!options.isUser;
    draft = buildDraft(characterName, isUser);

    // Stamp the modal with a mode attribute so CSS can flip NPC-only vs
    // user-only sections without a JS class-toggle on every section.
    $modal.attr('data-mode', isUser ? 'user' : 'npc');

    renderTitle();
    renderHiddenBanner();
    renderIdentity();
    renderAppearance();
    renderInjection();
    activatePane('identity');

    if (!listenersBound) {
        bindStaticListeners();
        listenersBound = true;
    }

    $modal.attr('data-theme', extensionSettings?.theme || 'default');
    $modal.addClass('is-open').css('display', '');
}

export function closeCharacterWorkshop() {
    if (!$modal || !$modal.length) return;
    $modal.removeClass('is-open').addClass('is-closing');
    if (_pendingCloseTimeout) clearTimeout(_pendingCloseTimeout);
    _pendingCloseTimeout = setTimeout(() => {
        $modal.removeClass('is-closing').hide();
        _pendingCloseTimeout = null;
    }, 200);
    draft = null;
}

/**
 * Is this character currently mid-inject (post-click, pre-AI-reply)?
 * Case-insensitive. Used by portraitBar to decide whether to show the
 * INJECTING overlay + Cancel Injection context-menu item.
 */
export function isInjectPending(name) {
    if (!name) return false;
    return pendingInjects.has(String(name).toLowerCase());
}

/**
 * Cancel a pending inject for this character:
 *  - clears the SillyTavern extension prompt so the AI doesn't receive the
 *    one-shot scene-direction text
 *  - disarms the portrait-attach MESSAGE_SENT listener if armed
 *  - removes the character from the present list (undoes cw-57's splice)
 *  - removes them from the pending set and broadcasts the new state
 * Leaves knownCharacters, Workshop data, and lorebook activation alone —
 * those were either pre-existing or user-chosen, and keeping them avoids
 * surprise data loss.
 */
export function cancelInject(name) {
    if (!name) return;
    const key = String(name).toLowerCase();
    const entry = pendingInjects.get(key);
    if (!entry) return;

    // Clear the extension-prompt text if this cancel is for the most
    // recently armed inject. If multiple were queued in rapid succession,
    // we optimistically clear — a subsequent GENERATION_ENDED would have
    // cleared it anyway.
    try {
        setExtensionPrompt(INJECT_SLOT, '', extension_prompt_types.IN_PROMPT, 0, false);
    } catch (e) { /* best-effort */ }
    pendingInjectClear = false;
    injectStartsToSkip = 0;

    // Disarm the portrait-attach listener if one was armed for this char.
    try { entry.disarmAttach?.(); } catch (e) {}

    // Undo the "present now" splice ONLY if we actually added it. If the
    // character was already in the live tracker (AI confirmed them on a
    // prior turn), the inject was a no-op splice and unmarking would
    // erroneously remove a legitimately-present character.
    if (entry.didSplice) {
        try { unmarkCharacterPresentNow(entry.name); } catch (e) {}
    }

    pendingInjects.delete(key);
    broadcastInjectState(entry.name, false);

    try {
        if (window.toastr) window.toastr.info(`Inject cancelled for "${entry.name}".`, 'Character Workshop', { timeOut: 3000 });
    } catch (e) {}
    console.log(`[Dooms Tracker] Workshop: inject cancelled for "${entry.name}"`);
}

/**
 * Push back against a character the AI keeps writing into the scene
 * even after the inject prompt cleared. Sends a strong one-shot
 * direction telling the AI to drop them on the next turn — useful when
 * past chat history has cemented them in context.
 *
 * Side effects:
 *  - Cancels any pending inject for this character (since you can't be
 *    both injecting and ejecting them at once).
 *  - Removes them from the present-now splice if it was added by inject.
 *  - Soft-removes them from the panel via removedCharacters so they
 *    stop showing as a card while the eject is in flight.
 *  - Sets a one-shot extension prompt under EJECT_SLOT that clears on
 *    the next generation_ended (same lifecycle as inject).
 */
export function ejectFromScene(name) {
    const trimmed = String(name || '').trim();
    if (!trimmed) return;

    // If they're mid-inject, cancel that first (mutually exclusive).
    if (pendingInjects.has(trimmed.toLowerCase())) {
        try { cancelInject(trimmed); } catch (e) {}
    }

    // Soft-remove so the card disappears from the panel immediately.
    try {
        const removed = getActiveRemovedCharacters();
        if (Array.isArray(removed)) {
            const lower = trimmed.toLowerCase();
            const already = removed.some(n => typeof n === 'string' && n.toLowerCase() === lower);
            if (!already) {
                removed.push(trimmed);
                saveCharacterRosterChange();
            }
        }
    } catch (e) {
        console.warn('[Dooms Tracker] Workshop: ejectFromScene soft-remove failed', e);
    }

    // Build + queue the anti-inject prompt.
    const prompt = DEFAULT_EJECT_PROMPT.replace(/\{name\}/g, trimmed);
    try {
        setExtensionPrompt(EJECT_SLOT, prompt, extension_prompt_types.IN_PROMPT, 0, false);
        pendingEjectClear = true;
        ejectStartsToSkip = 1;
        console.log(`[Dooms Tracker] Workshop: queued scene-eject for "${trimmed}"`);
    } catch (e) {
        console.warn('[Dooms Tracker] Workshop: ejectFromScene setExtensionPrompt failed', e);
    }

    try { clearPortraitCache(); updatePortraitBar(); } catch (e) {}
    try { renderThoughts(); } catch (e) {}
    try {
        if (window.toastr) {
            window.toastr.info(
                `${trimmed} will be removed from the next AI response. If they keep returning, you may also need to edit recent chat messages where they appeared.`,
                'Character Ejected',
                { timeOut: 6000 },
            );
        }
    } catch (e) {}
}

/**
 * Force-clear ALL pending injections + Doom's extension-prompt slot. Used
 * when a character appears to be getting injected every turn (clear logic
 * jammed, AI continuing the pattern even after our slot cleared, etc.).
 *
 * Wipes:
 *  - the SillyTavern extension prompt under INJECT_SLOT
 *  - pendingInjectClear / injectStartsToSkip flags
 *  - every entry in pendingInjects (with disarmAttach if armed)
 *  - the portrait-bar overlay state via broadcast (one event per entry)
 *
 * Does NOT touch knownCharacters, characterInjection (description /
 * lorebook / promptTemplate), characterColors, or any user-stored data.
 */
export function clearAllInjects() {
    let count = 0;

    try {
        setExtensionPrompt(INJECT_SLOT, '', extension_prompt_types.IN_PROMPT, 0, false);
    } catch (e) {
        console.warn('[Dooms Tracker] Workshop: clearAllInjects setExtensionPrompt failed', e);
    }
    // Also clear any pending eject — same logical bucket of "stuck
    // one-shot directions we want gone".
    try {
        setExtensionPrompt(EJECT_SLOT, '', extension_prompt_types.IN_PROMPT, 0, false);
    } catch (e) {}
    pendingInjectClear = false;
    injectStartsToSkip = 0;
    pendingEjectClear = false;
    ejectStartsToSkip = 0;

    for (const [, entry] of pendingInjects) {
        // Match cancelInject's per-character cleanup so each cancelled
        // character returns to the same place they would've been before
        // Inject was clicked: out of the Present splice (only if we
        // added it), off the INJECTING overlay, and with their attach
        // listener disarmed. Skip unmark for entries the AI had already
        // confirmed pre-inject.
        try { entry.disarmAttach?.(); } catch (e) {}
        if (entry.didSplice) {
            try { unmarkCharacterPresentNow(entry.name); } catch (e) {}
        }
        broadcastInjectState(entry.name, false);
        count++;
    }
    pendingInjects.clear();

    // Belt-and-suspenders: even if every per-character unmark above
    // already triggered a re-render, run one final pass so the panel +
    // thoughts surface settle on a clean state regardless of order.
    try { clearPortraitCache(); updatePortraitBar(); } catch (e) {}
    try { renderThoughts(); } catch (e) {}

    try {
        if (window.toastr) {
            const msg = count > 0
                ? `Cleared ${count} pending injection${count === 1 ? '' : 's'} and wiped the inject prompt slot.`
                : 'No pending injections tracked. Inject prompt slot wiped just in case.';
            window.toastr.info(msg, 'Character Workshop', { timeOut: 4000 });
        }
    } catch (e) {}
    console.log(`[Dooms Tracker] Workshop: clearAllInjects — cleared ${count} pending`);
}

// ---------------------------------------------------------------------------

function ensureModal() {
    if ($modal && $modal.length) return true;
    $modal = $('#character-workshop-popup');
    if (!$modal.length) {
        console.warn('[Dooms Tracker] #character-workshop-popup not in DOM — template.html missing block?');
        $modal = null;
        return false;
    }
    return true;
}

function buildDraft(name, isUser = false) {
    if (isUser) {
        const u = extensionSettings?.userCharacters?.[name] || {};
        const inj = u.injection || {};
        return {
            name,
            isUser: true,
            color: typeof u.color === 'string' ? u.color : '',
            avatar: typeof u.avatar === 'string' ? u.avatar : '',
            avatarFullRes: typeof u.avatarFullRes === 'string' ? u.avatarFullRes : '',
            pronouns: typeof u.pronouns === 'string' ? u.pronouns : '',
            linkedPersona: typeof u.linkedPersona === 'string' ? u.linkedPersona : '',
            // Reuse same field names as NPC draft so render code can be shared
            relationship: '',
            injection: {
                description: typeof inj.description === 'string' ? inj.description : '',
                lorebook: typeof inj.lorebook === 'string' ? inj.lorebook : '',
                promptTemplate: typeof inj.promptTemplate === 'string' ? inj.promptTemplate : '',
            },
            dirty: { color: false, avatar: false, injection: false, relationship: false, pronouns: false, linkedPersona: false },
        };
    }
    const inj = extensionSettings?.characterInjection?.[name] || {};
    return {
        name,
        isUser: false,
        color: extensionSettings?.characterColors?.[name] || '',
        avatar: extensionSettings?.npcAvatars?.[name] || '',
        avatarFullRes: extensionSettings?.npcAvatarsFullRes?.[name] || '',
        relationship: resolveCurrentRelationship(name),
        injection: {
            description: typeof inj.description === 'string' ? inj.description : '',
            lorebook: typeof inj.lorebook === 'string' ? inj.lorebook : '',
            promptTemplate: typeof inj.promptTemplate === 'string' ? inj.promptTemplate : '',
        },
        dirty: { color: false, avatar: false, injection: false, relationship: false },
    };
}

function resolveCurrentRelationship(name) {
    // Persistent user-set override wins over the AI's per-turn classification.
    const override = extensionSettings?.characterRelationships?.[name];
    if (typeof override === 'string' && override) return override;
    // Fallback: best-effort read from the AI's volatile tracker data.
    try {
        const raw = window?.dooms_lastGeneratedData?.characterThoughts;
        if (!raw) return '';
        const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
        const list = parsed?.characters || [];
        const found = list.find(c => c?.name === name);
        return found?.relationship?.status || '';
    } catch (e) {
        return '';
    }
}

function renderTitle() {
    $modal.find('#cw-char-title').text(draft.name);
    $modal.find('#cw-user-badge').prop('hidden', !draft.isUser);
    $modal.find('#cw-modal-title').text(draft.isUser ? 'User Character Workshop' : 'Character Workshop');
    $modal.find('#cw-inject-label').text(draft.isUser ? 'Inject persona' : 'Inject into Scene');
}

function isHiddenFromPanel(name) {
    try {
        const removed = getActiveRemovedCharacters();
        if (!Array.isArray(removed)) return false;
        const lower = String(name || '').toLowerCase();
        return removed.some(n => typeof n === 'string' && n.toLowerCase() === lower);
    } catch (e) { return false; }
}

function renderHiddenBanner() {
    // The hidden-from-panel banner only applies to NPCs (user characters
    // aren't added to the chat's removedCharacters list).
    if (draft?.isUser) {
        $modal.find('#cw-hidden-banner').prop('hidden', true);
        return;
    }
    const hidden = !!draft && isHiddenFromPanel(draft.name);
    $modal.find('#cw-hidden-banner').prop('hidden', !hidden);
}

function restoreCharacterToPanel() {
    if (!draft) return;
    const name = draft.name;
    try {
        const removed = getActiveRemovedCharacters();
        if (Array.isArray(removed) && removed.length) {
            const lower = String(name || '').toLowerCase();
            for (let i = removed.length - 1; i >= 0; i--) {
                if (typeof removed[i] === 'string' && removed[i].toLowerCase() === lower) {
                    removed.splice(i, 1);
                }
            }
            saveCharacterRosterChange();
        }
        clearPortraitCache();
        updatePortraitBar();
    } catch (e) {
        console.warn('[Dooms Tracker] Workshop: restoreCharacterToPanel failed', e);
    }
    renderHiddenBanner();
    try {
        if (window.toastr) window.toastr.success(`"${name}" returned to the panel.`, 'Character Workshop', { timeOut: 3000 });
    } catch (e) {}
}

function renderIdentity() {
    $modal.find('#cw-name').val(draft.name);
    if (draft.isUser) {
        renderPronounChips();
        renderLinkedPersonaSelect();
        // Show pronouns in the preview slot in place of the relationship label
        $modal.find('#cw-preview-rel').text(draft.pronouns ? `(${draft.pronouns})` : '');
    } else {
        const rel = (draft.relationship || '').toLowerCase();
        $modal.find('#cw-rel-chips .rpg-rel-chip').each(function () {
            const $chip = $(this);
            const matches = ($chip.attr('data-rel') || '').toLowerCase() === rel;
            $chip.toggleClass('selected', matches);
            $chip.attr('aria-checked', matches ? 'true' : 'false');
        });
        const $rel = $modal.find('#cw-preview-rel');
        if (draft.relationship) {
            const $match = $modal.find(`#cw-rel-chips .rpg-rel-chip[data-rel="${draft.relationship}"]`);
            const emoji = $match.attr('data-emoji') || '';
            $rel.text(`${emoji} ${draft.relationship}`.trim());
        } else {
            $rel.text('');
        }
    }
    $modal.find('#cw-preview-name').text(draft.name);
    $modal.find('#cw-preview-card-name').text(draft.name);
    applyPreviewColor(draft.color || '#e94560');
}

function renderPronounChips() {
    const current = (draft.pronouns || '').toLowerCase();
    const presets = ['he/him', 'she/her', 'they/them'];
    const isPreset = presets.includes(current);
    const isCustom = !!current && !isPreset;
    $modal.find('#cw-pronoun-chips .rpg-rel-chip').each(function () {
        const $chip = $(this);
        const value = ($chip.attr('data-pronouns') || '').toLowerCase();
        const matches = value === 'custom' ? isCustom : (value === current);
        $chip.toggleClass('selected', matches);
        $chip.attr('aria-checked', matches ? 'true' : 'false');
    });
    const $custom = $modal.find('#cw-pronouns-custom');
    if (isCustom) {
        $custom.val(draft.pronouns).prop('hidden', false);
    } else {
        $custom.val('').prop('hidden', true);
    }
}

function renderLinkedPersonaSelect() {
    const $sel = $modal.find('#cw-linked-persona');
    // Rebuild options from SillyTavern's persona registry. power_user.personas
    // is { avatarFilename: personaName }. Stash the avatar filename as the
    // value so we can sync ST persona switches to the active user character.
    let personas = {};
    try {
        // power_user is imported at module top from ST's power-user.js.
        // Fall through to the window reference in case some fork exposes
        // it that way, then to {} so we never crash here.
        const pu = power_user || (typeof window !== 'undefined' && window.power_user) || null;
        personas = (pu && pu.personas) || {};
    } catch (e) { personas = {}; }
    $sel.empty();
    $sel.append('<option value="">— None —</option>');
    for (const [avatarFile, personaName] of Object.entries(personas)) {
        const opt = document.createElement('option');
        opt.value = avatarFile;
        opt.textContent = personaName || avatarFile;
        $sel[0].appendChild(opt);
    }
    $sel.val(draft.linkedPersona || '');
}

function renderAppearance() {
    const $img = $modal.find('#cw-preview-img');
    const $placeholder = $modal.find('#cw-preview-placeholder');
    if (draft.avatar) {
        $img.attr('src', draft.avatar).show();
        $placeholder.hide();
    } else {
        $img.removeAttr('src').hide();
        $placeholder.show();
    }
    const $palette = $modal.find('#cw-palette').empty();
    for (const hex of DIALOGUE_COLORS) {
        const isSelected = (draft.color || '').toLowerCase() === hex.toLowerCase();
        const $sw = $(`<button type="button" class="rpg-color-swatch${isSelected ? ' selected' : ''}"></button>`);
        $sw.css('background', hex);
        $sw.attr({
            role: 'radio',
            'aria-checked': isSelected ? 'true' : 'false',
            'aria-label': hex,
            'data-hex': hex,
        });
        $palette.append($sw);
    }
}

// Cache of available lorebook names; rebuilt every open so newly-created
// SillyTavern lorebooks show up without a reload. Used by the combobox
// filter to render the dropdown list.
let lorebookOptions = [];

function renderInjection() {
    $modal.find('#cw-inj-description').val(draft.injection.description || '');
    $modal.find('#cw-inj-prompt').val(draft.injection.promptTemplate || '');

    // Refresh the available lorebook list.
    try {
        lorebookOptions = getAllWorldNames() || [];
    } catch (e) {
        console.warn('[Dooms Tracker] Workshop: getAllWorldNames failed', e);
        lorebookOptions = [];
    }

    // Pre-fill the combobox input with the saved lorebook (if any).
    $modal.find('#cw-inj-lorebook').val(draft.injection.lorebook || '');
    closeLorebookCombo();

    // Sync the global "Attach portrait to message" toggle.
    $modal.find('#cw-inj-attach-portrait').prop('checked', extensionSettings?.injectAttachPortrait === true);

    // Sync the per-character Banish toggle.
    $modal.find('#cw-banish').prop('checked', isCharacterBanished(draft.name));
}

function renderLorebookComboList(filter) {
    const $list = $modal.find('#cw-inj-lorebook-list').empty();
    const needle = (filter || '').trim().toLowerCase();
    const matches = lorebookOptions.filter(n => !needle || n.toLowerCase().includes(needle));
    const saved = draft?.injection?.lorebook || '';

    // Always include "None" at the top so the user can clear without
    // selecting all the text.
    if (!needle || 'none'.includes(needle) || '— none —'.includes(needle)) {
        const $none = $('<li class="cw-combobox-none" data-value="">— None —</li>');
        if (!saved) $none.addClass('is-active');
        $list.append($none);
    }

    if (matches.length === 0 && needle) {
        $list.append('<li class="cw-combobox-empty">No lorebooks match.</li>');
    } else {
        for (const wname of matches) {
            const $li = $('<li></li>')
                .attr('data-value', wname)
                .text(wname);
            if (wname === saved) $li.addClass('is-active');
            $list.append($li);
        }
    }

    // If the saved value isn't present in the available names, surface it
    // at the bottom flagged as missing so the user can see it's stale.
    if (saved && !lorebookOptions.includes(saved) && (!needle || saved.toLowerCase().includes(needle))) {
        const $li = $('<li></li>')
            .attr('data-value', saved)
            .addClass('is-missing is-active')
            .text(`${saved} (missing)`);
        $list.append($li);
    }
}

function openLorebookCombo() {
    const $combo = $modal.find('#cw-inj-lorebook-combo');
    const $list = $modal.find('#cw-inj-lorebook-list');
    const $input = $modal.find('#cw-inj-lorebook');
    if ($combo.hasClass('is-open')) return;
    renderLorebookComboList($input.val());
    $combo.addClass('is-open');
    $list.prop('hidden', false);
    $input.attr('aria-expanded', 'true');
}

function closeLorebookCombo() {
    const $combo = $modal.find('#cw-inj-lorebook-combo');
    const $list = $modal.find('#cw-inj-lorebook-list');
    const $input = $modal.find('#cw-inj-lorebook');
    $combo.removeClass('is-open');
    $list.prop('hidden', true);
    $input.attr('aria-expanded', 'false');
}

function commitLorebookSelection(value) {
    if (!draft) return;
    draft.injection.lorebook = String(value || '').trim();
    draft.dirty.injection = true;
    $modal.find('#cw-inj-lorebook').val(draft.injection.lorebook);
    closeLorebookCombo();
}

function applyPreviewColor(hex) {
    $modal.find('#cw-preview-card-name').css('color', hex);
    $modal.find('#cw-preview-name').css('color', hex);
    $modal.find('#cw-preview-color-dot').css('background', hex);
    // Keep the custom-color button's preview chip in sync too.
    $modal.find('#cw-color-custom-preview').css('background', hex);
    $modal.find('#cw-color-custom-input').val(hex);
}

/**
 * Commit a new dialogue color to the draft and refresh all UI that
 * shows it (palette selection state, preview card, custom button chip).
 * Accepts any hex; if the color matches a palette swatch, that swatch
 * gets the 'selected' highlight too.
 */
function commitColorSelection(hex) {
    if (!draft || !hex) return;
    const lower = String(hex).toLowerCase();
    draft.color = lower;
    draft.dirty.color = true;
    $modal.find('.rpg-color-swatch').each(function () {
        const match = ($(this).attr('data-hex') || '').toLowerCase() === lower;
        $(this).toggleClass('selected', match);
        $(this).attr('aria-checked', match ? 'true' : 'false');
    });
    applyPreviewColor(lower);
}

function activatePane(paneId) {
    $modal.find('.workshop-nav button').each(function () {
        $(this).toggleClass('active', $(this).attr('data-pane') === paneId);
    });
    $modal.find('.rpg-editor-pane').each(function () {
        $(this).toggleClass('active', $(this).attr('data-pane') === paneId);
    });
}

function bindStaticListeners() {
    $modal.on('click.cw', '.workshop-nav button', function () {
        const pane = $(this).attr('data-pane');
        if (!pane) return;
        activatePane(pane);
        if (pane === 'expressions') {
            // Lazy-load on first activation per character — re-renders if
            // the user already has it but the character changed.
            const $panel = $modal.find('#cw-expressions-pane');
            const charName = draft?.name || '';
            if (charName && $panel.attr('data-character') !== charName) {
                $panel.attr('data-character', charName);
                renderExpressionsTab($panel, charName);
            }
        }
    });

    bindExpressionHandlers();

    $modal.on('click.cw', '#cw-close, #cw-cancel', () => closeCharacterWorkshop());
    $modal.on('click.cw', '#cw-hidden-restore', () => restoreCharacterToPanel());
    $modal.on('click.cw', function (e) {
        if (e.target === this) closeCharacterWorkshop();
    });

    $modal.on('click.cw', '.rpg-color-swatch', function () {
        if (!draft) return;
        const hex = $(this).attr('data-hex');
        if (!hex) return;
        commitColorSelection(hex);
    });

    // Relationship chip click — set persistent override. Click again to clear.
    // Scoped to #cw-rel-chips so the pronoun chips below don't get hit by it.
    $modal.on('click.cw', '#cw-rel-chips .rpg-rel-chip', function () {
        if (!draft || draft.isUser) return;
        const $chip = $(this);
        const picked = String($chip.attr('data-rel') || '');
        const current = String(draft.relationship || '');
        const next = (current.toLowerCase() === picked.toLowerCase()) ? '' : picked;
        draft.relationship = next;
        draft.dirty.relationship = true;
        $modal.find('#cw-rel-chips .rpg-rel-chip').each(function () {
            const match = ($(this).attr('data-rel') || '').toLowerCase() === next.toLowerCase() && !!next;
            $(this).toggleClass('selected', match);
            $(this).attr('aria-checked', match ? 'true' : 'false');
        });
        const $rel = $modal.find('#cw-preview-rel');
        if (next) {
            const emoji = $chip.attr('data-emoji') || '';
            $rel.text(`${emoji} ${next}`.trim());
        } else {
            $rel.text('');
        }
    });

    // Pronoun chip click (user-mode) — picks one of the presets or reveals
    // the custom input. Click the active chip again to clear.
    $modal.on('click.cw', '#cw-pronoun-chips .rpg-rel-chip', function () {
        if (!draft || !draft.isUser) return;
        const $chip = $(this);
        const value = String($chip.attr('data-pronouns') || '');
        const current = String(draft.pronouns || '');
        const $custom = $modal.find('#cw-pronouns-custom');
        if (value === 'custom') {
            // Toggle custom mode: reveal the input; pre-fill with whatever
            // the current value is if it's already custom.
            const presets = ['he/him', 'she/her', 'they/them'];
            const wasCustom = current && !presets.includes(current.toLowerCase());
            if (wasCustom) {
                draft.pronouns = '';
                draft.dirty.pronouns = true;
                $custom.prop('hidden', true).val('');
            } else {
                $custom.prop('hidden', false).val(current && !presets.includes(current.toLowerCase()) ? current : '').trigger('focus');
            }
        } else {
            const next = current.toLowerCase() === value ? '' : value;
            draft.pronouns = next;
            draft.dirty.pronouns = true;
            $custom.prop('hidden', true).val('');
        }
        renderPronounChips();
        $modal.find('#cw-preview-rel').text(draft.pronouns ? `(${draft.pronouns})` : '');
    });

    // Custom pronoun input — saves on every keystroke
    $modal.on('input.cw', '#cw-pronouns-custom', function () {
        if (!draft || !draft.isUser) return;
        const value = String($(this).val() || '').trim();
        draft.pronouns = value;
        draft.dirty.pronouns = true;
        $modal.find('#cw-preview-rel').text(value ? `(${value})` : '');
    });

    // Linked SillyTavern persona dropdown — saves the avatar filename
    $modal.on('change.cw', '#cw-linked-persona', function () {
        if (!draft || !draft.isUser) return;
        draft.linkedPersona = String($(this).val() || '');
        draft.dirty.linkedPersona = true;
    });

    // "Set as active persona" footer button — flips DES's activeUserCharacter,
    // forces "Show User in PCP" on so the card actually appears, and (if
    // linked to a ST persona) calls SillyTavern's persona switch flow.
    $modal.on('click.cw', '#cw-set-active-persona', function () {
        if (!draft || !draft.isUser) return;
        try {
            extensionSettings.activeUserCharacter = draft.name;
            // Picking "Set as active" implies the user wants to see them in
            // the panel — flip the master toggle on so the card renders even
            // if it had been disabled in Settings.
            extensionSettings.showUserInPCP = true;
            saveSettings();
            // Reflect the toggle change in the settings UI if it's open.
            try { $('#rpg-pb-show-user').prop('checked', true); } catch (e) {}
        } catch (e) {}
        // If the user character is linked to a persona, fire ST's persona
        // switch. Implementations vary across ST versions, so try the
        // common entry points and silently fall through.
        const linked = draft.linkedPersona || '';
        if (linked) {
            try {
                if (typeof window.setUserAvatar === 'function') {
                    window.setUserAvatar(linked);
                } else if (power_user && typeof power_user.persona_set === 'function') {
                    power_user.persona_set(linked);
                } else {
                    // Fallback: dispatch a click on the persona's avatar in the
                    // Personas panel so ST's own handler picks it up.
                    const sel = `[data-pa-avatar="${linked}"], [data-avatar-file="${linked}"]`;
                    const el = document.querySelector(sel);
                    if (el) el.click();
                }
            } catch (e) {
                console.warn('[Dooms Tracker] Failed to switch ST persona:', e);
            }
        }
        try {
            if (window.toastr) window.toastr.success(`Active user character set to "${draft.name}".`, 'Character Workshop', { timeOut: 3000 });
        } catch (e) {}
        // Re-render the PCP so the user-card shows up with the new active.
        try { updatePortraitBar(); } catch (e) {}
    });

    // Custom-color dropper — opens the native color picker sheet.
    $modal.on('click.cw', '#cw-color-custom-btn', function (e) {
        e.preventDefault();
        const $input = $modal.find('#cw-color-custom-input');
        if (!$input.length) return;
        // Seed the picker with the draft's current color so it opens on it.
        if (draft?.color) $input.val(draft.color);
        $input[0].click();
    });
    $modal.on('input.cw change.cw', '#cw-color-custom-input', function () {
        if (!draft) return;
        const hex = String($(this).val() || '').toLowerCase();
        if (!/^#[0-9a-f]{6}$/.test(hex)) return;
        commitColorSelection(hex);
    });

    $modal.on('change.cw', '#cw-portrait-file', async function () {
        if (!draft) return;
        const fileInput = this;
        const file = fileInput.files && fileInput.files[0];
        if (!file) return;
        try {
            const dataUrl = await getBase64Async(file);

            // Open SillyTavern's built-in crop popup so users can frame the
            // portrait before saving. Same 3:4 aspect + upscale pipeline as
            // the portrait-bar's right-click "Upload Portrait" path so the
            // resulting images match in dimensions.
            const safeName = (draft.name || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
            const titleHtml = draft.isUser
                ? `<h3>Crop portrait for user character: ${safeName}</h3>`
                : `<h3>Crop portrait for ${safeName}</h3>`;
            const croppedImage = await callGenericPopup(
                titleHtml,
                POPUP_TYPE.CROP,
                '',
                { cropAspect: 3 / 4, cropImage: dataUrl },
            );
            if (!croppedImage) {
                console.log('[Dooms Tracker] Workshop: portrait crop cancelled');
                return;
            }

            // Upscale the cropped result to 660x880 PNG for crisp portrait
            // display. The CROP popup returns a low-res JPEG at the crop
            // pixel size; redrawing it at portrait resolution prevents
            // softness when it's used in the bar / chat bubbles.
            const PORTRAIT_W = 660;
            const PORTRAIT_H = 880;
            const hiResDataUrl = await upscaleImage(String(croppedImage), PORTRAIT_W, PORTRAIT_H);

            draft.avatar = hiResDataUrl;
            draft.avatarFullRes = hiResDataUrl;
            draft.dirty.avatar = true;
            $modal.find('#cw-preview-img').attr('src', hiResDataUrl).show();
            $modal.find('#cw-preview-placeholder').hide();
        } catch (err) {
            console.warn('[Dooms Tracker] Workshop: portrait upload failed', err);
            try {
                if (window.toastr) window.toastr.error(
                    String(err?.message || err || 'Upload failed.'),
                    'Portrait upload',
                    { timeOut: 4000 },
                );
            } catch (e) {}
        } finally {
            // Always clear so the same file can be picked again.
            try { fileInput.value = ''; } catch (e) {}
        }
    });

    $modal.on('input.cw change.cw', '#cw-inj-description', function () {
        if (!draft) return;
        draft.injection.description = String($(this).val() || '');
        draft.dirty.injection = true;
    });

    $modal.on('input.cw change.cw', '#cw-inj-prompt', function () {
        if (!draft) return;
        draft.injection.promptTemplate = String($(this).val() || '');
        draft.dirty.injection = true;
    });
    $modal.on('click.cw', '#cw-inj-prompt-reset', function (e) {
        e.preventDefault();
        if (!draft) return;
        draft.injection.promptTemplate = DEFAULT_INJECT_PROMPT;
        draft.dirty.injection = true;
        $modal.find('#cw-inj-prompt').val(DEFAULT_INJECT_PROMPT).trigger('focus');
    });

    $modal.on('click.cw', '#cw-clear-all-injects', function (e) {
        e.preventDefault();
        clearAllInjects();
    });

    $modal.on('change.cw', '#cw-banish', function () {
        if (!draft) return;
        const checked = $(this).prop('checked');
        setCharacterBanished(draft.name, !!checked);
        renderHiddenBanner();
        try {
            if (window.toastr) {
                if (checked) {
                    window.toastr.info(`"${draft.name}" is now banished — every AI generation will be told they're not in the scene.`, 'Character Workshop', { timeOut: 5000 });
                } else {
                    window.toastr.info(`"${draft.name}" is no longer banished.`, 'Character Workshop', { timeOut: 3000 });
                }
            }
        } catch (e) {}
    });

    // "Attach portrait to message" — global setting (not per-character).
    // Persisted immediately on toggle so it sticks even if the user closes
    // the Workshop with Cancel.
    $modal.on('change.cw', '#cw-inj-attach-portrait', function () {
        extensionSettings.injectAttachPortrait = $(this).prop('checked');
        try { saveSettings(); } catch (e) { console.warn('[Dooms Tracker] Workshop: failed to save injectAttachPortrait', e); }
    });

    // Combobox: open on focus / click, filter as the user types.
    $modal.on('focus.cw click.cw', '#cw-inj-lorebook', function () {
        openLorebookCombo();
    });
    $modal.on('input.cw', '#cw-inj-lorebook', function () {
        openLorebookCombo();
        renderLorebookComboList($(this).val());
        // Don't commit yet — only on selection or blur. But mark dirty so
        // a Save right after typing a literal name still persists.
        if (!draft) return;
        draft.injection.lorebook = String($(this).val() || '').trim();
        draft.dirty.injection = true;
    });
    $modal.on('keydown.cw', '#cw-inj-lorebook', function (e) {
        if (e.key === 'Escape') {
            e.stopPropagation();
            closeLorebookCombo();
        } else if (e.key === 'Enter') {
            e.preventDefault();
            // Pick the first match in the current filter.
            const first = $modal.find('#cw-inj-lorebook-list li[data-value]').first();
            if (first.length) commitLorebookSelection(first.attr('data-value') || '');
        }
    });
    $modal.on('click.cw', '#cw-inj-lorebook-toggle', function (e) {
        e.preventDefault();
        if ($modal.find('#cw-inj-lorebook-combo').hasClass('is-open')) {
            closeLorebookCombo();
        } else {
            openLorebookCombo();
            $modal.find('#cw-inj-lorebook').trigger('focus');
        }
    });
    $modal.on('mousedown.cw', '#cw-inj-lorebook-list li[data-value]', function (e) {
        e.preventDefault(); // keep input focus
        commitLorebookSelection($(this).attr('data-value') || '');
    });
    // Click outside the combobox closes it.
    $modal.on('click.cw', function (e) {
        if (!$modal.find('#cw-inj-lorebook-combo').hasClass('is-open')) return;
        if ($(e.target).closest('#cw-inj-lorebook-combo').length === 0) {
            closeLorebookCombo();
        }
    });

    $modal.on('click.cw', '#cw-open-expressions', () => {
        if (!draft) return;
        try {
            openExpressionFolder(draft.name);
        } catch (e) {
            console.warn('[Dooms Tracker] Workshop: openExpressionFolder failed', e);
        }
    });

    $modal.on('click.cw', '#cw-portrait-clear', () => {
        if (!draft) return;
        draft.avatar = '';
        draft.avatarFullRes = '';
        draft.dirty.avatar = true;
        $modal.find('#cw-portrait-file').val('');
        $modal.find('#cw-preview-img').removeAttr('src').hide();
        $modal.find('#cw-preview-placeholder').show();
    });

    $modal.on('click.cw', '#cw-save', () => {
        if (!draft) return;
        commitDraft();
        closeCharacterWorkshop();
    });

    // Copy NPC → User Characters list (NPC-only footer action)
    $modal.on('click.cw', '#cw-copy-to-users', () => {
        if (!draft || draft.isUser) return;
        commitDraft();
        copyNpcToUserCharacter(draft.name);
    });

    // Copy User Character → NPC list (user-only footer action)
    $modal.on('click.cw', '#cw-copy-to-characters', () => {
        if (!draft || !draft.isUser) return;
        commitDraft();
        copyUserToNpcCharacter(draft.name);
    });

    $modal.on('click.cw', '#cw-inject', () => {
        if (!draft) return;
        commitDraft(); // persist any pending appearance edits first
        if (draft.isUser) {
            injectUserPersona(draft.name);
        } else {
            injectIntoScene(draft.name);
        }
        closeCharacterWorkshop();
    });

    $modal.on('click.cw', '#cw-eject', () => {
        if (!draft) return;
        ejectFromScene(draft.name);
        closeCharacterWorkshop();
    });

    $modal.on('click.cw', '#cw-export', () => {
        if (!draft) return;
        try {
            exportDraft();
        } catch (e) {
            console.warn('[Dooms Tracker] Workshop: export failed', e);
            if (window.toastr) window.toastr.error('Export failed — see console for details.', 'Character Workshop');
        }
    });

    $modal.on('click.cw', '#cw-delete', () => {
        if (!draft) return;
        const name = draft.name;
        const ok = window.confirm(t(
            'characterWorkshop.confirmDelete',
            `Delete "{name}" from this chat's roster?\n\nThis removes the portrait, dialogue color, and known-character entry. Sheet data is kept.`,
            { name },
        ));
        if (!ok) return;
        deleteCharacter(name);
        closeCharacterWorkshop();
    });
}

function commitDraft() {
    if (!draft) return;
    const name = draft.name;
    let changed = false;

    // User-character mode: write the whole entry into a single namespace.
    if (draft.isUser) {
        if (!extensionSettings.userCharacters) extensionSettings.userCharacters = {};
        const existing = extensionSettings.userCharacters[name] || {};
        const tplRaw = (draft.injection.promptTemplate || '').trim();
        const tpl = (tplRaw && tplRaw !== DEFAULT_INJECT_PROMPT.trim()) ? tplRaw : '';
        const desc = (draft.injection.description || '').trim();
        const book = (draft.injection.lorebook || '').trim();
        const next = {
            ...existing,
            color: draft.color || '',
            avatar: draft.avatar || '',
            avatarFullRes: draft.avatarFullRes || draft.avatar || '',
            pronouns: draft.pronouns || '',
            linkedPersona: draft.linkedPersona || '',
            injection: { description: desc, lorebook: book, ...(tpl ? { promptTemplate: tpl } : {}) },
        };
        extensionSettings.userCharacters[name] = next;
        try { saveSettings(); } catch (e) {}
        try { updatePortraitBar(); } catch (e) {}
        return;
    }

    if (draft.dirty.color) {
        // Use the chat-aware getter so colors land in the right store.
        // When perChatCharacterTracking is on, characterColors live in
        // chat_metadata.dooms_tracker, NOT extensionSettings — writing
        // to extensionSettings here meant the PCP (which renders from
        // the chat-scoped map) never saw the new color.
        const colors = getActiveCharacterColors();
        if (draft.color) {
            colors[name] = draft.color;
        } else {
            delete colors[name];
        }
        // Persist via the matching saver (saveChatData when per-chat,
        // saveSettings otherwise) — saveCharacterRosterChange picks
        // the right one. The trailing saveSettings() at the end of
        // commitDraft still runs for the non-per-chat fields.
        try { saveCharacterRosterChange(); } catch (e) {}
        changed = true;
    }

    if (draft.dirty.avatar) {
        if (!extensionSettings.npcAvatars) extensionSettings.npcAvatars = {};
        if (!extensionSettings.npcAvatarsFullRes) extensionSettings.npcAvatarsFullRes = {};
        if (draft.avatar) {
            extensionSettings.npcAvatars[name] = draft.avatar;
            extensionSettings.npcAvatarsFullRes[name] = draft.avatarFullRes || draft.avatar;
        } else {
            delete extensionSettings.npcAvatars[name];
            delete extensionSettings.npcAvatarsFullRes[name];
        }
        changed = true;
    }

    if (draft.dirty.relationship) {
        if (!extensionSettings.characterRelationships) extensionSettings.characterRelationships = {};
        if (draft.relationship) {
            extensionSettings.characterRelationships[name] = draft.relationship;
        } else {
            delete extensionSettings.characterRelationships[name];
        }
        changed = true;
    }

    if (draft.dirty.injection) {
        if (!extensionSettings.characterInjection) extensionSettings.characterInjection = {};
        const desc = (draft.injection.description || '').trim();
        const book = (draft.injection.lorebook || '').trim();
        // Only persist the template when it actually differs from the
        // default — this keeps settings compact for unmodified characters
        // and lets us ship default-prompt changes in the future without
        // every character being pinned to the old text.
        const tplRaw = (draft.injection.promptTemplate || '').trim();
        const tpl = (tplRaw && tplRaw !== DEFAULT_INJECT_PROMPT.trim()) ? tplRaw : '';
        if (desc || book || tpl) {
            const entry = { description: desc, lorebook: book };
            if (tpl) entry.promptTemplate = tpl;
            extensionSettings.characterInjection[name] = entry;
        } else {
            delete extensionSettings.characterInjection[name];
        }
        changed = true;
    }

    if (!changed) return;
    saveSettings();
    try {
        clearPortraitCache();
        updatePortraitBar();
    } catch (e) {
        console.warn('[Dooms Tracker] Workshop: failed to refresh portrait bar after save', e);
    }
}

/**
 * Copy an NPC into the user-character namespace. Pulls color, avatar,
 * and description from the NPC's persisted state. Refuses if a user
 * character with this name already exists (to avoid silent overwrites).
 */
function copyNpcToUserCharacter(name) {
    const trimmed = String(name || '').trim();
    if (!trimmed) return;
    if (!extensionSettings.userCharacters) extensionSettings.userCharacters = {};
    if (extensionSettings.userCharacters[trimmed]) {
        try {
            if (window.toastr) window.toastr.warning(
                `A user character named "${trimmed}" already exists. Rename or delete it first.`,
                'Copy to Users',
                { timeOut: 4500 },
            );
        } catch (e) {}
        return;
    }
    const color = extensionSettings.characterColors?.[trimmed] || '';
    let avatar = extensionSettings.npcAvatars?.[trimmed] || '';
    let avatarFullRes = extensionSettings.npcAvatarsFullRes?.[trimmed] || '';
    // If npcAvatars is empty (NPC's portrait comes from a SillyTavern
    // character card or the portraits/ folder), let resolvePortrait
    // find the canonical URL so the copy isn't blank.
    if (!avatar) {
        try { avatar = resolvePortrait(trimmed) || ''; } catch (e) {}
    }
    if (!avatarFullRes) avatarFullRes = avatar;
    const inj = extensionSettings.characterInjection?.[trimmed] || {};
    extensionSettings.userCharacters[trimmed] = {
        color,
        avatar,
        avatarFullRes,
        pronouns: '',
        linkedPersona: '',
        injection: {
            description: typeof inj.description === 'string' ? inj.description : '',
            lorebook: '',
            // Don't carry the NPC inject prompt template — user inject uses
            // a different default flow.
        },
    };
    try { saveSettings(); } catch (e) {}
    try {
        if (window.toastr) window.toastr.success(
            `Copied "${trimmed}" to User Characters.`,
            'Workshop',
            { timeOut: 3000 },
        );
    } catch (e) {}
}

/**
 * Copy a user character into the NPC namespace. Pulls color, avatar,
 * and description from the user character. Refuses if an NPC with
 * this name already exists.
 */
function copyUserToNpcCharacter(name) {
    const trimmed = String(name || '').trim();
    if (!trimmed) return;
    const npcAlready =
        extensionSettings.knownCharacters?.[trimmed] ||
        extensionSettings.characterColors?.[trimmed] ||
        extensionSettings.npcAvatars?.[trimmed];
    if (npcAlready) {
        try {
            if (window.toastr) window.toastr.warning(
                `A character named "${trimmed}" already exists. Rename or delete it first.`,
                'Copy to Characters',
                { timeOut: 4500 },
            );
        } catch (e) {}
        return;
    }
    const u = extensionSettings.userCharacters?.[trimmed] || {};
    // Resolve the canonical avatar URL — u.avatar comes from a Workshop
    // upload OR persona-import; if those are blank, derive it from the
    // linkedPersona's avatar filename; if THAT's blank, ask resolvePortrait
    // (covers SillyTavern character-card auto-import + portraits/ folder).
    let avatar = u.avatar || '';
    if (!avatar && u.linkedPersona) {
        avatar = '/User%20Avatars/' + encodeURIComponent(u.linkedPersona);
    }
    if (!avatar) {
        try { avatar = resolvePortrait(trimmed) || ''; } catch (e) {}
    }
    const avatarFullRes = u.avatarFullRes || avatar;
    if (!extensionSettings.knownCharacters) extensionSettings.knownCharacters = {};
    if (!extensionSettings.npcAvatars) extensionSettings.npcAvatars = {};
    if (!extensionSettings.npcAvatarsFullRes) extensionSettings.npcAvatarsFullRes = {};
    if (!extensionSettings.characterColors) extensionSettings.characterColors = {};
    if (!extensionSettings.characterInjection) extensionSettings.characterInjection = {};
    extensionSettings.knownCharacters[trimmed] = { emoji: '👤' };
    if (u.color) extensionSettings.characterColors[trimmed] = u.color;
    if (avatar) extensionSettings.npcAvatars[trimmed] = avatar;
    if (avatarFullRes) extensionSettings.npcAvatarsFullRes[trimmed] = avatarFullRes;
    const desc = typeof u.injection?.description === 'string' ? u.injection.description : '';
    if (desc) extensionSettings.characterInjection[trimmed] = { description: desc, lorebook: '' };
    try { saveSettings(); } catch (e) {}
    try { clearPortraitCache(); updatePortraitBar(); } catch (e) {}
    try {
        if (window.toastr) window.toastr.success(
            `Copied "${trimmed}" to Characters.`,
            'Workshop',
            { timeOut: 3000 },
        );
    } catch (e) {}
}

function deleteCharacter(name) {
    // User character delete: only touches the userCharacters namespace
    // and clears activeUserCharacter if it was pointing at this entry.
    if (draft?.isUser) {
        if (extensionSettings.userCharacters) delete extensionSettings.userCharacters[name];
        if (extensionSettings.activeUserCharacter === name) {
            extensionSettings.activeUserCharacter = null;
        }
        try { saveSettings(); } catch (e) {}
        try { updatePortraitBar(); } catch (e) {}
        return;
    }
    if (extensionSettings.characterColors) delete extensionSettings.characterColors[name];
    if (extensionSettings.npcAvatars) delete extensionSettings.npcAvatars[name];
    if (extensionSettings.npcAvatarsFullRes) delete extensionSettings.npcAvatarsFullRes[name];
    if (extensionSettings.knownCharacters) delete extensionSettings.knownCharacters[name];
    if (extensionSettings.heroPositions) delete extensionSettings.heroPositions[name];
    // Match characterRoster.purgeCharacter — wipe Workshop-specific
    // injection extras too (description / lorebook attachment) so
    // delete-from-Workshop and delete-from-Roster are symmetric.
    if (extensionSettings.characterInjection) delete extensionSettings.characterInjection[name];
    if (extensionSettings.characterRelationships) delete extensionSettings.characterRelationships[name];
    saveSettings();
    try {
        clearPortraitCache();
        updatePortraitBar();
    } catch (e) {
        console.warn('[Dooms Tracker] Workshop: failed to refresh portrait bar after delete', e);
    }
}

/**
 * Bring the character into the current chat:
 *   1. Ensure the active known-characters map has them (chat-scoped if
 *      perChatCharacterTracking is on, global otherwise) so the portrait
 *      bar renders them immediately.
 *   2. Queue a one-shot extension prompt telling the AI to incorporate
 *      the character in the next response. The prompt self-clears on
 *      GENERATION_ENDED (see initCharacterWorkshop listener).
 */
/**
 * User-character variant of injectIntoScene. Sends the player's persona
 * description as a one-shot extension prompt for the next generation,
 * and (if the global "attach portrait" toggle is on) attaches the user
 * character's portrait to the next outgoing user message for vision-
 * capable models. Skips all the NPC-only steps: roster splice, present-
 * marking, lorebook activation, relationship lacing.
 */
function injectUserPersona(name) {
    const trimmed = String(name || '').trim();
    if (!trimmed) return;
    const description = (draft?.injection?.description || '').trim();
    const promptParts = [];
    if (description) {
        promptParts.push(`The player's persona — ${trimmed}: ${description}`);
        promptParts.push('Address the player as this persona for the next response.');
    }
    const prompt = promptParts.join('\n\n');
    if (prompt) {
        try {
            setExtensionPrompt(
                INJECT_SLOT,
                prompt,
                extension_prompt_types.IN_PROMPT,
                0,
                false,
            );
            pendingInjectClear = true;
            injectStartsToSkip = 1;
            console.log(`[Dooms Tracker] Workshop: queued persona-inject for "${trimmed}"`);
        } catch (e) {
            console.warn('[Dooms Tracker] Workshop: setExtensionPrompt failed', e);
        }
    }
    // Optional portrait attachment for vision-capable models — same path
    // NPCs use, just sourced from the user-character's avatar.
    let attached = false;
    if (extensionSettings?.injectAttachPortrait === true && draft?.avatar) {
        try {
            armPortraitAttach(trimmed, draft.avatar);
            attached = true;
        } catch (e) {
            console.warn('[Dooms Tracker] Workshop: portrait attach failed', e);
        }
    }
    try {
        if (window.toastr) {
            const bits = [];
            if (description) bits.push('description');
            if (attached) bits.push('portrait');
            const what = bits.length ? bits.join(' + ') : 'nothing';
            window.toastr.success(
                `Persona injected (${what}). Sends with the next reply.`,
                'Character Workshop',
                { timeOut: 3500 },
            );
        }
    } catch (e) {}
}

function injectIntoScene(name) {
    const trimmed = String(name || '').trim();
    if (!trimmed) return;

    // 0. Mark this character as mid-inject + broadcast BEFORE any portrait
    //    bar render. The broadcast populates portraitBar's _injectingNames
    //    Set so every subsequent updatePortraitBar() call (whether from
    //    roster mutation, mark-present, or the broadcast itself) renders
    //    the INJECTING overlay consistently. Stuffing it in late meant the
    //    early renders briefly showed a card with no overlay, and any
    //    failure in the later steps could leave the overlay missing
    //    entirely. disarmAttach is filled in at step 5 once we know
    //    whether a portrait was actually attached.
    pendingInjects.set(trimmed.toLowerCase(), { name: trimmed, disarmAttach: null, didSplice: false });
    broadcastInjectState(trimmed, true);

    // 1. Roster membership + lift any soft-remove. If the user previously
    //    right-clicked 'Send to Workshop' the name sits in removedCharacters;
    //    getCharacterList() filters those out AFTER the present-splice, so
    //    without this the injected card would never appear.
    try {
        const roster = getActiveKnownCharacters();
        if (!roster[trimmed]) {
            roster[trimmed] = { emoji: '❓' };
            saveCharacterRosterChange();
        }
        try {
            const removed = getActiveRemovedCharacters();
            if (Array.isArray(removed) && removed.length) {
                const lower = trimmed.toLowerCase();
                for (let i = removed.length - 1; i >= 0; i--) {
                    if (typeof removed[i] === 'string' && removed[i].toLowerCase() === lower) {
                        removed.splice(i, 1);
                    }
                }
                saveCharacterRosterChange();
            }
        } catch (e) { /* best-effort un-hide */ }
    } catch (e) {
        console.warn('[Dooms Tracker] Workshop: failed to add to roster before inject', e);
    }

    // 1b. Mark the character as PRESENT in the current scene immediately so
    //     the Present Characters panel highlights them right away, instead
    //     of waiting for the next AI turn to put them into characterThoughts.
    //     This calls updatePortraitBar() internally, which by now sees both
    //     the present splice AND the injecting state. Track whether the
    //     splice actually added (vs. found an existing entry) so cancel
    //     doesn't erroneously remove an AI-confirmed character.
    let didSplice = false;
    try { didSplice = markCharacterPresentNow(trimmed); } catch (e) {
        console.warn('[Dooms Tracker] Workshop: failed to mark character present', e);
    }
    {
        const entry = pendingInjects.get(trimmed.toLowerCase());
        if (entry) entry.didSplice = !!didSplice;
    }

    // 2. Resolve any persisted injection extras (description + lorebook + relationship + prompt template).
    const stored = extensionSettings?.characterInjection?.[trimmed] || {};
    const description = (draft.injection?.description ?? stored.description ?? '').trim();
    const lorebook = (draft.injection?.lorebook ?? stored.lorebook ?? '').trim();
    const relationship = (draft.relationship || extensionSettings?.characterRelationships?.[trimmed] || '').trim();
    const promptTemplate = (draft.injection?.promptTemplate ?? stored.promptTemplate ?? '').trim();

    // 3. If a lorebook is attached and not already active, activate it so
    //    SillyTavern's WI engine pulls from it for the next generation.
    if (lorebook) {
        try {
            if (typeof isWorldActive === 'function' && !isWorldActive(lorebook)) {
                activateWorld(lorebook);
                console.log(`[Dooms Tracker] Workshop: activated lorebook "${lorebook}" for inject`);
            }
        } catch (e) {
            console.warn(`[Dooms Tracker] Workshop: failed to activate lorebook "${lorebook}"`, e);
        }
    }

    // 4. One-shot prompt
    const prompt = buildInjectPrompt(trimmed, { description, lorebook, relationship, promptTemplate });
    try {
        setExtensionPrompt(
            INJECT_SLOT,
            prompt,
            extension_prompt_types.IN_PROMPT,
            0,
            false,
        );
        pendingInjectClear = true;
        // Allow the very next GENERATION_STARTED (the one this inject is
        // intended for) to pass without clearing. Any subsequent START
        // will trigger the clear.
        injectStartsToSkip = 1;
        console.log(`[Dooms Tracker] Workshop: queued scene-inject for "${trimmed}"`);
    } catch (e) {
        console.warn('[Dooms Tracker] Workshop: setExtensionPrompt failed', e);
    }

    // 5. Optional portrait attachment for vision-capable models. Arms a
    //    one-shot MESSAGE_SENT listener that stamps extra.image on the
    //    user's next outgoing message; SillyTavern's Generate then includes
    //    that image in the request payload (multimodal APIs only).
    let attached = false;
    if (extensionSettings?.injectAttachPortrait === true && draft?.avatar) {
        const disarmAttach = armPortraitAttach(trimmed, draft.avatar);
        // Update the pending entry so cancelInject can disarm later.
        const entry = pendingInjects.get(trimmed.toLowerCase());
        if (entry) entry.disarmAttach = disarmAttach;
        attached = true;
    }

    // 6. Belt-and-suspenders: one final render after every state change is
    //    in place. Cheap, idempotent, and protects against any earlier
    //    render that may have been swallowed by a thrown handler upstream.
    try { clearPortraitCache(); updatePortraitBar(); } catch (e) {}

    // 7. User feedback
    try {
        if (window.toastr) {
            const extras = [];
            if (relationship) extras.push(`relationship=${relationship}`);
            if (description) extras.push('description');
            if (lorebook) extras.push(`lorebook "${lorebook}"`);
            if (attached) extras.push('portrait');
            const tail = extras.length ? ` (with ${extras.join(' + ')})` : '';
            window.toastr.success(
                `${trimmed} will be brought into the scene next turn${tail}.`,
                'Character Injected',
                { timeOut: 4000 },
            );
        }
    } catch (e) {
        // toastr optional
    }
}

/**
 * Mark a character as present in the live scene by splicing them into
 * lastGeneratedData.characterThoughts (the source of truth for
 * getCharacterList() and the Present Characters panel). Persists through
 * saveChatData so the state survives a reload until the next AI turn
 * either confirms or drops the character.
 *
 * Returns true if a new entry was spliced in (so cancel/clear knows it
 * needs to undo this on revert), false if the character was already
 * present from a prior AI turn (no-op — leave them alone on cancel).
 */
function markCharacterPresentNow(name) {
    const trimmed = String(name || '').trim();
    if (!trimmed) return false;

    const raw = lastGeneratedData?.characterThoughts;
    let parsed;
    try {
        parsed = (typeof raw === 'string' && raw)
            ? JSON.parse(raw)
            : (raw && typeof raw === 'object' ? raw : { characters: [] });
    } catch (e) {
        parsed = { characters: [] };
    }
    if (!parsed || typeof parsed !== 'object') parsed = { characters: [] };

    // The AI sometimes emits characterThoughts as a bare array
    //   [ {name: "X"}, ... ]
    // and sometimes as { characters: [...] } — getCharacterList() accepts
    // both, so we have to too. Pick the right list to mutate, push there,
    // then serialize in the original shape. Earlier code did
    //   if (!Array.isArray(parsed.characters)) parsed.characters = [];
    // but when `parsed` itself was the array, that assigned a non-index
    // property which JSON.stringify SILENTLY DROPS, so the new entry
    // never reached the panel and the character ended up showing as
    // absent instead of present.
    const wasArray = Array.isArray(parsed);
    let charactersArr;
    if (wasArray) {
        charactersArr = parsed;
    } else {
        if (!Array.isArray(parsed.characters)) parsed.characters = [];
        charactersArr = parsed.characters;
    }

    const lower = trimmed.toLowerCase();
    const existing = charactersArr.find(c => typeof c?.name === 'string' && c.name.toLowerCase() === lower);
    if (existing) {
        // Already in the live tracker (AI confirmed them on a prior turn).
        // Don't splice again, and signal "no undo needed" so cancel won't
        // erroneously remove a character the AI legitimately introduced.
        return false;
    }

    const rel = extensionSettings?.characterRelationships?.[trimmed];
    charactersArr.push({
        name: trimmed,
        emoji: '🙂',
        thoughts: { content: '' },
        ...(rel ? { relationship: { status: rel } } : {}),
    });

    const serialized = JSON.stringify(wasArray ? charactersArr : parsed);
    try { updateLastGeneratedData({ characterThoughts: serialized }); }
    catch (e) { console.warn('[Dooms Tracker] Workshop: updateLastGeneratedData failed', e); }

    try { saveChatData(); } catch (e) { /* best-effort */ }
    try { clearPortraitCache(); updatePortraitBar(); } catch (e) {}
    try { renderThoughts(); } catch (e) {}
    return true;
}

/**
 * Reverse of markCharacterPresentNow — removes the splice from
 * lastGeneratedData.characterThoughts so the character no longer appears
 * in the Present row. Best-effort; silent on any structural surprise.
 */
function unmarkCharacterPresentNow(name) {
    const trimmed = String(name || '').trim();
    if (!trimmed) return;
    const raw = lastGeneratedData?.characterThoughts;
    if (!raw) return;
    let parsed;
    try {
        parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch (e) { return; }
    if (!parsed || typeof parsed !== 'object') return;

    // Same dual-shape handling as markCharacterPresentNow — accept either
    // a bare array or { characters: [...] }, mutate in place, serialize
    // back in the original shape so we don't silently drop entries.
    const wasArray = Array.isArray(parsed);
    let charactersArr;
    if (wasArray) {
        charactersArr = parsed;
    } else if (Array.isArray(parsed.characters)) {
        charactersArr = parsed.characters;
    } else {
        return;
    }

    const lower = trimmed.toLowerCase();
    const before = charactersArr.length;
    const filtered = charactersArr.filter(c => typeof c?.name !== 'string' || c.name.toLowerCase() !== lower);
    if (filtered.length === before) return;

    let serialized;
    if (wasArray) {
        serialized = JSON.stringify(filtered);
    } else {
        parsed.characters = filtered;
        serialized = JSON.stringify(parsed);
    }
    try { updateLastGeneratedData({ characterThoughts: serialized }); } catch (e) {}
    try { saveChatData(); } catch (e) {}
    try { clearPortraitCache(); updatePortraitBar(); } catch (e) {}
    try { renderThoughts(); } catch (e) {}
}

/**
 * One-shot: when the user next sends a message, stamp the character's
 * portrait onto that message's `extra.image` so SillyTavern's Generate
 * includes the image in the outgoing request (vision-capable models).
 * Falls back silently if anything in the chain is missing.
 */
function armPortraitAttach(name, dataUrl) {
    let consumed = false;
    const disarm = () => {
        if (consumed) return;
        consumed = true;
        try { eventSource.removeListener?.(event_types.MESSAGE_SENT, onSent); } catch (e) {}
        try { eventSource.off?.(event_types.MESSAGE_SENT, onSent); } catch (e) {}
    };
    const onSent = () => {
        if (consumed) return;
        consumed = true;
        try { eventSource.removeListener?.(event_types.MESSAGE_SENT, onSent); } catch (e) {}
        try { eventSource.off?.(event_types.MESSAGE_SENT, onSent); } catch (e) {}
        try {
            const ctx = (typeof getContext === 'function') ? getContext() : null;
            const chat = ctx?.chat;
            if (!Array.isArray(chat) || chat.length === 0) return;
            const last = chat[chat.length - 1];
            if (!last || last.is_user === false) return;
            if (!last.extra || typeof last.extra !== 'object') last.extra = {};
            last.extra.image = dataUrl;
            last.extra.inline_image = true;
            console.log(`[Dooms Tracker] Workshop: attached "${name}" portrait to outgoing message`);
        } catch (e) {
            console.warn('[Dooms Tracker] Workshop: portrait attach failed', e);
        }
    };
    try {
        eventSource.on(event_types.MESSAGE_SENT, onSent);
    } catch (e) {
        console.warn('[Dooms Tracker] Workshop: failed to register MESSAGE_SENT for portrait attach', e);
    }
    // Self-disarm after 2 minutes if the user never sends a message.
    setTimeout(() => disarm(), 2 * 60 * 1000);
    return disarm;
}

function exportDraft() {
    if (!draft) return;
    const payload = {
        $schema: 'dooms-character-v1',
        name: draft.name,
        color: draft.color || '',
        avatar: draft.avatar || '',
        avatarFullRes: draft.avatarFullRes || '',
        relationship: draft.relationship || '',
        injection: {
            description: draft.injection?.description || '',
            lorebook: draft.injection?.lorebook || '',
            promptTemplate: draft.injection?.promptTemplate || '',
        },
    };
    const json = JSON.stringify(payload, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const safeName = String(draft.name || 'character').replace(/[^\w.-]+/g, '_');
    const a = document.createElement('a');
    a.href = url;
    a.download = `character-${safeName}.json`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }, 100);
    if (window.toastr) {
        window.toastr.success(`Exported "${draft.name}" to character-${safeName}.json`, 'Character Workshop', { timeOut: 4000 });
    }
}

function buildInjectPrompt(name, extras) {
    const vars = {
        name: String(name || ''),
        description: String(extras?.description || ''),
        lorebook: String(extras?.lorebook || ''),
        relationship: String(extras?.relationship || ''),
    };
    const raw = (extras?.promptTemplate || '').trim();
    const template = raw || DEFAULT_INJECT_PROMPT;
    // Emit conditional blocks {?var}...{/var} only when the variable is
    // non-empty, then substitute plain {var} placeholders.
    let out = template.replace(/\{\?(\w+)\}([\s\S]*?)\{\/\1\}/g, (_, key, body) => {
        return vars[key] ? body : '';
    });
    out = out.replace(/\{(\w+)\}/g, (match, key) => {
        return Object.prototype.hasOwnProperty.call(vars, key) ? vars[key] : match;
    });
    // Collapse runs of 3+ newlines that empty conditional blocks can leave
    // behind so the final prompt stays tidy regardless of which vars are set.
    return out.replace(/\n{3,}/g, '\n\n');
}

function clearInjectPromptIfPending() {
    if (pendingInjectClear) {
        try {
            setExtensionPrompt(INJECT_SLOT, '', extension_prompt_types.IN_PROMPT, 0, false);
            console.log('[Dooms Tracker] Workshop: cleared scene-inject prompt');
        } catch (e) {
            console.warn('[Dooms Tracker] Workshop: failed to clear inject prompt', e);
        } finally {
            pendingInjectClear = false;
            injectStartsToSkip = 0;
            for (const [, entry] of pendingInjects) {
                broadcastInjectState(entry.name, false);
            }
            pendingInjects.clear();
        }
    }
    if (pendingEjectClear) {
        try {
            setExtensionPrompt(EJECT_SLOT, '', extension_prompt_types.IN_PROMPT, 0, false);
            console.log('[Dooms Tracker] Workshop: cleared scene-eject prompt');
        } catch (e) {
            console.warn('[Dooms Tracker] Workshop: failed to clear eject prompt', e);
        } finally {
            pendingEjectClear = false;
            ejectStartsToSkip = 0;
        }
    }
}

function onGenerationStartedForInject() {
    // The generation the inject/eject is intended for should pass. After
    // that, any START means a NEW generation is happening (swipe /
    // regenerate / new turn) and we must not re-apply the old direction.
    let skippedThisCall = false;
    if (injectStartsToSkip > 0) {
        injectStartsToSkip--;
        skippedThisCall = true;
    }
    if (ejectStartsToSkip > 0) {
        ejectStartsToSkip--;
        skippedThisCall = true;
    }
    if (skippedThisCall) return;
    if (pendingInjectClear || pendingEjectClear) {
        console.log('[Dooms Tracker] Workshop: new generation starting — clearing stale inject/eject');
        clearInjectPromptIfPending();
    }
}

// ─────────────────────────────────────────────
//  Expressions tab — sprite manager
//  Mirrors the Character Sheet's Expressions tab. Same labels, same
//  /api/sprites endpoints (get / upload / upload-zip / delete /
//  open-folder), same crop-then-PNG flow. Scoped to this module so
//  the Workshop doesn't need to import characterSheet.js.
// ─────────────────────────────────────────────

const EXPRESSION_LABELS = [
    'admiration', 'amusement', 'anger', 'annoyance', 'approval', 'caring',
    'confusion', 'curiosity', 'desire', 'disappointment', 'disapproval',
    'disgust', 'embarrassment', 'excitement', 'fear', 'gratitude', 'grief',
    'joy', 'love', 'nervousness', 'neutral', 'optimism', 'pride',
    'realization', 'relief', 'remorse', 'sadness', 'surprise',
];

async function _cwInvalidateSpriteCache(name) {
    try {
        const mod = await import('../integration/expressionSync.js');
        if (typeof mod.invalidateSpriteCacheFor === 'function') {
            mod.invalidateSpriteCacheFor(name);
        }
    } catch (e) { /* expressionSync is optional */ }
}

async function renderExpressionsTab($panel, characterName) {
    $panel.html('<div style="padding:20px; opacity:0.5; text-align:center;">Loading sprites…</div>');
    let existingSprites = [];
    try {
        const response = await fetch(`/api/sprites/get?name=${encodeURIComponent(characterName)}`, {
            headers: getRequestHeaders(),
        });
        if (response.ok) existingSprites = await response.json();
    } catch (err) {
        console.warn('[Dooms Tracker] Workshop expressions: fetch failed', err);
    }
    const spriteMap = new Map();
    for (const sprite of existingSprites) {
        if (sprite.label && !spriteMap.has(sprite.label)) {
            spriteMap.set(sprite.label, sprite.path);
        }
    }
    const uploadedCount = spriteMap.size;
    let html = `
        <div class="rpg-cs-expr-header">
            <span style="font-size:0.85em; opacity:0.7;">${uploadedCount} / ${EXPRESSION_LABELS.length} expressions uploaded</span>
            <div class="rpg-cs-expr-actions">
                <button class="rpg-cs-expr-upload-zip menu_button"><i class="fa-solid fa-file-zipper"></i> Upload ZIP</button>
                <button class="rpg-cs-expr-open-folder menu_button"><i class="fa-solid fa-folder-open"></i> Open Folder</button>
            </div>
        </div>
        <div class="rpg-cs-expression-grid">
    `;
    for (const label of EXPRESSION_LABELS) {
        const spritePath = spriteMap.get(label);
        const hasSprite = !!spritePath;
        html += `
            <div class="rpg-cs-expr-slot ${hasSprite ? 'rpg-cs-expr-has-sprite' : ''}">
                <div class="rpg-cs-expr-thumb">
                    ${hasSprite
                        ? `<img src="${spritePath}" alt="${label}" loading="lazy" />`
                        : '<div class="rpg-cs-expr-placeholder"><i class="fa-solid fa-image"></i></div>'
                    }
                    <div class="rpg-cs-expr-overlay">
                        <button class="rpg-cs-expr-upload" data-label="${label}" title="Upload ${label}">
                            <i class="fa-solid fa-upload"></i>
                        </button>
                        ${hasSprite ? `
                            <button class="rpg-cs-expr-delete" data-label="${label}" title="Delete ${label}">
                                <i class="fa-solid fa-trash"></i>
                            </button>
                        ` : ''}
                    </div>
                </div>
                <div class="rpg-cs-expr-label">${label}</div>
            </div>
        `;
    }
    html += '</div>';
    $panel.html(html);
}

let _cwExprHandlersBound = false;
function bindExpressionHandlers() {
    if (_cwExprHandlersBound) return;
    _cwExprHandlersBound = true;

    // Match the character-sheet selectors so we share the existing CSS
    // (.rpg-cs-expr-* rules already styled). Scope to the Workshop's
    // pane so these don't double-fire when both modals are in the DOM.
    const inWorkshop = (target) =>
        $(target).closest('#character-workshop-popup .rpg-cs-tab-content[data-tab="expressions"]').length > 0;

    // Upload single sprite
    $(document).on('click.cwExpr', '.rpg-cs-expr-upload:not(.rpg-cs-expr-upload-zip)', function () {
        if (!inWorkshop(this)) return;
        const label = $(this).data('label');
        const $tab = $(this).closest('.rpg-cs-tab-content');
        const charName = $tab.data('character');
        if (!label || !charName) return;
        const $input = $('<input type="file" accept="image/*" style="display:none">');
        $input.on('change', async function () {
            const file = this.files && this.files[0];
            if (!file) { $input.remove(); return; }
            try {
                const dataUrl = await getBase64Async(file);
                const cropped = await callGenericPopup(
                    `<h3>Crop "${label}" expression for ${charName}</h3>`,
                    POPUP_TYPE.CROP,
                    '',
                    { cropAspect: 3 / 4, cropImage: dataUrl },
                );
                if (!cropped) return;
                const blob = await fetch(cropped).then(r => r.blob());
                const croppedFile = new File([blob], `${label}.png`, { type: 'image/png' });
                const fd = new FormData();
                fd.append('name', charName);
                fd.append('label', label);
                fd.append('avatar', croppedFile);
                fd.append('spriteName', label);
                const resp = await fetch('/api/sprites/upload', {
                    method: 'POST',
                    headers: getRequestHeaders({ omitContentType: true }),
                    body: fd,
                });
                if (resp.ok) {
                    _cwInvalidateSpriteCache(charName);
                    renderExpressionsTab($tab, charName);
                    if (window.toastr) window.toastr.success(`Uploaded ${label} expression for ${charName}`, '', { timeOut: 2000 });
                } else {
                    if (window.toastr) window.toastr.error('Upload failed.', 'Error');
                }
            } catch (err) {
                console.error('[Dooms Tracker] Workshop expressions: upload failed', err);
                if (window.toastr) window.toastr.error('Upload failed.', 'Error');
            }
            $input.remove();
        });
        $('body').append($input);
        $input.trigger('click');
    });

    // Delete single sprite
    $(document).on('click.cwExpr', '.rpg-cs-expr-delete', async function () {
        if (!inWorkshop(this)) return;
        const label = $(this).data('label');
        const $tab = $(this).closest('.rpg-cs-tab-content');
        const charName = $tab.data('character');
        if (!label || !charName) return;
        try {
            const resp = await fetch('/api/sprites/delete', {
                method: 'POST',
                headers: getRequestHeaders(),
                body: JSON.stringify({ name: charName, label }),
            });
            if (resp.ok) {
                _cwInvalidateSpriteCache(charName);
                renderExpressionsTab($tab, charName);
                if (window.toastr) window.toastr.info(`Removed ${label} expression for ${charName}`, '', { timeOut: 2000 });
            }
        } catch (err) {
            console.error('[Dooms Tracker] Workshop expressions: delete failed', err);
        }
    });

    // ZIP upload
    $(document).on('click.cwExpr', '.rpg-cs-expr-upload-zip', function () {
        if (!inWorkshop(this)) return;
        const $tab = $(this).closest('.rpg-cs-tab-content');
        const charName = $tab.data('character');
        if (!charName) return;
        const $input = $('<input type="file" accept=".zip" style="display:none">');
        $input.on('change', async function () {
            const file = this.files && this.files[0];
            if (!file) { $input.remove(); return; }
            const fd = new FormData();
            fd.append('name', charName);
            fd.append('avatar', file);
            try {
                const resp = await fetch('/api/sprites/upload-zip', {
                    method: 'POST',
                    headers: getRequestHeaders({ omitContentType: true }),
                    body: fd,
                });
                if (resp.ok) {
                    _cwInvalidateSpriteCache(charName);
                    renderExpressionsTab($tab, charName);
                    if (window.toastr) window.toastr.success(`Sprite pack uploaded for ${charName}`, '', { timeOut: 2000 });
                } else {
                    if (window.toastr) window.toastr.error('ZIP upload failed.', 'Error');
                }
            } catch (err) {
                console.error('[Dooms Tracker] Workshop expressions: zip upload failed', err);
                if (window.toastr) window.toastr.error('ZIP upload failed.', 'Error');
            }
            $input.remove();
        });
        $('body').append($input);
        $input.trigger('click');
    });

    // Open folder
    $(document).on('click.cwExpr', '.rpg-cs-expr-open-folder', async function () {
        if (!inWorkshop(this)) return;
        const $tab = $(this).closest('.rpg-cs-tab-content');
        const charName = $tab.data('character');
        if (!charName) return;
        try {
            const resp = await fetch('/api/sprites/open-folder', {
                method: 'POST',
                headers: getRequestHeaders(),
                body: JSON.stringify({ name: charName }),
            });
            if (!resp.ok && resp.status === 404) {
                if (window.toastr) window.toastr.info(
                    `Expression sprites go in: data/default-user/characters/${charName}/`,
                    'Open Folder Not Available',
                    { timeOut: 6000 },
                );
            }
        } catch (err) {
            console.error('[Dooms Tracker] Workshop expressions: open folder failed', err);
            if (window.toastr) window.toastr.info(
                `Expression sprites go in: data/default-user/characters/${charName}/`,
                'Open Folder Not Available',
                { timeOut: 6000 },
            );
        }
    });
}
