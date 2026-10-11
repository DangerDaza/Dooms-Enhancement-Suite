/**
 * Sheet suggestions (Project Short Fuse, Phase 4b, docs/stats-plan.md §11).
 *
 * One small separate call rates a character for the d20 sheet: a tier on
 * the scale from Ordinary to Legend and six scores inside its range, each
 * with a few words of reason. Two callers:
 *
 *   - the Workshop's Attributes tab ("Suggest from the story"): the owner
 *     is looking, the pane shows the answer, nothing is kept until Save;
 *   - the automatic trigger after a fresh reply parses, behind
 *     Settings → Stats → "Suggest stats for new characters automatically"
 *     (off by default): a character on the shelf with no numbers and no
 *     tier is asked about once per session and stored with the suggested
 *     mark, which the Workshop shows until the owner touches the sheet.
 *
 * The persona is never filled in here. A failed call is not retried that
 * session. The arithmetic and the prompt live in src/utils/d20.js.
 */
import { extensionSettings, lastGeneratedData, committedTrackerData } from '../../core/state.js';
import { saveSettings } from '../../core/persistence.js';
import { parseTrackerJson } from '../../utils/trackerParse.js';
import {
    attributesConfig,
    attributesOn,
    attributeDefs,
    getSheet,
    getProficiencies,
    setSheet,
    isDefaultSheet,
    getTier,
    withTier,
    withSuggestedMark,
    tierById,
    buildSheetSuggestionPrompt,
    parseSheetSuggestion,
} from '../../utils/d20.js';
import { resolvePersonaName, recentChatText, diceNotice } from './diceRolls.js';

let transport = null;          // test hook: (messages) => Promise<string>
let timeoutMs = 20000;
const askedThisSession = new Set();

/** Tests replace the model call; nothing else should. */
export function __setSuggestTransport(fn) {
    transport = typeof fn === 'function' ? fn : null;
}

/** Tests shorten the wait and forget who was asked. */
export function __resetSuggestions({ timeout = 20000 } = {}) {
    timeoutMs = Number.isFinite(timeout) && timeout > 0 ? timeout : 20000;
    askedThisSession.clear();
}

async function defaultTransport(messages) {
    const { safeGenerateRaw } = await import('../../utils/responseExtractor.js');
    return safeGenerateRaw({ prompt: messages, quietToLoud: false });
}

function withTimeout(promise, ms) {
    return new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('timeout')), ms);
        Promise.resolve(promise).then(
            v => { clearTimeout(t); resolve(v); },
            e => { clearTimeout(t); reject(e); },
        );
    });
}

function lookup(map, name) {
    if (!map || typeof map !== 'object' || !name) return undefined;
    if (Object.prototype.hasOwnProperty.call(map, name)) return map[name];
    const lower = String(name).toLowerCase();
    const key = Object.keys(map).find(k => k.toLowerCase() === lower);
    return key === undefined ? undefined : map[key];
}

/** What the Workshop knows about a character: the card description and the appearance note. */
export function cardTextFor(name) {
    const inj = lookup(extensionSettings.characterInjection, name);
    const description = inj && typeof inj === 'object' && typeof inj.description === 'string' ? inj.description : '';
    const appearance = lookup(extensionSettings.characterAppearance, name);
    return { description, appearance: typeof appearance === 'string' ? appearance : '' };
}

/**
 * Asks the game master for a character's tier and scores.
 * @param {{ name: string, isUser?: boolean, description?: string, appearance?: string }} p
 * @returns {Promise<{ tierId: string, scores: Record<string, number>, reasons: Record<string, string> }>}
 */
export async function suggestSheet({ name, isUser = false, description = '', appearance = '' } = {}) {
    const cfg = attributesConfig(extensionSettings);
    const prompt = buildSheetSuggestionPrompt({
        name,
        isUser,
        description,
        appearance,
        recentText: recentChatText(cfg.contextMessages),
        settings: extensionSettings,
    });
    const text = await withTimeout((transport || defaultTransport)([
        { role: 'system', content: prompt.system },
        { role: 'user', content: prompt.user },
    ]), timeoutMs);
    const parsed = parseSheetSuggestion(text, extensionSettings);
    if (!parsed) throw new Error('The game master’s answer could not be read.');
    return parsed;
}

/**
 * Writes a suggestion to the sheet: the scores over the current ones, the
 * tier, and the suggested mark when nobody is looking. Saves settings.
 * @returns {{ scores: Record<string, number>, proficiencies: string[] }}
 */
export function applySuggestion(name, isUser, suggestion, { suggested = false } = {}) {
    const defs = attributeDefs(extensionSettings, { all: true });
    const scores = { ...getSheet(extensionSettings, name, isUser, defs), ...(suggestion?.scores || {}) };
    let proficiencies = getProficiencies(extensionSettings, name, isUser);
    if (suggestion?.tierId) proficiencies = withTier(proficiencies, suggestion.tierId);
    proficiencies = withSuggestedMark(proficiencies, suggested);
    setSheet(extensionSettings, name, isUser, scores, defs, proficiencies);
    saveSettings();
    return { scores, proficiencies };
}

/** The NPC names in the latest tracker block (the committed one when nothing fresh is parsed). */
function presentNames() {
    const raw = lastGeneratedData.characterThoughts || committedTrackerData.characterThoughts;
    if (!raw) return [];
    let parsed = null;
    try { parsed = parseTrackerJson(raw); } catch (e) { parsed = null; }
    const list = Array.isArray(parsed) ? parsed : (parsed && Array.isArray(parsed.characters) ? parsed.characters : []);
    const out = [];
    for (const c of list) {
        const name = c && typeof c.name === 'string' ? c.name.trim() : '';
        if (name) out.push(name);
    }
    return out;
}

/**
 * After a fresh reply: every character on the shelf with no numbers and
 * no tier gets one suggestion, stored with the mark. Sequential, so a
 * crowded scene makes a few small calls, not a burst. Returns how many
 * sheets were filled.
 */
export async function maybeAutoSuggestSheets() {
    const cfg = attributesConfig(extensionSettings);
    if (!extensionSettings.enabled || !attributesOn(extensionSettings) || !cfg.suggestNewSheets) return 0;
    const defs = attributeDefs(extensionSettings);
    const persona = String(resolvePersonaName() || '').toLowerCase();
    let filled = 0;
    for (const name of presentNames()) {
        const lower = name.toLowerCase();
        if (!lower || lower === persona || askedThisSession.has(lower)) continue;
        const sheet = getSheet(extensionSettings, name, false, defs);
        const profs = getProficiencies(extensionSettings, name, false);
        if (!isDefaultSheet(sheet, defs) || getTier(profs)) continue;
        askedThisSession.add(lower);
        try {
            const { description, appearance } = cardTextFor(name);
            const suggestion = await suggestSheet({ name, isUser: false, description, appearance });
            applySuggestion(name, false, suggestion, { suggested: true });
            const tier = tierById(suggestion.tierId);
            diceNotice(`Suggested stats for ${name}${tier ? `: ${tier.label}` : ''} · review them on the Workshop’s Attributes tab`, { title: 'Stats' });
            filled++;
        } catch (e) {
            console.warn(`[Dooms Tracker] Stats: the suggestion for ${name} failed`, e);
        }
    }
    return filled;
}
