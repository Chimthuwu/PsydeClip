import { app, ipcMain, dialog, BrowserWindow, desktopCapturer, Menu, MenuItemConstructorOptions, nativeImage, type WebContents } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { ICON_32_DATA_URL } from './icon-assets';
import {
  AppSettings,
  BUFFER_PRESETS_SEC,
  CaptureSource,
  ClipWindowState,
  IpcChannel,
  LoopbackDevice,
  SaveResult,
  TranscribeJobState,
  SnapTarget,
  TitleMenuKind,
  TranscribedNote,
  UiLayout,
  THEMES,
  VIZ_GAIN_PRESETS,
  VISUALIZER_MODES,
  VisualizerMode,
  WindowAction,
} from '../shared/types';
import { applyLayout, performWindowAction, snapWindow, tempExpand } from './window-controls';
import { removeAppBar } from './appbar';
import {
  createPopout,
  destroyPopout,
  forwardVizFrame,
  forwardVizState,
  forwardVizHistory,
  getPopout,
  handOverToPopout,
  isPopoutOpen,
  markPopoutKeepMain,
} from './popout';
import { readSettings, writeSettings } from './settings';
import { saveRecordingFile } from './save';
import { notesToMidiBytes, type NoteEvent } from './transcribe/engine';
import {
  cancelTranscription,
  jobState,
  pruneJobs,
  startTranscription,
} from './transcribe/pool';
import { startClip, appendClip, readClip, abortClip } from './clip';
import { setClipWindow } from './clip-window';
import {
  listLoopbackDevices,
  loopbackManager,
  resolveHelperPath,
} from './wasapi';
import {
  notifySaveCompleted,
  setCapturingState as setTrayCapturingState,
} from './tray';

let preparedDragFilePath: string | null = null;

/**
 * The renderer's current History/spectrogram selection, in absolute session
 * seconds — reported over `selection:changed` because the renderer owns the
 * peak track and the recorder. Main only needs it to label and offer
 * "Save selection" in the native quick menu, which has to be built here (a
 * docked 52px window would clip any in-DOM menu).
 */
let lastSelection: [number, number] | null = null;

/**
 * Windows aborts `webContents.startDrag()` when the icon is missing or empty —
 * historically we passed a 1×1 transparent PNG, which some Windows builds still
 * treat as empty and drop the drag on the floor. Use the real app icon (a
 * proper 32×32 raster) so the drag always takes.
 */
let dragIconCache: Electron.NativeImage | null = null;
function dragIcon(): Electron.NativeImage {
  if (!dragIconCache) {
    const img = nativeImage.createFromDataURL(ICON_32_DATA_URL);
    dragIconCache = img.isEmpty()
      ? nativeImage.createFromDataURL(
          'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
        )
      : img;
  }
  return dragIconCache;
}

export interface IpcContext {
  getWindow: () => BrowserWindow | null;
  onSettingsChanged: (s: AppSettings) => void;
  getCurrentHotkey: () => string | null;
  /** Rebuild the main window — the only way to change its frame at runtime. */
  recreateWindow: () => void;
}

export function registerIpc(ctx: IpcContext) {
  ipcMain.handle(IpcChannel.settingsGet, () => readSettings());

  ipcMain.handle(
    IpcChannel.settingsSet,
    (_e, next: Partial<AppSettings>): AppSettings => {
      const merged = writeSettings({ ...readSettings(), ...next });
      ctx.onSettingsChanged(merged);
      return merged;
    },
  );

  ipcMain.handle(IpcChannel.sourcesList, async (): Promise<CaptureSource[]> => {
    // Windows' loopback audio mixer only attaches to screen captures, and
    // asking for audio off a window id kills the renderer outright rather than
    // failing softly — so don't offer window sources there at all. A screen
    // capture already carries every application's audio.
    const types: ('screen' | 'window')[] =
      process.platform === 'win32' ? ['screen'] : ['screen', 'window'];
    const sources = await desktopCapturer.getSources({
      types,
      fetchWindowIcons: false,
      thumbnailSize: { width: 0, height: 0 },
    });
    return sources.map((s) => ({
      id: s.id,
      name: s.name,
      kind: s.id.startsWith('screen:') ? 'screen' : 'window',
    }));
  });

  ipcMain.handle(IpcChannel.folderPick, async (): Promise<string | null> => {
    const win = ctx.getWindow();
    const res = await dialog.showOpenDialog(win ?? undefined!, {
      title: 'Select recording save folder',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (res.canceled || res.filePaths.length === 0) return null;
    return res.filePaths[0];
  });

  ipcMain.handle(
    IpcChannel.notesToMidi,
    (_e, args: { notes: TranscribedNote[]; bpm?: number }): Uint8Array => {
      const events: NoteEvent[] = args.notes.map((n) => ({
        pitchMidi: n.pitch,
        startTimeSeconds: n.startSec,
        durationSeconds: n.durationSec,
        amplitude: n.velocity,
      }));
      return notesToMidiBytes(events, args.bpm ?? 120);
    },
  );

  ipcMain.handle(
    IpcChannel.saveRecording,
    async (_e, args: { folder: string; bytes: Uint8Array; ext?: string; durationSec?: number; deviceName?: string }): Promise<SaveResult> => {
      try {
        if (!args.folder) return { ok: false, error: 'No save folder configured' };
        const settings = readSettings();
        const r = await saveRecordingFile({
          folder: args.folder,
          bytes: args.bytes,
          template: settings.fileNameTemplate,
          settings,
          deviceName: args.deviceName,
          ext: args.ext,
        });
        // Notify the tray so the recent-saves menu + tooltip update and (on
        // Windows) a balloon pops up showing the new filename.
        notifySaveCompleted({ fileName: r.fileName, fullPath: r.path });
        return { ok: true, path: r.path, bytes: r.bytes, fileName: r.fileName } satisfies SaveResult;
      } catch (err) {
        return { ok: false, error: (err as Error).message };
      }
    },
  );

  // ------- MIDI transcription ----------------------------------------------
  // Runs in a worker thread so ~0.7x-realtime inference never blocks the main
  // or renderer thread. The audio file is already on disk by the time the
  // renderer calls this; nothing here can fail or delay a save.

  /**
   * Poll a job and push its state to the renderer until it settles.
   *
   * A timer rather than a worker callback: the pool deliberately owns job
   * bookkeeping, and this keeps ipc.ts free of pool internals. 400 ms is
   * frequent enough to feel live without spamming the IPC bus.
   */
  const watchJob = (jobId: string, sender: WebContents) => {
    const tick = setInterval(() => {
      const state = jobState(jobId);
      if (!state) {
        clearInterval(tick);
        return;
      }
      if (!sender.isDestroyed()) {
        sender.send(IpcChannel.transcribeEvent, state);
      }
      if (state.status !== 'running') {
        clearInterval(tick);
        pruneJobs();
      }
    }, 400);
  };

  ipcMain.handle(
  IpcChannel.transcribeStart,
  async (
    e,
    args: {
      jobId: string;
      samples: Float32Array;
      sampleRate: number;
      audioPath: string;
      /** Transcribe for the note list only — no `.mid` is written. */
      notesOnly?: boolean;
    },
  ): Promise<TranscribeJobState> => {
    try {
      if (!args?.samples?.length || (!args?.audioPath && !args?.notesOnly)) {
        return {
          jobId: args?.jobId ?? 'unknown',
          audioPath: args?.audioPath ?? '',
          midiPath: '',
          status: 'error',
          fraction: 0,
          error: 'Nothing to transcribe.',
        };
      }
      const state = startTranscription({
        jobId: args.jobId,
        samples: args.samples,
        sampleRate: args.sampleRate,
        audioPath: args.audioPath ?? '',
        notesOnly: args.notesOnly,
      });
      // Report progress for this job back to the renderer that asked.
      watchJob(state.jobId, e.sender);
      return state;
    } catch (err) {
      return {
        jobId: args?.jobId ?? 'unknown',
        audioPath: args?.audioPath ?? '',
        midiPath: '',
        status: 'error',
        fraction: 0,
        error: (err as Error).message,
      };
    }
  },
  );

  ipcMain.handle(IpcChannel.transcribeCancel, (_e, jobId: string): boolean =>
  cancelTranscription(jobId),
  );

  // ------- Dedicated clip recording (streams to a temp file) ----------------

  ipcMain.handle(IpcChannel.clipStart, () => startClip());
  ipcMain.on(IpcChannel.clipAppend, (_e, bytes: Uint8Array) => {
    void appendClip(bytes);
  });
  ipcMain.handle(IpcChannel.clipRead, () => readClip());
  ipcMain.on(IpcChannel.clipAbort, () => void abortClip());

  // Show / hide the always-on-top clip-recording window to match the main
  // renderer's clip state.
  ipcMain.on(IpcChannel.clipWindowSet, (_e, state: ClipWindowState) => {
    setClipWindow(state);
  });

  ipcMain.on(
    IpcChannel.dragExport,
    (e, args: { bytes: Uint8Array; deviceName?: string; ext?: string }) => {
      try {
        const now = new Date();
        const ext = args.ext || 'webm';
        const stamp = `${now.getHours()}${now.getMinutes()}${now.getSeconds()}`;
        const tempPath = path.join(app.getPath('temp'), `recordr_snippet_${stamp}.${ext}`);
        fs.writeFileSync(tempPath, args.bytes);
        e.sender.startDrag({ file: tempPath, icon: dragIcon() });
      } catch (err) {
        console.error('Drag export failed:', err);
      }
    }
  );

  ipcMain.on(
    IpcChannel.dragPrepare,
    (_e, args: { bytes: Uint8Array; ext?: string }) => {
      try {
        if (preparedDragFilePath && fs.existsSync(preparedDragFilePath)) {
          try {
            fs.unlinkSync(preparedDragFilePath);
          } catch { /* ignore */ }
        }
        const now = new Date();
        const ext = args.ext || 'webm';
        const stamp = `${now.getHours()}${now.getMinutes()}${now.getSeconds()}${now.getMilliseconds()}`;
        const tempPath = path.join(app.getPath('temp'), `recordr_snippet_${stamp}.${ext}`);
        fs.writeFileSync(tempPath, args.bytes);
        preparedDragFilePath = tempPath;
      } catch (err) {
        console.error('Drag preparation failed:', err);
      }
    }
  );

  ipcMain.on(
    IpcChannel.dragExportPrepared,
    (e) => {
      try {
        if (!preparedDragFilePath || !fs.existsSync(preparedDragFilePath)) {
          console.error('[drag] no prepared file — selection not ready yet');
          return;
        }
        e.sender.startDrag({ file: preparedDragFilePath, icon: dragIcon() });
      } catch (err) {
        console.error('Drag export prepared failed:', err);
      }
    }
  );

  ipcMain.on(
    IpcChannel.dragExportProxy,
    (e, args: { bounds: [number, number] }) => {
      // Popout window requested a drag. We ask the main window to perform the export.
      const mainWin = ctx.getWindow();
      if (mainWin && !mainWin.isDestroyed()) {
        mainWin.webContents.send(IpcChannel.requestDragExport, args);
      }
    }
  );

  // ------- WASAPI loopback helpers ---------------------------------------------------------

  ipcMain.handle(IpcChannel.loopbackList, async (): Promise<LoopbackDevice[]> => {
    try {
      return await listLoopbackDevices();
    } catch (err) {
      // Surface a structured error so the UI can fall back to desktop mode.
      console.warn('[loopback:list] failed:', err);
      return [];
    }
  });

  ipcMain.handle(
    IpcChannel.loopbackStart,
    async (_e, args: { deviceId: string; deviceName: string; sampleRate?: number }): Promise<{ ok: boolean; error?: string }> => {
      try {
        // Resolve helper path early so we fail fast if it's missing.
        resolveHelperPath();
        const device: LoopbackDevice = {
          id: args.deviceId,
          name: args.deviceName,
          isDefault: false,
          sampleRate: args.sampleRate ?? 48000,
          channelCount: 2,
        };
        await loopbackManager.start(device, args.sampleRate ?? 48000, ctx.getWindow);
        return { ok: true };
      } catch (err) {
        return { ok: false, error: (err as Error).message };
      }
    },
  );

  ipcMain.handle(IpcChannel.loopbackStop, async () => {
    await loopbackManager.stop();
    return { ok: true };
  });

  // ------- Window controls ---------------------------------------------------

  ipcMain.handle(
    IpcChannel.windowSetAlwaysOnTop,
    (_e, args: { enabled: boolean }): void => {
      const w = ctx.getWindow();
      if (!w || w.isDestroyed()) return;
      try { w.setAlwaysOnTop(args.enabled, 'floating'); } catch { /* ignore */ }
    },
  );

  // The custom title bar's minimise / maximise / close buttons.
  ipcMain.handle(
    IpcChannel.windowControl,
    (e, args: { action: WindowAction }): void => {
      // Route to whichever window asked — the pop-out has its own close button.
      const w = BrowserWindow.fromWebContents(e.sender) ?? ctx.getWindow();
      performWindowAction(w, args.action);
    },
  );

  ipcMain.handle(
    IpcChannel.windowSnap,
    (e, args: { target: SnapTarget }): void => {
      const w = BrowserWindow.fromWebContents(e.sender);
      // "Dock to the top" from the MAIN window means the pop-out: the docked
      // strip the owner actually wants is the pop-out's, because it carries the
      // visualizer chips and its own transport — the main window's strip is just
      // a squashed HUD with no way to change what it is showing.
      if (w === ctx.getWindow() && args.target === 'top') {
        handOverToPopout({
          onClosed: () => ctx.onSettingsChanged(writeSettings({ ...readSettings(), popoutOpen: false })),
          onSettingsChanged: ctx.onSettingsChanged,
          target: 'top',
        });
        return;
      }

      const targetWin = w ?? ctx.getWindow();
      snapWindow(targetWin, args.target);
    },
  );

  // Layout switches change how small the window is allowed to get, and shrink
  // it to a strip for `bar`, so main has to know about them.
  ipcMain.handle(
    IpcChannel.windowApplyLayout,
    (_e, args: { layout: UiLayout }): void => {
      applyLayout(ctx.getWindow(), args.layout);
    },
  );

  // Temporarily grow the window so a popover taller than it can be seen.
  ipcMain.handle(
    IpcChannel.windowTempExpand,
    (_e, args: { height: number | null }): void => {
      tempExpand(ctx.getWindow(), args.height);
    },
  );

  /**
   * The right-click quick menu.
   *
   * Built natively rather than in the renderer for one hard reason: `bar`
   * layout is a 38px-tall window, and anything the renderer draws is clipped at
   * the window edge. A native menu floats free of the window, so the same menu
   * works whether the app is full-size or a strip docked to the top of a
   * monitor. It's also why the output-device picker no longer has to occupy a
   * permanent row in the UI.
   */
  ipcMain.on(IpcChannel.selectionChanged, (_e, sel: [number, number] | null): void => {
    lastSelection =
      Array.isArray(sel) && sel.length === 2 && Number.isFinite(sel[0]) && Number.isFinite(sel[1]) && sel[1] > sel[0]
        ? [sel[0], sel[1]]
        : null;
  });

  ipcMain.handle(IpcChannel.contextMenu, async (e): Promise<void> => {
    const win = BrowserWindow.fromWebContents(e.sender) ?? ctx.getWindow();
    if (!win || win.isDestroyed()) return;
    const s = readSettings();

    const apply = (patch: Partial<AppSettings>) => {
      ctx.onSettingsChanged(writeSettings({ ...readSettings(), ...patch }));
    };

    // Only enumerate the backend actually in use — desktopCapturer and the
    // WASAPI helper both cost real time and only one of them can be current.
    let deviceItems: MenuItemConstructorOptions[];
    if (s.captureBackend === 'loopback') {
      let devices: LoopbackDevice[] = [];
      try { devices = await listLoopbackDevices(); } catch { /* helper missing */ }
      deviceItems = devices.length
        ? devices.map((d) => ({
            label: d.isDefault ? `★ ${d.name}` : d.name,
            type: 'radio' as const,
            checked: s.loopbackDeviceId === d.id,
            click: () => apply({ loopbackDeviceId: d.id }),
          }))
        : [{ label: 'No output devices found', enabled: false }];
    } else {
      let sources: CaptureSource[] = [];
      try {
        sources = (
          await desktopCapturer.getSources({
            types: process.platform === 'win32' ? ['screen'] : ['screen', 'window'],
            fetchWindowIcons: false,
            thumbnailSize: { width: 0, height: 0 },
          })
        ).map((x) => ({ id: x.id, name: x.name, kind: 'screen' as const }));
      } catch { /* ignore */ }
      deviceItems = sources.length
        ? sources.map((src) => ({
            label: src.name,
            type: 'radio' as const,
            checked: s.sourceId === src.id,
            click: () => apply({ sourceId: src.id }),
          }))
        : [{ label: 'No sources found', enabled: false }];
    }

    // The board shows every ticked visualizer: one → a single board, several →
    // a mosaic. Each item is an independent on/off; the last one can't be
    // unticked.
    const shownModes = VISUALIZER_MODES.filter((m) => !s.vizHidden.includes(m));
    const vizItem = (mode: VisualizerMode, label: string): MenuItemConstructorOptions => {
      const on = shownModes.includes(mode);
      return {
        label,
        type: 'checkbox',
        checked: on,
        enabled: !(on && shownModes.length === 1),
        click: () => {
          const next = on
            ? s.vizHidden.concat(mode)
            : s.vizHidden.filter((m) => m !== mode);
          const shownAfter = VISUALIZER_MODES.filter((m) => !next.includes(m));
          apply({
            vizHidden: next,
            visualizer: on ? (shownAfter[0] ?? s.visualizer) : mode,
          });
        },
      };
    };

    // "Save selection" leads the menu when there is one: it is the action the
    // user is most likely to want after dragging a range out of the waveform,
    // and it is the only way to save a crop from a docked/pop-out window.
    // Added to the existing quick menu rather than intercepting right-click
    // with a second menu — one menu, and the "Save as" submenu below already
    // governs which format it writes (todo.md index, History phase 5).
    const selItems: MenuItemConstructorOptions[] = lastSelection
      ? [
          {
            label: `Save selection (${(lastSelection[1] - lastSelection[0]).toFixed(2)}s)`,
            click: () => {
              const main = ctx.getWindow();
              if (main && !main.isDestroyed()) {
                main.webContents.send(IpcChannel.requestSaveSelection);
              }
            },
          },
          { type: 'separator' },
        ]
      : [];

    const template: MenuItemConstructorOptions[] = [
      ...selItems,
      { label: s.captureBackend === 'loopback' ? 'Output device' : 'Capture source', enabled: false },
      ...deviceItems,
      { type: 'separator' },
      {
        label: 'Capture backend',
        submenu: [
          {
            label: 'WASAPI loopback (per device)',
            type: 'radio',
            checked: s.captureBackend === 'loopback',
            enabled: process.platform === 'win32',
            click: () => apply({ captureBackend: 'loopback' }),
          },
          {
            label: 'Desktop capture (whole screen)',
            type: 'radio',
            checked: s.captureBackend === 'desktop',
            click: () => apply({ captureBackend: 'desktop' }),
          },
        ],
      },
      { type: 'separator' },
      vizItem('oscilloscope', 'Oscilloscope'),
      vizItem('spectrum', 'Spectrum'),
      vizItem('spectrogram', 'Spectrogram'),
      vizItem('history', 'History'),
      { type: 'separator' },
      {
        label: 'Save as',
        submenu: ([
          ['webm', 'WebM / Opus (smallest)'],
          ['wav', 'WAV (16-bit PCM)'],
          ['mp3', 'MP3'],
        ] as const).map(([fmt, label]) => ({
          label,
          type: 'radio' as const,
          checked: s.recordingFormat === fmt,
          click: () => apply({ recordingFormat: fmt }),
        })),
      },
      { type: 'separator' },
      {
        label: 'Theme',
        submenu: THEMES.map((t) => ({
          label: t.label,
          type: 'radio' as const,
          checked: s.theme === t.value,
          click: () => apply({ theme: t.value }),
        })),
      },
      { type: 'separator' },
      {
        label: 'Rolling buffer',
        type: 'checkbox',
        checked: s.recordMode === 'rolling',
        click: () => apply({ recordMode: s.recordMode === 'rolling' ? 'traditional' : 'rolling' }),
      },
      {
        label: 'Buffer length',
        submenu: BUFFER_PRESETS_SEC.map((sec) => ({
          label: `${Math.round(sec / 60)} min`,
          type: 'radio' as const,
          checked: s.bufferSeconds === sec,
          click: () => apply({ bufferSeconds: sec }),
        })),
      },
      {
        label: 'Visualizer sensitivity',
        submenu: VIZ_GAIN_PRESETS.map((g) => ({
          label: `${g}×`,
          type: 'radio' as const,
          checked: s.vizGain === g,
          click: () => apply({ vizGain: g }),
        })),
      },
      {
        label: 'Always on top',
        type: 'checkbox',
        checked: s.alwaysOnTop,
        click: () => apply({ alwaysOnTop: !s.alwaysOnTop }),
      },
      {
        label: 'Pop out visualizer',
        type: 'checkbox',
        checked: isPopoutOpen(),
        click: () => {
          const want = !isPopoutOpen();
          if (want) {
            createPopout(() => {
              ctx.onSettingsChanged(writeSettings({ ...readSettings(), popoutOpen: false }));
            });
          } else {
            destroyPopout();
          }
          apply({ popoutOpen: want });
        },
      },
      { type: 'separator' },
      {
        label: 'Dock to top of screen',
        // A docked window is always the pop-out: the main window's HUD has no
        // small form, so docking it leaves a monitor-wide strip with no
        // visualizer buttons. Right-clicking the pop-out itself just docks it.
        click: () => {
          if (win === getPopout()) {
            snapWindow(win, 'top');
            return;
          }
          handOverToPopout({
            onClosed: () => ctx.onSettingsChanged(writeSettings({ ...readSettings(), popoutOpen: false })),
            onSettingsChanged: ctx.onSettingsChanged,
            target: 'top',
          });
        },
      },
      {
        label: 'Docking reserves screen space',
        type: 'checkbox',
        checked: s.dockReservesSpace,
        enabled: process.platform === 'win32',
        click: () => {
          const next = !s.dockReservesSpace;
          // Turning it off has to hand the desktop back immediately, not at the
          // next undock — the user just said they don't want the strip.
          if (!next) removeAppBar();
          apply({ dockReservesSpace: next });
          if (next) snapWindow(win, 'top');
        },
      },
      {
        label: 'Show device picker in window',
        type: 'checkbox',
        checked: s.showSourcePicker,
        click: () => apply({ showSourcePicker: !s.showSourcePicker }),
      },
      { type: 'separator' },
      {
        label: 'Settings…',
        click: () => {
          const w = ctx.getWindow();
          if (w && !w.isDestroyed()) {
            if (!w.isVisible()) w.show();
            w.focus();
            w.webContents.send(IpcChannel.openSettings);
          }
        },
      },
    ];

    Menu.buildFromTemplate(template).popup({ window: win });
  });

  // ------- Title-bar knob menus ----------------------------------------------

  // The title bar's format / sensitivity / buffer buttons ask for a native
  // menu (same reason as the quick menu: a DOM popover would be clipped at
  // the edge of a short or docked window). The menu pops at the cursor, which
  // is exactly over the button that asked for it.
  ipcMain.handle(
    IpcChannel.titleMenu,
    async (e, args: { kind: TitleMenuKind }): Promise<void> => {
      const win = BrowserWindow.fromWebContents(e.sender) ?? ctx.getWindow();
      if (!win || win.isDestroyed()) return;
      const s = readSettings();
      const apply = (patch: Partial<AppSettings>) => {
        ctx.onSettingsChanged(writeSettings({ ...readSettings(), ...patch }));
      };

      let template: MenuItemConstructorOptions[];
      if (args.kind === 'format') {
        template = ([
          ['webm', 'WebM / Opus'],
          ['wav', 'WAV (16-bit PCM)'],
          ['mp3', 'MP3'],
        ] as const).map(([fmt, label]) => ({
          label,
          type: 'radio' as const,
          checked: s.recordingFormat === fmt,
          click: () => apply({ recordingFormat: fmt }),
        }));
      } else if (args.kind === 'gain') {
        template = VIZ_GAIN_PRESETS.map((g) => ({
          label: `${g}×`,
          type: 'radio' as const,
          checked: s.vizGain === g,
          click: () => apply({ vizGain: g }),
        }));
      } else if (args.kind === 'theme') {
        template = THEMES.map((t) => ({
          label: t.label,
          type: 'radio' as const,
          checked: s.theme === t.value,
          click: () => apply({ theme: t.value }),
        }));
      } else {
        template = BUFFER_PRESETS_SEC.map((sec) => ({
          label: `${Math.round(sec / 60)} min`,
          type: 'radio' as const,
          checked: s.bufferSeconds === sec,
          click: () => apply({ bufferSeconds: sec }),
        }));
      }

      Menu.buildFromTemplate(template).popup({ window: win });
    },
  );

  // ------- Pop-out visualizer ------------------------------------------------

  ipcMain.handle(
    IpcChannel.popoutToggle,
    (_e, args: { open?: boolean; keepMain?: boolean } = {}): { open: boolean } => {
      const want = args.open ?? !isPopoutOpen();
      if (want) {
        createPopout(() => {
          // Closed by its own ✕. Same path as an explicit toggle-off so the
          // main window comes back and every window sees the new state.
          ctx.onSettingsChanged(writeSettings({ ...readSettings(), popoutOpen: false }));
          const w = ctx.getWindow();
          if (w && !w.isDestroyed()) w.webContents.send(IpcChannel.popoutState, { open: false });
        });
      } else {
        destroyPopout();
      }
      // A per-pane ⧉ pop-out opens alongside the main window: tell the swap
      // policy (which fires on this settings transition) to leave it visible.
      if (want && args.keepMain) markPopoutKeepMain();
      // Route through onSettingsChanged rather than writing quietly: main hides
      // or restores the main window off this transition, and the pop-out's own
      // useSettings only learns about it from the settings:changed broadcast.
      ctx.onSettingsChanged(writeSettings({ ...readSettings(), popoutOpen: want }));
      const w = ctx.getWindow();
      if (w && !w.isDestroyed()) w.webContents.send(IpcChannel.popoutState, { open: want });
      return { open: want };
    },
  );

  // Relays. These run at frame rate, so they're `on`/`send` rather than
  // `handle`/`invoke` — no promise per frame, and nothing to await.
  ipcMain.on(IpcChannel.vizFrame, (_e, payload) => forwardVizFrame(payload));
  ipcMain.on(IpcChannel.vizState, (_e, payload) => forwardVizState(payload));
  ipcMain.on(IpcChannel.vizHistory, (_e, payload) => forwardVizHistory(payload));
  ipcMain.on(IpcChannel.vizCommand, (_e, payload) => {
      const w = ctx.getWindow();
      if (w && !w.isDestroyed()) w.webContents.send(IpcChannel.vizCommand, payload);
    });
    // The clip window's own buttons. Separate from viz:command so it does not
    // depend on the pop-out existing.
    ipcMain.on(IpcChannel.clipCommand, (_e, payload) => {
      const w = ctx.getWindow();
      if (w && !w.isDestroyed()) w.webContents.send(IpcChannel.clipCommand, payload);
    });

  // ------- Tray state --------------------------------------------------------

  // Renderer drives the actual recorder, so it pushes capture state to the
  // tray so title/icon/elapsed-time UI can update in real time.
  ipcMain.handle(
    IpcChannel.traySetCapturing,
    (_e, args: { capturing: boolean }): void => {
      setTrayCapturingState(args.capturing);
    },
  );
}
