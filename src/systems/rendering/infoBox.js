/**
 * Info Box Rendering Module
 * Handles rendering of the info box dashboard with weather, date, time, and location widgets
 */
import {
    extensionSettings,
    lastGeneratedData,
    committedTrackerData,
    $infoBoxContainer
} from '../../core/state.js';
import { i18n } from '../../core/i18n.js';
import { repairJSON } from '../../utils/jsonRepair.js';
/**
 * Helper to generate lock icon HTML if setting is enabled
 * @param {string} tracker - Tracker name
 * @param {string} path - Item path
 * @returns {string} Lock icon HTML or empty string
 */
/** @deprecated Lock UI disabled — preserved for future scene tracker integration */
function getLockIconHtml(_tracker, _path) {
    return '';
}
/**
 * Updates the CSS variable for dynamic text scaling on the location field.
 * @param {jQuery} $element - The location element
 */
function updateLocationTextSize($element) {
    const text = $element.text();
    const charCount = text.length;
    $element.css('--char-count', Math.min(charCount, 100));
}
/**
 * Renders the info box as a visual dashboard with calendar, weather, temperature, clock, and map widgets.
 */
export function renderInfoBox() {
    if (!extensionSettings.showInfoBox || !$infoBoxContainer) {
        return;
    }
    // Use committedTrackerData as fallback if lastGeneratedData is empty (e.g., after page refresh)
    const infoBoxData = lastGeneratedData.infoBox || committedTrackerData.infoBox;
    // If no data yet, hide the container (e.g., after cache clear)
    if (!infoBoxData) {
        $infoBoxContainer.empty().hide();
        return;
    }
    // Show container and add updating class for animation
    $infoBoxContainer.show();
    if (extensionSettings.enableAnimations) {
        $infoBoxContainer.addClass('rpg-content-updating');
    }
    let data = {
        date: '',
        weekday: '',
        month: '',
        year: '',
        timeStart: '',
        timeEnd: '',
        location: '',
        characters: []
    };
    // Check if data is v3 JSON format
    const trimmed = infoBoxData.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        const jsonData = repairJSON(infoBoxData);
        if (jsonData) {
            // Extract from v3 JSON structure — handle both nested objects and flat strings
            if (typeof jsonData.time === 'string') {
                // Flat string: "2:40 PM" or "2:00 PM → 3:00 PM"
                const timeParts = jsonData.time.split('→').map(t => t.trim());
                data.timeStart = timeParts[0] || '';
                data.timeEnd = timeParts[1] || '';
            } else {
                data.timeStart = jsonData.time?.start || '';
                data.timeEnd = jsonData.time?.end || '';
            }
            if (typeof jsonData.location === 'string') {
                data.location = jsonData.location;
            } else {
                data.location = jsonData.location?.value || '';
            }
            // Parse date string to extract weekday, month, year
            const dateValue = typeof jsonData.date === 'string' ? jsonData.date : jsonData.date?.value;
            if (dateValue) {
                data.date = dateValue;
                // Expected format: "Tuesday, October 17th, 2023" or "Sunday, Late Autumn, Week 2"
                const dateParts = data.date.split(',').map(p => p.trim());
                data.weekday = dateParts[0] || '';
                data.month = dateParts[1] || '';
                data.year = dateParts[2] || '';
            }
            // Skip to rendering
        } else {
            // JSON parsing failed, fall back to text parsing
            parseTextFormat();
        }
    } else {
        // Text format
        parseTextFormat();
    }
    function parseTextFormat() {
        // Parse the info box data
        const lines = infoBoxData.split('\n');
    // Track which fields we've already parsed to avoid duplicates from mixed formats
    const parsedFields = {
        date: false,
        temperature: false,
        time: false,
        location: false,
        weather: false
    };
    for (const line of lines) {
        // Support both new text format (Date:) and legacy emoji format (🗓️:)
        // Prioritize text format over emoji format
        if (line.startsWith('Date:')) {
            if (!parsedFields.date) {
                const dateStr = line.replace('Date:', '').trim();
                const dateParts = dateStr.split(',').map(p => p.trim());
                data.weekday = dateParts[0] || '';
                data.month = dateParts[1] || '';
                data.year = dateParts[2] || '';
                data.date = dateStr;
                parsedFields.date = true;
            }
        } else if (line.includes('🗓️:')) {
            if (!parsedFields.date) {
                const dateStr = line.replace('🗓️:', '').trim();
                const dateParts = dateStr.split(',').map(p => p.trim());
                data.weekday = dateParts[0] || '';
                data.month = dateParts[1] || '';
                data.year = dateParts[2] || '';
                data.date = dateStr;
                parsedFields.date = true;
            }
        } else if (line.startsWith('Time:')) {
            if (!parsedFields.time) {
                const timeStr = line.replace('Time:', '').trim();
                data.time = timeStr;
                const timeParts = timeStr.split('→').map(t => t.trim());
                data.timeStart = timeParts[0] || '';
                data.timeEnd = timeParts[1] || '';
                parsedFields.time = true;
            }
        } else if (line.includes('🕒:')) {
            if (!parsedFields.time) {
                const timeStr = line.replace('🕒:', '').trim();
                data.time = timeStr;
                const timeParts = timeStr.split('→').map(t => t.trim());
                data.timeStart = timeParts[0] || '';
                data.timeEnd = timeParts[1] || '';
                parsedFields.time = true;
            }
        } else if (line.startsWith('Location:')) {
            if (!parsedFields.location) {
                data.location = line.replace('Location:', '').trim();
                parsedFields.location = true;
            }
        } else if (line.includes('🗺️:')) {
            if (!parsedFields.location) {
                data.location = line.replace('🗺️:', '').trim();
                parsedFields.location = true;
            }
        }
    }
    //     date: data.date,
    //     timeStart: data.timeStart,
    //     location: data.location
    // });
    }
    // Get tracker configuration
    const config = extensionSettings.trackerConfig?.infoBox;
    // Build visual dashboard HTML
    // Wrap all content in a scrollable container
    let html = '<div class="rpg-info-content">';
    // Row 1: Date, Weather, Temperature, Time widgets
    const row1Widgets = [];
    // Calendar widget - show if enabled
    if (config?.widgets?.date?.enabled) {
        // Apply date format conversion
        let monthDisplay = data.month || 'MON';
        let weekdayDisplay = data.weekday || 'DAY';
        let yearDisplay = data.year || 'YEAR';
        // Apply format based on config
        const dateFormat = config.widgets.date.format || 'dd/mm/yy';
        if (dateFormat === 'dd/mm/yy') {
            monthDisplay = monthDisplay.substring(0, 3).toUpperCase();
            weekdayDisplay = weekdayDisplay.substring(0, 3).toUpperCase();
        } else if (dateFormat === 'mm/dd/yy') {
            // For US format, show month first, day second
            monthDisplay = monthDisplay.substring(0, 3).toUpperCase();
            weekdayDisplay = weekdayDisplay.substring(0, 3).toUpperCase();
        } else if (dateFormat === 'yyyy-mm-dd') {
            // ISO format - show full names
            monthDisplay = monthDisplay;
            weekdayDisplay = weekdayDisplay;
        }
        const dateLockIconHtml = getLockIconHtml('infoBox', 'date');
        row1Widgets.push(`
            <div class="rpg-dashboard-widget rpg-calendar-widget">
                ${dateLockIconHtml}
                <div class="rpg-calendar-top rpg-editable" contenteditable="true" data-field="month" data-full-value="${data.month || ''}" title="Click to edit">${monthDisplay}</div>
                <div class="rpg-calendar-day" title="Click to edit"><span class="rpg-calendar-day-text rpg-editable" contenteditable="true" data-field="weekday" data-full-value="${data.weekday || ''}">${weekdayDisplay}</span></div>
                <div class="rpg-calendar-year rpg-editable" contenteditable="true" data-field="year" data-full-value="${data.year || ''}" title="Click to edit">${yearDisplay}</div>
            </div>
        `);
    }
    // Time widget - show if enabled
    if (config?.widgets?.time?.enabled) {
        // Get both start and end times
        const timeStartDisplay = data.timeStart || '12:00';
        const timeEndDisplay = data.timeEnd || data.timeStart || '12:00';
        // Parse end time for clock hands (use end time for visual display)
        const timeMatch = timeEndDisplay.match(/(\d+):(\d+)/);
        let hourAngle = 0;
        let minuteAngle = 0;
        if (timeMatch) {
            const hours = parseInt(timeMatch[1]);
            const minutes = parseInt(timeMatch[2]);
            hourAngle = (hours % 12) * 30 + minutes * 0.5; // 30° per hour + 0.5° per minute
            minuteAngle = minutes * 6; // 6° per minute
        }
        const timeLockIconHtml = getLockIconHtml('infoBox', 'time');
        row1Widgets.push(`
            <div class="rpg-dashboard-widget rpg-clock-widget">
                ${timeLockIconHtml}
                <div class="rpg-clock">
                    <div class="rpg-clock-face">
                        <div class="rpg-clock-hour" style="transform: rotate(${hourAngle}deg)"></div>
                        <div class="rpg-clock-minute" style="transform: rotate(${minuteAngle}deg)"></div>
                        <div class="rpg-clock-center"></div>
                    </div>
                </div>
                <div class="rpg-time-range">
                    <div class="rpg-time-value rpg-editable" contenteditable="true" data-field="timeStart" title="Click to edit start time">${timeStartDisplay}</div>
                    <span class="rpg-time-separator">→</span>
                    <div class="rpg-time-value rpg-editable" contenteditable="true" data-field="timeEnd" title="Click to edit end time">${timeEndDisplay}</div>
                </div>
            </div>
        `);
    }
    // Only create row 1 if there are widgets to show
    if (row1Widgets.length > 0) {
        html += '<div class="rpg-dashboard rpg-dashboard-row-1">';
        html += row1Widgets.join('');
        html += '</div>';
    }
    // Row 2: Location widget (full width) - show if enabled
    if (config?.widgets?.location?.enabled) {
        const locationDisplay = data.location || 'Location';
        const locationLockIconHtml = getLockIconHtml('infoBox', 'location');
        html += `
            <div class="rpg-dashboard rpg-dashboard-row-2">
                <div class="rpg-dashboard-widget rpg-location-widget">
                    ${locationLockIconHtml}
                    <div class="rpg-map-bg">
                        <div class="rpg-map-marker">📍</div>
                    </div>
                    <div class="rpg-location-text rpg-editable" contenteditable="true" data-field="location" title="Click to edit">${locationDisplay}</div>
                </div>
            </div>
        `;
    }
    // Row 2b: New optional widgets — Moon Phase, Tension, Time Since Rest, Conditions, Terrain
    // Parse new fields from JSON infoBox data
    let extraFieldsData = {};
    if (infoBoxData) {
        try {
            const parsed = typeof infoBoxData === 'string' ? JSON.parse(infoBoxData) : infoBoxData;
            if (parsed) {
                extraFieldsData.moonPhase = typeof parsed.moonPhase === 'string' ? parsed.moonPhase : (parsed.moonPhase?.value || '');
                extraFieldsData.tension = typeof parsed.tension === 'string' ? parsed.tension : (parsed.tension?.value || '');
                extraFieldsData.timeSinceRest = typeof parsed.timeSinceRest === 'string' ? parsed.timeSinceRest : (parsed.timeSinceRest?.value || '');
                extraFieldsData.conditions = typeof parsed.conditions === 'string' ? parsed.conditions : (parsed.conditions?.value || '');
                extraFieldsData.terrain = typeof parsed.terrain === 'string' ? parsed.terrain : (parsed.terrain?.value || '');
            }
        } catch (e) { /* ignore */ }
    }
    const extraWidgets = [
        { key: 'moonPhase',     icon: '🌙', label: 'Moon Phase',      placeholder: 'Unknown' },
        { key: 'tension',       icon: '⚡', label: 'Tension',         placeholder: 'Calm' },
        { key: 'timeSinceRest', icon: '⏳', label: 'Time Since Rest', placeholder: 'Unknown' },
        { key: 'conditions',    icon: '💔', label: 'Conditions',      placeholder: 'None' },
        { key: 'terrain',       icon: '🌿', label: 'Terrain',         placeholder: 'Unknown' },
    ];
    for (const w of extraWidgets) {
        if (config?.widgets?.[w.key]?.enabled) {
            const display = extraFieldsData[w.key] || w.placeholder;
            const lockIconHtml = getLockIconHtml('infoBox', w.key);
            html += `
                <div class="rpg-dashboard rpg-dashboard-row-extra">
                    <div class="rpg-dashboard-widget rpg-extra-widget">
                        ${lockIconHtml}
                        <div class="rpg-extra-icon">${w.icon}</div>
                        <div class="rpg-extra-label">${w.label}</div>
                        <div class="rpg-extra-value rpg-editable" contenteditable="true" data-field="${w.key}" title="Click to edit">${display}</div>
                    </div>
                </div>
            `;
        }
    }
    // Row 3: Recent Events widget (notebook style) - show if enabled
    if (config?.widgets?.recentEvents?.enabled) {
        // Parse Recent Events from infoBox (supports both JSON and text formats)
        let recentEvents = [];
        if (infoBoxData) {
            // Try JSON format first
            try {
                const parsed = typeof infoBoxData === 'string'
                    ? JSON.parse(infoBoxData)
                    : infoBoxData;
                if (parsed && Array.isArray(parsed.recentEvents)) {
                    recentEvents = parsed.recentEvents;
                }
            } catch (e) {
                // Fall back to old text format
                const recentEventsLine = infoBoxData.split('\n').find(line => line.startsWith('Recent Events:'));
                if (recentEventsLine) {
                    const eventsString = recentEventsLine.replace('Recent Events:', '').trim();
                    if (eventsString) {
                        recentEvents = eventsString.split(',').map(e => e.trim()).filter(e => e);
                    }
                }
            }
        }
        const validEvents = recentEvents.filter(e => e && e.trim() && e !== 'Event 1' && e !== 'Event 2' && e !== 'Event 3');
        // If no valid events, show at least one placeholder
        if (validEvents.length === 0) {
            validEvents.push('Click to add event');
        }
        const eventsLockIconHtml = getLockIconHtml('infoBox', 'recentEvents');
        html += `
            <div class="rpg-dashboard rpg-dashboard-row-3">
                <div class="rpg-dashboard-widget rpg-events-widget">
                    ${eventsLockIconHtml}
                    <div class="rpg-notebook-header">
                        <div class="rpg-notebook-ring"></div>
                        <div class="rpg-notebook-ring"></div>
                        <div class="rpg-notebook-ring"></div>
                    </div>
                    <div class="rpg-notebook-title" data-i18n-key="infobox.recentEvents.title">${i18n.getTranslation('infobox.recentEvents.title')}</div>
                    <div class="rpg-notebook-lines">
        `;
        // Dynamically generate event lines (max 3)
        for (let i = 0; i < Math.min(validEvents.length, 3); i++) {
            html += `
                        <div class="rpg-notebook-line">
                            <span class="rpg-bullet">•</span>
                            <span class="rpg-event-text rpg-editable" contenteditable="true" data-field="event${i + 1}" title="Click to edit">${validEvents[i]}</span>
                        </div>
            `;
        }
        // If we have less than 3 events, add empty placeholders with + icon
        for (let i = validEvents.length; i < 3; i++) {
            html += `
                        <div class="rpg-notebook-line rpg-event-add">
                            <span class="rpg-bullet">+</span>
                            <span class="rpg-event-text rpg-editable rpg-event-placeholder" contenteditable="true" data-field="event${i + 1}" title="Click to add event" data-i18n-key="infobox.recentEvents.addEventPlaceholder">${i18n.getTranslation('infobox.recentEvents.addEventPlaceholder')}</span>
                        </div>
            `;
        }
        html += `
                    </div>
                </div>
            </div>
        `;
    }
    // Close the scrollable content wrapper
    html += '</div>';
    $infoBoxContainer.html(html);
    // Initial size update for location (must run after HTML is set)
    const $locationText = $infoBoxContainer.find('[data-field="location"]');
    if ($locationText.length) {
        updateLocationTextSize($locationText);
    }
    // Remove updating class after animation
    if (extensionSettings.enableAnimations) {
        setTimeout(() => $infoBoxContainer.removeClass('rpg-content-updating'), 500);
    }
}
