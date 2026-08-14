import { contextBridge, ipcRenderer } from 'electron';
import {
  AppSettings,
  CaptureSource,
  IpcChannel,
  LoopbackDevice,
  LoopbackEvent,
  RecorderEvent,
  SaveResult,
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
  saveRecording(args: { folder: string; bytes: Uint8Array; durationSec?: number; deviceName?: string }): Promise<SaveResult> {
    return ipcRenderer.invoke(IpcChannel.saveRecording, args);
  },
  onRecorderEvent(handler: (e: RecorderEvent) => void): () => void {
    const listener = (_e: unknown, ev: RecorderEvent) => handler(ev);
    ipcRenderer.on(IpcChannel.recordingEvent, listener);
    return () => ipcRenderer.removeListener(IpcChannel.recordingEvent, listener);
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
