# The Rebuild: Philosophy & Continuation Guide

This document explains *how to think* about performance work in Doom's
Enhancement Suite. It was written at the end of the original `Rebuild` effort
(v1.11.3 → v1.12.0) and is addressed to whoever works on this codebase next —
human or AI. Read this before optimizing anything.

Companion documents:
- `docs/perf-baseline.md` — what was measured, what changed, phase by phase
- `docs/parity-checklist.md` — the feature list every change must keep passing

---

## Part 1 — Philosophy

### 1. Feature parity is the contract, performance is the craft

The single rule of the rebuild: **every feature keeps working identically from
the user's perspective.** Performance work that breaks or degrades a feature
isn't optimization, it's regression with good intentions. When a change forces
a choice between "faster" and "identical," identical wins, and you find a
different way to be faster.

Corollary: the parity checklist is part of the codebase. If you add a feature,
add its line. If you remove one deliberately, replace the line with a note
saying why (see the chapter-checkpoints and loading-intro entries).

### 2. Measure, then verify, then delete — never trust labels

The biggest single wins in the rebuild came from **dead code**, and dead code
lies about itself:

- All 3 MutationObservers in the codebase were in a module that was *never
  imported*. The "observer problem" was fictional.
- The CSS sections labeled `[ARCHIVED]` contained **live** styles (lock icons,
  user portraits, inline-edit forms) interleaved with dead ones. Deleting by
  section label would have broken the UI. Deleting by *verified selector
  reference* was safe.
- A whole combat-encounter modal (~137 CSS rules) had zero JS references and
  no label saying so.

The discipline that made deletion safe:
1. Extract every candidate token (class/id/function/file).
2. Grep the **entire** reachable surface (`src/`, `index.js`, `template.html`,
   `settings.html`) with word-boundary matching — substring grep gives false
   "live" results (`rpg-inventory` vs `rpg-inventory-empty`).
3. Delete only what has zero references. Keep mixed selector groups.
4. After deleting rules, re-scan for orphaned `@keyframes`.

Never delete because a comment says "archived." Never keep because a comment
says "important." Comments describe the past; references describe the present.

### 3. Pay-for-what-you-use beats pay-up-front

The architecture rule that produced the largest structural wins: **code, CSS,
and DOM should not exist until the feature that needs them is actually used.**

What this looked like in practice:
- `template.html` (165KB of modal-only markup) loads on *first modal open*,
  not at startup. Key insight: it contained nothing the chat path needed —
  finding that boundary made the whole deferral trivial and safe.
- ~9,200 lines of modal-only JS (lorebook cluster, workshop, roster, sheet,
  editors, inspector modal) are dynamic `import()`s behind the same boundary.
- CSS is split: eager core vs `styles/modals.css` (with the template),
  `styles/weather.css` (when weather/snowflakes enable), `styles/perf-mode.css`
  (only while the mode is on — so its broad selectors cost zero otherwise).

The generalizable test: *"if the user never opens X, what do they download,
parse, and hold in memory for X?"* The right answer is "nothing."

A note on boundaries: the original plan called for splitting the settings UI
into 14 per-accordion fragments. During implementation it turned out ONE
boundary (the whole template) captured ~the same win with a fraction of the
seams. Prefer the coarsest boundary that achieves the goal — every seam is a
place hydration, i18n, badges, or deep links can break.

### 4. The browser's invariants, not micro-optimizations

Most of the rendering wins came from respecting four browser facts:

1. **DOM you rebuild is DOM you re-pay for.** Full `innerHTML` rebuilds
   (`$el.html(cards.join(''))`) destroy focus, animations, scroll position
   AND force parse+layout for unchanged content. The fix is keyed
   reconciliation (`src/utils/domDiff.js`): match children to data by key,
   patch only what changed, insert/remove only what appeared/departed.
   Pair it with a per-item HTML string cache so "unchanged" is a string
   compare, not a DOM compare.

2. **One animation frame, reads before writes.** Interleaved reads and writes
   force synchronous reflow; N event handlers doing N renders in one frame do
   N× the work. `src/core/scheduler.js` exists so everything renders at most
   once per frame, reads first, writes second, deduped by key. Route new
   render paths through it.

3. **Every infinitely-animating element is a permanent GPU tax.** ~100
   CSS-animated particle divs were each a compositor layer animating even
   when invisible. The replacement (`src/systems/ui/particleCanvas.js`) is
   ONE canvas, ONE rAF loop, and — critically — the loop **fully stops**
   (not "skips frames") when the tab is hidden, `prefers-reduced-motion` is
   set, performance mode is on, or no effects are active. The "fully stops"
   part is the point: a paused loop costs zero; a throttled loop still wakes
   the CPU.

4. **`backdrop-filter`, `filter: blur()`, and huge `box-shadow` are per-frame
   costs, not one-time costs.** They re-execute on every repaint of anything
   beneath them. Don't add new ones to elements that are always on screen.
   Performance mode exists as the user's escape hatch (`body.dooms-perf-mode`
   + the kill-sheet); keep it absolute — any new always-on effect must die
   under it.

Also: store per-element state in `WeakMap`s keyed by the element (see
chatBubbles' original-HTML map), never in `data-*` attributes holding large
strings. WeakMap entries are garbage-collected with the element; attributes
double the DOM's memory footprint and live as long as the node does.

### 5. Events over observation, delegation over per-element binding

- Subscribe to SillyTavern's event bus (`CHAT_CHANGED`,
  `CHARACTER_MESSAGE_RENDERED`, `MESSAGE_SWIPED`, ...) instead of watching
  the DOM with MutationObservers. ST already tells you when things change.
- **All** subscriptions go through `registerAllEvents()` in
  `src/core/events.js` so they're tracked and `unregisterAllEvents()` can
  tear everything down. No ad-hoc `eventSource.on()` in feature code.
- Per-message work happens in per-message events; full-chat passes happen
  ONLY on `CHAT_CHANGED` (or a settings change). If a handler walks all of
  `#chat .mes` on every message, it's a bug — make it incremental and record
  where the last pass ended (see `injectSceneTransitions`).
- Bind delegated handlers on stable roots (`#chat`, a panel container,
  `document`), never inside render loops.
- Touch/scroll listeners that never call `preventDefault` must be native
  `addEventListener(..., { passive: true })` — jQuery cannot register passive
  listeners, and a non-passive document-level touch handler delays every
  scroll gesture on mobile.

### 6. The LLM is hardware too

Tokens are compute. The tracker instructions ride on *every* generation, so
their size is a per-message tax on the user's API bill or local GPU. The
compact-prompt work halved it — but the **parser is the contract**: the JSON
keys, shapes, and code-block format must not change, only the prose around
them. Anything that asks the model for more output (new fields, extra calls)
needs to justify its per-message cost.

### 7. Risk management: how to change a codebase you can't run

This extension can't be executed in a sandbox — verification happens in the
user's browser. The techniques that made large changes safe anyway:

- **Verbatim code motion first, behavior change second.** The 1,500-line
  settings binder moved out of `initUI` *unchanged* (same closure-free code,
  same order), then the call site changed. Two commits, each reviewable.
- **Hoist-audit when deferring.** Before deferring a block, list every
  top-level call in it and classify: popup-only (defer) vs global side effect
  (hoist to eager). The rebuild found six global appliers buried in the
  settings binder (`applyChatBubbleSettings`, `applyHideStTopBar`, the
  doom-counter listener, fullsheet buttons...) — missing one means a feature
  silently dies until the user opens settings.
- **Escape hatches for judgment calls.** Compact prompts default ON only for
  fresh installs; existing installs keep the verbose prompts their setups
  were tuned on. When you can't prove equivalence, make the new behavior
  opt-in/opt-out and additive.
- **Additive-only settings migrations.** Follow the `=== undefined` pattern
  at the tail of `loadSettings()` in `src/core/persistence.js`. Never
  restructure `chat_metadata.dooms_tracker` or existing settings keys —
  users' chats depend on them.
- **Granular commits, shippable at every point.** ~25 commits, each one a
  working extension. When something breaks in the field, `git bisect` finds
  it in minutes.
- **Scripted edits over hand edits for repetitive surgery.** CSS
  partitioning, dead-rule purges, and the initUI splice were done with
  small parsers that *verify their anchors* (`assert old in src`) so a
  drifted file fails loudly instead of corrupting silently. Always check
  brace balance after CSS surgery and `node --check` after JS surgery.

### 8. Adapt the plan to what the code teaches you

Three plan-vs-reality lessons from the rebuild worth internalizing:

- The plan said "replace 3 MutationObservers with events." Reality: they were
  dead code. Investigation before implementation saved a useless refactor.
- The plan said "split the template into 14 fragments." Reality: one boundary
  was strictly better. The goal was startup cost, not fragment count.
- The plan said "full feature registry with teardown semantics." Reality: the
  load-side win was achievable without changing toggle semantics (the flagged
  parity trap), so teardown was deferred until in-browser verification exists.
  **Don't ship semantics changes you can't test just because a plan listed
  them.**

---

## Part 2 — Continuation guide for future sessions

### The architecture you're inheriting

```
manifest.json          → index.js (eager) + style.css (eager core only)
index.js               bootstrap, event map, eager init, deferred-UI loader
src/core/
  scheduler.js         schedule(key, job, 'read'|'write') — one rAF flush/frame
  events.js            registerAllEvents/unregisterAllEvents (tracked bus subs)
  lazyUI.js            ensureSettingsUI() — gate for ALL modal entry points
  cssLoader.js         ensureCss(id)/removeCss(id) → styles/<id>.css
  perf.js              perfMark/perfMeasure (no-op unless localStorage.doomsPerfDebug)
  state.js             settings defaults  ·  persistence.js  additive migrations
src/utils/domDiff.js   keyedReconcile(container, items, {key, create, update, ...})
src/systems/ui/
  particleCanvas.js    shared canvas engine (+ createParticleEngine for overlays)
  fullsheetButtons.js  eager half of character sheet (detection/buttons/cache)
styles/
  modals.css           loads with the deferred template
  weather.css          loads when weather/snowflakes enable
  perf-mode.css        injected ONLY while performance mode is on
```

Deferred behind `ensureSettingsUI()` (first modal open): template.html, the
~1,500-line settings binder (`bindSettingsUI` in index.js), and dynamic
imports of the lorebook cluster, character workshop/roster/sheet, tracker
editor, and inspector modal.

### Conventions — follow these or the architecture decays

1. **New render path?** Route it through `schedule()` and use
   `keyedReconcile` if it manages a list. Never `.html(bigString)` a
   container that survives across renders.
2. **New event subscription?** Add it to the `registerAllEvents` map in
   index.js (or use a named handler there). Never raw `eventSource.on` in
   index.js; module-internal subscriptions need a teardown path.
3. **New modal/dialog?** Markup goes in template.html, CSS in
   `styles/modals.css`, init in `loadSettingsTemplate()` (dynamic-import the
   module if it's big), and every out-of-modal entry point must
   `ensureSettingsUI().then(...)` first. Grep for how the inspector was
   ported (`4f02790`) — it's the template to copy.
4. **New always-on visual effect?** It must respect `dooms-perf-mode`,
   `document.hidden`, and `prefers-reduced-motion`. Particles go on the
   canvas engine, not DOM. No new `backdrop-filter` on persistent elements.
5. **New setting?** Default in `state.js`, `=== undefined` additive migration
   in `persistence.js`, populate + handler in `bindSettingsUI`, row in
   template.html. Look at `performanceMode` for the four touchpoints.
6. **New per-element state?** WeakMap keyed by element, or a module Map that
   is bounded (cleared on chat change / capped / evicted in `onExit`).
7. **Touching the prompt pipeline?** The parser (`parser.js` + `jsonRepair.js`)
   defines the contract. Prose can change; keys, shapes, and the single
   unified code block cannot. Gate phrasing changes behind `compactPrompts`.
8. **Every change:** `node --check` all touched JS; brace-balance check after
   CSS edits; update `docs/parity-checklist.md` and `docs/perf-baseline.md`;
   one logical change per commit with measured numbers in the message.

### How to find the next win (the method, in order)

1. **Hunt dead code first.** Cheapest wins, zero risk when verified. Method:
   pick a module/CSS section → extract its tokens → word-boundary grep across
   the whole reachable surface → zero refs = delete. Re-run the orphan
   keyframe check after CSS deletions.
2. **Ask the pay-for-what-you-use question** about anything eager: "who needs
   this at startup?" If the answer is "only feature X," move it behind X's
   activation (dynamic import / ensureCss / deferred init).
3. **Trace one message's lifecycle** in the Performance panel: receive →
   handlers → renders. Anything O(chat length) per message, any double
   render in one frame, any forced reflow is a target.
4. **Audit idle:** with the tab visible and idle, GPU/CPU should be ~0 with
   performance mode on, and near-0 off. Find what's still animating.
5. **Count what ships:** bytes fetched at startup (Network panel, cache
   disabled). The eager payload should only ever shrink.

### Concrete backlog (known, scoped, in rough value order)

1. **Full feature registry with real teardown** (original plan Phase 6).
   Infrastructure exists in spirit (`events.js` tracking, `removeCss`,
   `destroy()` on the particle engine). The work: per-feature
   `{ load(), start(ctx), stop(ctx) }` wrappers where disable = teardown
   (listeners off, DOM removed, CSS unlinked) instead of early-return flags.
   **Do not attempt without in-browser toggle-cycle testing** — double-bind
   on re-enable and DOM residue on disable are the known traps. Convert one
   feature per commit, least-coupled first (nameBan → doomCounter → weather →
   expressionSync → lorebook → sceneTracker → portraitBar → chatBubbles).
2. **Split the remaining eager CSS further** (~300KB core). Biggest chunks
   left: themes (could load only the active theme's variable set + lazy-load
   others on switch), quests, thought overlays, FAB widget theme variations,
   character-sheet leftovers. Use the rule-level partition approach from
   Phase 7 (curated token prefixes, mixed groups stay in core); the script
   pattern is in the commit history (`0d9bc2d`).
3. **`!important` reduction** (~500 remain). Only while moving rules anyway:
   keep ones that beat ST core styles, fix ones that beat DES's own rules by
   scoping. Don't chase zero.
4. **Settings binder decomposition.** `bindSettingsUI` is one 1,500-line
   function; splitting it per accordion section (pure code motion) would
   enable per-section lazy bind and make conflicts rarer. Low urgency — it
   already runs only on first modal open.
5. **Tracker example payload.** `generateTrackerExample` re-sends the full
   previous tracker JSON every generation. Investigate whether locked/static
   fields can be elided like instructions were (same escape-hatch pattern as
   `compactPrompts`).
6. **Expression sync LLM calls.** Per-message classification when enabled.
   Candidates: batch window, skip when the speaker's sprite didn't change,
   cache by (speaker, text-hash).
7. **Heap audit in the field.** The detached-node and listener-count checks
   in `docs/perf-baseline.md` were never run in a real browser. Run them;
   fix what they find.
8. **i18n key pruning.** en.json (21KB) loads eagerly; entries for removed
   features (intro, checkpoints, encounters, dice, stats) can be purged with
   the same verify-then-delete method.

### What NOT to do

- Don't add a build step / bundler. ST installs this repo by git clone; the
  no-build constraint is structural. (Also: keep the repo light — assets get
  cloned by every user. The 397KB of icons we deleted shipped to every
  install forever.)
- Don't "optimize" by removing features or fidelity. Visual richness is the
  product; the job is making it cheap, not making it less.
- Don't restructure stored data (settings keys, `chat_metadata.dooms_tracker`,
  per-swipe data). Additive only.
- Don't trust this document over the code. Re-verify the way the rebuild did —
  the next dead-code discovery is probably mislabeled too.
