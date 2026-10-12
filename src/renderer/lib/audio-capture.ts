import type { CaptureSource } from '../../shared/types';

/**
 * The id prefix the browser/Capacitor target uses for its one synthetic source
 * (`src/renderer/platform/browser-api.ts`). Anything with this prefix is
 * captured with `getDisplayMedia` instead of Electron's desktopCapturer.
 */
export const DISPLAY_PICKER_PREFIX = 'display:';

/**
 * Wraps Electron's desktopCapturer API to obtain a MediaStream whose audio
 * tracks carry the system/loopback audio of the picked screen or window.
 *
 * On Windows, desktopCapturer uses the platform's screen-capture backend and
 * yields a stream with both video (we discard) and audio. Combined with
 * Chromium's loopback audio mixer this is the closest analogue to a true
 * WASAPI loopback without the need for a native build step.
 */
async function pickWithDesktopCapturer(sourceId: string): Promise<MediaStream> {
  return (navigator.mediaDevices as any).getUserMedia({
    audio: {
      mandatory: {
        chromeMediaSource: 'desktop',
        chromeMediaSourceId: sourceId,
      },
    },
    video: {
      mandatory: {
        chromeMediaSource: 'desktop',
        chromeMediaSourceId: sourceId,
      },
    },
  });
}

/**
 * The browser equivalent: `getDisplayMedia` opens the browser's own picker and
 * (with `audio: true`) carries the audio of the chosen screen or tab.
 *
 * Video is requested because the API requires a video track to exist; it is
 * dropped immediately afterwards — the app records audio only, and leaving a
 * live video track open would keep the capture indicator on and cost CPU.
 */
async function pickWithDisplayMedia(): Promise<MediaStream> {
  return navigator.mediaDevices.getDisplayMedia({
    audio: true,
    video: true,
  });
}

export async function pickSourceAndCapture(sourceId: string): Promise<MediaStream | null> {
  const source: MediaStream | null = sourceId.startsWith(DISPLAY_PICKER_PREFIX)
    ? await pickWithDisplayMedia()
    : await pickWithDesktopCapturer(sourceId);

  if (source) {
    // We only want audio, so stop and remove the video tracks immediately.
    // (With desktopCapturer, requesting video was mandatory to prevent
    // Chromium IPC crashes; with getDisplayMedia it is mandatory to get a
    // stream at all.)
    source.getVideoTracks().forEach((track) => {
      track.stop();
      source.removeTrack(track);
    });
  }

  return source;
}

export async function listSources(): Promise<CaptureSource[]> {
  return window.api.listSources();
}
