/**
 * Does the MIDI grid actually DRAW live notes, in the real renderer?
 *
 * The node suite covers YIN's arithmetic and the layout maths, but neither
 * proves the WIRING: that a recording arms the tracker, that audio frames reach
 * it, and that note bars reach the canvas. All three live in code the node suite
 * never runs — a Web Audio AnalyserNode, a React rAF loop, and the board's own
 * draw loop.
 *
 * So this loads the REAL `dist/renderer` bundle in a REAL Electron window,
 * stubs only Web Audio (no capture device exists on this box — and live audio
 * testing is off-limits by the owner's standing rule), and reads the canvas
 * pixels back. It asserts the bars appear and change colour, rather than
 * trusting that a function was called.
 *
 * Run: node scripts/midi-grid-check.mjs
 *   (after `npm run build:main && npm run build:renderer`)
 */

const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const PAGE = path.join(ROOT, 'dist', 'renderer', 'index.html');
const PRELOAD = path.join(ROOT, 'dist', 'preload', 'index.js');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  [${detail}]` : ''}`);
}

/**
 * Read the MIDI board's canvas back: a checksum, plus counts of pixels at the
 * two note colours.
 *
 * Located by its pane tag (`.board-mode-tag` says "MIDI"), NOT by "the first
 * canvas in .board": the default layout is a 5-pane mosaic whose first canvas is
 * the oscilloscope, and sampling that reports "no notes" for ever.
 *
 * `hash` is what the liveness and gate checks compare. A pixel COUNT cannot
 * answer either: a grid already full of bars stops growing while still updating,
 * so "more pixels" is false just as easily as "fewer pixels". A checksum moves
 * whenever the content does.
 *
 * `magenta` counts pixels AT the transcribed colour (#ff2fd0) within a small
 * tolerance — measured, not guessed. The first version of this file thresholded
 * `r>140 && b>110 && g<r*0.7` from imagination, and that also matched 135 pixels
 * of a dim preview bar's antialiased edge, which is how a harness ends up
 * failing a correct build.
 */
async function canvasStats(win) {
  return win.webContents.executeJavaScript(`
    (() => {
      const board = [...document.querySelectorAll('.board')].find(
        (b) => /MIDI/i.test((b.querySelector('.board-mode-tag') || {}).textContent || '')) ||
        document.querySelector('.board');
      const cv = board && board.querySelector('canvas');
      if (!cv) return null;
      const ctx = cv.getContext('2d', { willReadFrequently: true });
      const { data } = ctx.getImageData(0, 0, cv.width, cv.height);

      // #ff2fd0 = (255,47,208). Tolerance 40/channel: wide enough for a bar's
      // alpha blend against the grid, tight enough that the live tint (#583868
      // on the modern theme) is nowhere near it.
      let magenta = 0, lit = 0;
      let hash = 2166136261;
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i], g = data[i + 1], b = data[i + 2];
        if (r + g + b > 72) lit++;
        if (Math.abs(r - 255) < 40 && Math.abs(g - 47) < 40 && Math.abs(b - 208) < 40) magenta++;
        // FNV-ish over a subsample: enough to change when the picture does,
        // cheap enough not to dominate the harness.
        if ((i & 0x3ff) === 0) { hash ^= r; hash = Math.imul(hash, 16777619); }
        if ((i & 0x3ff) === 0) { hash ^= g; hash = Math.imul(hash, 16777619); }
        if ((i & 0x3ff) === 0) { hash ^= b; hash = Math.imul(hash, 16777619); }
      }
      return { magenta, lit, hash: hash >>> 0, px: data.length / 4, w: cv.width, h: cv.height };
    })()`);
}

/**
 * The most common saturated colours on the board, by count.
 *
 * Written because guessing at a "what does a note bar look like" threshold is
 * how a harness ends up reporting PASS on an empty grid: the first version of
 * this file asserted `r>140 && b>110 && g<r*0.7` from imagination, and that
 * threshold happened to also match 135 pixels of a dim preview bar.
 */
async function colourHistogram(win) {
  return win.webContents.executeJavaScript(`
    (() => {
      const board = [...document.querySelectorAll('.board')].find(
        (b) => /MIDI/i.test((b.querySelector('.board-mode-tag') || {}).textContent || '')) ||
        document.querySelector('.board');
      const cv = board && board.querySelector('canvas');
      if (!cv) return null;
      const ctx = cv.getContext('2d', { willReadFrequently: true });
      const { data } = ctx.getImageData(0, 0, cv.width, cv.height);
      const hist = new Map();
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i], g = data[i + 1], b = data[i + 2];
        if (r + g + b < 60) continue; // ignore background/grid
        const key = [r >> 4, g >> 4, b >> 4].join(',');
        hist.set(key, (hist.get(key) || 0) + 1);
      }
      return [...hist.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)
        .map(([k, n]) => ({ rgb: k.split(',').map((v) => Number(v) * 16 + 8).join('/'), n }));
    })()`);
}

/** What the renderer thinks its state is — turns a 0 into a reason. */
async function probe(win) {
  return win.webContents.executeJavaScript(`
    (() => {
      const out = { tag: null, lanes: document.querySelectorAll('.piano-roll-lane').length,
                    canvases: document.querySelectorAll('.board canvas').length,
                    tags: [...document.querySelectorAll('.board-mode-tag, .viz-pane-tag')].map((t) => t.textContent) };
      const board = [...document.querySelectorAll('.board')].find(
        (b) => /MIDI/i.test((b.querySelector('.board-mode-tag') || {}).textContent || '')) ||
        document.querySelector('.board');
      out.foundByTag = !!board;
      out.tag = board && (board.querySelector('.board-mode-tag') || {}).textContent;
      out.size = board ? [board.clientWidth, board.clientHeight] : null;
      out.idleText = (document.querySelector('.board') || {}).textContent || '';
      return out;
    })()`);
}

async function main() {
  if (!fs.existsSync(PAGE)) {
    console.error(`Missing ${PAGE} — run: npm run build:renderer`);
    return 1;
  }

  const errors = [];
  const win = new BrowserWindow({
    show: false,
    width: 1100,
    height: 700,
    webPreferences: {
      // Isolation OFF, unlike the real window: the stub has to replace the
      // standard `AudioContext` global, which contextBridge refuses to do. The
      // renderer bundle under test is identical either way.
      contextIsolation: false,
      nodeIntegration: false,
      sandbox: false,
      preload: path.join(__dirname, 'midi-grid-stub.js'),
    },
  });
  win.webContents.on('console-message', (_e, level, message) => {
    // Level 3 = verbose, and Chromium's canvas-readback perf hint is not a defect.
    if (level === 2) errors.push(message);
  });
  win.webContents.on('render-process-gone', (_e, d) =>
    errors.push(`renderer gone: ${d.reason}`),
  );
  await win.loadFile(PAGE);
  await sleep(1500);

  const ev = (js) => win.webContents.executeJavaScript(js);
  const CLICK_RECORD = `document.querySelector('.transport-toggle').click()`;

  check('the real renderer bundle mounted', await ev('!!document.querySelector(".app")'));
  check('the audio stub is in place', await ev('!!window.__midiStub'));
  check(
    'the REAL Web Audio graph is bound to the synthesised feed (nothing stubbed out)',
    await ev('window.__midiStub.bound()'),
    `${await ev('window.__midiStub.subscriberCount()')} subscribers`,
  );
  check('a canvas is drawing at all', await ev('!!document.querySelector(".board canvas")'));
  check(
    'the transport start/stop control is present',
    await ev('!!document.querySelector(".transport-toggle")'),
  );

  // Settings are stubbed to traditional mode, where App's `capturing` flag IS
  // "a bounded recording is running" — the same condition a clip satisfies. App
  // mounts capturing=true, so tracking is already armed: the point is to prove it
  // drew notes without pressing anything.
  await sleep(5000);
  const live = await canvasStats(win);
  check(
    'note bars are actually drawn while recording',
    !!live && live.lit > 0,
    `lit=${live?.lit}/${live?.px} hash=${live?.hash}`,
  );
  check(
    'nothing is drawn in the TRANSCRIBED colour (#ff2fd0) during a live capture',
    !!live && live.magenta === 0,
    `magenta=${live?.magenta}`,
  );

  const a = await canvasStats(win);
  await sleep(2500);
  const b = await canvasStats(win);
  check(
    'the grid keeps UPDATING as the recording continues',
    !!b && !!a && b.hash !== a.hash,
    `hash ${a?.hash} -> ${b?.hash}`,
  );

  // ---- THE CPU GATE -------------------------------------------------------
  // The contract has two halves since the idle tracker landed (owner,
  // 2026-10-13: "notes should appear whenever the MIDI visualizer is on screen,
  // not only while the record button is down"):
  //
  //   recording             → always tracking
  //   stopped, pane visible → tracking too, continuing the frozen preview
  //   stopped, pane hidden   → NO timer alive at all
  //
  // The last one is the gate that matters (it is the standing CPU cost the gate
  // exists to avoid), and until 2026-10-13 no harness could reach it — this
  // section asserted the FIRST half as "no new notes while not recording",
  // which the idle tracker deliberately made false.
  await ev(CLICK_RECORD);
  await sleep(800);
  const justStopped = await canvasStats(win);
  check(
    'the notes stay on the grid after the recording stops',
    !!justStopped && justStopped.lit > 0,
    `lit=${justStopped?.lit}`,
  );
  check(
    'and they are still the preview colour, not a transcription',
    !!justStopped && justStopped.magenta === 0,
    `magenta=${justStopped?.magenta}`,
  );
  // Read the tracker the app is actually holding — a canvas that has stopped
  // moving can be frozen for reasons that have nothing to do with the gate, so
  // the note count is the primary evidence and it is asserted first.
  const NOTES_NOW =
    '(window.__recordrLiveNotes ? window.__recordrLiveNotes.noteCount : null)';
  check(
    'the app publishes its live tracker for verification',
    (await ev(NOTES_NOW)) !== null,
    `noteCount=${await ev(NOTES_NOW)}`,
  );

  const g1 = await ev(NOTES_NOW);
  await sleep(3000);
  const g2 = await ev(NOTES_NOW);
  check(
    'the idle grid keeps finding notes while the MIDI pane is on screen',
    g1 !== null && g2 !== null && g2 > g1,
    `note count ${g1} -> ${g2} over 3s of live audio`,
  );

  // Half two: take the pane off screen. Nothing is watching any more, so the
  // timer must stop dead — and the audio does NOT stop, which is what makes
  // "the count is frozen" mean the gate rather than a silent source.
  await ev(`window.__midiStub.setVizHidden(['midi'])`);
  await sleep(1000);
  const h1 = await ev(NOTES_NOW);
  await sleep(3000);
  const h2 = await ev(NOTES_NOW);
  check(
    'GATE: hiding the MIDI pane stops the tracker dead',
    h1 !== null && h2 !== null && h1 === h2,
    `note count ${h1} -> ${h2} over 3s of live audio with the pane hidden`,
  );

  await ev(`window.__midiStub.setVizHidden(['oscilloscope', 'spectrum', 'spectrogram', 'history'])`);
  await sleep(1000);
  const s1 = await ev(NOTES_NOW);
  await sleep(2500);
  const s2 = await ev(NOTES_NOW);
  check(
    'and showing the pane again starts the tracking back up',
    s1 !== null && s2 !== null && s2 > s1,
    `note count ${s1} -> ${s2} over 2.5s of live audio`,
  );

  // ---- A new recording starts a fresh tracker, not an append. -------------
  const frozen = await canvasStats(win);
  await ev(CLICK_RECORD);
  await sleep(2500);
  const restarted = await canvasStats(win);
  check(
    'a NEW recording starts a fresh tracker rather than appending',
    !!restarted && !!frozen && restarted.hash !== frozen.hash,
    `before=${frozen?.hash} after=${restarted?.hash}`,
  );
  check('and the fresh recording is drawing again', !!restarted && restarted.lit > 0, `lit=${restarted?.lit}`);

  // ---- CLEAR BUFFER must not silence the grid (owner, 2026-10-13) ---------
  // "when i pressed clear buffer the midi notes stopped appearing afterwards".
  // The wipe nulled the live tracker and counted on an effect to rebuild one;
  // neither tracking effect depends on anything a wipe changes, so no new
  // tracker was ever made and the grid stayed blank until the MIDI pane was
  // toggled — which re-ran the idle effect and rebuilt what the wipe dropped.
  //
  // Why the obvious check would NOT have caught it: under the bug the recording
  // interval keeps feeding the tracker object it captured, so `noteCount`
  // happily keeps climbing on a grid that draws nothing. The count is measured
  // anyway (it should RESTART), but the check that actually discriminates is
  // the note TIMELINE: the wipe restarts the session clock at 0, so the newest
  // note must land near 0 again. Under the bug the orphan tracker keeps
  // stamping the pre-wipe clock (~16 s by here) for ever.
  const LAST_START =
    '(function(){const t=window.__recordrLiveNotes;return t&&t.notes.length?t.notes[t.notes.length-1].startSec:null;})()';
  const CLEAR_BTN = '.hud-actions button[aria-label="Clear buffer"]';
  check(
    'the HUD clear-buffer button is there to press',
    await ev(`!!document.querySelector('${CLEAR_BTN}')`),
  );

  const preClearCount = await ev(NOTES_NOW);
  const preClearStart = await ev(LAST_START);
  await ev(`document.querySelector('${CLEAR_BTN}').click()`);
  await sleep(400);
  const postClearCount = await ev(NOTES_NOW);
  await sleep(3000);
  const postClearGrowth = await ev(NOTES_NOW);
  const postClearStart = await ev(LAST_START);

  check(
    'clearing empties the note list',
    preClearCount > 0 && postClearCount < preClearCount,
    `${preClearCount} -> ${postClearCount}`,
  );
  check(
    'notes keep being detected after a buffer clear',
    postClearGrowth > postClearCount,
    `note count ${postClearCount} -> ${postClearGrowth} over 3s of live audio`,
  );
  check(
    'the restarted notes are stamped on the NEW session clock, not the old one',
    postClearStart !== null && postClearStart < 4,
    `newest note at ${postClearStart?.toFixed?.(2)}s after the wipe (was ${preClearStart?.toFixed?.(2)}s before)`,
  );
  const afterClear = await canvasStats(win);
  check(
    'and the grid is still drawing (its content keeps changing)',
    !!afterClear && afterClear.hash !== restarted?.hash,
    `hash ${restarted?.hash} -> ${afterClear?.hash}`,
  );

  console.log(`\n  ${results.filter((r) => r.ok).length}/${results.length} checks passed`);
  if (errors.length) {
    console.log('  console errors:');
    for (const e of errors.slice(0, 12)) console.log(`    ${e}`);
  }
  win.destroy();
  return results.every((r) => r.ok) ? 0 : 1;
}

app.whenReady()
  .then(main)
  .then((code) => setTimeout(() => app.exit(code), 300))
  .catch((err) => {
    console.error('harness crashed:', err);
    setTimeout(() => app.exit(1), 300);
  });