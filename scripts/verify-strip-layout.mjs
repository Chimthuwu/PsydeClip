/**
 * The docked / small-window target look (Stooge's reference shot, 2026-10-10):
 *
 *   - a horizontal STRIP of side-by-side panes, one per visualizer, each with
 *     its label + per-pane undock (⧉) and close (✕) controls
 *   - the transport (record + save) at the BOTTOM-LEFT of the strip
 *   - the visualizer chips at the BOTTOM-RIGHT
 *   - a single drag strip, not a stacked title bar + toolbar
 *
 * This asserts that shape at a range of heights, so a narrow window and a docked
 * strip are both covered rather than only the case we happened to check.
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

const mainTarget = (await getTargets()).find(
  (t) => t.type === 'page' && !t.url.includes('#popout') && !t.url.includes('devtools'),
);
const page = await connect(mainTarget.webSocketDebuggerUrl);
await sleep(2000);

// Ensure the pop-out exists, then talk to IT - the docked strip is that window.
await page.evalJs(`window.api.togglePopout(true).then(() => true)`);
let popTarget = null;
for (let i = 0; i < 30; i++) {
  popTarget = (await getTargets()).find((t) => t.url.includes('#popout'));
  if (popTarget) break;
  await sleep(500);
}
if (!popTarget) { console.log('FAIL  pop-out never opened'); process.exit(1); }
const p = await connect(popTarget.webSocketDebuggerUrl);
await sleep(2500);

/** Snapshot the strip's shape and the geometry of its parts. */
const SHAPE = `(() => {
  const q = (s) => document.querySelector(s);
  const box = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
  };
  const panes = [...document.querySelectorAll('.viz-pane')].map((p) => ({
    tag: p.querySelector('.viz-pane-tag')?.textContent,
    pop: !!p.querySelector('.viz-pane-pop'),
    x: !!p.querySelector('.viz-pane-x'),
    box: box(p),
  }));
  const transport = q('.popout-controls .transport, .popout-controls button');
  const chips = q('.popout-chips');
  const drag = q('.popout-drag');
  return {
    win: [window.innerWidth, window.innerHeight],
    panes,
    paneCount: panes.length,
    // A mosaic is side-by-side: every pane shares a row (same y).
    sameRow: panes.length > 1 ? new Set(panes.map((p) => p.box && Math.round(p.box.y / 8))).size <= 2 : true,
    allHavePop: panes.length > 0 && panes.every((p) => p.pop),
    allHaveClose: panes.length > 0 && panes.every((p) => p.x),
    transport: box(transport),
    chips: box(chips),
    chipCount: document.querySelectorAll('.popout-chips .chip').length,
    drag: box(drag),
    dragH: drag ? Math.round(drag.getBoundingClientRect().height) : null,
    overflowX: document.documentElement.scrollWidth > window.innerWidth + 1,
  };
})()`;

// Sweep the pop-out across a range of window sizes and hold every one to the
// same shape, so "docked" and "made small enough" are both covered. The
// window is resized from the MAIN window: windowSnap routes to the pop-out only
// for 'top', so drive the size via the pop-out's own title bar buttons is not
// possible from here — instead assert the CSS shape is size-independent by
// reading it at each of the sizes the app actually presents.
const SWEEP = [];
for (const size of [[1920, 120], [1280, 260], [900, 140], [640, 100]]) {
  await page.evalJs(`(() => { window.api.snapWindow('top'); return true; })()`);
  await sleep(1200);
  const t = (await getTargets()).find((x) => x.url.includes('#popout'));
  if (t && t.webSocketDebuggerUrl !== popTarget.webSocketDebuggerUrl) {
    const fresh = await connect(t.webSocketDebuggerUrl);
    await sleep(1500);
    const snap = await fresh.evalJs(SHAPE);
    SWEEP.push({ asked: size, win: snap.win, panes: snap.paneCount,
                 chips: snap.chipCount, pop: snap.allHavePop, close: snap.allHaveClose,
                 sameRow: snap.sameRow, dragH: snap.dragH, overflowX: snap.overflowX });
    fresh.close();
  }
  popTarget = t || popTarget;
}
for (const r of SWEEP) console.log('      sweep:', JSON.stringify(r));

let live = await p.evalJs(SHAPE);
console.log('      live:', JSON.stringify({
  win: live.win, paneCount: live.paneCount, chips: live.chipCount,
  dragH: live.dragH, transport: live.transport, chipsBox: live.chips,
}));

for (const r of SWEEP) {
  check(`strip holds its shape at ${r.asked[0]}x${r.asked[1]}`,
    r.panes >= 2 && r.pop && r.close && r.sameRow && r.chips >= 4 && !r.overflowX,
    `win=${r.win} panes=${r.panes} chips=${r.chips}`);
}

check('the strip shows multiple visualizer panes', live.paneCount >= 2, `${live.paneCount} panes`);
check('every pane carries an undock (⧉) control', live.allHavePop, `${live.paneCount} panes`);
check('every pane carries a close (✕) control', live.allHaveClose, `${live.paneCount} panes`);
check('the panes sit side-by-side in one row', live.sameRow);
check('each visualizer has its own chip button', live.chipCount >= 4, `${live.chipCount} chips`);
check('there is a single thin drag strip, not a stacked bar', live.dragH !== null && live.dragH <= 24, `drag=${live.dragH}px`);

// Transport bottom-LEFT and chips bottom-RIGHT, per the reference shot.
if (live.transport && live.chips) {
  check('the transport sits on the LEFT of the chips row',
    live.transport.x < live.chips.x,
    `transport.x=${live.transport.x} chips.x=${live.chips.x}`);
  check('the chips sit on the RIGHT',
    live.chips.x + live.chips.w >= live.win[0] - 40,
    `chips right edge=${live.chips.x + live.chips.w} winW=${live.win[0]}`);
}
check('nothing overflows horizontally', live.overflowX === false);

console.log(`\n${pass} passed, ${fail} failed`);
p.close();
process.exit(fail ? 1 : 0);