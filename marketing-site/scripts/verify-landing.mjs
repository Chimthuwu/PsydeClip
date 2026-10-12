/**
 * Render the built landing page in a real browser and assert it is actually
 * there — a Vite build succeeds whether or not the page throws on mount, and
 * the first version of this page did throw (a missing icon export).
 *
 * Usage: start `npm run preview`, then
 *   node scripts/verify-landing.mjs [url]
 *
 * Drives Electron from the parent repo as the browser, the same way the app's
 * own verify:* scripts do, so there is no extra dependency.
 */
import { app, BrowserWindow } from 'electron';

const URL = process.argv[2] || 'http://localhost:4173/';
const checks = [];
const errors = [];

function check(name, ok, detail = '') {
  checks.push({ name, ok, detail });
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
    // Electron's own dev-mode CSP notice is about the harness, not the page.
    if (level >= 2 && !/Electron Security Warning/.test(message)) errors.push(message);
  });
  win.webContents.on('did-fail-load', (_e, code, desc, url) => {
    errors.push(`did-fail-load ${code} ${desc} ${url}`);
  });

  await win.loadURL(URL);
  await new Promise((r) => setTimeout(r, 2000));
  // The theme rail is lazy-loaded and below the fold: without scrolling to it,
  // every shot reports naturalWidth 0 and the check measures nothing.
  await win.webContents.executeJavaScript(
    "document.querySelector('#themes').scrollIntoView(); window.scrollBy(0, -80);",
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
      roadmapRows: all('section:nth-of-type(5) .space-y-4 > div').length,
      images: imgs.length,
      brokenImages: imgs.filter((i) => i.complete && i.naturalWidth === 0).map((i) => i.getAttribute('src')),
      mockupTrace: all('.wave-path').length,
      brandHits: (document.body.innerText.match(/Recordr/g) || []).length,
      brandName: q('nav a span:last-child') ? q('nav a span:last-child').innerText : '',
      themeShot: (() => { const i = q('img[src*="main-modern"]'); return i ? i.naturalWidth + 'x' + i.naturalHeight : 'absent'; })(),
      downloadHref: q('a[href*="releases"]') ? q('a[href*="releases"]').href : '',
      bodyBg: getComputedStyle(document.body).backgroundColor,
      tailwindApplied: q('h1') ? getComputedStyle(q('h1')).fontWeight : '',
      docWidth: document.documentElement.scrollWidth,
      winWidth: window.innerWidth,
    };
  })()`);

  check('the page mounted', result.rootChildren > 0, `#root children=${result.rootChildren}`);
  check('the headline is rendered', /Never miss a moment/.test(result.h1), result.h1);
  // hero, features, themes, stack, roadmap — the nav and footer are not <section>.
  check('every section is present', result.sections === 5, `${result.sections} sections`);
  check('all six feature cards', result.featureCards === 6, `${result.featureCards}`);
  check('all twelve theme cards', result.themeCards === 12, `${result.themeCards}`);
  check('the roadmap is populated', result.roadmapRows === 8, `${result.roadmapRows} rows`);
  check('the animated mockup is drawn', result.mockupTrace === 2, `${result.mockupTrace} traces`);
  check('the theme screenshots loaded', result.themeShot !== 'absent' && !/^0x/.test(result.themeShot), result.themeShot);
  check('the brand reads Unrecordable', result.brandName === 'unrecordable', result.brandName);
  check('no stray "Recordr" in the copy', result.brandHits === 0, `${result.brandHits} hits`);
  check('no broken images', result.brokenImages.length === 0, result.brokenImages.join(', ') || 'none');
  check('Tailwind is applied', result.bodyBg === 'rgb(5, 5, 10)', `body bg ${result.bodyBg}`);
  check('the download points at the release', /releases/.test(result.downloadHref), result.downloadHref);
  check('no horizontal overflow', result.docWidth <= result.winWidth + 1, `${result.docWidth} vs ${result.winWidth}`);

  // Phone width: the page has to survive a 390px viewport without a sideways scroll.
  win.setSize(390, 900);
  await new Promise((r) => setTimeout(r, 800));
  const narrow = await win.webContents.executeJavaScript(
    '({ doc: document.documentElement.scrollWidth, win: window.innerWidth })',
  );
  check('no horizontal overflow at 390px', narrow.doc <= narrow.win + 1, `${narrow.doc} vs ${narrow.win}`);

  check('no console errors', errors.length === 0, errors.slice(0, 3).join(' | ') || 'none');

  const failed = checks.filter((c) => !c.ok).length;
  console.log(`\n  ${checks.length - failed}/${checks.length} checks passed`);
  app.exit(failed ? 1 : 0);
});
