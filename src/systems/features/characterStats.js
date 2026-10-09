/**
 * Character Stats — storage, live values, AI round-trip.
 *
 * Every character (NPCs and the player's persona) has a stat sheet: the six
 * D&D attributes (1–100), the six states drawn as rings (0–100%) and any
 * custom stats the user added to that character. Each stat has an "ai" flag:
 * when on, the AI updates it through the "stats" key of the tracker JSON.
 *
 * Where things live:
 *   - Sheet (definitions, base values, ai flags) — shared by every chat:
 *       extensionSettings.characterStatSheets.{npc|user}[name]
 *   - Current values — one set per chat (see chatScope.js):
 *       chat_metadata.dooms_tracker.betterStats.characterStatValues["npc:Name"][statId]
 *     A value that was never set reads as the base value.
 *   - NPCs start without values: the first reply they appear in asks the AI
 *     to generate their whole sheet to fit who they are (sheet.pending, or no
 *     sheet at all). The persona is always set by hand.
 *   - Undo for the last AI update, so a swipe/regenerate starts again from
 *     the values the replaced reply saw:
 *       chat_metadata.dooms_tracker.statsUndo
 *
 * The pure logic (defaults, clamping, prompt text, change detection) is in
 * src/utils/statsModel.js.
 */
import { getContext } from '../../../../../../extensions.js';
import { chat, chat_metadata } from '../../../../../../../script.js';
import { extensionSettings, committedTrackerData, lastGeneratedData } from '../../core/state.js';
import { isRpgModeActive } from './rpgMode.js';
import { chatStore, saveChatScope, CHAT_SCOPE } from './chatScope.js';
import { saveSettings, saveChatData } from '../../core/persistence.js';
import {
    resolveSheet,
    serializeSheet,
    resolveCurrentValues,
    clampStatValue,
    computeAIChanges,
    mergeChangeSets,
    changesToRevert,
    buildStatsPrompt,
    activeStats,
    isHexColor,
    createCustomStat,
    customStatDefinition,
} from '../../utils/statsModel.js';

export const STATS_CHANGED_EVENT = 'dooms:stats-changed';

// Attribute modifiers (equipped items, conditions) come from
// characterModifiers.js, which registers here — this module must not import
// equipment/conditions (they import it).
let modifierProvider = null;
export function setModifierProvider(fn) {
    modifierProvider = typeof fn === 'function' ? fn : null;
}
function modifiersFor(name, isUser) {
    try { return (modifierProvider && modifierProvider(name, isUser)) || {}; } catch (e) { return {}; }
}
const NO_CAMPAIGN = '_base';

// ─── Keys ───────────────────────────────────────────────────────────────────

function ns(isUser) {
    return isUser ? 'user' : 'npc';
}

/** Storage key for one character's current values. */
export function statKey(name, isUser) {
    return `${ns(isUser)}:${name}`;
}

/** The bucket current values are read from and written to right now. */
export function currentCampaignKey() {
    const id = extensionSettings.lorebook?.activeCampaignId;
    return typeof id === 'string' && id ? id : NO_CAMPAIGN;
}

function sheetStore(isUser, create = false) {
    if (!extensionSettings.characterStatSheets || typeof extensionSettings.characterStatSheets !== 'object') {
        if (!create) return null;
        extensionSettings.characterStatSheets = { npc: {}, user: {} };
    }
    const root = extensionSettings.characterStatSheets;
    const k = ns(isUser);
    if (!root[k] || typeof root[k] !== 'object') {
        if (!create) return null;
        root[k] = {};
    }
    return root[k];
}

/** The open chat's current values ({ "npc:Name": { statId: value } }). */
function valueBucket(create = false) {
    return chatStore('characterStatValues', create);
}

/** Case-insensitive own-key lookup. */
function findKey(obj, name) {
    if (!obj || typeof obj !== 'object' || !name) return undefined;
    if (Object.prototype.hasOwnProperty.call(obj, name)) return name;
    const lower = String(name).toLowerCase();
    return Object.keys(obj).find(k => k.toLowerCase() === lower);
}

// ─── Events ─────────────────────────────────────────────────────────────────

/** Tells open stat views to repaint. */
export function notifyStatsChanged(detail = {}) {
    try {
        window.dispatchEvent(new CustomEvent(STATS_CHANGED_EVENT, { detail }));
    } catch (e) { /* no window (tests) */ }
}

// ─── Sheets ─────────────────────────────────────────────────────────────────

// ─── Global on/off per built-in stat ────────────────────────────────────────

/** Ids of the built-in stats the user switched off (Settings → Stats). */
export function getDisabledStatIds() {
    const list = extensionSettings.characterStatsDisabled;
    return Array.isArray(list) ? list.filter(id => typeof id === 'string') : [];
}

/** Switches one built-in stat on or off for every character. */
export function setStatEnabled(statId, enabled) {
    const off = new Set(getDisabledStatIds());
    if (enabled) off.delete(statId);
    else off.add(statId);
    extensionSettings.characterStatsDisabled = [...off];
    saveSettings();
    notifyStatsChanged({ source: 'settings' });
}

/** Colours chosen for built-in stats: { statId: '#hex' }. */
export function getStatColors() {
    const map = extensionSettings.characterStatColors;
    return map && typeof map === 'object' ? map : {};
}

/** Sets (or, with an empty value, resets) the colour of a built-in stat for every character. */
export function setStatColor(statId, color) {
    const map = { ...getStatColors() };
    if (isHexColor(color)) map[statId] = color.toLowerCase();
    else delete map[statId];
    extensionSettings.characterStatColors = map;
    saveSettings();
    notifyStatsChanged({ source: 'settings' });
}

/**
 * The character's full, resolved stat list (defaults when nothing saved).
 * Switched-off stats are included with enabled: false so their stored
 * values survive; use activeStats() for what should be shown or sent.
 */
export function getStatSheet(name, isUser = false) {
    const store = sheetStore(isUser);
    const key = findKey(store, name);
    return resolveSheet(key !== undefined ? store[key] : null, {
        disabled: getDisabledStatIds(),
        colors: getStatColors(),
        custom: getCustomStatDefinitions(),
    });
}

// ─── Custom stats (shared by every character) ───────────────────────────────

/**
 * The global list of custom stat definitions. Sheets saved before custom
 * stats went global carried their own `custom` array: the first read folds
 * those into the global list (first definition of an id wins).
 */
export function getCustomStatDefinitions() {
    if (!Array.isArray(extensionSettings.characterStatCustom)) extensionSettings.characterStatCustom = [];
    const list = extensionSettings.characterStatCustom;
    if (!extensionSettings.characterStatCustomMigrated) {
        extensionSettings.characterStatCustomMigrated = true;
        const ids = new Set(list.map(c => c && c.id));
        const root = extensionSettings.characterStatSheets;
        for (const ns of ['user', 'npc']) {
            const store = root && root[ns];
            if (!store || typeof store !== 'object') continue;
            for (const sheet of Object.values(store)) {
                if (!sheet || !Array.isArray(sheet.custom)) continue;
                for (const c of sheet.custom) {
                    if (c && typeof c.id === 'string' && !ids.has(c.id)) {
                        ids.add(c.id);
                        list.push({ ...c });
                    }
                }
                delete sheet.custom;
            }
        }
    }
    return list;
}

/**
 * Adds a custom stat for every character. Returns { stat } or { error }.
 * @param {{name: string, description?: string, kind?: string, ai?: boolean}} input
 */
export function addCustomStat(input) {
    const all = resolveSheet(null, { custom: getCustomStatDefinitions() });
    const result = createCustomStat(all, input);
    if (result.error) return result;
    getCustomStatDefinitions().push(customStatDefinition(result.stat));
    saveSettings();
    notifyStatsChanged({ source: 'settings' });
    return result;
}

/** Updates the name, description or colour of a custom stat. */
export function updateCustomStat(statId, changes = {}) {
    const def = getCustomStatDefinitions().find(c => c.id === statId);
    if (!def) return false;
    if (typeof changes.name === 'string' && changes.name.trim()) def.name = changes.name.trim().slice(0, 40);
    if (typeof changes.description === 'string') def.description = changes.description.trim().slice(0, 400);
    saveSettings();
    notifyStatsChanged({ source: 'settings' });
    return true;
}

/**
 * Removes a custom stat from every character: its definition, every
 * character's starting value and AI tick, the open chat's current values,
 * its colour and on/off entry.
 */
export function deleteCustomStat(statId) {
    const list = getCustomStatDefinitions();
    const idx = list.findIndex(c => c.id === statId);
    if (idx === -1) return false;
    list.splice(idx, 1);
    const root = extensionSettings.characterStatSheets;
    for (const ns of ['user', 'npc']) {
        const store = root && root[ns];
        if (!store) continue;
        for (const sheet of Object.values(store)) {
            if (sheet?.base) delete sheet.base[statId];
            if (sheet?.ai) delete sheet.ai[statId];
        }
    }
    const values = valueBucket();
    if (values) for (const v of Object.values(values)) if (v && typeof v === 'object') delete v[statId];
    if (extensionSettings.characterStatColors) delete extensionSettings.characterStatColors[statId];
    if (Array.isArray(extensionSettings.characterStatsDisabled)) {
        extensionSettings.characterStatsDisabled = extensionSettings.characterStatsDisabled.filter(id => id !== statId);
    }
    saveSettings();
    notifyStatsChanged({ source: 'settings' });
    return true;
}

/** Whether anything was ever saved for this character. */
export function hasSavedStatSheet(name, isUser = false) {
    return findKey(sheetStore(isUser), name) !== undefined;
}

/**
 * True for an NPC whose values the AI still has to generate: nothing saved
 * yet, or the user asked for a regeneration. Never true for the persona.
 */
export function isStatGenerationPending(name, isUser = false) {
    if (isUser || !name) return false;
    const store = sheetStore(false);
    const key = findKey(store, name);
    if (key === undefined) return true;
    return store[key]?.pending === true;
}

/**
 * Asks for the NPC's values to be generated again by the AI the next time
 * they are in a scene. Keeps custom stats and AI ticks.
 */
export function requestStatGeneration(name, stats = null) {
    if (!name) return;
    saveStatSheet(name, false, stats || getStatSheet(name, false), { pending: true });
}

/**
 * Saves a character's stat list (definitions, base values, ai flags) and
 * drops current values of custom stats that no longer exist, in the open
 * chat. Does not persist by itself when `persist` is false (the Workshop
 * saves once at the end of its commit).
 */
export function saveStatSheet(name, isUser, stats, { persist = true, pending = false } = {}) {
    if (!name) return;
    const store = sheetStore(isUser, true);
    const existing = findKey(store, name);
    if (existing !== undefined && existing !== name) delete store[existing];
    store[name] = serializeSheet(stats, { pending: pending && !isUser });

    const ids = new Set((stats || []).map(s => s.id));
    const key = statKey(name, isUser);
    const vals = valueBucket()?.[key];
    if (vals) for (const id of Object.keys(vals)) if (!ids.has(id)) delete vals[id];
    if (persist) saveSettings();
    notifyStatsChanged({ key });
}

/** Removes a character's sheet and its current values in the open chat. */
export function deleteStatSheet(name, isUser = false, { persist = false } = {}) {
    if (!name) return;
    const store = sheetStore(isUser);
    const k = findKey(store, name);
    if (k !== undefined) delete store[k];
    const bucket = valueBucket();
    if (bucket) {
        const prefix = `${ns(isUser)}:`;
        const lower = String(name).toLowerCase();
        for (const vk of Object.keys(bucket)) {
            if (vk.startsWith(prefix) && vk.slice(prefix.length).toLowerCase() === lower) delete bucket[vk];
        }
    }
    if (persist) saveSettings();
    notifyStatsChanged({ key: statKey(name, isUser) });
}

// ─── Current values ─────────────────────────────────────────────────────────

function storedValues(name, isUser) {
    const bucket = valueBucket();
    if (!bucket) return null;
    const k = findKey(bucket, statKey(name, isUser));
    return k !== undefined ? bucket[k] : null;
}

/** { statId: value } for the open chat, base filling the gaps. */
export function getCurrentStatValues(name, isUser = false, stats = null) {
    const list = stats || getStatSheet(name, isUser);
    return resolveCurrentValues(list, storedValues(name, isUser));
}

/** Sets one current value in the open chat. Returns the stored value. */
export function setCurrentStatValue(name, isUser, statId, value, { persist = true, silent = false } = {}) {
    const stat = getStatSheet(name, isUser).find(s => s.id === statId);
    if (!stat) return null;
    const v = clampStatValue(stat, value);
    if (v === null) return null;
    const bucket = valueBucket(true);
    if (!bucket) return null;
    const key = statKey(name, isUser);
    const existing = findKey(bucket, key);
    const target = existing !== undefined ? existing : key;
    if (!bucket[target] || typeof bucket[target] !== 'object') bucket[target] = {};
    bucket[target][statId] = v;
    if (persist) saveChatScope();
    if (!silent) notifyStatsChanged({ key });
    return v;
}

/** Puts every current value of the character back to its base, in the open chat. */
export function resetCurrentStatValues(name, isUser = false) {
    const bucket = valueBucket();
    if (bucket) {
        const k = findKey(bucket, statKey(name, isUser));
        if (k !== undefined) delete bucket[k];
    }
    saveChatScope();
    notifyStatsChanged({ key: statKey(name, isUser) });
}

/** Reads a current value by storage key (used by undo). */
function readCurrentByKey(key, statId) {
    const idx = key.indexOf(':');
    const isUser = key.slice(0, idx) === 'user';
    const name = key.slice(idx + 1);
    return getCurrentStatValues(name, isUser)[statId];
}

function writeCurrentByKey(key, statId, value) {
    const idx = key.indexOf(':');
    const isUser = key.slice(0, idx) === 'user';
    const name = key.slice(idx + 1);
    return setCurrentStatValue(name, isUser, statId, value, { persist: false, silent: true });
}

// ─── Who has stats right now ────────────────────────────────────────────────

/**
 * The active player character's Workshop name. Mirrors
 * portraitBar.resolveActiveUserName (kept here so the generation layer does
 * not import UI code): manual pick → persona link → the only entry.
 */
export function resolveActivePersonaName() {
    const s = extensionSettings || {};
    const userMap = s.userCharacters && typeof s.userCharacters === 'object' ? s.userCharacters : {};
    if (s.activeUserCharacter && userMap[s.activeUserCharacter]) return s.activeUserCharacter;
    let currentAvatar = '';
    try {
        const ctx = window?.SillyTavern?.getContext ? window.SillyTavern.getContext() : null;
        currentAvatar = (ctx && ctx.user_avatar) || window?.user_avatar || '';
    } catch (e) { currentAvatar = ''; }
    if (currentAvatar) {
        for (const [n, entry] of Object.entries(userMap)) {
            if (entry && entry.linkedPersona === currentAvatar) return n;
        }
    }
    const names = Object.keys(userMap);
    return names.length === 1 ? names[0] : null;
}

/**
 * The player's character as stats/equipment see it: the Workshop persona
 * when one resolves, otherwise SillyTavern's persona name — so the player
 * is never silently left out of the prompt.
 */
export function getPersonaName() {
    const fromWorkshop = resolveActivePersonaName();
    if (fromWorkshop) return fromWorkshop;
    try {
        const n = String(getContext().name1 || '').trim();
        return n || null;
    } catch (e) { return null; }
}

/** Words the AI may use for the player instead of their name. */
export const PLAYER_WORDS = ['you', 'player', 'the player', 'user', '{{user}}', 'protagonist', 'me', 'myself'];

function parseCharacters(raw) {
    if (!raw) return [];
    try {
        const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
        const list = Array.isArray(parsed) ? parsed : (parsed?.characters || []);
        return Array.isArray(list) ? list : [];
    } catch (e) {
        return [];
    }
}

function removedLowerSet() {
    const out = new Set();
    const lists = [extensionSettings.removedCharacters, chat_metadata?.dooms_tracker?.removedCharacters];
    for (const list of lists) {
        if (Array.isArray(list)) for (const n of list) if (typeof n === 'string') out.add(n.toLowerCase());
    }
    return out;
}

/**
 * Characters whose stats matter for the next reply: the active persona plus
 * the NPCs in the latest tracker data.
 * @param {{source?: 'committed'|'displayed'}} [options]
 * @returns {Array<{name: string, isUser: boolean}>}
 */
export function getStatCharacters({ source = 'committed' } = {}) {
    const out = [];
    const seen = new Set();
    const persona = getPersonaName();
    const userNames = new Set(Object.keys(extensionSettings.userCharacters || {}).map(n => n.toLowerCase()));
    if (persona) {
        out.push({ name: persona, isUser: true });
        seen.add(persona.toLowerCase());
    }
    let userName = '';
    try { userName = String(getContext().name1 || '').toLowerCase(); } catch (e) {}
    const raw = source === 'displayed'
        ? (lastGeneratedData.characterThoughts || committedTrackerData.characterThoughts)
        : (committedTrackerData.characterThoughts || lastGeneratedData.characterThoughts);
    const removed = removedLowerSet();
    for (const c of parseCharacters(raw)) {
        const name = typeof c?.name === 'string' ? c.name.trim() : '';
        if (!name) continue;
        const lower = name.toLowerCase();
        if (seen.has(lower) || userNames.has(lower) || lower === userName || removed.has(lower)) continue;
        seen.add(lower);
        out.push({ name, isUser: false });
    }
    return out;
}

// ─── Prompt ─────────────────────────────────────────────────────────────────

/** Master switch (Settings may expose it later; on unless explicitly off). */
export function isCharacterStatsEnabled() {
    return isRpgModeActive() && extensionSettings.characterStatsEnabled !== false;
}

/**
 * The stats section for the next generation, or '' when there is nothing to
 * send. `standalone` is for when no other tracker is enabled, so the stats
 * become the whole JSON block.
 */
export function buildStatsPromptForGeneration({ compact = true, standalone = false } = {}) {
    if (!isCharacterStatsEnabled()) return '';
    const entries = getStatCharacters().map(({ name, isUser }) => {
        const stats = getStatSheet(name, isUser);
        return {
            displayName: name,
            isUser,
            stats,
            current: getCurrentStatValues(name, isUser, stats),
            generate: isStatGenerationPending(name, isUser),
            modifiers: modifiersFor(name, isUser),
        };
    });
    return buildStatsPrompt(entries, { compact, standalone });
}

/**
 * One plain line per character ("Name: Health 80%, ... STR 60, ..."), for
 * the separate-mode context block that the roleplay reply reads.
 */
export function buildStatsContextSummary() {
    if (!isCharacterStatsEnabled()) return '';
    const lines = getStatCharacters().filter(c => !isStatGenerationPending(c.name, c.isUser)).map(({ name, isUser }) => {
        const stats = activeStats(getStatSheet(name, isUser));
        const cur = getCurrentStatValues(name, isUser, stats);
        const states = stats.filter(s => s.kind === 'state').map(s => `${s.name} ${cur[s.id]}%`);
        const mods = modifiersFor(name, isUser);
        const attrs = stats.filter(s => s.kind === 'attribute').map(s => {
            const m = mods[s.id]?.total || 0;
            const eff = m ? clampStatValue(s, cur[s.id] + m) : cur[s.id];
            return `${s.abbr || s.name} ${eff}${m ? ` (${m > 0 ? '+' : ''}${m})` : ''}`;
        });
        // Six plain attributes with the same value: say it once.
        const plain = attrs.length >= 4 && attrs.every(t => /^\S+ \d+$/.test(t)) && new Set(attrs.map(t => t.split(' ')[1])).size === 1;
        const attrPart = plain ? [`all attributes ${attrs[0].split(' ')[1]}`] : attrs;
        return `${name}${isUser ? ' (player character)' : ''}: ${[...states, ...attrPart].join(', ')}`;
    });
    const kept = lines.filter(l => !l.endsWith(': '));
    return kept.length ? 'Character stats:\n' + kept.join('\n') : '';
}

// ─── Applying the AI's update ───────────────────────────────────────────────

function buildTargets() {
    let userName = '';
    try { userName = getContext().name1 || ''; } catch (e) {}
    const targets = [];
    const known = new Set();
    const add = (name, isUser) => {
        const key = statKey(name, isUser);
        if (known.has(key.toLowerCase())) return;
        known.add(key.toLowerCase());
        const stats = getStatSheet(name, isUser);
        const names = [name];
        if (isUser && userName && userName.toLowerCase() !== name.toLowerCase()) names.push(userName);
        if (isUser) names.push(...PLAYER_WORDS);
        if (!isUser) {
            const aliases = extensionSettings.characterAliases?.[name];
            if (Array.isArray(aliases)) names.push(...aliases.filter(a => typeof a === 'string'));
        }
        targets.push({
            key, name, isUser, names, stats,
            current: getCurrentStatValues(name, isUser, stats),
            generate: isStatGenerationPending(name, isUser),
        });
    };
    for (const c of getStatCharacters({ source: 'displayed' })) add(c.name, c.isUser);
    for (const c of getStatCharacters({ source: 'committed' })) add(c.name, c.isUser);
    // Anyone else with a saved sheet can be addressed by name too.
    const npcSheets = sheetStore(false) || {};
    for (const name of Object.keys(npcSheets)) add(name, false);
    return targets;
}

/**
 * Applies the "stats" object of a fresh AI reply to the open chat's
 * current values and records an undo for that message.
 * @param {*} rawStats - parsed or JSON string
 * @param {number} messageIndex - the reply's index in the chat
 * @returns {number} how many values changed
 */
export function applyAIStatUpdates(rawStats, messageIndex) {
    if (!isCharacterStatsEnabled() || rawStats === null || rawStats === undefined) return 0;
    const targets = buildTargets();
    const all = computeAIChanges(targets, rawStats);
    const generatedCount = applyGeneratedSheets(targets, all.filter(c => c.generated));
    const changes = all.filter(c => !c.generated);
    if (!changes.length) {
        if (generatedCount) {
            saveSettings();
            notifyStatsChanged({ source: 'generated' });
        }
        return generatedCount;
    }
    for (const c of changes) writeCurrentByKey(c.key, c.statId, c.after);
    const campaign = CHAT_SCOPE;
    try {
        if (chat_metadata) {
            if (!chat_metadata.dooms_tracker) chat_metadata.dooms_tracker = {};
            const prev = chat_metadata.dooms_tracker.statsUndo;
            const sameMessage = prev && prev.messageIndex === messageIndex && prev.campaign === campaign;
            chat_metadata.dooms_tracker.statsUndo = {
                messageIndex,
                campaign,
                changes: sameMessage ? mergeChangeSets(prev.changes, changes) : changes,
            };
        }
    } catch (e) { /* undo is best-effort */ }
    saveChatScope();
    notifyStatsChanged({ source: 'ai' });
    return changes.length + generatedCount;
}

/**
 * Stores the values the AI generated for new NPCs: they become the
 * character's starting values AND current values, and the sheet stops being
 * pending. A reply that gave too little (fewer than half the stats) leaves
 * the character pending so the next reply tries again.
 * @returns {number} values stored
 */
function applyGeneratedSheets(targets, generated) {
    let count = 0;
    const byKey = new Map();
    for (const c of generated) {
        if (!byKey.has(c.key)) byKey.set(c.key, []);
        byKey.get(c.key).push(c);
    }
    for (const [key, list] of byKey) {
        const target = targets.find(t => t.key === key);
        if (!target || list.length < Math.ceil(activeStats(target.stats).length / 2)) continue;
        const stats = target.stats.map(s => ({ ...s }));
        for (const c of list) {
            const stat = stats.find(s => s.id === c.statId);
            if (stat) stat.base = c.after;
        }
        saveStatSheet(target.name, false, stats, { persist: false, pending: false });
        // Fresh start in this chat: current = the generated values.
        const bucket = valueBucket();
        if (bucket) {
            const k = findKey(bucket, key);
            if (k !== undefined) delete bucket[k];
        }
        count += list.length;
    }
    return count;
}

/**
 * Before a swipe or regenerate replaces the last reply, roll back the stat
 * changes that reply made — only the ones still holding the AI's value, so
 * manual edits survive. Safe to call more than once (the record is consumed).
 * @param {number} [replacedIndex] - index of the reply being replaced
 */
export function revertAIStatsForReplacedMessage(replacedIndex) {
    try {
        const rec = chat_metadata?.dooms_tracker?.statsUndo;
        if (!rec || !Array.isArray(rec.changes)) return 0;
        const lastIdx = Array.isArray(chat) ? chat.length - 1 : -1;
        const idx = typeof replacedIndex === 'number' ? replacedIndex : lastIdx;
        // Only the reply that is actually being replaced (regenerate may have
        // already dropped it from the chat, hence the one-step tolerance).
        if (rec.messageIndex !== idx && rec.messageIndex !== idx + 1) return 0;
        delete chat_metadata.dooms_tracker.statsUndo;
        if (rec.campaign !== CHAT_SCOPE) return 0;
        const todo = changesToRevert(rec.changes, readCurrentByKey);
        for (const c of todo) {
            if (typeof c.before === 'number') writeCurrentByKey(c.key, c.statId, c.before);
        }
        if (todo.length) notifyStatsChanged({ source: 'undo' });
        saveChatData();
        return todo.length;
    } catch (e) {
        console.warn('[Dooms Tracker] Stats: undo failed', e);
        return 0;
    }
}

/**
 * The "stats" object as the last reply should have had it (current values
 * of AI-editable stats). Used in the together-mode example of the previous
 * tracker JSON, so small models see "stats" as part of the format.
 */
export function getStatsExampleObject() {
    if (!isCharacterStatsEnabled()) return null;
    const out = {};
    for (const { name, isUser } of getStatCharacters()) {
        if (isStatGenerationPending(name, isUser)) continue;
        const stats = activeStats(getStatSheet(name, isUser)).filter(s => s.ai);
        if (!stats.length) continue;
        const cur = getCurrentStatValues(name, isUser, stats);
        out[name] = Object.fromEntries(stats.map(s => [s.name, cur[s.id]]));
    }
    return Object.keys(out).length ? out : null;
}
