# Spike 002 — is the tfjs `webgl` backend a usable engine backend for Recordr?

**Question.** CPU inference is ~0.75× realtime, so a 15-minute buffer takes
~20 minutes. `webgl` is the one lever that could change that. Does it?

**Verdict: NO — rejected on measurement, and the reason is worse than "slow".**
`webgl` did not produce a usable speedup; it produced *unreliable* results.

## Method

Same synthetic signal and same three clip lengths as spike 001, so the numbers
are directly comparable. Served over a local HTTP origin (the model must be
fetched — `file://` does not work). Backend selected with
`tf.setBackend(...)` **before** `tf.ready()`, since a bound backend stays bound
for the page's lifetime.

Host GPU was verified as real, not software rasterisation:
`ANGLE (AMD Radeon RX 6600, Direct3D11 vs_5_0)`.

## What worked

* **The harness is trustworthy.** `cpu` in-browser reproduced spike 001's
  Node numbers almost exactly — 0.75× / 0.76× vs Node's 0.74× / 0.75× — and
  produced **identical note counts** (22 and 45 for the raised 0.5/0.5/11
  thresholds). So the browser harness and the Node spike are measuring the same
  thing, and any WebGL-vs-CPU difference here is real, not a harness artefact.
* WebGL *binds* cleanly (`setBackend('webgl')` succeeds, no fallback).

## What didn't work

**WebGL is slower than CPU, and wildly inconsistent run to run.** Same input,
same machine, same page, three separate executions:

| run | 10.8 s clip | 20.4 s clip |
|-----|-------------|-------------|
| 1 | 28747 ms (**0.38×**) | did not finish — **browser daemon died** |
| 2 | 8226 ms (**1.31×**) | 736 ms (**27.74×**) |

Three problems, in increasing order of severity:

1. **Run 1 was ~2× slower than CPU.** The GPU path is not merely failing to
   help, it can be a large regression — plausible for a model this small, where
   per-op shader dispatch and readback overhead dominate the arithmetic.
2. **27.74× is not credible.** Same audio, same thresholds, and the note counts
   were identical (22 / 45) — so it produced correct output — but 736 ms for
   20.4 s of audio is ~28× realtime on a consumer GPU for a model that takes
   14 s on CPU. The most likely explanation is that WebGL work is being queued
   asynchronously and not actually awaited, so the timing measures submission,
   not completion. **That means a WebGL number here cannot be trusted even when
   it looks good**, which is the real problem.
3. **The run with the longest clip killed the browser.** The 39.6 s WebGL run
   took the harness daemon down (`no close frame received or sent`, then a
   `WinError 5` on the daemon's port file). Not reproduced in the shorter runs,
   so the cause is not established — but a backend that can take out the
   process on a 40-second input is disqualifying for an app that must never
   interrupt an in-progress recording.

## Recommendation for the real build

**Abandon `webgl`. Do not revisit without a timing harness that forces a real
GPU sync** (`gl.finish()` / a readback of one output element after inference)
so the number measures completion rather than submission. Without that, any
WebGL result — good or bad — is uninterpretable.

This resolves the (c)-then-(b) question that was blocking the MIDI work:

* **(c) is now answered: measured, and it does not carry the feature.**
* **(b) is therefore not conditional — ship the background worker.** CPU at
  ~0.75× realtime in a `worker_threads` worker, chunked, never on the UI
  thread. The CPU-backend harness blocking the renderer (it starved a CDP
  poll for 5 s straight) is independent confirmation that inference must not
  touch the main thread.
* Long buffers are then a **product** limit, not an engineering one: either cap
  transcription at a sensible length, or accept a background job that takes
  ~0.75× the clip duration and tell the user so. Do not pretend 15 minutes is
  fast.

Start with the transcription module plus a "transcribe this clip" action on
10–60 s material, which is comfortably viable today.

## Reproducing

```
cd spikes/002-tfjs-backend-bench
python -m http.server 8917 --bind 127.0.0.1
# then open, in a real GPU browser:
#   http://127.0.0.1:8917/index.html?backend=cpu&bars=4,8,16
#   http://127.0.0.1:8917/index.html?backend=webgl&bars=4,8,16
```

`?backend=` and `?bars=` are both parameters. The page writes its verdict into
`window.__RESULT` and prints a `SPIKE_002_RESULT=` line. Re-run webgl several
times — that variance *is* the result. Note the CDP/automation timeout is ~5 s
per evaluate, so poll sparsely or the harness appears to fail while the page
is merely busy; that is also why run 1 looks like it hung.

Model files are vendored in `model/` (Apache-2.0, from
`@spotify/basic-pitch`). The page imports tfjs and basic-pitch from a CDN, which
is fine for a spike and **not** acceptable for the shipping app — bundle them.
