import type { VisualizerMode } from '../../shared/types';

/**
 * One line-icon per visualizer mode, drawn on the same 16px grid with the same
 * stroke weight, so the view-switch chips read as a single set. They inherit
 * `currentColor`, so the chip's active/inactive colour applies to them too.
 * The MIDI icon is a keyboard, the style the other four are matched to.
 */
export function VizIcon({ mode }: { mode: VisualizerMode }) {
  const common = {
    width: '1em',
    height: '1em',
    viewBox: '0 0 16 16',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.5,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
    focusable: false,
  };

  switch (mode) {
    case 'oscilloscope':
      return (
        <svg {...common}>
          <path d="M1 8 C3 2.5 5 2.5 6 8 S9 13.5 10 8 S13 2.5 15 8" />
        </svg>
      );
    case 'spectrum':
      return (
        <svg {...common}>
          <rect x="2" y="9" width="2.5" height="5" />
          <rect x="6.75" y="4" width="2.5" height="10" />
          <rect x="11.5" y="7" width="2.5" height="7" />
        </svg>
      );
    case 'spectrogram':
      return (
        <svg {...common}>
          <rect x="1.75" y="2.25" width="12.5" height="11.5" rx="1" />
          <path d="M1.75 6.1h12.5M1.75 9.9h12.5M6.1 2.25v11.5M9.9 2.25v11.5" />
        </svg>
      );
    case 'history':
      return (
        <svg {...common}>
          <circle cx="8" cy="8" r="6.25" />
          <path d="M8 4.5V8l2.5 1.5" />
        </svg>
      );
    case 'midi':
      return (
        <svg {...common}>
          <rect x="1.5" y="2.5" width="13" height="11" rx="1" />
          <path d="M5.8 2.5v11M10.2 2.5v11" />
          <rect x="4" y="2.5" width="3.6" height="6.5" fill="currentColor" stroke="none" />
          <rect x="8.4" y="2.5" width="3.6" height="6.5" fill="currentColor" stroke="none" />
        </svg>
      );
  }
}
