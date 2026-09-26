# Per-Character Voices (Gemini 3.8 TTS) — Implementation Plan

**What you get:** give every character in the Character Workshop their own voice (one of
Google's 30 standard voices, one from Google's larger voice library, one you describe in words,
or a clone of a real voice recorded with consent). When DES reads a message aloud, each line is
spoken in the voice of whoever said it, as long as that character is on the Present Characters
panel. Narration, and lines from anyone who isn't in the scene or has no voice, are read by a
Narrator voice you choose. New messages can be read automatically, the existing bullhorn buttons
use the same voices, and SillyTavern's own auto-read is paused while DES voices are on so nothing
plays twice. Voices follow campaign versions the same way portraits do.

> **Evidence tags.** **[V]** = verified: the file was opened at that line, the Google page was
> read (fetched 2026-09-26, pages say "Last updated 2026-09-24"), or a live unauthenticated probe
> was made. **[I]** = inference. **[U]** = unknown — do not build on it until M0 settles it.
> No call to Google was made with an API key, so *every* claim about how Gemini 3.8 behaves at
> runtime is documentation-only.
>
> **Line numbers.** DES at `10ad241` (v2.6.0). SillyTavern ("ST") lines refer to a sparse clone of
> `main` at `06bde939` (2026-09-14) and are written `st/…`.
>
> **Where this came from.** Four research maps (Workshop data, speakers/presence, ST TTS
> integration, Gemini 3.8 API), two competing designs, and an adversarial review. The review picked
> the *incremental* design as the spine; this document is that spine with the review's fixes
> applied and the best parts of the second design grafted on. §1 records what was decided and why.

---

## Implementation status (branch `TTS-Trial`)

**M1 and M2 are built**: DES voices with the Narrator voice, auto-read, SillyTavern's auto-read
paused by the guard, per-character standard voices in the Workshop Voice tab, the Present Characters
scene rule, and campaign-versioned voices. **M0 has not been run** (no Google key in the build
environment), so nothing has been tested against Google itself; the SillyTavern route was exercised in
a real SillyTavern with Google's endpoint stubbed. M3–M7 are not started.

Where the build differs from this plan:

| Plan | Built | Why |
|---|---|---|
| `voiceSettings.js` lazy | Eager (pure, ~100 lines, no imports) | `state.js` takes its defaults and `persistence.js` repairs settings at load. |
| Separate `capabilityProbe.js` with a "Ready." request | Folded into `transport.js`: the first real line is the probe | Saves a request; same downgrade rule (only a model/argument error drops to 3.1; result in `sessionStorage`, 6 h). |
| `data-tts-idx` stamped on bubbles | Bubble index = DOM order among the message's bubbles, resolved at play time | No change to bubble markup; highlights still survive the +800 ms rebuild. |
| Segments merged by `(speaker, kind)` | Also merged when neighbours resolve to the **same voice** | Narration → unvoiced character → narration becomes one request instead of three. |
| Presence: own tracker → walk back → live tracker | Own tracker → live tracker (newest AI message only) → walk back | Walking back first would use the *previous* scene for the newest reply in separate mode. |
| Narrator picker popup | A dropdown of the 30 standard voices + ▶ | Only standard voices exist until M3. |
| Several `tools/voice-*-test.mjs` | One `tools/voice-logic-test.mjs` + `tools/lazy-graph-test.mjs` | Same coverage. |
| Icons-only tabs "shorten labels" | Breakpoint moved from ≤1000px to ≤1080px, tab font 0.8rem | Labels were already one word; six fit once the modal reaches its 1000px cap. |
| `.mes_narrate` intercept (optional) | Not built | DES's own message bullhorn covers it. |

## 0. What already exists (read this first)

| Thing | Where | Relevance |
|---|---|---|
| Bubble bullhorn "read from here", thought bullhorn, reasoning bullhorn | `chatBubbles.js:1528-1623` (`initBubbleTtsHandlers`), `:1631-1649` (`injectReasoningTtsButtons`), thought button markup `thoughts.js:1609` (its click handler is `chatBubbles.js:1566-1592`) | All three call ST's `/speak ${text}` (`:1557, :1587, :1617`), so **every bubble is read in the card's voice, not the speaker's** — `/speak` with no `voice=` uses `name2` (`st/…/tts/index.js:183`). The text is unescaped: a `|` in dialogue splits the command. [V] |
| Speaker attribution | `chatBubbles.js:510` `parseMessageIntoBubbles`, `:797` `detectSpeaker`, `:372` `buildColorToSpeakerMap` | Module-private. Works from `<font color>` tags. Reused, not rewritten (§7). [V] |
| `isLatest` bug | `chatBubbles.js:528-533` | `closest('.mes')` (`:529`) on the detached containers built at `:1156` and `:1301` (parsed at `:1243, :1279, :1303`), so the "latest message" elimination step never runs at render. Fixed as part of the refactor. [V] |
| Highlight classes | `chatBubbles.js:1545-1613` | `.tts-speaking` / `.dooms-bubble-tts-speaking` are added but never removed when playback ends. [V] |
| TTS regex auto-config | `index.js:3105-3118` in `onChatChangedTtsCleanup` (`:3046-3119`) | Uses the wrong selector `#tts_regex` (ST's is `#tts_apply_regex`, `st/…/tts/index.js:892`) and overwrites any user `regex_pattern` that doesn't contain "font" (`:3111-3115`). [V] |
| Versioned character fields | `campaignProfiles.js:38-47` `PROFILE_FIELDS` | Adding one entry gets snapshot/apply/bank/switch/clone/merge for free (§4.1). [V] |
| API-key-in-browser precedent | `index.js:1921-1923, 2147-2148`, `apiClient.js:49, 113` | `localStorage['dooms_tracker_external_api_key']`, never in settings. [V] |
| ST's Google TTS route | `st/src/endpoints/google.js:356-430` `/generate-native-tts` | Body `{text, voice, model}`; sends `speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName` + `safetySettings` (`:363-378`; ST's `GEMINI_SAFETY`, all five categories at `OFF`, `st/src/constants.js:141-162`). `model` is passed through unvalidated (`:358`, `:225`). No style, no custom voice field, no streaming. [V] |
| ST's voice list | `st/src/endpoints/google.js:313-354` `/list-native-voices` | Hard-coded 30 names; misspells "Callirhoe" (Google: "Callirrhoe"). Google is never called. [V] |

---

## 1. Decisions

### 1.1 User decisions (fixed)

1. **API access is hybrid.** By default DES uses the Google AI Studio key already saved in
   SillyTavern; the key stays on the ST server and requests go through ST's server. That route
   probably limits you to the 30 standard voices. An **optional** Google key entered in DES
   settings unlocks the extended voice library, voice design, voice cloning and streaming.
2. **All four voice sources** are offered in the Workshop: the 30 standard voices; the Extended
   Voice Library; Voice Design (describe a voice in words — DES can draft the description from the
   character card — which creates a reusable custom voice); Voice Cloning (a 30-second sample plus
   Google's required consent recording).
3. **Scene rule:** a character's voice is used only while that character is on the Present
   Characters panel.
4. **Fallback:** a Narrator voice (chosen in DES settings; it may itself be a designed voice) reads
   narration **and** any line from a character who isn't present or has no voice.
5. **Campaign versions:** the voice is stored per campaign version, like the portrait; the "+"
   tile clones Base's voice; it can differ per campaign.
6. **Playback:** an auto-read toggle (new AI messages are read automatically) plus the existing
   bullhorns (bubble "read from here", inline thought, reasoning panel) all use the per-character
   voices. When DES voices are active, DES stops SillyTavern's own TTS auto-read so nothing plays
   twice.

### 1.2 Design decisions made in this plan

| # | Decision | Why |
|---|---|---|
| D1 | **Explain decision 1 honestly in the UI.** Google does not restrict the library, design or cloning to a special key; the user's existing AI Studio key should do all of it [V docs: every Voices/design/replication example uses only `x-goog-api-key`; not live-tested, and replication may be region-limited, §15 #10]. What's missing is a *route* on ST's server. The settings text says "paste a Google AI Studio key — it can be the same one you use in SillyTavern." | Decision 1 stands unchanged; only the explanation is corrected so users don't hunt for a "special" key. |
| D2 | **ST's auto-read is paused whenever DES voices are on** (`voices.enabled`), not only when DES auto-read is on. | Decision 6 says "when DES voices are active". The incremental design gated it on `enabled && autoRead`, which leaves ST reading in the card's voice while DES bullhorns play — two voices. (Review A1.) |
| D3 | **Pause ST with a runtime getter/`toJSON` guard**, never by writing ST's setting. | Save/restore persists the forced value if the browser crashes; ST's listeners are anonymous `makeLast` closures and can't be removed (`st/…/tts/index.js:1580-1581`); guarding `enabled` would hide ST's wand menu (`:400-413, :900`). The guard ships in the **first** user-facing milestone. (Review B1.) |
| D4 | **Auto-read fires after the message is "decorated"**, not at `CHARACTER_MESSAGE_RENDERED`. | `index.js:3196-3197`: colour tags from the colored-dialogues extension arrive on a 600 ms debounce, and DES already waits 800 ms + `waitForAliasDecisions()` before bubbling [V]. Firing earlier sends every line to the Narrator for those users. (Review claim 1.) |
| D5 | **Presence check is read-only.** Uses `resolveCharacterAlias` plus a new pure structural-variant lookup — **not** `applyCharacterAliases`. | `applyCharacterAliases` records aliases (`characterAliases.js:602` calls `addCharacterAlias`) and rewrites `char.name` even without `suggestSimilar` [V]. Reading an old message must not write settings. (Review claim 2.) |
| D6 | **Removed/banned status applies as it is *now*,** even to old messages; on-panel presence is historical (from that message's tracker). | Both research maps recommend it: if you hid someone, they shouldn't be voiced. The architecture-UX manual test that contradicted this is dropped. (Review B5.) Note: the panel itself filters only the *removed* list (`portraitBar.js:1304-1315`); the *banned* list (`persistence.js:887`) is not a panel filter, so also treating banned names as absent is a DES choice [I]. Ejecting from the Workshop adds the name to the removed list (`characterWorkshop.js:1040-1045`) [V]. |
| D7 | **Direct route uses `generateContent` first, Interactions as a fallback.** | `generateContent` with `speechConfig.voiceConfig.voice` is documented for 3.8 [V SG-GC, VD-GC]; Google's Interactions model table omits 3.8 TTS [V]; Interactions stores requests by default (55 days paid / 1 day free) [V INT]. If Interactions is ever used, every call sends `store:false`. (Review B9.) Note: that generateContent retains nothing is itself [I]. |
| D8 | **No provider abstraction layer.** One `transport.js` with two transports. | One provider exists; the abstraction was ~3 modules of speculative structure. (Review B8.) |
| D9 | **Settings live under `extensionSettings.voices`**, not `tts`. | `index.js:3105-3118` already manipulates ST's `extension_settings.tts`; a DES `tts` key invites mix-ups. (Review A12.) |
| D10 | **The capability probe result is kept in `sessionStorage` with a 6-hour TTL**, run lazily on first use, and downgrades the model **only** on a model/argument error. | Persisting it in settings let one transient 429 downgrade every device until ST updates. (Review A7.) |
| D11 | **"+" copies Base's voice, literally.** `addProfile` clones the version on the stage (`characterWorkshop.js:622` passes `from: draft.versionId`) [V]; after it runs, `addVersion` overwrites the new version's `voice` with Base's. | Decision 5 says Base. Every other field keeps today's "clone what's on stage" behaviour (Base by default). Listed as an open question in case the user would rather the voice follow the stage like the portrait. (Review claim 6.) |
| D12 | **Bubbles off gets DES's own message bullhorn**, injected like the reasoning button; ST's `.mes_narrate` intercept is an optional extra. | `.mes_narrate` is probably hidden when ST TTS is off [I — the CSS isn't in the sparse clone], and users switching to DES voices may turn ST TTS off. (Review B3/A5.) |
| D13 | **Auto-read queue is FIFO per chat.** A new generation does *not* stop reading; only the user sending a message, a swipe/regenerate of the message being read, delete, chat change, or a manual stop does. | Group chats start the next member's generation right after the previous reply renders; stopping on `GENERATION_STARTED` would cut every speaker off. (Review A3/B4.) |
| D14 | **Two present characters sharing a dialogue colour: the voice follows the bubble's attribution,** and the Workshop warns on both characters. | The Narrator is no "more correct" than the bubble's guess, and a bubble labelled "Mara" read in the Narrator's voice looks like a bug. The warning is what fixes it. |
| D15 | **Cost guard-rails:** max 24 segments per message, a per-session auto-read budget (default 300 requests, then auto-read pauses with a toast), and a request counter in the status line. | 3.8 free-tier RPM/RPD are unpublished [V RL]; one message with ten speaker changes is ten calls. (Review A9.) |
| D16 | **Deleting a character/version/campaign never deletes a Google voice.** Custom voices are only deleted from the voice manager, which shows who still uses them. | Deleting needs the key, voices are shared, and a designed/cloned voice costs money and effort to recreate. |
| D17 | **Unkept Voice Design drafts are deleted from Google immediately** (after "Try again" asks). | Each draft uses one of the project's 200 stored-voice slots [V]. Nothing references a draft yet, so this is safe. |
| D18 | **Style direction is dropped on the ST route, never prepended to the text.** | 3.8 reads `text` word for word and may speak "Say cheerfully:" aloud [V model page]. |
| D19 | **The optional key's localStorage name is namespaced per ST user** where ST exposes a user handle. | The external-key precedent is shared by every ST account using the same browser origin. (Review A13.) ST exports `getCurrentUserHandle()` (`st/public/scripts/user.js:54`; returns `'default-user'` when there is no logged-in user) [V]; it is not on `getContext()` (`st/public/scripts/st-context.js` has no such entry) [V], so DES imports it directly (import depth as other DES → ST imports) [I]. Fallback if the import fails: the un-namespaced key. |

---

## 2. Summary, goals, non-goals

**Summary.** DES takes over reading chat aloud. Each message is split into an ordered list of
`{speaker, kind, text}` segments using the same attribution the bubbles use. Each segment gets a
voice: the speaker's Workshop voice if they are present for that message, otherwise the Narrator.
Audio comes from `gemini-3.8-flash-lite-tts` (default) or `gemini-3.8-flash-tts`, through ST's
server with ST's saved key, or directly from the browser with the optional DES key. DES plays it
through its own queue and `Audio` element and pauses ST's auto-read without touching ST's saved
setting.

**Goals**

- G1. All six user decisions met exactly.
- G2. Every milestone is shippable on its own; the riskiest unknowns are answered first (M0).
- G3. Reuse existing seams: `PROFILE_FIELDS` for versioning, the Workshop lazy-pane pattern, the
  localStorage key precedent, the existing attribution code.
- G4. Pay for what you use (`docs/rebuild-philosophy.md:53-64`): with voices off, one eager module
  of ~80 lines whose listeners return on their first line; no voice CSS, markup or engine code
  loads.
- G5. Every voice choice is explainable: the resolver returns a `reason` shown in tooltips and the
  debug log ("Narrator: Tom is not in the scene").

**Non-goals (v1)**

- Reading while a message is still streaming (colours are harvested at `MESSAGE_RECEIVED`;
  presence arrives later still in separate mode).
- Two-speaker merged requests (§10).
- Persistent (disk/IndexedDB) audio cache.
- A server plugin, or asking the user to edit ST's `config.yaml` (CORS proxy etc.).
- A DES provider inside ST's pipeline via `registerTtsProvider` (`st/…/tts/index.js:104`): ST sends
  one voice per `message.name`, so it cannot split by speaker or apply the scene rule [V/I].
- Replacing ST's wand "Narrate All" or `/speak` — they remain ST-voice paths.
- Automatically deleting Google voices.
- Reading greetings (`first_message`) automatically (open question, §17).

---

## 3. Architecture

### 3.1 New modules

All under `src/systems/voices/` unless noted.

| File | Loaded | Responsibility and exported signatures |
|---|---|---|
| `voiceBoot.js` | **eager, ~80 lines** | Registers the event shims; first line of each is `if (!extensionSettings.voices?.enabled) return;`. Holds the auto-read "armed" flag. `installGuardIfEnabled()`, `onMessageDecorated(messageId, type)`, `getEngine(): Promise<module>` (dynamic `import('./voiceEngine.js')`, memoised), `getEngineIfLoaded(): module\|null` (used by `campaignManager.js`, §3.2). |
| `stAutoReadGuard.js` | lazy, imported by boot only when enabled (~50 lines) | `installStAutoReadGuard(isActive: () => boolean): boolean`, `uninstallStAutoReadGuard(): void`, `stopStPlayback(): void` (§9.7). |
| `voiceSettings.js` | lazy (also imported by the settings binder on first accordion open) | `ensureVoiceSettings(saved, live)`; key helpers `getDesKey(): string\|null`, `setDesKey(k)`, `clearDesKey()`, `keyTag(k): string` — all `localStorage` access in try/catch. No network. |
| `voiceEngine.js` | lazy | Front door. `speakMessage(messageId, {source})`, `speakFromBubble(bubbleEl)`, `speakThought(thoughtEl)`, `speakReasoning(messageId)`, `stop(reason)`, `invalidate()`. Connects segmenter → presence → resolver → player. |
| `segmenter.js` | lazy | `segmentMessageForTts(messageId, {fromIdx?}): Segment[]` (DOM-bound, thin) and pure `normalizeSegments(raw: RawSeg[], {maxChars=2500}): Segment[]`. `Segment = {speaker: string\|null, kind: 'narration'\|'dialogue'\|'thought', text, ttsIdx?: number}`. |
| `presence.js` | lazy | Pure `isPresentOnPanel(name, messageId, readers): boolean` with injected `readers = {trackerFor, removedLower, personaNames, activePersona, showUserInPCP, pendingAlias, resolveAlias, structuralCanonical}`; plus `defaultReaders()` wiring the real DES getters. `trackerForMessage(id)` walks back (§7.3). |
| `voiceResolver.js` | lazy | Pure `resolveVoice({seg, present, stores, narrator, caps, registry}): {ref: VoiceRef, route: 'st'\|'direct', reason: string}`. |
| `voiceRegistry.js` | lazy | Reads/writes `VoiceRef`s: character (live store = active version), persona, Narrator; the custom-voice registry; `usedBy(id)` via `campaignProfiles.forEachVoiceRef`; `rewriteRefs(oldId, newId\|null)` via `campaignProfiles.rewriteVoiceRefs`. |
| `transport.js` | lazy | `StRouteTransport` and `DirectKeyTransport`, one shape: `synthesize({text, voiceId, model, style?, signal}): Promise<Blob>`; direct only: `listVoices(filters, pageToken)`, `getVoice(id)`, `createVoice(spec)`, `deleteVoice(id)`. Also `classifyError(err): 'no-key'\|'bad-key'\|'quota'\|'rate'\|'voice-gone'\|'model-unavailable'\|'argument'\|'network'\|'content'\|'unknown'`. |
| `capabilityProbe.js` | lazy | `getCapabilities(): Promise<Caps>` — `{stKey:boolean, model38OnSt:boolean\|null, stModel:string, direct:boolean, customIdOnSt:boolean\|null}`; cached in `sessionStorage['dooms_voices_probe']` keyed by ST version, 6 h TTL (D10). |
| `player.js` | lazy | Queue, prefetch-one-ahead, DES `Audio` element `#dooms-tts-audio`, highlight add/remove, in-memory LRU audio cache, 429 backoff, autoplay unlock, budget counter. `enqueue(job)`, `replaceWith(job)`, `stop()`, `unlock()`. |
| `autoRead.js` | lazy (only when `enabled && autoRead`) | `onDecorated(messageId, type)`, the separate-mode wait, continue diff, dedupe hash. |
| `voiceCatalog.js` | lazy | The 30 stock voices with Google's spelling and trait words [V SG]; `isStockVoice(id)`. |
| `consentPhrases.js` | lazy (clone wizard only) | Google's per-locale consent statements, copied verbatim from the voice-replication guide. |
| `src/systems/ui/voicePane.js` | lazy, first activation of the Workshop Voice tab or the Narrator picker | Voice tab UI and the shared Voice Picker component. |
| `src/systems/ui/voiceStudio.js` | lazy, first "Design" or "Clone" click | Design flow, clone wizard and recorder. Kept out of `voicePane.js` because it is the heaviest UI piece. |
| `src/utils/wav.js` | lazy | `pcm16ToWav(int16, sampleRate)`, `toMono24kWav(blob): Promise<Blob>` (OfflineAudioContext resample). |
| `src/utils/offScene.js` | shared (imported by `portraitBar.js`) | `OFF_SCENE_RE`, `isOffScene(thoughts)`: the off-scene regex moved out of `portraitBar.js:1252`. `thoughts.js:1508`'s broader regex is a different feature and stays. |

### 3.2 Changes to existing modules

| File | Change |
|---|---|
| `src/core/state.js` | `characterVoices: {}` next to `npcAvatars` (`:258`); the `voices` default object (§4.2); `'voices.enabled': false`, `'voices.autoRead': false` in `NEW_PLAYER_PROFILE` (`:456-478`; dotted keys are supported there [V]). |
| `src/core/persistence.js` | Call `ensureVoiceSettings(savedSettings, extensionSettings)` beside `ensureCampaignSettings` (`:467`). Guards test `savedSettings`, not the merged object (`:471-476`), with `=== undefined` checks (e.g. `:483`, `:491`, `:495`). No `settingsVersion` bump. |
| `src/systems/lorebook/campaignProfiles.js` | `{ field: 'voice', store: 'characterVoices' }` in `PROFILE_FIELDS` (`:38-47`). New `voiceIdsOf(profile)`, `forEachVoiceRef(visit)`, `voiceRefCount(id)`, `unreferencedVoices(ids)` mirroring `:437-531` (skip the active bucket: rule in the comment at `:452-460`, code at `:484-486`), and a **writer** `rewriteVoiceRefs(oldId, newId\|null)` (§8.6). Existing `string[]` returns unchanged (callers `characterWorkshop.js:642` (`removeProfile`), `characterWorkshop.js:2927`, `characterRoster.js:1111`, `campaignManager.js:107`; tests `tools/campaign-profiles-test.mjs:197, 215`). |
| `src/systems/ui/characterWorkshop.js` | See §4.4 for the full list. Pane lazy-load follows the expressions pane (`:1713-1722`). |
| `src/systems/features/characterAliases.js` | `adoptVariantAsAlias`'s hard-coded store lists (`:411-413`, `:439-441`) are derived from `PROFILE_FIELDS` so `characterVoices` (and any future field) is carried. Export a new read-only `structuralCanonical(name, knownNames = buildCanonicalNameMap())` that wraps the existing private helpers `applyCharacterAliases` (`:567` ff.) already uses — `resolveStructuralVariant(name, canonMap)` (`:140`) and `buildCanonicalNameMap()` (`:120`; reads settings and chat metadata, writes nothing) — and returns `name` unchanged when it is not a variant (D5). |
| `src/systems/ui/characterRoster.js` | `importCharacterPayload` (`:989-1088`) validates `payload.voice` (§8.7). `purgeCharacter` users path (`:1096-1100`) fixed to clean portraits (existing leak) — voice needs nothing because remote voices are never auto-deleted. |
| `src/systems/lorebook/campaignManager.js` | After `switchCampaignProfiles` (`:252`): `voiceBoot.getEngineIfLoaded()?.invalidate()`. |
| `src/systems/rendering/chatBubbles.js` | Export `parseSegments(container, {messageId, persist})` (renamed `parseMessageIntoBubbles`, `:510`; `isLatest = messageId === chat.length - 1` fixes `:528-533`). Export `splitGfxParts(container)` extracted from `:1156-1277`. Export `getOriginalBubbleHtml(mesText)` (reads `originalHtmlMap`, `:70`). Stamp a message-wide `data-tts-idx` on every bubble (`data-segment-index` restarts per graphics part). `initBubbleTtsHandlers` (bubble `:1529`, thought `:1566`, reasoning `:1596` handlers) routes to `voiceEngine` when `voices.enabled`; otherwise keeps `/speak` with the text escaped (quote-wrapped, `\|` and `{{` escaped). New `injectMessageTtsButtons(scope)` modelled on `injectReasoningTtsButtons` (`:1631-1649`), only when `voices.enabled`. |
| `src/systems/rendering/thoughts.js` | No change required: the thought bullhorn is only *rendered* here (`:1609`); its click handler is in `chatBubbles.js:1566-1592` (see the row above), which routes to `voiceEngine.speakThought` when enabled. |
| `src/systems/ui/portraitBar.js` | `:1252` imports `isOffScene` from `src/utils/offScene.js`. |
| `index.js` | `bindSettingsUI` (`:731+`): Voices accordion binders. `registerAllEvents` (`:3435-3456`): boot shims. The 800 ms decoration timer (`:3201-3205`, today inside the bubbles-only branch `:3187-3206`) is restructured to run whether or not bubbles are on and calls `voiceBoot.onMessageDecorated(messageId, type)` after `waitForAliasDecisions()`. `onChatChangedTtsCleanup` (`:3046-3119`): keep the `display_text` cleanup (`:3055-3102`), skip the regex auto-config (`:3105-3118`) while voices are on, fix the selector to `#tts_apply_regex`, and append `\|font` pattern instead of overwriting a user pattern. |
| `template.html` | Workshop nav button after Knives (`:2443-2449`) and pane shell after the Knives pane's closing `</section>` (`:2734`); Voices accordion `data-accordion="voices"` after WORKSHOP (`:1016-1057`), before BUNNY MO (`:1059`). |
| `styles/modals.css` | Voice-tab CSS in the Workshop block (from `:5659`), scoped to `#character-workshop-popup`; six-tab fit (§6.1). |
| `style.css` (eager) | Only `.dooms-tts-speaking`, `.dooms-tts-loading` and the playing-bullhorn state (~15 lines). |
| `src/i18n/en.json` | `characterWorkshop.voice.*`, `settings.voices.*`; delete-confirm text (`:41-42`). |

### 3.3 Lazy-loading boundaries

| User state | Code loaded |
|---|---|
| Voices off (default) | `voiceBoot.js` only. The Workshop Voice tab button is visible; nothing behind it loads until clicked. |
| Voices on, nothing played yet | + `stAutoReadGuard.js`. |
| Accordion opened | + `voiceSettings.js` (the rest of the accordion is static markup). |
| First read (bullhorn or auto) | + `voiceEngine`, `segmenter`, `presence`, `voiceResolver`, `voiceRegistry`, `transport`, `capabilityProbe`, `player`, `voiceCatalog`; + `autoRead` if auto-read is on. |
| Voice tab / Narrator picker opened | + `voicePane.js` (Workshop CSS is already deferred: `lazyUI.js:32-44`, `index.js:669-676`). |
| Design or Clone started | + `voiceStudio.js`, `wav.js`, `consentPhrases.js`. |

`tools/load-check.mjs` cannot verify this — it globs every file under `src/**` (`load-check.mjs:34`).
A new `tools/lazy-graph-test.mjs` walks *static* imports from `index.js` and fails if any of the
lazy modules above is reachable (§14.1).

---

## 4. Data model

### 4.1 Per-character voice (versioned)

```js
// extensionSettings.characterVoices[name] = VoiceRef   — flat store, swapped per campaign version
/** @typedef {{
 *   source: 'stock'|'library'|'designed'|'cloned',
 *   id: string|null,          // stock: 'Kore'; library: ListVoices id [U format]; designed/cloned: 'voice_…';
 *                             // null only for an imported design awaiting re-creation
 *   label?: string,           // display only, never used for lookup
 *   fallbackStock?: string,   // stock name used when this device can't play a non-stock voice
 *   pendingDesign?: string    // imported description, until the user clicks "Create this voice"
 * }} VoiceRef */
```

- Absent key = no voice = Narrator. `applyToLive` deletes the key on null/undefined
  (`campaignProfiles.js:180-191`) [V], so no explicit "use Narrator" value is needed.
- "cloned" is DES's word; the transport translates to Google's `type: "replicated"`.
- Stateless `voicekey_…` keys (7-day TTL [V]) are never stored; DES always creates with `store: true`.
- Personas: `userCharacters[name].voice`, same shape, **not versioned** (personas have no
  versions: `characterWorkshop.js:575, :1162, :746`) [V].
- Audio is **never** stored in settings (precedent: the v24 portrait move, `persistence.js:426-443`).

By adding the field to `PROFILE_FIELDS`, these paths handle it with no further code [V map]:
`snapshotLive`/`applyToLive` (`:165-191`), `readVersion`/`writeVersion` (`:205-225`), `addProfile`
(`:235-247`), `bankActiveCampaign` (`:275-285`, run on every `saveSettings`, `persistence.js:549`),
`switchCampaignProfiles` (`:294-312`), the variant merge (`:392, :411`), `removeFromLive`
(`:194-196`), `deleteCharacterEverywhere` (`:320-335`).

### 4.2 DES voice settings

```json
{
  "voices": {
    "enabled": false,
    "autoRead": false,
    "model": "gemini-3.8-flash-lite-tts",
    "narratorVoice": { "source": "stock", "id": "Charon", "label": "Charon — Informative" },
    "readUserMessages": false,
    "autoReadThoughts": false,
    "playbackRate": 1,
    "preferDirectForStock": false,
    "maxSegmentsPerMessage": 24,
    "sessionRequestBudget": 300,
    "styleFromTracker": false,
    "customVoices": {
      "voice_abc123": {
        "id": "voice_abc123",
        "source": "designed",
        "label": "Warm British astronomer",
        "designPrompt": "A warm, thoughtful astronomer in his late 60s with a gentle British accent.",
        "gender": "male",
        "languageCode": "en-GB",
        "createdAt": 1790380800000,
        "expireTime": "2027-09-26T00:00:00Z",
        "keyTag": "a1B2",
        "status": "ok"
      }
    }
  },
  "characterVoices": {
    "Mara": { "source": "designed", "id": "voice_abc123", "label": "Warm British astronomer", "fallbackStock": "Kore" },
    "Tom":  { "source": "stock", "id": "Puck", "label": "Puck — Upbeat" }
  }
}
```

| Key | Meaning |
|---|---|
| `enabled` | Master "Use DES voices". Also gates the ST auto-read guard (D2). |
| `autoRead` | Decision 6 auto-read. |
| `model` | `gemini-3.8-flash-lite-tts` (default; cheaper, "built to replace gemini-3.1-flash-tts-preview" [V M-L]) or `gemini-3.8-flash-tts`. The *effective* model on the ST route may be downgraded by the probe (§5.3); that is not written back here. |
| `narratorVoice` | `VoiceRef`; any source allowed (decision 4). If unplayable → stock `Charon`, reason `narrator-fallback`. |
| `readUserMessages` | Mirrors ST's `narrate_user` default false (`st/…/tts/index.js:1178`). |
| `autoReadThoughts` | Thoughts/reasoning only on bullhorn by default. |
| `playbackRate` | Client-side `audio.playbackRate`; free. |
| `preferDirectForStock` | Off: stock voices use the ST route even when a DES key exists (keeps the secret server-side). |
| `maxSegmentsPerMessage`, `sessionRequestBudget` | D15 guard-rails. |
| `styleFromTracker` | Optional M6 (§11). |
| `customVoices` | Registry of **designed and cloned** voices only. Library voices are Google's catalogue (no expiry: "`expire_time` … Unset for prebuilt catalog voices" [V API-V]) and live only as `VoiceRef`s. |

There is **no route setting**: the route is derived per segment (§5.2) and the status line says
which is in use. The probe result lives in `sessionStorage`, not here (D10).

**Naming note:** DES already has an unrelated `narratorMode` setting (`state.js:30`). UI copy says
"Narrator voice" everywhere and never "narrator mode".

### 4.3 Optional DES Google key

- `localStorage['dooms_tracker_google_tts_key' + (userHandle ? ':' + userHandle : '')]`, all access
  in try/catch. Never in `extensionSettings` (that would put it in `settings.json`, send it to every
  logged-in session, and include it in backups) [V map].
- `keyTag` = last 4 characters, stored on each custom voice so DES can say "created with a
  different key (…a1B2)". Voices belong to one Google project [V "in your project"]; playing them
  with a key from another project is expected to fail [I].
- The ST key's tag is **not** compared in v1. ST's masked `/read` state does expose the last 3
  characters of any key longer than 10 characters (`getMaskedValue`, `st/src/endpoints/secrets.js:181-195`,
  used by `getSecretState` at `:357`; the full value when `allowKeysExposure` is on) [V], so a hint is
  possible later — but a matching tail does not prove the same Google project. (Review A10.)
- Rejected: ST's `/api/secrets/write` accepts any name (`secrets.js:511-527`) but the browser can't
  read it back (`:568-576`) and no route uses it; writing a second MakerSuite secret replaces the
  user's chat key (`:211`) [V].

### 4.4 Every Workshop/roster path that must learn about `voice`

**`characterWorkshop.js`**

| Location | Change |
|---|---|
| `buildDraft` persona branch `:1156-1181` | `voice: u.voice`; add `voice` to `dirty`. |
| live branch `:1207-1222` | `voice: extensionSettings.characterVoices?.[name]`. |
| saved-copy branch `:1226-1242` | `voice: p.voice`. |
| dirty map `:1205` | add `voice`. |
| `loadVersion` render list `:509-517` | `renderVoice()` — no-op until `voicePane.js` has loaded. |
| `hasVersionedEdits` `:561` | add `d.voice`. |
| `switchVersion` carry `:592, :685` | voice is **not** carried (versioned). |
| `addVersion` `:612-629` | after `addProfile(...)` (`:622`), set the new version's voice to `readVersion(BASE).voice` via `writeVersion` (D11). |
| `removeVersion` `:632-659` | refresh `renderVoice` in the non-current branch (`:653-657`); refresh "unused voices" count. |
| `commitDraft` persona `:2523-2532` | write `voice`. |
| `commitDraft` live `:2661-2716` | `if (draft.dirty.voice)` write/delete `characterVoices[name]`. |
| `commitDraft` saved-copy `:2717`, merge `:2720-2749` | include `draft.dirty.voice` / `voice`. |
| `copyNpcToUserCharacter` `:2818-2830` | add `voice: fromDraft?.voice` explicitly (object is built without spread). |
| `copyUserToNpcCharacter` `:2876-2890` | `characterVoices[trimmed] = u.voice`. |
| `exportDraft` `:3382-3397` | §8.7. |
| `closeCharacterWorkshop` `:442-456` | stop audition audio. |
| delete confirm strings (`en.json:41-42`, fallbacks `:2385-2394`) | "…and its voice setting (the Google voice itself is kept)". |

**Cache invalidation** (`voiceEngine.invalidate()` clears the per-read `canonicalName → VoiceRef`
memo): campaign switch (`campaignManager.js:252`), Workshop save (`commitDraft`), alias adopt,
`CHAT_CHANGED`.

### 4.5 Migration

`ensureVoiceSettings(savedSettings, extensionSettings)`:

- if `savedSettings.voices === undefined` → full default;
- else fill each missing `voices.*` sub-key (`updateExtensionSettings` is a shallow `Object.assign`,
  `state.js:645-647`, so a saved `voices` object would hide new defaults) [V];
- force `characterVoices` and `voices.customVoices` to plain objects; drop non-object `VoiceRef`s.

The chat blob (`chat_metadata.dooms_tracker`) is unchanged; `saveChatData` rebuilds it from a fixed
list (`persistence.js:571-591`) and voice is not per chat.

---

## 5. API routing (decision 1)

### 5.1 What each route can do

| Capability | **ST route** (default) — `POST /api/google/generate-native-tts`, ST's saved key stays on the server | **Direct** (optional DES key) — browser → `generativelanguage.googleapis.com` |
|---|---|---|
| 30 stock voices on 3.8 | **[U] — M0 probe.** ST sends single-speaker `prebuiltVoiceConfig.voiceName` (`google.js:369-373`); 3.8 docs show `voiceConfig.voice` for single voice and keep `prebuiltVoiceConfig` only in the multi-speaker example [V]. Also [U]: whether 3.8 accepts ST's `safetySettings` (`:378`). | Yes [V docs]. CORS preflight returns 200 with the origin echoed for `/models/…:generateContent`, `/interactions`, `/voices` [V live]. |
| Library, designed, cloned: *play* | Assume **no** ([U]; custom ids are documented only on `voiceConfig.voice`). Bonus probe in M3. | Yes. |
| Library browse; design/clone create/get/delete | No route exists: `google.js`'s only Gemini TTS routes are `/list-native-voices` and `/generate-native-tts` (`/list-voices` and `/generate-voice`, `:291-311`, are Google Translate TTS) [V]. | Yes: `/v1beta/voices` [V docs; endpoint exists per 403 vs 404 probe]. |
| Style (`speech_metadata.style`) | No — route sends only `parts:[{text}]` (`:364-367`). Dropped (D18). | Yes. |
| Inline tags (`<sigh>`, `<short pause>`) | Yes, they're just text [I]. | Yes. |
| Streaming | No — route buffers the full JSON (`:385-422`). | Yes (deferred to M6). |

**StRouteTransport** posts `{text, voice, model}` with `getRequestHeaders()` (`st/public/script.js:647`;
DES already imports it, `index.js:2`) and copies **the rest of ST's client body exactly** as
`st/public/scripts/extensions/tts/google-native.js:160-193` builds it — the `api` type, Vertex fields,
and `reverse_proxy`/`proxy_password` from `oai_settings` (`:162, :172-173`). Copying the proxy fields
matters: with a reverse proxy set, ST uses the proxy password as the key (`google.js:221`) [V]. It does
**not** make Vertex work: ST's own client effectively always sends `api: 'makersuite'` (the Vertex option
is `disabled`, `google-native.js:27`), and the Vertex fields are only read when `api === 'vertexai'`
(`google.js:165`) [V] — so a Vertex-only ST (no AI Studio key) is keyless on this route (review claim 8 corrected). Availability is decided by the
probe, with `secret_state[SECRET_KEYS.MAKERSUITE]` (`st/public/scripts/secrets.js:338`; key name at `:36`) used only for
the "no key found" hint. Audio: `audio/l16` is wrapped to WAV by ST, anything else passes through
with Google's mimeType (`google.js:407-422`) — both play [I].

**DirectKeyTransport**, primary shape (D7):

```http
POST https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash-lite-tts:generateContent
x-goog-api-key: <DES key>
Content-Type: application/json

{"contents":[{"role":"user","parts":[{"text":"You came back.","speech_metadata":{"style":"hushed"}}]}],
 "generationConfig":{"responseModalities":["AUDIO"],"speechConfig":{"voiceConfig":{"voice":"voice_abc123"}}}}
```

Audio at `candidates[0].content.parts[0].inlineData.data` (base64, `mimeType` alongside) [V SG-GC].
`speech_metadata` is omitted when there is no style. No `safetySettings`.

Fallback shape (automatic retry on 404 / `INVALID_ARGUMENT` from the primary):

```json
{"model":"gemini-3.8-flash-lite-tts","store":false,
 "input":[{"type":"user_input","content":[{"type":"text","text":"You came back.",
   "annotations":[{"type":"speech_metadata","style":"hushed"}]}]}],
 "response_format":{"type":"audio"},
 "generation_config":{"speech_config":[{"voice":"voice_abc123"}]}}
```

to `POST /v1beta/interactions`; audio is the last `model_output` audio part at
`steps[].content[].data` [V SG]. `store:false` always (Interactions otherwise keeps requests 55 days
paid / 1 day free [V INT]).

### 5.2 Per-segment route choice (inside `resolveVoice`)

1. **Stock** voice → ST route, unless the probe says the ST route is unavailable, or
   `preferDirectForStock` is on and a DES key exists, or a style is being sent → direct.
2. **Library/designed/cloned** → direct if a DES key exists on this device (warn if its `keyTag`
   differs from the voice's); else ST route if the probe found `customIdOnSt === true`; else
   `fallbackStock` on the ST route; else Narrator (`reason: 'needs-key'`, one toast per voice per
   session: "Mara's voice needs your Google key on this device, so the Narrator is reading her").
3. Registry `status: 'gone'` → same fallback chain, `reason: 'voice-gone'`.
4. Style is only ever sent on the direct route (D18).

### 5.3 If 3.8 can't be reached through ST's current route

`capabilityProbe.js`, run lazily on the first read or audition, never at startup:

1. Synthesise `"Ready."` with `voices.model` and stock `Kore` on the ST route.
2. **200 + audio** → `model38OnSt = true`, `stModel = voices.model`.
3. **Error classed `model-unavailable` or `argument`** (Google's message is forwarded by ST at
   `google.js:387-392`) → retry with `gemini-3.1-flash-tts-preview` (ST's own default,
   `google-native.js:15`, known to work on this route). If that works: `stModel = 3.1`, and the
   status line says: *"Your SillyTavern can't send Gemini 3.8 requests yet. Standard voices use
   Gemini 3.1 through SillyTavern. Add a Google key under Voices to use 3.8."* With a DES key, stock
   voices then go direct on 3.8. 3.1 has "No shutdown date announced" [V DEP], but it is listed on
   the deprecations page with the 3.8 models as its replacement, so this fallback is temporary.
4. **Any other error** (429, network, 5xx) → no downgrade; cache nothing; retry on next use.
5. Result in `sessionStorage` keyed by ST version, 6 h TTL.

The fallback means the default route may **not** run the newest model at all. That is surfaced as
an open question (§17), not just a banner. (Review A16.)

### 5.4 Upstream SillyTavern PR (worth proposing, never depended on)

Small, additive, in `src/endpoints/google.js` and `public/scripts/extensions/tts/google-native.js`:

1. Add `gemini-3.8-flash-tts` and `gemini-3.8-flash-lite-tts` to the model dropdown (`google-native.js:33-35`).
2. In `/generate-native-tts`, for `gemini-3.8-*` send `voiceConfig.voice` instead of
   `prebuiltVoiceConfig`; accept an optional `style` → `parts[0].speech_metadata.style`; drop
   `safetySettings` if M0 shows 3.8 rejects them.
3. New `GET/POST/DELETE /api/google/tts-voices` proxying `/v1beta/voices` with the saved key.
4. Optional `secret_id` so a separately stored secret can be used without reaching the browser.
5. Fix "Callirhoe" → "Callirrhoe" (`google.js:317-347`).

DES adds an `UpstreamTransport` that switches on when `GET /api/google/tts-voices` answers anything
but 404. With it, library/design/clone work with **no** DES key — the most secure outcome. Also
note for the PR: the route logs every line's text via `console.debug` (`google.js:361`).

---

## 6. UX

### 6.1 Workshop "Voice" tab

**Placement.** Sixth nav button after Knives (`template.html:2443-2449`): `data-pane="voice"`,
`.cw-tab-label` "Voice", with an emoji icon like the other tabs (they use HTML entities, e.g. `&#128298;`
for Knives; 🎤 `&#127908;` fits). Pane shell
`<section class="rpg-editor-pane" data-pane="voice">` after the Knives pane's `</section>` (`:2734`); `activatePane`
(`:1695-1702`) already handles any pane; first activation lazy-imports `voicePane.js` with the
data-character guard used for expressions (`:1713-1722`). Handlers bind under the `.cw` namespace
in `bindStaticListeners` (`:1704-1723`; the delegated nav click is at `:1709`).

**Tab width.** `modals.css:6168-6180` notes five labelled tabs nearly fill the editor at the
1000 px cap; the icons-only rule is `@media (max-width: 1000px)` (`:6454`) — the "641–860px" in
`parity-checklist.md:40` is stale [V]. Overflow happens *above* 1000 px where labels show. Fix:
shorten labels to one word each and let the tab row's label font step down one size in the rule at
`:6168-6180`; verify at 1001 px and 1440 px with all ten themes. Update `parity-checklist.md:40`.

**Pane layout** (existing `.rpg-editor-section` blocks, h4 + `p.helper`):

1. **Current voice.** Label, source chip (Standard / Library / Designed / Cloned), ▶ Preview,
   **Use Narrator (no voice)**. Status lines as they apply:
   - "Heard only while Mara is on the Present Characters panel. Otherwise the Narrator reads her lines."
   - Non-live version: "This is Mara's voice in *Crimson Tide*. Base uses Kore."
   - Custom voice, no key on this device: "On devices without your Google key, Mara uses **Kore**. [Change]"
   - Amber "Expires in 12 days · Recreate"; red "No longer available · Recreate / Pick another".
   - Shared colour (D14): "Mara and Tom share a dialogue colour, so some lines may be read in the wrong voice. [Change colour]"
   - For the card character: "The card's own character is only voiced when the tracker lists them as present."
2. **Test line.** Editable, default "Hello, I'm {name}." (no chat-history prefill — review B13).
   Small print: "Each preview is a short Google request."
3. **Choose a voice.** Segmented control `role="tablist"`: **Standard · Library · Design · Clone**.
   - *Standard:* 30 cards (name, trait word, ▶). Click = select + play. No gender filter (no data source — review B14).
   - *Library:* search, gender, accent, language; paged list (`page_size=50`); ▶ per row, marked
     "uses your Google quota". Without a key: locked state "The Extended Voice Library needs your
     Google key on this device. [Open Voices settings]". After picking, choose a fallback standard voice.
   - *Design / Clone:* buttons that open the studio (§8.3-8.4), with "N of 200 custom voice slots used".
4. **Studio** opens as a panel inside the pane with its own Back button, so Workshop Save/Cancel
   keep their meaning. Picking a voice is a normal draft edit (`draft.dirty.voice = true`) committed
   by **Save**. The studio says: "The voice is saved to your Google project now. It's attached to
   Mara when you press Save." If the user cancels, the voice is unreferenced and appears in
   "Unused voices".

**Versions.** The pane follows the version strip; `hasVersionedEdits` asks before discarding a
changed voice. **Personas** get the same pane in `data-mode="user"` (`modals.css:5706-5712`), no
version strip; helper: "Used for your persona's lines while it is shown on the Present Characters
panel ('Show me in Present Characters' must be on)."

**Mobile (<640 px).** Stock cards become a one-column list with ≥44 px ▶ targets; the segmented
control scrolls horizontally; the record button is a full-width sticky footer; one shared audition
player (never 30 `Audio` elements).

**Accessibility.** ▶ has `aria-label="Preview Kore"` and toggles to ■; only one preview at a time;
the recorder timer announces "10 seconds reached" via a polite live region.

### 6.2 DES settings: "Voices" accordion

After WORKSHOP (`template.html:1016-1057`), before BUNNY MO (`:1059`). Rows:

| Row | Plain-language label and helper |
|---|---|
| Master | **Use DES voices** — "Reads chat with a different voice for each character in the scene. While this is on, SillyTavern's own auto-read is paused (your SillyTavern setting isn't changed)." |
| Auto-read | **Read new messages automatically** |
| Narrator | **Narrator voice** [label ▶ Change…] — "Reads narration, and anyone who isn't in the scene or has no voice." Change… opens the shared Voice Picker (from `voicePane.js`) in a small popup; designed and cloned voices allowed. |
| Model | **Voice model:** "Gemini 3.8 Flash-Lite — cheaper, good for auto-read" / "Gemini 3.8 Flash — richer". Cost line (§10). |
| Speed | 0.75×–1.5× slider. |
| Also read | "my own messages" (off); "thoughts and reasoning when auto-reading" (off). |
| Limits | "Stop auto-reading after [300] requests this session". |
| Google key | Password field + eye toggle copied from `template.html:104-112`, **Test**, **Remove**. Helper: "Optional. Paste a Google AI Studio key to unlock the voice library, designing voices from a description, cloning a voice, and style direction. It can be the same key you use in SillyTavern. It's stored only in this browser and sent only to Google. Other extensions running in SillyTavern could read it — in Google Cloud, restrict it to the Generative Language API." |
| Status | e.g. "Using your SillyTavern Google key · Gemini 3.8: working · DES key: working · 12 of 200 custom voices · 37 requests this session". Degraded: "No Google key found in SillyTavern. Add one under API Connections → Google AI Studio, or paste one above." / "Dialogue colouring is off, so DES can't tell who is speaking — everything will be read by the Narrator. [Turn on]". |
| Manager | **My custom voices…** (§8.6). |

---

## 7. Segmentation, presence and the scene rule

### 7.1 `segmentMessageForTts(messageId, {fromIdx})`

1. **Skip.** `[]` if no message, `is_system`, or `isSyntheticTrackerMessage(msg)`
   (`src/utils/messageGuards.js:37`). User message: `[]` unless `readUserMessages` or the call came
   from a bullhorn; then one dialogue segment with `speaker = resolveActiveUserName()`
   (`portraitBar.js:1392`).
2. **Bubbles applied → build from the DOM** so the voice always matches the printed name: walk
   **every** `.dooms-bubbles` container in `.mes[mesid=N]` (today's `getTextFromBubbleForward`,
   `:1507`, stops at the first graphics block), in `data-tts-idx` order; speaker from
   `data-speaker`, narration from `.dooms-bubble-narrator` / `.dooms-card-narrator`, text from
   `.dooms-bubble-text` / `.dooms-card-text` (Discord vs Cards style; the existing reader selects both,
   `chatBubbles.js:1510, 1517`).
3. **Bubbles off → parse.** Source: `.mes_text.innerHTML`, or
   `messageFormatting(msg.mes, msg.name, msg.is_system, msg.is_user, messageId)` when the element
   isn't in the DOM (as at `index.js:3086`). `messageFormatting` runs display regex scripts through
   `getRegexedString(…, {isMarkdown: true})` (`st/public/script.js:1860-1864`) [V], so DES's markdown-only
   tracker-JSON remover (`jsonCleaning.js:86-102`) applies. Put it in a detached div;
   remove `.dooms-inline-thought`, `.dooms-bubbles`, `details`, `img`, `style`, `script`, `pre`,
   `code`. For each `html` part of `splitGfxParts(div)`: `parseSegments(part, {messageId, persist:false})`.
   `persist:false` means reading never writes colours. Off-screen messages only have tags the model
   wrote itself; colored-dialogues tags exist only in the DOM [I].
4. **`normalizeSegments` (pure).** `stripHtml`, collapse whitespace, trim, drop empties; narrator →
   `{speaker:null, kind:'narration'}`; dialogue → `{speaker: resolveCharacterAlias(s) || null,
   kind:'dialogue'}`; merge neighbours with equal `(speaker, kind)`; split segments over 2,500
   characters at sentence ends (input limit is 8,192 tokens [V]); cap at `maxSegmentsPerMessage`
   by merging the tail into Narrator segments.
5. **`fromIdx`** (bubble "read from here"): start at the clicked bubble's `data-tts-idx`.
6. **Thought:** `{speaker: canonical(data-character), kind:'thought', text}` — `data-character` is
   lowercased (`thoughts.js:1605`), so canonical casing comes from a case-insensitive match on
   `getActiveKnownCharacters()` keys; text from `.dooms-inline-thought-content` `textContent`
   (HTML is inserted unescaped, `:1612`).
7. **Reasoning:** `{speaker:null, kind:'narration', text: msg.extra.reasoning}`.

Segments carry `ttsIdx`, never element references: bubbles replace `.mes_text` at +800 ms, so
stored elements go stale. The player resolves the highlight target at play time (§9.4). (Review A2.)

**Dependency on dialogue colouring.** Without `<font color>` tags everything is narration
(`chatBubbles.js:677-683`). Colouring defaults on (`state.js:35`) but old saved settings migrate to
off (`persistence.js:495-496`) [V]. The status line and Voice tab say so.

### 7.2 Voice resolution (pure)

```
resolveVoice({seg, present, stores, narrator, caps, registry}):
  if seg.kind === 'narration'            → narrator, 'narration'
  if !seg.speaker                        → narrator, 'unattributed'
  if !present                            → narrator, 'not-in-scene'
  ref = persona ? stores.userCharacters[p].voice
                : stores.characterVoices[caseInsensitiveKey(seg.speaker)]
  if !ref || !ref.id                     → narrator, 'no-voice'
  if registry[ref.id]?.status === 'gone' → fallback(ref), 'voice-gone'
  if ref.source !== 'stock' && !caps.direct && !caps.customIdOnSt
                                         → fallback(ref), 'needs-key'
  return ref, route(ref)
fallback(ref) = ref.fallbackStock ? stock(ref.fallbackStock) : narrator
narrator unplayable → stock 'Charon', 'narrator-fallback'
```

`characterVoices` is the live flat store, which *is* the active campaign version
(`campaignProfiles.js:1-34`), so decision 5 needs no code at play time.

### 7.3 `isPresentOnPanel(name, messageId, readers)` — read-only

```
n = structuralCanonical(resolveCharacterAlias(name), knownNames).toLowerCase()
if n === activePersona:  return showUserInPCP && !removedLower.has(n)
raw = trackerFor(messageId)                      // chat[id].extra.dooms_tracker_swipes[swipe_id],
                                                 // swipe_info fallback (trackerJsonInline.js:25-32)
   ?? walkBack(messageId)                        // nearest earlier assistant message with characterThoughts
   ?? (messageId is latest ? lastGeneratedData/committedTrackerData.characterThoughts : null)
entries = parseTrackerJson(raw) → array | .characters   // + legacy "- Name" lines (portraitBar.js:1279-1288)
names   = entries.filter(e => !isOffScene(e.thoughts) && !pendingAlias(e.name))
                 .map(e => structuralCanonical(resolveCharacterAlias(e.name), knownNames).toLowerCase())
return names.includes(n) && !removedLower.has(n) && !personaNames.has(n)
```

- Mirrors the panel rules at `portraitBar.js:1247-1377`, but never calls `getCharacterList()`,
  which writes `knownCharacters` and saves (`:1320-1334`) [V].
- Absent (greyed) characters are **not present** (`:1337-1343`).
- Presence comes from data, not from whether the bar is visible (`showPortraitBar`, `:473`) [I, design choice].
- Walk-back exists because together mode stores `characterThoughts: null` when a reply has no
  tracker (`sillytavern.js:218-222`) [V]. **Limitation shown to users:** a character who *just*
  entered, in a reply with no tracker (or in separate mode after the 8 s wait times out), is read
  by the Narrator for that message.

### 7.4 Edge cases

| Case | Rule |
|---|---|
| Quote with no font tag | Narration (parser splits only on `font[color]`) → Narrator. No new heuristic in v1. |
| Two present characters, one colour | Follow the bubble's attribution; warn in the Workshop (D14). The overwrite happens at `chatBubbles.js:410` (the "present characters override" pass, `:406-411`). |
| Aliases | Every speaker goes through `resolveCharacterAlias` (`characterAliases.js:48`) + case-insensitive key match. |
| Card `{{char}}` | Voiced only if the tracker lists them (prompt excludes only the user, `promptBuilder.js:181, 183`). Consequence of decision 3; stated in the UI. |
| Group chats | Same rules per reply; `chat[i].name` is not used for attribution; replies queue FIFO (D13). |
| Persona lines inside AI messages | Usually unattributed, because `buildColorToSpeakerMap` doesn't read `userCharacters[].color` → Narrator. Open question / M6. |
| Thoughts | Thinking character's voice if present, else Narrator. Removed characters' thoughts still render (`thoughts.js:1465` filters only pending decisions) and get the Narrator. |
| Reasoning | Narrator. |
| Scene headers | Outside `.mes_text` (`sceneHeaders.js:665-667`, `:539`) → excluded automatically. |

---

## 8. Voice lifecycle

### 8.1 Standard (30 voices) — ST route

- **List:** `voiceCatalog.js`, Google's spelling and traits [V SG]: Zephyr Bright, Puck Upbeat,
  Charon Informative, Kore Firm, Fenrir Excitable, Leda Youthful, Orus Firm, Aoede Breezy,
  Callirrhoe Easy-going, Autonoe Bright, Enceladus Breathy, Iapetus Clear, Umbriel Easy-going,
  Algieba Smooth, Despina Smooth, Erinome Clear, Algenib Gravelly, Rasalgethi Informative,
  Laomedeia Upbeat, Achernar Soft, Alnilam Firm, Schedar Even, Gacrux Mature, Pulcherrima Forward,
  Achird Friendly, Zubenelgenubi Casual, Vindemiatrix Gentle, Sadachbia Lively, Sadaltager
  Knowledgeable, Sulafat Warm. DES never calls ST's `/list-native-voices`.
- **Audition:** synthesise the test line on the resolved route; cached, so replays are free.
- **Stored:** `{source:'stock', id:'Kore', label:'Kore — Firm'}`. Never expires; never deleted.

### 8.2 Extended Voice Library — DES key

- **Browse:** `GET /v1beta/voices?type=prebuilt&search=…&gender=…&language_code=…&accent=…&page_size=50&page_token=…`
  [V API-V]. The response array key `voices` comes from the SDK example; the raw REST key is [I].
  Size is uncertain ("hundreds" / "150+" / "2,000+") — always paginate.
- **Audition:** `ListVoices` omits `sample_audio` [V] → synthesise the test line.
- **Stored:** `{source:'library', id, label: display_name, fallbackStock}`; not in the registry.
- **Expiry/delete:** none.

### 8.3 Designed — DES key

1. **Describe** (textarea). Google: "A clear 1–2 sentence description" of age, gender, timbre,
   texture, accent [V VD]. Optional gender, language, pitch (low/medium/high).
2. **Draft from card:** `generateRaw` with the character's `characterAppearance` and
   `characterInjection` text (precedent: `src/systems/integration/expressionSync.js:280` [V]); new
   prompt text in `defaultPrompts.js` asks for 1–2 sentences in Google's format. Result is editable;
   never auto-creates.
3. **Create:** `POST /v1beta/voices {store:true, voice:{type:'prompted', display_name,
   prompted:{input}, gender?, language_code?, pitch?}}` [V API-V]. `store:true` is required for
   prompted voices. `model` is **omitted** until M0 shows which ids are valid there (review A11).
4. Response `sample_audio` (base64 WAV) plays immediately, memory only. Save `id`, `expire_time`.
5. **Use this voice** → VoiceRef + registry entry (`designPrompt`, `expireTime`, `keyTag`,
   `status:'ok'`). **Try again** → asks, then deletes the previous draft and creates a new one.
   **Discard** → `DELETE /v1beta/voices/{id}` (D17). Warning shown: "Each try uses one of your 200
   custom voice slots until discarded." Whether creation is billed is [U].

### 8.4 Cloned — DES key, consent required

Four-step wizard in `voiceStudio.js`:

1. **Rights notice + DES checkbox** "I own this voice or have the speaker's permission" (DES's own;
   Google documents only the spoken consent [V]). Text: "Only clone your own voice, or an adult's
   who is recording with you and agrees. Google checks that the consent recording matches the
   sample; DES can't check who is speaking. Voice cloning may not be available in some regions."
   (Google's blog lists Illinois, Texas, EEA, UK, Switzerland and India *for AI Studio*; whether that
   applies to the API is [U], so the UI doesn't state it as a rule.)
2. **Sample:** record (`MediaRecorder`) or upload WAV/MP3; 10–30 s of clean speech [V VR]; level
   meter; timer turns green 10–30 s; uploads over 30 s are refused.
3. **Consent:** locale select → the **exact** statement from `consentPhrases.js`, shown large.
   English: "I am the owner of this voice and I consent to Google using this voice to create a
   synthetic voice model." [V]. Hint: "Use the same microphone and room as the sample." Google's
   table says "30 supported language locales" but lists 29 rows [V] — copied exactly as given.
4. **Create:** both clips → 24 kHz mono 16-bit WAV via `wav.js`, base64;
   `POST /v1beta/voices {store:true, voice:{type:'replicated', display_name,
   replicated:{source_audio:{mime_type:'audio/wav',data}, consent_audio:{mime_type:'audio/wav',data}}}}`.
   `store` always explicit (docs disagree on its default [V]). No `sample_audio` → preview via the test line.

**Recordings live only in wizard memory,** are released on close, and are never written to
settings, localStorage, IndexedDB, ST files or exports. So a lost clone must be re-recorded; the
wizard says so up front.

**Secure context.** `getUserMedia` needs HTTPS or localhost; a phone on `http://192.168.x.x:8000`
can't record [I, web platform]. If `!window.isSecureContext`, offer upload only, with one line of
explanation. **Errors:** the code for a failed consent/speaker check is [U]; any 4xx on create shows
Google's message and a **Re-record consent** button.

### 8.5 Expiry, "gone", recovery

- Stored voices expire after 1 year [V]; what happens then is [U] (error code, listing, renewal).
- Registry keeps `expireTime`. Within 30 days: amber badge in Voice tab and manager.
- **Recreate** (designed): re-runs `designPrompt`, then `rewriteVoiceRefs(oldId, newId)` updates
  every reference in every version in one pass. The new voice may not sound identical [I].
  Cloned: "Re-record to renew".
- A synthesis error classed `voice-gone` (404/NOT_FOUND on the voice; exact code [U], settled in
  M0) sets `status:'gone'`, falls back (§7.2) and shows one toast per voice per session:
  "Mara's voice is no longer available on Google, so the Narrator is reading her."

### 8.6 Reference counting, deletion, quota

- `forEachVoiceRef(visit)` visits live `characterVoices`, `userCharacters[*].voice`,
  `voices.narratorVoice`, `campaignBaseShadow`, and **inactive** buckets; it skips the active bucket
  (stale between saves, `campaignProfiles.js:454-460`). Only designed/cloned ids are counted.
- **`rewriteVoiceRefs(oldId, newId|null)`** (new writer — review B7): edits live stores,
  `userCharacters`, the Narrator, the shadow and every bucket through `writeVersion`, then
  `saveSettings()`; the active bucket is rebanked by `bankActiveCampaign` by construction.
  `null` deletes the reference (the character falls back to the Narrator).
- **Manager** (Settings → Voices → My custom voices): label, kind, "Used by: Mara (Base, Iron Crown),
  Narrator", expiry, ▶. **Delete** warns with the user list, calls `DELETE /v1beta/voices/{id}`
  (resource name `voices/voice_…`), then `rewriteVoiceRefs(id, null)` so nothing fails silently later.
  **Remove unused voices…** lists refcount-0 entries.
- **Deleting a character/version/campaign** (`deleteCharacter` `characterWorkshop.js:2902-2994`, `removeVersion`,
  `purgeCharacter`, `deleteCampaign` `campaignManager.js:107`) never calls Google (D16); the manager's
  unused list just grows.
- **Quota:** 200 stored voices per **project**, shared by designed and cloned [V];
  `RESOURCE_EXHAUSTED` when exceeded [V]. The manager counts `GET /v1beta/voices?type=prompted&type=replicated`
  (includes voices made outside DES [I]) → "N of 200 used"; Create buttons disable at 200 with
  "Delete unused voices to make room". Project voices DES doesn't know can be imported into the registry.

### 8.7 Export and import

- `exportDraft` (`:3382-3397`) adds `voice: {source, label, id (stock/library only), fallbackStock,
  designPrompt (designed only)}`. `voice_…` ids are project-bound and not exported; clone audio never.
- `importCharacterPayload` (`characterRoster.js:989-1088`): stock checked against the 30; library
  imported as-is; designed → `{source:'designed', id:null, label, pendingDesign}` with a one-click
  "Create this voice" in the Voice tab; cloned → nothing, with a note. Import writes the live store,
  i.e. the active campaign version. `pendingDesign` is treated as plain text; imports never auto-play.

---

## 9. Playback engine (`player.js`, `autoRead.js`)

### 9.1 Jobs and queue

`job = {id, messageId, swipeId, source: 'auto'|'bubble'|'message'|'thought'|'reasoning'|'audition',
segments: [{text, ref, route, model, style?, ttsIdx?, kind}]}`.

- **Manual** (any bullhorn) → `replaceWith(job)`: stop, abort in-flight fetches (`AbortController`),
  clear queue, play. Matches ST's `/speak` reset (`onNarrateText`, `st/…/tts/index.js:173`).
  Clicking the bullhorn that is currently playing acts as Stop.
- **Auto** → `enqueue(job)`, **FIFO per chat** (D13). A swipe/regenerate of message *N* replaces
  any queued or playing job for *N*.

### 9.2 Pipeline

- One synthesis request in flight; segment *k+1* is fetched while *k* plays (prefetch one ahead).
  Gentle on unpublished per-project rate limits [V RL] while hiding most gaps.
- Not ready when the previous segment ends → wait; the target bubble gets `.dooms-tts-loading`.
- Single DES `Audio` element `#dooms-tts-audio` (never ST's `#tts_audio`), created lazily;
  object URLs revoked on `ended`/eviction; `playbackRate` applied.
- **Autoplay unlock** (iOS and others): on the first bullhorn or toggle click, play a silent
  clip on the DES element — ST does the same with `/sounds/silence.mp3` (`st/…/tts/index.js:159, 178`).
  If `play()` rejects with `NotAllowedError`: toast "Tap any bullhorn once to allow auto-read on this device."

### 9.3 Stop and cancel

Stop + clear on: `MESSAGE_SWIPED`, `MESSAGE_DELETED`, `CHAT_CHANGED` (as ST does,
`st/…/tts/index.js:1574-1576`); the user sending a message (`MESSAGE_SENT`, `st/public/scripts/events.js:8`,
emitted at `st/public/script.js:5910, 5917`; DES already listens, `index.js:3436`) [V]; toggling voices off; the playing bullhorn clicked again. Closing the
Workshop stops auditions only. **Not** on `GENERATION_STARTED` (D13).

### 9.4 Highlighting

At segment start, resolve the target now: `.mes[mesid=N] [data-tts-idx="k"]` if bubbles exist,
else the `.mes`. Add `.dooms-tts-speaking` (+ legacy `.tts-speaking` on the `.mes`, for an unknown
external consumer) and the bullhorn "playing" state; **remove on `ended`, `pause`, `error`, stop**
(fixes `chatBubbles.js:1545-1613`). Optionally emit ST's `TTS_JOB_STARTED`, `TTS_AUDIO_READY`,
`TTS_JOB_COMPLETE` (`st/public/scripts/events.js:105-107`) for lip-sync-style extensions; nothing
in ST core listens [V].

### 9.5 Bullhorns and entry points

| Entry | When voices on | When off |
|---|---|---|
| Bubble "read from here" (`chatBubbles.js:1528-1623`) | `speakFromBubble` → segments from `data-tts-idx` | `/speak`, escaped |
| Thought (button `thoughts.js:1609`, handler `chatBubbles.js:1566-1592`) | `speakThought` → character voice, presence-gated | `/speak`, escaped |
| Reasoning (`chatBubbles.js:1631-1649`) | `speakReasoning` → Narrator | `/speak`, escaped |
| **New** message bullhorn (`injectMessageTtsButtons`, in `.mes_buttons`) | `speakMessage` — the whole message, works with bubbles on **or off** | not injected |
| ST `.mes_narrate` (optional) | capture-phase listener + `stopImmediatePropagation` → `speakMessage` | untouched |
| ST wand "Narrate All", `/speak` | untouched — deliberately ST voices | untouched |

### 9.6 Auto-read trigger

1. **Arm** on `GENERATION_STARTED(type, args, dryRun)` unless `dryRun` or type `quiet`/`impersonate`
   (ST's filter, `st/…/tts/index.js:1214-1216`). Needed because DES's `isAwaitingNewMessage` is
   cleared at the end of `onMessageReceived` (`sillytavern.js:350`).
2. **Disarm** on `GENERATION_STOPPED` (`events.js:24`) and drop any queued auto job for that
   message. Because firing happens ~800 ms after render, this also catches a STOPPED that arrives
   *after* RENDERED on an aborted stream (`onErrorStreaming` still emits both, `script.js:3826-3829`);
   the actual order is [U] (§15).
3. **Fire** from `voiceBoot.onMessageDecorated(messageId, type)`, called by the `index.js:3196-3205`
   timer after 800 ms + `waitForAliasDecisions()` — the same moment bubbles are applied (D4). That
   timer is restructured to run with bubbles on or off.
   - **Together mode:** DES's parsing finished at `MESSAGE_RECEIVED` (`sillytavern.js:160-296`, no
     awaits) → segment and enqueue.
   - **Separate/external mode with `autoUpdate`:** wait for `DOOMS_TRACKER_UPDATE_COMPLETE`
     (`apiClient.js:11`, emitted `:483` in `finally`) with an 8 s timeout; on timeout use walk-back
     presence. Timeout needed: the event also fires on manual Refresh and never fires if
     `updateRPGData` returns early (`:252-267`).
4. **Types:** `normal`, `regenerate`, `swipe` (new generation) → read. `continue` → re-segment and
   read only segments after the stored `{messageId, swipeId, readText}` prefix (like
   `st/…/tts/index.js:1150-1163`). Existing-swipe navigation, edits (`MESSAGE_UPDATED`), and
   `first_message` (never armed) → not read.
5. **Dedupe:** hash of `(messageId, swipeId, text)` (ST does the same, `:1141`).
6. **Budget:** each auto request counts toward `sessionRequestBudget`; at the limit auto-read
   pauses with a toast; bullhorns keep working.

### 9.7 Pausing ST's auto-read without touching its settings

```js
// src/systems/voices/stAutoReadGuard.js
import { extension_settings as st } from '../../../../../../extensions.js'; // depth as other DES imports
let realAutoGen, guarded = false;
export function installStAutoReadGuard(isActive) {
  const tts = st.tts; if (!tts || guarded) return false;
  realAutoGen = tts.auto_generation;
  Object.defineProperty(tts, 'auto_generation', { configurable: true, enumerable: true,
    get: () => (isActive() ? false : realAutoGen),
    set: (v) => { realAutoGen = v; } });           // ST's checkbox (onAutoGenerationClick, :952) still records the real choice
  Object.defineProperty(tts, 'toJSON', { configurable: true, enumerable: false,
    value() { const o = {}; for (const k of Object.keys(this)) o[k] = this[k]; o.auto_generation = realAutoGen; return o; } });
  return (guarded = true);
}
export function uninstallStAutoReadGuard() {
  const tts = st.tts; if (!guarded || !tts) return;
  delete tts.toJSON; delete tts.auto_generation; tts.auto_generation = realAutoGen; guarded = false;
}
```

- `isActive = () => extensionSettings.voices.enabled` (D2).
- Covers both ST paths: `onMessageEvent` (`st/…/tts/index.js:1108`) and the streaming path, whose timer
  only starts if `auto_generation` is true in `onGenerationStarted` (`:1226-1244`) and whose ticks go
  through `onMessageEvent` (`:1283`); both read the value at call time [V].
- ST saves with `JSON.stringify` of a payload holding `extension_settings` (`st/public/script.js:8085,
  8098-8101`) [V], so the non-enumerable `toJSON` keeps the user's real value on disk.
- ST's TTS loads first (`loading_order` 10 vs DES 100; `activateExtensions` awaits each extension in
  order, `extensions.js:568-640`, including TTS's `activate` hook `init` — which runs `loadSettings`,
  `tts/index.js:1570` — subject to a 5 s hook timeout, `extensions.js:406-450`) [V].
  `extension_settings.tts` always exists — ST's defaults contain `tts: {}` (`extensions.js:186`) — so the
  guard also installs when ST TTS is disabled; it is inert there and DES playback is unaffected. (If the
  guard ever installed before TTS's `loadSettings`, the enumerable `auto_generation` would make it skip
  the bulk default copy at `tts/index.js:868-870`; the per-key loop at `:871-875` still fills the rest.)
- Installed by `voiceBoot` on enable; removed on disable and in `unregisterAllEvents`. A console
  warning fires if the property descriptor is later replaced.
- `stopStPlayback()`: if `#tts_audio` exists and is not paused, click `#ttsExtensionMenuItem` once —
  the only exposed way to reach ST's `resetTtsPlayback` (`:416-421`). Hacky; documented as such.
  Caution [V]: when ST is idle the same click *plays the last message* (`:422-425`), and ST's
  `isTtsProcessing()` (`:241-253`) is module-private, so `!#tts_audio.paused` is the only busy test DES
  has; an ST job still synthesising (not yet playing) is not stopped.
  Called when DES starts playing.

---

## 10. Cost, rate limits, caching

**Prices** (paid tier, per [V PR]):

| Model | Through 2026-12-31 | From 2027-01-01 |
|---|---|---|
| `gemini-3.8-flash-lite-tts` | $6 / 1M audio tokens ≈ $0.0015 per 10 s | $12 ≈ $0.003 per 10 s |
| `gemini-3.8-flash-tts` | $9 / 1M ≈ $0.00225 per 10 s | $18 ≈ $0.0045 per 10 s |

Free tier lists both models as free, with data "used to improve our products" [V]. Voices API
(create/list) pricing is [U]. Settings copy: "About 54 cents per hour of speech on Flash-Lite
(about 81 cents on Flash) until the end of 2026; Google doubles these on 1 January 2027. On Google's
free tier your text may be used to improve Google's products." [I arithmetic: 25 audio tokens/s [V PR]
× 3,600 s = 90,000 audio tokens per hour × $6 or $9 per 1M; text input adds well under a cent.]

**Rate limits.** No per-model RPM/RPD published; limits are per project [V RL]. One request in
flight; on 429/`RESOURCE_EXHAUSTED` back off 2 s → 4 s → 8 s, then skip the segment with one toast;
after two consecutive give-ups auto-read pauses for the session. Creation 429s are shown inline, not retried.

**Cache.** In-memory LRU in `player.js`, key `sha1(route|model|voiceId|style|text)`, cap ~40 MB /
150 entries; auditions survive `CHAT_CHANGED`, chat lines are cleared then. Makes re-reads and
"read from here" after an auto-read free. No persistent cache in v1.

**Batching.** Adjacent same-speaker (and adjacent narration) segments are merged (§7.1). **Two-speaker
requests are not used in v1:** they are legal only with **prebuilt** voices, at most 2 speakers,
with `speaker` in every turn [V SG]; they need the direct route (ST's route sends one voice), lose
per-line highlighting, and clash with narration between lines. M6 may use them only for jobs that
are exactly two present stock-voiced speakers with no narration between.

---

## 11. Style direction (optional, M6, direct route only)

- `voices.styleFromTracker`, off by default. When on, the direct route sends a 1–4 word
  `speech_metadata.style` (e.g. "tense, hushed") derived from that character's tracker entry for the
  message — a mood/emotion field if the user's tracker config has one. Which key to read depends on
  the user's tracker customisation and is **[U]**; picked from the Tracker Editor config at build time.
- Never age, gender, names or accent in style; short constant strings preferred [V SG].
- Never sent on the ST route; never prepended to text (D18). Style is part of the cache key, so it
  reduces cache hits — the helper says so.

---

## 12. Errors and degraded modes

| Condition | Detected by | Behaviour |
|---|---|---|
| Voices off | setting | Old behaviour: bullhorns use `/speak` (now escaped). No voice code loaded. |
| No ST key and no DES key | probe fails `no-key`; `secret_state` hint | Bullhorn toast: "Add a Google AI Studio key in SillyTavern (API Connections → Google AI Studio) or in DES → Voices." Auto-read disarms. |
| ST route can't do 3.8 | probe `model-unavailable`/`argument` | Stock voices on 3.1 via ST (§5.3), status line. |
| Custom voice, no key on this device | caps | `fallbackStock` or Narrator; one toast per voice per session. |
| Voice expired / gone | `voice-gone` | `status:'gone'`, fallback, toast, red badge + Recreate. |
| Different-project key | `voice-gone` with `keyTag` mismatch | "Created with a different key (…a1B2)". |
| 429 / quota | `rate`/`quota` | Backoff, skip, then pause auto-read; bullhorns keep working. |
| `RESOURCE_EXHAUSTED` on create | `quota` | Open manager at "Unused voices" + slot counter. |
| Bad / unrestricted key | 400/401/403 | "Google rejected this key." Keys made since 2026-05-28 are auth keys; unrestricted standard keys are rejected [V KEY] → restriction hint. |
| Network / timeout (20 s) | fetch | Skip segment, continue; one toast per job. |
| Content blocked (no audio part) | empty response | Skip; log reason text (never the key) to the DES log. |
| ST TTS extension disabled/missing | ST's own `extension_settings.disabledExtensions` list (exact entry name for the built-in TTS [I]) | Guard installs but is inert (`extension_settings.tts` always exists, `st/public/scripts/extensions.js:186`); **DES playback unaffected** — `/api/google/…` is a server route independent of the TTS extension [V]. |
| Dialogue colouring off | setting | Everything Narrator; notice in status line and Voice tab. |
| Autoplay blocked | `NotAllowedError` | Tap-a-bullhorn toast (§9.2). |
| Budget reached | counter | Auto-read paused toast; bullhorns still work. |
| Clone consent rejected | 4xx on create | Google's message + Re-record consent. |

---

## 13. Security and privacy

**The optional key.** localStorage only, per ST user where possible (D19); never in settings,
logs or exports; sent only to `generativelanguage.googleapis.com`; masked in the UI; Remove button.
The settings text states the trade-off and Google's own guidance ("Never expose keys client-side in
production" [V KEY]) — a user's own key on their own install is lower risk [I] — and recommends
restricting the key to the Generative Language API. The fully server-side path is the upstream PR (§5.4).

**What leaves the machine** (listed in one helper paragraph): the text of each line read and the
voice id (via the user's ST server — which logs the text with `console.debug`, `google.js:361` — or
directly to Google); voice descriptions; for clones, two recordings, once. Interactions calls send
`store:false`. On the free tier Google may use the data to improve its products [V PR].

**Cloning consent.** DES checkbox + Google's spoken statement verbatim per locale; recordings never
stored; region uncertainty disclosed; no "clone from chat audio" feature, now or later.

**Also fixed:** unescaped `/speak` (`chatBubbles.js:1557/1587/1617`); user ST regex overwrite
(`index.js:3111-3115`).

---

## 14. Testing

### 14.1 `tools/*.mjs` (plain Node, no packages — the repo has no `package.json`)

Only DOM-free code is unit-tested; `chatBubbles.js` imports ST's `script.js` and can't load in
Node, and `load-check.mjs`'s "DOM" is a stub Proxy (`:64-80`). (Review claim 5.)

| File | Covers |
|---|---|
| `tools/campaign-profiles-test.mjs` (extend) | voice cloned by `addProfile`; `addVersion` override copies Base's voice when another version is on stage (D11); banked by `bankActiveCampaign`; restored by switch; carried by alias adopt; `forEachVoiceRef` skips the active bucket; refcount shared across Base, a campaign, the Narrator and a persona; `rewriteVoiceRefs` rewrites live, shadow and inactive buckets and survives a switch; `null` deletes. |
| `tools/voice-resolve-test.mjs` | table: narration; unattributed; not present; present/no voice; present/stock; custom without key (with/without fallback); `customIdOnSt`; gone; persona with/without `showUserInPCP`; alias and case-insensitive keys; narrator unplayable → Charon; route choice incl. `preferDirectForStock` and style. |
| `tools/voice-presence-test.mjs` | injected readers: swipe data; null `characterThoughts` walk-back; latest-message fallback; off-scene regex; pending alias; removed/banned; persona names; legacy "- Name"; **readers are never written** (frozen inputs). |
| `tools/voice-segment-test.mjs` | pure `normalizeSegments`: merge rules, empty drops, 2,500-char sentence split, segment cap, alias resolution, continue-prefix diff. |
| `tools/st-autoread-guard-test.mjs` | getter false while active; setter records real value; `JSON.stringify` writes the real value; uninstall restores a plain property. Guards against ST moving to `structuredClone`. |
| `tools/voice-settings-guard-test.mjs` | `ensureVoiceSettings` on old saved settings: fills sub-keys, never clobbers existing ones, repairs non-objects. |
| `tools/wav-test.mjs` | WAV header bytes for 24 kHz mono 16-bit; PCM round-trip. |
| `tools/lazy-graph-test.mjs` (new) | walks static `import` statements from `index.js`; fails if any lazy voice module is reachable. |
| `tools/gemini-tts-probe.mjs` (manual, M0) | runs the §15 checks against Google with `GEMINI_API_KEY` from the environment; never committed with a key. |

`node tools/load-check.mjs` remains the pre-push gate.

### 14.2 Manual test script

1. **Voices off:** no voice modules in the Network tab; bubble bullhorn uses `/speak`; a `|` in dialogue no longer breaks it.
2. **Probe:** with only ST's key, status line shows the route and effective model.
3. **Scene rule (together mode):** Mara = Kore, Tom = no voice, Vex = Puck but off-scene. Mara in Kore; Tom, Vex and narration in the Narrator.
4. **Removed:** hide Mara from the panel, read an *old* message where she was present → Narrator (D6).
5. **Separate mode:** auto-read waits for the tracker; with auto-update off, walk-back presence applies.
6. **Campaigns:** "+" on Mara while a *campaign* version is on stage → new version has Base's voice. Change to Puck in the campaign; switching campaigns switches the voice.
7. **No double play:** ST auto-read on + DES voices on (auto-read off) → a new message plays nothing from ST. DES auto-read on → plays once, in DES voices. Reload → ST's checkbox still ticked. DES voices off → ST reads again.
8. **Colored-dialogues extension** colouring instead of model colours → auto-read still attributes speakers.
9. **Bubbles off:** DES message bullhorn reads per-speaker; whole `.mes` highlighted; highlight clears at end.
10. **Thoughts / reasoning:** character voice / Narrator.
11. **Continue, swipe, regenerate, delete, chat change, stop mid-stream;** group chat: both members' replies are read in order.
12. **iOS/Safari:** auto-read before any tap shows the unlock toast; after one tap it works.
13. **DES key:** library browse, pick, set fallback; second device without key plays the fallback.
14. **Design:** draft from card, create, hear sample; Try again deletes the previous draft (slot count unchanged); Cancel Workshop → voice appears under Unused.
15. **Clone:** record both clips; wrong consent phrase is rejected; over LAN HTTP only upload is offered.
16. **Manager:** Used by lists versions; delete a used voice → warning, then those characters use the Narrator.
17. **Expiry:** delete a voice in Google directly → one toast, fallback, red badge.
18. **Budget:** set to 3 → auto-read pauses after 3 requests.
19. **Layout:** six tabs at 1001 px and 1440 px, 375 px phone; all ten themes; performance mode / reduced motion → no pulse.

### 14.3 `docs/parity-checklist.md` lines

- Change `:40` "the five section tabs … (icons only between 641–860px …)" → "the six section tabs (… Knives, Voice) run horizontally (icons only at ≤1000px, scrollable strip on a phone)".
- New section **Voices**:
  - [ ] **Voices off costs nothing**: only `voiceBoot.js` loads; bullhorns use SillyTavern's `/speak` with escaped text.
  - [ ] **Workshop Voice tab**: standard grid with preview; Library locked without a key; Design and Clone open the studio; voice is per campaign version and "+" copies Base's voice; personas get the tab without versions.
  - [ ] **Narrator voice** picker in settings accepts any source.
  - [ ] **Scene rule**: a voice plays only while the character is present for that message; removed/hidden characters, unattributed lines, characters with no voice and unplayable voices use the Narrator.
  - [ ] **Bullhorns** (bubble, DES message button, thought, reasoning) use DES voices; highlight clears when the line ends.
  - [ ] **Auto-read** reads each new AI message once, after decoration, in order in group chats; stops on swipe, delete, chat change and user send; continue reads only the new part.
  - [ ] **SillyTavern's auto-read** is paused while DES voices are on, and its saved setting is unchanged on disk.
  - [ ] **Optional Google key** is stored only in this browser, never in settings.json.
  - [ ] **Custom voice manager**: used-by, expiry badge, Recreate, slot counter, delete clears references.
  - [ ] **Export/import** carries standard/library voices and design descriptions, never clone audio or project-bound ids.

---

## 15. What we still need to verify

Everything here is unverified. **M0 is run by the maintainer (or whoever holds a Google AI Studio
key) before M1 is committed.** Stop rule: if check 1 *and* the 3.1 fallback both fail on the ST
route, the default route is not viable — pause and take the upstream PR (§5.4) to the user before
building M1+.

| # | Question | How to verify | If the answer differs |
|---|---|---|---|
| 1 | Does 3.8 accept single-speaker `prebuiltVoiceConfig.voiceName` + `safetySettings` (exactly what ST sends)? | `curl -s -X POST "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash-lite-tts:generateContent" -H "x-goog-api-key: $GEMINI_API_KEY" -H "Content-Type: application/json" -d '{"contents":[{"role":"user","parts":[{"text":"Ready."}]}],"generationConfig":{"responseModalities":["AUDIO"],"speechConfig":{"voiceConfig":{"prebuiltVoiceConfig":{"voiceName":"Kore"}}}},"safetySettings":[{"category":"HARM_CATEGORY_HARASSMENT","threshold":"OFF"},{"category":"HARM_CATEGORY_HATE_SPEECH","threshold":"OFF"},{"category":"HARM_CATEGORY_SEXUALLY_EXPLICIT","threshold":"OFF"},{"category":"HARM_CATEGORY_DANGEROUS_CONTENT","threshold":"OFF"},{"category":"HARM_CATEGORY_CIVIC_INTEGRITY","threshold":"OFF"}]}' \| jq '.error // .candidates[0].content.parts[0].inlineData.mimeType'` then repeat without `safetySettings`. Then in the browser console on ST: `fetch('/api/google/generate-native-tts',{method:'POST',headers:SillyTavern.getContext().getRequestHeaders(),body:JSON.stringify({text:'Ready.',voice:'Kore',model:'gemini-3.8-flash-lite-tts'})}).then(r=>r.status)` | No → probe downgrades the ST route to 3.1 (§5.3); upstream PR becomes more important. Only `safetySettings` fails → same, and PR item 2 includes dropping them. |
| 2 | Does `prebuiltVoiceConfig.voiceName` accept a `voice_…` or library id? | Same curl with `voiceName` set to a designed voice id created in check 6, and to a library id from check 4. | Yes → `customIdOnSt` true; custom voices play without the DES key when made in the same project. |
| 3 | Primary direct shape works: generateContent + `voiceConfig.voice`; response mimeType. | `curl … :generateContent -d '{"contents":[{"role":"user","parts":[{"text":"Ready.","speech_metadata":{"style":"calm"}}]}],"generationConfig":{"responseModalities":["AUDIO"],"speechConfig":{"voiceConfig":{"voice":"Kore"}}}}' \| jq '.candidates[0].content.parts[0].inlineData.mimeType'` | Fails → Interactions becomes primary (already implemented as fallback). |
| 4 | REST list key name, library id format, library size. | `curl -G "https://generativelanguage.googleapis.com/v1beta/voices" -H "x-goog-api-key: $GEMINI_API_KEY" --data-urlencode type=prebuilt --data-urlencode page_size=5 \| jq 'keys, .voices[0]'` | Adjust `listVoices` parsing; ids that aren't plain names still work via `voiceConfig.voice`. |
| 5 | Interactions accepts 3.8 TTS (missing from Google's model table). | `curl -X POST ".../v1beta/interactions" … -d '{"model":"gemini-3.8-flash-lite-tts","store":false,"input":[{"type":"user_input","content":[{"type":"text","text":"Ready."}]}],"response_format":{"type":"audio"},"generation_config":{"speech_config":[{"voice":"Kore"}]}}'` | No → drop the Interactions fallback. |
| 6 | Create a prompted voice; does `model` on CreateVoice accept the Lite id? `usage` present (billing)? | `curl -X POST ".../v1beta/voices" … -d '{"store":true,"voice":{"type":"prompted","display_name":"probe","prompted":{"input":"A calm middle-aged narrator with a warm low voice."}}}' \| jq '{id,expire_time,usage}'` then with `"model":"gemini-3.8-flash-lite-tts"`; then DELETE both. | Lite rejected → keep `model` omitted (planned). `usage` present → label creation "may cost". |
| 7 | Error codes: unknown voice id, deleted voice, quota, bad key. | Synthesize with `voice_doesnotexist`; with a deleted id from check 6; with a malformed key. Record status + `error.status`. | Tune `classifyError`; `voice-gone` mapping. |
| 8 | Expiry behaviour / renewal. | Not testable before 2027. Watch Google changelog. | Recreate flow stays the plan either way. |
| 9 | CreateVoice `store` default (docs conflict). | Irrelevant — DES always sends it. | — |
| 10 | Replication region block applies to the API? | Ask a tester in a listed region, or watch the error on create. | If yes, show region note as a rule. |
| 11 | Consent locales: "30" vs 29 rows. | Re-read the replication guide at build time. | Copy whatever the table has. |
| 12 | Streaming SSE framing for TTS over REST (`step.delta` audio JSON; `:streamGenerateContent?alt=sse`?). | curl with `"stream":true` / `?alt=sse`, inspect raw events. | M6 only. |
| 13 | MP3/Opus response formats for TTS. | `responseFormat.audio.mimeType` variants. | Smaller cache entries if yes; not needed for v1. |
| 14 | Voice-specific clauses in Google's Prohibited Use Policy / Additional Terms. | Read the policy pages. | Update clone notice. |
| 15 | ST: is `.mes_narrate` hidden when ST TTS is off (`body.tts` CSS)? | Search `public/css/` in a full ST checkout for `.mes_narrate`. | Only affects the optional intercept (D12). |
| 16 | ST: order of `GENERATION_STOPPED` vs `CHARACTER_MESSAGE_RENDERED` on aborted streams. | Read `onErrorStreaming` / `stopGeneration` in `public/script.js`; stop a stream with logging listeners on both. | If STOPPED can arrive >800 ms later, also check ST's stopped/partial flag before reading. |
| 17 | ST: event emitter awaits listeners in order. | Read `public/lib/eventemitter.js` (not in the sparse clone). | If not, together mode also waits for the next tracker update or a frame. |
| 18 | ~~ST: `messageFormatting` applies display regex scripts.~~ **Resolved [V]:** yes — `getRegexedString(mes, placement, {isMarkdown: true, …})` at `st/public/script.js:1860-1864`, so markdown-only scripts such as DES's JSON remover run. | — | — |
| 19 | ~~ST: `MESSAGE_SENT` event name.~~ **Resolved [V]:** `MESSAGE_SENT: 'message_sent'` (`st/public/scripts/events.js:8`), emitted at `st/public/script.js:5910, 5917`; DES already registers it (`index.js:3436`). | — | — |
| 20 | ~~ST: how an extension reads the current user handle.~~ **Resolved [V]:** `getCurrentUserHandle()` in `st/public/scripts/user.js:54` (returns `'default-user'` without a login); not exposed on `getContext()`. | — | Import fails → un-namespaced key (D19). |
| 21 | ~~ST: whether `generateRaw` emits `GENERATION_STARTED`.~~ **Resolved [V]:** no — `generateRaw` (`st/public/script.js:4122`) calls `generateRawData` (`:4000`), which emits only `GENERATE_AFTER_COMBINE_PROMPTS` / `CHAT_COMPLETION_PROMPT_READY` (`:4031, :4037`); `GENERATION_STARTED` is emitted by `Generate` (`:4299`). "Draft from card" cannot arm auto-read. | — | — |

---

## 16. Phased delivery

Each milestone ships behind the master toggle (off by default), with a plain-language
`CHANGELOG.md` + `whatsnew.json` entry and parity-checklist lines.

| # | Milestone | What the user can do after it | Files | Test | Size |
|---|---|---|---|---|---|
| **M0** | **Prove the unknowns** (not shipped) | Nothing visible. Answers §15 #1-7, 15-17 (#18-21 were settled from source during the fact-check); results appended to this doc. Includes the `chatBubbles.js` refactor (`parseSegments`, `splitGfxParts`, `getOriginalBubbleHtml`, `data-tts-idx`, `isLatest` fix) since it is behaviour-neutral. | `tools/gemini-tts-probe.mjs`, `chatBubbles.js` | probe script; `load-check`; manual bubble regression | ~350 |
| **M1** | **DES voices (beta): Narrator voice** | Turn on DES voices; every bullhorn (plus the new message bullhorn) reads in one chosen standard voice on Gemini 3.8 (or 3.1 via probe); optional auto-read; ST's auto-read paused, nothing plays twice; highlights clear; `/speak` escaping and TTS regex fixes. | new `voices/{voiceBoot,stAutoReadGuard,voiceSettings,voiceEngine,segmenter,player,autoRead,transport,capabilityProbe,voiceCatalog}.js`; edits `state.js`, `persistence.js`, `index.js` (settings, events, decoration timer, `onChatChangedTtsCleanup`), `chatBubbles.js` (incl. the thought-bullhorn handler), `template.html` (accordion), `style.css`, `en.json` | `st-autoread-guard`, `voice-settings-guard`, `voice-segment`, `lazy-graph`; manual 1-2, 7-12 | ~900 |
| **M2** | **Per-character standard voices + scene rule** — the core request | Pick one of 30 voices per character in the Workshop Voice tab, per campaign version; present characters speak in their voice, everyone else in the Narrator's; thoughts in the character's voice; export/import; optional `.mes_narrate` intercept. | new `voices/{presence,voiceResolver,voiceRegistry}.js`, `ui/voicePane.js`, `utils/offScene.js`; edits `campaignProfiles.js`, `characterWorkshop.js`, `characterAliases.js`, `characterRoster.js`, `campaignManager.js`, `portraitBar.js`, `template.html` (tab), `modals.css`, `en.json`, `parity-checklist.md` | `campaign-profiles` (extended), `voice-presence`, `voice-resolve`; manual 3-6, 19 | ~1,100 |
| **M3** | **Optional key + Extended Voice Library** | Paste a key; browse and preview the library; set fallback voices for devices without the key; library voice as Narrator. | `transport.js` (Direct), `capabilityProbe.js` (custom-id bonus), `voicePane.js`, `voiceSettings.js`, `template.html`, `index.js` | `voice-resolve` additions; manual 13 | ~500 |
| **M4** | **Voice Design + custom voice manager** | Describe a voice (or draft from the card), hear it, keep or discard; expiry warnings, Recreate, "Used by", slot counter, delete. | new `ui/voiceStudio.js`; `voiceRegistry.js`, `campaignProfiles.js` (`rewriteVoiceRefs`), `defaultPrompts.js`, `characterWorkshop.js` (export), `characterRoster.js` (import) | `campaign-profiles` rewrite cases; manual 14, 16, 17 | ~900 |
| **M5** | **Voice Cloning** | Record or upload a sample and a consent recording; create a cloned voice. | `ui/voiceStudio.js`, `utils/wav.js`, `voices/consentPhrases.js` | `wav-test`; manual 15 | ~700 |
| **M6** | **Extras** (each behind its own setting) | Style from tracker mood; streaming on the direct route; two-speaker batching for stock pairs; persona colour attribution; persistent audio cache. | `player.js`, `transport.js`, `segmenter.js` | per feature | ~200-500 each |
| **M7** | **Upstream ST PR + `UpstreamTransport`** | Library/design/clone with no DES key at all. | ST `src/endpoints/google.js`, `public/scripts/extensions/tts/google-native.js`; DES `transport.js` | probe detects route | ST ~200 / DES ~150 |

The ST PR can be opened any time after M0; DES never waits on it.

---

## 17. Risks, open questions, assumptions

**Top risks**

1. **The default route may not run 3.8 at all** (§15 #1). Mitigation: probe + 3.1 fallback, upstream PR, M0 stop rule.
2. **Attribution quality caps voice quality.** Colouring off, shared colours, persona lines, and
   the colored-dialogues timing all surface as "wrong voice" bugs. Mitigations: decoration-time
   firing (D4), DOM-built segments, reasons in tooltips, Workshop warnings.
3. **The ST auto-read guard relies on ST internals** (call-time read, `JSON.stringify` save; both
   true at 06bde93). Covered by a test and a descriptor-replaced warning; a future ST change could
   still break it quietly.
4. **Cost and rate limits are opaque** (no published RPM/RPD for 3.8; prices double 2027-01-01).
   Mitigations: Flash-Lite default, cache, one-at-a-time requests, segment cap, session budget.
5. **Per-device key and per-project voices.** Phone and desktop sound different unless both hold a
   key; a DES key from a different project than the voices breaks them. Mitigated by `fallbackStock`,
   `keyTag` warnings and the M7 PR.

**Other risks.** Sixth-tab width at 1000 px (label shortening needs eye-tuning). The `tts-speaking`
class consumer is unknown and now gets removed on end. The `.mes_narrate` intercept depends on ST's
selector (`st/…/tts/index.js:1567`); if it breaks, ST reads with its own voice (harmless).
"Draft from card" costs one LLM call on the user's configured API and may be slow on local models.

**Assumptions.** Presence for old messages uses the *current* removed/banned lists (D6). The card
`{{char}}` gets the Narrator when the tracker omits it (decision 3, stated in UI). Only one TTS
provider (Google).

**Open questions for the user** (none reopen the fixed decisions)

1. If your SillyTavern can't send Gemini 3.8 requests yet, is it OK for the default route to use
   Gemini 3.1 voices until SillyTavern is updated (or you add a key)? The alternative is to require
   the DES key for 3.8.
2. Decision 5 says "+" copies Base's **voice**; every other field copies the version on the stage.
   Keep the voice pinned to Base (planned), or let it follow the stage like the portrait?
3. Should a new chat's greeting be read automatically? ST does; this plan doesn't.
4. Default model Flash-Lite (planned) or Flash?
5. Should thoughts use the character's voice (planned) or the Narrator?
6. Persona lines inside AI messages currently go to the Narrator. Worth teaching attribution the
   persona's colour in v1, or leave for M6?

---

## 18. Draft CHANGELOG entry (M1 + M2)

```markdown
### Added
- **Characters can have their own voices.** The Character Workshop has a new **Voice** tab: pick
  one of Google's 30 voices for each character and press ▶ to hear it first. When DES reads a
  message aloud, each line is spoken in the voice of whoever said it — as long as they're on the
  Present Characters panel. Narration, and anyone who isn't in the scene or has no voice, is read
  by a **Narrator voice** you choose in **Settings → Voices**. Voices follow campaign versions like
  portraits do: the "+" tile gives a new version Base's voice, and each campaign can use a
  different one.
- **Read new messages automatically.** Turn it on under Settings → Voices. The bullhorn buttons on
  bubbles, thoughts and the thinking panel use the same voices, and there's now a bullhorn on every
  message even with chat bubbles off. While DES voices are on, SillyTavern's own auto-read is
  paused so nothing plays twice — your SillyTavern setting itself isn't changed.
- Uses Google's new Gemini 3.8 voice models through the Google AI Studio key you already saved in
  SillyTavern. Flash-Lite (cheaper) is the default.

### Fixed
- Reading a bubble aloud no longer breaks when the line contains a `|`.
- The "speaking" highlight now goes away when the line finishes.
- DES no longer overwrites your own SillyTavern TTS text filter.
```

---

## Sources

Google (fetched 2026-09-26):

- Speech generation (Interactions): https://ai.google.dev/gemini-api/docs/speech-generation
- Speech generation (generateContent): https://ai.google.dev/gemini-api/docs/generate-content/speech-generation
- Voice design: https://ai.google.dev/gemini-api/docs/voice-design and https://ai.google.dev/gemini-api/docs/generate-content/voice-design
- Voice replication: https://ai.google.dev/gemini-api/docs/voice-replication
- Voices API reference: https://ai.google.dev/api/voices
- Interactions API reference: https://ai.google.dev/api/interactions-api
- Interactions overview / streaming: https://ai.google.dev/gemini-api/docs/interactions , https://ai.google.dev/gemini-api/docs/interactions/streaming
- Model pages: https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash-tts , https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash-lite-tts
- Changelog: https://ai.google.dev/gemini-api/docs/changelog
- Deprecations: https://ai.google.dev/gemini-api/docs/deprecations
- Pricing: https://ai.google.dev/gemini-api/docs/pricing
- Rate limits: https://ai.google.dev/gemini-api/docs/rate-limits
- API keys: https://ai.google.dev/gemini-api/docs/api-key
- Ephemeral tokens (Live API only — not usable here): https://ai.google.dev/gemini-api/docs/ephemeral-tokens
- Launch post (2026-09-23): https://blog.google/innovation-and-ai/models-and-research/gemini-models/gemini-3-8-text-to-speech/

Local copies of the Google pages: `scratchpad/g/*.txt` from the research session. SillyTavern source:
sparse clone of `main` at `06bde939` (`src/endpoints/google.js`, `src/endpoints/secrets.js`,
`public/scripts/extensions/tts/index.js`, `google-native.js`, `public/script.js`,
`public/scripts/extensions.js`, `public/scripts/secrets.js`).
