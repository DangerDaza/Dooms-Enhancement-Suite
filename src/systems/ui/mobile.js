/**
 * Mobile UI Module
 * Handles mobile-specific UI functionality: FAB dragging, tabs, keyboard handling
 */
import { extensionSettings, committedTrackerData, lastGeneratedData } from '../../core/state.js';
import { saveSettings } from '../../core/persistence.js';
import { closeMobilePanelWithAnimation, updateCollapseToggleIcon } from './layout.js';
import { setupDesktopTabs, removeDesktopTabs } from './desktop.js';
import { i18n } from '../../core/i18n.js';
/**
 * Updates the text labels of the mobile navigation tabs based on the current language.
 */
export function updateMobileTabLabels() {
    const $tabs = $('.rpg-mobile-tabs .rpg-mobile-tab');
    if ($tabs.length === 0) return;
    $tabs.each(function() {
        const $tab = $(this);
        const tabName = $tab.data('tab');
        let translationKey = '';
        switch (tabName) {
            case 'info':
                translationKey = 'global.info';
                break;
            case 'quests':
                translationKey = 'global.quests';
                break;
        }
        if (translationKey) {
            const translation = i18n.getTranslation(translationKey);
            if (translation) {
                $tab.find('span').text(translation);
            }
        }
    });
}
/**
 * Sets up the mobile toggle button (FAB) with drag functionality.
 * Handles touch/mouse events for positioning and panel toggling.
 */
export function setupMobileToggle() {
    const $mobileToggle = $('#rpg-mobile-toggle');
    const $panel = $('#dooms-tracker-panel');
    const $overlay = $('<div class="rpg-mobile-overlay"></div>');
    // DIAGNOSTIC: Check if elements exist and log setup state
    if ($mobileToggle.length === 0) {
        console.error('[RPG Mobile] ERROR: Mobile toggle button not found in DOM!');
        console.error('[RPG Mobile] Cannot attach event handlers - button does not exist');
        return; // Exit early if button doesn't exist
    }
    // Load and apply saved FAB position
    if (extensionSettings.mobileFabPosition) {
        const pos = extensionSettings.mobileFabPosition;
        // Apply saved position
        if (pos.top) $mobileToggle.css('top', pos.top);
        if (pos.right) $mobileToggle.css('right', pos.right);
        if (pos.bottom) $mobileToggle.css('bottom', pos.bottom);
        if (pos.left) $mobileToggle.css('left', pos.left);
        // Constrain to viewport after position is applied
        requestAnimationFrame(() => constrainFabToViewport());
    }
    // Touch/drag state
    let isDragging = false;
    let touchStartTime = 0;
    let touchStartX = 0;
    let touchStartY = 0;
    let buttonStartX = 0;
    let buttonStartY = 0;
    const LONG_PRESS_DURATION = 200; // ms to hold before enabling drag
    const MOVE_THRESHOLD = 10; // px to move before enabling drag
    let rafId = null; // RequestAnimationFrame ID for smooth updates
    let pendingX = null;
    let pendingY = null;
    // Update position using requestAnimationFrame for smooth rendering
    function updateFabPosition() {
        if (pendingX !== null && pendingY !== null) {
            $mobileToggle.css({
                left: pendingX + 'px',
                top: pendingY + 'px',
                right: 'auto',
                bottom: 'auto'
            });
            // Also update widget container position during drag
            const $container = $('#rpg-fab-widget-container');
            if ($container.length > 0) {
                $container.css({
                    top: pendingY + 'px',
                    left: pendingX + 'px'
                });
            }
            pendingX = null;
            pendingY = null;
        }
        rafId = null;
    }
    // Touch start - begin tracking
    $mobileToggle.on('touchstart', function(e) {
        const touch = e.originalEvent.touches[0];
        touchStartTime = Date.now();
        touchStartX = touch.clientX;
        touchStartY = touch.clientY;
        const offset = $mobileToggle.offset();
        buttonStartX = offset.left;
        buttonStartY = offset.top;
        isDragging = false;
    });
    // Touch move - check if should start dragging
    $mobileToggle.on('touchmove', function(e) {
        const touch = e.originalEvent.touches[0];
        const deltaX = touch.clientX - touchStartX;
        const deltaY = touch.clientY - touchStartY;
        const timeSinceStart = Date.now() - touchStartTime;
        const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
        // Start dragging if held long enough OR moved far enough
        if (!isDragging && (timeSinceStart > LONG_PRESS_DURATION || distance > MOVE_THRESHOLD)) {
            isDragging = true;
            $mobileToggle.addClass('dragging'); // Disable transitions while dragging
        }
        if (isDragging) {
            e.preventDefault(); // Prevent scrolling while dragging
            // Calculate new position
            let newX = buttonStartX + deltaX;
            let newY = buttonStartY + deltaY;
            // Get button dimensions
            const buttonWidth = $mobileToggle.outerWidth();
            const buttonHeight = $mobileToggle.outerHeight();
            // Constrain to viewport with 10px padding
            const minX = 10;
            const maxX = window.innerWidth - buttonWidth - 10;
            const minY = 10;
            const maxY = window.innerHeight - buttonHeight - 10;
            newX = Math.max(minX, Math.min(maxX, newX));
            newY = Math.max(minY, Math.min(maxY, newY));
            // Store pending position and request animation frame for smooth update
            pendingX = newX;
            pendingY = newY;
            if (!rafId) {
                rafId = requestAnimationFrame(updateFabPosition);
            }
        }
    });
    // Mouse drag support for desktop
    let mouseDown = false;
    $mobileToggle.on('mousedown', function(e) {
        // Prevent default to avoid text selection
        e.preventDefault();
        touchStartTime = Date.now();
        touchStartX = e.clientX;
        touchStartY = e.clientY;
        const offset = $mobileToggle.offset();
        buttonStartX = offset.left;
        buttonStartY = offset.top;
        isDragging = false;
        mouseDown = true;
    });
    // Mouse move - only track if mouse is down
    $(document).on('mousemove', function(e) {
        if (!mouseDown) return;
        const deltaX = e.clientX - touchStartX;
        const deltaY = e.clientY - touchStartY;
        const timeSinceStart = Date.now() - touchStartTime;
        const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
        // Start dragging if held long enough OR moved far enough
        if (!isDragging && (timeSinceStart > LONG_PRESS_DURATION || distance > MOVE_THRESHOLD)) {
            isDragging = true;
            $mobileToggle.addClass('dragging'); // Disable transitions while dragging
        }
        if (isDragging) {
            e.preventDefault();
            // Calculate new position
            let newX = buttonStartX + deltaX;
            let newY = buttonStartY + deltaY;
            // Get button dimensions
            const buttonWidth = $mobileToggle.outerWidth();
            const buttonHeight = $mobileToggle.outerHeight();
            // Constrain to viewport with 10px padding
            const minX = 10;
            const maxX = window.innerWidth - buttonWidth - 10;
            const minY = 10;
            const maxY = window.innerHeight - buttonHeight - 10;
            newX = Math.max(minX, Math.min(maxX, newX));
            newY = Math.max(minY, Math.min(maxY, newY));
            // Store pending position and request animation frame for smooth update
            pendingX = newX;
            pendingY = newY;
            if (!rafId) {
                rafId = requestAnimationFrame(updateFabPosition);
            }
        }
    });
    // Mouse up - save position or let click handler toggle
    $(document).on('mouseup', function(e) {
        if (!mouseDown) return;
        mouseDown = false;
        if (isDragging) {
            // Was dragging - save new position
            const offset = $mobileToggle.offset();
            const newPosition = {
                left: offset.left + 'px',
                top: offset.top + 'px'
            };
            extensionSettings.mobileFabPosition = newPosition;
            saveSettings();
            // Constrain to viewport bounds (now that position is saved)
            setTimeout(() => {
                constrainFabToViewport();
                updateFabWidgetPosition(); // Update widget container position
            }, 10);
            // Re-enable transitions with smooth animation
            setTimeout(() => {
                $mobileToggle.removeClass('dragging');
            }, 50);
            isDragging = false;
            // Prevent click from firing after drag
            e.preventDefault();
            e.stopPropagation();
            // Add flag to prevent click handler from firing
            $mobileToggle.data('just-dragged', true);
            setTimeout(() => {
                $mobileToggle.data('just-dragged', false);
            }, 100);
        }
        // If not dragging, let the click handler toggle the panel
    });
    // Touch end - save position or toggle panel
    $mobileToggle.on('touchend', function(e) {
        // TEMPORARILY COMMENTED FOR DIAGNOSIS - might be blocking click fallback
        // e.preventDefault();
        if (isDragging) {
            // Was dragging - save new position
            const offset = $mobileToggle.offset();
            const newPosition = {
                left: offset.left + 'px',
                top: offset.top + 'px'
            };
            extensionSettings.mobileFabPosition = newPosition;
            saveSettings();
            // Constrain to viewport bounds (now that position is saved)
            setTimeout(() => {
                constrainFabToViewport();
                updateFabWidgetPosition(); // Update widget container position
            }, 10);
            // Re-enable transitions with smooth animation
            setTimeout(() => {
                $mobileToggle.removeClass('dragging');
            }, 50);
            isDragging = false;
        } else {
            // Was a tap - toggle panel
            if ($panel.hasClass('rpg-mobile-open')) {
                // Close panel with animation
                closeMobilePanelWithAnimation();
            } else {
                // Open panel
                $panel.addClass('rpg-mobile-open');
                $('body').append($overlay);
                $mobileToggle.addClass('active');
                // Close when clicking overlay
                $overlay.on('click', function() {
                    closeMobilePanelWithAnimation();
                });
            }
        }
    });
    // Click handler - works on both mobile and desktop
    $mobileToggle.on('click', function(e) {
        // Skip if we just finished dragging
        if ($mobileToggle.data('just-dragged')) {
            return;
        }
        //     windowWidth: window.innerWidth,
        //     isMobileViewport: window.innerWidth <= 1000,
        //     panelOpen: $panel.hasClass('rpg-mobile-open')
        // });
        // Work on both mobile and desktop (removed viewport check)
        if ($panel.hasClass('rpg-mobile-open')) {
            closeMobilePanelWithAnimation();
        } else {
            $panel.addClass('rpg-mobile-open');
            $('body').append($overlay);
            $mobileToggle.addClass('active');
            $overlay.on('click', function() {
                closeMobilePanelWithAnimation();
            });
        }
    });
    // Handle viewport resize to manage desktop/mobile transitions
    let wasMobile = window.innerWidth <= 1000;
    let resizeTimer;
    $(window).on('resize', function() {
        clearTimeout(resizeTimer);
        const isMobile = window.innerWidth <= 1000;
        const $panel = $('#dooms-tracker-panel');
        const $mobileToggle = $('#rpg-mobile-toggle');
        // Transitioning from desktop to mobile - handle immediately for smooth transition
        if (!wasMobile && isMobile) {
            // Show mobile toggle button
            $mobileToggle.show();
            // Remove desktop tabs first
            removeDesktopTabs();
            // Apply mobile positioning based on panelPosition setting
            $panel.removeClass('rpg-position-right rpg-position-left rpg-position-top');
            $('body').removeClass('rpg-panel-position-right rpg-panel-position-left rpg-panel-position-top');
            const position = extensionSettings.panelPosition || 'right';
            $panel.addClass('rpg-position-' + position);
            $('body').addClass('rpg-panel-position-' + position);
            // Clear collapsed state - mobile doesn't use collapse
            $panel.removeClass('rpg-collapsed');
            // Close panel on mobile with animation
            closeMobilePanelWithAnimation();
            // Clear any inline styles that might be overriding CSS
            $panel.attr('style', '');
            //     panelClasses: $panel.attr('class'),
            //     inlineStyles: $panel.attr('style'),
            //     panelPosition: {
            //         top: $panel.css('top'),
            //         bottom: $panel.css('bottom'),
            //         transform: $panel.css('transform'),
            //         visibility: $panel.css('visibility')
            //     }
            // });
            // Set up mobile tabs IMMEDIATELY (no debounce delay)
            setupMobileTabs();
            // Update icon for mobile state
            updateCollapseToggleIcon();
            wasMobile = isMobile;
            return;
        }
        // For mobile to desktop transition, use debounce
        resizeTimer = setTimeout(function() {
            const isMobile = window.innerWidth <= 1000;
            // Transitioning from mobile to desktop
            if (wasMobile && !isMobile) {
                // Disable transitions to prevent left→right slide animation
                $panel.css('transition', 'none');
                $panel.removeClass('rpg-mobile-open rpg-mobile-closing');
                $mobileToggle.removeClass('active');
                $('.rpg-mobile-overlay').remove();
                // Hide mobile toggle button on desktop
                $mobileToggle.hide();
                // Restore desktop positioning class and remove body mobile classes
                $('body').removeClass('rpg-panel-position-right rpg-panel-position-left rpg-panel-position-top');
                const position = extensionSettings.panelPosition || 'right';
                $panel.addClass('rpg-position-' + position);
                // Remove mobile tabs structure
                removeMobileTabs();
                // Setup desktop tabs
                setupDesktopTabs();
                // Force reflow to apply position instantly
                $panel[0].offsetHeight;
                // Re-enable transitions after positioned
                setTimeout(function() {
                    $panel.css('transition', '');
                }, 50);
            }
            wasMobile = isMobile;
            // Constrain FAB to viewport after resize (only if user has positioned it)
            constrainFabToViewport();
        }, 150); // Debounce only for mobile→desktop
    });
    // Initialize mobile tabs if starting on mobile
    const isMobile = window.innerWidth <= 1000;
    if (isMobile) {
        const $panel = $('#dooms-tracker-panel');
        // Clear any inline styles
        $panel.attr('style', '');
        //     panelClasses: $panel.attr('class'),
        //     inlineStyles: $panel.attr('style'),
        //     panelPosition: {
        //         top: $panel.css('top'),
        //         bottom: $panel.css('top'),
        //         transform: $panel.css('transform'),
        //         visibility: $panel.css('visibility')\n        //     }\n        // });\n        setupMobileTabs();
        // Set initial icon for mobile
        updateCollapseToggleIcon();
        // Show mobile toggle on mobile viewport
        $mobileToggle.show();
    } else {
        // Hide mobile toggle on desktop viewport
        $mobileToggle.hide();
    }
}
/**
 * Constrains the mobile FAB button to viewport bounds with top-bar awareness.
 * Only runs when button is in user-controlled state (mobileFabPosition exists).
 * Ensures button never goes behind the top bar or outside viewport edges.
 */
export function constrainFabToViewport() {
    // Only constrain if user has set a custom position
    if (!extensionSettings.mobileFabPosition) {
        return;
    }
    const $mobileToggle = $('#rpg-mobile-toggle');
    if ($mobileToggle.length === 0) return;
    // Skip if button is not visible
    if (!$mobileToggle.is(':visible')) {
        return;
    }
    // Get current position
    const offset = $mobileToggle.offset();
    if (!offset) return;
    let currentX = offset.left;
    let currentY = offset.top;
    const buttonWidth = $mobileToggle.outerWidth();
    const buttonHeight = $mobileToggle.outerHeight();
    // Get top bar height from CSS variable (fallback to 50px if not set)
    const topBarHeight = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--topBarBlockSize')) || 50;
    // Calculate viewport bounds with padding
    // Use top bar height + extra padding for top bound
    const minX = 10;
    const maxX = window.innerWidth - buttonWidth - 10;
    const minY = topBarHeight + 60; // Top bar + extra space for visibility
    const maxY = window.innerHeight - buttonHeight - 10;
    // Constrain to bounds
    let newX = Math.max(minX, Math.min(maxX, currentX));
    let newY = Math.max(minY, Math.min(maxY, currentY));
    // Only update if position changed
    if (newX !== currentX || newY !== currentY) {
        //     old: { x: currentX, y: currentY },
        //     new: { x: newX, y: newY },
        //     viewport: { width: window.innerWidth, height: window.innerHeight },
        //     topBarHeight
        // });
        // Apply new position
        $mobileToggle.css({
            left: newX + 'px',
            top: newY + 'px',
            right: 'auto',
            bottom: 'auto'
        });
        // Save corrected position
        extensionSettings.mobileFabPosition = {
            left: newX + 'px',
            top: newY + 'px'
        };
        saveSettings();
    }
}
/**
 * Sets up mobile tab navigation for organizing content.
 * Only runs on mobile viewports (<=1000px).
 */
export function setupMobileTabs() {
    const isMobile = window.innerWidth <= 1000;
    if (!isMobile) return;
    // Check if tabs already exist
    if ($('.rpg-mobile-tabs').length > 0) return;
    const $panel = $('#dooms-tracker-panel');
    // Apply mobile positioning based on panelPosition setting
    $panel.removeClass('rpg-position-right rpg-position-left rpg-position-top');
    $('body').removeClass('rpg-panel-position-right rpg-panel-position-left rpg-panel-position-top');
    const position = extensionSettings.panelPosition || 'right';
    $panel.addClass('rpg-position-' + position);
    $('body').addClass('rpg-panel-position-' + position);
    const $contentBox = $panel.find('.rpg-content-box');
    // Get existing sections
    // NOTE: #rpg-user-stats and #rpg-inventory removed — systems archived
    const $infoBox = $('#rpg-info-box');
    const $thoughts = $('#rpg-thoughts');
    const $quests = $('#rpg-quests');
    // If no sections exist, nothing to organize
    if ($infoBox.length === 0 && $thoughts.length === 0 && $quests.length === 0) {
        return;
    }
    // Create tab navigation for mobile
    const tabs = [];
    const hasInfo = $infoBox.length > 0 || $thoughts.length > 0;
    const hasQuests = $quests.length > 0 && extensionSettings.showQuests;
    // Tab 1: Info (Info Box + Character Thoughts)
    if (hasInfo) {
        tabs.push('<button class="rpg-mobile-tab active" data-tab="info"><i class="fa-solid fa-book"></i><span>' + i18n.getTranslation('global.info') + '</span></button>');
    }
    // Tab 2: Quests
    if (hasQuests) {
        tabs.push('<button class="rpg-mobile-tab ' + (tabs.length === 0 ? 'active' : '') + '" data-tab="quests"><i class="fa-solid fa-scroll"></i><span>' + i18n.getTranslation('global.quests') + '</span></button>');
    }
    const $tabNav = $('<div class="rpg-mobile-tabs">' + tabs.join('') + '</div>');
    // Determine which tab should be active
    let firstTab = '';
    if (hasInfo) firstTab = 'info';
    else if (hasQuests) firstTab = 'quests';
    // Create tab content wrappers
    const $infoTab = $('<div class="rpg-mobile-tab-content ' + (firstTab === 'info' ? 'active' : '') + '" data-tab-content="info"></div>');
    const $questsTab = $('<div class="rpg-mobile-tab-content ' + (firstTab === 'quests' ? 'active' : '') + '" data-tab-content="quests"></div>');
    // Move sections into their respective tabs (detach to preserve event handlers)
    // Info tab: Info Box + Character Thoughts
    if ($infoBox.length > 0) {
        $infoTab.append($infoBox.detach());
        // Only show if has data
        const infoBoxData = window.lastGeneratedData?.infoBox || window.committedTrackerData?.infoBox;
        if (infoBoxData) $infoBox.show();
    }
    if ($thoughts.length > 0) {
        $infoTab.append($thoughts.detach());
        $thoughts.show();
    }
    // Quests tab: Quests only
    if ($quests.length > 0) {
        $questsTab.append($quests.detach());
        $quests.show();
    }
    // Hide dividers on mobile
    $('.rpg-divider').hide();
    // Build mobile tab structure
    const $mobileContainer = $('<div class="rpg-mobile-container"></div>');
    $mobileContainer.append($tabNav);
    // Append tab content wrappers
    $mobileContainer.append($infoTab);
    $mobileContainer.append($questsTab);
    // Insert mobile tab structure at the beginning of content box
    $contentBox.prepend($mobileContainer);
    // Handle tab switching
    $tabNav.find('.rpg-mobile-tab').on('click', function() {
        const tabName = $(this).data('tab');
        // Update active tab button
        $tabNav.find('.rpg-mobile-tab').removeClass('active');
        $(this).addClass('active');
        // Update active tab content
        $mobileContainer.find('.rpg-mobile-tab-content').removeClass('active');
        $mobileContainer.find('[data-tab-content="' + tabName + '"]').addClass('active');
    });
}
/**
 * Removes mobile tab navigation and restores desktop layout.
 */
export function removeMobileTabs() {
    // Get sections from tabs before removing
    const $infoBox = $('#rpg-info-box').detach();
    const $thoughts = $('#rpg-thoughts').detach();
    const $quests = $('#rpg-quests').detach();
    // Remove mobile tab container
    $('.rpg-mobile-container').remove();
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
        $contentBox.prepend($quests);
        $contentBox.prepend($thoughts);
        $contentBox.prepend($infoBox);
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
/**
 * Sets up mobile keyboard handling using Visual Viewport API.
 * Prevents layout squashing when keyboard appears by detecting
 * viewport changes and adding CSS classes for adjustment.
 */
export function setupMobileKeyboardHandling() {
    if (!window.visualViewport) {
        return;
    }
    const $panel = $('#dooms-tracker-panel');
    let keyboardVisible = false;
    // Listen for viewport resize (keyboard show/hide)
    window.visualViewport.addEventListener('resize', () => {
        // Only handle if panel is open on mobile
        if (!$panel.hasClass('rpg-mobile-open')) return;
        const viewportHeight = window.visualViewport.height;
        const windowHeight = window.innerHeight;
        // Keyboard visible if viewport significantly smaller than window
        // Using 75% threshold to account for browser UI variations
        const isKeyboardShowing = viewportHeight < windowHeight * 0.75;
        if (isKeyboardShowing && !keyboardVisible) {
            // Keyboard just appeared
            keyboardVisible = true;
            $panel.addClass('rpg-keyboard-visible');
        } else if (!isKeyboardShowing && keyboardVisible) {
            // Keyboard just disappeared
            keyboardVisible = false;
            $panel.removeClass('rpg-keyboard-visible');
        }
    });
}
/**
 * Handles focus on contenteditable fields to ensure they're visible when keyboard appears.
 * Uses smooth scrolling to bring focused field into view with proper padding.
 * Only applies on mobile viewports where virtual keyboard can obscure content.
 */
export function setupContentEditableScrolling() {
    const $panel = $('#dooms-tracker-panel');
    // Use event delegation for all contenteditable fields
    $panel.on('focusin', '[contenteditable="true"]', function(e) {
        // Only apply scrolling behavior on mobile (where virtual keyboard appears)
        const isMobile = window.innerWidth <= 1000;
        if (!isMobile) return;
        const $field = $(this);
        // Small delay to let keyboard animate in
        setTimeout(() => {
            // Scroll field into view with padding
            // Using 'center' to ensure field is in middle of viewport
            $field[0].scrollIntoView({
                behavior: 'smooth',
                block: 'center',
                inline: 'nearest'
            });
        }, 300);
    });
}
/**
 * Sets up the mobile refresh button with drag functionality.
 * Same pattern as mobile toggle button.
 * Tap = refresh, drag = reposition
 */
export function setupRefreshButtonDrag() {
    const $refreshBtn = $('#rpg-manual-update-mobile');
    if ($refreshBtn.length === 0) {
        console.warn('[RPG Mobile] Refresh button not found in DOM');
        return;
    }
    // Load and apply saved position
    if (extensionSettings.mobileRefreshPosition) {
        const pos = extensionSettings.mobileRefreshPosition;
        // Apply saved position
        if (pos.top) $refreshBtn.css('top', pos.top);
        if (pos.right) $refreshBtn.css('right', pos.right);
        if (pos.bottom) $refreshBtn.css('bottom', pos.bottom);
        if (pos.left) $refreshBtn.css('left', pos.left);
        // Constrain to viewport after position is applied
        requestAnimationFrame(() => constrainFabToViewport($refreshBtn));
    }
    // Touch/drag state
    let isDragging = false;
    let touchStartTime = 0;
    let touchStartX = 0;
    let touchStartY = 0;
    let buttonStartX = 0;
    let buttonStartY = 0;
    const LONG_PRESS_DURATION = 200;
    const MOVE_THRESHOLD = 10;
    let rafId = null;
    let pendingX = null;
    let pendingY = null;
    // Update position using requestAnimationFrame
    function updatePosition() {
        if (pendingX !== null && pendingY !== null) {
            $refreshBtn.css({
                left: pendingX + 'px',
                top: pendingY + 'px',
                right: 'auto',
                bottom: 'auto'
            });
            pendingX = null;
            pendingY = null;
        }
        rafId = null;
    }
    // Touch start
    $refreshBtn.on('touchstart', function(e) {
        const touch = e.originalEvent.touches[0];
        touchStartTime = Date.now();
        touchStartX = touch.clientX;
        touchStartY = touch.clientY;
        const offset = $refreshBtn.offset();
        buttonStartX = offset.left;
        buttonStartY = offset.top;
        isDragging = false;
    });
    // Touch move
    $refreshBtn.on('touchmove', function(e) {
        const touch = e.originalEvent.touches[0];
        const deltaX = touch.clientX - touchStartX;
        const deltaY = touch.clientY - touchStartY;
        const timeSinceStart = Date.now() - touchStartTime;
        const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
        if (!isDragging && (timeSinceStart > LONG_PRESS_DURATION || distance > MOVE_THRESHOLD)) {
            isDragging = true;
            $refreshBtn.addClass('dragging');
        }
        if (isDragging) {
            e.preventDefault();
            let newX = buttonStartX + deltaX;
            let newY = buttonStartY + deltaY;
            const buttonWidth = $refreshBtn.outerWidth();
            const buttonHeight = $refreshBtn.outerHeight();
            const minX = 10;
            const maxX = window.innerWidth - buttonWidth - 10;
            const minY = 10;
            const maxY = window.innerHeight - buttonHeight - 10;
            newX = Math.max(minX, Math.min(maxX, newX));
            newY = Math.max(minY, Math.min(maxY, newY));
            pendingX = newX;
            pendingY = newY;
            if (!rafId) {
                rafId = requestAnimationFrame(updatePosition);
            }
        }
    });
    // Touch end
    $refreshBtn.on('touchend', function(e) {
        if (isDragging) {
            // Save new position
            const offset = $refreshBtn.offset();
            const newPosition = {
                left: offset.left + 'px',
                top: offset.top + 'px'
            };
            extensionSettings.mobileRefreshPosition = newPosition;
            saveSettings();
            setTimeout(() => {
                $refreshBtn.removeClass('dragging');
            }, 50);
            // Set flag to prevent click handler from firing
            $refreshBtn.data('just-dragged', true);
            setTimeout(() => {
                $refreshBtn.data('just-dragged', false);
            }, 100);
            isDragging = false;
        }
    });
    // Mouse support for desktop
    let mouseDown = false;
    $refreshBtn.on('mousedown', function(e) {
        e.preventDefault();
        touchStartTime = Date.now();
        touchStartX = e.clientX;
        touchStartY = e.clientY;
        const offset = $refreshBtn.offset();
        buttonStartX = offset.left;
        buttonStartY = offset.top;
        mouseDown = true;
        isDragging = false;
    });
    $(document).on('mousemove', function(e) {
        if (!mouseDown) return;
        const deltaX = e.clientX - touchStartX;
        const deltaY = e.clientY - touchStartY;
        const timeSinceStart = Date.now() - touchStartTime;
        const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
        if (!isDragging && (timeSinceStart > LONG_PRESS_DURATION || distance > MOVE_THRESHOLD)) {
            isDragging = true;
            $refreshBtn.addClass('dragging');
        }
        if (isDragging) {
            let newX = buttonStartX + deltaX;
            let newY = buttonStartY + deltaY;
            const buttonWidth = $refreshBtn.outerWidth();
            const buttonHeight = $refreshBtn.outerHeight();
            const minX = 10;
            const maxX = window.innerWidth - buttonWidth - 10;
            const minY = 10;
            const maxY = window.innerHeight - buttonHeight - 10;
            newX = Math.max(minX, Math.min(maxX, newX));
            newY = Math.max(minY, Math.min(maxY, newY));
            pendingX = newX;
            pendingY = newY;
            if (!rafId) {
                rafId = requestAnimationFrame(updatePosition);
            }
        }
    });
    $(document).on('mouseup', function(e) {
        if (mouseDown && isDragging) {
            const offset = $refreshBtn.offset();
            const newPosition = {
                left: offset.left + 'px',
                top: offset.top + 'px'
            };
            extensionSettings.mobileRefreshPosition = newPosition;
            saveSettings();
            setTimeout(() => {
                $refreshBtn.removeClass('dragging');
            }, 50);
            $refreshBtn.data('just-dragged', true);
            setTimeout(() => {
                $refreshBtn.data('just-dragged', false);
            }, 100);
        }
        mouseDown = false;
        isDragging = false;
    });
}
/**
 * Sets up drag functionality for the debug toggle FAB button
 * Same pattern as refresh button drag
 */
export function setupDebugButtonDrag() {
    const $debugBtn = $('#rpg-debug-toggle');
    if ($debugBtn.length === 0) {
        console.warn('[RPG Mobile] Debug button not found in DOM');
        return;
    }
    // Load and apply saved position
    if (extensionSettings.debugFabPosition) {
        const pos = extensionSettings.debugFabPosition;
        // Apply saved position
        if (pos.top) $debugBtn.css('top', pos.top);
        if (pos.right) $debugBtn.css('right', pos.right);
        if (pos.bottom) $debugBtn.css('bottom', pos.bottom);
        if (pos.left) $debugBtn.css('left', pos.left);
        // Constrain to viewport after position is applied
        requestAnimationFrame(() => constrainFabToViewport($debugBtn));
    }
    // Touch/drag state
    let isDragging = false;
    let touchStartTime = 0;
    let touchStartX = 0;
    let touchStartY = 0;
    let buttonStartX = 0;
    let buttonStartY = 0;
    const LONG_PRESS_DURATION = 200;
    const MOVE_THRESHOLD = 10;
    let rafId = null;
    let pendingX = null;
    let pendingY = null;
    // Update position using requestAnimationFrame
    function updatePosition() {
        if (pendingX !== null && pendingY !== null) {
            $debugBtn.css({
                left: pendingX + 'px',
                top: pendingY + 'px',
                right: 'auto',
                bottom: 'auto'
            });
            pendingX = null;
            pendingY = null;
        }
        rafId = null;
    }
    // Touch start
    $debugBtn.on('touchstart', function(e) {
        const touch = e.originalEvent.touches[0];
        touchStartTime = Date.now();
        touchStartX = touch.clientX;
        touchStartY = touch.clientY;
        const offset = $debugBtn.offset();
        buttonStartX = offset.left;
        buttonStartY = offset.top;
        isDragging = false;
    });
    // Touch move
    $debugBtn.on('touchmove', function(e) {
        const touch = e.originalEvent.touches[0];
        const deltaX = touch.clientX - touchStartX;
        const deltaY = touch.clientY - touchStartY;
        const timeSinceStart = Date.now() - touchStartTime;
        const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
        if (!isDragging && (timeSinceStart > LONG_PRESS_DURATION || distance > MOVE_THRESHOLD)) {
            isDragging = true;
            $debugBtn.addClass('dragging');
        }
        if (isDragging) {
            e.preventDefault();
            let newX = buttonStartX + deltaX;
            let newY = buttonStartY + deltaY;
            const buttonWidth = $debugBtn.outerWidth();
            const buttonHeight = $debugBtn.outerHeight();
            const minX = 10;
            const maxX = window.innerWidth - buttonWidth - 10;
            const minY = 10;
            const maxY = window.innerHeight - buttonHeight - 10;
            newX = Math.max(minX, Math.min(maxX, newX));
            newY = Math.max(minY, Math.min(maxY, newY));
            pendingX = newX;
            pendingY = newY;
            if (!rafId) {
                rafId = requestAnimationFrame(updatePosition);
            }
        }
    });
    // Touch end
    $debugBtn.on('touchend', function(e) {
        if (isDragging) {
            // Save new position
            const offset = $debugBtn.offset();
            const newPosition = {
                left: offset.left + 'px',
                top: offset.top + 'px'
            };
            extensionSettings.debugFabPosition = newPosition;
            saveSettings();
            setTimeout(() => {
                $debugBtn.removeClass('dragging');
            }, 50);
            // Set flag to prevent click handler from firing
            $debugBtn.data('just-dragged', true);
            setTimeout(() => {
                $debugBtn.data('just-dragged', false);
            }, 100);
            isDragging = false;
        }
    });
    // Mouse support for desktop
    let mouseDown = false;
    $debugBtn.on('mousedown', function(e) {
        e.preventDefault();
        touchStartTime = Date.now();
        touchStartX = e.clientX;
        touchStartY = e.clientY;
        const offset = $debugBtn.offset();
        buttonStartX = offset.left;
        buttonStartY = offset.top;
        mouseDown = true;
        isDragging = false;
    });
    $(document).on('mousemove.rpgDebugDrag', function(e) {
        if (!mouseDown) return;
        const deltaX = e.clientX - touchStartX;
        const deltaY = e.clientY - touchStartY;
        const timeSinceStart = Date.now() - touchStartTime;
        const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
        if (!isDragging && (timeSinceStart > LONG_PRESS_DURATION || distance > MOVE_THRESHOLD)) {
            isDragging = true;
            $debugBtn.addClass('dragging');
        }
        if (isDragging) {
            let newX = buttonStartX + deltaX;
            let newY = buttonStartY + deltaY;
            const buttonWidth = $debugBtn.outerWidth();
            const buttonHeight = $debugBtn.outerHeight();
            const minX = 10;
            const maxX = window.innerWidth - buttonWidth - 10;
            const minY = 10;
            const maxY = window.innerHeight - buttonHeight - 10;
            newX = Math.max(minX, Math.min(maxX, newX));
            newY = Math.max(minY, Math.min(maxY, newY));
            pendingX = newX;
            pendingY = newY;
            if (!rafId) {
                rafId = requestAnimationFrame(updatePosition);
            }
        }
    });
    $(document).on('mouseup.rpgDebugDrag', function(e) {
        if (mouseDown && isDragging) {
            const offset = $debugBtn.offset();
            const newPosition = {
                left: offset.left + 'px',
                top: offset.top + 'px'
            };
            extensionSettings.debugFabPosition = newPosition;
            saveSettings();
            setTimeout(() => {
                $debugBtn.removeClass('dragging');
            }, 50);
            $debugBtn.data('just-dragged', true);
            setTimeout(() => {
                $debugBtn.data('just-dragged', false);
            }, 100);
        }
        mouseDown = false;
        isDragging = false;
    });
}
// ============================================
// FAB WIDGETS - Info display around FAB button
// ============================================
/**
 * Updates the FAB widgets display based on current tracker data and settings.
 * Widgets are positioned in 8 positions around the FAB (N, NE, E, SE, S, SW, W, NW).
 */
export function updateFabWidgets() {
    const $fab = $('#rpg-mobile-toggle');
    if ($fab.length === 0) return;
    // Remove existing widget container and clean up event listeners
    $('#rpg-fab-widget-container').remove();
    $(document).off('click.fabWidgets touchstart.fabWidgets');
    // Check if widgets are enabled
    const widgetSettings = extensionSettings.mobileFabWidgets;
    if (!widgetSettings || !widgetSettings.enabled) return;
    // Don't show widgets on desktop or when panel is open
    if (window.innerWidth > 1000) return;
    // Get tracker data - prefer lastGeneratedData (most recent) over committedTrackerData
    const infoBox = lastGeneratedData?.infoBox || committedTrackerData?.infoBox;
    // Parse infoBox if it's a string
    let infoData = null;
    if (infoBox) {
        try {
            infoData = typeof infoBox === 'string' ? JSON.parse(infoBox) : infoBox;
        } catch (e) {
            console.warn('[RPG FAB Widgets] Failed to parse infoBox:', e);
        }
    }
    // Create widget container positioned at FAB location
    const fabOffset = $fab.offset();
    const fabWidth = $fab.outerWidth();
    const fabHeight = $fab.outerHeight();
    const $container = $('<div id="rpg-fab-widget-container" class="rpg-fab-widget-container"></div>');
    $container.css({
        top: fabOffset.top + 'px',
        left: fabOffset.left + 'px',
        width: fabWidth + 'px',
        height: fabHeight + 'px'
    });
    // Build widgets based on settings - auto-assign positions sequentially
    const widgets = [];
    // Collect enabled widgets in display priority order
    // Large widgets (Stats, Attributes) go to West/Northwest
    // Small widgets spread around other positions
    // Helper to create expandable text widget HTML
    const createExpandableText = (fullText, maxLen, emoji) => {
        if (fullText.length <= maxLen) {
            return `${emoji} ${fullText}`;
        }
        const truncated = fullText.substring(0, maxLen - 2) + '…';
        return `${emoji} <span class="rpg-truncated">${truncated}</span><span class="rpg-full-text">${fullText}</span>`;
    };
    // Check if text needs truncation for data attribute
    const needsExpand = (text, maxLen) => text.length > maxLen;
    // Helper to parse time string and calculate clock hand angles
    const parseTimeForClock = (timeStr) => {
        const timeMatch = timeStr.match(/(\d+):(\d+)/);
        if (timeMatch) {
            const hours = parseInt(timeMatch[1]);
            const minutes = parseInt(timeMatch[2]);
            const hourAngle = (hours % 12) * 30 + minutes * 0.5; // 30° per hour + 0.5° per minute
            const minuteAngle = minutes * 6; // 6° per minute
            return { hourAngle, minuteAngle };
        }
        return { hourAngle: 0, minuteAngle: 0 };
    };
    // Clock/Time (bottom position with animated clock face)
    if (widgetSettings.clock?.enabled && infoData?.time) {
        const timeStr = typeof infoData.time === 'string'
            ? infoData.time
            : (infoData.time.end || infoData.time.value || infoData.time.start || '');
        if (timeStr) {
            const { hourAngle, minuteAngle } = parseTimeForClock(timeStr);
            widgets.push({
                type: 'bottom', // Special type for bottom position
                html: `<div class="rpg-fab-widget rpg-fab-widget-clock" title="${timeStr}">
                    <div class="rpg-fab-clock-face">
                        <div class="rpg-fab-clock-hour" style="transform: rotate(${hourAngle}deg)"></div>
                        <div class="rpg-fab-clock-minute" style="transform: rotate(${minuteAngle}deg)"></div>
                        <div class="rpg-fab-clock-center"></div>
                    </div>
                    <span class="rpg-fab-clock-time">${timeStr}</span>
                </div>`
            });
        }
    }
    // Date (small)
    const mDateVal = infoData?.date ? (typeof infoData.date === 'string' ? infoData.date : infoData.date.value) : null;
    if (widgetSettings.date?.enabled && mDateVal) {
        const expandAttr = needsExpand(mDateVal, 12) ? ' data-full-text="true"' : '';
        widgets.push({
            type: 'small',
            html: `<div class="rpg-fab-widget rpg-fab-widget-date"${expandAttr} title="${mDateVal}">${createExpandableText(mDateVal, 12, '📅')}</div>`
        });
    }
    // Location (small)
    const mLocVal = infoData?.location ? (typeof infoData.location === 'string' ? infoData.location : infoData.location.value) : null;
    if (widgetSettings.location?.enabled && mLocVal) {
        const expandAttr = needsExpand(mLocVal, 14) ? ' data-full-text="true"' : '';
        widgets.push({
            type: 'small',
            html: `<div class="rpg-fab-widget rpg-fab-widget-location"${expandAttr} title="${mLocVal}">${createExpandableText(mLocVal, 14, '📍')}</div>`
        });
    }
    // Auto-assign positions intelligently
    // Large widgets get their preferred positions first (West=6, Northwest=7)
    // Bottom widgets get position 4 (South)
    // Small widgets fill remaining positions clockwise from North (0)
    const usedPositions = new Set();
    const positionedWidgets = [];
    // Position order for small widgets: N(0), NE(1), E(2), SE(3), SW(5) - skip S(4) for bottom/clock
    const smallPositionOrder = [0, 1, 2, 3, 5];
    let smallPosIndex = 0;
    // Check if only one large widget exists (for centering)
    const largeWidgets = widgets.filter(w => w.type === 'large');
    const singleLargeWidget = largeWidgets.length === 1;
    // First: assign bottom widgets to position 4 (South)
    widgets.filter(w => w.type === 'bottom').forEach(w => {
        const pos = 4; // South position
        usedPositions.add(pos);
        const finalHtml = w.html.replace('class="rpg-fab-widget', `class="rpg-fab-widget rpg-fab-widget-pos-${pos}`);
        positionedWidgets.push({ position: pos, html: finalHtml });
    });
    // Second: assign large widgets to their preferred positions
    largeWidgets.forEach(w => {
        let pos = w.preferredPos;
        // If preferred position is taken, find next available from large positions
        if (usedPositions.has(pos)) {
            pos = pos === 6 ? 7 : 6; // Try the other large position
        }
        usedPositions.add(pos);
        // Add centered class if this is the only large widget
        const centeredClass = singleLargeWidget ? ' rpg-fab-widget-centered' : '';
        const finalHtml = w.html.replace('class="rpg-fab-widget', `class="rpg-fab-widget rpg-fab-widget-pos-${pos}${centeredClass}`);
        positionedWidgets.push({ position: pos, html: finalHtml });
    });
    // Third: assign small widgets to remaining positions
    widgets.filter(w => w.type === 'small').forEach(w => {
        // Find next available position from small position order
        while (smallPosIndex < smallPositionOrder.length && usedPositions.has(smallPositionOrder[smallPosIndex])) {
            smallPosIndex++;
        }
        const pos = smallPosIndex < smallPositionOrder.length ? smallPositionOrder[smallPosIndex] : (smallPosIndex % 8);
        usedPositions.add(pos);
        smallPosIndex++;
        const finalHtml = w.html.replace('class="rpg-fab-widget', `class="rpg-fab-widget rpg-fab-widget-pos-${pos}`);
        positionedWidgets.push({ position: pos, html: finalHtml });
    });
    // Add widgets to container
    positionedWidgets.forEach(w => $container.append(w.html));
    // Append container to body
    if (positionedWidgets.length > 0) {
        $('body').append($container);
        // Add mobile tap handler for expandable widgets
        $container.find('.rpg-fab-widget[data-full-text]').on('click touchstart', function(e) {
            e.stopPropagation();
            const $this = $(this);
            const wasExpanded = $this.hasClass('expanded');
            // Collapse all other expanded widgets
            $container.find('.rpg-fab-widget.expanded').removeClass('expanded');
            // Toggle this one
            if (!wasExpanded) {
                $this.addClass('expanded');
            }
        });
        // Collapse on tap outside
        $(document).on('click.fabWidgets touchstart.fabWidgets', function(e) {
            if (!$(e.target).closest('.rpg-fab-widget').length) {
                $container.find('.rpg-fab-widget.expanded').removeClass('expanded');
            }
        });
    }
}
// NOTE: getStatColor() and hexToRgb() removed — stat bars archived
/**
 * Updates the FAB widget container position to match FAB button position.
 * Call this after FAB is dragged.
 */
export function updateFabWidgetPosition() {
    const $fab = $('#rpg-mobile-toggle');
    const $container = $('#rpg-fab-widget-container');
    if ($fab.length === 0 || $container.length === 0) return;
    const fabOffset = $fab.offset();
    $container.css({
        top: fabOffset.top + 'px',
        left: fabOffset.left + 'px'
    });
}
/**
 * Sets the FAB loading state (spinning animation during API requests).
 * @param {boolean} loading - Whether to show loading state
 */
export function setFabLoadingState(loading) {
    const $fab = $('#rpg-mobile-toggle');
    if ($fab.length === 0) return;
    if (loading) {
        $fab.addClass('rpg-fab-loading');
    } else {
        $fab.removeClass('rpg-fab-loading');
    }
}
