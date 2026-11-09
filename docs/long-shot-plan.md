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
`Project-Short-Fuse` at `43837f5`. Phase 1 built (§6). Phases 2 to 4 are
planned below and not built.

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

One layout unit is the step between two sibling places. A scale says how
far that is: `town` 0.1 mi (a street), `region` 15 mi, `world` 60 mi.

**The layout.** Places are laid on sunflower spirals: a root place (a
region) around the origin with a step of 7 units, a place inside it
around the region's centre with a step of 1, a place inside that with a
step of 0.09, and so on. The n-th child of a parent sits at
`step * sqrt(n + 0.5)` from it, at n golden angles plus a turn hashed
from the parent's id. A child's spot depends only on its parent's spot
and its own index among its siblings, so a place added later moves
nothing (D140). A story place the pack does not name (a `loc:` id) is
laid the same way under the world itself.

**Regions.** A root place is drawn as a blob: 40 points around its centre
at the radius of its farthest child plus a margin, waved by three sines
whose phases are hashed from its id. Around it a wider blob is its coast;
the coasts of neighbours overlap and are drawn as one landmass (every
coast's line, then every coast's fill over the lines). Its terrain (plains, forest,
mountains, desert, snow, swamp, coast, town) is guessed from its name.

**Routes.** A minimum spanning tree over the places of each region, and
one over the regions through their nearest places. Drawn, never measured
(D141).

**What it exports.** `normalizeAtlas`, `ATLAS_KINDS`, `guessKind`,
`guessTerrain`, `layoutAtlas(pack, state)`, `atlasModel({ pack, state,
player })` (regions, routes, markers with their people, the party's
place, the bounds), `distanceBetween(model, a, b)`, `travelTime`,
`describeDistance`, `filterMarkers(markers, { query, hidden })`,
`kindCounts`, `withSpot(raw, placeId, spot)`. Tested by
`tools/atlas-test.mjs`.

## 4. The window

`src/systems/ui/atlasViews.js` (pure HTML: the shell, the sidebar, the
marker card) and `src/systems/ui/atlas.js` (Leaflet under `CRS.Simple`
with one SVG renderer, the markers as `divIcon`s, the events).
`styles/atlas.css`, loaded when the window first opens. Opened from
**Atlas** in the D menu.

- The sidebar: the world's name with the date; a search; the tabs
  Places, People, News, Rumours. Places is the grid of kinds with their
  counts and the visited count.
- The map: wheel, drag and pinch; the zoom buttons; Find the party; The
  whole map; a scale bar that reads in the world's unit. What a zoom
  shows goes by how many pixels one layout unit is on screen: under 30
  the places are dots (pins would sit on one another), from 30 pins, from
  84 pins with their names, from 420 the places inside places too. The
  regions' names and the party's marker show at every zoom.
- The card: D142.

## 5. Phases

1. **The map** (built): the model, the window, the kinds, the search,
   the card with distance and Travel here, News, Rumours and People in
   the sidebar from Live World's own views.
2. **The sheet and the markers**: the notes box, the draft around the
   notes, `atlas.links` and the solver, the guesses marked, the lock; the
   tray, the drag, pinned spots; the kind and the note editable on the
   card.
3. **Tracking**: weather by region on the map and the card; hooks in the
   sidebar and on the card; news and rumours that name a place listed on
   its card; the distance and the travel time given to the travel cut,
   so the story's clock moves by the road's length.
4. **The clean-up**: the Map window, the Hub window and the board
   removed with their styles and tests (D138, and D149 once answered);
   the World Builder's Map tab becomes the Atlas's own edit mode.

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

