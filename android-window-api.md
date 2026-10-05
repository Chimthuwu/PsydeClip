# Window API Interface for Android Implementation

Based on analysis of `src/preload/index.ts` and usage in `src/renderer/`, the `window.api` object exposes the following methods that would need to be implemented for a browser-based Android version:

## Core API Methods

### Settings Management
- `getSettings(): Promise<AppSettings>`
- `setSettings(patch: Partial<AppSettings>): Promise<AppSettings>`

### Source Enumeration
- `listSources(): Promise<CaptureSource[]>`

### Recorder Control
- `startRecording(): Promise<void>`
- `stopRecording(): Promise<void>`
- `toggleRecording(): Promise<void>`

### Save Functionality
- `saveRecording({ path, bytes, fileName }): Promise<SaveResult>`

### Hotkey Management
*(Likely handled through registration/unregistration)*

### Window State
- `onWindowState(callback: (state: { maximized: boolean }) => void): UnsubscribeFunction`
- `setAlwaysOnTop(state: boolean): Promise<void>`
- `toggleAlwaysOnTop(): Promise<void>`

### File Operations
- `prepareDragFile({ bytes, ext }): Promise<string>` - returns file path for drag operations
- `openItemInFolder(path: string): Promise<void>`
- `showItemInFolder(path: string): Promise<void>`
- `openPath(path: string): Promise<void>`

### Popout Window
*(Related to detaching visualizer)*

### Clip Recording
- `beginClip(): Promise<void>`
- `endClip(): Promise<void>`
- `toggleClip(): Promise<void>`

### Visualizer Controls
*(Commands sent to popout window)*

### Theme/Layout
- Various getters/setters for UI preferences

## Implementation Approach for Android

For a Capacitor-based solution:
1. Create a Capacitor plugin that exposes these methods as native calls
2. Implement the underlying functionality using Android APIs:
   - Audio playback capture (API 29+) for system audio recording
   - Foreground service for persistent background recording
   - Notification center for ongoing recording indicator
   - File system access for saving recordings
   - Shared preferences or similar for settings persistence
   - Intent system for sharing/opening files

## Reused Components from Recordr
As noted in the TODO:
- Visualizer maths (from `lib/visualizer.ts`)
- Rolling-buffer model
- Filename template
- Settings shape

## Next Steps
1. Set up Capacitor project
2. Implement window.api plugin using Android AudioPlaybackCapture
3. Create basic UI that mirrors Recordr's core functionality
4. Implement settings persistence
5. Add recording visualization (reusing visualizer math)
6. Implement save/download functionality
7. Add hotkey equivalent (possibly through notification tap or widget)

## Estimated Work
This approach requires implementing most of the browser port work (as noted in TODO), but avoids maintaining a separate web version since nothing is served publicly - the Capacitor shell contains the web assets.
