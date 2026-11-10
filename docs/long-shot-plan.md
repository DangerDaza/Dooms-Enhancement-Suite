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
