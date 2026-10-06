/**
 * Main-process orchestration for audio -> MIDI transcription.
 *
 * Responsibilities kept here rather than in the worker:
 *  - spawn/reuse the worker thread
 *  - track in-flight jobs so the renderer can show progress and cancel
 *  - derive the `.mid` path from the already-saved audio path
 *
 * Design rules, per the spike findings:
 *  - Transcription NEVER blocks or delays the audio save. The audio file is
 *    written first; the `.mid` appears afterwards. A transcription failure must
 *    never roll back or fail the recording.
 *  - One job at a time per renderer. A 15-minute buffer costs ~20 CPU-minutes
 *    at ~0.7x realtime, so queueing more would be worse than refusing.
 */

import path from 'node:path';
import { Worker } from 'node:worker_threads';
import type { TranscribeJobState } from '../../shared/types';
import type { WorkerRequest, WorkerResponse } from './worker';

export type { TranscribeJobState };

export interface StartJobInput {
  jobId: string;
  samples: Float32Array;
  sampleRate: number;
  /** Full path of the audio file already written to disk. */
  audioPath: string;
  /**
   * Notes-only job: no `.mid` is written and `audioPath` may be empty. Used by
   * the piano-roll lane, which transcribes a *selection* out of the rolling
   * buffer — there is no saved audio file for a `.mid` to sit beside, and the
   * note list is the whole point (todo.md §MIDI-1 Phase A).
   */
  notesOnly?: boolean;
  thresholds?: { onset: number; frame: number; minimumNoteLength: number };
}

/**
 * The vendored model ships inside @spotify/basic-pitch. In a packaged build
 * node_modules is unpacked into app.asar, which is readable — but resolve via
 * require.resolve so it keeps working if the layout changes.
 */
function modelDir(): string {
  return path.join(path.dirname(require.resolve('@spotify/basic-pitch/package.json')), 'model');
}

export function midiPathFor(audioPath: string): string {
  const dir = path.dirname(audioPath);
  const stem = path.basename(audioPath, path.extname(audioPath));
  return path.join(dir, `${stem}.mid`);
}

const jobs = new Map<string, TranscribeJobState>();
/**
 * Per-job cancel flags in shared memory.
 *
 * A `postMessage` cancel does NOT work here: the worker is inside a synchronous
 * tfjs inference call for the whole job, so its event loop never drains and the
 * cancel message sits unread until the job is already finished. Measured: cancel
 * returned true, the job then ran to completion 49.5 s later and wrote its
 * `.mid` anyway.
 *
 * A SharedArrayBuffer is the fix — Atomics on it are visible to the worker
 * immediately, with no message, no event loop, and no thread affinity.
 */
const CANCEL_SLOTS = 8;
const cancelFlags = new Int32Array(new SharedArrayBuffer(CANCEL_SLOTS * 4));
/** jobId -> its cancelFlags slot. Kept beside `jobs` so the shared state type
 *  (which crosses IPC) stays free of main-process bookkeeping. */
const jobSlots = new Map<string, number>();
let nextSlot = 0;

function takeSlot(jobId: string): number {
  // Reuse a slot whose previous holder has settled.
  const existing = jobSlots.get(jobId);
  if (existing !== undefined) return existing;
  let slot = nextSlot;
  for (let i = 0; i < CANCEL_SLOTS; i++) {
    if (Atomics.load(cancelFlags, i) === 0 && !slotInUse(i)) {
      slot = i;
      break;
    }
  }
  Atomics.store(cancelFlags, slot, 0);
  jobSlots.set(jobId, slot);
  return slot;
}

function slotInUse(slot: number): boolean {
  for (const j of jobs.values()) {
    if (j.status === 'running' && jobSlots.get(j.jobId) === slot) return true;
  }
  return false;
}

function releaseSlot(jobId: string): void {
  const slot = jobSlots.get(jobId);
  if (slot === undefined) return;
  Atomics.store(cancelFlags, slot, 0);
  jobSlots.delete(jobId);
}

let worker: Worker | null = null;
/** Serialises message delivery so job bookkeeping stays ordered. */
let queue: Promise<unknown> = Promise.resolve();

function post(msg: WorkerRequest, transfer?: unknown[]) {
  queue = queue.then(() => worker!.postMessage(msg, (transfer ?? []) as any));
  return queue;
}

function ensureWorker(): Worker {
  if (worker) return worker;
  // In dev this file is dist/main/transcribe/pool.js; in a packaged build it is
  // inside app.asar, which worker_threads can load directly.
  const workerPath = path.join(__dirname, 'worker.js');
  worker = new Worker(workerPath);
  worker.on('message', (msg: WorkerResponse) => {
    const job = jobs.get(msg.id);
    if (!job) return;
    switch (msg.type) {
      case 'progress':
        job.fraction = msg.fraction;
        break;
      case 'done':
        job.status = 'done';
        job.fraction = 1;
        job.noteCount = msg.noteCount;
        job.notes = msg.notes;
        job.elapsedMs = msg.elapsedMs;
        job.ratio = msg.ratio;
        releaseSlot(msg.id);
        break;
      case 'cancelled':
        job.status = 'cancelled';
        releaseSlot(msg.id);
        break;
      case 'error':
        job.status = 'error';
        job.error = msg.message;
        releaseSlot(msg.id);
        break;
    }
  });
  worker.on('error', (err) => {
    // A worker-level crash must not leave jobs stuck at 'running' forever.
    for (const job of jobs.values()) {
      if (job.status === 'running') {
        job.status = 'error';
        job.error = err.message;
      }
    }
  });
  worker.unref();
  return worker;
}

/**
 * Queue a transcription. Returns the initial state; progress arrives via the
 * `transcribe:progress` event.
 */
export function startTranscription(input: StartJobInput): TranscribeJobState {
  const state: TranscribeJobState = {
    jobId: input.jobId,
    audioPath: input.audioPath,
    // '' means "no file" — the worker skips the write when outPath is empty.
    midiPath: input.notesOnly ? '' : midiPathFor(input.audioPath),
    status: 'running',
    fraction: 0,
  };
  jobs.set(input.jobId, state);

  ensureWorker();
  const slot = takeSlot(input.jobId);
  // Copy out of the renderer's buffer into a standalone ArrayBuffer: the
  // structured-clone over IPC does not guarantee a non-pooled backing store,
  // and engine.ts trap 3 is specifically about pooled buffers.
  const copy = new Float32Array(input.samples.length);
  copy.set(input.samples);

  void post(
    {
      type: 'transcribe',
      id: input.jobId,
      samples: copy,
      sampleRate: input.sampleRate,
      modelDir: modelDir(),
      outPath: state.midiPath,
      thresholds: input.thresholds,
      cancelFlags,
      cancelSlot: slot,
    },
    [copy.buffer],
  );
  return state;
}

/** Ask a running job to stop. Resolves false if it isn't running. */
export function cancelTranscription(jobId: string): boolean {
  const job = jobs.get(jobId);
  if (!job || job.status !== 'running') return false;
  const slot = jobSlots.get(jobId);
  if (slot === undefined) return false;
  // Set the shared flag rather than messaging the worker: it is mid-inference
  // and will not read its event queue until the job is already over.
  Atomics.store(cancelFlags, slot, 1);
  return true;
}

export function jobState(jobId: string): TranscribeJobState | null {
  return jobs.get(jobId) ?? null;
}

/** Any still-running job — used to avoid stacking jobs on a busy machine. */
export function hasRunningJob(): boolean {
  for (const job of jobs.values()) if (job.status === 'running') return true;
  return false;
}

/** Drop finished job records so the map cannot grow without bound. */
export function pruneJobs(keep = 20): void {
  const finished = [...jobs.values()]
    .filter((j) => j.status !== 'running')
    .sort((a, b) => (a.elapsedMs ?? 0) - (b.elapsedMs ?? 0));
  while (jobs.size > keep && finished.length) {
    const victim = finished.shift()!;
    jobs.delete(victim.jobId);
  }
}

/** Test seam: tear down the worker. */
export function shutdown(): void {
  void worker?.terminate();
  worker = null;
  jobs.clear();
}