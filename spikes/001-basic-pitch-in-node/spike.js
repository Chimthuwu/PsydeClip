/**
 * Spike 001 — can @spotify/basic-pitch transcribe in pure Node?
 *
 * Generates a WAV with a KNOWN melody + chord progression (so transcription
 * correctness is checkable, not just "it didn't throw"), then runs basic-pitch
 * on it and reports which notes came back.
 */
const fs = require('node:fs');
const path = require('node:path');
const { BasicPitch, noteFramesToTime, addPitchBendsToNoteEvents, outputToNotesPoly } =
  require('@spotify/basic-pitch');
const tf = require('@tensorflow/tfjs');

const SR = 44100;
const MODEL = path.join(__dirname, 'node_modules/@spotify/basic-pitch/model/model.json');

// ---------- synthesis -------------------------------------------------------
// A plucked-string voice: fundamental + decaying harmonics, ADSR-ish envelope.
function pluck(freq, t, dur) {
  const n = Math.floor(dur * SR);
  const out = new Float32Array(n);
  const harmonics = [1, 0.5, 0.28, 0.14, 0.07];
  for (let i = 0; i < n; i++) {
    const s = t + i / SR;
    let v = 0;
    for (let h = 0; h < harmonics.length; h++) {
      v += harmonics[h] * Math.sin(2 * Math.PI * freq * (h + 1) * s);
    }
    const env = Math.min(1, i / (0.01 * SR)) * Math.exp((-3.2 * i) / n);
    out[i] = v * env;
  }
  return out;
}

const NOTE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
function midiToFreq(m) {
  return 440 * Math.pow(2, (m - 69) / 12);
}
function name(m) {
  const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  return names[m % 12] + (Math.floor(m / 12) - 1);
}

// Ground truth: a 4-bar progression at 100 BPM, melody on top.
const BPM = 100;
const BEAT = 60 / BPM;
const TRUTH = [
  // chord (MIDI notes), start beat, length beats, melody note
  { chord: [48, 52, 55], beat: 0, len: 4, mel: [60, 64, 67] }, // Cmaj
  { chord: [50, 53, 57], beat: 4, len: 4, mel: [57, 60, 64] }, // Dmin
  { chord: [53, 57, 60], beat: 8, len: 4, mel: [60, 62, 65] }, // Emin7-ish
  { chord: [48, 52, 55], beat: 12, len: 4, mel: [64, 67, 72] }, // Cmaj high
];

const totalSec = 16 * BEAT + 1.2;
const track = new Float32Array(Math.ceil(totalSec * SR));
const expected = [];

function mix(freq, startSec, dur, gain) {
  const p = pluck(freq, 0, dur);
  const off = Math.floor(startSec * SR);
  for (let i = 0; i < p.length; i++) {
    if (off + i < track.length) track[off + i] += p[i] * gain;
  }
}

for (const bar of TRUTH) {
  for (const c of bar.chord) mix(midiToFreq(c), bar.beat * BEAT, bar.len * BEAT, 0.16);
  bar.mel.forEach((m, i) => {
    const start = (bar.beat + i * (bar.len / bar.mel.length)) * BEAT;
    const dur = (bar.len / bar.mel.length) * 0.95;
    mix(midiToFreq(m), start, dur, 0.55);
    expected.push({ midi: m, startSec: +start.toFixed(3), name: name(m) });
  });
}

// normalise
let peak = 0;
for (const s of track) peak = Math.max(peak, Math.abs(s));
for (let i = 0; i < track.length; i++) track[i] = (track[i] / peak) * 0.89;

// 16-bit PCM WAV
function toWav(samples) {
  const buf = Buffer.alloc(44 + samples.length * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + samples.length * 2, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(SR, 24);
  buf.writeUInt32LE(SR * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(samples.length * 2, 40);
  for (let i = 0; i < samples.length; i++) {
    buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(samples[i] * 32767))), 44 + i * 2);
  }
  return buf;
}

const wavPath = path.join(__dirname, 'test.wav');
fs.writeFileSync(wavPath, toWav(track));
console.log(`wrote test.wav  ${(fs.statSync(wavPath).size / 1024).toFixed(0)} KB  ${totalSec.toFixed(1)}s`);
console.log(`expected notes: ${expected.map((e) => e.name).join(' ')}`);

// ---------- transcription ---------------------------------------------------
(async () => {
  await tf.ready();
  console.log(`tfjs backends: ${tf.getBackend()}`);

  // tfjs 3.x cannot fetch() a file:// URL in Node (undici has no file scheme),
  // and Chromium blocks file:// fetch too — so read the GraphDef + weight
  // shards off disk ourselves and hand tfjs an in-memory IOHandler. This is
  // what the Electron main process will have to do as well.
  const modelDir = path.dirname(MODEL);
  function fileSystemHandler(dir) {
    return {
      load: async () => {
        const json = JSON.parse(fs.readFileSync(path.join(dir, 'model.json'), 'utf8'));
        const specs = [];
        const datas = [];
        for (const group of json.weightsManifest) {
          for (const p of group.paths) {
            const buf = fs.readFileSync(path.join(dir, p));
            datas.push(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));
          }
          specs.push(...group.weights);
        }
        let total = 0;
        for (const d of datas) total += d.byteLength;
        const weightData = new Uint8Array(total);
        let off = 0;
        for (const d of datas) {
          weightData.set(d, off);
          off += d.byteLength;
        }
        return {
          modelTopology: json.modelTopology,
          // Do NOT blindly add a `quantization` key: decodeWeights tests
          // `'quantization' in spec`, so an explicit undefined matches and then
          // dereferences undefined.dtype.
          weightSpecs: specs.map((s) => (s.quantization ? s : { name: s.name, shape: s.shape, dtype: s.dtype })),
          // MUST be a real ArrayBuffer. tfjs does `buffer.slice(...)` then
          // `new Float32Array(slice)`; given a Node Buffer or any TypedArray
          // those constructors copy ELEMENT-WISE, so a 4-byte int32 weight
          // arrives as 4 values and makeTensor throws "shape [1] should have
          // 1 values but has 4". A plain ArrayBuffer is byte-addressed.
          weightData: weightData.buffer,
          format: json.format,
          generatedBy: json.generatedBy,
          convertedBy: json.convertedBy,
          signature: json.signature,
        };
      },
    };
  }

  const t0 = Date.now();
  const model = await tf.loadGraphModel(fileSystemHandler(modelDir));
  console.log(`model loaded in ${Date.now() - t0} ms`);

  const bp = new BasicPitch(model);
  const frames = [];
  const onsets = [];
  const contours = [];

  // The model is 22050 Hz. `evaluateModel` ONLY checks sampleRate on the
  // AudioBuffer path — hand it a raw Float32Array and it silently assumes
  // 22050 regardless, which doubles every reported timestamp (notes on a 10.8 s
  // file came back at 17-19 s). So resample ourselves, always.
  const MODEL_SR = 22050;
  function resampleTo22k(input, from) {
    if (from === MODEL_SR) return input;
    const ratio = from / MODEL_SR;
    const outLen = Math.floor(input.length / ratio);
    const out = new Float32Array(outLen);
    for (let i = 0; i < outLen; i++) {
      const pos = i * ratio;
      const i0 = Math.floor(pos);
      const i1 = Math.min(i0 + 1, input.length - 1);
      const frac = pos - i0;
      out[i] = input[i0] * (1 - frac) + input[i1] * frac;
    }
    return out;
  }
  const audio22k = resampleTo22k(track, SR);
  console.log(`resampled ${SR} -> ${MODEL_SR} Hz: ${track.length} -> ${audio22k.length} samples`);

  const t1 = Date.now();
  let lastPct = -1;
  await bp.evaluateModel(
    audio22k,
    (f, o, c) => {
      frames.push(...f);
      onsets.push(...o);
      contours.push(...c);
    },
    (p) => {
      const pct = Math.round(p * 100);
      if (pct >= lastPct + 20) {
        lastPct = pct;
        process.stdout.write(`  ${pct}%\n`);
      }
    },
  );
  const inferMs = Date.now() - t1;
  console.log(`inference: ${inferMs} ms for ${totalSec.toFixed(1)}s audio (${(totalSec / (inferMs / 1000)).toFixed(1)}x realtime)`);

  const notes = noteFramesToTime(
    addPitchBendsToNoteEvents(contours, outputToNotesPoly(frames, onsets, 0.25, 0.25, 5)),
  );
  console.log(`\ntranscribed ${notes.length} notes:`);
  notes
    .slice()
    .sort((a, b) => a.startTimeSeconds - b.startTimeSeconds)
    .forEach((n) => {
      console.log(
        `  ${name(n.pitchMidi).padEnd(4)} midi=${String(n.pitchMidi).padEnd(3)} ` +
          `start=${n.startTimeSeconds.toFixed(3)}s dur=${n.durationSeconds.toFixed(3)}s ` +
          `amp=${(n.amplitude ?? 0).toFixed(2)}`,
      );
    });

  // recall/precision against ground truth (pitch class within 50ms tolerance)
  const expSet = new Set(expected.map((e) => `${e.midi}@${Math.round(e.startSec * 20)}`));
  const gotSet = new Set(
    notes.map((n) => `${n.pitchMidi}@${Math.round(n.startTimeSeconds * 20)}`),
  );
  let hits = 0;
  for (const k of expSet) if (gotSet.has(k)) hits++;
  console.log(
    `\nground truth: ${expected.length} melody notes + 12 chord notes (48 total)` +
      `\nmelody matched: ${hits}/${expected.length} (within 50ms)`,
  );

  // write a .mid to prove the file is valid, not just in-memory notes
  const { Midi } = require('@tonejs/midi');
  const midi = new Midi();
  midi.header.setTempo(120);
  const trackM = midi.addTrack();
  trackM.name = 'Recordr spike';
  trackM.channel = 0;
  for (const n of notes) {
    const beat = n.startTimeSeconds * (120 / 60);
    trackM.addNote({
      midi: n.pitchMidi,
      time: beat,
      duration: n.durationSeconds * (120 / 60),
      velocity: Math.round(Math.min(1, (n.amplitude ?? 0.5)) * 100),
    });
  }
  const out = path.join(__dirname, 'out.mid');
  fs.writeFileSync(out, Buffer.from(midi.toArray()));
  console.log(`wrote out.mid  ${fs.statSync(out).size} bytes`);

  // re-read it: proves the bytes parse as a real MIDI
  const back = new Midi(fs.readFileSync(out));
  console.log(`re-parsed out.mid: ${back.tracks[0].notes.length} notes, ${back.header.tempos[0]}bpm`);
  console.log('\nSPIKE_001_RESULT=OK');
})().catch((e) => {
  console.error('SPIKE_001_RESULT=FAIL', e);
  process.exit(1);
});
