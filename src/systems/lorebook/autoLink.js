/**
 * Auto-link by name — keeps same-named lorebooks in step with the chat's cast.
 *
 * A character in the current chat's cast whose name exactly matches a World
 * Info file (e.g. "Nocturra" ↔ worlds/Nocturra.json) gets that book switched
 * on while they are in the cast and switched off again when they leave. Only
 * books THIS feature switched on are ever switched off — they are tracked in
 * extensionSettings.lorebook.autoLinked — so a book you activated by hand is
 * never touched. Opt out with extensionSettings.lorebook.autoLinkByName =
 * false (Settings → Lore Library → Auto-link books by character name).
 *
 * Ownership alongside the active campaign (campaignManager):
 *   - a book the active campaign keeps on (lorebook.campaignActivated) or
 *     one flagged global is not ours to switch off when its character leaves;
 *     it just drops out of autoLinked and the campaign owns it from then on;
 *   - the campaign switch, in turn, never switches off a book still in
 *     autoLinked — the character is still in the cast.
 * Runs on the same queue as campaign switches so the two never interleave.
 *
 * Originally a local patch dated 2026-08-05 (persistence.js); ported here so
 * it lives with the rest of the lorebook cluster and is loaded lazily.
 */
import { extensionSettings } from '../../core/state.js';
import { chat_metadata } from '../../../../../../../script.js';
import { saveSettings } from '../../core/persistence.js';
import { getAllWorldNames, isWorldActive, applyWorldActivation } from './lorebookAPI.js';
import { queueBookTask } from './campaignManager.js';

const NOTHING = Object.freeze({ activated: [], deactivated: [] });

/** Whether the feature is on (default on; only an explicit false disables it). */
export function isAutoLinkEnabled() {
    return extensionSettings.lorebook?.autoLinkByName !== false;
}

/**
 * Brings the auto-linked books in line with the chat's cast. Fire-and-forget
 * safe (never rejects). The cast can be passed explicitly (tests); by default
 * it is the current chat's knownCharacters — no chat cast means nothing to
 * link, never the global Workshop roster (that is "everyone who exists").
 * @param {{cast?: Object|null}} [options]
 * @returns {Promise<{activated: string[], deactivated: string[]}>}
 */
export function syncAutoLinkedLorebooks({ cast = null } = {}) {
    if (!isAutoLinkEnabled()) return Promise.resolve(NOTHING);
    return queueBookTask(() => runSync(cast)).catch((e) => {
        console.error('[DES AutoLink] sync failed', e);
        return NOTHING;
    });
}

async function runSync(castOverride) {
    const lb = extensionSettings.lorebook;
    if (!lb || lb.autoLinkByName === false) return NOTHING;
    const castMap = castOverride ?? chat_metadata?.dooms_tracker?.knownCharacters;
    if (!castMap || typeof castMap !== 'object') return NOTHING;
    const roster = new Set(Object.keys(castMap));
    const all = new Set(getAllWorldNames());
    const linked = new Set(Array.isArray(lb.autoLinked) ? lb.autoLinked.filter(n => typeof n === 'string' && n) : []);
    // Books the active campaign keeps on, or flagged global, are not ours to switch off.
    const keep = new Set([...(lb.campaignActivated || []), ...(lb.globalBooks || [])]);

    const activate = [...roster].filter(name => all.has(name) && !isWorldActive(name));
    const deactivate = [...linked].filter(name => !roster.has(name) && !keep.has(name) && isWorldActive(name));

    const result = await applyWorldActivation({ activate, deactivate });
    for (const name of result.activated) {
        linked.add(name);
        console.log(`[DES AutoLink] activated lorebook "${name}" (cast match)`);
    }
    for (const name of result.deactivated) {
        console.log(`[DES AutoLink] deactivated lorebook "${name}" (left the cast)`);
    }
    // Whatever left the cast is no longer ours, switched off or handed to the campaign.
    for (const name of [...linked]) if (!roster.has(name)) linked.delete(name);

    const next = [...linked];
    const before = Array.isArray(lb.autoLinked) ? lb.autoLinked : [];
    const changed = next.length !== before.length || next.some((n, i) => before[i] !== n);
    if (changed) {
        lb.autoLinked = next;
        saveSettings();
    }
    return { activated: result.activated, deactivated: result.deactivated };
}
