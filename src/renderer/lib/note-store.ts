/**
 * Clip-keyed cache of transcribed note layers for the piano-roll lane
 * (todo.md §MIDI-1, Phase A).
 *
 * A layer carries the notes *and* the session-second origin of the audio they
 * came from: Basic Pitch reports note times relative to the slice it was handed,
 * while the lane draws on the History waveform's absolute session timeline.
 * Keeping the two together is what lets a note bar sit exactly over the audio
 * that produced it at any zoom or pan.
 *
 * Caching by selection key means re-selecting a range you already transcribed
 * shows its notes immediately instead of paying another inference run — Basic
 * Pitch costs roughly the clip's own length on the CPU backend.
 */

import type { TranscribedNote } from '../../shared/types';

export interface NoteLayer {
  /** Session seconds of the slice's first sample — note times are relative to this. */
  startSec: number;
  /** Length of the transcribed slice in seconds. */
  durationSec: number;
  notes: TranscribedNote[];
  /** Short range label for the lane's corner, e.g. `12.4–18.9s`. */
  label: string;
}

/** How many layers to keep. Each is small (a few hundred notes at most). */
const CACHE_LIMIT = 12;

const layers = new Map<string, NoteLayer>();

/**
 * Stable cache key for a selection, rounded to 10 ms so nudging a handle by a
 * pixel re-uses the cached notes instead of re-running inference.
 */
export function selectionKey(sel: [number, number]): string {
  return `${Math.round(sel[0] * 100)}:${Math.round(sel[1] * 100)}`;
}

/** `12.4–18.9s` — the lane's own caption for what it is showing. */
export function rangeLabel(startSec: number, durationSec: number): string {
  return `${startSec.toFixed(1)}–${(startSec + durationSec).toFixed(1)}s`;
}

export function getNoteLayer(key: string): NoteLayer | null {
  return layers.get(key) ?? null;
}

export function putNoteLayer(key: string, layer: NoteLayer): void {
  // Re-insert so the most recently used layer is the last evicted.
  layers.delete(key);
  layers.set(key, layer);
  while (layers.size > CACHE_LIMIT) {
    const oldest = layers.keys().next().value;
    if (oldest === undefined) break;
    layers.delete(oldest);
  }
}

/** Drop every cached layer (the rolling session changed, so seconds moved). */
export function clearNoteLayers(): void {
  layers.clear();
}
