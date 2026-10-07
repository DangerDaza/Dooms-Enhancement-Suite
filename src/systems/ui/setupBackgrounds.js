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

/** A small seeded generator so a background repaints the same way each time. */
function seeded(seed) {
    let t = seed >>> 0;
    return () => { t += 0x6D2B79F5; let r = Math.imul(t ^ (t >>> 15), 1 | t); r ^= r + Math.imul(r ^ (r >>> 7), 61 | r); return ((r ^ (r >>> 14)) >>> 0) / 4294967296; };
}

/** Grimoire: an arcane chart on mottled vellum — a great sigil circle, a
 *  constellation, corner flourishes, and a double-ruled frame. */
function paintGrimoire(ctx, w, h, p, shade) {
    const rnd = seeded(7);
    ctx.fillStyle = rgba(shade(p.bg, 0.3), 1);
    ctx.fillRect(0, 0, w, h);
    // Mottled vellum: soft pools of light and shade
    for (let i = 0; i < 90; i++) {
        const x = rnd() * w, y = rnd() * h, r = 80 + rnd() * 260;
        const light = rnd() > 0.5;
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, rgba(light ? p.text : [0, 0, 0], light ? 0.035 : 0.06));
        g.addColorStop(1, rgba(light ? p.text : [0, 0, 0], 0));
        ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
    // Vignette
    const vg = ctx.createRadialGradient(w / 2, h / 2, h * 0.25, w / 2, h / 2, w * 0.7);
    vg.addColorStop(0, rgba([0, 0, 0], 0));
    vg.addColorStop(1, rgba([0, 0, 0], 0.55));
    ctx.fillStyle = vg; ctx.fillRect(0, 0, w, h);
    // The sigil: rings, tick marks, a seven-pointed star, nodes
    const cx = w * 0.72, cy = h * 0.52, R = h * 0.44;
    const gilt = (a) => rgba(p.highlight, a);
    ctx.lineWidth = 2.5; ctx.strokeStyle = gilt(0.32);
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();
    ctx.lineWidth = 1; ctx.strokeStyle = gilt(0.26);
    ctx.beginPath(); ctx.arc(cx, cy, R - 16, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, cy, R * 0.64, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, cy, R * 0.6, 0, Math.PI * 2); ctx.stroke();
    for (let i = 0; i < 72; i++) {
        const a = (i / 72) * Math.PI * 2, long = i % 6 === 0;
        const r1 = R - 16, r2 = long ? R - 4 : R - 10;
        ctx.strokeStyle = gilt(long ? 0.5 : 0.28); ctx.lineWidth = long ? 2 : 1;
        ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1); ctx.lineTo(cx + Math.cos(a) * r2, cy + Math.sin(a) * r2); ctx.stroke();
    }
    const pts = [];
    for (let i = 0; i < 7; i++) { const a = -Math.PI / 2 + (i / 7) * Math.PI * 2; pts.push([cx + Math.cos(a) * R * 0.6, cy + Math.sin(a) * R * 0.6]); }
    ctx.strokeStyle = gilt(0.22); ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let i = 0; i < 7; i++) { const [x, y] = pts[(i * 3) % 7]; if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); }
    ctx.closePath(); ctx.stroke();
    for (const [x, y] of pts) {
        ctx.fillStyle = rgba(shade(p.bg, 0.3), 1); ctx.beginPath(); ctx.arc(x, y, 7, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = gilt(0.6); ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(x, y, 7, 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = gilt(0.7); ctx.beginPath(); ctx.arc(x, y, 2, 0, Math.PI * 2); ctx.fill();
    }
    ctx.strokeStyle = gilt(0.5); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(cx, cy, 10, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = gilt(0.7); ctx.beginPath(); ctx.arc(cx, cy, 3, 0, Math.PI * 2); ctx.fill();
    // A constellation on the left
    const stars = [];
    for (let i = 0; i < 9; i++) stars.push([w * (0.08 + rnd() * 0.3), h * (0.12 + rnd() * 0.76)]);
    ctx.strokeStyle = rgba(p.text, 0.18); ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i < stars.length; i++) { const [x, y] = stars[i]; if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); }
    ctx.stroke();
    for (const [x, y] of stars) {
        ctx.fillStyle = rgba(p.text, 0.65); ctx.beginPath(); ctx.arc(x, y, 2 + rnd() * 2, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = gilt(0.5); ctx.beginPath(); ctx.arc(x, y, 1, 0, Math.PI * 2); ctx.fill();
    }
    // Double-ruled frame and corner flourishes
    const inset = 40;
    ctx.strokeStyle = gilt(0.5); ctx.lineWidth = 1.5;
    ctx.strokeRect(inset, inset, w - inset * 2, h - inset * 2);
    ctx.strokeStyle = gilt(0.25); ctx.lineWidth = 1;
    ctx.strokeRect(inset + 7, inset + 7, w - (inset + 7) * 2, h - (inset + 7) * 2);
    ctx.strokeStyle = gilt(0.6); ctx.lineWidth = 2;
    for (const [x, y, sx, sy] of [[inset, inset, 1, 1], [w - inset, inset, -1, 1], [inset, h - inset, 1, -1], [w - inset, h - inset, -1, -1]]) {
        ctx.beginPath(); ctx.moveTo(x, y + sy * 70); ctx.quadraticCurveTo(x, y + sy * 18, x + sx * 18, y + sy * 18); ctx.quadraticCurveTo(x + sx * 40, y + sy * 18, x + sx * 40, y + sy * 36); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(x + sx * 70, y); ctx.quadraticCurveTo(x + sx * 18, y, x + sx * 18, y + sy * 18); ctx.quadraticCurveTo(x + sx * 18, y + sy * 40, x + sx * 36, y + sy * 40); ctx.stroke();
        ctx.save(); ctx.translate(x + sx * 18, y + sy * 18); ctx.rotate(Math.PI / 4); ctx.fillStyle = gilt(0.85); ctx.fillRect(-5, -5, 10, 10); ctx.restore();
    }
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

/** Arcade: a stage — one great diagonal band with a highlight edge, speed marks,
 *  a target ring, and a hazard strip along the foot. */
function paintArcade(ctx, w, h, p, shade) {
    ctx.fillStyle = rgba(shade(p.bg, 0.4), 1);
    ctx.fillRect(0, 0, w, h);
    // Faint stripes
    ctx.save();
    ctx.fillStyle = rgba(p.text, 0.025);
    ctx.translate(w / 2, h / 2); ctx.rotate(-Math.PI / 4);
    for (let x = -w; x < w; x += 28) ctx.fillRect(x, -w, 14, w * 2);
    ctx.restore();
    // The band, down the left, with a highlight edge and a hairline beyond it
    const k = 0.42; // slant: x shifts k * h over the height
    const band = (x0, x1, style) => { ctx.fillStyle = style; ctx.beginPath(); ctx.moveTo(x0 + k * h, 0); ctx.lineTo(x1 + k * h, 0); ctx.lineTo(x1, h); ctx.lineTo(x0, h); ctx.closePath(); ctx.fill(); };
    band(-w, w * 0.16, rgba(p.accent, 0.95));
    band(w * 0.16, w * 0.16 + 22, rgba(p.highlight, 1));
    band(w * 0.16 + 36, w * 0.16 + 40, rgba(p.text, 0.35));
    // Speed marks, top right
    ctx.fillStyle = rgba(p.text, 0.28);
    for (let i = 0; i < 3; i++) { const x = w * 0.72 + i * 54; ctx.beginPath(); ctx.moveTo(x + 40, 40); ctx.lineTo(x + 54, 40); ctx.lineTo(x + 14, 140); ctx.lineTo(x, 140); ctx.closePath(); ctx.fill(); }
    // Target ring, lower right
    const cx = w * 0.84, cy = h * 0.66;
    ctx.strokeStyle = rgba(p.highlight, 0.35); ctx.lineWidth = 4;
    ctx.beginPath(); ctx.arc(cx, cy, h * 0.26, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = rgba(p.text, 0.18); ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(cx, cy, h * 0.21, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = rgba(p.highlight, 0.6); ctx.lineWidth = 6;
    ctx.beginPath(); ctx.arc(cx, cy, h * 0.26, Math.PI * 1.1, Math.PI * 1.45); ctx.stroke();
    // Hazard strip along the foot
    ctx.save();
    ctx.beginPath(); ctx.rect(0, h - 16, w, 16); ctx.clip();
    ctx.fillStyle = rgba(p.highlight, 0.85);
    for (let x = -40; x < w + 40; x += 48) { ctx.beginPath(); ctx.moveTo(x, h); ctx.lineTo(x + 24, h); ctx.lineTo(x + 40, h - 16); ctx.lineTo(x + 16, h - 16); ctx.closePath(); ctx.fill(); }
    ctx.restore();
    ctx.fillStyle = rgba(p.text, 0.5);
    ctx.fillRect(0, h - 18, w, 2);
}

/** Inked: manga focus lines — tapered ink strokes rushing out from a clear
 *  centre, a hand-ruled double frame, a few ink splatters in the corners. */
function paintInked(ctx, w, h, p, shade, dark) {
    const rnd = seeded(11);
    const ink = p.text;
    ctx.fillStyle = rgba(p.bg, 1);
    ctx.fillRect(0, 0, w, h);
    const cx = w / 2, cy = h / 2, rx = w * 0.27, ry = h * 0.32, reach = w * 0.9;
    for (let i = 0; i < 260; i++) {
        const a = rnd() * Math.PI * 2;
        const start = 1 + rnd() * 0.35, len = 0.55 + rnd() * 0.45;
        const x0 = cx + Math.cos(a) * rx * start, y0 = cy + Math.sin(a) * ry * start;
        const x1 = cx + Math.cos(a) * reach * len, y1 = cy + Math.sin(a) * reach * len;
        const half = (0.8 + rnd() * 2.6);
        const nx = -Math.sin(a) * half, ny = Math.cos(a) * half;
        ctx.fillStyle = rgba(ink, dark ? 0.35 + rnd() * 0.4 : 0.5 + rnd() * 0.45);
        ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1 + nx, y1 + ny); ctx.lineTo(x1 - nx, y1 - ny); ctx.closePath(); ctx.fill();
    }
    // Hand-ruled double frame (a little jitter on every edge)
    const frame = (inset, width, alpha) => {
        ctx.strokeStyle = rgba(ink, alpha); ctx.lineWidth = width; ctx.lineJoin = 'round';
        const j = () => (rnd() - 0.5) * 3;
        const pts = [[inset, inset], [w - inset, inset], [w - inset, h - inset], [inset, h - inset]];
        ctx.beginPath();
        pts.forEach(([x, y], i) => {
            const [nx2, ny2] = pts[(i + 1) % 4];
            if (i === 0) ctx.moveTo(x + j(), y + j());
            for (let t = 0.2; t <= 1.0001; t += 0.2) ctx.lineTo(x + (nx2 - x) * t + j(), y + (ny2 - y) * t + j());
        });
        ctx.closePath(); ctx.stroke();
    };
    frame(22, 7, 0.95);
    frame(36, 2, 0.8);
    // Ink splatters in two corners
    const splat = (x, y, n) => { for (let i = 0; i < n; i++) { const a = rnd() * Math.PI * 2, d = rnd() * rnd() * 90, r = 1 + rnd() * rnd() * 14; ctx.fillStyle = rgba(ink, 0.9); ctx.beginPath(); ctx.arc(x + Math.cos(a) * d, y + Math.sin(a) * d, r, 0, Math.PI * 2); ctx.fill(); } };
    splat(w * 0.1, h * 0.12, 36);
    splat(w * 0.9, h * 0.88, 28);
}

/* ── SillyTavern plumbing ────────────────────────────────────────────────── */

/**
 * @param {string} setup
 * @param {string} theme
 * @param {string} [variant] a palette signature, so a Custom theme gets a
 *   file per set of colours (a named theme's colours are fixed)
 */
function fileNameFor(setup, theme, variant = '') {
    const t = String(theme || 'default').replace(/[^a-z0-9-]/gi, '');
    return `${FILE_PREFIX}${SETUP_LABELS[setup] || setup} (${t}${variant ? '-' + variant : ''}).webp`;
}

/** Six hex characters that change when any of the five colours does. */
function paletteSignature() {
    const str = JSON.stringify(readPalette());
    let h = 5381;
    for (let i = 0; i < str.length; i++) h = ((h * 33) ^ str.charCodeAt(i)) >>> 0;
    return h.toString(16).padStart(8, '0').slice(-6);
}

/** Removes a background file through SillyTavern's own endpoint (best effort). */
async function deleteBackground(name) {
    const res = await fetch('/api/backgrounds/delete', { method: 'POST', headers: getRequestHeaders(), body: JSON.stringify({ bg: name }) });
    if (!res.ok) throw new Error(`background delete failed (${res.status})`);
    try { await getBackgrounds(); } catch (_) { /* list refresh is cosmetic */ }
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
    // The Backgrounds panel marks the global background with this class.
    $('.bg_example').removeClass('selected-background').filter(function () { return $(this).attr('bgfile') === name; }).addClass('selected-background');
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

let runSeq = 0;

async function run(setup, theme) {
    // Only the latest run may touch the background: a run still uploading
    // when the setup changes again (or goes back to Classic) must not land
    // its file afterwards.
    const seq = ++runSeq;
    const live = () => seq === runSeq;
    const enabled = extensionSettings.uiSetupBackground !== false;
    if (!enabled || !SETUP_LABELS[setup]) {
        restorePrevious();
        return;
    }
    const rec = record();
    const current = background_settings.name;
    const fileName = fileNameFor(setup, theme, theme === 'custom' ? paletteSignature() : '');
    // A background the user picked in SillyTavern's own panel while this
    // setup was up is theirs: only our own painting is replaced, unless the
    // setup or theme changed and a different painting is due.
    if (rec.applied === fileName && !isOurs(current)) return;
    // Whatever is up that is not ours is what Classic goes back to.
    if (!isOurs(current)) rec.previousName = current;
    const key = fileName;
    const listedNow = () => $('.bg_example').filter(function () { return $(this).attr('bgfile') === fileName; }).length > 0;
    if (!uploadedThisSession.has(key) && !listedNow()) {
        // At startup the panel may not have been filled yet: refresh the list
        // before deciding to render and upload again.
        try { await getBackgrounds(); } catch (_) { /* the list refresh is cosmetic */ }
        if (!live()) return;
    }
    if (!uploadedThisSession.has(key) || !listedNow()) {
        const blob = await renderBlob(setup);
        if (!live()) return;
        const saved = await upload(blob, fileName);
        if (!live()) return;
        uploadedThisSession.add(key);
        try { await getBackgrounds(); } catch (_) { /* the list refresh is cosmetic */ }
        if (!live()) return;
        setGlobalBackground(saved || fileName);
    } else {
        setGlobalBackground(fileName);
    }
    const superseded = rec.applied;
    rec.applied = fileName;
    saveSettings();
    // A Custom palette's old painting is just clutter once its colours changed.
    if (superseded && superseded !== fileName && isOurs(superseded) && /\(custom-/.test(superseded)) {
        deleteBackground(superseded).catch(() => { });
    }
}
