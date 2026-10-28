/**
 * Live World's face popover (docs/map-window-plan.md D85): a character's
 * trail, opened from a card in the Map window's People panel. The shelf's
 * own small dialog (the inventory editor's shell, so the looks restyle
 * it): the name and where they stand now, their moves newest first, "Show
 * the place" (their place selected in the row). Closes on a click outside,
 * Escape, or when its host asks.
 */
import { escapeHtml } from '../../utils/html.js';
import { resolvePortrait } from './portraitBar.js';
import { getWorldState, getActivePack } from '../features/liveWorld.js';
import { faceTrailHtml } from './worldViews.js';

const POP_ID = 'dooms-face-pop';
let pop = null;    // { el, onDown, onKey, onResize }

function portraitOf(name) {
    try { return resolvePortrait(name) || ''; } catch (e) { return ''; }
}

function position(el, anchor) {
    const r = anchor.getBoundingClientRect();
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const left = Math.max(8, Math.min(r.left, vw - w - 8));
    let top = r.bottom + 6;
    if (top + h > vh - 8) top = Math.max(8, r.top - h - 6);
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
}

export function isFacePopoverOpen() {
    return !!pop;
}

export function closeFacePopover() {
    if (!pop) return;
    pop.el.remove();
    document.removeEventListener('mousedown', pop.onDown, true);
    document.removeEventListener('touchstart', pop.onDown, true);
    document.removeEventListener('keydown', pop.onKey, true);
    window.removeEventListener('resize', pop.onResize);
    pop = null;
}

/**
 * Opens the trail of `name` by `anchor`. `onBoard(name)` is what "Show the
 * place" does; left out, the window opens with the character's place selected.
 */
export function openFacePopover(anchor, name, { onBoard } = {}) {
    closeFacePopover();
    const state = getWorldState();
    const pack = getActivePack();
    if (!anchor || !name || !state || !pack || typeof document === 'undefined') return false;
    const el = document.createElement('div');
    el.id = POP_ID;
    el.className = 'dooms-inv-editor dooms-face-pop';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', `${name}: where they have been`);
    el.innerHTML = `${faceTrailHtml({ state, pack, name, portraits: portraitOf })}
        <div class="dooms-inv-editor-actions">
            <span class="dooms-inv-editor-spacer"></span>
            <button type="button" class="dooms-inv-btn" data-act="close">Close</button>
            <button type="button" class="dooms-inv-btn is-primary" data-act="board" title="The row, with the place ${escapeHtml(name)} stands in selected">Show the place</button>
        </div>`;
    document.body.appendChild(el);
    el.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-act]');
        if (!btn) return;
        e.preventDefault();
        e.stopPropagation();
        const act = btn.dataset.act;
        closeFacePopover();
        if (act === 'board') {
            if (typeof onBoard === 'function') onBoard(name);
            else import('./worldDashboard.js').then(m => m.openWorldDashboard({ name })).catch(err => console.error('[Dooms Tracker] Live World: the Map window failed to load', err));
        }
    });
    el.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { e.preventDefault(); closeFacePopover(); }
        e.stopPropagation();
    });
    const onDown = (e) => { if (!el.contains(e.target)) closeFacePopover(); };
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); closeFacePopover(); } };
    const onResize = () => position(el, anchor);
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('touchstart', onDown, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', onResize);
    pop = { el, onDown, onKey, onResize };
    position(el, anchor);
    const first = el.querySelector('[data-act="board"]');
    if (first && window.innerWidth > 1000) { try { first.focus({ preventScroll: true }); } catch (e) { /* no focus */ } }
    return true;
}
