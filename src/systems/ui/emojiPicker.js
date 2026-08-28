/**
 * Emoji picker popover.
 *
 * A click-to-pick grid for the small emoji inputs scattered around DES
 * (relationship rows, sheet-note icons). Typing straight into the input still
 * works — this is an alternative to remembering an OS emoji shortcut, not a
 * replacement for the field.
 *
 * Deliberately a curated set rather than the full Unicode emoji table: these
 * inputs label a *relationship or section*, so a hundred well-chosen glyphs
 * are faster to scan than four thousand, and the whole list stays in one
 * screenful with no search box to tab through.
 *
 * One picker exists at a time. It's appended to <body> and positioned fixed,
 * because the settings drawer and the modals that host these inputs both clip
 * and scroll their contents — an absolutely-positioned popover inside them
 * would be cut off at the panel edge.
 */

const EMOJI_GROUPS = [
    {
        label: 'Affection',
        emoji: ['❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '💔', '❣️', '💕', '💞', '💓', '💗', '💖', '😍', '🥰', '😘', '💋', '🌹'],
    },
    {
        label: 'Bonds',
        emoji: ['🤝', '👪', '🫂', '👯', '🤗', '🙏', '🎗️', '🔗', '⛓️', '🪢', '🏠', '🍻', '🎁', '🤞', '👑', '🛡️', '⚜️', '🕊️'],
    },
    {
        label: 'Conflict',
        emoji: ['⚔️', '🗡️', '🔪', '💣', '💥', '🔥', '😠', '😡', '👿', '💀', '☠️', '🚫', '⚡', '🩸', '🥊', '🏴', '🐍', '🕷️'],
    },
    {
        label: 'Feeling',
        emoji: ['🙂', '😀', '😌', '😏', '😐', '😶', '🙄', '😒', '😔', '😢', '😭', '😨', '😱', '😳', '🥺', '🤔', '🤨', '😬', '😴', '🤯'],
    },
    {
        label: 'Standing',
        emoji: ['⚖️', '⭐', '🌟', '✨', '🏆', '🥇', '🎖️', '💎', '🔱', '📈', '📉', '🔒', '🔓', '❓', '❗', '⚠️', '♟️', '🎭'],
    },
    {
        label: 'Other',
        emoji: ['🌙', '☀️', '🌊', '🌱', '🍂', '❄️', '🐺', '🦊', '🐈', '🦉', '🎵', '📖', '🗝️', '🧭', '⏳', '🪞', '🧿', '🩹'],
    },
];

let $picker = null;      // the live popover, if open
let activeAnchor = null; // the input it belongs to

/** Tears down the open picker and its document-level listeners. */
export function closeEmojiPicker() {
    if (!$picker) return;
    $picker.remove();
    $picker = null;
    activeAnchor = null;
    document.removeEventListener('mousedown', onDocMouseDown, true);
    document.removeEventListener('touchstart', onDocMouseDown, true);
    document.removeEventListener('keydown', onKeyDown, true);
    // Capture phase so a scroll inside the settings drawer closes it too, not
    // just a scroll of the page itself.
    window.removeEventListener('scroll', closeEmojiPicker, true);
    window.removeEventListener('resize', closeEmojiPicker);
}

/** Dismisses on any press that lands outside both the popover and its input. */
function onDocMouseDown(e) {
    if (!$picker) return;
    const target = e.target;
    if (!(target instanceof Node)) return;
    if ($picker[0].contains(target) || target === activeAnchor) return;
    closeEmojiPicker();
}

function onKeyDown(e) {
    if (e.key === 'Escape') {
        e.stopPropagation();   // don't also close the modal/drawer behind it
        const anchor = activeAnchor;
        closeEmojiPicker();
        try { anchor?.focus(); } catch (err) { /* anchor may be gone */ }
    }
}

/**
 * Places the popover under the anchor, flipping above it when there isn't
 * room below and clamping to the viewport so it can never open off-screen.
 */
function position(anchor) {
    const r = anchor.getBoundingClientRect();
    const w = $picker.outerWidth();
    const h = $picker.outerHeight();
    const gap = 4;
    let top = r.bottom + gap;
    if (top + h > window.innerHeight - gap && r.top - h - gap > gap) {
        top = r.top - h - gap;                       // flip above
    }
    top = Math.max(gap, Math.min(top, window.innerHeight - h - gap));
    let left = r.left;
    left = Math.max(gap, Math.min(left, window.innerWidth - w - gap));
    $picker.css({ top: `${top}px`, left: `${left}px` });
}

/**
 * Opens the picker against an input.
 *
 * @param {HTMLElement} anchor - the element to position against (the input)
 * @param {(emoji: string) => void} onPick - called with the chosen emoji
 */
export function openEmojiPicker(anchor, onPick) {
    // Clicking the same input again closes it, so the input stays a toggle.
    const reopeningSame = activeAnchor === anchor;
    closeEmojiPicker();
    if (reopeningSame || !anchor) return;

    const groups = EMOJI_GROUPS.map(g => `
        <div class="rpg-emoji-picker-group-label">${g.label}</div>
        <div class="rpg-emoji-picker-grid">
            ${g.emoji.map(e =>
        `<button type="button" class="rpg-emoji-picker-btn" data-emoji="${e}">${e}</button>`).join('')}
        </div>`).join('');

    // No "clear" action: every field this picker serves coerces an empty
    // value back to a default glyph, so a clear button would claim to do
    // something it can't. Emptying the field by typing still works.
    $picker = $(`<div class="rpg-emoji-picker" role="dialog" aria-label="Choose an emoji">
        ${groups}
    </div>`);
    $('body').append($picker);
    activeAnchor = anchor;
    position(anchor);

    // mousedown-preventDefault keeps focus in the input, so the input's own
    // blur/change handlers don't fire in the middle of a pick.
    $picker.on('mousedown', (e) => e.preventDefault());
    $picker.on('click', '.rpg-emoji-picker-btn', function () {
        const emoji = $(this).attr('data-emoji') || '';
        closeEmojiPicker();
        try { onPick(emoji); } catch (err) { console.warn('[Dooms Tracker] emoji pick failed', err); }
    });

    // touchstart as well as mousedown: DES is used heavily on phones, and a
    // tap outside must dismiss without waiting for a synthesised mouse event.
    document.addEventListener('mousedown', onDocMouseDown, true);
    document.addEventListener('touchstart', onDocMouseDown, true);
    document.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('scroll', closeEmojiPicker, true);
    window.addEventListener('resize', closeEmojiPicker);
}
