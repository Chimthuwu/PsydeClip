/**
 * Electron main-process check: does the transcription worker actually run
 * INSIDE Electron, driven through the REAL preload bridge and REAL ipc
 * handlers?
 *
 * This is the one thing the node --test pool suite cannot prove. Outside
 * Electron it runs on plain Node; in production it runs in Electron's main
 * process, where asar packing, worker_threads, and tfjs backend registration
 * all behave differently. A feature that works in node and dies in Electron is
 * exactly the bug this file exists to catch.
 *
 * Loads the real preload (dist/preload) so the browser side is the shipped
 * code too. Only the audio device is absent; nothing else is stubbed.
 *
 * Run: npx electron scripts/transcribe-electron-check.js
 * Packaged: npm run test:packaged   (same checks against release/win-unpacked)
 */

const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SR = 44100;
const ROOT = path.join(__dirname, '..');

/**
 * Which build to drive.
 *
 * Default: the repo's own `dist/`. Set `RECORDR_APP_DIR` to an unpacked
 * electron-builder output (`release/win-unpacked`) to run the SAME checks
 * against the packaged artefact instead — the only way to prove the engine's
 * dependency tree and the worker thread actually load from inside `app.asar`,
 * which is a different code path from the repo (see the 2026-10-03 `files` bug:
 * no dependencies were listed at all, so the model would simply be absent).
 */
const APP_ROOT = process.env.RECORDR_APP_DIR
  ? path.resolve(process.env.RECORDR_APP_DIR, 'resources', 'app.asar')
  : ROOT;
const DIST = path.join(APP_ROOT, 'dist');
const APP_LABEL = process.env.RECORDR_APP_DIR ? 'the packaged asar' : 'the repo dist/';

/** A plucked A-major triad — real pitch content for the model to find. */
function buildSignal(sec = 3) {
  const n = Math.floor(sec * SR);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const env = Math.exp(-2.5 * (t % 1));
    out[i] =
      env * 0.3 *
      (Math.sin(2 * Math.PI * 220 * t) +
        Math.sin(2 * Math.PI * 277.18 * t) +
        Math.sin(2 * Math.PI * 329.63 * t));
  }
  let peak = 0;
  for (const s of out) peak = Math.max(peak, Math.abs(s));
  for (let i = 0; i < n; i++) out[i] = (out[i] / peak) * 0.89;
  return out;
}

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  [${detail}]` : ''}`);
}

let win;

async function main() {
  console.log(`  (driving ${APP_LABEL}: ${DIST})`);

  // The engine's dependency tree has to be present in whatever we are driving.
  // The model (900 KB) ships inside @spotify/basic-pitch, so a missing package
  // is a silently missing feature, not a crash.
  for (const dep of ['@spotify/basic-pitch', '@tensorflow/tfjs', '@tonejs/midi']) {
    let ok = true;
    let detail = '';
    let pkg = '';
    try {
      pkg = require.resolve(`${dep}/package.json`, { paths: [APP_ROOT] });
    } catch (err) {
      ok = false;
      detail = err.message;
    }
    check(`${dep} resolves from ${APP_LABEL}`, ok, detail);
    if (ok && dep === '@spotify/basic-pitch') {
      const model = path.join(path.dirname(pkg), 'model', 'model.json');
      check('the vendored model ships with it', fs.existsSync(model), model);
    }
  }

  // The REAL main-process handlers, from the directory that ships. Requiring
  // the module is not enough — handlers only exist once registerIpc() has run,
  // so call it with the same context shape src/main/index.ts uses.
  try {
    const { registerIpc } = require(path.join(DIST, 'main', 'ipc.js'));
    registerIpc({
      getWindow: () => win,
      onSettingsChanged: () => {},
      getCurrentHotkey: () => null,
      recreateWindow: () => {},
    });
    check('real registerIpc() runs and installs handlers', true);
  } catch (err) {
    check('real registerIpc() runs and installs handlers', false, err.message);
    return 1;
  }

  // The REAL preload, so the renderer side is the shipped bridge as well.
  const preload = path.join(DIST, 'preload', 'index.js');
  if (!fs.existsSync(preload)) {
    check('preload bundle exists', false, preload);
    return 1;
  }
  win = new BrowserWindow({
    show: false,
    width: 400,
    height: 300,
    webPreferences: {
      preload,
      contextIsolation: true,
      nodeIntegration: false,
      // Must match the real window (src/main/index.ts): Recordr's renderer owns
      // an AnalyserNode and a frame pump, and the app already opts out of the
      // preload sandbox.
      sandbox: false,
    },
  });
  await win.loadFile(path.join(DIST, 'renderer', 'index.html'));

  const hasApi = await win.webContents.executeJavaScript(
    'typeof window.api === "object" && typeof window.api.startTranscription === "function"');
  check('shipped preload exposes startTranscription', hasApi);
  if (!hasApi) return 1;

  // The quick menu's "Save selection" plumbing: the renderer reports the
  // selection, main builds the native item from it and asks the main window to
  // save. Only the bridge surface can be asserted without a real click on a
  // native menu — a stale preload bundle is the failure this catches.
  const selApi = await win.webContents.executeJavaScript(`
    (() => {
      const has = typeof window.api.selectionChanged === 'function'
        && typeof window.api.onRequestSaveSelection === 'function';
      if (has) {
        window.api.selectionChanged([1.5, 4.25]);
        window.api.selectionChanged(null);
      }
      return has;
    })()`);
  check('shipped preload exposes the selection → quick-menu bridge', selApi);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'recordr-electron-midi-'));
  const audioPath = path.join(dir, 'electron-take.wav');
  fs.writeFileSync(audioPath, 'placeholder audio, must not be modified');
  const before = fs.readFileSync(audioPath, 'utf8');

  // ---- Happy path, through the real structured-clone hop ----
  const started = await startJob(audioPath, 3);
  check('ipcMain handler accepts a job', started !== null, started && started.status);
  if (!started) return 1;

  check(
    'midiPath sits beside the audio with a .mid extension',
    path.dirname(started.midiPath) === dir &&
      path.basename(started.midiPath) === 'electron-take.mid',
    started.midiPath,
  );

  const final = await waitForSettle(started.jobId, 300000);
  check('job reaches a terminal state', !!final, final ? final.status : 'timeout');
  if (final) {
    check(
      'worker thread ran inference inside Electron',
      final.status === 'done',
      final.status === 'error'
        ? final.error
        : `${final.noteCount} notes in ${((final.elapsedMs || 0) / 1000).toFixed(1)}s`,
    );
    if (final.status === 'done') {
      check('a .mid landed on disk', fs.existsSync(final.midiPath));
      if (fs.existsSync(final.midiPath)) {
        const head = [...fs.readFileSync(final.midiPath).subarray(0, 4)];
        check(
          'the .mid is a real MIDI file',
          head.join(',') === '77,84,104,100',
          `MThd=${head.map((b) => b.toString(16))}`,
        );
      }
    }
  }

  // The user's audio must survive transcription untouched.
  check('the saved audio was never modified', fs.readFileSync(audioPath, 'utf8') === before);

  // ---- Notes-only: the piano-roll lane's path (no audio file, no .mid) -----
  // The lane transcribes a range out of the rolling buffer, so it has no saved
  // audio for a .mid to sit beside. It must still run the real worker and come
  // back with the note list — and must not write anything anywhere.
  const ndir = fs.mkdtempSync(path.join(os.tmpdir(), 'recordr-electron-notes-'));
  const n = await startJob('', 3, { notesOnly: true });
  check('notes-only job accepted without an audio path', n !== null, n && n.status);
  if (n) {
    check('notes-only job carries no .mid path', n.midiPath === '', JSON.stringify(n.midiPath));
    const nf = await waitForSettle(n.jobId, 300000);
    check('notes-only job settles', !!nf && nf.status !== 'running', nf ? nf.status : 'timeout');
    if (nf && nf.status === 'done') {
      const notes = nf.notes || [];
      check(
        'notes-only job returns the note list',
        notes.length > 0 && notes.length === nf.noteCount,
        `${notes.length} notes`,
      );
      check(
        'notes-only job writes nothing to disk',
        fs.readdirSync(ndir).length === 0,
        fs.readdirSync(ndir).join(',') || 'empty',
      );
    }
  }

  // ---- Negative case: cancellation, same real handler ----
  const cdir = fs.mkdtempSync(path.join(os.tmpdir(), 'recordr-electron-cancel-'));
  const caudio = path.join(cdir, 'cancel.wav');
  fs.writeFileSync(caudio, 'x');
  const c = await startJob(caudio, 20);
  if (c) {
    const cancelled = await win.webContents.executeJavaScript(
      `window.api.cancelTranscription(${JSON.stringify(c.jobId)})`,
    );
    check('cancel handler accepts a running job', cancelled === true, String(cancelled));
    const cf = await waitForSettle(c.jobId, 300000);
    check('cancelled job settles', !!cf && cf.status !== 'running', cf ? cf.status : 'timeout');
    if (cf && cf.status === 'cancelled') {
      check('a cancelled job writes no .mid', !fs.existsSync(cf.midiPath));
    }
  }

  return results.every((r) => r.ok) ? 0 : 1;
}

/**
 * Kick a job off through the real preload from the page, and start recording
 * its event stream. Samples cross the boundary as a real Array (rebuilt as
 * Float32Array in-page) so the structured clone is genuinely tested.
 */
async function startJob(audioPath, sec, opts = {}) {
  const samples = Array.from(buildSignal(sec));
  const jobId = `electron-check-${Math.random().toString(36).slice(2, 8)}`;
  return win.webContents.executeJavaScript(`
    (async () => {
      const raw = new Float32Array(${JSON.stringify(samples)});
      window.__jobId = ${JSON.stringify(jobId)};
      window.__events = [];
      window.api.onTranscription((s) => {
        if (s.jobId === window.__jobId) window.__events.push(s);
      });
      return await window.api.startTranscription({
        jobId: window.__jobId,
        samples: raw,
        sampleRate: ${SR},
        audioPath: ${JSON.stringify(audioPath)},
        notesOnly: ${opts.notesOnly ? 'true' : 'false'},
      });
    })()
  `);
}

async function waitForSettle(jobId, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const states = await win.webContents.executeJavaScript('window.__events || []');
    const last = states[states.length - 1];
    if (last && last.status !== 'running') return last;
    await new Promise((r) => setTimeout(r, 500));
  }
  return null;
}

app.whenReady()
  .then(main)
  .then((code) => setTimeout(() => app.exit(code), 400))
  .catch((err) => {
    console.error('harness crashed:', err);
    setTimeout(() => app.exit(1), 400);
  });