/**
 * Suppression helper for guided generation injection behavior.
 *
 * This module exports a pure function `evaluateSuppression` that computes
 * whether Doom's Enhancement Suite should suppress tracker and HTML injections for a
 * given generation request, based on runtime settings, extended context, and
 * generation data (quiet prompt flags, etc.).
 */
import { chat_metadata } from '../../../../../../../script.js';
/**
 * Inject ids GuidedGenerations writes into chat_metadata.script_injects.
 * Watching only `instruct` (the original detection key) misses every other
 * GG persistent guide. Source for the list:
 * scripts/persistentGuides/{thinking,state,clothes,rules,situational,
 * custom,customAuto,tracker,fun}Guide.js — each calls
 * `/inject id=<guideId>` via executeSlashCommandsWithOptions.
 */
const GUIDED_INJECT_IDS = [
    'instruct',       // guidedResponse, guidedSwipe (original detection)
    'thinking',
    'state',
    'clothes',
    'rules',
    'situational',
    'custom',
    'customAuto',
    'tracker',
    'fun',
];

function normalizeInjectContent(obj) {
    if (!obj) return '';
    if (typeof obj === 'object') return String(obj.value || obj || '');
    return String(obj);
}

/**
 * Determine if suppression should be applied for this generation.
 *
 * @param {any} extensionSettings - extension settings object (may contain skipInjectionsForGuided)
 * @param {any} context - SillyTavern context object (used to find chatMetadata.script_injects.<id>)
 * @param {any} data - Generation data (contains quiet_prompt/quietPrompt flags)
 * @param {string} [type] - Generation type from ST's GENERATION_STARTED event
 *   ('normal' | 'impersonate' | 'continue' | 'swipe' | 'regenerate' | 'quiet').
 *   When `type === 'impersonate'` we treat it as an impersonation regardless of
 *   regex match — ST's native Impersonate button doesn't always inject
 *   GG-flavored prompt language, so the regex alone misses native flows.
 * @returns {Object} - An object describing the suppression decision.
 */
export function evaluateSuppression(extensionSettings, context, data, type) {
    // Detect presence of any GG-style script injection. We check every known
    // guide id, not just `instruct` — auto-trigger guides (thinking / state /
    // clothes) and custom guides write to their own ids and would otherwise
    // bypass our guided-generation detection.
    //
    // We read `chat_metadata.script_injects` from the live ES-module export
    // in script.js (same pattern used by portraitBar.js,
    // characterSheet.js). Earlier revisions tried `getContext().chatMetadata`
    // and `getContext().chat_metadata`, but neither shape is reliably
    // populated by every ST build — diagnostic logs on a confirmed guided
    // swipe (GG's guidedSwipe.js awaits and verifies the inject before
    // calling swipe_right) showed `allScriptInjectKeys=[]` on both. Reading
    // the global directly bypasses the wrapper.
    const injects = chat_metadata?.script_injects
        || context?.chat_metadata?.script_injects
        || context?.chatMetadata?.script_injects
        || {};
    const instructObj = injects.instruct;
    let isGuidedGeneration = false;
    let activeInjectIds = [];
    for (const id of GUIDED_INJECT_IDS) {
        if (injects[id]) {
            isGuidedGeneration = true;
            activeInjectIds.push(id);
        }
    }
    const quietPromptRaw = data?.quiet_prompt || data?.quietPrompt || '';
    const hasQuietPrompt = !!quietPromptRaw;
    // Normalize the injected instruction body. We surface `instructContent`
    // for back-compat with callers that read it, but for impersonation
    // pattern matching we now scan every known guide id so an impersonation
    // directive injected via id=custom is still detected.
    const instructContent = normalizeInjectContent(instructObj);
    const allInjectContent = activeInjectIds
        .map(id => normalizeInjectContent(injects[id]))
        .filter(Boolean)
        .join('\n');
    const IMPERSONATION_PATTERNS = [
        { id: 'first-perspective', re: /write in first person perspective from/i },
        { id: 'second-perspective', re: /write in second person perspective from/i },
        { id: 'third-perspective', re: /write in third person perspective from/i },
        { id: 'you-yours', re: /using you\/yours for/i },
        { id: 'third-person-pronouns', re: /third-person pronouns for/i },
        { id: 'impersonate-word', re: /\bimpersonat(e|ion)?\b/i },
        { id: 'assume-role', re: /assume the role of/i },
        { id: 'play-role', re: /play the role of/i },
        { id: 'impersonate-command', re: /\/impersonate await=true/i },
        { id: 'generic-first', re: /\bfirst person\b/i },
        { id: 'generic-second', re: /\bsecond person\b/i },
        { id: 'generic-third', re: /\bthird person\b/i }
    ];
    // Include quietPrompt raw text + every active guide injection in
    // detection; guided impersonation flows may pass it directly here or
    // bury it in id=custom / id=customAuto.
    const combinedTextForDetection = [allInjectContent, quietPromptRaw].filter(Boolean).join('\n');
    let matchedPattern = '';
    let isImpersonationGeneration = false;
    // Primary signal: ST's GENERATION_STARTED event passes type === 'impersonate'
    // for the native Impersonate button. This is the most reliable detection
    // since ST's prompt language varies by instruct preset and won't always
    // match the GG-flavored regex patterns below.
    if (typeof type === 'string' && type === 'impersonate') {
        isImpersonationGeneration = true;
        matchedPattern = 'event-type-impersonate';
    }
    // Secondary signal: regex-match injected prompt content. Catches GG's
    // impersonation flows (which fire type === 'normal' but inject prompt
    // text matching one of the patterns) and any other extensions that route
    // impersonation through script_injects rather than the native button.
    if (!isImpersonationGeneration && combinedTextForDetection.length) {
        for (const pat of IMPERSONATION_PATTERNS) {
            if (pat.re.test(combinedTextForDetection)) {
                matchedPattern = pat.id;
                isImpersonationGeneration = true;
                break;
            }
        }
    }
    const skipMode = (extensionSettings && extensionSettings.skipInjectionsForGuided) || 'none';
    // Compute suppression according to mode
    const shouldSuppress = skipMode === 'guided'
        ? (isGuidedGeneration || hasQuietPrompt)
        : (skipMode === 'impersonation' ? isImpersonationGeneration : false);
    return {
        shouldSuppress,
        skipMode,
        isGuidedGeneration,
        isImpersonationGeneration,
        hasQuietPrompt,
        instructContent,
        quietPromptRaw,
        matchedPattern,
        activeInjectIds, // diagnostic: which GG guide ids fired this gen
    };
}
