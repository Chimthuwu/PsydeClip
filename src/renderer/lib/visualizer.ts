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
  readonly analyser: {
    minDecibels: number;
    maxDecibels: number;
    /** Present on a real AnalyserNode; absent on the pop-out's RemoteAnalyser. */
    smoothingTimeConstant?: number;
  };
  sample(): { rms: number };
}

/**
 * Temporal smoothing per mode.
 *
 * The spectrum bars want a lot of it or they strobe. The spectrogram is a
 * *time-history* view, so the same smoothing paints every transient across
 * dozens of columns — which is what made it look like a smeared watercolour.
 * `App.tsx` applies this to the live AnalyserNode whenever the mode changes.
 */
export const SMOOTHING_FOR_MODE: Record<VisualizerMode, number> = {
  oscilloscope: 0.82,
  spectrum: 0.82,
  spectrogram: 0.2,
};

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
  bins: number;
  /** Per-row bin mapping — see buildRowMap(). */
  lo: Int32Array;
  hi: Int32Array;
  frac: Float32Array;
}
const spectroBuffers = new WeakMap<CanvasRenderingContext2D, SpectroBuffer>();

/**
 * Precompute, for every output row, which FFT bins it represents.
 *
 * A naive `round(exp(...))` lookup per row is wrong at *both* ends of a log
 * axis and that is what made the old spectrogram look broken:
 *
 *   - **Low end.** With a 1024-bin FFT the bottom ~30% of the image spans bins
 *     1–8. Dozens of consecutive rows resolved to the same bin and painted the
 *     same flat colour, producing the thick horizontal banding across the
 *     bottom of the picture.
 *   - **High end.** Near the top each row advances by 40+ bins, so a single
 *     sampled bin stood in for all of them. Any peak that fell between two
 *     sampled bins vanished, and which bins got sampled shifted frame to frame
 *     — the source of the flickering vertical streaks.
 *
 * So: rows narrower than one bin interpolate between neighbours (`hi === lo`,
 * blend by `frac`), and rows wider than one bin take the max over their range
 * (`hi > lo`) so nothing is dropped.
 */
function buildRowMap(h: number, bins: number) {
  const lo = new Int32Array(h);
  const hi = new Int32Array(h);
  const frac = new Float32Array(h);
  const maxBin = bins - 1;
  const logMin = Math.log(1);
  const logMax = Math.log(maxBin);
  // Bin position for a row centre expressed as a fraction up the canvas.
  const posAt = (t: number) => Math.exp(logMin + Math.min(1, Math.max(0, t)) * (logMax - logMin));

  for (let y = 0; y < h; y++) {
    // y = 0 is the top of the canvas, i.e. the highest frequency.
    const tMid = 1 - y / Math.max(1, h - 1);
    const half = 0.5 / Math.max(1, h - 1);
    const pLow = posAt(tMid - half);
    const pHigh = posAt(tMid + half);
    const a = Math.floor(pLow);
    const b = Math.ceil(pHigh) - 1;
    if (b > a) {
      lo[y] = Math.max(1, Math.min(maxBin, a));
      hi[y] = Math.max(1, Math.min(maxBin, b));
      frac[y] = 0;
    } else {
      const p = Math.min(maxBin - 1, Math.max(1, posAt(tMid)));
      lo[y] = Math.floor(p);
      hi[y] = Math.floor(p);
      frac[y] = p - Math.floor(p);
    }
  }
  return { lo, hi, frac };
}

function getSpectroBuffer(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  theme: Theme,
  bins: number,
): SpectroBuffer | null {
  let buf = spectroBuffers.get(ctx);
  // Any size or theme change invalidates the history — the old pixels were
  // painted with a different palette at a different scale.
  if (!buf || buf.w !== w || buf.h !== h || buf.theme !== theme || buf.bins !== bins) {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const bctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!bctx) return null;
    // The scroll step below draws this canvas onto itself. With smoothing left
    // on, every frame resamples the whole history and it turns to mush after a
    // few seconds — the soft, out-of-focus look the old version had.
    bctx.imageSmoothingEnabled = false;
    drawBackground(bctx, w, h, theme);
    const map = buildRowMap(h, bins);
    buf = { canvas, bctx, w, h, theme, bins, ...map };
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
  const bins = data.length;
  if (bins < 4) return;
  const buf = getSpectroBuffer(ctx, w, h, theme, bins);
  if (!buf) return;

  const { bctx, lo, hi, frac } = buf;
  const min = analyser.minDecibels;
  const range = analyser.maxDecibels - min || 1;
  // One or two device pixels per frame. The old `w / 480` gave 4px columns on a
  // wide window, which both coarsened the time axis and scrolled the whole
  // history off screen in about eight seconds.
  const col = Math.max(1, Math.round(w / 900));

  // Shift left. 'copy' means the vacated column comes back transparent instead
  // of ghosting the previous frame under the new one.
  bctx.globalCompositeOperation = 'copy';
  bctx.drawImage(buf.canvas, -col, 0);
  bctx.globalCompositeOperation = 'source-over';

  // Paint the newest slice into the freed column.
  const slice = bctx.createImageData(col, h);
  const px = slice.data;
  for (let y = 0; y < h; y++) {
    const a = lo[y];
    const b = hi[y];
    let db: number;
    if (b > a) {
      // Wide row: max over the bins it covers, so nothing is skipped.
      let m = -Infinity;
      for (let i = a; i <= b; i++) {
        const v = data[i];
        if (v > m) m = v;
      }
      db = m;
    } else {
      // Narrow row: interpolate, so the low end is a gradient not a stack of
      // flat bands.
      const f = frac[y];
      const v0 = data[a];
      const v1 = data[a + 1] ?? v0;
      db = v0 + (v1 - v0) * f;
    }

    let norm = Number.isFinite(db) ? (db - min) / range : 0;
    norm = norm < 0 ? 0 : norm > 1 ? 1 : norm;
    // Contrast curve. Typical music sits at -60…-30 dB, i.e. right in the
    // middle of the -90…-10 window, so a linear map rendered almost the entire
    // picture in one mid-tone — the flat cyan wash. This pushes the noise floor
    // down to the background and keeps the headroom for actual peaks.
    norm = norm * norm;

    const [r, g, bb] = magColor(norm, theme);
    for (let x = 0; x < col; x++) {
      const off = (y * col + x) * 4;
      px[off] = r;
      px[off + 1] = g;
      px[off + 2] = bb;
      px[off + 3] = 255;
    }
  }
  bctx.putImageData(slice, w - col, 0);

  ctx.drawImage(buf.canvas, 0, 0);
}

/**
 * Spectrogram colour ramps, as `[stop, r, g, b]` rows in ascending stop order.
 *
 * Every ramp starts *at that theme's canvas background* so silence disappears
 * into the panel instead of tinting the whole picture, then climbs through two
 * or three hues to a near-white peak. The old ramps began at a mid-brightness
 * colour (modern's floor was rgb(20,40,80)), which is why a quiet track still
 * filled the board edge to edge.
 */
type Ramp = readonly (readonly [number, number, number, number])[];

const RAMPS: Record<Theme, Ramp> = {
  modern: [
    [0.0, 7, 10, 28],
    [0.22, 14, 46, 96],
    [0.45, 32, 150, 200],
    [0.66, 125, 249, 255],
    [0.82, 180, 139, 255],
    [0.93, 255, 141, 240],
    [1.0, 255, 250, 255],
  ],
  classic: [
    [0.0, 0, 0, 0],
    [0.35, 0, 60, 12],
    [0.7, 0, 190, 45],
    [0.9, 90, 255, 130],
    [1.0, 220, 255, 220],
  ],
  monochrome: [
    [0.0, 0, 0, 0],
    [0.5, 105, 105, 105],
    [0.85, 215, 215, 215],
    [1.0, 255, 255, 255],
  ],
  cyberpunk: [
    [0.0, 15, 5, 24],
    [0.25, 60, 10, 60],
    [0.5, 255, 0, 60],
    [0.72, 252, 238, 10],
    [0.88, 0, 255, 255],
    [1.0, 235, 255, 255],
  ],
  synthwave: [
    [0.0, 20, 12, 40],
    [0.26, 60, 24, 96],
    [0.5, 160, 40, 190],
    [0.72, 255, 0, 160],
    [0.88, 255, 119, 0],
    [1.0, 255, 240, 200],
  ],
  // The one light theme: the ramp runs *down* in luminance so loud bins are
  // dark against the pale canvas, otherwise nothing is visible at all.
  kawaii: [
    [0.0, 255, 240, 247],
    [0.28, 175, 231, 224],
    [0.52, 127, 231, 220],
    [0.72, 179, 157, 255],
    [0.88, 255, 95, 162],
    [1.0, 120, 40, 90],
  ],
};

function magColor(norm: number, theme: Theme): [number, number, number] {
  const ramp = RAMPS[theme] ?? RAMPS.modern;
  if (norm <= ramp[0][0]) return [ramp[0][1], ramp[0][2], ramp[0][3]];
  for (let i = 1; i < ramp.length; i++) {
    const [stop, r, g, b] = ramp[i];
    if (norm <= stop) {
      const [prevStop, pr, pg, pb] = ramp[i - 1];
      const t = (norm - prevStop) / (stop - prevStop || 1);
      return [
        (pr + (r - pr) * t) | 0,
        (pg + (g - pg) * t) | 0,
        (pb + (b - pb) * t) | 0,
      ];
    }
  }
  const last = ramp[ramp.length - 1];
  return [last[1], last[2], last[3]];
}
