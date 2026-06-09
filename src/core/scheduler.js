/**
 * Render Scheduler
 *
 * Batches DOM work into one requestAnimationFrame flush per frame so that
 * multiple events landing in the same frame (e.g. MESSAGE_UPDATED +
 * SETTINGS_UPDATED) collapse into a single render, and so reads never
 * interleave with writes (which forces synchronous reflow).
 *
 * Usage:
 *   schedule('portraitBar', () => renderPortraitBar());            // write job
 *   schedule('measure:hud', () => measureHud(), 'read');           // read job
 *   flush();                                                       // sync flush (CHAT_CHANGED)
 *   onIdle('cleanup', () => pruneCaches(), 2000);                  // idle job
 *
 * Jobs are deduped by key: scheduling the same key twice in one frame keeps
 * only the latest job. All 'read' jobs run before all 'write' jobs.
 */

const readJobs = new Map();
const writeJobs = new Map();
let rafHandle = null;

function runJobs() {
    rafHandle = null;
    // Snapshot then clear so jobs can re-schedule for the NEXT frame.
    const reads = [...readJobs.values()];
    const writes = [...writeJobs.values()];
    readJobs.clear();
    writeJobs.clear();
    for (const job of reads) {
        try { job(); } catch (e) { console.error('[Dooms Scheduler] read job failed:', e); }
    }
    for (const job of writes) {
        try { job(); } catch (e) { console.error('[Dooms Scheduler] write job failed:', e); }
    }
}

/**
 * Schedule a job for the next animation frame, deduped by key.
 * @param {string} key - Dedupe key; the latest job scheduled under a key wins.
 * @param {Function} job - The work to run.
 * @param {'read'|'write'} [phase='write'] - Reads run before writes within a flush.
 */
export function schedule(key, job, phase = 'write') {
    (phase === 'read' ? readJobs : writeJobs).set(key, job);
    if (rafHandle === null) {
        rafHandle = requestAnimationFrame(runJobs);
    }
}

/**
 * Cancel a pending job in both phases.
 * @param {string} key
 */
export function cancel(key) {
    readJobs.delete(key);
    writeJobs.delete(key);
}

/**
 * Run all pending jobs synchronously. Used when subsequent code depends on the
 * DOM being up to date (e.g. CHAT_CHANGED full re-render before measurements).
 */
export function flush() {
    if (rafHandle !== null) {
        cancelAnimationFrame(rafHandle);
    }
    runJobs();
}

const idleJobs = new Map();

/**
 * Schedule low-priority work for browser idle time, deduped by key.
 * Falls back to setTimeout where requestIdleCallback is unavailable.
 * @param {string} key
 * @param {Function} job
 * @param {number} [timeout=1000] - Max delay before the job runs anyway.
 */
export function onIdle(key, job, timeout = 1000) {
    if (idleJobs.has(key)) {
        const prev = idleJobs.get(key);
        if (prev.type === 'idle' && window.cancelIdleCallback) {
            cancelIdleCallback(prev.id);
        } else if (prev.type === 'timeout') {
            clearTimeout(prev.id);
        }
    }
    const run = () => {
        idleJobs.delete(key);
        try { job(); } catch (e) { console.error('[Dooms Scheduler] idle job failed:', e); }
    };
    if (window.requestIdleCallback) {
        idleJobs.set(key, { type: 'idle', id: requestIdleCallback(run, { timeout }) });
    } else {
        idleJobs.set(key, { type: 'timeout', id: setTimeout(run, Math.min(timeout, 200)) });
    }
}
