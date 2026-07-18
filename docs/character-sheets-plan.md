# Character Sheets & Workshop — Diagnosis and Implementation Plan

Covers three work items:

1. **Bug** — the fullsheet import button (scroll icon) is not appearing on Bunny Mo `!fullsheet` / `!quicksheet` reply messages.
2. **Feature** — a per-character toggle that turns the Character Sheet into a freeform **Notes** section with user-created collapsible dropdown sections (the Bunny Mo dropdown look).
3. **Feature** — when creating a new Workshop character, scan existing characters for **similar names** and offer via popup to add the new name as an **alias** of the existing character instead.

Everything here was designed against the current code on `main` (2.3.0). Each section ends with regression-safety notes; a combined verification checklist is at the bottom.

---

## Part 1 — Bug diagnosis: import button not showing

### How the feature works today

- Detection: `messageHasFullSheet()` in `src/systems/ui/fullsheetButtons.js:25` — a message "is a fullsheet" when the regex `/^#{0,2}\s*\S+\s+\d+\s*\/\s*\d+/gim` matches **≥ 2** lines. That is: line start, up to two `#`, then **exactly one** non-whitespace token, then `N/M` digits.
- Injection happens in three places, all idempotent:
  - per-message on `CHARACTER_MESSAGE_RENDERED` (`index.js:2942`),
  - a full-chat sweep on `CHAT_CHANGED` (+200 ms, `index.js:3010`) and at boot (`index.js:1200`, `index.js:2201`),
  - the button lands in `.mes_buttons .extraMesButtons`.
- Import: clicking the button lazy-loads `characterSheet.js` and runs `parseFullSheetFromMessage` → `parseFullSheet()` (`characterSheet.js:33`), which uses its **own** copy of the header regex (`SECTION_HEADER_REGEX`, line 26) and requires ≥ 2 matches.

### Root causes, ranked (verified)

**RC1 — The detection regex doesn't match Bunny Mo's current header format. (Primary, confirmed by test.)**

The regex allows only **one token** between the `##` and the `N/M` digits. Current Bunny Mo lorebooks decorate headers with an emoji token, e.g.:

```
## 🥕 SECTION 1/8: 🆔 **CORE IDENTITY & CONTEXT**
```

`🥕` consumes the single-token slot, `SECTION` then sits where digits are expected → **no match**. Verified empirically (node) — all of these FAIL the current regex:

| Input shape | Current regex |
|---|---|
| `## SECTION 1/8: …` (old v1 format) | ✅ matches |
| `## 🥕 SECTION 1/8: …` (current format) | ❌ fails |
| `### SECTION 1/8: …` (3+ hashes) | ❌ fails (`#{0,2}` cap) |
| `<details><summary>🥕 SECTION 1/8…` (dropdown edition) | ❌ fails |
| `  ## SECTION 1/8` (indented) | ❌ fails (no leading `\s*`) |

The code comment says the detection was "ported from CarrotKernel" — but CarrotKernel's version tolerates an optional decorator token (`(?:\S+\s+)?`) and up to `###`. That part was dropped in the port. So the feature worked against old Bunny Mo output and silently broke as users updated their lorebooks to the emoji/dropdown editions. This precisely matches the user reports.

**RC2 — `!quicksheet` output is structurally undetectable. (Confirmed.)**

Quicksheet output is a short sheet: a `QUICK SHEET`-style title plus a few **unnumbered** bold blocks (Physical / Personality / Speech). It contains no `N/M` numbered headers at all, so the "≥ 2 numbered headers" heuristic can *never* fire for it — yet `template.html:996` and `docs/parity-checklist.md:78` promise quicksheet support. Quicksheet needs its own signature.

**RC3 — Timing gaps on swipe/edit and older SillyTavern builds. (Contributing.)**

- Swiping between existing swipes emits only `MESSAGE_SWIPED` — SillyTavern does **not** re-emit `CHARACTER_MESSAGE_RENDERED` for swipe navigation, and neither DES swipe handler (`onMessageSwiped`, `onMessageSwipedBubbles` at `index.js:3064`) injects the button. A fullsheet sitting on swipe 2 stays buttonless until a chat reload.
- Message **edits** (`MESSAGE_UPDATED`, `index.js:3015`) never inject either — pasting a sheet into an edited message shows no button.
- Streaming: on current ST (≈1.12.6+), `StreamingProcessor.onFinishStreaming` re-emits `CHARACTER_MESSAGE_RENDERED` with the full text, so streamed replies get a proper post-stream check. On **older builds** it fired only at stream start with partial text — nothing re-checks at stream end, so the button never appeared for streamed sheets until reload.

**Flip side — false positives (the "only show on sheet messages" half of the report):** the loose pattern matches ordinary RPG prose. Verified matches: `HP 45/100` + `MP 30/50`, `Day 3/10` + `Round 2/5`. In an RPG-tracker extension's user base, stat blocks are everywhere — users see scroll icons on random messages, which erodes trust in the ones that matter.

**Refuted candidates** (so nobody re-chases them): ST DOM change (`.extraMesButtons` is still inside `.mes_buttons` on current release); the synthetic-message guards (`isSyntheticTrackerMessage` only matches GG markers, not Bunny Mo replies); regex `lastIndex` statefulness (literal is re-created per call).

> ⚠️ One caveat: the exact current Bunny Mo template (carrot placement, dropdown edition markup) was researched from public repo sources at medium confidence. The fix below is deliberately format-resilient (tolerates decorator tokens, sees through `<details>/<summary>`, adds marker-based fast paths), but before shipping, paste one real current `!fullsheet` and one `!quicksheet` reply into the new unit test's fixture list to lock the actual shapes in.

### Fix plan

**1.1 — Rewrite detection in `fullsheetButtons.js` as a small multi-signal function.**

Export a single shared header-regex source so the detector and parser can never drift apart again:

```js
// Tolerates: up to ### hashes, leading indent, an optional short decorator
// token (🥕 / any emoji / bullet) before the section word, <details>/<summary>
// wrappers, ASCII or fullwidth slash.
export const SECTION_HEADER_SOURCE = String.raw`^\s*(?:<details[^>]*>\s*)?(?:<summary[^>]*>\s*)?#{0,3}\s*(?:\S{1,8}\s+)?(\S+)\s+(\d{1,2})\s*[\/／]\s*(\d{1,2}):?\s*(.*)$`;
```

Then `messageHasFullSheet(text)` returns true when **any** of these signals fire:

- **S1 — Bunny Mo marker (high precision):** the text contains a `<BunnymoTags>` block (case-insensitive). Current fullsheet *and* quicksheet output ends with this machine-readable tag block — it's the cheapest, most reliable signal and also covers future header-format drift.
- **S2 — Quicksheet title:** a line matching `/^\s*#{0,3}\s*\S*\s*QUICK\s?SHEET/im` (covers `# 🐰 QUICK SHEET: Luna` and variants).
- **S3 — Numbered sections (tightened):** collect all `SECTION_HEADER_SOURCE` matches, group by denominator `M`, and require a group where:
  - `2 ≤ M ≤ 12`, and
  - the group has ≥ 2 **distinct** `N` values with `N ≤ M`, and
  - (`min N ≤ 2` **or** group size ≥ 3) — sheets start at section 1; a split continuation carries 3+ headers.

  The same-`M` rule is what kills the false positives: `HP 45/100` + `MP 30/50` have different denominators (and 100 > 12); `Day 3/10` + `Round 2/5` differ too. The old behavior (any 2 numbered lines anywhere) goes away.

**1.2 — Make the parser accept everything the detector accepts.**

`parseFullSheet()` in `characterSheet.js` must import `SECTION_HEADER_SOURCE` instead of keeping its own `SECTION_HEADER_REGEX` (line 26). Otherwise the button appears and the import fails with "No fullsheet data found" — the same bug wearing a different hat. Parser additions:

- When the decorator-token group consumed the section keyword's slot, titles still resolve (existing fallback logic mostly covers this; extend the header-cleanup to also strip `</summary>` / `</details>` / `---` remnants from section content).
- Add a `parseQuickSheet(text)` fallback: when S2 matched but no numbered sections exist, split on the bold block headers (`**Physical**` etc.) into sections so quicksheets import as 2–4 dropdown sections. Store with the same `{ characterTitle, characterName, sections[] }` shape — downstream rendering needs zero changes.
- Strip the `<BunnymoTags>…</BunnymoTags>` block from the last section's content (it's machine data, not prose) but keep it in a `rawTags` field on the stored sheet — free future feature (tag chips).

**1.3 — Close the timing gaps in `index.js`.**

Add one exported helper `injectFullSheetButtonForMessage(messageId)` in `fullsheetButtons.js` (the existing per-message body, extracted), then call it from:

- `onCharacterMessageRenderedDecorations` (replaces inline copy at `index.js:2942`),
- `onMessageSwipedBubbles` (or a tiny new named handler on `MESSAGE_SWIPED`),
- `onMessageUpdatedDecorations`,
- a `GENERATION_ENDED` check of the **last** message only — belt-and-braces for pre-1.12.6 ST streaming.

All paths hit the existing "already has button" guard, so multi-path injection stays idempotent. The `CHAT_CHANGED` sweep stays as-is.

**1.4 — Diagnosability.** In `injectFullSheetButtons`, when a message matches but `.extraMesButtons` isn't found, `console.debug` a one-liner. Add to the Bunny Mo settings blurb (`template.html:996`): "not seeing the button? — check the message actually contains numbered `SECTION N/M` headers or a `<BunnymoTags>` block". Cheap, and turns the next user report into a useful one.

**1.5 — Unit test.** New `tools/sheet-detect-test.mjs` (same zero-framework style as `tools/load-check.mjs`): imports `messageHasFullSheet` + `parseFullSheet`, runs the must-pass / must-fail fixture table from this doc (old format, carrot format, `###`, `<details>` edition, quicksheet, split sheet halves, HP/MP block, Day/Round counters, dates). Exit 1 on any mismatch. Run it plus `node tools/load-check.mjs` before every push.

### Regression safety (Part 1)

- Every previously-detected shape still passes: old `## SECTION N/8` sheets satisfy S3 (same M, N starting at 1). The tightening only removes shapes that were **false positives** — the case table in the test pins this.
- Detector and parser share one regex source — the "button shows but import fails" class of bug becomes structurally impossible.
- New injection paths reuse the same idempotent helper; no behavior change for messages without sheets (regex cost per message is trivial, and the swipe/edit handlers already run heavier work like bubble re-application).
- No storage-format change for existing imported sheets; `rawTags` is additive.

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

Key decision: **notes live beside the imported sheet, not instead of it.** Toggling to notes hides the imported sheet but never deletes it; toggling back restores it exactly. A character with no imported sheet can still use notes (entry is created on first save with `mode:'notes'` and no `sections`). Persistence goes through the existing `saveCharacterSheet()` → `saveChatData()` path — no new plumbing.

### UI changes (`characterSheet.js` + `template.html:1713` popup + `style.css`)

1. **Toggle** — a small switch in the popup (suggested: right side of the `.rpg-cs-tabs` bar, label "Notes Mode"). Wire like every other DES toggle (cf. `#rpg-ib-toggle`, `index.js:1209`): flips `mode`, saves, re-renders the popup body. Per-character, because it's stored on that character's sheet entry.
2. **Notes renderer** — in `openCharacterSheet()` (`characterSheet.js:626`), branch on `mode`:
   - `'sheet'` (default): current renderer, byte-for-byte unchanged.
   - `'notes'`: render `notesSections` as `.rpg-cs-section` dropdowns, each with hover controls: ✏️ edit (swaps body for a `<textarea>` + emoji/title inputs with Save/Cancel — the `trackerEditor.js` inline-panel idiom), 🗑 delete (confirm via `callGenericPopup POPUP_TYPE.CONFIRM`), ▲▼ reorder (buttons, not drag — works on mobile). Below the list, a `+ Add Section` button appends a new empty section already in edit state.
   - Notes empty-state: "No notes yet — add your first section", replacing the current Bunny-Mo-only empty-state text when in notes mode.
3. **Copy button** (`#rpg-cs-copy`) — `copyCharacterSheet()` already serializes from the rendered DOM (`.rpg-cs-section` scrape), so notes mode works with **zero changes**; verify in testing.
4. **Import interplay** — importing a fullsheet while in notes mode: keep it non-destructive (write `sections`, leave `mode` alone) and toast "Sheet imported — Notes Mode is on for this character; toggle it off to view." No data loss in any order of operations.
5. **Delegated handlers** — add the edit/delete/reorder/add handlers inside `initCharacterSheet()` with the existing `$(document).on('click', …)` pattern and unique classes (`rpg-cs-note-edit`, etc.) so they coexist with the section-collapse handler (edit clicks must `stopPropagation` so they don't toggle the dropdown).
6. **Rendering safety** — user note content goes through the existing `renderMarkdown()` (which escapes non-allowlisted HTML). Title/emoji fields get plain-text escaping (`escapeHtml` idiom from `characterWorkshop.js`).
7. **CSS** — reuse `.rpg-cs-section*` wholesale; add only `.rpg-cs-note-controls`, textarea styling, and an add-button row in the sheet-popup block of `style.css` (~line 12100 region). No new lazy CSS file needed (sheet styles are in the eager stylesheet already).

### Regression safety (Part 2)

- `mode` absent → exact current behavior; existing chats and imported sheets render unchanged. No migration.
- Imported data is never mutated by notes operations (separate `notesSections` array).
- Stats tab, hero art, reposition mode, copy, close — all untouched code paths.
- The only shared surface is `openCharacterSheet()`'s body-building; branch early (`const mode = sheetData?.mode === 'notes' ? 'notes' : 'sheet'`) and keep the sheet branch literally as-is.

---

## Part 3 — Similar-name detection → "make it an alias?" on Workshop character creation

### Intent

Creating "Sara" when "Sarah" already exists usually means the user wants the same character. Offer, in a popup, to record the new name as an **alias** of the existing character (DES's alias system then canonicalizes tracker data automatically at every ingestion path) instead of birthing a duplicate card.

### Where it hooks

`commitNewCharacter()` in `src/systems/ui/characterRoster.js:312` — the single manual-creation entry point (the "+ New Character" tile in the roster, both NPC and User modes). After the existing exact-dup guard (line 324) and **before** the create:

1. Build the candidate pool: canonical names from `getAllExistingCharacterNamesLower()`'s sources **plus all existing aliases** (`extensionSettings.characterAliases` values).
2. Run the similarity check (below). No match → create exactly as today.
3. Match → show a choice dialog instead of silently creating.

Not hooked (deliberately): the bulk import flows (`importFromSillyTavernCards` / `importFromSillyTavernPersonas` / `importCharacterPayload`) keep exact-match dedup — a per-item popup during a 30-card import is hostile; noted as an optional follow-up (summary toast). The tracker **auto-adoption** path (`persistence.js:811`) also stays untouched: it consumes already-canonicalized data (`applyCharacterAliases` runs at ingestion), so aliases already prevent auto-dupes there, and a popup mid-generation would be wrong.

### Similarity algorithm — new `src/utils/nameSimilarity.js` (~40 lines, no deps; repo has no fuzzy utility today)

Normalize both names (trim, lowercase, Unicode NFD + strip combining marks, collapse whitespace), then flag **similar** when any of:

- **Edit distance:** Levenshtein ≤ 1 for length ≤ 5, ≤ 2 for longer ("Sara"/"Sarah", "Nyx"/"Nix", "Katherine"/"Catherine").
- **Token containment:** one name's token set is a subset of the other's ("Sarah" vs "Sarah Greenfield" — the exact scenario the alias feature was built for, per `characterAliases.js` docs).
- **Prefix:** existing `namesMatchLoose()` semantics (`a === b`, `a.startsWith(b + ' ')`, reverse).

Return the best match (lowest distance, canonical names preferred over alias hits; when the hit is an alias, resolve to and report the canonical owner). Exact-equality is already handled by the guard above, so the utility only ever sees genuinely-new names.

### UI — extend the existing inline dialog (`#cr-newchar-overlay` in `template.html`)

Per repo idiom (the roster already uses an inline overlay; ST `callGenericPopup` nests poorly over DES modals on mobile), add a hidden "similar name" panel inside the same overlay. On match, hide the name-input row and show:

> **"Nyx" looks similar to existing character "Nix".**
> Did you mean the same character?
>
> `[Add "Nyx" as an alias of Nix]`  `[Create separate character]`  `[Cancel]`

- **Add as alias** → `extensionSettings.characterAliases['Nix'] = [...(existing || []), 'Nyx']`; `saveSettings()`; toast; close dialog; open the Workshop for **Nix** (via the existing `dooms:open-workshop` event) so the user sees the alias chip land in Identity → Aliases. This is byte-identical to the write `commitDraft()` does at `characterWorkshop.js:1847-1855`, so the Workshop's alias UI, `resolveCharacterAlias`, and all four ingestion chokepoints pick it up with zero extra work.
- **Create separate character** → fall through to today's create path unchanged.
- **Cancel** → back to the name input.

Mode details:

- **NPC mode:** full three-way dialog as above.
- **User mode (`rosterMode === 'users'`):** aliases are NPC-only (`addAlias` guards `draft.isUser`; `applyCharacterAliases` rewrites NPC tracker data). Offer a two-way warning instead — "similar to existing character X — create anyway / cancel" — no alias option. This still prevents the accidental-duplicate without inventing a user-alias concept.
- **New name matches an existing alias exactly:** today this creates a doomed card (tracker data using that name is canonicalized away to the alias owner, so the new card never receives data — a real latent bug). The panel should say "'Sarah Greenfield' is already an alias of Sarah" with `[Open Sarah in Workshop]` / `[Create anyway (not recommended)]` / `[Cancel]`.

### Regression safety (Part 3)

- Zero change when no similar name exists — the check adds one in-memory scan over a few dozen names.
- Alias write path is the exact shape the Workshop already produces; nothing new to migrate or resolve.
- Import flows and auto-adoption untouched.
- The dialog is additive markup inside an existing overlay; Enter-key flow (`#cr-newchar-input` keydown) routes through the same `commitNewCharacter`, so both click and keyboard paths get the check.

---

## Cross-cutting: file-by-file change list

| File | Part | Change |
|---|---|---|
| `src/systems/ui/fullsheetButtons.js` | 1 | Multi-signal `messageHasFullSheet`; export `SECTION_HEADER_SOURCE`; extract `injectFullSheetButtonForMessage` |
| `index.js` | 1 | Use shared helper; add injection on swipe / edit / generation-end |
| `src/systems/ui/characterSheet.js` | 1, 2 | Parser uses shared regex source; quicksheet fallback parser; `rawTags`; notes-mode branch in `openCharacterSheet`; notes CRUD handlers in `initCharacterSheet` |
| `template.html` | 1, 2, 3 | Settings-blurb troubleshooting line; notes toggle in sheet popup; similar-name panel in `#cr-newchar-overlay` |
| `style.css` | 2, 3 | Note edit controls; similar-name panel styles (reuse existing button/section classes) |
| `src/systems/ui/characterRoster.js` | 3 | Similarity hook + dialog wiring in `commitNewCharacter`; include aliases in candidate pool |
| `src/utils/nameSimilarity.js` | 3 | New: normalize + levenshtein + token/prefix heuristics |
| `tools/sheet-detect-test.mjs` | 1 | New: fixture-table unit test for detector + parser |
| `CHANGELOG.md`, `whatsnew.json`, `docs/parity-checklist.md` | all | Document; make the quicksheet parity claim true |

Suggested implementation order: **Part 1** (bug, self-contained, ships alone) → **Part 3** (small, isolated) → **Part 2** (largest UI surface). Each part is independently shippable and revertible.

## Verification checklist (run per part, all before release)

1. `node tools/load-check.mjs` — whole module graph links (the repo's mandatory pre-push gate).
2. `node tools/sheet-detect-test.mjs` — detector/parser fixture table green, including one **real** pasted `!fullsheet` and `!quicksheet` reply (see Part 1 caveat).
3. Manual, in ST: old-format sheet, carrot-format sheet, dropdown-edition sheet, quicksheet → button appears on each (streamed and non-streamed); import each → popup renders sections; stat-block message (`HP 45/100` / `MP 30/50`) → **no** button; swipe to a sheet swipe → button appears; edit a message to contain a sheet → button appears.
4. Notes mode: toggle on/off round-trip preserves imported sheet; add/edit/delete/reorder sections; content survives chat switch and ST reload (per-chat metadata); Copy Sheet copies notes; second chat with same character has independent notes (per-chat by design — matches existing sheet storage).
5. Alias prompt: "Sara" vs existing "Sarah" → dialog; alias lands in Workshop → Identity → Aliases; tracker output using "Sara" canonicalizes to "Sarah" (portrait/color/sheet stay attached); "create separate" and cancel paths; user-character mode shows warning without alias option; bulk imports show no per-item popups.
6. Regression sweep of adjacent features: portrait-bar right-click → Character Sheet still opens; Stats tab; hero-art reposition; Workshop save round-trip with aliases; chat-bubble / inline-thoughts decorations still applied on swipe & edit (the handlers being extended).
