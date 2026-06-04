# DES Performance Checklist

Manual test steps to verify the refactored extension works correctly and performs well.

## Pre-Test Setup

- [ ] Load SillyTavern with DES extension enabled
- [ ] Open browser DevTools Console
- [ ] Verify `[Dooms Tracker] ✅ Extension loaded successfully.` appears in console
- [ ] Verify `[Dooms Tracker] DES Event Bus initialized` appears in console
- [ ] Verify no errors in console during startup

## Core Feature Verification

### Present Characters Panel
- [ ] Portrait bar renders above chat input
- [ ] Characters appear with correct portraits
- [ ] Right-click context menu works on character cards
- [ ] Uploaded/custom portraits display correctly
- [ ] Expression sync updates portraits when enabled
- [ ] Per-chat character tracking persists across chat switches
- [ ] Adding/removing characters works from Workshop
- [ ] Side mode (left/right) positioning works
- [ ] Card size sliders update live

### Scene Tracker
- [ ] Scene header appears after last assistant message
- [ ] All layout modes work: grid, compact, stacked
- [ ] Time, date, location, characters, quest, events display correctly
- [ ] Optional fields (moon phase, tension, etc.) toggle correctly
- [ ] Color customization applies immediately
- [ ] Reset defaults restores all values
- [ ] Theme-controlled mode works

### Chat Bubbles
- [ ] Discord mode renders correctly
- [ ] Card mode renders correctly
- [ ] Narrator text styled correctly
- [ ] Character avatars appear in bubbles
- [ ] Dialogue coloring integration works (font colors preserved)
- [ ] Swipe between messages re-applies bubbles
- [ ] Edit message re-applies bubbles after 800ms delay
- [ ] Mode switching (off/discord/cards) reapplies cleanly

### Weather Effects
- [ ] Weather particles render when enabled
- [ ] Weather changes when scene weather changes
- [ ] Indoor/outdoor detection works
- [ ] Particles pause when tab is hidden (check CPU usage)
- [ ] Weather toggle enables/disables immediately

### Doom Counter
- [ ] Enable/disable toggle works
- [ ] Debug display shows counter in scene tracker
- [ ] Manual trigger button generates twist options
- [ ] Countdown mechanics work across messages
- [ ] Trap mode silently injects twists
- [ ] Reset button clears state
- [ ] Counter persists per-chat

### Lore Library
- [ ] Lorebook modal opens from settings and WI button
- [ ] Campaign grouping works
- [ ] Search/filter responds (should be debounced ~200ms)
- [ ] Inline editing saves correctly
- [ ] Bulk toggle works
- [ ] Large lorebook (100+ entries) doesn't freeze UI

### Quest Tracking
- [ ] Main quest displays and is editable
- [ ] Optional quests list works
- [ ] Quest data persists across messages
- [ ] Quest lock toggle works

### Dialogue Coloring
- [ ] Colored dialogue text renders in chat
- [ ] Colors survive chat reload
- [ ] TTS regex auto-configured for font tag stripping

### Thought Bubbles
- [ ] Character thoughts display in sidebar panel
- [ ] In-chat thoughts toggle works
- [ ] Character fields (appearance, demeanor) render
- [ ] Edit fields via contenteditable works

### History Persistence
- [ ] Enable toggle works
- [ ] Message count setting persists
- [ ] Injection position setting works
- [ ] Historical tracker data injected into context

### Character Sheet / Bunny Mo
- [ ] Character sheet import button appears on messages with sheet data
- [ ] Sheet import modal works
- [ ] Stats cache clears on chat change

### Settings Panel
- [ ] DES Settings popup opens from FAB button
- [ ] All accordion sections expand/collapse
- [ ] Language selector works
- [ ] All toggles save state
- [ ] Update extension button works
- [ ] Branch switch and reload works

## Performance Verification

### Startup Performance
- [ ] Extension loads without blocking SillyTavern UI
- [ ] Console shows init times (enable debug: `DESPerf.setDebug(true)`)
- [ ] No operations above 100ms during normal startup

### Chat Performance
- [ ] Sending a message doesn't cause visible jank
- [ ] Receiving a message (generation complete) updates UI smoothly
- [ ] Swiping between messages is responsive
- [ ] Deleting a message doesn't cause lag

### Long Chat Performance (100+ messages)
- [ ] Scrolling through chat is smooth (no bubble reprocessing)
- [ ] Scene tracker only processes relevant messages
- [ ] Chat bubbles don't re-apply to all messages on new message

### Tab Switching
- [ ] Switching away from tab pauses weather particles
- [ ] Switching back resumes weather particles
- [ ] Frame scheduler pauses when hidden (check `schedulerStats()`)

### Memory
- [ ] No unbounded growth in console (performance entries cleaned up)
- [ ] Portrait cache doesn't grow without bound
- [ ] Scene header cache clears appropriately

## Regression Checks

### No Duplicate Event Listeners
- [ ] Check console for duplicate handler warnings
- [ ] Verify events fire handlers only once per event

### No Feature Runs Twice
- [ ] Chat bubbles don't double-apply (check for nested bubble wrappers)
- [ ] Scene tracker doesn't inject duplicate headers
- [ ] Portrait bar doesn't re-render needlessly (check with throttle logs)

### Settings Persistence
- [ ] Change settings, reload page, verify they persist
- [ ] Switch characters, verify per-character preset loads
- [ ] Switch chats, verify per-chat data loads

### CSS/Theme
- [ ] All 5 themes render correctly (default, sci-fi, fantasy, cyberpunk, custom)
- [ ] Custom theme color pickers work
- [ ] User CSS overrides still apply
- [ ] No visual regressions in settings popup

## Debug Commands (Console)

```js
// Enable performance logging
DESPerf.setDebug(true);

// Check state store
DESStateStore.getSnapshot();

// Check event bus subscriptions
desEventBus.size;

// Check frame scheduler status
// (import { schedulerStats } from './src/core/frameScheduler.js')
```

## Browser Compatibility
- [ ] Chrome/Chromium
- [ ] Firefox
- [ ] Safari (if applicable)
- [ ] Mobile Chrome (responsive layout)
