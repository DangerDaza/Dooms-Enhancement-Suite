/**
 * The World Builder's views (docs/world-builder-plan.md D94): pure HTML
 * from the worlds on offer and the world being edited, in the file's
 * shape. No DOM, no SillyTavern: tools/world-builder-layout-test.mjs
 * renders them in a headless browser; src/systems/ui/worldBuilder.js puts
 * them on the page and edits the world through them.
 */
import { escapeHtml } from '../../utils/html.js';
import { normalizePack } from '../../utils/liveWorld.js';
import { packWarnings, worldSummary } from '../../utils/worldBuilder.js';

export const POPUP_ID = 'dooms-world-builder';
export const WB_TABS = Object.freeze([
    { id: 'world', label: 'World', icon: 'fa-earth-europe' },
    { id: 'places', label: 'Places', icon: 'fa-map-location-dot' },
    { id: 'clocks', label: 'Clocks', icon: 'fa-clock' },
    { id: 'cast', label: 'Cast', icon: 'fa-users' },
]);

const e = escapeHtml;
const attr = (v) => escapeHtml(String(v ?? ''));

/** The window's shell: the popup, its header, its body. The controller fills .dooms-wb-body. */
export function builderShellHtml() {
    return `<div id="${POPUP_ID}" class="rpg-settings-popup" role="dialog" aria-modal="true" aria-labelledby="dooms-wb-title" style="display: none;">
        <div class="rpg-settings-popup-content">
            <header class="rpg-settings-popup-header">
                <h3 id="dooms-wb-title"><i class="fa-solid fa-earth-europe" aria-hidden="true"></i> <span>World Builder</span></h3>
                <button id="dooms-wb-close" class="rpg-popup-close" type="button" aria-label="Close">&times;</button>
            </header>
            <div class="rpg-settings-popup-body"><div class="dooms-wb-body"></div></div>
        </div>
    </div>`;
}

/**
 * The window: your worlds and the ways to a new one on the left, the world
 * being edited on the right under its tabs, its errors and warnings, the
 * foot.
 * @param {object} o
 * @param {Array} o.worlds       listWorlds() rows: { id, name, custom, template, ok, errors, summary }
 * @param {string} o.selectedId  the world open: an id, 'new' for one not saved yet, '' for none
 * @param {object|null} o.draft  the world being edited, in the file's shape
 * @param {boolean} o.dirty      changes not saved
 * @param {string} o.tab         'world' | 'places' | 'clocks' | 'cast'
 * @param {string} o.note        the last result line
 * @param {string} o.busy        'draft' while a draft is being written
 * @param {boolean} o.adoptOnSave  Save makes it the open chat's world (D96)
 * @param {{ pack?: string, chatPack?: string, chatOpen?: boolean }} o.where  the world for new chats, the open chat's world id, whether a chat is open
 */
export function builderHtml({ worlds = [], selectedId = '', draft = null, dirty = false, tab = 'world', note = '', busy = '', adoptOnSave = false, where = {} } = {}) {
    const w = { pack: '', chatPack: '', chatOpen: false, ...where };
    const hasTemplate = worlds.some(x => x && x.template);
    const left = `<aside class="dooms-wb-list" aria-label="Your worlds">
        <div class="dooms-wb-new">
            <button type="button" class="rpg-accordion-action-btn" data-act="new" title="A world with nothing in it yet"><i class="fa-solid fa-plus" aria-hidden="true"></i> New world</button>
            <button type="button" class="rpg-accordion-action-btn" data-act="draft"${busy === 'draft' || !w.chatOpen ? ' disabled' : ''} title="${w.chatOpen ? 'One request writes the places, the clocks and the people from the character card, the lore and the recent chat; you read it before it is a world' : 'Open a chat first'}"><i class="fa-solid fa-wand-magic-sparkles" aria-hidden="true"></i> ${busy === 'draft' ? 'Drafting…' : 'Draft from this chat'}</button>
            ${hasTemplate ? '<button type="button" class="rpg-accordion-action-btn" data-act="template" title="Harbourside, the example port town, as a world of your own to change"><i class="fa-solid fa-copy" aria-hidden="true"></i> Start from Harbourside</button>' : ''}
            <button type="button" class="rpg-accordion-action-btn" data-act="import" title="A world's JSON file: one exported here, or written by hand"><i class="fa-solid fa-file-import" aria-hidden="true"></i> Import a file</button>
        </div>
        <div class="dooms-wb-worlds" role="list">${worldRows(worlds, selectedId, w)}</div>
    </aside>`;
    const right = `<section class="dooms-wb-editor">${draft ? editorHtml({ draft, selectedId, dirty, tab, note, adoptOnSave, where: w, worlds }) : emptyEditorHtml(worlds)}</section>`;
    return `<div class="dooms-wb">${left}${right}</div>`;
}

function worldRows(worlds, selectedId, w) {
    const mine = worlds.filter(x => x && x.custom);
    const templates = worlds.filter(x => x && !x.custom);
    const row = (x) => {
        const badges = [
            w.pack === x.id ? '<span class="dooms-wb-badge is-new" title="New chats start here">new chats</span>' : '',
            w.chatPack === x.id ? '<span class="dooms-wb-badge is-chat" title="The open chat plays in it">this chat</span>' : '',
            x.template ? '<span class="dooms-wb-badge" title="Shipped with the extension; Save keeps a copy as your own">template</span>' : '',
            !x.ok ? '<span class="dooms-wb-badge is-broken" title="' + attr((x.errors || []).join(' ')) + '">cannot be read</span>' : '',
        ].filter(Boolean).join('');
        return `<button type="button" class="dooms-wb-world${x.id === selectedId ? ' is-selected' : ''}${x.ok ? '' : ' is-broken'}" data-act="open" data-id="${attr(x.id)}" role="listitem">
            <span class="dooms-wb-world-name">${e(x.name || x.id)}</span>
            <span class="dooms-wb-world-sum">${x.ok ? e(x.summary || '') : e((x.errors || [])[0] || 'cannot be read')}</span>
            ${badges ? `<span class="dooms-wb-badges">${badges}</span>` : ''}
        </button>`;
    };
    const none = mine.length ? '' : '<p class="dooms-world-muted dooms-wb-none">No worlds of your own yet. New world, Draft from this chat or Start from Harbourside makes one; a chat with no world chosen plays in the blank world and grows from the story.</p>';
    return `${none}${mine.map(row).join('')}${templates.map(row).join('')}`;
}

function emptyEditorHtml(worlds) {
    const any = worlds.some(x => x && x.custom);
    return `<div class="dooms-wb-hint dooms-wb-welcome">
        <p>${any ? 'Pick a world on the left, or make one.' : 'Make a world: New world, Draft from this chat, Start from Harbourside, or Import a file.'}</p>
        <p>A world is its <strong>places</strong> (a tree: a region, its districts, the rooms the story uses), its <strong>clocks</strong> (what builds between scenes, with what anyone could see at each step) and its <strong>cast</strong> (who lives there, and where). A chat keeps the world it starts in; new chats start in the one chosen in Settings → Live World, the blank world unless you choose another. The blank world grows from play: the places the story names, the people who speak; Make this a world in the Map window keeps what grew.</p>
    </div>`;
}

function count(draft, id) {
    if (!['places', 'clocks', 'cast'].includes(id)) return '';
    const n = Array.isArray(draft[id]) ? draft[id].length : 0;
    return ` <span class="dooms-wb-count">${n}</span>`;
}

function editorHtml({ draft, selectedId, dirty, tab, note, adoptOnSave, where, worlds }) {
    const n = normalizePack(draft);
    const errors = n.errors;
    const warnings = n.ok ? packWarnings(n.pack) : [];
    const isNew = selectedId === 'new';
    const isTemplate = !isNew && worlds.some(x => x && x.id === selectedId && x.template);
    const active = WB_TABS.some(t => t.id === tab) ? tab : 'world';
    const tabs = WB_TABS.map(t => `<button type="button" class="dooms-wb-tab${t.id === active ? ' is-active' : ''}" data-act="tab" data-tab="${t.id}" role="tab" aria-selected="${t.id === active ? 'true' : 'false'}"><i class="fa-solid ${t.icon}" aria-hidden="true"></i> ${t.label}${count(draft, t.id)}</button>`).join('');
    const pane = active === 'places' ? placesPane(draft) : active === 'clocks' ? clocksPane(draft) : active === 'cast' ? castPane(draft) : worldPane(draft);
    const notes = [
        `${e(n.pack.id || '')} · ${e(worldSummary(n.pack))}`,
        isTemplate ? 'the template: Save keeps a copy as your own' : '',
        adoptOnSave ? 'Save makes it this chat\'s world' : '',
    ].filter(Boolean).join(' · ');
    const head = `<div class="dooms-wb-head">
        <span class="dooms-wb-name">${nameHtml(draft, dirty)}</span>
        <span class="dooms-world-muted">${notes}</span>
    </div>`;
    const usedForNew = where.pack === selectedId;
    const foot = `<div class="dooms-wb-foot">
        <button type="button" class="rpg-accordion-action-btn" data-act="save"${errors.length ? ' disabled' : ''} title="${errors.length ? 'Fix what is listed first' : 'Keep the world under its id'}"><i class="fa-solid fa-floppy-disk" aria-hidden="true"></i> Save</button>
        <button type="button" class="rpg-accordion-action-btn" data-act="copy"${errors.length ? ' disabled' : ''} title="Keep it under a new name as well"><i class="fa-solid fa-copy" aria-hidden="true"></i> Save as copy</button>
        <button type="button" class="rpg-accordion-action-btn" data-act="export"${errors.length ? ' disabled' : ''} title="Download the world as a JSON file"><i class="fa-solid fa-file-export" aria-hidden="true"></i> Export</button>
        ${!isNew && !isTemplate ? `<button type="button" class="rpg-accordion-action-btn" data-act="use"${usedForNew ? ' disabled' : ''} title="New chats start in this world">${usedForNew ? 'Used for new chats' : 'Use for new chats'}</button>` : ''}
        ${!isNew && !isTemplate ? '<button type="button" class="rpg-accordion-action-btn is-danger" data-act="delete" title="Remove the world; a chat in it goes on in the blank world until it is imported back"><i class="fa-solid fa-trash" aria-hidden="true"></i> Delete</button>' : ''}
    </div>`;
    return `${head}<nav class="dooms-wb-tabs" role="tablist" aria-label="The world's parts">${tabs}</nav><div class="dooms-wb-pane" data-tab="${active}">${pane}</div><div class="dooms-wb-status">${statusHtml(errors, warnings, note)}</div>${foot}`;
}

/** The world's name in the head, with the unsaved mark. */
export function nameHtml(draft, dirty) {
    return `${e((draft && draft.name) || 'Unnamed world')}${dirty ? ' <span class="dooms-wb-dirty" title="Not saved yet">•</span>' : ''}`;
}

/**
 * The status under the pane: what the builder is doing (the note), then
 * what stops Save (the pack's errors, amber, each saying what to fix) and
 * what the world plays without but would be the better for (the warnings,
 * muted, each saying where to add it).
 */
export function statusHtml(errors = [], warnings = [], note = '') {
    const line = note ? `<p class="dooms-wb-note">${e(note)}</p>` : '';
    const errs = errors.length
        ? `<p class="dooms-wb-status-head is-error">Fix before saving:</p><ul class="dooms-wb-errors">${errors.map(x => `<li>${e(x)}</li>`).join('')}</ul>`
        : '';
    const warns = warnings.length
        ? `<p class="dooms-wb-status-head">Missing, but the world plays without it:</p><ul class="dooms-wb-warnings">${warnings.map(x => `<li>${e(x)}</li>`).join('')}</ul>`
        : '';
    return `${line}${errs}${warns}`;
}

function field(key, label, control, hint) {
    return `<label class="dooms-wb-field" data-key="${key}"><span class="dooms-wb-label">${label}</span>${control}${hint ? `<span class="dooms-wb-hint">${hint}</span>` : ''}</label>`;
}

function worldPane(d) {
    return `<p class="dooms-wb-hint">A world is what Live World keeps moving while you play: its <strong>places</strong> (the Places tab), its <strong>clocks</strong>, the pressures that build between scenes (Clocks), and the <strong>people</strong> who live there (Cast). Every few replies a quiet request, the plot advancer, reads what happened and moves the clocks and the people; each turn the narrator is told in one line where things stand. This tab is the world itself: what it is called, what it is, and how the narrator hears of it.</p>
    <div class="dooms-wb-fields">
        ${field('name', 'Name', `<input type="text" class="rpg-accordion-input" data-f="name" value="${attr(d.name)}" maxlength="80" placeholder="The world's name">`, 'Shown across the top of the Map window, and in the narrator\'s line as "World of …".')}
        ${field('id', 'Id', `<input type="text" class="rpg-accordion-input" data-f="id" value="${attr(d.id)}" maxlength="60" placeholder="a-short-slug">`, 'A short handle in letters, digits and dashes: the name of the file when the world is exported, and how a chat remembers which world it plays in. Changing it on a saved world moves the world, and the chats in it follow.')}
        ${field('description', 'Description', `<textarea class="rpg-accordion-input" data-f="description" rows="2" maxlength="400" placeholder="One or two sentences: what this world is.">${e(d.description || '')}</textarea>`, 'A sentence or two for the plot advancer: the kind of world this is, so what it moves fits. The narrator never sees this.')}
        ${field('blurb', 'Blurb', `<textarea class="rpg-accordion-input" data-f="blurb" rows="2" maxlength="600" placeholder="What the world talks about as the story opens.">${e(d.blurb || '')}</textarea>`, 'What people are saying as the story opens. The Map window\'s Rumours panel shows it, and the plot advancer rewrites it as things change.')}
        ${field('template', 'The narrator\'s line (optional)', `<textarea class="rpg-accordion-input" data-f="template" rows="2" placeholder="[WORLD OF {name}: clocks: {clocks}. Last seen: {where}.]">${e(d.template || '')}</textarea>`, 'Each turn the narrator gets one line on where the world stands: the clocks and where people were last seen. Leave this empty for the standard line, or write your own with {name}, {clocks} and {where} where those go.')}
    </div>`;
}

/** The places as a tree: roots in their order, each followed by its children; a place in a loop at the end. Each with its index in the file. */
export function treeOrder(places) {
    const list = Array.isArray(places) ? places : [];
    const ids = new Set(list.map(p => p && p.id));
    const out = [];
    const seen = new Set();
    const childrenOf = (pid) => list.map((place, i) => ({ place, i })).filter(({ place }) => place && ((place.parent || null) === pid || (pid === null && place.parent && !ids.has(place.parent))));
    const walk = (pid, depth) => {
        for (const x of childrenOf(pid)) {
            if (seen.has(x.i)) continue;
            seen.add(x.i);
            out.push({ ...x, depth });
            if (depth < 12) walk(x.place.id, depth + 1);
        }
    };
    walk(null, 0);
    list.forEach((place, i) => { if (place && !seen.has(i)) out.push({ place, i, depth: 0 }); });
    return out;
}

function placeOptions(places, value, excludeId) {
    return (Array.isArray(places) ? places : []).filter(p => p && p.id && p.id !== excludeId).map(p => `<option value="${attr(p.id)}"${p.id === value ? ' selected' : ''}>${e(p.label || p.id)}</option>`).join('');
}

function placesPane(d) {
    const places = Array.isArray(d.places) ? d.places : [];
    const rows = treeOrder(places).map(({ place, i, depth }) => `<div class="dooms-wb-row dooms-wb-place" style="--depth: ${depth}" data-i="${i}">
        <input type="text" class="rpg-accordion-input dooms-wb-grow" data-f="places.${i}.label" value="${attr(place.label)}" maxlength="80" placeholder="The place as the story names it" aria-label="Label">
        <select class="rpg-accordion-select" data-f="places.${i}.parent" aria-label="Inside" title="The place this one is inside"><option value="">— top level —</option>${placeOptions(places, place.parent, place.id)}</select>
        <input type="text" class="rpg-accordion-input dooms-wb-image" data-f="places.${i}.image" value="${attr(place.image || '')}" placeholder="picture URL (optional)" aria-label="Picture">
        <span class="dooms-wb-id" title="The id the advancer uses">${e(place.id)}</span>
        <button type="button" class="dooms-wb-remove" data-act="remove" data-kind="places" data-i="${i}" title="Remove this place" aria-label="Remove ${attr(place.label)}">&times;</button>
    </div>`).join('');
    return `<p class="dooms-wb-hint">The places the story moves through, as a tree: a region, its districts, the rooms the story uses. "Inside" nests a place; the Map window shows a place's parent under its name. A place the story names that is not here is kept by the Map all the same.</p>
    <div class="dooms-wb-rows">${rows || '<p class="dooms-world-muted">No places yet.</p>'}</div>
    <button type="button" class="rpg-accordion-action-btn" data-act="add-place"><i class="fa-solid fa-plus" aria-hidden="true"></i> Add a place</button>`;
}

function clocksPane(d) {
    const clocks = Array.isArray(d.clocks) ? d.clocks : [];
    const places = Array.isArray(d.places) ? d.places : [];
    const cards = clocks.map((c, i) => {
        const max = Number.isInteger(c.max) && c.max > 0 ? Math.min(24, c.max) : 6;
        const effects = c.effects && typeof c.effects === 'object' ? c.effects : {};
        const steps = Array.from({ length: max + 1 }, (_, n) => `<label class="dooms-wb-step"><span class="dooms-wb-step-n">${n}</span><input type="text" class="rpg-accordion-input" data-f="clocks.${i}.effects.${n}" value="${attr(effects[n] || '')}" maxlength="240" placeholder="${n === 0 ? 'what the street sees at rest' : `at step ${n}`}" aria-label="Step ${n}"></label>`).join('');
        return `<div class="dooms-wb-clock" data-i="${i}">
            <div class="dooms-wb-row">
                <input type="text" class="rpg-accordion-input dooms-wb-grow" data-f="clocks.${i}.label" value="${attr(c.label)}" maxlength="80" placeholder="What is building" aria-label="Label">
                <select class="rpg-accordion-select" data-f="clocks.${i}.place" aria-label="Place" title="The place the clock concerns (optional)"><option value="">— no place —</option>${placeOptions(places, c.place, '')}</select>
                <label class="dooms-wb-num">start <input type="number" class="rpg-accordion-input" data-f="clocks.${i}.start" value="${attr(c.start ?? 0)}" min="0" max="${max}" aria-label="Start"></label>
                <label class="dooms-wb-num">max <input type="number" class="rpg-accordion-input" data-f="clocks.${i}.max" value="${attr(max)}" min="1" max="24" aria-label="Max"></label>
                <label class="dooms-wb-num" title="How far it may move in one run; empty: the setting on the Live World page">step <input type="number" class="rpg-accordion-input" data-f="clocks.${i}.step" value="${attr(c.step ?? '')}" min="1" max="6" placeholder="–" aria-label="Step"></label>
                <label class="dooms-wb-check" title="A hidden clock moves but is never told to the narrator or shown in Rumours"><input type="checkbox" data-f="clocks.${i}.hidden"${c.hidden ? ' checked' : ''}> hidden</label>
                <span class="dooms-wb-id" title="The id the advancer uses">${e(c.id)}</span>
                <button type="button" class="dooms-wb-remove" data-act="remove" data-kind="clocks" data-i="${i}" title="Remove this clock" aria-label="Remove ${attr(c.label)}">&times;</button>
            </div>
            <div class="dooms-wb-steps">${steps}</div>
        </div>`;
    }).join('');
    return `<p class="dooms-wb-hint">A clock is a pressure that grows or eases between scenes: a blockade, a fever, a feud. The advancer moves it by at most its step each run; the text at each step is what anyone in the world could see or hear, and Rumours shows the current one.</p>
    <div class="dooms-wb-rows">${cards || '<p class="dooms-world-muted">No clocks yet: nothing moves between scenes until there is one.</p>'}</div>
    <button type="button" class="rpg-accordion-action-btn" data-act="add-clock"><i class="fa-solid fa-plus" aria-hidden="true"></i> Add a clock</button>`;
}

function castPane(d) {
    const cast = Array.isArray(d.cast) ? d.cast : [];
    const places = Array.isArray(d.places) ? d.places : [];
    const rows = cast.map((m, i) => `<div class="dooms-wb-row dooms-wb-person" data-i="${i}">
        <input type="text" class="rpg-accordion-input dooms-wb-grow" data-f="cast.${i}.name" value="${attr(m.name)}" maxlength="60" placeholder="Name" aria-label="Name">
        <select class="rpg-accordion-select" data-f="cast.${i}.place" aria-label="Starting place"><option value="">— nowhere yet —</option>${placeOptions(places, m.place, '')}</select>
        <select class="rpg-accordion-select dooms-wb-tier" data-f="cast.${i}.tier" aria-label="Tier" title="Known: the player has met them. Heard of: only spoken of"><option value="known"${m.tier === 'known' ? ' selected' : ''}>known</option><option value="heard"${m.tier !== 'known' ? ' selected' : ''}>heard of</option></select>
        <button type="button" class="dooms-wb-remove" data-act="remove" data-kind="cast" data-i="${i}" title="Remove" aria-label="Remove ${attr(m.name)}">&times;</button>
    </div>`).join('');
    return `<p class="dooms-wb-hint">The people of the world and where they start. Known: on the Map's People panel from the first scene; heard of: named, not met yet. The story adds whoever speaks; the player is never cast.</p>
    <div class="dooms-wb-rows">${rows || '<p class="dooms-world-muted">No one yet.</p>'}</div>
    <button type="button" class="rpg-accordion-action-btn" data-act="add-person"><i class="fa-solid fa-plus" aria-hidden="true"></i> Add a person</button>`;
}
