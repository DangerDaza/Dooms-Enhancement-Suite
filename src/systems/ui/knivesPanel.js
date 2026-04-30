/**
 * Knives Panel UI
 *
 * Render helpers for the knife list editor — used in both the settings panel
 * (User Knives + Character Knives sections) and on the per-character sheet
 * Knives tab. The same `renderKnifeListEditor(ownerKey, $container)` is
 * called in all three places, so editing a knife in one view is reflected
 * in the others (they're all reading and writing the same templates).
 */
import { callGenericPopup, Popup, POPUP_TYPE, POPUP_RESULT } from '../../../../../../popup.js';
import { extensionSettings } from '../../core/state.js';
import {
    USER_OWNER_KEY,
    USER_OWNER_PREFIX,
    getActiveUserOwnerKey,
    isUserOwnerKey,
    listOwners,
    getTemplates,
    addTemplate,
    updateTemplate,
    deleteTemplate,
    deleteOwner,
    renameOwner,
    getRuntime,
    defuseKnife,
    forceSharpenKnife,
    forceDrawKnife,
    resetKnife,
    suggestKnives,
} from '../features/knives.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function escapeHtml(s) {
    return String(s ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function severityLabel(severity) {
    if (severity === 3) return 'Catastrophic';
    if (severity === 2) return 'Serious';
    return 'Minor';
}

function statusLabel(status) {
    switch (status) {
        case 'sharpening': return 'Sharpening';
        case 'drawn':      return 'Drawn';
        case 'spent':      return 'Spent';
        case 'defused':    return 'Defused';
        default:           return 'Dormant';
    }
}

function ownerDisplayName(ownerKey) {
    if (ownerKey === USER_OWNER_KEY) return 'You (Player)';
    if (typeof ownerKey === 'string' && ownerKey.startsWith(USER_OWNER_PREFIX)) {
        try {
            const avatar = ownerKey.slice(USER_OWNER_PREFIX.length);
            const name = window?.power_user?.personas?.[avatar];
            return name ? `You (${name})` : `You (${avatar})`;
        } catch { return 'You'; }
    }
    return ownerKey;
}

function listPersonas() {
    try {
        const personas = window?.power_user?.personas || {};
        return Object.entries(personas).map(([avatar, name]) => ({
            avatar,
            name: name || avatar,
            ownerKey: USER_OWNER_PREFIX + avatar,
        }));
    } catch {
        return [];
    }
}

function isStatusVisible() {
    return !!extensionSettings.knives?.revealStatus;
}

// ─── Edit-form modal ──────────────────────────────────────────────────────────

/**
 * Opens a popup editor for a knife. `existing` is an object with the same
 * shape as a template (or undefined for a new knife). Resolves to the
 * patched fields, or null if the user cancelled.
 */
async function openKnifeEditor(existing) {
    const isNew = !existing;
    const title = escapeHtml(existing?.title || '');
    const description = escapeHtml(existing?.description || '');
    const severity = [1, 2, 3].includes(existing?.severity) ? existing.severity : 1;
    const hints = (existing?.foreshadowingHints || []).join('\n');
    const html = `
        <div class="rpg-knife-editor">
            <h3 style="margin-top:0;">${isNew ? 'New Knife' : 'Edit Knife'}</h3>
            <label class="rpg-knife-field">
                <span>Title</span>
                <input type="text" class="text_pole rpg-knife-title" maxlength="80" value="${title}" placeholder="e.g. Gambling Debt to the Black Gull">
            </label>
            <label class="rpg-knife-field">
                <span>Description</span>
                <textarea class="text_pole rpg-knife-description" rows="3" placeholder="One or two sentences with concrete names, places, or numbers.">${description}</textarea>
            </label>
            <label class="rpg-knife-field">
                <span>Severity</span>
                <select class="text_pole rpg-knife-severity">
                    <option value="1"${severity === 1 ? ' selected' : ''}>Minor — fires anytime</option>
                    <option value="2"${severity === 2 ? ' selected' : ''}>Serious — needs raised tension</option>
                    <option value="3"${severity === 3 ? ' selected' : ''}>Catastrophic — high tension or doom</option>
                </select>
            </label>
            <label class="rpg-knife-field">
                <span>Foreshadowing hints (one per line)</span>
                <textarea class="text_pole rpg-knife-hints" rows="3" placeholder="A figure watches from the bar.&#10;A coin pouch feels lighter than expected.">${escapeHtml(hints)}</textarea>
            </label>
        </div>
    `;
    const popup = new Popup(html, POPUP_TYPE.TEXT, '', {
        okButton: isNew ? 'Add Knife' : 'Save',
        cancelButton: 'Cancel',
        wide: true,
        allowVerticalScrolling: true,
    });
    const result = await popup.show();
    if (result !== POPUP_RESULT.AFFIRMATIVE) return null;
    const dlg = popup.dlg;
    const newTitle = dlg.querySelector('.rpg-knife-title')?.value?.trim() || '';
    const newDescription = dlg.querySelector('.rpg-knife-description')?.value?.trim() || '';
    const newSeverity = Number(dlg.querySelector('.rpg-knife-severity')?.value) || 1;
    const hintsRaw = dlg.querySelector('.rpg-knife-hints')?.value || '';
    const newHints = hintsRaw.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    if (!newTitle) return null;
    return {
        title: newTitle,
        description: newDescription,
        severity: newSeverity,
        foreshadowingHints: newHints,
    };
}

// ─── Knife list editor ────────────────────────────────────────────────────────

function renderKnifeRow(ownerKey, tpl) {
    const runtime = getRuntime(tpl.id);
    const status = runtime?.status || 'dormant';
    const showStatus = isStatusVisible();
    const statusBadge = showStatus
        ? `<span class="rpg-knife-badge status-${status}" title="Status (visible because Reveal AI Status is on)">${escapeHtml(statusLabel(status))}</span>`
        : '';
    const severityBadge = `<span class="rpg-knife-badge severity-${tpl.severity}">${escapeHtml(severityLabel(tpl.severity))}</span>`;
    const hintsLine = tpl.foreshadowingHints?.length
        ? `<div class="rpg-knife-hints-preview">Hints: ${escapeHtml(tpl.foreshadowingHints.join('; '))}</div>`
        : '';
    return `
        <div class="rpg-knife-row" data-knife-id="${escapeHtml(tpl.id)}">
            <div class="rpg-knife-row-main">
                <div class="rpg-knife-row-title">
                    <strong>${escapeHtml(tpl.title)}</strong>
                    ${severityBadge}
                    ${statusBadge}
                </div>
                ${tpl.description ? `<div class="rpg-knife-row-desc">${escapeHtml(tpl.description)}</div>` : ''}
                ${hintsLine}
            </div>
            <div class="rpg-knife-row-actions">
                <button type="button" class="menu_button rpg-knife-edit" title="Edit">✎</button>
                <button type="button" class="menu_button rpg-knife-advanced" title="Advanced (manual overrides)">⚙</button>
                <button type="button" class="menu_button rpg-knife-delete" title="Delete">🗑</button>
            </div>
        </div>
    `;
}

async function openAdvancedActionsMenu(ownerKey, knifeId) {
    const runtime = getRuntime(knifeId);
    const currentStatus = runtime?.status || 'dormant';
    const html = `
        <div class="rpg-knife-advanced-modal">
            <h3 style="margin-top:0;">Manual override</h3>
            <p style="opacity:0.8;font-size:0.9em;">Status in this chat: <strong>${escapeHtml(statusLabel(currentStatus))}</strong>. These actions skip the normal pacing rules — use sparingly.</p>
            <label class="rpg-knife-field" style="display:flex;flex-direction:column;gap:4px;">
                <span style="font-weight:600;font-size:0.88em;">Action</span>
                <select class="text_pole rpg-knife-act-select">
                    <option value="">— pick an action —</option>
                    <option value="sharpen">Sharpen now</option>
                    <option value="draw">Force draw</option>
                    <option value="defuse">Defuse (retire without firing)</option>
                    <option value="reset">Reset to dormant</option>
                </select>
            </label>
        </div>
    `;
    const popup = new Popup(html, POPUP_TYPE.TEXT, '', {
        okButton: 'Apply',
        cancelButton: 'Cancel',
        wide: false,
    });
    const result = await popup.show();
    if (result !== POPUP_RESULT.AFFIRMATIVE) return false;
    const chosen = popup.dlg.querySelector('.rpg-knife-act-select')?.value || '';
    switch (chosen) {
        case 'sharpen': forceSharpenKnife(knifeId); return true;
        case 'draw':    forceDrawKnife(knifeId);    return true;
        case 'defuse':  defuseKnife(knifeId);       return true;
        case 'reset':   resetKnife(knifeId);        return true;
    }
    return false;
}

/**
 * Renders (or re-renders) the knife list editor for one owner into the given
 * jQuery container. Called from the settings panel and from the character sheet
 * Knives tab. Re-rendering is the simplest way to reflect template changes —
 * the action handlers call back into this same renderer when they're done.
 *
 * @param {string} ownerKey   - `__user__` for player, otherwise the character name
 * @param {jQuery} $container - target container (will be emptied)
 */
export function renderKnifeListEditor(ownerKey, $container) {
    if (!$container || !$container.length) return;
    const templates = getTemplates(ownerKey);
    const ownerLabel = ownerDisplayName(ownerKey);
    const isUser = ownerKey === USER_OWNER_KEY;
    const heading = isUser ? '🗡️ Your Knives' : `🔪 ${escapeHtml(ownerLabel)}'s Knives`;
    const empty = templates.length ? '' : `<div class="rpg-knife-empty">No knives yet for ${escapeHtml(ownerLabel)}. Add specific debts, secrets, vows, or enemies — the AI will deploy them with proper pacing.</div>`;
    const rowsHtml = templates.map(t => renderKnifeRow(ownerKey, t)).join('');
    const ownerActions = isUser ? '' : `<button type="button" class="menu_button rpg-knife-rename-owner" title="Rename this character's knife bucket">Rename</button><button type="button" class="menu_button rpg-knife-delete-owner" title="Delete all knives for this character">Delete bucket</button>`;
    const html = `
        <div class="rpg-knife-editor-block" data-owner="${escapeHtml(ownerKey)}">
            <div class="rpg-knife-editor-header">
                <h4 class="rpg-knife-editor-title">${heading}</h4>
                <div class="rpg-knife-editor-toolbar">
                    <button type="button" class="menu_button rpg-knife-add">+ Add Knife</button>
                    <button type="button" class="menu_button rpg-knife-suggest" title="Generate suggestions with the AI based on the description below">✨ Suggest with AI</button>
                    ${ownerActions}
                </div>
            </div>
            ${empty}
            <div class="rpg-knife-list">${rowsHtml}</div>
        </div>
    `;
    $container.empty().append(html);

    const $block = $container.find(`.rpg-knife-editor-block[data-owner="${$.escapeSelector(ownerKey)}"]`);

    $block.find('.rpg-knife-add').on('click', async () => {
        const fields = await openKnifeEditor(null);
        if (!fields) return;
        addTemplate(ownerKey, fields);
        renderKnifeListEditor(ownerKey, $container);
    });

    $block.find('.rpg-knife-suggest').on('click', () => {
        runSuggestFlow(ownerKey, $container);
    });

    $block.find('.rpg-knife-edit').on('click', async function () {
        const id = $(this).closest('.rpg-knife-row').data('knife-id');
        const tpl = getTemplates(ownerKey).find(t => t.id === id);
        if (!tpl) return;
        const fields = await openKnifeEditor(tpl);
        if (!fields) return;
        updateTemplate(ownerKey, id, fields);
        renderKnifeListEditor(ownerKey, $container);
    });

    $block.find('.rpg-knife-advanced').on('click', async function () {
        const id = $(this).closest('.rpg-knife-row').data('knife-id');
        const changed = await openAdvancedActionsMenu(ownerKey, id);
        if (changed) renderKnifeListEditor(ownerKey, $container);
    });

    $block.find('.rpg-knife-delete').on('click', async function () {
        const id = $(this).closest('.rpg-knife-row').data('knife-id');
        const tpl = getTemplates(ownerKey).find(t => t.id === id);
        if (!tpl) return;
        const ok = await callGenericPopup(`Delete "${escapeHtml(tpl.title)}"? This cannot be undone.`, POPUP_TYPE.CONFIRM, '', { okButton: 'Delete', cancelButton: 'Cancel' });
        if (!ok) return;
        deleteTemplate(ownerKey, id);
        renderKnifeListEditor(ownerKey, $container);
    });

    $block.find('.rpg-knife-rename-owner').on('click', async () => {
        const newName = await callGenericPopup(`Rename "${escapeHtml(ownerKey)}" to...`, POPUP_TYPE.INPUT, ownerKey, { okButton: 'Rename', cancelButton: 'Cancel' });
        if (typeof newName !== 'string') return;
        const trimmed = newName.trim();
        if (!trimmed || trimmed === ownerKey) return;
        renameOwner(ownerKey, trimmed);
        // After rename the bucket key changes; the parent section re-renders to pick it up.
        $container.trigger('rpg-knife-owner-renamed', [ownerKey, trimmed]);
    });

    $block.find('.rpg-knife-delete-owner').on('click', async () => {
        const ok = await callGenericPopup(`Delete all knives for "${escapeHtml(ownerLabel)}"? This cannot be undone.`, POPUP_TYPE.CONFIRM, '', { okButton: 'Delete', cancelButton: 'Cancel' });
        if (!ok) return;
        deleteOwner(ownerKey);
        $container.trigger('rpg-knife-owner-deleted', [ownerKey]);
    });
}

// ─── AI suggestion flow ───────────────────────────────────────────────────────

/**
 * Reads the appropriate description for an owner:
 *   - For the player (USER_OWNER_KEY): the active persona description.
 *   - For a character: the Bunny Mo character sheet, or the character roster
 *     entry's description as a fallback.
 */
function readOwnerDescription(ownerKey) {
    if (ownerKey === USER_OWNER_KEY) {
        // Active persona description, if any.
        try {
            const personas = window.power_user?.personas;
            const userAvatar = window.user_avatar;
            const personaName = personas?.[userAvatar];
            const desc = window.power_user?.persona_descriptions?.[userAvatar]?.description;
            const parts = [];
            if (personaName) parts.push(`Persona name: ${personaName}`);
            if (desc) parts.push(desc);
            return parts.join('\n\n').trim();
        } catch {
            return '';
        }
    }
    // Character: pull from the Bunny Mo character sheet stored per-chat.
    const sheets = window.chat_metadata?.dooms_tracker?.characterSheets;
    const sheet = sheets?.[ownerKey];
    if (sheet) {
        try {
            return typeof sheet === 'string' ? sheet : JSON.stringify(sheet, null, 2);
        } catch {
            return '';
        }
    }
    return '';
}

async function openSuggestionsModal(ownerKey, suggestions, rawText) {
    const ownerLabel = ownerDisplayName(ownerKey);
    const rows = suggestions.map((s, i) => `
        <label class="rpg-knife-suggestion-row">
            <input type="checkbox" class="rpg-knife-suggestion-pick" data-i="${i}" checked>
            <div class="rpg-knife-suggestion-body">
                <div><strong>${escapeHtml(s.title)}</strong>
                    <span class="rpg-knife-badge severity-${s.severity}">${escapeHtml(severityLabel(s.severity))}</span>
                </div>
                <div class="rpg-knife-suggestion-desc">${escapeHtml(s.description)}</div>
                ${s.foreshadowingHints?.length ? `<div class="rpg-knife-hints-preview">Hints: ${escapeHtml(s.foreshadowingHints.join('; '))}</div>` : ''}
            </div>
        </label>
    `).join('');
    const html = `
        <div class="rpg-knife-suggestions">
            <h3 style="margin-top:0;">AI suggestions for ${escapeHtml(ownerLabel)}</h3>
            <p style="opacity:0.8;font-size:0.9em;">Pick which to add. You can always edit them after.</p>
            <div class="rpg-knife-suggestion-list">${rows}</div>
            <details style="margin-top:1em;opacity:0.7;font-size:0.85em;">
                <summary>Raw model output</summary>
                <pre style="white-space:pre-wrap;max-height:8em;overflow:auto;">${escapeHtml(rawText)}</pre>
            </details>
        </div>
    `;
    const popup = new Popup(html, POPUP_TYPE.TEXT, '', {
        okButton: 'Add Selected',
        cancelButton: 'Cancel',
        wide: true,
        allowVerticalScrolling: true,
    });
    const result = await popup.show();
    if (result !== POPUP_RESULT.AFFIRMATIVE) return [];
    const picked = [];
    popup.dlg.querySelectorAll('.rpg-knife-suggestion-pick').forEach(cb => {
        if (cb.checked) picked.push(Number(cb.getAttribute('data-i')));
    });
    return picked.map(i => suggestions[i]).filter(Boolean);
}

async function runSuggestFlow(ownerKey, $container) {
    const description = readOwnerDescription(ownerKey);
    if (!description) {
        await callGenericPopup(
            ownerKey === USER_OWNER_KEY
                ? 'No persona description found. Set one up in the User Settings panel first.'
                : `No character sheet found for "${escapeHtml(ownerKey)}". Open the character sheet and fill in some details first.`,
            POPUP_TYPE.TEXT, '', { okButton: 'OK' });
        return;
    }
    // Loading indicator inline at top of the editor.
    const $loading = $('<div class="rpg-knife-loading">Asking the AI for knife suggestions…</div>');
    $container.find('.rpg-knife-editor-block').first().prepend($loading);
    let resultPayload;
    try {
        resultPayload = await suggestKnives(description);
    } finally {
        $loading.remove();
    }
    const { suggestions, rawText, error } = resultPayload || {};
    if (!suggestions?.length) {
        const msg = error ? `${error}\n\nRaw output:\n${rawText || '(empty)'}` : 'No suggestions returned.';
        await callGenericPopup(`<div style="white-space:pre-wrap;font-size:0.9em;">${escapeHtml(msg)}</div>`, POPUP_TYPE.TEXT, '', { okButton: 'OK' });
        return;
    }
    const accepted = await openSuggestionsModal(ownerKey, suggestions, rawText || '');
    if (!accepted.length) return;
    for (const s of accepted) addTemplate(ownerKey, s);
    renderKnifeListEditor(ownerKey, $container);
}

// ─── Section renderers (settings panel) ───────────────────────────────────────

/**
 * Renders the User Knives section in the settings panel into `$container`.
 * Idempotent — call again to refresh after edits.
 */
export function renderUserKnivesSection($container) {
    if (!$container || !$container.length) return;
    renderKnifeListEditor(USER_OWNER_KEY, $container);
}

/**
 * Renders the Character Knives section: one card per non-user owner, plus an
 * "+ Add Character" picker. Listens for owner-renamed / owner-deleted events
 * bubbled up from the inner editors and re-renders the whole section.
 */
export function renderCharacterKnivesSection($container) {
    if (!$container || !$container.length) return;
    const owners = listOwners().filter(k => k !== USER_OWNER_KEY).sort((a, b) => a.localeCompare(b));
    const cards = owners.map(o => `
        <div class="rpg-knife-character-card" data-owner="${escapeHtml(o)}">
            <div class="rpg-knife-character-card-body"></div>
        </div>
    `).join('');
    const empty = owners.length ? '' : '<div class="rpg-knife-empty">No character knives yet. Add a character below to start authoring their story hooks — they\'ll travel with that character into any chat where they appear.</div>';
    const html = `
        <div class="rpg-knife-character-section">
            ${empty}
            <div class="rpg-knife-character-cards">${cards}</div>
            <div class="rpg-knife-character-add-row">
                <input type="text" class="text_pole rpg-knife-add-character-name" placeholder="Character name">
                <button type="button" class="menu_button rpg-knife-add-character-btn">+ Add Character</button>
            </div>
        </div>
    `;
    $container.empty().append(html);

    // Render each owner's editor inside its card.
    for (const owner of owners) {
        const $card = $container.find(`.rpg-knife-character-card[data-owner="${$.escapeSelector(owner)}"] .rpg-knife-character-card-body`);
        renderKnifeListEditor(owner, $card);
    }

    // Re-render the whole section when an inner editor mutates the owner key.
    $container.off('rpg-knife-owner-renamed rpg-knife-owner-deleted');
    $container.on('rpg-knife-owner-renamed rpg-knife-owner-deleted', () => {
        renderCharacterKnivesSection($container);
    });

    $container.find('.rpg-knife-add-character-btn').on('click', () => {
        const $input = $container.find('.rpg-knife-add-character-name');
        const name = String($input.val() || '').trim();
        if (!name) return;
        if (name === USER_OWNER_KEY) return;
        // Seed the bucket by adding a placeholder template, then opening the editor.
        // Cleaner: just create the bucket via addTemplate with a default.
        addTemplate(name, {
            title: 'New Knife',
            description: '',
            severity: 1,
            foreshadowingHints: [],
        });
        $input.val('');
        renderCharacterKnivesSection($container);
    });
}

// ─── User Characters popup ────────────────────────────────────────────────────

/**
 * Opens a popup that lists the player's SillyTavern personas and lets them
 * author a knife list per persona. The active persona's knives are the ones
 * the AI sees during generation.
 *
 * Replaces the old flat "Your Knives" section in the settings panel, and
 * mirrors the structure of the per-character Workshop pane.
 */
export async function openUserCharactersPopup() {
    const personas = listPersonas();
    const activeKey = getActiveUserOwnerKey();

    const html = `
        <div class="rpg-uc-popup">
            <h3 style="margin-top:0;">Your Characters</h3>
            <p style="opacity:0.8;font-size:0.9em;">Each SillyTavern persona has its own knife list. The active persona's knives are the ones the AI deploys with proper pacing during your chats.</p>
            <div class="rpg-uc-split">
                <aside class="rpg-uc-rail" aria-label="Personas">
                    <ul class="rpg-uc-list" id="rpg-uc-list"></ul>
                </aside>
                <main class="rpg-uc-pane" aria-label="Knives editor">
                    <div id="rpg-uc-knives-container"></div>
                </main>
            </div>
        </div>
    `;
    const popup = new Popup(html, POPUP_TYPE.TEXT, '', {
        okButton: 'Close',
        cancelButton: false,
        wide: true,
        large: true,
        allowVerticalScrolling: true,
    });

    // Build the persona list and editor in the popup DOM as soon as it's
    // mounted. Popup constructs its DOM synchronously, so popup.dlg is
    // available before show() resolves.
    const dlg = popup.dlg;
    const $list = $(dlg).find('#rpg-uc-list');
    const $pane = $(dlg).find('#rpg-uc-knives-container');

    const renderList = (selectedKey) => {
        $list.empty();
        if (!personas.length) {
            $list.append('<li class="rpg-uc-empty">No SillyTavern personas found. Set one up under <em>User Settings → Persona Management</em>.</li>');
            return;
        }
        for (const p of personas) {
            const isActive = p.ownerKey === activeKey;
            const isSelected = p.ownerKey === selectedKey;
            const count = getTemplates(p.ownerKey).length;
            const $li = $(`
                <li class="rpg-uc-row${isSelected ? ' selected' : ''}${isActive ? ' is-active' : ''}" data-owner="${escapeHtml(p.ownerKey)}">
                    <div class="rpg-uc-row-name"><strong>${escapeHtml(p.name)}</strong>${isActive ? ' <span class="rpg-uc-active-tag">active</span>' : ''}</div>
                    <div class="rpg-uc-row-meta">${count} knife${count === 1 ? '' : 's'}</div>
                </li>
            `);
            $li.on('click', () => {
                renderList(p.ownerKey);
                renderKnifeListEditor(p.ownerKey, $pane);
            });
            $list.append($li);
        }
    };

    // Initial selection: prefer the active persona if it's in the list,
    // otherwise the first one.
    const initialKey = personas.find(p => p.ownerKey === activeKey)?.ownerKey
        || personas[0]?.ownerKey
        || null;

    if (initialKey) {
        renderList(initialKey);
        renderKnifeListEditor(initialKey, $pane);
    } else {
        renderList(null);
        $pane.html('<div class="rpg-knife-empty">Add a persona in SillyTavern\'s User Settings first, then come back to author its knives.</div>');
    }

    await popup.show();
}

