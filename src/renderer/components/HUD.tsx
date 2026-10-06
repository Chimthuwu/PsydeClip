import { ReactNode } from 'react';
import { AppSettings } from '../../shared/types';
import { mmss } from '../../shared/utils';
import { Transport } from './Transport';

interface Props {
  settings: AppSettings;
  capturing: boolean;
  bufferedSeconds: number;
  canSaveNow: boolean;
  onToggleCapture: () => void;
  onManualSave: () => void;
  onOpenSettings: () => void;
  error: string | null;
  /** Loopback device is bound but silent — see CaptureState.noSignal. */
  noSignal?: boolean;
  /** Hide the gear — the custom title bar already carries one. */
  hideSettingsButton?: boolean;
  /** The save-format picker — lives in the status row now, not the footer. */
  formatControl?: ReactNode;
  /** Dedicated clip recording (rolling mode only). */
  clipActive?: boolean;
  /** Live seconds since the clip started (undefined when not recording). */
  clipElapsed?: number;
  onToggleClip?: () => void;
  clipEnabled?: boolean;
}

export function HUD({
  settings,
  capturing,
  bufferedSeconds,
  canSaveNow,
  onToggleCapture,
  onManualSave,
  onOpenSettings,
  error,
  noSignal,
  hideSettingsButton,
  formatControl,
  clipActive,
  clipElapsed,
  onToggleClip,
  clipEnabled,
}: Props) {
  const showBuffer = settings.showBuffer && settings.recordMode === 'rolling';
  const bufferFull = bufferedSeconds >= settings.bufferSeconds - 2;

  return (
    <header className="hud">
      <div className="hud-status">
        {/* LIVE + the rolling-buffer readout as one connected pill. */}
        <span className="hud-live">
          <span className={`pill ${capturing ? 'on' : 'off'}`}>
            {settings.theme === 'kawaii'
              ? capturing ? '♥ LIVE~' : '✿ idle'
              : capturing ? '● LIVE' : '○ idle'}
          </span>
          {showBuffer && (
            <span
              className={`hud-buffered${bufferFull ? ' is-full' : ''}`}
              title={
                bufferFull
                  ? `Rolling — the last ${mmss(settings.bufferSeconds)} of audio is always kept and slides forward; older audio rolls off. Save keeps a chunk; the hotkey records a clip.`
                  : `Building the rolling buffer — ${mmss(bufferedSeconds)} of ${mmss(settings.bufferSeconds)} held.`
              }
            >
              {bufferFull
                ? mmss(settings.bufferSeconds)
                : `${mmss(bufferedSeconds)} / ${mmss(settings.bufferSeconds)}`}
            </span>
          )}
        </span>

        {formatControl}

        {noSignal && !error && (
          <span
            className="hud-quiet"
            title="WASAPI loopback only delivers audio while something is actually playing on the selected output device. Play something and the waveform will appear."
          >
            ⚠ device is silent
          </span>
        )}
      </div>

      {settings.showHint && (
        <span className="hud-hint" title="Global hotkey — starts / stops a clip recording">
          <kbd>{settings.hotkey}</kbd>
        </span>
      )}

      <div className="hud-actions">
        {!hideSettingsButton && (
          <button type="button" className="ghost" onClick={onOpenSettings} title="Settings">⚙</button>
        )}
        <Transport
          capturing={capturing}
          canSaveNow={canSaveNow}
          recordMode={settings.recordMode}
          bufferSeconds={settings.bufferSeconds}
          labelMode={settings.labelMode}
          onToggleCapture={onToggleCapture}
          onManualSave={onManualSave}
          clipActive={clipActive}
          clipElapsed={clipElapsed}
          onToggleClip={onToggleClip}
          clipEnabled={clipEnabled}
          format={settings.recordingFormat}
        />
      </div>

      {error && <div className="hud-error">{error}</div>}
    </header>
  );
}
