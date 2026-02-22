# Changelog

## [Unreleased]

### Added
- **Banner, HUD, and Ticker** layout modes for the Scene Tracker — selectable from the existing Layout Mode dropdown alongside Grid, Stacked, and Compact.

### Fixed
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
