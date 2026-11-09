/**
 * The Atlas (docs/long-shot-plan.md D138, D142, D147): the world's map,
 * the whole screen. The sidebar (the world's name, the tabs: Places with
 * the search and the kinds, People, News, Rumours, Hooks) beside the
 * vector map; a marker opens its card (the distance from the party,
 * Travel here, what is said about the place). Opened from Atlas in the D
 * menu. Loaded on first open. The pure rendering is atlasViews.js, the
 * map atlasMap.js, the model src/utils/atlas.js.
 */
import { extensionSettings, lastGeneratedData, committedTrackerData } from '../../core/state.js';
import { ensureCss } from '../../core/cssLoader.js';
import { resolvePortrait } from './portraitBar.js';
import { pushWindow, popWindow, takesEscape } from './windowStack.js';
import { liveWorldConfig, BLANK_PACK_ID, recentChanges, publicEffects } from '../../utils/liveWorld.js';
import { atlasModel, describeDistance, ATLAS_KINDS, placeAt, unplace, addPin, removeMarker, restoreMarker, mergeInto, unmerge, editMarker, withScale, placeAll, applyTidyItem } from '../../utils/atlas.js';
import { safeImageUrl } from '../../utils/worldBoard.js';
import { getBook, setBook, proposeTidy } from '../features/atlasBook.js';
import { sceneFactsFrom } from '../../utils/questCut.js';
import { describeHooksResult } from '../../utils/questHooks.js';
import { recordCurrentScene, getWorldState, getActivePack, getPackError, advanceNow, describeAdvanceResult, isAdvancing, presentNamesFromTracker, isLiveWorldOn, WORLD_CHANGED_EVENT } from '../features/liveWorld.js';
import { startTravelCut, getPendingQuestCut } from '../features/questCut.js';
import { getHooks, isProposing, proposeHooks, takeHook, setHookAside, HOOKS_CHANGED_EVENT } from '../features/questHooks.js';
import { worldEmptyMessage, statusText, newsHtml, rumoursHtml, hooksHtml, peopleHtml, FEED_LIMITS } from './worldViews.js';
import { openFacePopover, closeFacePopover, isFacePopoverOpen } from './worldFace.js';
import { ATLAS_ID, ATLAS_TABS, atlasShellHtml, atlasSideHtml, atlasPlacesHtml, atlasResultsHtml, atlasCardHtml } from './atlasViews.js';

const MOVE_KEY = 'dooms-atlas-moving';

const TAB_KEY = 'dooms-atlas-tab';
const HIDDEN_KEY = 'dooms-atlas-hidden';
const FOLD_KEY = 'dooms-atlas-folded';
const FEED_KEY = 'dooms-world-feed';    // the Map window's own: one choice for both while both exist

let built = false;
let isOpen = false;
let tab = readTab();
let hidden = readHidden();
let folded = readFlag(FOLD_KEY);
let feedLimit = readFeed();
let query = '';
let result = '';
let travelling = false;
let board = null;         // the mounted map (atlasMap.js)
let boardWorld = '';      // the world the mounted map shows: another world's opens fitted
let boardView = null;     // the view kept across a close, with its world
let mountToken = 0;
let model = null;
let moving = readFlag(MOVE_KEY);    // markers can be dragged
let armed = null;         // what waits for a tap on the map: { kind: 'place', id, label } (a tray row) or { kind: 'add' } (a new marker)
let cardMode = 'view';    // the open card: 'view' | 'edit' | 'merge'
let tidy = { busy: false, items: [], error: '', asked: false };    // the clean-up pass: what it proposed, to be approved (D155)
let tidyChat = null;      // the chat the proposals are about: another chat's are dropped
let brokenPicture = '';   // a world's picture that would not load: the drawn land stands in

function readTab() {
    try { const raw = localStorage.getItem(TAB_KEY); return ATLAS_TABS.some(t => t.id === raw) ? raw : ATLAS_TABS[0].id; } catch (e) { return ATLAS_TABS[0].id; }
}
function readHidden() {
    try { const raw = JSON.parse(localStorage.getItem(HIDDEN_KEY) || '[]'); return Array.isArray(raw) ? raw.filter(id => ATLAS_KINDS.some(k => k.id === id)) : []; } catch (e) { return []; }
}
function readFlag(key) {
    try { return localStorage.getItem(key) === '1'; } catch (e) { return false; }
}
function readFeed() {
    try { const n = Number(localStorage.getItem(FEED_KEY)); return FEED_LIMITS.includes(n) ? n : FEED_LIMITS[0]; } catch (e) { return FEED_LIMITS[0]; }
}
function keep(key, value) {
    try { localStorage.setItem(key, value); } catch (e) { /* no storage */ }
}

const root = () => `#${ATLAS_ID}`;

function portraitOf(name) {
    try { return resolvePortrait(name) || ''; } catch (e) { return ''; }
}

function sceneFacts() {
    try { return sceneFactsFrom(lastGeneratedData.infoBox || committedTrackerData.infoBox) || {}; } catch (e) { return {}; }
}

function playerName() {
    try { const ctx = window.SillyTavern && window.SillyTavern.getContext ? window.SillyTavern.getContext() : null; return ctx && ctx.name1 ? String(ctx.name1) : ''; } catch (e) { return ''; }
}

function chatOpen() {
    try { const ctx = window.SillyTavern && window.SillyTavern.getContext ? window.SillyTavern.getContext() : null; return !!(ctx && (ctx.characterId !== undefined && ctx.characterId !== null || ctx.groupId)); } catch (e) { return false; }
}

/** The world in front and what the map draws of it; null while there is nothing to draw. */
function read() {
    const state = getWorldState();
    const pack = getActivePack();
    const cfg = liveWorldConfig(extensionSettings);
    const empty = worldEmptyMessage({ state, pack, cfg, packError: getPackError(), masterOn: !!extensionSettings.enabled });
    if (empty) { model = null; return { state, pack, cfg, empty }; }
    model = atlasModel({ pack, state, player: playerName(), book: getBook() });
    return { state, pack, cfg, empty: '' };
}

/** What is said that names a place: the street's lines and the latest changes with its name in them. */
function saidAbout(marker, { state, pack, cfg }) {
    const low = String(marker.label || '').toLowerCase();
    if (!low || !state || !pack) return { rumours: [], news: [] };
    const names = (text) => String(text || '').toLowerCase().includes(low);
    let rumours = [];
    let news = [];
    try { rumours = publicEffects(state, pack).filter(x => names(x.text) || ((pack.clocks.find(c => c.id === x.id) || {}).place === marker.id)).map(x => x.text); } catch (e) { rumours = []; }
    try { news = recentChanges(state, pack, { limit: 50, spoilerFree: !!cfg.spoilerFree }).filter(c => names(c.text)).map(c => c.text); } catch (e) { news = []; }
    return { rumours, news };
}

function cardFor(marker) {
    const ctx = read();
    if (!model) return '';
    const m = model.markers.find(x => x.id === marker.id) || marker;
    const said = cardMode === 'view' ? saidAbout(m, ctx) : { rumours: [], news: [] };
    const pending = getPendingQuestCut();
    const others = [...model.markers, ...model.tray].filter(x => x.id !== m.id).map(x => ({ id: x.id, label: x.label })).sort((a, b) => a.label.localeCompare(b.label));
    return atlasCardHtml({
        marker: m, mode: cardMode, others,
        distance: describeDistance(model, model.party, m.id),
        canTravel: isLiveWorldOn() && chatOpen(),
        travelling: travelling || !!(pending && pending.kind === 'travel'),
        rumours: said.rumours, news: said.news, portraits: portraitOf,
    });
}

/** The world's own picture, when it has one that loads (D154). */
function pictureOf(pack) {
    const m = pack && pack.map;
    if (!m || !m.image || m.image === brokenPicture) return null;
    const image = safeImageUrl(m.image);
    return image && m.width > 0 && m.height > 0 ? { image, width: m.width, height: m.height } : null;
}

/** The book changed: saved with the chat, everything drawn again. */
function commit(next, word = '') {
    if (!setBook(next)) { result = 'The map could not be saved: no chat is open.'; render(); return false; }
    result = word;
    render();
    return true;
}

/** The word across the top of the map while something waits for a tap. */
function setHint(text) {
    const $h = $(`${root()} .dooms-atlas-hint`);
    $h.prop('hidden', !text).text(text || '');
}

function arm(next) {
    armed = next;
    setHint(!armed ? '' : armed.kind === 'add' ? 'Tap the map where the new marker goes. Esc cancels.' : `Tap the map where ${armed.label} goes. Esc cancels.`);
    $(root()).toggleClass('is-armed', !!armed);
    $(`${root()} .dooms-atlas-tool[data-act="add"]`).toggleClass('is-on', !!armed && armed.kind === 'add');
    $(`${root()} .dooms-atlas-tray-row`).each(function () { $(this).toggleClass('is-armed', !!armed && armed.kind === 'place' && this.getAttribute('data-id') === armed.id); });
}

/** The map tapped: what was waiting lands there. */
function tapped(at) {
    if (!armed) return;
    const a = armed;
    arm(null);
    if (a.kind === 'place') { commit(placeAt(getBook(), a.id, at)); return; }
    const made = addPin(getBook(), { label: 'New place', x: at.x, y: at.y });
    if (!commit(made.book)) return;
    if (!board) return;
    board.open(made.id);    // opening closes any other card, which sets the mode back to reading
    cardMode = 'edit';      // the new marker opens on its name
    board.redrawCard();
}

function tabBody({ state, pack, cfg }) {
    if (tab === 'people') return peopleHtml({ state, pack, portraits: portraitOf, present: presentNamesFromTracker(), sceneText: sceneFacts().location || '' });
    if (tab === 'news') return newsHtml({ state, pack, cfg, feed: feedLimit });
    if (tab === 'rumours') return rumoursHtml({ state, pack, cfg });
    if (tab === 'hooks') return hooksHtml({ hooks: getHooks(), busy: isProposing() });
    return atlasPlacesHtml({ markers: model ? model.markers : [], tray: model ? model.tray : [], deleted: model ? model.deleted : [], query, hidden, armed: armed && armed.kind === 'place' ? armed.id : '', scale: model ? model.measure.scale : 'town', tidy });
}

function renderSide(ctx) {
    const $side = $(`${root()} .dooms-atlas-side`);
    if (!$side.length) return;
    const { state, pack, cfg, empty } = ctx;
    const scroll = $(`${root()} .dooms-atlas-body`).scrollTop() || 0;
    const blank = !!pack && pack.id === BLANK_PACK_ID;
    $side.html(atlasSideHtml({
        name: (state && state.name) || (pack && pack.name) || 'The Atlas',
        facts: sceneFacts(),
        tab,
        body: empty ? '' : tabBody(ctx),
        status: empty ? '' : `${statusText(state, cfg)}${cfg.spoilerFree ? ' Spoiler-free.' : ''}`,
        result,
        canAdvance: !empty,
        advancing: isAdvancing(),
        editLabel: blank ? 'Make this a world' : 'Edit this world',
    }));
    $(`${root()} .dooms-atlas-body`).scrollTop(scroll);
    $(`${root()} [data-act="edit"]`).prop('disabled', !state || !pack);
}

function setScale({ px, length, unit }) {
    const $s = $(`${root()} .dooms-atlas-scale`);
    if (!px || !length) { $s.hide(); return; }
    $s.show();
    $s.find('.dooms-atlas-scale-bar').css('width', `${px}px`);
    let words = `${length} ${unit === 'mi' ? (length === 1 ? 'mile' : 'miles') : unit === 'league' ? (length === 1 ? 'league' : 'leagues') : 'km'}`;
    if (unit === 'mi' && length < 0.2) words = `${Math.round(length * 5280 / 10) * 10} feet`;      // a town's map reads in feet
    if (unit === 'km' && length < 1) words = `${Math.round(length * 1000)} m`;
    $s.find('.dooms-atlas-scale-text').text(words);
}

function unmount({ keepView = true } = {}) {
    if (!board) return;
    try { boardView = keepView ? { world: boardWorld, ...board.view() } : null; board.destroy(); } catch (e) { /* the frame is gone already */ }
    board = null;
}

async function mount(ctx) {
    const host = document.querySelector(`${root()} .dooms-atlas-map`);
    if (!host || !model) return;
    const token = ++mountToken;
    const world = ctx.state ? `${ctx.state.pack || ''}|${ctx.state.name || ''}` : '';
    let mod;
    try {
        mod = await import('./atlasMap.js');
        await ensureCss('leaflet', mod.LEAFLET_CSS);
    } catch (e) {
        $(`${root()} .dooms-atlas-empty`).prop('hidden', false).html(`<p>The map could not load: ${e && e.message ? String(e.message).replace(/[<>&]/g, '') : 'unknown error'}</p>`);
        return;
    }
    if (token !== mountToken || !isOpen || !model || !document.body.contains(host)) return;
    const made = await mod.mountAtlasMap(host, {
        model, picture: pictureOf(ctx.pack), hidden, query, moving, portraits: portraitOf, card: cardFor,
        view: boardView && boardView.world === world ? boardView : null,
        on: {
            scale: setScale,
            open: () => { /* the card's mode was set by whoever opened it */ },
            close: () => { closeFacePopover(); cardMode = 'view'; },
            drop: (id, at) => { arm(null); commit(placeAt(getBook(), id, at)); },
            tap: tapped,
            move: (id, at) => commit(placeAt(getBook(), id, at)),
            pictureError: () => { brokenPicture = ctx.pack && ctx.pack.map ? ctx.pack.map.image : ''; result = 'The world\'s picture could not be loaded; the drawn map stands in.'; setTimeout(render, 0); },
        },
    });
    if (token !== mountToken || !isOpen) { try { made.destroy(); } catch (e) { /* gone */ } return; }
    board = made;
    boardWorld = world;
    boardView = null;
}

/** Everything drawn again from the world in front: the sidebar, the map (mounted, or its model replaced), the empty word. */
function render() {
    if (!isOpen) return;
    const ctx = read();
    if (tidyChat !== null && tidyChat !== worldKey()) { tidy = { busy: false, items: [], error: '', asked: false }; tidyChat = null; }    // another chat's proposals are not this one's
    renderSide(ctx);
    const $empty = $(`${root()} .dooms-atlas-empty`);
    if (ctx.empty || !model) {
        unmount({ keepView: false });
        $empty.prop('hidden', false).html(ctx.empty || '<p>There is no world to draw.</p>');
        $(`${root()} .dooms-atlas-scale`).hide();
        return;
    }
    $empty.prop('hidden', true).empty();
    const world = `${ctx.state.pack || ''}|${ctx.state.name || ''}`;
    if (board && boardWorld !== world) unmount({ keepView: false });
    if (board) board.update({ model, picture: pictureOf(ctx.pack), hidden, query, moving });
    else mount(ctx);
    // An empty map says how it fills: nothing lands on it by itself (D145).
    const word = model.markers.length ? '' : (model.tray.length ? 'Nothing is on the map yet. Drag a place from the list on the left onto the map, or press Place all.' : 'This world has no places yet. They appear in the list as the story names them; the pin button above adds one by hand.');
    if (!armed) setHint(word);
    $(root()).toggleClass('is-armed', !!armed);
    $(`${root()} .dooms-atlas-tool[data-act="move"]`).toggleClass('is-on', moving);
}

/** The search typed: the list and the markers follow; the box keeps its caret (the sidebar is not drawn again). */
function searched() {
    $(`${root()} .dooms-atlas-results`).html(atlasResultsHtml({ markers: model ? model.markers : [], query, hidden }));
    if (board) board.update({ query });
}

function setHidden(next) {
    hidden = next;
    keep(HIDDEN_KEY, JSON.stringify(hidden));
    render();
}

function showMarker(id) {
    if (!board || !model) return;
    const m = model.markers.find(x => x.id === id);
    if (!m) return;
    if (hidden.includes(m.kind)) { hidden = hidden.filter(k => k !== m.kind); keep(HIDDEN_KEY, JSON.stringify(hidden)); render(); }
    cardMode = 'view';
    board.show(id);
    try { if (window.matchMedia('(max-width: 720px)').matches) setFolded(true); } catch (e) { /* no matchMedia */ }
}

/** A character's place shown on the map: the face popover's Show the place. */
function showPlaceOf(name) {
    closeFacePopover();
    if (!model) return;
    const m = model.markers.find(x => (x.people || []).includes(name));
    if (!m) { result = `${name} is nowhere on the map yet.`; render(); return; }
    result = '';
    showMarker(m.id);
}

/** The chat's world, as a key: what a kept view and a clean-up's proposals belong to. */
function worldKey() {
    const st = getWorldState();
    return st ? `${st.pack || ''}|${st.name || ''}` : '';
}

function labelOf(id) {
    const m = model ? [...model.markers, ...model.tray, ...model.deleted].find(x => x.id === id) : null;
    return m ? m.label : 'The place';
}

function setFolded(v) {
    folded = !!v;
    keep(FOLD_KEY, folded ? '1' : '0');
    $(root()).toggleClass('is-folded', folded);
    if (board) setTimeout(() => { if (board) board.size(); }, 0);
}

async function travel(id) {
    if (!model || travelling) return;
    const m = model.markers.find(x => x.id === id);
    if (!m || m.player) return;
    const when = String($(`${root()} .dooms-atlas-when`).val() || '');
    travelling = true;
    if (board) board.update({});
    try {
        const ok = await startTravelCut({ place: m.label, placeId: m.id, when });
        if (ok) { closeAtlas(); return; }
        result = 'The journey could not be asked for; the System Log has the error.';
    } catch (e) {
        result = `Failed: ${e && e.message ? e.message : e}`;
    } finally {
        travelling = false;
    }
    render();
}

function build() {
    if (built) return;
    built = true;
    $('body').append(atlasShellHtml());
    $(root()).toggleClass('is-folded', folded);
    $(document).on('click', `${root()} [data-act]`, async function (ev) {
        const act = this.getAttribute('data-act');
        try {
            if (act === 'close') { closeAtlas(); return; }
            if (act === 'fold') { setFolded(!folded); return; }
            if (act === 'fit') { if (board) board.fit(); return; }
            if (act === 'party') { if (model && model.party) showMarker(model.party); else { result = 'The party is nowhere on the map yet.'; render(); } return; }
            if (act === 'tab') { closeFacePopover(); const next = this.getAttribute('data-tab') || ''; if (next !== tab) { tab = ATLAS_TABS.some(t => t.id === next) ? next : ATLAS_TABS[0].id; keep(TAB_KEY, tab); render(); } return; }
            if (act === 'kind') { const k = this.getAttribute('data-kind') || ''; setHidden(hidden.includes(k) ? hidden.filter(x => x !== k) : [...hidden, k]); return; }
            if (act === 'kinds-on') { setHidden([]); return; }
            if (act === 'kinds-off') { setHidden(ATLAS_KINDS.map(k => k.id)); return; }
            if (act === 'goto') { showMarker(this.getAttribute('data-id') || ''); return; }
            // The markers (D145, D151): placed, made, moved, edited, merged, taken off, deleted, brought back.
            const id = this.getAttribute('data-id') || '';
            if (act === 'arm') { const t = model ? model.tray.find(x => x.id === id) : null; arm(t && !(armed && armed.kind === 'place' && armed.id === id) ? { kind: 'place', id, label: t.label } : null); return; }
            if (act === 'add') { arm(armed && armed.kind === 'add' ? null : { kind: 'add' }); return; }
            if (act === 'move') { moving = !moving; keep(MOVE_KEY, moving ? '1' : '0'); result = moving ? 'Moving is on: drag a marker to where it belongs.' : ''; render(); return; }
            if (act === 'place-all') { if (model) commit(placeAll(getBook(), model, getActivePack()), 'Everything is on the map. Turn on moving (the arrows above the map) to drag a marker to where it belongs.'); if (board) board.fit(); return; }
            if (act === 'delete') { ev.stopPropagation(); const label = labelOf(id); if (board) board.closeCard(); commit(removeMarker(getBook(), id), `${label} is deleted. It is under Deleted at the foot of Places if you want it back.`); return; }
            if (act === 'restore') { commit(restoreMarker(getBook(), id), 'Brought back: it waits in the list to be placed.'); return; }
            if (act === 'unplace') { ev.stopPropagation(); if (board) board.closeCard(); commit(unplace(getBook(), id)); return; }
            if (act === 'unmerge') { ev.stopPropagation(); commit(unmerge(getBook(), id), 'Split off: it waits in the list to be placed.'); return; }
            // The clean-up pass (D155): asked for, then each proposal done or passed over.
            if (act === 'tidy') {
                if (!model || tidy.busy) return;
                const world = worldKey();
                tidy = { busy: true, items: [], error: '', asked: true };
                tidyChat = world;
                render();
                const r = await proposeTidy(model, { world: (getWorldState() || {}).name || '' });
                if (tidyChat !== world) return;    // the chat changed while the AI read
                tidy = { busy: false, items: r.ok ? r.items : [], error: r.ok ? '' : (r.error || 'The clean-up could not be asked for.'), asked: true };
                render();
                return;
            }
            if (act === 'tidy-yes' || act === 'tidy-no') {
                const i = Number(this.getAttribute('data-i'));
                const item = tidy.items[i];
                if (!item) return;
                tidy = { ...tidy, items: tidy.items.filter((_, k) => k !== i) };
                if (act === 'tidy-yes') commit(applyTidyItem(getBook(), item), item.kind === 'merge' ? `${item.label} is merged into ${item.toLabel}.` : `${item.label} is deleted.`);
                else render();
                return;
            }
            if (act === 'tidy-all') { let b = getBook(); const n = tidy.items.length; for (const item of tidy.items) b = applyTidyItem(b, item); tidy = { ...tidy, items: [], asked: false }; commit(b, `${n} done. Anything deleted is under Deleted at the foot of Places.`); return; }
            if (act === 'tidy-none') { tidy = { ...tidy, items: [], asked: false }; render(); return; }
            if (act === 'card-edit' || act === 'card-merge' || act === 'card-view') { ev.stopPropagation(); cardMode = act === 'card-edit' ? 'edit' : act === 'card-merge' ? 'merge' : 'view'; if (board) board.redrawCard(); return; }
            if (act === 'edit-save') {
                ev.stopPropagation();
                const $c = $(this).closest('.dooms-atlas-card');
                cardMode = 'view';
                commit(editMarker(getBook(), id, { label: String($c.find('[data-field="label"]').val() || ''), kind: String($c.find('[data-field="kind"]').val() || ''), note: String($c.find('[data-field="note"]').val() || '') }));
                return;
            }
            if (act === 'merge-go') {
                ev.stopPropagation();
                const to = String($(this).closest('.dooms-atlas-card').find('[data-field="target"]').val() || '');
                if (!to) return;
                const label = labelOf(id);
                cardMode = 'view';
                if (board) board.closeCard();
                commit(mergeInto(getBook(), id, to), `${label} is merged into ${labelOf(to)}.`);
                return;
            }
            if (act === 'travel') { ev.stopPropagation(); await travel(this.getAttribute('data-id') || ''); return; }
            if (act === 'person') { ev.stopPropagation(); openFacePopover(this, this.getAttribute('data-name') || '', { onBoard: showPlaceOf }); return; }
            if (act === 'advance') {
                const pending = advanceNow({ reason: 'atlas' });    // takes the running flag before its first await: the render keeps the button disabled
                result = 'Advancing…';
                render();
                try { result = describeAdvanceResult(await pending, { spoilerFree: liveWorldConfig(extensionSettings).spoilerFree }); } catch (e) { result = `Failed: ${e && e.message ? e.message : e}`; }
                render();
                return;
            }
            if (act === 'edit') {
                const s = getWorldState();
                const pack = getActivePack();
                if (!s || !pack) return;
                const fromChat = pack.id === BLANK_PACK_ID;
                closeAtlas();    // the builder is a window of the settings shell, which sits under the Atlas
                import('./worldBuilder.js').then(m => m.openWorldBuilder(fromChat ? { fromChat: true } : { id: s.pack })).catch(err => console.error('[Dooms Tracker] World Builder failed to load:', err));
                return;
            }
            // Hooks (docs/hooks-canon-plan.md D104), as the Map window offers them.
            if (act === 'hooks-propose') {
                result = 'Asking the world for hooks…';
                render();
                try { result = describeHooksResult(await proposeHooks({ reason: 'atlas' })); } catch (e) { result = `Failed: ${e && e.message ? e.message : e}`; }
                render();
                return;
            }
            if (act === 'hook-take' || act === 'hook-cut') {
                const cut = act === 'hook-cut';
                const r = await takeHook(this.getAttribute('data-hook'), { cut });
                if (!r.ok) { result = r.reason === 'no-hook' ? 'That hook is no longer on offer.' : `Failed: ${r.error || r.reason}`; render(); return; }
                if (cut && r.cut) { closeAtlas(); return; }
                result = cut ? `"${r.quest}" is on the shelf's Quests page; the cut could not be asked for.` : `Taken: "${r.quest}" is on the shelf's Quests page.`;
                render();
                return;
            }
            if (act === 'hook-aside') { setHookAside(this.getAttribute('data-hook')); result = 'Set aside; it will not be offered again.'; render(); return; }
        } catch (e) {
            result = `Failed: ${e && e.message ? e.message : e}`;
            render();
        }
    });
    // A tray row dragged: its id rides the drag, and the map hears the drop.
    document.addEventListener('dragstart', (ev) => {
        const row = ev.target && ev.target.closest ? ev.target.closest(`${root()} .dooms-atlas-tray-row[data-id]`) : null;
        if (!row || !ev.dataTransfer) return;
        ev.dataTransfer.setData('text/plain', row.getAttribute('data-id') || '');
        ev.dataTransfer.effectAllowed = 'move';
    });
    $(document).on('change', `${root()} .dooms-atlas-scale-select`, function () { commit(withScale(getBook(), String($(this).val() || ''))); });
    $(document).on('input', `${root()} .dooms-atlas-query`, function () { query = String($(this).val() || ''); searched(); });
    $(document).on('keydown', `${root()} .dooms-atlas-query`, function (ev) {
        if (ev.key !== 'Enter') return;
        const first = document.querySelector(`${root()} .dooms-atlas-results [data-act="goto"]`);    // Enter goes to the first match
        if (first) showMarker(first.getAttribute('data-id') || '');
    });
    $(document).on('change', `${root()} .dooms-map-feed`, function () { const n = Number($(this).val()); feedLimit = FEED_LIMITS.includes(n) ? n : FEED_LIMITS[0]; keep(FEED_KEY, String(feedLimit)); render(); });
    $(document).on('click', `${root()} .dooms-world-card[data-name], ${root()} .dooms-world-token-btn[data-name]`, function () {
        openFacePopover(this, String($(this).attr('data-name') || ''), { onBoard: showPlaceOf });
    });
    $(document).on('keydown', (ev) => {
        if (!isOpen || isFacePopoverOpen() || !takesEscape('atlas', ev)) return;
        if (armed) { arm(null); render(); return; }    // what waited for a tap is let go first
        if (board && board.opened()) { board.closeCard(); return; }    // a card on top closes first
        closeAtlas();
    });
    window.addEventListener(WORLD_CHANGED_EVENT, () => { if (isOpen) render(); });
    window.addEventListener(HOOKS_CHANGED_EVENT, () => { if (isOpen && tab === 'hooks') render(); });
    window.addEventListener('resize', () => { if (isOpen && board) board.size(); });
}

/**
 * Opens the Atlas (building it the first time) and keeps it current while
 * open. `place` opens it on that place's card; `name` on the place that
 * character stands at.
 */
export async function openAtlas({ place = '', name = '' } = {}) {
    try { await ensureCss('atlas'); } catch (e) { /* the sheet failed to load: the window still opens */ }
    build();
    isOpen = true;
    pushWindow('atlas');
    result = '';
    try { recordCurrentScene(); } catch (e) { /* the map stays as it is */ }    // the place the chat stands in, if no reply recorded it
    $(root()).addClass('is-open').css('display', 'flex');    // shown before the render, so the map's frame has its size when Leaflet fits it
    render();
    if (place || name) {
        const wait = (n) => { if (!isOpen) return; if (board) { if (name) showPlaceOf(name); else showMarker(place); } else if (n > 0) setTimeout(() => wait(n - 1), 60); };
        wait(40);
    }
}

export function closeAtlas() {
    isOpen = false;
    popWindow('atlas');
    closeFacePopover();
    unmount();    // the view is kept with its world: the Atlas opened again shows the map where it was left
    armed = null;
    cardMode = 'view';
    $(root()).removeClass('is-open is-armed').css('display', 'none');
}

export function isAtlasOpen() {
    return isOpen;
}
