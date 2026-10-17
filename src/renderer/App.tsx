import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { HUD } from './components/HUD';
import { TitleBar } from './components/TitleBar';
import { Transport } from './components/Transport';
import { VisualizerBoard } from './components/VisualizerBoard';
import { SourcePicker } from './components/SourcePicker';
import { FormatPicker } from './components/FormatPicker';
import { SettingsPanel } from './components/SettingsPanel';
import { ToastStack } from './components/ToastStack';
import { VizIcon } from './components/VizIcon';
import { encodeFromBlob, encodeFromPcm } from './lib/encode';
import { transcribeSavedRecording } from './lib/transcribe';
import {
  getNoteLayer,
  putNoteLayer,
  rangeLabel,
  selectionKey,
  clearNoteLayers,
  type NoteLayer,
} from './lib/note-store';
import { useSettings } from './hooks/useSettings';
import { useCapture } from './hooks/useCapture';
import { useRecorderEvents } from './hooks/useRecorderEvents';
import { SMOOTHING_FOR_MODE } from './lib/visualizer';
import { AppSettings, VisualizerMode, VISUALIZER_MODES, VISUALIZER_LABELS } from '../shared/types';
import { CLIP_STOP_PROMPT } from '../shared/utils';
import { visibleNotes } from '../shared/piano-roll';

const LOOPBACK_SUPPORTED_PLATFORMS = new Set(['win32']);

/** Pop-out frame rate. 30fps is plenty for a visualizer and a third of the
 *  IPC traffic of streaming every animation frame. */
const VIZ_FRAME_MS = 33;

export default function App() {
  const { settings, loaded, update } = useSettings();
  const [capturing, setCapturing] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // A single visualizer pinned into the pop-out window (a split pane's ⧉).
  // Transient, not a setting — the pop-out normally mirrors the main window.
  const [popoutOverride, setPopoutOverride] = useState<VisualizerMode | null>(null);
  const capture = useCapture(settings, capturing);
  const { state: cs, beginClip, endClip, discardClip, clearBuffer } = capture;
  // When the clip button was pressed (0 = no clip has been recorded in this
  // render). State, not a ref, so a change re-renders and feeds the live
  // elapsed-time display on the record button.
  const [clipStartedAt, setClipStartedAt] = useState(0);
  // Live seconds since the clip started, ticked while a clip is active.
  const [clipElapsed, setClipElapsed] = useState(0);
  // True while a clip stop/save is in flight (see toggleClipRecording).
  const clipBusyRef = useRef(false);
  // True while a traditional-mode Stop is stopping + saving. Guards against a
  // double-click calling MediaRecorder.stop() twice (the second one throws).
  const stopSaveBusyRef = useRef(false);

  const loopbackSupported = LOOPBACK_SUPPORTED_PLATFORMS.has(window.api.platform);

  // Maximised → drop the rounded bottom corners (they'd leave transparent gaps
  // at the screen edge). Also gates the transparent-window corner rounding.
  const [maximized, setMaximized] = useState(false);
  useEffect(() => window.api.onWindowState((s) => setMaximized(s.maximized)), []);

  const emitToast = (kind: 'saved' | 'error', message: string) =>
    window.dispatchEvent(new CustomEvent('recordr:local-toast', { detail: { kind, message } }));

  /**
   * Write already-encoded bytes and surface a toast.
   *
   * This is the single funnel every save path goes through (rolling export,
   * clip, traditional stop), so MIDI transcription hooks in HERE rather than at
   * each call site: one place to reason about, and no path can forget it.
   *
   * `bytes` is optional-but-needed for transcription: when we have the decoded
   * mono PCM already (rolling export path) pass `samples` instead and skip the
   * redundant decode.
   */
  async function writeRecording(
    bytes: Uint8Array,
    ext: string,
    durationSec: number,
    pcm?: { samples: Float32Array; sampleRate: number },
  ): Promise<boolean> {
    const res = await window.api.saveRecording({
      folder: settings.saveFolder,
      bytes,
      ext,
      durationSec,
      deviceName: selectDeviceName(),
    });
    if (res.ok) {
      emitToast(
        'saved',
        `Saved ${(res.bytes! / 1024).toFixed(1)} KB (${durationSec.toFixed(1)}s)\n${(res.path ?? '').split(/[\\/]/).pop()}`,
      );
      // Fire-and-forget AFTER the success toast: the audio is on disk and the
      // recording is complete. Nothing below can undo that.
      if (settings.transcribeOnSave && res.path) {
        // Show the notes in the piano-roll lane too, not just the toast + the
        // .mid on disk — the always-on MIDI toggle should feel like it did
        // something visible, not just drop a file silently (todo.md §MIDI-1
        // UX fix). Best-effort absolute-time placement: "the last durationSec
        // up to right now", which is exact for a rolling export and close
        // enough for a clip/traditional stop (both just finished).
        const endSec = cs.historyModel?.newestSec ?? durationSec;
        const startSec = Math.max(0, endSec - durationSec);
        const label = rangeLabel(startSec, durationSec);
        void transcribeSavedRecording(
          { audioPath: res.path, ...(pcm ?? { bytes }) },
          {
            emitToast,
            onSettled: (state) => {
              if (state.status !== 'done' || !state.notes?.length) return;
              const layer: NoteLayer = { startSec, durationSec, notes: state.notes, label };
              setNoteLayer(layer);
            },
          },
        );
      }
    } else {
      emitToast('error', res.error ?? 'Save failed');
    }
    return res.ok;
  }

  /** Encode a WebM/Opus blob to the selected format, then write it. */
  async function encodeAndWriteBlob(blob: Blob, durationSec: number): Promise<boolean> {
    if (blob.size === 0) return false;
    const fmt = settings.recordingFormat;
    try {
      if (fmt !== 'webm') emitToast('saved', `Encoding ${fmt.toUpperCase()}…`);
      const enc = await encodeFromBlob(blob, fmt, settings.bitrateKbps);
      return await writeRecording(enc.bytes, enc.ext, durationSec);
    } catch (e: any) {
      emitToast('error', `Encode failed: ${e?.message ?? e}`);
      return false;
    }
  }

  /**
   * Save the current rolling buffer (or a [start,end] crop of it, expressed
   * in ABSOLUTE session seconds). Phase 3 sample-accurate export.
   */
  async function saveCurrent(bounds: [number, number] | null): Promise<boolean> {
    if (!cs.recorder) return false;
    if (!settings.saveFolder) {
      alert('Pick a save folder in Settings first.');
      return false;
    }
    const fmt = settings.recordingFormat;

    try {
      if (fmt !== 'webm') emitToast('saved', `Encoding ${fmt.toUpperCase()}…`);
      // Let the toast paint before the encoder blocks the main thread.
      await new Promise((r) => setTimeout(r, 16));
      
      const { exportSelection } = await import('./lib/export-engine');
      const res = await exportSelection(cs.recorder, cs.historyModel ?? null, bounds, fmt, settings.bitrateKbps);
      return await writeRecording(res.bytes, res.ext, res.durationSec);
    } catch (e: any) {
      emitToast('error', `Encode failed: ${e?.message ?? e}`);
      return false;
    }
  }

  // Hotkey handler — mode-aware:
  //  - rolling:      start / stop-and-save a clip (independent of the rolling
  //                  buffer — it is never touched). Stopping via the hotkey
  //                  saves without the keep/discard prompt; the clip panel has
  //                  an explicit ✕ to discard instead.
  //  - traditional:  if currently recording -> stop and save; otherwise start.
  async function handleHotkey() {
    if (settings.recordMode === 'rolling') {
      await toggleClipRecording(true);
      return;
    }

    if (!cs.recorder) {
      // No source bound yet. Fall back to: just toggle capturing on.
      if (settings.sourceId) setCapturing(true);
      return;
    }

    if (cs.recorder.isActive()) {
      // Stop & auto-save.
      const blob = await cs.recorder.stop();
      const dur = cs.recorder.bufferedDuration();
      if (settings.saveFolder) await encodeAndWriteBlob(blob, dur);
      setCapturing(false);
    } else {
      setCapturing(true);
    }
  }

  /** Pick a friendly device/source name for the {device} filename token. */
  function selectDeviceName(): string | undefined {
    if (settings.captureBackend === 'loopback' && settings.loopbackDeviceId) {
      const d = cs.loopbackDevices.find((x) => x.id === settings.loopbackDeviceId);
      return d?.name;
    }
    if (settings.sourceId) {
      const s = cs.sources.find((x) => x.id === settings.sourceId);
      return s?.name;
    }
    return undefined;
  }

  const selectionRef = useRef<[number, number] | null>(null);

  // Manually-triggered save (always a snapshot). Only meaningful in rolling mode.
  // A History selection is only honoured when History is the sole visible board
  // (the mosaic panes are read-only, so there's no selection to crop to).
  async function performSave() {
    const shown = VISUALIZER_MODES.filter((m) => !settings.vizHidden.includes(m));
    const soleHistory = shown.length === 1 && shown[0] === 'history';
    const bounds = soleHistory ? selectionRef.current : null;
    await saveCurrent(bounds);
  }

  /**
   * Save exactly the current selection — the quick menu's "Save selection"
   * item and the `s` key.
   *
   * Deliberately distinct from performSave() (the HUD's manual save, which
   * saves the whole rolling window unless History happens to be the only
   * visible board): a menu item that says "Save selection" has to mean it, and
   * a selection can now come from the spectrogram or a mosaic pane too.
   */
  async function saveSelection() {
    const sel = selectionRef.current;
    if (!sel) {
      emitToast('error', 'Nothing selected — drag across the waveform first.');
      return;
    }
    await saveCurrent(sel);
  }

  /**
   * Dedicated record button: press once to start an isolated clip recording
   * (only the clip's own seconds accumulate, nothing from the rolling buffer),
   * press again to stop — asking whether to keep (save) or discard it. Works
   * in any mode, even with the rolling recorder idle.
   *
   * `skipAsk` is used for pop-out-invoked stops: the pop-out window asks its
   * own confirm() (it may be the only window on screen — the main window can
   * be hidden), so asking again here would double-prompt.
   */
  async function toggleClipRecording(skipAsk = false) {
    // Guard against a double-click starting a phantom second clip while the
    // first is still being stopped (stop → save is async).
    if (clipBusyRef.current) return;
    clipBusyRef.current = true;
    try {
      if (cs.clipActive) {
        const keep = skipAsk || window.confirm(CLIP_STOP_PROMPT);
        if (!keep) {
          await discardClip();
          emitToast('saved', 'Clip discarded.');
          return;
        }
        // The clip was streamed chunk-by-chunk to a temp file as it recorded;
        // endClip reads it back once, then the temp file is deleted. WebM is a
        // direct passthrough; WAV/MP3 decode the whole (clip-sized) stream and
        // re-encode it. Either way the save is a single transient read+write,
        // not a growing in-memory buffer.
        const bytes = await endClip();
        const dur = Math.max(0.1, (Date.now() - clipStartedAt) / 1000);
        if (!bytes) {
          emitToast('error', 'Clip was empty — nothing to save.');
          return;
        }
        if (settings.recordingFormat === 'webm') {
          await writeRecording(bytes, 'webm', dur);
        } else {
          try {
            emitToast('saved', `Encoding ${settings.recordingFormat.toUpperCase()}…`);
            // `bytes.slice()` copies onto a fresh ArrayBuffer — the IPC bytes
            // are Uint8Array<ArrayBufferLike> and Blob wants ArrayBuffer-backed.
            const enc = await encodeFromBlob(
              new Blob([bytes.slice()], { type: 'audio/webm' }),
              settings.recordingFormat,
              settings.bitrateKbps,
            );
            await writeRecording(enc.bytes, enc.ext, dur);
          } catch (e: any) {
            emitToast('error', `Encode failed: ${e?.message ?? e}`);
          }
        }
        return;
      }
      if (!settings.saveFolder) {
        // A toast, not alert() — the hotkey can fire this while the main
        // window is hidden behind the pop-out, where a modal would just block.
        emitToast('error', 'Pick a save folder in Settings before recording a clip.');
        return;
      }
      if (!cs.stream) {
        emitToast('error', 'No audio source bound yet — pick one first.');
        return;
      }
      if (await beginClip()) setClipStartedAt(Date.now());
    } finally {
      clipBusyRef.current = false;
    }
  }

  /** Pop-out "discard" command: stop the clip and delete its temp file.
   *  (The pop-out asked the user already; here we just carry it out.) */
  async function discardClipRecording() {
    if (clipBusyRef.current || !cs.clipActive) return;
    clipBusyRef.current = true;
    try {
      await discardClip();
      emitToast('saved', 'Clip discarded.');
    } finally {
      clipBusyRef.current = false;
    }
  }

  // True once a temp file for the current selection is written and a drag-out
  // would actually produce something. Reset the moment the selection changes.
  const [dragReady, setDragReady] = useState(false);
  const dragSeqRef = useRef(0);

  // The note layer the MIDI view is drawing, mirrored into a ref so the
  // selection handler (declared above the layer state) can read it.
  const midiLayerRef = useRef<NoteLayer | null>(null);

  const handleSelectionChange = useCallback(async (sel: [number, number] | null, selMode: VisualizerMode = 'history') => {
    selectionRef.current = sel;
    // Tell main, so the native quick menu can offer "Save selection (Ns)" from
    // either window — including the pop-out, where the main window is hidden.
    window.api.selectionChanged(sel);
    const seq = ++dragSeqRef.current;
    setDragReady(false);
    if (!sel) return;
    if (selMode === 'midi') {
      // A stretch of notes, rebased so the .mid starts at zero, dragged out as MIDI.
      const [s0, s1] = sel;
      const layer = midiLayerRef.current;
      const notes = layer
        ? visibleNotes(layer.notes, s0, s1).map((n) => {
            const start = Math.max(n.startSec, s0);
            const end = Math.min(n.startSec + n.durationSec, s1);
            return { ...n, startSec: start - s0, durationSec: end - start };
          })
        : [];
      if (seq !== dragSeqRef.current) return;
      if (notes.length === 0) {
        emitToast('error', 'No notes in that range — try a wider selection.');
        return;
      }
      try {
        const bytes = await window.api.notesToMidi(notes);
        if (seq !== dragSeqRef.current) return;
        window.api.prepareDragFile({ bytes, ext: 'mid' });
        setDragReady(true);
      } catch (e: any) {
        console.error('Failed to prepare MIDI drag file:', e);
        emitToast('error', `Couldn't prepare those notes: ${e?.message ?? e}`);
      }
      return;
    }
    if (!cs.recorder || !cs.historyModel) return;
    try {
      const { exportSelection } = await import('./lib/export-engine');
      // What gets dragged OUT is always WAV: it's the only sample-accurate
      // format here and the one every DAW imports (WebM/Opus is on no DAW's
      // list). The manual Save button still honours the chosen format.
      const dragFmt = settings.recordingFormat === 'mp3' ? 'mp3' : 'wav';
      const res = await exportSelection(cs.recorder, cs.historyModel, sel, dragFmt, settings.bitrateKbps);
      if (seq !== dragSeqRef.current) return; // a newer selection superseded this
      if (res.bytes.length === 0) {
        emitToast('error', 'Nothing captured in that range yet — try a wider selection.');
        return;
      }
      window.api.prepareDragFile({ bytes: res.bytes, ext: res.ext });
      setDragReady(true);
    } catch (e: any) {
      console.error('Failed to prepare drag file:', e);
      emitToast('error', `Couldn't prepare that snippet: ${e?.message ?? e}`);
    }
  }, [cs.recorder, cs.historyModel, settings.recordingFormat, settings.bitrateKbps]);

  // The notes the piano-roll lane is currently drawing, in ABSOLUTE session
  // seconds (todo.md §MIDI-1 Phase A). Null = no lane.
  const [noteLayer, setNoteLayer] = useState<NoteLayer | null>(null);
  const noteBusyRef = useRef(false);

  /**
   * Clear the rolling buffer AND everything derived from it (owner, 2026-10-13):
   * peaks, session clock, note layers/preview, and the current selection (a
   * selection into a wiped buffer is a lie). Runs from the main window's
   * clear button and from the pop-out's over the command bus.
   */
  const clearBufferAll = useCallback(() => {
    clearBuffer();
    clearNoteLayers();
    setNoteLayer(null);
    void handleSelectionChange(null);
    emitToast('saved', 'Buffer cleared.');
  }, [clearBuffer, handleSelectionChange]);

  /**
   * What the grid actually draws: a real transcription when there is one, and
   * otherwise the live YIN preview (todo.md §MIDI-1 Phase B).
   *
   * A transcription wins outright and the preview is dropped — that is the
   * colour change you asked for, and it is also just true: Basic Pitch is the
   * accurate, polyphonic answer, the tracker is a monophonic estimate.
   *
   * Built with useMemo rather than state, and reading the tracker's live
   * `notes` array BY REFERENCE: the array is mutated in place by the 20 Hz
   * analysis loop, and the board's rAF loop reads it directly every frame. So
   * drawing a live melody costs zero React renders, while this memo still
   * re-derives whenever the tracker itself is swapped for a new recording.
   */
  const liveLayer = useMemo<NoteLayer | null>(() => {
    const tracker = cs.liveNotes;
    if (!tracker) return null;
    const layer: NoteLayer = {
      startSec: 0,
      durationSec: 1,
      notes: tracker.notes,
      label: 'live',
      live: true,
    };
    // The window's END has to be read fresh every frame, not frozen at the
    // moment the memo ran: `tracker.lastSec` grows as the recording goes, and
    // a layer that captured it once would clamp the board to the recording's
    // first second and then never show a note again. A getter keeps the
    // object's IDENTITY stable (so this memo still runs once per recording)
    // while the extent stays live — which is exactly the same contract the
    // mutable `notes` array relies on.
    Object.defineProperty(layer, 'durationSec', {
      get: () => Math.max(1, tracker.lastSec),
      enumerable: true,
    });
    return layer;
  }, [cs.liveNotes]);

  // Real notes take precedence: that is the "colour change on stop".
  const drawnLayer = noteLayer ?? liveLayer;
  const exportableLayer = noteLayer ?? liveLayer;
  midiLayerRef.current = exportableLayer;

  /**
   * Transcribe the current History selection and show its notes in the
   * piano-roll lane (`m`, or the ♪ button on the selection).
   *
   * Notes-only: there is no saved audio file for a `.mid` to sit beside, and
   * the note list is what the lane draws. Basic Pitch costs roughly the clip's
   * own length, so results are cached per selection — re-selecting a range you
   * already transcribed is instant, and pressing `m` again on the same range
   * puts the lane away.
   */
  const transcribeSelection = useCallback(async () => {
    const sel = selectionRef.current;
    if (!cs.recorder || !cs.historyModel) {
      emitToast('error', 'Start a capture first — there is nothing buffered to transcribe.');
      return;
    }
    if (!sel || sel[1] - sel[0] <= 0) {
      emitToast('error', 'Select a range in History first (drag across the waveform).');
      return;
    }

    const key = selectionKey(sel);
    const cached = getNoteLayer(key);
    if (cached) {
      // Same range again → toggle the lane off (the cache keeps the notes).
      setNoteLayer((cur) => (cur === cached ? null : cached));
      return;
    }
    if (noteBusyRef.current) {
      emitToast('error', 'Already transcribing — one job at a time.');
      return;
    }

    noteBusyRef.current = true;
    try {
      const { selectionToMono } = await import('./lib/export-engine');
      const mono = await selectionToMono(cs.recorder, cs.historyModel, sel);
      if (!mono || !mono.samples.length) {
        emitToast('error', 'Nothing captured in that range yet — try a wider selection.');
        return;
      }
      const label = rangeLabel(mono.startSec, mono.durationSec);
      await transcribeSavedRecording(
        {
          audioPath: '',
          samples: mono.samples,
          sampleRate: mono.sampleRate,
          notesOnly: true,
        },
        {
          emitToast,
          onSettled: (state) => {
            if (state.status !== 'done') return;
            if (!state.notes?.length) {
              emitToast('error', `No notes found in ${label}.`);
              return;
            }
            const layer: NoteLayer = {
              startSec: mono.startSec,
              durationSec: mono.durationSec,
              notes: state.notes,
              label,
            };
            putNoteLayer(key, layer);
            setNoteLayer(layer);
          },
        },
      );
    } catch (e: any) {
      emitToast('error', `Transcribe failed: ${e?.message ?? e}`);
    } finally {
      noteBusyRef.current = false;
    }
  }, [cs.recorder, cs.historyModel]);

  /**
   * Export the current piano-roll's notes as a real .mid file (todo.md MIDI
   * export complaint, 2026-10-07) — into the configured save folder, named
   * after the range it covers. Separate from the transcribeOnSave pipeline's
   * own .mid (that one sits beside its audio); this exports whatever is
   * CURRENTLY shown in the lane/MIDI view, including a notes-only selection
   * that never had an audio file of its own.
   */
  const exportMidi = useCallback(async () => {
    const layer = noteLayer ?? liveLayer;
    if (!layer || !layer.notes.length) {
      emitToast('error', 'No MIDI notes to export yet.');
      return;
    }
    if (!settings.saveFolder) {
      emitToast('error', 'Set a save folder in Settings first.');
      return;
    }
    try {
      const bytes = await window.api.notesToMidi(layer.notes);
      const res = await window.api.saveRecording({
        folder: settings.saveFolder,
        bytes,
        ext: 'mid',
        durationSec: layer.durationSec,
      });
      if (res.ok) {
        emitToast('saved', `MIDI exported\n${(res.path ?? '').split(/[\\/]/).pop()}`);
      } else {
        emitToast('error', res.error ?? 'MIDI export failed');
      }
    } catch (e: any) {
      emitToast('error', `MIDI export failed: ${e?.message ?? e}`);
    }
  }, [noteLayer, liveLayer, settings.saveFolder]);

  // Session seconds are only meaningful within one recording session, so a new
  // recorder (a restart) invalidates every cached layer.
  useEffect(() => {
    clearNoteLayers();
    setNoteLayer(null);
  }, [cs.recorder]);

  // Bridge local-toast events into the same toast array as 'recording:event'.
  const [toasts, setToasts] = useState<{ id: number; kind: 'saved' | 'error'; message: string }[]>([]);
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as any;
      const id = Date.now() + Math.random();
      setToasts((t) => [...t, { id, ...detail }].slice(-3));
      setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000);
    };
    window.addEventListener('recordr:local-toast', handler);
    return () => window.removeEventListener('recordr:local-toast', handler);
  }, []);

  // When settings.alwaysOnTop changes, push it to the main process so the
  // window gets re-pinned immediately (the tray menu is rebuilt by main
  // via its onSettingsChanged callback so we don't need to touch it here).
  useEffect(() => {
    if (loaded) window.api.setAlwaysOnTop(settings.alwaysOnTop);
  }, [settings.alwaysOnTop, loaded]);

  // Layout drives the window's minimum size (and shrinks it to a strip for
  // `bar`), which only main can set.
  useEffect(() => {
    if (loaded) window.api.applyLayout(settings.uiLayout);
  }, [settings.uiLayout, loaded]);

  // Temporal smoothing is per visualizer mode (see SMOOTHING_FOR_MODE). It's
  // set on the live AnalyserNode here rather than inside the draw loop because
  // the draw loop is requestAnimationFrame-driven and stops dead while this
  // window is hidden — which is exactly the case when the pop-out is the only
  // thing on screen and still needs correctly-smoothed frames.
  //
  // The split view renders several modes from one AnalyserNode, which can only
  // carry a single smoothing constant. The spectrogram is a *time history*,
  // so it degrades first when smoothing climbs (every transient smears across
  // dozens of columns); while it's on screen a low middle value keeps it
  // readable at the cost of slightly livelier spectrum bars.
  useEffect(() => {
    const node = cs.analyser?.analyser;
    if (node && typeof node.smoothingTimeConstant === 'number') {
      const shown = VISUALIZER_MODES.filter((m) => !settings.vizHidden.includes(m));
      const multi = shown.length > 1;
      node.smoothingTimeConstant = multi
        ? shown.includes('spectrogram')
          ? 0.3
          : SMOOTHING_FOR_MODE.spectrum
        : SMOOTHING_FOR_MODE[shown[0] ?? settings.visualizer];
    }
  }, [cs.analyser, settings.visualizer, settings.vizHidden]);

  // Right-click anywhere → the native quick menu (device, visualizer, layout).
  // Form fields keep the OS text menu.
  const handleContextMenu = useCallback((e: MouseEvent) => {
    const el = e.target as HTMLElement;
    if (el.closest('input, textarea, select, [contenteditable="true"]')) return;
    e.preventDefault();
    window.api.showContextMenu();
  }, []);

  // `s` saves the History selection (RS parity). Ignored while typing, with
  // modifiers held, or when there's no selection to save.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 's' || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
      if ((e.target as HTMLElement)?.closest?.('input, textarea, select, [contenteditable="true"]')) return;
      if (!selectionRef.current) return;
      e.preventDefault();
      void saveSelection();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // The quick menu's "Save selection" item. Main builds that menu (a docked
  // 52px window would clip an in-DOM one) from the selection the renderer
  // reports, and sends this back when it is chosen. No dep array, like the key
  // handlers above: saveSelection closes over the current settings/recorder.
  useEffect(() => {
    const unsub = window.api.onRequestSaveSelection(() => {
      void saveSelection();
    });
    return unsub;
  });

  // `m` transcribes the History selection to MIDI and shows it in the
  // piano-roll lane (§MIDI-1 Phase A). Same guards as `s`: not while typing,
  // not with modifiers held, and nothing to do without a selection.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'm' || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
      if ((e.target as HTMLElement)?.closest?.('input, textarea, select, [contenteditable="true"]')) return;
      if (!selectionRef.current) return;
      e.preventDefault();
      void transcribeSelection();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // Mirror our local capturing state into the tray so its title, overlay
  // badge, tooltip and elapsed-time ticker stay in sync.
  useEffect(() => {
    if (loaded) window.api.setTrayCapturing(capturing);
  }, [capturing, loaded]);

  // Settings is a tall modal; a docked strip can be as short as 52px
  // (DOCK_MIN_HEIGHT in main/window-controls.ts), which would otherwise
  // squeeze the modal into an unusable sliver. Borrow the same
  // tempExpandWindow mechanism the old bar-layout device dropdown used:
  // grow the window while Settings is open, snap back on close.
  const SETTINGS_MIN_HEIGHT = 420;
  const openSettingsPanel = useCallback(() => {
    setSettingsOpen(true);
    window.api.tempExpandWindow(SETTINGS_MIN_HEIGHT);
  }, []);
  const closeSettingsPanel = useCallback(() => {
    setSettingsOpen(false);
    window.api.tempExpandWindow(null);
  }, []);

  // Listen for "open settings" requests from the tray menu.
  useEffect(() => {
    const unsub = window.api.onOpenSettingsRequest(() => openSettingsPanel());
    return unsub;
  }, [openSettingsPanel]);

  // Pop-out lifecycle: main owns the window and persists whether it's up, so
  // settings.popoutOpen is the single source of truth — no matter whether the
  // toggle came from here, the tray menu, or the pop-out's own ✕.
  const popoutOpen = loaded && settings.popoutOpen;

  const togglePopout = useCallback(() => {
    void window.api.togglePopout();
  }, []);

  // Closing the pop-out ends any pinned single-visualizer view.
  useEffect(() => {
    if (!popoutOpen) setPopoutOverride(null);
  }, [popoutOpen]);

  /** Pop the pop-out open pinned to one visualizer (split pane's ⧉). */
  const popOutMode = useCallback(
    (mode: VisualizerMode) => {
      // ⧉ opens the pop-out *alongside* the main window: the main window
      // keeps its split view while the one visualizer gets its own window.
      if (!popoutOpen) void window.api.togglePopout(true, { keepMain: true });
      setPopoutOverride(mode);
    },
    [popoutOpen],
  );

  const events = useRecorderEvents({
    onHotkey: handleHotkey,
  });
  // Merge local-toast and event toasts.
  const mergedToasts = toasts.concat(events.toasts).slice(-3);

  const canSaveNow = useMemo(() => {
    if (!cs.recorder) return false;
    if (!settings.saveFolder) return false;
    if (settings.recordMode === 'traditional' && !cs.recorder.isActive()) return false;
    return cs.recorder.bufferedDuration() > 0 || cs.recorder.isActive();
  }, [cs.recorder, settings.recordMode, settings.saveFolder, cs.stream]);

  const toggleCapture = useCallback(() => {
    if (!settings.sourceId && !settings.loopbackDeviceId) {
      alert('Pick an audio source first.');
      return;
    }
    // Traditional mode: the Stop button ends a recording session, so save it
    // here — the same way handleHotkey does. A plain setCapturing(false) would
    // tear the recorder down in useCapture, which stops and *discards* the
    // chunks.
    const rec = cs.recorder;
    if (settings.recordMode === 'traditional' && capturing && rec?.isActive()) {
      if (stopSaveBusyRef.current) return;
      stopSaveBusyRef.current = true;
      void (async () => {
        try {
          const blob = await rec.stop();
          const dur = rec.bufferedDuration();
          if (settings.saveFolder) {
            await encodeAndWriteBlob(blob, dur);
          } else {
            emitToast('error', 'No save folder — recording was not saved. Pick one in Settings.');
          }
        } finally {
          stopSaveBusyRef.current = false;
        }
        // Only after the save settles does the recorder tear down (its chunks
        // are already gone, so teardownRecorder just releases the handle).
        setCapturing(false);
      })();
      return;
    }
    setCapturing((c) => !c);
  }, [
    settings.sourceId,
    settings.loopbackDeviceId,
    settings.recordMode,
    settings.saveFolder,
    capturing,
    cs.recorder,
  ]);

  // ----- Pop-out bridge ----------------------------------------------------
  // Stream analyser frames to the pop-out while it's open. Refs keep the
  // effect from restarting whenever a callback identity changes.
  const analyserRef = useRef(cs.analyser);
  analyserRef.current = cs.analyser;

  // A timer, not requestAnimationFrame: rAF is tied to compositing, so it
  // stops the moment this window is minimised or hidden to the tray — which is
  // precisely when the pop-out is the only thing the user can see. (main also
  // sets backgroundThrottling: false so the timer keeps its interval.)
  useEffect(() => {
    if (!popoutOpen) return;
    const id = setInterval(() => {
      const a = analyserRef.current;
      if (!a) return;
      a.sample();
      window.api.sendVizFrame({
        time: a.timeData,
        freq: a.freqData,
        minDecibels: a.analyser.minDecibels,
        maxDecibels: a.analyser.maxDecibels,
      });
    }, VIZ_FRAME_MS);
    return () => clearInterval(id);
  }, [popoutOpen]);

  // Live elapsed time on the record button while a clip is recording. An
  // interval rather than rAF so it keeps ticking even when this window is
  // hidden behind the pop-out (backgroundThrottling is off, so it does).
  useEffect(() => {
    if (!cs.clipActive) {
      setClipElapsed(0);
      return;
    }
    const id = setInterval(() => {
      setClipElapsed(Math.max(0, (Date.now() - clipStartedAt) / 1000));
    }, 100);
    return () => clearInterval(id);
  }, [cs.clipActive, clipStartedAt]);

  // Drive the always-on-top clip-recording window. It's a separate OS window so
  // the indicator + stop button stay visible no matter what state the app is in
  // — minimised, hidden to the tray, docked, or with the visualizer popped out.
  useEffect(() => {
    if (!loaded) return;
    window.api.setClipWindow({
      active: cs.clipActive,
      startedAt: clipStartedAt,
      format: settings.recordingFormat,
      theme: settings.theme,
    });
  }, [loaded, cs.clipActive, clipStartedAt, settings.recordingFormat, settings.theme]);

  // Slower-moving state. bufferedSeconds is floored so this fires about once a
  // second instead of on every animation frame.
  const bufferedWhole = Math.floor(cs.bufferedSeconds);
  // THROTTLED (owner, 2026-10-13: "popout frames lag when MIDI viz runs"):
  // `cs.rms` changes EVERY animation frame, and it used to sit in the dep array
  // — so this payload (with the whole growing pianoRoll notes array inside)
  // was structured-cloned and IPC'd at frame rate, and every popout packet
  // re-rendered the popout's React tree while the MIDI pane redrew. Now the
  // packet is sent at most ~2×/s + on genuine state changes; RMS rides along
  // at whatever the last send had (it only feeds a meter). The live canvas
  // frames themselves stream on `viz:frame` untouched.
  const lastVizStateSent = useRef(0);
  const vizStatePayload = () => ({
    capturing,
    hasSource: !!cs.analyser,
    canSave: canSaveNow,
    clipActive: cs.clipActive,
    clipStartedAt,
    format: settings.recordingFormat,
    bufferedSeconds: bufferedWhole,
    bufferSeconds: settings.bufferSeconds,
    recordMode: settings.recordMode,
    theme: settings.theme,
    visualizer: settings.visualizer,
    overrideMode: popoutOverride,
    rms: cs.rms,
    pianoRoll: drawnLayer,
  });
  useEffect(() => {
    if (!popoutOpen) return;
    const now = performance.now();
    if (now - lastVizStateSent.current < 500) return;
    lastVizStateSent.current = now;
    window.api.sendVizState(vizStatePayload());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    popoutOpen, capturing, canSaveNow, bufferedWhole, cs.analyser, cs.clipActive, clipStartedAt,
    settings.bufferSeconds, settings.recordMode, settings.theme, settings.visualizer,
    settings.recordingFormat, popoutOverride, cs.rms,
  ]);

  // The pop-out has no buffer of its own — its history pane is fed from the
  // main window's peak track, and its spectrogram pane needs the same time
  // stamp for its selection layer. Stream whenever either is on the (shared)
  // board. The main window's own board reads the local buffer directly.
  useEffect(() => {
    if (!popoutOpen || !cs.peakBuffer) return;
    const needsTimeStream =
      !settings.vizHidden.includes('history') || !settings.vizHidden.includes('spectrogram');
    if (!needsTimeStream) return;
    const id = setInterval(() => {
      if (cs.peakBuffer && cs.historyModel) {
        // Stamp the session clock so the pop-out's selections land on the same
        // absolute seconds as the main window's (todo.md §11.4 D1).
        window.api.sendVizHistory({
          ...cs.peakBuffer.getState(),
          newestSec: cs.historyModel.newestSec,
        });
      }
    }, 200);
    return () => clearInterval(id);
  }, [popoutOpen, settings.vizHidden, cs.peakBuffer]);

  // Commands coming back from the pop-out's buttons.
  const cmdRef = useRef({
    toggleCapture,
    performSave,
    update,
    handleSelectionChange,
    toggleClipRecording,
    discardClipRecording,
    exportMidi,
    clearBufferAll,
  });
  cmdRef.current = {
    toggleCapture,
    performSave,
    update,
    handleSelectionChange,
    toggleClipRecording,
    discardClipRecording,
    exportMidi,
    clearBufferAll,
  };
  useEffect(
    () =>
      window.api.onVizCommand((c) => {
        const {
          toggleCapture: tc,
          performSave: ps,
          update: up,
          handleSelectionChange: hsc,
          toggleClipRecording: tcr,
          discardClipRecording: dcr,
          exportMidi: em,
          clearBufferAll: cb,
        } = cmdRef.current;
        if (c.type === 'toggle-capture') tc();
        else if (c.type === 'save') void ps();
        // The pop-out asked keep/discard itself, so the save path skips the
        // confirm here.
        else if (c.type === 'toggle-clip') void tcr(true);
        else if (c.type === 'discard-clip') void dcr();
        else if (c.type === 'set-visualizer') void up({ visualizer: c.mode });
        else if (c.type === 'set-override') setPopoutOverride(c.mode);
        else if (c.type === 'selection-change') hsc(c.selection, c.mode ?? 'history');
        // The pop-out has no note layers of its own (they live in this
        // window's recorder/history), so its ⇩ .mid buttons ask here.
        else if (c.type === 'export-midi') void em();
        else if (c.type === 'clear-buffer') clearBufferAll();
      }),
    [exportMidi],
  );
  // Auto-enable MIDI transcription when MIDI visualizer is visible
  useEffect(() => {
    const midiVisible = !settings.vizHidden.includes('midi');
    if (midiVisible && !settings.transcribeOnSave) {
      update({ transcribeOnSave: true });
    }
  }, [settings.vizHidden, settings.transcribeOnSave, update]);

  // The clip window's stop/discard ride their own channel. Opposite of the
  // pop-out's toggle-clip: this window is visible, so the keep/discard prompt
  // belongs here — tcr(false) asks rather than silently saving.
  useEffect(
    () =>
      window.api.onClipCommand((c) => {
        const { toggleClipRecording: tcr, discardClipRecording: dcr } = cmdRef.current;
        if (c.type === 'toggle-clip') void tcr(false);
        else if (c.type === 'discard-clip') void dcr();
      }),
    [],
  );

  if (!loaded) {
    return <div className="loading">Loading…</div>;
  }

  // One class per theme — a binary ternary here silently rendered every theme
  // past the first two with the classic-green chrome.
  const themeClass = `theme-${settings.theme}`;
  const customChrome = settings.titleBarMode === 'custom';
  // The board is skipped when the pop-out is showing the same signal.
  const showBoard = !(popoutOpen && settings.hideBoardWhenPopped);
  // The footer always shows — it carries the save-format picker, which has no
  // other home on-screen (the quick menu aside). There is only one layout now
  // (the compact mode was retired); short windows shed chrome via CSS.

  const formatPicker = (
    <FormatPicker
      value={settings.recordingFormat}
      onChange={(f) => update({ recordingFormat: f })}
      compact
    />
  );

  const sourcePicker = (
    <SourcePicker
      backend={settings.captureBackend}
      sources={cs.sources}
      loopbackDevices={cs.loopbackDevices}
      selectedId={
        settings.captureBackend === 'loopback'
          ? settings.loopbackDeviceId
          : settings.sourceId
      }
      onChange={(id) => {
        if (settings.captureBackend === 'loopback') {
          update({ loopbackDeviceId: id });
        } else {
          update({ sourceId: id });
        }
      }}
      onRefresh={capture.refreshSources}
      loopbackSupported={loopbackSupported}
    />
  );

  // ---- Board membership -------------------------------------------------
  // The board shows every mode that isn't in `vizHidden`: one → a single
  // interactive board, several → a read-only mosaic. The footer chips toggle
  // membership directly — there is no separate split/single switch.
  const hiddenSet = new Set(settings.vizHidden);
  const visibleModes = (() => {
    const shown = VISUALIZER_MODES.filter((m) => !hiddenSet.has(m));
    return shown.length ? shown : [settings.visualizer];
  })();
  const gridView = visibleModes.length > 1;

  /** Show or hide one mode on the board (pane ✕s + chips). Never hides the
   *  last visible mode — the board always shows at least one. */
  const setPaneHidden = (mode: VisualizerMode, hidden: boolean) => {
    if (hidden && visibleModes.length === 1 && visibleModes[0] === mode) return;
    const next = hidden
      ? Array.from(new Set([...settings.vizHidden, mode]))
      : settings.vizHidden.filter((m) => m !== mode);
    // Keep `visualizer` pointed at a mode that's actually on screen.
    const shownAfter = VISUALIZER_MODES.filter((m) => !next.includes(m));
    const patch: Partial<AppSettings> = { vizHidden: next };
    if (!hidden) patch.visualizer = mode;
    else if (!shownAfter.includes(settings.visualizer)) patch.visualizer = shownAfter[0];
    void update(patch);
  };

  /** Each chip is an independent on/off for its visualizer. All the lit ones
   *  are on the board: one → a single interactive board, several → a mosaic.
   *  The last lit chip can't be switched off. */
  const toggleMode = (mode: VisualizerMode) => setPaneHidden(mode, !hiddenSet.has(mode));

  const vizChips = settings.showVizChips && (
    <div className="viz-buttons">
      {VISUALIZER_MODES.map((m) => {
        const active = !hiddenSet.has(m);
        const only = active && visibleModes.length === 1;
        return (
          <button
            key={m}
            type="button"
            className={`chip ${active ? 'on' : ''}`}
            aria-pressed={active}
            title={
              only
                ? `${VISUALIZER_LABELS[m]} — the board's only view`
                : active
                  ? `Hide ${VISUALIZER_LABELS[m]}`
                  : `Show ${VISUALIZER_LABELS[m]} (turn on more than one for a split view)`
            }
            onClick={() => toggleMode(m)}
          >
            <VizIcon mode={m} />
          </button>
        );
      })}
    </div>
  );

  return (
    <div
      className={`app ${themeClass} layout-full ${customChrome ? 'has-custom-titlebar' : ''}${maximized ? ' is-maximized' : ''}`}
      onContextMenu={handleContextMenu}
    >
      {customChrome && (
        <TitleBar
          settings={settings}
          onUpdate={update}
          capturing={capturing}
          popoutOpen={popoutOpen}
          onTogglePopout={togglePopout}
          onOpenSettings={openSettingsPanel}
        />
      )}

      <HUD
        settings={settings}
        capturing={capturing}
        bufferedSeconds={cs.bufferedSeconds}
        canSaveNow={canSaveNow}
        onToggleCapture={toggleCapture}
        onManualSave={performSave}
        onOpenSettings={openSettingsPanel}
        error={cs.error}
        noSignal={cs.noSignal}
        hideSettingsButton={customChrome}
        formatControl={formatPicker}
        clipActive={cs.clipActive}
        clipElapsed={cs.clipActive ? clipElapsed : undefined}
        clipEnabled={!!cs.stream && !!settings.saveFolder}
        onToggleClip={toggleClipRecording}
        onClearBuffer={clearBufferAll}
      />
      {showBoard && (
        <main className={`board ${cs.clipActive || (settings.recordMode === 'traditional' && capturing) ? 'is-capturing' : ''}`}>
          {gridView ? (
            <div className={`viz-grid panes-${visibleModes.length}`}>
              {visibleModes.map((m) => (
                <div className="viz-pane" key={m}>
                  <VisualizerBoard
                    analyser={cs.analyser}
                    mode={m}
                    theme={settings.theme}
                    gain={settings.vizGain}
                    historyModel={cs.historyModel}
                    dragReady={dragReady}
                    pianoRoll={m === 'midi' ? drawnLayer : null}
                    showOscilloscopeOverlay={m === 'history' && settings.showOscilloscopeOverlay}
                    onTranscribeSelection={transcribeSelection}
                    onSelectionChange={handleSelectionChange}
                    onDragNotReady={() => emitToast('error', 'Snippet still preparing — give it a second, then drag.')}
                  />
                  {m === 'midi' && (
                    <button
                      type="button"
                      className="viz-pane-export"
                      title="Export the current MIDI notes as a .mid file"
                      aria-label="Export MIDI"
                      onClick={exportMidi}
                    >
                      ⇩ .mid
                    </button>
                  )}
                  <button
                    type="button"
                    className="viz-pane-pop"
                    title={`Pop the ${VISUALIZER_LABELS[m]} view into its own window`}
                    aria-label={`Pop ${VISUALIZER_LABELS[m]} view out`}
                    onClick={() => popOutMode(m)}
                  >
                    ⧉
                  </button>
                  <button
                    type="button"
                    className="viz-pane-x"
                    title={`Close the ${VISUALIZER_LABELS[m]} view`}
                    aria-label={`Close ${VISUALIZER_LABELS[m]} view`}
                    onClick={() => setPaneHidden(m, true)}
                  >
                    ✕
                  </button>
                  <span className="viz-pane-tag">{VISUALIZER_LABELS[m]}</span>
                </div>
              ))}
            </div>
          ) : (
            <>
              <VisualizerBoard
                analyser={cs.analyser}
                mode={visibleModes[0]}
                theme={settings.theme}
                gain={settings.vizGain}
                historyModel={cs.historyModel}
                dragReady={dragReady}
                pianoRoll={visibleModes[0] === 'midi' ? drawnLayer : null}
                showOscilloscopeOverlay={visibleModes[0] === 'history' && settings.showOscilloscopeOverlay}
                onTranscribeSelection={transcribeSelection}
                onSelectionChange={handleSelectionChange}
                onDragNotReady={() => emitToast('error', 'Snippet still preparing — give it a second, then drag.')}
              />
              {visibleModes[0] === 'midi' && (
                <button
                  type="button"
                  className="viz-pane-export board-export"
                  title="Export the current MIDI notes as a .mid file"
                  aria-label="Export MIDI"
                  onClick={exportMidi}
                >
                  ⇩ .mid
                </button>
              )}
              <span className="board-mode-tag" aria-hidden="true">
                {VISUALIZER_LABELS[visibleModes[0]]}
              </span>
            </>
          )}
        </main>
      )}

      <footer className="sidebar">
        {settings.showSourcePicker ? sourcePicker : <span />}
        {vizChips || <span />}
      </footer>

      {settingsOpen && (
        <SettingsPanel
          settings={settings}
          onUpdate={update as (p: Partial<AppSettings>) => Promise<AppSettings>}
          onClose={closeSettingsPanel}
          onPickFolder={() => window.api.pickFolder()}
          active={capturing}
          loopbackSupported={loopbackSupported}
          popoutOpen={popoutOpen}
          onTogglePopout={togglePopout}
        />
      )}

      <ToastStack toasts={mergedToasts} />
    </div>
  );
}
