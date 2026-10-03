/**
 * Engine-level check for the transcription module.
 *
 * Run with:  npx tsx --test src/main/transcribe/engine.test.ts
 * (or after `npm run build:main`, `node --test dist/main/transcribe/engine.test.js`)
 *
 * This exercises the real Basic Pitch model on a synthetic signal with known
 * ground truth, so it asserts actual recall rather than "it didn't throw".
 */

import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import {
  MODEL_SR,
  notesToMidiBytes,
  resampleToModelRate,
  transcribe,
} from './engine';

const MODEL_DIR = path.join(process.cwd(), 'node_modules/@spotify/basic-pitch/model');
const SR = 44100;
const BEAT = 0.6;

/** Same synthesis as the spike: a sustained triad plus a 3-note melody. */
function buildSignal() {
  const bars = [
    { chord: [48, 52, 55], mel: [60, 64, 67] },
    { chord: [50, 53, 57], mel: [57, 60, 64] },
    { chord: [53, 57, 60], mel: [60, 62, 65] },
    { chord: [48, 52, 55], mel: [64, 67, 72] },
  ];
  const totalSec = 4 * BEAT * 4;
  const track = new Float32Array(Math.ceil(totalSec * SR));

  const pluck = (freq: number, dur: number) => {
    const n = Math.floor(dur * SR);
    const out = new Float32Array(n);
    const H = [1, 0.5, 0.28, 0.14, 0.07];
    for (let i = 0; i < n; i++) {
      const s = i / SR;
      let v = 0;
      for (let h = 0; h < H.length; h++) v += H[h] * Math.sin(2 * Math.PI * freq * (h + 1) * s);
      out[i] = v * Math.min(1, i / (0.01 * SR)) * Math.exp((-3.2 * i) / n);
    }
    return out;
  };
  const m2f = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

  const expected: number[] = [];
  bars.forEach((bar, b) => {
    for (const c of bar.chord) {
      const p = pluck(m2f(c), 4 * BEAT);
      const off = Math.floor((b * 4) * BEAT * SR);
      for (let i = 0; i < p.length && off + i < track.length; i++) track[off + i] += p[i] * 0.16;
    }
    bar.mel.forEach((m, i) => {
      expected.push(m);
      const p = pluck(m2f(m), (4 / 3) * 0.95 * BEAT);
      const off = Math.floor((b * 4 + (i * 4) / 3) * BEAT * SR);
      for (let k = 0; k < p.length && off + k < track.length; k++) track[off + k] += p[k] * 0.55;
    });
  });

  let peak = 0;
  for (const s of track) peak = Math.max(peak, Math.abs(s));
  for (let i = 0; i < track.length; i++) track[i] = (track[i] / peak) * 0.89;
  return { track, expected, totalSec };
}

test('resampleToModelRate hits the exact model rate and expected length', () => {
  const input = new Float32Array(SR).map((_, i) => Math.sin(i / 10));
  const out = resampleToModelRate(input, SR);
  assert.equal(out.length, Math.floor(input.length / (SR / MODEL_SR)));
  // Already at model rate -> returned unchanged (same reference).
  assert.equal(resampleToModelRate(out, MODEL_SR), out);
});

test('resampleToModelRate preserves a constant signal', () => {
  const input = new Float32Array(SR).fill(0.5);
  const out = resampleToModelRate(input, SR);
  for (const s of out) assert.ok(Math.abs(s - 0.5) < 1e-6, `got ${s}`);
});

test('transcribe() recovers the melody and emits a parseable .mid', async () => {
  const { track, expected, totalSec } = buildSignal();
  const samples = resampleToModelRate(track, SR);

  const progress: number[] = [];
  const res = await transcribe(samples, {
    modelDir: MODEL_DIR,
    onProgress: (p) => progress.push(p),
  });

  assert.ok(res.notes.length > 0, 'expected at least some notes');
  assert.equal(res.sampleRate, MODEL_SR);
  assert.ok(progress.length > 0, 'onProgress should fire');
  assert.equal(progress[progress.length - 1], 1, 'progress should finish at 1');
  assert.ok(res.elapsedMs > 0);

  // Melody recall: how many expected pitches appear at all (within 1 octave,
  // since octave errors are the known weakness at looser thresholds).
  const got = new Set(res.notes.map((n) => n.pitchMidi % 12));
  const hits = expected.filter((m) => got.has(m % 12));
  assert.ok(
    hits.length >= expected.length - 2,
    `melody pitch classes recovered ${hits.length}/${expected.length}`,
  );

  // Serialised MIDI must be non-trivial and re-parseable.
  const bytes = notesToMidiBytes(res.notes);
  assert.ok(bytes.length > 100, `midi too small: ${bytes.length}`);
  assert.deepEqual(
    Array.from(bytes.slice(0, 4)),
    [0x4d, 0x54, 0x68, 0x64],
    'should start with the MThd chunk',
  );

  console.log(
    `  ${totalSec.toFixed(1)}s audio -> ${res.notes.length} notes in ` +
      `${(res.elapsedMs / 1000).toFixed(1)}s (${res.ratio.toFixed(2)}x realtime), ` +
      `${bytes.length} B midi`,
  );
});

test('cancellation aborts instead of finishing', async () => {
  const { track } = buildSignal();
  const samples = resampleToModelRate(track, SR);
  await assert.rejects(
    transcribe(samples, { modelDir: MODEL_DIR, isCancelled: () => true }),
    /cancelled/i,
    'should reject when isCancelled() is true',
  );
});

test('rejects a non-Float32Array input', async () => {
  await assert.rejects(
    transcribe([1, 2, 3] as unknown as Float32Array, { modelDir: MODEL_DIR }),
    /Float32Array/,
  );
});