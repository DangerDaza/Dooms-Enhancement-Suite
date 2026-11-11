# Project Long Shot: the Atlas (Live World, fifth pass)

The owner (2026-11-09), with a whiteboard chart and a list: "I want to
rework the map feature in project short fuse." The chart starts from
**Player World Info** and branches three ways: the AI builds tracking for
the world (character location, weather) and from it generates hooks,
rumours and news; the AI creates a map that is "consistent with generation
between objects for distance tracking purposes"; the AI creates placeable
markers for the locations in Player World Info, the user places them, and
the markers are interactable. The list: follow the themes of DES, low cost
for PC performance, fill the entire screen on PC, simple layout, zoom in
and out without pixelation, create new tools if needed. The look and feel:
Map Genie's Elden Ring map (a full-screen map, a sidebar of categories
with counts that switch markers on and off, a search, a card on a marker).

**Status (2026-11-09):** branch `Project-Long-Shot`, cut from
`Project-Short-Fuse` at `43837f5`. Phase 1 built, then reworked the same
day from the owner's first look at it (§6, §7: "very ugly", markers "not
in the right spots, but I didn't place them", "we need a way to create new
map markers and delete ones that are redundant"). The rest of phase 2, and
phases 3 and 4, are planned below and not built.

## 1. Decisions

The owner was asked seven questions over two rounds. Four answers are his
words and are marked "(the owner)"; the rest are recommended and standing,
and any of them is his to change.

| # | Decision | What it means |
| --- | --- | --- |
| D138 | One map (the owner) | The Atlas is the only map. The Map window (`worldDashboard.js`, the row of circles) and the Hub window with its board (`hub.js`, `hubBoard.js`, the picture with nodes) are replaced by it; what they did (Travel here, news, rumours, people, hooks) moves into the Atlas's sidebar and its place cards. They are removed in phase 4, once the Atlas does their work. |
| D139 | A flat vector map (the owner) | The map is data, drawn as vector shapes: regions as polygons, routes as lines, places as markers. Nothing is a picture, so it is sharp at any zoom and costs little: one SVG layer under Leaflet (already vendored, D134), no tiles, no WebGL, no animation while zooming. |
| D140 | Positions are written once | A place's spot is a pair of numbers in layout units, kept in the pack (`atlas.spots`). A spot that exists is never recomputed: a new place gets a spot of its own and moves nothing. The layout that proposes spots is deterministic and index-stable (§3), so a world that cannot be saved (the blank world, the template) still draws the same map every time. |
| D141 | Distance is the straight line | The distance between two places is the straight line between their spots times the world's scale. It depends on those two spots alone, so adding a place or a road never changes a distance already told to the story. Routes are drawn; they do not shorten or lengthen anything. Travel time is the distance over the world's pace (a day is eight hours of travel). |
| D142 | The marker card (the owner) | A marker clicked opens a card: the place, its kind and region, its note, who is there, the weather, the distance and time from the party; Travel here (the travel cut, D84); the hooks, rumours and news that name the place. Starting a scene from a marker was not chosen. |
| D143 | Player World Info is a sheet, drafted around the player's notes (the owner) | The player first writes what matters to them, in a short box with a few prompts (the places, the people, the tone, what must be true); it may be left empty. The AI then drafts the world around those notes from the lorebooks, the card and the chat (the World Builder's draft, D95, given the notes first and told they outrank everything else). The player corrects the draft and locks it. The sheet is the pack: `atlas.notes` keeps the notes, the places carry a kind and a note, `atlas.links` carries what is near what. |
| D144 | The AI says what is near what; DES places it | The draft never writes coordinates. It writes relations ("two days north of X", "inside Y", "on the coast") as `atlas.links`; DES solves them into spots and lists the ones that contradict. What the draft guessed (nothing in the lore says it) is marked for the player to see before locking. |
| D145 | Markers are proposed, then placed (the owner's chart) | The AI's places arrive in a tray, each with a proposed spot. The player drags one onto the map, or takes every proposal at once. A marker placed by hand is pinned: no later draft or layout moves it. |
| D146 | Kinds are the categories | A place has a kind (settlement, stronghold, shop, tavern, sacred, ruin, wild, water, landmark, home, other), guessed from its name when nothing says it. The sidebar lists the kinds with their counts; each switches its markers on and off; Show all and Hide all; a search over names and notes. |
| D147 | The window fills the screen | `#dooms-atlas`: the whole viewport on a PC, the sidebar on the left (it folds away), the map in the rest. On a phone the sidebar is a sheet over the map. |
| D148 | The looks restyle it through tokens | The Atlas's colours are custom properties on `#dooms-atlas`, read from the look in force (`--ov-*` under `body[data-dooms-ui]`, else `--rpg-*`). Land, sea, the terrains, the routes and the markers are all tokens; a look changes them in one rule. |
| D149 | The Hub window is replaced entirely (the owner) | The Hub's window goes with its board. **Open:** whether the scene engine under it (`features/hub.js`: many small chats, the Start and End sheets, the memory) goes too, or keeps a way in from the Atlas. Nothing in phases 1 to 3 depends on the answer; phase 4 does. |
| D150 | The branch (the owner) | `Project-Long-Shot`, from `Project-Short-Fuse`. |
| D151 | Nothing lands on the map by itself (the owner) | Replaces the automatic layout of D140 as the way places arrive. A place is a marker once the player gives it a spot; until then it waits in the tray at the head of Places. A row is dragged onto the map, or tapped and then the map is tapped; Place all puts every one at a free spot (the world's places at the layout's spots, the rest on a spiral), to be moved after. What the player did is the chat's **book** (`chat_metadata.dooms_atlas`): the spots, the deletions, the merges, the markers made by hand, the names, kinds and notes changed, the scale. A spot is still written once and never recomputed; a spot the world itself carries (`pack.atlas.spots`) counts as placed. |
| D152 | Markers are made, moved, renamed, merged, taken off and deleted by hand (the owner) | The pin tool, then a tap: a new marker, opened on its name. The arrows tool: while on, a marker is dragged to where it belongs. The card's foot: Edit (name, kind, note), Merge (into another place: the marker goes, and its names, rooms, people and visits count at the other from then on; the other is "also called" it, and can split it off again), Take off (back to the tray), Delete (for good: the story naming it again does not bring it back; it is listed under Deleted, where it can be restored). |
| D153 | Rooms fold into their building (the owner) | A room, a wall, a corner of a place is not a place of its own. Of the world's places, anything below a region's place is a room of it. Of the story's own, a location with a room in it ("Mara's House, Bedroom") folds into the part that is not a room; a part two locations share is their place; a location that is only a room ("Bedroom", "bedroom on the wall") folds with the others of that room. The card lists them under Inside. A room alone cannot be told which house it is in: that is what Merge is for. |
| D154 | Ink on parchment, or the world's own picture (the owner: "both") | The map is drawn like an inked map: paper with a grain and a darkened edge, one shore in ink with two ripples off it, regions tinted by their terrain with its drawings (peaks, trees, dunes, reeds, tufts), dashed paths, names in a serif hand, a compass. Still vectors: one SVG layer and one still paper layer over it. The land is drawn around the markers, so it follows where the player puts things. A world that has a picture (`pack.map`, the World Builder's) shows it under the markers instead of the drawn land; a picture that will not load falls back to the drawn land. The sidebar keeps the look in force. |
| D155 | The clean-up pass (the owner) | Clean up with AI: one background request (the tracker's profile) lists the places by number and asks which are the same place or a part of another (merge) and which are not places at all (delete). The reply only proposes; each proposal is done or passed over by the player, or all at once. Nothing changes by asking. |

## 2. Shapes

A place in the pack gains two fields: `kind` (one of `ATLAS_KINDS`, or ''
for "guess it") and `note` (a sentence, 300 characters).

`pack.atlas`:

```
{
  scale: 'town' | 'region' | 'world',   // what one layout unit is (§3)
  unit: 'mi' | 'km' | 'league',
  pace: number,                          // units a day on foot; 0 = the scale's default
  spots: { [placeId]: { x, y, by: 'layout' | 'user' } },   // layout units, y down
  links: [{ a, b, days, dir }],          // phase 2: what the draft said is near what
  notes: string,                         // phase 2: what the player wrote first
  locked: boolean                        // phase 2: the sheet is the player's now
}
```

## 3. The pure model (`src/utils/atlas.js`)

One layout unit is a short walk between two neighbouring places. A scale
says how far that is: `town` 0.1 mi (a street), `region` 15 mi, `world`
60 mi. The scale is the book's when the player chose one, else the
world's own, else a guess (a region for a world with several regions,
else a town).

**The book** (`normalizeBook`, `placeAt`, `unplace`, `addPin`,
`removeMarker`, `restoreMarker`, `mergeInto`, `mergeTarget`, `unmerge`,
`editMarker`, `withScale`, `placeAll`): pure edits, each returning a new
book. `{ scale, spots: { id: { x, y } }, gone: [id], merged: { from: to },
made: [{ id: 'pin:…', label, kind, note }], edits: { id: { label, kind,
note } } }`. A merge that would loop is refused.

**Folding** (`labelSegments`, `roomKey`, `foldPlaces`): D153. A folded
place keeps the id of the location that names it plainly when there is
one, so a spot put under it stays its own; a spot under any location
folded into it still places it.

**The model** (`atlasModel({ pack, state, player, book, weather })`):
`markers` (the placed), `tray` (the party's place first, then the
visited), `deleted`, `regions` (a region of the world is a named blob
around its placed places, with its terrain and its drawings), `land` (a
blob under every region and every lone marker, each with two ripples),
`routes` (a minimum spanning tree over the markers: drawn, never
measured), `party` and `partyInTray`, `bounds`, `measure`.

**The layout** (`layoutAtlas`, `suggestSpots`): what Place all proposes.
The world's places on sunflower spirals (a place's spot depends only on
its parent's and its own index among its siblings, so a place added later
moves none); anything else on a spiral from the middle, each at the first
point far enough from everything already there.

**Distance** (D141): `distanceBetween`, `travelHours`, `describeLength`,
`describeTime`, `describeDistance`. **The search and the switches**:
`filterMarkers` (names, notes, regions, rooms, other names, people),
`kindCounts`. **The clean-up pass** (D155): `tidyList`, `buildTidyPrompt`,
`parseTidy`, `applyTidyItem`. Tested by `tools/atlas-test.mjs`.

## 4. The window

`src/systems/ui/atlasViews.js` (pure HTML: the shell, the sidebar, the
tray, the clean-up's proposals, the marker, the card in its three modes),
`src/systems/ui/atlasMap.js` (Leaflet under `CRS.Simple` with one SVG
renderer, the markers as `divIcon`s; the drop, the tap, the drag) and
`src/systems/ui/atlas.js` (the controller). The book and the clean-up's
request are `src/systems/features/atlasBook.js`. `styles/atlas.css`,
loaded when the window first opens. Opened from **Atlas** in the D menu
and by `/atlas`.

- The sidebar: the world's name with the date; the tabs Places, People,
  News, Rumours, Hooks. Places: the tray, Clean up with AI, the search,
  the kinds with their counts, the list, the scale, Deleted.
- The map: wheel, drag and pinch; the zoom buttons; the tools (the
  sidebar, add a marker, move markers, find the party, the whole map,
  close); a scale bar in the world's unit (feet on a town's map). What a
  zoom shows goes by how many pixels one layout unit is on screen: under
  26 the places are dots, from 26 pins, from 52 pins with their names.
  The party's marker is whole at every zoom.
- The card: D142 and D152.

## 5. Phases

1. **The map** (built, then reworked: §6, §7).
2. **The sheet**: the notes box, the draft around the notes,
   `atlas.links` and the solver that turns them into the spots Place all
   proposes, the guesses marked, the lock (D143, D144). The markers' half
   of this phase (the tray, the drag, the card's tools) is built (§7).
3. **Tracking**: weather by region on the map and the card; hooks on the
   card; the distance and the travel time given to the travel cut, so the
   story's clock moves by the road's length; a merged or deleted place
   told to the tracker, so the story stops naming it apart.
4. **The clean-up**: the Map window, the Hub window and the board
   removed with their styles and tests (D138, and D149 once answered);
   the World Builder's Map tab keeps the picture upload and gives its
   nodes to the Atlas.

## 6. Phase 1 as built

Two commits on `Project-Long-Shot`: "Atlas 1" (this plan, the pure model,
its test) and "Atlas 2" (the window: `atlasViews.js`, `atlasMap.js`,
`atlas.js`, `styles/atlas.css`, **Atlas** in the D menu, `/atlas`).

Tests: `tools/atlas-test.mjs` (pure, 63 checks) and
`tools/atlas-browser-test.mjs` (the views, the map and the stylesheet in
a headless Chromium: the window, the switches, the search, the card, the
zoom, the fold, the five looks, a phone; `--shots` writes PNGs, and
`DES_FA=<a Font Awesome folder>` draws the icons in them). The three
modules are in `tools/lazy-graph-test.mjs`'s lazy list.

Not yet done in phase 1, and not yet looked at inside SillyTavern itself
(the browser test has no SillyTavern, so the controller `atlas.js` is
covered by the load check alone): the tracker's weather in the sidebar's
head; the parity rows; the What's New entry. The Map window and the Hub
are untouched and still open from their own menu items until phase 4.

## 7. The rework after the first look (2026-11-09)

The owner opened phase 1 on a long campaign: every location the story had
ever named stood on the map at a spot the layout chose, five of them the
same house. D151 to D155 are his answers. Built in one commit, "Atlas 3":

- The model rewritten around the book (§3); the Elsewhere region and the
  automatic placement of the story's places are gone.
- The tray, the pin and arrows tools, the card's Edit, Merge, Take off
  and Delete, Deleted with Restore, the scale's select.
- The parchment look and the world's own picture (D154).
- The clean-up pass (D155).

Tests: `tools/atlas-test.mjs` (pure, 90 checks), `tools/atlas-flow-test.mjs`
(the book and the clean-up's request in the sandbox),
`tools/atlas-browser-test.mjs` (the views, the map and the stylesheet in a
headless Chromium: a long campaign's fifteen wordings as eight places, the
drag, the tap, Place all, a marker made, moved, merged, deleted and
restored, a built world's regions, the switches, the search, the card, the
zoom, a world's picture, the fold, the five looks, a phone).

Still true: the controller `atlas.js` needs SillyTavern and is covered by
the load check alone; its first real run is the owner's. Known limits: a
room named alone ("Bedroom") cannot be put in its house without a Merge
or the clean-up pass; the book is the chat's, so two chats of one world
do not share a map (a world's own spots, `pack.atlas.spots`, are read but
nothing writes them yet); the tracker's weather is not in the sidebar's
head yet.

## 8. After the second look (2026-11-10)

The owner: "it opened to the map I had left over from short fuse. I
removed that map but don't see a way to create the new style map." Two
gaps, both closed in "Atlas 4":

- **Start your map.** A map with nothing on it shows a panel in its
  middle saying how the map is made (the land draws itself around the
  places) with Place all N for me and I'll place them myself, or Add a
  place by hand for a world with none. Waved away, a line across the top
  says the same. (`atlasStartHtml`.)
- **The picture tool.** A world that has a picture gets a button among
  the tools that switches between the picture and the drawn map
  (`book.drawn`, `withDrawn`); the picture is kept. Nothing has to be
  removed in the World Builder to see the drawn map.

## 9. Layers (2026-11-10, D156)

The owner, with a screenshot of the city of Hask and a house drawn as two
pins of one size on one map: "Hask is a city, it's going to be wide and
the house marker needs to be able to sit inside it. Should we make a
layered map like World of Warcraft where you can click on a region and
zoom in?" And: "the stair in my current story is a dungeon that goes
pretty far underground." His answers: rooms stay a list on the card for
now; Hask is a city; build it now. Built in "Atlas 5".

| # | Decision | What it means |
| --- | --- | --- |
| D156 | The maps are layered (the owner) | Every place stands on one map: the top map, or the map inside another place (a city's, a dungeon's, a level's). Any marker can be entered (Enter on its card, or a double-click): its own map, with a trail across the top (the world, then each place down to this one) that leads back out. A place put on a map belongs to it: dropped from the tray, tapped down, or made by hand there. The card's Move sends a place onto another place's map, where it waits to be placed. A marker carries what is inside it: a door with the count, the people, the party's flag ("The party is inside"). Each map has its own scale (a region on top when places hold maps, a town one map in, a building or dungeon below; the select changes this map's alone). Distances are told on the party's own map; across maps they are not told yet. |
| D157 | The world's own nesting is read as layers | A world's place that has a parent stands on its parent's map, unless it is a room of it (its name is a room's) or carries its parent's name (the city listed inside the city): then it folds into the parent, as rooms do (D153). The named regions drawn around places (phase 1's) are gone: a region is a marker that holds a map. A marker whose name tells a terrain stands on tinted ground with that terrain's drawings. |

The book gains `inside: { id: holder }` ('' said outright = the top map)
and `scales: { layerId: scale }`; `placeAt(book, id, spot, layer)`,
`moveInto`, `withScale(book, scale, layer)`. The model takes `layer` and
returns `layer`, `layerLabel`, `depth`, `trail`, `all` (every live place
with its map: the search, Merge, Move and the clean-up read it),
`partyId`, `partyLayer`. A place whose holder is deleted, or that would
hold itself, stands on the top map. The world's picture is the top map's
alone. The search reaches every map and a match elsewhere goes to its
map; Find the party goes to the party's map.

Known limits: a room named alone still needs Merge or Move; a place whose
holder is deleted keeps the spot it had on the inner map; distances
across maps (a house in one city to a house in another) are not told.

## 10. Grounds (2026-11-10, D158)

The owner, with a screenshot of Hask alone on the top map: "Hask is just a
city, and right now this looks like an island. What do we do with the
space around Hask?" Hask is landlocked. Built in "Atlas 6".

| # | Decision | What it means |
| --- | --- | --- |
| D158 | Every map has a ground (the owner) | What the empty space of a map is: Open country (land all over, tufts and low hills), City streets (blocks, a little askew; the paths drawn as streets), Underground (dark rock, a chamber around every place, passages between them), Indoors (a floor's squares), Coast with the sea to the north, east, south or west (the land everywhere else), Islands (phase 1's shore around every place). The default follows the map's scale: a world or a region is open country, a town is streets, a site is the underground when the place is a ruin or its name tells of one (a stair, a cave, a crypt), else indoors. The select under the scale changes this map's alone (`book.ground`, `book.grounds`, `withGround`, `groundOf`, `groundDecor`). All of it is vectors hashed from the map's id: the same map draws the same ground. |

Also: the wheel over a focused select steps its value in some browsers,
so the sidebar scrolled past the scale's select could change a map's
scale unasked (the owner's top map read "A building or dungeon" without
his choosing it; no other path to that was found). The Atlas now takes
the focus off its selects when the wheel turns over them.

Also (2026-11-10, the owner: "names only show when moused over"): a marker's
name shows under the pointer or the keyboard's focus and nowhere else, at
every zoom, the party's included. On a phone the card names the place.

Also (2026-11-10, the owner: "what are all the marks? why does the camera
keep snapping to the center"): open country draws nothing now (the tufts and
hills read as stray marks); the view is never pulled back to the middle (the
canvas the map can be panned over is three times what a fit shows, its edge
stops a drag instead of springing back, and the zoom goes one step further
out). tools/atlas-browser-test.mjs drags the map and checks it stays.

## 11. Set up this world, and Fill out this map (2026-11-10, D159, D160)

The owner, on a chat that existed before the Atlas: "this was a
preexisting chat and this is not set up correctly, how do I run the fresh
world setup for this? the first step we talked about." His answers: build
it now; applying it replaces the map; give the choice of how much of the
chat to read, with a whole-chat option. And while it was being built: "We
also need a way to fill out the map: I give you what we have and you
expand the area, and those sections can be non-canon and be edited later
for the player's story." Built in "Atlas 7" and "Atlas 8".

| # | Decision | What it means |
| --- | --- | --- |
| D159 | Set up this world (the owner; D143 and D144 built) | A panel over the map in three steps. **Notes:** what matters to the player (optional; it outranks the lore and the chat), and how much of the chat to read: the recent scenes (one request) or the whole chat (read in parts of about 14,000 characters, one request each scanning for the places it names, at most 60 parts, the count told beforehand; a part that fails is left out; Stop ends the reading). **The draft:** one request writes the places around the notes from the card, the lore, the recent scenes, what the scans found and the places the map already knows (numbered): what is inside what, a kind and a note each, what is near what by direction and distance, which known places each one is, what it guessed; never a coordinate. **The review:** the draft as a tree; a name, a kind, what a place is inside of, or leave it out; the guesses marked. **Apply** replaces the chat's book: every place a hand-made marker on the map of the place it is inside, at a spot solved from what is near what (`layoutDraft`), the known places merged into it, the non-places deleted, the top map's scale as drafted. One Undo is kept until the Atlas closes. Known places the draft did not mention are left in the tray. |
| D160 | Fill out this map; not canon (the owner) | One request adds 4, 8 or 12 places that plausibly belong on the map shown, around the ones there, fitted to the world and to what the player asked for. The player keeps, renames or leaves out each; the kept ones are added to that map at spots solved from what they are near, and nothing already there moves. They are **not canon** (`made[i].loose`): a dashed ring on the map, a mark in the list, a line on the card with Make it canon. What the set-up guessed is not canon either. |
| D161 | A location that carries a marker's name is that marker | A location the story names in which a part is a hand-made marker's name ("Hask, the house on the lane, the bedroom wall") is that marker, the deepest one named: the people and the party there stand at it, and no new entry appears. This is what keeps a set-up world in step with the story after it is applied. |

`src/utils/atlasSetup.js` (pure: `chatLines`, `chunkLines`, `recentLines`,
`buildScanPrompt`, `parseScan`, `mergeScans`, `buildSetupPrompt`,
`parseSetup`, `editDraftPlace`, `setDraftInside`, `removeDraftPlace`,
`draftRows`, `layoutDraft`, `applySetup`, `buildFillPrompt`, `parseFill`,
`layoutFill`, `applyFill`); the requests in
`src/systems/features/atlasBook.js` (`draftSetup`, `stopSetup`,
`setupReach`, `draftFill`); the panels `atlasSetupHtml` and
`atlasFillHtml`. Tests: `tools/atlas-setup-test.mjs` (pure),
`tools/atlas-flow-test.mjs` §3 (the requests in the sandbox),
`tools/atlas-browser-test.mjs` §5c (the panels, and the maps a draft and a
fill make).

Not done: the lock (D143's last word: nothing stops a later set-up from
replacing the map but the warning); non-canon places are not told to the
story (nothing of the Atlas is yet); the notes are not kept after the
set-up closes.

| D162 | Open country has woods, ponds and plain (the owner: "trees on the outside, even better trees, ponds, plains, randomly") | The land of an open-country map is cut into squares five units wide; each is a wood (a green patch with trees drawn on it: a crown and a trunk), a pond (a blue blob with an inked edge) or left as open plain, by a hash of the map and the square. None stands within reach of a place, so a place put down later clears what it lands in and moves nothing else. Drawn over what the map can be panned across and no further; one path for all the trees. |

## 12. Territories (2026-11-10, D163)

The owner, with two screenshots of World of Warcraft's maps (a continent
cut into zones that share borders; a zone with its terrain, its towns and
its neighbours named at the edges): "this is what I am looking for: the
segmented borders, and you click on a region to zoom into it. How do we
get there?" His world so far: Hask, a city, and Redfall Castle two days
out; the region they lie in is landlocked. Three steps were agreed; step
1 is built ("Atlas 9").

| # | Decision | What it means |
| --- | --- | --- |
| D163 | A region is a land with borders (the owner) | A place whose kind is Region is drawn as a territory, not a pin: its own blob around its spot, cut along the line halfway to every other region on the map, so neighbours meet at one border and the lands tile into one country (`territoryOutlines`). A border between two lands is waved the same from both sides. A land is tinted by its terrain, else by one of six parchment hues; it names itself under the pointer; **a click enters it**. Its card is behind its small standard on the land, or a right-click. With a marker waiting to be put down, a click on a land puts it there. **Group into a region** (Places, on a map of pins with no region yet) puts everything on the map inside a new region standing where they stood, each keeping its spot on the region's own map (`wrapInRegion`). A map that holds regions is a world's by default, a region's own map a region's, a city in a region a town's. Fill out this map on a map of regions suggests neighbouring regions, not canon; the set-up is told to put regions on the top map when the story reaches beyond one settlement. Regions stand further apart than pins when laid out, so their lands have room. Outside the lands the ground is the map's own: open country for a landlocked world, the sea with Islands. |

Step 2 (built: §15, D168): inside a region, the land takes the outline it
has on the map above, with its neighbours named along the borders they
share, and terrain drawn across it (ranges, lakes, forests, roads). Step 3
(not built): the set-up and the fill say what each region's land is like,
so the terrain follows the story. A picture of the player's own under any
map, not only the top one, is the way to a painted look.

| D164 | Roads are the player's to draw (the owner: "I am moving it but I can't add new roads") | The map still joins each place to its nearest by itself. The Roads tool (the road button among the tools): while it is on, a place clicked is picked, a second place clicked makes a road between the two, or takes away the one that was there, whether the player drew it (`book.roads`) or the map did (`book.cut`); Esc ends. A road follows its places when they are moved; one to a place that is deleted, merged away or on another map is not drawn. Roads are still drawn, never measured (D141). |
| D165 | The time is the roads' (the owner: "should the time be based on the roads?" Yes to all three) | Supersedes the part of D141 that said routes do not shorten or lengthen anything; the straight line (`distanceBetween`) is kept for what it is. **By road:** the time from the party to a place is the quickest way there is (`routeBetween`), along roads where roads join the places; a road takes its drawn length at the map's pace. **Cross-country:** a stretch no road covers takes its straight line half as long again (`CROSS_COUNTRY` 1.5); a way can be partly by road. Between lands (regions) there are no roads to miss: the straight line at the pace. **A set time:** a road clicked opens its own card (the two places, what it is as drawn, a figure and a unit: minutes, hours, days; Save, Remove road); the time set (`book.roadHours`, hours of travel, a day being eight) is what that journey takes however far apart the pins are drawn, even where another way would be quicker, and the drawn miles are left out of the card's line. A time set on a road the map drew makes that road the player's, so it stays when the map redraws its own. A road taken away takes its set time with it and is cut, so the map does not draw one there by itself. **Told to the story:** Travel here passes the journey (`describeJourney`: "about 2 days by road") to the travel cut; the instruction says the journey takes that long and the date and time move on by it, and an arrival the player typed still stands, with the map's word beside it. |

The card's line reads "96 miles by road, about 4 days on foot", "about 2
days by road" (a set time on the way), "75 miles cross-country, about 4.5
days on foot", "…, partly by road, …". Known limits: the map's own roads
are redrawn when places are added or moved, so a time that goes by length
along them can shift a little unasked (a set time cannot); roads are
straight lines; the time told to the story moves the tracker's date and
time through the reply, not Live World's own clocks; across maps no time
is told.

## 13. Regions always border one another (2026-11-10, D166)

The owner, with a screenshot: "Fill out this map just added a bunch of
nodes to the map and added 4 regions, but they are not touching? We need
region borders." Two faults. A fill on a map of places could come back
with regions among them, which then stood on the same map as the places.
And a region's land was its own blob about its spot, cut by a neighbour
only when the neighbour was near, so regions put down apart did not touch.
Built in "Atlas 11".

| # | Decision | What it means |
| --- | --- | --- |
| D166 | The lands of a map are cut from one landmass | Supersedes D163's "its own blob around its spot". The regions on a map share a landmass: the ground about all their spots and a margin further, its shore waved by where each point of it is (`landmassOutline`), so a region added at one end leaves the far shore as it was. Each region's land is that landmass cut along the line halfway to every other region (`territoryOutlines`): the lands tile it with nothing left over, and every region borders its neighbours however far apart their spots are. **A place put down on a land goes inside that region** (`territoryAt`): dropped from the tray, tapped down, or made with the pin tool (which then shows the region's map with the new marker open on its name). A region put down stays on the map of regions. **Fill out asks what to add** (`fillOptions`): places, on a map of places; regions, on the top map or a map that holds regions. Asked for places, nothing comes back a region. Asked for regions on a map that has places, those places first go inside a home region where they stood (the AI names it in `home`, the review lets the player rename it; not canon, since the name is the AI's), and the new regions are laid out around it. **Group into a region** is offered wherever a map has places, also when it has regions already, with a word in Places when the two stand side by side. Grouping changes no distance between the places: the region's own map keeps the scale they were on. A map of regions reads at a region's scale by default (not a world's), so a land is as wide on it as it is inside. The card's Edit offers Region among the kinds. |

For a map already in the state the owner's was (places and regions side
by side): the regions now border one another as soon as the Atlas opens;
Group into a region puts the places inside a land of their own, which
takes its place among the others.

## 14. Lands that look like lands; a colour for each (2026-11-10, D167)

The owner, with a screenshot of nine regions tiling an oval: "this looks
better. But I want each region to be less of a circle blob and be more
realistic to how regions form. And I want each region to be its own shade
of a color", then: "I meant just each being a different color." Built in
"Atlas 12".

| # | Decision | What it means |
| --- | --- | --- |
| D167 | The lands are bent, uneven and each its own colour (the owner) | **The bend:** every outline of a map's lands is drawn through one smooth push of the map's points, read from the map's id (`bendOf`: two waves, 18 and 8 units long, its slope kept under 1 so it never folds the map over itself). Straight borders come out curved and the round shore lumpy; borders that were shared stay shared, since both lands are pushed alike; the lands are cut around the spots as they are before the bend, so a region's spot is always on its own land. **Uneven ground:** a border between two regions is not always halfway: a region holds a little more or less ground than its neighbour, by its id, within a part of the way to its nearest neighbour (so no spot can fall on the wrong side). **Borders that wander:** a shared border is waved along its length by three waves, more for a long border than a short one, dying away at its ends where three lands meet; the shore by four. **A colour each** (`territoryShades`): twelve hues right round the wheel in three strengths, muted to sit on the paper. A land takes the colour it likes best (by its id; the hue nearest its terrain when its name tells one: a forest green, a desert sand) that no land made before it has and that is well apart on the wheel from its neighbours': so no two lands are the same colour, neighbours are clearly different, and a land added later changes no colour already there. The colour is set on the land's path from the model; `territories[i].fill`, `territories[i].neighbours`. |

Also: a land clicked kept the keyboard's focus (its name is a tooltip,
which makes the path focusable) and the browser drew a box round it; no
box is drawn now, and the keyboard's own focus thickens the border.
`territoryCells` returns each land with the regions it borders, which
step 2 (a region's neighbours named along its borders) will read.

## 15. Inside a region (2026-11-10, D168)

The owner, after the list of what was next: "alright lets go with step 2".
Built in "Atlas 13".

| # | Decision | What it means |
| --- | --- | --- |
| D168 | A region's own map is its land (the owner's step 2) | **The land:** entering a region shows the land it has on the map above: the same outline, the same colour (paler, so its terrain reads), under a heavier border (`atlasModel().realm`). Its places stand on it as pins, joined by their roads. **The same spots on both maps:** while every place of the region stands on the land as it lies on the map above, nothing is moved (`landFrame`: k 1): a place dropped on the land from above is at that spot of it inside. When one does not, the land is drawn wider, a step at a time (1.25, 1.6, 2 ... up to 64), until it holds them all: about its own middle when that takes little (a place put just past the border), else laid under its places, its middle on theirs (places laid out before the land was there, as a set-up's are). A land always holds its places. A place dropped on a land from the map above goes to the matching spot of the land inside (`spotOnLand`), wherever the land is laid there. **The neighbours:** the lands it borders lie around it, dimmed, in their own colours; each is named along the border it shares, the name turned the way the border runs and set on the neighbour's side (`territoryCells` gives every land its shared borders, one run of points a neighbour, the same line from both sides). A neighbour's name, or its land, is clicked to go there; under the pointer a neighbour names itself as a land does on the map above. With a marker waiting, the click puts it down instead. **The terrain** (`landTerrain`): mountain ranges (a wandering line of peaks, the tallest in its middle, foothills beside it; each peak a shape of the paper's colour so a nearer one hides a farther), woods (a patch of green with its trees) and lakes; by what the region's name tells (`guessTerrain`): a forest is wooded all over, mountains have three or four ranges, a swamp is full of meres and reeds with a tree here and there, a desert has dunes, one range and no woods, snow has ranges and few woods, anything else is open country with a few woods, a lake or two and perhaps a range. A larger land has larger terrain, not more of it. Everything is read from the region's id and from where on the land it is, counted from the region's spot: the same land has the same terrain every time, a land moved takes its terrain with it, a border that moves changes only what stood by it. Nothing is moved to make room: a peak or a tree that would stand on a place or a road is left out (a pass, a clearing, a way cut through a wood), and so is a lake; what a place changes is what is next to it. **When there is no land of its own:** a region the player gave another ground (streets, a shore, an island) is drawn as they said; a region that holds regions shows their lands; a city, a building or a dungeon is no land of the map above. **The view:** a fit shows the whole land and little else; no start panel is laid over a region's land (a line says nothing stands on it yet); Place all starts from the region's spot and keeps to its land while there is room, and Fill out lays its places from there. |

Found on the way and fixed: entering a map smaller than the one left
started a glide of the zoom to the new map's limit, which ended after the
fit and undid it, so the view came to rest zoomed all the way out. A view
outside the new limits is now put inside them at once.

Known limits. The land is as wide inside as on the map above only while
both maps are at one scale (they are by default: D166); the player who
sets them apart gets the same drawing at two scales. Terrain is told by
the region's name alone until step 3. No rivers. A region that holds
regions shows no neighbours. The picture of the owner's own is still only
under the top map.

## 16. The review of DES as a whole, and what scenes are for (2026-11-10)

The owner, before going on: "take the time to look at DES as a whole
before we continue and make sure our current plan works with the current
system", and on the purpose: characters are strongest at the start of a
chat, flatten into one voice around message 100, and the chat breaks
around 300; many small chats are how a story goes on for a thousand
messages with that first strength kept. And on what it replaces: "FD
continuity is something I have you do on a local chat. You basically pull
apart a chat, add it to canon and create a new chat. This is an attempt
to put that system in DES." That run (his chat-to-canon instructions)
writes a canon of hard facts and rulings with a section a character, a
ledger of what is settled and what is open, a count of the phrases the
narrator leans on turned into style law, and a lorebook that is always
on, built from them.

What the review found, each checked in the code:

- The scene engine (`features/hub.js`, `utils/hub.js`) is built and is
  what the Atlas should start scenes with: D142 is reversed and D149
  settled (the engine stays; its window goes once its sheets have a home).
- The Atlas reads the chat in front (`getWorldState`, `getActivePack`,
  `getBook`); the engine keeps a world's memory in `extensionSettings.hub`
  and moves the world there at End, so the chat left open shows the world
  as it was. The book (`dooms_atlas`) is not among the stores a scene
  carries (`HUB_KEYS`).
- Only a world the player made (a custom pack) with a narrator card bound
  can be played as scenes, never the blank world, never a group chat; and
  nothing takes a chat already played as a world's first memory (hub-plan
  D131, not built). The owner's worlds are not World Builder worlds.
- A background request holds only what DES puts in it: the openers get one
  line a person (200 characters of the Workshop's description) and no
  lorebook. The owner's characters are keyword entries in a campaign's
  book (Lore Library), kept on by the campaign, not by the auto-link (which
  switches on a book named exactly as someone the chat has ever met).
- Nothing counts a scene's length, and there is no way from one scene
  straight into the next at the same place with no time passed: End always
  moves the world.
- The Start sheet, the opener picker, the End sheet and the strip live in
  the old Hub window's modules; the World Builder's Map tab uses its board;
  the Atlas's sidebar is styled by the old Map window's block of
  `style.css`. The old windows cannot be removed before those have moved.
- Against the owner's own run, End lacks: the count of repeated phrases
  (his "highest-value part", and the one aimed at characters flattening),
  where each character stands now, open threads, and contradictions put
  to the player instead of the later one winning unseen.

| # | Decision | What it means |
| --- | --- | --- |
| D169 | Scenes are for fresh character performance, and End is the owner's chat-to-canon run done by DES (the owner) | The measure of the scene work is his: a new chat as strong as message one, the story carried whole. What End writes is modelled on his run (above), not on a recap alone. |
| D170 | The continuity is a real lorebook (the owner: yes) | What DES carries from scene to scene is written as a book in the Lore Library, read and edited as his hand-made Continuity book is now, and it takes that book's place for a campaign played as scenes (hub-plan D126 is the start of it). |
| D171 | Completed quests stay; drawing a place by hand waits (the owner) | The Atlas's Hooks tab lists the quests completed in the chat under the hooks (built). Drawing a place's picture by hand is kept but set aside until it fits the Atlas. |

Fixed with the review ("Atlas 14"): the Atlas's requests (clean-up, set-up,
fill) now wait until no reply is being written and no other background
request holds the line, before every request of a long set-up (they ran
on the tracker's connection profile whatever the chat was doing, so a
message sent meanwhile could be answered on that profile); and a scene's
recap is asked for with the scene's brief, which it never got (it was read
from a scenario the scene chat does not have; the brief is on the mark).
Hooks and the hand-drawn place picture have the same gap as the Atlas had
and are not changed here.

## 17. The scenes build, step 1: a campaign becomes a world (2026-11-10, D172)

The owner, to the build order of §16's findings (a campaign becomes a
world; the map lives with the world; start and end from the Atlas; openers
with the characters' entries; End as his chat-to-canon run; the count, the
nudge and End and continue here; the old windows removed; terrain that
follows the story): one world of scenes for a Lore Library campaign,
"yes"; the chat is with a single card; "go". Built in "Atlas 15".

| # | Decision | What it means |
| --- | --- | --- |
| D172 | Play as scenes: a chat already played is where a campaign's scenes begin (the owner; hub-plan D131 built, and widened) | The Atlas's foot has **Play as scenes** on a chat that is no scene. Its panel says what will happen, asks for the record of the chat so far (one request over as many of the last forty messages as a page holds, `prepareAdopt`), shows it to be read and corrected, and only then changes anything (`commitAdopt`). **The world:** the chat's own when it has one of the player's; else the one the campaign that is switched on already has; else a new one under the campaign's name (under the chat's world's name when no campaign is on). A new world is made **empty of places**: the places the story named stay the story's (`loc:` ids), so the map made of them, and every deletion and merge on it, stands; the existing Make this a world turns them into the world's own places under new ids and would have orphaned the book. The chat is carried over to the world (`adoptWorld`, now with `ownName`: the chat goes by the world's name, not the blank world's). **The narrator:** the chat's card, unless the world has one; a card that narrates another world is refused with that world named (one card, one world, hub-plan D114). **The memory:** the chat's stores as they stand, sealed, the world's entry keeping the campaign it is the scenes of (`campaign`). **Scene 0:** the chat is kept in the world's list as "Before the scenes" (`adoptScene`, id `s0`, ended, first), its record what the first scene is told happened last time; the chat itself gets no mark and stays an ordinary chat. Taken again (the chat went on, or another chat of the campaign is taken), the memory is replaced, only with the tick that says so; the scenes played since stay listed. A chat kept under a card that is not the narrator's is not called gone when the narrator's chats are looked over. Refused, each with its own words: a group chat, a scene chat, no chat, no world, no card, Live World off, a reply being written. **The map is carried:** `dooms_atlas` is among the stores a scene carries (`HUB_KEYS`), made safe by `normalizeBook`, so a scene opens on the player's map and what it adds is the world's when it ends. Done, the panel offers Start a scene, which opens the old Hub until its sheets move to the Atlas (step 3). |

Not in this step: the map is saved to the world when a scene ends, not as
it is edited; the Atlas still reads the chat in front, so after an End it
shows the world as that chat left it (both are step 2). The hub's own
tests cover the engine in the sandbox; the panel is rendered in the
browser test; nothing here was run in a real SillyTavern.

## 18. The scenes build, step 2: the map lives with the world (2026-11-10, D173)

Built in "Atlas 16".

| # | Decision | What it means |
| --- | --- | --- |
| D173 | The map is the world's as it is edited, and the Atlas shows the world between scenes | **In a scene being played** a map edit is the world's at once: `setBook` copies the chat's book into the world's memory (`carrySceneBook`), so a scene left without an End loses no map work. Only the world's open scene does this: one set aside keeps its edits to itself, and so does one the memory has moved past (its End keeps the newer memory, hub-plan D123). The memory's date is not moved by it, so no scene goes stale. **Between scenes**: a scene that has ended is a chat the world has moved on from (End moves the world in the memory only, and later scenes change it further), so in such a chat the Atlas reads the world's memory, not the chat (`atlasSource`): the world's state, the map, the date and the place, the hooks and the completed quests. The sidebar says so under the world's name. The map can be edited there, into the world's own copy (`setWorldBook`), and the next scene opens on it; unless a scene is being played, whose chat then holds the live map: the notice names that scene and has Go to it, and an edit is refused with those words. What needs a chat waits for a scene: Travel here, Advance now, the AI's set-up, fill and clean-up, offering and taking hooks are off between scenes. Any other chat (a long chat, a scene being played, one set aside) is read as it is, as before. The Atlas draws itself again when the hub's store changes under it (a scene ended or started). |

The controller's part of this (`atlas.js`: every read and write of the
book and the world through one source) is load-checked and its views are
rendered in the browser test; the source itself and both writes are
tested in the hub's sandbox (`tools/hub-flow-test.mjs` §10). Not yet: the
Atlas with no scene chat in front at all (another chat, or none) cannot
show a world of scenes; choosing one comes with starting scenes from the
Atlas (step 3).

## 19. The scenes build, step 3a: a scene started from a place (2026-11-10, D174)

Built in "Atlas 17". D142 ("starting a scene from a marker was not
chosen") is reversed by the owner's order of §17.

| # | Decision | What it means |
| --- | --- | --- |
| D174 | Start a scene here, on a place's card | Where a scene can be started (`sceneStartPlan`: between scenes, in the world of the ended scene in front; in the chat a world's scenes began from, in that world; not in a scene being played or set aside, which is ended first; not in a chat whose world is not played as scenes, which has Play as scenes), a place's card has **Start scene N here**. Between scenes it is the card's one way of going there (there is no chat to travel in); in the chat the scenes began from it stands beside Travel here, the quieter of the two. **The sheet** (a panel over the map): who is there, as ticks over the people the world knows, those last seen at the place ticked, and a line for anyone else; when, counted from the last scene, pre-chosen **from the journey on the map** (`journeyGap`: right after when the party stands there or the way is under an hour, later that day within a day's travel, else the journey's own time, "about 2 days later"), with the map's line for the way there under it, and the setting's own gap when the party is on another map; what brings the party, filled in from the journey; what the player wants from the scene. Write three openings asks the scene engine (`prepareScene`: one request, and one more when time passes); nothing is started. **The openings:** three cards with Open with this, the player's own text with Open with mine, Ask again, Back (`commitScene`, `askOpenersAgain`, `cancelStart`). Opened, the scene's chat is written and comes to the front, and the Atlas closes to make way for it. |

A whole loop can be played now: Play as scenes, Start scene here, play, End
the scene (from the strip above the chat, which still opens the old Hub's
End sheet), and between scenes start the next from the map. Not yet moved
to the Atlas (step 3b, 3c): the End sheet and the strip's buttons; the
list of scenes; starting from a person, a rumour, a piece of news or a
hook; choosing a world of scenes when no scene chat is in front; the D
menu's Hub and End scene.

## 20. Play as scenes saves a copy of the chat first (2026-11-10, D175)

The owner, told to back his chat up before trying Play as scenes on his
campaign: "that backup should be automatic no?" Built in "Atlas 18".

| # | Decision | What it means |
| --- | --- | --- |
| D175 | The chat is copied before it is taken (the owner) | `commitAdopt` writes a copy of the chat in front beside it, under its card, before anything is changed: the metadata and every message as they stand, named after the chat with "before scenes" after it (`backupFileName`; a name in use gets a number). It is an ordinary chat, opened like any other if the scenes are not wanted after all: its world is still the one the chat had. When the copy cannot be written, nothing is changed and the panel says why. The panel says beforehand that a copy is saved, and afterwards under which name. Taken again, another copy is saved under a name of its own. |

What the copy does not hold: the world made for the scenes and its entry
in the hub's store live in the settings, not in the chat. They change
nothing in the copy, and a world that is not wanted is removed in the
World Builder.

## 21. The scenes build, step 3b: a scene ended from the Atlas (2026-11-10, D176)

Built in "Atlas 19".

| # | Decision | What it means |
| --- | --- | --- |
| D176 | End scene is the Atlas's | In a scene being played the Atlas's foot has **End scene N**; the strip above a scene's chat is the Atlas's own (`atlasStripHtml`: the scene, its place and date, **Atlas** and **End scene**; ended: Atlas and Reopen), and its buttons and the D menu's End scene open the Atlas (`openAtlasEnd`), not the old Hub. **The sheet** (a panel over the map, `atlasEndSceneHtml`): the record of the scene, written when the sheet opens (the scene engine's `prepareEnd`) and shown to be corrected; what ending will do, a part a row with its state (the record, the ledger, the world, the memory), the ledger and the world each with "leave out"; for a scene the world has moved past, the word that its End keeps the newer memory and the tick to replace it. End scene runs the engine's `commitEnd`, each part's state shown as it runs, neither button pressable meanwhile. Ended, the sheet says so and the Atlas behind it shows the world as it stands (D173): To the map, and a place's card starts the next scene (D174). After Play as scenes the panel now says how the first scene is started on the map; it no longer sends the player to the old Hub. |

With this a story is played as scenes without the old Hub window: Play as
scenes, Start scene here, the strip's End scene, and the map between
scenes. Still only in the old Hub (step 3c): the list of scenes (resume,
set aside, continue from one), starting from a person, a rumour, a piece
of news or a hook, choosing a world when no scene chat is in front, the
hooks offered over a world's memory. `/endscene` is unchanged.

## 22. The scenes build, step 4: the openings are written with the people's lorebook entries (2026-11-10, D177)

The owner's characters are entries in a campaign's lorebook (title
"Kiyoha — who she is", keys "Kiyoha, oni, the axe, barbarian"), fired by
keywords in the last four messages; the campaign also keeps a Continuity
book that is always on (his canon, ledger and style law). The main
generation of a scene gets these from SillyTavern as any chat does. The
request that writes a scene's three openings got none of it: a line a
person, 200 characters of the Workshop's description. Built in "Atlas 20".

| # | Decision | What it means |
| --- | --- | --- |
| D177 | The openings are written with each person's own entry and the campaign's standing notes | Before the openings are asked for, the scene engine reads the lorebooks of the world's campaign (`booksOf`: the Lore Library campaign the world is the scenes of; a world with none reads the books switched on; twelve at the most; a book that cannot be read is passed over) and takes, for each person in the scene, **the entry that is theirs** (`castLore`: the one whose title begins with their name, else one with the name among its keys, else one whose title names them; by the whole name, then by its first word; switched-off entries never; cut to 2,600 characters, the people's together to 10,000), the player's own entry when there is room, and **the entries that are always on**, the weightiest first, to 6,000 characters (`standingLore`). The request carries them ("Their own notes", each under its name; "The story's standing notes") and is told to write each person as their notes say, in their own manner and way of speaking, so that no two sound alike, and that the standing notes hold over anything else. The picker says whose entries were used and who had none, and how an entry is found. With no lorebook read the request is exactly as it was. |

Why it matters: the first message is what a fresh chat imitates most. An
opening written from one line a person starts every scene in the
narrator's own voice; written from the entry, it starts in the
character's. Not changed here: the entries themselves (they describe a
voice but hold no lines of speech, and carry "RUN 3" state beside what
they contradict: §16); what DES keeps of where each person stands now is
step 5.

## 23. A scene holds the world; the clocks tick when it ends (2026-11-10, D178)

The owner: "at the end of a scene is when I think the clocks in the world
should tick. Because you've been in the scene: unless you sought
information on something on a clock you wouldn't know." Built in
"Atlas 21".

| # | Decision | What it means |
| --- | --- | --- |
| D178 | In a scene the world is held (the owner) | Live World moved the world every few replies in any chat, a scene's included: clocks ticked and people moved while the party stood in a room, and a scene of sixty messages cost up to ten background requests for it. Now a chat that is a scene (`inScene`: the hub's mark under its own file's name) is never advanced by the count of replies; the replies are still counted and the scene's place and people still recorded. **The world moves when the scene ends** (the End sheet's "The world: the clocks tick and people move, by the time the scene took", which can be left out) and for the time that passes before the next scene starts (the Start sheet's when). Between scenes the Atlas shows what moved: the news, the rumours, the clocks as they stand. Moving the world by hand (Advance now, `/advance`) still works in a scene, for the player who wants it. A long chat is as it was. The Atlas's status line says which it is: by the count in a long chat; "held while scene N is played: the clocks tick when it ends"; between scenes, "the clocks tick when a scene ends, and for the time that passes before the next". |

Asked of the owner and answered: the narrator still reads the visible
clocks as they stood when the scene opened (the world's line in every
generation says they are "facts as they stand, not instructions to the
scene"). Whether a scene's narrator should also be told that the party
learns a clock's state only by seeking it out: "no, don't add that". The
world's line is unchanged.

## 24. The scenes build, step 5a: the style law (2026-11-10, D179)

The owner, asked how the three open choices of step 5 should go: "what's
best for ease of use and performance". So: the continuity is a lorebook
DES owns in the campaign, little of it always on and each person's state
an entry that fires on their name; the phrase count is applied by itself,
with a way to overrule it; and what End learns more of a scene is asked
for in the request that already writes its record. This section is the
phrase count; the rest follows. Built in "Atlas 22".

| # | Decision | What it means |
| --- | --- | --- |
| D179 | The style law: what the narrator leaned on is counted and held against the next scenes | The owner's own run counts the narrator's repeated phrases by script ("sweetheart" 71 times across every woman) and calls it the part of most worth: it is the measure of characters flattening into one voice. **Counted in code** (`src/utils/styleLaw.js`, no AI, at once): over the narrator's messages of the scene (`mes` only, never swipes; thinking, tracker blocks and markup out), the ways of addressing someone that recur in speech (a word or two after a comma inside quotes: "Careful, sweetheart"; a call or a warning before the comma is none) and the phrases of two to six words that recur (none beginning or ending with a function word, none holding a name; a run of words repeated whole is reported once, whole). Too often is at least three times, and a tenth of the narrator's messages for a two-word phrase, a sixteenth for a longer one or a way of addressing someone. **Applied by itself:** the End sheet lists up to twelve, each with its count, the worst ticked already (every recurring way of addressing someone; a phrase half as often again as the mark or in three messages of every eight; six at the most); pressing End scene holds the ticked ones against the next scenes, and a tick can be taken off. `/endscene`, which has no sheet, chooses the same by itself. **The law** is kept on the world's entry (`style.bans`, ten at the most; it is the narrator's habit, not the world's memory, so it is kept even when a stale scene's memory is not): a phrase that turns up again despite it stays with its new count, one not seen for three scenes drops off by itself. **Told to the narrator** in one line that is never cut to make room: in every scene's brief and in the request for its openings ("Style law: the narration leaned on these and does not use them again: "sweetheart" as a way of addressing anyone; … Each person speaks in their own way; no pet name or gesture is shared between them."). |

What it cannot do: a count finds words, not sameness of manner; two
people who sound alike without sharing a phrase are not caught. A long
chat has no End and so no count yet.

## 25. The style law is behind a switch, off (2026-11-10, D180)

The owner had not known what "the phrase count" was: it was a step of his
chat-to-canon compile, done by Claude in a local chat, never a part of
DES, and D179 put it into DES under a name that was not explained to him.
Told what it is: "I have wanted to turn this into a full fledged feature
for a long time, but this is not the form I want it to take. Keep it
behind a switch for now." Built in "Atlas 23".

| # | Decision | What it means |
| --- | --- | --- |
| D180 | The count of repeated phrases is off until switched on (the owner) | `extensionSettings.hub.styleLaw`, off by default (`hubConfig`), with a row in Settings, Live World, The Hub: "Count repeated phrases when a scene ends". Off: End counts nothing and its sheet shows no list, nothing is held against a scene (not even phrases handed to `commitEnd`), and no scene's brief or openings are told of a list. A list made while it was on is left where it is, neither aged nor told; switched on again it is in force again. On: as D179. |

The form the owner wants for it is not this one and is not yet said. D179
stands as a working first form behind the switch; nothing more is built
on it until he says what it should be.

## 26. The scenes build, step 6: a scene's length, the nudge, and going straight on (2026-11-11, D181)

The owner, asked what came first of what was left: "yes start on 1" (the
message count, the nudge, and End and continue here). His reason for
scenes at all (§16): characters are strongest at the start of a chat and
flatten around message 100. Built in "Atlas 24".

| # | Decision | What it means |
| --- | --- | --- |
| D181 | The strip counts the scene, says when a fresh chat is worth it, and goes on in one click | **The length:** the strip above a scene's chat tells how long it has run ("Scene 3: The gate at dusk · Hask · Day 42 · 37 messages": the player's messages and the narrator's, system ones aside, `sceneLength`), kept up as replies come and go. **The nudge:** from the length the player set (`hub.nudgeAt`, sixty by default, 0 never; Settings, Live World, The Hub: "Suggest a fresh chat after this many messages") the strip says "a good place to go on in a fresh chat" and Continue fresh is lit. Nothing is done by itself. **Continue fresh** (the strip, any time; `continueScene`): the scene is ended and the next opened straight on from it in one go: the record is written, the scene remembered (the ledger read; **the world not moved**, since no time passes: D178's tick is for a scene that ends in the story, not for a change of chat), and the next scene is started at the place the story stands at now and with the people the tracker has there now (not where the scene began), right after, its openings asked for as going straight on with the words the last scene stopped on (`continuationSeed`: "no time has passed and nobody has moved. Open on that moment; do not repeat it and do not skip ahead. It stopped on: …"). The first opening is taken as it comes and the other two are its swipes, so nothing is asked of the player on the way. The strip says each step as it runs and nothing can be pressed meanwhile. It stops with nothing more changed when the record cannot be written or the world has moved past the scene (the End sheet opens: that is where either is settled), and when no opening comes back (the scene is ended; the strip says to start the next from the map). On a scene that has ended already it only opens the next. **End and continue here** is the same from the End sheet, for the player who wants to correct the record first: the sheet's second button, not offered for a scene the world has moved past. |

It costs what an End and a Start cost: the record (one request a page of
the scene, one to four), the ledger (one, when Canon is on), the openings
(one). A scene of sixty messages is about five.

Not done here: Travel here inside a scene stays in the same chat, as it
was; "End and start a scene here" on a place's card (end this scene and
open one elsewhere, with the journey's time) is not built: ending and then
starting from the map does it in two steps.

## 27. World gen: the land made first (2026-11-11, D182–D186)

The owner, while the scene's strip was being built: "I also want terrain
like mountains and lakes and oceans to be added to the map when
generating. Maybe we should have an initial 'World gen' step that makes a
world map, then the player can pick where their stuff is on that map?"
Asked four things, he answered: for a map that already has places, "both
as options" (the world made around what is placed, or made clean and
everything placed again); terrain affects travel, "yes it does"; for the
landmasses, "give a few generation options, Pangea, IRL (build kind of
how the real world is), Island, and Divide which would look like the WoW
classic map"; region names, "AI suggest, you change later if you want
(the current system)". Built in "Atlas 25" (the generator) and "Atlas 26"
(on the map).

Until now the map drew its land around the places as they were put down
(D151), and a region's terrain was read from its name (D168). A generated
world turns that round for the top map: the land is there first, and
what is put on it stands on it. It replaces the old item "terrain that
follows the story".

| # | Decision | What it means |
| --- | --- | --- |
| D182 | A world is made from a seed, in code, in a moment; the book keeps the seed, never the shapes | `src/utils/worldGen.js`, pure. `generateWorld({ seed, shape, w, h, cx, cy, anchors })` makes the geography on a grid of half-unit squares: land and sea in one of four shapes (**Pangea**: one great landmass; **Like our world**: several continents; **Islands**: an archipelago; **Divide**: two continents across a sea), then mountain ranges that wander inland, lakes (and any water the open sea does not reach), forests, and from the grid the outlines: the coast, the lakes' shores, the forests' edges, a tree for each stretch of forest, a peak along every range. No AI request: about a tenth of a second, and the same seed and choices give the same world on any machine, so "Roll again" is free. Three sizes (48 by 32, 64 by 44, 88 by 60 units: at a world's scale, D187, about 2,900 by 1,900, 3,850 by 2,650 and 5,300 by 3,600 miles); a world made around what is placed is widened to hold it (160 by 110 at the most). The book holds `world` (the spec, with the spots that had to be land: `anchors`); `normalizeBook` keeps it, every edit carries it, a scene's snapshot carries it with the rest of the map (D173). The last few worlds made are kept in memory, so drawing one again costs nothing |
| D183 | Regions are whoever stands on the land: each holds the land around its spot, and borders follow the mountains | The geography has no regions of its own. `divideWorld(world, sites)` gives every region on the top map the land it can walk to before another region does, spreading from its own spot, slower over mountains and lakes: so borders tend to run along the ranges (in the test world, 27% of the ground beside a border is mountain against 9% of all the land). A region moved, added or deleted moves the borders; the coast never moves. One region alone holds its whole landmass; an island no region stands on goes whole to the region nearest it across the water, or is nobody's when none is near (drawn as plain land). A region dropped a step off the shore takes the land beside it; one out at sea holds none. Two regions that share a border share its very points: the lands tile the land exactly. `suggestSites(world, n, taken)` says where n more regions would stand: shared between the landmasses by their size (an island gets its first region before a continent gets its third), far from one another and from the regions already there, each drawn to the middle of the land it would hold. On the top map this replaces `territoryCells` (D163, D166, D167), which still draws the lands of a map with no world and of a region that holds regions |
| D184 | The world is drawn on the top map and, the same, inside each region | The top map's ground is `world`: the sea is the map's own ground, the land lies on it with the shallows round its coast, the regions' lands over it in their colours (D167), then the forests, trees, lakes and peaks over those, and the coast's line last. What stands out at sea has a rock of its own under it. A fit shows the whole world. Inside a region of the world (D168) the land is the region's share of the world's, in the same shape, with the world's own terrain across it and the sea past its coast: the region's own map is the world's map, nearer. `landTerrain` (terrain read from the region's name) still draws a region of a map with no world. A peak or a tree that would stand on a marker is left out, so the marker can be read. A land's terrain (its colour's leaning, D167) is the one its name tells, else the one its own ground is |
| D185 | Terrain affects travel: forest slower, mountains much slower, water by boat | The owner: "yes it does". On a generated world a way across country is found over the ground itself (`travelField`): forest takes a quarter as long again, mountains two and a half times as long, and water is crossed by boat, twice as fast under way but with a day's travel lost to taking ship, so a boat is worth it for a sea and never for a pond: a lake is gone round. A road is as long as the ground under its line makes it (`roadCost`): through a forest it is a road, over mountains a pass (half as long again), over water a crossing with the same wait. A road with a set time still takes that time, whatever is under it (D165). The map draws no road of its own across the water: a crossing is the player's to draw. The card and Travel here say how the way goes: "83 miles cross-country, about 5 days on foot, over the mountains", "about 16 days on foot and by boat", "572 miles by sea, about 15 days"; the time a scene opens after a journey (D174) follows. Inside a region the same ground counts. A map with no world measures as it did |
| D186 | The world gen names nothing; new regions come under plain names and the AI is asked for names after | The owner: "AI suggest, you change later if you want (the current system)". A region the world gen adds stands under a plain name told from where it lies and what its ground is ("Northern Highlands", "The Heartland"), not canon (D160: a dashed border). "Name the lands" in the list is one request on the tracker's connection: each such land is told by where it lies, its ground and what it borders, with the lore, the card and the lands that have their names, and the reply's names are checked in a list (changed, left out) before any is used. A named land stays not canon until the player makes it so. A world made again replaces the regions nobody took up (not canon, nothing inside, still under a plain name); a region that was named, filled or made canon is the player's and stays |

**The panel** (Places, "Generate a world"; first on an empty map's start
panel): the shape, the size, the regions to add (none offered on a map
that has regions of its own), the seed with Roll again, and beside them
the world those choices make, drawn small with its regions. On a map
that has things on it, what becomes of them: **Build the world around
it** (each keeps its spot, land is made under it, each region holds the
land about it) or **Start clean** (they go back to the list to be put
down again; what is inside a region stays inside it). Nothing changes
until "Use this world"; one Undo puts the map back. "Remove the world"
takes it away again and the map draws its land around its places as
before. Placing is the tray's own (D145, D151): a region dragged onto
the land takes the land around where it lands; a place dropped on a
region's land goes inside that region (D166); Place all spreads the
regions over the land and keeps everything off the water.

**Set up this world and Fill out this map** (D159, D160) keep to it: a
set-up applied on a map with a world keeps the world under it and stands
its regions where the world would have them; a fill's regions come to
stand on the dry land nearest where they were laid out.

What it is not, yet: no rivers; no climate (no deserts, snow or swamps:
the land's kinds are plain, forest, mountain and lake); the names of
seas and ranges are nobody's; a way by road still runs straight between
its two places, whatever lies between; a region's own map is no finer than the world's (its coast and
its peaks are the world's, nearer, not drawn again in more detail).
Nothing here has run in a real SillyTavern: the generator, the model and
the request's prompt and reply are tested pure, the drawing and the
panel in a headless browser, the controller only by loading.

Where it is: the generator `src/utils/worldGen.js`; the book's `world`,
the lands, the terrain and the travel in `src/utils/atlas.js`
(`withWorld`, `atlasModel`'s `world`, `geo` and `decor`, `routeBetween`,
`roadAsDrawn`); the panel's choices, the plan, the apply and the names'
request in `src/utils/atlasWorld.js`; the request asked in
`atlasBook.js` (`draftNames`); the panel, its picture and the names'
sheet in `atlasViews.js` (`atlasWorldGenHtml`, `worldPreviewSvg`,
`atlasNamesHtml`); the drawing in `atlasMap.js`. Tests:
`tools/world-gen-test.mjs` (the generator), `tools/atlas-world-test.mjs`
(the panel's parts, a world made again, the names, a set-up and a fill
on a world), `tools/atlas-test.mjs` §6f (the model and the travel),
`tools/atlas-flow-test.mjs` §5 (the book saved, the request),
`tools/atlas-browser-test.mjs` §5j (the panel and the map in a browser).

### A generated world is a world's size (2026-11-11, D187)

Shown the first build, which read a generated map at a region's scale
(a medium world some 960 miles across), the owner: "when doing a world
generation I would assume the generation would be at world size?" He is
right, and it is so now.

| # | Decision | What it means |
| --- | --- | --- |
| D187 | A generated world's map reads at a world's scale; a region on it reads at the scale its map does | `scaleOf`: with a world under it the top map is "A world" (60 miles a unit: a medium world is about 3,850 by 2,650 miles, a land some 600 across) unless the player chose another scale for it, which still wins. A region that stands on a generated world reads at the top map's scale and not at a region's own (15 miles a unit), so a land is as wide inside as it is on the world's map and a journey across it takes the same time on either (D166's rule, kept). A scale chosen by hand for a region's own map still wins; a place inside a region is a town as before. Taking ship still costs a day's travel (D185): at a world's scale that is 24 miles' worth, small beside a sea and enough to keep a boat off a pond. A map with no world measures as it did |

## 28. End, step 1: where each person stands, and the open threads (2026-11-11, D188)

The owner, offered the rest of End or rivers and climates for the world
gen: "yes start on End step 1". Against his own chat-to-canon run (§16)
End lacked where each character stands now and the open threads: a
scene's record says what happened; these say how things stand because of
it. Built in "Atlas 28".

| # | Decision | What it means |
| --- | --- | --- |
| D188 | The request that writes a scene's record also says where each person stands and which threads it settled and opened; they are corrected on the End sheet, kept with the world and told to the next scene | **No request of its own.** `buildRecapPrompt` asks for `{"recap", "people": [{"name", "now"}], "threads": {"closed": [numbers], "opened": [texts]}}`: "now" is at most 280 characters on where the person is, what state they are in, how they stand with the player and the others and what they want, owe or have promised next; the request is given where the scene's people stood before it and the open threads, numbered, so a standing is carried forward and changed, not written from nothing, and a thread is settled by its number. A record written in passes carries both from pass to pass (the later pass is told how things stand so far; a thread the scene opened and settled leaves no trace). **Checked in code** (`readContinuity`): never the player; a name is one the world knows (in its own spelling) or one the scene's text has; a thread is not one already open; at most twelve people and eight new threads a scene. **The End sheet** shows each person the record spoke of with where they stood before, the threads opened and the ones settled: a line is corrected, a person or a thread crossed off (the person stays as they stood), a settled thread unticked (it stays open). What the sheet has is what is kept; an End with no sheet (the command, Continue fresh, the old Hub window) keeps what the record said, when it was written for that chat and that last reply. **Kept** in `extensionSettings.hub.worlds[id].continuity` (`{ people: [{ name, now, scene, at }], threads: [{ id, text, scene, at }] }`, sixty people and forty open threads at the most), made safe with the rest of the entry. Like the memory, a scene the world has moved past does not overwrite what a later scene left. **Told to the next scene:** its openings get "Where they stand now" for the people in it (as how the story left them, holding over older notes) and the open threads (to pick up or not); its brief, which the narrator has every reply, gets "Where they stand now" after "Who is here" and "Still open" (the six newest) after the record. The brief may now be 3,600 characters (it was 2,500); cut for room, the older records and the threads go before where the people stand. **Play as scenes** asks the same of the chat's last messages and its panel shows them, so a world starts with a continuity |

Pure: `src/utils/continuity.js` (the store, the draft a record is asked
with, the reply read, the change kept, what a scene is told),
`tools/continuity-test.mjs`; the record's request and the brief in
`src/utils/hub.js` (`tools/hub-test.mjs` §8e); End, Start, the handover
and Play as scenes in `src/systems/features/hub.js`
(`tools/hub-flow-test.mjs` §9, §16); the sheet's fields in `atlasViews.js`
(`continuityFieldsHtml`; `tools/atlas-browser-test.mjs` §5i).

What it is not, yet: it is not a lorebook (step 2, D170: until then it
is seen only on the End sheet and in what the next scene is told, and a
person's standing reaches a scene only when they are in its cast, not
when their name comes up); a standing is rewritten whole each time it is
told, so a fact the record drops is gone from it (the ledger and the
lorebook entry are where hard facts live); nothing can be added by hand
that the record did not say; contradictions are not put to the player
(step 3). Not run in a real SillyTavern: the request's reply is a
stand-in in every test.

## 29. End, step 2: the continuity book (2026-11-11, D189)

Asked two things before the book was built, the owner: a new book of
DES's own in the campaign, his hand-made Continuity book left untouched
beside it, "yes"; the open threads as "always-on entry"; "go". This is
D170 (the continuity is a real lorebook) done. Built in "Atlas 29".

| # | Decision | What it means |
| --- | --- | --- |
| D189 | A world's continuity is kept as a lorebook of its own, written at End, and what the player changes in it is how things stand | **The book:** "<campaign> - Scenes Continuity" (the world's name when it has no campaign; the next free name when a book of that name is not this world's), made by the first End (or Play as scenes) that has anything to keep and filed with the world's campaign, so it is switched on and off with the campaign's other books; a world with no campaign has it switched on by itself. **Its entries:** one a person, titled "<name>: as things stand now", keyed by the name, not always on, order 95 (after an entry on who the person is: the owner's are at 90), its text "<name>, as the story stands now: …"; and one titled "Open threads", always on, a line a thread. SillyTavern's own World Info then carries a person's standing into a reply when their name comes up and the threads into every reply. **The brief** of a scene leaves both out while the book is switched on (they would be said twice) and carries them itself when it is not; the openings' request, which sees no lorebook, is always told them, and the continuity book is not read as a person's own notes (D177). **The player's to edit.** DES remembers for each entry it wrote its id and a mark of the text it last saw there. Before the continuity is read (a Start, an End) the book is looked at: a text that is no longer the one DES saw was changed by hand and is taken as how things stand (kept whole, to 700 characters); an entry deleted or emptied lets that person's standing go, and no entry is made for them again until the story speaks of them; in the threads' entry a line deleted settles that thread and a line added opens one. DES writes only the text of entries it made: never their keys, order or switches, never an entry the player added. **Never over an edit unseen:** a standing the player wrote is replaced only by an End whose sheet they were shown (it has their text under "Before" and the new line to correct); an End with no sheet (the command, Continue fresh) leaves it as they wrote it and says so. The threads' entry, reworded by hand, is left as written until the story opens or settles a thread; then it is written again with every thread of theirs in it. **The owner's hand-made Continuity book is not touched**: not read differently, not switched off, not offered to be (the earlier plan to offer was dropped at his word). **When it goes wrong:** a book renamed in the Lore Library is followed; one deleted there, or simply gone, is forgotten and a new one written whole at the next End; a lorebook that cannot be reached or does not answer within twenty seconds does not stop End (the continuity is kept in the settings either way, and the sheet says the book was not written) |

Pure: `src/utils/continuityBook.js` (`readBook`: what the book says that
the continuity does not; `planBook`: what must be written; `trackWritten`),
`tools/continuity-book-test.mjs`. The file's reading and writing through
SillyTavern's World Info, the campaign's filing, and the hooks into Start,
End and Play as scenes: `src/systems/features/hub.js` (`syncFromBook`,
`mirrorBook`, `bookIsLive`; `tools/hub-flow-test.mjs` §17, with a shelf of
lorebooks in memory). The Lore Library tells the hub of a rename or a
delete (`campaignManager.js`). The End sheet's fifth step, "The book".

What it is not, yet: contradictions are not put to the player (step 3);
nothing but an End or a Play as scenes writes the book (a standing
corrected on the Atlas has no place yet: the book is where it is
corrected); a person's entry has their name alone as its key (an alias or
a title must be added to its keys by hand, and then stays); DES does not
look at whether the hand-made Continuity book says something else. Not
run in a real SillyTavern: every lorebook in the tests is a stand-in in
memory, so the one thing untested is SillyTavern's own World Info calls
(`createNewWorldInfo`, `createWorldInfoEntry`, `saveWorldInfo`) and the
campaign's switching of a book made while it is on.

## 30. End, step 3: what a scene contradicts, and one Undo of End (2026-11-11, D190)

Asked what a contradiction should be checked against and what the Undo
should put back, the owner: "also read my lorebook entries", "everything",
"go". The last of the three things End lacked against his own run (§16):
"contradictions put to the player instead of the later one winning
unseen". Built in "Atlas 30".

| # | Decision | What it means |
| --- | --- | --- |
| D190 | The record's request also says what the scene contradicts; the player sees it before the scene is ended; one Undo puts back everything End changed | **No request of its own.** The request that writes the record (D122, D188) is given what was established before the scene: the chat's ledger (Canon's block), the scene's people's own lorebook entries and the campaign's standing notes (read as the openings read them, D177: so the owner's hand-made Continuity book is among them, and DES's own continuity book is not, being told by itself as where people stood); and returns `"conflicts": [{ scene, established, source }]`: only where the scene plainly contradicts something established (two things that cannot both be true), not a change the scene itself brings about, not something the notes do not speak of; six at the most, none being the usual case. A record written in passes finds them a page at a time. The request is larger for it: up to some sixteen thousand characters of lore beside the scene's text. **Seen before it is kept.** The End sheet lists them, with what each was checked against, between where people stand and what ending does: what was played stands unless the player changes it (Keep playing and put it right in the chat; correct the record or a standing on the sheet; or, the story having moved on, change the lorebook entry or the ledger to match). Continue fresh has no sheet, so when its record finds one it stops, with nothing ended, and says so on the strip; End scene then shows that same record (nothing is asked again). The command `/endscene` ends the scene and says how many it found. **Kept with the scene** (`scene.conflicts`, for the last twenty scenes), so the list is still there after End. **One Undo.** `undoEnd()` puts back all an End changed: the scene is open again with its mark as it was; the world's entry is as it was before the End (the record, the memory with the world as it stood before it moved, where people stand, the threads, the style law); the chat's ledger is as it was before Canon read the scene (so ending again reads it afresh); in the continuity book the texts End replaced are put back and the entries it made are taken out (a book that End itself made stays, empty of what End wrote, and is still the world's own). The chat's messages were never touched by End and are not touched. Offered on the End sheet once the scene is ended and at the foot of the Atlas's sidebar, from that scene's chat, until the next scene starts, another End runs or the page is loaded again (what End changed is held in memory, not stored). A scene put right and ended again keeps the new End's list |

Pure: `normalizeConflicts`, `readConflicts`, `mergeConflicts` and the
request in `src/utils/hub.js` (`tools/hub-test.mjs` §8f). The check's
gathering (`establishedFor`), the record held for the sheet, what End
changed remembered and `canUndoEnd` / `undoEnd`:
`src/systems/features/hub.js` (`tools/hub-flow-test.mjs` §18). The list
and the Undo on the sheet and the sidebar: `atlasViews.js`
(`conflictsHtml`), `atlas.js`; `tools/atlas-browser-test.mjs` §5i. The
End sheet's buttons now stay in view at its foot when the sheet is long.

What it is not: the finding is the model's, so it will miss some and
raise some that are not (the sheet says what was played stands; nothing
is changed for a contradiction by itself); a contradiction has no "this
is right, change the lorebook for me" button (the lorebook entry and the
ledger are changed by hand); the Undo does not survive a reload, and is
not offered once the next scene has started (so not after Continue
fresh, which is why that stops on a contradiction instead); a map edited
between an End and its Undo keeps the edit only in the world's memory
that the Undo replaces. Not run in a real SillyTavern.

With this the three things End lacked against the owner's run are in
(D188, D189, D190). Still open from the list: retiring the old Hub and
Map windows (the scenes list, starting from a person, a rumour, news or
a hook, and the world picker have to move into the Atlas first); hooks
and the hand-drawn place picture waiting for the player's own message;
rivers and climates for the world gen; the form the phrase count should
take (the owner's to say).
