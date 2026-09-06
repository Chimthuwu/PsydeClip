import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import { AppSettings, DEFAULT_SETTINGS, VISUALIZER_MODES } from '../shared/types';

const SETTINGS_FILENAME = 'recordr-settings.json';

function settingsPath(): string {
  return path.join(app.getPath('userData'), SETTINGS_FILENAME);
}

export function readSettings(): AppSettings {
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
