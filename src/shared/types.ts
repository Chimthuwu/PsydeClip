// Shared types between main and renderer processes.
// Single source of truth so the IPC contract stays in sync.

export type Theme =
  | 'classic'
  | 'modern'
  | 'cyberpunk'
  | 'synthwave'
  | 'monochrome'
  | 'kawaii';
export type VisualizerMode = 'oscilloscope' | 'spectrum' | 'spectrogram';
export type RecordMode = 'rolling' | 'traditional';
/**
 * Where audio comes from:
 *   - 'desktop'   = pick a screen/window from Electron desktopCapturer
 *   - 'loopback'  = per-output WASAPI loopback via the bundled NAudio helper
 */
export type CaptureBackend = 'desktop' | 'loopback';

/**
 * How much chrome the main window shows.
 *   - 'full'    = title bar + HUD + visualizer + footer (the original layout)
 *   - 'compact' = title bar + a single control row + visualizer
 *   - 'bar'     = one thin strip: transport + meter only, no visualizer.
 *                 Meant to be docked to the top edge of a monitor.
 */
export type UiLayout = 'full' | 'compact' | 'bar';

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
  /** Global hotkey, e.g. "Shift+Alt+R". */
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
  /** Visual theme. */
  theme: Theme;
  /** Active visualizer mode. */
  visualizer: VisualizerMode;
  /** Buffer length in seconds, applies to rolling mode. */
  bufferSeconds: number;
  /** Opus bitrate kbps. */
  bitrateKbps: number;
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
  /** Show the VU meter row in the HUD. */
  showVu: boolean;
  /** Show the rolling-buffer fill bar in the HUD. */
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
}

export const DEFAULT_SETTINGS: AppSettings = {
  hotkey: 'Shift+Alt+R',
  saveFolder: '',
  captureBackend: 'desktop',
  sourceId: null,
  loopbackDeviceId: null,
  recordMode: 'rolling',
  theme: 'modern',
  visualizer: 'oscilloscope',
  bufferSeconds: 15 * 60,
  bitrateKbps: 96,
  alwaysOnTop: false,
  fileNameTemplate: 'recordr_{date}_{time}',

  uiLayout: 'full',
  titleBarMode: 'custom',
  labelMode: 'auto',
  showVu: true,
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
};

/**
 * Minimum window size per layout, in CSS px. `bar` is deliberately tiny — it
 * only has to fit one row of icon buttons — and main clamps the window to
 * these numbers whenever the layout changes.
 */
export const LAYOUT_MIN_SIZE: Record<UiLayout, { width: number; height: number }> = {
  full: { width: 240, height: 190 },
  compact: { width: 200, height: 120 },
  bar: { width: 180, height: 34 },
};

/** Height the window is snapped to when entering `bar` layout. */
export const BAR_LAYOUT_HEIGHT = 38;

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

/** Channels used on the IPC bus. */
export const IpcChannel = {
  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
  sourcesList: 'sources:list',
  sourcesPick: 'sources:pick',
  folderPick: 'folder:pick',
  saveRecording: 'recording:save',
  recordingEvent: 'recording:event',
  hotkeySet: 'hotkey:set',
  loopbackList: 'loopback:list',
  loopbackStart: 'loopback:start',
  loopbackStop: 'loopback:stop',
  loopbackSamples: 'loopback:samples',
  loopbackEvent: 'loopback:event',
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
  popoutState: 'popout:state',
  vizFrame: 'viz:frame',
  vizState: 'viz:state',
  vizCommand: 'viz:command',
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

/** Slower-moving state the pop-out mirrors (sent only when it changes). */
export interface VizState {
  capturing: boolean;
  hasSource: boolean;
  canSave: boolean;
  bufferedSeconds: number;
  bufferSeconds: number;
  recordMode: RecordMode;
  theme: Theme;
  visualizer: VisualizerMode;
  rms: number;
}

/** Commands the pop-out sends back to the main renderer. */
export type VizCommand =
  | { type: 'toggle-capture' }
  | { type: 'save' }
  | { type: 'set-visualizer'; mode: VisualizerMode };

export type RecorderEvent =
  | { type: 'saved'; path: string; bytes: number; durationSec: number }
  | { type: 'error'; message: string }
  | { type: 'hotkey-pressed' };

export type LoopbackEvent =
  | { type: 'started'; deviceId: string; deviceName: string }
  | { type: 'stopped' }
  | { type: 'error'; message: string };
