/**
 * Idle Resource Manager
 *
 * Makes the extension pull essentially no CPU/GPU while the chat sits idle.
 *
 * DES has no polling loops (no setInterval, no persistent requestAnimationFrame
 * loops) — the only thing that keeps running while nothing is happening is a set
 * of *infinite* CSS animations: weather particles, snowflakes, portrait/thought
 * pulses, the scene-tracker ticker scroll, glow rings, etc. Those keep the
 * compositor busy every frame even when the user has stepped away.
 *
 * This manager watches for user activity (mouse, keyboard, touch, scroll) and
 * tab visibility. When the user stops interacting — or the tab is backgrounded —
 * it adds a single `dooms-idle` class to <body>. A CSS rule then sets
 * `animation-play-state: paused` on every DES-owned animated element, so the
 * browser stops ticking them entirely. Any activity (or the tab regaining
 * focus) removes the class and everything resumes instantly.
 *
 * No timer or loop runs while idle — the only cost is a handful of throttled,
 * passive event listeners.
 */
import { extensionSettings } from './state.js';

const IDLE_CLASS = 'dooms-idle';
const DEFAULT_TIMEOUT_SECONDS = 60;

// While awake we only need to know that *something* happened to reset the
// countdown — there's no value in processing every single mousemove, so reset
// at most once per second to keep the listeners cheap.
const ACTIVITY_THROTTLE_MS = 1000;

// Capture-phase, passive listeners so we observe activity anywhere in the page
// without interfering with SillyTavern's own handlers.
const ACTIVITY_EVENTS = [
    'mousedown',
    'mousemove',
    'keydown',
    'wheel',
    'touchstart',
    'touchmove',
    'scroll',
    'pointerdown',
];

let idleTimer = null;
let lastActivity = 0;
let idle = false;
let started = false;

function timeoutMs() {
    const secs = Number(extensionSettings.idleTimeoutSeconds);
    return (Number.isFinite(secs) && secs > 0 ? secs : DEFAULT_TIMEOUT_SECONDS) * 1000;
}

function goIdle() {
    if (idle) return;
    idle = true;
    document.body.classList.add(IDLE_CLASS);
}

function scheduleIdle() {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(goIdle, timeoutMs());
}

function wake() {
    if (idle) {
        idle = false;
        document.body.classList.remove(IDLE_CLASS);
    }
    scheduleIdle();
}

function onActivity() {
    const now = Date.now();
    // When already awake, throttle the countdown reset. When idle, always wake
    // immediately so the first interaction resumes everything with no delay.
    if (!idle && now - lastActivity < ACTIVITY_THROTTLE_MS) return;
    lastActivity = now;
    wake();
}

function onVisibilityChange() {
    if (document.hidden) {
        // Tab backgrounded — pause right away rather than waiting out the timer.
        if (idleTimer) {
            clearTimeout(idleTimer);
            idleTimer = null;
        }
        goIdle();
    } else {
        wake();
    }
}

/**
 * Begin watching for activity and pausing DES animations while idle.
 * Honours the `pauseWhenIdle` setting (default on). Safe to call repeatedly.
 */
export function initIdleManager() {
    if (started) return;
    if (extensionSettings.pauseWhenIdle === false) return;
    started = true;

    ACTIVITY_EVENTS.forEach(evt =>
        window.addEventListener(evt, onActivity, { passive: true, capture: true })
    );
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('focus', wake);

    // If we're already hidden at startup, idle immediately; otherwise start the
    // countdown so a freshly-loaded-but-untouched tab still settles into idle.
    if (document.hidden) goIdle();
    else scheduleIdle();
}

/**
 * Tear everything down and ensure animations are resumed.
 */
export function stopIdleManager() {
    if (!started) return;
    started = false;

    ACTIVITY_EVENTS.forEach(evt =>
        window.removeEventListener(evt, onActivity, { capture: true })
    );
    document.removeEventListener('visibilitychange', onVisibilityChange);
    window.removeEventListener('focus', wake);

    if (idleTimer) {
        clearTimeout(idleTimer);
        idleTimer = null;
    }
    if (idle) {
        idle = false;
        document.body.classList.remove(IDLE_CLASS);
    }
}

/**
 * Whether the extension is currently in its idle (animations-paused) state.
 */
export function isExtensionIdle() {
    return idle;
}
