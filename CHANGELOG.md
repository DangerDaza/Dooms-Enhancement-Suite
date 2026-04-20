# Changelog

## [1.9.1] - 2026-04-20

### Added
- **Relationship chips are now interactive.** In the Workshop's Identity tab, click a chip (Lover / Friend / Ally / Enemy / Neutral) to set a **persistent override** for that character; click the already-selected chip to clear. The override wins over the AI's per-turn classification, is used on Roster tile badges, and is threaded into the Inject prompt ("Relationship to the player: X. Reflect this dynamic…"). Stored globally in `extensionSettings.characterRelationships` (v21 migration).
- **Description (bio + appearance)** — the Injection tab's description field was relabeled and its placeholder rewritten to cue physical details explicitly. No data change; the existing field now has clearer UX.
- **Attach portrait to message (vision models only)** — new toggle in the Workshop's Injection tab. When on, clicking **Inject into Scene** also stamps the character's portrait onto your next outgoing user message (`extra.image` + `inline_image`) so Claude 3.x / GPT-4o / Gemini / etc. can actually see them. Silently no-ops on text-only models. Off by default; global setting (v22 migration).
- **Character appears in the panel immediately on Inject.** Previously a freshly-injected character only showed up in the Present row after the AI's next response confirmed them; now they pop in on click and persist through reload until the AI updates the scene.
- **INJECTING overlay + Cancel Injection.** The portrait card gets a pulsing `INJECTING…` overlay with a highlight ring while an inject is pending. Right-click the card for a new **Cancel Injection** action — clears the extension prompt, disarms the portrait-attach listener, removes the character from the Present row, all without touching their Workshop data / lorebook / roster entry.
- **Workshop restore banner.** Opening a character that's been soft-hidden shows a banner under the header: *"Hidden from this chat's Present Characters panel. Manage here, or restore the portrait card below."* with a one-click **Return to panel** button.

### Changed
- **"Remove from panel"** in the portrait-bar right-click menu is now labeled **"Send to Workshop"** — matches the mental model that the Workshop is where a hidden character's data lives. Tooltip clarifies it's a soft hide, not a delete.
- **Inject un-hides automatically.** If the character was previously soft-hidden, Inject now also removes them from the removed-characters blacklist so the splice actually lands on the panel.
- **Inject prompt gets more context.** When you've set a relationship override, it's now included in the one-shot scene direction; toastr feedback lists every extra applied (relationship, description, lorebook, portrait).

### Fixed
- Soft-hiding a character used to be a one-way trap after the 1.9.0 removal of the old "Restore removed characters" button. Any Workshop session on a hidden character now exposes the restore path clearly, and Inject also un-hides, so the blacklist can't leave characters permanently stuck.

## [1.9.0] - 2026-04-20

### Added
- **Character Workshop** — a unified per-character editor modal. Right-click a portrait and pick **Open in Workshop** to edit that character's dialogue color, portrait, and injection extras from one screen. Split-pane layout with a live portrait preview in the left rail; edits are staged until you click **Save** (Cancel throws them away). Tabs: **Identity** (read-only name + relationship), **Appearance** (portrait upload, dialogue color with full palette + custom-color dropper, expression-folder shortcut), **Injection** (brief description + attached lorebook). Tied to the Present Characters Panel feature toggle.
- **Inject into Scene** — Workshop footer action that adds the character to the active known-characters roster, queues a one-shot extension prompt instructing the AI to incorporate them in the next response, and (if a lorebook is attached) activates that lorebook for the next generation. The injection prompt is automatically cleared on the next `GENERATION_ENDED` *or* the next `GENERATION_STARTED` (whichever fires first), so it's truly one-shot even with regenerate / streaming.
- **Character Roster** — a grid view of every character with a saved portrait, color, or roster entry. Opens from a button in the portrait-bar header *and* from **Open Character Roster** in the Present Characters Panel accordion. Live search, scope pills (**All / This chat / Currently in scene**), active-in-scene indicator on tiles, right-click context menu with **Open in Workshop** and **Delete character** entries, **+ New Character** tile to add brand-new characters by name.
- **Side-mode portrait bar** — two new positions for the Present Characters Panel: **Left Side** and **Right Side**. Side mode floats over the chat as a vertical strip with cards stacked top-to-bottom. Settings: **Columns** (1 wide / 2 wide), **Alignment** (Top / Bottom — Bottom uses `flex-wrap: wrap-reverse` so active characters glue to the bottom edge). Collapses to a thin handle via the existing chevron toggle.
- **Show Expression in Tooltip** toggle (Settings → Present Characters Panel → Expressions). When on, hovering a portrait card shows `Name — happy` / `Name — angry` / etc. based on the most recent classification. Labels persist per-chat across reloads.
- **Info popup** (circle-i button) on the Expressions subsection header explaining DES handles expressions natively (no separate ST extension needed) and how to drop sprite PNGs into a character's expression folder.

### Changed
- **Portrait-bar context menu**: "Remove Character" renamed to "Remove from panel" with a softer icon. The action is now a soft remove (preserves Workshop data) — character is hidden from the current chat's panel only. Full delete moved to the Workshop's Delete button and the Roster's right-click → Delete.
- **Per-Chat Character Tracking** moved out of the Expressions subsection into its own **Roster** subsection so its scope reads correctly.
- **Tracker Editor**: `openTrackerEditor` is now exported so the Workshop's Trackers tab handoff can call it directly (the previous `#rpg-open-tracker-editor` click target was orphaned).

### Fixed
- Portrait-bar character lookups now read `data-char` instead of the `title` attribute, so the new expression-tooltip decoration (`Name — emotion`) doesn't leak into action paths like Open Expression Folder (which previously created stray `Celestine — realization`-style folders on disk).
- The roster's "Open Character Roster" settings button is hidden when the Present Characters Panel toggle is off, instead of staying clickable for a disabled feature.
- Workshop's Delete and Roster's Delete now wipe the same set of persistence stores (including `characterInjection` extras), so the two paths can't leave residue for the other.
- Side-mode panel honors the chosen DES theme via `--rpg-bg`.
- Inner side-mode bar background flattened so cards sit on a single surface instead of nested layers.
- Side-mode 2-wide column count now actually fits two cards per row (the panel-width calc didn't account for each card's 1px border).

## [1.5.7] - 2026-02-23

### Fixed
- **TTS sentence highlight timer drift** — when `boundary` events from the Web Speech API aren't available, the timer-based fallback was drifting ahead of the actual voice over long messages. Three targeted fixes applied:
  1. **Pause/resume at chunk boundaries** — SillyTavern splits long messages into ~200-char chunks. The timer now pauses when a chunk's `end` event fires and resumes when the next chunk's `start` fires, eliminating the 50–300ms inter-chunk gap that was being counted as speech time (×10 chunks = up to 3 seconds of phantom drift).
  2. **Chunk position resync** — when each new chunk starts, the first significant word in the chunk is used to detect backward drift (timer ran ahead of the engine). If drift is detected, the timer snaps back to the correct sentence.
  3. **WPM calibration** — actual chunk duration (from `start` to `end` events) is measured and used to calibrate the ms-per-word estimate via exponential moving average, adapting to the actual voice speed rather than relying solely on the 310ms/word baseline.

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
