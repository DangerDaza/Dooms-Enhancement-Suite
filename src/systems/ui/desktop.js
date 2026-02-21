/**
 * Desktop UI Module
 * Handles desktop-specific UI functionality: tab navigation and strip widgets
 */
import { i18n } from '../../core/i18n.js';
import { extensionSettings, lastGeneratedData, committedTrackerData } from '../../core/state.js';
/**
 * Helper to parse time string and calculate clock hand angles
 */
function parseTimeForClock(timeStr) {
    const timeMatch = timeStr.match(/(\d+):(\d+)/);
    if (timeMatch) {
        const hours = parseInt(timeMatch[1]);
        const minutes = parseInt(timeMatch[2]);
        const hourAngle = (hours % 12) * 30 + minutes * 0.5; // 30° per hour + 0.5° per minute
        const minuteAngle = minutes * 6; // 6° per minute
        return { hourAngle, minuteAngle };
    }
    return { hourAngle: 0, minuteAngle: 0 };
}
/**
 * Updates the desktop strip widgets display based on current tracker data and settings.
 * Strip widgets are shown vertically in the collapsed panel strip.
 */
export function updateStripWidgets() {
    const $panel = $('#dooms-tracker-panel');
    const $container = $('#rpg-strip-widget-container');
    if ($panel.length === 0 || $container.length === 0) return;
    // Check if strip widgets are enabled
    const widgetSettings = extensionSettings.desktopStripWidgets;
    if (!widgetSettings || !widgetSettings.enabled) {
        $panel.removeClass('rpg-strip-widgets-enabled');
        $container.find('.rpg-strip-widget').removeClass('rpg-strip-widget-visible');
        return;
    }
    // Add enabled class to panel for CSS styling (wider collapsed width)
    $panel.addClass('rpg-strip-widgets-enabled');
    // Get tracker data - use imported state directly
    const infoBox = lastGeneratedData?.infoBox || committedTrackerData?.infoBox;
    // Parse infoBox if it's a string
    let infoData = null;
    if (infoBox) {
        try {
            infoData = typeof infoBox === 'string' ? JSON.parse(infoBox) : infoBox;
        } catch (e) {
            console.warn('[RPG Strip Widgets] Failed to parse infoBox:', e);
        }
    }
    // Clock Widget with animated face
    const $clockWidget = $container.find('.rpg-strip-widget-clock');
    if (widgetSettings.clock?.enabled && infoData?.time) {
        const timeStr = infoData.time.end || infoData.time.value || infoData.time.start || '';
        if (timeStr) {
            // Update clock hands
            const { hourAngle, minuteAngle } = parseTimeForClock(timeStr);
            $clockWidget.find('.rpg-strip-clock-hour').css('transform', `rotate(${hourAngle}deg)`);
            $clockWidget.find('.rpg-strip-clock-minute').css('transform', `rotate(${minuteAngle}deg)`);
            $clockWidget.find('.rpg-strip-widget-value').text(timeStr);
            $clockWidget.attr('title', `Time: ${timeStr}`);
            $clockWidget.addClass('rpg-strip-widget-visible');
        } else {
            $clockWidget.removeClass('rpg-strip-widget-visible');
        }
    } else {
        $clockWidget.removeClass('rpg-strip-widget-visible');
    }
    // Date Widget
    const $dateWidget = $container.find('.rpg-strip-widget-date');
    if (widgetSettings.date?.enabled && infoData?.date?.value) {
        const dateVal = infoData.date.value;
        // Truncate long dates for display
        const displayDate = dateVal.length > 20 ? dateVal.substring(0, 18) + '…' : dateVal;
        $dateWidget.find('.rpg-strip-widget-value').text(displayDate);
        $dateWidget.attr('title', dateVal);
        $dateWidget.addClass('rpg-strip-widget-visible');
    } else {
        $dateWidget.removeClass('rpg-strip-widget-visible');
    }
    // Location Widget
    const $locationWidget = $container.find('.rpg-strip-widget-location');
    if (widgetSettings.location?.enabled && infoData?.location?.value) {
        const loc = infoData.location.value;
        // Truncate long locations for display
        const displayLoc = loc.length > 15 ? loc.substring(0, 13) + '…' : loc;
        $locationWidget.find('.rpg-strip-widget-value').text(displayLoc);
        $locationWidget.attr('title', loc);
        $locationWidget.addClass('rpg-strip-widget-visible');
    } else {
        $locationWidget.removeClass('rpg-strip-widget-visible');
    }
}
// NOTE: getStatColor() and hexToRgb() removed — stat bars archived
/**
 * Sets up desktop tab navigation for organizing content.
 * Only runs on desktop viewports (>1000px).
 * Creates two tabs: Status (Stats/Info/Thoughts) and Inventory.
 */
export function setupDesktopTabs() {
    const isDesktop = window.innerWidth > 1000;
    if (!isDesktop) return;
    // Check if tabs already exist
    if ($('.rpg-tabs-nav').length > 0) return;
    const $contentBox = $('.rpg-content-box');
    // Get existing sections
    // NOTE: #rpg-user-stats and #rpg-inventory removed — systems archived
    const $infoBox = $('#rpg-info-box');
    const $thoughts = $('#rpg-thoughts');
    const $quests = $('#rpg-quests');
    // If no sections exist, nothing to organize
    if ($infoBox.length === 0 && $thoughts.length === 0 && $quests.length === 0) {
        return;
    }
    // Build tab navigation dynamically based on enabled settings
    const tabButtons = [];
    const hasQuests = $quests.length > 0 && extensionSettings.showQuests;
    // Status tab (always present if any status content exists)
    tabButtons.push(`
        <button class="rpg-tab-btn active" data-tab="status">
            <i class="fa-solid fa-chart-simple"></i>
            <span data-i18n-key="global.status">Status</span>
        </button>
    `);
    // NOTE: Inventory tab removed — system archived
    // Quests tab (only if enabled in settings)
    if (hasQuests) {
        tabButtons.push(`
            <button class="rpg-tab-btn" data-tab="quests">
                <i class="fa-solid fa-scroll"></i>
                <span data-i18n-key="global.quests">Quests</span>
            </button>
        `);
    }
    const $tabNav = $(`<div class="rpg-tabs-nav">${tabButtons.join('')}</div>`);
    // Create tab content containers
    const $statusTab = $('<div class="rpg-tab-content active" data-tab-content="status"></div>');
    const $questsTab = $('<div class="rpg-tab-content" data-tab-content="quests"></div>');
    // Move sections into their respective tabs (detach to preserve event handlers)
    if ($infoBox.length > 0) {
        $statusTab.append($infoBox.detach());
        // Only show if enabled and has data
        if (extensionSettings.showInfoBox) {
            const infoBoxData = window.lastGeneratedData?.infoBox || window.committedTrackerData?.infoBox;
            if (infoBoxData) $infoBox.show();
        }
    }
    if ($thoughts.length > 0) {
        $statusTab.append($thoughts.detach());
        if (extensionSettings.showCharacterThoughts) $thoughts.show();
    }
    if ($quests.length > 0) {
        $questsTab.append($quests.detach());
        // Only show if enabled (will be part of tab structure)
        if (hasQuests) $quests.show();
    }
    // Hide dividers on desktop tabs (tabs separate content naturally)
    $('.rpg-divider').hide();
    // Build desktop tab structure
    const $tabsContainer = $('<div class="rpg-tabs-container"></div>');
    $tabsContainer.append($tabNav);
    $tabsContainer.append($statusTab);
    $tabsContainer.append($questsTab);
    // Replace content box with tabs container
    $contentBox.html('').append($tabsContainer);
    i18n.applyTranslations($tabsContainer[0]);
    // Handle tab switching
    $tabNav.find('.rpg-tab-btn').on('click', function() {
        const tabName = $(this).data('tab');
        // Update active tab button
        $tabNav.find('.rpg-tab-btn').removeClass('active');
        $(this).addClass('active');
        // Update active tab content
        $('.rpg-tab-content').removeClass('active');
        $(`.rpg-tab-content[data-tab-content="${tabName}"]`).addClass('active');
    });
}
/**
 * Removes desktop tab navigation and restores original layout.
 * Used when transitioning from desktop to mobile.
 */
export function removeDesktopTabs() {
    // Get sections from tabs before removing
    const $infoBox = $('#rpg-info-box').detach();
    const $thoughts = $('#rpg-thoughts').detach();
    const $quests = $('#rpg-quests').detach();
    // Remove tabs container
    $('.rpg-tabs-container').remove();
    // Get dividers
    const $dividerInfo = $('#rpg-divider-info');
    const $dividerThoughts = $('#rpg-divider-thoughts');
    // Restore original sections to content box in correct order
    const $contentBox = $('.rpg-content-box');
    if ($dividerInfo.length) {
        $dividerInfo.before($infoBox);
        $dividerThoughts.before($thoughts);
        $contentBox.append($quests);
    } else {
        // Fallback if dividers don't exist
        $contentBox.append($infoBox);
        $contentBox.append($thoughts);
        $contentBox.append($quests);
    }
    // Show/hide sections based on settings (respect visibility settings)
    if (extensionSettings.showInfoBox) {
        const infoBoxData = window.lastGeneratedData?.infoBox || window.committedTrackerData?.infoBox;
        if (infoBoxData) $infoBox.show();
    }
    if (extensionSettings.showCharacterThoughts) $thoughts.show();
    if (extensionSettings.showQuests) $quests.show();
    $('.rpg-divider').show();
}
