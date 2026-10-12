import { useEffect, useState } from 'react';
import { ClipHUD } from './components/ClipHUD';
import { ClipWindowState } from '../shared/types';

/**
 * Root for the always-on-top clip-recording window (`index.html#clip`).
 *
 * It owns no recording state — the main renderer drives the clip. This window
 * just shows the live timer and relays its two buttons back as `viz:command`
 * (`toggle-clip` = stop & save, `discard-clip` = throw away), which main
 * forwards to the main renderer exactly like a pop-out command.
 */
export function ClipWindowApp() {
  const [state, setState] = useState<ClipWindowState | null>(null);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => window.api.onClipWindowState(setState), []);

  useEffect(() => {
    const started = state?.startedAt ?? 0;
    if (!started) {
      setElapsed(0);
      return;
    }
    const tick = () => setElapsed(Math.max(0, (Date.now() - started) / 1000));
    tick();
    const id = setInterval(tick, 100);
    return () => clearInterval(id);
  }, [state?.startedAt]);

  if (!state) return null;

  return (
    <div className={`clip-window theme-${state.theme}`}>
      <ClipHUD
        elapsed={elapsed}
        format={state.format}
        onStop={() => window.api.sendClipCommand({ type: 'toggle-clip' })}
        onDiscard={() => window.api.sendClipCommand({ type: 'discard-clip' })}
      />
    </div>
  );
}

export default ClipWindowApp;
