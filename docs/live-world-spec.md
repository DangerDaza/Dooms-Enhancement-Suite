---
tags: [des, skyreach, spec, live-world]
created: 2026-10-16
status: spec — not built
audited_against: local DES (branch Project-Short-Fuse, ffde8d1 + local settings-guard change in persistence.js)
---

# Live World — DES module build spec

A new DES module: background plot clocks, last-seen character locations, one window with the glance and a board of places (D69; Parts C and D below record what was first built and why it went). Built for Skyreach first. Every Skyreach detail lives in a **world pack**, so generalizing to other users later adds an editor; it does not rewrite the engine.

Design source: voice sessions with Dazia, 2026-10-16. Grounded in a read-only audit of the installed DES the same day (findings in §0).

---

## 0. Groundwork — do these first

| # | Task | Why (audit finding) |
|---|---|---|
| G1 | **Factor out `withBackgroundProfile(fn)`** from the inline switch/restore in `updateRPGData()` (`src/systems/generation/apiClient.js`, switch ~l.290, restore in `finally` ~l.469–495). Use `extensionSettings.connectionProfile`, `isConnectionProfileAvailable`, `getCurrentProfileName`, `getCurrentPresetName`, `switchToProfile`, `switchToPreset`. Call `safeGenerateRaw({ prompt, quietToLoud:false })` (`src/utils/responseExtractor.js`) inside it; external mode uses `generateWithExternalAPI(messages)`. Refactor the tracker to use the wrapper too. | The logic isn't reusable as it stands. Everything else depends on it. |
| G2 | **Own per-chat storage key: `chat_metadata.dooms_world`.** Save with `saveChatDebounced()`, or `saveChatConditional()` for commit points. **Never** store it under `chat_metadata.dooms_tracker`. | `saveChatData()` in `persistence.js` rebuilds `dooms_tracker` from a whitelist on every save, so unknown fields are wiped. |
| G3 | **Counted-message ID set** in `dooms_world.counted`. Only count a message id once; swipes and regens are not new messages. | The Doom Counter has no ID tracking. `onResponseReceived()` counts every fresh reply, including swipes. |
| G4 | **Blind injection.** Feed the world-state lines with SillyTavern's raw `setExtensionPrompt`, not `desSetExtensionPrompt` (`src/systems/generation/inspector.js`, which records to the Context Inspector), or add a `noRecord` flag to the DES wrapper. Don't record the advancer's prompt via `recordSeparateTrackerPrompt`. No `toastr` on success or failure; failures go to `addDebugLog` only. | The Doom Counter toasts on every tick; the Inspector shows every prompt. |
| G5 | **`/advance` slash command:** new code. `SlashCommandParser.addCommandObject(SlashCommand.fromProps({ name:'advance', callback, helpString }))`. The import path is proven in `src/systems/features/avatarGenerator.js`. | No slash commands exist anywhere in DES. |

## 1. World pack (architecture rule)

One data file per world, e.g. `worldpacks/skyreach.json`. It holds:
- the **place tree** (id, parent, label, node position, optional image, zoom level);
- the **starting clocks** (id, label, start value, max, public-effect text per step);
- the **character list** (name, portrait source, starting place, which tier they begin at);
- the narrator-facing **injection template**.

**No Skyreach detail goes in engine code.** A new chat with an active pack copies the starting clocks and locations into `dooms_world` (the seeding step). If seeding fails, log it and show it on the dashboard; never run the advancer on empty state.

## Part B — Per-chat world state *(build first)*

`chat_metadata.dooms_world`:

```
{ pack: "skyreach",
  clocks:   { varrow_war: 2, highwatch: 1, … },        // overwrite-only
  where:    { "One Feather": "gilead/low-market/gilded-hand/high-table", … }, // last seen, deepest place
  known:    { "One Feather": "known", "Maeve": "heard" },
  log:      [ {who, from, to, msgId, gameDate, gameTime, reason?} … ],   // ring buffer
  last:     { msgId, gameDate, gameTime, ranAt, ok },   // last successful advance
  blurb:    "…",
  counted:  [msgIds…], sinceLast: n, retryNext: false }
```

- **Injected every turn (G4):** the clock lines and the `where` lines only, in compact form: one short line per clock, one per *known* character. This is the anti-bloat rule: fixed size, overwritten, never appended.
- **Never injected:** `known`, `log`, `blurb`, `counted`.
- **Movement log:** ring buffer of about 20 per character and about 300 total; the oldest drop off. It is framed as **"last seen at X, <date>"**, so it only records places a character was actually observed and never reconstructs journeys.
- **Known tiers:**
  - **heard-of**: the first time the name is mentioned. Dimmed, dashboard only, not on the map.
  - **known**: the first time they actually speak (a tagged speaker). Full, on the map.
  - Detected from the chat itself, not by the advancer's guess. Speaker detection can reuse DES's character-thoughts parsing.

## Part A — Plot advancer

> **D70 (2026-10-23):** the advancer is no longer the only source of
> last-seen places. On every reply the tracker's present characters are
> known, and when the tracker's location names a pack place they stand
> there (a move "in the scene" on the reply's id). See `docs/stats-plan.md`.

Clone of the Doom Counter pattern (`src/systems/generation/doomCounter.js`, called from `onMessageReceived` in `src/systems/integration/sillytavern.js` ~l.348/414 behind `isAwaitingNewMessage`). Its output is a state write, not a twist picker.

- **Trigger:** every **N new message IDs** (N configurable), plus `/advance` and a dashboard button. Never while generating (respect `isGenerating`).
- **Time:** the advancer itself judges elapsed in-game time. It compares the tracker's prose `date.value` and `time.start`/`time.end` (from `lastGeneratedData.infoBox || committedTrackerData.infoBox`, which may be a JSON string) against `last.gameDate`/`last.gameTime`. Clock movement scales with elapsed story time, not message count. No separate time module and no tracker day counter for now; revisit only if play shows the model judging badly.
- **Call:** `withBackgroundProfile(() => safeGenerateRaw(...))`. The prompt carries the recent chat window, current `dooms_world` state, the pack's clock definitions, and the two date strings.
- **Reply = strict JSON:** `{ elapsed, clocks:{id:newValue}, moved:[{who,to,reason}], blurb, heard:[names] }`.
- **Validate before writing:**
  - it parses;
  - clock values are integers within 0..max and move by no more than a set step;
  - every `to` exists in the pack's place tree;
  - names are strings.
  - **Any failure: discard the whole reply, set `retryNext=true`, and run again on the next new message** instead of waiting N. On success, reset `sinceLast` and resume normal spacing.
- **Stamp** `last.msgId`/`ranAt` on success so a silent stall is visible on the dashboard ("last advanced at message 40").
- **Spoiler-Free toggle:** when on, the advancer prompt clamps `blurb` to street-level common knowledge (rumours, prices, news; never a clock's value or mechanism). It's enforced in the prompt, not only hidden in the UI. It's off by default, matching the rest of DES.
- **No chat output, ever.**

## Part C — Map

**Superseded by D69 (`docs/stats-plan.md`, 2026-10-23).** The node view
built from this section (C1 the province, C2 nesting and zoom) was taken
down after the owner's review of its look. What stands: a **board** of
tiles, one per place at the level being looked at; the province shows the
root places, stepping inside a place shows the places within it, a trail
leads back out. Each tile: a glyph by depth or the pack's art, how many
places inside, the name, the caption a clock gives it (a clock's optional
`place`), the known characters on it as portrait tokens (initials when
there is no portrait). Heard-of names stay off the board. Reads state
only; no model calls. `src/utils/worldBoard.js` (pure),
`src/systems/ui/worldViews.js` (the HTML), `src/systems/ui/worldDashboard.js`
(the window). C3 (room grids, Silly-Map's pathfinding) is not planned.

## Part D — Overview dashboard

**Superseded by D69.** There is no dashboard. The **Live World window**
(sized like the Workshop; World in the D menu, Settings → Live World,
`/liveworld`) opens on the glance: word on the street (the blurb, each
clock's public effect as a sentence) and the faces last seen (the shelf's
own portrait cards with the place under the name and the date of the last
move); the board sits below it in the same scroll. A card or a token opens
the character's trail in a small popover (their moves newest first, where
the story found them, Show on the board). "Lately" with its time filter
lives under the board's tiles. Advance now sits in the window's foot, the
same path as `/advance`. Spoiler-free governs the effects, the captions,
the feed and the blurb as before.

---

## Build order

1. **G1–G5** groundwork.
2. **World pack** schema and the Skyreach pack (place tree, clocks, cast).
3. **Part B** state and seeding.
4. **Part A** advancer.
5. **D1** dashboard.
6. **C1** province node view.
7. The remaining C and D phases.

## Open items

- Default N.
- Exact max step per clock per run.
- Speaker detection for "known" when DES character tracking is off.
- Seed values for the Skyreach clocks and starting locations: draft them from `SR - Campaign Complete` (the two narrator-only entries) into the pack.

Related: [[CAMPAIGN DESIGN]] · [[SR - Campaign Complete]]
