/**
 * "What's New" screen — shown once per release, desktop only.
 *
 * Hardware-guideline compliance (docs/rebuild-philosophy.md):
 *   - This module, its stylesheet (styles/whats-new.css), and the content
 *     file (whatsnew.json) are loaded ONLY when the screen will actually
 *     display — index.js performs the cheap gate (version compare +
 *     dismissed flag + desktop breakpoint) before dynamic-importing this.
 *   - Static DOM, built with textContent (content is data, not markup).
 *     No timers, no observers, no infinite animations, no backdrop-filter.
 *   - On close the DOM is removed and the stylesheet unlinked — nothing
 *     remains in memory.
 *
 * Dismissal model:
 *   - Closing (X / "Got it" / Esc / click outside) records the current
 *     version in whatsNewSeenVersion → shows again on the NEXT release.
 *   - "Don't show again" sets whatsNewDisabled → never shows until the
 *     user re-enables it via the Display-section toggle.
 */
import { extensionSettings } from '../../core/state.js';
import { saveSettings } from '../../core/persistence.js';
import { extensionFolderPath, getExtensionVersion } from '../../core/config.js';
import { ensureCss, removeCss } from '../../core/cssLoader.js';

const ROOT_ID = 'dooms-whats-new';

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

async function markSeen() {
    try {
        const v = await getExtensionVersion();
        if (v) {
            extensionSettings.whatsNewSeenVersion = v;
            saveSettings();
        }
    } catch (e) { /* non-fatal */ }
}

function close() {
    document.getElementById(ROOT_ID)?.remove();
    document.removeEventListener('keydown', onKeyDown);
    removeCss('whats-new');
}

function onKeyDown(e) {
    if (e.key === 'Escape') {
        markSeen();
        close();
    }
}

/**
 * Fetches the release notes and shows the screen. The caller (index.js)
 * has already verified it SHOULD show; this function only renders.
 */
export async function showWhatsNew() {
    let notes;
    try {
        const res = await fetch(`/${extensionFolderPath}/whatsnew.json`);
        if (!res.ok) return;
        notes = await res.json();
    } catch (e) {
        return; // no notes file — nothing to show, costs nothing
    }
    if (!notes || !Array.isArray(notes.items) || notes.items.length === 0) return;

    await ensureCss('whats-new');
    if (document.getElementById(ROOT_ID)) return;

    const overlay = el('div', 'dooms-wn-overlay');
    overlay.id = ROOT_ID;
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', "What's new in Doom's Enhancement Suite");

    const panel = el('div', 'dooms-wn-panel');

    const header = el('header', 'dooms-wn-header');
    const heading = el('h3', 'dooms-wn-title', "What's New");
    const version = el('span', 'dooms-wn-version', notes.version ? `v${notes.version}` : '');
    if (notes.title) version.textContent += notes.title ? ` — ${notes.title}` : '';
    heading.appendChild(version);
    const closeBtn = el('button', 'dooms-wn-close', '×');
    closeBtn.type = 'button';
    closeBtn.title = 'Close';
    header.append(heading, closeBtn);

    const body = el('div', 'dooms-wn-body');
    for (const item of notes.items) {
        if (!item) continue;
        const entry = el('div', 'dooms-wn-item');
        if (item.title) entry.appendChild(el('div', 'dooms-wn-item-title', String(item.title)));
        if (item.body) entry.appendChild(el('div', 'dooms-wn-item-body', String(item.body)));
        body.appendChild(entry);
    }

    const footer = el('footer', 'dooms-wn-footer');
    const dontShow = el('button', 'dooms-wn-btn dooms-wn-btn-ghost', "Don't show again");
    dontShow.type = 'button';
    const gotIt = el('button', 'dooms-wn-btn dooms-wn-btn-primary', 'Got it');
    gotIt.type = 'button';
    footer.append(dontShow, gotIt);

    panel.append(header, body, footer);
    overlay.appendChild(panel);

    closeBtn.addEventListener('click', () => { markSeen(); close(); });
    gotIt.addEventListener('click', () => { markSeen(); close(); });
    dontShow.addEventListener('click', () => {
        extensionSettings.whatsNewDisabled = true;
        markSeen();
        saveSettings();
        close();
    });
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) { markSeen(); close(); }
    });
    document.addEventListener('keydown', onKeyDown);

    document.body.appendChild(overlay);
}
