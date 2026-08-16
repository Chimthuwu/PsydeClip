import type { Theme, VisualizerMode } from '../../shared/types';

/**
 * Audio visualizer rendering routines. Adapted from the reference HTML
 * (Audio Oscilloscope & Spectrum Analyzer) and extended with a scrolling
 * spectrogram and a 'modern' neon theme.
 *
 * Drawing can run at any FPS — we use requestAnimationFrame in the consumer.
 */

export interface VisualizerState {
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
  theme: Theme;
  mode: VisualizerMode;
  rms: number;
}

/**
 * Everything the draw routines actually need from an analyser.
 *
 * The main window supplies a real `AudioAnalyser` wrapping an AnalyserNode;
 * the pop-out window has no audio graph of its own and supplies a
 * `RemoteAnalyser` fed by IPC frames instead. Both satisfy this.
 */
export interface AnalyserLike {
  readonly timeData: Float32Array;
  readonly freqData: Float32Array;
  readonly analyser: { minDecibels: number; maxDecibels: number };
  sample(): { rms: number };
}

export class AudioAnalyser implements AnalyserLike {
  readonly analyser: AnalyserNode;
  readonly timeData: Float32Array<ArrayBuffer>;
  readonly freqData: Float32Array<ArrayBuffer>;

  constructor(ctx: AudioContext, source: AudioNode) {
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0.82;
    this.analyser.minDecibels = -90;
    this.analyser.maxDecibels = -10;
    source.connect(this.analyser);
    this.timeData = new Float32Array(this.analyser.fftSize) as Float32Array<ArrayBuffer>;
    this.freqData = new Float32Array(this.analyser.frequencyBinCount) as Float32Array<ArrayBuffer>;
  }

  sample(): { rms: number } {
    this.analyser.getFloatTimeDomainData(this.timeData);
    this.analyser.getFloatFrequencyData(this.freqData);
    let sum = 0;
    for (let i = 0; i < this.timeData.length; i++) sum += this.timeData[i] ** 2;
    return { rms: Math.sqrt(sum / this.timeData.length) };
  }
}

/**
 * An `AnalyserLike` with no audio graph behind it — the pop-out window fills
 * it from `viz:frame` IPC messages produced by the main window's real
 * analyser. `sample()` is a no-op because the data is already current.
 */
export class RemoteAnalyser implements AnalyserLike {
  timeData: Float32Array = new Float32Array(2048);
  freqData: Float32Array = new Float32Array(1024);
  analyser = { minDecibels: -90, maxDecibels: -10 };
  private lastRms = 0;

  update(frame: {
    time: Float32Array;
    freq: Float32Array;
    minDecibels: number;
    maxDecibels: number;
  }) {
    this.timeData = frame.time;
    this.freqData = frame.freq;
    this.analyser.minDecibels = frame.minDecibels;
    this.analyser.maxDecibels = frame.maxDecibels;
    let sum = 0;
    for (let i = 0; i < frame.time.length; i++) sum += frame.time[i] ** 2;
    this.lastRms = Math.sqrt(sum / Math.max(1, frame.time.length));
  }

  sample(): { rms: number } {
    return { rms: this.lastRms };
  }
}

export function drawVisualizer(state: VisualizerState, analyser: AnalyserLike) {
  const { ctx, width, height, theme, mode } = state;
  // The spectrogram keeps its own scroll buffer, so it repaints in full every
  // frame like the other two modes — no "don't clear" special case.
  ctx.clearRect(0, 0, width, height);
  drawBackground(ctx, width, height, theme);
  analyser.sample();

  if (mode === 'oscilloscope') drawOscilloscope(ctx, analyser.timeData, width, height, theme);
  else if (mode === 'spectrum') drawSpectrum(ctx, analyser.freqData, analyser.analyser, width, height, theme);
  else drawSpectrogram(ctx, analyser.freqData, analyser.analyser, width, height, theme);
}

function palette(theme: Theme) {
  switch (theme) {
    case 'classic':
      return {
        bg: '#000000',
        grid: '#003300',
        gridStrong: '#004400',
        wave: '#00ff00',
        bar: '#00ff00',
        spike: '#00ffaa',
        accent: '#88ff88',
      };
    case 'cyberpunk':
      return {
        bg: '#0f0518',
        grid: 'rgba(252,238,10,0.1)',
        gridStrong: 'rgba(252,238,10,0.25)',
        wave: '#fcee0a',
        bar: '#fcee0a',
        spike: '#00ffff',
        accent: '#ff003c',
      };
    case 'synthwave':
      return {
        bg: '#140c28',
        grid: 'rgba(255,119,0,0.1)',
        gridStrong: 'rgba(255,119,0,0.25)',
        wave: '#ff7700',
        bar: '#ff7700',
        spike: '#ff00a0',
        accent: '#00e5ff',
      };
    case 'monochrome':
      return {
        bg: '#000000',
        grid: '#333333',
        gridStrong: '#555555',
        wave: '#ffffff',
        bar: '#ffffff',
        spike: '#cccccc',
        accent: '#aaaaaa',
      };
    // The only light-background theme — pastels need a pale canvas to read.
    case 'kawaii':
      return {
        bg: '#fff0f7',
        grid: 'rgba(255,143,199,0.20)',
        gridStrong: 'rgba(179,157,255,0.45)',
        wave: '#ff5fa2',
        bar: '#ff8fc7',
        spike: '#b39dff',
        accent: '#7fe7dc',
      };
    case 'modern':
    default:
      return {
        bg: '#070a1c',
        grid: 'rgba(120,150,255,0.08)',
        gridStrong: 'rgba(120,150,255,0.18)',
        wave: '#7df9ff',
        bar: '#7df9ff',
        spike: '#b48bff',
        accent: '#ff8df0',
      };
  }
}

function drawBackground(ctx: CanvasRenderingContext2D, w: number, h: number, theme: Theme) {
  if (theme === 'modern') {
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#0c1133');
    grad.addColorStop(1, '#070a1c');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
  } else if (theme === 'cyberpunk') {
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#1a0524');
    grad.addColorStop(1, '#0f0518');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
  } else if (theme === 'synthwave') {
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#2b1055');
    grad.addColorStop(1, '#140c28');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
  } else if (theme === 'kawaii') {
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#fff8fc');
    grad.addColorStop(0.55, '#ffeaf5');
    grad.addColorStop(1, '#f2e6ff');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
  } else {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);
  }
}

function drawGrid(ctx: CanvasRenderingContext2D, w: number, h: number, theme: Theme) {
  const p = palette(theme);
  ctx.strokeStyle = p.grid;
  ctx.lineWidth = 1;
  for (let x = 0; x <= w; x += w / 10) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
  }
  for (let y = 0; y <= h; y += h / 8) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }
  ctx.strokeStyle = p.gridStrong;
  ctx.beginPath();
  ctx.moveTo(0, h / 2);
  ctx.lineTo(w, h / 2);
  ctx.stroke();
}

function drawOscilloscope(
  ctx: CanvasRenderingContext2D,
  data: Float32Array,
  w: number,
  h: number,
  theme: Theme,
) {
  drawGrid(ctx, w, h, theme);
  const p = palette(theme);
  ctx.lineWidth = theme === 'classic' ? 2 : theme === 'kawaii' ? 3 : 2.5;
  ctx.strokeStyle = p.wave;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.shadowColor = theme === 'kawaii' ? 'rgba(255,143,199,0.8)' : p.wave;
  ctx.shadowBlur = theme === 'modern' ? 12 : theme === 'kawaii' ? 10 : 0;
  ctx.beginPath();
  const slice = w / data.length;
  for (let i = 0; i < data.length; i++) {
    const v = data[i];
    const y = h / 2 + v * (h / 2) * 0.9;
    const x = i * slice;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.shadowBlur = 0;
}

function drawSpectrum(
  ctx: CanvasRenderingContext2D,
  data: Float32Array,
  analyser: { minDecibels: number; maxDecibels: number },
  w: number,
  h: number,
  theme: Theme,
) {
  drawGrid(ctx, w, h, theme);
  const p = palette(theme);
  const range = analyser.maxDecibels - analyser.minDecibels;
  const barWidth = w / data.length;
  for (let i = 0; i < data.length; i++) {
    const db = data[i];
    const norm = Math.max(0, Math.min(1, (db - analyser.minDecibels) / range));
    const barHeight = norm * (h - 8);
    let grad: string | CanvasGradient = p.bar;
    if (theme === 'modern') {
      const g = ctx.createLinearGradient(0, h, 0, 0);
      g.addColorStop(0, '#7df9ff');
      g.addColorStop(0.6, '#b48bff');
      g.addColorStop(1, '#ff8df0');
      grad = g;
    } else if (theme === 'kawaii') {
      const g = ctx.createLinearGradient(0, h, 0, 0);
      g.addColorStop(0, '#7fe7dc');
      g.addColorStop(0.5, '#b39dff');
      g.addColorStop(1, '#ff5fa2');
      grad = g;
    }
    ctx.fillStyle = grad;
    ctx.fillRect(i * barWidth, h - barHeight, Math.max(1, barWidth - 1), barHeight);
  }
}

/**
 * Scrolling spectrogram.
 *
 * History lives in an offscreen buffer rather than on the visible canvas. The
 * old implementation scrolled the live canvas with getImageData/putImageData
 * every frame — a GPU→CPU readback per frame that stalled the render loop, and
 * it was wiped by anything that repainted the canvas (a resize, a theme swap,
 * a mode round-trip), which is why the spectrogram usually showed nothing.
 *
 * The buffer is keyed off the destination context, so each canvas (main window
 * and pop-out) keeps its own independent history.
 */
interface SpectroBuffer {
  canvas: HTMLCanvasElement;
  bctx: CanvasRenderingContext2D;
  w: number;
  h: number;
  theme: Theme;
}
const spectroBuffers = new WeakMap<CanvasRenderingContext2D, SpectroBuffer>();

function getSpectroBuffer(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  theme: Theme,
): SpectroBuffer | null {
  let buf = spectroBuffers.get(ctx);
  // Any size or theme change invalidates the history — the old pixels were
  // painted with a different palette at a different scale.
  if (!buf || buf.w !== w || buf.h !== h || buf.theme !== theme) {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const bctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!bctx) return null;
    drawBackground(bctx, w, h, theme);
    buf = { canvas, bctx, w, h, theme };
    spectroBuffers.set(ctx, buf);
  }
  return buf;
}

function drawSpectrogram(
  ctx: CanvasRenderingContext2D,
  data: Float32Array,
  analyser: { minDecibels: number; maxDecibels: number },
  w: number,
  h: number,
  theme: Theme,
) {
  if (w < 2 || h < 2) return;
  const buf = getSpectroBuffer(ctx, w, h, theme);
  if (!buf) return;

  const { bctx } = buf;
  const range = analyser.maxDecibels - analyser.minDecibels || 1;
  // Scroll speed scales with width so a 200px strip and a 1600px window move
  // at roughly the same apparent rate.
  const col = Math.max(1, Math.round(w / 480));

  // Shift left. 'copy' means the vacated column comes back transparent instead
  // of ghosting the previous frame under the new one.
  bctx.globalCompositeOperation = 'copy';
  bctx.drawImage(buf.canvas, -col, 0);
  bctx.globalCompositeOperation = 'source-over';

  // Paint the newest slice into the freed column. Frequency is mapped
  // logarithmically — a linear map buries everything musical in the bottom
  // eighth of the image.
  const slice = bctx.createImageData(col, h);
  const bins = data.length;
  const minBin = 1;
  const logMin = Math.log(minBin);
  const logMax = Math.log(bins - 1);
  for (let y = 0; y < h; y++) {
    // y = 0 is the top of the canvas, i.e. the highest frequency.
    const t = 1 - y / (h - 1);
    const idx = Math.min(bins - 1, Math.round(Math.exp(logMin + t * (logMax - logMin))));
    const db = data[idx];
    const norm = Number.isFinite(db)
      ? Math.max(0, Math.min(1, (db - analyser.minDecibels) / range))
      : 0;
    const [r, g, b] = magColor(norm, theme);
    for (let x = 0; x < col; x++) {
      const off = (y * col + x) * 4;
      slice.data[off] = r;
      slice.data[off + 1] = g;
      slice.data[off + 2] = b;
      slice.data[off + 3] = 255;
    }
  }
  bctx.putImageData(slice, w - col, 0);

  ctx.drawImage(buf.canvas, 0, 0);
}

function magColor(norm: number, theme: Theme): [number, number, number] {
  if (theme === 'classic') {
    const v = Math.floor(255 * Math.pow(norm, 1.5));
    return [0, v, Math.floor(v * 0.3)];
  }
  if (theme === 'monochrome') {
    const v = Math.floor(255 * norm);
    return [v, v, v];
  }
  if (theme === 'cyberpunk') {
    // dark purple -> neon pink -> cyan -> yellow
    if (norm < 0.4) {
      const t = norm / 0.4;
      return [Math.floor(15 + 240 * t), Math.floor(5 + 0 * t), Math.floor(24 + 36 * t)];
    }
    if (norm < 0.75) {
      const t = (norm - 0.4) / 0.35;
      return [Math.floor(255 - 255 * t), Math.floor(0 + 255 * t), Math.floor(60 + 195 * t)];
    }
    const t = (norm - 0.75) / 0.25;
    return [Math.floor(0 + 252 * t), Math.floor(255 - 17 * t), Math.floor(255 - 245 * t)];
  }
  if (theme === 'kawaii') {
    // Light theme, so quiet bins stay near the pale background:
    // cream -> mint -> lavender -> bubblegum.
    if (norm < 0.35) {
      const t = norm / 0.35;
      return [Math.floor(255 - 128 * t), Math.floor(246 - 15 * t), Math.floor(251 - 31 * t)];
    }
    if (norm < 0.7) {
      const t = (norm - 0.35) / 0.35;
      return [Math.floor(127 + 52 * t), Math.floor(231 - 74 * t), Math.floor(220 + 35 * t)];
    }
    const t = (norm - 0.7) / 0.3;
    return [Math.floor(179 + 76 * t), Math.floor(157 - 62 * t), Math.floor(255 - 93 * t)];
  }
  if (theme === 'synthwave') {
    // dark blue -> purple -> pink -> orange
    if (norm < 0.4) {
      const t = norm / 0.4;
      return [Math.floor(20 + 235 * t), Math.floor(12 + 0 * t), Math.floor(40 + 120 * t)];
    }
    if (norm < 0.75) {
      const t = (norm - 0.4) / 0.35;
      return [Math.floor(255 + 0 * t), Math.floor(0 + 0 * t), Math.floor(160 - 160 * t)];
    }
    const t = (norm - 0.75) / 0.25;
    return [Math.floor(255 + 0 * t), Math.floor(0 + 119 * t), Math.floor(0 + 0 * t)];
  }
  
  // modern: black -> cyan -> magenta -> white
  if (norm < 0.4) {
    const t = norm / 0.4;
    return [Math.floor(20 + 100 * t), Math.floor(40 + 180 * t), Math.floor(80 + 160 * t)];
  }
  if (norm < 0.75) {
    const t = (norm - 0.4) / 0.35;
    return [Math.floor(120 + 110 * t), Math.floor(220 - 60 * t), Math.floor(240 - 40 * t)];
  }
  const t = (norm - 0.75) / 0.25;
  return [Math.floor(230 + 25 * t), Math.floor(160 + 95 * t), Math.floor(200 + 55 * t)];
}
