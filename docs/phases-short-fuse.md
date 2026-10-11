# Project Short Fuse — the phases, 2026-10-11

What each phase of the Stats work is, what of it exists on
`Project-Short-Fuse`, how to prove it, and what is left. Written for a local
Claude Code session and for Jordan. The design lives in `docs/stats-plan.md`
(§1–6 Phase 1, §7 Phase 2, §8 Phase 3), the in-play checks in
`docs/parity-checklist.md`, the state and the immediate moves in
`docs/handover-short-fuse.md`. This file does not repeat the design; it
says where things stand.

## At a glance

| Phase | What | Built | Automated tests | Seen working in play | Left to do |
| --- | --- | --- | --- | --- | --- |
| 1 | Vitals: 0–100 bars the AI updates, NPCs and the persona | Yes (`d6acc87` … `137423c`) | `vitals-test`, `tracker-prompt-test` | Not yet | Parity rows "Vitals" |
| 2 | Attributes and player-triggered dice | Yes, reshaped after Jordan's first try (D12) (`5a9f8ce` … `7763b79`) | `d20-test`, `dice-test` | Partly: Jordan rolled checks; one bug found and fixed (the failed check narrated as a success) | Parity rows "Attributes and dice" (non-GM rows) |
| 3 | The game master's own calls: end-of-reply line and the dice tool, NPCs too | Yes (`807ce54` … `19d0d57`) | `d20-test` §7, `dice-test` §8–9 | Not yet: the export showed tool calls happening (`toolu_` ids, a Constitution check on Silvy) but the tracker froze after them | Parity rows "Game master's calls" and "Notify"; then the verdict on frequency |
| 3.5 | Keeping the tracker alive after dice (reminder, recovery, tool split) | Yes (`f35507d`, `3c18e89`) | `tracker-recovery-test` | Not yet | Handover §2 step 3 |
| Side | Voices: Never whisper | Yes (`789e136`, `4df16d3`) | `voice-logic-test` | Not yet | Parity row 158 |
| 4 | Contested rolls, levels, saving throws, AI-suggested NPC sheets | No. Not designed. | — | — | Jordan's decisions first |
| Release | 3.1.0: version, CHANGELOG, What's New, README | No, on hold by Jordan's word | — | — | Only when told |

"Not yet" means the cloud session could not run SillyTavern; every row
below is an in-browser check for the local session or Jordan.

## Phase 1 — Vitals

**Goal.** Any character on the Present Characters shelf, the persona
included, carries 0–100 vitals the AI moves each reply. Defined once in
Settings → Stats → Vitals (name, colour, icon, start value, AI-updated or
fixed). Off by default; a default install's tracker prompt is byte-identical
to 3.0.1.

**What exists.**
- Sheet in `trackerConfig.presentCharacters.characterStats.customStats[]`
  (additive fields on the old key), nine defaults, seven on (Health,
  Energy, Satiety, Stamina, Morale, Sanity, Arousal), Hygiene and Mana off.
  Pure model in `src/utils/vitals.js`.
- NPC values ride inside each character's `stats` array; the persona's in a
  new top-level `player` key of the tracker object, stored beside
  `characterThoughts` everywhere (`lastGeneratedData`, committed data, swipe
  data, chat metadata).
- `ai: false` vitals are enforced in code: whatever the AI returns, the
  previous value is written back. Missing vitals are seeded with their
  start value.
- Bars on the portrait cards and the card back under all six looks, click
  to edit on the back. The legacy panel's bars got their missing fill.
- Settings → Stats page on the rail (shared with Phase 2's group).
- History persistence and the context summary carry vitals behind a toggle.

**Changed from the plan.** The shelf reaches the editors in `thoughts.js`
through a dynamic import (a static edge closed a cycle through
`characterAliases.js`).

**Decisions.** D1 nine vitals, seven on; D2 "Stats" page, "Vitals" group;
D3 persona included, on by default when vitals are on; D4 no release yet.

**Prove it.** `timeout 90 node tools/vitals-test.mjs` and
`timeout 90 node tools/tracker-prompt-test.mjs`; then parity rows 18–27
(off: prompt identical, no strips; on: bars at start values, the AI moves
them, a fixed vital holds, click-to-edit survives reload, separate and
external modes seed the persona's block, presets round-trip).

**Open.** A padlock per character on the card back for fixed vitals
(cheap, default no). Per-character starting values in the Workshop
("Phase 1.5 if asked").

## Phase 2 — Attributes and dice (player-triggered)

**Goal.** Every character carries attributes (the D&D six by default, the
list editable, modifier `floor((score − 10) / 2)`). The player declares a
check from DES; the game master (the AI, one small call) rules the
difficulty; DES rolls with real randomness, decides success in code, and
hands the AI a verdict to narrate. Off by default; the default prompt stays
byte-identical.

**How it plays after D12.** Open the popover (d20 button by the wand, the
persona card's menu, or the FAB fly-out) → pick an attribute → pick a skill
under it, a plain check, or "Other skills" (the 5e variant: any skill with
any attribute, proficiency follows the skill) → a line of context → OK
closes it. The chip above the message box reads "STR (Athletics) check ·
rolls when you send". On send: the game master rules (difficulty word,
advantage, reason; 20 s timeout then the default stands; a fixed override
or a GM call skips the ask), the die rolls, the roll is written to the sent
message (`extra.dooms_roll`), the verdict rides the generation, and the
box sits at the top of the reply. Once rolled, final: no re-roll, no
remove; swipes and regenerates reuse the same roll.

**What exists.**
- `src/utils/d20.js`: attributes with skills (5e lists per attribute,
  editable), proficiency bonus (2), sheets keyed `user:Name` / `npc:Name`
  (per name like aliases, carried across campaign versions and persona ↔
  NPC copies) with `_prof` keys `attrId:skill_slug`, `rollCheck` (advantage,
  criticals, margin), `verdictText`, the attributes line, the difficulty
  question for the game master, config and additive migration.
- `src/systems/features/diceRolls.js`: pending check → `onDiceMessageSent`
  (ruling, roll, attach) → `refreshDiceInjection` from MESSAGE_SENT and
  GENERATION_STARTED → `rollsForReply` for the box; `diceNotice` toasts.
- `src/systems/ui/dicePanel.js`: the popover and chip; override row only
  with "Let me change the ruling" on.
- Workshop → Attributes tab (`attributesPane.js`): scores with live
  modifiers, Standard array / Roll 4d6 drop lowest / All 10, a proficiency
  tick per skill. Sheets follow copy, delete and version switches
  (`characterWorkshop.js`, `characterRoster.js`).
- Settings → Stats → Attributes & checks: master toggle, attribute list with
  skills per row, Send scores to the AI (with a roll / always / never), the
  AI sets the difficulty and how many messages it reads (6), default
  difficulty, Let me change the ruling (off), criticals (on), proficiency
  bonus, the five difficulty numbers (Easy, Medium, Hard, Very hard, Nearly
  impossible).
- Prompt: the attributes line only for characters with a non-default sheet,
  sent with a roll (default) or always; the verdict in the dice slot at the
  tracker instructions' depth and role.

**Decisions.** D5 the D&D six, editable; D6 scores to the AI with a roll
only by default; D7 criticals on; D8 roll when sent; D9 NPC attributes in
this phase; D10 AI-suggested NPC sheets later; D11 the AI sets the
difficulty, override off by default; D12 (Jordan, after trying it) pick
only, roll on send, box atop the reply, final once rolled, proficiency
ticks on the sheet, the 5e variant.

**Prove it.** `timeout 90 node tools/d20-test.mjs`,
`timeout 90 node tools/dice-test.mjs`; then parity rows 30–41 (off state,
the three entry points, the Workshop sheet, the popover's skill row and
"Other skills", the chip, the box after send, swipe keeps the roll, the
override row, the AI-rules-or-default path, the Settings list edits, the
six looks, disable mid-session).

**Known from play.** Jordan's first bug report ("I failed the check but
still succeeded") came from the verdict landing after the tracker
instructions; fixed in `f35507d`. Everything else in this phase has been
used but not walked row by row.

## Phase 3 — The game master's own calls

**Is it ready?** Built, tested, pushed. Not yet watched in play. Jordan's
export proved the tool path fires on a chat-completion model with function
calling on (a Constitution check the AI called on Silvy, rolled in code,
answered with the verdict text), and that was also where the tracker froze,
which Phase 3.5 addresses. The end-of-reply line has not been seen in a
real reply yet (the export had no `[CHECK:` lines; that model was given the
tool, so it should not have used the line).

**Jordan's ask.** "I have always wanted that, and it would be both, but I
don't want it to force a dice roll into every scene, only if it's called
for in the story." D13: NPC checks too, on their Workshop sheets. D14: on
by default with attributes, each piece with its own switch.

**Two ways in.**
- **End-of-reply line, any model.** The game master may end a reply with
  `[CHECK: Dexterity (Stealth) | Hard, disadvantage | the lamps are lit]`
  and stop; the line replaces nothing else it must output. For the player
  it becomes the pending check: the chip says the game master called for
  it, × declines, the next send rolls against the ruling already given (no
  second call); the popover shows the call and OK re-tags it under another
  attribute and skill with the difficulty standing. For an NPC
  (`[CHECK: Guard: Wisdom (Perception) | Medium | ...]`) the die rolls the
  moment the reply renders, on the guard's sheet, stored per swipe in
  `extra.dooms_gm_calls`, shown in place of the tag, handed to the next
  generation as a verdict beside the player's. A swipe without the call
  withdraws it; the same call keeps its roll. A reload restores a call
  waiting on the last reply.
- **The `dooms_roll_check` tool, models with tool calling.** Registered with
  SillyTavern's ToolManager (`registerDiceTool`; enums from the sheet;
  `who` only with NPC checks on; `shouldRegister` tied to the switches;
  re-registered when the attribute list changes). The action rolls in code
  on the roller's sheet, modifier and proficiency included, and answers
  with the verdict text plus the "shape of your reply does not change"
  line. The same arguments on the same player message roll once (memo in
  `extra.dooms_tool_rolls`); each roll is also attached to SillyTavern's
  tool-call record, and `rollsForReply` shows it in the reply's box.

Per generation the game master is told about the tool when the tool switch
is on and `isToolCallingSupported()` says yes, else the line, else nothing;
both texts say most replies have none and carry the frequency clause.

**Settings → Stats → Attributes & checks.** The AI may call for checks (on);
as a line at the end of its reply (on); as a dice tool (on); on NPCs too
(on); How often: Sparingly (only when the stakes are real) or Whenever an
attempt could plausibly fail; Notify on dice events (on): a toast and a
console line when the game master calls, rules, when the die lands, when an
NPC check rolls, when the tool rolls; the d20 button pulses while a call
waits.

**What stays the player's.** Nothing the game master calls can be rolled
twice, softened or re-asked. The player may decline (×) or re-tag; the
difficulty stands. Combat, initiative, HP and damage dice are out of scope.

**Prove it.** `d20-test` §7 and `dice-test` §8–9 pass; then parity rows
42–47:
1. End-of-reply, player: a scene with stakes ends with a call shown as "The
   game master calls for a ... check"; the chip reads the call with its DC;
   × declines; sending rolls with no extra request and the box says the
   game master called for it; five calm replies carry no call.
2. NPC: the call is rolled on render on the NPC's sheet and shown in place
   of the tag; swipe behaviour; the next reply narrates it (Context
   Inspector shows "[DICE: Guard, on a check you called for").
3. The tool: it appears in the tool list; a tense moment makes the AI call
   it mid-reply; the reply narrates the result and its box shows the roll;
   swipe keeps the roll; tool switch off falls back to the line.
4. Calls off: no `[CHECKS:` text in the prompt, no tool registered.
5. Notify: toasts with the numbers at each step; off: console only.
6. After any of these, the tracker block still arrives (Phase 3.5).

**The judgement call to make in play.** Frequency. If the game master
calls too often on "Sparingly", the wording in `buildEndOfReplyInstruction`
/ `buildToolCallInstruction` (`d20.js`) and `frequencyClause` is the lever;
no code path forces a roll.

## Phase 3.5 — Keeping the tracker alive after dice

Not in the original plan; forced by play. After a verdict or a tool result
the model wrote the story and skipped the tracker block, so thoughts and
the scene froze and the next replies copied it. Three layers now
(`docs/stats-plan.md` §8.5, handover §3): wording and order of the dice
texts; a reminder for the next generation when the last reply's own text
lacked the block (the first version never fired, since together mode
stores an empty swipe entry for every reply); and a recovery that fetches
the block with the separate-mode request when a fresh reply fails to
parse, behind Settings → Generation → "Fetch the tracker when a reply
skips it" (on, together mode only), with "Refresh Tracker Data" now shown
in together mode. A tool call splits a reply in two; a block in the first
half is adopted for the continuation.

**Prove it.** `node tools/tracker-recovery-test.mjs`; then handover §2
step 3. Decide before release: toast always on, recovery on by default,
reminder for non-dice users too.

## Side quest — Never whisper (Voices)

A switch in Voices (Jordan uses the Google API key route) that bans
whispered delivery: the base style strips whisper directions, cached lines
are told what changes, auditions carry the ban. `src/systems/voices/
delivery.js`, `voiceSettings.js`, `voiceEngine.js`,
`src/systems/ui/voicesSettingsUI.js`, `template.html`;
`tools/voice-logic-test.mjs` (57 checks). Parity row 158.

## Phase 4 — if wanted (not started, not designed)

Candidates named so far, none decided:
- Contested rolls (Stealth against Perception as one opposed roll).
- Levels and a growing proficiency bonus.
- Saving throws.
- AI-suggested NPC sheets on first appearance (D10 "later"; the fork's
  idea, with credit if borrowed).
- Per-chat attribute overrides; campaign-versioned attributes (noted for
  the campaign store list).
- From the fork, later and credited: a per-stat "AI may change" tick (the
  vitals sheet's `ai` flag already covers the global case), a human
  attribute scale.

Before any of it: Jordan picks, then a §10 in `docs/stats-plan.md` with
goals, non-goals, data model, prompt, UI, tests, commits, in that order,
like §7 and §8.

## Release (commit 9), only when Jordan says so

Manifest to 3.1.0, CHANGELOG, What's New, README (a Stats section; the
courtesy credit line for Multihog's D&D framework, GPL-3.0, nothing
copied), then the parity checklist walked once more. Not before.

## One sitting to verify all of it (about 30 minutes in one RP)

1. Pull, reload, run the gate (handover §2).
2. Settings → Stats → Track vitals on: a new NPC's card shows bars; the
   next reply moves them; a fixed vital holds. (Phase 1)
3. Attributes & checks on; Workshop → Attributes on the persona: scores and
   two ticks; Save. Popover → Strength (Athletics) → context → OK → send:
   chip, ruling, box at the top of the reply, the reply honours it. Swipe:
   same box. (Phase 2)
4. Play a tense beat and wait: a `[CHECK:` line or a tool call, the toast,
   the box; an NPC call rolled on render. Five calm replies, no call.
   (Phase 3)
5. After each dice reply: thoughts updated, Tracker Data dropdown present;
   if a reply skipped the block, the recovery toast and the panels fill;
   the next generation's prompt carries the reminder. (Phase 3.5)
6. Voices → Never whisper on: a "she whispered" line plays at full volume.
7. Tick the rows; report anything that failed with a chat export.
