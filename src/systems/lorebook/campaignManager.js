/**
 * Campaign Manager
 * Handles CRUD operations for lorebook campaigns (folders/groups) and the
 * ACTIVE campaign — the one whose books are switched on and whose character
 * versions are live in the Character Workshop.
 *
 * Campaigns are extension-only metadata stored in extensionSettings.lorebook.
 * SillyTavern still has no concept of them: activating one is expressed
 * entirely through ST's own World Info selection (lorebookAPI) plus DES's
 * flat character stores (campaignProfiles.js). Selecting a campaign:
 *   1. swaps every character the campaign overrides to that campaign's
 *      version (the base entries are parked in campaignBaseShadow),
 *   2. activates the books filed under it,
 *   3. deactivates the books the PREVIOUS switch turned on — tracked in the
 *      lorebook.campaignActivated ledger so a user's manual picks are never
 *      touched — except books flagged in lorebook.globalBooks.
 * With no active campaign everything behaves exactly as it did before
 * campaigns became a mode.
 */
import { extensionSettings, clearSessionAvatarPrompts } from '../../core/state.js';
import { saveSettings } from '../../core/persistence.js';
import { getAllWorldNames, isWorldActive, applyWorldActivation } from './lorebookAPI.js';
import {
    switchCampaignProfiles,
    deleteCampaignProfiles,
    renameBookEverywhere,
    forgetBook,
    getActiveCampaignId as profilesActiveId,
} from './campaignProfiles.js';

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
            lastSearch: '',
            activeCampaignId: null,
            globalBooks: [],
            campaignActivated: [],
        };
    }
    const lb = extensionSettings.lorebook;
    if (!lb.campaigns) lb.campaigns = {};
    if (!lb.campaignOrder) lb.campaignOrder = [];
    if (lb.activeCampaignId === undefined) lb.activeCampaignId = null;
    if (!Array.isArray(lb.globalBooks)) lb.globalBooks = [];
    if (!Array.isArray(lb.campaignActivated)) lb.campaignActivated = [];
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
 * Deletes a campaign. Books inside become unfiled. If it was the active
 * campaign it is deactivated first (its books turned off, its character
 * versions parked back to base); its saved character versions are dropped
 * and any portrait files only they referenced are removed from disk.
 * @param {string} id - Campaign ID to delete
 * @returns {Promise<boolean>} True if deleted
 */
export async function deleteCampaign(id) {
    ensureLorebook();
    if (!extensionSettings.lorebook.campaigns[id]) return false;

    if (getActiveCampaignId() === id) {
        await setActiveCampaign(null, { silent: true });
    }
    const orphanCandidates = deleteCampaignProfiles(id);

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
    if (orphanCandidates.length) {
        try {
            const { deletePortraitsIfUnreferenced } = await import('../../utils/avatars.js');
            await deletePortraitsIfUnreferenced(orphanCandidates);
        } catch (e) { /* disk cleanup is best-effort */ }
    }
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

// ─── Active campaign ────────────────────────────────────────────────────────

/**
 * @returns {string|null} The active campaign's ID, or null
 */
export function getActiveCampaignId() {
    return profilesActiveId();
}

/**
 * @returns {{id: string, campaign: Object}|null} The active campaign, or null
 */
export function getActiveCampaign() {
    ensureLorebook();
    const id = getActiveCampaignId();
    const campaign = id ? extensionSettings.lorebook.campaigns[id] : null;
    return campaign ? { id, campaign } : null;
}

// Switches are serialized: a second click while the first is still awaiting
// ST's World Info update would interleave two reconciles and corrupt the
// ledger. Every setActiveCampaign call queues behind the previous one.
let switchChain = Promise.resolve();
let switchesPending = 0;

/** True while a campaign switch is in flight (UI can disable its controls). */
export function isSwitching() {
    return switchesPending > 0;
}

/**
 * Makes a campaign active (or none, with null). Swaps character versions,
 * turns the campaign's books on, turns the previous campaign's books off
 * (ledger-tracked, globals exempt), saves, and repaints every surface that
 * shows character identity.
 * @param {string|null} campaignId
 * @param {{silent?: boolean}} [options] - silent: no toast
 * @returns {Promise<boolean>} True if the active campaign changed
 */
export function setActiveCampaign(campaignId, options = {}) {
    switchesPending++;
    const run = switchChain
        .then(() => doSetActiveCampaign(campaignId, options))
        .finally(() => { switchesPending--; });
    // Keep the chain alive even when one switch throws.
    switchChain = run.catch(() => {});
    return run;
}

async function doSetActiveCampaign(campaignId, { silent = false } = {}) {
    ensureLorebook();
    const lb = extensionSettings.lorebook;
    const next = campaignId && lb.campaigns[campaignId] ? campaignId : null;
    const prev = getActiveCampaignId();
    if (prev === next) return false;

    // 1 + 2. Character versions: bank the outgoing campaign, restore the base
    //        entries it hid, park the ones the incoming campaign overrides and
    //        apply its versions. Synchronous and pure.
    switchCampaignProfiles(prev, next);
    lb.activeCampaignId = next;
    // Persist the swapped stores before ST's own World Info change handler
    // (fired by the book step) schedules its save — on a fresh session that
    // save could otherwise serialize the pre-load blob. Idempotent.
    saveSettings();

    // 3. Books.
    const { turnedOn, turnedOff } = await reconcileActiveCampaignBooks();

    saveSettings();
    await repaintAfterCampaignSwitch();

    if (!silent) {
        try {
            const name = next ? lb.campaigns[next].name : null;
            const detail = `${turnedOn} book${turnedOn === 1 ? '' : 's'} on, ${turnedOff} off`;
            if (window.toastr) {
                window.toastr.info(
                    name ? `${name} is now the active campaign — ${detail}.` : `No active campaign — ${detail}.`,
                    'Lore Library',
                    { timeOut: 3500 },
                );
            }
        } catch (e) {}
    }
    return true;
}

/**
 * Brings ST's active World Info selection in line with the active campaign:
 * every book filed under it is on, every book the previous switch left on
 * that is no longer wanted is off (unless flagged global), and the ledger
 * records what this call left on. The ledger is "the campaign's books", so a
 * campaign really is a mode: switching away turns its non-global books off
 * even if the user had switched one of them on by hand beforehand — while
 * books outside the campaign (manual picks, imports) are never touched.
 * Safe to call whenever a campaign's book list changes; with nothing active
 * it only releases the ledger.
 * @returns {Promise<{turnedOn: number, turnedOff: number}>}
 */
export async function reconcileActiveCampaignBooks() {
    ensureLorebook();
    const lb = extensionSettings.lorebook;
    const active = getActiveCampaignId();
    const existing = new Set(getAllWorldNames());
    const globals = new Set(lb.globalBooks);
    const wanted = active
        ? (lb.campaigns[active]?.books || []).filter(b => existing.has(b))
        : [];
    const wantedSet = new Set(wanted);
    const deactivate = lb.campaignActivated.filter(name =>
        !wantedSet.has(name) && !globals.has(name) && isWorldActive(name));
    const activate = wanted.filter(name => !isWorldActive(name));
    let turnedOn = 0;
    let turnedOff = 0;
    try {
        const result = await applyWorldActivation({ activate, deactivate });
        turnedOn = result.activated.length;
        turnedOff = result.deactivated.length;
    } catch (e) {
        console.warn('[Dooms Tracker] Campaign: World Info update failed', e);
    }
    lb.campaignActivated = [...wanted];
    return { turnedOn, turnedOff };
}

/**
 * Repaints every surface that renders character identity after the flat
 * stores were swapped. Dynamic imports: the render stack sits above this
 * module in the import graph. Mirrors characterAliases.repaintAliasSurfaces.
 */
export async function repaintAfterCampaignSwitch() {
    // LLM-written portrait prompts were derived from the previous campaign's
    // descriptions; a regeneration must not reuse them for the new versions.
    try { clearSessionAvatarPrompts(); } catch (e) {}
    // The data switch always happens; the DOM work is pointless (and can
    // resurrect panels) while the extension is disabled.
    if (extensionSettings.enabled === false) return;
    try {
        const { clearPortraitCache, updatePortraitBar } = await import('../ui/portraitBar.js');
        clearPortraitCache();
        updatePortraitBar();
    } catch (e) { /* portrait bar may not be initialised */ }
    try {
        const { renderThoughts, updateChatThoughts } = await import('../rendering/thoughts.js');
        renderThoughts();
        setTimeout(() => { try { updateChatThoughts(); } catch (e) {} }, 250);
    } catch (e) {}
    try {
        const mode = extensionSettings.chatBubbleMode;
        if (typeof document !== 'undefined' && mode && mode !== 'off') {
            const { revertAllChatBubbles, applyAllChatBubbles } = await import('../rendering/chatBubbles.js');
            revertAllChatBubbles();
            applyAllChatBubbles();
        }
    } catch (e) { /* bubbles are best-effort */ }
    try {
        const roster = await import('../ui/characterRoster.js');
        if (typeof roster.refreshRosterIfOpen === 'function') roster.refreshRosterIfOpen();
    } catch (e) {}
    try {
        // The Character Sheet reads the hero art and its position only when
        // it opens; an open sheet would keep showing the previous version and
        // a drag would write into the new one. Close it.
        if (typeof document !== 'undefined') {
            const sheet = document.getElementById('rpg-character-sheet-popup');
            if (sheet && sheet.style.display !== 'none' && sheet.style.display !== '') sheet.style.display = 'none';
        }
    } catch (e) {}
    try {
        const workshop = await import('../ui/characterWorkshop.js');
        if (typeof workshop.refreshWorkshopIfOpen === 'function') workshop.refreshWorkshopIfOpen();
    } catch (e) {}
}

// ─── Global books ───────────────────────────────────────────────────────────

/**
 * Whether a book is exempt from campaign switching (never turned off by a switch).
 * @param {string} worldName
 * @returns {boolean}
 */
export function isGlobalBook(worldName) {
    return (extensionSettings.lorebook?.globalBooks || []).includes(worldName);
}

/**
 * Flips a book's global flag.
 * @param {string} worldName
 * @returns {boolean} The new state
 */
export function toggleGlobalBook(worldName) {
    ensureLorebook();
    const list = extensionSettings.lorebook.globalBooks;
    const idx = list.indexOf(worldName);
    if (idx === -1) list.push(worldName);
    else list.splice(idx, 1);
    saveSettings();
    return idx === -1;
}

/**
 * Keeps campaign folders, the global list and the ledger pointing at a book
 * that was renamed. Call alongside lorebookAPI.renameWorld.
 */
export function onWorldRenamed(oldName, newName) {
    ensureLorebook();
    renameBookEverywhere(oldName, newName);
    saveSettings();
}

/**
 * Drops every reference to a deleted book. Call alongside lorebookAPI.deleteWorld.
 */
export function onWorldDeleted(worldName) {
    ensureLorebook();
    forgetBook(worldName);
    saveSettings();
}

// ─── Book Assignment ────────────────────────────────────────────────────────

/**
 * Adds a WI file to a campaign. If it's already in another campaign, removes it first.
 * When the target (or source) campaign is the active one, the caller should
 * follow up with reconcileActiveCampaignBooks() so the book's activation
 * matches its new home.
 * @param {string} campaignId - Target campaign ID
 * @param {string} worldName - WI filename to assign
 */
export function addBookToCampaign(campaignId, worldName) {
    ensureLorebook();
    // A caller that resolved no book (an empty jQuery lookup yields
    // undefined) must not file "undefined" in a folder.
    if (typeof worldName !== 'string' || !worldName) return;

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
    if (typeof worldName !== 'string' || !worldName) return;
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
