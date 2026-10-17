/**
 * Audio -> MIDI transcription, engine side.
 *
 * Runs Basic Pitch (Spotify, Apache-2.0) on the pure-JS TensorFlow backend.
 * Deliberately NOT `@tensorflow/tfjs-node` — it fails `node-pre-gyp` on modern
 * Node and would need an Electron ABI rebuild, changing packaging, signing and
 * cold start. See spikes/001-basic-pitch-in-node/ for the feasibility writeup
 * and spikes/002-tfjs-backend-bench/ for why the `webgl` backend is not used
 * either (slower than `cpu` here, and its timings are not trustworthy).
 *
 * Three traps documented by spike 001, all of which either fail silently or
 * throw a misleading error. All are handled here:
 *
 *  1. `evaluateModel` only validates the sample rate on its `AudioBuffer` path.
 *     Handed a raw `Float32Array` it assumes 22050 Hz unconditionally — feeding
 *     it 44100 Hz doubles every timestamp and the output still looks plausible.
 *     So callers MUST resample to MODEL_SR first; see resampleToModelRate().
 *  2. tfjs cannot `fetch` a `file://` model in Node (undici has no file: scheme)
 *     and Chromium blocks it too, so a hand-rolled IOHandler is required.
 *  3. `weightData` must be a real `ArrayBuffer`. A Node `Buffer` is a view onto
 *     a pooled ArrayBuffer and tfjs copies element-wise, so weight decoding
 *     throws the misleading `shape [1] should have 1 values but has 4`.
 */

import fs from 'node:fs';
import type { TranscribedNote } from '../../shared/types';
import path from 'node:path';
import { Midi } from '@tonejs/midi';
import {
  BasicPitch,
  addPitchBendsToNoteEvents,
  noteFramesToTime,
  outputToNotesPoly,
} from '@spotify/basic-pitch';
import * as tf from '@tensorflow/tfjs';

/** Basic Pitch's model input rate. Not negotiable — see trap 1. */
export const MODEL_SR = 22050;

/**
 * Detection thresholds, applied via outputToNotesPoly().
 *
 * Basic Pitch's own defaults (0.25 / 0.25 / 5) produced 46 notes for 24 real
 * ones on the spike's reference signal — octave ghosts and harmonic duplicates.
 * 0.5 / 0.5 / 11 gave 22 against 24 real. These are the spike's best values and
 * are deliberately stricter than the library defaults; they still want a pass
 * against real music before being treated as final.
 */
export const DEFAULT_THRESHOLDS = {
  onset: 0.5,
  frame: 0.5,
  /** In frames. ~11 * (512 / 22050) ~= 0.26 s. */
  minimumNoteLength: 11,
};

export type Thresholds = { onset: number; frame: number; minimumNoteLength: number };

/** Reports whether cancellation was requested; polled between windows. */
export type CancelFn = () => boolean;

/** Thrown when a transcription is cancelled. */
export class CancelledError extends Error {
  constructor() {
    super('Transcription cancelled');
    this.name = 'CancelledError';
  }
}

/** The note-event shape produced by noteFramesToTime(). */
export type NoteEvent = ReturnType<typeof noteFramesToTime>[number];

export interface TranscribeResult {
  notes: NoteEvent[];
  /** Wall-clock ms spent in inference (includes model load on first run). */
  elapsedMs: number;
  /** Realtime multiple: audio seconds per second of inference. */
  ratio: number;
  /** Sample rate of the submitted samples (always MODEL_SR). */
  sampleRate: number;
}

/**
 * tfjs IOHandler that reads the model off disk.
 * Required because tfjs cannot fetch a file:// URL — see trap 2.
 *
 * Returns a single ModelArtifacts object rather than implementing the
 * loadWeights()/loadTopology() pair, because the weight shards have to be
 * concatenated into ONE contiguous ArrayBuffer to match the flattened
 * weightSpecs ordering (trap 3).
 */
function fileSystemHandler(dir: string): tf.io.IOHandler {
  return {
    load: async () => {
      const json = JSON.parse(fs.readFileSync(path.join(dir, 'model.json'), 'utf8')) as tf.io.ModelJSON;

      const specs: tf.io.WeightsManifestEntry[] = [];
      const datas: Uint8Array[] = [];
      for (const group of json.weightsManifest ?? []) {
        for (const p of group.paths ?? []) {
          const buf = fs.readFileSync(path.join(dir, p));
          datas.push(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));
        }
        specs.push(...(group.weights ?? []));
      }
      let total = 0;
      for (const d of datas) total += d.byteLength;
      const weightData = new Uint8Array(total);
      let off = 0;
      for (const d of datas) {
        weightData.set(d, off);
        off += d.byteLength;
      }

      return {
        modelTopology: json.modelTopology,
        // Do NOT blindly add a `quantization` key: tfjs tests
        // `'quantization' in spec`, so an explicit undefined matches and then
        // dereferences undefined.dtype.
        weightSpecs: specs.map((s) =>
          (s as { quantization?: unknown }).quantization
            ? s
            : { name: s.name, shape: s.shape, dtype: s.dtype },
        ),
        // MUST be a real ArrayBuffer — see trap 3 in the file header.
        weightData: weightData.buffer,
        format: json.format,
        generatedBy: json.generatedBy,
        convertedBy: json.convertedBy,
        signature: json.signature,
      } as tf.io.ModelArtifacts;
    },
  };
}

let modelPromise: Promise<tf.GraphModel> | null = null;

/** Lazily load the vendored 900 KB model. Cached for the process lifetime. */
export function loadModel(modelDir: string): Promise<tf.GraphModel> {
  if (modelPromise) return modelPromise;
  modelPromise = tf.loadGraphModel(fileSystemHandler(modelDir)).catch((err) => {
    // Never cache a rejected promise — a later attempt must be able to retry.
    modelPromise = null;
    throw err;
  });
  return modelPromise;
}

/** Test seam: drop the cached model. */
export function resetModelCache(): void {
  modelPromise = null;
}

/**
 * Pin the pure-JS backend. tfjs would otherwise probe and could land on `webgl`
 * in a Chromium context, which spike 002 measured as slower and unreliable.
 * Must run before the model is first built.
 */
export async function initBackend(): Promise<string> {
  await tf.setBackend('cpu');
  await tf.ready();
  return tf.getBackend();
}

/** Linear-interpolation resampler to Basic Pitch's model rate. */
export function resampleToModelRate(input: Float32Array, fromRate: number): Float32Array {
  if (fromRate === MODEL_SR) return input;
  const ratio = fromRate / MODEL_SR;
  const outLen = Math.max(1, Math.floor(input.length / ratio));
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const pos = i * ratio;
    const i0 = Math.floor(pos);
    const i1 = Math.min(i0 + 1, input.length - 1);
    const frac = pos - i0;
    out[i] = input[i0] * (1 - frac) + input[i1] * frac;
  }
  return out;
}

/**
 * Transcribe mono float samples (ALREADY at MODEL_SR — see trap 1) to notes.
 *
 * @param opts.modelDir    Directory holding model.json + weight shards.
 * @param opts.thresholds  Detection thresholds; defaults to DEFAULT_THRESHOLDS.
 * @param opts.onProgress  Called with 0..1 as windows are evaluated.
 * @param opts.isCancelled Polled between windows; throws CancelledError.
 */
export async function transcribe(
  samples: Float32Array,
  opts: {
    modelDir: string;
    thresholds?: Thresholds;
    onProgress?: (fraction: number) => void;
    isCancelled?: CancelFn;
  },
): Promise<TranscribeResult> {
  const { modelDir, onProgress, isCancelled } = opts;
  const th = opts.thresholds ?? DEFAULT_THRESHOLDS;

  if (!(samples instanceof Float32Array)) {
    throw new TypeError('transcribe() expects a Float32Array at 22050 Hz');
  }

  const started = Date.now();
  await initBackend();
  // BasicPitch's constructor takes `string | Promise<tf.GraphModel>` — it must
  // be handed the promise, not the resolved model.
  const basicPitch = new BasicPitch(loadModel(modelDir));

  const frames: number[][] = [];
  const onsets: number[][] = [];
  const contours: number[][] = [];

  // Note the 3-arg signature: thresholds are NOT passed here — they are applied
  // afterwards by outputToNotesPoly(), which is what lets us tune them.
  await basicPitch.evaluateModel(
    samples,
    (f, o, c) => {
      frames.push(...f);
      onsets.push(...o);
      contours.push(...c);
    },
    (p) => {
      onProgress?.(p);
      // Polled here because this is the only per-window callback we control.
      if (isCancelled?.()) throw new CancelledError();
    },
  );

  const notes = noteFramesToTime(
    addPitchBendsToNoteEvents(
      contours,
      outputToNotesPoly(frames, onsets, th.onset, th.frame, th.minimumNoteLength),
    ),
  );

  const elapsedMs = Date.now() - started;
  onProgress?.(1);
  return {
    notes,
    elapsedMs,
    ratio: samples.length / MODEL_SR / (elapsedMs / 1000),
    sampleRate: MODEL_SR,
  };
}

/** Plain note list (seconds, velocity 0..1) for the renderer's piano roll. */
export function toTranscribedNotes(notes: NoteEvent[]): TranscribedNote[] {
  return notes.map((n) => ({
    pitch: n.pitchMidi,
    startSec: n.startTimeSeconds,
    durationSec: n.durationSeconds,
    velocity: Math.max(0, Math.min(1, n.amplitude ?? 1)),
  }));
}

/** Serialise note events to a Standard MIDI File at `bpm`. */
export function notesToMidiBytes(notes: NoteEvent[], bpm = 120): Uint8Array {
  const midi = new Midi();
  midi.header.setTempo(bpm);
  const track = midi.addTrack();
  track.channel = 0;
  for (const n of notes) {
    track.addNote({
      midi: n.pitchMidi,
      time: n.startTimeSeconds,
      duration: n.durationSeconds,
      // @tonejs/midi takes velocity as 0..1 and scales it to 0..127 itself.
      velocity: Math.max(1 / 127, Math.min(1, n.amplitude ?? 1)),
    });
  }
  return new Uint8Array(midi.toArray());
}