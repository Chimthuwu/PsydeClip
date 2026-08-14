import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { HUD } from './components/HUD';
import { VisualizerBoard } from './components/VisualizerBoard';
import { SourcePicker } from './components/SourcePicker';
import { SettingsPanel } from './components/SettingsPanel';
import { ToastStack } from './components/ToastStack';
import { useSettings } from './hooks/useSettings';
import { useCapture } from './hooks/useCapture';
import { useRecorderEvents } from './hooks/useRecorderEvents';
import { AppSettings } from '../shared/types';

const LOOPBACK_SUPPORTED_PLATFORMS = new Set(['win32']);

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

  // Mirror our local capturing state into the tray so its title, overlay
  // badge, tooltip and elapsed-time ticker stay in sync.
  useEffect(() => {
    if (loaded) window.api.setTrayCapturing(capturing);
  }, [capturing, loaded]);

  // Listen for "open settings" requests from the tray menu.
  useEffect(() => {
    const unsub = window.api.onOpenSettingsRequest(() => {
      setSettingsOpen(true);
    });
    return unsub;
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
    if (!settings.sourceId) {
      alert('Pick an audio source first.');
      return;
    }
    setCapturing((c) => !c);
  }, [settings.sourceId]);

  const onPickFolder = useCallback(async () => {
    return window.api.pickFolder();
  }, []);

  if (!loaded) {
    return <div className="loading">Loading…</div>;
  }

  // One class per theme — a binary ternary here silently rendered every theme
  // past the first two with the classic-green chrome.
  const themeClass = `theme-${settings.theme}`;

  return (
    <div className={`app ${themeClass}`}>
      <HUD
        settings={settings}
        capturing={capturing}
        rms={cs.rms}
        bufferedSeconds={cs.bufferedSeconds}
        canSaveNow={canSaveNow}
        onToggleCapture={toggleCapture}
        onManualSave={performSave}
        onOpenSettings={() => setSettingsOpen(true)}
        error={cs.error}
      />

      <main className={`board ${capturing ? 'is-capturing' : ''}`}>
        <VisualizerBoard
          analyser={cs.analyser}
          mode={settings.visualizer}
          theme={settings.theme}
        />
      </main>

      <footer className="sidebar">
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
        />
        <div className="viz-buttons">
          {(['oscilloscope', 'spectrum', 'spectrogram'] as const).map((m) => (
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
      </footer>

      {settingsOpen && (
        <SettingsPanel
          settings={settings}
          onUpdate={update}
          onClose={() => setSettingsOpen(false)}
          onPickFolder={onPickFolder}
          active={capturing}
          loopbackSupported={loopbackSupported}
        />
      )}

      <ToastStack toasts={mergedToasts} />
    </div>
  );
}
