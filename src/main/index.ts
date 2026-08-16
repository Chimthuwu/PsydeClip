import { app, BrowserWindow, Menu } from 'electron';
import path from 'node:path';
import { readSettings, writeSettings } from './settings';
import { HotkeyManager } from './hotkeys';
import {
  AppSettings,
  IpcChannel,
  LAYOUT_MIN_SIZE,
  RecorderEvent,
} from '../shared/types';
import { registerIpc } from './ipc';
import { initTray, destroyTray, makeAppIcon } from './tray';
import { applyMagneticSnap } from './window-controls';
import { applyPopoutSettings, createPopout, destroyPopout, getPopout } from './popout';

const isDev = process.env.NODE_ENV === 'development';


let mainWindow: BrowserWindow | null = null;
/** Title-bar mode the live window was built with — a change needs a rebuild. */
let builtTitleBarMode: AppSettings['titleBarMode'] = 'custom';
/** Set while we tear the window down on purpose (frame change), so the
 *  hide-on-close handler doesn't intercept and the app doesn't quit. */
let recreating = false;
const hotkeyMgr = new HotkeyManager();

function createWindow(bounds?: Electron.Rectangle) {
  const settings = readSettings();
  builtTitleBarMode = settings.titleBarMode;
  const min = LAYOUT_MIN_SIZE[settings.uiLayout] ?? LAYOUT_MIN_SIZE.full;

  mainWindow = new BrowserWindow({
    width: bounds?.width ?? 1100,
    height: bounds?.height ?? 760,
    x: bounds?.x,
    y: bounds?.y,
    // The floor tracks the active layout (see LAYOUT_MIN_SIZE): `bar` is a
    // 34px strip, `full` still has to fit the visualizer. main re-clamps this
    // whenever the renderer switches layout.
    minWidth: min.width,
    minHeight: min.height,
    // 'custom' drops the OS title bar entirely; the renderer draws a 26px
    // strip instead (src/renderer/components/TitleBar.tsx).
    frame: settings.titleBarMode !== 'custom',
    title: 'Recordr',
    backgroundColor: '#070a1c',
    autoHideMenuBar: true,
    show: false, // show after ready-to-show
    icon: makeAppIcon(),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      // This window is the audio engine, not just a view: it owns the
      // AnalyserNode, the rolling-buffer bookkeeping and the frame pump that
      // feeds the pop-out. Chromium throttles timers and animation frames to a
      // crawl for backgrounded windows — and Recordr spends most of its life
      // minimised or hidden to the tray, which is exactly when it must keep
      // running.
      backgroundThrottling: false,
    },
  });

  Menu.setApplicationMenu(null);

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }
  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  // Forward renderer console + lifecycle failures to main stderr so we can
  // see them in --enable-logging output. Only enabled when RECORDR_DEBUG=1.
  if (process.env.RECORDR_DEBUG) {
    mainWindow.webContents.on('console-message', (_e, level, message, line, src) => {
      const lvl = ['V', 'I', 'W', 'E'][level] ?? `${level}`;
      process.stderr.write(`[rend:${lvl}] ${src}:${line} ${message}\n`);
    });
    mainWindow.webContents.on('render-process-gone', (_e, d) => {
      process.stderr.write(`[rend:gone] reason=${d.reason} ec=${d.exitCode}\n`);
    });
    mainWindow.webContents.on('did-fail-load', (_e, c, d, u) => {
      process.stderr.write(`[rend:fail-load] ${c} ${d} url=${u}\n`);
    });
    mainWindow.webContents.on('preload-error', (_e, p, e) => {
      process.stderr.write(`[rend:preload-err] ${p} ${e?.message ?? e}\n`);
    });
  }

  // Closing the window hides it (tray keeps the app alive). Real quit is
  // triggered from the tray menu's Quit item, before which isQuitting flips
  // to true so this close handler doesn't intercept.
  mainWindow.on('close', (e) => {
    if (recreating) return;
    if (!(app as unknown as { isQuitting?: boolean }).isQuitting) {
      e.preventDefault();
      mainWindow?.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Magnetic edge snap. Windows emits `moved` when the drag ends, so this
  // reads as "let go near the top of the screen and it clicks into place".
  mainWindow.on('moved', () => {
    if (readSettings().magneticSnap) applyMagneticSnap(mainWindow);
  });

  // Let the renderer re-render its maximise/restore glyph.
  const pushWindowState = () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents.send(IpcChannel.windowState, {
      maximized: mainWindow.isMaximized(),
      focused: mainWindow.isFocused(),
    });
  };
  mainWindow.on('maximize', pushWindowState);
  mainWindow.on('unmaximize', pushWindowState);
  mainWindow.on('focus', pushWindowState);
  mainWindow.on('blur', pushWindowState);

  // Apply initial always-on-top flag.
  try { mainWindow.setAlwaysOnTop(readSettings().alwaysOnTop, 'floating'); }
  catch { /* ignore on platforms that don't support the floating level */ }
}

/**
 * Electron can't toggle a window's frame after creation, so switching between
 * the OS title bar and our own means building a fresh window at the same
 * bounds. The renderer reloads; an in-progress capture does not survive, which
 * is why the settings UI says so.
 */
function recreateWindow() {
  const old = mainWindow;
  const bounds = old && !old.isDestroyed() ? old.getBounds() : undefined;
  recreating = true;
  try {
    if (old && !old.isDestroyed()) old.destroy();
  } finally {
    recreating = false;
  }
  createWindow(bounds);
}

/**
 * Everything that has to happen after settings are written, from wherever:
 * the settings modal, the tray menu, or the title bar's pin button.
 */
function handleSettingsChanged(s: AppSettings) {
  applyHotkey(s.hotkey);
  // Apply always-on-top; the tray module has direct refs to the current
  // window/settings so it can rebuild itself when notified.
  if (mainWindow && !mainWindow.isDestroyed()) {
    try { mainWindow.setAlwaysOnTop(s.alwaysOnTop, 'floating'); }
    catch { /* ignore */ }
  }
  applyPopoutSettings();
  // Mirror the new settings into every window so the pop-out picks up
  // theme/visualizer changes made in the main window and vice-versa.
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(IpcChannel.settingsChanged, s);
  }
  // Deferred: this runs inside the settings:set IPC handler, and tearing the
  // sender's window down mid-call is a good way to lose the reply channel.
  if (s.titleBarMode !== builtTitleBarMode) setImmediate(recreateWindow);
}

/** The pop-out was closed by its own ✕ (or by us) — persist and tell the UI. */
function onPopoutClosed() {
  handleSettingsChanged(writeSettings({ ...readSettings(), popoutOpen: false }));
  const w = mainWindow;
  if (w && !w.isDestroyed()) w.webContents.send(IpcChannel.popoutState, { open: false });
}

function broadcast(event: RecorderEvent) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(IpcChannel.recordingEvent, event);
  }
}

function applyHotkey(hotkey: string) {
  hotkeyMgr.register(hotkey, () => {
    broadcast({ type: 'hotkey-pressed' });
  });
}

function init() {
  // ----- Single-instance lock ----------------------------------------------
  // A second launch focuses the existing window instead of opening a new one.
  const gotLock = app.requestSingleInstanceLock();
  if (!gotLock) {
    app.quit();
    return;
  }
  app.on('second-instance', () => {
    const w = mainWindow;
    if (!w || w.isDestroyed()) return;
    if (w.isMinimized()) w.restore();
    if (!w.isVisible()) w.show();
    w.focus();
  });

  app.whenReady().then(() => {
    registerIpc({
      getWindow: () => mainWindow,
      onSettingsChanged: handleSettingsChanged,
      getCurrentHotkey: () => hotkeyMgr.accel(),
      recreateWindow,
    });

    const initial = readSettings();
    applyHotkey(initial.hotkey);

    createWindow();

    // Initialise the tray after both window and ipc are ready so the menu
    // can call back into both safely.
    initTray(
      () => mainWindow,
      () => readSettings(),
      (patch) => {
        // Route tray writes through the same path as the settings modal so
        // the renderer sees them (layout, pop-out, always-on-top…).
        const merged = writeSettings({ ...readSettings(), ...patch });
        handleSettingsChanged(merged);
        return merged;
      },
      onPopoutClosed,
    );

    if (initial.popoutOpen) createPopout(onPopoutClosed);

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('before-quit', () => {
    // Allow our explicit Quit menu item to actually tear down the window.
    (app as unknown as { isQuitting?: boolean }).isQuitting = true;
    hotkeyMgr.unregister();
    destroyTray();
    if (getPopout()) destroyPopout();
  });

  app.on('window-all-closed', () => {
    hotkeyMgr.unregister();
    // Don't quit when the window is just hidden via the tray (close handler
    // hides; tray menu's Quit calls app.quit()).
  });
}

init();
