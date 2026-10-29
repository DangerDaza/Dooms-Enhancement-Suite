/**
 * The Map window (docs/map-window-plan.md), Live World's face: the world's
 * name across the top; the places the story has visited as a row of
 * circles, the most recent on the left, scrolled by the wheel, a drag or
 * the arrows; a place clicked shows Travel here (a cut: the montage of the
 * road, then the arrival) with "arriving when…", or You are here, and Draw
 * (its picture, through Settings → Image Generation); the bottom panel
 * swaps between News, Rumours, People and Completed quests. A card in
 * People opens the face popover; Show the place there selects that
 * character's place in the row. Advance now and Refresh in the foot.
 * Opened from Map in the D menu, Settings → Live World and /liveworld.
 * Loaded on first open. The pure rendering is worldViews.js.
 */
import { extensionSettings, lastGeneratedData, committedTrackerData } from '../../core/state.js';
import { ensureCss } from '../../core/cssLoader.js';
import { resolvePortrait } from './portraitBar.js';
import { liveWorldConfig, BLANK_PACK_ID } from '../../utils/liveWorld.js';
import { rowIdForCharacter } from '../../utils/worldMap.js';
import { sceneFactsFrom } from '../../utils/questCut.js';
import { getWorldState, getActivePack, getPackError, advanceNow, describeAdvanceResult, isAdvancing, presentNamesFromTracker, getPlacesRow, drawPlace, isDrawingPlace, describeDrawResult, WORLD_CHANGED_EVENT } from '../features/liveWorld.js';
import { startTravelCut, getPendingQuestCut, getCompletedQuests, QUESTS_DONE_CHANGED_EVENT } from '../features/questCut.js';
import { sourceProblem } from '../features/imageGen.js';
import { mapWindowHtml, FEED_LIMITS, MAP_PANELS } from './worldViews.js';
import { openFacePopover, closeFacePopover, isFacePopoverOpen } from './worldFace.js';

const POPUP_ID = 'rpg-world-popup';
const FEED_KEY = 'dooms-world-feed';
const PANEL_KEY = 'dooms-map-panel';
let built = false;
let isOpen = false;
let lastResult = '';
let selected = '';          // the place picked in the row ('' for none)
let panel = readPanel();    // the bottom panel's function
let feedLimit = readFeedLimit();
let travelling = false;     // while a travel is being asked for

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

function readPanel() {
    try {
        const raw = localStorage.getItem(PANEL_KEY);
        return MAP_PANELS.some(p => p.id === raw) ? raw : MAP_PANELS[0].id;
    } catch (e) { return MAP_PANELS[0].id; }
}

function setPanel(id) {
    panel = MAP_PANELS.some(p => p.id === id) ? id : MAP_PANELS[0].id;
    try { localStorage.setItem(PANEL_KEY, panel); } catch (e) { /* no storage */ }
}

function portraitOf(name) {
    try { return resolvePortrait(name) || ''; } catch (e) { return ''; }
}

/** The tracker's date, time and place, for the window's first line. */
function sceneFacts() {
    try { return sceneFactsFrom(lastGeneratedData.infoBox || committedTrackerData.infoBox) || {}; } catch (e) { return {}; }
}

function rowEl() {
    return document.querySelector(`#${POPUP_ID} .dooms-map-row`);
}

function render() {
    const $body = $(`#${POPUP_ID} .dooms-world-body`);
    if (!$body.length) return;
    const scrollLeft = (() => { const el = rowEl(); return el ? el.scrollLeft : 0; })();
    const whenTyped = String($(`#${POPUP_ID} #dooms-map-when`).val() || '');
    const state = getWorldState();
    const cfg = liveWorldConfig(extensionSettings);
    const row = getPlacesRow();
    if (selected && !row.some(p => p.id === selected)) selected = '';    // the place left the row
    let drawProblem = '';
    try { drawProblem = sourceProblem(); } catch (e) { drawProblem = ''; }
    $body.html(mapWindowHtml({
        state, pack: getActivePack(), cfg, facts: sceneFacts(), packError: getPackError(), portraits: portraitOf, masterOn: !!extensionSettings.enabled,
        row, selected, drawing: isDrawingPlace(), panel, feed: feedLimit, present: presentNamesFromTracker(), done: getCompletedQuests(),
        travelling: travelling || !!(getPendingQuestCut() && getPendingQuestCut().kind === 'travel'), canDraw: !drawProblem, drawProblem,
    }));
    const el = rowEl();
    if (el) el.scrollLeft = scrollLeft;
    if (whenTyped) $(`#${POPUP_ID} #dooms-map-when`).val(whenTyped);
    $(`#${POPUP_ID} #rpg-world-advance-now`).prop('disabled', isAdvancing());
    $(`#${POPUP_ID} .dooms-world-result`).text(lastResult);
    // The foot's way to the World Builder (docs/world-builder-plan.md D98): a world of yours is edited; the blank
    // world (or a missing one, which the chat plays as blank) is kept as a world of its own; the template is copied.
    const $edit = $(`#${POPUP_ID} #rpg-world-edit`);
    const pack = getActivePack();
    const blank = !!pack && pack.id === BLANK_PACK_ID;
    $edit.prop('disabled', !state || !pack);
    $edit.find('span').text(blank ? 'Make this a world' : 'Edit this world');
    $edit.attr('title', blank
        ? 'Keep what this chat grew as a world of your own: its places and its people, named, kept and editable; the chat carries over to it'
        : 'Open this chat\'s world in the World Builder');
}

/** The circle of a place brought into view (smoothly, when the browser can). */
function scrollToPlace(id) {
    try {
        const el = document.querySelector(`#${POPUP_ID} .dooms-map-place[data-place="${CSS.escape(id)}"]`);
        if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
    } catch (e) { /* no DOM */ }
}

/** Selects a character's place in the row (the nearest visited place above theirs), or says it is not there yet. */
function showPlaceOf(name) {
    const id = rowIdForCharacter(getWorldState(), getActivePack(), name);
    if (!id) { lastResult = `${name}'s place is not in the row yet: the row holds the places the story has been to.`; render(); return; }
    selected = id;
    lastResult = '';
    render();
    scrollToPlace(id);
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
        // another chat, or the world reloaded: the place picked belongs to the old one
        lastResult = '';
        selected = '';
        travelling = false;
        closeFacePopover();
    }
    if (isOpen) render();
}

function build() {
    if (built) return;
    built = true;
    $('body').append(`
        <div id="${POPUP_ID}" class="rpg-settings-popup" role="dialog" aria-modal="true" aria-labelledby="rpg-world-title" style="display: none;">
            <div class="rpg-settings-popup-content">
                <header class="rpg-settings-popup-header">
                    <h3 id="rpg-world-title"><i class="fa-solid fa-map" aria-hidden="true"></i> <span>Map</span></h3>
                    <button id="rpg-close-world" class="rpg-popup-close" type="button" aria-label="Close">&times;</button>
                </header>
                <div class="rpg-settings-popup-body">
                    <div class="dooms-world-body"></div>
                </div>
                <footer class="rpg-settings-popup-footer rpg-world-actions">
                    <button id="rpg-world-advance-now" class="rpg-accordion-action-btn" type="button" title="Run the plot advancer now (the same as /advance)"><i class="fa-solid fa-forward"></i> Advance now</button>
                    <button id="rpg-world-refresh" class="rpg-accordion-action-btn" type="button"><i class="fa-solid fa-rotate"></i> Refresh</button>
                    <button id="rpg-world-edit" class="rpg-accordion-action-btn" type="button" title="Open this chat's world in the World Builder"><i class="fa-solid fa-earth-europe"></i> <span>Edit this world</span></button>
                    <span class="dooms-world-result"></span>
                </footer>
            </div>
        </div>`);
    $(document).on('click', '#rpg-close-world', closeWorldDashboard);
    $(document).on('click', `#${POPUP_ID}`, (e) => { if (e.target && e.target.id === POPUP_ID) closeWorldDashboard(); });
    $(document).on('click', '#rpg-world-refresh', () => { lastResult = ''; render(); });
    $(document).on('click', '#rpg-world-edit', () => {
        const s = getWorldState();
        const pack = getActivePack();
        if (!s || !pack) return;
        const fromChat = pack.id === BLANK_PACK_ID;
        import('./worldBuilder.js')
            .then(m => m.openWorldBuilder(fromChat ? { fromChat: true } : { id: s.pack }))
            .catch(err => console.error('[Dooms Tracker] World Builder failed to load:', err));
    });
    $(document).on('change', `#${POPUP_ID} .dooms-map-feed`, function () { setFeedLimit($(this).val()); render(); });
    $(document).on('click', `#${POPUP_ID} .dooms-map-nav-btn[data-panel]`, function () {
        closeFacePopover();
        const next = String($(this).attr('data-panel') || '');
        if (next === panel) return;
        setPanel(next);
        render();
    });
    // A circle selects its place (again: unselects). Attributes are read as written (.attr):
    // jQuery's .data() would turn a place called "0", "null" or "true" into a number or a boolean.
    $(document).on('click', `#${POPUP_ID} .dooms-map-place[data-place]`, function () {
        closeFacePopover();
        const id = String($(this).attr('data-place') || '');
        selected = id === selected ? '' : id;
        lastResult = '';
        render();
    });
    // The arrows page the row; the wheel scrolls it sideways.
    $(document).on('click', `#${POPUP_ID} .dooms-map-arrow[data-dir]`, function () {
        const el = rowEl();
        if (!el) return;
        const dir = Number($(this).attr('data-dir')) || 1;
        try { el.scrollBy({ left: dir * Math.max(120, el.clientWidth * 0.8), behavior: 'smooth' }); } catch (e) { el.scrollLeft += dir * Math.max(120, el.clientWidth * 0.8); }
    });
    $(document).on('wheel', `#${POPUP_ID} .dooms-map-row`, function (e) {
        const ev = e.originalEvent || e;
        if (!ev || Math.abs(ev.deltaY) <= Math.abs(ev.deltaX)) return;    // a sideways wheel scrolls on its own
        this.scrollLeft += ev.deltaY;
        e.preventDefault();
    });
    // Travel here: the cut is armed and the reply asked for; the window closes so the montage is seen as it lands.
    $(document).on('click', `#${POPUP_ID} .dooms-map-strip [data-act="travel"]`, async function () {
        const place = getPlacesRow().find(p => p.id === selected);
        if (!place || place.here || travelling) return;
        travelling = true;
        render();
        try {
            const ok = await startTravelCut({ place: place.label, placeId: place.id, when: String($(`#${POPUP_ID} #dooms-map-when`).val() || '') });
            if (ok) closeWorldDashboard();
            else lastResult = 'The journey could not be asked for; the System Log has the error.';
        } finally {
            travelling = false;
            if (isOpen) render();
        }
    });
    // Draw: the place's picture, the row following the run through the world's events.
    $(document).on('click', `#${POPUP_ID} .dooms-map-strip [data-act="draw"]`, async function () {
        const place = getPlacesRow().find(p => p.id === selected);
        if (!place || isDrawingPlace()) return;
        lastResult = `Drawing ${place.label}…`;
        const pending = drawPlace(place.id, { reason: 'manual' });
        render();
        try {
            lastResult = describeDrawResult(await pending, place.label);
        } catch (e) {
            lastResult = `The picture failed: ${e && e.message ? e.message : e}`;
        }
        if (isOpen) render();
    });
    // A card in People is the character's: their trail, by it; Show the place there selects where they stand.
    $(document).on('click', `#${POPUP_ID} .dooms-world-token-btn[data-name], #${POPUP_ID} .dooms-world-card[data-name]`, function () {
        const name = String($(this).attr('data-name') || '');
        openFacePopover(this, name, { onBoard: showPlaceOf });
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
    window.addEventListener(QUESTS_DONE_CHANGED_EVENT, () => { if (isOpen) render(); });
}

/**
 * Opens the window (building it the first time) and keeps it current while
 * open. `name` opens it with that character's place selected; `place`
 * with that place selected.
 */
export async function openWorldDashboard({ name = '', place = '' } = {}) {
    // The window is the settings popup's shell, styled by styles/modals.css, which loads with the
    // deferred settings UI: opened from the shelf first, the window waits for the sheet.
    try { await ensureCss('modals'); } catch (e) { /* the sheet failed to load: the window still opens */ }
    build();
    isOpen = true;
    lastResult = '';
    if (place) selected = String(place);
    render();
    $(`#${POPUP_ID}`).css('display', 'flex');
    if (name) showPlaceOf(name);
    else if (selected) scrollToPlace(selected);
}

export function closeWorldDashboard() {
    isOpen = false;
    closeFacePopover();
    $(`#${POPUP_ID}`).css('display', 'none');
}
