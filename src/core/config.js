/**
 * Core Configuration Module
 * Extension metadata and configuration constants
 */
export const extensionName = 'third-party/dooms-character-tracker';
/**
 * Dynamically determine extension path based on current location
 * This supports both global (public/extensions) and user-specific (data/default-user/extensions) installations
 */
const currentScriptPath = import.meta.url;
const isUserExtension = currentScriptPath.includes('/data/') || currentScriptPath.includes('\\data\\');
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
