import fs from 'node:fs/promises';
import path from 'node:path';
import { AppSettings } from '../shared/types';

/**
 * Monotonic counter so repeated saves within the same second can still
 * produce distinct filenames via {counter}.
 */
let saveCounter = 0;

export function resetSaveCounter(): void {
  saveCounter = 0;
}

/**
 * Apply a user's filename template to a concrete on-disk name.
 *
 * Tokens: {date} {time} {year} {month} {day} {hour} {minute} {second}
 *         {unix} {mode} {device} {counter}
 *
 * The function:
 *   - substitutes all known tokens
 *   - leaves unknown `{token}` segments intact (so users notice typos)
 *   - sanitises OS-illegal characters (`/ \ : * ? " < > |`) to `_`
 *   - collapses runs of `_` left behind by sanitisation
 *   - normalises the extension to `ctx.ext` (default `webm`), replacing any
 *     audio extension the template may already carry
 *   - falls back to `recordr_{date}_{time}.<ext>` if template ever yields a
 *     bare extension or empty string
 */
export function formatFileName(
  template: string,
  ctx: { settings: AppSettings; deviceName?: string; counter: number; ext?: string },
): string {
  const ext = (ctx.ext ?? 'webm').replace(/^\./, '').toLowerCase();
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
  const counter = String(ctx.counter).padStart(4, '0');
  const san = (s: string) =>
    (s ?? 'unknown')
      .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_')
      .replace(/\s+/g, '_')
      .slice(0, 80);

  const subs: Record<string, string> = {
    '{date}': date,
    '{time}': time,
    '{year}': String(now.getFullYear()),
    '{month}': pad(now.getMonth() + 1),
    '{day}': pad(now.getDate()),
    '{hour}': pad(now.getHours()),
    '{minute}': pad(now.getMinutes()),
    '{second}': pad(now.getSeconds()),
    '{unix}': String(Math.floor(now.getTime() / 1000)),
    '{mode}': ctx.settings.recordMode,
    '{device}': san(ctx.deviceName ?? 'unknown'),
    '{counter}': counter,
  };

  let out = template;
  for (const [token, value] of Object.entries(subs)) {
    out = out.split(token).join(value);
  }

  // Strip any remaining illegal characters that slipped through (e.g. control
  // codes) then collapse adjacent underscores.
  out = out.replace(/[\u0000-\u001f]+/g, '_').replace(/_+/g, '_');

  // If the resulting name is empty or matches only an extension, substitute.
  const trimmed = out.trim();
  if (!trimmed || /^\.+$/.test(trimmed)) {
    out = `recordr_${date}_${time}`;
  }

  // Normalise the extension: drop any audio extension the template carried, then
  // append the one the caller asked for.
  out = out.replace(/\.(webm|wav|mp3|ogg|opus|m4a|flac)$/i, '');
  out += `.${ext}`;

  // Strip any leading dot or path-separator that would be problematic on
  // any of the supported OSes.
  out = out.replace(/^[._\\/]+/, '');
  return out;
}

export interface SaveOptions {
  folder: string;
  bytes: Uint8Array;
  template: string;
  settings: AppSettings;
  deviceName?: string;
  /** File extension / container to write. Defaults to `webm`. */
  ext?: string;
  /** Optional explicit counter; if omitted we use the in-process counter. */
  counter?: number;
}

export interface SaveResult {
  path: string;
  bytes: number;
  fileName: string;
}

/**
 * Save a buffer of encoded audio bytes to disk with a templated filename.
 * The container is whatever `opts.ext` says (webm / wav / mp3); the caller is
 * responsible for having encoded `opts.bytes` to match.
 */
export async function saveRecordingFile(opts: SaveOptions): Promise<SaveResult> {
  await fs.mkdir(opts.folder, { recursive: true });
  const counter = opts.counter ?? ++saveCounter;
  const fileName = formatFileName(opts.template, {
    settings: opts.settings,
    deviceName: opts.deviceName,
    counter,
    ext: opts.ext,
  });
  const full = path.join(opts.folder, fileName);
  await fs.writeFile(full, opts.bytes);
  return { path: full, bytes: opts.bytes.byteLength, fileName };
}

/**
 * Format leftover bytes into a human-readable size string.
 */
export function humanBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
