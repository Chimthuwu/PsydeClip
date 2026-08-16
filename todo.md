# Recordr — Project Handoff

> **Last updated:** 2026-08-16 (Phase 8 + Bug #1 verification)
> **Repo root:** `C:\Users\Serge\Documents\GitHub\recordr`
> **Stack:** Electron 30 (Chromium 126) + React 18 + TypeScript + Vite, native WASAPI helper in C# / .NET 8 (NAudio)

---

## 1. What we're building

**Recordr** is a Windows-app-style **system audio recorder** with two backends:

1. **Desktop capture** (`desktopCapturer`) — Chromium's screen/window picker with system-audio loopback. Closest analogue to OBS-style "capture a window's audio."
2. **WASAPI loopback** (native) — per-speaker / per-headset capture via a tiny self-contained .NET 8 helper that drives **NAudio's `WasapiLoopbackCapture`**. This is the *true* per-output-device backend **the user specifically asked for** ("Add a 'loopback device' picker that bypasses desktopCapturer for true per-speaker capture").

The modes (inspired by [birdsthings.com Rolling Sampler](https://www.birdsthings.com/)):

* **Rolling** (default, 15-min in-memory cap): MediaRecorder is always on; pressing the hotkey drains whatever has buffered in RAM out to a `.webm` file. Users never lose clips from the past N minutes.
* **Traditional**: hotkey toggles recording on/off; the session auto-saves on stop.

The UI: a single dashboard with a **header HUD** (status pill + buffer-fill bar + VU meter + always-on-top toggle + roll-save button), a **big visualizer** (switchable oscilloscope / spectrum / scrolling spectrogram) adapted from `Audio Oscilloscope & Spectrum Analyzer.html` that lives on the user's desktop (`C:\Users\Serge\Desktop\Audio Oscilloscope & Spectrum Analyzer.html`), a **footer with source picker** (screen/window OR WASAPI device), the visualizer-mode chip row, and a **settings modal** (folder picker, theme, buffer seconds, bitrate, hotkey capture, capture-backend radio, filename template editor + token chips, always-on-top, windowed/unwindowed behaviour). Plus a **toast stack** for save confirmations and errors.

Phase 8 wrapped all of that in a **chrome/layout system**: our own 26px title bar (or the OS one), three layouts (`full` / `compact` / `bar`, the last being a 38px strip you can dock across the top of a monitor), edge snapping, per-element visibility toggles, and a **pop-out visualizer** in its own always-on-top window. Six themes: classic, modern, cyberpunk, synthwave, monochrome, kawaii.

The app integrates tightly with the **Windows tray**: 16×16 procedurally-drawn icon with idle-green / record-red state, overlay badge while capturing, dynamic title `● 0:42` (Windows 10+), multi-line tooltip showing elapsed time + folder + last save, a right-click menu with Show/Hide, Always-on-top toggle, Open save folder, Recent saves submenu (last 5), Settings…, Quit. **Single-instance lock** so a second launch focuses the existing window.

Filename template is fully user-editable with token chips: `{date} {time} {year} {month} {day} {hour} {minute} {second} {unix} {mode} {device} {counter}` substituted at save time, OS-illegal chars stripped.

Hotkey: `Shift+Alt+R` by default, re-bindable.

---

## 2. File-by-file map

```
recordr/
├── package.json                              # deps + npm scripts (dev, build, typecheck, package, start)
├── tsconfig.json                             # base TS config
├── tsconfig.main.json                        # TS config for main + preload + shared (CommonJS, no DOM)
├── vite.config.ts                            # Vite for renderer (ESM, chrome120 target)
├── electron-builder.yml                      # (none — config is in package.json's "build" key)
├── scripts/
│   └── build-loopback-helper.sh              # rebuilds the WASAPI .exe via dotnet publish
├── native/RecordrLoopback/                   # WASAPI helper source (C#)
│   ├── RecordrLoopback.csproj                # net8.0, framework-dependent (executable)
│   └── Program.cs                            # spawn-friendly: `list` / `capture <deviceId> <sampleRate>`
├── loopback-build/                           # BUILT WASAPI helper (committed, ~700 KB)
│   ├── recordr-loopback.exe                  # .NET 8 apphost
│   ├── recordr-loopback.dll
│   ├── recordr-loopback.runtimeconfig.json
│   ├── recordr-loopback.deps.json
│   └── NAudio.{Core,Wasapi,Asio,Midi,WinMM}.dll
├── src/
│   ├── shared/                               # used by both processes
│   │   ├── types.ts                          # IpcChannel enum, AppSettings, CaptureSource, LoopbackDevice, SaveResult, FILENAME_TOKENS, DEFAULT_SETTINGS, AppEvent
│   │   └── utils.ts                          # tiny helpers
│   ├── main/                                 # Electron main process (Node)
│   │   ├── index.ts                          # BrowserWindow lifecycle, single-instance lock, hotkey wiring, tray init, IPC handler registration
│   │   ├── ipc.ts                            # ipcMain.handle for settings / sources / folder / saveRecording / loopbackList / loopbackStart / loopbackStop / windowSetAlwaysOnTop / traySetCapturing
│   │   ├── settings.ts                       # JSON-backed settings file at app.getPath('userData')/recordr-settings.json
│   │   ├── hotkeys.ts                        # globalShortcut registration with accel parsing
│   │   ├── save.ts                           # saveWebm(): formatFileName() with all token substitutions + sanitisation, then write the buffer via fs.writeFile
│   │   ├── tray.ts                           # 16x16 procedural icon, dynamic menu/title/tooltip/overlay-badge, recent-saves ring buffer
│   │   ├── window-controls.ts                # snapWindow() / applyMagneticSnap() / applyLayout() / tempExpand() — everything that moves or resizes the main window
│   │   ├── popout.ts                         # second frameless always-on-top window at index.html#popout; createPopout / destroyPopout / applyPopoutSettings
│   │   └── wasapi.ts                         # resolves helper path (dev + packaged locations), spawns helper for `list` / `capture`, parses Float32LE PCM frames, broadcasts to the renderer over IPC
│   ├── preload/
│   │   └── index.ts                          # contextBridge.exposeInMainWorld('api', api) with typed methods + platform field
│   └── renderer/                             # React UI (browser context)
│       ├── index.html                        # CSP, viewport, #root mount
│       ├── main.tsx                          # routes on location.hash: <PopoutApp /> for #popout, <App /> otherwise
│       ├── App.tsx                           # orchestrator: hooks -> TitleBar/HUD/Board/Sidebar/Settings/Toast. `theme-${settings.theme}` class drives the palette
│       ├── PopoutApp.tsx                     # pop-out window: draws from streamed viz:frame data, sends viz:command back. Owns no capture
│       ├── global.d.ts                       # window.api typing for the preload bridge
│       ├── styles.css                        # ~1620 lines: six theme blocks, HUD grid, board canvas wrap, modal, chips, viz-buttons, footer, title bar, layout variants, the compact/responsive breakpoints, .loading fallback
│       ├── components/
│       │   ├── TitleBar.tsx                  # our own 26px frameless strip: pin / dock / layout-cycle / pop-out / settings + min-max-close
│       │   ├── HUD.tsx                       # top bar
│       │   ├── Transport.tsx                 # start-stop + save pair, shared by the HUD and the pop-out; honours settings.labelMode
│       │   ├── VisualizerBoard.tsx           # canvas wrapper; ResizeObserver-sized backing store; renders <Visualizer> from lib/visualizer.ts
│       │   ├── SourcePicker.tsx              # backend-aware custom dropdown (.dd-trigger + .dd-popover, no native <select>)
│       │   ├── SettingsPanel.tsx             # modal w/ all settings sections (capture backend, theme, buffer, hotkey, folder, always-on-top, layout/title-bar/labels, visibility toggles, pop-out, file-name template + token chips)
│       │   └── ToastStack.tsx                # last 3 toasts, 4s auto-dismiss
│       ├── hooks/
│       │   ├── useSettings.ts                # getSettings → state; update = setSettings patch
│       │   ├── useCapture.ts                 # branches on captureBackend (desktop | loopback); binds MediaStream + AudioContext + AnalyserNode + RecorderHandle
│       │   └── useRecorderEvents.ts          # subscribes to window.api.onRecorderEvent; surfaces cold-toast array
│       └── lib/
│           ├── audio-capture.ts              # listSources() (via desktopCapturer IPC) + pickSourceAndCapture(sourceId) using navigator.mediaDevices.getUserMedia({audio:{mandatory:{chromeMediaSource:'desktop', chromeMediaSourceId}}})
│           ├── loopback-capture.ts           # startLoopbackStream(deviceId): subscribes to loopbackSamples IPC, pumps PCM bytes into an AudioWorkletProcessor (inlined as Blob) → MediaStreamDestination for downstream MediaRecorder
│           ├── recorder.ts                   # MediaRecorder + a rolling ring buffer + snapshotBuffer() that returns a Blob covering the last N seconds
│           ├── ring-buffer.ts                # util: fixed-size chunks for the rolling buffer
│           └── visualizer.ts                 # AudioAnalyser class that owns a canvas, draws oscilloscope / spectrum / spectrogram with both modern and classic themes (adapted from user's HTML reference file)
├── .sdk-bootstrap/                           # .NET 8 SDK ~430 MB (one-time install, can be deleted; rebuilt via scripts/build-loopback-helper.sh)
└── .gitignore                                # node_modules, dist, release, .sdk-bootstrap
```

### Release dir (post-package)

```
release/
├── Recordr Setup <version>.exe                # NSIS installer, ~74 MB — this is the release asset
└── win-unpacked/
├── Recordr.exe                                # 177 MB Electron 30 binary
├── chrome_*.pak, *.dll, icudtl.dat, locale/   # Chromium runtime (82 files, ~168 MB)
└── resources/
    ├── app.asar                               # 702 KB · our main + preload + renderer code  (paths: /dist/main/index.js etc.)
    └── loopback-build/                        # 700 KB WASAPI helper, copied via build.extraResources in package.json
```

`npx electron-builder --win nsis` produces both of these and **works on this dev box** — the `winCodeSign` symlink wall documented under Bug #3 no longer reproduces. `release/` is gitignored, so it won't exist on a fresh clone until you build.

---

## 3. Session history (chronological)

In order, what was actually built this session. Each step has a one-line summary; the file paths and line counts are the source of truth.

### Phase 1 — skeletal Electron app

* `git_status` shows the repo was uncommitted mid-scaffolding of an unrelated 3D pacman app — that's not ours. We worked under a fresh recordr project the user asked for.
* Lifted the visualizer JS out of the user's `Audio Oscilloscope & Spectrum Analyzer.html` reference.
* Built the rolling-ring-buffer + MediaRecorder pipeline so the "Rolling Sampler" mode works.
* Wrote 25 source files (~1100 LOC) for the initial Electron 3-process layout.
* Bumped C: to **out-of-space** mid-install; user gave the green light to "go i clear 3 gb" — installed 420 packages and built clean.
* Wrote README.

### Phase 2 — dev verification

* `npm run dev` boots clean (only a harmless Chromium-DevTools `Autofill.enable` warning).
* Renderer serves on `127.0.0.1:5173`, IPC handshake works, settings file written to userData.

### Phase 3 — WASAPI loopback (user's specific request)

User asked: **"Add a 'loopback device' picker that bypasses desktopCapturer for true per-speaker capture (uses nAudio via a small add-on)."**

* Tried `naudiodon2` — needs native compilation. No VS Build Tools on this box.
* Tried `@ffmpeg-installer/ffmpeg` — its bundled binary lacks WASAPI support.
* Found `dotnet 8` (already installed: 8.0.13), and a separate `c:\ffmpeg` BtbN build with full WASAPI.
* Cleanest path: write a tiny **C# .NET 8 console app using NAudio**, publish framework-dependent, ship the apphost + NAudio DLLs as an `extraResource`.
* Spin-up of **one-time `dotnet-install.ps1`** (~430 MB to `.sdk-bootstrap/`).
* Two real bugs hit:

  1. `new WaveFormat(48000, 32, 2)` returned integer PCM, not float. **Fix:** `WaveFormat.CreateIeeeFloatWaveFormat(48000, 2)`.
  2. Stdin-EOF keep-alive exited immediately on `/dev/null`. **Fix:** use `ManualResetEventSlim` blocking, with stdin EOF / SIGTERM / ProcessExit converging.
* Verified end-to-end: helper captured **1.76 MB** of Float32 samples during a 4-second 440 Hz sine playback test; first samples `0.389, 0.389, 0.394, 0.394` matched `Amplitude = 0.4`.

* Wired backend into the app: `src/main/wasapi.ts`, `IpcChannel.loopbackList/Start/Stop/Samples/Event`, preload + useCapture dual-backend branch, settings capture-backend radio, SourcePicker backend-aware dropdown.
* **`scripts/build-loopback-helper.sh`** for rebuild-on-demand.
* `loopback-build/` is **committed** so first-clone users don't need to re-install the SDK.

### Phase 4 — tray icon + filename template (+ user-requested additions)

User asked: **"Add 'always on top' toggle and assign them to the recordr app icon, plus file-name template editing."**

* Procedurally-drawn 16×16 tray icon (no PNG asset to ship) — center dot green when idle, red when recording; cyan halo.
* Window/taskbar icon at 32×32 from the same builder.
* Right-click menu: Show/Hide, Always-on-top toggle (persisted to settings), Settings… (sends `window:open-settings` IPC), Quit.
* Single-instance lock so a 2nd launch focuses the existing window.
* AppSettings extended: `alwaysOnTop: boolean`, `fileNameTemplate: string`.
* Settings modal got a **Window section** + **File-name template section** with clickable token chips (`{date} {time} {year} {month} {day} {hour} {minute} {second} {unix} {mode} {device} {counter}`).
* `save.ts`'s `formatFileName()` substitutes tokens, sanitises illegal filesystem chars (`/\:*?"<>|`), collapses underscore runs, falls back to `recordr_{date}_{time}.webm`, appends `.webm` if missing.
* `{device}` resolves to the loopback-device name OR `desktopCapturer` source name. `{counter}` increments monotonically.

### Phase 5 — tray capture-feedback

User asked: **"Implement a 'now playing' status note on the tray icon when capturing (e.g., last save's filename as a tiny tag)."**

* Tray title `● 0:42` next to the icon (Windows 10+ only), updated every 1 s by a `setInterval` running entirely in main.
* Multi-line tooltip `● Recording 0:42\nFolder: …\nLast save: …` with the "Last save" line auto-fading after 30 s.
* **Overlay badge** (Windows): small red `•` in top-right of the tray icon while capturing — visible without hovering.
* **Tray balloon** (Windows): pops after each successful save.
* **Recent saves** submenu: last 5, click → `shell.showItemInFolder`.
* **Open save folder** menu item, conditional on `settings.saveFolder` being set.
* Renderer pushes capture-state via `window.api.setTrayCapturing` whenever `capturing` changes (`useEffect`).
* IPC `saveRecording` returns `{ ok, path, bytes, fileName }` so the toast in renderer can show the actual filename.

### Phase 6 — packaging attempt + known-failure workaround

User asked: **"buuild tteh electron"**

* electron-builder in standard mode ran into the `winCodeSign` symlink-privilege wall (`libcrypto.dylib`, `libssl.dylib` are macOS symlinks; 7-Zip needs admin to recreate them on Windows).
* Workaround: build in `--dir` mode and ignore the final error (the unpacked output is complete and runs).
* Added `build.extraResources: ["loopback-build/**"]` so the WASAPI helper ships in `resources/loopback-build/` next to `app.asar`.
* Verified `Recordr.exe` launches (3–4 Electron procs, ~280 MB combined RSS).

### Phase 7 — blank-UI debugging (current, incomplete)

User asked: **"it launches but the UI is completely blank lol"**

* Found `app.asar` path bug — re-pack was placing files at `/main/...` instead of `/dist/main/...`. Fixed by packing from a parent dir containing `dist/` so the asar preserves the layout.
* Launched packaged exe with `RECORDR_DEBUG=1` to enable a console-message forwarder + `did-fail-load`/`preload-error`/`render-process-gone` listeners.
* Got the smoking gun:

  ```
  [17504:0815/...:ERROR:bad_message.cc(29)] Terminating renderer for bad IPC message, reason 263
  [rend:gone] reason=crashed ec=3
  ```
* Identified but **did not fix** two issues from the user's report (this is where we handed off to write this doc):

  1. **Pressing Start makes UX go blank.**
  2. **Dropdown menu has white text on white background** (likely `<select>` with `color: white; background: white` somewhere — probably the OS-default unstyled `<option>` overrides our chip styling).

---

### Phase 8 — interface overhaul: minimal chrome, layouts, pop-out visualizer

User asked: **"Make the floor/minimum UI size even smaller and thinner. Let me snap the window to the top of my monitor. Let me pop the visualizer out, with the record/save buttons inside it. The 'save previous 10 minutes' button and the output-device dropdown take up too much space. Can the app have its own more minimal title bar? And let the user choose how they want to use the UI."**

* **Three layouts**, switchable from the title bar (▤), the tray menu, or Settings → Layout. `LAYOUT_MIN_SIZE` in `src/shared/types.ts` is the single source of truth and main clamps `setMinimumSize` to it on every switch:

  | layout    | floor     | contents                                          |
  |-----------|-----------|---------------------------------------------------|
  | `full`    | 240×190   | title bar + HUD + visualizer + footer (as before) |
  | `compact` | 200×120   | one control row + visualizer, icon-only picker    |
  | `bar`     | 180×34    | a single strip — transport, meter, device. No board |

  Entering `bar` snaps the window to 38px tall and restores the old height on the way out (`applyLayout` in `src/main/window-controls.ts`).
* **Custom title bar** (`src/renderer/components/TitleBar.tsx`), 26px vs the OS bar's ~32, `frame: false`. Carries pin / dock-to-top / layout-cycle / pop-out / settings plus minimise-maximise-close. `settings.titleBarMode` switches back to the OS bar; Electron can't change a frame in place so main rebuilds the window at the same bounds (`recreateWindow`).
* **Snapping.** `snapWindow()` parks the window against any edge of the display it's currently on, using the *work area* so it never lands under the taskbar. `top` spans the full width at the current height — that plus `bar` layout is the strip-across-the-monitor case. Magnetic snap (`settings.magneticSnap`) does the same when the window is dropped within 14px of an edge.
* **Pop-out visualizer** (`src/main/popout.ts`, `src/renderer/PopoutApp.tsx`). A second frameless always-on-top window at `index.html#popout`. It owns **no capture** — the WASAPI helper is single-instance and a second desktopCapturer stream would double the cost — so the main renderer streams analyser frames over IPC at 30fps (`viz:frame`) and the pop-out sends transport commands back (`viz:command`). Its own start/stop/save/mode buttons fade in over the waveform on hover. Opacity, always-on-top and whether the main window still draws its own board are all settings.
* **Space reclaimed.** The save button no longer has `flex-grow: 1` (that's what made "Save last 10 min" a banner across the HUD); `.picker-select-wrap` is capped at 460px; the source picker drops its label and helper line in compact layouts and shows a speaker glyph instead; new breakpoints at 360px and 260px wide, and 240px tall, take the transport down to bare glyphs.
* **`settings.labelMode`** pins labels to auto / icons-only / always-text rather than leaving it to the breakpoints.
* **Visibility toggles** for the VU meter, buffer bar, source picker, viz chips and hotkey hint (Settings → Show in the interface).
* Settings written anywhere now broadcast to every window (`settings:changed`), so the tray, the pop-out and the main window can't drift apart.
* A 38px window can't host a popover or a modal, so the device dropdown and the settings panel temporarily grow the window (`tempExpand`) and snap it back on close.

---

## 4. Known bugs / open issues

### ✅ Bug #1 — Renderer crashes on Start (the "blank UI" core culprit) — FIXED

Root cause was the third of the three suspects: `getUserMedia` with
`chromeMediaSource: 'desktop'` naming a source that cannot produce audio.
Chromium doesn't reject the promise in that case — it terminates the whole
renderer process with `bad_message.cc reason 263` (`MSDH_INVALID_STREAM_TYPE`),
and there is no recovering once the call is made. Two inputs trigger it on
Windows: a **window** source (only screens carry the loopback audio mixer) and
a **stale id** (a screen unplugged since we enumerated).

The fix is a pre-flight guard in `bindDesktop()`
(`src/renderer/hooks/useCapture.ts`): reject anything that isn't `screen:*`
with a UI error, then re-enumerate and confirm the id is still live, and only
then call `getUserMedia`. Both rejections surface as an ordinary `hud-error`
line instead of taking the window down.

**Verified 2026-08-16** by launching the packaged renderer with
`RECORDR_DEBUG=1` against an isolated `--user-data-dir`, on three configs:

| config | result |
|---|---|
| `desktop` + `screen:0:0` | binds, `[capture] signal detected, rms=0.0061` |
| `desktop` + `window:99999999:0` | guard rejects, renderer alive |
| `loopback` + real device id | binds, renderer alive |

No `bad_message` on any path. (The `[rend:gone] ec=143` in those logs is the
test harness's own SIGTERM — 128+15 — not a crash. The original signature was
`ec=3`.)

### ✅ Bug #2 — Dropdown white text on white background — FIXED

`<option>` is OS-rendered and ignores CSS, so the `<select>` was replaced
outright with an in-DOM button + popover listbox (`.dd-trigger` / `.dd-popover`
in `SourcePicker.tsx`). Full colour control, per-theme styling, and it opens
upward out of the footer. `color-scheme: dark` is also set on `:root` for the
native `<select>`s that remain in the settings modal.

<details><summary>Original report</summary>

* **Symptom:** `<select>` inside `SourcePicker` shows options with white text and white background (essentially unreadable).
* **Likely cause:** `<option>` elements ignore CSS color/background in Chromium and inherit from the OS. Our `<select>` background isn't styled separately for the open dropdown, and the `option` text picks up the page's `color: white`. Need explicit `background: #0d1430` (or whatever the dark theme panel bg is) on `<select>` and the dropdown should also pick up a dark theme in modern browsers — but `<option>` is OS-rendered so we either need `appearance: none` + custom dropdown or to set `color-scheme: dark` on the document so OS menus follow.
* **Where to look:** `src/renderer/components/SourcePicker.tsx`, `src/renderer/styles.css`.
</details>

### ✅ Bug #3 — `winCodeSign` symlink wall on packaging — NO LONGER REPRODUCES

`npx electron-builder --win nsis` now runs clean on this box and emits
`release/Recordr Setup <version>.exe`. The `ERROR_PRIVILEGE_NOT_HELD` (1314)
failure the earlier phases hit came from extracting the `winCodeSign-*.7z`
cache, and the cache under `%LOCALAPPDATA%\electron-builder\Cache` is now
populated, so the extraction step is skipped entirely.

If it ever comes back on a clean machine: enable Developer Mode (or
`fsutil behavior set symlinkevaluation l1`, admin), or fall back to
`npm run package:dir` and zip `release/win-unpacked/`.

**One real gotcha remains:** a running `Recordr.exe` holds a lock on
`release/win-unpacked/`, and electron-builder then dies with "Access is
denied" trying to delete `chrome_100_percent.pak`. Close the app before
packaging.

### ✅ Bug #4 — `.chip` focus/active states — NOT AFFECTED

Chips are ordinary `<button>`s, not OS-rendered controls, so they never had the
`<option>` problem. Verified across all six themes.

### 🟡 Bug #5 — Single-instance lock: error 32 on Lock file

* `process_singleton_win.cc(464)` reports `Lock file can not be created! Error code: 32` on second launch — but the second-instance focus logic still fires correctly. Cosmetic; not breaking. **This is the only bug in this section still open.**

### ✅ Bug #6 — Spectrogram displayed nothing — FIXED

`drawSpectrogram` scrolled the *visible* canvas with
`getImageData`/`putImageData` every frame: a GPU→CPU readback per frame that
stalled the render loop, and one that any repaint wiped — a resize, a theme
change, a mode round-trip. It now keeps history in an offscreen buffer
(`spectroBuffers`, keyed off the destination context so the main window and the
pop-out each get their own), scrolls it with a self `drawImage` under
`globalCompositeOperation = 'copy'`, and blits the result. Frequency is mapped
logarithmically now too — the linear map buried everything musical in the
bottom eighth of the image.

---

## 5. How to run / build

### Install

```bash
cd C:/Users/Serge/Documents/GitHub/recordr
npm install --no-audit --no-fund
```

420 packages (~200 MB; takes 30–60 s; needs ~500 MB free on C:).

### Verify it builds

```bash
npm run typecheck     # tsc -p tsconfig.main.json + tsc -p tsconfig.renderer.json
npm run build         # vite build for renderer + tsc for main/preload
```

Both should print `✓` and emit `dist/main/*.js`, `dist/preload/index.js`, `dist/renderer/index.html`.

### Dev (live HMR)

```bash
npm run dev
```

Launches Vite (5173) + Electron with the renderer loading from `http://127.0.0.1:5173` (HMR enabled, DevTools opens automatically).

### Package for distribution

```bash
npm run package       # electron-builder --win portable + nsis
```

```bash
npm run package:dir   # electron-builder --dir — unpacked output, no installer
```

* This works on this box now (see Bug #3). `npx electron-builder --win nsis` is the exact command used to cut the releases; it emits `release/Recordr Setup <version>.exe`.
* **Close Recordr first.** A running instance locks `release/win-unpacked/` and electron-builder fails with "Access is denied" on `chrome_100_percent.pak`.
* If `winCodeSign` extraction ever does fail on another machine, use `npm run package:dir`; the `release/win-unpacked/` output is complete and runs even if the final step errors. Just zip that up.
* If a clean rebuild is needed with no symlinks, see "Manual repack" below.

### Cut a GitHub release

```bash
npm run build
npx electron-builder --win nsis
gh release create v<version> "release/Recordr Setup <version>.exe" \
  --repo Chimthuwu/recordr --title "Recordr v<version>" --notes-file <notes> --latest
```

### Manual repack (after `npm run build`)

If you don't want to re-run electron-builder (and get the winCodeSign error):

```bash
# Build all artifacts
npm run build

# Repack app.asar with correct /dist/... paths
mkdir -p /tmp/bundle
rm -rf /tmp/bundle/*
cp -r dist /tmp/bundle/dist
cp package.json /tmp/bundle/package.json
node_modules/.bin/asar pack /tmp/bundle release/win-unpacked/resources/app.asar

# (loopback-build/ stays as-is; it's an extraResources sibling of app.asar)
```

### Rebuild WASAPI helper (only if Program.cs changes)

```bash
bash scripts/build-loopback-helper.sh
# OR manually
cd native/RecordrLoopback
dotnet publish -c Release -r win-x64 --no-self-contained -o ../../loopback-build
```

Needs .NET 8 SDK at `~/.sdk-bootstrap/sdk/8.0.X/` (one-time install in `~/.sdk-bootstrap/`).

### Debug packaged build

```bash
set RECORDR_DEBUG=1
"C:\Users\Serge\Documents\GitHub\recordr\release\win-unpacked\Recordr.exe" --enable-logging=stderr 2>&1 | tee C:\temp\recordr.log
```

(`RECORDR_DEBUG=1` enables a `console-message` forwarder and lifecycle listeners in `src/main/index.ts` — added this session.)

---

## 6. Settings file

Lives at `%APPDATA%\Recordr\recordr-settings.json`. `DEFAULT_SETTINGS` in
`src/shared/types.ts` is the source of truth; `readSettings()` spreads the file
over the defaults, so a file written by an older build just picks up the new
keys.

```json
{
  "hotkey": "Shift+Alt+R",
  "saveFolder": "",
  "captureBackend": "desktop",
  "sourceId": null,
  "loopbackDeviceId": null,
  "recordMode": "rolling",
  "theme": "modern",
  "visualizer": "oscilloscope",
  "bufferSeconds": 900,
  "bitrateKbps": 96,
  "alwaysOnTop": false,
  "fileNameTemplate": "recordr_{date}_{time}",

  "uiLayout": "full",
  "titleBarMode": "custom",
  "labelMode": "auto",
  "showVu": true,
  "showBuffer": true,
  "showSourcePicker": true,
  "showVizChips": true,
  "showHint": true,
  "magneticSnap": true,
  "popoutOpen": false,
  "popoutAlwaysOnTop": true,
  "popoutOpacity": 1,
  "popoutControls": true,
  "hideBoardWhenPopped": false
}
```

> ⚠️ **Never hand-edit this file from PowerShell.** `readSettings()` wraps the
> whole read in a bare `try/catch` that falls back to `DEFAULT_SETTINGS` on any
> parse failure — **silently**, with no log line. PS 5.1's `Out-File -Encoding
> utf8` and `Set-Content` both emit a **UTF-8 BOM**, `JSON.parse` chokes on it,
> and the user's saveFolder / backend / device / buffer all quietly revert to
> defaults on next launch. This has actually happened. Use Node
> (`fs.writeFileSync`, which writes no BOM) or just change it in the app's
> Settings modal. Making `readSettings()` strip a leading `﻿` and log the
> failure would be a cheap, worthwhile hardening.

Other paths:

* `%APPDATA%\Recordr\DevToolsActivePort` — what DevTools port the last instance bound (used for `--remote-debugging-port` queries).
* `%APPDATA%\Recordr\Cache\Code Cache\...` — Chromium's V8 caches for fast warm-start.

---

## 7. What to do next

**Everything originally on this list is now done.** For the record:
Bug #1 (Start → blank), Bug #2 (dropdown white-on-white), Bug #3 (packaging),
Bug #4 (chips), Bug #6 (spectrogram), item 4 (always-live visualizer), item 5
(compact UI — since superseded by the layout system in Phase 8), item 6 (tray
polish: pop-out toggle, layout radio group and dock-to-top are all in the menu
now).

Still open, in rough priority order:

1. **The scrubbable waveform + drag-to-export.** (user-requested, not started —
   the largest remaining piece.) See §9 for the sketch: a decoded peak track in
   a parallel ring buffer, drawn as an overview of the last N minutes, with
   range selection and `webContents.startDrag()` export.
2. **A browser version.** (user-requested, not started.) See §9 — feasible for
   the desktopCapturer path only.
3. **Bug #5** — the cosmetic single-instance lock-file warning. Low value.
4. **Harden `readSettings()`** against a BOM / malformed file: strip a leading
   `﻿`, and log rather than silently reverting to defaults (see §6).
5. **Mic capture via WASAPI?** Optional; user asked for output-side only so
   don't introduce unless they ask.
6. **Optional: nice-to-have quality-of-life.** A "preview" capture-before-record,
   a button to rename template tokens on the fly, an in-app audio meter that
   expands the HUD on click. **Not yet asked.**

<details><summary>Original wording of the completed items 4 &amp; 5 (kept for context)</summary>

4. **Visualizer should be live at all times, not only while recording.** (user-requested)

   * Right now the canvas only animates once a capture session is bound — outside of that it just shows the `Pick a source and press Start` placeholder. It should be running/monitoring continuously so the user can see the signal before ever hitting record.
   * Implies decoupling "monitoring" (AudioContext + AnalyserNode tapping the selected source) from "recording" (MediaRecorder / rolling buffer). Bind the analyser as soon as a source is picked; start/stop only gates the recorder.
   * **Where to look:** `src/renderer/hooks/useCapture.ts` (the effect cascade that binds stream → AudioContext → AnalyserNode), `src/renderer/components/VisualizerBoard.tsx`, `src/renderer/lib/visualizer.ts`.
   * **Recording indicator:** since the visualizer is always on, recording state needs its own visual cue — make the visualizer element's **border glow neon green, or a nice neon gradient**, while capturing. **Explicitly not red** — the user dislikes the red-border look. Consider an animated `box-shadow` / `border-image` gradient pulse in `styles.css`.

5. **Compact / responsive UI — must survive small window sizes.** (user-requested)

   * Current floor is roughly **790×555** (see the user's screenshot) and at that size the layout already breaks: the buffer bar and `Save last 20 min` button run off the right edge, the visualizer canvas is clipped horizontally, and the viz-mode chip row (`oscilloscope / spectrum / spectrogram`) is cut off past the window edge.
   * Goal: the app should shrink much further and stay fully usable — nothing clipped, no horizontal overflow.
   * On shrink, **the buttons and the main waveform/visualizer must scale themselves down to stay fully visible**, not just get cropped. Ideas: container queries or `min-width: 0` on the flex/grid children, `flex-wrap` on the HUD + chip rows, canvas sized from its wrapper's `ResizeObserver` rather than a fixed width, smaller icon-only button variants below a breakpoint, and collapsing the `OUTPUT DEVICE` label/helper text at narrow widths.
   * Also revisit the BrowserWindow `minWidth` / `minHeight` in `src/main/index.ts` once the layout can actually go smaller.
   * **Where to look:** `src/renderer/styles.css` (HUD grid, board canvas wrap, footer, viz-buttons), `src/renderer/components/HUD.tsx`, `src/renderer/components/VisualizerBoard.tsx`, `src/renderer/components/SourcePicker.tsx`.

</details>

---

## 8. Reference files (important landmarks)

* **Visualizer source of truth:** `src/renderer/lib/visualizer.ts` — adapted from `C:\Users\Serge\Desktop\Audio Oscilloscope & Spectrum Analyzer.html`. Don't lose the magColor() palette switcher; both themes need it.
* **Renderer's "what's currently being recorded" model:** `src/renderer/hooks/useCapture.ts` — branches on `settings.captureBackend`. The render-loop bug is somewhere in the `useEffect` cascade here.
* **Filename substitution:** `src/main/save.ts` → `formatFileName()`. Tokens defined as `FILENAME_TOKENS` in `src/shared/types.ts`.
* **Tray state machine:** `src/main/tray.ts`. ~370 lines. Has `isCapturing`, `captureStartedAt`, `recentSaves[]`, `lastSaveFlashUntil` — be careful when extending.
* **Single-instance, hotkey, IPC registration sequence:** `src/main/index.ts`.
* **Layout floors:** `LAYOUT_MIN_SIZE` in `src/shared/types.ts` is the single source of truth; `src/main/window-controls.ts` clamps the window to it on every layout switch. Don't hard-code a `minWidth` anywhere else.
* **Why the pop-out has no capture of its own:** `src/main/popout.ts` + `src/renderer/PopoutApp.tsx`. The WASAPI helper is single-instance and a second desktopCapturer stream would double the cost, so the main renderer streams analyser frames over `viz:frame` at 30fps and the pop-out sends `viz:command` back. Don't "simplify" this by binding a stream in the pop-out.
* **Theme class:** `App.tsx` builds it as `` `theme-${settings.theme}` ``. A binary ternary here once made four of the six themes silently unreachable — every theme needs its own `.app.theme-*` block in `styles.css`.

---

## 9. Free-form notes

* This is an 8-phase build and the app now ships. Phase 7's two bugs (Start → blank, dropdown white-on-white) turned out **not** to share a root cause: the first was Chromium killing the renderer over a `getUserMedia` source that can't carry audio, the second was `<option>` being OS-rendered. Both are fixed; see §4.
* The user has a real DAW setup (Bitwig, SphereEx Hydra, FL Studio, VCV Rack are listed in package.json's allow-list of windows). Don't change capture-backend semantics without letting them verify their actual recording pipeline.
* Disk on C: is currently sitting at ~94% used. Don't run `npm install` again without first deleting `.sdk-bootstrap/` (~430 MB) and any leftover `node_modules` from sibling projects if you're switching contexts. Run `df -h /c` periodically.
* If you (the next agent) need to verify exact internal behavior: `set RECORDR_DEBUG=1` was added in this session, stays in the source. Just set it before launching the packaged exe.

- make webapp version that can be run out of browser.
  * Feasible for the desktopCapturer path only — `getDisplayMedia({audio:true})`
    gives system audio in Chrome/Edge on Windows. WASAPI per-device capture and
    the global hotkey are desktop-only, and File System Access API replaces the
    save-folder picker. The renderer is already isolated behind `window.api`, so
    the port is mostly writing a browser-backed implementation of that object.
- ~~spectrogram doesnt work, nothing displays~~ — **fixed**, see Bug #6 above.
- i want like a live waveform display aswell that shows the current like audio thats in the span of time "save last xxx"
  Users can then select parts of this waveform and then drag aand drop it (same as Rolling Sampler by Bird things does)
  * **This is the big one and it isn't started.** Sketch: `ring-buffer.ts` already
    holds the last N minutes as encoded chunks, but a scrubbable overview needs a
    *decoded* peak track — accumulate min/max pairs per ~20ms bucket off the
    existing AnalyserNode into a parallel ring buffer, draw that as the overview,
    and let a drag select a time range. Export = re-encode just that range, then
    `webContents.startDrag({ file, icon })` in main to hand the file to Explorer /
    a DAW. Needs a new IPC channel and a temp-file strategy for the dragged clip.
