import { ipcMain, dialog, BrowserWindow, desktopCapturer } from 'electron';
import {
  AppSettings,
  CaptureSource,
  IpcChannel,
  LoopbackDevice,
  SaveResult,
  SnapTarget,
  UiLayout,
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

  // ------- Pop-out visualizer ------------------------------------------------

  ipcMain.handle(
    IpcChannel.popoutToggle,
    (_e, args: { open?: boolean } = {}): { open: boolean } => {
      const want = args.open ?? !isPopoutOpen();
      if (want) {
        createPopout(() => {
          writeSettings({ ...readSettings(), popoutOpen: false });
          const w = ctx.getWindow();
          if (w && !w.isDestroyed()) w.webContents.send(IpcChannel.popoutState, { open: false });
        });
      } else {
        destroyPopout();
      }
      writeSettings({ ...readSettings(), popoutOpen: want });
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
