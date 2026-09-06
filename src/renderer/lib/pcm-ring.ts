/**
 * A fixed-size circular buffer of raw PCM, one Int16Array per channel.
 *
 * Why this exists: the rolling WebM buffer (`ring-buffer.ts`) holds encoded
 * Opus clusters, and once it has pruned past its first chunk the concatenation
 * is no longer independently decodable — and even with the header re-attached,
 * `decodeAudioData` honours the cluster timestamps and would allocate a buffer
 * spanning the *whole* session. For WAV / MP3 export in rolling mode we instead
 * tap the live graph with a ScriptProcessor and keep the last N seconds of
 * decoded samples here, quantised to 16-bit (which is what both encoders want
 * anyway). Cost: ~sampleRate * seconds * channels * 2 bytes — about 173 MB for
 * 15 min of 48 kHz stereo — so the tap only runs when a lossy/lossless format
 * is actually selected.
 */
export class PcmRing {
  readonly sampleRate: number;
  readonly channels: number;
  private readonly cap: number; // capacity in frames
  private readonly bufs: Int16Array[];
  private head = 0; // next frame to write
  private filled = 0; // frames written so far, capped at `cap`

  constructor(sampleRate: number, seconds: number, channels = 2) {
    this.sampleRate = Math.max(1, Math.round(sampleRate));
    this.channels = Math.max(1, channels);
    this.cap = Math.max(1, Math.ceil(this.sampleRate * Math.max(1, seconds)));
    this.bufs = Array.from({ length: this.channels }, () => new Int16Array(this.cap));
  }

  /** Append one block of planar float samples (one Float32Array per channel). */
  writeFloat(planar: Float32Array[]): void {
    const n = planar[0]?.length ?? 0;
    if (n === 0) return;
    for (let c = 0; c < this.channels; c++) {
      const src = planar[Math.min(c, planar.length - 1)];
      const dst = this.bufs[c];
      let h = this.head;
      for (let i = 0; i < n; i++) {
        let s = src[i];
        s = s < -1 ? -1 : s > 1 ? 1 : s;
        dst[h] = s < 0 ? (s * 0x8000) | 0 : (s * 0x7fff) | 0;
        if (++h === this.cap) h = 0;
      }
    }
    this.head = (this.head + n) % this.cap;
    this.filled = Math.min(this.cap, this.filled + n);
  }

  get length(): number {
    return this.filled;
  }

  get seconds(): number {
    return this.filled / this.sampleRate;
  }

  /**
   * Copy out the buffered samples in chronological order, one Int16Array per
   * channel. `bounds` is an optional fractional [start, end] sub-range (0..1)
   * over what's currently buffered — matches `RollingBuffer.snapshot`.
   */
  read(bounds?: [number, number]): Int16Array[] {
    const total = this.filled;
    let from = 0;
    let to = total;
    if (bounds) {
      from = Math.floor(bounds[0] * total);
      to = Math.ceil(bounds[1] * total);
    }
    from = Math.min(Math.max(from, 0), total);
    to = Math.min(Math.max(to, from), total);
    const count = to - from;
    const oldest = (this.head - this.filled + this.cap * 2) % this.cap;
    const start = (oldest + from) % this.cap;

    return this.bufs.map((buf) => {
      const out = new Int16Array(count);
      const firstPart = Math.min(count, this.cap - start);
      out.set(buf.subarray(start, start + firstPart), 0);
      if (firstPart < count) out.set(buf.subarray(0, count - firstPart), firstPart);
      return out;
    });
  }
}
