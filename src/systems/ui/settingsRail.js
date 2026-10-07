/**
 * Settings window — rail layout.
 *
 * The Settings window's markup is one stacked strip of accordion sections
 * (template.html). The rail layout keeps that markup and presents it the way
 * the Megumin Suite options menu does: an icon rail down the left, one
 * section shown at a time as a page with a hero heading, the rows grouped
 * into cards (styles/modals.css, "SETTINGS WINDOW — RAIL LAYOUT").
 *
 * applySettingsLayout() runs every time the window opens and when the
 * layout setting changes, so sections that other code shows or hides
 * (updateSectionVisibility, feature toggles) are picked up each time.
 */
import { extensionSettings } from '../../core/state.js';
import { escapeHtml } from '../../utils/html.js';

const RAIL_ID = 'dooms-settings-rail';
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
 * Applies the strip or rail layout to #rpg-settings-popup.
 */
export function applySettingsLayout() {
    const popup = document.getElementById('rpg-settings-popup');
    if (!popup) return;
    const rail = isRailLayout();
    popup.classList.toggle('dooms-rail', rail);
    if (!rail) {
        document.getElementById(RAIL_ID)?.remove();
        popup.querySelectorAll('.dooms-rail-current').forEach(s => s.classList.remove('dooms-rail-current'));
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
        // A page has room for its groups: show them open (the user can still
        // fold any of them while the page is up).
        if (on) section.querySelectorAll('details.rpg-subsection-collapse').forEach(d => { d.open = true; });
    });
    popup.querySelectorAll('.dooms-rail-btn').forEach(btn => {
        btn.classList.toggle('is-active', btn.dataset.target === id);
    });
    popup.querySelector('.rpg-settings-popup-body')?.scrollTo({ top: 0 });
    lastTab = id;
}
