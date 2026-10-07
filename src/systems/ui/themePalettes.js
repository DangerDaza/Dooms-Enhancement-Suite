/**
 * Colour palettes of the built-in themes, in one place.
 *
 * Values are the exact ones the CSS theme blocks use
 * (`#rpg-settings-popup[data-theme="..."] .rpg-settings-popup-content`), so
 * anything that needs the palette outside those selectors — the scene
 * tracker's theme-controlled colours, the UI setups' body-level tokens —
 * matches the windows. Fields: bg, accent, text, highlight, border.
 */
export const THEME_COLORS = {
    'sci-fi':        { bg: '#0a0e27', accent: '#1a1f3a', text: '#00ffff', highlight: '#ff00ff', border: '#00ffff' },
    'fantasy':       { bg: '#2b1810', accent: '#3d2516', text: '#f4e4c1', highlight: '#d4af37', border: '#8b6914' },
    'cyberpunk':     { bg: '#0d0221', accent: '#1a0b2e', text: '#00ff9f', highlight: '#ff00ff', border: '#ff00ff' },
    'midnight-rose': { bg: '#1a1025', accent: '#2a1838', text: '#e8d5e8', highlight: '#e8729a', border: '#9b4dca' },
    'emerald-grove': { bg: '#0d1f12', accent: '#1a3320', text: '#d4e8c8', highlight: '#c8a240', border: '#4a8c3f' },
    'arctic':        { bg: '#0c1929', accent: '#132640', text: '#dce8f4', highlight: '#64b5f6', border: '#4a8db7' },
    'volcanic':      { bg: '#1a1210', accent: '#2b1e18', text: '#f0dcc8', highlight: '#e8651a', border: '#b84a0f' },
    'dracula':       { bg: '#282a36', accent: '#343746', text: '#f8f8f2', highlight: '#ff5555', border: '#6272a4' },
    'ocean-depths':  { bg: '#0a1628', accent: '#0f2038', text: '#b8d8e8', highlight: '#00e5c8', border: '#1a6b8a' },
};

/** The default theme reads SillyTavern's own theme variables. */
export const DEFAULT_THEME_CSS = {
    bg: 'var(--SmartThemeBlurTintColor, rgba(26, 26, 46, 0.9))',
    accent: 'var(--black30a, rgba(22, 33, 62, 0.9))',
    text: 'var(--SmartThemeBodyColor, #eaeaea)',
    highlight: 'var(--SmartThemeQuoteColor, #e94560)',
    border: 'var(--SmartThemeBorderColor, #4a7ba7)',
};

/**
 * @param {string} hex - '#rrggbb'
 * @param {number} opacity - 0–100
 * @returns {string} rgba() string
 */
function hexToRgba(hex, opacity = 100) {
    const h = String(hex || '').replace('#', '');
    if (h.length !== 6) return hex;
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${opacity / 100})`;
}

/**
 * Resolves the active theme to five CSS colour strings (any valid CSS
 * colour, including var() references for the default theme).
 * @param {string} theme - extensionSettings.theme
 * @param {object} [customColors] - extensionSettings.customColors (for 'custom')
 * @returns {{bg: string, accent: string, text: string, highlight: string, border: string}}
 */
export function resolveThemeCss(theme, customColors) {
    if (theme === 'custom' && customColors) {
        const c = customColors;
        const highlight = hexToRgba(c.highlight, c.highlightOpacity ?? 100);
        return {
            bg: hexToRgba(c.bg, c.bgOpacity ?? 100),
            accent: hexToRgba(c.accent, c.accentOpacity ?? 100),
            text: hexToRgba(c.text, c.textOpacity ?? 100),
            highlight,
            border: highlight,
        };
    }
    const p = THEME_COLORS[theme];
    return p ? { ...p } : { ...DEFAULT_THEME_CSS };
}
