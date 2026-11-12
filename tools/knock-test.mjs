#!/usr/bin/env node
/**
 * The knock (docs/long-shot-plan.md D201): what counts as a tap, and when
 * taps make the three that hide the Doom button or bring it back.
 *
 * Usage:  node tools/knock-test.mjs     (from the repo root)
 * Exit:   0 = pass, 1 = failure
 */
import { KNOCK, isTap, knockCounter } from '../src/utils/knock.js';

let failures = 0;
const check = (label, cond, extra = '') => {
    if (cond) console.log(`pass  ${label}`);
    else { console.error(`FAIL  ${label}${extra ? '\n      ' + extra : ''}`); failures++; }
};
const taps = (c, list) => list.map(([t, x = 100, y = 100]) => c.tap({ t, x, y }));

check('a short press that did not move is a tap', isTap({ t: 0, x: 10, y: 10 }, { t: 90, x: 12, y: 11 }) === true);
check('a press held is not a tap, nor one that moved (a scroll, a drag), nor half of one', isTap({ t: 0, x: 10, y: 10 }, { t: KNOCK.holdMs + 1, x: 10, y: 10 }) === false && isTap({ t: 0, x: 10, y: 10 }, { t: 90, x: 10, y: 10 + KNOCK.slop + 1 }) === false && isTap(null, { t: 1, x: 0, y: 0 }) === false && isTap({ t: 5, x: 0, y: 0 }, null) === false);

{
    const c = knockCounter();
    check('three quick taps in one spot are a knock, on the third', JSON.stringify(taps(c, [[0], [150], [300]])) === '[false,false,true]' && c.count() === 0);
}
{
    const c = knockCounter();
    check('two taps are not one', JSON.stringify(taps(c, [[0], [150]])) === '[false,false]' && c.count() === 2);
    check('a third that comes too late is the first of a new count', c.tap({ t: 150 + KNOCK.gapMs + 1, x: 100, y: 100 }) === false && c.count() === 1);
}
{
    const c = knockCounter();
    check('taps at the edge of the wait still count', JSON.stringify(taps(c, [[0], [KNOCK.gapMs], [KNOCK.gapMs * 2]])) === '[false,false,true]');
}
{
    const c = knockCounter();
    check('a tap far from the first starts the count again with itself', JSON.stringify(taps(c, [[0, 100, 100], [100, 100, 100], [200, 100 + KNOCK.radius + 1, 100]])) === '[false,false,false]' && c.count() === 1);
    check('taps near enough to the first count, however they wander inside that', JSON.stringify(taps(knockCounter(), [[0, 100, 100], [100, 130, 110], [200, 80, 120]])) === '[false,false,true]');
}
{
    const c = knockCounter();
    check('six quick taps are two knocks: put away, brought back', JSON.stringify(taps(c, [[0], [100], [200], [300], [400], [500]])) === '[false,false,true,false,false,true]');
}
{
    const c = knockCounter();
    taps(c, [[0], [100]]);
    c.reset();
    check('a count let go (a tap on a button in between) starts from nothing', c.count() === 0 && JSON.stringify(taps(c, [[200], [300]])) === '[false,false]');
    check('a clock that ran backwards does not make a knock', knockCounter().tap({ t: 500, x: 0, y: 0 }) === false && (() => { const k = knockCounter(); k.tap({ t: 500, x: 0, y: 0 }); k.tap({ t: 400, x: 0, y: 0 }); return k.count() === 1; })());
    check('four taps asked for are four', JSON.stringify(taps(knockCounter({ ...KNOCK, taps: 4 }), [[0], [100], [200], [300]])) === '[false,false,false,true]');
}

console.log(failures === 0 ? '\nAll knock checks pass' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
