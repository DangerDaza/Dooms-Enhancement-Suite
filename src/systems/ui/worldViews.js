/**
 * Live World's shared views (docs/map-window-plan.md D85, D88): the People,
 * News, Rumours, Hooks and Completed quests bodies, the word for a chat
 * with nothing to show, the status line, and a face's trail (the popover),
 * as HTML. They were the Map window's panels; that window went
 * (docs/long-shot-plan.md D195) and they are the Atlas's tabs now. Pure
 * apart from `portraits`, so tests render them without the portrait
 * store; the modules that mount them (atlas.js, worldFace.js) own the
 * events. Never a clock's number: the effect text is all anyone sees.
 */
import { escapeHtml } from '../../utils/html.js';
import { publicEffects, recentChanges, groupChangesByDate, characterTimeline } from '../../utils/liveWorld.js';
import { facesOfTheWorld } from '../../utils/worldBoard.js';

export const FEED_LIMITS = Object.freeze([12, 50, 0]);    // 0: everything the log holds

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
        ? `<ul class="dooms-world-effects">${effects.map((e, i) => `<li data-i="${i}"${cfg.spoilerFree ? '' : ` title="${escapeHtml(e.label)}"`}>${escapeHtml(e.text)}</li>`).join('')}</ul>`
        : '<p class="dooms-world-muted">Nothing yet.</p>';
    return `<section class="dooms-world-street">
        <div class="dooms-inv-head"><span class="dooms-inv-label">💬 Word on the street</span></div>
        ${state.blurb ? `<p class="dooms-world-blurb">“${escapeHtml(state.blurb)}”</p>` : ''}
        ${street}
        ${state.lastError ? `<p class="dooms-world-error">${errorLine(state.lastError, cfg)}</p>` : ''}
    </section>`;
}

/**
 * Hooks (docs/hooks-canon-plan.md D104): the round on offer as cards, each
 * with Take, Take and cut to it and Not this one; the button that asks for
 * a round (or another); the last failure; the hooks taken, folded.
 */
export function hooksHtml({ hooks = null, busy = false } = {}) {
    const h = hooks && typeof hooks === 'object' ? hooks : { proposed: [], taken: [], aside: [], last: null };
    const proposed = Array.isArray(h.proposed) ? h.proposed : [];
    const takenAll = Array.isArray(h.taken) ? h.taken : [];
    const cards = proposed.map(x => `<article class="dooms-map-hook" data-hook="${escapeHtml(x.id)}">
        <div class="dooms-map-hook-title">${escapeHtml(x.title)}</div>
        <p class="dooms-map-hook-text">${escapeHtml(x.text)}</p>
        ${x.grounds ? `<div class="dooms-world-muted dooms-map-hook-from">From: ${escapeHtml(x.grounds)}</div>` : ''}
        <div class="dooms-map-hook-actions">
            <button type="button" class="rpg-accordion-action-btn" data-act="hook-take" data-hook="${escapeHtml(x.id)}" title="A quest on the shelf's Quests page"><i class="fa-solid fa-scroll" aria-hidden="true"></i> Take</button>
            <button type="button" class="rpg-accordion-action-btn" data-act="hook-cut" data-hook="${escapeHtml(x.id)}" title="A quest, and the next reply cuts to it with a short montage"><i class="fa-solid fa-scissors" aria-hidden="true"></i> Take and cut to it</button>
            <button type="button" class="rpg-accordion-action-btn" data-act="hook-aside" data-hook="${escapeHtml(x.id)}" title="Set aside: not offered again"><i class="fa-solid fa-xmark" aria-hidden="true"></i> Not this one</button>
        </div>
    </article>`).join('');
    const taken = takenAll.slice().reverse().slice(0, 10);
    const failed = h.last && !h.last.ok && h.last.error ? `<p class="dooms-world-error">The last round failed: ${escapeHtml(h.last.error)}</p>` : '';
    return `<section class="dooms-map-hooks">
        <div class="dooms-inv-head"><span class="dooms-inv-label">🪝 Hooks</span><span class="dooms-inv-fill" title="Hooks taken in this chat">${takenAll.length}</span></div>
        <p class="dooms-world-muted dooms-map-hook-hint">What the world offers to do next, from its clocks, its rumours and who was last seen where. Take one and it is a quest on the shelf; Take and cut to it starts it with a short montage; Not this one sets it aside for good.</p>
        <div class="dooms-map-hook-list">${cards || `<p class="dooms-world-muted">${busy ? 'Asking the world…' : 'No hooks on offer yet.'}</p>`}</div>
        <div class="dooms-map-hook-foot">
            <button type="button" class="rpg-accordion-action-btn" data-act="hooks-propose"${busy ? ' disabled' : ''}><i class="fa-solid ${busy ? 'fa-spinner fa-spin' : 'fa-signs-post'}" aria-hidden="true"></i> ${busy ? 'Asking…' : (cards ? 'Offer others' : 'Offer hooks')}</button>
            ${failed}
        </div>
        ${taken.length ? `<details class="dooms-map-hook-taken"><summary>Taken${takenAll.length > taken.length ? `, the last ${taken.length}` : ''}</summary><ul class="dooms-map-done-list">${taken.map(t => `<li><span class="dooms-map-done-text">${escapeHtml(t.title)}</span>${t.gameDate ? `<span class="dooms-world-muted">${escapeHtml(t.gameDate)}</span>` : ''}</li>`).join('')}</ul></details>` : ''}
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
