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
} as const;

export type RecorderEvent =
  | { type: 'saved'; path: string; bytes: number; durationSec: number }
  | { type: 'error'; message: string }
  | { type: 'hotkey-pressed' };

export type LoopbackEvent =
  | { type: 'started'; deviceId: string; deviceName: string }
  | { type: 'stopped' }
  | { type: 'error'; message: string };
