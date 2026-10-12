import { mmssTenths } from '../../shared/utils';

interface Props {
  /** Seconds since the clip started. */
  elapsed: number;
  /** Active save format, shown as a small tag (webm / wav / mp3). */
  format?: string;
  /** Stop the clip and save it. */
  onStop: () => void;
  /** Stop the clip and throw it away. */
  onDiscard: () => void;
}

/**
 * Floating "recording a clip" panel. Rendered by both windows whenever a clip
 * is in progress (clip state is mirrored to the pop-out over VizState), so
 * whichever window is on screen shows it. It's an overlay, not a modal — only
 * the panel itself takes pointer events, everything behind stays usable.
 *
 * The clip recorder is fully independent of the rolling buffer: starting or
 * stopping one here never touches it.
 */
export function ClipHUD({ elapsed, format, onStop, onDiscard }: Props) {
  return (
    <div className="clip-hud" role="status" aria-live="polite">
      <button
        type="button"
        className="clip-hud-discard"
        title="Discard this clip (delete without saving)"
        aria-label="Discard clip"
        onClick={onDiscard}
      >
        ✕
      </button>
      <div className="clip-hud-head">
        <span className="clip-hud-dot" aria-hidden="true" />
        <span className="clip-hud-label">Recording clip</span>
        {format && <span className="clip-hud-fmt">{format.toUpperCase()}</span>}
      </div>
      <div className="clip-hud-time">{mmssTenths(elapsed)}</div>
      <button type="button" className="clip-hud-stop" onClick={onStop}>
        <span className="clip-hud-stop-icon" aria-hidden="true" />
        Stop &amp; save
      </button>
    </div>
  );
}

export default ClipHUD;
