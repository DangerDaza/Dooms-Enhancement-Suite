/**
 * Lorebook Rendering & Event Delegation Module
 * Handles UI rendering and event handling for the Lorebook Manager modal.
 * Follows the same init-once / render-often pattern as quests.js.
 *
 * Exported API:
 *   - initLorebookEventDelegation()  -- call once during extension init
 *   - renderLorebook()               -- call to populate/refresh the modal body
 */

import { extensionSettings } from '../../core/state.js';
import { saveSettings } from '../../core/persistence.js';
import * as lorebookAPI from '../lorebook/lorebookAPI.js';
import * as campaignManager from '../lorebook/campaignManager.js';
import { getLorebookModal } from '../ui/lorebookModal.js';

// ─── Icon Palette ────────────────────────────────────────────────────────────

/** Curated list of Font Awesome icons for campaign icon picker */
const CAMPAIGN_ICONS = [
    // Fantasy
    'fa-dragon', 'fa-hat-wizard', 'fa-wand-sparkles', 'fa-shield-halved',
    'fa-skull-crossbones', 'fa-crown', 'fa-dungeon',
    // Sci-Fi
    'fa-rocket', 'fa-robot', 'fa-atom', 'fa-satellite', 'fa-meteor', 'fa-user-astronaut',
    // Nature / World
    'fa-mountain-sun', 'fa-tree', 'fa-water', 'fa-globe', 'fa-seedling',
    // Genre
    'fa-ghost', 'fa-heart', 'fa-masks-theater', 'fa-gun', 'fa-car', 'fa-city',
    'fa-house', 'fa-scroll',
    // Utility
    'fa-folder', 'fa-book', 'fa-star', 'fa-fire', 'fa-bolt', 'fa-gem',
];

/** Preset color palette for campaign icons */
const CAMPAIGN_COLORS = [
    '#e94560', // red
    '#e07b39', // orange
    '#f0c040', // gold
    '#2ecc71', // green
    '#1abc9c', // teal
    '#4a7ba7', // blue
    '#9b59b6', // purple
    '#e84393', // pink
    '#95a5a6', // gray
    '',         // default (no color override)
];

/**
 * Builds the HTML for the icon picker popup
 * @param {string} campaignId - Campaign ID to associate with
 * @param {string} currentIcon - Currently selected icon class
 * @param {string} currentColor - Currently selected color hex
 * @returns {string} HTML string
 */
function buildIconPickerHtml(campaignId, currentIcon, currentColor) {
    let html = `<div class="rpg-lb-icon-picker" data-campaign="${campaignId}">`;
    html += '<div class="rpg-lb-icon-grid">';
    for (const icon of CAMPAIGN_ICONS) {
        const isSelected = icon === currentIcon ? ' selected' : '';
        html += `<button class="rpg-lb-icon-option${isSelected}" data-icon="${icon}" title="${icon.replace('fa-', '')}"><i class="fa-solid ${icon}"></i></button>`;
    }
    html += '</div>';
    html += '<div class="rpg-lb-color-row">';
    for (const color of CAMPAIGN_COLORS) {
        const isSelected = color === currentColor ? ' selected' : '';
        if (color) {
            html += `<button class="rpg-lb-color-swatch${isSelected}" data-color="${color}" style="background:${color};" title="${color}"></button>`;
        } else {
            html += `<button class="rpg-lb-color-swatch${isSelected}" data-color="" title="Default"><i class="fa-solid fa-xmark"></i></button>`;
        }
    }
    html += '</div>';
    html += '</div>';
    return html;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Escapes a string for safe HTML insertion
 * @param {string} text - Raw text to escape
 * @returns {string} HTML-safe string
 */
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/** @type {ReturnType<typeof setTimeout>|null} */
let saveDebounceTimer = null;

/**
 * Debounced save for WI data — collapses rapid-fire edits into a single write
 * @param {string} worldName - WI filename
 * @param {Object} data - WI data object
 */
function debouncedSave(worldName, data) {
    clearTimeout(saveDebounceTimer);
    saveDebounceTimer = setTimeout(() => {
        lorebookAPI.saveWorldData(worldName, data);
    }, 500);
}

/** @type {ReturnType<typeof setTimeout>|null} */
let searchDebounceTimer = null;

// ─── Entry Rendering (lazy) ─────────────────────────────────────────────────

/**
 * Renders all entries for a single lorebook into the given container.
 * Called lazily when a book spine is expanded for the first time.
 *
 * @param {string} worldName - WI filename
 * @param {HTMLElement} container - The `.rpg-lb-lore-entries` element
 */
async function renderEntriesForBook(worldName, container) {
    container.innerHTML = '<div class="rpg-lb-loading"><i class="fa-solid fa-spinner fa-spin"></i> Loading entries...</div>';

    const data = await lorebookAPI.loadWorldData(worldName);
    if (!data) {
        container.innerHTML = '<div class="rpg-lb-loading">Failed to load world data.</div>';
        return;
    }

    const sorted = lorebookAPI.getEntriesSorted(data);
    let html = '';

    for (const { uid, entry } of sorted) {
        html += buildEntryHtml(worldName, uid, entry);
    }

    // "Add Entry" button at the bottom
    html += `<button class="rpg-lb-btn-add-entry" data-world="${escapeHtml(worldName)}"><i class="fa-solid fa-plus"></i> Add Entry</button>`;

    container.innerHTML = html;

    // Update the parent book spine's meta badges
    const spineEl = container.previousElementSibling;
    if (spineEl) {
        const metaEl = spineEl.querySelector('.rpg-lb-spine-meta');
        const tokenEl = spineEl.querySelector('.rpg-lb-spine-tokens');
        if (metaEl) metaEl.textContent = `${sorted.length} entries`;
        if (tokenEl) tokenEl.textContent = `~${lorebookAPI.estimateTokens(data)} tok`;
    }
}

/**
 * Builds the full HTML for a single WI entry (header + collapsible body).
 *
 * @param {string} worldName - WI filename
 * @param {number} uid - Entry UID
 * @param {Object} entry - The WI entry object
 * @returns {string} HTML string
 */
function buildEntryHtml(worldName, uid, entry) {
    const w = escapeHtml(worldName);
    const isEnabled = !entry.disable;
    const titleText = entry.comment || `Entry ${uid}`;
    const tokEst = Math.round((entry.content?.length || 0) / 3.5);

    // ── Header ──────────────────────────────────────────────────────────────
    let header = `<div class="rpg-lb-entry-header">`;
    header += `<i class="fa-solid fa-chevron-right rpg-lb-entry-chevron"></i>`;
    header += `<div class="rpg-lb-toggle ${isEnabled ? 'active' : ''}" data-type="entry" data-world="${w}" data-uid="${uid}"></div>`;
    // Entry state selector (🟢 Normal, 🔵 Constant, 🔗 Vectorized)
    header += `<select class="rpg-lb-state-select" data-world="${w}" data-uid="${uid}" data-field="entryState" title="Entry Status">`;
    header += `<option value="normal" ${!entry.constant && !entry.vectorized ? 'selected' : ''}>&#x1F7E2;</option>`;
    header += `<option value="constant" ${entry.constant ? 'selected' : ''}>&#x1F535;</option>`;
    header += `<option value="vectorized" ${entry.vectorized ? 'selected' : ''}>&#x1F517;</option>`;
    header += `</select>`;
    header += `<span class="rpg-lb-entry-title"><i class="fa-solid fa-scroll"></i> ${escapeHtml(titleText)}</span>`;
    // Position badge
    const posBadgeMap = { 0: '↑Char', 1: '↓Char', 2: '↑AN', 3: '↓AN', 4: '@D', 5: '↑EM', 6: '↓EM', 7: 'Outlet' };
    header += `<span class="rpg-lb-entry-badge">${posBadgeMap[entry.position] ?? '↑Char'} ${entry.position == 4 ? 'd' + (entry.depth ?? 4) : ''}</span>`;
    header += `<span class="rpg-lb-entry-badge">~${tokEst} tok</span>`;
    header += `<div class="rpg-lb-entry-order-inline"><span>Order</span><input type="number" value="${entry.order ?? 100}" min="0" max="9999" data-world="${w}" data-uid="${uid}" data-field="order"></div>`;
    header += `<div class="rpg-lb-entry-actions">`;
    header += `<button class="rpg-lb-entry-action-btn rpg-lb-entry-delete" data-world="${w}" data-uid="${uid}" title="Delete"><i class="fa-solid fa-trash"></i></button>`;
    header += `</div>`;
    header += `</div>`;

    // ── Body (form) ─────────────────────────────────────────────────────────
    let body = `<div class="rpg-lb-entry-body">`;

    // Title / Memo + UID
    body += `<div class="rpg-lb-form-section"><div class="rpg-lb-form-row">`;
    body += `<div class="rpg-lb-field-group"><div class="rpg-lb-field-label"><i class="fa-solid fa-tag"></i> Title / Memo</div><input class="rpg-lb-input" type="text" value="${escapeHtml(entry.comment || '')}" data-world="${w}" data-uid="${uid}" data-field="comment"></div>`;
    body += `<div class="rpg-lb-field-group sm"><div class="rpg-lb-field-label"><i class="fa-solid fa-fingerprint"></i> UID</div><input class="rpg-lb-input" type="text" value="${uid}" disabled style="opacity:0.5;text-align:center;"></div>`;
    body += `</div></div>`;

    // Position + Depth (role is baked into @D sub-options, matching ST's approach)
    const posVal = entry.position ?? 0;
    const roleVal = entry.role ?? 0;
    body += `<div class="rpg-lb-form-section"><div class="rpg-lb-form-row">`;
    body += `<div class="rpg-lb-field-group md"><div class="rpg-lb-field-label"><i class="fa-solid fa-location-dot"></i> Position</div>`;
    body += `<select class="rpg-lb-select rpg-lb-position-select" data-world="${w}" data-uid="${uid}" data-field="position">`;
    body += `<option value="0" data-role="" ${posVal == 0 ? 'selected' : ''}>&#8593;Char &#8212; Before Char Defs</option>`;
    body += `<option value="1" data-role="" ${posVal == 1 ? 'selected' : ''}>&#8595;Char &#8212; After Char Defs</option>`;
    body += `<option value="2" data-role="" ${posVal == 2 ? 'selected' : ''}>&#8593;AN &#8212; Before Author's Note</option>`;
    body += `<option value="3" data-role="" ${posVal == 3 ? 'selected' : ''}>&#8595;AN &#8212; After Author's Note</option>`;
    body += `<option value="4" data-role="0" ${posVal == 4 && roleVal == 0 ? 'selected' : ''}>@D &#9881;&#65039; &#8212; At Depth (System)</option>`;
    body += `<option value="4" data-role="1" ${posVal == 4 && roleVal == 1 ? 'selected' : ''}>@D &#128100; &#8212; At Depth (User)</option>`;
    body += `<option value="4" data-role="2" ${posVal == 4 && roleVal == 2 ? 'selected' : ''}>@D &#129302; &#8212; At Depth (Assistant)</option>`;
    body += `<option value="5" data-role="" ${posVal == 5 ? 'selected' : ''}>&#8593;EM &#8212; Before Examples</option>`;
    body += `<option value="6" data-role="" ${posVal == 6 ? 'selected' : ''}>&#8595;EM &#8212; After Examples</option>`;
    body += `<option value="7" data-role="" ${posVal == 7 ? 'selected' : ''}>&#10145;&#65039; Outlet</option>`;
    body += `</select></div>`;
    body += `<div class="rpg-lb-field-group sm"><div class="rpg-lb-field-label"><i class="fa-solid fa-layer-group"></i> Depth</div><input class="rpg-lb-input rpg-lb-number" type="number" value="${entry.depth ?? 4}" data-world="${w}" data-uid="${uid}" data-field="depth"></div>`;
    body += `</div>`;
    // Outlet Name (shown only when position=7)
    body += `<div class="rpg-lb-form-row rpg-lb-outlet-row" ${posVal != 7 ? 'style="display:none;"' : ''}>`;
    body += `<div class="rpg-lb-field-group"><div class="rpg-lb-field-label"><i class="fa-solid fa-plug"></i> Outlet Name</div>`;
    body += `<input class="rpg-lb-input" type="text" value="${escapeHtml(entry.outletName || '')}" data-world="${w}" data-uid="${uid}" data-field="outletName" placeholder="Outlet Name"></div>`;
    body += `</div>`;
    body += `</div>`;

    // Keywords card
    body += `<div class="rpg-lb-keywords-card">`;
    // Primary
    body += `<div class="rpg-lb-kw-section"><div class="rpg-lb-kw-section-header"><div class="rpg-lb-field-label"><i class="fa-solid fa-key"></i> Primary Keywords</div></div>`;
    body += `<textarea class="rpg-lb-input rpg-lb-kw-textarea" data-world="${w}" data-uid="${uid}" data-field="key" rows="2" placeholder="Comma-separated keywords">${(entry.key || []).join(', ')}</textarea></div>`;
    // Secondary
    body += `<div class="rpg-lb-kw-section"><div class="rpg-lb-kw-section-header"><div class="rpg-lb-field-label"><i class="fa-solid fa-key"></i> Secondary Keywords</div>`;
    body += `<select class="rpg-lb-kw-logic-select" data-world="${w}" data-uid="${uid}" data-field="selectiveLogic">`;
    body += `<option value="0" ${entry.selectiveLogic == 0 ? 'selected' : ''}>AND ANY</option>`;
    body += `<option value="1" ${entry.selectiveLogic == 1 ? 'selected' : ''}>AND ALL</option>`;
    body += `<option value="2" ${entry.selectiveLogic == 2 ? 'selected' : ''}>NOT ALL</option>`;
    body += `<option value="3" ${entry.selectiveLogic == 3 ? 'selected' : ''}>NOT ANY</option>`;
    body += `</select></div>`;
    body += `<textarea class="rpg-lb-input rpg-lb-kw-textarea secondary" data-world="${w}" data-uid="${uid}" data-field="keysecondary" rows="2" placeholder="Comma-separated secondary keywords">${(entry.keysecondary || []).join(', ')}</textarea></div>`;
    body += `</div>`; // keywords-card

    // Content
    body += `<div class="rpg-lb-form-section"><div class="rpg-lb-field-label"><i class="fa-solid fa-align-left"></i> Content</div>`;
    body += `<textarea class="rpg-lb-textarea" data-world="${w}" data-uid="${uid}" data-field="content" rows="4">${escapeHtml(entry.content || '')}</textarea>`;
    body += `<div class="rpg-lb-content-footer">`;
    body += `<span class="rpg-lb-token-count"><i class="fa-solid fa-coins"></i> ~${tokEst} tokens</span>`;
    body += `<label class="rpg-lb-wi-checkbox"><input type="checkbox" ${entry.selective ? 'checked' : ''} data-world="${w}" data-uid="${uid}" data-field="selective"><span class="rpg-lb-check-box"><i class="fa-solid fa-check"></i></span> Selective</label>`;
    body += `</div></div>`;

    // Order / Trigger% / Scan Depth / Inclusion Group
    body += `<div class="rpg-lb-form-section"><div class="rpg-lb-form-row">`;
    body += `<div class="rpg-lb-field-group sm"><div class="rpg-lb-field-label"><i class="fa-solid fa-sort-numeric-up"></i> Order</div><input class="rpg-lb-input rpg-lb-number" type="number" value="${entry.order ?? 100}" data-world="${w}" data-uid="${uid}" data-field="order"></div>`;
    body += `<div class="rpg-lb-field-group sm"><div class="rpg-lb-field-label"><i class="fa-solid fa-percent"></i> Trigger %</div><input class="rpg-lb-input rpg-lb-number" type="number" value="${entry.probability ?? 100}" data-world="${w}" data-uid="${uid}" data-field="probability"></div>`;
    body += `<div class="rpg-lb-field-group sm"><div class="rpg-lb-field-label"><i class="fa-solid fa-magnifying-glass"></i> Scan Depth</div><input class="rpg-lb-input rpg-lb-number" type="number" value="${entry.scanDepth ?? ''}" placeholder="Global" data-world="${w}" data-uid="${uid}" data-field="scanDepth"></div>`;
    body += `<div class="rpg-lb-field-group"><div class="rpg-lb-field-label"><i class="fa-solid fa-object-group"></i> Inclusion Group</div><input class="rpg-lb-input" type="text" value="${escapeHtml(entry.group || '')}" placeholder="Group label" data-world="${w}" data-uid="${uid}" data-field="group"></div>`;
    body += `</div></div>`;

    // ── Advanced Options (collapsible) ──────────────────────────────────────
    body += `<div class="rpg-lb-section-divider collapsed"><i class="fa-solid fa-sliders"></i> Advanced Options <i class="fa-solid fa-chevron-down rpg-lb-section-toggle"></i></div>`;
    body += `<div class="rpg-lb-collapsible-section" style="display:none;">`;

    // Matching options
    body += `<div class="rpg-lb-form-row">`;
    body += buildTriStateSelect(w, uid, 'caseSensitive', 'Case Sensitive', entry.caseSensitive);
    body += buildTriStateSelect(w, uid, 'matchWholeWords', 'Match Whole Words', entry.matchWholeWords);
    body += buildTriStateSelect(w, uid, 'useGroupScoring', 'Group Scoring', entry.useGroupScoring);
    body += `</div>`;

    // Group weight + prioritize
    body += `<div class="rpg-lb-form-row">`;
    body += `<div class="rpg-lb-field-group sm"><div class="rpg-lb-field-label">Group Weight</div><input class="rpg-lb-input rpg-lb-number" type="number" value="${entry.groupWeight ?? 100}" data-world="${w}" data-uid="${uid}" data-field="groupWeight"></div>`;
    body += `<div class="rpg-lb-field-group" style="display:flex;align-items:flex-end;padding-bottom:2px;"><label class="rpg-lb-wi-checkbox"><input type="checkbox" ${entry.groupOverride ? 'checked' : ''} data-world="${w}" data-uid="${uid}" data-field="groupOverride"><span class="rpg-lb-check-box"><i class="fa-solid fa-check"></i></span> Prioritize in group</label></div>`;
    body += `</div>`;

    // Timed effects
    body += `<div class="rpg-lb-form-row">`;
    body += `<div class="rpg-lb-field-group sm"><div class="rpg-lb-field-label"><i class="fa-solid fa-thumbtack"></i> Sticky</div><input class="rpg-lb-input rpg-lb-number" type="number" value="${entry.sticky ?? ''}" placeholder="Off" data-world="${w}" data-uid="${uid}" data-field="sticky"></div>`;
    body += `<div class="rpg-lb-field-group sm"><div class="rpg-lb-field-label"><i class="fa-solid fa-clock"></i> Cooldown</div><input class="rpg-lb-input rpg-lb-number" type="number" value="${entry.cooldown ?? ''}" placeholder="Off" data-world="${w}" data-uid="${uid}" data-field="cooldown"></div>`;
    body += `<div class="rpg-lb-field-group sm"><div class="rpg-lb-field-label"><i class="fa-solid fa-hourglass-start"></i> Delay</div><input class="rpg-lb-input rpg-lb-number" type="number" value="${entry.delay ?? ''}" placeholder="Off" data-world="${w}" data-uid="${uid}" data-field="delay"></div>`;
    body += `<div class="rpg-lb-field-group sm"><div class="rpg-lb-field-label"><i class="fa-solid fa-repeat"></i> Recursion Lv</div><input class="rpg-lb-input rpg-lb-number" type="number" value="${entry.delayUntilRecursion ?? 0}" data-world="${w}" data-uid="${uid}" data-field="delayUntilRecursion"></div>`;
    body += `</div>`;

    // Checkbox flags
    body += `<div class="rpg-lb-wi-checkbox-row">`;
    body += buildCheckbox(w, uid, 'excludeRecursion', 'Non-recursable', entry.excludeRecursion);
    body += buildCheckbox(w, uid, 'preventRecursion', 'Prevent recursion', entry.preventRecursion);
    body += buildCheckbox(w, uid, 'ignoreBudget', 'Ignore budget', entry.ignoreBudget);
    body += buildCheckbox(w, uid, 'useProbability', 'Use probability', entry.useProbability !== false);
    body += buildCheckbox(w, uid, 'constant', 'Constant', entry.constant);
    body += `</div>`;

    // Automation ID
    body += `<div class="rpg-lb-form-row">`;
    body += `<div class="rpg-lb-field-group"><div class="rpg-lb-field-label"><i class="fa-solid fa-bolt"></i> Automation ID</div><input class="rpg-lb-input" type="text" value="${escapeHtml(entry.automationId || '')}" placeholder="( None )" data-world="${w}" data-uid="${uid}" data-field="automationId"></div>`;
    body += `</div>`;

    body += `</div>`; // collapsible-section
    body += `</div>`; // entry-body

    return `<div class="rpg-lb-entry" data-world="${w}" data-uid="${uid}">${header}${body}</div>`;
}

/**
 * Helper: builds a tri-state select (Use global / Yes / No) for advanced options
 * @param {string} w - Escaped world name
 * @param {number} uid - Entry UID
 * @param {string} field - Field name
 * @param {string} label - Display label
 * @param {boolean|null} value - Current value
 * @returns {string} HTML
 */
function buildTriStateSelect(w, uid, field, label, value) {
    return `<div class="rpg-lb-field-group md"><div class="rpg-lb-field-label">${label}</div><select class="rpg-lb-select" data-world="${w}" data-uid="${uid}" data-field="${field}"><option value="null" ${value === null || value === undefined ? 'selected' : ''}>Use global</option><option value="true" ${value === true ? 'selected' : ''}>Yes</option><option value="false" ${value === false ? 'selected' : ''}>No</option></select></div>`;
}

/**
 * Helper: builds a labeled checkbox
 * @param {string} w - Escaped world name
 * @param {number} uid - Entry UID
 * @param {string} field - Field name
 * @param {string} label - Display label
 * @param {boolean} checked - Whether checked
 * @returns {string} HTML
 */
function buildCheckbox(w, uid, field, label, checked) {
    return `<label class="rpg-lb-wi-checkbox"><input type="checkbox" ${checked ? 'checked' : ''} data-world="${w}" data-uid="${uid}" data-field="${field}"><span class="rpg-lb-check-box"><i class="fa-solid fa-check"></i></span> ${label}</label>`;
}

// ─── Main Render ────────────────────────────────────────────────────────────

/**
 * Renders (or re-renders) the entire Lorebook Manager modal body.
 * Safe to call repeatedly; rebuilds from current state each time.
 */
export function renderLorebook() {
    const container = document.querySelector('#rpg-lorebook-modal .rpg-lb-modal-body');
    if (!container) return;

    const allNames = lorebookAPI.getAllWorldNames();
    const activeNames = lorebookAPI.getActiveWorldNames();
    const campaigns = campaignManager.getCampaignsInOrder();
    const unfiled = campaignManager.getUnfiledBooks();
    const lb = extensionSettings.lorebook || {};
    const lastTab = lb.lastActiveTab || 'all';
    const lastFilter = lb.lastFilter || 'all';

    // Pre-compute total active count for the toolbar toggle-all button
    const totalActiveCount = activeNames.length;
    let activeCount = 0;
    let html = '';

    // ── Global WI Settings (collapsible) ────────────────────────────────────
    const gs = lorebookAPI.getGlobalWISettings();
    html += '<div class="rpg-lb-global-settings">';
    html += '<div class="rpg-lb-global-settings-header"><i class="fa-solid fa-sliders"></i> <span>Global WI Settings</span>';
    html += '<i class="fa-solid fa-chevron-right rpg-lb-global-chevron"></i></div>';
    html += '<div class="rpg-lb-global-settings-body" style="display:none;">';
    // Number inputs row
    html += '<div class="rpg-lb-global-row">';
    html += `<div class="rpg-lb-global-field"><label>Scan Depth</label><input type="number" data-global="world_info_depth" value="${gs.world_info_depth}" min="0" max="1000"></div>`;
    html += `<div class="rpg-lb-global-field"><label>Context %</label><input type="number" data-global="world_info_budget" value="${gs.world_info_budget}" min="1" max="100"></div>`;
    html += `<div class="rpg-lb-global-field"><label>Budget Cap</label><input type="number" data-global="world_info_budget_cap" value="${gs.world_info_budget_cap}" min="0" max="65536"></div>`;
    html += `<div class="rpg-lb-global-field"><label>Min Activations</label><input type="number" data-global="world_info_min_activations" value="${gs.world_info_min_activations}" min="0" max="100"></div>`;
    html += `<div class="rpg-lb-global-field"><label>Max Depth</label><input type="number" data-global="world_info_min_activations_depth_max" value="${gs.world_info_min_activations_depth_max}" min="0" max="100"></div>`;
    html += `<div class="rpg-lb-global-field"><label>Max Recursion</label><input type="number" data-global="world_info_max_recursion_steps" value="${gs.world_info_max_recursion_steps}" min="0" max="10"></div>`;
    html += '</div>';
    // Strategy select
    html += '<div class="rpg-lb-global-row">';
    html += '<div class="rpg-lb-global-field wide"><label>Insertion Strategy</label>';
    html += `<select data-global="world_info_character_strategy">`;
    html += `<option value="0" ${gs.world_info_character_strategy == 0 ? 'selected' : ''}>Sorted Evenly</option>`;
    html += `<option value="1" ${gs.world_info_character_strategy == 1 ? 'selected' : ''}>Character Lore First</option>`;
    html += `<option value="2" ${gs.world_info_character_strategy == 2 ? 'selected' : ''}>Global Lore First</option>`;
    html += '</select></div>';
    html += '</div>';
    // Checkboxes row
    html += '<div class="rpg-lb-global-row checkboxes">';
    html += `<label><input type="checkbox" data-global="world_info_include_names" ${gs.world_info_include_names ? 'checked' : ''}> Include Names</label>`;
    html += `<label><input type="checkbox" data-global="world_info_recursive" ${gs.world_info_recursive ? 'checked' : ''}> Recursive Scan</label>`;
    html += `<label><input type="checkbox" data-global="world_info_case_sensitive" ${gs.world_info_case_sensitive ? 'checked' : ''}> Case Sensitive</label>`;
    html += `<label><input type="checkbox" data-global="world_info_match_whole_words" ${gs.world_info_match_whole_words ? 'checked' : ''}> Match Whole Words</label>`;
    html += `<label><input type="checkbox" data-global="world_info_use_group_scoring" ${gs.world_info_use_group_scoring ? 'checked' : ''}> Use Group Scoring</label>`;
    html += `<label><input type="checkbox" data-global="world_info_overflow_alert" ${gs.world_info_overflow_alert ? 'checked' : ''}> Alert On Overflow</label>`;
    html += '</div>';
    html += '</div></div>'; // global-settings-body + global-settings

    // ── Tab bar ─────────────────────────────────────────────────────────────
    html += '<div class="rpg-lb-tab-bar">';
    html += `<div class="rpg-lb-tab ${lastTab === 'all' ? 'active' : ''}" data-tab="all">All</div>`;
    for (const { id, campaign } of campaigns) {
        const hasActiveBooks = (campaign.books || []).some(b => activeNames.includes(b));
        html += `<div class="rpg-lb-tab ${lastTab === id ? 'active' : ''}" data-tab="${id}">`;
        html += `<span class="rpg-lb-tab-dot ${hasActiveBooks ? 'has-active' : ''}"></span> ${escapeHtml(campaign.name)}`;
        html += '</div>';
    }
    html += `<div class="rpg-lb-tab ${lastTab === 'unfiled' ? 'active' : ''}" data-tab="unfiled">Unfiled</div>`;
    html += '<div class="rpg-lb-tab-add" title="New Lore Library"><i class="fa-solid fa-plus"></i></div>';
    html += '</div>';

    // ── Search + filter row ─────────────────────────────────────────────────
    html += '<div class="rpg-lb-filter-row">';
    html += '<div class="rpg-lb-search-wrap"><i class="fa-solid fa-magnifying-glass"></i>';
    html += `<input type="text" class="rpg-lb-search" placeholder="Search lorebooks..." value="${escapeHtml(lb.lastSearch || '')}">`;
    html += '</div>';
    html += '<div class="rpg-lb-filter-pills">';
    html += `<button class="rpg-lb-fpill ${lastFilter === 'all' || !lastFilter ? 'active' : ''}" data-filter="all">All</button>`;
    html += `<button class="rpg-lb-fpill ${lastFilter === 'active' ? 'active' : ''}" data-filter="active">Active</button>`;
    html += `<button class="rpg-lb-fpill ${lastFilter === 'inactive' ? 'active' : ''}" data-filter="inactive">Inactive</button>`;
    html += '</div></div>';

    // ── Toolbar ─────────────────────────────────────────────────────────────
    html += '<div class="rpg-lb-toolbar">';
    html += '<button class="rpg-lb-toolbar-btn accent" data-action="apply-order"><i class="fa-solid fa-arrow-down-1-9"></i> Apply Current Sorting as Order</button>';
    html += '<span class="rpg-lb-spacer"></span>';
    html += '<button class="rpg-lb-toolbar-btn" data-action="expand-all"><i class="fa-solid fa-angles-down"></i> Expand All</button>';
    html += '<div class="rpg-lb-toolbar-sep"></div>';
    html += '<button class="rpg-lb-toolbar-btn" data-action="collapse-all"><i class="fa-solid fa-angles-up"></i> Collapse All</button>';
    html += '</div>';

    // ── Book list: Campaign groups ──────────────────────────────────────────
    html += '<div class="rpg-lb-book-list">';

    for (const { id, campaign } of campaigns) {
        const isCollapsed = campaignManager.isCampaignCollapsed(id);
        const books = (campaign.books || []).filter(b => allNames.includes(b));
        const activeInCampaign = books.filter(b => activeNames.includes(b)).length;
        activeCount += activeInCampaign;

        html += `<div class="rpg-lb-campaign-group" data-campaign="${id}">`;
        html += `<div class="rpg-lb-campaign-header ${isCollapsed ? 'collapsed' : ''}" data-campaign="${id}">`;
        const iconClass = campaign.icon || 'fa-folder';
        const iconColor = campaign.color ? ` style="color: ${escapeHtml(campaign.color)};"` : '';
        html += `<i class="fa-solid ${escapeHtml(iconClass)} rpg-lb-campaign-icon" data-campaign="${id}"${iconColor} title="Click to change icon"></i>`;
        html += `<span class="rpg-lb-campaign-name">${escapeHtml(campaign.name)}</span>`;
        html += `<span class="rpg-lb-campaign-stats">${activeInCampaign}/${books.length} active</span>`;
        const allBooksActive = books.length > 0 && activeInCampaign === books.length;
        html += `<div class="rpg-lb-toggle rpg-lb-campaign-toggle ${allBooksActive ? 'active' : ''}" data-type="campaign" data-campaign="${id}" title="Toggle all books in this library"></div>`;
        html += `<i class="fa-solid fa-chevron-down rpg-lb-campaign-chevron"></i>`;
        html += '</div>';
        html += `<div class="rpg-lb-campaign-body" ${isCollapsed ? 'style="display:none;"' : ''}>`;

        for (const worldName of books) {
            html += buildBookSpineHtml(worldName, id, activeNames);
        }

        html += '</div></div>'; // campaign-body + campaign-group
    }

    // ── Unfiled section ─────────────────────────────────────────────────────
    if (unfiled.length > 0 || lastTab === 'all' || lastTab === 'unfiled') {
        const activeInUnfiled = unfiled.filter(b => activeNames.includes(b)).length;
        activeCount += activeInUnfiled;

        html += '<div class="rpg-lb-campaign-group unfiled-group" data-campaign="unfiled">';
        html += '<div class="rpg-lb-campaign-header" data-campaign="unfiled">';
        html += '<i class="fa-solid fa-folder-open rpg-lb-campaign-icon"></i>';
        html += `<span class="rpg-lb-campaign-name">Unfiled</span>`;
        html += `<span class="rpg-lb-campaign-stats">${unfiled.length} books</span>`;
        html += '<i class="fa-solid fa-chevron-down rpg-lb-campaign-chevron"></i>';
        html += '</div>';
        html += '<div class="rpg-lb-campaign-body">';

        for (const worldName of unfiled) {
            html += buildBookSpineHtml(worldName, '', activeNames);
        }

        html += '</div></div>';
    }

    html += '</div>'; // book-list

    // ── Bulk action footer ──────────────────────────────────────────────────
    html += '<div class="rpg-lb-bulk-footer">';
    html += '<span class="rpg-lb-bulk-count">Selected: 0</span>';
    html += '<button class="rpg-lb-bulk-btn" data-action="select-all">Select All</button>';
    html += '<button class="rpg-lb-bulk-btn rpg-lb-bulk-activate" data-action="activate">Activate</button>';
    html += '<button class="rpg-lb-bulk-btn rpg-lb-bulk-deactivate" data-action="deactivate">Deactivate</button>';
    html += '<div class="rpg-lb-move-dropdown">';
    html += '<button class="rpg-lb-bulk-btn" data-action="move">Move to &#9662;</button>';
    html += '</div>';
    html += '</div>';

    // ── Footer stats ────────────────────────────────────────────────────────
    html += `<div class="rpg-lb-footer-stats">Active: ${activeCount} books | Total: ${allNames.length} lorebooks</div>`;

    // ── New book button ─────────────────────────────────────────────────────
    html += '<div class="rpg-lb-new-book-row">';
    html += '<button class="rpg-lb-btn-new-book"><i class="fa-solid fa-plus"></i> New Lorebook</button>';
    html += '<button class="rpg-lb-btn-import"><i class="fa-solid fa-file-import"></i> Import</button>';
    html += '</div>';
    html += '<input type="file" class="rpg-lb-import-file" accept=".json,.lorebook,.png" hidden>';

    container.innerHTML = html;

    // ── Apply tab filter (show/hide campaign groups) ────────────────────────
    applyTabFilter(container, lastTab);

    // ── Apply active/inactive filter ────────────────────────────────────────
    applyStatusFilter(container, lastFilter);

    // ── Apply search filter ─────────────────────────────────────────────────
    const searchVal = (lb.lastSearch || '').trim().toLowerCase();
    if (searchVal) {
        applySearchFilter(container, searchVal);
    }

    // ── Sync master toggle in the header ────────────────────────────────────
    const allGloballyActive = allNames.length > 0 && totalActiveCount === allNames.length;
    const $masterToggle = $('#rpg-lorebook-modal .rpg-lb-toggle[data-type="master"]');
    $masterToggle.toggleClass('active', allGloballyActive);
}

/**
 * Builds the HTML for a single book spine row + its empty entries container.
 *
 * @param {string} worldName - WI filename
 * @param {string} campaignId - Parent campaign ID (empty string for unfiled)
 * @param {string[]} activeNames - Currently active WI filenames
 * @returns {string} HTML string
 */
function buildBookSpineHtml(worldName, campaignId, activeNames) {
    const isActive = activeNames.includes(worldName);
    const w = escapeHtml(worldName);
    const cid = escapeHtml(campaignId);

    let html = '';
    html += `<div class="rpg-lb-book-spine expandable ${isActive ? 'active-book' : 'inactive'}" data-world="${w}" data-campaign="${cid}">`;
    html += '<i class="fa-solid fa-chevron-right rpg-lb-spine-chevron"></i>';
    html += '<div class="rpg-lb-book-check"><i class="fa-solid fa-check"></i></div>';
    html += `<div class="rpg-lb-toggle ${isActive ? 'active' : ''}" data-type="book" data-world="${w}"></div>`;
    html += '<i class="fa-solid fa-book rpg-lb-spine-icon"></i>';
    html += `<span class="rpg-lb-spine-name">${w}</span>`;
    html += '<span class="rpg-lb-spine-meta">? entries</span>';
    html += '<span class="rpg-lb-spine-tokens">...</span>';
    html += `<button class="rpg-lb-spine-export" data-world="${w}" title="Export"><i class="fa-solid fa-file-export"></i></button>`;
    html += '<button class="rpg-lb-spine-edit"><i class="fa-solid fa-pen-to-square"></i></button>';
    html += '</div>';
    html += `<div class="rpg-lb-lore-entries" data-world="${w}"></div>`;

    return html;
}

/**
 * Shows/hides campaign groups based on the active tab.
 *
 * @param {HTMLElement} container - The modal body container
 * @param {string} tab - Active tab ID ('all', campaign ID, or 'unfiled')
 */
function applyTabFilter(container, tab) {
    const groups = container.querySelectorAll('.rpg-lb-campaign-group');
    for (const group of groups) {
        const gid = group.dataset.campaign;
        if (tab === 'all') {
            group.style.display = '';
        } else if (tab === 'unfiled') {
            group.style.display = gid === 'unfiled' ? '' : 'none';
        } else {
            group.style.display = gid === tab ? '' : 'none';
        }
    }
}

/**
 * Shows/hides book spines based on the active/inactive filter.
 *
 * @param {HTMLElement} container - The modal body container
 * @param {string} filter - 'all', 'active', or 'inactive'
 */
function applyStatusFilter(container, filter) {
    if (filter === 'all') return;
    const spines = container.querySelectorAll('.rpg-lb-book-spine');
    for (const spine of spines) {
        const isActive = spine.classList.contains('active-book');
        if (filter === 'active') {
            spine.style.display = isActive ? '' : 'none';
        } else if (filter === 'inactive') {
            spine.style.display = isActive ? 'none' : '';
        }
        // Also hide the sibling entries container
        const entries = spine.nextElementSibling;
        if (entries && entries.classList.contains('rpg-lb-lore-entries')) {
            entries.style.display = spine.style.display;
        }
    }
}

/**
 * Shows/hides book spines based on a text search query.
 *
 * @param {HTMLElement} container - The modal body container
 * @param {string} query - Lowercased search string
 */
function applySearchFilter(container, query) {
    const spines = container.querySelectorAll('.rpg-lb-book-spine');
    for (const spine of spines) {
        const name = (spine.dataset.world || '').toLowerCase();
        const matches = name.includes(query);
        // Only hide if it doesn't match; don't un-hide things already hidden by other filters
        if (!matches) {
            spine.style.display = 'none';
            const entries = spine.nextElementSibling;
            if (entries && entries.classList.contains('rpg-lb-lore-entries')) {
                entries.style.display = 'none';
            }
        }
    }
}

// ─── Stats Helpers ──────────────────────────────────────────────────────────

/**
 * Refreshes the campaign stats counters and the footer stats
 * without re-rendering the entire lorebook modal.
 */
function refreshActiveStats() {
    const $modal = $('#rpg-lorebook-modal');
    if (!$modal.length) return;

    const activeNames = lorebookAPI.getActiveWorldNames();
    const allNames = lorebookAPI.getAllWorldNames();
    let totalActive = 0;

    // Update each campaign group's stats
    $modal.find('.rpg-lb-campaign-group').each(function () {
        const $group = $(this);
        const campaignId = $group.data('campaign');
        const $statsSpan = $group.find('.rpg-lb-campaign-stats').first();

        // Count active books within this campaign group
        const spines = $group.find('.rpg-lb-book-spine');
        let groupTotal = 0;
        let groupActive = 0;

        spines.each(function () {
            const worldName = $(this).data('world');
            groupTotal++;
            if (activeNames.includes(worldName)) {
                groupActive++;
            }
        });

        totalActive += groupActive;

        if (campaignId === 'unfiled') {
            $statsSpan.text(`${groupTotal} books`);
        } else {
            $statsSpan.text(`${groupActive}/${groupTotal} active`);
        }
    });

    // Update footer stats
    $modal.find('.rpg-lb-footer-stats').text(
        `Active: ${totalActive} books | Total: ${allNames.length} lorebooks`
    );
}

/**
 * Updates the state of all toggle buttons: per-library toggles AND the master
 * header toggle. A library toggle shows "active" only when ALL books in that
 * library are active. The master toggle shows "active" when ALL books globally
 * are active.
 */
function refreshCampaignToggles() {
    const $modal = $('#rpg-lorebook-modal');
    if (!$modal.length) return;

    const activeNames = lorebookAPI.getActiveWorldNames();
    const allNames = lorebookAPI.getAllWorldNames();

    // Per-library toggles
    $modal.find('.rpg-lb-campaign-toggle').each(function () {
        const $toggle = $(this);
        const $group = $toggle.closest('.rpg-lb-campaign-group');
        const $spines = $group.find('.rpg-lb-book-spine');

        if ($spines.length === 0) {
            $toggle.removeClass('active');
            return;
        }

        let allActive = true;
        $spines.each(function () {
            const worldName = $(this).data('world');
            if (!activeNames.includes(worldName)) {
                allActive = false;
                return false; // break .each()
            }
        });

        $toggle.toggleClass('active', allActive);
    });

    // Master header toggle
    const allGloballyActive = allNames.length > 0 && activeNames.length >= allNames.length;
    $modal.find('.rpg-lb-toggle[data-type="master"]').toggleClass('active', allGloballyActive);
}

// ─── Event Delegation ───────────────────────────────────────────────────────

/**
 * Registers all delegated event handlers on the lorebook modal.
 * Must be called exactly once after the modal DOM is available.
 */
export function initLorebookEventDelegation() {
    const $modal = $('#rpg-lorebook-modal');
    if (!$modal.length) return;

    // ── Close button ────────────────────────────────────────────────────────
    $modal.on('click', '.rpg-lb-close', function () {
        const modal = getLorebookModal();
        if (modal) modal.close();
    });

    // ── Backdrop click to close ──────────────────────────────────────────────
    $modal.on('click', function (e) {
        // Only close if clicking the backdrop (not the content)
        if (e.target === $modal[0]) {
            const modal = getLorebookModal();
            if (modal) modal.close();
        }
    });

    // ── Escape key to close ──────────────────────────────────────────────────
    $(document).on('keydown.rpgLorebook', function (e) {
        if (e.key === 'Escape') {
            const modal = getLorebookModal();
            if (modal && modal.isOpen()) {
                modal.close();
                e.stopImmediatePropagation();
            }
        }
    });

    // ── Campaign header collapse/expand ─────────────────────────────────────
    $modal.on('click', '.rpg-lb-campaign-header', function (e) {
        // Don't collapse/expand when clicking the campaign toggle or icon picker
        if ($(e.target).closest('.rpg-lb-campaign-toggle, .rpg-lb-icon-picker').length) return;
        const id = $(this).data('campaign');
        if (!id || id === 'unfiled') {
            // Unfiled group just toggles the body
            $(this).toggleClass('collapsed');
            $(this).next('.rpg-lb-campaign-body').slideToggle(200);
            return;
        }
        campaignManager.toggleCampaignCollapsed(id);
        $(this).toggleClass('collapsed');
        $(this).next('.rpg-lb-campaign-body').slideToggle(200);
    });

    // ── Book spine expand/collapse (lazy-load entries) ──────────────────────
    $modal.on('click', '.rpg-lb-book-spine.expandable', function (e) {
        // Don't trigger when clicking toggles, checkboxes, or edit buttons
        if ($(e.target).closest('.rpg-lb-toggle, .rpg-lb-book-check, .rpg-lb-spine-edit, .rpg-lb-spine-export').length) return;

        const $spine = $(this);
        const worldName = $spine.data('world');
        const $entries = $spine.next('.rpg-lb-lore-entries');

        $spine.toggleClass('expanded');
        $spine.find('.rpg-lb-spine-chevron').toggleClass('rotated');

        if ($spine.hasClass('expanded')) {
            // Lazy-load entries if container is empty
            if (!$entries.children().length || $entries.find('.rpg-lb-loading').length) {
                renderEntriesForBook(worldName, $entries[0]);
            }
            $entries.slideDown(200);
        } else {
            $entries.slideUp(200);
        }
    });

    // ── Entry header expand/collapse ────────────────────────────────────────
    $modal.on('click', '.rpg-lb-entry-header', function (e) {
        if ($(e.target).closest('.rpg-lb-toggle, .rpg-lb-entry-action-btn, .rpg-lb-entry-order-inline, .rpg-lb-state-select').length) return;

        const $header = $(this);
        const $body = $header.next('.rpg-lb-entry-body');

        $header.find('.rpg-lb-entry-chevron').toggleClass('rotated');
        $body.slideToggle(200);
    });

    // ── Book toggle (activate / deactivate) ─────────────────────────────────
    $modal.on('click', '.rpg-lb-toggle[data-type="book"]', async function (e) {
        e.stopPropagation();
        const $toggle = $(this);
        const worldName = $toggle.data('world');
        const isActive = $toggle.hasClass('active');

        if (isActive) {
            await lorebookAPI.deactivateWorld(worldName);
            $toggle.removeClass('active');
            $toggle.closest('.rpg-lb-book-spine').removeClass('active-book').addClass('inactive');
        } else {
            await lorebookAPI.activateWorld(worldName);
            $toggle.addClass('active');
            $toggle.closest('.rpg-lb-book-spine').addClass('active-book').removeClass('inactive');
        }

        // Refresh campaign stats, footer counts, and campaign toggle state
        refreshActiveStats();
        refreshCampaignToggles();
    });

    // ── Campaign toggle-all (activate/deactivate all books in campaign) ──────
    $modal.on('click', '.rpg-lb-campaign-toggle', async function (e) {
        e.stopPropagation();
        const $toggle = $(this);
        const campaignId = $toggle.data('campaign');
        const isActive = $toggle.hasClass('active');
        const $group = $toggle.closest('.rpg-lb-campaign-group');
        const $spines = $group.find('.rpg-lb-book-spine');

        if ($spines.length === 0) return;

        // Determine target state: if all are active, deactivate all; otherwise activate all
        if (isActive) {
            // Deactivate all books in this campaign
            for (const spine of $spines) {
                const worldName = $(spine).data('world');
                if (lorebookAPI.isWorldActive(worldName)) {
                    await lorebookAPI.deactivateWorld(worldName);
                }
                $(spine).find('.rpg-lb-toggle[data-type="book"]').removeClass('active');
                $(spine).removeClass('active-book').addClass('inactive');
            }
            $toggle.removeClass('active');
        } else {
            // Activate all books in this campaign
            for (const spine of $spines) {
                const worldName = $(spine).data('world');
                if (!lorebookAPI.isWorldActive(worldName)) {
                    await lorebookAPI.activateWorld(worldName);
                }
                $(spine).find('.rpg-lb-toggle[data-type="book"]').addClass('active');
                $(spine).addClass('active-book').removeClass('inactive');
            }
            $toggle.addClass('active');
        }

        refreshActiveStats();
    });

    // ── Entry toggle (enable / disable) ─────────────────────────────────────
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
    });

    // ── Tab switching ───────────────────────────────────────────────────────
    $modal.on('click', '.rpg-lb-tab', function () {
        const tab = $(this).data('tab');
        $modal.find('.rpg-lb-tab').removeClass('active');
        $(this).addClass('active');
        campaignManager.setLastActiveTab(tab);

        const container = $modal.find('.rpg-lb-modal-body')[0];
        if (container) {
            applyTabFilter(container, tab);
            // Re-apply status + search filters after tab change
            const lb = extensionSettings.lorebook || {};
            applyStatusFilter(container, lb.lastFilter || 'all');
            const search = (lb.lastSearch || '').trim().toLowerCase();
            if (search) applySearchFilter(container, search);
        }
    });

    // ── Filter pills (active / inactive / all) ─────────────────────────────
    $modal.on('click', '.rpg-lb-fpill', function () {
        const filter = $(this).data('filter');
        $modal.find('.rpg-lb-fpill').removeClass('active');
        $(this).addClass('active');
        campaignManager.setLastFilter(filter);

        // Reset visibility then re-apply filters
        const container = $modal.find('.rpg-lb-modal-body')[0];
        if (container) {
            // Reset all spines to visible first
            container.querySelectorAll('.rpg-lb-book-spine').forEach(s => {
                s.style.display = '';
                const entries = s.nextElementSibling;
                if (entries && entries.classList.contains('rpg-lb-lore-entries')) {
                    entries.style.display = '';
                }
            });
            // Re-apply tab filter
            const lb = extensionSettings.lorebook || {};
            applyTabFilter(container, lb.lastActiveTab || 'all');
            applyStatusFilter(container, filter);
            const search = (lb.lastSearch || '').trim().toLowerCase();
            if (search) applySearchFilter(container, search);
        }
    });

    // ── Toolbar: Expand All ─────────────────────────────────────────────────
    $modal.on('click', '.rpg-lb-toolbar-btn[data-action="expand-all"]', function () {
        // Expand campaigns
        $modal.find('.rpg-lb-campaign-header.collapsed').each(function () {
            $(this).removeClass('collapsed');
            $(this).next('.rpg-lb-campaign-body').show();
        });
        // Expand book spines
        $modal.find('.rpg-lb-book-spine.expandable:not(.expanded)').each(function () {
            const $spine = $(this);
            const worldName = $spine.data('world');
            const $entries = $spine.next('.rpg-lb-lore-entries');
            $spine.addClass('expanded');
            $spine.find('.rpg-lb-spine-chevron').addClass('rotated');
            if (!$entries.children().length || $entries.find('.rpg-lb-loading').length) {
                renderEntriesForBook(worldName, $entries[0]);
            }
            $entries.show();
        });
        // Expand entries
        $modal.find('.rpg-lb-entry-header').each(function () {
            $(this).find('.rpg-lb-entry-chevron').addClass('rotated');
            $(this).next('.rpg-lb-entry-body').show();
        });
    });

    // ── Toolbar: Collapse All ───────────────────────────────────────────────
    $modal.on('click', '.rpg-lb-toolbar-btn[data-action="collapse-all"]', function () {
        // Collapse campaigns
        $modal.find('.rpg-lb-campaign-header:not(.collapsed)').each(function () {
            const id = $(this).data('campaign');
            if (id && id !== 'unfiled') {
                if (!campaignManager.isCampaignCollapsed(id)) {
                    campaignManager.toggleCampaignCollapsed(id);
                }
            }
            $(this).addClass('collapsed');
            $(this).next('.rpg-lb-campaign-body').hide();
        });
        // Collapse book spines
        $modal.find('.rpg-lb-book-spine.expanded').each(function () {
            $(this).removeClass('expanded');
            $(this).find('.rpg-lb-spine-chevron').removeClass('rotated');
            $(this).next('.rpg-lb-lore-entries').hide();
        });
        // Collapse entries
        $modal.find('.rpg-lb-entry-header').each(function () {
            $(this).find('.rpg-lb-entry-chevron').removeClass('rotated');
            $(this).next('.rpg-lb-entry-body').hide();
        });
    });

    // ── Header: Master Toggle All Books ─────────────────────────────────────
    $modal.on('click', '.rpg-lb-header-toggle', async function () {
        const $masterToggle = $(this).find('.rpg-lb-toggle[data-type="master"]');
        const activeNames = lorebookAPI.getActiveWorldNames();
        const allNames = lorebookAPI.getAllWorldNames();
        const allActive = allNames.length > 0 && activeNames.length >= allNames.length;

        const $spines = $modal.find('.rpg-lb-book-spine');

        if (allActive) {
            // Deactivate all
            for (const spine of $spines) {
                const worldName = $(spine).data('world');
                if (lorebookAPI.isWorldActive(worldName)) {
                    await lorebookAPI.deactivateWorld(worldName);
                }
                $(spine).find('.rpg-lb-toggle[data-type="book"]').removeClass('active');
                $(spine).removeClass('active-book').addClass('inactive');
            }
            $masterToggle.removeClass('active');
        } else {
            // Activate all
            for (const spine of $spines) {
                const worldName = $(spine).data('world');
                if (!lorebookAPI.isWorldActive(worldName)) {
                    await lorebookAPI.activateWorld(worldName);
                }
                $(spine).find('.rpg-lb-toggle[data-type="book"]').addClass('active');
                $(spine).addClass('active-book').removeClass('inactive');
            }
            $masterToggle.addClass('active');
        }

        refreshActiveStats();
        refreshCampaignToggles();
    });

    // ── Toolbar: Apply Current Sorting as Order ─────────────────────────────
    $modal.on('click', '.rpg-lb-toolbar-btn[data-action="apply-order"]', async function () {
        const spines = $modal.find('.rpg-lb-book-spine:visible');
        let order = spines.length * 10; // Start high and count down

        for (const spine of spines) {
            const worldName = $(spine).data('world');
            const $entries = $(spine).next('.rpg-lb-lore-entries');
            const entryEls = $entries.find('.rpg-lb-entry');

            if (entryEls.length > 0) {
                const data = await lorebookAPI.loadWorldData(worldName);
                if (data) {
                    let entryOrder = entryEls.length;
                    for (const entryEl of entryEls) {
                        const uid = Number($(entryEl).data('uid'));
                        lorebookAPI.updateEntryField(data, uid, 'order', entryOrder * 10);
                        // Update the inline order input if visible
                        $(entryEl).find('input[data-field="order"]').val(entryOrder * 10);
                        entryOrder--;
                    }
                    await lorebookAPI.saveWorldData(worldName, data);
                }
            }
            order -= 10;
        }
    });

    // ── Book check (bulk select toggle) ─────────────────────────────────────
    $modal.on('click', '.rpg-lb-book-check', function (e) {
        e.stopPropagation();
        $(this).toggleClass('checked');

        // Update bulk count
        const count = $modal.find('.rpg-lb-book-check.checked').length;
        $modal.find('.rpg-lb-bulk-count').text(`Selected: ${count}`);
    });

    // ── Bulk: Select All ────────────────────────────────────────────────────
    $modal.on('click', '.rpg-lb-bulk-btn[data-action="select-all"]', function () {
        const checks = $modal.find('.rpg-lb-book-spine:visible .rpg-lb-book-check');
        const allChecked = checks.filter('.checked').length === checks.length;

        if (allChecked) {
            checks.removeClass('checked');
        } else {
            checks.addClass('checked');
        }

        const count = $modal.find('.rpg-lb-book-check.checked').length;
        $modal.find('.rpg-lb-bulk-count').text(`Selected: ${count}`);
    });

    // ── Bulk: Activate ──────────────────────────────────────────────────────
    $modal.on('click', '.rpg-lb-bulk-activate', async function () {
        const checked = $modal.find('.rpg-lb-book-check.checked');
        for (const el of checked) {
            const $spine = $(el).closest('.rpg-lb-book-spine');
            const worldName = $spine.data('world');
            await lorebookAPI.activateWorld(worldName);
            $spine.find('.rpg-lb-toggle[data-type="book"]').addClass('active');
            $spine.addClass('active-book').removeClass('inactive');
        }
        checked.removeClass('checked');
        $modal.find('.rpg-lb-bulk-count').text('Selected: 0');
        refreshActiveStats();
        refreshCampaignToggles();
    });

    // ── Bulk: Deactivate ────────────────────────────────────────────────────
    $modal.on('click', '.rpg-lb-bulk-deactivate', async function () {
        const checked = $modal.find('.rpg-lb-book-check.checked');
        for (const el of checked) {
            const $spine = $(el).closest('.rpg-lb-book-spine');
            const worldName = $spine.data('world');
            await lorebookAPI.deactivateWorld(worldName);
            $spine.find('.rpg-lb-toggle[data-type="book"]').removeClass('active');
            $spine.removeClass('active-book').addClass('inactive');
        }
        checked.removeClass('checked');
        $modal.find('.rpg-lb-bulk-count').text('Selected: 0');
        refreshActiveStats();
        refreshCampaignToggles();
    });

    // ── Advanced options section divider toggle ─────────────────────────────
    $modal.on('click', '.rpg-lb-section-divider', function (e) {
        e.stopPropagation();
        $(this).toggleClass('collapsed');
        $(this).next('.rpg-lb-collapsible-section').slideToggle(200);
    });

    // ── Tab-add: New Campaign ───────────────────────────────────────────────
    $modal.on('click', '.rpg-lb-tab-add', function () {
        const name = prompt('Enter a name for the new Lore Library:');
        if (name && name.trim()) {
            campaignManager.createCampaign(name.trim());
            renderLorebook();
        }
    });

    // ── Entry delete ────────────────────────────────────────────────────────
    $modal.on('click', '.rpg-lb-entry-delete', async function (e) {
        e.stopPropagation();
        const worldName = $(this).data('world');
        const uid = Number($(this).data('uid'));

        if (!confirm(`Delete entry ${uid} from "${worldName}"?`)) return;

        const data = await lorebookAPI.loadWorldData(worldName);
        if (!data) return;

        await lorebookAPI.deleteEntry(data, uid);
        await lorebookAPI.saveWorldData(worldName, data);

        // Remove the entry element from DOM
        const $entry = $(this).closest('.rpg-lb-entry');
        $entry.slideUp(200, () => $entry.remove());
    });

    // ── Add entry button ────────────────────────────────────────────────────
    $modal.on('click', '.rpg-lb-btn-add-entry', async function () {
        const worldName = $(this).data('world');
        const data = await lorebookAPI.loadWorldData(worldName);
        if (!data) return;

        lorebookAPI.createEntry(worldName, data);
        await lorebookAPI.saveWorldData(worldName, data);

        // Re-render entries for this book
        const $entries = $(this).closest('.rpg-lb-lore-entries');
        if ($entries.length) {
            await renderEntriesForBook(worldName, $entries[0]);
        }
    });

    // ── New lorebook button ─────────────────────────────────────────────────
    $modal.on('click', '.rpg-lb-btn-new-book', async function () {
        const name = prompt('Enter a name for the new lorebook:');
        if (name && name.trim()) {
            await lorebookAPI.createNewWorld(name.trim());
            renderLorebook();
        }
    });

    // ── Spine edit button (open in ST's native WI editor) ───────────────────
    $modal.on('click', '.rpg-lb-spine-edit', function (e) {
        e.stopPropagation();
        const worldName = $(this).closest('.rpg-lb-book-spine').data('world');
        // Open ST's built-in World Info editor for this world
        const selectEl = document.getElementById('world_info');
        if (selectEl) {
            $(selectEl).val(worldName).trigger('change');
        }
    });

    // ── Move dropdown (bulk action) ─────────────────────────────────────────
    $modal.on('click', '.rpg-lb-bulk-btn[data-action="move"]', function () {
        const $dropdown = $(this).parent('.rpg-lb-move-dropdown');
        // Build campaign list if not already present
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

    // ── Move menu item click ────────────────────────────────────────────────
    $modal.on('click', '.rpg-lb-move-menu-item', function () {
        const targetCampaignId = $(this).data('campaign');
        const checked = $modal.find('.rpg-lb-book-check.checked');

        for (const el of checked) {
            const $spine = $(el).closest('.rpg-lb-book-spine');
            const worldName = $spine.data('world');
            const currentCampaign = $spine.data('campaign') || '';

            if (targetCampaignId) {
                campaignManager.moveBookBetweenCampaigns(currentCampaign || null, targetCampaignId, worldName);
            } else if (currentCampaign) {
                campaignManager.removeBookFromCampaign(currentCampaign, worldName);
            }
        }

        // Hide menu and re-render
        $(this).closest('.rpg-lb-move-menu').hide();
        checked.removeClass('checked');
        $modal.find('.rpg-lb-bulk-count').text('Selected: 0');
        renderLorebook();
    });

    // ── Search input ────────────────────────────────────────────────────────
    $modal.on('input', '.rpg-lb-search', function () {
        const query = $(this).val().trim().toLowerCase();
        campaignManager.setLastSearch(query);

        // Debounce the settings save
        clearTimeout(searchDebounceTimer);
        searchDebounceTimer = setTimeout(() => saveSettings(), 500);

        // Reset visibility then apply all filters
        const container = $modal.find('.rpg-lb-modal-body')[0];
        if (!container) return;

        container.querySelectorAll('.rpg-lb-book-spine').forEach(s => {
            s.style.display = '';
            const entries = s.nextElementSibling;
            if (entries && entries.classList.contains('rpg-lb-lore-entries')) {
                entries.style.display = '';
            }
        });

        const lb = extensionSettings.lorebook || {};
        applyTabFilter(container, lb.lastActiveTab || 'all');
        applyStatusFilter(container, lb.lastFilter || 'all');
        if (query) applySearchFilter(container, query);
    });

    // ── Change handlers for entry fields ────────────────────────────────────
    $modal.on('change', '.rpg-lb-entry-body input, .rpg-lb-entry-body select', async function () {
        await handleFieldChange($(this));
    });

    // Textarea changes use debounced save
    $modal.on('input', '.rpg-lb-entry-body textarea', async function () {
        const $el = $(this);
        const worldName = $el.data('world');
        const uid = Number($el.data('uid'));
        const field = $el.data('field');

        const data = await lorebookAPI.loadWorldData(worldName);
        if (!data) return;

        const value = parseFieldValue(field, $el.val(), $el);
        lorebookAPI.updateEntryField(data, uid, field, value);
        debouncedSave(worldName, data);

        // Update token count for content fields
        if (field === 'content') {
            const tokEst = Math.round(($el.val()?.length || 0) / 3.5);
            $el.closest('.rpg-lb-form-section').find('.rpg-lb-token-count').html(
                `<i class="fa-solid fa-coins"></i> ~${tokEst} tokens`
            );
        }
    });

    // Inline order input on entry header (stopPropagation so header doesn't toggle)
    $modal.on('click', '.rpg-lb-entry-order-inline input', function (e) {
        e.stopPropagation();
    });

    $modal.on('change', '.rpg-lb-entry-order-inline input', async function () {
        const $el = $(this);
        const worldName = $el.data('world');
        const uid = Number($el.data('uid'));
        const value = Number($el.val());

        const data = await lorebookAPI.loadWorldData(worldName);
        if (!data) return;

        lorebookAPI.updateEntryField(data, uid, 'order', value);
        await lorebookAPI.saveWorldData(worldName, data);

        // Also update the order input inside the entry body if it exists
        const $entry = $el.closest('.rpg-lb-entry, .rpg-lb-entry-header').parent();
        $entry.find('.rpg-lb-entry-body input[data-field="order"]').val(value);
    });

    // ── Entry state selector (🟢 Normal, 🔵 Constant, 🔗 Vectorized) ────────
    $modal.on('click', '.rpg-lb-state-select', function (e) {
        e.stopPropagation(); // Don't toggle entry header expand/collapse
    });

    $modal.on('change', '.rpg-lb-state-select', async function () {
        const $sel = $(this);
        const worldName = $sel.data('world');
        const uid = Number($sel.data('uid'));
        const stateValue = $sel.val();

        const data = await lorebookAPI.loadWorldData(worldName);
        if (!data) return;

        // Set constant / vectorized based on selection
        const isConstant = stateValue === 'constant';
        const isVectorized = stateValue === 'vectorized';
        lorebookAPI.updateEntryField(data, uid, 'constant', isConstant);
        lorebookAPI.updateEntryField(data, uid, 'vectorized', isVectorized);
        await lorebookAPI.saveWorldData(worldName, data);

        // Sync checkboxes in the entry body if expanded
        const $entry = $sel.closest('.rpg-lb-entry');
        $entry.find('.rpg-lb-entry-body input[data-field="constant"]').prop('checked', isConstant);
    });

    // ── Global WI settings change handler ────────────────────────────────────
    $modal.on('change', '[data-global]', function () {
        const $el = $(this);
        const key = $el.data('global');
        const isCheckbox = $el.is(':checkbox');
        const value = isCheckbox ? $el.prop('checked') : Number($el.val());
        lorebookAPI.setGlobalWISetting(key, value);
    });

    // ── Global settings section collapse/expand ──────────────────────────────
    $modal.on('click', '.rpg-lb-global-settings-header', function () {
        $(this).find('.rpg-lb-global-chevron').toggleClass('rotated');
        $(this).next('.rpg-lb-global-settings-body').slideToggle(200);
    });

    // ── Campaign icon picker ─────────────────────────────────────────────────
    $modal.on('click', '.rpg-lb-campaign-icon[data-campaign]', function (e) {
        e.stopPropagation(); // Don't trigger campaign header collapse

        const $icon = $(this);
        const campaignId = $icon.data('campaign');
        if (!campaignId || campaignId === 'unfiled') return;

        // Close any existing picker
        $modal.find('.rpg-lb-icon-picker').remove();

        // Get current icon/color from campaign data
        const campaign = (extensionSettings.lorebook?.campaigns || {})[campaignId];
        if (!campaign) return;

        const pickerHtml = buildIconPickerHtml(campaignId, campaign.icon || 'fa-folder', campaign.color || '');
        const $picker = $(pickerHtml);

        // Position near the icon
        $icon.closest('.rpg-lb-campaign-header').append($picker);
        $picker.hide().fadeIn(150);
    });

    // Icon selection
    $modal.on('click', '.rpg-lb-icon-option', function (e) {
        e.stopPropagation();
        const $btn = $(this);
        const $picker = $btn.closest('.rpg-lb-icon-picker');
        const campaignId = $picker.data('campaign');
        const newIcon = $btn.data('icon');

        // Update data
        campaignManager.updateCampaignIcon(campaignId, newIcon);

        // Update the icon element in place
        const $header = $picker.closest('.rpg-lb-campaign-header');
        const $iconEl = $header.find('.rpg-lb-campaign-icon');
        // Remove all fa-* classes except fa-solid, then add new one
        const classes = $iconEl.attr('class').split(/\s+/).filter(c => !c.startsWith('fa-') || c === 'fa-solid');
        classes.push(newIcon, 'rpg-lb-campaign-icon');
        $iconEl.attr('class', classes.join(' '));

        // Highlight selected
        $picker.find('.rpg-lb-icon-option').removeClass('selected');
        $btn.addClass('selected');

        // Close picker
        $picker.fadeOut(150, () => $picker.remove());
    });

    // Color selection
    $modal.on('click', '.rpg-lb-color-swatch', function (e) {
        e.stopPropagation();
        const $btn = $(this);
        const $picker = $btn.closest('.rpg-lb-icon-picker');
        const campaignId = $picker.data('campaign');
        const newColor = $btn.data('color');

        // Update data
        campaignManager.updateCampaignColor(campaignId, newColor);

        // Update icon color in place
        const $header = $picker.closest('.rpg-lb-campaign-header');
        const $iconEl = $header.find('.rpg-lb-campaign-icon');
        $iconEl.css('color', newColor || '');

        // Highlight selected
        $picker.find('.rpg-lb-color-swatch').removeClass('selected');
        $btn.addClass('selected');

        // Close picker
        $picker.fadeOut(150, () => $picker.remove());
    });

    // Close picker when clicking elsewhere in modal
    $modal.on('click', function (e) {
        if (!$(e.target).closest('.rpg-lb-icon-picker, .rpg-lb-campaign-icon').length) {
            $modal.find('.rpg-lb-icon-picker').fadeOut(150, function () { $(this).remove(); });
        }
    });

    // ── Import button → trigger hidden file input ────────────────────────────
    $modal.on('click', '.rpg-lb-btn-import', function () {
        $modal.find('.rpg-lb-import-file').trigger('click');
    });

    // ── File selected → import and re-render ─────────────────────────────────
    $modal.on('change', '.rpg-lb-import-file', async function (e) {
        const file = e.target.files[0];
        if (!file) return;
        await lorebookAPI.importWorld(file);
        e.target.value = ''; // allow re-selecting same file
        renderLorebook();
    });

    // ── Per-book export button ───────────────────────────────────────────────
    $modal.on('click', '.rpg-lb-spine-export', async function (e) {
        e.stopPropagation(); // don't toggle spine expand
        const worldName = $(this).data('world');
        await lorebookAPI.exportWorld(worldName);
    });
}

/**
 * Processes a field change event and persists the update.
 *
 * @param {JQuery} $el - The changed input/select element
 */
async function handleFieldChange($el) {
    const worldName = $el.data('world');
    const uid = Number($el.data('uid'));
    const field = $el.data('field');

    if (!worldName || uid === undefined || !field) return;

    const data = await lorebookAPI.loadWorldData(worldName);
    if (!data) return;

    const value = parseFieldValue(field, $el.is(':checkbox') ? $el.prop('checked') : $el.val(), $el);
    lorebookAPI.updateEntryField(data, uid, field, value);

    // Position changes: also set role from data-role attribute + toggle outlet row
    if (field === 'position') {
        const $selected = $el.find('option:selected');
        const roleStr = $selected.data('role');
        if (roleStr !== '' && roleStr !== undefined) {
            lorebookAPI.updateEntryField(data, uid, 'role', Number(roleStr));
        }
        // Show/hide outlet name row
        const $entry = $el.closest('.rpg-lb-entry');
        const $outletRow = $entry.find('.rpg-lb-outlet-row');
        if (Number(value) === 7) {
            $outletRow.slideDown(200);
        } else {
            $outletRow.slideUp(200);
        }
    }

    await lorebookAPI.saveWorldData(worldName, data);
}

/**
 * Parses a raw field value into the correct type for the WI data model.
 *
 * @param {string} field - Field name
 * @param {*} rawValue - Raw value from the input element
 * @param {JQuery} $el - The source element (for checkbox detection)
 * @returns {*} Parsed value
 */
function parseFieldValue(field, rawValue, $el) {
    // Comma-separated array fields
    if (field === 'key' || field === 'keysecondary') {
        return String(rawValue).split(',').map(s => s.trim()).filter(Boolean);
    }

    // Tri-state selects (null / true / false)
    if (field === 'caseSensitive' || field === 'matchWholeWords' || field === 'useGroupScoring') {
        if (rawValue === 'null') return null;
        if (rawValue === 'true') return true;
        if (rawValue === 'false') return false;
        return rawValue;
    }

    // Numeric fields
    const numericFields = [
        'position', 'depth', 'role', 'selectiveLogic', 'order',
        'probability', 'scanDepth', 'groupWeight', 'sticky',
        'cooldown', 'delay', 'delayUntilRecursion',
    ];
    if (numericFields.includes(field)) {
        const num = Number(rawValue);
        return isNaN(num) ? undefined : num;
    }

    // Boolean checkbox fields
    const boolFields = [
        'selective', 'constant', 'excludeRecursion', 'preventRecursion',
        'ignoreBudget', 'useProbability', 'groupOverride', 'disable',
    ];
    if (boolFields.includes(field)) {
        return $el.is(':checkbox') ? $el.prop('checked') : Boolean(rawValue);
    }

    // Default: string
    return rawValue;
}
