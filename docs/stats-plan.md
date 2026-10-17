# Stats — Project Short Fuse

Implementation plan for character stats in Doom's Enhancement Suite. Phase 1
(**Vitals**) is specified in full below; later phases are sketched at the end
so this file stays the roadmap for the whole feature.

Read `docs/rebuild-philosophy.md` first. Every rule in it applies here,
especially: the parser is the contract, pay for what you use, additive-only
storage, and the LLM is hardware.

---

## 0. Status and open decisions

Status: **Phases 1, 2 and 3 built on branch `Project-Short-Fuse`; awaiting
in-browser verification (the Vitals rows and the Attributes and dice rows in
`docs/parity-checklist.md`).** Not released: commit 9
(version, changelog, What's New, README) waits for the word.

Two things changed from the plan while building, both recorded below: the
shelf reaches the editors in `thoughts.js` through a dynamic import rather
than a static one (a static edge closed a cycle through
`characterAliases.js`), and the legacy character panel's bars gained their
missing fill colour while the renderer was open.

Decisions, resolved 2026-10-09:

| # | Question | Decision |
|---|---|---|
| D1 | Default vital set when the feature is switched on | Nine vitals in the sheet, each with its own on/off. Health, Energy, Satiety, Stamina, Morale, Sanity and Arousal **on**; Hygiene and Mana present but **off** |
| D2 | Word for the bars in the UI | A **Stats** page of its own on the settings rail; the bars group inside it is **Vitals** (attributes join the same page in Phase 2) |
| D3 | Player vitals in Phase 1 | **Yes.** The persona is included, on by default when vitals are on |
| D4 | Release | **Not yet.** No version bump, changelog, What's New or README until told. Commit 9 waits |

Everything else below is a routine call and is stated as such.

---

## 1. Background (what already exists)

### 1.1 Upstream: RPG Companion 3.7.4

Two separate stats features:

- **User Stats** — the player's bars (Health, Satiety, Energy, Hygiene,
  Arousal), mood and status fields, skills, inventory, level, and the six
  classic attributes with dice. DES archived all of it at its first commit
  (`7679c7a`) and deleted the dead code later (`89e061f`, `6b51480`).
- **Character Stats** — custom per-present-character stats shown as coloured
  numbers and card-back bars. **DES still carries this one.** Only its switch
  is gone.

### 1.2 The fork: pull request #38 "Character stats" (Caged1994/Better-Stats)

A from-scratch rewrite of the upstream concept list, generalised to every
character, plus equipment, conditions, abilities, memories, XP and an RPG mode.
9,763 lines over 47 files, based on 2.6.0, conflicts with 3.0.1 in ten files,
~5,000 lines of eager JS, roughly 1,500 prompt tokens per message with
everything on, a single last-reply undo instead of per-swipe data. Not merged.
Ideas worth borrowing later, with credit: per-stat "AI may change" tick,
AI-filled NPC sheets on first appearance, a human attribute scale.

### 1.3 The dormant hook on `main`

`trackerConfig.presentCharacters.characterStats` (`src/core/state.js:229`),
default `{ enabled: false, customStats: [Health, Arousal] }`. When enabled:

| Stage | Where | State |
|---|---|---|
| Prompt | `jsonPromptHelpers.js:299` emits `"stats": [{"name": "Health", "value": X}, …]` inside each character | works |
| Parse | `thoughts.js:413` accepts array **and** object shapes | works |
| Per-swipe, locks, history | rides inside `characters`, so free | works |
| Render, legacy panel | `thoughts.js:684` text, `:745` card-back bars | works, CSS alive (`style.css:2010`, `:2247`) |
| Render, portrait shelf | `portraitBar.js:1594` deliberately **skips** `stats` | missing |
| Inline edit | `thoughts.js:1142` clamps 0–100, both shapes | works (legacy panel only) |
| Seeding | `thoughts.js:993` seeds new characters at 100 | works |
| Settings UI | Tracker Editor tab commented out (`trackerEditor.js:926`) | **missing — nothing can switch it on** |
| Migration default | `persistence.js:1089` writes `stats: []` but every reader uses `customStats` | **bug** |
| History / context text | `promptBuilder.js:489` formats object shape only; the AI emits the array shape | **bug** |
| i18n | `en.json:29-32` | present |

So the work is: a settings home, shelf rendering, the player, two bug fixes,
and polish. Not a new subsystem.

---

## 2. Phase 1 scope

### Goals

1. Any character on the Present Characters shelf — NPCs and the player's
   persona — can carry 0–100 vitals the AI updates each reply.
2. Vitals are defined once, globally (name, colour, icon, starting value,
   AI-updated or fixed), from a settings page that is the **only** writer.
3. Bars on the portrait cards and the card back under all six looks
   (Classic plus the five setups), click-to-edit on the back.
4. Per-swipe, per-chat, history persistence and the Tracker Data dropdown
   all keep working with no new storage structures.
5. Off by default. A default install emits a **byte-identical** tracker
   prompt (`tools/tracker-prompt-test.mjs` pins this).

### Non-goals (later phases or never)

- Attributes, modifiers, dice, DCs (Phase 2 and 3).
- Per-character starting values in the Workshop (Phase 1.5 if asked).
- Equipment, conditions, abilities, memories, XP (the fork's layer; not planned).
- Mood emoji and status text for the player (custom scene fields cover it).
- A floating or pop-out stats panel.

---

## 3. Design

### 3.1 Vocabulary

- **Vital** — one 0–100 value per character (Health, Energy, …). Shown as a bar.
- **Sheet** — the global list of vital definitions. Lives in `trackerConfig`,
  so presets carry it like every other tracker setting.
- **Values** — the per-character numbers. Live in the tracker JSON of each
  swipe, exactly like thoughts and relationships do today.

### 3.2 Data model

**Sheet** (additive fields on the existing `customStats[]` entries; stored key
names do not change):

```js
trackerConfig.presentCharacters.characterStats = {
  enabled: false,                 // master switch (existing key)
  customStats: [                  // existing key, entries gain fields
    { id: 'health',  name: 'Health',  enabled: true,  color: '#e5484d', icon: '❤️', start: 100, ai: true },
    { id: 'energy',  name: 'Energy',  enabled: true,  color: '#f5b301', icon: '⚡', start: 100, ai: true },
    { id: 'satiety', name: 'Satiety', enabled: true,  color: '#2fbf71', icon: '🍖', start: 80,  ai: true },
    { id: 'stamina', name: 'Stamina', enabled: true,  color: '#ff7a45', icon: '🏃', start: 100, ai: true },
    { id: 'morale',  name: 'Morale',  enabled: true,  color: '#4c8dff', icon: '🙂', start: 75,  ai: true },
    { id: 'sanity',  name: 'Sanity',  enabled: true,  color: '#20c997', icon: '🧠', start: 100, ai: true },
    { id: 'arousal', name: 'Arousal', enabled: true,  color: '#f06595', icon: '🔥', start: 0,   ai: true },
    { id: 'hygiene', name: 'Hygiene', enabled: false, color: '#22b8cf', icon: '🧼', start: 100, ai: true },
    { id: 'mana',    name: 'Mana',    enabled: false, color: '#a66bff', icon: '✨', start: 100, ai: true },
  ],
  player: { enabled: true },      // new: the persona gets vitals too
  showOnCards: true,              // new: bars on the card front
  maxBars: 3,                     // new: front shows the first N enabled
  lowAt: 25,                      // new: at or below → warning colour
  persistInHistory: false,        // new: include in History Persistence
};
```

The sheet and its defaults live in `src/utils/vitals.js` (pure, no SillyTavern
imports). Every reader goes through `vitalsConfig()` / `vitalDefs()` there, which
fill in missing fields on read, so presets saved before these fields existed
still load.

`ai: false` means "fixed": DES tells the AI the value is locked and, whatever
the AI returns, writes the previous value back after parsing (§3.4). Deterministic;
no prompt dependence.

**NPC values** — unchanged shape inside each character object:

```json
{ "name": "Mara", "emoji": "🗡️", "stats": [ { "name": "Health", "value": 72 } ], … }
```

**Player values** — a new top-level key in the unified tracker object:

```json
{ "quests": …, "infoBox": …, "characters": […],
  "player": { "stats": [ { "name": "Health", "value": 91 } ] } }
```

Stored wherever `characterThoughts` is stored today: `lastGeneratedData.player`,
`committedTrackerData.player`, `message.extra.dooms_tracker_swipes[id].player`,
`chat_metadata.dooms_tracker.player`. Always a JSON string or `null`, like
its siblings.

The player stays **out of `characters`**. The prompt's "Exclude {user} from
characters — NPCs only" rule is load-bearing for chat bubbles, voices presence,
expression sync and duplicate detection; a separate key leaves all of that alone.

### 3.3 Prompt

All additions are gated on `characterStats.enabled && enabledVitals.length > 0`,
so the default prompt does not change by a byte.

**Characters spec** (`buildCharactersJSONInstruction`), existing emission kept,
with the range made explicit through the typed-field helper already used for
custom fields (`buildFieldSpec` `progress` → `<number 0-100: …>`):

```
    "stats": [
      {"name": "Health", "value": <number 0-100>},
      {"name": "Energy", "value": <number 0-100>}
    ]
```

**Player spec** (new, emitted after `characters` when `player.enabled`):

```
  "player": {
    "stats": [
      {"name": "Health", "value": <number 0-100>}
    ]
  }
```

**Guidance line** appended after the FORMAT block, one sentence, compact and
verbose variants:

- compact: `Vitals are percentages: move them realistically with what happens
  and with time (rest, food, wounds, exertion); keep them when nothing affects
  them. A vital marked "locked" keeps its exact value.`
- verbose: the same with the examples spelt out.

A fixed vital (`ai: false`) appears in the previous-tracker example with
`"locked": true`, reusing the lock sentence already in the prompt
(`addLockInstruction`).

**Token cost** (3 vitals, 4 characters, compact):

| Where | Tokens |
|---|---|
| Spec, once per prompt | ≈ 40 |
| Previous-tracker example, per reply | ≈ 100 |
| Model output, per reply | ≈ 100 |
| Fork, same scene, everything on | ≈ 1,500 |

### 3.4 Parse and apply

New pure module `src/utils/vitals.js` (no SillyTavern imports, unit-testable):

- `getVitalDefs()` — enabled definitions in order.
- `readVitals(charObj)` → `{ [name]: number }`, accepts array or object shape,
  clamps 0–100, ignores unknown names.
- `writeVitals(charObj, map)` — writes back in the **array** shape the AI
  uses (keeps the stored JSON stable).
- `enforceFixed(nextMap, prevMap, defs)` — copies previous values over `ai:false`
  vitals; fills missing vitals with `start` (or the previous value if there
  was one).
- `vitalColor(def, value, lowAt)` — the def's colour, or the warning colour.

Apply point: where parsed tracker data is accepted in both generation modes —
`sillytavern.js:onMessageReceived` (together) and `apiClient.js:updateRPGData`
(separate / external). One call each: normalise `characters[*].stats` and
`player.stats` against `committedTrackerData` before the data is stored. This
is the single place the `ai: false` rule is enforced.

**Thread-through for the `player` key** (the only part with blast radius; the
list mirrors `docs/tracker-customization-plan.md` §2.2):

| # | File | Change |
|---|---|---|
| 1 | `src/core/state.js:509,519` | `player: null` on `lastGeneratedData` and `committedTrackerData` |
| 2 | `src/systems/generation/parser.js:141` | `player: null` in the result |
| 3 | `parser.js:168` | unified detection: `… \|\| parsed.player`; copy `parsed.player` |
| 4 | `parser.js:190-210`, `:235-250` | unwrap list and categorise: a single-key `{player}` object, or an object whose only key is `stats`, is the player |
| 5 | `src/systems/integration/sillytavern.js:105,218,462,522` | read/write `player` next to `characterThoughts` in the swipe store |
| 6 | `src/core/persistence.js:646,699-705,786-798` and `saveChatData()` | per-swipe write, chat load, chat save |
| 7 | `src/systems/generation/apiClient.js` | separate-mode store, same spots as `characterThoughts` |
| 8 | `src/systems/generation/promptBuilder.js:generateTrackerExample` | echo `player` in the previous-tracker example |
| 9 | `promptBuilder.js:489,905` | context summary and history: array shape fix, player line |
| 10 | `src/systems/rendering/trackerJsonInline.js:45,178` | add `player` to the key lists so the Tracker Data dropdown shows and edits it |
| 11 | `src/systems/generation/injector.js` | nothing expected; verify the suppression path ignores unknown keys |

`saveChatData()` rebuilds `chat_metadata.dooms_tracker` wholesale, so step 6
is the one that silently loses data if missed. The test in §6 covers it.

### 3.5 Rendering

**Portrait card front** (`portraitBar.js:572` template): a `dooms-pb-vitals`
strip inside the card, sitting just above the name strip, one 3 px track per
vital, the first `maxBars` enabled vitals, fill width = value, colour from
`vitalColor`. `title` lists every vital with its value. Static DOM, `width`
transition only, nothing animates on its own, so performance mode and
`prefers-reduced-motion` need no special case. The strip is part of the card
HTML string, so the existing per-card string cache and `keyedReconcile`
diffing cover it with no new render path.

**Card back** (`buildPortraitBackFace`, `:1540`): remove `stats` from
`skipFields`; add a "Vitals" section using the existing
`dooms-pb-back-section` / `label` / `value` markup, with a track and a value
pill per vital. Clicking the value opens an inline number field; blur or Enter
writes through `updateCharacterField(name, vitalName, value)` (already handles
stat fields for NPCs) or the player equivalent, then `saveChatData()` and a
shelf repaint.

**Persona card** (`dooms-pb-user`): same strip and back-face section, reading
from `player`.

**Legacy `#rpg-thoughts` panel**: already renders bars (`thoughts.js:745`).
Give its fills the per-vital colour instead of the default and leave the rest.

**Setups**: one shared rule block in `styles/overhaul.css` next to the card
rules at `:574-617`, built from the setup tokens (`--ov-line` for the track,
`--ov-panel2` behind the strip, `--ov-radius-sm`). Expected per-look notes:
Grimoire hairline tracks, Ops Console square ends, Arcade thicker bars in the
nameplate colour band, Inked ink-outlined tracks, Lumen glass track. Verify
each in the browser; this is the one part that cannot be checked from here.

**Mobile**: the strip scales with the card variables already in place; the
back-face edit uses a native number input so the keyboard is numeric.

### 3.6 Settings page

New section `data-accordion="stats"`, icon `fa-heart-pulse`, title **Stats**,
placed after Workshop (`template.html:1418`, before Voices). The rail picks it
up automatically (`settingsRail.js:47`). Markup follows the Workshop section
(`template.html:1373-1385`); handlers follow `renderWorkshopRelationships`
(`index.js:247,1221-1271`): a `renderVitalsSettings()` that rebuilds the list
from config, delegated handlers on `document`, every write through
`saveSettings()`.

Rows:

- **Track vitals** — master toggle (`characterStats.enabled`). Hint states the
  token cost in one line.
- **Your character too** — `player.enabled`.
- **Vitals list** — per row: on/off, icon, name, colour, starting value,
  **AI updates** toggle, delete. Drag order later; up/down arrows now.
- **Add vital** button plus one-click chips for the common set (D1).
- **Show bars on cards** (`showOnCards`), **Bars on the front** 1–6 (`maxBars`),
  **Warn at or below** % (`lowAt`).
- **Include in history context** (`persistInHistory`).

This page is the only UI that writes these keys. The Tracker Editor tab that
used to is gone, so the two-writer drift the customization plan warns about
cannot happen.

### 3.7 History persistence and context summary

`promptBuilder.js:489` (`formatHistoricalTrackerData`) handles only the object
shape; the AI emits the array shape, so vitals never reached history. Route
both through `readVitals()`. Add a player line: `Your vitals: Health 91%,
Energy 60%`. Gated on `persistInHistory` the same way custom fields are.

The separate-mode context summary (`generateContextualSummary`) gets the same
fix so the roleplay call sees current vitals.

### 3.8 Migration (additive, `persistence.js` tail, `=== undefined` pattern)

- Ensure `characterStats.customStats` is an array (fixes the `stats: []`
  default at `:1089`; never read by anything).
- For each existing entry, fill `color`, `icon`, `start: 100`, `ai: true`
  when missing.
- Add `player`, `showOnCards`, `maxBars`, `lowAt`, `persistInHistory` when
  missing.
- If `enabled !== true` **and** the list is the old untouched default
  (`health`, `arousal`, no extra fields) or the empty list the broken default
  wrote, replace it with the preset sheet (D1). A list the user ever edited
  is left alone.

No stored key is renamed or removed. Presets export and import unchanged:
missing fields default on read.

---

## 4. Files touched

| File | Why |
|---|---|
| `src/utils/vitals.js` | new: pure model |
| `src/core/state.js` | defaults; `player` on the two data objects |
| `src/core/persistence.js` | migration; `player` in swipe/chat save/load |
| `src/systems/generation/jsonPromptHelpers.js` | stats spec range; player spec |
| `src/systems/generation/promptBuilder.js` | guidance line; example echo; history and context fixes; key warnings for `player` |
| `src/systems/generation/parser.js` | `player` result and detection |
| `src/systems/integration/sillytavern.js` | apply/enforce; swipe store |
| `src/systems/generation/apiClient.js` | apply/enforce; swipe store (separate mode) |
| `src/systems/rendering/trackerJsonInline.js` | key lists |
| `src/systems/rendering/thoughts.js` | seed with `start`; per-vital colours; player edits |
| `src/systems/ui/portraitBar.js` | front strip; back-face section; inline edit |
| `index.js` | `renderVitalsSettings` and handlers |
| `template.html` | the Stats section |
| `style.css` | strip and back-face rules (Classic) |
| `styles/overhaul.css` | setup rules |
| `tools/tracker-prompt-test.mjs` | new fixtures |
| `tools/vitals-test.mjs` | new: model, parser, enforcement, swipe store |
| `docs/parity-checklist.md`, `CHANGELOG.md`, `whatsnew.json`, `manifest.json`, `README.md` | release |

Estimated size: 1,200–1,600 lines including CSS and tests. Eager JS added:
`vitals.js` only (~150 lines); everything else is edits to modules that are
already on the generation path.

---

## 5. Commit sequence (each one leaves the extension working)

1. `docs: stats plan` — this file.
2. `Vitals: config shape, defaults and additive migration` — no behaviour change.
3. `Vitals: prompt spec and guidance, gated` + golden-test fixtures (default
   output byte-identical; enabled adds `stats`; player adds `player`).
4. `Vitals: player key through parser, state, swipes and chat save` + test.
5. `Vitals: normalise, enforce fixed, seed with start; history and context fixes`.
6. `Vitals: bars on the portrait cards and the card back, click to edit` (Classic CSS).
7. `Vitals: the five setups`.
8. `Settings: a Stats page` (template + handlers).
9. `3.1.0: changelog, What's New, README, parity rows`.

`node tools/load-check.mjs` and both test files run before every push.

---

## 6. Verification

Automated:

- `tools/tracker-prompt-test.mjs`: default prompt unchanged; vitals on adds the
  `stats` array to the characters spec; player on adds the `player` key;
  fixed vitals carry `"locked": true` in the example; off removes everything.
- `tools/vitals-test.mjs`: `readVitals` on both shapes and garbage;
  `enforceFixed` keeps previous values for `ai:false` and seeds missing ones;
  parser returns `player` from the unified object, a wrapped `{player}` and a
  bare `{stats}` block; `updateMessageSwipeData` + `loadChatData` round-trip
  carries `player`; `vitalColor` flips at `lowAt`.

In the browser (parity checklist rows to add):

- [ ] Vitals off (default): tracker prompt identical to 3.0.1; no strip on any card.
- [ ] Vitals on, three defaults: new NPC appears with start values; the AI
      moves them on the next reply; bars and back-face values match the JSON.
- [ ] Player on: persona card shows the strip; swipe back and forth and the
      player's numbers follow the swipe.
- [ ] A fixed vital keeps its value when the AI returns a different one.
- [ ] Click-to-edit on the back face persists across reload and a chat switch.
- [ ] Separate and External modes update vitals; Tracker Data dropdown shows `player`.
- [ ] History persistence includes vitals when the toggle is on, not otherwise.
- [ ] Each of the six looks on desktop and a phone: strip legible, nothing
      overflows the card, performance mode unchanged.
- [ ] Presets: export with vitals, import into a fresh profile, list intact.

---

## 7. Phase 2 — Attributes and dice (player-triggered)

Status: **built, then reshaped on the owner's first try (D12); awaiting in-browser
verification (the Attributes and dice rows in `docs/parity-checklist.md`).**

Four things changed from the plan while building, recorded here:

- Sheets are per name, not per campaign version. §7.7 said "the way knives
  are", but a character's Strength is not something a campaign rewrites, and
  the dice need one sheet to read whichever version is on the stage. So
  `characterAttributes` is keyed `user:Name` / `npc:Name` like aliases are:
  it carries across a version switch, goes with the character when deleted
  from the Workshop or the Roster, and is copied when a persona becomes an
  NPC or the other way round.
- The Settings group has three more controls than §7.7 listed, all from
  D11: the AI sets the difficulty (on), how many messages it reads (6), and
  Let me change the ruling (off). There are five difficulty classes, not
  four: Easy, Medium, Hard, Very hard, Nearly impossible.
- D12, after the owner tried the first popover ("why are there two
  options?"): the popover is for picking, not rolling. Pick the attribute, a
  skill under it (5e's list, editable per attribute in Settings) or a plain
  check, a line of context, OK. The ruling, the roll and the box all happen
  when the message is sent: the game master reads the message itself (with a
  timeout before the default stands), the die is rolled, and the box sits at
  the top of the reply rather than under the player's message. Once rolled,
  final: no Roll now, no Keep or Discard after a roll, no remove button;
  Discard exists only before the roll. Skills carry proficiency: a tick per
  skill on the Workshop sheet adds the proficiency bonus (2 by default,
  Settings → Stats). `rollOnSend` left the config with this. The 5e variant
  "Skills with Different Abilities" is in: any skill may pair with any
  attribute (Constitution (Athletics), Strength (Intimidation)); the popover
  lists the attribute's own skills first and the rest behind "Other
  skills", each tagged with its home; the proficiency follows the skill, and
  the game master is told when one is borrowed.
- The verdict is set twice. SillyTavern's `Generate()` fires
  GENERATION_STARTED before `sendMessageAsUser()` adds the sent message and
  emits MESSAGE_SENT, so the injector's pass at generation start sees the
  previous user message: no roll on the send that rolled, and a stale roll
  on the next send that did not. `refreshDiceInjection` therefore runs
  again from MESSAGE_SENT, right after `onDiceMessageSent` attaches the
  roll; SillyTavern awaits MESSAGE_SENT listeners before it builds the
  prompt, so that is the pass the reply is generated from. For the same
  reason the "with a roll" attributes line rides in the dice slot with the
  verdict rather than in the tracker block, which is built at generation
  start; "always" keeps it in the block.
- Where the dice texts sit. SillyTavern joins every injection that shares a
  depth and role into one message, in key order, and within a depth puts
  the system-role message after the user-role one, closest to the reply.
  The tracker instructions go in as a user-role message at depth 0 (Settings
  → Prompt Injection); the verdict first went in as a system-role message
  at depth 0 and so landed after them, and a model that read "narrate the
  attempt failing" last answered with narration and no tracker block, which
  the next replies then copied (The Long Calling, replies 36 and 55). The
  verdict, the rules and a "your previous reply left out the block" reminder
  now use the tracker instructions' own depth and role; their keys sort
  before 'dooms-tracker-inject', so the instructions end the message. Every
  verdict, and the tool's result, also says in words that the block is still
  required.

One change from the first draft, on the owner's question "why is the player
setting the difficulty?": they are not. The difficulty and any advantage are
the game master's call, made by the AI in one small separate call when the
message is tagged (§7.5). The player picks only the attribute, which is their
declaration of approach. An override exists behind a setting, off by default.

What RPG Companion had here was a line of numbers the AI was told about and a
roll it was asked to interpret ("rolled 14, decide whether they succeeded").
Phase 2 does the arithmetic in code and hands the AI a verdict to narrate.

### 7.1 Goals

1. Every character can carry attributes: the six D&D ones by default, the
   list editable, D&D scale, modifier `floor((score − 10) / 2)`, 10 means +0.
2. The player rolls a check from DES: pick an attribute, a difficulty, an
   advantage state; DES rolls with real randomness, compares against the DC
   in code, attaches the verdict to the message they send, and the AI narrates
   an outcome that is already decided.
3. Attributes reach the AI as one read-only line per character, never inside
   the per-reply tracker JSON. The parser contract is untouched.
4. Every roll leaves a visible record under the message it rode with.
5. Off by default; a default install's prompt is byte-identical.

### 7.2 Non-goals (later phases)

AI-called checks (Phase 3). Skills, proficiency, contested rolls, levels,
NPC sheets suggested by the AI (Phase 4). Per-chat attribute overrides.
Campaign-versioned attributes (noted for the campaign store list; not now).

### 7.3 Data model

Attributes are identity, not tracker fields, so they live beside aliases and
knives rather than in `trackerConfig`:

```js
extensionSettings.attributes = {               // the rules (Settings → Stats → Attributes & checks)
  enabled: false,
  list: [                                      // editable like the vitals sheet
    { id: 'str', name: 'Strength',     abbr: 'STR', enabled: true },
    { id: 'dex', name: 'Dexterity',    abbr: 'DEX', enabled: true },
    { id: 'con', name: 'Constitution', abbr: 'CON', enabled: true },
    { id: 'int', name: 'Intelligence', abbr: 'INT', enabled: true },
    { id: 'wis', name: 'Wisdom',       abbr: 'WIS', enabled: true },
    { id: 'cha', name: 'Charisma',     abbr: 'CHA', enabled: true },
  ],
  sendToAI: 'withRoll',                        // 'always' | 'withRoll' | 'never'
  difficulty: { easy: 10, medium: 15, hard: 20, veryHard: 25, nearlyImpossible: 30 },
  defaultDifficulty: 'medium',                 // when the AI is not asked, or cannot be read
  criticals: true,                             // natural 20 / natural 1
  aiRatesDifficulty: true,                     // the game master call (§7.5)
  allowOverride: false,                        // may the player change the ruling?
  rollOnSend: true,                            // tag the message, roll when it is sent
  contextMessages: 6,                          // what the rating call sees
};
extensionSettings.characterAttributes = {      // the values, global per character
  'user:Jordan': { str: 15, dex: 12, con: 10, int: 8, wis: 11, cha: 14 },
  'npc:Mara':    { str: 8, dex: 16 },          // missing → 10
};
```

A sheet that is all 10s is "default" and is never sent. Scores are clamped
1–30. Additive migration fills `attributes` and `characterAttributes` when
missing; nothing existing is touched.

### 7.4 The roll (pure, `src/utils/d20.js`)

- `modifier(score)` → `floor((score − 10) / 2)`.
- `rollDie(sides)` → `crypto.getRandomValues` with rejection sampling, so a
  d20 is uniform. `Math.random` is not used.
- `rollCheck({ attribute, score, dc, advantage, criticals })` → `{ die, kept,
  dropped, mod, total, dc, success, margin, critical }`. Advantage rolls two
  and keeps the higher, disadvantage the lower. With criticals on, a natural
  20 succeeds and a natural 1 fails whatever the total.
- `verdictText(roll, { userName, attempt })` builds the one block the AI sees:

```
[DICE: Jordan attempts "climb the wall". Strength check: d20 = 14, +2 (STR 15) = 16 vs DC 15 (Medium). SUCCESS, narrowly (by 1). This outcome is final: narrate the attempt succeeding with that margin in mind. Do not re-roll, reverse or soften it.]
```

Margin words: by 0–2 narrowly, 3–7 clearly, 8 or more decisively. Failure
reads "FAILURE … narrate the attempt failing and its consequences." A natural
20 reads "NATURAL 20, a critical success: better than hoped"; a natural 1
"NATURAL 1, a critical failure: worse than a plain miss." Roughly 60 tokens,
once.

### 7.5 Lifecycle

1. **Tag.** The player opens the roll popover (entry points in §7.7) and
   picks the attribute (the last one used is preselected). That is the only
   thing they decide.
2. **Rule.** DES makes one small separate call, on the same path as Separate
   mode and Generate Knives: the last few messages, what is in the message
   box so far, the attribute, and one question for the game master. The
   answer is one JSON line: a difficulty word (easy, medium, hard, very
   hard, nearly impossible), advantage, disadvantage or none, and a one-line
   reason. The chip above the message box then reads "🎲 CHA check · the AI
   calls it Hard (DC 20) · 'he already distrusts you' · rolls when you send".
   If the call fails or nothing is connected, the configured default
   difficulty is used and the chip says so. Keep typing and the chip offers
   a re-ask. With `allowOverride` on, the chip's ruling can be changed.
3. **Roll on send** (the default). On `MESSAGE_SENT` DES rolls, with
   advantage or disadvantage as ruled, and writes the result to the sent
   message as `message.extra.dooms_roll = { attribute, abbr, score, mod,
   rolls, kept, dropped, total, dc, difficultyId, difficultyLabel, reason,
   advantage, success, margin, critical, attempt, ts }`. **Roll now** rolls
   in the popover instead, so the die is seen first and can be discarded;
   the result then waits for the next message, or attaches at once when the
   chat's last message is the player's own with no reply yet.
4. **Inject.** On generation start the injector looks at the last user
   message. If it carries a roll, the verdict goes into slot
   `dooms-dice-verdict` at `IN_CHAT` depth 0, right after the player's words.
   It is derived from chat state, not a one-shot flag, so a swipe or
   regenerate of the reply gets the same verdict, and a reply to a message
   without a roll gets the slot cleared. Like the Doom Counter twist it
   bypasses tracker suppression, since it is the player's explicit action,
   except for impersonation and quiet prompts.
5. **Record.** A roll card renders under the user message, a sibling of the
   message text like the Tracker Data dropdown: "🎲 Strength check · d20 14
   +2 = 16 vs DC 15 · Success". Rendered on `USER_MESSAGE_RENDERED`, swept
   on `CHAT_CHANGED` and "show more messages", read from `extra.dooms_roll`.
   Its × removes the roll from the message; the reply already written is
   left alone.
6. Nothing is stored anywhere but the message, so branching and copying a
   chat take the rolls along and deleting the message deletes the roll.

### 7.6 Prompt

Two gated additions, both outside the tracker JSON:

- **Attributes line.** `ATTRIBUTES (D&D scale, 10 is average, bonus =
  (score − 10) / 2; read-only, never output them): Jordan: STR 15 (+2), DEX
  12 (+1), INT 8 (−1), CHA 14 (+2). Mara: DEX 16 (+3).` Only characters with
  a non-default sheet, only the attributes that differ from 10, about 15
  tokens per character. Sent when `sendToAI` is `always`, or `withRoll` and a
  verdict rides this generation; never otherwise.
- **The verdict** from §7.4, once per generation that answers a rolled
  message.

Golden fixtures: default output unchanged; `always` adds the line; `withRoll`
adds it only beside a verdict; the verdict names the attribute, the die, the
modifier, the DC and the outcome; a default sheet emits nothing.

### 7.7 UI

- **Entry points.** The FAB fly-out gets "Roll a check" (hideable like the
  other entries). Under the five setups the DES composer row gets a die
  button beside the tray button. The persona card's context menu gets "Roll
  a check". Under Classic the fly-out and the card menu are the ways in.
- **The popover** (`src/systems/ui/dicePanel.js`, lazy like the other
  modals; markup in `template.html`, CSS in `styles/modals.css` with setup
  rules in `overhaul.css`): attribute chips with the player's modifier under
  each; the game master's ruling once it arrives (difficulty, DC, advantage,
  reason) with a re-ask; **Roll when I send** and **Roll now**; for Roll
  now, the animated die (CSS, under a second, off under reduced motion and
  performance mode), the result line, Keep or Discard. The difficulty and
  advantage controls appear only with `allowOverride` on.
- **The chip** above the message box while a tagged or rolled check waits
  for a message, with × to discard.
- **Workshop → Attributes tab**, for NPCs and the persona: one number per
  attribute with the modifier shown live, the skills under it with a
  proficiency tick each, plus Standard array (15 14 13 12 10 8), Roll 4d6
  drop lowest, and All 10. Saved with the Workshop's Save into
  `characterAttributes`, per name like aliases.
- **Settings → Stats → Attributes & checks**: master toggle; the attribute
  list (name, abbreviation, on/off, order, add, remove, presets as chips);
  Send scores to the AI (with a roll / always / never); the AI sets the
  difficulty and how many messages it reads; the default difficulty; Let me
  change the ruling; criticals on/off; the proficiency bonus; the five
  difficulty numbers. Each attribute row also carries its skills.

### 7.8 Files, tests, commits

New: `src/utils/d20.js` (pure), `src/systems/features/diceRolls.js`
(pending roll, attach on send, verdict injection, roll-card sync, the d20
button; small and eager), `src/systems/ui/dicePanel.js` (lazy),
`src/systems/ui/attributesPane.js` (lazy, the Workshop tab), `tools/d20-test.mjs`
(pure model), `tools/dice-test.mjs` (the lifecycle in the load-check sandbox).
Edits: `state.js`, `persistence.js` (migration), `injector.js` (the slot),
`sillytavern.js` (attach on send), `index.js` (FAB entry, user-message
decoration hook, settings handlers), `composer.js` (die button),
`portraitBar.js` (menu entry), `characterWorkshop.js` and `template.html`
(tab, settings group), `characterRoster.js` (sheet purge), `promptBuilder.js`
(attributes line), the three stylesheets, docs.

Tests: d20 uniformity over many rolls within tolerance, the modifier table,
advantage and disadvantage, criticals, margin words, verdict text; sheet
normalisation and the default-sheet rule; prompt gating; attach on send;
the verdict present for a rolled last message, absent otherwise, kept
across a swipe.

Commits: 10 docs (this section); 11 model, settings, migration, tests;
12 prompt line and golden fixtures; 13 roll lifecycle: pending, attach,
inject, card; 14 popover, entry points, styling; 15 Workshop tab and the
Settings group; 16 parity rows.

### 7.9 Decisions, resolved 2026-10-09

| # | Question | Decision |
|---|---|---|
| D5 | The attribute list | The D&D six by default, editable like the vitals sheet |
| D6 | When attributes go to the AI | With a roll only, by default; "always" available |
| D7 | Natural 20 and 1 as criticals | On by default |
| D8 | When a roll happens | Tag the message, **roll when it is sent** (default); Roll now available |
| D9 | NPC attributes in this phase | Yes: same tab, same store, sent only when not all 10s |
| D10 | AI-suggested NPC sheets | Later |
| D11 | Who sets the difficulty | **The AI, as game master**, in one small call at tag time; player override behind a setting, off by default |

## 8. Phase 3 — The game master's own calls

Status: **built on `Project-Short-Fuse`; awaiting in-browser verification (the
"game master" rows under Attributes and dice in `docs/parity-checklist.md`).**

The owner's ask, after reading how Multihog's D&D framework does it: "I have
always wanted that, and it would be both, but I don't want it to force a
dice roll into every scene, only if it's called for in the story." Two
decisions: D13, NPC checks too, on their Workshop sheets; D14, on by default
with attributes, each piece with its own switch.

### 8.1 Two ways in

- **A line at the end of the reply, any model.** The game master is told it
  may end a reply with `[CHECK: Dexterity (Stealth) | Hard, disadvantage |
  the lamps are lit]` and stop. For the player, that becomes the pending
  check: the chip above the message box says the game master called for it,
  × declines it, and the next send rolls it against the ruling the game
  master already gave, no second call. The popover shows the call; OK keeps
  the ruling under the player's own attribute and skill (the variant rule
  again). For an NPC (`[CHECK: Guard: Wisdom (Perception) | Medium | ...]`)
  the die is rolled the moment the reply renders, on the guard's sheet, kept
  on that reply per swipe, shown in place of the tag, and handed to the next
  generation as a verdict beside the player's. A swipe without the call
  withdraws it; a swipe with the same call keeps its roll. A reload restores
  a call waiting on the chat's last reply.
- **The `dooms_roll_check` tool, models with tool calling.** Registered with
  SillyTavern's ToolManager with the attribute and difficulty as enums from
  the sheet, `who` only with NPC checks on, and `shouldRegister` tied to the
  switches. The action rolls in code on the roller's sheet (modifier and
  proficiency included, unlike Multihog, where the model passes the
  formula) and answers with the same verdict text the slot would carry.
  SillyTavern then generates again with the result in context. The same
  arguments for the same player message roll once (the roll is kept on that
  message), so a repeated call or a swipe never re-rolls. Each roll is also
  attached to SillyTavern's tool-call message (matched by the arguments the
  model passed), and the reply that follows shows it in its box.

Which the game master is told about is decided per generation: the tool
when the tool switch is on and `isToolCallingSupported()` says the current
API can call tools, else the end-of-reply line, else nothing. The text goes
in its own slot one message above the verdict and says, in both forms, that
most replies have none.

### 8.2 Settings → Stats → Attributes & checks

The AI may call for checks (on); as a line at the end of its reply (on); as
a dice tool (on); on NPCs too (on); How often: Sparingly (only when the
stakes are real) or Whenever an attempt could plausibly fail. Editing the
attribute list re-registers the tool so its enums follow the sheet.

### 8.3 What stays the player's

Nothing the game master calls can be rolled twice, softened, or re-asked.
The player can decline a called check (×) or re-tag it under another
attribute and skill; the difficulty stands. Combat, initiative, HP and
damage dice are not in scope; the verdict text and the box are the whole
mechanical surface.

### 8.4 Files and tests

`src/utils/d20.js` (parseCheckCall, stripCheckCalls, resolveCheckCall,
findAttribute, the two instructions, buildDiceToolDefinition, the aiCalls
config and its migration), `src/systems/features/diceRolls.js`
(onDiceReplyRendered, the NPC roll store, diceToolAction,
onDiceToolCallsPerformed, registerDiceTool, buildDiceRulesForGeneration,
rollsForReply), `src/systems/generation/injector.js` (the rules slot),
`index.js` (events, settings), `src/systems/ui/dicePanel.js` (the call in
the popover and the chip), `template.html`, the stylesheets, docs.
`tools/d20-test.mjs` §7 and `tools/dice-test.mjs` §8–9.

### 8.5 When the block goes missing (resolved 2026-10-10)

A reply that has just been handed a verdict, or that resumes after a tool
call, sometimes writes the story and skips the tracker block. In together
mode nothing then updates, and the next reply copies the last one. Three
layers, in `src/systems/generation/trackerRecovery.js` (pure, tested by
`tools/tracker-recovery-test.mjs`), `sillytavern.onMessageReceived`,
`apiClient.updateRPGData` and the injector:

1. **Wording and order.** The verdict and the rules ride at the tracker
   instructions' own depth and role, so the instructions come last; the
   verdict and the tool instruction say where the block goes ("before the
   story, exactly where your instructions place it").
2. **The reminder.** When the last reply's own text lacked the block, the
   next generation carries "[Your previous reply left out the tracker data
   block...]" in the same slot. Together mode stores a swipe entry for every
   reply, parsed or not, so the check reads the entry's content, and the
   mark a recovery leaves (`extra.dooms_tracker_recovered[swipe]`), never
   the entry's presence.
3. **The recovery.** A fresh reply that fails to parse (not a history load,
   not a tool record, at least one section on) gets one separate tracker
   request: `updateRPGData` forced through its mode guard, storing on the
   reply's swipe like a parsed block and marking it recovered. Behind
   "Fetch the tracker when a reply skips it" (Generation settings, together
   mode only, on by default). "Refresh Tracker Data" shows in together mode
   too. A tool call splits a reply in two and only the continuation gets
   MESSAGE_RECEIVED, so a block written in the first half is adopted for the
   continuation before any request is made.

**Phase 4 — if wanted.** Levels and a growing proficiency bonus,
AI-suggested NPC sheets. Saving throws and opposed actions are §10.

---

## 9. Open questions log

- D1–D4 above.
- Should fixed vitals also be lockable per character from the card back (a
  padlock like the legacy panel has)? Cheap to add in commit 6; default no
  until asked.

---

## 10. Phase 4a — Saving throws and opposed actions (2024 rules)

Status: **built on `Project-Short-Fuse` (`3c7969c` design, `31a4a84`
model, `ee08db6` lifecycle, 2026-10-11); awaiting in-browser
verification (parity rows "Saving throws").**

The owner's scene: Muzen (Charisma 30, his casting score, a master
telepath) reads the mind of Ines Arden, an untrained girl, while talking to
her. The game master called a Wisdom (Insight) check for Ines at Medium,
she rolled an 18, and the verdict said "narrate the attempt succeeding".
The model took that as Muzen's success. Two faults: the dice had no way to
say "a master against an untrained mind" (one roller, one flat difficulty
word, Muzen's +10 never in the maths), and the verdict never said whose
roll it was or what success meant.

Decisions: **D15** (Jordan): add saving throws from D&D and use the 2024
rules, so Ines makes a Charisma save against Muzen's Charisma. **D16**: the
character acting never rolls against a character resisting; the resisting
one saves, and the actor's ability sets the DC. **D17**: one shared
difficulty guide, with the calibration odds, in every instruction the game
master gets, and every verdict says whose roll it is and what success
means.

### 10.1 Rules used (2024 PHB, "d20 Tests")

- A saving throw is d20 + the ability modifier + the proficiency bonus when
  the character is proficient in that save. Advantage and disadvantage as
  for checks. With criticals on (the existing switch), a natural 20
  succeeds and a natural 1 fails, as the 2024 rules say for every d20 Test.
- A DC set by a character is **8 + their proficiency bonus + their modifier
  in the ability the effect uses**: the spell save DC formula, which the
  2024 rules also use for grapples, shoves and the like in place of
  contests. Muzen's Charisma 30 with a +2 bonus sets DC 20.
- A DC set by the world (poison, a collapsing floor, a fright) is a
  difficulty word from the same table as checks.
- Who rolls: the one whose own action is uncertain makes an ability check
  against a difficulty. When the action is done *to* someone who can
  resist, that someone makes a saving throw and the actor's ability sets
  the DC; the actor does not roll. Perception against Stealth stays a check
  against a difficulty word for now (passive scores are a non-goal).
- The casting ability (added after the first play, when the game master
  named Muzen's Wisdom for a telepathic push): one attribute per sheet,
  marked with the Casting chip on the mental stats in the Workshop, stored
  as `cha:casting` beside the proficiencies. Anything that character's
  magic or powers do to someone is resisted against it, whatever the game
  master names; a named physical ability (a shove's Strength) stands. The
  attributes line tells the AI "casting ability Charisma".

### 10.2 Data model

- Save proficiency per attribute, on the sheet beside the skill
  proficiencies: the `_prof` key `attrId:save`. "save" is a reserved slug;
  `normalizeSkills` refuses a skill named Save. `pruneProficiencies` keeps
  a save key whose attribute still exists.
- A roll record gains `kind: 'check' | 'save'` (missing means check) and,
  for a save against a character, `against: { who, isUser, attributeId,
  attribute, abbr, score, mod, prof }`, so the box and the verdict can show
  the formula. `dcSource: 'word' | 'character'`.
- The pending check, the game master's call store, the tool memo and the
  tool-call record carry `kind` and `against` the same way. Old records
  without `kind` read as checks; nothing migrates.
- Settings: none new. The AI-call switches cover saves too; a separate
  switch for saves is a non-goal.

### 10.3 Prompt

- `difficultyGuide(settings)`: judge the task and the circumstances, never
  the character (the roller's bonus is added afterwards); the five words
  with their configured DCs and the odds for a +0 and a +5 roll; Medium
  when unsure; circumstances move the call one step or give advantage or
  disadvantage, never both; a social check on someone who does not want to
  be moved starts at Hard; the reason names the one thing that could go
  wrong; the who-rolls rule and the save DC formula. A brief form for the
  per-turn instruction; the full form in the ruling call and the tool.
- The ruling call (a check the player tagged) may now answer with a save
  instead of a difficulty:
  `{"save": {"who": "Ines Arden", "attribute": "Charisma", "against":
  "Charisma"}, "advantage": "none", "reason": "…"}`; `against` is the
  player's ability that sets the DC. The call lists the NPCs on the shelf
  so the game master can name a target.
- End-of-reply forms: `[CHECK: …]` as before, and
  `[SAVE: Ines Arden: Charisma | vs Muzen's Charisma | reason]`,
  `[SAVE: Wisdom | Hard | the vision presses in]` (the player saves against
  the world), `[SAVE: Ines Arden: Dexterity | Medium | the floor gives way]`.
- The tool `dooms_roll_check` gains `kind` (check, the default, or save),
  `against` (the name of the character whose ability sets the DC; empty is
  the player) and `againstAttribute`; `difficulty` is then optional. One
  tool, not two: fewer tools in the prompt and one enum for the sheet.
- Verdicts. A save: "[DICE: Ines Arden makes a Charisma saving throw
  against Muzen's Charisma: DC 20 (8 + 2 proficiency + 10 Charisma). d20 =
  18, +0 (CHA 10) = 18 vs DC 20. FAILURE, narrowly (by 2). This roll is Ines
  Arden's: she does not resist, and Muzen's effect on her takes hold. This
  outcome is final: …]"; on a success, "she resists; Muzen's effect on her
  fails." An NPC's check now adds "This roll is Ines Arden's: it decides
  whether she succeeds at what the reason describes, nothing about Muzen's
  own attempt." The player's own checks keep their text.

### 10.4 Flow

- Player tags a check (popover) and sends. The ruling may come back as a
  save: DES looks up the target's sheet, sets the DC from the player's
  sheet, rolls the target's save, and writes the roll to the player's
  message (`kind: 'save'`, `who` the target, `isUser: false`, `against`
  the player). The box on the reply reads "Ines Arden: Charisma save vs
  Muzen's Charisma (DC 20)"; the verdict rides as before.
- A `[SAVE: …]` at the end of a reply: for an NPC, rolled on render like an
  NPC check, the DC from the player's sheet or the word; for the player, a
  pending save that rolls on send with no second ruling.
- The tool: resolved and rolled in code; the memo key includes the kind
  and the DC source, so the same call rolls once.

### 10.5 UI

Workshop → Attributes: a "Save" tick at the head of each attribute's skill
row ("Saving throw: proficient, +2"). The box, the notices and the chip say
"saving throw" and show the DC formula. Settings → Stats is unchanged.

### 10.6 Non-goals

Passive checks, contests of two rolls, death saves, concentration,
conditions, levels (the proficiency bonus stays one global number), a
separate switch for saves, per-chat sheets.

### 10.7 Files and tests

`src/utils/d20.js` (save keys and proficiency, `saveDC`, `kind` on rolls,
`difficultyGuide`, the rating prompt and its parser, the SAVE tag parser,
`resolveCheckCall` with `against`, the tool definition, the verdict text),
`tools/d20-test.mjs` §8; `src/systems/features/diceRolls.js` (the ruling
flow, `checkFromCall`, the NPC roll store, the tool action and memo, the
card and notices), `tools/dice-test.mjs` §10; `src/systems/ui/attributesPane.js`
(the Save tick), `src/systems/ui/dicePanel.js` (chip wording); docs and
`docs/parity-checklist.md` rows "Saving throws".

### 10.8 Commits

1. This section; the phases table row.
2. The model and its tests.
3. The lifecycle, the tool, the Workshop tick, the card; tests.
4. Parity rows, the phases doc, the handover.

---

## 11. Phase 4b — Tiers and NPC sheets

Status: **built on `Project-Short-Fuse` (`bc48864` design, `e079ccf`
model, `734b0c2` lifecycle, 2026-10-11); awaiting in-browser
verification (parity rows "Tiers").**

The owner's ask: "we need a way to set NPC's stats away from all 10s. But
there needs to be a scale to it: Legends should have really good stats,
like Muzen's 30 Charisma, but people like Ines should have normal human
stats." Decisions: **D18** the five-tier scale below; **D19** three ways
to fill a sheet, all three built: by tier in the Workshop, by one small
AI call from the Workshop, and automatically for new characters behind a
switch that is off by default; **D20** the tier word goes to the AI in
the attributes line; **D21** the ranges guide and warn, they never cap.

### 11.1 The scale

| Tier | Range | Standard array | Means |
| --- | --- | --- | --- |
| Ordinary | 8–12 | 12, 11, 10, 10, 9, 8 | most people; Ines |
| Trained | 10–14 | 14, 13, 12, 11, 10, 10 | good at their trade |
| Exceptional | 12–17 | 17, 15, 14, 13, 12, 12 | the best in a city; a field Master |
| Heroic | 15–20 | 20, 18, 17, 16, 15, 15 | the best alive |
| Legend | 18–30 | 30, 26, 24, 22, 20, 18 | beyond human; a Servant, Muzen |

A tier is one word on the sheet. Any score may still be typed; the
Workshop marks a score outside the tier's range and says which range, and
that is all a range does. The difficulty guide is unchanged: a DC is about
the task, never the tier.

### 11.2 Data model

- The tier rides in the sheet's proficiency list as the flag `tier:<id>`,
  the same way the casting ability does (`cha:casting`), so it follows the
  sheet through copies, campaign versions and pruning with no new plumbing.
  One per sheet; `withTier` replaces it.
- A sheet the AI filled without the owner looking carries `mark:suggested`
  until the owner changes anything on it in the Workshop; the tab shows a
  badge while it is there. "tier" and "mark" are reserved: an attribute
  that would take either id is given `attr_` in front.
- Settings → Stats → Attributes & checks: "Send the tier to the AI" (on) and
  "Suggest stats for new characters automatically" (off).

### 11.3 Three ways to fill a sheet

1. **Fill by tier.** The tier's standard array laid over the attributes
   in the order of the current scores (ties by list order), so a sheet
   that already favours Charisma keeps favouring it; an all-10 sheet gets
   the array in list order. No request.
2. **Suggest from the story.** One small call, the ruling call's size: the
   character's card text (the Workshop description and appearance), the
   recent scene, the attribute list and the scale. The AI answers with a
   tier, six scores and a few words each. The pane fills, the changed
   boxes are marked, nothing is kept until Save.
3. **Automatically for new characters.** When a fresh reply's tracker
   block names a character who has no sheet and no tier, DES asks once
   (per session, per name), stores the answer with `mark:suggested`, and
   says so in a notice. The persona is never touched; a failed call is not
   retried that session. Off by default.

### 11.4 Prompt

- `buildAttributesLine` gains the tier: "Ines Arden, Ordinary: …" and a
  character with a tier but default scores is still listed ("Ines Arden,
  Ordinary."), so the game master knows the shape of the cast without the
  numbers.
- `buildSheetSuggestionPrompt`: who the character is, the scale with its
  ranges and meanings, the attributes; answer with ONE JSON line
  `{"tier": "<word>", "scores": {"Strength": 11, …}, "reasons": {"Strength":
  "…"}}`. `parseSheetSuggestion` reads the tier word (label or id), clamps
  scores to 1–30, ignores unknown attributes, tolerates missing reasons.

### 11.5 UI

Workshop → Attributes: a Tier row above the grid (select, Fill by tier,
Suggest from the story, the suggested badge); a score box outside the
tier's range gets an amber border and a title with the range. Settings
gains the two switches. Notices: "Suggested stats for Ines Arden:
Ordinary" on an automatic fill.

### 11.6 Non-goals

Levels, hit points, monster stat blocks, per-chat sheets, bulk suggestion
for everyone on the roster (one button per character is enough for now).

### 11.7 Files and tests

`src/utils/d20.js` (TIERS, tier and mark flags, fillByTier, the
suggestion prompt and parser, the attributes line, config), `tools/d20-test.mjs`
§9; `src/systems/features/sheetSuggest.js` (the call, the apply, the
automatic trigger), `tools/sheet-suggest-test.mjs`; `src/systems/features/diceRolls.js`
(recentChatText exported); `src/systems/integration/sillytavern.js` (the
trigger after a fresh reply parses); `src/systems/ui/attributesPane.js`,
`src/systems/ui/characterWorkshop.js` (card text to the pane);
`template.html`, `index.js`, the stylesheet; docs and parity rows "Tiers".

### 11.8 Commits

1. This section; the phases table row.
2. The model and its tests.
3. The suggestion module, the trigger, the Workshop, the switches; tests.
4. Parity rows, the phases doc, the handover.

---

## 12. Phase 4c — Casting checks and talents (freeform magic)

Status: **built on `Project-Short-Fuse` (`7ce9335` design, `4f1e2cd` model, `9dddb03` lifecycle, 2026-10-11); awaiting in-browser verification (parity rows "Casting checks" and "Talents").**

The owner's ask: "how should we handle spell casting? This is roleplay, so
I don't want to lock the player into the D&D spell casting system, but I
do want to keep the spell casting modifier and spell saves. How do we set
the player up with spell functions without feeling restrictive?"

Decisions: **D22** no spell list, no slots, no levels: the player writes
what their character does and the game master picks one of three
resolutions (§12.1). **D23** a casting check is the casting ability with
proficiency, D&D's spell attack bonus turned into a check against a
difficulty, because prose fights have no armour class to attack. **D24**
talents are an optional free-text list on the sheet with two levels,
Practised and Master; a Master talent gives advantage on casting checks
and never moves the save DC, so a Legend's Charisma does the work it does
today. **D25** magic outside the listed talents is allowed at no
proficiency, never refused by the rules; an empty list means the game
master judges from the card, which is what happens now. **D26** no
resource track: the narration carries the price of magic; a Strain vital
is the lever later if fights ever feel free. **D27** a character with no
casting ability who is called for a casting check casts with Charisma
(the first casting candidate when the list has no Charisma), unpractised.

### 12.1 The three resolutions

| The act | Who rolls | Against |
| --- | --- | --- |
| Done to someone who can resist (reading a mind, a compulsion, a curse) | The target saves (§10) | The caster's spell save DC: 8 + proficiency + casting modifier |
| Contending with the world (a ward, a storm, a working held while hurt, a reach across a city) | The caster makes a casting check: d20 + casting modifier + proficiency | A DC from the difficulty table |
| Nothing pushes back | Nobody | It just happens |

Holding a working through harm is a Constitution save, as the 2024 rules
make it; the guide names it, nothing tracks it.

### 12.2 Data model

- A casting check is the skill "Casting" on the casting ability. The
  proficiency is the existing key `cha:casting`: `isProficient(prof, 'cha',
  'Casting')` is true exactly when Charisma is the casting ability, so no
  new key and no new switch. It is called as `[CHECK: Casting | Hard | the
  ward is old]`, `[CHECK: Muzen: Casting | …]`, `Charisma (Casting)`, or the
  tool with attribute `Casting`. `resolveCheckCall` marks a bare Casting
  with `castingCheck: true` and no attribute; the lifecycle fills the
  attribute from the roller's sheet (D27) before anything rolls.
- Talents ride in `_prof` as `talent:<level>:<name>` (`talent:master:Telepathy`,
  `talent:practised:Blood-binding`): the name as typed, up to 32
  characters, one entry per name; "talent" joins the reserved prefixes.
  `pruneProficiencies` keeps a well-formed talent. They follow the sheet
  through copies, campaign versions and the suggested mark like the tier.
- Settings: none new.

### 12.3 Prompt

- `buildAttributesLine`: "casting ability Charisma (save DC 20, casting
  check +12)" instead of the hint, so the game master no longer does the
  arithmetic; then "talents: Telepathy (Master), Blood-binding" when any.
- `difficultyGuide`, both forms, after the who-rolls rule: "Magic and
  powers: done to someone who can resist, that someone saves against the
  caster's DC as above; contending with the world (a ward, a storm, a
  working held while hurt, a reach across a city), the caster makes a
  casting check, written Casting (their casting ability plus proficiency;
  advantage inside a Master talent on their sheet; outside their listed
  talents no proficiency, but never refused); nothing resisting, no roll.
  Holding a working through harm is a Constitution save."
- The tag instruction gains the Casting example; the tool's `attribute`
  enum gains `Casting`, and its description says what it is.
- The ruling call is unchanged beyond the guide: a tagged Casting check is
  rated like any check, or turned into the target's save when the attempt
  works on someone.

### 12.4 Flow

- Player: the popover shows a Casting chip under the casting ability, with
  the proficiency badge; tag, send, ruled and rolled like any check.
  `tagCheck` accepts the Casting skill when the attribute is the persona's
  casting ability.
- Game master: the tag or the tool; `checkFromCall` fills the ability for a
  bare Casting and reads the proficiency from the casting key.
- Verdicts and cards read "Charisma (Casting) check"; nothing else new.

### 12.5 UI

Workshop → Attributes: the lit Casting chip gains a readout, "DC 20 ·
check +12", that follows the score as it is typed; a Talents row under
the grid (a name box and Add, chips with a star to make a talent Master
and a cross to remove it). The popover gains the Casting chip.

### 12.6 Non-goals

Spell lists, slots, levels, components, concentration tracking, a strain
vital, per-talent DCs or bonuses, talents for anything but magic.

### 12.7 Files and tests

`src/utils/d20.js` (the Casting skill, talents, the attributes line, the
guide, `resolveCheckCall`, the instructions and the tool definition),
`tools/d20-test.mjs` §10; `src/systems/features/diceRolls.js` (`tagCheck`,
`checkFromCall`), `tools/dice-test.mjs` §11; `src/systems/ui/dicePanel.js`
(the chip), `src/systems/ui/attributesPane.js` (the readout, the Talents
row), the stylesheet; docs and `docs/parity-checklist.md` rows "Casting
checks" and "Talents".

### 12.8 Commits

1. This section; the phases table row.
2. The model and its tests.
3. The lifecycle, the popover chip, the Workshop readout and Talents row;
   tests.
4. Parity rows, the phases doc, the handover.

### 12.9 What the stats features cost per turn (measured 2026-10-11)

With Jordan's settings (six sheets, tiers on, scores always sent, tool
calling live on the Claude source), estimated at four characters a token:

| Piece | Tokens | When |
| --- | --- | --- |
| Attributes line | ~290 | every turn |
| CHECKS instruction, tool form | ~490 | every turn |
| Tool schema (`dooms_roll_check`), of which the full guide ~415 | ~1,100 | every turn, tools live |
| Verdict and the shape reminder | ~140 | a turn with a roll |
| Ruling call | ~1,700 | a tagged check, with "AI rates difficulty" on (off in Jordan's) |
| Sheet suggestion | ~1,700 | once per new character, automatic switch on |

About 1,900 tokens a turn against a tracker block of about 520 and a chat
of about 120,000, so under two per cent of the prompt. A turn where the
tool fires costs a second request's input, less with caching. The one
duplicate is the full guide inside the tool schema while the instruction
carries the brief one; dropping it would save about 400 a turn.

## 13. Phase 5 — Inventory and the shelf's pages

Status: **built on `Project-Short-Fuse` (`0c28e59` model, `4a44abb` store,
tag and tool, `60b0ab0` settings, `c59b43b` shelf pages, 2026-10-17);
awaiting in-browser verification (parity rows "Inventory").**

The owner's ask: "I want to add an inventory system to this and a way for
the present characters panel to flip and show inventory and quests", and,
on the flip: "I want it to switch to an entirely new UI and not have
character cards anymore but boxes with stuff in them". Built in one
sitting, inventory first, each stage pushed to the branch.

Decisions: **D28** the persona carries a pack and the party shares one
pouch; NPCs carry nothing the system tracks (what a guard has is the
story's business until it changes hands). **D29** the AI changes the
inventory the way it calls for checks: a tag at the end of its reply,
`[ITEM: +1 iron key (from the warden's desk) | -1 torch | pouch +3 silver
coins]`, or the `dooms_inventory` function tool where the API can call
tools; never through the tracker JSON, and it never rewrites the list: it
is told what is carried in one read-only line, says what changed, and the
code applies it. **D30** an item is a name, a count and an optional note;
the icon is DES's pick from the name (about eighty rules, fantasy and
modern) and editable by hand. **D31** a container is a set number of
slots, one per kind of item, counts free: 16 for the pack and 8 for the
pouch by default, 1 to 64 in Settings; a full container turns a new kind
away and the AI is told so. **D32** the Present Characters shelf flips
between three pages, Characters, Inventory and Quests, from a three-way
control in its header; the other two pages are boxes, not cards, and the
Quests page edits the existing quest data in place. **D33** off by
default; while on, the inventory line rides every generation (a switch),
the AI may change it both ways (a switch each), and a toast says what
changed (a switch). **D34** the shelf's page control shows only while the
inventory is on, so a default install's shelf is unchanged; the Quests
page rides with it (open: whether Quests should stand on its own).

### 13.1 Data model

`chat_metadata.dooms_inventory = { v: 1, pack: [stack], pouch: [stack] }`,
a stack being `{ name, count, note, icon }`; its own key, because
`persistence.saveChatData` rebuilds `dooms_tracker` from a whitelist.
Identity is the name, lower-cased with spaces collapsed; duplicates merge
on load, spent stacks (count 0 or less) drop, and nothing is dropped for
being past the slot count (the shelf marks the overflow and no new kind
fits until it clears).

What a reply changed lives on the message itself,
`message.dooms_inventory = { live, swipes: { [swipeId]: { sig, tag, tool,
applied, rejected } } }`, not under `message.extra`: SillyTavern swaps a
reply's `extra` with each swipe, and the record has to outlive the swipe
it was made on so the next one can put its changes back. Each applied
change records the stack before and after, its slot and its delta. The
player's message carries the turn's tool outcomes, `{ tool: [{ key,
changes, applied, rejected, text, attached }] }`, until a reply claims
them.

The rules: `extensionSettings.inventory = { enabled, packSlots, pouchSlots,
tellTheAI, notify, aiChanges: { enabled, endOfReply, tool } }`
(`inventoryConfig` normalises on every read).

### 13.2 The tag and the tool

The tag: `[ITEM: ...]` or `[ITEMS: ...]`, entries split by `|`. An entry
is an optional container word (`pouch`, `party pouch`, `the pouch`,
`pack`; "pack of cards" and a bare "pouch" are items), a sign with an
optional count (`+1`, `-`, the Unicode minus and the en dash too) or a
verb (gains, takes, found, picks up, buys … add; uses, drops, sold, spent,
hands over … remove), the name, an optional `×2` or `x2`, and a note in
parentheses; `+2x arrows`, `2x arrows` and "the party's shared pouch"
read as meant; articles and trailing periods are dropped; a placeholder
("none", "no change", "N/A", a dash) is no item; at most eight entries per
tag. The shown reply gets a line in place of the tag,
"🎒 +1 iron key (pack) · −1 torch (pack) · +3 silver coins (pouch)", with
what would not fit.

The tool: `dooms_inventory({ changes: [{ container, action, item, count,
note }], reason })`, a draft-04 schema, `shouldRegister` tied to the
switches, re-registered when the slots or the persona change. Its answer
names what was recorded and ends with the shape reminder
(`STILL_REQUIRED_ITEMS`), for the reason the dice verdict does.

### 13.3 Lifecycle

- **A reply renders** (CHARACTER_MESSAGE_RENDERED, MESSAGE_SWIPED,
  MESSAGE_UPDATED): the tag is parsed and applied once for its swipe; the
  record remembers the tag's signature. Rendering again applies nothing
  twice.
- **Another swipe shows**: the live swipe's changes go back first; a swipe
  seen before has its own applied again, against whatever the state is
  now (a hand edit made in between stays).
- **An edit** that changes the tag counts as a new reply; a tag edited
  away puts everything back.
- **The tool**: applied as the model calls it; the same call again in the
  same turn is kept, not applied twice; the outcome waits on the player's
  message until the next reply claims it, after which the reply's swipe
  owns it like a tag and a swipe puts it back too. Deleting the player's
  message before a reply arrives puts an unclaimed outcome back.
- **A deleted message** (MESSAGE_DELETED names no index): a ledger of
  messages whose changes are in the state is checked against the chat;
  the ones gone give their changes back.
- **Revert is share-only**: a stack nothing moved since is restored
  exactly (slot, note, icon); one that later changes touched gives up only
  this change's share of the count, so undoing an older reply leaves the
  newer ones standing.
- **A swipe still generating**: SillyTavern moves `swipe_id` past the
  swipes it holds while `mes` still carries the old text, then generates.
  Nothing is read or claimed for it; the swipe before gives its changes
  back and the real text applies once CHARACTER_MESSAGE_RENDERED brings it.
- **Regenerate** deletes the reply after GENERATION_STARTED has set the
  slots, so MESSAGE_DELETED re-injects them after the revert, before the
  prompt is built.
- **A branch, a checkpoint, an import**: the stored state names its chat;
  a chat that arrives with another chat's metadata loads the snapshot on
  its last message (every commit stamps the state on the chat's tail) and
  takes the state over as its own.
- **Off**: with the inventory off, or AI changes off, a re-render neither
  applies nor puts back.

### 13.4 Prompt

Two slots beside the dice slots at the tracker instructions' depth and
role (`dooms-inventory-line`, `dooms-inventory-rules`); their keys sort
between the dice keys and `dooms-tracker-inject`, which still ends the
message. Both are empty while the inventory is off: a default install's
prompt is byte-identical (`tools/tracker-prompt-test.mjs` pins the
tracker; `tools/inventory-flow-test.mjs` §2 pins the slots).

The line: `[INVENTORY: Jordan's pack 5/16: rope ×2, torch, iron key (opens
the cell); party pouch 1/8: silver coins ×3. Read-only here: say what
changes, never rewrite the list.]`; notes go first when it runs past 700
characters. The rules: the tool instruction when the tool is on and the
API can call tools, else the tag form; both say to record only what the
story showed, never to list what is carried, that most replies change
nothing, and that a full container turns a new kind away.

Cost, measured 2026-10-17 at four characters a token:

| Piece | Tokens | When |
| --- | --- | --- |
| Inventory line, 11 stacks, three with notes | ~73 | every turn while Tell the AI is on |
| Inventory line, empty | ~30 | the same |
| ITEMS instruction, tag form | ~213 | every turn, tools not live |
| ITEMS instruction, tool form | ~152 | every turn, tools live |
| Tool schema (`dooms_inventory`) | ~383 | every turn, tools live |

About 286 tokens a turn without tools and about 608 with them, on top of the
stats features' ~1,900 (§12.9).

### 13.5 UI

Settings → Stats → Inventory (a Beta badge, a rail tab of its own): the
switch; Slots (pack, pouch); The AI (Tell the AI what is carried; The AI
may change it, with the line and the tool beneath); Debugging (Notify on
inventory events). Rows dim under their masters.

The shelf: a three-way control in the header (Characters | Inventory |
Quests; the Classic strip's label follows), the page remembered on this
browser. Inventory: the pack, then the party pouch, each a grid of square
slots: icon, a count badge past one, the name beneath, a dot when there
is a note (the note in the tooltip), dashed empties, a dotted mark past a
lowered slot count, `n/slots` in the section head. A slot opens a small
editor by it: name, count, note, the icon (Auto from the name, or the
emoji picker), Move n to the other container, Remove; an empty slot adds,
and adding a kind already carried adds to it. Quests: the main quest as a
box of its own and the optional quests as boxes, each edited in place
(Enter saves, Escape cancels), a tick to complete, an add box for each
list; the same save and sync as the sidebar's quest panel, which repaints
the page when it changes the data. Styles for Classic and the five looks,
the docks and phone widths.

### 13.6 Non-goals

NPC inventories; weight or encumbrance; item effects on checks or vitals;
currency as a number; drag and drop between containers (Move in the
editor instead); the AI reading the Quests page (it reads the quests the
tracker already carries).

### 13.7 Files and tests

`src/utils/inventory.js` (pure: the rules, items and icons, state, changes
and their revert, hand edits, the tag grammar, the tool definition, the
prompt texts), `tools/inventory-test.mjs` (213 checks);
`src/systems/features/inventory.js` (the store, the reply and tool
lifecycle, the slots, hand edits, notices), `tools/inventory-flow-test.mjs`
(the whole flow in the load-check sandbox, and the pages' markup);
`src/systems/generation/injector.js` (the slots); `index.js` (events,
Stats handlers); `template.html`; `src/core/state.js`;
`src/systems/ui/shelfPages.js` (lazy; `tools/lazy-graph-test.mjs` pins
it), `src/systems/ui/portraitBar.js` (the control and the page
container), `src/systems/rendering/quests.js` (`syncQuestsToCommittedData`
exported, `dooms:quests-rendered`); `style.css`, `styles/overhaul.css`,
`styles/modals.css`.

### 13.8 Commits

1. `0c28e59` the model and its tests.
2. `4a44abb` the store, the tag and the tool; the slots; the flow test.
3. `60b0ab0` the settings group.
4. `c59b43b` the shelf's pages.
5. This section, the phases row, the parity rows, the handover.

### 13.9 Open

Whether the Quests page should show without the inventory (D34); whether
models obey "most replies change nothing" or sprinkle tags (the notify
toasts will tell); a second tool call in the same turn that corrects the
first (today both apply); drag and drop; whether the AI should know the
party pouch's members by name (today "the party").

## 14. Phase 5b — Cut to a quest

Status: **built on `Project-Short-Fuse` (2026-10-17, the same sitting as
Phase 5); awaiting in-browser verification (parity rows "Cut to a
quest").**

The owner's ask: "I want the user to be able to right click a quest and
say 'Lets start' or something. I want that to send a command to the AI to
move the story to the beginning of the quest and summarize everything
that happened in between."

Decisions: **D35** nothing of the player's shows in the chat: the button
press alone arms the cut and asks SillyTavern for a reply; the instruction
rides that generation. **D36** the reply is the montage and the opening
beat: a paragraph or two of what passes between now and the moment the
quest begins, told in summary, then the quest's first scene at its
threshold with the first move left to the player; never the quest itself.
**D37** the quest becomes the main quest and the main quest it displaces
drops to the top of the optional list (the main quest itself changes
nothing). **D38** how much time passes is the AI's to judge from the
quest, with "Cut to it, when…" for a time the player names ("by
nightfall", "after the thaw").

### 14.1 Data

`chat_metadata.dooms_quest_cut = { quest, when, at, facts }` while a cut
is armed; it survives a reload mid-montage. The facts of now are captured
when the cut is armed, so a swipe of the montage starts from the same now
and not from where the first montage landed. A cut puts two replies in a
row, which the together-mode commit at GENERATION_STARTED used to read as
"no new message": it is decided from the generation's type now (a send, a
/trigger or a Continue commits; a swipe, a regenerate, an impersonation or
a quiet prompt does not), so the quest's opening turn sees the montage's
block as the previous one. The cut stays armed through
swipes and regenerates of the montage (each gets the same instruction)
and ends with the player's next message (MESSAGE_SENT clears it before
the slots are re-set for that generation). No settings: the menu is
there whenever the shelf's Quests page is.

### 14.2 Prompt

One slot, `dooms-quest-cut`, beside the dice and inventory slots at the
tracker instructions' depth and role (its key sorts after the inventory
keys and before `dooms-tracker-again`, so the tracker instructions still
end the message). `[CUT TO A QUEST: Jordan has chosen to skip ahead to
this quest: "…". This reply is the cut. First, a brief montage … from now
(<date>, <time>, at <location>) until the moment this quest begins … told
in summary and never played out. <It begins <when>. | How much time
passes is yours to judge …> Then open on the quest's first scene at its
threshold … stop with the first move still Jordan's. Do not play the
quest or resolve any part of it in this reply. The other quests (…) stay
as they are … the tracker data block … still follow as usual, with the
date, time and location moved to where the cut lands and what Jordan
carries kept consistent with the skip.]` About 230 tokens, once.

The facts of now come from the info box (`lastGeneratedData.infoBox`,
else the committed one), in its JSON form (strings or `{ value }`
objects, time as "start → end" or `{ start, end }`, fenced or not) or the
older text form; missing facts are left out rather than guessed. The
tracker block the reply writes moves the date, time and place; the
inventory and vitals follow if the montage spends or gains anything.

### 14.3 UI

Right-click a quest box on the shelf's Quests page, or hold it on a
phone: Cut to it, Cut to it when… (a small dialog with one field), Make
it the main quest (not on the main quest), Complete. A toast says
"Cutting to …" while the reply generates. The reply is asked for with
SillyTavern's `/trigger`, so a group chat picks its speaker as it would
for any reply without a message.

### 14.4 Files and tests

`src/utils/questCut.js` (pure: the quest list after a cut, the facts of
now, the instruction), `tools/quest-cut-test.mjs`;
`src/systems/features/questCut.js` (arm, slot text, trigger, the clear
on MESSAGE_SENT), `tools/quest-cut-flow-test.mjs`;
`src/systems/generation/injector.js` (the slot), `index.js`
(MESSAGE_SENT), `src/systems/ui/shelfPages.js` (the menu and the when
dialog), `style.css`, `styles/overhaul.css`.

### 14.5 Non-goals and open

Group chats: DES is not meant for them (Jordan, 2026-10-17, D39); a cut
sends a bare `/trigger`, and nothing is built or tested for a group.

Open: whether the montage should be allowed to touch the other quests
(today: "stay as they are unless the skip plainly touches them"); a cut
from the sidebar's Quests panel too (today the shelf only); a way to undo
a cut other than deleting the montage (deleting it ends nothing: the next
message ends the cut anyway).

## 15. Phase 6 — Live World

Status: **the groundwork, the pack, the per-chat state, the advancer and
the D1 dashboard are built on `Project-Short-Fuse` (2026-10-17, from
`docs/live-world-spec.md`, the owner's own spec); the map (C1–C3), the
dashboard's feed and timelines (D2, D3) are not; awaiting in-browser
verification (parity rows "Live World") and the Skyreach pack's real
content.**

The spec is the design source; this section records what was built
against it and the calls made on its open items.

Decisions on the spec's open items: **D40** the advancer runs every 6 new
replies by default (1 to 50 in Settings). **D41** a clock moves by at most
1 per run by default (1 to 6); a clock's own `step` in the pack wins.
**D42** "known" is a name the tracker lists as present (the Present
Characters block), not a speaker tag: it covers every model and format
the tracker already handles; the advancer's `heard` list and a newcomer
it moves are heard-of; a known name never drops back. **D43** the world
line rides at depth 2 as a system message by default (depth and role in
Settings), through SillyTavern's own `setExtensionPrompt`, so the Context
Inspector does not record it (G4). **D44** a message's identity is an id
stamped on the message itself (`dooms_world_id`), never its index; a
swipe keeps it, so it counts once (G3). **D45** built-in packs live in the
repository's `worldpacks/` (read-only; an update may overwrite them) and
pasted packs in Settings (`liveWorld.customPacks`); a chat keeps the pack
it was seeded with, by id. **D46** the advancer's request runs on the
tracker's connection profile through `withBackgroundProfile` (G1), one
background request at a time; it waits for the tracker request when both
are due; external mode uses the external API. **D47** no time module: the
advancer judges elapsed story time from the tracker's date and time
against the last run's, as the spec says; the facts of now come from the
info box. **D48** the dashboard opens from Settings → Live World and from
`/world`; no rail button yet. **D49** Live World never toasts: the System
Log always, the console on request. **D50** the Skyreach pack is a draft
from the spec's own examples until the campaign notes fill it in.

### 15.1 Data

The pack (`worldpacks/<id>.json`, or pasted): `{ id, name, version,
description, places: [{ id, label, parent, image, zoom, x, y }], clocks:
[{ id, label, start, max, step, effects: { value: text }, hidden }], cast:
[{ name, place, tier, portrait }], template, blurb }`. `normalizePack`
makes it safe and lists what is wrong: duplicate ids, parents that do not
exist, loops, clocks outside their range, cast members at no place.

The chat's state, `chat_metadata.dooms_world` (G2, its own key): `{ v,
pack, packVersion, clocks: { id: value }, where: { name: "a/b/c" },
known: { name: "heard" | "known" }, log: [{ who, from, to, msgId,
gameDate, gameTime, reason }], last: { msgId, gameDate, gameTime, ranAt,
ok, elapsed }, lastError, blurb, counted: [ids], sinceLast, retryNext,
seeded }`. The log keeps about 20 entries per character and 300 in all;
`counted` keeps the last 400 ids. Seeding copies the pack's starting
clocks, places and tiers.

The rules, `extensionSettings.liveWorld`: `{ enabled, pack, every,
maxStep, spoilerFree, inject, depth, role, recentMessages, debug,
customPacks }`.

### 15.2 The advancer (Part A)

Trigger: every `every` counted replies, at once after a failed run, from
`/advance`, Settings or the dashboard; never while DES is generating (the
flag `withBackgroundProfile` holds), and after the tracker request when
both are due. The prompt: the clocks with their current value, range,
step and the text of each step; the place tree (ids with labels, nested);
who is where and whether known; the last run's date and time and now's;
the last `recentMessages` messages as "Name: text" with tracker blocks
and tags stripped; the exact JSON asked for: `{ elapsed, clocks, moved:
[{ who, to, reason }], blurb, heard }`. Spoiler-free adds that the blurb
is common knowledge only.

The reply is parsed (bare, fenced or inside prose) and validated whole:
clocks are integers within range that move by at most the step, and
name real clocks; moves name someone and a place of the tree (id, path or
label); heard-of names are strings. Any failure discards the reply,
records why, and the very next reply runs it again. A pass overwrites the
clocks, logs each move with the message and the date, adds heard-of
names, replaces the blurb and stamps the run.

Cost, measured 2026-10-17 at four characters a token with the example
pack: about 647 tokens for the prompt without the chat window, plus
the window (12 messages, each cut to 700 characters, at most ~2,100
tokens); the world line is about 88 tokens a turn. One background
request every six replies.

### 15.3 The line (Part B's injection)

`[WORLD OF HARBOURSIDE: clocks: The blockade 2/6: Cargo is searched on
the quay…; The dock fever 0/4. Last seen: Old Marit: The Anchor's back
room, The Anchor, a tavern (Thursday); Captain Reyes: The customs house,
The docks. The world moves between scenes; these are its facts as they
stand, not instructions to the scene.]` One line per clock that is not
hidden, one per known character; heard-of names, the log and the blurb
never ride; cut at 1,200 characters; a pack may give its own template
with `{name}`, `{clocks}` and `{where}`. Never for a quiet prompt, an
impersonation or a dry run; emptied when the world is off or `inject` is.

### 15.4 UI

Settings → Live World (Beta, its own rail page): the switch, the pack for
new chats (built-in and pasted), a box to paste a pack with Add and
Remove, Dashboard, Advance now, Re-seed this chat (confirmed), every N,
the step, the window, spoiler-free, the line with its depth and role,
console lines, and a status line for this chat. The dashboard (D1):
`src/systems/ui/worldDashboard.js`, §14.3 of this document's neighbour
describes the rest; in short the pack, the date, the blurb, the run
status, what people say, the known characters with portraits and
last-seen places, the heard-of chips, the recent moves, Advance now.

### 15.5 Not built yet

The map (C1 province node view, C2 nesting, C3 room grids and tokens
with Silly Map's pathfinding, credited); D2 the dashboard's feed with a
time filter; D3 timelines and map links; a pack editor; speaker-tag
detection for known characters if tracker presence proves too generous;
"seen N days ago" (the dates are prose, so the dashboard says "seen
<date>").

### 15.6 Files and tests

`src/utils/liveWorld.js` (pure), `tools/live-world-test.mjs` (84 checks);
`src/systems/features/liveWorld.js`, `tools/live-world-flow-test.mjs`;
`src/systems/generation/apiClient.js` (`withBackgroundProfile`,
`BACKGROUND_BUSY`); `src/systems/ui/worldDashboard.js` (lazy);
`worldpacks/example.json`, `worldpacks/skyreach.json`; `index.js`,
`template.html`, `src/core/state.js`, `styles/modals.css`,
`styles/overhaul.css`; `docs/live-world-spec.md`.

### 15.7 Commits

1. `6524ad1` the groundwork: `withBackgroundProfile`, the spec in the repo.
2. `b122cba` the model and two packs.
3. `f99d9b5` the store, the advancer, the line and the settings.
4. The dashboard.
5. This section, the phases row, the parity rows, the handover.

### 15.8 Open

The Skyreach pack's places, clocks and cast (D50); whether the known
tier should also come from speaker tags; whether the world line should
move to the tracker's depth and role for one message fewer in the
prompt; a shelf page for the world beside Characters, Inventory and
Quests (the owner fixed three pages; this would be a fourth); the map.
