import { createRollingBuffer, RollingBuffer } from './ring-buffer';

/**
 * Stateful recorder built on top of MediaRecorder. Encodes the captured
 * stream as Opus in a WebM container and pushes each chunk into a rolling
 * buffer (rolling mode) or just into a single accumulating blob (traditional).
 */

export interface RecorderOptions {
  stream: MediaStream;
  bitrateKbps: number;
  bufferSeconds: number;
  mode: 'rolling' | 'traditional' | 'stream';
  /**
   * Stream mode only: called once per emitted chunk, in order, with the raw
   * bytes. Returning before the previous chunk's call settled keeps arrival
   * order at the sink (the more expensive blob→bytes conversion runs inside
   * the chain rather than holding up the MediaRecorder event loop).
   */
  onChunk?: (bytes: Uint8Array) => void | Promise<void>;
}

export interface RecorderHandle {
  start(): void;
  stop(): Promise<Blob>;
  /** Pulls a snapshot of whatever is currently buffered. */
  snapshotBuffer(bounds?: [number, number]): Promise<Blob>;
  bufferedDuration(): number;
  isActive(): boolean;
  /**
   * Stream mode only: resolves once every chunk submitted so far (including
   * the final one, which MediaRecorder emits just before `onstop`) has been
   * passed to `onChunk`. Await it after `stop()` before finalising.
   */
  flush(): Promise<void>;
  // Tracked for the HUD.
  mode: 'rolling' | 'traditional' | 'stream';
}

export function createRecorder(opts: RecorderOptions): RecorderHandle {
  const buffer: RollingBuffer = createRollingBuffer(opts.bufferSeconds * 1000);
  let recorder: MediaRecorder | null = null;
  let traditionalChunks: Blob[] = [];
  let active = false;
  // When the current traditional/stream session started. Used so
  // `bufferedDuration()` reports the real elapsed time in traditional mode
  // (the rolling buffer stays empty there, which would otherwise read 0.0s).
  let startedAt = 0;
  // Stream mode: every chunk is appended to this promise chain in emission
  // order, so `flush()` can vouch that the sink has seen everything before
  // anyone reads the accumulated file.
  let streamChain: Promise<void> = Promise.resolve();

  function buildRecorder(): MediaRecorder {
    const mime = pickSupportedMime();
    const rec = new MediaRecorder(opts.stream, {
      mimeType: mime,
      audioBitsPerSecond: opts.bitrateKbps * 1000,
    });
    rec.ondataavailable = (ev: BlobEvent) => {
      if (!ev.data || ev.data.size === 0) return;
      if (opts.mode === 'stream') {
        streamChain = streamChain.then(async () => {
          // The final chunk (emitted just before stop) rides the same chain,
          // so flush() after stop() covers it too.
          const bytes = new Uint8Array(await ev.data.arrayBuffer());
          await opts.onChunk?.(bytes);
        });
        streamChain.catch(() => undefined); // keep the chain alive on sink errors
        return;
      }
      if (opts.mode === 'rolling') {
        buffer.push(ev.data);
      } else {
        traditionalChunks.push(ev.data);
      }
    };
    return rec;
  }

  function start() {
    if (active) return;
    recorder = buildRecorder();
    if (opts.mode === 'rolling') {
      buffer.clear();
    } else if (opts.mode === 'traditional') {
      traditionalChunks = [];
    }
    // Timeslice of 1000 ms emits chunks ~once a second, balancing granularity
    // and overhead.
    recorder.start(1000);
    active = true;
    startedAt = Date.now();
  }

  async function stop(): Promise<Blob> {
    if (!recorder || !active) return new Blob();
    const rec = recorder;
    return new Promise<Blob>((resolve) => {
      rec.onstop = async () => {
        active = false;
        if (opts.mode === 'traditional') {
          const blob = new Blob(traditionalChunks, { type: 'audio/webm' });
          traditionalChunks = [];
          resolve(blob);
        } else if (opts.mode === 'stream') {
          // Stream mode retains nothing; the caller reads the file via
          // `flush()` + the clip IPC instead.
          resolve(new Blob());
        } else {
          resolve(await buffer.snapshot());
        }
      };
      rec.stop();
    });
  }

  async function snapshotBuffer(bounds?: [number, number]): Promise<Blob> {
    if (opts.mode === 'rolling') return buffer.snapshot(bounds);
    if (opts.mode === 'traditional') return new Blob(traditionalChunks, { type: 'audio/webm' });
    return new Blob();
  }

  return {
    start,
    stop,
    snapshotBuffer,
    bufferedDuration: () =>
      opts.mode === 'traditional' && startedAt
        ? Math.max(0, (Date.now() - startedAt) / 1000)
        : buffer.durationSec(),
    isActive: () => active,
    flush: () => streamChain,
    mode: opts.mode,
  };
}

const CANDIDATE_MIMES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/ogg;codecs=opus',
];

function pickSupportedMime(): string {
  for (const m of CANDIDATE_MIMES) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(m)) return m;
  }
  return 'audio/webm';
}
