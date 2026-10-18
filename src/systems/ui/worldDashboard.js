/**
 * Live World dashboard (docs/live-world-spec.md, D1).
 *
 * One modal, read-only state and no model calls: the pack's name, the
 * in-game date the tracker holds, the blurb, when the world last advanced
 * and when it runs next, what people say about each clock (its public
 * effect, never a number), the known characters with their portrait and
 * where they were last seen, the heard-of names dimmed, and the recent
 * moves. Advance now runs the same path as /advance. Spoiler-free governs
 * the effects list as well as the blurb. Loaded on first open.
 */
import { escapeHtml } from '../../utils/html.js';
import { extensionSettings, lastGeneratedData, committedTrackerData } from '../../core/state.js';
import { resolvePortrait } from './portraitBar.js';
import { sceneFactsFrom } from '../../utils/questCut.js';
import { liveWorldConfig, placeLabel, recentChanges, publicEffects } from '../../utils/liveWorld.js';
import { getWorldState, getActivePack, getPackError, advanceNow, describeAdvanceResult, isAdvancing, WORLD_CHANGED_EVENT } from '../features/liveWorld.js';
import { renderWorldMapHtml, worldEmptyMessage } from './worldMap.js';

const POPUP_ID = 'rpg-world-popup';
const VIEW_KEY = 'dooms-world-view';
const VIEWS = ['overview', 'map'];
let built = false;
let isOpen = false;
let lastResult = '';
let view = readView();

function readView() {
    try { const v = localStorage.getItem(VIEW_KEY); return VIEWS.includes(v) ? v : 'overview'; } catch (e) { return 'overview'; }
}

function setView(next) {
    view = VIEWS.includes(next) ? next : 'overview';
    try { localStorage.setItem(VIEW_KEY, view); } catch (e) { /* no storage */ }
}

function lastSeenEntry(state, name) {
    for (let i = state.log.length - 1; i >= 0; i--) {
        if (state.log[i].who === name) return state.log[i];
    }
    return null;
}

/**
 * The dashboard's body as HTML. Pure apart from `portraits`, so tests can
 * render it without the portrait store.
 */
export function renderWorldDashboardHtml({ state, pack, cfg, facts = {}, packError = '', portraits = () => '', masterOn = true } = {}) {
    const empty = worldEmptyMessage({ state, pack, cfg, packError, masterOn });
    if (empty) return empty;
    const date = [facts.date, facts.time].filter(Boolean).join(', ');
    const where = facts.location ? ` · at ${escapeHtml(facts.location)}` : '';
    const last = state.last && state.last.ok
        ? `Last advanced ${state.last.gameDate ? `on ${escapeHtml(state.last.gameDate)}` : 'once'}${state.last.elapsed ? ` (${escapeHtml(state.last.elapsed)} passed)` : ''}`
        : 'Not advanced yet';
    const nextIn = Math.max(0, cfg.every - state.sinceLast);
    const next = state.retryNext ? 'runs again on the next reply' : `next run in ${nextIn} repl${nextIn === 1 ? 'y' : 'ies'}`;
    const effects = publicEffects(state, pack);
    const known = Object.entries(state.known).filter(([, t]) => t === 'known').map(([n]) => n);
    const heard = Object.entries(state.known).filter(([, t]) => t === 'heard').map(([n]) => n);
    const changes = recentChanges(state, pack, { limit: 12, spoilerFree: cfg.spoilerFree });
    const cards = known.map(name => {
        const url = portraits(name);
        const face = url ? `<img class="rpg-world-portrait" src="${escapeHtml(url)}" alt="" />` : '<div class="rpg-world-portrait" aria-hidden="true">👤</div>';
        const here = state.where[name] ? placeLabel(pack, state.where[name]) : 'nowhere yet';
        const e = lastSeenEntry(state, name);
        const before = e && e.from ? `<div class="rpg-world-card-line is-muted">Before that: ${escapeHtml(placeLabel(pack, e.from))}</div>` : '';
        const seen = e && e.gameDate ? `<div class="rpg-world-card-line is-muted">Seen ${escapeHtml(e.gameDate)}${e.gameTime ? `, ${escapeHtml(e.gameTime)}` : ''}</div>` : '';
        return `<div class="rpg-world-card">${face}<div class="rpg-world-card-text"><div class="rpg-world-card-name">${escapeHtml(name)}</div><div class="rpg-world-card-line">Last seen: ${escapeHtml(here)}</div>${before}${seen}</div></div>`;
    }).join('');
    return `
        <div class="rpg-world-head">
            <h4>${escapeHtml(pack.name)}</h4>
            <div class="rpg-world-date">${date ? escapeHtml(date) : 'No date in the tracker yet'}${where}</div>
            ${state.blurb ? `<div class="rpg-world-blurb">${escapeHtml(state.blurb)}</div>` : ''}
            <div class="rpg-world-status">${last} · ${next}.${cfg.spoilerFree ? ' Spoiler-free: common knowledge only.' : ''}</div>
            ${state.lastError ? `<div class="rpg-world-status is-error">Last attempt discarded: ${escapeHtml(state.lastError.error)}</div>` : ''}
        </div>
        <div class="rpg-world-section">
            <div class="rpg-world-section-title">What people say</div>
            ${effects.length ? `<ul class="rpg-world-effects">${effects.map(e => `<li>${cfg.spoilerFree ? '' : `<b>${escapeHtml(e.label)}:</b> `}${escapeHtml(e.text)}</li>`).join('')}</ul>` : '<p class="rpg-world-empty">Nothing yet.</p>'}
        </div>
        <div class="rpg-world-section">
            <div class="rpg-world-section-title">Known characters</div>
            ${cards ? `<div class="rpg-world-cast">${cards}</div>` : '<p class="rpg-world-empty">No one known yet.</p>'}
            ${heard.length ? `<div class="rpg-world-heard">${heard.map(n => `<span class="rpg-world-chip" title="Heard of, not met">${escapeHtml(n)}</span>`).join('')}</div>` : ''}
        </div>
        <div class="rpg-world-section">
            <div class="rpg-world-section-title">Recent changes</div>
            ${changes.length ? `<ul class="rpg-world-changes">${changes.map(c => `<li>${escapeHtml(c.text)}${c.gameDate ? `<time>${escapeHtml(c.gameDate)}</time>` : ''}</li>`).join('')}</ul>` : '<p class="rpg-world-empty">No moves yet.</p>'}
        </div>`;
}

function portraitOf(name) {
    try { return resolvePortrait(name) || ''; } catch (e) { return ''; }
}

function render() {
    const $body = $(`#${POPUP_ID} .rpg-world-body`);
    if (!$body.length) return;
    const common = { state: getWorldState(), pack: getActivePack(), cfg: liveWorldConfig(extensionSettings), packError: getPackError(), portraits: portraitOf, masterOn: !!extensionSettings.enabled };
    if (view === 'map') {
        $body.html(renderWorldMapHtml(common));
    } else {
        let facts = {};
        try { facts = sceneFactsFrom(lastGeneratedData.infoBox || committedTrackerData.infoBox); } catch (e) { facts = {}; }
        $body.html(renderWorldDashboardHtml({ ...common, facts }));
    }
    $body.toggleClass('is-map', view === 'map');
    $(`#${POPUP_ID} .rpg-world-tab`).each(function () { $(this).toggleClass('is-active', $(this).data('view') === view).attr('aria-selected', $(this).data('view') === view ? 'true' : 'false'); });
    $(`#${POPUP_ID} #rpg-world-advance-now`).prop('disabled', isAdvancing());
    $(`#${POPUP_ID} .rpg-world-result`).text(lastResult);
}

function onChanged(e) {
    // An advance that waited (on the tracker, on the main generation) ends here, not in the button's handler.
    const source = e && e.detail && e.detail.source;
    if (source === 'advance') lastResult = 'The world moved.';
    else if (source === 'advance-failed') {
        const s = getWorldState();
        lastResult = `Discarded: ${s && s.lastError ? s.lastError.error : 'the reply broke a rule'}`;
    }
    if (isOpen) render();
}

function build() {
    if (built) return;
    built = true;
    $('body').append(`
        <div id="${POPUP_ID}" class="rpg-settings-popup" role="dialog" aria-modal="true" aria-labelledby="rpg-world-title" style="display: none;">
            <div class="rpg-settings-popup-content" style="max-width: 820px;">
                <header class="rpg-settings-popup-header">
                    <h3 id="rpg-world-title"><i class="fa-solid fa-globe" aria-hidden="true"></i> <span>Live World</span></h3>
                    <div class="rpg-world-tabs" role="tablist" aria-label="Live World views">
                        <button type="button" class="rpg-world-tab" role="tab" data-view="overview">Overview</button>
                        <button type="button" class="rpg-world-tab" role="tab" data-view="map">Map</button>
                    </div>
                    <button id="rpg-close-world" class="rpg-popup-close" type="button" aria-label="Close">&times;</button>
                </header>
                <div class="rpg-settings-popup-body">
                    <div class="rpg-world-body"></div>
                </div>
                <footer class="rpg-settings-popup-footer rpg-world-actions">
                    <button id="rpg-world-advance-now" class="rpg-accordion-action-btn" type="button" title="Run the plot advancer now (the same as /advance)"><i class="fa-solid fa-forward"></i> Advance now</button>
                    <button id="rpg-world-refresh" class="rpg-accordion-action-btn" type="button"><i class="fa-solid fa-rotate"></i> Refresh</button>
                    <span class="rpg-world-result"></span>
                </footer>
            </div>
        </div>`);
    $(document).on('click', '#rpg-close-world', closeWorldDashboard);
    $(document).on('click', `#${POPUP_ID}`, (e) => { if (e.target && e.target.id === POPUP_ID) closeWorldDashboard(); });
    $(document).on('click', '#rpg-world-refresh', () => { lastResult = ''; render(); });
    $(document).on('click', `#${POPUP_ID} .rpg-world-tab`, function () { setView($(this).data('view')); render(); });
    $(document).on('click', '#rpg-world-advance-now', async function () {
        // advanceNow takes the running flag before its first await, so the
        // render that follows keeps the button disabled for the whole request.
        const pending = advanceNow({ reason: 'dashboard' });
        lastResult = 'Advancing…';
        render();
        try {
            lastResult = describeAdvanceResult(await pending);
        } catch (e) {
            lastResult = `Failed: ${e && e.message ? e.message : e}`;
        }
        render();
    });
    $(document).on('keydown', (e) => { if (e.key === 'Escape' && isOpen) closeWorldDashboard(); });
    window.addEventListener(WORLD_CHANGED_EVENT, onChanged);
}

/** Opens the dashboard (building it the first time) and keeps it current while open. */
export function openWorldDashboard() {
    build();
    isOpen = true;
    lastResult = '';
    render();
    $(`#${POPUP_ID}`).css('display', 'flex');
}

export function closeWorldDashboard() {
    isOpen = false;
    $(`#${POPUP_ID}`).css('display', 'none');
}
