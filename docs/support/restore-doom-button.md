# Locked out of Doom's settings: the top bar and the Doom button are gone

Before 3.1.3-beta.1, two settings could be combined so that nothing on
screen led back into Doom's Enhancement Suite's settings: **Hide
SillyTavern top bar** (Settings → Doom Button) together with the Doom
button's fly-out losing its Doom's Settings entry, or the extension being
switched off while the bar was hidden. From 3.1.3 that cannot happen
(the bar hides only while the Doom button shows with Doom's Settings in
its fly-out, and `/des reset` undoes it all from the chat box). Anyone on
an older version who is already stuck can get out like this.

## In the browser, SillyTavern running (the usual way)

1. Click once on the SillyTavern page so it has focus.
2. Open the browser's developer tools: F12 (or Ctrl+Shift+I) on Windows
   and Linux, Cmd+Option+I on a Mac. In Safari: Develop → Show JavaScript
   Console (switch the Develop menu on under Safari → Settings → Advanced).
3. Click the **Console** tab.
4. Paste the script below into the line at the bottom and press Enter.
   Chrome and Firefox may ask you to type `allow pasting` first; do that,
   press Enter, then paste again.
5. The console prints "DES: top bar and doom button restored" and the page
   reloads itself after three seconds, with the top bar and the button back.

```js
(() => {
  const ctx = SillyTavern.getContext();
  const all = ctx.extensionSettings;
  const keys = Object.keys(all).filter(k => k.startsWith('third-party/') && all[k] && typeof all[k] === 'object'
    && ('fab' in all[k] || /dooms|enhancement|rpg-companion/i.test(k)));
  if (!keys.length) { console.log('DES settings not found. Keys:', Object.keys(all)); return; }
  for (const k of keys) {
    const s = all[k];
    s.enabled = true;
    s.fab = Object.assign({}, s.fab, { hidden: false, hideStTopBar: false, hiddenButtons: [], bypassFlyout: false });
    delete s.fabPosition;
    console.log('DES: top bar and doom button restored under', k);
  }
  document.body.classList.remove('dooms-hide-st-topbar');
  ['#top-bar', '#top-settings-holder', '#extensionTopBar'].forEach(sel =>
    document.querySelectorAll(sel).forEach(el => { el.style.display = ''; }));
  ctx.saveSettingsDebounced();
  setTimeout(() => location.reload(), 3000);
})();
```

It switches the extension on, shows the top bar, restores every fly-out
entry and puts the Doom button back in its default corner. Nothing else in
the settings is touched. SillyTavern does not need to be restarted.

If the console prints "DES settings not found", copy the list of keys it
shows and send it with your report: the extension is installed under a
folder name the script did not expect.

## Without a console (a phone, or a locked-down browser)

Stop SillyTavern. Open `data/default-user/settings.json` in a text editor,
find `"hideStTopBar": true` and change `true` to `false`, save, start
SillyTavern again. (It has to be stopped: SillyTavern rewrites that file
whenever the page saves settings.)

## From 3.1.3-beta.1 on

Type `/des reset` in the chat box. It brings back the top bar, the Doom
button and its fly-out, and `/des` alone opens the settings.

## The D stays after Show the Doom button is switched off

Hard-reload the page first (Ctrl+Shift+R; Cmd+Shift+R on a Mac). A browser,
or a CDN in front of a hosted SillyTavern, can keep an older copy of the
extension's scripts after an update: the new switch then renders from the
fresh settings template and does nothing, with no error anywhere. From
3.1.4-beta.1 DES notices this and says so when the page loads, and the
diagnostic bundle (Settings → Stats → Report a problem) prints both the
version on the server and the version running in the browser.

If the versions match and the D still shows, look at SillyTavern's Custom
CSS for a line on `dooms-settings-fab` (a `display: block !important` there
outranked the 3.1.3 hide rule; 3.1.4 hides the button inline, which nothing
in a stylesheet outranks) and at the `third-party` folder for a second copy
of the extension.
