/**
 * Lock Manager
 * Handles applying and removing locks for tracker items
 * Locks prevent AI from modifying specific values
 */
import { extensionSettings } from '../../core/state.js';
import { repairJSON } from '../../utils/jsonRepair.js';
/**
 * Apply locks to tracker data before sending to AI.
 * Adds "locked": true to locked items in JSON format.
 *
 * @param {string} trackerData - JSON string of tracker data
 * @param {string} trackerType - Type of tracker ('quests', 'infoBox', 'characters')
 * @returns {string} Tracker data with locks applied
 */
export function applyLocks(trackerData, trackerType) {
    if (!trackerData) return trackerData;
    // Try to parse as JSON
    const parsed = repairJSON(trackerData);
    if (!parsed) {
        // Not JSON format, return as-is (text format doesn't support locks)
        return trackerData;
    }
    // Get locked items for this tracker type
    const lockedItems = extensionSettings.lockedItems?.[trackerType] || {};
    // Apply locks based on tracker type
    switch (trackerType) {
        case 'quests':
            return applyQuestsLocks(parsed, lockedItems);
        case 'infoBox':
            return applyInfoBoxLocks(parsed, lockedItems);
        case 'characters':
            return applyCharactersLocks(parsed, lockedItems);
        default:
            return trackerData;
    }
}
// NOTE: applyUserStatsLocks() archived to src/archived/archived-features-userstats.js
// Stats, status, skills, inventory lock logic removed. Quest locks extracted below.
/**
 * Apply locks to Quests tracker
 * @param {Object} data - Parsed quests data
 * @param {Object} lockedItems - Locked items configuration
 * @returns {string} JSON string with locks applied
 */
function applyQuestsLocks(data, lockedItems) {
    // Lock main quest
    if (data.main && lockedItems.main === true) {
        data.main = { value: data.main, locked: true };
    }
    // Lock individual optional quests
    if (data.optional && Array.isArray(data.optional)) {
        data.optional = data.optional.map((quest, index) => {
            const bracketPath = `optional[${index}]`;
            if (lockedItems[bracketPath]) {
                return typeof quest === 'string'
                    ? { title: quest, locked: true }
                    : { ...quest, locked: true };
            }
            return quest;
        });
    }
    return JSON.stringify(data, null, 2);
}
/**
 * Apply locks to Info Box tracker
 * @param {Object} data - Parsed info box data
 * @param {Object} lockedItems - Locked items configuration
 * @returns {string} JSON string with locks applied
 */
function applyInfoBoxLocks(data, lockedItems) {
    if (lockedItems.date && data.date) {
        data.date = { ...data.date, locked: true };
    }
    if (lockedItems.weather && data.weather) {
        data.weather = { ...data.weather, locked: true };
    }
    if (lockedItems.temperature && data.temperature) {
        data.temperature = { ...data.temperature, locked: true };
    }
    if (lockedItems.time && data.time) {
        data.time = { ...data.time, locked: true };
    }
    if (lockedItems.location && data.location) {
        data.location = { ...data.location, locked: true };
    }
    if (lockedItems.recentEvents && data.recentEvents) {
        data.recentEvents = { ...data.recentEvents, locked: true };
    }
    return JSON.stringify(data, null, 2);
}
/**
 * Apply locks to Characters tracker
 * @param {Object} data - Parsed characters data
 * @param {Object} lockedItems - Locked items configuration
 * @returns {string} JSON string with locks applied
 */
function applyCharactersLocks(data, lockedItems) {
    // Handle both array format and object format
    let characters = Array.isArray(data) ? data : (data.characters || []);
    characters = characters.map((char, index) => {
        const charName = char.name || char.characterName;
        // Check if entire character is locked (index-based)
        if (lockedItems[index] === true) {
            return { ...char, locked: true };
        }
        // Check if character name exists in locked items (could be nested object for field locks or boolean for full lock)
        const charLocks = lockedItems[charName];
        if (charLocks === true) {
            // Entire character is locked
            return { ...char, locked: true };
        } else if (charLocks && typeof charLocks === 'object') {
            // Character has field-level locks
            const modifiedChar = { ...char };
            for (const fieldName in charLocks) {
                if (charLocks[fieldName] === true) {
                    // Check both the original field name and snake_case version
                    // (AI returns snake_case, but locks are stored with original configured names)
                    // Use the same conversion as toSnakeCase in thoughts.js
                    const snakeCaseFieldName = fieldName
                        .toLowerCase()
                        .replace(/[^a-z0-9]+/g, '_')
                        .replace(/^_+|_+$/g, '');
                    let locked = false;
                    // Check at root level first (backward compatibility)
                    if (modifiedChar[fieldName] !== undefined) {
                        modifiedChar[fieldName] = {
                            value: modifiedChar[fieldName],
                            locked: true
                        };
                        locked = true;
                    } else if (modifiedChar[snakeCaseFieldName] !== undefined) {
                        modifiedChar[snakeCaseFieldName] = {
                            value: modifiedChar[snakeCaseFieldName],
                            locked: true
                        };
                        locked = true;
                    }
                    // Check in nested objects (details, relationship, thoughts)
                    if (!locked && modifiedChar.details) {
                        if (modifiedChar.details[fieldName] !== undefined) {
                            if (!modifiedChar.details || typeof modifiedChar.details !== 'object') {
                                modifiedChar.details = {};
                            } else {
                                modifiedChar.details = { ...modifiedChar.details };
                            }
                            modifiedChar.details[fieldName] = {
                                value: modifiedChar.details[fieldName],
                                locked: true
                            };
                            locked = true;
                        } else if (modifiedChar.details[snakeCaseFieldName] !== undefined) {
                            if (!modifiedChar.details || typeof modifiedChar.details !== 'object') {
                                modifiedChar.details = {};
                            } else {
                                modifiedChar.details = { ...modifiedChar.details };
                            }
                            modifiedChar.details[snakeCaseFieldName] = {
                                value: modifiedChar.details[snakeCaseFieldName],
                                locked: true
                            };
                            locked = true;
                        }
                    }
                    // Check in relationship object
                    if (!locked && modifiedChar.relationship) {
                        if (modifiedChar.relationship[fieldName] !== undefined) {
                            modifiedChar.relationship = { ...modifiedChar.relationship };
                            modifiedChar.relationship[fieldName] = {
                                value: modifiedChar.relationship[fieldName],
                                locked: true
                            };
                            locked = true;
                        } else if (modifiedChar.relationship[snakeCaseFieldName] !== undefined) {
                            modifiedChar.relationship = { ...modifiedChar.relationship };
                            modifiedChar.relationship[snakeCaseFieldName] = {
                                value: modifiedChar.relationship[snakeCaseFieldName],
                                locked: true
                            };
                            locked = true;
                        }
                    }
                    // Check in thoughts object
                    if (!locked && modifiedChar.thoughts) {
                        if (modifiedChar.thoughts[fieldName] !== undefined) {
                            modifiedChar.thoughts = { ...modifiedChar.thoughts };
                            modifiedChar.thoughts[fieldName] = {
                                value: modifiedChar.thoughts[fieldName],
                                locked: true
                            };
                            locked = true;
                        } else if (modifiedChar.thoughts[snakeCaseFieldName] !== undefined) {
                            modifiedChar.thoughts = { ...modifiedChar.thoughts };
                            modifiedChar.thoughts[snakeCaseFieldName] = {
                                value: modifiedChar.thoughts[snakeCaseFieldName],
                                locked: true
                            };
                            locked = true;
                        }
                    }
                }
            }
            return modifiedChar;
        }
        // No locks for this character
        return char;
    });
    const result = Array.isArray(data)
        ? JSON.stringify(characters, null, 2)
        : JSON.stringify({ ...data, characters }, null, 2);
    return result;
}
/**
 * Remove locks from tracker data received from AI.
 * Strips "locked": true from all items to clean up the data.
 *
 * @param {string} trackerData - JSON string of tracker data
 * @returns {string} Tracker data with locks removed
 */
export function removeLocks(trackerData) {
    if (!trackerData) return trackerData;
    // Try to parse as JSON
    const parsed = repairJSON(trackerData);
    if (!parsed) {
        // Not JSON format, return as-is
        return trackerData;
    }
    // Recursively remove all "locked" properties
    const cleaned = removeLockedProperties(parsed);
    return JSON.stringify(cleaned, null, 2);
}
/**
 * Recursively remove "locked" properties from an object
 * @param {*} obj - Object to clean
 * @returns {*} Object with locked properties removed
 */
function removeLockedProperties(obj) {
    if (Array.isArray(obj)) {
        return obj.map(item => removeLockedProperties(item));
    } else if (obj !== null && typeof obj === 'object') {
        const cleaned = {};
        for (const key in obj) {
            if (key !== 'locked') {
                cleaned[key] = removeLockedProperties(obj[key]);
            }
        }
        return cleaned;
    }
    return obj;
}
/**
 * Check if a specific item is locked
 * @param {string} trackerType - Type of tracker
 * @param {string} itemPath - Path to the item (e.g., 'stats.Health', 'quests.main.0')
 * @returns {boolean} Whether the item is locked
 */
export function isItemLocked(trackerType, itemPath) {
    const lockedItems = extensionSettings.lockedItems?.[trackerType];
    if (!lockedItems) return false;
    const parts = itemPath.split('.');
    let current = lockedItems;
    for (const part of parts) {
        if (current[part] === undefined) return false;
        current = current[part];
    }
    return !!current;
}
/**
 * Toggle lock state for a specific item
 * @param {string} trackerType - Type of tracker
 * @param {string} itemPath - Path to the item
 * @param {boolean} locked - New lock state
 */
export function setItemLock(trackerType, itemPath, locked) {
    if (!extensionSettings.lockedItems) {
        extensionSettings.lockedItems = {};
    }
    if (!extensionSettings.lockedItems[trackerType]) {
        extensionSettings.lockedItems[trackerType] = {};
    }
    const parts = itemPath.split('.');
    let current = extensionSettings.lockedItems[trackerType];
    // Navigate to parent of target
    for (let i = 0; i < parts.length - 1; i++) {
        const part = parts[i];
        if (!current[part]) {
            current[part] = {};
        }
        current = current[part];
    }
    // Set or remove lock
    const finalKey = parts[parts.length - 1];
    if (locked) {
        current[finalKey] = true;
    } else {
        delete current[finalKey];
    }
}
