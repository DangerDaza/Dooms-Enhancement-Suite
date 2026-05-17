/**
 * Context Inspector — captures every payload DES queues or injects into
 * SillyTavern's generation pipeline so the user can see exactly what is
 * being added to the model's context, verbatim.
 *
 * Surfaces:
 *  - currentSlots: live state of every DES setExtensionPrompt slot. Updated
 *    the instant DES writes the slot, so opening the inspector before a
 *    generation shows what's queued to go out on the next send.
 *  - generationLog: a rolling per-generation record (default 25 entries)
 *    containing slot writes that happened during that generation, in-flight
 *    event mutations (historical context append, <context> newline fixup,
 *    suppression clears), and the separate-mode tracker prompt if any.
 *
 * Why this exists: ST's built-in Prompt Inspector only sees the assembled
 * prompt at one specific phase. It misses (a) extension prompts written
 * just-in-time then cleared on suppression, (b) appends made inside
 * CHAT_COMPLETION_PROMPT_READY / GENERATE_BEFORE_COMBINE_PROMPTS event
 * hooks, and (c) the entire second API call DES makes in separate/external
 * mode. This module sees all three.
 */
import { eventSource, event_types, setExtensionPrompt } from '../../../../../../../script.js';

// ─── Slot registry ──────────────────────────────────────────────────────────
// Maps slot key → metadata. Lets the inspector show a friendly name + reason
// for each slot without the UI having to know about every feature.
const SLOT_REGISTRY = {
    'dooms-tracker-inject':            { label: 'Tracker Instructions',     source: 'injector',  feature: 'Tracker (Together mode)' },
    'dooms-tracker-example':           { label: 'Previous Tracker Example', source: 'injector',  feature: 'Tracker (Together mode)' },
    'dooms-tracker-context':           { label: 'Contextual Summary',       source: 'injector',  feature: 'Tracker (Separate/External mode)' },
    'dooms-tracker-html':              { label: 'HTML Formatting Prompt',   source: 'injector',  feature: 'HTML Output' },
    'dooms-tracker-dialogue-coloring': { label: 'Dialogue Coloring Prompt', source: 'injector',  feature: 'Dialogue Coloring' },
    'dooms-tracker-new-fields':        { label: 'New-Field Boost',          source: 'injector',  feature: 'Tracker (new widgets)' },
    'dooms-tracker-name-ban':          { label: 'Name Ban Instruction',     source: 'injector',  feature: 'Name Ban' },
    'dooms-doom-counter-twist':        { label: 'Pending Plot Twist',       source: 'injector',  feature: 'Doom Counter' },
    'dooms-doom-counter-tension':      { label: 'Tension Reporting',        source: 'injector',  feature: 'Doom Counter' },
    'dooms-workshop-scene-inject':     { label: 'Workshop: Inject Character', source: 'workshop', feature: 'Character Workshop' },
    'dooms-workshop-scene-eject':      { label: 'Workshop: Eject Character',  source: 'workshop', feature: 'Character Workshop' },
    'dooms-workshop-banned-characters':{ label: 'Workshop: Banned Characters', source: 'workshop', feature: 'Character Workshop' },
};

// ─── State ─────────────────────────────────────────────────────────────────
/** @type {Map<string, {content: string, position: number, depth: number, role: number|undefined, lastWriteAt: number, label: string, source: string, feature: string}>} */
const currentSlots = new Map();

/** Initialise an empty entry for every known slot so the UI lists them all from the start. */
for (const [key, meta] of Object.entries(SLOT_REGISTRY)) {
    currentSlots.set(key, {
        content: '',
        position: 1,
        depth: 0,
        role: undefined,
        lastWriteAt: 0,
        label: meta.label,
        source: meta.source,
        feature: meta.feature,
    });
}

/** @typedef {{event: string, msgIdx: number|null, reason: string, beforeSnippet: string, afterSnippet: string, fullBefore?: string, fullAfter?: string, timestamp: number}} EventMutation */
/** @typedef {{slot: string, label: string, content: string, previousContent: string, position: number, depth: number, role: number|undefined, source: string, feature: string, timestamp: number}} SlotWriteEntry */
/** @typedef {{id: number, startedAt: number, endedAt: number|null, type: string|null, dryRun: boolean, slotWrites: SlotWriteEntry[], eventMutations: EventMutation[], separateTrackerPrompt: string|null}} GenerationRecord */

/** @type {GenerationRecord[]} */
const generationLog = [];
const MAX_LOG_ENTRIES = 25;

/** @type {GenerationRecord|null} */
let activeGeneration = null;
let _generationCounter = 0;

// ─── Recording API ─────────────────────────────────────────────────────────

/**
 * Record a DES slot write. Always updates currentSlots; also appends to the
 * active generation record if one is in progress (so the per-gen log shows
 * what was queued or cleared during that specific generation).
 *
 * Called from the desSetExtensionPrompt wrapper — see below.
 */
export function recordSlotWrite(slot, content, position, depth, role) {
    const safeContent = typeof content === 'string' ? content : '';
    const meta = SLOT_REGISTRY[slot] || { label: slot, source: 'unknown', feature: 'Unknown' };
    const prev = currentSlots.get(slot);
    const previousContent = prev ? prev.content : '';
    const now = Date.now();
    currentSlots.set(slot, {
        content: safeContent,
        position: position ?? 1,
        depth: depth ?? 0,
        role,
        lastWriteAt: now,
        label: meta.label,
        source: meta.source,
        feature: meta.feature,
    });
    if (activeGeneration) {
        activeGeneration.slotWrites.push({
            slot,
            label: meta.label,
            content: safeContent,
            previousContent,
            position: position ?? 1,
            depth: depth ?? 0,
            role,
            source: meta.source,
            feature: meta.feature,
            timestamp: now,
        });
    }
}

/**
 * Record an in-flight prompt mutation made inside one of the prompt-ready
 * event hooks. These never go through setExtensionPrompt so they need their
 * own capture path. Snippets are clipped to keep memory bounded; full
 * before/after are stored only when small enough to be useful.
 *
 * @param {string} event - One of 'GENERATE_BEFORE_COMBINE_PROMPTS' | 'GENERATE_AFTER_COMBINE_PROMPTS' | 'CHAT_COMPLETION_PROMPT_READY' | 'late-suppression' | 'extension-disabled-clear'
 * @param {number|null} msgIdx - Chat message index touched, or null for prompt-wide changes
 * @param {string} reason - Short human-readable why ("appended historical tracker context", "<context> newline fixup", ...)
 * @param {string} before - Full content before mutation (or empty)
 * @param {string} after - Full content after mutation (or empty)
 */
export function recordEventMutation(event, msgIdx, reason, before, after) {
    if (!activeGeneration) {
        // Mutations can happen during a generation we never bracketed (e.g.,
        // a hot-reload race). Open a synthetic record so the data isn't
        // dropped on the floor — better one orphan entry than silent loss.
        beginGeneration({ type: '(synthetic)', dryRun: false });
    }
    const safeBefore = typeof before === 'string' ? before : '';
    const safeAfter = typeof after === 'string' ? after : '';
    const SNIPPET_LEN = 400;
    const FULL_KEEP_LEN = 4000;
    activeGeneration.eventMutations.push({
        event,
        msgIdx,
        reason,
        beforeSnippet: clipForSnippet(safeBefore, SNIPPET_LEN),
        afterSnippet: clipForSnippet(safeAfter, SNIPPET_LEN),
        fullBefore: safeBefore.length <= FULL_KEEP_LEN ? safeBefore : undefined,
        fullAfter: safeAfter.length <= FULL_KEEP_LEN ? safeAfter : undefined,
        timestamp: Date.now(),
    });
}

/**
 * Record the verbatim prompt sent during a separate/external-mode tracker
 * update. This is the second API call DES makes per turn and is invisible
 * to ST's Prompt Inspector.
 *
 * Important lifecycle note: this is called BEFORE safeGenerateRaw, which
 * itself fires GENERATION_STARTED and would clobber an active record. So
 * we don't attach to activeGeneration — we push a standalone record into
 * the log directly. That keeps the prompt safe regardless of timing.
 */
export function recordSeparateTrackerPrompt(prompt) {
    _generationCounter += 1;
    const rec = {
        id: _generationCounter,
        startedAt: Date.now(),
        endedAt: Date.now(),
        type: 'separate-tracker-update',
        dryRun: false,
        slotWrites: [],
        eventMutations: [],
        separateTrackerPrompt: typeof prompt === 'string' ? prompt : String(prompt ?? ''),
    };
    generationLog.push(rec);
    while (generationLog.length > MAX_LOG_ENTRIES) {
        generationLog.shift();
    }
}

function clipForSnippet(s, max) {
    if (!s) return '';
    if (s.length <= max) return s;
    const head = s.slice(0, Math.floor(max / 2));
    const tail = s.slice(-Math.floor(max / 2));
    return `${head}\n…[${s.length - max} chars elided]…\n${tail}`;
}

// ─── Generation lifecycle ──────────────────────────────────────────────────

function beginGeneration({ type, dryRun }) {
    _generationCounter += 1;
    activeGeneration = {
        id: _generationCounter,
        startedAt: Date.now(),
        endedAt: null,
        type: type || null,
        dryRun: !!dryRun,
        slotWrites: [],
        eventMutations: [],
        separateTrackerPrompt: null,
    };
}

function endGeneration() {
    if (!activeGeneration) return;
    activeGeneration.endedAt = Date.now();
    // Only keep records that captured something — skip empty dry-runs.
    const hasContent = activeGeneration.slotWrites.length > 0
        || activeGeneration.eventMutations.length > 0
        || activeGeneration.separateTrackerPrompt;
    if (hasContent) {
        generationLog.push(activeGeneration);
        while (generationLog.length > MAX_LOG_ENTRIES) {
            generationLog.shift();
        }
    }
    activeGeneration = null;
}

// ─── Public query API ──────────────────────────────────────────────────────

export function getCurrentSlots() {
    // Return a deep-ish clone so the UI can't mutate captures by accident.
    const out = [];
    for (const [key, entry] of currentSlots.entries()) {
        out.push({ slot: key, ...entry });
    }
    return out;
}

export function getGenerationLog() {
    return generationLog.map(rec => ({
        ...rec,
        slotWrites: rec.slotWrites.slice(),
        eventMutations: rec.eventMutations.slice(),
    }));
}

export function clearGenerationLog() {
    generationLog.length = 0;
    activeGeneration = null;
}

export function getActiveGenerationId() {
    return activeGeneration ? activeGeneration.id : null;
}

/** Public for the modal "Refresh" button — currentSlots is the source of truth, this is a no-op accessor. */
export function snapshot() {
    return {
        currentSlots: getCurrentSlots(),
        log: getGenerationLog(),
        activeGenerationId: getActiveGenerationId(),
    };
}

// ─── Init ──────────────────────────────────────────────────────────────────

let _initialized = false;
export function initInspector() {
    if (_initialized) return;
    _initialized = true;
    // Bracket every generation so slot writes / event mutations during it
    // land in a dedicated record. We use highest-priority-first registration
    // so beginGeneration fires before any DES-side GENERATION_STARTED handler
    // that issues slot writes; ST fires listeners in registration order.
    eventSource.on(event_types.GENERATION_STARTED, (type, data, dryRun) => {
        beginGeneration({ type, dryRun });
    });
    eventSource.on(event_types.GENERATION_ENDED, endGeneration);
    eventSource.on(event_types.GENERATION_STOPPED, endGeneration);
    console.log('[Dooms Tracker] Context Inspector initialized');
}

// ─── setExtensionPrompt wrapper ────────────────────────────────────────────
/**
 * Drop-in replacement for setExtensionPrompt that also records the write to
 * the inspector. Use this from every DES injection site so the inspector
 * stays authoritative without forcing every caller to remember a second
 * function call. Signature matches ST's setExtensionPrompt exactly.
 */
export function desSetExtensionPrompt(key, value, position, depth, scan = false, role = undefined) {
    try {
        setExtensionPrompt(key, value, position, depth, scan, role);
    } finally {
        // Recording must not throw out of an injection site even if the
        // capture buffer is in a bad state — that would suppress prompts.
        try {
            recordSlotWrite(key, value, position, depth, role);
        } catch (e) {
            console.warn('[Dooms Tracker] Inspector: recordSlotWrite failed', e);
        }
    }
}

// ─── Console helper ────────────────────────────────────────────────────────
// Exposed on window for quick console inspection without opening the modal.
try {
    if (typeof window !== 'undefined') {
        window.DES_INSPECTOR = {
            snapshot,
            currentSlots: getCurrentSlots,
            log: getGenerationLog,
            clear: clearGenerationLog,
        };
    }
} catch {}
