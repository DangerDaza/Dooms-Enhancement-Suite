# Tracker Customization — Implementation Plan

**Goal (user request):** let users *edit the tracker prompt* and *add custom things to the
tracker*, and *overhaul the Scene Tracker options menu* to fit it.

---

## 0. What already exists (read this first)

A meaningful share of this feature is already built. Any plan that rebuilds it is worse than
no plan, so here is the ground truth as of `2.4.2`.

### 0.1 The format specification is already generated from config

`src/systems/generation/jsonPromptHelpers.js` builds the JSON schema the AI is asked to fill:

| Builder | Emits |
|---|---|
| `buildInfoBoxJSONInstruction()` (:87) | scene block — built-in widgets + **custom scene fields** |
| `buildCharactersJSONInstruction()` (:178) | character block — custom fields, character stats, relationships, thoughts |
| quests equivalent | quest block |

It already honours `compactPrompts`, the Doom Counter's `doomTension`, and per-widget
`enabled`. **Adding a field in the Tracker Editor really does change the prompt.**

### 0.2 Custom fields already exist — in two of three sections

- `trackerConfig.infoBox.customFields[]` — custom **scene** fields. Editor UI exists
  ("Add Custom Field", `trackerEditor.js:715`). Flows to prompt (`getCustomSceneFields()`,
  `jsonPromptHelpers.js:45`), to the scene header, and to history persistence.
- `trackerConfig.presentCharacters.customFields[]` + `characterStats.customStats[]` —
  custom **character** fields/stats. Editor UI exists (`trackerEditor.js:829`).
- **Quests has none.**

Each custom field carries `{ id, name, description, icon, enabled, persistInHistory }`.
The `description` *is* the prompt text for that field — so per-field prompt editing already
half-exists for custom fields, and not at all for built-ins.

### 0.3 Prompt editing exists, but stops at the instruction text

The Prompts Editor exposes 14 prompts including **Tracker Instructions**
(`customTrackerInstructionsPrompt`). Its own hint states the limit:

> "Instruction portion only (**format specification is hardcoded**)."

So today a user can change the *guidance* but cannot change the *shape*: no renaming keys,
no reordering, no new top-level block, no editing a built-in field's wording.

### 0.4 Two UIs edit overlapping state

- Settings → **Scene Tracker** accordion (`template.html:764`–~1000): "Visible Fields"
  toggles (Time/Date/Location/…), layout, colours, position.
- **Tracker Editor** modal (`template.html:1794`): tabs `infoBox` / `presentCharacters` /
  `historyPersistence`, with the same widget enable flags plus descriptions and custom fields.

These already drifted once — 2.2.0 shipped a fix titled *"Scene Tracker core toggles now
sync between the settings panel and the Tracker Editor"*. Two writers over one state is the
structural reason this keeps happening, and it is squarely part of the requested overhaul.

### 0.5 Presets already carry tracker config

`extensionSettings.presetManager` stores `trackerConfig` presets with per-character/group
association. Anything added to `trackerConfig` is inherited by presets — and by preset
**export/import**, so schema changes must stay backward compatible.

---

## 1. What's actually missing

Re-framing the request against §0, the real gaps are:

| # | Gap | Why users feel it |
|---|---|---|
| G1 | **Discoverability.** Custom fields live behind a modal most users never open. | "You can't add custom things" — you can, invisibly. |
| G2 | **No custom *sections*.** Only fields inside two fixed blocks. | Users want a *Party Inventory*, *Faction Standing*, *Combat* block. |
| G3 | **Built-in field wording is uneditable.** | "Let me change how the AI is told to write Location." |
| G4 | **Fields are untyped** — everything is free text. | No numbers, enums, lists, or bars; no validation. |
| G5 | **No raw format access.** | Power users want to hand-write the schema. |
| G6 | **No preview.** Nobody can see what the tracker prompt becomes. | Editing blind. |
| G7 | **Quests can't be customized.** | Third section left out. |
| G8 | **Two hand-maintained UIs over one state** (§0.4) — and the accordion's toggles are hardcoded, so custom fields can never appear there. | Drifts (fixed once already); custom fields get no quick toggle. |

---

## 2. Design

### 2.1 Field descriptor (unifies built-ins and custom)

Promote every tracker field — built-in or user-made — to one descriptor shape:

```js
{
  id: 'location',            // stable key; JSON key emitted to the AI
  name: 'Location',          // UI label + render label
  icon: '📍',
  enabled: true,
  builtin: true,             // built-ins can be disabled/reworded, never deleted
  type: 'text',              // text | number | enum | list | boolean | progress
  options: [],               // enum choices
  min: 0, max: 100,          // number/progress bounds
  prompt: 'Where the scene is taking place',   // ← the editable prompt text (G3)
  promptDefault: '…',        // for Restore Default, and so shipped wording can improve
  persistInHistory: false,
  showInHeader: true,        // render targets
}
```

Built-ins migrate into this shape with `builtin: true` and their current hardcoded strings as
`prompt`/`promptDefault`. `jsonPromptHelpers` then has **one** emitter per type instead of a
hand-written `if` per widget — this is what makes G3 and G4 fall out for free.

### 2.2 Custom sections (G2)

```js
trackerConfig.customSections = [
  { id: 'party_inventory', name: 'Party Inventory', icon: '🎒', enabled: true,
    shape: 'object' | 'list',      // one record, or an array of records
    fields: [ …field descriptors… ],
    render: 'sceneHeader' | 'panel' | 'none',
    persistInHistory: false }
]
```

Each becomes a top-level key in the tracker JSON alongside `infoBox` / `characters` / `quests`.

**This is the phase with real blast radius.** A new top-level key has to be threaded through:

1. **Prompt** — new `buildCustomSectionsJSONInstruction()` in `jsonPromptHelpers.js`.
2. **Parse** — `parseResponse` must keep unknown/custom keys instead of dropping them.
3. **State** — `lastGeneratedData.custom` + `committedTrackerData.custom`.
4. **Per-swipe storage** — `message.extra.dooms_tracker_swipes[id].custom`.
5. **Per-chat persistence** — ⚠️ `saveChatData()` rebuilds `chat_metadata.dooms_tracker`
   **wholesale**; new keys must nest inside preserved keys or they vanish on reload. This
   exact hazard has bitten this codebase before.
6. **Render** — scene header (**all six layouts**: grid/stacked/compact/banner/HUD/ticker),
   plus the Tracker Data dropdown, which gets it free.
7. **History persistence** — `persistInHistory` handling in `promptBuilder.js`.
8. **Locks** — `lockManager` key namespace.
9. **Presets** — export/import round-trip.

### 2.3 Editing the prompt that creates the tracker (G3, G5, G6)

**Decision: users get the real thing — the actual prompt, editable, in one box.**

What DES sends today is two pieces glued together, and only the first is editable:

```
[ instruction text ]   ← editable now (customTrackerInstructionsPrompt)
[ format spec      ]   ← generated from config, NOT editable  ← the thing people want
```

The plan exposes both in one **Tracker Prompt** editor: a single textarea pre-filled with the
fully assembled prompt exactly as the AI receives it, plus **Restore Default** and a token
estimate. Edit it, save it, that is what gets sent.

**The one real constraint, stated plainly.** DES's panels find values by key: the scene header
reads `location`, the character cards read `name`/`thoughts`, and so on. Rename a key in the
raw prompt and the AI will happily produce it, but the panel looking for the old key renders
nothing. That is not a bug we can fix from our side — it is what "edit the prompt freely"
means.

Handling, rather than forbidding:

1. The editor shows a **live diff-aware warning** when an edit removes or renames a key a
   panel depends on: *"The Scene Tracker reads `location`; nothing will show there."*
2. Anything DES doesn't recognize still surfaces in the **Tracker Data dropdown**, so a custom
   key is never invisible — it just isn't in a styled panel.
3. **Restore Default** is always one click, and an "edited" badge marks the state so a user who
   forgot they edited it can find their way back.
4. Custom sections (§2.2) are the *supported* path to new content — defined through the
   builder, DES knows how to render them. The raw editor is for wording and structure tweaks;
   the builder is for adding things. Both ship.

For users who don't want to touch raw text, every field's wording is also editable inline in
the builder (the `prompt` string in §2.1), with the same Restore Default. Same capability,
two levels of comfort.

### 2.4 The overhauled options menu (G1, G8)

**Revised — the visibility toggles stay put.** An earlier draft moved them into the editor to
kill the duplication. That was solving a maintenance smell at the user's expense: the quick
toggles are the single most-used control in the accordion (one tap to hide Time), and removing
a familiar control to tidy our internals is a bad trade. They stay.

The actual defect is not that two surfaces exist — it's that the accordion's toggles are
**hardcoded HTML** (`rpg-st-show-time`, `rpg-st-show-date`, … in `template.html:764`+) while
the editor reads `trackerConfig`. Two hand-maintained lists over one state is what drifted in
2.2.0, and it is also exactly why **custom fields never appear in the quick menu**.

Fix the cause instead:

- **Both surfaces render from the same descriptor list** (§2.1). The accordion's "Visible
  Fields" section is *generated* from config rather than hardcoded, so it can't drift, and
  every custom field and custom section automatically gets a quick toggle the day it's
  created. That turns the duplication from a liability into a feature.
- **Split by decision type, not by removal.** The accordion keeps quick visibility toggles +
  presentation (layout, position, colours, opacity), and gains one prominent
  **"Customize Tracker Fields…"** button. Depth — adding, renaming, retyping, rewording,
  reordering, prompt editing — lives in the editor.
- **Tracker Editor → "Tracker Studio"**: left rail lists sections (Scene · Characters ·
  Quests · + Add Section), right pane is the field list for the selected section with
  drag-reorder and inline enable/rename/retype/reword, plus a **Tracker Prompt** tab (§2.3).

Net effect for existing users: nothing they use disappears, the quick list simply grows to
include their own fields. No disruptive migration note needed — which is the other reason
this revision is better.

---

## 3. Phasing

Each phase ships independently and leaves the extension working.

| Phase | Scope | Risk |
|---|---|---|
| **P1 — Tracker Prompt editor** | Assemble the full prompt into one editable box with Restore Default, token estimate, key-removal warnings, "edited" badge (§2.3). Delivers the headline ask on its own. | Low–Medium. Additive; generated path stays the default. |
| **P2 — Field descriptors + typing** | Refactor built-ins into descriptors; one emitter per type; inline per-field wording; **generate the accordion's Visible Fields list from config** (§2.4); extend custom fields to **Quests** (G7). | Medium. Touches prompt generation — pinned by golden-file tests: a default config must emit a **byte-identical** prompt to today's. |
| **P3 — Custom sections** | Full §2.2 thread-through: prompt, parse, per-swipe storage, per-chat persistence, six layouts, history persistence, locks, presets. | **High.** The persistence and render paths are the dangerous ones. |
| **P4 — Tracker Studio UI** | Left-rail builder, drag reorder, per-field editing, prompt tab, "+ Add Section" front-end for P3. | Medium (UI only, but large). |
| **P5 — Presets + hardening** | Preset export/import round-trip incl. custom sections; migration hardening; docs. | Medium. |

Confirmed scope: **custom sections are in** (P3), so this runs the full sequence rather than
stopping at fields. P1 is deliberately first and standalone — it answers "let me edit the
prompt that creates the tracker" without waiting on the builder, and it's the phase that can
ship soonest.

P4's UI shell can land incrementally alongside P2/P3 rather than as one big-bang rewrite;
"+ Add Section" simply stays hidden until P3's data model exists behind it.

---

## 4. Compatibility rules (non-negotiable)

1. **Existing installs keep their behaviour.** Migration fills descriptors from current
   config; a default config must emit a **byte-identical** prompt to today's.
2. **No silent prompt inflation.** Every added field costs tokens; the preview shows the
   estimate, and `compactPrompts` stays honoured by all new emitters.
3. **Preset compatibility both ways.** Old presets import (missing keys defaulted); new
   presets exported to an older DES must degrade rather than throw.
4. **Escaping.** All field names/descriptions are user *and* AI data reaching the DOM —
   `escapeHtml`/`escapeAttr` per the 2.2.0 mandate. Field `id`s must be sanitized to safe
   JSON keys and checked against `RESERVED_INFOBOX_KEYS`.
5. **Renderer guards.** Every new render path must tolerate missing/malformed data — a bad
   custom field must never throw inside `onMessageReceived` (see 2.4.2: a throwing renderer
   used to cost the turn's tracker data; `safeRender` now contains it, don't rely on it).

## 5. Verification

- `node tools/load-check.mjs` at every step.
- **New** `tools/tracker-prompt-test.mjs`: golden-file fixtures asserting the emitted spec for
  (a) default config — must equal the current output byte-for-byte, (b) compact mode,
  (c) custom field of each type, (d) a custom section, (e) reserved-key collision rejected.
- Browser harness (pattern established in this repo): render a custom section across all six
  scene-tracker layouts; reload to prove per-chat persistence; swipe to prove per-swipe storage.
- Parity checklist rows per phase.

## 6. Decisions (resolved)

1. **Custom sections are in scope** — whole user-defined sections, not just fields inside the
   existing two. P3 runs; the plan carries its full thread-through cost.
2. **Prompt editing means the real prompt** — one box containing the actual assembled tracker
   prompt (instructions *and* format spec), editable, with Restore Default. Per-field wording
   editing ships alongside it for users who'd rather not touch raw text. The key-renaming
   consequence is surfaced as a warning in the editor, not prevented.
3. **The visibility toggles stay in the Scene Tracker menu.** The duplication is fixed by
   generating both surfaces from one descriptor list rather than by deleting a control users
   rely on — which also gets custom fields into the quick menu for free.
