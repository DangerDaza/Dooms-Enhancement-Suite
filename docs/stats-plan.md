# Stats — Project Short Fuse

Implementation plan for character stats in Doom's Enhancement Suite. Phase 1
(**Vitals**) is specified in full below; later phases are sketched at the end
so this file stays the roadmap for the whole feature.

Read `docs/rebuild-philosophy.md` first. Every rule in it applies here,
especially: the parser is the contract, pay for what you use, additive-only
storage, and the LLM is hardware.

---

## 0. Status and open decisions

Status: **plan, awaiting review. No code yet.**

Decisions needed before commit 2 (defaults) and commit 8 (settings labels):

| # | Question | Proposed default |
|---|---|---|
| D1 | Default vital set when the feature is switched on | Health, Energy, Satiety on; Hygiene, Morale, Mana, Arousal, Stamina, Sanity as one-click chips |
| D2 | Word for the bars in the UI | Settings page is **Stats**; the bars group inside it is **Vitals** (attributes join the same page in Phase 2) |
| D3 | Player vitals in Phase 1 | **Yes.** It is the RPG Companion "User Stats" people remember, and it is the one piece that needs a new tracker key (§3.4) |
| D4 | Release number and name | 3.1.0, name open |

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
    { id: 'health', name: 'Health', enabled: true,
      color: '#e5484d', icon: '❤️', start: 100, ai: true },
    { id: 'energy', name: 'Energy', enabled: true,
      color: '#f5b301', icon: '⚡', start: 100, ai: true },
    { id: 'satiety', name: 'Satiety', enabled: true,
      color: '#2fbf71', icon: '🍖', start: 80, ai: true },
  ],
  player: { enabled: false },     // new: the persona gets vitals too
  showOnCards: true,              // new: bars on the card front
  maxBars: 3,                     // new: front shows the first N enabled
  lowAt: 25,                      // new: at or below → warning colour
  persistInHistory: false,        // new: include in History Persistence
};
```

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
- If `enabled === false` **and** the list is exactly the old untouched default
  (`health`, `arousal`), replace it with the D1 default. A list the user ever
  edited is left alone.

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

## 7. Later phases (sketch)

**Phase 2 — Attributes and dice (player-triggered).** Six attributes (or
custom) per character on the same Stats page and a Workshop tab; D&D scale
with modifier `floor((score − 10) / 2)`; a roller using
`crypto.getRandomValues`; the player picks the attribute and a DC (or a
difficulty word mapped to 10/15/20/25); DES resolves and injects a final
verdict with the user's message; a roll card in chat; roll log per message in
`message.extra`. Attributes go to the AI as one read-only line per character,
never in the per-reply JSON.

**Phase 3 — AI-called checks.** A `check` request in the tracker JSON with a
difficulty word, "end the reply at the attempt", DES rolls and auto-continues
with the verdict. Behind a toggle; Phase 2 remains the fallback.

**Phase 4 — if wanted.** Skills and proficiency, advantage, contested rolls,
levels. Borrow from PR #38 where it fits, with credit.

---

## 8. Open questions log

- D1–D4 above.
- Should fixed vitals also be lockable per character from the card back (a
  padlock like the legacy panel has)? Cheap to add in commit 6; default no
  until asked.
