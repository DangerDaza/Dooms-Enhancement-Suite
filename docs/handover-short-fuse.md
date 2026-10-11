# Handover — Project Short Fuse (Stats), 2026-10-10

For a local Claude Code session picking this up in a clone of
`DangerDaza/Dooms-Enhancement-Suite`, and for Jordan. Everything below is
what the cloud session knew when it stopped. `docs/stats-plan.md` is the
design; `docs/parity-checklist.md` has the in-play checks; this file is the
state and the next moves.

## 1. Standing rules (Jordan's, not negotiable)

- **Branch `Project-Short-Fuse` only.** Never push to any other branch. No
  pull requests. No GitHub comments.
- **Commit as Jordan:** `git -c user.name="DangerDaza" -c user.email="jordan@howewire.com" commit ...`,
  ending the message with the attribution lines your harness supplies.
  No model identifiers anywhere in repo artifacts (commits, comments, docs).
- **No release work until told:** no version bump (manifest is 3.0.1), no
  CHANGELOG, no What's New, no README. When the word comes, the README
  credits also get a courtesy line for Multihog's D&D framework (GPL-3.0;
  its design was read and compared, DES's dice were written from scratch,
  nothing copied, nothing owed; the credit was agreed for the release).
- **Working style:** ask clarifying questions; say the plan before acting;
  one tested commit per step, pushed as you go; when you talk about removing
  something, Jordan likes "𝖆𝖓𝖓𝖎𝖍𝖎𝖑𝖆𝖙𝖊" in that font.
- **Tests run with a timeout** (`timeout 90 node tools/...`). The sandbox
  stubs are proxies; a DOM walk on a proxy once looped forever.

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
   ```
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
- **Voices:** "Never whisper" TTS switch (`neverWhisper`, Google API route).
- **Tracker recovery** (§3).

## 5. Map of the code

| File | What it holds |
| --- | --- |
| `src/utils/d20.js` | Pure dice model: attributes, skills, proficiency, roll math, verdicts, `parseCheckCall`/`resolveCheckCall`, the two AI instructions, the tool definition, config migration |
| `src/systems/features/diceRolls.js` | Lifecycle: pending check, ruling at send, roll, verdict for the next generation (`buildDiceVerdictForGeneration`, `STILL_REQUIRED`), GM calls (`onDiceReplyRendered`), tool action, `rollsForReply`, `diceNotice` |
| `src/systems/generation/injector.js` | `refreshDiceInjection` sets the verdict, rules and reminder slots at the tracker instructions' depth/role (`trackerInjectionTarget`); `onGenerationStarted` |
| `src/systems/generation/trackerRecovery.js` | Pure helpers: `hasTrackerData`, `swipeEntryOf`, `replyLacksTracker`, `lastReply`, `earlierPartsOfTurn`, `adoptBlockFromTurn`, `shouldRecoverTracker`, the recovered mark |
| `src/systems/integration/sillytavern.js` | `onMessageReceived` (together parse, adoption, recovery trigger), `recoverTrackerForReply`, `onMessageSent`, `onGenerationEnded` (empty) |
| `src/systems/generation/apiClient.js` | `updateRPGData(renderInfoBox, renderThoughts, { force, recovery })`: the separate-mode request |
| `src/systems/generation/promptBuilder.js` | `generateSeparateUpdatePrompt` (used by the recovery too), tracker instructions |
| `src/systems/rendering/trackerJsonInline.js` | The 🗂️ Tracker Data dropdown (gated on `showTrackerJsonInChat`, reads swipe data) |
| `src/systems/ui/dicePanel.js`, `attributesPane.js`, `characterWorkshop.js`, `characterRoster.js` | Popover and chip; Workshop sheets and proficiency ticks |
| `src/systems/voices/delivery.js`, `voiceSettings.js`, `voiceEngine.js`, `src/systems/ui/voicesSettingsUI.js` | Never whisper |
| `index.js` | Event wiring (see §6), Settings handlers (`#rpg-attr-*`, `#rpg-toggle-recover-tracker`), `updateGenerationModeUI` |
| `template.html` | Settings rows, incl. Generation → "Fetch the tracker when a reply skips it" and Stats → Attributes & checks |
| `src/core/config.js`, `src/core/state.js` | Defaults (`recoverMissingTracker: true` in both) |
| `tools/*.mjs` | The gate (§2) |

## 6. Facts that cost time to learn

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
- **Sandbox tests** (`tools/load-check.mjs` builds `/tmp/des-load-check`
  with proxy stubs): anything that walks the DOM must guard against
  non-DOM (`typeof el.textContent !== 'string'`). Use `timeout`.

## 7. Decisions on record

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

## 8. When Jordan says "release"

Version bump in `manifest.json` (and wherever else the repo keeps it),
CHANGELOG, What's New, README (Stats section; the Multihog credit line in
the credits), then the parity checklist walked once more. Not before.
