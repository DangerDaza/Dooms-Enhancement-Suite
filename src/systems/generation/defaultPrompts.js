/**
 * Default Prompt Constants
 * Pure template-string constants shared by generation modules (doomCounter,
 * injector) and the Prompts Editor UI. Kept import-free so pulling a constant
 * never drags UI modules into the load graph.
 */
// ─── Default Prompt: Plot Twist Template ─────────────────────────────────────
// Wrapper injected around user-selected twists from the Doom Counter.
// {twist} is replaced with the twist description chosen by the user.
export const DEFAULT_PLOT_TWIST_TEMPLATE_PROMPT = `<instruction>A dramatic development occurs in this scene. Weave this naturally into your response — don't announce it directly, let it unfold organically.</instruction> <twist_context> {twist} </twist_context>`;

// ─── Default Prompt: Knife Template ──────────────────────────────────────────
// Wrapper injected around a Knife — a story beat written in advance and attached
// to a character in the Character Workshop — when the Doom Counter draws it.
// {character} is replaced with the knife owner's name, {knife} with the text.
// Overridable via extensionSettings.customKnifeTemplatePrompt.
export const DEFAULT_KNIFE_TEMPLATE_PROMPT = `<instruction>A story element about {character}, planted in advance by the player, now comes into play. Use it to drive the next scene — bring its consequences into the present moment naturally and organically. Don't announce it or restate it; let it surface through events, arrivals, messages, or confrontations involving {character}.</instruction> <story_element> {knife} </story_element>`;

// ─── Default Prompt: Knife Generator Rules ───────────────────────────────────
// Requirements appended to the Character Workshop's Generate Knives prompt.
// {character} is replaced with the character's name. The structural context
// (character description, existing knives, recent chat, chosen theme) is built
// separately in doomCounter.generateKnifeSuggestions.
// Overridable via extensionSettings.customKnifeGeneratorRulesPrompt.
export const DEFAULT_KNIFE_GENERATOR_RULES_PROMPT = `- Each knife is 1-2 sentences, written as a factual premise about {character} (e.g. "David is a gambling addict — he owes a lot of money to the wrong people.")
- Make them specific and consequence-laden: name what hangs over the character and who or what might come collecting
- If a knife involves another person, describe them by role or relationship ("an old creditor", "her estranged sister", "the partner she left behind") instead of inventing a named character — the story will name them when they appear. NEVER use stock AI names like Voss, Elara, Seraphina, Nyx, Kael, Thorne, or Lyra
- A knife does NOT have to incriminate the character — drama can come from outside (pursuers, debts, the past returning) or even from good fortune. Keep the character recognizably themselves; do not quietly rewrite them into a villain or traitor unless the theme explicitly calls for it
- Fit the story's established tone and setting; don't contradict the description above`;

// ─── Default Prompt: New Fields Boost ────────────────────────────────────────
// Injected when new tracker fields are enabled, reminding the AI to include them.
// {fieldList} is replaced with the list of newly-enabled field descriptions.
export const DEFAULT_NEW_FIELDS_BOOST_PROMPT = `[TRACKER NOTE: The following fields have just been enabled and MUST be included in the infoBox JSON this turn: {fieldList}. Do not omit them.]`;

// ─── Default Prompt: Twist Generator Rules ───────────────────────────────────
// Creative guidance for the LLM when generating twist options for the Doom Counter.
// This is appended to the structural system prompt (character data, scene context, JSON format).
export const DEFAULT_TWIST_GENERATOR_RULES_PROMPT = `<instruction>Generate plot twist options for the current scene. Base ALL twists on what is happening RIGHT NOW in the most recent messages. The twist must make sense for the CURRENT scene, not something from several messages ago.</instruction>
<output_requirements>
- ONLY reference characters listed above — never invent new characters or treat existing ones as strangers
- Twists must be proportional to the scene — no world-ending disasters for a quiet afternoon
- Each twist should be a DIFFERENT type (interpersonal, environmental, revelation, discovery, emotional, etc.)
- Build on existing character relationships and recent events rather than introducing random catastrophes
- The twist should flow NATURALLY from the current conversation — it should feel like an organic story development, not a random insertion
- The goal is to make the story MORE interesting, not to punish the characters
- Each twist option should be 1-2 sentences — specific enough to guide the narrative, brief enough to not constrain it
</output_requirements>
<tone_variety>
Vary the TONE across the options. Include a MIX of:
- Positive/Exciting: Unexpected good fortune, a breakthrough, romantic moment, lucky discovery
- Dramatic/Tense: A confrontation, revelation, moral dilemma, betrayal
- Mysterious/Intriguing: Something strange, a clue, an omen, an unexplained event
Do NOT make all options negative or catastrophic.
</tone_variety>
<twist_categories>
Draw from these narrative directions when generating options — pick what fits the current scene:
- Create a jealousy situation for {{user}}'s affection that affects {{char}}
- Introduce a rival competing for {{user}}'s or {{char}}'s affection
- Create an immediate external threat that {{user}} and {{char}} must solve
- Reveal or confront an important part of {{char}}'s background
- Generate a bonding experience where {{user}} and {{char}} grow closer emotionally and romantically
- Introduce a celebration, holiday, or special event that {{user}} and {{char}} participate in together
- Create an internal conflict or misunderstanding between {{user}} and {{char}}
- Create a sexual encounter between {{user}} and {{char}}
- Create a scenario where {{char}} is injured, ill, or emotionally vulnerable and {{user}} must care for them (or vice versa)
- An unexpected visitor or return of someone from {{char}}'s or {{user}}'s past (not a rival — a family member, old friend, or someone bringing news)
- A moral dilemma where {{user}} or {{char}} must make a difficult choice that directly affects the other
- An environmental disruption that forces a change of setting or circumstances (stranded, sudden weather, forced relocation)
</twist_categories>`;
