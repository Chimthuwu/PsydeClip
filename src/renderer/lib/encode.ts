import { Mp3Encoder } from '@breezystack/lamejs';
import { RecordingFormat } from '../../shared/types';

/**
 * Turns captured audio into the bytes we write to disk.
 *
 *   - webm : passthrough — the MediaRecorder output is already what we want.
 *   - wav  : 16-bit PCM in a RIFF/WAVE container.
 *   - mp3  : lamejs, CBR at the requested bitrate.
 *
 * Two entry points because the two capture paths hand us different things:
 * `encodeFromBlob` decodes an encoded WebM/Opus blob first (used for the
 * traditional, single-shot recording, which is a valid stream start to finish),
 * while `encodeFromPcm` takes raw 16-bit channels straight from the rolling
 * PCM tap (see `pcm-ring.ts`).
 */

export interface Encoded {
  bytes: Uint8Array;
  ext: RecordingFormat;
}

/** lamejs only accepts a fixed set of sample rates. */
const MP3_RATES = new Set([8000, 11025, 12000, 16000, 22050, 24000, 32000, 44100, 48000]);

export function clampMp3Kbps(kbps: number): number {
  const allowed = [96, 112, 128, 160, 192, 224, 256, 320];
  const target = Math.min(320, Math.max(128, Math.round(kbps)));
  return allowed.reduce((best, v) => (Math.abs(v - target) < Math.abs(best - target) ? v : best), 128);
}

export async function encodeFromBlob(
  blob: Blob,
  format: RecordingFormat,
  mp3Kbps: number,
): Promise<Encoded> {
  if (format === 'webm') {
    return { bytes: new Uint8Array(await blob.arrayBuffer()), ext: 'webm' };
  }
  const channels = await decodeToInt16(blob);
  return encodeFromPcm(channels.data, channels.sampleRate, format, mp3Kbps);
}

export function encodeFromPcm(
  channels: Int16Array[],
  sampleRate: number,
  format: RecordingFormat,
  mp3Kbps: number,
): Encoded {
  if (format === 'wav') {
    return { bytes: encodeWav(channels, sampleRate), ext: 'wav' };
  }
  if (format === 'mp3') {
    if (!MP3_RATES.has(sampleRate)) {
      throw new Error(
        `MP3 encoder can't use a ${sampleRate} Hz stream — try WAV, or set the output device to 44.1/48 kHz.`,
      );
    }
    return { bytes: encodeMp3(channels, sampleRate, clampMp3Kbps(mp3Kbps)), ext: 'mp3' };
  }
  throw new Error(`Unsupported format: ${format}`);
}

// ----- decode ---------------------------------------------------------------

async function decodeToInt16(blob: Blob): Promise<{ data: Int16Array[]; sampleRate: number }> {
  const AC: typeof AudioContext =
    window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new AC();
  try {
    const audio = await ctx.decodeAudioData(await blob.arrayBuffer());
    const chCount = Math.max(1, audio.numberOfChannels);
    const data: Int16Array[] = [];
    for (let c = 0; c < chCount; c++) {
      const src = audio.getChannelData(c);
      const dst = new Int16Array(src.length);
      for (let i = 0; i < src.length; i++) {
        let s = src[i];
        s = s < -1 ? -1 : s > 1 ? 1 : s;
        dst[i] = s < 0 ? (s * 0x8000) | 0 : (s * 0x7fff) | 0;
      }
      data.push(dst);
    }
    return { data, sampleRate: audio.sampleRate };
  } finally {
    void ctx.close();
  }
}

// ----- WAV -----------------------------------------------------------------

function encodeWav(channels: Int16Array[], sampleRate: number): Uint8Array {
  const numCh = channels.length;
  const frames = channels[0]?.length ?? 0;
  const blockAlign = numCh * 2;
  const dataSize = frames * blockAlign;
  const out = new ArrayBuffer(44 + dataSize);
  const view = new DataView(out);

  const str = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  };

  str(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, numCh, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  str(36, 'data');
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < numCh; c++) {
      view.setInt16(offset, channels[c][i], true);
      offset += 2;
    }
  }
  return new Uint8Array(out);
}

// ----- MP3 ---------------------------------------------------------------

function encodeMp3(channels: Int16Array[], sampleRate: number, kbps: number): Uint8Array {
  const numCh = Math.min(2, channels.length);
  const left = channels[0];
  const right = numCh > 1 ? channels[1] : undefined;
  const encoder = new Mp3Encoder(numCh, sampleRate, kbps);
  const blockSize = 1152;
  const parts: Uint8Array[] = [];

  for (let i = 0; i < left.length; i += blockSize) {
    const l = left.subarray(i, i + blockSize);
    const buf = right
      ? encoder.encodeBuffer(l, right.subarray(i, i + blockSize))
      : encoder.encodeBuffer(l);
    if (buf.length) parts.push(new Uint8Array(buf));
  }
  const tail = encoder.flush();
  if (tail.length) parts.push(new Uint8Array(tail));

  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}
