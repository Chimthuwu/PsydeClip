/**
 * Renderer-side orchestration for MIDI transcription.
 *
 * Deliberately NOT a "MIDI capture" toggle that you must arm before recording:
 * save is a pipeline (the app already encodes WAV/MP3 on save, see
 * toggleClipRecording), and a `.mid` is a property of the output, not a mode you
 * enter. A button you can forget produces silently missing MIDI, which is the
 * opposite of what an always-rolling recorder is for.
 *
 * Contract, enforced here:
 *  - the audio file is already written before this runs, and is never touched
 *  - transcription is fire-and-forget; failures toast, they never fail the save
 *  - progress goes through the existing toast lane, same as "Encoding MP3…"
 */

import type { TranscribeJobState } from '../../shared/types';
import { decodeToMono } from './transcribe-input';

export type ToastKind = 'saved' | 'error';
export type EmitToast = (kind: ToastKind, message: string) => void;

let jobCounter = 0;
const activeJobs = new Map<string, { cancel: () => void; toasts: Set<string> }>();

/** Source of PCM for transcription: either decoded PCM, or encoded bytes. */
export type TranscribeSource =
  | { bytes: Uint8Array }
  | { samples: Float32Array; sampleRate: number };

/**
 * Kick off transcription for an already-saved recording.
 *
 * @param audioPath Full path of the audio file that was just written.
 * @param source    Decoded mono PCM when we already have it (rolling export),
 *                  otherwise the encoded bytes, which are decoded here.
 * @param notesOnly Skip the `.mid` and return only the note list — what the
 *                  piano-roll lane wants for a range of the rolling buffer,
 *                  which has no saved audio file for a `.mid` to sit beside.
 */
export async function transcribeSavedRecording(
  args: TranscribeSource & { audioPath: string; notesOnly?: boolean },
  deps: { emitToast: EmitToast; onSettled?: (state: TranscribeJobState) => void },
): Promise<string | null> {
  const { audioPath, notesOnly } = args;
    const { emitToast } = deps;
    const jobId = `midi-${Date.now().toString(36)}-${++jobCounter}`;

  try {
    let samples: Float32Array;
    let sampleRate: number;

    if ('samples' in args) {
      samples = args.samples;
      sampleRate = args.sampleRate;
    } else {
      const { bytes } = args;
      if (!bytes || bytes.byteLength === 0) {
        emitToast('error', 'Nothing to transcribe.');
        return null;
      }
      emitToast('saved', 'Transcribing…');
      const decoded = await decodeToMono(bytes);
      samples = decoded.samples;
      sampleRate = decoded.sampleRate;
    }

    if (!samples.length) {
      emitToast('error', 'Nothing to transcribe.');
      return null;
    }

    const initial = await window.api.startTranscription({
      jobId,
      samples,
      sampleRate,
      audioPath,
      notesOnly,
    });

    if (initial.status === 'error') {
      emitToast('error', `Transcribe failed: ${initial.error ?? 'unknown error'}`);
      return null;
    }

    activeJobs.set(jobId, { cancel: () => void window.api.cancelTranscription(jobId), toasts: new Set() });

    const off = window.api.onTranscription((state) => {
      if (state.jobId !== jobId) return;

      if (state.status === 'running') {
        // Throttle: only a whole percent, and only on the main job's toast.
        const pct = Math.floor(state.fraction * 100);
        const entry = activeJobs.get(jobId);
        if (entry && !entry.toasts.has(`p${pct}`)) {
          entry.toasts.add(`p${pct}`);
          emitToast('saved', `Transcribing… ${pct}%`);
        }
        return;
      }

      off();
      activeJobs.delete(jobId);

      const name = state.midiPath.split(/[\\/]/).pop() ?? '';
      if (state.status === 'done') {
        // Be honest about cost: a long buffer takes longer than its own duration.
        const secs = ((state.elapsedMs ?? 0) / 1000).toFixed(1);
        if (notesOnly) {
          // Nothing was written to disk — the caller renders the notes.
          emitToast('saved', `Transcribed ${state.noteCount ?? 0} notes (${secs}s)`);
        } else {
          emitToast(
            'saved',
            `MIDI saved (${state.noteCount ?? 0} notes, ${secs}s)\n${name}`,
          );
        }
      } else if (state.status === 'cancelled') {
        emitToast('error', 'Transcription cancelled.');
      } else {
        // Audio is untouched — say so, because that's the reassuring part.
        emitToast('error', `Transcribe failed: ${state.error ?? 'unknown error'}\nAudio saved fine.`);
      }
      deps.onSettled?.(state);
    });

    return jobId;
  } catch (err) {
    emitToast('error', `Transcribe failed: ${(err as Error).message}\nAudio saved fine.`);
    return null;
  }
}

/** Cancel a running job (called from the toast's cancel affordance). */
export function cancelTranscription(jobId: string): void {
  activeJobs.get(jobId)?.cancel();
}

/** True if any transcription is still running. */
export function hasActiveTranscription(): boolean {
  return activeJobs.size > 0;
}