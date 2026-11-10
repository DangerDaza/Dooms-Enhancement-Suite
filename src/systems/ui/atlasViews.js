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
import { kindOf, kindCounts, filterMarkers, ATLAS_KINDS, ATLAS_SCALES, ATLAS_GROUNDS } from '../../utils/atlas.js';
import { safeImageUrl } from '../../utils/worldBoard.js';
import { draftRows, draftChain } from '../../utils/atlasSetup.js';

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
            <div class="dooms-atlas-setup" role="dialog" aria-label="Set up this world" hidden></div>
            <nav class="dooms-atlas-trail" aria-label="Where this map is" hidden></nav>
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
 * The trail across the top of a map inside a place (D156): the world,
 * then each place down to the one whose map this is; every step but the
 * last goes back out to that map.
 * @param {object} o
 * @param {string} o.world   the world's name
 * @param {Array<{id:string,label:string}>} o.trail  from the top map down to this layer
 */
export function atlasTrailHtml({ world = 'The world', trail = [] } = {}) {
    if (!trail.length) return '';
    const steps = [{ id: '', label: world || 'The world' }, ...trail];
    const up = steps[steps.length - 2];
    return `<button type="button" class="dooms-atlas-trail-up" data-act="layer" data-id="${attr(up.id)}" title="Back out to ${attr(up.label)}" aria-label="Back out to ${attr(up.label)}"><i class="fa-solid fa-arrow-turn-up" aria-hidden="true"></i></button>`
        + steps.map((st, i) => (i === steps.length - 1
            ? `<span class="dooms-atlas-trail-here" aria-current="page">${e(st.label)}</span>`
            : `<button type="button" class="dooms-atlas-trail-step" data-act="layer" data-id="${attr(st.id)}" title="The map of ${attr(st.label)}">${e(st.label)}</button><i class="fa-solid fa-chevron-right dooms-atlas-trail-sep" aria-hidden="true"></i>`)).join('');
}

/**
 * The panel in the middle of a map with nothing on it (D151): how the map
 * is made. The drawn map is not generated up front: the land draws itself
 * around the places as they are put down.
 * @param {object} o
 * @param {number} o.waiting   the places in the tray
 * @param {boolean} o.picture  the world's own picture is showing
 */
export function atlasStartHtml({ waiting = 0, loose = 0, picture = false, layerLabel = '' } = {}) {
    const lead = picture
        ? 'This world\'s picture is the map. Put the places on it.'
        : layerLabel
            ? `This is the map inside ${e(layerLabel)}. It draws itself around the places you put here.`
            : 'The map draws itself around your places: land appears wherever you put one, and the paths join them.';
    const how = waiting
        ? `<p>${waiting === 1 ? 'One place is' : `${waiting} places are`} waiting in the list on the left.</p>
           <div class="dooms-atlas-start-actions">
               <button type="button" class="dooms-atlas-btn is-primary" data-act="place-all"><i class="fa-solid fa-wand-magic-sparkles" aria-hidden="true"></i> <span>Place ${waiting === 1 ? 'it' : `all ${waiting}`} for me</span></button>
               <button type="button" class="dooms-atlas-btn" data-act="start-dismiss"><i class="fa-solid fa-hand-pointer" aria-hidden="true"></i> <span>I'll place them myself</span></button>
           </div>
           <p class="dooms-atlas-start-note">Placed for you, they land at free spots and you drag them to where they belong (the arrows button, top right). Placing them yourself: drag a place from the list onto the map.</p>`
        : `<p>${layerLabel ? (loose ? `Nothing is inside ${e(layerLabel)} yet. Drag a place from the list on the left onto this map to put it in here, or add one by hand.` : `Nothing is inside ${e(layerLabel)} yet.`) : 'This world has no places yet. They appear in the list on the left as the story names them.'}</p>
           <div class="dooms-atlas-start-actions">
               <button type="button" class="dooms-atlas-btn is-primary" data-act="add"><i class="fa-solid fa-map-pin" aria-hidden="true"></i> <span>Add a place by hand</span></button>
               <button type="button" class="dooms-atlas-btn" data-act="start-dismiss">Not now</button>
           </div>`;
    const setup = layerLabel ? '' : `<div class="dooms-atlas-start-setup"><button type="button" class="dooms-atlas-btn is-primary" data-act="setup"><i class="fa-solid fa-compass-drafting" aria-hidden="true"></i> <span>Set up this world</span></button><p class="dooms-atlas-start-note">The AI drafts the places from your notes, the lore and the chat: what is inside what, placed for you. You check it first.</p><p class="dooms-atlas-start-or">or do it by hand:</p></div>`;
    return `<div class="dooms-atlas-start-card"><h3>${layerLabel ? `Inside ${e(layerLabel)}` : 'Start your map'}</h3><p>${lead}</p>${setup}${how}</div>`;
}

/**
 * Setting up a world's map (D143, D159), a panel over the map in three
 * steps: the player's notes and how much of the chat to read; the reading
 * and the drafting, with how far it is; the draft as a tree to correct,
 * and Apply.
 * @param {object} o
 * @param {'notes'|'busy'|'review'} o.step
 * @param {string} o.notes
 * @param {'recent'|'full'} o.reach
 * @param {{ messages: number, parts: number, skipped: number }} o.cost  what the whole chat would take to read
 * @param {{ done: number, total: number, word: string }} o.progress
 * @param {object|null} o.draft   parseSetup's draft
 * @param {string} o.error
 * @param {number} o.onMap        the markers and tray places the map has now (Apply replaces the map)
 * @param {string} o.note         a word above the review (parts that could not be read, messages left out)
 */
export function atlasSetupHtml({ step = 'notes', notes = '', reach = 'recent', cost = { messages: 0, parts: 0, skipped: 0 }, progress = { done: 0, total: 1, word: '' }, draft = null, error = '', onMap = 0, note = '' } = {}) {
    const err = error ? `<p class="dooms-atlas-setup-error" role="alert">${e(error)}</p>` : '';
    if (step === 'busy') {
        const pct = Math.max(4, Math.min(100, Math.round(100 * (progress.done + 0.5) / Math.max(1, progress.total))));
        return `<div class="dooms-atlas-setup-card is-busy">
            <h3>Setting up the world</h3>
            <p>${e(progress.word || 'Working…')}</p>
            <div class="dooms-atlas-setup-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><span style="width: ${pct}%"></span></div>
            <p class="dooms-atlas-start-note">Nothing on your map changes until you press Apply at the end.</p>
            <div class="dooms-atlas-setup-actions"><button type="button" class="dooms-atlas-btn" data-act="setup-stop">Stop</button></div>
        </div>`;
    }
    if (step === 'review' && draft) {
        const rows = draftRows(draft);
        const kinds = (cur) => ATLAS_KINDS.map(k => `<option value="${k.id}"${k.id === cur ? ' selected' : ''}>${e(k.label)}</option>`).join('');
        const insides = (p) => [`<option value=""${p.inside ? '' : ' selected'}>The top map</option>`, ...draft.places.filter(o => o.key !== p.key && !draftChain(draft, o.key).includes(p.key)).map(o => `<option value="${attr(o.key)}"${o.key === p.inside ? ' selected' : ''}>${e(o.name)}</option>`)].join('');
        const row = (p) => `<li class="dooms-atlas-setup-row${p.guess ? ' is-guess' : ''}" data-key="${attr(p.key)}" style="--depth: ${Math.min(5, p.depth)}">
                <span class="dooms-atlas-setup-name">
                    <input type="text" class="dooms-atlas-input" data-field="name" maxlength="80" value="${attr(p.name)}" aria-label="Name" />
                    ${p.guess ? '<span class="dooms-atlas-setup-guess" title="Nothing in your notes, the lore or the chat says this: the AI added it">guessed</span>' : ''}
                    ${p.was.length ? `<span class="dooms-atlas-setup-was" title="${attr(`Takes over: ${p.was.map(k => k.label).join(', ')}`)}">${p.was.length} merged in</span>` : ''}
                </span>
                <select class="dooms-atlas-input" data-field="kind" aria-label="Kind">${kinds(p.kind)}</select>
                <select class="dooms-atlas-input" data-field="inside" aria-label="Inside" title="Whose map this place is on">${insides(p)}</select>
                <button type="button" class="dooms-atlas-icon-btn" data-act="setup-remove" data-key="${attr(p.key)}" title="Leave ${attr(p.name)} out" aria-label="Leave ${attr(p.name)} out"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button>
            </li>`;
        const guesses = draft.places.filter(p => p.guess).length;
        return `<div class="dooms-atlas-setup-card is-review">
            <h3>Check the draft</h3>
            <p>${draft.places.length} ${draft.places.length === 1 ? 'place' : 'places'}${guesses ? `, ${guesses} of them guessed (marked)` : ''}. Fix a name, change what a place is inside of, or leave one out. Notes and positions can be changed on the map afterwards.</p>
            ${note ? `<p class="dooms-atlas-start-note">${e(note)}</p>` : ''}
            ${err}
            <div class="dooms-atlas-setup-head"><span>Place</span><span>Kind</span><span>Inside</span><span></span></div>
            <ul class="dooms-atlas-setup-list">${rows.map(row).join('')}</ul>
            ${draft.drop.length ? `<p class="dooms-atlas-start-note">Not places, to be deleted: ${e(draft.drop.map(k => k.label).join(', '))}.</p>` : ''}
            <p class="dooms-atlas-setup-warn"><i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i> Apply replaces the map this chat has now${onMap ? ` (${onMap} ${onMap === 1 ? 'place' : 'places'})` : ''}: every marker, where it was put, and what was merged or deleted. One Undo is kept until you close the Atlas.</p>
            <div class="dooms-atlas-setup-actions">
                <button type="button" class="dooms-atlas-btn is-primary" data-act="setup-apply"${draft.places.length ? '' : ' disabled'}><i class="fa-solid fa-check" aria-hidden="true"></i> <span>Apply: replace the map</span></button>
                <button type="button" class="dooms-atlas-btn" data-act="setup-back"><i class="fa-solid fa-rotate-left" aria-hidden="true"></i> <span>Back to my notes</span></button>
                <button type="button" class="dooms-atlas-btn" data-act="setup-close">Cancel</button>
            </div>
        </div>`;
    }
    const requests = cost.parts + 1;
    return `<div class="dooms-atlas-setup-card">
        <h3>Set up this world</h3>
        <p>First, what matters to you. The AI drafts the world's places around this, then you check the draft before anything changes.</p>
        <label class="dooms-atlas-field"><span class="dooms-atlas-card-label">Your notes (optional, and they outrank the lore and the chat)</span>
            <textarea class="dooms-atlas-input dooms-atlas-setup-notes" maxlength="3000" rows="7" placeholder="The places that matter, and what is inside what: &quot;Hask is a landlocked city. The house on the lane and the temple are in Hask. The black stair is a dungeon under the temple with many levels.&quot;&#10;Who is where. What must be true. What to leave out.">${e(notes)}</textarea></label>
        <fieldset class="dooms-atlas-setup-reach">
            <legend class="dooms-atlas-card-label">How much of the chat to read</legend>
            <label><input type="radio" name="dooms-atlas-reach" value="recent"${reach === 'full' ? '' : ' checked'} /> <span><strong>The recent scenes</strong> · one request. Good for a new chat, or when the lore and your notes carry the world.</span></label>
            <label><input type="radio" name="dooms-atlas-reach" value="full"${reach === 'full' ? ' checked' : ''} /> <span><strong>The whole chat</strong> · ${cost.messages} ${cost.messages === 1 ? 'message' : 'messages'}, ${requests} ${requests === 1 ? 'request' : 'requests'}. Finds every place the story has named; slower, and it costs that many requests.${cost.skipped ? ` The chat is longer than can be read: the oldest ${cost.skipped} messages are left out.` : ''}</span></label>
        </fieldset>
        ${err}
        <div class="dooms-atlas-setup-actions">
            <button type="button" class="dooms-atlas-btn is-primary" data-act="setup-draft"><i class="fa-solid fa-wand-magic-sparkles" aria-hidden="true"></i> <span>Draft the world</span></button>
            <button type="button" class="dooms-atlas-btn" data-act="setup-close">Cancel</button>
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

const hereChip = '<span class="dooms-atlas-here" title="The party is here">You are here</span>';
const peopleChip = (m) => (m.people && m.people.length ? `<span class="dooms-atlas-row-people" title="${attr(m.people.join(', '))}"><i class="fa-solid fa-user" aria-hidden="true"></i> ${m.people.length}</span>` : '');

/**
 * The tray (D145): what is not on the map yet. A row is dragged onto the
 * map, or tapped and then the map is tapped (`armed` is the row waiting
 * for that tap); its bin deletes it for good. Place all puts every one
 * where the layout proposes.
 */
export function atlasTrayHtml({ tray = [], armed = '', layerLabel = '' } = {}) {
    if (!tray.length) return '';
    const row = (m) => {
        const k = kindOf(m.kind);
        const rooms = m.rooms && m.rooms.length ? ` title="${attr(`${m.label}: ${m.rooms.join(', ')}`)}"` : ` title="${attr(m.label)}"`;
        return `<li class="dooms-atlas-tray-row kind-${attr(m.kind)}${armed === m.id ? ' is-armed' : ''}" draggable="true" data-id="${attr(m.id)}">
            <button type="button" class="dooms-atlas-row" data-act="arm" data-id="${attr(m.id)}"${rooms}>
                <i class="fa-solid ${attr(k.icon)}" aria-hidden="true"></i><span class="dooms-atlas-row-name">${e(m.label)}</span>${m.player ? hereChip : ''}${m.holds ? `<span class="dooms-atlas-row-people" title="${m.holds} ${m.holds === 1 ? 'place' : 'places'} inside"><i class="fa-solid fa-door-open" aria-hidden="true"></i> ${m.holds}</span>` : ''}${peopleChip(m)}
            </button>
            <button type="button" class="dooms-atlas-icon-btn" data-act="delete" data-id="${attr(m.id)}" title="Delete ${attr(m.label)}: it will not come back when the story names it again" aria-label="Delete ${attr(m.label)}"><i class="fa-solid fa-trash-can" aria-hidden="true"></i></button>
        </li>`;
    };
    const here = tray.filter(m => m.here !== false);
    const loose = tray.filter(m => m.here === false);
    return `<section class="dooms-atlas-tray" aria-label="Not on the map yet">
        ${here.length ? `<div class="dooms-atlas-tray-head">
            <span class="dooms-atlas-group-head">${layerLabel ? `In ${e(layerLabel)}, not placed` : 'Not on the map yet'} · ${here.length}</span>
            <button type="button" class="dooms-atlas-link" data-act="place-all" title="Put every one of these on the map at a free spot; you can move them after">Place all</button>
        </div>` : ''}
        <p class="dooms-atlas-tray-help">Drag a place onto the map, or tap it and then tap the map.</p>
        ${here.length ? `<ul>${here.map(row).join('')}</ul>` : ''}
        ${loose.length ? `<div class="dooms-atlas-tray-head"><span class="dooms-atlas-group-head">On no map yet · ${loose.length}</span></div><p class="dooms-atlas-tray-help">Put one on this map and it belongs ${layerLabel ? `inside ${e(layerLabel)}` : 'here'}.</p><ul>${loose.map(row).join('')}</ul>` : ''}
    </section>`;
}

/**
 * The list under the kinds: the markers the search and the switches
 * leave, under their regions, each a way to its spot on the map.
 */
export function atlasResultsHtml({ markers = [], query = '', hidden = [], all = [], layer = '' } = {}) {
    const shown = filterMarkers(markers, { query, hidden });
    // A search reaches the other maps too (D156): a match there goes to its map.
    const far = query ? filterMarkers(all.filter(m => m.placed && m.layer !== layer), { query }) : [];
    if (!shown.length && !far.length) return `<p class="dooms-atlas-none">${query ? 'Nothing on any map matches.' : (markers.length ? 'Every kind is switched off.' : 'Nothing is on this map yet.')}</p>`;
    const row = (m, elsewhere) => {
        const k = kindOf(m.kind);
        return `<li><button type="button" class="dooms-atlas-row kind-${attr(m.kind)}${m.visited || elsewhere ? ' is-visited' : ''}" data-act="goto" data-id="${attr(m.id)}"${elsewhere ? ` data-layer="${attr(m.layer)}"` : ''} title="Show ${attr(m.label)} on ${elsewhere ? `the map of ${attr(m.layerLabel || 'the world')}` : 'the map'}">
            <i class="fa-solid ${attr(k.icon)}" aria-hidden="true"></i><span class="dooms-atlas-row-name">${e(m.label)}</span>${m.player ? hereChip : ''}${m.holds ? `<span class="dooms-atlas-row-people" title="${m.holds} ${m.holds === 1 ? 'place' : 'places'} inside"><i class="fa-solid fa-door-open" aria-hidden="true"></i> ${m.holds}</span>` : ''}${elsewhere ? `<span class="dooms-atlas-row-people">${e(m.layerLabel || 'top map')}</span>` : peopleChip(m)}
        </button></li>`;
    };
    return `${shown.length ? `<section class="dooms-atlas-group"><ul>${shown.map(m => row(m, false)).join('')}</ul></section>` : ''}${far.length ? `<section class="dooms-atlas-group"><span class="dooms-atlas-group-head">On other maps</span><ul>${far.map(m => row(m, true)).join('')}</ul></section>` : ''}`;
}

/**
 * The clean-up pass (D155): the button that asks for it, and what it
 * proposed, each to be approved or passed over.
 * @param {{ busy: boolean, items: Array, error: string, asked: boolean }|null} tidy
 */
export function atlasTidyHtml(tidy, { count = 0 } = {}) {
    const t = tidy || { busy: false, items: [], error: '', asked: false };
    const setup = `<button type="button" class="dooms-atlas-btn" data-act="setup" title="Draft this world's places with the AI, from your notes, the lore and the chat: what is inside what, placed for you. You check the draft first; applying it replaces this chat's map."><i class="fa-solid fa-compass-drafting" aria-hidden="true"></i> <span>Set up this world</span></button>`;
    if (count < 2 && !t.items.length) return `<section class="dooms-atlas-tidy">${setup}</section>`;
    const item = (x, i) => `<li class="dooms-atlas-tidy-item is-${attr(x.kind)}">
            <span class="dooms-atlas-tidy-text">${x.kind === 'merge' ? `Merge <strong>${e(x.label)}</strong> into <strong>${e(x.toLabel)}</strong>` : `Delete <strong>${e(x.label)}</strong>`}${x.why ? `<span class="dooms-atlas-tidy-why">${e(x.why)}</span>` : ''}</span>
            <button type="button" class="dooms-atlas-icon-btn is-yes" data-act="tidy-yes" data-i="${i}" title="Do it" aria-label="Do it"><i class="fa-solid fa-check" aria-hidden="true"></i></button>
            <button type="button" class="dooms-atlas-icon-btn" data-act="tidy-no" data-i="${i}" title="Leave it as it is" aria-label="Leave it as it is"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button>
        </li>`;
    const body = t.items.length
        ? `<ul>${t.items.map(item).join('')}</ul><div class="dooms-atlas-tidy-all"><button type="button" class="dooms-atlas-link" data-act="tidy-all">Do all ${t.items.length}</button><button type="button" class="dooms-atlas-link" data-act="tidy-none">Leave them all</button></div>`
        : (t.error ? `<p class="dooms-atlas-none is-error">${e(t.error)}</p>` : (t.asked && !t.busy ? '<p class="dooms-atlas-none">Nothing to tidy: no duplicates were found.</p>' : ''));
    return `<section class="dooms-atlas-tidy" aria-label="Set up and clean up the places">
        <div class="dooms-atlas-tidy-buttons">${setup}<button type="button" class="dooms-atlas-btn" data-act="tidy"${t.busy ? ' disabled' : ''} title="Ask the AI to look over the places for duplicates and things that are not places. It only proposes: you approve each one."><i class="fa-solid fa-wand-magic-sparkles" aria-hidden="true"></i> <span>${t.busy ? 'Looking them over…' : 'Clean up with AI'}</span></button></div>
        ${body}
    </section>`;
}

/** What was deleted, folded away: each can be brought back. */
function deletedHtml(deleted) {
    if (!deleted.length) return '';
    return `<details class="dooms-atlas-deleted"><summary>Deleted · ${deleted.length}</summary><ul>${deleted.map(d => `<li><span class="dooms-atlas-row-name">${e(d.label)}</span><button type="button" class="dooms-atlas-link" data-act="restore" data-id="${attr(d.id)}">Restore</button></li>`).join('')}</ul></details>`;
}

/** The Places tab: the tray, the search, Show all and Hide all, the visited count, the kinds, the list, the scale, what was deleted. */
export function atlasPlacesHtml({ markers = [], tray = [], deleted = [], query = '', hidden = [], armed = '', scale = 'town', tidy = null, all = [], layer = '', layerLabel = '', ground = 'country' } = {}) {
    const counts = kindCounts(markers);
    const off = new Set(hidden);
    const visited = markers.filter(m => m.visited).length;
    const scales = Object.entries(ATLAS_SCALES).map(([id, s]) => `<option value="${id}"${id === scale ? ' selected' : ''}>${e(s.label)}</option>`).join('');
    return `${atlasTrayHtml({ tray, armed, layerLabel })}
        ${atlasTidyHtml(tidy, { count: all.length || markers.length + tray.length })}
        <div class="dooms-atlas-search">
            <i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i>
            <input type="search" class="dooms-atlas-query" placeholder="Search every map" aria-label="Search places and people on every map" value="${attr(query)}" autocomplete="off" />
        </div>
        <div class="dooms-atlas-switches">
            <button type="button" class="dooms-atlas-link" data-act="kinds-on">Show all</button>
            <button type="button" class="dooms-atlas-link" data-act="kinds-off">Hide all</button>
            <span class="dooms-atlas-visited" title="Places on the map the story has been to">${markers.length ? `Visited ${visited} of ${markers.length}` : ''}</span>
        </div>
        <div class="dooms-atlas-kinds">${counts.map(k => kindHtml(k, off.has(k.id))).join('')}</div>
        <div class="dooms-atlas-results">${atlasResultsHtml({ markers, query, hidden, all, layer })}</div>
        <label class="dooms-atlas-scale-pick" title="How far apart the places on this map are: it sets its distances and travel times. Every map has its own.">This map is of <select class="dooms-atlas-scale-select" aria-label="What this map is of">${scales}</select></label>
        <label class="dooms-atlas-scale-pick" title="What the empty space of this map is. Every map has its own.">The ground is <select class="dooms-atlas-ground-select" aria-label="What the empty space of this map is">${ATLAS_GROUNDS.map(g => `<option value="${g.id}"${g.id === ground ? ' selected' : ''}>${e(g.label)}</option>`).join('')}</select></label>
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
    const holds = m.holds ? `<span class="dooms-atlas-holds" title="${m.holds} ${m.holds === 1 ? 'place' : 'places'} inside: double-click to enter"><i class="fa-solid fa-door-open" aria-hidden="true"></i>${m.holds}</span>` : '';
    return `<span class="dooms-atlas-pin"><i class="fa-solid ${attr(k.icon)}" aria-hidden="true"></i></span>${party}${faces}${weather}${holds}<span class="dooms-atlas-label">${e(m.label)}</span>`;
}

/** A marker's classes: its kind, whether it was visited, whether the party is there. */
export function atlasMarkerClass(m) {
    return ['dooms-atlas-marker', `kind-${m.kind}`, m.visited ? 'is-visited' : '', m.player ? 'is-player' : '', m.holds ? 'is-layer' : ''].filter(Boolean).join(' ');
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
 * @param {'view'|'edit'|'merge'|'move'} o.mode
 * @param {Array<{id:string,label:string,layerLabel?:string,inside?:string[]}>} o.others  every other place: what it can be merged into, or moved into (not one that is inside it)
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
                <p class="dooms-atlas-card-kind">${e(k.label)}${m.holds ? ` · ${m.holds} ${m.holds === 1 ? 'place' : 'places'} inside` : ''}${m.visited ? ' · visited' : ''}</p>
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
    if (mode === 'move') {
        const options = [`<option value="">The top map</option>`, ...others.filter(o => !(o.inside || []).includes(m.id)).map(o => `<option value="${attr(o.id)}">${e(o.label)}${o.layerLabel ? ` (in ${e(o.layerLabel)})` : ''}</option>`)].join('');
        return `<article class="dooms-atlas-card is-editing kind-${attr(m.kind)}" data-id="${id}">
            ${head}
            <p class="dooms-atlas-card-note">Move this onto another place's map: a house into its city, a level into its dungeon. It leaves this map and waits in that one's list to be placed.</p>
            <label class="dooms-atlas-field"><span class="dooms-atlas-card-label">Move into</span><select class="dooms-atlas-input" data-field="layer">${options}</select></label>
            <div class="dooms-atlas-card-actions">
                <button type="button" class="dooms-atlas-btn is-primary" data-act="move-go" data-id="${id}"><i class="fa-solid fa-right-to-bracket" aria-hidden="true"></i> <span>Move</span></button>
                <button type="button" class="dooms-atlas-btn" data-act="card-view" data-id="${id}">Cancel</button>
            </div>
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
        ? `<p class="dooms-atlas-card-where is-here"><i class="fa-solid fa-flag" aria-hidden="true"></i> ${m.partyInside ? 'The party is inside' : 'You are here'}</p>`
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
        <button type="button" class="dooms-atlas-btn dooms-atlas-enter" data-act="enter" data-id="${id}" title="Open the map inside ${attr(m.label)}: its own places, at its own scale. Double-clicking the marker does the same."><i class="fa-solid fa-door-open" aria-hidden="true"></i> <span>${m.holds ? `Enter (${m.holds} ${m.holds === 1 ? 'place' : 'places'} inside)` : 'Enter: give it a map of its own'}</span></button>
        <div class="dooms-atlas-card-tools">
            ${tool('card-edit', 'fa-pen', 'Edit', 'Change the name, the kind or the note')}
            ${tool('card-merge', 'fa-code-merge', 'Merge', 'Merge this into another place')}
            ${tool('card-move', 'fa-right-to-bracket', 'Move', 'Move it onto another place\'s map: a house into its city')}
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
