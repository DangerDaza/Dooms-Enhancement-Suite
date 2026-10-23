/**
 * The Live World window (docs/stats-plan.md D69), sized like the Workshop:
 * the glance at the top (word on the street, the faces last seen), the
 * board below (the places as tiles at the level being looked at, a trail
 * back out, who stands where as tokens, what a clock says about a place on
 * its tile, "Lately" with its filter), Advance now in the foot (the same
 * path as /advance). A card or a token opens the face popover; Show on the
 * board there steps the board to where that character stands. Read-only
 * state and no model calls; the pure rendering is worldViews.js. Opened
 * from the D menu's World, Settings → Live World and /liveworld. Loaded on
 * first open.
 */
import { extensionSettings, lastGeneratedData, committedTrackerData } from '../../core/state.js';
import { ensureCss } from '../../core/cssLoader.js';
import { resolvePortrait } from './portraitBar.js';
import { liveWorldConfig } from '../../utils/liveWorld.js';
import { boardRootFor } from '../../utils/worldBoard.js';
import { sceneFactsFrom } from '../../utils/questCut.js';
import { getWorldState, getActivePack, getPackError, advanceNow, describeAdvanceResult, isAdvancing, presentNamesFromTracker, WORLD_CHANGED_EVENT } from '../features/liveWorld.js';
import { worldWindowHtml, FEED_LIMITS } from './worldViews.js';
import { openFacePopover, closeFacePopover, isFacePopoverOpen } from './worldFace.js';

const POPUP_ID = 'rpg-world-popup';
const FEED_KEY = 'dooms-world-feed';
let built = false;
let isOpen = false;
let lastResult = '';
let root = '';             // the place stepped into ('' is the province)
let feedLimit = readFeedLimit();

function readFeedLimit() {
    try {
        const raw = localStorage.getItem(FEED_KEY);
        if (raw === null || raw === '') return FEED_LIMITS[0];
        const n = Number(raw);
        return FEED_LIMITS.includes(n) ? n : FEED_LIMITS[0];
    } catch (e) { return FEED_LIMITS[0]; }
}

function setFeedLimit(n) {
    feedLimit = FEED_LIMITS.includes(Number(n)) ? Number(n) : FEED_LIMITS[0];
    try { localStorage.setItem(FEED_KEY, String(feedLimit)); } catch (e) { /* no storage */ }
}

function portraitOf(name) {
    try { return resolvePortrait(name) || ''; } catch (e) { return ''; }
}

/** The tracker's date, time and place, for the window's first line. */
function sceneFacts() {
    try { return sceneFactsFrom(lastGeneratedData.infoBox || committedTrackerData.infoBox) || {}; } catch (e) { return {}; }
}

function render() {
    const $body = $(`#${POPUP_ID} .dooms-world-body`);
    if (!$body.length) return;
    const state = getWorldState();
    const cfg = liveWorldConfig(extensionSettings);
    $body.html(worldWindowHtml({ state, pack: getActivePack(), cfg, facts: sceneFacts(), packError: getPackError(), portraits: portraitOf, masterOn: !!extensionSettings.enabled, root, feed: feedLimit, present: presentNamesFromTracker() }));
    $(`#${POPUP_ID} #rpg-world-advance-now`).prop('disabled', isAdvancing());
    $(`#${POPUP_ID} .dooms-world-result`).text(lastResult);
}

/** After Show on the board: the board's trail into view. */
function showBoard() {
    try {
        const trail = document.querySelector(`#${POPUP_ID} .dooms-board-trail`);
        if (trail && typeof trail.scrollIntoView === 'function') trail.scrollIntoView({ block: 'start', behavior: 'smooth' });
    } catch (e) { /* no DOM */ }
}

function onChanged(e) {
    const source = e && e.detail && e.detail.source;
    if (source === 'advance') lastResult = 'The world moved.';
    else if (source === 'advance-failed') {
        const s = getWorldState();
        const err = s && s.lastError;
        const spoilerFree = liveWorldConfig(extensionSettings).spoilerFree;
        if (err && err.kind === 'error') lastResult = `Failed: ${err.error || 'the request did not complete'}; it runs again on the next reply.`;
        else lastResult = `Discarded: ${err && !spoilerFree ? err.error : 'the reply broke a rule'}`;
    } else if (source === 'chat') {
        // another chat, or the world reloaded: the place looked into belongs to the old one
        lastResult = '';
        root = '';
        closeFacePopover();
    }
    if (isOpen) render();
}

function focusTrail() {
    try {
        const here = document.querySelector(`#${POPUP_ID} .dooms-board-crumb.is-here`);
        if (here && typeof here.focus === 'function') here.focus({ preventScroll: true });
    } catch (e) { /* no DOM */ }
}

function build() {
    if (built) return;
    built = true;
    $('body').append(`
        <div id="${POPUP_ID}" class="rpg-settings-popup" role="dialog" aria-modal="true" aria-labelledby="rpg-world-title" style="display: none;">
            <div class="rpg-settings-popup-content">
                <header class="rpg-settings-popup-header">
                    <h3 id="rpg-world-title"><i class="fa-solid fa-globe" aria-hidden="true"></i> <span>Live World</span></h3>
                    <button id="rpg-close-world" class="rpg-popup-close" type="button" aria-label="Close">&times;</button>
                </header>
                <div class="rpg-settings-popup-body">
                    <div class="dooms-world-body"></div>
                </div>
                <footer class="rpg-settings-popup-footer rpg-world-actions">
                    <button id="rpg-world-advance-now" class="rpg-accordion-action-btn" type="button" title="Run the plot advancer now (the same as /advance)"><i class="fa-solid fa-forward"></i> Advance now</button>
                    <button id="rpg-world-refresh" class="rpg-accordion-action-btn" type="button"><i class="fa-solid fa-rotate"></i> Refresh</button>
                    <span class="dooms-world-result"></span>
                </footer>
            </div>
        </div>`);
    $(document).on('click', '#rpg-close-world', closeWorldDashboard);
    $(document).on('click', `#${POPUP_ID}`, (e) => { if (e.target && e.target.id === POPUP_ID) closeWorldDashboard(); });
    $(document).on('click', '#rpg-world-refresh', () => { lastResult = ''; render(); });
    $(document).on('change', `#${POPUP_ID} .dooms-board-feed`, function () { setFeedLimit($(this).val()); render(); });
    // A tile steps inside its place; the trail leads back out. Attributes are read as written (.attr):
    // jQuery's .data() would turn a place called "0", "null" or "true" into a number or a boolean.
    $(document).on('click', `#${POPUP_ID} .dooms-board-step[data-root], #${POPUP_ID} .dooms-board-crumb[data-root]`, function () {
        closeFacePopover();
        root = String($(this).attr('data-root') || '');
        render();
        focusTrail();
    });
    // A card in the glance or a token on the board is the character's: their trail, by it.
    // Show on the board there steps the board to where they stand and brings it into view.
    $(document).on('click', `#${POPUP_ID} .dooms-world-token-btn[data-name], #${POPUP_ID} .dooms-world-card[data-name]`, function () {
        const name = String($(this).attr('data-name') || '');
        openFacePopover(this, name, { onBoard: (who) => { root = boardRootFor(getActivePack(), getWorldState(), who); render(); showBoard(); focusTrail(); } });
    });
    $(document).on('click', '#rpg-world-advance-now', async function () {
        // advanceNow takes the running flag before its first await, so the
        // render that follows keeps the button disabled for the whole request.
        const pending = advanceNow({ reason: 'dashboard' });
        lastResult = 'Advancing…';
        render();
        try {
            lastResult = describeAdvanceResult(await pending, { spoilerFree: liveWorldConfig(extensionSettings).spoilerFree });
        } catch (e) {
            lastResult = `Failed: ${e && e.message ? e.message : e}`;
        }
        render();
    });
    $(document).on('keydown', (e) => { if (e.key === 'Escape' && isOpen && !isFacePopoverOpen()) closeWorldDashboard(); });
    window.addEventListener(WORLD_CHANGED_EVENT, onChanged);
}

/**
 * Opens the window (building it the first time) and keeps it current while
 * open. `root` opens the board inside a place; `name` opens it where that
 * character stands and brings the board into view.
 */
export async function openWorldDashboard({ root: wanted = '', name = '' } = {}) {
    // The window is the settings popup's shell, styled by styles/modals.css, which loads with the
    // deferred settings UI: opened from the shelf first, the board waits for the sheet.
    try { await ensureCss('modals'); } catch (e) { /* the sheet failed to load: the board still opens */ }
    build();
    isOpen = true;
    lastResult = '';
    if (name) root = boardRootFor(getActivePack(), getWorldState(), name);
    else if (typeof wanted === 'string') root = wanted;
    render();
    $(`#${POPUP_ID}`).css('display', 'flex');
    if (name || wanted) { showBoard(); focusTrail(); }
}

export function closeWorldDashboard() {
    isOpen = false;
    closeFacePopover();
    $(`#${POPUP_ID}`).css('display', 'none');
}
