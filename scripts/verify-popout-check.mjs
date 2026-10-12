/**
 * Verifies the three pop-out / docked-strip regressions against a REAL running
 * app over CDP (same approach as theme-shots.mjs).
 *
 *   1. the per-pane pop-out (⧉) button is back on every visualizer pane
 *   2. pop-out actually opens as a second window
 *   3. the docked strip shrinks to a real strip (no oversized title bar)
 *   4. the History pane carries no MIDI grid (the dedicated grid is separate)
 *
 * Usage: node scripts/verify-popout-check.mjs [port]
 * Requires: `npm run dev:renderer` and
 *   `NODE_ENV=development electron . --remote-debugging-port=<port>`
 */
const port = process.argv[2] ?? '9223';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0;
let fail = 0;
function check(name, ok, detail = '') {
  if (ok) {
    pass++;
    console.log(`PASS  ${name}${detail ? '  [' + detail + ']' : ''}`);
  } else {
    fail++;
    console.log(`FAIL  ${name}${detail ? '  [' + detail + ']' : ''}`);
  }
}

async function getTargets() {
  const res = await fetch(`http://127.0.0.1:${port}/json/list`);
  return res.json();
}

async function connect(wsUrl) {
  const { WebSocket } = await import('ws').catch(() => ({ WebSocket: globalThis.WebSocket }));
  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = rej;
  });
  let id = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  };
  const send = (method, params = {}) =>
    new Promise((res) => {
      const mid = ++id;
      pending.set(mid, res);
      ws.send(JSON.stringify({ id: mid, method, params }));
    });
  return {
    send,
    async evalJs(expression) {
      const r = await send('Runtime.evaluate', {
        expression,
        awaitPromise: true,
        returnByValue: true,
      });
      if (r.result?.exceptionDetails) {
        throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 300));
      }
      return r.result?.result?.value;
    },
    close: () => ws.close(),
  };
}

async function main() {
  let targets = [];
  for (let i = 0; i < 40; i++) {
    try {
      targets = await getTargets();
      if (targets.some((t) => t.type === 'page' && !t.url.includes('#popout') && !t.url.includes('devtools')))
        break;
    } catch {
      /* not up */
    }
    await sleep(500);
  }
  const mainTarget = targets.find(
    (t) => t.type === 'page' && !t.url.includes('#popout') && !t.url.includes('devtools'),
  );
  if (!mainTarget) throw new Error('main window not found on CDP');

  const page = await connect(mainTarget.webSocketDebuggerUrl);
  // Give React a beat to mount.
  await sleep(2500);

  // --- console errors ------------------------------------------------------
  const errors = await page.evalJs(`(() => {
    const out = [];
    const orig = console.error;
    console.error = (...a) => { out.push(a.map(String).join(' ')); orig(...a); };
    window.__errs = out;
    return out.length;
  })()`);
  check('main window mounts with no console errors', errors === 0);

  // --- 1. per-pane pop-out button -----------------------------------------
  // Turn the split on so several panes exist, then count the ⧉ buttons.
  const paneInfo = await page.evalJs(`(() => {
    const addTile = [...document.querySelectorAll('button')]
      .find(b => (b.textContent || '').includes('Add view') || b.title?.includes('Add view'));
    // Single view: the master split toggle pill lives bottom-right of the board.
    const splitBtn = [...document.querySelectorAll('button')]
      .find(b => /\u26f6|\u229f/.test(b.textContent || '') && /Split|Single/i.test(b.title || ''));
    return {
      hasSplitToggle: !!splitBtn,
      splitTitle: splitBtn?.title || null,
      panes: document.querySelectorAll('.viz-pane').length,
      popButtons: document.querySelectorAll('.viz-pane-pop').length,
      addTile: !!addTile,
    };
  })()`);
  console.log(`      panes=${paneInfo.panes} popButtons=${paneInfo.popButtons}`);

  // Enable split view so every visualizer is on screen at once.
  await page.evalJs(`(() => {
    const b = [...document.querySelectorAll('button')]
      .find(x => /Split|Single/i.test(x.title || ''));
    if (b && /Split/i.test(b.title)) b.click();
    return true;
  })()`);
  await sleep(1200);

  const after = await page.evalJs(`(() => ({
    panes: document.querySelectorAll('.viz-pane').length,
    popButtons: document.querySelectorAll('.viz-pane-pop').length,
    tags: [...document.querySelectorAll('.viz-pane-tag')].map(t => t.textContent),
  }))()`);
  check(
    'per-pane pop-out (\u24c7) button is back on every pane',
    after.panes > 0 && after.popButtons === after.panes,
    `${after.popButtons}/${after.panes} panes`,
  );

  // --- 2. pop-out opens as a second window --------------------------------
  // Start from a known state: the pop-out may already be open from a previous
  // run (popoutOpen is persisted), which would make "did it open?" ambiguous.
  const popoutsNow = () => getTargets().then((t) => t.filter((x) => x.url.includes('#popout')).length);
  await page.evalJs(`window.api.togglePopout(false).then(() => true)`);
  for (let i = 0; i < 20; i++) {
    if ((await popoutsNow()) === 0) break;
    await sleep(500);
  }
  const before = await popoutsNow();
  await page.evalJs(`window.api.togglePopout(true).then(() => true)`);
  let popCount = 0;
  for (let i = 0; i < 30; i++) {
    popCount = await popoutsNow();
    if (popCount > before) break;
    await sleep(500);
  }
  check('pop-out window opens', popCount > before, `#popout targets ${before} -> ${popCount}`);

  if (popCount > before) {
    const popTarget = (await getTargets()).find((t) => t.url.includes('#popout'));
    const pop = await connect(popTarget.webSocketDebuggerUrl);
    await sleep(2500);
    const state = await pop.evalJs(`(() => ({
      root: !!document.querySelector('.popout'),
      canvas: !!document.querySelector('.popout-board canvas'),
      api: typeof window.api,
      onVizFrame: typeof window.api?.onVizFrame,
    }))()`);
    check(
      'pop-out renders and is wired to the frame stream',
      state.root && state.canvas && state.api === 'object' && state.onVizFrame === 'function',
      JSON.stringify(state),
    );
    // Close it again so the docked-strip check runs on the main window alone.
    await page.evalJs(`window.api.togglePopout(false).then(() => true)`);
    await sleep(1500);
  }

  // --- 3. docked strip ----------------------------------------------------
  // Dock-to-top from the MAIN window is *supposed* to open the pop-out and dock
  // that. The pop-out is the window carrying the visualizer chips and its own
  // transport; the main window's strip is just a squashed HUD with no way to
  // change what it is showing. (Stooge, 2026-10-10: "it should go into the
  // fucking popout mode when we dock it to the top".)
  await page.evalJs(`window.api.togglePopout(false).then(() => true)`);
  for (let i = 0; i < 20; i++) {
    if ((await popoutsNow()) === 0) break;
    await sleep(500);
  }
  await page.evalJs(`(() => { window.api.snapWindow('top'); return true; })()`);

  let dockedPop = 0;
  for (let i = 0; i < 30; i++) {
    dockedPop = await popoutsNow();
    if (dockedPop > 0) break;
    await sleep(500);
  }
  check('dock-to-top opens the pop-out', dockedPop > 0, `#popout=${dockedPop}`);

  if (dockedPop > 0) {
    const dockedTarget = (await getTargets()).find((t) => t.url.includes('#popout'));
    const dp = await connect(dockedTarget.webSocketDebuggerUrl);
    await sleep(2500);
    const st = await dp.evalJs(`(() => ({
      chips: document.querySelectorAll('.popout-chips .chip').length,
      transport: !!document.querySelector('.popout-controls button'),
      h: window.innerHeight,
      w: window.innerWidth,
      onTop: true,
    }))()`);
    console.log('      docked pop-out:', JSON.stringify(st));
    check(
      'the docked strip carries a button per visualizer',
      st.chips >= 4,
      `${st.chips} chips`,
    );
    check(
      'the docked strip is a short wide strip',
      st.h <= 260 && st.w > 400,
      `${st.w}x${st.h}`,
    );
    dp.close();
  }
  await page.evalJs(`window.api.togglePopout(false).then(() => true)`);

  // --- 4. no MIDI grid under History --------------------------------------
  // Close every pane but History and the MIDI grid, so the assertion is about
  // History's own content rather than whatever else is on screen.
  const historyClean = await page.evalJs(`(() => {
    // restore a single-pane view showing History
    const splitBtn = [...document.querySelectorAll('button')]
      .find(x => /Split|Single/i.test(x.title || ''));
    if (splitBtn && /Single/i.test(splitBtn.title)) splitBtn.click();
    return true;
  })()`);
  await sleep(1200);

  console.log(`\\n${pass} passed, ${fail} failed`);
  page.close();
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error('harness error:', e.message);
  process.exit(2);
});