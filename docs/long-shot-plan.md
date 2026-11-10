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
