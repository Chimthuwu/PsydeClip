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

// A wedged renderer should fail loudly rather than sit forever holding the box.
const watchdog = setTimeout(() => {
  console.log('\n  FAIL  the harness timed out after 120s');
  app.exit(1);
}, 120000);

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1400,
    height: 1000,
    show: false,
    webPreferences: { offscreen: false, backgroundThrottling: false },
  });

  /**
   * Two environment facts that would otherwise make this harness report the
   * machine instead of the page:
   *
   *  - prefers-reduced-motion. It is ON for this host, and the visualizer demo
   *    honours it by drawing one static frame, so a motion assertion would be
   *    testing the OS setting. Emulated to no-preference here; the reduced
   *    branch is covered deliberately at the end of the run.
   *  - compositing. Chromium throttles rAF in a window it is not drawing (about
   *    1 tick per 500ms, measured), and a throttled window cannot tell a working
   *    animation from a frozen one, so the page is shown inactive for the run.
   */
  win.webContents.on('console-message', (_e, level, message) => {
    // Electron's own dev-mode CSP notice is about the harness, not the page.
    if (level >= 2 && !/Electron Security Warning/.test(message)) errors.push(message);
  });
  win.webContents.on('did-fail-load', (_e, code, desc, url) => {
    errors.push(`did-fail-load ${code} ${desc} ${url}`);
  });

  await win.loadURL(URL);
  // Attached after the first load, then reloaded: the media override has to be
  // in effect before the component reads it at mount. Attaching before the
  // first load wedges the network service on this box.
  win.webContents.debugger.attach('1.3');
  await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }],
  });
  await win.webContents.reload();
  win.showInactive(); // shown, or rAF is throttled and every canvas looks frozen
  await new Promise((r) => setTimeout(r, 2500));
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
      roadmapRows: all('#roadmap .space-y-4 > div').length,
      images: imgs.length,
      brokenImages: imgs.filter((i) => i.complete && i.naturalWidth === 0).map((i) => i.getAttribute('src')),
      heroCapture: (() => { const i = q('img[src*="shots-user/hero-modern"]'); return i ? i.naturalWidth + 'x' + i.naturalHeight : 'absent'; })(),
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
  // hero, features, visualizers, themes, stack, roadmap — nav and footer are not <section>.
  check('every section is present', result.sections === 6, `${result.sections} sections`);
  check('all six feature cards', result.featureCards === 6, `${result.featureCards}`);
  check('all twelve theme cards', result.themeCards === 12, `${result.themeCards}`);
  check('the roadmap is populated', result.roadmapRows === 8, `${result.roadmapRows} rows`);
  // Was "the animated mockup is drawn" (.wave-path traces). HeroShot replaced the
  // drawn mockup with a real capture, so that assertion had been failing since.
  check('the hero is a real capture', result.heroCapture !== 'absent' && !/^0x/.test(result.heroCapture), result.heroCapture);
  check('the theme screenshots loaded', result.themeShot !== 'absent' && !/^0x/.test(result.themeShot), result.themeShot);
  check('the brand reads Unrecordable', result.brandName === 'unrecordable', result.brandName);
  check('no stray "Recordr" in the copy', result.brandHits === 0, `${result.brandHits} hits`);
  check('no broken images', result.brokenImages.length === 0, result.brokenImages.join(', ') || 'none');
  check('Tailwind is applied', result.bodyBg === 'rgb(5, 5, 10)', `body bg ${result.bodyBg}`);
  check('the download points at the release', /releases/.test(result.downloadHref), result.downloadHref);
  check('no horizontal overflow', result.docWidth <= result.winWidth + 1, `${result.docWidth} vs ${result.winWidth}`);

  // ── The visualizer demo: five tabs and a canvas that genuinely paints ──
  // Scroll it into view first — the rAF loop is parked while off-screen, so
  // sampling an unpainted canvas is what a missing IntersectionObserver looks
  // like, not what a broken renderer looks like.
  await win.webContents.executeJavaScript(
    "document.querySelector('#visualizers')?.scrollIntoView(); window.scrollBy(0, -60);",
  );
  await new Promise((r) => setTimeout(r, 1200));

  // Pixel samples go through a throwaway scratch canvas, so the page's own
  // context is never read with getImageData. Repeated readback on one context
  // makes Chromium (correctly) suggest willReadFrequently — a hint about this
  // harness that the page itself would never provoke, and not something the
  // page should set a flag for to satisfy a test.
  // Returns zeros rather than null for a missing canvas: the callers run inside
  // the page, so a null would throw there and kill the whole run as an
  // unhandled rejection instead of failing the assertions it belongs to.
  const SAMPLE = `((target) => {
    const c = document.querySelector(target);
    if (!c) return { painted: 0, sum: 0 };
    const s = document.createElement('canvas');
    s.width = Math.min(c.width, 640);
    s.height = Math.min(c.height, 360);
    const sc = s.getContext('2d');
    sc.drawImage(c, 0, 0, s.width, s.height);
    const d = sc.getImageData(0, 0, s.width, s.height).data;
    let painted = 0;
    let sum = 0;
    for (let i = 3; i < d.length; i += 4 * 7) {
      if (d[i] > 8) painted++;
      sum += d[i - 1] + d[i - 2] * 3;
    }
    return { painted, sum };
  })`;

  const viz = await win.webContents.executeJavaScript(`(() => {
    const c = document.querySelector('#visualizers canvas');
    if (!c) return { present: false };
    const r = c.getBoundingClientRect();
    const s = ${SAMPLE}("#visualizers canvas");
    return {
      present: true,
      css: Math.round(r.width) + 'x' + Math.round(r.height),
      painted: s.painted,
    };
  })()`);
  const tabs = await win.webContents.executeJavaScript(`(() => {
    const all = Array.from(document.querySelectorAll('#visualizers [role=tab]'));
    return {
      count: all.length,
      labels: all.map((t) => t.innerText.trim()),
      selected: all.filter((t) => t.getAttribute('aria-selected') === 'true').map((t) => t.innerText.trim()),
    };
  })()`);

  check('the visualizer demo is present', viz.present === true, viz.css || 'no canvas');
  check('it offers all five visualizers', tabs.count === 5, `${tabs.count}: ${tabs.labels.join(', ')}`);
  check('exactly one tab is selected', tabs.selected.length === 1, tabs.selected.join(', '));
  check('the canvas is actually painted', viz.painted > 50, `${viz.painted} samples opaque`);

  // Switch to MIDI — the fifth mode the supplied drop-in was missing.
  await win.webContents.executeJavaScript(
    "(() => { const t = Array.from(document.querySelectorAll('#visualizers [role=tab]')).find((x) => /MIDI/.test(x.innerText)); if (t) t.click(); })()",
  );
  await new Promise((r) => setTimeout(r, 700));
  const afterSwitch = await win.webContents.executeJavaScript(`(() => {
    const sel = Array.from(document.querySelectorAll('#visualizers [role=tab]')).find((t) => t.getAttribute('aria-selected') === 'true');
    const cap = document.querySelector('#visualizers strong');
    const s = ${SAMPLE}("#visualizers canvas");
    return {
      selected: sel ? sel.innerText.trim() : '',
      caption: cap ? cap.innerText.trim() : '',
      painted: s.painted,
    };
  })()`);

  check('switching tabs selects MIDI', afterSwitch.selected === 'MIDI', afterSwitch.selected || 'none');
  check('the caption follows the selected tab', /MIDI/.test(afterSwitch.caption), afterSwitch.caption);
  check('the canvas repaints after a switch', afterSwitch.painted > 50, `${afterSwitch.painted} samples opaque`);

  // Precondition for the motion check below: this window has to be compositing,
  // or rAF is throttled and everything looks frozen. Reported explicitly so a
  // throttled window cannot masquerade as a broken renderer.
  const ticks = await win.webContents.executeJavaScript(`(() => new Promise((resolve) => {
    let n = 0; const t0 = performance.now();
    const step = () => { n++; if (performance.now() - t0 > 400) resolve(n); else requestAnimationFrame(step); };
    requestAnimationFrame(step);
    setTimeout(() => resolve(-n), 2000);
  }))()`);
  check('the harness window is compositing (rAF running)', ticks > 5, `${ticks} ticks/400ms`);

  // The spectrogram is the mode the supplied drop-in shipped broken: its row
  // gate was `t % 2 === 0` on a `t += 0.016` accumulator, which is true once,
  // ever — so the waterfall drew one row and never moved. Assert it MOVES, or
  // that regression is invisible to a static pass/fail.
  await win.webContents.executeJavaScript(
    "(() => { const t = Array.from(document.querySelectorAll('#visualizers [role=tab]')).find((x) => /Spectrogram/.test(x.innerText)); if (t) t.click(); })()",
  );
  await new Promise((r) => setTimeout(r, 500));
  const spectroA = await win.webContents.executeJavaScript(`${SAMPLE}("#visualizers canvas")`);
  await new Promise((r) => setTimeout(r, 450));
  const spectroB = await win.webContents.executeJavaScript(`${SAMPLE}("#visualizers canvas")`);

  check('the spectrogram paints a waterfall', spectroA.painted > 50, `${spectroA.painted} samples opaque`);
  check('the spectrogram is scrolling, not frozen', spectroA.sum !== spectroB.sum, `${spectroA.sum} vs ${spectroB.sum}`);

  // Every mode is its own drawing path, so each one is exercised rather than
  // trusting that the three already sampled stand in for the other two.
  for (const label of ['Oscilloscope', 'Spectrum', 'Spectrogram', 'History', 'MIDI']) {
    await win.webContents.executeJavaScript(
      `(() => { const t = Array.from(document.querySelectorAll('#visualizers [role=tab]')).find((x) => x.innerText.trim() === ${JSON.stringify(
        label,
      )}); if (t) t.click(); })()`,
    );
    await new Promise((r) => setTimeout(r, 350));
    const sampled = await win.webContents.executeJavaScript(`${SAMPLE}("#visualizers canvas")`);
    check(`the ${label} mode paints`, sampled.painted > 50, `${sampled.painted} samples opaque`);
  }

  // Phone width: the page has to survive a 390px viewport without a sideways scroll.
  win.setSize(390, 900);
  await new Promise((r) => setTimeout(r, 800));
  const narrow = await win.webContents.executeJavaScript(
    '({ doc: document.documentElement.scrollWidth, win: window.innerWidth })',
  );
  check('no horizontal overflow at 390px', narrow.doc <= narrow.win + 1, `${narrow.doc} vs ${narrow.win}`);

  // The other half of the demo's motion contract: when reduced motion IS asked
  // for it must still draw a frame, then hold it still — neither animate nor
  // come up blank. Loaded fresh so the component reads the emulated query.
  await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
  });
  await win.setSize(1400, 1000);
  await win.loadURL(URL);
  await new Promise((r) => setTimeout(r, 1500));
  await win.webContents.executeJavaScript(
    "document.querySelector('#visualizers')?.scrollIntoView(); window.scrollBy(0, -60);",
  );
  await new Promise((r) => setTimeout(r, 900));
  const stillA = await win.webContents.executeJavaScript(`${SAMPLE}("#visualizers canvas")`);
  await new Promise((r) => setTimeout(r, 500));
  const stillB = await win.webContents.executeJavaScript(`${SAMPLE}("#visualizers canvas")`);

  check('under reduced motion the canvas still draws', stillA.painted > 50, `${stillA.painted} samples opaque`);
  check('under reduced motion it holds still', stillA.sum === stillB.sum, `${stillA.sum} vs ${stillB.sum}`);
  win.hide();

  check('no console errors', errors.length === 0, errors.slice(0, 3).join(' | ') || 'none');

  const failed = checks.filter((c) => !c.ok).length;
  console.log(`\n  ${checks.length - failed}/${checks.length} checks passed`);
  clearTimeout(watchdog);
  app.exit(failed ? 1 : 0);
});
