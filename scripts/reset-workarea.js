// One-shot desktop recovery: force the primary display's work area back to
// the full screen. Windows does not reclaim appbar space when the owning
// process dies, so a Recordr crash while docked-with-reservation can leave the
// top of the screen "invisible" until this runs (the shell then re-applies the
// taskbar's own strip, which is why setting the *full* screen is correct).
//
//   node scripts/reset-workarea.js
// After running, restart Recordr: its own startup reclaim (reclaimStaleAppBar)
// also does this, and the tray has a "Fix desktop work area" item as backup.
const koffi = require('koffi');

try {
  const user32 = koffi.load('user32.dll');
  const RECT = koffi.struct('RECT_WA', {
    left: 'long', top: 'long', right: 'long', bottom: 'long',
  });
  const SystemParametersInfoW = user32.func(
    'bool __stdcall SystemParametersInfoW(uint32 uiAction, uint32 uiParam, _Inout_ RECT_WA *pvParam, uint32 fWinIni)',
  );
  const GetSystemMetrics = user32.func('int __stdcall GetSystemMetrics(int nIndex)');
  const full = {
    left: 0,
    top: 0,
    right: GetSystemMetrics(0),  // SM_CXSCREEN
    bottom: GetSystemMetrics(1), // SM_CYSCREEN
  };
  // SPI_SETWORKAREA | SPIF_UPDATEINIFILE | SPIF_SENDCHANGE
  const ok = SystemParametersInfoW(0x002f, 0, full, 0x01 | 0x02);
  console.log(ok ? 'OK: work area reset to full screen' : 'FAILED: SPI_SETWORKAREA returned false');
  process.exitCode = ok ? 0 : 1;
} catch (err) {
  console.error('Failed:', err.message);
  process.exitCode = 1;
}