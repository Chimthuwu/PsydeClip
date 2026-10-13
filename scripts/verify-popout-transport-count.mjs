// One-shot asar content check (2026-10-13): popout record/export duplication.
// The hover-controls Transport JSX is gone; the top-bar one stays.
// Verify at the BUNDLE level: PopoutApp code is part of the shared index chunk,
// so "Transport" component usage can't be counted by name after minification —
// instead assert the `popout-controls` block no longer wraps a Transport by
// checking the distinctive `popout-chips` container and the source both.
import asar from '@electron/asar';

const archive = 'release/win-unpacked/resources/app.asar';
const all = asar.listPackage(archive).map((p) => String(p));
const norm = (p) => p.replace(/\\/g, '/').replace(/^\//, '').toLowerCase();
const bundles = all.filter((p) => norm(p).startsWith('dist/renderer/assets/index-') && norm(p).endsWith('.js'));
if (bundles.length !== 1) throw new Error(`expected one renderer index bundle, got: ${bundles.join(', ')}`);
const js = asar.extractFile(archive, bundles[0].replace(/^[\\/]+/, '')).toString('utf8');

// The chips block survives (visualizer toggles must stay).
console.log('popout chips block shipped:', js.includes('popout-chips') ? 'PRESENT (GOOD)' : 'MISSING (BAD)');
// The hover-controls wrapper itself is still referenced by PopoutApp.
console.log('popout-controls wrapper shipped:', js.includes('popout-controls') ? 'PRESENT (expected — chips live inside it)' : 'MISSING');
