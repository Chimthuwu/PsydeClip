import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { HUD } from './components/HUD';
import { TitleBar } from './components/TitleBar';
import { Transport } from './components/Transport';
import { VisualizerBoard } from './components/VisualizerBoard';
import { SourcePicker } from './components/SourcePicker';
import { SettingsPanel } from './components/SettingsPanel';
import { ToastStack } from './components/ToastStack';
import { useSettings } from './hooks/useSettings';
import { useCapture } from './hooks/useCapture';
import { useRecorderEvents } from './hooks/useRecorderEvents';
import { AppSettings, VisualizerMode } from '../shared/types';

const LOOPBACK_SUPPORTED_PLATFORMS = new Set(['win32']);

/** Pop-out frame rate. 30fps is plenty for a visualizer and a third of the
 *  IPC traffic of streaming every animation frame. */
const VIZ_FRAME_MS = 33;

export default function App() {
  const { settings, loaded, update } = useSettings();
  const [capturing, setCapturing] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const capture = useCapture(settings, capturing);
  const { state: cs } = capture;

  const loopbackSupported = LOOPBACK_SUPPORTED_PLATFORMS.has(window.api.platform);

  // Hotkey handler — mode-aware:
  //  - rolling:        snapshot the rolling buffer and save it
  //  - traditional:    if currently recording -> stop and save; otherwise start
  const handleHotkey = useCallback(async () => {
    if (!cs.recorder) {
      // No source bound yet. Fall back to: just toggle capturing on.
      if (settings.sourceId) setCapturing(true);
      return;
    }

    if (settings.recordMode === 'traditional') {
      if (cs.recorder.isActive()) {
        // Stop & auto-save.
        const blob = await cs.recorder.stop();
        const folder = settings.saveFolder;
        if (folder && blob.size > 0) {
          const buf = new Uint8Array(await blob.arrayBuffer());
          const dur = cs.recorder.bufferedDuration();
          const res = await window.api.saveRecording({ folder, bytes: buf, durationSec: dur, deviceName: selectDeviceName() });
          if (res.ok) {
            window.dispatchEvent(new CustomEvent('recordr:local-toast', {
              detail: { kind: 'saved', message: `Saved ${(res.bytes! / 1024).toFixed(1)} KB (${dur.toFixed(1)}s)\n${(res.path ?? '').split(/[\\/]/).pop()}` },
            }));
          }
        }
        setCapturing(false);
      } else {
        setCapturing(true);
      }
      return;
    }

    // Rolling mode: just snapshot.
    const folder = settings.saveFolder;
    if (!folder) {
      alert('Pick a save folder in Settings first.');
      return;
    }
    const blob = await cs.recorder.snapshotBuffer();
    if (blob.size === 0) return;
    const buf = new Uint8Array(await blob.arrayBuffer());
    const dur = cs.recorder.bufferedDuration();
    const res = await window.api.saveRecording({ folder, bytes: buf, durationSec: dur, deviceName: selectDeviceName() });
    if (res.ok) {
      window.dispatchEvent(new CustomEvent('recordr:local-toast', {
        detail: { kind: 'saved', message: `Saved ${(res.bytes! / 1024).toFixed(1)} KB (${dur.toFixed(1)}s)\n${(res.path ?? '').split(/[\\/]/).pop()}` },
      }));
    }
  }, [cs.recorder, settings.recordMode, settings.saveFolder, settings.sourceId, settings.loopbackDeviceId, cs.loopbackDevices, cs.sources]);

  /** Pick a friendly device/source name for the {device} filename token. */
  function selectDeviceName(): string | undefined {
    if (settings.captureBackend === 'loopback' && settings.loopbackDeviceId) {
      const d = cs.loopbackDevices.find((x) => x.id === settings.loopbackDeviceId);
      return d?.name;
    }
    if (settings.sourceId) {
      const s = cs.sources.find((x) => x.id === settings.sourceId);
      return s?.name;
    }
    return undefined;
  }

  // Manually-triggered save (always a snapshot). Only meaningful in rolling mode.
  const performSave = useCallback(async () => {
    if (!cs.recorder) return;
    const folder = settings.saveFolder;
    if (!folder) {
      alert('Pick a save folder in Settings first.');
      return;
    }
    const blob = await cs.recorder.snapshotBuffer();
    if (blob.size === 0) return;
    const buf = new Uint8Array(await blob.arrayBuffer());
    const dur = cs.recorder.bufferedDuration();
    const res = await window.api.saveRecording({ folder, bytes: buf, durationSec: dur, deviceName: selectDeviceName() });
    if (res.ok) {
      window.dispatchEvent(new CustomEvent('recordr:local-toast', {
        detail: { kind: 'saved', message: `Saved ${(res.bytes! / 1024).toFixed(1)} KB (${dur.toFixed(1)}s)\n${(res.path ?? '').split(/[\\/]/).pop()}` },
      }));
    }
  }, [cs.recorder, settings.saveFolder, settings.captureBackend, settings.sourceId, settings.loopbackDeviceId, cs.loopbackDevices, cs.sources, selectDeviceName]);

  // Bridge local-toast events into the same toast array as 'recording:event'.
  const [toasts, setToasts] = useState<{ id: number; kind: 'saved' | 'error'; message: string }[]>([]);
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as any;
      const id = Date.now() + Math.random();
      setToasts((t) => [...t, { id, ...detail }].slice(-3));
      setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000);
    };
    window.addEventListener('recordr:local-toast', handler);
    return () => window.removeEventListener('recordr:local-toast', handler);
  }, []);

  // When settings.alwaysOnTop changes, push it to the main process so the
  // window gets re-pinned immediately (the tray menu is rebuilt by main
  // via its onSettingsChanged callback so we don't need to touch it here).
  useEffect(() => {
    if (loaded) window.api.setAlwaysOnTop(settings.alwaysOnTop);
  }, [settings.alwaysOnTop, loaded]);

  // Layout drives the window's minimum size (and shrinks it to a strip for
  // `bar`), which only main can set.
  useEffect(() => {
    if (loaded) window.api.applyLayout(settings.uiLayout);
  }, [settings.uiLayout, loaded]);

  // Mirror our local capturing state into the tray so its title, overlay
  // badge, tooltip and elapsed-time ticker stay in sync.
  useEffect(() => {
    if (loaded) window.api.setTrayCapturing(capturing);
  }, [capturing, loaded]);

  // A 38px-tall bar has nowhere to draw a modal, so opening settings from
  // that layout grows the window for as long as the panel is up.
  const barLayout = settings.uiLayout === 'bar';
  const openSettingsPanel = useCallback(() => {
    if (barLayout) window.api.tempExpandWindow(640);
    setSettingsOpen(true);
  }, [barLayout]);
  const closeSettingsPanel = useCallback(() => {
    setSettingsOpen(false);
    if (barLayout) window.api.tempExpandWindow(null);
  }, [barLayout]);

  // Listen for "open settings" requests from the tray menu.
  useEffect(() => {
    const unsub = window.api.onOpenSettingsRequest(() => openSettingsPanel());
    return unsub;
  }, [openSettingsPanel]);

  // Pop-out lifecycle: main owns the window and persists whether it's up, so
  // settings.popoutOpen is the single source of truth — no matter whether the
  // toggle came from here, the tray menu, or the pop-out's own ✕.
  const popoutOpen = loaded && settings.popoutOpen;

  const togglePopout = useCallback(() => {
    void window.api.togglePopout();
  }, []);

  const events = useRecorderEvents({
    onHotkey: handleHotkey,
  });
  // Merge local-toast and event toasts.
  const mergedToasts = toasts.concat(events.toasts).slice(-3);

  const canSaveNow = useMemo(() => {
    if (!cs.recorder) return false;
    if (!settings.saveFolder) return false;
    if (settings.recordMode === 'traditional' && !cs.recorder.isActive()) return false;
    return cs.recorder.bufferedDuration() > 0 || cs.recorder.isActive();
  }, [cs.recorder, settings.recordMode, settings.saveFolder, cs.stream]);

  const toggleCapture = useCallback(() => {
    if (!settings.sourceId && !settings.loopbackDeviceId) {
      alert('Pick an audio source first.');
      return;
    }
    setCapturing((c) => !c);
  }, [settings.sourceId, settings.loopbackDeviceId]);

  // ----- Pop-out bridge ----------------------------------------------------
  // Stream analyser frames to the pop-out while it's open. Refs keep the
  // effect from restarting whenever a callback identity changes.
  const analyserRef = useRef(cs.analyser);
  analyserRef.current = cs.analyser;

  // A timer, not requestAnimationFrame: rAF is tied to compositing, so it
  // stops the moment this window is minimised or hidden to the tray — which is
  // precisely when the pop-out is the only thing the user can see. (main also
  // sets backgroundThrottling: false so the timer keeps its interval.)
  useEffect(() => {
    if (!popoutOpen) return;
    const id = setInterval(() => {
      const a = analyserRef.current;
      if (!a) return;
      a.sample();
      window.api.sendVizFrame({
        time: a.timeData,
        freq: a.freqData,
        minDecibels: a.analyser.minDecibels,
        maxDecibels: a.analyser.maxDecibels,
      });
    }, VIZ_FRAME_MS);
    return () => clearInterval(id);
  }, [popoutOpen]);

  // Slower-moving state. bufferedSeconds is floored so this fires about once a
  // second instead of on every animation frame.
  const bufferedWhole = Math.floor(cs.bufferedSeconds);
  useEffect(() => {
    if (!popoutOpen) return;
    window.api.sendVizState({
      capturing,
      hasSource: !!cs.analyser,
      canSave: canSaveNow,
      bufferedSeconds: bufferedWhole,
      bufferSeconds: settings.bufferSeconds,
      recordMode: settings.recordMode,
      theme: settings.theme,
      visualizer: settings.visualizer,
      rms: cs.rms,
    });
  }, [
    popoutOpen, capturing, canSaveNow, bufferedWhole, cs.analyser,
    settings.bufferSeconds, settings.recordMode, settings.theme, settings.visualizer,
  ]); // eslint-disable-line react-hooks/exhaustive-deps

  // Commands coming back from the pop-out's buttons.
  const cmdRef = useRef({ toggleCapture, performSave, update });
  cmdRef.current = { toggleCapture, performSave, update };
  useEffect(
    () =>
      window.api.onVizCommand((c) => {
        const { toggleCapture: tc, performSave: ps, update: up } = cmdRef.current;
        if (c.type === 'toggle-capture') tc();
        else if (c.type === 'save') void ps();
        else if (c.type === 'set-visualizer') void up({ visualizer: c.mode });
      }),
    [],
  );

  if (!loaded) {
    return <div className="loading">Loading…</div>;
  }

  // One class per theme — a binary ternary here silently rendered every theme
  // past the first two with the classic-green chrome.
  const themeClass = `theme-${settings.theme}`;
  const layout = settings.uiLayout;
  const customChrome = settings.titleBarMode === 'custom';
  // The board is the first thing to go: `bar` has no room for it, and there's
  // no point drawing it twice when the pop-out is showing the same signal.
  const showBoard = layout !== 'bar' && !(popoutOpen && settings.hideBoardWhenPopped);
  const showFooter = layout === 'full' && (settings.showSourcePicker || settings.showVizChips);

  const sourcePicker = (
    <SourcePicker
      backend={settings.captureBackend}
      sources={cs.sources}
      loopbackDevices={cs.loopbackDevices}
      selectedId={
        settings.captureBackend === 'loopback'
          ? settings.loopbackDeviceId
          : settings.sourceId
      }
      onChange={(id) => {
        if (settings.captureBackend === 'loopback') {
          update({ loopbackDeviceId: id });
        } else {
          update({ sourceId: id });
        }
      }}
      onRefresh={capture.refreshSources}
      loopbackSupported={loopbackSupported}
      compact={layout !== 'full'}
      onOpenChange={
        layout === 'bar'
          ? (open) => window.api.tempExpandWindow(open ? 260 : null)
          : undefined
      }
    />
  );

  // The one-row control set used by `bar` layout — inside the title bar when
  // we own it, or as a standalone strip under the OS bar when we don't.
  const barControls = (
    <>
      <span className={`pill mini ${capturing ? 'on' : 'off'}`} title={capturing ? 'Recording' : 'Idle'}>
        {capturing ? '●' : '○'}
      </span>
      {cs.noSignal && !cs.error && (
        <span
          className="hud-quiet mini"
          title="Nothing is playing on the selected output device — WASAPI loopback only delivers audio while it is."
        >
          ⚠
        </span>
      )}
      {settings.showVu && (
        <div className="hud-vu mini" title={`RMS ${(cs.rms * 100).toFixed(0)}%`}>
          <div className="vu-bar" style={{ width: `${Math.min(100, cs.rms * 240)}%` }} />
        </div>
      )}
      <Transport
        capturing={capturing}
        canSaveNow={canSaveNow}
        recordMode={settings.recordMode}
        bufferSeconds={settings.bufferSeconds}
        labelMode={settings.labelMode === 'auto' ? 'icon' : settings.labelMode}
        onToggleCapture={toggleCapture}
        onManualSave={performSave}
        tight
      />
      {settings.showSourcePicker && <div className="bar-picker">{sourcePicker}</div>}
    </>
  );

  return (
    <div className={`app ${themeClass} layout-${layout} ${customChrome ? 'has-custom-titlebar' : ''}`}>
      {customChrome && (
        <TitleBar
          settings={settings}
          onUpdate={update}
          capturing={capturing}
          popoutOpen={popoutOpen}
          onTogglePopout={togglePopout}
          onOpenSettings={openSettingsPanel}
        >
          {layout === 'bar' ? barControls : undefined}
        </TitleBar>
      )}

      {layout === 'bar' && !customChrome && <div className="barstrip">{barControls}</div>}

      {layout !== 'bar' && (
        <HUD
          settings={settings}
          capturing={capturing}
          rms={cs.rms}
          bufferedSeconds={cs.bufferedSeconds}
          canSaveNow={canSaveNow}
          onToggleCapture={toggleCapture}
          onManualSave={performSave}
          onOpenSettings={openSettingsPanel}
          error={cs.error}
          noSignal={cs.noSignal}
          hideSettingsButton={customChrome}
        />
      )}

      {showBoard && (
        <main className={`board ${capturing ? 'is-capturing' : ''}`}>
          <VisualizerBoard
            analyser={cs.analyser}
            mode={settings.visualizer}
            theme={settings.theme}
          />
        </main>
      )}

      {layout === 'compact' && settings.showSourcePicker && (
        <footer className="sidebar is-compact">{sourcePicker}</footer>
      )}

      {showFooter && (
        <footer className="sidebar">
          {settings.showSourcePicker ? sourcePicker : <span />}
          {settings.showVizChips && (
            <div className="viz-buttons">
              {(['oscilloscope', 'spectrum', 'spectrogram'] as VisualizerMode[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  className={`chip ${settings.visualizer === m ? 'on' : ''}`}
                  onClick={() => update({ visualizer: m })}
                >
                  {m}
                </button>
              ))}
            </div>
          )}
        </footer>
      )}

      {settingsOpen && (
        <SettingsPanel
          settings={settings}
          onUpdate={update as (p: Partial<AppSettings>) => Promise<AppSettings>}
          onClose={closeSettingsPanel}
          onPickFolder={() => window.api.pickFolder()}
          active={capturing}
          loopbackSupported={loopbackSupported}
          popoutOpen={popoutOpen}
          onTogglePopout={togglePopout}
        />
      )}

      <ToastStack toasts={mergedToasts} />
    </div>
  );
}
