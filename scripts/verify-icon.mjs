/**
 * Verify a packaged build wears the app's own icon, not the Electron atom.
 *
 * v3.1.0 shipped with the default Electron icon on the taskbar: rcedit never
 * ran, because the winCodeSign cache that carries it could not be unpacked
 * (see scripts/seed-wincodesign.mjs). The build still reported success, so
 * nothing caught it. This does.
 *
 * Every image in build/icon.ico is a standalone PNG payload, so the check is
 * exact rather than visual: each payload must appear byte-for-byte inside the
 * .exe's resources. Pass a build directory as argv[2] (default: release/).
 *
 *   node scripts/verify-icon.mjs release-3.2.0
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

// The exe is named after productName, which changed with the rename; read it
// rather than hard-coding a name this check would then silently SKIP.
const { build } = JSON.parse(readFileSync('package.json', 'utf8'));
const PRODUCT = build?.productName ?? 'app';

const outDir = process.argv[2] || 'release';
const ico = readFileSync('build/icon.ico');

const count = ico.readUInt16LE(4);
const images = [];
for (let i = 0; i < count; i++) {
  const entry = 6 + 16 * i;
  images.push({
    w: ico.readUInt8(entry) || 256,
    h: ico.readUInt8(entry + 1) || 256,
    payload: ico.subarray(ico.readUInt32LE(entry + 12), ico.readUInt32LE(entry + 12) + ico.readUInt32LE(entry + 8)),
  });
}

const targets = [path.join(outDir, 'win-unpacked', `${PRODUCT}.exe`)];
if (existsSync(outDir)) {
  for (const f of readdirSync(outDir)) {
    if (f.endsWith('.exe')) targets.push(path.join(outDir, f));
  }
}

let failures = 0;
let checked = 0;
for (const target of targets) {
  if (!existsSync(target)) {
    console.log(`SKIP  ${target} (not built)`);
    continue;
  }
  const exe = readFileSync(target);
  const missing = images.filter((img) => !exe.includes(img.payload));
  checked++;
  if (missing.length) {
    failures++;
    console.log(`FAIL  ${path.basename(target)} — missing ${missing.map((m) => `${m.w}x${m.h}`).join(', ')}`);
  } else {
    console.log(`PASS  ${path.basename(target)} — all ${images.length} icon sizes embedded`);
  }
}

if (!checked) {
  console.log(`FAIL  nothing to check in ${outDir}/ — run npm run package first`);
  process.exit(1);
}
console.log(`\n  ${checked - failures}/${checked} binaries carry the ${PRODUCT} icon`);
process.exit(failures ? 1 : 0);
