# Doom's Enhancement Suite for SillyTavern

A comprehensive enhancement extension for SillyTavern that adds character tracking, scene management, plot twist generation, chat bubbles, character sheets, and deep customization to your roleplay experience.

This extension was entirely vibe-coded using Claude Code. It started as a fork of SpicyMarinara's RPG Companion and has since been heavily modified and expanded. Their extension is fantastic — check it out if you haven't.

This is a work in progress. Constructive criticism and contributions are welcome.

## Installation

1. Open SillyTavern
2. Go to the **Extensions** tab (puzzle piece icon at the top)
3. Click **Install Extension**
4. Paste this URL:
   ```
   https://github.com/DangerDaza/Dooms-Enhancement-Suite
   ```
5. Click Install, then reload the page

Once installed, enable the extension in **Extensions > Doom's Enhancement Suite** and open the settings panel (the **D** icon) to configure everything.

---

## Features

### Present Characters Panel
A horizontal card shelf displaying character portraits between the chat and input area. Tracks every character in the scene with their portrait, relationship to the player, internal thoughts, status, and up to 8 custom tracker fields. Each character gets their own card with an avatar (custom uploaded, auto-imported from SillyTavern character cards, or emoji fallback). Shows present characters with hover glow effects and animated pulses when a character is speaking. Absent characters can be shown greyed out. Right-click any portrait to upload a custom image, set dialogue colors, remove characters, or open their character sheet. Fully customizable — card size, spacing, border radius, colors, glow intensity, and positioning (above input, below input, or top of screen). Supports a palette of 30 distinct dialogue colors to prevent collisions in large casts. Supports per-chat character tracking — when enabled, each chat maintains its own independent character roster so characters don't bleed between conversations.
<img width="1443" height="372" alt="image" src="https://github.com/user-attachments/assets/91039d6c-0e98-4fb2-953e-e7195230a7a4" />

### Character Expressions Sync
Mirrors SillyTavern's active Character Expressions into the Present Characters portraits in real time. When a character speaks, their portrait updates to match their current expression sprite and persists until they speak again. Optional toggle to hide SillyTavern's native expression display.

### Character Sheets (Bunny Mo Integration)
Right-click any character in the portrait bar and select **Character Sheet** to open a full popup with the character's art on the left and a detailed character sheet on the right. Compatible with Bunny Mo's `!fullsheet` and `!quicksheet` commands — run either in chat, click the import button on the resulting message, and the sheet auto-populates with collapsible sections. Sheet data persists per-chat. Enable via the **Bunny Mo Integration** toggle in settings.

### Scene Tracker
Compact scene info blocks injected after assistant messages in chat. Displays time, date, location, weather, present characters, active quest, and recent events. Placed outside the message text so TTS won't read them. Multiple layout modes available:
- **Grid** — 2-column layout
- **Stacked** — single column
- **Compact** — inline flow
- **Banner** — horizontal strip after the last message
- **HUD (Floating Panel)** — frosted-glass panel, fully draggable with position persistence
- **Ticker** — collapsible bar pinned to top or bottom of chat
<img width="1426" height="357" alt="image" src="https://github.com/user-attachments/assets/7d4ab31e-2fd0-4f70-ab0f-6a85665b166e" />

### Dynamic Weather Effects
Visual weather effects that respond to the current scene weather. Rain, snow, wind, and other atmospheric particles render as an overlay on the chat, with automatic detection of indoor vs outdoor scenes.

### Chat Bubbles
Splits multi-character AI messages into individual styled chat bubbles per speaker. Two styles available:
- **Discord Style** — full-width message blocks with character names
- **Card Style** — rounded card bubbles
<img width="1241" height="1081" alt="image" src="https://github.com/user-attachments/assets/43e1d5d2-3216-4d01-841e-dbff6805afc8" />

Works automatically by detecting speaker changes through dialogue coloring.

### Doom Counter (Plot Twist Generator)
A tension-driven plot twist system that keeps your story from stagnating. The AI rates each scene's tension on a 1–10 scale behind the scenes. When things stay too calm for too long, a countdown activates — and when it hits zero, you're presented with a set of AI-generated plot twist cards to choose from. Pick one and it gets woven into the next response.

**How it works:**
- The AI silently reports a tension score (1–10) with every response
- Low-tension responses (≤ ceiling, default 4) build up a streak counter
- Once the streak hits the threshold (default 5), a visible countdown begins
- Lower tension = faster countdown (tension 1 drops by 3, tension 2 by 2)
- At zero, a modal appears with twist options generated from your current scene context
- Select a twist and it's injected into the next AI generation, then counters reset

**Configurable settings:**
- **Low Tension Ceiling** (2–6) — what counts as "too calm"
- **Low Tension Threshold** (3–10) — how many calm responses before countdown starts
- **Countdown Length** (1–8) — starting countdown value
- **Twist Choices** (2–6) — number of twist options generated
- **Context Messages** (5–30) — how many recent messages the twist generator sees
- **Message Truncation** (200–3000) — max characters per message in the twist prompt
- **Injection Depth** — where the twist instruction is inserted in the prompt
- **Debug mode** — shows live tension/streak/countdown in scene headers
- **Trigger Now** button for manual activation

### Lore Library (Lorebook Manager)
A full-featured lorebook manager that replaces SillyTavern's native World Info interface. Organize your world info books into named library folders with custom icons and colors. Features include:
- Per-library and master toggle-all buttons
- Inline entry editing
- Search and filter across books
- Bulk visibility controls
- Drag-to-reorder libraries
- Token count estimates
<img width="1557" height="2380" alt="image" src="https://github.com/user-attachments/assets/cad2d576-480e-446e-8d3f-bc1abd1e96b4" />

### Quest Tracking
Track a main quest and multiple optional side quests. Quests appear in scene headers and are included in the AI's generation context. All quests are editable inline with lock support.

### Dialogue Coloring
Automatically colors each character's dialogue with unique colors from a 30-color palette. The AI generates `<font color>` tags that display in chat while being automatically stripped for TTS playback. Works seamlessly with chat bubbles.

### Thought Bubbles
Displays the character's internal thoughts as floating bubbles directly within chat messages. See what characters are thinking alongside their dialogue.
<img width="1215" height="723" alt="image" src="https://github.com/user-attachments/assets/d849e93c-3f86-4aba-91fe-fbaa87fe6529" />

### Per-Swipe Data
Each message swipe preserves its own tracker data independently. Swipe back and forth and each version keeps its own scene state, character data, and quest progress.

### History Persistence
Save and restore tracker history snapshots. Useful for branching storylines or recovering from bad generations.

---

## Troubleshooting

### System Log
Captures all Doom's Enhancement Suite console messages with timestamps. Open from the bottom of the settings panel to review extension initialization, generation events, and errors.

### Notification Log
Captures every SillyTavern toast notification (API errors, system messages, warnings, etc.) so you can scroll back and see what happened even after the pop-up disappears. Includes Copy All for easy bug reporting.

---

## Customization

### Themes
Choose from pre-built themes (Default, Sci-Fi, Fantasy, Cyberpunk) or create your own with full color picker controls for background, accent, text, highlight, stat bars, and per-element opacity.

### Settings Panel
<img width="1380" height="377" alt="image" src="https://github.com/user-attachments/assets/e27027e6-a4bb-42a4-8da4-e206a49a6427" />

<img width="1182" height="1474" alt="image" src="https://github.com/user-attachments/assets/5042424e-10a0-4644-af0b-ab0fc93b9fee" />

The settings panel (accessed via the **D** icon) is organized into sections:
1. **Display & Features** — Toggle every feature on/off individually
2. **Theme** — Colors, animations, stat bar gradients
3. **Present Characters Panel** — Portrait bar layout, card sizing, colors, effects, per-chat tracking, expression sync
4. **Bunny Mo Integration** — Character sheet support with fullsheet/quicksheet import
5. **Scene Tracker** — Field visibility, layout mode (grid/stacked/compact/banner/HUD/ticker), sizing, colors
6. **Doom Counter** — Tension thresholds, countdown, twist generation, advanced prompt tuning
7. **Chat Bubbles** — Style, speaker detection, color integration
8. **History Persistence** — Save/restore tracker snapshots
9. **Lore Library** — Lorebook organization and management
10. **Advanced** — Generation settings, prompt editing, debug options

### Prompt Editing
Customize the generation prompts for HTML formatting, dialogue coloring, twist generation, and avatar generation through the built-in prompts editor.

---

## Mobile Support

Fully responsive design with touch-friendly controls. All panels adapt to small screens with a dedicated mobile toggle and draggable FAB button.

---

## Credits

- Originally forked from [marinara_spaghetti's RPG Companion](https://github.com/SpicyMarinara) extension
- Character Expressions sync contributed by **Tremendoussly**
- Twist generator prompt contributed by **thekittymix**

## License

This program is free software under the [GNU Affero General Public License v3.0](LICENSE).
