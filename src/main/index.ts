import { app, BrowserWindow, Menu, nativeImage } from 'electron';
import path from 'node:path';
import { readSettings, writeSettings } from './settings';
import { HotkeyManager } from './hotkeys';
import { IpcChannel, RecorderEvent } from '../shared/types';
import { registerIpc } from './ipc';
import { initTray, destroyTray, makeAppIcon } from './tray';

const isDev = process.env.NODE_ENV === 'development';

let mainWindow: BrowserWindow | null = null;
const hotkeyMgr = new HotkeyManager();

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 760,
    // The renderer layout has compact breakpoints down to this floor (see the
    // "Compact / responsive" block in src/renderer/styles.css), so the window
    // can be dragged this small and still show every control.
    minWidth: 380,
    minHeight: 300,
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
    },
  });

  Menu.setApplicationMenu(null);

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }  mainWindow.once('ready-to-show', () => {
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
    if (!(app as unknown as { isQuitting?: boolean }).isQuitting) {
      e.preventDefault();
      mainWindow?.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Apply initial always-on-top flag.
  try { mainWindow.setAlwaysOnTop(readSettings().alwaysOnTop, 'floating'); }
  catch { /* ignore on platforms that don't support the floating level */ }
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
      onSettingsChanged: (s) => {
        applyHotkey(s.hotkey);
        // Apply always-on-top; the tray module has direct refs to the
        // current window/settings so it can rebuild itself when notified.
        if (mainWindow && !mainWindow.isDestroyed()) {
          try { mainWindow.setAlwaysOnTop(s.alwaysOnTop, 'floating'); }
          catch { /* ignore */ }
        }
      },
      getCurrentHotkey: () => hotkeyMgr.accel(),
    });

    const initial = readSettings();
    applyHotkey(initial.hotkey);

    createWindow();

    // Initialise the tray after both window and ipc are ready so the menu
    // can call back into both safely.
    initTray(
      () => mainWindow,
      () => readSettings(),
      (patch) => writeSettings({ ...readSettings(), ...patch }),
    );

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('before-quit', () => {
    // Allow our explicit Quit menu item to actually tear down the window.
    (app as unknown as { isQuitting?: boolean }).isQuitting = true;
    hotkeyMgr.unregister();
    destroyTray();
  });

  app.on('window-all-closed', () => {
    hotkeyMgr.unregister();
    // Don't quit when the window is just hidden via the tray (close handler
    // hides; tray menu's Quit calls app.quit()).
  });
}

init();
