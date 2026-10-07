/**
 * Setup backgrounds — a SillyTavern background for each UI setup.
 *
 * When a UI setup other than Classic is active (and the option is on), DES
 * paints a background for it in the active theme's five colours, saves it
 * through SillyTavern's own backgrounds upload (so it sits in the Backgrounds
 * panel like any other) and makes it the global background the way
 * SillyTavern's own picker does. Switching to Classic, or turning the option
 * off, puts the background that was there before back.
 *
 * A chat with a locked background keeps it: the global setting changes, the
 * locked chat does not.
 */
import { extensionSettings } from '../../core/state.js';
import { saveSettings } from '../../core/persistence.js';
import { getRequestHeaders, saveSettingsDebounced, chat_metadata } from '../../../../../../../script.js';
import { background_settings, getBackgrounds, getBackgroundPath } from '../../../../../../../scripts/backgrounds.js';

const SETUP_LABELS = { grimoire: 'Grimoire', console: 'Console', lumen: 'Lumen', arcade: 'Arcade', inked: 'Inked' };
const FILE_PREFIX = 'DES ';
const WIDTH = 1920;
const HEIGHT = 1080;
const uploadedThisSession = new Set();
let pending = null;

/* ── Colour helpers ──────────────────────────────────────────────────────── */

/**
 * Resolves any CSS colour (hex, rgb(), var() already substituted) to RGB.
 * @param {string} css
 * @param {number[]} fallback
 * @returns {number[]} [r, g, b]
 */
function toRgb(css, fallback) {
    try {
        const probe = document.createElement('span');
        probe.style.color = css;
        document.body.appendChild(probe);
        const m = getComputedStyle(probe).color.match(/[\d.]+/g);
        probe.remove();
        if (m && m.length >= 3) return m.slice(0, 3).map(Number);
    } catch (_) { /* fall through */ }
    return fallback;
}

/**
 * The active theme's five colours, read from the body variables applyUiSetup
 * publishes (var() references already resolved by the browser).
 * @returns {{bg: number[], accent: number[], text: number[], highlight: number[], border: number[]}}
 */
function readPalette() {
    const cs = getComputedStyle(document.body);
    const get = (k, fb) => toRgb(cs.getPropertyValue(`--dooms-ui-${k}`).trim(), fb);
    return {
        bg: get('bg', [26, 26, 46]),
        accent: get('accent', [22, 33, 62]),
        text: get('text', [234, 234, 234]),
        highlight: get('highlight', [233, 69, 96]),
        border: get('border', [74, 123, 167]),
    };
}

const rgba = (c, a) => `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${a})`;
const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
const isLight = (c) => (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) > 140;

/* ── Painters ────────────────────────────────────────────────────────────── */

/**
 * Paints a setup's background onto a canvas context.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} w
 * @param {number} h
 * @param {string} setup
 * @param {ReturnType<typeof readPalette>} p
 */
export function paintBackground(ctx, w, h, setup, p) {
    const dark = !isLight(p.bg);
    const shade = (c, t) => mix(c, dark ? [0, 0, 0] : [255, 255, 255], t);
    switch (setup) {
        case 'grimoire': return paintGrimoire(ctx, w, h, p, shade);
        case 'console': return paintConsole(ctx, w, h, p, shade);
        case 'lumen': return paintLumen(ctx, w, h, p, shade);
        case 'arcade': return paintArcade(ctx, w, h, p, shade);
        case 'inked': return paintInked(ctx, w, h, p, shade, dark);
        default: ctx.fillStyle = rgba(p.bg, 1); ctx.fillRect(0, 0, w, h);
    }
}

/** Grimoire: a dark vellum page, ledger rules, a double-ruled frame with gilt corners. */
function paintGrimoire(ctx, w, h, p, shade) {
    ctx.fillStyle = rgba(shade(p.bg, 0.35), 1);
    ctx.fillRect(0, 0, w, h);
    // Vignette toward the edges
    const vg = ctx.createRadialGradient(w / 2, h / 2, h * 0.2, w / 2, h / 2, w * 0.75);
    vg.addColorStop(0, rgba(p.bg, 0.35));
    vg.addColorStop(1, rgba(shade(p.bg, 0.6), 0.9));
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, w, h);
    // Ledger rules
    ctx.strokeStyle = rgba(p.border, 0.07);
    ctx.lineWidth = 1;
    for (let y = 120; y < h - 80; y += 36) {
        ctx.beginPath(); ctx.moveTo(140, y); ctx.lineTo(w - 140, y); ctx.stroke();
    }
    // Double-ruled frame
    const inset = 44;
    ctx.strokeStyle = rgba(p.highlight, 0.45);
    ctx.lineWidth = 1.5;
    ctx.strokeRect(inset, inset, w - inset * 2, h - inset * 2);
    ctx.strokeStyle = rgba(p.border, 0.3);
    ctx.lineWidth = 1;
    ctx.strokeRect(inset + 8, inset + 8, w - (inset + 8) * 2, h - (inset + 8) * 2);
    // Gilt diamonds at the corners
    ctx.fillStyle = rgba(p.highlight, 0.8);
    for (const [x, y] of [[inset, inset], [w - inset, inset], [inset, h - inset], [w - inset, h - inset]]) {
        ctx.save(); ctx.translate(x, y); ctx.rotate(Math.PI / 4); ctx.fillRect(-7, -7, 14, 14); ctx.restore();
    }
    // Centre ornament: a long hairline with a diamond, low on the page
    ctx.strokeStyle = rgba(p.highlight, 0.25);
    ctx.beginPath(); ctx.moveTo(w * 0.3, h - 90); ctx.lineTo(w * 0.7, h - 90); ctx.stroke();
    ctx.save(); ctx.translate(w / 2, h - 90); ctx.rotate(Math.PI / 4); ctx.fillStyle = rgba(p.highlight, 0.6); ctx.fillRect(-5, -5, 10, 10); ctx.restore();
}

/** Ops Console: a dark readout, grid, radar arcs, corner brackets, scanlines. */
function paintConsole(ctx, w, h, p, shade) {
    ctx.fillStyle = rgba(shade(p.bg, 0.3), 1);
    ctx.fillRect(0, 0, w, h);
    // Grid
    ctx.strokeStyle = rgba(p.border, 0.09);
    ctx.lineWidth = 1;
    for (let x = 0; x <= w; x += 40) { ctx.beginPath(); ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, h); ctx.stroke(); }
    for (let y = 0; y <= h; y += 40) { ctx.beginPath(); ctx.moveTo(0, y + 0.5); ctx.lineTo(w, y + 0.5); ctx.stroke(); }
    // Radar arcs from the lower-left
    ctx.strokeStyle = rgba(p.highlight, 0.12);
    ctx.lineWidth = 2;
    for (let r = 220; r < w * 1.2; r += 200) {
        ctx.beginPath(); ctx.arc(-80, h + 80, r, Math.PI * 1.5, Math.PI * 2); ctx.stroke();
    }
    // A sweep line
    const sg = ctx.createLinearGradient(0, h, w * 0.7, h * 0.2);
    sg.addColorStop(0, rgba(p.highlight, 0.35));
    sg.addColorStop(1, rgba(p.highlight, 0));
    ctx.strokeStyle = sg; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(-80, h + 80); ctx.lineTo(w * 0.7, h * 0.2); ctx.stroke();
    // Corner brackets
    ctx.strokeStyle = rgba(p.text, 0.35);
    ctx.lineWidth = 3;
    const L = 46, m = 28;
    for (const [x, y, sx, sy] of [[m, m, 1, 1], [w - m, m, -1, 1], [m, h - m, 1, -1], [w - m, h - m, -1, -1]]) {
        ctx.beginPath(); ctx.moveTo(x, y + sy * L); ctx.lineTo(x, y); ctx.lineTo(x + sx * L, y); ctx.stroke();
    }
    // Scanlines
    ctx.fillStyle = rgba([0, 0, 0], 0.12);
    for (let y = 0; y < h; y += 4) ctx.fillRect(0, y, w, 1);
    // Top status strip
    ctx.fillStyle = rgba(p.accent, 0.9);
    ctx.fillRect(0, 0, w, 6);
    ctx.fillStyle = rgba(p.highlight, 0.9);
    ctx.fillRect(0, 0, w * 0.18, 6);
}

/** Lumen: an aurora of soft colour over the theme ground. */
function paintLumen(ctx, w, h, p, shade) {
    ctx.fillStyle = rgba(shade(p.bg, 0.15), 1);
    ctx.fillRect(0, 0, w, h);
    const blobs = [
        [0.18, 0.25, 0.55, p.highlight, 0.42],
        [0.78, 0.72, 0.6, p.border, 0.35],
        [0.6, 0.15, 0.45, mix(p.highlight, p.text, 0.5), 0.22],
        [0.3, 0.85, 0.5, p.accent, 0.55],
        [0.9, 0.2, 0.35, p.text, 0.08],
    ];
    ctx.globalCompositeOperation = 'lighter';
    for (const [fx, fy, fr, c, a] of blobs) {
        const g = ctx.createRadialGradient(w * fx, h * fy, 0, w * fx, h * fy, h * fr);
        g.addColorStop(0, rgba(c, a));
        g.addColorStop(0.55, rgba(c, a * 0.35));
        g.addColorStop(1, rgba(c, 0));
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h);
    }
    ctx.globalCompositeOperation = 'source-over';
    // A soft band of light across the top third
    const band = ctx.createLinearGradient(0, h * 0.2, 0, h * 0.5);
    band.addColorStop(0, rgba(p.text, 0));
    band.addColorStop(0.5, rgba(p.text, 0.05));
    band.addColorStop(1, rgba(p.text, 0));
    ctx.fillStyle = band;
    ctx.fillRect(0, 0, w, h);
}

/** Arcade: diagonal stripes, a chamfered field in the highlight, a bold slash. */
function paintArcade(ctx, w, h, p, shade) {
    ctx.fillStyle = rgba(shade(p.bg, 0.35), 1);
    ctx.fillRect(0, 0, w, h);
    // Diagonal stripes
    ctx.save();
    ctx.fillStyle = rgba(p.text, 0.035);
    ctx.translate(w / 2, h / 2); ctx.rotate(-Math.PI / 4);
    for (let x = -w; x < w; x += 28) ctx.fillRect(x, -w, 14, w * 2);
    ctx.restore();
    // Chamfered field, lower right
    const cham = 90;
    ctx.fillStyle = rgba(p.accent, 0.85);
    ctx.beginPath();
    ctx.moveTo(w * 0.55 + cham, h * 0.55); ctx.lineTo(w, h * 0.55); ctx.lineTo(w, h); ctx.lineTo(w * 0.55, h); ctx.lineTo(w * 0.55, h * 0.55 + cham); ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = rgba(p.highlight, 0.9); ctx.lineWidth = 6;
    ctx.beginPath(); ctx.moveTo(w * 0.55 + cham, h * 0.55); ctx.lineTo(w, h * 0.55); ctx.stroke();
    // Bold slash
    ctx.save();
    ctx.fillStyle = rgba(p.highlight, 0.9);
    ctx.transform(1, 0, -0.35, 1, 0, 0);
    ctx.fillRect(w * 0.42, 0, 26, h);
    ctx.fillStyle = rgba(p.text, 0.25);
    ctx.fillRect(w * 0.42 + 40, 0, 8, h);
    ctx.restore();
    // Top-left title block
    ctx.fillStyle = rgba(p.text, 0.9);
    ctx.beginPath();
    ctx.moveTo(0, 0); ctx.lineTo(w * 0.22, 0); ctx.lineTo(w * 0.22 - 30, 60); ctx.lineTo(0, 60); ctx.closePath();
    ctx.fill();
    ctx.fillStyle = rgba(p.highlight, 1);
    ctx.fillRect(0, 60, w * 0.22 - 30, 8);
}

/** Inked: a comic page, empty panels with ink borders and gutters, speed lines. */
function paintInked(ctx, w, h, p, shade, dark) {
    const ink = p.text;
    const gutter = mix(p.bg, ink, 0.14);
    ctx.fillStyle = rgba(gutter, 1);
    ctx.fillRect(0, 0, w, h);
    // Panels
    const panels = [
        [0.04, 0.06, 0.38, 0.42], [0.45, 0.06, 0.51, 0.26], [0.45, 0.35, 0.24, 0.13], [0.72, 0.35, 0.24, 0.13],
        [0.04, 0.52, 0.22, 0.42], [0.29, 0.52, 0.67, 0.42],
    ];
    for (const [fx, fy, fw, fh] of panels) {
        const x = w * fx, y = h * fy, pw = w * fw, ph = h * fh;
        ctx.fillStyle = rgba(ink, 0.9);
        ctx.fillRect(x + 8, y + 8, pw, ph);
        ctx.fillStyle = rgba(p.bg, 1);
        ctx.fillRect(x, y, pw, ph);
        ctx.strokeStyle = rgba(ink, 0.9); ctx.lineWidth = 4;
        ctx.strokeRect(x, y, pw, ph);
    }
    // Speed lines from the top-right corner, across the big lower panel
    ctx.save();
    ctx.beginPath(); ctx.rect(w * 0.29, h * 0.52, w * 0.67, h * 0.42); ctx.clip();
    ctx.strokeStyle = rgba(ink, dark ? 0.18 : 0.22); ctx.lineWidth = 2;
    for (let i = 0; i < 40; i++) {
        const a = Math.PI * 0.55 + (i / 40) * Math.PI * 0.4;
        ctx.beginPath(); ctx.moveTo(w, h * 0.52); ctx.lineTo(w + Math.cos(a) * w * 1.4, h * 0.52 + Math.sin(a) * w * 1.4); ctx.stroke();
    }
    ctx.restore();
    // A highlight caption box
    ctx.fillStyle = rgba(ink, 0.9);
    ctx.fillRect(w * 0.06 + 6, h * 0.08 + 6, 300, 56);
    ctx.fillStyle = rgba(mix(p.highlight, p.bg, 0.65), 1);
    ctx.fillRect(w * 0.06, h * 0.08, 300, 56);
    ctx.strokeStyle = rgba(ink, 0.9); ctx.lineWidth = 4;
    ctx.strokeRect(w * 0.06, h * 0.08, 300, 56);
}

/* ── SillyTavern plumbing ────────────────────────────────────────────────── */

function fileNameFor(setup, theme) {
    const t = String(theme || 'default').replace(/[^a-z0-9-]/gi, '');
    return `${FILE_PREFIX}${SETUP_LABELS[setup] || setup} (${t}).webp`;
}

function isOurs(name) {
    return typeof name === 'string' && name.startsWith(FILE_PREFIX);
}

function isChatLocked() {
    return Boolean(chat_metadata?.custom_background);
}

/** @returns {Promise<Blob>} */
function renderBlob(setup) {
    const canvas = document.createElement('canvas');
    canvas.width = WIDTH; canvas.height = HEIGHT;
    const ctx = canvas.getContext('2d');
    paintBackground(ctx, WIDTH, HEIGHT, setup, readPalette());
    return new Promise((resolve, reject) => {
        canvas.toBlob(b => b ? resolve(b) : reject(new Error('toBlob failed')), 'image/webp', 0.9);
    });
}

/**
 * Uploads through SillyTavern's backgrounds endpoint. The server copies the
 * file into the user's backgrounds folder under its own name, so a second
 * upload with the same name replaces the first.
 * @returns {Promise<string>} the saved file name
 */
async function upload(blob, fileName) {
    const form = new FormData();
    form.append('avatar', new File([blob], fileName, { type: blob.type || 'image/webp' }));
    const headers = getRequestHeaders({ omitContentType: true });
    delete headers['Content-Type'];
    const res = await fetch('/api/backgrounds/upload', { method: 'POST', headers, body: form, cache: 'no-cache' });
    if (!res.ok) throw new Error(`background upload failed (${res.status})`);
    return await res.text();
}

/** Makes a file the global background, the way SillyTavern's picker does. */
function setGlobalBackground(name) {
    const url = `url("${getBackgroundPath(name)}")`;
    background_settings.name = name;
    background_settings.url = url;
    if (!isChatLocked()) $('#bg1').css('background-image', url);
    saveSettingsDebounced();
    $('.bg_example').removeClass('selected').filter(function () { return $(this).attr('bgfile') === name; }).addClass('selected');
}

function record() {
    if (!extensionSettings.uiBackground || typeof extensionSettings.uiBackground !== 'object') extensionSettings.uiBackground = {};
    return extensionSettings.uiBackground;
}

/** Puts back the background that was there before DES took over, if DES's is still up. */
function restorePrevious() {
    const rec = record();
    if (!rec.applied) return;
    const stillOurs = background_settings.name === rec.applied || isOurs(background_settings.name);
    if (stillOurs && rec.previousName) {
        setGlobalBackground(rec.previousName);
    }
    delete rec.applied;
    delete rec.previousName;
    saveSettings();
}

/**
 * Brings the SillyTavern background in line with the UI setup. Called from
 * applyUiSetup(); safe to call often (the work is deferred and coalesced).
 * @param {string} setup - the active UI setup ('classic' for none)
 * @param {string} theme - the active colour theme
 */
export function syncSetupBackground(setup, theme) {
    clearTimeout(pending);
    pending = setTimeout(() => { run(setup, theme).catch(e => console.warn('[Dooms Tracker] setup background:', e)); }, 150);
}

async function run(setup, theme) {
    const enabled = extensionSettings.uiSetupBackground !== false;
    if (!enabled || !SETUP_LABELS[setup]) {
        restorePrevious();
        return;
    }
    const rec = record();
    const fileName = fileNameFor(setup, theme);
    if (!rec.applied && !isOurs(background_settings.name)) {
        rec.previousName = background_settings.name;
    }
    const key = `${fileName}`;
    const listed = $('.bg_example').filter(function () { return $(this).attr('bgfile') === fileName; }).length > 0;
    if (!uploadedThisSession.has(key) || !listed) {
        const blob = await renderBlob(setup);
        const saved = await upload(blob, fileName);
        uploadedThisSession.add(key);
        try { await getBackgrounds(); } catch (_) { /* the list refresh is cosmetic */ }
        setGlobalBackground(saved || fileName);
    } else {
        setGlobalBackground(fileName);
    }
    rec.applied = fileName;
    saveSettings();
}
