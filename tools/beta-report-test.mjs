#!/usr/bin/env node
/**
 * Beta report test: the environment lines, the log tails, and a URL that
 * always fits its budget while keeping the end of the logs.
 *
 * Usage:  node tools/beta-report-test.mjs     (from the repo root)
 * Exit:   0 = pass, 1 = failure
 */
import { environmentLines, tailOf, logsForUrl, buildReportText, buildIssueUrl, buildIssueBody, URL_BUDGET, REPO_URL } from '../src/utils/betaReport.js';

let failures = 0;
function check(name, ok, detail = '') {
    if (ok) console.log(`pass  ${name}`);
    else { failures++; console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ''}`); }
}

console.log('\n§1 environmentLines');
{
    const off = environmentLines({ generationMode: 'together' }, { version: '3.1.0-beta.1' });
    check('version and mode', off.includes('DES 3.1.0-beta.1') && off.includes('Generation mode: together'));
    check('everything off by default', off.includes('Vitals: off') && off.includes('Attributes & checks: off'));
    check('default tracker instructions', off.includes('Tracker instructions: default'));
    check('recovery on by default', off.includes('Fetch the tracker when a reply skips it: on'));
    const on = environmentLines({
        generationMode: 'separate',
        customTrackerInstructionsPrompt: 'mine',
        recoverMissingTracker: false,
        showTrackerJsonInChat: true,
        trackerConfig: { presentCharacters: { characterStats: { enabled: true, customStats: [{ id: 'health', name: 'Health', enabled: true }, { id: 'mana', name: 'Mana', enabled: false }] } } },
        attributes: { enabled: true, list: [{ id: 'str', name: 'Strength', abbr: 'STR', enabled: true }], aiCalls: { tool: false, frequency: 'whenUncertain' }, allowOverride: true },
    }, { api: 'openai', userAgent: 'TestBrowser/1' });
    check('custom override named', on.includes('Tracker instructions: custom override'));
    check('vitals on with a count', on.includes('Vitals: on (1 of 2 vitals on, persona on)'), on);
    check('attributes on with the calls line', on.includes('Attributes & checks: on') && on.includes('tool off') && on.includes('whenUncertain'));
    check('override on', on.includes('override on'));
    check('recovery off, dropdown on', on.includes('skips it: off') && on.includes('Tracker data in chat: on'));
    check('api and browser', on.includes('API: openai') && on.includes('Browser: TestBrowser/1'));
    check('no settings at all', environmentLines(null).includes('Vitals: off'));
}

console.log('\n§2 tailOf');
{
    const text = Array.from({ length: 50 }, (_, i) => `line ${i + 1}`).join('\n');
    check('short text untouched', tailOf('a\nb', 100) === 'a\nb');
    const t = tailOf(text, 60);
    check('keeps the end', t.endsWith('line 50'));
    check('starts on a whole line and says what was left out', t.startsWith('…(earlier lines left out') && /\n(line \d+)/.test(t) && !/\nine \d+/.test(t));
    check('zero budget', tailOf(text, 0) === '' && tailOf(undefined, 10) === '');
}

console.log('\n§3 logsForUrl / buildReportText');
{
    const section = logsForUrl('n1\nn2', 's1\ns2', 100);
    check('both logs, headed', section.includes('== Notification Log ==\nn1\nn2') && section.includes('== System Log ==\ns1\ns2'));
    const longN = Array.from({ length: 200 }, (_, i) => `notice ${i}`).join('\n');
    const longS = Array.from({ length: 200 }, (_, i) => `system ${i}`).join('\n');
    const shared = logsForUrl(longN, longS, 1200);
    const nPart = shared.slice(0, shared.indexOf('== System Log =='));
    const sPart = shared.slice(shared.indexOf('== System Log =='));
    check('the System Log gets the larger share', sPart.length > nPart.length * 1.5, `${nPart.length} vs ${sPart.length}`);
    const body = buildIssueBody({ environment: 'ENV', logs: 'LOGS' });
    check('the body has the form\'s sections in order', body.indexOf('### What happened') < body.indexOf('### Environment') && body.indexOf('### Environment') < body.indexOf('### Logs') && body.indexOf('### Logs') < body.indexOf('### Chat export'));
    check('the body carries the environment and the logs in code blocks', body.includes('```text\nENV\n```') && body.includes('```text\nLOGS\n```'));
    const full = buildReportText({ environment: 'E', notifications: 'N', system: 'S' });
    check('the full report has every section in order', full.indexOf('== Environment ==\nE') < full.indexOf('== Notification Log ==\nN') && full.indexOf('== Notification Log ==\nN') < full.indexOf('== System Log ==\nS'));
    check('empty logs are marked', buildReportText({ environment: '', notifications: '', system: '' }).includes('(empty)'));
}

console.log('\n§4 buildIssueUrl');
{
    const small = buildIssueUrl({ environment: 'DES x', logs: 'a few lines' });
    check('points at the issue form', small.url.startsWith(`${REPO_URL}/issues/new?template=stats-beta.yml&title=`));
    check('fields are prefilled', small.url.includes('&environment=DES%20x') && small.url.includes('&logs=a%20few%20lines'));
    check('nothing cut when it fits', !small.truncated && small.logs === 'a few lines');
    const big = Array.from({ length: 2000 }, (_, i) => `[12:00:00] [LOG] [Dooms Tracker] line ${i + 1} with some words in it`).join('\n');
    const r = buildIssueUrl({ environment: 'DES x', logs: big });
    check('a huge log is cut to the budget', r.url.length <= URL_BUDGET, `url ${r.url.length}`);
    check('...and keeps its end', r.logs.endsWith('line 2000 with some words in it') && r.truncated);
    check('...and says so, once', r.logs.startsWith('…(earlier lines left out') && r.logs.split('…(earlier lines left out').length === 2);
    const tiny = buildIssueUrl({ environment: 'DES x', logs: big }, { budget: 300 });
    check('a budget too small for any log still yields a URL', tiny.url.length <= 300 || tiny.logs === '', `url ${tiny.url.length}`);
    check('the environment is never cut', tiny.url.includes('&environment=DES%20x'));
    // body mode: no form on the default branch
    const b = buildIssueUrl({ environment: 'DES x', logs: 'a few lines', mode: 'body' });
    check('body mode points at a plain new issue', b.url.startsWith(`${REPO_URL}/issues/new?title=`) && !b.url.includes('template='));
    const decoded = decodeURIComponent(b.url.slice(b.url.indexOf('&body=') + 6));
    check('body mode carries the sections, the environment and the logs', decoded.includes('### Environment') && decoded.includes('DES x') && decoded.includes('a few lines'));
    check('body mode reports its mode', b.mode === 'body' && !b.truncated);
    const bb = buildIssueUrl({ environment: 'DES x', logs: big, mode: 'body' });
    check('body mode fits the budget with a huge log', bb.url.length <= URL_BUDGET, `url ${bb.url.length}`);
    check('...and keeps the log\'s end', bb.logs.endsWith('line 2000 with some words in it') && bb.truncated);
    check('...and the environment', decodeURIComponent(bb.url).includes('DES x'));
}

console.log('');
if (failures) { console.log(`${failures} beta report check(s) failed`); process.exit(1); }
console.log('All beta report checks pass');
