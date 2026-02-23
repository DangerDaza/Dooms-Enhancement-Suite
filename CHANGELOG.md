# Changelog

## [Unreleased]

### Added
- **Tracker Update Mode (3-state)** — replaces the old auto-update toggle with a dropdown: **Auto** (regenerates after every message + manual button available), **Manual Only** (no auto-generation, use the Regenerate button on demand), and **Off** (no generation at all). Includes a "Regenerate Tracker" button in the Generation settings section.
- **Open Settings button in extension dropdown** — the SillyTavern Extensions tab drawer now has an "Open Settings" button for quick access to the full settings modal, in addition to the existing FAB button.
- **Hover TTS button on chat bubbles** — a megaphone icon appears when hovering over any bubble segment (narrator, character dialogue, etc.) in Discord-style bubble chat. Clicking it reads from that point through the end of the message via SillyTavern's TTS.
- **TTS sentence highlighting works with bubble TTS** — the highlight system now correctly finds and highlights sentences when TTS is triggered from a bubble, including proper cleanup that restores bubble HTML.
- **Connection Profile setting** — allows the tracker to use a separate API connection profile for generation, so it doesn't interfere with your main chat model. Configurable in the Generation settings section.
- **Banner, HUD, and Ticker** layout modes for the Scene Tracker — selectable from the existing Layout Mode dropdown alongside Grid, Stacked, and Compact.

### Fixed
- **Wrong / "Unknown" speaker in chat bubbles** — speaker detection now registers first-name shortcuts for multi-word character names (e.g. "Sylvaine" matches "Sylvaine Moonwhisper") and searches backwards through earlier segments when the character name appears in a different block than the dialogue. Also remembers resolved color→speaker mappings within the same message so repeated dialogue by the same character is correctly attributed. Fixed an additional bug where character names mentioned *inside* dialogue (e.g. referencing another character) could be falsely detected as the speaker, and where Map iteration order caused the first-matched name to win instead of the name closest to the dialogue.
- **Settings FAB button hidden when portrait bar is not visible** — the "D" settings button is now always accessible, even when the portrait bar is turned off.
- **Context menu going off-screen on portrait panel** — right-click menu now clamps to the viewport so it never clips outside the window.
- **Red/pink box around user messages in bubble chat** — removed background and border styling from user messages in both Discord and Card bubble modes; also removed the avatar and header from user bubbles for a cleaner look.
- **Connection Profile dropdown not populating** — fixed property name mismatch (`extension_settings` vs `extensionSettings`) when reading SillyTavern's connection profiles.
- **Bubble TTS voice-not-found error** — no longer passes a `voice=` argument to `/speak`, avoiding toastr errors when a character doesn't have a mapped TTS voice. SillyTavern's TTS handles voice lookup internally.
- Chat bubble dialogue text now displays the correct per-character color. SillyTavern's global `--SmartThemeQuoteColor` was overriding inline colors on `<q>` tags inside bubble text.
- Bubble renderers now prefer the AI's original `<font color>` for dialogue, falling back to the extension's assigned color only when no font tag is present.
- Residual `<font>` tags are stripped from rendered bubble text for cleaner output.
- **"Error rendering template" on fresh GitHub install** — extension folder name is now auto-detected from `import.meta.url` instead of hardcoded, so any clone folder name (e.g. `Dooms-Enhancement-Suite`) works correctly.
- Scene tracker and thoughts dropdowns no longer disappear on page reload — DOM-dependent renders now wait for `#chat .mes` elements to be available.
- Selecting a new Scene Tracker layout mode now correctly rebuilds the display instead of leaving stale elements.
- Show Avatars, Show Author Names, and Show Narrator Label toggles now correctly apply in both Discord and Card bubble styles.

### Changed
- Narrator bubbles no longer display an avatar in Discord style, keeping the layout cleaner.
- Avatar shape changed from circle to rounded rectangle (6px border-radius) for better portrait display.
- Removed duplicate **Chat Bubble Mode** dropdown from the Display & Features section — the Chat Bubbles accordion is now the sole control.
- Scene Tracker color settings consolidated under the Scene Tracker accordion (previously split across multiple sections).
- **Safe defaults for fresh installs** — the following features now default to off so new users can opt in without affecting their existing SillyTavern setup: Thoughts in Chat, Portrait Bar, Dynamic Weather, Auto-generate Avatars, Plot Progression buttons, and Start Encounter button.
