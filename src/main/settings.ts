import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import { AppSettings, DEFAULT_SETTINGS } from '../shared/types';

const SETTINGS_FILENAME = 'recordr-settings.json';

function settingsPath(): string {
  return path.join(app.getPath('userData'), SETTINGS_FILENAME);
}

export function readSettings(): AppSettings {
  try {
    const raw = fs.readFileSync(settingsPath(), 'utf8');
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function writeSettings(next: AppSettings): AppSettings {
  const merged: AppSettings = { ...DEFAULT_SETTINGS, ...next };
  const file = settingsPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(merged, null, 2), 'utf8');
  fs.renameSync(tmp, file);
  return merged;
}
