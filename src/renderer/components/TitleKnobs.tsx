import { AppSettings } from '../../shared/types';

/**
 * The three quick knobs — save format / visualizer sensitivity / rolling-buffer
 * length — as compact mono buttons that pop native menus (`ipc.ts` titleMenu),
 * so they're never clipped by a short or docked window. Shared by the custom
 * title bar.
 */
export function TitleKnobs({ settings }: { settings: AppSettings }) {
  const formatLabel = settings.recordingFormat.toUpperCase();
  const gainLabel = `${Number(settings.vizGain.toFixed(2))}×`;
  const bufferLabel = `${Math.round(settings.bufferSeconds / 60)}m`;

  return (
    <div className="tb-ctls">
      <button
        type="button"
        className="tb-ctl tb-ctl-format"
        title="Save format: WebM / WAV / MP3"
        aria-haspopup="menu"
        onClick={() => window.api.showTitleMenu('format')}
      >
        {formatLabel}
        <span className="tb-ctl-chevron" aria-hidden="true">▾</span>
      </button>
      <button
        type="button"
        className="tb-ctl tb-ctl-gain"
        title="Visualizer sensitivity (draw-time only)"
        aria-haspopup="menu"
        onClick={() => window.api.showTitleMenu('gain')}
      >
        {gainLabel}
        <span className="tb-ctl-chevron" aria-hidden="true">▾</span>
      </button>
      <button
        type="button"
        className="tb-ctl tb-ctl-buffer"
        title="Rolling buffer length — changing it restarts the buffer"
        aria-haspopup="menu"
        onClick={() => window.api.showTitleMenu('buffer')}
      >
        {bufferLabel}
        <span className="tb-ctl-chevron" aria-hidden="true">▾</span>
      </button>
    </div>
  );
}

export default TitleKnobs;
