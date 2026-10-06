/**
 * Pure layout for the MIDI piano-roll lane (todo.md §MIDI-1, Phase A).
 *
 * No DOM / canvas here so it can be unit-tested in node: given a note list and
 * a time window it returns pixel rects. The canvas lane just fills them.
 */

import type { TranscribedNote } from './types';

export interface PianoRollRect {
  x: number;
  y: number;
  w: number;
  h: number;
  pitch: number;
  /** 0..1 — drives fill alpha. */
  velocity: number;
}

export interface PianoRollLayout {
  rects: PianoRollRect[];
  /** Inclusive MIDI pitch range the lanes cover (auto-fit to the visible notes). */
  lowPitch: number;
  highPitch: number;
  /** Height of one semitone lane in px. */
  laneHeight: number;
}

export interface PianoRollOptions {
  startSec: number;
  endSec: number;
  width: number;
  height: number;
  /** Semitones of padding above/below the notes present. Default 2. */
  pad?: number;
  /** Narrowest bar drawn, so very short notes stay visible. Default 1 px. */
  minWidth?: number;
}

/** Notes overlapping [startSec, endSec], skipping malformed entries. */
export function visibleNotes(
  notes: readonly TranscribedNote[],
  startSec: number,
  endSec: number,
): TranscribedNote[] {
  return notes.filter(
    (n) =>
      Number.isFinite(n.pitch) &&
      Number.isFinite(n.startSec) &&
      Number.isFinite(n.durationSec) &&
      n.durationSec > 0 &&
      n.startSec < endSec &&
      n.startSec + n.durationSec > startSec,
  );
}

export function layoutPianoRoll(
  notes: readonly TranscribedNote[],
  opts: PianoRollOptions,
): PianoRollLayout {
  const { startSec, endSec, width, height } = opts;
  const pad = opts.pad ?? 2;
  const minWidth = opts.minWidth ?? 1;
  const empty: PianoRollLayout = { rects: [], lowPitch: 60, highPitch: 72, laneHeight: 0 };
  const span = endSec - startSec;
  if (!(span > 0) || !(width > 0) || !(height > 0)) return empty;

  const vis = visibleNotes(notes, startSec, endSec);
  if (!vis.length) return empty;

  let lo = Infinity;
  let hi = -Infinity;
  for (const n of vis) {
    if (n.pitch < lo) lo = n.pitch;
    if (n.pitch > hi) hi = n.pitch;
  }
  const lowPitch = Math.max(0, Math.floor(lo) - pad);
  const highPitch = Math.min(127, Math.ceil(hi) + pad);
  const lanes = highPitch - lowPitch + 1;
  const laneHeight = height / lanes;
  const pxPerSec = width / span;

  const rects: PianoRollRect[] = vis.map((n) => {
    const x0 = Math.max(0, (n.startSec - startSec) * pxPerSec);
    const x1 = Math.min(width, (n.startSec + n.durationSec - startSec) * pxPerSec);
    const row = highPitch - Math.round(n.pitch); // top lane = highest pitch
    return {
      x: x0,
      y: row * laneHeight,
      w: Math.max(minWidth, x1 - x0),
      h: laneHeight,
      pitch: n.pitch,
      velocity: Math.max(0, Math.min(1, n.velocity)),
    };
  });
  return { rects, lowPitch, highPitch, laneHeight };
}

/** True for black-key pitch classes — used to shade sharp lanes. */
export function isSharp(pitch: number): boolean {
  return [1, 3, 6, 8, 10].includes(((Math.round(pitch) % 12) + 12) % 12);
}
