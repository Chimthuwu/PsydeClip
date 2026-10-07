import { BrowserWindow, screen } from 'electron';
import path from 'node:path';
import { ClipWindowState, IpcChannel } from '../shared/types';

/**
 * A tiny always-on-top window that shows the live clip-recording timer + a
 * stop / discard control. It exists only while a clip is recording.
 *
 * It's a separate OS window (not a DOM overlay inside the main window) so the
 * indicator is visible no matter what the app is doing — minimised, hidden to
 * the tray, or docked. It owns no recording
 * state: the main renderer drives the clip, this window just displays it and
 * relays its two buttons back as `viz:command` (`toggle-clip` / `discard-clip`).
 */

const isDev = process.env.NODE_ENV === 'development';

let clipWindow: BrowserWindow | null = null;
let lastState: ClipWindowState | null = null;

function get(): BrowserWindow | null {
  return clipWindow && !clipWindow.isDestroyed() ? clipWindow : null;
}

function place(win: BrowserWindow) {
  // Bottom-centre of whichever display the cursor is on, clear of the taskbar.
  const cursor = screen.getCursorScreenPoint();
  const wa = screen.getDisplayNearestPoint(cursor).workArea;
  const b = win.getBounds();
  win.setBounds({
    x: Math.round(wa.x + (wa.width - b.width) / 2),
    y: Math.round(wa.y + wa.height - b.height - 24),
    width: b.width,
    height: b.height,
  });
}

function create(): BrowserWindow {
  clipWindow = new BrowserWindow({
    width: 258,
    height: 140,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    // Shown with showInactive() so it never steals focus from the user's DAW
    // on appear; clicking Stop/✕ will briefly focus it, which is fine for a
    // deliberate action. (focusable:false on Windows can eat button clicks.)
    alwaysOnTop: true,
    title: 'Recordr — Recording clip',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
    },
  });

  const w = clipWindow;
  // Sit above full-screen apps and follow the user across virtual desktops.
  try { w.setAlwaysOnTop(true, 'screen-saver'); } catch { /* ignore */ }
  try { w.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true }); } catch { /* ignore */ }

  if (isDev) {
    void w.loadURL('http://localhost:5173/#clip');
  } else {
    void w.loadFile(path.join(__dirname, '../renderer/index.html'), { hash: 'clip' });
  }

  w.once('ready-to-show', () => {
    if (!get()) return;
    place(w);
    w.showInactive();
    if (lastState) w.webContents.send(IpcChannel.clipWindowState, lastState);
  });
  w.webContents.on('did-finish-load', () => {
    if (lastState) w.webContents.send(IpcChannel.clipWindowState, lastState);
  });
  w.on('closed', () => {
    clipWindow = null;
  });
  return w;
}

/**
 * Show / update / hide the clip window to match `state`. Called from the
 * `clip:window-set` IPC handler whenever the main renderer's clip state changes.
 */
export function setClipWindow(state: ClipWindowState) {
  lastState = state;
  if (state.active) {
    const w = get() ?? create();
    if (w.webContents.isLoading()) return; // 'did-finish-load' will flush lastState
    w.webContents.send(IpcChannel.clipWindowState, state);
    if (!w.isVisible()) {
      place(w);
      w.showInactive();
    }
  } else {
    destroyClipWindow();
  }
}

export function destroyClipWindow() {
  const w = get();
  lastState = null;
  if (w) w.close();
  clipWindow = null;
}
