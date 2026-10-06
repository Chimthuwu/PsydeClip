import { useEffect, useRef, useState } from 'react';
import { AnalyserLike, drawVisualizer, drawPianoRollLane, SPECTRO_VISIBLE_SEC } from '../lib/visualizer';
import { Theme, VisualizerMode } from '../../shared/types';
import { layoutPianoRoll } from '../../shared/piano-roll';
import type { NoteLayer } from '../lib/note-store';

import { HistoryModel, ViewportState } from '../lib/history-model';

/** Height of the MIDI piano-roll lane, in CSS px. */
const MIDI_LANE_H = 54;
/**
 * Below this board height the lane is dropped rather than squeezing the
 * waveform — a docked strip is ~100px tall and the waveform is the hero.
 */
const MIDI_LANE_MIN_BOARD_H = 140;

/**
 * Safe stand-in for the draw path when only the history mode is active and no
 * capture is bound yet: `drawVisualizer` calls `analyser.sample()`, and a bare
 * `{}` cast threw on frame one whenever history was the active mode without a
 * source (the draw loop died on startup and the board froze on its backdrop).
 */
const STUB_ANALYSER: AnalyserLike = {
  timeData: new Float32Array(0),
  freqData: new Float32Array(0),
  analyser: { minDecibels: -90, maxDecibels: -10 },
  sample: () => ({ rms: 0 }),
};

interface Props {
  analyser: AnalyserLike | null;
  mode: VisualizerMode;
  theme: Theme;
  className?: string;
  /** Placeholder text shown when nothing is bound. */
  idleText?: string;
  /**
   * The historical-waveform model (peak track + session clock). The history
   * draw needs it, and the interactive selection layer maps display positions
   * to absolute session seconds through it (todo.md §11.4 Phase 1).
   */
  historyModel?: HistoryModel | null;
  isPopout?: boolean;
  /**
   * False for split-view panes: the history pane there is a read-only
   * overview, so no selection drag / drag-export / zoom layer is attached.
   */
  interactive?: boolean;
  /**
   * Visualizer sensitivity multiplier (1 = neutral). Display-only: scales
   * the drawing, never the captured audio.
   */
  gain?: number;
  /** True once App has a temp file ready for the current selection. */
  dragReady?: boolean;
  /**
   * Transcribed notes to draw under the History waveform (todo.md §MIDI-1
   * Phase A). Absolute session seconds, so the lane shares the waveform's
   * viewport exactly. Null/absent = no lane.
   */
  pianoRoll?: NoteLayer | null;
  /** Shown as a ♪ affordance on the selection; absent = no button. */
  onTranscribeSelection?: () => void;
  onSelectionChange?: (sel: [number, number] | null) => void;
  onDragExport?: (sel: [number, number]) => void;
  /** Called when the user tries to drag before the snippet is prepared. */
  onDragNotReady?: () => void;
}

/**
 * The visible time window `[startSec, endSec]` for whichever timeline mode is
 * showing. History honours the user's zoom/pan viewport; the spectrogram is a
 * fixed, always-following window `SPECTRO_VISIBLE_SEC` wide (its scroll is
 * wall-clock driven, so this lines up with the pixels exactly).
 */
function timelineView(
  model: HistoryModel,
  viewport: ViewportState | null,
  mode: VisualizerMode,
): [number, number] {
  if (mode === 'spectrogram') {
    const end = model.newestSec;
    return [Math.max(0, end - SPECTRO_VISIBLE_SEC), end];
  }
  return model.effectiveViewport(viewport);
}

export function VisualizerBoard({ analyser, mode, theme, className, idleText, historyModel, isPopout = false, interactive = true, gain = 1, dragReady = true, pianoRoll = null, onTranscribeSelection, onSelectionChange, onDragExport, onDragNotReady }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const laneRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);

  // Room for the lane: only shown while the board is tall enough to give the
  // waveform its majority. Tracked as state (not a ref) because it changes the
  // rendered tree; only transitions re-render.
  const [laneRoom, setLaneRoom] = useState(false);
  const laneOn = !!pianoRoll && laneRoom && mode === 'history';

  // Selection is stored as ABSOLUTE session seconds (D1) — never fractions of
  // the buffer — so it survives zooming, panning and the ring wrapping, and
  // maps onto the exporters' own time bases (todo.md §11.4 Phase 1).
  const [selection, setSelection] = useState<[number, number] | null>(null);
  // Zoom/pan viewport (Phase 2). Null = fit-all: the whole buffer at the
  // live edge. `following` viewports slide with the live edge.
  const [viewport, setViewport] = useState<ViewportState | null>(null);

  // Live mirrors of the above, so the rAF draw loop and the (attach-once,
  // native) wheel listener always see fresh values without re-creating
  // themselves on every state change.
  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  const viewportRef = useRef(viewport);
  viewportRef.current = viewport;
  const modelRef = useRef(historyModel);
  modelRef.current = historyModel;
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const interactiveRef = useRef(interactive);
  interactiveRef.current = interactive;
  const pianoRollRef = useRef(pianoRoll);
  pianoRollRef.current = pianoRoll;

  // History and the (time-based) spectrogram both carry a real time axis, so
  // both get the highlight + drag-out selection layer. Only history is
  // zoom/pan-able — the spectrogram has no data outside its visible window.
  const isTimeline = mode === 'history' || mode === 'spectrogram';

  const handleDragStart = (e: React.DragEvent) => {
    e.preventDefault(); // crucial for electron drag
    if (!dragReady) {
      onDragNotReady?.();
      return;
    }
    window.api.startDragExportPrepared();
  };

  const dragState = useRef<{
    type: 'new' | 'left' | 'right';
    startSec: number;
    initialSelection: [number, number];
  } | null>(null);
  const panState = useRef<{ startX: number; view: [number, number] } | null>(null);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isTimeline || !historyModel) return;
    const target = e.target as HTMLElement;

    // Middle-drag or Shift+drag pans the viewport (RS parity) — history only.
    if ((e.button === 1 || e.shiftKey) && mode === 'history') {
      e.preventDefault();
      const v = historyModel.effectiveViewport(viewport);
      panState.current = { startX: e.clientX, view: [v[0], v[1]] };
      e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }

    // Ignore down events on the selection background itself so native drag works
    if (target.classList.contains('history-selection') || target.classList.contains('history-selection-border') || target.classList.contains('history-duration')) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;

    let type: 'new' | 'left' | 'right' = 'new';

    if (target.classList.contains('left')) type = 'left';
    else if (target.classList.contains('right')) type = 'right';

    const v = timelineView(historyModel, viewport, mode);
    const startSec = historyModel.clampSec(v[0] + x * (v[1] - v[0]));
    dragState.current = {
      type,
      startSec,
      initialSelection: selection || [startSec, startSec],
    };

    if (type === 'new') {
      setSelection([startSec, startSec]);
    }

    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isTimeline || !historyModel) return;
    const rect = e.currentTarget.getBoundingClientRect();

    if (panState.current) {
      const dFrac = (panState.current.startX - e.clientX) / Math.max(1, rect.width);
      const [v0, v1] = panState.current.view;
      setViewport(historyModel.panViewport([v0, v1], dFrac * (v1 - v0)));
      return;
    }

    if (!dragState.current) return;
    const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const { type, startSec, initialSelection } = dragState.current;
    const v = timelineView(historyModel, viewport, mode);
    const sec = historyModel.clampSec(v[0] + x * (v[1] - v[0]));

    if (type === 'new') {
      setSelection([Math.min(startSec, sec), Math.max(startSec, sec)]);
    } else if (type === 'left') {
      setSelection([Math.min(sec, initialSelection[1]), Math.max(sec, initialSelection[1])]);
    } else if (type === 'right') {
      setSelection([Math.min(initialSelection[0], sec), Math.max(initialSelection[0], sec)]);
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragState.current && !panState.current) return;
    e.currentTarget.releasePointerCapture(e.pointerId);
    const wasPan = !!panState.current;
    dragState.current = null;
    panState.current = null;
    if (wasPan || !historyModel) return;

    setSelection(currentSel => {
      // A drag smaller than 0.1% of the visible span is a click, not a
      // selection — the same threshold the fractional code used, now relative
      // to the zoomed viewport so tiny selections stay possible when zoomed in.
      const v = timelineView(historyModel, viewport, mode);
      const minSel = 0.001 * Math.max(1e-6, v[1] - v[0]);
      if (currentSel && currentSel[1] - currentSel[0] < minSel) {
        onSelectionChange?.(null);
        return null;
      }
      onSelectionChange?.(currentSel);
      return currentSel;
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!isTimeline || !historyModel) return;
    const v = timelineView(historyModel, viewport, mode);
    const span = v[1] - v[0];

    // Zoom around the selection when one exists (RS: "make a selection and
    // roll the wheel to zoom"), else around the visible center. History only —
    // the spectrogram has nothing outside its window to zoom into.
    const zoomAnchor = () =>
      selection && selection[1] > selection[0] ? (selection[0] + selection[1]) / 2 : (v[0] + v[1]) / 2;

    if (mode === 'history' && (e.key === '+' || e.key === '=')) {
      setViewport(historyModel.zoomViewport([v[0], v[1]], zoomAnchor(), 1 / 1.4));
      e.preventDefault();
      return;
    }
    if (mode === 'history' && (e.key === '-' || e.key === '_')) {
      setViewport(historyModel.zoomViewport([v[0], v[1]], zoomAnchor(), 1.4));
      e.preventDefault();
      return;
    }

    if (!selection) return;
    // Nudge by 0.5% of the visible span (Shift = 5×) — proportional to the
    // zoom, so nudging stays fine-grained when zoomed into a transient.
    const nudge = 0.005 * span;
    if (e.key === 'ArrowLeft') {
      const shift = e.shiftKey ? nudge * 5 : nudge;
      const newLeft = historyModel.clampSec(selection[0] - shift);
      const diff = selection[0] - newLeft;
      const newSel: [number, number] = [newLeft, historyModel.clampSec(selection[1] - diff)];
      setSelection(newSel);
      onSelectionChange?.(newSel);
      e.preventDefault();
    } else if (e.key === 'ArrowRight') {
      const shift = e.shiftKey ? nudge * 5 : nudge;
      const newRight = historyModel.clampSec(selection[1] + shift);
      const diff = newRight - selection[1];
      const newSel: [number, number] = [historyModel.clampSec(selection[0] + diff), newRight];
      setSelection(newSel);
      onSelectionChange?.(newSel);
      e.preventDefault();
    } else if (e.key === 'Escape') {
      setSelection(null);
      onSelectionChange?.(null);
      e.preventDefault();
    }
  };

  /** Double-click returns to fit-all (the whole buffered window at "now"). */
  const handleDoubleClick = () => {
    if (mode !== 'history') return;
    setViewport(null);
  };

  // Wheel zoom. Attached as a NATIVE non-passive listener on the wrapper —
  // React's synthetic onWheel cannot stop ctrl+wheel page zoom reliably.
  const wheelHandlerRef = useRef<(e: WheelEvent) => void>(() => {});
  wheelHandlerRef.current = (e) => {
    if (!modelRef.current || modeRef.current !== 'history' || !interactiveRef.current) return;
    e.preventDefault();
    const model = modelRef.current;
    const v = model.effectiveViewport(viewportRef.current);
    const span = v[1] - v[0];
    // Anchor: the selection's center when one exists (RS behaviour), else the
    // cursor position within the visible span.
    let anchorSec: number;
    const sel = selectionRef.current;
    const rect = wrapRef.current?.getBoundingClientRect();
    if (sel && sel[1] > sel[0]) {
      anchorSec = (sel[0] + sel[1]) / 2;
    } else if (rect && rect.width > 0) {
      anchorSec = v[0] + Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)) * span;
    } else {
      anchorSec = (v[0] + v[1]) / 2;
    }
    const factor = Math.exp(-e.deltaY * 0.002); // ≈1.22 per wheel notch
    setViewport(model.zoomViewport(v, anchorSec, factor));
  };
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => wheelHandlerRef.current(e);
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let raf = 0;

    const fit = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = Math.max(1, Math.floor(rect.width * dpr));
      const h = Math.max(1, Math.floor(rect.height * dpr));
      // Assigning canvas.width/height wipes the bitmap even when the value is
      // unchanged — so only touch it on a real size change, or the pane flashes
      // blank every time this runs.
      if (canvas.width !== w) canvas.width = w;
      if (canvas.height !== h) canvas.height = h;

      // The lane gets its own backing store at the same DPR, so note edges
      // land on whole device pixels instead of being resampled.
      const lane = laneRef.current;
      if (lane) {
        const lw = Math.max(1, Math.floor(rect.width * dpr));
        const lh = Math.max(1, Math.floor(MIDI_LANE_H * dpr));
        if (lane.width !== lw) lane.width = lw;
        if (lane.height !== lh) lane.height = lh;
      }
      // Dropped on a short board (a docked strip): the waveform keeps its room.
      const room = rect.height >= MIDI_LANE_MIN_BOARD_H;
      setLaneRoom((prev) => (prev === room ? prev : room));
    };
    fit();
    // The canvas box changes for reasons other than a window resize — the
    // footer chip row wrapping, the HUD gaining/losing the error line, a
    // breakpoint firing — so observe the element itself, not just `window`.
    const ro = new ResizeObserver(fit);
    ro.observe(canvas);
    if (laneRef.current) ro.observe(laneRef.current);
    window.addEventListener('resize', fit);

    const draw = () => {
      // Read the model from the ref, never the closure: in the pop-out it's
      // rebuilt from every `viz:history` frame (~5×/s), and having it in this
      // effect's deps tore down and recreated the whole rAF loop that often —
      // which flashed every pane blank.
      const model = modelRef.current;
      if (analyser || mode === 'history' || mode === 'spectrogram') {
        // Resolve the visible time window fresh every frame: a `following`
        // history viewport (and the spectrogram's fixed window) both slide with
        // the live edge even though React state only changes on gestures.
        const v = model ? timelineView(model, viewportRef.current, mode) : null;
        drawVisualizer(
          {
            ctx: ctx as unknown as CanvasRenderingContext2D,
            width: canvas.width,
            height: canvas.height,
            theme,
            mode,
            rms: 0,
            historyModel: model,
            viewport: v,
            isPopout,
            gain,
          },
          analyser || STUB_ANALYSER,
        );

        // Keep the selection overlay pinned to the selection's absolute
        // seconds as the view slides (following) or zooms. Direct style
        // writes from the frame loop — no React re-render needed.
        const selEl = overlayRef.current;
        const sel = selectionRef.current;
        if (selEl && sel && model && v) {
          const span = v[1] - v[0];
          const f0 = span > 0 ? (sel[0] - v[0]) / span : 0;
          const f1 = span > 0 ? (sel[1] - v[0]) / span : 0;
          const c0 = Math.max(0, Math.min(1, f0));
          const c1 = Math.max(0, Math.min(1, f1));
          selEl.style.left = `${c0 * 100}%`;
          selEl.style.width = `${Math.max(0, c1 - c0) * 100}%`;
        }

        // The MIDI lane, drawn from the SAME resolved viewport as the waveform
        // above it — that is what keeps a note bar over its own audio at every
        // zoom and pan. Layout maths live in src/shared/piano-roll.ts.
        const lane = laneRef.current;
        const layer = pianoRollRef.current;
        if (lane && laneOn && layer && v) {
          const lctx = lane.getContext('2d');
          if (lctx) {
            const layout = layoutPianoRoll(layer.notes, {
              startSec: v[0],
              endSec: v[1],
              width: lane.width,
              height: lane.height,
            });
            drawPianoRollLane(lctx, layout, theme, { label: layer.label });
          }
        }
      } else {
        // Idle screen: pulsing placeholder.
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        let grad: CanvasGradient;
        if (theme === 'modern') {
          grad = ctx.createLinearGradient(0, 0, 0, canvas.height);
          grad.addColorStop(0, '#0c1133');
          grad.addColorStop(1, '#070a1c');
        } else {
          grad = ctx.createLinearGradient(0, 0, 0, canvas.height);
          grad.addColorStop(0, '#001100');
          grad.addColorStop(1, '#000000');
        }
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = theme === 'classic' ? '#003300' : 'rgba(120,150,255,0.15)';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        // Drop to the terse message once the long one can't fit, and cap the
        // font size off the width too so it never runs past the canvas edges.
        const long = idleText ?? 'Pick a source and press Start';
        const msg = canvas.width < 260 ? 'no source' : long;
        const size = Math.max(
          8,
          Math.floor(Math.min(canvas.height / 14, (canvas.width * 0.82) / (msg.length * 0.6))),
        );
        ctx.font = `${size}px ui-monospace, Consolas, monospace`;
        ctx.fillText(msg, canvas.width / 2, canvas.height / 2);
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener('resize', fit);
    };
    // NB: historyModel and selection are deliberately NOT deps — the loop reads
    // them from refs. In the pop-out historyModel changes ~5×/s and restarting
    // the loop that often flickered every pane. `laneOn` IS a dep: it adds or
    // removes a canvas, which has to be measured before it can be drawn into.
  }, [analyser, mode, theme, idleText, interactive, isPopout, gain, laneOn]);

  // Initial overlay geometry at render; the rAF loop keeps it exact between
  // renders as the view slides or zooms.
  let overlayStyle: React.CSSProperties | undefined;
  if (selection && historyModel) {
    const v = timelineView(historyModel, viewport, mode);
    const span = v[1] - v[0];
    const f0 = span > 0 ? (selection[0] - v[0]) / span : 0;
    const f1 = span > 0 ? (selection[1] - v[0]) / span : 0;
    const c0 = Math.max(0, Math.min(1, f0));
    const c1 = Math.max(0, Math.min(1, f1));
    overlayStyle = { left: `${c0 * 100}%`, width: `${Math.max(0, c1 - c0) * 100}%` };
  }

  return (
    <div ref={wrapRef} className={className} style={{ position: 'relative', width: '100%', height: '100%' }}>
      <canvas ref={canvasRef} style={{ display: 'block', width: '100%', height: '100%' }} />
      {isTimeline && historyModel && interactive && (
        <div
          className={`history-interaction-layer${mode === 'spectrogram' ? ' is-spectro' : ''}`}
          tabIndex={0}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onKeyDown={handleKeyDown}
          onDoubleClick={handleDoubleClick}
        >
          {selection && (
            <div
              ref={overlayRef}
              className="history-selection"
              draggable={true}
              onDragStart={handleDragStart}
              style={overlayStyle}
            >
              <div className="history-selection-border" style={{ width: '100%' }} />
              <div className="history-duration">
                {(selection[1] - selection[0]).toFixed(2)}s
              </div>
              <div className="history-handle left" />
              <div className="history-handle right" />
            </div>
          )}
        </div>
      )}
    </div>
  );
}