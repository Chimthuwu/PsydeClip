// Verify the updated landing page renders with the owner-supplied real
// screenshots, the 4.1.2 version badge, and no regressions. Same harness idea
// as verify-landing.mjs; uses a default electron import (named imports fail
// under node's ESM loader for the CJS electron module).
import electronCjs from 'electron';
import { createRequire } from 'node:module';

// marketing-site has no electron dependency; resolve the parent repo's one
// (same host as the app's own verify:* scripts use).
const require = createRequire(import.meta.url);
const electron = electronCjs ?? require('electron');
const { app, BrowserWindow } = typeof electron === 'string' ? require('electron') : electron;
const URL = process.argv[2] || 'http://localhost:4173/';
const checks = [];
const errors = [];

function check(name, ok, detail = '') {
  checks.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  [${detail}]` : ''}`);
}

app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1400,
    height: 1000,
    show: false,
    webPreferences: { offscreen: false },
  });

  win.webContents.on('console-message', (_e, level, message) => {
    if (level >= 2 && !/Electron Security Warning/.test(message)) errors.push(message);
  });
  win.webContents.on('did-fail-load', (_e, code, desc, url) => {
    errors.push(`did-fail-load ${code} ${desc} ${url}`);
  });

  await win.loadURL(URL);
  await new Promise((r) => setTimeout(r, 2000));
  await win.webContents.executeJavaScript(
    "document.querySelector('#themes')?.scrollIntoView(); window.scrollBy(0, -80);",
  );
  await new Promise((r) => setTimeout(r, 1500));

  const result = await win.webContents.executeJavaScript(`(() => {
    const q = (s) => document.querySelector(s);
    const all = (s) => Array.from(document.querySelectorAll(s));
    const imgs = all('img');
    return {
      title: document.title,
      rootChildren: q('#root') ? q('#root').children.length : 0,
      h1: q('h1') ? q('h1').innerText.replace(/\\s+/g, ' ').trim() : '',
      sections: all('section').length,
      featureCards: all('#features .grid > div').length,
      themeCards: all('#themes figure').length,
      heroShot: (() => { const i = q('img[src*="shots-user/hero-modern"]'); return i ? i.naturalWidth + 'x' + i.naturalHeight : 'absent'; })(),
      stripShots: all('img[src*="shots-user"]').map((i) => i.getAttribute('src') + ' ' + i.naturalWidth + 'x' + i.naturalHeight),
      brokenImages: imgs.filter((i) => i.complete && i.naturalWidth === 0).map((i) => i.getAttribute('src')),
      version: (document.body.innerText.match(/4\\.1\\.2/) || ['missing'])[0],
      brandHits: (document.body.innerText.match(/Recordr/g) || []).length,
      downloadHref: q('a[href*="releases"]') ? q('a[href*="releases"]').href : '',
    };
  })()`);

  check('the page mounted', result.rootChildren > 0, `#root children=${result.rootChildren}`);
  check('the headline is rendered', /Never miss a moment/.test(result.h1), result.h1);
  check('every section is present', result.sections === 6, `sections=${result.sections}`);
  check('all six feature cards', result.featureCards === 6, `cards=${result.featureCards}`);
  check('all twelve theme cards', result.themeCards === 12, `cards=${result.themeCards}`);
  check('the HERO is a real screenshot', result.heroShot !== 'absent' && !/^0x/.test(result.heroShot), result.heroShot);
  check('the real-shot strip loads all 3', result.stripShots.length >= 3 && result.stripShots.every((s) => !/ 0x/.test(s)), result.stripShots.join(' | '));
  check('4.1.2 is shown on the page', result.version === '4.1.2', result.version);
  check('no stray "Recordr" in the copy', result.brandHits === 0, `${result.brandHits} hits`);
  check('no broken images', result.brokenImages.length === 0, result.brokenImages.join(', ') || 'none');
  check('the download points at the release', /releases/.test(result.downloadHref), result.downloadHref);

  // Phone width still fits.
  win.setSize(390, 900);
  await new Promise((r) => setTimeout(r, 800));
  const narrow = await win.webContents.executeJavaScript(
    '({ doc: document.documentElement.scrollWidth, win: window.innerWidth })',
  );
  check('no horizontal overflow at 390px', narrow.doc <= narrow.win + 1, `${narrow.doc} vs ${narrow.win}`);

  check('no console errors', errors.length === 0, errors.slice(0, 3).join(' | ') || 'none');

  const failed = checks.filter((c) => !c.ok).length;
  console.log(`\n${checks.length - failed}/${checks.length} checks passed`);
  app.exit(failed ? 1 : 0);
});
