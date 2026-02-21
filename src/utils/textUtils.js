/**
 * Text Utility Functions
 * Shared text manipulation utilities used across the extension
 */
/**
 * Separates emoji from text by looking for emoji at the start of the string
 * Falls back to checking for comma-separated emoji if no emoji is found
 * @param {string} str - Input string that may start with emoji
 * @returns {{emoji: string, text: string}} Separated emoji and text
 */
export function separateEmojiFromText(str) {
    if (!str) return { emoji: '', text: '' };
    str = str.trim();
    // Regex to match emoji at the start (handles most emoji including compound ones)
    // This matches emoji sequences including skin tones, gender modifiers, etc.
    const emojiRegex = /^[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F000}-\u{1F02F}\u{1F0A0}-\u{1F0FF}\u{1F100}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{1F910}-\u{1F96B}\u{1F980}-\u{1F9E0}\u{FE00}-\u{FE0F}\u{200D}\u{20E3}]+/u;
    const emojiMatch = str.match(emojiRegex);
    if (emojiMatch) {
        const emoji = emojiMatch[0];
        let text = str.substring(emoji.length).trim();
        // Remove leading comma or space if present
        text = text.replace(/^[,\s]+/, '');
        return { emoji, text };
    }
    // No emoji found - check if there's a comma separator anyway
    const commaParts = str.split(',');
    if (commaParts.length >= 2) {
        return {
            emoji: commaParts[0].trim(),
            text: commaParts.slice(1).join(',').trim()
        };
    }
    // No clear separation - return original as text
    return { emoji: '', text: str };
}
