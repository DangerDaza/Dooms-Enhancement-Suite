# DES Generation Relay — SillyTavern server plugin

Companion server plugin for **Doom's Enhancement Suite**. It fixes the oldest
phone complaint about SillyTavern: lock the screen (or lose the Cloudflare
tunnel for a moment) while a reply is generating and the reply is gone,
because the browser tab owned the request and the server aborted it the
moment the tab's connection dropped.

With the plugin installed, DES sends each Chat Completion generation to the
plugin instead. The plugin forwards it to SillyTavern's own backend over
loopback — every provider, key, proxy and prompt post-processing rule still
applies — and keeps the upstream connection open on the server. The tab reads
the reply from the plugin by byte offset, so a frozen tab simply resumes where
it left off, and a tab that was killed picks the finished reply up on the
next open. Finished replies are kept on disk for 24 hours until the client
confirms it has applied them.

The plugin **never writes chat files**. Putting a recovered reply into the
chat is done by DES in the browser.

## Install

1. Copy (or symlink) this folder's `des-relay` directory into SillyTavern's
   `plugins` folder so you end up with `<SillyTavern>/plugins/des-relay/index.mjs`:

   ```bash
   # from the SillyTavern root, with DES installed as a third-party extension
   cp -r public/scripts/extensions/third-party/Dooms-Enhancement-Suite/server-plugin/des-relay plugins/des-relay
   # or keep it in sync with the extension:
   ln -s ../public/scripts/extensions/third-party/Dooms-Enhancement-Suite/server-plugin/des-relay plugins/des-relay
   ```

   (If DES lives in `data/<user>/extensions/`, adjust the path.)

2. In SillyTavern's `config.yaml` set `enableServerPlugins: true`.
   Optionally set `enableServerPluginsAutoUpdate: false` — the auto-updater
   only looks at git checkouts in `plugins/`, so it ignores this folder either way.

3. Restart SillyTavern. The console prints `[DES Relay] ready (protocol 1, v1.0.0)`.

4. In DES: **Doom's Settings → Phone & Reliability → Re-check plugin**. The
   status line turns green when the handshake succeeds. The relay is on by
   default; nothing changes until the plugin is reachable.

Requirements: SillyTavern 1.12+ with server plugins (tested on 1.18), Node 20+,
a Chat Completion API. Text Completion backends are not relayed (yet).

## What you get

- **Lock the phone mid-reply** (installed PWA or a browser tab): the reply keeps
  streaming on the server. Unlock, and the stream resumes from where the tab
  stopped reading — the message fills in with no gap and no repeat.
- **Close the app or the tab dies**: on the next open of that chat, DES fetches
  the finished reply and adds it to the chat if the chat still looks like it
  did when you sent the message (a new reply, a regenerate, or a swipe). If the
  chat has changed since, the reply lands in **Recovered generations** instead,
  where it can be copied, put in the input box, added as a reply, or dismissed.
- **DES tracker requests** (separate mode) are recovered the same way and
  applied to the reply they belong to.
- **Other extensions' quiet prompts** (guided generations etc.) can't be
  replayed into the extension that asked, so their finished text goes to the
  tray.
- **Long non-streaming replies through Cloudflare** no longer hit the 100 s
  limit: the tab long-polls the plugin in 25 s slices instead of holding one
  request open.

## Configuration

Defaults are sensible; there is nothing to configure for normal use. Limits
live at the top of `index.mjs` (`DEFAULT_OPTIONS`): 15 minutes per generation,
8 MB per reply, 24 h retention, 200 jobs per user. Stored jobs are written to
`plugins/des-relay/data/<user>/` (or wherever `index.mjs` lives).

## Security notes

- Every route is mounted behind SillyTavern's own login, CSRF and whitelist
  middleware, and jobs are scoped to the logged-in user.
- The loopback request carries the caller's cookie, CSRF token, `Authorization`
  and `Host` headers, so basic auth, host whitelisting and multi-user setups
  behave exactly as for a direct request. `127.0.0.1` must be allowed by your
  `whitelist` (it is by default).
- Stored jobs contain the model's reply text (and, for streams, the raw
  provider events), never your API keys.

## Troubleshooting

- *Status says "plugin not installed (404)"*: `enableServerPlugins` is false,
  the folder is in the wrong place, or SillyTavern was not restarted.
- *Replies stop when the phone locks even with a green status*: check that the
  API is a Chat Completion source and that you are not in a group chat (not
  relayed in this version).
- *Console shows `loopback request failed`*: SillyTavern is listening on an
  address the plugin cannot reach from the same machine (e.g. IPv6-only with
  `enableIPv4: false`). The plugin connects to the address the request came in
  on; make sure that interface accepts local connections.
