/**
 * The Map window's views (docs/map-window-plan.md D85, D88): the world's
 * name across the top, the row of places as circles (newest on the left),
 * the strip for the selected place (Travel here, Draw), the bottom panel
 * that swaps between News, Rumours, People and Completed quests, and a
 * face's trail (the popover), as HTML. Pure apart from `portraits`, so
 * tests render them without the portrait store; the modules that mount
 * them (worldDashboard.js, worldFace.js) own the events. Never a clock's
 * number: the effect text is all anyone sees.
 */
import { escapeHtml } from '../../utils/html.js';
import { publicEffects, recentChanges, groupChangesByDate, characterTimeline } from '../../utils/liveWorld.js';
import { facesOfTheWorld } from '../../utils/worldBoard.js';

export const FEED_LIMITS = Object.freeze([12, 50, 0]);    // 0: everything the log holds

/** The bottom panel's functions, in order; the first is the one the window opens on. */
export const MAP_PANELS = Object.freeze([
    { id: 'news', label: 'News', icon: 'fa-newspaper', title: 'What moved lately: people and clocks, under their dates' },
    { id: 'rumours', label: 'Rumours', icon: 'fa-comments', title: 'Word on the street: what people say' },
    { id: 'people', label: 'People', icon: 'fa-users', title: 'The faces last seen, and where' },
    { id: 'done', label: 'Completed quests', icon: 'fa-check-double', title: 'The quests completed in this chat' },
]);

/** The first grapheme of each of the first two words (an emoji or a flag stays whole); a letter is upper-cased when that keeps it one letter. */
export function initials(name) {
    const first = (w) => {
        try {
            if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
                const it = new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(w)[Symbol.iterator]().next();
                if (!it.done) return it.value.segment;
            }
        } catch (e) { /* no segmenter */ }
        return Array.from(w)[0] || '';
    };
    return String(name).split(/\s+/).filter(Boolean).slice(0, 2).map(w => {
        const g = first(w);
        const up = g.toUpperCase();
        return Array.from(up).length === Array.from(g).length ? up : g;
    }).join('') || '?';
}

/** The line the window shows when there is nothing to draw, or '' when there is a world. */
export function worldEmptyMessage({ state, pack, cfg, packError = '', masterOn = true } = {}) {
    if (!masterOn) return '<p class="dooms-world-empty">Doom\'s Enhancement Suite is off; Live World runs only while it is on.</p>';
    if (!cfg || !cfg.enabled) return '<p class="dooms-world-empty">Live World is off. Settings → Live World switches it on.</p>';
    if (packError) return `<p class="dooms-world-empty is-error">This chat has no world: ${escapeHtml(packError)}</p>`;
    if (!state || !pack) return '<p class="dooms-world-empty">This chat has no world yet. Open a chat with Live World on, or re-seed it in Settings → Live World.</p>';
    return '';
}

/** When the world last moved and when it runs next. */
export function statusText(state, cfg) {
    const last = state.last && state.last.ok
        ? `Last advanced ${state.last.gameDate ? `on ${escapeHtml(state.last.gameDate)}` : 'once'}${state.last.elapsed ? ` (${escapeHtml(state.last.elapsed)} passed)` : ''}`
        : 'Not advanced yet';
    const nextIn = Math.max(0, cfg.every - state.sinceLast);
    const next = state.retryNext ? 'runs again on the next reply' : `next run in ${nextIn} repl${nextIn === 1 ? 'y' : 'ies'}`;
    return `${last} · ${next}.`;
}

/** The last failed attempt in a line: a request that failed says so (no spoiler in that); a reply that broke a rule names the rule unless spoiler-free. */
export function errorLine(err, cfg) {
    if (!err) return '';
    if (err.kind === 'error') return `The last advance failed: ${escapeHtml(err.error || 'the request did not complete')}; it runs again on the next reply.`;
    return `Last attempt discarded: ${cfg && cfg.spoilerFree ? 'the reply broke a rule (the System Log has the detail)' : escapeHtml(err.error || '')}`;
}

/** A character as a small round token: their portrait, or their initials. A button when it is to open their trail. */
export function tokenHtml(name, url, { button = false } = {}) {
    const n = escapeHtml(name);
    const inner = url
        ? `<img class="dooms-world-token" src="${escapeHtml(url)}" alt="${n}" title="${n}" />`
        : `<span class="dooms-world-token" title="${n}" aria-label="${n}">${escapeHtml(initials(name))}</span>`;
    return button ? `<button type="button" class="dooms-world-token-btn" data-name="${n}" title="${n}: where they have been">${inner}</button>` : inner;
}

/**
 * People: the known characters as the shelf's own portrait cards with the
 * place under the name and the date of their last move (or "in the scene"
 * when the scene is somewhere the pack does not name), the heard-of names
 * in one box.
 */
export function peopleHtml({ state, pack, portraits = () => '', present = [], sceneText = '' } = {}) {
    const faces = facesOfTheWorld(pack, state);
    const inScene = (name) => (present || []).some(n => String(n).toLowerCase() === String(name).toLowerCase());
    const cards = faces.known.map(f => {
        const url = portraits(f.name);
        const n = escapeHtml(f.name);
        const face = url
            ? `<img src="${escapeHtml(url)}" alt="" />`
            : `<div class="dooms-portrait-card-emoji" aria-hidden="true">${escapeHtml(initials(f.name))}</div>`;
        const when = f.gameDate ? `<span class="dooms-world-when" title="Last moved ${escapeHtml(f.gameDate)}${f.gameTime ? `, ${escapeHtml(f.gameTime)}` : ''}">${escapeHtml(f.gameDate)}</span>` : '';
        const place = f.place
            ? `<span class="dooms-world-place" title="${escapeHtml(f.place)}">📍 ${escapeHtml(f.place)}</span>`
            : inScene(f.name)
                ? `<span class="dooms-world-place" title="${sceneText ? `In the scene: ${escapeHtml(sceneText)} (not a place the pack names)` : 'In the scene'}">📍 in the scene</span>`
                : '<span class="dooms-world-place">nowhere yet</span>';
        return `<button type="button" class="dooms-portrait-card dooms-world-card" data-name="${n}" title="${n}: where they have been">${face}${when}<div class="dooms-portrait-card-name">${n}${place}</div></button>`;
    }).join('');
    const heard = faces.heard.length
        ? `<div class="dooms-world-heard"><span class="dooms-inv-label">Heard of</span><span>${faces.heard.map(escapeHtml).join('<br>')}</span><span class="dooms-world-muted">Not met yet</span></div>`
        : '';
    return `<section class="dooms-world-seen">
        <div class="dooms-inv-head"><span class="dooms-inv-label">👁 Last seen</span><span class="dooms-inv-fill" title="Known characters">${faces.known.length}</span></div>
        <div class="dooms-world-cards">${cards || '<p class="dooms-world-muted">No one known yet.</p>'}${heard}</div>
    </section>`;
}

/** News: the changes under their dates, with the filter. */
export function newsHtml({ state, pack, cfg, feed = FEED_LIMITS[0] } = {}) {
    const limit = FEED_LIMITS.includes(Number(feed)) ? Number(feed) : FEED_LIMITS[0];
    const changes = recentChanges(state, pack, { limit: limit || Number.MAX_SAFE_INTEGER, spoilerFree: !!cfg.spoilerFree });
    const groups = groupChangesByDate(changes);
    const options = FEED_LIMITS.map(n => `<option value="${n}"${n === limit ? ' selected' : ''}>${n ? `Latest ${n}` : 'Everything'}</option>`).join('');
    const feedHtml = groups.length
        ? groups.map(g => `${g.date || groups.length > 1 ? `<div class="dooms-map-feed-date">${g.date ? escapeHtml(g.date) : 'No date'}</div>` : ''}<ul class="dooms-map-changes">${g.items.map(c => `<li class="is-${c.kind}">${escapeHtml(c.text)}</li>`).join('')}</ul>`).join('')
        : '<p class="dooms-world-muted">Nothing has moved yet. The world advances every few replies, and what changes lands here.</p>';
    return `<section class="dooms-map-news"><div class="dooms-inv-head"><span class="dooms-inv-label">🕯 Lately</span><label class="dooms-map-feed-label">Show <select class="dooms-map-feed" aria-label="How far back the changes reach">${options}</select></label></div>${feedHtml}</section>`;
}

/**
 * Rumours: the blurb, each clock's public effect as a sentence (the
 * clock's name only as a title, and not that when spoiler-free), the last
 * failed attempt when there was one.
 */
export function rumoursHtml({ state, pack, cfg } = {}) {
    const effects = publicEffects(state, pack);
    const street = effects.length
        ? `<ul class="dooms-world-effects">${effects.map(e => `<li${cfg.spoilerFree ? '' : ` title="${escapeHtml(e.label)}"`}>${escapeHtml(e.text)}</li>`).join('')}</ul>`
        : '<p class="dooms-world-muted">Nothing yet.</p>';
    return `<section class="dooms-world-street">
        <div class="dooms-inv-head"><span class="dooms-inv-label">💬 Word on the street</span></div>
        ${state.blurb ? `<p class="dooms-world-blurb">“${escapeHtml(state.blurb)}”</p>` : ''}
        ${street}
        ${state.lastError ? `<p class="dooms-world-error">${errorLine(state.lastError, cfg)}</p>` : ''}
    </section>`;
}

/** Completed quests: the chat's list, newest first, with the tracker's date. */
export function doneHtml({ done = [] } = {}) {
    const items = (Array.isArray(done) ? done : []).map(q => `<li><span class="dooms-map-done-text">${escapeHtml(q.text)}</span>${q.gameDate ? `<span class="dooms-world-muted">${escapeHtml(q.gameDate)}</span>` : ''}</li>`).join('');
    return `<section class="dooms-map-done">
        <div class="dooms-inv-head"><span class="dooms-inv-label">✅ Completed quests</span><span class="dooms-inv-fill" title="Completed">${(done || []).length}</span></div>
        ${items ? `<ol class="dooms-map-done-list">${items}</ol>` : '<p class="dooms-world-muted">None yet. Complete a quest on the shelf\'s Quests page (the ✓ on its box) and it lands here.</p>'}
    </section>`;
}

/**
 * The row of circles: the places newest on the left, each the picture of
 * the place (or a glyph), the name under it, "You are here" on the current
 * place, the selected one ringed, the one being drawn marked.
 */
export function placesRowHtml({ row = [], selected = '', drawing = '' } = {}) {
    if (!row.length) return '<div class="dooms-map-row-wrap is-empty"><p class="dooms-map-empty">No places yet: as the story moves, the tracker\'s Location line fills this row, the most recent place first.</p></div>';
    const circles = row.map(p => {
        const classes = ['dooms-map-place'];
        if (p.here) classes.push('is-here');
        if (p.id === selected) classes.push('is-selected');
        if (p.image) classes.push('has-image');
        if (p.id === drawing) classes.push('is-drawing');
        const art = p.image ? ` style="background-image:url(&quot;${escapeHtml(p.image)}&quot;)"` : '';
        const title = `${p.label}${p.parent ? `, ${p.parent}` : ''}${p.here ? ' (you are here)' : ''}`;
        return `<button type="button" class="${classes.join(' ')}" role="option" aria-selected="${p.id === selected ? 'true' : 'false'}" data-place="${escapeHtml(p.id)}" title="${escapeHtml(title)}">
            <span class="dooms-map-art"${art}><i class="fa-solid fa-mountain-sun" aria-hidden="true"></i>${p.id === drawing ? '<i class="fa-solid fa-spinner fa-spin dooms-map-spin" aria-hidden="true"></i>' : ''}${p.here ? '<span class="dooms-map-here">You are here</span>' : ''}</span>
            <span class="dooms-map-name">${escapeHtml(p.label)}</span>
        </button>`;
    }).join('');
    return `<div class="dooms-map-row-wrap">
        <button type="button" class="dooms-map-arrow is-left" data-dir="-1" aria-label="More recent places" title="More recent"><i class="fa-solid fa-chevron-left" aria-hidden="true"></i></button>
        <div class="dooms-map-row" role="listbox" aria-label="Places visited, the most recent first">${circles}</div>
        <button type="button" class="dooms-map-arrow is-right" data-dir="1" aria-label="Earlier places" title="Earlier"><i class="fa-solid fa-chevron-right" aria-hidden="true"></i></button>
    </div>`;
}

/**
 * The strip under the row: the selected place's name and parent, when it
 * was last visited, Travel here with "arriving when…" (or You are here),
 * Draw or Redraw. A hint when nothing is selected.
 */
export function placeStripHtml({ place = null, drawing = '', travelling = false, canDraw = true, drawProblem = '' } = {}) {
    if (!place) return '<div class="dooms-map-strip is-idle"><span class="dooms-world-muted">Click a place: Travel here takes the story there with a montage of the road; Draw gives it a picture.</span></div>';
    const when = place.lastDate ? `last there ${escapeHtml(place.lastDate)}${place.lastTime ? `, ${escapeHtml(place.lastTime)}` : ''}` : '';
    const isDrawing = drawing === place.id;
    const travel = place.here
        ? '<span class="dooms-map-strip-here"><i class="fa-solid fa-location-dot" aria-hidden="true"></i> You are here</span>'
        : `<button type="button" class="rpg-accordion-action-btn dooms-map-travel" data-act="travel"${travelling ? ' disabled' : ''} title="The next reply is the journey: a short montage of the road, then the arrival, the first move yours"><i class="fa-solid fa-person-walking" aria-hidden="true"></i> Travel here</button>
           <input type="text" class="rpg-accordion-input dooms-map-when" id="dooms-map-when" placeholder="arriving when… (optional)" maxlength="80" title="When you arrive, as you would say it: by nightfall, in three days…" />`;
    const drawBtn = `<button type="button" class="rpg-accordion-action-btn dooms-map-draw" data-act="draw"${isDrawing || !!drawing || !canDraw ? ' disabled' : ''} title="${drawProblem ? escapeHtml(`Cannot draw: ${drawProblem}`) : (place.drawn ? 'Draw it again: the AI describes the place afresh from the scenes there and the picture is replaced' : 'The AI describes the place from the scenes there and your image source draws it (Settings → Image Generation → Places)')}"><i class="fa-solid ${isDrawing ? 'fa-spinner fa-spin' : 'fa-paintbrush'}" aria-hidden="true"></i> ${isDrawing ? 'Drawing…' : (place.drawn ? 'Redraw' : 'Draw')}</button>`;
    return `<div class="dooms-map-strip" data-place="${escapeHtml(place.id)}">
        <span class="dooms-map-strip-name"><strong>${escapeHtml(place.label)}</strong>${place.parent ? `<span class="dooms-world-muted">, ${escapeHtml(place.parent)}</span>` : ''}${when ? `<span class="dooms-world-muted"> · ${when}</span>` : ''}</span>
        <span class="dooms-map-strip-actions">${travel}${drawBtn}</span>
    </div>`;
}

/**
 * The Map window's body: the world's name with the tracker's date and the
 * run status; the row; the strip; the panel with its buttons.
 */
export function mapWindowHtml({ state, pack, cfg, facts = {}, portraits = () => '', masterOn = true, packError = '', row = [], selected = '', drawing = '', panel = MAP_PANELS[0].id, feed = FEED_LIMITS[0], present = [], done = [], travelling = false, canDraw = true, drawProblem = '' } = {}) {
    const empty = worldEmptyMessage({ state, pack, cfg, packError, masterOn });
    if (empty) return `<div class="dooms-map">${empty}</div>`;
    const date = [facts.date, facts.time].filter(Boolean).join(', ');
    const where = facts.location ? ` · at ${escapeHtml(facts.location)}` : '';
    const active = MAP_PANELS.some(p => p.id === panel) ? panel : MAP_PANELS[0].id;
    const place = row.find(p => p.id === selected) || null;
    let body = '';
    if (active === 'people') body = peopleHtml({ state, pack, portraits, present, sceneText: facts.location || '' });
    else if (active === 'rumours') body = rumoursHtml({ state, pack, cfg });
    else if (active === 'done') body = doneHtml({ done });
    else body = newsHtml({ state, pack, cfg, feed });
    const nav = MAP_PANELS.map(p => `<button type="button" class="dooms-map-nav-btn${p.id === active ? ' is-active' : ''}" data-panel="${p.id}" role="tab" aria-selected="${p.id === active ? 'true' : 'false'}" title="${escapeHtml(p.title)}"><i class="fa-solid ${p.icon}" aria-hidden="true"></i><span>${escapeHtml(p.label)}</span></button>`).join('');
    return `<div class="dooms-map" data-panel="${active}">
        <div class="dooms-map-head">
            <span class="dooms-map-title"><i class="fa-solid fa-globe" aria-hidden="true"></i> ${escapeHtml(pack.name || 'The world')}</span>
            <span class="dooms-world-date">${date ? escapeHtml(date) : 'No date in the tracker yet'}${where}</span>
            <span class="dooms-world-status">${statusText(state, cfg)}${cfg.spoilerFree ? ' Spoiler-free.' : ''}</span>
        </div>
        ${placesRowHtml({ row, selected, drawing })}
        ${placeStripHtml({ place, drawing, travelling, canDraw, drawProblem })}
        <div class="dooms-map-panel">
            <div class="dooms-map-panel-body" role="tabpanel" data-panel="${active}">${body}</div>
            <div class="dooms-map-panel-nav" role="tablist" aria-label="The panel">${nav}</div>
        </div>
    </div>`;
}

/**
 * A face's trail, for the popover: the name and where they stand now, their
 * moves newest first with the date and the reason, and where the story
 * found them (or "Earlier at" when the log has dropped their older moves).
 */
export function faceTrailHtml({ state, pack, name, portraits = () => '' } = {}) {
    const t = characterTimeline(state, pack, name);
    const n = escapeHtml(name);
    const head = `<div class="dooms-face-head">${tokenHtml(name, portraits(name))}<div class="dooms-face-who"><div class="dooms-face-name">${n}</div><div class="dooms-world-muted">${t.now ? `Now at ${escapeHtml(t.now)}` : 'Nowhere yet'}</div></div></div>`;
    const when = (s) => [s.gameDate ? `${s.gameDate}${s.gameTime ? `, ${s.gameTime}` : ''}` : '', s.reason].filter(Boolean).map(escapeHtml).join(' · ');
    const items = t.steps.slice().reverse().map((s, i) => `<li class="${i === 0 ? 'is-now' : ''}"><span class="dooms-face-place">${escapeHtml(s.to)}</span>${when(s) ? `<span class="dooms-world-muted">${when(s)}</span>` : ''}</li>`);
    if (t.steps.length && t.steps[0].from) {
        items.push(`<li class="is-start"><span class="dooms-face-place">${escapeHtml(t.steps[0].from)}</span><span class="dooms-world-muted">${t.startIsSeed ? 'Where the story found them' : 'Earlier at; older moves are no longer kept'}</span></li>`);
    }
    if (!items.length) items.push(`<li class="is-now"><span class="dooms-face-place">${t.now ? escapeHtml(t.now) : 'Nowhere yet'}</span>${t.now ? '<span class="dooms-world-muted">From the start, or before the log</span>' : ''}</li>`);
    const count = t.steps.length;
    return `${head}<ol class="dooms-face-trail">${items.join('')}</ol><div class="dooms-face-foot"><span class="dooms-world-muted">${count} move${count === 1 ? '' : 's'} on record</span></div>`;
}
