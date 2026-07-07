# Feature Parity Checklist — branch `Rebuild`

Run the full list at every phase boundary. A phase is not done until every line passes.
"Pass" = behaves identically to v1.11.3 (`ce4c73c`) from the user's perspective.

## Core lifecycle
- [ ] Extension loads with zero console errors (fresh page load)
- [ ] Master enable/disable toggle works mid-session (UI appears/disappears cleanly)
- [ ] Settings persist across page reload (every section)
- [ ] v24 settings from live install load without reset; old keys migrate
      (`rpg-companion-sillytavern`, `dooms-character-tracker`)
- [ ] Per-chat data (`chat_metadata.dooms_tracker`) restores on chat switch
- (Loading intro removed by design — feature deleted, ported from test/auto-portraits)
- [ ] i18n: switch en → ru → zh-tw → en; all visible labels update
- [ ] System Log and Notification Log capture entries; Copy All works

## Generation & tracking
- [ ] Tracker JSON injected on generation; fields parse into panels
- [ ] Per-swipe data: swipe back/forth preserves independent tracker state
- [ ] Swipe / regenerate / continue / impersonate do not corrupt tracker data
- [ ] Locked fields are preserved across generations
- [ ] Manual update button works
- [ ] Connection profile dropdown lists profiles; external API generation mode works
- [ ] Prompt editor: custom prompts save and take effect

## Present Characters Panel (portrait bar)
- [ ] Cards render for present characters; absent grey-out option works
- [ ] Speaking pulse animation on active speaker
- [ ] Right-click menu: upload image, dialogue color, remove, character sheet
- [ ] Custom avatar upload + crop; ST card auto-import; emoji fallback
- [ ] Expression sync mirrors sprites when enabled; persists until next line
- [ ] Auto-portrait prompt generation (workshop) works
- [ ] Per-chat character tracking isolates rosters between chats
- [ ] Card size / spacing / radius / glow / position settings apply live
- [ ] New-character entrance animation plays once, only for new cards

## Scene Tracker
- [ ] All layout modes render: grid, stacked, compact, banner, HUD, ticker (top+bottom)
- [ ] HUD is draggable; position persists
- [ ] Scene transitions (location/time change cards) appear at the right messages
- [ ] Field visibility toggles apply
- [ ] TTS does not read scene blocks

## Chat Bubbles
- [ ] Discord style and Card style both render
- [ ] Group chat: speaker attribution correct per bubble
- [ ] Quoted dialogue inside narration attributes correctly
- [ ] Edit message → bubbles re-apply; delete → no residue; swipe → re-apply
- [ ] Toggling bubbles off restores the original message HTML exactly
- [ ] Bubble TTS buttons work

## Thoughts
- [ ] Thoughts panel renders per character; cards flip
- [ ] Inline thought bubbles render in messages
- [ ] Editable fields (appearance/demeanor/stats) save on blur; locks work
- [ ] Editing focus is not destroyed by an unrelated re-render

## Weather & ambience
- [ ] Rain / snow / mist / clear(sun+dust) effects render for matching scene weather
- [ ] Indoor scenes suppress outdoor particles
- [ ] Effects pause when tab hidden; respect prefers-reduced-motion
- [ ] Snowflakes toggle works independently

## Doom Counter
- [ ] Tension score read from responses; debug mode shows live values
- [ ] Streak → countdown → twist modal flow; twist injects into next generation
- [ ] All sliders (ceiling/threshold/length/choices/context/truncation/depth) take effect
- [ ] Trigger Now button works

## Quests
- [ ] Main + side quests render in headers and panels; inline edit + lock work
- [ ] Quests included in generation context

## Lore Library
- [ ] Library folders: create, rename, icon/color, drag-to-reorder
- [ ] Per-library and master toggle-all; inline entry editing; search/filter
- [ ] Token count estimates; mobile lorebook view
- [ ] Bunny Mo: !fullsheet / !quicksheet import → character sheet popup; persists per-chat

## Misc features
- [ ] Dialogue coloring: font tags display, stripped for TTS, 30-color palette
- (Name Ban removed in 2.1.0 — superseded by Character Aliases)
- [ ] History persistence: save + restore snapshot
- (Chapter checkpoints removed from checklist: checkpointUI.js/chapterCheckpoint.js
  were dead code — exported but never imported/initialized anywhere — deleted in Phase 2)
- [ ] Music player renders/controls (where applicable)
- [ ] Character sheets open from portrait right-click; sections collapse

## Themes & customization
- [ ] All themes apply: Default, Sci-Fi, Fantasy, Cyberpunk, Minimal, Midnight Rose
- [ ] Custom colors + per-element opacity apply live
- [ ] FAB customization toggles apply

## Mobile / desktop
- [ ] Mobile FAB drag + persist position; touch controls on all panels
- [ ] Quick-Jump button (mobile): appears on scroll-up, auto-hides after 2s,
      tap jumps to last user message, repeated taps walk up through earlier
      ones; Display-section toggle hides it live
- [ ] Virtual keyboard resize fix still active
- [ ] Desktop tabs and strip widgets (clock/date/location) work

## New in the Rebuild (verify both states)
- [ ] New player experience: a FRESH install starts with scene tracker,
      present characters (+panel), dialogue coloring, and Discord bubbles ON,
      D button centered, everything else OFF; an EXISTING install keeps its
      setup exactly (including D position) after updating
- [ ] Restore Default Settings (Advanced): confirm dialog -> applies the
      new-player profile, KEEPS characters/colors/avatars/presets/lorebook
      organization, reloads cleanly
- [ ] What's New screen: shows AT LEAST ONCE after every update on desktop
      and phone "desktop site" mode (>=980px viewport), never in normal mobile
      view; manual "What's New" button in the extensions dropdown works on any
      device; X / Got it / Esc / click-outside dismiss until the NEXT release
      (no in-dialog permanent dismissal); permanent opt-out ONLY via the
      Display-section toggle; DOM and stylesheet fully removed after close
- [ ] Performance Mode toggle (Display section): on -> animations/blur/particles stop,
      off -> restored without reload
- [ ] Compact Tracker Prompt toggle (Advanced): tracker JSON parses identically in both modes
- [ ] First open of any DES modal (settings, sheet, workshop, roster, lorebook, logs,
      editors) loads the deferred UI exactly once; everything works identically after
- [ ] Weather/snowflake visuals on canvas match the old CSS particles per type
      (snow/rain/mist/wind/clear day/night/dawn/dusk, storm, blizzard)

## Feature toggle cycling (added requirement from rebuild)
For EACH feature: disable mid-session → no DOM residue, no console errors;
re-enable → feature fully functional without page reload; repeat twice
(catches double-binding).
