/**
 * Cheap live pitch tracking for the MIDI grid, for the seconds a recording is
 * actually in progress (todo.md §MIDI-1 Phase B).
 *
 * Why a second engine at all: Basic Pitch is the accurate, polyphonic one, but
 * it runs at ~0.5x realtime on this box — slower than the music — so it can only
 * ever annotate audio that already exists. This runs at realtime on the live
 * analyser window and costs about a millisecond per frame, and ONLY while a
 * recording is running, which is what keeps it off the idle CPU budget.
 *
 * YIN (de Cheveigné & Kawahara 2002), steps 1-5: difference function,
 * cumulative mean normalised difference, absolute threshold, parabolic
 * interpolation. Monophonic by construction — it reports one f0 per frame, so
 * during a capture you see the lead/vocal/bass note. Chords show one of their
 * notes until Basic Pitch's real multi-note result replaces them on save.
 *
 * Pure and DOM-free so it is unit-testable in node: the analyser window is
 * handed in, nothing here touches Web Audio.
 */

import type { TranscribedNote } from '../../shared/types';

/** YIN's tuning constants. `window` is the integration length, `maxLag` the
 *  longest period searched. Together they must fit inside the caller's frame;
 *  `detectPitch` shrinks them to fit rather than failing. */
export interface YinOptions {
  /** Samples summed per lag in the difference function. */
  window: number;
  /** Largest lag (in samples) searched — sets the lowest detectable pitch. */
  maxLag: number;
  /** Absolute threshold on the normalised difference. Lower = stricter. */
  threshold: number;
}

export const DEFAULT_YIN: YinOptions = { window: 1024, maxLag: 800, threshold: 0.15 };

/**
 * Frame RMS below which a frame is treated as silence. YIN will happily return
 * a confident-looking pitch for a frame of noise or a decaying room tone, and a
 * grid full of invented notes is worse than an empty one. Also the main reason
 * this is cheap in practice: most of the time the gate returns before any of
 * the O(window x maxLag) work happens.
 */
export const SILENCE_RMS = 0.006;

/** Pitch range reported, in MIDI numbers. ~55 Hz to ~2093 Hz. */
export const MIN_MIDI = 33;
export const MAX_MIDI = 96;

/** One frame's result: the frequency, and how periodic the frame looked. */
export interface PitchEstimate {
  hz: number;
  /** Normalised-difference value at the chosen lag. Lower is cleaner. */
  clarity: number;
}

/**
 * Remove DC offset and copy the leading `out.length` samples of `frame` into
 * `out`, returning the frame's RMS (0 for a short/absent frame).
 *
 * The DC block matters more than it looks: a capture device or loopback tap can
 * sit well off zero, and YIN's difference function is dominated by a constant
 * offset — the note comes out an octave or a fifth wrong.
 */
export function prepareFrame(frame: Float32Array, out: Float32Array): number {
  const n = Math.min(frame.length, out.length);
  if (n <= 0) return 0;
  let mean = 0;
  for (let i = 0; i < n; i++) mean += frame[i];
  mean /= n;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const v = frame[i] - mean;
    out[i] = v;
    sum += v * v;
  }
  return Math.sqrt(sum / n);
}

/**
 * YIN f0 estimate for a DC-free window, or null when the frame is too short /
 * too quiet / has no lag that clears the threshold.
 *
 * `diff` is caller-owned scratch of `maxLag + 1` entries — this runs every frame
 * while recording, so it must not allocate.
 */
export function detectPitch(
  x: Float32Array,
  sampleRate: number,
  diff: Float32Array,
  opts: YinOptions = DEFAULT_YIN,
): PitchEstimate | null {
  if (!(sampleRate > 0) || x.length < 64 || diff.length < 8) return null;

  // Fit the constants to the frame we actually got. A high sample rate (96 kHz)
  // can leave the requested window+maxLag longer than the analyser window, and
  // returning null forever would read as "the tracker is broken".
  const maxLag = Math.min(opts.maxLag, Math.floor(x.length / 2) - 1, diff.length - 2);
  const window = Math.min(opts.window, x.length - maxLag);
  if (maxLag < 8 || window < 32) return null;

  // Step 1+2: difference function, then cumulative mean normalised difference.
  for (let tau = 1; tau <= maxLag; tau++) {
    let sum = 0;
    for (let j = 0; j < window; j++) {
      const d = x[j] - x[j + tau];
      sum += d * d;
    }
    diff[tau] = sum;
  }
  diff[0] = 1;
  let running = 0;
  for (let tau = 1; tau <= maxLag; tau++) {
    running += diff[tau];
    diff[tau] = running > 0 ? (diff[tau] * tau) / running : 1;
  }

  // Only lags inside the pitch range we are willing to report.
  const minLag = Math.max(2, Math.floor(sampleRate / 2200));
  const maxUsefulLag = Math.min(maxLag, Math.floor(sampleRate / 55));

  // Step 3: first local minimum under the threshold; fall back to the global
  // minimum only if it is clear enough to be a real periodicity.
  let best = -1;
  for (let tau = minLag; tau <= maxUsefulLag; tau++) {
    if (diff[tau] < opts.threshold && diff[tau] <= diff[tau + 1] && diff[tau] <= diff[tau - 1]) {
      best = tau;
      break;
    }
  }
  if (best === -1) {
    let lowest = Infinity;
    for (let tau = minLag; tau <= maxUsefulLag; tau++) {
      if (diff[tau] < lowest) {
        lowest = diff[tau];
        best = tau;
      }
    }
    if (!(lowest < 0.5)) return null;
  }

  // Step 4: parabolic interpolation around the chosen lag for sub-sample
  // precision — without it every note quantises to the nearest lag and a rising
  // melody draws as a staircase.
  const y0 = diff[best - 1];
  const y1 = diff[best];
  const y2 = diff[best + 1];
  const denom = 2 * (2 * y1 - y2 - y0);
  const shift = denom !== 0 ? (y2 - y0) / denom : 0;
  const refined = best + (Number.isFinite(shift) ? Math.max(-1, Math.min(1, shift)) : 0);

  const hz = sampleRate / refined;
  if (!(hz > 0) || !Number.isFinite(hz)) return null;
  return { hz, clarity: y1 };
}

/** Nearest MIDI note to a frequency, or null when out of the reportable range. */
export function hzToMidi(hz: number): number | null {
  const midi = Math.round(12 * Math.log2(hz / 440) + 69);
  return midi >= MIN_MIDI && midi <= MAX_MIDI ? midi : null;
}

export interface LiveNoteTrackerOptions {
  sampleRate: number;
  /** A jump larger than this many semitones starts a new note. Default 0.75. */
  semitoneTolerance?: number;
  /** Silence longer than this closes the open note. Default 0.12 s. */
  noteGapSec?: number;
  /** Notes shorter than this are dropped as detection noise. Default 0.05 s. */
  minNoteSec?: number;
  /** Retained-note cap; the oldest is dropped past it. Default 2000. */
  maxNotes?: number;
  yin?: YinOptions;
}

/**
 * Turns a stream of pitch frames into a note list on the absolute session
 * clock, so a live bar sits on the History waveform's time axis exactly like a
 * transcribed one does.
 *
 * `notes` is deliberately MUTABLE and in a stable object: the board's rAF loop
 * reads it directly, so tracking a live melody costs zero React renders. A
 * state array updated at 20 Hz would re-render the whole app on every frame and
 * cost far more CPU than the tracking does.
 *
 * Live notes are kept strictly separate from a transcribed `NoteLayer`, and
 * never go through the `.mid` export — a YIN estimate is a preview, and
 * shipping one into a file the user opens in a DAW would be a lie.
 */
export class LiveNoteTracker {
  readonly notes: TranscribedNote[] = [];

  private readonly sampleRate: number;
  private readonly yin: YinOptions;
  private readonly semitoneTolerance: number;
  private readonly noteGapSec: number;
  private readonly minNoteSec: number;
  private readonly maxNotes: number;

  private x: Float32Array;
  private diff: Float32Array;
  /** Currently open note, if any. */
  private openMidi: number | null = null;
  private openStartSec = 0;
  private lastVoicedSec = -1;
  private lastPushedSec = 0;

  constructor(opts: LiveNoteTrackerOptions) {
    this.sampleRate = opts.sampleRate;
    this.yin = opts.yin ?? DEFAULT_YIN;
    this.semitoneTolerance = opts.semitoneTolerance ?? 0.75;
    this.noteGapSec = opts.noteGapSec ?? 0.12;
    this.minNoteSec = opts.minNoteSec ?? 0.05;
    this.maxNotes = opts.maxNotes ?? 2000;
    this.x = new Float32Array(Math.max(64, this.yin.window + this.yin.maxLag));
    this.diff = new Float32Array(this.yin.maxLag + 2);
  }

  /** Notes detected so far. Live view; the array grows while recording. */
  get noteCount(): number {
    return this.notes.length;
  }

  /** True while a detected note is still sounding. */
  get hasOpenNote(): boolean {
    return this.openMidi !== null;
  }

  /** Session second of the most recent frame fed in. */
  get lastSec(): number {
    return this.lastPushedSec;
  }

  /**
   * Feed one analyser window. `atSec` is the absolute session second of the
   * window's leading edge — the board and the History lane share that axis, so
   * this is what makes a live bar sit over its own audio.
   */
  push(frame: Float32Array, atSec: number): void {
    this.lastPushedSec = atSec;

    // Close a note that fell silent, before considering the new frame.
    if (this.openMidi !== null && atSec - this.lastVoicedSec > this.noteGapSec) {
      this.close(atSec);
    }

    const rms = prepareFrame(frame, this.x);
    if (rms < SILENCE_RMS) return;

    const est = detectPitch(this.x, this.sampleRate, this.diff, this.yin);
    if (!est) return;
    const midi = hzToMidi(est.hz);
    if (midi === null) return;

    this.lastVoicedSec = atSec;

    if (this.openMidi === null) {
      this.openMidi = midi;
      this.openStartSec = atSec;
      return;
    }
    // A glissando or a vibrato's neighbouring bin still counts as the same note;
    // only a clear jump starts a new one.
    const cents = Math.abs(midi - this.openMidi) * 100;
    if (cents > this.semitoneTolerance * 100) {
      this.close(atSec);
      this.openMidi = midi;
      this.openStartSec = atSec;
    }
  }

  /** Close any open note as ending at `atSec` — call when recording stops. */
  finish(atSec: number): void {
    if (this.openMidi !== null) this.close(atSec);
  }

  /** Drop everything, including any open note. A new recording starts here. */
  reset(): void {
    this.notes.length = 0;
    this.openMidi = null;
    this.openStartSec = 0;
    this.lastVoicedSec = -1;
    this.lastPushedSec = 0;
  }

  private close(atSec: number): void {
    const pitch = this.openMidi;
    this.openMidi = null;
    if (pitch === null) return;
    const durationSec = atSec - this.openStartSec;
    if (durationSec < this.minNoteSec) return;
    this.notes.push({ pitch, startSec: this.openStartSec, durationSec, velocity: 0.8 });
    while (this.notes.length > this.maxNotes) this.notes.shift();
  }
}