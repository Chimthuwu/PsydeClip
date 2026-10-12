/**
 * Screenshot the built landing page at desktop and phone width, so the design
 * can be eyeballed without a browser open. Start `npm run preview` first.
 *
 *   node scripts/shoot-landing.mjs <outDir> [url]
 */
import { app, BrowserWindow } from 'electron';
import { writeFileSync } from 'node:fs';
import path from 'node:path';

const outDir = process.argv[2];
const URL = process.argv[3] || 'http://localhost:4173/';

app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  // One window, resized between shots: a fresh BrowserWindow per shot raced the
  // preview server and the second load came back ERR_FAILED.
  const win = new BrowserWindow({ width: 1440, height: 1000, show: false });
  await win.loadURL(URL);
  await new Promise((r) => setTimeout(r, 2000));

  for (const [name, width, height, scrollTo] of [
    ['desktop-top', 1440, 1000, 0],
    ['desktop-features', 1440, 1000, 1500],
    ['desktop-themes', 1440, 1000, 2700],
    ['phone-top', 390, 844, 0],
    ['phone-features', 390, 844, 1800],
  ]) {
    win.setSize(width, height);
    await new Promise((r) => setTimeout(r, 800));
    // Scroll twice: a resize reflows the page and moves the viewport, so the
    // first scroll lands against the old layout.
    await win.webContents.executeJavaScript(`window.scrollTo(0, ${scrollTo})`);
    await new Promise((r) => setTimeout(r, 400));
    await win.webContents.executeJavaScript(`window.scrollTo(0, ${scrollTo})`);
    await new Promise((r) => setTimeout(r, 1200));
    const img = await win.webContents.capturePage();
    const file = path.join(outDir, `${name}.png`);
    writeFileSync(file, img.toPNG());
    console.log(`shot ${file}`);
  }
  app.exit(0);
});
