import { useEffect, useMemo, useRef, useState } from 'react';
import { VisualizerBoard } from './components/VisualizerBoard';
import { Transport } from './components/Transport';
import { TitleKnobs } from './components/TitleKnobs';
import { useSettings } from './hooks/useSettings';
import { RemoteAnalyser } from './lib/visualizer';
import { PeakBuffer } from './lib/peak-buffer';
import { HistoryModel } from './lib/history-model';
import { VizState, VisualizerMode, VISUALIZER_MODES, VISUALIZER_LABELS } from '../shared/types';

const DEFAULT_STATE: VizState = {
  capturing: false,
  hasSource: false,
  canSave: false,
  clipActive: false,
  clipStartedAt: 0,
  format: 'webm',
  bufferedSeconds: 0,
  bufferSeconds: 300,
  recordMode: 'rolling',
  theme: 'modern',
  visualizer: 'oscilloscope',
  overrideMode: null,
  rms: 0,
};

/**
 * The pop-out visualizer window (`index.html#popout`).
 *
 * It owns no audio: the main window streams analyser frames over IPC and this
 * renders them, then sends transport commands back. That keeps a single
 * capture session alive no matter how many windows are showing it, which
 * matters because the WASAPI helper can only be spawned once.
 *
 * Controls live here too (settings.popoutControls) so the pop-out can be the
 * only thing on screen — start/stop and save without going back to the main
 * window.
 */
export default function PopoutApp() {
  const { settings, loaded, update } = useSettings();
  const [state, setState] = useState<VizState>(DEFAULT_STATE);
  const [hovering, setHovering] = useState(false);
  // The analyser object is stable and mutated in place: VisualizerBoard runs
  // its own requestAnimationFrame draw loop and reads it every frame, so
  // arriving IPC frames must NOT trigger a React re-render (that would tear
  // the draw loop down and rebuild it 30 times a second).
  const analyserRef = useRef(new RemoteAnalyser());
  const lastFrameAt = useRef(0);
  const [live, setLive] = useState(false);
  
  // Create a blank PeakBuffer; we will overwrite its state from IPC
  const peakBufferRef = useRef(new PeakBuffer(15 * 60));
  // HistoryModel over the same buffer, rebuilt from every `viz:history` frame
  // with the main window's session-clock stamp — so a selection made here is
  // expressed in the same absolute seconds the main window exports (todo.md
  // §11.4 D1). Null until the first history frame arrives.
  const historyModelRef = useRef<HistoryModel | null>(null);
  // A tiny dummy state to trigger React to re-pass the ref to VisualizerBoard if needed
  const [pbRev, setPbRev] = useState(0);

  useEffect(() => {
    const offFrame = window.api.onVizFrame((f) => {
      analyserRef.current.update(f);
      lastFrameAt.current = Date.now();
      setLive(true); // no-op once true — React bails on same-value setState
    });
    const offState = window.api.onVizState((s) => {
      setState(s);
      if (s.bufferSeconds !== peakBufferRef.current.getState().capacity / 100) {
        peakBufferRef.current = new PeakBuffer(s.bufferSeconds);
        historyModelRef.current = null; // rebuilt on the next history frame
        setPbRev(r => r + 1);
      }
    });
    const offHistory = window.api.onVizHistory((s) => {
      peakBufferRef.current.setState(s);
      if (historyModelRef.current) {
        // Mutate in place — VisualizerBoard's draw loop reads this ref every
        // frame. Allocating a new model + re-rendering ~5×/s is what flickered
        // every pane while popped out / docked.
        historyModelRef.current.restamp(s.newestSec);
      } else {
        historyModelRef.current = new HistoryModel(peakBufferRef.current, s.newestSec);
        setPbRev(r => r + 1); // first frame only: mount the interaction layer
      }
    });
    return () => { offFrame(); offState(); offHistory(); };
  }, []);

  // The main window stops streaming when its source goes away; fall back to
  // the idle placeholder rather than freezing on the last frame.
  useEffect(() => {
    const id = setInterval(() => {
      if (Date.now() - lastFrameAt.current > 1200) setLive(false);
    }, 400);
    return () => clearInterval(id);
  }, []);

  // Live stopwatch for the record button + clip panel, ticked while a clip runs.
  const [clipElapsed, setClipElapsed] = useState(0);
  useEffect(() => {
    if (!state.clipActive || !state.clipStartedAt) {
      setClipElapsed(0);
      return;
    }
    const id = setInterval(() => {
      setClipElapsed(Math.max(0, (Date.now() - state.clipStartedAt) / 1000));
    }, 100);
    return () => clearInterval(id);
  }, [state.clipActive, state.clipStartedAt]);

  const analyser = useMemo(() => (live ? analyserRef.current : null), [live]);

  if (!loaded) return <div className="loading">Loading…</div>;

  // `settings.theme` is always correct here — useSettings mirrors main's
  // `settings:changed` broadcast. `state.theme` (from the frame pump) used to
  // win, which left the pop-out stuck on the DEFAULT_STATE 'modern' whenever a
  // frame hadn't arrived yet (e.g. right after docking opens this window).
  const theme = settings.theme;
  // A split pane's ⧉ pins one visualizer into this window (overrideMode is
  // sent by the main renderer over VizState). While pinned, the window shows
  // only that mode and ignores the shared split/grid settings.
  const overrideMode = state.overrideMode ?? null;
  const vizMode = overrideMode ?? state.visualizer ?? settings.visualizer;
  const forcedSingle = overrideMode !== null;
  const pianoRoll = state.pianoRoll;
  const showControls = settings.popoutControls;
  // The recording ring only means something for *bounded* recordings: a clip
  // being captured, or an explicit traditional-mode session. The always-on
  // rolling buffer gets nothing — a cue that never turns off says nothing.
  const discreteRecording =
    state.clipActive || (state.recordMode === 'traditional' && state.capturing);

  // ---- Board membership (shared with the main window via settings) -------
  // `vizHidden` is an app setting, so toggling a chip here also changes the
  // main window's board (and vice-versa) — one source of truth. One un-hidden
  // mode → a single board; several → a read-only mosaic.
  const hiddenSet = new Set(settings.vizHidden);
  const visibleModesRaw = VISUALIZER_MODES.filter((m) => !hiddenSet.has(m));
  const visibleModes = visibleModesRaw.length ? visibleModesRaw : [vizMode];
  const gridView = !forcedSingle && visibleModes.length > 1;

  const setPaneHidden = (mode: VisualizerMode, hidden: boolean) => {
    if (hidden && visibleModes.length === 1 && visibleModes[0] === mode) return;
    const next = hidden
      ? Array.from(new Set([...settings.vizHidden, mode]))
      : settings.vizHidden.filter((m) => m !== mode);
    const shownAfter = VISUALIZER_MODES.filter((m) => !next.includes(m));
    const patch: Record<string, unknown> = { vizHidden: next };
    if (!hidden) patch.visualizer = mode;
    else if (!shownAfter.includes(settings.visualizer)) patch.visualizer = shownAfter[0];
    void update(patch as never);
  };

  // Each chip is an independent on/off. A chip click also drops any single-pane
  // pin (⧉) so the chips always mean the same thing.
  const toggleMode = (mode: VisualizerMode) => {
    if (forcedSingle) window.api.sendVizCommand({ type: 'set-override', mode: null });
    setPaneHidden(mode, !hiddenSet.has(mode));
  };

  return (
    <div
      className={`popout theme-${theme} ${discreteRecording ? 'is-capturing' : ''}`}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
      onContextMenu={(e) => {
        e.preventDefault();
        window.api.showContextMenu();
      }}
    >
      <div className="popout-drag">
        <span className={`tb-dot ${state.capturing ? 'on' : ''}`} aria-hidden="true" />
        <span className="popout-title">{state.capturing ? 'recording' : 'monitor'}</span>
        {/* The pop-out IS the docked view, so it carries the quick knobs too. */}
        <TitleKnobs settings={settings} />
        {/* Record/export live in the top bar so a docked (hover-less) strip
            can still start and stop; the hover controls below keep theirs. */}
        <Transport
          capturing={state.capturing}
          canSaveNow={state.canSave}
          recordMode={state.recordMode}
          bufferSeconds={state.bufferSeconds}
          labelMode={settings.labelMode}
          onToggleCapture={() => window.api.sendVizCommand({ type: 'toggle-capture' })}
          onManualSave={() => window.api.sendVizCommand({ type: 'save' })}
          clipActive={state.clipActive}
          clipElapsed={state.clipActive ? clipElapsed : undefined}
          onToggleClip={() => window.api.sendVizCommand({ type: 'toggle-clip' })}
          clipEnabled={state.hasSource}
          format={state.format}
          tight
        />
        {/* ⇩ .mid only when the window shows the MIDI visualizer: either a
            MIDI pane exists in the grid, or the single view IS midi. */}
        {(visibleModes.includes('midi') || (forcedSingle && vizMode === 'midi')) && (
          <button type="button" className="tb-btn" title="Export the current MIDI notes as a .mid file" onClick={() => window.api.sendVizCommand({ type: 'export-midi' })}>⇩ .mid</button>
        )}
        {/* Wipe button (owner, 2026-10-13): clear the rolling buffer without
            going back to the main window — the buffer itself belongs to main;
            the command bus asks it to clear. */}
        <button
          type="button"
          className="tb-btn"
          title="Clear the rolling buffer, notes and session clock — start the session over"
          aria-label="Clear buffer"
          onClick={() => window.api.sendVizCommand({ type: 'clear-buffer' })}
        >
          ⌫
        </button>
        {forcedSingle && (
          <button
            type="button"
            className="tb-btn"
            title="Back to all views"
            onClick={() => window.api.sendVizCommand({ type: 'set-override', mode: null })}
          >
            ⊟
          </button>
        )}
        {/* Docking is the whole point of a monitor window — it wants to live
            along the top edge of a display. `windowSnap` routes to whichever
            window sent it, so this parks the pop-out, not the main window. */}
        <button
          type="button"
          className="tb-btn"
          title="Dock to top of screen"
          onClick={() => window.api.snapWindow('top')}
        >
          ⤒
        </button>
        <button
          type="button"
          className="tb-btn"
          title="Quick settings"
          onClick={() => window.api.showContextMenu()}
        >
          ⋯
        </button>
        <button
          type="button"
          className="tb-btn tb-close"
          title="Close pop-out"
          onClick={() => void window.api.togglePopout(false)}
        >
          ✕
        </button>
      </div>

      <div className="popout-board">
        {gridView ? (
          <div className={`viz-grid panes-${visibleModes.length}`}>
            {visibleModes.map((m) => (
              <div className="viz-pane" key={m}>
                <VisualizerBoard
                  analyser={analyser}
                  mode={m}
                  theme={theme}
                  gain={settings.vizGain}
                  idleText={state.hasSource ? 'waiting for audio' : 'no source selected'}
                  historyModel={historyModelRef.current}
                  interactive={m === 'history' || m === 'spectrogram'}
                  onSelectionChange={
                    m === 'history' || m === 'spectrogram'
                      ? (sel) => window.api.sendVizCommand({ type: 'selection-change', selection: sel })
                      : undefined
                  }
                  isPopout={true}
                  pianoRoll={m === 'midi' ? pianoRoll : null}
                />
                {/* The ⇩ .mid export button lives in the top bar now — a
                    pane-level one sat UNDER the ⧉/✕ cluster on narrow panes
                    (todo.md → 2026-10-13). */}
                <button
                  type="button"
                  className="viz-pane-pop"
                  title={`Show only the ${VISUALIZER_LABELS[m]} view in this window`}
                  aria-label={`Show only ${VISUALIZER_LABELS[m]} view`}
                  onClick={() =>
                    window.api.sendVizCommand({ type: 'set-override', mode: m })
                  }
                >
                  ⧉
                </button>
                <button
                  type="button"
                  className="viz-pane-x"
                  title={`Close the ${VISUALIZER_LABELS[m]} view`}
                  aria-label={`Close ${VISUALIZER_LABELS[m]} view`}
                  onClick={() => setPaneHidden(m, true)}
                >
                  ✕
                </button>
                <span className="viz-pane-tag">{VISUALIZER_LABELS[m]}</span>
              </div>
            ))}
          </div>
        ) : (
          <>
            <VisualizerBoard
              analyser={analyser}
              mode={forcedSingle ? vizMode : visibleModes[0]}
              theme={theme}
              gain={settings.vizGain}
              idleText={state.hasSource ? 'waiting for audio' : 'no source selected'}
              historyModel={historyModelRef.current}
              onSelectionChange={(sel) => {
                window.api.sendVizCommand({ type: 'selection-change', selection: sel });
              }}
              isPopout={true}
              pianoRoll={(forcedSingle ? vizMode : visibleModes[0]) === 'midi' ? pianoRoll : null}
            />
            {/* ⇩ .mid is in the top bar (see above) — no duplicate here. */}
            <span className="board-mode-tag" aria-hidden="true">
              {VISUALIZER_LABELS[forcedSingle ? vizMode : visibleModes[0]]}
            </span>
          </>
        )}
      </div>

      {showControls && (
        <div className={`popout-controls ${hovering ? 'is-shown' : ''}`}>
          {/* Record/export live in the TOP BAR only (owner, 2026-10-13): this
              floating copy duplicated them over the waveform. Only the
              visualizer chips stay down here. */}
          <div className="popout-chips">
            {VISUALIZER_MODES.map((m) => {
              const active = !forcedSingle && !hiddenSet.has(m);
              const only = active && visibleModes.length === 1;
              return (
                <button
                  key={m}
                  type="button"
                  className={`chip ${active ? 'on' : ''}`}
                  aria-pressed={active}
                  title={
                    only
                      ? `${VISUALIZER_LABELS[m]} — the only view`
                      : active
                        ? `Hide ${VISUALIZER_LABELS[m]}`
                        : `Show ${VISUALIZER_LABELS[m]}`
                  }
                  onClick={() => toggleMode(m)}
                >
                  {m === 'oscilloscope' ? '∿' : m === 'spectrum' ? '▥' : m === 'spectrogram' ? '▦' : m === 'midi' ? '🎹' : '◷'}
                </button>
              );
            })}
          </div>
        </div>
      )}

    </div>
  );
}
