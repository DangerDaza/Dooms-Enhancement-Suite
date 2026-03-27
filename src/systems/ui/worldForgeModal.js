/**
 * World Forge Modal UI
 *
 * Two-panel modal: conversation (left) + generated entries preview (right)
 * with controls for mode selection, target lorebook, and context toggle.
 */
import * as worldForge from '../generation/worldForge.js';
import * as lorebookAPI from '../lorebook/lorebookAPI.js';
/* global toastr */ // toastr is a jQuery plugin loaded globally by SillyTavern

// ─── State ───────────────────────────────────────────────────────────────────

let isGenerating = false;
let pendingEntries = []; // Entries in the preview panel awaiting accept/reject

// ─── HTML Builder ────────────────────────────────────────────────────────────

function buildModalHTML() {
    const allNames = lorebookAPI.getAllWorldNames();

    let html = '<div class="rpg-wf-header">';
    html += '<h3><i class="fa-solid fa-hammer"></i> World Forge</h3>';
    html += '<div class="rpg-wf-header-actions">';
    html += '<button class="rpg-wf-clear-btn" title="Clear conversation"><i class="fa-solid fa-eraser"></i> Clear</button>';
    html += '<button class="rpg-wf-back-btn" title="Back to Lore Library"><i class="fa-solid fa-arrow-left"></i> Back</button>';
    html += '</div>';
    html += '</div>';

    html += '<div class="rpg-wf-layout">';

    // ── Left: Conversation Panel ──
    html += '<div class="rpg-wf-conversation">';
    html += '<div class="rpg-wf-messages" id="rpg-wf-messages">';
    html += '<div class="rpg-wf-welcome">';
    html += '<i class="fa-solid fa-hammer"></i>';
    html += '<h3>World Forge</h3>';
    html += '<p>Describe the lore you want to create and your connected AI will generate lorebook entries.</p>';
    html += '</div>';
    html += '</div>';
    html += '</div>';

    // ── Right: Entries Preview Panel ──
    html += '<div class="rpg-wf-entries-panel">';
    html += '<div class="rpg-wf-entries-header">';
    html += '<h4>Generated Entries</h4>';
    html += '<span class="rpg-wf-entry-count" id="rpg-wf-entry-count">0 entries</span>';
    html += '</div>';
    html += '<div class="rpg-wf-entries-list" id="rpg-wf-entries-list">';
    html += '<div class="rpg-wf-entries-empty"><i class="fa-solid fa-scroll"></i><p>Entries will appear here</p></div>';
    html += '</div>';
    html += '<div class="rpg-wf-entries-actions">';
    html += '<button class="rpg-wf-accept-all" id="rpg-wf-accept-all" disabled><i class="fa-solid fa-check-double"></i> Accept All</button>';
    html += '</div>';
    html += '</div>';

    html += '</div>'; // end layout

    // ── Bottom Controls ──
    html += '<div class="rpg-wf-controls">';

    // Controls row
    html += '<div class="rpg-wf-controls-row">';
    html += '<select class="rpg-wf-target" id="rpg-wf-target" title="Target lorebook">';
    html += '<option value="">Select target lorebook...</option>';
    html += '<option value="__new__">+ Create New Lorebook</option>';
    for (const name of allNames) {
        html += `<option value="${name}">${name}</option>`;
    }
    html += '</select>';
    html += '<select class="rpg-wf-mode" id="rpg-wf-mode" title="Generation mode">';
    html += '<option value="new">New Entries</option>';
    html += '<option value="deepdive">Deep Dive</option>';
    html += '<option value="expand">Expand Existing</option>';
    html += '<option value="revise">Revise Entry</option>';
    html += '</select>';
    html += '<button class="rpg-wf-context-btn" id="rpg-wf-context-btn" title="Select lore to include as context"><i class="fa-solid fa-book-open"></i> Context <span class="rpg-wf-context-count" id="rpg-wf-context-count"></span></button>';
    html += '</div>';

    // Context picker (hidden by default)
    html += '<div class="rpg-wf-context-picker" id="rpg-wf-context-picker" style="display:none;">';
    html += '<div class="rpg-wf-context-picker-header">';
    html += '<span>Select lore to include as context:</span>';
    html += '<button class="rpg-wf-context-select-none" id="rpg-wf-context-select-none" title="Deselect all">Clear</button>';
    html += '</div>';
    html += '<div class="rpg-wf-context-picker-list" id="rpg-wf-context-picker-list">';
    for (const name of allNames) {
        html += `<div class="rpg-wf-context-book" data-world="${name}">`;
        html += `<label class="rpg-wf-context-book-label"><input type="checkbox" class="rpg-wf-context-book-cb" data-world="${name}"> <i class="fa-solid fa-book"></i> ${name}</label>`;
        html += `<button class="rpg-wf-context-book-expand" data-world="${name}" title="Pick individual entries"><i class="fa-solid fa-chevron-down"></i></button>`;
        html += `<div class="rpg-wf-context-entries" data-world="${name}" style="display:none;"></div>`;
        html += '</div>';
    }
    html += '</div></div>';

    // Input row
    html += '<div class="rpg-wf-input-row">';
    html += '<textarea class="rpg-wf-input" id="rpg-wf-input" placeholder="Describe the lore you want to create..." rows="2"></textarea>';
    html += '<button class="rpg-wf-generate-btn" id="rpg-wf-generate-btn" title="Generate"><i class="fa-solid fa-wand-magic-sparkles"></i></button>';
    html += '</div>';

    html += '</div>'; // end controls

    return html;
}

// ─── Entry Card Rendering ────────────────────────────────────────────────────

function renderEntryCard(entry, index) {
    const keywords = (entry.key || []).join(', ');
    const contentPreview = (entry.content || '').substring(0, 200);
    const tokenEst = Math.round((entry.content || '').length / 3.5);

    let html = `<div class="rpg-wf-entry-card ${entry._accepted ? 'accepted' : ''}" data-index="${index}">`;
    html += '<div class="rpg-wf-entry-card-header">';
    html += `<span class="rpg-wf-entry-title">${entry.comment || 'Untitled'}</span>`;
    html += `<span class="rpg-wf-entry-tokens">${tokenEst}t</span>`;
    html += '</div>';
    html += `<div class="rpg-wf-entry-keywords"><i class="fa-solid fa-key"></i> ${keywords || 'no keywords'}</div>`;
    html += `<div class="rpg-wf-entry-preview">${contentPreview}${(entry.content || '').length > 200 ? '...' : ''}</div>`;
    html += '<div class="rpg-wf-entry-card-actions">';
    if (!entry._accepted) {
        html += `<button class="rpg-wf-entry-accept" data-index="${index}" title="Accept & save"><i class="fa-solid fa-check"></i> Accept</button>`;
        html += `<button class="rpg-wf-entry-edit" data-index="${index}" title="Edit before saving"><i class="fa-solid fa-pen"></i> Edit</button>`;
        html += `<button class="rpg-wf-entry-discard" data-index="${index}" title="Discard"><i class="fa-solid fa-xmark"></i></button>`;
    } else {
        html += '<span class="rpg-wf-entry-saved"><i class="fa-solid fa-check-circle"></i> Saved</span>';
    }
    html += '</div>';
    html += '</div>';
    return html;
}

function renderEntriesList() {
    const list = document.getElementById('rpg-wf-entries-list');
    const count = document.getElementById('rpg-wf-entry-count');
    const acceptAll = document.getElementById('rpg-wf-accept-all');
    if (!list) return;

    if (pendingEntries.length === 0) {
        list.innerHTML = '<div class="rpg-wf-entries-empty"><i class="fa-solid fa-scroll"></i><p>Entries will appear here</p></div>';
        if (count) count.textContent = '0 entries';
        if (acceptAll) acceptAll.disabled = true;
        return;
    }

    list.innerHTML = pendingEntries.map((e, i) => renderEntryCard(e, i)).join('');
    const unsaved = pendingEntries.filter(e => !e._accepted).length;
    if (count) count.textContent = `${pendingEntries.length} entries (${unsaved} pending)`;
    if (acceptAll) acceptAll.disabled = unsaved === 0;
}

// ─── Message Rendering ───────────────────────────────────────────────────────

function addMessage(role, text) {
    const container = document.getElementById('rpg-wf-messages');
    if (!container) return;

    // Remove welcome message if still present
    const welcome = container.querySelector('.rpg-wf-welcome');
    if (welcome) welcome.remove();

    const msgDiv = document.createElement('div');
    msgDiv.className = `rpg-wf-message rpg-wf-message--${role}`;

    const icon = role === 'user' ? 'fa-user' : 'fa-robot';
    msgDiv.innerHTML = `<div class="rpg-wf-msg-icon"><i class="fa-solid ${icon}"></i></div><div class="rpg-wf-msg-text">${text}</div>`;
    container.appendChild(msgDiv);
    container.scrollTop = container.scrollHeight;
}

function addLoadingMessage() {
    const container = document.getElementById('rpg-wf-messages');
    if (!container) return;

    const msgDiv = document.createElement('div');
    msgDiv.className = 'rpg-wf-message rpg-wf-message--assistant rpg-wf-loading';
    msgDiv.innerHTML = '<div class="rpg-wf-msg-icon"><i class="fa-solid fa-robot"></i></div><div class="rpg-wf-msg-text"><i class="fa-solid fa-spinner fa-spin"></i> Forging entries...</div>';
    container.appendChild(msgDiv);
    container.scrollTop = container.scrollHeight;
}

function removeLoadingMessage() {
    const loading = document.querySelector('.rpg-wf-loading');
    if (loading) loading.remove();
}

// ─── Entry Edit Modal ────────────────────────────────────────────────────────

function openEntryEditor(index) {
    const entry = pendingEntries[index];
    if (!entry) return;

    const overlay = document.createElement('div');
    overlay.className = 'rpg-wf-edit-overlay';
    overlay.innerHTML = `
        <div class="rpg-wf-edit-modal">
            <h4>Edit Entry</h4>
            <label>Title</label>
            <input type="text" class="rpg-wf-edit-field" data-field="comment" value="${(entry.comment || '').replace(/"/g, '&quot;')}">
            <label>Primary Keywords (comma-separated)</label>
            <input type="text" class="rpg-wf-edit-field" data-field="key" value="${(entry.key || []).join(', ')}">
            <label>Secondary Keywords (comma-separated)</label>
            <input type="text" class="rpg-wf-edit-field" data-field="keysecondary" value="${(entry.keysecondary || []).join(', ')}">
            <label>Content</label>
            <textarea class="rpg-wf-edit-field rpg-wf-edit-content" data-field="content" rows="10">${entry.content || ''}</textarea>
            <label>Inclusion Group</label>
            <input type="text" class="rpg-wf-edit-field" data-field="group" value="${entry.group || ''}">
            <div class="rpg-wf-edit-row">
                <div><label>Position</label><select class="rpg-wf-edit-field" data-field="position">
                    <option value="0" ${entry.position === 0 ? 'selected' : ''}>Before Char Defs</option>
                    <option value="1" ${entry.position === 1 ? 'selected' : ''}>After Char Defs</option>
                    <option value="4" ${entry.position === 4 ? 'selected' : ''}>At Depth</option>
                </select></div>
                <div><label>Depth</label><input type="number" class="rpg-wf-edit-field" data-field="depth" value="${entry.depth ?? 4}" min="0" max="999"></div>
                <div><label>Order</label><input type="number" class="rpg-wf-edit-field" data-field="order" value="${entry.order ?? 100}" min="0" max="9999"></div>
            </div>
            <div class="rpg-wf-edit-actions">
                <button class="rpg-wf-edit-save">Save Changes</button>
                <button class="rpg-wf-edit-cancel">Cancel</button>
            </div>
        </div>
    `;

    document.body.appendChild(overlay);

    // Save handler
    overlay.querySelector('.rpg-wf-edit-save').addEventListener('click', () => {
        const fields = overlay.querySelectorAll('.rpg-wf-edit-field');
        fields.forEach(field => {
            const key = field.dataset.field;
            let val = field.value;
            if (key === 'key' || key === 'keysecondary') {
                val = val.split(',').map(s => s.trim()).filter(Boolean);
            } else if (key === 'position' || key === 'depth' || key === 'order') {
                val = Number(val);
            }
            entry[key] = val;
        });
        overlay.remove();
        renderEntriesList();
    });

    // Cancel handler
    overlay.querySelector('.rpg-wf-edit-cancel').addEventListener('click', () => {
        overlay.remove();
    });

    // Click outside to close
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) overlay.remove();
    });
}

// ─── Context Picker Helpers ──────────────────────────────────────────────────

function updateContextCount() {
    const count = document.getElementById('rpg-wf-context-count');
    const bookCbs = document.querySelectorAll('.rpg-wf-context-book-cb:checked');
    const entryCbs = document.querySelectorAll('.rpg-wf-context-entry-cb:checked');
    const total = bookCbs.length + entryCbs.length;
    if (count) count.textContent = total > 0 ? `(${total})` : '';
}

/**
 * Get the selected context — returns { books: string[], entries: {world, uid}[] }
 */
function getSelectedContext() {
    const selectedBooks = [];
    const selectedEntries = [];

    // Fully-checked books (all entries selected)
    document.querySelectorAll('.rpg-wf-context-book-cb:checked').forEach(cb => {
        selectedBooks.push(cb.dataset.world);
    });

    // Individual entries from unchecked books
    document.querySelectorAll('.rpg-wf-context-entry-cb:checked').forEach(cb => {
        const world = cb.dataset.world;
        if (!selectedBooks.includes(world)) {
            selectedEntries.push({ world, uid: Number(cb.dataset.uid) });
        }
    });

    return { books: selectedBooks, entries: selectedEntries };
}

// ─── Event Handlers ──────────────────────────────────────────────────────────

async function handleGenerate() {
    if (isGenerating) return;

    const input = document.getElementById('rpg-wf-input');
    const targetSelect = document.getElementById('rpg-wf-target');
    const modeSelect = document.getElementById('rpg-wf-mode');
    const generateBtn = document.getElementById('rpg-wf-generate-btn');

    const userMessage = input?.value?.trim();
    if (!userMessage) return;

    const targetBook = targetSelect?.value || '';
    const mode = modeSelect?.value || 'new';
    const selectedContext = getSelectedContext();
    const includeExisting = selectedContext.books.length > 0 || selectedContext.entries.length > 0;

    // Disable UI
    isGenerating = true;
    if (generateBtn) generateBtn.disabled = true;
    if (input) input.value = '';

    // Show user message
    addMessage('user', userMessage);
    addLoadingMessage();

    try {
        const { entries, rawResponse } = await worldForge.generateEntries(userMessage, {
            mode,
            targetBook,
            includeExisting,
            selectedContext,
        });

        removeLoadingMessage();

        if (entries.length === 0) {
            // In deep dive mode, the AI may respond with questions (not JSON) — show as conversation
            if (mode === 'deepdive' && rawResponse && rawResponse.trim().length > 0) {
                addMessage('assistant', rawResponse);
            } else {
                addMessage('assistant', 'I wasn\'t able to parse valid entries from the response. Try rephrasing your prompt or being more specific.');
            }
        } else {
            addMessage('assistant', `Generated ${entries.length} ${entries.length === 1 ? 'entry' : 'entries'}. Review them in the panel on the right.`);
            pendingEntries = [...entries, ...pendingEntries.filter(e => e._accepted)];
            renderEntriesList();
        }
    } catch (err) {
        removeLoadingMessage();
        addMessage('assistant', `Generation failed: ${err.message || 'Unknown error'}. Make sure you have an active API connection.`);
        console.error('[WorldForge] Generation error:', err);
    } finally {
        isGenerating = false;
        if (generateBtn) generateBtn.disabled = false;
    }
}

async function handleAcceptEntry(index) {
    const entry = pendingEntries[index];
    if (!entry || entry._accepted) return;

    const targetSelect = document.getElementById('rpg-wf-target');
    const targetBook = targetSelect?.value;

    if (!targetBook || targetBook === '__new__') {
        toastr.warning('Please select a target lorebook first.');
        return;
    }

    try {
        await worldForge.saveEntriesToBook(targetBook, [entry]);
        entry._accepted = true;
        renderEntriesList();
        toastr.success(`Saved "${entry.comment}" to ${targetBook}`);
    } catch (err) {
        toastr.error(`Failed to save: ${err.message}`);
    }
}

async function handleAcceptAll() {
    const targetSelect = document.getElementById('rpg-wf-target');
    const targetBook = targetSelect?.value;

    if (!targetBook || targetBook === '__new__') {
        toastr.warning('Please select a target lorebook first.');
        return;
    }

    const unsaved = pendingEntries.filter(e => !e._accepted);
    if (unsaved.length === 0) return;

    try {
        await worldForge.saveEntriesToBook(targetBook, unsaved);
        unsaved.forEach(e => e._accepted = true);
        renderEntriesList();
        toastr.success(`Saved ${unsaved.length} entries to ${targetBook}`);
    } catch (err) {
        toastr.error(`Failed to save: ${err.message}`);
    }
}

function handleDiscardEntry(index) {
    pendingEntries.splice(index, 1);
    renderEntriesList();
}

// ─── Setup ───────────────────────────────────────────────────────────────────

function setupEvents(container) {
    // Back button — close forge, return to lore library
    container.querySelector('.rpg-wf-back-btn')?.addEventListener('click', () => {
        const forgeContainer = document.getElementById('rpg-wf-container');
        const modal = document.getElementById('rpg-lorebook-modal');
        if (forgeContainer) forgeContainer.style.display = 'none';
        const body = modal?.querySelector('.rpg-lb-modal-body');
        if (body) body.style.display = '';
        modal?.querySelector('.rpg-wf-open-btn')?.classList.remove('active');
    });

    // Clear button — reset conversation
    container.querySelector('.rpg-wf-clear-btn')?.addEventListener('click', () => {
        worldForge.clearConversation();
        pendingEntries = [];
        const messages = container.querySelector('#rpg-wf-messages');
        if (messages) {
            messages.innerHTML = '<div class="rpg-wf-welcome"><i class="fa-solid fa-hammer"></i><h3>World Forge</h3><p>Describe the lore you want to create and your connected AI will generate lorebook entries.</p></div>';
        }
        renderEntriesList();
    });

    // Generate button
    container.querySelector('#rpg-wf-generate-btn')?.addEventListener('click', handleGenerate);

    // Target lorebook dropdown — handle "Create New Lorebook"
    container.querySelector('#rpg-wf-target')?.addEventListener('change', async (e) => {
        if (e.target.value !== '__new__') return;

        const newName = prompt('Enter a name for the new lorebook:');
        if (!newName || !newName.trim()) {
            e.target.value = ''; // Reset to placeholder
            return;
        }

        try {
            await lorebookAPI.createNewWorld(newName.trim());
            // Add the new option and select it
            const option = document.createElement('option');
            option.value = newName.trim();
            option.textContent = newName.trim();
            e.target.insertBefore(option, e.target.querySelector('option:last-child'));
            e.target.value = newName.trim();
            toastr.success(`Created lorebook: ${newName.trim()}`);
        } catch (err) {
            toastr.error(`Failed to create lorebook: ${err.message}`);
            e.target.value = ''; // Reset to placeholder
        }
    });

    // Context picker toggle
    container.querySelector('#rpg-wf-context-btn')?.addEventListener('click', () => {
        const picker = document.getElementById('rpg-wf-context-picker');
        if (picker) picker.style.display = picker.style.display === 'none' ? '' : 'none';
    });

    // Context picker — clear all
    container.querySelector('#rpg-wf-context-select-none')?.addEventListener('click', () => {
        const cbs = document.querySelectorAll('.rpg-wf-context-book-cb, .rpg-wf-context-entry-cb');
        cbs.forEach(cb => cb.checked = false);
        updateContextCount();
    });

    // Context picker — book checkbox (select/deselect all entries in book)
    container.querySelector('#rpg-wf-context-picker-list')?.addEventListener('change', (e) => {
        const bookCb = e.target.closest('.rpg-wf-context-book-cb');
        if (bookCb) {
            const world = bookCb.dataset.world;
            const entryCbs = document.querySelectorAll(`.rpg-wf-context-entry-cb[data-world="${CSS.escape(world)}"]`);
            entryCbs.forEach(cb => cb.checked = bookCb.checked);
        }
        updateContextCount();
    });

    // Context picker — expand book to show individual entries
    container.querySelector('#rpg-wf-context-picker-list')?.addEventListener('click', async (e) => {
        const expandBtn = e.target.closest('.rpg-wf-context-book-expand');
        if (!expandBtn) return;

        const world = expandBtn.dataset.world;
        const entriesDiv = document.querySelector(`.rpg-wf-context-entries[data-world="${CSS.escape(world)}"]`);
        if (!entriesDiv) return;

        // Toggle visibility
        if (entriesDiv.style.display !== 'none') {
            entriesDiv.style.display = 'none';
            expandBtn.querySelector('i').className = 'fa-solid fa-chevron-down';
            return;
        }

        // Load entries if not already loaded
        if (!entriesDiv.dataset.loaded) {
            try {
                const data = await lorebookAPI.loadWorldData(world);
                if (data?.entries) {
                    const sorted = lorebookAPI.getEntriesSorted(data);
                    const bookCb = document.querySelector(`.rpg-wf-context-book-cb[data-world="${CSS.escape(world)}"]`);
                    const bookChecked = bookCb?.checked || false;
                    let html = '';
                    for (const { uid, entry } of sorted) {
                        const title = entry.comment || `Entry ${uid}`;
                        html += `<label class="rpg-wf-context-entry-label"><input type="checkbox" class="rpg-wf-context-entry-cb" data-world="${world}" data-uid="${uid}" ${bookChecked ? 'checked' : ''}> ${title}</label>`;
                    }
                    entriesDiv.innerHTML = html || '<span class="rpg-wf-context-empty">No entries</span>';
                    entriesDiv.dataset.loaded = 'true';
                }
            } catch {
                entriesDiv.innerHTML = '<span class="rpg-wf-context-empty">Failed to load</span>';
            }
        }

        entriesDiv.style.display = '';
        expandBtn.querySelector('i').className = 'fa-solid fa-chevron-up';
    });

    // Enter to send (Ctrl+Enter or Shift+Enter)
    container.querySelector('#rpg-wf-input')?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && (e.ctrlKey || e.shiftKey)) {
            e.preventDefault();
            handleGenerate();
        }
    });

    // Accept all button
    container.querySelector('#rpg-wf-accept-all')?.addEventListener('click', handleAcceptAll);

    // Entry card actions (delegated)
    container.querySelector('#rpg-wf-entries-list')?.addEventListener('click', (e) => {
        const acceptBtn = e.target.closest('.rpg-wf-entry-accept');
        const editBtn = e.target.closest('.rpg-wf-entry-edit');
        const discardBtn = e.target.closest('.rpg-wf-entry-discard');

        if (acceptBtn) handleAcceptEntry(Number(acceptBtn.dataset.index));
        if (editBtn) openEntryEditor(Number(editBtn.dataset.index));
        if (discardBtn) handleDiscardEntry(Number(discardBtn.dataset.index));
    });
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Render the World Forge into a container element
 * @param {HTMLElement} container - The container to render into
 */
export function renderWorldForge(container) {
    container.innerHTML = buildModalHTML();
    setupEvents(container);

    // Restore any conversation history
    const history = worldForge.getConversationHistory();
    for (const msg of history) {
        addMessage(msg.role, msg.role === 'assistant' ? 'Previously generated entries.' : msg.content);
    }
}

/**
 * Clear the forge state
 */
export function clearWorldForge() {
    worldForge.clearConversation();
    pendingEntries = [];
    isGenerating = false;
}
