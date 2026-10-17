#!/usr/bin/env node
/**
 * Beta report test: the environment lines, the condensed log tails, the
 * file name, and a URL that always fits GitHub's measured budget while
 * keeping the end of the System Log and the line that says where the whole
 * log is.
 *
 * Usage:  node tools/beta-report-test.mjs     (from the repo root)
 * Exit:   0 = pass, 1 = failure
 */
import {
    environmentLines, condenseForUrl, tailOf, logsForUrl, buildReportText, buildIssueBody, buildIssueUrl,
    reportFileName, URL_BUDGET, REPO_URL, LEFT_OUT_LINE,
} from '../src/utils/betaReport.js';

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

console.log('\n§2 condenseForUrl / tailOf');
{
    const trace = '[12:00:00.000] [ERROR] [unbranded] TypeError: boom\n    at a (x.js:1:1)\n    at b (y.js:2:2)\n    at c (z.js:3:3)\n[12:00:01.000] [LOG] [Dooms Tracker] next';
    const c = condenseForUrl(trace);
    check('stack frames fold to one line with a count', c.includes('… 3 stack frames (in the report file)') && !c.includes('at b (y.js'));
    check('the entries around them survive', c.startsWith('[12:00:00.000] [ERROR]') && c.endsWith('[Dooms Tracker] next'));
    check('a single frame reads singular', condenseForUrl('x\n    at only (f.js:1:1)').includes('1 stack frame '));
    check('text without frames is unchanged', condenseForUrl('a\nb') === 'a\nb' && condenseForUrl('') === '');
    const entries = Array.from({ length: 60 }, (_, i) => `[12:${String(i).padStart(2, '0')}:00.000] [LOG] [Dooms Tracker] line ${i}`).join('\n');
    check('short text untouched', tailOf('a\nb', 100) === 'a\nb');
    const t = tailOf(entries, 200);
    check('keeps the end', t.endsWith('line 59'));
    check('opens on a whole entry', t.startsWith(LEFT_OUT_LINE + '\n[12:'), t.slice(0, 120));
    const mixed = 'first line\nsecond line\nthird line';
    const tm = tailOf(mixed, 15);
    check('falls back to a whole line when there is no entry mark', tm === `${LEFT_OUT_LINE}\nthird line`, tm);
    check('zero budget', tailOf(entries, 0) === '' && tailOf(undefined, 10) === '');
}

console.log('\n§3 logsForUrl / buildReportText / reportFileName');
{
    const section = logsForUrl('n1\nn2', 's1\ns2', 100);
    check('both logs, headed', section.includes('== Notification Log ==\nn1\nn2') && section.includes('== System Log ==\ns1\ns2'));
    const longN = Array.from({ length: 200 }, (_, i) => `[1] notice ${i}`).join('\n');
    const longS = Array.from({ length: 200 }, (_, i) => `[2] system ${i}`).join('\n');
    const shared = logsForUrl(longN, longS, 1200);
    const nPart = shared.slice(0, shared.indexOf('== System Log =='));
    const sPart = shared.slice(shared.indexOf('== System Log =='));
    check('the System Log gets the larger share', sPart.length > nPart.length * 1.5, `${nPart.length} vs ${sPart.length}`);
    const alone = logsForUrl('(no notifications captured)', longS, 1200);
    const aloneSys = alone.slice(alone.indexOf('== System Log =='));
    check('no notifications: the System Log gets all the room', alone.includes('(none since the page loaded)') && aloneSys.length > sPart.length * 1.3, `${sPart.length} vs ${aloneSys.length}`);
    check('an empty notification text counts as none', logsForUrl('', longS, 300).includes('(none since the page loaded)'));
    const full = buildReportText({ environment: 'E', notifications: 'N', system: 'S' });
    check('the full report has every section in order', full.indexOf('== Environment ==\nE') < full.indexOf('== Notification Log ==\nN') && full.indexOf('== Notification Log ==\nN') < full.indexOf('== System Log ==\nS'));
    check('empty logs are marked', buildReportText({ environment: '', notifications: '', system: '' }).includes('(empty)'));
    const name = reportFileName(new Date('2026-10-17T21:07:41.861Z'));
    check('the file name carries the moment, safe for every file system', name === 'des-beta-report-2026-10-17T21-07-41.txt', name);
    const body = buildIssueBody({ environment: 'ENV', logs: 'LOGS', fileName: name });
    check('the body has the form\'s sections in order', body.indexOf('### What happened') < body.indexOf('### Environment') && body.indexOf('### Environment') < body.indexOf('### Logs') && body.indexOf('### Logs') < body.indexOf('### Chat export'));
    check('the body carries the environment and the logs in code blocks', body.includes('```text\nENV\n```') && body.includes('```text\nLOGS\n```'));
    check('the body names the file to drag in', body.includes(`saved to your Downloads as ${name}: drag that file into this issue`));
    check('without a file, the body points at the clipboard', buildIssueBody({ environment: 'E', logs: 'L' }).includes('is on your clipboard'));
}

console.log('\n§4 buildIssueUrl');
{
    const small = buildIssueUrl({ environment: 'DES x', logs: 'a few lines', fileName: 'r.txt' });
    check('points at the issue form', small.url.startsWith(`${REPO_URL}/issues/new?template=stats-beta.yml&title=`));
    check('fields are prefilled, the file named first in the logs box', small.url.includes('&environment=DES%20x') && decodeURIComponent(small.url).includes('saved to your Downloads as r.txt') && small.url.includes('a%20few%20lines'));
    check('nothing cut when it fits', !small.truncated && small.logs === 'a few lines');
    const big = Array.from({ length: 2000 }, (_, i) => `[12:00:00.000] [LOG] [Dooms Tracker] line ${i + 1} with some words in it`).join('\n');
    const r = buildIssueUrl({ environment: 'DES x', logs: big, fileName: 'r.txt' });
    check('a huge log is cut to the budget', r.url.length <= URL_BUDGET, `url ${r.url.length}`);
    check('...and keeps its end', r.logs.endsWith('line 2000 with some words in it') && r.truncated);
    check('...and says so, once, opening on a whole entry', r.logs.startsWith(LEFT_OUT_LINE + '\n[12:') && r.logs.split(LEFT_OUT_LINE).length === 2);
    check('...and fills most of the budget', r.url.length > URL_BUDGET * 0.8, `url ${r.url.length}`);
    const tiny = buildIssueUrl({ environment: 'DES x', logs: big }, { budget: 400 });
    check('a budget too small for any log still yields a URL', tiny.url.length <= 400 || tiny.logs === '', `url ${tiny.url.length}`);
    check('the environment is never cut', tiny.url.includes('&environment=DES%20x'));
    // body mode: no form on the default branch
    const b = buildIssueUrl({ environment: 'DES x', logs: 'a few lines', mode: 'body', fileName: 'r.txt' });
    check('body mode points at a plain new issue', b.url.startsWith(`${REPO_URL}/issues/new?title=`) && !b.url.includes('template='));
    const decoded = decodeURIComponent(b.url.slice(b.url.indexOf('&body=') + 6));
    check('body mode carries the sections, the environment, the logs and the file name', decoded.includes('### Environment') && decoded.includes('DES x') && decoded.includes('a few lines') && decoded.includes('r.txt'));
    check('body mode reports its mode', b.mode === 'body' && !b.truncated);
    const bb = buildIssueUrl({ environment: 'DES x', logs: big, mode: 'body', fileName: 'r.txt' });
    check('body mode fits the budget with a huge log', bb.url.length <= URL_BUDGET, `url ${bb.url.length}`);
    check('...and keeps the log\'s end', bb.logs.endsWith('line 2000 with some words in it') && bb.truncated);
    check('...and the environment and the file name', decodeURIComponent(bb.url).includes('DES x') && decodeURIComponent(bb.url).includes('r.txt'));
}

console.log('');
if (failures) { console.log(`${failures} beta report check(s) failed`); process.exit(1); }
console.log('All beta report checks pass');
