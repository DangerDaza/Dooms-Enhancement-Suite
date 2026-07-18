/**
 * Dialogue color palette — single source of truth.
 *
 * Used by the Workshop's Appearance swatch grid (with name tooltips) and the
 * portrait bar's automatic color assignment for new characters. Previously
 * duplicated in both modules as bare hex arrays.
 *
 * Order matters: the first 30 are the original palette (kept byte-identical
 * so existing assignments keep matching their swatch); new colors append
 * after. All entries are picked to stay readable on dark chat backgrounds.
 */

export const DIALOGUE_COLOR_LIST = [
    // ── Original 30 ──
    { hex: '#e94560', name: 'Crimson Rose' },
    { hex: '#e07b39', name: 'Burnt Orange' },
    { hex: '#f0c040', name: 'Golden Yellow' },
    { hex: '#2ecc71', name: 'Emerald' },
    { hex: '#1abc9c', name: 'Turquoise' },
    { hex: '#4a7ba7', name: 'Steel Blue' },
    { hex: '#9b59b6', name: 'Amethyst' },
    { hex: '#e84393', name: 'Hot Pink' },
    { hex: '#5dade2', name: 'Sky Blue' },
    { hex: '#f39c12', name: 'Marigold' },
    { hex: '#8e44ad', name: 'Royal Purple' },
    { hex: '#d35400', name: 'Pumpkin' },
    { hex: '#16a085', name: 'Deep Teal' },
    { hex: '#c0392b', name: 'Brick Red' },
    { hex: '#00b894', name: 'Mint Green' },
    { hex: '#6c5ce7', name: 'Indigo' },
    { hex: '#fd79a8', name: 'Rose Pink' },
    { hex: '#a29bfe', name: 'Lavender' },
    { hex: '#55efc4', name: 'Seafoam' },
    { hex: '#fab1a0', name: 'Peach' },
    { hex: '#74b9ff', name: 'Cornflower Blue' },
    { hex: '#ffeaa7', name: 'Cream Yellow' },
    { hex: '#e17055', name: 'Terracotta' },
    { hex: '#00cec9', name: 'Aqua' },
    { hex: '#0984e3', name: 'Azure' },
    { hex: '#fdcb6e', name: 'Honey' },
    { hex: '#d63031', name: 'Scarlet' },
    { hex: '#e056fd', name: 'Orchid' },
    { hex: '#7ed6df', name: 'Powder Blue' },
    { hex: '#badc58', name: 'Lime' },
    // ── Expansion ──
    { hex: '#ff7675', name: 'Coral' },
    { hex: '#ffbe76', name: 'Apricot' },
    { hex: '#f6e58d', name: 'Pale Gold' },
    { hex: '#fad390', name: 'Champagne' },
    { hex: '#f19066', name: 'Salmon' },
    { hex: '#e55039', name: 'Flame' },
    { hex: '#ea8685', name: 'Blush' },
    { hex: '#cf6a87', name: 'Dusty Rose' },
    { hex: '#c44569', name: 'Rosewood' },
    { hex: '#f368e0', name: 'Magenta' },
    { hex: '#ff9ff3', name: 'Bubblegum' },
    { hex: '#a55eea', name: 'Violet' },
    { hex: '#778beb', name: 'Iris' },
    { hex: '#686de0', name: 'Periwinkle' },
    { hex: '#45aaf2', name: 'Cerulean' },
    { hex: '#60a3bc', name: 'Harbor Blue' },
    { hex: '#63cdda', name: 'Glacier' },
    { hex: '#38ada9', name: 'Juniper' },
    { hex: '#22a6b3', name: 'Ocean Teal' },
    { hex: '#26de81', name: 'Clover' },
    { hex: '#b8e994', name: 'Spring Green' },
    { hex: '#6ab04c', name: 'Moss Green' },
    { hex: '#d1ccc0', name: 'Silver' },
    { hex: '#a5b1c2', name: 'Slate' },
];

/** Legacy shape — bare hex array, same order as the list above. */
export const DIALOGUE_COLORS = DIALOGUE_COLOR_LIST.map(c => c.hex);

const _nameByHex = new Map(DIALOGUE_COLOR_LIST.map(c => [c.hex.toLowerCase(), c.name]));

/**
 * Human name for a palette color, '' for hexes outside the palette
 * (e.g. custom-picked colors).
 */
export function getDialogueColorName(hex) {
    if (!hex) return '';
    return _nameByHex.get(String(hex).toLowerCase()) || '';
}
