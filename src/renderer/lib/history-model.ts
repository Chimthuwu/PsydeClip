import { PeakBuffer } from './peak-buffer';

/**
 * Historical waveform coordinate system (todo.md §11.4, Phase 1).
 *
 * Selections are stored as ABSOLUTE seconds since the rolling session began
 * (design decision D1) — never as fractions of a viewport or of a buffer.
 * The peak buffer stays the display's source of truth for *where things are*;
 * exporters map the same seconds onto their own data (WebM chunks, PCM ring).
 *
 * This model owns everything the history view needs to translate between the
 * three coordinate spaces involved:
 *
 *   - session seconds  — the canonical, absolute coordinate of a selection
 *   - bucket index     — the peak buffer's own 20 ms grid
 *   - display fraction — 0..1 across the buffered window (what the old code
 *     stored in place of seconds, and what the exporters still slice by)
 *
 * The session clock is a *stamp* (`newestSec` at construction, advanced by
 * `performance.now()`). The main window constructs the model at capture start
 * with `newestSec = 0`; the pop-out reconstructs it from each `viz:history`
 * frame with the newestSec the main window stamped, so both windows agree on
 * what a given second means even though their `performance.now()` clocks have
 * independent origins.
 */
export const HISTORY_BUCKET_MS = 20;
export const HISTORY_BUCKET_SEC = HISTORY_BUCKET_MS / 1000;

/**
 * Narrowest viewport span in seconds. The peak track is 20 ms buckets, so
 * below this there is nothing finer to show — Phase 6 adds a finer sampler.
 */
export const MIN_VIEWPORT_SEC = 0.1;

/**
 * A zoom/pan viewport over the history track (todo.md §11.4 Phase 2).
 *
 * `following` means the viewport's right edge is pinned to the live edge of
 * the buffer: the span is kept, but `start`/`end` slide forward as new audio
 * arrives. When false, the viewport is a fixed absolute window into the past
 * (it drifts out of view when the ring wraps past it).
 */
export interface ViewportState {
  startSec: number;
  endSec: number;
  following: boolean;
}

export class HistoryModel {
  readonly bucketMs: number;
  readonly peak: PeakBuffer;

  /** Session-relative seconds of the newest bucket, as stamped. */
  private newestSecAt: number;
  private stampedAt: number;

  constructor(peak: PeakBuffer, newestSec: number, bucketMs: number = HISTORY_BUCKET_MS) {
    this.peak = peak;
    this.bucketMs = bucketMs;
    this.newestSecAt = newestSec;
    this.stampedAt = performance.now();
  }

  get bucketSec(): number {
    return this.bucketMs / 1000;
  }

  /**
   * Re-sync the session clock to a fresh `newestSec` stamp without allocating a
   * new model. The pop-out gets a `viz:history` frame ~5×/s; rebuilding the
   * model each time (and re-rendering to hand the new object down) is what made
   * every visualizer flicker while popped out / docked.
   */
  restamp(newestSec: number): void {
    this.newestSecAt = newestSec;
    this.stampedAt = performance.now();
  }

  /** Session seconds of the newest bucket — the live edge of the buffer. */
  get newestSec(): number {
    return this.newestSecAt + (performance.now() - this.stampedAt) / 1000;
  }

  /** Session seconds of the oldest bucket still buffered (0 before it fills). */
  get oldestSec(): number {
    return Math.max(0, this.newestSec - this.peak.getCount() * this.bucketSec);
  }

  /** Wall-clock span of everything currently buffered. */
  get durationSec(): number {
    return this.peak.getCount() * this.bucketSec;
  }

  /** Seconds of the chronological bucket at index `i` (0 = oldest). */
  bucketToSec(i: number): number {
    return this.oldestSec + i * this.bucketSec;
  }

  /** Chronological bucket index containing session-second `sec` (fractional). */
  secToBucket(sec: number): number {
    return (sec - this.oldestSec) / this.bucketSec;
  }

  /**
   * Resolve a `ViewportState` against the *current* buffer window. Null (or a
   * viewport wider than the window) means fit-all: the whole buffer, right
   * edge at live "now". A following viewport is re-anchored to `newestSec`
   * every call so the view slides with the live edge. A fixed viewport is
   * clamped into the window (the ring may have wrapped past it).
   */
  effectiveViewport(view: ViewportState | null): [number, number] {
    const lo = this.oldestSec;
    const hi = this.newestSec;
    if (hi - lo <= 0) return [lo, hi];
    if (!view) return [lo, hi];
    let start: number;
    let end: number;
    if (view.following) {
      const span = view.endSec - view.startSec;
      start = hi - Math.max(0, span);
      end = hi;
    } else {
      start = view.startSec;
      end = view.endSec;
    }
    if (end - start >= hi - lo) return [lo, hi];
    start = Math.max(lo, Math.min(hi, start));
    end = Math.max(lo, Math.min(hi, end));
    if (end - start <= 0) return [lo, hi];
    return [start, end];
  }

  /** Fit-all viewport: the whole buffered window at the live edge. */
  fitViewport(): ViewportState {
    return { startSec: this.oldestSec, endSec: this.newestSec, following: true };
  }

  /**
   * How close to the live edge a zoom/pan must land to keep *following* it
   * (max 1 s, or 2% of the buffered window). Forgiving on purpose: zooming
   * in near "now" with the cursor a pixel short of the edge should keep the
   * view sliding with new audio, not freeze it into the past.
   */
  private liveMarginSec(): number {
    return Math.max(1, this.durationSec * 0.02);
  }

  /**
   * Zoom `view` around `anchorSec` by `factor` (>1 zooms in, <1 zooms out),
   * clamped to the buffered window. The anchor keeps its relative position
   * within the viewport. Returns the new viewport state — `following` is set
   * when the zoom anchored near the live edge, so zooming at "now" keeps
   * tracking new audio.
   */
  zoomViewport(view: [number, number], anchorSec: number, factor: number): ViewportState {
    const [start, end] = view;
    const span = Math.max(1e-6, end - start);
    const anchorFrac = Math.max(0, Math.min(1, (anchorSec - start) / span));
    let newSpan = Math.min(this.durationSec, Math.max(MIN_VIEWPORT_SEC, span * factor));
    if (this.durationSec <= MIN_VIEWPORT_SEC) newSpan = this.durationSec;
    let newStart = anchorSec - anchorFrac * newSpan;
    let newEnd = newStart + newSpan;
    const lo = this.oldestSec;
    const hi = this.newestSec;
    if (newEnd - newStart > hi - lo) {
      newStart = lo;
      newEnd = hi;
    } else {
      if (newStart < lo) {
        newStart = lo;
        newEnd = lo + newSpan;
      }
      if (newEnd > hi) {
        newEnd = hi;
        newStart = hi - newSpan;
      }
    }
    const following = anchorSec >= hi - this.liveMarginSec();
    return { startSec: newStart, endSec: newEnd, following };
  }

  /**
   * Pan `view` by `dSec` (positive = towards the future), clamped so the
   * viewport never leaves the buffered window. Returns the new viewport state;
   * panning up to the live edge re-enables following.
   */
  panViewport(view: [number, number], dSec: number): ViewportState {
    const [start, end] = view;
    const span = end - start;
    const lo = this.oldestSec;
    const hi = this.newestSec;
    if (span >= hi - lo) return { startSec: lo, endSec: hi, following: true };
    const newStart = Math.max(lo, Math.min(hi - span, start + dSec));
    const newEnd = newStart + span;
    return {
      startSec: newStart,
      endSec: newEnd,
      following: newEnd >= hi - this.liveMarginSec(),
    };
  }

  /** 0..1 display fraction of a session-second value within the window. */
  secToFraction(sec: number): number {
    const d = this.durationSec;
    if (d <= 0) return 0;
    return Math.max(0, Math.min(1, (sec - this.oldestSec) / d));
  }

  /** Session seconds for a 0..1 display fraction. */
  fractionToSec(frac: number): number {
    return this.oldestSec + frac * this.durationSec;
  }

  /** Clamp a session-second value into what's actually buffered. */
  clampSec(sec: number): number {
    const lo = this.oldestSec;
    const hi = this.newestSec;
    if (hi - lo <= 0) return lo;
    return Math.max(lo, Math.min(hi, sec));
  }

  /**
   * Min/max per output column over a bucket-index window — the decimated peak
   * track. Phase 2's zoom reuses this with a narrowed window; fit-all (Phase 1)
   * passes `[0, count]`. Returns one `[lo, hi]` pair per column, in raw sample
   * units (caller applies the gain clamp while drawing).
   *
   * One pass over the buffer, each bucket landing in exactly one column — far
   * cheaper than the old one-`lineTo`-per-bucket draw, and pixel-equivalent
   * when the window spans the whole buffer.
   */
  columnPeaks(
    fromBucket: number,
    toBucket: number,
    columns: number,
  ): { lo: Float32Array; hi: Float32Array } {
    const lo = new Float32Array(columns);
    const hi = new Float32Array(columns);
    lo.fill(Infinity);
    hi.fill(-Infinity);
    const numPairs = this.peak.getCount();
    if (numPairs === 0 || columns <= 0) return { lo, hi };
    const span = Math.max(1e-6, toBucket - fromBucket);
    const arr = this.peak.getFloat32Array();
    for (let i = 0; i < numPairs; i++) {
      const t = (i - fromBucket) / span;
      if (t < 0 || t > 1) continue;
      const col = Math.min(columns - 1, Math.floor(t * columns));
      const mn = arr[i * 2];
      const mx = arr[i * 2 + 1];
      if (mn < lo[col]) lo[col] = mn;
      if (mx > hi[col]) hi[col] = mx;
    }
    return { lo, hi };
  }
}