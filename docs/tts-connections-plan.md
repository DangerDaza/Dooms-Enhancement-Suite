# DES Voices — more connection options (plan)

Status: **proposal**, nothing built yet. Branch: `TTS-Trial`. Builds on
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
   coverage for little code, but each provider needs testing (§6).
5. **Optional premium:** Hume (voice design from a description, generous free tier)
   and/or ElevenLabs, if users ask.

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

- **Describe it**: Google design (Google key); Hume design (Hume key); or the
  **cheap path** below.
- **Clone a recording**: Google (Google key); a local cloning server (stores the
  clip on that server); or OpenRouter models that clone per request (DES keeps the
  clip and sends it each time, costing more per line).

**Cheap "described" voices without voice design.** For Gemini via OpenRouter, a
described voice can be **a stock voice plus the description as a standing style
note**: "Kore, delivered as: an ancient, hollow voice…". No voice-design API, no
project lock-in, works with any OpenRouter key. It's weaker than true design, but
it's free to make and never expires. Spike needed (§6).

## 5. Milestones

| # | Milestone | Size |
|---|---|---|
| C0 | Spikes (§6), then lock decisions | S |
| C1 | Provider layer: refactor Google into a provider; `provider` on refs; stand-ins; tests | M |
| C2 | **OpenRouter**: key box + Test, model picker (Gemini Lite/Flash, Kokoro, others), voice lists, delivery note via `provider.options`, "Gemini voices via" | M |
| C3 | **Kokoro in the browser**: worker from ST's `kokoro-worker.js`, download and progress UI, voice list, device check (WebGPU/CPU) | M |
| C4 | **Local server (OpenAI-compatible)**: URL + optional key, model and voice lists (`/v1/models`, `/v1/audio/voices` where offered, else typed), presets for Kokoro-FastAPI / Chatterbox / AllTalk | S–M |
| C5 | Workshop **Library** tab with the provider switcher; Settings **Connections** list | M |
| C6 | **SillyTavern bridge** for the providers that pass the spike | M |
| C7 | Cheap described voices (style-note voices) and per-request cloning where supported | M |
| C8 | Optional Hume / ElevenLabs | M each |

The loudness work (even-out, per-character volume, master volume) slots in anywhere.
It's provider-independent and becomes more useful once voices come from several
providers.

## 6. Spikes (answer before building)

1. **OpenRouter from the browser**: does `POST /api/v1/audio/speech` allow CORS
   from a SillyTavern origin? If not, use SillyTavern's **OpenAI Compatible** route
   (`/api/openai/custom/generate-voice`, key kept on the ST server). That route drops
   `provider.options`, so no delivery note.
2. **OpenRouter + Google designed voices**: does `voice: 'voice_…'` work for a voice
   made in your own Google project? Expect **no** (voices are project-bound). If no,
   designed voices stay Google-direct only.
3. **Style-note voices** (§4.6): how consistent does "stock voice + description as
   style" sound across lines? Decide if it's good enough to offer.
4. **Kokoro in the browser**: model size and speed on a mid-range phone and on a
   desktop without WebGPU; whether ST's worker can be created from DES without
   touching ST's own TTS settings.
5. **SillyTavern bridge**: per provider, can DES create its own instance with the
   saved settings and call `generateTts(text, voiceId)` without SillyTavern's
   settings page side effects? (`loadSettings` binds to SillyTavern's settings DOM.)
   Start with ElevenLabs, OpenAI-compatible, AllTalk, XTTS and Edge.
6. **Rate limits in practice**: OpenRouter's Gemini TTS upstream may still throttle.
   Measure a 20-line auto-read.

## 7. Open questions for you

1. **Order**: OpenRouter first, then free Kokoro-in-browser? Or free first?
2. **Default for new users**: Kokoro in the browser (free, no account, lower
   quality) or "connect OpenRouter" (paid, Gemini quality)?
3. **SillyTavern bridge**: worth it, or is OpenRouter + local + Kokoro enough?
4. **Premium**: Hume (design from a description, generous free tier), ElevenLabs, both,
   or neither for now?
5. **Cheap described voices** (stock + style note): offer them as "Describe it" when
   there's no Google key, clearly labelled as lighter-weight?

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
