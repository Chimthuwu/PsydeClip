/**
 * Tests for the browser target's settings store and the shared filename
 * engine (todo.md §7 "NEXT: an Android version", DECISION commit 9086b0f).
 *
 * Both are the "trivially portable" half of the port, which is exactly why
 * they are worth pinning down: the port's whole premise is that the renderer
 * needs nothing from Electron except `window.api`, so the pieces that replace
 * it must behave the same way the Electron ones do.
 *
 * Run: npm test   (see tsconfig.test.json)
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createSettingsStore, mergeSettings, SETTINGS_KEY } from './browser-settings';
import { formatFileName } from '../../shared/file-name';
import { DEFAULT_SETTINGS } from '../../shared/types';
import type { AppSettings } from '../../shared/types';

/** An in-memory stand-in for localStorage. */
function fakeStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => void map.set(k, v),
    raw: map,
  };
}

test('an empty store reads the defaults', () => {
  const store = createSettingsStore(fakeStorage());
  assert.deepEqual(store.read(), DEFAULT_SETTINGS);
});

test('a stored patch survives a reload, and unknown keys are dropped', () => {
  const storage = fakeStorage();
  const first = createSettingsStore(storage);
  first.write({ theme: 'cyberpunk', bufferSeconds: 300 });

  // A brand-new store over the same bytes is what a page reload looks like.
  const second = createSettingsStore(storage);
  const read = second.read();
  assert.equal(read.theme, 'cyberpunk');
  assert.equal(read.bufferSeconds, 300);
  assert.equal(read.recordMode, DEFAULT_SETTINGS.recordMode);

  // A key this build doesn't know about must not leak into the object.
  storage.setItem(SETTINGS_KEY, JSON.stringify({ ...DEFAULT_SETTINGS, fromTheFuture: 1 }));
  const third = createSettingsStore(storage);
  assert.equal('fromTheFuture' in third.read(), false);
});

test('a wrong-typed value is ignored rather than adopted', () => {
  const merged = mergeSettings({
    bufferSeconds: '60', // string where a number belongs
    theme: 7, // number where a string belongs
    vizHidden: ['spectrum', 5], // array with a non-string in it
    sourceId: null, // legitimately nullable
    recordMode: 'traditional', // fine
  });
  assert.equal(merged.bufferSeconds, DEFAULT_SETTINGS.bufferSeconds);
  assert.equal(merged.theme, DEFAULT_SETTINGS.theme);
  assert.deepEqual(merged.vizHidden, DEFAULT_SETTINGS.vizHidden);
  assert.equal(merged.sourceId, null);
  assert.equal(merged.recordMode, 'traditional');
});

test('corrupt JSON and non-objects fall back to the defaults', () => {
  for (const bad of ['{not json', '[]', '"a string"', 'null', '42']) {
    const store = createSettingsStore(fakeStorage({ [SETTINGS_KEY]: bad }));
    assert.deepEqual(store.read(), DEFAULT_SETTINGS, `input ${bad}`);
  }
});

test('writes are broadcast to subscribers, and the unsubscribe works', () => {
  const store = createSettingsStore(fakeStorage());
  const seen: AppSettings[] = [];
  const off = store.subscribe((s) => seen.push(s));
  store.write({ theme: 'sakura' });
  store.write({ theme: 'lime' });
  off();
  store.write({ theme: 'aqua' });
  assert.deepEqual(
    seen.map((s) => s.theme),
    ['sakura', 'lime'],
  );
});

test('a storage that throws still keeps the session usable', () => {
  const hostile = {
    getItem: () => {
      throw new Error('denied');
    },
    setItem: () => {
      throw new Error('quota');
    },
  };
  const store = createSettingsStore(hostile);
  assert.deepEqual(store.read(), DEFAULT_SETTINGS);
  assert.equal(store.write({ theme: 'nocturnal' }).theme, 'nocturnal');
  assert.equal(store.read().theme, 'nocturnal'); // cached, so the UI stays consistent
});

test('the shared filename engine still names files the way main does', () => {
  const settings = { ...DEFAULT_SETTINGS, recordMode: 'rolling' } as AppSettings;
  const name = formatFileName('recordr_{date}_{time}', { settings, counter: 7, ext: 'wav' });
  assert.match(name, /^recordr_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.wav$/);

  // The template's own audio extension is replaced, not doubled.
  assert.match(
    formatFileName('take.webm', { settings, counter: 1, ext: 'mp3' }),
    /^take\.mp3$/,
  );
  // A device name with separators in it can't escape the folder: the separators
  // become underscores and the leading-dot run is stripped outright, so what is
  // left is a plain basename in the save folder.
  const hostile = formatFileName('{device}', {
    settings,
    deviceName: '../../etc/passwd',
    counter: 1,
    ext: 'webm',
  });
  assert.equal(hostile, 'etc_passwd.webm');
  assert.ok(!/[\/]/.test(hostile), 'no path separator survives');
  assert.ok(!hostile.startsWith('.'), 'no leading dot survives');
  // A template that yields nothing still produces a usable name.
  assert.match(formatFileName('', { settings, counter: 1, ext: 'webm' }), /^recordr_.*\.webm$/);
});
