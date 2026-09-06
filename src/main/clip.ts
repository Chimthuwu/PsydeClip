import { app } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * Backing store for the dedicated clip-record button.
 *
 * Instead of accumulating the clip's WebM chunks in renderer RAM (as the
 * rolling buffer does for the full session), each MediaRecorder chunk is
 * forwarded here and appended to a temp file as it arrives. At stop the
 * renderer reads the file back once (webm passthrough, or decode→encode for
 * wav/mp3) and then aborts it, so a short sample never sits in memory for
 * longer than the write itself.
 *
 * Only one clip is recorded at a time (the UI enforces this), so a single
 * module-level path is enough. Appends are serialised with a promise chain so
 * back-to-back chunk sends can't interleave inside `fs.appendFile`.
 */

let activeClipPath: string | null = null;
let appendChain: Promise<void> = Promise.resolve();

function clipDir(): string {
  return path.join(app.getPath('temp'), 'recordr-clips');
}

/**
 * Delete any `clip-*.webm.part` files that are no longer owned by a live
 * recording. A crash mid-clip can orphan one (the renderer dies before the
 * abort IPC lands), so this runs at app startup and again whenever a new clip
 * starts. Safe to call any time: only one clip records at a moment, and a new
 * clip's file is created after this has finished clearing the old ones.
 */
export async function pruneAbandonedClips(): Promise<void> {
  try {
    const dir = clipDir();
    const entries = await fs.readdir(dir, { withFileTypes: true });
    await Promise.all(
      entries
        .filter((e) => e.isFile() && /^clip-.*\.webm\.part$/.test(e.name))
        .map((e) => fs.unlink(path.join(dir, e.name)).catch(() => undefined)),
    );

    // Also prune drag snippet temp files
    try {
      const tempDir = app.getPath('temp');
      const tempEntries = await fs.readdir(tempDir, { withFileTypes: true });
      await Promise.all(
        tempEntries
          .filter((e) => e.isFile() && /^recordr_snippet_.*\.(webm|wav|mp3)$/.test(e.name))
          .map((e) => fs.unlink(path.join(tempDir, e.name)).catch(() => undefined)),
      );
    } catch {
      // temp dir error
    }
  } catch {
    // The dir simply not existing is the normal case before the first clip.
  }
}

/** Create the temp file for a new clip. Idempotent per clip. */
export async function startClip(): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    // A previous clip that was never aborted (e.g. the renderer crashed
    // mid-clip) is superseded — clear the dir, not just the pointer.
    await pruneAbandonedClips();
    await fs.mkdir(clipDir(), { recursive: true });
    activeClipPath = null;
    const p = path.join(clipDir(), `clip-${Date.now()}.webm.part`);
    await fs.writeFile(p, new Uint8Array(0));
    activeClipPath = p;
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

/** Append one encoded chunk to the active clip's temp file (in order). */
export async function appendClip(bytes: Uint8Array): Promise<void> {
  const p = activeClipPath;
  if (!p || bytes.byteLength === 0) return;
  appendChain = appendChain.then(() => fs.appendFile(p, bytes)).catch(() => undefined);
  await appendChain;
}

/** Read the whole active clip back (called once, after recording stops). */
export async function readClip(): Promise<Uint8Array | null> {
  // Make sure every chunk submitted so far has hit the disk before reading.
  await appendChain.catch(() => undefined);
  const p = activeClipPath;
  if (!p) return null;
  try {
    const buf = await fs.readFile(p);
    return buf.byteLength > 0 ? new Uint8Array(buf) : null;
  } catch {
    return null;
  }
}

/** Delete the active clip's temp file (after save, or on teardown/abort). */
export async function abortClip(): Promise<void> {
  const p = activeClipPath;
  activeClipPath = null;
  if (!p) return;
  await appendChain.catch(() => undefined);
  try {
    await fs.unlink(p);
  } catch {
    /* already gone */
  }
}