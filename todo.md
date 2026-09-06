# Recordr — Project Handoff

> **Last updated:** 2026-08-17 (Phase 10 — v3.0.0)
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

### Phase 11 — save-format button visible + dedicated clip-record button (2026-09-02)

User asked: *"...we were meant to add a button that could change the format of the audio from webm to WAV or mp3... I didn't see this button added... Also, I'd like to have a dedicated record button... to record smallest clips or samples rather than having to collect the entire chunk that's been recording to memory."*

* **Format picker was already built** (`src/renderer/components/FormatPicker.tsx`) but only rendered in the `full` layout footer, or in the compact footer when `showSourcePicker` was on (off by default) — invisible in compact/bar, and the packaged exe's `app.asar` predated it. Fix: the compact layout's footer now always renders the compact format trigger (`App.tsx`), regardless of `showSourcePicker`, and `dist/` was rebuilt (Sep 2). Installed/packaged builds still need `npm run package` to pick it up.
* **Format tag on the transport buttons**: `Transport` shows the active container (WebM / WAV / MP3) as a small monospace `.lbl-ext` tag on the record, save (and traditional-mode toggle) buttons — always visible, even in icon-only label mode, so you can see what a clip/save will be written as. The pop-out gets the format over `VizState.format`. (Also fixed en route: the traditional-mode start/stop toggle had been accidentally dropped when the clip button was added — restored.)
* **Clip temp-file cleanup**: `pruneAbandonedClips()` in `src/main/clip.ts` deletes stray `clip-*.webm.part` files (orphaned when the renderer crashes mid-clip before the abort IPC lands). Runs at startup (`index.ts` whenReady, next to `reclaimStaleAppBar`) and again at the top of every `startClip()` so a fresh clip never co-exists with a stale one.
* **Live stopwatch on the record button** (user asked: "Show the clip's live elapsed time on the record button while it's recording"): while a clip records, the ● button's label becomes `m:ss` (250 ms interval, tabular-nums so digits don't jitter; icon still pulses, tooltip still says stop & save). Implemented in both windows: the main HUD ticks off `clipStartedAt` state in `App.tsx` (ref → state so the change re-renders), the pop-out receives the timestamp over `VizState.clipStartedAt` and ticks its own copy. Interval rather than rAF so it keeps counting while the main window is hidden behind the pop-out (`backgroundThrottling` off).
* **Keep-or-discard prompt on clip stop** (user asked: "Add a cancel option so stopping a clip asks whether to keep or discard it"): pressing the record button while a clip is active now asks via a native `confirm()` — OK keeps & saves, Cancel discards (`useCapture.discardClip()` stops the recorder and deletes the temp file; a ✓ "Clip discarded." toast confirms it). The pop-out asks in its *own* window (when `hideMainWhenPopped` is on, a prompt on the hidden main window would be invisible) and routes the answer via new `VizCommand 'discard-clip'`; `toggle-clip` from the pop-out skips the main window's re-prompt. Prompt text lives in `src/shared/utils.ts` (`CLIP_STOP_PROMPT`) so both windows stay in sync.
* **Traditional Stop now saves** (user asked: "Make the traditional-mode Stop button save the recording instead of discarding it like the hotkey does"): `App.toggleCapture` intercepts the stop and runs the same stop → encode → save path as `handleHotkey` instead of flipping `capturing` (which made `teardownRecorder` stop and *discard* the chunks). Includes a double-click guard and a toast when no save folder is set. `recorder.bufferedDuration()` now reports real session elapsed time in traditional mode (the rolling buffer stays empty there, so the save toast previously read `0.0s`). The pop-out's transport gets the same fix automatically (it routes through `toggle-capture` → `toggleCapture`).
* **Dedicated record button** (rolling mode only — traditional mode's start/stop already is a record button): a clip is an *independent* MediaRecorder session (`useCapture.beginClip` / `endClip`) that **streams straight to disk** — every `dataavailable` chunk is forwarded over new `clip:start/append/read/abort` IPC (`src/main/clip.ts`) and appended to a temp file in `%TEMP%/recordr-clips` as it arrives, so nothing accumulates in renderer RAM. On stop the file is read back once and saved via the existing pipeline: WebM is a bytes passthrough, WAV/MP3 decode the (clip-sized) stream once and re-encode. The temp file is deleted after the save (or on stream teardown). Chunk ordering is guaranteed by a promise chain inside the recorder's `flush()` (the final pre-`onstop` chunk rides the same chain) and a matching append chain in main, so finalize never races a trailing chunk. Independent of `capturing` and of the rolling buffer, so a short sample never drags the whole N-minute session (or the WAV/MP3 PCM ring) through encode. Includes a double-click guard, teardown on stream switch, and full pop-out support (`VizCommand 'toggle-clip'`, `VizState.clipActive`).
* **Split view — all four visualizers at once** (user asked: "Can you make a button that allows us to have ALL 4 views of visualizer visible at any given time? ... give each visualizer an X that we can click to remove it ... so we can reduce it to 3 or 2 visualizers in 1 view"): new persisted settings `vizGrid` (split on/off) + `vizHidden` (modes closed out of the split). A floating `⛶ Split view` / `⊟ Single view` pill on the board's bottom-right corner is the master toggle; while split, the board is a 2×N grid of **read-only** panes (`VisualizerBoard` gained an `interactive` prop — the history pane there is an overview, no selection/drag layer). Each pane has an ✕ (close) and a name tag; closed modes are re-added via a dashed `＋ Add view` tile that expands into the list of hidden modes, or by clicking the footer chips, which double as the split's membership list (lit = pane on screen) instead of single-mode radios. `settings.visualizer` keeps meaning "the single view" and is auto-un-hidden when entering the split so the view you were watching never starts off-screen. Analyser smoothing (one AnalyserNode, one constant): 0.3 while the spectrogram pane is visible, 0.82 otherwise in split, per-mode when single. Modes come from a shared `VISUALIZER_MODES` / `VISUALIZER_LABELS` in `src/shared/types.ts`.
* **Split view fills the board** (user: "the split view should use the extra space when its available", screenshot showing a wasted quadrant occupied by the + tile): the split is now a **mosaic** that always fills the board — 4 panes → 2×2; 3 panes → two side by side with the third spanning the full bottom row (so closing one view *grows* the rest instead of leaving a hole); 2 panes → two full-height columns; 1 pane → the whole board; 0 → a centered hint. The old quadrant-sized dashed ＋ tile is gone: re-adding is now a small floating **＋ Add view** pill at the board's bottom-right (next to the Split/Single pill) that pops an upward menu of the closed modes (`AddViewMenu.tsx`, shared by both windows; the chips row remains the always-visible membership list).
* **Split view now works in the pop-out too** (user: "Pop out or small view doesnt have the split views"): the pop-out board renders the same `viz-grid` of read-only panes with per-pane ✕ and the ＋ Add-view tile, its chips double as the membership list while split, and a new `⛶`/`⊟` toggle sits in the pop-out's drag strip (`PopoutApp.tsx`). `vizGrid`/`vizHidden` are app settings, so split state is shared between both windows — one source of truth, and toggling either side flips the other. The history pane needed its peak data: main's `viz:history` stream now runs whenever the pop-out could show a history view (its single mode is history *or* the split has a history pane), not just when `settings.visualizer === 'history'`.
* **Compact layout removed** (user: "the compact view is completely pointless get rid of it"): every entry point is gone — the title bar's ▤ cycle button, the Settings → Layout radios, and the Layout submenus in the tray and right-click quick menu. The main window is always the full layout; `settings.ts` normalizes any stored `'compact'` from old files to `'full'` on read *and* write. The full layout already sheds chrome to a strip via its height breakpoints (HUD collapses below 460px, footer goes below 260px), and the pop-out covers the small-monitor case, so nothing user-visible was lost. Dock-to-top still works (a docked main window is a 100px strip via `snapWindow`'s own min-size override).
* **Pop-out transport shrinks with the window** (user: "the popout view is good but the buttons dont get smaller when we reduce its size"): pop-out-scoped media queries — below 560px of width the format (WebM/WAV/MP3) tags drop off the buttons, and below 240px of height (a docked monitor strip is short but wide) the whole control row tightens (smaller padding/font, chips shrink). The pop-out window is its own viewport, so these fire on its own size.

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
4. **Historical waveform: select & drag out** — phased, §11.4 (master plan
   revised 2026-09-04 with links to Rolling Sampler by Bird's and an accurate
   inventory of the half-built WIP). The user asked specifically that this
   not be attempted in one turn.
   * ✅ **Phase 1 — time-coordinate refactor** landed 2026-09-04 (see §11.4):
     new `HistoryModel` module, selection in absolute session seconds across
     board / App / pop-out / IPC, per-column decimated drawing, and a fix for
     the history-mode startup crash.
   * ✅ **Phase 2 — zoom & pan + time ruler** landed 2026-09-04 (see §11.4):
     wheel-zoom (around cursor, or selection when one exists), middle/
     shift-drag pan, double-click fit-all, `+`/`−` keys, bottom time ruler
     with adaptive ticks + a live-edge "now" marker, viewport-fed column
     decimation, and a follow-live edge that keeps streaming audio in view.
     **Next up is Phase 3 — sample-accurate export engine (the real hard
     part).**

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
* **The icon is generated, not drawn by hand:** `scripts/make-icon.js` renders the oscilloscope mark (dark navy rounded square, faint grid, neon-green chirp-burst trace with glow — deliberately Recordr's green) into raw RGBA with 4x supersampling, encodes PNG via `node:zlib` + a hand-rolled CRC32 (no image deps — disk was at 94%), and wraps a multi-size ICO. Outputs `build/icon.ico` + `build/icon.png` (electron-builder auto-picks these up for the exe/installer/taskbar) and `src/main/icon-assets.ts` (base64 PNGs for the runtime window/tray icons, consumed by `tray.ts`; tray gets a @2x representation for high-DPI, and recording state stays visible via the red overlay badge). Re-run `node scripts/make-icon.js` after changing the artwork — the sanity check re-inflates each PNG; remember chunk layout is `[len][type][data][crc]` when slicing IDAT.

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
>
> **2026-09-02 — this bit a real user again, twice in one day:** a force-killed
> session left the primary display's top strip reserved with no marker to
> trigger the reclaim. Failsafes hardened:
> 1. The marker file is now written **as soon as ABM_NEW succeeds**, not after
>    SETPOS — the crash window between the two used to strand the desktop with
>    no marker. (A false positive costs only a needless full-screen reset next
>    boot; a false negative costs the user their screen until logout.)
> 2. **Tray menu → "Fix desktop work area"** — an always-available manual
>    recovery (calls `resetWorkArea()`), for when no marker exists to trigger
>    the automatic reclaim.
> 3. **`scripts/reset-workarea.js`** — standalone koffi one-shot (
>    `node scripts/reset-workarea.js`) to restore the work area even outside
>    the app.
> 4. **Logon auto-recovery — "fixes on its own"** (user: *"any way to make
>    sure that if it closes unexpectedly that it fixes on its own?"*). A
>    VBScript launcher in the per-user Startup folder
>    (`scripts/install-recovery-launcher.js` installs/removes it; the app
>    re-writes it on every packaged startup so it follows the exe across
>    installs) checks the crash marker *before* booting anything — healthy
>    logons cost nothing — and only a crashed session launches
>    `Recordr.exe --fix-workarea`, a hidden one-shot mode (new `init()`
>    branch in `src/main/index.ts`) that runs the same stale-reclaim then
>    `app.exit(0)` with no window or tray. The single-instance lock doubles
>    as its safety check: if a live instance exists it owns any reservation,
>    so the fixer bails out and never touches the desktop. Chose the Startup
>    folder over a Task Scheduler logon task because `schtasks /create /sc
>    onlogon` is refused unelevated (Access denied — measured 2026-09-02),
>    while the Startup folder needs no privileges. Keep the VBS template
>    (`buildRecoveryLauncher`) and the standalone script in sync; when
>    interpolating paths into VBS, remember it has no escape sequences —
>    double JS backslashes or `\r`/`\u`… gets eaten and the launcher silently
>    targets a broken path.

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

### 4. Historical waveform — select & drag out (MASTER PLAN, revised 2026-09-04)

**The big one.** The user's words: *"a new visualizer that lets us see
historical audio… a waveform… this will allow users to scrub through, highlight,
select, and then drag and drop the bits of that audio they want to clip"* and,
Sep 2026, *"the ability to highlight & select a chunk or snippet inside the
history visualizer and either right click to save that small snippet as a
sample OR simply drag and drop it … on the desktop or straight into a DAW,"
plus "zoom in and out … since as time progresses the wave gets harder to see
each individual hit or transient."*

> **The user explicitly asked that this be phased and not attempted in one
> turn.** Land it in stages, each shippable on its own.

### 4.1 What we are copying — Rolling Sampler by Bird's (Bird Things)

Our reference product. Read these before starting any phase:

* **Home:** https://www.birdsthings.com/ — *"Rolling Sampler records the audio
  reaching it in a loop as long as it is running. The recorded bits can be
  highlighted and dragged out anywhere."* Only keeps the last user-configurable
  seconds/minutes **in RAM** and **only creates audio files when a selection is
  dragged out**; constant memory, no disk churn. The gestures list (from the
  site) is our interaction spec:
  * **Middle-drag** — pull/pan the display (travel back through history).
  * **Alt/Option + click** — preview (audition) the recorded audio.
  * **Ctrl/Cmd + click** — pause the sampler.
  * **Ctrl/Cmd + Shift + click** — zoom the display.
* **Changelog:** https://www.birdsthings.com/rolling-sampler-changelog — the
  feature list is a roadmap we should steal from:
  * Zooming: *"Make a selection and roll the mousewheel to zoom in and out"*;
    the `z` key toggles zoom; newer betas add *"alt+drag to zoom in and out
    around the capture"*. A *"draw more accurate waveforms"* setting exists
    for when you're zoomed in (the old style is used zoomed out).
  * Drag out: *"by dragging the play/stop markers"* (the selection edges) or
    *"by holding shift anywhere"*.
  * Keyboard: `s` = "directly save selection to recording path".
  * Right-click on the selection → settings (incl. silence-trim threshold,
    auto-trim on drag-out, default −125 dB).
  * Output: **WAV**, 32-bit float by default, 24-bit optional; channel select
    (stereo / mono-L / mono-R); optional BPM info in the filename to prevent
    DAW auto-warp.
  * Buffer duration up to 10 min (default 45 s), right-click → settings.
* **Real-world writeup (Ableton workflow):**
  https://ourfriendgus.com/rolling-sampler-tricks/
* **KVR thread (reviews/behaviour notes):**
  https://www.kvraudio.com/product/rolling-sampler-by-birds/reviews

**TL;DR of the target behaviour:** a loop recorder whose waveform you can
zoom/pan through, drag over a chunk, and drop the chunk onto the desktop or
into a DAW as a WAV — the file is produced **only when you drag it out** (or
press `s`), from a RAM buffer, and lands in a folder you chose once.

### 4.2 Current state (accurate as of 2026-09-04 — most of Phases A–C are built and half-wired)

The original Phase A–F sketch below was largely implemented as uncommitted
WIP. **Do not re-plan from the original sketch — re-plan from this list.**

**What works today:**
* `history` is the 4th `VisualizerMode`; reachable from the chips, the quick
  menu, the split view, and the pop-out (split panes are read-only, but a ⧉
  pinned pop-out shows an interactive single History board).
* **Peak track (old Phase A):** `src/renderer/lib/peak-buffer.ts` — ring of
  min/max pairs per **20 ms bucket**, capacity = `bufferSeconds`. Fed in
  `src/renderer/hooks/useCapture.ts` (a `setInterval`, not rAF, so it survives
  hidden windows) from the live AnalyserNode's time-domain data. **Only runs
  while `capturing` is on** — stopping the rolling recorder nulls it.
* **Drawing (old Phase B):** `drawHistory()` in
  `src/renderer/lib/visualizer.ts` fills an envelope of the *whole* buffer
  compressed into the pane width (newest at the right edge). No time ruler,
  no "now" marker, **no zoom or pan**. 20 ms buckets × 15 min ≈ 45k points
  drawn with one `lineTo` each per frame — wasteful, and the full-width
  compression is exactly why hits become unreadable as time passes.
* **Selection (old Phase C):** `VisualizerBoard.tsx` — click-drag creates a
  range; the region has a tint, edge handles, a duration badge, ←/→ nudge
  (Shift = 5×), Esc clears. Selection is stored as **fractions 0..1 of the
  whole buffer** (fine only because the view *is* the whole buffer — see 4.3).
* **Export plumbing (old D/E, partial):** on every selection settle,
  `App.handleSelectionChange` snapshots the WebM rolling buffer
  (`recorder.snapshotBuffer(sel)`, which slices the **chunk list** by fraction
  and prepends the retained init segment) and writes the result to a temp
  `.webm` via `prepareDragFile`; the selection div is `draggable` and its
  `dragstart` calls `startDragExportPrepared` → main `webContents.startDrag`
  (Electron's official out-of-window file-drag pattern — this part is correct
  and DAW/Explorer-facing). Manual **Save** while history is the active single
  view also crops the selection (WebM passthrough, or WAV/MP3 via the PCM
  ring when that format is selected in rolling mode).
* **Pop-out:** peaks stream over `viz:history` IPC every 200 ms
  (`src/renderer/PopoutApp.tsx`); selections there round-trip through
  `viz:command selection-change` and the main window does the file prep.

**Known gaps / why it doesn't feel like Rolling Sampler yet:**
1. **Export is chunk-coarse, not sample-accurate** (±~1 s). Selection is a
   visual fraction over the 20 ms peak track, but the WebM export slices a
   1 s-chunk list; the WAV/MP3 path slices a PCM ring by the same fraction.
   Three different time bases (peak buckets / WebM chunks / PCM frames) only
   roughly line up. The old Phase D decode→slice→re-encode pipeline was never
   built.
2. **Drag-out is always `.webm`/Opus regardless of the chosen format** — and
   WebM is not on DAW import lists (Ableton's supported formats: WAV, AIFF,
   FLAC, OGG Vorbis, MP3, M4A — no WebM: https://help.ableton.com/hc/en-us/articles/211427589-Supported-Audio-File-Formats).
   Rolling Sampler drags out WAV. A drop into Bitwig/FL/Ableton today would
   likely be rejected.
3. **No zoom/pan/time ruler** — the whole buffer is always squeezed into the
   pane, so every passing minute shrinks every old transient.
4. **No right-click "save selection"** — right-click anywhere pops the app's
   native quick menu; there is no per-selection item.
5. Temp `recordr_snippet_*.webm` files accumulate in `%TEMP%` with no cleanup
   (clips are pruned; snippets aren't).
6. History only exists while the rolling recorder is actually running; a
   pause clears the peaks and any selection.
7. No audition/preview/scrub of buffered audio (RS alt+click).

### 4.3 Design decisions to lock in first

**D1 — One absolute timeline per rolling session.** Selection, viewport and
all exporters must speak **seconds-since-session-start** (or bucket indices
× 20 ms), never fractions of a viewport or of a chunk list. The peak buffer
stays the display/source-of-truth for *where things are*; the exporters map
the same seconds onto their own data. Today's `[0..1]` selection payload is
fine while the view == the whole buffer; it must become absolute the moment
zoom/pan lands (Phase 1 does this refactor first).

**D2 — Memory model (the Rolling Sampler trade-off).** RS keeps *decoded*
audio in RAM and writes the WAV at drag time. We keep *encoded* WebM in RAM
(~4–8 MB for 15 min) — much cheaper, but unusable for sample-accurate slicing.
Two candidate end-states:
* **A (always-on PCM ring, like RS):** keep the last N seconds decoded in RAM
  at all times while rolling. Sample-accurate slicing and instant export in
  any format. Cost ≈ 11.5 MB/min stereo 48 kHz 16-bit → **≈ 173 MB at the
  current 15-min default** (the `pcm-ring.ts` docblock already flags this).
  Rolling Sampler caps at 10 min partly for this reason.
* **B (decode-on-demand, recommended default):** keep the WebM (cheap), and
  when a selection settles, decode the *buffered WebM once per session* and
  cache the decoded channels; every later selection on that session is a pure
  PCM slice + encode (fast). One decode of a 15-min Opus stream costs a
  couple of seconds of CPU and ~170 MB transiently; cache it so it happens
  once. Also enables audition preview (D5) from the same cache.
Choose B unless the user opts into A; note the memory number in Settings copy.

**D3 — Selection ↔ audio mapping.** `PeakBuffer` buckets are 20 ms nominal;
bucket *i* covers ~`i*0.02 s`. Export bounds for phase 3 come from absolute
bucket indices, converted to seconds, then to PCM frames on the decoded side.
Do **not** try to cut the encoded stream at sample granularity (WebM cluster
timecodes make it meaningless) — always decode-then-slice (the old Phase D
warning stands).

**D4 — What gets dragged out.** The dragged file should be the **user's chosen
save format** (or default to WAV when the format is WebM and the target is a
DAW — WebM/Opus is not DAW-importable, see 4.2 gap 2). Decide with the user;
WAV is the safe default for drops.

**D5 — Audition.** Preview requires playing decoded audio in the renderer
(`AudioContext` + buffer source, or `<audio>` with a blob URL). Only possible
once a decode exists → rides D2-B's cache. RS: alt+click plays under the
cursor; a playhead should render on the waveform.

### 4.4 Phased build order (each phase shippable & independently verifiable)

**✅ Phase 1 — Time-coordinate refactor (prerequisite for everything) — DONE 2026-09-04**
* **New `src/renderer/lib/history-model.ts`**: a `HistoryModel` owning the peak
  buffer, the session clock and every coordinate translation (session seconds
  ↔ bucket index ↔ display fraction). `HistoryModel` is constructed with a
  *stamped* `newestSec` advanced by `performance.now()` — the main window
  builds it at capture start (`newestSec = 0`, in `useCapture.ts`), and the
  pop-out rebuilds it from each `viz:history` frame using the `newestSec` the
  main window stamps onto the payload (`HistoryStream` in `src/shared/types.ts`,
  typed through the preload bridge). That keeps both windows on one absolute
  time base even though their `performance.now()` clocks have independent
  origins — D1 in action.
* **Selection is now absolute session seconds.** `VisualizerBoard.tsx` stores
  `[startSec, endSec]` (never fractions); pointer drags map through
  `model.fractionToSec`/`clampSec`, the `onSelectionChange` payload, the
  pop-out's `selection-change` command, and `App.selectionRef` all carry
  seconds. Exporters (WebM ring, PCM ring) still slice by 0..1 fraction
  internally, so `App.tsx` translates with `model.secToFraction` at the
  boundary — selection + manual save behave exactly as before, and the
  duration badge now shows the true selected seconds (e.g. `12.34s`) instead
  of fraction × buffer.
* **Drawing decimated per column.** `drawHistory` now uses
  `model.columnPeaks(0, count, columns)` — one min/max pair per output pixel
  column, one pass over the data — replacing the 45k-`lineTo` path at 15 min.
  Fit-all view is pixel-equivalent; the same call with a narrowed bucket
  window is exactly what Phase 2's zoom needs.
* **Fixed a pre-existing startup crash the smoke test caught**: with `history`
  as the active mode and no capture bound, `VisualizerBoard` passed
  `{} as AnalyserLike` into `drawVisualizer`, whose `analyser.sample()` threw
  `TypeError` on frame one — killing the board's draw loop whenever the app
  booted straight into history. Now a proper no-op `STUB_ANALYSER` is used.
* **Done when:** ✅ typecheck green, ✅ selection + manual save verified
  (logic unchanged, just re-coordinated), ✅ duration badge shows true
  seconds, ✅ packaged build boots clean (smoke-tested `package:dir` output).

**✅ Phase 2 — Zoom & pan + time ruler (user-visible win #1: "hard to see
hits as time progresses") — DONE 2026-09-04.**
* **Viewport lives in `VisualizerBoard`** as `ViewportState`
  (`{ startSec, endSec, following }`, null = fit-all), with all the math on
  `HistoryModel` (`effectiveViewport` / `zoomViewport` / `panViewport` /
  `fitViewport` + a `liveMarginSec` follow threshold). `following` viewports
  slide with the live edge every frame, so zooming in at "now" keeps new
  audio streaming in; a fixed viewport stays parked in the past and clamps
  out of existence when the ring wraps past it. The model keeps the pure
  math; component state keeps the value — deviation from the plan's "model
  owns viewport state" so the pop-out's per-frame model rebuilds don't reset
  the zoom.
* **Gestures** (pointer state machine so they never fight): plain left-drag
  = select (existing); **wheel = zoom** around the cursor — or around the
  selection's center when one exists (RS: "make a selection and roll the
  wheel"); **middle-drag or Shift+drag = pan**; **double-click = back to
  fit-all**; `+`/`=` and `−`/`_` zoom in/out from the keyboard (anchor:
  selection center, else view center). Wheel is a native non-passive
  listener (React's synthetic `onWheel` can't stop ctrl+wheel page zoom).
  Selection and nudge thresholds are now relative to the *visible span*
  (0.1% / 0.5%), so you can select a 30 ms transient when zoomed in.
* **Time ruler** along the bottom of the history pane: adaptive "nice" tick
  steps (20 ms … 1 h), labels as session-relative `m:ss` offsets (sub-second
  steps show `0.500s` style), plus a subtle **"now" marker** at the live
  edge in the theme's accent colour when the edge is in view. Theme-aware
  via the existing canvas `palette()`.
* **Drawing** feeds the viewport's bucket window into the same
  `columnPeaks` decimation as Phase 1, so zoomed-out stays one pass and
  zoomed-in resolves true detail down to the 20 ms bucket (Phase 6 adds a
  finer sampler past that). The selection overlay is repositioned every
  frame by direct style writes (no re-renders), so it tracks the sliding
  follow-view exactly.
* Viewport math verified numerically (fit-all, zoom-at-now keeps following,
  zoom-into-past is fixed, pan clamps at both edges, stale-view clamps,
  min-span 0.1 s); typecheck green; packaged build boots clean.
* **Done when:** ✅ zoom into an individual drum hit 15 minutes in (0.1 s
  min span ≈ 5 buckets), ✅ pan back through time, ✅ ruler shows real
  session offsets, ✅ "now" marker tracks the live edge while following.

**Phase 3 — Sample-accurate export engine (the real hard part).**
* New renderer module (extend `encode.ts` / `pcm-ring.ts`): given absolute
  seconds `[a, b]` → (1) `recorder.snapshotBuffer()` full WebM (init segment
  + all chunks), (2) `decodeAudioData` once per session (cache channels per
  D2-B; invalidate on recorder restart / stream change / buffer-length
  change), (3) measure the decoded buffer's real duration, (4) slice
  `[a, b]` in PCM frames, (5) encode via the existing `encodeFromPcm` (WAV /
  MP3) or passthrough a WebM re-mux when format is WebM (acceptable to keep
  chunk-coarse WebM for the rare WebM-drop case; WAV is the accurate path).
* Validate the cluster-timecode behaviour empirically: decode the snapshot and
  confirm where sample 0 lands (leading silence/gap?) so the slice offset is
  right; log measured-vs-expected durations in dev.
* Run the decode+encode off the UI thread enough not to stutter (Web Worker
  can't touch AudioContext for decode — keep decode on main but chunk the
  encode, or re-check worker support for `AudioWorklet`/OfflineAudioContext;
  a brief spinner/toast is acceptable for now — RS-level snappiness is the
  target later).
* **Done when:** exporting a selected 0.3 s transient yields a file whose
  first/last samples are at the selected boundaries (measure by re-decoding
  and comparing RMS onset), in WAV and MP3.

**Phase 4 — DAW-ready drag-out.**
* Prepare the temp file when the selection **settles** (pointer-up / debounce
  ~250 ms), not during `dragstart` (encode latency must not block the drag);
  `dragstart` then just calls the existing `startDragExportPrepared()`.
* Write the file in the format decided in D4 (default WAV for DAW drops),
  named from the filename template or `recordr_snippet_{date}_{time}`; keep
  the icon requirement (`startDrag` needs a non-empty icon on Windows — the
  transparent 1×1 hack in `src/main/ipc.ts` already does this).
* Temp-file lifecycle: name snippet files with a recognisable prefix, prune
  them at startup and on save (mirror `pruneAbandonedClips()` in
  `src/main/clip.ts`), and never let a stale prepared file serve a newer
  selection.
* **Done when:** drag from the history pane drops a playable WAV on the
  desktop AND into a real DAW (test matrix in 4.6).

**Phase 5 — Right-click save + keyboard shortcut (user-visible win #2).**
* Intercept `contextmenu` on the selection overlay **before** the app's global
  quick menu, with items: *Save selection as…* (writes to `settings.saveFolder`
  via the existing save pipeline), *Copy duration*, and RS-style extras later
  (silence-trim).
* `s` key = save selection (RS parity), shown in the hint/tooltip; keep the
  existing "Save" button + selection behaviour but make it explicit that a
  selection exists (badge already shows duration).
* **Done when:** right-clicking a selection saves exactly the highlighted
  audio to the configured folder with a toast, in the chosen format.

**Phase 6 — Parity & polish (optional-but-valuable).**
* Finer peak sampling when zoomed past ~20 ms/px (raise AnalyserNode
  `fftSize`, or read the decoded PCM cache directly for true sample-level
  min/max columns — the cache from Phase 3 makes this trivial for recent
  audio).
* Audition preview (D5): alt+click plays from the decode cache; render a
  playhead; stop on second click. (Scrub = drag playhead while previewing.)
* Pause semantics: decide whether stopping capture keeps the last peaks for
  selection (RS pauses, doesn't wipe).
* Split-view history pane stays read-only, but the ⧉-pinned pop-out History
  board is interactive (already true) — keep that path the "big" workflow.
* Optional RS settings: auto-trim silence on drag-out, channel select,
  24-bit WAV. Only if the user asks.
* **Done when:** the workflow feels like the Rolling Sampler demo video.

### 4.5 Explicitly out of scope (unless the user asks)
* Scrubbing/playhead as a general timeline feature (see Phase 6 preview),
  multi-session browsing, non-rolling (traditional) history, browser port.

### 4.6 Verification checklist (run per phase)
* Manual: `npm run dev`, typecheck (`npm run typecheck`), then the package
  (`npm run package:dir`) for drag tests — `startDrag` only matters in a real
  window but works in dev too.
* Selection accuracy: record a metronome/click track, select one hit, export
  WAV, verify onset/length in an editor (or re-decode in-app and compare).
* Drop matrix: desktop Explorer; Bitwig; FL Studio; Ableton (user has Bitwig,
  FL and others per §9 notes). Confirm each DAW accepts the dragged file and
  plays it.
* Memory: watch the renderer RSS with the 15-min buffer before/after
  selecting (Phase 3 cache), and the `%TEMP%` folder for leaked snippets.
* UI at 1280×720, 1920×1080, a narrow window, and a docked strip; both the
  main window and the pop-out.

**Every phase above is small enough to land alone. Do NOT attempt 1–6 in one
turn; the user has said repeatedly this feature is phased.**

## 11. Upcoming Revisions & Ideas (v3+)

* **Visualizer sensitivity (done Sep 3)**: new `vizGain` setting (0.5×–4×, default 1) — a Settings slider under *Default visualizer*. Scales analyser data at draw time only (× for time-domain, +20·log₁₀(gain) dB for the spectrum/spectrogram), so recordings and their volume are untouched. Wired through `VisualizerState.gain` → `drawVisualizer`, applied in all four modes, in both the main window and the pop-out (each reads its own settings copy).
* **Split view single-row layout (done Sep 3)**: panes are now always side by side in one horizontal row (4 across, 3 across, …) instead of the 2×2 / stacked mosaic — never stacked regardless of window size or pane count.
* **Theme gradient pass (done Sep 3)**: Cyberpunk & synthwave got richer multi-stop gradients — layered canvas backdrops (vertical base + radial glows in each theme's hues), gradient spectrum bars (cyberpunk magenta→yellow→cyan, synthwave orange→pink→cyan), glowing oscilloscope traces, stronger CSS `--bg-gradient` radials, translucent blurred surfaces so the gradient shows through panels, and the pop-out now uses `var(--bg-gradient)` instead of flat `#05070f`.
* **Deprecate Pop-out Mode**: The docked mode works incredibly well now. The current thinking is that "pop-out" mode is no longer necessary and should be completely removed to simplify the codebase and architecture.
* **Ultra-compact Docked Mode**: Instead of a pop-out window, improve the default app's layout behavior. Make it so that when docked, the main window can be shrunk down vertically even further—approaching the thickness/size of a standard Windows title bar.
* **Per-pane pop-out ⧉ + hover-only pane controls (done Sep 4)**: every split-view pane now has a ⧉ beside its ✕. In the main window it opens the pop-out **pinned to that one visualizer** (new transient `VizState.overrideMode` / `VizCommand set-override`; cleared when the pop-out closes — the main window's split layout is untouched, and since the pin honours the single-view board, a pinned History pane in the pop-out gets the full interactive selection/drag layer it normally lacks). In the pop-out's own split, ⧉ focuses that view full-window and the drag-strip toggle becomes “back to all views” (`set-override null`); the mode-chip row hides while pinned. The whole ✕/⧉/name-tag corner cluster is now hidden until the cursor is over the window (`.app:hover` / `.popout:hover`, 0.6 → full on pane hover or keyboard focus). **Fix (same day, user: “popout just closed the other visualizers”)**: ⧉ from the main window used to *hide* the whole main window — the pop-out swap policy (`hideMainWhenPopped`, default on) treated every open as a swap, so pinning one visualizer cost you the rest of the split view. ⧉ now opens the pop-out **alongside** the main window: `popOutMode` in `App.tsx` passes `keepMain` through `togglePopout` → `IpcChannel.popoutToggle` (`ipc.ts`), which marks a transient flag in `popout.ts` (`markPopoutKeepMain`), and `applyPopoutWindowSwap` in `src/main/index.ts` consumes it on that open transition and leaves the main window up. Only the ⧉ path sets the flag — the plain title-bar/tray/dock pop-out flows still swap windows exactly as before.
* **Visualizer labels: top-right corner, hover-only (done Sep 4)**: split-view pane name tags moved from each pane's bottom-left to its top-right (just left of the pane's ✕), and both windows' single view gained a matching floating mode label in the top-right corner (`.board-mode-tag`, rendered in `App.tsx` / `PopoutApp.tsx`). All of these reveal only while the cursor is over the window (`.app:hover` / `.popout:hover`), so an idle visualizer stays clean; the footer chips remain the always-visible mode switcher/membership list.
* **Quick knobs in the title bar + defaults shown in Settings (done Sep 4)**: the custom title bar now carries three compact mono buttons — save format, visualizer sensitivity (e.g. `1×`), and buffer length (e.g. `15m`). They pop **native** menus (`IpcChannel.titleMenu` → `ipc.ts`), the same reasoning as the right-click quick menu: a DOM popover would clip at the edge of a short/docked window. The quick menu also gained matching *Buffer length* and *Visualizer sensitivity* preset submenus (shared presets: `BUFFER_PRESETS_SEC`, `VIZ_GAIN_PRESETS` in `src/shared/types.ts`), which is the fallback when narrow windows hide the buttons via CSS breakpoints (700px drops gain/buffer, 430px drops format). In Settings, the buffer / bitrate / sensitivity rows now state their defaults (15 min / 96 kbps / 1× — read from `DEFAULT_SETTINGS`) and show a Reset chip while the value has drifted. Changing buffer length while rolling restarts the recorder and **drops the rolling window** — the quick-menu radio simply applies it, so warn users via the title-bar tooltip.
* **Layered / blended visualizers — e.g. oscilloscope over history at reduced opacity (DRAFT 2026-09-04 — not started, needs user decisions)**: the user asked for *"a feature that lets users combine the visualizers, for instance we could have the oscilloscope in the history just not at max opacity or vice versa have history inside oscilloscope not at max opacity"* — i.e. composite two (eventually N) modes into ONE board with per-layer translucency, as opposed to the side-by-side split view. Design draft below, not a spec:
  * **Concept:** a board that draws several visualizer modes as translucent layers over a single theme background (Photoshop-style stack) with per-layer opacity and a foreground/background swap. The flagship combination: **History** (the rolling envelope) as the base with the **live oscilloscope trace ghosted on top**, so the current signal is seen against the recorded past.
  * **UX options — pick with the user:** (A) *pairs only*: one base mode + one overlay mode + an opacity slider; (B) *full layer stack*: every unhidden mode is a layer with its own 0–100% opacity and stacking order; (C) *third board layout* next to single/split ("layered") that reuses the split-view membership chips plus a per-layer opacity knob (revealed on hover, consistent with the Sep 4 hover-only board controls).
  * **Technical shape:** compositing happens inside `src/renderer/lib/visualizer.ts` `drawVisualizer`. Today each call is clear → `drawBackground` → draw one mode, and the **spectrogram owns a self-scrolling offscreen history buffer** — so blending isn't free. Refactor to fill the theme background once, then paint each visible layer at its own `globalAlpha`; restrict early blends to stateless draws (oscilloscope / spectrum / history) and treat spectrogram-as-a-layer as a later, separate problem (it scrolls itself). Performance is fine (per-column decimation already exists for history; live modes are single-path draws).
  * **The real design problem is the time base, not the pixels.** History's x-axis spans the last N minutes (a pixel = seconds); the oscilloscope spans one ~43 ms FFT window (a pixel < 1 ms); spectrum is a frequency axis. Naively overlaying two full-board draws is only meaningful as an abstract glow/energy layer. Sensible composites are *location-aware*: (1) the live oscilloscope pinned to the history's "now" edge (the actual current waveform appended, magnified, to the rolling envelope), (2) the history envelope ghosted *under* the live mode once §11.4's zoom lets history be viewed at live scale — same-axis overlay is only correct after the master-plan Phase 1–2 (absolute timeline + zoom/pan) lands, (3) artistic ghosting just for vibe. Decide which with the user; (1)/(2) probably want to wait for the §11.4 zoom phases, (3) can ship on the current pipeline after the small compositing refactor.
  * **Open questions before building:** which pairs must work first (history+oscilloscope seems primary; spectrum+history? is spectrogram allowed in a blend at all?); where the opacity control lives (hover knob in the board's top-right cluster vs Settings slider vs quick menu); does "layered" replace or coexist with split view; should the live layer anchor to history's live edge or span the whole board.
  * **Suggested build order if approved:** (1) compositing pipeline refactor (background once + N layers at `globalAlpha`), (2) history + oscilloscope "live-edge" overlay with opacity control, (3) generalize to arbitrary pairs / layer stack with opacity + order, (4) persistence keys (e.g. `vizLayers`, `vizLayerOpacity`). Don't start until §11.4 Phase 1–2 exist **or** the user explicitly picks the artistic-ghost variant, which doesn't need them.
* **Split/single switch retired — chips ARE the view control (done 2026-09-06)** (user: *"we have 4 dedicated buttons already for each visualizer"* + *"Please remove that [Add view] button"* + *"no need to have this single view button"*):
  * Removed: the `⛶ Split view` / `⊟ Single view` pill (`.board-actions` / `.grid-toggle`), the `＋ Add view` menu (`AddViewMenu.tsx` **deleted**, `.add-wrap`/`.add-popover`/`.viz-empty` CSS gone), the pop-out drag-strip `⛶`/`⊟` toggle (kept only a `⊟` "back to all views" when a pane is ⧉-pinned).
  * `AppSettings.vizGrid` **deleted**. The board now just renders every mode not in `vizHidden`: **one → a single interactive board** (History gets its selection/drag layer — this is the fix for *"can't even select in history"*, which was split panes being `interactive={false}`), **several → the read-only mosaic**. `DEFAULT_SETTINGS.vizHidden` is now `['spectrum','spectrogram','history']` (single oscilloscope by default).
  * **Migration** in `settings.ts readSettings()`: an old file with `vizGrid !== true` + empty `vizHidden` → `vizHidden` set to "all but `visualizer`" so existing users don't explode into a 4-pane mosaic; `vizGrid` key deleted on read.
  * **Chip behaviour** (`App.tsx` / `PopoutApp.tsx` `toggleMode`, both windows): each chip is an independent **on/off** for its visualizer — turn on one for a single board, turn on several for a mosaic. The last lit chip can't be switched off. (First tried plain-click = "show only" + Ctrl-click = add pane; user: *"i was expecting the buttons for each individual visualizer to still work"* — reverted to plain toggle.) The quick menu's visualizer items are now **checkboxes** with the same semantics (History added); Settings "Default visualizer" stays "show only that one".
  * `settings.visualizer` kept as the remembered "primary" (smoothing key, pop-out `forcedSingle` fallback, quick-menu radio state derived from `vizHidden`).
* **History drag-out now produces a DAW-importable WAV (done 2026-09-06)** (user: *"doesn't even let me drag it out from the HISTORY"*):
  * The dragged file is **always WAV** (or MP3 if that's the chosen format) — never WebM/Opus, which no DAW imports (todo §4.2 gap 2 / D4). Manual **Save** still honours the chosen format. `App.handleSelectionChange` forces `dragFmt`, sequences prep with `dragSeqRef` (a newer selection supersedes an in-flight encode), and toasts on empty-range / encode failure.
  * **`dragReady` gate**: `VisualizerBoard` won't fire `startDragExportPrepared` until App has written the temp file; a premature drag shows a "still preparing" toast instead of silently doing nothing. (Pop-out keeps `dragReady` default true — main owns its prep via the round-tripped `selection-change`.)
  * **Real drag icon**: `ipc.ts` now passes the 32px app icon to `startDrag` (`dragIcon()` from `icon-assets`) instead of a 1×1 transparent PNG, which some Windows builds treat as "empty" and abort the drag on.
  * Snippet temp files renamed with a millisecond stamp so a fast re-selection can't collide.
  * **Still open**: sample-accuracy of the WAV slice is only as good as `export-engine.ts`'s decode-vs-`newestSec` mapping (todo §11.4 Phase 3); Phase 5 (right-click "save selection" + `s` key) not started.
* **Four new themes: aqua / sakura / lime / dark-lime (done 2026-09-07)** (user supplied reference screenshots): added to `Theme` (`src/shared/types.ts`), `.theme-*` token blocks (`styles.css`, added to the legacy-alias selector list), `palette()` + `drawBackground()` + `RAMPS` (`visualizer.ts`, new `GLOW_THEMES` set feeds the oscilloscope bloom). **Aqua** = vivid spring-green trace on a glowing dark-teal ground (bumped brighter + a canvas radial bloom after the user posted a refined ref), cyan accents. **Sakura** = a dark version of kawaii — orchid trace on wine-plum, lavender LIVE pill + accents, high radius. **Lime** = vivid `#39ff5a` on green-tinted near-black. **Dark-lime** = same lime on pure black, minimal chrome / no blur. Theme count 6 → 10.
  * **One theme list, shared:** new `THEMES` export in `src/shared/types.ts` ({value,label,swatch}). Both `SettingsPanel` and the **right-click quick-menu** Theme submenu (`ipc.ts`, was a hard-coded 6-item list — that's why new themes didn't show there) now map over it, so they can't drift.
  * **Blood-red**: near-black + deep crimson, high-saturation `#ff1024` trace, red→pink Save. **Nocturnal**: deep indigo midnight studio — periwinkle `#5b7fff` trace, cyan-blue LIVE pill. **Black-ice** (was the deleted "dark-lime", renamed + restyled per a new ref): pure black + icy pale-cyan `#c4f4fc` trace, faint cyan bloom, minimal chrome. **Dark-lime deleted** (`settings.ts` migrates it → `black-ice`).
  * **Iteration pass (2026-09-07):** removed the big radial "spotlight" blooms the first cut added to the canvas (user: *"a lot of glow added inside the visualizer"*) — new themes now use clean flat-ish gradients like the originals, only black-ice keeps a very faint bloom. Aqua re-tuned twice against updated refs (dark clean teal, not a glow blob). Lime + blood-red saturation bumped. Sakura pushed from muted-orchid → vivid fuchsia with a `.chip.on` contrast override (bright fill + dark text). Theme count **13**.
* **Changing theme reset the open visualizers (fixed 2026-09-07)** (user: *"changing the theme seems to reset what visualizers are open"*): the `readSettings()` split/single migration re-fired on **every read** for anyone with all 4 visualizers open (`vizHidden: []` — a legit "everything open" state now, but the old guard read it as "old file needs collapsing"). Any settings write (incl. a theme change → `writeSettings({...readSettings(), theme})`) re-collapsed the board to one pane. Now guarded on `'vizGrid' in p` — the key only exists in genuinely old files, and it's `delete`d after the one-time collapse.
* **HUD status row final pass (done 2026-09-07)** (user: *"Remove the progress bar next to ROLLING … Same with the ROLLING text. Make the time slightly bigger and move it into the border next to LIVE. Then move the Format changer to where ROLLING was."*): `BufferStrip` **deleted** (the scrolling-waveform strip); `.hud-mode` ("rolling" text) gone. The buffer time (`m:ss` / `m:ss / m:ss` while filling, `--accent-bright` when full) is now a mono 13px segment fused to the right of the `● LIVE` pill as one connected capsule (`.hud-live` + `.hud-live:has(.hud-buffered) .pill` squares the pill's right edge). The **`FormatPicker` moved from the footer into the status row** (`compact`, so just the `MP3 ▾` trigger) where "ROLLING" used to sit; its popover opens **downward** in the HUD and `.hud` got `position:relative; z-index:20` so it clears the board (was rendering behind the visualizer). The LIVE + time capsule is one `.hud-live` wrapper carrying a single state-coloured border (green when capturing) with a thin divider — the pill/time drop their own borders (`:has()`-based). Footer is now just device-picker + mode chips.
* **Bottom UI tidied + rounded bottom corners (done 2026-09-07)** (user: *"do the same [as the HUD] with the bottom … make the two bottom corners rounded, leave the top as is"*): `.sidebar` (footer) went from a 3-column grid with a stretched picker column + a full-width helper line to a **tight flex row** — device picker (icon + name, `max-width:360`), mode chips, then `FORMAT` pushed right; the "OUTPUT DEVICE" label and the "WASAPI loopback — …" helper `<small>` are gone (helper → `title` tooltip); padding tightened. Rounded corners: the custom-titlebar main window is now `transparent: true` (`index.ts`) so `.app.has-custom-titlebar` can `border-radius: 0 0 12px 12px` (top stays square); dropped when maximised (`.is-maximized`, fed by a new `onWindowState` sub in `App.tsx`). `html:has(.app.has-custom-titlebar)` zeroes the body/#root background so nothing paints an opaque rect behind the rounding.
* **VU meter removed (done 2026-09-07)** (user: *"remove this thing it seems kinda random"*): the little inline level bar in the HUD status row is gone — it was redundant next to the new buffer waveform and the big visualizer. Deleted from `HUD` (+ the `rms` prop), all `.hud-vu`/`.vu-bar` CSS, the `showVu` setting + its Settings toggle.
* **Title-bar recording dot themed (done 2026-09-07)**: `.tb-dot.on` used a hard `var(--danger)` (red/pink in every theme); now `var(--rec)` like the clip window — the user dislikes a red recording cue, and it was the same magenta dot across all 10 themes.
* **Quick knobs moved to the right of the title bar (done 2026-09-07)** (user: *"these buttons must be on the right side … since they are there in main view"*): `TitleKnobs` was stuck to the `recordr` wordmark on the left; now it sits after the flex spacer, grouped with the ▲/↥/⧉/⚙ + window buttons. Same in the pop-out drag strip (`.popout-drag .tb-ctls { margin-left: auto }`).
* **Rolling buffer: scrolling waveform, not a "fill to FULL" bar (done 2026-09-07)** (user: *"feels pointless watching it just get to FULL … makes me feel like i need to unclear it"*; picked "sliding waveform strip" from the options): the `<progress>` bar (which read as a task completing) is replaced by **`components/BufferStrip.tsx`** — a ~168px canvas drawing the buffered window's peak envelope from `cs.historyModel.columnPeaks(0, count, W)`. While the ring is still filling it occupies only the right part of the strip and grows left; once full it's the whole strip and the content slides left as new audio arrives on the right (oldest bucket falls off) — it never "completes". Readout is `↺ 2:00` when full, `1:12 / 2:00` while filling. Also clarified for the user (this stumped them twice): the ring **never resets** — it's a continuously sliding window, so every moment has a rolling 2-min (or whatever) grace period from when *it* played, not a clock-synced flush. Old `.hud-buffer progress` CSS (incl. classic/kawaii overrides + the 420px hide) swapped for `.hud-buffer-canvas`.
* **Clip window was an opaque black rectangle (done 2026-09-07)** (user: *"This popup window shouldnt have a background it should be like this"*): `html, body, #root { background: var(--bg) }` made the transparent clip window paint solid. `main.tsx` now adds `html.clip-route` for the `#clip` hash and a CSS rule zeroes those three backgrounds; the pill (`.clip-hud`) keeps its own near-opaque `#0b0e17` card bg (dropped `backdrop-filter` — renders black on transparent windows on some GPUs). Also: `.clip-window` lost `overflow:hidden` (was clipping the overhanging ✕) + gained `padding:12px 14px`, and the OS window grew `240×128` → `258×140` so the ✕ has room.
* **HUD collapsed to a single row (done 2026-09-06)** (user: *"top part of the apps main view has a lot of empty space… trim down the empty unused space and style it a bit better"*): the HUD was a 4-row CSS grid (status / VU / actions / hotkey-hint) that stacked ~90px of mostly-empty vertical space on a normal-height window. Now it's **one flex row** — `[● LIVE] rolling [buffer ▓▓░ full·2:00] [vu]` on the left (grows), `[Alt+R]` + the transport on the right — wrapping only when truly out of width (`.hud-error` still gets its own line). The VU moved inline into `.hud-status` as a compact 96px meter; the hotkey hint is now a small mono `<kbd>` beside the transport instead of its own row; `.hud` padding tightened (`clamp(6px,.9vw,10px)` vs `clamp(8px,1.8vw,16px)`); the buffer readout is mono and goes `--success` green when full; `button.primary.big` trimmed `10/18`→`7/15`. The `max-height:460px` breakpoint that already did a flex row is now just an extra-tight variant of the default.
* **Clip recorder: hotkey + always-on-top window (done 2026-09-06)** (user: *"a recording clip popup animation with a little timer beneath it… a stop button… shouldn't interact or stop the rolling buffer at all… make the hotkey … the hot key for recording clips"*, then *"it needs to be an always on top pop up … regardless of the application being invisible or minimized … docked or popped out"*, *"make it (Right-Alt+R)"*):
  * **Hotkey → clip** in rolling mode: `App.handleHotkey` → `toggleClipRecording(true)` (start, or stop-and-save with no prompt). Traditional mode's hotkey unchanged. Clips never touch the rolling buffer.
  * **Default hotkey `Shift+Alt+R` → `Alt+R`** (`DEFAULT_SETTINGS.hotkey`, `settings.ts` migrates the old default, `SettingsPanel` presets updated). NB: Electron/Windows `globalShortcut` **can't distinguish left vs right Alt** (no such accelerator token; `AltGr` is layout-specific and doesn't fire from a plain US-layout RAlt). `Alt+R` is the closest reliable binding — it catches Right-Alt+R (and Left). True RAlt-only would need a low-level keyboard hook.
  * **`ClipHUD.tsx`** — the panel: pulsing `--rec` dot (neon green in the default theme; user dislikes a red cue), "RECORDING CLIP" + format tag, big `m:ss.d` timer, **Stop & save** pill, small ✕ (discard).
  * **`src/main/clip-window.ts` + `ClipWindowApp.tsx` (`index.html#clip`)** — the panel lives in its **own always-on-top OS window** now (not a DOM overlay), so it's visible whatever the app is doing: minimised, hidden to the tray, docked, popped out. Transparent/frameless/`skipTaskbar`, `alwaysOnTop('screen-saver')` + `setVisibleOnAllWorkspaces(…, {visibleOnFullScreen:true})`, shown with `showInactive()` (never steals focus), draggable. It owns no state — `App.tsx` pushes `{active,startedAt,format,theme}` over `IpcChannel.clipWindowSet` whenever clip state changes; the window relays its two buttons back as `viz:command` `toggle-clip`/`discard-clip` (main forwards to the main renderer, same path as the pop-out). Destroyed on `before-quit`. The in-DOM `ClipHUD` was removed from `App`/`PopoutApp`.
  * The HUD record button + pop-out clip button also stop-and-save without the `confirm()` now (the ✕ is discard); `alert('pick a save folder')` → toast (the hotkey can fire while the main window is hidden).
* **Quick knobs (format / sensitivity / buffer) now in the pop-out too (done 2026-09-06)** (user: *"these buttons must also show when the app is docked"* — docking the main window opens the pop-out, which had no knobs): extracted the 3 title-bar knobs into `components/TitleKnobs.tsx`, used by both `TitleBar` and the pop-out's `.popout-drag` strip. Trimmed to 16px in the pop-out; the same `max-width:700/430` breakpoints (own viewport) drop gain/buffer then format on a narrow pop-out, with the right-click quick menu as the fallback.
* **Every visualizer flickered while popped out / docked (done 2026-09-06)** (user: *"causes all of the visualizers to kind of flicker... only happens if the application is in the pop out mode or if its docked"*): the pop-out rebuilt `HistoryModel` from every `viz:history` frame (~5×/s) and re-rendered to pass the new object down. `VisualizerBoard`'s rAF-draw `useEffect` had `historyModel` (and `selection`) in its **deps**, so it tore the whole loop down and rebuilt it 5×/s — and `fit()` reassigns `canvas.width`, which wipes the bitmap → a blank frame each time, on every pane. Fixes: (1) the draw loop reads `historyModel`/`selection`/`viewport` from **refs**, deps trimmed to stable values; (2) `fit()` only assigns `canvas.width/height` on a real size change; (3) new `HistoryModel.restamp(newestSec)` — the pop-out mutates the existing model in place instead of `new`-ing one, and only re-renders on the first history frame (to mount the interaction layer). Docking the main window routes through the same pop-out path, hence "only when popped out or docked".
* **Highlight/drag-out on the spectrogram + in split view (done 2026-09-06)** (user: *"now we just need the highlight drag drop to work in the split view too"* + *"wondering if we can have the drag drop snippet thing in the spectrogram too"*):
  * **Spectrogram is now a real time axis.** `drawSpectrogram` scrolls by **wall-clock time** instead of per-frame: `SPECTRO_VISIBLE_SEC` (15) of audio spans the full width, `col = floor((now - lastAdvanceMs) / msPerCol)` advances the offscreen buffer, so an x-pixel maps to an exact timestamp (`newestSec - (1-f)·15s`) and survives frame-rate changes / the window being hidden (backlog > width → one full repaint + snap the clock to now). Look is unchanged (~15 s window, same as before).
  * **`VisualizerBoard`** — the History selection/drag layer generalised to any *timeline* mode (`isTimeline = history || spectrogram`). New `timelineView(model, viewport, mode)` returns `[newestSec-15, newestSec]` for the spectrogram (fixed, always-following; no zoom/pan — nothing outside the window exists) and `model.effectiveViewport()` for history. Pan / wheel-zoom / `+`/`−` stay history-only; select + drag-out work on both. Selection is still absolute session seconds, so `exportSelection` slices it the same way no matter which mode drew it.
  * **Split view** — the History **and** Spectrogram panes are now `interactive` in the mosaic (main window and pop-out), wired to `handleSelectionChange` / the pop-out's `selection-change` command. Other panes stay read-only overviews. The `viz:history` stream to the pop-out now runs whenever *either* history or spectrogram is on the shared board (the spectrogram's selection layer needs the same `newestSec` stamp).
* **HUD buffer gauge looked like a frozen timer (done 2026-09-06)** (user: *"TIMER SEEMS TO BE STUCK ON 1:58"*): a full rolling buffer sits a chunk-length shy of the cap forever (`1:58 / 2:00`), which reads as stuck. At ≥97 % the label now snaps to `full · 2:00` with a `is-full` class + a tooltip explaining the last N minutes are always kept and older audio rolls off.
* **Settings panel drifted from live settings (done 2026-09-06)** (user: *"the format is set to mp3 but when i look at settings it says WebM"*): `SettingsPanel` kept a `draft` copy seeded once from the `settings` prop and, on **Save**, wrote the *entire draft object* back — so any setting changed elsewhere while the panel was open (the footer format picker, the quick menu, the pop-out, the tray) was invisible in the panel and got **reverted on Save**. Now: a `dirty` ref tracks only the keys actually edited in the panel; a `useEffect([settings])` re-syncs every non-dirty key from the live settings; `save()` writes just the dirty keys as a patch; `applyNow()` clears a key's dirty flag. Also: the Settings "Default visualizer" chips are now live on/off toggles matching the footer chips (was a Save-time radio that set `vizHidden`).
* **Pop-out theme stuck on "modern" after docking — FIXED (2026-09-06)** (user: *"when i hit the dock to top button it seems to sometimes go back to the modern theme"*): `PopoutApp` computed `theme = state.theme ?? settings.theme`, but `state.theme` is `DEFAULT_STATE.theme` (`'modern'`, always truthy) until the first `viz:frame` lands — and docking opens a fresh pop-out, so there's a window where no frame has arrived. Now just `theme = settings.theme` (kept correct by `useSettings`'s `settings:changed` mirror). NB: the main window's ⤒ / "Dock to top" still *opens the pop-out* rather than docking the main window itself — see the "Ultra-compact Docked Mode" bullet above for the real fix the user wants.
* **Format-picker popover text clipped (done 2026-09-06)** (user screenshot: "We…" / "WA…" / "M…"): `.dd-popover.dd-popover-tight` now `left:auto; min-width:200px; width:max-content; max-width:260px` so it grows leftward off the narrow "MP3 ▾" trigger instead of collapsing to its width.
* **Theme atmosphere pass — cyberpunk / synthwave / kawaii — REVERTED (2026-09-04)**: the original (done) entry read: visual deepening of the three personality themes only; `modern`, `classic`, `monochrome` untouched. Cyberpunk & synthwave previously had *zero* component-level CSS (pure token/canvas swaps on generic chrome); a new **THEME ATMOSPHERE PASS** block at the very end of `styles.css` gives them real material treatment: lit-glass HUD/sidebar gradients, gradient-clipped title-bar text, neon board framing + capture-ring shadows, luminous chips/`.on` states, gradient primary buttons, glassy modals/popovers, tinted hover states, and tinted hover-only pane tags — covering both `.app.theme-*` and `.popout.theme-*`. Kawaii deepened its candy-glass: richer 4-radial window background, gradient-clipped title text, layered pastel board glow, pink-gradient `.on` chips, light pane tags, and the pop-out now uses `var(--bg-gradient)` instead of flat `#fff0f7`. Canvas side (`fillThemeBackground` in `src/renderer/lib/visualizer.ts`) got brighter multi-stop bases and stronger/extra signature glows for all three (cyberpunk adds a magenta + centre-yellow glow; synthwave a magenta centre; kawaii gains soft pink/lavender/mint radials on a vertical pastel base). Colour/gradient/glow only, no layout or markup changes; all other themes' canvases identical. Follow-up (same day): cyberpunk & synthwave **spectrogram ramps brightened** (signature hues preserved — magenta→yellow→cyan / purple→pink→orange — but each stop now climbs hotter toward near-white peaks), and the **oscilloscope got a signature two-pass neon glow** (`drawOscilloscope`): a wide soft halo in the secondary hue (cyan under cyberpunk's yellow trace, hot-pink under synthwave's orange) painted first, then the bright core on top with its tight 12px glow. Three first-pass contrast regressions were corrected by the numbers (agent can't see pixels): kawaii `.on` chips went from white-on-pastel to dark plum `#6b2d56` on a deeper pastel gradient, kawaii title text deepened (mint/pale-pink end too light at 10px), synthwave primary buttons switched white → dark `#1d0a33` text. Next step for a future pass: have the user eyeball the three themes in `npm run dev` at full/docked sizes and iterate — the first pass was done blind (no visual check available to the agent), and a dev run needs the running packaged `Recordr.exe` closed first (single-instance lock). **⚠ Rolled back the same day** (user: “revert the themes back”, after a live dev review): the whole pass above *and* the follow-up ramp-brightening / oscilloscope-halo / contrast fixes were removed — cyberpunk, synthwave and kawaii are back to their pre-pass appearance, in both windows and on canvas. Exactly what was restored: (1) `styles.css` — the appended `THEME ATMOSPHERE PASS` block deleted; the only theme-scoped addition left in the file is `.app.theme-kawaii .tb-ctl:hover` (belongs to the title-bar knobs feature, kept). (2) `visualizer.ts` — `fillThemeBackground` (multi-stop bases + radial signature glows, exported for the idle placeholder) reverted to the original private `drawBackground` flat gradients (cyberpunk `#1a0524→#0f0518`, synthwave `#2b1055→#140c28`, kawaii `#fff8fc→#ffeaf5→#f2e6ff`); cyberpunk/synthwave `RAMPS` restored to their original stops; the two-pass neon halo in `drawOscilloscope` removed (shadow/line-width logic back to original; the `gain` sensitivity plumbing predates the pass and was kept); cyberpunk/synthwave gradient spectrum bars removed (fall through to `p.bar` again). (3) `VisualizerBoard.tsx` — idle placeholder paints its original local gradient again instead of `fillThemeBackground`. Typecheck green. Lesson: theme work must be reviewed by the user's eyes in `npm run dev`; do small slices, not whole-theme blind passes.
