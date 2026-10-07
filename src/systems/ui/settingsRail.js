/**
 * Settings window — rail layout.
 *
 * The Settings window's markup is one stacked strip of accordion sections
 * (template.html). The rail layout keeps that markup and presents it the way
 * the Megumin Suite options menu does: an icon rail down the left, one
 * section shown at a time as a page with a hero heading, the rows grouped
 * into cards (styles/modals.css, "SETTINGS WINDOW — RAIL LAYOUT").
 *
 * A long page gets a sub-menu: its groups (each `.rpg-subsection-label`
 * heading or `details.rpg-subsection-collapse` card, plus whatever follows
 * it) become a strip of tabs under the hero heading, and one group shows
 * at a time. Rows before the first heading form a "General" tab. Headings
 * inside a wrapper the page shows and hides (the Doom Counter's options)
 * count too, as long as the wrapper is showing. A card meant to stay
 * folded at the foot of its page (data-rail-closed, like Advanced) is not
 * a group: it stays on the General tab, below everything else there. A page gets the strip with three or more groups, or two when
 * it has enough rows to be worth splitting; smaller pages stay as they are.
 *
 * applySettingsLayout() runs every time the window opens and when the
 * layout setting changes, so sections that other code shows or hides
 * (updateSectionVisibility, feature toggles) are picked up each time.
 */
import { extensionSettings } from '../../core/state.js';
import { escapeHtml } from '../../utils/html.js';

const RAIL_ID = 'dooms-settings-rail';
const MIN_GROUPS = 3;
const MIN_GROUPS_IF_LONG = 2;
const LONG_PAGE_ROWS = 8;
let lastTab = null; // remembered for the session only
/** section id → the label of the sub-tab that was open there (session only) */
const lastGroup = new Map();

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
        popup.querySelectorAll('.dooms-rail-current').forEach(s => s.classList.remove('dooms-rail-current'));
        popup.querySelectorAll('.rpg-accordion-section').forEach(clearSubrail);
        return;
    }
    buildRail(popup);
}

/**
 * (Re)builds the icon rail from the visible sections and shows one.
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
    rail.innerHTML = sections.map(section => {
        const id = section.dataset.accordion;
        const iconEl = section.querySelector('.rpg-accordion-icon');
        const icon = iconEl ? iconEl.className.replace('rpg-accordion-icon', '').trim() : 'fa-solid fa-circle';
        const title = section.querySelector('.rpg-accordion-title')?.textContent.trim() || id;
        return `<button type="button" class="dooms-rail-btn" data-target="${escapeHtml(id)}" title="${escapeHtml(title)}" aria-label="${escapeHtml(title)}">
            <i class="${escapeHtml(icon)}" aria-hidden="true"></i><span>${escapeHtml(title)}</span>
        </button>`;
    }).join('');
    rail.querySelectorAll('.dooms-rail-btn').forEach(btn => {
        btn.addEventListener('click', () => selectSection(popup, btn.dataset.target));
    });
    // A toggle on the page can reveal or hide a wrapper full of headings
    // (enabling the Doom Counter, say), so the sub-menu follows changes.
    if (!body.dataset.doomsSubrailWatch) {
        body.dataset.doomsSubrailWatch = '1';
        body.addEventListener('change', () => {
            requestAnimationFrame(() => {
                const current = popup.querySelector('.rpg-settings-popup-body > .rpg-accordion-section.dooms-rail-current');
                if (current && popup.classList.contains('dooms-rail')) buildSubrail(current);
            });
        });
    }
    const wanted = sections.find(s => s.dataset.accordion === lastTab) || sections[0];
    if (wanted) selectSection(popup, wanted.dataset.accordion);
}

/**
 * Shows one section as the page and marks its rail button.
 * @param {HTMLElement} popup
 * @param {string} id - the section's data-accordion value
 */
export function selectSection(popup, id) {
    popup.querySelectorAll('.rpg-settings-popup-body > .rpg-accordion-section').forEach(section => {
        const on = section.dataset.accordion === id;
        section.classList.toggle('dooms-rail-current', on);
        section.classList.toggle('rpg-accordion-open', on);
        if (on) {
            // A page has room for its groups: show them open (the user can
            // still fold any of them while the page is up). A card marked
            // data-rail-closed (Advanced) stays folded until asked.
            section.querySelectorAll('details.rpg-subsection-collapse').forEach(d => {
                if (!d.dataset.railClosed) d.open = true;
            });
            buildSubrail(section);
        } else {
            clearSubrail(section);
        }
    });
    popup.querySelectorAll('.dooms-rail-btn').forEach(btn => {
        btn.classList.toggle('is-active', btn.dataset.target === id);
    });
    popup.querySelector('.rpg-settings-popup-body')?.scrollTo({ top: 0 });
    lastTab = id;
}

/* ── Sub-menus ─────────────────────────────────────────────────────────── */

const HEAD_SELECTOR = '.rpg-subsection-label, details.rpg-subsection-collapse';

/**
 * @param {Element} el
 * @returns {boolean} true for a heading that can start a group
 */
function isHeading(el) {
    if (!(el instanceof HTMLElement) || el.style.display === 'none' || el.hidden) return false;
    if (el.dataset.railClosed) return false;
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
    // (hidden) popups sit beside it and must not leak into the label.
    src = src.querySelector(':scope > span') || src;
    const clone = src.cloneNode(true);
    clone.querySelectorAll('.rpg-accordion-badge, .rpg-subsection-chevron, i, button, [hidden], .rpg-section-info-popup, .rpg-setting-hint')
        .forEach(n => n.remove());
    const text = clone.textContent.replace(/\s+/g, ' ').trim();
    return text.length > 40 ? text.slice(0, 39).trimEnd() + '…' : text;
}

/**
 * Removes a section's sub-menu and the group marks that drive it.
 * @param {HTMLElement} section
 */
function clearSubrail(section) {
    section.querySelector(':scope > .dooms-subrail')?.remove();
    section.classList.remove('dooms-subtabs-active');
    section.querySelectorAll('[data-dooms-group], [data-dooms-group-wrap], .dooms-group-head').forEach(el => {
        el.removeAttribute('data-dooms-group');
        el.removeAttribute('data-dooms-group-wrap');
        el.classList.remove('dooms-group-on', 'dooms-group-open', 'dooms-group-head');
    });
}

/**
 * Splits a page's body into groups, one per heading, in document order.
 * @param {HTMLElement} body the section's .rpg-accordion-body
 * @returns {{ label: string, head: HTMLElement|null, els: HTMLElement[] }[]}
 */
function collectGroups(body) {
    const groups = [{ label: 'General', head: null, els: [] }];
    const walk = (container) => {
        for (const child of Array.from(container.children)) {
            if (!(child instanceof HTMLElement)) continue;
            if (isHeading(child)) {
                groups.push({ label: headingText(child) || 'Section', head: child, els: [child] });
                continue;
            }
            if (child.dataset.railClosed) {
                groups[0].els.push(child);
                continue;
            }
            // A showing wrapper that holds two or more headings is opened up:
            // its headings become groups of their own.
            const inner = child.matches('details, .rpg-setting-row') ? [] : Array.from(child.children).filter(isHeading);
            if (inner.length >= 2 && child.style.display !== 'none' && !child.hidden) {
                child.dataset.doomsGroupWrap = '1';
                walk(child);
                continue;
            }
            groups[groups.length - 1].els.push(child);
        }
    };
    walk(body);
    return groups.filter(g => g.els.length > 0);
}

/**
 * Builds (or rebuilds) the sub-menu strip for a page, keeping the tab that
 * was open there if it still exists.
 * @param {HTMLElement} section
 */
function buildSubrail(section) {
    const body = section.querySelector(':scope > .rpg-accordion-body');
    const header = section.querySelector(':scope > .rpg-accordion-header');
    if (!body || !header) return;
    const previous = section.querySelector(':scope > .dooms-subrail .dooms-subrail-btn.is-active')?.dataset.label
        || lastGroup.get(section.dataset.accordion);
    clearSubrail(section);
    const groups = collectGroups(body);
    const rows = body.querySelectorAll('.rpg-setting-row').length;
    const enough = groups.length >= MIN_GROUPS || (groups.length >= MIN_GROUPS_IF_LONG && rows >= LONG_PAGE_ROWS);
    if (!enough) return;
    groups.forEach((g, i) => {
        g.els.forEach(el => { el.dataset.doomsGroup = String(i); });
        if (g.head) g.head.classList.add('dooms-group-head');
    });
    const strip = document.createElement('div');
    strip.className = 'dooms-subrail';
    strip.setAttribute('role', 'tablist');
    strip.innerHTML = groups.map((g, i) =>
        `<button type="button" class="dooms-subrail-btn" role="tab" data-group="${i}" data-label="${escapeHtml(g.label)}">${escapeHtml(g.label)}</button>`,
    ).join('');
    header.after(strip);
    section.classList.add('dooms-subtabs-active');
    const activate = (i) => {
        section.querySelectorAll('[data-dooms-group]').forEach(el => {
            el.classList.toggle('dooms-group-on', el.dataset.doomsGroup === String(i));
        });
        section.querySelectorAll('[data-dooms-group-wrap]').forEach(w => {
            w.classList.toggle('dooms-group-open', !!w.querySelector('.dooms-group-on'));
        });
        strip.querySelectorAll('.dooms-subrail-btn').forEach(b => {
            const on = b.dataset.group === String(i);
            b.classList.toggle('is-active', on);
            b.setAttribute('aria-selected', on ? 'true' : 'false');
        });
        const head = groups[i].head;
        if (head && head.matches('details')) head.open = true;
        lastGroup.set(section.dataset.accordion, groups[i].label);
    };
    strip.querySelectorAll('.dooms-subrail-btn').forEach(b => {
        b.addEventListener('click', () => {
            activate(Number(b.dataset.group));
            section.closest('.rpg-settings-popup-body')?.scrollTo({ top: 0 });
        });
    });
    const keep = groups.findIndex(g => g.label === previous);
    activate(keep >= 0 ? keep : 0);
}
