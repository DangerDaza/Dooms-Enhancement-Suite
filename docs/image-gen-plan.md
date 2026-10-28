# Image Generation — one source for every picture DES makes

Status: being built on `Project-Short-Fuse` (2026-10-28). Owner's decisions
on 2026-10-27/28: the proper fix for portraits, and all of DES's image
generation on one new settings page, "Image Generation", where the user
sets up whatever image source they want, and that source fuels every
picture DES makes.

## 1. Why

Two features made pictures, each its own way:

- **Portraits** (`src/systems/features/avatarGenerator.js`): two
  generators, both through SillyTavern's `/sd` command (the Image
  Generation extension, whatever source it is set to). "Auto Avatars" (a
  pill in the Features row) was only ever called from the separate tracker
  request, so in together mode it fired on Refresh and on the recovery
  after a skipped block, never in play. "Per-Character Expressions" with
  Portrait Source "Auto-generated portraits" fired after every reply, in
  every mode, but hid behind a switch named for expression sprites. The
  owner had the first on and the second off, and on 2026-10-27 a recovery
  rendered a picture for every character through the Moss workflow he had
  set SillyTavern's extension to for scene pictures.
- **Scene pictures** (`src/systems/features/scenePictures.js`): their own
  ComfyUI client (SillyTavern's `/api/sd/comfy/*` endpoints, a workflow
  from SillyTavern's store, placeholders filled, LoRAs spliced), with the
  connection in their own settings section.

## 2. Decisions

| # | Decision | Detail |
|---|---|---|
| D73 | One image service, two sources (2026-10-28, the owner) | `src/systems/features/imageGen.js` renders every picture: `renderImage({ purpose, prompt, negative, size, loras, seed })`. Sources in the first cut: **SillyTavern's Image Generation** (the `/sd` command, quiet; size and sampler follow the extension's own settings) and **ComfyUI (direct)** (the client moved out of scene pictures: a card reached through SillyTavern's server, a workflow from its store, placeholders filled from `renderValues`, this chat's LoRAs spliced). More sources later behind the same call. |
| D74 | One source, per-purpose shape (2026-10-28, the owner) | Portraits and scene pictures share the source. Each keeps its own size preset, style preamble and negative prompt. |
| D75 | One portrait rule, the same in every tracker mode (2026-10-28, the owner) | Settings → Image Generation → Portraits: **Off / Only missing / State changed / Every reply**. It runs after each fresh reply in together, separate and external modes alike (`portraitPlan` in `src/utils/imageGen.js`). The Auto Avatars pill and the Portrait Source entry go; Per-Character Expressions is about expression sprites only. |
| D76 | Never from a recovery (2026-10-28) | The separate request that fetches a skipped tracker block is a repair, not a moment to draw. `portraitPlan` returns nothing when `recovery` is set, and the service is not called from that path. A manual Refresh counts as a fresh reply. |
| D77 | A toast when portraits are made (2026-10-28) | Behind "Say so" on the page, on by default: the first run in a session names the characters and the source, and where the switch is. Never silent again. |
| D78 | The scene section moves (2026-10-28, the owner) | Scene pictures' cadence, window, size, narrator, preamble, negative, guide, Picture now, and this chat's LoRAs and identity notes become a group on the Image Generation page. Their ComfyUI connection becomes the page's ComfyUI source. `settings.scenePictures` keeps the cadence and shape keys; the connection keys are read from `settings.imageGen.comfy`. |
| D79 | Migration, once, additive (2026-10-28) | `migrateImageGenSettings` fills `settings.imageGen` from the keys it replaces: the source is ComfyUI when scene pictures were on with a workflow, SillyTavern's otherwise; the portrait mode is the Auto Portrait Mode when Per-Character Expressions ran with Auto-generated portraits, else Only missing when Auto Avatars was on, else Off. The old keys stay until nothing reads them, then go. |
| D80 | What a portrait never replaces (unchanged) | A portrait the user set (no DES-made record behind it) is never replaced; a SillyTavern card that already gives a face needs none; one being made is not asked for again. |

## 3. The settings page

`data-accordion="imagegen"`, "Image Generation", with a Beta badge while the
source choice is new:

1. **Source**: SillyTavern's Image Generation | ComfyUI (direct). A status
   line (`describeSource`) and **Test**.
2. **ComfyUI (direct)** (shown for that source): address, workflow (picked
   from the store, or pasted and saved), steps, CFG, sampler, scheduler, the
   models for `%model%`, `%clip%`, `%vae%`, timeout.
3. **SillyTavern's Image Generation** (shown for that source): a note that
   Extensions → Image Generation decides the engine, size and sampler.
4. **Portraits**: mode, size, style preamble, negative prompt, Say so.
5. **Scene pictures**: the switch, every N turns, messages read, a toast,
   size, narrator's name, style preamble, negative prompt, extra caption
   rules, Picture now; this chat's LoRAs and identity notes.

Gone: the Auto Avatars pill; Portrait Source and Auto Portrait Mode under
Present Characters; the Scene pictures section.

## 4. The service

```
renderImage({ purpose: 'portrait' | 'scene', prompt, negative, size, loras, seed, timeoutMs })
  → { url } (SillyTavern's source: the extension saved the file)
  | { dataUrl } (ComfyUI: the caller saves it where it belongs)
testSource() → { ok, line, workflows?, ping? }
listWorkflows(), loadWorkflow(name), saveWorkflow(name, text)   (ComfyUI)
getImageProgress(), IMAGE_PROGRESS_EVENT                          (the bar)
```

Portraits save a data URL through the existing `persistPortrait` path into
`user/images/des-portraits`; scene pictures through `saveBase64AsFile` into
the character's folder, as before.

## 5. Steps

1. This document; `src/utils/imageGen.js` (sources, sizes, config,
   migration, `portraitPlan`, `renderValues`, `describeSource`);
   `tools/image-gen-test.mjs`; the state default; the migration hook in
   persistence. **Done.**
2. The service with both sources; scene pictures render through it; the
   scene config loses the connection keys; scene tests on the service's
   transport hook.
3. Portraits unified on the service under D75–D77; the recovery path no
   longer draws; Workshop and card Regenerate through the service.
4. The page: template, renderers and binders, the old controls removed,
   styles.
5. Docs, parity rows, CHANGELOG.
