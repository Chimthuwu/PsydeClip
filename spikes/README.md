# Spikes

Throwaway feasibility checks. Each dir answers ONE question with real
execution output. Delete a spike once it has paid its debt — nothing here ships.

| Spike | Question | Status |
|-------|----------|--------|
| `001-basic-pitch-in-node` | Can `@spotify/basic-pitch` transcribe a real audio buffer to a `.mid` in pure Node (no Python, no tfjs-node native rebuild), and how fast / how big is the model? | **PARTIAL** — engine settled, runtime is the blocker |
| `002-tfjs-backend-bench` | Is the tfjs `webgl` backend fast enough to carry long buffers (the one lever that could fix 001's runtime)? | **INVALIDATED** — slower than CPU *and* untrustworthy run-to-run |

`001/spike.js` and `001/sweep.js` expect to be run from the repo root with
`npm i @spotify/basic-pitch@1.0.1`; they read the model out of
`node_modules/@spotify/basic-pitch/model`.

Recordr's audio → MIDI feature is gated on this: if the engine cannot run in
the Electron main process without dragging in a native ABI rebuild or a Python
sidecar, the packaging story (electron-builder, code signing, cold start)
changes materially and the feature needs a different design.

**Answer:** it runs, the licence is Apache-2.0 (clean for the MIT app), the
model is 900 KB and vendored, and transcription is accurate (12/12 melody notes,
chords intact). But it runs at **~0.75× realtime** on the pure-JS cpu backend,
so a 15-minute buffer would take ~20 minutes. `tfjs-node` would fix that and is
**rejected on evidence** — it fails `node-pre-gyp` on Node 26. Next lever to
measure: tfjs's `webgl` backend in the renderer.

Also note the three silent-failure traps documented in the spike README — most
dangerously, `evaluateModel` skips its sample-rate check when handed a raw
`Float32Array`, which doubles every timestamp and looks like plausible output.
