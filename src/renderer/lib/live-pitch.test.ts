/**
 * Tests for the live pitch tracker (todo.md §MIDI-1 Phase B). Run: npm test
 *
 * The unit that matters is the pitch estimate itself: a grid fed by a wrong f0
 * draws a plausible-looking but wrong melody, and nothing downstream can tell.
 * So these synthesise tones at known frequencies and assert the estimate comes
 * back inside a semitone or two — the resolution a piano-roll grid can draw.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DEFAULT_YIN,
  LiveNoteTracker,
  detectPitch,
  hzToMidi,
  prepareFrame,
} from './live-pitch';

const SR = 44100;

/** A sustained tone with a soft attack, long enough to cover the YIN window. */
function tone(hz: number, ms = 120, sampleRate = SR, harmonics = 0): Float32Array {
  const n = Math.floor((ms / 1000) * sampleRate);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    const env = Math.min(1, t / 0.005);
    let v = Math.sin(2 * Math.PI * hz * t);
    if (harmonics) v += 0.5 * Math.sin(2 * Math.PI * hz * 2 * t);
    out[i] = env * v * 0.4;
  }
  return out;
}

/** DC offset plus noise, i.e. what a badly-set capture device hands over. */
function dirty(hz: number, opts: { dc?: number; noise?: number } = {}): Float32Array {
  const base = tone(hz, 140);
  const out = new Float32Array(base.length);
  for (let i = 0; i < base.length; i++) {
    out[i] = base[i] + (opts.dc ?? 0) + (opts.noise ?? 0) * (Math.random() * 2 - 1);
  }
  return out;
}

/** Detect on one window, returning the MIDI note or null. */
function detectMidi(frame: Float32Array, sampleRate = SR): number | null {
  const x = new Float32Array(DEFAULT_YIN.window + DEFAULT_YIN.maxLag);
  const diff = new Float32Array(DEFAULT_YIN.maxLag + 2);
  if (prepareFrame(frame, x) < 0.006) return null;
  const est = detectPitch(x, sampleRate, diff, DEFAULT_YIN);
  return est ? hzToMidi(est.hz) : null;
}

test('estimates a plain tone within a semitone across the vocal range', () => {
  // A440 = 69, A3 = 57, A5 = 81.
  for (const [hz, expect] of [
    [220, 57],
    [440, 69],
    [880, 81],
  ] as const) {
    const midi = detectMidi(tone(hz));
    assert.ok(midi !== null, `no pitch for ${hz} Hz`);
    assert.ok(Math.abs(midi - expect) <= 1, `${hz} Hz read as MIDI ${midi}, wanted ~${expect}`);
  }
});

test('a tone with a harmonic on top still reads its fundamental', () => {
  // The common octave-error case: a bright timbre with a strong 2nd harmonic.
  const midi = detectMidi(tone(220, 140, SR, 1));
  assert.equal(midi, 57);
});

test('DC offset does not shift the pitch', () => {
  const midi = detectMidi(dirty(440, { dc: 0.3, noise: 0.01 }));
  assert.ok(midi !== null);
  assert.ok(Math.abs(midi - 69) <= 1, `read as MIDI ${midi}, wanted ~69`);
});

test('silence and noise produce no pitch rather than a confident wrong one', () => {
  assert.equal(detectMidi(new Float32Array(2048)), null);
  const hiss = new Float32Array(2048);
  for (let i = 0; i < hiss.length; i++) hiss[i] = 0.3 * (Math.random() * 2 - 1);
  assert.equal(detectMidi(hiss), null);
});

test('hzToMidi only reports a usable musical range', () => {
  assert.equal(hzToMidi(440), 69);
  assert.equal(hzToMidi(30), null, 'below the lowest reported note');
  assert.equal(hzToMidi(5000), null, 'above the highest reported note');
  assert.equal(hzToMidi(0), null);
});

test('a frame too short to analyse returns null instead of guessing', () => {
  const x = new Float32Array(64).fill(0.3);
  const diff = new Float32Array(DEFAULT_YIN.maxLag + 2);
  assert.equal(detectPitch(x, SR, diff, DEFAULT_YIN), null);
  assert.equal(detectPitch(new Float32Array(2048), 0, diff, DEFAULT_YIN), null);
});

test('a descending melody becomes one note per step, in time order', () => {
  const tracker = new LiveNoteTracker({ sampleRate: SR });
  const hop = 2048 / SR;
  // C5 (72), A4 (69), F4 (65), each held long enough to read and to close.
  const melody: [number, number][] = [
    [523.25, 0.35],
    [440, 0.35],
    [349.23, 0.35],
  ];
  let at = 0;
  for (const [hz, holdSec] of melody) {
    const frame = tone(hz, holdSec * 1000);
    const step = 512;
    for (let off = 0; off + DEFAULT_YIN.window + DEFAULT_YIN.maxLag < frame.length; off += step) {
      tracker.push(frame.subarray(off, off + 2048), at + off / SR);
    }
    at += holdSec;
    tracker.push(frame.subarray(frame.length - 2048), at); // a silent edge closes it
  }
  tracker.finish(at);

  const got = tracker.notes.map((n) => n.pitch);
  assert.deepEqual(got, [72, 69, 65]);
  // Absolute session seconds, so bars line up with the History waveform.
  assert.ok(tracker.notes[0].startSec >= 0 && tracker.notes[0].startSec < 0.1);
  assert.ok(tracker.notes[2].startSec > tracker.notes[1].startSec);
  for (const n of tracker.notes) assert.ok(n.durationSec > 0);
});

test('a held note does not fragment into repeats', () => {
  const tracker = new LiveNoteTracker({ sampleRate: SR });
  const frame = tone(440, 900);
  for (let at = 0; at < 0.85; at += 2048 / SR) {
    tracker.push(frame.subarray(0, 2048), at);
  }
  tracker.finish(0.9);
  assert.equal(tracker.noteCount, 1, `got ${JSON.stringify(tracker.notes)}`);
  assert.equal(tracker.notes[0].pitch, 69);
});

test('silence closes an open note and a restart begins a new one', () => {
  const tracker = new LiveNoteTracker({ sampleRate: SR });
  const quiet = new Float32Array(2048);
  const note = tone(440, 300);

  tracker.push(note.subarray(0, 2048), 0);
  assert.ok(tracker.hasOpenNote);
  // Past noteGapSec of silence: the note is closed and parked in `notes`.
  tracker.push(quiet, 0.5);
  assert.equal(tracker.hasOpenNote, false);
  assert.equal(tracker.noteCount, 1);

  tracker.push(note.subarray(0, 2048), 1.0);
  assert.ok(tracker.hasOpenNote);
  tracker.finish(1.2);
  assert.equal(tracker.noteCount, 2);
  // The gap between the two notes is real, not smeared.
  assert.ok(tracker.notes[1].startSec - tracker.notes[0].startSec > 0.5);
});

test('blips shorter than minNoteSec are dropped as noise', () => {
  const tracker = new LiveNoteTracker({ sampleRate: SR, minNoteSec: 0.1 });
  const trackerNote = tone(440, 40);
  tracker.push(trackerNote.subarray(0, 2048), 0);
  tracker.finish(0.04);
  assert.equal(tracker.noteCount, 0);
});

test('the note list is bounded and drops the oldest first', () => {
  const tracker = new LiveNoteTracker({ sampleRate: SR, maxNotes: 4, minNoteSec: 0 });
  const note = tone(440, 200);
  let at = 0;
  for (let i = 0; i < 10; i++) {
    // A semitone step each time, so every frame opens a fresh note.
    tracker.push(tone(440 + i * 10, 200).subarray(0, 2048), at);
    tracker.finish(at + 0.2);
    at += 0.3;
  }
  tracker.finish(at);
  assert.equal(tracker.noteCount, 4, 'list must stay bounded');
  assert.ok(Math.max(...tracker.notes.map((n) => n.startSec)) > 2, 'newest notes kept');
});

test('reset clears both the list and the open note', () => {
  const tracker = new LiveNoteTracker({ sampleRate: SR });
  tracker.push(tone(440, 200).subarray(0, 2048), 0);
  tracker.reset();
  assert.equal(tracker.noteCount, 0);
  assert.equal(tracker.hasOpenNote, false);
  assert.equal(tracker.lastSec, 0);
});

test('a tracking loop over many frames stays inside its time budget', () => {
  // The whole point of using YIN instead of Basic Pitch is that this is cheap.
  // A generous bound: on any normal machine one frame costs well under a
  // millisecond, and a slow CI box should not fail the suite over it.
  const tracker = new LiveNoteTracker({ sampleRate: SR });
  const voiced = tone(220, 500);
  const silent = new Float32Array(2048);
  const frames = 400;
  const started = performance.now();
  for (let i = 0; i < frames; i++) {
    tracker.push(i % 2 ? voiced.subarray(0, 2048) : silent, i * 0.01);
  }
  const perFrameMs = (performance.now() - started) / frames;
  assert.ok(perFrameMs < 5, `${perFrameMs.toFixed(3)} ms/frame is too slow`);
});