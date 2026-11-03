/**
 * The Hub's views (docs/hub-plan.md D116, D117, D119, D122, D129): pure
 * HTML from the world's entry, the pack and the scene in hand. The window
 * (the head, the Scenes panel, the foot), the Start sheet, the opener
 * picker, the End sheet and the scene strip. No DOM, no SillyTavern:
 * tools/hub-layout-test.mjs renders them in a headless browser;
 * src/systems/ui/hub.js puts them on the page and acts on them.
 */
import { escapeHtml } from '../../utils/html.js';
import { GAPS, openSceneOf, hubStatusLine } from '../../utils/hub.js';
import { safeImageUrl } from '../../utils/worldBoard.js';
import { nodeHtml, initialsOf } from './hubBoard.js';
import { newsHtml, rumoursHtml, peopleHtml } from './worldViews.js';

/** The side panels, in order (the phone's tabs add Map in front). */
export const HUB_PANELS = Object.freeze([
    { id: 'news', label: 'News', icon: 'fa-newspaper' },
    { id: 'rumours', label: 'Rumours', icon: 'fa-comments' },
    { id: 'hooks', label: 'Hooks', icon: 'fa-signs-post' },
    { id: 'people', label: 'People', icon: 'fa-users' },
    { id: 'scenes', label: 'Scenes', icon: 'fa-clapperboard' },
]);

export const POPUP_ID = 'rpg-hub-popup';
export const STRIP_ID = 'dooms-scene-strip';

const e = escapeHtml;
const attr = (v) => escapeHtml(String(v ?? ''));
const sceneNo = (id) => String(id || '').replace(/^s/, '');

/** The window's shell: the popup, its header, its body. The controller fills .dooms-hub-body. */
export function hubShellHtml() {
    return `<div id="${POPUP_ID}" class="rpg-settings-popup" role="dialog" aria-modal="true" aria-labelledby="dooms-hub-title" style="display: none;">
        <div class="rpg-settings-popup-content">
            <header class="rpg-settings-popup-header">
                <h3 id="dooms-hub-title"><i class="fa-solid fa-compass" aria-hidden="true"></i> <span>The Hub</span></h3>
                <button id="dooms-hub-close" class="rpg-popup-close" type="button" aria-label="Close">&times;</button>
            </header>
            <div class="rpg-settings-popup-body"><div class="dooms-hub-body"></div></div>
        </div>
    </div>`;
}

/**
 * The window: the head (the world, its date, its narrator, Start a scene),
 * the body (a sheet when one is open, else the Scenes panel; the board and
 * the other panels come with phase 2), the foot (the status line, the open
 * scene's Resume and End).
 * @param {object} o
 * @param {Array<{id:string,name:string,card:string,cardName:string}>} o.worlds  the worlds the hub can play
 * @param {string} o.worldId
 * @param {object|null} o.pack
 * @param {object|null} o.entry      the world's entry (card, memory, scenes)
 * @param {{name:string}|null} o.card
 * @param {object|null} o.sheet      { kind: 'start'|'picker'|'end', ... } or null
 * @param {string} o.note            the last result line
 * @param {boolean} o.liveWorldOn
 * @param {{mode:'picture'|'tree',model?:object,tree?:object}|null} o.board  what the board draws (D124); null while a sheet is open
 * @param {string} o.panel           the side panel ('news' | 'rumours' | 'hooks' | 'people' | 'scenes'), or 'map' for the phone's board
 * @param {Function} o.portraits     name -> a portrait URL or ''
 * @param {{state:object,pack:object,cfg:object}|null} o.world  the world the panels read: the memory's state (or the pack's seed), the pack, Live World's rules
 * @param {object|null} o.hooks      the round on offer in the memory
 * @param {boolean} o.hooksBusy
 */
export function hubHtml({ worlds = [], worldId = '', pack = null, entry = null, card = null, sheet = null, note = '', liveWorldOn = true, board = null, panel = 'news', portraits = () => '', world = null, hooks = null, hooksBusy = false } = {}) {
    const name = pack ? pack.name : (worldId || 'No world');
    const facts = entry && entry.memory && entry.memory.facts ? entry.memory.facts : null;
    const date = facts && facts.date ? `${facts.date}${facts.time ? `, ${facts.time}` : ''}` : 'no scene ended yet';
    const weather = facts && facts.weather ? ` · ${facts.weather}` : '';
    const open = entry ? openSceneOf(entry) : null;
    const pick = worlds.length > 1
        ? `<select class="rpg-accordion-select dooms-hub-world" data-act="world" aria-label="The world">${worlds.map(w => `<option value="${attr(w.id)}"${w.id === worldId ? ' selected' : ''}>${e(w.name)}</option>`).join('')}</select>`
        : '';
    const head = `<div class="dooms-hub-head">
        <div class="dooms-hub-heading"><span class="dooms-hub-title">${e(name)}</span><span class="dooms-hub-sub">${e(date)}${e(weather)}</span></div>
        <span class="dooms-hub-sub dooms-hub-narrator">${card ? `Narrated by ${e(card.name)}` : 'No narrator card yet'}</span>
        <div class="dooms-hub-head-actions">
            ${pick}
            <button type="button" class="rpg-accordion-action-btn" data-act="start"${!card || !liveWorldOn || sheet ? ' disabled' : ''} title="${card ? 'A fresh chat on the narrator card, from a place of the world' : 'Pick a narrator card first (Settings → Live World → The Hub)'}"><i class="fa-solid fa-play" aria-hidden="true"></i> Start a scene</button>
            <button type="button" class="rpg-accordion-action-btn" data-act="settings" title="Settings → Live World → The Hub"><i class="fa-solid fa-gear" aria-hidden="true"></i> Settings</button>
        </div>
    </div>`;
    let main;
    if (sheet && sheet.kind === 'start') main = startSheetHtml(sheet);
    else if (sheet && sheet.kind === 'picker') main = pickerHtml(sheet);
    else if (sheet && sheet.kind === 'end') main = endSheetHtml(sheet);
    else if (sheet && sheet.kind === 'place') main = placeSheetHtml({ ...sheet, portraits });
    else if (!liveWorldOn) main = `<div class="dooms-hub-empty">Live World is off. The hub is Live World's: switch it on in Settings → Live World.</div>`;
    else if (!worlds.length) main = `<div class="dooms-hub-empty">No world of your own yet. Build one in the World Builder (Settings → Live World), then pick its narrator card here.</div>`;
    else if (!card) main = `<div class="dooms-hub-empty">${e(name)} has no narrator card. A scene is a chat, and a chat belongs to a card: pick any card to narrate this world, or make one, in Settings → Live World → The Hub.</div>`;
    else main = boardMainHtml({ board, entry, panel, portraits, world, hooks, hooksBusy });
    const foot = `<div class="dooms-hub-foot">
        <span class="dooms-hub-status">${e(note || hubStatusLine({ worldName: name, entry, cardName: card ? card.name : '' }))}</span>
        ${open && !sheet ? `<button type="button" class="rpg-accordion-action-btn" data-act="resume" data-id="${attr(open.id)}" title="The scene's chat in front"><i class="fa-solid fa-arrow-right-to-bracket" aria-hidden="true"></i> Resume</button><button type="button" class="rpg-accordion-action-btn" data-act="end" data-id="${attr(open.id)}" title="End the scene and remember it"><i class="fa-solid fa-flag-checkered" aria-hidden="true"></i> End scene</button>` : ''}
    </div>`;
    return `<div class="dooms-hub" data-sheet="${sheet ? attr(sheet.kind) : ''}">${head}${main}${foot}</div>`;
}

/**
 * The main body (D124): the board on the left (the picture's frame, which
 * the controller fills with Leaflet, or the tree board) and the panels on
 * the right (the Scenes panel; the others come with Hub 10); on a phone,
 * tabs across the top and one of them at a time.
 */
function boardMainHtml({ board, entry, panel = 'news', portraits = () => '', world = null, hooks = null, hooksBusy = false } = {}) {
    const mode = board && board.mode === 'picture' ? 'picture' : 'tree';
    const side = HUB_PANELS.some(p => p.id === panel) ? panel : 'news';
    const top = panel === 'map' ? 'map' : side;
    const tab = (id, label, icon, cls) => `<button type="button" class="${cls}${top === id ? ' is-active' : ''}" role="tab" aria-selected="${top === id ? 'true' : 'false'}" data-act="panel" data-panel="${id}"><i class="fa-solid ${icon}" aria-hidden="true"></i> <span>${label}</span></button>`;
    const nav = `<nav class="dooms-hub-tabs" role="tablist" aria-label="The hub's panels">${tab('map', 'Map', 'fa-map', 'dooms-hub-tab')}${HUB_PANELS.map(p => tab(p.id, p.label, p.icon, 'dooms-hub-tab')).join('')}</nav>`;
    const sideNav = `<nav class="dooms-hub-side-nav" role="tablist" aria-label="The panels">${HUB_PANELS.map(p => tab(p.id, p.label, p.icon, 'dooms-hub-side-tab')).join('')}</nav>`;
    const frame = mode === 'picture'
        ? `<div class="dooms-hub-map" role="application" aria-label="The world's map: drag to pan, the wheel or a pinch to zoom, a node for its place"><p class="dooms-hub-map-wait dooms-hub-hint">The map is loading…</p></div>${boardNotesHtml(board && board.model ? board.model : null)}`
        : treeBoardHtml(board && board.tree ? board.tree : { groups: [], elsewhere: [] }, { portraits });
    return `<div class="dooms-hub-main is-board" data-panel="${attr(top)}">${nav}<section class="dooms-hub-board-wrap" data-mode="${mode}">${frame}</section><aside class="dooms-hub-side" data-panel="${attr(side)}">${sideNav}<div class="dooms-hub-side-body">${sidePanelHtml({ id: side, entry, portraits, world, hooks, hooksBusy })}</div></aside></div>`;
}

/** One side panel: the Map window's renderers over the memory's world state, every line a way in (§4.1); the hub's own Hooks and Scenes. */
function sidePanelHtml({ id, entry, portraits, world, hooks, hooksBusy }) {
    if (id === 'scenes') return scenesPanelHtml({ entry });
    if (id === 'hooks') return hubHooksHtml({ hooks, busy: hooksBusy });
    const state = world && world.state ? world.state : null;
    const pack = world && world.pack ? world.pack : null;
    const cfg = world && world.cfg ? world.cfg : { spoilerFree: false };
    if (!state || !pack) return '<div class="dooms-hub-empty">The world is not loaded yet.</div>';
    if (id === 'rumours') return `<div class="dooms-hub-ways" data-way="rumour">${rumoursHtml({ state, pack, cfg })}<p class="dooms-hub-hint">A line is a way in: click it and the Start sheet opens with it as what brought you.</p></div>`;
    if (id === 'people') return `<div class="dooms-hub-ways" data-way="person">${peopleHtml({ state, pack, portraits, present: [] })}<p class="dooms-hub-hint">A face is a way in: click it and the Start sheet opens with them, where they were last seen.</p></div>`;
    return `<div class="dooms-hub-ways" data-way="news">${newsHtml({ state, pack, cfg, feed: 12 })}<p class="dooms-hub-hint">A line is a way in: click it and the Start sheet opens with it as what brought you.</p></div>`;
}

/**
 * Hooks in the hub (§4.4): the round on offer in the memory, each hook with
 * Play this and Not this one; Offer hooks asks for a round over the memory.
 */
export function hubHooksHtml({ hooks = null, busy = false } = {}) {
    const h = hooks && typeof hooks === 'object' ? hooks : { proposed: [], taken: [], aside: [], last: null };
    const proposed = Array.isArray(h.proposed) ? h.proposed : [];
    const takenAll = Array.isArray(h.taken) ? h.taken : [];
    const cards = proposed.map(x => `<article class="dooms-map-hook" data-hook="${attr(x.id)}">
        <div class="dooms-map-hook-title">${e(x.title)}</div>
        <p class="dooms-map-hook-text">${e(x.text)}</p>
        ${x.grounds ? `<div class="dooms-world-muted dooms-map-hook-from">From: ${e(x.grounds)}</div>` : ''}
        <div class="dooms-map-hook-actions">
            <button type="button" class="rpg-accordion-action-btn" data-act="hook-play" data-id="${attr(x.id)}" title="The Start sheet with this hook; the scene takes it as a quest"><i class="fa-solid fa-play" aria-hidden="true"></i> Play this</button>
            <button type="button" class="rpg-accordion-action-btn" data-act="hook-aside" data-id="${attr(x.id)}" title="Set aside: not offered again"><i class="fa-solid fa-xmark" aria-hidden="true"></i> Not this one</button>
        </div>
    </article>`).join('');
    const taken = takenAll.slice().reverse().slice(0, 10);
    const failed = h.last && !h.last.ok && h.last.error ? `<p class="dooms-world-error">The last round failed: ${e(h.last.error)}</p>` : '';
    return `<section class="dooms-map-hooks dooms-hub-hooks">
        <div class="dooms-inv-head"><span class="dooms-inv-label">🪝 Hooks</span><span class="dooms-inv-fill" title="Hooks played">${takenAll.length}</span></div>
        <p class="dooms-world-muted dooms-map-hook-hint">What the world offers to do next, from its clocks, its rumours and who was last seen where, as the world stands in the hub's memory. Play this opens the Start sheet with the hook, and the scene takes it as a quest.</p>
        <div class="dooms-map-hook-list">${cards || `<p class="dooms-world-muted">${busy ? 'Asking the world…' : 'No hooks on offer yet.'}</p>`}</div>
        <div class="dooms-map-hook-foot">
            <button type="button" class="rpg-accordion-action-btn" data-act="hooks-propose"${busy ? ' disabled' : ''}><i class="fa-solid ${busy ? 'fa-spinner fa-spin' : 'fa-signs-post'}" aria-hidden="true"></i> ${busy ? 'Asking…' : (proposed.length ? 'Offer others' : 'Offer hooks')}</button>
            ${failed}
        </div>
        ${taken.length ? `<details class="dooms-map-hook-taken"><summary>Played${takenAll.length > taken.length ? `, the last ${taken.length}` : ''}</summary><ul class="dooms-map-done-list">${taken.map(t => `<li><span class="dooms-map-done-text">${e(t.title)}</span></li>`).join('')}</ul></details>` : ''}
    </section>`;
}

/** Under the picture: the places not on the map yet (each a way to its sheet) and the people whose place has no node. */
function boardNotesHtml(model) {
    if (!model) return '';
    const unplaced = Array.isArray(model.unplaced) ? model.unplaced : [];
    const elsewhere = Array.isArray(model.elsewhere) ? model.elsewhere : [];
    if (!unplaced.length && !elsewhere.length) return '';
    const places = unplaced.length ? `<span class="dooms-hub-board-note"><span class="dooms-hub-board-note-label">Not on the map yet</span> ${unplaced.map(p => `<button type="button" class="dooms-hub-link" data-act="place" data-id="${attr(p.id)}">${e(p.label || p.id)}</button>`).join(', ')} <span class="dooms-hub-hint">(the World Builder's Map tab places them)</span></span>` : '';
    const people = elsewhere.length ? `<span class="dooms-hub-board-note"><span class="dooms-hub-board-note-label">Elsewhere</span> ${elsewhere.map(x => `${e(x.name)}${x.at ? ` <span class="dooms-hub-hint">(${e(x.at.startsWith('loc:') ? x.at.slice(4).replace(/-/g, ' ') : x.at)})</span>` : ''}`).join(', ')}</span>` : '';
    return `<div class="dooms-hub-board-notes">${places}${people}</div>`;
}

/**
 * The tree board (D124) for a world without a picture: regions as groups,
 * each place a node (the same circle, faces and label as on the picture),
 * the story's own places under Elsewhere. A node is a way to its sheet.
 */
export function treeBoardHtml({ groups = [], elsewhere = [] } = {}, { portraits = () => '' } = {}) {
    const chip = (p) => `<button type="button" class="dooms-tree-place${p.isRegion ? ' is-region' : ''}${p.player ? ' is-player' : ''}" data-act="place" data-id="${attr(p.id)}" title="${attr(p.label)}${p.people && p.people.length ? `: ${attr(p.people.join(', '))}` : ''}"><span class="dooms-tree-head dooms-node is-hub${p.isRegion ? ' is-region' : ''}${p.player ? ' is-player' : ''}${p.visited === false ? ' is-unvisited' : ''}">${nodeHtml(p, { mode: 'hub', portraits })}</span></button>`;
    const group = (g) => `<div class="dooms-tree-group" data-id="${attr(g.id)}"><div class="dooms-tree-title">${e(g.label)}</div><div class="dooms-tree-places">${g.places.map(chip).join('')}</div></div>`;
    const body = groups.length ? groups.map(group).join('') : '<p class="dooms-hub-empty">This world has no places yet: the World Builder\'s Places tab adds them, and the story names its own as it goes.</p>';
    const loose = elsewhere.length ? `<div class="dooms-tree-group is-elsewhere"><div class="dooms-tree-title">Elsewhere</div><div class="dooms-tree-places">${elsewhere.map(chip).join('')}</div></div>` : '';
    return `<div class="dooms-tree" role="list" aria-label="The world's places"><p class="dooms-hub-hint dooms-tree-hint">No picture for this world yet: its places as a tree. The World Builder's Map tab takes a picture and puts them on it.</p>${body}${loose}</div>`;
}

/**
 * The place sheet (D124, §4.3): the picture, the region, who is here, the
 * rumours that name it, the scenes played there, Start a scene here.
 */
export function placeSheetHtml({ id = '', label = '', region = '', picture = '', people = [], player = false, rumours = [], scenes = [], canStart = true, portraits = () => '' } = {}) {
    const img = safeImageUrl(picture);
    const pic = img ? `<div class="dooms-hub-place-pic" style="background-image: url('${attr(img)}')" role="img" aria-label="${attr(label)}"></div>` : `<div class="dooms-hub-place-pic is-empty" aria-hidden="true"><i class="fa-solid fa-location-dot"></i></div>`;
    const faces = people.length
        ? `<ul class="dooms-hub-place-people">${people.map(n => { const u = safeImageUrl(portraits(n)); return `<li>${u ? `<span class="dooms-node-face has-picture" style="background-image: url('${attr(u)}')"></span>` : `<span class="dooms-node-face">${e(initialsOf(n))}</span>`}<span>${e(n)}</span></li>`; }).join('')}</ul>`
        : '<p class="dooms-hub-hint">No one was last seen here.</p>';
    const talk = rumours.length ? `<ul class="dooms-hub-place-rumours">${rumours.map(r => `<li>${e(r)}</li>`).join('')}</ul>` : '<p class="dooms-hub-hint">Nothing names it yet.</p>';
    const played = scenes.length
        ? `<ul class="dooms-hub-place-scenes">${scenes.map(s => `<li><span class="dooms-hub-scene-no">Scene ${e(sceneNo(s.id))}</span> <span>${e(s.title || 'Untitled')}</span> <span class="dooms-hub-hint">${e([s.status === 'open' ? 'open' : s.status === 'aside' ? 'set aside' : '', s.startDate ? `from ${s.startDate}` : '', s.endDate ? `to ${s.endDate}` : ''].filter(Boolean).join(' · '))}</span></li>`).join('')}</ul>`
        : '<p class="dooms-hub-hint">No scene has been played here yet.</p>';
    return `<div class="dooms-hub-sheet dooms-hub-sheet-place" data-id="${attr(id)}">
        <div class="dooms-hub-place-head">
            ${pic}
            <div class="dooms-hub-place-titles">
                <h4 class="dooms-hub-sheet-title">${e(label || id)}</h4>
                ${region ? `<span class="dooms-hub-sub">${e(region)}</span>` : ''}
                ${player ? '<span class="dooms-hub-sub dooms-hub-place-you">You are here</span>' : ''}
            </div>
        </div>
        <div class="dooms-hub-field"><span class="dooms-hub-field-label">Who is here</span>${faces}</div>
        <div class="dooms-hub-field"><span class="dooms-hub-field-label">What is said about it</span>${talk}</div>
        <div class="dooms-hub-field"><span class="dooms-hub-field-label">Scenes played here</span>${played}</div>
        <div class="dooms-hub-sheet-actions">
            <button type="button" class="rpg-accordion-action-btn" data-act="start-here" data-id="${attr(id)}"${canStart ? '' : ' disabled'} title="${canStart ? 'The Start sheet with this place filled in' : 'Live World is off, or this world has no narrator card'}"><i class="fa-solid fa-play" aria-hidden="true"></i> Start a scene here</button>
            <button type="button" class="rpg-accordion-action-btn" data-act="sheet-close">Back</button>
        </div>
    </div>`;
}

/** The Scenes panel (D122, D123, D128): the open scene first, then the set-aside ones, then the ended ones newest first. */
export function scenesPanelHtml({ entry = null } = {}) {
    const scenes = entry && Array.isArray(entry.scenes) ? entry.scenes : [];
    if (!scenes.length) return `<div class="dooms-hub-empty">No scene yet. Start a scene: a fresh chat opens on the narrator card with a brief and three openers; End it when it is done and the next one knows.</div>`;
    const order = [...scenes.filter(s => s.status === 'open'), ...scenes.filter(s => s.status === 'aside').reverse(), ...scenes.filter(s => s.status === 'ended').reverse()];
    const tag = (s) => (s.gone ? 'chat gone' : s.status === 'open' ? 'open' : s.status === 'aside' ? 'set aside' : 'ended');
    const items = order.map(s => {
        const when = [s.startDate ? `from ${s.startDate}` : '', s.endDate ? `to ${s.endDate}` : ''].filter(Boolean).join(' ');
        const where = s.place && s.place.label ? s.place.label : '';
        const who = s.cast && s.cast.length ? s.cast.join(', ') : '';
        const meta = [where, who, when].filter(Boolean).join(' · ');
        const actions = [];
        if (!s.gone && s.status === 'open') actions.push(`<button type="button" class="rpg-accordion-action-btn" data-act="resume" data-id="${attr(s.id)}"><i class="fa-solid fa-arrow-right-to-bracket" aria-hidden="true"></i> Resume</button>`, `<button type="button" class="rpg-accordion-action-btn" data-act="end" data-id="${attr(s.id)}"><i class="fa-solid fa-flag-checkered" aria-hidden="true"></i> End scene</button>`, `<button type="button" class="rpg-accordion-action-btn" data-act="aside" data-id="${attr(s.id)}" title="Leave it open for later; nothing is remembered until you end it"><i class="fa-solid fa-pause" aria-hidden="true"></i> Set aside</button>`);
        else if (!s.gone && s.status === 'aside') actions.push(`<button type="button" class="rpg-accordion-action-btn" data-act="resume" data-id="${attr(s.id)}"><i class="fa-solid fa-arrow-right-to-bracket" aria-hidden="true"></i> Resume</button>`, `<button type="button" class="rpg-accordion-action-btn" data-act="end" data-id="${attr(s.id)}" title="Opens its chat and ends it"><i class="fa-solid fa-flag-checkered" aria-hidden="true"></i> End scene</button>`);
        else if (!s.gone) actions.push(`<button type="button" class="rpg-accordion-action-btn" data-act="open-chat" data-id="${attr(s.id)}"><i class="fa-solid fa-comments" aria-hidden="true"></i> Open the chat</button>`, `<button type="button" class="rpg-accordion-action-btn" data-act="continue" data-id="${attr(s.id)}" title="A new scene at the same place with the same people"><i class="fa-solid fa-forward" aria-hidden="true"></i> Continue from here</button>`);
        else actions.push(`<button type="button" class="rpg-accordion-action-btn" data-act="remove" data-id="${attr(s.id)}" title="The chat is gone; the record can go too"><i class="fa-solid fa-trash" aria-hidden="true"></i> Remove</button>`);
        return `<li class="dooms-hub-scene is-${s.status}${s.gone ? ' is-gone' : ''}" data-id="${attr(s.id)}">
            <div class="dooms-hub-scene-head"><span class="dooms-hub-scene-no">Scene ${e(sceneNo(s.id))}</span><span class="dooms-hub-scene-title">${e(s.title || 'Untitled')}</span><span class="dooms-hub-scene-tag">${e(tag(s))}</span>${s.reopened ? '<span class="dooms-hub-scene-tag">reopened</span>' : ''}</div>
            ${meta ? `<div class="dooms-hub-scene-meta">${e(meta)}</div>` : ''}
            ${s.status === 'ended' ? `<p class="dooms-hub-scene-recap">${s.recap ? e(s.recap) : '<span class="dooms-hub-hint">No recap was kept.</span>'}</p>` : ''}
            <div class="dooms-hub-scene-actions">${actions.join('')}</div>
        </li>`;
    });
    return `<div class="dooms-hub-panel-title">Scenes</div><ul class="dooms-hub-scenes">${items.join('')}</ul>`;
}

/**
 * The Start sheet (D117): Where, Who, When, What, Start.
 * @param {object} o
 * @param {Array<{id:string,label:string,region?:string}>} o.places  the pack's places (and the story's)
 * @param {Array<{name:string,here:boolean,tier?:string}>} o.people  the known people, those at the place marked
 * @param {{id?:string,label?:string}} o.place
 * @param {string[]} o.cast
 * @param {{id:string,words?:string}} o.gap
 * @param {string} o.seedText
 * @param {string} o.note
 * @param {string} o.error
 * @param {boolean} o.busy
 */
export function startSheetHtml({ places = [], people = [], place = null, cast = [], gap = { id: 'later', words: '' }, seedText = '', note = '', error = '', busy = false } = {}) {
    const placeId = place && place.id ? place.id : '';
    const options = [`<option value=""${!placeId ? ' selected' : ''}>Anywhere that fits</option>`, ...places.map(p => `<option value="${attr(p.id)}"${p.id === placeId ? ' selected' : ''}>${e(p.label)}${p.region ? ` (${e(p.region)})` : ''}</option>`), '<option value="__new__">A new place…</option>'].join('');
    const chips = people.length
        ? people.map(p => `<label class="dooms-hub-chip${cast.includes(p.name) ? ' is-on' : ''}"><input type="checkbox" name="dooms-hub-cast" value="${attr(p.name)}"${cast.includes(p.name) ? ' checked' : ''}> ${e(p.name)}${p.here ? ' <span class="dooms-hub-chip-here" title="Last seen here">●</span>' : ''}</label>`).join('')
        : '<span class="dooms-hub-hint">No one known yet: the people the story meets appear here.</span>';
    const gaps = GAPS.map(g => `<label class="dooms-hub-chip dooms-hub-gap${g.id === gap.id ? ' is-on' : ''}"><input type="radio" name="dooms-hub-gap" value="${attr(g.id)}"${g.id === gap.id ? ' checked' : ''}> ${e(g.label)}</label>`).join('');
    return `<div class="dooms-hub-sheet dooms-hub-sheet-start">
        <h4 class="dooms-hub-sheet-title">Start a scene</h4>
        <div class="dooms-hub-field">
            <label for="dooms-hub-where">Where</label>
            <select id="dooms-hub-where" class="rpg-accordion-select">${options}</select>
            <input id="dooms-hub-where-new" class="rpg-accordion-input" type="text" placeholder="…or name a new place" value="${!placeId && place && place.label ? attr(place.label) : ''}" />
        </div>
        <div class="dooms-hub-field">
            <span class="dooms-hub-field-label">Who is there (the player always)</span>
            <div class="dooms-hub-chips">${chips}</div>
            <input id="dooms-hub-who-new" class="rpg-accordion-input" type="text" placeholder="…and anyone else, by name, comma-separated" />
        </div>
        <div class="dooms-hub-field">
            <span class="dooms-hub-field-label">When, since the last scene</span>
            <div class="dooms-hub-chips dooms-hub-gaps">${gaps}</div>
            <input id="dooms-hub-when" class="rpg-accordion-input" type="text" placeholder="When…: in your own words (a week on, the next full moon)" value="${attr(gap.id === 'when' ? gap.words : '')}" />
        </div>
        <div class="dooms-hub-field">
            <label for="dooms-hub-seed">What brought us here</label>
            <textarea id="dooms-hub-seed" class="rpg-accordion-input" rows="3" placeholder="A rumour, a piece of news, a hook, or nothing at all">${e(seedText)}</textarea>
        </div>
        <div class="dooms-hub-field">
            <label for="dooms-hub-note">What you want from this scene (optional)</label>
            <input id="dooms-hub-note" class="rpg-accordion-input" type="text" placeholder="find the ring; make Reyes talk" value="${attr(note)}" />
        </div>
        ${error ? `<p class="dooms-hub-note">${e(error)}</p>` : ''}
        <div class="dooms-hub-sheet-actions">
            <button type="button" class="rpg-accordion-action-btn" data-act="start-go"${busy ? ' disabled' : ''}><i class="fa-solid fa-play" aria-hidden="true"></i> ${busy ? 'Starting…' : 'Start'}</button>
            <button type="button" class="rpg-accordion-action-btn" data-act="sheet-close"${busy ? ' disabled' : ''}>Cancel</button>
            <span class="dooms-hub-hint">A longer gap moves the world first; then the narrator writes three openers for you to pick from.</span>
        </div>
    </div>`;
}

/**
 * The opener picker (D119): the openers as cards, Write my own, Ask again,
 * Start without one, Back.
 * @param {object} o
 * @param {{world:{name:string},place:{label:string},openers:Array,errors:string[],notes:string[]}|null} o.pending
 * @param {boolean} o.busy   the narrator is writing
 * @param {string} o.error   the last failure
 * @param {number} o.sceneNo
 */
export function pickerHtml({ pending = null, busy = false, error = '', sceneNo: n = 0 } = {}) {
    const openers = pending && Array.isArray(pending.openers) ? pending.openers : [];
    const where = pending && pending.place && pending.place.label ? ` at ${e(pending.place.label)}` : '';
    const notes = [...(pending && pending.notes ? pending.notes : []), ...(pending && pending.errors && !openers.length ? pending.errors : [])];
    const cards = openers.map((o, i) => `<div class="dooms-hub-card">
            <div class="dooms-hub-card-title">${e(o.title || `Opener ${i + 1}`)}</div>
            <p class="dooms-hub-card-text">${e(o.text)}</p>
            ${o.who && o.who.length ? `<div class="dooms-hub-card-who">${e(o.who.join(', '))}</div>` : ''}
            <div class="dooms-hub-card-actions"><button type="button" class="rpg-accordion-action-btn" data-act="pick" data-i="${i}"${busy ? ' disabled' : ''}><i class="fa-solid fa-check" aria-hidden="true"></i> Use this</button></div>
        </div>`).join('');
    return `<div class="dooms-hub-sheet dooms-hub-sheet-picker">
        <h4 class="dooms-hub-sheet-title">Scene ${e(String(n || ''))}${where}: how does it open?</h4>
        ${busy ? '<p class="dooms-hub-hint"><i class="fa-solid fa-feather" aria-hidden="true"></i> The narrator is writing…</p>' : ''}
        ${openers.length ? `<div class="dooms-hub-openers${busy ? ' is-busy' : ''}">${cards}</div>` : (busy ? '' : '<p class="dooms-hub-hint">No opener yet: write your own below, ask again, or start without one.</p>')}
        ${notes.length ? `<p class="dooms-hub-note">${e(notes.join(' '))}</p>` : ''}
        ${error ? `<p class="dooms-hub-note">${e(error)}</p>` : ''}
        <div class="dooms-hub-field">
            <label for="dooms-hub-own">Or write the opening yourself</label>
            <textarea id="dooms-hub-own" class="rpg-accordion-input" rows="3" placeholder="The first message of the scene, in the narrator's voice"></textarea>
        </div>
        <div class="dooms-hub-sheet-actions">
            <button type="button" class="rpg-accordion-action-btn" data-act="pick-own"${busy ? ' disabled' : ''}><i class="fa-solid fa-pen" aria-hidden="true"></i> Start with mine</button>
            <button type="button" class="rpg-accordion-action-btn" data-act="ask-again"${busy ? ' disabled' : ''}><i class="fa-solid fa-rotate" aria-hidden="true"></i> Ask again</button>
            <button type="button" class="rpg-accordion-action-btn" data-act="pick-none"${busy ? ' disabled' : ''} title="The chat opens empty; you write first"><i class="fa-solid fa-forward" aria-hidden="true"></i> Start without one</button>
            <button type="button" class="rpg-accordion-action-btn" data-act="sheet-close"${busy ? ' disabled' : ''}>Back</button>
        </div>
    </div>`;
}

/**
 * The End sheet (D122): the recap to read and edit, the scene's time, the
 * steps with their state, End scene, Keep playing.
 * @param {object} o
 * @param {{recap:string,error:string,from:string,to:string,steps:{canon:boolean,world:boolean},scene:object|null,mark:object}|null} o.prep
 * @param {boolean} o.busy      the recap is being written
 * @param {{recap:string,canon:string,world:string,snapshot:string}} o.states  'waiting'|'running'|'ok'|'failed'|'skipped'|'off'
 * @param {object|null} o.result   commitEnd's result
 * @param {string} o.error
 */
export function endSheetHtml({ prep = null, busy = false, states = {}, result = null, error = '' } = {}) {
    const scene = prep && (prep.scene || prep.mark) ? (prep.scene || prep.mark) : null;
    const title = scene ? `Scene ${e(sceneNo(scene.id || scene.scene))}${scene.title ? `: ${e(scene.title)}` : ''}` : 'This scene';
    const when = prep && (prep.from || prep.to) ? `From ${e(prep.from || '?')} to ${e(prep.to || 'now')}.` : '';
    const running = Object.values(states).includes('running');
    const done = !!(result && result.ok);
    const stateWord = { waiting: 'waiting', running: 'running…', ok: 'done', failed: 'failed', skipped: 'skipped', off: 'off', kept: 'kept as it was' };
    const step = (key, label, hint, on, skipId) => {
        const st = states[key] || (on ? 'waiting' : 'off');
        return `<li class="dooms-hub-step is-${attr(st)}">
            <span class="dooms-hub-step-label">${e(label)}<span class="dooms-hub-hint"> ${e(hint)}</span></span>
            ${skipId && on && !done && !running ? `<label class="dooms-hub-skip"><input type="checkbox" id="${attr(skipId)}"> skip</label>` : ''}
            <span class="dooms-hub-step-state">${e(stateWord[st] || st)}</span>
        </li>`;
    };
    const canonOn = !!(prep && prep.steps && prep.steps.canon);
    const worldOn = !!(prep && prep.steps && prep.steps.world);
    return `<div class="dooms-hub-sheet dooms-hub-sheet-end">
        <h4 class="dooms-hub-sheet-title">End ${title}</h4>
        ${when ? `<p class="dooms-hub-hint">${when}</p>` : ''}
        <div class="dooms-hub-field">
            <label for="dooms-hub-recap">What happened${busy ? ' (being written…)' : ''}</label>
            <textarea id="dooms-hub-recap" class="rpg-accordion-input" rows="5" placeholder="${busy ? 'The narrator is writing the record of the scene…' : 'What happened in this scene, in a few lines; the next scene reads it'}"${done ? ' readonly' : ''}>${prep && prep.recap ? e(prep.recap) : ''}</textarea>
            ${prep && prep.error ? `<p class="dooms-hub-note">The recap could not be written: ${e(prep.error)}. Write it yourself, or end without one.</p>` : ''}
        </div>
        ${prep && prep.stale && !done ? `<div class="dooms-hub-stale"><p class="dooms-hub-note">This scene began before a later scene ended, so the world's memory is newer than it. Ending it keeps the world's memory as it is (the recap is kept, the ledger reads the scene, nothing of the newer scene is lost).</p><label class="dooms-hub-skip"><input type="checkbox" id="dooms-hub-replace"> Replace the world's memory with this scene's instead</label></div>` : ''}
        <ul class="dooms-hub-steps">
            ${step('recap', 'The recap', 'kept with the scene', true, '')}
            ${step('canon', 'The ledger', canonOn ? (prep && prep.canonDone ? 'already read for this reply' : 'Canon reads the whole scene') : 'Canon is off', canonOn, 'dooms-hub-skip-canon')}
            ${step('world', 'The world', worldOn ? 'the world\'s memory moves for the scene\'s time; the chat itself is not touched' : 'Live World has no world here', worldOn, 'dooms-hub-skip-world')}
            ${step('snapshot', 'The snapshot', 'everything the chat knows, kept for the next scene', true, '')}
        </ul>
        ${result && result.ok ? `<p class="dooms-hub-done"><i class="fa-solid fa-check" aria-hidden="true"></i> The scene is ended and remembered.</p>` : ''}
        ${error ? `<p class="dooms-hub-note">${e(error)}</p>` : ''}
        <div class="dooms-hub-sheet-actions">
            ${done
                ? `<button type="button" class="rpg-accordion-action-btn" data-act="to-hub"><i class="fa-solid fa-compass" aria-hidden="true"></i> To the hub</button><button type="button" class="rpg-accordion-action-btn" data-act="sheet-close">Close</button>`
                : `<button type="button" class="rpg-accordion-action-btn" data-act="end-go"${busy || running ? ' disabled' : ''}><i class="fa-solid fa-flag-checkered" aria-hidden="true"></i> ${running ? 'Ending…' : 'End scene'}</button><button type="button" class="rpg-accordion-action-btn" data-act="sheet-close"${running ? ' disabled' : ''}>Keep playing</button>`}
        </div>
    </div>`;
}

/**
 * The strip across the top of a scene chat (D121): the scene's number, its
 * place and date, Hub and End scene; ended: Hub and Reopen.
 * @param {{ mark: object, scene?: object|null, ended: boolean }} o
 */
export function stripHtml({ mark = null, scene = null, ended = false } = {}) {
    const id = (scene && scene.id) || (mark && mark.scene) || '';
    const title = (scene && scene.title) || (mark && mark.title) || '';
    const place = mark && mark.place && mark.place.label ? mark.place.label : (scene && scene.place ? scene.place.label : '');
    const date = mark && mark.startDate ? mark.startDate : (scene && scene.startDate ? scene.startDate : '');
    const text = [`Scene ${sceneNo(id)}${title ? `: ${title}` : ''}`, ended ? 'ended' : place, ended ? (mark && mark.endDate ? mark.endDate : '') : date].filter(Boolean).join(' · ');
    const actions = ended
        ? `<button type="button" class="rpg-accordion-action-btn" data-act="hub"><i class="fa-solid fa-compass" aria-hidden="true"></i> Hub</button><button type="button" class="rpg-accordion-action-btn" data-act="reopen" title="Play on; End again replaces the recap and the snapshot"><i class="fa-solid fa-rotate-left" aria-hidden="true"></i> Reopen</button>`
        : `<button type="button" class="rpg-accordion-action-btn" data-act="hub"><i class="fa-solid fa-compass" aria-hidden="true"></i> Hub</button><button type="button" class="rpg-accordion-action-btn" data-act="end"><i class="fa-solid fa-flag-checkered" aria-hidden="true"></i> End scene</button>`;
    return `<div class="dooms-strip-text"><i class="fa-solid fa-compass" aria-hidden="true"></i><span>${e(text)}</span></div><div class="dooms-strip-actions">${actions}</div>`;
}
