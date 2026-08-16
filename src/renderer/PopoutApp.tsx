import { useEffect, useMemo, useRef, useState } from 'react';
import { VisualizerBoard } from './components/VisualizerBoard';
import { Transport } from './components/Transport';
import { useSettings } from './hooks/useSettings';
import { RemoteAnalyser } from './lib/visualizer';
import { VizState, VisualizerMode } from '../shared/types';

const DEFAULT_STATE: VizState = {
  capturing: false,
  hasSource: false,
  canSave: false,
  bufferedSeconds: 0,
  bufferSeconds: 900,
  recordMode: 'rolling',
  theme: 'modern',
  visualizer: 'oscilloscope',
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
  const { settings, loaded } = useSettings();
  const [state, setState] = useState<VizState>(DEFAULT_STATE);
  const [hovering, setHovering] = useState(false);
  // The analyser object is stable and mutated in place: VisualizerBoard runs
  // its own requestAnimationFrame draw loop and reads it every frame, so
  // arriving IPC frames must NOT trigger a React re-render (that would tear
  // the draw loop down and rebuild it 30 times a second).
  const analyserRef = useRef(new RemoteAnalyser());
  const lastFrameAt = useRef(0);
  const [live, setLive] = useState(false);

  useEffect(() => {
    const offFrame = window.api.onVizFrame((f) => {
      analyserRef.current.update(f);
      lastFrameAt.current = Date.now();
      setLive(true); // no-op once true — React bails on same-value setState
    });
    const offState = window.api.onVizState((s) => setState(s));
    return () => { offFrame(); offState(); };
  }, []);

  // The main window stops streaming when its source goes away; fall back to
  // the idle placeholder rather than freezing on the last frame.
  useEffect(() => {
    const id = setInterval(() => {
      if (Date.now() - lastFrameAt.current > 1200) setLive(false);
    }, 400);
    return () => clearInterval(id);
  }, []);

  const analyser = useMemo(() => (live ? analyserRef.current : null), [live]);

  if (!loaded) return <div className="loading">Loading…</div>;

  const theme = state.theme ?? settings.theme;
  const vizMode = state.visualizer ?? settings.visualizer;
  const showControls = settings.popoutControls;

  return (
    <div
      className={`popout theme-${theme} ${state.capturing ? 'is-capturing' : ''}`}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
    >
      <div className="popout-drag">
        <span className={`tb-dot ${state.capturing ? 'on' : ''}`} aria-hidden="true" />
        <span className="popout-title">{state.capturing ? 'recording' : 'monitor'}</span>
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
        <VisualizerBoard
          analyser={analyser}
          mode={vizMode}
          theme={theme}
          idleText={state.hasSource ? 'waiting for audio' : 'no source selected'}
        />
      </div>

      {showControls && (
        <div className={`popout-controls ${hovering ? 'is-shown' : ''}`}>
          <Transport
            capturing={state.capturing}
            canSaveNow={state.canSave}
            recordMode={state.recordMode}
            bufferSeconds={state.bufferSeconds}
            labelMode={settings.labelMode}
            onToggleCapture={() => window.api.sendVizCommand({ type: 'toggle-capture' })}
            onManualSave={() => window.api.sendVizCommand({ type: 'save' })}
            tight
          />
          <div className="popout-chips">
            {(['oscilloscope', 'spectrum', 'spectrogram'] as VisualizerMode[]).map((m) => (
              <button
                key={m}
                type="button"
                className={`chip ${vizMode === m ? 'on' : ''}`}
                title={m}
                onClick={() => window.api.sendVizCommand({ type: 'set-visualizer', mode: m })}
              >
                {m === 'oscilloscope' ? '∿' : m === 'spectrum' ? '▥' : '▦'}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
