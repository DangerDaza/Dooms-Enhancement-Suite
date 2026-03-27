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
let graphFilters = { keywords: true, groups: true };
let bookVisibility = {}; // { bookName: boolean } — per-book filter
let isolatedNodeId = null; // When set, only show this node + neighbors
let allEntriesCache = [];

const EXTENSION_PATH = 'scripts/extensions/third-party/Dooms-Enhancement-Suite';

// ─── Node Colors ─────────────────────────────────────────────────────────────

// Book color palette — distinct colors for different lorebooks
const BOOK_COLORS = [
    '#4a7ba7', '#7c4dff', '#e94560', '#00bfa5', '#ff6d00',
    '#ab47bc', '#26a69a', '#ef5350', '#42a5f5', '#66bb6a',
    '#ffa726', '#8d6e63', '#78909c', '#ec407a', '#5c6bc0',
];

function getBookColor(bookName, allBooks) {
    const idx = allBooks.indexOf(bookName);
    return BOOK_COLORS[idx % BOOK_COLORS.length];
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

// ─── Edge Computation ────────────────────────────────────────────────────────

function computeGraphData(worldDataMap) {
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
            const bookColor = getBookColor(bookName, allBooks);

            let state = 'enabled';
            if (entry.disable) state = 'disabled';
            else if (entry.constant) state = 'constant';
            else if (entry.vectorized) state = 'vectorized';

            // Node size based on content length
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
                font: {
                    color: state === 'disabled' ? '#888' : '#e0e0e0',
                    size: 11,
                },
                shape: state === 'constant' ? 'diamond' : 'dot',
                opacity: state === 'disabled' ? 0.5 : 1.0,
                // Store metadata for detail panel
                _meta: { bookName, uid, entry, state, tokenEst, fullTitle: title },
            });

            entries.push({ id, entry, bookName });
        }
    }

    // Keyword inverted index
    const keywordIndex = {};
    for (const item of entries) {
        const keys = [
            ...(item.entry.key || []),
            ...(item.entry.keysecondary || []),
        ];
        for (const k of keys) {
            const normalized = k.trim().toLowerCase();
            if (!normalized) continue;
            if (!keywordIndex[normalized]) keywordIndex[normalized] = [];
            keywordIndex[normalized].push(item.id);
        }
    }

    // Keyword edges
    const edgeSet = new Set();
    if (graphFilters.keywords) {
        for (const [keyword, ids] of Object.entries(keywordIndex)) {
            if (ids.length < 2 || ids.length > 20) continue; // Skip overly common keywords
            for (let i = 0; i < ids.length; i++) {
                for (let j = i + 1; j < ids.length; j++) {
                    const edgeKey = [ids[i], ids[j]].sort().join('|');
                    if (!edgeSet.has(edgeKey)) {
                        edgeSet.add(edgeKey);
                        edges.push({
                            from: ids[i],
                            to: ids[j],
                            label: keyword,
                            color: { color: 'rgba(74, 123, 167, 0.3)', highlight: 'rgba(74, 123, 167, 0.8)' },
                            font: { color: '#888', size: 9, strokeWidth: 0 },
                            width: 1,
                            _type: 'keyword',
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
                            from: ids[i],
                            to: ids[j],
                            label: group,
                            dashes: true,
                            color: { color: 'rgba(171, 71, 188, 0.4)', highlight: 'rgba(171, 71, 188, 0.8)' },
                            font: { color: '#ab47bc', size: 9, strokeWidth: 0 },
                            width: 2,
                            _type: 'group',
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
    html += '<label class="rpg-lb-graph-label">Connections</label>';
    html += `<label class="rpg-lb-graph-checkbox"><input type="checkbox" data-filter="keywords" ${graphFilters.keywords ? 'checked' : ''}> Shared Keywords</label>`;
    html += `<label class="rpg-lb-graph-checkbox"><input type="checkbox" data-filter="groups" ${graphFilters.groups ? 'checked' : ''}> Inclusion Groups</label>`;
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
            font: { face: 'Inter, sans-serif' },
        },
        edges: {
            smooth: { type: 'continuous' },
            hoverWidth: 2,
            selectionWidth: 2,
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

    // Click node → show detail
    network.on('click', (params) => {
        if (params.nodes.length > 0) {
            const nodeId = params.nodes[0];
            const nodeData = graphData.nodes.get(nodeId);
            if (nodeData) {
                selectedNodeId = nodeId;
                renderDetailPanel(nodeData);
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

    // Reset isolate mode
    isolatedNodeId = null;

    // Destroy existing network
    if (network) {
        network.destroy();
        network = null;
    }

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
