// Shared types between main and renderer processes.
// Single source of truth so the IPC contract stays in sync.

export type Theme =
  | 'classic'
  | 'modern'
  | 'cyberpunk'
  | 'synthwave'
  | 'monochrome'
  | 'kawaii'
  | 'aqua'
  | 'sakura'
  | 'lime'
  | 'blood-red'
  | 'nocturnal'
  | 'black-ice'
  | 'aurora'
  | 'future';

/** Every theme, in menu order. The one list both the Settings panel and the
 *  right-click quick menu read from, so they can't drift apart. */
export const THEMES: readonly { value: Theme; label: string; swatch: string }[] = [
  { value: 'modern', label: 'Modern neon', swatch: '#7df9ff' },
  { value: 'classic', label: 'Classic green', swatch: '#00ff00' },
  { value: 'cyberpunk', label: 'Cyberpunk', swatch: '#fcee0a' },
  { value: 'synthwave', label: 'Synthwave', swatch: '#ff7700' },
  { value: 'monochrome', label: 'Monochrome', swatch: '#ffffff' },
  { value: 'kawaii', label: 'Hyper kawaii ✿', swatch: '#ff8fc7' },
  { value: 'aqua', label: 'Aqua', swatch: '#2dd4bf' },
  { value: 'sakura', label: 'Sakura', swatch: '#d8a0d8' },
  { value: 'lime', label: 'Lime green', swatch: '#39ff5a' },
  { value: 'blood-red', label: 'Blood red', swatch: '#ff1024' },
  { value: 'nocturnal', label: 'Nocturnal', swatch: '#6a8dff' },
  { value: 'black-ice', label: 'Black ice', swatch: '#7fe3f5' },
  { value: 'aurora', label: 'Aurora', swatch: '#5ef2d6' },
  { value: 'future', label: 'Future', swatch: '#ff3df5' },
];

export type VisualizerMode = 'oscilloscope' | 'spectrum' | 'spectrogram' | 'history' | 'midi';

/**
 * All visualizer modes, in the fixed order the split view lays them out.
 * (Chrome reads its mode list from this too, so the two can't drift apart.)
 */
export const VISUALIZER_MODES: readonly VisualizerMode[] = [
  'oscilloscope',
  'spectrum',
  'spectrogram',
  'history',
  'midi',
];

/** User-facing name for each visualizer mode (pane tags, add-tile buttons). */
export const VISUALIZER_LABELS: Record<VisualizerMode, string> = {
  oscilloscope: 'Oscilloscope',
  spectrum: 'Spectrum',
  spectrogram: 'Spectrogram',
  history: 'History',
  midi: 'MIDI',
};

/**
 * Presets offered by the quick visualizer-sensitivity menus (title bar +
 * right-click). Multiples of the neutral 1× draw-time gain.
 */
export const VIZ_GAIN_PRESETS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4] as const;

/** Preset rolling-buffer lengths in seconds offered by the quick menus. */
export const BUFFER_PRESETS_SEC = [60, 120, 300, 600, 900, 1800, 3600] as const;

/** Which quick menu the title-bar buttons ask main to pop up. */
export type TitleMenuKind = 'format' | 'gain' | 'buffer';

export type RecordMode = 'rolling' | 'traditional';
/**
 * On-disk container for saved recordings.
 *   - 'webm' = the raw MediaRecorder output (Opus in WebM). Cheapest, smallest.
 *   - 'wav'  = 16-bit PCM. Lossless, large, plays everywhere.
 *   - 'mp3'  = re-encoded to MP3 (via lamejs) at the configured bitrate.
 * wav / mp3 are produced from a decoded PCM copy at save time, so choosing one
 * costs a little CPU (and, in rolling mode, a parallel PCM buffer in RAM).
 */
export type RecordingFormat = 'webm' | 'wav' | 'mp3';
/**
 * Where audio comes from:
 *   - 'desktop'   = pick a screen/window from Electron desktopCapturer
 *   - 'loopback'  = per-output WASAPI loopback via the bundled NAudio helper
 */
export type CaptureBackend = 'desktop' | 'loopback';

/**
 * How much chrome the main window shows.
 *
 * The old 'compact' mode (title bar + single control row + visualizer) was
 * retired: the full layout already sheds chrome to a strip through its
 * height/width breakpoints, and the pop-out window covers the small-monitor
 * use case. The union keeps 'compact' so pre-existing settings files parse,
 * but main normalizes any stored 'compact' to 'full' (see settings.ts).
 */
export type UiLayout = 'full' | 'compact';

/** 'system' = the OS title bar; 'custom' = our own 26px frameless strip. */
export type TitleBarMode = 'system' | 'custom';

/** How button labels are rendered as the window narrows. */
export type LabelMode = 'auto' | 'icon' | 'text';

/** Where a snap request should put the window on its current display. */
export type SnapTarget =
  | 'top'
  | 'top-left'
  | 'top-right'
  | 'bottom'
  | 'left'
  | 'right'
  | 'center';

/** A source the user can pick for system audio capture (desktopCapturer). */
export interface CaptureSource {
  /** Stable id from Electron's desktopCapturer. */
  id: string;
  /** Human-readable name shown in the dropdown ("Entire Screen", "Spotify.exe", …). */
  name: string;
  /** 'screen' or 'window'. */
  kind: 'screen' | 'window' | 'app';
  /** Optional thumbnail as a data URL. */
  thumbnail?: string;
}

/** A render endpoint exposed by the WASAPI loopback helper. */
export interface LoopbackDevice {
  /** WASAPI device endpoint id (GUID string). */
  id: string;
  /** User-visible name ("Speakers (Realtek)", "Headphones (Corsair HS55)", …). */
  name: string;
  /** True if this is the system-default playback device. */
  isDefault: boolean;
  /** Best-known sample rate. */
  sampleRate: number;
  channelCount: number;
}

/** Persisted user settings. */
export interface AppSettings {
  /** Global hotkey, e.g. "Alt+R". */
  hotkey: string;
  /** Absolute path to a folder where recordings are written. */
  saveFolder: string;
  /** Which capture backend to use (desktopCapturer vs WASAPI loopback). */
  captureBackend: CaptureBackend;
  /** Last selected capture source id (desktop backend), or null for "no source yet". */
  sourceId: string | null;
  /** Last selected loopback device id (loopback backend), or null. */
  loopbackDeviceId: string | null;
  /** Rolling vs traditional recording. */
    recordMode: RecordMode;
    /**
     * Write a MIDI transcription beside each saved recording. See the note on the
     * default in DEFAULT_SETTINGS for why this is off by default.
     */
    transcribeOnSave: boolean;
  /** Visual theme. */
  theme: Theme;
  /**
   * The "primary" visualizer mode — the one a lone-pane view shows, and what
   * the smoothing / quick-menu / pop-out fallback key off. Kept in sync with
   * the first entry of the visible set (`VISUALIZER_MODES` minus `vizHidden`).
   */
  visualizer: VisualizerMode;
  /**
   * Modes NOT shown on the board. The board renders every mode in
   * `VISUALIZER_MODES` that isn't in here: one un-hidden mode → a single
   * interactive board; several → a read-only mosaic. The footer chips toggle
   * membership directly (there is no separate split/single switch). At least
   * one mode is always visible.
   */
  vizHidden: VisualizerMode[];
  /**
   * Visualizer sensitivity multiplier (0.5×–4×, 1× = neutral). Scales the
   * analyser data at draw time only, so recordings and their volume are
   * completely unaffected — it just makes quiet sources light up the
   * visualizers more.
   */
  vizGain: number;
  /**
   * Layered visualizer (todo.md section 11 DECISION 2026-10-07): draw a live
   * oscilloscope inset over the History board, at reduced opacity, behind this
   * toggle. The scope's ~43ms window can't share History's minutes-long time
   * axis, so it's a fixed-width inset at the right edge rather than a
   * full-width overlay. Off by default — it's an extra draw on top of History,
   * and most users want the plain waveform.
   */
  showOscilloscopeOverlay: boolean;
  /** Buffer length in seconds, applies to rolling mode. */
  bufferSeconds: number;
  /** Opus bitrate kbps. Also the target bitrate when saving as MP3 (clamped to 128–320). */
  bitrateKbps: number;
  /** Container written to disk on save (webm / wav / mp3). */
  recordingFormat: RecordingFormat;
  /** Whether the main window stays above other applications. */
  alwaysOnTop: boolean;
  /** Template used to name saved recordings. */
  fileNameTemplate: string;

  // ----- Interface ---------------------------------------------------------
  // Everything below is presentation-only: it changes how much room the app
  // takes up, never what it records. Each knob is user-facing so nobody is
  // stuck with a layout that doesn't suit their screen.

  /** How much chrome the main window shows. */
  uiLayout: UiLayout;
  /** OS title bar vs our own minimal strip (applies on window re-create). */
  titleBarMode: TitleBarMode;
  /** Button label strategy as the window narrows. */
  labelMode: LabelMode;
  /** Show the rolling-buffer waveform strip in the HUD. */
  showBuffer: boolean;
  /** Show the source / output-device picker in the footer. */
  showSourcePicker: boolean;
  /** Show the oscilloscope / spectrum / spectrogram chip row. */
  showVizChips: boolean;
  /** Show the "Hotkey: …" hint line. */
  showHint: boolean;
  /** Snap the window to a screen edge when dragged near one. */
  magneticSnap: boolean;
  /**
   * When docked to the top of a screen, register as a Windows appbar so the
   * desktop work area shrinks and other applications lay out *below* the strip
   * instead of being covered by it — the same mechanism the taskbar uses.
   *
   * Off by default: it changes the desktop layout for every application, which
   * is not something to opt a user into silently.
   */
  dockReservesSpace: boolean;
  /** Re-open the pop-out visualizer window on launch. */
  popoutOpen: boolean;
  /** Keep the pop-out above other windows. */
  popoutAlwaysOnTop: boolean;
  /** Pop-out window opacity, 0.2–1. */
  popoutOpacity: number;
  /** Render transport buttons inside the pop-out. */
  popoutControls: boolean;
  /** Hide the main window's visualizer while the pop-out is open. */
  hideBoardWhenPopped: boolean;
  /**
   * Hide the *whole* main window while the pop-out is open, so popping out
   * swaps windows instead of leaving two on screen. The tray icon and the
   * global hotkey still work, and closing the pop-out brings the main window
   * back — as does Show from the tray menu.
   */
  hideMainWhenPopped: boolean;
  /**
   * Shrink the main window past `AUTO_POPOUT_HEIGHT` and the pop-out takes
   * over, at the same bounds. The main window has no good small form — below
   * that height its HUD is a squashed strip with no way to change what it is
   * showing — whereas the pop-out is exactly that: chips, transport, waveform.
   * Closing the pop-out gives the main window back at a usable size.
   */
  autoPopoutWhenSmall: boolean;
}

/**
 * Main-window height at or below which the pop-out takes over. The HUD's own
 * breakpoints start dropping controls at 190px; below that there is nothing
 * left worth looking at.
 */
export const AUTO_POPOUT_HEIGHT = 190;

export const DEFAULT_SETTINGS: AppSettings = {
  hotkey: 'Alt+R',
  saveFolder: '',
  captureBackend: 'desktop',
  sourceId: null,
  loopbackDeviceId: null,
  recordMode: 'rolling',
  theme: 'aurora',
  visualizer: 'oscilloscope',
  // Everything except the primary mode starts hidden → a single board.
  vizHidden: ['spectrum', 'spectrogram', 'history', 'midi'],
  vizGain: 1,
  showOscilloscopeOverlay: false,
  bufferSeconds: 5 * 60,
  bitrateKbps: 96,
  recordingFormat: 'webm',
    alwaysOnTop: false,
    /**
     * Write a MIDI transcription beside each saved recording.
     *
     * OFF by default deliberately. Transcription runs at ~0.7x realtime on the
     * pure-JS backend (spikes/002-tfjs-backend-bench/), so a 15-minute buffer
     * costs ~20 CPU-minutes. Opting in once in Settings is cheap; discovering
     * that cost by accident is how the feature gets turned off for good. Clips
     * (10-60s) are comfortably viable when it's on.
     *
     * When on, the audio is still written FIRST and immediately — the `.mid`
     * appears afterwards. Transcription never blocks or fails a save.
     */
    transcribeOnSave: false,
  fileNameTemplate: 'recordr_{date}_{time}',

  uiLayout: 'full',
  titleBarMode: 'custom',
  labelMode: 'auto',
  showBuffer: true,
  // Off by default: the device lives in the right-click quick menu and in
  // Settings, and on a short window the footer strip was costing the
  // visualizer more height than the picker was worth.
  showSourcePicker: false,
  showVizChips: true,
  showHint: true,
  magneticSnap: true,
  dockReservesSpace: false,
  popoutOpen: false,
  popoutAlwaysOnTop: true,
  popoutOpacity: 1,
  popoutControls: true,
  hideBoardWhenPopped: false,
  hideMainWhenPopped: true,
  autoPopoutWhenSmall: true,
};

/**
 * Minimum window size per layout, in CSS px. `bar` is deliberately tiny — it
 * only has to fit one row of icon buttons — and main clamps the window to
 * these numbers whenever the layout changes.
 */
export const LAYOUT_MIN_SIZE: Record<UiLayout, { width: number; height: number }> = {
  full: { width: 240, height: 190 },
  compact: { width: 200, height: 32 },
};

/**
 * Tokens supported in `fileNameTemplate`. The renderer surfaces these as
 * clickable chips; main's save.ts substitutes them at save time.
 */
export const FILENAME_TOKENS = [
  { token: '{date}', label: 'date', example: '2026-08-15' },
  { token: '{time}', label: 'time', example: '14-32-05' },
  { token: '{year}', label: 'year', example: '2026' },
  { token: '{month}', label: 'month', example: '08' },
  { token: '{day}', label: 'day', example: '15' },
  { token: '{hour}', label: 'hour', example: '14' },
  { token: '{minute}', label: 'minute', example: '32' },
  { token: '{second}', label: 'second', example: '05' },
  { token: '{unix}', label: 'unix', example: '1755276725' },
  { token: '{mode}', label: 'mode', example: 'rolling' },
  { token: '{device}', label: 'device', example: 'Speakers' },
  { token: '{counter}', label: 'counter', example: '0003' },
] as const;

/** Result of saving a recording. */
export interface SaveResult {
  ok: boolean;
  path?: string;
  bytes?: number;
  fileName?: string;
  error?: string;
}

/** One transcribed note; the shape the piano-roll lane draws (and FAZE can import). */
export interface TranscribedNote {
  pitch: number;
  startSec: number;
  durationSec: number;
  /** 0..1 */
  velocity: number;
}

/**
 * State of one MIDI transcription job. Shared between main, preload and the
 * renderer so progress can be reported over IPC without leaking main-only types.
 */
export interface TranscribeJobState {
  jobId: string;
  /** The audio file that was already saved. Never modified by transcription. */
  audioPath: string;
  /** Where the `.mid` will be written — same folder, same stem, `.mid`. */
  midiPath: string;
  status: 'running' | 'done' | 'cancelled' | 'error';
  /** 0..1 inference progress. */
  fraction: number;
  noteCount?: number;
  /** The transcribed notes (seconds from the start of the audio). Set when done. */
  notes?: TranscribedNote[];
  elapsedMs?: number;
  /** Realtime multiple, e.g. 0.66 means inference took longer than the clip. */
  ratio?: number;
  error?: string;
}

/** Note layer to be displayed in the piano-roll lane. */
export interface NoteLayer {
  /** Session seconds of the slice's first sample — note times are relative to this. */
  startSec: number;
  /** Length of the transcribed slice in seconds. */
  durationSec: number;
  notes: TranscribedNote[];
  /** Short range label for the lane's corner, e.g. `12.4–18.9s`. */
  label: string;
  /**
   * True while these notes come from the live YIN tracker rather than a Basic
   * Pitch transcription (todo.md §MIDI-1 Phase B).
   *
   * The distinction is shown rather than hidden: live notes draw in a dim tint
   * and a layer stays `live` until a real transcription replaces it. A YIN
   * estimate is monophonic and cheap, so drawing it identically to a
   * transcription would claim a precision it does not have — which is also why
   * it is kept out of the `.mid` export.
   */
  live?: boolean;
}

/** Channels used on the IPC bus. */
export const IpcChannel = {
  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
  sourcesList: 'sources:list',
  sourcesPick: 'sources:pick',
  folderPick: 'folder:pick',
  saveRecording: 'recording:save',
  /**
   * Queue a MIDI transcription for an already-saved recording. Runs in a
   * worker thread; the `.mid` is written beside the audio when it finishes.
   */
  transcribeStart: 'transcribe:start',
  transcribeCancel: 'transcribe:cancel',
  /** Main -> renderer: a transcription job's progress or completion. */
  transcribeEvent: 'transcribe:event',
  /**
   * Renderer → main: the current History/spectrogram selection, as absolute
   * session seconds (null when there is none). Main keeps the latest value so
   * the native quick menu can offer "Save selection" from either window —
   * including the pop-out while the main window is hidden.
   */
  selectionChanged: 'selection:changed',
  /** Main → renderer: the user picked "Save selection" in the quick menu. */
  requestSaveSelection: 'recording:request-save-selection',
  dragExport: 'drag:export',
  /** Build a Standard MIDI File from a transcribed note list (notes->bytes). */
  notesToMidi: 'transcribe:notes-to-midi',
  recordingEvent: 'recording:event',
  hotkeySet: 'hotkey:set',
  loopbackList: 'loopback:list',
  loopbackStart: 'loopback:start',
  loopbackStop: 'loopback:stop',
  loopbackSamples: 'loopback:samples',
  loopbackEvent: 'loopback:event',
  /** Stream a dedicated clip recording straight to a temp file on disk. */
  clipStart: 'clip:start',
  clipAppend: 'clip:append',
  clipRead: 'clip:read',
  clipAbort: 'clip:abort',
  /** Main renderer → main: show/hide the always-on-top clip-recording window. */
  clipWindowSet: 'clip:window-set',
  /** Main → clip window: the timer/format/theme it should display. */
  clipWindowState: 'clip:window-state',
  windowSetAlwaysOnTop: 'window:set-always-on-top',
  openSettings: 'window:open-settings',
  traySetCapturing: 'tray:set-capturing',
  settingsChanged: 'settings:changed',
  windowControl: 'window:control',
  windowSnap: 'window:snap',
  windowApplyLayout: 'window:apply-layout',
  windowTempExpand: 'window:temp-expand',
  windowState: 'window:state',
  contextMenu: 'window:context-menu',
  popoutToggle: 'popout:toggle',
  /** Give one visualizer its own window (a pane's ⧉). */
  popoutPane: 'popout:pane',
  popoutState: 'popout:state',
  vizFrame: 'viz:frame',
  vizState: 'viz:state',
  vizCommand: 'viz:command',
  /** Clip window -> main window. Distinct from viz:command so the clip
      window's stop/discard buttons keep working with no pop-out open. */
  clipCommand: 'clip:command',
  vizHistory: 'viz:history',
  dragExportProxy: 'drag:export-proxy',
  requestDragExport: 'drag:request-export',
  dragPrepare: 'drag:prepare',
  dragExportPrepared: 'drag:export-prepared',
  /** Pop a native menu for a title-bar knob (format / sensitivity / buffer). */
  titleMenu: 'titlebar:menu',
} as const;

/** Simple window verbs the custom title bar can ask main to perform. */
export type WindowAction = 'minimize' | 'maximize' | 'restore-or-max' | 'hide' | 'close';

/** What the main renderer streams to the pop-out visualizer, ~30×/s. */
export interface VizFrame {
  /** Time-domain samples, one AnalyserNode fftSize window. */
  time: Float32Array;
  /** Frequency bins in dB. */
  freq: Float32Array;
  minDecibels: number;
  maxDecibels: number;
}

/**
 * Main window → pop-out: the rolling peak track plus its session clock.
 *
 * The pop-out reconstructs a `HistoryModel` from this. `newestSec` is the
 * session-relative second of the newest bucket as stamped by the main window,
 * so both windows agree on what a selection's absolute seconds mean even
 * though each renderer's `performance.now()` has an independent origin
 * (todo.md §11.4, D1).
 */
export interface HistoryStream {
  buffer: Float32Array;
  head: number;
  count: number;
  capacity: number;
  /** Session-relative seconds of the newest bucket at capture time. */
  newestSec: number;
}

/** Slower-moving state the pop-out mirrors (sent only when it changes). */
export interface VizState {
  capturing: boolean;
  hasSource: boolean;
  canSave: boolean;
  /** A dedicated clip recording is in progress. */
  clipActive: boolean;
  /** Epoch ms when the active clip started (0 when none) — for the live
   *  stopwatch on the pop-out's record button. */
  clipStartedAt: number;
  /** Container a save will be written as — shown on the pop-out's buttons. */
  format: RecordingFormat;
  bufferedSeconds: number;
  bufferSeconds: number;
  recordMode: RecordMode;
  theme: Theme;
  visualizer: VisualizerMode;
  /**
   * When non-null, the pop-out shows ONLY this visualizer, pinned from a
   * split-view pane's ⧉ button, instead of mirroring the main window's view.
   * Transient (not a setting): cleared when the pop-out closes.
   */
  overrideMode: VisualizerMode | null;
  rms: number;
  /** MIDI notes to be displayed in the piano-roll lane when the visualizer is 'midi'. */
  pianoRoll?: NoteLayer | null;
}

/**
 * What the always-on-top clip-recording window shows. `active: false` tells it
 * to close. Sent by the main renderer (which owns the clip recorder) and
 * relayed by main.
 */
export interface ClipWindowState {
  active: boolean;
  /** Epoch ms the clip started (for the live timer). */
  startedAt: number;
  format: RecordingFormat;
  theme: Theme;
}

/**
 * Commands the pop-out sends back to the main renderer.
 *
 * The clip window's stop/discard buttons ride a separate `clip:command`
 * channel (`ClipCommand`) rather than this one — the clip window is not the
 * pop-out and must keep working with it closed.
 */
export type VizCommand =
  | { type: 'toggle-capture' }
  | { type: 'save' }
  | { type: 'toggle-clip' }
  | { type: 'discard-clip' }
  | { type: 'set-visualizer'; mode: VisualizerMode }
  | { type: 'set-override'; mode: VisualizerMode | null }
  | { type: 'selection-change'; selection: [number, number] | null; mode?: VisualizerMode }
  | { type: 'export-midi' }
  | { type: 'clear-buffer' };

/** The clip window's two buttons, relayed to the main renderer. */
export type ClipCommand = { type: 'toggle-clip' } | { type: 'discard-clip' };

export type RecorderEvent =
  | { type: 'saved'; path: string; bytes: number; durationSec: number }
  | { type: 'error'; message: string }
  | { type: 'hotkey-pressed' };

export type LoopbackEvent =
  | { type: 'started'; deviceId: string; deviceName: string }
  | { type: 'stopped' }
  | { type: 'error'; message: string };
