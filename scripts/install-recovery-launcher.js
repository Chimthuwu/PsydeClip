// Install (or remove) the per-user Startup-folder launcher for Unrecordable's
// "fixes on its own" appbar failsafe. The launcher runs at every logon; it
// checks the crash marker before doing anything, so a healthy logon costs
// nothing, and only a session that crashed while docked (marker left behind)
// actually boots the exe's hidden `--fix-workarea` recovery mode.
//
// The app itself rewrites this file on every startup (ensureDesktopRecoveryTask
// in src/main/index.ts — keep the two in sync), so this script is only for
// setting it up outside the app or repairing a deleted file:
//
//   node scripts/install-recovery-launcher.js                             # default exe: release/win-unpacked/Unrecordable.exe
//   node scripts/install-recovery-launcher.js "C:\Program Files\Recordr\Recordr.exe"
//   node scripts/install-recovery-launcher.js --uninstall
const fs = require('fs');
const path = require('path');

const startUpDir = path.join(
  process.env.APPDATA,
  'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup',
);
const vbsPath = path.join(startUpDir, 'Unrecordable Desktop Recovery.vbs');

const uninstall = process.argv.includes('--uninstall');
const argExe =
  process.argv.slice(2).find((a) => !a.startsWith('-')) ||
  path.resolve(__dirname, '..', 'release', 'win-unpacked', 'Unrecordable.exe');

if (uninstall) {
  try {
    fs.rmSync(vbsPath);
    console.log(`Removed ${vbsPath}`);
  } catch {
    console.log('Nothing to remove — launcher not present.');
  }
  process.exit(0);
}

if (!fs.existsSync(argExe)) {
  console.error(`Not found: ${argExe}`);
  console.error('Pass the Unrecordable.exe path as an argument, e.g.:');
  console.error('  node scripts/install-recovery-launcher.js "C:\\Program Files\\Unrecordable\\Unrecordable.exe"');
  process.exit(1);
}

// Matches `markerPath()` in src/main/appbar.ts for the packaged app
// (userData = %APPDATA%\Unrecordable).
const marker = path.join(process.env.APPDATA, 'Unrecordable', 'appbar-active');
// VBS treats backslashes literally (no escape sequences), but JS template
// literals would eat `\r`/`\u`… out of a Windows path — double them first.
const vbs = (p) => p.replace(/\\/g, '\\\\').replace(/"/g, '""');

const script = [
  `' Unrecordable desktop recovery: reclaims the top-of-screen strip an unexpected`,
  `' exit can leave reserved. Generated at startup; safe to delete.`,
  `On Error Resume Next`,
  `Set fso = CreateObject("Scripting.FileSystemObject")`,
  `If Not fso.FileExists("${vbs(marker)}") Then WScript.Quit 0`,
  `CreateObject("WScript.Shell").Run """${vbs(argExe)}"" --fix-workarea", 0, False`,
  '',
].join('\n');

fs.mkdirSync(startUpDir, { recursive: true });
fs.writeFileSync(vbsPath, script, 'utf8');
console.log(`Installed logon recovery launcher -> ${vbsPath}`);
console.log(`  marker: ${marker}`);
console.log(`  fixer:  ${argExe} --fix-workarea`);
console.log('Uninstall any time with: node scripts/install-recovery-launcher.js --uninstall');