/**
 * Live World's views (docs/stats-plan.md D69): the Live World window (the
 * glance: word on the street and the faces last seen; then the board, the
 * places as tiles) and a face's trail (the popover), as HTML. Pure apart
 * from `portraits`, so tests render them without the portrait store; the
 * modules that mount them (worldDashboard.js, worldFace.js) own the
 * events. Never a clock's number: the effect text is all anyone sees.
 */
import { escapeHtml } from '../../utils/html.js';
import { publicEffects, groupChangesByDate, characterTimeline } from '../../utils/liveWorld.js';
import { buildBoard, facesOfTheWorld } from '../../utils/worldBoard.js';

export const FEED_LIMITS = Object.freeze([12, 50, 0]);    // 0: everything the log holds
const GLYPHS = ['fa-city', 'fa-landmark', 'fa-house', 'fa-door-open'];    // a tile's glyph by how deep the board is

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

/** The line every view shows when there is nothing to draw, or '' when there is a world. */
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
 * The glance: "Word on the street" (the blurb, each clock's public effect
 * as a sentence; the clock's name only as a title, and not that when
 * spoiler-free) and "Last seen" (the known characters as the shelf's own
 * portrait cards with the place under the name and the date of their last
 * move, the heard-of names in one box). The top of the window.
 */
export function worldGlanceHtml({ state, pack, cfg, portraits = () => '' } = {}) {
    const effects = publicEffects(state, pack);
    const faces = facesOfTheWorld(pack, state);
    const cards = faces.known.map(f => {
        const url = portraits(f.name);
        const n = escapeHtml(f.name);
        const face = url
            ? `<img src="${escapeHtml(url)}" alt="" />`
            : `<div class="dooms-portrait-card-emoji" aria-hidden="true">${escapeHtml(initials(f.name))}</div>`;
        const when = f.gameDate ? `<span class="dooms-world-when" title="Last moved ${escapeHtml(f.gameDate)}${f.gameTime ? `, ${escapeHtml(f.gameTime)}` : ''}">${escapeHtml(f.gameDate)}</span>` : '';
        const place = f.place
            ? `<span class="dooms-world-place" title="${escapeHtml(f.place)}">📍 ${escapeHtml(f.place)}</span>`
            : '<span class="dooms-world-place">nowhere yet</span>';
        return `<button type="button" class="dooms-portrait-card dooms-world-card" data-name="${n}" title="${n}: where they have been">${face}${when}<div class="dooms-portrait-card-name">${n}${place}</div></button>`;
    }).join('');
    const heard = faces.heard.length
        ? `<div class="dooms-world-heard"><span class="dooms-inv-label">Heard of</span><span>${faces.heard.map(escapeHtml).join('<br>')}</span><span class="dooms-world-muted">Not met yet</span></div>`
        : '';
    const street = effects.length
        ? `<ul class="dooms-world-effects">${effects.map(e => `<li${cfg.spoilerFree ? '' : ` title="${escapeHtml(e.label)}"`}>${escapeHtml(e.text)}</li>`).join('')}</ul>`
        : '<p class="dooms-world-muted">Nothing yet.</p>';
    return `<div class="dooms-world-glance">
        <section class="dooms-world-street">
            <div class="dooms-inv-head"><span class="dooms-inv-label">💬 Word on the street</span></div>
            ${state.blurb ? `<p class="dooms-world-blurb">“${escapeHtml(state.blurb)}”</p>` : ''}
            ${street}
            ${state.lastError ? `<p class="dooms-world-error">${errorLine(state.lastError, cfg)}</p>` : ''}
        </section>
        <section class="dooms-world-seen">
            <div class="dooms-inv-head"><span class="dooms-inv-label">👁 Last seen</span><span class="dooms-inv-fill" title="Known characters">${faces.known.length}</span></div>
            <div class="dooms-world-cards">${cards || '<p class="dooms-world-muted">No one known yet.</p>'}${heard}</div>
        </section>
    </div>`;
}

/**
 * The Live World window's body: a line with the pack, the tracker's date,
 * when the world moved and when it runs next; the glance; the board.
 */
export function worldWindowHtml({ state, pack, cfg, facts = {}, portraits = () => '', masterOn = true, packError = '', root = '', feed = FEED_LIMITS[0] } = {}) {
    const empty = worldEmptyMessage({ state, pack, cfg, packError, masterOn });
    if (empty) return `<div class="dooms-world-window">${empty}</div>`;
    const date = [facts.date, facts.time].filter(Boolean).join(', ');
    const where = facts.location ? ` · at ${escapeHtml(facts.location)}` : '';
    return `<div class="dooms-world-window">
        <div class="dooms-world-sub">
            <span class="dooms-inv-label">🌍 ${escapeHtml(pack.name)}</span>
            <span class="dooms-world-date">${date ? escapeHtml(date) : 'No date in the tracker yet'}${where}</span>
            <span class="dooms-world-status">${statusText(state, cfg)}${cfg.spoilerFree ? ' Spoiler-free.' : ''}</span>
        </div>
        ${worldGlanceHtml({ state, pack, cfg, portraits })}
        ${boardHtml({ state, pack, cfg, root, portraits, masterOn, packError, feed })}
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

/**
 * The board at one level: the trail from the pack down to the place stepped
 * into, what a clock says about that place itself, the tiles (a glyph or the
 * pack's art, how many places inside, the name, the caption a clock gives
 * it, the people on it as tokens), whoever stands at the place itself,
 * the names elsewhere or not yet placed, and "Lately" with its filter.
 */
export function boardHtml({ state, pack, cfg, root = '', portraits = () => '', masterOn = true, packError = '', feed = FEED_LIMITS[0] } = {}) {
    const empty = worldEmptyMessage({ state, pack, cfg, packError, masterOn });
    if (empty) return `<div class="dooms-board">${empty}</div>`;
    const limit = FEED_LIMITS.includes(Number(feed)) ? Number(feed) : FEED_LIMITS[0];
    const b = buildBoard(pack, state, { root, spoilerFree: !!cfg.spoilerFree, lately: limit || Number.MAX_SAFE_INTEGER });
    const depth = b.crumbs.length;
    const crumbs = b.crumbs.map((c, i) => `<span class="dooms-board-sep" aria-hidden="true">›</span><button type="button" class="dooms-board-crumb${i === depth - 1 ? ' is-here' : ''}" data-root="${escapeHtml(c.id)}"${i === depth - 1 ? ' aria-current="location"' : ''}>${escapeHtml(c.label)}</button>`).join('');
    const trail = `<nav class="dooms-board-trail" aria-label="Where you are looking"><button type="button" class="dooms-board-crumb${depth ? '' : ' is-here'}" data-root=""${depth ? '' : ' aria-current="location"'}>${escapeHtml(pack.name || 'The world')}</button>${crumbs}</nav>`;
    const note = b.atRoot.length ? `<p class="dooms-board-note">${b.atRoot.map(c => `<span${cfg.spoilerFree ? '' : ` title="${escapeHtml(c.label)}"`}>${escapeHtml(c.text)}</span>`).join(' · ')}</p>` : '';
    const glyph = GLYPHS[Math.min(depth, GLYPHS.length - 1)];
    const tiles = b.tiles.map(t => {
        const art = t.image ? ` style="background-image:url(&quot;${escapeHtml(t.image)}&quot;)"` : '';
        const inside = t.inside ? `<span class="dooms-board-inside">${t.inside} inside</span>` : '';
        const caption = t.caption ? `<span class="dooms-board-caption" title="${escapeHtml(t.captions.map(c => c.text).join(' · '))}">${escapeHtml(t.caption)}</span>` : '';
        const people = t.people.length ? `<div class="dooms-board-people">${t.people.map(p => tokenHtml(p.name, portraits(p.name), { button: true })).join('')}</div>` : '';
        return `<div class="dooms-board-tile${t.image ? ' has-image' : ''}${t.caption ? ' has-caption' : ''}" data-place="${escapeHtml(t.id)}">
            <button type="button" class="dooms-board-step" data-root="${escapeHtml(t.id)}" title="${t.inside ? `Step inside ${escapeHtml(t.label)}` : escapeHtml(t.label)}">
                <span class="dooms-board-art"${art}><i class="fa-solid ${glyph}" aria-hidden="true"></i>${inside}</span>
                <span class="dooms-board-text"><span class="dooms-board-name">${escapeHtml(t.label)}</span>${caption}</span>
            </button>${people}</div>`;
    }).join('');
    const grid = b.tiles.length ? `<div class="dooms-board-grid">${tiles}</div>` : `<p class="dooms-board-leaf">Nothing lies inside ${escapeHtml(b.title)}.</p>`;
    const here = b.here.length
        ? `<p class="dooms-board-here"><span class="dooms-inv-label">Here:</span> ${b.here.map(n => `${tokenHtml(n, portraits(n), { button: true })}<span class="dooms-board-here-name">${escapeHtml(n)}</span>`).join(' ')}</p>`
        : '';
    const asides = [];
    if (b.elsewhere.length) asides.push(`Elsewhere: ${b.elsewhere.map(escapeHtml).join(', ')}`);
    if (b.nowhere.length) asides.push(`Not yet placed: ${b.nowhere.map(escapeHtml).join(', ')}`);
    const aside = asides.length ? `<p class="dooms-board-aside">${asides.join(' · ')}</p>` : '';
    const groups = groupChangesByDate(b.lately);
    const options = FEED_LIMITS.map(n => `<option value="${n}"${n === limit ? ' selected' : ''}>${n ? `Latest ${n}` : 'Everything'}</option>`).join('');
    const feedHtml = groups.length
        ? groups.map(g => `${g.date || groups.length > 1 ? `<div class="dooms-board-feed-date">${g.date ? escapeHtml(g.date) : 'No date'}</div>` : ''}<ul class="dooms-board-changes">${g.items.map(c => `<li class="is-${c.kind}">${escapeHtml(c.text)}</li>`).join('')}</ul>`).join('')
        : '<p class="dooms-world-muted">No changes yet.</p>';
    const lately = `<section class="dooms-board-lately"><div class="dooms-inv-head"><span class="dooms-inv-label">🕯 Lately</span><label class="dooms-board-feed-label">Show <select class="dooms-board-feed" aria-label="How far back the changes reach">${options}</select></label></div>${feedHtml}</section>`;
    return `<div class="dooms-board">${trail}${note}${grid}${here}${aside}${lately}</div>`;
}
