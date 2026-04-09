/**
 * Lorebook Rendering & Event Delegation Module (v2 — Three-Panel Layout)
 *
 * Layout:  Left panel (campaign tree) → Middle panel (entry list) → Right panel (editor)
 *
 * Exported API:
 *   - initLorebookEventDelegation()  -- call once during extension init
 *   - renderLorebook()               -- call to populate/refresh the modal body
 *   - resetLorebookViewState()       -- call on modal open to clear transient state
 */

import { extensionSettings } from '../../core/state.js';
import { saveSettings } from '../../core/persistence.js';
import * as lorebookAPI from '../lorebook/lorebookAPI.js';
import * as campaignManager from '../lorebook/campaignManager.js';
import { getLorebookModal } from '../ui/lorebookModal.js';
import { renderMobileLorebook, initMobileLorebookEventDelegation } from './lorebookMobile.js';

// ─── Icon Palette ────────────────────────────────────────────────────────────

const CAMPAIGN_ICONS = [
    'fa-dragon', 'fa-hat-wizard', 'fa-wand-sparkles', 'fa-shield-halved',
    'fa-skull-crossbones', 'fa-crown', 'fa-dungeon',
    'fa-rocket', 'fa-robot', 'fa-atom', 'fa-satellite', 'fa-meteor', 'fa-user-astronaut',
    'fa-mountain-sun', 'fa-tree', 'fa-water', 'fa-globe', 'fa-seedling',
    'fa-ghost', 'fa-heart', 'fa-masks-theater', 'fa-gun', 'fa-car', 'fa-city',
    'fa-house', 'fa-scroll',
    'fa-folder', 'fa-book', 'fa-star', 'fa-fire', 'fa-bolt', 'fa-gem',
];

const CAMPAIGN_COLORS = [
    '#e94560', '#e07b39', '#f0c040', '#2ecc71', '#1abc9c',
    '#4a7ba7', '#9b59b6', '#e84393', '#95a5a6', '',
];

function buildIconPickerHtml(campaignId, currentIcon, currentColor) {
    let html = `<div class="rpg-lb-icon-picker" data-campaign="${campaignId}">`;
    html += '<div class="rpg-lb-icon-grid">';
    for (const icon of CAMPAIGN_ICONS) {
        const isSelected = icon === currentIcon ? ' selected' : '';
        html += `<button class="rpg-lb-icon-option${isSelected}" data-icon="${icon}" title="${icon.replace('fa-', '')}"><i class="fa-solid ${icon}"></i></button>`;
    }
    html += '</div><div class="rpg-lb-color-row">';
    for (const color of CAMPAIGN_COLORS) {
        const isSelected = color === currentColor ? ' selected' : '';
        if (color) {
            html += `<button class="rpg-lb-color-swatch${isSelected}" data-color="${color}" style="background:${color};" title="${color}"></button>`;
        } else {
            html += `<button class="rpg-lb-color-swatch${isSelected}" data-color="" title="Default"><i class="fa-solid fa-xmark"></i></button>`;
        }
    }
    html += '</div></div>';
    return html;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

let saveDebounceTimer = null;
function debouncedSave(worldName, data) {
    clearTimeout(saveDebounceTimer);
    saveDebounceTimer = setTimeout(() => {
        lorebookAPI.saveWorldData(worldName, data);
    }, 500);
}

let searchDebounceTimer = null;

const posBadgeMap = { 0: '↑Char', 1: '↓Char', 2: '↑AN', 3: '↓AN', 4: '@D', 5: '↑EM', 6: '↓EM', 7: 'Outlet' };

// ─── Transient View State ────────────────────────────────────────────────────

let selectedBook = null;       // worldName of currently selected lorebook
let selectedEntry = null;      // { world: string, uid: number } | null
let expandedEditor = false;    // full-width editor mode

/** Resets transient view state (call on modal open) */
export function resetLorebookViewState() {
    selectedBook = null;
    selectedEntry = null;
    expandedEditor = false;
}

/** Sets the selected book and entry */
export function setSelectedBookAndEntry(bookName, uid) {
    selectedBook = bookName;
    selectedEntry = uid != null ? { world: bookName, uid: Number(uid) } : null;
    expandedEditor = false;
}

// ─── Panel-specific Data Cache ───────────────────────────────────────────────

let middlePanelData = null;   // cached WI data for the currently selected book
let middlePanelEntries = [];  // sorted entries for the middle panel

// ─── Main Render (Orchestrator) ──────────────────────────────────────────────

/**
 * Renders the entire Lorebook Manager modal body.
 * Delegates to the appropriate view renderer based on viewMode.
 */
export function renderLorebook() {
    const body = document.querySelector('#rpg-lorebook-modal .rpg-lb-modal-body');
    if (!body) return;

    if (isMobileView()) {
        renderMobileLorebook();
        return;
    }

    renderListView(body);
    renderFooter();
}

// ─── List View (Three-Panel) ─────────────────────────────────────────────────

function renderListView(body) {
    if (expandedEditor && selectedEntry) {
        body.innerHTML = renderExpandedEditor();
    } else {
        const hasEditor = selectedEntry ? 'true' : 'false';
        let html = `<div class="rpg-lb-list-layout" data-mobile-panel="left" data-has-editor="${hasEditor}">`;
        html += renderLeftPanel();
        html += renderMiddlePanel();
        html += renderRightPanel();
        html += '</div>';
        body.innerHTML = html;
    }
}

// ─── Left Panel (Campaign / Book Tree) ───────────────────────────────────────

function renderLeftPanel() {
    const allNames = lorebookAPI.getAllWorldNames();
    const activeNames = lorebookAPI.getActiveWorldNames();
    const campaigns = campaignManager.getCampaignsInOrder();
    const unfiled = campaignManager.getUnfiledBooks();
    const lb = extensionSettings.lorebook || {};
    const lastFilter = lb.lastFilter || 'all';

    let html = '<aside class="rpg-lb-panel-left">';

    // ── Search + filter ──
    html += '<div class="rpg-lb-panel-header">';
    html += '<div class="rpg-lb-search-wrap"><i class="fa-solid fa-magnifying-glass"></i>';
    html += `<input type="text" class="rpg-lb-search" placeholder="Search..." value="${escapeHtml(lb.lastSearch || '')}">`;
    html += '</div>';
    html += '<div class="rpg-lb-filter-pills">';
    html += `<button class="rpg-lb-fpill ${lastFilter === 'all' ? 'active' : ''}" data-filter="all">All</button>`;
    html += `<button class="rpg-lb-fpill ${lastFilter === 'active' ? 'active' : ''}" data-filter="active">Active</button>`;
    html += `<button class="rpg-lb-fpill ${lastFilter === 'inactive' ? 'active' : ''}" data-filter="inactive">Inactive</button>`;
    html += '</div></div>';

    // ── Book tree ──
    html += '<div class="rpg-lb-tree-list">';

    for (const { id, campaign } of campaigns) {
        const isCollapsed = campaignManager.isCampaignCollapsed(id);
        const books = (campaign.books || []).filter(b => allNames.includes(b));
        const activeInCampaign = books.filter(b => activeNames.includes(b)).length;

        // Skip campaign entirely if filter would hide all its books
        const visibleBooks = lastFilter === 'active'
            ? books.filter(b => activeNames.includes(b))
            : lastFilter === 'inactive'
                ? books.filter(b => !activeNames.includes(b))
                : books;
        if (visibleBooks.length === 0 && lastFilter !== 'all') continue;

        html += `<div class="rpg-lb-campaign-group" data-campaign="${id}">`;

        // Campaign header
        html += `<div class="rpg-lb-campaign-header ${isCollapsed ? 'collapsed' : ''}" data-campaign="${id}">`;
        const iconClass = campaign.icon || 'fa-folder';
        const iconColor = campaign.color ? ` style="color: ${escapeHtml(campaign.color)};"` : '';
        html += `<i class="fa-solid ${escapeHtml(iconClass)} rpg-lb-campaign-icon" data-campaign="${id}"${iconColor} title="Click to change icon"></i>`;
        html += `<span class="rpg-lb-campaign-name">${escapeHtml(campaign.name)}</span>`;
        html += `<span class="rpg-lb-campaign-stats">${activeInCampaign}/${books.length}</span>`;
        html += `<button class="rpg-lb-campaign-delete" data-campaign="${id}" title="Delete"><i class="fa-solid fa-trash"></i></button>`;
        html += `<i class="fa-solid fa-chevron-down rpg-lb-campaign-chevron"></i>`;
        html += '</div>';

        // Books inside campaign
        html += `<div class="rpg-lb-campaign-body" ${isCollapsed ? 'style="display:none;"' : ''}>`;
        for (const worldName of books) {
            html += buildTreeBookHtml(worldName, activeNames, lastFilter);
        }
        html += '</div></div>';
    }

    // Unfiled
    if (unfiled.length > 0) {
        const visibleUnfiled = lastFilter === 'active'
            ? unfiled.filter(b => activeNames.includes(b))
            : lastFilter === 'inactive'
                ? unfiled.filter(b => !activeNames.includes(b))
                : unfiled;

        if (visibleUnfiled.length > 0 || lastFilter === 'all') {
            html += '<div class="rpg-lb-campaign-group unfiled-group" data-campaign="unfiled">';
            html += '<div class="rpg-lb-campaign-header collapsed" data-campaign="unfiled">';
            html += '<i class="fa-solid fa-folder-open rpg-lb-campaign-icon"></i>';
            html += '<span class="rpg-lb-campaign-name">Unfiled</span>';
            html += `<span class="rpg-lb-campaign-stats">${unfiled.length}</span>`;
            html += '<i class="fa-solid fa-chevron-down rpg-lb-campaign-chevron"></i>';
            html += '</div>';
            html += '<div class="rpg-lb-campaign-body" style="display:none;">';
            for (const worldName of unfiled) {
                html += buildTreeBookHtml(worldName, activeNames, lastFilter);
            }
            html += '</div></div>';
        }
    }

    html += '</div>'; // tree-list

    // ── Bottom actions ──
    html += '<div class="rpg-lb-panel-actions">';
    html += '<button class="rpg-lb-tab-add" title="New Library"><i class="fa-solid fa-folder-plus"></i></button>';
    html += '<button class="rpg-lb-btn-new-book"><i class="fa-solid fa-plus"></i> Lorebook</button>';
    html += '<button class="rpg-lb-btn-import"><i class="fa-solid fa-file-import"></i> Import</button>';
    html += '<input type="file" class="rpg-lb-import-file" accept=".json,.lorebook,.png" hidden>';
    html += '</div>';

    // ── Global WI Settings (collapsible) ──
    const gs = lorebookAPI.getGlobalWISettings();
    html += '<div class="rpg-lb-global-settings">';
    html += '<div class="rpg-lb-global-settings-header"><i class="fa-solid fa-sliders"></i> <span>Global Settings</span>';
    html += '<i class="fa-solid fa-chevron-right rpg-lb-global-chevron"></i></div>';
    html += '<div class="rpg-lb-global-settings-body" style="display:none;">';
    html += '<div class="rpg-lb-global-row">';
    html += `<div class="rpg-lb-global-field"><label>Scan Depth</label><input type="number" data-global="world_info_depth" value="${gs.world_info_depth}" min="0" max="1000"></div>`;
    html += `<div class="rpg-lb-global-field"><label>Context %</label><input type="number" data-global="world_info_budget" value="${gs.world_info_budget}" min="1" max="100"></div>`;
    html += `<div class="rpg-lb-global-field"><label>Budget Cap</label><input type="number" data-global="world_info_budget_cap" value="${gs.world_info_budget_cap}" min="0" max="65536"></div>`;
    html += '</div><div class="rpg-lb-global-row">';
    html += `<div class="rpg-lb-global-field"><label>Min Activations</label><input type="number" data-global="world_info_min_activations" value="${gs.world_info_min_activations}" min="0" max="100"></div>`;
    html += `<div class="rpg-lb-global-field"><label>Max Depth</label><input type="number" data-global="world_info_min_activations_depth_max" value="${gs.world_info_min_activations_depth_max}" min="0" max="100"></div>`;
    html += `<div class="rpg-lb-global-field"><label>Max Recursion</label><input type="number" data-global="world_info_max_recursion_steps" value="${gs.world_info_max_recursion_steps}" min="0" max="10"></div>`;
    html += '</div>';
    html += '<div class="rpg-lb-global-row"><div class="rpg-lb-global-field wide"><label>Strategy</label>';
    html += `<select data-global="world_info_character_strategy">`;
    html += `<option value="0" ${gs.world_info_character_strategy == 0 ? 'selected' : ''}>Sorted Evenly</option>`;
    html += `<option value="1" ${gs.world_info_character_strategy == 1 ? 'selected' : ''}>Character Lore First</option>`;
    html += `<option value="2" ${gs.world_info_character_strategy == 2 ? 'selected' : ''}>Global Lore First</option>`;
    html += '</select></div></div>';
    html += '<div class="rpg-lb-global-row checkboxes">';
    html += `<label><input type="checkbox" data-global="world_info_include_names" ${gs.world_info_include_names ? 'checked' : ''}> Include Names</label>`;
    html += `<label><input type="checkbox" data-global="world_info_recursive" ${gs.world_info_recursive ? 'checked' : ''}> Recursive Scan</label>`;
    html += `<label><input type="checkbox" data-global="world_info_case_sensitive" ${gs.world_info_case_sensitive ? 'checked' : ''}> Case Sensitive</label>`;
    html += `<label><input type="checkbox" data-global="world_info_match_whole_words" ${gs.world_info_match_whole_words ? 'checked' : ''}> Match Whole Words</label>`;
    html += `<label><input type="checkbox" data-global="world_info_use_group_scoring" ${gs.world_info_use_group_scoring ? 'checked' : ''}> Use Group Scoring</label>`;
    html += `<label><input type="checkbox" data-global="world_info_overflow_alert" ${gs.world_info_overflow_alert ? 'checked' : ''}> Alert On Overflow</label>`;
    html += '</div></div></div>';

    html += '</aside>';

    // Apply status/search filters after render via post-processing
    setTimeout(() => {
        const leftPanel = document.querySelector('.rpg-lb-panel-left');
        if (!leftPanel) return;
        applyStatusFilter(leftPanel, lb.lastFilter || 'all');
        const searchVal = (lb.lastSearch || '').trim().toLowerCase();
        if (searchVal) applySearchFilter(leftPanel, searchVal);
    }, 0);

    return html;
}

function buildTreeBookHtml(worldName, activeNames, filter) {
    const isActive = activeNames.includes(worldName);
    const w = escapeHtml(worldName);
    const isSelected = selectedBook === worldName;

    // Apply status filter at build time
    if (filter === 'active' && !isActive) return '';
    if (filter === 'inactive' && isActive) return '';

    let html = `<div class="rpg-lb-tree-book ${isActive ? 'active-book' : 'inactive'} ${isSelected ? 'selected' : ''}" data-world="${w}">`;
    html += `<div class="rpg-lb-toggle ${isActive ? 'active' : ''}" data-type="book" data-world="${w}"></div>`;
    html += `<i class="fa-solid fa-book rpg-lb-tree-book-icon"></i>`;
    html += `<span class="rpg-lb-tree-book-name">${w}</span>`;
    html += `<span class="rpg-lb-tree-book-badge">...</span>`;
    html += '</div>';
    return html;
}

// ─── Middle Panel (Entry List) ───────────────────────────────────────────────

function renderMiddlePanel() {
    let html = '<section class="rpg-lb-panel-middle">';

    // Mobile back button
    html += '<button class="rpg-lb-mobile-back" data-target="left"><i class="fa-solid fa-chevron-left"></i> Libraries</button>';

    if (!selectedBook) {
        html += '<div class="rpg-lb-placeholder"><i class="fa-solid fa-arrow-left"></i><p>Select a lorebook</p></div>';
        html += '</section>';
        return html;
    }

    const w = escapeHtml(selectedBook);
    const isBookActive = lorebookAPI.isWorldActive(selectedBook);

    // Header
    html += '<div class="rpg-lb-panel-header">';
    html += `<h4 class="rpg-lb-panel-title"><i class="fa-solid fa-book"></i> ${w}</h4>`;
    html += '<div class="rpg-lb-panel-header-actions">';
    html += `<button class="rpg-lb-spine-export" data-world="${w}" title="Export"><i class="fa-solid fa-file-export"></i></button>`;
    html += `<button class="rpg-lb-spine-delete" data-world="${w}" title="Delete"><i class="fa-solid fa-trash"></i></button>`;
    html += '</div></div>';

    // Inactive banner
    if (!isBookActive) {
        html += '<div class="rpg-lb-inactive-banner"><i class="fa-solid fa-eye-slash"></i> Book is deactivated — entries won\'t be scanned</div>';
    }

    // Sort dropdown
    html += '<div class="rpg-lb-panel-toolbar">';
    html += '<select class="rpg-lb-entry-sort" title="Sort entries"><option value="order">By Order</option><option value="title">By Title</option><option value="tokens">By Tokens</option><option value="status">By Status</option></select>';
    html += '</div>';

    // Entry list (placeholder — populated asynchronously)
    html += `<div class="rpg-lb-entry-list ${!isBookActive ? 'book-inactive' : ''}" data-world="${w}">`;
    html += '<div class="rpg-lb-loading"><i class="fa-solid fa-spinner fa-spin"></i> Loading entries...</div>';
    html += '</div>';

    // Add entry button
    html += `<div class="rpg-lb-panel-actions"><button class="rpg-lb-btn-add-entry" data-world="${w}"><i class="fa-solid fa-plus"></i> New Entry</button></div>`;

    html += '</section>';

    // Trigger async entry loading
    setTimeout(() => loadMiddlePanelEntries(selectedBook), 0);

    return html;
}

async function loadMiddlePanelEntries(worldName) {
    const container = document.querySelector(`.rpg-lb-entry-list[data-world="${CSS.escape(worldName)}"]`);
    if (!container) return;

    const data = await lorebookAPI.loadWorldData(worldName);
    if (!data) {
        container.innerHTML = '<div class="rpg-lb-placeholder"><p>Failed to load</p></div>';
        return;
    }

    middlePanelData = data;
    middlePanelEntries = lorebookAPI.getEntriesSorted(data);

    let html = '';
    for (const { uid, entry } of middlePanelEntries) {
        html += buildEntryRowHtml(worldName, uid, entry);
    }

    if (middlePanelEntries.length === 0) {
        html = '<div class="rpg-lb-placeholder"><p>No entries yet</p></div>';
    }

    container.innerHTML = html;

    // Update book badge in left panel
    const bookEl = document.querySelector(`.rpg-lb-tree-book[data-world="${CSS.escape(worldName)}"] .rpg-lb-tree-book-badge`);
    if (bookEl) bookEl.textContent = `${middlePanelEntries.length}`;
}

function buildEntryRowHtml(worldName, uid, entry) {
    const w = escapeHtml(worldName);
    const isEnabled = !entry.disable;
    const titleText = entry.comment || `Entry ${uid}`;
    const tokEst = Math.round((entry.content?.length || 0) / 3.5);
    const isSelected = selectedEntry && selectedEntry.world === worldName && selectedEntry.uid === uid;

    // State emoji
    let stateEmoji = '🟢';
    if (entry.constant) stateEmoji = '🔵';
    else if (entry.vectorized) stateEmoji = '🔗';

    let html = `<div class="rpg-lb-entry-row ${isSelected ? 'selected' : ''} ${isEnabled ? '' : 'disabled'}" data-world="${w}" data-uid="${uid}">`;
    html += `<div class="rpg-lb-toggle ${isEnabled ? 'active' : ''}" data-type="entry" data-world="${w}" data-uid="${uid}"></div>`;
    html += `<span class="rpg-lb-entry-row-state">${stateEmoji}</span>`;
    html += `<span class="rpg-lb-entry-row-title">${escapeHtml(titleText)}</span>`;
    html += `<span class="rpg-lb-entry-row-meta">${tokEst}t</span>`;
    html += `<span class="rpg-lb-entry-row-pos">${posBadgeMap[entry.position] ?? '↑Char'}${entry.position == 4 ? 'd' + (entry.depth ?? 4) : ''}</span>`;
    html += '</div>';
    return html;
}

// ─── Right Panel (Entry Editor) ──────────────────────────────────────────────

function renderRightPanel() {
    let html = '<main class="rpg-lb-panel-right">';

    // Mobile back button
    html += `<button class="rpg-lb-mobile-back" data-target="middle"><i class="fa-solid fa-chevron-left"></i> ${selectedBook ? escapeHtml(selectedBook) : 'Entries'}</button>`;

    if (!selectedEntry) {
        html += '<div class="rpg-lb-placeholder"><i class="fa-solid fa-pen-to-square"></i><p>Select an entry to edit</p></div>';
        html += '</main>';
        return html;
    }

    // Find the entry data
    const entry = findSelectedEntry();
    if (!entry) {
        html += '<div class="rpg-lb-placeholder"><p>Entry not found</p></div>';
        html += '</main>';
        return html;
    }

    html += buildEditorHtml(selectedEntry.world, selectedEntry.uid, entry, false);
    html += '</main>';

    return html;
}

function renderExpandedEditor() {
    const entry = findSelectedEntry();
    if (!entry) return '<div class="rpg-lb-placeholder"><p>Entry not found</p></div>';

    const campaign = campaignManager.getCampaignForBook(selectedEntry.world);
    const campaignName = campaign ? campaign.campaign.name : 'Unfiled';

    let html = '<div class="rpg-lb-expanded-layout">';
    // Breadcrumb
    html += '<div class="rpg-lb-breadcrumb">';
    html += '<button class="rpg-lb-breadcrumb-back" title="Back to list"><i class="fa-solid fa-arrow-left"></i></button>';
    html += `<span class="rpg-lb-breadcrumb-text">`;
    html += `<span class="rpg-lb-breadcrumb-part">${escapeHtml(campaignName)}</span>`;
    html += `<i class="fa-solid fa-chevron-right"></i>`;
    html += `<span class="rpg-lb-breadcrumb-part">${escapeHtml(selectedEntry.world)}</span>`;
    html += `<i class="fa-solid fa-chevron-right"></i>`;
    html += `<span class="rpg-lb-breadcrumb-part">${escapeHtml(entry.comment || `Entry ${selectedEntry.uid}`)}</span>`;
    html += '</span></div>';

    html += '<div class="rpg-lb-expanded-editor">';
    html += buildEditorHtml(selectedEntry.world, selectedEntry.uid, entry, true);
    html += '</div></div>';

    return html;
}

function findSelectedEntry() {
    if (!selectedEntry) return null;
    // Use cached data if it matches
    if (middlePanelData && selectedEntry.world === selectedBook) {
        const found = middlePanelEntries.find(e => e.uid === selectedEntry.uid);
        if (found) return found.entry;
    }
    return null;
}

/**
 * Builds the full entry editor form HTML.
 * Used by both the right panel and the expanded editor.
 */
function buildEditorHtml(worldName, uid, entry, isExpanded) {
    const w = escapeHtml(worldName);
    const tokEst = Math.round((entry.content?.length || 0) / 3.5);

    let html = '<div class="rpg-lb-editor" data-world="' + w + '" data-uid="' + uid + '">';

    // Header with title + expand/collapse button
    html += '<div class="rpg-lb-editor-header">';
    html += `<span class="rpg-lb-editor-title"><i class="fa-solid fa-scroll"></i> ${escapeHtml(entry.comment || `Entry ${uid}`)}</span>`;
    if (!isExpanded) {
        html += '<button class="rpg-lb-expand-btn" title="Expand to full width"><i class="fa-solid fa-expand"></i></button>';
        html += '<button class="rpg-lb-close-editor-btn" title="Close editor"><i class="fa-solid fa-xmark"></i></button>';
    }
    html += '</div>';

    // Status selector
    html += '<div class="rpg-lb-editor-status">';
    html += `<select class="rpg-lb-state-select" data-world="${w}" data-uid="${uid}" data-field="entryState" title="Entry Status">`;
    html += `<option value="normal" ${!entry.constant && !entry.vectorized ? 'selected' : ''}>🟢 Normal</option>`;
    html += `<option value="constant" ${entry.constant ? 'selected' : ''}>🔵 Constant</option>`;
    html += `<option value="vectorized" ${entry.vectorized ? 'selected' : ''}>🔗 Vectorized</option>`;
    html += `</select></div>`;

    // Title / Memo + UID
    html += '<div class="rpg-lb-form-section"><div class="rpg-lb-form-row">';
    html += `<div class="rpg-lb-field-group"><div class="rpg-lb-field-label"><i class="fa-solid fa-tag"></i> Title / Memo</div><input class="rpg-lb-input" type="text" value="${escapeHtml(entry.comment || '')}" data-world="${w}" data-uid="${uid}" data-field="comment"></div>`;
    html += `<div class="rpg-lb-field-group sm"><div class="rpg-lb-field-label"><i class="fa-solid fa-fingerprint"></i> UID</div><input class="rpg-lb-input" type="text" value="${uid}" disabled style="opacity:0.5;text-align:center;"></div>`;
    html += '</div></div>';

    // Position + Depth
    const posVal = entry.position ?? 0;
    const roleVal = entry.role ?? 0;
    html += '<div class="rpg-lb-form-section"><div class="rpg-lb-form-row">';
    html += `<div class="rpg-lb-field-group md"><div class="rpg-lb-field-label"><i class="fa-solid fa-location-dot"></i> Position</div>`;
    html += `<select class="rpg-lb-select rpg-lb-position-select" data-world="${w}" data-uid="${uid}" data-field="position">`;
    html += `<option value="0" data-role="" ${posVal == 0 ? 'selected' : ''}>↑Char — Before Char Defs</option>`;
    html += `<option value="1" data-role="" ${posVal == 1 ? 'selected' : ''}>↓Char — After Char Defs</option>`;
    html += `<option value="2" data-role="" ${posVal == 2 ? 'selected' : ''}>↑AN — Before Author's Note</option>`;
    html += `<option value="3" data-role="" ${posVal == 3 ? 'selected' : ''}>↓AN — After Author's Note</option>`;
    html += `<option value="4" data-role="0" ${posVal == 4 && roleVal == 0 ? 'selected' : ''}>@D ⚙️ — At Depth (System)</option>`;
    html += `<option value="4" data-role="1" ${posVal == 4 && roleVal == 1 ? 'selected' : ''}>@D 👤 — At Depth (User)</option>`;
    html += `<option value="4" data-role="2" ${posVal == 4 && roleVal == 2 ? 'selected' : ''}>@D 🤖 — At Depth (Assistant)</option>`;
    html += `<option value="5" data-role="" ${posVal == 5 ? 'selected' : ''}>↑EM — Before Examples</option>`;
    html += `<option value="6" data-role="" ${posVal == 6 ? 'selected' : ''}>↓EM — After Examples</option>`;
    html += `<option value="7" data-role="" ${posVal == 7 ? 'selected' : ''}>➡️ Outlet</option>`;
    html += '</select></div>';
    html += `<div class="rpg-lb-field-group sm"><div class="rpg-lb-field-label"><i class="fa-solid fa-layer-group"></i> Depth</div><input class="rpg-lb-input rpg-lb-number" type="number" value="${entry.depth ?? 4}" data-world="${w}" data-uid="${uid}" data-field="depth"></div>`;
    html += '</div>';
    // Outlet Name
    html += `<div class="rpg-lb-form-row rpg-lb-outlet-row" ${posVal != 7 ? 'style="display:none;"' : ''}>`;
    html += `<div class="rpg-lb-field-group"><div class="rpg-lb-field-label"><i class="fa-solid fa-plug"></i> Outlet Name</div>`;
    html += `<input class="rpg-lb-input" type="text" value="${escapeHtml(entry.outletName || '')}" data-world="${w}" data-uid="${uid}" data-field="outletName" placeholder="Outlet Name"></div>`;
    html += '</div></div>';

    // Keywords card
    html += '<div class="rpg-lb-keywords-card">';
    html += '<div class="rpg-lb-kw-section"><div class="rpg-lb-kw-section-header"><div class="rpg-lb-field-label"><i class="fa-solid fa-key"></i> Primary Keywords</div></div>';
    html += `<textarea class="rpg-lb-input rpg-lb-kw-textarea" data-world="${w}" data-uid="${uid}" data-field="key" rows="2" placeholder="Comma-separated keywords">${(entry.key || []).join(', ')}</textarea></div>`;
    html += '<div class="rpg-lb-kw-section"><div class="rpg-lb-kw-section-header"><div class="rpg-lb-field-label"><i class="fa-solid fa-key"></i> Secondary Keywords</div>';
    html += `<select class="rpg-lb-kw-logic-select" data-world="${w}" data-uid="${uid}" data-field="selectiveLogic">`;
    html += `<option value="0" ${entry.selectiveLogic == 0 ? 'selected' : ''}>AND ANY</option>`;
    html += `<option value="1" ${entry.selectiveLogic == 1 ? 'selected' : ''}>AND ALL</option>`;
    html += `<option value="2" ${entry.selectiveLogic == 2 ? 'selected' : ''}>NOT ALL</option>`;
    html += `<option value="3" ${entry.selectiveLogic == 3 ? 'selected' : ''}>NOT ANY</option>`;
    html += '</select></div>';
    html += `<textarea class="rpg-lb-input rpg-lb-kw-textarea secondary" data-world="${w}" data-uid="${uid}" data-field="keysecondary" rows="2" placeholder="Comma-separated secondary keywords">${(entry.keysecondary || []).join(', ')}</textarea></div>`;
    html += '</div>';

    // Content
    html += '<div class="rpg-lb-form-section"><div class="rpg-lb-field-label"><i class="fa-solid fa-align-left"></i> Content</div>';
    html += `<textarea class="rpg-lb-textarea" data-world="${w}" data-uid="${uid}" data-field="content" rows="${isExpanded ? 10 : 5}">${escapeHtml(entry.content || '')}</textarea>`;
    html += '<div class="rpg-lb-content-footer">';
    html += `<span class="rpg-lb-token-count"><i class="fa-solid fa-coins"></i> ~${tokEst} tokens</span>`;
    html += `<label class="rpg-lb-wi-checkbox"><input type="checkbox" ${entry.selective ? 'checked' : ''} data-world="${w}" data-uid="${uid}" data-field="selective"><span class="rpg-lb-check-box"><i class="fa-solid fa-check"></i></span> Selective</label>`;
    html += '</div></div>';

    // Order / Trigger% / Scan Depth / Inclusion Group
    html += '<div class="rpg-lb-form-section"><div class="rpg-lb-form-row">';
    html += `<div class="rpg-lb-field-group sm"><div class="rpg-lb-field-label"><i class="fa-solid fa-sort-numeric-up"></i> Order</div><input class="rpg-lb-input rpg-lb-number" type="number" value="${entry.order ?? 100}" data-world="${w}" data-uid="${uid}" data-field="order"></div>`;
    html += `<div class="rpg-lb-field-group sm"><div class="rpg-lb-field-label"><i class="fa-solid fa-percent"></i> Trigger %</div><input class="rpg-lb-input rpg-lb-number" type="number" value="${entry.probability ?? 100}" data-world="${w}" data-uid="${uid}" data-field="probability"></div>`;
    html += `<div class="rpg-lb-field-group sm"><div class="rpg-lb-field-label"><i class="fa-solid fa-magnifying-glass"></i> Scan Depth</div><input class="rpg-lb-input rpg-lb-number" type="number" value="${entry.scanDepth ?? ''}" placeholder="Global" data-world="${w}" data-uid="${uid}" data-field="scanDepth"></div>`;
    html += `<div class="rpg-lb-field-group"><div class="rpg-lb-field-label"><i class="fa-solid fa-object-group"></i> Inclusion Group</div><input class="rpg-lb-input" type="text" value="${escapeHtml(entry.group || '')}" placeholder="Group label" data-world="${w}" data-uid="${uid}" data-field="group"></div>`;
    html += '</div></div>';

    // Advanced Options (collapsible)
    html += '<div class="rpg-lb-section-divider collapsed"><i class="fa-solid fa-sliders"></i> Advanced Options <i class="fa-solid fa-chevron-down rpg-lb-section-toggle"></i></div>';
    html += '<div class="rpg-lb-collapsible-section" style="display:none;">';

    html += '<div class="rpg-lb-form-row">';
    html += buildTriStateSelect(w, uid, 'caseSensitive', 'Case Sensitive', entry.caseSensitive);
    html += buildTriStateSelect(w, uid, 'matchWholeWords', 'Match Whole Words', entry.matchWholeWords);
    html += buildTriStateSelect(w, uid, 'useGroupScoring', 'Group Scoring', entry.useGroupScoring);
    html += '</div>';

    html += '<div class="rpg-lb-form-row">';
    html += `<div class="rpg-lb-field-group sm"><div class="rpg-lb-field-label">Group Weight</div><input class="rpg-lb-input rpg-lb-number" type="number" value="${entry.groupWeight ?? 100}" data-world="${w}" data-uid="${uid}" data-field="groupWeight"></div>`;
    html += `<div class="rpg-lb-field-group" style="display:flex;align-items:flex-end;padding-bottom:2px;"><label class="rpg-lb-wi-checkbox"><input type="checkbox" ${entry.groupOverride ? 'checked' : ''} data-world="${w}" data-uid="${uid}" data-field="groupOverride"><span class="rpg-lb-check-box"><i class="fa-solid fa-check"></i></span> Prioritize in group</label></div>`;
    html += '</div>';

    html += '<div class="rpg-lb-form-row">';
    html += `<div class="rpg-lb-field-group sm"><div class="rpg-lb-field-label"><i class="fa-solid fa-thumbtack"></i> Sticky</div><input class="rpg-lb-input rpg-lb-number" type="number" value="${entry.sticky ?? ''}" placeholder="Off" data-world="${w}" data-uid="${uid}" data-field="sticky"></div>`;
    html += `<div class="rpg-lb-field-group sm"><div class="rpg-lb-field-label"><i class="fa-solid fa-clock"></i> Cooldown</div><input class="rpg-lb-input rpg-lb-number" type="number" value="${entry.cooldown ?? ''}" placeholder="Off" data-world="${w}" data-uid="${uid}" data-field="cooldown"></div>`;
    html += `<div class="rpg-lb-field-group sm"><div class="rpg-lb-field-label"><i class="fa-solid fa-hourglass-start"></i> Delay</div><input class="rpg-lb-input rpg-lb-number" type="number" value="${entry.delay ?? ''}" placeholder="Off" data-world="${w}" data-uid="${uid}" data-field="delay"></div>`;
    html += `<div class="rpg-lb-field-group sm"><div class="rpg-lb-field-label"><i class="fa-solid fa-repeat"></i> Recursion Lv</div><input class="rpg-lb-input rpg-lb-number" type="number" value="${entry.delayUntilRecursion ?? 0}" data-world="${w}" data-uid="${uid}" data-field="delayUntilRecursion"></div>`;
    html += '</div>';

    html += '<div class="rpg-lb-wi-checkbox-row">';
    html += buildCheckbox(w, uid, 'excludeRecursion', 'Non-recursable', entry.excludeRecursion);
    html += buildCheckbox(w, uid, 'preventRecursion', 'Prevent recursion', entry.preventRecursion);
    html += buildCheckbox(w, uid, 'ignoreBudget', 'Ignore budget', entry.ignoreBudget);
    html += buildCheckbox(w, uid, 'useProbability', 'Use probability', entry.useProbability !== false);
    html += buildCheckbox(w, uid, 'constant', 'Constant', entry.constant);
    html += '</div>';

    html += '<div class="rpg-lb-form-row">';
    html += `<div class="rpg-lb-field-group"><div class="rpg-lb-field-label"><i class="fa-solid fa-bolt"></i> Automation ID</div><input class="rpg-lb-input" type="text" value="${escapeHtml(entry.automationId || '')}" placeholder="( None )" data-world="${w}" data-uid="${uid}" data-field="automationId"></div>`;
    html += '</div>';

    html += '</div>'; // collapsible-section

    // Action buttons
    html += '<div class="rpg-lb-editor-actions">';
    html += `<button class="rpg-lb-entry-action-btn rpg-lb-entry-delete" data-world="${w}" data-uid="${uid}" title="Delete"><i class="fa-solid fa-trash"></i> Delete</button>`;
    html += '</div>';

    html += '</div>'; // rpg-lb-editor
    return html;
}

function buildTriStateSelect(w, uid, field, label, value) {
    return `<div class="rpg-lb-field-group md"><div class="rpg-lb-field-label">${label}</div><select class="rpg-lb-select" data-world="${w}" data-uid="${uid}" data-field="${field}"><option value="null" ${value === null || value === undefined ? 'selected' : ''}>Use global</option><option value="true" ${value === true ? 'selected' : ''}>Yes</option><option value="false" ${value === false ? 'selected' : ''}>No</option></select></div>`;
}

function buildCheckbox(w, uid, field, label, checked) {
    return `<label class="rpg-lb-wi-checkbox"><input type="checkbox" ${checked ? 'checked' : ''} data-world="${w}" data-uid="${uid}" data-field="${field}"><span class="rpg-lb-check-box"><i class="fa-solid fa-check"></i></span> ${label}</label>`;
}

// ─── Footer ──────────────────────────────────────────────────────────────────

function renderFooter() {
    const footer = document.querySelector('#rpg-lorebook-modal .rpg-lb-modal-footer');
    if (!footer) return;

    const allNames = lorebookAPI.getAllWorldNames();
    const activeNames = lorebookAPI.getActiveWorldNames();
    const gs = lorebookAPI.getGlobalWISettings();
    const budgetCap = gs.world_info_budget_cap || 0;

    // Count total entries across active books (estimate)
    let totalEntries = 0;
    for (const entry of middlePanelEntries) {
        totalEntries++;
    }

    let html = '<div class="rpg-lb-footer-left">';
    html += `<span class="rpg-lb-footer-dot"></span>`;
    html += `<span class="rpg-lb-footer-stat">Active: ${activeNames.length} Lorebooks</span>`;
    html += `<span class="rpg-lb-footer-stat">Total: ${allNames.length} Lorebooks</span>`;
    html += '</div>';

    html += '<div class="rpg-lb-footer-right">';
    if (budgetCap > 0) {
        // Estimate context load — rough approximation
        html += `<span class="rpg-lb-footer-stat">Budget Cap: ${budgetCap} tokens</span>`;
        html += '<div class="rpg-lb-context-bar"><div class="rpg-lb-context-fill" style="width: 0%"></div></div>';
    }
    html += '</div>';

    footer.innerHTML = html;
}

// ─── Filter Functions ────────────────────────────────────────────────────────

function applyStatusFilter(container, filter) {
    if (filter === 'all') {
        // Show all campaign groups too
        container.querySelectorAll('.rpg-lb-campaign-group').forEach(g => g.style.display = '');
        return;
    }
    const books = container.querySelectorAll('.rpg-lb-tree-book');
    for (const book of books) {
        const isActive = book.classList.contains('active-book');
        if (filter === 'active') {
            book.style.display = isActive ? '' : 'none';
        } else if (filter === 'inactive') {
            book.style.display = isActive ? 'none' : '';
        }
    }
    // Hide campaign groups where all books are now hidden
    container.querySelectorAll('.rpg-lb-campaign-group').forEach(group => {
        const visibleBooks = group.querySelectorAll('.rpg-lb-tree-book:not([style*="display: none"])');
        group.style.display = visibleBooks.length === 0 ? 'none' : '';
    });
}

function applySearchFilter(container, query) {
    const books = container.querySelectorAll('.rpg-lb-tree-book');
    for (const book of books) {
        const name = (book.dataset.world || '').toLowerCase();
        if (!name.includes(query)) {
            book.style.display = 'none';
        }
    }
}

// ─── State Sync Helpers ──────────────────────────────────────────────────────

function syncAllBookToggleStates() {
    const $modal = $('#rpg-lorebook-modal');
    // V2 desktop layout
    $modal.find('.rpg-lb-tree-book').each(function () {
        const $book = $(this);
        const worldName = $book.data('world');
        const isActive = lorebookAPI.isWorldActive(worldName);
        $book.find('.rpg-lb-toggle[data-type="book"]').toggleClass('active', isActive);
        $book.toggleClass('active-book', isActive).toggleClass('inactive', !isActive);
    });
    // Mobile layout (main branch spine elements)
    $modal.find('.rpg-lb-book-spine').each(function () {
        const $spine = $(this);
        const worldName = $spine.data('world');
        const isActive = lorebookAPI.isWorldActive(worldName);
        $spine.find('.rpg-lb-toggle[data-type="book"]').toggleClass('active', isActive);
        $spine.toggleClass('active-book', isActive).toggleClass('inactive', !isActive);
    });
}

function refreshActiveStats() {
    const $modal = $('#rpg-lorebook-modal');
    const activeNames = lorebookAPI.getActiveWorldNames();

    $modal.find('.rpg-lb-campaign-group').each(function () {
        const $group = $(this);
        const campaignId = $group.data('campaign');
        const $statsSpan = $group.find('.rpg-lb-campaign-stats').first();
        const books = $group.find('.rpg-lb-tree-book, .rpg-lb-book-spine');
        let groupActive = 0;
        books.each(function () {
            if (activeNames.includes($(this).data('world'))) groupActive++;
        });
        if (campaignId === 'unfiled') {
            $statsSpan.text(`${books.length}`);
        } else {
            $statsSpan.text(`${groupActive}/${books.length}`);
        }
    });

    renderFooter();
}

function refreshCampaignToggles() {
    const $modal = $('#rpg-lorebook-modal');
    const activeNames = lorebookAPI.getActiveWorldNames();
    const allNames = lorebookAPI.getAllWorldNames();

    $modal.find('.rpg-lb-campaign-toggle').each(function () {
        const $toggle = $(this);
        const $group = $toggle.closest('.rpg-lb-campaign-group');
        const $books = $group.find('.rpg-lb-tree-book, .rpg-lb-book-spine');
        if ($books.length === 0) { $toggle.removeClass('active'); return; }
        let allActive = true;
        $books.each(function () {
            if (!activeNames.includes($(this).data('world'))) { allActive = false; return false; }
        });
        $toggle.toggleClass('active', allActive);
    });

}

// ─── Mobile Panel Navigation ─────────────────────────────────────────────────

function isMobileView() {
    // Detect actual mobile devices — not just narrow desktop windows.
    // The modal is full-screen, so desktop should always get the v2 three-panel layout.
    const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    const isSmallScreen = window.matchMedia('(max-width: 1024px)').matches;
    const isMobileUA = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
    return (isTouch && isSmallScreen) || isMobileUA;
}

function setMobilePanel(panel) {
    const layout = document.querySelector('.rpg-lb-list-layout');
    if (layout) layout.dataset.mobilePanel = panel;
}

// ─── Targeted Panel Updates ──────────────────────────────────────────────────

function updateMiddlePanel() {
    const container = document.querySelector('.rpg-lb-panel-middle');
    if (!container) return;
    const parent = container.parentElement;
    if (!parent) return;
    const newHtml = renderMiddlePanel();
    const temp = document.createElement('div');
    temp.innerHTML = newHtml;
    parent.replaceChild(temp.firstElementChild, container);
}

function updateRightPanel() {
    const container = document.querySelector('.rpg-lb-panel-right');
    if (!container) return;
    const parent = container.parentElement;
    if (!parent) return;
    const newHtml = renderRightPanel();
    const temp = document.createElement('div');
    temp.innerHTML = newHtml;
    parent.replaceChild(temp.firstElementChild, container);
    // Update layout attribute so CSS can show/hide editor panel
    const layout = document.querySelector('.rpg-lb-list-layout');
    if (layout) layout.dataset.hasEditor = selectedEntry ? 'true' : 'false';
}

// ─── Event Delegation ────────────────────────────────────────────────────────

export function initLorebookEventDelegation() {
    const $modal = $('#rpg-lorebook-modal');
    if (!$modal.length) return;

    // Initialize mobile event handlers (main branch selectors — no conflict with v2)
    initMobileLorebookEventDelegation();

    // ── Close ────────────────────────────────────────────────────────────────
    $modal.on('click', '.rpg-lb-close', function () {
        const modal = getLorebookModal();
        if (modal) modal.close();
    });

    $modal.on('click', function (e) {
        if (e.target === $modal[0]) {
            const modal = getLorebookModal();
            if (modal) modal.close();
        }
    });

    $(document).on('keydown.rpgLorebook', function (e) {
        if (e.key === 'Escape') {
            const modal = getLorebookModal();
            if (modal && modal.isOpen()) {
                if (expandedEditor) {
                    expandedEditor = false;
                    renderLorebook();
                    e.stopImmediatePropagation();
                } else {
                    modal.close();
                    e.stopImmediatePropagation();
                }
            }
        }
    });

    // ── Book selection (left panel) ──────────────────────────────────────────
    $modal.on('click', '.rpg-lb-tree-book', function (e) {
        if ($(e.target).closest('.rpg-lb-toggle').length) return;
        const worldName = $(this).data('world');
        selectedBook = worldName;
        selectedEntry = null;
        expandedEditor = false;
        // Highlight in left panel
        $modal.find('.rpg-lb-tree-book').removeClass('selected');
        $(this).addClass('selected');
        updateMiddlePanel();
        updateRightPanel();
        // Mobile: drill into middle panel
        if (isMobileView()) setMobilePanel('middle');
    });

    // ── Context Menu (right-click) ───────────────────────────────────────────
    function showContextMenu(e, items) {
        e.preventDefault();
        e.stopPropagation();
        // Remove any existing context menu
        $('.rpg-lb-context-menu').remove();
        const $menu = $('<div class="rpg-lb-context-menu"></div>');

        function populateMenu(menuItems, isSubmenu) {
            $menu.empty();
            if (isSubmenu) {
                const $back = $(`<div class="rpg-lb-context-menu-item rpg-lb-context-menu-back"><i class="fa-solid fa-chevron-left"></i> Back</div>`);
                $back.on('click', (ev) => { ev.stopPropagation(); populateMenu(items, false); });
                $menu.append($back);
                $menu.append('<div class="rpg-lb-context-menu-sep"></div>');
            }
            for (const item of menuItems) {
                if (item.separator) {
                    $menu.append('<div class="rpg-lb-context-menu-sep"></div>');
                    continue;
                }
                const dangerClass = item.danger ? ' rpg-lb-context-menu-danger' : '';
                const arrowHint = item.submenu ? '<i class="fa-solid fa-chevron-right" style="margin-left:auto;opacity:0.4;font-size:0.75em;"></i>' : '';
                const $item = $(`<div class="rpg-lb-context-menu-item${dangerClass}"><i class="${item.icon}"></i> ${item.label}${arrowHint}</div>`);
                $item.on('click', (ev) => {
                    ev.stopPropagation();
                    if (item.submenu) {
                        // submenu action returns sub-items array
                        const subItems = item.action();
                        populateMenu(subItems, true);
                    } else {
                        $('.rpg-lb-context-menu').remove();
                        item.action();
                    }
                });
                $menu.append($item);
            }
        }

        populateMenu(items, false);
        // Position but keep on screen
        $menu.css({ top: Math.min(e.clientY, window.innerHeight - 200), left: Math.min(e.clientX, window.innerWidth - 180) });
        $('body').append($menu);
        // Close on click outside
        setTimeout(() => $(document).one('click', () => $('.rpg-lb-context-menu').remove()), 0);
    }

    // Right-click on campaign header
    $modal.on('contextmenu', '.rpg-lb-campaign-header', function (e) {
        const campaignId = $(this).data('campaign');
        if (campaignId === '__unfiled__') return; // Can't rename Unfiled
        showContextMenu(e, [
            {
                icon: 'fa-solid fa-pen',
                label: 'Rename',
                action: () => {
                    const currentName = $(this).find('.rpg-lb-campaign-name').text();
                    const newName = prompt('Rename campaign:', currentName);
                    if (newName && newName.trim() && newName.trim() !== currentName) {
                        campaignManager.renameCampaign(campaignId, newName.trim());
                        saveSettings();
                        renderLorebook();
                    }
                },
            },
        ]);
    });

    // Right-click on book
    $modal.on('contextmenu', '.rpg-lb-tree-book', function (e) {
        const worldName = $(this).data('world');
        const currentCampaign = campaignManager.getCampaignForBook(worldName);
        const campaigns = campaignManager.getCampaignsInOrder();

        const menuItems = [
            {
                icon: 'fa-solid fa-pen',
                label: 'Rename',
                action: async () => {
                    const newName = prompt('Rename lorebook:', worldName);
                    if (newName && newName.trim() && newName.trim() !== worldName) {
                        const trimmed = newName.trim();
                        try {
                            // Update campaign assignment (swap old name for new)
                            if (currentCampaign) {
                                campaignManager.removeBookFromCampaign(currentCampaign.id, worldName);
                                campaignManager.addBookToCampaign(currentCampaign.id, trimmed);
                            }
                            await lorebookAPI.renameWorld(worldName, trimmed);
                            if (selectedBook === worldName) selectedBook = trimmed;
                            saveSettings();
                            renderLorebook();
                        } catch (err) {
                            console.error('[LoreLibrary] Rename failed:', err);
                            alert('Rename failed: ' + err.message);
                        }
                    }
                },
            },
            {
                icon: 'fa-solid fa-arrows-up-down-left-right',
                label: 'Move to...',
                submenu: true,
                action: () => {
                    // Return submenu items for all campaigns + Unfiled
                    const subItems = [];
                    for (const { id, campaign } of campaigns) {
                        if (currentCampaign && currentCampaign.id === id) continue;
                        subItems.push({
                            icon: 'fa-solid fa-folder',
                            label: campaign.name,
                            action: () => {
                                campaignManager.moveBookBetweenCampaigns(
                                    currentCampaign ? currentCampaign.id : null,
                                    id,
                                    worldName,
                                );
                                saveSettings();
                                renderLorebook();
                            },
                        });
                    }
                    if (currentCampaign) {
                        subItems.push({
                            icon: 'fa-solid fa-folder-minus',
                            label: 'Unfiled',
                            action: () => {
                                campaignManager.removeBookFromCampaign(currentCampaign.id, worldName);
                                saveSettings();
                                renderLorebook();
                            },
                        });
                    }
                    return subItems;
                },
            },
            { separator: true },
            {
                icon: 'fa-solid fa-trash',
                label: 'Delete',
                danger: true,
                action: async () => {
                    if (!confirm(`Delete "${worldName}"? This cannot be undone.`)) return;
                    try {
                        // Remove from campaign first
                        if (currentCampaign) {
                            campaignManager.removeBookFromCampaign(currentCampaign.id, worldName);
                        }
                        await lorebookAPI.deleteWorld(worldName);
                        if (selectedBook === worldName) {
                            selectedBook = null;
                            selectedEntry = null;
                        }
                        saveSettings();
                        renderLorebook();
                    } catch (err) {
                        console.error('[LoreLibrary] Delete failed:', err);
                        alert('Delete failed: ' + err.message);
                    }
                },
            },
        ];

        showContextMenu(e, menuItems);
    });

    // ── Entry context menu (right-click) ────────────────────────────────────
    $modal.on('contextmenu', '.rpg-lb-entry-row', function (e) {
        const worldName = $(this).data('world');
        const uid = Number($(this).data('uid'));
        const allBooks = lorebookAPI.getAllWorldNames().filter(n => n !== worldName);

        const menuItems = [
            {
                icon: 'fa-solid fa-copy',
                label: 'Duplicate',
                action: async () => {
                    try {
                        const data = await lorebookAPI.loadWorldData(worldName);
                        if (!data) return;
                        const source = data.entries[uid];
                        if (!source) return;
                        const newEntry = lorebookAPI.createEntry(worldName, data);
                        // Copy fields from source
                        const copyFields = ['key', 'keysecondary', 'comment', 'content', 'position', 'depth',
                            'order', 'disable', 'selectiveLogic', 'constant', 'group', 'groupOverride',
                            'groupWeight', 'scanDepth', 'caseSensitive', 'matchWholeWords', 'automationId',
                            'excludeRecursion', 'preventRecursion', 'delayUntilRecursion', 'probability',
                            'useProbability', 'sticky', 'cooldown', 'delay', 'role', 'vectorized'];
                        for (const field of copyFields) {
                            if (source[field] !== undefined) newEntry[field] = JSON.parse(JSON.stringify(source[field]));
                        }
                        newEntry.comment = (source.comment || '') + ' (Copy)';
                        await lorebookAPI.saveWorldData(worldName, data);
                        updateMiddlePanel();
                    } catch (err) {
                        console.error('[LoreLibrary] Duplicate failed:', err);
                    }
                },
            },
            {
                icon: 'fa-solid fa-arrow-right-arrow-left',
                label: 'Move to...',
                submenu: true,
                action: () => {
                    return allBooks.map(bookName => ({
                        icon: 'fa-solid fa-book',
                        label: bookName,
                        action: async () => {
                            try {
                                const sourceData = await lorebookAPI.loadWorldData(worldName, true);
                                const targetData = await lorebookAPI.loadWorldData(bookName, true);
                                if (!sourceData || !targetData) return;
                                const source = sourceData.entries[uid];
                                if (!source) return;
                                // Create in target
                                const newEntry = lorebookAPI.createEntry(bookName, targetData);
                                const copyFields = ['key', 'keysecondary', 'comment', 'content', 'position', 'depth',
                                    'order', 'disable', 'selectiveLogic', 'constant', 'group', 'groupOverride',
                                    'groupWeight', 'scanDepth', 'caseSensitive', 'matchWholeWords', 'automationId',
                                    'excludeRecursion', 'preventRecursion', 'delayUntilRecursion', 'probability',
                                    'useProbability', 'sticky', 'cooldown', 'delay', 'role', 'vectorized'];
                                for (const field of copyFields) {
                                    if (source[field] !== undefined) newEntry[field] = JSON.parse(JSON.stringify(source[field]));
                                }
                                await lorebookAPI.saveWorldData(bookName, targetData);
                                // Delete from source
                                await lorebookAPI.deleteEntry(sourceData, uid);
                                await lorebookAPI.saveWorldData(worldName, sourceData);
                                if (selectedEntry && selectedEntry.uid === uid) selectedEntry = null;
                                updateMiddlePanel();
                                updateRightPanel();
                            } catch (err) {
                                console.error('[LoreLibrary] Move entry failed:', err);
                                alert('Move failed: ' + err.message);
                            }
                        },
                    }));
                },
            },
            { separator: true },
            {
                icon: 'fa-solid fa-trash',
                label: 'Delete',
                danger: true,
                action: async () => {
                    const data = await lorebookAPI.loadWorldData(worldName, true);
                    if (!data) return;
                    const entry = data.entries[uid];
                    const entryName = entry?.comment || entry?.key?.join(', ') || `Entry ${uid}`;
                    if (!confirm(`Delete "${entryName}"? This cannot be undone.`)) return;
                    try {
                        await lorebookAPI.deleteEntry(data, uid);
                        await lorebookAPI.saveWorldData(worldName, data);
                        if (selectedEntry && selectedEntry.uid === uid) {
                            selectedEntry = null;
                            updateRightPanel();
                        }
                        updateMiddlePanel();
                    } catch (err) {
                        console.error('[LoreLibrary] Delete entry failed:', err);
                    }
                },
            },
        ];

        showContextMenu(e, menuItems);
    });

    // ── Entry selection (middle panel) ───────────────────────────────────────
    $modal.on('click', '.rpg-lb-entry-row', function (e) {
        if ($(e.target).closest('.rpg-lb-toggle').length) return;
        const worldName = $(this).data('world');
        const uid = Number($(this).data('uid'));
        selectedEntry = { world: worldName, uid };
        $modal.find('.rpg-lb-entry-row').removeClass('selected');
        $(this).addClass('selected');
        updateRightPanel();
        // Mobile: drill into editor panel
        if (isMobileView()) setMobilePanel('right');
    });

    // ── Mobile back button ──────────────────────────────────────────────────
    $modal.on('click', '.rpg-lb-mobile-back', function () {
        const target = $(this).data('target');
        setMobilePanel(target);
    });

    // ── Expand editor ────────────────────────────────────────────────────────
    $modal.on('click', '.rpg-lb-expand-btn', function () {
        expandedEditor = true;
        renderLorebook();
    });

    // ── Close editor (deselect entry, expand middle panel) ────────────────────
    $modal.on('click', '.rpg-lb-close-editor-btn', function () {
        selectedEntry = null;
        expandedEditor = false;
        renderLorebook();
    });

    // ── Breadcrumb back ──────────────────────────────────────────────────────
    $modal.on('click', '.rpg-lb-breadcrumb-back', function () {
        expandedEditor = false;
        renderLorebook();
    });

    // ── Campaign header collapse/expand ──────────────────────────────────────
    $modal.on('click', '.rpg-lb-campaign-header', function (e) {
        if ($(e.target).closest('.rpg-lb-campaign-toggle, .rpg-lb-campaign-delete, .rpg-lb-icon-picker').length) return;
        const id = $(this).data('campaign');
        if (!id || id === 'unfiled') {
            $(this).toggleClass('collapsed');
            $(this).next('.rpg-lb-campaign-body').slideToggle(200);
            return;
        }
        campaignManager.toggleCampaignCollapsed(id);
        $(this).toggleClass('collapsed');
        $(this).next('.rpg-lb-campaign-body').slideToggle(200);
    });

    // ── Campaign delete ──────────────────────────────────────────────────────
    $modal.on('click', '.rpg-lb-campaign-delete', function (e) {
        e.stopPropagation();
        const campaignId = $(this).data('campaign');
        const campaign = (extensionSettings.lorebook?.campaigns || {})[campaignId];
        if (!campaign) return;
        if (!confirm(`Delete library "${campaign.name}"? Books inside will become unfiled.`)) return;
        campaignManager.deleteCampaign(campaignId);
        renderLorebook();
    });

    // ── Book toggle (activate/deactivate) ────────────────────────────────────
    $modal.on('click', '.rpg-lb-toggle[data-type="book"]', async function (e) {
        e.stopPropagation();
        const worldName = $(this).data('world');
        if (lorebookAPI.isWorldActive(worldName)) {
            await lorebookAPI.deactivateWorld(worldName);
        } else {
            await lorebookAPI.activateWorld(worldName);
        }
        syncAllBookToggleStates();
        refreshActiveStats();
        refreshCampaignToggles();
        // Refresh middle panel to show/hide inactive banner
        if (selectedBook === worldName) {
            updateMiddlePanel();
        }
    });

    // ── Campaign toggle-all ──────────────────────────────────────────────────
    $modal.on('click', '.rpg-lb-campaign-toggle', async function (e) {
        e.stopPropagation();
        const $group = $(this).closest('.rpg-lb-campaign-group');
        const $books = $group.find('.rpg-lb-tree-book, .rpg-lb-book-spine');
        if ($books.length === 0) return;

        let allActive = true;
        for (const book of $books) {
            if (!lorebookAPI.isWorldActive($(book).data('world'))) { allActive = false; break; }
        }

        for (const book of $books) {
            const wn = $(book).data('world');
            if (allActive) {
                if (lorebookAPI.isWorldActive(wn)) await lorebookAPI.deactivateWorld(wn);
            } else {
                if (!lorebookAPI.isWorldActive(wn)) await lorebookAPI.activateWorld(wn);
            }
        }

        syncAllBookToggleStates();
        refreshActiveStats();
        refreshCampaignToggles();

        // If the currently selected book is in this campaign, refresh its entry list
        if (selectedBook) {
            const bookInGroup = $group.find(`.rpg-lb-tree-book[data-world="${CSS.escape(selectedBook)}"]`).length > 0;
            if (bookInGroup) {
                updateMiddlePanel();
            }
        }
    });

    // ── Entry toggle (enable/disable) ────────────────────────────────────────
    $modal.on('click', '.rpg-lb-toggle[data-type="entry"]', async function (e) {
        e.stopPropagation();
        const $toggle = $(this);
        const worldName = $toggle.data('world');
        const uid = Number($toggle.data('uid'));
        const isActive = $toggle.hasClass('active');

        const data = await lorebookAPI.loadWorldData(worldName);
        if (!data) return;

        lorebookAPI.updateEntryField(data, uid, 'disable', isActive);
        await lorebookAPI.saveWorldData(worldName, data);
        $toggle.toggleClass('active');
        // Update the entry row styling
        $toggle.closest('.rpg-lb-entry-row').toggleClass('disabled', isActive);
    });

    // ── Entry state selector ─────────────────────────────────────────────────
    $modal.on('click', '.rpg-lb-state-select', function (e) {
        e.stopPropagation();
    });

    $modal.on('change', '.rpg-lb-state-select', async function () {
        const $sel = $(this);
        const worldName = $sel.data('world');
        const uid = Number($sel.data('uid'));
        const stateValue = $sel.val();

        const data = await lorebookAPI.loadWorldData(worldName);
        if (!data) return;

        const isConstant = stateValue === 'constant';
        const isVectorized = stateValue === 'vectorized';
        lorebookAPI.updateEntryField(data, uid, 'constant', isConstant);
        lorebookAPI.updateEntryField(data, uid, 'vectorized', isVectorized);
        await lorebookAPI.saveWorldData(worldName, data);

        // Update the entry row in middle panel
        const $row = $modal.find(`.rpg-lb-entry-row[data-world="${CSS.escape(worldName)}"][data-uid="${uid}"] .rpg-lb-entry-row-state`);
        $row.text(isConstant ? '🔵' : isVectorized ? '🔗' : '🟢');
    });

    // ── Filter pills ─────────────────────────────────────────────────────────
    $modal.on('click', '.rpg-lb-fpill', function () {
        const filter = $(this).data('filter');
        $modal.find('.rpg-lb-fpill').removeClass('active');
        $(this).addClass('active');
        campaignManager.setLastFilter(filter);

        const leftPanel = $modal.find('.rpg-lb-panel-left')[0];
        if (leftPanel) {
            leftPanel.querySelectorAll('.rpg-lb-tree-book').forEach(b => b.style.display = '');
            applyStatusFilter(leftPanel, filter);
            const lb = extensionSettings.lorebook || {};
            const search = (lb.lastSearch || '').trim().toLowerCase();
            if (search) applySearchFilter(leftPanel, search);
        }
    });

    // ── Search ───────────────────────────────────────────────────────────────
    $modal.on('input', '.rpg-lb-search', function () {
        const query = $(this).val().trim().toLowerCase();
        campaignManager.setLastSearch(query);
        clearTimeout(searchDebounceTimer);
        searchDebounceTimer = setTimeout(() => saveSettings(), 500);

        const leftPanel = $modal.find('.rpg-lb-panel-left')[0];
        if (!leftPanel) return;
        leftPanel.querySelectorAll('.rpg-lb-tree-book').forEach(b => b.style.display = '');
        const lb = extensionSettings.lorebook || {};
        applyStatusFilter(leftPanel, lb.lastFilter || 'all');
        if (query) applySearchFilter(leftPanel, query);
    });

    // ── Tab-add: New Campaign ────────────────────────────────────────────────
    $modal.on('click', '.rpg-lb-tab-add', function () {
        const name = prompt('Enter a name for the new Lore Library:');
        if (name && name.trim()) {
            campaignManager.createCampaign(name.trim());
            renderLorebook();
        }
    });

    // ── Entry delete ─────────────────────────────────────────────────────────
    $modal.on('click', '.rpg-lb-entry-delete', async function (e) {
        e.stopPropagation();
        const worldName = $(this).data('world');
        const uid = Number($(this).data('uid'));

        if (!confirm(`Delete entry ${uid} from "${worldName}"?`)) return;

        const data = await lorebookAPI.loadWorldData(worldName);
        if (!data) return;

        await lorebookAPI.deleteEntry(data, uid);
        await lorebookAPI.saveWorldData(worldName, data);

        // If we were editing this entry, clear selection
        if (selectedEntry && selectedEntry.world === worldName && selectedEntry.uid === uid) {
            selectedEntry = null;
            expandedEditor = false;
        }

        // Refresh middle panel
        if (selectedBook === worldName) {
            await loadMiddlePanelEntries(worldName);
        }
        updateRightPanel();
    });

    // ── Book delete ──────────────────────────────────────────────────────────
    $modal.on('click', '.rpg-lb-spine-delete', async function (e) {
        e.stopPropagation();
        const worldName = $(this).data('world');
        if (!worldName) return;
        if (!confirm(`Permanently delete lorebook "${worldName}" and all its entries?`)) return;

        try {
            const ownerCampaign = campaignManager.getCampaignForBook(worldName);
            if (ownerCampaign) campaignManager.removeBookFromCampaign(ownerCampaign.id, worldName);
            await lorebookAPI.deleteWorld(worldName);

            if (selectedBook === worldName) {
                selectedBook = null;
                selectedEntry = null;
                expandedEditor = false;
            }
            renderLorebook();
        } catch (err) {
            console.error('[DES] Failed to delete lorebook:', err);
            alert(`Failed to delete lorebook: ${err.message}`);
        }
    });

    // ── Add entry ────────────────────────────────────────────────────────────
    $modal.on('click', '.rpg-lb-btn-add-entry', async function () {
        const worldName = $(this).data('world');
        const data = await lorebookAPI.loadWorldData(worldName);
        if (!data) return;

        const newEntry = lorebookAPI.createEntry(worldName, data);
        if (!newEntry) return;

        lorebookAPI.saveWorldData(worldName, data).catch(err =>
            console.error('[DES] Failed to save after creating entry:', err),
        );

        await loadMiddlePanelEntries(worldName);
    });

    // ── New lorebook ─────────────────────────────────────────────────────────
    $modal.on('click', '.rpg-lb-btn-new-book', async function () {
        const name = prompt('Enter a name for the new lorebook:');
        if (name && name.trim()) {
            await lorebookAPI.createNewWorld(name.trim());
            renderLorebook();
        }
    });

    // ── Import ───────────────────────────────────────────────────────────────
    $modal.on('click', '.rpg-lb-btn-import', function () {
        $modal.find('.rpg-lb-import-file').trigger('click');
    });

    $modal.on('change', '.rpg-lb-import-file', async function (e) {
        const file = e.target.files[0];
        if (!file) return;
        const namesBefore = new Set(lorebookAPI.getAllWorldNames());
        await lorebookAPI.importWorld(file);
        e.target.value = '';
        const namesAfter = lorebookAPI.getAllWorldNames();
        for (const name of namesAfter) {
            if (!namesBefore.has(name) && !lorebookAPI.isWorldActive(name)) {
                await lorebookAPI.activateWorld(name);
            }
        }
        renderLorebook();
    });

    // ── Export ────────────────────────────────────────────────────────────────
    $modal.on('click', '.rpg-lb-spine-export', async function (e) {
        e.stopPropagation();
        const worldName = $(this).data('world');
        await lorebookAPI.exportWorld(worldName);
    });

    // ── Field changes (editor) ───────────────────────────────────────────────
    $modal.on('change', '.rpg-lb-editor input, .rpg-lb-editor select', async function () {
        await handleFieldChange($(this));
    });

    $modal.on('input', '.rpg-lb-editor textarea', async function () {
        const $el = $(this);
        const worldName = $el.data('world');
        const uid = Number($el.data('uid'));
        const field = $el.data('field');

        const data = await lorebookAPI.loadWorldData(worldName);
        if (!data) return;

        const value = parseFieldValue(field, $el.val(), $el);
        lorebookAPI.updateEntryField(data, uid, field, value);
        debouncedSave(worldName, data);

        if (field === 'content') {
            const tokEst = Math.round(($el.val()?.length || 0) / 3.5);
            $el.closest('.rpg-lb-form-section').find('.rpg-lb-token-count').html(
                `<i class="fa-solid fa-coins"></i> ~${tokEst} tokens`,
            );
        }

        // Update title in middle panel if comment field changed
        if (field === 'comment') {
            const $row = $modal.find(`.rpg-lb-entry-row[data-world="${CSS.escape(worldName)}"][data-uid="${uid}"] .rpg-lb-entry-row-title`);
            $row.text($el.val() || `Entry ${uid}`);
        }
    });

    // ── Advanced options toggle ───────────────────────────────────────────────
    $modal.on('click', '.rpg-lb-section-divider', function (e) {
        e.stopPropagation();
        $(this).toggleClass('collapsed');
        $(this).next('.rpg-lb-collapsible-section').slideToggle(200);
    });

    // ── Global WI settings ───────────────────────────────────────────────────
    $modal.on('change', '[data-global]', function () {
        const $el = $(this);
        const key = $el.data('global');
        const isCheckbox = $el.is(':checkbox');
        const value = isCheckbox ? $el.prop('checked') : Number($el.val());
        lorebookAPI.setGlobalWISetting(key, value);
    });

    $modal.on('click', '.rpg-lb-global-settings-header', function () {
        $(this).find('.rpg-lb-global-chevron').toggleClass('rotated');
        $(this).next('.rpg-lb-global-settings-body').slideToggle(200);
    });

    // ── Campaign icon picker ─────────────────────────────────────────────────
    $modal.on('click', '.rpg-lb-campaign-icon[data-campaign]', function (e) {
        e.stopPropagation();
        const $icon = $(this);
        const campaignId = $icon.data('campaign');
        if (!campaignId || campaignId === 'unfiled') return;
        $modal.find('.rpg-lb-icon-picker').remove();
        const campaign = (extensionSettings.lorebook?.campaigns || {})[campaignId];
        if (!campaign) return;
        const pickerHtml = buildIconPickerHtml(campaignId, campaign.icon || 'fa-folder', campaign.color || '');
        const $picker = $(pickerHtml);
        $icon.closest('.rpg-lb-campaign-header').append($picker);
        $picker.hide().fadeIn(150);
    });

    $modal.on('click', '.rpg-lb-icon-option', function (e) {
        e.stopPropagation();
        const $btn = $(this);
        const $picker = $btn.closest('.rpg-lb-icon-picker');
        const campaignId = $picker.data('campaign');
        const newIcon = $btn.data('icon');
        campaignManager.updateCampaignIcon(campaignId, newIcon);
        const $header = $picker.closest('.rpg-lb-campaign-header');
        const $iconEl = $header.find('.rpg-lb-campaign-icon');
        const classes = $iconEl.attr('class').split(/\s+/).filter(c => !c.startsWith('fa-') || c === 'fa-solid');
        classes.push(newIcon, 'rpg-lb-campaign-icon');
        $iconEl.attr('class', classes.join(' '));
        $picker.find('.rpg-lb-icon-option').removeClass('selected');
        $btn.addClass('selected');
        $picker.fadeOut(150, () => $picker.remove());
    });

    $modal.on('click', '.rpg-lb-color-swatch', function (e) {
        e.stopPropagation();
        const $btn = $(this);
        const $picker = $btn.closest('.rpg-lb-icon-picker');
        const campaignId = $picker.data('campaign');
        const newColor = $btn.data('color');
        campaignManager.updateCampaignColor(campaignId, newColor);
        const $header = $picker.closest('.rpg-lb-campaign-header');
        $header.find('.rpg-lb-campaign-icon').css('color', newColor || '');
        $picker.find('.rpg-lb-color-swatch').removeClass('selected');
        $btn.addClass('selected');
        $picker.fadeOut(150, () => $picker.remove());
    });

    $modal.on('click', function (e) {
        if (!$(e.target).closest('.rpg-lb-icon-picker, .rpg-lb-campaign-icon').length) {
            $modal.find('.rpg-lb-icon-picker').fadeOut(150, function () { $(this).remove(); });
        }
    });

    // ── Move dropdown ────────────────────────────────────────────────────────
    $modal.on('click', '.rpg-lb-bulk-btn[data-action="move"]', function () {
        const $dropdown = $(this).parent('.rpg-lb-move-dropdown');
        if (!$dropdown.find('.rpg-lb-move-menu').length) {
            const campaigns = campaignManager.getCampaignsInOrder();
            let menu = '<div class="rpg-lb-move-menu">';
            for (const { id, campaign } of campaigns) {
                menu += `<div class="rpg-lb-move-menu-item" data-campaign="${id}">${escapeHtml(campaign.name)}</div>`;
            }
            menu += '<div class="rpg-lb-move-menu-item" data-campaign="">Unfiled</div>';
            menu += '</div>';
            $dropdown.append(menu);
        }
        $dropdown.find('.rpg-lb-move-menu').toggle();
    });

    $modal.on('click', '.rpg-lb-move-menu-item', function () {
        const targetCampaignId = $(this).data('campaign');
        const checked = $modal.find('.rpg-lb-book-check.checked');
        for (const el of checked) {
            const $book = $(el).closest('.rpg-lb-tree-book');
            const worldName = $book.data('world');
            const currentCampaign = $book.closest('.rpg-lb-campaign-group').data('campaign') || '';
            if (targetCampaignId) {
                campaignManager.moveBookBetweenCampaigns(currentCampaign || null, targetCampaignId, worldName);
            } else if (currentCampaign) {
                campaignManager.removeBookFromCampaign(currentCampaign, worldName);
            }
        }
        $(this).closest('.rpg-lb-move-menu').hide();
        checked.removeClass('checked');
        renderLorebook();
    });
}

// ─── Field Change Handler ────────────────────────────────────────────────────

async function handleFieldChange($el) {
    const worldName = $el.data('world');
    const uid = Number($el.data('uid'));
    const field = $el.data('field');
    if (!worldName || uid === undefined || !field) return;

    const data = await lorebookAPI.loadWorldData(worldName);
    if (!data) return;

    const value = parseFieldValue(field, $el.is(':checkbox') ? $el.prop('checked') : $el.val(), $el);
    lorebookAPI.updateEntryField(data, uid, field, value);

    if (field === 'position') {
        const $selected = $el.find('option:selected');
        const roleStr = $selected.data('role');
        if (roleStr !== '' && roleStr !== undefined) {
            lorebookAPI.updateEntryField(data, uid, 'role', Number(roleStr));
        }
        const $editor = $el.closest('.rpg-lb-editor');
        const $outletRow = $editor.find('.rpg-lb-outlet-row');
        if (Number(value) === 7) {
            $outletRow.slideDown(200);
        } else {
            $outletRow.slideUp(200);
        }
    }

    await lorebookAPI.saveWorldData(worldName, data);

    // Update middle panel row metadata
    if (field === 'comment') {
        const $row = $(`#rpg-lorebook-modal .rpg-lb-entry-row[data-world="${CSS.escape(worldName)}"][data-uid="${uid}"] .rpg-lb-entry-row-title`);
        $row.text($el.val() || `Entry ${uid}`);
    }
}

function parseFieldValue(field, rawValue, $el) {
    if (field === 'key' || field === 'keysecondary') {
        return String(rawValue).split(',').map(s => s.trim()).filter(Boolean);
    }
    if (field === 'caseSensitive' || field === 'matchWholeWords' || field === 'useGroupScoring') {
        if (rawValue === 'null') return null;
        if (rawValue === 'true') return true;
        if (rawValue === 'false') return false;
        return rawValue;
    }
    const numericFields = [
        'position', 'depth', 'role', 'selectiveLogic', 'order',
        'probability', 'scanDepth', 'groupWeight', 'sticky',
        'cooldown', 'delay', 'delayUntilRecursion',
    ];
    if (numericFields.includes(field)) {
        const num = Number(rawValue);
        return isNaN(num) ? undefined : num;
    }
    const boolFields = [
        'selective', 'constant', 'excludeRecursion', 'preventRecursion',
        'ignoreBudget', 'useProbability', 'groupOverride', 'disable',
    ];
    if (boolFields.includes(field)) {
        return $el.is(':checkbox') ? $el.prop('checked') : Boolean(rawValue);
    }
    return rawValue;
}
