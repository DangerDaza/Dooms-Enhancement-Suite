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
- [ ] New tracker menus follow the theme: the Tracker Prompt editor (edited badge, key-warning callout, token counter, hint) and the editor field rows/sub-rows use `--rpg-*` tokens only — no fixed greys or white-alpha fills. Cycle Default / Sci-Fi / Fantasy / Cyberpunk / Midnight Rose / Emerald Grove / Arctic / Volcanic / Dracula / Ocean Depths / Custom and confirm all text stays legible and the warning callout picks up each theme's highlight
- [ ] Edit Trackers has TWO tabs (Scene Tracker, History Persistence); Present Characters is gone and character-thoughts wording (enable/label/instruction) lives at the bottom of the Scene Tracker tab and still reaches the AI
- [ ] Tracker prompt still requests the full character block — name, emoji, color, details (appearance/demeanor + any custom), relationship, stats and thoughts — so card back-faces, relationship badges, stat bars, bubble attribution and thought dropdowns all keep working after the Present Characters tab removal (run `node tools/tracker-prompt-test.mjs`)
- [ ] Settings → **Workshop** → Relationships: rows generated from tracker config (name + emoji + remove); Add Relationship appends a uniquely-named row; renaming keeps the row's position and doesn't clobber an existing name; edits save immediately and repaint the portrait bar + thoughts panel; **Track Relationships** off removes the `relationship` key from the prompt *and* hides the badge on cards; the options offered to the AI match the rows shown, including newly added custom names
- [ ] Workshop → Relationships → **emoji picker**: clicking the emoji field opens the grid; clicking a glyph writes it to the row, saves, and repaints the card badge; clicking the same field again closes it; clicking a different field moves the popover rather than stacking a second one; outside click / Escape / scrolling the drawer all dismiss it; it flips above the field near the bottom of the screen and never opens off the right edge; typing or pasting an emoji outside the curated set still works; adding or removing a row while it's open dismisses it rather than leaving it anchored to a dead input. Check on a phone as well as desktop, and against a light theme (it uses `--rpg-*` tokens only)
- [ ] Workshop → Relationships → **Wording**: empty box emits `(choose one: A/B/C)` byte-identically to pre-2.5; filled box emits `<wording> (choose one: A/B/C)`; quotes/backslashes in the wording are escaped so the spec stays parseable; the **Sent as** line matches the real prompt exactly and updates as you type, add/rename/remove rows, and toggle tracking off (run `node tools/tracker-prompt-test.mjs`)
- [ ] Tracker Editor OPENS from Settings → Scene Tracker → "Customize Tracker Fields" (the only entry point; verify it exists and the modal appears — it was orphaned markup-less before 2.5)
- [ ] Custom tracker field types: Text/Number(+range)/Choice(+options)/List/Yes-No/Percent each emit their own spec shape; an UNTYPED or Text field emits byte-identical spec to pre-2.5 (no prompt drift for existing setups); Choice with no options degrades to text; type change re-renders the editor sub-row (choices / min-max)
- [ ] Custom scene fields appear as quick toggles in Settings → Scene Tracker, generated from config (a field added in the Tracker Editor shows up there without a reload; toggling it there hides/shows it in the header and persists)
- [ ] Optional scene fields (moon/tension/rest/conditions/terrain) accept a per-field wording override; empty = shipped wording restored exactly
- [ ] Tracker Prompt editor: box prefills with the REAL assembled prompt (instructions + FORMAT spec); saving it untouched stores NO override (later field-config changes still reach the AI); a real edit is sent verbatim; Restore Default returns the generated text and clears the override; token estimate + "edited" badge update live; renaming/removing a key warns and names the affected panel; resetting Tracker Instructions refreshes the full box (run `node tools/tracker-prompt-test.mjs`)

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
- [ ] Scene header FOLLOWS the newest AI message across turns whose scene data is identical (same location+time) — it must not stay stranded on the previous message; no duplicates; unchanged scene still skips the rebuild (same DOM node kept); destroying the header re-renders it
- [ ] Field visibility toggles apply
- [ ] TTS does not read scene blocks

## Chat Bubbles
- [ ] Discord style and Card style both render
- [ ] Long messages wrap AROUND the portrait (text beside it, then full width underneath — no tall empty gutter under the avatar); a message shorter than the portrait still contains it (next bubble starts below, no overlap); continuation segments stay aligned with the first segment's text; avatars-off has no indent
- [ ] Group chat: speaker attribution correct per bubble
- [ ] "The X" character names never claim unknown-color dialogue via the narration fallback (the article is not a name shortcut; "anthem" is); a present character whose stored color is absent from the message adopts their tracker-claimed hex when it's live and unowned (old hex banked to previousColors; a user-replaced hex is never re-adopted — run drift-reconcile sandbox test)
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
- [ ] Fullsheet import button visible on the message face with expand_message_actions OFF (the default); appears for all template generations (/6 /8 /13 /14), tags-only truncated replies (≥3 tags incl. a canonical BunnyMo key), swipes, edits, and lazy-loaded history; never on HP/day-counter stat text, never on prose with 3+ `<Key: value>` status decorations, never on a bare `<BunnymoTags>` open tag the parser can't import (button shown ⇒ import succeeds); a prose counter ("Day 3/10 of the voyage.") inside a sheet doesn't split a section on import; removed when a swipe/edit replaces the sheet with prose (run `node tools/sheet-detect-test.mjs`)

## Misc features
- [ ] Dialogue coloring: font tags display, stripped for TTS, 54-color named palette (hover swatch → name+hex tooltip; original 30 unchanged; auto-assignment uses the same shared pool)
- (Name Ban removed in 2.1.0 — superseded by Character Aliases)
- [ ] History persistence: save + restore snapshot
- (Chapter checkpoints removed from checklist: checkpointUI.js/chapterCheckpoint.js
  were dead code — exported but never imported/initialized anywhere — deleted in Phase 2)
- [ ] Music player renders/controls (where applicable)
- [ ] Character sheets open from portrait right-click; sections collapse
- [ ] Notes Mode: per-character toggle swaps sheet for editable dropdown sections (add/edit/delete/reorder); imported sheet survives toggle round-trip and merge-on-import; notes persist per-chat across reload and fast chat switch; popup closes on chat change
- [ ] New-character similar-name panel: Sara-vs-Sarah offers alias / create-separate / back; exact-alias name warns; alias lands in Workshop → Identity → Aliases; user-mode shows warning without alias option; bulk imports unaffected
- [ ] Ingestion duplicate protection: tracker name 'X (anything)' or 'The X'/'X' variants of an existing card fold into it silently + alias auto-recorded; fuzzy-similar new names raise ONE yes/no dialog per pair (DES-themed, follows selected theme incl. on first message before settings ever opened); WHILE the dialog is open the name does not exist: no PCP card spawns (and no knownCharacters entry is created), no thoughts-panel/inline-thought card, no auto-portrait render or expression classify, CHAT BUBBLES WAIT before attributing dialogue — Yes folds it into the existing card and TRANSFERS the harvested dialogue color (canonical colorless → color moves; canonical already colored → variant hex banked in previousColors so the message's font tags still attribute right) + any generated avatar, then scrubs leftovers and repaints (bubble speaker correct — run alias-adopt/pcp-gate sandbox tests); No dismisses permanently and the held card appears immediately; Escape/backdrop = ask again later, card appears until re-asked; exact existing card names untouched; no dialogs on chat load; TWO similar names in one message queue dialogs ONE AT A TIME and both settle (no stuck pending); a dismissed pair doesn't block asking about a different similar card; user personas are never proposed as merge targets and never get aliases recorded (decorated persona names still fold); No-dismissals survive page reload; in separate/external mode answering the popup re-applies the last message's bubbles (popup opens after the 800ms pass there); message EDIT during an open popup also waits (run decision-flow sandbox test)
- [ ] PCP right-click → Regenerate Portrait: confirms, replaces card + sheet hero art (both stores swapped), old portrait banked and Restore Previous Portrait swaps it back (item hidden when no history), toasts on missing SD extension / failure, hidden for user characters, no double-fire while pending, history purged with the character
- [ ] Tracker Data in Chat (toggle off by default): 🗂️ dropdown on tracker-bearing AI messages; survives recolor/bubbles/edit; follows swipes; edit validates JSON, persists per-swipe, refreshes panels when latest message; invalid JSON toasts without saving; toggle off removes all dropdowns
- [ ] Mobile Compose Overlay opens ONLY on a real tap of the message box — never on page reload/chat load, after sending, when a generation finishes, or when a popup closes (all of which focus the input programmatically)
- [ ] Mobile Compose Overlay (toggle off by default, ≤1000px only): tap input → sheet opens with existing text; typing mirrors to real input (token counter live); Send sends via ST; close keeps text; sheet resizes with keyboard (Send stays visible); no reopen loop after send/close; desktop unaffected
- [ ] Workshop → Appearance two-step: Write prompt from description fills the field WITHOUT rendering (review/tweak possible); Render portrait generates from the field (empty = automatic prompt), banks old portrait; disabled states + toasts; no-op without description; NPC-only
- [ ] Portrait prompts: multi-line LLM/description prompts flattened before /sd (ComfyUI backend generates, no workflow-JSON error); Workshop → Appearance "Portrait prompt" field persists, is NPC-only, overrides LLM prompt for Regenerate Portrait AND auto-portraits, cleared on character delete

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
