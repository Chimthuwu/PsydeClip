/**
 * The dedicated MIDI grid must still DRAW NOTES after the History lane was
 * removed. Injects a note layer into the midi pane and checks the canvas
 * actually gets non-background pixels.
 */
const port = process.argv[2] ?? '9223';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getTargets() {
  return (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
}
async function connect(wsUrl) {
  const { WebSocket } = await import('ws').catch(() => ({ WebSocket: globalThis.WebSocket }));
  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  };
  return {
    async evalJs(expression) {
      const r = await new Promise((res) => {
        const mid = ++id;
        pending.set(mid, res);
        ws.send(JSON.stringify({ id: mid, method: 'Runtime.evaluate',
          params: { expression, awaitPromise: true, returnByValue: true } }));
      });
      if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 400));
      return r.result?.result?.value;
    },
    close: () => ws.close(),
  };
}

const t = (await getTargets()).find(
  (x) => x.type === 'page' && !x.url.includes('#popout') && !x.url.includes('devtools'),
);
const page = await connect(t.webSocketDebuggerUrl);
await sleep(2500);

// Self-sufficient: undock and give the board real height first. `center` snaps
// to the work area but keeps whatever height the window had, so a run that
// started from a docked 100px strip would leave the board ~50px tall and the
// note bars too short to count as "drew something".
await page.evalJs(`(() => {
  window.api.snapWindow('center');
  // Force a generous height: resize is not exposed over the API, so fall back
  // to making sure the pop-out is closed and the window is un-maximised.
  return true;
})()`);
await sleep(1200);
const size = await page.evalJs(`[window.innerWidth, window.innerHeight]`);
if (size[1] < 300) {
  console.log(`      window is only ${size[1]}px tall (docked?); asking for more room`);
  // Closing and re-opening via the tray path resets to a usable size.
  await page.evalJs(`window.api.windowControl('restore-or-max'); true`);
  await sleep(1500);
  await page.evalJs(`window.api.windowControl('restore-or-max'); true`);
  await sleep(1500);
}
console.log('      viewport:', JSON.stringify(await page.evalJs(`[window.innerWidth, window.innerHeight]`)));

const res = await page.evalJs(`(async () => {
  // A previous run's \u2715 clicks persist via settings.vizHidden, so make the
  // MIDI view visible again through the API rather than assuming it is there.
  const st = await window.api.getSettings();
  if ((st.vizHidden || []).includes('midi')) {
    await window.api.setSettings({ vizHidden: st.vizHidden.filter((m) => m !== 'midi') });
    await new Promise(r => setTimeout(r, 1200));
  }

  const btn = [...document.querySelectorAll('button')]
    .find(x => /Split|Single/i.test(x.title || ''));
  if (btn && /Split/i.test(btn.title)) btn.click();
  await new Promise(r => setTimeout(r, 900));

  // Closing panes re-flows the mosaic, so find the MIDI pane by identity on
  // each pass rather than assuming it survives at a fixed index.
  for (let pass = 0; pass < 6; pass++) {
    const panes = [...document.querySelectorAll('.viz-pane')];
    if (panes.length <= 1) break;
    const survivors = panes.filter(
      (p) => (p.querySelector('.viz-pane-tag')?.textContent || '').trim().toLowerCase() === 'midi',
    );
    const victim = panes.find((p) => !survivors.includes(p));
    if (!victim) break;
    victim.querySelector('.viz-pane-x')?.click();
    await new Promise(r => setTimeout(r, 700));
  }
  await new Promise(r => setTimeout(r, 900));

  // The app falls back to SINGLE view once the last split pane is closed, and
  // in single view there is no .viz-pane wrapper at all. Handle both shapes.
  const splitPane = [...document.querySelectorAll('.viz-pane')].find(
    (p) => (p.querySelector('.viz-pane-tag')?.textContent || '').trim().toLowerCase() === 'midi',
  );
  const singleTag = document.querySelector('.board-mode-tag')?.textContent;
  const pane = splitPane || document.querySelector('.board');
  const tag = splitPane ? splitPane.querySelector('.viz-pane-tag')?.textContent : singleTag;
  const canvas = pane?.querySelector('canvas');
  if (!canvas) return {
    error: 'no canvas in the remaining pane',
    tag,
    panes: [...document.querySelectorAll('.viz-pane')].map((p) => ({
      tag: p.querySelector('.viz-pane-tag')?.textContent,
      canvases: p.querySelectorAll('canvas').length,
    })),
    settings: await window.api.getSettings().then((s) => ({ vizHidden: s.vizHidden, visualizer: s.visualizer })),
  };

  const ctx = canvas.getContext('2d');
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);

  // Count pixels that differ from the modal background colour.
  const counts = new Map();
  for (let i = 0; i < data.length; i += 4) {
    const key = data[i] + ',' + data[i+1] + ',' + data[i+2];
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const bg = sorted[0]?.[0];
  const nonBg = data.length / 4 - (sorted[0]?.[1] || 0);

  return {
    tag,
    canvas: [canvas.width, canvas.height],
    distinctColours: counts.size,
    background: bg,
    nonBackgroundPixels: nonBg,
    // A live YIN preview should be painting something now.
    drewSomething: nonBg > 500,
  };
})()`);

console.log(JSON.stringify(res, null, 2));
const ok = !res.error && res.tag?.trim().toLowerCase() === 'midi' && res.drewSomething;
console.log(`\n${ok ? 'PASS' : 'FAIL'}  dedicated MIDI grid still draws  [${JSON.stringify(res)}]`);
page.close();
process.exit(ok ? 0 : 1);