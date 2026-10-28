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
| D60 | Where the picture lands | **In the chat, as a message from the narrator** (a name, default "Narrator", SillyTavern's default avatar). The message is always a system message, hidden from the prompt (D71: neither the picture nor its caption reaches the AI). The caption rides on the message (`extra.title`) and a line of it is the message text. |
| D61 | Who writes the caption | **DES's own background request**, on the tracker's connection profile through `withBackgroundProfile` (external mode respected), exactly as the tracker and Live World do. It sees the recent chat, which the studio's own prompt writer cannot. |
| D62 | How the picture is made | **The owner's Moss workflow on ComfyUI, through SillyTavern's own ComfyUI endpoints** (`/api/sd/comfy/workflow`, `/generate`), the way its image extension renders: the workflow from SillyTavern's store with its placeholders filled, this chat's LoRA chain spliced in after the model loader, posted as `{"prompt": graph}`; the server queues it, waits on the history and returns the image, which DES saves into SillyTavern. Nothing but ComfyUI has to run and no header is needed. (Revised 2026-10-22: the first cut called Moss Studio's API from the browser, which needs a CORS header the owner would rather not add and waits on the studio's single-threaded server; the studio stays the owner's manual tool.) |
| D63 | LoRAs | **Per chat**: a list of `{name, strength}` in `chat_metadata.dooms_scene.loras`, picked from the studio's `/api/loras` or typed. Per character (a field on the Workshop card, the studio's identity blocks by character id) comes later. |
| D64 | When | **Every N of the player's turns** (default 5), counted on MESSAGE_SENT; the run starts after the reply that follows the Nth turn has finished generating, never inside a generation; a failed run tries again after the next turn; `/scene` runs one now. A chat's state is its own (`chat_metadata.dooms_scene`), like Live World's. |
| D65 | The caption's grammar | Natural language, 150–300 words, medium and framing first, then the finished picture; no character names (the image model knows none), the chat's identity notes carried into each character's look; one paragraph. A style preamble (the positive prefix) and a negative prompt live in settings with the handover's defaults. |
| D71 | Nothing of a picture reaches the AI (2026-10-23; the owner: "it started telling me that the size is over 64 MB and it won't accept it"; 2026-10-24: "I dont see a reason to send pictures or captions at all") | **The picture's message is always hidden from the prompt** (`is_system: true`). SillyTavern's "Send inline media" inlines every image in `extra.media` of every message it sends, so while "Captions reach the AI" made the message a narrator message each Moss picture (a megabyte or more as base64) rode every request, and a chat with a few dozen pictures passed the provider's size limit. Now the pixels never leave the chat. The first cut kept the switch and sent the latest caption's first line as one fixed line in its place; the owner saw no reason to send the caption either, so **the switch and the line are gone**: the AI gets nothing of a picture. Chats from before are repaired on load: a picture message that was a narrator message is hidden and the chat saved. D60 amended. |
| D72 | Regenerate with a picture after the reply (2026-10-24; the owner: "it doesnt remove the old message anymore it just makes a new one under it") | SillyTavern's `Generate('regenerate')` fires GENERATION_STARTED, *then* takes the chat's last message and deletes it unless it is the player's. With a scene picture after the reply, the picture was what it deleted; the old reply stayed and the new one landed under it (D68 had fixed only the dice card's own Regenerate button). **On GENERATION_STARTED with type `regenerate` (not a dry run) DES takes its trailing scene pictures down first** through SillyTavern's `deleteLastMessage` (the chat, the screen, MESSAGE_DELETED, awaited), saves, and says so in a toast; SillyTavern's deletion then hits the reply. Only DES's own pictures come down: anything else after the reply stays, as before. Group chats: SillyTavern's `regenerateGroup` stops at a system message and GENERATION_STARTED there is per member, so the Regenerate menu entry's click is caught in the capture phase instead; the keyboard shortcut's synthetic click is not covered. The handler is first in DES's GENERATION_STARTED list so nothing else there reads the picture as the last message. |

## 2. Shapes

**Settings** (`extensionSettings.scenePictures`, defaults in
`src/utils/scenePictures.js`): `enabled` (off), `every`, `window` (messages
read), `size` (`portrait` 864×1536 | `square` 1024×1024 | `landscape`
1536×864), `narrator`, `preamble`, `negative`, `guide` (extra caption
rules), `notify`, `debug`. The ComfyUI connection (`comfyUrl`, `workflow`,
`steps`, `cfg`, `sampler`, `scheduler`, `model`/`clip`/`vae`, `timeoutSec`)
was here until 2026-10-28; it is the image service's now
(`extensionSettings.imageGen.comfy`, `docs/image-gen-plan.md` D73–D78) and
the picture is rendered through `renderImage({ purpose: 'scene' })`, on
whichever source the Image Generation page names.

**Per chat** (`chat_metadata.dooms_scene`): `{ v: 1, sinceLast, retryNext,
lastKey, loras: [{ name, strength }], identity: '', last: { at, ok,
caption, file, url, error } | null }`.

**The message**: `{ name: narrator, is_user: false, is_system: true,
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
   characters present (the shelf), the identity notes, the preamble and
   the extra rules; one background request; `parseCaptionReply`. The
   identity notes are the chat's own notes followed by one "Name: look"
   line per character in the scene whose name the notes do not mention
   (`mergeIdentityNotes`): the persona (the Workshop's Appearance line,
   else the user card's appearance or description, else SillyTavern's
   persona description) and each character on the shelf (the Workshop's
   Appearance line, else the tracker's appearance this scene, else the
   character card's description for the chat's character). The first
   picture of the owner's test showed invented characters because the
   notes were empty and nothing else reached the caption writer.
4. The picture: the workflow's text from the store, `fillWorkflow` with
   `workflowValues`, `injectLoras` with this chat's list, `POST
   /api/sd/comfy/generate` (the server queues, waits and returns the image
   as base64) → `saveBase64AsFile` under `user/images/<character>`.
5. The message, the state (`afterPicture`), a toast when "Notify" is on.
   A run whose chat changed meanwhile is discarded whole (the token and
   metadata checks Live World uses).
6. The bar: a pill at the foot of the chat (`sceneProgress.js`, a DOM
   element, never a message) follows the run: waiting, writing the caption,
   ComfyUI's queue (how many ahead), the step count while it renders (the
   node named: loading the model, rendering, decoding), saving, done. The
   steps come over ComfyUI's WebSocket, opened by the page to the ComfyUI
   address with the client id the prompt carries, so ComfyUI sends this
   page its own render's events; without a WebSocket the bar stays
   indeterminate with the seconds elapsed.

## 4. The workflow and SillyTavern's ComfyUI endpoints

The owner's `ST_Moss_FAST_workflow.json` (the studio's graph in
SillyTavern's placeholder format) goes into SillyTavern's workflow store,
pasted on Settings → Image Generation, ComfyUI (direct) (saved through
`/api/sd/comfy/save-workflow`) or in Extensions → Image Generation → ComfyUI.
The filling and the splice live in `src/utils/comfy.js` since 2026-10-28. DES fills `%prompt%` (the preamble and the
caption), `%negative_prompt%`, `%seed%`, `%steps%`, `%scale%`, `%sampler%`,
`%scheduler%`, `%width%`, `%height%`, and `%model%`/`%clip%`/`%vae%` from
the Models fields when the workflow has them, exactly as the image
extension does (the quoted token becomes the JSON of the value, so numbers
stay numbers). `injectLoras` walks back from the sampler's `model` input to
the loader (`UNETLoader`, `CheckpointLoaderSimple`…) and splices a
`LoraLoaderModelOnly` per LoRA after it, in the chat's order, every former
consumer of the loader's model now fed by the last LoRA; a LoRA baked into
the workflow stays downstream. `.safetensors` is added to a LoRA name with no
extension. The server's `/api/sd/comfy/generate` takes `{ url, prompt }` and
answers `{ format, data }`; a ComfyUI validation error comes back as text
naming the node and the input, which the toast and the status carry.

**Confirmed on the first run:** the workflow's placeholders (Test connection
names any DES cannot fill), the LoRA file names (ComfyUI's "Value not in
list: lora_name" names a wrong one), and the ComfyUI address (card 2 on 8189).

## 5. Settings → Image Generation → Scene pictures (Beta)

A group on the Image Generation page (D78): the switch; a status line (this
chat's count, the last picture, the last error); Picture now; every N
turns; messages read; a toast; size; narrator name; style preamble;
negative prompt; extra caption rules. For this chat: LoRAs (one per line,
`name:strength`) and identity notes. The ComfyUI address, the workflow
(picked or pasted), steps, CFG, sampler, scheduler, the models and the
timeout are the page's ComfyUI (direct) group, shared with portraits; Test
is the page's.

## 6. Tests

`tools/scene-pictures-test.mjs` (the model, pure: the placeholders, the
LoRA splice, the result, re-exported from `src/utils/comfy.js`) and
`tools/scene-pictures-flow-test.mjs` (the lifecycle in the sandbox with the
caption behind the module's hook and SillyTavern's ComfyUI endpoints behind
the image service's).

## 7. Later

Per-character LoRAs and identity blocks (the studio's `/api/character?id=`,
or typed) on the Workshop card; the picture on the shelf as well; a narrator avatar
of DES's own; the studio's enhancer as a per-chat choice; a picture on
demand from a message's menu.
