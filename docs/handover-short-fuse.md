# Handover — Project Short Fuse (Stats), 2026-10-10

For a local Claude Code session picking this up in a clone of
`DangerDaza/Dooms-Enhancement-Suite`, and for Jordan. Everything below is
what the cloud session knew when it stopped. The local session is already
live: it pushed five commits on 2026-10-11 (Voices: Steadiness, anchoring,
Audition ×3, docs; and the d20 test importing by file URL for Windows).
None of them touch Stats; this file and the phases write-up were rebased
on top of them. `docs/stats-plan.md` is the
design; `docs/parity-checklist.md` has the in-play checks; this file is the
state and the next moves.

## 1. Standing rules (Jordan's, not negotiable)

- **Branch `Project-Short-Fuse` only.** Never push to any other branch. No
  pull requests. No GitHub comments.
- **Commit as Jordan:** `git -c user.name="DangerDaza" -c user.email="jordan@howewire.com" commit ...`,
  ending the message with the attribution lines your harness supplies.
  No model identifiers anywhere in repo artifacts (commits, comments, docs).
- **The beta is live.** On 2026-10-17, on Jordan's word, main was
  fast-forwarded to `29a6204` (3.1.0-beta.1). From here on, main is what
  users update to; `Project-Short-Fuse` stays the working branch, and any
  further push of main is again only on Jordan's word (§8). README is
  untouched; the full 3.1.0 comes after the beta (§9). When the word comes, the README
  credits also get a courtesy line for Multihog's D&D framework (GPL-3.0;
  its design was read and compared, DES's dice were written from scratch,
  nothing copied, nothing owed; the credit was agreed for the release).
- **Working style:** ask clarifying questions; say the plan before acting;
  one tested commit per step, pushed as you go; when you talk about removing
  something, Jordan likes "𝖆𝖓𝖓𝖎𝖍𝖎𝖑𝖆𝖙𝖊" in that font.
- **Render the UI before pushing it.** Nothing that touches `template.html`,
  `style.css` or `styles/*.css` is pushed unseen: run
  `node tools/settings-layout-test.mjs --shots` (headless Chromium renders
  every settings page under the default look and the five looks, fails a row
  whose label is squeezed or anything wider than the popup, and writes a PNG
  per page and look to the folder it prints), then look at the PNGs of the
  pages touched. The Map window has its own render the same way
  (`node tools/map-window-layout-test.mjs --shots`: a fixture world under
  every look at desktop and phone width; the strip holds its buttons, the
  row shows its names whole, the foot's buttons keep their size); a window
  built in JS gets one before it ships (the World Builder's is
  `node tools/world-builder-layout-test.mjs --shots`: six scenes under every
  look at desktop and phone width). The owner (2026-10-29):
  "this is a very common issue with things you create"; the squeezed Test
  row on the Image Generation page was the last one he had to screenshot.
- **Never leave the installed clone dirty.** The extension folder under
  `SillyTavern/public/scripts/extensions/third-party/` is the working
  clone on Jordan's PC. Uncommitted edits there made a branch switch fail
  on 2026-10-17 (git refuses to overwrite an edited file; SillyTavern
  reports a bare 500). Commit to `Project-Short-Fuse` or `git stash`
  before any switch or update. The settings guard left there as loose
  files (`src/core/settingsGuard.js`, `src/utils/settingsGuard.js`,
  `tools/install-settings-guard.mjs`, `tools/settings-guard-test.mjs`, a
  `.bak` of persistence.js and a `plugins/` folder) is either committed
  properly, test in the gate, or removed. No installer script may edit
  tracked files in place.
- **Tests run with a timeout** (`timeout 90 node tools/...`) on Linux and
  macOS. On Windows `timeout` is a different command: run the plain
  `node tools/...` lines, and kill the run if one hangs. The sandbox stubs
  are proxies; a DOM walk on a proxy once looped forever (guarded since).
- **The sandbox is per process.** `tools/load-check.mjs` and the sandbox
  tests each build their own copy under `$TMPDIR/des-load-check-<pid>`
  (SillyTavern's `public/` inside it, the repo under
  `public/scripts/extensions/third-party/DES`) and remove it on exit, so two
  may run at the same time (two terminals, a CI matrix, an agent running one
  while the gate runs). `DES_SANDBOX=/some/dir` pins the directory and keeps
  it afterwards, for a look inside; the root used is printed as
  `SANDBOX: …`. `tools/sandbox.mjs` is the one place that names it.

## 2. Immediate actions

1. **Pull and reload.**
   ```
   git fetch origin Project-Short-Fuse && git checkout Project-Short-Fuse && git pull
   ```
   Then hard-refresh SillyTavern (the extension loads from the repo folder
   under `scripts/extensions/third-party/`).
2. **Run the gate** (all green at handover):
   ```
   timeout 90 node tools/load-check.mjs
   timeout 90 node tools/dice-test.mjs
   timeout 90 node tools/d20-test.mjs
   timeout 90 node tools/tracker-prompt-test.mjs
   timeout 90 node tools/vitals-test.mjs
   node tools/tracker-recovery-test.mjs
   node tools/voice-logic-test.mjs
   timeout 90 node tools/sheet-suggest-test.mjs
   node tools/inventory-test.mjs
   timeout 120 node tools/inventory-flow-test.mjs
   node tools/quest-cut-test.mjs
   timeout 120 node tools/quest-cut-flow-test.mjs
   node tools/live-world-test.mjs
   node tools/world-map-test.mjs
   timeout 120 node tools/live-world-flow-test.mjs
   ```
   Each sandbox test builds its own sandbox (§1), so these lines may also
   run in parallel.
3. **Verify the tracker fix in play** (the open problem; see §3). In the
   current RP, with Settings → Generation → "Fetch the tracker when a reply
   skips it" on (default) and Settings → Display & Features → "Tracker Data in Chat" on:
   - **Player roll:** open the d20 popover, pick an attribute and skill,
     OK, send. The reply should carry the block (thoughts update, the
     🗂️ Tracker Data dropdown appears under it). If it skips the block, a
     toast "The reply came without its tracker data block. Asking for it
     separately…" should appear and the panels fill in a few seconds later.
   - **Tool call:** on a chat-completion model with function calling on,
     play a tense beat until the AI calls the dice tool. Same expectations
     for the continuation.
   - **The reminder:** after any block-less reply, open the Context
     Inspector on the next generation and look for
     "[Your previous reply left out the tracker data block..." right
     before the tracker instructions. The reply after that should carry
     the block itself.
   - **Refresh Tracker Data** now shows in together mode: pressing it
     re-asks for the last reply's block.
4. **If thoughts still freeze**, export the chat (jsonl) and scan it before
   changing code. The last diagnosis came from an export, not from theory.
   A 15-line scanner (§6) tells you which replies lack swipe data and what
   sits around them.
5. **Tick the parity rows** in `docs/parity-checklist.md` as they pass:
   "Attributes and dice" (lines ~29–47) and the new "Generation & tracking"
   row for the recovery switch.
6. **Try the inventory** (Phase 5, built 2026-10-17, `docs/stats-plan.md`
   §13). Settings → Stats → Inventory on; flip the shelf to Inventory and
   add a torch by hand; then play until something changes hands and watch
   the toast and the line in the reply; swipe it and watch it go back.
   Parity rows "Inventory". Jordan's open call: whether the Quests page
   should show without the inventory (D34). Then right-click a quest and
   Cut to it (§14): parity rows "Cut to a quest".
7. **Try Live World** (Phase 6, built 2026-10-17 from `docs/live-world-spec.md`;
   `docs/stats-plan.md` §15). Settings → Live World on, Example as the pack,
   a new chat; play six replies and watch the System Log and the dashboard
   (/liveworld), its feed and timelines, then its Map view. Parity rows
   "Live World". The Skyreach pack is a draft: its
   places, clocks and cast want the campaign notes (D50).

## 3. The open problem and what was done about it

**Symptom.** In together mode, after dice activity the replies stop carrying
the tracker JSON block, so thoughts, scene tracker and the Tracker Data
dropdown freeze. Jordan's export (`The_Long_Calling`, 2026-10-09) showed it
twice: the reply after a player's roll (#36, after the roll on #35) and the
reply resuming after a dice tool call (#54 is the tool record, #55 the
continuation, no block from #55 to #63). No `[CHECK:` lines anywhere.
"Tracker data in chat" was never broken: the dropdown reads the swipe
data, and a block-less reply has none.

**Root causes found, in order.**
- The verdict was injected as SYSTEM role at depth 0 and landed after the
  USER-role tracker instructions (`doChatInject` splices SYSTEM, USER,
  ASSISTANT per depth; within a role the keys sort alphabetically). The
  model read "narrate" last and narrated only. Fixed in `f35507d`: verdict,
  rules and the reminder ride at the tracker instructions' own depth and
  role, so the instructions come last.
- The reminder never fired: together mode stores a swipe entry for every
  reply, parsed or not, so an empty entry counted as present. Fixed in
  `3c18e89` (reads the entry's content, and the recovery mark).
- After a tool result, the model resumes mid-reply and skips the block.
  Wording now says where the block goes (`19d0d57`), and the recovery
  catches what wording misses (`3c18e89`).

**The three layers now in place** (`docs/stats-plan.md` §8.5):
1. Wording and order (verdict `STILL_REQUIRED` in `diceRolls.js`, the tool
   instruction in `d20.js`, the slots in `injector.refreshDiceInjection`).
2. The reminder slot `dooms-tracker-again` (`injector.lastReplyLackedTracker`
   → `trackerRecovery.lastReply` / `replyLacksTracker`).
3. The recovery: `sillytavern.onMessageReceived` (together branch) →
   `shouldRecoverTracker` → 500 ms → `recoverTrackerForReply(index)` →
   `apiClient.updateRPGData(renderInfoBox, renderThoughts, { force: true, recovery: true })`,
   which is the separate-mode request forced past its mode guard; it
   stores on the reply's swipe and marks `extra.dooms_tracker_recovered[swipe]`.
   A tool call splits a reply in two and only the continuation gets
   MESSAGE_RECEIVED, so `adoptBlockFromTurn` reads a block from the first
   half before any request is made.

**Unverified in play.** Nothing above has been seen working in Jordan's
SillyTavern yet; the cloud session cannot run it. That is step 3 above.

**Things to watch / decisions still open.**
- The recovery toast always shows (not tied to the dice notify switch).
  Jordan asked for visibility while debugging; revisit before release.
- `recoverMissingTracker` defaults to on for everyone in together mode.
  Confirm with Jordan before release.
- The reminder now fires for every together-mode user whose model drops a
  block, dice or not. Deliberate; confirm.
- The recovery uses `extensionSettings.connectionProfile` if one is set
  (the separate-mode "DES Trackers" profile) and restores it after, like
  separate mode. On a text-completion API `generateRaw` gets a messages
  array, the same as separate mode does today.
- Group chats: each block-less reply triggers its own recovery.
- Race: a send within the recovery's flight stores nothing on the user's
  message but does update `lastGeneratedData` (separate mode has the same).
- Phase 4a, saving throws (2026-10-11, `3c7969c` … `ee08db6`,
  `docs/stats-plan.md` §10): the target saves against DC 8 + the actor's
  proficiency bonus + modifier; a Save tick per attribute in the Workshop;
  the difficulty guide in every instruction; verdicts end with whose roll
  it is. Unverified in play: see the phases doc and parity rows "Saving
  throws". Jordan's Hard is DC 28, above Very hard; the guide will say so.
- Phase 4b, tiers and NPC sheets (2026-10-11, `bc48864` onward,
  `docs/stats-plan.md` §11): the five-tier scale on the sheet, Fill by
  tier and Suggest from the story in the Workshop, automatic suggestions
  behind a switch that is off by default, the tier word in the attributes
  line. Unverified in play: parity rows "Tiers". `tools/sheet-suggest-test.mjs`
  joins the gate.
- Phase 4c, casting checks and talents (2026-10-11, `7ce9335` onward,
  `docs/stats-plan.md` §12): freeform magic with no spell list; a target
  saves, or the caster makes a casting check ("Charisma (Casting)", the
  casting ability with proficiency, called as `[CHECK: Casting | …]` or
  the tool's attribute Casting), or nothing rolls; talents on the sheet
  (`talent:<level>:<name>`, Practised or Master) go to the AI with the
  save DC and the check bonus. Unverified in play: parity rows "Casting
  checks" and "Talents". §12.9 has the measured per-turn cost of the stats
  features (about 1,900 tokens with tools live).
- Voices, per-character delivery notes and one key row (2026-10-15):
  the note rides on the character's VoiceRef as `note` (so it follows
  campaign versions, personas, copies and the exported JSON) and replaces
  `voices.deliveryNote` on lines their own voice (or its stand-in) reads
  (`delivery.noteFor`); Workshop → Voice has the box under Current voice;
  Connections shows only the key row for the service picked under "Gemini
  voices via". Unverified in play: the two "Voices →" parity rows above
  "Never whisper".

## 4. What is built (all on the branch, base `origin/main` at `c97bac0`)

The per-phase write-up (goal, what exists, how to prove it, what is left,
Phase 4 candidates, the release list) is `docs/phases-short-fuse.md`.

- **Phase 1, vitals:** config shape, parser `player` key, enforcement of
  fixed vitals, bars on portrait cards, the Stats page on the settings
  rail. `tools/vitals-test.mjs`.
- **Phase 2, attributes and dice (D12 redesign):** `src/utils/d20.js`
  (presets, skills per attribute, proficiency bonus, sheets with `_prof`
  keys `attrId:skill_slug`, `rollCheck`, `verdictText`), the popover
  (`src/systems/ui/dicePanel.js`: attribute → skill → context → OK closes),
  the roll happens on send (`diceRolls.onDiceMessageSent` awaits the game
  master's ruling, 20 s timeout, GM/override ruling skips the call), the
  box at the top of the reply, final once rolled. The 5e variant: any skill
  with any attribute, proficiency follows the skill. Workshop → Attributes
  tab with proficiency ticks; Settings → Stats → Attributes & checks.
- **Phase 3, the game master's calls:** both ways on by default with
  attributes. End-of-reply `[CHECK: Dexterity (Stealth) | Hard | reason]`
  (player: becomes a pending check; NPC: rolled on render, stored per swipe
  in `extra.dooms_gm_calls`) and the `dooms_roll_check` function tool
  (`registerDiceTool`, memo on the last user message
  `extra.dooms_tool_rolls`, `rollsForReply` reads tool invocations).
  Frequency clause ("only if the story calls for it"), notify toasts and
  console lines for every dice event (`diceNotice`).
- **Phase 5, inventory (2026-10-17):** `src/utils/inventory.js` (the
  model: a pack and a party pouch, stacks with a count, a note and an
  icon, the `[ITEM: ...]` grammar, the `dooms_inventory` tool definition,
  the prompt texts), `src/systems/features/inventory.js` (per-chat store
  under `chat_metadata.dooms_inventory`, the tag applied once per swipe
  with what it changed kept on the message itself, swipes, edits and
  deletions put it back, tool outcomes claimed by the reply, the two
  prompt slots), Settings → Stats → Inventory, and the shelf's pages
  (`src/systems/ui/shelfPages.js`, lazy): Characters | Inventory | Quests.
  `tools/inventory-test.mjs`, `tools/inventory-flow-test.mjs`.
- **Phase 6, Live World (2026-10-17):** `src/utils/liveWorld.js` (packs,
  per-chat state, the advancer's prompt, validation and apply, the
  narrator's line), `src/systems/features/liveWorld.js` (the store under
  `chat_metadata.dooms_world`, counting by a stamped id, the advancer
  through `withBackgroundProfile`, blind injection, `/advance`, `/liveworld`),
  `src/systems/ui/worldDashboard.js` (lazy; D1, the D2 feed, D3 timelines
  and map links) with its Map view (`src/systems/ui/worldMap.js` over the
  pure `src/utils/worldMap.js`, C1 and C2), the same map as the shelf's
  fourth page Map (D56, `src/systems/ui/shelfPages.js`), Settings → Live
  World, two packs in `worldpacks/`.
  `tools/live-world-test.mjs`, `tools/world-map-test.mjs`,
  `tools/live-world-flow-test.mjs`. Reviewed 2026-10-18 and verified in
  two further passes (`docs/stats-plan.md` §15.9).
- **The World Builder (2026-10-29, `docs/world-builder-plan.md` D92–D99):**
  worlds are the user's. `src/utils/worldBuilder.js` (pure: a world from a
  chat's play, the draft's prompt and its reading, warnings, the file),
  the blank world and the loc: places in `src/utils/liveWorld.js`, the
  worlds API in `src/systems/features/liveWorld.js` (`listWorlds`,
  `saveWorld`, `deleteWorld`, `copyWorld`, `importWorldJson`,
  `worldFromThisChat`, `adoptWorld`, `draftWorldFromChat`,
  `getMissingWorld`), the window `src/systems/ui/worldBuilderViews.js`
  (pure) and `worldBuilder.js` (lazy), Settings → Live World's rows and the
  Map window's foot. Harbourside is the one shipped pack; Skyreach moved to
  `docs/support/skyreach-world.json`. `tools/world-builder-test.mjs`,
  `tools/live-world-flow-test.mjs` §11, `tools/world-builder-layout-test.mjs`.
- **Voices:** "Never whisper" TTS switch (`neverWhisper`, Google API route).
- **Tracker recovery** (§3).
- **Image Generation** (`docs/image-gen-plan.md`, 2026-10-28): one image service with two sources (SillyTavern's extension, ComfyUI direct); portraits under one rule on Settings → Image Generation, never from a recovery; scene pictures render through it and their section is a group on that page; the Auto Avatars pill, Portrait Source and Auto Portrait Mode are gone, migrated once. The player's card draws too (D91, 2026-10-29): Regenerate and Restore on the YOU card, the Workshop's Portrait section in user mode, everything on the user card's own entry (`appearance`, `loras`, `portraitHistory`, `avatar`/`avatarFullRes`); the history helpers in `src/utils/avatars.js` take `{ isUser }`.
- **The Map window** (`docs/map-window-plan.md`, 2026-10-28): Live World's window replaced by the owner's sketch: the places the story has visited as a row of circles with pictures (drawn through Image Generation), Travel here as a cut, a bottom panel of News / Rumours / People / Completed quests. The board of tiles is gone. Map sits in the D menu whatever Live World's switch says (2026-10-29), and Roll a check left that menu the same day (the player's card menu and the chip keep it).

## 5. Map of the code

| File | What it holds |
| --- | --- |
| `src/utils/d20.js` | Pure dice model: attributes, skills, proficiency, roll math, verdicts, `parseCheckCall`/`resolveCheckCall`, the two AI instructions, the tool definition, config migration |
| `src/systems/features/diceRolls.js` | Lifecycle: pending check, ruling at send, roll, verdict for the next generation (`buildDiceVerdictForGeneration`, `STILL_REQUIRED`), GM calls (`onDiceReplyRendered`), tool action, `rollsForReply`, `diceNotice` |
| `src/systems/generation/injector.js` | `refreshDiceInjection` sets the verdict, rules and reminder slots, and the two inventory slots, at the tracker instructions' depth/role (`trackerInjectionTarget`); `onGenerationStarted` |
| `src/utils/inventory.js` | Pure inventory model: the rules, stacks and icons, `applyChanges`/`revertApplied` (share-only), `setStack`/`moveStack`, `parseItemTags`, the tool definition, `buildInventoryLine` and the two instructions |
| `src/systems/features/inventory.js` | Inventory lifecycle: the per-chat store, `onInventoryReplyRendered` (tag once per swipe, put back on swipe/edit), `inventoryToolAction` and the claim by the next reply, `onInventoryMessageDeleted` (ledger), the prompt slot builders, hand edits, `inventoryNotice` |
| `src/systems/ui/shelfPages.js`, `portraitBar.js` | The shelf's Inventory and Quests pages (lazy), the quest menu (Cut to it), and the page control in the header (`syncShelfPages`, `setShelfPage`) |
| `src/utils/liveWorld.js`, `src/systems/features/liveWorld.js`, `src/systems/ui/worldDashboard.js`, `src/utils/worldMap.js`, `src/systems/ui/worldMap.js` | Live World: the pack and the per-chat state, `buildAdvancePrompt`/`validateAdvance`/`applyAdvance`, `buildWorldLines`, `reconcileWithChat`; the store, counting, `advanceNow` (load token, waits), `onWorldGenerationStarted` (raw slot, the regenerate's id), `/advance` and `/liveworld`; the dashboard and its Map view (`buildProvinceView`) |
| `src/systems/generation/apiClient.js` | `withBackgroundProfile(fn, { external })`: the generating flag and the tracker's connection profile around any background request; `updateRPGData` runs through it |
| `src/utils/questCut.js`, `src/systems/features/questCut.js` | Cut to a quest: the quest list after a cut, the facts of now, the instruction; the armed cut in `chat_metadata.dooms_quest_cut`, `/trigger`, the `dooms-quest-cut` slot, the clear on MESSAGE_SENT |
| `src/systems/generation/trackerRecovery.js` | Pure helpers: `hasTrackerData`, `swipeEntryOf`, `replyLacksTracker`, `lastReply`, `earlierPartsOfTurn`, `adoptBlockFromTurn`, `shouldRecoverTracker`, the recovered mark |
| `src/systems/integration/sillytavern.js` | `onMessageReceived` (together parse, adoption, recovery trigger), `recoverTrackerForReply`, `onMessageSent`, `onGenerationEnded` (empty) |
| `src/systems/generation/apiClient.js` | `updateRPGData(renderInfoBox, renderThoughts, { force, recovery })`: the separate-mode request |
| `src/systems/generation/promptBuilder.js` | `generateSeparateUpdatePrompt` (used by the recovery too), tracker instructions |
| `src/utils/imageGen.js`, `src/utils/comfy.js` | Pure: the image config (`imageGenConfig`, sources, sizes, portrait modes), `migrateImageGenSettings`, the portrait rule (`portraitPlan`, `portraitStateHash`), `renderValues`, `slashSafe`, `describeSource`; the ComfyUI helpers (placeholders, `fillWorkflow`, `injectLoras`, the generate body, progress words, `readComfyResult`) |
| `src/systems/features/imageGen.js` | The image service: `renderImage({ purpose, prompt, negative, size, loras })` on the chosen source (`/sd` quiet, or `/api/sd/comfy/*` with the WebSocket progress), `testSource`, `sourceProblem`, `sourceStatus`, the workflow store |
| `src/systems/features/avatarGenerator.js` | Portraits: `generateAutoPortraitsForCharacters(entries, text, onStarted, { fresh, recovery })` under `portraitPlan`, the record behind a DES-made portrait, `regenerateAvatar` / `generateAvatarWithPrompt` (the Workshop, the card menu), all through `renderImage` |
| `src/systems/features/scenePictures.js` | Scene pictures: the cadence, the caption, `renderImage({ purpose: 'scene' })`, the narrator message (hidden from the prompt), the take-down before a regenerate |
| `src/utils/worldMap.js`, `src/utils/worldBoard.js` | The Map window's pure model: `placeKeyFor`, `visitPlace`, `reconcileVisited`, `placesRow`, `rowIdForCharacter`, `buildPlacePrompt`, `buildTravelInstruction`, the completed quests; the faces last seen, a safe image URL |
| `src/systems/features/liveWorld.js` (places) | The visit recorded in `placeFromScene`, the rewind's `reconcileVisited`, `drawPlace` / `getPlacesRow` / `isDrawingPlace`, the automatic draw after a fresh reply (never a recovery) |
| `src/systems/features/questCut.js` (travel, done) | `startTravelCut`, the instruction by kind, `recordCompletedQuest` / `getCompletedQuests` |
| `src/utils/worldBuilder.js`, `src/systems/features/liveWorld.js` (worlds), `src/systems/ui/worldBuilderViews.js`, `src/systems/ui/worldBuilder.js` | The World Builder: `worldFromState` / `rebindStateToPack` (a chat kept as a world, carried over), `buildWorldDraftPrompt` / `parseWorldDraft`, `packWarnings`, `worldToRaw` / `worldToJson`; the worlds API and the blank world's name and the missing-world fallback in the feature; `builderHtml` and the window's events (a keystroke updates the status, leaving a field redraws, auto ids from labels) |
| `src/systems/ui/worldViews.js`, `worldDashboard.js`, `worldFace.js` | The Map window: `mapWindowHtml` (the head, the row, the strip, the panel), the window's events (scroll, selection, Travel here, Draw, the panel buttons), the face popover with Show the place |
| `src/systems/rendering/trackerJsonInline.js` | The 🗂️ Tracker Data dropdown (gated on `showTrackerJsonInChat`, reads swipe data) |
| `src/systems/ui/dicePanel.js`, `attributesPane.js`, `characterWorkshop.js`, `characterRoster.js` | Popover and chip; Workshop sheets and proficiency ticks |
| `src/systems/voices/delivery.js`, `voiceSettings.js`, `voiceEngine.js`, `src/systems/ui/voicesSettingsUI.js` | Never whisper |
| `index.js` | Event wiring (see §6), Settings handlers (`#rpg-attr-*`, `#rpg-toggle-recover-tracker`), `updateGenerationModeUI` |
| `template.html` | Settings rows, incl. Generation → "Fetch the tracker when a reply skips it", Stats → Attributes & checks and Stats → Inventory |
| `src/core/config.js`, `src/core/state.js` | Defaults (`recoverMissingTracker: true` in both) |
| `tools/*.mjs` | The gate (§2) |

## 6. Facts that cost time to learn

- **Jordan's tracker instructions are a custom override.** Settings →
  Prompts → Tracker Instructions holds his own text (the verbose default
  plus a "TRACKER DISCIPLINE (2026-08-08)" block), stored as
  `customTrackerInstructionsPrompt`. `buildTrackerPromptBlock` sends it
  verbatim, so a change to DES's generated wording (compact or verbose)
  never reaches his prompt until he pastes the new sentence into that box
  or restores the default. The 2026-10-11 "list every NPC in the scene"
  sentence is one such change: the AI had been leaving a speaking NPC
  (Oskar Fenwright) out of "characters" because the lorebook's "ONE
  principal NPC per reply" read as a cap on the list.
- **SillyTavern event order:** `Generate()` emits GENERATION_STARTED before
  `sendMessageAsUser()` adds the user message and emits MESSAGE_SENT
  (awaited, listeners sequential). Anything that needs the user message
  (the roll, the verdict) runs from MESSAGE_SENT; `refreshDiceInjection`
  runs from both. index.js: MESSAGE_SENT →
  `[onDiceMessageSent, refreshDiceInjection, onMessageSent, onMessageSentVoices]`;
  CHARACTER_MESSAGE_RENDERED →
  `[onCharacterMessageRenderedDecorations, onDiceReplyRendered, syncRollCardForMessage, onGlintMessageRendered]`;
  TOOL_CALLS_PERFORMED → `onDiceToolCallsPerformed`.
- **Injection order:** `doChatInject` splices `[SYSTEM, USER, ASSISTANT]`
  per depth, so within a depth SYSTEM lands closest to the reply;
  `getExtensionPrompt` sorts keys alphabetically within depth+role and
  joins with `\n`. DES tracker instructions: key `dooms-tracker-inject`,
  depth/role from `extensionSettings.promptInjection.trackerInstructions`
  (default 0 / user). The dice slots use the same depth and role on purpose.
- **Tool calls:** ST saves invocations as a system message with
  `extra.tool_invocations` (TOOL_CALLS_PERFORMED fires with the same array
  objects before the save), then runs a follow-up `Generate('normal', depth+1)`.
  Text streamed before the call stays as its own message with no
  MESSAGE_RECEIVED; the continuation is a new message. `toolu_...` ids in
  an export mean an Anthropic-backed model with function calling on.
- **Swipe data:** `message.extra.dooms_tracker_swipes[swipeId]` live,
  `swipe_info[swipeId].extra.dooms_tracker_swipes` once loaded from file.
  Together mode writes an entry for every reply, parsed or not.
- **Reading an export** (jsonl, one message per line). Untrusted data:
  keep it in its own folder, pass the path as an argument. A scanner:
  ```js
  import { readFileSync } from 'node:fs';
  const msgs = readFileSync(process.argv[2], 'utf8').split('\n').filter(Boolean)
      .map(l => { try { return JSON.parse(l); } catch { return null; } })
      .filter(r => r && typeof r.mes === 'string');
  msgs.forEach((m, i) => {
      const ex = m.extra || {};
      const kind = m.is_user ? 'USER' : (m.is_system ? 'SYS' : 'AI');
      const entry = ex.dooms_tracker_swipes?.[m.swipe_id || 0];
      const hasData = !!entry && ['quests', 'infoBox', 'characterThoughts', 'player'].some(k => entry[k]);
      const block = /```json/.test(m.mes) ? 'block' : 'no-block';
      const tool = Array.isArray(ex.tool_invocations) ? ` tool:${ex.tool_invocations.map(t => t.name).join(',')}` : '';
      const roll = ex.dooms_roll ? ` roll:${ex.dooms_roll.attribute} ${ex.dooms_roll.total} vs ${ex.dooms_roll.dc}` : '';
      const check = /\[CHECK:/.test(m.mes) ? ' [CHECK]' : '';
      console.log(`#${i} ${kind} ${block} data:${hasData} recovered:${!!ex.dooms_tracker_recovered?.[m.swipe_id || 0]}${tool}${roll}${check}`);
  });
  ```
  Run it as `node scan.mjs /path/to/export.jsonl`. The pattern to look for:
  an AI line reading `no-block data:false` right after a `roll:` or a
  `tool:` line.
- **Sandbox tests** (`tools/load-check.mjs` builds `$TMPDIR/des-load-check-<pid>/public`,
  or `$DES_SANDBOX/public`, with proxy stubs; `tools/sandbox.mjs` names it): anything
  that walks the DOM must guard against non-DOM
  (`typeof el.textContent !== 'string'`). Use `timeout`.

## 7. Decisions on record

- **The Settings window (2026-10-30):** redrawn as a settings screen in the
  rail layout: a labelled list of the sections down the left, one page at a
  time with its name as the title and its state badge beside it, the rows
  before the first heading as the page's lead panel, every heading's rows as a
  label beside a panel (settingsRail.js wraps them on open and unwraps for
  the strip). The sub-menu strip is gone on purpose: a switch and its options
  stay on one page. Tokens derive from the theme's five colours in
  styles/modals.css ("SETTINGS WINDOW"); the setups add their own rules at
  the end of styles/overhaul.css. Type follows SillyTavern's font size and a
  narrow page stacks its groups (a container query in em). To render it with
  the real rail script, serve the repo over http beside SillyTavern's
  public/ and inline settingsRail.js with its two imports stubbed; file://
  blocks module imports and the fonts.
- **D12 (Jordan):** the popover is for picking only; the roll happens on
  send; the box sits at the top of the reply; once rolled it is final (no
  Roll now, no Keep/Discard after the roll, no remove button). Skills with
  proficiency ticks on the Workshop sheet, +2 default. The 5e variant: any
  skill with any attribute, proficiency follows the skill.
- **D13/D14 (Jordan):** the AI may call for checks both ways (end-of-reply
  line and function tool), on NPCs too, on by default with attributes, but
  "I dont want it to force a dice roll into every scene, only if its called
  for in the story".
- Debug notifications (toasts and console lines) for every dice event.
- Never whisper: a switch, Google API route.
- Tracker recovery: on by default, together mode only, toast always (see
  §3 for what to confirm before release).
- **D28–D34 (Jordan, 2026-10-17), the inventory:** the persona's pack plus
  one shared party pouch, no NPC inventories; the AI changes it by an
  end-of-reply tag or the `dooms_inventory` tool, never through tracker
  JSON; an item is a name, a count and a note with an icon DES picks and
  the player can change; a set number of slots per container; the shelf
  flips between Characters, Inventory and Quests as boxes, not cards. The
  defaults taken without him (say if wrong): 16 pack and 8 pouch slots; the
  line goes to the AI whenever the inventory is on; both change ways on;
  the page control shows only while the inventory is on, so the Quests page
  rides with it. `docs/stats-plan.md` §13.
- **D35–D38 (Jordan, 2026-10-17), cut to a quest:** the button press alone
  (nothing of the player's in the chat); the reply is the montage and the
  opening beat; the quest becomes the main quest and the old main drops to
  optional; the AI judges the time, "when…" for a named one.
  `docs/stats-plan.md` §14.
- **D39 (Jordan, 2026-10-17):** DES is not intended for group chats.
  Nothing is built or tested for them; a review finding about group
  `/trigger` behaviour was closed on that ground.
- **D40–D50 (defaults taken, 2026-10-17), Live World:** every 6 replies;
  step 1; known = present in the tracker; the line at depth 2 as system,
  raw (not in the Inspector); message identity by a stamped id; built-in
  packs in the repo, pasted ones in settings, a chat keeps its first pack;
  the advancer on the tracker's profile through `withBackgroundProfile`;
  no time module; the dashboard from Settings and `/liveworld`; no toasts;
  Skyreach is a draft. `docs/stats-plan.md` §15.
- **D56 (Jordan, 2026-10-18):** the map is the Present Characters shelf's
  fourth button, Map, beside Characters, Inventory and Quests, shown while
  Live World is on; the dashboard stays as it is.

## 8. The beta (prepared 2026-10-16, pushed to main 2026-10-17 as `29a6204`)

Jordan's call: ship the branch to main as `3.1.0-beta.1` with a visible
BETA tag, so his users become the play-testers. Decided: recovery, the
block reminder and the "list every NPC" sentence ship to everyone as they
are; the wrapper is badges plus Report a problem; the writing is a What's
New entry and a CHANGELOG entry; README waits.

What is on the branch: `.rpg-beta-badge` (styles/modals.css) on the Stats
page title, Vitals, Attributes & checks, Workshop → Attributes and the
dice popover; the report row at the top of the Stats page with
`#rpg-stats-report` (index.js) → `src/systems/features/betaReport.js`
(lazy) → `src/utils/betaReport.js` (pure, `tools/beta-report-test.mjs`),
which reads `getNotificationLogText()` and `getSystemLogText()`, saves
the full report as `des-beta-report-<stamp>.txt` on every press (the one
channel that carries a whole log; the body and the toast name the file),
copies it to the clipboard as well, and opens
`.github/ISSUE_TEMPLATE/stats-beta.yml` prefilled through URL fields
`title`, `environment`, `logs`. GitHub refuses a URL past about 8,150
characters (measured 2026-10-17: 8,150 accepted, 8,208 refused with 414),
so the budget is 8,000 and the logs field carries a condensed tail: stack
traces folded to one line, the tail opening on a whole entry, the System
Log taking two thirds of the room or all of it when there are no
notifications. Log text grows about 1.5× when encoded; the builder
measures the real ratio and fills the budget.
GitHub reads issue forms from the default branch only, so until the
beta is on main the button finds no form: it asks the GitHub API once
per session whether `.github/ISSUE_TEMPLATE/stats-beta.yml` is on the
default branch and, when it is not, puts the same report into the issue
body as Markdown sections (`buildIssueBody`). After the merge the form
is used. Order matters: the file is saved and the clipboard written while
the SillyTavern tab still has focus (a clipboard write is refused once
another tab takes it), and the issue opens last, inside the click's
activation window; the form check runs alongside the gathering with a
2.5 s timeout.

**When Jordan says push:** main is linear and the branch grew from its
head, so it is a fast-forward:
```
git fetch origin main Project-Short-Fuse
git merge-base --is-ancestor origin/main origin/Project-Short-Fuse && echo fast-forward-ok
git push origin Project-Short-Fuse:main
```
If `main` has moved, merge it into the branch first and run the gate.
After the push, GitHub shows the issue form under New issue; test Report
a problem once from a live install before telling anyone.

## 9. When Jordan says "release" (the full 3.1.0, after the beta)

Version bump in `manifest.json` (and wherever else the repo keeps it),
CHANGELOG (the Unreleased entry for the inventory moves under the
version), What's New (an Inventory item), README (Stats section; the
Multihog credit line in the credits), then the parity checklist walked
once more. Not before.
