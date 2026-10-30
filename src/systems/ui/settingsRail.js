/**
 * Settings window — rail layout.
 *
 * The Settings window's markup is one stacked strip of accordion sections
 * (template.html). The rail layout keeps that markup and presents it as a
 * settings screen: a labelled list of the sections down the left, one
 * section shown at a time as a page, the page named by a title row, and
 * the page's rows grouped under their headings as label-and-panel rows
 * (styles/modals.css, "SETTINGS WINDOW — RAIL LAYOUT").
 *
 * A group is a heading (`.rpg-subsection-label` or a folding
 * `details.rpg-subsection-collapse`) plus whatever follows it up to the
 * next heading. The rows before the first heading are the page's lead
 * panel, with no label. A showing wrapper that holds two or more headings
 * (the Doom Counter's options) is opened up: its headings become groups of
 * their own, built inside the wrapper so the wrapper can still be shown and
 * hidden as one. A card meant to stay folded (data-rail-closed, like
 * Advanced) is a group whose panel is the folded card.
 *
 * Grouping moves elements into wrappers and moves them back when the strip
 * layout is chosen; every element keeps its id and its listeners.
 *
 * applySettingsLayout() runs every time the window opens and when the
 * layout setting changes, so sections that other code shows or hides
 * (updateSectionVisibility, feature toggles) are picked up each time.
 */
import { extensionSettings } from '../../core/state.js';
import { escapeHtml } from '../../utils/html.js';

const RAIL_ID = 'dooms-settings-rail';
/** sections that sit at the bottom of the nav, apart from the features */
const UTILITY_SECTIONS = new Set(['tools']);
let lastTab = null; // remembered for the session only

/** @returns {boolean} true when the rail layout is selected (the default) */
export function isRailLayout() {
    return (extensionSettings.settingsLayout || 'rail') === 'rail';
}

/**
 * The sections the rail can show: direct children of the body that nothing
 * has hidden. Hidden-by-code sections carry an inline display:none.
 * @param {HTMLElement} popup
 * @returns {HTMLElement[]}
 */
function visibleSections(popup) {
    return Array.from(popup.querySelectorAll('.rpg-settings-popup-body > .rpg-accordion-section[data-accordion]'))
        .filter(s => s.style.display !== 'none' && !s.hidden);
}

/**
 * Gives one popup the layout class only: the Workshop and the Roster call
 * this when they open, so opening them never rebuilds the Settings window
 * behind them (which would scroll it to the top and reopen folded cards).
 * @param {string} id popup element id
 */
export function applyPopupLayout(id) {
    document.getElementById(id)?.classList.toggle('dooms-rail', isRailLayout());
}

/**
 * Applies the strip or rail layout to #rpg-settings-popup.
 */
export function applySettingsLayout() {
    const rail = isRailLayout();
    // The Workshop and the Roster follow the same layout choice; their rails
    // are their own tab and mode buttons, restyled by CSS, so a class is all
    // they need.
    for (const id of ['character-workshop-popup', 'character-roster-popup']) {
        document.getElementById(id)?.classList.toggle('dooms-rail', rail);
    }
    const popup = document.getElementById('rpg-settings-popup');
    if (!popup) return;
    popup.classList.toggle('dooms-rail', rail);
    if (!rail) {
        document.getElementById(RAIL_ID)?.remove();
        popup.querySelector('.dooms-rail-toggle')?.remove();
        popup.querySelector('.dooms-rail-here')?.remove();
        popup.classList.remove('dooms-nav-open');
        popup.querySelectorAll('.dooms-rail-current').forEach(s => s.classList.remove('dooms-rail-current'));
        popup.querySelectorAll('.rpg-accordion-section').forEach(clearPage);
        return;
    }
    buildRail(popup);
}

/**
 * (Re)builds the nav from the visible sections and shows one.
 * @param {HTMLElement} popup
 */
function buildRail(popup) {
    const content = popup.querySelector('.rpg-settings-popup-content');
    const body = popup.querySelector('.rpg-settings-popup-body');
    if (!content || !body) return;
    let rail = document.getElementById(RAIL_ID);
    if (!rail) {
        rail = document.createElement('nav');
        rail.id = RAIL_ID;
        rail.className = 'dooms-rail';
        rail.setAttribute('aria-label', 'Settings sections');
        content.insertBefore(rail, body);
    }
    const sections = visibleSections(popup);
    const item = (section) => {
        const id = section.dataset.accordion;
        const iconEl = section.querySelector('.rpg-accordion-icon');
        const icon = iconEl ? iconEl.className.replace('rpg-accordion-icon', '').trim() : 'fa-solid fa-circle';
        const title = section.querySelector('.rpg-accordion-title')?.textContent.trim() || id;
        const util = UTILITY_SECTIONS.has(id) ? ' dooms-rail-util' : '';
        return `<button type="button" class="dooms-rail-btn${util}" data-target="${escapeHtml(id)}" title="${escapeHtml(title)}">
            <i class="${escapeHtml(icon)}" aria-hidden="true"></i><span>${escapeHtml(title)}</span>
        </button>`;
    };
    rail.innerHTML = sections.map(item).join('');
    rail.querySelectorAll('.dooms-rail-btn').forEach(btn => {
        btn.addEventListener('click', () => selectSection(popup, btn.dataset.target));
    });
    ensureNavToggle(popup);
    // A toggle on the page can reveal or hide a wrapper full of headings
    // (enabling the Doom Counter, say), so the groups follow changes.
    if (!body.dataset.doomsGroupWatch) {
        body.dataset.doomsGroupWatch = '1';
        body.addEventListener('change', () => {
            requestAnimationFrame(() => {
                const current = popup.querySelector('.rpg-settings-popup-body > .rpg-accordion-section.dooms-rail-current');
                if (current && popup.classList.contains('dooms-rail')) buildGroups(current, { fromChange: true });
            });
        });
    }
    // Coming from the strip, the section the user has open is their place;
    // otherwise the one they were on last time in the rail, else the first.
    const wanted = sections.find(s => s.classList.contains('rpg-accordion-open'))
        || sections.find(s => s.dataset.accordion === lastTab)
        || sections[0];
    if (wanted) selectSection(popup, wanted.dataset.accordion);
}

/**
 * On a phone the nav folds behind a button in the window's header that
 * names the page; the button opens the nav as a sheet over the page.
 * @param {HTMLElement} popup
 */
function ensureNavToggle(popup) {
    const actions = popup.querySelector('.rpg-settings-popup-header .rpg-header-actions');
    if (!actions || popup.querySelector('.dooms-rail-toggle')) return;
    const here = document.createElement('span');
    here.className = 'dooms-rail-here';
    here.setAttribute('aria-live', 'polite');
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'dooms-rail-toggle';
    toggle.setAttribute('aria-controls', RAIL_ID);
    toggle.setAttribute('aria-expanded', 'false');
    toggle.textContent = 'Sections';
    toggle.addEventListener('click', () => {
        const open = !popup.classList.contains('dooms-nav-open');
        popup.classList.toggle('dooms-nav-open', open);
        toggle.setAttribute('aria-expanded', String(open));
    });
    actions.prepend(here, toggle);
}

/**
 * Shows one section as the page and marks its nav item.
 * @param {HTMLElement} popup
 * @param {string} id - the section's data-accordion value
 */
export function selectSection(popup, id) {
    popup.querySelectorAll('.rpg-settings-popup-body > .rpg-accordion-section').forEach(section => {
        const on = section.dataset.accordion === id;
        section.classList.toggle('dooms-rail-current', on);
        section.classList.toggle('rpg-accordion-open', on);
        if (on) {
            // A page has room for its groups: show them open. A card marked
            // data-rail-closed (Advanced) stays folded until asked.
            section.querySelectorAll('details.rpg-subsection-collapse').forEach(d => {
                if (!d.dataset.railClosed) d.open = true;
            });
            buildPage(section);
        } else {
            clearPage(section);
        }
    });
    const title = popup.querySelector(`.rpg-accordion-section[data-accordion="${id}"] .rpg-accordion-title`)?.textContent.trim() || '';
    popup.querySelectorAll('.dooms-rail-btn').forEach(btn => {
        const active = btn.dataset.target === id;
        btn.classList.toggle('is-active', active);
        if (active) btn.setAttribute('aria-current', 'page'); else btn.removeAttribute('aria-current');
    });
    const here = popup.querySelector('.dooms-rail-here');
    if (here) here.textContent = title;
    popup.classList.remove('dooms-nav-open');
    popup.querySelector('.dooms-rail-toggle')?.setAttribute('aria-expanded', 'false');
    popup.querySelector('.rpg-settings-popup-body')?.scrollTo({ top: 0 });
    lastTab = id;
}

/* ── The page: a title row and the groups ─────────────────────────────── */

/**
 * Gives a section its title row (the section's name as the page's heading,
 * its state badge beside it) and groups its rows.
 * @param {HTMLElement} section
 */
function buildPage(section) {
    const header = section.querySelector(':scope > .rpg-accordion-header');
    if (!header) return;
    if (!section.querySelector(':scope > .dooms-page-head')) {
        const head = document.createElement('div');
        head.className = 'dooms-page-head';
        const h1 = document.createElement('h1');
        h1.className = 'dooms-page-title';
        h1.textContent = header.querySelector('.rpg-accordion-title')?.textContent.trim() || section.dataset.accordion;
        head.append(h1);
        // The badge keeps its element (code updates it by id), so it moves.
        header.querySelectorAll(':scope > .rpg-accordion-badge').forEach(b => head.append(b));
        header.after(head);
    }
    buildGroups(section);
}

/**
 * Removes a section's title row (the badge goes home) and its groups.
 * @param {HTMLElement} section
 */
function clearPage(section) {
    const head = section.querySelector(':scope > .dooms-page-head');
    if (head) {
        const header = section.querySelector(':scope > .rpg-accordion-header');
        const chevron = header?.querySelector(':scope > .rpg-accordion-chevron') || null;
        head.querySelectorAll('.rpg-accordion-badge').forEach(b => header?.insertBefore(b, chevron));
        head.remove();
    }
    const body = section.querySelector(':scope > .rpg-accordion-body');
    if (body) ungroup(body);
}

const HEAD_SELECTOR = '.rpg-subsection-label, details.rpg-subsection-collapse';

/**
 * @param {Element} el
 * @returns {boolean} true for a heading that starts a group
 */
function isHeading(el) {
    if (!(el instanceof HTMLElement) || el.style.display === 'none' || el.hidden) return false;
    return el.matches(HEAD_SELECTOR);
}

/**
 * The text a heading shows, without its badge or icon.
 * @param {HTMLElement} el
 * @returns {string}
 */
function headingText(el) {
    let src = el.matches('details') ? el.querySelector(':scope > summary') : el;
    if (!src) return '';
    // A card's summary wraps its name in a span; help buttons and their
    // (hidden) popups sit beside it and must not leak into the label. A
    // badge is a span too (the Stats beta's), and is never the name.
    src = src.querySelector(':scope > span:not(.rpg-accordion-badge)') || src;
    const clone = src.cloneNode(true);
    clone.querySelectorAll('.rpg-accordion-badge, .rpg-subsection-chevron, i, button, [hidden], .rpg-section-info-popup, .rpg-setting-hint')
        .forEach(n => n.remove());
    const text = clone.textContent.replace(/\s+/g, ' ').trim();
    return text.length > 40 ? text.slice(0, 39).trimEnd() + '…' : text;
}

/**
 * A container's children as the markup has them, seeing through any group
 * wrappers already built, so the grouping can be read off a grouped page.
 * @param {HTMLElement} container
 * @returns {HTMLElement[]}
 */
function logicalChildren(container) {
    const out = [];
    for (const child of Array.from(container.children)) {
        if (!(child instanceof HTMLElement)) continue;
        if (!child.classList.contains('dooms-group')) { out.push(child); continue; }
        const label = child.querySelector(':scope > .dooms-group-label');
        if (label && !label.dataset.generated && label.firstElementChild instanceof HTMLElement) out.push(label.firstElementChild);
        const panel = child.querySelector(':scope > .dooms-group-panel');
        if (panel) for (const el of Array.from(panel.children)) if (el instanceof HTMLElement) out.push(el);
    }
    return out;
}

/**
 * Splits a container into groups, one per heading, in document order. A
 * showing wrapper with two or more headings is walked into, so its groups
 * are built inside it.
 * @param {HTMLElement} container
 * @returns {{ label: string, head: HTMLElement|null, els: HTMLElement[], parent: HTMLElement }[]}
 */
function groupsIn(container) {
    const groups = [];
    let current = null;
    const open = (head) => {
        current = { label: head ? (headingText(head) || 'Section') : '', head, els: head ? [head] : [], parent: container };
        groups.push(current);
    };
    for (const child of logicalChildren(container)) {
        if (isHeading(child)) { open(child); continue; }
        const inner = child.matches('details, .rpg-setting-row') ? [] : logicalChildren(child).filter(isHeading);
        if (inner.length >= 2 && child.style.display !== 'none' && !child.hidden) {
            groups.push(...groupsIn(child));
            current = null; // what follows the wrapper starts afresh
            continue;
        }
        if (!current) open(null);
        current.els.push(child);
    }
    return groups.filter(g => g.els.length > 0);
}

/**
 * Wraps each group of a page as a label beside a panel of its rows. On a
 * change event the page is only regrouped when the set of groups moved (a
 * wrapper of headings appeared or went); otherwise nothing moves under the
 * control the user just touched.
 * @param {HTMLElement} section
 */
function buildGroups(section, { fromChange = false } = {}) {
    const body = section.querySelector(':scope > .rpg-accordion-body');
    if (!body) return;
    const sig = groupsIn(body).map(g => g.label).join('\u0001');
    if (fromChange && body.dataset.doomsGrouped && body.dataset.doomsSignature === sig) return;
    ungroup(body);
    for (const g of groupsIn(body)) {
        const wrap = document.createElement('div');
        wrap.className = 'dooms-group';
        const first = g.els[0];
        first.parentNode.insertBefore(wrap, first);
        if (g.head) {
            const label = document.createElement('div');
            label.className = 'dooms-group-label';
            if (g.head.matches('details')) {
                // The card stays whole in the panel (it folds); its name is
                // written into the label column.
                label.dataset.generated = '1';
                label.innerHTML = `<div class="dooms-group-title" role="button" tabindex="0">${escapeHtml(g.label)}</div>`;
                wrap.dataset.fold = g.head.open ? 'open' : 'closed';
                // The label opens and closes the card (its own summary is hidden).
                const details = g.head;
                const flip = () => { details.open = !details.open; wrap.dataset.fold = details.open ? 'open' : 'closed'; };
                label.addEventListener('click', flip);
                label.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); flip(); } });
            } else {
                label.append(g.head);
            }
            wrap.dataset.group = g.label;
            wrap.append(label);
        } else {
            wrap.classList.add('dooms-group-lead');
        }
        const panel = document.createElement('div');
        panel.className = 'dooms-group-panel';
        for (const el of g.els) {
            if (el === g.head && !g.head.matches('details')) continue;
            panel.append(el);
        }
        wrap.append(panel);
    }
    body.dataset.doomsGrouped = '1';
    body.dataset.doomsSignature = sig;
}

/**
 * Moves every grouped element back where it was and drops the wrappers.
 * @param {HTMLElement} body
 */
function ungroup(body) {
    for (const wrap of Array.from(body.querySelectorAll('.dooms-group'))) {
        const parent = wrap.parentNode;
        const label = wrap.querySelector(':scope > .dooms-group-label');
        const panel = wrap.querySelector(':scope > .dooms-group-panel');
        if (label && !label.dataset.generated && label.firstElementChild) parent.insertBefore(label.firstElementChild, wrap);
        while (panel && panel.firstChild) parent.insertBefore(panel.firstChild, wrap);
        wrap.remove();
    }
    delete body.dataset.doomsGrouped;
    delete body.dataset.doomsSignature;
}
