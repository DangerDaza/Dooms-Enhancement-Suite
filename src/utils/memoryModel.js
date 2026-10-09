/**
 * Character Memories — pure model.
 *
 * NPCs keep a list of one-line memories of important things that happened
 * to them. The AI only ever ADDS memories (through a "memories" key in the
 * tracker JSON), at most one per reply and only when something memorable
 * happened; removing or rewriting them is left to the user.
 *
 * Two kinds:
 *   - important (★): life-changing events — always sent to the AI.
 *   - normal: only the most recent few are sent; older ones "fade" (kept,
 *     shown greyed in the Workshop, no longer sent).
 *
 * Entry shape: { id, text, important, source: 'ai'|'user', createdAt }
 */

export const MEMORY_MAX_CHARS = 200;
export const DEFAULT_RECENT_LIMIT = 8;
export const IMPORTANT_MARK = '★';

/** Trims, collapses whitespace, caps the length. '' when nothing usable. */
export function cleanMemoryText(text) {
    let t = String(text ?? '').replace(/\s+/g, ' ').trim();
    t = t.replace(/^[-•*\s]+/, '').trim();
    if (t.length > MEMORY_MAX_CHARS) t = t.slice(0, MEMORY_MAX_CHARS - 1).trimEnd() + '…';
    return t;
}

/** Comparison key: lower case letters and digits only. */
export function memoryKey(text) {
    return String(text || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '');
}

/** True when `text` repeats a memory already in `list` (same words, or one contains the other). */
export function isDuplicateMemory(list, text) {
    const k = memoryKey(text);
    if (!k) return true;
    return (list || []).some(m => {
        const other = memoryKey(m && m.text);
        if (!other) return false;
        if (other === k) return true;
        const [short, long] = other.length < k.length ? [other, k] : [k, other];
        return short.length >= 20 && long.includes(short);
    });
}

let idCounter = 0;
export function newMemoryId() {
    idCounter = (idCounter + 1) % 1000;
    return 'mem_' + Date.now().toString(36) + '_' + idCounter.toString(36) + Math.random().toString(36).slice(2, 5);
}

/** Builds a memory entry, or null when the text is empty. */
export function makeMemory(text, { important = false, source = 'user' } = {}) {
    let t = cleanMemoryText(text);
    let imp = !!important;
    // The AI marks important memories with a leading star (or "!").
    const m = t.match(/^(★|☆|\*|!)\s*/);
    if (m) { imp = true; t = t.slice(m[0].length).trim(); }
    if (!t) return null;
    return { id: newMemoryId(), text: t, important: imp, source, createdAt: Date.now() };
}

/**
 * Normalises whatever shape the AI used for "memories" into
 * [{ name, items: [{ text, important }] }].
 * Accepts { "Name": ["...", {"text": "...", "important": true}] },
 * { "Name": "..." } and [{ "name": "Name", "memory": "..." }].
 */
export function normalizeAIMemories(raw) {
    let data = raw;
    if (typeof data === 'string') {
        try { data = JSON.parse(data); } catch (e) { return []; }
    }
    if (!data || typeof data !== 'object') return [];
    const out = [];
    const toItem = (v) => {
        if (typeof v === 'string') return { text: v, important: false };
        if (v && typeof v === 'object') {
            const text = v.text ?? v.memory ?? v.event ?? '';
            return typeof text === 'string' ? { text, important: v.important === true } : null;
        }
        return null;
    };
    const push = (name, value) => {
        if (typeof name !== 'string' || !name.trim()) return;
        const values = Array.isArray(value) ? value : [value];
        const items = values.map(toItem).filter(i => i && cleanMemoryText(i.text));
        if (items.length) out.push({ name: name.trim(), items });
    };
    if (Array.isArray(data)) {
        for (const item of data) {
            if (!item || typeof item !== 'object') continue;
            push(item.name, item.memories ?? item.memory ?? item.text ?? null);
        }
        return out;
    }
    for (const [name, value] of Object.entries(data)) push(name, value);
    return out;
}

/**
 * What the AI gets to see: every important memory plus the `recentLimit`
 * most recent normal ones, in the order they happened.
 */
export function selectForPrompt(list, recentLimit = DEFAULT_RECENT_LIMIT) {
    const all = Array.isArray(list) ? list : [];
    const normal = all.filter(m => !m.important);
    const keep = new Set(normal.slice(Math.max(0, normal.length - Math.max(0, recentLimit))).map(m => m.id));
    return all.filter(m => m.important || keep.has(m.id));
}

/** Ids of the normal memories that have faded (no longer sent). */
export function fadedIds(list, recentLimit = DEFAULT_RECENT_LIMIT) {
    const sent = new Set(selectForPrompt(list, recentLimit).map(m => m.id));
    return new Set((list || []).filter(m => !sent.has(m.id)).map(m => m.id));
}

/**
 * The prompt section for the characters in the scene.
 * @param {Array<{name: string, memories: object[]}>} entries - present NPCs
 * @param {{compact?: boolean, standalone?: boolean, recentLimit?: number}} [options]
 *   standalone: no other tracker JSON is requested, so ask for its own block.
 */
export function buildMemoriesPrompt(entries, { compact = true, standalone = false, recentLimit = DEFAULT_RECENT_LIMIT } = {}) {
    const list = (entries || []).filter(e => e && e.name);
    if (!list.length) return '';
    const lines = [];
    for (const e of list) {
        const shown = selectForPrompt(e.memories, recentLimit);
        if (!shown.length) continue;
        lines.push(`- ${e.name}: ${shown.map(m => (m.important ? IMPORTANT_MARK + ' ' : '') + m.text).join('; ')}`);
    }
    const names = list.map(e => e.name);
    const example = JSON.stringify({ memories: { [names[0]]: 'Short memory of what just happened' } });
    let out = '';
    if (lines.length) {
        out += compact
            ? 'CHARACTER MEMORIES (what each remembers; stay consistent with them):\n'
            : 'CHARACTER MEMORIES — what each character personally remembers. Keep their behaviour and dialogue consistent with these memories:\n';
        out += lines.join('\n') + '\n';
    }
    const where = standalone
        ? 'start your reply with ONE JSON code block'
        : 'add a "memories" key to the same tracker JSON object';
    out += compact
        ? `Only if something truly important just happened to ${names.join(', ')}, ${where}: ${example} — at most ONE new memory per reply, one short sentence (under 15 words) from their point of view; put ${IMPORTANT_MARK} first if it is life-changing. Most replies need none: omit the key when nothing memorable happens, and never repeat old memories.`
        : `NEW MEMORY: only if something truly important just happened to one of these characters (${names.join(', ')}) — a turning point, a promise, a betrayal, a loss, a discovery, something learned about someone — ${where}, like ${example}. At most ONE new memory per reply, for one character: one short sentence (under 15 words) from that character's point of view. Start it with ${IMPORTANT_MARK} if it is life-changing and should never be forgotten. Most replies need no new memory: leave the key out entirely when nothing memorable happened. Never repeat, rewrite or remove existing memories, and never add memories for the player's character.`;
    return out.trim();
}
