/**
 * Workshop → Attributes tab (Project Short Fuse, Phase 2).
 *
 * Loaded by characterWorkshop.js the first time the tab is opened. Paints
 * the sheet it is given (one score per attribute with the D&D modifier
 * beside it) and reports every change through ctx.onChange(scores). Saving
 * is the Workshop's: Save writes the draft's sheet with setSheet, Cancel
 * drops it. Nothing here touches settings.
 *
 * @module systems/ui/attributesPane
 */

import { escapeHtml } from '../../utils/html.js';
import {
    clampScore,
    modifier,
    formatModifier,
    roll4d6DropLowest,
    STANDARD_ARRAY,
    DEFAULT_SCORE,
    MIN_SCORE,
    MAX_SCORE,
} from '../../utils/d20.js';

/** The host and context of the last render, for the delegated handlers. */
let last = null;

/**
 * @param {HTMLElement} host The pane's section element.
 * @param {{ name: string, isUser: boolean,
 *           defs: Array<{ id: string, name: string, abbr: string, enabled: boolean }>,
 *           scores: Record<string, number>, attributesOn: boolean,
 *           onChange: (scores: Record<string, number>) => void }} ctx
 */
export function renderAttributesPane(host, ctx) {
    if (!host) return;
    last = { host, ctx: { ...ctx, scores: { ...(ctx?.scores || {}) } } };
    bindOnce(host);
    render();
}

function scoreOf(scores, id) {
    const v = clampScore(scores?.[id]);
    return v === null ? DEFAULT_SCORE : v;
}

function modClass(m) {
    return m > 0 ? ' is-pos' : m < 0 ? ' is-neg' : '';
}

function render() {
    if (!last) return;
    const { host, ctx } = last;
    const defs = Array.isArray(ctx.defs) ? ctx.defs : [];
    const rows = defs.map(d => {
        const score = scoreOf(ctx.scores, d.id);
        const m = modifier(score);
        return `<div class="cw-attr-row${d.enabled ? '' : ' is-off'}" data-attr="${escapeHtml(d.id)}">
            <span class="cw-attr-abbr">${escapeHtml(d.abbr)}</span>
            <span class="cw-attr-name" title="${escapeHtml(d.name)}">${escapeHtml(d.name)}${d.enabled ? '' : ' <small>(off)</small>'}</span>
            <input type="number" class="rpg-input cw-attr-score" min="${MIN_SCORE}" max="${MAX_SCORE}" step="1" value="${score}" aria-label="${escapeHtml(d.name)} score" />
            <span class="cw-attr-mod${modClass(m)}" title="What a roll adds">${escapeHtml(formatModifier(m))}</span>
        </div>`;
    }).join('');
    const helper = ctx.isUser
        ? 'Your scores, 1 to 30. The modifier beside each is what a roll adds: 10 and 11 give +0, and every two points above or below move it by one. Tag a message with the d20 button and this is the sheet it rolls on.'
        : `${escapeHtml(ctx.name || 'This character')}'s scores, 1 to 30. NPCs never roll (the dice are yours), but a sheet that is not all 10s goes to the AI with yours, so it can play them to their strengths.`;
    host.innerHTML = `
        <h4>&#127922; Attributes</h4>
        <p class="helper">${helper}</p>
        ${ctx.attributesOn ? '' : '<div class="cw-attr-notice"><i class="fa-solid fa-circle-info"></i><span>Attributes are off in <strong>Settings &rarr; Stats &rarr; Attributes &amp; checks</strong>. The sheet is kept; nothing is sent or rolled until they are on.</span></div>'}
        ${defs.length
            ? `<div class="cw-attr-grid">${rows}</div>`
            : '<div class="rpg-dc-knives-empty">No attributes on the list. Add some in Settings &rarr; Stats &rarr; Attributes &amp; checks.</div>'}
        <div class="cw-attr-actions"${defs.length ? '' : ' hidden'}>
            <button type="button" class="rpg-btn cw-attr-standard" title="15, 14, 13, 12, 10, 8 down the list; edit after"><i class="fa-solid fa-list-ol"></i> Standard array</button>
            <button type="button" class="rpg-btn cw-attr-4d6" title="Four six-sided dice, drop the lowest, once per attribute"><i class="fa-solid fa-dice"></i> Roll 4d6 drop lowest</button>
            <button type="button" class="rpg-btn cw-attr-reset" title="Every score back to 10"><i class="fa-solid fa-rotate-left"></i> All 10</button>
        </div>
        <p class="helper cw-attr-foot">Saved with <strong>Save</strong>. A sheet that is all 10s is the default and is never sent.</p>`;
}

/** Updates the draft through ctx.onChange; repaints when a whole-sheet action asks for it. */
function commit(next, { repaint = false } = {}) {
    if (!last) return;
    last.ctx.scores = next;
    try { last.ctx.onChange?.({ ...next }); } catch (e) { console.warn('[DES Workshop] attributes change failed', e); }
    if (repaint) render();
}

function paintModifier(row, score) {
    const mod = row?.querySelector('.cw-attr-mod');
    if (!mod) return;
    const m = modifier(score);
    mod.textContent = formatModifier(m);
    mod.className = `cw-attr-mod${modClass(m)}`;
}

function bindOnce(host) {
    if (host.dataset.cwAttrBound === '1') return;
    host.dataset.cwAttrBound = '1';

    // Typing: the modifier follows at once; a half-typed or empty box waits.
    host.addEventListener('input', (e) => {
        const input = e.target?.closest?.('.cw-attr-score');
        if (!input || !last) return;
        const row = input.closest('.cw-attr-row');
        const id = row?.dataset.attr;
        if (!id || String(input.value).trim() === '') return;
        const v = clampScore(input.value);
        if (v === null) return;
        paintModifier(row, v);
        commit({ ...last.ctx.scores, [id]: v });
    });

    // Leaving the box: clamp into range, or fall back to the last good score.
    host.addEventListener('change', (e) => {
        const input = e.target?.closest?.('.cw-attr-score');
        if (!input || !last) return;
        const row = input.closest('.cw-attr-row');
        const id = row?.dataset.attr;
        if (!id) return;
        const typed = String(input.value).trim() === '' ? null : clampScore(input.value);
        const score = typed === null ? scoreOf(last.ctx.scores, id) : typed;
        input.value = String(score);
        paintModifier(row, score);
        commit({ ...last.ctx.scores, [id]: score });
    });

    host.addEventListener('click', (e) => {
        const btn = e.target?.closest?.('button');
        if (!btn || !last || !host.contains(btn)) return;
        const defs = Array.isArray(last.ctx.defs) ? last.ctx.defs : [];
        const on = defs.filter(d => d.enabled);
        const targets = on.length ? on : defs;
        if (btn.classList.contains('cw-attr-standard')) {
            const next = { ...last.ctx.scores };
            targets.forEach((d, i) => { next[d.id] = STANDARD_ARRAY[i] ?? DEFAULT_SCORE; });
            commit(next, { repaint: true });
        } else if (btn.classList.contains('cw-attr-4d6')) {
            const next = { ...last.ctx.scores };
            targets.forEach(d => { next[d.id] = roll4d6DropLowest(); });
            commit(next, { repaint: true });
            flash(host);
        } else if (btn.classList.contains('cw-attr-reset')) {
            const next = {};
            defs.forEach(d => { next[d.id] = DEFAULT_SCORE; });
            commit(next, { repaint: true });
        }
    });
}

/** A short brightness pulse on the modifiers after a roll (CSS; off under reduced motion and perf mode). */
function flash(host) {
    const grid = host.querySelector('.cw-attr-grid');
    if (!grid) return;
    grid.classList.remove('is-rolled');
    void grid.offsetWidth;
    grid.classList.add('is-rolled');
}
