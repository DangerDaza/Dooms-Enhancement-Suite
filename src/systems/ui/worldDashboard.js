/**
 * Live World dashboard (docs/live-world-spec.md, D1–D3).
 *
 * One modal, read-only state and no model calls: the pack's name, the
 * in-game date the tracker holds, the blurb, when the world last advanced
 * and when it runs next, what people say about each clock (its public
 * effect, never a number), the known characters with their portrait and
 * where they were last seen (a tap opens their timeline, a link shows
 * them on the map), the heard-of names dimmed, and the feed of changes
 * under their dates with a filter for how far back it reaches. The Map
 * view (src/systems/ui/worldMap.js) sits beside it; a token there opens
 * the character's timeline here. Advance now runs the same path as
 * /advance. Spoiler-free governs the effects and the feed as well as
 * the blurb. Loaded on first open.
 */
import { escapeHtml } from '../../utils/html.js';
import { extensionSettings, lastGeneratedData, committedTrackerData } from '../../core/state.js';
import { resolvePortrait } from './portraitBar.js';
import { sceneFactsFrom } from '../../utils/questCut.js';
import { liveWorldConfig, placeLabel, recentChanges, publicEffects, groupChangesByDate, characterTimeline } from '../../utils/liveWorld.js';
import { getWorldState, getActivePack, getPackError, advanceNow, describeAdvanceResult, isAdvancing, WORLD_CHANGED_EVENT } from '../features/liveWorld.js';
import { renderWorldMapHtml, worldEmptyMessage } from './worldMap.js';

const POPUP_ID = 'rpg-world-popup';
const VIEW_KEY = 'dooms-world-view';
const FEED_KEY = 'dooms-world-feed';
const VIEWS = ['overview', 'map'];
export const FEED_LIMITS = Object.freeze([12, 50, 0]);    // 0: everything the log holds
let built = false;
let isOpen = false;
let lastResult = '';
let view = readView();
let feedLimit = readFeedLimit();
let openTimeline = '';      // the known character whose timeline is open in the overview
let focusPlace = '';        // the map node to pick out, from a card's map link
let mapRoot = '';           // the place the map is zoomed into ('' is the province)

function readFeedLimit() {
    try { const n = Number(localStorage.getItem(FEED_KEY)); return FEED_LIMITS.includes(n) ? n : FEED_LIMITS[0]; } catch (e) { return FEED_LIMITS[0]; }
}

function setFeedLimit(n) {
    feedLimit = FEED_LIMITS.includes(Number(n)) ? Number(n) : FEED_LIMITS[0];
    try { localStorage.setItem(FEED_KEY, String(feedLimit)); } catch (e) { /* no storage */ }
}

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
export function renderWorldDashboardHtml({ state, pack, cfg, facts = {}, packError = '', portraits = () => '', masterOn = true, feed = FEED_LIMITS[0], timeline = '' } = {}) {
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
    const limit = FEED_LIMITS.includes(Number(feed)) ? Number(feed) : FEED_LIMITS[0];
    const changes = recentChanges(state, pack, { limit: limit || Number.MAX_SAFE_INTEGER, spoilerFree: cfg.spoilerFree });
    const groups = groupChangesByDate(changes);
    const cards = known.map(name => {
        const url = portraits(name);
        const face = url ? `<img class="rpg-world-portrait" src="${escapeHtml(url)}" alt="" />` : '<div class="rpg-world-portrait" aria-hidden="true">👤</div>';
        const path = state.where[name] || '';
        const here = path ? placeLabel(pack, path) : 'nowhere yet';
        const e = lastSeenEntry(state, name);
        const before = e && e.from ? `<div class="rpg-world-card-line is-muted">Before that: ${escapeHtml(placeLabel(pack, e.from))}</div>` : '';
        const seen = e && e.gameDate ? `<div class="rpg-world-card-line is-muted">Seen ${escapeHtml(e.gameDate)}${e.gameTime ? `, ${escapeHtml(e.gameTime)}` : ''}</div>` : '';
        const open = timeline === name;
        const tl = open ? timelineHtml(characterTimeline(state, pack, name)) : '';
        const placeId = path ? path.split('/').filter(Boolean).pop() : '';
        const mapLink = placeId ? `<button type="button" class="rpg-world-card-map" data-place="${escapeHtml(placeId)}" title="Show on the map"><i class="fa-solid fa-map-location-dot" aria-hidden="true"></i></button>` : '';
        return `<div class="rpg-world-card${open ? ' is-open' : ''}" data-name="${escapeHtml(name)}">${face}<div class="rpg-world-card-text"><div class="rpg-world-card-head"><button type="button" class="rpg-world-card-name" aria-expanded="${open ? 'true' : 'false'}" title="${open ? 'Hide' : 'Show'} the timeline">${escapeHtml(name)}</button>${mapLink}</div><div class="rpg-world-card-line">Last seen: ${escapeHtml(here)}</div>${before}${seen}${tl}</div></div>`;
    }).join('');
    const feedOptions = FEED_LIMITS.map(n => `<option value="${n}"${n === limit ? ' selected' : ''}>${n ? `Latest ${n}` : 'Everything'}</option>`).join('');
    const feedHtml = groups.length
        ? groups.map(g => `${g.date ? `<div class="rpg-world-feed-date">${escapeHtml(g.date)}</div>` : ''}<ul class="rpg-world-changes">${g.items.map(c => `<li class="is-${c.kind}">${escapeHtml(c.text)}</li>`).join('')}</ul>`).join('')
        : '<p class="rpg-world-empty">No changes yet.</p>';
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
            <div class="rpg-world-feed-head">
                <div class="rpg-world-section-title">Changes</div>
                <label class="rpg-world-feed-filter-label">Show <select class="rpg-world-feed-filter" aria-label="How far back the changes reach">${feedOptions}</select></label>
            </div>
            ${feedHtml}
        </div>`;
}

/** A character's timeline as HTML: where they started, each move with its date and reason, where they stand now. */
function timelineHtml(t) {
    if (!t.steps.length) return `<ol class="rpg-world-timeline"><li class="is-now">${t.now ? `Now: ${escapeHtml(t.now)}` : 'Nowhere yet'}${t.now ? ' (from the start, or before the log)' : ''}</li></ol>`;
    const items = [];
    if (t.steps[0].from) items.push(`<li class="is-start">Started at ${escapeHtml(t.steps[0].from)}</li>`);
    for (const s of t.steps) {
        const when = s.gameDate ? `<time>${escapeHtml(s.gameDate)}${s.gameTime ? `, ${escapeHtml(s.gameTime)}` : ''}</time>` : '';
        items.push(`<li>${when}${escapeHtml(s.to)}${s.reason ? ` <span class="is-muted">(${escapeHtml(s.reason)})</span>` : ''}</li>`);
    }
    return `<ol class="rpg-world-timeline">${items.join('')}</ol>`;
}

function portraitOf(name) {
    try { return resolvePortrait(name) || ''; } catch (e) { return ''; }
}

function render() {
    const $body = $(`#${POPUP_ID} .rpg-world-body`);
    if (!$body.length) return;
    const common = { state: getWorldState(), pack: getActivePack(), cfg: liveWorldConfig(extensionSettings), packError: getPackError(), portraits: portraitOf, masterOn: !!extensionSettings.enabled };
    if (view === 'map') {
        $body.html(renderWorldMapHtml({ ...common, focus: focusPlace, root: mapRoot }));
        focusPlace = '';
    } else {
        let facts = {};
        try { facts = sceneFactsFrom(lastGeneratedData.infoBox || committedTrackerData.infoBox); } catch (e) { facts = {}; }
        $body.html(renderWorldDashboardHtml({ ...common, facts, feed: feedLimit, timeline: openTimeline }));
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
    $(document).on('change', `#${POPUP_ID} .rpg-world-feed-filter`, function () { setFeedLimit($(this).val()); render(); });
    // D3: a name opens its timeline; the map link picks the character's place out on the map; a token on the map opens the timeline here.
    $(document).on('click', `#${POPUP_ID} .rpg-world-card-name`, function () {
        const name = String($(this).closest('.rpg-world-card').data('name') || '');
        openTimeline = openTimeline === name ? '' : name;
        render();
    });
    $(document).on('click', `#${POPUP_ID} .rpg-world-card-map`, function () {
        focusPlace = String($(this).data('place') || '');
        mapRoot = '';    // the province, where every place has a card to pick out
        setView('map');
        render();
    });
    // C2: a card with places inside opens to them; the trail leads back up.
    $(document).on('click', `#${POPUP_ID} .rpg-wmap-node[data-zoom]`, function (e) {
        if ($(e.target).closest('.rpg-wmap-token').length) return;    // a token is the character's, not the place's
        mapRoot = String($(this).data('zoom') || '');
        render();
    });
    $(document).on('keydown', `#${POPUP_ID} .rpg-wmap-node[data-zoom], #${POPUP_ID} .rpg-wmap-token[data-name]`, function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $(this).trigger('click'); }
    });
    $(document).on('click', `#${POPUP_ID} .rpg-wmap-crumb`, function () {
        mapRoot = String($(this).data('root') || '');
        render();
    });
    $(document).on('click', `#${POPUP_ID} .rpg-wmap-token[data-name]`, function () {
        openTimeline = String($(this).data('name') || '');
        setView('overview');
        render();
        const card = document.querySelector(`#${POPUP_ID} .rpg-world-card.is-open`);
        if (card && typeof card.scrollIntoView === 'function') card.scrollIntoView({ block: 'nearest' });
    });
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
    openTimeline = '';
    focusPlace = '';
    mapRoot = '';
    render();
    $(`#${POPUP_ID}`).css('display', 'flex');
}

export function closeWorldDashboard() {
    isOpen = false;
    $(`#${POPUP_ID}`).css('display', 'none');
}
