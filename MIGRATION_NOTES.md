# DES Performance Refactor - Migration Notes

## Overview

This refactor introduces a performance infrastructure layer into Doom's Enhancement Suite
without breaking existing functionality. The approach is **additive and incremental** —
existing system modules under `src/systems/` are preserved in place, while new core
infrastructure and feature wrappers add caching, deduplication, batched DOM updates,
and instrumentation on top of them.

## What Changed

### New Core Infrastructure (`src/core/`)

| File | Purpose |
|------|---------|
| `eventBus.js` | Central event router — subscribes once to ST lifecycle events, computes state diffs, notifies features only when relevant state changed. Batches via rAF. |
| `stateStore.js` | Caches `getContext()` snapshots with reference equality checks. Avoids redundant recomputation of chat, characters, metadata. |
| `frameScheduler.js` | RAF-based DOM read/write scheduler. Separates reads (measurements) from writes (mutations) to prevent layout thrashing. Auto-pauses when tab is hidden. |
| `perf.js` | Lightweight Performance API instrumentation. `DESPerf.mark()`, `.measure()`, `.time()`. Silent unless debug mode enabled. |
| `diffEngine.js` | (Pre-existing) State diff computation — `shallowEqual`, `deepEqual`, `diffSnapshots`. |
| `featureRegistry.js` | Feature module lifecycle manager with dependency-ordered init/enable/disable/destroy. |

### New Utility Modules (`src/utils/`)

| File | Purpose |
|------|---------|
| `debounce.js` | (Pre-existing) Full debounce with cancel/flush/pending. |
| `throttle.js` | (Pre-existing) Full throttle with cancel. |
| `dom.js` | (Pre-existing) `batchRead`, `batchWrite`, `batchReplace`, `reconcileChildren`, `safeQuery`, `toggleClass`. |
| `visibility.js` | (Pre-existing) IntersectionObserver wrappers, page visibility API. |
| `shared.js` | **New** — Extracted duplicated utilities: `escapeHtml`, `hexToRgb`, `namesMatch`, `clamp`. |

### Feature Module Wrappers (`src/features/`)

Thin performance wrappers around existing `src/systems/` modules:

| Feature | Wraps | Key Optimizations |
|---------|-------|-------------------|
| `presentCharacters/` | `ui/portraitBar.js`, `integration/expressionSync.js` | Throttled updates (250ms), skip when hidden, roster change detection |
| `sceneTracker/` | `rendering/sceneHeaders.js` | Throttled scene header updates (200ms), cached scene data by message ID |
| `chatBubbles/` | `rendering/chatBubbles.js` | WeakSet processed-node tracking, IntersectionObserver for offscreen messages, debounced bulk apply |
| `weather/` | `ui/weatherEffects.js` | Page-visibility-aware animation pause, weather state caching |
| `loreLibrary/` | `rendering/lorebook.js`, `ui/lorebookModal.js` | Debounced search/filter (200ms) |
| `doomCounter/` | `generation/doomCounter.js` | Throttled UI updates (500ms), context caching |
| `quests/` | `rendering/quests.js` | Skip re-render on unchanged data (deepEqual) |
| `tts/` | `rendering/thoughts.js` | Throttled thought updates (300ms) |
| `history/` | `core/persistence.js` | Debounced chat data saves (500ms), dirty tracking |

### Changes to `index.js`

- Added imports for core infrastructure modules
- Frame scheduler visibility binding at startup
- Performance debug mode tied to Doom Counter debug setting
- Event bus initialized after ST event registration
- All existing event handlers and UI bindings preserved unchanged

## Which Features Were Ported

All features remain functional through their original `src/systems/` implementations.
The feature wrappers in `src/features/` provide an optimized path that can be
incrementally adopted. Currently:

- **Phase 1 Complete**: Core infrastructure created and initialized
- **Phase 2 Complete**: Feature wrappers created with optimization layers
- **Phase 3 In Progress**: Feature wrappers available for opt-in use

## Compatibility Notes

### Settings Compatibility
- All `extension_settings` keys preserved — no changes to stored data format
- `settings.html` unchanged
- `manifest.json` unchanged
- All settings version migrations (v1-v24) preserved

### CSS Compatibility
- No CSS classes renamed or removed
- No DOM IDs changed
- All existing selectors continue to work
- User themes and custom CSS unaffected

### Behavioral Compatibility
- All 15+ features listed in the hard requirements continue to work identically
- Event handler registration order preserved
- SillyTavern lifecycle event responses preserved
- Per-swipe data format unchanged
- History persistence format unchanged
- Lorebook storage format unchanged

### Public API Compatibility
- All exports from `src/systems/` modules unchanged
- `src/features/` wrappers export the same interfaces
- No breaking changes to any module's public surface

## Intentionally Preserved Legacy Paths

1. **Direct `eventSource.on()` calls in `index.js`**: The event bus runs alongside
   existing direct subscriptions. Migrating individual handlers to the bus is a
   future optimization — currently both paths coexist safely.

2. **jQuery DOM manipulation**: Existing modules use jQuery extensively. The new
   DOM utilities (`batchRead`/`batchWrite`/`reconcileChildren`) are available but
   not yet integrated into all render paths. This is intentional — replacing jQuery
   calls in working code carries high risk for low immediate benefit.

3. **Dual JSON + text format parsing**: Every rendering module supports both v3 JSON
   and legacy text format. This is preserved for backward compatibility with old
   chat data.

4. **`getContext()` calls in system modules**: The state store caches context, but
   existing modules still call `getContext()` directly. These are gradually being
   replaced as features opt into the state store.

## Performance Improvements Made

1. **State caching**: `DESStateStore` avoids redundant `getContext()` calls by caching
   with reference equality checks
2. **Event deduplication**: `DESEventBus` computes state diffs once per event and only
   notifies features whose relevant state changed
3. **RAF batching**: `frameScheduler` separates DOM reads and writes to prevent
   layout thrashing, with auto-pause on tab hide
4. **Throttled/debounced updates**: Feature wrappers throttle high-frequency operations
   (portrait bar: 250ms, scene tracker: 200ms, thoughts: 300ms, doom counter UI: 500ms)
5. **Processed-node tracking**: Chat bubbles use WeakSet to avoid reprocessing already-styled
   DOM nodes
6. **Dirty tracking**: History persistence skips writes when data hasn't changed
7. **Visibility awareness**: Weather effects and frame scheduler pause when tab is hidden
8. **Instrumentation**: `DESPerf` provides zero-overhead timing when debug is off,
   with threshold-based logging when enabled

## TODO / Future Work

- [ ] Migrate remaining `eventSource.on()` handlers to DES Event Bus
- [ ] Replace direct `getContext()` calls in system modules with `DESStateStore.get()`
- [ ] Add virtualized rendering for Lorebook entries (large lists)
- [ ] Use canvas-based particle system for weather effects
- [ ] Extract context menu creation into a shared reusable component
- [ ] Consolidate `hexToRgb` usage across sceneHeaders.js and portraitBar.js to use `shared.js`
- [ ] Consolidate `namesMatch` usage across thoughts.js and portraitBar.js to use `shared.js`
