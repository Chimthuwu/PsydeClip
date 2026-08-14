/**
 * Renderer-side glue for the WASAPI loopback backend.
 *
 * The main process spawns `recordr-loopback.exe` and forwards raw Float32
 * stereo PCM frames (<=> Uint8Array little-endian) over IPC. This module:
 *   1. Subscribes to those frames.
 *   2. Pumps them via postMessage into an AudioWorkletProcessor that maintains
 *      a small queue and produces studio-rate stereo frames at 128 samples
 *      each.
 *   3. Routes the worklet node's output through a MediaStreamDestination so
 *      the existing MediaRecorder-based pipeline (visualizers, rolling buffer,
 *      WebM/Opus save) keeps working unchanged.
 */

const WORKLET_SRC = `
class PCMProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.queue = [];
    // Read offset into queue[0]. Must start at 0 — leaving it undefined makes
    // the first (chunk.length - this.cursor) evaluate to NaN, which reads as
    // "0 samples left" and silently drops the head of the stream.
    this.cursor = 0;
    this.transferablesAllowed = !!(options && options.processorOptions && options.processorOptions.useTransfer);
    this.port.onmessage = (e) => {
      const arr = e.data;        // Float32Array (interleaved stereo)
      this.queue.push(arr);
    };
  }

  process(_inputs, outputs) {
    const outL = outputs[0][0];
    const outR = outputs[0][1];
    const FRAME = 128;
    let i = 0;
    while (i < FRAME) {
      if (this.queue.length === 0) {
        // Under-run: output silence for the rest of this frame.
        outL.fill(0, i);
        outR.fill(0, i);
        return true;
      }
      const chunk = this.queue[0];
      const stereoSamplesLeft = (chunk.length - this.cursor) >> 1;
      if (stereoSamplesLeft === 0) {
        this.queue.shift();
        this.cursor = 0;
        continue;
      }
      const take = Math.min(stereoSamplesLeft, FRAME - i);
      const off = this.cursor || 0;
      for (let j = 0; j < take; j++) {
        const k = (off + j * 2);
        outL[i + j] = chunk[k];
        outR[i + j] = chunk[k + 1];
      }
      this.cursor = off + take * 2;
      i += take;
      if (this.cursor >= chunk.length) {
        this.queue.shift();
        this.cursor = 0;
      }
    }
    return true;
  }
}
registerProcessor('pcm-processor', PCMProcessor);
`;

export interface LoopbackStream {
  ctx: AudioContext;
  node: AudioWorkletNode;
  stream: MediaStream;
  dispose(): Promise<void>;
}

export async function startLoopbackStream(sampleRate = 48000): Promise<LoopbackStream> {
  const ctx = new AudioContext({ sampleRate, latencyHint: 'interactive' });

  const blob = new Blob([WORKLET_SRC], { type: 'application/javascript' });
  const url = URL.createObjectURL(blob);
  // We deliberately don't revoke the URL until disposal — AudioWorklet keeps
  // referencing the module for the lifetime of the node.
  await ctx.audioWorklet.addModule(url);

  const node = new AudioWorkletNode(ctx, 'pcm-processor', {
    numberOfInputs: 0,
    numberOfOutputs: 1,
    outputChannelCount: [2],
  });

  // Route the worklet into a MediaStreamDestination so MediaRecorder can read it.
  // We do NOT connect to ctx.destination — that would echo audio out the speakers.
  const dest = ctx.createMediaStreamDestination();
  node.connect(dest);

  // Subscribe to main-process PCM frames and post them into the worklet.
  // We transfer the ArrayBuffer so the worklet owns it; the next frame will
  // be a brand-new buffer from main.
  const unsub = window.api.onLoopbackSamples((u8) => {
    // view the same bytes as little-endian Float32
    const f32 = new Float32Array(u8.buffer, u8.byteOffset, u8.byteLength / 4);
    // Worklet consumes Float32 directly — post a copy (transferring the
    // underlying buffer keeps allocations down on the main side).
    try {
      node.port.postMessage(f32, [f32.buffer]);
    } catch {
      // If the buffer was neutered (e.g. duplicate postMessage), copy.
      node.port.postMessage(new Float32Array(f32));
    }
  });

  const dispose = async () => {
    try { unsub(); } catch { /* noop */ }
    try { node.disconnect(); } catch { /* noop */ }
    try { await ctx.close(); } catch { /* noop */ }
    try { URL.revokeObjectURL(url); } catch { /* noop */ }
  };

  return { ctx, node, stream: dest.stream, dispose };
}
