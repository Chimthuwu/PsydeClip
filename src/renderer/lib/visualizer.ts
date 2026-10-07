import type { Theme, VisualizerMode } from '../../shared/types';
import { isSharp, type PianoRollLayout } from '../../shared/piano-roll';
import { HistoryModel } from './history-model';

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
  /**
   * The historical-waveform model (peak track + session clock + viewport).
   * Owns the coordinate mapping and the per-column decimation, so selection
   * coordinates and drawing share one time base (todo.md §11.4 Phase 1).
   */
  historyModel?: HistoryModel | null;
  /**
   * Layered visualizers (todo.md section 11, DECIDED 2026-10-07): when the
   * mode is 'history', also draw a live oscilloscope inset at the right edge,
   * at reduced opacity, behind `settings.showOscilloscopeOverlay`. Ignored for
   * every other mode. The scope's ~43ms window can't share History's
   * minutes-long x-axis, so it is a fixed-width inset, not a full overlay.
   */
  showOscilloscopeOverlay?: boolean;
  /**
   * Zoom/pan viewport for the history track, as absolute session seconds
   * `[start, end]` (already resolved via `HistoryModel.effectiveViewport`).
   * Absent = fit-all (the whole buffer at the live edge) — what the read-only
   * split-view panes use.
   */
  viewport?: [number, number] | null;
  isPopout?: boolean;
  /**
   * Visualizer sensitivity multiplier (1 = neutral). Applied at draw time
   * only — the analyser data itself is untouched, so recordings, playback
   * and their volume are completely unaffected. Quiet sources can be made
   * to light up the visuals by raising this (up to 4×).
   */
  gain?: number;
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
  history: 0.82,
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
  const { ctx, width, height, theme, mode, historyModel } = state;
  // The spectrogram keeps its own scroll buffer, so it repaints in full every
  // frame like the other two modes — no "don't clear" special case.
  ctx.clearRect(0, 0, width, height);
  drawBackground(ctx, width, height, theme);
  analyser.sample();

  const gain = state.gain ?? 1;
  if (mode === 'history') {
    drawHistory(ctx, historyModel, state.viewport ?? null, width, height, theme, !!state.isPopout, gain);
    if (state.showOscilloscopeOverlay) {
      drawOscilloscopeOverlayInset(ctx, analyser.timeData, width, height, theme, gain);
    }
  }
  else if (mode === 'oscilloscope') drawOscilloscope(ctx, analyser.timeData, width, height, theme, gain);
  else if (mode === 'spectrum') drawSpectrum(ctx, analyser.freqData, analyser.analyser, width, height, theme, gain);
  else drawSpectrogram(ctx, analyser.freqData, analyser.analyser, width, height, theme, gain);
}

/**
 * Layered-visualizer inset (todo.md section 11, DECIDED 2026-10-07): a live
 * oscilloscope drawn over the right edge of the History board at ~35%
 * opacity, behind a layer toggle. Fixed-width because the scope's ~43ms
 * window has no sensible shared x-axis with History's minutes-long span —
 * stretching it to match would be meaningless, so it stays a small
 * self-contained panel instead of trying to align with the waveform below.
 */
function drawOscilloscopeOverlayInset(
  ctx: CanvasRenderingContext2D,
  data: Float32Array,
  w: number,
  h: number,
  theme: Theme,
  gain: number,
) {
  if (data.length === 0 || w <= 0 || h <= 0) return;
  const insetW = Math.max(60, Math.min(160, w * 0.28));
  const x0 = w - insetW;
  const p = palette(theme);

  ctx.save();
  ctx.globalAlpha = 0.35;
  // A faint backing panel so the trace reads against a busy waveform
  // underneath, without fully occluding the History data behind it.
  ctx.fillStyle = p.bg;
  ctx.fillRect(x0, 0, insetW, h);

  ctx.beginPath();
  ctx.rect(x0, 0, insetW, h);
  ctx.clip();
  ctx.lineWidth = 2;
  ctx.strokeStyle = p.wave;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.beginPath();
  const slice = insetW / data.length;
  for (let i = 0; i < data.length; i++) {
    const v = Math.max(-1, Math.min(1, data[i] * gain));
    const y = h / 2 + v * (h / 2) * 0.9;
    const x = x0 + i * slice;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.restore();

  // A thin divider so the inset reads as its own panel, not a draw glitch.
  ctx.save();
  ctx.globalAlpha = 0.35;
  ctx.strokeStyle = p.accent;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x0 + 0.5, 0);
  ctx.lineTo(x0 + 0.5, h);
  ctx.stroke();
  ctx.restore();
}

/** Themes whose oscilloscope trace gets a soft neon bloom. */
const GLOW_THEMES = new Set<Theme>(['modern', 'aqua', 'lime', 'sakura', 'blood-red', 'nocturnal']);

function palette(theme: Theme) {
  switch (theme) {
    case 'aqua':
      return {
        bg: '#071e24',
        grid: 'rgba(45,212,191,0.1)',
        gridStrong: 'rgba(45,212,191,0.22)',
        wave: '#3ee879',
        bar: '#3ee879',
        spike: '#5eead4',
        accent: '#2dd4bf',
      };
    case 'sakura':
      return {
        bg: '#190617',
        grid: 'rgba(238,95,208,0.1)',
        gridStrong: 'rgba(238,95,208,0.24)',
        wave: '#dd82dc',
        bar: '#dd82dc',
        spike: '#ff8fe0',
        accent: '#b98dff',
      };
    case 'lime':
      return {
        bg: '#041306',
        grid: 'rgba(46,255,74,0.1)',
        gridStrong: 'rgba(46,255,74,0.22)',
        wave: '#2eff4a',
        bar: '#2eff4a',
        spike: '#c6ff33',
        accent: '#7dff8f',
      };
    case 'blood-red':
      return {
        bg: '#000000',
        grid: 'rgba(255,16,36,0.1)',
        gridStrong: 'rgba(255,16,36,0.24)',
        wave: '#ff1024',
        bar: '#ff1024',
        spike: '#ff3d8f',
        accent: '#ff1024',
      };
    case 'nocturnal':
      return {
        bg: '#0e0a1c',
        grid: 'rgba(122,141,255,0.09)',
        gridStrong: 'rgba(122,141,255,0.2)',
        wave: '#5b7fff',
        bar: '#5b7fff',
        spike: '#b98dff',
        accent: '#6a8dff',
      };
    case 'black-ice':
      return {
        bg: '#000000',
        grid: 'rgba(168,240,255,0.05)',
        gridStrong: 'rgba(168,240,255,0.13)',
        wave: '#c4f4fc',
        bar: '#c4f4fc',
        spike: '#a8f0d8',
        accent: '#7fe3f5',
      };
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
  } else if (theme === 'aqua') {
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#0e2c33');
    grad.addColorStop(1, '#071e24');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
  } else if (theme === 'sakura') {
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#280a25');
    grad.addColorStop(1, '#190617');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
  } else if (theme === 'lime') {
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#0a2411');
    grad.addColorStop(1, '#041306');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
  } else if (theme === 'blood-red') {
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#180205');
    grad.addColorStop(1, '#000000');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
  } else if (theme === 'nocturnal') {
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#171130');
    grad.addColorStop(1, '#0e0a1c');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
  } else if (theme === 'black-ice') {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);
    const glow = ctx.createRadialGradient(w * 0.42, h * 0.34, 0, w * 0.42, h * 0.34, Math.max(w, h) * 0.55);
    glow.addColorStop(0, 'rgba(127, 227, 245, 0.06)');
    glow.addColorStop(1, 'rgba(127, 227, 245, 0)');
    ctx.fillStyle = glow;
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
  gain: number,
) {
  drawGrid(ctx, w, h, theme);
  const p = palette(theme);
  ctx.lineWidth = theme === 'classic' ? 2 : theme === 'kawaii' ? 3 : 2.5;
  ctx.strokeStyle = p.wave;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.shadowColor = theme === 'kawaii' ? 'rgba(255,143,199,0.8)' : p.wave;
  ctx.shadowBlur = GLOW_THEMES.has(theme) ? 12 : theme === 'kawaii' ? 10 : 0;
  ctx.beginPath();
  const slice = w / data.length;
  for (let i = 0; i < data.length; i++) {
    // Sensitivity scales the waveform amplitude; clamped so a big boost can't
    // throw the trace off-canvas.
    const v = Math.max(-1, Math.min(1, data[i] * gain));
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
  gain: number,
) {
  drawGrid(ctx, w, h, theme);
  const p = palette(theme);
  const range = analyser.maxDecibels - analyser.minDecibels;
  // Frequency data is in dB, so a sensitivity multiplier becomes a dB offset.
  const gainDb = 20 * Math.log10(gain);
  const barWidth = w / data.length;
  for (let i = 0; i < data.length; i++) {
    const db = data[i] + gainDb;
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
/**
 * How many seconds of audio the scrolling spectrogram shows across its full
 * width. The scroll is driven by wall-clock time (not per-frame), so this is
 * an exact mapping: x-fraction `f` across the canvas is
 * `newestSec - (1 - f) * SPECTRO_VISIBLE_SEC`. The history selection/drag layer
 * uses that to let you highlight a snippet straight off the spectrogram.
 */
export const SPECTRO_VISIBLE_SEC = 15;

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
  /** performance.now() the buffer was last scrolled to (time-based scroll). */
  lastAdvanceMs: number;
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
    buf = { canvas, bctx, w, h, theme, bins, ...map, lastAdvanceMs: 0 };
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
  gain: number,
) {
  if (w < 2 || h < 2) return;
  const bins = data.length;
  if (bins < 4) return;
  const buf = getSpectroBuffer(ctx, w, h, theme, bins);
  if (!buf) return;

  const { bctx, lo, hi, frac } = buf;
  const min = analyser.minDecibels;
  const range = analyser.maxDecibels - min || 1;

  // Time-based scroll: the full width is exactly SPECTRO_VISIBLE_SEC of audio,
  // so a canvas x maps to a real timestamp and the selection/drag layer can sit
  // on top of it. Advance by however many whole columns have come due since the
  // last paint (frame rate independent — and it survives the window being
  // hidden, which throttles rAF).
  const msPerCol = (SPECTRO_VISIBLE_SEC * 1000) / Math.max(1, w);
  const nowMs = performance.now();
  if (buf.lastAdvanceMs === 0) buf.lastAdvanceMs = nowMs;
  let col = Math.floor((nowMs - buf.lastAdvanceMs) / msPerCol);
  if (col <= 0) {
    // Nothing new is due yet — just re-blit what we have so the pane isn't blank.
    ctx.drawImage(buf.canvas, 0, 0);
    return;
  }
  if (col >= w) {
    // Hidden / stalled for longer than the whole window: the buffer is entirely
    // stale, so repaint one full frame and snap the clock to now (don't let a
    // huge backlog make every following frame think it's still behind).
    col = w;
    buf.lastAdvanceMs = nowMs;
  } else {
    buf.lastAdvanceMs += col * msPerCol;
  }

  // Shift left. 'copy' means the vacated columns come back transparent instead
  // of ghosting the previous frame under the new one.
  bctx.globalCompositeOperation = 'copy';
  bctx.drawImage(buf.canvas, -col, 0);
  bctx.globalCompositeOperation = 'source-over';

  // Paint the newest slice into the freed columns.
  const slice = bctx.createImageData(col, h);
  const px = slice.data;
  // Sensitivity as a dB offset, applied per slice (existing history keeps its
  // original appearance; only newly-painted columns reflect the setting).
  const gainDb = 20 * Math.log10(gain);
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

    let norm = Number.isFinite(db) ? (db + gainDb - min) / range : 0;
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
  aqua: [
    [0.0, 7, 30, 36],
    [0.3, 13, 82, 80],
    [0.55, 45, 212, 191],
    [0.78, 122, 245, 165],
    [1.0, 226, 255, 242],
  ],
  sakura: [
    [0.0, 25, 6, 23],
    [0.32, 92, 20, 84],
    [0.58, 221, 82, 210],
    [0.8, 255, 143, 224],
    [1.0, 255, 236, 250],
  ],
  lime: [
    [0.0, 4, 19, 8],
    [0.33, 10, 88, 26],
    [0.65, 46, 255, 74],
    [0.88, 150, 255, 110],
    [1.0, 232, 255, 214],
  ],
  'blood-red': [
    [0.0, 6, 0, 0],
    [0.3, 74, 2, 8],
    [0.6, 255, 16, 36],
    [0.83, 255, 110, 130],
    [1.0, 255, 230, 230],
  ],
  'black-ice': [
    [0.0, 0, 0, 0],
    [0.35, 14, 46, 52],
    [0.65, 127, 227, 245],
    [0.88, 200, 245, 251],
    [1.0, 240, 253, 255],
  ],
  nocturnal: [
    [0.0, 14, 10, 28],
    [0.3, 30, 26, 72],
    [0.58, 91, 127, 255],
    [0.8, 185, 141, 255],
    [1.0, 236, 238, 255],
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

/** Height of the time ruler strip along the bottom of the history pane. */
const HISTORY_RULER_H = 16;

/**
 * "Nice" tick steps for the history time ruler, in seconds. The ruler picks
 * the smallest step that keeps ticks ≥ ~80 px apart.
 */
const RULER_STEPS = [
  0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600,
];

function rulerStep(spanSec: number, widthPx: number): number {
  const target = (spanSec / Math.max(1, widthPx)) * 80;
  for (const s of RULER_STEPS) {
    if (s >= target) return s;
  }
  return 7200;
}

function formatRulerTime(sec: number, step: number): string {
  if (step < 1) {
    // Sub-second ticks: show fractional seconds.
    return `${sec.toFixed(step < 0.1 ? 2 : 1)}s`;
  }
  const totalSec = Math.max(0, Math.floor(sec));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  const h = Math.floor(m / 60);
  if (h > 0) {
    return `${h}:${String(m % 60).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${m}:${String(s).padStart(2, '0')}`;
}

function drawHistory(
  ctx: CanvasRenderingContext2D,
  model: HistoryModel | null | undefined,
  viewport: [number, number] | null | undefined,
  width: number,
  height: number,
  theme: Theme,
  isPopout?: boolean,
  gain: number = 1,
) {
  if (!model) {
    const p = palette(theme);
    ctx.fillStyle = p.gridStrong;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '12px ui-monospace, Consolas, monospace';
    if (isPopout) {
      ctx.fillText('History not available in pop-out', width / 2, height / 2);
    } else {
      ctx.fillText('Waiting for recording to start...', width / 2, height / 2);
    }
    return;
  }

  const count = model.peak.getCount();
  if (count === 0) return;

  const p = palette(theme);
  // Reserve the bottom strip for the time ruler when there's room for it.
  const rulerH = height >= 64 ? HISTORY_RULER_H : 0;
  const plotH = height - rulerH;
  const midY = plotH / 2;

  // Effective viewport (fit-all when none): the envelope's x-axis is the
  // viewport's span, and columnPeaks window is its bucket range — the same
  // call as Phase 1, just over a (possibly) narrowed window.
  const [vStart, vEnd] = viewport && viewport[1] > viewport[0] ? viewport : [model.oldestSec, model.newestSec];
  const span = Math.max(1e-6, vEnd - vStart);

  const columns = Math.max(1, Math.floor(width));
  const fromBucket = Math.max(0, model.secToBucket(vStart));
  const toBucket = Math.min(count, model.secToBucket(vEnd));
  const clamp = (v: number) => Math.max(-1, Math.min(1, v));

  if (toBucket - fromBucket > 1e-6) {
    const { lo, hi } = model.columnPeaks(fromBucket, toBucket, columns);
    ctx.beginPath();
    // Top envelope (maxes per column). A `lineTo` as the first path op acts
    // as a moveTo; empty columns (no bucket in this viewport column) are
    // skipped so they never paint a spike.
    for (let c = 0; c < columns; c++) {
      const mx = hi[c];
      if (!Number.isFinite(mx)) continue;
      const x = (c / columns) * width;
      ctx.lineTo(x, midY - clamp(mx * gain) * midY * 0.9); // 0.9 padding
    }
    // Bottom envelope (mins per column), reversed so the shape closes.
    for (let c = columns - 1; c >= 0; c--) {
      const mn = lo[c];
      if (!Number.isFinite(mn)) continue;
      const x = (c / columns) * width;
      ctx.lineTo(x, midY - clamp(mn * gain) * midY * 0.9);
    }
    ctx.closePath();

    ctx.fillStyle = p.wave;
    ctx.globalAlpha = 0.5;
    ctx.fill();

    ctx.strokeStyle = p.wave;
    ctx.globalAlpha = 0.8;
    ctx.stroke();

    ctx.globalAlpha = 1.0;
  }

  // "Now" marker at the live edge, only when the edge is inside the viewport.
  const newest = model.newestSec;
  if (newest >= vStart && newest <= vEnd) {
    const x = ((newest - vStart) / span) * width;
    ctx.strokeStyle = p.accent;
    ctx.globalAlpha = 0.65;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, plotH);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.lineWidth = 1;
  }

  // Time ruler along the bottom strip: adaptive ticks labelled with
  // session-relative offsets (0:00 is when the rolling session started).
  if (rulerH > 0) {
    const step = rulerStep(span, width);
    ctx.strokeStyle = p.gridStrong;
    ctx.globalAlpha = 0.5;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, plotH + 0.5);
    ctx.lineTo(width, plotH + 0.5);
    ctx.stroke();
    ctx.globalAlpha = 1;

    ctx.font = '10px ui-monospace, Consolas, monospace';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = p.gridStrong;
    ctx.textAlign = 'left';
    const first = Math.ceil(vStart / step) * step;
    for (let t = first; t <= vEnd + 1e-9; t += step) {
      const x = Math.round(((t - vStart) / span) * width) + 0.5;
      ctx.globalAlpha = 0.8;
      ctx.beginPath();
      ctx.moveTo(x, plotH + 1);
      ctx.lineTo(x, height - 1);
      ctx.stroke();
      ctx.globalAlpha = 1;
      // Skip the label when it would run past the canvas edge.
      if (x < width - 34) ctx.fillText(formatRulerTime(t, step), x + 3, plotH + rulerH / 2);
    }
  }
}

/**
 * Draw the MIDI piano-roll lane (todo.md §MIDI-1, Phase A) into its own canvas.
 *
 * The lane deliberately shares the History waveform's time axis: `layout` comes
 * from `layoutPianoRoll` with the same resolved viewport the waveform was drawn
 * with, so a note bar sits exactly over the audio it was transcribed from, at
 * any zoom or pan — no second coordinate system to keep in sync.
 *
 * Sizes are in device pixels, matching the backing store of the canvas the
 * caller passes (the board is DPR-aware, and a scaled 2D context would blur
 * every note edge).
 */
export function drawPianoRollLane(
  ctx: CanvasRenderingContext2D,
  layout: PianoRollLayout,
  theme: Theme,
  opts: { label?: string; emptyText?: string } = {},
): void {
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;
  if (w <= 0 || h <= 0) return;

  const p = palette(theme);
  drawBackground(ctx, w, h, theme);

  const laneH = layout.laneHeight;
  // Sharp-key lanes shaded, so the grid reads as a piano roll and not stripes.
  // Skipped when the lanes are too short to carry a shading difference.
  if (laneH >= 3) {
    ctx.fillStyle = p.grid;
    for (let pitch = layout.lowPitch; pitch <= layout.highPitch; pitch++) {
      if (!isSharp(pitch)) continue;
      ctx.fillRect(0, (layout.highPitch - pitch) * laneH, w, laneH);
    }
  }

  // Octave (C) rules, the one landmark that makes a pitch range readable.
  ctx.strokeStyle = p.gridStrong;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let pitch = layout.lowPitch; pitch <= layout.highPitch; pitch++) {
    if (((pitch % 12) + 12) % 12 !== 0) continue;
    const y = Math.round((layout.highPitch - pitch) * laneH) + 0.5;
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
  }
  ctx.stroke();

  // Notes. Velocity → alpha, so dynamics are visible without a legend.
  const inset = laneH >= 4 ? 1 : 0;
  const radius = Math.min(3, Math.max(0, (laneH - inset * 2) / 2));
  const canRound = typeof (ctx as { roundRect?: unknown }).roundRect === 'function';
  for (const r of layout.rects) {
    ctx.globalAlpha = 0.35 + 0.65 * r.velocity;
    ctx.fillStyle = p.wave;
    const y = r.y + inset;
    const barH = Math.max(1, r.h - inset * 2);
    if (canRound && radius > 0) {
      ctx.beginPath();
      ctx.roundRect(r.x, y, r.w, barH, radius);
      ctx.fill();
    } else {
      ctx.fillRect(r.x, y, r.w, barH);
    }
  }
  ctx.globalAlpha = 1;

  // Caption: which range this is (and how much of it is in view), or why the
  // lane is empty. Drawn last so a note can never sit on top of it.
  const text = layout.rects.length
    ? `${opts.label ? `${opts.label} · ` : ''}${layout.rects.length} note${layout.rects.length === 1 ? '' : 's'}`
    : opts.emptyText ?? 'No notes in view';
  ctx.font = '10px ui-monospace, Consolas, monospace';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = p.gridStrong;
  ctx.globalAlpha = 0.9;
  ctx.fillText(text, 4, 3);
  ctx.globalAlpha = 1;
}
