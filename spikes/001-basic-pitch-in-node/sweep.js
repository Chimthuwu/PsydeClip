/**
 * Spike 001b — is the note-count bloat (84 notes from 24 real ones) a tuning
 * problem, and how does runtime scale with clip length?
 *
 * tfjs-node is REJECTED: it fails node-pre-gyp build on Node 26 (and would
 * need an Electron ABI rebuild on top of that). Pure-JS tfjs is the only
 * dependency-free option, so its speed and thresholds are what matter.
 */
const fs = require('node:fs');
const path = require('node:path');
const tf = require('@tensorflow/tfjs');
const { BasicPitch, noteFramesToTime, addPitchBendsToNoteEvents, outputToNotesPoly } =
  require('@spotify/basic-pitch');

const SR = 44100;
const dir = path.join(__dirname, 'node_modules/@spotify/basic-pitch/model');

function fileSystemHandler(d) {
  return {
    load: async () => {
      const json = JSON.parse(fs.readFileSync(path.join(d, 'model.json'), 'utf8'));
      const specs = [];
      const datas = [];
      for (const g of json.weightsManifest) {
        for (const p of g.paths) {
          const b = fs.readFileSync(path.join(d, p));
          datas.push(new Uint8Array(b.buffer, b.byteOffset, b.byteLength));
        }
        specs.push(...g.weights);
      }
      let total = 0;
      for (const x of datas) total += x.byteLength;
      const wd = new Uint8Array(total);
      let off = 0;
      for (const x of datas) { wd.set(x, off); off += x.byteLength; }
      return {
        modelTopology: json.modelTopology,
        weightSpecs: specs.map((s) => (s.quantization ? s : { name: s.name, shape: s.shape, dtype: s.dtype })),
        weightData: wd.buffer,
        format: json.format,
      };
    },
  };
}

function resampleTo22k(input, from) {
  const MODEL_SR = 22050;
  if (from === MODEL_SR) return input;
  const ratio = from / MODEL_SR;
  const outLen = Math.floor(input.length / ratio);
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const pos = i * ratio;
    const i0 = Math.floor(pos);
    const i1 = Math.min(i0 + 1, input.length - 1);
    out[i] = input[i0] * (1 - (pos - i0)) + input[i1] * (pos - i0);
  }
  return out;
}

// Rebuild the same ground-truth signal from spike.js (self-contained).
function pluck(freq, dur) {
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
}
const m2f = (m) => 440 * Math.pow(2, (m - 69) / 12);
const BEAT = 0.6;
const BARS = [
  { chord: [48, 52, 55], beat: 0, mel: [60, 64, 67] },
  { chord: [50, 53, 57], beat: 4, mel: [57, 60, 64] },
  { chord: [53, 57, 60], beat: 8, mel: [60, 62, 65] },
  { chord: [48, 52, 55], beat: 12, mel: [64, 67, 72] },
];
function build(bars) {
  const total = bars * 4 * BEAT + 1.2;
  const track = new Float32Array(Math.ceil(total * SR));
  const exp = [];
  const mix = (f, st, d, g) => {
    const p = pluck(f, d);
    const off = Math.floor(st * SR);
    for (let i = 0; i < p.length; i++) if (off + i < track.length) track[off + i] += p[i] * g;
  };
  for (let b = 0; b < bars; b++) {
    const bar = BARS[b % 4];
    const base = b * 4;
    for (const c of bar.chord) mix(m2f(c), (base + bar.beat) * BEAT, 4 * BEAT, 0.16);
    bar.mel.forEach((m, i) => {
      const st = (base + bar.beat + i * (4 / 3)) * BEAT;
      mix(m2f(m), st, (4 / 3) * 0.95 * BEAT, 0.55);
      exp.push({ midi: m, startSec: st });
    });
  }
  let pk = 0;
  for (const s of track) pk = Math.max(pk, Math.abs(s));
  for (let i = 0; i < track.length; i++) track[i] = (track[i] / pk) * 0.89;
  return { track, exp, dur: total };
}

(async () => {
  await tf.ready();
  const model = await tf.loadGraphModel(fileSystemHandler(dir));
  const bp = new BasicPitch(model);

  async function transcribe(audio22k, onsetThresh, frameThresh, minLen) {
    const frames = [], onsets = [], contours = [];
    await bp.evaluateModel(audio22k, (f, o, c) => { frames.push(...f); onsets.push(...o); contours.push(...c); }, () => {});
    return noteFramesToTime(
      addPitchBendsToNoteEvents(contours, outputToNotesPoly(frames, onsets, onsetThresh, frameThresh, minLen)),
    );
  }

  const NOTE = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
  const nm = (m) => NOTE[m % 12] + (Math.floor(m / 12) - 1);

  // ---- 1. threshold sweep on the 4-bar reference --------------------------
  const { track, exp, dur } = build(4);
  const a22 = resampleTo22k(track, SR);
  const truth = 24; // 12 melody + 12 chord
  console.log('=== threshold sweep (4 bars, %s s, %d real notes)', dur.toFixed(1), truth);
  console.log('onset frame minLen |  notes  melodyHit  extra');
  for (const [ot, ft, ml] of [[0.25,0.25,5],[0.3,0.3,5],[0.4,0.4,5],[0.5,0.5,5],[0.5,0.3,11],[0.6,0.4,11],[0.7,0.5,11]]) {
    const notes = await transcribe(a22, ot, ft, ml);
    const expSet = new Set(exp.map((e) => `${e.midi}@${Math.round(e.startSec * 20)}`));
    const got = new Set(notes.map((n) => `${n.pitchMidi}@${Math.round(n.startTimeSeconds * 20)}`));
    let hits = 0;
    for (const k of expSet) if (got.has(k)) hits++;
    console.log(`   ${ot}      ${ft}      ${String(ml).padEnd(2)}   |  ${String(notes.length).padEnd(5)}  ${String(hits + '/' + exp.length).padEnd(9)}  ${notes.length - exp.length - hits + exp.length - exp.length}`);
  }

  // ---- 2. runtime scaling ------------------------------------------------
  console.log('\n=== runtime scaling (thresholds 0.5/0.5/11)');
  for (const bars of [4, 8, 16]) {
    const b = build(bars);
    const a = resampleTo22k(b.track, SR);
    const t = Date.now();
    const notes = await transcribe(a, 0.5, 0.5, 11);
    const ms = Date.now() - t;
    console.log(`  ${b.dur.toFixed(1)}s audio -> ${ms} ms  (${(b.dur / (ms / 1000)).toFixed(2)}x realtime, ${notes.length} notes)`);
  }

  console.log('\nSPIKE_001B_RESULT=OK');
})().catch((e) => { console.error('SPIKE_001B_RESULT=FAIL', e); process.exit(1); });
