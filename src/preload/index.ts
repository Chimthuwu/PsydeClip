import { contextBridge, ipcRenderer } from 'electron';
import {
  AppSettings,
  CaptureSource,
  ClipWindowState,
  IpcChannel,
  LoopbackDevice,
  LoopbackEvent,
  RecorderEvent,
  SaveResult,
  TranscribeJobState,
  SnapTarget,
  TitleMenuKind,
  TranscribedNote,
  UiLayout,
  VizCommand,
  VizFrame,
  HistoryStream,
  VizState,
  WindowAction,
} from '../shared/types';

const api = {
  getSettings(): Promise<AppSettings> {
    return ipcRenderer.invoke(IpcChannel.settingsGet);
  },
  setSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
    return ipcRenderer.invoke(IpcChannel.settingsSet, patch);
  },
  listSources(): Promise<CaptureSource[]> {
    return ipcRenderer.invoke(IpcChannel.sourcesList);
  },
  pickFolder(): Promise<string | null> {
    return ipcRenderer.invoke(IpcChannel.folderPick);
  },
  saveRecording(args: { folder: string; bytes: Uint8Array; ext?: string; durationSec?: number; deviceName?: string }): Promise<SaveResult> {
    return ipcRenderer.invoke(IpcChannel.saveRecording, args);
  },
  startDragExport(args: { bytes: Uint8Array; deviceName?: string; ext?: string }): void {
      ipcRenderer.send(IpcChannel.dragExport, args);
    },
  /** Build a Standard MIDI File from a transcribed note list, for export/drag-out. */
  notesToMidi(notes: TranscribedNote[], bpm?: number): Promise<Uint8Array> {
    return ipcRenderer.invoke(IpcChannel.notesToMidi, { notes, bpm });
  },
    /**
     * Queue a MIDI transcription for a recording that is ALREADY saved. The
     * audio file is never re-read or re-written; the `.mid` is written beside it
     * once the worker finishes. Returns the initial job state.
     */
    startTranscription(args: {
      jobId: string;
      samples: Float32Array;
      sampleRate: number;
      audioPath: string;
      /** Transcribe for the note list only — no `.mid` is written. */
      notesOnly?: boolean;
    }): Promise<TranscribeJobState> {
      return ipcRenderer.invoke(IpcChannel.transcribeStart, args);
    },
    /** Ask a running transcription to stop. */
    cancelTranscription(jobId: string): Promise<boolean> {
      return ipcRenderer.invoke(IpcChannel.transcribeCancel, jobId);
    },
    /** Subscribe to progress/completion for one job. Returns an unsubscribe fn. */
    onTranscription(cb: (state: TranscribeJobState) => void): () => void {
      const wrap = (_e: unknown, state: TranscribeJobState) => cb(state);
      ipcRenderer.on(IpcChannel.transcribeEvent, wrap);
      return () => ipcRenderer.removeListener(IpcChannel.transcribeEvent, wrap);
    },
  prepareDragFile(args: { bytes: Uint8Array; ext?: string }): void {
    ipcRenderer.send(IpcChannel.dragPrepare, args);
  },
  startDragExportPrepared(): void {
    ipcRenderer.send(IpcChannel.dragExportPrepared);
  },
  startDragExportByProxy(bounds: [number, number]): void {
    ipcRenderer.send(IpcChannel.dragExportProxy, { bounds });
  },
  onRequestDragExport(handler: (bounds: [number, number]) => void): () => void {
    const listener = (_e: unknown, args: { bounds: [number, number] }) => handler(args.bounds);
    ipcRenderer.on(IpcChannel.requestDragExport, listener);
    return () => ipcRenderer.removeListener(IpcChannel.requestDragExport, listener);
  },
  onRecorderEvent(handler: (e: RecorderEvent) => void): () => void {
    const listener = (_e: unknown, ev: RecorderEvent) => handler(ev);
    ipcRenderer.on(IpcChannel.recordingEvent, listener);
    return () => ipcRenderer.removeListener(IpcChannel.recordingEvent, listener);
  },

  // ------- Dedicated clip recording (streamed to a temp file) ----------------

  /** Create the backing temp file for a new clip recording. */
  clipStart(): Promise<{ ok: boolean; error?: string }> {
    return ipcRenderer.invoke(IpcChannel.clipStart);
  },
  /** Append one encoded chunk to the active clip's temp file. */
  clipAppend(bytes: Uint8Array): void {
    ipcRenderer.send(IpcChannel.clipAppend, bytes);
  },
  /** Read the whole active clip back (called once, after recording stops). */
  clipRead(): Promise<Uint8Array | null> {
    return ipcRenderer.invoke(IpcChannel.clipRead);
  },
  /** Delete the active clip's temp file (after save, or on teardown). */
  clipAbort(): void {
    ipcRenderer.send(IpcChannel.clipAbort);
  },
  /** Main renderer → main: show / update / hide the always-on-top clip window. */
  setClipWindow(state: ClipWindowState): void {
    ipcRenderer.send(IpcChannel.clipWindowSet, state);
  },
  /** Clip window: receive its timer / format / theme. */
  onClipWindowState(handler: (s: ClipWindowState) => void): () => void {
    const listener = (_e: unknown, s: ClipWindowState) => handler(s);
    ipcRenderer.on(IpcChannel.clipWindowState, listener);
    return () => ipcRenderer.removeListener(IpcChannel.clipWindowState, listener);
  },
  setAlwaysOnTop(enabled: boolean): void {
    ipcRenderer.invoke(IpcChannel.windowSetAlwaysOnTop, { enabled });
  },
  setTrayCapturing(capturing: boolean): void {
    ipcRenderer.invoke(IpcChannel.traySetCapturing, { capturing });
  },
  onOpenSettingsRequest(handler: () => void): () => void {
    const listener = () => handler();
    ipcRenderer.on(IpcChannel.openSettings, listener);
    return () => ipcRenderer.removeListener(IpcChannel.openSettings, listener);
  },
  /** Settings saved anywhere (any window, or the tray menu). */
  onSettingsChanged(handler: (s: AppSettings) => void): () => void {
    const listener = (_e: unknown, s: AppSettings) => handler(s);
    ipcRenderer.on(IpcChannel.settingsChanged, listener);
    return () => ipcRenderer.removeListener(IpcChannel.settingsChanged, listener);
  },

  // ------- Window chrome / geometry -------------------------------------------

  /** Minimise / maximise / hide / close the window that called this. */
  windowControl(action: WindowAction): void {
    void ipcRenderer.invoke(IpcChannel.windowControl, { action });
  },
  /** Park the window against an edge of its current display. */
  snapWindow(target: SnapTarget): void {
    void ipcRenderer.invoke(IpcChannel.windowSnap, { target });
  },
  /** Tell main the UI layout changed so it can re-clamp the minimum size. */
  applyLayout(layout: UiLayout): void {
    void ipcRenderer.invoke(IpcChannel.windowApplyLayout, { layout });
  },
  /**
   * Grow the window to `height` px so a popover taller than it stays visible;
   * pass null to snap back. Used by the bar layout's device dropdown.
   */
  tempExpandWindow(height: number | null): void {
    void ipcRenderer.invoke(IpcChannel.windowTempExpand, { height });
  },
  /**
   * Pop the native right-click quick menu (device, visualizer, layout…) at the
   * cursor. Native rather than in-DOM so it isn't clipped by a `bar`-layout
   * window that's only 38px tall.
   */
  showContextMenu(): void {
    void ipcRenderer.invoke(IpcChannel.contextMenu);
  },
  /**
   * Report the current selection (absolute session seconds, null = none) so
   * main's native quick menu can offer to save exactly that range.
   */
  selectionChanged(sel: [number, number] | null): void {
    ipcRenderer.send(IpcChannel.selectionChanged, sel);
  },
  /** The user chose "Save selection" in the quick menu. Returns an unsubscribe fn. */
  onRequestSaveSelection(handler: () => void): () => void {
    const listener = () => handler();
    ipcRenderer.on(IpcChannel.requestSaveSelection, listener);
    return () => ipcRenderer.removeListener(IpcChannel.requestSaveSelection, listener);
  },
  /** Pop the native menu for one of the title-bar knobs (format / gain / buffer). */
  showTitleMenu(kind: TitleMenuKind): void {
    void ipcRenderer.invoke(IpcChannel.titleMenu, { kind });
  },
  onWindowState(handler: (s: { maximized: boolean; focused: boolean }) => void): () => void {
    const listener = (_e: unknown, s: { maximized: boolean; focused: boolean }) => handler(s);
    ipcRenderer.on(IpcChannel.windowState, listener);
    return () => ipcRenderer.removeListener(IpcChannel.windowState, listener);
  },

  // ------- Pop-out visualizer --------------------------------------------------

  /**
   * Open/close the pop-out. Pass `keepMain: true` to open it *alongside*
   * the main window (the per-pane ⧉ flow) instead of swapping windows.
   */
  togglePopout(open?: boolean, opts?: { keepMain?: boolean }): Promise<{ open: boolean }> {
    return ipcRenderer.invoke(IpcChannel.popoutToggle, { open, ...opts });
  },
  onPopoutState(handler: (s: { open: boolean }) => void): () => void {
    const listener = (_e: unknown, s: { open: boolean }) => handler(s);
    ipcRenderer.on(IpcChannel.popoutState, listener);
    return () => ipcRenderer.removeListener(IpcChannel.popoutState, listener);
  },
  /** Main window → pop-out: one analyser frame. Fire-and-forget, ~30/s. */
  sendVizFrame(frame: VizFrame): void {
    ipcRenderer.send(IpcChannel.vizFrame, frame);
  },
  /** Main window → pop-out: capture/buffer/theme state, on change only. */
  sendVizState(state: VizState): void {
    ipcRenderer.send(IpcChannel.vizState, state);
  },
  onVizFrame(handler: (f: VizFrame) => void): () => void {
    const listener = (_e: unknown, f: VizFrame) => handler(f);
    ipcRenderer.on(IpcChannel.vizFrame, listener);
    return () => ipcRenderer.removeListener(IpcChannel.vizFrame, listener);
  },
  onVizState(handler: (s: VizState) => void): () => void {
    const listener = (_e: unknown, s: VizState) => handler(s);
    ipcRenderer.on(IpcChannel.vizState, listener);
    return () => ipcRenderer.removeListener(IpcChannel.vizState, listener);
  },
  /** Main window → pop-out: the rolling peak track + session clock stamp. */
  sendVizHistory(state: HistoryStream): void {
    ipcRenderer.send(IpcChannel.vizHistory, state);
  },
  onVizHistory(handler: (s: HistoryStream) => void): () => void {
    const listener = (_e: unknown, s: HistoryStream) => handler(s);
    ipcRenderer.on(IpcChannel.vizHistory, listener);
    return () => ipcRenderer.removeListener(IpcChannel.vizHistory, listener);
  },
  /** Pop-out → main window: a transport command. */
  sendVizCommand(cmd: VizCommand): void {
    ipcRenderer.send(IpcChannel.vizCommand, cmd);
  },
  onVizCommand(handler: (c: VizCommand) => void): () => void {
    const listener = (_e: unknown, c: VizCommand) => handler(c);
    ipcRenderer.on(IpcChannel.vizCommand, listener);
    return () => ipcRenderer.removeListener(IpcChannel.vizCommand, listener);
  },

  // ------- WASAPI loopback ----------------------------------------------------

  listLoopbackDevices(): Promise<LoopbackDevice[]> {
    return ipcRenderer.invoke(IpcChannel.loopbackList);
  },
  startLoopback(args: { deviceId: string; deviceName: string; sampleRate?: number }): Promise<{ ok: boolean; error?: string }> {
    return ipcRenderer.invoke(IpcChannel.loopbackStart, args);
  },
  stopLoopback(): Promise<{ ok: boolean }> {
    return ipcRenderer.invoke(IpcChannel.loopbackStop);
  },
  /**
   * Subscribe to live PCM sample frames (Uint8Array of 32-bit float stereo
   * samples, little-endian). Returns an unsubscribe function.
   */
  onLoopbackSamples(handler: (u8: Uint8Array) => void): () => void {
    const wrap = (_e: unknown, payload: Uint8Array) => handler(payload);
    ipcRenderer.on(IpcChannel.loopbackSamples, wrap);
    return () => ipcRenderer.removeListener(IpcChannel.loopbackSamples, wrap);
  },
  onLoopbackEvent(handler: (e: LoopbackEvent) => void): () => void {
    const wrap = (_e: unknown, ev: LoopbackEvent) => handler(ev);
    ipcRenderer.on(IpcChannel.loopbackEvent, wrap);
    return () => ipcRenderer.removeListener(IpcChannel.loopbackEvent, wrap);
  },

  platform: process.platform,
};

contextBridge.exposeInMainWorld('api', api);

export type Api = typeof api;
