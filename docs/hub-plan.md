# The Hub (Live World, fourth pass: many small chats)

**Names (the owner, 2026-11-04):** on screen this window is **the Map**
(Map in the D menu, `/map`, Settings → Live World → The Map, the strip's
Map, the builder's Open the Map), since the map is what it is; the per-chat
window of visited places (`docs/map-window-plan.md`) is **the Hub** (Hub in
the D menu, `/hub` and `/liveworld`, Open the Hub), and will likely go.
This document, the code's module names, element ids, settings keys and the
System Log's `[Hub]` prefix keep "the hub" for the feature. Where a passage
below names a button or a command, read the new name.

The owner (2026-11-02): "I am thinking of a feature that the map can become.
We are throwing the long chat style out and going to many small chats. I
want a hub panel that takes up most of the screen. It has a map and every
character's location. It shows news, rumours and weather patterns. The user
can click on an element of the map (location, person, news, rumour) and
start an RP there. The AI will start a new chat with 3 starting prompts and
the user can RP that scene. Once the scene is done they can end it and DES
will commit it to memory so that the next chat has it in its context. And
the user can jump from event to event or person or group of people. Always
have a fresh chat, keep your lore and relationships current." And then:
"give me the plan doc with long chat still available. And I need it all to
look good, I need all our buttons buttoned and bows bowed."

**Status (2026-11-02):** phase 1 built on `short-fuse/hub`, a branch off
`Project-Short-Fuse` (which carries Hooks and Canon,
`docs/hooks-canon-plan.md`, since `17b8d4f`), in five commits: Hub 1 the
pure model and its test, Hub 2 the feature with the chat bridge and the
flow test, Hub 3 the window with its sheets, the strip, the Settings group
and the render check, Hub 4 the docs, Hub 5 and Hub 6 the corrections a
six-lens review of this plan and its adversarial pass found (noted in
place below as "(review)"). Phase 1 holds D113–D115, D117–D123 and
D128–D130 as written, of D127 the Settings group (the gap and the recap's
length at their defaults), the two D menu items, `/hub` and `/endscene`
and the strip, and of D116 the window with the Scenes panel alone. Phase
2 was built on 2026-11-03 in five commits, Hub 7 to Hub 11 (§8): the
board is the world's picture with its places as nodes (D124 rewritten,
D134–D137 added from the owner's answers of 2026-11-02 and 2026-11-03
and the survey in `docs/support/map-survey.md`), the builder's Map tab,
the board in the hub with the place sheet and the tree board, the panels
over the memory with every line a way in, hooks over the memory, the
window stack, the Map window's Hub button and the builder's Play from
the hub, and Hub 11 the corrections a four-lens review of those four
found (noted in place below as "(review)": the backdrop guard, a picture
that will not load, the view kept by its picture, one rule for who is
here, the party's marker and the drawn pictures on the board, hooks held
while a scene is open, the ways in with their place, Escape answered
once); phase 3 the book and the weather (D125, D126),
phase 4 Continue in the hub (D131).
Tests: `tools/hub-test.mjs` (pure), `tools/hub-flow-test.mjs` (the sandbox),
`tools/hub-layout-test.mjs` (the window rendered). Parity rows:
`docs/parity-checklist.md`, The Hub. Nine decisions are the owner's: D113
from his words ("long chat still available"), D114, D115, D116 and the
branch from the four questions he answered before this was written, and
D124, D134, D135 and D136 from his words and answers on the map ("take a
picture of a map and drop nodes on it", a test version of a full game map
with terrain and zoom); they are marked "(the owner)"; every other
decision is recommended and standing, and any of them is his to change. The SillyTavern calls the plan rests on were
checked against SillyTavern's own source, release 1.19.0, on the day (§12).
Phase 1 landed as "Hub 1: the pure model and its test", the way the other
plans did.

## 1. Decisions

A world is played as many small chats instead of one long one. The hub is
the world's window: its places with every character on them, the news, the
rumours, the weather, the hooks, the people, the scenes played so far. From
any of those the player starts a scene: a fresh chat on the world's
narrator card, opened with a brief (where, who, when, what brought us here,
what happened last time) and three openers the narrator wrote for that
spot, one of which is the first message. The scene is played like any chat
today, because it is a chat: the tracker, the dice, the inventory, the
quests, Live World's clocks, Canon's ledger all work as they do now. When
the player ends the scene, DES remembers it: a recap is written, Canon
reads the whole scene, the world moves by the time the scene took, and the
world keeps a sealed snapshot of everything the chat knew. The next scene
is seeded from that snapshot, so it starts knowing what the last one
established; starting it "days later" moves the world first, so the hub's
news is the news since the player last played. The long chat stays a mode:
a chat the hub did not start plays exactly as today.

```
             +---------------- the hub (the world) -----------------+
             |  the board: places, people, weather   |  news        |
             |  the scenes so far, the date          |  rumours     |
             |  the narrator card                    |  hooks       |
             |                                       |  people      |
             |                                       |  scenes      |
             +-------------+-------------------------+----^---------+
        Start a scene      |                              |  End the scene
   (seed, cast, gap)       |                              |  (recap, Canon over the scene,
   the world moves on      |                              |   the world moves, the snapshot)
   the file written        v                              |
             +---------------- a fresh chat ------------------------+
             |  on the narrator card; the brief is its scenario;    |
             |  the first message is one of three openers;          |
             |  played as any chat today                            |
             +------------------------------------------------------+
```

| # | Decision | What it means |
| --- | --- | --- |
| D113 | The long chat stays (the owner) | A chat is a scene only when the hub wrote it: `chat_metadata.dooms_hub` names its world, its scene and its file. Every hub behaviour keys off that mark, and a branch or a checkpoint made in SillyTavern carries the mark under another file name and is therefore not the scene (no strip, no End; the records' rebuild passes it over), while a chat renamed in SillyTavern is the scene under its new name: the rename event rewrites the mark and the record, and the rebuild tells the two apart by whether the file the mark names is still there (review). A chat without it, on any card, the narrator card included, plays exactly as today: no copy in, no copy out, no brief, no strip, nothing new in its prompt, every default unchanged, `tools/tracker-prompt-test.mjs` still pinning the prompt. The Map window stays the chat's window (D116). The whole existing suite, run unchanged, is the proof, plus one new section that opens a plain chat on a bound card and checks the hub touched nothing. |
| D114 | A world is narrated by a card of the user's choice (the owner) | A chat belongs to a card in SillyTavern, so a world played from the hub is bound to one character card, its narrator, and the people of a scene are data (the tracker's present characters, the Workshop's cast), never cards. The user picks any card (Settings → Live World → Hub); "Make a narrator card" builds one from the world for people who have none: name "Narrator of <world>", description from the world's description and the narrator's template, no greeting (SillyTavern then starts its chats empty, §12), the default avatar, made through SillyTavern's create endpoint with the same body its own `/char-create` sends. One card narrates one world; a card bound elsewhere is shown greyed with that world's name. The card is remembered by its avatar file name, SillyTavern's stable id (indices move), so a rename in SillyTavern changes nothing and a deleted card makes the hub ask for another. Group chats are not scenes and a group cannot be the narrator (D39). |
| D115 | Memory: a sealed snapshot now, a world state later (the owner) | Between scenes the world keeps a snapshot of the chat's own stores, keyed exactly as the chat keeps them (`dooms_tracker`, `dooms_inventory`, `dooms_quests_done`, `dooms_world`, `dooms_canon`, `dooms_hooks`; §3). It is sealed: every reply id inside it is stripped (Live World's log, runs and visits; Canon's lines and count; the inventory's chat binding), because each of those stores winds back on load whatever is tied to a reply the chat does not hold (§3.2). Start writes the snapshot into the new chat's file; End reads the chat's stores back and replaces the snapshot. Nothing moves: every per-chat mechanism (the rewind on a deleted reply, swipes, the cadences) works inside a scene untouched, a long chat is untouched by construction, and a scene that is never ended commits nothing. The owner's word: this now, and "in the future we will be looking at" a world state; the snapshot is shaped so that step is a move of where the stores are read, not of their shape (§3.5). A world with no snapshot seeds its first scene as a new chat seeds today; Continue in the hub makes a long chat's stores the first snapshot (D131). |
| D116 | The hub is a window of its own (the owner) | `#rpg-hub-popup`, built in JS like the Map window on the settings popup's shell, sized for most of the screen (the Map window is capped at 760px tall; the hub has its own rules) and full screen on a phone the way the Workshop is. The panels reuse the Map window's pure renderers over the snapshot's world state; the Map window itself stays the chat's window and gains only a Hub button in its foot when the chat is a scene (phase 2). The window's module is lazy (`tools/lazy-graph-test.mjs`), its CSS lives in `style.css` with a block for the five looks in `styles/overhaul.css` (the Map's precedent; the World Builder has none and shows it). |
| D117 | Start a scene | From a place, a person or several, a rumour, a news item, a hook, a past scene ("Continue from here") or "Anywhere". The Start sheet: Where (the place, pre-filled, any place of the world or a new name), Who (the people there pre-ticked, any known person addable; the player always and never listed), When (the gap since the world's date: Right after, Later that day, The next day, Days later, Weeks later, When… as free text, Cut to a quest's own idea), What (the seed's text and an optional line of the player's own). Start then, in the hub: a gap longer than Right after moves the world first (§5.3), held with the Start until the file is written, so a Start backed out of moves nothing (review); the openers are asked (D119) and picked; the scene file is written and opened (D118); the hub closes (a setting keeps it) and the chat is in front with the strip across its top. A scene open at Start is ended or set aside by the user first; its record flips when the new record is written, not before. §2.4 says what each failure does. |
| D118 | The scene file is written first, then opened | SillyTavern keeps a chat's metadata on the first line of its file and reads it on load (§12), so Start does not make an empty chat and write into it; it writes the whole file and opens it: the header holds the sealed snapshot's stores, the mark `dooms_hub` (which names its own file and carries the brief, D120), the world's book as the chat's lorebook (D126), an integrity id, SillyTavern's own per-chat persona lock (`persona`: the persona in front at Start, so the scene opens under the name the brief and the openers were written for, review) and SillyTavern's own `tainted` flag (without it message 0 is a pristine greeting: a swipe past the last opener loops instead of regenerating and a card save replaces it, review); the first message is the chosen opener with the other two as its swipes (D119); the file is posted to SillyTavern's chat save endpoint by the bridge itself, under the narrator card, named "Scene <n> - <title>" (the title made file-safe the way SillyTavern's own sanitiser is, a free name checked against the card's chat list; a card never opened has no list and gets the name as is), and the record is written the moment the save is accepted, before the open. (SillyTavern's own `saveChat` is not used for this: it merges the open chat's metadata into the header it writes and saves under the card in front, §12.) Then the chat in front is flushed (the tracker's stores rebuilt and written, any background request landed: a debounced save is lost on a switch), the card's remembered chat is set to the scene so that selecting the card, when another is in front, loads the scene and never a stray chat, the select is checked, and the chat is opened by name. The chat-changed handlers then find every store where they always look, no loader is re-run and no seed fires. The first-message event is ignored by every counter but the tracker's own handler, which parses the opener and overwrites its swipe entry with nothing: the hub's handler, registered after it, puts the seed back on every swipe (review). Start without an opener writes no message, and a card with a greeting of its own then shows it. |
| D119 | Three openers, the first message's swipes | One background request on the tracker's profile, like Hooks (D100), run from the hub before the file exists: the world's name and blurb, the place and its region, the weather there, the people chosen with the tier word and one line each, the seed, the gap, the ledger's block built from the snapshot, the last two recaps, the open quests, the player's name and line, the narrator's template. The reply is strict JSON (`{"when":{"date","time"},"openers":[{"title","text","who"}]}`, up to three), read like the advancer's and checked: a title and a text each, the text within length, `who` cut to the cast and the known, `when` taken whole or not at all. The picker in the hub shows the three as cards; the one chosen is the first message and the other two its swipes, so they are a swipe away and a further swipe is SillyTavern's own regenerate. Write my own (a text that is the first message), Ask again (three more; the old three stay until the new land) and Start without one are on the picker too. |
| D120 | The brief rides a slot of DES's own | The brief is kept in the chat's mark and rides every real generation of the scene on DES's own slot (`dooms-scene-brief`, raw, at depth 2 in the voice of the system, cleared on a quiet one and on a chat that is not a scene), never the scenario override: a chat-completion preset may not send the card's scenario at all, and a brief that silently never reached the prompt would be the worst failure the hub could have (review). The Scenes panel shows it with its scene; DES's Context Inspector never shows a raw slot. It holds: the world and the scene's number; where (the place and its region), the date, the time, the weather; who is here, one line each (the Workshop's description cut to 200 characters, else the tier word: nothing standing injects descriptions today, so the brief must); what brought us here (the seed); since last time (the news since the last scene); last time (the previous recap) and before that (the one before, cut); the player's line. At most 2,500 characters, the older parts cut first. Everything else the scene knows comes by the copied stores and their existing injections: the world line, the ledger's block, the committed tracker data, the inventory's line, the attributes line. |
| D121 | A scene plays as a chat does today | Nothing new reaches the prompt but the brief. The tracker's present characters are seeded from the cast (with their vitals from the snapshot when they were present at the last End; anyone absent then starts at the sheet's values, as in a long chat), both the last generated and the committed data from the newest block, so the shelf shows them from the first reply. At the scene's first send the chat holds the opener alone and the tracker's injector finds no reply at depth one or more, so the hub sets the tracker's example block itself for that one generation (review); from the first reply on the injector does as in any chat. Live World's cadence, Canon's cadence, Hooks, the dice, the inventory, Cut to a quest, Travel here, scene pictures and the Map window run per chat as now; what they change lands in the chat's stores and so in the snapshot at End. A slim strip at the top of the chat column names the scene (number, place, date) with Hub and End scene; `/hub` and `/endscene` do the same; the D menu gains Hub, and End scene in a scene. |
| D122 | End a scene, on purpose | The End sheet (from the strip, the D menu, `/endscene`, the hub's Scenes panel): What happened (a recap written by a background request when the sheet opens, editable), the scene's time (its first date to the tracker's date now), what End will do, End scene, Keep playing. End runs in order, one background request at a time (§5): the recap (kept with the scene, 600 characters at most, written in passes when the scene is longer than one page, §5.2); Canon over the whole scene when Canon is on, into the chat (its own run with the scene's messages in place of its recent window and wider caps for the one run; the mark remembers the reply it read up to, so End again after a stop does not read the same scene twice); the chat flushed (the tracker's stores rebuilt and written); the snapshot taken and sealed (the chat's stores, the facts from the newest tracker data: date, time, place, weather, and the persona's name); then the world moved for the scene just ended, over the snapshot's own world state and into the memory, never into the chat (§5.3, review), so the ended chat stays exactly as it was played and a reopened scene plays in the world as it left it; the ledger mirrored to the world's book (D126); the scene marked ended in the record and in the chat's mark. Each step shows on the sheet; a failed step is said and End goes on (the ledger left as the scene's cadence left it is read by the next End after Reopen, since the mark takes the reply only on success; a world not moved is moved by the next Start's gap; the snapshot never fails) (review). The strip's Reopen is the way back into an ended scene; a reopened scene's End replaces its recap and the snapshot, unless the scene is stale (D123). |
| D123 | One open scene per world | Starting while a scene is open offers End it now, Set it aside, Cancel. A scene set aside keeps its chat and its record under "set aside" in the Scenes panel, with Resume and End. Resuming it while another scene is open sets that one aside: one open scene at a time, always. The snapshot is a line, written by the last End. A scene that began before the memory was last written is stale: its End keeps the world's memory as it is by default (the recap is kept, the ledger reads the scene, the world is not moved, nothing a newer scene wrote is lost), and the sheet offers "Replace the world's memory with this scene's instead" for the player who means it (review). Merging two scenes' stores is not attempted (§11). |
| D124 | The board is the world's picture with its places as nodes (the owner) | The board shows the world's picture (D136) under Leaflet (D134) as an image overlay in a plain pixel space: drag to pan, the wheel and a pinch to zoom, the picture fitted to the board when it opens, the zoom clamped between that fit and four times the picture's own size. Each place with a node (D135) is a marker that keeps its screen size while the map zooms: the place's drawn picture (the one a scene drew for it, kept on the snapshot's visited row) or the pack's art or its glyph in a circle (the Map window's circle), its name under it, the people last seen there as small faces on its rim (four, then "+n"; a person at a sub-place with no node of its own stands on its nearest placed ancestor), the party's marker on the place the story stands at (the Map window's current place, the newest visited row: Live World never moves the player, so `where` never names them; review), the region's weather by the region's own node when the region is placed (phase 3), a place never visited dimmed. Places without a node are listed beside the board under "Not on the map yet", and the people whose place has no node under "Elsewhere" (the builder's Map tab places them, D137). A node clicked opens the place sheet (§4.3): the picture, who is here by the board's own rule (a face on the node is a face on the sheet, and ticked on the Start sheet; review), the rumours that name it, the scenes played there, Start a scene here. The board keeps its view (centre and zoom) across a re-render, a sheet and a reopen, for that picture alone: another world's picture, or a redrawn one, opens fitted (review). A picture that will not load (the file gone from SillyTavern's folder, a path refused) is said, and the tree board stands in for it (review). A world with no picture shows the tree board: the World Builder's tree, regions as groups, each place a circle with the same rim of faces and the same sheet; it is that world's board, not a lesser one. The full game map the owner described (terrain, zoom levels, a map per region) grows from this board without touching its nodes: a tile pyramid cut from one big picture and a picture per region are phase 6 (§8). |
| D125 | Weather by region | The world keeps a weather line per region (a top-level place): an emoji, a few words, the date it set in, kept in the snapshot's world state (`weather`, a new field, §3.3). Seeded from the tracker's weather at the first End (the scene's place names the region) or typed in the builder's Places tab; moved by the advancer, whose JSON gains a `weather` list checked like its other fields (a region id, one emoji, a line under 80 characters; a bad entry drops, not the run); shown on the board and in the News panel as dated lines ("Rain over the Harbour since Day 13"); said in the brief; seeded into the scene's tracker weather at Start so the first reply and the weather effects match; and at End the tracker's weather becomes the region's. |
| D126 | The world's book | Canon's ledger is kept as a lorebook the world owns as well as a block: at End the ledger is mirrored into "Canon of <world>" (made when missing; every entry written as Canon's export writes them, D111, and entries the ledger no longer has removed, which D111's export does not do), and the book is bound to every scene chat as its chat lorebook from the file's header (`chat_metadata.world_info`, §12), so SillyTavern's own keyword triggers carry the lore into the prompt beside the block. Off when Canon is off. The book is the user's to edit; the next End rewrites only the entries it owns (titled "Canon · kind: name"). The shelf's own To a lorebook in a scene chat still writes the chat's book named after the card (D111); the world's book is the hub's. |
| D127 | Ways in | The D menu gains Hub (the chat's world when the chat is a scene; else the list of worlds with a narrator card; else Settings) and End scene beside Map, both with stable ids and both always listed (the hide-toggles are built from the whole list): outside a scene End scene says this chat is not a scene (review). Settings → Live World gains a Hub group: the world, its narrator card, Make a narrator card, Open the hub, Continue in the hub (D131), and what End remembers (Recap always; the ledger and the book when Canon is on; the world when Live World is on). The World Builder's foot gains "Play from the hub" on a world of the user's (built in Hub 10). The Map window's foot gains Hub in a scene (built in Hub 10). The strip has Hub and End scene. `/hub` opens the window, `/endscene` ends the scene in front (`/scene` is scene pictures'). The Start sheet's pre-chosen gap and the recap's length are settings without a control in phase 1 (their defaults stand, D128). Start and the gap need Live World on: the hub is Live World's; End, Reopen, Set aside, Resume and the strip work with it off, End skipping the world (review). |
| D128 | The store and its caps | `extensionSettings.hub = { v, gap, recapChars, closeOnStart, worlds: { [worldId]: { card, memory, scenes, seq } } }` (`gap` the Start sheet's pre-chosen gap, Later that day by default, never When…; `recapChars` 200 to 1,500, 600 by default; `closeOnStart` on), normalised by a pure `hubConfig`/`normalizeHub`, additive migration, nothing happening for a world until a card is bound. A scene record: id, title, seed, place, cast, gap, the chat's file name, the card, started and ended (wall clock and story date), status (open, aside, ended), recap, reopened. Two hundred scenes a world; the recaps of all but the last twenty cut to 200 characters; the snapshot's stores keep their own caps (Canon 160 lines, the world's log 300, the inventory's). The chat's mark `dooms_hub` carries the scene's id, its file, title, place, cast, gap, the brief, after End the date it ended, and the reply the ledger was last read up to; the Scenes panel can rebuild its list from the card's chats (SillyTavern lists a card's chats with their metadata, §12) if the settings are ever lost, and marks a record "chat gone" when its file is. |
| D129 | Rendered before pushed | `tools/hub-layout-test.mjs --shots` renders, under the default look and the five looks at 1200×900 and 390×844: the hub with a fixture world (two regions, seven places, three with pictures, five people, weather, eight news lines, three rumours, two hooks, four scenes with one open), the place sheet, the Start sheet, the opener picker, the End sheet in its three states, the scene strip over a chat column; it fails anything past the window, a squeezed label, a circle over its label, a button short of its size or wider than its share, a tab out of reach on phone, a picker card cut. The views are pure (`hubViews.js` exports the shell and the id the test builds from, the World Builder's way). The Settings group is covered by `tools/settings-layout-test.mjs`. The PNGs are looked at before every push (handover §1), and the owner looks at it on his install and his phone before the branch merges: "buttons buttoned and bows bowed" is the bar. |
| D130 | Tests | `tools/hub-test.mjs` (pure): the snapshot taken and sealed from fixture metadata, seeded with the facts adjusted, the brief and its cuts, the gap words, the openers' prompt and reader, the recap's, the weather checks and the advancer's new field, the scene records (one open, set aside, reopened, chat gone), the file name, the header. `tools/hub-flow-test.mjs` (the sandbox): bind a card; Start from a place with the chat bridge stubbed (the file recorded, the open recorded); the stores found by the loaders on the simulated chat change; the brief in the header; the openers as swipes; two replies played; End's steps through injected transports and timing hooks; a second Start reading the memory and carrying last time; set aside and resume; reopen; the chat changed mid-End aborting; Continue in the hub; a plain chat on the bound card untouched. The existing suite runs unchanged as the long chat's guard. |
| D131 | Continue in the hub | From a long chat (Settings → Live World → Hub, or the Map window's foot when the chat's world has a narrator card): the chat's stores as they stand become the world's snapshot, sealed, a recap of its last forty messages is written and kept as scene 0 ("Before the hub"), and the hub opens. The long chat is not changed and can go on being played; the next Continue replaces the snapshot and says so. This is how an existing campaign moves into the hub without losing a line. |
| D132 | Bonds, later | Relationships are the hub's People view, written at End: a line per pair among the player and the known people (a stance, a strength, why, since), updated by one more request reading the recap and the ledger, shown on a person's sheet, said in the brief, editable and pinnable like Canon's lines. Phase 5 (§8); its decisions get numbers when it starts. |
| D133 | Phases, in order | 1 the memory and the lifecycle without a window; 2 the hub window and its render check; 3 the world's book and weather; 4 Continue in the hub and the world exported with its story; 5 Bonds; 6 zoom levels and nested maps (the picture with its nodes is phase 2's board, D124). Each phase is its own commits, tested and rendered before pushed, on `short-fuse/hub`; `Project-Short-Fuse` takes the branch when the owner says so. New decisions inside a phase take numbers from D134 on. |
| D134 | The map engine is Leaflet 1.9.4, vendored (the owner) | The code that drives the board is Leaflet 1.9.4 (BSD-2-Clause; `lib/leaflet/`: `leaflet-src.esm.js`, the self-contained ES module with no imports, `leaflet.css`, `LICENSE`, and a `README.md` with the version and the hashes), imported by the board's module alone, which is lazy (`tools/lazy-graph-test.mjs` lists both); its stylesheet is injected through `ensureCss('leaflet', …)` when the board first mounts, and the marker images it names are not shipped, since every node is a `divIcon`. Why Leaflet and not a camera of our own: pins are HTML elements that keep their size with no code of ours, drag, wheel, double-tap and pinch are built in and proven on phones, `CRS.Simple` makes the picture a plain pixel space, and the growth path is exact: an image overlay now, a tile layer over a pyramid cut from one big picture later, with the same node code; it is what nearly every open-source game map and worldbuilding map runs on (`docs/support/map-survey.md`). Not the 2.0 beta, a day old and without its plugins. What Leaflet needs in a window: `invalidateSize()` after the popup is shown and on every resize, `touch-action: none` on the board, its pointer events kept from the popup's own drag and close handlers (the browser fires a drag released over the backdrop as a click on the popup itself, the press's and the release's common ancestor, so the backdrop closes only when the press and the release were both on it: `closeOnBackdrop` in the window stack, for the hub, the builder and the Map window alike; review), and the map removed (`map.remove()`) when the window closes so the next open starts clean. |
| D135 | A node is a fraction of the picture (the owner) | A place's node is `x` and `y` in 0 to 1 of the picture's width and height from its top-left, kept on the place in the pack (the fields `normalizePack` already read; a value outside 0 to 1 or not a number reads as no node, and four decimals are kept), carried by `worldToRaw` and so by Save, Export and Import; a place without them is not on the map. Fractions survive the picture being swapped for a redraw at another size (Image Generation will) and read as the same spot on a phone and a desktop; the Leaflet world stores pixels of the full picture instead, and the two meet at render: the board projects a node to Leaflet's units from the picture's own size (`[height × (1 − y), width × x]`, latitude growing upward) and back on a drag (`src/utils/worldPicture.js`, pure, `tools/hub-board-test.mjs`). The `zoom` a place already carries is left for phase 6 (the zoom from which its node shows). |
| D136 | The picture is a file of SillyTavern's own (the owner) | A world's picture is a file in SillyTavern's images folder, named by path in the pack (`map: { image, width, height, source }`, the path through `safeImageUrl` wherever it is shown), never bytes inside the pack: worlds live in the settings file, saved on every settings save, and a map picture is often a few megabytes. Upload: the Map tab (D137) reads the chosen file with SillyTavern's `getBase64Async` and saves it with `saveBase64AsFile(base64, 'des-worlds', '<worldId>-map-<stamp>', ext)`, SillyTavern's own `/api/images/upload`, which writes `user/images/des-worlds/<worldId>-map-<stamp>.<ext>` and answers the path (§12). Drawn: Draw a map asks the image service (`renderImage` with the purpose `map`; the prompt from the world's name, its blurb and its places; drawn again until liked) and saves the result the same way. The picture's size is read from the image once loaded and kept beside the path, so the board lays out before the file arrives. Replace keeps the old file (the user's images are theirs, and SillyTavern's gallery lists the folder); Remove clears the record only. A world exported travels with the path, not the bytes; embedding on Export is a later item (§11). |
| D137 | The builder's Map tab | A fifth tab in the World Builder, Map: the picture's row (Upload a file, Draw a map, Remove the picture; its size and its source said), the board itself in a smaller frame (the hub's board module in its edit mode: the picture and the nodes, no people), and the places beside it in two groups, On the map and Not on the map yet. A place is placed by dragging it from the list onto the picture (on a phone: tap the place, then tap the spot), moved by dragging its node, and taken off the map from its node's menu; every change marks the draft dirty, and Save keeps it. The tree the builder has today stays on the Places tab. |

## 2. The scene lifecycle

### 2.1 The states

A scene is `open` from Start, `aside` when set aside (D123), `ended` after
End (D122). Reopen puts an ended scene back to `open` (its record keeps
`reopened: true`). A record never leaves the list by itself; the Scenes
panel can remove a record whose chat is gone, nothing else.

```
 Start --> open ----End----> ended
            |  ^               |
  Set aside |  | Resume        | Reopen (a message sent in it, or the panel)
            v  |               v
           aside ---End----> ended
```

### 2.2 Start, step by step

1. **Guard.** Live World on, the world has a narrator card, the card exists
   (and is loaded whole: SillyTavern keeps cards shallow until used, §12),
   no temporary chat in front; another scene open, D123's three buttons.
2. **The gap.** Right after skips this. Anything longer runs the advancer
   over the snapshot's world state with no chat behind it (§5.3): the
   state, the last two recaps, the gap as story time, "the player is not
   in the story". The result (clocks, moves, news, weather, the new date)
   is held with the Start and written into the world's memory together
   with the record at step 5, so a Start backed out of moves nothing; a
   failed run leaves the world as it was, the hub says so, and the gap is
   said in the brief in words.
3. **The openers** (D119, §5.1), picked in the hub.
4. **The seed into the stores.** The snapshot copied, then adjusted: the
   tracker's location is the place, its present characters the cast (the
   player never among them; vitals from the snapshot for those present at
   the last End), its weather the region's, its date and time the
   openers' `when` (else the snapshot's); both copies of the tracker's
   data from the newest block; the inventory's chat binding rewritten; the
   hook that seeded the scene moved to taken and its quest added, as a
   hook taken in the Map window adds it (D102); the persona's vitals kept
   for the same persona and cleared for another; `dooms_hub` written with
   the file's name.
5. **The file and the record.** The header: the stores, the mark with
   the brief, the world's book as the chat lorebook, an integrity id, the
   persona lock, `tainted`; the first message: the opener as the card, with the other
   two as swipes, and the seeded tracker data as its swipe entry so the
   Tracker Data view, the scene headers and history persistence see the
   state on it. Saved under the card as "Scene <n> - <title>" (checked
   free against the card's chat list; a counter when not). The moment the
   save is accepted the record (status open, the file name, the title) and
   the world moved by the gap are written, in one settings write. The file
   is never opened by ST before it is whole.
6. **The open.** The chat in front flushed; the card's remembered chat set
   to the scene; the card selected if another is in front (and the select
   checked: a running generation makes SillyTavern refuse it silently);
   the chat opened by name. The chat-changed handlers load every store
   from the header; the strip appears; the hub's own handler puts the seed
   back on the opener after the tracker's first-message parse.
7. **The hub closes** unless the setting keeps it.

### 2.3 End, step by step

1. **Guard.** The chat in front is the scene's (End from the panel for a
   scene that is not open opens it first); no generation running (End
   waits for the send to finish, as the advancer's manual run does).
2. **The recap** (§5.2) written as the sheet opens, in passes for a long
   scene; the user may edit it. The sheet says when the scene is stale
   (D123) and when the ledger was already read for its last reply.
3. **End scene** pressed: Canon over the scene when on and not yet read for
   this last reply, into the chat, awaited behind the shared busy flag
   with the existing wait (`waitForBackground`), never parked; Try again
   and Skip on failure; the mark takes the reply it read up to.
4. **The flush and the snapshot.** The tracker's stores rebuilt from memory
   and the chat written through the conditional save (debounced saves are
   lost on a chat switch); the snapshot taken from the live metadata and
   sealed, the facts from the newest tracker data, the persona's name.
5. **The world.** When Live World is on, the scene not stale (or the
   player chose to replace the memory) and the chat has a world: one run
   over the snapshot's own world state, told the scene's record and the
   time it took, written into the memory and never into the chat (§5.3);
   Try again and Skip on failure.
6. **The record and the mark** (status ended, the recap, the end date, the
   memory replaced or kept), one settings write and one immediate save of
   the chat for the mark; **the book** (D126) mirrored when Canon is on.
7. **The hub opens** on the world, showing the news and the scene under
   Scenes.

### 2.4 When a step fails

| Step | On failure |
| --- | --- |
| The gap's advance | Nothing is written; the brief says the gap in words ("three days later"); the picker says the world did not move; Start goes on. |
| The openers | The picker offers Write my own, Ask again and Start without one; nothing is written until one is chosen or Start without one is pressed. |
| The file | Nothing is written anywhere else; a toast says SillyTavern refused the save; the hub stays open with the picker's choice kept. |
| The open | The file and the record exist; the hub says "the chat is written; open it from Scenes"; Resume opens it. A select refused by a running generation is one such failure. |
| End's recap | Write it yourself on the sheet, or End without one (the record says "no recap"). |
| End's Canon run | Said on the sheet; End goes on; the ledger stays as the scene's cadence left it and the next End after Reopen reads the scene again. |
| End's world run | Said on the sheet; End goes on; the memory's clocks did not move for the scene's time and the next Start's gap moves them. A busy line is waited for (up to two minutes, then "busy" and the sheet stays), never parked: a run that landed after the snapshot would move the wrong copy. |
| End's flush | The conditional save failed: End stops, the scene stays open, the sheet says so; nothing in the world is touched. |
| The book | The lorebook write failed: the record notes it; the next End mirrors again. |
| The chat changed mid-End | End stops before the flush and says "the chat changed; end it again from the Scenes panel"; the scene stays open; a run that lands late is discarded as stale, as the advancer's are. |

### 2.5 The edge cases, each decided

- **A scene left open** for days: it stays open; the hub's foot shows it
  with Resume and End; Start offers to end or set it aside (D123).
- **Two scenes at once:** never open together (D123). A set-aside scene
  ended after a newer one replaces the snapshot, and the sheet warns.
- **The chat is deleted in SillyTavern:** the record is marked "chat gone"
  (on the delete event, and when the Scenes panel checks the card's chat
  list); End is impossible; the panel offers to remove the record.
- **The chat is renamed in SillyTavern:** the rename event (the card, the
  old and the new names) moves the record to the new file and, for the
  chat in front, rewrites the mark's file and saves it, so the scene is
  still the scene; with the settings lost, the rebuild knows a renamed
  scene from a branch by the file the mark names being gone (review).
- **Campaigns:** the Lore Library's active campaign is a global switch
  (the Workshop's versions, the campaign's books) and nothing ties one to a
  chat or a world; the hub leaves it the player's to set, and the people's
  lines in the brief are whatever version is active at Start. A world that
  remembers its campaign is a later item (§11).
- **Voices:** the opener is not read aloud when the scene opens (its own
  speaker button reads it); the first reply is read as in any chat; a card
  made by Make a narrator card takes the default narration voice until the
  Voices page says otherwise.
- **Waits:** End waits up to two minutes for a running send and the
  background line, then says "busy" and stays on the sheet; the picker says
  "The narrator is writing…" while the openers are asked, with Back live.
- **The narrator card is deleted:** the hub says so and asks for another;
  the memory and the scenes stay under the world; old records keep the
  old card's name.
- **The narrator card is renamed:** nothing changes (the avatar file is the
  id).
- **The settings are lost or restored from an older copy:** Rebuild from
  the card's chats reads every chat's mark from the chat list and remakes
  the records; the snapshot is remade by ending the newest scene again.
- **The world is deleted in the builder:** `hub.worlds[id]` stays until the
  user removes it from the Hub group; the hub lists it as "world missing"
  with its scenes readable.
- **The world is edited while a scene is open:** the scene's chat clamps
  the pack on its next load as any chat does (D97); the snapshot's world
  state is clamped the same way at the next Start.
- **Live World turned off mid-scene:** the scene plays as a plain chat;
  End skips the advance; the snapshot still copies everything.
- **Canon off:** End has no ledger step and no book; the recap carries the
  memory; the Hub group says "Turn Canon on to keep a ledger".
- **DES off:** nothing of this runs (every handler checks, as all do).
- **SillyTavern restarted mid-End:** the scene is still open; End again.
- **The opener is swiped:** the other openers are the swipes; a swipe past
  them is SillyTavern's regenerate.
- **The opener is deleted:** the tracker's own handler, seeing no reply
  left, clears both of its stores; the hub's handler, after it, puts the
  header's seed back and saves, so the first reply still knows the scene
  (review). The brief stands.
- **The narrator card has a greeting of its own:** unused in a scene (the
  opener is the first message); shown in a plain chat on the card, and in
  a scene started without an opener.
- **A plain New chat on the narrator card** in SillyTavern: a long chat,
  not a scene (D113); adopting it as a scene is a later item (§11).
- **The persona changes between scenes:** the player's name is resolved per
  chat as today; the snapshot records the persona's name beside the
  player's vitals, and a Start under another persona seeds the player's
  block empty, so the new persona starts at the sheet's values.
- **A branch or a checkpoint of a scene** made in SillyTavern carries the
  scene's mark under another file: it is not the scene (D113); it plays as
  a plain chat, the strip stays away, and the records' rebuild passes it
  over.
- **The tracker's preset:** SillyTavern-side presets follow the card, so
  every scene of a world shares the narrator card's preset; a preset
  switched between scenes may ask for other fields than the seeded data
  carries, which the tracker already tolerates.
- **A name close to a known one** in the cast ("Mara" beside "Mara Vane")
  raises the alias question as it would in any chat; the Start sheet's
  Who list offers only names as they are known, so the question is rare.
- **Lorebooks named like known people** switch on for the scene chat as
  they do in any chat whose roster names them; the snapshot's roster is
  the long chat's rule applied to a short one.
- **A phone:** the hub is full screen with tabs; the sheets are full
  screen; the strip wraps to two lines.
- **Two SillyTavern tabs:** unsupported, as today.
- **A group chat in front** at Start: the card is selected first, leaving
  the group; a group can never be the narrator (D114).
- **The settings grow:** the caps in D128; a world's memory is tens of
  kilobytes at most; `settings.json` is already where DES keeps worlds.

## 3. The world's memory

### 3.1 What is per chat today

| Store | Key | What it holds | In the snapshot |
| --- | --- | --- | --- |
| The tracker | `chat_metadata.dooms_tracker` | quests; the last generated and the committed data (the info box with date, time, location, weather; the present characters with their vitals; the player's vitals), as JSON strings; the character sheets; the doom counter; knives; the roster of the chat (known, removed, banned, colours, fills) since per-chat tracking is always on | Yes, whole, then adjusted at Start (§2.2 step 4); the doom counter keeps its total and resets its countdown; the synced expression portraits are left out (they are rebuilt on every load) |
| Inventory | `chat_metadata.dooms_inventory` | the pack, the party pouch, stored items, and the chat it belongs to | Yes; the chat binding rewritten to the new chat at Start |
| Completed quests | `chat_metadata.dooms_quests_done` | the quests completed | Yes |
| Live World | `chat_metadata.dooms_world` | the pack id, `seeded`, the clocks, who is known and where, the places visited with their visits and pictures, the log, the runs, the count, the blurb, the name | Yes, sealed (§3.2) |
| Canon | `chat_metadata.dooms_canon` | the ledger, the count, the last run | Yes, sealed |
| Hooks | `chat_metadata.dooms_hooks` | the round, the taken, the set aside | Yes (its ids are harmless; the seeding hook moved to taken) |
| Cut to a quest | `chat_metadata.dooms_quest_cut` | an armed cut | No: transient |
| Scene pictures | `chat_metadata.dooms_scene` | the chat's count, LoRAs, notes | No (later: the LoRAs and notes as the world's) |
| Per message | `message.extra.*`, the reply stamps | swipe data, roll cards, pictures, the ids the stores are tied to | No: a fresh chat has no messages; the opener gets a swipe entry of its own |

The live copy of the quests is a global (`extensionSettings.quests`) that
every chat load overwrites from `dooms_tracker.quests`; the snapshot reads
the metadata, never the global. The tracker's save rebuilds `dooms_tracker`
from a fixed list on every save, so the hub keeps nothing under it: its
mark is its own key, `dooms_hub`.

### 3.2 Sealed

Each store binds itself to its chat by the ids of the replies that changed
it, and on load winds back what the chat does not hold: Live World pops
every log entry and run whose id is missing (clocks and places back to
before), Canon keeps only lines that are pinned or unstamped, the inventory
treats a store bound to another chat as inherited from a branch. A
snapshot copied as it stands would be emptied on the first load. Sealing
strips the ids: Live World's log, runs, last and lastError get `msgId:
null`, `counted` is emptied and `sinceLast` zeroed, every visited place's
visits are emptied (an entry with no visits stands where it is, its
picture kept); Canon's lines and its last run get `msgId: null` and
`counted` is emptied; the inventory's chat binding is rewritten at Start.
A sealed store reads as one that was never tied to a reply, which the
loaders already accept. The snapshot is sealed when it is taken, and again
when it is seeded (a scene's End stamps the opener too). `takeSnapshot` and
`sealSnapshot` are pure, in `src/utils/hub.js`, tested on fixtures taken
from the flow tests' chats.

### 3.3 The snapshot

```
hub.worlds[worldId].memory = {
  v: 1, takenAt, scene,                 // which End wrote it
  stores: { dooms_tracker, dooms_inventory, dooms_quests_done,
            dooms_world, dooms_canon, dooms_hooks },     // sealed deep copies, the chat's own keys
  facts: { date, time, location, weather },              // the tracker's at End
}
```

`dooms_world` gains one field for the hub, `weather: { [regionId]: {
emoji, text, since } }` (D125), read and written by Live World's own
normaliser so a long chat may carry it too (empty there).

### 3.4 Seeding a scene

`seedStores(memory, { chatId, place, cast, player, weather, when, hookId })`
returns the header's stores: the snapshot sealed again; the tracker's last
generated and committed data both set from the newest block (the
committed copy lags a reply behind in a chat; a scene starts with one
truth); the info box's location, weather, date and time replaced; the
present characters replaced by the cast in the shape the shelf writes for
a person it marks present (name, emoji, an empty thought, a relationship
status), each with the vitals the snapshot holds for that name (those
present at the last End); the player's vitals kept for the same persona
and cleared for another; the inventory's `chat` set to the new chat id;
the hook moved to taken and its quest added to the quests in every copy.
The opener's swipe entry carries the same four fields (quests, info box,
characters, player) so the view of the tracker's data on the message
matches the header; the hub's handler restores it after the tracker's
first-message parse (D118).

### 3.5 Later: the world state

When the stores move to the world (the owner's "option 2"), `memory.stores`
is already the world's copy. The step is: each feature reads and writes
the world's copy while the chat is a scene (a resolver in front of each
store's load and save, `chat_metadata` when the chat is not a scene), the
chat's copy becomes a cache, and the rewind on a deleted reply becomes a
rewind within the open scene only. The snapshot's shape, the sealing, the
scene records, the hub window, the openers, the brief and the End sheet
are unchanged by it; `seedStores`/`takeSnapshot` stop being the path. It is
honest to say the resolver is not small (review): five of the stores load
and commit in their own module and would take the one indirection, but
the tracker's store is read and written from six modules and rebuilt on
every save from in-memory singletons, so its reads and writes are
funnelled through `persistence.js` first (a refactor of its own); the
three stamped stores and the inventory refuse writes and discard runs on
the identity of `chat_metadata`, which a scene-aware token replaces; and
the rewind on a deleted reply needs a stated rule once several scene chats
share one world copy. The shape makes it a bounded change rather than a
redesign; it is not a small one.

## 4. The window

### 4.1 Desktop

```
+ Harbourside . Day 14, morning . Rain over the Harbour     [Narrator: Mara] [Start anywhere] [World Builder] [x] +
| +------------------ the board: the picture -------------------+ +- News | Rumours | Hooks | People | Scenes ---+ |
| |  ~ ~ ~  the sea  ~ ~ ~        (The quay)                   | | Day 14 . The cutter moved to the harbour mouth | |
| |                 (Customs house)                             | | Day 13 . Rain over the Harbour                 | |
| |                   Reyes                                     | | Day 12 . Captain Reyes seen at the customs ... | |
| |   (The Anchor)            THE OLD TOWN  (The chandlery)     | | ...                                            | |
| |    Marit, you                                               | |                                                | |
| |                      (The governor's house)     [+] [-] [fit] | | Not on the map yet: The sunken Kestrel        | |
| +-------------------------------------------------------------+ +-----------------------------------------------+ |
| Scene 4 open at The Anchor since Day 12 . [Resume] [End scene]                                                     |
+--------------------------------------------------------------------------------------------------------------------+
```

The window: `width: min(96vw, 1400px); height: min(94vh, 900px)`, the
board the left two thirds (the picture under Leaflet with its nodes, D124;
the tree board for a world without a picture), the panels the right
third, the foot the state line. The panels reuse the Map window's renderers over the snapshot's
world state (news, rumours, hooks, people) plus the Scenes panel (this
file's own). Every line of every panel is a way in: a news line, a rumour,
a hook ("Play this": taken and started), a person, a scene ("Continue from
here", "Open the chat") opens the Start sheet with that seed. A place's
sheet opens over the board. The remembered panel goes to `localStorage`
under a `dooms-` key, guarded, as the Map's does.

### 4.2 Phone

Full screen below 640px, the Workshop's rule (`100dvh`, a solid backdrop; the one hub breakpoint, in the CSS and in the test): the tabs
across the top (Map, News, Rumours, Hooks, People, Scenes), the board
under Map the picture at the tab's full height (pinch to zoom, a tap on a
node for its sheet; the tree board as rows for a world without a
picture), the foot pinned at the bottom with the open scene. The Start sheet, the picker and the End sheet
take the whole screen with Back in their head. Touch targets 44px; long
press where the desktop has a right click.

### 4.3 The sheets

- **The place sheet:** the picture (the one a scene drew for it, else the
  pack's; Draw it waits for a draw over the snapshot, §4.4), the region,
  who is here (faces, by the board's own rule: the people on the node are
  the people on its sheet), the rumours that name it, the scenes played
  there (titles, dates), Start a scene here.
- **The Start sheet:** Where (a select of the world's places plus "a new
  place…"), Who (chips: the people here ticked, others addable), When (the
  six gap words, When… a text), What (the seed's text, editable; the
  player's line), Start, Cancel. On a seed from a person the place is
  theirs (a story-named place by its row's name, and chosen in Where when
  the row lists it; review); on a seed from a rumour the place is the one
  its clock stands at, when it stands at one (the rumour lines carry their
  index into the rumours' list, never the clock's id, which spoiler-free
  keeps out of the markup; review); a hook carries no place yet (§11). The seed's
  text is the user's to edit, and what it came from (a hook's id, a
  scene's) stays with it (review).
- **The opener picker:** three cards (title, text, the faces named), Use
  this on each; Write my own; Ask again; Start without one; Back. Shown in
  the hub, before the file exists.
- **The End sheet:** the recap (editable, written when the sheet opens),
  the scene's time, the steps with their state (waiting, running, done,
  failed with Try again and Skip), End scene, Keep playing.
- **The strip:** `#dooms-scene-strip`, a flex child of `#sheld` inserted
  directly before `#chat` (never inside it, which SillyTavern empties on
  every switch), mounted by the feature on every chat change and removed
  when the chat is not a scene: "Scene 4: The queue · The Anchor · Day 12"
  with Hub and End scene; on an ended scene "Scene 4 · ended" with Hub and
  Reopen. Its view loads with the window's on the first scene chat.

### 4.4 Phase 2, what the review settled before it is built

The hub owns its classes (`.dooms-hub-*`): the Map's panel is a 360px box
with a nav column, not the hub's full-height column with tabs across the
top; the sections' renderers (news, rumours, people) are reused inside
the hub's own panel, and `hooksHtml` takes a mode for the hub's actions
(Play this, Not this one, no Offer button) or the hub renders its own.
Draw it leaves the place sheet (a draw runs in the open chat's world and
saves under the card in front; the picture reaches the hub through the
snapshot) until a draw over the snapshot exists. The hub's Hooks panel
gets a request of its own (`hooks`, Hooks' prompt and checks over the
snapshot's world state with the last recaps in place of recent scenes,
Offer hooks and Offer others, the round written sealed into the memory and
seeded into the next scene), since the snapshot carries only the round the
last scene left and the gap moves people past it. One small window stack
(`push` on open, `pop` on close, `isTopmost`) goes in front of the Map's,
the Builder's and the hub's Escape and backdrop handlers, since each
closes on any Escape today; the hub's sheets are entries of their own.
The board's module (`src/systems/ui/hubBoard.js`) is the one Leaflet
host, mounted by the hub (its `hub` mode: the people, the sheets) and by
the builder's Map tab (its `edit` mode: drag to place, drag to move, the
node's menu); it is lazy and the only importer of `lib/leaflet/`.

### 4.5 Rules the Map window taught

Attributes read with `.attr()`, never `.data()`; ids with a colon
(`loc:the-quay`) escaped in selectors; every picture through
`safeImageUrl`; the body re-rendered from a pure view with scroll and
typed values kept by hand; one topmost-window guard so Escape closes the
sheet on top and not the hub under it (the Map and the Builder both close
on one Escape today); the backdrop click on the popup element itself;
popovers above the window's z-index, closed on a capture-phase press
outside. Under Lumen the window content is opaque (pictures), under Inked
the hub's own ink rules apply (the Inked list of popup ids does not know
JS-built windows). Nothing is themed by hand twice: the board's circles
are the row's circles, the panels are the Map window's panels.

## 5. The requests

All on the tracker's profile through `withBackgroundProfile`, one at a
time behind the shared busy flag, read with the advancer's reader (fenced,
bare or whole; reasoning stripped), strictly checked, never written into
the chat as a message. Each failure is a result the UI can say
(`describe…` functions, as the others have). The hub's labels: `openers`,
`recap`, `gap`.

### 5.1 The openers (D119)

Inputs: the world's name and blurb; the place and its region; the weather
there; the people chosen, each with the tier word and the one line the
brief gives them; the seed; the gap; the ledger's block built from the
snapshot by Canon's own builder, cut to 1,200 characters; the last two
recaps; the open quests; the player's name and line; the narrator's
template. Output:
`{"when":{"date":"…","time":"…"},"openers":[{"title":"…","text":"…","who":["…"]}]}`.
Rules in the prompt: the place as the player finds it, who is there, the
first thing that happens, and it stops with the first move still the
player's (Travel here's own rule); the three differ in what happens, not
in wording; nothing resolved; nobody the player has not met is named as a
friend; plain prose, no markup. Checks: one to three openers; a title under
60 and a text under 1,500 characters; `who` cut to the cast and the known;
`when` taken only whole. None usable: a failure the picker says.

### 5.2 The recap, and Canon over the scene (D122)

The recap: the scene's messages as pages of at most 24,000 characters,
oldest first, each message cut to 1,200; one page is one request ("write
what happened in this scene in at most 600 characters, past tense, the
player by name, nothing that did not happen", with the brief); a longer
scene is read in passes, each pass given the record so far and told the
scene continues, at most four pages (the oldest beyond them unread); the
last pass's answer is the recap; output `{"recap":"…"}`, the JSON's recap
or plain prose, checked for length and emptiness (review). Canon over the scene is Canon's own `updateCanon`
with a new `scope: 'scene'`: the same budget in place of its recent window,
its adds and drops per run doubled for that one run (16 and 8), its pinned
lines untouched, its checks unchanged.

### 5.3 The advancer, between scenes and after one

Both runs go over the snapshot's world state with no chat behind them and
write into the memory only; the chat's own advancer is never run by the
hub (review: a run into the ended chat moved the world a reopened scene
plays in, and a parked run landing late moved the wrong copy). After a
scene: the same prompt in its `after` mode, told the scene just ended, its
record and the time it took (its first date to the tracker's date now),
asked to move the world for that time and for what the scene set in
motion, the player's part not undone. Between scenes: the prompt over the snapshot's world state,
`buildGapPrompt(state, pack, { facts, gap, recaps })`: the state as the
advancer sees it, the last two recaps in place of recent scenes, the gap as
story time ("three days pass; the player is not in the story"), and the
reply is the advancer's own JSON plus `"now": {"date","time"}` and the
`weather` list; checked by the advancer's own rules (clocks by at most
their step, moves to known places, news lines) plus the new fields (a bad
weather entry drops; `now` is taken whole or the facts stand). The result
is applied by the advancer's own apply with `msgId: null` and the news
dated by `now`.

## 6. The pure model, the feature, the bridge

`src/utils/hub.js` (pure): `defaultHubConfig`, `hubConfig`, `normalizeHub`,
`takeSnapshot`, `sealSnapshot`, `seedStores`, `GAPS` and `gapWords`,
`buildBrief`, `buildOpenersPrompt`, `parseOpenersReply`,
`validateOpeners`, `openerMessage` (the first message with its swipes and
its swipe entry), `sceneHeader`, `sceneFileName`, `buildRecapPrompt`,
`parseRecapReply`, `sceneRecord`, `openScene`, `setAside`, `endScene`,
`reopenScene`, `markChatGone`, `recordsFromChatList`,
`describeStartResult`, `describeEndResult`, `hubStatusLine`.

`src/systems/features/hub.js` (live): the store under `extensionSettings.hub`;
`bindCard`, `makeNarratorCard`, `startScene`, `endScene`, `setSceneAside`,
`resumeScene`, `reopenScene`, `continueInHub`, `isScene`, `currentScene`,
`onHubChatChanged` (the strip, the mark read, a branch passed over),
`onHubChatDeleted` and `onHubChatRenamed` (SillyTavern's own events; the
rename rewrites the mark of the chat in front), `onHubMessageReceived`
(after the tracker's: the opener's seed put back on the first-message
event), `onHubMessageDeleted` (after the tracker's: the seed restored when
no reply is left), `onHubGenerationStarted` (after the tracker's injector:
the brief on the hub's slot every real generation of a scene, and the
example block at a scene's first send), the transports
(`__setOpenersTransport`, `__setRecapTransport`, `__setGapTransport`),
`__setHubTiming`, `__setChatBridge`, `/hub`, `/endscene`,
`HUB_CHANGED_EVENT`.

The chat bridge is one object behind which every SillyTavern call sits,
read from `getContext()` at call time (the house pattern for optional
exports: a static import of a name an older build lacks kills the whole
extension at link time): the characters and the current one, the chat id,
select a character, open a chat by name, the current chat's name, rename,
reload, the conditional save, refresh the character list, load a shallow
card, the chat list of a card (with or without metadata; a card never
opened has no chats folder and SillyTavern answers `{ error: true }`, read
as an empty list), save a chat file, read a chat file, create a card. A member missing on the running build
makes the hub say "this SillyTavern is too old for the hub" and do
nothing. In the sandbox the test puts real functions on the context's
target, so the bridge needs no stub rewrites of `script.js`.

`src/systems/ui/hub.js` and `hubViews.js`: the window, the board, the
sheets, the picker, the strip; `worldViews.js` lends its panels. Both lazy,
both listed in `tools/lazy-graph-test.mjs`; the views import nothing but
`src/utils/*`.

`src/utils/liveWorld.js` gains `weather` on the state and in the
advancer's validation, `buildGapPrompt`, `applyGap`; `src/systems/features/liveWorld.js`
gains `advanceGap(worldId)` (a run with no chat behind it) and the reason
`scene-end`. `src/systems/features/canon.js` gains the scene scope and the
mirror export. The settings section in `template.html` (a Hub heading on
the Live World page so the rail groups it), the binder in `index.js`, the
D menu items, the strip's styles, the event map entries (`CHAT_CHANGED`
after the stores' own handlers; `CHAT_DELETED` and `CHAT_RENAMED`, which
DES does not wire today), a line in the startup safety net, a line in the
enable/disable teardown.

## 7. Files and tests

| File | What |
| --- | --- |
| `src/utils/hub.js` | the pure model (§6) |
| `src/systems/features/hub.js` | the feature and the bridge (§6) |
| `src/systems/ui/hub.js`, `src/systems/ui/hubViews.js` | the window, the sheets, the strip |
| `src/utils/liveWorld.js`, `src/systems/features/liveWorld.js` | weather on the state; the gap run; the scene-end reason |
| `src/systems/features/canon.js`, `src/utils/canon.js` | the scene scope; the mirror export |
| `template.html`, `index.js`, `style.css`, `styles/overhaul.css` | the Hub group, the binder, the D menu, the event map; the window's and the strip's rules (eager), the looks |
| `src/systems/ui/worldDashboard.js`, `src/systems/ui/worldViews.js` | phase 2: the Map window's Hub button; the panels' sections (news, rumours, people) lent to the hub, the rumour lines carrying their index into the list (never the clock's id: spoiler-free keeps its name out of the markup); the hub renders its own Hooks panel (`hubHooksHtml`, hubViews.js) |
| `src/systems/ui/windowStack.js` | the windows' order (§4.4): `pushWindow`, `popWindow`, `takesEscape` (one answer per keystroke), `closeOnBackdrop` (the press and the release both on the backdrop) |
| `src/systems/ui/worldBuilder.js`, `src/systems/ui/worldBuilderViews.js`, `src/utils/worldBuilder.js` | phase 2: the Map tab (D137) and Play from the hub, `worldToRaw` carrying the nodes and the picture; phase 3: weather on a region through the pack's normaliser and its round trip; phase 4: Export and Import with the memory |
| `lib/leaflet/leaflet-src.esm.js`, `lib/leaflet/leaflet.css`, `lib/leaflet/LICENSE`, `lib/leaflet/README.md` | the map engine, vendored (D134) |
| `src/utils/worldPicture.js`, `tools/hub-board-test.mjs` | phase 2: the picture record, the nodes as fractions and their projection, the board's model (D135, D136) |
| `src/systems/ui/hubBoard.js` | phase 2: the board on Leaflet, in the hub and in the builder's Map tab (D124, D137); lazy |
| `src/core/cssLoader.js` | `ensureCss(id, href)`: a stylesheet by its path, for Leaflet's |
| `docs/support/map-survey.md` | the survey the engine and the node model were chosen from |
| `tools/hub-test.mjs`, `tools/hub-flow-test.mjs`, `tools/hub-layout-test.mjs` | D130, D129 |
| `tools/lazy-graph-test.mjs` | the four hub modules listed: the window, its views, the board, Leaflet |
| `docs/parity-checklist.md`, `CHANGELOG.md`, `whatsnew.json`, `docs/phases-short-fuse.md`, `docs/handover-short-fuse.md` | §10 |

## 8. Phases

| Phase | What | Proves | Size |
| --- | --- | --- | --- |
| 1 | **Built (2026-11-02).** The memory and the lifecycle: the pure model and its test (Hub 1), the feature and the bridge (Hub 2), the window's shell with the Scenes panel, the Start sheet, the picker, the End sheet, the strip, the Hub group in Settings, Hub and End scene in the D menu, `/hub`, `/endscene`, the render check (Hub 3), the docs (Hub 4) | A scene starts fresh, plays, ends, and the next one knows; a long chat is untouched | Large |
| 2 | **Built (2026-11-03).** The hub window grown, in steps: Hub 7 (built) the plan, Leaflet vendored, the picture record and the nodes in the pack, the pure board model and its test; Hub 8 (built) the builder's Map tab (D137) and the board's module with its browser check; Hub 9 (built) the board in the hub (D124) with the place sheet, the tree board for a world without a picture, Not on the map yet and Elsewhere, the phone's Map and Scenes tabs, the render check widened; Hub 10 (built) the News, Rumours, Hooks and People panels over the memory (the hooks request, §4.4, `proposeHubHooks`), the Start sheet from a click on a news line, a rumour, a face or a hook, a world with no memory yet shown as the pack's fresh seed, the window stack (`src/systems/ui/windowStack.js`), the Map window's Hub button, the builder's Play from the hub, the docs; Hub 11 (built) the corrections a four-lens review of Hub 7 to 10 found: a drag let go over the backdrop no longer closes the hub or the builder (`closeOnBackdrop`), a picture that will not load is said and the tree stands in, a kept view belongs to its picture, one rule for who is here (`peopleAt`, `keyOfPath`), the party's marker from the visited row and the drawn pictures on the nodes, hooks held while a scene is open, a round landing or replaced while a Start waits, a world with no memory not moved before its first scene, the rumour's place and the person's story place on the Start sheet, the hub on the scene's world, Escape answered once (`takesEscape`), the remembered panel, the phone's 44px tabs, the docs' exact scope | The owner's sketch on screen: the picture, its places, the people on them, at desktop and phone, under every look | Large |
| 3 | The world's book (D126: the mirror is built; the header's binding and the Settings rows remain) and weather (D125): the state, the advancer's field, the board, the brief, the tracker's seed | Lore reaches the prompt two ways; weather moves between scenes and matches in play | Medium |
| 4 | Continue in the hub (D131); the world exported with its story (the builder's Export gains the memory and the scenes; Import takes them back) | An existing campaign moves into the hub; a world travels whole | Medium |
| 5 | Bonds (D132) | Relationships kept and said | Medium |
| 6 | Zoom levels and nested maps: a tile pyramid cut from one big picture (gdal2tiles with leaflet-rastercoords, or Zoomify) as the board's layer, a picture per region opened from its node, the zoom from which a node shows (`zoom`), terrain baked by a generator (`docs/support/map-survey.md`) | The full game map the owner described, on the same nodes | Large |

Order: 1, 2, 3, 4, 5, 6. Each phase is tested (the gate: every
`tools/*-test.mjs` and `tools/load-check.mjs`) and rendered (D129) before
it is pushed. Phase 1 is shippable on its own: a world can be played from
Settings before it has a window.

## 9. Parity rows (to add when built)

Under a new block "## The Hub (docs/hub-plan.md)" in `docs/parity-checklist.md`:

- The long chat: a chat on any card the hub did not start: no strip, no
  brief, nothing new in the Context Inspector, the whole suite green
- Bind a card: Settings → Live World → Hub names the world and the card;
  Make a narrator card makes one named "Narrator of <world>" with no
  greeting; a card bound elsewhere is greyed
- Start from a place: the Start sheet pre-filled; Start writes a chat named
  "Scene 1 - <title>" on the card, the scenario override holds the brief,
  the first message is an opener with two swipes, the strip reads "Scene 1
  · <place> · <date>", the shelf shows the cast from the first reply
- Play: the tracker, the dice, the inventory, Live World's line, Canon's
  block and the Map window behave as in any chat
- End: the sheet writes a recap, the steps run in order, the hub shows the
  news and the scene under Scenes; the world's book holds the ledger
- The next scene: Start "days later": the hub shows new news first; the
  brief says since last time and last time; the openers know the recap
- Set aside, resume, reopen, the chat deleted, the card deleted, the
  settings rebuilt from the card's chats: §2.5
- Weather: the board's regions show it; a scene's first reply matches it
- Continue in the hub from a long chat: scene 0 with its recap; the long
  chat unchanged
- The render check and the PNGs looked at; the owner's look on his install
  and his phone

## 10. Docs (the last commit of each phase)

`CHANGELOG.md` (the open beta section: Added, "The Hub"), `whatsnew.json`
(one item at the top, emoji-led, second person), `docs/parity-checklist.md`
(§9), `docs/handover-short-fuse.md` (§1 the render rule names
`tools/hub-layout-test.mjs --shots`; §4 a bullet headed "The Hub
(date, `docs/hub-plan.md` D113–D133, on `short-fuse/hub`)" after the Hooks
and Canon bullet; §5 the files), `docs/phases-short-fuse.md` ("## Phase 10
— The Hub" in its neighbours' shape, and the At a glance row this plan adds
now as "designed"), this file's Status line edited in place as the commits
land.

## 11. Later and open items

- **Adopt a plain chat as a scene** (a New chat made in SillyTavern on the
  narrator card).
- **A world that remembers its campaign** (`hub.worlds[id].campaign`,
  switched at Start): today the campaign is the player's global switch.
- **Forget this world** in the Hub group for a world whose pack is gone
  (the entry and its scenes removed after a confirm; readable until then).
- **The Start sheet's gap and the recap's length as controls** on the Hub
  group (settings with defaults in phase 1).
- **Merge two scenes' stores** instead of replacing (D123).
- **Scene pictures' LoRAs and notes** as the world's (§3.1).
- **Zoom levels and nested maps** (phase 6, §8).
- **Export with the picture embedded** (D136: the bytes travel with the
  world, as a data URL on the way out and a file again on the way in).
- **The world exported with its story** (phase 4).
- **A bug found by reading, not the hub's, fixed on `short-fuse/hub`
  (2026-11-03):** the built-in template was chosen as `example`, its
  file's name, while the file carried the id `harbourside`, so a chat
  seeded from it stored an id no pack had and reported a missing world on
  its next load. The template's id is its file's name now, `harbourside`
  reads as the template unless a world of the user's own holds it
  (`packKey`), a chat that stored it takes the template's id on its next
  load, and `tools/live-world-flow-test.mjs` §13 covers the seed, the
  reload, the old chat and the copy. The hub itself binds only the user's
  worlds.
- **A hook with its place:** the hooks reply carries no place, so a hook
  played opens the Start sheet at "Anywhere that fits"; a place in the
  reply (checked against the pack's), or a match of the hook's grounds
  against the places, would give §4.3's rule to hooks as it holds for
  rumours.
- **The Elsewhere note on a phone** sits under the map in a column that
  scrolls (Hub 11); a note that could be folded away is a later nicety.
- **A doc drift, not the hub's, fixed in Hub 11:** `docs/world-builder-plan.md`
  D94 named the builder's popup `#world-builder-popup`; it names the
  code's id, `dooms-world-builder`, now.
- **Verify again on the owner's build** before phase 1: the items of §12,
  on the SillyTavern version he runs.

## 12. What was checked in SillyTavern's source (release 1.19.0)

Fetched from the `release` branch on 2026-11-02 and read, not run; file
and line as of that day.

| The plan relies on | SillyTavern |
| --- | --- |
| A chat's metadata lives on the first line of its file and is read on load | `saveChat` writes `[{ chat_metadata, user_name, character_name }, ...messages]` (`public/script.js:7427-7446`); `getChat` reads the header back (`:7655-7657`) and adds an `integrity` id when missing (`:7664-7666`); the server checks that id on later saves and rejects a mismatch unless forced (`src/endpoints/chats.js:532-566`) |
| Saving a chat file by name, under a card | POST `/api/chats/save` with `ch_name`, `file_name` (no extension), `chat`, `avatar_url`, `force` (`public/script.js:7438-7446`; the server, `src/endpoints/chats.js:548-557`); the folder is the avatar file name without `.png` under the user's data directory (`:594-595`). The exported `saveChat({ chatName, withMetadata, chatData, force })` (`:7395`) builds its header as `{ ...chat_metadata, ...withMetadata }` of the chat in front and names the card in front, so the bridge posts the file itself with a clean header |
| Opening a chat by name on the current card | `openCharacterChat(file_name)` (`public/script.js:7742-7750`), exported and on the context; the name is without `.jsonl` |
| Listing a card's chats, with their metadata | `getPastCharacterChats(characterId)` (`:8506-8526`); POST `/api/characters/chats` with `metadata: true` returns each header's `chat_metadata` (`src/endpoints/characters.js:1521-1523`); `file_name` there carries `.jsonl` |
| Reading a chat's messages without opening it | POST `/api/chats/get` with `ch_name`, `file_name`, `avatar_url` (`public/script.js:7638-7646`) |
| Selecting a card; the card's stable id | `selectCharacterById(id)` (`:875`), on the context; `characters[i].avatar` is the key everywhere (`:1237`, `:1317`, `:6038`); indices move when the list reloads |
| Shallow cards | `unshallowCharacter(chid)` before reading a card not in front (`:7636`, `:911`), on the context |
| A new chat starts empty when the card has no greeting | `getFirstMessage` (`:7710-7738`): no message is pushed when `first_mes` is empty and there are no alternate greetings; there is no default greeting (no `default_ch_mes` in 1.19.0) |
| The first-message event | a one-message chat emits `MESSAGE_RECEIVED` with `first_message` from `getChatResult` (`:7700-7707`), which DES's counters already ignore |
| The scenario override | `chat_metadata.scenario`, used when not empty in place of the card's (`getCharacterCardFieldsLazy`, `:3442-3446`); set in the UI by `setCharacterSettingsOverrides` (`:8996`), saved by `saveMetadata` (`:9408`) |
| The chat lorebook | `chat_metadata.world_info` (`METADATA_KEY`, `public/scripts/world-info.js:94`); on every chat change the module takes it when a book of that name exists (`:1013-1014`), so a header naming a book made at the last End binds it, and a missing book is ignored |
| Renaming a chat | `renameChat(oldName, newName)` (`:10731-10739`) and `/renamechat` (`slash-commands.js:438`); the server endpoint `/api/chats/rename` |
| The chat events | `CHAT_CHANGED`, `CHAT_CREATED`, `CHAT_DELETED`, `CHAT_RENAMED` exist (`public/scripts/events.js:19-53`); `CHAT_RENAMED` carries `{ avatarId, groupId, oldFileName, newFileName }` with their `.jsonl`, emitted after the renamed chat has reloaded (`public/script.js:10700-10717`); the hub wires the delete and the rename |
| The persona lock | `chat_metadata.persona` is the persona locked to a chat (`public/scripts/personas.js:936`, `:1088`), honoured on load and shown as "Chat persona" in the persona panel: the scene file's header carries the persona in front at Start (review) |
| Making a card from code | POST `/api/characters/create` with the JSON body `/char-create` sends (`slash-commands.js:5199-5274`); no avatar means the default one (`src/endpoints/characters.js:1037-1039`); `getCharacters()` then refreshes the list (`public/script.js:1294`) |
| A message as the card, with swipes | the shape `getFirstMessage` builds (`:7714-7738`): `name`, `is_user: false`, `is_system: false`, `send_date`, `mes`, `extra`, and `swipes`, `swipe_id`, `swipe_info` when there are alternates |
| The context's members | `public/scripts/st-context.js:115-160`: `characters`, `characterId`, `chatId`, `chatMetadata`, `name2`, `selectCharacterById`, `openCharacterChat`, `getCurrentChatId`, `renameChat`, `reloadCurrentChat`, `saveChat` (the conditional save), `saveMetadata`, `getCharacters`, `unshallowCharacter`, `addOneMessage`, `executeSlashCommandsWithOptions` |
| Temporary chats | `name2` is the neutral name and the save is a no-op (`:7408-7411`); the hub refuses to start from one |
| The pristine greeting | `chat_metadata.tainted` gates three behaviours on message 0 (`getOverswipeBehavior`, `:9223-9236`: an untainted chat's greeting loops on overswipe; a card save or rename puts the card's greeting back): the scene file's header sets it (review) |
| A branch or a checkpoint | saves a new file whose header is the live metadata with `main_chat` and a fresh integrity: the scene's mark travels, so the mark names its file and a mark under another name is not the scene (review) |
| A card never opened | POST `/api/characters/chats` answers `{ error: true }` with status 200 when the chats folder does not exist (the create endpoint, `/get` and `/save` make it): read as an empty list (review) |
| The first-message event and the tracker | DES's own tracker handler takes no type and parses the opener on the one-message chat's `MESSAGE_RECEIVED` (`src/systems/integration/sillytavern.js`), writing an empty swipe entry: the hub's handler after it restores the seed (review) |
| The image upload | `saveBase64AsFile(base64, subFolder, fileName, extension)` (`public/scripts/utils.js:1651-1675`) posts `{ image, format, ch_name, filename }` to `/api/images/upload` (`src/endpoints/images.js:39-70`), which checks the format against its media extensions, sanitises the folder and the name, writes `user/images/<ch_name>/<filename>.<format>` and answers `{ path }`; dots in the name become underscores; `getBase64Async(file)` (`:485`) reads a `File` as a data URL. Read on 2026-11-03 from the `release` branch. |
| Not SillyTavern's: Leaflet 1.9.4 | `CRS.Simple`, `imageOverlay(url, [[0, 0], [h, w]])`, `marker` with a `divIcon` (an HTML element that keeps its size), pinch zoom built in, `invalidateSize()`; the self-contained ES module `dist/leaflet-src.esm.js` (424 KB unminified; the UMD build is 147 KB), the hashes in `lib/leaflet/README.md` |
| Not relied on, noted | `doNewChat({ deleteCurrentChat })` (`:10618`) names the file `<name> - <timestamp>` and would need the loaders re-run after the write; `writeExtensionField` (`extensions.js:2070`) could hold a world on its card and is not used; there is no `/newchat` command |
