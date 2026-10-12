/**
 * Seed electron-builder's winCodeSign cache, minus the two macOS symlinks.
 *
 * WHY THIS EXISTS — this is the long-standing "Bug #3" wall, and it is what put
 * the generic Electron atom on the v3.1.0 exe:
 *
 *   winCodeSign-2.6.0.7z contains `darwin/10.12/lib/lib{crypto,ssl}.dylib` as
 *   SYMLINKS. Creating a symlink on Windows needs admin or Developer Mode, so
 *   7za exits non-zero, app-builder throws away the directory it just unpacked
 *   and retries forever. electron-builder never gets the cache — and `rcedit`
 *   lives inside it, so the app icon is never written onto the .exe. The build
 *   still "succeeds", which is why this went unnoticed: you only see it on the
 *   taskbar.
 *
 * The two dylibs are macOS code-signing libraries. A Windows build never reads
 * them, so we unpack everything EXCEPT `darwin/` into the exact directory
 * app-builder looks for. It finds a populated cache, skips the download and the
 * extraction, and rcedit runs.
 *
 * Idempotent, Windows-only, and a no-op once the cache is good.
 */
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';

const VERSION = 'winCodeSign-2.6.0';
const URL = `https://github.com/electron-userland/electron-builder-binaries/releases/download/${VERSION}/${VERSION}.7z`;

if (process.platform !== 'win32') {
  console.log('[wincodesign] not Windows — nothing to do');
  process.exit(0);
}

const cacheRoot = path.join(
  process.env.ELECTRON_BUILDER_CACHE || path.join(os.homedir(), 'AppData', 'Local', 'electron-builder', 'Cache'),
  'winCodeSign',
);
const target = path.join(cacheRoot, VERSION);
const rcedit = path.join(target, 'rcedit-x64.exe');

if (existsSync(rcedit)) {
  console.log(`[wincodesign] cache already good: ${target}`);
  process.exit(0);
}

const sevenZip = path.join(
  process.cwd(),
  'node_modules',
  '7zip-bin',
  'win',
  process.arch === 'ia32' ? 'ia32' : 'x64',
  '7za.exe',
);
if (!existsSync(sevenZip)) {
  console.error(`[wincodesign] 7za not found at ${sevenZip} — is node_modules installed?`);
  process.exit(1);
}

// Reuse an archive a previous (failed) run already downloaded, rather than
// pulling 5.6 MB again; those land beside the target dir as <random>.7z.
mkdirSync(cacheRoot, { recursive: true });
let archive = readdirSync(cacheRoot)
  .filter((f) => f.endsWith('.7z'))
  .map((f) => path.join(cacheRoot, f))[0];

if (!archive) {
  archive = path.join(cacheRoot, `${VERSION}.7z`);
  console.log(`[wincodesign] downloading ${URL}`);
  const curl = spawnSync('curl', ['-fsSL', '-o', archive, URL], { stdio: 'inherit' });
  if (curl.status !== 0) {
    console.error('[wincodesign] download failed — fetch the archive manually and re-run');
    process.exit(1);
  }
}

mkdirSync(target, { recursive: true });
console.log(`[wincodesign] unpacking ${path.basename(archive)} -> ${target} (skipping darwin/)`);
const unzip = spawnSync(sevenZip, ['x', '-bd', '-y', `-o${target}`, archive, '-x!darwin*'], {
  stdio: ['ignore', 'ignore', 'inherit'],
});
if (unzip.status !== 0 || !existsSync(rcedit)) {
  console.error(`[wincodesign] unpack failed (exit ${unzip.status}); rcedit present: ${existsSync(rcedit)}`);
  process.exit(1);
}
console.log('[wincodesign] ready — rcedit is available, the .exe will get its real icon');
