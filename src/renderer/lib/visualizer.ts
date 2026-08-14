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

export class AudioAnalyser {
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

export function drawVisualizer(state: VisualizerState, analyser: AudioAnalyser) {
  const { ctx, width, height, theme, mode } = state;
  const anyCtx = ctx as any;
  if (mode !== 'spectrogram' || anyCtx._lastMode !== mode || anyCtx._lastTheme !== theme || anyCtx._lastW !== width || anyCtx._lastH !== height) {
    ctx.clearRect(0, 0, width, height);
    drawBackground(ctx, width, height, theme);
    anyCtx._lastMode = mode;
    anyCtx._lastTheme = theme;
    anyCtx._lastW = width;
    anyCtx._lastH = height;
  }
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
  analyser: AnalyserNode,
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
 * Scrolling spectrogram. Each animation frame we shift the canvas left by one
 * pixel-column and paint the latest frequency slice onto the right edge.
 */
const spectrogramHistory: ImageData[] = [];
const SPECTRO_HISTORY_MAX = 256;

function drawSpectrogram(
  ctx: CanvasRenderingContext2D,
  data: Float32Array,
  analyser: AnalyserNode,
  w: number,
  h: number,
  theme: Theme,
) {
  const range = analyser.maxDecibels - analyser.minDecibels;
  // Shift the existing canvas left by 1 px.
  const img = ctx.getImageData(1, 0, w - 1, h);
  ctx.putImageData(img, 0, 0);

  // Draw a vertical slice.
  const slice = ctx.createImageData(1, h);
  const usable = Math.min(data.length, Math.floor(h));
  for (let y = 0; y < h; y++) {
    // map y=0 (top) to highest frequency
    const idx = Math.floor((1 - y / h) * (usable - 1));
    const db = data[idx];
    const norm = Math.max(0, Math.min(1, (db - analyser.minDecibels) / range));
    const [r, g, b] = magColor(norm, theme);
    const off = y * 4;
    slice.data[off] = r;
    slice.data[off + 1] = g;
    slice.data[off + 2] = b;
    slice.data[off + 3] = 255;
  }
  ctx.putImageData(slice, w - 1, 0);
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
