/**
 * Campaign Manager
 * Handles CRUD operations for lorebook campaigns (folders/groups).
 * Campaigns are extension-only metadata stored in extensionSettings.lorebook.campaigns.
 * SillyTavern has no concept of campaigns — this is purely an organizational overlay.
 */
import { extensionSettings } from '../../core/state.js';
import { saveSettings } from '../../core/persistence.js';
import { getAllWorldNames } from './lorebookAPI.js';

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Generates a simple UUID for campaign IDs
 * @returns {string}
 */
function generateId() {
    return 'campaign_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
}

/**
 * Ensures lorebook settings are initialized
 */
function ensureLorebook() {
    if (!extensionSettings.lorebook) {
        extensionSettings.lorebook = {
            enabled: true,
            campaigns: {},
            campaignOrder: [],
            collapsedCampaigns: [],
            expandedBooks: [],
            lastActiveTab: 'all',
            lastFilter: 'all',
            lastSearch: ''
        };
    }
    if (!extensionSettings.lorebook.campaigns) {
        extensionSettings.lorebook.campaigns = {};
    }
    if (!extensionSettings.lorebook.campaignOrder) {
        extensionSettings.lorebook.campaignOrder = [];
    }
}

// ─── Campaign CRUD ──────────────────────────────────────────────────────────

/**
 * Creates a new campaign
 * @param {string} name - Campaign display name
 * @param {string} [icon='fa-folder'] - Campaign icon (Font Awesome class without fa-solid prefix)
 * @param {string} [color=''] - Optional accent color hex
 * @returns {string} The new campaign ID
 */
export function createCampaign(name, icon = 'fa-folder', color = '') {
    ensureLorebook();
    const id = generateId();
    extensionSettings.lorebook.campaigns[id] = {
        id,
        name,
        icon,
        color,
        books: []
    };
    extensionSettings.lorebook.campaignOrder.push(id);
    saveSettings();
    return id;
}

/**
 * Deletes a campaign. Books inside become unfiled.
 * @param {string} id - Campaign ID to delete
 * @returns {boolean} True if deleted
 */
export function deleteCampaign(id) {
    ensureLorebook();
    if (!extensionSettings.lorebook.campaigns[id]) return false;

    delete extensionSettings.lorebook.campaigns[id];

    // Remove from order array
    const orderIdx = extensionSettings.lorebook.campaignOrder.indexOf(id);
    if (orderIdx !== -1) {
        extensionSettings.lorebook.campaignOrder.splice(orderIdx, 1);
    }

    // Remove from collapsed list
    const collIdx = (extensionSettings.lorebook.collapsedCampaigns || []).indexOf(id);
    if (collIdx !== -1) {
        extensionSettings.lorebook.collapsedCampaigns.splice(collIdx, 1);
    }

    saveSettings();
    return true;
}

/**
 * Renames a campaign
 * @param {string} id - Campaign ID
 * @param {string} newName - New display name
 */
export function renameCampaign(id, newName) {
    ensureLorebook();
    const campaign = extensionSettings.lorebook.campaigns[id];
    if (campaign) {
        campaign.name = newName;
        saveSettings();
    }
}

/**
 * Updates a campaign's icon
 * @param {string} id - Campaign ID
 * @param {string} icon - New icon/emoji
 */
export function updateCampaignIcon(id, icon) {
    ensureLorebook();
    const campaign = extensionSettings.lorebook.campaigns[id];
    if (campaign) {
        campaign.icon = icon;
        saveSettings();
    }
}

/**
 * Updates a campaign's color
 * @param {string} id - Campaign ID
 * @param {string} color - New color hex string
 */
export function updateCampaignColor(id, color) {
    ensureLorebook();
    const campaign = extensionSettings.lorebook.campaigns[id];
    if (campaign) {
        campaign.color = color;
        saveSettings();
    }
}

// ─── Book Assignment ────────────────────────────────────────────────────────

/**
 * Adds a WI file to a campaign. If it's already in another campaign, removes it first.
 * @param {string} campaignId - Target campaign ID
 * @param {string} worldName - WI filename to assign
 */
export function addBookToCampaign(campaignId, worldName) {
    ensureLorebook();

    // Remove from any existing campaign first
    for (const campaign of Object.values(extensionSettings.lorebook.campaigns)) {
        const idx = campaign.books.indexOf(worldName);
        if (idx !== -1) {
            campaign.books.splice(idx, 1);
        }
    }

    // Add to target campaign
    const target = extensionSettings.lorebook.campaigns[campaignId];
    if (target) {
        if (!target.books.includes(worldName)) {
            target.books.push(worldName);
        }
        saveSettings();
    }
}

/**
 * Removes a WI file from a campaign (book becomes unfiled)
 * @param {string} campaignId - Campaign ID
 * @param {string} worldName - WI filename to remove
 */
export function removeBookFromCampaign(campaignId, worldName) {
    ensureLorebook();
    const campaign = extensionSettings.lorebook.campaigns[campaignId];
    if (campaign) {
        const idx = campaign.books.indexOf(worldName);
        if (idx !== -1) {
            campaign.books.splice(idx, 1);
            saveSettings();
        }
    }
}

/**
 * Moves a book between campaigns
 * @param {string} fromId - Source campaign ID (or null for unfiled)
 * @param {string} toId - Target campaign ID
 * @param {string} worldName - WI filename
 */
export function moveBookBetweenCampaigns(fromId, toId, worldName) {
    ensureLorebook();
    if (fromId) {
        removeBookFromCampaign(fromId, worldName);
    }
    addBookToCampaign(toId, worldName);
}

// ─── Queries ────────────────────────────────────────────────────────────────

/**
 * Returns all lorebooks not assigned to any campaign
 * @returns {string[]} Array of unfiled WI filenames
 */
export function getUnfiledBooks() {
    ensureLorebook();
    const allNames = getAllWorldNames();
    const assignedSet = new Set();
    for (const campaign of Object.values(extensionSettings.lorebook.campaigns)) {
        for (const book of campaign.books) {
            assignedSet.add(book);
        }
    }
    return allNames.filter(name => !assignedSet.has(name));
}

/**
 * Finds which campaign contains a given book
 * @param {string} worldName - WI filename
 * @returns {{id: string, campaign: Object}|null} Campaign info or null if unfiled
 */
export function getCampaignForBook(worldName) {
    ensureLorebook();
    for (const [id, campaign] of Object.entries(extensionSettings.lorebook.campaigns)) {
        if (campaign.books.includes(worldName)) {
            return { id, campaign };
        }
    }
    return null;
}

/**
 * Returns campaigns in display order
 * @returns {Array<{id: string, campaign: Object}>}
 */
export function getCampaignsInOrder() {
    ensureLorebook();
    const campaigns = extensionSettings.lorebook.campaigns;
    const order = extensionSettings.lorebook.campaignOrder || [];

    // Start with ordered campaigns
    const result = [];
    for (const id of order) {
        if (campaigns[id]) {
            result.push({ id, campaign: campaigns[id] });
        }
    }

    // Add any campaigns not in the order array (shouldn't happen but be safe)
    for (const [id, campaign] of Object.entries(campaigns)) {
        if (!order.includes(id)) {
            result.push({ id, campaign });
        }
    }

    return result;
}

/**
 * Updates the campaign display order
 * @param {string[]} newOrder - Array of campaign IDs in desired order
 */
export function reorderCampaigns(newOrder) {
    ensureLorebook();
    extensionSettings.lorebook.campaignOrder = newOrder;
    saveSettings();
}

// ─── UI State ───────────────────────────────────────────────────────────────

/**
 * Checks if a campaign is collapsed in the UI
 * @param {string} id - Campaign ID
 * @returns {boolean}
 */
export function isCampaignCollapsed(id) {
    return (extensionSettings.lorebook?.collapsedCampaigns || []).includes(id);
}

/**
 * Toggles a campaign's collapsed state
 * @param {string} id - Campaign ID
 */
export function toggleCampaignCollapsed(id) {
    ensureLorebook();
    if (!extensionSettings.lorebook.collapsedCampaigns) {
        extensionSettings.lorebook.collapsedCampaigns = [];
    }
    const idx = extensionSettings.lorebook.collapsedCampaigns.indexOf(id);
    if (idx !== -1) {
        extensionSettings.lorebook.collapsedCampaigns.splice(idx, 1);
    } else {
        extensionSettings.lorebook.collapsedCampaigns.push(id);
    }
    saveSettings();
}

/**
 * Checks if a book spine is expanded in the UI
 * @param {string} worldName - WI filename
 * @returns {boolean}
 */
export function isBookExpanded(worldName) {
    return (extensionSettings.lorebook?.expandedBooks || []).includes(worldName);
}

/**
 * Toggles a book spine's expanded state
 * @param {string} worldName - WI filename
 */
export function toggleBookExpanded(worldName) {
    ensureLorebook();
    if (!extensionSettings.lorebook.expandedBooks) {
        extensionSettings.lorebook.expandedBooks = [];
    }
    const idx = extensionSettings.lorebook.expandedBooks.indexOf(worldName);
    if (idx !== -1) {
        extensionSettings.lorebook.expandedBooks.splice(idx, 1);
    } else {
        extensionSettings.lorebook.expandedBooks.push(worldName);
    }
    saveSettings();
}

/**
 * Sets the last active tab
 * @param {string} tab - Tab identifier
 */
export function setLastActiveTab(tab) {
    ensureLorebook();
    extensionSettings.lorebook.lastActiveTab = tab;
    saveSettings();
}

/**
 * Sets the last filter
 * @param {string} filter - Filter value ('all', 'active', 'inactive')
 */
export function setLastFilter(filter) {
    ensureLorebook();
    extensionSettings.lorebook.lastFilter = filter;
    saveSettings();
}

/**
 * Sets the last search query
 * @param {string} search - Search string
 */
export function setLastSearch(search) {
    ensureLorebook();
    extensionSettings.lorebook.lastSearch = search;
    // Don't save on every keystroke — caller can debounce
}
