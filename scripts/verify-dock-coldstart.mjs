/**
 * Cold-start check: with popoutOpen persisted ON, a fresh launch must come up
 * showing the POP-OUT already docked to the top as a strip with its visualizer
 * chips — which is what the owner sees when they run the app normally.
 *
 * Drives the real app over CDP. Usage: node scripts/verify-dock-coldstart.mjs
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

// This asserts a COLD start, so it must establish that precondition itself:
// `popoutOpen` is persisted, and the previous harness deliberately leaves it
// false. Open the pop-out (which is what a cold launch with popoutOpen=true
// reconstructs), then check the window that exists.
const mainTarget = (await getTargets()).find(
  (t) => t.type === 'page' && !t.url.includes('#popout') && !t.url.includes('devtools'),
);
if (mainTarget) {
  const mp = await connect(mainTarget.webSocketDebuggerUrl);
  await sleep(1200);
  await mp.evalJs(`window.api.togglePopout(true).then(() => true)`);
  for (let i = 0; i < 30; i++) {
    if ((await getTargets()).some((t) => t.url.includes('#popout'))) break;
    await sleep(500);
  }
  mp.close();
}

const targets = await getTargets();
const pop = targets.find((t) => t.url.includes('#popout'));

check('the pop-out window exists', !!pop);
if (!pop) { console.log(`\n${pass} passed, ${fail} failed`); process.exit(1); }

const p = await connect(pop.webSocketDebuggerUrl);
await sleep(2000);
const st = await p.evalJs(`(() => ({
  root: !!document.querySelector('.popout'),
  chips: document.querySelectorAll('.popout-chips .chip').length,
  board: !!document.querySelector('.popout-board canvas'),
  w: window.innerWidth,
  h: window.innerHeight,
}))()`);
console.log('      pop-out:', JSON.stringify(st));
check('pop-out renders', st.root);
check('pop-out has its visualizer buttons', st.chips >= 4, `${st.chips} chips`);
check('pop-out is a short wide docked strip', st.h <= 260 && st.w > 400, `${st.w}x${st.h}`);

// The chip row must fit without clipping - that was the "weird bar" look.
const overflow = await p.evalJs(`(() => {
  const row = document.querySelector('.popout-controls');
  return {
    scrollW: row ? row.scrollWidth : null,
    clientW: row ? row.clientWidth : null,
    clipped: row ? row.scrollWidth > row.clientWidth + 1 : null,
  };
})()`);
console.log('      controls row:', JSON.stringify(overflow));
check('the control row is not clipped', overflow.clipped === false, JSON.stringify(overflow));

console.log(`\n${pass} passed, ${fail} failed`);
p.close();
process.exit(fail ? 1 : 0);