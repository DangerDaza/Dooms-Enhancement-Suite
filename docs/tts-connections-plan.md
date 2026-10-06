# DES Voices — more connection options (plan)

Status: **decided, not built** (decisions in §7). Branch: `TTS-Trial`. Builds on
`docs/google-tts-voices-plan.md` (the Google-only design that is built).
Researched 2026-10-06; prices and limits change, so re-check them before release.

## 1. The problem

Today DES voices talk to Google only, either through SillyTavern's saved key or a
key pasted into DES. Google's free and Tier 1 limits make that unusable for most
people:

- Tier 1: Gemini 3.8 TTS is capped at **10 requests/minute and 100 requests/day per
  model**. A single roleplay session can use that up in an hour.
- Tier 2 (about 1,000/min, 10,000/day) needs **$100 paid + 3 days** since the first
  payment. Prepaid credit is hard to get refunded. Most users won't do this.
- Designed and cloned voices live in one Google project. Switching projects to dodge
  limits makes them disappear.

What users actually want: **decent character voices for little or no money, with no
gatekeeping**, plus the per-character, in-scene-only behaviour DES already has.

## 2. The options

Cost per minute assumes ~900 characters (about 150 words) of speech per minute.
Gemini audio is ~25 tokens/second, so ~1,500 output tokens per minute.

| Option | Cost (≈ per minute of speech) | Setup | Voices | Make your own voice | Delivery note / style | Notes |
|---|---|---|---|---|---|---|
| **Google direct** (built) | ~$0.009 (Lite) – $0.014 (Flash), but Tier 1 caps | Google key | 30 Gemini | Design + clone (Google project) | Yes | The cap is the problem, not the price. |
| **OpenRouter** | Gemini 3.8 Lite ~$0.009, Flash ~$0.014; Kokoro ~$0.0006; Fish S2.1 Pro Free $0 | One OpenRouter key (many ST users already have one for chat) | Gemini 30, Kokoro 54, Orpheus, Fish, MiniMax, Qwen, Voxtral, MAI-Voice… (~25 models) | Clone-per-request on some models (`input_references`); Google designed voices **unknown** | Gemini: yes (`provider.options.speech_metadata.style`) | **No per-request caps on paid models** — just credits. Free models: 20/min, 50/day (1,000/day after $10 lifetime credits). |
| **Kokoro in the browser** | Free | None (≈ 80–300 MB model download once) | ~50 English-first voices | No | No | Runs on the user's device (WebGPU or CPU). SillyTavern already ships the worker (`extensions/tts/kokoro-worker.js`). Slow on weak phones. |
| **Local server** (Kokoro-FastAPI, Chatterbox, AllTalk/XTTS, GPT-SoVITS…) | Free (your GPU/CPU) | User installs and runs a server | Depends; cloning servers can use any clip | **Yes**: clone from a 10–30 s clip, unlimited | Some (Chatterbox exaggeration, etc.) | Best quality-per-dollar for people with a GPU. Most speak the OpenAI `/v1/audio/speech` format. |
| **SillyTavern's TTS providers** | Whatever that provider costs | Already set up in ST's TTS extension | Whatever the provider has | Whatever the provider has | No | ~25 providers (ElevenLabs, Edge, AllTalk, XTTS, Kokoro, OpenAI, MiniMax, Azure, Novel…). DES reuses the user's existing setup but keeps its own per-character voices and scene rule. |
| **ElevenLabs** | ~$0.05–0.09 (paid); free 10k chars/month | ElevenLabs key | Huge library | Design + instant clone (paid for commercial) | Limited | Best known, most expensive. |
| **Hume Octave** | Free 10k chars/month (~10 min); $3/mo for 30k | Hume key | Library + **unlimited custom voices on free** | Design from a description | Yes (acting instructions) | Voice design from text is its strength. |
| **OpenAI** (gpt-4o-mini-tts) | ~$0.015 | OpenAI key | ~11 voices | No | Yes (`instructions`) | Also reachable through OpenRouter. |

## 3. Recommendation

Ship in this order; each step stands on its own.

1. **OpenRouter** — the direct answer to "no $100". Same Gemini 3.8 voices,
   pay-as-you-go, no tier gate, ~1¢ a minute, and one integration unlocks Kokoro
   (nearly free) and ~25 other models. Many ST users already have a key.
2. **Free, no account: Kokoro in the browser.** The "just works for $0" default for
   people who won't pay anything. Quality is decent, and it's private.
3. **Local server (OpenAI-compatible).** One provider covers Kokoro-FastAPI,
   Chatterbox, AllTalk and most others. Unlimited and free for people with a GPU,
   and the route to unlimited cloned voices.
4. **SillyTavern bridge.** Reuse whatever TTS provider the user already set up in
   SillyTavern (ElevenLabs, Edge, XTTS…), with DES's per-character voices. Wide
   coverage for little code; only providers on an allow-list (§6.1).
5. **ElevenLabs** (decided): huge library, voice design and instant cloning; the
   most expensive option.

Not planned for now (decided): Hume, and "cheap described voices" (§4.6).

Google direct stays as an option for people who already have Tier 2 or want
Google's designed and cloned voices.

## 4. How it fits DES (architecture)

### 4.1 Providers

A provider is a small module with one shape:

```js
{
  id: 'openrouter' | 'google' | 'kokoro-web' | 'local' | 'st-bridge' | 'hume' | ...,
  label, needsKey, caps: { style, design, clone, customVoices, speed },
  isReady(): Promise<{ok, reason}>,
  listVoices(): Promise<Voice[]>,        // {id, label, gender?, lang?, model?, sample?}
  synthesize({ text, voice, style, signal }): Promise<Blob>,
}
```

`transport.js` becomes the Google provider. `player.js`, the segmenter, presence,
the scene rule, the delivery note and auto-read stay exactly as they are; only
"turn this line into audio" changes.

### 4.2 Voice references

Today's ref is `{source: 'stock'|'designed'|'cloned', id, fallbackStock?}`. It gains
a provider:

```js
{ provider: 'openrouter', model: 'google/gemini-3.8-flash-lite-tts', id: 'Kore' }
{ provider: 'kokoro-web', id: 'af_heart' }
{ provider: 'google', source: 'designed', id: 'voice_abc', fallbackStock: 'Kore' }   // existing refs = provider 'google'
```

Characters can mix providers: the Narrator on Kokoro (free), Mara on Gemini via
OpenRouter. Missing `provider` means `'google'`, so nothing saved today breaks.

### 4.3 When a voice's provider isn't available

If a character's provider isn't set up on this device (no key, local server off),
DES uses a **stand-in voice** instead of going silent: the same gender from the
user's default provider, then the Narrator. It shows the existing "voice not
available here" note. This generalises today's `fallbackStock`.

**No connection at all** (decided): DES doesn't ship a default provider. Until the
user connects one, voices stay off. The Voices settings and the Workshop Voice tab
show a short "Connect a voice service" panel listing the options with one-line
costs (OpenRouter, Google, Kokoro in the browser, local server, ElevenLabs,
SillyTavern's TTS), and the bullhorns keep using SillyTavern's own TTS.

### 4.4 Same Gemini voice, two connections

Stock Gemini voices (Kore, Charon…) are the same on Google and OpenRouter. A
**"Gemini voices via"** setting (Google key · OpenRouter · SillyTavern's Google key)
routes all stock-Gemini refs, so users switch connection without re-picking 30
character voices.

### 4.5 Settings → Voices

A **Connections** list replaces the single key box: each provider row has status,
key or URL, **Test**, and on/off. Then **Default provider** (used for new picks and
stand-ins) and the existing Narrator, delivery note and model settings. Keys follow
today's model: stored in DES settings, and SillyTavern's saved key is used where a
server route exists.

### 4.6 Workshop → Voice tab

**Standard** becomes **Library**, with a provider switcher at the top (Gemini ·
Kokoro · Local · …) and the same All/Female/Male filter and grid. **My voices** and
**Create new** stay. Create new offers only what the connected providers can do:

- **Describe it**: Google design (Google key) or ElevenLabs Voice Design
  (ElevenLabs key).
- **Clone a recording**: Google (Google key); ElevenLabs instant clone; a local
  cloning server (stores the clip on that server); or OpenRouter models that clone
  per request (DES keeps the clip and sends it each time, costing more per line).

*Not planned (decided):* "cheap described voices" (a stock voice plus the
description as a standing style note) for users without Google voice design.

## 5. Milestones

| # | Milestone | Size |
|---|---|---|
| C1 | Provider layer + the user-facing guide (§6.2): refactor Google into a provider; `provider` on refs; stand-ins; "Connect a voice service" panel when nothing is connected; tests | M |
| C2 | **OpenRouter**: key box + Test, model picker (Gemini Lite/Flash, Kokoro, others), voice lists, delivery note via `provider.options`, "Gemini voices via" | M |
| C3 | **Kokoro in the browser**: worker from ST's `kokoro-worker.js`, download and progress UI, voice list, device check (WebGPU/CPU) | M |
| C4 | **Local server (OpenAI-compatible)**: URL + optional key, model and voice lists (`/v1/models`, `/v1/audio/voices` where offered, else typed), presets for Kokoro-FastAPI / Chatterbox / AllTalk | S–M |
| C5 | Workshop **Library** tab with the provider switcher; Settings **Connections** list | M |
| C6 | **SillyTavern bridge** for the allow-listed providers (§6.1) | M |
| C7 | **ElevenLabs**: key, library, Voice Design, instant clone | M |
| C8 | Per-request cloning on OpenRouter models that support it | S–M |

The loudness work (even-out, per-character volume, master volume) slots in anywhere.
It's provider-independent and becomes more useful once voices come from several
providers.

## 6. No pre-testing: plan for the worst, say so up front

Decision (2026-10-06): no spikes and no manual testing before release. Each open
question is answered with its **worst case**, and DES is built so the worst case
still works, or at least fails clearly. DES tells users plainly how voices are meant
to be used, and they report anything that's broken or disappointing.

### 6.1 Worst-case assumptions and how DES handles each

| Unknown | Assume | Built so that… |
|---|---|---|
| OpenRouter blocks speech calls from the browser (CORS) | **Blocked** | DES tries the browser call once. If it fails with a network/CORS error, it switches to SillyTavern's **OpenAI Compatible** server route (`/api/openai/custom/generate-voice`) for the session. That needs the OpenRouter key saved in SillyTavern's *OpenAI Compatible* TTS key slot, and DES offers a button that saves it there (it warns first if a different key is already saved). On that route the delivery note can't be sent; the status line says so. |
| Google designed/cloned voices through OpenRouter | **Don't work** | Designed and cloned Google voices are **Google-key only**, stated in the UI. Characters with one use their stand-in (same-gender stock voice) when only OpenRouter is connected. |
| OpenRouter's upstream still throttles Gemini TTS | **Throttles sometimes** | Existing backoff (2/4/8 s), the "line skipped" message and the session budget apply to every provider. The status line names the provider. |
| Kokoro in the browser on phones | **Too slow / too big on most phones** | Labelled "best on a computer". DES checks the device first (WebGPU, memory) and warns before the download. The download shows progress, can be cancelled, and is never started automatically. |
| Kokoro worker from SillyTavern can't be reused | **Can't** | DES ships its own small worker that loads the same open model from the same CDN SillyTavern uses. No dependency on SillyTavern's TTS settings. |
| SillyTavern bridge per provider | **Only some providers work** | Ship an allow-list of providers whose `generateTts` needs no settings-page DOM (start: OpenAI-compatible, ElevenLabs, AllTalk, XTTS, Edge). Others are listed as "not supported yet", never half-working. |
| Local servers differ (voice lists, formats) | **No voice list, odd formats** | If `/v1/audio/voices` or a voice list isn't offered, the user types voice names. Any audio type the browser can play is accepted. Presets fill the URL and model for known servers. |
| Per-request cloning on OpenRouter models | **Unreliable** | Marked *experimental* in the UI (C8), off unless chosen per voice. |
| Provider prices/limits change | **They will** | The UI shows approximate costs as "about", with a link to the provider's pricing page, and no numbers are hard-coded into logic. |

General rule: any provider error becomes a plain one-line message naming the
provider and what to check (key, credits, server running). The line is skipped, never
retried in a loop, and the console keeps the full error for bug reports.

### 6.2 Telling users how it's meant to be used

Shown in three places: a **"How DES voices work"** panel at the top of Settings →
Voices (collapsible, open until first dismissed), the What's New entry, and the
README. Draft text:

> **How DES voices work**
> DES reads your chat aloud and gives each character their own voice, but only while they're on the Present Characters panel. Everyone else is read by the Narrator.
>
> **You bring the voice service.** DES doesn't include one. Connect at least one:
> - **OpenRouter**: recommended. Gemini voices and many others, pay as you go (about a cent a minute for Gemini), with no daily caps. One key from openrouter.ai.
> - **Google**: the same Gemini voices, and the only way to *design* or *clone* voices from text or a recording. Google's free and Tier 1 limits are low (about 100 lines a day). Higher limits need $100 spent with Google.
> - **Kokoro (in your browser)**: free, private, no account. Best on a computer; phones may be slow.
> - **Your own server**: Kokoro-FastAPI, Chatterbox, AllTalk and others. Free and unlimited if you have the hardware.
> - **ElevenLabs** or **SillyTavern's TTS setup**: if you already use them.
>
> **Good to know**
> - Designed and cloned voices only work with a Google key, in the same Google project you made them in.
> - Each line costs one request. Auto-read uses more than the bullhorn buttons.
> - Voices are an early feature. If something sounds wrong or breaks, tell us what you were doing and which service you use.

The Workshop's Voice tab shows a one-line version when nothing is connected:
"No voice service connected. Settings → Voices explains the options."

## 7. Decisions (2026-10-06)

1. **Order**: OpenRouter first (C1 → C2). Kokoro in the browser and the local server
   follow; the SillyTavern bridge and ElevenLabs come after.
2. **Default for new users**: no default provider. Users connect a service before
   DES voices play (§4.3 "No connection at all").
3. **SillyTavern bridge**: yes (C6).
4. **Premium**: ElevenLabs yes (C7); Hume not planned.
5. **Cheap described voices**: not planned.
6. **No pre-testing**: build for the worst case (§6.1) and tell users up front how
   voices are meant to be used (§6.2). Fix things as users report them.

## 8. Sources

- OpenRouter Gemini 3.8 Flash TTS: https://openrouter.ai/google/gemini-3.8-flash-tts
- OpenRouter TTS models and prices: https://openrouter.ai/collections/text-to-speech-models
- OpenRouter TTS guide (parameters, `provider.options`, `input_references`): https://openrouter.ai/docs/guides/overview/multimodal/tts
- OpenRouter rate limits: https://openrouter.ai/docs/api/reference/limits
- Google Gemini API rate limits and tiers: https://ai.google.dev/gemini-api/docs/rate-limits
- ElevenLabs pricing overview (2026): https://developer.puter.com/tutorials/elevenlabs-api-pricing/
- Hume TTS: https://dev.hume.ai/docs/text-to-speech-tts/faq and https://getcoai.com/news/hume-debuts-new-text-to-speech-model-with-customizable-emotions
- OpenAI gpt-4o-mini-tts pricing: https://www.llmreference.com/model/gpt-4o-mini-tts
- SillyTavern TTS extension (providers, OpenAI Compatible route, Kokoro worker): `public/scripts/extensions/tts/` and `src/endpoints/openai.js` in SillyTavern (checked against the 2026-09-14 release branch)
