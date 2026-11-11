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
import { liveWorldConfig, BLANK_PACK_ID, recentChanges, publicEffects, normalizeWorldState } from '../../utils/liveWorld.js';
import { atlasModel, describeDistance, ATLAS_KINDS, ATLAS_SCALES, placeAt, unplace, addPin, removeMarker, restoreMarker, mergeInto, unmerge, editMarker, withScale, placeAll, applyTidyItem, withDrawn, moveInto, withGround, setCanon, wrapInRegion, toggleRoad, setRoadTime, describeJourney, describeLength, describeTime, travelHours, territoryAt, spotOnLand, normalizeBook, journeyGap, withWorld, describeRoad , labelSegments } from '../../utils/atlas.js';
import { worldGenState, worldGenDefaults, planWorldGen, applyWorldGen, worldReach, landsToName, applyNames } from '../../utils/atlasWorld.js';
import { randomSeed, WORLD_SHAPES } from '../../utils/worldGen.js';
import { safeImageUrl } from '../../utils/worldBoard.js';
import { getBook, setBook, proposeTidy, draftSetup, stopSetup, setupReach, draftFill, draftNames } from '../features/atlasBook.js';
import { editDraftPlace, setDraftInside, removeDraftPlace, applySetup, applyFill, fillOptions } from '../../utils/atlasSetup.js';
import { sceneFactsFrom } from '../../utils/questCut.js';
import { describeHooksResult } from '../../utils/questHooks.js';
import { recordCurrentScene, getWorldState, getActivePack, getPackError, advanceNow, describeAdvanceResult, isAdvancing, presentNamesFromTracker, isLiveWorldOn, loadPack, getPlacesRow, drawPlace, isDrawingPlace, describeDrawResult, WORLD_CHANGED_EVENT } from '../features/liveWorld.js';
import { sourceProblem } from '../features/imageGen.js';
import { startTravelCut, getPendingQuestCut, getCompletedQuests, QUESTS_DONE_CHANGED_EVENT } from '../features/questCut.js';
import { getHooks, isProposing, proposeHooks, takeHook, setHookAside, HOOKS_CHANGED_EVENT } from '../features/questHooks.js';
import { worldEmptyMessage, statusText, newsHtml, rumoursHtml, hooksHtml, doneHtml, peopleHtml, FEED_LIMITS } from './worldViews.js';
import { openFacePopover, closeFacePopover, isFacePopoverOpen } from './worldFace.js';
import { ATLAS_ID, ATLAS_TABS, atlasShellHtml, atlasSideHtml, atlasPlacesHtml, atlasResultsHtml, atlasCardHtml, atlasStartHtml, atlasTrailHtml, atlasSetupHtml, atlasFillHtml, atlasScenesHtml, scenesRefusalText, atlasStartSceneHtml, atlasEndSceneHtml, atlasRoadHtml, roadTimeHours, atlasWorldGenHtml, worldGenFigureHtml, atlasNamesHtml , atlasSceneListHtml, atlasWaysHtml, atlasWorldHooksHtml } from './atlasViews.js';
import { scenesPlan, prepareAdopt, commitAdopt, isScene, isHubOn, atlasSource, setWorldBook, openSceneChat, HUB_CHANGED_EVENT, sceneStartPlan, prepareScene, commitScene, pendingStart, askOpenersAgain, cancelStart, currentScene, prepareEnd, commitEnd, continueScene, canUndoEnd, undoEnd, startPlanFor, worldSource, worldEntry, hubWorldIds, cardOf, refreshScenes, setSceneAside, resumeScene, removeGoneScene, deleteScene, hubHooks, isHooksBusy, proposeHubHooks, setHubHookAside } from '../features/hub.js';
import { describeStartResult, describeEndResult, describeDeleteResult, gapOf, hubConfig } from '../../utils/hub.js';

const MOVE_KEY = 'dooms-atlas-moving';

const TAB_KEY = 'dooms-atlas-tab';
const HIDDEN_KEY = 'dooms-atlas-hidden';
const FOLD_KEY = 'dooms-atlas-folded';
const FEED_KEY = 'dooms-world-feed';    // the key the Map window used: the choice made there is kept (D195)

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
let layer = '';           // the place whose map is drawn; '' for the top map (D156)
let layerWorld = '';      // the world that layer belongs to: another world opens on its top map
let roading = null;       // roads are being drawn (D164): { first: '' | the marker picked first }, or null
let setup = null;         // the set-up in hand (D159): { step, notes, reach, cost, progress, draft, error, note, world }, or null
let undoBook = null;      // the book as it was before a set-up was applied, with its world: one Undo, until the Atlas closes
let startDismissed = '';   // the world whose Start panel was waved away this session
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

// What the Atlas shows (D173): the chat in front, or, when that chat is a scene that has ended, the world's memory:
// the world has moved on from an ended scene, so its chat no longer says how things stand. Read anew on every draw.
let source = { kind: 'chat' };
const between = () => source.kind === 'world';
// A world picked in the Atlas (D194): shown from its memory, as between scenes, whatever chat is in front. '' for the
// chat's own world. Let go when the Atlas closes, so it opens on the chat again.
let picked = '';
let pickedPack = null;    // its pack, loaded when it is picked
let worlds = [];          // the worlds that can be picked: [{ id, name, card }]
let worldsToken = 0;
let deleting = '';        // the scene whose Delete was pressed and waits for "Delete scene N" or "Keep it" (D197)
let deletingNow = '';     // the scene being deleted
/** The pack the Atlas draws: the picked world's, else the chat's. */
const thePack = () => (picked ? pickedPack : getActivePack());
let startPlan = { ok: false, reason: '' };    // whether a scene can be started from here, and in which world (D174); read anew on every draw

/** The world's state as the Atlas draws it: the chat's, or between scenes the memory's. */
function theState() {
    if (!between()) return getWorldState();
    try { return normalizeWorldState(source.memory.stores.dooms_world); } catch (e) { return null; }
}

/** The map's book as the Atlas draws it: the chat's, or between scenes the world's own copy. */
function theBook() {
    return between() ? normalizeBook(source.memory.stores.dooms_atlas) : getBook();
}

/** The book saved where it was read from. '' when it was; else why not, in words. */
function saveTheBook(next) {
    if (!between()) return setBook(next) ? '' : 'The map could not be saved: no chat is open.';
    const r = setWorldBook(source.worldId, next, { pack: picked ? pickedPack : null });    // a picked world no scene has ended in begins its memory with its map (D194)
    if (r.ok) { source = { ...source, memory: { ...source.memory, stores: { ...source.memory.stores, dooms_atlas: normalizeBook(next) } } }; return ''; }
    if (r.reason === 'scene-open') return `Scene ${sceneNumber(r.scene.id)} is being played: the map is changed there. "Go to it" is under the world's name.`;
    return 'The map could not be saved: this world has no memory yet.';
}

/**
 * When the world last moved and when it moves next (D178). In a long chat: by the count of replies, as ever. In a
 * scene the world is held and moves when the scene ends; between scenes it has moved, and moves again with the next.
 */
function statusLine(state, cfg) {
    const full = statusText(state, cfg);
    let cur = null;
    try { cur = currentScene(); } catch (e) { cur = null; }
    if (!cur && !between()) return full;
    const last = full.split(' · ')[0];
    if (cur && !cur.ended) return `${last} · held while scene ${sceneNumber(cur.mark.scene)} is played: the clocks tick when it ends.`;
    return `${last} · the clocks tick when a scene ends, and for the time that passes before the next.`;
}

const sceneNumber = (id) => { const m = /^s(\d+)$/.exec(String(id || '')); return m ? m[1] : '?'; };

function sceneFacts() {
    if (between()) { const f = source.memory.facts || {}; return { date: f.date || '', time: f.time || '', location: f.location || '', weather: f.weather || '' }; }
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
    if (picked) {
        // A picked world (D194): its memory, whatever chat is in front. One that is gone (deleted, the hub switched off) is let go;
        // so is one whose scene is now the chat in front (Go to it, a scene resumed): that chat is the world.
        try { const cur = currentScene(); if (cur && cur.worldId === picked) { picked = ''; pickedPack = null; } } catch (e) { /* the pick stands */ }
    }
    if (picked) {
        let src = null;
        try { src = isHubOn() && pickedPack ? worldSource(picked, pickedPack) : null; } catch (e) { src = null; }
        if (src) source = src; else { picked = ''; pickedPack = null; }
    }
    if (!picked) { try { source = atlasSource(); } catch (e) { source = { kind: 'chat' }; } }
    try { startPlan = picked ? startPlanFor(picked) : sceneStartPlan(); } catch (e) { startPlan = { ok: false, reason: 'error' }; }
    const pack = thePack();
    // The memory is this chat's world's: a memory of another world (the chat's world was changed under it) is not shown over this pack.
    if (!picked && between() && !(pack && source.memory.stores.dooms_world && source.memory.stores.dooms_world.pack === pack.id)) source = { kind: 'chat' };
    const state = theState();
    const cfg = liveWorldConfig(extensionSettings);
    const empty = worldEmptyMessage({ state, pack, cfg, packError: picked ? '' : getPackError(), masterOn: !!extensionSettings.enabled });
    if (empty) { model = null; return { state, pack, cfg, empty }; }
    const world = `${state.pack || ''}|${state.name || ''}`;
    if (layerWorld !== world) { layer = ''; layerWorld = world; }
    model = atlasModel({ pack, state, player: playerName(), book: theBook(), layer });
    layer = model.layer;    // a layer that is gone (deleted, merged away) falls back to the top map
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
    const others = model.all.filter(x => x.id !== m.id).map(x => ({ id: x.id, label: x.label, layerLabel: x.layerLabel, inside: x.inside })).sort((a, b) => a.label.localeCompare(b.label));
    return atlasCardHtml({
        marker: m, mode: cardMode, others,
        distance: describeDistance(model, model.party, m.id),
        canTravel: isLiveWorldOn() && chatOpen() && !between(),    // between scenes there is no chat to travel in: a scene is started instead
        travelling: travelling || !!(pending && pending.kind === 'travel'),
        rumours: said.rumours, news: said.news, portraits: portraitOf,
        canStart: startPlan.ok, sceneNo: startPlan.ok ? startPlan.number : 0,
        draw: drawFor(m),
    });
}

/**
 * Whether a place's picture can be drawn from its card (D195, the old Map
 * window's Draw): a place the story has been to in the chat in front (the
 * picture is described from the scenes there). Not between scenes, where
 * there is no chat to read. null when there is nothing to draw from.
 */
function drawFor(m) {
    if (between() || cardMode !== 'view') return null;
    let row = null;
    try {
        // The place itself; else the room of it the story was last in (the map folds "House - Bedroom" into the house; the row is newest first).
        const rows = getPlacesRow();
        const low = String(m.label || '').toLowerCase();
        row = rows.find(p => p.id === m.id) || rows.find(p => { const first = labelSegments(p.label)[0]; return !!first && first.toLowerCase() === low; }) || null;
    } catch (e) { row = null; }
    if (!row) return null;
    let busy = '';
    let problem = '';
    try { busy = isDrawingPlace() || ''; } catch (e) { busy = ''; }
    try { problem = sourceProblem() || ''; } catch (e) { problem = ''; }
    return { id: row.id, drawn: !!row.drawn, busy: !!busy, mine: busy === row.id, problem };
}

/** A road's card (D165): the places it joins, what it is as drawn, its set time. */
function roadCardFor(route) {
    if (!model) return '';
    const r = model.routes.find(x => (x.a === route.a && x.b === route.b) || (x.a === route.b && x.b === route.a)) || route;
    const scale = model.measure.scale;
    return atlasRoadHtml({
        a: { id: r.a, label: labelOf(r.a) }, b: { id: r.b, label: labelOf(r.b) },
        drawn: describeRoad(model, r.a, r.b),    // on a generated world the ground under the road counts (D185)
        hours: r.hours || 0,
        unit: scale === 'world' || scale === 'region' ? 'days' : 'minutes',
    });
}

/** The world's own picture, when it has one that loads (D154). */
function pictureOf(pack) {
    const m = pack && pack.map;
    if (layer || !m || !m.image || m.image === brokenPicture || theBook().drawn) return null;    // the picture is the top map's; a place's own map is drawn
    const image = safeImageUrl(m.image);
    return image && m.width > 0 && m.height > 0 ? { image, width: m.width, height: m.height } : null;
}

/** The book changed: saved with the chat, everything drawn again. */
function commit(next, word = '') {
    const refused = saveTheBook(next);
    if (refused) { result = refused; render(); return false; }
    result = word;
    render();
    return true;
}

/** The word across the top of the map while something waits for a tap. */
function setHint(text) {
    const $h = $(`${root()} .dooms-atlas-hint`);
    $h.prop('hidden', !text).text(text || '');
}

/** A phone's width (D196): the sidebar and the map take turns at the whole screen there. */
function isPhone() {
    try { return !!(window.matchMedia && window.matchMedia('(max-width: 720px)').matches); } catch (e) { return false; }
}

/**
 * The window the size of the screen, by hand where the stylesheet did not
 * manage it (D196). A fixed window is laid out against the screen unless
 * something above it has taken that place (a transform, a filter): then
 * "the whole screen" in the stylesheet is that thing's box, which on a
 * phone has been seen short. Measured after it is shown; left alone when
 * it already covers the screen.
 */
function fitToScreen() {
    const el = document.querySelector(root());
    if (!el || !isOpen) return;
    for (const p of ['left', 'top', 'width', 'height']) el.style.removeProperty(p);
    const vw = window.innerWidth, vh = window.innerHeight;
    if (!(vw > 0 && vh > 0)) return;
    const r = el.getBoundingClientRect();
    if (Math.abs(r.left) < 2 && Math.abs(r.top) < 2 && Math.abs(r.width - vw) < 3 && Math.abs(r.height - vh) < 3) return;
    el.style.left = `${Math.round(-r.left)}px`;
    el.style.top = `${Math.round(-r.top)}px`;
    el.style.width = `${vw}px`;
    el.style.height = `${vh}px`;
}

function arm(next) {
    armed = next;
    if (armed && isPhone() && !folded) setFolded(true);    // what waits for a tap on the map needs the map in sight
    setHint(!armed ? '' : armed.kind === 'add' ? 'Tap the map where the new marker goes. Esc cancels.' : `Tap the map where ${armed.label} goes. Esc cancels.`);
    $(root()).toggleClass('is-armed', !!armed);
    $(`${root()} .dooms-atlas-tool[data-act="add"]`).toggleClass('is-on', !!armed && armed.kind === 'add');
    $(`${root()} .dooms-atlas-tray-row`).each(function () { $(this).toggleClass('is-armed', !!armed && armed.kind === 'place' && this.getAttribute('data-id') === armed.id); });
}

/** Roads on or off (D164). On: what waited for a tap is let go, the cards close, and a click on a marker picks it. */
function setRoading(on) {
    roading = on ? { first: '' } : null;
    if (on) { arm(null); if (board) board.closeCard(); }
    if (board) board.update({ picking: !!roading, picked: '' });
    $(`${root()} .dooms-atlas-tool[data-act="roads"]`).toggleClass('is-on', !!roading);
    $(root()).toggleClass('is-roading', !!roading);
    setHint(roading ? 'Roads: click a place, then another, to join them. Click two joined places to take their road away. Esc ends.' : '');
}

/** A marker picked while roads are drawn: the first is held; the second makes or takes away the road between the two. */
function pickForRoad(id) {
    if (!roading || !model) return;
    if (!roading.first || roading.first === id) { roading = { first: roading.first === id ? '' : id }; if (board) board.update({ picked: roading.first }); return; }
    const a = roading.first;
    const had = model.routes.some(r => (r.a === a && r.b === id) || (r.a === id && r.b === a));
    roading = { first: '' };
    if (board) board.update({ picked: '' });
    commit(toggleRoad(theBook(), a, id, model), had ? `The road between ${labelOf(a)} and ${labelOf(id)} is gone.` : `A road joins ${labelOf(a)} and ${labelOf(id)}.`);
    setHint('Roads: click a place, then another, to join them. Click two joined places to take their road away. Esc ends.');
}

/** The region whose land a spot of the shown map is on, or '' (D166). */
function landAt(at) {
    return model ? territoryAt(model, at.x, at.y) : '';
}

/**
 * A spot on a region's land, as it is on that region's own map (D168): the same spot while the land lies there as
 * it does here, and the matching spot of the land when it is laid wider, or elsewhere, to hold its places.
 */
function spotInside(into, at) {
    const inner = atlasModel({ pack: thePack(), state: theState(), player: playerName(), book: theBook(), layer: into });
    return inner.layer === into ? spotOnLand(inner.realm, at) : at;
}

/** A place put down at a spot of the shown map: on it, or, when the spot is on a region's land and the place is no region itself, inside that region. */
function putDown(id, at) {
    const item = model ? [...model.tray, ...model.markers].find(x => x.id === id) : null;
    const into = item && item.kind === 'region' ? '' : landAt(at);
    commit(placeAt(theBook(), id, into ? spotInside(into, at) : at, into || layer), into ? `${labelOf(id)} is inside ${labelOf(into)} now: click its land to enter it.` : '');
}

/** The map tapped: what was waiting lands there. */
function tapped(at) {
    if (!armed) return;
    const a = armed;
    arm(null);
    if (a.kind === 'place') { putDown(a.id, at); return; }
    const into = landAt(at);
    const spot = into ? spotInside(into, at) : at;
    const made = addPin(theBook(), { label: 'New place', x: spot.x, y: spot.y, layer: into || layer });
    if (!commit(made.book, into ? `The new place is inside ${labelOf(into)}: this is its map.` : '')) return;
    if (into) setLayer(into);    // put down on a region's land, it is inside that region: its map is shown, the new marker open on its name
    if (!board) return;
    board.open(made.id);    // opening closes any other card, which sets the mode back to reading
    cardMode = 'edit';      // the new marker opens on its name
    board.redrawCard();
}

/** The world whose scenes the Atlas lists (D193): the picked one, the scene in front's, or the chat's own when it is played as scenes. '' when none. */
function hubWorld() {
    try {
        if (!isHubOn()) return '';
        if (picked) return picked;
        const cur = currentScene();
        if (cur) return cur.worldId;
        const st = getWorldState();
        const id = st && st.pack ? String(st.pack) : '';
        return id && worldEntry(id) ? id : '';
    } catch (e) { return ''; }
}

/** Why a scene cannot be started from here, in words; '' when one can. */
function whyNoStart() {
    if (startPlan.ok) return '';
    const sc = startPlan.scene;
    if (startPlan.reason === 'scene-open') return `${sc ? `Scene ${sceneNumber(sc.id)}${sc.title ? ` (${sc.title})` : ''}` : 'A scene'} is open: end it or set it aside first.`;
    if (startPlan.reason === 'not-scenes') return 'This chat\'s world is not played as scenes yet: Play as scenes, at the foot, begins it from here.';
    if (startPlan.reason === 'no-card') return 'This world has no narrator card yet: pick one in Settings → Live World → The Hub.';
    if (startPlan.reason === 'off') return 'Scenes are off: Settings → Live World → The Hub switches them on.';
    return describeStartResult(startPlan);
}

function tabBody({ state, pack, cfg }) {
    // Every line of News and Rumours and every face of People is a way into a scene while one can be started (D193).
    if (tab === 'people') return atlasWaysHtml({ kind: 'person', on: startPlan.ok, number: startPlan.number, body: peopleHtml({ state, pack, portraits: portraitOf, present: between() ? [] : presentNamesFromTracker(), sceneText: sceneFacts().location || '' }) });
    if (tab === 'news') return atlasWaysHtml({ kind: 'news', on: startPlan.ok, number: startPlan.number, body: newsHtml({ state, pack, cfg, feed: feedLimit }) });
    if (tab === 'rumours') return atlasWaysHtml({ kind: 'rumour', on: startPlan.ok, number: startPlan.number, body: rumoursHtml({ state, pack, cfg }) });
    if (tab === 'scenes') {
        const id = hubWorld();
        const entry = id ? worldEntry(id) : null;
        let front = '';
        try { const cur = currentScene(); if (cur && cur.worldId === id) front = cur.mark.scene; } catch (e) { front = ''; }
        return atlasSceneListHtml({ scenes: entry ? entry.scenes : [], plan: startPlan, why: whyNoStart(), front, deleting, busy: deletingNow });
    }
    // Under the hooks, the quests completed in this chat (the old Map window's own panel; the owner kept it, 2026-11-10).
    if (tab === 'hooks') {
        // Between scenes the round is the world's own, in its memory (D193): asked for there, played as a scene, set aside there.
        if (between()) { const st = source.memory.stores; return atlasWorldHooksHtml({ hooks: hubHooks(source.worldId), busy: isHooksBusy(source.worldId), sceneOpen: !!source.open, canStart: startPlan.ok, why: whyNoStart() }) + doneHtml({ done: Array.isArray(st.dooms_quests_done) ? st.dooms_quests_done : [] }); }
        return hooksHtml({ hooks: getHooks(), busy: isProposing() }) + doneHtml({ done: getCompletedQuests() });
    }
    return atlasPlacesHtml({ markers: model ? model.markers : [], tray: model ? model.tray : [], deleted: model ? model.deleted : [], query, hidden, armed: armed && armed.kind === 'place' ? armed.id : '', scale: model ? model.measure.scale : 'town', tidy, all: model ? model.all : [], layer, layerLabel: model ? model.layerLabel : '', ground: model ? model.ground : 'country', world: model ? model.world : null, toName: model && model.world ? landsToName(model).length : 0 });
}

function renderSide(ctx) {
    const $side = $(`${root()} .dooms-atlas-side`);
    if (!$side.length) return;
    const { state, pack, cfg, empty } = ctx;
    const scroll = $(`${root()} .dooms-atlas-body`).scrollTop() || 0;
    const blank = !!pack && pack.id === BLANK_PACK_ID;
    const hub = hubWorld();
    if (tab === 'scenes' && !hub) tab = ATLAS_TABS[0].id;    // the world in front has no scenes to list
    let chatWorld = '';
    try { const st = getWorldState(); const ap = getActivePack(); chatWorld = (st && st.name) || (ap && ap.name) || ''; } catch (e) { chatWorld = ''; }
    let inFront = '';
    try { const cur = currentScene(); inFront = cur ? cur.worldId : ''; } catch (e) { inFront = ''; }
    $side.html(atlasSideHtml({
        scenesTab: !!hub,
        worlds: isHubOn() ? worlds.filter(w => w.id !== inFront) : [],    // the world of the scene in front is "this chat"
        picked, chatWorld,
        name: (state && state.name) || (pack && pack.name) || 'The Atlas',
        facts: sceneFacts(),
        tab,
        body: empty ? '' : tabBody(ctx),
        status: empty ? '' : `${statusLine(state, cfg)}${cfg.spoilerFree ? ' Spoiler-free.' : ''}`,
        result,
        canAdvance: !empty && !between(),
        advancing: isAdvancing(),
        editLabel: blank ? 'Make this a world' : 'Edit this world',
        scenes: !empty && !picked && isHubOn() && !isScene(),    // a chat that is no scene can be taken as where a world's scenes begin (D172)
        ending: picked ? null : (() => { try { const cur = currentScene(); return cur && !cur.ended ? { number: sceneNumber(cur.mark.scene) } : null; } catch (e) { return null; } })(),
        between: between() ? { open: source.open ? { id: source.open.id, number: sceneNumber(source.open.id), title: source.open.title || '' } : null, picked: !!picked, fresh: !!picked && !(source.memory.takenAt > 0) } : null,
        // The last End can be put back, all of it, until the next scene starts (D190).
        undoEnd: picked ? null : (() => { try { const c = canUndoEnd(); if (!c.ok) return null; const cur = currentScene(); const found = cur && cur.scene && Array.isArray(cur.scene.conflicts) ? cur.scene.conflicts.length : 0; return { number: sceneNumber(c.scene), conflicts: found }; } catch (e) { return null; } })(),
    }));
    // Between scenes (D173) there is no chat for the AI to read or to act in: what needs one waits for a scene.
    if (between()) $(`${root()} .dooms-atlas-side`).find('[data-act="setup"], [data-act="fill"], [data-act="tidy"], [data-act="names"]').prop('disabled', true).attr('title', 'Between scenes: this needs a scene being played');
    $(`${root()} .dooms-atlas-body`).scrollTop(scroll);
    $(`${root()} [data-act="edit"]`).prop('disabled', !state || !pack);
    if (undoBook && undoBook.world === worldKey()) $(`${root()} .dooms-atlas-foot-actions`).append(`<button type="button" class="dooms-atlas-btn" data-act="setup-undo" title="Put the map back as it was before the ${undoBook.what === 'world' ? 'world was made' : 'set-up was applied'}"><i class="fa-solid fa-rotate-left" aria-hidden="true"></i> <span>${undoBook.what === 'world' ? 'Undo world gen' : 'Undo set-up'}</span></button>`);
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
        model, picture: pictureOf(ctx.pack), hidden, query, moving, portraits: portraitOf, card: cardFor, road: roadCardFor,
        view: boardView && boardView.world === world ? boardView : null,
        on: {
            scale: setScale,
            open: () => { /* the card's mode was set by whoever opened it */ },
            close: () => { closeFacePopover(); cardMode = 'view'; },
            drop: (id, at) => { arm(null); putDown(id, at); },    // what is dropped on a map belongs to it; on a region's land, to that region
            enter: (id) => enter(id),
            pick: (id) => pickForRoad(id),
            tap: tapped,
            move: (id, at) => commit(placeAt(theBook(), id, at)),
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
    if (setup && setup.world !== worldKey()) { setup = null; renderSetup(); }
    if (undoBook && undoBook.world !== worldKey()) undoBook = null;
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
    // An empty map says how it is made: nothing lands on it by itself (D151). The panel until it is waved away, then a line.
    const bare = model.markers.length === 0;
    const waiting = model.tray.filter(t => t.here !== false).length;
    // A region's own map is not empty: its land is there to be seen (D168), so no panel is laid over it, only the line.
    const showStart = bare && !model.realm && !model.world && !armed && !setup && startDismissed !== `${world}|${layer}`;    // nor over a generated world: its land is there to be seen (D184)
    $(`${root()} .dooms-atlas-start`).prop('hidden', !showStart).html(showStart ? atlasStartHtml({ waiting, loose: model.tray.length - waiting, picture: !!pictureOf(ctx.pack), layerLabel: model.layerLabel }) : '');
    $(`${root()} .dooms-atlas-trail`).prop('hidden', !layer).html(atlasTrailHtml({ world: (ctx.state && ctx.state.name) || (ctx.pack && ctx.pack.name) || 'The world', trail: model.trail }));
    // On a phone with the sidebar put away its foot is out of sight (D196): what an action answered is said over the map instead.
    const said = isPhone() && folded && !setup ? result : '';
    if (roading) { /* the roads' own word stays */ } else if (!armed) setHint((bare && !showStart ? (model.world ? (model.tray.length ? 'The land is made. Drag a region or a place from the list on the left onto it, or press Place all: a region holds the land around where it stands.' : 'The land is made. The pin button above adds a place; a region put on the land holds the land around it.') : model.realm ? `Nothing stands in ${model.layerLabel} yet. ${model.tray.length ? 'Drag a place from the list on the left onto its land, or add one with the pin button above.' : 'The pin button above adds a place to its land.'}` : model.tray.length ? 'Drag a place from the list on the left onto the map, or press Place all.' : 'The pin button above adds a place by hand.') : '') || said);
    // The picture tool shows for a world that has a picture, lit while the picture is the map.
    const hasPicture = !!(ctx.pack && ctx.pack.map && ctx.pack.map.image && ctx.pack.map.image !== brokenPicture);
    $(root()).toggleClass('has-picture', hasPicture);
    $(`${root()} .dooms-atlas-tool[data-act="base"]`).toggleClass('is-on', hasPicture && !theBook().drawn);
    $(root()).toggleClass('is-armed', !!armed);
    $(`${root()} .dooms-atlas-tool[data-act="move"]`).toggleClass('is-on', moving);
}

/** The search typed: the list and the markers follow; the box keeps its caret (the sidebar is not drawn again). */
function searched() {
    $(`${root()} .dooms-atlas-results`).html(atlasResultsHtml({ markers: model ? model.markers : [], query, hidden, all: model ? model.all : [], layer }));
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
    if (isPhone()) setFolded(true);    // the sidebar is the whole screen there: it makes way for the place shown
}

/** The set-up's panel drawn (or put away). */
function renderSetup() {
    const $p = $(`${root()} .dooms-atlas-setup`);
    $(root()).toggleClass('has-sheet', !!setup);    // on a phone the sidebar makes way for a sheet (D196)
    if (!setup) { $p.prop('hidden', true).empty(); return; }
    const scroll = $p.find('.dooms-atlas-setup-list').scrollTop() || 0;
    $p.prop('hidden', false).html(setup.gen ? atlasWorldGenHtml(setup) : setup.naming ? atlasNamesHtml(setup) : setup.end ? atlasEndSceneHtml(setup) : setup.start ? atlasStartSceneHtml(setup) : setup.scenes ? atlasScenesHtml(setup) : setup.fill ? atlasFillHtml({ ...setup, step: setup.step }) : atlasSetupHtml({ ...setup, onMap: model ? model.all.length : 0 }));
    $p.find('.dooms-atlas-setup-list').scrollTop(scroll);
}

// ─── World gen (D182): the land made first ──────────────────────────────────

/** The top map's model, whatever map is shown: World gen is the top map's. */
function topModel() {
    if (model && !model.layer) return model;
    return atlasModel({ pack: thePack(), state: theState(), player: playerName(), book: theBook(), layer: '' });
}

/** The world the panel's choices would make, and its size in words; nothing is changed. */
function planOf(choices) {
    const top = topModel();
    const plan = planWorldGen(theBook(), top, choices);
    // A generated world's map reads at a world's scale unless the player chose another for the top map (D187).
    const unit = top.measure.per / ATLAS_SCALES[top.measure.scale].per;    // what a mile is in the world's unit
    const measure = theBook().scale ? top.measure : { per: ATLAS_SCALES.world.per * unit, unit: top.measure.unit };
    return { plan, reach: plan ? worldReach(plan.spec, measure) : '' };
}

/** The panel opened on the world the map has, or on a first roll for a map with none. */
function openWorldGen() {
    if (!model) return;
    if (board) board.closeCard();
    arm(null);
    if (roading) setRoading(false);
    if (layer) setLayer('');
    const book = theBook();
    const top = topModel();
    const d = worldGenDefaults(book, top);
    const choices = { shape: d.shape, size: d.size, seed: d.seed || randomSeed(), regions: d.regions, mode: d.mode };
    setup = { gen: true, ...choices, state: worldGenState(book, top), ...planOf(choices), error: '', world: worldKey() };
    $(`${root()} .dooms-atlas-start`).prop('hidden', true);
    renderSetup();
}

/**
 * The panel's choices read from the page, and the world they make drawn again: the picture and its line only, so the
 * choices keep the focus and a click on a button that follows a typed seed is not lost to a redraw.
 */
function readWorldGen({ roll = false } = {}) {
    if (!setup || !setup.gen) return;
    const $p = $(`${root()} .dooms-atlas-setup`);
    if (roll) $p.find('.dooms-atlas-wg-seed').val(randomSeed());
    const choices = {
        shape: String($p.find('input[name="dooms-atlas-wg-shape"]:checked').val() || setup.shape),
        size: String($p.find('input[name="dooms-atlas-wg-size"]:checked').val() || setup.size),
        seed: String($p.find('.dooms-atlas-wg-seed').val() ?? setup.seed).trim(),
        regions: Math.max(0, Math.min(24, Math.round(Number($p.find('.dooms-atlas-wg-regions').val())) || 0)),
        mode: String($p.find('input[name="dooms-atlas-wg-mode"]:checked').val() || setup.mode),
    };
    const error = choices.seed ? '' : 'A world needs a seed: type one, or press Roll again.';
    setup = { ...setup, ...choices, ...planOf(choices), error };
    if (!$p.find('.dooms-atlas-worldgen-preview').length) { renderSetup(); return; }
    $p.find('.dooms-atlas-worldgen-preview').html(worldGenFigureHtml(setup));
    $p.find('.dooms-atlas-worldgen-error').html(error ? $('<p class="dooms-atlas-setup-error" role="alert"></p>').text(error) : '');
    $p.find('[data-act="worldgen-apply"]').prop('disabled', !setup.plan);
}

/** The world put under the map as the panel shows it. One Undo puts the map back. */
function applyWorld() {
    if (!setup || !setup.gen || setup.world !== worldKey()) return;
    readWorldGen();    // what the page holds now: a seed typed and not yet left is read too
    const before = theBook();
    const r = applyWorldGen(before, topModel(), { shape: setup.shape, size: setup.size, seed: setup.seed, regions: setup.regions, mode: setup.mode });
    if (!r) { setup = { ...setup, error: 'A world needs a seed: type one, or press Roll again.' }; renderSetup(); return; }
    const shape = (WORLD_SHAPES.find(sh => sh.id === setup.shape) || { label: 'The world' }).label;
    const hadPicture = !!pictureOf(thePack());    // a world with a picture of its own (D154): the generated one is the drawn map's
    setup = null;
    layer = '';
    renderSetup();
    const n = r.added.length;
    const word = [
        `${shape} is made.`,
        n ? `${n} ${n === 1 ? 'region stands' : 'regions stand'} on it under ${n === 1 ? 'a plain name' : 'plain names'}, not canon: "Name the lands" in the list asks the AI for ${n === 1 ? 'a name' : 'names'}, or rename ${n === 1 ? 'it' : 'them'} from ${n === 1 ? 'its card' : 'their cards'}.` : '',
        r.unplaced ? `${r.unplaced} ${r.unplaced === 1 ? 'thing waits' : 'things wait'} in the list to be put down again: drag ${r.unplaced === 1 ? 'it' : 'each'} onto the land, or press Place all.` : '',
        'Turn on moving (the arrows above the map) to drag a region: its borders follow.',
        hadPicture ? 'The world\'s own picture is put away for the drawn map; the picture button above brings it back.' : '',
    ].filter(Boolean).join(' ');
    if (!commit(hadPicture ? withDrawn(r.book, true) : r.book, word)) return;
    undoBook = { world: worldKey(), book: before, what: 'world' };
    render();
    if (board) board.fit();
}

/** The generated world taken away: the map draws its land around its places again. One Undo brings it back. */
function removeWorld() {
    if (!setup || !setup.gen) return;
    const before = theBook();
    setup = null;
    renderSetup();
    if (!commit(withWorld(before, null), 'The generated world is gone: the map draws its land around your regions and places again. They are all kept.')) return;
    undoBook = { world: worldKey(), book: before, what: 'world' };
    render();
    if (board) board.fit();
}

// ─── Naming the lands (D186) ────────────────────────────────────────────────

function openNames() {
    if (!model || between()) return;
    if (board) board.closeCard();
    arm(null);
    if (layer) setLayer('');
    setup = { naming: true, step: 'ask', count: landsToName(topModel()).length, wish: '', names: [], error: '', world: worldKey() };
    renderSetup();
}

async function runNames() {
    if (!setup || !setup.naming) return;
    const world = setup.world;
    const wish = setup.step === 'ask' ? String($(`${root()} .dooms-atlas-names-wish`).val() || '') : setup.wish;
    setup = { ...setup, step: 'busy', wish, error: '' };
    renderSetup();
    const r = await draftNames({ model: topModel(), world: (theState() || {}).name || '', wish });
    if (!setup || !setup.naming || setup.world !== world || worldKey() !== world) return;    // closed, or the chat changed while the AI read
    setup = r.ok ? { ...setup, step: 'review', names: r.names, error: '' } : { ...setup, step: 'ask', error: r.error || 'The names could not be asked for.' };
    renderSetup();
}

function applyNamesNow() {
    if (!setup || !setup.naming || !setup.names.length || setup.world !== worldKey()) return;
    const names = setup.names;
    setup = null;
    renderSetup();
    commit(applyNames(theBook(), names), `${names.length} ${names.length === 1 ? 'land is' : 'lands are'} named. They are still not canon (a dashed border): open one by its badge to rename it, make it canon or delete it.`);
}

// ─── One Undo of the last End (D190) ────────────────────────────────────────

/** The last End put back, all of it: from the End sheet once the scene is ended, or from the sidebar's foot until the next scene starts. */
async function undoEndNow() {
    const can = canUndoEnd();
    if (!can.ok) { result = 'There is no End to undo: the next scene has started, or this is not that scene\'s chat.'; if (setup && setup.end) { setup = null; renderSetup(); } render(); return; }
    if (setup && setup.end) { setup = { ...setup, undoing: true }; renderSetup(); }
    const r = await undoEnd();
    setup = setup && setup.end ? null : setup;
    renderSetup();
    result = r.ok
        ? `The End of scene ${sceneNumber(r.scene)} is undone: the scene is open again, and the record, the world, where people stand, the threads and the ledger are as they were before it.${r.book === 'failed' ? ' The continuity book could not be put back: look it over in the Lore Library.' : ''}`
        : r.reason === 'busy' ? 'A reply is still being written. Try again when it is done.' : `The End could not be undone (${r.error || r.reason || 'unknown'}).`;
    render();
}

// ─── Where the people stand and the threads, on a record's sheet (D188) ────

/**
 * What the sheet holds of the continuity now, read from the page: the people as corrected (one whose line was
 * emptied or crossed out is left as they stood), the new threads as corrected, and the threads still ticked as
 * settled. Null when the sheet showed none (the record said nothing of either): End then keeps what the record said.
 */
function readContinuityFields(shown) {
    if (!shown) return null;
    const $p = $(`${root()} .dooms-atlas-setup`);
    const people = [];
    $p.find('.dooms-atlas-cont-person').each(function () { const name = String(this.getAttribute('data-name') || ''); const now = String($(this).find('.dooms-atlas-cont-now').val() || '').trim(); if (name && now) people.push({ name, now }); });
    const opened = [];
    $p.find('.dooms-atlas-cont-thread.is-new').each(function () { const text = String($(this).find('.dooms-atlas-cont-thread-text').val() || '').trim(); if (text) opened.push({ key: String(this.getAttribute('data-key') || ''), text }); });
    const closed = [];
    $p.find('.dooms-atlas-cont-closed:checked').each(function () { closed.push(String($(this).val() || '')); });
    return { people, opened, closed };
}

/** The sheet's continuity as the page has it, in the shape the sheet is drawn from (so a redraw keeps what was typed). */
function continuityShown(shown, read) {
    if (!shown || !read) return shown;
    const was = (name) => (shown.people.find(p => p.name === name) || { was: '' }).was;
    const closed = new Set(read.closed);
    return { ...shown, people: read.people.map(p => ({ ...p, was: was(p.name) })), opened: read.opened, closed: shown.closed.filter(t => closed.has(t.id)), open: shown.open + shown.closed.filter(t => !closed.has(t.id)).length };
}

/** What End (or Play as scenes) is handed: the people, the new threads' texts, the ids of the threads settled. */
const continuityChange = (read) => (read ? { people: read.people, opened: read.opened.map(t => t.text), closed: read.closed } : undefined);

// ─── Starting a scene from a place (D174) ───────────────────────────────────

/** The sheet opened for a marker: who the world last saw there ticked, the time counted from the journey on the map. */
/** The places a scene can open at, for the sheet's Where (D193): every place on any map by its name, with the map it is on. */
function placesForStart() {
    if (!model) return [];
    return model.all.map(x => ({ id: x.id, label: x.label, where: x.layerLabel || '' })).sort((p, q) => p.label.localeCompare(q.label));
}

/** The people the sheet offers: everyone the world knows, those last seen at the place first. */
function peopleFor(placeId) {
    const state = theState();
    const m = placeId && model ? model.all.find(x => x.id === placeId) : null;
    const here = new Set(m ? m.people || [] : []);
    return Object.keys((state && state.known) || {}).map(name => ({ name, here: here.has(name) })).sort((p, q) => Number(q.here) - Number(p.here) || p.name.localeCompare(q.name));
}

/** What the map says of the way to a place on the map in front, and the time that way takes: nothing for a place on another map. */
function wayTo(placeId) {
    const m = placeId && model ? model.markers.find(x => x.id === placeId) : null;
    const from = m && model.party && model.party !== m.id ? model.markers.find(x => x.id === model.party) : null;
    const journey = from ? describeJourney(model, from.id, m.id) : '';
    // The party on this map: the time is the journey's. Elsewhere, or already here: the setting's own.
    const gap = from ? journeyGap(model, from.id, m.id) : m && m.player ? gapOf('now') : gapOf(hubConfig(extensionSettings).gap);
    return { from, journey, gap };
}

/**
 * The sheet a scene is started from (D174, D193). `id` is a marker of the
 * map in front (a place's own card): the place is that one. Without it
 * the sheet has a Where to choose: opened from a person (`seed.kind`
 * 'person', with `place` where they were last seen), a rumour, a line of
 * news, a hook, an earlier scene to go on from, or nothing at all.
 */
function openSceneStart({ id = '', seed = null, place = null, cast = null } = {}) {
    if (!model || !startPlan.ok) return;
    const m = id ? model.markers.find(x => x.id === id) : null;
    if (id && !m) return;
    if (board) board.closeCard();
    closeFacePopover();
    arm(null);
    const known = (pid) => (pid ? model.all.find(x => x.id === pid) : null);
    const at = m ? { id: m.id, label: m.label }
        : place && place.id && known(place.id) ? { id: place.id, label: known(place.id).label }
        : place && place.label ? { id: '', label: String(place.label) }
        : { id: '', label: '' };
    const people = peopleFor(at.id);
    const way = wayTo(at.id);
    const asked = Array.isArray(cast) ? cast.map(n => String(n || '').trim()).filter(Boolean) : [];
    const sd = seed && typeof seed === 'object' ? seed : null;
    setup = {
        start: true, step: 'form', worldId: startPlan.worldId, sceneNo: startPlan.number, card: startPlan.card,
        place: at, people, cast: asked.length ? asked.filter(n => people.some(p => p.name === n)) : people.filter(p => p.here).map(p => p.name),
        extra: asked.filter(n => !people.some(p => p.name === n)).join(', '),
        places: m ? null : placesForStart(), whereNew: !at.id && at.label ? at.label : '',
        seed: sd, from: sd && sd.kind && !['place', 'anywhere'].includes(sd.kind) ? { kind: sd.kind, label: sd.label || '' } : null,
        gap: way.gap, journey: way.journey,
        seedText: sd && sd.text ? String(sd.text) : (way.from && way.journey ? `The party came here from ${way.from.label}: ${way.journey}.` : ''),
        note: '', error: '', pending: null, world: worldKey(),
    };
    $(`${root()} .dooms-atlas-start`).prop('hidden', true);
    renderSetup();
}

/** A person as a way in (D193): the sheet with them ticked, at the place they were last seen. */
function startWithPerson(name) {
    const who = String(name || '').trim();
    if (!who || !model) return;
    const m = model.all.find(x => (x.people || []).includes(who));
    openSceneStart({ seed: { kind: 'person', label: who, text: '' }, place: m ? { id: m.id, label: m.label } : null, cast: [who] });
}

/** A line of News or of Rumours as a way in (D193): what it says is what brings the party; a rumour opens at the place its clock stands at. */
function startFromLine(kind, text, index = -1) {
    const said = String(text || '').trim();
    if (!said) return;
    let place = null;
    if (kind === 'rumour') {
        // The line carries its place in the list, never the clock's name: spoiler-free keeps that out of the page.
        try {
            const pack = thePack();
            const effect = publicEffects(theState(), pack)[index];
            const clock = effect ? pack.clocks.find(c => c.id === effect.id) : null;
            if (clock && clock.place) place = { id: clock.place, label: '' };
        } catch (e) { place = null; }
    }
    openSceneStart({ seed: { kind, label: '', text: said }, place });
}

/** What the sheet holds now, read from the page. */
function readSceneForm() {
    const $p = $(`${root()} .dooms-atlas-setup`);
    const cast = [];
    $p.find('input[name="dooms-atlas-cast"]:checked').each(function () { cast.push(String($(this).val() || '')); });
    const extra = String($p.find('.dooms-atlas-scene-who').val() || '');
    for (const n of extra.split(',')) { const t = n.trim(); if (t && !cast.some(c => c.toLowerCase() === t.toLowerCase())) cast.push(t); }
    const gap = gapOf(String($p.find('input[name="dooms-atlas-gap"]:checked').val() || 'now'), String($p.find('.dooms-atlas-scene-when').val() || ''));
    // Where: the place's own card gives it; else what the sheet's Where says (a place of a map, one typed in, or where the story left off).
    let place = setup && setup.place ? setup.place : { id: '', label: '' };
    let whereNew = '';
    if (setup && setup.places) {
        const sel = String($p.find('.dooms-atlas-scene-where').val() || '');
        if (sel === '__new__') { whereNew = String($p.find('.dooms-atlas-scene-where-new').val() || '').trim(); place = { id: '', label: whereNew }; }
        else if (sel) { const x = setup.places.find(y => y.id === sel); place = { id: sel, label: x ? x.label : sel }; }
        else place = { id: '', label: '' };
    }
    return { cast, extra, gap, place, whereNew, seedText: String($p.find('.dooms-atlas-scene-seed').val() || '').trim(), note: String($p.find('.dooms-atlas-scene-note').val() || '').trim() };
}

/** Another place chosen in the sheet's Where: who was last seen there is ticked, and the way there is the map's when it can tell. What was typed stays. */
function sceneWhereChanged() {
    if (!setup || !setup.start || setup.step !== 'form' || !setup.places) return;
    const f = readSceneForm();
    const people = peopleFor(f.place.id);
    const way = wayTo(f.place.id);
    const moved = f.place.id !== setup.place.id;
    const cast = moved ? [...new Set([...f.cast.filter(n => people.some(p => p.name === n) && !(setup.people.find(p => p.name === n) || {}).here), ...people.filter(p => p.here).map(p => p.name)])] : f.cast.filter(n => people.some(p => p.name === n));
    setup = { ...setup, ...f, people, cast, journey: way.journey, gap: moved && way.from ? way.gap : f.gap };
    renderSetup();
    const $new = $(`${root()} .dooms-atlas-scene-where-new`);
    if ($new.length && !$new.prop('hidden')) $new.trigger('focus');
}

/** Three openings asked for; the sheet shows them to pick from. Nothing is started yet. */
async function writeOpenings() {
    if (!setup || !setup.start || setup.step !== 'form') return;
    const f = readSceneForm();
    // The people ticked and the ones typed in are kept apart on the sheet, so a step back shows them as they were entered.
    setup = { ...setup, ...f, cast: f.cast.filter(n => setup.people.some(p => p.name === n)), step: 'busy', error: '' };
    renderSetup();
    // What the scene comes from rides with it (a hook played is taken as its quest); its text is the player's to change.
    const seed = setup.seed ? { ...setup.seed, text: f.seedText } : f.place.id ? { kind: 'place', id: f.place.id, label: f.place.label, text: f.seedText } : { kind: 'anywhere', label: '', text: f.seedText };
    const p = await prepareScene({ worldId: setup.worldId, seed, place: f.place.id || f.place.label ? f.place : null, cast: f.cast, gap: f.gap, note: f.note });
    if (!setup || !setup.start) { cancelStart(); return; }    // the sheet was closed meanwhile
    if (!p.ok) { setup = { ...setup, step: 'form', error: describeStartResult(p) }; renderSetup(); return; }
    setup = { ...setup, step: 'pick', pending: pendingStart() || p, error: p.errors && p.errors.length ? p.errors.join(' ') : '' };
    renderSetup();
}

/** The scene started with one of the openings, or the player's own: its chat is written and opened, and the Atlas makes way for it. */
async function openWith(choice, ownText = '') {
    const pending = pendingStart();
    if (!setup || !setup.start || setup.step !== 'pick' || !pending) return;
    const keep = setup;
    setup = { ...setup, step: 'opening', error: '' };
    renderSetup();
    const r = await commitScene(pending.token, { choice, ownText });
    if (!r.ok) { if (setup && setup.start) { setup = { ...keep, step: 'pick', error: describeStartResult(r) }; renderSetup(); } return; }
    setup = null;
    renderSetup();
    closeAtlas();
}

async function askOpeningsAgain() {
    const pending = pendingStart();
    if (!setup || !setup.start || setup.step !== 'pick' || !pending) return;
    const own = String($(`${root()} .dooms-atlas-scene-own`).val() || '');
    setup = { ...setup, step: 'busy', error: '' };
    renderSetup();
    const r = await askOpenersAgain(pending.token);
    if (!setup || !setup.start) return;
    setup = { ...setup, step: 'pick', pending: pendingStart() || setup.pending, error: r.ok ? '' : (r.errors ? r.errors.join(' ') : describeStartResult(r)) };
    renderSetup();
    if (own) $(`${root()} .dooms-atlas-scene-own`).val(own);
}

// ─── Ending the scene in front (D176) ───────────────────────────────────────

const endRunning = () => !!(setup && setup.end && (setup.busy || setup.going || Object.values(setup.states || {}).includes('running')));

/** The End sheet opened: the record of the scene is written (one to four requests) and shown to be corrected. Nothing is ended yet. */
async function openEndScene() {
    if (board) board.closeCard();
    arm(null);
    const cur = currentScene();
    if (!cur) { result = 'This chat is not a scene, so there is nothing to end.'; render(); return; }
    setup = { end: true, prep: { scene: cur.scene, mark: cur.mark }, busy: true, states: {}, result: null, error: '', world: worldKey() };
    $(`${root()} .dooms-atlas-start`).prop('hidden', true);
    renderSetup();
    const p = await prepareEnd();
    if (!setup || !setup.end) return;    // the sheet was closed meanwhile
    if (!p.ok) { setup = { ...setup, prep: null, busy: false, error: describeEndResult(p) }; renderSetup(); return; }
    setup = { ...setup, prep: p, busy: false };
    renderSetup();
}

/** The scene ended: the record kept, the ledger read, the chat's stores made the world's memory, the world moved on. Each part's state is shown as it runs. */
async function endSceneGo({ thenContinue = false } = {}) {
    if (!setup || !setup.end || !setup.prep || endRunning()) return;
    const $p = $(`${root()} .dooms-atlas-setup`);
    const recap = String($p.find('.dooms-atlas-end-recap').val() || '').trim();
    const skipCanon = $p.find('.dooms-atlas-end-skip-canon').is(':checked');
    const skipWorld = thenContinue || $p.find('.dooms-atlas-end-skip-world').is(':checked');    // going straight on, no time passes: the world is not moved (D181)
    const replaceMemory = $p.find('.dooms-atlas-end-replace').is(':checked');
    const cont = readContinuityFields(setup.prep.continuity);    // where the people stand and the threads, as corrected on the sheet (D188)
    // The phrases ticked on the sheet are the ones held against the next scenes (D179); with no count on the sheet, End chooses by itself.
    const counted = setup.prep.style && Array.isArray(setup.prep.style.phrases) ? setup.prep.style.phrases : null;
    const bans = counted ? [] : null;
    if (counted) $p.find('.dooms-atlas-end-ban:checked').each(function () { bans.push({ phrase: String($(this).val() || ''), kind: this.getAttribute('data-kind') === 'address' ? 'address' : 'phrase', count: Number(this.getAttribute('data-count')) || 0 }); });
    const chosen = new Set((bans || []).map(b => b.phrase));
    const keep = !!setup.prep.stale && !replaceMemory;
    const steps = setup.prep.steps || {};
    const states = { recap: recap ? 'ok' : 'skipped', canon: steps.canon ? (skipCanon ? 'skipped' : 'waiting') : 'off', world: steps.world ? (keep ? 'kept' : skipWorld ? 'skipped' : 'waiting') : 'off', snapshot: keep ? 'kept' : 'waiting', book: 'waiting' };
    setup = { ...setup, prep: { ...setup.prep, recap, continuity: continuityShown(setup.prep.continuity, cont), ...(counted ? { style: { ...setup.prep.style, phrases: counted.map(h => ({ ...h, ticked: chosen.has(h.phrase) })) } } : {}) }, states, error: '' };
    renderSetup();
    const onStep = (name, state) => { if (setup && setup.end) { setup = { ...setup, states: { ...setup.states, [name]: state } }; renderSetup(); } };
    const r = await commitEnd({ recap, skipRecap: !recap, skipCanon, skipWorld, replaceMemory, onStep, bans, continuity: continuityChange(cont), conflicts: Array.isArray(setup.prep.conflicts) ? setup.prep.conflicts : undefined });
    if (!setup || !setup.end) return;
    if (!r.ok) { setup = { ...setup, states: { ...setup.states, snapshot: 'failed' }, error: describeEndResult(r) }; renderSetup(); return; }
    setup = { ...setup, result: r, states: { ...setup.states, canon: r.canon === 'ok' ? 'ok' : r.canon === 'failed' ? 'failed' : setup.states.canon, world: ['ok', 'failed', 'kept', 'skipped'].includes(r.world) ? r.world : setup.states.world, snapshot: r.snapshot === 'kept' ? 'kept' : 'ok', book: r.book === 'ok' ? 'ok' : r.book === 'failed' ? 'failed' : 'off' }, prep: { ...setup.prep, book: r.bookResult && r.bookResult.name ? r.bookResult.name : setup.prep.book } };
    result = describeEndResult(r);
    setup = { ...setup, canUndo: !thenContinue && canUndoEnd().ok };    // one Undo puts the End back, all of it (D190)
    render();    // the chat in front is an ended scene now: the map shows the world as it stands
    renderSetup();
    if (!thenContinue) return;
    // End and continue here (D181): the next scene opened straight on from this one, its first opening taken as it comes.
    setup = { ...setup, error: '', going: 'Writing how the next scene opens…' };
    renderSetup();
    const c = await continueScene({ onStep: (word) => { if (setup && setup.end) { setup = { ...setup, going: word }; renderSetup(); } } });
    if (!setup || !setup.end) return;
    if (!c.ok) { setup = { ...setup, going: '', error: c.reason === 'openers' ? 'The scene is ended, but no opening came back for the next one. Open a place on the map and press Start scene here.' : `The scene is ended, but the next one could not be opened (${c.reason}). Open a place on the map and press Start scene here.` }; renderSetup(); return; }
    setup = null;
    renderSetup();
    closeAtlas();    // the next scene's chat is in front
}

// ─── Playing the story as scenes (D172) ─────────────────────────────────────

/** The panel opened: what playing this chat as scenes would do, or why it cannot be. Nothing is asked for yet. */
function openScenes() {
    if (board) board.closeCard();
    arm(null);
    setup = { scenes: true, step: 'ask', plan: scenesPlan(), recap: '', error: '', replace: false, result: null, messages: 0, world: worldKey() };
    $(`${root()} .dooms-atlas-start`).prop('hidden', true);
    renderSetup();
}

/** The record of the chat so far asked for; the panel shows it for the player to read and correct. */
async function prepareScenes() {
    if (!setup || !setup.scenes) return;
    setup = { ...setup, step: 'busy', error: '' };
    renderSetup();
    const r = await prepareAdopt();
    if (!setup || !setup.scenes) return;    // the panel was closed meanwhile
    if (!r.ok) { setup = { ...setup, step: 'ask', plan: r.reason === 'busy' || r.reason === 'changed' ? setup.plan : r, error: r.reason === 'busy' || r.reason === 'changed' ? scenesRefusalText(r) : '' }; renderSetup(); return; }
    setup = { ...setup, step: 'review', plan: r.plan, recap: r.recap, messages: r.messages, continuity: r.continuity || null, error: r.error ? `The record could not be written (${r.error}). Write a few lines yourself, or leave it empty.` : '' };
    renderSetup();
}

/** The chat taken: the world made or found, the chat carried over, its stores the world's memory. */
async function commitScenes() {
    if (!setup || !setup.scenes || setup.step !== 'review') return;
    const recap = String($(`${root()} .dooms-atlas-scenes-recap`).val() ?? setup.recap);
    const replace = $(`${root()} .dooms-atlas-scenes-replace`).is(':checked');
    const cont = readContinuityFields(setup.continuity);
    setup = { ...setup, recap, replace, continuity: continuityShown(setup.continuity, cont) };
    const r = await commitAdopt({ recap, replace, continuity: continuityChange(cont) || null });
    if (!setup || !setup.scenes) return;
    if (!r.ok) { setup = { ...setup, error: r.reason === 'has-memory' ? 'Tick the box to replace what it remembers.' : scenesRefusalText(r) }; renderSetup(); return; }
    result = `${r.worldName} is played as scenes now.`;
    render();    // the chat is on the world now: the name, the map and the lists are read again
    setup = { ...setup, step: 'done', result: r, error: '', world: worldKey() };
    renderSetup();
}

function openSetup() {
    if (board) board.closeCard();
    arm(null);
    let cost = { messages: 0, parts: 0, skipped: 0 };
    try { cost = setupReach(); } catch (e) { /* no chat */ }
    setup = { step: 'notes', notes: setup && setup.notes ? setup.notes : '', reach: 'recent', cost, progress: { done: 0, total: 1, word: '' }, draft: null, error: '', note: '', world: worldKey() };
    $(`${root()} .dooms-atlas-start`).prop('hidden', true);
    renderSetup();
}

/** Fill out this map (D160): the panel opened on what the player wants more of. */
function openFill() {
    if (!model) return;
    if (board) board.closeCard();
    arm(null);
    const fo = fillOptions(model);
    setup = { fill: true, step: 'ask', options: fo.options, what: fo.options[0], homeNeeded: fo.home, homeHolds: model.markers.filter(m => m.kind !== 'region').length + model.tray.filter(t => t.here !== false && t.kind !== 'region').length, home: '', wish: '', count: 8, places: [], error: '', world: worldKey(), layer, mapLabel: model.layerLabel || (theState() || {}).name || 'this map' };
    $(`${root()} .dooms-atlas-start`).prop('hidden', true);
    renderSetup();
}

async function runFill() {
    if (!setup || !setup.fill || !model) return;
    const world = setup.world;
    const asking = setup.step === 'ask';
    const wish = asking ? String($(`${root()} .dooms-atlas-fill-wish`).val() || '') : setup.wish;
    const count = asking ? Number($(`${root()} .dooms-atlas-fill-count`).val()) || 8 : setup.count;
    const picked = asking ? String($(`${root()} input[name="dooms-atlas-fill-what"]:checked`).val() || '') : '';
    const what = picked && setup.options.includes(picked) ? picked : setup.what;
    setup = { ...setup, step: 'busy', wish, count, what, error: '' };
    renderSetup();
    const r = await draftFill({ model, world: (theState() || {}).name || '', wish, count, what });
    if (!setup || !setup.fill || setup.world !== world || worldKey() !== world) return;    // closed, or the chat changed while the AI wrote
    setup = r.ok ? { ...setup, step: 'review', places: r.places, home: r.home || '', error: '' } : { ...setup, step: 'ask', error: r.error || 'The suggestions could not be asked for.' };
    renderSetup();
}

function applyFillNow() {
    if (!setup || !setup.fill || !setup.places.length || setup.world !== worldKey() || !model) return;
    if (setup.layer !== layer) { setup = { ...setup, error: 'The map shown is not the one these were suggested for. Cancel, and fill out this map again.' }; renderSetup(); return; }
    const regions = setup.what === 'regions';
    const home = regions && setup.homeNeeded ? (String($(`${root()} .dooms-atlas-fill-home`).val() || '').trim() || setup.home || 'The Heartland') : '';
    const r = applyFill(theBook(), model, setup.places, { home });
    const n = r.ids.length;
    setup = null;
    renderSetup();
    const word = regions
        ? `${n} ${n === 1 ? 'region' : 'regions'} added${home ? ` around ${home}. The places that were on this map are inside ${home} now: click its land to enter it` : ''}. They are not canon (a dashed border): open one by its badge to edit it, make it canon or delete it.`
        : `${n} ${n === 1 ? 'place' : 'places'} added, marked as not canon (a dashed ring). Open one to edit it, make it canon or delete it.`;
    if (commit(r.book, word) && board) board.fit();
}

async function runSetup() {
    if (!setup || !model) return;
    const world = setup.world;
    const notes = String($(`${root()} .dooms-atlas-setup-notes`).val() || '');
    const reach = String($(`${root()} input[name="dooms-atlas-reach"]:checked`).val() || 'recent') === 'full' ? 'full' : 'recent';
    setup = { ...setup, step: 'busy', notes, reach, error: '', progress: { done: 0, total: reach === 'full' ? setup.cost.parts + 1 : 1, word: reach === 'full' ? 'Reading the chat…' : 'Drafting the places' } };
    renderSetup();
    // The draft is asked for from the top map's model: every place on every map is in its list whatever map is shown.
    const r = await draftSetup({ notes, reach, model, world: (theState() || {}).name || '', onProgress: (p) => { if (setup && setup.step === 'busy') { setup = { ...setup, progress: p }; renderSetup(); } } });
    if (!setup || setup.world !== world || worldKey() !== world) return;    // closed, or the chat changed while the AI read
    if (!r.ok) { setup = { ...setup, step: 'notes', error: r.reason === 'stopped' ? '' : (r.error || 'The draft could not be made.') }; renderSetup(); return; }
    const missed = reach === 'full' ? setup.cost.parts - r.parts : 0;
    setup = { ...setup, step: 'review', draft: r.draft, error: '', note: [missed > 0 ? `${missed} ${missed === 1 ? 'part' : 'parts'} of the chat could not be read and ${missed === 1 ? 'was' : 'were'} left out.` : '', r.skipped ? `The oldest ${r.skipped} messages were left out: the chat is longer than can be read.` : ''].filter(Boolean).join(' ') };
    renderSetup();
}

function applyDraft() {
    if (!setup || !setup.draft || setup.world !== worldKey()) return;
    const before = theBook();
    const r = applySetup(setup.draft, before);
    undoBook = { world: worldKey(), book: before };
    setup = null;
    layer = '';
    startDismissed = '';
    renderSetup();
    if (!commit(r.book, `The world is set up: ${r.placed} ${r.placed === 1 ? 'place' : 'places'} on ${r.placed === 1 ? 'its map' : 'their maps'}${r.merged ? `, ${r.merged} old ${r.merged === 1 ? 'entry' : 'entries'} merged in` : ''}${r.dropped ? `, ${r.dropped} deleted` : ''}. Double-click a place to enter it; turn on moving to drag things where they belong.`)) return;
    if (board) board.fit();
}

/** Another map shown (D156): the place's own, or '' for the top map. The cards and what waited for a tap are let go; the new map is fitted. */
function setLayer(id) {
    if (roading) setRoading(false);
    if (board) board.closeCard();
    arm(null);
    cardMode = 'view';
    layer = String(id || '');
    result = '';
    render();
    if (board) board.fit();
}

/** A place entered: its own map. */
function enter(id) {
    if (!model || !model.all.some(x => x.id === id)) return;
    setLayer(id);
}

/** A place shown wherever it is: its map first, then the marker. */
function showAnywhere(id) {
    const m = model ? model.all.find(x => x.id === id) : null;
    if (!m || !m.placed) return false;
    if (m.layer !== layer) setLayer(m.layer);
    showMarker(id);
    return true;
}

/** A person's card by their face: where they have been, Show the place, and a scene with them while one can be started (D193). Of the world shown, not only the chat's. */
function openFace(anchor, name) {
    return openFacePopover(anchor, name, { onBoard: showPlaceOf, onStart: startPlan.ok ? startWithPerson : null, startLabel: startPlan.ok ? `Start scene ${startPlan.number} with them` : '', state: theState(), pack: thePack() });
}

/** The worlds that can be picked (D194): every world of the player's own, by its name, with the card that narrates it. Read when the Atlas opens and when a card is bound. */
async function refreshWorlds() {
    const token = ++worldsToken;
    let ids = [];
    try { ids = isHubOn() ? hubWorldIds() : []; } catch (e) { ids = []; }
    const out = [];
    for (const id of ids) {
        let name = id;
        try { const r = await loadPack(id); if (r && r.ok && r.pack && r.pack.name) name = r.pack.name; } catch (e) { /* its id stands */ }
        let card = null;
        try { card = cardOf(id); } catch (e) { card = null; }
        out.push({ id, name, card: card ? card.name : '' });
    }
    if (token !== worldsToken) return;
    const changed = JSON.stringify(out) !== JSON.stringify(worlds);
    worlds = out;
    if (changed && isOpen) render();
}

let pickToken = 0;
/**
 * Another world shown (D194): '' for the chat's own. A picked world is
 * drawn from its memory, as between scenes, whatever chat is in front; a
 * scene of it is started from here. What was open over the map is let go.
 */
async function pickWorld(id) {
    const next = String(id || '');
    if (endRunning() || (setup && (setup.step === 'busy' || setup.step === 'opening'))) { render(); return; }    // something is being written: the choice goes back to what it was
    const token = ++pickToken;
    let pack = null;
    if (next) {
        let r = null;
        try { r = await loadPack(next); } catch (e) { r = null; }
        if (token !== pickToken || !isOpen) return;
        if (!r || !r.ok || !r.pack) { result = 'That world could not be loaded.'; render(); return; }
        pack = r.pack;
    }
    if (setup) { if (setup.start) cancelStart(); setup = null; renderSetup(); }
    if (roading) setRoading(false);
    if (board) board.closeCard();
    closeFacePopover();
    arm(null);
    picked = next;
    pickedPack = pack;
    deleting = '';
    layer = '';
    result = '';
    render();
    if (next) { try { await refreshScenes(next); } catch (e) { /* the list stands as it is */ } }
}

/** A character's place shown on the map: the face popover's Show the place. */
function showPlaceOf(name) {
    closeFacePopover();
    if (!model) return;
    const m = model.all.find(x => (x.people || []).includes(name));
    if (!m || !m.placed) { result = `${name} is nowhere on a map yet.`; render(); return; }
    result = '';
    showAnywhere(m.id);
}

/** The chat's world, as a key: what a kept view and a clean-up's proposals belong to. */
function worldKey() {
    const st = theState();
    return st ? `${st.pack || ''}|${st.name || ''}` : '';
}

function labelOf(id) {
    const m = model ? [...model.all, ...model.deleted].find(x => x.id === id) : null;
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
        const ok = await startTravelCut({ place: m.label, placeId: m.id, when, journey: describeJourney(model, model.party, m.id) });    // how long the map says it takes, told to the story (D165)
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
            if (act === 'party') { if (!(model && model.partyId && showAnywhere(model.partyId))) { result = 'The party is nowhere on a map yet.'; render(); } return; }
            if (act === 'layer') { setLayer(this.getAttribute('data-id') || ''); return; }
            if (act === 'enter') { ev.stopPropagation(); enter(this.getAttribute('data-id') || ''); return; }
            if (act === 'tab') { closeFacePopover(); deleting = ''; const next = this.getAttribute('data-tab') || ''; if (next !== tab) { tab = ATLAS_TABS.some(t => t.id === next) ? next : ATLAS_TABS[0].id; keep(TAB_KEY, tab); render(); } return; }
            if (act === 'kind') { const k = this.getAttribute('data-kind') || ''; setHidden(hidden.includes(k) ? hidden.filter(x => x !== k) : [...hidden, k]); return; }
            if (act === 'kinds-on') { setHidden([]); return; }
            if (act === 'kinds-off') { setHidden(ATLAS_KINDS.map(k => k.id)); return; }
            if (act === 'goto') { if (this.hasAttribute('data-layer')) showAnywhere(this.getAttribute('data-id') || ''); else showMarker(this.getAttribute('data-id') || ''); return; }
            // The markers (D145, D151): placed, made, moved, edited, merged, taken off, deleted, brought back.
            const id = this.getAttribute('data-id') || '';
            if (act === 'arm') { const t = model ? model.tray.find(x => x.id === id) : null; arm(t && !(armed && armed.kind === 'place' && armed.id === id) ? { kind: 'place', id, label: t.label } : null); return; }
            if (act === 'roads') { setRoading(!roading); return; }
            if (act === 'add') { if (roading) setRoading(false); arm(armed && armed.kind === 'add' ? null : { kind: 'add' }); $(`${root()} .dooms-atlas-start`).prop('hidden', true); return; }
            // A person or a new thread crossed off a record's sheet (D188): the row goes; what else was typed stays.
            if (act === 'cont-drop') { $(this).closest('li').remove(); return; }
            // World gen (D182) and the names of its lands (D186).
            if (act === 'worldgen') { openWorldGen(); return; }
            if (act === 'worldgen-roll') { readWorldGen({ roll: true }); return; }
            if (act === 'worldgen-apply') { applyWorld(); return; }
            if (act === 'worldgen-remove') { removeWorld(); return; }
            if (act === 'names') { openNames(); return; }
            if (act === 'names-draft' || act === 'names-again') { await runNames(); return; }
            if (act === 'names-remove') { if (setup && setup.naming) { const nid = this.getAttribute('data-id') || ''; setup = { ...setup, names: setup.names.filter(n => n.id !== nid) }; renderSetup(); } return; }
            if (act === 'names-apply') { applyNamesNow(); return; }
            // Setting up the world (D159).
            if (act === 'setup') { openSetup(); return; }
            if (act === 'scene-go') {
                const id = this.getAttribute('data-id') || '';
                if (!between() || !id) return;
                const r = await openSceneChat(source.worldId, id);
                if (!r.ok) { result = 'That scene\'s chat could not be opened.'; render(); }
                return;    // opened, the chat change draws the Atlas again from the scene
            }
            if (act === 'scenes') { openScenes(); return; }
            if (act === 'scenes-prepare' || act === 'scenes-again') { await prepareScenes(); return; }
            if (act === 'scenes-go') { await commitScenes(); return; }

            if (act === 'setup-close') { if (endRunning()) return; if (setup && setup.start) cancelStart(); setup = null; renderSetup(); render(); return; }
            if (act === 'end-scene') { await openEndScene(); return; }
            if (act === 'end-go') { await endSceneGo(); return; }
            if (act === 'end-undo') { await undoEndNow(); return; }
            if (act === 'end-continue') { await endSceneGo({ thenContinue: true }); return; }
            if (act === 'scene-start') { ev.stopPropagation(); openSceneStart({ id: this.getAttribute('data-id') || '' }); return; }
            // The Scenes tab (D193): a scene started from the sheet alone, and what can be done with each scene of the world.
            if (act === 'scene-new') { openSceneStart({}); return; }
            const sid = this.getAttribute('data-id') || '';
            if (act === 'sc-resume' || act === 'sc-open') {
                const world = hubWorld();
                const r = act === 'sc-resume' ? await resumeScene(world, sid) : await openSceneChat(world, sid);
                if (r.ok) closeAtlas(); else { result = describeStartResult(r); render(); }
                return;
            }
            if (act === 'sc-end') {
                // A scene whose chat is not in front is opened first: End reads the chat. The Atlas then shows that chat's world.
                const world = hubWorld();
                let cur = null;
                try { cur = currentScene(); } catch (e) { cur = null; }
                if (!cur || cur.worldId !== world || cur.mark.scene !== sid) {
                    const r = await resumeScene(world, sid);
                    if (!r.ok) { result = describeStartResult(r); render(); return; }
                    picked = ''; pickedPack = null;
                    render();
                }
                await openEndScene();
                return;
            }
            // Delete (D197): asked for, then confirmed on the scene's own row; the record and the chat go together.
            if (act === 'sc-delete') { deleting = sid; render(); return; }
            if (act === 'sc-delete-no') { deleting = ''; render(); return; }
            if (act === 'sc-delete-go') {
                if (deletingNow) return;
                const world = hubWorld();
                deleting = '';
                deletingNow = sid;
                result = '';
                render();
                let r = null;
                try { r = await deleteScene(world, sid); } catch (e) { r = { ok: false, reason: 'error', error: String(e && e.message || e) }; }
                deletingNow = '';
                // The scene in front was deleted and another chat is open in its place: the Atlas stays on the world whose scene it was.
                if (r && r.ok && r.opened) { try { await pickWorld(world); } catch (e) { /* the chat's own world is shown */ } }
                result = describeDeleteResult(r);
                render();
                return;
            }
            if (act === 'sc-aside') { result = setSceneAside(hubWorld(), sid) ? 'Set aside: nothing of it is remembered until it is ended. Another scene can be started.' : 'That scene could not be set aside.'; render(); return; }
            if (act === 'sc-remove') { removeGoneScene(hubWorld(), sid); render(); return; }
            if (act === 'sc-continue') {
                const entry = worldEntry(hubWorld());
                const sc = entry ? entry.scenes.find(x => x.id === sid) : null;
                if (sc) openSceneStart({ seed: { kind: 'scene', id: sc.id, label: `scene ${sceneNumber(sc.id)}${sc.title ? `, ${sc.title}` : ''}`, text: sc.recap ? `The scene before: ${sc.recap}` : '' }, place: sc.place && (sc.place.id || sc.place.label) ? { id: sc.place.id || '', label: sc.place.label || '' } : null, cast: sc.cast });
                return;
            }
            // Hooks between scenes (D193): the round in the world's memory.
            if (act === 'hooks-offer') {
                if (!between()) return;
                result = 'Asking the world for hooks…';
                render();
                try { result = describeHooksResult(await proposeHubHooks(source.worldId)); } catch (e) { result = `Failed: ${e && e.message ? e.message : e}`; }
                render();
                return;
            }
            if (act === 'hook-play') {
                if (!between()) return;
                const h = hubHooks(source.worldId).proposed.find(x => x.id === this.getAttribute('data-hook'));
                if (h) openSceneStart({ seed: { kind: 'hook', id: h.id, label: h.title, text: h.text } });
                return;
            }
            if (act === 'hook-drop') { if (between()) { result = setHubHookAside(source.worldId, this.getAttribute('data-hook')) ? 'Set aside; it will not be offered again.' : 'That hook could not be set aside.'; render(); } return; }
            if (act === 'scene-write') { await writeOpenings(); return; }
            if (act === 'scene-pick') { await openWith(Number(this.getAttribute('data-choice')) || 0); return; }
            if (act === 'scene-own') {
                const own = String($(`${root()} .dooms-atlas-scene-own`).val() || '').trim();
                if (!own) { if (setup && setup.start) { setup = { ...setup, error: 'Write the opening first, or pick one above.' }; renderSetup(); } return; }
                await openWith(0, own);
                return;
            }
            if (act === 'scene-again') { await askOpeningsAgain(); return; }
            if (act === 'scene-back') { cancelStart(); if (setup && setup.start) { setup = { ...setup, step: 'form', pending: null, error: '' }; renderSetup(); } return; }
            if (act === 'setup-draft') { await runSetup(); return; }
            if (act === 'setup-stop') { stopSetup(); if (setup) { setup = { ...setup, progress: { ...setup.progress, word: 'Stopping after this part…' } }; renderSetup(); } return; }
            if (act === 'setup-back') { if (setup) { setup = { ...setup, step: 'notes', error: '' }; renderSetup(); } return; }
            if (act === 'setup-remove') { if (setup && setup.draft) { setup = { ...setup, draft: removeDraftPlace(setup.draft, this.getAttribute('data-key') || '') }; renderSetup(); } return; }
            if (act === 'setup-apply') { applyDraft(); return; }
            // Filling out a map (D160).
            if (act === 'fill') { openFill(); return; }
            if (act === 'fill-draft' || act === 'fill-again') { await runFill(); return; }
            if (act === 'fill-remove') { if (setup && setup.fill) { const k = this.getAttribute('data-key') || ''; setup = { ...setup, places: setup.places.filter(p => p.key !== k).map(p => ({ ...p, near: p.near.filter(r => r.key !== k) })) }; renderSetup(); } return; }
            if (act === 'fill-apply') { applyFillNow(); return; }
            if (act === 'group') {
                if (!model) return;
                const r = wrapInRegion(theBook(), model, { label: 'New region' });
                if (!commit(r.book, `${r.moved} ${r.moved === 1 ? 'place is' : 'places are'} inside a new region now. Name it; click its land to enter it. Fill out this map adds its neighbours.`)) return;
                if (board) { board.fit(); board.open(r.id); cardMode = 'edit'; board.redrawCard(); }    // the new region opens on its name
                return;
            }
            // A road's own card (D165): its travel time set or cleared, or the road taken away.
            if (act === 'road-save' || act === 'road-remove') {
                ev.stopPropagation();
                const $c = $(this).closest('.dooms-atlas-card');
                const ra = String($c.attr('data-a') || ''), rb = String($c.attr('data-b') || '');
                if (!ra || !rb || !model) return;
                if (board) board.closeCard();
                if (act === 'road-remove') { commit(toggleRoad(theBook(), ra, rb, model), `The road between ${labelOf(ra)} and ${labelOf(rb)} is gone.`); return; }
                const hours = roadTimeHours($c.find('[data-field="amount"]').val(), String($c.find('[data-field="unit"]').val() || 'days'));
                commit(setRoadTime(theBook(), ra, rb, hours), hours > 0 ? `The road between ${labelOf(ra)} and ${labelOf(rb)} takes ${describeTime(hours).replace(/^about /, '')} now, however it is drawn.` : `The road between ${labelOf(ra)} and ${labelOf(rb)} goes by its length again.`);
                return;
            }
            if (act === 'canon') { ev.stopPropagation(); commit(setCanon(theBook(), this.getAttribute('data-id') || '', true)); return; }
            if (act === 'setup-undo') { if (undoBook && undoBook.world === worldKey()) { const b = undoBook.book; const what = undoBook.what === 'world' ? 'world gen' : 'set-up'; undoBook = null; layer = ''; commit(b, `The ${what} is undone: the map is as it was.`); if (board) board.fit(); } return; }
            if (act === 'start-dismiss') { startDismissed = `${worldKey()}|${layer}`; render(); return; }
            if (act === 'base') { const b = theBook(); commit(withDrawn(b, !b.drawn), b.drawn ? 'The world\'s picture is the map again.' : 'The drawn map is showing; the picture is kept and the same button brings it back.'); if (board) board.fit(); return; }
            if (act === 'move') { moving = !moving; keep(MOVE_KEY, moving ? '1' : '0'); result = moving ? 'Moving is on: drag a marker to where it belongs.' : ''; render(); return; }
            if (act === 'place-all') { if (model) commit(placeAll(theBook(), model), 'Everything is on the map. Turn on moving (the arrows above the map) to drag a marker to where it belongs.'); if (isPhone() && !folded) setFolded(true); if (board) board.fit(); return; }
            if (act === 'delete') { ev.stopPropagation(); const label = labelOf(id); if (board) board.closeCard(); commit(removeMarker(theBook(), id), `${label} is deleted. It is under Deleted at the foot of Places if you want it back.`); return; }
            if (act === 'restore') { commit(restoreMarker(theBook(), id), 'Brought back: it waits in the list to be placed.'); return; }
            if (act === 'unplace') { ev.stopPropagation(); if (board) board.closeCard(); commit(unplace(theBook(), id)); return; }
            if (act === 'unmerge') { ev.stopPropagation(); commit(unmerge(theBook(), id), 'Split off: it waits in the list to be placed.'); return; }
            // The clean-up pass (D155): asked for, then each proposal done or passed over.
            if (act === 'tidy') {
                if (!model || tidy.busy) return;
                const world = worldKey();
                tidy = { busy: true, items: [], error: '', asked: true };
                tidyChat = world;
                render();
                const r = await proposeTidy(model, { world: (theState() || {}).name || '' });
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
                if (act === 'tidy-yes') commit(applyTidyItem(theBook(), item), item.kind === 'merge' ? `${item.label} is merged into ${item.toLabel}.` : `${item.label} is deleted.`);
                else render();
                return;
            }
            if (act === 'tidy-all') { let b = theBook(); const n = tidy.items.length; for (const item of tidy.items) b = applyTidyItem(b, item); tidy = { ...tidy, items: [], asked: false }; commit(b, `${n} done. Anything deleted is under Deleted at the foot of Places.`); return; }
            if (act === 'tidy-none') { tidy = { ...tidy, items: [], asked: false }; render(); return; }
            if (act === 'card-edit' || act === 'card-merge' || act === 'card-move' || act === 'card-view') { ev.stopPropagation(); cardMode = act === 'card-edit' ? 'edit' : act === 'card-merge' ? 'merge' : act === 'card-move' ? 'move' : 'view'; if (board) board.redrawCard(); return; }
            if (act === 'move-go') {
                ev.stopPropagation();
                const to = String($(this).closest('.dooms-atlas-card').find('[data-field="layer"]').val() || '');
                const label = labelOf(id);
                cardMode = 'view';
                if (board) board.closeCard();
                commit(moveInto(theBook(), id, to), to ? `${label} is inside ${labelOf(to)} now: enter ${labelOf(to)} to place it.` : `${label} is on the top map's list now.`);
                return;
            }
            if (act === 'edit-save') {
                ev.stopPropagation();
                const $c = $(this).closest('.dooms-atlas-card');
                cardMode = 'view';
                commit(editMarker(theBook(), id, { label: String($c.find('[data-field="label"]').val() || ''), kind: String($c.find('[data-field="kind"]').val() || ''), note: String($c.find('[data-field="note"]').val() || '') }));
                return;
            }
            if (act === 'merge-go') {
                ev.stopPropagation();
                const to = String($(this).closest('.dooms-atlas-card').find('[data-field="target"]').val() || '');
                if (!to) return;
                const label = labelOf(id);
                cardMode = 'view';
                if (board) board.closeCard();
                commit(mergeInto(theBook(), id, to), `${label} is merged into ${labelOf(to)}.`);
                return;
            }
            if (act === 'travel') { ev.stopPropagation(); await travel(this.getAttribute('data-id') || ''); return; }
            if (act === 'draw') {
                // The place's picture (D195): the card follows the run, and the picture is on it when it lands.
                ev.stopPropagation();
                const pid = this.getAttribute('data-place') || this.getAttribute('data-id') || '';
                if (!pid || isDrawingPlace()) return;
                const label = labelOf(this.getAttribute('data-id') || pid);
                result = `Drawing ${label}…`;
                const pending = drawPlace(pid, { reason: 'manual' });
                render();
                if (board) board.update({});
                try { result = describeDrawResult(await pending, label); } catch (e) { result = `The picture failed: ${e && e.message ? e.message : e}`; }
                render();
                if (board) board.update({});
                return;
            }
            if (act === 'person') { ev.stopPropagation(); openFace(this, this.getAttribute('data-name') || ''); return; }
            if (act === 'advance') {
                const pending = advanceNow({ reason: 'atlas' });    // takes the running flag before its first await: the render keeps the button disabled
                result = 'Advancing…';
                render();
                try { result = describeAdvanceResult(await pending, { spoilerFree: liveWorldConfig(extensionSettings).spoilerFree }); } catch (e) { result = `Failed: ${e && e.message ? e.message : e}`; }
                render();
                return;
            }
            if (act === 'edit') {
                const s = theState();
                const pack = thePack();
                if (!s || !pack) return;
                const fromChat = pack.id === BLANK_PACK_ID;
                closeAtlas();    // the builder is a window of the settings shell, which sits under the Atlas
                import('./worldBuilder.js').then(m => m.openWorldBuilder(fromChat ? { fromChat: true } : { id: s.pack })).catch(err => console.error('[Dooms Tracker] World Builder failed to load:', err));
                return;
            }
            // Hooks in the chat in front (docs/hooks-canon-plan.md D104): asked for, taken, cut to, set aside.
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
    // The review's own fields: a name typed (kept without drawing the list again, so the caret stays), a kind, what a place is inside of.
    $(document).on('change', `${root()} .dooms-atlas-setup-row [data-field]`, function () {
        if (!setup || !setup.draft) return;
        const key = String($(this).closest('.dooms-atlas-setup-row').attr('data-key') || '');
        const field = this.getAttribute('data-field');
        const value = String($(this).val() || '');
        if (field === 'inside') { setup = { ...setup, draft: setDraftInside(setup.draft, key, value) }; renderSetup(); return; }
        setup = { ...setup, draft: editDraftPlace(setup.draft, key, field === 'name' ? { name: value } : { kind: value }) };
        if (field === 'kind') renderSetup();
    });
    $(document).on('change', `${root()} .dooms-atlas-fill-row [data-field]`, function () {
        if (!setup || !setup.fill) return;
        const key = String($(this).closest('.dooms-atlas-fill-row').attr('data-key') || '');
        const field = this.getAttribute('data-field');
        const value = String($(this).val() || '').trim();
        if (!value) return;
        setup = { ...setup, places: setup.places.map(p => (p.key === key ? { ...p, [field === 'name' ? 'name' : 'kind']: value } : p)) };
    });
    // World gen's choices (D182): any of them changed draws the world they make again. The seed is read when it is left or Enter is pressed.
    $(document).on('change', `${root()} input[name="dooms-atlas-wg-shape"], ${root()} input[name="dooms-atlas-wg-size"], ${root()} input[name="dooms-atlas-wg-mode"], ${root()} .dooms-atlas-wg-regions, ${root()} .dooms-atlas-wg-seed`, function () { readWorldGen(); });
    // A name changed in the list of names to check (kept without drawing the list again, so the caret stays).
    $(document).on('change', `${root()} .dooms-atlas-name-row [data-field="name"]`, function () {
        if (!setup || !setup.naming) return;
        const nid = String($(this).closest('.dooms-atlas-name-row').attr('data-id') || '');
        const value = String($(this).val() || '').trim();
        if (value) setup = { ...setup, names: setup.names.map(n => (n.id === nid ? { ...n, name: value } : n)) };
    });
    // The tick that a world's memory may be replaced lights Play as scenes; what was typed in the record is kept.
    $(document).on('change', `${root()} .dooms-atlas-scenes-replace`, function () {
        if (!setup || !setup.scenes) return;
        setup = { ...setup, replace: $(this).is(':checked'), recap: String($(`${root()} .dooms-atlas-scenes-recap`).val() ?? setup.recap), continuity: continuityShown(setup.continuity, readContinuityFields(setup.continuity)), error: '' };
        renderSetup();
    });
    $(document).on('change', `${root()} .dooms-atlas-ground-select`, function () { commit(withGround(theBook(), String($(this).val() || ''), layer)); });
    // The wheel over a select that has the focus steps its value in some browsers: the sidebar scrolled past one would change the map's scale unasked.
    document.addEventListener('wheel', (ev) => { const t = ev.target; if (t && t.matches && t.matches(`${root()} .dooms-atlas-scale-pick select`) && document.activeElement === t) t.blur(); }, { capture: true, passive: true });
    $(document).on('change', `${root()} .dooms-atlas-scale-select:not(.dooms-atlas-fill-count)`, function () { commit(withScale(theBook(), String($(this).val() || ''), layer)); });
    $(document).on('input', `${root()} .dooms-atlas-query`, function () { query = String($(this).val() || ''); searched(); });
    $(document).on('keydown', `${root()} .dooms-atlas-query`, function (ev) {
        if (ev.key !== 'Enter') return;
        const first = document.querySelector(`${root()} .dooms-atlas-results [data-act="goto"]`);    // Enter goes to the first match
        if (first) showMarker(first.getAttribute('data-id') || '');
    });
    $(document).on('change', `${root()} .dooms-map-feed`, function () { const n = Number($(this).val()); feedLimit = FEED_LIMITS.includes(n) ? n : FEED_LIMITS[0]; keep(FEED_KEY, String(feedLimit)); render(); });
    $(document).on('click', `${root()} .dooms-world-card[data-name], ${root()} .dooms-world-token-btn[data-name]`, function () {
        openFace(this, String($(this).attr('data-name') || ''));
    });
    // Every line of News and of Rumours is a way into a scene while one can be started (D193).
    $(document).on('click', `${root()} .dooms-atlas-ways[data-way="news"] .dooms-map-changes li, ${root()} .dooms-atlas-ways[data-way="rumour"] .dooms-world-effects li`, function () {
        const way = this.closest('.dooms-atlas-ways');
        const kind = way && way.getAttribute('data-way') === 'rumour' ? 'rumour' : 'news';
        const i = this.getAttribute('data-i');
        startFromLine(kind, this.textContent, i === null ? -1 : Number(i));
    });
    $(document).on('change', `${root()} .dooms-atlas-scene-where`, function () { sceneWhereChanged(); });
    $(document).on('change', `${root()} .dooms-atlas-world-select`, function () { pickWorld(String($(this).val() || '')); });
    $(document).on('keydown', (ev) => {
        if (!isOpen || isFacePopoverOpen() || !takesEscape('atlas', ev)) return;
        if (setup) { if (setup.step === 'busy' || setup.step === 'opening' || endRunning()) return; if (setup.start) cancelStart(); setup = null; renderSetup(); render(); return; }    // the set-up's panel closes first (not while it reads)
        if (roading) { setRoading(false); render(); return; }    // drawing roads ends first
        if (armed) { arm(null); render(); return; }    // what waited for a tap is let go first
        if (board && (board.opened() || board.popupOpen())) { board.closeCard(); return; }    // a card on top (a marker's, a road's) closes first
        closeAtlas();
    });
    window.addEventListener(WORLD_CHANGED_EVENT, () => { if (isOpen) render(); });
    window.addEventListener(HOOKS_CHANGED_EVENT, () => { if (isOpen && tab === 'hooks') render(); });
    window.addEventListener(QUESTS_DONE_CHANGED_EVENT, () => { if (isOpen && tab === 'hooks') render(); });
    // A scene ended, started or set aside while the Atlas is open changes what it shows; its own map edits (source 'map') are drawn already.
    window.addEventListener(HUB_CHANGED_EVENT, (ev) => {
        if (!isOpen) return;
        const src = ev && ev.detail ? ev.detail.source : '';
        if (src === 'bind' || src === 'unbind') refreshWorlds().catch(() => {});
        if (src !== 'map') render();
    });
    window.addEventListener('resize', () => { if (!isOpen) return; fitToScreen(); if (board) board.size(); });
}

/**
 * Opens the Atlas (building it the first time) and keeps it current while
 * open. `place` opens it on that place's card; `name` on the place that
 * character stands at.
 */
export async function openAtlas({ place = '', name = '', worldId = '', tab: openTab = '', start = false } = {}) {
    try { await ensureCss('atlas'); } catch (e) { /* the sheet failed to load: the window still opens */ }
    build();
    isOpen = true;
    pushWindow('atlas');
    result = '';
    picked = '';
    pickedPack = null;
    if (openTab && ATLAS_TABS.some(t => t.id === openTab)) tab = openTab;    // not remembered: the tab asked for this once
    try { recordCurrentScene(); } catch (e) { /* the map stays as it is */ }    // the place the chat stands in, if no reply recorded it
    $(root()).addClass('is-open').css('display', 'flex');    // shown before the render, so the map's frame has its size when Leaflet fits it
    fitToScreen();
    render();
    refreshWorlds().catch(() => {});
    // A world asked for by name (the World Builder, Settings): shown whatever chat is in front, unless that chat is a scene of it.
    if (worldId) {
        let inFront = '';
        try { const cur = currentScene(); inFront = cur ? cur.worldId : ''; } catch (e) { inFront = ''; }
        if (worldId !== inFront) await pickWorld(worldId);
    }
    // The records against the card's chats (D128): a chat deleted outside is marked gone, one the list lost is brought back.
    { const w = hubWorld(); if (w && !picked) refreshScenes(w).catch(() => {}); }
    // Opened to start a scene (Settings → Start a scene): the sheet at once, or the reason there can be none.
    if (start && isOpen) { if (startPlan.ok) openSceneStart({}); else { result = whyNoStart(); render(); } }
    if (place || name) {
        const wait = (n) => { if (!isOpen) return; if (board) { if (name) showPlaceOf(name); else showMarker(place); } else if (n > 0) setTimeout(() => wait(n - 1), 60); };
        wait(40);
    }
}

/** The Atlas opened on the End sheet of the scene in front (the strip above the chat, the D menu's End scene). */
export async function openAtlasEnd() {
    await openAtlas();
    await openEndScene();
}

export function closeAtlas() {
    isOpen = false;
    popWindow('atlas');
    closeFacePopover();
    unmount();    // the view is kept with its world: the Atlas opened again shows the map where it was left
    armed = null;
    roading = null;
    cardMode = 'view';
    if (setup && setup.step === 'busy') stopSetup();
    setup = null;
    undoBook = null;
    picked = '';         // the Atlas opens on the chat in front again
    pickedPack = null;
    deleting = '';
    pickToken++;
    $(`${root()} .dooms-atlas-setup`).prop('hidden', true).empty();
    $(root()).removeClass('is-open is-armed is-roading has-sheet').css('display', 'none');
    $(`${root()} .dooms-atlas-tool[data-act="roads"]`).removeClass('is-on');
}

export function isAtlasOpen() {
    return isOpen;
}
