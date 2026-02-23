# Doom's Enhancement Suite for SillyTavern

A comprehensive enhancement extension for SillyTavern. Track characters, highlight TTS playback, organize lorebooks, and customize everything with an extensive settings panel.
This extension was entirely vibe-coded using Claude Code. It started as a fork of SpicyMarinara's RPG Companion and has since been heavily modified and expanded. Their extension is fantastic — check it out if you haven't.
This is a work in progress. I've never built anything like this before, so constructive criticism is welcome.

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

### Info Box Dashboard
A visual dashboard that displays your current scene at a glance. Shows date, time, location, weather, and recent events in a card-based layout. All fields are editable inline — click any field to modify it. Lock individual fields to prevent the AI from changing them. Choose between Grid, Stacked, or Compact layouts with full color and sizing customization.

### Present Characters Panel
Tracks every character in the scene with their portrait, relationship to the player, internal thoughts, status, and up to 8 custom tracker fields. Each character gets their own card with an avatar (auto-generated, custom uploaded, or emoji fallback). All fields are editable with lock support.

### Portrait Bar
A horizontal card shelf displaying character portraits between the chat and input area. Shows present characters with hover glow effects and animated pulses when a character is speaking. Absent characters can be shown greyed out. Fully customizable — card size, spacing, border radius, colors, glow intensity, and positioning (above input, below input, or top of screen). Right-click any portrait to upload a custom image.
<img width="1443" height="372" alt="image" src="https://github.com/user-attachments/assets/91039d6c-0e98-4fb2-953e-e7195230a7a4" />


### Scene Tracker
Compact scene info blocks injected after assistant messages in chat. Displays time, date, location, present characters, active quest, and recent events right where you need them. Placed outside the message text so TTS won't read them.
<img width="1426" height="357" alt="image" src="https://github.com/user-attachments/assets/7d4ab31e-2fd0-4f70-ab0f-6a85665b166e" />


### Chat Bubbles
Splits multi-character AI messages into individual styled chat bubbles per speaker. Two styles available:
- **Discord Style** — full-width message blocks with character names
- **Card Style** — rounded card bubbles
<img width="1241" height="1081" alt="image" src="https://github.com/user-attachments/assets/43e1d5d2-3216-4d01-841e-dbff6805afc8" />


Works automatically by detecting speaker changes through dialogue coloring.

### TTS Sentence Highlight
Real-time sentence highlighting that follows along with SillyTavern's text-to-speech playback. The active sentence gets a gradient glow pill effect while read text fades and unread text stays dimmed. Uses browser speech boundary events for precision, with an intelligent timer fallback for voices that don't support boundary tracking. Fully customizable gradient colors, glow intensity, text opacity, and transition speed.

<img width="1207" height="630" alt="image" src="https://github.com/user-attachments/assets/bdda5416-31a5-4c6e-a883-0e3dc8d32cbe" />


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
Automatically colors each character's dialogue with unique colors. The AI generates `<font color>` tags that display in chat while being automatically stripped for TTS playback. Works seamlessly with chat bubbles.

### Auto-Avatar Generation
Automatically generates character portraits for NPCs using AI + Stable Diffusion (via SillyTavern's `/sd` command). Generates a description prompt, runs image generation, and stores the result for the portrait bar.

### Thought Bubbles
Displays the character's internal thoughts as floating bubbles directly within chat messages. See what characters are thinking alongside their dialogue.

### Per-Swipe Data
Each message swipe preserves its own tracker data independently. Swipe back and forth and each version keeps its own scene state, character data, and quest progress.

---

## Customization

### Themes
Choose from pre-built themes (Default, Sci-Fi, Fantasy, Cyberpunk) or create your own with full color picker controls for background, accent, text, highlight, stat bars, and per-element opacity.

### Settings Panel
<img width="1380" height="377" alt="image" src="https://github.com/user-attachments/assets/e27027e6-a4bb-42a4-8da4-e206a49a6427" />


<img width="1182" height="1474" alt="image" src="https://github.com/user-attachments/assets/5042424e-10a0-4644-af0b-ab0fc93b9fee" />

The settings panel (accessed via the **D** icon) is organized into sections:
2. **Display & Features** — Toggle every feature on/off individually
3. **Theme** — Colors, animations, stat bar gradients
4. **Portrait Bar** — Layout, card sizing, colors, effects
5. **TTS Highlight** — Gradient colors, glow, text dimming, transitions
6. **Scene Tracker** — Field visibility, layout mode, sizing, colors


### Prompt Editing
Customize the generation prompts for HTML formatting, dialogue coloring, and avatar generation through the built-in prompts editor.

---

## Multilingual Support

Available in English, Traditional Chinese, and Russian.

---

## Mobile Support

Fully responsive design with touch-friendly controls. All panels adapt to small screens with a dedicated mobile toggle.

---

## License

This program is free software under the [GNU Affero General Public License v3.0](LICENSE).

Originally forked from marinara_spaghetti's RPG Companion extension.
