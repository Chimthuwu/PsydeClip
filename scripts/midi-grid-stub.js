/**
 * Preload for the MIDI-grid verification harness (`midi-grid-check.js`).
 *
 * Runs before the renderer bundle, which is the only ordering that lets a stub
 * exist before module-level code executes. Deliberately separate from the real
 * `dist/preload/index.js`: this harness must not be able to pass by exercising
 * the shipped bridge, since it replaces `window.api` wholesale.
 *
 * WHAT IS STUBBED, AND WHY IT IS THE RIGHT LINE
 * ---------------------------------------------
 * The thing under test is the pitch TRACKER and the grid DRAWING, and both need
 * audio frames. No capture device exists on this box, and live audio testing is
 * off-limits by the owner's standing rule — so audio has to be synthesised.
 *
 * An earlier version of this harness replaced `window.AudioContext`, and that was
 * wrong twice over: it stubbed out the analyser path the feature actually reads
 * (so a green result would have proved nothing), and it never supplied an
 * AudioWorklet, which the real loopback path builds its stream from.
 *
 * So instead: `window.api.onLoopbackSamples` feeds synthesised PCM in EXACTLY the
 * shape main's WASAPI helper sends it (interleaved Float32 stereo), and the REAL
 * Web Audio graph runs — real AudioContext, real AudioWorklet, real AnalyserNode.
 * Every line of the renderer's audio path and of the tracker is shipped code.
 * Only the audio CONTENT is fake, and it is a known melody whose notes are known
 * in advance, so "the right notes were drawn" is checkable.
 *
 * Installed with contextIsolation OFF (see midi-grid-check.js): isolation is
 * irrelevant to note drawing, and off is one fewer moving part.
 */

const SR = 44100;
/** A scale walked every HOLD_MS, so distinct notes give distinct bars. */
const MELODY = [523.25, 587.33, 659.25, 783.99, 659.25, 587.33]; // C5 D5 E5 G5 E5 D5
const HOLD_MS = 700;

let phase = 0;
const startedAt = Date.now();
const toneHz = () => MELODY[Math.floor((Date.now() - startedAt) / HOLD_MS) % MELODY.length];

/**
 * `onLoopbackSamples` listeners the renderer registered, plus a switch to stop
 * the audio — so a check can prove the CPU gate by silencing the source.
 */
const sampleSubs = [];
let audioRunning = true;

function emitFrames() {
  if (!audioRunning) return;
  const FRAME = 1024; // stereo samples per frame, as main sends them
  const buf = new Float32Array(FRAME * 2);
  const hz = toneHz();
  for (let i = 0; i < FRAME; i++) {
    phase += (2 * Math.PI * hz) / SR;
    const v = 0.4 * Math.sin(phase) + 0.18 * Math.sin(2 * phase);
    buf[i * 2] = v;
    buf[i * 2 + 1] = v;
  }
  // Byte view over the same buffer — what the structured clone actually delivers.
  const u8 = new Uint8Array(buf.buffer);
  for (const fn of sampleSubs.slice()) {
    try {
      fn(u8);
    } catch {
      /* the renderer unsubscribed mid-emit */
    }
  }
}
setInterval(emitFrames, 20);

const noop = () => () => {};

const api = {
  getSettings: async () => ({
    hotkey: 'Alt+R',
    saveFolder: '',
    captureBackend: 'loopback',
    loopbackDeviceId: 'fake-dev',
    sourceId: null,
    // 'traditional' makes App's `capturing=true` mean "a bounded recording is
    // running", which is what arms live tracking. With 'rolling', capturing is
    // the always-on monitor and must NOT arm it — a check that passed there
    // would prove nothing about the gate.
    recordMode: 'traditional',
    transcribeOnSave: false,
    theme: 'modern',
    visualizer: 'midi',
    // Only the MIDI board on screen. The default is a 5-pane mosaic whose first
    // <canvas> is the OSCILLOSCOPE — a harness sampling that reports "no notes
    // drawn" no matter what the grid was doing.
    vizHidden: ['oscilloscope', 'spectrum', 'spectrogram', 'history'],
    vizGain: 1,
    showMidiLane: true,
    showOscilloscopeOverlay: false,
    bitrateKbps: 128,
    bufferSeconds: 300,
    recordingFormat: 'webm',
    showVizChips: true,
    showSourcePicker: false,
    uiLayout: 'full',
    titleBarMode: 'custom',
    fileNameTemplate: 'recordr_{date}_{time}',
    showBuffer: true,
    magneticSnap: true,
    dockReservesSpace: false,
    showHint: true,
    labelMode: 'auto',
    alwaysOnTop: false,
    startHidden: false,
  }),
  setSettings: async (patch) => patch,
  onSettingsChanged: noop,
  listLoopbackDevices: async () => [{ id: 'fake-dev', name: 'Fake Speakers', sampleRate: SR }],
  listSources: async () => [],
  // The synthesised-audio seam. Shape matches src/main/wasapi.ts's contract:
  // little-endian interleaved Float32 stereo frames.
  onLoopbackSamples: (fn) => {
    sampleSubs.push(fn);
    return () => {
      const i = sampleSubs.indexOf(fn);
      if (i >= 0) sampleSubs.splice(i, 1);
    };
  },
  onLoopbackEvent: noop,
  startLoopback: async () => ({ ok: true }),
  stopLoopback: async () => ({ ok: true }),
  onRecorderEvent: noop,
  onWindowState: noop,
  setTrayCapturing: () => {},
  setAlwaysOnTop: () => {},
  applyLayout: () => {},
  tempExpandWindow: () => {},
  onOpenSettingsRequest: noop,
  setClipWindow: () => {},
  onClipCommand: noop,
  selectionChanged: () => {},
  onRequestSaveSelection: noop,
  showContextMenu: () => {},
  showTitleMenu: () => {},
  windowControl: async () => ({ ok: true }),
  snapWindow: async () => ({ ok: true }),
  onClipWindowState: noop,
  sendClipCommand: () => {},
  prepareDragFile: () => {},
  startDragExportPrepared: () => {},
  startDragExport: async () => ({ ok: true }),
  pickFolder: async () => null,
  platform: 'win32',
  saveRecording: async () => ({ ok: false, error: 'stub' }),
  clipStart: async () => ({ ok: true }),
  clipAppend: async () => ({ ok: true }),
  clipRead: async () => null,
  clipAbort: async () => ({ ok: true }),
  startTranscription: async () => ({ jobId: 'x', status: 'error', error: 'stub' }),
  onTranscription: noop,
  cancelTranscription: () => false,
  notesToMidi: async () => new Uint8Array(),
};

// Harness control surface, kept off `window.api` so it cannot be confused with
// the app's own bridge.
globalThis.api = api;
globalThis.__midiStub = {
  setAudio(on) {
    audioRunning = on;
  },
  subscriberCount() {
    return sampleSubs.length;
  },
  /** True once the real renderer subscribed — proof the audio path is bound. */
  bound() {
    return sampleSubs.length > 0;
  },
};
