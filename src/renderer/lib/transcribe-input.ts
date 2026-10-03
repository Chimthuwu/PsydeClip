/**
 * Decode saved audio bytes to mono Float32 PCM for transcription.
 *
 * The renderer owns this because it is the only place with a usable
 * `AudioContext`/OfflineAudioContext — main has no audio decoder, and the app
 * already depends on Web Audio for WAV/MP3 encoding (see export-engine.ts).
 *
 * Note the sample rate contract: Basic Pitch only accepts 22050 Hz and, when
 * handed a raw Float32Array, does NOT validate this (engine.ts trap 1) — it
 * silently doubles every timestamp. So whatever rate comes out of the decode is
 * reported back to the caller, which passes it to the worker, which resamples.
 */

/**
 * Decode encoded audio bytes (webm/wav/mp3) into mono samples.
 * @returns samples and the rate they were decoded at.
 */
export async function decodeToMono(
  bytes: Uint8Array,
): Promise<{ samples: Float32Array; sampleRate: number }> {
  if (bytes.byteLength === 0) {
    return { samples: new Float32Array(0), sampleRate: 22050 };
  }
  // OfflineAudioContext is cheaper than a live AudioContext and this runs off
  // the hot path. decodeAudioData resamples to the context's rate, so a throwaway
  // 1-frame context at a common rate is enough; the real rate is read back off
  // the decoded AudioBuffer and reported to the caller.
  const AC = window.OfflineAudioContext ?? (window as any).webkitOfflineAudioContext;
  if (!AC) throw new Error('No Web Audio support for decoding.');

  // Copy out of the renderer's pooled buffer: Blob wants an ArrayBuffer-backed
  // view, and this buffer is retained across an await.
  const copy = bytes.slice();

  const ctx = new AC(1, 1, 44100);
  // decodeAudioData's Promise form takes an ArrayBuffer, not a Blob.
  const audio = await ctx.decodeAudioData(copy.buffer as ArrayBuffer);
  const sampleRate = audio.sampleRate;

  const n = audio.length;
  const samples = new Float32Array(n);
  const ch = audio.numberOfChannels;
  for (let c = 0; c < ch; c++) {
    const data = audio.getChannelData(c);
    for (let i = 0; i < n; i++) samples[i] += data[i];
  }
  if (ch > 1) for (let i = 0; i < n; i++) samples[i] /= ch;

  return { samples, sampleRate };
}

/**
 * Downmix an AudioBuffer to mono without going through encoded bytes.
 * Preferred where a decoded AudioBuffer already exists (the rolling export
 * path), since it avoids a redundant encode/decode round trip.
 */
export function audioBufferToMono(audio: AudioBuffer): {
  samples: Float32Array;
  sampleRate: number;
} {
  const n = audio.length;
  const samples = new Float32Array(n);
  const ch = audio.numberOfChannels;
  for (let c = 0; c < ch; c++) {
    const data = audio.getChannelData(c);
    for (let i = 0; i < n; i++) samples[i] += data[i];
  }
  if (ch > 1) for (let i = 0; i < n; i++) samples[i] /= ch;
  return { samples, sampleRate: audio.sampleRate };
}