# Quest hooks and Canon (two additions from the to-do list)

The owner (2026-11-02), on a list of five additions proposed for DES:
"make 3 and 5": Quest hooks from the world, and Canon, structured memory.
Built on `short-fuse/hooks-and-canon`, a branch off `Project-Short-Fuse`.

**Status (2026-11-02):** Quest hooks built (the pure model, the feature,
the Map window's panel). Canon: being built. Tests:
`tools/quest-hooks-test.mjs` (pure), `tools/map-flow-test.mjs` §7 (the
feature in the sandbox), `tools/map-window-layout-test.mjs` (the panel
rendered). Parity rows: `docs/parity-checklist.md`, Live World.

## 1. Quest hooks

What the world offers to do next. A panel in the Map window asks, on
request, for up to three hooks grounded in what Live World shows the
player anyway; a hook taken is a quest on the shelf; a hook set aside is
not offered again.

| # | Decision | What it means |
| --- | --- | --- |
| D100 | On request, never on a cadence | Hooks come when the player presses Offer hooks (or Offer others) in the Map window's Hooks panel: one background request on the tracker's profile, like the advancer's. Nothing runs on a count, nothing is injected into the prompt: a hook is a thing the player may do, not a thing the world does. |
| D101 | Grounded in the public world | The request gives what the player could know: the clocks' current public effects (never a value), the blurb, the known people and where they were last seen, the heard-of names, the places visited (the latest first), the quests open, and a list of what not to offer again (the quests done, the hooks taken, the hooks set aside). The reply is JSON (`{"hooks":[{title, text, grounds, kind}]}`), read like the advancer's (fenced, bare or a single hook), and checked: a hook with no text, a repeat within the round, or a quest already open, done, taken or set aside is dropped; the round stands with what passes; a round with nothing usable is noted as a failure and the previous round stays on offer. |
| D102 | A hook taken is a quest | Take puts the hook's text on the shelf's Quests page as an optional quest, once (`addOptionalQuest`, the page's own write path: committed tracker data, settings, the chat, the sidebar, the shelf). Take and cut to it does the same and arms Cut to a quest with it, so the next reply montages the way there; the window closes as it does for Travel here. |
| D103 | Set aside is remembered | Not this one takes the hook off the round and keeps its title (the last 60) so it is not offered again. Taken hooks are kept too (the last 30), shown folded under the panel. |
| D104 | The panel and the store | A fifth panel, Hooks, between Rumours and People: the round as cards (title, text, "From: …", the three buttons), the ask button, the last failure, the taken folded. Kept per chat in `chat_metadata.dooms_hooks` (`proposed`, `taken`, `aside`, `last`, `seq`), the round tied to the newest reply's stamp. The pure parts are `src/utils/questHooks.js`; the feature `src/systems/features/questHooks.js` loads with the Map window. |

## 2. Canon

(Built next: D105 onward.)
