import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldHandOverToPopout, restoredHeight } from './window-mode';
import { AUTO_POPOUT_HEIGHT, DEFAULT_SETTINGS, LAYOUT_MIN_SIZE } from './types';

const roomy = {
  height: 600,
  autoPopoutWhenSmall: true,
  popoutOpen: false,
  visible: true,
};

test('a roomy window is left alone', () => {
  assert.equal(shouldHandOverToPopout(roomy), false);
});

test('shrinking to the threshold hands over', () => {
  assert.equal(shouldHandOverToPopout({ ...roomy, height: AUTO_POPOUT_HEIGHT }), true);
  assert.equal(shouldHandOverToPopout({ ...roomy, height: AUTO_POPOUT_HEIGHT - 1 }), true);
  assert.equal(shouldHandOverToPopout({ ...roomy, height: AUTO_POPOUT_HEIGHT + 1 }), false);
});

test('a docked strip is below the threshold, so docking is a hand-over', () => {
  // snapWindow parks a docked window at 100px (DOCK_STRIP_HEIGHT), and its
  // floor is 52px. Both have to count as "too small", or docking leaves the
  // squashed main HUD on screen — the bug this rule exists for.
  assert.equal(shouldHandOverToPopout({ ...roomy, height: 100 }), true);
  assert.equal(shouldHandOverToPopout({ ...roomy, height: 52 }), true);
});

test('the setting switches it off', () => {
  assert.equal(shouldHandOverToPopout({ ...roomy, height: 100, autoPopoutWhenSmall: false }), false);
});

test('it never fires while the pop-out is already up', () => {
  // The swap hides the main window, and a hidden window still reports its old
  // small bounds — without this guard the two bounce off each other.
  assert.equal(shouldHandOverToPopout({ ...roomy, height: 100, popoutOpen: true }), false);
});

test('a hidden or minimised main window is not resized by the user', () => {
  assert.equal(shouldHandOverToPopout({ ...roomy, height: 100, visible: false }), false);
});

test('it is on by default', () => {
  assert.equal(DEFAULT_SETTINGS.autoPopoutWhenSmall, true);
});

test('coming back from a hand-over never lands back under the threshold', () => {
  const min = LAYOUT_MIN_SIZE.full.height;
  // No remembered size, or one that was itself too small: use the floor.
  assert.ok(restoredHeight(null, min) > AUTO_POPOUT_HEIGHT);
  assert.ok(restoredHeight(100, min) > AUTO_POPOUT_HEIGHT);
  // A remembered roomy size is honoured exactly.
  assert.equal(restoredHeight(742, min), 742);
});
