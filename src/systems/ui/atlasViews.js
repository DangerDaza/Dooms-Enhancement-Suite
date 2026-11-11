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
import { draftRows, draftChain, FILL_COUNTS } from '../../utils/atlasSetup.js';
import { GAPS } from '../../utils/hub.js';

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
                ${tool('roads', 'fa-road', 'Roads: while this is on, click two places to join them with a road, or two joined places to take their road away', ' is-edit')}
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

/**
 * Starting a scene from the map (D174), a panel over it in two steps:
 * who is there, when, and what brings the party; then three ways the
 * scene could open, to pick one of or to write over.
 * @param {object} o
 * @param {'form'|'busy'|'pick'|'opening'} o.step
 * @param {{ id: string, label: string }} o.place
 * @param {number} o.sceneNo
 * @param {Array<{ name: string, here: boolean }>} o.people   the people the world knows; `here` when last seen at the place
 * @param {string[]} o.cast          the names ticked
 * @param {{ id: string, words: string }} o.gap
 * @param {string} o.journey         what the map says of the way there ('' when the party is there or it cannot tell)
 * @param {object|null} o.pending    pendingStart(): the openers and when the scene opens
 */
export function atlasStartSceneHtml({ step = 'form', place = { id: '', label: '' }, sceneNo = 0, people = [], cast = [], extra = '', gap = { id: 'now', words: '' }, journey = '', seedText = '', note = '', error = '', pending = null, card = '' } = {}) {
    const where = place && place.label ? place.label : 'here';
    const title = `${sceneNo ? `Scene ${sceneNo}` : 'A scene'} at ${e(where)}`;
    const err = error ? `<p class="dooms-atlas-setup-error" role="alert">${e(error)}</p>` : '';
    if (step === 'busy' || step === 'opening') return `<div class="dooms-atlas-setup-card is-busy is-scene"><h3>${title}</h3><p>${step === 'busy' ? 'Writing three ways it could open…' : 'Opening the scene…'}</p><div class="dooms-atlas-setup-bar" role="progressbar" aria-label="${step === 'busy' ? 'Writing the openings' : 'Opening the scene'}"><span style="width:60%"></span></div></div>`;
    if (step === 'pick') {
        const p = pending && typeof pending === 'object' ? pending : { openers: [], when: null };
        const when = p.when ? [p.when.date, p.when.time].filter(Boolean).join(', ') : '';
        const openers = (Array.isArray(p.openers) ? p.openers : []).map((o, i) => `<li class="dooms-atlas-opener">
                <h4>${e(o.title || `Opening ${i + 1}`)}</h4>
                <p>${e(o.text)}</p>
                <button type="button" class="dooms-atlas-btn is-primary" data-act="scene-pick" data-choice="${i}"><i class="fa-solid fa-play" aria-hidden="true"></i> <span>Open with this</span></button>
            </li>`).join('');
        return `<div class="dooms-atlas-setup-card is-review is-scene">
            <h3>How does ${sceneNo ? `scene ${sceneNo}` : 'the scene'} open?</h3>
            <p>${e(where)}${when ? ` · ${e(when)}` : ''}. Pick one; the other two stay as swipes on the first message.</p>
            ${loreLine(p.lore)}
            ${err}
            <ul class="dooms-atlas-openers">${openers || '<li class="dooms-atlas-none">No opening was written. Write your own below, or ask again.</li>'}</ul>
            <label class="dooms-atlas-field"><span class="dooms-atlas-card-label">Or write the opening yourself</span>
                <textarea class="dooms-atlas-input dooms-atlas-scene-own" maxlength="1500" placeholder="The first message of the scene, in the narrator's voice."></textarea></label>
            <div class="dooms-atlas-setup-actions">
                <button type="button" class="dooms-atlas-btn" data-act="scene-own"><i class="fa-solid fa-pen" aria-hidden="true"></i> <span>Open with mine</span></button>
                <button type="button" class="dooms-atlas-btn" data-act="scene-again"><i class="fa-solid fa-rotate" aria-hidden="true"></i> <span>Ask again</span></button>
                <button type="button" class="dooms-atlas-btn" data-act="scene-back">Back</button>
            </div>
        </div>`;
    }
    const ticked = new Set(cast);
    const who = people.length
        ? `<div class="dooms-atlas-cast">${people.map(p => `<label class="dooms-atlas-cast-one${p.here ? ' is-here' : ''}"><input type="checkbox" name="dooms-atlas-cast" value="${attr(p.name)}"${ticked.has(p.name) ? ' checked' : ''} /> <span>${e(p.name)}</span>${p.here ? '<span class="dooms-atlas-cast-here" title="Last seen here">here</span>' : ''}</label>`).join('')}</div>`
        : '<p class="dooms-atlas-none">The world knows no one yet. Name who is there below.</p>';
    const gaps = [...GAPS.filter(g => g.id !== 'when'), { id: 'when', label: 'In my words' }].map(g => `<label><input type="radio" name="dooms-atlas-gap" value="${g.id}"${g.id === gap.id ? ' checked' : ''} /> <span>${e(g.label)}</span></label>`).join('');
    return `<div class="dooms-atlas-setup-card is-scene">
        <h3>${title}</h3>
        <p>A fresh chat${card ? ` with ${e(card)}` : ''} that opens here, told what happened before and who is in it.</p>
        <fieldset class="dooms-atlas-scene-field"><legend class="dooms-atlas-card-label">Who is there</legend>
            ${who}
            <input type="text" class="dooms-atlas-input dooms-atlas-scene-who" maxlength="200" value="${attr(extra)}" placeholder="Someone else, separated by commas" aria-label="Someone else who is there" />
        </fieldset>
        <fieldset class="dooms-atlas-scene-field"><legend class="dooms-atlas-card-label">When, counted from the last scene</legend>
            <div class="dooms-atlas-gaps">${gaps}</div>
            <input type="text" class="dooms-atlas-input dooms-atlas-scene-when" maxlength="80" value="${attr(gap.id === 'when' ? gap.words : '')}" placeholder="In my words: three days later, at the turn of the season…" aria-label="When, in your words" />
            ${journey ? `<p class="dooms-atlas-start-note"><i class="fa-solid fa-route" aria-hidden="true"></i> The map puts the way here at ${e(journey)}.</p>` : ''}
        </fieldset>
        <label class="dooms-atlas-field"><span class="dooms-atlas-card-label">What brings the party here (optional)</span>
            <textarea class="dooms-atlas-input dooms-atlas-scene-seed" maxlength="400" placeholder="An errand, a summons, a rumour followed…">${e(seedText)}</textarea></label>
        <label class="dooms-atlas-field"><span class="dooms-atlas-card-label">What you want from the scene (optional)</span>
            <input type="text" class="dooms-atlas-input dooms-atlas-scene-note" maxlength="300" value="${attr(note)}" placeholder="A quiet talk, a fight, an answer…" /></label>
        ${err}
        <div class="dooms-atlas-setup-actions">
            <button type="button" class="dooms-atlas-btn is-primary" data-act="scene-write"><i class="fa-solid fa-feather" aria-hidden="true"></i> <span>Write three openings</span></button>
            <button type="button" class="dooms-atlas-btn" data-act="setup-close">Not now</button>
        </div>
        <p class="dooms-atlas-start-note">One request writes three ways the scene could open. Nothing is started until you pick one.</p>
    </div>`;
}

const sceneNoOf = (id) => String(id || '').replace(/^s/, '');
const listOf = (names) => (names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`);

/** Whose lorebook entries the openings were written with, and who had none (D177); '' when no lorebook was read. */
function loreLine(lore) {
    const l = lore && typeof lore === 'object' ? lore : null;
    if (!l || !Array.isArray(l.books) || !l.books.length) return '';
    const found = Array.isArray(l.found) ? l.found : [];
    const missing = Array.isArray(l.missing) ? l.missing : [];
    const parts = [];
    if (found.length) parts.push(`Written with the lorebook ${found.length === 1 ? 'entry' : 'entries'} of ${e(listOf(found))}${l.standing ? " and the story's standing notes" : ''}.`);
    else if (l.standing) parts.push("Written with the story's standing notes.");
    if (missing.length) parts.push(`No entry was found for ${e(listOf(missing))}: the opening has only a line about ${missing.length === 1 ? 'them' : 'each'}. An entry whose title begins with the name, or that has the name among its keywords, is found.`);
    return parts.length ? `<p class="dooms-atlas-start-note"><i class="fa-solid fa-book" aria-hidden="true"></i> ${parts.join(' ')}</p>` : '';
}

/**
 * Ending a scene from the Atlas (D176), a panel over the map: the record
 * of the scene to read and correct, what ending it will do (each part
 * can be left out), and each part's state while it runs.
 * @param {object} o
 * @param {object|null} o.prep     prepareEnd(): the recap, the scene, its dates, the parts that are on, whether the world has moved past it
 * @param {boolean} o.busy         the record is being written
 * @param {Object<string,string>} o.states  recap | canon | world | snapshot -> waiting | running | ok | failed | skipped | off | kept
 * @param {object|null} o.result   commitEnd()'s answer once it has run
 */
export function atlasEndSceneHtml({ prep = null, busy = false, states = {}, result = null, error = '', going = '' } = {}) {
    const scene = prep && (prep.scene || prep.mark) ? (prep.scene || prep.mark) : null;
    const title = scene ? `scene ${e(sceneNoOf(scene.id || scene.scene))}${scene.title ? `: ${e(scene.title)}` : ''}` : 'this scene';
    const when = prep && (prep.from || prep.to) ? `From ${e(prep.from || '?')} to ${e(prep.to || 'now')}.` : '';
    const running = Object.values(states).includes('running');
    const done = !!(result && result.ok);
    const word = { waiting: 'waiting', running: 'running…', ok: 'done', failed: 'failed', skipped: 'left out', off: 'off', kept: 'kept as it was' };
    const part = (key, label, hint, on, skipClass) => {
        const st = states[key] || (on ? 'waiting' : 'off');
        return `<li class="dooms-atlas-part is-${attr(st)}">
            <span class="dooms-atlas-part-label"><strong>${e(label)}</strong> <span>${e(hint)}</span></span>
            ${skipClass && on && !done && !running ? `<label class="dooms-atlas-part-skip"><input type="checkbox" class="${attr(skipClass)}" /> leave out</label>` : ''}
            <span class="dooms-atlas-part-state">${e(word[st] || st)}</span>
        </li>`;
    };
    const canonOn = !!(prep && prep.steps && prep.steps.canon);
    const worldOn = !!(prep && prep.steps && prep.steps.world);
    const stale = prep && prep.stale && !done
        ? `<div class="dooms-atlas-stale"><p class="dooms-atlas-setup-error" role="alert">This scene began before a later one ended, so the world remembers more than it does. Ending it keeps the world's memory as it is: the record is kept and the ledger reads the scene, and nothing of the later scene is lost.</p>
            <label class="dooms-atlas-check"><input type="checkbox" class="dooms-atlas-end-replace" /> <span>Replace the world's memory with this scene's instead</span></label></div>`
        : '';
    // The style law (D179): what the narration leaned on in this scene, counted. The ticked phrases are held against the next scenes.
    const counted = prep && prep.style && Array.isArray(prep.style.phrases) ? prep.style.phrases : [];
    const habits = counted.length
        ? `<fieldset class="dooms-atlas-scene-field dooms-atlas-habits-field"><legend class="dooms-atlas-card-label">Phrases the narration leaned on (${prep.style.messages} ${prep.style.messages === 1 ? 'message' : 'messages'} counted)</legend>
            <div class="dooms-atlas-habits">${counted.map(h => `<label class="dooms-atlas-habit"><input type="checkbox" class="dooms-atlas-end-ban" value="${attr(h.phrase)}" data-kind="${attr(h.kind)}" data-count="${attr(h.count)}"${h.ticked ? ' checked' : ''}${done || running ? ' disabled' : ''} /> <span>“${e(h.phrase)}”</span><span class="dooms-atlas-habit-count">${e(h.count)}×${h.kind === 'address' ? ' · said to someone' : ''}</span></label>`).join('')}</div>
            <p class="dooms-atlas-start-note">The ticked ones are held against the next scenes: the narrator is told not to use them. One that stops turning up drops off the list by itself.</p>
        </fieldset>`
        : '';
    return `<div class="dooms-atlas-setup-card is-scene is-end">
        <h3>End ${title}</h3>
        ${when ? `<p>${when}</p>` : ''}
        <label class="dooms-atlas-field"><span class="dooms-atlas-card-label">What happened${busy ? ' (being written…)' : ''}</span>
            <textarea class="dooms-atlas-input dooms-atlas-setup-notes dooms-atlas-end-recap" maxlength="1500" placeholder="${busy ? 'The record of the scene is being written…' : 'What happened in this scene, in a few lines. The next scene is told this.'}"${done || busy ? ' readonly' : ''}>${prep && prep.recap ? e(prep.recap) : ''}</textarea></label>
        ${prep && prep.error ? `<p class="dooms-atlas-setup-error" role="alert">The record could not be written (${e(prep.error)}). Write it yourself, or end without one.</p>` : ''}
        ${stale}
        ${habits}
        <ul class="dooms-atlas-parts">
            ${part('recap', 'The record', 'kept with the scene', true, '')}
            ${part('canon', 'The ledger', canonOn ? (prep && prep.canonDone ? 'already read for the last reply' : 'Canon reads the whole scene') : 'Canon is off', canonOn, 'dooms-atlas-end-skip-canon')}
            ${part('world', 'The world', worldOn ? 'the clocks tick and people move, by the time the scene took' : 'Live World has no world here', worldOn, 'dooms-atlas-end-skip-world')}
            ${part('snapshot', 'The memory', 'everything this chat knows, with the map, kept for the next scene', true, '')}
        </ul>
        ${done ? `<p class="dooms-atlas-end-done"><i class="fa-solid fa-check" aria-hidden="true"></i> The scene is ended and remembered. ${going ? e(going) : 'The map shows the world as it stands now: open a place to start the next scene.'}</p>` : ''}
        ${error ? `<p class="dooms-atlas-setup-error" role="alert">${e(error)}</p>` : ''}
        <div class="dooms-atlas-setup-actions">
            ${done
                ? `<button type="button" class="dooms-atlas-btn is-primary" data-act="setup-close"${going ? ' disabled' : ''}><i class="fa-solid fa-map" aria-hidden="true"></i> <span>To the map</span></button>`
                : `<button type="button" class="dooms-atlas-btn is-primary" data-act="end-go"${busy || running || !prep ? ' disabled' : ''}><i class="fa-solid fa-flag-checkered" aria-hidden="true"></i> <span>${running ? 'Ending…' : 'End scene'}</span></button>
                   <button type="button" class="dooms-atlas-btn" data-act="end-continue"${busy || running || !prep || (prep && prep.stale) ? ' disabled' : ''} title="End it with this record and go straight on in a fresh chat: the same place, the same people, no time passed, so the world is not moved"><i class="fa-solid fa-forward-step" aria-hidden="true"></i> <span>End and continue here</span></button>
                   <button type="button" class="dooms-atlas-btn" data-act="setup-close"${running ? ' disabled' : ''}>Keep playing</button>`}
        </div>
    </div>`;
}

/**
 * The strip across the top of a scene's chat (hub-plan D121, D176, D181):
 * the scene's number, its place and date and how long it has run; the
 * Atlas, Continue fresh and End scene; ended: the Atlas, Continue fresh
 * and Reopen. From the length the player set, the strip says a fresh
 * chat is worth it and Continue fresh is lit. While a handover runs the
 * strip says what is being done and nothing can be pressed. Drawn with
 * the strip's own classes (style.css).
 * @param {{ mark: object, scene?: object|null, ended: boolean, count?: number, long?: boolean, busy?: string, note?: string }} o
 */
export function atlasStripHtml({ mark = null, scene = null, ended = false, count = 0, long = false, busy = '', note = '' } = {}) {
    const id = (scene && scene.id) || (mark && mark.scene) || '';
    const title = (scene && scene.title) || (mark && mark.title) || '';
    const place = mark && mark.place && mark.place.label ? mark.place.label : (scene && scene.place ? scene.place.label : '');
    const date = mark && mark.startDate ? mark.startDate : (scene && scene.startDate ? scene.startDate : '');
    const length = !ended && count > 0 ? `${count} ${count === 1 ? 'message' : 'messages'}` : '';
    const text = busy || [`Scene ${sceneNoOf(id)}${title ? `: ${title}` : ''}`, ended ? 'ended' : place, ended ? (mark && mark.endDate ? mark.endDate : '') : date, length].filter(Boolean).join(' · ');
    const off = busy ? ' disabled' : '';
    const atlas = `<button type="button" class="rpg-accordion-action-btn" data-act="atlas" title="${ended ? 'The world as it stands now: start the next scene from the map' : 'The map of this scene\'s world'}"${off}><i class="fa-solid fa-map" aria-hidden="true"></i> Atlas</button>`;
    const fresh = `<button type="button" class="rpg-accordion-action-btn${long && !busy ? ' is-nudged' : ''}" data-act="continue" title="${ended ? 'Start the next scene straight on from this one: the same place, the same people, no time passed' : 'End this scene and go straight on in a fresh chat: the same place, the same people, no time passed'}"${off}><i class="fa-solid fa-forward-step" aria-hidden="true"></i> Continue fresh</button>`;
    const actions = ended
        ? `${atlas}${fresh}<button type="button" class="rpg-accordion-action-btn" data-act="reopen" title="Play on; ending it again replaces its record and the memory"${off}><i class="fa-solid fa-rotate-left" aria-hidden="true"></i> Reopen</button>`
        : `${atlas}${fresh}<button type="button" class="rpg-accordion-action-btn" data-act="end" title="Write the record of this scene and remember it"${off}><i class="fa-solid fa-flag-checkered" aria-hidden="true"></i> End scene</button>`;
    const nudge = long && !busy ? '<span class="dooms-strip-nudge">a good place to go on in a fresh chat</span>' : '';
    return `<div class="dooms-strip-text"><i class="fa-solid ${busy ? 'fa-hourglass-half' : 'fa-clapperboard'}" aria-hidden="true"></i><span>${e(text)}</span>${nudge}</div><div class="dooms-strip-actions">${actions}</div>${note ? `<div class="dooms-strip-note" role="status">${e(note)}</div>` : ''}`;
}

/** Why a chat cannot be played as scenes, in words (D172). */
export function scenesRefusalText(plan) {
    const p = plan && typeof plan === 'object' ? plan : {};
    if (p.reason === 'group') return 'Scenes are played with one narrator card, and this is a group chat.';
    if (p.reason === 'no-chat') return 'Open a chat first: its story so far is what the scenes begin from.';
    if (p.reason === 'no-world') return 'This chat has no world yet. Switch Live World on for it and send a message, then come back.';
    if (p.reason === 'no-card') return 'This chat has no character card to narrate the scenes.';
    if (p.reason === 'scene') return 'This chat is a scene already. End it from the strip above the chat; the next one starts from where it stopped.';
    if (p.reason === 'off') return 'Live World is off. Scenes are played on a living world: switch it on in Settings, under Live World.';
    if (p.reason === 'busy') return 'A reply is still being written. Try again when it is done.';
    if (p.reason === 'changed') return 'The chat changed while this was being prepared. Nothing was changed; start again.';
    if (p.reason === 'running') return 'This is already being done.';
    if (p.reason === 'bound-elsewhere') return `${(p.card && p.card.name) || 'This chat\'s card'} already narrates another world (${p.boundTo || 'one of yours'}), and a card narrates one world. Open this story with a card of its own, or free the card in Settings, under Live World, The Hub.`;
    if (p.reason === 'backup') return `A copy of this chat could not be saved first (${(Array.isArray(p.errors) ? p.errors.join(' ') : '') || 'SillyTavern refused the file'}), so nothing was changed.`;
    if (p.reason === 'world' || p.reason === 'error') return `It could not be done: ${(Array.isArray(p.errors) ? p.errors.join(' ') : '') || 'the world could not be made'}.`;
    return 'This chat cannot be played as scenes.';
}

/**
 * Playing a story as scenes (D172), a panel over the map: what it will
 * do; the record of the chat so far, written for the player to read and
 * correct; then the word that it is done.
 * @param {object} o
 * @param {'ask'|'busy'|'review'|'done'} o.step
 * @param {object} o.plan      scenesPlan(): the world, the campaign, the card, whether a memory is replaced
 * @param {string} o.recap     the record of the chat so far
 * @param {string} o.error     why the record could not be written, or why the last try failed
 * @param {boolean} o.replace  the player ticked that the memory may be replaced
 * @param {object|null} o.result  commitAdopt()'s answer, for the last step
 */
export function atlasScenesHtml({ step = 'ask', plan = null, recap = '', error = '', replace = false, result = null, messages = 0 } = {}) {
    const p = plan && typeof plan === 'object' ? plan : { ok: false, reason: '' };
    const close = '<button type="button" class="dooms-atlas-btn" data-act="setup-close">Not now</button>';
    if (!p.ok && step !== 'done') return `<div class="dooms-atlas-setup-card is-scenes"><h3>Play this story as scenes</h3><p class="dooms-atlas-setup-error" role="alert">${e(scenesRefusalText(p))}</p><div class="dooms-atlas-setup-actions"><button type="button" class="dooms-atlas-btn" data-act="setup-close">Close</button></div></div>`;
    const world = (p.world && p.world.name) || 'this world';
    const err = error ? `<p class="dooms-atlas-setup-error" role="alert">${e(error)}</p>` : '';
    if (step === 'busy') return `<div class="dooms-atlas-setup-card is-busy is-scenes"><h3>Play ${e(world)} as scenes</h3><p>Writing the record of the chat so far…</p><div class="dooms-atlas-setup-bar" role="progressbar" aria-label="Writing the record"><span style="width:60%"></span></div></div>`;
    if (step === 'done') {
        const r = result && typeof result === 'object' ? result : {};
        return `<div class="dooms-atlas-setup-card is-scenes">
            <h3><i class="fa-solid fa-check" aria-hidden="true"></i> ${e(r.worldName || world)} is played as scenes</h3>
            <p>${r.replaced ? 'Its memory is this chat as it stands now.' : 'This chat as it stands is its memory, and is kept as scene 0.'} ${e(r.card || 'The card')} narrates its scenes, and each scene opens on your map.</p>
            <p>This chat is unchanged otherwise and can go on being played. A scene starts in a chat of its own and is told what happened here.</p>
            ${r.backup ? `<p class="dooms-atlas-start-note"><i class="fa-solid fa-shield-halved" aria-hidden="true"></i> A copy of the chat as it was is saved beside it as <strong>${e(r.backup)}</strong>.</p>` : ''}
            <p>To start the first scene, open a place on the map and press <strong>Start scene 1 here</strong>.</p>
            <div class="dooms-atlas-setup-actions">
                <button type="button" class="dooms-atlas-btn is-primary" data-act="setup-close"><i class="fa-solid fa-map" aria-hidden="true"></i> <span>To the map</span></button>
            </div>
        </div>`;
    }
    const made = p.world && p.world.made;
    const warn = p.replaces ? `<p class="dooms-atlas-setup-error" role="alert">${e(world)} is already played as scenes${p.scenes ? ` (${p.scenes} played)` : ''}. Taking this chat replaces what it remembers with this chat as it stands; the scenes already played stay in its list.</p>` : '';
    if (step === 'review') {
        return `<div class="dooms-atlas-setup-card is-scenes">
            <h3>Play ${e(world)} as scenes</h3>
            <label class="dooms-atlas-field"><span class="dooms-atlas-card-label">What has happened so far (the first scene is told this)</span>
                <textarea class="dooms-atlas-input dooms-atlas-setup-notes dooms-atlas-scenes-recap" maxlength="1500" placeholder="A few lines on where the story stands. It can be left empty.">${e(recap)}</textarea></label>
            ${err}
            ${warn}
            ${p.replaces ? `<label class="dooms-atlas-check"><input type="checkbox" class="dooms-atlas-scenes-replace"${replace ? ' checked' : ''} /> <span>Replace what ${e(world)} remembers with this chat</span></label>` : ''}
            <div class="dooms-atlas-setup-actions">
                <button type="button" class="dooms-atlas-btn is-primary" data-act="scenes-go"${p.replaces && !replace ? ' disabled' : ''}><i class="fa-solid fa-clapperboard" aria-hidden="true"></i> <span>Play as scenes</span></button>
                <button type="button" class="dooms-atlas-btn" data-act="scenes-again"><i class="fa-solid fa-rotate" aria-hidden="true"></i> <span>Write it again</span></button>
                ${close}
            </div>
        </div>`;
    }
    const worldLine = made
        ? `A world named <strong>${e(world)}</strong> is made for ${p.campaign ? `the campaign ${e(p.campaign.name)}` : 'this chat'}. It has no places of its own: your map and the places the story has named stay exactly as they are.`
        : p.campaign && !p.replaces ? `<strong>${e(world)}</strong> is this story's world already.` : `<strong>${e(world)}</strong> is the world.`;
    return `<div class="dooms-atlas-setup-card is-scenes">
        <h3>Play ${e(world)} as scenes</h3>
        <p>A story played as scenes is many short chats instead of one long one. Every scene starts fresh, on your map, knowing what happened before it.</p>
        <ul class="dooms-atlas-scenes-list">
            <li>${worldLine}</li>
            <li><strong>${e((p.card && p.card.name) || 'This chat\'s card')}</strong> narrates its scenes.</li>
            <li>This chat as it stands becomes its memory: the tracker, the inventory, the quests, the world, the canon, the hooks and the map.</li>
            <li>This chat is kept as scene 0 and stays an ordinary chat you can go on playing.</li>
            <li>A copy of the chat as it is now is saved beside it first. If the copy cannot be saved, nothing is changed.</li>
        </ul>
        ${warn}
        ${err}
        <div class="dooms-atlas-setup-actions">
            <button type="button" class="dooms-atlas-btn is-primary" data-act="scenes-prepare"><i class="fa-solid fa-feather" aria-hidden="true"></i> <span>Write the record of this chat so far</span></button>
            ${close}
        </div>
        <p class="dooms-atlas-start-note">One request on the tracker's connection reads the last forty messages${messages ? ` of ${messages}` : ''} and writes a few lines on where the story stands. You read and correct them before anything is changed.</p>
    </div>`;
}

/**
 * Filling out a map (D160, D166), in the set-up's panel: what to add
 * (places on this map, or regions around it), what the player wants more
 * of and how many; the wait; the suggestions to keep or leave out.
 * @param {object} o
 * @param {'ask'|'busy'|'review'} o.step
 * @param {string} o.mapLabel   the map being filled ("Hask", or the world's name for the top map)
 * @param {string[]} o.options  what this map can be filled with: 'places', 'regions' (fillOptions)
 * @param {'places'|'regions'} o.what
 * @param {boolean} o.homeNeeded  regions here means the map's own places go inside a home region first
 * @param {string} o.home       that region's name, as drafted (the review lets the player change it)
 * @param {number} o.homeHolds  how many places go inside it
 * @param {string} o.wish
 * @param {number} o.count
 * @param {Array} o.places      parseFill's places
 * @param {string} o.error
 */
export function atlasFillHtml({ step = 'ask', mapLabel = 'this map', options = ['places'], what = 'places', homeNeeded = false, home = '', homeHolds = 0, wish = '', count = 8, places = [], error = '' } = {}) {
    const err = error ? `<p class="dooms-atlas-setup-error" role="alert">${e(error)}</p>` : '';
    const regions = what === 'regions';
    const noun = (n) => (regions ? (n === 1 ? 'region' : 'regions') : (n === 1 ? 'place' : 'places'));
    if (step === 'busy') return `<div class="dooms-atlas-setup-card is-busy"><h3>Filling out ${e(mapLabel)}</h3><p>${regions ? 'Asking for the lands that lie around…' : 'Asking for places that belong here…'}</p><div class="dooms-atlas-setup-bar" role="progressbar"><span style="width: 55%"></span></div><p class="dooms-atlas-start-note">Nothing is added until you press Add.</p></div>`;
    if (step === 'review') {
        const kinds = (cur) => ATLAS_KINDS.filter(k => k.id !== 'region').map(k => `<option value="${k.id}"${k.id === cur ? ' selected' : ''}>${e(k.label)}</option>`).join('');
        const row = (p) => `<li class="dooms-atlas-fill-row${regions ? ' is-region' : ''}" data-key="${attr(p.key)}">
                <input type="text" class="dooms-atlas-input" data-field="name" maxlength="80" value="${attr(p.name)}" aria-label="Name" />
                ${regions ? '' : `<select class="dooms-atlas-input" data-field="kind" aria-label="Kind">${kinds(p.kind)}</select>`}
                <button type="button" class="dooms-atlas-icon-btn" data-act="fill-remove" data-key="${attr(p.key)}" title="Leave ${attr(p.name)} out" aria-label="Leave ${attr(p.name)} out"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button>
                <p class="dooms-atlas-fill-note">${e(p.note)}</p>
            </li>`;
        const homeRow = regions && homeNeeded ? `<label class="dooms-atlas-field dooms-atlas-fill-home-row"><span class="dooms-atlas-card-label">The region ${homeHolds === 1 ? 'the place' : `the ${homeHolds} places`} on this map ${homeHolds === 1 ? 'goes' : 'go'} inside (rename it as you like)</span>
                <input type="text" class="dooms-atlas-input dooms-atlas-fill-home" maxlength="80" value="${attr(home)}" aria-label="The home region's name" /></label>` : '';
        return `<div class="dooms-atlas-setup-card is-review">
            <h3>${regions ? `Regions around ${e(homeNeeded ? (home || 'these places') : mapLabel)}` : `Suggestions for ${e(mapLabel)}`}</h3>
            <p>${places.length} ${noun(places.length)} the story has not named. Keep what fits, rename it, leave the rest out. They go on the map marked as <strong>not canon</strong> (a dashed ${regions ? 'border' : 'ring'}): yours to edit, make canon or delete later${regions ? ', and each one borders its neighbours' : ', and nothing already on the map moves'}.</p>
            ${err}
            ${homeRow}
            <ul class="dooms-atlas-setup-list">${places.map(row).join('')}</ul>
            <div class="dooms-atlas-setup-actions">
                <button type="button" class="dooms-atlas-btn is-primary" data-act="fill-apply"${places.length ? '' : ' disabled'}><i class="fa-solid fa-check" aria-hidden="true"></i> <span>Add ${places.length === 1 ? 'it' : `these ${places.length}`} to the map</span></button>
                <button type="button" class="dooms-atlas-btn" data-act="fill-again"><i class="fa-solid fa-rotate" aria-hidden="true"></i> <span>Ask again</span></button>
                <button type="button" class="dooms-atlas-btn" data-act="setup-close">Cancel</button>
            </div>
        </div>`;
    }
    const choice = (id, title, text) => `<label><input type="radio" name="dooms-atlas-fill-what" value="${id}"${id === what ? ' checked' : ''} /> <span><strong>${title}</strong> · ${text}</span></label>`;
    const regionText = `lands with borders that lie around ${homeNeeded ? 'this one' : 'the ones here'}, each bordering its neighbours.${homeNeeded ? ` The ${homeHolds === 1 ? 'place' : `${homeHolds} places`} on this map ${homeHolds === 1 ? 'goes' : 'go'} inside a region of ${homeHolds === 1 ? 'its' : 'their'} own first (the AI names it; you can rename it), and this map becomes the map of the regions.` : ''}`;
    const whatField = options.length > 1
        ? `<fieldset class="dooms-atlas-setup-reach"><legend class="dooms-atlas-card-label">What to add</legend>
            ${options.includes('places') ? choice('places', 'Places on this map', 'towns, landmarks, wilds and the like, around the ones already here.') : ''}
            ${options.includes('regions') ? choice('regions', 'Neighbouring regions', regionText) : ''}
        </fieldset>`
        : (options[0] === 'regions' ? `<p class="dooms-atlas-start-note">This is a map of regions: what is added are ${regionText}</p>` : '');
    return `<div class="dooms-atlas-setup-card">
        <h3>Fill out ${e(mapLabel)}</h3>
        <p>The AI adds what plausibly belongs here, around what is already on the map, so there is more to explore. They are suggestions the story has not named: you check them first, and they go on the map marked as not canon.</p>
        ${whatField}
        <label class="dooms-atlas-field"><span class="dooms-atlas-card-label">What do you want more of? (optional)</span>
            <textarea class="dooms-atlas-input dooms-atlas-fill-wish" maxlength="600" rows="3" placeholder="&quot;A rough quarter to the east with a fighting pit.&quot; &quot;Cold uplands to the north, a marsh to the south.&quot; Leave empty for a bit of everything.">${e(wish)}</textarea></label>
        <label class="dooms-atlas-scale-pick">How many <select class="dooms-atlas-fill-count dooms-atlas-scale-select" aria-label="How many to add">${FILL_COUNTS.map(n => `<option value="${n}"${n === Number(count) ? ' selected' : ''}>${n}</option>`).join('')}</select></label>
        ${err}
        <div class="dooms-atlas-setup-actions">
            <button type="button" class="dooms-atlas-btn is-primary" data-act="fill-draft"><i class="fa-solid fa-wand-magic-sparkles" aria-hidden="true"></i> <span>Suggest</span></button>
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
            <i class="fa-solid ${attr(k.icon)}" aria-hidden="true"></i><span class="dooms-atlas-row-name${m.loose ? ' is-loose' : ''}"${m.loose ? ' title="Not canon"' : ''}>${e(m.label)}</span>${m.player ? hereChip : ''}${m.holds ? `<span class="dooms-atlas-row-people" title="${m.holds} ${m.holds === 1 ? 'place' : 'places'} inside"><i class="fa-solid fa-door-open" aria-hidden="true"></i> ${m.holds}</span>` : ''}${elsewhere ? `<span class="dooms-atlas-row-people">${e(m.layerLabel || 'top map')}</span>` : peopleChip(m)}
        </button></li>`;
    };
    return `${shown.length ? `<section class="dooms-atlas-group"><ul>${shown.map(m => row(m, false)).join('')}</ul></section>` : ''}${far.length ? `<section class="dooms-atlas-group"><span class="dooms-atlas-group-head">On other maps</span><ul>${far.map(m => row(m, true)).join('')}</ul></section>` : ''}`;
}

/**
 * The clean-up pass (D155): the button that asks for it, and what it
 * proposed, each to be approved or passed over.
 * @param {{ busy: boolean, items: Array, error: string, asked: boolean }|null} tidy
 */
export function atlasTidyHtml(tidy, { count = 0, canGroup = false } = {}) {
    const t = tidy || { busy: false, items: [], error: '', asked: false };
    const setup = `<button type="button" class="dooms-atlas-btn" data-act="setup" title="Draft this world's places with the AI, from your notes, the lore and the chat: what is inside what, placed for you. You check the draft first; applying it replaces this chat's map."><i class="fa-solid fa-compass-drafting" aria-hidden="true"></i> <span>Set up this world</span></button>`;
    const fill = `<button type="button" class="dooms-atlas-btn" data-act="fill" title="Add places that plausibly belong on this map, around the ones already here. You check them first; they go on the map marked as not canon, and nothing already there moves."><i class="fa-solid fa-seedling" aria-hidden="true"></i> <span>Fill out this map</span></button>`;
    const group = canGroup ? `<button type="button" class="dooms-atlas-btn" data-act="group" title="Put the places on this map inside a new region that stands where they stood: a land with borders you can click to enter. Each place keeps its spot, on the region's own map. Regions already here stay as its neighbours."><i class="fa-solid fa-object-group" aria-hidden="true"></i> <span>Group into a region</span></button>` : '';
    if (count < 2 && !t.items.length) return `<section class="dooms-atlas-tidy"><div class="dooms-atlas-tidy-buttons">${setup}${fill}${group}</div></section>`;
    const item = (x, i) => `<li class="dooms-atlas-tidy-item is-${attr(x.kind)}">
            <span class="dooms-atlas-tidy-text">${x.kind === 'merge' ? `Merge <strong>${e(x.label)}</strong> into <strong>${e(x.toLabel)}</strong>` : `Delete <strong>${e(x.label)}</strong>`}${x.why ? `<span class="dooms-atlas-tidy-why">${e(x.why)}</span>` : ''}</span>
            <button type="button" class="dooms-atlas-icon-btn is-yes" data-act="tidy-yes" data-i="${i}" title="Do it" aria-label="Do it"><i class="fa-solid fa-check" aria-hidden="true"></i></button>
            <button type="button" class="dooms-atlas-icon-btn" data-act="tidy-no" data-i="${i}" title="Leave it as it is" aria-label="Leave it as it is"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button>
        </li>`;
    const body = t.items.length
        ? `<ul>${t.items.map(item).join('')}</ul><div class="dooms-atlas-tidy-all"><button type="button" class="dooms-atlas-link" data-act="tidy-all">Do all ${t.items.length}</button><button type="button" class="dooms-atlas-link" data-act="tidy-none">Leave them all</button></div>`
        : (t.error ? `<p class="dooms-atlas-none is-error">${e(t.error)}</p>` : (t.asked && !t.busy ? '<p class="dooms-atlas-none">Nothing to tidy: no duplicates were found.</p>' : ''));
    return `<section class="dooms-atlas-tidy" aria-label="Set up and clean up the places">
        <div class="dooms-atlas-tidy-buttons">${setup}${fill}${group}<button type="button" class="dooms-atlas-btn" data-act="tidy"${t.busy ? ' disabled' : ''} title="Ask the AI to look over the places for duplicates and things that are not places. It only proposes: you approve each one."><i class="fa-solid fa-wand-magic-sparkles" aria-hidden="true"></i> <span>${t.busy ? 'Looking them over…' : 'Clean up with AI'}</span></button></div>
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
        ${atlasTidyHtml(tidy, { count: all.length || markers.length + tray.length, canGroup: markers.some(m => m.kind !== 'region') })}
        ${markers.some(m => m.kind === 'region') && markers.some(m => m.kind !== 'region') ? '<p class="dooms-atlas-mixed"><i class="fa-solid fa-circle-info" aria-hidden="true"></i> This map has regions and places side by side. <strong>Group into a region</strong> puts the places inside a land of their own, so every land borders its neighbours and no place is left between them.</p>' : ''}
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
export function atlasSideHtml({ name = 'The world', facts = {}, tab = 'places', body = '', status = '', result = '', canAdvance = false, advancing = false, editLabel = 'Edit this world', scenes = false, between = null, ending = null } = {}) {
    const active = ATLAS_TABS.some(t => t.id === tab) ? tab : ATLAS_TABS[0].id;
    const when = [facts.date, facts.time].filter(Boolean).join(', ');
    const tabs = ATLAS_TABS.map(t => `<button type="button" class="dooms-atlas-tab${t.id === active ? ' is-active' : ''}" data-act="tab" data-tab="${t.id}" role="tab" aria-selected="${t.id === active ? 'true' : 'false'}" title="${attr(t.label)}"><i class="fa-solid ${t.icon}" aria-hidden="true"></i><span>${e(t.label)}</span></button>`).join('');
    return `<header class="dooms-atlas-head">
            <h2 class="dooms-atlas-title">${e(name || 'The world')}</h2>
            <p class="dooms-atlas-sub">${when ? e(when) : 'No date in the tracker yet'}${facts.weather ? ` · ${e(facts.weather)}` : ''}</p>
            ${facts.location ? `<p class="dooms-atlas-sub is-place"><i class="fa-solid fa-location-dot" aria-hidden="true"></i> ${e(facts.location)}</p>` : ''}
            ${between ? `<p class="dooms-atlas-between" role="status"><i class="fa-solid fa-hourglass-half" aria-hidden="true"></i> <span>Between scenes: the world as it stands now, not as this chat left it.${between.open ? ` Scene ${e(between.open.number)}${between.open.title ? ` (${e(between.open.title)})` : ''} is being played, and the map is changed there.` : ''}</span>${between.open ? ` <button type="button" class="dooms-atlas-link" data-act="scene-go" data-id="${attr(between.open.id)}">Go to it</button>` : ''}</p>` : ''}
        </header>
        <nav class="dooms-atlas-tabs" role="tablist" aria-label="The world">${tabs}</nav>
        <div class="dooms-atlas-body" role="tabpanel" data-tab="${active}">${body}</div>
        <footer class="dooms-atlas-foot">
            <p class="dooms-atlas-status">${status}</p>
            <p class="dooms-atlas-result" role="status">${e(result)}</p>
            <div class="dooms-atlas-foot-actions">
                <button type="button" class="dooms-atlas-btn" data-act="advance"${canAdvance && !advancing ? '' : ' disabled'} title="Move the world on now: the people, the clocks, the news"><i class="fa-solid fa-forward" aria-hidden="true"></i> <span>${advancing ? 'Advancing…' : 'Advance now'}</span></button>
                <button type="button" class="dooms-atlas-btn" data-act="edit" title="Open this chat's world in the World Builder"><i class="fa-solid fa-pen" aria-hidden="true"></i> <span>${e(editLabel)}</span></button>
                ${ending ? `<button type="button" class="dooms-atlas-btn" data-act="end-scene" title="Write the record of this scene and remember it; the next one starts from the map"><i class="fa-solid fa-flag-checkered" aria-hidden="true"></i> <span>End scene ${e(ending.number || '')}</span></button>` : ''}
                ${scenes ? '<button type="button" class="dooms-atlas-btn" data-act="scenes" title="Play this story as many short chats that each start fresh and know what happened before"><i class="fa-solid fa-clapperboard" aria-hidden="true"></i> <span>Play as scenes</span></button>' : ''}
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
    if (m.territory) return `<span class="dooms-atlas-standard" title="${attr(m.label)}: its card"><i class="fa-solid fa-circle-info" aria-hidden="true"></i></span>${party}${faces}${weather}<span class="dooms-atlas-label">${e(m.label)}</span>`;
    const holds = m.holds ? `<span class="dooms-atlas-holds" title="${m.holds} ${m.holds === 1 ? 'place' : 'places'} inside: double-click to enter"><i class="fa-solid fa-door-open" aria-hidden="true"></i>${m.holds}</span>` : '';
    return `<span class="dooms-atlas-pin"><i class="fa-solid ${attr(k.icon)}" aria-hidden="true"></i></span>${party}${faces}${weather}${holds}<span class="dooms-atlas-label">${e(m.label)}</span>`;
}

/** A marker's classes: its kind, whether it was visited, whether the party is there. */
export function atlasMarkerClass(m) {
    return ['dooms-atlas-marker', `kind-${m.kind}`, m.visited ? 'is-visited' : '', m.player ? 'is-player' : '', m.holds ? 'is-layer' : '', m.loose ? 'is-loose' : '', m.territory ? 'is-territory' : '', m.picked ? 'is-picked' : ''].filter(Boolean).join(' ');
}

/** A region's name, written across its land. */
export function atlasRegionHtml(r) {
    return `<span class="dooms-atlas-region-name">${e(r.label)}</span>`;
}

/** A neighbouring region's name on the border shared with it (D168): turned the way the border runs, set on the neighbour's side of it. */
export function atlasBeyondHtml(n) {
    const turn = Number.isFinite(n.angle) ? Math.round(n.angle * 10) / 10 : 0;
    return `<span class="dooms-atlas-beyond-name" style="--turn:${turn}deg;--side:${n.side < 0 ? -1 : 1}" title="Go to ${e(n.label)}">${e(n.label)}</span>`;
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
export function atlasCardHtml({ marker = null, mode = 'view', others = [], distance = '', canTravel = false, travelling = false, rumours = [], news = [], portraits = () => '', canStart = false, sceneNo = 0 } = {}) {
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
        const kinds = ATLAS_KINDS.map(x => `<option value="${x.id}"${x.id === m.kind ? ' selected' : ''}>${e(x.id === 'region' ? 'Region (a land with borders)' : x.label)}</option>`).join('');
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
    const travel = m.player || (canStart && !canTravel)    // the party is here already; or between scenes, where a scene is how one goes anywhere
        ? ''
        : `<div class="dooms-atlas-card-travel">
            <input type="text" class="dooms-atlas-when" maxlength="80" placeholder="arriving when… (optional)" aria-label="Arriving when" />
            <button type="button" class="dooms-atlas-btn is-primary" data-act="travel" data-id="${id}"${canTravel && !travelling ? '' : ' disabled'} title="${canTravel ? 'The next reply montages the road, then the arrival' : 'Travel needs Live World on and a chat open'}"><i class="fa-solid fa-person-walking" aria-hidden="true"></i> <span>${travelling ? 'Setting out…' : 'Travel here'}</span></button>
        </div>`;
    // A world played as scenes (D174): a scene is started here, in a chat of its own. Between scenes it is the way to go anywhere.
    const start = canStart ? `<div class="dooms-atlas-card-scene"><button type="button" class="dooms-atlas-btn${canTravel && !m.player ? '' : ' is-primary'}" data-act="scene-start" data-id="${id}" title="A fresh chat that opens here, knowing what happened before"><i class="fa-solid fa-clapperboard" aria-hidden="true"></i> <span>Start ${sceneNo ? `scene ${sceneNo}` : 'a scene'} here</span></button></div>` : '';
    const tool = (act, icon, label, title) => `<button type="button" class="dooms-atlas-card-tool" data-act="${act}" data-id="${id}" title="${attr(title)}"><i class="fa-solid ${icon}" aria-hidden="true"></i><span>${label}</span></button>`;
    return `<article class="dooms-atlas-card kind-${attr(m.kind)}" data-id="${id}">
        ${picture ? `<div class="dooms-atlas-card-picture" style="background-image: url('${attr(picture)}')"></div>` : ''}
        ${head}
        ${m.note ? `<p class="dooms-atlas-card-note">${e(m.note)}</p>` : ''}
        ${m.loose ? `<p class="dooms-atlas-card-loose"><span><i class="fa-regular fa-circle-question" aria-hidden="true"></i> Not canon: the AI added this and the story has not named it. Edit it to suit, or delete it.</span><button type="button" class="dooms-atlas-btn" data-act="canon" data-id="${id}" title="It is part of the story now: the mark comes off">Make it canon</button></p>` : ''}
        ${rooms}
        ${names}
        ${m.weather && (m.weather.text || m.weather.emoji) ? `<p class="dooms-atlas-card-weather">${e(m.weather.emoji)} ${e(m.weather.text)}</p>` : ''}
        ${where}
        ${people}
        ${list('Rumours', rumours)}
        ${list('Lately', news)}
        ${travel}
        ${start}
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

/** A set time in hours as the figure and the unit a road's card shows: days from a day up, hours from an hour, else minutes. */
export function roadTimeParts(hours) {
    if (!(hours > 0)) return { amount: '', unit: '' };
    const trim = (n) => String(Math.round(n * 100) / 100);
    if (hours >= 8) return { amount: trim(hours / 8), unit: 'days' };
    if (hours >= 1) return { amount: trim(hours), unit: 'hours' };
    return { amount: trim(hours * 60), unit: 'minutes' };
}

/** A figure and a unit as hours of travel (a day is eight of them); 0 for nothing usable. */
export function roadTimeHours(amount, unit) {
    const n = Number(String(amount ?? '').replace(',', '.'));
    if (!Number.isFinite(n) || n <= 0) return 0;
    return unit === 'days' ? n * 8 : unit === 'minutes' ? n / 60 : n;
}

/**
 * A road's card (D165): the two places it joins, what it is as drawn, and
 * the travel time the player can give it; Save and Remove.
 * @param {object} o
 * @param {{id:string,label:string}} o.a
 * @param {{id:string,label:string}} o.b
 * @param {string} o.drawn      "83 miles, about 3.5 days on foot": the road by its length
 * @param {number} o.hours      the set time in hours, or 0
 * @param {string} o.unit       the unit offered when none is set ('days' | 'hours' | 'minutes')
 */
export function atlasRoadHtml({ a = { id: '', label: '' }, b = { id: '', label: '' }, drawn = '', hours = 0, unit = 'days' } = {}) {
    const set = roadTimeParts(hours);
    const u = set.unit || unit;
    const opt = (id, label) => `<option value="${id}"${id === u ? ' selected' : ''}>${label}</option>`;
    return `<article class="dooms-atlas-card is-road" data-a="${attr(a.id)}" data-b="${attr(b.id)}">
        <header class="dooms-atlas-card-head">
            <span class="dooms-atlas-pin is-road"><i class="fa-solid fa-road" aria-hidden="true"></i></span>
            <div>
                <h3 class="dooms-atlas-card-title">Road</h3>
                <p class="dooms-atlas-card-kind">${e(a.label)} <i class="fa-solid fa-arrows-left-right" aria-hidden="true"></i> ${e(b.label)}</p>
            </div>
        </header>
        <p class="dooms-atlas-card-note">${hours > 0 ? `Set to ${e(describeSet(hours))}. ` : ''}As drawn: ${e(drawn)}.</p>
        <label class="dooms-atlas-field"><span class="dooms-atlas-card-label">Travel time on this road</span>
            <span class="dooms-atlas-road-time">
                <input type="number" class="dooms-atlas-input" data-field="amount" min="0" step="any" inputmode="decimal" placeholder="by its length" value="${attr(set.amount)}" aria-label="How long" />
                <select class="dooms-atlas-input" data-field="unit" aria-label="Unit">${opt('minutes', 'minutes')}${opt('hours', 'hours')}${opt('days', 'days')}</select>
            </span></label>
        <p class="dooms-atlas-card-hint">A set time is what the card and Travel here go by, however far apart the two places are drawn. Leave it empty to go by the road's length.</p>
        <div class="dooms-atlas-card-actions">
            <button type="button" class="dooms-atlas-btn is-primary" data-act="road-save"><i class="fa-solid fa-check" aria-hidden="true"></i> <span>Save</span></button>
            <button type="button" class="dooms-atlas-btn" data-act="road-remove"><i class="fa-solid fa-trash-can" aria-hidden="true"></i> <span>Remove road</span></button>
        </div>
    </article>`;
}

/** A set time in words: "2 days", "half a day", "3 hours", "20 minutes". */
function describeSet(hours) {
    const p = roadTimeParts(hours);
    const n = Number(p.amount);
    if (p.unit === 'days' && n === 0.5) return 'half a day';
    const one = { days: 'day', hours: 'hour', minutes: 'minute' }[p.unit];
    return `${p.amount} ${n === 1 ? one : `${one}s`}`;
}

/** The scale bar's figures at a zoom: the round length that fits `maxPx`, its width and its words. `perPx` is world units in one screen pixel. */
export function scaleBarFor(perPx, maxPx = 120) {
    if (!(perPx > 0)) return { px: 0, length: 0 };
    const max = perPx * maxPx;
    const pow = Math.pow(10, Math.floor(Math.log10(max)));
    const length = [5, 2, 1].map(n => n * pow).find(n => n <= max) || pow;
    return { px: Math.round(length / perPx), length: Number(length.toPrecision(3)) };
}
