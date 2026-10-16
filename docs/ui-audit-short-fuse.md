# Button and menu audit — the Stats beta, 2026-10-16

Jordan's two questions: does every button in this update earn its place,
and does each page flow, with a feature's switch next to its options
rather than at the other end of the page? This covers every surface the
branch adds or reshapes: Settings → Stats, Settings → Generation (the
together-mode rows), Settings → Voices, Workshop → Attributes, Workshop →
Voice, the dice popover and chip, and the three ways into "Roll a check".
Verdicts: **keep**, **move**, **fold**, **rename**, **dim** (grey out
when its master is off), or 𝖆𝖓𝖓𝖎𝖍𝖎𝖑𝖆𝖙𝖊. Nothing here is applied yet.

## The short version

Every button has a job. None is a duplicate without a reason, and the
redundancies that exist (three ways to open the popover, Audition ×3 in
three places) are deliberate: each lives where the user is when they need
it. The flow problems are real and there are six, four of them the exact
shape Jordan described:

| # | Where | Problem | Fix | Size |
| --- | --- | --- | --- | --- |
| 1 | Settings → Stats | "Cards and context" is a top-level group between Vitals and Attributes & checks. In the rail layout it is its own tab, so Track vitals is on one tab and four of its options on another. | Fold it into Vitals as a plain divider (not a tab). | small |
| 2 | Settings → Stats → Attributes & checks | 22 rows after the master, in an order that mixes concerns: the proficiency bonus and the five DCs that everything depends on sit last; "Send the tier" is nine rows away from "Send scores"; the NPC-sheet switch sits between Notify and Proficiency. | Regroup into five plain dividers: Sheet, Rolls, The game master, What the AI is told, NPC sheets; Notify last. | medium |
| 3 | Settings → Stats, both groups | With Track vitals or Attributes off, every row under it stays live. Flipping "The AI may call for checks" with attributes off does nothing and says nothing. Only the four calls sub-rows dim today. | Dim every row under a master when it is off, the way the calls sub-rows and Voices' Steadiness already do. | small |
| 4 | Workshop → Attributes | Two "fill the whole sheet" toolbars at opposite ends: Tier, Fill by tier and Suggest from the story above the grid; Standard array, Roll 4d6 and All 10 below the grid and below Talents. | One toolbar above the grid. Talents become the last block. | small |
| 5 | Dice popover | When the game master has called for a check, the line that says so ("🎲 The game master calls for a DEX (Stealth) check · Hard") sits below the context box and the how-it-works hint, after the chips it explains. | Put the pending-call line first. | small |
| 6 | Settings → Generation | Connection Profile, which the separate request and now the together-mode recovery both use, sits four unrelated rows below the recovery switch and Refresh Tracker Data. | Move Connection Profile up to sit under Refresh Tracker Data. | small |

Plus three wording fixes (section 4) and one naming question for the
beta row (section 5). Everything is a template or markup reorder; no
behaviour changes, no settings keys move.

## 1. Settings → Stats

Rail tabs today: **General** (the beta row), **Vitals**, **Cards and
context**, **Attributes & checks**.

### 1.1 The beta row (General)

| Control | Does | Verdict |
| --- | --- | --- |
| "Stats is in beta" hint | Says the page is off until switched on, what Report a problem does | keep |
| Report a problem | Copies the report, opens the prefilled GitHub issue | keep |

The row sits before the first heading, so the rail names its tab
"General", which says nothing. Give it a heading of its own, "About this
beta", and the tab reads that. See section 5.

### 1.2 Vitals

Order today: Track vitals (master) → Your character too → the sheet (one
row per vital: on/off, icon, name, colour, start, AI tick, up, down,
remove; Add; preset chips) → **[new group] Cards and context:** Bars on
the card front → Bars on the front (how many) → Warn at or below →
Include in history context.

| Control | Does | Verdict |
| --- | --- | --- |
| Track vitals | master | keep |
| Your character too | persona gets vitals | keep; dim when master off |
| Per-vital row: on/off, icon, name, colour, Start, AI | the sheet | keep; dim when master off |
| Up / Down per row | sheet order (card order follows) | keep |
| Remove per row | drops the vital | keep |
| Add | a blank vital | keep (custom names) |
| Preset chips | one-press add of a known vital | keep (presets); not a duplicate of Add |
| Bars on the card front / how many / Warn at / Include in history | card and context options | **fold** under Vitals (finding 1); dim when master off |

### 1.3 Attributes & checks

Order today: master → sheet (one row per attribute: on/off, name, short
form, skills, up, down, remove; Add; preset chips) → Send scores to the
AI → The AI sets the difficulty → Messages the game master reads →
Default difficulty → Let me change the ruling → Criticals → The AI may
call for checks → …line → …tool → …NPCs → How often → Notify on dice
events → Send the tier to the AI → Suggest stats for new characters
automatically → Proficiency bonus → Difficulty classes.

Proposed order, with plain dividers (a different class from the group
label, so the rail does not make tabs of them):

1. **Sheet**: master; the attribute rows; Add; preset chips; Proficiency
   bonus.
2. **Rolls**: Difficulty classes (the five DCs); Default difficulty
   (reads those numbers, so it follows them); Criticals.
3. **The game master**: The AI sets the difficulty; Messages the game
   master reads; Let me change the ruling; The AI may call for checks;
   …as a line; …as a dice tool; …on NPCs too; How often.
4. **What the AI is told**: Send scores to the AI; Send the tier to the
   AI.
5. **NPC sheets**: Suggest stats for new characters automatically (with a
   hint pointing at the Workshop's Fill by tier and Suggest from the
   story).
6. Notify on dice events, last: a debugging aid, not a rule.

| Control | Does | Verdict |
| --- | --- | --- |
| Attributes and dice checks | master | keep |
| Per-attribute row (on/off, name, short form, skills field, up, down, remove) | the attribute list and its skills | keep; dim when master off |
| Add / preset chips | custom attribute / the D&D six | keep |
| Send scores to the AI (with a roll / always / never) | when the attributes line goes out | keep, **move** to "What the AI is told" |
| Send the tier to the AI | the tier word in that line | keep, **move** next to Send scores |
| The AI sets the difficulty | the ruling call on send | keep, **move** to "The game master" |
| Messages the game master reads | the ruling call's context | keep, same block |
| Default difficulty | fallback when the AI is not asked or fails | keep, **move** after Difficulty classes |
| Let me change the ruling | the override row in the popover | keep, "The game master" block |
| Criticals | nat 20 / nat 1 | keep, "Rolls" block |
| The AI may call for checks + line / tool / NPCs / How often | Phase 3 | keep; the four sub-rows already dim |
| Notify on dice events | toasts and console lines | keep, **move** last |
| Suggest stats for new characters automatically | automatic NPC sheets | keep, **move** to "NPC sheets" |
| Proficiency bonus | the number every tick adds | keep, **move** to "Sheet" |
| Difficulty classes (five numbers) | the DC table | keep, **move** to "Rolls", before Default difficulty |

Nothing here to 𝖆𝖓𝖓𝖎𝖍𝖎𝖑𝖆𝖙𝖊. "Send scores" and "Send the tier" could be one
select ("Send scores: with a roll / always / never" plus a tier tick),
but a tick beside a select is what they are now, once adjacent.

## 2. Settings → Generation (together mode)

Order today: Generation Mode → [Auto-update, hidden in together] → Fetch
the tracker when a reply skips it → Refresh Tracker Data → Chat History
Depth → Narrator Mode → Skip Injections → Connection Profile → External
API card → History Persistence card → Advanced card.

| Control | Does | Verdict |
| --- | --- | --- |
| Fetch the tracker when a reply skips it | the recovery switch (together only) | keep |
| Refresh Tracker Data (now shown in together mode) | re-asks for the last reply's block | keep; add a one-line hint, since in together mode the button has none and its job differs from separate mode's |
| Chat History Depth | messages the separate request and the recovery read | keep; its hint ("Messages included in context") could say which request |
| Connection Profile | the profile the separate request and the recovery switch to | keep, **move** up under Refresh Tracker Data (finding 6) |

## 3. Settings → Voices

Groups today (rail tabs): **General**, **Delivery**, **Connections**,
**My custom voices**. The regrouping the local session did is sound.

| Control | Does | Verdict |
| --- | --- | --- |
| General: Use DES voices, auto-read, own messages, budget, Narrator (▶, ×3), Design a narrator voice, Resume auto-read | as labelled | keep |
| Delivery: Delivery note (global) + reset | the default note | keep; **rename** the hint: it should say characters with a note in Workshop → Voice use theirs instead |
| Delivery: Never whisper | bans whispered delivery | keep |
| Delivery: Steadiness + Temperature | temperature per line; the slider hides when Steadiness is off | keep (this is the dimming pattern the Stats page should copy) |
| Delivery: Anchor designed voices to their description | the anchor | keep |
| Delivery: Speed | playback rate | keep |
| Connections: Gemini voices via → the one key row (toggle, Test, Clear) → route + Save key to SillyTavern → Voice model | setup | keep |
| My custom voices: per-voice ▶, ×3, Recreate, Delete; Count slots, Remove unused | as labelled | keep |

Audition ×3 appears on the Narrator row, on each custom voice and in
Workshop → Voice. Three places, one job, each where the voice is being
judged: deliberate, keep.

## 4. Workshop → Attributes

Order today: heading → helper → (notice when attributes are off) →
**Tier row:** Tier select, Fill by tier, Suggest from the story,
"AI-suggested" badge, what the tier means → the grid (score, modifier,
skill chips with the Save tick and the Casting chip) → Talents (level
star, remove, add) → **Actions:** Standard array, Roll 4d6 drop lowest,
All 10 → foot note.

| Control | Does | Verdict |
| --- | --- | --- |
| Tier select | the sheet's tier word | keep |
| Fill by tier | the tier's array over the current ranking | keep |
| Suggest from the story | one small call, nothing kept until Save | keep |
| Standard array / Roll 4d6 / All 10 | fill or reset every score | keep, **move** up beside Fill by tier (finding 4) |
| Score box, modifier | the sheet | keep |
| Skill chips, Save tick, Casting chip | proficiency, saves, the casting ability | keep |
| Talents: add, star (Practised ↔ Master), remove | talents | keep; becomes the last block |

Proposed: one toolbar above the grid reading `Tier [select] · Fill by
tier · Standard array · Roll 4d6 · All 10 · Suggest from the story`, the
"what the tier means" line under it, then the grid, then Talents, then
the foot note. All 10 keeps its title ("every score back to 10;
proficiencies stay").

## 5. Workshop → Voice

Current voice (▶, ×3, Remove) → status notes → Delivery note for this
character → Test line → Standard | My voices | Create new → the list.
Reads top-down in the order a person uses it. Keep as is.

## 6. The dice popover and the chip

Order today: "Checking as" → attribute chips → skill row (Plain,
Casting, the attribute's skills, Other skills ▸) → other-skills row →
"sheet is all 10s" note with an Open Workshop link → What are you
attempting? → override row (only with Let me change the ruling) →
how-it-works hint → **pending-call line** → OK + Cancel, or OK + Discard
check when a check is pending.

| Control | Does | Verdict |
| --- | --- | --- |
| Attribute chips, skill chips, Plain, Casting, Other skills | the pick | keep |
| Open Workshop link in the all-10s note | sends the player to their sheet | keep |
| Context box | the line the game master reads | keep |
| Override row: Game master decides + five words + advantage | the ruling, when allowed | keep |
| OK / Cancel / Discard check | OK closes and tags; Cancel closes; Discard drops a pending check | keep (Discard only exists while a check waits, which is right) |
| Pending-call line | why the chips are preselected | keep, **move** to the top (finding 5) |
| Chip × above the message box | declines or discards the waiting check | keep |

## 7. Three ways into "Roll a check"

The d20 by the wand (the DES composer, under every setup but Classic),
"Roll a check" on the persona card's menu, and "Roll a check" in the
floating button's fly-out (hideable like its neighbours). Classic has no
composer button, so the card menu and the fly-out are its ways in. All
three open the same popover. Keep all three.

## 8. Wording

- Settings → Voices → Delivery note hint: add "A character with a note of
  their own in Workshop → Voice uses that instead."
- Settings → Generation → Refresh Tracker Data: a hint under the button,
  "Asks for the last reply's tracker data again" in together mode.
- Settings → Stats → the beta row's group: a heading "About this beta",
  so the rail's first tab is not "General".

## 9. Decisions for Jordan

1. Apply findings 1–6 as listed? All are reorders; none changes a
   setting's key or default.
2. Dim or hide? Dimming (opacity, still clickable) is what the calls
   sub-rows do; hiding is what Steadiness does. Dimming keeps the page's
   shape stable and shows what switching on will bring. Recommended: dim.
3. The attribute dividers: plain in-group dividers (recommended), or real
   rail tabs (the Stats page would then have seven tabs).
