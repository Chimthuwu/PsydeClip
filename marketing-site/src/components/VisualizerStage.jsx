import React, { useEffect, useRef, useState } from 'react';

/**
 * The visualizer demo the owner supplied (2026-10-13) as a standalone
 * HTML/CSS/JS block, rebuilt as a component. The site is React + Vite +
 * Tailwind with no place to put a <script> tag, and the drawing has to be
 * imperative either way (it is a rAF canvas), so only the shell became JSX.
 *
 * Four deliberate departures from the supplied block, all of them things it
 * would otherwise ship broken or contradictory:
 *
 *  1. FIVE modes, not four. The app has five (`VISUALIZER_MODES`) and this page
 *     says "five visualizers" in its own headings, so a four-tab demo would
 *     contradict the page it sits on. MIDI draws the piano roll the app
 *     captures notes into.
 *  2. The spectrogram actually scrolls. It pushed a row when `t % 2 === 0` on a
 *     `t += 0.016` accumulator — true exactly once, on frame one — so the
 *     waterfall drew a single row and never moved. Rows are pushed on a clock
 *     now, and the buffer is seeded so the waterfall starts full instead of
 *     stretching one row to fill the canvas.
 *  3. No Math.random() in the draw loop. Per-frame random noise flickers, which
 *     reads as a rendering fault rather than a signal; the noise is a sum of
 *     high-frequency sines, so the trace is smooth and reproducible.
 *  4. React lifecycle: DPR-aware sizing from a ResizeObserver (the stage can
 *     change width without a window resize), the rAF loop parked while
 *     off-screen or the tab is hidden, and every observer/listener torn down on
 *     unmount.
 *
 * The signal is synthesised, not captured — the caption says so, because the
 * hero above claims a real capture and the two must not be confused.
 */

// The site's neon tokens (tailwind.config.js), matching the app's Modern theme.
const ACCENT = '#ff00ff';
const ACCENT_2 = '#00f3ff';
const ACCENT_3 = '#8a2be2';

/** Mirrors VISUALIZER_LABELS in src/shared/types.ts — same five, same names. */
const MODES = [
  {
    id: 'oscilloscope',
    label: 'Oscilloscope',
    desc: 'instant waveform of the most recent 2048 samples',
    meta: '2048 samples · 48 kHz · stereo',
  },
  {
    id: 'spectrum',
    label: 'Spectrum',
    desc: '1024-bin FFT magnitude bars, magenta into cyan',
    meta: '1024 bins · log-freq ramp',
  },
  {
    id: 'spectrogram',
    label: 'Spectrogram',
    desc: 'scrolling waterfall of that spectrum over time',
    meta: 'frequency on Y · time on X',
  },
  {
    id: 'history',
    label: 'History',
    desc: 'scrubbable waveform of everything still in the rolling buffer',
    meta: 'drag a region out as WAV',
  },
  {
    id: 'midi',
    label: 'MIDI',
    desc: 'live pitch-tracked notes on a piano-roll grid, exportable as a .mid',
    meta: 'live pitch track · .mid export',
  },
];

/**
 * Deterministic 0..1 hash. Stands in for Math.random() so a given beat always
 * produces the same note — a flickering roll would look like a bug.
 */
function noise1(n) {
  const s = Math.sin(n * 12.9898) * 43758.5453;
  return s - Math.floor(s);
}

function drawGrid(ctx, w, h, cols, rows) {
  ctx.strokeStyle = 'rgba(255,255,255,0.045)';
  ctx.lineWidth = 1;
  for (let i = 0; i <= cols; i++) {
    const x = Math.round((i * w) / cols) + 0.5;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
  }
  for (let i = 0; i <= rows; i++) {
    const y = Math.round((i * h) / rows) + 0.5;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }
}

/** Oscilloscope and History are the same renderer with different envelopes. */
function drawWaveform(ctx, w, h, t, opts) {
  const mid = h / 2;
  const s = h / 340; // the supplied amplitudes were tuned for a 340px stage
  const grad = ctx.createLinearGradient(0, 0, w, 0);
  grad.addColorStop(0, ACCENT_3);
  grad.addColorStop(0.5, ACCENT);
  grad.addColorStop(1, ACCENT_2);

  ctx.beginPath();
  ctx.lineWidth = 2;
  ctx.strokeStyle = grad;
  ctx.shadowColor = ACCENT;
  ctx.shadowBlur = 12;

  const steps = Math.max(200, Math.min(480, Math.round(w)));
  for (let i = 0; i <= steps; i++) {
    const p = i / steps;
    const x = p * w;
    const v =
      Math.sin(p * opts.freqA + t * 2.0) * opts.ampA +
      Math.sin(p * opts.freqB + t * 3.1) * opts.ampB +
      Math.sin(p * opts.freqC + t * 1.3) * opts.ampC +
      (Math.sin(p * 617 + t * 21) + Math.sin(p * 1043 + t * 33)) * opts.noise;
    const y = mid + opts.env(p) * v * s;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.shadowBlur = 0;
}

function drawSpectrum(ctx, w, h, t) {
  const gap = 4;
  const bars = Math.max(16, Math.min(64, Math.floor(w / 16)));
  const bw = (w - gap * (bars - 1)) / bars;
  if (bw <= 0) return;

  for (let i = 0; i < bars; i++) {
    const p = i / bars;
    const bh =
      (0.22 + 0.78 * Math.pow(1 - p, 1.8)) *
      (0.55 + 0.45 * Math.abs(Math.sin(t * 1.7 + i * 0.4))) *
      h *
      0.9;
    const x = i * (bw + gap);
    const g = ctx.createLinearGradient(0, h - bh, 0, h);
    g.addColorStop(0, ACCENT_2);
    g.addColorStop(0.5, ACCENT);
    g.addColorStop(1, ACCENT_3);
    ctx.fillStyle = g;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, h - bh, bw, bh, 3);
    else ctx.rect(x, h - bh, bw, bh);
    ctx.fill();
  }
}

const SPECTRO_COLS = 90;
const SPECTRO_ROWS = 120;
const SPECTRO_STEP = 0.055; // seconds per row

function spectroRow(t) {
  const row = new Float32Array(SPECTRO_COLS);
  for (let i = 0; i < SPECTRO_COLS; i++) {
    const p = i / SPECTRO_COLS;
    row[i] =
      Math.pow(1 - p, 1.6) *
      (0.4 + 0.6 * Math.abs(Math.sin(t * 0.9 + i * 0.3))) *
      (0.5 + 0.5 * Math.sin(t * 0.3));
  }
  return row;
}

/**
 * Rows are pushed on a wall clock (the supplied `t % 2 === 0` fired once, ever)
 * and the buffer is back-filled on first draw so the waterfall is already full
 * rather than one row stretched down the whole canvas.
 */
function drawSpectrogram(ctx, w, h, t, st) {
  if (st.rows.length === 0) {
    for (let k = SPECTRO_ROWS - 1; k >= 1; k--) st.rows.push(spectroRow(t - k * SPECTRO_STEP));
    st.rowClock = t;
  }
  if (t - st.rowClock >= SPECTRO_STEP) {
    st.rowClock = t;
    st.rows.push(spectroRow(t));
    if (st.rows.length > SPECTRO_ROWS) st.rows.shift();
  }

  const rows = st.rows.length;
  if (!rows) return;
  const cellH = h / rows;
  const cellW = w / SPECTRO_COLS;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < SPECTRO_COLS; c++) {
      const v = st.rows[r][c];
      ctx.fillStyle = `hsl(${280 - v * 100}, 90%, ${8 + v * 55}%)`;
      ctx.fillRect(c * cellW, r * cellH, cellW + 1, cellH + 1);
    }
  }
}

const MIDI_LANES = 12;
const MIDI_SPAN = 8; // beats visible across the stage

/** Piano roll: notes enter at the right edge and scroll left past the playhead. */
function drawMidi(ctx, w, h, t) {
  const laneH = h / MIDI_LANES;
  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  ctx.lineWidth = 1;
  for (let i = 0; i <= MIDI_LANES; i++) {
    const y = Math.round(i * laneH) + 0.5;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }

  const scroll = t * 0.9;
  ctx.fillStyle = ACCENT;
  ctx.shadowColor = ACCENT;
  ctx.shadowBlur = 10;
  for (let b = Math.floor(scroll); b < scroll + MIDI_SPAN; b++) {
    const count = noise1(b) > 0.55 ? 2 : 1;
    for (let k = 0; k < count; k++) {
      const lane = Math.floor(noise1(b * 7.3 + k * 13.1) * MIDI_LANES);
      const start = b + noise1(b * 3.7 + k * 2.1) * 0.35;
      const len = 0.3 + noise1(b * 5.1 + k * 4.3) * 0.65;
      const p0 = (start - scroll) / MIDI_SPAN;
      if (p0 > 1 || p0 + len / MIDI_SPAN < 0) continue;
      const y = h - laneH * (lane + 1);
      ctx.beginPath();
      const bw = Math.max(3, (len / MIDI_SPAN) * w);
      if (ctx.roundRect) ctx.roundRect(p0 * w, y + 2, bw, laneH - 4, 3);
      else ctx.rect(p0 * w, y + 2, bw, laneH - 4);
      ctx.fill();
    }
  }
  ctx.shadowBlur = 0;

  // Playhead: where the live notes land.
  const playX = Math.round(w) - 0.5;
  ctx.strokeStyle = ACCENT_2;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(playX, 0);
  ctx.lineTo(playX, h);
  ctx.stroke();
}

function drawFrame(ctx, w, h, t, mode, st) {
  ctx.clearRect(0, 0, w, h);
  if (mode === 'oscilloscope') {
    drawGrid(ctx, w, h, 12, 6);
    drawWaveform(ctx, w, h, t, {
      env: (p) => Math.sin(p * Math.PI),
      freqA: 42,
      freqB: 97,
      freqC: 23,
      ampA: 30,
      ampB: 12,
      ampC: 18,
      noise: 5,
    });
  } else if (mode === 'history') {
    drawGrid(ctx, w, h, 12, 6);
    drawWaveform(ctx, w, h, t, {
      env: (p) => Math.sin(p * Math.PI * 1.4) * (0.7 + 0.3 * Math.sin(p * 12 + t * 0.5)),
      freqA: 34,
      freqB: 81,
      freqC: 19,
      ampA: 26,
      ampB: 14,
      ampC: 20,
      noise: 4,
    });
  } else if (mode === 'spectrum') {
    drawSpectrum(ctx, w, h, t);
  } else if (mode === 'spectrogram') {
    drawSpectrogram(ctx, w, h, t, st);
  } else if (mode === 'midi') {
    drawMidi(ctx, w, h, t);
  }
}

export default function VisualizerStage() {
  const [mode, setMode] = useState('oscilloscope');
  const canvasRef = useRef(null);
  const modeRef = useRef(mode);
  const repaintRef = useRef(() => {});
  const tabRefs = useRef([]);
  /** Per-mode scratch: the waterfall's rows, and the clock that feeds them. */
  const stateRef = useRef({ rows: [], rowClock: 0 });

  // Switching modes throws the waterfall away, so it starts clean rather than
  // resuming a buffer from a different mode's timeline.
  useEffect(() => {
    modeRef.current = mode;
    stateRef.current.rows = [];
    stateRef.current.rowClock = 0;
    repaintRef.current();
  }, [mode]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const ctx = canvas.getContext('2d');
    if (!ctx) return undefined;

    let w = 0;
    let h = 0;
    let raf = 0;
    let tNow = 6; // a non-zero start, so the first frame is not a flat line
    let onScreen = false;
    const st = stateRef.current;

    const paint = () => {
      if (w < 2 || h < 2) return;
      drawFrame(ctx, w, h, tNow, modeRef.current, st);
    };

    const size = () => {
      const rect = canvas.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = rect.width;
      h = rect.height;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const stop = () => {
      if (raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
    };

    const loop = (now) => {
      tNow = now / 1000;
      paint();
      raf = requestAnimationFrame(loop);
    };

    const start = () => {
      if (raf || !onScreen || document.hidden) return;
      raf = requestAnimationFrame(loop);
    };

    /** One frame at the current clock — used for a resize or a mode switch. */
    repaintRef.current = () => {
      size();
      paint();
    };

    const ro = new ResizeObserver(() => {
      size();
      paint();
      start();
    });
    ro.observe(canvas);

    // Parked while off-screen: this page runs several animations already and
    // the demo should not compete with them.
    const io = new IntersectionObserver(
      ([entry]) => {
        onScreen = entry.isIntersecting;
        if (onScreen) {
          size();
          paint();
          start();
        } else {
          stop();
        }
      },
      { rootMargin: '120px' },
    );
    io.observe(canvas);

    const onVisibility = () => {
      if (document.hidden) stop();
      else start();
    };
    document.addEventListener('visibilitychange', onVisibility);

    size();
    paint();
    start();

    return () => {
      stop();
      ro.disconnect();
      io.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      repaintRef.current = () => {};
    };
  }, []);

  // Left/right/Home/End move between tabs, the way a real tablist behaves.
  const onTabKeyDown = (event) => {
    const i = MODES.findIndex((m) => m.id === mode);
    let next = null;
    if (event.key === 'ArrowRight') next = (i + 1) % MODES.length;
    else if (event.key === 'ArrowLeft') next = (i - 1 + MODES.length) % MODES.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = MODES.length - 1;
    if (next === null) return;
    event.preventDefault();
    setMode(MODES[next].id);
    tabRefs.current[next]?.focus();
  };

  const active = MODES.find((m) => m.id === mode) ?? MODES[0];

  return (
    <div>
      <div
        role="tablist"
        aria-label="Visualizer mode"
        className="flex flex-wrap gap-2 mb-7"
      >
        {MODES.map((m, i) => {
          const selected = m.id === mode;
          return (
            <button
              key={m.id}
              ref={(el) => {
                tabRefs.current[i] = el;
              }}
              type="button"
              role="tab"
              aria-selected={selected}
              tabIndex={selected ? 0 : -1}
              onClick={() => setMode(m.id)}
              onKeyDown={onTabKeyDown}
              className={`px-5 py-2.5 rounded-full border font-mono text-[13px] transition-all duration-200 ${
                selected
                  ? 'bg-neon-cyan/10 border-neon-cyan/40 text-neon-cyan'
                  : 'border-white/10 text-gray-400 hover:text-white hover:border-neon-cyan/30'
              }`}
            >
              {m.label}
            </button>
          );
        })}
      </div>

      <div className="rounded-[28px] overflow-hidden border border-white/10 bg-[#0A0A0F] shadow-[0_20px_60px_-20px_rgba(0,0,0,0.8)]">
        <canvas
          ref={canvasRef}
          aria-label={`${active.label} visualizer, illustrated with a simulated signal`}
          className="block w-full h-[220px] sm:h-[340px]"
        />
        <div className="px-6 py-4 border-t border-white/10 flex flex-wrap items-center justify-between gap-3 text-sm text-gray-400">
          <span>
            <strong className="text-white font-semibold">{active.label}</strong> — {active.desc}
          </span>
          <span className="font-mono text-xs text-gray-500">{active.meta}</span>
        </div>
      </div>

      <p className="mt-3 text-xs text-gray-500">
        Drawn with a simulated signal so the demo can idle in a browser — the hero capture above is
        the app running for real.
      </p>
    </div>
  );
}
