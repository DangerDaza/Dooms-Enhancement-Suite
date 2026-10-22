# Scene pictures — Moss Studio in the chat (Project Short Fuse, Phase 7)

Status: **being built on `Project-Short-Fuse`** (2026-10-22). The owner's
ask: "every 5 turns or so an AI comes in and reads the last 10–15 messages
and makes a picture of it, with my current pipeline and my LoRAs." The
pipeline is **Moss Studio** (the owner's local web app in front of ComfyUI
for MOSS-Image, `http://127.0.0.1:8791`, documented in the owner's handover
note of 2026-10-22); its JSON API is what DES talks to.

## 1. Decisions

| # | Question | Decision |
|---|---|---|
| D60 | Where the picture lands | **In the chat, as a message from the narrator** (a name, default "Narrator", SillyTavern's default avatar). The message is a system message unless Settings → Scene pictures → "Captions reach the AI" is on: a picture is for the player, and a caption in the prompt would steer the story and cost tokens. The caption rides on the message (`extra.title`) and a line of it is the message text. |
| D61 | Who writes the caption | **DES's own background request**, on the tracker's connection profile through `withBackgroundProfile` (external mode respected), exactly as the tracker and Live World do. It sees the recent chat, which the studio's own prompt writer cannot. |
| D62 | How the picture is made | **Moss Studio's API, directly from the browser**: `POST /api/generate` with this chat's LoRAs, `GET /api/jobs` until the job is done, `GET /api/image?f=` for the file, which is saved into SillyTavern (`saveBase64AsFile`) so the chat keeps it when the studio is gone. The studio must answer with a CORS header (`Access-Control-Allow-Origin`), since the page is on another port. |
| D63 | LoRAs | **Per chat**: a list of `{name, strength}` in `chat_metadata.dooms_scene.loras`, picked from the studio's `/api/loras` or typed. Per character (a field on the Workshop card, the studio's identity blocks by character id) comes later. |
| D64 | When | **Every N of the player's turns** (default 5), counted on MESSAGE_SENT; the run starts after the reply that follows the Nth turn has finished generating, never inside a generation; a failed run tries again after the next turn; `/scene` runs one now. A chat's state is its own (`chat_metadata.dooms_scene`), like Live World's. |
| D65 | The caption's grammar | Natural language, 150–300 words, medium and framing first, then the finished picture; no character names (the image model knows none), the chat's identity notes carried into each character's look; one paragraph. A style preamble (the positive prefix) and a negative prompt live in settings with the handover's defaults. |

## 2. Shapes

**Settings** (`extensionSettings.scenePictures`, defaults in
`src/utils/scenePictures.js`): `enabled` (off), `studioUrl`, `card`
(`card1`|`card2`), `every`, `window` (messages read), `size`
(`portrait` 864×1536 | `square` 1024×1024 | `landscape` 1536×864), `steps`,
`cfg`, `sampler`, `scheduler`, `slg`, `enhancer`, `unet`/`clip`/`vae`
(empty: the studio's defaults), `narrator`, `toAI`, `preamble`,
`negative`, `guide` (extra caption rules), `timeoutSec`, `debug`.

**Per chat** (`chat_metadata.dooms_scene`): `{ v: 1, sinceLast, retryNext,
lastKey, loras: [{ name, strength }], identity: '', last: { at, ok,
caption, file, url, error } | null }`.

**The message**: `{ name: narrator, is_user: false, is_system: !toAI,
send_date, mes: a line of the caption, force_avatar: SillyTavern's default
avatar, extra: { image, title: caption, inline_image: false, dooms_scene:
{ caption, file, loras, at } } }`, pushed, MESSAGE_RECEIVED, rendered,
CHARACTER_MESSAGE_RENDERED, chat saved: the way SillyTavern's own image
extension posts. `extra.image` is the field every SillyTavern since 1.12
reads; 1.19 migrates it into `extra.media` on load.

## 3. The lifecycle

1. MESSAGE_SENT: the player's message is counted once (its key); when the
   count reaches `every`, the run is armed.
2. GENERATION_ENDED / GENERATION_STOPPED: an armed run starts (also when
   `retryNext` is set). Nothing runs while the main generation or another
   background request holds the flag: the run waits for the flag, then
   goes.
3. The caption: `buildCaptionPrompt` from the last `window` messages
   (system notes and tool records skipped, each cut to length), the
   characters present (the shelf), the chat's identity notes, the
   preamble and the extra rules; one background request; `parseCaptionReply`.
4. The picture: `buildGenerateBody` → `POST /api/generate` → the job id;
   `GET /api/jobs` every 2 s until `readJobs` says done or failed, or the
   timeout; `GET /api/image?f=<first image>` → blob → base64 →
   `saveBase64AsFile` under `user/images/<chat folder>`.
5. The message, the state (`afterPicture`), a toast when "Notify" is on.
   A run whose chat changed meanwhile is discarded whole (the token and
   metadata checks Live World uses).

## 4. The studio's API, as read from the handover

`GET /api/preflight?card=` (reachable, version, `moss_supported`, `busy`),
`GET /api/loras?card=`, `POST /api/generate` `{card, unet, clip, vae,
positive, negative, width, height, steps, cfg, sampler, scheduler, seed,
count, slg, slg_layers, slg_end, loras: [{name, strength}], enhancer,
enhancer_seed, title, character}` → a job, `GET /api/jobs`, `GET
/api/image?f=`.

**Assumptions to confirm on the first run** (the Test connection button
prints what comes back): the job's id field and the finished state in
`/api/jobs` (`readJobs` accepts `id`/`job_id`/`prompt_id`, a status of
`done`/`finished`/`complete`/`success`, images as paths or `{file|path}`),
and that the studio sends `Access-Control-Allow-Origin` for the
SillyTavern origin. Without the header the browser refuses the response
and the status line says so, with the fix.

## 5. Settings → Scene pictures (Beta)

The switch; Moss Studio URL and card; every N turns; messages read; size;
steps, CFG, sampler, scheduler, SLG, enhancer; narrator name; captions
reach the AI; style preamble; negative prompt; extra caption rules. For
this chat: LoRAs (one per line, `name:strength`, with a list fetched from
the studio to add from) and identity notes. A status line (this chat's
count, the last picture, the last error), Test connection and Picture
now.

## 6. Tests

`tools/scene-pictures-test.mjs` (the model, pure) and
`tools/scene-pictures-flow-test.mjs` (the lifecycle in the sandbox with
the caption and the studio behind injected transports).

## 7. Later

Per-character LoRAs and identity blocks from the studio (`/api/character?id=`)
on the Workshop card; the picture on the shelf as well; a narrator avatar
of DES's own; the studio's enhancer as a per-chat choice; a picture on
demand from a message's menu.
