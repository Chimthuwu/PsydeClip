/**
 * The filename-template engine, shared by every target.
 *
 * It lives in `shared/` rather than in `main/save.ts` because the browser /
 * Capacitor target needs exactly the same naming rules and must not drag
 * `node:fs` into a renderer bundle (todo.md §7, the Android item). Pure: no
 * imports beyond the settings shape, no I/O, and the only clock is `new Date()`.
 */
import { AppSettings } from './types';

/**
 * Monotonic counter so repeated saves within the same second can still
 * produce distinct filenames via {counter}.
 */
let saveCounter = 0;

/** Next value for `{counter}`. One process-wide sequence, as before. */
export function nextSaveCounter(): number {
  return ++saveCounter;
}

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
