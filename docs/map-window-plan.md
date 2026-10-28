# The Map window (Live World's face, second pass)

The owner's sketch (2026-10-28): a window with the world's name across the
top; a row of circles, each the picture of a place, the most recent place
on the left and older ones to the right, scrollable; a News panel across
the bottom that swaps between several functions, "Completed quests" one of
them; a place clicked and a button, Travel here, that montages the party
getting there the way Cut to a quest montages the way to a quest. "This
will be a new pop up window"; "this is a replacement of the live world."

**Status (2026-10-28):** being built on `Project-Short-Fuse`, four
commits: the model, the feature, the window, the docs.

## 1. Decisions

The owner was asked four questions (which places, how pictures come,
which panels, how Travel here is offered) and answered by saying what the
window replaces; the recommended answers stand below, each marked, and
any of them is his to change.

| # | Decision | What it means |
| --- | --- | --- |
| D81 | The window replaces the Live World window (the owner) | Same shell (`#rpg-world-popup`, sized like the Workshop), same ways in (World in the D menu while Live World is on, Settings → Live World → Open Live World, `/liveworld`), same foot (Advance now, Refresh, the result). The board of tiles, its trail and its tabs go (D69's layout), with their styles and their test. The face popover stays (People). |
| D82 | Places are the ones the story names (recommended, standing) | Each fresh reply's tracker Location becomes a visit: when it names a pack place (`placeFromText`), the pack's id, label, nesting and art are used; otherwise the location text itself is the place, keyed by a slug of it. One entry per place, newest visit first (`state.visited`, in the chat's world state, capped at 60). A reply that is deleted or regenerated takes its visit back (the rewind, `reconcileVisited`); a place with no standing visit and no picture leaves the row. The first entry is where the party is: "You are here". |
| D83 | Pictures drawn on demand, from an AI-written description (recommended, standing) | A place shows the pack's `image` when it has one, else its drawn picture, else a glyph. Draw (on the selected place) asks the AI, on the tracker's connection profile in the background, for a description of the place from the scenes at or near it (2 to 4 sentences, no names, no story), then renders it through Settings → Image Generation (`renderImage({ purpose: 'place' })`) with the page's Places group (size, style preamble, negative prompt); the file is saved into the character's folder like a scene picture and its URL kept on the visit. Redraw replaces it. A switch on that group, **Draw new places automatically** (off), draws a place the first time it is visited, after the fresh reply, never from a recovery; a toast says so. |
| D84 | Travel here is a cut (recommended, standing) | Clicking a circle selects the place; a strip under the row names it and offers Travel here with an optional "arriving when…" box (the quest cut's "when"); the current place says You are here instead. Travel arms the same cut the quests use (`chat_metadata.dooms_quest_cut`, `kind: 'travel'`), asks for a reply with `/trigger`, and the instruction rides the generation in the quest cut's slot: a brief montage of the road, then the arrival with the first move the player's; the tracker's location moves to the place, which the next reply then records as the newest visit. Swipes keep the cut; the player's next message ends it. |
| D85 | The bottom panel: News, Rumours, People, Completed quests (recommended, standing) | Four buttons down the panel's right. **News**: Lately, the feed of moves and clock steps under their dates, with its filter (the latest 12, 50, everything). **Rumours**: the blurb and each clock's public effect as a sentence (the old Word on the street, spoiler-free as set). **People**: the faces last seen as portrait cards with the place under the name; a card opens the face popover, whose Show the place selects that character's place in the row when it is there. **Completed quests**: the chat's list, newest first, with the date. The panel opens on News; the choice is remembered for the session. |
| D86 | Completed quests are recorded when a quest is completed (recommended, standing) | The shelf's Complete (the ✓ on a quest box, the menu's Complete) removes the quest today; it now also records it in `chat_metadata.dooms_quests_done` (text, the tracker's date, the clock time; newest first; capped at 100; the same text completed again moves to the front). A quest the AI drops from its list is not completed by that alone. |
| D87 | What goes | `buildBoard`, `boardCrumbs`, `boardPlaces`, `childCount`, `peopleOnBoard`, `captionsOnBoard`, `boardRootFor` in `src/utils/worldBoard.js`; `boardHtml`, `WORLD_TABS`, the tabs in `src/systems/ui/worldViews.js`; the trail, the stepping and the tabs in `worldDashboard.js`; the `.dooms-board-*` rules in `style.css` and `styles/overhaul.css`; `tools/world-board-test.mjs` (its clock-place, faces and URL checks move to `tools/world-map-test.mjs`). Kept: `facesOfTheWorld`, `placeOf`, `safeImageUrl`, the face popover, the feed and the effects views. |
| D88 | The layout | The header bar is the world's name, with the tracker's date and the run status small beside it. The row scrolls sideways (the wheel, a drag on a phone, an arrow button at each end that pages); circles 150 px (110 on a phone) with the picture filling them, the name under, a ring on the current place and a brighter ring on the selected one. The strip under the row: the selected place's name (and its parent for a pack place), when it was last visited, Travel here / You are here, arriving when…, Draw / Redraw. The panel takes the window's lower part at a fixed height and scrolls inside; its buttons stack on the right. The five looks restyle it through their tokens. |

## 2. Shapes

`state.visited` (in `chat_metadata.dooms_world`, normalised with the
rest): `[{ id, label, packId, path, visits: [msgId…] (the last 30),
firstDate, lastDate, lastTime, image, prompt, drawnAt }]`, newest first.

`chat_metadata.dooms_quests_done`: `[{ text, at, gameDate }]`, newest first.

`chat_metadata.dooms_quest_cut` with `kind: 'travel'`: `{ kind, place,
when, at, facts }` (the quest cut's shape with `place` for `quest`).

`settings.imageGen.places`: `{ size: 'square', preamble: '', negative: '',
auto: false }`.

## 3. The pure model (`src/utils/worldMap.js`)

`placeKeyFor(pack, location)`, `visitPlace(state, pack, { location, msgId,
gameDate, gameTime })`, `reconcileVisited(state, presentIds)`,
`currentPlace(state)`, `placesRow(state, pack)`, `rowIdForCharacter(state,
pack, name)`, `buildPlacePrompt({ place, recent, world, size })`,
`buildTravelInstruction({ place, when, userName, facts })`,
`normalizeDone(raw)`, `addDone(list, text, { at, gameDate })`. Tested by
`tools/world-map-test.mjs`.

## 4. The feature

- `src/systems/features/liveWorld.js`: `placeFromScene` also records the
  visit; the rewind also prunes visits; `drawPlace(id)` (the description
  request through `withBackgroundProfile`, the render, the save, the
  commit) and the automatic draw after a fresh reply when the switch is on.
- `src/systems/features/questCut.js`: `startTravelCut({ place, when })`,
  the instruction by kind; `recordCompletedQuest(text)`,
  `getCompletedQuests()`.
- `src/systems/ui/shelfPages.js`: Complete records the quest.
- Settings → Image Generation: the Places group.

## 5. The window

`src/systems/ui/worldViews.js` (`mapWindowHtml`, the row, the strip, the
panels) and `src/systems/ui/worldDashboard.js` (the scroll, the selection,
Travel here, Draw, the panel buttons, the face popover's Show the place).
