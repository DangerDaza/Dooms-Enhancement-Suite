/**
 * The Doom button, SillyTavern's top bar and the ways back into DES's
 * settings (3.1.3, D58). Pure.
 *
 * The rule: there is always a way in. SillyTavern's top bar is hidden only
 * while the Doom button stands in for it with Doom's Settings in its
 * fly-out; the Doom button may be hidden only while the top bar shows; the
 * extension switched off brings the top bar back. A stored combination that
 * breaks the rule (saved by an older version, or edited by hand) is repaired
 * on load, and `/des reset` puts everything back from the chat box.
 */

/** The fly-out entry that opens Doom's Settings. */
export const SETTINGS_ITEM = 'des-settings';

/** The Doom button settings read safely from the extension's settings object. */
export function fabState(settings) {
    const s = settings && typeof settings === 'object' ? settings : {};
    const fab = s.fab && typeof s.fab === 'object' ? s.fab : {};
    const hiddenButtons = Array.isArray(fab.hiddenButtons) ? fab.hiddenButtons.filter(x => typeof x === 'string') : [];
    return {
        enabled: s.enabled !== false,
        hidden: fab.hidden === true,
        hideStTopBar: fab.hideStTopBar === true,
        bypassFlyout: fab.bypassFlyout === true,
        hiddenButtons,
    };
}

/** Whether SillyTavern's top bar is hidden now: the extension on, the setting on, and the Doom button showing. */
export function topBarHidden(settings) {
    const f = fabState(settings);
    return f.enabled && f.hideStTopBar && !f.hidden;
}

/** Whether a fly-out entry may be hidden: Doom's Settings stays while the top bar is hidden. */
export function canHideFlyoutItem(settings, id) {
    return !(id === SETTINGS_ITEM && topBarHidden(settings));
}

/**
 * A stored shape that would leave no way in, repaired: the top bar hidden
 * with the Doom button hidden (the bar comes back), or with Doom's Settings
 * out of the fly-out (the entry comes back). Returns a fresh fab object and
 * what was changed; the input is not mutated.
 * @returns {{ fab: object, changed: boolean, why: string[] }}
 */
export function repairFabSettings(settings) {
    const f = fabState(settings);
    const source = settings && settings.fab && typeof settings.fab === 'object' ? settings.fab : {};
    const fab = { ...source, hiddenButtons: [...f.hiddenButtons] };
    const why = [];
    if (f.hideStTopBar && f.hidden) {
        fab.hideStTopBar = false;
        why.push('the top bar cannot be hidden while the Doom button is hidden');
    }
    if (f.hideStTopBar && !f.hidden && f.hiddenButtons.includes(SETTINGS_ITEM)) {
        fab.hiddenButtons = fab.hiddenButtons.filter(x => x !== SETTINGS_ITEM);
        why.push("Doom's Settings stays in the fly-out while the top bar is hidden");
    }
    return { fab, changed: why.length > 0, why };
}

/** The rescue (`/des reset`): the Doom button shown, the top bar shown, every fly-out entry back, the click opening the fly-out. */
export function rescuedFabSettings(settings) {
    const source = settings && settings.fab && typeof settings.fab === 'object' ? settings.fab : {};
    return { ...source, hidden: false, hideStTopBar: false, hiddenButtons: [], bypassFlyout: false };
}
