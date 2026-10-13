// One-shot asar content check (2026-10-13): "live preview" badge removal.
// The renderer bundle is hashed per build, so find it INSIDE the asar (that is
// the tree that actually ships) by its fixed path prefix.
import asar from '@electron/asar';

const archive = 'release/win-unpacked/resources/app.asar';
const all = asar.listPackage(archive).map((p) => String(p));
const norm = (p) => p.replace(/\\/g, '/').replace(/^\//, '').toLowerCase();
const bundles = all.filter((p) => norm(p).startsWith('dist/renderer/assets/index-') && norm(p).endsWith('.js'));
if (bundles.length !== 1) throw new Error(`expected one renderer index bundle, got: ${bundles.join(', ')}`);
// listPackage returns paths with a leading separator; extractFile wants the
// relative form without it.
const entry = bundles[0].replace(/^\\+/, '');
const js = asar.extractFile(archive, entry).toString('utf8');
console.log('bundle:', entry);
console.log('live preview badge in shipped bundle:', js.includes('live preview') ? 'STILL PRESENT (BAD)' : 'GONE (GOOD)');
