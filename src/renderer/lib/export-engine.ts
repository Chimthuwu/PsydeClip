import { encodeFromPcm, Encoded, clampMp3Kbps } from './encode';
import { RecordingFormat } from '../../shared/types';
import { RecorderHandle } from './recorder';
import { HistoryModel } from './history-model';

/**
 * Cache for the decoded audio data to avoid re-decoding 15 mins of Opus
 * every time the user exports a clip.
 */
let decodeCache: {
  recorder: RecorderHandle | null;
  channels: Int16Array[];
  sampleRate: number;
  /** historyModel.newestSec when the snapshot was taken: the decoded buffer's end sits here. */
  anchorSec: number | null;
} | null = null;

export function invalidateExportCache() {
  decodeCache = null;
}

export async function exportSelection(
  recorder: RecorderHandle,
  historyModel: HistoryModel | null,
  bounds: [number, number] | null,
  format: RecordingFormat,
  mp3Kbps: number,
): Promise<Encoded & { durationSec: number }> {
  // 1. Get full WebM blob (snapshot of rolling buffer)
  // If we're exporting WebM, we can just use the coarse chunk-based slice.
  if (format === 'webm') {
    const fracBounds: [number, number] | undefined =
      bounds && historyModel
        ? [historyModel.secToFraction(bounds[0]), historyModel.secToFraction(bounds[1])]
        : undefined;
    const blob = await recorder.snapshotBuffer(fracBounds);
    const duration = bounds ? bounds[1] - bounds[0] : recorder.bufferedDuration();
    return { bytes: new Uint8Array(await blob.arrayBuffer()), ext: 'webm', durationSec: duration };
  }

  // 2. Decode the whole buffer (or use the cache)
  const decoded = await decodedPcm(recorder, historyModel, bounds);
  if (!decoded) return { bytes: new Uint8Array(), ext: 'wav', durationSec: 0 };
  const { channels, sampleRate, anchorSec } = decoded;

  // 3 & 4. Slice in PCM frames
  const totalFrames = channels[0].length;
  const decodedDuration = totalFrames / sampleRate;
  const { startFrame, endFrame } = sliceFrames(
    bounds,
    historyModel,
    anchorSec,
    decodedDuration,
    totalFrames,
    sampleRate,
  );
  const slicedChannels = channels.map(ch => ch.subarray(startFrame, endFrame));
  const sliceDurationSec = (endFrame - startFrame) / sampleRate;

  // 5. Encode via existing methods
  const enc = encodeFromPcm(slicedChannels, sampleRate, format, mp3Kbps);
  
  return { ...enc, durationSec: sliceDurationSec };
}

/** The decoded (and cached) PCM for the rolling buffer, or null if empty. */
async function decodedPcm(
  recorder: RecorderHandle,
  historyModel: HistoryModel | null,
  bounds: [number, number] | null,
): Promise<{ channels: Int16Array[]; sampleRate: number; anchorSec: number | null } | null> {
  if (decodeCache?.recorder !== recorder) {
    decodeCache = null;
  }
  // The buffer keeps growing after a decode. A selection reaching past the
  // cached end (or any selection without an anchor to map from) needs a fresh decode.
  if (
    decodeCache &&
    bounds &&
    historyModel &&
    (decodeCache.anchorSec === null || bounds[1] > decodeCache.anchorSec + 0.05)
  ) {
    decodeCache = null;
  }

  if (!decodeCache) {
    const blob = await recorder.snapshotBuffer(); // Entire buffer
    const anchorSec = historyModel ? historyModel.newestSec : null;
    if (blob.size === 0) return null;

    const AC = window.AudioContext || (window as any).webkitAudioContext;
    const ctx = new AC();
    let audio: AudioBuffer;
    try {
      audio = await ctx.decodeAudioData(await blob.arrayBuffer());
    } finally {
      void ctx.close();
    }

    const chCount = Math.max(1, audio.numberOfChannels);
    const channels: Int16Array[] = [];
    for (let c = 0; c < chCount; c++) {
      const src = audio.getChannelData(c);
      const dst = new Int16Array(src.length);
      for (let i = 0; i < src.length; i++) {
        let s = src[i];
        s = s < -1 ? -1 : s > 1 ? 1 : s;
        dst[i] = s < 0 ? (s * 0x8000) | 0 : (s * 0x7fff) | 0;
      }
      channels.push(dst);
    }

    decodeCache = {
      recorder,
      channels,
      sampleRate: audio.sampleRate,
      anchorSec,
    };
  }

  return {
    channels: decodeCache.channels,
    sampleRate: decodeCache.sampleRate,
    anchorSec: decodeCache.anchorSec,
  };
}

/**
 * Frame range of a `[startSec, endSec]` selection inside the decoded buffer.
 *
 * The decoded buffer's last frame sits at `anchorSec` (the session clock's
 * `newestSec` when the snapshot was taken), so a selection is mapped back from
 * the end rather than from the start — that is what makes the slice
 * sample-accurate even though the buffer keeps growing.
 */
function sliceFrames(
  bounds: [number, number] | null,
  historyModel: HistoryModel | null,
  anchorSec: number | null,
  decodedDuration: number,
  totalFrames: number,
  sampleRate: number,
): { startFrame: number; endFrame: number } {
  if (!bounds || !historyModel || anchorSec === null) {
    return { startFrame: 0, endFrame: totalFrames };
  }
  const [startSec, endSec] = bounds;
  const fromEndStart = Math.max(0, anchorSec - startSec);
  const fromEndEnd = Math.max(0, anchorSec - endSec);

  const startDecoded = Math.max(0, decodedDuration - fromEndStart);
  const endDecoded = Math.max(0, decodedDuration - fromEndEnd);

  let startFrame = Math.floor(startDecoded * sampleRate);
  let endFrame = Math.ceil(endDecoded * sampleRate);
  startFrame = Math.max(0, Math.min(totalFrames, startFrame));
  endFrame = Math.max(startFrame, Math.min(totalFrames, endFrame));
  return { startFrame, endFrame };
}

/**
 * Mono Float32 PCM for one `[startSec, endSec]` window of the rolling buffer,
 * plus the session-second position of the slice's first sample.
 *
 * This is what the MIDI piano-roll lane feeds Basic Pitch (todo.md §MIDI-1
 * Phase A): the engine wants raw mono samples, and the returned `startSec` maps
 * its note times — which are relative to the slice — back onto the History
 * timeline the lane shares with the waveform. Reuses the drag-out decode cache,
 * so scrubbing and re-transcribing a range costs no extra decode.
 */
export async function selectionToMono(
  recorder: RecorderHandle,
  historyModel: HistoryModel | null,
  bounds: [number, number] | null,
): Promise<{ samples: Float32Array; sampleRate: number; startSec: number; durationSec: number } | null> {
  const decoded = await decodedPcm(recorder, historyModel, bounds);
  if (!decoded) return null;
  const { channels, sampleRate, anchorSec } = decoded;
  const totalFrames = channels[0].length;
  const decodedDuration = totalFrames / sampleRate;
  const { startFrame, endFrame } = sliceFrames(
    bounds,
    historyModel,
    anchorSec,
    decodedDuration,
    totalFrames,
    sampleRate,
  );
  const n = endFrame - startFrame;
  if (n <= 0) return null;

  const mono = new Float32Array(n);
  for (const ch of channels) {
    for (let i = 0; i < n; i++) mono[i] += ch[startFrame + i];
  }
  if (channels.length > 1) {
    for (let i = 0; i < n; i++) mono[i] /= channels.length;
  }
  // Int16 → Float32 (the cache stores 16-bit so the ring stays small).
  for (let i = 0; i < n; i++) mono[i] /= 0x8000;

  const startSec =
    anchorSec === null ? 0 : Math.max(0, anchorSec - (decodedDuration - startFrame / sampleRate));

  return { samples: mono, sampleRate, startSec, durationSec: n / sampleRate };
}
