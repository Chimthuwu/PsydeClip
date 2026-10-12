/**
 * Format a number of bytes into a human-readable size string.
 * Shared between main (when crafting toasts) and renderer (HUD).
 */
export function humanBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

/** Format seconds as M:SS. */
export function mmss(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/** Format seconds as M:SS.d (tenths) — for the live clip-recording timer. */
export function mmssTenths(seconds: number): string {
  const clamped = Math.max(0, seconds);
  const m = Math.floor(clamped / 60);
  const s = Math.floor(clamped % 60);
  const d = Math.floor((clamped * 10) % 10);
  return `${m}:${s.toString().padStart(2, '0')}.${d}`;
}

/**
 * Shown when the record button is pressed while a clip is recording. OK keeps
 * & saves the clip (temp file moves to the save folder); Cancel discards it
 * (temp file is deleted). Used by both windows that can stop a clip — the main
 * HUD and the pop-out's transport — so the wording stays in one place.
 */
export const CLIP_STOP_PROMPT =
  'Stop recording this clip?\n\n  OK — save it\n  Cancel — discard it.';
