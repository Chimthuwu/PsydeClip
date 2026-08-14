import { useEffect, useRef, useState, useCallback } from 'react';
import { AppSettings, CaptureSource, LoopbackDevice } from '../../shared/types';
import { pickSourceAndCapture, listSources } from '../lib/audio-capture';
import { AudioAnalyser } from '../lib/visualizer';
import { createRecorder, RecorderHandle } from '../lib/recorder';
import { startLoopbackStream, LoopbackStream } from '../lib/loopback-capture';

export interface CaptureState {
  /** Wins are listed when settings.captureBackend === 'desktop'. */
  sources: CaptureSource[];
  /** Speakers / headphones when settings.captureBackend === 'loopback'. */
  loopbackDevices: LoopbackDevice[];
  /** Currently bound capture stream (audio only). */
  stream: MediaStream | null;
  audioCtx: AudioContext | null;
  analyser: AudioAnalyser | null;
  recorder: RecorderHandle | null;
  capturing: boolean;
  rms: number;
  bufferedSeconds: number;
  error: string | null;
}

/**
 * Wires either the desktopCapturer path (existing) or the WASAPI loopback
 * path (new) into a unified MediaStream + AnalyserNode + MediaRecorder trio.
 *
 * The recorder stays untouched on both paths so saving a buffer snapshot
 * works the same way regardless of where the audio came from.
 */
export function useCapture(settings: AppSettings, capturing: boolean) {
  const [sources, setSources] = useState<CaptureSource[]>([]);
  const [loopbackDevices, setLoopbackDevices] = useState<LoopbackDevice[]>([]);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [audioCtx, setAudioCtx] = useState<AudioContext | null>(null);
  const [analyser, setAnalyser] = useState<AudioAnalyser | null>(null);
  const [recorder, setRecorder] = useState<RecorderHandle | null>(null);
  const [rms, setRms] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [bufferedSeconds, setBufferedSeconds] = useState(0);

  const loopbackRef = useRef<LoopbackStream | null>(null);
  const rmsTickRef = useRef<number>(0);
  // Live handles to whatever is currently bound. React state is snapshotted
  // into closures, so teardown reads these refs instead — otherwise stopping a
  // capture leaks the MediaStream tracks and the AudioContext, and Chromium
  // caps how many AudioContexts a renderer may hold open at once.
  const streamRef = useRef<MediaStream | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const recorderRef = useRef<RecorderHandle | null>(null);

  // 1. Enumerate devices for whichever backend is selected.
  useEffect(() => {
    if (settings.captureBackend === 'loopback') {
      window.api
        .listLoopbackDevices()
        .then(setLoopbackDevices)
        .catch((e) => setError(e.message ?? String(e)));
    } else {
      listSources()
        .then(setSources)
        .catch((e) => setError(e.message ?? String(e)));
    }
  }, [settings.captureBackend]);

  // 2. (Re)bind stream whenever source / backend changes (always-on monitoring).
  useEffect(() => {
    let canceled = false;

    (async () => {
      try {
        // Tear down any previous capture before starting a new one.
        await teardownStream();
        if (canceled) return;

        if (settings.captureBackend === 'loopback') {
          await bindLoopback(settings);
        } else {
          await bindDesktop(settings);
        }
      } catch (e: any) {
        if (!canceled) {
          setError(`Couldn't bind capture source: ${e.message ?? e}`);
          setStream(null); setAudioCtx(null); setAnalyser(null);
        }
      }
    })();

    return () => { canceled = true; };
  }, [settings.captureBackend, settings.sourceId, settings.loopbackDeviceId]);

  // 2b. Start/stop recorder when `capturing` or stream changes.
  useEffect(() => {
    if (capturing && stream) {
      const newRecorder = createRecorder({
        stream: streamRef.current!,
        bitrateKbps: settings.bitrateKbps,
        bufferSeconds: settings.bufferSeconds,
        mode: settings.recordMode,
      });
      newRecorder.start();
      recorderRef.current = newRecorder;
      setRecorder(newRecorder);
    } else {
      void teardownRecorder().then(() => {
        setRecorder(null);
      });
    }
  }, [capturing, settings.bitrateKbps, settings.bufferSeconds, settings.recordMode, stream]);

  // 3. Periodic RMS sampling for HUD.
  useEffect(() => {
    if (!analyser) return;
    let raf = 0;
    const tick = () => {
      if (rmsTickRef.current++ % 4 === 0 && recorder) {
        setBufferedSeconds(recorder.bufferedDuration());
      }
      const { rms } = analyser.sample();
      setRms(rms);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [analyser, recorder]);

  const refreshSources = useCallback(async () => {
    if (settings.captureBackend === 'loopback') {
      const list = await window.api.listLoopbackDevices();
      setLoopbackDevices(list);
      return list as unknown as CaptureSource[];
    }
    const list = await listSources();
    setSources(list);
    return list;
  }, [settings.captureBackend]);

  const stopStreamNow = useCallback(async () => {
    await teardownStream();
    setStream(null); setAudioCtx(null); setAnalyser(null); setRecorder(null);
  }, []);

  return {
    state: {
      sources,
      loopbackDevices,
      stream,
      audioCtx,
      analyser,
      recorder,
      capturing,
      rms,
      bufferedSeconds,
      error,
    } as CaptureState,
    refreshSources,
    stopStreamNow,
  };

  // ----- internals -------------------------------------------------------

  async function bindDesktop(s: AppSettings) {
    const sourceId = s.sourceId;
    if (!sourceId) {
      setError('Pick a desktop source first.');
      return;
    }

    // Chromium terminates the whole renderer process (bad_message /
    // MSDH_INVALID_STREAM_TYPE) rather than rejecting the promise when a
    // desktop-audio request names a source it can't produce audio for. Two
    // cases do that on Windows, and both have to be caught *before* the
    // getUserMedia call, because once it's made there is no recovering:
    //   1. a window source — only screens carry the loopback audio mixer;
    //   2. a stale id, e.g. a screen that was unplugged since we enumerated.
    if (!sourceId.startsWith('screen:')) {
      setError(
        'Window sources have no audio on Windows — pick a screen. ' +
          'Its capture already carries all system audio.',
      );
      return;
    }
    const live = await listSources();
    setSources(live);
    if (!live.some((src) => src.id === sourceId)) {
      setError('That screen is no longer available. Pick a source again.');
      return;
    }

    const newStream = await pickSourceAndCapture(sourceId);
    if (!newStream) return;
    streamRef.current = newStream;

    const ctx = new AudioContext({ latencyHint: 'interactive' });
    ctxRef.current = ctx;
    const sourceNode = ctx.createMediaStreamSource(newStream);
    const newAnalyser = new AudioAnalyser(ctx, sourceNode);
    const sink = ctx.createGain(); sink.gain.value = 0;
    sourceNode.connect(sink);

    setStream(newStream);
    setAudioCtx(ctx);
    setAnalyser(newAnalyser);
    setError(null);
  }

  async function bindLoopback(s: AppSettings) {
    const deviceId = s.loopbackDeviceId;
    if (!deviceId) {
      setError('Pick a loopback output device first.');
      return;
    }
    // `loopbackDevices` is whatever this closure captured. If the effect ran
    // before enumeration finished, re-enumerate rather than refusing to bind
    // (adding the list to the effect deps would re-bind — and drop the running
    // recording — every time the picker refreshes it).
    let device = loopbackDevices.find((d) => d.id === deviceId);
    if (!device) {
      const live = await window.api.listLoopbackDevices();
      setLoopbackDevices(live);
      device = live.find((d) => d.id === deviceId);
    }
    if (!device) {
      setError('That output device is no longer available. Pick another.');
      return;
    }

    const handle = await startLoopbackStream(device.sampleRate || 48000);
    loopbackRef.current = handle;
    streamRef.current = handle.stream;
    ctxRef.current = handle.ctx;

    // Tell main process to start spawning the helper.
    const started = await window.api.startLoopback({
      deviceId: device.id,
      deviceName: device.name,
      sampleRate: device.sampleRate || 48000,
    });
    if (!started.ok) {
      await handle.dispose();
      loopbackRef.current = null;
      throw new Error(started.error ?? 'Could not start WASAPI loopback helper');
    }

    const ctx = handle.ctx;
    const analyserNode = ctx.createAnalyser();
    analyserNode.fftSize = 2048;
    analyserNode.smoothingTimeConstant = 0.82;
    analyserNode.minDecibels = -90;
    analyserNode.maxDecibels = -10;
    handle.node.connect(analyserNode);
    const newAnalyser = new AudioAnalyser(ctx, analyserNode);

    setStream(handle.stream);
    setAudioCtx(ctx);
    setAnalyser(newAnalyser);
    setError(null);
  }

  async function teardownRecorder() {
    const rec = recorderRef.current;
    recorderRef.current = null;
    if (rec?.isActive()) {
      await Promise.race([
        rec.stop().catch(() => undefined),
        new Promise((r) => setTimeout(r, 1500)),
      ]);
    }
  }

  /**
   * Releases everything the previous bind allocated. Order matters: the
   * MediaRecorder has to come to rest while its stream is still live, then the
   * PCM feed, then the tracks, and only then the AudioContext.
   */
  async function teardownStream() {
    await teardownRecorder();
    setRecorder(null);

    // Stop loopback helper in main first so we don't leak frames through IPC.
    try { await window.api.stopLoopback(); } catch { /* noop */ }
    if (loopbackRef.current) {
      try { await loopbackRef.current.dispose(); } catch { /* noop */ }
      loopbackRef.current = null;
    }

    const s = streamRef.current;
    streamRef.current = null;
    if (s) for (const t of s.getTracks()) { try { t.stop(); } catch { /* noop */ } }

    // The loopback path's dispose() already closed its context.
    const ctx = ctxRef.current;
    ctxRef.current = null;
    if (ctx && ctx.state !== 'closed') { try { await ctx.close(); } catch { /* noop */ } }
  }
}
