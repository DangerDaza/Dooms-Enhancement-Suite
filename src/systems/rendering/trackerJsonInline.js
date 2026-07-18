/**
 * Inline Tracker Data dropdowns — the JSON-tracker sibling of the inline
 * thoughts feature. When enabled (showTrackerJsonInChat, default off), every
 * AI message that carries per-swipe tracker data gets a small collapsible
 * "Tracker Data" dropdown showing that message's parsed tracker JSON
 * (characterThoughts / infoBox / quests), with an Edit mode that writes the
 * corrected JSON back into the message's swipe store.
 *
 * Placement: the dropdown is appended to `.mes_block` AFTER `.mes_text`, not
 * inside it — the decoration pipeline (recolor, chat bubbles, edits) rewrites
 * .mes_text's innerHTML and would destroy anything inside it (inline thoughts
 * pay a re-insertion scheduler for living there; a sibling survives for free,
 * same trick as the Doom Counter's trap badge).
 */
import { extensionSettings, lastGeneratedData } from '../../core/state.js';
import { saveChatDebounced } from '../../../../../../../script.js';
import { escapeHtml } from '../../utils/html.js';

const DROPDOWN_CLASS = 'dooms-tracker-json';

// ─────────────────────────────────────────────
//  Data access
// ─────────────────────────────────────────────

function getSwipeData(message) {
    if (!message || message.is_user || message.is_system) return null;
    const swipeId = message.swipe_id || 0;
    let swipeData = message.extra?.dooms_tracker_swipes?.[swipeId];
    if (!swipeData && message.swipe_info?.[swipeId]?.extra?.dooms_tracker_swipes) {
        swipeData = message.swipe_info[swipeId].extra.dooms_tracker_swipes[swipeId];
    }
    return swipeData || null;
}

/** Parses a stored field (JSON string or object) for display; null if empty. */
function parseField(value) {
    if (value === undefined || value === null || value === '') return null;
    if (typeof value !== 'string') return value;
    try { return JSON.parse(value); } catch (e) { return value; }
}

/** Display object: parsed fields, omitting empty ones. */
function buildDisplayObject(swipeData) {
    const out = {};
    for (const key of ['characterThoughts', 'infoBox', 'quests']) {
        const parsed = parseField(swipeData[key]);
        if (parsed !== null) out[key] = parsed;
    }
    return out;
}

// ─────────────────────────────────────────────
//  Rendering
// ─────────────────────────────────────────────

function renderDropdownHtml(mesId, displayObj, wasOpen) {
    const json = JSON.stringify(displayObj, null, 2);
    return `
        <details class="${DROPDOWN_CLASS}" data-mesid="${mesId}"${wasOpen ? ' open' : ''}>
            <summary class="dooms-tracker-json-summary">
                <span class="dooms-tracker-json-icon">🗂️</span>
                <span class="dooms-tracker-json-label">Tracker Data</span>
                <button class="dooms-tracker-json-edit" title="Edit this message's tracker JSON"><i class="fa-solid fa-pencil"></i></button>
            </summary>
            <div class="dooms-tracker-json-body">
                <pre class="dooms-tracker-json-view">${escapeHtml(json)}</pre>
            </div>
        </details>
    `;
}

/**
 * Adds, refreshes, or removes the dropdown on one message element so every
 * event path (render, edit, swipe, sweep) converges on the correct state.
 */
function syncDropdownOnElement(messageElement, message) {
    const $block = $(messageElement).find('.mes_block');
    if (!$block.length) return;
    const $existing = $block.find(`.${DROPDOWN_CLASS}`);
    const enabled = extensionSettings.enabled && extensionSettings.showTrackerJsonInChat;
    const swipeData = enabled ? getSwipeData(message) : null;

    if (!swipeData) {
        $existing.remove();
        return;
    }
    const displayObj = buildDisplayObject(swipeData);
    if (!Object.keys(displayObj).length) {
        $existing.remove();
        return;
    }
    const mesId = $(messageElement).attr('mesid');
    // Don't clobber an open editor with a re-render.
    if ($existing.find('.dooms-tracker-json-editor').length) return;
    const wasOpen = $existing.length ? $existing.prop('open') : false;
    const html = renderDropdownHtml(mesId, displayObj, wasOpen);
    if ($existing.length) $existing.replaceWith(html);
    else $block.append(html);
}

/** Per-message sync by id — wired to render/edit/swipe events. */
export function syncTrackerJsonForMessage(messageId) {
    const context = SillyTavern.getContext();
    const chat = context.chat || [];
    const mesId = parseInt(messageId);
    if (isNaN(mesId)) return;
    const messageElement = document.querySelector(`#chat .mes[mesid="${mesId}"]`);
    if (messageElement) syncDropdownOnElement(messageElement, chat[mesId]);
}

/** Full sweep — wired to CHAT_CHANGED / MORE_MESSAGES_LOADED / the toggle. */
export function updateTrackerJsonDropdowns() {
    const context = SillyTavern.getContext();
    const chat = context.chat || [];
    $('#chat .mes').each(function () {
        const mesId = parseInt($(this).attr('mesid'));
        if (isNaN(mesId)) return;
        syncDropdownOnElement(this, chat[mesId]);
    });
}

// ─────────────────────────────────────────────
//  Editing
// ─────────────────────────────────────────────

function openEditor($dropdown) {
    const mesId = parseInt($dropdown.attr('data-mesid'));
    const context = SillyTavern.getContext();
    const message = (context.chat || [])[mesId];
    const swipeData = getSwipeData(message);
    if (!swipeData) return;
    const json = JSON.stringify(buildDisplayObject(swipeData), null, 2);
    $dropdown.prop('open', true);
    $dropdown.find('.dooms-tracker-json-body').html(`
        <div class="dooms-tracker-json-editor">
            <textarea class="dooms-tracker-json-input" rows="14" spellcheck="false">${escapeHtml(json)}</textarea>
            <div class="dooms-tracker-json-editor-actions">
                <button type="button" class="dooms-tracker-json-btn dooms-tracker-json-cancel">Cancel</button>
                <button type="button" class="dooms-tracker-json-btn dooms-tracker-json-save">Save</button>
            </div>
        </div>
    `);
}

function saveEditor($dropdown) {
    const mesId = parseInt($dropdown.attr('data-mesid'));
    const context = SillyTavern.getContext();
    const chat = context.chat || [];
    const message = chat[mesId];
    const swipeData = getSwipeData(message);
    if (!swipeData) return;

    let parsed;
    try {
        parsed = JSON.parse(String($dropdown.find('.dooms-tracker-json-input').val() || ''));
    } catch (e) {
        if (window.toastr) toastr.error(`Invalid JSON: ${e.message}`, 'Tracker Data', { timeOut: 5000 });
        return;
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        if (window.toastr) toastr.error('Tracker data must be a JSON object with characterThoughts / infoBox / quests keys.', 'Tracker Data', { timeOut: 5000 });
        return;
    }

    // Write each field back preserving its original storage type — the
    // generation pipeline stores these as JSON strings; an old chat might
    // hold raw objects. Absent keys in the edit clear the field.
    let isLastAssistant = true;
    for (let i = chat.length - 1; i > mesId; i--) {
        if (chat[i] && !chat[i].is_user && !chat[i].is_system) { isLastAssistant = false; break; }
    }
    for (const key of ['characterThoughts', 'infoBox', 'quests']) {
        const edited = parsed[key];
        const wasString = typeof swipeData[key] === 'string' || swipeData[key] === undefined || swipeData[key] === null;
        if (edited === undefined) {
            swipeData[key] = '';
        } else if (typeof edited === 'string') {
            swipeData[key] = edited;
        } else {
            swipeData[key] = wasString ? JSON.stringify(edited) : edited;
        }
        // Keep the live panels honest when the newest message was edited.
        if (isLastAssistant) lastGeneratedData[key] = swipeData[key];
    }
    saveChatDebounced();

    if (isLastAssistant) {
        // Refresh every surface that renders from lastGeneratedData. Lazy
        // imports keep this eager module from dragging in the render stack.
        Promise.resolve().then(async () => {
            try {
                const { renderThoughts, updateChatThoughts } = await import('./thoughts.js');
                const { renderInfoBox } = await import('./infoBox.js');
                const { renderQuests } = await import('./quests.js');
                const { updateChatSceneHeaders } = await import('./sceneHeaders.js');
                const { updatePortraitBar } = await import('../ui/portraitBar.js');
                renderThoughts(); renderInfoBox(); renderQuests();
                updateChatSceneHeaders(); updateChatThoughts(); updatePortraitBar();
            } catch (e) {
                console.warn('[Dooms Tracker] Tracker Data edit: panel refresh failed', e);
            }
        });
    }
    if (window.toastr) toastr.success('Tracker data saved.', '', { timeOut: 2000 });
    // Drop the editor BEFORE re-syncing — the sync path deliberately refuses
    // to clobber an open editor, so it must be gone for the refresh to land.
    $dropdown.find('.dooms-tracker-json-editor').remove();
    syncTrackerJsonForMessage(mesId);
}

// ─────────────────────────────────────────────
//  Init (delegated handlers — registered once)
// ─────────────────────────────────────────────

let _initialized = false;

export function initTrackerJsonInline() {
    if (_initialized) return;
    _initialized = true;

    // The edit pencil lives inside <summary>; stop it from toggling the details.
    $(document).on('click', '.dooms-tracker-json-edit', function (e) {
        e.preventDefault();
        e.stopPropagation();
        openEditor($(this).closest(`.${DROPDOWN_CLASS}`));
    });
    $(document).on('click', '.dooms-tracker-json-save', function () {
        saveEditor($(this).closest(`.${DROPDOWN_CLASS}`));
    });
    $(document).on('click', '.dooms-tracker-json-cancel', function () {
        const $dropdown = $(this).closest(`.${DROPDOWN_CLASS}`);
        // Editor must be removed first or the sync's open-editor guard
        // would turn Cancel into a no-op.
        $dropdown.find('.dooms-tracker-json-editor').remove();
        syncTrackerJsonForMessage(parseInt($dropdown.attr('data-mesid')));
    });
}
