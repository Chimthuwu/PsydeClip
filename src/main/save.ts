import fs from 'node:fs/promises';
import path from 'node:path';
import { AppSettings } from '../shared/types';
import { formatFileName, nextSaveCounter } from '../shared/file-name';

// The template engine lives in `shared/` so the browser/Capacitor target can
// use the same naming rules without pulling `node:fs` into a renderer bundle.
// Re-exported here for callers that already reach for it from this module.
export { formatFileName, resetSaveCounter } from '../shared/file-name';


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
  const counter = opts.counter ?? nextSaveCounter();
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
