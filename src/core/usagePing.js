/**
 * Anonymous daily usage ping.
 *
 * Sends ONE empty HTTP GET per day to a 1-byte GitHub release asset.
 * GitHub publicly counts asset downloads; the day-over-day delta of that
 * counter is the daily active user count. That is the entire mechanism:
 *
 *   - No payload, no install ID, no cookies — the request carries nothing
 *     but a standard GET, exactly like the GitHub star-count fetch the
 *     extension already performs.
 *   - The maintainer sees ONLY a single public integer
 *     (the asset's download_count) — never IPs, never per-user anything.
 *   - Deduped to once per day per browser via localStorage.
 *   - Opt-out: the "Anonymous usage ping" toggle in Advanced settings
 *     (usagePingOptOut). Honored before any request is made.
 *
 * Hardware guidelines: scheduled to idle, fires at most one no-cors GET
 * per day, no timers or listeners persist.
 */
import { extensionSettings } from '../core/state.js';

const PING_URL = 'https://github.com/DangerDaza/Dooms-Enhancement-Suite/releases/download/usage-ping/ping';
const STORAGE_KEY = 'dooms-usage-ping-date';

export function sendDailyUsagePing() {
    try {
        if (extensionSettings.usagePingOptOut) return;
        const today = new Date().toISOString().slice(0, 10);
        if (localStorage.getItem(STORAGE_KEY) === today) return;
        // no-cors: the response is opaque (we don't read anything back);
        // cache: no-store so the request actually reaches GitHub's counter.
        fetch(`${PING_URL}?d=${today}`, { mode: 'no-cors', cache: 'no-store' })
            .then(() => localStorage.setItem(STORAGE_KEY, today))
            .catch(() => { /* offline — try again next load */ });
    } catch (e) { /* never let the ping interfere with anything */ }
}
