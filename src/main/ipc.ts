import { ipcMain, dialog, BrowserWindow, desktopCapturer } from 'electron';
import {
  AppSettings,
  CaptureSource,
  IpcChannel,
  LoopbackDevice,
  SaveResult,
} from '../shared/types';
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
