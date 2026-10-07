/**
 * Capture screenshots of every theme from the Recordr dev instance (CDP).
 * Refuses to shoot unless the page is Recordr.
 *
 * Writes to `marketing-website/assets/themes/` by default, which is where the
 * marketing site's `<img>` tags point (`main-<theme>.png`), so one run fills in
 * the site's theme gallery and gives the README something to show.
 *
 * Usage: node scripts/theme-shots.mjs [port] [outDir]
 * Requires: `npm run dev:renderer` and
 *   `NODE_ENV=development electron . --remote-debugging-port=<port>`
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const port = process.argv[2] ?? '9223';
const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = process.argv[3] ?? path.join(here, '..', 'marketing-website', 'assets', 'themes');
/**
 * Mirrors THEMES in src/shared/types.ts — the one list the Settings panel and
 * the right-click quick menu read from. Keep it in step with that (12 themes as
 * of 2026-10-06; "dark-lime" was deleted and became "black-ice").
 */
const themes = [
  'modern',
  'classic',
  'cyberpunk',
  'synthwave',
  'monochrome',
  'kawaii',
  'aqua',
  'sakura',
  'lime',
  'blood-red',
  'nocturnal',
  'black-ice',
];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getTarget() {
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/list`);
      const list = await res.json();
      const page = list.find((t) => t.type === 'page');
      if (page) return page;
    } catch {
      /* not up */
    }
    await sleep(500);
  }
  throw new Error('no page target');
}

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const pending = new Map();
    let id = 0;
    ws.onopen = () =>
      resolve({
        send(method, params = {}) {
          return new Promise((res, rej) => {
            const msgId = ++id;
            pending.set(msgId, { res, rej });
            ws.send(JSON.stringify({ id: msgId, method, params }));
          });
        },
        close: () => ws.close(),
      });
    ws.onerror = (e) => reject(new Error('ws error'));
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && pending.has(msg.id)) {
        const p = pending.get(msg.id);
        pending.delete(msg.id);
        msg.error ? p.rej(new Error(msg.error.message)) : p.res(msg.result);
      }
    };
  });
}

async function evalJs(cdp, expression) {
  const r = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(`eval failed: ${JSON.stringify(r.exceptionDetails).slice(0, 300)}`);
  return r.result?.value;
}

const GUARD = `({
  ok: !!document.querySelector('.app'),
  hasPhaser: !!document.querySelector('#phaser-container, canvas.phaser'),
  api: typeof window.api,
  bodyClass: document.body.className,
})`;

async function main() {
  const target = await getTarget();
  const cdp = await connect(target.webSocketDebuggerUrl);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');

  const g = await evalJs(cdp, `(${GUARD})`);
  console.log('guard:', JSON.stringify(g));
  if (!g.ok || g.hasPhaser) {
    throw new Error('Page is NOT Recordr — aborting screenshot run.');
  }

  fs.mkdirSync(outDir, { recursive: true });
  const shots = [];
  const setTheme = (t) =>
    evalJs(cdp, `window.api.setSettings({ theme: '${t}' }).then(() => true)`);
  const bg = () => evalJs(cdp, `getComputedStyle(document.querySelector('.app')).getPropertyValue('--bg-app').trim()`);

  for (const theme of themes) {
    await setTheme(theme);
    await sleep(900);
    console.log(`${theme}: --bg-app =`, await bg());
    const file = path.join(outDir, `main-${theme}.png`);
    const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(file, Buffer.from(shot.data, 'base64'));
    shots.push(file);
  }

  cdp.close();

  const expected = themes.map((t) => path.join(outDir, `main-${t}.png`));
  const missing = expected.filter((f) => !fs.existsSync(f));
  console.log(`Wrote ${shots.length} shot(s) to ${outDir}:`);
  for (const f of shots) console.log(`  ${path.basename(f)} (${fs.statSync(f).size} bytes)`);
  if (missing.length) console.log(`MISSING main-window shots: ${missing.map((f) => path.basename(f)).join(', ')}`);
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
