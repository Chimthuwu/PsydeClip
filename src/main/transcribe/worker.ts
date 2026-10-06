/**
 * Transcription worker.
 *
 * Runs in a `worker_threads` worker so Basic Pitch inference (~0.7x realtime on
 * the pure-JS CPU backend) never blocks the main or renderer thread. Measured:
 * 9.6 s of audio took 14.6 s of wall clock in-process, and on the spike's
 * in-browser control run CPU inference starved a UI-thread evaluate for >5 s.
 * That is the entire reason this file exists.
 *
 * Protocol (parent -> worker):
 *   { type: 'transcribe', id, samples (transferred ArrayBuffer),
 *     sampleRate, modelDir, outPath, thresholds? }
 *   { type: 'cancel', id }
 *
 * Worker -> parent:
 *   { type: 'progress', id, fraction }
 *   { type: 'done', id, noteCount, elapsedMs, ratio, outPath }
 *   { type: 'cancelled', id }
 *   { type: 'error', id, message }
 */

import fs from 'node:fs';
import type { TranscribedNote } from '../../shared/types';
import { parentPort, workerData } from 'node:worker_threads';
import {
  CancelledError,
  MODEL_SR,
  notesToMidiBytes,
  resampleToModelRate,
  toTranscribedNotes,
  transcribe,
  type Thresholds,
} from './engine';

export interface TranscribeRequest {
  type: 'transcribe';
  id: string;
  /** Mono PCM. Transferred, so this worker takes ownership of the buffer. */
  samples: Float32Array;
  sampleRate: number;
  modelDir: string;
  outPath: string;
  thresholds?: Thresholds;
  /**
   * Shared cancel flags owned by the pool, plus this job's slot.
   *
   * Cancellation CANNOT travel over postMessage: the whole job is one
   * synchronous inference call, so this worker's event loop never runs until
   * the job has already finished and a cancel message would arrive too late to
   * matter. Reading an Atomics-backed flag works mid-inference because it does
   * not need the event loop at all.
   */
  cancelFlags?: Int32Array;
  cancelSlot?: number;
}

export type WorkerRequest = TranscribeRequest | { type: 'cancel'; id: string };

export type WorkerResponse =
  | { type: 'progress'; id: string; fraction: number }
  | {
      type: 'done';
      id: string;
      noteCount: number;
      notes: TranscribedNote[];
      elapsedMs: number;
      ratio: number;
      outPath: string;
    }
  | { type: 'cancelled'; id: string }
  | { type: 'error'; id: string; message: string };

/** Ids cancelled by message — only reachable between jobs, see run(). */
const cancelled = new Set<string>();

function post(msg: WorkerResponse, transfer?: unknown[]) {
  parentPort!.postMessage(msg, (transfer ?? []) as any);
}

parentPort!.on('message', (req: WorkerRequest) => {
  if (req.type === 'cancel') {
    cancelled.add(req.id);
    return;
  }
  void run(req);
});

/** True if the pool has flagged this job for cancellation. */
function isFlagged(req: TranscribeRequest): boolean {
  if (cancelled.has(req.id)) return true;
  if (req.cancelFlags && req.cancelSlot !== undefined) {
    return Atomics.load(req.cancelFlags, req.cancelSlot) === 1;
  }
  return false;
}

async function run(req: TranscribeRequest): Promise<void> {
  const { id } = req;
  try {
    if (isFlagged(req)) {
      cancelled.delete(id);
      post({ type: 'cancelled', id });
      return;
    }

    // Trap 1 from engine.ts: the model only accepts 22050 Hz, and passing it a
    // different rate silently produces doubled timestamps. Normalise here so no
    // caller can get that wrong.
    const samples = resampleToModelRate(req.samples, req.sampleRate);

    const res = await transcribe(samples, {
      modelDir: req.modelDir,
      thresholds: req.thresholds,
      onProgress: (fraction) => post({ type: 'progress', id, fraction }),
      isCancelled: () => isFlagged(req),
    });

    // Re-check after inference: the flag may have been raised in the last window,
    // and a cancelled job must not leave a .mid behind.
    if (isFlagged(req)) {
      cancelled.delete(id);
      post({ type: 'cancelled', id });
      return;
    }

    // Write the .mid beside the audio file the caller already saved. The audio
    // is never touched: if this fails, the recording is still intact.
    const bytes = notesToMidiBytes(res.notes);
    await fs.promises.writeFile(req.outPath, bytes);

    post({
      type: 'done',
      id,
      noteCount: res.notes.length,
      notes: toTranscribedNotes(res.notes),
      elapsedMs: res.elapsedMs,
      ratio: res.ratio,
      outPath: req.outPath,
    });
  } catch (err) {
    if (err instanceof CancelledError || isFlagged(req)) {
      cancelled.delete(id);
      post({ type: 'cancelled', id });
      return;
    }
    post({ type: 'error', id, message: (err as Error).message ?? String(err) });
  }
}

// The default model dir is baked in at spawn time so the common case needs no
// message field; an explicit modelDir on the request still wins.
void workerData;
export { MODEL_SR };