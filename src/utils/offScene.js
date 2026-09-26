/**
 * Off-scene detection for Present Characters entries. A character the
 * tracker lists but whose thoughts say they aren't in the scene is not shown
 * on the panel (portraitBar.getCharacterList) and is not voiced (voices).
 * Shared so the two can never disagree.
 *
 * thoughts.js carries its own, broader pattern for a different feature and
 * deliberately does not use this one.
 */
export const OFF_SCENE_RE = /\b(not\s+(currently\s+)?(in|at|present\s+in|present\s+at)\s+(the\s+)?(scene|area|room|location|vicinity))\b|\b(off[\s-]?scene)\b|\b(not\s+physically\s+present)\b|\b(absent\s+from\s+(the\s+)?(scene|room|area|location))\b|\b(away\s+from\s+(the\s+)?scene)\b/i;

/**
 * @param {string|{content?: string}|null|undefined} thoughts - a tracker entry's thoughts value
 * @returns {boolean}
 */
export function isOffScene(thoughts) {
    const text = thoughts && typeof thoughts === 'object' ? (thoughts.content || '') : (thoughts || '');
    return !!text && OFF_SCENE_RE.test(String(text));
}
