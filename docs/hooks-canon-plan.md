# Quest hooks and Canon (two additions from the to-do list)

The owner (2026-11-02), on a list of five additions proposed for DES:
"make 3 and 5": Quest hooks from the world, and Canon, structured memory.
Built on `short-fuse/hooks-and-canon`, a branch off `Project-Short-Fuse`.

**Status (2026-11-02):** both built. Tests: `tools/quest-hooks-test.mjs`
and `tools/canon-test.mjs` (pure), `tools/map-flow-test.mjs` §7 and
`tools/canon-flow-test.mjs` (the features in the sandbox),
`tools/map-window-layout-test.mjs` (the Hooks panel rendered) and
`tools/settings-layout-test.mjs` (the Canon page). Parity rows:
`docs/parity-checklist.md`, Live World and Canon.

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

Structured memory. A ledger per chat of what the story has established,
kept by a quiet background request every N replies and told to the
narrator as one compact block each turn; browsable and editable on the
shelf's Canon page; exportable to a lorebook.

| # | Decision | What it means |
| --- | --- | --- |
| D105 | Off until switched on | Settings → Canon, a page of its own with a Beta badge, like Live World. On: a run every N counted replies (8 by default; a swipe or a regenerate is not a new reply) on the tracker's profile; a run that breaks a rule is retried on the next reply; a run that finds another background request on the line tries again a few seconds later. Nothing is ever written into the chat. |
| D106 | The ledger | Per chat in `chat_metadata.dooms_canon`: lines of six kinds (person, place, thing, fact, promise, secret), each a name and one line of text, stamped with the reply that established it and the tracker's date; up to 40 of a kind and 160 in all, the oldest unpinned going first. One line per kind and name: a change is the same name again, and replaces. |
| D107 | The request | The ledger so far by kind, the names the tracker knows, now, and the recent scenes (16 messages by default); the reply is strict JSON (`{"add":[{kind,name,text}],"drop":[name]}`, at most 8 adds and 4 drops), read like the advancer's and checked: only what the scenes establish, present tense, the player never an entry; an add over a pinned line is refused and said; a reply with nothing new is a sound run. |
| D108 | The block | While on and told to, one block rides every generation (raw `setExtensionPrompt`, never in the Context Inspector, never a quiet prompt): "[CANON — what the story has established. People: …; Places: …]", pinned lines first, then the newest, cut to the size set (1500 characters by default), at the depth and in the voice set (3, system). Fixed in size, overwritten, never appended. |
| D109 | The rewind | A reply deleted, regenerated or left on a branch takes back the lines stamped on it and its count; a pinned line stays whatever happens to its reply. A chat's ledger loads with the chat and follows it. |
| D110 | Your own lines | The shelf's Canon page (shown while Canon is on): the ledger by kind, each line editable in place, a pin, a remove, a row under each kind to add a line. A line you write, change or pin is yours: no run rewrites or drops it. Update now runs a pass at once (`/canon` too); Download writes the ledger as Markdown. |
| D111 | To a lorebook | Export writes the ledger into a lorebook named "Canon of <the chat's character>", one entry per line, keyed by its name (a fact or a promise by the words of its name too), titled "Canon · kind: name" so a later export rewrites its own entries and never doubles them. The book is made when it is not there; the user switches it on where they want it. |
| D112 | Files and tests | `src/utils/canon.js` (pure), `src/systems/features/canon.js` (the store, the count with its own stamp shared with Live World's when the reply has one, the run, the block, the rewind, `/canon`, the exports), the settings section and its binder in `index.js`, the shelf page in `shelfPages.js` with its registry in `portraitBar.js`; `tools/canon-test.mjs`, `tools/canon-flow-test.mjs`. |
