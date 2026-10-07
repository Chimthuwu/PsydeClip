import { LabelMode, RecordMode, RecordingFormat } from '../../shared/types';
import { mmss } from '../../shared/utils';

interface Props {
  capturing: boolean;
  canSaveNow: boolean;
  recordMode: RecordMode;
  bufferSeconds: number;
  labelMode: LabelMode;
  onToggleCapture: () => void;
  onManualSave: () => void;
  /** Dedicated clip-recording state (rolling mode only). */
  clipActive?: boolean;
  /** Live seconds since the clip started — shown on the button while active. */
  clipElapsed?: number;
  onToggleClip?: () => void;
  /** False when no source is bound / no save folder — record button greys out. */
  clipEnabled?: boolean;
  /** Container a save will be written as — shown as a tag on the buttons. */
  format?: RecordingFormat;
  /** Rendered smaller, for the bar strip and the pop-out. */
  tight?: boolean;
}

/**
 * Start/stop + save, shared by the HUD and the pop-out window so they stay
 * in step.
 *
 * Label handling is the reason this is a component rather than two buttons:
 * "Save last 15 min" is the widest thing in the app, and at small sizes it has
 * to become "Save 15m" and then a bare glyph. `labelMode: 'auto'` renders all
 * three and lets the CSS breakpoints choose; 'icon' and 'text' pin it.
 */
export function Transport({
  capturing,
  canSaveNow,
  recordMode,
  bufferSeconds,
  labelMode,
  onToggleCapture,
  onManualSave,
  clipActive = false,
  clipElapsed,
  onToggleClip,
  clipEnabled = true,
  format = 'webm',
  tight,
}: Props) {
  const minutes = Math.round(bufferSeconds / 60);
  const saveFull = recordMode === 'rolling' ? `Save last ${minutes} min` : 'Save recording';
  const saveShort = recordMode === 'rolling' ? `Save ${minutes}m` : 'Save';

  const cls = `labels-${labelMode}${tight ? ' is-tight' : ''}`;
  // Matches the FormatPicker labels so the tag says exactly what the file
  // extension will be.
  const ext = format === 'wav' ? 'WAV' : format === 'mp3' ? 'MP3' : 'WebM';
  const extTag = <span className="lbl-ext" aria-label={`saves as ${ext}`}>{ext}</span>;
  // While a clip is recording the button shows a live stopwatch instead of the
  // static label — pressing it still means "stop & save".
  const clipLabel = clipElapsed !== undefined && clipActive ? mmss(clipElapsed) : undefined;

  return (
    <>
      {recordMode === 'traditional' && (
        <button
          type="button"
          className={`ghost transport-toggle ${cls} ${capturing ? 'is-live' : ''}`}
          onClick={onToggleCapture}
          title={capturing ? 'Stop capturing' : 'Start capturing'}
        >
          <span className="lbl-icon" aria-hidden="true">{capturing ? '■' : '▶'}</span>
          <span className="lbl-full">{capturing ? 'Stop' : 'Start'}</span>
          <span className="lbl-short">{capturing ? 'Stop' : 'Start'}</span>
          {extTag}
        </button>
      )}

      {/* The dedicated record button — rolling mode only. In traditional mode
          the start/stop toggle above *is* the record button, so a second one
          would just be a confusing duplicate. A clip records a fresh, isolated
          few seconds and saves on stop, instead of snapshotting the whole
          N-minute rolling buffer. */}
      {recordMode === 'rolling' && onToggleClip && (
        <button
          type="button"
          className={`ghost transport-toggle transport-record ${cls} ${clipActive ? 'is-live' : ''}`}
          onClick={onToggleClip}
          disabled={!clipEnabled && !clipActive}
          title={
            clipActive
              ? 'Stop clip recording and save it'
              : 'Record a short clip — streamed straight to disk, saved when you stop it'
          }
        >
          <span className="lbl-icon" aria-hidden="true">{clipActive ? '■' : '●'}</span>
          <span className="lbl-full">{clipLabel ?? (clipActive ? 'Stop & save' : 'Record clip')}</span>
          <span className="lbl-short">{clipLabel ?? (clipActive ? 'Stop' : 'Record')}</span>
          {extTag}
        </button>
      )}

      <button
        type="button"
        className={`primary big transport-save ${cls}`}
        onClick={onManualSave}
        disabled={!canSaveNow}
        title={saveFull}
      >
        <span className="lbl-icon" aria-hidden="true">⇩</span>
        <span className="lbl-full">{saveFull}</span>
        <span className="lbl-short">{saveShort}</span>
        {extTag}
      </button>
    </>
  );
}

export default Transport;
