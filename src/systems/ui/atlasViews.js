/**
 * The Atlas's views (docs/long-shot-plan.md D142, D146, D147, D151): pure
 * HTML from the model. The window's shell (the sidebar, the stage the map
 * mounts in, the tools), the sidebar's head, tabs and Places tab (the
 * tray of what is not on the map yet, the search, the kinds with their
 * counts, the list, what was deleted), a marker, a region's name, the
 * card a marker opens (as it reads, being edited, being merged). No DOM,
 * no SillyTavern: tools/atlas-browser-test.mjs renders them in a headless
 * browser; src/systems/ui/atlas.js puts them on the page and acts on them.
 */
import { escapeHtml } from '../../utils/html.js';
import { kindOf, kindCounts, filterMarkers, ATLAS_KINDS, ATLAS_SCALES } from '../../utils/atlas.js';
import { safeImageUrl } from '../../utils/worldBoard.js';

export const ATLAS_ID = 'dooms-atlas';

/** The sidebar's tabs, in order. */
export const ATLAS_TABS = Object.freeze([
    { id: 'places', label: 'Places', icon: 'fa-location-dot' },
    { id: 'people', label: 'People', icon: 'fa-users' },
    { id: 'news', label: 'News', icon: 'fa-newspaper' },
    { id: 'rumours', label: 'Rumours', icon: 'fa-comments' },
    { id: 'hooks', label: 'Hooks', icon: 'fa-signs-post' },
]);

const e = escapeHtml;
const attr = (v) => escapeHtml(String(v ?? ''));
const MAX_FACES = 3;

/** Two letters for a name, for a face without a portrait. */
export function initialsOf(name) {
    const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '?';
    return (parts.length === 1 ? parts[0].slice(0, 2) : parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** The compass in the map's corner: a drawing, no more. */
const COMPASS = '<svg class="dooms-atlas-compass" viewBox="-50 -50 100 100" aria-hidden="true"><circle r="34" fill="none" stroke="currentColor" stroke-width="1"/><circle r="29" fill="none" stroke="currentColor" stroke-width="0.5" stroke-dasharray="1 3"/><path d="M0 -46 L7 -7 L46 0 L7 7 L0 46 L-7 7 L-46 0 L-7 -7 Z" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><path d="M0 -46 L7 -7 L0 0 Z M46 0 L7 7 L0 0 Z M0 46 L-7 7 L0 0 Z M-46 0 L-7 -7 L0 0 Z" fill="currentColor"/><path d="M22 -22 L5 -5 M22 22 L5 5 M-22 22 L-5 5 M-22 -22 L-5 -5" stroke="currentColor" stroke-width="1"/><text y="-36" text-anchor="middle" font-size="0" fill="currentColor">N</text></svg>';

/** The window's shell: the sidebar, the stage with the map's frame, the tools, the word across the top while something waits for a click, the scale. The controller fills the sidebar. */
export function atlasShellHtml() {
    const tool = (act, icon, title, extra = '') => `<button type="button" class="dooms-atlas-tool${extra}" data-act="${act}" title="${attr(title)}" aria-label="${attr(title)}"><i class="fa-solid ${icon}" aria-hidden="true"></i></button>`;
    return `<div id="${ATLAS_ID}" class="dooms-atlas" role="dialog" aria-modal="true" aria-label="The Atlas" style="display: none;">
        <aside class="dooms-atlas-side" aria-label="The world"></aside>
        <div class="dooms-atlas-stage">
            <div class="dooms-atlas-map" aria-label="The map"></div>
            <div class="dooms-atlas-paper" aria-hidden="true"></div>
            ${COMPASS}
            <div class="dooms-atlas-empty" hidden></div>
            <div class="dooms-atlas-start" hidden></div>
            <p class="dooms-atlas-hint" role="status" hidden></p>
            <div class="dooms-atlas-tools">
                ${tool('fold', 'fa-bars', 'Hide or show the sidebar')}
                ${tool('add', 'fa-map-pin', 'Add a marker: click this, then the map', ' is-edit')}
                ${tool('move', 'fa-up-down-left-right', 'Move markers: while this is on, drag a marker to where it belongs', ' is-edit')}
                ${tool('base', 'fa-image', 'Switch between this world\'s picture and the drawn map', ' is-base')}
                ${tool('party', 'fa-location-crosshairs', 'Find the party')}
                ${tool('fit', 'fa-expand', 'The whole map')}
                ${tool('close', 'fa-xmark', 'Close (Esc)', ' is-close')}
            </div>
            <div class="dooms-atlas-scale" aria-hidden="true"><span class="dooms-atlas-scale-bar"></span><span class="dooms-atlas-scale-text"></span></div>
        </div>
    </div>`;
}

/**
 * The panel in the middle of a map with nothing on it (D151): how the map
 * is made. The drawn map is not generated up front: the land draws itself
 * around the places as they are put down.
 * @param {object} o
 * @param {number} o.waiting   the places in the tray
 * @param {boolean} o.picture  the world's own picture is showing
 */
export function atlasStartHtml({ waiting = 0, picture = false } = {}) {
    const lead = picture
        ? 'This world\'s picture is the map. Put the places on it.'
        : 'The map draws itself around your places: land appears wherever you put one, and the paths join them.';
    const how = waiting
        ? `<p>${waiting === 1 ? 'One place is' : `${waiting} places are`} waiting in the list on the left.</p>
           <div class="dooms-atlas-start-actions">
               <button type="button" class="dooms-atlas-btn is-primary" data-act="place-all"><i class="fa-solid fa-wand-magic-sparkles" aria-hidden="true"></i> <span>Place ${waiting === 1 ? 'it' : `all ${waiting}`} for me</span></button>
               <button type="button" class="dooms-atlas-btn" data-act="start-dismiss"><i class="fa-solid fa-hand-pointer" aria-hidden="true"></i> <span>I'll place them myself</span></button>
           </div>
           <p class="dooms-atlas-start-note">Placed for you, they land at free spots and you drag them to where they belong (the arrows button, top right). Placing them yourself: drag a place from the list onto the map.</p>`
        : `<p>This world has no places yet. They appear in the list on the left as the story names them.</p>
           <div class="dooms-atlas-start-actions">
               <button type="button" class="dooms-atlas-btn is-primary" data-act="add"><i class="fa-solid fa-map-pin" aria-hidden="true"></i> <span>Add a place by hand</span></button>
               <button type="button" class="dooms-atlas-btn" data-act="start-dismiss">Not now</button>
           </div>`;
    return `<div class="dooms-atlas-start-card"><h3>Start your map</h3><p>${lead}</p>${how}</div>`;
}

/** A kind's switch: the icon, the name, the count; struck through while off. */
function kindHtml(k, off) {
    return `<button type="button" class="dooms-atlas-kind kind-${attr(k.id)}${off ? ' is-off' : ''}" data-act="kind" data-kind="${attr(k.id)}" aria-pressed="${off ? 'false' : 'true'}" title="${off ? 'Show' : 'Hide'} ${attr(k.label.toLowerCase())}">
        <span class="dooms-atlas-kind-icon"><i class="fa-solid ${attr(k.icon)}" aria-hidden="true"></i></span>
        <span class="dooms-atlas-kind-label">${e(k.label)}</span>
        <span class="dooms-atlas-kind-count">${k.count}</span>
    </button>`;
}

const hereChip = '<span class="dooms-atlas-here" title="The party is here">You are here</span>';
const peopleChip = (m) => (m.people && m.people.length ? `<span class="dooms-atlas-row-people" title="${attr(m.people.join(', '))}"><i class="fa-solid fa-user" aria-hidden="true"></i> ${m.people.length}</span>` : '');

/**
 * The tray (D145): what is not on the map yet. A row is dragged onto the
 * map, or tapped and then the map is tapped (`armed` is the row waiting
 * for that tap); its bin deletes it for good. Place all puts every one
 * where the layout proposes.
 */
export function atlasTrayHtml({ tray = [], armed = '' } = {}) {
    if (!tray.length) return '';
    const row = (m) => {
        const k = kindOf(m.kind);
        const rooms = m.rooms && m.rooms.length ? ` title="${attr(`${m.label}: ${m.rooms.join(', ')}`)}"` : ` title="${attr(m.label)}"`;
        return `<li class="dooms-atlas-tray-row kind-${attr(m.kind)}${armed === m.id ? ' is-armed' : ''}" draggable="true" data-id="${attr(m.id)}">
            <button type="button" class="dooms-atlas-row" data-act="arm" data-id="${attr(m.id)}"${rooms}>
                <i class="fa-solid ${attr(k.icon)}" aria-hidden="true"></i><span class="dooms-atlas-row-name">${e(m.label)}</span>${m.player ? hereChip : ''}${peopleChip(m)}
            </button>
            <button type="button" class="dooms-atlas-icon-btn" data-act="delete" data-id="${attr(m.id)}" title="Delete ${attr(m.label)}: it will not come back when the story names it again" aria-label="Delete ${attr(m.label)}"><i class="fa-solid fa-trash-can" aria-hidden="true"></i></button>
        </li>`;
    };
    return `<section class="dooms-atlas-tray" aria-label="Not on the map yet">
        <div class="dooms-atlas-tray-head">
            <span class="dooms-atlas-group-head">Not on the map yet · ${tray.length}</span>
            <button type="button" class="dooms-atlas-link" data-act="place-all" title="Put every one of these on the map at a free spot; you can move them after">Place all</button>
        </div>
        <p class="dooms-atlas-tray-help">Drag a place onto the map, or tap it and then tap the map.</p>
        <ul>${tray.map(row).join('')}</ul>
    </section>`;
}

/**
 * The list under the kinds: the markers the search and the switches
 * leave, under their regions, each a way to its spot on the map.
 */
export function atlasResultsHtml({ markers = [], query = '', hidden = [] } = {}) {
    const shown = filterMarkers(markers, { query, hidden });
    if (!shown.length) return `<p class="dooms-atlas-none">${query ? 'Nothing on the map matches.' : (markers.length ? 'Every kind is switched off.' : 'Nothing is on the map yet.')}</p>`;
    const groups = new Map();
    for (const m of shown) {
        const key = m.regionLabel || '';
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(m);
    }
    const row = (m) => {
        const k = kindOf(m.kind);
        return `<li><button type="button" class="dooms-atlas-row kind-${attr(m.kind)}${m.visited ? ' is-visited' : ''}" data-act="goto" data-id="${attr(m.id)}" title="Show ${attr(m.label)} on the map">
            <i class="fa-solid ${attr(k.icon)}" aria-hidden="true"></i><span class="dooms-atlas-row-name">${e(m.label)}</span>${m.player ? hereChip : ''}${peopleChip(m)}
        </button></li>`;
    };
    return [...groups.entries()].map(([label, list]) => `<section class="dooms-atlas-group">${label ? `<span class="dooms-atlas-group-head">${e(label)}</span>` : (groups.size > 1 ? '<span class="dooms-atlas-group-head">Elsewhere</span>' : '')}<ul>${list.map(row).join('')}</ul></section>`).join('');
}

/**
 * The clean-up pass (D155): the button that asks for it, and what it
 * proposed, each to be approved or passed over.
 * @param {{ busy: boolean, items: Array, error: string, asked: boolean }|null} tidy
 */
export function atlasTidyHtml(tidy, { count = 0 } = {}) {
    const t = tidy || { busy: false, items: [], error: '', asked: false };
    if (count < 2 && !t.items.length) return '';
    const item = (x, i) => `<li class="dooms-atlas-tidy-item is-${attr(x.kind)}">
            <span class="dooms-atlas-tidy-text">${x.kind === 'merge' ? `Merge <strong>${e(x.label)}</strong> into <strong>${e(x.toLabel)}</strong>` : `Delete <strong>${e(x.label)}</strong>`}${x.why ? `<span class="dooms-atlas-tidy-why">${e(x.why)}</span>` : ''}</span>
            <button type="button" class="dooms-atlas-icon-btn is-yes" data-act="tidy-yes" data-i="${i}" title="Do it" aria-label="Do it"><i class="fa-solid fa-check" aria-hidden="true"></i></button>
            <button type="button" class="dooms-atlas-icon-btn" data-act="tidy-no" data-i="${i}" title="Leave it as it is" aria-label="Leave it as it is"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button>
        </li>`;
    const body = t.items.length
        ? `<ul>${t.items.map(item).join('')}</ul><div class="dooms-atlas-tidy-all"><button type="button" class="dooms-atlas-link" data-act="tidy-all">Do all ${t.items.length}</button><button type="button" class="dooms-atlas-link" data-act="tidy-none">Leave them all</button></div>`
        : (t.error ? `<p class="dooms-atlas-none is-error">${e(t.error)}</p>` : (t.asked && !t.busy ? '<p class="dooms-atlas-none">Nothing to tidy: no duplicates were found.</p>' : ''));
    return `<section class="dooms-atlas-tidy" aria-label="Clean up the places">
        <button type="button" class="dooms-atlas-btn" data-act="tidy"${t.busy ? ' disabled' : ''} title="Ask the AI to look over the places for duplicates and things that are not places. It only proposes: you approve each one."><i class="fa-solid fa-wand-magic-sparkles" aria-hidden="true"></i> <span>${t.busy ? 'Looking them over…' : 'Clean up with AI'}</span></button>
        ${body}
    </section>`;
}

/** What was deleted, folded away: each can be brought back. */
function deletedHtml(deleted) {
    if (!deleted.length) return '';
    return `<details class="dooms-atlas-deleted"><summary>Deleted · ${deleted.length}</summary><ul>${deleted.map(d => `<li><span class="dooms-atlas-row-name">${e(d.label)}</span><button type="button" class="dooms-atlas-link" data-act="restore" data-id="${attr(d.id)}">Restore</button></li>`).join('')}</ul></details>`;
}

/** The Places tab: the tray, the search, Show all and Hide all, the visited count, the kinds, the list, the scale, what was deleted. */
export function atlasPlacesHtml({ markers = [], tray = [], deleted = [], query = '', hidden = [], armed = '', scale = 'town', tidy = null } = {}) {
    const counts = kindCounts(markers);
    const off = new Set(hidden);
    const visited = markers.filter(m => m.visited).length;
    const scales = Object.entries(ATLAS_SCALES).map(([id, s]) => `<option value="${id}"${id === scale ? ' selected' : ''}>${e(s.label)}</option>`).join('');
    return `${atlasTrayHtml({ tray, armed })}
        ${atlasTidyHtml(tidy, { count: markers.length + tray.length })}
        <div class="dooms-atlas-search">
            <i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i>
            <input type="search" class="dooms-atlas-query" placeholder="Search places and people" aria-label="Search places and people" value="${attr(query)}" autocomplete="off" />
        </div>
        <div class="dooms-atlas-switches">
            <button type="button" class="dooms-atlas-link" data-act="kinds-on">Show all</button>
            <button type="button" class="dooms-atlas-link" data-act="kinds-off">Hide all</button>
            <span class="dooms-atlas-visited" title="Places on the map the story has been to">${markers.length ? `Visited ${visited} of ${markers.length}` : ''}</span>
        </div>
        <div class="dooms-atlas-kinds">${counts.map(k => kindHtml(k, off.has(k.id))).join('')}</div>
        <div class="dooms-atlas-results">${atlasResultsHtml({ markers, query, hidden })}</div>
        <label class="dooms-atlas-scale-pick" title="How far apart the places are: it sets the distances and the travel times">This map is of <select class="dooms-atlas-scale-select" aria-label="What this map is of">${scales}</select></label>
        ${deletedHtml(deleted)}`;
}

/**
 * The sidebar: the world's name with the date and the place, the tabs,
 * the tab's body (`body` is the tab's HTML: Places from atlasPlacesHtml,
 * the others from Live World's own views), the foot.
 */
export function atlasSideHtml({ name = 'The world', facts = {}, tab = 'places', body = '', status = '', result = '', canAdvance = false, advancing = false, editLabel = 'Edit this world' } = {}) {
    const active = ATLAS_TABS.some(t => t.id === tab) ? tab : ATLAS_TABS[0].id;
    const when = [facts.date, facts.time].filter(Boolean).join(', ');
    const tabs = ATLAS_TABS.map(t => `<button type="button" class="dooms-atlas-tab${t.id === active ? ' is-active' : ''}" data-act="tab" data-tab="${t.id}" role="tab" aria-selected="${t.id === active ? 'true' : 'false'}" title="${attr(t.label)}"><i class="fa-solid ${t.icon}" aria-hidden="true"></i><span>${e(t.label)}</span></button>`).join('');
    return `<header class="dooms-atlas-head">
            <h2 class="dooms-atlas-title">${e(name || 'The world')}</h2>
            <p class="dooms-atlas-sub">${when ? e(when) : 'No date in the tracker yet'}${facts.weather ? ` · ${e(facts.weather)}` : ''}</p>
            ${facts.location ? `<p class="dooms-atlas-sub is-place"><i class="fa-solid fa-location-dot" aria-hidden="true"></i> ${e(facts.location)}</p>` : ''}
        </header>
        <nav class="dooms-atlas-tabs" role="tablist" aria-label="The world">${tabs}</nav>
        <div class="dooms-atlas-body" role="tabpanel" data-tab="${active}">${body}</div>
        <footer class="dooms-atlas-foot">
            <p class="dooms-atlas-status">${status}</p>
            <p class="dooms-atlas-result" role="status">${e(result)}</p>
            <div class="dooms-atlas-foot-actions">
                <button type="button" class="dooms-atlas-btn" data-act="advance"${canAdvance && !advancing ? '' : ' disabled'} title="Move the world on now: the people, the clocks, the news"><i class="fa-solid fa-forward" aria-hidden="true"></i> <span>${advancing ? 'Advancing…' : 'Advance now'}</span></button>
                <button type="button" class="dooms-atlas-btn" data-act="edit" title="Open this chat's world in the World Builder"><i class="fa-solid fa-pen" aria-hidden="true"></i> <span>${e(editLabel)}</span></button>
            </div>
        </footer>`;
}

/** A marker's HTML: the pin with its kind's icon, the party's flag, the faces of the people there, the weather, the name under it. */
export function atlasMarkerHtml(m, { portraits = () => '' } = {}) {
    const k = kindOf(m.kind);
    const names = Array.isArray(m.people) ? m.people : [];
    const faces = names.length
        ? `<span class="dooms-atlas-faces">${names.slice(0, MAX_FACES).map(n => { const p = safeImageUrl(portraits(n)); return p ? `<span class="dooms-atlas-face has-picture" title="${attr(n)}" style="background-image: url('${attr(p)}')"></span>` : `<span class="dooms-atlas-face" title="${attr(n)}">${e(initialsOf(n))}</span>`; }).join('')}${names.length > MAX_FACES ? `<span class="dooms-atlas-face is-more" title="${attr(names.slice(MAX_FACES).join(', '))}">+${names.length - MAX_FACES}</span>` : ''}</span>`
        : '';
    const weather = m.weather && m.weather.emoji ? `<span class="dooms-atlas-weather" title="${attr(m.weather.text)}">${e(m.weather.emoji)}</span>` : '';
    const party = m.player ? '<span class="dooms-atlas-party" title="The party is here"><i class="fa-solid fa-flag" aria-hidden="true"></i></span>' : '';
    return `<span class="dooms-atlas-pin"><i class="fa-solid ${attr(k.icon)}" aria-hidden="true"></i></span>${party}${faces}${weather}<span class="dooms-atlas-label">${e(m.label)}</span>`;
}

/** A marker's classes: its kind, whether it was visited, whether the party is there. */
export function atlasMarkerClass(m) {
    return ['dooms-atlas-marker', `kind-${m.kind}`, m.visited ? 'is-visited' : '', m.player ? 'is-player' : ''].filter(Boolean).join(' ');
}

/** A region's name, written across its land. */
export function atlasRegionHtml(r) {
    return `<span class="dooms-atlas-region-name">${e(r.label)}</span>`;
}

/**
 * The card a marker opens (D142, D151): the place, its kind and where it
 * is, its note, its rooms and other names, who is there, the weather, how
 * far the party is; Travel here; the rumours and the news that name it;
 * and what can be done to the marker: edit it, merge it into another,
 * take it off the map, delete it.
 * @param {object} o
 * @param {object} o.marker
 * @param {'view'|'edit'|'merge'} o.mode
 * @param {Array<{id:string,label:string}>} o.others  what it can be merged into
 * @param {string} o.distance     "3 miles, about an hour on foot", or ''
 * @param {boolean} o.canTravel   Live World is on and a chat is open
 * @param {boolean} o.travelling  a journey is being asked for
 * @param {string[]} o.rumours    what the street says that names the place
 * @param {string[]} o.news       the changes that name the place
 * @param {Function} o.portraits  name -> a portrait URL or ''
 */
export function atlasCardHtml({ marker = null, mode = 'view', others = [], distance = '', canTravel = false, travelling = false, rumours = [], news = [], portraits = () => '' } = {}) {
    const m = marker;
    if (!m) return '';
    const k = kindOf(m.kind);
    const id = attr(m.id);
    const head = `<header class="dooms-atlas-card-head">
            <span class="dooms-atlas-pin"><i class="fa-solid ${attr(k.icon)}" aria-hidden="true"></i></span>
            <div>
                <h3 class="dooms-atlas-card-title">${e(m.label)}</h3>
                <p class="dooms-atlas-card-kind">${e(k.label)}${m.regionLabel ? ` · ${e(m.regionLabel)}` : ''}${m.visited ? ' · visited' : ''}</p>
            </div>
        </header>`;
    if (mode === 'edit') {
        const kinds = ATLAS_KINDS.filter(x => x.id !== 'region').map(x => `<option value="${x.id}"${x.id === m.kind ? ' selected' : ''}>${e(x.label)}</option>`).join('');
        return `<article class="dooms-atlas-card is-editing kind-${attr(m.kind)}" data-id="${id}">
            <label class="dooms-atlas-field"><span class="dooms-atlas-card-label">Name</span><input type="text" class="dooms-atlas-input" data-field="label" maxlength="80" value="${attr(m.label)}" /></label>
            <label class="dooms-atlas-field"><span class="dooms-atlas-card-label">Kind</span><select class="dooms-atlas-input" data-field="kind">${kinds}</select></label>
            <label class="dooms-atlas-field"><span class="dooms-atlas-card-label">Note</span><textarea class="dooms-atlas-input" data-field="note" maxlength="300" rows="3" placeholder="A sentence about the place">${e(m.note || '')}</textarea></label>
            <div class="dooms-atlas-card-actions">
                <button type="button" class="dooms-atlas-btn is-primary" data-act="edit-save" data-id="${id}"><i class="fa-solid fa-check" aria-hidden="true"></i> <span>Save</span></button>
                <button type="button" class="dooms-atlas-btn" data-act="card-view" data-id="${id}">Cancel</button>
            </div>
        </article>`;
    }
    if (mode === 'merge') {
        const options = others.map(o => `<option value="${attr(o.id)}">${e(o.label)}</option>`).join('');
        return `<article class="dooms-atlas-card is-editing kind-${attr(m.kind)}" data-id="${id}">
            ${head}
            <p class="dooms-atlas-card-note">Merge this into another place: this marker goes, and its names, its rooms, its people and its visits count at the other one from now on.</p>
            ${others.length
                ? `<label class="dooms-atlas-field"><span class="dooms-atlas-card-label">Merge into</span><select class="dooms-atlas-input" data-field="target">${options}</select></label>
                   <div class="dooms-atlas-card-actions">
                       <button type="button" class="dooms-atlas-btn is-primary" data-act="merge-go" data-id="${id}"><i class="fa-solid fa-code-merge" aria-hidden="true"></i> <span>Merge</span></button>
                       <button type="button" class="dooms-atlas-btn" data-act="card-view" data-id="${id}">Cancel</button>
                   </div>`
                : `<p class="dooms-atlas-card-note">There is no other place to merge it into yet.</p><div class="dooms-atlas-card-actions"><button type="button" class="dooms-atlas-btn" data-act="card-view" data-id="${id}">Back</button></div>`}
        </article>`;
    }
    const picture = safeImageUrl(m.image);
    const people = (m.people || []).length
        ? `<div class="dooms-atlas-card-people"><span class="dooms-atlas-card-label">Here</span>${m.people.map(n => { const p = safeImageUrl(portraits(n)); return `<button type="button" class="dooms-atlas-chip" data-act="person" data-name="${attr(n)}" title="${attr(n)}: where they have been">${p ? `<span class="dooms-atlas-face has-picture" style="background-image: url('${attr(p)}')"></span>` : `<span class="dooms-atlas-face">${e(initialsOf(n))}</span>`}<span>${e(n)}</span></button>`; }).join('')}</div>`
        : '';
    const list = (label, items) => (items.length ? `<div class="dooms-atlas-card-list"><span class="dooms-atlas-card-label">${label}</span><ul>${items.slice(0, 4).map(t => `<li>${e(t)}</li>`).join('')}</ul></div>` : '');
    const rooms = (m.rooms || []).length ? `<p class="dooms-atlas-card-rooms"><span class="dooms-atlas-card-label">Inside</span>${e(m.rooms.join(' · '))}</p>` : '';
    const names = (m.names || []).length
        ? `<div class="dooms-atlas-card-names"><span class="dooms-atlas-card-label">Also called</span>${m.names.map(n => `<span class="dooms-atlas-chip is-name">${e(n.label)}<button type="button" class="dooms-atlas-chip-x" data-act="unmerge" data-id="${attr(n.id)}" title="Split ${attr(n.label)} off again" aria-label="Split ${attr(n.label)} off again">&times;</button></span>`).join('')}</div>`
        : '';
    const where = m.player
        ? '<p class="dooms-atlas-card-where is-here"><i class="fa-solid fa-flag" aria-hidden="true"></i> You are here</p>'
        : (distance ? `<p class="dooms-atlas-card-where"><i class="fa-solid fa-route" aria-hidden="true"></i> ${e(distance)}</p>` : '');
    const travel = m.player
        ? ''
        : `<div class="dooms-atlas-card-travel">
            <input type="text" class="dooms-atlas-when" maxlength="80" placeholder="arriving when… (optional)" aria-label="Arriving when" />
            <button type="button" class="dooms-atlas-btn is-primary" data-act="travel" data-id="${id}"${canTravel && !travelling ? '' : ' disabled'} title="${canTravel ? 'The next reply montages the road, then the arrival' : 'Travel needs Live World on and a chat open'}"><i class="fa-solid fa-person-walking" aria-hidden="true"></i> <span>${travelling ? 'Setting out…' : 'Travel here'}</span></button>
        </div>`;
    const tool = (act, icon, label, title) => `<button type="button" class="dooms-atlas-card-tool" data-act="${act}" data-id="${id}" title="${attr(title)}"><i class="fa-solid ${icon}" aria-hidden="true"></i><span>${label}</span></button>`;
    return `<article class="dooms-atlas-card kind-${attr(m.kind)}" data-id="${id}">
        ${picture ? `<div class="dooms-atlas-card-picture" style="background-image: url('${attr(picture)}')"></div>` : ''}
        ${head}
        ${m.note ? `<p class="dooms-atlas-card-note">${e(m.note)}</p>` : ''}
        ${rooms}
        ${names}
        ${m.weather && (m.weather.text || m.weather.emoji) ? `<p class="dooms-atlas-card-weather">${e(m.weather.emoji)} ${e(m.weather.text)}</p>` : ''}
        ${where}
        ${people}
        ${list('Rumours', rumours)}
        ${list('Lately', news)}
        ${travel}
        <div class="dooms-atlas-card-tools">
            ${tool('card-edit', 'fa-pen', 'Edit', 'Change the name, the kind or the note')}
            ${tool('card-merge', 'fa-code-merge', 'Merge', 'Merge this into another place')}
            ${tool('unplace', 'fa-arrow-right-from-bracket', 'Take off', 'Take it off the map: it waits in the tray again')}
            ${tool('delete', 'fa-trash-can', 'Delete', 'Delete it for good: it will not come back when the story names it again')}
        </div>
    </article>`;
}

/** The scale bar's figures at a zoom: the round length that fits `maxPx`, its width and its words. `perPx` is world units in one screen pixel. */
export function scaleBarFor(perPx, maxPx = 120) {
    if (!(perPx > 0)) return { px: 0, length: 0 };
    const max = perPx * maxPx;
    const pow = Math.pow(10, Math.floor(Math.log10(max)));
    const length = [5, 2, 1].map(n => n * pow).find(n => n <= max) || pow;
    return { px: Math.round(length / perPx), length: Number(length.toPrecision(3)) };
}
