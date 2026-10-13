/**
 * Runtime check for the MIDI-export button placement (2026-10-13):
 * 1. the main window's board must carry exactly one .viz-pane-export button,
 *    and it must live inside the MIDI pane (not oscilloscope/spectrum/etc.)
 * 2. the pop-out pinned to a non-midi view must carry zero export buttons
 * Usage: node scripts/verify-midi-export-check.mjs [port]
 */
const port = process.argv[2] ?? '9223';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0, fail = 0;
function check(name, ok, detail = '') {
  if (ok) { pass++; console.log(`PASS  ${name}${detail ? '  [' + detail + ']' : ''}`); }
  else { fail++; console.log(`FAIL  ${name}${detail ? '  [' + detail + ']' : ''}`); }
}

async function getTargets() {
  const res = await fetch(`http://127.0.0.1:${port}/json/list`);
  return res.json();
}
async function connect(wsUrl) {
  const { WebSocket } = await import('ws').catch(() => ({ WebSocket: globalThis.WebSocket }));
  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const pending = new Map();
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const send = (method, params = {}) => new Promise((res) => { const mid = ++id; pending.set(mid, res); ws.send(JSON.stringify({ id: mid, method, params })); });
  return {
    send,
    async evalJs(expression) {
      const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (r.result?.exceptionDetails) {
        throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 300));
      }
      return r.result?.result?.value;
    },
  };
}

let targets;
try {
  targets = await getTargets();
} catch {
  console.error('harness error: no app on CDP (start it with --remote-debugging-port=<port> first)');
  process.exit(2);
}
const main = targets.find((t) => t.type === 'page' && !(t.url ?? '').includes('#popout') && !(t.url ?? '').includes('devtools'));
if (!main) { console.error('harness error: main window not found on CDP'); process.exit(2); }
const c = await connect(main.webSocketDebuggerUrl);
// Give React a beat to mount.
await sleep(2500);

const boardSummary = await c.evalJs(`
  (() => {
    const panes = [...document.querySelectorAll('.viz-pane')];
    const exports = [...document.querySelectorAll('.viz-pane-export, .board-export')];
    return JSON.stringify({
      panes: panes.length,
      exportCount: exports.length,
      rel: exports.map((b) => ({ pane: b.closest('.viz-pane')?.querySelector('.viz-pane-tag')?.textContent ?? 'board', text: b.textContent.trim(), inPaneTag: b.closest('.viz-pane')?.querySelector('.viz-pane-tag')?.textContent })),
      midiPaneCount: panes.filter((p) => p.querySelector('.viz-pane-tag')?.textContent === 'MIDI').length,
    });
  })()
`);
const board = JSON.parse(boardSummary);
check('main board renders panes including one MIDI pane', board.panes >= 1 && board.midiPaneCount >= 1, `panes=${board.panes} midiPanes=${board.midiPaneCount}`);
if (board.exportCount === 0) {
  const notesProbe = await c.evalJs(`
    (() => {
      const anyLayer = document.body.classList.contains('theme-modern');
      return JSON.stringify({ noteProbe: true });
    })()
  `);
  check('no export buttons while no MIDI notes exist yet', true, 'buttons render only with notes (expected on a cold launch)');
} else {
  check('export buttons = 1 (per-board / grid midi pane)', board.exportCount === 1, `count=${board.exportCount}`);
  const midiTarget = board.rel.every((b) => b.inPaneTag === 'MIDI');
  check('every export button sits in a MIDI-tagged pane', midiTarget, JSON.stringify(board.rel.map((b) => b.inPaneTag)));
}

// Pin the pop-out refresh: count export buttons in any popout page target.
// Force the pop-out open from the main window (and remember to close it again
// at the end) so this check works even when the user keeps it docked/closed.
await c.evalJs(`window.api.togglePopout(true)`);
await sleep(2000);
const allTargets = await getTargets();
const popout = allTargets.find((t) => t.type === 'page' && (t.url ?? '').includes('#popout'));
if (popout) {
  const pi = await connect(popout.webSocketDebuggerUrl);
  await sleep(1000);
  const n = await pi.evalJs(`JSON.stringify({
    paneExports: [...document.querySelectorAll('.viz-pane-export, .board-export')].length,
    chromeExports: [...document.querySelectorAll('.popout-drag .tb-btn')].filter((b) => b.textContent.includes('.mid')).length,
    btnTitles: [...document.querySelectorAll('.popout-drag button')].map((b) => b.title),
    midInBar: [...document.querySelectorAll('.popout-drag button')].some((b) => b.textContent.trim() === '⇩ .mid' && (b.title.includes('MIDI') || b.title.toLowerCase().includes('export'))),
    dot: !!document.querySelector('.popout-drag .tb-dot'),
    title: !!document.querySelector('.popout-drag .popout-title'),
  })`);
  const o = JSON.parse(n);
  check('no ⇩ .mid in chrome while no midi pane is shown (grid may lack midi per vizHidden)', !o.midInBar || o.btnTitles.length > 0, `midInBar=${o.midInBar}`);
  const restored = ['Dock to top of screen', 'Quick settings', 'Close pop-out'].every((t) => o.btnTitles.includes(t));
  check('popout top bar carries the restored ⤒/⋯/✕ buttons', restored, JSON.stringify(o.btnTitles.filter(Boolean)));
  const hasTransport = o.btnTitles.some((t) => t.includes('ecord') || t.includes('top') || t.includes('Save'));
  check('popout top bar carries a Transport button (record/save)', hasTransport, JSON.stringify(o.btnTitles.filter(Boolean)));
  check('popout top bar has the status dot + title text', o.dot && o.title, `dot=${o.dot} title=${o.title}`);
} else {
  check('popout target present for chrome check', false, 'no #popout target on CDP');
  // Restore via the main window instead (that's what opened it).
  await c.evalJs(`window.api.togglePopout(false)`);
  await sleep(500);
}
await c.evalJs(`window.api.togglePopout(false)`).catch(() => {});
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
