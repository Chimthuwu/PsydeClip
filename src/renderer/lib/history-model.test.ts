/**
 * Tests for the rolling-buffer coordinate system (todo.md §11.4 Phase 1-2).
 *
 * `HistoryModel` is the one place that translates between session seconds, the
 * peak buffer's bucket grid and display fractions — every selection, every
 * export slice and the piano-roll lane's time axis go through it. Its zoom/pan
 * behaviour was verified by hand when it was written ("viewport math verified
 * numerically", §11.4 Phase 2) and never by a test, because `npm test` only
 * looked at `dist/main/transcribe/*.test.js`. These lock it in.
 *
 * The model's live edge advances with `performance.now()`, so every assertion
 * against a wall-clock value carries a tolerance rather than an exact number.
 *
 * Run: npm test   (see tsconfig.test.json)
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HistoryModel, HISTORY_BUCKET_SEC, MIN_VIEWPORT_SEC } from './history-model';
import { PeakBuffer } from './peak-buffer';

/** The session clock drifts by microseconds between setup and assertion. */
function near(actual: number, expected: number, eps = 0.05, msg?: string) {
  assert.ok(
    Math.abs(actual - expected) <= eps,
    msg ?? `expected ${actual} to be within ${eps} of ${expected}`,
  );
}

/**
 * A model with 600 buckets (12 s) buffered and the live edge stamped at 12 s,
 * so the window is [0, 12] and the "following" margin is `max(1, 12 * 0.02)`.
 */
function makeModel(newestSec = 12) {
  const peak = new PeakBuffer(60, 20);
  for (let i = 0; i < 600; i++) peak.push(0, 0);
  return new HistoryModel(peak, newestSec);
}

test('the session clock and the buffered window', () => {
  const m = makeModel();
  assert.equal(m.bucketSec, HISTORY_BUCKET_SEC);
  assert.equal(m.durationSec, 12);
  near(m.newestSec, 12);
  near(m.oldestSec, 0);
  near(m.bucketToSec(0), 0);
  near(m.bucketToSec(600), 12);
  near(m.secToBucket(m.oldestSec), 0);
  near(m.secToBucket(m.newestSec), 600);
});

test('an empty buffer never produces a negative window', () => {
  const m = new HistoryModel(new PeakBuffer(60, 20), 0);
  assert.equal(m.durationSec, 0);
  near(m.oldestSec, 0);
  const [lo, hi] = m.effectiveViewport(null);
  // The live edge drifts by microseconds with the clock, so an empty buffer is
  // a zero-length window rather than an inverted one.
  assert.ok(lo <= hi, `window must not invert (got [${lo}, ${hi}])`);
  assert.ok(hi < 0.01, 'and it stays empty');
  near(m.clampSec(-5), 0, 0.01, 'clamping into an empty window is still safe');
});

test('fit-all is the whole buffer at the live edge', () => {
  const m = makeModel();
  const [lo, hi] = m.effectiveViewport(null);
  near(lo, 0);
  near(hi, 12);
});

test('a following viewport keeps its span and slides with the live edge', () => {
  const m = makeModel();
  const [lo, hi] = m.effectiveViewport({ startSec: 0, endSec: 4, following: true });
  near(hi, 12, 0.05, 'the right edge is pinned to now');
  near(lo, 8, 0.05, 'and the span is preserved');
});

test('a fixed viewport stays where it was put, clamped into the window', () => {
  const m = makeModel();
  const [lo, hi] = m.effectiveViewport({ startSec: 3, endSec: 5, following: false });
  near(lo, 3);
  near(hi, 5);
  // A window the ring has wrapped past collapses to fit-all rather than
  // returning an empty or out-of-range view.
  const [lo2, hi2] = m.effectiveViewport({ startSec: 40, endSec: 42, following: false });
  near(lo2, 0);
  near(hi2, 12);
});

test('zoom keeps the anchor in place and clamps to the buffer', () => {
  const m = makeModel();
  // Zoom in 2x around the middle: the anchor keeps its relative position.
  const z = m.zoomViewport([0, 12], 6, 0.5);
  near(z.startSec, 3);
  near(z.endSec, 9);
  assert.equal(z.following, false, 'the anchor is far from the live edge');

  // Zooming at the live edge keeps the view following new audio.
  const atNow = m.zoomViewport([0, 12], 12, 0.5);
  assert.equal(atNow.following, true);

  // Zooming out past the buffer is capped at the whole buffer.
  const out = m.zoomViewport([4, 8], 6, 100);
  near(out.startSec, 0);
  near(out.endSec, 12);

  // Zooming in past the bucket grid is floored at MIN_VIEWPORT_SEC — below it
  // there is nothing finer to show.
  const deep = m.zoomViewport([4, 8], 6, 1e-6);
  near(deep.endSec - deep.startSec, MIN_VIEWPORT_SEC, 1e-6);
});

test('pan clamps at both edges and re-follows at the live edge', () => {
  const m = makeModel();
  const fwd = m.panViewport([0, 6], 100);
  near(fwd.startSec, 6, 0.05, 'panned to the newest 6 s');
  near(fwd.endSec, 12, 0.05);
  assert.equal(fwd.following, true, 'panning up to the live edge re-enables following');

  const back = m.panViewport([6, 12], -100);
  near(back.startSec, 0, 0.05);
  near(back.endSec, 6, 0.05);
  assert.equal(back.following, false, 'parked in the past');

  // A viewport as wide as the window is just fit-all.
  const all = m.panViewport([0, 12], 5);
  assert.equal(all.following, true);
  near(all.startSec, 0);
  near(all.endSec, 12);
});

test('clampSec and the fraction helpers stay inside the window', () => {
  const m = makeModel();
  near(m.clampSec(-5), 0);
  near(m.clampSec(99), 12);
  near(m.clampSec(6), 6);
  near(m.secToFraction(m.oldestSec), 0);
  near(m.secToFraction(m.newestSec), 1);
  near(m.fractionToSec(0), 0);
  near(m.fractionToSec(1), 12);
  assert.equal(m.secToFraction(-100), 0, 'never negative');
  assert.equal(m.secToFraction(100), 1, 'never past 1');
});

test('columnPeaks decimates one min/max pair per column', () => {
  const peak = new PeakBuffer(60, 20);
  // 10 buckets with known values: bucket i holds min = -i, max = +i.
  for (let i = 0; i < 10; i++) peak.push(-i, i);
  const m = new HistoryModel(peak, 10 * HISTORY_BUCKET_SEC);

  // 5 columns over 10 buckets = 2 buckets each: column c spans buckets 2c,2c+1,
  // so its min is the more negative of the two and its max the larger.
  const { lo, hi } = m.columnPeaks(0, 10, 5);
  for (let c = 0; c < 5; c++) {
    assert.equal(lo[c], -(2 * c + 1), `column ${c} min`);
    assert.equal(hi[c], 2 * c + 1, `column ${c} max`);
  }

  // Buckets outside the window contribute nothing: over buckets 8-10 with 5
  // columns, bucket 8 lands in column 0 and bucket 9 in column 2 (each column
  // takes `floor(t * columns)`), so the untouched columns stay empty (±Infinity)
  // instead of painting a spike.
  const narrow = m.columnPeaks(8, 10, 5);
  assert.ok(Number.isFinite(narrow.lo[0]), 'column 0 has bucket 8');
  assert.equal(narrow.lo[0], -8);
  assert.ok(Number.isFinite(narrow.lo[2]), 'column 2 has bucket 9');
  assert.equal(narrow.lo[2], -9);
  assert.ok(!Number.isFinite(narrow.lo[4]), 'a column with no bucket stays empty');
  assert.ok(!Number.isFinite(narrow.hi[1]), 'and so does one between them');

  // Degenerate inputs must not throw or emit NaN.
  const empty = m.columnPeaks(0, 0, 0);
  assert.equal(empty.lo.length, 0);
  const noColumns = m.columnPeaks(0, 10, 0);
  assert.equal(noColumns.hi.length, 0);
});
