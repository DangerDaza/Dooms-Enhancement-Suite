/**
 * The Atlas's views (docs/long-shot-plan.md D142, D146, D147): pure HTML
 * from the model. The window's shell (the sidebar, the stage the map
 * mounts in, the tools), the sidebar's head, tabs and Places tab (the
 * search, the kinds with their counts, the list), a marker, the card a
 * marker opens. No DOM, no SillyTavern: tools/atlas-browser-test.mjs
 * renders them in a headless browser; src/systems/ui/atlas.js puts them
 * on the page and acts on them.
 */
import { escapeHtml } from '../../utils/html.js';
import { kindOf, kindCounts, filterMarkers } from '../../utils/atlas.js';
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

/** The window's shell: the sidebar, its fold, the stage with the map's frame, the tools and the scale. The controller fills the sidebar. */
export function atlasShellHtml() {
    return `<div id="${ATLAS_ID}" class="dooms-atlas" role="dialog" aria-modal="true" aria-label="The Atlas" style="display: none;">
        <aside class="dooms-atlas-side" aria-label="The world"></aside>
        <div class="dooms-atlas-stage">
            <div class="dooms-atlas-map" aria-label="The map"></div>
            <div class="dooms-atlas-empty" hidden></div>
            <div class="dooms-atlas-tools">
                <button type="button" class="dooms-atlas-tool" data-act="fold" title="Hide or show the sidebar" aria-label="Hide or show the sidebar"><i class="fa-solid fa-bars" aria-hidden="true"></i></button>
                <button type="button" class="dooms-atlas-tool" data-act="party" title="Find the party" aria-label="Find the party"><i class="fa-solid fa-location-crosshairs" aria-hidden="true"></i></button>
                <button type="button" class="dooms-atlas-tool" data-act="fit" title="The whole map" aria-label="The whole map"><i class="fa-solid fa-expand" aria-hidden="true"></i></button>
                <button type="button" class="dooms-atlas-tool is-close" data-act="close" title="Close (Esc)" aria-label="Close"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button>
            </div>
            <div class="dooms-atlas-scale" aria-hidden="true"><span class="dooms-atlas-scale-bar"></span><span class="dooms-atlas-scale-text"></span></div>
        </div>
    </div>`;
}

/** A kind's switch: the icon, the name, the count; struck through while off. */
function kindHtml(k, off) {
    return `<button type="button" class="dooms-atlas-kind kind-${attr(k.id)}${off ? ' is-off' : ''}" data-act="kind" data-kind="${attr(k.id)}" aria-pressed="${off ? 'false' : 'true'}" title="${off ? 'Show' : 'Hide'} ${attr(k.label.toLowerCase())}">
        <span class="dooms-atlas-kind-icon"><i class="fa-solid ${attr(k.icon)}" aria-hidden="true"></i></span>
        <span class="dooms-atlas-kind-label">${e(k.label)}</span>
        <span class="dooms-atlas-kind-count">${k.count}</span>
    </button>`;
}

/**
 * The list under the kinds: the markers the search and the switches
 * leave, under their regions, each a way to its spot on the map.
 */
export function atlasResultsHtml({ markers = [], query = '', hidden = [] } = {}) {
    const shown = filterMarkers(markers, { query, hidden });
    if (!shown.length) return `<p class="dooms-atlas-none">${query ? 'Nothing on the map matches.' : (markers.length ? 'Every kind is switched off.' : 'No places yet.')}</p>`;
    const groups = new Map();
    for (const m of shown) {
        const key = m.isRegion ? m.id : m.region;
        if (!groups.has(key)) groups.set(key, { label: m.isRegion ? m.label : m.regionLabel, region: null, places: [] });
        if (m.isRegion) groups.get(key).region = m;
        else groups.get(key).places.push(m);
    }
    const row = (m) => {
        const k = kindOf(m.kind);
        const marks = `${m.player ? '<span class="dooms-atlas-here" title="The party is here">You are here</span>' : ''}${m.people.length ? `<span class="dooms-atlas-row-people" title="${attr(m.people.join(', '))}"><i class="fa-solid fa-user" aria-hidden="true"></i> ${m.people.length}</span>` : ''}`;
        return `<li><button type="button" class="dooms-atlas-row kind-${attr(m.kind)}${m.visited ? ' is-visited' : ''}" data-act="goto" data-id="${attr(m.id)}" title="Show ${attr(m.label)} on the map">
            <i class="fa-solid ${attr(k.icon)}" aria-hidden="true"></i><span class="dooms-atlas-row-name">${e(m.label)}</span>${marks}
        </button></li>`;
    };
    return [...groups.values()].map(g => {
        const head = g.region
            ? `<button type="button" class="dooms-atlas-group-head" data-act="goto" data-id="${attr(g.region.id)}" title="Show ${attr(g.label)} on the map">${e(g.label)}${g.region.player ? ' <span class="dooms-atlas-here">You are here</span>' : ''}</button>`
            : `<span class="dooms-atlas-group-head">${e(g.label || 'Elsewhere')}</span>`;
        return `<section class="dooms-atlas-group">${head}${g.places.length ? `<ul>${g.places.map(row).join('')}</ul>` : ''}</section>`;
    }).join('');
}

/** The Places tab: the search, Show all and Hide all, the visited count, the kinds, the list. */
export function atlasPlacesHtml({ markers = [], query = '', hidden = [] } = {}) {
    const counts = kindCounts(markers);
    const off = new Set(hidden);
    const total = markers.filter(m => !m.isRegion).length;
    const visited = markers.filter(m => !m.isRegion && m.visited).length;
    return `<div class="dooms-atlas-search">
            <i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i>
            <input type="search" class="dooms-atlas-query" placeholder="Search places and people" aria-label="Search places and people" value="${attr(query)}" autocomplete="off" />
        </div>
        <div class="dooms-atlas-switches">
            <button type="button" class="dooms-atlas-link" data-act="kinds-on">Show all</button>
            <button type="button" class="dooms-atlas-link" data-act="kinds-off">Hide all</button>
            <span class="dooms-atlas-visited" title="Places the story has been to">${total ? `Visited ${visited} of ${total}` : ''}</span>
        </div>
        <div class="dooms-atlas-kinds">${counts.map(k => kindHtml(k, off.has(k.id))).join('')}</div>
        <div class="dooms-atlas-results">${atlasResultsHtml({ markers, query, hidden })}</div>`;
}

/**
 * The sidebar: the world's name with the date and the place, the tabs,
 * the tab's body (`body` is the tab's HTML: Places from atlasPlacesHtml,
 * the others from Live World's own views), the foot.
 * @param {object} o
 * @param {string} o.name        the world's name
 * @param {{date?:string,time?:string,location?:string,weather?:string}} o.facts  the tracker's
 * @param {string} o.tab
 * @param {string} o.body
 * @param {string} o.status      when the world last moved (already escaped)
 * @param {string} o.result      the last result line
 * @param {boolean} o.canAdvance
 * @param {boolean} o.advancing
 * @param {string} o.editLabel   the foot's way to the World Builder
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

/** A marker's HTML: the pin with its kind's icon, the faces of the people there, the name under it. A region is its name alone. */
export function atlasMarkerHtml(m, { portraits = () => '' } = {}) {
    const k = kindOf(m.kind);
    const names = Array.isArray(m.people) ? m.people : [];
    const faces = names.length
        ? `<span class="dooms-atlas-faces">${names.slice(0, MAX_FACES).map(n => { const p = safeImageUrl(portraits(n)); return p ? `<span class="dooms-atlas-face has-picture" title="${attr(n)}" style="background-image: url('${attr(p)}')"></span>` : `<span class="dooms-atlas-face" title="${attr(n)}">${e(initialsOf(n))}</span>`; }).join('')}${names.length > MAX_FACES ? `<span class="dooms-atlas-face is-more" title="${attr(names.slice(MAX_FACES).join(', '))}">+${names.length - MAX_FACES}</span>` : ''}</span>`
        : '';
    const weather = m.weather && m.weather.emoji ? `<span class="dooms-atlas-weather" title="${attr(m.weather.text)}">${e(m.weather.emoji)}</span>` : '';
    const party = m.player ? '<span class="dooms-atlas-party" title="The party is here"><i class="fa-solid fa-flag" aria-hidden="true"></i></span>' : '';
    if (m.isRegion) return `<span class="dooms-atlas-region-name">${e(m.label)}</span>${party}${faces}${weather}`;
    return `<span class="dooms-atlas-pin"><i class="fa-solid ${attr(k.icon)}" aria-hidden="true"></i></span>${party}${faces}${weather}<span class="dooms-atlas-label">${e(m.label)}</span>`;
}

/** A marker's classes: its kind, its depth, whether it was visited, whether the party is there. */
export function atlasMarkerClass(m) {
    return ['dooms-atlas-marker', `kind-${m.kind}`, `depth-${Math.min(3, m.depth)}`, m.isRegion ? 'is-region' : '', m.visited ? 'is-visited' : '', m.player ? 'is-player' : '', m.by === 'user' ? 'is-pinned' : ''].filter(Boolean).join(' ');
}

/**
 * The card a marker opens (D142): the place, its kind and where it is,
 * its note, who is there, the weather, how far the party is; Travel here;
 * the rumours and the news that name it.
 * @param {object} o
 * @param {object} o.marker
 * @param {string} o.distance     "3 miles, about an hour on foot", or ''
 * @param {boolean} o.canTravel   Live World is on and a chat is open
 * @param {boolean} o.travelling  a journey is being asked for
 * @param {string[]} o.rumours    what the street says that names the place
 * @param {string[]} o.news       the changes that name the place
 * @param {Function} o.portraits  name -> a portrait URL or ''
 */
export function atlasCardHtml({ marker = null, distance = '', canTravel = false, travelling = false, rumours = [], news = [], portraits = () => '' } = {}) {
    const m = marker;
    if (!m) return '';
    const k = kindOf(m.kind);
    const inside = m.isRegion ? '' : [m.parentLabel && m.parentLabel !== m.regionLabel ? m.parentLabel : '', m.regionLabel].filter(Boolean).join(', ');
    const picture = safeImageUrl(m.image);
    const people = (m.people || []).length
        ? `<div class="dooms-atlas-card-people"><span class="dooms-atlas-card-label">Here</span>${m.people.map(n => { const p = safeImageUrl(portraits(n)); return `<button type="button" class="dooms-atlas-chip" data-act="person" data-name="${attr(n)}" title="${attr(n)}: where they have been">${p ? `<span class="dooms-atlas-face has-picture" style="background-image: url('${attr(p)}')"></span>` : `<span class="dooms-atlas-face">${e(initialsOf(n))}</span>`}<span>${e(n)}</span></button>`; }).join('')}</div>`
        : '';
    const list = (label, items) => (items.length ? `<div class="dooms-atlas-card-list"><span class="dooms-atlas-card-label">${label}</span><ul>${items.slice(0, 4).map(t => `<li>${e(t)}</li>`).join('')}</ul></div>` : '');
    const where = m.player
        ? '<p class="dooms-atlas-card-where is-here"><i class="fa-solid fa-flag" aria-hidden="true"></i> You are here</p>'
        : (distance ? `<p class="dooms-atlas-card-where"><i class="fa-solid fa-route" aria-hidden="true"></i> ${e(distance)}</p>` : '');
    const travel = m.player || m.id.startsWith('atlas:')    // the party's own place; the Elsewhere region, which is no place
        ? ''
        : `<div class="dooms-atlas-card-travel">
            <input type="text" class="dooms-atlas-when" maxlength="80" placeholder="arriving when… (optional)" aria-label="Arriving when" />
            <button type="button" class="dooms-atlas-btn is-primary" data-act="travel" data-id="${attr(m.id)}"${canTravel && !travelling ? '' : ' disabled'} title="${canTravel ? 'The next reply montages the road, then the arrival' : 'Travel needs Live World on and a chat open'}"><i class="fa-solid fa-person-walking" aria-hidden="true"></i> <span>${travelling ? 'Setting out…' : 'Travel here'}</span></button>
        </div>`;
    return `<article class="dooms-atlas-card kind-${attr(m.kind)}" data-id="${attr(m.id)}">
        ${picture ? `<div class="dooms-atlas-card-picture" style="background-image: url('${attr(picture)}')"></div>` : ''}
        <header class="dooms-atlas-card-head">
            <span class="dooms-atlas-pin"><i class="fa-solid ${attr(k.icon)}" aria-hidden="true"></i></span>
            <div>
                <h3 class="dooms-atlas-card-title">${e(m.label)}</h3>
                <p class="dooms-atlas-card-kind">${e(m.isRegion ? 'Region' : k.label)}${inside ? ` · ${e(inside)}` : ''}${m.visited ? ' · visited' : ''}</p>
            </div>
        </header>
        ${m.note ? `<p class="dooms-atlas-card-note">${e(m.note)}</p>` : ''}
        ${m.weather && (m.weather.text || m.weather.emoji) ? `<p class="dooms-atlas-card-weather">${e(m.weather.emoji)} ${e(m.weather.text)}</p>` : ''}
        ${where}
        ${people}
        ${list('Rumours', rumours)}
        ${list('Lately', news)}
        ${travel}
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
