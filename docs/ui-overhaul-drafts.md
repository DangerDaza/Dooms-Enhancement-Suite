# UI Overhaul Drafts

Five candidate directions for a full visual overhaul of Doom's Enhancement
Suite. Each one was mocked up across the same surfaces so they compare
fairly: scene tracker, chat bubbles (two speakers plus the user), portrait
bar, Doom Counter, composer, and a slice of the settings panel.

Mockup canvas: https://claude.ai/artifact/N1FXvFdS5sxz3z7GFwSMSa

What all five change, regardless of pick:

- Gradient washes, glow box-shadows and the `translateX` hover slide go away.
- One type pairing per direction replaces the current mix of system sans,
  Roboto Mono, Consolas and Georgia.
- The 13 colour themes stop being 13 copies of the same structure. Each
  direction keeps a small set of true variants (2–4) plus the custom picker.
- Settings become a sidebar/tab layout instead of a single long accordion.

---

## 1 · Grimoire — tabletop ledger

**Thesis.** DES is a tabletop companion; make it look like the book on the
table. Ink ground, parchment text, gilt accents, hairline double rules,
zero glow.

| Token | Value |
|---|---|
| Ground | `#14100c` (panel `#1b150f`) |
| Text | `#e9dfc6`, muted `#a8956f` |
| Accent | gilt `#c9a24a`, highlight `#e3c070` |
| Rules | `#6b5436` outer, `#3a2d1e` inner (double hairline) |
| Display | Cinzel, uppercase, 0.14em tracking |
| Body | Cormorant Garamond 17–19px |
| Radius | 0 |

**Surfaces.** Scene tracker is a two-column ledger with italic labels.
Bubbles are prose with a small-caps nameplate and a rule; the first
paragraph of a turn gets a gilt drop cap. Portraits are framed miniatures
with a gilt diamond above the speaker. Doom Counter is an "Omen" hourglass
with roman numerals and ten diamond pips. Settings is a codex: roman-numeral
chapter index on the left, chapter content on the right.

**Cost: medium.** Pure CSS for chat surfaces. Settings needs the accordion
groups in `template.html` wrapped in a two-column shell. Themes collapse to
Ink, Vellum (light), and Oxblood.

---

## 2 · Ops Console — information-first HUD

**Thesis.** Treat the tracker as instrumentation. Monospace, 1px lines,
zero radius, bracketed section labels, amber and cyan on near-black.

| Token | Value |
|---|---|
| Ground | `#0b0f10`, panel `#0e1415`, header `#101818` |
| Text | `#cfe3d6`, muted `#6f8a7d` |
| Accent | amber `#f2b134`; status cyan `#52d1c2` |
| Lines | `#233029`, `#2d3d36` |
| Display + UI | JetBrains Mono |
| Prose | IBM Plex Sans 16px |
| Radius | 0 |

**Surfaces.** Scene tracker is a `key value` readout strip with a `[SCENE]`
header and a last-update stamp. Bubbles are a transcript: timestamp, speaker
tag in dialogue colour, prose. A dimmed `SYS` line shows tracker health.
Portraits are ID badges with a status dot. Doom Counter is a 10-segment bar.
Settings is a dense form with numbered sections and a setting count per
section.

**Cost: low.** Mostly token swaps plus flattening. The dense form maps 1:1
onto the current accordion markup. Themes: Amber, Cyan, Phosphor.

---

## 3 · Lumen — frosted modern OS

**Thesis.** Let the user's SillyTavern background show through. Translucent
panels, large radii, pill controls, presence rings. The most "app-like" and
the easiest sell to new users.

| Token | Value |
|---|---|
| Ground | `#0f1420` under the user's background |
| Glass | `rgba(255,255,255,.055)`, 1px `rgba(255,255,255,.1)`, `backdrop-filter: blur(18px)` |
| Text | `#f3f5f9`, muted `#8b93a7` |
| Accent | violet `#8b7cf6`; presence mint `#5ad8a4` |
| Type | Manrope 400/600/800 |
| Radius | 18–24px panels, 999px pills, 22px avatars |

**Surfaces.** Scene tracker is a glass card with a title line and a row of
icon chips, tension as a tinted chip. Bubbles are soft cards with a ringed
avatar; the user's bubble is violet-tinted and right-aligned. Portraits sit
in a glass dock with a mint presence ring and dot on the speaker. Doom
Counter is a ring gauge with the countdown in the centre. Settings is a
sidebar with icons plus grouped cards and a segmented control for position.

**Cost: medium-high.** `backdrop-filter` on every panel (watch perf mode and
mobile). Settings needs a real sidebar nav in `template.html`. Themes become
tint presets (Violet, Mint, Rose) over the user's wallpaper.

---

## 4 · Arcade — visual-novel HUD

**Thesis.** Lean into "Doom". Chamfered panels, diagonal cuts, condensed
display type, nameplates in the dialogue colour, a big tension numeral.

| Token | Value |
|---|---|
| Ground | `#0a0a0c` with 135° stripes `#131317`/`#0f0f12` |
| Panel | `#15151a`, border `#2a2a32` |
| Text | `#f4f4f4`, muted `#8a8a94` |
| Accent | red `#ff2e4d`, yellow `#ffd21f` |
| Display | Bebas Neue |
| Body | Barlow 500 |
| Shape | `clip-path` chamfers (14–22px), `skewX(-8deg)` plates |

**Surfaces.** Scene tracker is a white status ribbon with an angled end and
a red lead cell. Bubbles are VN textboxes: skewed nameplate filled with the
dialogue colour above a chamfered box with a matching left bar; action text
is dimmed italic. Portraits are cutouts with a skewed name tag and a yellow
outline on the speaker. Doom Counter is a red chamfered block with "DOOM IN"
and a huge numeral, tension shown as `03/10`. Settings uses skewed tabs.

**Cost: medium.** `clip-path` on panels and plates. Chat bubbles become
textboxes, the largest change to `chatBubbles.js` rendering. Themes: Red,
Yellow, Ice.

---

## 5 · Inked — graphic-novel paper

**Thesis.** The one light direction. Thick ink outlines, hard offset
shadows, halftone accents, speech bubbles with tails, yellow caption boxes.

| Token | Value |
|---|---|
| Ground | paper `#f4efe6`, settings `#ece5d6` |
| Ink | `#15130f`, 2.5px borders, `4px 4px 0` shadows |
| Caption | yellow `#ffe37a` |
| Accent | blue `#1d3fbf`; speaker reds/blues as tints |
| Display | Archivo Black |
| Body | Nunito 500/700 |
| Radius | 0 on panels, 22px on bubbles, 50% on heads |

**Surfaces.** Scene tracker is a row of "Meanwhile, at…" caption boxes.
Bubbles are white speech bubbles with ink tails; the user's is inverted
(ink fill, blue shadow). Portraits are comic panels with a halftone screen
and a blue frame on the speaker. Doom Counter is an SFX starburst with
"DOOM IN 4". Settings is a two-tone form inside one inked panel.

**Cost: medium.** Changes land hardest in chat bubbles and scene headers.
Needs a dark counterpart (ink paper, white lines) so night users keep a
choice. Themes: Paper, Night Ink, Pulp (cream + red).

---

## How to decide

- Want it done fastest: **2 · Ops Console**.
- Want the broadest appeal and the most modern feel: **3 · Lumen**.
- Want the strongest identity for the name "Doom": **4 · Arcade**.
- Want it to feel like a game table rather than an app: **1 · Grimoire**.
- Want something nobody else in the ST ecosystem has: **5 · Inked**.

Pick one, or pair a primary with one alternate theme, and the next step is
a token sheet in `style.css` plus the settings shell in `template.html`.
