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
| G8 | **Duplicated/split UI** (§0.4). | Confusing, and drifts. |

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

### 2.3 Prompt editing, in three tiers (G3, G5, G6)

- **Tier 1 — per-field wording** (safe, covers most demand). Every field's `prompt` string is
  editable inline in the editor, with Restore Default.
- **Tier 2 — live preview** (G6). A read-only pane rendering the exact assembled tracker
  prompt, updating as fields change, with a token estimate (reuse the lorebook estimator).
  *Ship this early — it makes every other tier legible.*
- **Tier 3 — raw override** (advanced, gated behind a warning).
  `extensionSettings.customTrackerFormatOverride` replaces the generated spec verbatim.
  Requirements: validate it parses as a JSON-ish template; show a persistent "override
  active" badge; one-click revert; and **honesty in the UI** — DES renders the keys it
  recognizes, everything else surfaces in the Tracker Data dropdown rather than the panels.

### 2.4 The overhauled options menu (G1, G8)

Single source of truth, split by *what kind of decision it is*:

- **Settings → Scene Tracker accordion** keeps only **presentation**: layout, position,
  colours, opacity — plus one prominent **"Customize Tracker Fields…"** button. The
  duplicated "Visible Fields" toggles are **removed** from here (they move to the editor),
  which structurally kills the drift in §0.4.
- **Tracker Editor → "Tracker Studio"**: left rail lists sections (Scene · Characters ·
  Quests · + Add Section), right pane is the field list for the selected section with
  drag-reorder, inline enable/rename/retype/reword, and a **Prompt Preview** tab beside it.

Because the toggles move, a **one-time migration + a note in What's New** is mandatory, or
users will report the toggles as "missing".

---

## 3. Phasing

Each phase ships independently and leaves the extension working.

| Phase | Scope | Risk |
|---|---|---|
| **P1 — Preview + de-duplication** | Prompt Preview pane (§2.3 Tier 2); make the editor the single writer for field visibility; accordion keeps presentation + entry button; migration + What's New note. | Low. No prompt-shape change. |
| **P2 — Field descriptors + typing** | Refactor built-ins into descriptors; one emitter per type; editable per-field wording with Restore Default; extend custom fields to **Quests** (G7). | Medium. Touches prompt generation — pin with fixture tests comparing emitted spec before/after for a default config (must be byte-identical for untouched settings). |
| **P3 — Custom sections** | Full §2.2 thread-through. | **High** — the persistence and render paths are the dangerous ones. |
| **P4 — Tracker Studio UI** | Left-rail builder, drag reorder, per-field editing, preview tab. | Medium (UI only, but large). |
| **P5 — Raw override + presets** | Tier 3 override with guard rails; preset export/import round-trip incl. custom sections; migration hardening. | Medium. |

Recommended first cut: **P1 + P2**. That alone delivers "edit the tracker prompt" (per-field,
with preview) and "add custom things" (now including Quests), and it makes the existing
hidden functionality discoverable — likely satisfying most of the request volume before the
expensive P3 lands.

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

## 6. Open questions for the user

1. **Scope of "custom things"** — custom *fields* inside existing sections (cheap, P2), or
   whole custom *sections* (expensive, P3)? This is the single biggest cost driver.
2. **Raw prompt editing** — is Tier 1 (per-field wording + preview) enough, or is hand-writing
   the whole schema (Tier 3) a hard requirement?
3. **Moving the visibility toggles** out of the settings accordion — good (one source of
   truth) or too disruptive for existing users?
