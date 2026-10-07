import { ChangeEvent, useEffect, useState, useRef } from 'react';
import {
  AppSettings,
  CaptureBackend,
  Theme,
  THEMES,
  VisualizerMode,
  VISUALIZER_MODES,
  RecordMode,
  DEFAULT_SETTINGS,
  FILENAME_TOKENS,
  TitleBarMode,
  LabelMode,
  SnapTarget,
} from '../../shared/types';

interface Props {
  settings: AppSettings;
  onUpdate: (patch: Partial<AppSettings>) => Promise<AppSettings>;
  onClose: () => void;
  /** Called when a folder is picked — used to display the result. */
  onPickFolder: () => Promise<string | null>;
  /** Whether the recorder is currently active (used for UX guards). */
  active: boolean;
  /** Whether the WASAPI loopback helper can be used on this platform. */
  loopbackSupported: boolean;
  /** Whether the pop-out visualizer window is currently up. */
  popoutOpen: boolean;
  onTogglePopout: () => void;
}

const TITLEBARS: { value: TitleBarMode; label: string; help: string }[] = [
  {
    value: 'custom',
    label: 'Minimal in-app bar',
    help: '26px strip with pin, dock-to-top, pop-out and window buttons. Frameless window.',
  },
  {
    value: 'system',
    label: 'Windows title bar',
    help: 'The standard OS title bar. Taller, but with the usual snap gestures and window menu.',
  },
];

const LABEL_MODES: { value: LabelMode; label: string }[] = [
  { value: 'auto', label: 'Auto (shrink with the window)' },
  { value: 'icon', label: 'Icons only' },
  { value: 'text', label: 'Always text' },
];

const SNAPS: { target: SnapTarget; label: string }[] = [
  { target: 'top', label: 'Dock top' },
  { target: 'bottom', label: 'Dock bottom' },
  { target: 'top-left', label: 'Top left' },
  { target: 'top-right', label: 'Top right' },
  { target: 'center', label: 'Centre' },
];

const VISIBILITY: { key: keyof AppSettings; label: string }[] = [
  { key: 'showBuffer', label: 'Rolling-buffer waveform' },
  { key: 'showSourcePicker', label: 'Source / output-device picker' },
  { key: 'showVizChips', label: 'Visualizer mode chips' },
  { key: 'showHint', label: 'Hotkey hint' },
];


const VISUALIZERS: { value: VisualizerMode; label: string }[] = [
  { value: 'oscilloscope', label: 'Oscilloscope' },
  { value: 'spectrum', label: 'Spectrum bars' },
  { value: 'spectrogram', label: 'Spectrogram' },
  { value: 'history', label: 'History' },
];

const RECORD_MODES: { value: RecordMode; label: string; help: string }[] = [
  {
    value: 'rolling',
    label: 'Rolling buffer',
    help: 'Always recording — keeps last N minutes in memory. Hotkey saves that window.',
  },
  {
    value: 'traditional',
    label: 'Press to record',
    help: 'Hotkey starts/stops a fresh recording each time.',
  },
];

const HOTKEY_PRESETS = [
  'Alt+R',
  'Shift+Alt+R',
  'Ctrl+Shift+R',
  'F9',
  'CommandOrControl+Alt+S',
];

const CAPTURE_BACKENDS: { value: CaptureBackend; label: string; help: string }[] = [
  {
    value: 'desktop',
    label: 'Screen / window',
    help: 'Use Electron desktopCapturer. On Windows the loopback mixer routes audio from the chosen source.',
  },
  {
    value: 'loopback',
    label: 'Per-output device (WASAPI)',
    help: 'True per-speaker capture via WASAPI. Pick from Speakers, Headphones, etc. Requires the bundled helper.',
  },
];

export function SettingsPanel({
  settings,
  onUpdate,
  onClose,
  onPickFolder,
  active,
  loopbackSupported,
  popoutOpen,
  onTogglePopout,
}: Props) {
  const [draft, setDraft] = useState<AppSettings>(settings);
  const [folderBusy, setFolderBusy] = useState(false);
  const templateRef = useRef<HTMLInputElement | null>(null);
  // Keys the user has touched in this panel but not saved yet. Everything else
  // tracks the live settings, so a change made elsewhere while the panel is
  // open (the footer format picker, the quick menu, the pop-out, the tray)
  // shows here — and Save only writes back what was actually edited instead of
  // clobbering those external changes with a stale whole-object snapshot.
  const dirty = useRef<Set<keyof AppSettings>>(new Set());

  useEffect(() => {
    setDraft((d) => {
      const merged = { ...settings };
      for (const k of dirty.current) (merged as any)[k] = (d as any)[k];
      return merged;
    });
  }, [settings]);

  function insertTemplateToken(token: string) {
    const el = templateRef.current;
    if (!el) {
      set('fileNameTemplate', draft.fileNameTemplate + token);
      return;
    }
    const start = el.selectionStart ?? draft.fileNameTemplate.length;
    const end = el.selectionEnd ?? start;
    const before = draft.fileNameTemplate.slice(0, start);
    const after = draft.fileNameTemplate.slice(end);
    const next = before + token + after;
    set('fileNameTemplate', next);
    // Preserve caret position after React re-render.
    requestAnimationFrame(() => {
      const caret = (before + token).length;
      el.focus();
      el.setSelectionRange(caret, caret);
    });
  }

  function set<K extends keyof AppSettings>(key: K, val: AppSettings[K]) {
    dirty.current.add(key);
    setDraft((d) => ({ ...d, [key]: val }));
  }

  /**
   * Interface toggles apply the moment they're clicked rather than on Save —
   * you can't judge a layout you can't see, and every one of them is
   * reversible with a second click.
   */
  function applyNow(patch: Partial<AppSettings>) {
    // Applied immediately and persisted, so it's no longer a pending edit.
    for (const k of Object.keys(patch) as (keyof AppSettings)[]) dirty.current.delete(k);
    setDraft((d) => ({ ...d, ...patch }));
    void onUpdate(patch);
  }

  async function save() {
    // Only write the fields actually edited in this panel — never a whole-draft
    // snapshot, which would revert anything changed elsewhere in the meantime.
    const patch: Partial<AppSettings> = {};
    for (const k of dirty.current) (patch as any)[k] = (draft as any)[k];
    if (Object.keys(patch).length) await onUpdate(patch);
    dirty.current.clear();
    onClose();
  }

  async function pickFolder() {
    setFolderBusy(true);
    try {
      const folder = await onPickFolder();
      if (folder) set('saveFolder', folder);
    } finally {
      setFolderBusy(false);
    }
  }

  function onAccel(e: ChangeEvent<HTMLInputElement>) {
    set('hotkey', e.target.value.trim());
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal">
        <header>
          <h2>Settings</h2>
          <button className="ghost" onClick={onClose}>×</button>
        </header>

        <section>
          <label>Recording mode</label>
          <div className="radio-group">
            {RECORD_MODES.map((m) => (
              <label key={m.value} className="radio">
                <input
                  type="radio"
                  name="mode"
                  value={m.value}
                  checked={draft.recordMode === m.value}
                  onChange={() => set('recordMode', m.value)}
                  disabled={active}
                />
                <span>
                  <strong>{m.label}</strong>
                  <em>{m.help}</em>
                </span>
              </label>
            ))}
          </div>
        </section>

        <section>
          <label>Capture backend</label>
          <div className="radio-group">
            {CAPTURE_BACKENDS.map((b) => {
              const disabled = active || (b.value === 'loopback' && !loopbackSupported);
              return (
                <label key={b.value} className="radio">
                  <input
                    type="radio"
                    name="backend"
                    value={b.value}
                    checked={draft.captureBackend === b.value}
                    onChange={() => set('captureBackend', b.value)}
                    disabled={disabled}
                  />
                  <span>
                    <strong>{b.label}</strong>
                    <em>{b.help}</em>
                  </span>
                </label>
              );
            })}
          </div>
          {!loopbackSupported && (
            <small>
              WASAPI loopback requires Windows. macOS / Linux users can still use
              the desktopCapturer path.
            </small>
          )}
        </section>

        <section>
          <label htmlFor="hotkey">Recording hotkey</label>
          <input
            id="hotkey"
            type="text"
            value={draft.hotkey}
            onChange={onAccel}
            placeholder="Alt+R"
          />
          <div className="preset-row">
            {HOTKEY_PRESETS.map((p) => (
              <button key={p} type="button" className="chip" onClick={() => set('hotkey', p)}>
                {p}
              </button>
            ))}
          </div>
          <small>
            Use Electron's accelerator syntax (Shift / Alt / Ctrl / Super / F-keys).
            The hotkey must not be in use by another app.
          </small>
        </section>

        <section>
          <label>Save folder</label>
          <div className="folder-row">
            <code title={draft.saveFolder || 'unset'}>
              {draft.saveFolder || '(not set)'}
            </code>
            <button type="button" className="primary" onClick={pickFolder} disabled={folderBusy}>
              {folderBusy ? '…' : 'Pick folder…'}
            </button>
          </div>
        </section>

        <section>
          <label>Buffer length (rolling mode)</label>
          <div className="slider-row">
            <input
              type="range"
              min={60}
              max={3600}
              step={30}
              value={draft.bufferSeconds}
              onChange={(e) => set('bufferSeconds', Number(e.target.value))}
            />
            <span>{Math.round(draft.bufferSeconds / 60)} min</span>
          </div>
          <div className="slider-meta">
            <small>
              Default {DEFAULT_SETTINGS.bufferSeconds / 60} min — changing this
              while rolling restarts the buffer.
            </small>
            {draft.bufferSeconds !== DEFAULT_SETTINGS.bufferSeconds && (
              <button
                type="button"
                className="chip"
                onClick={() => set('bufferSeconds', DEFAULT_SETTINGS.bufferSeconds)}
              >
                Reset
              </button>
            )}
          </div>
        </section>

        <section>
          <label htmlFor="bitrate">Bitrate</label>
          <select
            id="bitrate"
            value={draft.bitrateKbps}
            onChange={(e) => set('bitrateKbps', Number(e.target.value))}
          >
            {[64, 96, 128, 192, 256].map((b) => (
              <option key={b} value={b}>{b} kbps</option>
            ))}
          </select>
          <div className="slider-meta">
            <small>Default {DEFAULT_SETTINGS.bitrateKbps} kbps.</small>
            {draft.bitrateKbps !== DEFAULT_SETTINGS.bitrateKbps && (
              <button
                type="button"
                className="chip"
                onClick={() => set('bitrateKbps', DEFAULT_SETTINGS.bitrateKbps)}
              >
                Reset
              </button>
            )}
          </div>
          <small>
            Opus bitrate for WebM captures. When saving as MP3 this is the target
            bitrate too (clamped to 128–320 kbps). WAV ignores it.
          </small>
        </section>

        <section>
          <label htmlFor="recording-format">Save format</label>
          <select
            id="recording-format"
            value={draft.recordingFormat}
            onChange={(e) => set('recordingFormat', e.target.value as AppSettings['recordingFormat'])}
          >
            <option value="webm">WebM / Opus — smallest</option>
            <option value="wav">WAV — 16-bit PCM, lossless</option>
            <option value="mp3">MP3 — re-encoded</option>
          </select>
          <small>
            WAV / MP3 are produced from a decoded PCM copy when you save. In
            rolling mode that means a parallel PCM buffer in RAM (~170 MB for
            15 min of stereo) is kept while one of them is selected.
          </small>
        </section>

        <section>
          <label>MIDI transcription</label>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={draft.transcribeOnSave}
              onChange={(e) => applyNow({ transcribeOnSave: e.target.checked })}
            />
            <span>
              <strong>Write a .mid beside each recording</strong>
              <em>
                Detects notes and chords and saves them as a MIDI file with the
                same name as the audio. Your audio is always saved first — the
                MIDI appears a little later, and a failure never affects the
                recording. It runs in the background at roughly the clip's own
                length, so it suits short clips; a 15-minute buffer can take
                about 20 minutes.
              </em>
            </span>
          </label>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={draft.showMidiLane}
              onChange={(e) => applyNow({ showMidiLane: e.target.checked })}
            />
            <span>
              <strong>Show the MIDI piano-roll lane</strong>
              <em>
                A strip under the History waveform drawing the transcribed
                notes on the same time axis. Select a range in History and press
                <b> m </b> (or the ♪ on the selection) to transcribe it and see
                the melody. Nothing is drawn until you transcribe something.
              </em>
            </span>
          </label>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={draft.showOscilloscopeOverlay}
              onChange={(e) => applyNow({ showOscilloscopeOverlay: e.target.checked })}
            />
            <span>
              <strong>Layer a live oscilloscope over History</strong>
              <em>
                A small live scope inset at the right edge of the History
                board, at reduced opacity. Its ~43ms window can't share
                History's minutes-long time axis, so it stays a fixed-width
                strip rather than stretching across the waveform.
              </em>
            </span>
          </label>
        </section>

        <section>
          <label>Visualizer</label>
          <div className="chip-row">
            {VISUALIZERS.map((v) => {
              const on = !draft.vizHidden.includes(v.value);
              const only = on && draft.vizHidden.length === VISUALIZERS.length - 1;
              return (
              <button
                key={v.value}
                type="button"
                className={`chip ${on ? 'on' : ''}`}
                title={
                  only
                    ? `${v.label} — the board's only view`
                    : on
                      ? `Hide ${v.label}`
                      : `Show ${v.label} (turn on more than one for a split view)`
                }
                onClick={() => {
                  if (only) return;
                  const next = on
                    ? [...draft.vizHidden, v.value]
                    : draft.vizHidden.filter((m) => m !== v.value);
                  const shownAfter = VISUALIZER_MODES.filter((m) => !next.includes(m));
                  applyNow({
                    vizHidden: next,
                    visualizer: on ? (shownAfter[0] ?? draft.visualizer) : v.value,
                  });
                }}
              >
                {v.label}
              </button>
              );
            })}
          </div>
        </section>

        <section>
          <label>Visualizer sensitivity</label>
          <div className="slider-row">
            <input
              type="range"
              min={50}
              max={400}
              step={10}
              value={Math.round(draft.vizGain * 100)}
              onChange={(e) => set('vizGain', Number(e.target.value) / 100)}
            />
            <span>{draft.vizGain.toFixed(1)}×</span>
          </div>
          <div className="slider-meta">
            <small>Default {DEFAULT_SETTINGS.vizGain}×.</small>
            {draft.vizGain !== DEFAULT_SETTINGS.vizGain && (
              <button
                type="button"
                className="chip"
                onClick={() => set('vizGain', DEFAULT_SETTINGS.vizGain)}
              >
                Reset
              </button>
            )}
          </div>
          <small>
            How reactive the visualizers are to quiet audio. Display-only — it
            scales the drawing, never the recording or its volume.
          </small>
        </section>

        <section>
          <label>Theme</label>
          <div className="theme-row">
            {THEMES.map((t) => (
              <button
                key={t.value}
                type="button"
                className={`theme-card ${draft.theme === t.value ? 'on' : ''}`}
                onClick={() => {
                  set('theme', t.value);
                  void onUpdate({ theme: t.value });
                }}
              >
                <span className="swatch" style={{ background: t.swatch }} />
                <span>{t.label}</span>
              </button>
            ))}
          </div>
        </section>

        <section>
          <label>Title bar</label>
          <div className="radio-group">
            {TITLEBARS.map((t) => (
              <label key={t.value} className="radio">
                <input
                  type="radio"
                  name="titlebar"
                  value={t.value}
                  checked={draft.titleBarMode === t.value}
                  onChange={() => applyNow({ titleBarMode: t.value })}
                />
                <span>
                  <strong>{t.label}</strong>
                  <em>{t.help}</em>
                </span>
              </label>
            ))}
          </div>
          <small>
            Switching rebuilds the window — Electron can't add or remove a frame
            in place. Any capture in progress stops, so do it while idle.
          </small>
        </section>

        <section>
          <label>Button labels</label>
          <div className="chip-row">
            {LABEL_MODES.map((m) => (
              <button
                key={m.value}
                type="button"
                className={`chip ${draft.labelMode === m.value ? 'on' : ''}`}
                onClick={() => applyNow({ labelMode: m.value })}
              >
                {m.label}
              </button>
            ))}
          </div>
          <small>
            "Save last 15 min" is the widest control in the app. Auto swaps it
            for "Save 15m" and then a ⇩ glyph as the window narrows.
          </small>
        </section>

        <section>
          <label>Show in the interface</label>
          <div className="chip-row">
            {VISIBILITY.map((v) => (
              <button
                key={v.key as string}
                type="button"
                className={`chip ${draft[v.key] ? 'on' : ''}`}
                onClick={() => applyNow({ [v.key]: !draft[v.key] } as Partial<AppSettings>)}
              >
                {draft[v.key] ? '✓ ' : ''}{v.label}
              </button>
            ))}
          </div>
        </section>

        <section>
          <label>Window</label>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={draft.alwaysOnTop}
              onChange={(e) => applyNow({ alwaysOnTop: e.target.checked })}
            />
            <span>
              <strong>Always on top</strong>
              <em>Keeps Recordr above other windows. The same toggle is reachable from the system-tray icon menu.</em>
            </span>
          </label>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={draft.magneticSnap}
              onChange={(e) => applyNow({ magneticSnap: e.target.checked })}
            />
            <span>
              <strong>Magnetic edge snap</strong>
              <em>Drop the window near a screen edge and it clicks flush against it.</em>
            </span>
          </label>
          <div className="preset-row">
            {SNAPS.map((s) => (
              <button
                key={s.target}
                type="button"
                className="chip"
                onClick={() => window.api.snapWindow(s.target)}
              >
                {s.label}
              </button>
            ))}
          </div>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={draft.dockReservesSpace}
              onChange={(e) => applyNow({ dockReservesSpace: e.target.checked })}
              disabled={window.api.platform !== 'win32'}
            />
            <span>
              <strong>Docking reserves screen space</strong>
              <em>
                While docked to the top, shrink the desktop work area so other applications lay
                out <em>below</em> the strip instead of being covered by it — the same mechanism
                the taskbar uses. Affects every application, so it's off by default. Windows only.
              </em>
            </span>
          </label>
          <small>
            Dock top spans the full width of the current monitor at the
            window's present height. Shrink the window's height first (or dock
            the pop-out) for a slim strip across the top of the screen.
          </small>
        </section>

        <section>
          <label>Pop-out visualizer</label>
          <div className="preset-row">
            <button type="button" className="primary" onClick={onTogglePopout}>
              {popoutOpen ? 'Close pop-out' : 'Open pop-out'}
            </button>
          </div>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={draft.popoutControls}
              onChange={(e) => applyNow({ popoutControls: e.target.checked })}
            />
            <span>
              <strong>Transport buttons inside the pop-out</strong>
              <em>Start/stop, save and the visualizer modes, over the waveform. Fade in on hover.</em>
            </span>
          </label>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={draft.popoutAlwaysOnTop}
              onChange={(e) => applyNow({ popoutAlwaysOnTop: e.target.checked })}
            />
            <span>
              <strong>Pop-out always on top</strong>
              <em>Keeps the floating visualizer above other applications.</em>
            </span>
          </label>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={draft.hideMainWhenPopped}
              onChange={(e) => applyNow({ hideMainWhenPopped: e.target.checked })}
            />
            <span>
              <strong>Hide the main window while popped out</strong>
              <em>
                Popping out moves the app into the monitor window instead of leaving two on
                screen. Recording keeps running; the tray icon and the hotkey still work, and
                closing the pop-out brings the main window back.
              </em>
            </span>
          </label>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={draft.hideBoardWhenPopped}
              onChange={(e) => applyNow({ hideBoardWhenPopped: e.target.checked })}
              disabled={draft.hideMainWhenPopped}
            />
            <span>
              <strong>Hide only the main visualizer while popped out</strong>
              <em>
                Leaves the main window as controls only, so it can shrink much further. Has no
                effect while the whole window is hidden.
              </em>
            </span>
          </label>
          <div className="slider-row">
            <input
              type="range"
              min={20}
              max={100}
              step={5}
              value={Math.round(draft.popoutOpacity * 100)}
              onChange={(e) => applyNow({ popoutOpacity: Number(e.target.value) / 100 })}
            />
            <span>{Math.round(draft.popoutOpacity * 100)}% opacity</span>
          </div>
        </section>

        <section>
          <label htmlFor="fileNameTemplate">File name template</label>
          <input
            id="fileNameTemplate"
            ref={templateRef}
            type="text"
            value={draft.fileNameTemplate}
            onChange={(e) => set('fileNameTemplate', e.target.value)}
            placeholder="recordr_{date}_{time}"
          />
          <div className="chip-row template-tokens">
            {FILENAME_TOKENS.map((t) => (
              <button
                key={t.token}
                type="button"
                className="chip"
                onClick={() => insertTemplateToken(t.token)}
                title={`e.g. ${t.example}`}
              >
                {t.token}
              </button>
            ))}
          </div>
          <small>
            Plain text + the tokens above. Illegal filename characters are
            sanitised; the .webm extension is added if missing.
          </small>
        </section>

        <footer>
          <button type="button" className="ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="primary" onClick={save}>Save</button>
        </footer>
      </div>
    </div>
  );
}
