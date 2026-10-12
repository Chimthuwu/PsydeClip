import { Tray, Menu, nativeImage, BrowserWindow, app, shell } from 'electron';
import { AppSettings } from '../shared/types';
// (snapWindow is no longer reached from the tray: docking goes through the pop-out.)
import { createPopout, destroyPopout, handOverToPopout, isPopoutOpen } from './popout';
import { resetWorkArea } from './appbar';
import { ICON_16_DATA_URL, ICON_32_DATA_URL, ICON_256_DATA_URL } from './icon-assets';

let trayInstance: Tray | null = null;
let isAlwaysOnTop = false;
let isCapturing = false;
let captureStartedAt = 0;
let elapsedTimer: NodeJS.Timeout | null = null;

interface RecentSave {
  fileName: string;
  fullPath: string;
  at: number; // Date.now()
}
const recentSaves: RecentSave[] = [];
const RECENT_MAX = 5;
const LAST_SAVE_FLASH_MS = 30_000;
let lastSaveFlashUntil = 0;

let setSettingsRef: ((patch: Partial<AppSettings>) => AppSettings) | null = null;
let getSettingsRef: (() => AppSettings) | null = null;
let getWindowRef: (() => BrowserWindow | null) | null = null;
let onPopoutClosedRef: (() => void) | null = null;

const REC_RED = { r: 255, g: 93, b: 108 };

/**
 * The oscilloscope-wave mark (see scripts/make-icon.js for the artwork). The
 * 16px image carries a @2x representation so it stays crisp on high-DPI
 * Windows taskbars; recording state is conveyed by the red overlay badge in
 * refreshTray, not by recolouring the trace.
 */
export function makeTrayIcon(_capturing = false): Electron.NativeImage {
  const img = nativeImage.createFromDataURL(ICON_16_DATA_URL);
  try {
    img.addRepresentation({ scaleFactor: 2, dataURL: ICON_32_DATA_URL });
  } catch { /* ignore — single-scale still fine */ }
  return img;
}

/** Same artwork at 256px — for window title / dock / taskbar (dev runs). */
export function makeAppIcon(): Electron.NativeImage {
  return nativeImage.createFromDataURL(ICON_256_DATA_URL);
}

/**
 * 16x16 overlay badge: a small red dot in the top-right corner. Drawn on top
 * of the tray icon when actively capturing so the user can see the state
 * even when they don't hover.
 */
function makeOverlayBadge(): Electron.NativeImage {
  const size = 16;
  const buf = Buffer.alloc(size * size * 4); // alpha 0 by default
  const cx = 12;
  const cy = 4;
  const r2max = 9;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const r2 = dx * dx + dy * dy;
      const i = (y * size + x) * 4;
      if (r2 < r2max) {
        buf[i + 0] = REC_RED.r;
        buf[i + 1] = REC_RED.g;
        buf[i + 2] = REC_RED.b;
        buf[i + 3] = 255;
      }
    }
  }
  return nativeImage.createFromBuffer(buf, { width: size, height: size, scaleFactor: 1.0 });
}

/**
 * Headless init: keep this importable so we don't accidentally create a tray
 * before app.whenReady() in unit tests.
 */
export function initTray(
  getWindow: () => BrowserWindow | null,
  getSettings: () => AppSettings,
  setSettings: (patch: Partial<AppSettings>) => AppSettings,
  onPopoutClosed?: () => void,
): Tray {
  getWindowRef = getWindow;
  setSettingsRef = setSettings;
  getSettingsRef = getSettings;
  onPopoutClosedRef = onPopoutClosed ?? null;

  if (!trayInstance) {
    trayInstance = new Tray(makeTrayIcon(false));
    trayInstance.setIgnoreDoubleClickEvents(false);
    trayInstance.on('click', () => toggleWindow());
    trayInstance.on('double-click', () => toggleWindow());
  }
  refreshTray();
  return trayInstance;
}

export function destroyTray() {
  if (elapsedTimer) clearInterval(elapsedTimer);
  elapsedTimer = null;
  if (trayInstance) {
    trayInstance.destroy();
    trayInstance = null;
  }
  setSettingsRef = null;
  getSettingsRef = null;
  getWindowRef = null;
}

/**
 * Renderer signals that the recorder has flipped into "capturing" state.
 * Starts an internal per-second ticker that keeps the tooltip + tray title
 * in sync with elapsed time without round-tripping the renderer.
 */
export function setCapturingState(capturing: boolean) {
  if (isCapturing === capturing) {
    // Even when the state doesn't change, just refresh the menu/icons in
    // case the recent-saves list or settings shifted.
    refreshTray();
    return;
  }
  isCapturing = capturing;
  captureStartedAt = capturing ? Date.now() : 0;

  if (capturing) {
    elapsedTimer ??= setInterval(refreshTray, 1_000);
  } else if (elapsedTimer) {
    clearInterval(elapsedTimer);
    elapsedTimer = null;
  }
  refreshTray();
}

/**
 * Called immediately after a successful save so the tray UI can reflect the
 * new file. Pushes into the recent-saves ring buffer, fires a Windows
 * balloon notification (best effort), and rebuilds the menu.
 */
export function notifySaveCompleted(opts: { fileName: string; fullPath: string }) {
  recentSaves.unshift({ fileName: opts.fileName, fullPath: opts.fullPath, at: Date.now() });
  if (recentSaves.length > RECENT_MAX) recentSaves.length = RECENT_MAX;
  lastSaveFlashUntil = Date.now() + LAST_SAVE_FLASH_MS;

  // Best-effort Windows balloon. Other platforms ignore.
  try {
    trayInstance?.displayBalloon({
      title: 'Recording saved',
      content: opts.fileName,
    });
  } catch { /* ignore — displayBalloon only on Win */ }

  refreshTray();
  refreshTitle();
}

export function clearRecentIfStale() {
  if (lastSaveFlashUntil && Date.now() > lastSaveFlashUntil) {
    refreshTray();
  }
}

// ----- internals ------------------------------------------------------

function refreshTray() {
  if (!trayInstance) return;
  const s = getSettingsRef?.();
  isAlwaysOnTop = s?.alwaysOnTop ?? false;

  const win = getWindowRef?.();
  if (win && !win.isDestroyed()) {
    try { win.setAlwaysOnTop(isAlwaysOnTop, 'floating'); } catch { /* ignore */ }
  }

  trayInstance.setImage(makeTrayIcon(isCapturing));
  trayInstance.setToolTip(buildTooltip());

  // Windows overlay badge — bright red dot when capturing.
  // Method is present at runtime in Electron 30 but typings in this version
  // don't include it; cast through any to keep TS happy.
  if (process.platform === 'win32') {
    const t = trayInstance as unknown as {
      setOverlayIcon?: (img: Electron.NativeImage | null, desc: string) => void;
    };
    if (typeof t.setOverlayIcon === 'function') {
      try {
        if (isCapturing) {
          t.setOverlayIcon(makeOverlayBadge(), 'Recording');
        } else {
          t.setOverlayIcon(null, '');
        }
      } catch { /* ignore */ }
    }
  }

  refreshTitle();

  trayInstance.setContextMenu(buildMenu());
}

function refreshTitle() {
  if (!trayInstance) return;
  // Mac: pops up next to tray icon. Windows 10+: only on hover, but harmless.
  try {
    if (isCapturing) {
      const elapsedSec = Math.floor(elapsedSecNow() / 1000);
      trayInstance.setTitle(`● ${formatMs(elapsedSec)}`);
    } else {
      trayInstance.setTitle('');
    }
  } catch { /* ignore */ }
}

function buildTooltip(): string {
  const lines: string[] = [];
  if (isCapturing) {
    const elapsedSec = Math.floor(elapsedSecNow() / 1000);
    lines.push(`● Recording  ${formatMs(elapsedSec)}`);
  } else {
    lines.push('Unrecordable — idle');
  }
  const settings = getSettingsRef?.();
  if (settings?.saveFolder) {
    lines.push(`Folder: ${settings.saveFolder}`);
  }
  const recent = recentSaves[0];
  if (recent && Date.now() < lastSaveFlashUntil) {
    lines.push(`Last save: ${recent.fileName}`);
  }
  return lines.join('\n');
}

function buildMenu(): Electron.Menu {
  const elapsedSec = Math.floor(elapsedSecNow() / 1000);
  const elapsedLabel = isCapturing ? `● Recording ${formatMs(elapsedSec)}` : '○ Idle';

  const recent = recentSaves.slice(0, RECENT_MAX).map((s) => ({
    label: s.fileName,
    toolTip: `Saved ${secondsAgo(s.at)} ago`,
    click: () => {
      // Show the file in its folder — works on Win/Mac/Linux.
      shell.showItemInFolder(s.fullPath);
    },
  }));

  const recentSubmenu = recent.length === 0
    ? [{ label: '(none yet)', enabled: false }]
    : [{ label: 'Open containing folder', enabled: false } as const, ...recent];

  return Menu.buildFromTemplate([
    { label: elapsedLabel, enabled: false },
    { type: 'separator' },
    { label: 'Show / hide window', click: () => toggleWindow() },
    {
      label: 'Always on top',
      type: 'checkbox',
      checked: isAlwaysOnTop,
      click: () => setAlwaysOnTop(!isAlwaysOnTop),
    },
    {
      label: 'Pop-out visualizer',
      type: 'checkbox',
      checked: isPopoutOpen(),
      click: () => togglePopoutFromTray(),
    },
    {
      label: 'Dock to top of screen',
      // Docks the POP-OUT, same as the title bar's dock and the quick menu's.
      // These used to disagree — the tray docked the main window — and the
      // result was the thing the owner reported: a monitor-wide strip with no
      // visualizer buttons, because the main window's HUD has no small form.
      // A docked window is always the pop-out now (2026-10-12).
      click: () => {
        handOverToPopout({
          onClosed: () => onPopoutClosedRef?.(),
          onSettingsChanged: (next) => setSettingsRef?.(next),
          target: 'top',
        });
        refreshTray();
      },
    },
    // Crash recovery, not a feature: a force-killed instance can leave the
    // desktop work area reserved with no window in it (Windows won't give the
    // space back on its own). The startup reclaim handles that when a marker
    // survived; this is the always-available manual fallback.
    {
      label: 'Fix desktop work area',
      enabled: process.platform === 'win32',
      click: () => {
        const ok = resetWorkArea();
        try {
          trayInstance?.displayBalloon({
            title: ok ? 'Desktop work area reset' : 'Reset failed',
            content: ok
              ? 'If the top of your screen was hidden, it should be back now.'
              : 'Could not reset the work area. Try logging out and back in.',
          });
        } catch { /* ignore */ }
      },
    },
    { type: 'separator' },
    {
      label: 'Open save folder',
      enabled: !!getSettingsRef?.()?.saveFolder,
      click: () => {
        const folder = getSettingsRef?.()?.saveFolder;
        if (folder) shell.openPath(folder).catch(() => {});
      },
    },
    {
      label: 'Recent saves',
      submenu: recentSubmenu as any,
    },
    { type: 'separator' },
    {
      label: 'Settings…',
      click: () => openSettings(),
    },
    { type: 'separator' },
    { label: 'Quit Unrecordable', click: () => app.quit() },
  ]);
}

function toggleWindow() {
  const w = getWindowRef?.();
  if (!w || w.isDestroyed()) return;
  if (w.isVisible() && w.isFocused()) w.hide();
  else { w.show(); w.focus(); }
}

function setAlwaysOnTop(value: boolean) {
  const w = getWindowRef?.();
  if (!w || w.isDestroyed()) return;
  try { w.setAlwaysOnTop(value, 'floating'); } catch { /* ignore */ }
  isAlwaysOnTop = value;
  if (setSettingsRef) {
    try { setSettingsRef({ alwaysOnTop: value }); } catch { /* ignore */ }
  }
  refreshTray();
}

function togglePopoutFromTray() {
  if (isPopoutOpen()) {
    destroyPopout();
    setSettingsRef?.({ popoutOpen: false });
  } else {
    createPopout(() => onPopoutClosedRef?.());
    setSettingsRef?.({ popoutOpen: true });
  }
  refreshTray();
}

function openSettings() {
  const w = getWindowRef?.();
  if (!w || w.isDestroyed()) return;
  w.show();
  w.focus();
  w.webContents.send('window:open-settings');
}

function elapsedSecNow(): number {
  return isCapturing && captureStartedAt ? Date.now() - captureStartedAt : 0;
}

function formatMs(totalSec: number): string {
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function secondsAgo(ts: number): string {
  const sec = Math.floor((Date.now() - ts) / 1000);
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}
