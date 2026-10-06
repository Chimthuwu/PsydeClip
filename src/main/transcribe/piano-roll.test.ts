/**
 * Layout checks for the piano-roll lane. Run: node --test dist/main/transcribe/piano-roll.test.js
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isSharp, layoutPianoRoll, visibleNotes } from '../../shared/piano-roll';
import type { TranscribedNote } from '../../shared/types';

const N = (pitch: number, startSec: number, durationSec: number, velocity = 0.8): TranscribedNote => ({
  pitch,
  startSec,
  durationSec,
  velocity,
});

test('culls notes outside the window and malformed notes', () => {
  const v = visibleNotes([N(60, 0, 1), N(62, 5, 1), N(64, 1.5, 0), N(NaN, 1, 1)], 1, 4);
  assert.equal(v.length, 0);
  assert.equal(visibleNotes([N(60, 0, 1.5)], 1, 4).length, 1);
});

test('auto-fits pitch range and keeps rects inside the canvas at 3 zooms', () => {
  const notes = [N(60, 0, 1), N(67, 2, 0.5), N(72, 9, 2)];
  for (const [s, e] of [[0, 12], [0, 3], [8.9, 9.1]]) {
    const l = layoutPianoRoll(notes, { startSec: s, endSec: e, width: 600, height: 120 });
    for (const r of l.rects) {
      assert.ok(Number.isFinite(r.x + r.y + r.w + r.h));
      assert.ok(r.w > 0 && r.h > 0 && r.x >= 0 && r.x + r.w <= 600 + 1);
      assert.ok(r.y >= 0 && r.y + r.h <= 120 + 1e-6);
    }
  }
  const wide = layoutPianoRoll(notes, { startSec: 0, endSec: 12, width: 600, height: 120 });
  assert.equal(wide.lowPitch, 58);
  assert.equal(wide.highPitch, 74);
  assert.equal(wide.rects.length, 3);
  // highest pitch sits on the top lane
  assert.equal(wide.rects[2].y, 2 * wide.laneHeight);
});

test('degenerate input yields an empty layout, never NaN', () => {
  assert.equal(layoutPianoRoll([N(60, 0, 1)], { startSec: 1, endSec: 1, width: 10, height: 10 }).rects.length, 0);
  assert.equal(layoutPianoRoll([], { startSec: 0, endSec: 1, width: 10, height: 10 }).rects.length, 0);
  assert.equal(layoutPianoRoll([N(60, 0, 1)], { startSec: 0, endSec: 1, width: 0, height: 10 }).rects.length, 0);
});

test('isSharp', () => {
  assert.ok(isSharp(61));
  assert.ok(!isSharp(60));
  assert.ok(isSharp(-11));
});
