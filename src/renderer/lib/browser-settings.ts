/**
 * Settings persistence for the browser / Capacitor target.
 *
 * DOM-free on purpose — the storage is injected, so this module runs (and is
 * tested) under plain Node as well as in a browser. The Electron target keeps
 * its own file-backed store in `src/main/settings.ts`.
 */
import { AppSettings, DEFAULT_SETTINGS } from '../../shared/types';

export const SETTINGS_KEY = 'recordr.settings.v1';

/** The only two members of the Web Storage API this needs (keeps it DOM-free). */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * Merge a stored (or partial) settings object onto the defaults.
 *
 * Two rules, both there to make a corrupt or stale entry harmless:
 *   - unknown keys from another build are dropped;
 *   - a value of the wrong *type* is dropped rather than adopted, so a
 *     hand-edited `"bufferSeconds": "60"` can't hand the app a string where it
 *     expects a number.
 * That is the same hazard `readSettings()` guards against on the Electron side.
 */
export function mergeSettings(raw: unknown): AppSettings {
  const out: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return out as unknown as AppSettings;
  }
  const src = raw as Record<string, unknown>;
  for (const [key, fallback] of Object.entries(DEFAULT_SETTINGS)) {
    if (!(key in src)) continue;
    const value = src[key];
    if (fallback === null) {
      // Nullable string settings (sourceId, loopbackDeviceId).
      if (value === null || typeof value === 'string') out[key] = value;
      continue;
    }
    if (Array.isArray(fallback)) {
      if (Array.isArray(value) && value.every((v) => typeof v === 'string')) out[key] = value;
      continue;
    }
    if (typeof value === typeof fallback) out[key] = value;
  }
  return out as unknown as AppSettings;
}

export interface SettingsStore {
  read(): AppSettings;
  write(patch: Partial<AppSettings>): AppSettings;
  subscribe(listener: (s: AppSettings) => void): () => void;
}

/**
 * A tiny settings store over any key/value backend.
 *
 * `read()` is cached and `write()` updates the cache before touching storage,
 * so a backend that throws (Safari private mode, a full quota) degrades to
 * "settings work for this session but don't survive a reload" instead of
 * breaking the UI.
 */
export function createSettingsStore(
  storage: KeyValueStore,
  key: string = SETTINGS_KEY,
): SettingsStore {
  let cache: AppSettings | null = null;
  const listeners = new Set<(s: AppSettings) => void>();

  const read = (): AppSettings => {
    if (cache) return cache;
    let raw: unknown = null;
    try {
      const text = storage.getItem(key);
      if (text) raw = JSON.parse(text);
    } catch {
      raw = null; // unparseable — fall back to defaults, exactly like a missing key
    }
    cache = mergeSettings(raw);
    return cache;
  };

  const write = (patch: Partial<AppSettings>): AppSettings => {
    const next = { ...read(), ...patch };
    cache = next;
    try {
      storage.setItem(key, JSON.stringify(next));
    } catch {
      /* quota / disabled storage — keep the in-memory copy */
    }
    for (const listener of listeners) listener(next);
    return next;
  };

  const subscribe = (listener: (s: AppSettings) => void): (() => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };

  return { read, write, subscribe };
}
