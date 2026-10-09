/**
 * Spells & Abilities — storage and AI round-trip.
 *
 * Every character (persona and NPCs) has a list of spells and abilities per
 * chat (see chatScope.js):
 *   chat_metadata.dooms_tracker.betterStats.characterAbilities["npc:Name"|"user:Name"] = [entry, ...]
 *
 * The AI adds entries through an "abilities" key in the tracker JSON and can
 * remove only those whose aiCanRemove is on. Passive effects always apply
 * (characterModifiers.js). Like equipment, a character with an empty list
 * is asked once for the abilities they already know
 * (characterAbilitiesSeeded), and a swipe restores the lists a reply
 * changed (snapshot undo).
 *
 * The pure logic is in src/utils/abilityModel.js.
 */
import { chat, chat_metadata } from '../../../../../../../script.js';
import { extensionSettings } from '../../core/state.js';
import { isRpgModeActive } from './rpgMode.js';
import { chatStore, chatRootView, saveChatScope, CHAT_SCOPE } from './chatScope.js';
import { saveSettings, saveChatData } from '../../core/persistence.js';
import {
    MAX_ABILITIES,
    makeAbility,
    findAbility,
    normalizeAbilityType,
    normalizeAIAbilities,
    applyAbilityChange,
    buildAbilitiesPrompt,
    formatAbilities,
} from '../../utils/abilityModel.js';
import { cleanIcon } from '../../utils/equipmentModel.js';
import { getStatCharacters, statKey, notifyStatsChanged } from './characterStats.js';
import { resolveTarget, resolveEffectsFor, describeEffects } from './characterEquipment.js';

// ─── Settings ───────────────────────────────────────────────────────────────

export function isAbilitiesEnabled() {
    return isRpgModeActive() && extensionSettings.characterAbilitiesEnabled !== false;
}

export function setAbilitiesEnabled(on) {
    extensionSettings.characterAbilitiesEnabled = !!on;
    saveSettings();
    notifyStatsChanged({ source: 'settings' });
}

// ─── Storage ────────────────────────────────────────────────────────────────

function rootBucket(rootKey, create) {
    return chatStore(rootKey, create);
}

function findKey(obj, key) {
    if (!obj || !key) return undefined;
    if (Object.prototype.hasOwnProperty.call(obj, key)) return key;
    const lower = key.toLowerCase();
    return Object.keys(obj).find(k => k.toLowerCase() === lower);
}

function listByKey(key, create = false) {
    const b = rootBucket('characterAbilities', create);
    if (!b) return null;
    const k = findKey(b, key);
    if (k !== undefined) return b[k];
    if (!create) return null;
    b[key] = [];
    return b[key];
}

/** The character's spells and abilities in the open chat (live array). */
export function getAbilities(name, isUser = false) {
    const list = listByKey(statKey(name, isUser));
    return Array.isArray(list) ? list : [];
}

function changed(detail) {
    saveChatScope();
    notifyStatsChanged({ source: 'abilities', ...detail });
}

export function addAbility(name, isUser, input) {
    const effects = input && input.effects !== undefined ? resolveEffectsFor(name, isUser, input.effects) : {};
    const a = makeAbility({ ...input, effects, source: 'user' });
    if (!a) return { error: 'Give it a name.' };
    const list = listByKey(statKey(name, isUser), true);
    if (findAbility(list, a.name)) return { error: `${name} already knows "${a.name}".` };
    if (list.length >= MAX_ABILITIES) return { error: `At most ${MAX_ABILITIES} spells and abilities.` };
    list.push(a);
    changed({ name });
    return a;
}

/** Edits any field of an entry. Returns true, or { error }. */
export function updateAbility(name, isUser, id, changes = {}) {
    const list = getAbilities(name, isUser);
    const a = list.find(x => x.id === id);
    if (!a) return { error: 'Not found.' };
    if (typeof changes.name === 'string' && changes.name.trim()) {
        const n = changes.name.trim().slice(0, 40);
        const dup = findAbility(list, n);
        if (dup && dup.id !== id) return { error: `${name} already knows "${n}".` };
        a.name = n;
    }
    if (typeof changes.desc === 'string') a.desc = changes.desc.trim().slice(0, 120);
    if (typeof changes.icon === 'string' && changes.icon.trim()) a.icon = cleanIcon(changes.icon);
    if (changes.type !== undefined) a.type = normalizeAbilityType(changes.type);
    if (typeof changes.aiCanRemove === 'boolean') a.aiCanRemove = changes.aiCanRemove;
    if (changes.effects !== undefined) a.effects = resolveEffectsFor(name, isUser, changes.effects);
    changed({ name });
    return true;
}

export function removeAbility(name, isUser, id) {
    const list = listByKey(statKey(name, isUser));
    if (!list) return false;
    const i = list.findIndex(a => a.id === id);
    if (i === -1) return false;
    list.splice(i, 1);
    changed({ name });
    return true;
}

export function deleteAbilitiesEverywhere(name, isUser = false) {
    const key = statKey(name, isUser).toLowerCase();
    for (const rootKey of ['characterAbilities', 'characterAbilitiesSeeded']) {
        const root = chatRootView(rootKey);
        if (!root || !name) continue;
        for (const b of Object.values(root)) {
            for (const k of Object.keys(b || {})) if (k.toLowerCase() === key) delete b[k];
        }
    }
}

export function mergeAbilities(canonical, variant) {
    const root = chatRootView('characterAbilities');
    if (!root || !canonical || !variant) return;
    const vKey = statKey(variant, false);
    const cKey = statKey(canonical, false);
    for (const b of Object.values(root)) {
        const vk = findKey(b, vKey);
        if (vk === undefined) continue;
        const ck = findKey(b, cKey);
        const target = ck !== undefined ? b[ck] : (b[cKey] = []);
        for (const a of b[vk] || []) if (!findAbility(target, a.name)) target.push(a);
        if (vk !== (ck ?? cKey)) delete b[vk];
    }
}

// ─── Starting abilities (asked once) ────────────────────────────────────────

function seededState(key) {
    const b = rootBucket('characterAbilitiesSeeded', false);
    const k = findKey(b, key);
    return k !== undefined ? b[k] : undefined;
}

function setSeeded(key, value) {
    const b = rootBucket('characterAbilitiesSeeded', true);
    const k = findKey(b, key);
    if (value === null || value === undefined) { if (k !== undefined) delete b[k]; return; }
    b[k !== undefined ? k : key] = value;
}

export function needsStartingAbilities(name, isUser = false) {
    const state = seededState(statKey(name, isUser));
    if (state === 'request') return true;
    return !state && getAbilities(name, isUser).length === 0;
}

export function requestStartingAbilities(name, isUser = false) {
    setSeeded(statKey(name, isUser), 'request');
    changed({ name });
}

export function cancelStartingAbilities(name, isUser = false) {
    setSeeded(statKey(name, isUser), true);
    changed({ name });
}

// ─── Prompt ─────────────────────────────────────────────────────────────────

export function buildAbilitiesPromptForGeneration({ compact = true, standalone = false } = {}) {
    if (!isAbilitiesEnabled()) return '';
    const entries = getStatCharacters().map(({ name, isUser }) => ({
        name,
        isUser,
        abilities: getAbilities(name, isUser),
        needsSeed: needsStartingAbilities(name, isUser),
        formatEffect: (eff) => describeEffects(name, isUser, eff),
    }));
    return buildAbilitiesPrompt(entries, { compact, standalone });
}

export function buildAbilitiesContextSummary() {
    if (!isAbilitiesEnabled()) return '';
    const lines = getStatCharacters()
        .map(({ name, isUser }) => ({ name, isUser, list: getAbilities(name, isUser) }))
        .filter(e => e.list.length)
        .map(e => `${e.name} — ${formatAbilities(e.list, (eff) => describeEffects(e.name, e.isUser, eff), { icons: false })}`);
    return lines.length ? 'Spells & abilities:\n' + lines.join('\n') : '';
}

// ─── Applying the AI's update ───────────────────────────────────────────────

export function applyAIAbilities(raw, messageIndex) {
    const result = { added: 0, removed: 0, blocked: [] };
    if (!isAbilitiesEnabled() || raw === null || raw === undefined) return result;
    const asked = getStatCharacters()
        .filter(c => needsStartingAbilities(c.name, c.isUser))
        .map(c => ({ key: statKey(c.name, c.isUser), prev: seededState(statKey(c.name, c.isUser)) ?? null }));
    const snapshots = [];
    for (const change of normalizeAIAbilities(raw)) {
        const target = resolveTarget(change.name);
        if (!target) continue;
        const key = statKey(target.name, target.isUser);
        const live = listByKey(key, true);
        const before = JSON.parse(JSON.stringify(live));
        const res = applyAbilityChange(live, change, (e) => resolveEffectsFor(target.name, target.isUser, e));
        for (const a of res.blocked) result.blocked.push({ name: target.name, item: a.name });
        if (!res.added && !res.removed) continue;
        live.splice(0, live.length, ...res.list);
        result.added += res.added;
        result.removed += res.removed;
        const prevSnap = snapshots.find(x => x.key === key);
        if (prevSnap) prevSnap.after = JSON.parse(JSON.stringify(live));
        else snapshots.push({ key, before, after: JSON.parse(JSON.stringify(live)) });
    }
    console.log(`[Dooms Tracker] Abilities: ${result.added} added, ${result.removed} removed${result.blocked.length ? `, ${result.blocked.length} locked kept` : ''}`);
    for (const a of asked) setSeeded(a.key, true);
    if (!snapshots.length && !asked.length) return result;
    const campaign = CHAT_SCOPE;
    try {
        if (chat_metadata) {
            if (!chat_metadata.dooms_tracker) chat_metadata.dooms_tracker = {};
            const prev = chat_metadata.dooms_tracker.abilitiesUndo;
            const same = prev && prev.messageIndex === messageIndex && prev.campaign === campaign;
            let snaps = snapshots;
            if (same && Array.isArray(prev.snapshots)) {
                snaps = prev.snapshots.map(p => ({ ...p }));
                for (const sn of snapshots) {
                    const old = snaps.find(x => x.key === sn.key);
                    if (old) old.after = sn.after;
                    else snaps.push(sn);
                }
            }
            chat_metadata.dooms_tracker.abilitiesUndo = {
                messageIndex, campaign, snapshots: snaps,
                seeded: same ? [...(prev.seeded || []), ...asked] : asked,
            };
        }
    } catch (e) { /* undo is best-effort */ }
    changed({ source: 'ai' });
    return result;
}

export function revertAIAbilitiesForReplacedMessage(replacedIndex) {
    try {
        const rec = chat_metadata?.dooms_tracker?.abilitiesUndo;
        if (!rec) return 0;
        const lastIdx = Array.isArray(chat) ? chat.length - 1 : -1;
        const idx = typeof replacedIndex === 'number' ? replacedIndex : lastIdx;
        if (rec.messageIndex !== idx && rec.messageIndex !== idx + 1) return 0;
        delete chat_metadata.dooms_tracker.abilitiesUndo;
        if (rec.campaign !== CHAT_SCOPE) return 0;
        let n = 0;
        for (const { key, before, after } of rec.snapshots || []) {
            const live = listByKey(key, true);
            if (JSON.stringify(live) !== JSON.stringify(after)) continue;
            live.splice(0, live.length, ...JSON.parse(JSON.stringify(before)));
            n++;
        }
        for (const { key, prev } of rec.seeded || []) setSeeded(key, prev);
        if (n || (rec.seeded || []).length) changed({ source: 'undo' });
        saveChatData();
        return n;
    } catch (e) {
        console.warn('[Dooms Tracker] Abilities: undo failed', e);
        return 0;
    }
}
