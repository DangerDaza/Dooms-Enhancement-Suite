/**
 * Lorebook Graph (Web) View
 * Interactive force-directed graph showing lorebook entries as nodes
 * connected by shared keywords and inclusion groups.
 * Uses vis-network for rendering.
 */
import * as lorebookAPI from '../lorebook/lorebookAPI.js';
import * as campaignManager from '../lorebook/campaignManager.js';
import { loadFileToDocument } from '../../../../../../../scripts/utils.js';
import { extensionSettings } from '../../core/state.js';
import { saveSettings } from '../../core/persistence.js';

// ─── Module State ────────────────────────────────────────────────────────────

let network = null;
let visLoaded = false;
let graphData = { nodes: null, edges: null };
let selectedNodeId = null;
let graphScope = 'all'; // 'all' | campaignId | worldName
let graphFilters = { keywords: true, groups: true, showEntries: false };
let bookVisibility = {}; // { bookName: boolean } — per-book filter
let isolatedNodeId = null; // When set, only show this node + neighbors
let allEntriesCache = [];

const EXTENSION_PATH = 'scripts/extensions/third-party/Dooms-Enhancement-Suite';

// ─── Node Colors ─────────────────────────────────────────────────────────────

// Fallback palette for unfiled books
const UNFILED_COLORS = [
    '#78909c', '#8d6e63', '#90a4ae', '#a1887f', '#b0bec5',
];

// Cache: bookName → campaign color
let bookColorCache = {};

function buildBookColorCache() {
    bookColorCache = {};
    const campaigns = campaignManager.getCampaignsInOrder();
    const allNames = lorebookAPI.getAllWorldNames();
    const assigned = new Set();

    for (const { campaign } of campaigns) {
        const color = campaign.color || '#4a7ba7';
        for (const bookName of (campaign.books || [])) {
            if (allNames.includes(bookName)) {
                bookColorCache[bookName] = color;
                assigned.add(bookName);
            }
        }
    }

    // Unfiled books get grey-ish fallback colors
    let unfiledIdx = 0;
    for (const name of allNames) {
        if (!assigned.has(name)) {
            bookColorCache[name] = UNFILED_COLORS[unfiledIdx % UNFILED_COLORS.length];
            unfiledIdx++;
        }
    }
}

function getBookColor(bookName) {
    return bookColorCache[bookName] || '#78909c';
}

// ─── Lazy Load vis-network ───────────────────────────────────────────────────

async function ensureVisLoaded() {
    if (visLoaded) return;
    await loadFileToDocument(`${EXTENSION_PATH}/lib/vis-network/vis-network.min.css`, 'css');
    await loadFileToDocument(`${EXTENSION_PATH}/lib/vis-network/vis-network.min.js`, 'js');
    visLoaded = true;
}

// ─── Data Loading ────────────────────────────────────────────────────────────

async function loadMultipleWorldData(names) {
    const results = {};
    await Promise.all(names.map(async (name) => {
        results[name] = await lorebookAPI.loadWorldData(name);
    }));
    return results;
}

function getScopeBooks() {
    const allNames = lorebookAPI.getAllWorldNames();
    if (graphScope === 'all') return allNames;

    // Check if it's a single book name
    if (allNames.includes(graphScope)) return [graphScope];

    // Check if it's a campaign ID
    const campaigns = campaignManager.getCampaignsInOrder();
    const campaign = campaigns.find(c => c.id === graphScope);
    if (campaign) {
        return (campaign.campaign.books || []).filter(b => allNames.includes(b));
    }

    return allNames;
}

// ─── Campaign Book Lookup ────────────────────────────────────────────────

function getCampaignBooks(campaignId) {
    const allNames = lorebookAPI.getAllWorldNames();
    if (campaignId === '__unfiled__') {
        const assigned = new Set();
        for (const { campaign } of campaignManager.getCampaignsInOrder()) {
            for (const b of (campaign.books || [])) assigned.add(b);
        }
        return allNames.filter(b => !assigned.has(b));
    }
    const campaigns = campaignManager.getCampaignsInOrder();
    const match = campaigns.find(c => c.id === campaignId);
    if (match) {
        return (match.campaign.books || []).filter(b => allNames.includes(b));
    }
    return [];
}

// ─── Graph Computation ───────────────────────────────────────────────────────

function computeGraphData(worldDataMap) {
    if (graphFilters.showEntries) {
        return computeEntryGraph(worldDataMap);
    }
    return computeBookGraph(worldDataMap);
}

/**
 * Book-level graph: one node per lorebook, edges for shared keywords between books
 */
function computeBookGraph(worldDataMap) {
    const allBooks = Object.keys(worldDataMap);
    const nodes = [];
    const edges = [];
    const activeNames = lorebookAPI.getActiveWorldNames();

    // Build keyword-to-books index
    const bookKeywords = {}; // bookName → Set of keywords
    const bookEntryCount = {};
    const bookTokens = {};

    for (const [bookName, data] of Object.entries(worldDataMap)) {
        if (!data?.entries) continue;
        bookKeywords[bookName] = new Set();
        const sorted = lorebookAPI.getEntriesSorted(data);
        bookEntryCount[bookName] = sorted.length;
        let totalTokens = 0;
        for (const { entry } of sorted) {
            totalTokens += Math.round((entry.content || '').length / 3.5);
            for (const k of [...(entry.key || []), ...(entry.keysecondary || [])]) {
                const normalized = k.trim().toLowerCase();
                if (normalized) bookKeywords[bookName].add(normalized);
            }
        }
        bookTokens[bookName] = totalTokens;
    }

    // Create book nodes
    for (const bookName of allBooks) {
        const isActive = activeNames.includes(bookName);
        const bookColor = getBookColor(bookName);
        const entryCount = bookEntryCount[bookName] || 0;
        const tokens = bookTokens[bookName] || 0;
        const size = Math.max(20, Math.min(60, 20 + entryCount / 2));

        nodes.push({
            id: `book::${bookName}`,
            label: bookName.length > 25 ? bookName.substring(0, 23) + '...' : bookName,
            title: `${bookName}\n${entryCount} entries\n${tokens} tokens`,
            size,
            color: {
                background: isActive ? bookColor : '#555',
                border: bookColor,
                highlight: { background: bookColor, border: '#fff' },
            },
            borderWidth: 2,
            borderWidthSelected: 3,
            font: { color: isActive ? '#e0e0e0' : '#888', size: 13 },
            shape: 'dot',
            opacity: isActive ? 1.0 : 0.5,
            _meta: { bookName, uid: null, entry: null, state: isActive ? 'enabled' : 'disabled', tokenEst: tokens, fullTitle: bookName, isBook: true, entryCount },
        });
    }

    // Compute edges between books based on shared keywords
    const edgeSet = new Set();
    if (graphFilters.keywords) {
        for (let i = 0; i < allBooks.length; i++) {
            for (let j = i + 1; j < allBooks.length; j++) {
                const a = allBooks[i];
                const b = allBooks[j];
                const keysA = bookKeywords[a] || new Set();
                const keysB = bookKeywords[b] || new Set();
                const shared = [...keysA].filter(k => keysB.has(k));
                if (shared.length > 0) {
                    const edgeKey = [a, b].sort().join('|');
                    if (!edgeSet.has(edgeKey)) {
                        edgeSet.add(edgeKey);
                        edges.push({
                            from: `book::${a}`,
                            to: `book::${b}`,
                            label: `${shared.length} shared`,
                            title: shared.slice(0, 10).join(', ') + (shared.length > 10 ? '...' : ''),
                            color: { color: 'rgba(74, 123, 167, 0.4)', highlight: 'rgba(74, 123, 167, 0.8)' },
                            font: { color: '#888', size: 0, strokeWidth: 0 },
                            width: Math.min(8, 1 + shared.length / 5),
                            _type: 'keyword',
                        });
                    }
                }
            }
        }
    }

    // Inclusion group edges between books
    if (graphFilters.groups) {
        const bookGroups = {}; // bookName → Set of group names
        for (const [bookName, data] of Object.entries(worldDataMap)) {
            if (!data?.entries) continue;
            bookGroups[bookName] = new Set();
            const sorted = lorebookAPI.getEntriesSorted(data);
            for (const { entry } of sorted) {
                const g = (entry.group || '').trim();
                if (g) bookGroups[bookName].add(g);
            }
        }
        for (let i = 0; i < allBooks.length; i++) {
            for (let j = i + 1; j < allBooks.length; j++) {
                const a = allBooks[i];
                const b = allBooks[j];
                const groupsA = bookGroups[a] || new Set();
                const groupsB = bookGroups[b] || new Set();
                const shared = [...groupsA].filter(g => groupsB.has(g));
                if (shared.length > 0) {
                    const edgeKey = [a, b].sort().join('|group|');
                    if (!edgeSet.has(edgeKey)) {
                        edgeSet.add(edgeKey);
                        edges.push({
                            from: `book::${a}`,
                            to: `book::${b}`,
                            label: shared.join(', '),
                            dashes: true,
                            color: { color: 'rgba(171, 71, 188, 0.5)', highlight: 'rgba(171, 71, 188, 0.8)' },
                            font: { color: '#ab47bc', size: 0, strokeWidth: 0 },
                            width: Math.min(6, 1 + shared.length),
                            _type: 'group',
                        });
                    }
                }
            }
        }
    }

    allEntriesCache = allBooks.map(b => ({ id: `book::${b}`, bookName: b }));
    return { nodes, edges };
}

/**
 * Entry-level graph: one node per entry, edges for shared keywords/groups between entries
 */
function computeEntryGraph(worldDataMap) {
    const allBooks = Object.keys(worldDataMap);
    const entries = [];
    const nodes = [];
    const edges = [];

    // Flatten all entries
    for (const [bookName, data] of Object.entries(worldDataMap)) {
        if (!data?.entries) continue;
        const sorted = lorebookAPI.getEntriesSorted(data);
        for (const { uid, entry } of sorted) {
            const id = `${bookName}::${uid}`;
            const title = entry.comment || entry.key?.join(', ') || `Entry ${uid}`;
            const tokenEst = Math.round((entry.content || '').length / 3.5);
            const bookColor = getBookColor(bookName);

            let state = 'enabled';
            if (entry.disable) state = 'disabled';
            else if (entry.constant) state = 'constant';
            else if (entry.vectorized) state = 'vectorized';

            const size = Math.max(12, Math.min(40, 12 + tokenEst / 50));

            nodes.push({
                id,
                label: title.length > 30 ? title.substring(0, 28) + '...' : title,
                title: `${title}\n${bookName}\n${tokenEst} tokens`,
                size,
                color: {
                    background: state === 'disabled' ? '#555' : bookColor,
                    border: state === 'constant' ? '#42a5f5' : state === 'vectorized' ? '#ab47bc' : bookColor,
                    highlight: { background: bookColor, border: '#fff' },
                },
                borderWidth: state === 'constant' || state === 'vectorized' ? 3 : 1,
                borderWidthSelected: 3,
                font: { color: state === 'disabled' ? '#888' : '#e0e0e0', size: 11 },
                shape: state === 'constant' ? 'diamond' : 'dot',
                opacity: state === 'disabled' ? 0.5 : 1.0,
                _meta: { bookName, uid, entry, state, tokenEst, fullTitle: title },
            });

            entries.push({ id, entry, bookName });
        }
    }

    // Keyword edges
    const keywordIndex = {};
    for (const item of entries) {
        for (const k of [...(item.entry.key || []), ...(item.entry.keysecondary || [])]) {
            const normalized = k.trim().toLowerCase();
            if (!normalized) continue;
            if (!keywordIndex[normalized]) keywordIndex[normalized] = [];
            keywordIndex[normalized].push(item.id);
        }
    }

    const edgeSet = new Set();
    if (graphFilters.keywords) {
        for (const [keyword, ids] of Object.entries(keywordIndex)) {
            if (ids.length < 2 || ids.length > 20) continue;
            for (let i = 0; i < ids.length; i++) {
                for (let j = i + 1; j < ids.length; j++) {
                    const edgeKey = [ids[i], ids[j]].sort().join('|');
                    if (!edgeSet.has(edgeKey)) {
                        edgeSet.add(edgeKey);
                        edges.push({
                            from: ids[i], to: ids[j], label: keyword,
                            color: { color: 'rgba(74, 123, 167, 0.3)', highlight: 'rgba(74, 123, 167, 0.8)' },
                            font: { color: '#888', size: 0, strokeWidth: 0 },
                            width: 1, _type: 'keyword',
                        });
                    }
                }
            }
        }
    }

    // Inclusion group edges
    if (graphFilters.groups) {
        const groupIndex = {};
        for (const item of entries) {
            const g = (item.entry.group || '').trim();
            if (!g) continue;
            if (!groupIndex[g]) groupIndex[g] = [];
            groupIndex[g].push(item.id);
        }
        for (const [group, ids] of Object.entries(groupIndex)) {
            for (let i = 0; i < ids.length; i++) {
                for (let j = i + 1; j < ids.length; j++) {
                    const edgeKey = [ids[i], ids[j]].sort().join('|group|');
                    if (!edgeSet.has(edgeKey)) {
                        edgeSet.add(edgeKey);
                        edges.push({
                            from: ids[i], to: ids[j], label: group, dashes: true,
                            color: { color: 'rgba(171, 71, 188, 0.4)', highlight: 'rgba(171, 71, 188, 0.8)' },
                            font: { color: '#ab47bc', size: 0, strokeWidth: 0 },
                            width: 2, _type: 'group',
                        });
                    }
                }
            }
        }
    }

    allEntriesCache = entries;
    return { nodes, edges };
}

// ─── HTML Builder ────────────────────────────────────────────────────────────

function buildGraphHTML() {
    const campaigns = campaignManager.getCampaignsInOrder();
    const allNames = lorebookAPI.getAllWorldNames();
    const activeNames = lorebookAPI.getActiveWorldNames();

    let html = '<div class="rpg-lb-graph-layout">';

    // ── Left Sidebar ──
    html += '<div class="rpg-lb-graph-sidebar">';

    // Scope selector
    html += '<div class="rpg-lb-graph-section">';
    html += '<label class="rpg-lb-graph-label">Scope</label>';
    html += '<select class="rpg-lb-graph-scope">';
    html += `<option value="all" ${graphScope === 'all' ? 'selected' : ''}>All Lorebooks</option>`;
    for (const { id, campaign } of campaigns) {
        const books = (campaign.books || []).filter(b => allNames.includes(b));
        if (books.length === 0) continue;
        html += `<option value="${id}" ${graphScope === id ? 'selected' : ''}>${campaign.name} (${books.length})</option>`;
    }
    html += '</select>';
    html += '</div>';

    // Filters
    html += '<div class="rpg-lb-graph-section">';
    html += '<label class="rpg-lb-graph-label">Display</label>';
    html += `<label class="rpg-lb-graph-checkbox"><input type="checkbox" data-filter="showEntries" ${graphFilters.showEntries ? 'checked' : ''}> Show Entries</label>`;
    html += `<label class="rpg-lb-graph-checkbox"><input type="checkbox" data-filter="keywords" ${graphFilters.keywords ? 'checked' : ''}> Shared Keywords</label>`;
    html += `<label class="rpg-lb-graph-checkbox"><input type="checkbox" data-filter="groups" ${graphFilters.groups ? 'checked' : ''}> Inclusion Groups</label>`;
    html += '</div>';

    // Layout controls
    html += '<div class="rpg-lb-graph-section">';
    html += '<label class="rpg-lb-graph-label">Layout</label>';
    html += '<div class="rpg-lb-graph-slider-row">';
    html += '<span class="rpg-lb-graph-slider-label">Spacing</span>';
    html += '<input type="range" class="rpg-lb-graph-slider" data-param="spacing" min="30" max="400" value="120" step="10">';
    html += '</div>';
    html += '<div class="rpg-lb-graph-slider-row">';
    html += '<span class="rpg-lb-graph-slider-label">Repulsion</span>';
    html += '<input type="range" class="rpg-lb-graph-slider" data-param="repulsion" min="-10000" max="-500" value="-3000" step="100">';
    html += '</div>';
    html += '<button class="rpg-lb-graph-relayout-btn"><i class="fa-solid fa-arrows-rotate"></i> Re-layout</button>';
    html += '</div>';

    // Legend
    html += '<div class="rpg-lb-graph-section">';
    html += '<label class="rpg-lb-graph-label">Legend</label>';
    html += '<div class="rpg-lb-graph-legend">';
    // Node types
    html += '<div class="rpg-lb-graph-legend-item"><span class="rpg-lb-legend-shape rpg-lb-legend-dot"></span> Enabled Entry</div>';
    html += '<div class="rpg-lb-graph-legend-item"><span class="rpg-lb-legend-shape rpg-lb-legend-diamond"></span> Constant Entry</div>';
    html += '<div class="rpg-lb-graph-legend-item"><span class="rpg-lb-legend-shape rpg-lb-legend-dot rpg-lb-legend-disabled"></span> Disabled Entry</div>';
    html += '<div class="rpg-lb-graph-legend-item"><span class="rpg-lb-legend-shape rpg-lb-legend-dot rpg-lb-legend-vectorized"></span> Vectorized Entry</div>';
    html += '<div class="rpg-lb-graph-legend-item"><span class="rpg-lb-legend-shape rpg-lb-legend-book"></span> Lorebook (grouped)</div>';
    // Edge types
    html += '<div class="rpg-lb-graph-legend-sep"></div>';
    html += '<div class="rpg-lb-graph-legend-item"><span class="rpg-lb-legend-line rpg-lb-legend-keyword"></span> Shared Keyword</div>';
    html += '<div class="rpg-lb-graph-legend-item"><span class="rpg-lb-legend-line rpg-lb-legend-group"></span> Inclusion Group</div>';
    html += '</div>';
    html += '</div>';

    // Library (campaign) list with visibility toggles
    html += '<div class="rpg-lb-graph-section">';
    html += '<label class="rpg-lb-graph-label">Lore Libraries <button class="rpg-lb-graph-books-toggle-all" title="Toggle all">All</button></label>';
    html += '<div class="rpg-lb-graph-book-list">';
    const scopeBooks = getScopeBooks();
    // Initialize visibility for all books
    for (const name of scopeBooks) {
        if (bookVisibility[name] === undefined) bookVisibility[name] = true;
    }

    // Build campaign-level entries
    const assignedBooks = new Set();
    for (const { id, campaign } of campaigns) {
        const books = (campaign.books || []).filter(b => scopeBooks.includes(b));
        if (books.length === 0) continue;
        books.forEach(b => assignedBooks.add(b));

        const activeCount = books.filter(b => activeNames.includes(b)).length;
        const allVisible = books.every(b => bookVisibility[b] !== false);
        const iconClass = campaign.icon || 'fa-folder';
        const iconColor = campaign.color ? ` style="color: ${campaign.color};"` : '';
        const shortName = campaign.name.length > 22 ? campaign.name.substring(0, 20) + '...' : campaign.name;

        html += `<div class="rpg-lb-graph-book-item rpg-lb-graph-library-item ${activeCount > 0 ? 'active' : ''} ${!allVisible ? 'filtered-out' : ''}" data-campaign="${id}" title="${campaign.name} (${books.length} books)">`;
        html += `<input type="checkbox" class="rpg-lb-graph-library-toggle" data-campaign="${id}" ${allVisible ? 'checked' : ''}>`;
        html += `<i class="fa-solid ${iconClass}"${iconColor}></i>`;
        html += `<span class="rpg-lb-graph-book-name">${shortName}</span>`;
        html += `<span class="rpg-lb-graph-library-count">${activeCount}/${books.length}</span>`;
        html += '</div>';
    }

    // Unfiled books
    const unfiledBooks = scopeBooks.filter(b => !assignedBooks.has(b));
    if (unfiledBooks.length > 0) {
        const activeCount = unfiledBooks.filter(b => activeNames.includes(b)).length;
        const allVisible = unfiledBooks.every(b => bookVisibility[b] !== false);

        html += `<div class="rpg-lb-graph-book-item rpg-lb-graph-library-item ${activeCount > 0 ? 'active' : ''} ${!allVisible ? 'filtered-out' : ''}" data-campaign="__unfiled__" title="Unfiled (${unfiledBooks.length} books)">`;
        html += `<input type="checkbox" class="rpg-lb-graph-library-toggle" data-campaign="__unfiled__" ${allVisible ? 'checked' : ''}>`;
        html += `<i class="fa-solid fa-folder-open"></i>`;
        html += `<span class="rpg-lb-graph-book-name">Unfiled</span>`;
        html += `<span class="rpg-lb-graph-library-count">${activeCount}/${unfiledBooks.length}</span>`;
        html += '</div>';
    }

    html += '</div>';
    html += '</div>';

    // Isolate indicator (hidden by default)
    html += '<div class="rpg-lb-graph-section rpg-lb-graph-isolate-indicator" style="display:none;">';
    html += '<label class="rpg-lb-graph-label">Isolated View</label>';
    html += '<button class="rpg-lb-graph-clear-isolate"><i class="fa-solid fa-arrows-rotate"></i> Show All Nodes</button>';
    html += '</div>';

    // Stats
    html += '<div class="rpg-lb-graph-section rpg-lb-graph-stats">';
    html += '<span class="rpg-lb-graph-stat" id="rpg-lb-graph-node-count">Nodes: 0</span>';
    html += '<span class="rpg-lb-graph-stat" id="rpg-lb-graph-edge-count">Edges: 0</span>';
    html += '</div>';

    html += '</div>'; // end sidebar

    // ── Canvas Area ──
    html += '<div class="rpg-lb-graph-canvas-wrap">';
    html += '<div id="rpg-lb-graph-canvas"></div>';

    // Loading indicator
    html += '<div class="rpg-lb-graph-loading" id="rpg-lb-graph-loading">';
    html += '<i class="fa-solid fa-spinner fa-spin"></i> Building constellation...';
    html += '</div>';

    // Zoom controls
    html += '<div class="rpg-lb-graph-controls">';
    html += '<button class="rpg-lb-graph-ctrl-btn" data-action="zoom-in" title="Zoom in"><i class="fa-solid fa-plus"></i></button>';
    html += '<button class="rpg-lb-graph-ctrl-btn" data-action="zoom-out" title="Zoom out"><i class="fa-solid fa-minus"></i></button>';
    html += '<button class="rpg-lb-graph-ctrl-btn" data-action="fit" title="Fit all"><i class="fa-solid fa-expand"></i></button>';
    html += '</div>';

    // Right-click context menu (hidden by default)
    html += '<div class="rpg-lb-graph-context-menu" id="rpg-lb-graph-context-menu">';
    html += '<div class="rpg-lb-graph-ctx-item" data-action="isolate"><i class="fa-solid fa-crosshairs"></i> Isolate</div>';
    html += '<div class="rpg-lb-graph-ctx-item" data-action="open-editor"><i class="fa-solid fa-pen-to-square"></i> Open in Editor</div>';
    html += '</div>';

    // Detail panel (hidden by default)
    html += '<div class="rpg-lb-graph-detail" id="rpg-lb-graph-detail">';
    html += '<div class="rpg-lb-graph-detail-content"></div>';
    html += '</div>';

    html += '</div>'; // end canvas-wrap

    html += '</div>'; // end graph-layout
    return html;
}

function renderDetailPanel(nodeData) {
    const panel = document.getElementById('rpg-lb-graph-detail');
    if (!panel) return;

    const meta = nodeData._meta;

    // Book-level node detail
    if (meta.isBook) {
        let html = '<div class="rpg-lb-graph-detail-inner">';
        html += `<div class="rpg-lb-graph-detail-header">`;
        html += `<span class="rpg-lb-graph-detail-state rpg-lb-graph-detail-state--${meta.state}"></span>`;
        html += `<h4>${meta.fullTitle}</h4>`;
        html += `<button class="rpg-lb-graph-detail-close"><i class="fa-solid fa-xmark"></i></button>`;
        html += '</div>';
        html += '<div class="rpg-lb-graph-detail-badges">';
        html += `<span class="rpg-lb-graph-badge">${meta.entryCount} entries</span>`;
        html += `<span class="rpg-lb-graph-badge">${meta.tokenEst}t total</span>`;
        html += '</div>';
        html += `<button class="rpg-lb-graph-open-editor" data-world="${meta.bookName}" data-uid="">`;
        html += '<i class="fa-solid fa-pen-to-square"></i> Open in Editor';
        html += '</button>';
        html += '</div>';
        panel.querySelector('.rpg-lb-graph-detail-content').innerHTML = html;
        panel.classList.add('visible');
        return;
    }

    // Entry-level node detail
    const entry = meta.entry;
    const contentPreview = (entry.content || '').substring(0, 300);
    const keywords = [...(entry.key || [])];
    const secondaryKeys = [...(entry.keysecondary || [])];

    const posBadgeMap = {
        0: '↑Char', 1: '↓Char', 2: '↑AN', 3: '↓AN',
        4: '@D', 5: '↑EM', 6: '↓EM', 7: 'Outlet',
    };

    let html = '<div class="rpg-lb-graph-detail-inner">';

    // Header
    html += `<div class="rpg-lb-graph-detail-header">`;
    html += `<span class="rpg-lb-graph-detail-state rpg-lb-graph-detail-state--${meta.state}"></span>`;
    html += `<h4>${meta.fullTitle}</h4>`;
    html += `<button class="rpg-lb-graph-detail-close"><i class="fa-solid fa-xmark"></i></button>`;
    html += '</div>';

    // Book name
    html += `<div class="rpg-lb-graph-detail-book"><i class="fa-solid fa-book"></i> ${meta.bookName}</div>`;

    // Position / Depth badges
    html += '<div class="rpg-lb-graph-detail-badges">';
    html += `<span class="rpg-lb-graph-badge">Position: ${posBadgeMap[entry.position] || '?'}</span>`;
    if (entry.position === 4) {
        html += `<span class="rpg-lb-graph-badge">Depth: ${entry.depth ?? 4}</span>`;
    }
    html += `<span class="rpg-lb-graph-badge">${meta.tokenEst}t</span>`;
    if (entry.order !== undefined) html += `<span class="rpg-lb-graph-badge">Order: ${entry.order}</span>`;
    html += '</div>';

    // Keywords
    if (keywords.length > 0) {
        html += '<div class="rpg-lb-graph-detail-section">';
        html += '<label>Keywords</label>';
        html += '<div class="rpg-lb-graph-tags">';
        for (const k of keywords) {
            html += `<span class="rpg-lb-graph-tag">${k}</span>`;
        }
        html += '</div></div>';
    }

    // Secondary keywords
    if (secondaryKeys.length > 0) {
        html += '<div class="rpg-lb-graph-detail-section">';
        html += '<label>Secondary Keys</label>';
        html += '<div class="rpg-lb-graph-tags">';
        for (const k of secondaryKeys) {
            html += `<span class="rpg-lb-graph-tag rpg-lb-graph-tag--secondary">${k}</span>`;
        }
        html += '</div></div>';
    }

    // Inclusion group
    if (entry.group) {
        html += '<div class="rpg-lb-graph-detail-section">';
        html += `<label>Inclusion Group</label>`;
        html += `<div class="rpg-lb-graph-detail-group"><i class="fa-solid fa-layer-group"></i> ${entry.group}</div>`;
        html += '</div>';
    }

    // Content preview
    if (contentPreview) {
        html += '<div class="rpg-lb-graph-detail-section">';
        html += '<label>Content</label>';
        html += `<div class="rpg-lb-graph-detail-content-preview">${contentPreview}${entry.content?.length > 300 ? '...' : ''}</div>`;
        html += '</div>';
    }

    // Open in editor button
    html += `<button class="rpg-lb-graph-open-editor" data-world="${meta.bookName}" data-uid="${meta.uid}">`;
    html += '<i class="fa-solid fa-pen-to-square"></i> Open in Editor';
    html += '</button>';

    html += '</div>';

    panel.querySelector('.rpg-lb-graph-detail-content').innerHTML = html;
    panel.classList.add('visible');
}

function hideDetailPanel() {
    const panel = document.getElementById('rpg-lb-graph-detail');
    if (panel) panel.classList.remove('visible');
    selectedNodeId = null;
}

// ─── Network Init ────────────────────────────────────────────────────────────

function initNetwork(container, data) {
    const options = {
        nodes: {
            font: { face: 'Inter, sans-serif', size: 11 },
            scaling: {
                label: { enabled: true, min: 8, max: 14 },
            },
        },
        edges: {
            smooth: { type: 'continuous' },
            hoverWidth: 2,
            selectionWidth: 2,
            font: { size: 0, strokeWidth: 0 }, // Hide edge labels by default
        },
        physics: {
            solver: 'barnesHut',
            barnesHut: {
                gravitationalConstant: -3000,
                centralGravity: 0.1,
                springLength: 120,
                springConstant: 0.02,
                damping: 0.3,
                avoidOverlap: 0.2,
            },
            stabilization: {
                enabled: true,
                iterations: 200,
                updateInterval: 25,
            },
        },
        interaction: {
            hover: true,
            tooltipDelay: 200,
            zoomView: true,
            dragView: true,
        },
        layout: {
            improvedLayout: true,
        },
    };

    const visData = {
        nodes: new vis.DataSet(data.nodes),
        edges: new vis.DataSet(data.edges),
    };

    graphData = visData;
    network = new vis.Network(container, visData, options);

    // Update stats
    updateStats(data.nodes.length, data.edges.length);

    // Hide loading after stabilization
    network.on('stabilizationIterationsDone', () => {
        const loading = document.getElementById('rpg-lb-graph-loading');
        if (loading) loading.style.display = 'none';
        network.setOptions({ physics: { stabilization: { enabled: false } } });
    });

    // Zoom-based label visibility — hide node labels when zoomed out
    let lastLabelState = true;
    network.on('zoom', () => {
        const scale = network.getScale();
        const showLabels = scale > 0.4;
        if (showLabels !== lastLabelState) {
            lastLabelState = showLabels;
            const allNodes = graphData.nodes.get();
            const updates = allNodes.map(n => ({
                id: n.id,
                font: {
                    ...n.font,
                    color: showLabels ? (n._meta?.state === 'disabled' ? '#888' : '#e0e0e0') : 'transparent',
                },
            }));
            graphData.nodes.update(updates);
        }
    });

    // Click node → show detail + show connected edge labels
    network.on('click', (params) => {
        // Reset all edge labels to hidden
        const allEdges = graphData.edges.get();
        graphData.edges.update(allEdges.map(e => ({
            id: e.id,
            font: { ...e.font, size: 0 },
        })));

        if (params.nodes.length > 0) {
            const nodeId = params.nodes[0];
            const nodeData = graphData.nodes.get(nodeId);
            if (nodeData) {
                selectedNodeId = nodeId;
                renderDetailPanel(nodeData);

                // Show edge labels for connected edges only
                const connectedEdges = network.getConnectedEdges(nodeId);
                graphData.edges.update(connectedEdges.map(eid => {
                    const edge = graphData.edges.get(eid);
                    return {
                        id: eid,
                        font: { ...edge.font, size: 9 },
                    };
                }));
            }
        } else {
            hideDetailPanel();
        }
    });

    // Double-click → open in list view
    network.on('doubleClick', (params) => {
        if (params.nodes.length > 0) {
            const nodeData = graphData.nodes.get(params.nodes[0]);
            if (nodeData?._meta) {
                // Switch to list view with this entry selected
                const lb = extensionSettings.lorebook || {};
                lb.viewMode = 'list';
                saveSettings();
                // Import renderLorebook dynamically to avoid circular dep
                import('./lorebook.js').then(mod => {
                    mod.setSelectedBookAndEntry(nodeData._meta.bookName, nodeData._meta.uid);
                    mod.renderLorebook();
                });
            }
        }
    });

    // Right-click context menu — attach directly to the canvas element
    const canvasEl = container.querySelector('canvas');
    if (canvasEl) {
        canvasEl.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const rect = container.getBoundingClientRect();
            const pointer = { x: e.clientX - rect.left, y: e.clientY - rect.top };
            const nodeId = network.getNodeAt(pointer);
            const ctxMenu = document.getElementById('rpg-lb-graph-context-menu');
            if (!ctxMenu) return;

            if (!nodeId) {
                ctxMenu.style.display = 'none';
                return;
            }

            ctxMenu.style.left = e.clientX + 'px';
            ctxMenu.style.top = e.clientY + 'px';
            ctxMenu.style.display = 'block';
            ctxMenu.dataset.nodeId = nodeId;
        });
    }

    return network;
}

function updateStats(nodeCount, edgeCount) {
    const nodeEl = document.getElementById('rpg-lb-graph-node-count');
    const edgeEl = document.getElementById('rpg-lb-graph-edge-count');
    if (nodeEl) nodeEl.textContent = `Nodes: ${nodeCount}`;
    if (edgeEl) edgeEl.textContent = `Edges: ${edgeCount}`;
}

// ─── Event Setup ─────────────────────────────────────────────────────────────

function setupGraphEvents() {
    const modal = document.getElementById('rpg-lorebook-modal');
    if (!modal) return;

    // Scope selector
    modal.querySelector('.rpg-lb-graph-scope')?.addEventListener('change', async (e) => {
        graphScope = e.target.value;
        await rebuildGraph();
    });

    // Filter checkboxes
    modal.querySelectorAll('.rpg-lb-graph-checkbox input').forEach(cb => {
        cb.addEventListener('change', async (e) => {
            graphFilters[e.target.dataset.filter] = e.target.checked;
            await rebuildGraph();
        });
    });

    // Layout sliders — update physics in real-time
    modal.querySelectorAll('.rpg-lb-graph-slider').forEach(slider => {
        slider.addEventListener('input', () => {
            if (!network) return;
            const param = slider.dataset.param;
            const val = Number(slider.value);
            if (param === 'spacing') {
                network.setOptions({ physics: { barnesHut: { springLength: val } } });
            } else if (param === 'repulsion') {
                network.setOptions({ physics: { barnesHut: { gravitationalConstant: val } } });
            }
        });
    });

    // Re-layout button — restart physics stabilization
    modal.querySelector('.rpg-lb-graph-relayout-btn')?.addEventListener('click', () => {
        if (!network) return;
        network.setOptions({ physics: { stabilization: { enabled: true, iterations: 200 } } });
        network.stabilize(200);
    });

    // Zoom controls
    modal.querySelectorAll('.rpg-lb-graph-ctrl-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            if (!network) return;
            const action = btn.dataset.action;
            if (action === 'zoom-in') {
                const scale = network.getScale();
                network.moveTo({ scale: scale * 1.3 });
            } else if (action === 'zoom-out') {
                const scale = network.getScale();
                network.moveTo({ scale: scale / 1.3 });
            } else if (action === 'fit') {
                network.fit({ animation: true });
            }
        });
    });

    // Detail panel close
    modal.addEventListener('click', (e) => {
        if (e.target.closest('.rpg-lb-graph-detail-close')) {
            hideDetailPanel();
            if (network) network.unselectAll();
        }
    });

    // Open in editor from detail panel
    modal.addEventListener('click', (e) => {
        const btn = e.target.closest('.rpg-lb-graph-open-editor');
        if (!btn) return;
        const worldName = btn.dataset.world;
        const uid = Number(btn.dataset.uid);
        const lb = extensionSettings.lorebook || {};
        lb.viewMode = 'list';
        saveSettings();
        import('./lorebook.js').then(mod => {
            mod.setSelectedBookAndEntry(worldName, uid);
            mod.renderLorebook();
        });
    });

    // Library name click in sidebar → focus on that library's nodes
    modal.querySelectorAll('.rpg-lb-graph-library-item .rpg-lb-graph-book-name').forEach(nameEl => {
        nameEl.addEventListener('click', () => {
            const item = nameEl.closest('.rpg-lb-graph-library-item');
            const campaignId = item?.dataset.campaign;
            if (!campaignId || !network) return;
            const books = getCampaignBooks(campaignId);
            const libraryNodes = allEntriesCache
                .filter(e => books.includes(e.bookName))
                .map(e => e.id);
            if (libraryNodes.length > 0) {
                network.selectNodes(libraryNodes);
                network.fit({ nodes: libraryNodes, animation: true });
            }
        });
    });

    // Library toggle checkboxes → show/hide all books in that campaign
    modal.querySelectorAll('.rpg-lb-graph-library-toggle').forEach(cb => {
        cb.addEventListener('change', async (e) => {
            e.stopPropagation();
            const campaignId = e.target.dataset.campaign;
            const books = getCampaignBooks(campaignId);
            for (const b of books) bookVisibility[b] = e.target.checked;
            const item = e.target.closest('.rpg-lb-graph-book-item');
            if (item) item.classList.toggle('filtered-out', !e.target.checked);
            await applyBookFilter();
        });
    });

    // Toggle all libraries button
    modal.querySelector('.rpg-lb-graph-books-toggle-all')?.addEventListener('click', async () => {
        const scopeBooks = getScopeBooks();
        const allVisible = scopeBooks.every(b => bookVisibility[b] !== false);
        const newState = !allVisible;
        for (const b of scopeBooks) bookVisibility[b] = newState;
        // Update checkboxes in UI
        modal.querySelectorAll('.rpg-lb-graph-library-toggle').forEach(cb => {
            cb.checked = newState;
            const item = cb.closest('.rpg-lb-graph-book-item');
            if (item) item.classList.toggle('filtered-out', !newState);
        });
        await applyBookFilter();
    });

    // Clear isolate button
    modal.querySelector('.rpg-lb-graph-clear-isolate')?.addEventListener('click', async () => {
        isolatedNodeId = null;
        const indicator = modal.querySelector('.rpg-lb-graph-isolate-indicator');
        if (indicator) indicator.style.display = 'none';
        await applyBookFilter();
    });

    // Context menu item clicks
    modal.addEventListener('click', async (e) => {
        const ctxItem = e.target.closest('.rpg-lb-graph-ctx-item');
        const ctxMenu = document.getElementById('rpg-lb-graph-context-menu');
        if (!ctxItem || !ctxMenu) return;

        const action = ctxItem.dataset.action;
        const nodeId = ctxMenu.dataset.nodeId;
        ctxMenu.style.display = 'none';

        if (!nodeId) return;
        const nodeData = graphData.nodes.get(nodeId);
        if (!nodeData) return;

        if (action === 'isolate') {
            isolatedNodeId = nodeId;
            const indicator = modal.querySelector('.rpg-lb-graph-isolate-indicator');
            if (indicator) indicator.style.display = 'block';
            await applyBookFilter();
            // Fit to visible nodes
            if (network) {
                setTimeout(() => network.fit({ animation: true }), 100);
            }
        } else if (action === 'open-editor') {
            const meta = nodeData._meta;
            const lb = extensionSettings.lorebook || {};
            lb.viewMode = 'list';
            saveSettings();
            import('./lorebook.js').then(mod => {
                mod.setSelectedBookAndEntry(meta.bookName, meta.uid);
                mod.renderLorebook();
            });
        }
    });

    // Close context menu on click elsewhere
    document.addEventListener('click', () => {
        const ctxMenu = document.getElementById('rpg-lb-graph-context-menu');
        if (ctxMenu) ctxMenu.style.display = 'none';
    });
}

// ─── Book Filter / Isolate ───────────────────────────────────────────────

async function applyBookFilter() {
    if (!network || !graphData.nodes) return;

    // Get all node IDs and their book names
    const allNodes = graphData.nodes.get();
    let visibleNodeIds;

    if (isolatedNodeId) {
        // Isolate mode: show only the isolated node + its direct neighbors
        const connectedEdges = network.getConnectedEdges(isolatedNodeId);
        const neighborIds = new Set([isolatedNodeId]);
        for (const edgeId of connectedEdges) {
            const edge = graphData.edges.get(edgeId);
            if (edge) {
                neighborIds.add(edge.from);
                neighborIds.add(edge.to);
            }
        }
        visibleNodeIds = neighborIds;
    } else {
        // Normal mode: filter by book visibility
        visibleNodeIds = new Set(
            allNodes
                .filter(n => bookVisibility[n._meta?.bookName] !== false)
                .map(n => n.id)
        );
    }

    // Update node visibility via opacity and hidden flag
    const updates = allNodes.map(n => ({
        id: n.id,
        hidden: !visibleNodeIds.has(n.id),
    }));
    graphData.nodes.update(updates);

    // Update stats with visible counts
    const visibleEdges = graphData.edges.get().filter(e =>
        visibleNodeIds.has(e.from) && visibleNodeIds.has(e.to)
    );
    updateStats(visibleNodeIds.size, visibleEdges.length);
}

// ─── Rebuild Graph ───────────────────────────────────────────────────────────

async function rebuildGraph() {
    const container = document.getElementById('rpg-lb-graph-canvas');
    const loading = document.getElementById('rpg-lb-graph-loading');
    if (!container) return;

    if (loading) loading.style.display = 'flex';

    // Destroy existing network
    if (network) {
        network.destroy();
        network = null;
    }

    // Build color cache from campaign settings
    buildBookColorCache();

    // Load data for scoped books
    const books = getScopeBooks();
    if (books.length === 0) {
        container.innerHTML = '<div class="rpg-lb-placeholder"><i class="fa-solid fa-diagram-project"></i><p>No lorebooks in scope</p></div>';
        if (loading) loading.style.display = 'none';
        updateStats(0, 0);
        return;
    }

    const worldDataMap = await loadMultipleWorldData(books);
    const data = computeGraphData(worldDataMap);

    if (data.nodes.length === 0) {
        container.innerHTML = '<div class="rpg-lb-placeholder"><i class="fa-solid fa-diagram-project"></i><p>No entries found</p></div>';
        if (loading) loading.style.display = 'none';
        updateStats(0, 0);
        return;
    }

    initNetwork(container, data);

    // Apply persisted book visibility filters after network is built
    const hasFilters = Object.values(bookVisibility).some(v => v === false);
    if (hasFilters) {
        setTimeout(() => applyBookFilter(), 100);
    }
}

// ─── Public API ──────────────────────────────────────────────────────────────

export async function renderGraphView(body) {
    await ensureVisLoaded();

    body.innerHTML = buildGraphHTML();

    setupGraphEvents();

    // Build graph after DOM is ready
    setTimeout(() => rebuildGraph(), 50);
}

export function destroyGraphView() {
    if (network) {
        network.destroy();
        network = null;
    }
    graphData = { nodes: null, edges: null };
    selectedNodeId = null;
    allEntriesCache = [];
}
