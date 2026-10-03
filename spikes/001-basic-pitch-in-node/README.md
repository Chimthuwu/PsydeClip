# Spike 001 — can Basic Pitch transcribe inside Recordr?

**Question.** Given Recordr's audio at save time, can `@spotify/basic-pitch`
produce a usable `.mid` in pure Node/Electron — with no Python sidecar and no
native ABI rebuild — fast enough to be a feature rather than a curiosity?

**Verdict: PARTIAL.** Transcription quality and licensing are settled and good.
Runtime is the blocker for the headline use case (saving the whole rolling
buffer). See "What didn't work".

## Approach

`@spotify/basic-pitch@1.0.1` (Spotify, **Apache-2.0**) + plain
`@tensorflow/tfjs@3.21.0`. No `tfjs-node`, no ONNX runtime, no Python.

Input was a *synthetic* signal with known ground truth rather than a random
music file, so note accuracy is measurable rather than eyeballed: a 4-bar
progression (Cmaj / Dmin / Emin / Cmaj) at 100 BPM, each bar a sustained triad
plus a 3-note melody, rendered as a plucked-string voice (fundamental +
4 decaying harmonics, ADSR).

## What worked

* **Licence is clean.** Apache-2.0, not AGPL. Drop-in for the MIT app. This
  killed the biggest open question in `todo.md` §7 — NeuralNote was never a
  candidate, but Basic Pitch is, and it is the better-engineered option.
* **Model is small and already vendored**: 900 KB (`model.json` 175 KB +
  one 742 KB shard) inside the npm package. Nothing to download at first run.
* **Accuracy is genuinely good.** 12/12 melody notes recovered within 50 ms
  on the 4-bar reference, chords intact — chords do survive, which `todo.md`
  flagged as a requirement ("single-note output is not enough on its own").
* **The output is a real MIDI file.** 788 bytes written, re-parsed by
  `@tonejs/midi` with all notes intact. Not just in-memory note objects.
* **No native dependency at all**, so `electron-builder` packaging, code
  signing and cold start are unaffected. The whole engine is 3 JS deps.

## What didn't work

* **`@tensorflow/tfjs-node` is out.** `npm i` fails `node-pre-gyp` on Node 26
  (and would need an Electron ABI rebuild regardless). Rejected on evidence,
  not principle — this is what the "heavy runtime dependency" risk in `todo.md`
  was worried about, and it turns out to be avoidable.
* **Runtime is ~0.75× realtime and scales linearly** (measured, cpu backend):

  | audio | wall time | ratio |
  |-------|-----------|-------|
  | 10.8 s | 14.7 s | 0.74× |
  | 20.4 s | 27.4 s | 0.75× |
  | 39.6 s | 55.9 s | 0.71× |

  So the headline feature — "save the last 15 minutes and get a `.mid`" —
  would take **~20 minutes** of pure-JS CPU. Not shippable as a blocking step
  on save. Clips (10–60 s) are fine: 8–45 s.
* **Note bloat at default thresholds.** The library defaults (0.25/0.25/5)
  gave 46 notes for 24 real ones — octave ghosts and harmonics. Raising
  thresholds fixes it cleanly: 0.5/0.3/11 gave 23 notes against 24 real, and
  0.5/0.5/11 gave 22. Thresholds must be raised from the defaults; they are
  not tuned for synthesised/steady material and will want a real-music pass.

## Surprises (these cost the most time)

1. **tfjs cannot load a `file://` model in Node** — undici has no `file`
   scheme, so `tf.loadGraphModel('file://…')` dies with `fetch failed`. Fix:
   read `model.json` + weight shards off disk and pass a hand-rolled
   `IOHandler`. Chromium blocks `file://` fetch too, so the Electron renderer
   needs this as well — it is not a Node-only workaround.
2. **`weightData` must be a real `ArrayBuffer`, not a Node `Buffer` or typed
   array.** tfjs does `buffer.slice(...)` → `new Int32Array(slice)`, which
   copies *element-wise* for a typed array, so a 4-byte int32 weight arrives
   as 4 values and `makeTensor` throws the very unhelpful
   `shape [1] should have 1 values but has 4`. Cost an hour.
3. **`evaluateModel` only validates the sample rate on the `AudioBuffer`
   path.** Hand it a raw `Float32Array` (which is the natural thing to do) and
   it silently assumes 22050 Hz. Feeding 44100 Hz doubled every timestamp —
   notes on a 10.8 s file came back at 17–19 s, and the melody match collapsed
   from 12/12 to 1/12. Fix: always resample to 22050 before calling. This is
   the single most dangerous trap in the whole integration: it fails
   *silently and plausibly*.
4. **Never spread a weight spec and add `quantization`.** tfjs tests
   `'quantization' in spec`, so `{...s, quantization: undefined}` matches and
   then dereferences `undefined.dtype`.

## Caveat on the measurements

The **runtime scaling and note-bloat-vs-threshold trends are trustworthy**
(monotone, consistent across three lengths). The **exact melody-hit counts in
the threshold sweep are not** — that harness double-counts bar offsets when
rebuilding the ground truth, so its "extra notes" column is unreliable. The
12/12 figure comes from the first harness, which builds the signal correctly.
Re-derive the sweep numbers on a real music file before using them to pick
shipped defaults.

## Recommendation for the real build

Engine choice is settled — `@spotify/basic-pitch` + pure tfjs, Apache-2.0,
vendored model, three JS deps. Package it as an `extraResource` and load it
through the `IOHandler` above.

The remaining design question is **when transcription runs**, and it is a
product decision, not an engineering one:

* **Clip-length only, synchronous** — correct and simple, but leaves the
  signature "save 15 min → get MIDI" unimplemented.
* **Background worker, chunked** — run it off the save path in a
  `worker_threads` worker so the UI and recorder never block, and write the
  `.mid` next to the audio when it lands. Makes long buffers viable in
  principle, but a 15-min clip still costs ~20 min of one CPU core.
* **WebGL backend in the renderer** — the untested lever with the most upside.
  tfjs's `webgl` backend should be far faster than `cpu`, but the renderer is
  also the UI thread, so it would need its own worker/offscreen context.
  **This is the first thing to measure next**; it may dissolve the speed
  problem outright.

Recommended: build the transcription module + a "transcribe this clip" action
first (proves the whole pipeline end to end), then measure WebGL before
committing to any long-buffer behaviour.
