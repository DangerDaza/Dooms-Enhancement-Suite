/**
 * Core Configuration Module
 * Extension metadata and configuration constants
 */

/**
 * Dynamically determine extension name and path from the current script URL.
 * This means the extension works regardless of what folder name the user clones it into.
 * e.g. "Dooms-Enhancement-Suite", "dooms-character-tracker", etc. all work.
 */
const _scriptUrl = import.meta.url;
// Extract the folder name that contains this extension by walking up from the script path
// URL pattern: .../extensions/third-party/<folder-name>/src/core/config.js
const _thirdPartyMatch = _scriptUrl.match(/extensions\/(third-party\/[^/]+)\//);
const _detectedExtensionName = _thirdPartyMatch ? _thirdPartyMatch[1] : 'third-party/dooms-character-tracker';
export const extensionName = _detectedExtensionName;

/**
 * Dynamically determine extension path based on current location
 * This supports both global (public/extensions) and user-specific (data/default-user/extensions) installations
 */
const isUserExtension = _scriptUrl.includes('/data/') || _scriptUrl.includes('\\data\\');
export const extensionFolderPath = isUserExtension
    ? `data/default-user/extensions/${extensionName}`
    : `scripts/extensions/${extensionName}`;
/**
 * Default extension settings
 */
export const defaultSettings = {
    enabled: true,
    autoUpdate: true,
    updateDepth: 4,
    generationMode: 'together',
    showInfoBox: true,
    showCharacterThoughts: true,
    showQuests: true,
    showLockIcons: true,
    showThoughtsInChat: true,
    enableHtmlPrompt: false,
    skipInjectionsForGuided: 'none',
    saveTrackerHistory: false,
    panelPosition: 'right',
    theme: 'default',
    customColors: {
        bg: '#1a1a2e',
        accent: '#16213e',
        text: '#eaeaea',
        highlight: '#e94560'
    },
    enableAnimations: true,
    mobileFabPosition: {
        top: 'calc(var(--topBarBlockSize) + 60px)',
        right: '12px'
    },
};
