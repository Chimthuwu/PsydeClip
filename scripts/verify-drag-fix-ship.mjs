// One-shot asar content check (2026-10-13): popout top-bar transport fix.
// The record/export buttons in the popout drag strip were dead because the
// strip is a window-drag region and the buttons never opted out. Verify the
// shipped CSS carries the blanket `.popout-drag button` no-drag rule.
import asar from '@electron/asar';

const archive = 'release/win-unpacked/resources/app.asar';
const all = asar.listPackage(archive).map((p) => String(p));
const norm = (p) => p.replace(/\\/g, '/').replace(/^\//, '').toLowerCase();
const cssEntries = all.filter((p) => norm(p).startsWith('dist/renderer/assets/index-') && norm(p).endsWith('.css'));
if (cssEntries.length !== 1) throw new Error(`expected one renderer css bundle, got: ${cssEntries.join(', ')}`);
const css = asar.extractFile(archive, cssEntries[0].replace(/^[\\/]+/, '')).toString('utf8');

const occurrences = css.split('.popout-drag button').length - 1;
console.log('.popout-drag button { no-drag } rules in shipped CSS:', occurrences, occurrences >= 2 ? '(GOOD — both strips patched)' : occurrences === 1 ? '(only one strip patched)' : '(MISSING — BAD)');
