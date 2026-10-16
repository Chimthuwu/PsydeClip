/**
 * Drive the REAL compiled `handOverToPopout` against real Electron windows.
 *
 * The rule for *when* to hand over is unit-tested (src/shared/window-mode.test.ts);
 * this covers the part unit tests cannot: that a pop-out window actually opens,
 * takes the bounds it was given, and reports itself open afterwards — the
 * plumbing behind "shrink the window and the pop-out takes over".
 *
 *   electron scripts/verify-shrink-popout.js
 */
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const { app } = require('electron');

// Its own userData dir, so a running copy of the app is left alone (and the
// single-instance lock does not shoot this down).
const tmpUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'psydeclip-shrink-'));
app.setPath('userData', tmpUserData);

// Closing the pop-out at the end would otherwise quit the app before the
// last check and the summary are printed.
app.on('window-all-closed', () => {});

let pass = 0;
let fail = 0;
function check(name, ok, detail = '') {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  [' + detail + ']' : ''}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  const popout = require(path.join(__dirname, '..', 'dist', 'main', 'popout.js'));
  const { readSettings, writeSettings } = require(path.join(__dirname, '..', 'dist', 'main', 'settings.js'));
  const { DEFAULT_SETTINGS, AUTO_POPOUT_HEIGHT } = require(path.join(__dirname, '..', 'dist', 'shared', 'types.js'));
  const { shouldHandOverToPopout } = require(path.join(__dirname, '..', 'dist', 'shared', 'window-mode.js'));

  check('the shrink setting ships on', DEFAULT_SETTINGS.autoPopoutWhenSmall === true);
  check('no pop-out before the hand-over', popout.isPopoutOpen() === false);

  // The bounds a shrunk main window would be handing over.
  const bounds = { x: 220, y: 160, width: 900, height: 120 };
  check(
    'those bounds do count as too small',
    shouldHandOverToPopout({
      height: bounds.height,
      autoPopoutWhenSmall: true,
      popoutOpen: false,
      visible: true,
    }) === true,
    `${bounds.height}px vs ${AUTO_POPOUT_HEIGHT}px`,
  );

  let settingsSeen = null;
  popout.handOverToPopout({
    onClosed: () => {},
    onSettingsChanged: (s) => {
      settingsSeen = s;
    },
    bounds,
  });

  await sleep(1200);

  const win = popout.getPopout();
  check('a pop-out window exists', !!win && !win.isDestroyed());
  check('it reports itself open', popout.isPopoutOpen() === true);
  check('popoutOpen was persisted', settingsSeen?.popoutOpen === true && readSettings().popoutOpen === true);

  const got = win ? win.getBounds() : null;
  check(
    'it took the shrunk window’s place',
    !!got && Math.abs(got.x - bounds.x) <= 2 && Math.abs(got.y - bounds.y) <= 2,
    got ? `${got.x},${got.y} ${got.width}x${got.height}` : 'no window',
  );
  check('and its width', !!got && Math.abs(got.width - bounds.width) <= 2, got ? `${got.width}px` : '');
  check('it is visible', !!win && win.isVisible());

  // Calling it again must not stack a second window on top.
  popout.handOverToPopout({ onClosed: () => {}, onSettingsChanged: () => {}, bounds });
  await sleep(400);
  const { BrowserWindow } = require('electron');
  check(
    'a second hand-over does not open a second window',
    BrowserWindow.getAllWindows().length === 1,
    `${BrowserWindow.getAllWindows().length} window(s)`,
  );

  popout.destroyPopout();
  await sleep(300);
  check('destroying it closes the window', popout.isPopoutOpen() === false);

  writeSettings({ ...readSettings(), popoutOpen: false });
  console.log(`\n  ${pass}/${pass + fail} checks passed`);
  app.exit(fail ? 1 : 0);
});
