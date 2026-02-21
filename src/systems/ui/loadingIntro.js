/**
 * Loading Intro Module
 * Replaces SillyTavern's default spinning gear with a cinematic credits sequence
 * during initial startup. Only plays once per page load.
 *
 * Modes:
 *   - 'off'           — default SillyTavern gear spinner
 *   - 'film-credits'  — classic fade-in/out credit blocks, serif typography, floating dust
 *   - 'typewriter'    — green terminal typewriter dispatch with CRT scanlines
 */
import { extensionSettings } from '../../core/state.js';

/** Whether the intro has already played this session */
let _hasPlayed = false;

// ── Credit data ──
const TITLE_TEXT = "Doom's Character Tracker";
const VERSION_TEXT = 'Version 3.0';
const CREDIT_TEXT = 'by Doom';

/**
 * Attempts to play the cinematic intro over SillyTavern's loading screen.
 * Should be called very early during extension init (before initUI).
 * Returns a promise that resolves when the intro finishes or is skipped.
 *
 * Key challenge: SillyTavern's spinner lives inside a native <dialog> element
 * which occupies the browser's "top layer" — no z-index can beat it.
 * Solution: We hide all open <dialog> elements while the intro plays,
 * and append our overlay directly to <body> as a fixed fullscreen layer.
 */
export async function playLoadingIntro() {
    const mode = extensionSettings.loadingIntroMode || 'off';

    // Skip if turned off or already played
    if (mode === 'off' || _hasPlayed) return;
    _hasPlayed = true;

    // We don't strictly need #preloader — we create our own fullscreen overlay.
    // But if it's gone, ST has finished loading and there's no point in an intro.
    const preloader = document.getElementById('preloader');
    if (!preloader) return;

    // ── Hide SillyTavern's spinner ──
    // The spinner sits inside a Popup <dialog> in the browser's top layer,
    // which renders above everything regardless of z-index. Hide all open
    // dialogs so our overlay is actually visible.
    const openDialogs = document.querySelectorAll('dialog[open]');
    openDialogs.forEach(d => d.style.visibility = 'hidden');

    // Also hide the preloader's backdrop blur so our background is clean
    preloader.style.visibility = 'hidden';

    // ── Build our fullscreen overlay on <body> ──
    const overlay = document.createElement('div');
    overlay.id = 'dooms-loading-intro';
    overlay.className = `dooms-intro-${mode}`;
    document.body.appendChild(overlay);

    try {
        if (mode === 'film-credits') {
            await playFilmCredits(overlay);
        } else if (mode === 'typewriter') {
            await playTypewriter(overlay);
        }
    } catch (e) {
        console.error('[Dooms Tracker] Loading intro error:', e);
    }

    // ── Fade out and clean up ──
    overlay.style.transition = 'opacity 0.4s ease-out';
    overlay.style.opacity = '0';
    await sleep(400);
    overlay.remove();

    // Restore SillyTavern's loading UI so it can finish normally
    preloader.style.visibility = '';
    openDialogs.forEach(d => d.style.visibility = '');
}

// ─────────────────────────────────────────────
//  Option A: Classic Film Credits
// ─────────────────────────────────────────────

async function playFilmCredits(container) {
    // Load Google Fonts for cinematic serif typography
    await loadFonts(['Cinzel:wght@400;700', 'Cormorant+Garamond:wght@300;400;600']);

    // Vignette
    const vignette = el('div', 'dooms-intro-vignette');
    container.appendChild(vignette);

    // Particle dust field
    const particles = el('div', 'dooms-intro-particles');
    for (let i = 0; i < 25; i++) {
        const p = el('div', 'dooms-intro-dust');
        p.style.left = Math.random() * 100 + '%';
        p.style.top = Math.random() * 100 + '%';
        p.style.animationDelay = (Math.random() * 4) + 's';
        p.style.animationDuration = (3 + Math.random() * 4) + 's';
        particles.appendChild(p);
    }
    container.appendChild(particles);

    // Title card with credit at the bottom
    const title = el('div', 'dooms-intro-credit-block');
    title.innerHTML = `
        <div class="dooms-intro-credit-divider"></div>
        <div class="dooms-intro-credit-title">${TITLE_TEXT}</div>
        <div class="dooms-intro-credit-subtitle">${VERSION_TEXT}</div>
        <div class="dooms-intro-credit-divider"></div>
    `;
    container.appendChild(title);

    // Credit line pinned to bottom
    const credit = el('div', 'dooms-intro-credit-byline');
    credit.textContent = CREDIT_TEXT;
    container.appendChild(credit);

    // Fade in
    await sleep(50);
    title.style.opacity = '1';
    credit.style.opacity = '1';
    await sleep(2200);
    // Fade out
    title.style.opacity = '0';
    credit.style.opacity = '0';
    await sleep(500);
}

// ─────────────────────────────────────────────
//  Option B: Typewriter Dispatch
// ─────────────────────────────────────────────

async function playTypewriter(container) {
    // CRT scanlines + glow
    container.appendChild(el('div', 'dooms-intro-scanlines'));
    container.appendChild(el('div', 'dooms-intro-crt-glow'));

    const lines = [
        { text: '> INITIALIZING SYSTEM...', cls: 'dim', pause: 350 },
        { text: '> LOADING MODULES ██████████ OK', cls: 'dim', pause: 300 },
        { text: '', cls: '', pause: 200 },
        { text: '> ALL SYSTEMS NOMINAL', cls: 'accent', pause: 350 },
        { text: '> LAUNCHING...', cls: 'accent', pause: 400 },
    ];

    for (const line of lines) {
        if (!line.text) {
            const spacer = el('div', 'dooms-intro-term-line');
            spacer.innerHTML = '&nbsp;';
            spacer.style.opacity = '1';
            container.appendChild(spacer);
            await sleep(line.pause);
            continue;
        }

        const row = el('div', 'dooms-intro-term-line');
        if (line.cls) row.classList.add(`dooms-intro-term-${line.cls}`);
        row.style.opacity = '1';
        container.appendChild(row);

        // Cursor
        const cursor = el('span', 'dooms-intro-cursor');
        row.appendChild(cursor);

        // Type out characters
        const chars = line.text;
        const speed = Math.max(12, 35 - chars.length);
        for (let i = 0; i < chars.length; i++) {
            row.insertBefore(document.createTextNode(chars[i]), cursor);
            await sleep(speed);
        }
        cursor.remove();
        await sleep(line.pause);
    }

    // Big title
    const title = el('div', 'dooms-intro-term-title');
    title.textContent = `[ ${TITLE_TEXT.toUpperCase()} ]`;
    container.appendChild(title);
    await sleep(50);
    title.style.opacity = '1';

    // Credit line pinned to bottom
    const credit = el('div', 'dooms-intro-credit-byline');
    credit.style.color = '#33ff33';
    credit.textContent = CREDIT_TEXT;
    container.appendChild(credit);
    await sleep(50);
    credit.style.opacity = '1';

    await sleep(1400);
}

// ─────────────────────────────────────────────
//  Utilities
// ─────────────────────────────────────────────

function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

function el(tag, className) {
    const e = document.createElement(tag);
    if (className) e.className = className;
    return e;
}

/**
 * Dynamically loads Google Fonts by injecting a <link> tag.
 * Resolves when fonts are loaded (or after a short timeout fallback).
 */
function loadFonts(fontSpecs) {
    return new Promise(resolve => {
        const families = fontSpecs.map(f => `family=${f}`).join('&');
        const url = `https://fonts.googleapis.com/css2?${families}&display=swap`;

        // Don't add duplicate links
        if (document.querySelector(`link[href="${url}"]`)) {
            resolve();
            return;
        }

        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = url;
        link.onload = () => {
            // Give fonts a moment to apply
            setTimeout(resolve, 100);
        };
        link.onerror = () => resolve(); // Proceed even if fonts fail
        document.head.appendChild(link);

        // Fallback timeout — don't block the intro for fonts
        setTimeout(resolve, 1500);
    });
}
