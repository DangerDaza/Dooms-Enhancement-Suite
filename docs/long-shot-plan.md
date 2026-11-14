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

## 31. Hooks and a place's picture wait for the player's own message (2026-11-11, D191)

The owner, with the three End steps in: "carry on with all waiting
items". The first of them was the gap §16 named and left: a request asked
for by a button ran on the tracker's connection profile whatever the chat
was doing. Built in "Atlas 31".

| # | Decision | What it means |
| --- | --- | --- |
| D191 | Offer hooks and Draw a place wait until the line is free | `waitForIdleLine()` in `apiClient.js` (one helper, with a test hook for its timing): no reply to the player's own message is being written and no other background request holds the flag; it gives up after two minutes. `proposeHooks` and `drawPlace` wait on it before their request: asked for while a reply is being written, the request goes once the reply is done; when the wait runs out nothing is sent and the button's line says "A reply is still being written. Try again when it is done." The Atlas's own requests (D159, D160, D186) and the scene engine's have waited this way since "Atlas 14"; these two were the last that did not |

Tests: `tools/map-flow-test.mjs` §8.

## 32. World gen: rivers and climates (2026-11-11, D192)

The second waiting item: the world gen made land, sea, mountains, lakes
and forests, and nothing else. A world now also has rivers, and three
climates' ground: desert, snow and marsh. Built in "Atlas 32".

| # | Decision | What it means |
| --- | --- | --- |
| D192 | A generated world has rivers and climates, and both count | **Rivers.** Every square of land knows the next square on its way down to water (found from the sea and the lakes outward, low ground cheapest, the ranges dearest, a fine grain so the way winds). A river starts on the high ground farthest from any water, well apart from the next (none on an islet, then about one to every 110 square units of a landmass, up to twelve), follows that way down and ends in the sea, a lake, or another river, which is then drawn the wider. **Climates.** How warm the ground is goes by how far north it lies (in "Like our world", by how far from the middle: cold at the top and the bottom), how damp by the noise the forests already used. Open ground that is cold is snow; damp ground beside the sea, a lake or a river may be marsh; damp ground is forest as before; hot, dry ground off the shore with no river through it is desert. A patch too small to be told is let go. A peak in the cold wears snow. **What they change.** Travel: desert 1.3 times as long as open ground, snow 1.6, marsh 1.8 (mountains stay 2.5); a road is as quick over desert as anywhere and a quarter slower over snow and marsh; a river in the way is waded, for about an eighth of the wait to take ship (roughly an hour), and a road bridges it for nothing. A way that is mostly over one of them says so: "across the desert", "through the snow", "through the marshes" (the mountains still come first). Borders: a river is a line a region's land tends to stop at, as a range is (in the test world 9% of the ground beside a border is a river's against 4% of all the land). Regions: a land that is mostly snow, desert or marsh is told so in its summary (what the AI names it from), takes that terrain's shade, and gets a plain name to match ("Northern Snows", "Southwestern Sands", "Eastern Fens"); a land with a river through it says so. A land under a plain name takes its terrain from its ground, not from the word "Northern" in it. **Drawn** on the top map, inside a region and in World gen's picture: the ground of each climate as a tint under the forests, dunes on the desert, reeds in the marsh, the rivers as lines under the lakes |

A world made before this is the same world with these added: its coasts,
ranges, lakes and forests are where they were (some forest in the cold
is now snow, some by the water marsh), since the spec in the book is
only the seed and the shape. Its regions' borders shift a little where a
river now runs, and its journeys take longer where they cross the new
ground.

What it is not: there are no rivers out of a lake (a lake is where a
river ends), no rain shadow behind a range, and no climate chosen by the
player (a world cannot be asked to be all desert); a river does not
carry a boat (the boat is still for the sea and the lakes); a road is
not drawn along a valley or to a ford, it still runs straight; and a
world about another middle (made around places already on the map) has
its lake shores, and so some rivers, a little different from the same
seed about the middle of the map, as it always had its trees.

Tests: `tools/world-gen-test.mjs` (§2 climates and rivers, §4 the lands
told and named, borders along rivers, §5 the paces, the ford and the
bridge), `tools/atlas-test.mjs` §6f (what is drawn, the wording of a way
and of a road), `tools/atlas-world-test.mjs` §3 (a plain name's terrain),
`tools/atlas-browser-test.mjs` §5j (the panel's picture and the map).

## 33. The scenes of a world, in the Atlas (2026-11-11, D193, D194)

The third waiting item is retiring the old Hub and Map windows. Before
they can go, what only they had has to be in the Atlas: the list of a
world's scenes, the ways into a scene other than a place's card, hooks
played as scenes, and choosing which world to look at. Built in
"Atlas 33". The windows themselves go in the step after (§34).

| # | Decision | What it means |
| --- | --- | --- |
| D193 | The Atlas lists a world's scenes and starts one from anything | **A sixth tab, Scenes,** for a world that is played as scenes (the scene in front's world, the world of a chat the scenes began from, or a world picked, D194): the scene being played first, then those set aside, then the ended ones newest first, each with its place, its people, its dates, its record, and what its record found against canon (D190). Go to it or Resume opens its chat; End scene opens its chat if it is not in front and then the End sheet; Set aside leaves it for later; Go on from here opens the start sheet at the same place with the same people and the scene's record as what came before; a scene whose chat is gone can be removed. At the top, Start scene N, or the reason one cannot be started. **The start sheet** (D174) is one sheet for every way in: from a place's card it is as it was; from anywhere else it has a Where (any place on any map, "where the story left off", or somewhere new typed in), and says what it comes from. Choosing a place ticks who was last seen there and, when the party and the place are on the map in front, takes the time from the journey. **Ways in:** every line of News and of Rumours is pressed to start a scene with that line as what brings the party (a rumour opens at the place its clock stands at); a face's card has "Start scene N with them", opening where they were last seen; the Scenes tab's own button starts from nothing. They show only while a scene can be started. **Hooks between scenes** are the world's own round, kept in its memory: Offer hooks asks over the memory, Play as a scene opens the sheet with the hook (the scene takes it as its quest), Not this one sets it aside. While a scene of the world is being played its chat holds the live round, so the memory's is only read. In a chat (a scene being played, a long chat) hooks are taken and cut to as before |
| D194 | The Atlas can show any of the player's worlds, whatever chat is open | **A world picker** under the world's name, when scenes are on and the player has worlds of their own: "This chat", then every such world by name (one with no narrator card says so). A picked world is drawn from its memory, as between scenes: its map, where people stand, its news, rumours, hooks and scenes; a scene of it is started from there and its chat opens on the world's card. A world no scene has ended in is drawn from its pack's beginning. Its map can be made and changed from there (World gen, placing, roads): the first change begins the world's memory with the map in it, as a round of hooks begins one, and the first scene carries that map. While a scene of the world is being played elsewhere the map is that scene's to change, and the Atlas says so with the way to it. What needs a chat to read (set-up, fill, clean-up and naming by the AI, Travel, Advance now) waits for a scene, as between scenes. The pick lasts while the Atlas is open; it opens on the chat in front again. The Atlas can be opened on a world by name (`openAtlas({ worldId })`), which the World Builder and Settings will use when the old windows go |

In the scene engine: `startPlanFor(worldId)` (whether a scene of a world
can be started, whatever chat is in front), `worldSource(worldId, pack)`
(a picked world as the Atlas reads it; a copy, nothing written), and
`setWorldBook(worldId, book, { pack })` (a world with no memory begins
one, `takenAt` 0, to hold its map).

What it is not: the list does not page (a world keeps its last scenes as
it always did); a scene's record is not edited from the list; a line of
news started from is not marked as played; a picked world's people show
no "here now" (there is no scene in front to say who is present); and
the old windows are still there until §34.

Tests: `tools/hub-flow-test.mjs` §19 (a world picked: shown, its map
begun, its first scene started with it), `tools/atlas-browser-test.mjs`
§5k (the Scenes tab, the ways in, hooks between scenes, the picker, the
start sheet from each way in). The controller's own lines (which act
calls which function) are load-checked only, as before.

## 34. The old Hub and Map windows are retired (2026-11-11, D195)

With the scenes list, the ways in and the world picker in the Atlas
(§33), nothing was left that only the old windows could do except
drawing a place's picture, which the owner had said to keep. That moved
to the place's card, and the two windows went. Built in "Atlas 34".

| # | Decision | What it means |
| --- | --- | --- |
| D195 | One window for the world: the Atlas | **Draw** is on a place's card in the Atlas, for a place the story has been to in the chat in front (or a room of it): Draw, or Redraw once it has a picture, through Settings → Image Generation as before; the card shows the picture. Not between scenes, where there is no chat to describe the place from. **Every way in opens the Atlas:** the D menu has Atlas and End scene (Map and Hub are gone from it); `/liveworld` opens the Atlas (as `/atlas` does), `/hub` opens it on the Scenes tab; Settings → Live World's "Open the Atlas", and under The Hub "Open its scenes" and "Start a scene", which open the Atlas on the world chosen there whatever chat is in front (`openAtlas({ worldId, tab, start })`); the World Builder's "Play in the Atlas"; a face's "Show the place" where no Atlas is open. **Gone:** `src/systems/ui/hub.js`, `hubViews.js` and `worldDashboard.js`; the Map window's own markup in `worldViews.js` (its row of circles, its strip, its frame; the People, News, Rumours, Hooks and Completed quests bodies stay, as the Atlas's tabs); the tree board's model (`treeModel`), which only a world with no picture in the Hub window drew; the setting "the hub closes when a scene opens" (the Atlas always makes way for the scene it starts); the two windows' own tests; and their styles: 302 selectors (199 whole rules) in `style.css` and `styles/overhaul.css` that could only match their markup, found by class and id names no code mentions any more |

What stays, and why: `hubBoard.js` (the picture board) is the World
Builder's Map tab's, in its edit mode; its read-only mode has no window
now and is kept with the board's own tests. The pure helpers in
`worldPicture.js` that the board's model is built from stay with it.
`docs/hub-plan.md` and `docs/map-window-plan.md` are kept as the record
of how the scene engine and Live World's panels were designed, each
with a line at its top saying its window is gone. Comments in the code
that tell where a rule came from ("the Map window's row") were left
where they explain the rule.

How the styles were checked: the Atlas's People, News, Rumours and Hooks
tabs, which borrow the Map window's classes, were pictured before and
after the rules went and compared pixel for pixel: no difference. The
Atlas's browser suite and the board's browser test pass as before.

What a player with the old habits will notice: Map and Hub are no longer
in the D menu (an entry hidden there by name is simply no longer
listed); the Map window's row of place pictures is not anywhere as a
row, each picture is on its place's card; a world with a picture of its
own shows that picture as the Atlas's top map, as it has since D154.

Tests: `tools/live-world-flow-test.mjs` §6 and §10 (the tabs' bodies
read as the Atlas shows them; Draw on a place's card), `tools/hub-test.mjs`
§1, `tools/hub-board-test.mjs`, `tools/hub-board-browser-test.mjs`,
`tools/lazy-graph-test.mjs`. Not run in a real SillyTavern.

## 35. The Atlas on a phone, and nothing showing through it (2026-11-11, D196)

The owner, with a screenshot from a phone: "The end scene menu and the
atlas are very broken on mobile." The picture showed the chat plainly
readable through the Atlas, the Atlas only about half the screen tall,
and the sidebar's foot lying over the tab's list. The Atlas had one
check at a phone's width and had never been on a phone. Built in
"Atlas 35".

Three faults, each reproduced before it was fixed:

| Fault | Cause | Fix |
| --- | --- | --- |
| The chat shows through the Atlas | Every surface was painted with the look's panel and ground colours, which are see-through by design (Lumen's glass) or whenever the theme's own tint is (SillyTavern's blur tint usually is). On a wide screen with a nearly opaque theme it passed for solid | Every surface paints the look's colour over a solid one: the theme's own tint made opaque (`rgb(from … / 1)`, where the browser has it), else a dark fallback. The window, the sidebar, the map's tools, a place's card, the sheets and their bar of buttons, the hint and the trail. What is written on the accent (a primary button, "You are here") is made solid the same way: it was mixed from the same tint and could not be read |
| The window is not the screen | `position: fixed; inset: 0` is the screen only while nothing above the window has taken the screen's place. In SillyTavern's phone layout something has (the Workshop met this in 3.1 and names the viewport; the old Hub window copied that rule and the Atlas never had it) | The window is sized by name, `100vw` by `100dvh`. The controller also measures it when it opens and on a resize, and places and sizes it by hand if it still does not cover the screen (`fitToScreen`) |
| The map draws over the sidebar; a sheet's buttons collide with its text | On a phone the sidebar lay over the map as an 88%-wide sheet, but the map's markers, tools and compass are stacked above it (the stage made no layer of its own), and the sticky bar of buttons on a sheet was see-through | The stage is a layer of its own (`isolation: isolate`). On a phone the sidebar and the map take turns at the whole screen (D196, below) |

| # | Decision | What it means |
| --- | --- | --- |
| D196 | On a phone the sidebar and the map take turns at the whole screen | Under 720 px the sidebar is the full screen, not a sheet with a strip of map beside it. Its head has two buttons of its own, **Map** (the sidebar put away) and **Close**, since the map's tools are under it; the map's first tool brings the sidebar back. A sheet (End scene, Start a scene, World gen, a set-up, the names) is the whole screen and the sidebar makes way for it (a class the controller sets, and `:has()` where the browser has it). Showing a place, Place all and anything that waits for a tap on the map put the sidebar away; with it away, what an action answered is said over the map, since the foot that says it is out of sight. Buttons in the foot and on a sheet are a finger tall and share the width. The map's tools never run off the screen: a size smaller under 380 px, and they wrap as a last resort |

What it is not: tested on a phone. It was reproduced and checked in
Chromium at a phone's size with a see-through theme, a look, a page
behind the window, and the window's holder cut to half the screen; no
real device and no real SillyTavern has run it. A notch or a home bar is
not allowed for (no safe-area padding). The marker cards, the roads tool
and dragging a place from the list are as they were, and on a touch
screen the drag from the list is still tap, then tap the map.

Tests: `tools/atlas-browser-test.mjs` §7 (a phone's sidebar is the whole
screen) and §8 (new: solid under three looks with a see-through theme;
the phone's sidebar, tools at three widths, a place's card, the End
sheet scrolled to its end, Start a scene, World gen; the window held by
something half the screen tall; a wide screen unchanged). Every one of
§8's checks but the last fails on the styles before this.

## 36. A scene deleted (2026-11-11, D197)

The owner: "What does set aside do for scenes and we need a delete scene
button." Until now a scene left the list one way only: its chat deleted
in SillyTavern's own chat list, then Remove on the record that was left.
Asked what Delete should do, the owner chose: the chat goes with the
scene, and an ended scene is not deleted. Built in "Atlas 36".

What Set aside does (it has since the Hub, D123; said here because it
was asked): the scene stops being the world's open scene and nothing
else. Nothing of it is remembered: no record, the ledger not read, the
world not moved, the memory not written. Its chat stays as it is. The
world is then free for another scene (one scene of a world is open at a
time; starting a new one sets an open one aside by itself). Later,
Resume makes it the open scene again and opens its chat, and End scene
opens its chat and ends it. If other scenes have ended in between, its
End keeps its record but leaves the world's newer memory alone unless
the sheet is told to replace it (D123).

| # | Decision | What it means |
| --- | --- | --- |
| D197 | Delete is for a scene that never ended, and takes its chat with it | **Which scenes.** One that is open or set aside and was never ended (`canDeleteScene`). An ended scene stays: the world remembers it, its record is told to the scenes after it, and taking it out would leave the world remembering something with no record. So does one that was ended and reopened. A scene whose chat is gone keeps Remove. **Where.** A Delete button on the scene's row in the Scenes tab; pressed, the row asks ("Delete scene 4 and its chat? … This cannot be undone") with Delete scene 4 and Keep it. **What goes.** The record, and the chat file, through SillyTavern's own server route (`/api/chats/delete`, by the file's name and the card's avatar), then SillyTavern and its extensions are told the chat is gone (`CHAT_DELETED`). The record goes only once the file has: a chat SillyTavern would not delete keeps its scene, and the Atlas says so. **The chat in front.** When the scene deleted is the chat in front, another chat is opened first, so nothing is left saving into a file that is gone: the world's latest other scene's chat, else any other chat of the card, else a new chat on the card (as SillyTavern does when a card's only chat is deleted). The Atlas stays on the world. **The card.** When the card only points at the deleted chat (it was the last one opened on it), the card is pointed at another and SillyTavern is told (`/api/characters/merge-attributes`), or it would make an empty chat of the old name the next time the card is opened. **The number.** When it was the last scene started, its number is free for the next: delete scene 5, and the next scene is scene 5 |

What stays, because a scene that never ended wrote nothing to put back:
the world as it stands; what the world moved by for the time before the
scene began; a hook the scene was started from (it stays played); and
the map as it was edited while the scene was the open one, since map
edits are the world's as they are made (D173).

What it is not: there is no undo, and the chat is not kept anywhere; an
ended scene has no delete at all (the owner's choice over deleting its
record alone, or rolling the world back for the latest one); a scene is
not deleted from the strip above its chat or by a command, only from the
Scenes tab; and the calls to SillyTavern's server were read from its
source (`src/endpoints/chats.js`, `characters.js`) and run against a
stand-in, not a real SillyTavern.

Tests: `tools/hub-test.mjs` §8a (which scenes, what the record's going
changes, the number, the Atlas's line), `tools/hub-flow-test.mjs` §20
(the real module: the card pointing at the chat, the scene in front with
and without other chats, an ended scene, SillyTavern refusing, a chat
already gone), `tools/atlas-browser-test.mjs` §5k (the button and the
question on the row).

## 37. A long chat read whole (2026-11-11, D198)

The owner pressed Play as scenes on a chat of 216 messages and the
record covered the last forty: D172's one request reads no further
back. The record of the chat so far, where its people stand, what it has
left open and (with Canon on) the ledger are what the scenes are told,
so a chat taken that way begins its scenes knowing a fifth of itself.
The owner then asked for a bar for each request, what happens when one
fails, and that the requests not go out together (they play through a
reverse proxy that answers "too many requests").

| # | Decision | What it means |
| --- | --- | --- |
| D198 | A chat longer than one request reads is read whole, one request at a time, a bar a request | **How much is read** is asked on the panel when the chat is more than one request holds (more than a page of text, or more than forty messages): **the whole chat a part at a time** (the choice made already; the panel says the messages and the requests before anything is sent), **the whole chat in one request** (with about how many tokens that is, for a model that reads that much; one that cannot fails the one request and nothing is lost), or **only its last stretch** (D172's one request, as before). A chat one request holds is not asked. **The whole read** is the way End writes a long scene's record (§5.2): pages of the chat's text, oldest first, each request told the record so far, where the people stand and what is open, the last one told it is the last. A page is 24,000 characters as at End; a long message is cut at 2,400 characters, not End's 1,200, because this read happens once and is kept. At most sixty pages are read; a longer chat is read from sixty pages back and the panel says so. The record may run to 1,200 characters. **One at a time.** A request is sent only when the one before it has come back: each needs the last one's record, so two are never out together. **A bar a request** (`atlasPassesHtml`): done full, the one in hand moving (a request does not say how far along it is, so the bar claims no share), the ones to come empty, with the request's number and its state in words. The list scrolls inside the panel when it is long. End's sheet has the same bars for a long scene's record, and a bar beside each of its parts while End runs. **A request that fails** is tried once more by itself after a wait: a few seconds, or thirty when the failure says the connection is held back (429, "too many requests", "rate limit", "overloaded"), and its bar says it is being tried again. If it fails again **the read waits at that request with everything before it kept**, the bar marked failed and the failure said; the panel offers Try it again (that request only, then the rest), Skip this part (the read goes on without that page, and the review says a part was skipped) and Start over. **Stop** lets the request in hand finish and waits the same way, to Carry on from. A read left waiting is offered again when the panel is opened on the same chat. **The ledger.** With Canon on, the review offers "Read the whole chat into the ledger first", ticked when the whole chat was read: Canon's own run (`updateCanon` with `scope: 'scene'` and the page's `text`), handed each page in turn before the chat is taken, so the memory holds it. Canon by itself read the last messages every few replies as the chat was played, and reads one page at a scene's end. Its read has the same bars, wait, Try again, Skip and Stop, and one thing more when it stops: Play as scenes without the rest, which takes the chat with the ledger as far as it got. Read in one request, it may add 48 lines, not a page's 16. With Canon off the review says there is no ledger to read into. |

What it does not do. The ledger holds what Canon's limits let it (40 a
kind, 160 in all): a long chat's read ends with the newest of what it
found when that overflows. The record is still a few lines, at most
1,500 characters, whatever the chat's length; the whole read makes it a
record of the whole story, not a longer one. The ledger's read changes
the chat's ledger before the copy of the chat is saved, so the copy
holds the ledger as read; the messages in it are as they were. The wait
between requests is not a setting: requests go as fast as they come
back, and a limit on requests a minute is met by the wait before a
second try and by Try it again. A read left waiting is forgotten when
the page is reloaded. The token count is the characters over four, to
the next thousand. Nothing here has run against a real SillyTavern or a
real provider: the requests in the tests are stand-ins.

Tests: `tools/hub-flow-test.mjs` §21 (the real module: how much there
is to read, the pages in order with the record carried, one request out
at a time, a second try, the longer wait on "too many requests", Stop
during it, a request that fails twice, Try again, Skip, Stop and Carry
on, Start over, the one-request read and one too big for the model, the
ledger's read page by page, its failure and skip, Canon off, the memory
holding it, the sixty-page limit) and §9 (End says which request it is
on); `tools/atlas-browser-test.mjs` §5g (the choice, a bar a request
and each state, trying again, failed, stopped, the review's lines and
the ledger's tick, the ledger's own bars, sixty requests in a list that
scrolls, a phone) and §5i (End's bars).

## 38. Reading across a cut (2026-11-11, D199)

The owner, of D198's eleven requests: what stops the first from ending
in the middle of a scene, and the second from picking up there with no
knowledge of what came before? The cut was always between two messages,
and the second request was told the record so far, where the people
stood and what was open. It was not shown the messages before the cut.
A page that ends mid-conversation left the next request opening on a
line whose "she" and "it" it had only a summary of. End's record of a
long scene (§5.2) had the same seam.

| # | Decision | What it means |
| --- | --- | --- |
| D199 | A part is read with the lines that lead into it | **The lead.** Every part after the first carries the last lines of the part before it: at most six lines and 2,400 characters, always at least one (`sceneTranscriptParts`, `LEAD_LINES`, `LEAD_CHARS`). The record's request is handed them under their own heading, "The lines just before this part, already in the record so far (to read on from, not to record again)", ahead of its own part (`buildRecapPrompt`'s `lead`). The ledger's request is handed them the same way, marked as read already. **The player's message stays with its reply.** When a page is full and its last line is the player's, that line goes over to the next page with the reply to it, so no part ends on a question the next one opens by answering. **Where.** The whole read of Play as scenes (the record and the ledger, D198) and End's record of a scene longer than one page. A part whose predecessor was skipped is handed no lead: those lines are not in the record to read on from. The one-request read has no cuts. |

What it does not do. Cuts are still made by length, not by where a
scene in the story begins or ends: the chat does not say where that is
in a way that can be trusted, so the seam is read across, not moved. A
request costs up to 2,400 characters more than its page. The lead is
the text only: a request is not told again what the earlier requests
decided beyond the record, the people and the threads it already had.
Whether a model keeps to "not to record again" is the model's; the
tests are stand-ins.

Tests: `tools/hub-test.mjs` §9 (every line once and in order, no cut
between the player's message and its reply, the lead's size and its
least, the oldest parts not read, the request's wording),
`tools/hub-flow-test.mjs` §21 (the record's and the ledger's requests
carry the lead, none after a skipped part) and §16 (End's later pass).

## 39. Nothing above the chat: a scene's options in the Doom button (2026-11-12, D200)

The owner, of the strip above a scene's chat (D121, D176, D181) on a
phone: "I don't want anything on the screen that's not the input box
and the story and the D button." There it wrapped onto four lines of
text and two rows of buttons, a quarter of the screen, and the Doom
button sat over its Atlas button. Asked where its options should go,
the owner chose the Doom button, as a list of its own: the button's
fly-out was already long and one more entry would run it off the screen.

| # | Decision | What it means |
| --- | --- | --- |
| D200 | The strip is off; a scene's options are one entry in the Doom button's fly-out | **Nothing above the chat.** The strip is not mounted unless Settings → Live World → The Hub → "Show a bar above a scene's chat" is on (`hub.strip`, off). One case apart: where the Doom button's fly-out cannot be reached (the button hidden, or set to open Settings directly) and the switch was never touched, the strip shows, because it is then the only place for a scene's options. The player's own choice stands over that. **One entry, "Scene N"**, there only while the chat in front is a scene. It took the place of End scene (D127), so the fly-out is no longer than it was, and one shorter in a chat that is no scene. **Pressed, the fly-out becomes the scene's own list** (`sceneMenuModel`, `fabMenu.js`): which scene it is with its place, date and length; Continue fresh; End scene N (Reopen scene N once it has ended); and Back. Atlas stays an entry of the fly-out. **What the strip said without being asked.** A scene that has run long (D181) puts a dot on the Doom button and lights the Scene entry and Continue fresh; the list says a fresh chat is due. A handover's steps are said in a notice that changes with each step and goes when it is done, and the list says the same and lets nothing be pressed meanwhile; why one stopped is a notice and stays in the list until the chat changes. With the strip on, all of that is on the strip as before. **The fly-out stays on the screen.** It opens to the side of the button with more room, by its real height, and when it is taller than that room it scrolls inside it, the end nearest the button in view. |

What it does not do. The scene's name, place and date are no longer in
view while playing: they are two taps away, and the tracker's own block
carries the place and date. The Present Characters bar, the tracker's
block in a message and SillyTavern's own buttons are not this strip and
were not touched. The fly-out's width is not managed: a button kept at
the right edge of the screen opens its list as it did. `end-scene` in a
stored list of hidden fly-out entries now names nothing. The fly-out's
code moved from `index.js` to `src/systems/ui/fabMenu.js` and is drawn
without jQuery; `index.js` itself is not run by any test, so the wiring
of the entries there is read, not exercised.

Tests: `tools/hub-test.mjs` §1 (the switch, and the case with no menu)
and the scene's entry (open, long, a handover running, ended, why one
stopped); `tools/hub-flow-test.mjs` §3 and §9 (the real module: a scene,
an ended one, a chat that is no scene); `tools/atlas-browser-test.mjs`
§9 (a phone: the list from the top of the screen and from the bottom,
the scene's list and Back, an option pressed, the dot, a handover, a
short screen that scrolls, a press outside).

## 40. The knock: three taps on the screen (2026-11-12, D201)

The owner, with the strip gone (D200): could three taps on the screen
make the Doom button go away, and three more bring it back? And then:
"Maybe we should bypass the button entirely and just add a knock mode
that you do three taps on the screen anywhere and it opens the D button
menu on the left side of the phone screen. Let's make that an option."
The owner plays on a phone with SillyTavern's top bar hidden and wants
the screen to hold the story and the message box and nothing else.

| # | Decision | What it means |
| --- | --- | --- |
| D201 | Three quick taps on the screen are a knock, and what it does is chosen | **The setting.** Settings → Doom Button → "Triple-tap the screen" (`fab.knock`): **Does nothing** (as shipped), **Hides or shows the button**, or **Opens the menu, no button**. **A knock** is three taps (`src/utils/knock.js`): each a press shorter than 350 ms that moved less than 12 px, no more than 450 ms after the one before, within 48 px of the first. A tap on a button, a link, a text box or anything else that is pressed is not counted and starts the count again, nor is one inside the Atlas, a dialog or a drawer; nor is a scroll; nor three clicks of a mouse that selected a paragraph. After a knock the count starts from nothing. **Hides or shows the button.** The Doom button fades off the screen and takes no press; three more bring it back. This is not the stored "Show the Doom button" switch (D58): nothing else changes with it, SillyTavern's top bar stays as it was, and a reload shows the button again. Put away with its fly-out open, the fly-out closes. The first time ever, a notice says how it comes back. **Opens the menu, no button.** The button is never drawn. Three taps anywhere open its fly-out (D200) at the left edge of the screen, in the middle of the screen's height, wherever the button had been left; it scrolls when the screen is shorter than it. An entry pressed, a press outside it, or three more taps close it. The fly-out's box stays on the page for this even where "Show the Doom button" is off (`fabBoxHidden`), and the top bar may stay hidden: the knock reaches the fly-out that stands in for it. **A way in whatever the screen shows.** `/des` in the message box opens Doom's Settings as it always has, and `/des reset` turns the knock off with the rest. The button is taken off the screen by the code that listens for the knock and by nothing else, so where that code did not start the button is there. |

Two things a phone does that the fly-out now allows for. The mouse
events and the click a touch screen sends for a tap arrive after the
finger is up, that is, after the third tap has already opened the list,
and a phone may hold the click back a third of a second or more while
it waits to see whether a double tap is coming. The owner's first try
of the menu mode opened Persona Management: the third tap opened the
list and its own click, held back, pressed the entry that had come up
under the finger. The first guard was 350 ms of taking no press, which
that click outlasted. Now, for 400 ms after a knock opens it the list
is not there to be hit at all (a click in that time falls on the page
under it, as it would have), and for a full second a click within 48 px
of where the knock landed is not a press of an entry nor a press outside.
An entry anywhere else is pressed as soon as the list is up. And three
taps while the list is open close it: the first, outside the list,
closes it as any press outside does, and the third does not open it
again.

What it does not do. There is no way to choose where on the screen the
list stands, nor how many taps or how fast. On a desktop it is three
clicks, which most people will not want switched on. A scene that has
run long shows no dot where there is no button: the Scene entry is lit
in the list. Taps inside the Atlas, a dialog or one of SillyTavern's
drawers are not counted: a map is tapped quickly for its own reasons.
None of it has
been tried on a real phone: the taps in the tests are events made by
the test, in the order Chrome on Android is documented to send them.

Tests: `tools/knock-test.mjs` (what a tap is, what a knock is),
`tools/fab-guard-test.mjs` (the three choices, the box, the top bar,
the rescue), `tools/hub-test.mjs` (the bar above a scene stays off where
the knock reaches the menu), `tools/atlas-browser-test.mjs` §9 (put away
and brought back, what is not a knock, a mouse, the fly-out closing with
the button; no button: the list at the left edge, the tap that opened
it, a click held back 330, 420 and 700 ms (the owner's report, which
the first guard fails), an entry elsewhere pressed at once, the scene's
list there, three taps to close, a short screen, the choice taken
back).

## 41. A scene opened: its file looked for, its card the one in front (2026-11-12, D202)

The owner, after updating and reloading: opening a scene gave a chat
with nothing in it ("are scenes not saving?"), and a reload should come
back to the scene that was being played, as it does for an ordinary
chat. The cause of the empty chat was not found by reading; running a
real SillyTavern here to reproduce it was not permitted in this
session. What was read is SillyTavern 1.19.0's own source, and it gives
two things the Hub did not allow for.

| # | Decision | What it means |
| --- | --- | --- |
| D202 | A scene's file is looked for before it is opened, and its card is recorded as the one in front | **Looked for first.** SillyTavern asked to open a chat that is not on the disk does not refuse: its reader returns nothing, it shows an empty chat, and it saves an empty file under that name ("make sure the chat appears on the server", `getChatResult`). From the Scenes list that reads as a scene that lost its messages. So `openSceneChat` asks SillyTavern's own list of the card's chats first; a scene whose file is not in it is marked gone and not opened, and the Atlas says "That scene's chat file is not there any more, so it was not opened". A list that cannot be had is no answer, and the chat is opened as before. **Said when it is empty.** A chat that is there and comes up with no messages is opened, and a notice says so and where SillyTavern keeps its copies of chats. **The card in front.** SillyTavern's "Auto-load Last Chat" comes back, after a reload, to its `active_character`, and it records that only from its own clicks (the character list, the welcome screen, `/go`), not when a card is selected for it. A scene opened by the Hub on a card other than the one last clicked was therefore not what a reload came back to. The Hub now records the scene's card (`setActiveCharacter`, where the build has it) when it opens a scene's chat, from the list or as a new scene. The chat the card opens on was already the scene: SillyTavern's `openCharacterChat` keeps that on the card. |

What it does not do. It does not explain the owner's empty chat; if the
file is missing the Atlas will now say so, and if it is there and empty
the notice will, and either answer narrows it. The log line written at
each open (the file asked for, the card, how many messages came up) is
there for a report. A reload comes back to a scene only where
SillyTavern's own "Auto-load Last Chat" is on; that is its setting, and
the Hub does not open chats by itself at startup. Opening a scene from
SillyTavern's own chat list goes through none of this.

Tests: `tools/hub-flow-test.mjs` §22 (a scene opened from another
card's chat, the card recorded; the file gone: nothing asked of
SillyTavern, the record marked, the words; the file back; a chat with
nothing in it) and §9 (a new scene records its card).

## 42. Run in a real SillyTavern; the way back to a scene (2026-11-12, D203)

With the owner's leave, SillyTavern 1.19.0 was installed from the
package registry and run in this session, the extension copied into its
user extensions, and a browser driven through the owner's steps. It is
the first time any of the Long Shot work has run in a real SillyTavern.
The owner's empty chat (§41) was not reproduced. What was run, each
with the chat's file read from the disk and the page reloaded between:

- a card made and clicked, eight messages sent, Play as scenes
  (`commitAdopt`), scene 1 started with a stand-in for the openers'
  request: the file holds its opening, and a reload with SillyTavern's
  "Auto-load Last Chat" on comes back to the scene;
- the long chat and the scene opened from each other, the scene opened
  and resumed from another card's chat, End, a scene started after it,
  Play as scenes taken again: every chat came up with its messages;
- D202's record of the card in front: opened from another card's chat,
  a reload comes back to the scene, where before it went to the other
  card;
- the Doom button's fly-out as `index.js` builds it (which no test
  runs): the Scene entry and its list, no strip above the chat, the
  knock's no-button choice and three taps opening the list at the left
  edge.

What the run did show: from SillyTavern's home screen (no chat open,
which is where a reload lands when Auto-load is off or its card is not
the scene's) there was no short way back to a scene being played. The
fly-out had no Scene entry, there being no scene in front, and the
Atlas opened on "This chat" with no world and no Scenes tab until a
world was picked.

| # | Decision | What it means |
| --- | --- | --- |
| D203 | A scene being played is one press away from wherever the screen is | **The fly-out.** With no scene in front and one being played (a world's open scene whose chat and card are there; of several worlds, the one started last, `sceneAway`), the Scene entry is there and lit, and opens to: which scene it is, that its chat is not the one in front, and **Go to scene N**, which opens its chat (D202's checks apply). **The Atlas.** Opened with no chat in front at all, it opens on the world whose scene is being played, or on the only world there is; the picker still chooses another. A chat in front keeps its own world, scenes or not. |

What it does not do. SillyTavern is not made to open a scene by itself
at startup: where a reload lands is its "Auto-load Last Chat" and its
record of the card in front, which D202 now keeps right. The run was on
a desktop browser at a phone's width, not on a phone, and with stand-ins
for the model's requests. The scripts that drove it are not in the
repository.

Tests: `tools/hub-test.mjs` (the entry for a scene not in front),
`tools/hub-flow-test.mjs` §22 (nothing being played, a scene left for
another chat, pressed, Live World off); the real SillyTavern, by hand.

## 43. A scene is opened on the card its chat is on (2026-11-12, D204)

The cause of the owner's empty chat (§41), found from what the model in
that chat said it had been given, and reproduced in the real
SillyTavern (§42). The owner's world had a narrator card of its own
before the long chat was played as scenes. D114 keeps a world's
narrator, so the long chat, on the story's own card, became scene 0
with its record naming that card, and new scenes were made on the
narrator's. But a scene was opened, and deleted, by the world's
narrator card whatever card its record named. Scene 0 opened from the
Scenes list therefore asked SillyTavern for the long chat's file under
the narrator card. It is not there; SillyTavern made an empty chat of
that name on the narrator card, showed it, and kept it as the chat that
card opens on, so a reload came back to it.

What the model in that chat reported is what such a chat is: no opening
and no scene brief (it is no scene), the default persona and not the
one the story is locked to, an empty inventory, and Live World started
afresh from the pack, its clocks and "last seen" at their beginning,
beside the continuity book's entries for the story as it stands now,
which fire in any chat. Asked for a reply, the model wrote the run's
first morning again from the lore.

| # | Decision | What it means |
| --- | --- | --- |
| D204 | A scene's chat is on the card its record names | `cardOfScene(world, scene)`: the scene's own card where its record has one, else the world's narrator; null when that card is gone. `openSceneChat` (the Scenes list's Open, Go to it, Resume, End for a scene not in front, the Doom button's Go to scene) looks for the file under that card, selects that card and records it as the one in front. `deleteScene` deletes the file under it. `sceneAway` asks for it. The Scenes list's reading of the narrator's chats already left scenes on other cards alone (`reconcileScenesWithChats`). |

What it does not do. It does not remove the empty chat the old code had
SillyTavern make under the narrator card, named as the long chat is: it
is harmless and is the owner's to delete from that card's chat list. A
world's narrator is still kept when a chat on another card is taken
(D114): scene 0 stays on its card and new scenes go on the narrator's.
Whether the long chat's card or the narrator should narrate the scenes
that follow is the owner's to say.

Tests: `tools/hub-flow-test.mjs` §23 (a world with its narrator, a long
chat on another card taken, scene 0 opened from the narrator's card and
a narrator's scene opened from the long chat, the card gone; the first
of these fails on the old lookup). The real SillyTavern: the old lookup
gives the owner's empty chat and a reload comes back to it; with D204
scene 0 opens on its card with its messages and Go to scene opens the
scene.

## 44. The openings are shown how the scene before ended (2026-11-12, D205)

The owner started a scene "Right after" and the three openings "did not
seem to know what was going on and just kind of made things up". They
asked that the request be given the last fifteen messages of the scene
before, or of scene 0 when no scene has been played yet, and did not
know what the other gaps should get. (They spoke of a narrator card
being made with three starting messages: what is made is a chat on the
world's narrator card, whose first message has the three openings as
its swipes.)

The request for the openings (D116, D177, D188) was told the world, the
place, who is there, their notes, where they stand, the open threads,
the ledger and the last two records, seven hundred characters each. It
was shown no message. "This scene opens right after" was said of a
moment it had a paragraph about.

| # | Decision | What it means |
| --- | --- | --- |
| D205 | The openings' request is shown the last lines of the scene before, as they were played | **Which scene.** The one the Start goes on from where it names one (Go on from here, Continue fresh); else the scene whose End made the world's memory, which is scene 0, the long chat, until a scene has ended; else the last that ended (`lastLinesFor`). **Which lines.** The last fifteen messages when the scene opens right after, the last eight when time has passed (`sceneTail`, `TAIL`): the player's and the narrator's, a line each, thinking, tracker blocks and dice marks taken out. An earlier message is cut at 1,000 characters; the last two keep 2,400 from their end, because a scene stops at the end of its last message. 16,000 characters in all, the oldest lines going first. **From where.** The chat in front where that is the scene; else its file, read through SillyTavern's own route on the card its chat is on (D204), without opening it. Where it cannot be read the request is as it was, and the pick says so. **What it is told.** Right after: the scene carries straight on from that very moment, no time skipped, nobody moved unless the lines moved them, nothing told again, the next move the player's. Time passed: how things were left, and the scene is a new moment that follows from it, the conversation not carried on. Both: write as the narrator wrote in those lines (the person and tense, speech set out the same way with its marks and colour tags, about that length), and make nothing up that the lines, the record and the notes do not give. With lines to follow, "plain prose, no markup, a paragraph or two" is no longer said, and an opening may run to 4,000 characters (it was 1,500). **Said on the pick.** "Shown the last 15 messages of scene 3 as they were played, to carry straight on from", or that the messages could not be read. Ask again uses the same request. |

What it does not do. The request is still DES's own and not the chat's
preset: the roleplay frame a preset carries (the person and tense rules,
banned words) reaches it only through the lines it is told to write
like. The count is not a setting. For a gap of weeks the last eight
messages may matter less than the record; they are given all the same.
It was run in the real SillyTavern with a stand-in for the model: that
the lines are read from the file on the right card and are in the
request is confirmed there, that a model writes a better opening from
them is not.

Tests: `tools/hub-test.mjs` (the lines: count, what is left out, the
cuts, the budget; the request with and without them, right after and
later), `tools/hub-flow-test.mjs` §24 (read from the file on another
card and nothing opened, the next day, the chat in front and no file
read, fifteen and eight, a named scene, the file gone),
`tools/atlas-browser-test.mjs` §5h (the pick's line).

## 45. An ended scene deleted: what it changed is taken back from its log (2026-11-12, D206)

D197 gave Delete to a scene that never ended and none to one that had:
"the world remembers it". The owner: "We are definitely going to need a
way to delete ended scenes", then, of the choice between a kept copy of
the world before each End and nothing, "users are going to fuck up and
need to restore; I like the idea of peeling back the layers; ideally I
would like to be able to peel back every layer", and, of the copies:
"Could we not just make a log of what was added when?" That is what is
built. A log is smaller than a copy of the world for every End, and it
does more: a copy can only put the world back from its end, a log can
take one scene out of its middle.

| # | Decision | What it means |
| --- | --- | --- |
| D206 | Every End writes down what it changed; a scene deleted takes those changes back as far as they still stand | **The log** (`src/utils/sceneLog.js`). An End does not only add: it replaces the date and place, where people stand, the clocks, the tracker. So the log is the difference between the world's entry before the End and after it (the memory with all its stores, the continuity, the phrases held back; not the list of scenes), each entry "this was X, the scene made it Y": X whole, Y as a short mark (its length and a hash). Items of a list that have a name of their own (a ledger line, a person, a thread, a hook, a place on the map) are entries by that name, not by their place in the list. A scene reopened and ended again has both Ends in the one log. **Where it is kept.** Not in the settings: a file of the player's own on SillyTavern's side (`/api/files/upload`, read back from `/user/files/`), named on the scene's record (`log`). It is as big as what the scene changed: under two kilobytes for the scene run in the real SillyTavern. **Deleting a scene the world remembers** (ended, or ended once and reopened; any of them, in any order): each thing its Ends changed is put back to what it was, where it is still as that scene left it. What a later scene, or the player, has changed again is left as it stands: it is no longer that scene's to take back. Then the record, the chat and the log go, as D197. The newest scene deleted puts the world back exactly as the scene before left it; delete the newest again and again and the layers come off one by one. **Asked first.** Delete on the row reads the log and says: how many things it changed would be taken back, where they are (the date and the place, the tracker, where people stand, the open threads, the ledger, the inventory, the world's clocks and who is where, the hooks, the map), and how many stay because they were changed again. **The continuity book.** The player's own edits in it are taken in first, so one of theirs is never put back; then the entries the scene's End made for people who are gone again are taken out, and the rest are written from the continuity as it now stands (`planBook` with `force`: "already said" is asked of the entry's text, not of the mark of what was last written). **No log.** A scene that ended before this, or whose log could not be written or read, is deleted with its chat and the world keeps what happened in it; the question says so. **Not deleted.** Scene 0: it is the player's own long chat and where the world's memory begins. Play as scenes on it again starts the world over from it. A remembered scene whose chat is gone but whose log is there is deleted this way too, not only removed. **The Undo of an End** (D190) takes that End out of the log again. |

What it does not do. A scene taken out of the middle is not unwound as
if it had never been: what a later scene built on it stays, and the
question says how many things that is. The marks are 32-bit hashes of a
value's text, with its length: two different values with one mark would
be taken for the same, which is not looked for. A change inside a long
list whose items have no names (the tracker's own text, the world's log
of what moved) is one entry for the whole list. What the scene's End
wrote outside the world's entry and the continuity book is not in the
log (there is nothing else: the scene's own chat goes with it). The log
is not shown to the player as a history of the scene, though it could
be. Run in the real SillyTavern: a scene ended (21 changes, 1,785
bytes), asked about (14 things to take back), deleted, and the world's
memory, people and threads were as before its End, its log and its chat
gone; a scene from the middle was not run there.

Tests: `tools/scene-log-test.mjs` (the marks, the log, taken back from
the end and from the middle, the player's own hand since, lists, a scene
ended twice, a world's first End, the words); `tools/hub-flow-test.mjs`
§25 (the real module: the log written and named, three scenes, the
newest deleted, one from the middle, no log, the Undo of an End, ended
twice, a log gone); `tools/hub-test.mjs` (which scenes, the words);
`tools/atlas-browser-test.mjs` §5k (Delete on ended scenes, the
question in each case, scene 0, a chat gone).

## 46. The pick of openings: one Start, and each opening can be heard (2026-11-12, D207)

The sheet that asks how a scene opens (D174) showed three openings with
a button under each, "Open with this". The owner, of that screen: "Can
we add the option to have these read by the AI", and "it's kind of
weird that we have three start with this buttons [when they] all just
go into the swipes anyway". Both are true of what was built: whichever
was pressed, all three became swipes of the scene's first message
(D119), so the three buttons chose only which one was in front.

| # | Decision | What it means |
| --- | --- | --- |
| D207 | One Start for the three openings, a mark on the one shown first, and Listen on each where Voices is on | **One Start.** The sheet has one primary button, "Start scene N", and each opening is a card with a mark (a radio) in its title: the marked one is the first swipe, the others follow it in their order, and each says what it will be ("shown first", "swipe 2", "swipe 3"). The first is marked until another is; a press anywhere on a card marks it; the mark is changed in place, so what is typed in "Or write the opening yourself" stays. Open with mine, Ask again and Back are as they were. With no opening written there is no Start, as before. **Listen.** Where DES Voices is on, each card has a Listen button. It reads the opening as a message of the chat is read: the text is formatted as SillyTavern formats a message and split by the same parser (`segmentTextForTts`), speech in dialogue colours goes to its speaker's voice, the rest to the Narrator's; the people the opening names count as present for the scene rule, since the tracker of the chat in front is not about a scene that does not exist yet (`speakText`, `presentNames`). The one being read says Stop; pressed, it stops; another one pressed takes its place; read to its end, it says Listen again (the buttons follow Voices' own `dooms:voices-state`, in place). The reading is stopped when the sheet goes away: Start, Ask again, Back, Close, Escape, the Atlas closed. With Voices on and no voice service set up, Listen says so every time it is pressed (the engine says it once in a session, and a button that does nothing is no answer). With Voices off there is no button. **Found on the way.** The sheet is drawn from the pending start (`pendingStart`), which carried neither the note of which last lines the openings were shown (D205) nor the continuity note (D178): both were in the view and in what `prepareScene` returned, and never on the screen. It carries them now, with the name of the card that will speak. |

What it does not do. An opening is plain prose, so most of one is read
in the Narrator's voice, speech in quotes included: only speech marked
with a dialogue colour has a speaker to give it to, as in a chat
message. What is typed in the player's own box cannot be listened to.
Listen costs what reading a message costs (a request to the voice
service for each stretch), and is not kept: the same opening heard
again in the chat is asked for again. Run in the real SillyTavern at a
phone's width with the voice service stubbed: no button with Voices
off, the notice with no service, the text and voice of each request,
one reading taking another's place, stopped by a second press, the
button back to Listen at the end, the mark moved by a press on a card
and on a title with the typed text kept, Start pressed during a reading
(it stopped, the scene opened on the marked opening with the other two
as swipes 2 and 3), and the D205 line on the screen. Not heard with a
real voice, and not on a real phone.

Tests: `tools/atlas-browser-test.mjs` §5h (one Start, the marks and
what each will be, each opening marked in turn, Listen only with
Voices, the one being read, one opening alone, none);
`tools/hub-flow-test.mjs` §24 (the pending start carries the last-lines
note, the continuity note and the card).

## 47. A long chat read once: the ledger filled from the record's own requests (2026-11-12, D208)

D198 read a long chat whole for Play as scenes, a request a part, and
then offered the ledger "the same read": as many requests again, each
part of the chat sent a second time. The owner, of that offer: "Why do I
need to spend 12 more requests to do that, isn't that what the first one
was supposed to do?" The two reads were kept apart because they are two
requests with two forms (the record's, Canon's), not because the chat
has to be read twice. Asked what was recommended: fold the ledger into
the first read. "Go ahead."

| # | Decision | What it means |
| --- | --- | --- |
| D208 | Each request of a whole-chat read is asked for the record of its part and for the ledger's facts of it | **The request.** `buildRecapPrompt` takes a `ledger` (the entries so far, the names the story knows, the player's): the answer's shape gains a last key, `"ledger": {"add": [...], "drop": [...]}`, the rules are Canon's own word for word (`canonAsk`, which Canon's request is now built from too, so the two cannot drift), the request is shown "The ledger so far", told to read this part alone for it (the record so far is not a source: its facts are in the ledger already), that an empty add is a sound answer, and to write the record in full first. A part may add 16 and drop 8, as a scene's page does in Canon's own run; the whole chat in one request 48. **The answer.** The record is read as before; the ledger's part (`ledgerOfReply`: under its key, or written beside the record, or a bare list of adds) is checked and written by Canon (`applyCanonReply`) as a run of its own is, so the next request is shown the ledger as this one left it. A ledger that breaks the form writes nothing and is not held against Canon. **What cannot be made worse.** The longer answer is the likelier one to be cut short, and the read cannot go on without the record. So an answer that came back and could not be read is asked for a second time for the record alone; a request that did not come back at all (the connection, a limit) is asked for again as it was. An answer with the record and no usable ledger is not a failed request: the read goes on and that part is one the ledger missed. A part skipped is skipped for both. **Afterwards.** The review says what the ledger was given ("filled from the same requests: N facts added") and, where parts were missed, how many, with a tick (on) to read those parts alone for the ledger before the chat is taken: `readAdoptLedger({ only })`, Canon's own request for each, the other parts' bars standing as done. **The choice.** With Canon on, the first screen has "Fill the ledger from the same requests", ticked; it cannot be changed while only the last stretch is asked for (there is no whole read to fill it from). Unticked, the read is the record's alone and the ledger's own read of the whole chat is offered at the review as before, unticked now, since it was turned down a moment earlier. A read taken up again after a failure or Stop goes on as it began. With Canon off nothing is different. |

What it does not do. The ledger is now written while the chat is read,
before the chat is taken: it is the one thing a read changes, as Canon's
own runs change it while a chat is played, and a read given up leaves
the facts it found in the chat's ledger. Whether a model writes the
record or the ledger less well when asked for both in one answer is not
measured: the tests and the run in the real SillyTavern use a stand-in
for the model, and the tick is there for the case that it does. An
answer cut short inside its ledger is not salvaged (the record in it is
complete by then); it is asked for again, at the cost of one request.
The facts of every part are stamped with the chat's date as it stands
now, as the ledger's own read stamped them. The last-stretch read (one
request, the last forty messages) does not carry the ledger. Run in the
real SillyTavern at a phone's width, through the panel: the tick, dimmed
for the last stretch; three parts read in three requests with the
ledger asked for in each; one answer without a ledger and one cut short
(asked again for the record alone); the review's line and its offer;
the two missed parts read for the ledger alone by Canon's request; the
world's memory holding the three facts. With those two answers made to
go wrong it took six requests; with none going wrong it takes three,
where the two reads took six.

Tests: `tools/hub-test.mjs` (the request with and without the ledger,
Canon's rules in it word for word, the answer's ledger in each form);
`tools/hub-flow-test.mjs` §26 (read once and Canon never asked by
itself, the ledger growing from request to request, not asked for,
Canon off, an answer without a ledger and its part read alone, one cut
short, a connection refused, a form broken, taken up again, skipped, in
one request, taken); `tools/atlas-browser-test.mjs` §5g (the tick, the
line while it reads, a failure, the review in each case, done, a
phone).

## 48. A narrator card of its own for every scene (2026-11-12, D209)

hub-plan D114 bound a world to one narrator card and made every scene a
chat on it. The owner had asked for something else and said so more than
once: "When you start a scene it's supposed to create a new narrator
card with three starting messages", and, when asked which of the two
existing cards new scenes should be chats of, "I have been telling you
to create a new narrator card with the 3 openings the whole time." What
was built was not what was asked for, and the question put was one that
only the wrong build raised. Asked whether the new card should copy its
description from the story card or from the world's narrator: "Should we
just run with a blank card from the start?" Yes.

| # | Decision | What it means |
| --- | --- | --- |
| D209 | Starting a scene makes a new narrator card for it: blank, its three openings the card's greetings | **The card** (`sceneCardFields`, `makeSceneCard`). Made through SillyTavern's create route as Make a narrator card makes one. Named `Narrator`, whatever the world and the scene: that is the name on its messages. Its description is one line (it is the narrator of this world, the player is `{{user}}`, the chat is one scene and the brief says the rest) and every other field is empty: nothing is copied from the story card or the world's narrator, so no other card's text is in a scene's context. The scene's brief is sent with every reply as before (hub-plan D120), and the story so far reaches the narrator through the ledger, the continuity book and the lorebooks. **The openings.** The one marked on the pick (D207) is the card's first message and the other two its alternate greetings, in their order, which SillyTavern shows as the first message's swipes; opened with the player's own words, those are its one greeting. The scene's chat is still written by the Start (hub-plan D118), under the new card, its first message carrying the same three as swipes. **Which is which.** The card's note, which SillyTavern shows under the name in its character list and never sends, says the world, the scene's number and title, the place and the date. The card is tagged `<World>: scenes`, the tag made as a closed folder: with SillyTavern's "tags as folders" on, a world's scene cards are one folder in the list. **The record.** A scene's record names its card (D204) and now says the card is its own (`ownCard`). A scene is opened, resumed and gone to on its own card; going straight on in a fresh chat (D181) makes the next one's. A world needs no narrator card of its own to start a scene. **Deleted with the scene** (D197, D206). The card goes through SillyTavern's delete route, with its chat and any other chat started on it by hand: the question before a delete says so and how many. SillyTavern cannot lose the card that is in front (its list read again without it, the page is reloaded), so when the scene is in front the world's latest other scene is opened first, on its own card, else the chat is closed; SillyTavern's own delete is not used because it closes whatever chat is in front, whichever card is deleted. The tag goes with the last card that carries it. A card that cannot be made starts nothing; a chat file that cannot be written takes the card made for it away again. A card deleted in SillyTavern itself took its chat with it: the scene is marked as gone from the list SillyTavern already has (`markCardsGone`), no request a card. **The setting.** "A narrator card for every scene", in Settings under The Hub, on. Off, every scene is a chat on the world's one narrator card as before (D114), and the scenes already played stay on the cards they are on either way. |

What it does not do. A lorebook linked to the story card itself fires
only in chats on that card, so it does not fire in a scene: lore that
is on globally, or through the Lore Library's campaign, does. A scene's
card is not kept in step with its scene afterwards: a title changed, an
opening edited in the chat, a place moved to are not written back to
the card. A chat started on a scene's card by hand opens on the same
three greetings and is not a scene (hub-plan D113). The character list
holds a card a scene; without "tags as folders" they are in the list,
each with its note. Every card is called Narrator, so SillyTavern's own
search by name finds them all. The scene's brief is not moved into the
card: it stays in the slot the extension sends with every reply, which a
preset cannot leave out. Run in the real SillyTavern at a phone's width:
a scene started through the panel with the third opening marked (the
card, its note in SillyTavern's list, its tag, its greetings as
SillyTavern saved them, the chat under it with three swipes), the page
reloaded (back in the scene on its card), the scene ended and the next
started (a second card), one opened from the list across cards, the one
in front deleted (the other opened in its place, the card and its chat
folder gone from disk, no reload of the page), the other deleted from
another chat (that chat still in front). Not on a real phone, and not
with SillyTavern's "tags as folders" switched on.

Tests: `tools/hub-test.mjs` (the card's fields, the tag, the record's
flag, cards gone, the words, the setting); `tools/hub-flow-test.mjs`
§27 (the old way and the new on one world, the card and its greetings,
the tag, the file under it, in front, the next scene, between cards, a
rename under another card, the question, deleted in front and from
elsewhere, a card that cannot be made, a file that cannot be written,
no other scene to go to, a card deleted in SillyTavern, straight on);
`tools/atlas-browser-test.mjs` §5h (the sheet and the pick), §5k (the
question).

## 49. The openings are told the tracker of the last message (2026-11-12, D210)

The owner, with the scene cards in hand: "The scene opening needs to be
fed the tracker data from the last messages as well. It is working well
now but it doesn't get the time of day or weather right." Three things
were behind it. The request was told the weather only where the scene's
place had the same name as the tracker's place, so a scene opened
somewhere else was written under whatever sky the narrator chose. It was
told the time as the tracker keeps it, a span ("20:00 → 21:40"), under
the heading "the story's date at the last scene". And the new scene's
own date and time were the narrator's answer even where the scene opens
right after, so a wrong guess became the scene's tracker. The last
lines (D205) could not put it right: the tracker's blocks are taken out
of them.

| # | Decision | What it means |
| --- | --- | --- |
| D210 | The opening is told when the scene before stopped, by the tracker of its last message, and a scene right after opens at that moment | **Read** (`lastTrackerFacts`). Every reply keeps its own copy of the tracker, for the swipe in front (`extra.dooms_tracker_swipes`, or under the swipe's record in a chat read from its file). From the chat the last lines are read from (D205), the last reply's is read: the date, the time it had reached (the end of a span, `timeReached`), the place, the weather, the temperature. The last six replies are looked through for one that has it, and how many messages lie after that one is kept. Where the chat cannot be read or has none, the world's memory as its End left it is used (the same tracker, as the End read it); where the tracker found is some messages behind the end of the very scene whose End made the memory, the memory's word is the newer and is taken. **Told** (`buildOpenersPrompt`, `then`, `now`). In place of "the story's date at the last scene": when the scene before stopped, by its tracker at its last message, with the place and "Weather then"; and then, right after, "the same date, the same time of day and the same weather", wherever the scene opens; with time passed, that it opens that much later, and what the date and time have come to where the gap's run moved the world (before this that later date was given as the last scene's, with the gap on top of it). The narrator is told that "when" is that date and time of day and that no opener opens at another hour or under another sky; with time passed, that the weather follows from what it was. A tracker some messages behind the end is told as that, and the lines are what the hour and the sky are taken from first. With nothing known the request is as it was. **Held to.** Right after, with the tracker of the very last message (or the memory's), the scene's date and time are the tracker's and not the narrator's answer, asked again or not; the scene's own tracker starts at that date, that time and that weather. With time passed the narrator's "when" stands. **Shown.** The pick says what the openings were told under the line about the last messages: "Opens at the moment it stopped, by the tracker of its last message: 14th of Frostfall · 21:40 · sea fog, 4°C" (or "Counted on from where it stopped", or "by the world's memory"). |

What it does not do. Only the info box is fed: the date, the time, the
place, the weather and the temperature. Who the tracker had as present
and what they were thinking is not; the people of a scene are chosen on
the sheet and where they stand comes from the record (D188). With time
passed the weather is left to the narrator, told what it was: the world
keeps no weather of its own to move. A chat whose replies carry no
tracker (the tracker off, or its runs failed) falls back to the world's
memory, which is the tracker as the last End found it. The opening's
prose is still the narrator's: it is told the hour and the sky, and a
model can still write against them; what cannot go wrong any more is
the scene's own tracker. Run in the real SillyTavern at a phone's
width with a stand-in narrator that always answered the wrong date and
"bright morning": a scene played with a tracker on its last reply and
ended; from another chat, the lines and the tracker read from the
scene's file and the request's three lines as above; through the panel,
the pick's line, and the scene started at 14th of Frostfall, 21:40, in
sea fog.

Tests: `tools/hub-test.mjs` (the time reached, the last reply's
tracker in each place it is kept and each shape, one behind, none, the
request right after, with time passed, behind, with nothing known);
`tools/hub-flow-test.mjs` §28 (a world's first scene, the message's
tracker over the chat's latest, the weather at a place of another name,
the date and time held to, asked again, the new scene's tracker, the
memory's word over an older message's, the next day with the world
moved, later that day without); `tools/atlas-browser-test.mjs` §5h
(the pick's line).

## 50. Who the tracker had present: ticked on the sheet, told to the openings (2026-11-12, D211)

D210 fed the openings the tracker's date, time and weather and left its
Present Characters out. Asked whether they should go in too, the owner:
"If we could feed the present characters in and auto fill them in for
the check boxes that would be pretty cool."

| # | Decision | What it means |
| --- | --- | --- |
| D211 | The people the tracker had present when the scene before stopped are ticked on the Start sheet, and the openings are told how it had the ones in the scene | **Who** (`presentFromTracker`). The tracker's Present Characters as it kept them with the last reply (D210's same copy): each by name, once, in its order; one it marks as off the scene is not present, as on the panel, nor is the player. With each, how it had them: its own fields under their own names (appearance, demeanour, whatever the player's tracker keeps), how they stand with the player, what was on their mind, 320 characters at most. **The sheet** (`lastScenePresent`, `peopleFor`). The Who list marks them "last scene" and ticks them to begin with, beside the ones last seen at the place ("here"), and lists them first; one the world does not know yet is listed all the same. A line under the list says why they are ticked. They are read without a request: from the last reply of the chat in front when that chat is the scene before, else from the world's memory, whose End took the same tracker. Changing the place keeps them ticked (the ones ticked only for being at the old place are let go, as before). A Start that names its own people (a person's card) ticks those alone, as before. Going on from an older scene whose chat is not in front, no one is ticked from it: that needs its file. **The openings** (`thenPeople`). Under "People here", for those of them who are in the scene (ticked): "How the tracker had them when the scene before stopped", a line each, read from the chat the last lines are read from (so a scene gone on from by name gives its own people, not the latest scene's). The narrator is told they are still so as the scene opens, dressed as they were and in the state they were in, and that what was on a person's mind shapes what they do and is not said aloud. Told right after and later the same day (there, "unless the time that has passed would have changed it"); from the next day on it is left out. Someone who was there and is unticked is not told of. **Shown.** The pick's line (D210) adds whom the openings were told of. The new scene's own tracker starts with the people of the scene as present, with what the tracker kept of them, as it did before (seedStores). |

What it does not do. The ticks are a beginning: nothing stops the player
unticking them, and a scene started at another place has them ticked
all the same (the party goes together more often than not). The
tracker's vitals and the player's own entry are not fed. What the
tracker kept is given in its own words: where it is wrong, the opening
is told the wrong thing. Run in the real SillyTavern at a phone's width:
a scene played with three people in its last reply's tracker, one of
them off the scene, and ended; the sheet with that scene in front and
from another chat (the two present ones ticked and marked, the third
not listed, in a world that knew none of them); one unticked, and the
request and the pick's line naming only the other; the scene started
with her as its tracker's one present character, her appearance kept.

Tests: `tools/hub-test.mjs` (who is present and how, each shape, the
last reply's copy, the request with and without); `tools/hub-flow-test.mjs`
§29 (no scene yet, the chat in front, the memory, the one in the
scene told of and the others not, the same day, the next day, the next
scene's people, an older scene by name from elsewhere and in front);
`tools/atlas-browser-test.mjs` §5h (the sheet's ticks, marks and line,
the pick's line).

## 51. Example dialogue on a character's card, sent while they are in play (2026-11-14, D212)

The owner: "We need to add a section to the workshop characters that
will hold and inject example dialogue for the character when they are
in play." The Workshop's Injection tab was not the place: what it holds
is a direction given once, when Inject into Scene is pressed, and
nothing of a Workshop character was sent with every reply. Asked where
it should live and whether it should draft itself from the chat: a tab
of its own, and just the box.

| # | Decision | What it means |
| --- | --- | --- |
| D212 | A character's card has a Dialogue tab; its lines are sent with every reply while the tracker has the character in the scene | **Held.** The Workshop has a Dialogue tab between Injection and Knives: one box, 6,000 characters, with a line under it saying how much is sent. The text is kept with the character's injection entry, as `dialogue` (`characterInjection[name].dialogue`), so it goes wherever that entry goes without being told to: a campaign's version of the character, a rename or a merge of aliases, an export and an import. A card with nothing written keeps no such field. The player's own characters have no Dialogue tab: the narrator does not write for the player. A SillyTavern card imported as a character brings its own example dialogue with it. **In play** (`presentWithDialogue`, `src/systems/features/exampleDialogue.js`). On every generation the tracker's Present Characters are read as the reply is written from them (the committed tracker data, else the last generated): each by name, not one the tracker marks as off the scene, never the player, the tracker's name for someone turned into the Workshop's (aliases), eight at most. A scene's first reply has its people from the scene's seed. A character who is not in the scene costs nothing. **Sent** (`buildDialogueBlock`). One block in a slot of the extension's own (`dooms-example-dialogue`), in the chat at the depth and in the voice set in Settings (four messages from the end, as the system): a line saying what the lines are for (that person's voice: their words, their rhythm, their manner) and that they were never said in this story and are not to be repeated or quoted, then each character's under their name as their card spells it. SillyTavern's own marks are read as its example dialogue reads them: `{{char}}`, `{{user}}`, a line with only `<START>`. One character's is held to 1,500 characters, cut at the end of a line; everyone's together to 6,000, the first ones whole and the rest left out. Not sent with a quiet generation or one written as the player. **The openings** (D119). A scene's openings are given the example dialogue of the people in the scene who have some (800 characters each), told the same of what the lines are for, and the pick says whose it was written with. **Settings**, under Workshop: the switch (on), the depth and the voice. |

What it does not do. Nothing drafts the lines: the player writes or
pastes them. A character has one set of lines, whatever the scene and
whoever they are speaking to. The block is sent whole with every reply
while the character is present, so a crowd of talkative cards costs up
to 6,000 characters a reply. Whether a model keeps a voice better for
the lines, and whether one repeats them in spite of being told not to,
is not measured. Who is present is the tracker's word: with the tracker
off, or a character it has not listed, nothing is sent. Run in the real
SillyTavern at a phone's width: the tab, the lines written, saved,
reopened, and kept when the description was saved after; the block as
SillyTavern holds it for the next reply with the character present, and
nothing with her off the scene, absent, or the reply written as the
player; the depth changed and the switch turned off in Settings; the
player's own character without the tab, and the tab not left in front.
No reply was generated there (no model is connected to it): what was
read is the prompt slot SillyTavern sends.

Tests: `tools/example-dialogue-test.mjs` (the setting, what a card
keeps, the text as sent, who is in the scene with some, the block and
its room); `tools/hub-flow-test.mjs` §30 (sent with a reply, who is
left out, read anew each reply, the committed tracker, a dry run, quiet
and impersonated generations, the switch, the depth and voice, the
extension off, no one present, a scene's openings and its first reply,
switched off for the openings); `tools/atlas-browser-test.mjs` §5h (the
pick's line).
