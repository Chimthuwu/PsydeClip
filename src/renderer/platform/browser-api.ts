/**
 * A browser implementation of the `Api` object the Electron preload exposes.
 *
 * Why this exists: the renderer is already isolated behind `window.api` — there
 * are zero `electron` imports under `src/renderer/` and all 38 capabilities the
 * UI uses go through this one object — so implementing the object is what lets
 * the same UI run inside a Capacitor webview on Android. See todo.md §7
 * ("NEXT: an Android version") and the DECISION commit `9086b0f`.
 *
 * This is a build target, NOT a web release: `npm run build:browser` emits
 * `dist/browser/`, which nothing serves. The browser port proper was ruled out.
 *
 * Honesty rule for this file: anything with no browser analogue is an explicit,
 * documented no-op — never a silent lie. The two lists:
 *
 * Real:
 *   settings get/set + change broadcast (localStorage, see browser-settings.ts)
 *   save (File System Access API handle when one was picked, else a download)
 *   notesToMidi (@tonejs/midi, same mapping as the main-process engine)
 *   clip temp file (in memory), pickFolder (showDirectoryPicker),
 *   listSources (one synthetic source), window focus state, the clip-command bus
 *
 * Documented no-ops / unavailable:
 *   the tray, the native context + title menus (DOM popovers are a later step),
 *   the global hotkey, window chrome (windowControl / snapWindow / applyLayout /
 *   tempExpandWindow), the always-on-top clip window, native drag-out
 *   (startDragExport falls back to a download), and the WASAPI loopback backend
 *   (no browser equivalent — capture goes through getDisplayMedia on the
 *   `desktop` backend instead, see lib/audio-capture.ts).
 */
import {
  AppSettings,
  CaptureSource,
  ClipCommand,
  ClipWindowState,
  HistoryStream,
  LoopbackDevice,
  LoopbackEvent,
  RecorderEvent,
  SaveResult,
  SnapTarget,
  TitleMenuKind,
  TranscribeJobState,
  TranscribedNote,
  UiLayout,
  VizCommand,
  VizFrame,
  VizState,
  WindowAction,
} from '../../shared/types';
import type { Api } from '../../preload/index';
import { createSettingsStore, KeyValueStore } from '../lib/browser-settings';
import { formatFileName, nextSaveCounter } from '../../shared/file-name';

/**
 * The single synthetic source the browser target offers.
 *
 * The `display:` prefix is deliberate: `useCapture.bindDesktop` refuses any id
 * that isn't a `screen:` one, because on Windows only a *screen* capture
 * carries the loopback audio mixer. A browser has no such rule — the user's
 * choice happens in the browser's own picker — so the shim marks its source
 * with a prefix the renderer can recognise and the guard can allow.
 */
export const BROWSER_SOURCE_ID = 'display:system';

/** Minimal pub/sub so the shim's events have somewhere to come from. */
function bus<T>() {
  const listeners = new Set<(value: T) => void>();
  return {
    emit(value: T): void {
      for (const listener of listeners) listener(value);
    },
    on(listener: (value: T) => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** Web Storage, or a no-op stand-in when the page is denied it. */
function defaultStorage(): KeyValueStore {
  try {
    const probe = '__recordr_probe__';
    window.localStorage.setItem(probe, '1');
    window.localStorage.removeItem(probe);
    return window.localStorage;
  } catch {
    const memory = new Map<string, string>();
    return {
      getItem: (k) => (memory.has(k) ? memory.get(k)! : null),
      setItem: (k, v) => void memory.set(k, v),
    };
  }
}

function mimeFor(ext: string | undefined): string {
  switch ((ext ?? 'webm').toLowerCase()) {
    case 'wav':
      return 'audio/wav';
    case 'mp3':
      return 'audio/mpeg';
    case 'mid':
      return 'audio/midi';
    default:
      return 'audio/webm';
  }
}

/** Hand the bytes to the browser as a download. */
function downloadBlob(bytes: Uint8Array, fileName: string, ext?: string): void {
  // Copy into a plain ArrayBuffer: a Uint8Array may be backed by a
  // SharedArrayBuffer, which is not a valid BlobPart.
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  const url = URL.createObjectURL(new Blob([buffer], { type: mimeFor(ext) }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Revoke late: revoking synchronously can cancel the download in some builds.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * Build the browser `Api`.
 *
 * `storage` is injectable so a test (or a Capacitor plugin with a better
 * backend) can supply its own.
 */
export function createBrowserApi(storage: KeyValueStore = defaultStorage()): Api {
  const store = createSettingsStore(storage);

  const recorderEvents = bus<RecorderEvent>();
  const clipCommands = bus<ClipCommand>();
  const clipWindowStates = bus<ClipWindowState>();
  const loopbackSamples = bus<Uint8Array>();
  const loopbackEvents = bus<LoopbackEvent>();
  const settingsRequests = bus<void>();

  /** In-memory stand-in for the Electron clip temp file (`%TEMP%/recordr-clips`). */
  let clipChunks: Uint8Array[] = [];

  /** A picked directory handle, when the File System Access API is available. */
  let directoryHandle: { name: string; createWritable?: unknown; getFileHandle?: unknown } | null =
    null;

  const api: Api = {
    // ------- Settings --------------------------------------------------------

    async getSettings(): Promise<AppSettings> {
      return store.read();
    },
    async setSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
      return store.write(patch);
    },

    // ------- Sources ---------------------------------------------------------

    async listSources(): Promise<CaptureSource[]> {
      // A browser cannot enumerate screens/windows: the user picks inside the
      // browser's own share dialog, which only exists during getDisplayMedia().
      // So this advertises the capability, not a list.
      return [
        {
          id: BROWSER_SOURCE_ID,
          name: 'Screen or tab audio (chosen in the browser picker)',
          kind: 'screen',
        },
      ];
    },

    async pickFolder(): Promise<string | null> {
      const picker = (window as unknown as { showDirectoryPicker?: (o?: unknown) => Promise<any> })
        .showDirectoryPicker;
      if (typeof picker !== 'function') return null; // Firefox / Safari: download instead
      try {
        directoryHandle = await picker({ mode: 'readwrite' });
        return directoryHandle?.name ?? null;
      } catch {
        return null; // user cancelled
      }
    },

    // ------- Saving ----------------------------------------------------------

    async saveRecording(args: {
      folder: string;
      bytes: Uint8Array;
      ext?: string;
      durationSec?: number;
      deviceName?: string;
    }): Promise<SaveResult> {
      const settings = store.read();
      const fileName = formatFileName(settings.fileNameTemplate, {
        settings,
        deviceName: args.deviceName,
        counter: nextSaveCounter(),
        ext: args.ext,
      });
      const bytes =
        args.bytes instanceof Uint8Array ? args.bytes : new Uint8Array(args.bytes as ArrayBuffer);
      try {
        if (directoryHandle?.createWritable) {
          const fileHandle = await (directoryHandle as any).getFileHandle(fileName, { create: true });
          const writable = await fileHandle.createWritable();
          await writable.write(bytes);
          await writable.close();
          return {
            ok: true,
            path: `${directoryHandle.name}/${fileName}`,
            bytes: bytes.byteLength,
            fileName,
          };
        }
        downloadBlob(bytes, fileName, args.ext);
        return { ok: true, path: fileName, bytes: bytes.byteLength, fileName };
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        recorderEvents.emit({ type: 'error', message } as RecorderEvent);
        return { ok: false, error: message };
      }
    },

    /**
     * No native drag-out in a browser. Downloading is the honest fallback: the
     * file lands in the user's downloads, which is what the drag achieved.
     */
    startDragExport(args: { bytes: Uint8Array; deviceName?: string; ext?: string }): void {
      const settings = store.read();
      const fileName = formatFileName(settings.fileNameTemplate, {
        settings,
        deviceName: args.deviceName,
        counter: nextSaveCounter(),
        ext: args.ext,
      });
      downloadBlob(args.bytes, fileName, args.ext);
    },

    // ------- Pop-out window ---------------------------------------------------
    //
    // The pop-out is a second Electron OS window that draws from frames the main
    // renderer streams over IPC. A browser page has no second window to stream
    // into and no drag-proxy window, so every member here is a documented no-op
    // and the UI that reaches them is Electron-only. `togglePopout` answers
    // `open: false` rather than throwing, so a caller cannot mistake "no second
    // window here" for a crash.

    async togglePopout(_open?: boolean, _opts?: { keepMain?: boolean }): Promise<{ open: boolean }> {
      return { open: false };
    },
    onPopoutState(_handler: (s: { open: boolean }) => void): () => void {
      /* no-op: nothing ever opens a second window */
      return () => {};
    },
    sendVizFrame(_frame: VizFrame): void {
      /* no-op: no pop-out is listening */
    },
    sendVizState(_state: VizState): void {
      /* no-op: no pop-out is listening */
    },
    sendVizHistory(_state: HistoryStream): void {
      /* no-op: no pop-out is listening */
    },
    sendVizCommand(_cmd: VizCommand): void {
      /* no-op: no pop-out is listening */
    },
    onVizFrame(_handler: (f: VizFrame) => void): () => void {
      return () => {};
    },
    onVizState(_handler: (s: VizState) => void): () => void {
      return () => {};
    },
    onVizHistory(_handler: (s: HistoryStream) => void): () => void {
      return () => {};
    },
    onVizCommand(_handler: (c: VizCommand) => void): () => void {
      return () => {};
    },

    /** No drag-proxy window; startDragExport downloads instead. */
    startDragExportByProxy(_bounds: [number, number]): void {
      /* no-op: the download fallback covers it */
    },
    onRequestDragExport(_handler: (bounds: [number, number]) => void): () => void {
      return () => {};
    },

    async notesToMidi(notes: TranscribedNote[], bpm?: number): Promise<Uint8Array> {
      // Imported lazily: only the MIDI export path needs it, and it is ~50 kB.
      const { Midi } = await import('@tonejs/midi');
      const midi = new Midi();
      midi.header.setTempo(bpm ?? 120);
      const track = midi.addTrack();
      track.channel = 0;
      for (const note of notes) {
        track.addNote({
          midi: note.pitch,
          time: note.startSec,
          duration: note.durationSec,
          velocity: Math.max(1, Math.min(127, Math.round(note.velocity * 127))),
        });
      }
      return new Uint8Array(midi.toArray());
    },

    // ------- Transcription ---------------------------------------------------

    /**
     * Not wired on this target yet. Basic Pitch is browser-capable, but the
     * Electron path runs it in a worker thread with a vendored model and this
     * shim does not own that pipeline — so it reports a job that failed, rather
     * than pretending to have transcribed something.
     */
    async startTranscription(args: {
      jobId: string;
      samples: Float32Array;
      sampleRate: number;
      audioPath: string;
      notesOnly?: boolean;
    }): Promise<TranscribeJobState> {
      const state: TranscribeJobState = {
        jobId: args.jobId,
        audioPath: args.audioPath,
        midiPath: '',
        status: 'error',
        fraction: 0,
        error: 'MIDI transcription is not implemented on the browser target yet.',
      };
      transcriptionStates.emit(state);
      return state;
    },
    async cancelTranscription(): Promise<boolean> {
      return false;
    },
    onTranscription(cb: (state: TranscribeJobState) => void): () => void {
      return transcriptionStates.on(cb);
    },

    /** No native drag source to prepare. */
    prepareDragFile(): void {
      /* no-op: browsers drag out real files, not synthesised temp ones */
    },
    startDragExportPrepared(): void {
      /* no-op: see startDragExport */
    },

    /**
     * Nothing emits these on this target: the browser build saves through
     * `saveRecording`, which returns its own result. Kept as a live bus so the
     * hook that subscribes to it does not need a target check.
     */
    onRecorderEvent(handler: (e: RecorderEvent) => void): () => void {
      return recorderEvents.on(handler);
    },

    // ------- Clip recording (in memory) --------------------------------------

    async clipStart(): Promise<{ ok: boolean; error?: string }> {
      clipChunks = [];
      return { ok: true };
    },
    clipAppend(bytes: Uint8Array): void {
      clipChunks.push(bytes);
    },
    async clipRead(): Promise<Uint8Array | null> {
      if (clipChunks.length === 0) return null;
      const total = clipChunks.reduce((n, c) => n + c.byteLength, 0);
      const out = new Uint8Array(total);
      let offset = 0;
      for (const chunk of clipChunks) {
        out.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return out;
    },
    clipAbort(): void {
      clipChunks = [];
    },

    /** No second OS window on this target; the state is broadcast in-page. */
    setClipWindow(state: ClipWindowState): void {
      clipWindowStates.emit(state);
    },
    onClipWindowState(handler: (s: ClipWindowState) => void): () => void {
      return clipWindowStates.on(handler);
    },

    /** Always-on-top is an OS window concept — nothing to do. */
    setAlwaysOnTop(): void {
      /* no-op */
    },
    /** There is no tray. A notification-shade control is a later step. */
    setTrayCapturing(): void {
      /* no-op */
    },
    onOpenSettingsRequest(handler: () => void): () => void {
      return settingsRequests.on(handler);
    },
    onSettingsChanged(handler: (s: AppSettings) => void): () => void {
      return store.subscribe(handler);
    },

    // ------- Window chrome ---------------------------------------------------

    /**
     * Minimise / maximise / hide / close have no meaning in a page. `close` is
     * mapped to `window.close()` because that is what a user pressing it means,
     * and it is the one of the four a browser can actually honour (and only for
     * a script-opened window).
     */
    windowControl(action: WindowAction): void {
      if (action === 'close') {
        try {
          window.close();
        } catch {
          /* not script-opened — ignored */
        }
      }
    },
    snapWindow(_target: SnapTarget): void {
      /* no-op: a page cannot move its own OS window */
    },
    applyLayout(_layout: UiLayout): void {
      /* no-op: no OS minimum size to clamp */
    },
    tempExpandWindow(_height: number | null): void {
      /* no-op: the page is not a resizable OS window */
    },

    /**
     * The native quick menu is Electron-only (it was built natively so a 38px
     * docked window could not clip it). Replacing it with a DOM popover is a
     * later step; until then this does nothing rather than pretending.
     */
    showContextMenu(): void {
      /* no-op — DOM popover pending */
    },
    selectionChanged(): void {
      /* no-op: the quick menu that consumed this does not exist here */
    },
    onRequestSaveSelection(): () => void {
      return () => undefined;
    },
    showTitleMenu(_kind: TitleMenuKind): void {
      /* no-op — DOM popover pending */
    },

    onWindowState(handler: (s: { maximized: boolean; focused: boolean }) => void): () => void {
      const push = (): void => handler({ maximized: false, focused: document.hasFocus() });
      window.addEventListener('focus', push);
      window.addEventListener('blur', push);
      // Async: subscribers are React effects, and emitting during the render
      // that subscribes them would set state mid-render.
      setTimeout(push, 0);
      return () => {
        window.removeEventListener('focus', push);
        window.removeEventListener('blur', push);
      };
    },

    // ------- Clip window -> main window --------------------------------------

    sendClipCommand(cmd: ClipCommand): void {
      clipCommands.emit(cmd);
    },
    onClipCommand(handler: (c: ClipCommand) => void): () => void {
      return clipCommands.on(handler);
    },

    // ------- WASAPI loopback (no browser equivalent) --------------------------

    /**
     * The loopback backend is a Windows WASAPI feature. There is no browser
     * analogue, so it advertises nothing and refuses to start — the UI hides
     * the backend because `platform` is not in LOOPBACK_SUPPORTED_PLATFORMS,
     * and capture goes through `getDisplayMedia` on the `desktop` backend.
     */
    async listLoopbackDevices(): Promise<LoopbackDevice[]> {
      return [];
    },
    async startLoopback(): Promise<{ ok: boolean; error?: string }> {
      return { ok: false, error: 'The WASAPI loopback backend does not exist on this target.' };
    },
    async stopLoopback(): Promise<{ ok: boolean }> {
      return { ok: true };
    },
    onLoopbackSamples(handler: (u8: Uint8Array) => void): () => void {
      return loopbackSamples.on(handler);
    },
    onLoopbackEvent(handler: (e: LoopbackEvent) => void): () => void {
      return loopbackEvents.on(handler);
    },

    /**
     * Reported as 'android' on purpose: the renderer uses `platform` only to
     * decide whether the WASAPI backend exists (it does not, on any browser
     * target) and to disable one Windows-only control. 'android' is the union
     * member that says exactly that. A desktop-browser build is not a shipped
     * configuration; the shipped one is the Capacitor shell.
     */
    platform: 'android' as Api['platform'],
  };

  return api;
}

/** Kept outside `createBrowserApi` so `startTranscription` can reach it. */
const transcriptionStates = bus<TranscribeJobState>();
