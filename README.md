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

A horizontal card shelf displaying character portraits between the chat and input area. Tracks every character in the scene with their portrait, relationship to the player, internal thoughts, status, and up to 8 custom tracker fields.

Each character gets their own card with an avatar — custom uploaded, auto-imported from SillyTavern character cards, AI-generated, or emoji fallback. Shows present characters with hover glow effects and animated pulses when a character is speaking. Absent characters can be shown greyed out.

Right-click any portrait for the character menu: open the **Character Workshop** (custom images, portrait prompts, dialogue colors, aliases, and knives), open their **Character Sheet**, **Regenerate Portrait**, **Restore Previous Portrait**, cancel a pending inject, or remove the character from the scene.

NPCs support **Aliases** (Character Workshop → Identity): other names the AI might use for the same character — like a revealed full name ("Sarah Greenfield" for "Sarah"), a nickname, or a title. Tracker data using an alias resolves to the existing card instead of spawning a duplicate character, while the AI stays free to use the alias in prose. Fully customizable — card size, spacing, border radius, colors, glow intensity, and positioning (above input, below input, or top of screen).

Supports a palette of 54 named dialogue colors to prevent collisions in large casts — hover any swatch in the Workshop to see its name and hex. Per-chat character tracking is available — when enabled, each chat maintains its own independent character roster so characters don't bleed between conversations.
<img width="1443" height="372" alt="image" src="https://github.com/user-attachments/assets/91039d6c-0e98-4fb2-953e-e7195230a7a4" />

### Duplicate Character Protection

The AI loves renaming people mid-story — "Nine" becomes "Nine (Nine-Coins-In-Sequence)", "The Gardener" becomes "Gardener" — and every variant used to spawn its own card. Structural variants (trailing parentheticals, leading articles, diacritic and spacing differences) now fold into the original card automatically and are recorded as aliases you can see and remove in Workshop → Identity.

When a genuinely *similar* new name appears, DES asks once in a themed yes/no popup — and while it's open, the maybe-duplicate doesn't exist yet: no card spawns, no portrait or expression call is spent, and chat bubbles hold off attributing its dialogue. Answer **Yes** and it merges into the existing character, transferring the dialogue color and any generated portrait it picked up. Answer **No** and DES never asks about that pair again. Creating a similarly-named character by hand in the Workshop offers the same choice up front.

### AI Portrait Generation

DES can generate character portraits through SillyTavern's Image Generation extension. **Auto Portrait Mode** controls when: only for characters missing a portrait, whenever their state changes, or every reply. Right-click a card to **Regenerate Portrait** on demand — the old image isn't deleted, it's banked in a per-character history (last 5), and **Restore Previous Portrait** swaps it back at any time.

Each NPC also gets an optional **Portrait prompt** field (Workshop → Appearance): a short, tag-style appearance line (*silver hair, violet eyes, black leather coat*) that's sent verbatim instead of asking the LLM to distill the whole description — short tag prompts beat prose dumps on SD-family backends and keep results stable between regenerations. *Write prompt from description* drafts one from the character's bio for you to review and tweak before anything renders.

### Character Expressions Sync
Mirrors SillyTavern's active Character Expressions into the Present Characters portraits in real time. When a character speaks, their portrait updates to match their current expression sprite and persists until they speak again. Optional toggle to hide SillyTavern's native expression display.

### Character Sheets (Bunny Mo Integration)
Right-click any character in the portrait bar and select **Character Sheet** to open a full popup with the character's art on the left and a detailed character sheet on the right. Compatible with Bunny Mo's `!fullsheet` and `!quicksheet` commands — run either in chat, click the scroll button on the resulting message (in the message's button row, next to the edit icon), and the sheet auto-populates with collapsible sections. Detection covers every Bunny Mo template size, quicksheets, `<BunnymoTags>` blocks, and the usual AI formatting drift, and the button also appears on swipes, edited messages, and older messages loaded with "show more".

**Notes Mode** turns any character's sheet into a freeform notes area with your own collapsible sections — emoji, title, markdown text, reorderable and deletable, same look as an imported sheet. Your imported sheet is never lost: toggle back anytime, and importing while in Notes Mode merges instead of overwriting.

Sheet data persists per-chat. Enable via the **Bunny Mo Integration** toggle in settings.

<img width="1258" height="1114" alt="image" src="https://github.com/user-attachments/assets/74b703ab-3e9c-444c-8e32-f06be79a33df" />


### Scene Tracker
Compact scene info blocks injected after assistant messages in chat. Displays time, date, location, weather, present characters, active quest, and recent events. Placed outside the message text so TTS won't read them. Multiple layout modes available:
- **Grid** — 2-column layout
- **Stacked** — single column
- **Compact** — inline flow
- **Banner** — horizontal strip after the last message
- **HUD (Floating Panel)** — frosted-glass panel, fully draggable with position persistence
- **Ticker (Top or Bottom)** — collapsible bar pinned to the top or bottom of chat

Beyond the built-in fields, you can define your own **custom scene fields** (Tracker Editor → Scene Tracker → Custom Scene Fields). Each field has a name, an emoji icon, and an AI instruction describing what to track — the AI fills it in with every response and it renders in all Scene Tracker layouts alongside the built-in fields. Custom fields support inline editing in the Scene Tracker panel and can be included in History Persistence.
<img width="1426" height="357" alt="image" src="https://github.com/user-attachments/assets/7d4ab31e-2fd0-4f70-ab0f-6a85665b166e" />

### Inline Banners
Cinematic transition cards that appear in the chat when the story moves to a new location or makes a time jump between messages. No API calls — they read the tracker data you're already generating. Three styles: **Cinematic** (full-width banner), **Minimal** (centered lines), and **Hybrid** (rounded pill). Off by default.

### Dynamic Weather Effects
Visual weather effects that respond to the current scene weather. Rain, snow, wind, and other atmospheric particles render as an overlay on the chat, with automatic detection of indoor vs outdoor scenes.

### Chat Bubbles
Splits multi-character AI messages into individual styled chat bubbles per speaker. Two styles available:
- **Discord Style** — full-width message blocks with character names
- **Card Style** — rounded card bubbles
<img width="1241" height="1081" alt="image" src="https://github.com/user-attachments/assets/43e1d5d2-3216-4d01-841e-dbff6805afc8" />

Works automatically by detecting speaker changes through dialogue coloring, and self-heals when a character's dialogue color drifts from what's stored.

### Doom Counter (Plot Twist Generator)
A tension-driven plot twist system that keeps your story from stagnating. The AI rates each scene's tension on a 1–10 scale behind the scenes. When things stay too calm for too long, a countdown activates — and when it hits zero, you're presented with a set of AI-generated plot twist cards to choose from. Pick one and it gets woven into the next response.

**How it works:**
- The AI silently reports a tension score (1–10) with every response
- Low-tension responses (≤ ceiling, default 4) build up a streak counter
- Once the streak hits the threshold (default 5), a visible countdown begins
- Lower tension = faster countdown (tension 1 drops by 3, tension 2 by 2)
- At zero, a modal appears with twist options generated from your current scene context
- Select a twist and it's injected into the next AI generation, then counters reset
- **Reroll** regenerates a fresh set of twists; **Cancel** dismisses the picker and resets the counter

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
<img width="1557" height="2380" alt="image" src="https://github.com/user-attachments/assets/cad2d576-480e-446e-8d3f-bc1abd1e96b4" />

### Character Roster
A searchable directory of every character DES knows about, split into Characters and Users, filterable by all characters / this chat / currently in scene. Use it to find, edit, or purge characters that aren't currently on the portrait bar.

### Quest Tracking
Track a main quest and multiple optional side quests. Quests appear in scene headers and are included in the AI's generation context. All quests are editable inline with lock support.

### Dialogue Coloring
Automatically colors each character's dialogue with unique colors from a 54-color named palette. The AI generates `<font color>` tags that display in chat while being automatically stripped for TTS playback. Works seamlessly with chat bubbles.

### Thought Bubbles
Displays the character's internal thoughts as floating bubbles directly within chat messages. See what characters are thinking alongside their dialogue.
<img width="1215" height="723" alt="image" src="https://github.com/user-attachments/assets/d849e93c-3f86-4aba-91fe-fbaa87fe6529" />

### Tracker Data in Chat
Optional (off by default): every AI message carrying tracker data gets a small collapsible 🗂️ **Tracker Data** dropdown showing that message's parsed JSON — present characters, scene tracker, quests. A pencil button swaps it for an editable JSON view; Save validates the JSON, writes it back to that message's per-swipe store, and refreshes the live panels on the spot when it's the latest message. The dropdown lives outside the message text, so recoloring, bubbles, and edits can't wipe it, and it follows swipes.

### Per-Swipe Data
Each message swipe preserves its own tracker data independently. Swipe back and forth and each version keeps its own scene state, character data, and quest progress.

### History Persistence
Save and restore tracker history snapshots. Useful for branching storylines or recovering from bad generations.

---

## Generation Modes

**Settings → Generation → Generation Mode** controls how tracker data is produced:

- **Together** — the tracker is generated as part of your main roleplay response (no extra API call)
- **Separate** — DES makes its own follow-up call after each reply, so tracker formatting never competes with your prose
- **External API** — the tracker call goes to a separate endpoint entirely (base URL, API key, model, max tokens, temperature, with a Test Connection button). Point a cheap fast model at the tracker and keep your good model for the story

Also in this section: auto-update after messages (with a manual **Refresh Tracker Data** button when off), chat history depth, a **Connection Profile** picker, **Narrator Mode** for cards that describe a world rather than play one character, and **Skip Injections** for guided-generation compatibility.

---

## Troubleshooting

### System Log
Captures all Doom's Enhancement Suite console messages with timestamps. Open from the bottom of the settings panel to review extension initialization, generation events, and errors.

### Notification Log
Captures every SillyTavern toast notification (API errors, system messages, warnings, etc.) so you can scroll back and see what happened even after the pop-up disappears. Includes Copy All for easy bug reporting.

### Performance Mode
A single toggle at the top of Display & Features that strips DES animations, blur, and transitions and pauses particle effects — minimum GPU/CPU cost for lower-end machines.

---

## Customization

### Themes
Ten pre-built themes — Default, Sci-Fi, Fantasy, Cyberpunk, Midnight Rose, Emerald Grove, Arctic, Volcanic, Dracula, and Ocean Depths — plus **Custom**, with full color picker controls for background, accent, text, highlight, stat bars, and per-element opacity.

### Settings Panel
<img width="813" height="252" alt="image" src="https://github.com/user-attachments/assets/8449e4f8-edd6-49d2-b5a9-22311637adae" />

<img width="601" height="792" alt="image" src="https://github.com/user-attachments/assets/faf752a6-df04-4b79-b94c-3bc1478c7037" />

The settings panel (accessed via the **D** icon) is organized into collapsible sections:
1. **Generation** — Generation mode (together/separate/external), history depth, narrator mode, connection profile, external API config
2. **Display & Features** — Performance mode and per-feature visibility toggles
3. **Theme** — Colors, animations, stat bar gradients
4. **Present Characters Panel** — Portrait bar layout, card sizing, colors, effects, per-chat tracking, portrait generation, expression sync
5. **Scene Tracker** — Field visibility, layout mode (grid/stacked/compact/banner/HUD/ticker), sizing, colors
6. **Bunny Mo Integration** — Character sheet support with fullsheet/quicksheet import
7. **Inline Banners** — Location and time-jump transition cards, three styles
8. **Doom Counter** — Tension thresholds, countdown, twist generation, knives, advanced prompt tuning
9. **Chat Bubbles** — Style, speaker detection, color integration
10. **History Persistence** — Save/restore tracker snapshots
11. **Lore Library** — Lorebook organization and management
12. **Doom Button** — Click behavior, fly-out menu contents, optionally hide SillyTavern's top bar
13. **Advanced** — Prompt editing, compact tracker prompt, debug options

### The Doom Button
The floating **D** is draggable and remembers where you put it. It can open settings directly on click, or open a fly-out menu whose contents you choose — including mirrors of SillyTavern's top-bar buttons, so you can hide the native top bar entirely and reclaim the screen space.

### Prompt Editing
Customize the generation prompts for HTML formatting, dialogue coloring, twist generation, knife injection and generation, and avatar generation through the built-in prompts editor, each with a Restore Default button.

---

## Mobile Support

Fully responsive design with touch-friendly controls. All panels adapt to small screens with a dedicated mobile toggle and draggable FAB button. Two mobile-only extras:

- **Quick-Jump Button** — a floating button that jumps you back to your last message
- **Compose Overlay** (off by default) — tapping the message box opens an instant fullscreen compose sheet instead of squeezing the whole chat UI around the on-screen keyboard. Only the sheet resizes for the keyboard, everything you type mirrors live into the real message box, and Send fires SillyTavern's own send button

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

This program is free software under the [GNU Affero General Public License v3.0](LICENSE).
