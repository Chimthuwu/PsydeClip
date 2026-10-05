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

  // 2. Decode the whole buffer (or use cache)
  let channels: Int16Array[];
  let sampleRate: number;

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

  if (decodeCache) {
    channels = decodeCache.channels;
    sampleRate = decodeCache.sampleRate;
  } else {
    const blob = await recorder.snapshotBuffer(); // Entire buffer
    const anchorSec = historyModel ? historyModel.newestSec : null;
    if (blob.size === 0) {
      return { bytes: new Uint8Array(), ext: 'wav', durationSec: 0 };
    }

    const AC = window.AudioContext || (window as any).webkitAudioContext;
    const ctx = new AC();
    let audio: AudioBuffer;
    try {
      audio = await ctx.decodeAudioData(await blob.arrayBuffer());
    } finally {
      void ctx.close();
    }

    const chCount = Math.max(1, audio.numberOfChannels);
    channels = [];
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
    sampleRate = audio.sampleRate;

    decodeCache = {
      recorder,
      channels,
      sampleRate,
      anchorSec,
    };
  }
  const anchorSec = decodeCache.anchorSec;

  // 3 & 4. Slice in PCM frames
  const totalFrames = channels[0].length;
  const decodedDuration = totalFrames / sampleRate;

  let startFrame = 0;
  let endFrame = totalFrames;

  if (bounds && historyModel && anchorSec !== null) {
    // The decoded WebM buffer represents the actual chunks we recorded.
    // The historyModel peak track has `historyModel.durationSec`.
    // The decoded duration and history duration are usually very close, 
    // but the end of the decoded buffer corresponds to `newestSec` as of the snapshot (`anchorSec`).
    // We map the absolute seconds back from the end.
    const [startSec, endSec] = bounds;
    
    // Time from the end of the buffer:
    const fromEndStart = Math.max(0, anchorSec - startSec);
    const fromEndEnd = Math.max(0, anchorSec - endSec);

    // Corresponding time in the decoded buffer:
    const startDecoded = Math.max(0, decodedDuration - fromEndStart);
    const endDecoded = Math.max(0, decodedDuration - fromEndEnd);

    startFrame = Math.floor(startDecoded * sampleRate);
    endFrame = Math.ceil(endDecoded * sampleRate);

    // Clamp
    startFrame = Math.max(0, Math.min(totalFrames, startFrame));
    endFrame = Math.max(startFrame, Math.min(totalFrames, endFrame));
  }

  const slicedChannels = channels.map(ch => ch.subarray(startFrame, endFrame));
  const sliceDurationSec = (endFrame - startFrame) / sampleRate;

  // 5. Encode via existing methods
  const enc = encodeFromPcm(slicedChannels, sampleRate, format, mp3Kbps);
  
  return { ...enc, durationSec: sliceDurationSec };
}
