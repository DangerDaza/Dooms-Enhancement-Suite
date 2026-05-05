/**
 * Suppression helper for guided generation injection behavior.
 *
 * This module exports a pure function `evaluateSuppression` that computes
 * whether Doom's Character Tracker should suppress tracker and HTML injections for a
 * given generation request, based on runtime settings, extended context, and
 * generation data (quiet prompt flags, etc.).
 */
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
 * @returns {Object} - An object describing the suppression decision.
 */
export function evaluateSuppression(extensionSettings, context, data) {
    // Detect presence of any GG-style script injection. We check every known
    // guide id, not just `instruct` — auto-trigger guides (thinking / state /
    // clothes) and custom guides write to their own ids and would otherwise
    // bypass our guided-generation detection.
    const injects = context?.chatMetadata?.script_injects || {};
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
    if (combinedTextForDetection.length) {
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
