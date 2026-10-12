import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import { AppSettings, DEFAULT_SETTINGS, VISUALIZER_MODES } from '../shared/types';

const SETTINGS_FILENAME = 'recordr-settings.json';

/**
 * The app was called Recordr until 2026-10-12. `userData` is derived from the
 * product name, so the rename moved it from %APPDATA%/Recordr to
 * %APPDATA%/Unrecordable and would have silently reset everybody's save
 * folder, theme and hotkey. The file name inside it is deliberately unchanged.
 */
const LEGACY_USER_DATA_DIR = 'Recordr';

function settingsPath(): string {
  return path.join(app.getPath('userData'), SETTINGS_FILENAME);
}

/**
 * One-shot carry-over of a pre-rename settings file. Copy, never move: an
 * older build left installed keeps working off its own copy.
 */
function migrateLegacySettings(): void {
  const current = settingsPath();
  if (fs.existsSync(current)) return;
  try {
    const legacy = path.join(app.getPath('appData'), LEGACY_USER_DATA_DIR, SETTINGS_FILENAME);
    if (!fs.existsSync(legacy)) return;
    fs.mkdirSync(path.dirname(current), { recursive: true });
    fs.copyFileSync(legacy, current);
    console.log('[settings] carried over pre-rename settings from', legacy);
  } catch (err) {
    console.warn('[settings] could not carry over pre-rename settings:', err);
  }
}

export function readSettings(): AppSettings {
  migrateLegacySettings();
  try {
    let raw = fs.readFileSync(settingsPath(), 'utf8');
    if (raw.charCodeAt(0) === 0xFEFF) {
      raw = raw.slice(1);
    }
    const parsed = JSON.parse(raw);
    // The compact layout was retired: older settings files may still hold it,
    // and nothing may ever treat it as a real mode again.
    if (parsed && typeof parsed === 'object' && (parsed as any).uiLayout === 'compact') {
      (parsed as any).uiLayout = 'full';
    }
    if (parsed && typeof parsed === 'object') {
      const p = parsed as any;
      // The split/single toggle was retired: the board now shows every
      // un-hidden visualizer. An *old* file (one that still carries the
      // `vizGrid` key) with `vizGrid !== true` + empty `vizHidden` used to mean
      // "single view of `visualizer`" — collapse it to that one mode. Guard on
      // the key's presence so this runs ONCE, never on a current file where an
      // empty `vizHidden` legitimately means "all visualizers open".
      if ('vizGrid' in p) {
        if (
          p.vizGrid !== true &&
          (!Array.isArray(p.vizHidden) || p.vizHidden.length === 0)
        ) {
          const keep: string =
            typeof p.visualizer === 'string' ? p.visualizer : DEFAULT_SETTINGS.visualizer;
          p.vizHidden = VISUALIZER_MODES.filter((m) => m !== keep);
        }
        delete p.vizGrid;
      }
      // The default hotkey moved from Shift+Alt+R to Alt+R (now the clip
      // trigger). Bump anyone still on the old default; leave custom bindings.
      if (p.hotkey === 'Shift+Alt+R') p.hotkey = 'Alt+R';
      // 'dark-lime' theme was renamed to 'black-ice' (and restyled).
      if (p.theme === 'dark-lime') p.theme = 'black-ice';
      // The piano-roll lane under History was retired: the MIDI grid is its own
      // visualizer mode now, so an old file's toggle would only resurrect a
      // second, overlapping grid. Drop the key so it can never come back.
      delete p.showMidiLane;
    } else if (parsed !== undefined && !Array.isArray(parsed)) {
      // Not a JSON object (e.g. the file holds a bare literal). Fall through to
      // the defaults rather than merging garbage in; the catch below never sees
      // it because JSON.parse already succeeded.
      console.error(`Settings file at ${settingsPath()} is not a JSON object; using defaults.`);
      return { ...DEFAULT_SETTINGS };
    }
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch (err: any) {
    if (err.code !== 'ENOENT') {
      console.error(`Failed to read/parse settings file at ${settingsPath()}:`, err);
    }
    return { ...DEFAULT_SETTINGS };
  }
}

export function writeSettings(next: AppSettings): AppSettings {
  const merged: AppSettings = { ...DEFAULT_SETTINGS, ...next, uiLayout: 'full' };
  const file = settingsPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(merged, null, 2), 'utf8');
  fs.renameSync(tmp, file);
  return merged;
}
