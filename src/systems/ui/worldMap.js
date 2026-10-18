/**
 * Live World map (docs/live-world-spec.md, Part C; C1, the province node
 * view): the view. Drawn inside the dashboard popup as its Map view.
 *
 * Reads state only, never the model: place cards with their labels, soft
 * lines along the place tree, the known characters as portrait tokens on
 * the deepest place drawn (initials when there is no portrait), a count
 * on each card, and a textured canvas that needs no art. A place with an
 * image in the pack wears it as the card's backdrop. Heard-of names stay
 * off the map; known names with no place are listed under it.
 */
import { escapeHtml } from '../../utils/html.js';
import { placeLabel } from '../../utils/liveWorld.js';
import { buildProvinceView, safeImageUrl } from '../../utils/worldMap.js';

const TOKENS_SHOWN = 6;
const f = (n) => Number(n).toFixed(2);

function initials(name) {
    return String(name).split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('') || '?';
}

/** The line both views show when there is nothing to draw, or '' when there is a world. */
export function worldEmptyMessage({ state, pack, cfg, packError = '', masterOn = true } = {}) {
    if (!masterOn) return '<p class="rpg-world-empty">Doom\'s Enhancement Suite is off; Live World runs only while it is on.</p>';
    if (!cfg || !cfg.enabled) return '<p class="rpg-world-empty">Live World is off. Settings → Live World switches it on.</p>';
    if (packError) return `<p class="rpg-world-empty is-error">This chat has no world: ${escapeHtml(packError)}</p>`;
    if (!state || !pack) return '<p class="rpg-world-empty">This chat has no world yet. Open a chat with Live World on, or re-seed it in Settings → Live World.</p>';
    return '';
}

/**
 * The map as HTML. Pure apart from `portraits`, so tests can render it
 * without the portrait store.
 */
export function renderWorldMapHtml({ state, pack, cfg, packError = '', portraits = () => '', masterOn = true, depth = 1, focus = '', root = '' } = {}) {
    const empty = worldEmptyMessage({ state, pack, cfg, packError, masterOn });
    if (empty) return empty;
    const view = buildProvinceView(pack, state, { depth, root });
    if (!view.nodes.length) return '<p class="rpg-world-empty">This pack has no places to draw.</p>';
    const crumbs = `<nav class="rpg-wmap-crumbs" aria-label="Where the map is"><button type="button" class="rpg-wmap-crumb${view.root ? '' : ' is-here'}" data-root="">${escapeHtml(pack.name)}</button>${view.crumbs.map((c, i) => `<span class="rpg-wmap-crumb-sep" aria-hidden="true">›</span><button type="button" class="rpg-wmap-crumb${i === view.crumbs.length - 1 ? ' is-here' : ''}" data-root="${escapeHtml(c.id)}">${escapeHtml(c.label)}</button>`).join('')}</nav>`;
    const paths = view.lines.map(l => `<path d="M ${f(l.x1)} ${f(l.y1)} Q ${f(l.cx)} ${f(l.cy)} ${f(l.x2)} ${f(l.y2)}" vector-effect="non-scaling-stroke" />`).join('');
    const cards = view.nodes.map(n => {
        const img = safeImageUrl(n.image);
        const tokens = n.tokens.slice(0, TOKENS_SHOWN).map(t => {
            const url = portraits(t.name);
            const title = `${t.name} · ${t.exact ? 'here' : placeLabel(pack, t.place)}`;
            return url
                ? `<img class="rpg-wmap-token" src="${escapeHtml(url)}" alt="${escapeHtml(t.name)}" title="${escapeHtml(title)}" data-name="${escapeHtml(t.name)}" role="button" tabindex="0" />`
                : `<span class="rpg-wmap-token is-initials" title="${escapeHtml(title)}" aria-label="${escapeHtml(t.name)}" data-name="${escapeHtml(t.name)}" role="button" tabindex="0">${escapeHtml(initials(t.name))}</span>`;
        }).join('');
        const rest = n.tokens.slice(TOKENS_SHOWN);
        const more = rest.length ? `<span class="rpg-wmap-token is-more" title="${escapeHtml(rest.map(t => t.name).join(', '))}">+${rest.length}</span>` : '';
        const within = n.tokens.filter(t => !t.exact).length;
        const countTitle = `${n.count} known ${n.count === 1 ? 'character' : 'characters'} here${within ? `, ${within} somewhere within` : ''}`;
        const style = `left:${f(n.x)}%;top:${f(n.y)}%;${img ? `background-image:url(&quot;${escapeHtml(img)}&quot;);` : ''}`;
        const picked = focus && (n.id === focus || n.tokens.some(t => t.place === focus));
        const zoomable = n.children > 0 && n.id !== view.root;
        const title = `${placeLabel(pack, n.id, { full: true })}${zoomable ? ` · ${n.children} within, click to look inside` : ''}`;
        return `<div class="rpg-wmap-node${n.depth === 0 ? ' is-root' : ''}${img ? ' has-image' : ''}${picked ? ' is-focus' : ''}${zoomable ? ' has-children' : ''}" style="${style}" data-place="${escapeHtml(n.id)}"${zoomable ? ` data-zoom="${escapeHtml(n.id)}" role="button" tabindex="0"` : ''} title="${escapeHtml(title)}">
            <div class="rpg-wmap-label">${escapeHtml(n.label)}${zoomable ? ' <span class="rpg-wmap-more" aria-hidden="true">›</span>' : ''}</div>
            ${n.tokens.length ? `<div class="rpg-wmap-tokens">${tokens}${more}</div>` : ''}
            ${n.count ? `<span class="rpg-wmap-count" title="${escapeHtml(countTitle)}">${n.count}</span>` : ''}
        </div>`;
    }).join('');
    const notes = [];
    if (view.elsewhere.length) notes.push(`Elsewhere in ${escapeHtml(pack.name)}: ${view.elsewhere.map(escapeHtml).join(', ')}.`);
    if (view.unplaced.length) notes.push(`Somewhere, not yet placed: ${view.unplaced.map(escapeHtml).join(', ')}.`);
    if (view.offMap.length) notes.push(`Off the map (a place the pack no longer has): ${view.offMap.map(escapeHtml).join(', ')}.`);
    const here = view.crumbs.length ? view.crumbs[view.crumbs.length - 1].label : 'the province';
    return `
        ${crumbs}
        <div class="rpg-wmap" role="img" aria-label="${escapeHtml(pack.name)}: ${escapeHtml(here)}">
            <svg class="rpg-wmap-lines" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">${paths}</svg>
            ${cards}
        </div>
        <div class="rpg-wmap-legend">Known characters only; heard-of names stay off the map. A token opens the character's timeline; a place with › opens to what is inside.${notes.length ? ` ${notes.join(' ')}` : ''}</div>`;
}
