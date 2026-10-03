/**
 * Integration check for the worker + pool: spawns the REAL worker thread and
 * drives a real transcription to completion, then checks the .mid landed on
 * disk beside the audio.
 *
 * Run: node --test dist/main/transcribe/pool.test.js
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import {
  cancelTranscription,
  jobState,
  midiPathFor,
  pruneJobs,
  shutdown,
  startTranscription,
} from './pool';

const SR = 44100;
const MODEL_DIR = path.join(process.cwd(), 'node_modules/@spotify/basic-pitch/model');

function buildSignal(sec = 4) {
  const n = Math.floor(sec * SR);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    // A simple A-major triad, plucked, so the model has real pitch content.
    const env = Math.exp(-2.5 * (t % 1));
    out[i] =
      env *
      0.3 *
      (Math.sin(2 * Math.PI * 220 * t) +
        Math.sin(2 * Math.PI * 277.18 * t) +
        Math.sin(2 * Math.PI * 329.63 * t));
  }
  let peak = 0;
  for (const s of out) peak = Math.max(peak, Math.abs(s));
  for (let i = 0; i < n; i++) out[i] = (out[i] / peak) * 0.89;
  return out;
}

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'recordr-midi-test-'));
}

after(() => shutdown());

test('midiPathFor swaps the extension, keeping the stem', () => {
  assert.equal(
    midiPathFor(path.join('C:', 'clips', 'My Take 03.wav')),
    path.join('C:', 'clips', 'My Take 03.mid'),
  );
  assert.equal(midiPathFor('/a/b/c.webm'), path.join('/a/b', 'c.mid'));
});

test('a real job transcribes and writes a .mid beside the audio', async () => {
  const dir = tmpDir();
  // Pretend the audio was already saved; transcription must not touch it.
  const audioPath = path.join(dir, 'take.wav');
  fs.writeFileSync(audioPath, 'not really a wav');

  const jobId = 'job-ok';
  const initial = startTranscription({
    jobId,
    samples: buildSignal(4),
    sampleRate: SR,
    audioPath,
  });

  assert.equal(initial.status, 'running');
  assert.equal(initial.midiPath, path.join(dir, 'take.mid'));

  const state = await new Promise<NonNullable<ReturnType<typeof jobState>>>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timed out waiting for job')), 180000);
    const tick = setInterval(() => {
      const s = jobState(jobId);
      if (s && s.status !== 'running') {
        clearInterval(tick);
        clearTimeout(timer);
        resolve(s);
      }
    }, 100);
  });

  assert.equal(state.status, 'done', `job failed: ${state.error}`);
  assert.ok((state.noteCount ?? 0) > 0, 'expected some notes');
  assert.equal(state.fraction, 1);

  // The .mid exists and is a real MIDI file.
  assert.ok(fs.existsSync(state.midiPath), 'expected a .mid on disk');
  const head = [...fs.readFileSync(state.midiPath).subarray(0, 4)];
  assert.deepEqual(head, [0x4d, 0x54, 0x68, 0x64], 'should be an MThd chunk');

  // The audio file must be untouched.
  assert.equal(fs.readFileSync(audioPath, 'utf8'), 'not really a wav');

  console.log(
    `  ${(state.noteCount ?? 0)} notes, ${((state.elapsedMs ?? 0) / 1000).toFixed(1)}s, ` +
      `${((state.ratio ?? 0)).toFixed(2)}x realtime -> ${path.basename(state.midiPath)}`,
  );
  pruneJobs();
});

test('cancelling a running job actually stops it', async () => {
  const dir = tmpDir();
  const audioPath = path.join(dir, 'cancel.wav');
  const jobId = 'job-cancel';

  // 40s of audio costs ~55s to infer. Cancelling must settle in a couple of
  // seconds — the earlier message-based cancel returned true and then let the
  // job run the full distance, so "settles at all" is not a sufficient
  // assertion. This is the check that catches that class of bug.
  startTranscription({ jobId, samples: buildSignal(40), sampleRate: SR, audioPath });
  await new Promise((r) => setTimeout(r, 2500));
  assert.equal(cancelTranscription(jobId), true);
  // A second cancel on a non-running job must be a harmless no-op.
  assert.equal(typeof cancelTranscription('nope'), 'boolean');

  const cancelAt = Date.now();
  const state = await new Promise<NonNullable<ReturnType<typeof jobState>>>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timed out')), 180000);
    const tick = setInterval(() => {
      const s = jobState(jobId);
      if (s && s.status !== 'running') {
        clearInterval(tick);
        clearTimeout(timer);
        resolve(s);
      }
    }, 100);
  });
  const elapsed = Date.now() - cancelAt;

  assert.equal(state.status, 'cancelled', `expected cancelled, got ${state.status}`);
  assert.ok(elapsed < 8000, `cancel took ${(elapsed / 1000).toFixed(1)}s — it did not interrupt`);
  assert.ok(!fs.existsSync(state.midiPath), 'a cancelled job must not write a .mid');
  console.log(`  cancelled ${(elapsed / 1000).toFixed(1)}s after the request`);
});