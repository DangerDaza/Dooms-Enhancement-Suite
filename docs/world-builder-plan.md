# The World Builder (Live World, third pass)

The owner (2026-10-29): "We need to rework the Live World. We can't have
everything tied to Skyreach or the other one. We need a way for people to
build their own." Until now a world was one of two JSON files shipped in
`worldpacks/` (Skyreach, the owner's placeholder draft, and Harbourside,
the example) or JSON pasted into Settings → Live World. The Map window
already records the places the story visits without the pack naming them
(D82); the clocks, the cast and the world's name still came from a file.

**Status (2026-10-29):** being built on `Project-Short-Fuse` in four
commits (the pure model, the feature, the window, the docs). Tests:
`tools/world-builder-test.mjs` (pure), the World Builder sections of
`tools/live-world-flow-test.mjs` (the feature in the sandbox),
`tools/world-builder-layout-test.mjs` (the window rendered). Parity rows:
`docs/parity-checklist.md`, Live World.

## 1. Decisions

The owner was asked four questions (how a world is built, what becomes of
the shipped worlds, what a new chat gets, where the builder opens from) and
took the recommended answer to each; they stand below and any of them is
his to change.

| # | Decision | What it means |
| --- | --- | --- |
| D92 | A world is the user's (the owner) | A world is a pack kept in `liveWorld.customPacks[id]` as the pasted packs were, made and edited in the World Builder, exported as a JSON file and imported back. Harbourside stays in `worldpacks/` as the one template ("Start from Harbourside" copies it under a new name). Skyreach leaves the extension: its file moves to `docs/support/skyreach-world.json` for the owner to import as a world of his own; nothing in the engine names it. |
| D93 | The blank world is the default | A new chat with Live World on and no world chosen seeds the blank world (`BLANK_PACK_ID`, no places, clocks or cast), named after the chat's character (`state.name`; the pack's name is the state's). It grows from play: the places the story names become the row (D82), the people who speak become known and are placed at the scene's place, named by the pack or not (a `loc:` id, the same key the row uses, read back as words). The advancer is told the pack's tree and then the places the story itself has named, and may move people to either. A pack may have no places or clocks: the builder warns, the engine plays it. |
| D94 | The builder is a window | `#world-builder-popup`, the Workshop's shell: a list of your worlds on the left (New, Start from Harbourside, Draft it from this chat, Import), the world on the right under four tabs: World (name, description, blurb, the narrator's template), Places (the tree: label, inside, picture), Clocks (label, place, start, max, step, hidden, a text per step), Cast (name, place, tier). Save stores the world under its id and reloads the open chat when it uses that world; Save as copy, Export (the JSON file, `<id>.json`), Delete (asks). The pack's own errors are listed as they are typed; a world with errors is not saved. |
| D95 | Draft it from this chat | One background request (the tracker's profile, `withBackgroundProfile`) writes a whole world from the character card (description, personality, scenario), the lore the chat carries (the active lorebooks' entries, cut to length), the names DES knows, and the recent scenes; the player is never cast. The reply's JSON is read like the advancer's (fenced, bare or whole, reasoning stripped), made loose where weak models slip (parents "null", numbers as strings, effects as a list), then `normalizePack`. The draft lands in the builder unsaved, with its errors and warnings; the user reads it before it is a world. |
| D96 | Make this a world | A chat on the blank world can become a world: `worldFromState` writes one from the chat as it stands (the places visited, a pack place with its ancestors and a story-named place as its own with its drawn picture; the clocks at their values now; the known people where they were last seen; the blurb) and opens it in the builder; Save sets the chat's `state.pack` to the new world's id, nothing re-seeded, and the world goes on as it was. |
| D97 | A chat and its world | A chat keeps the pack id it was seeded with. A world edited in the builder reaches every chat using it on its next load (the clocks clamped as before, a new clock at its start). A world that is gone (removed, or Skyreach after D92) leaves the chat on the blank world without clamping: the clocks and places stay in the state, the status line says the world is missing, the Map window still works, and importing the world back restores it whole. |
| D98 | Ways in | Settings → Live World: "World for new chats" lists the blank world, your worlds and Harbourside; "World Builder" opens the window; the paste box goes (Import lives in the builder). The Map window's foot gains "Edit this world" (a world of yours) or "Make this a world" (the blank world); Harbourside opens as "Start from Harbourside". The D menu stays as it is. |
| D99 | Rendered before pushed | `tools/world-builder-layout-test.mjs` renders the window with a fixture world at desktop and phone width under every look: nothing past the window, the list and the tabs reachable, the clock steps' grid inside its pane; `--shots` writes the PNGs, looked at before the push (handover §1). |

## 2. The pure model

`src/utils/liveWorld.js` (packs and state): `BLANK_PACK_ID`, `blankPack(name)`,
`normalizePack` without the "no places" error, `state.name`,
`seedWorldState(pack, { name })`, `locPlaceId` / `isLocId` / `locLabel` (the
row's key for a place the pack does not name, shared with the Map model),
`placeLabel` reading a loc id as words, `seenInScene` placing people at the
scene's place whether the pack names it or not, `resolveVisited`, the
advancer's places list (the tree, then the story's own places), a move to a
visited place validated and applied, `jsonObjectsIn` (the advancer's reply
reader, shared with the draft). Default pack: `blank`.

`src/utils/worldBuilder.js` (the builder's parts): `emptyWorld`,
`worldToRaw` (the file's shape from a pack), `worldSummary`, `packWarnings`,
`worldFromState` (D96), `buildWorldDraftPrompt` / `parseWorldDraft` (D95),
`worldFileName` / `worldToJson` (Export).

`src/utils/worldMap.js`: `placeKeyFor` keys a story-named place with the
shared `locPlaceId`; `rowIdForCharacter` finds a loc place's own row entry.

## 3. The feature (commit 2)

`src/systems/features/liveWorld.js`: `BUILTIN_PACKS = ['example']`,
`loadPack('blank')` needs no file; the blank world takes the chat's
character name when the state loads (and keeps it in `state.name`); a
missing world falls back to the blank world (D97); `listWorlds`,
`getWorldRaw`, `saveWorld`, `deleteWorld`; `draftWorldFromChat` (D95);
`worldFromThisChat` and `adoptWorld` (D96); the status line and the
`WORLD_CHANGED_EVENT` carry the world's name and whether it is missing.

## 4. The window (commit 3)

`src/systems/ui/worldBuilder.js`, the popup in `template.html`, the styles
in `style.css`; the Settings rows and the Map window's foot (D98); the
render check (D99).

## 5. Docs (commit 4)

`docs/live-world-spec.md` §1 (a world is the user's; the blank world),
`docs/parity-checklist.md`, `CHANGELOG.md` (Added, Changed, Removed:
Skyreach), `whatsnew.json`, `docs/handover-short-fuse.md` §4 and §5,
`docs/map-window-plan.md` D81.
