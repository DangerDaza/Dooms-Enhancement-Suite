#!/usr/bin/env node
/**
 * The Doom button guard (3.1.3, D58): the top bar hides only while the
 * button stands in for it, the button hides only while the bar shows, the
 * extension off brings the bar back, a broken stored shape is repaired.
 *
 * Usage:  node tools/fab-guard-test.mjs     (from the repo root)
 * Exit:   0 = pass, 1 = failure
 */
import { fabState, topBarHidden, canHideFlyoutItem, repairFabSettings, rescuedFabSettings, SETTINGS_ITEM } from '../src/utils/fabGuard.js';

let failures = 0;
const check = (label, cond, extra = '') => {
    if (cond) console.log(`pass  ${label}`);
    else { console.error(`FAIL  ${label}${extra ? '\n      ' + extra : ''}`); failures++; }
};

check('nothing stored reads as the defaults', JSON.stringify(fabState(undefined)) === JSON.stringify({ enabled: true, hidden: false, hideStTopBar: false, bypassFlyout: false, hiddenButtons: [] }) && JSON.stringify(fabState({ fab: 'nope' }).hiddenButtons) === '[]');
check('odd entries in the hidden list are dropped', fabState({ fab: { hiddenButtons: ['a', 3, null, 'b'] } }).hiddenButtons.join() === 'a,b');
check('the top bar hides only with the extension on, the setting on and the button showing', topBarHidden({ enabled: true, fab: { hideStTopBar: true } }) === true && topBarHidden({ enabled: false, fab: { hideStTopBar: true } }) === false && topBarHidden({ enabled: true, fab: { hideStTopBar: true, hidden: true } }) === false && topBarHidden({ enabled: true, fab: { hideStTopBar: false } }) === false && topBarHidden({}) === false);
check("Doom's Settings cannot leave the fly-out while the top bar is hidden; anything else can", canHideFlyoutItem({ enabled: true, fab: { hideStTopBar: true } }, SETTINGS_ITEM) === false && canHideFlyoutItem({ enabled: true, fab: { hideStTopBar: false } }, SETTINGS_ITEM) === true && canHideFlyoutItem({ enabled: true, fab: { hideStTopBar: true } }, 'extensions') === true);
const both = { enabled: true, fab: { hideStTopBar: true, hidden: true, hiddenButtons: ['x'], bypassFlyout: true } };
const r1 = repairFabSettings(both);
check('the bar hidden with the button hidden: the bar comes back, the rest stands, the input is untouched', r1.changed && r1.fab.hideStTopBar === false && r1.fab.hidden === true && r1.fab.bypassFlyout === true && r1.fab.hiddenButtons.join() === 'x' && both.fab.hideStTopBar === true && r1.why.length === 1);
const noWayIn = { enabled: true, fab: { hideStTopBar: true, hiddenButtons: ['extensions', SETTINGS_ITEM] } };
const r2 = repairFabSettings(noWayIn);
check("the bar hidden with Doom's Settings out of the fly-out: the entry comes back, the other stays out", r2.changed && r2.fab.hideStTopBar === true && r2.fab.hiddenButtons.join() === 'extensions' && noWayIn.fab.hiddenButtons.length === 2);
check('a sound shape is left alone', repairFabSettings({ enabled: true, fab: { hideStTopBar: true, hiddenButtons: ['extensions'] } }).changed === false && repairFabSettings({ enabled: true, fab: { hidden: true } }).changed === false && repairFabSettings({}).changed === false && repairFabSettings(undefined).changed === false);
check('the extension off is no reason to rewrite the stored setting: the applier already shows the bar', repairFabSettings({ enabled: false, fab: { hideStTopBar: true } }).changed === false);
const rescued = rescuedFabSettings({ fab: { hideStTopBar: true, hidden: true, hiddenButtons: ['a'], bypassFlyout: true, other: 1 } });
check('the rescue shows the button and the bar, restores the fly-out and keeps unrelated keys', rescued.hidden === false && rescued.hideStTopBar === false && rescued.hiddenButtons.length === 0 && rescued.bypassFlyout === false && rescued.other === 1 && rescuedFabSettings(undefined).hidden === false);

console.log(failures === 0 ? '\nAll Doom button guard checks pass' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
