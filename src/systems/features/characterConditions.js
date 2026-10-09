/**
 * Character Conditions — storage and AI round-trip.
 *
 * Temporary states (Poisoned, Wounded leg, Drunk, Blessed…) for every
 * character, persona included, per chat (see chatScope.js):
 *   chat_metadata.dooms_tracker.betterStats.characterConditions["npc:Name"|"user:Name"] = [condition, ...]
 *
 * The AI adds and removes them through a "conditions" key in the tracker
 * JSON; the user adds and removes them in the Stats panel. Attribute effects
 * of a condition apply while it lasts (see characterModifiers.js). A swipe
 * restores the lists the replaced reply changed (snapshot undo, like
 * equipment).
 *
 * The pure logic is in src/utils/conditionModel.js.
 */
import { chat, chat_metadata } from '../../../../../../../script.js';
import { extensionSettings } from '../../core/state.js';
import { isRpgModeActive } from './rpgMode.js';
import { chatStore, chatRootView, saveChatScope, CHAT_SCOPE } from './chatScope.js';
import { saveSettings, saveChatData } from '../../core/persistence.js';
import {
    MAX_CONDITIONS,
    makeCondition,
    findCondition,
    normalizeAIConditions,
    applyConditionChange,
    buildConditionsPrompt,
    formatConditions,
} from '../../utils/conditionModel.js';
import { cleanIcon } from '../../utils/equipmentModel.js';
import { getStatCharacters, statKey, notifyStatsChanged } from './characterStats.js';
import { resolveTarget, resolveEffectsFor, describeEffects } from './characterEquipment.js';

// ─── Settings ───────────────────────────────────────────────────────────────

export function isConditionsEnabled() {
    return isRpgModeActive() && extensionSettings.characterConditionsEnabled !== false;
}

export function setConditionsEnabled(on) {
    extensionSettings.characterConditionsEnabled = !!on;
    saveSettings();
    notifyStatsChanged({ source: 'settings' });
}

// ─── Storage ────────────────────────────────────────────────────────────────

function bucket(create = false) {
    return chatStore('characterConditions', create);
}

function findKey(obj, key) {
    if (!obj || !key) return undefined;
    if (Object.prototype.hasOwnProperty.call(obj, key)) return key;
    const lower = key.toLowerCase();
    return Object.keys(obj).find(k => k.toLowerCase() === lower);
}

function listByKey(key, create = false) {
    const b = bucket(create);
    if (!b) return null;
    const k = findKey(b, key);
    if (k !== undefined) return b[k];
    if (!create) return null;
    b[key] = [];
    return b[key];
}

/** The character's conditions in the open chat (live array). */
export function getConditions(name, isUser = false) {
    const list = listByKey(statKey(name, isUser));
    return Array.isArray(list) ? list : [];
}

function changed(detail) {
    saveChatScope();
    notifyStatsChanged({ source: 'conditions', ...detail });
}

export function addCondition(name, isUser, input) {
    const effects = input && input.effects !== undefined ? resolveEffectsFor(name, isUser, input.effects) : {};
    const c = makeCondition({ ...input, effects, source: 'user' });
    if (!c) return { error: 'Give the condition a name.' };
    const list = listByKey(statKey(name, isUser), true);
    if (findCondition(list, c.name)) return { error: `${name} is already "${c.name}".` };
    if (list.length >= MAX_CONDITIONS) return { error: `At most ${MAX_CONDITIONS} conditions.` };
    list.push(c);
    changed({ name });
    return c;
}

/** Edits any field of a condition. Returns true, or { error }. */
export function updateCondition(name, isUser, id, changes = {}) {
    const list = getConditions(name, isUser);
    const c = list.find(x => x.id === id);
    if (!c) return { error: 'Not found.' };
    if (typeof changes.name === 'string' && changes.name.trim()) {
        const n = changes.name.trim().slice(0, 40);
        const dup = findCondition(list, n);
        if (dup && dup.id !== id) return { error: `${name} is already "${n}".` };
        c.name = n;
    }
    if (typeof changes.desc === 'string') c.desc = changes.desc.trim().slice(0, 120);
    if (typeof changes.icon === 'string' && changes.icon.trim()) c.icon = cleanIcon(changes.icon);
    if (changes.effects !== undefined) c.effects = resolveEffectsFor(name, isUser, changes.effects);
    changed({ name });
    return true;
}

export function removeCondition(name, isUser, id) {
    const list = listByKey(statKey(name, isUser));
    if (!list) return false;
    const i = list.findIndex(c => c.id === id);
    if (i === -1) return false;
    list.splice(i, 1);
    changed({ name });
    return true;
}

export function deleteConditionsEverywhere(name, isUser = false) {
    const root = chatRootView('characterConditions');
    if (!root || !name) return;
    const key = statKey(name, isUser).toLowerCase();
    for (const b of Object.values(root)) {
        for (const k of Object.keys(b || {})) if (k.toLowerCase() === key) delete b[k];
    }
}

export function mergeConditions(canonical, variant) {
    const root = chatRootView('characterConditions');
    if (!root || !canonical || !variant) return;
    const vKey = statKey(variant, false);
    const cKey = statKey(canonical, false);
    for (const b of Object.values(root)) {
        const vk = findKey(b, vKey);
        if (vk === undefined) continue;
        const ck = findKey(b, cKey);
        const target = ck !== undefined ? b[ck] : (b[cKey] = []);
        for (const c of b[vk] || []) if (!findCondition(target, c.name)) target.push(c);
        if (vk !== (ck ?? cKey)) delete b[vk];
    }
}

// ─── Prompt ─────────────────────────────────────────────────────────────────

export function buildConditionsPromptForGeneration({ compact = true, standalone = false } = {}) {
    if (!isConditionsEnabled()) return '';
    const entries = getStatCharacters().map(({ name, isUser }) => ({
        name,
        isUser,
        conditions: getConditions(name, isUser),
        formatEffect: (eff) => describeEffects(name, isUser, eff),
    }));
    return buildConditionsPrompt(entries, { compact, standalone });
}

export function buildConditionsContextSummary() {
    if (!isConditionsEnabled()) return '';
    const lines = getStatCharacters()
        .map(({ name, isUser }) => ({ name, isUser, list: getConditions(name, isUser) }))
        .filter(e => e.list.length)
        .map(e => `${e.name}: ${formatConditions(e.list, (eff) => describeEffects(e.name, e.isUser, eff), { icons: false })}`);
    return lines.length ? 'Conditions:\n' + lines.join('\n') : '';
}

// ─── Applying the AI's update ───────────────────────────────────────────────

export function applyAIConditions(raw, messageIndex) {
    const result = { added: 0, removed: 0 };
    if (!isConditionsEnabled() || raw === null || raw === undefined) return result;
    const snapshots = [];
    for (const change of normalizeAIConditions(raw)) {
        const target = resolveTarget(change.name);
        if (!target) continue;
        const key = statKey(target.name, target.isUser);
        const live = listByKey(key, true);
        const before = JSON.parse(JSON.stringify(live));
        const res = applyConditionChange(live, change, (e) => resolveEffectsFor(target.name, target.isUser, e));
        if (!res.added && !res.removed) continue;
        live.splice(0, live.length, ...res.list);
        result.added += res.added;
        result.removed += res.removed;
        const prevSnap = snapshots.find(x => x.key === key);
        if (prevSnap) prevSnap.after = JSON.parse(JSON.stringify(live));
        else snapshots.push({ key, before, after: JSON.parse(JSON.stringify(live)) });
    }
    console.log(`[Dooms Tracker] Conditions: ${result.added} added, ${result.removed} removed`);
    if (!snapshots.length) return result;
    const campaign = CHAT_SCOPE;
    try {
        if (chat_metadata) {
            if (!chat_metadata.dooms_tracker) chat_metadata.dooms_tracker = {};
            const prev = chat_metadata.dooms_tracker.conditionsUndo;
            let snaps = snapshots;
            if (prev && prev.messageIndex === messageIndex && prev.campaign === campaign && Array.isArray(prev.snapshots)) {
                snaps = prev.snapshots.map(p => ({ ...p }));
                for (const sn of snapshots) {
                    const old = snaps.find(x => x.key === sn.key);
                    if (old) old.after = sn.after;
                    else snaps.push(sn);
                }
            }
            chat_metadata.dooms_tracker.conditionsUndo = { messageIndex, campaign, snapshots: snaps };
        }
    } catch (e) { /* undo is best-effort */ }
    changed({ source: 'ai' });
    return result;
}

export function revertAIConditionsForReplacedMessage(replacedIndex) {
    try {
        const rec = chat_metadata?.dooms_tracker?.conditionsUndo;
        if (!rec) return 0;
        const lastIdx = Array.isArray(chat) ? chat.length - 1 : -1;
        const idx = typeof replacedIndex === 'number' ? replacedIndex : lastIdx;
        if (rec.messageIndex !== idx && rec.messageIndex !== idx + 1) return 0;
        delete chat_metadata.dooms_tracker.conditionsUndo;
        if (rec.campaign !== CHAT_SCOPE) return 0;
        let n = 0;
        for (const { key, before, after } of rec.snapshots || []) {
            const live = listByKey(key, true);
            if (JSON.stringify(live) !== JSON.stringify(after)) continue;
            live.splice(0, live.length, ...JSON.parse(JSON.stringify(before)));
            n++;
        }
        if (n) changed({ source: 'undo' });
        saveChatData();
        return n;
    } catch (e) {
        console.warn('[Dooms Tracker] Conditions: undo failed', e);
        return 0;
    }
}
