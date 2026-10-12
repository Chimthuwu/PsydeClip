/**
 * When the main window stops being worth looking at.
 *
 * Kept pure and out of `main/` so the rule can be tested without an Electron
 * window: the hand-over itself (open the pop-out, give it the bounds, hide the
 * main window) is plumbing, but *when* it fires is the part that goes wrong.
 */
import { AUTO_POPOUT_HEIGHT } from './types';

export interface MainWindowShape {
  /** Current main-window height in px. */
  height: number;
  /** `settings.autoPopoutWhenSmall`. */
  autoPopoutWhenSmall: boolean;
  /** Is the pop-out already up? */
  popoutOpen: boolean;
  /** Is the main window on screen (not hidden, not minimised)? */
  visible: boolean;
}

/**
 * True when the pop-out should take the main window's place.
 *
 * Deliberately false when the pop-out is already open: `applyPopoutWindowSwap`
 * hides the main window on that transition, and a hidden window reports its
 * old (small) bounds — without this guard the two would ping-pong.
 */
export function shouldHandOverToPopout(s: MainWindowShape): boolean {
  if (!s.autoPopoutWhenSmall) return false;
  if (s.popoutOpen) return false;
  if (!s.visible) return false;
  return s.height <= AUTO_POPOUT_HEIGHT;
}

/**
 * Height to give the main window back when it returns from a hand-over. It was
 * left at the sliver that triggered one, so restoring it as-is would hand
 * straight back.
 */
export function restoredHeight(lastRoomyHeight: number | null, layoutMinHeight: number): number {
  const floor = Math.max(layoutMinHeight, AUTO_POPOUT_HEIGHT + 1);
  if (lastRoomyHeight && lastRoomyHeight > AUTO_POPOUT_HEIGHT) return lastRoomyHeight;
  return Math.max(floor, AUTO_POPOUT_HEIGHT + 130);
}
