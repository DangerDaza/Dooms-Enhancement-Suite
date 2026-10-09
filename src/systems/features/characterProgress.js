/**
 * Experience, levels and the party — storage and AI round-trip.
 *
 * One progress record per character per chat (see chatScope.js):
 *   chat_metadata.dooms_tracker.betterStats.characterProgress["npc:Name"|"user:Name"] = record
 * (record shape in src/utils/xpModel.js).
 *
 * - The persona and every NPC marked "in the party" share XP: each award
 *   goes in full to every member.
 * - The AI awards XP through an "xp" key in the tracker JSON, naming only a
 *   size (small / medium / large / epic); the user's table turns it into XP.
 * - Completing a quest from the Quests panel gives the party XP too.
 * - Each level gained gives attribute points; spending one raises the
 *   attribute's value in this chat by 1 (refundable).
 * - NPCs get a level from the AI the first time they are in a scene
 *   ("levels" key), together with their generated stats, and again when
 *   their stats are regenerated.
 * - A swipe restores the records the replaced reply changed (snapshot undo,
 *   chat_metadata.dooms_tracker.xpUndo).
 */
import { chat, chat_metadata } from '../../../../../../../script.js';
import { extensionSettings } from '../../core/state.js';
import { saveSettings, saveChatData } from '../../core/persistence.js';
import { isRpgModeActive } from './rpgMode.js';
import { chatStore, chatRootView, saveChatScope, CHAT_SCOPE } from './chatScope.js';
import {
    statKey,
    notifyStatsChanged,
    getStatCharacters,
    getPersonaName,
    getStatSheet,
    getCurrentStatValues,
    setCurrentStatValue,
} from './characterStats.js';
import { resolveTarget } from './characterEquipment.js';
import {
    normalizeRecord,
    awardXp as awardRecord,
    setRecordLevel,
    levelProgress,
    normalizeAIXp,
    normalizeAILevels,
    resolveTiers,
    clampPerLevel,
    clampPointsPerLevel,
    buildXpPrompt,
    formatXpAmount,
    XP_SIZES,
} from '../../utils/xpModel.js';

// ─── Settings ───────────────────────────────────────────────────────────────

/** Levels are shown and kept whenever RPG mode is on. */
export function isProgressEnabled() {
    return isRpgModeActive() && extensionSettings.characterLevelsEnabled !== false;
}

/** XP awards (from the AI and quests) — can be off while levels stay. */
export function isXpEnabled() {
    return isProgressEnabled() && extensionSettings.characterXpEnabled !== false;
}

export function setLevelsEnabled(on) {
    extensionSettings.characterLevelsEnabled = !!on;
    saveSettings();
    notifyStatsChanged({ source: 'settings' });
}

export function setXpEnabled(on) {
    extensionSettings.characterXpEnabled = !!on;
    saveSettings();
    notifyStatsChanged({ source: 'settings' });
}

/** { tiers, perLevel, pointsPerLevel, questMain, questOptional } */
export function getXpSettings() {
    const s = extensionSettings;
    const size = (v, d) => (XP_SIZES.includes(v) ? v : d);
    return {
        tiers: resolveTiers(s.xpTiers),
        perLevel: clampPerLevel(s.xpPerLevel),
        pointsPerLevel: clampPointsPerLevel(s.xpPointsPerLevel),
        questMain: size(s.xpQuestMain, 'epic'),
        questOptional: size(s.xpQuestOptional, 'large'),
    };
}

export function setXpSetting(key, value) {
    const s = extensionSettings;
    if (key === 'perLevel') s.xpPerLevel = clampPerLevel(value);
    else if (key === 'pointsPerLevel') s.xpPointsPerLevel = clampPointsPerLevel(value);
    else if (key === 'questMain' && XP_SIZES.includes(value)) s.xpQuestMain = value;
    else if (key === 'questOptional' && XP_SIZES.includes(value)) s.xpQuestOptional = value;
    else if (XP_SIZES.includes(key)) s.xpTiers = { ...resolveTiers(s.xpTiers), [key]: value };
    else return;
    if (XP_SIZES.includes(key)) s.xpTiers = resolveTiers(s.xpTiers);
    saveSettings();
    notifyStatsChanged({ source: 'settings' });
}

// ─── Storage ────────────────────────────────────────────────────────────────

function bucket(create = false) {
    return chatStore('characterProgress', create);
}

function findKey(obj, key) {
    if (!obj || !key) return undefined;
    if (Object.prototype.hasOwnProperty.call(obj, key)) return key;
    const lower = key.toLowerCase();
    return Object.keys(obj).find(k => k.toLowerCase() === lower);
}

function readByKey(key) {
    const b = bucket();
    const k = findKey(b, key);
    return normalizeRecord(k !== undefined ? b[k] : null);
}

function writeByKey(key, record) {
    const b = bucket(true);
    const k = findKey(b, key);
    b[k !== undefined ? k : key] = normalizeRecord(record);
}

function storedRaw(key) {
    const b = bucket();
    const k = findKey(b, key);
    return k !== undefined ? b[k] : null;
}

/** The character's record in the open chat (a copy; defaults when none). */
export function getProgress(name, isUser = false) {
    return readByKey(statKey(name, isUser));
}

/** { level, xp, into, needed, pct } for the bar. */
export function getLevelInfo(name, isUser = false) {
    return levelProgress(getProgress(name, isUser), getXpSettings().perLevel);
}

/** Whether the character has a level to show (the persona always does). */
export function hasLevel(name, isUser = false) {
    if (isUser) return true;
    const r = getProgress(name, false);
    return !!r.levelSet || r.party || r.xp > 0;
}

function changed(detail) {
    saveChatScope();
    notifyStatsChanged({ source: 'progress', ...detail });
}

function toast(kind, text, title = 'Level up') {
    try { window.toastr?.[kind]?.(text, title, { timeOut: 6000 }); } catch (e) { /* no toastr */ }
}

// ─── Party ──────────────────────────────────────────────────────────────────

export function isPartyMember(name) {
    return getProgress(name, false).party;
}

/** Puts an NPC in or out of the party (this chat). */
export function setPartyMember(name, on) {
    if (!name) return;
    const key = statKey(name, false);
    const r = readByKey(key);
    r.party = !!on;
    // A new member who never had a level starts at the persona's.
    if (on && !r.levelSet && r.xp === 0 && r.level === 1) {
        const persona = getPersonaName();
        if (persona) {
            const p = getProgress(persona, true);
            if (p.level > 1) Object.assign(r, setRecordLevel(r, p.level, { perLevel: getXpSettings().perLevel }), { party: true });
        }
    }
    writeByKey(key, r);
    changed({ name });
}

/** Everyone who earns XP: the persona plus the NPCs marked as party members. */
export function getPartyMembers() {
    const out = [];
    const persona = getPersonaName();
    if (persona) out.push({ name: persona, isUser: true });
    const b = bucket() || {};
    for (const [key, raw] of Object.entries(b)) {
        if (!key.startsWith('npc:') || !raw || raw.party !== true) continue;
        out.push({ name: key.slice(4), isUser: false });
    }
    return out;
}

// ─── Awards ─────────────────────────────────────────────────────────────────

/**
 * Gives `amount` XP to one character. Returns { levelsGained, pointsGained }.
 * Records no undo (manual and quest awards are the user's own doing).
 * Persists and notifies unless `persist` is false (batch callers do it once).
 */
export function awardXpTo(name, isUser, amount, { reason = '', source = 'user', silent = false, persist = true } = {}) {
    const key = statKey(name, isUser);
    const { perLevel, pointsPerLevel } = getXpSettings();
    const res = awardRecord(readByKey(key), amount, { reason, source, perLevel, pointsPerLevel });
    writeByKey(key, res.record);
    if (res.levelsGained && !silent) {
        toast('success', `${name} reached level ${res.record.level}${res.pointsGained ? ` — ${res.pointsGained} attribute point${res.pointsGained === 1 ? '' : 's'} to assign` : ''}.`);
    }
    if (persist) changed({ name });
    return { levelsGained: res.levelsGained, pointsGained: res.pointsGained, level: res.record.level };
}

/**
 * Gives every party member the same XP. Returns the members' keys and
 * level-ups. Persists and notifies.
 */
export function awardPartyXp(amount, { reason = '', source = 'ai' } = {}) {
    const members = getPartyMembers();
    const ups = [];
    for (const m of members) {
        const r = awardXpTo(m.name, m.isUser, amount, { reason, source, silent: true, persist: false });
        if (r.levelsGained) ups.push({ ...m, ...r });
    }
    for (const u of ups) {
        toast('success', `${u.name} reached level ${u.level}${u.pointsGained ? ` — ${u.pointsGained} attribute point${u.pointsGained === 1 ? '' : 's'} to assign` : ''}.`);
    }
    if (members.length) changed({ source: source === 'quest' ? 'quest' : 'progress' });
    return { members, levelUps: ups };
}

/** XP for a quest the user marked as completed in the Quests panel. */
export function awardQuestXp(title, kind = 'optional') {
    if (!isXpEnabled()) return null;
    const { tiers, questMain, questOptional } = getXpSettings();
    const size = kind === 'main' ? questMain : questOptional;
    const amount = tiers[size];
    const name = String(title || '').trim() || 'a quest';
    const res = awardPartyXp(amount, { reason: `Quest completed: ${name}`, source: 'quest' });
    if (res.members.length && !res.levelUps.length) toast('info', `${formatXpAmount(amount)} to the party for "${name}".`, 'Quest completed');
    console.log(`[Dooms Tracker] XP: quest "${name}" completed → ${amount} XP to ${res.members.length} party member(s)`);
    return { amount, ...res };
}

/** Removes one log entry and takes its XP back (the level stays). */
export function removeLogEntry(name, isUser, id) {
    const key = statKey(name, isUser);
    const r = readByKey(key);
    const i = r.log.findIndex(e => e.id === id);
    if (i === -1) return false;
    const [entry] = r.log.splice(i, 1);
    r.xp = Math.max(0, r.xp - entry.amount);
    writeByKey(key, r);
    changed({ name });
    return true;
}

/** Sets the level by hand (XP moves to the start of that level). */
export function setLevel(name, isUser, level) {
    const key = statKey(name, isUser);
    const r = setRecordLevel(readByKey(key), level, { perLevel: getXpSettings().perLevel, by: 'user' });
    writeByKey(key, r);
    changed({ name });
    return r.level;
}

/** Sets the unspent attribute points by hand. */
export function setUnspentPoints(name, isUser, points) {
    const key = statKey(name, isUser);
    const r = readByKey(key);
    const n = Math.round(Number(points));
    r.points = Number.isFinite(n) ? Math.min(Math.max(n, 0), 999) : r.points;
    writeByKey(key, r);
    changed({ name });
    return r.points;
}

// ─── Attribute points ───────────────────────────────────────────────────────

function attribute(name, isUser, statId) {
    const stat = getStatSheet(name, isUser).find(s => s.id === statId);
    return stat && stat.kind === 'attribute' && stat.enabled !== false ? stat : null;
}

/** Spends one point on an attribute: its value in this chat goes up by 1. */
export function spendPoint(name, isUser, statId) {
    const key = statKey(name, isUser);
    const r = readByKey(key);
    const stat = attribute(name, isUser, statId);
    if (!stat || r.points < 1) return false;
    const cur = getCurrentStatValues(name, isUser)[statId];
    if (cur >= stat.max) return false;
    setCurrentStatValue(name, isUser, statId, cur + 1, { persist: false, silent: true });
    r.points -= 1;
    r.spent[statId] = (r.spent[statId] || 0) + 1;
    writeByKey(key, r);
    changed({ name });
    return true;
}

/** Takes back one point spent on an attribute. */
export function refundPoint(name, isUser, statId) {
    const key = statKey(name, isUser);
    const r = readByKey(key);
    const stat = attribute(name, isUser, statId);
    if (!stat || !(r.spent[statId] > 0)) return false;
    const cur = getCurrentStatValues(name, isUser)[statId];
    setCurrentStatValue(name, isUser, statId, Math.max(stat.min, cur - 1), { persist: false, silent: true });
    r.points += 1;
    r.spent[statId] -= 1;
    if (!r.spent[statId]) delete r.spent[statId];
    writeByKey(key, r);
    changed({ name });
    return true;
}

// ─── Cleanup hooks ──────────────────────────────────────────────────────────

export function deleteProgressEverywhere(name, isUser = false) {
    const root = chatRootView('characterProgress');
    if (!root || !name) return;
    const key = statKey(name, isUser).toLowerCase();
    for (const b of Object.values(root)) {
        for (const k of Object.keys(b || {})) if (k.toLowerCase() === key) delete b[k];
    }
}

/** Alias merge: the variant's record is kept only when the canonical has none. */
export function mergeProgress(canonical, variant) {
    const root = chatRootView('characterProgress');
    if (!root || !canonical || !variant) return;
    const vKey = statKey(variant, false);
    const cKey = statKey(canonical, false);
    for (const b of Object.values(root)) {
        const vk = findKey(b, vKey);
        if (vk === undefined) continue;
        if (findKey(b, cKey) === undefined) b[cKey] = b[vk];
        if (vk !== cKey) delete b[vk];
    }
}

// ─── Prompt ─────────────────────────────────────────────────────────────────

/** Scene NPCs that still need a level from the AI. */
export function needsLevel(name, isUser = false) {
    if (isUser) return false;
    const raw = storedRaw(statKey(name, false));
    if (!raw) return true;
    if (raw.levelAsk === true) return true;
    // Party members and anyone who earned XP have a level already (1 or more).
    return !raw.levelSet && !(raw.party || raw.xp > 0);
}

/**
 * Asks the AI for the NPC's level again (Workshop → Regenerate with AI).
 * Party members keep theirs: it was earned.
 */
export function requestLevelGeneration(name) {
    if (!name) return;
    const key = statKey(name, false);
    const r = readByKey(key);
    if (r.party) return;
    r.levelAsk = true;
    writeByKey(key, r);
    saveChatScope();
}

export function buildProgressPromptForGeneration({ compact = true, standalone = false } = {}) {
    if (!isProgressEnabled()) return '';
    const { tiers, perLevel } = getXpSettings();
    const party = getPartyMembers().map(m => ({ ...m, ...levelProgress(getProgress(m.name, m.isUser), perLevel) }));
    const partyKeys = new Set(party.map(p => statKey(p.name, p.isUser).toLowerCase()));
    const scene = getStatCharacters().filter(c => !c.isUser && !partyKeys.has(statKey(c.name, false).toLowerCase()));
    const needLevels = scene.filter(c => needsLevel(c.name)).map(c => c.name);
    const known = scene.filter(c => !needsLevel(c.name) && hasLevel(c.name)).map(c => ({ name: c.name, level: getProgress(c.name).level }));
    return buildXpPrompt({ party, known, needLevels, tiers, awards: isXpEnabled(), compact, standalone });
}

/** "Levels: Ana Lv 3 (party), Bram Lv 5" for the separate-mode context block. */
export function buildProgressContextSummary() {
    if (!isProgressEnabled()) return '';
    const seen = new Set();
    const items = [];
    for (const c of [...getPartyMembers(), ...getStatCharacters()]) {
        const k = statKey(c.name, c.isUser).toLowerCase();
        if (seen.has(k) || !hasLevel(c.name, c.isUser)) continue;
        seen.add(k);
        const r = getProgress(c.name, c.isUser);
        items.push(`${c.name} Lv ${r.level}${c.isUser || r.party ? ' (party)' : ''}`);
    }
    return items.length ? 'Levels: ' + items.join(', ') : '';
}

// ─── Applying the AI's update ───────────────────────────────────────────────

function recordSnapshots(snapshots, messageIndex) {
    if (!snapshots.length) return;
    const campaign = CHAT_SCOPE;
    try {
        if (!chat_metadata) return;
        if (!chat_metadata.dooms_tracker) chat_metadata.dooms_tracker = {};
        const prev = chat_metadata.dooms_tracker.xpUndo;
        let snaps = snapshots;
        if (prev && prev.messageIndex === messageIndex && prev.campaign === campaign && Array.isArray(prev.snapshots)) {
            snaps = prev.snapshots.map(p => ({ ...p }));
            for (const sn of snapshots) {
                const old = snaps.find(x => x.key === sn.key);
                if (old) old.after = sn.after;
                else snaps.push(sn);
            }
        }
        chat_metadata.dooms_tracker.xpUndo = { messageIndex, campaign, snapshots: snaps };
    } catch (e) { /* undo is best-effort */ }
}

function snapshotChange(snapshots, key, before) {
    const after = JSON.parse(JSON.stringify(storedRaw(key)));
    const prev = snapshots.find(x => x.key === key);
    if (prev) prev.after = after;
    else snapshots.push({ key, before, after });
}

/**
 * Applies the "xp" award and the "levels" of a fresh reply. Levels are read
 * first (before stats generation clears the pending flag they look at).
 * @returns {{amount: number, members: number, levels: number}}
 */
export function applyAIProgress(rawXp, rawLevels, messageIndex) {
    const result = { amount: 0, members: 0, levels: 0 };
    if (!isProgressEnabled()) return result;
    const snapshots = [];
    const { perLevel } = getXpSettings();

    if (rawLevels !== null && rawLevels !== undefined) {
        for (const { name, level } of normalizeAILevels(rawLevels)) {
            const target = resolveTarget(name);
            if (!target || target.isUser || !needsLevel(target.name)) continue;
            const key = statKey(target.name, false);
            const before = JSON.parse(JSON.stringify(storedRaw(key)));
            const r = setRecordLevel(readByKey(key), level, { perLevel, by: 'ai' });
            writeByKey(key, r);
            snapshotChange(snapshots, key, before);
            result.levels++;
        }
    }

    if (isXpEnabled() && rawXp !== null && rawXp !== undefined) {
        const award = normalizeAIXp(rawXp, getXpSettings().tiers);
        if (award) {
            const members = getPartyMembers();
            const befores = members.map(m => {
                const key = statKey(m.name, m.isUser);
                const b = bucket();
                const k = findKey(b, key);
                return { key: k !== undefined ? k : key, before: JSON.parse(JSON.stringify(storedRaw(key))) };
            });
            const reason = award.reason || `${award.size[0].toUpperCase()}${award.size.slice(1)} deed`;
            const res = awardPartyXp(award.amount, { reason, source: 'ai' });
            for (const { key, before } of befores) snapshotChange(snapshots, key, before);
            result.amount = award.amount;
            result.members = res.members.length;
        }
    }

    console.log(`[Dooms Tracker] XP: ${result.amount ? `+${result.amount} to ${result.members} party member(s)` : 'no award'}, ${result.levels} NPC level(s) set`);
    if (!snapshots.length) return result;
    recordSnapshots(snapshots, messageIndex);
    changed({ source: 'ai' });
    return result;
}

/**
 * Before a swipe/regenerate replaces the last reply: put back the records
 * that reply changed, where nobody touched them since.
 */
export function revertAIProgressForReplacedMessage(replacedIndex) {
    try {
        const rec = chat_metadata?.dooms_tracker?.xpUndo;
        if (!rec) return 0;
        const lastIdx = Array.isArray(chat) ? chat.length - 1 : -1;
        const idx = typeof replacedIndex === 'number' ? replacedIndex : lastIdx;
        if (rec.messageIndex !== idx && rec.messageIndex !== idx + 1) return 0;
        delete chat_metadata.dooms_tracker.xpUndo;
        if (rec.campaign !== CHAT_SCOPE) return 0;
        let n = 0;
        for (const { key, before, after } of rec.snapshots || []) {
            if (JSON.stringify(storedRaw(key)) !== JSON.stringify(after)) continue;
            const b = bucket(true);
            const k = findKey(b, key);
            if (before === null || before === undefined) delete b[k !== undefined ? k : key];
            else b[k !== undefined ? k : key] = JSON.parse(JSON.stringify(before));
            n++;
        }
        if (n) changed({ source: 'undo' });
        saveChatData();
        return n;
    } catch (e) {
        console.warn('[Dooms Tracker] XP: undo failed', e);
        return 0;
    }
}
