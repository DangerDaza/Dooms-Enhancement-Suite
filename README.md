# Better Stats for SillyTavern

A comprehensive enhancement extension for SillyTavern that adds character tracking, scene management, plot twist generation, chat bubbles, character sheets, and deep customization to your roleplay experience.

Better Stats is a fork of [Doom's Enhancement Suite](https://github.com/DangerDaza/Dooms-Enhancement-Suite) by DangerDaza, renamed and extended with Character Stats (see below). Everything else described here comes from the original extension.

Doom's Enhancement Suite was entirely vibe-coded using Claude Code. It started as a fork of SpicyMarinara's RPG Companion and has since been heavily modified and expanded. Their extension is fantastic — check it out if you haven't.

This is a work in progress. Constructive criticism and contributions are welcome.

## Installation

1. Open SillyTavern
2. Go to the **Extensions** tab (puzzle piece icon at the top)
3. Click **Install Extension**
4. Paste this URL:
   ```
   https://github.com/Caged1994/Better-Stats
   ```
5. Click Install, then reload the page

Once installed, enable the extension in **Extensions > Better Stats** and open the settings panel (the **D** icon) to configure everything.

---

## Features

### Present Characters Panel

A horizontal card shelf displaying character portraits between the chat and input area. Tracks every character in the scene with their portrait, relationship to the player, internal thoughts, status, and up to 8 custom tracker fields.

Each character gets their own card with an avatar — custom uploaded, auto-imported from SillyTavern character cards, or emoji fallback. Shows present characters with hover glow effects and animated pulses when a character is speaking. Absent characters can be shown greyed out.

Right-click any portrait to open the Character Workshop (where custom images, dialogue colors, and knives are managed), open their character sheet, cancel a pending inject, or remove the character from the scene.

The Workshop puts the portrait on a full-height stage with the editing sections beside it as tabs. Once the Lore Library has a campaign, a **version strip** appears under the portrait: every character has a **Base** version plus any number of campaign versions (portrait, description, appearance prompt, relationship, knives, hero position). The "+" tile clones the version on the stage into a campaign; picking a tile crossfades to that version; the "×" removes it and the character falls back to Base in that campaign. Whichever campaign is active in the Lore Library decides which version the chat sees — the tile marked **Live**. Dialogue colour is per chat and aliases are global, so both are the same on every version.

NPCs support **Aliases** (Character Workshop → Identity): other names the AI might use for the same character — like a revealed full name ("Sarah Greenfield" for "Sarah"), a nickname, or a title. Tracker data using an alias resolves to the existing card instead of spawning a duplicate character, while the AI stays free to use the alias in prose. Fully customizable — card size, spacing, border radius, colors, glow intensity, and positioning (above input, below input, or top of screen).

Supports a palette of 30 distinct dialogue colors to prevent collisions in large casts. Per-chat character tracking is available — when enabled, each chat maintains its own independent character roster so characters don't bleed between conversations.
<img width="1443" height="372" alt="image" src="https://github.com/user-attachments/assets/91039d6c-0e98-4fb2-953e-e7195230a7a4" />

### Character Expressions Sync
Mirrors SillyTavern's active Character Expressions into the Present Characters portraits in real time. When a character speaks, their portrait updates to match their current expression sprite and persists until they speak again. Optional toggle to hide SillyTavern's native expression display.

### Character Sheets (Bunny Mo Integration)
Right-click any character in the portrait bar and select **Character Sheet** to open a full popup with the character's art on the left and a detailed character sheet on the right. Compatible with Bunny Mo's `!fullsheet` and `!quicksheet` commands — run either in chat, click the import button on the resulting message, and the sheet auto-populates with collapsible sections. Sheet data persists per-chat. Enable via the **Bunny Mo Integration** toggle in settings.

<img width="1258" height="1114" alt="image" src="https://github.com/user-attachments/assets/74b703ab-3e9c-444c-8e32-f06be79a33df" />


### Character Stats
Every character, your persona included, has a stat sheet: the six D&D attributes (STR, DEX, CON, INT, WIS, CHA, 1–100) and six states drawn as rings (Health, Satiety, Energy, Hygiene, Morale, Mana, 0–100%). Starting values live in the **Stats** tab of the Character Workshop, where you can also add custom stats — with a description of what they represent — that every character gets.

Attributes use a human scale: 10 is an ordinary person, below 10 a weakness, 20 the human peak and anything above superhuman (up to 100). NPCs get their whole sheet generated by the AI, to fit who they are, the first time they appear in a reply (no extra call); **Regenerate with AI** in the Workshop asks for a new set. Your own character's stats are set by hand.

**Settings → RPG & Stats** switches each built-in stat on or off for every character: a switched-off stat is hidden everywhere and not sent to the AI.

Each stat has an **AI** tick. Ticked stats are updated by the AI as the story goes (through a `"stats"` key in the tracker JSON); unticked ones are only changed by hand, but the AI still reads them. Starting values are shared by every chat, while the current values belong to each chat. Swiping or regenerating a reply rolls back the changes it made.

Right-click any portrait and pick **Stats** to open the stats panel: rings for the states, scores for the attributes, a tab per character in the scene, and click-to-edit values. The panel can be dragged around or popped out into its own browser window, which stays in sync.

### Equipment
Each character, your persona included, has an Equipment list in the Stats panel under the attributes: an emoji icon and a name per item, with a short description shown when you hover the icon. The AI adds and removes items as the story goes; items you lock can only be removed by you. You can add items yourself from the panel. Equipment belongs to the chat.

### Conditions and item effects
Equipment is split into **Equipped** and **Backpack**, items have quantities, and an item can give attribute bonuses while it is equipped (Iron sword: STR +2). Temporary **conditions** (Poisoned, Wounded leg, Drunk…) appear at the top of the Stats panel; the AI starts and ends them, and they can carry effects too. Effects are added on top of the attributes, never written into them: the panel shows **12 +2**, and the bonus disappears by itself when the item is put away or the condition ends.

### Spells & Abilities
Each character has a list of **Spells** and **Abilities** in the Stats panel, under Equipment. The AI adds what a character learns or is shown using (and fills in what they already know, once); passive abilities can give attribute bonuses that always apply; locked entries can only be removed by you. Every entry in the panel — items, conditions, spells and abilities — can be edited by clicking its name.

### Character Memories
Characters (not your own) keep one-line memories of important events — what happened to them, what they learned, what they promised. The AI adds new memories by itself — at most one per reply, only when something memorable happens, never removing old ones —, and you can add, edit, star or delete them in the Workshop's **Memories** tab. **★ Important** memories are always sent to the AI; normal ones are sent while they are among the most recent and then fade, so the prompt stays short. Only the characters in the scene have their memories sent, and memories belong to the chat.

### Everything belongs to the chat
Current stat values, equipment, conditions, spells and abilities, memories, levels and XP are saved inside the chat. Another chat with the same character — or the same persona — starts clean, from the starting values set in the Workshop (and asks again for starting gear and abilities); branching or copying a chat takes its data along. What stays shared is who the characters are: their stat sheet and starting values, and all settings.

### Experience & Levels
Everyone has a level, shown on the portrait cards and in the Stats panel. Your persona and the characters you mark **In the party** (Stats panel → **Level** tab) share experience: every award goes in full to each of them. The AI awards XP for real accomplishments, in the same call (an `"xp"` key), naming only the size of the deed — small, medium, large or epic, worth 10 / 25 / 50 / 100 XP unless you change the amounts — and ticking a quest as **completed** in the Quests panel gives the party XP too (✕ removes a quest without XP). Reaching level 2 takes 100 XP, level 3 another 200, and so on (configurable); each level gives 3 attribute points, spent with the **+** buttons on the Attributes tab (and taken back with ↶). The Level tab has the XP bar, an experience log and a way to add XP or set the level by hand. Other characters get a level from the AI, fitting who they are, when they first appear. Levels belong to the chat, and swiping a reply takes its XP back.

### RPG mode
Not every card needs any of this. **Settings → RPG & Stats → RPG mode** switches the whole layer — stats, levels, equipment, abilities, conditions, memories — on or off by default, per card and per chat (the chat wins over the card, the card over the default); the ⏻ button in the Stats panel turns it off for the current card. With RPG mode off nothing of it is sent to the AI or updated, and nothing is deleted.

### Scene Tracker
Compact scene info blocks injected after assistant messages in chat. Displays time, date, location, weather, present characters, active quest, and recent events. Placed outside the message text so TTS won't read them. Multiple layout modes available:
- **Grid** — 2-column layout
- **Stacked** — single column
- **Compact** — inline flow
- **Banner** — horizontal strip after the last message
- **HUD (Floating Panel)** — frosted-glass panel, fully draggable with position persistence
- **Ticker** — collapsible bar pinned to top or bottom of chat

Beyond the built-in fields, you can define your own **custom scene fields** (Tracker Editor → Scene Tracker → Custom Scene Fields). Each field has a name, an emoji icon, and an AI instruction describing what to track — the AI fills it in with every response and it renders in all Scene Tracker layouts alongside the built-in fields. Custom fields support inline editing in the Scene Tracker panel and can be included in History Persistence.
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

**Knives — every character carries their own twists:**

Instead of relying on AI-generated twists, you can attach pre-written story beats — **Knives** — to any character in the **Character Workshop** (right-click a portrait → Character Workshop → 🔪 Knives tab). Example: your character David is in Chicago, and one of his knives is *"David is a gambling addict — he owes a lot of money to the wrong people."* When the counter strikes, **one character currently in the scene** (including your own persona) is chosen at random from those holding armed knives, and *their* knives are offered as cards instead of generated twists. Pick one and the AI weaves its consequences into the next scene.

- Knives travel with the character across chats; both NPCs and user personas can carry them
- Out of ideas? **Generate Knives** lets you pick a theme — Mixed, Betrayal, Enemies, Debts, Old Flames, Secrets, Regrets, or Fortune — and your AI suggests 5 knives in that vein, grounded in the character and current chat. Tick the ones worth keeping
- Turn the system on per story with **Settings → Doom Counter → Enable Knives (this chat)**
- Only one character's knives surface per trigger — you won't know whose until the counter strikes
- A chosen knife is marked *used* so it isn't offered twice — re-arm it in the Workshop to put it back in rotation
- A "Generate twists instead" button on the knife picker falls back to AI-generated twists
- In Trap Mode, a random armed knife from a random present character is injected silently — you won't see it coming

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
- **Auto-link by name** — a book named exactly like a character in the chat's cast switches on while they are in the cast and off when they leave (only books it switched on itself; books a campaign keeps on, or flagged global, are left alone). Settings → Lore Library turns it off.
- **Active campaign** — a library folder can be *set active*. Doing so switches every Workshop character to that campaign's version of themselves, turns the campaign's books on and turns the previous campaign's books off. Books you switched on by hand outside any campaign are left alone, and a book flagged **global** (the globe on its row) stays on across every switch — the place for BunnyMo-style packs. Click the active campaign again to deactivate it; with nothing active, the library is the plain folder view it always was.
<img width="1557" height="2380" alt="image" src="https://github.com/user-attachments/assets/cad2d576-480e-446e-8d3f-bc1abd1e96b4" />

### Quest Tracking
Track a main quest and multiple optional side quests. Quests appear in scene headers and are included in the AI's generation context. All quests are editable inline with lock support. With experience on, ✓ marks a quest completed and gives the party XP, ✕ just removes it.

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
Captures all Better Stats console messages with timestamps. Open from the bottom of the settings panel to review extension initialization, generation events, and errors.

### Notification Log
Captures every SillyTavern toast notification (API errors, system messages, warnings, etc.) so you can scroll back and see what happened even after the pop-up disappears. Includes Copy All for easy bug reporting.

---

## Customization

### Themes
Choose from pre-built themes (Default, Sci-Fi, Fantasy, Cyberpunk) or create your own with full color picker controls for background, accent, text, highlight, stat bars, and per-element opacity.

### Settings Panel
<img width="813" height="252" alt="image" src="https://github.com/user-attachments/assets/8449e4f8-edd6-49d2-b5a9-22311637adae" />

<img width="601" height="792" alt="image" src="https://github.com/user-attachments/assets/faf752a6-df04-4b79-b94c-3bc1478c7037" />

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

## Privacy

DES sends no telemetry. Nothing about you or your chats ever leaves your
machine.

## Credits

- Originally forked from [marinara_spaghetti's RPG Companion](https://github.com/SpicyMarinara) extension
- Character Expressions sync contributed by **Tremendoussly**
- Twist generator prompt contributed by **thekittymix**
- Character sheet parser based on [CarrotKernel](https://github.com/Coneja-Chibi/CarrotKernel) by **Coneja**

## License

Copyright (C) 2026 Jordan (DangerDaza). Portions copyright (C) 2024 Marysia
(marinara_spaghetti), from the RPG Companion extension this was forked from.

Better Stats is free software under the
[GNU Affero General Public License v3.0 or later](LICENSE).

**If you reuse code from this project** — including the Present Characters
Panel and its styling — the license requires you to keep the copyright notices
intact, state what you changed, and release your version under the AGPL as
well. Credit in a README is welcome but is not a substitute for those three
things. If you'd like to use part of DES under different terms, ask me.
