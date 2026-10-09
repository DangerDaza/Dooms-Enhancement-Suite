# Stats — Project Short Fuse

Implementation plan for character stats in Doom's Enhancement Suite. Phase 1
(**Vitals**) is specified in full below; later phases are sketched at the end
so this file stays the roadmap for the whole feature.

Read `docs/rebuild-philosophy.md` first. Every rule in it applies here,
especially: the parser is the contract, pay for what you use, additive-only
storage, and the LLM is hardware.

---

## 0. Status and open decisions

Status: **Phase 1 (commits 2–8) and Phase 2 (commits 10–16) built on branch
`Project-Short-Fuse`; awaiting in-browser verification (the Vitals rows and the
Attributes and dice rows in `docs/parity-checklist.md`).** Not released: commit 9
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

## 8. Phase 3 — AI-called checks (sketch)

A `check` request in the tracker JSON with a difficulty word, "end the reply
at the attempt", DES rolls and auto-continues with the verdict. Behind a
toggle; Phase 2 remains the fallback.

**Phase 4 — if wanted.** Skills and proficiency, contested rolls,
levels. Borrow from PR #38 where it fits, with credit.

---

## 9. Open questions log

- D1–D4 above.
- Should fixed vitals also be lockable per character from the card back (a
  padlock like the legacy panel has)? Cheap to add in commit 6; default no
  until asked.
