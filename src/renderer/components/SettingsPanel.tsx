import { ChangeEvent, useState, useRef } from 'react';
import { AppSettings, CaptureBackend, Theme, VisualizerMode, RecordMode, FILENAME_TOKENS } from '../../shared/types';

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
}

const THEMES: { value: Theme; label: string; preview: string }[] = [
  { value: 'modern', label: 'Modern neon', preview: '#7df9ff' },
  { value: 'classic', label: 'Classic green', preview: '#00ff00' },
  { value: 'cyberpunk', label: 'Cyberpunk', preview: '#fcee0a' },
  { value: 'synthwave', label: 'Synthwave', preview: '#ff7700' },
  { value: 'monochrome', label: 'Monochrome', preview: '#ffffff' },
  { value: 'kawaii', label: 'Hyper kawaii ✿', preview: '#ff8fc7' },
];

const VISUALIZERS: { value: VisualizerMode; label: string }[] = [
  { value: 'oscilloscope', label: 'Oscilloscope' },
  { value: 'spectrum', label: 'Spectrum bars' },
  { value: 'spectrogram', label: 'Spectrogram' },
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
}: Props) {
  const [draft, setDraft] = useState<AppSettings>(settings);
  const [folderBusy, setFolderBusy] = useState(false);
  const templateRef = useRef<HTMLInputElement | null>(null);

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
    setDraft((d) => ({ ...d, [key]: val }));
  }

  async function save() {
    await onUpdate(draft);
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
            placeholder="Shift+Alt+R"
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
        </section>

        <section>
          <label htmlFor="bitrate">Opus bitrate</label>
          <select
            id="bitrate"
            value={draft.bitrateKbps}
            onChange={(e) => set('bitrateKbps', Number(e.target.value))}
          >
            {[64, 96, 128, 192, 256].map((b) => (
              <option key={b} value={b}>{b} kbps</option>
            ))}
          </select>
        </section>

        <section>
          <label>Default visualizer</label>
          <div className="chip-row">
            {VISUALIZERS.map((v) => (
              <button
                key={v.value}
                type="button"
                className={`chip ${draft.visualizer === v.value ? 'on' : ''}`}
                onClick={() => set('visualizer', v.value)}
              >
                {v.label}
              </button>
            ))}
          </div>
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
                <span className="swatch" style={{ background: t.preview }} />
                <span>{t.label}</span>
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
              onChange={(e) => set('alwaysOnTop', e.target.checked)}
            />
            <span>
              <strong>Always on top</strong>
              <em>Keeps Recordr above other windows. The same toggle is reachable from the system-tray icon menu.</em>
            </span>
          </label>
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
