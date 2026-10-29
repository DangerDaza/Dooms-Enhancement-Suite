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
| 4a | Saving throws and opposed actions, 2024 rules: the target saves against DC 8 + the actor's proficiency + modifier; the difficulty guide; verdicts say whose roll it is | Yes (`3c7969c` … `ee08db6`; `docs/stats-plan.md` §10, D15–D17) | `d20-test` §8, `dice-test` §10 | Not yet | Parity rows "Saving throws" and the NPC-verdict row |
| 4b | Tiers and NPC sheets: a five-tier scale on the sheet, Fill by tier, Suggest from the story, automatic suggestion for new characters (off by default), the tier word to the AI | Yes (`bc48864` … `734b0c2`; `docs/stats-plan.md` §11, D18–D21) | `d20-test` §9, `sheet-suggest-test` | Not yet | Parity rows "Tiers" |
| 4c | Casting checks and talents, freeform magic: no spell list, three resolutions (a target saves, the caster makes a casting check, or nothing rolls), the Casting skill on the casting ability, talents on the sheet with Practised and Master | Yes (`7ce9335` … `9dddb03`; `docs/stats-plan.md` §12, D22–D27) | `d20-test` §10, `dice-test` §11 | Not yet | Parity rows "Casting checks" and "Talents" |
| 5 | Inventory and the shelf's pages: a pack and a party pouch per chat, the end-of-reply tag and the `dooms_inventory` tool, swipes and deletions put changes back, Settings → Stats → Inventory, the shelf flipping between Characters, Inventory and Quests | Yes (`0c28e59` … `c59b43b`; `docs/stats-plan.md` §13, D28–D34, D66) | `inventory-test`, `inventory-flow-test` | Not yet | Parity rows "Inventory" |
| 5b | Cut to a quest: right-click or hold a quest box, the next reply is a montage up to the quest and its opening beat with no message of the player's, the quest becomes the main quest, "when…" for a named time | Yes (2026-10-17; `docs/stats-plan.md` §14, D35–D38) | `quest-cut-test`, `quest-cut-flow-test` | Not yet | Parity rows "Cut to a quest" |
| 6 | Live World (`docs/live-world-spec.md`): world packs, per-chat clocks and last-seen places, the background advancer every N replies with its reply validated or discarded, the narrator's one line, `/advance`, `/liveworld`, Settings → Live World, the Map window (the places as pictures, Travel here, the news, rumours, people and completed quests, opened from Map in the D menu; `docs/map-window-plan.md`, which replaced D69's board and tabs, which had replaced the dashboard, the node map and the shelf's Map page of D56), the face popover | Yes for G1–G5, the pack, Part B, Part A, D1–D3, C1, C2 and the shelf's Map page (`6524ad1` … the shelf page; `docs/stats-plan.md` §15, D40–D54). Reviewed 2026-10-18 and verified in a second and a third pass (§15.9). Not C3. | `live-world-test`, `live-world-flow-test`, `world-map-test` | Not yet | Parity rows "Live World"; the Skyreach pack's content; then C3 |
| 4 | Levels | No. Not designed. | — | — | Jordan's decisions first |
| Release | 3.1.0-beta.1 prepared on the branch 2026-10-16: version, CHANGELOG, What's New, Beta badges, Report a problem with both logs (`tools/beta-report-test.mjs`) | Yes, on the branch | `beta-report-test` | Not yet | Jordan's word, then a fast-forward push of main (handover §9); README and the full 3.1.0 after the beta |

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
`tools/voice-logic-test.mjs`. Parity row 158. Voices work has gone on
locally since (Steadiness, anchoring, Audition ×3; `3ee652f` … `18caf70`,
`docs/google-tts-voices-plan.md`); it is not part of Stats.

## Phase 4a — Saving throws and opposed actions (2024 rules)

**Is it ready?** Built, tested, pushed (`3c7969c` design, `31a4a84`
model, `ee08db6` lifecycle). Not yet watched in play. Born of Jordan's
scene: Muzen (Charisma 30) reads Ines Arden's mind, the game master rolled
*her* Wisdom check at Medium, and the verdict's "narrate the attempt
succeeding" read as *his* success.

**What exists.** The one acted upon makes a saving throw: d20 + modifier,
+ the proficiency bonus when the Save tick is set for that attribute on
the Workshop sheet. The DC is the actor's: 8 + proficiency bonus + their
modifier in the ability the game master names (Muzen's Charisma 30 sets
DC 20), or a difficulty word when the world is the source. Three ways in:
the ruling call on a tagged check may answer with the target's save; a
`[SAVE: Ines Arden: Charisma | vs Muzen's Charisma | reason]` line; the
tool with kind "save", against and againstAttribute. A shared difficulty
guide (the task not the character, the five DCs with the odds for +0 and
+5, one step for circumstances, who rolls) rides in the ruling call and
the tool, briefly in the per-turn instructions. Every verdict now ends
with whose roll it is and what success means.

**Prove it.** `timeout 90 node tools/d20-test.mjs` §8 and
`tools/dice-test.mjs` §10 pass; then parity rows "Saving throws" (the
ruling, the tags, the tool, the Save tick) and the NPC-verdict row.

**Found in play (first sitting).** The game master named Muzen's Wisdom
for a telepathic push and the DC came out of Wisdom 11. Fixed by the
casting ability: the Casting chip on INT, WIS and CHA in the Workshop
(one per sheet, stored as `cha:casting`); the DC for anything that
character's power does comes from it, whatever ability the game master
names, unless the named one is physical. Tick it on Muzen's Charisma.

**Open.** Whether Claude reaches for the save form unprompted; the brief
guide's cost per turn (about 100 words); Hard at DC 28 in Jordan's own
settings prints as a 0% roll in the guide, which is the point.

## Phase 4b — Tiers and NPC sheets

**Is it ready?** Built, tested, pushed (`bc48864` design, `e079ccf`
model, `734b0c2` lifecycle). Not yet watched in play. Jordan's
ask: NPC stats away from all 10s, on a scale where Legends sit far above
ordinary people.

**What exists.** Five tiers, Ordinary (8–12) to Legend (18–30), each with
a standard array; the tier is one word on the sheet and never caps a
score. Three ways to fill a sheet: Fill by tier in the Workshop (the
array over the current ranking), Suggest from the story (one small call,
nothing kept until Save), and automatic suggestion for a new face on the
shelf behind a switch that is off by default (stored with an
"AI-suggested" badge until the owner touches the sheet). The attributes
line carries the tier word, behind "Send the tier to the AI".

**Prove it.** `timeout 90 node tools/d20-test.mjs` §9 and
`node tools/sheet-suggest-test.mjs` pass; then parity rows "Tiers" (the
Workshop, Suggest from the story, automatic, the AI).

**Open.** Whether the AI's suggestions land in sensible tiers for this
story's cast (Masters as Exceptional, Servants as Legend); the cost of the
automatic switch in a crowded scene (one call per new face, sequential);
no bulk "suggest for everyone" yet.

## Phase 4c — Casting checks and talents (freeform magic)

**Is it ready?** Built, tested, pushed (`7ce9335` design, `4f1e2cd`
model, `9dddb03` lifecycle). Not yet watched in play. Jordan's ask:
spell casting for roleplay that keeps the casting modifier and spell
saves without locking the player into D&D's spell system.

**What exists.** No spell list, slots or levels. Three resolutions: magic
done to someone who can resist is their save against the caster's DC
(Phase 4a); magic against the world is a casting check, "Charisma
(Casting)", the casting ability with proficiency; nothing resisting, no
roll. The game master calls it as `[CHECK: Casting | Hard | …]` or the
tool's attribute Casting; the player picks the Casting chip in the
popover. Talents on the sheet (Practised or Master) say what the magic is
known for and ride to the AI with the numbers: "casting ability Charisma
(save DC 20, casting check +12); talents: Telepathy (Master)". A Master
talent is advantage on the casting check; unlisted magic is unpractised,
never refused. The Workshop shows the DC and the check bonus beside the
Casting chip and has a Talents row under the grid.

**Prove it.** `timeout 90 node tools/d20-test.mjs` §10 and
`timeout 90 node tools/dice-test.mjs` §11 pass; then parity rows "Casting
checks" and "Talents".

**Cost.** Measured 2026-10-11 with Jordan's settings (`docs/stats-plan.md`
§12.9): about 1,900 tokens a turn for everything the stats features add
with tools live, of which the tool schema is 1,100; the tracker block is
about 520 and the chat about 120,000. The one lever is the full guide
duplicated inside the tool schema (about 400).

**Open.** Whether the game master reaches for Casting on its own for
wards and workings rather than a plain Charisma check; whether Master
talents show up as advantage in its calls; the Charisma fallback for an
NPC with no casting ability (D27) may surprise in a story where the
caster is an Intelligence wizard, and the fix is the Casting chip on
their sheet.

## Phase 5 — Inventory and the shelf's pages

**Is it ready?** Built, tested, pushed (`0c28e59` model, `4a44abb` store,
tag and tool, `60b0ab0` settings, `c59b43b` shelf pages, 2026-10-17). Not
yet watched in play. Jordan's ask: an inventory, and the Present
Characters panel flipping to show inventory and quests as boxes, not
cards.

**What exists.** A pack for the persona and one pouch the party shares,
per chat (`chat_metadata.dooms_inventory`), each a row of slots (16 and
8 by default, 1 to 64), one per kind of item, with a count, a note and an
icon DES picks from the name. The AI records what changes hands with a
line at the end of its reply, `[ITEM: +1 iron key (note) | -1 torch |
pouch +3 silver coins]`, or the `dooms_inventory` tool where the API can
call tools; the line becomes a note in the reply, a toast says the same,
a swipe, an edit or a deletion puts the change back (an older change
under a newer one gives up only its share), and a full container turns a
new kind away with the AI told so. Settings → Stats → Inventory (Beta)
holds the switch, the slot counts, Tell the AI what is carried, The AI
may change it (line, tool) and Notify. With the inventory on, the shelf's
header gets Characters | Inventory | Quests: square slots with an editor
by each (name, count, note, icon, move, remove; an empty slot adds) and
quest boxes edited in place. Off by default: the shelf and a default
install's prompt are unchanged.

**Prove it.** `node tools/inventory-test.mjs` and
`timeout 120 node tools/inventory-flow-test.mjs` pass; then parity rows
"Inventory".

**Cost.** Measured 2026-10-17 (`docs/stats-plan.md` §13.4): about
286 tokens a turn without tools and about 608 with them, the tool schema being
most of the difference.

**Open.** Whether the Quests page should show on its own, without the
inventory (D34); whether models keep to "most replies change nothing";
a second tool call in one turn that means to correct the first (today
both apply).

## Phase 5b — Cut to a quest

**Is it ready?** Built, tested, pushed (2026-10-17). Not yet watched in
play. Jordan's ask: right-click a quest, "let's start", and the story
moves to the beginning of the quest with a summary of what happened in
between.

**What exists.** Right-click or hold a quest box on the shelf's Quests
page: Cut to it, Cut to it when…, Make it the main quest, Complete. The
cut arms itself on the chat and asks SillyTavern for a reply with nothing
from the player in the log; the reply gets a one-shot instruction: a
brief montage from now (the tracker's date, time and place) to the
moment the quest begins, then the quest's first scene at its threshold,
the first move left to the player, never the quest itself, and the
tracker block moved to where the cut lands. The quest becomes the main
quest and the old main drops to the optional list. Swipes of the montage
keep the instruction; the player's next message ends it.

**Prove it.** `node tools/quest-cut-test.mjs` and
`timeout 120 node tools/quest-cut-flow-test.mjs` pass; then parity rows
"Cut to a quest".

**Open.** Whether the montage may touch the other quests; the same menu
in the sidebar's Quests panel.

## Phase 6 — Live World

**Is it ready?** The groundwork, the pack, the per-chat state, the
advancer and the D1 dashboard are built, tested and pushed (2026-10-17)
and reviewed (2026-10-18: 38 confirmed findings fixed, `docs/stats-plan.md`
§15.9); the map (the dashboard's Map view: C1 the province, C2 nesting
and zoom), the D2 feed and the D3 timelines and map links followed the
same day, and the map became the shelf's fourth page (D56). C3 (room
grids and tokens from Silly Map) is not built. Not
yet watched in play. Jordan's spec: `docs/live-world-spec.md`.

**What exists.** A world pack (places as a tree, plot clocks with the
public effect of each step, a cast with starting places) seeds a chat's
world under its own key. Every six new replies a quiet background
request on the tracker's connection profile reads the recent scenes and
answers with strict JSON: clocks moved by at most a step, characters
moved to places of the tree, a blurb, heard-of names; anything that
breaks a rule is discarded whole and retried on the next reply. One
fixed-size line tells the narrator each clock's public effect and where
each known character was last seen, at a depth and role of your choice,
not recorded by the Context Inspector. `/advance` runs it now; `/liveworld`
and Settings → Live World → Dashboard open the dashboard: what people
say, who was last seen where, the feed of changes under their dates
with a filter, a timeline per known character, Advance now; its Map view
draws the province (place cards, soft lines along the tree, known
characters as portrait tokens on the deepest place drawn) and opens any
card to what is inside it, with a trail back up; linked both ways with
the cards. The same map is the Present Characters shelf's fourth page,
Map, while Live World is on (D56). One pack ships, Harbourside, the
template; worlds are built in the World Builder (`docs/world-builder-plan.md`,
2026-10-29) and the blank world is the default; the Skyreach draft moved to
`docs/support/skyreach-world.json`. Off by default; nothing changes until it is on.

**Prove it.** `node tools/live-world-test.mjs`, `node tools/world-map-test.mjs`
and `timeout 120 node tools/live-world-flow-test.mjs` pass; then parity
rows "Live World".

**Open.** The Skyreach pack's content (D50); C3 rooms (Silly Map's
code: Jordan's call); whether known should also come from speaker tags;
a rail button for the dashboard.

## Phase 7 — Scene pictures (Moss Studio)

Status: **built** (2026-10-22 to 2026-10-24; D71 nothing reaches the AI,
D72 regenerate under a picture). From 2026-10-28 the picture is rendered
by the image service (Phase 8) and the section is a group on the Image
Generation page. Every N of the player's turns a
background request turns the recent messages into one caption, the owner's
Moss workflow renders it on ComfyUI (through SillyTavern's own endpoints) with
the chat's LoRAs spliced in,
and the picture lands in the chat as a message from the narrator. The
design, the decisions (D60–D65) and the studio's API contract are in
`docs/scene-pictures-plan.md`.

## Phase 8 — Image Generation

Status: **built** (2026-10-28, `docs/image-gen-plan.md`). The owner, after
a phone session drew a portrait for every character through his new Moss
setup, 400 messages in: "I want to take all of DES's image gen and put it in
a new settings page called Image Generation. I want the user to be able to
set up whatever image generation type they want, and I want that to fuel
all image generation in DES." One service (`src/systems/features/imageGen.js`)
with two sources, SillyTavern's extension and ComfyUI direct; portraits under
one rule (Off / Only missing / State changed / Every reply) in every tracker
mode and never from a recovery, with a toast the first time; the page with
the ComfyUI connection, Portraits and Scene pictures as groups; the Auto
Avatars pill, Portrait Source and Auto Portrait Mode gone; a one-time
migration. Tests: `tools/image-gen-test.mjs`, `tools/portrait-flow-test.mjs`.

## Phase 9 — The Map window

Status: **built** (2026-10-28, `docs/map-window-plan.md`). The owner's
sketch, "a replacement of the live world": the world's name across the
top; the places the story has visited as a row of circles, the most recent
on the left, each the place's picture (drawn through Image Generation on
request, or as a place is first reached with a switch), scrollable;
Travel here on a place, a cut like the quest cut (the road as a montage,
then the arrival); a bottom panel that swaps between News, Rumours,
People and Completed quests (recorded when the shelf's ✓ completes a
quest). The board of tiles and the three tabs are gone. Tests:
`tools/world-map-test.mjs`, `tools/map-flow-test.mjs`.

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
