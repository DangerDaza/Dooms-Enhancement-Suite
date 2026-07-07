# Performance Baseline — branch `Rebuild`

Baseline taken at commit `ce4c73c` (v1.11.3). Re-measure the browser metrics on the same
machine/chat whenever a phase claims a win, and update the per-phase tables below.

## How to measure (Chrome DevTools, desktop)

All browser measurements use the same reference chat: **200+ messages, group chat,
all DES features enabled** (portrait bar, scene tracker grid mode, chat bubbles discord
mode, thoughts, weather on a "rain" scene, doom counter, lorebook enabled).

1. **Startup trace** — Performance panel, "Record and reload". Stop after the
   `[Dooms Tracker] initUI() rendering complete` console log. Record: total scripting ms,
   layout ms, and the cost of the template append (look for the long task around
   `renderExtensionTemplateAsync` / body append).
2. **Message-receive trace** — Record while one AI reply arrives
   (`CHARACTER_MESSAGE_RENDERED`). Record total scripting ms and the top 3 self-time
   functions.
3. **Idle GPU/CPU** — More tools → Performance monitor. 60s with weather active:
   (a) tab visible, (b) tab hidden. Record CPU % and GPU memory/usage.
4. **Heap** — Memory panel snapshot after loading the reference chat; swipe the last
   message 20×, snapshot again. Record JS heap size and detached-element count
   (filter "Detached").
5. **Eager payload** — Network panel (disable cache), bytes fetched at startup that
   belong to the extension (js modules + css + template + icons + i18n).

## Static baseline (measured in repo, commit ce4c73c)

| Asset | Bytes |
|---|---|
| style.css | 579,707 (21,114 lines, 3,139 rules, 71 @keyframes, 517 !important, 43 backdrop-filter) |
| template.html | 168,652 (2,651 lines, loaded into DOM at startup) |
| index.js | 153,925 (~2,984 lines, imports ~60 modules eagerly) |
| icon.png | 231,705 |
| icon.svg | 173,671 |
| settings.html | 4,999 |
| src/**/*.js total | ~32,616 lines |
| **Eager extension payload (approx)** | **~1.31 MB** (above) + all src modules |

Code-level counts (baseline):
- jQuery `.on()` bindings: 512
- `setTimeout` call sites: 97 (no polling loops)
- MutationObservers: 3 (checkpointUI.js)
- DOM particle elements: up to 100 (rain) + 50 (snow) + 25 (dust) + 5 (mist) + snowflakes overlay
- Tracker prompt injected per generation: ~2,700–3,000 chars full setup (~550–600 tokens)

## Browser baseline (fill in on reference machine)

| Metric | Baseline (ce4c73c) | Notes |
|---|---|---|
| Startup scripting ms | _TBD_ | |
| Startup layout ms | _TBD_ | |
| Template append long task ms | _TBD_ | |
| Message-receive scripting ms | _TBD_ | |
| Idle CPU % (weather, visible) | _TBD_ | |
| Idle CPU % (weather, hidden) | _TBD_ | ce4c73c already pauses weather when hidden |
| JS heap after reference chat | _TBD_ | |
| Detached elements after 20 swipes | _TBD_ | |

## Per-phase results

### Phase 1 — dead weight (DONE)
| Metric | Before | After |
|---|---|---|
| style.css bytes | 579,707 | 532,191 (−47.5KB: archived User Stats / Dice Roll / Inventory v2 rules + 3 orphan keyframes, selector-level purge) |
| icon.png bytes | 231,705 | 8,998 (160×160 palette) |
| icon.svg bytes | 173,671 | deleted (unreferenced) |
| Non-passive doc/scroll touch listeners | 3 | 0 (thought-panel scroll, FAB dismiss touchstart, mobile keyboard-dismiss touchend now native `{passive:true}`) |

### Phase 2 — event hygiene (DONE)
| Metric | Before | After |
|---|---|---|
| MutationObservers | 3 | 0 (all three were in dead-code checkpointUI.js — module deleted along with chapterCheckpoint.js) |
| Untracked eventSource.on subscriptions in index.js | 10 | 0 (all through registerAllEvents; unregisterAllEvents now tears down everything) |
| Dead CSS removed | — | combat-encounter modal (~137 rules) + checkpoint styles |
| Delegation audit | — | render modules (infoBox, quests, thoughts, portraitBar, bubble TTS) already container-delegated; no render-loop bindings found. Remaining per-element bindings are settings controls (restructured in Phase 5). |

### Phase 3 — render scheduler + incremental hot paths (DONE)
- New `src/core/scheduler.js` (one rAF flush/frame, read-before-write, key-deduped) and `src/utils/domDiff.js` (`keyedReconcile`).
- Portrait bar: full `.html()` rebuild → keyed in-place diff with per-card HTML cache; entrance effects only for genuinely new cards.
- Thoughts panel: keyed per-card diff inside a persistent wrapper; scroll/flip/focus state survives.
- Scene transitions: full chat re-walk → incremental (only new messages); full pass only on chat change/swipe/delete/style change.
- Chat bubbles: original HTML moved from `data-dooms-original-html` attributes into a WeakMap (GC'd with the element).

### Phase 4 — canvas particle engine (DONE)
- All high-count particles (snow 50 / rain 100 / mist 5 / wind 30 / stars 68 / fireflies 15 / motes 25 / orbs 6) render on ONE canvas with ONE rAF loop; loop hard-stops on tab hide, reduced-motion, perf mode, or no effects. DOM keeps only ≤6 gradient overlays per scene.
- Weather keyword scan memoized; particle budgets scale down on small/low-core devices.
- style.css running total: 579,707 → 479,306 bytes.

### Phase 5 — deferred settings UI (DONE)
- template.html (165KB, all modal UI) + ~1,500 lines of control binding/population now load on FIRST modal open, not at startup. All entry points (FAB, dropdown button, WI interception, portrait context menu) gate on `ensureSettingsUI()`.

### Phase 6a — dynamic imports (DONE)
- Lorebook cluster + workshop + roster + character sheet + tracker editor (~9,200 lines JS) load only when a DES modal opens.

### Phase 7 — CSS split + performance mode (DONE)
- Eager style.css: 567KB baseline → 308KB. styles/modals.css (157KB) with deferred UI; styles/weather.css (17KB) and styles/loading-intro.css (5KB) conditional.
- Performance Mode toggle: body class pauses the particle engine + `styles/perf-mode.css` kill-sheet (injected only while on) strips all DES animations/transitions/backdrop-filters/filters.

### Phase 8 — compact prompts (DONE)
- `compactPrompts` (fresh installs: on; existing installs: off to preserve tuned behavior): ~halves the per-generation tracker instruction text with an identical JSON contract. Toggle in Advanced.

### Phase 9 — final (DONE)
- All caches audited (roster-bounded, TTL'd, or capped); swipe data remains per-message/per-swipe as before. shipped as the 2.0.0 "Rebuild" release (originally planned as 1.12.0).

## Headline summary vs baseline (static, measured in repo)

| Metric | Baseline (ce4c73c) | Rebuild |
|---|---|---|
| Eager CSS | 579,707 B | 308KB core (modals/weather/intro lazy) |
| Eager HTML parsed at startup | 168,652 B template | 0 (deferred to first modal open) |
| Eager JS modules | all (~32,600 lines) | ~9,200 lines deferred to first modal open |
| Icon assets | 405KB | 9KB |
| DOM particle nodes (weather worst case) | ~100+ CSS-animated layers | 1 canvas + ≤6 overlay divs |
| MutationObservers | 3 | 0 |
| Per-message render | full rebuilds (portrait bar, thoughts, transitions walk) | keyed diffs + incremental, one rAF flush per frame |
| Per-message original-HTML copies | DOM attribute per message | WeakMap (GC'd) |
| Tracker prompt (full setup) | ~2,700–3,000 chars | ~half with compactPrompts on |
| Idle GPU when tab hidden / perf mode | CSS animations kept compositing (pre-ce4c73c) | hard-stopped rAF + kill-sheet |
