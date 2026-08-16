# Recordr — Project Handoff

> **Last updated:** 2026-08-16 (Phase 9 — v2.0.0)
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
│   │   ├── window-controls.ts                # snapWindow() / handleWindowMoved() / applyLayout() / tempExpand() — everything that moves or resizes a window
│   │   ├── appbar.ts                         # Windows appbar registration (shell32!SHAppBarMessage via koffi) so a docked strip reserves desktop space. READ THE WARNING IN §11 FIRST
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

### Phase 9 — pop-out as a real mode, reclaimed vertical space, spectrogram rebuild

User report: *"when we pop out the visualizer the previous one kinda remains… we shouldn't have two windows open"*, *"we can't actually snap the monitor window to the top"*, *"when we snap [the main window] to the top and make it the smallest possible size we can't even really see the visualizer… the only thing we can really see is output device"*, *"perhaps instead of having the output device selection on the front-facing UI we could have it behind a right-click dropdown"*, and **"CRITICAL: I think the spectrogram is broken, it looks funny."**

* **Popping out now swaps windows instead of adding one.** New `settings.hideMainWhenPopped` (default **on**): the main window hides while the pop-out is up and returns when it closes. It's *hidden*, never closed — it still owns the capture, the rolling buffer and the 30fps frame pump the pop-out draws from. The policy lives in `applyPopoutWindowSwap()` (`src/main/index.ts`) and fires on **transitions** of `popoutOpen` only, so changing a setting while popped out can't yank back a window the user deliberately restored from the tray. `popoutToggle` in `ipc.ts` now routes through `onSettingsChanged` instead of writing quietly, which is what makes every entry point (title bar, tray, the pop-out's own ✕) agree.
* **The pop-out can be docked.** It gained a `⤒` button and magnetic edge snap on `moved`. `windowSnap` already routed to `BrowserWindow.fromWebContents(e.sender)`, so the plumbing existed — the monitor window simply had no UI to reach it. Verified: dock click took it from `600,300 525x240` to `0,0 1921x241`.
* **Short windows give their height to the waveform.** A window docked across the top of a monitor is the worst case, because it is *wide* — none of the width breakpoints fire, so the HUD kept its full stacked-row height and the board collapsed to a sliver. Below 460px tall the HUD is now a single flex row (a full-width row holding two right-aligned buttons was almost entirely empty space); below 340px the buffer bar, mode label and picker label go and the transport tightens; below 260px the footer strip goes entirely and the right-click menu carries the device and mode. At 1900×215 the board went from a ~10px line to ~130px.
* **Right-click quick menu** (`IpcChannel.contextMenu`, built in `ipc.ts`): capture source / output device, capture backend, visualizer mode, rolling buffer, always-on-top, pop-out, dock-to-top, layout, and Settings. Built as a **native** Electron menu on purpose — `bar` layout is a 38px window and anything the renderer draws is clipped at the window edge, so an in-DOM menu could not work there. With this in place `showSourcePicker` now defaults to **off**.
* **Spectrogram rebuilt.** See Bug #7 below — it had four compounding defects, not one.

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

* `process_singleton_win.cc(464)` reports `Lock file can not be created! Error code: 32` on second launch — but the second-instance focus logic still fires correctly. Cosmetic; not breaking. Open, but the lowest-value thing here — Bug #8 is the one that matters.

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

### ✅ Bug #7 — Spectrogram rendered as smeared blocks — FIXED

Bug #6 got it *drawing*; it was still drawing wrong. Four separate defects,
each of which alone would have looked "funny":

1. **Thick horizontal banding across the bottom.** The row→bin lookup was a
   bare `round(exp(...))`. With a 1024-bin FFT the bottom ~30% of the image
   spans bins 1–8, so dozens of consecutive rows resolved to the *same* bin and
   painted the same flat colour.
2. **Flickering vertical streaks at the top.** At the high end each row
   advanced 40+ bins, and one sampled bin stood in for all of them — any peak
   between two sampled bins vanished, and which bins got sampled shifted frame
   to frame.
3. **Everything out of focus.** The scroll step draws the history canvas onto
   itself. `imageSmoothingEnabled` defaults to *true*, so every frame resampled
   the entire image; after a few seconds it was mush.
4. **A flat cyan wash.** The ramp's floor was `rgb(20,40,80)` — silence was
   already a visible blue — and typical music sits at −60…−30 dB, dead centre
   of the −90…−10 window, so a linear map put nearly the whole picture in one
   mid-tone.

Fixes, all in `src/renderer/lib/visualizer.ts`: a precomputed per-row bin map
(`buildRowMap()`) that **interpolates** where a row is narrower than one bin
and **max-pools** where it is wider, so neither end loses data;
`imageSmoothingEnabled = false` on the history buffer; a `norm²` contrast curve;
and `RAMPS`, a stop-table per theme that starts at that theme's own canvas
background so silence disappears into the panel. Scroll step went from `w/480`
to `w/900` (finer time axis, ~16s of history instead of ~8). Temporal smoothing
is now per mode — `SMOOTHING_FOR_MODE`, applied to the live `AnalyserNode` from
`App.tsx` rather than in the draw loop, because the draw loop is rAF-driven and
stops dead while the main window is hidden behind the pop-out.

**Verified** against a synthetic 80 Hz→12 kHz log sweep + steady 440 Hz tone +
periodic clicks: the sweep renders as a straight diagonal (correct on a log
axis), the tone as a sharp flat line, the clicks as clean vertical transients,
on a black floor.

### ✅ Bug #8 — pop-out's recording border is cut off when docked — FIXED

Fixed as described below: the ring moved from `.popout-board`'s 1px border to a
`.popout::after` overlay (`inset: 0`, `z-index: 5`, 2px) that the controls
overlay cannot cover and a short window cannot squeeze. Colour comes from a new
`--rec` token defined on `.theme-*` — deliberately *not* `.app.theme-*`, because
that never matched the pop-out root, which is why the pop-out rendered every
theme in the default palette. **Verified** by screenshot: docked and recording,
the ring is unbroken on all four sides including beneath the transport.

<details><summary>Original diagnosis</summary>

* **Symptom:** with the pop-out docked to the top of a monitor, the green
  "currently rolling" highlight reads as a clipped sliver instead of a ring
  around the visualizer. (User screenshot, v2.0.0.)
* **Not a clipping bug.** `* { box-sizing: border-box }` is set globally, so the
  1px border sits *inside* the window and nothing is cut off by the window edge.
  Two things make it look like it is:
  1. `.popout-controls` is `position: absolute; bottom: 0` at `opacity: 0.25`
     even when not hovered, and it carries a black gradient. Docked, the pop-out
     is ~100px tall, `.popout-board` gets ~60px of that, and the overlay covers
     most of it — including the bottom border.
  2. The top border sits immediately under the 20px `.popout-drag` strip, so a
     single green pixel there reads as part of the chrome rather than as a state
     indicator.
* **Fix direction:** stop hanging the recording state off `.popout-board`'s 1px
  border. Put it on `.popout` itself as a dedicated pseudo-element ring —
  `position: absolute; inset: 0; pointer-events: none;` with a higher
  `z-index` than `.popout-controls`, ~2px, glow drawn inward — so it is
  independent of the board's height and can't be occluded by the controls
  overlay. The same treatment should be considered for `.board.is-capturing` in
  the main window for consistency.
* **Where to look:** `.popout`, `.popout-board`, `.popout-controls` in
  `src/renderer/styles.css` (~line 1700), `src/renderer/PopoutApp.tsx`.

</details>

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
  "showSourcePicker": false,
  "showVizChips": true,
  "showHint": true,
  "magneticSnap": true,
  "dockReservesSpace": false,
  "popoutOpen": false,
  "popoutAlwaysOnTop": true,
  "popoutOpacity": 1,
  "popoutControls": true,
  "hideBoardWhenPopped": false,
  "hideMainWhenPopped": true
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

**v3 is planned and ordered — see §11.** That section is the working list; the
order in it was set by the user and should be followed:

1. ✅ **Bug #8** — the docked pop-out's clipped recording border. Done.
2. ✅ **Docking reserves screen space** — `SHAppBarMessage` via koffi. Done.
   ⚠️ Read the warning box in §11 before touching `appbar.ts`.
3. **Premium visual redesign** — brief in §10. ← **next**
4. **Historical waveform: scrub, select, drag out** — phased, §11. The user
   asked specifically that this not be attempted in one turn.

Not scheduled, in rough priority order:

* **A browser version.** (user-requested, not started.) See §9 — feasible for
  the desktopCapturer path only. Prerequisite for the Android idea.
* **Harden `readSettings()`** against a BOM / malformed file: strip a leading
  `﻿`, and log rather than silently reverting to defaults (see §6).
* **Bug #5** — the cosmetic single-instance lock-file warning. Low value.
* **Mic capture via WASAPI?** Optional; user asked for output-side only so
  don't introduce unless they ask.
* **An Android version.** Parked; see §9 for why the recording core doesn't
  survive the move.
* **Optional: nice-to-have quality-of-life.** A "preview" capture-before-record,
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

* **Visualizer source of truth:** `src/renderer/lib/visualizer.ts` — adapted from `C:\Users\Serge\Desktop\Audio Oscilloscope & Spectrum Analyzer.html`. Three palette layers, all per theme, all needed: `palette()` (line/bar/grid colours), `drawBackground()` (canvas gradient) and `RAMPS` (the spectrogram's dB→colour table). A spectrogram ramp must start at that theme's own canvas background or silence tints the whole board.
* **Renderer's "what's currently being recorded" model:** `src/renderer/hooks/useCapture.ts` — branches on `settings.captureBackend`. `bindDesktop()`'s pre-flight guard is load-bearing: see Bug #1.
* **Filename substitution:** `src/main/save.ts` → `formatFileName()`. Tokens defined as `FILENAME_TOKENS` in `src/shared/types.ts`.
* **Tray state machine:** `src/main/tray.ts`. ~370 lines. Has `isCapturing`, `captureStartedAt`, `recentSaves[]`, `lastSaveFlashUntil` — be careful when extending.
* **Single-instance, hotkey, IPC registration sequence:** `src/main/index.ts`.
* **Layout floors:** `LAYOUT_MIN_SIZE` in `src/shared/types.ts` is the single source of truth; `src/main/window-controls.ts` clamps the window to it on every layout switch. Don't hard-code a `minWidth` anywhere else.
* **Why the pop-out has no capture of its own:** `src/main/popout.ts` + `src/renderer/PopoutApp.tsx`. The WASAPI helper is single-instance and a second desktopCapturer stream would double the cost, so the main renderer streams analyser frames over `viz:frame` at 30fps and the pop-out sends `viz:command` back. Don't "simplify" this by binding a stream in the pop-out.
* **Theme class:** `App.tsx` builds it as `` `theme-${settings.theme}` ``. A binary ternary here once made four of the six themes silently unreachable — every theme needs its own `.app.theme-*` block in `styles.css`.

---

## 9. Free-form notes

* This is a 9-phase build and the app now ships. Phase 7's two bugs (Start → blank, dropdown white-on-white) turned out **not** to share a root cause: the first was Chromium killing the renderer over a `getUserMedia` source that can't carry audio, the second was `<option>` being OS-rendered. Both are fixed; see §4.
* The user has a real DAW setup (Bitwig, SphereEx Hydra, FL Studio, VCV Rack are listed in package.json's allow-list of windows). Don't change capture-backend semantics without letting them verify their actual recording pipeline.
* Disk on C: is currently sitting at ~94% used. Don't run `npm install` again without first deleting `.sdk-bootstrap/` (~430 MB) and any leftover `node_modules` from sibling projects if you're switching contexts. Run `df -h /c` periodically.
* If you (the next agent) need to verify exact internal behavior: `set RECORDR_DEBUG=1` was added in this session, stays in the source. Just set it before launching the packaged exe.

- make webapp version that can be run out of browser.
  * Feasible for the desktopCapturer path only — `getDisplayMedia({audio:true})`
    gives system audio in Chrome/Edge on Windows. WASAPI per-device capture and
    the global hotkey are desktop-only, and File System Access API replaces the
    save-folder picker. The renderer is already isolated behind `window.api`, so
    the port is mostly writing a browser-backed implementation of that object.
  * Prerequisite for the Android bullet below, if that route is taken.
- android version of this app, later.
  * Not started, not scheduled — parked alongside the webapp port.
  * The recording core does not survive the move. Android has no WASAPI, no
    `desktopCapturer`, and no global hotkey. System-audio capture on Android is
    `AudioPlaybackCapture` (API 29+), which is a *foreground-service* API and is
    opt-out per app: any app that sets `allowAudioPlaybackCapture="false"` or
    marks its session as media-protected simply won't be captured. So "record
    whatever is playing" is best-effort on Android in a way it isn't on Windows.
  * What does port cleanly: the rolling-buffer model, the filename template, the
    settings shape, and the visualizer maths in `lib/visualizer.ts` (it only
    needs a canvas and an FFT).
  * Likely shapes, cheapest first: (1) Capacitor/Tauri wrapper over the webapp
    port once that exists, with a native plugin for `AudioPlaybackCapture` and a
    foreground service for the rolling buffer; (2) a real Kotlin app reusing only
    the visualizer/design language. Option 1 only makes sense if the webapp port
    happens first — treat that as the prerequisite.
  * The pop-out visualizer, the tray, the layout system and the window-snapping
    work are all desktop-only and have no Android analogue; the equivalent there
    is a notification-shade control and a floating bubble/overlay.
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
  * **Deferred by the user to a release after v2.0.0.** Don't start it as a
    side-quest — it wants its own version.

---

## 10. Premium visual redesign — brief

Verbatim intent from the user, condensed into something actionable. **This is a
UI/UX redesign, not permission to rewrite the architecture.** Preserve every
existing behaviour: capture backends, the rolling buffer, device selection, the
pop-out bridge, the layout system, the hotkey.

### The direction

> "Premium futuristic audio workstation meets experimental desktop recording tool."

Professional audio software, oscilloscope/lab instrumentation, modern DAWs,
futuristic monitoring gear, a subtle cyberpunk influence. **Elegant rather than
gamer-y; technical rather than corporate; minimal but atmospheric.** Something
an audio engineer or electronic artist would enjoy looking at for hours.

Explicitly **not**: a generic SaaS dashboard, a gaming HUD, a Discord clone, a
Tailwind component demo, "black background + neon green border everywhere",
random cyberpunk decoration, excessive gradients/glow/rounded cards.

### The single most important problem

The themes currently read as **the same UI with different colours**. That is the
thing to fix. Each theme should change the *atmosphere* — surface treatment,
lighting, accent behaviour, texture — while the interface stays structurally
coherent and every component stays recognisable. Sketches the user gave:

| theme | atmosphere |
|---|---|
| Studio / Dark | quiet professional monitoring gear; very dark charcoal, restrained accent, subtle separators, extremely readable type |
| Cyber / Neon | dark technical instrument panel; more luminous accents, subtle glow, still restrained |
| Moonlight / Midnight | cool nocturnal studio; deep blue-black, soft cyan/lavender, low-contrast ambience |
| Psychedelic / Psyforest | organic and atmospheric; subtle colour transitions, unusual accent treatment, still usable as a tool |
| Retro | old-school digital instrumentation |

### The acceptance test

> **The design must still look good with the accent colour turned off.**

If it only works because of bright colours, the system isn't strong enough. Get
hierarchy → spacing → typography → surfaces → controls right *first*, then add
atmosphere. **Make it feel designed, not decorated.**

### Specific asks

* **Layout.** Wastes vertical space today. Read as: chrome → status/transport →
  *visualization (dominant)* → output+modes strip. Don't blindly copy that; use
  design judgement, but the waveform gets the majority of the real estate.
* **The waveform is the hero.** It's the most interesting thing in the app and
  currently reads as a big empty rectangle containing a thin line. Wants: better
  amplitude scaling, more interesting signal rendering, subtle glow, a real
  oscilloscope grid (major/minor lines at *different* opacities, clear centre
  axis, restrained measurement marks), readable at low signal, no distracting
  animation when there's no signal. **Not** just a thicker line.
* **Status area.** `LIVE` primary, `ROLLING` visibly subordinate, progress as a
  proper recording timeline rather than a stray horizontal bar, elapsed/total
  time in strong numerals aligned to it. A recording console, not a web header.
* **Actions.** `Save last N min` is the *primary* action; `Stop` is the
  end/destructive one. Clear hierarchy — but compact buttons, not huge ones.
* **Output + modes.** Make the device control feel part of the instrument, and
  make `OSCILLOSCOPE / SPECTRUM / SPECTROGRAM` read as *view modes*, with the
  active one obvious without a fat border. (Note: as of Phase 9 the device
  picker is off by default and lives in the right-click quick menu.)
* **Typography.** One UI sans + one technical mono, no more. Small uppercase
  labels for instrument categories, strong numerals for time, coherent
  hierarchy without huge font sizes.
* **Spacing.** A real scale (4/8/12/16/24/32/48) used to create hierarchy — not
  padding sprayed everywhere.
* **Borders & glow.** Dramatically less. Subtle 1px separators, low-opacity
  borders, accent borders only for active/important elements, background
  contrast to define surfaces. Glow is an *accent* — LIVE indicator, waveform,
  active mode, primary action — not a property of every element.
* **Surfaces.** A real depth hierarchy: app bg → header → control →
  visualization → interactive controls. The steps can be extremely subtle.
* **Motion.** 150–250ms. Subtle LIVE pulse, smooth mode transitions, small
  hover/press feedback, a refresh spin, a clear save confirmation. Never
  arcade-y. Honour `prefers-reduced-motion` (there's already a block for it).
* **States.** Every control needs default / hover / active / focus / disabled.
  Keyboard focus must be visible. Never communicate state by colour alone.
* **Accessibility.** Readable contrast, adequate hit targets, meaningful labels,
  screen-reader-friendly controls. The neon sits *on top of* an accessible UI.
* **Unicode.** Device names are real-world strings like
  `スピーカー (3- Corsair HS55 SURROUND)`. Don't assume Latin; truncate long
  names gracefully. (`overflow-wrap`/`text-overflow` are already in place —
  don't regress them.)
* **Chrome.** Bring the 26px title bar into the visual system; `recordr` should
  feel intentional. Don't make it taller.

### Theme architecture

Improve the token layer rather than hard-coding per-theme rules. Semantic
tokens wanted: `--bg-app`, `--bg-surface`, `--bg-surface-elevated`,
`--text-primary/secondary/muted`, `--accent`, `--accent-bright`, `--accent-soft`,
`--border`, `--border-active`, `--waveform`, `--grid-major`, `--grid-minor`,
`--success`, `--warning`, `--danger`, `--glow`. Themes redefine tokens; they do
not get their own parallel stylesheets.

⚠️ `styles.css` is ~1700 lines with six per-theme override blocks that grew
organically — a large part of this job is *deleting* rules that a proper token
layer makes redundant. Note that the canvas has its own palette in
`visualizer.ts` (`palette()`, `RAMPS`, `drawBackground()`); the CSS tokens and
that table must be kept in agreement, since the board sits inside the panel.

### Process the user asked for

Audit → design system → layout → polish → cleanup. Don't start rewriting
immediately, and don't stop at "technically improved" — check the result at
1280×720, 1440×900, 1920×1080 and a small window, then iterate.

---

## 11. v3 — planned work

**Do these in this order.** The user set the sequence deliberately: two small,
well-understood items first, then the redesign, then the big one.

### 1. ✅ Fix Bug #8 — the docked pop-out's recording border — DONE

See §4. Ring moved to a `.popout::after` overlay; new `--rec` token per theme.

### 2. ✅ Docking reserves screen space — DONE (`settings.dockReservesSpace`, default off)

Implemented in `src/main/appbar.ts` via `koffi` → `shell32!SHAppBarMessage`,
wired through `snapWindow()`. Verified by an isolated Electron harness (10/10
checks): maximised window refused, oversized reservation refused, a 120px strip
shrinking the work area `0,0 1685x913` → `0,120 1685x793`, window width matching
display width exactly, marker written/cleared, and removal restoring the work
area. The crash path was tested by deliberately leaking a reservation and
hard-exiting.

> ### ⚠️ Read this before touching `appbar.ts`
>
> **This feature broke the developer's desktop once.** A *maximised* window was
> docked; `unmaximize()` is not synchronous on Windows, so `getBounds()` still
> returned `1936x1096`, and we asked the shell to reserve a 1096px "strip" on a
> 1080px display. The result was a 172px usable desktop — icons flung to the
> bottom, nothing able to maximise — and it did **not** clear when the process
> was killed. Recovery took an explicit `SPI_SETWORKAREA` reset.
>
> Three guards now exist and must not be removed:
> 1. `registerAppBar()` refuses a maximised or fullscreen window outright.
> 2. The reservation is clamped to `min(300px, 20% of display height)` with a
>    20px floor; anything outside is refused and logged, never honoured.
> 3. A marker file is written when the shell accepts a reservation and deleted
>    on clean removal. `reclaimStaleAppBar()` runs at startup before any window
>    can register, and forces the work area back if the marker survived.
>
> **Windows does not reliably reclaim appbar space when the owning process
> dies** — measured, not assumed. An earlier reading suggesting otherwise was a
> stale per-process cache in `System.Windows.Forms.Screen`; that class caches
> display metrics, so always re-measure in a *fresh* process.

Still worth doing later: the shell posts `ABN_POSCHANGED` to the callback
message we register, which Electron's window proc doesn't dispatch. We stand in
for it with `display-metrics-changed` / `display-added` / `display-removed` and
the window's own `resized`. That covers resolution and monitor changes but not
another appbar appearing alongside ours.

<details><summary>Original brief</summary>

**What the user asked for**, in their words: *"when it snaps to the top… I want
it to move any other applications, [so they] need to be kind of snapped so that
the top of that window is underneath it. So it doesn't block the top toolbars of
other applications."*

Today, docking to the top just parks a floating always-on-top window over
whatever is behind it — a maximised browser keeps its tab strip and address bar
underneath Recordr, hidden. The desired behaviour (user screenshots) is what the
**taskbar** does: the desktop work area shrinks, and every other window lays
itself out below.

* **The mechanism is `SHAppBarMessage`** (shell32) — the Windows *application
  desktop toolbar* ("appbar") API, which is exactly what the taskbar itself
  uses. Sequence: `ABM_NEW` to register the HWND, `ABM_QUERYPOS` +
  `ABM_SETPOS` with `uEdge = ABE_TOP` and the desired rect (Windows adjusts the
  rect for other appbars and hands it back), then move the window to the
  returned rect. `ABM_REMOVE` to give the space back.
* Electron exposes no wrapper for this. The HWND comes from
  `win.getNativeWindowHandle()`. Two routes:
  1. **`koffi`** (or another prebuilt FFI) to call `shell32.dll` from the main
     process. **Preferred** — this box has no VS Build Tools (see the Phase 3
     history), so anything needing `node-gyp` is a non-starter, and koffi ships
     prebuilt binaries.
  2. Extend the existing .NET 8 helper in `native/RecordrLoopback` with a second
     command that takes an HWND. We already build and ship that helper, so no
     new dependency — but it puts the appbar's lifetime in a separate process
     from the window that owns it, which is worse.
* **This must be a setting**, default off, and must apply only while actually
  docked. Undock → `ABM_REMOVE`.

⚠️ **Three traps, all of which will bite:**

1. **A stale registration shrinks the user's desktop until they log out.** If we
   register and the process dies without `ABM_REMOVE`, the reserved strip can
   persist with nothing in it. Needs `ABM_REMOVE` on `before-quit`, on window
   close, on undock, *and* a defensive sweep on startup. Treat this as the
   headline risk — it breaks the whole machine, not just our app.
2. **It will fight our own snapping code.** `workAreaFor()` in
   `src/main/window-controls.ts` reads
   `screen.getDisplayNearestPoint(...).workArea`, and once we register an appbar
   that work area *excludes our own strip*. Re-snapping would then walk the
   window progressively down the screen. Snap geometry has to be computed from
   `display.bounds` (minus other appbars) rather than the post-registration work
   area.
3. **`ABN_POSCHANGED` needs handling.** When the taskbar moves, another appbar
   registers, or the resolution changes, Windows notifies via the
   `uCallbackMessage` we registered — which an Electron window proc won't
   process. At minimum, re-apply position on
   `screen.on('display-metrics-changed')` and `display-added`/`display-removed`.

Also: appbars are per-display and the rect is in **physical** pixels, so DPI
scaling has to be applied. Fullscreen exclusive apps (games, full-screen video)
ignore the work area — that's expected and fine.

</details>

### 3. Premium visual redesign — IN PROGRESS (Phases 1–2 done)

Brief in **§10**. Working through its own phase list.

**✅ Phase 1 — audit.** Measured, not guessed. `styles.css` held **271
hard-coded colour values** (149 hex + 122 rgba) against only **106 token uses**,
with just 11 tokens, all presentational (`--accent-2`, `--bg-2`) rather than
semantic. The per-theme override counts named the problem exactly: `classic` 34
rules, `kawaii` 67, but `cyberpunk` / `synthwave` / `monochrome` **three each** —
they were literally palette swaps of `modern`, which is the "same UI, different
colours" complaint in numbers. 94 distinct class names across the renderer.

**✅ Phase 2 — design system.** Semantic token layer at the top of
`styles.css`: **42 tokens**, all six themes plus `:root` carrying a full block.
Two decisions worth keeping:

* Tokens are scoped to `.theme-*`, **not** `.app.theme-*`. The pop-out root is
  `.popout.theme-*`, so the old blocks never matched it and every theme
  rendered there in the default palette. One selector now feeds both windows —
  verified by screenshot (cyberpunk pop-out chrome, previously always navy).
* Each theme sets *personality* knobs, not just hue: `--glow` (0.15 monochrome
  → 0.7 cyber), `--radius` (0 classic → 18px kawaii), `--panel-blur`, surface
  separation, border weight, and a mono type stack for classic. This is what
  stops the themes collapsing back into palette swaps.
* Legacy aliases (`--bg`, `--fg`, `--line`, …) map the old names onto the new
  semantic ones, so the layer landed with **zero visual change** to
  already-styled components. The old `.app.theme-*` blocks still win on
  specificity where they exist — deliberately — and get deleted per component
  as it migrates.

**Next — Phase 3 (layout), Phase 4 (polish), Phase 5 (cleanup).** The real work
left is migrating components onto the tokens and deleting the per-theme override
blocks that a proper token layer makes redundant. Expect `styles.css` to get
*shorter*. Remember the acceptance test: it must still look good with `--accent`
forced to grey.

### 4. Historical waveform — scrub, select, drag out

**The big one.** The user's words: *"a new visualizer that lets us see
historical audio… a waveform… this will allow users to scrub through, highlight,
select, and then drag and drop the bits of that audio they want to clip."*
Same model as Rolling Sampler by Bird Things.

> **The user explicitly asked that this be phased and not attempted in one
> turn.** Land it in stages, each shippable on its own.

It becomes a **fourth visualizer mode** alongside oscilloscope / spectrum /
spectrogram, so `VisualizerMode` in `src/shared/types.ts` gains a member, and the
chip row, the quick menu and `SettingsPanel` all pick it up automatically-ish.

**Phase A — the peak track.** A ring buffer of min/max pairs per ~20ms bucket,
accumulated off the existing AnalyserNode's time-domain data, sized to
`settings.bufferSeconds`. Cheap (10 min at 20ms ≈ 30k pairs) and completely
independent of the encoder. Nothing user-visible yet.

**Phase B — draw it.** Render the peak track as an overview of the last N
minutes: envelope, time axis, "now" edge on the right. Read-only.

**Phase C — selection.** Click-drag to select a range, with a duration readout,
keyboard nudge, and edge handles.

**Phase D — export the selection.** ⚠️ **This is the hard part, and it is not
the peak track.** `ring-buffer.ts` holds *encoded* WebM/Opus chunks from
MediaRecorder, and only the first chunk carries the header — individual chunks
are not independently decodable, so you cannot simply concatenate an arbitrary
sub-range. The workable path: take header + the chunks spanning the selection,
`decodeAudioData` that, slice precisely in PCM, re-encode the slice, write it.
Do **not** try to cut the encoded stream at sample granularity.

**Phase E — drag it out.** `webContents.startDrag({ file, icon })` in main, over
a new IPC channel, so a selection can be dropped straight onto the desktop or
into a DAW. Needs a temp-file strategy (write to `app.getPath('temp')`, and a
cleanup policy for clips the user drags but never keeps).

**Phase F — polish.** Zoom/scroll on the overview, a Save-selection button as a
non-drag path, keyboard shortcuts, and a decision on what history mode should do
in the **pop-out** — it receives only analyser frames over `viz:frame` and has no
ring buffer of its own, so either the peak track gets streamed to it too, or the
mode is disabled there. Decide this early; it affects the Phase A data flow.
