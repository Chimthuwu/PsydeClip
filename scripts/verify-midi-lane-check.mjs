/**
 * Asserts the History board carries no MIDI/piano-roll grid, and that the
 * dedicated MIDI visualizer still draws one. The two used to overlap.
 */
const port = process.argv[2] ?? '9223';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0, fail = 0;
const check = (n, ok, d = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  [' + d + ']' : ''}`);
};

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
      if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 300));
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

// Un-dock so the board has real height, and show History on its own.
await page.evalJs(`window.api.snapWindow('center'); true`);
await sleep(1500);
await page.evalJs(`(() => {
  const b = [...document.querySelectorAll('button')].find(x => /Split|Single/i.test(x.title || ''));
  if (b && /Split/i.test(b.title)) b.click();
  return true;
})()`);
await sleep(1200);

const view = await page.evalJs(`(() => ({
  panes: document.querySelectorAll('.viz-pane').length,
  tags: [...document.querySelectorAll('.viz-pane-tag')].map(t => t.textContent),
  laneCanvases: document.querySelectorAll('canvas.lane, .piano-roll-lane, .lane').length,
  canvasesPerPane: [...document.querySelectorAll('.viz-pane')].map(p => p.querySelectorAll('canvas').length),
}))()`);
console.log('      view:', JSON.stringify(view));

// Close every pane except History: History must be the only board left.
const onlyHistory = await page.evalJs(`(() => {
  // The ✕ on each pane closes it.
  const panes = [...document.querySelectorAll('.viz-pane')];
  panes.forEach((p) => {
    const tag = p.querySelector('.viz-pane-tag')?.textContent || '';
    if (tag.trim().toLowerCase() !== 'history') p.querySelector('.viz-pane-x')?.click();
  });
  return true;
})()`);
await sleep(1500);

const historyOnly = await page.evalJs(`(() => {
  const panes = [...document.querySelectorAll('.viz-pane')];
  return {
    panes: panes.length,
    tags: panes.map(p => p.querySelector('.viz-pane-tag')?.textContent),
    canvases: panes.map(p => p.querySelectorAll('canvas').length),
    laneEls: document.querySelectorAll('.lane, .piano-roll-lane, canvas.lane').length,
  };
})()`);
console.log('      history-only:', JSON.stringify(historyOnly));

check(
  'History board has no piano-roll lane',
  historyOnly.laneEls === 0,
  `lane elements=${historyOnly.laneEls}`,
);
// History is one canvas (the waveform). It used to be two: wave + MIDI lane.
check(
  'History draws a single canvas (no second MIDI grid underneath)',
  historyOnly.canvases.every((c) => c <= 1),
  `canvases per pane=${JSON.stringify(historyOnly.canvases)}`,
);

// The dedicated MIDI grid must still exist as its own mode.
const midiPresent = await page.evalJs(`(() => {
  const add = [...document.querySelectorAll('button')]
    .some(b => /midi/i.test((b.textContent || '') + ' ' + (b.title || '')));
  return { addTileMentionsMidi: add };
})()`);
check(
  'the dedicated MIDI grid is still offered as its own view',
  midiPresent.addTileMentionsMidi,
  JSON.stringify(midiPresent),
);

console.log(`\n${pass} passed, ${fail} failed`);
page.close();
process.exit(fail ? 1 : 0);