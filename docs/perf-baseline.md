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

(Add a table per phase as completed.)
