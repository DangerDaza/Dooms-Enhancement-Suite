# Character Sheets & Workshop — Diagnosis and Implementation Plan

> **Revision 2.** The first revision of this document ranked "BunnyMo header format drift" as the
> primary cause, based on secondary sources. Primary-source verification (the actual BunnyMo
> lorebook JSONs for V2→V3.0 and CarrotKernel's source, fetched from the author's repos, plus
> SillyTavern `script.js`/`index.html` across 1.12.0→1.18.0) overturned that: **official BunnyMo
> templates match the current detection regex just fine — the button is injected into a UI
> container that is hidden by default.** Part 1 below is the corrected diagnosis; the earlier
> claims are called out explicitly where they were wrong.

Covers three work items:

1. **Bug** — the fullsheet import button (scroll icon) is not appearing on Bunny Mo `!fullsheet` / `!quicksheet` reply messages.
2. **Feature** — a per-character toggle that turns the Character Sheet into a freeform **Notes** section with user-created collapsible dropdown sections (the Bunny Mo dropdown look).
3. **Feature** — when creating a new Workshop character, scan existing characters for **similar names** and offer via popup to add the new name as an **alias** of the existing character instead.

---

## Part 1 — Bug diagnosis: import button not showing

### How the feature works today

- Detection: `messageHasFullSheet()` in `src/systems/ui/fullsheetButtons.js:25` — a message "is a fullsheet" when `/^#{0,2}\s*\S+\s+\d+\s*\/\s*\d+/gim` matches **≥ 2** lines.
- Injection: per-message on `CHARACTER_MESSAGE_RENDERED` (`index.js:2942`), a full-chat sweep on `CHAT_CHANGED` (+200 ms) and at boot. The button is prepended **inside `.mes_buttons .extraMesButtons`**.
- Import: the click handler lazy-loads `characterSheet.js` (silently — `.catch(() => {})`) and runs `parseFullSheet()`, which keeps its **own** copy of the header regex (`characterSheet.js:26`).

### Root causes, ranked (primary-source verified)

**R1 — The button is injected into SillyTavern's collapsed "Message Actions" flyout, so with default settings it is never visible on the message. (Confirmed mechanism; explains a blanket "never appears".)**

`.extraMesButtons` is `display: none` in ST's stylesheet and only becomes visible after the user clicks the `…` (`extraMesButtonsHint`) ellipsis on a message — or if `power_user.expand_message_actions` is enabled, which **defaults to false**. DES's own CHANGELOG and settings blurb tell users to "click the scroll icon DES adds to the message" with no mention of the `…` menu, and the parity-checklist item for this flow was never checked off. Detection provably fires on official BunnyMo output (see R2), so for most reporters the button exists in the DOM — two interactions deep where nobody looks.

**R2 — Detection is correct for official templates, but brittle against model drift and truncation. (Plausible, secondary.)**

The earlier revision of this doc claimed the current BunnyMo format is `## 🥕 SECTION 1/8` (emoji before SECTION) and that quicksheets are unnumbered. **Both claims are wrong on primary evidence.** Verbatim from the actual lorebook JSONs:

- V3.0 fullsheet: `## SECTION 1/14: 🆔 **Core Identity & Context**` … `## SECTION 14/14: 🏥 **Health & Conditions Profile**` — emoji comes *after* the colon.
- V3.0 quicksheet: `## SECTION 1/8:` … `## SECTION 8/8:` — numbered, 8 sections. Older versions: fullsheet /8 and /13, quicksheet /6.
- The sheet body is **not** wrapped in `<details>` (one confidential-info `<details>` block per sheet; the full-dropdown look belongs to `!updatesheet`/`!physheet`).

Running the exact DES regex over every official template version yields 6–14 matches — all ≥ 2, so faithful reproduction is always detected. What the regex *does* miss are plausible AI drift shapes: `### SECTION 1/14` (the template itself uses `###` for sub-headers, inviting harmonization), an emoji/decorator token before the section word, indented headers — and, importantly, a **max_tokens-truncated** reply that got cut before SECTION 2 (a 14-section V3 fullsheet vastly exceeds typical RP response limits; 1 header = no button; the button appears only once a continue completes). CarrotKernel copes with the same problem by keeping loose header matching *plus* a `<TAG:value>`-count fallback.

**R3 — Coverage gaps for already-rendered chats. (Confirmed, situational.)**

- **Lazy-loaded history:** with more than `chat_truncation` (default 100) messages, older messages render via "show more messages", which emits only `MORE_MESSAGES_LOADED` — DES has no listener for it, so a sheet above the fold never gets a button.
- **Edits:** the `MESSAGE_UPDATED` handler never injects — a sheet pasted via edit gets no button until reload.
- **Swipes:** navigation between existing swipes emits only `MESSAGE_SWIPED` (no render event). Mostly mitigated — ST reuses the DOM node and a previously injected button survives — but bites when the chat was printed while a non-sheet swipe was active.
- Streaming is **not** a cause: on every ST version checked (1.12.0→1.18.0), `CHARACTER_MESSAGE_RENDERED` fires at stream end with the complete text (1.12/1.13 additionally fired early for swipe/continue, but the end-of-stream emission still followed).

**Flip side — false positives (the "only on sheet commands" half):** the loose pattern matches ordinary RPG prose — `HP 45/100` + `MP 30/50` and `Day 3/10` + `Round 2/5` both currently show the scroll icon (verified). Stat blocks are everywhere in this extension's user base; stray icons make the feature look arbitrary.

**Also confirmed (different symptom):** the click handler's `ensureSettingsUI().then(…).catch(() => {})` (`index.js:2959`) makes any deferred-load failure a **silent no-op click** — "button present but dead".

**Refuted** (so nobody re-chases them): ST DOM restructuring (`.mes_buttons > .extraMesButtons` hierarchy identical 1.12.0→release); synthetic-message guards (GG markers only); regex `lastIndex` state; stale `chat` array binding; cross-extension listener crashes (ST wraps every listener in try/catch); CHAT_CHANGED racing the chat print (ST awaits `printMessages()` before emitting).

### Fix plan

**1.1 — Make the button visible: inject into the always-visible button row.** Move injection from inside `.extraMesButtons` to a direct child of `.mes_buttons` (before the `…` hint), so the scroll icon sits alongside ST's own edit/flag icons and the documented UX ("click the scroll icon DES adds to the message") becomes literally true. Verify with `expand_message_actions` both off (the default!) and on.

**1.2 — Multi-signal detection, shared with the parser.** In `fullsheetButtons.js`, export one `SECTION_HEADER_SOURCE` and a `collectSectionHeaders(text)` helper used by *both* `messageHasFullSheet` and `parseFullSheet` (which must drop its private copy at `characterSheet.js:26` — otherwise widening detection just converts "button missing" into "button present, import fails"). Signals:

- **S1 — BunnyMo markers (high precision):** a `<BunnymoTags>…</BunnymoTags>` block (ends V3 fullsheet *and* quicksheet output), or ≥ 3 `<TAG:value>` tags (CarrotKernel's fallback; URL-safe — `<https://…>` must not count).
- **S2 — Quicksheet title:** a line-anchored `QUICK SHEET`/`QUICKSHEET` heading, plus minimum-length and bold-block guards so prose like "want a quicksheet?" doesn't count.
- **S3 — Numbered sections (broadened + tightened):** header regex tolerates leading indent, `#{0,3}`, an optional decorator token before the section word, `<details>`/`<summary>` wrappers, and fullwidth slash; then require structural coherence instead of "any 2 `N/M` lines": group matches by denominator `M` and demand one group with `2 ≤ M ≤ 20` (V3 fullsheet is /14 — do **not** hard-code /8), ≥ 2 distinct `N ≤ M`, and (`min N ≤ 2` or ≥ 3 headers). Same-`M` grouping is what kills `HP 45/100`+`MP 30/50` (denominators differ, 100 out of range) and `Day 3/10`+`Round 2/5`.

**1.3 — Close the coverage gaps.** Extract `injectFullSheetButtonForMessage(messageId)` and call it from `CHARACTER_MESSAGE_RENDERED` (as now), `MESSAGE_UPDATED`, `MESSAGE_SWIPED`, and a new `MORE_MESSAGES_LOADED` registration (guarded for older ST builds that lack the event type). All paths share the existing already-has-button idempotency check. The `CHAT_CHANGED` sweep stays. No `GENERATION_ENDED` hook needed: the truncation case (R2) resolves when the continue completes and re-fires the render event — verified against ST source for both streamed and non-streamed continues.

**1.4 — Un-silence failures.** Replace the click path's `.catch(() => {})` with a console.error + error toast; `console.debug` in the sweep when a message matches but the button row is missing.

**1.5 — Fixture test.** New `tools/sheet-detect-test.mjs` (zero-framework, like `load-check.mjs`): real header excerpts from all five template versions (V2 /8 plain, V2.5–2.8 emoji-after-colon incl. the malformed `## SECTION: 8/8`, V2.9 /13, V3.0 /14 + quicksheet /8), drift shapes (`###`, emoji-first, indented, `<summary>`-wrapped), truncated single-section, and the must-NOT-match set (HP/MP, Day/Round, dates, plain prose). Run with `node tools/load-check.mjs` before every push.

### Regression safety (Part 1)

- Every official template version passes both old and new detection; the tightening removes only verified false positives — pinned by the fixture test.
- Injection stays idempotent across all (old + new) event paths; the guard now checks the whole `.mes_buttons` row so a button injected by an older DES build can't be doubled.
- Import parsing is merge-safe with Part 2 (see below) and unchanged for plain sheets.
- CSS for the button already lives in the eager `style.css` (12146) — visible-row placement needs no new stylesheet loading.

---

## Part 2 — Notes mode: toggle + user-created dropdown sections

### Intent

Users who don't use Bunny Mo (or who want their own organization) flip a toggle and the character's Sheet tab becomes a **notes area** where they create their own collapsible dropdown sections — same look as an imported Bunny Mo sheet (`.rpg-cs-section` header + chevron + body), but fully editable.

### Data model (per-chat, additive)

Extend the existing per-character entry in `chat_metadata.dooms_tracker.characterSheets[name]`:

```js
{
  // existing imported-sheet fields stay untouched:
  characterTitle, characterName, sections: [...], importedAt,
  // new:
  mode: 'sheet' | 'notes',        // absent → 'sheet' (back-compat)
  notesSections: [                // user-created dropdowns
    { id, emoji, title, content } // content = plain text/markdown
  ],
}
```

Key decisions:

- **Notes live beside the imported sheet, not instead of it.** Toggling hides the imported sheet but never deletes it; toggling back restores it exactly.
- Nesting the new fields *inside* the `characterSheets` entries matters: `saveChatData()` **rebuilds** the whole `chat_metadata.dooms_tracker` object from an explicit field list (persistence.js:556-569) and preserves `characterSheets` wholesale — a new top-level field would be silently wiped unless added to that list. Staying inside the map avoids touching persistence at all.
- `importFullSheetFromMessage` must **merge** into an existing entry (`{ ...existing, ...parsed }`) instead of overwriting — otherwise importing a sheet clobbers a character's notes. If the character is in notes mode, toast "Sheet imported — toggle Notes Mode off to view it."
- Discrete note actions (save section, delete, reorder) save with `saveChatData({ immediate: true })` (the doom-counter idiom — a debounced write is lost on fast chat switch); the entry-creation path can stay debounced.

### UI changes (`characterSheet.js` + `styles/modals.css`)

The popup markup (`template.html:1712-1731`) needs no changes — tabs and sections are built at runtime by `openCharacterSheet()`. All sheet CSS lives in **`styles/modals.css:4577-5110`** (not `style.css`), which is already loaded (`ensureCss('modals')`) before the popup exists.

1. **Toggle** — a small "Notes Mode" switch in the runtime-built tab bar. Flips `mode` on the entry (creating a minimal entry if the character has none), saves, re-renders the popup body.
2. **Notes renderer** — in `openCharacterSheet()`, branch on `mode`:
   - `'sheet'` (default): current renderer, byte-for-byte unchanged.
   - `'notes'`: render `notesSections` as `.rpg-cs-section` dropdowns with header controls: ✏️ edit (swaps body for emoji/title inputs + content textarea with Save/Cancel — the `trackerEditor.js` inline-panel idiom), 🗑 delete (`window.confirm` — the repo's two-choice idiom; there are no `POPUP_TYPE.CONFIRM` usages to copy), ▲▼ reorder (buttons, mobile-friendly). Below the list, `+ Add Section` appends a new section already in edit state.
   - Notes empty-state replaces the Bunny-Mo-only hint when in notes mode.
3. **Escaping** — user-typed titles/emoji go through `escapeHtml`/`escapeAttr` from `src/utils/html.js` (the existing sheet renderer interpolates imported titles raw — imported data was already on-screen as a message, but user-typed notes fields must be escaped like `trackerEditor` does). Content renders through the existing `renderMarkdown()` (selective tag allowlist).
4. **Copy button** — `copyCharacterSheet()` scrapes rendered `.rpg-cs-section` DOM, so notes sections get Copy support for free; skip sections currently in edit state.
5. **Handlers** — new delegated handlers in `initCharacterSheet()` (`rpg-cs-note-*` classes); edit/delete/reorder clicks `stopPropagation` so they don't toggle the dropdown.
6. **i18n** — plain English literals, matching the module (there is no `t()` helper; `data-i18n-key` only applies to static template markup).

### Regression safety (Part 2)

- `mode` absent → exact current behavior; no migration; existing chats untouched.
- Import is merge-safe in both directions (import-then-notes, notes-then-import).
- Stats tab, hero art/reposition, copy, close: untouched paths. The sheet branch of the renderer is preserved as-is.

---

## Part 3 — Similar-name detection → "make it an alias?" on Workshop character creation

### Intent

Creating "Sara" when "Sarah" already exists usually means the user wants the same character. Offer, in a popup, to record the new name as an **alias** of the existing character (DES's alias system then canonicalizes tracker data automatically at every ingestion chokepoint) instead of birthing a duplicate card.

### Where it hooks

`commitNewCharacter()` in `src/systems/ui/characterRoster.js:312` — the single manual-creation entry point. After the existing exact-dup guard (line 325) and before the create:

1. Build the candidate pool: canonical names from the global stores **and the chat-aware getters** (`getActiveKnownCharacters()` / `getActiveCharacterColors()`, like `collectCharacterNames()` does — `getAllExistingCharacterNamesLower()` alone misses per-chat rosters), **plus all existing aliases** (`extensionSettings.characterAliases` keys *and* values — the current exact-dup set includes neither).
2. Run the similarity check. No match → create exactly as today.
3. Match → swap the dialog to a choice panel instead of silently creating.

Not hooked (deliberately): the bulk import flows keep exact-match dedup (a per-item popup during a 30-card import is hostile; optional follow-up: a summary toast). The tracker **auto-adoption** path (`persistence.js:781-823`) stays untouched — it consumes already-canonicalized data, though note it does *not* alias-resolve `removedCharacters` entries; out of scope here.

### Similarity algorithm — new `src/utils/nameSimilarity.js` (no deps; repo has no edit-distance utility, only exact/word-boundary matchers duplicated in `portraitBar.js`/`thoughts.js`)

Normalize (trim, lowercase, Unicode NFD + strip combining marks, collapse whitespace), then flag **similar** when any of:

- **Edit distance:** Levenshtein ≤ 1 for length ≤ 5, ≤ 2 for longer ("Sara"/"Sarah", "Nyx"/"Nix", "Katherine"/"Catherine").
- **Token containment:** one name's token set ⊆ the other's ("Sarah" vs "Sarah Greenfield" — the exact scenario the alias system was built for).
- **Prefix:** the existing `namesMatchLoose` semantics.

Return the best match with its canonical owner (alias hits resolve to the owning card).

### UI — extend the existing inline dialog (`#cr-newchar-overlay`, `template.html:2697-2711`)

Add a hidden panel inside `.cr-newchar-card` (styles beside the existing ones at `styles/modals.css:6214-6226`; buttons reuse `.rpg-btn rpg-btn-ghost/-primary`). On match, hide the input/actions rows and show:

> **"Nyx" looks similar to existing character "Nix".** Did you mean the same character?
>
> `[Add "Nyx" as an alias of Nix]` `[Create separate character]` `[Back]`

- **Add as alias** → write `extensionSettings.characterAliases[canonical]` exactly the way `commitDraft()` does (`characterWorkshop.js:1847-1855`), `saveSettings()`, toast, close, and open the Workshop for the **existing** character so the user sees the alias chip land in Identity → Aliases.
- **Create separate** → today's create path, unchanged.
- **Back** → return to the name input.

Mode handling: alias option only when the match's canonical is an NPC and the roster is in NPC mode (aliases are NPC-only — `addAlias` guards `draft.isUser`); user-mode creation gets a two-way warning without the alias option. A name that **exactly equals an existing alias** gets a dedicated message ("already an alias of X") — today that creates a doomed card whose tracker data is canonicalized away to the alias owner.

### Regression safety (Part 3)

- Zero change when no similar name exists; the scan is an in-memory pass over a few dozen strings.
- Alias write path is byte-identical to the Workshop's; nothing new to resolve or migrate.
- Import flows and auto-adoption untouched; Enter-key and click paths share `commitNewCharacter`, so both get the check.

---

## Cross-cutting: file-by-file change list

| File | Part | Change |
|---|---|---|
| `src/systems/ui/fullsheetButtons.js` | 1 | Multi-signal detection; shared `SECTION_HEADER_SOURCE` + `collectSectionHeaders`; visible-row injection; `injectFullSheetButtonForMessage` |
| `index.js` | 1 | Use shared helper; add `MESSAGE_UPDATED`/`MESSAGE_SWIPED`/`MORE_MESSAGES_LOADED` injection; un-silence click failure |
| `src/systems/ui/characterSheet.js` | 1, 2 | Parser shares header source; quicksheet section fallback; merge-safe import; notes-mode branch + CRUD handlers |
| `template.html` | 1, 3 | Settings-blurb troubleshooting line; similar-name panel in `#cr-newchar-overlay` |
| `styles/modals.css` | 2, 3 | Notes edit controls; similar-name panel styles |
| `src/systems/ui/characterRoster.js` | 3 | Similarity hook + panel wiring in `commitNewCharacter` |
| `src/utils/nameSimilarity.js` | 3 | New: normalize + Levenshtein + token/prefix heuristics |
| `tools/sheet-detect-test.mjs` | 1 | New: fixture-table test (real template excerpts, drift shapes, must-not-match set) |
| `CHANGELOG.md` | all | Document |

## Verification checklist

1. `node tools/load-check.mjs` — whole module graph links (mandatory pre-push gate).
2. `node tools/sheet-detect-test.mjs` — fixture table green.
3. Manual, in ST — **with `expand_message_actions` off (the default)**: official V3 fullsheet and quicksheet → scroll icon visible on the message face; import → popup renders sections; truncated sheet → button appears after continue; sheet above the "show more messages" fold → button after expanding; edited-in sheet → button; stat-block message → **no** button; click with settings UI never opened → import still works (deferred load) and failures toast.
4. Notes mode: toggle round-trip preserves imported sheet; add/edit/delete/reorder; content survives chat switch + reload (immediate save); Copy Sheet; independent notes per chat.
5. Alias prompt: "Sara" vs "Sarah" → panel; alias lands in Workshop → Identity → Aliases; tracker output using the alias canonicalizes; separate/back paths; user-mode warning; exact-alias-name case; bulk imports unaffected.
6. Regression sweep: portrait-bar right-click → sheet opens; stats tab; hero reposition; Workshop alias save round-trip; bubbles/thoughts decorations on swipe & edit (the handlers being extended).
