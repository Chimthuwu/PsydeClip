// Runtime check (2026-10-13): this round's three fixes, against the RUNNING app.
//  1. ⧉/✕ buttons are above the selection overlay on history/spectrogram panes
//     (computed z-index/pointer events — the crosshair could swallow clicks)
//  2. a clear-buffer button exists in main HUD and in the popout top bar
//  3. the popout viz-state packets arrive at ~2/s max, not at frame rate
// Usage: node scripts/verify-round-check.mjs [port]
const port = process.argv[2] ?? '9229';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
function check(name, ok, detail = '') {
  if (ok) { pass++; console.log(`PASS  ${name}${detail ? '  [' + detail + ']' : ''}`); }
  else { fail++; console.log(`FAIL  ${name}${detail ? '  [' + detail + ']' : ''}`); }
}
async function targets() { return (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); }
async function connect(wsUrl) {
  const { WebSocket } = await import('ws').catch(() => ({ WebSocket: globalThis.WebSocket }));
  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const pending = new Map();
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const send = (method, params = {}) => new Promise((res) => { const mid = ++id; pending.set(mid, res); ws.send(JSON.stringify({ id: mid, method, params })); });
  return {
    async evalJs(expression) {
      const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 300));
      return r.result?.result?.value;
    },
  };
}

const list = await targets();
const main = list.find((t) => t.type === 'page' && !(t.url ?? '').includes('#popout') && !(t.url ?? '').includes('devtools'));
if (!main) { console.error('main window not found on CDP'); process.exit(2); }
const c = await connect(main.webSocketDebuggerUrl);
await sleep(2000);

// 1. overlay vs buttons stacking on history/spectrogram panes
const stack = await c.evalJs(`(() => {
  const out = [];
  for (const pane of document.querySelectorAll('.viz-pane')) {
    const tag = pane.querySelector('.viz-pane-tag')?.textContent ?? '?';
    const overlay = pane.querySelector('.history-interaction-layer');
    const xbtn = pane.querySelector('.viz-pane-x');
    const pbtn = pane.querySelector('.viz-pane-pop');
    if (!overlay || !xbtn) continue;
    const zi = (el) => parseInt(getComputedStyle(el).zIndex, 10) || 0;
    const topAt = (el) => {
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      const hit = document.elementFromPoint(cx, cy);
      return el === hit || el.contains(hit);
    };
    out.push({ tag, overlayZ: zi(overlay), xZ: zi(xbtn), pZ: zi(pbtn), xClickable: topAt(xbtn), pClickable: pbtn ? topAt(pbtn) : null });
  }
  return JSON.stringify(out);
})()`);
const panes = JSON.parse(stack);
for (const p of panes) {
  check(`${p.tag}: ⧉/✕ sit above the selection overlay`, p.xZ > p.overlayZ && p.pZ > p.overlayZ, `overlay=${p.overlayZ} ✕=${p.xZ} ⧉=${p.pZ}`);
}

// 2. clear-buffer buttons
const hudClear = await c.evalJs(`!!document.querySelector('.hud-actions button[aria-label="Clear buffer"]')`);
check('main HUD has the clear-buffer button', hudClear === true);

await c.evalJs(`window.api.togglePopout(true)`);
await sleep(2000);
const list2 = await targets();
const pop = list2.find((t) => t.type === 'page' && (t.url ?? '').includes('#popout'));
if (pop) {
  const pi = await connect(pop.webSocketDebuggerUrl);
  await sleep(800);
  const popClear = await pi.evalJs(`[...document.querySelectorAll('.popout-drag button[aria-label="Clear buffer"]')].length`);
  check('popout top bar has the clear-buffer button', popClear === 1, `count=${popClear}`);

  // 3. viz-state packet rate: sample onVizState arrivals for 3 s
  const count = await pi.evalJs(`(async () => {
    let n = 0;
    const off = window.api.onVizState(() => { n++; });
    await new Promise((r) => setTimeout(r, 3000));
    off();
    return n;
  })()`);
  // ~2/s × 3 s ≈ 6, allow slack for one straggler; frame rate would be 150+
  check('popout viz-state packets throttled (~2/s, not frame rate)', count <= 10, `${count} packets in 3s`);

  await pi.evalJs(`window.api.togglePopout(false)`);
  await sleep(500);
} else {
  check('popout target present', false);
  await c.evalJs(`window.api.togglePopout(false)`).catch(() => {});
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
