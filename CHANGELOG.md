# Changelog

## [1.5.6] - 2026-02-23

### Fixed
- **Loading intro causes chat bubbles, thoughts, and scene headers to not render** — when the loading intro was enabled, SillyTavern emitted `CHAT_CHANGED` during the animation (while the extension's event listeners weren't registered yet), causing the initial chat render to be completely missed. Fixed by registering all event listeners before waiting for the intro to finish, and adding a fallback `onCharacterChanged()` call to recover if the event was already missed. The intro continues to cover the loading process exactly as intended.

## [1.5.5] - 2026-02-23

### Fixed
- **Loading intro blocking extension features** — the loading intro was hiding all open `<dialog>` elements so the overlay would be visible over ST's spinner. Because ST's spinner lives in the browser's native top layer (which cannot be overridden by z-index), this was the wrong approach: hiding the dialogs disrupted ST's own loading event flow, which prevented chat bubbles, scene tracker, and thoughts from initializing. The dialog-hiding logic has been removed entirely. The overlay now simply layers over the page content without touching ST's dialogs; the ST spinner may briefly appear through the overlay on some browsers, but all features load correctly.
- **"Theme Controls Scene Tracker" toggle not persisting after refresh** — the toggle had no event handler in `index.js` to save the state, no init code to restore it from settings, and `themeControlled` was missing from the `sceneTracker` defaults in `state.js`. All three are now in place: the default is `false`, the toggle is read and applied on settings open, and changes are saved and immediately reflected in the scene tracker.

## [1.5.3] - 2026-02-23

### Fixed
- **Newer themes not applying on reload** — the 6 themes added after v1.5 (Midnight Rose, Emerald Grove, Arctic, Volcanic, Dracula, Ocean Depths) were missing the `#rpg-settings-popup` and `#rpg-tracker-editor-popup` CSS blocks that set the popup background and color variables. The original 3 themes (Sci-Fi, Fantasy, Cyberpunk) were unaffected. All 6 newer themes now correctly style both popup modals.
- **Theme not applied to popup on initial load** — `applyTheme()` was only stamping `data-theme` on the panel, thought panel, and mobile toggle. The settings popup only received `data-theme` when first opened (`SettingsModal.open()`). Now `applyTheme()` also stamps both popup elements, so the correct theme is in place from the moment the extension loads.
- **Extension drawer showing stale version `v4.0.0`** — `settings.html` had a hardcoded version number that was never updated. Now shows the correct version.

## [1.5.2] - 2026-02-23

### Fixed
- **Expression Classifier firing on raw tracker JSON** — in Together mode, the extension was modifying `lastMessage.mes` (stripping tracker JSON) during the `MESSAGE_RECEIVED` event, before SillyTavern rendered the message to the DOM. This caused SillyTavern's Expression Classifier to fire an extra classify call per message on the raw JSON text. The `updateMessageBlock()` call in the same handler was also a no-op since the DOM element doesn't exist yet at that point. Both have been removed — the registered regex script already handles hiding JSON at render time.

## [1.5.1] - 2026-02-23

### Fixed
- **Scene tracker background hardcoded blue** — the gradient end color was `rgba(22, 33, 62, 0.4)` regardless of the background color picker. Now uses the user's chosen background color throughout the full gradient.
- **Quest text and events text ignoring color pickers** — quest value text and recent events italic text were hardcoded `#f0c040` / `#999` in the banner, HUD, ticker, and panel layout CSS. They now correctly respond to the color pickers.
- **Themes not applying to settings popup** — the 7 themes added in a recent session (Midnight Rose, Emerald Grove, Arctic, Volcanic, Dracula, Ocean Depths) had no CSS rules for the settings modal or tracker editor popup, so the popup always rendered with default dark styling. All themes now fully style both popups.

### Added
- **Quest Text Color** — new separate color picker for the quest value text, independent from the Quest Icon Color picker. Allows e.g. gold icon with white text.

## [1.5] - 2026-02-23

### Added
- **Separate & External generation modes** — users can now choose how tracker data is generated: Together (embedded in the AI's roleplay response), Separate (dedicated API call via SillyTavern's generateRaw), or External API (user-configured OpenAI-compatible endpoint). Configurable in Settings → Generation.
- **Manual Refresh Tracker Data button** — in Separate and External modes, a button in the Generation settings triggers an on-demand tracker update without waiting for a new message.
- **Open Settings button in extension dropdown** — the SillyTavern Extensions tab drawer now has an "Open Settings" button for quick access to the full settings modal, in addition to the existing FAB button.
- **Hover TTS button on chat bubbles** — a megaphone icon appears when hovering over any bubble segment (narrator, character dialogue, etc.) in Discord-style bubble chat. Clicking it reads from that point through the end of the message via SillyTavern's TTS.
- **TTS sentence highlighting works with bubble TTS** — the highlight system now correctly finds and highlights sentences when TTS is triggered from a bubble, including proper cleanup that restores bubble HTML.
- **Connection Profile setting** — allows the tracker to use a separate API connection profile for generation, so it doesn't interfere with your main chat model. Configurable in the Generation settings section.
- **Banner, HUD, and Ticker** layout modes for the Scene Tracker — selectable from the existing Layout Mode dropdown alongside Grid, Stacked, and Compact.

### Fixed
- **Chat bubbles not appearing on swipes** — bubble formatting now correctly reapplies when swiping between message variants or generating new swipes. Previously, stale data attributes caused the renderer to skip reapplication, and a timing issue meant bubbles were applied before colored-dialogues finished adding font color tags.
- **"Unknown command /sd" error in Separate mode** — avatar generator now checks if the Stable Diffusion extension is loaded before attempting the `/sd` slash command. No more error toasts when SD isn't configured.
- **Connection profile not restoring after tracker generation** — when using a separate API connection profile for tracker generation, the profile now reliably switches back to the original after generation completes. Also shows a warning toast if restoration fails.
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
