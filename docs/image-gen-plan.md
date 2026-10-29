# Image Generation — one source for every picture DES makes

Status: being built on `Project-Short-Fuse` (2026-10-28). Owner's decisions
on 2026-10-27/28: the proper fix for portraits, and all of DES's image
generation on one new settings page, "Image Generation", where the user
sets up whatever image source they want, and that source fuels every
picture DES makes.

**Status (2026-10-28):** steps 1–5 built on `Project-Short-Fuse`, to ship in
the next beta. `tools/image-gen-test.mjs` and `tools/portrait-flow-test.mjs`
are in the gate; the parity rows are in `docs/parity-checklist.md` (Image
Generation, Present Characters Panel, Scene pictures).

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
| D79 | Migration, once, additive (2026-10-28) | `migrateImageGenSettings` fills `settings.imageGen` from the keys it replaces: the source is ComfyUI when scene pictures were on with a workflow, SillyTavern's otherwise; the portrait mode is the Auto Portrait Mode when Per-Character Expressions ran with Auto-generated portraits, else Only missing when Auto Avatars was on, else Off. Nothing reads the old keys from 3.2 on (the migration is their last reader); they stay in older settings files, harmless. Per-Character Expressions set to auto portraits is switched off by the same migration: that switch is about sprites alone now, and the portrait mode it carried lives on the page. |
| D89 | Portrait LoRAs (2026-10-29; the owner: "We also need to add the lora selection to the portraits"; asked where, chose per character plus a base list) | Workshop → Appearance gains **LoRAs for this character** (one per line, `name:strength`; `settings.characterLoras[name]`, carried by campaign versions and by a rename like the Portrait prompt), and Settings → Image Generation → Portraits gains **LoRAs for every portrait** (`settings.imageGen.portraits.loras`). On ComfyUI (direct) a portrait's render splices the character's list first, then the page's, a name in both once with the character's strength; SillyTavern's own extension takes none. Scene pictures keep their per-chat list. |
| D90 | The characters' LoRAs ride the scene picture (2026-10-29; the owner, on a Painter picture of two characters who looked nothing like their portraits: "We need to do something about character consistancy"; asked LoRAs, reference images or both, chose LoRAs) | A scene picture's LoRA list is the Workshop lists of the characters in the scene (the persona's too, when kept) ahead of the chat's own list, a name in both once. Text alone cannot hold a face; a LoRA per character can. Reference-image placeholders (`%portrait_N%`) are not built: they would need a workflow that takes reference images. |
| D91 | The player's card draws too (2026-10-29; the owner: "We also need to add the generate portrait button to the players character") | Regenerate Portrait and Restore Previous Portrait on the player's card (the YOU badge), and the Workshop's Portrait prompt, LoRAs for this character and Render portrait in user mode. Everything lands on the user card's own entry (`userCharacters[name]`: `avatar` and `avatarFullRes` both the new file, `appearance`, `loras`, `portraitHistory`), never in the NPC stores, so an NPC of the same name keeps their own portrait and history; the reference walk that guards file deletion covers the card's history, and deleting the card hands its banked files over. With the prompt field empty, the player's description (the user card's Injection description, else SillyTavern's persona description) is distilled into tags instead of the LLM prompt written from the chat's card and trackers, which describe everyone but the player. The user card's Portrait prompt is the persona's look in scene captions and its LoRAs ride the persona's scene pictures (D90). |
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
renderImage(req, { onProgress, stageOf })                         (the caller's bar: scene pictures')
sourceProblem() → '' | why the source cannot draw                  (the Workshop, the card menu, the rule)
```

Portraits save a data URL through the existing `persistPortrait` path into
`user/images/des-portraits`; scene pictures through `saveBase64AsFile` into
the character's folder, as before.

## 5. Steps

1. This document; `src/utils/imageGen.js` (sources, sizes, config,
   migration, `portraitPlan`, `renderValues`, `describeSource`);
   `tools/image-gen-test.mjs`; the state default; the migration hook in
   persistence. **Done.**
2. The service with both sources (`src/systems/features/imageGen.js`);
   the ComfyUI helpers in `src/utils/comfy.js`; scene pictures render
   through it; the scene config loses the connection keys; scene tests on
   the service's transport hook. **Done.**
3. Portraits unified on the service under D75–D77
   (`generateAutoPortraitsForCharacters(entries, text, onStarted, { fresh,
   recovery })` on `portraitPlan`; the Auto Avatars path and the
   whole-entry hash gone, pre-3.2 records adopted without a redraw); the
   recovery request never draws; Workshop and card Regenerate through the
   service, with the page's preamble, negative and size;
   `tools/portrait-flow-test.mjs`. **Done.**
4. The page (`data-accordion="imagegen"`: Source, status and Test; the
   ComfyUI (direct), Portraits and Scene pictures groups as rail tabs);
   `renderImageGenSettings` / `renderImageStatus` and the `rpg-img-*`
   binders in index.js; the Auto Avatars pill, Portrait Source and Auto
   Portrait Mode gone, Per-Character Expressions about sprites alone; the
   retired keys out of the defaults. **Done.**
5. Docs (this status, `docs/scene-pictures-plan.md` §2/§4/§5,
   `docs/phases-short-fuse.md` Phase 8, the handover's map), parity rows,
   CHANGELOG, What's new. **Done.**
