import { BrowserWindow, nativeImage } from 'electron';
import path from 'node:path';
import { AppSettings, IpcChannel, SnapTarget } from '../shared/types';
import { readSettings, writeSettings } from './settings';
import { handleWindowMoved, reapplyOnResize, snapWindow } from './window-controls';
import { appBarOwner, removeAppBar } from './appbar';
import { ICON_256_DATA_URL } from './icon-assets';

/**
 * The pop-out visualizer: a second, frameless, always-on-top window that shows
 * only the waveform plus (optionally) the transport buttons.
 *
 * It does NOT open its own capture — the WASAPI helper is single-instance and
 * a second desktopCapturer stream would double the CPU cost for nothing.
 * Instead the main renderer streams analyser frames over IPC (`viz:frame`) and
 * the pop-out sends commands back (`viz:command`). Main is just the relay.
 */

const isDev = process.env.NODE_ENV === 'development';

let popoutWindow: BrowserWindow | null = null;

/**
 * Set when the pop-out is opened *alongside* the main window (the per-pane ⧉
 * flow) rather than as a swap. `applyPopoutWindowSwap` in index.ts consumes
 * it on the open transition so the main window is not hidden.
 */
let keepMainVisible = false;
export function markPopoutKeepMain() {
  keepMainVisible = true;
}
export function consumePopoutKeepMain(): boolean {
  const v = keepMainVisible;
  keepMainVisible = false;
  return v;
}

export function getPopout(): BrowserWindow | null {
  return popoutWindow && !popoutWindow.isDestroyed() ? popoutWindow : null;
}

export function isPopoutOpen(): boolean {
  return getPopout() !== null;
}

export function createPopout(onClosed?: () => void): BrowserWindow {
  const existing = getPopout();
  if (existing) {
    existing.show();
    existing.focus();
    return existing;
  }

  const s = readSettings();

  popoutWindow = new BrowserWindow({
    width: 460,
    height: 210,
    minWidth: 160,
    minHeight: 70,
    frame: false,
    transparent: false,
    backgroundColor: '#05070f',
    alwaysOnTop: s.popoutAlwaysOnTop,
    skipTaskbar: true,
    resizable: true,
    maximizable: false,
    fullscreenable: false,
    title: 'PsydeClip — Visualizer',
    icon: nativeImage.createFromDataURL(ICON_256_DATA_URL),
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
    },
  });

  if (s.popoutAlwaysOnTop) {
    try { popoutWindow.setAlwaysOnTop(true, 'floating'); } catch { /* ignore */ }
  }
  try { popoutWindow.setOpacity(clampOpacity(s.popoutOpacity)); } catch { /* ignore */ }

  // The renderer bundle is one page; `#popout` selects the pop-out root.
  if (isDev) {
    void popoutWindow.loadURL('http://localhost:5173/#popout');
  } else {
    void popoutWindow.loadFile(path.join(__dirname, '../renderer/index.html'), {
      hash: 'popout',
    });
  }

  popoutWindow.once('ready-to-show', () => popoutWindow?.show());
  popoutWindow.on('closed', () => {
    // If the pop-out was the docked strip, its reservation dies with it —
    // otherwise the shell keeps holding space for a window that no longer
    // exists.
    if (appBarOwner() === popoutWindow) removeAppBar();
    popoutWindow = null;
    onClosed?.();
  });

  // Same drop-near-an-edge behaviour the main window has. Without this the
  // pop-out was the one window you *couldn't* dock, which is backwards — it's
  // the one most likely to live along the top of a monitor.
  popoutWindow.on('moved', () => handleWindowMoved(getPopout()));
  popoutWindow.on('resized', () => reapplyOnResize(getPopout()));

  return popoutWindow;
}

/**
 * Hand the small-window case over to the pop-out.
 *
 * The main window has no good small form: below ~190px its HUD is a squashed
 * strip with no way to change what it is showing. The pop-out IS that form —
 * it carries the per-visualizer chips and its own transport — so every route
 * that ends in a small window (the title bar's dock, the tray's dock, the
 * quick menu's, and simply dragging the window short) funnels through here
 * instead of leaving a squashed main window on screen.
 *
 * `target` null just opens the pop-out at its own size; a SnapTarget also
 * docks it against that edge. `bounds` lets the pop-out take over the space
 * the main window occupied, so shrinking reads as one window changing shape
 * rather than another appearing elsewhere.
 */
export function handOverToPopout(opts: {
  onClosed: () => void;
  onSettingsChanged: (s: AppSettings) => void;
  target?: SnapTarget | null;
  bounds?: Electron.Rectangle | null;
}): void {
  const { onClosed, onSettingsChanged, target = null, bounds = null } = opts;
  const alreadyOpen = isPopoutOpen();
  if (!alreadyOpen) {
    createPopout(onClosed);
    onSettingsChanged(writeSettings({ ...readSettings(), popoutOpen: true }));
  }

  // A freshly created window is not done constructing; let it settle before
  // moving it, exactly as the title bar's dock has always done.
  const place = () => {
    const popout = getPopout();
    if (!popout || popout.isDestroyed()) return;
    if (bounds) {
      try { popout.setBounds(bounds); } catch { /* bounds off-screen; leave it */ }
    }
    if (target) snapWindow(popout, target);
    popout.show();
    popout.focus();
  };
  if (alreadyOpen) place();
  else setTimeout(place, 100);
}

export function destroyPopout() {
  const w = getPopout();
  if (w) w.close();
  popoutWindow = null;
}

/** Push live analyser data to the pop-out. No-op when it isn't open. */
export function forwardVizFrame(payload: unknown) {
  const w = getPopout();
  if (w) w.webContents.send(IpcChannel.vizFrame, payload);
}

/** Push the slower-moving state (capturing, buffer fill, theme…). */
export function forwardVizState(payload: unknown) {
  const w = getPopout();
  if (w) w.webContents.send(IpcChannel.vizState, payload);
}

export function forwardVizHistory(payload: unknown) {
  const w = getPopout();
  if (w) w.webContents.send(IpcChannel.vizHistory, payload);
}

/** Re-apply the pop-out's window-level settings after a settings save. */
export function applyPopoutSettings() {
  const w = getPopout();
  if (!w) return;
  const s = readSettings();
  try { w.setAlwaysOnTop(s.popoutAlwaysOnTop, 'floating'); } catch { /* ignore */ }
  try { w.setOpacity(clampOpacity(s.popoutOpacity)); } catch { /* ignore */ }
}

function clampOpacity(v: number): number {
  if (!Number.isFinite(v)) return 1;
  return Math.min(1, Math.max(0.2, v));
}
