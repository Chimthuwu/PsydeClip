/**
 * Tests for the piano-roll lane's note cache (todo.md §MIDI-1 Phase A).
 *
 * The cache exists so re-selecting a range you already transcribed is instant —
 * Basic Pitch costs roughly the clip's own length on the CPU backend, so a
 * cache miss is a real wait, and an eviction bug is a silent one (you just pay
 * for the inference again). The key rounding is what makes "nudge the handle a
 * pixel" re-use the notes instead of re-running.
 *
 * Run: npm test   (see tsconfig.test.json)
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { clearNoteLayers, getNoteLayer, putNoteLayer, rangeLabel, selectionKey } from './note-store';
import type { NoteLayer } from './note-store';

function layer(startSec = 0, durationSec = 1): NoteLayer {
  return {
    startSec,
    durationSec,
    notes: [{ pitch: 60, startSec: 0, durationSec: 0.5, velocity: 0.8 }],
    label: rangeLabel(startSec, durationSec),
  };
}

test('selectionKey rounds to 10 ms so a nudge re-uses the cache', () => {
  // Within the same 10 ms bucket: same key.
  assert.equal(selectionKey([1.004, 2.996]), selectionKey([1.001, 2.999]));
  // A 20 ms move is a different range.
  assert.notEqual(selectionKey([1.0, 3.0]), selectionKey([1.02, 3.0]));
  assert.equal(selectionKey([1.5, 2.25]), '150:225');
});

test('rangeLabel is the lane caption', () => {
  assert.equal(rangeLabel(1.5, 2), '1.5–3.5s');
  assert.equal(rangeLabel(0, 0.25), '0.0–0.3s', 'one decimal, rounded');
});

test('put/get round trip, and an unknown key is null not undefined', () => {
  clearNoteLayers();
  const l = layer(3, 2);
  putNoteLayer('a', l);
  assert.equal(getNoteLayer('a'), l);
  assert.equal(getNoteLayer('nope'), null);
});

test('the cache is bounded and evicts the least recently used layer', () => {
  clearNoteLayers();
  // CACHE_LIMIT is 12; put 13 distinct layers.
  for (let i = 0; i < 13; i++) putNoteLayer(`k${i}`, layer(i));
  assert.equal(getNoteLayer('k0'), null, 'the oldest layer was evicted');
  assert.notEqual(getNoteLayer('k1'), null, 'the rest survive');
  assert.notEqual(getNoteLayer('k12'), null);
});

test('re-putting a key refreshes it instead of duplicating it', () => {
  clearNoteLayers();
  for (let i = 0; i < 12; i++) putNoteLayer(`k${i}`, layer(i));
  // Touch k0, then overflow: k1 should go, not k0.
  putNoteLayer('k0', layer(0, 5));
  putNoteLayer('k99', layer(99));
  assert.equal(getNoteLayer('k0')?.durationSec, 5, 'the refreshed layer is still cached');
  assert.equal(getNoteLayer('k1'), null, 'the now-oldest layer was evicted');
  assert.notEqual(getNoteLayer('k99'), null);
});

test('clearNoteLayers empties it (a new recording session moves every second)', () => {
  putNoteLayer('x', layer());
  clearNoteLayers();
  assert.equal(getNoteLayer('x'), null);
});
