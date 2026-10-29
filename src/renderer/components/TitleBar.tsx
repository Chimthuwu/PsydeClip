import { ReactNode, useEffect, useState } from 'react';
import { AppSettings } from '../../shared/types';
import { TitleKnobs } from './TitleKnobs';

interface Props {
  settings: AppSettings;
  onUpdate: (patch: Partial<AppSettings>) => Promise<AppSettings> | void;
  capturing: boolean;
  popoutOpen: boolean;
  onTogglePopout: () => void;
  onOpenSettings: () => void;
  /** Optional controls rendered inline in the strip between title and actions. */
  children?: ReactNode;
}

/**
 * The app's own title bar, used when settings.titleBarMode === 'custom'.
 *
 * 26px tall against the OS bar's ~32px, and it earns that space back by
 * carrying the controls that matter for a docked window: pin, dock-to-top,
 * pop-out. (There is no layout switch anymore — the compact layout was
 * retired, and the full one sheds chrome to a strip via CSS breakpoints.)
 *
 * Dragging: the strip is the drag region (CSS `-webkit-app-region: drag`);
 * every button opts back out with `no-drag`.
 */
export function TitleBar({
  settings,
  onUpdate,
  capturing,
  popoutOpen,
  onTogglePopout,
  onOpenSettings,
  children,
}: Props) {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => window.api.onWindowState((s) => setMaximized(s.maximized)), []);

  return (
    <div className={`titlebar ${children ? 'has-inline' : ''}`}>
      <span className={`tb-dot ${capturing ? 'on' : ''}`} aria-hidden="true" />
      <button
        type="button"
        className="tb-btn tb-theme"
        title="Change theme"
        aria-haspopup="menu"
        onClick={() => window.api.showTitleMenu('theme')}
      >
        ◈
      </button>
      <span className="tb-name">PsydeClip</span>

      {children ? <div className="tb-inline">{children}</div> : <div className="tb-spacer" />}

      {/* Quick knobs — native menus so they're never clipped, even in a
          docked strip. Each also exists in the right-click quick menu. Grouped
          with the other controls on the right, not stuck to the wordmark. */}
      <TitleKnobs settings={settings} />

      <div className="tb-actions">
        {/* "Always on top" is on by default and lives in Settings now, not
            as a front-facing toggle — see todo.md 2026-10-30: fewer buttons
            in the top bar, simpler default behaviour. */}
        <button
          type="button"
          className="tb-btn"
          title="Dock to the top edge of this monitor (full width)"
          onClick={() => window.api.snapWindow('top')}
        >
          ↥
        </button>
        <button
          type="button"
          className={`tb-btn ${popoutOpen ? 'is-on' : ''}`}
          title={popoutOpen ? 'Close the pop-out visualizer' : 'Pop the visualizer out into its own window'}
          onClick={onTogglePopout}
        >
          ⧉
        </button>
        <button type="button" className="tb-btn" title="Settings" onClick={onOpenSettings}>
          ⚙
        </button>

        <span className="tb-sep" />

        <button
          type="button"
          className="tb-btn tb-win"
          title="Minimise"
          onClick={() => window.api.windowControl('minimize')}
        >
          —
        </button>
        <button
          type="button"
          className="tb-btn tb-win"
          title={maximized ? 'Restore' : 'Maximise'}
          onClick={() => window.api.windowControl('restore-or-max')}
        >
          {maximized ? '❐' : '▢'}
        </button>
        <button
          type="button"
          className="tb-btn tb-win tb-close"
          title="Close to tray"
          onClick={() => window.api.windowControl('close')}
        >
          ✕
        </button>
      </div>
    </div>
  );
}

export default TitleBar;
