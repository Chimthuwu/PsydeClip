import { AppSettings } from '../../shared/types';
import { mmss } from '../../shared/utils';

interface Props {
  settings: AppSettings;
  capturing: boolean;
  rms: number;
  bufferedSeconds: number;
  canSaveNow: boolean;
  onToggleCapture: () => void;
  onManualSave: () => void;
  onOpenSettings: () => void;
  error: string | null;
}

export function HUD({
  settings,
  capturing,
  rms,
  bufferedSeconds,
  canSaveNow,
  onToggleCapture,
  onManualSave,
  onOpenSettings,
  error,
}: Props) {
  const bufferPct = settings.recordMode === 'rolling'
    ? Math.min(100, (bufferedSeconds / settings.bufferSeconds) * 100)
    : 0;

  const bufferMinutes = Math.round(settings.bufferSeconds / 60);
  const saveLabelFull =
    settings.recordMode === 'rolling' ? `Save last ${bufferMinutes} min` : 'Save recording';
  // Swapped in by CSS under ~680px so the button never overflows the HUD row.
  const saveLabelShort = settings.recordMode === 'rolling' ? `Save ${bufferMinutes}m` : 'Save';

  return (
    <header className="hud">
      <div className="hud-status">
        <span className={`pill ${capturing ? 'on' : 'off'}`}>
          {settings.theme === 'kawaii'
            ? capturing ? '♥ LIVE~' : '✿ idle'
            : capturing ? '● LIVE' : '○ idle'}
        </span>
        <span className="hud-mode">
          {settings.recordMode === 'rolling' ? 'rolling' : 'press-to-record'}
        </span>
        {settings.recordMode === 'rolling' && (
          <span className="hud-buffer">
            <progress max={100} value={bufferPct} />
            <em>{mmss(bufferedSeconds)} / {mmss(settings.bufferSeconds)}</em>
          </span>
        )}
      </div>

      <div className="hud-vu" title={`RMS ${(rms * 100).toFixed(0)}%`}>
        <div className="vu-bar" style={{ width: `${Math.min(100, rms * 240)}%` }} />
      </div>

      <div className="hud-actions">
        <button type="button" className="ghost" onClick={onOpenSettings} title="Settings">⚙</button>
        <button type="button" className="ghost" onClick={onToggleCapture}>
          {capturing ? 'Stop' : 'Start'}
        </button>
        <button
          type="button"
          className="primary big"
          onClick={onManualSave}
          disabled={!canSaveNow}
          title={saveLabelFull}
        >
          <span className="lbl-full">{saveLabelFull}</span>
          <span className="lbl-short">{saveLabelShort}</span>
        </button>
      </div>

      {error && <div className="hud-error">{error}</div>}

      <div className="hud-hint">
        Hotkey: <kbd>{settings.hotkey}</kbd>
      </div>
    </header>
  );
}
