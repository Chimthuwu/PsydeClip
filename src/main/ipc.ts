import { ipcMain, dialog, BrowserWindow, desktopCapturer, Menu, MenuItemConstructorOptions } from 'electron';
import {
  AppSettings,
  CaptureSource,
  IpcChannel,
  LoopbackDevice,
  SaveResult,
  SnapTarget,
  UiLayout,
  VisualizerMode,
  WindowAction,
} from '../shared/types';
import { applyLayout, performWindowAction, snapWindow, tempExpand } from './window-controls';
import {
  createPopout,
  destroyPopout,
  forwardVizFrame,
  forwardVizState,
  isPopoutOpen,
} from './popout';
import { readSettings, writeSettings } from './settings';
import { saveWebm } from './save';
import {
  listLoopbackDevices,
  loopbackManager,
  resolveHelperPath,
} from './wasapi';
import {
  notifySaveCompleted,
  setCapturingState as setTrayCapturingState,
} from './tray';

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
    IpcChannel.saveRecording,
    async (_e, args: { folder: string; bytes: Uint8Array; durationSec?: number; deviceName?: string }): Promise<SaveResult> => {
      try {
        if (!args.folder) return { ok: false, error: 'No save folder configured' };
        const settings = readSettings();
        const r = await saveWebm({
          folder: args.folder,
          bytes: args.bytes,
          template: settings.fileNameTemplate,
          settings,
          deviceName: args.deviceName,
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
      const w = BrowserWindow.fromWebContents(e.sender) ?? ctx.getWindow();
      snapWindow(w, args.target);
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

    const vizItem = (mode: VisualizerMode, label: string): MenuItemConstructorOptions => ({
      label,
      type: 'radio',
      checked: s.visualizer === mode,
      click: () => apply({ visualizer: mode }),
    });

    const template: MenuItemConstructorOptions[] = [
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
      { type: 'separator' },
      {
        label: 'Rolling buffer',
        type: 'checkbox',
        checked: s.recordMode === 'rolling',
        click: () => apply({ recordMode: s.recordMode === 'rolling' ? 'traditional' : 'rolling' }),
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
        click: () => snapWindow(win, 'top'),
      },
      {
        label: 'Layout',
        submenu: (['full', 'compact', 'bar'] as UiLayout[]).map((l) => ({
          label: l === 'bar' ? 'Bar (thin strip)' : l[0].toUpperCase() + l.slice(1),
          type: 'radio' as const,
          checked: s.uiLayout === l,
          click: () => {
            applyLayout(ctx.getWindow(), l);
            apply({ uiLayout: l });
          },
        })),
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

  // ------- Pop-out visualizer ------------------------------------------------

  ipcMain.handle(
    IpcChannel.popoutToggle,
    (_e, args: { open?: boolean } = {}): { open: boolean } => {
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
  ipcMain.on(IpcChannel.vizCommand, (_e, payload) => {
    const w = ctx.getWindow();
    if (w && !w.isDestroyed()) w.webContents.send(IpcChannel.vizCommand, payload);
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
