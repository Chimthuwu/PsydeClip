import { app, BrowserWindow, Menu, screen } from 'electron';
import fs from 'node:fs';
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
import { handleWindowMoved, reapplyOnResize } from './window-controls';
import {
  appBarOwner,
  reapplyAppBar,
  reclaimStaleAppBar,
  removeAppBar,
  wireAppBarTeardown,
} from './appbar';
import {
  applyPopoutSettings,
  consumePopoutKeepMain,
  createPopout,
  destroyPopout,
  getPopout,
} from './popout';
import { pruneAbandonedClips } from './clip';
import { destroyClipWindow } from './clip-window';

const isDev = process.env.NODE_ENV === 'development';


let mainWindow: BrowserWindow | null = null;
/** Title-bar mode the live window was built with — a change needs a rebuild. */
let builtTitleBarMode: AppSettings['titleBarMode'] = 'custom';
/** Last seen `popoutOpen`, so the hide/show policy fires on transitions only. */
let lastPopoutOpen = false;
/** Set when the app starts straight into pop-out mode — don't flash the main
 *  window on screen just to hide it again a frame later. */
let suppressInitialShow = false;
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
    // strip instead (src/renderer/components/TitleBar.tsx). It's also
    // transparent so `.app` can round its bottom corners (Win10 won't round a
    // frameless window itself).
    frame: settings.titleBarMode !== 'custom',
    transparent: settings.titleBarMode === 'custom',
    title: 'Recordr',
    backgroundColor: settings.titleBarMode === 'custom' ? '#00000000' : '#070a1c',
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
    if (suppressInitialShow) {
      suppressInitialShow = false;
      return;
    }
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
    if (appBarOwner() === mainWindow) removeAppBar();
    mainWindow = null;
  });

  // Magnetic edge snap. Windows emits `moved` when the drag ends, so this
  // reads as "let go near the top of the screen and it clicks into place".
  // It also releases an appbar reservation if the window is dragged out of the
  // dock — see handleWindowMoved().
  mainWindow.on('moved', () => handleWindowMoved(mainWindow));
  mainWindow.on('resized', () => reapplyOnResize(mainWindow));

  const pushWindowState = () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;

    const min = LAYOUT_MIN_SIZE[readSettings().uiLayout];
    if (min) mainWindow.setMinimumSize(min.width, min.height);

    mainWindow.webContents.send(IpcChannel.windowState, {
      maximized: mainWindow.isMaximized(),
      focused: mainWindow.isFocused(),
    });
  };
  mainWindow.on('maximize', pushWindowState);
  mainWindow.on('unmaximize', pushWindowState);
  mainWindow.on('focus', pushWindowState);
  mainWindow.on('blur', pushWindowState);
  mainWindow.on('moved', () => {
    handleWindowMoved(mainWindow);
    pushWindowState();
  });
  mainWindow.on('resized', () => {
    reapplyOnResize(mainWindow);
    pushWindowState();
  });

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
  applyPopoutWindowSwap(s);
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

/**
 * Popping the visualizer out should *move* the app into that window, not add a
 * second one — so the main window hides while the pop-out is up and comes back
 * when it closes.
 *
 * Only transitions of `popoutOpen` act, because this runs on every settings
 * write: without the guard, changing the theme while popped out would yank a
 * main window the user had deliberately brought back via the tray.
 *
 * The main window is only hidden, never closed. It keeps running the capture,
 * the rolling buffer and the frame pump that feeds the pop-out (which is why
 * `backgroundThrottling` is off), and Show in the tray menu always gets it back.
 */
function applyPopoutWindowSwap(s: AppSettings) {
  if (s.popoutOpen === lastPopoutOpen) return;
  lastPopoutOpen = s.popoutOpen;
  const w = mainWindow;
  if (!w || w.isDestroyed()) return;
  if (s.popoutOpen) {
    // A per-pane ⧉ pop-out opens *alongside* the main window — the main
    // window keeps showing the rest of the split view while the popped
    // visualizer gets its own window. Only the plain pop-out toggle swaps
    // (hide main while popped).
    if (consumePopoutKeepMain() || !s.hideMainWhenPopped) return;
    w.hide();
  } else {
    if (!s.hideMainWhenPopped) return;
    w.show();
    w.focus();
  }
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

/**
 * Keep the logon auto-recovery in place — the layer beyond the startup
 * reclaim. Together the two cover every "closed unexpectedly" timeline:
 *
 *  1. Relaunch Recordr      → startup reclaim restores the desktop instantly.
 *  2. Never launch it again → at the very next logon this launcher reclaims
 *     the space on its own, zero manual steps.
 *
 * Mechanism: a tiny VBScript dropped into the per-user Startup folder, which
 * runs at every logon with no special privileges (unlike a Task Scheduler
 * logon task, which schtasks refuses to create unelevated). The script checks
 * the crash marker *before* booting anything — a healthy logon costs nothing;
 * only a crashed session (marker left behind) launches `Recordr.exe
 * --fix-workarea`, hidden, which reclaims the space and exits without UI.
 *
 * Rewritten on every packaged startup, so it follows the exe if the install
 * moves (e.g. the win-unpacked build being superseded by the NSIS install),
 * and a deleted launcher quietly comes back. Best-effort: if writing fails,
 * the startup reclaim and the tray's "Fix desktop work area" item still cover
 * recovery. Keep in sync with scripts/install-recovery-launcher.js.
 */
function ensureDesktopRecoveryTask(): void {
  if (!app.isPackaged || process.platform !== 'win32') return;
  const startUpDir = path.join(
    app.getPath('appData'),
    'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup',
  );
  const vbsPath = path.join(startUpDir, 'Recordr Desktop Recovery.vbs');
  const script = buildRecoveryLauncher(process.execPath);
  try {
    fs.mkdirSync(startUpDir, { recursive: true });
    fs.writeFileSync(vbsPath, script, 'utf8');
  } catch (err) {
    console.warn('[appbar] could not write desktop-recovery launcher:', err);
  }
}

/**
 * The VBScript source for the Startup-folder launcher (the standalone script
 * scripts/install-recovery-launcher.js generates the same file, for use
 * outside the app). VBS ends strings by doubling quotes, so `"""<exe>""`
 * renders the quoted command line WScript.Shell.Run expects.
 */
function buildRecoveryLauncher(exePath: string): string {
  const marker = path.join(app.getPath('userData'), 'appbar-active');
  // VBS treats backslashes literally (no escape sequences), but JS template
  // literals would eat `\r`/`\u`… out of a Windows path — double them first.
  const vbs = (p: string) => p.replace(/\\/g, '\\\\').replace(/"/g, '""');
  return [
    `' Recordr desktop recovery: reclaims the top-of-screen strip an unexpected`,
    `' exit can leave reserved. Generated by Recordr at startup; safe to delete.`,
    `On Error Resume Next`,
    `Set fso = CreateObject("Scripting.FileSystemObject")`,
    `If Not fso.FileExists("${vbs(marker)}") Then WScript.Quit 0`,
    `CreateObject("WScript.Shell").Run """${vbs(exePath)}"" --fix-workarea", 0, False`,
    '',
  ].join('\n');
}

function init() {
  // ----- One-shot desktop recovery mode -----------------------------------
  // `Recordr.exe --fix-workarea` exists so a reservation left behind by an
  // unexpected exit can be reclaimed *without launching the app proper* — the
  // Startup-folder launcher kept from ensureDesktopRecoveryTask() below runs
  // it automatically at logon. The single-instance lock doubles as the safety
  // check: if a live instance is running it owns any reservation, so we must
  // not touch the desktop.
  const fixWorkAreaMode = process.argv.includes('--fix-workarea');

  // ----- Single-instance lock ----------------------------------------------
  // A second launch focuses the existing window instead of opening a new one.
  const gotLock = app.requestSingleInstanceLock();
  if (!gotLock) {
    app.quit();
    return;
  }
  app.on('second-instance', () => {
    if (fixWorkAreaMode) return;
    const w = mainWindow;
    if (!w || w.isDestroyed()) return;
    if (w.isMinimized()) w.restore();
    if (!w.isVisible()) w.show();
    w.focus();
  });

  // A reservation that outlives its window leaves the user with a dead strip
  // of desktop they can't reclaim without logging out, so this is wired before
  // anything can register one.
  wireAppBarTeardown(app);

  app.whenReady().then(() => {
    if (fixWorkAreaMode) {
      // No window, no tray: reclaim whatever the last run left behind and exit
      // before any UI could ever flash on screen.
      reclaimStaleAppBar();
      app.exit(0);
      return;
    }

    // If the last run died holding a reservation, the desktop is still short of
    // that space. Reclaim before anything can register a new one.
    reclaimStaleAppBar();

    // The "fixes on its own even if Recordr is never launched again" layer:
    // keep the logon scheduled task registered. See the function's doc.
    ensureDesktopRecoveryTask();

    // Same "the last run died mid-action" housekeeping: drop any clip temp
    // files a crashed renderer never got to abort. startClip() also prunes,
    // so this is belt-and-braces for runs where no new clip is ever started.
    void pruneAbandonedClips();

    // The shell notifies appbars of layout changes through a window message
    // Electron doesn't dispatch, so these stand in for ABN_POSCHANGED.
    screen.on('display-metrics-changed', reapplyAppBar);
    screen.on('display-added', reapplyAppBar);
    screen.on('display-removed', reapplyAppBar);

    registerIpc({
      getWindow: () => mainWindow,
      onSettingsChanged: handleSettingsChanged,
      getCurrentHotkey: () => hotkeyMgr.accel(),
      recreateWindow,
    });

    const initial = readSettings();
    applyHotkey(initial.hotkey);
    lastPopoutOpen = initial.popoutOpen;
    // Relaunching straight into pop-out mode: skip the main window's first
    // show entirely rather than showing then hiding it.
    suppressInitialShow = initial.popoutOpen && initial.hideMainWhenPopped;

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
    destroyClipWindow();
  });

  app.on('window-all-closed', () => {
    hotkeyMgr.unregister();
    // Don't quit when the window is just hidden via the tray (close handler
    // hides; tray menu's Quit calls app.quit()).
  });
}

init();

